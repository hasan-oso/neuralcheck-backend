// Shared firebase-admin singleton + helpers.
// All modules that touch Firestore/Storage/Auth import from here.

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

// حراسة ضد التهيئة المزدوجة
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ===================================================
// Admin guard — قائمة الـ Admin + helper للتحقق
// ===================================================
const ADMIN_EMAILS = [
  "admin1@example.com",
  "admin2@example.com",
  "admin3@example.com",
];

/**
 * هل حامل الرمز مشرف **مؤكَّد البريد**؟ — مصدر واحد للشرط (القاعدة 24) يستعمله requireAdmin وgenerateReportPdf.
 *
 * قرار المستخدم (2026-10-09، بنصّه، منقول من أمر المنسّق): «يُضاف شرط email_verified إلى requireAdmin وإلى
 * generateReportPdf … يُرفض: غير المؤكَّد، ومن بلا ادّعاء التحقّق. ويُقبل: المشرف المؤكَّد.» نفس شرط
 * firestore.rules `isAdmin()` (التزام e24fe80). السبب: الشرط يقرأ بريد الرمز، وحساب بريد/كلمة مرور بلا
 * تأكيد لعنوان لم يسجّل صاحبه بعدُ يحمل ذلك البريد نفسه فيصير مشرفاً.
 *
 * القاعدة 22: غياب ادّعاء email_verified = غير مؤكَّد، ولا يُقبل إلا القيمة المنطقية true حرفياً (نصّ "true"
 * أو 1 مرفوض). ولا يُقبل رمز بلا بريد.
 *
 * @param {?{token: ?Object}} auth request.auth (قد يكون null/undefined).
 * @return {boolean}
 */
function isVerifiedAdmin(auth) {
  return !!(auth && auth.token &&
      auth.token.email_verified === true &&
      typeof auth.token.email === "string" &&
      ADMIN_EMAILS.includes(auth.token.email));
}

function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "غير مصادق");
  }
  if (!isVerifiedAdmin(request.auth)) {
    throw new HttpsError("permission-denied", "صلاحية Admin مطلوبة");
  }
}

module.exports = {admin, db, ADMIN_EMAILS, isVerifiedAdmin, requireAdmin};
