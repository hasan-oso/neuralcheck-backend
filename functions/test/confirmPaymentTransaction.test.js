'use strict';

// confirmPaymentTransaction.test.js — confirmPayment معاملةً واحدة (البند ٣، 2026-10-17 +03). بلا شبكة وبلا محاكٍ وبلا نداء مزوّد.
//
// القرار (المنسّق، منقول من نصّ الأمر — غير متحقَّق منه هنا): معاملة واحدة db.runTransaction تقرأ (دفعة ثم مستخدم) قبل أيّ كتابة، تعيد فحص pending داخلها، ثم تكتب الدفعة والمستخدم معاً —
// **الحقول نفسها التي تكتبها اليوم بلا زيادة ولا نقصان** وتشمل ما يعيد بدء دورة التذكير. حالات صريحة (القاعدة 22) لـpayment.userId غائب ومستند المستخدم غير موجود: رفض مسمّى قبل أيّ كتابة.
// البريد/الإشعار بعد الالتزام وخارج المعاملة، وفشلهما لا يُلغي التأكيد. رموز الأخطاء ونصوصها وشكل الردّ {status, scansAdded} كما كانت.
//
// ما يثبته (المعالج الحقيقي confirmPayment.run؛ المستبدَل معلَن أدناه):
//   ١ مجموعة المفاتيح المكتوبة للدفعة والمستخدم = القائمة المثبَّتة أدناه حرفياً — وهي ما تكتبه الشيفرة **القديمة** (قيس بتشغيل هذا الملفّ على نسخة HEAD السابقة: CONFIRM_PAYMENT_MODULE).
//   ٢ الكتابة داخل معاملة واحدة لا خارجها، والقراءتان (الدفعة ثم المستخدم) قبل أيّ كتابة، وكتابتان لا غير.
//   ٣ الردّ والأخطاء كما كانت (not-found «الدفعة غير موجودة»، failed-precondition «الدفعة ليست معلقة»).
//   ٤ الحالتان الصريحتان: بلا كتابة، وبرمز مسمّى، وسطر بمعرّفات مُهشَّرة.
//   ٥ البريد وFCM بعد الالتزام؛ وفشلهما لا يُلغي التأكيد ولا الكتابة.
//   ٦ تأكيدان متزامنان على db بنموذج معاملة تفاؤلية (إعادة المحاولة عند التعارض — **نموذج المختبِر لا Firestore**؛ الحقيقي في confirmPaymentRace.e2e.test.js على المحاكي) ⟵ منحة واحدة.
// المستبدَل (القاعدة 37) معلَن: utils/admin ⟵ db في الذاكرة بمعاملة تفاؤلية، وadmin.messaging، وgetMailTransporter.
//
// CONFIRM_PAYMENT_MODULE=<مسار>: يشغّل الاختبار على نسخة أخرى من المعالج (كيف قيست «قبل»: نسخة من HEAD السابق بمسارات require مطلقة). بلا المتغيّر: المعالج الحالي.
// Run: node functions/test/confirmPaymentTransaction.test.js

