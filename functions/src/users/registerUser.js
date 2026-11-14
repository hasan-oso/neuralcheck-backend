const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {smtpUser, smtpPass} = require("../utils/secrets");
const {getMailTransporter, EMAIL_TEMPLATES} = require("../utils/emails");
const {signInProviderStatus} = require("../utils/signInProvider");

// V8 (إضافة 2026-10-09، قرار المستخدم بنصّه منقول من أمر المنسّق): «registerUser لا يمنح freeScansForNewUser لحساب
// مجهول (sign_in_provider = anonymous).» السبب: أيّ مصادَق، بما فيه المجهول (التطبيق يسجّل مجهولاً على جهاز الزبون،
// وأيّ زائر يستطيع ذلك بإعدادات المشروع العلنية)، كان يحصل على مستند برصيد مجّاني، وحسابات المجهول بلا عدد — فكل
// حساب جديد رصيد جديد. وإعداد «حساب واحد لكل بريد» لا يمسّ المجهول (بلا بريد).
//
// ما يُنشأ للمجهول: **لا مستند** (لا مستند برصيد 0). السبب: كل قارئ في functions/src يعامل غياب المستند «بلا رصيد»
// أصلاً (analyzeDevice، scanReservation، createScanSession: `!userData`، checkSubscription: «غير مسجّل → free بلا رصيد»)،
// ومستند برصيد 0 كان سيحمل isActive=true وexpiresAt+30 ويلوّث قائمة المستخدمين بكل حساب مجهول. فحص الجلسة لا يتأثّر:
// يُخصَم من صاحب المحل لا من جهاز الزبون (analyzeDevice: userId = ownerId). ويُمنح الرصيد حين يصير الحساب غير مجهول
// (ربط الحساب يُبقي uid ويغيّر المزوّد) وينادي registerUser بلا مستند قائم.
// القاعدة 22: غياب ادّعاء المزوّد ليس «غير مجهول» — لا منح.
// المعيار نفسه (مصدر واحد) يستعمله redeemPromoCode: src/utils/signInProvider.js.
/**
 * هل يُمنح هذا الحساب فحوص التسجيل المجانية؟
 * @param {?Object} token request.auth.token
 * @return {{grant: boolean, reason: ?string}}
 */
function freeScansGrantDecision(token) {
  const status = signInProviderStatus(token);
  return {grant: status.identified, reason: status.reason};
}

// ===================================================
// Cloud Function: registerUser (callable)
// ===================================================
exports.registerUser = onCall(
    {
      timeoutSeconds: 30,
      memory: "256MiB",
      secrets: [smtpUser, smtpPass],
    },
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
      }

      const userId = request.auth.uid;
      const {name, phone, type, language} = request.data || {};
      const lang = language || "ar";
      const email = request.auth.token.email || "";

      // التحقق من وجود المستخدم — لا نكتب فوق بياناته عند تسجيل الدخول
      const userDoc = await db.collection("users").doc(userId).get();

      if (userDoc.exists) {
        // مستخدم قائم — حدّث lastLoginAt فقط، لا تمسّ الرصيد أو الاشتراك
        await db.collection("users").doc(userId).update({
          lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const data = userDoc.data();
        return {
          success: true,
          scansRemaining: data.scansRemaining || 0,
          existing: true,
        };
      }

      // V8: حساب مجهول (أو مزوّد غير معروف) لا يحصل على مستند ولا على فحوص مجانية — انظر freeScansGrantDecision.
      const decision = freeScansGrantDecision(request.auth.token);
      if (!decision.grant) {
        console.warn(`[registerUser] no user document and no free scans: reason=${decision.reason}`);
        return {
          success: true, scansRemaining: 0, existing: false, freeScansGranted: false, reason: decision.reason,
        };
      }

      // قراءة عدد الفحوصات المجانية من Firestore (settings/app)
      // إن لم يوجد المستند أو الحقل: 0 افتراضياً
      let freeScans = 0;
      try {
        const settingsDoc = await db.collection("settings").doc("app").get();
        if (settingsDoc.exists) {
          const v = settingsDoc.data().freeScansForNewUser;
          if (typeof v === "number" && v >= 0) {
            freeScans = Math.floor(v);
          }
        }
      } catch (e) {
        console.error("Failed to read settings/app, defaulting to 0:", sanitizeFailureText(e));
      }

      // مستخدم جديد — باقة free + قائمة الأجهزة المستخدمة للفحص المجاني فارغة
      await db.collection("users").doc(userId).set({
        email: request.auth.token.email || null,
        displayName: request.auth.token.name || null,
        photoURL: request.auth.token.picture || null,
        name: name || "",
        phone: phone || "",
        type: type || "individual",
        language: lang,
        plan: "free",
        scansRemaining: freeScans,
        scansTotal: freeScans,
        freeTrialUsedDevices: [], // كل جهاز يُستخدم في فحص مجاني يُسجَّل هنا
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // إرسال بريد ترحيب — فقط للمستخدم الجديد، ولا نفشل التسجيل إذا فشل البريد
      if (email) {
        try {
          const template = EMAIL_TEMPLATES.welcome[lang] || EMAIL_TEMPLATES.welcome.ar;
          const transporter = getMailTransporter(smtpUser.value(), smtpPass.value());
          await transporter.sendMail({
            from: "\"NeuralCheck\" <" + smtpUser.value() + ">",
            to: email,
            subject: template.subject,
            html: template.html(name, freeScans),
          });
        } catch (e) {
          console.error("Failed to send welcome email:", sanitizeFailureText(e));
        }
      }

      return {success: true, scansRemaining: freeScans, existing: false};
    },
);

exports.freeScansGrantDecision = freeScansGrantDecision;
