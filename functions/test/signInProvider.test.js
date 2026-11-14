'use strict';

// signInProvider.test.js — V8 (2026-10-09): معيار «حساب غير مجهول بمزوّد معروف» مصدره واحد (src/utils/signInProvider.js) يستعمله
// registerUser وredeemPromoCode. وحدة بلا شبكة: الدالّة، وأن المستهلكَين يمرّان بها لا بنسخة، وأن قرار registerUser القائم بلا تغيير
// (registerUserFreeScans.test.js يحرسه على حدة). المعالج الكامل على المحاكي: redeemPromoCode.e2e.test.js.
//
// Run: node functions/test/signInProvider.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const {signInProviderStatus, SIGN_IN_REASON} = require('../src/utils/signInProvider');
const {freeScansGrantDecision} = require('../src/users/registerUser');
const tok = (provider) => ({firebase: {sign_in_provider: provider}});

// ═══════════════════════════════════════════════════════════════════
// ١ — الدالّة: المجهول والغائب مرفوضان، وغير المجهول مقبول
// ═══════════════════════════════════════════════════════════════════
deepEq(signInProviderStatus(tok('anonymous')), {identified: false, reason: 'ANONYMOUS'}, '[١] anonymous ⇒ غير مقبول');
for (const p of ['google.com', 'password', 'phone', 'apple.com', 'custom']) {
  deepEq(signInProviderStatus(tok(p)), {identified: true, reason: null}, `[١] ${p} ⇒ مقبول`);
}
const unknown = {identified: false, reason: 'SIGN_IN_PROVIDER_UNKNOWN'};
const absent = [
  ['{}', {}], ['firebase بلا مزوّد', {firebase: {}}], ['مزوّد نصّ فارغ', tok('')], ['مزوّد null', tok(null)],
  ['مزوّد غير نصّي', tok(1)], ['token=null', null], ['token=undefined', undefined],
];
for (const [label, t] of absent) deepEq(signInProviderStatus(t), unknown, `[١] ${label} ⇒ مزوّد مجهول الحال ⇒ غير مقبول (القاعدة 22)`);
deepEq(signInProviderStatus({email: 'a@b.c', email_verified: true, firebase: {sign_in_provider: 'anonymous'}}),
    {identified: false, reason: 'ANONYMOUS'}, '[١] ادّعاءات بريد في رمز مجهول لا تجعله مسجَّلاً (المعيار المزوّد وحده)');
deepEq(Object.values(SIGN_IN_REASON).sort(), ['ANONYMOUS', 'SIGN_IN_PROVIDER_UNKNOWN'], '[١] أسباب الرفض مُسمّاة ومُصدَّرة');

// ═══════════════════════════════════════════════════════════════════
// ٢ — مصدر واحد: قرار registerUser مشتقّ منه لا نسخة (القاعدة 24)، ولكلّ رمز يتطابق القراران
// ═══════════════════════════════════════════════════════════════════
const matrix = [tok('anonymous'), tok('google.com'), tok('password'), tok(''), tok(null), tok(1), {}, {firebase: {}}, null, undefined];
for (const t of matrix) {
  const s = signInProviderStatus(t);
  deepEq(freeScansGrantDecision(t), {grant: s.identified, reason: s.reason}, `[٢] freeScansGrantDecision = signInProviderStatus لرمز ${JSON.stringify(t)}`);
}
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const registerSrc = src(path.join('users', 'registerUser.js'));
const redeemSrc = src(path.join('users', 'redeemPromoCode.js'));
ok(/require\("\.\.\/utils\/signInProvider"\)/.test(registerSrc) && /signInProviderStatus\(/.test(registerSrc), '[٢] registerUser يستعمل المصدر الواحد');
ok(/require\("\.\.\/utils\/signInProvider"\)/.test(redeemSrc) && /signInProviderStatus\(/.test(redeemSrc), '[٢] redeemPromoCode يستعمل المصدر الواحد');
// A-SUB الموجة الأولى (البند ١١): requestPayment ثالث المستهلكين، من المصدر نفسه
const paymentSrc = src(path.join('payments', 'requestPayment.js'));
ok(/require\("\.\.\/utils\/signInProvider"\)/.test(paymentSrc) && /signInProviderStatus\(/.test(paymentSrc), '[٢] requestPayment يستعمل المصدر الواحد');
ok(!/sign_in_provider/.test(registerSrc.replace(/\/\/.*$/gm, '')) && !/sign_in_provider/.test(redeemSrc.replace(/\/\/.*$/gm, '')) && !/sign_in_provider/.test(paymentSrc.replace(/\/\/.*$/gm, '')),
    '[٢] لا قراءة ثانية لـsign_in_provider خارج المصدر الواحد (في الشيفرة، لا التعليقات)');

// ═══════════════════════════════════════════════════════════════════
// ٣ — redeemPromoCode: الفحص بعد request.auth مباشرة وقبل أيّ قراءة، وبالنصّ القائم لا نصّ جديد
// ═══════════════════════════════════════════════════════════════════
const handler = redeemSrc.slice(redeemSrc.indexOf('async (request) => {'));
const iAuth = handler.indexOf('if (!request.auth)');
const iProvider = handler.indexOf('signInProviderStatus(request.auth.token)');
const iCode = handler.indexOf('const {code} = request.data');
const iRead = handler.indexOf('db.collection("promoCodes")');
ok(iAuth >= 0 && iProvider > iAuth && iCode > iProvider && iRead > iProvider, '[٣] الترتيب: request.auth ثم فحص المزوّد ثم قراءة الكود (promoCodes) — الرفض قبل أيّ قراءة');
const rejectBlock = handler.slice(iProvider, iCode);
ok((rejectBlock.match(/new HttpsError\("unauthenticated", "يجب تسجيل الدخول"\)/g) || []).length === 1,
    '[٣] الرفض بـHttpsError("unauthenticated", "يجب تسجيل الدخول") — النصّ القائم نفسه');
ok((redeemSrc.match(/"يجب تسجيل الدخول"/g) || []).length === 2, '[٣] النصّ نفسه في الموضعين فقط (لا نصّ ثالث جديد)');

console.log(`\nsignInProvider.test.js: ${n}/${n} assertions passed`);
