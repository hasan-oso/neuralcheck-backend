// ===================================================
// منطق صلاحية الاشتراك الشهري (مشترك بين بوابة الفحص + المهمة الدورية)
// ===================================================
// القرار: كل دفعة تمنح فحوصات الباقة صالحة 30 يوماً من الشراء. عند انتهاء
// المدة يتوقّف الفحص حتى لو بقي رصيد. لا تجديد تلقائي (دفع يدوي ShamCash).
//
// غياب expiresAt (null/undefined) = "لا انتهاء" — سلوك آمن للمستخدمين
// القدامى الذين أُنشئت حساباتهم قبل اعتماد الفرض الزمني، فلا نوقفهم فجأة.
// أي قيمة غير قابلة للتحويل لتاريخ تُعامَل أيضاً كـ"لا انتهاء" (لا نحجب
// بسبب بيانات تالفة).

/**
 * يحوّل قيمة expiresAt (Firestore Timestamp | Date | ISO string | ms) إلى Date.
 * يُعيد null إذا تعذّر التحويل أو كانت القيمة غائبة.
 * @param {*} value قيمة expiresAt الخام من وثيقة المستخدم
 * @return {Date|null}
 */
function toDateOrNull(value) {
  if (value == null) return null;
  let d;
  if (typeof value.toDate === "function") {
    d = value.toDate(); // Firestore Timestamp
  } else if (value instanceof Date) {
    d = value;
  } else {
    d = new Date(value); // ISO string أو رقم ms
  }
  return (d instanceof Date && !isNaN(d.getTime())) ? d : null;
}

/**
 * هل انتهى اشتراك المستخدم؟ (expiresAt في الماضي)
 * غياب/تلف expiresAt → false (لا انتهاء — حفاظاً على القدامى).
 * @param {Object|null} userData وثيقة users/{uid}
 * @param {Date} [now] الوقت المرجعي (للاختبار)
 * @return {boolean}
 */
function isSubscriptionExpired(userData, now = new Date()) {
  const exp = toDateOrNull(userData && userData.expiresAt);
  if (exp === null) return false;
  return exp.getTime() < now.getTime();
}

module.exports = {isSubscriptionExpired, toDateOrNull};
