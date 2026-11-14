const {onSchedule} = require("firebase-functions/v2/scheduler");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {hashIdForLog} = require("../utils/logRedaction");

// ===================================================
// Scheduled Function: checkExpiringSubscriptions
// يومياً 9:00 صباحاً بتوقيت دمشق
// ===================================================
// ثلاث مهام، **كلٌّ في try/catch مستقلّ** (A-SUB البند ٤-أ، 2026-10-17): فشل إحداها لا يمنع الأخريين، ويُسجَّل سطر مسمّى `[checkExpiringSubscriptions] section=<…> FAILED: <نصّ الخطأ منقّى>`:
//  أ) تعطيل المنتهين فعلياً: من مرّ expiresAt → isActive=false (**والرصيد يبقى كما هو**)
//     + بريد/إشعار انتهاء (مرّة واحدة عبر علم subExpiredNotified).
//  ب) تذكير آخر 3 أيام: إشعار FCM في كل يوم من الثلاثة (منع تكرار اليوم نفسه عبر
//     subExpiryFcmDate)، وبريد مرّة واحدة فقط (في أول الأيام الثلاثة) عبر
//     subExpiryEmailSent.
//  ج) تذكير الرصيد المنخفض لباقات المحل.
//
// قرارات المستخدم (2026-10-14، منقولة من أمر المنسّق، غير متحقَّقة من هذا المستودع — مصدرها evidence/device-check-03/user-b8-read-results-and-decisions-2026-10-14.md القرار 2):
// «حذف القسم (د) (لا منظّف مجدوَل للجلسات، قرار 2026-10-10). و(أ) لا يصفّر الرصيد بل يطفئ فقط، أو يحفظ الرصيد قبل التصفير. وكل فرع في try/catch مستقلّ.» والاختيار بين خياري (أ) فوّضه المستخدم للمنسّق، فاختار: **لا تصفير**
// (بوّابة الخادم تحكم بالانتهاء عبر expiresAt في utils/subscription.js لا بالتصفير، فلا حاجة لتصفير الرصيد ولا حقل يحفظ قيمته).
// **القسم (د) حُذف كلّه**: كان يكتب status="expired" على جلسات pending المنقضية بلا expiredAt وبلا فحص حجز؛ الجلسات تُنهى الآن عند مسّها فقط (sessionLifecycle/sweepExpiredSessions)، ولا منظّف مجدوَل.
//
// القاعدة 43: **لا فهرس** users(isActive, expiresAt) ولا scanSessions(status, expiresAt) قبل قرار المستخدم؛ استعلامات (أ) و(ب) و(ج) تحتاج فهارس مركّبة (مساواة + مدى على حقلين) غير موجودة، فهي لا تعمل في الإنتاج اليوم
// (docs/FIRESTORE_INDEXES.md). هذا الملفّ لا يغيّر شروط الاستعلام.
//
// أعلام منع التكرار (subExpiredNotified / subExpiryEmailSent / subExpiryFcmDate)
// تُمسَح عند الشراء الجديد في confirmPayment (وكذلك يجب على لوحة الموقع مسحها
// عند المنح المباشر) كي تبدأ كل دورة اشتراك نظيفة.
//
// ملاحظة: فرض الانتهاء نفسه فوري في بوابة analyzeDevice/createScanSession
// (فحص expiresAt هناك)، لا ينتظر هذه المهمة. هذه المهمة للتعطيل + الإشعار.

/** أسماء الأقسام في سطر الفشل المسمّى وفي سطر الخلاصة (القاعدة 24: مصدر واحد مُصدَّر، يثبّته الاختبار). */
const EXPIRY_SECTION = Object.freeze({
  DEACTIVATE_EXPIRED: "deactivate_expired",
  REMIND_EXPIRING: "remind_expiring",
  LOW_BALANCE: "low_balance",
});
/** ما يُكتب في سطر الخلاصة لقسم فشل (لا صفر: الغياب لا يُقرأ «لم يُعالَج أحد»، القاعدة 22). */
const SECTION_FAILED = "FAILED";