const assert = require('assert');
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ─── db في الذاكرة بمعاملة تفاؤلية (الاستبدال المُعلَن) ───
const store = {};
const versions = {};
let events = [];
let directWrites = []; // ref.update/set خارج معاملة
let commits = []; // [{path, fields}] من معاملات ناجحة
const SENTINEL = {TS: {__ts: true}};
const FieldValue = {serverTimestamp: () => SENTINEL.TS, increment: (x) => ({__inc: x}), delete: () => ({__del: true})};
const applyFields = (path, fields) => {
  const cur = {...(store[path] || {})};
  for (const [k, v] of Object.entries(fields)) {
    if (v && v.__del) delete cur[k];
    else if (v && v.__inc !== undefined) cur[k] = (typeof cur[k] === 'number' ? cur[k] : 0) + v.__inc;
    else if (v === SENTINEL.TS) cur[k] = 'SERVER-TS';
    else cur[k] = v;
  }
  store[path] = cur;
  versions[path] = (versions[path] || 0) + 1;
};
const tick = () => new Promise((r) => setImmediate(r));
const snapOf = (path, id) => ({id, exists: store[path] !== undefined, data: () => (store[path] === undefined ? undefined : JSON.parse(JSON.stringify(store[path])))});
function refOf(c, id) {
  const path = `${c}/${id}`;
  return {
    id, path,
    get: async () => { await tick(); return snapOf(path, id); },
    update: async (fields) => {
      await tick();
      if (store[path] === undefined) throw Object.assign(new Error(`NOT_FOUND: no document to update: ${path}`), {code: 5});
      directWrites.push({path, fields}); events.push(`direct-write:${path}`); applyFields(path, fields);
    },
    set: async (fields) => { await tick(); directWrites.push({path, fields}); events.push(`direct-write:${path}`); applyFields(path, fields); },
  };
}
const fakeDb = {
  collection: (c) => ({doc: (id) => {
    if (typeof id !== 'string' || id === '') throw new Error(`Value for argument "documentPath" is not a valid resource path (${String(id)})`);
    return refOf(c, id);
  }}),
  runTransaction: async (cb) => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      events.push('tx-start');
      const readVersions = {};
      const staged = [];
      const tx = {
        get: async (ref) => {
          if (staged.length > 0) throw new Error('Firestore transactions require all reads to be executed before all writes.');
          await tick();
          readVersions[ref.path] = versions[ref.path] || 0;
          events.push(`tx-read:${ref.path}`);
          return snapOf(ref.path, ref.id);
        },
        update: (ref, fields) => {
          if (store[ref.path] === undefined) throw Object.assign(new Error(`NOT_FOUND: no document to update: ${ref.path}`), {code: 5});
          staged.push({path: ref.path, fields});
        },
        set: () => { throw new Error('TRAP: tx.set not expected'); },
      };
      let result;
      try {
        result = await cb(tx);
      } catch (e) { events.push('tx-abort'); throw e; }
      await tick();
      const conflict = Object.entries(readVersions).some(([p, v]) => (versions[p] || 0) !== v);
      if (conflict) { events.push('tx-conflict-retry'); continue; }
      for (const w of staged) { applyFields(w.path, w.fields); commits.push(w); }
      events.push('tx-commit');
      return result;
    }
    throw new Error('transaction: too many retries');
  },
};
let mailThrow = null;
let fcmThrow = null;
let mailsSent = 0;
let fcmSent = 0;
const fakeAdmin = {
  firestore: {FieldValue},
  messaging: () => ({send: async () => { events.push('fcm-send'); if (fcmThrow) throw fcmThrow; fcmSent++; }}),
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: fakeAdmin, db: fakeDb, ADMIN_EMAILS: [], requireAdmin: () => {}, isVerifiedAdmin: () => false},
};
const emailsPath = require.resolve('../src/utils/emails');
const realEmails = require('../src/utils/emails');
require.cache[emailsPath].exports = {...realEmails, getMailTransporter: () => ({sendMail: async () => { events.push('mail-send'); if (mailThrow) throw mailThrow; mailsSent++; return {}; }})};

const modulePath = process.env.CONFIRM_PAYMENT_MODULE || '../src/payments/confirmPayment';
const confirmModule = require(modulePath);
const {confirmPayment} = confirmModule;
const {HttpsError} = require('firebase-functions/v2/https');
const {PLANS} = require('../src/utils/plans');

const reset = () => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(versions)) delete versions[k];
  events = []; directWrites = []; commits = []; mailThrow = null; fcmThrow = null; mailsSent = 0; fcmSent = 0;
};
const allWrites = () => [...directWrites, ...commits];
// التقاط الطباعة قابل لإعادة الدخول (نداءان متزامنان يتشاركان الالتقاط ولا يُفسد أحدهما استعادة الآخر).
let captureDepth = 0;
let realConsole = null;
let sink = [];
async function call(paymentId) {
  if (captureDepth++ === 0) {
    realConsole = {log: console.log, warn: console.warn, error: console.error};
    const push = (...a) => sink.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    console.log = push; console.warn = push; console.error = push;
    sink = [];
  }
  const from = sink.length;
  let value; let thrown = null;
  try { value = await confirmPayment.run({auth: {uid: 'admin', token: {}}, data: {paymentId}}); } catch (e) { thrown = e; } finally {
    if (--captureDepth === 0) Object.assign(console, realConsole);
  }
  return {value, thrown, lines: sink.slice(from)};
}
const seed = (payment, user) => {
  store['payments/p1'] = payment; versions['payments/p1'] = 1;
  if (user !== undefined) { store['users/u1'] = user; versions['users/u1'] = 1; }
};
const PAYMENT = {userId: 'u1', plan: 'shop_basic', scansGranted: 50, amountUsd: 10, status: 'pending'};
const USER = {scansRemaining: 3, scansTotal: 10, plan: 'free', isActive: false, name: 'N', email: 'u1@example.invalid', fcmToken: 'tok', language: 'ar',
  subExpiryEmailSent: true, subExpiryFcmDate: '2026-01-01', subExpiredNotified: true};

