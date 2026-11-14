const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {PLANS} = require("../utils/plans");
const {signInProviderStatus} = require("../utils/signInProvider");

// ===================================================
// Cloud Function: requestPayment (callable)
// ===================================================
exports.requestPayment = onCall(
    {timeoutSeconds: 10, memory: "256MiB"},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "غير مصادق");
      }

      // A-SUB الموجة الأولى (قرار المستخدم ١١، بنصّه عن أمر المنسّق: «(أ) منع الدافع المجهول الآن» — على نمط redeemPromoCode.js:28-31، غير متحقَّق من هذا المستودع): الحساب المجهول
      // مصادَق (request.auth موجود) لكنه بلا مستند users (registerUser لا يُنشئه له)؛ فدفعته كانت تُقبل ثم يثبّتها confirmPayment «مؤكَّدة» ولا يُرصَّد أحد. الرفض **قبل** أيّ كتابة، وبالنصّ
      // القائم لهذه الدالّة نفسها أعلاه (كما فعل redeemPromoCode بنصّه القائم). المزوّد الغائب مثله (القاعدة 22). المعيار: src/utils/signInProvider.js — مصدر واحد مع registerUser وredeemPromoCode.
      const providerStatus = signInProviderStatus(request.auth.token);
      if (!providerStatus.identified) {
        console.warn(`[requestPayment] rejected before writing the payment: reason=${providerStatus.reason}`);
        throw new HttpsError("unauthenticated", "غير مصادق");
      }

      const {plan, reference} = request.data || {};

      if (!PLANS[plan]) {
        throw new HttpsError("invalid-argument", "خطة غير صالحة");
      }
      const planSpec = PLANS[plan];

      // لقطة (snapshot) للسعر وعدد الفحوصات على وثيقة الدفع وقت الطلب — حتى
      // تُكرَّم كل دفعة بالقيم التي رآها العميل وقت الطلب حتى لو تغيّر جدول
      // PLANS لاحقاً. confirmPayment يمنح من scansGranted المخزّنة هنا.
      const paymentRef = await db.collection("payments").add({
        userId: request.auth.uid,
        amountUsd: planSpec.priceUsd,
        scansGranted: planSpec.scans,
        method: "shamcash",
        reference: reference || "",
        status: "pending",
        plan: plan,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {
        paymentId: paymentRef.id,
        status: "pending",
        message: "تم تسجيل طلب الدفع. سيتم تفعيل الاشتراك بعد التأكيد.",
      };
    },
);
