"use strict";

// ===================================================
// signInProvider — معيار «حساب غير مجهول بمزوّد معروف» (V8، 2026-10-09)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «redeemPromoCode: رفض صريح للمجهول والمزوّد الغائب في أوّل الدالّة، بفحص مصدره
// واحد مع registerUser، وبالنصّ القائم في :20.» ولهذا خرج الفحص من registerUser.js (حيث وُلد في الجزء ١، قرار «registerUser لا يمنح
// freeScansForNewUser لحساب مجهول») إلى هنا، ويستعمله الاثنان: لا نسخة ثانية منه (القاعدة 24).
//
// الأساس: أيّ مصادَق، بما فيه المجهول (يُنشأ بإعدادات المشروع العلنية)، يمرّ من `request.auth`؛ فوجود `request.auth` لا يُثبت أنّ
// الحساب مسجَّل. المعيار هو ادّعاء المزوّد في رمز Firebase: `token.firebase.sign_in_provider`.
//   - "anonymous"                ⇒ مجهول ⇒ غير مقبول.
//   - غائب / ليس نصّاً / نصّاً فارغاً ⇒ مزوّد مجهول الحال ⇒ غير مقبول. (القاعدة 22: غياب الادّعاء ليس «غير مجهول».)
//   - أيّ نصّ آخر (google.com، password، phone، apple.com...) ⇒ مقبول.

const SIGN_IN_REASON = Object.freeze({
  ANONYMOUS: "ANONYMOUS",
  SIGN_IN_PROVIDER_UNKNOWN: "SIGN_IN_PROVIDER_UNKNOWN",
});

/**
 * @param {?Object} token request.auth.token
 * @return {{identified: boolean, reason: ?string}} reason=null حين identified=true.
 */
function signInProviderStatus(token) {
  const provider = token && token.firebase && token.firebase.sign_in_provider;
  if (provider === "anonymous") return {identified: false, reason: SIGN_IN_REASON.ANONYMOUS};
  if (typeof provider !== "string" || provider === "") {
    return {identified: false, reason: SIGN_IN_REASON.SIGN_IN_PROVIDER_UNKNOWN};
  }
  return {identified: true, reason: null};
}

module.exports = {signInProviderStatus, SIGN_IN_REASON};
