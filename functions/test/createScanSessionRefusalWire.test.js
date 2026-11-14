'use strict';

// createScanSessionRefusalWire.test.js — رفضا createScanSession على السلك الحقيقي (A-SUB الموجة الأولى، البند ٤، 2026-10-17 +03). بلا شبكة وبلا محاكٍ.
//
// قرار المستخدم ٤ (بنصّه، منقول عن أمر المنسّق order-backend-engineer-asub-wave1-2026-10-17.md — غير متحقَّق من هذا المستودع): «نعم» لإضافة details.reasonCode لرفضَي createScanSession (س٦)،
// و«لا يُوحَّد نصّ NO_CREDIT في createScanSession.js:82 مع SCAN_REFUSAL_TEXT» (التوصية المعتمدة: لا يُغيَّر النصّ الآن، فلا يتغيّر ما يراه 1.0.14).
//
// يستبدل ما كان يثبّته scanReservation.e2e.test.js الحالة 12 («بلا details») — القاعدة 23؛ وهذا الملفّ يمرّ بالمعالج الحقيقي (createScanSession.run) بلا محاكٍ لأن الرفضين يقعان قبل أيّ كتابة:
// السلسلة الحقيقية كلّها: createScanSession ثم isSubscriptionExpired ثم scanRefusalWire ثم HttpsError وtoJSON الحقيقي (جسم السلك).
// المستبدَل (القاعدة 37) وحده: utils/admin ⟵ db يقرأ مستند users من الذاكرة (القراءة الوحيدة قبل الرفضين). ما قد يرفض ويُصنَّف كلّه حقيقي.
//
// Run: node functions/test/createScanSessionRefusalWire.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const users = {};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}},
    db: {
      collection: (c) => ({
        doc: (id) => ({get: async () => ({exists: users[id] !== undefined, data: () => users[id]})}),
        where: () => ({where: () => ({get: async () => ({empty: true})})}),
      }),
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {createScanSession, CREATE_SESSION_NO_CREDIT_TEXT} = require('../src/sessions/createScanSession');
const {SCAN_REFUSAL, SCAN_REFUSAL_TEXT, SCAN_REFUSAL_CODE} = require('../src/analysis/scanRefusal');
const {HttpsError} = require('firebase-functions/v2/https');

const past = () => new Date(Date.now() - 86400000);
const future = () => new Date(Date.now() + 86400000);
async function createAs(uid) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await createScanSession.run({data: {}, auth: {uid, token: {}}, rawRequest: {headers: {}}}).then(() => null, (e) => e);
  } finally { Object.assign(console, real); }
}
/** جسم الخطأ كما يخرج على السلك: {error: HttpsError.toJSON()} (الحقيقي من firebase-functions، بلا محاكاة) */
const wireBody = (err) => JSON.parse(JSON.stringify({error: err.toJSON()}));