exports.checkExpiringSubscriptions = onSchedule(
    {
      schedule: "every day 09:00",
      timeZone: "Asia/Damascus",
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async () => {
      const now = new Date();
      const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      const todayStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
      const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());

      // إرسال FCM آمن (يتجاهل غياب التوكن والأخطاء)
      const sendFcm = async (token, title, body, type) => {
        if (!token) return false;
        try {
          await admin.messaging().send({
            token,
            notification: {title, body},
            data: {type: String(type || "")},
          });
          return true;
        } catch (e) {
          console.error("FCM failed:", sanitizeFailureText(e));
          return false;
        }
      };

      // نتيجة كل قسم: عدّ أو SECTION_FAILED. القسم الفاشل لا يمنع غيره (A-SUB البند ٤-أ).
      const results = {};
      const runSection = async (section, work) => {
        try {
          results[section] = await work();
        } catch (e) {
          results[section] = SECTION_FAILED;
          // القاعدة 36: نصّ الخطأ منقّى قبل الطباعة؛ والقاعدة 21: التمييز بين أسباب الفشل بنصّه (يحمله sanitizeFailureText: الصنف والرمز والرسالة) لا بنوع الاستثناء.
          console.error(`[checkExpiringSubscriptions] section=${section} FAILED: ${sanitizeFailureText(e)}`);
        }
      };

      // ───────────────────────────────────────────────────────────
      // أ) تعطيل المنتهين فعلياً (expiresAt <= now) + إشعار انتهاء مرّة
      //    الرصيد لا يُمسّ (قرار 2026-10-14): الانتهاء تحكم به البوّابة عبر expiresAt.
      // ───────────────────────────────────────────────────────────
      await runSection(EXPIRY_SECTION.DEACTIVATE_EXPIRED, async () => {
        let deactivatedCount = 0;
        const expiredSnap = await db.collection("users")
            .where("isActive", "==", true)
            .where("expiresAt", "<=", now)
            .get();

        for (const doc of expiredSnap.docs) {
          const user = doc.data();
          // تعطيل فقط (scansRemaining لا يُكتب). نضبط علم الإشعار معاً.
          await doc.ref.update({
            isActive: false,
            subExpiredNotified: true,
            subExpiredAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          deactivatedCount++;

          // إشعار الانتهاء مرّة واحدة (تخطٍّ لو سبق إعلامه)
          if (user.subExpiredNotified) continue;
          const lang = user.language || "ar";
          if (user.email) {
            try {
              const t = EMAIL_TEMPLATES.subscriptionExpired[lang] ||
                        EMAIL_TEMPLATES.subscriptionExpired.ar;
              await transporter.sendMail({
                from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
                to: user.email,
                subject: t.subject,
                html: t.html(user.name),
              });
            } catch (e) {
              // V8 الدفعة ١ (الخصوصية): كان user.email هنا — doc.id هو uid المستخدم، مُهشَّراً.
              console.error("Failed to send expired email for user",
                  hashIdForLog(doc.id), sanitizeFailureText(e));
            }
          }
          await sendFcm(
              user.fcmToken,
              lang === "tr" ? "Aboneliğiniz sona erdi" : "انتهى اشتراكك",
              lang === "tr" ?
                "Taramaya devam etmek için yenileyin" :
                "جدّد اشتراكك لاستئناف الفحوصات",
              "subscription_expired",
          );
        }
        return deactivatedCount;
      });

      // ───────────────────────────────────────────────────────────
      // ب) تذكير آخر 3 أيام: FCM كل يوم + بريد مرّة واحدة
      // ───────────────────────────────────────────────────────────
      await runSection(EXPIRY_SECTION.REMIND_EXPIRING, async () => {
        let remindedCount = 0;
        const expiringSnap = await db.collection("users")
            .where("isActive", "==", true)
            .where("expiresAt", "<=", threeDaysLater)
            .where("expiresAt", ">", now)
            .get();

        for (const doc of expiringSnap.docs) {
          const user = doc.data();
          const lang = user.language || "ar";
          const update = {};

          // FCM: مرّة واحدة في اليوم (منع تكرار نفس اليوم)
          if (user.subExpiryFcmDate !== todayStr) {
            await sendFcm(
                user.fcmToken,
                lang === "tr" ? "Aboneliğiniz yakında bitiyor" : "اشتراكك ينتهي قريباً",
                lang === "tr" ?
                  "Kesintisiz devam için yenileyin" :
                  "جدّد اشتراكك لمتابعة الفحوصات دون انقطاع",
                "subscription_expiring",
            );
            update.subExpiryFcmDate = todayStr;
          }

          // بريد: مرّة واحدة فقط في الدورة (أول الأيام الثلاثة)
          if (!user.subExpiryEmailSent && user.email) {
            try {
              const t = EMAIL_TEMPLATES.subscriptionExpiring[lang] ||
                        EMAIL_TEMPLATES.subscriptionExpiring.ar;
              await transporter.sendMail({
                from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
                to: user.email,
                subject: t.subject,
                html: t.html(user.name, user.scansRemaining),
              });
              update.subExpiryEmailSent = true;
            } catch (e) {
              // V8 الدفعة ١ (الخصوصية): كان user.email هنا — doc.id هو uid المستخدم، مُهشَّراً.
              console.error("Failed to send expiring email for user",
                  hashIdForLog(doc.id), sanitizeFailureText(e));
            }
          }

          if (Object.keys(update).length > 0) {
            await doc.ref.update(update);
          }
          remindedCount++;
        }
        return remindedCount;
      });

      // ───────────────────────────────────────────────────────────
      // ج) رصيد منخفض (≤3) لباقات المحل فقط — كما كان
      //    (العدّ = مطابِقو الاستعلام، كما كان `lowSnap.size`، لا عدد الرسائل المرسَلة)
      // ───────────────────────────────────────────────────────────
      await runSection(EXPIRY_SECTION.LOW_BALANCE, async () => {
        const lowSnap = await db.collection("users")
            .where("isActive", "==", true)
            .where("scansRemaining", "<=", 3)
            .where("scansRemaining", ">", 0)
            .get();

        for (const doc of lowSnap.docs) {
          const user = doc.data();
          if (!user.email) continue;
          if (user.plan !== "shop_basic" && user.plan !== "shop_pro") continue;
          try {
            const lang = user.language || "ar";
            const template = EMAIL_TEMPLATES.scansRunningLow[lang];
            await transporter.sendMail({
              from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
              to: user.email,
              subject: template.subject,
              html: template.html(user.name),
            });
          } catch (e) {
            // V8 الدفعة ١ (الخصوصية): كان user.email هنا — doc.id هو uid المستخدم، مُهشَّراً.
            console.error("Failed to send low-scans email for user", hashIdForLog(doc.id), sanitizeFailureText(e));
          }
        }
        return lowSnap.size;
      });

      console.log(
          `[checkExpiringSubscriptions] done ${EXPIRY_SECTION.DEACTIVATE_EXPIRED}=${results[EXPIRY_SECTION.DEACTIVATE_EXPIRED]} ` +
          `${EXPIRY_SECTION.REMIND_EXPIRING}=${results[EXPIRY_SECTION.REMIND_EXPIRING]} ` +
          `${EXPIRY_SECTION.LOW_BALANCE}=${results[EXPIRY_SECTION.LOW_BALANCE]}`,
      );
    },
);

// مُصدَّرة للاختبار (القاعدة 24).
exports.EXPIRY_SECTION = EXPIRY_SECTION;
exports.SECTION_FAILED = SECTION_FAILED;
