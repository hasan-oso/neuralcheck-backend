'use strict';

// requestPaymentAnonymous.test.js — requestPayment يرفض الدافع المجهول والمزوّد الغائب (A-SUB الموجة الأولى، البند ١١، 2026-10-17 +03). بلا شبكة وبلا محاكٍ.
//
// قرار المستخدم ١١ (بنصّه، منقول عن أمر المنسّق order-backend-engineer-asub-wave1-2026-10-17.md — غير متحقَّق من هذا المستودع): «(أ) منع الدافع المجهول الآن» — في requestPayment على نمط
// redeemPromoCode.js:28-31. **خارج النطاق وقتها:** جعل confirmPayment معاملةً (الخيار ب) لم يُعتمد — ثم نُفِّذ بأمر لاحق (البند ٣، 2026-10-17): confirmPaymentTransaction.test.js وconfirmPaymentRace.e2e.test.js.
//
// الأساس (س٥ من تقرير الباك اند 3b7fbd2، غير متحقَّق منه هنا إلا بقراءة الكود): requestPayment كان يشترط request.auth وحده ويكتب payments.add({userId: uid}) ولا يقرأ users؛ والمجهول بلا مستند users.
//
// السلسلة الحقيقية: requestPayment.run ثم signInProviderStatus (المعيار الواحد مع registerUser وredeemPromoCode) ثم PLANS ثم الكتابة. المستبدَل (القاعدة 37) وحده: utils/admin ⟵ db.collection('payments').add
// يسجّل نداءاته في الذاكرة (فالرفض «قبل أيّ كتابة» يُقاس بعدد النداءات لا بالنصّ).
//
// Run: node functions/test/requestPaymentAnonymous.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const added = [];
const touched = [];
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}},
    db: {collection: (c) => { touched.push(c); return {add: async (doc) => { added.push({c, doc}); return {id: 'pay-1'}; }}; }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {requestPayment} = require('../src/payments/requestPayment');
const {HttpsError} = require('firebase-functions/v2/https');
const {SIGN_IN_REASON} = require('../src/utils/signInProvider');

const tok = (provider) => ({firebase: {sign_in_provider: provider}});
async function call(auth, data) {
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let value; let thrown = null;
  try { value = await requestPayment.run({data, auth, rawRequest: {headers: {}}}); } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {value, thrown, lines};
}
const reset = () => { added.length = 0; touched.length = 0; };

(async () => {
  // ١ المجهول والغائب: يُرفضان قبل أيّ كتابة، بنصّ الدالّة القائم
  for (const [label, token, reason] of [
    ['مجهول (anonymous)', tok('anonymous'), SIGN_IN_REASON.ANONYMOUS],
    ['بلا ادّعاء firebase', {}, SIGN_IN_REASON.SIGN_IN_PROVIDER_UNKNOWN],
    ['sign_in_provider فارغ', tok(''), SIGN_IN_REASON.SIGN_IN_PROVIDER_UNKNOWN],
    ['sign_in_provider ليس نصّاً', tok(7), SIGN_IN_REASON.SIGN_IN_PROVIDER_UNKNOWN],
    ['token غائب', undefined, SIGN_IN_REASON.SIGN_IN_PROVIDER_UNKNOWN],
  ]) {
    reset();
    const r = await call({uid: 'anon-uid', token}, {plan: 'single', reference: 'ref-1'});
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'unauthenticated' && r.thrown.message === 'غير مصادق', `[١] ${label}: يُرفض unauthenticated بنصّ الدالّة القائم «غير مصادق»`);
    eq(added.length + touched.length, 0, `[١] ${label}: لا Firestore ولا كتابة (الرفض قبل أيّ شيء)`);
    ok(r.lines.some((l) => l === `[requestPayment] rejected before writing the payment: reason=${reason}`), `[١] ${label}: سطر السجلّ بالسبب المسمّى ${reason}`);
    ok(!r.lines.join('\n').includes('anon-uid'), `[١] ${label}: لا uid في السجلّ`);
  }

  // ٢ خطة غير صالحة من مجهول: يُرفض بالمجهول أولاً (لا يصل إلى فحص الخطة)
  reset();
  {
    const r = await call({uid: 'a', token: tok('anonymous')}, {plan: 'no-such-plan'});
    eq(r.thrown && r.thrown.code, 'unauthenticated', '[٢] مجهول بخطة فاسدة: unauthenticated (الفحص قبل الخطة)');
  }

  // ٣ بلا auth أصلاً: كما كان (النصّ نفسه، ولا سطر مزوّد)
  reset();
  {
    const r = await call(null, {plan: 'single'});
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'unauthenticated' && r.thrown.message === 'غير مصادق', '[٣] بلا auth: كما كان');
    eq(r.lines.length, 0, '[٣] بلا auth: لا سطر سجلّ (السلوك القائم)');
    eq(added.length + touched.length, 0, '[٣] بلا auth: لا كتابة');
  }

  // ٤ غير المجهول يمرّ كما كان: الكتابة بنفس الشكل، والردّ نفسه
  for (const provider of ['google.com', 'password', 'phone', 'apple.com']) {
    reset();
    const r = await call({uid: 'real-uid', token: tok(provider)}, {plan: 'shop_basic', reference: 'ref-2'});
    ok(!r.thrown, `[٤] ${provider}: لا رفض (${r.thrown && r.thrown.message})`);
    deq(r.value, {paymentId: 'pay-1', status: 'pending', message: 'تم تسجيل طلب الدفع. سيتم تفعيل الاشتراك بعد التأكيد.'}, `[٤] ${provider}: الردّ كما كان`);
    eq(added.length, 1, `[٤] ${provider}: كتابة واحدة`);
    deq(Object.keys(added[0].doc).sort(), ['amountUsd', 'createdAt', 'method', 'plan', 'reference', 'scansGranted', 'status', 'userId'], `[٤] ${provider}: مفاتيح مستند الدفع كما كانت`);
    ok(added[0].c === 'payments' && added[0].doc.userId === 'real-uid' && added[0].doc.status === 'pending' && added[0].doc.plan === 'shop_basic', `[٤] ${provider}: payments/userId/status/plan`);
    eq(r.lines.length, 0, `[٤] ${provider}: لا سطر رفض`);
  }

  // ٥ غير المجهول بخطة فاسدة: كما كان (invalid-argument) — الفحص الجديد لا يغيّر ترتيب ما بعده
  reset();
  {
    const r = await call({uid: 'real-uid', token: tok('google.com')}, {plan: 'no-such-plan'});
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'invalid-argument' && r.thrown.message === 'خطة غير صالحة', '[٥] خطة غير صالحة من حساب مسجَّل: كما كان');
    eq(added.length, 0, '[٥] ولا كتابة');
  }

  console.log(`requestPaymentAnonymous.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
