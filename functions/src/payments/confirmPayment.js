const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db, requireAdmin} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {PLANS} = require("../utils/plans");
const {hashIdForLog, presenceForLog} = require("../utils/logRedaction");

// رفضان مسمّيان جديدان (البند ٣، 2026-10-17): دفعة معلّقة بلا مستخدم قابل للمنح. الرموز والنصوص هنا مصدرها الوحيد (القاعدة 24)؛ المستدعي (لوحة الموقع) يعرض e.message ويتجاهل details
// [منقول، غير متحقَّق من هذا المستودع — wepsite/app/admin/payments/page.js:142-157]. الرفضان القائمان (not-found «الدفعة غير موجودة»، failed-precondition «الدفعة ليست معلقة») كما كانا حرفياً.
const CONFIRM_PAYMENT_REFUSAL = Object.freeze({
  PAYMENT_USER_ABSENT: "PAYMENT_USER_ABSENT", // الدفعة بلا userId نصّي غير فارغ
  PAYMENT_USER_NOT_FOUND: "PAYMENT_USER_NOT_FOUND", // لا مستند users لصاحب الدفعة
});
const CONFIRM_PAYMENT_REFUSAL_TEXT = Object.freeze({
  PAYMENT_USER_ABSENT: "الدفعة بلا مستخدم مرتبط",
  PAYMENT_USER_NOT_FOUND: "مستخدم الدفعة غير موجود",
});

/**
 * حالة userId على وثيقة الدفع (القاعدة 22: الغياب حالة صريحة).
 * @param {*} userId
 * @return {?string} null إن كان نصّاً غير فارغ؛ وإلا absent | null | empty | invalid-type (للسطر المسمّى)
 */
function describeUserIdState(userId) {
  if (userId === undefined) return "absent";
  if (userId === null) return "null";
  if (typeof userId !== "string") return "invalid-type";
  if (userId === "") return "empty";
  return null;
}

