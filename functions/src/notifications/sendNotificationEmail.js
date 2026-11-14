const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db, requireAdmin} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {hashIdForLog, presenceForLog} = require("../utils/logRedaction");

// ===================================================
// Cloud Function: sendNotificationEmail (callable)
// تُستدعى من functions أخرى أو من لوحة التحكم
// TODO: إضافة فحص صلاحيات Admin قبل التفعيل للإنتاج
// ===================================================
exports.sendNotificationEmail = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async (request) => {
      requireAdmin(request);

      const {userId, templateName, extraData} = request.data || {};

      const userDoc = await db.collection("users").doc(userId).get();
      if (!userDoc.exists) {
        throw new HttpsError("not-found", "المستخدم غير موجود");
      }
      const user = userDoc.data();

      const lang = user.language || "ar";
      const template = EMAIL_TEMPLATES[templateName]?.[lang];
      if (!template) {
        throw new HttpsError("invalid-argument", "قالب غير موجود");
      }

      if (!user.email) {
        throw new HttpsError("failed-precondition", "المستخدم بلا بريد");
      }

      // Debug log لتشخيص مشاكل FCM — V8 الدفعة ١ (الخصوصية): المعرّف مُهشَّر والرمز
      // حالةٌ لا قيمة. البريد حُذف: وجوده مفروغ منه (رُفض الطلب أعلاه بلاه).
      console.log(
          "sendNotificationEmail — template:", templateName,
          "userId:", hashIdForLog(userId),
          "fcmToken:", presenceForLog(user.fcmToken),
      );

      const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());
      // البند ٤-د (2026-10-18 +03): فشل sendMail كان يصعد بلا التقاط فتطبعه المنصّة (Unhandled error) بنصّ المزوّد كاملاً وفيه عنوان المستلم (القاعدة 36).
      // يُلتقط هنا وينقّى بالمنقّي الواحد، ويُرمى منه ما كانت المنصّة ترميه للمستدعي لأيّ خطأ غير HttpsError — internal/INTERNAL — فلا يتغيّر ما يصل العميل.
      try {
        await transporter.sendMail({
          from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
          to: user.email,
          subject: template.subject,
          html: template.html(
              user.name,
              extraData?.scans || user.scansRemaining,
              extraData?.plan || user.plan,
          ),
        });
      } catch (e) {
        console.error("Failed to send notification email:", sanitizeFailureText(e));
        throw new HttpsError("internal", "INTERNAL");
      }

      // FCM push إضافي عند منح اشتراك مجاني
      if (templateName === "grantSubscription") {
        if (user.fcmToken) {
          try {
            const scans = extraData?.scans || user.scansRemaining;
            const plan = extraData?.plan || user.plan;
            await admin.messaging().send({
              token: user.fcmToken,
              notification: {
                title: lang === "tr" ? "Aboneliğiniz Aktif 🎁" : "تم تفعيل اشتراكك 🎁",
                body: lang === "tr" ?
                  `${scans} ücretsiz tarama eklendi` :
                  `تمت إضافة ${scans} فحص مجاني`,
              },
              data: {
                type: "grant_subscription",
                plan: String(plan || ""),
                scans: String(scans || 0),
              },
            });
            console.log("sendNotificationEmail — FCM sent OK to", hashIdForLog(userId));
          } catch (e) {
            console.error("Failed to send FCM push for grant:", sanitizeFailureText(e));
          }
        } else {
          console.warn("sendNotificationEmail — grantSubscription but no fcmToken for user",
              hashIdForLog(userId));
        }
      }

      return {success: true};
    },
);
