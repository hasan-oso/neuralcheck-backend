// ===================================================
// مصدر الحقيقة الوحيد لباقات الاشتراك.
// ===================================================
// كلٌّ من requestPayment (السعر المعروض + لقطة على وثيقة الدفع) و
// confirmPayment (عدد الفحوصات الممنوحة، عبر اللقطة المخزّنة) يشتقّ من هذا
// الكائن — لا قيم مكرّرة يمكن أن تنحرف مجدداً.
//
// القيم المعتمدة (لا تُغيَّر دون قرار منتج صريح):
//   single      $0.50    1 فحص
//   shop_basic  $10      50 فحص
//   shop_pro    $20      150 فحص
const PLANS = {
  single: {scans: 1, priceUsd: 0.5},
  shop_basic: {scans: 50, priceUsd: 10},
  shop_pro: {scans: 150, priceUsd: 20},
};

// أسماء بديلة قديمة: أكواد/بيانات قديمة استعملت 'basic'/'pro' بدل القيم
// القانونية 'shop_basic'/'shop_pro'. التطبيع يحوّلها للقيم القانونية كي تعمل
// فحوص isShop/الميزات. القيم القانونية أو غير المعروفة (أو null) تمرّ كما هي.
const PLAN_ALIASES = {
  basic: "shop_basic",
  pro: "shop_pro",
};

function normalizePlan(plan) {
  if (typeof plan !== "string") return plan;
  return PLAN_ALIASES[plan] || plan;
}

/**
 * هل باقة هذا الحساب تسمح له بإنشاء جلسة فحص بكود («فحص جهاز آخر عبر كود»، ميزة باقات المحلّ)؟
 *
 * **تطابق دلالة الواجهة حرفياً** (قرار المنسّق، A-SUB 2026-10-17؛ `HomeScreen.kt:121-123`، منقول، غير متحقَّق من هذا المستودع): نصّ غير فارغ
 * وفيه `basic` أو `pro` **دون اعتبار الأحرف**. أيّ شيء آخر (null، غائب، غير نصّ، نصّ لا يحويهما) ⟵ false: الغياب لا يُقرأ إذناً (القاعدة 22).
 *
 * **لا يستعمل `normalizePlan` ولا `isShop` عمداً.** `checkSubscription.js:44` يعرّف `isShop` بالمساواة الصارمة مع shop_basic وshop_pro على القيمة المخزَّنة
 * (`const plan = user.plan || "free"` — بلا normalizePlan، كما في المصدر)، فيُخرج `professional` (باقة الشريك في شهرها الأوّل، قرار A-SUB رقم 9، منقول) كغير shop
 * (ويُخرج basic وpro أيضاً)، بينما الواجهة تعرض لصاحبها زرّ الجلسة (الاسم يحوي «pro»). فالحكم هنا بالاحتواء كي لا يُحرَم مالك يرى الزرّ.
 * الفرق عن `isShop` مقصود ومثبَّت في test/sessionOwnerPlan.test.js.
 * @param {*} plan قيمة users/{uid}.plan كما خُزِّنت
 * @return {boolean}
 */
function isSessionOwnerPlan(plan) {
  return sessionOwnerPlanState(plan) === SESSION_OWNER_PLAN_STATE.ALLOWED;
}

/** حالة الباقة عند حكم إنشاء الجلسة — قيم سطر سجلّ الرفض (`planState=`)، بلا قيمة الباقة الخام. الغياب حالة صريحة (القاعدة 22). */
const SESSION_OWNER_PLAN_STATE = Object.freeze({
  ALLOWED: "allowed",
  ABSENT: "absent", // غير موجود أو null
  NOT_A_STRING: "not_a_string",
  NOT_OWNER_PLAN: "not_owner_plan", // نصّ لا يحوي basic ولا pro (ومنه الفارغ)
});

/**
 * الحالة الدقيقة وراء isSessionOwnerPlan (للسجلّ). الحكم نفسه، لا نسخة ثانية منه.
 * @param {*} plan قيمة users/{uid}.plan كما خُزِّنت
 * @return {string} قيمة من SESSION_OWNER_PLAN_STATE
 */
function sessionOwnerPlanState(plan) {
  if (plan === undefined || plan === null) return SESSION_OWNER_PLAN_STATE.ABSENT;
  if (typeof plan !== "string") return SESSION_OWNER_PLAN_STATE.NOT_A_STRING;
  return /basic|pro/i.test(plan) ? SESSION_OWNER_PLAN_STATE.ALLOWED : SESSION_OWNER_PLAN_STATE.NOT_OWNER_PLAN;
}

module.exports = {PLANS, PLAN_ALIASES, normalizePlan, isSessionOwnerPlan, sessionOwnerPlanState, SESSION_OWNER_PLAN_STATE};