// ===================================================
// Cloud Function: confirmPayment (callable, Admin)
// TODO: إضافة فحص صلاحيات Admin قبل التفعيل للإنتاج
// ===================================================
exports.confirmPayment = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async (request) => {
      requireAdmin(request);

      const {paymentId} = request.data || {};
      const paymentRef = db.collection("payments").doc(paymentId);

      // البند ٣ (2026-10-17 +03، قرار المنسّق، منقول): معاملة واحدة تقرأ (الدفعة ثم المستخدم) **قبل** أيّ كتابة، وتعيد فحص `pending` داخلها، ثم تكتب الدفعة والمستخدم معاً.
      // كان: قراءة الدفعة ثم شرط pending ثم payments.update ثم users.update بلا معاملة — فتأكيدان متزامنان يجتازان الشرط معاً ويمنحان مرّتين (scansTotal يُزاد مرّتين ويُردّ الاستدعاءان
      // `confirmed` ويُرسَل الإشعار مرّتين؛ scansRemaining يُضبط مطلقاً فلا يتضاعف). الآن الثاني يرى `confirmed` داخل معاملته (أو تُعاد معاملته على التعارض) فيُرفض failed-precondition.
      // الحقول المكتوبة هي نفسها حرفياً، ورموز الأخطاء ونصوصها وشكل الردّ كما كانت (المستدعي الوحيد، wepsite/app/admin/payments/page.js:142-157 — منقول، غير متحقَّق من هذا المستودع —
      // يتجاهل الردّ ويعرض e.message). البريد وFCM بعد الالتزام وخارج المعاملة، وفشلهما لا يُلغي التأكيد (كما كان).
      const {payment, user, grantedScans} = await db.runTransaction(async (tx) => {
        const paymentDoc = await tx.get(paymentRef);
        if (!paymentDoc.exists) {
          throw new HttpsError("not-found", "الدفعة غير موجودة");
        }

        const paymentData = paymentDoc.data();
        if (paymentData.status !== "pending") {
          throw new HttpsError("failed-precondition", "الدفعة ليست معلقة");
        }

        // القاعدة 22: الغياب حالة صريحة تُرفض قبل أيّ كتابة (كان: userId غائب ⟵ doc(undefined) ينهار بعد تأكيد الدفعة؛ ومستند المستخدم غير الموجود ⟵ update ينهار بعد تأكيد الدفعة أيضاً،
        // فتبقى «مؤكَّدة» بلا منحة).
        const userIdState = describeUserIdState(paymentData.userId);
        if (userIdState !== null) {
          console.warn(`[confirmPayment] refused reason=${CONFIRM_PAYMENT_REFUSAL.PAYMENT_USER_ABSENT} paymentId=${hashIdForLog(paymentId)} userIdState=${userIdState}`);
          throw new HttpsError("failed-precondition", CONFIRM_PAYMENT_REFUSAL_TEXT.PAYMENT_USER_ABSENT, {reasonCode: CONFIRM_PAYMENT_REFUSAL.PAYMENT_USER_ABSENT});
        }
        const userRef = db.collection("users").doc(paymentData.userId);
        const userDoc = await tx.get(userRef);
        if (!userDoc.exists) {
          console.warn(`[confirmPayment] refused reason=${CONFIRM_PAYMENT_REFUSAL.PAYMENT_USER_NOT_FOUND} paymentId=${hashIdForLog(paymentId)} userId=${hashIdForLog(paymentData.userId)}`);
          throw new HttpsError("not-found", CONFIRM_PAYMENT_REFUSAL_TEXT.PAYMENT_USER_NOT_FOUND, {reasonCode: CONFIRM_PAYMENT_REFUSAL.PAYMENT_USER_NOT_FOUND});
        }

        // امنح من اللقطة المخزّنة على وثيقة الدفع وقت الطلب (scansGranted) —
        // نفس مصدر الحقيقة (PLANS) الذي اشتقّ منه requestPayment السعر والعدد،
        // فلا تنحرف القيمتان. للدفعات القديمة المعلّقة قبل اعتماد اللقطة:
        // ارتداد لجدول PLANS المركزي (لا للقيم المُثبَّتة القديمة المحذوفة).
        const plan = paymentData.plan;
        const granted = (typeof paymentData.scansGranted === "number") ?
                        paymentData.scansGranted :
                        (PLANS[plan] ? PLANS[plan].scans : 1);
        const discountPercent = paymentData.discountPercent || 0;

        tx.update(paymentRef, {
          status: "confirmed",
          discountPercent: discountPercent,
          confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // قرار الاشتراك الشهري: كل دفعة تستبدل الباقة القديمة بالكامل (تصفير ثم
        // منح)، لا تُضاف إليها. الرصيد يُضبط لفحوصات الباقة كاملةً، والصلاحية
        // تُضبط للآن + 30 يوماً بصرف النظر عن المتبقي القديم.
        // (يُلغي عمداً سلوك التراكم/max-of السابق — commit af858c4 — لأن النموذج
        // الجديد اشتراك شهري يدوي يحلّ محلّ القديم لا يُراكمه. أثر مقصود: أي رصيد
        // إهداء/كود غير مستهلَك يُستبدَل عند الشراء.)
        // نمسح أعلام تذكير الانتهاء كي تبدأ الدورة الجديدة نظيفة (تستخدمها
        // المهمة الدورية checkExpiringSubscriptions). (حذف حقول الأعلام الثلاثة قائم في الشيفرة
        // قبل هذا البند وبنصّ الأمر نفسه «ما يعيد بدء دورة التذكير»؛ لا حذف جديد.)
        const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        tx.update(userRef, {
          plan: plan,
          scansRemaining: granted,
          scansTotal: admin.firestore.FieldValue.increment(granted),
          expiresAt: newExpiry,
          isActive: true,
          subExpiryEmailSent: admin.firestore.FieldValue.delete(),
          subExpiryFcmDate: admin.firestore.FieldValue.delete(),
          subExpiredNotified: admin.firestore.FieldValue.delete(),
        });

        return {payment: paymentData, user: userDoc.data(), grantedScans: granted};
      });
      const planConfig = {scans: grantedScans};

      // الإشعارات بعد الالتزام وخارج المعاملة. المستخدم من قراءة المعاملة نفسها (الحقول المستعملة هنا — email وfcmToken وlanguage وname — لا تغيّرها الكتابة).
      const lang = user?.language || "ar";

      // Debug log لتشخيص مشاكل FCM — V8 الدفعة ١ (الخصوصية): المعرّف مُهشَّر،
      // والبريد والرمز حالةٌ لا قيمة.
      console.log(
          "confirmPayment — userId:", hashIdForLog(payment.userId),
          "email:", presenceForLog(user?.email),
          "fcmToken:", presenceForLog(user?.fcmToken),
      );

      // 1. بريد تأكيد — لا نفشل العملية إذا فشل البريد
      if (user?.email) {
        try {
          const template = EMAIL_TEMPLATES.paymentConfirmed[lang];
          const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());
          await transporter.sendMail({
            from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
            to: user.email,
            subject: template.subject,
            html: template.html(user.name, planConfig.scans, payment.plan),
          });
        } catch (e) {
          console.error("Failed to send confirmation email:", sanitizeFailureText(e));
        }
      }

      // 2. FCM push notification
      if (user?.fcmToken) {
        try {
          await admin.messaging().send({
            token: user.fcmToken,
            notification: {
              title: lang === "tr" ? "Abonelik Onaylandı ✅" : "تم تفعيل الاشتراك ✅",
              body: lang === "tr" ?
                `${planConfig.scans} tarama hakkınız eklendi` :
                `تمت إضافة ${planConfig.scans} فحص لرصيدك`,
            },
            data: {
              type: "payment_confirmed",
              plan: String(payment.plan || ""),
              scans: String(planConfig.scans || 0),
            },
          });
          console.log("confirmPayment — FCM sent OK to", hashIdForLog(payment.userId));
        } catch (e) {
          console.error("Failed to send FCM push:", sanitizeFailureText(e));
        }
      } else {
        console.warn("confirmPayment — no fcmToken for user", hashIdForLog(payment.userId));
      }

      return {status: "confirmed", scansAdded: planConfig.scans};
    },
);

exports.CONFIRM_PAYMENT_REFUSAL = CONFIRM_PAYMENT_REFUSAL;
exports.CONFIRM_PAYMENT_REFUSAL_TEXT = CONFIRM_PAYMENT_REFUSAL_TEXT;
