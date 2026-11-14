const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db, requireAdmin} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {hashIdForLog, presenceForLog} = require("../utils/logRedaction");

// ===================================================
// Cloud Function: rejectPayment (callable, Admin)
// TODO: إضافة فحص صلاحيات Admin قبل التفعيل للإنتاج
// ===================================================
exports.rejectPayment = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async (request) => {
      requireAdmin(request);

      const {paymentId, reason} = request.data || {};
      const paymentDoc = await db.collection("payments").doc(paymentId).get();
      if (!paymentDoc.exists) {
        throw new HttpsError("not-found", "الدفعة غير موجودة");
      }

      const payment = paymentDoc.data();
      if (payment.status !== "pending") {
        throw new HttpsError("failed-precondition", "الدفعة ليست معلقة");
      }

      await db.collection("payments").doc(paymentId).update({
        status: "rejected",
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectionReason: reason || "",
      });

      // قراءة المستخدم للإشعارات
      const userDoc = await db.collection("users").doc(payment.userId).get();
      const user = userDoc.exists ? userDoc.data() : null;
      const lang = user?.language || "ar";

      // Debug log لتشخيص مشاكل FCM — V8 الدفعة ١ (الخصوصية، 2026-10-08 +03): كان هنا
      // سطر يطبع رمز FCM كاملاً («التوكن الكامل لتشخيص دقيق»)، وسطر يطبع المعرّف
      // والبريد والسبب خاماً. الآن سطر واحد: المعرّف مُهشَّر، والبريد والرمز والسبب
      // حالةٌ لا قيمة (السبب نصّ حرّ يكتبه المشرف وقد يحمل بيانات شخصية).
      console.log(
          "rejectPayment — userId:", hashIdForLog(payment.userId),
          "email:", presenceForLog(user?.email),
          "fcmToken:", presenceForLog(user?.fcmToken),
          "reason:", presenceForLog(reason),
      );

      // 1. بريد رفض — يتضمن السبب
      if (user?.email) {
        try {
          const template = EMAIL_TEMPLATES.paymentRejected[lang];
          const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());
          await transporter.sendMail({
            from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
            to: user.email,
            subject: template.subject,
            html: template.html(user.name, reason),
          });
        } catch (e) {
          console.error("Failed to send rejection email:", sanitizeFailureText(e));
        }
      }

      // 2. FCM push notification — body يتضمن السبب
      if (user?.fcmToken) {
        try {
          const reasonSuffix = reason ?
            (lang === "tr" ? ` Sebep: ${reason}` : ` السبب: ${reason}`) :
            "";
          await admin.messaging().send({
            token: user.fcmToken,
            notification: {
              title: lang === "tr" ?
                "❌ Ödeme talebi reddedildi" :
                "❌ تم رفض طلب الدفع",
              body: (lang === "tr" ?
                "Ödeme talebiniz reddedildi. Lütfen işlem numarasını kontrol edip tekrar deneyin." :
                "عذراً، تم رفض طلب الدفع. يرجى التأكد من صحة رقم العملية والمحاولة مرة أخرى.") +
                reasonSuffix,
            },
            data: {
              type: "payment_rejected",
              paymentId: String(paymentId || ""),
              reason: String(reason || ""),
            },
          });
          console.log("rejectPayment — FCM sent OK to", hashIdForLog(payment.userId));
        } catch (e) {
          console.error("Failed to send FCM push:", sanitizeFailureText(e));
        }
      } else {
        console.warn("rejectPayment — no fcmToken for user", hashIdForLog(payment.userId));
      }

      return {status: "rejected"};
    },
);