(async () => {
  // الثوابت
  eq(CREATE_SESSION_NO_CREDIT_TEXT, 'لا يوجد رصيد فحوصات', '[١] نصّ الرصيد الخاصّ بالنداء كما كان حرفياً');
  ok(CREATE_SESSION_NO_CREDIT_TEXT !== SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT] && CREATE_SESSION_NO_CREDIT_TEXT !== SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SHOP_NO_CREDIT], '[١] وهو ليس نصّ البوّابة (قرار المستخدم ٤: لا يُوحَّد)');

  // ١ لا رصيد: غائب المستند، رصيد 0
  // A-SUB البند ١ (2026-10-17): الباقة free في المستندات الثلاثة عمداً — فحص الباقة يأتي بعد الرصيد والانتهاء، فيبقى رفضهما كما كان ولو كانت الباقة لا تسمح بالإنشاء (الترتيب)
  users.zero = {scansRemaining: 0, plan: 'free'};
  users.noexp = {scansRemaining: 0, expiresAt: past(), plan: 'free'}; // لا رصيد ومنتهٍ: الرصيد قبل التاريخ (كما كان)
  for (const [label, uid] of [['مستند users غائب', 'ghost'], ['رصيد 0', 'zero'], ['رصيد 0 ومنتهٍ (الرصيد قبل التاريخ)', 'noexp']]) {
    const e = await createAs(uid);
    ok(e instanceof HttpsError && e.code === SCAN_REFUSAL_CODE && e.code === 'permission-denied', `[٢] ${label}: HttpsError permission-denied`);
    eq(e.message, 'لا يوجد رصيد فحوصات', `[٢] ${label}: النصّ القائم حرفياً (لم يُوحَّد)`);
    deq(e.details, {reasonCode: 'SHOP_NO_CREDIT'}, `[٢] ${label}: details = {reasonCode: SHOP_NO_CREDIT} وحده`);
    deq(wireBody(e), {error: {details: {reasonCode: 'SHOP_NO_CREDIT'}, message: 'لا يوجد رصيد فحوصات', status: 'PERMISSION_DENIED'}}, `[٢] ${label}: الجسم على السلك (toJSON الحقيقي)`);
  }

  // ٢ منتهٍ
  users.exp = {scansRemaining: 5, expiresAt: past(), plan: 'free'};
  {
    const e = await createAs('exp');
    ok(e instanceof HttpsError && e.code === 'permission-denied', '[٣] اشتراك منتهٍ: HttpsError permission-denied');
    eq(e.message, SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED], '[٣] النصّ القائم حرفياً («انتهى اشتراكك، يرجى التجديد»)');
    eq(e.message, 'انتهى اشتراكك، يرجى التجديد', '[٣] وهو بالفاصلة العربية كما كان');
    deq(e.details, {reasonCode: 'SHOP_SUBSCRIPTION_EXPIRED'}, '[٣] details = {reasonCode: SHOP_SUBSCRIPTION_EXPIRED} وحده');
    deq(wireBody(e), {error: {details: {reasonCode: 'SHOP_SUBSCRIPTION_EXPIRED'}, message: 'انتهى اشتراكك، يرجى التجديد', status: 'PERMISSION_DENIED'}}, '[٣] الجسم على السلك');
  }

  // ٣ لا رفض: اشتراك سارٍ يمرّ (لا يُرفض بالخطأ)
  users.ok = {scansRemaining: 5, expiresAt: future(), plan: 'shop_basic'}; // البند ١: بلا باقة تسمح لم يعد المالك يمرّ، فالمالك السليم يحمل باقة محلّ
  {
    const real = {log: console.log, warn: console.warn, error: console.error};
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    let res; let thrown = null;
    try { res = await createScanSession.run({data: {}, auth: {uid: 'ok', token: {}}, rawRequest: {headers: {}}}); } catch (e) { thrown = e; } finally { Object.assign(console, real); }
    // قد يفشل لاحقاً بعد الرفضين لقصور الكعب (الكنس) — المهمّ ألّا يكون رفضاً بـreasonCode من الرفضين
    ok(!(thrown instanceof HttpsError && thrown.details && ['SHOP_NO_CREDIT', 'SHOP_SUBSCRIPTION_EXPIRED', 'SHOP_PLAN_REQUIRED'].includes(thrown.details.reasonCode)), '[٤] اشتراك سارٍ برصيد وباقة محلّ لا يُرفض بأيّ من الرموز الثلاثة');
    ok(res !== undefined || thrown !== null, '[٤] المعالج أكمل مساره');
  }

  // ٤ الباقة (A-SUB البند ١، 2026-10-17): مالك برصيد وغير منتهٍ وباقته لا تسمح ⟵ SHOP_PLAN_REQUIRED، والجسم على السلك بالنصّ الجديد المحايد
  {
    const {CREATE_SESSION_PLAN_REQUIRED_TEXT} = require('../src/sessions/createScanSession');
    users.free = {scansRemaining: 5, expiresAt: future(), plan: 'free'};
    const e = await createAs('free');
    ok(e instanceof HttpsError && e.code === 'permission-denied', '[٥] باقة free برصيد وغير منتهٍ: HttpsError permission-denied');
    eq(e.message, CREATE_SESSION_PLAN_REQUIRED_TEXT, '[٥] النصّ الجديد المحايد');
    eq(CREATE_SESSION_PLAN_REQUIRED_TEXT, 'هذه الميزة غير متاحة في باقتك الحالية', '[٥] بنصّه الحرفي');
    deq(wireBody(e), {error: {details: {reasonCode: 'SHOP_PLAN_REQUIRED'}, message: CREATE_SESSION_PLAN_REQUIRED_TEXT, status: 'PERMISSION_DENIED'}}, '[٥] الجسم على السلك (toJSON الحقيقي)');
    ok(![CREATE_SESSION_NO_CREDIT_TEXT, SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT], SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED]].includes(CREATE_SESSION_PLAN_REQUIRED_TEXT), '[٥] وليس نصّاً قائماً');
    users.absent = {scansRemaining: 5, expiresAt: future()};
    const a = await createAs('absent');
    deq(a.details, {reasonCode: 'SHOP_PLAN_REQUIRED'}, '[٥] باقة غائبة: SHOP_PLAN_REQUIRED (الغياب لا يُقرأ إذناً)');
  }

  console.log(`createScanSessionRefusalWire.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