(async () => {
  // ═══ ١ — المفاتيح المكتوبة (مثبَّتة حرفياً؛ ما تكتبه الشيفرة القديمة) ═══
  const PAYMENT_KEYS = ['confirmedAt', 'discountPercent', 'status'];
  const USER_KEYS = ['expiresAt', 'isActive', 'plan', 'scansRemaining', 'scansTotal', 'subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate'];
  {
    reset(); seed({...PAYMENT, discountPercent: 20}, {...USER});
    const r = await call('p1');
    ok(!r.thrown, `[١] تأكيد ناجح (${r.thrown && r.thrown.message})`);
    const writes = allWrites();
    eq(writes.length, 2, '[١] كتابتان لا غير (الدفعة والمستخدم)');
    const wp = writes.find((w) => w.path === 'payments/p1');
    const wu = writes.find((w) => w.path === 'users/u1');
    ok(wp && wu, '[١] كتابة لكلٍّ من الدفعة والمستخدم');
    deq(Object.keys(wp.fields).sort(), PAYMENT_KEYS, '[١] مفاتيح الدفعة المكتوبة = القائمة المثبَّتة (status, discountPercent, confirmedAt)');
    deq(Object.keys(wu.fields).sort(), USER_KEYS, '[١] مفاتيح المستخدم المكتوبة = القائمة المثبَّتة (الخمسة + أعلام التذكير الثلاثة)');
    eq(wp.fields.status, 'confirmed', '[١] status');
    eq(wp.fields.discountPercent, 20, '[١] discountPercent يُحفظ من الدفعة');
    ok(wp.fields.confirmedAt === SENTINEL.TS, '[١] confirmedAt = serverTimestamp()');
    deq([wu.fields.plan, wu.fields.scansRemaining, wu.fields.isActive], ['shop_basic', 50, true], '[١] plan وscansRemaining (مطلق = المنحة) وisActive');
    deq(wu.fields.scansTotal, {__inc: 50}, '[١] scansTotal = increment(المنحة)');
    ok(wu.fields.expiresAt instanceof Date && Math.abs(wu.fields.expiresAt.getTime() - (Date.now() + 30 * 86400000)) < 5000, '[١] expiresAt = الآن + 30 يوماً');
    deq([wu.fields.subExpiryEmailSent, wu.fields.subExpiryFcmDate, wu.fields.subExpiredNotified], [{__del: true}, {__del: true}, {__del: true}], '[١] أعلام التذكير الثلاثة تُمسَح (دورة جديدة)');
    deq(r.value, {status: 'confirmed', scansAdded: 50}, '[٣] الردّ {status, scansAdded} كما كان');
    // الحالة بعد الكتابة
    deq([store['users/u1'].scansRemaining, store['users/u1'].scansTotal, 'subExpiryEmailSent' in store['users/u1']], [50, 60, false], '[١] حالة المستخدم بعد الكتابة');
  }
  // اللقطة المخزَّنة وارتداد PLANS
  for (const [label, payment, want] of [
    ['scansGranted رقم', {...PAYMENT, scansGranted: 7}, 7],
    ['بلا scansGranted وباقة معروفة ⟵ PLANS', (() => { const p = {...PAYMENT, plan: 'shop_pro'}; delete p.scansGranted; return p; })(), PLANS.shop_pro.scans],
    ['بلا scansGranted وباقة مجهولة ⟵ 1', (() => { const p = {...PAYMENT, plan: 'weird'}; delete p.scansGranted; return p; })(), 1],
  ]) {
    reset(); seed(payment, {...USER});
    const r = await call('p1');
    eq(r.value && r.value.scansAdded, want, `[١] المنحة: ${label}`);
    eq(store['users/u1'].scansRemaining, want, `[١] والرصيد المكتوب: ${label}`);
  }

  // ═══ ٢ — المعاملة: القراءتان قبل الكتابة، والكتابة داخلها وحدها ═══
  {
    reset(); seed({...PAYMENT}, {...USER});
    await call('p1');
    eq(directWrites.length, 0, '[٢] لا كتابة خارج معاملة (ref.update/set)');
    eq(commits.length, 2, '[٢] كتابتان داخل معاملة واحدة');
    const i = (e) => events.indexOf(e);
    ok(i('tx-read:payments/p1') >= 0 && i('tx-read:users/u1') > i('tx-read:payments/p1') && i('tx-commit') > i('tx-read:users/u1'), `[٢] الدفعة تُقرأ ثم المستخدم ثم الالتزام: ${JSON.stringify(events)}`);
    eq(events.filter((e) => e === 'tx-start').length, 1, '[٢] معاملة واحدة بلا إعادة (بلا تزامن)');
  }

  // ═══ ٣ — الأخطاء القائمة كما كانت ═══
  {
    reset();
    const r = await call('nope');
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'not-found' && r.thrown.message === 'الدفعة غير موجودة', '[٣] دفعة غير موجودة: not-found «الدفعة غير موجودة»');
    eq(allWrites().length, 0, '[٣] بلا كتابة');
    for (const status of ['confirmed', 'rejected', undefined, 'PENDING']) {
      reset(); seed({...PAYMENT, status}, {...USER});
      const r2 = await call('p1');
      ok(r2.thrown instanceof HttpsError && r2.thrown.code === 'failed-precondition' && r2.thrown.message === 'الدفعة ليست معلقة', `[٣] status=${String(status)}: failed-precondition «الدفعة ليست معلقة»`);
      eq(allWrites().length, 0, `[٣] status=${String(status)}: بلا كتابة`);
    }
    reset(); seed({...PAYMENT}, {...USER});
    const a = await call('p1'); const b = await call('p1');
    ok(!a.thrown && b.thrown && b.thrown.code === 'failed-precondition' && b.thrown.message === 'الدفعة ليست معلقة', '[٣] التأكيد الثاني المتتابع: failed-precondition');
    eq(store['users/u1'].scansTotal, 60, '[٣] والمنحة مرّة واحدة (10 + 50)');
  }

  // ═══ ٤ — الحالتان الصريحتان: رفض مسمّى قبل أيّ كتابة، بمعرّفات مُهشَّرة ═══
  for (const [label, userId] of [['غائب', undefined], ['null', null], ['نصّ فارغ', ''], ['غير نصّ', 12345]]) {
    reset(); const p = {...PAYMENT, userId}; if (userId === undefined) delete p.userId; seed(p);
    const r = await call('p1');
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'failed-precondition' && r.thrown.details && r.thrown.details.reasonCode === 'PAYMENT_USER_ABSENT',
        `[٤] payment.userId ${label}: failed-precondition برمز PAYMENT_USER_ABSENT (${r.thrown && r.thrown.code}/${r.thrown && r.thrown.message})`);
    eq(r.thrown.message, 'الدفعة بلا مستخدم مرتبط', `[٤] النصّ (${label})`);
    eq(allWrites().length, 0, `[٤] بلا أيّ كتابة (${label})`);
    eq(store['payments/p1'].status, 'pending', `[٤] الدفعة تبقى pending (${label})`);
    ok(r.lines.some((l) => /^\[confirmPayment\] refused reason=PAYMENT_USER_ABSENT paymentId=#[0-9a-f]{12} userIdState=(absent|null|empty|invalid-type)$/.test(l)) && !r.lines.join('\n').includes('p1'), `[٤] سطر مسمّى بمعرّف مُهشَّر (${label}): ${JSON.stringify(r.lines)}`);
  }
  {
    reset(); seed({...PAYMENT, userId: 'u-secret-77'}); // بلا مستند مستخدم
    const r = await call('p1');
    ok(r.thrown instanceof HttpsError && r.thrown.code === 'not-found' && r.thrown.details && r.thrown.details.reasonCode === 'PAYMENT_USER_NOT_FOUND' && r.thrown.message === 'مستخدم الدفعة غير موجود',
        `[٤] مستند المستخدم غير موجود: not-found برمز PAYMENT_USER_NOT_FOUND (${r.thrown && r.thrown.code}/${r.thrown && r.thrown.message})`);
    eq(allWrites().length, 0, '[٤] بلا أيّ كتابة (لا تُؤكَّد الدفعة ثم تنهار كتابة المستخدم)');
    eq(store['payments/p1'].status, 'pending', '[٤] الدفعة تبقى pending');
    ok(store['users/u-secret-77'] === undefined, '[٤] ولا يُنشأ مستند مستخدم');
    ok(r.lines.some((l) => /^\[confirmPayment\] refused reason=PAYMENT_USER_NOT_FOUND paymentId=#[0-9a-f]{12} userId=#[0-9a-f]{12}$/.test(l)) && !r.lines.join('\n').includes('u-secret-77') && !r.lines.join('\n').includes('p1'),
        `[٤] السطر بمعرّفين مُهشَّرين: ${JSON.stringify(r.lines)}`);
  }

  // ═══ ٥ — الإشعارات بعد الالتزام، وفشلها لا يُلغي التأكيد ═══
  {
    reset(); seed({...PAYMENT}, {...USER});
    const r = await call('p1');
    const i = (e) => events.indexOf(e);
    ok(!r.thrown && i('tx-commit') >= 0 && i('mail-send') > i('tx-commit') && i('fcm-send') > i('tx-commit'), `[٥] البريد وFCM بعد الالتزام (خارج المعاملة): ${JSON.stringify(events)}`);
    deq([mailsSent, fcmSent], [1, 1], '[٥] إشعار واحد من كلٍّ');
    reset(); seed({...PAYMENT}, {...USER}); mailThrow = new Error('smtp down'); fcmThrow = new Error('fcm down');
    const r2 = await call('p1');
    ok(!r2.thrown, `[٥] فشل البريد وFCM: التأكيد لا يُلغى (${r2.thrown && r2.thrown.message})`);
    deq(r2.value, {status: 'confirmed', scansAdded: 50}, '[٥] والردّ كما هو');
    deq([store['payments/p1'].status, store['users/u1'].scansRemaining], ['confirmed', 50], '[٥] والكتابتان باقيتان');
    reset(); seed({...PAYMENT}, {scansRemaining: 0, scansTotal: 0, name: 'NoContact'});
    const r3 = await call('p1');
    ok(!r3.thrown && mailsSent === 0 && fcmSent === 0, '[٥] مستخدم بلا بريد ولا رمز FCM: لا إرسال ولا فشل');
  }

  // ═══ ٦ — تأكيدان متزامنان (نموذج المختبِر): منحة واحدة ═══
  for (let round = 0; round < 5; round++) {
    reset(); seed({...PAYMENT}, {...USER});
    const settled = await Promise.allSettled([call('p1'), call('p1')]);
    const results = settled.map((s) => s.value);
    const okCount = results.filter((r) => !r.thrown).length;
    eq(okCount, 1, `[٦] الجولة ${round}: تأكيد واحد ينجح (${JSON.stringify(results.map((r) => r.thrown ? r.thrown.code : 'ok'))})`);
    const loser = results.find((r) => r.thrown);
    ok(loser.thrown instanceof HttpsError && loser.thrown.code === 'failed-precondition' && loser.thrown.message === 'الدفعة ليست معلقة', `[٦] الجولة ${round}: الثاني failed-precondition «الدفعة ليست معلقة»`);
    eq(store['users/u1'].scansTotal, 60, `[٦] الجولة ${round}: scansTotal = 10 + 50 مرّة واحدة`);
    eq(allWrites().length, 2, `[٦] الجولة ${round}: كتابتان فقط (لا منحة ثانية)`);
    eq(mailsSent, 1, `[٦] الجولة ${round}: إشعار واحد`);
  }

  console.log(`confirmPaymentTransaction.test.js: ${n}/${n} assertions passed${process.env.CONFIRM_PAYMENT_MODULE ? ` (على النسخة ${process.env.CONFIRM_PAYMENT_MODULE})` : ''}`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
