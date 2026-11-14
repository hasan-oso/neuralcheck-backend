const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {db} = require("../utils/admin");
const {CHECK_SUBSCRIPTION_VERDICT_FIELD, checkSubscriptionVerdict} = require("../analysis/scanRefusal");

// ===================================================
// Cloud Function: checkSubscription (callable)
// يقرأ خطة المستخدم + الفحوصات المتبقية + features
// ===================================================
//
// S-SUB (2026-10-16 +03، البند ٣): يُضاف إلى الردّ حقل `scanVerdict` — **حكم يحسبه الخادم** لا تاريخ خام وساعة هاتف (التصميم الموحَّد §٣، منقول من أمر المنسّق، غير متحقَّق من هنا):
// «حكم يحسبه الخادم في ردّ checkSubscription، لا تاريخ خام وساعة هاتف». قيمته من القائمة المغلقة ALLOWED | NO_CREDIT | SUBSCRIPTION_EXPIRED، وهو **الجزء غير المعتمد على الجهاز من حكم البوّابة نفسه**
// (scanGateVerdict في analysis/scanRefusal.js: الرصيد ثم انتهاء الاشتراك — الدالّة التي تستعملها البوّابة في analyzeDevice، فلا نسخة ثانية من «منتهٍ»). الاسم والقيم اقتراح الوكيل [م]، مسجَّلان في
// docs/PROTOCOL_CONTRACT.md §١٠. **الحقول القائمة لا تتغيّر** (قرّاء 1.0.14 والموقع): الحقل الجديد آخر المفاتيح فقط، وتحرس ذلك scanVerdictParity.e2e.test.js.
// ملاحظتان في العقد: «ALLOWED» لا تعني ألّا ترفض analyzeDevice بـFREE_DEVICE_USED (يحتاج الجهاز المفحوص ولا يحمله هذا النداء)؛ والحكم لحساب المستدعي الشخصي لا لفحص جلسة المحلّ (البوّابة تحكم على المالك هناك).
exports.checkSubscription = onCall(
    {timeoutSeconds: 10, memory: "256MiB"},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "غير مصادق");
      }

      const userDoc = await db.collection("users").doc(request.auth.uid).get();
      if (!userDoc.exists) {
        // مستخدم غير مسجّل في users — اعتبره free بدون رصيد
        return {
          plan: "free",
          scansRemaining: 0,
          scansTotal: 0,
          expiresAt: null,
          isActive: false,
          isFreeTrial: true,
          features: {
            pdf: false, qr: false, history: false, shopPage: false,
            remoteCode: false, deviceManagement: false, shopLogo: false,
            stats: false, prioritySupport: false,
          },
          // مستخدم بلا مستند: البوّابة تحكم عليه NO_CREDIT (userData=null ⟵ رصيد 0) — الحكم نفسه.
          [CHECK_SUBSCRIPTION_VERDICT_FIELD]: checkSubscriptionVerdict(null),
        };
      }

      const user = userDoc.data();
      const plan = user.plan || "free";
      const isShop = plan === "shop_basic" || plan === "shop_pro";

      return {
        plan: plan,
        scansRemaining: user.scansRemaining || 0,
        scansTotal: user.scansTotal || 0,
        expiresAt: user.expiresAt || null,
        isActive: user.isActive || false,
        isFreeTrial: plan === "free",
        features: {
          pdf: plan !== "free", // المجاني بدون PDF
          qr: plan !== "free", // المجاني بدون QR
          history: isShop,
          shopPage: isShop,
          remoteCode: isShop,
          deviceManagement: plan === "shop_pro",
          shopLogo: plan === "shop_pro",
          stats: plan === "shop_pro",
          prioritySupport: plan === "shop_pro",
        },
        [CHECK_SUBSCRIPTION_VERDICT_FIELD]: checkSubscriptionVerdict(user),
      };
    },
);
