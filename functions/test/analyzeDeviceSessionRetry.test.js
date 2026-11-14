'use strict';

// analyzeDeviceSessionRetry.test.js — analyzeDevice على الجلسة: التقرير المخزَّن أولاً مع reasonCode (A-SUB الموجة الأولى، البند ١٢، 2026-10-17 +03). بلا شبكة وبلا محاكٍ وبلا نداء نموذج.
//
// قرار المستخدم ١٢ (بنصّه، منقول عن أمر المنسّق order-backend-engineer-asub-wave1-2026-10-17.md — غير متحقَّق من هذا المستودع): «التقرير المخزَّن أولاً مع reasonCode» — لجلسة completed ضاع ردّها: يُقدَّم
// التقرير المخزَّن لصاحب الطلب المشروع بدل الرفض، ويُضاف reasonCode لرفضَي analyzeDevice على الجلسة (س٢: analyzeDevice.js:392-394 و:407-411).
//
// ما يثبته (المعالج الحقيقي analyzeDevice.run، والحرّاس كلّها حقيقية: isLegitCompletedSessionRetry · sessionRoleOf · sessionExpiryRefusal · ownerCheckState · classifyStatus):
//   ١ جلسة completed + تقرير مخزَّن + طالب مشروع (المنضمّ أو المالك، scanId = scanId الجلسة، userId في التقرير = ownerId) ⟵ يُقدَّم الردّ المخزَّن بلا أيّ مجموعة غير scanSessions وreports، وبلا كتابة.
//   ٢ جلسة completed بلا تقرير ⟵ رفض SESSION_COMPLETED. وجلسة غير completed ⟵ رفض بسببه المسمّى (cancelled/expired/pending/مجهولة/انقضاء expiresAt/غياب expiresAt).
//   ٣ طالب غير مشروع ⟵ يُرفض ولا يُسرَّب: غير طرف الجلسة، وبلا auth، وscanId غير scanId الجلسة، وتقرير مخزَّن ملكيته لغير مالك الجلسة. **ولا يُقرأ التقرير** إلا بعد تحقّق الطرف وscanId.
//   ٤ الرمز والنصّ كما كانا حرفياً (permission-denied «جلسة الفحص غير صالحة»، failed-precondition «الجلسة منتهية»)، ويُضاف details.reasonCode وحده. ولا تُكشَف حالة جلسة لغير طرفيها (NOT_PARTICIPANT).
//   ٥ لا تغيّر في ما قبلها: جلسة scanning صالحة بتقرير مخزَّن ⟵ تُردّ كما كانت وتُكتب «اكتملت» (المسار ب)؛ والفحص الشخصي بتقرير مخزَّن يُردّ كما كان.
// المستبدَل (القاعدة 37) وحده: utils/admin ⟵ db في الذاكرة بمجموعتين فقط؛ أيّ مجموعة أخرى تُمسّ تُسجَّل وترمي (فاختبار «لا فحص جديد» يقيس المجموعات الممسوسة).
//
// Run: node functions/test/analyzeDeviceSessionRetry.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

// ─── db في الذاكرة ───
const store = {};
const touched = new Set();
let transactions = 0;
const updates = [];
const key = (c, id) => `${c}/${id}`;
const ALLOWED = new Set(['scanSessions', 'reports']);
function refOf(c, id) {
  return {
    id, path: key(c, id),
    get: async () => ({id, exists: store[key(c, id)] !== undefined, data: () => store[key(c, id)], ref: refOf(c, id)}),
  };
}
const fakeDb = {
  collection: (c) => {
    touched.add(c);
    if (!ALLOWED.has(c)) throw new Error(`TRAP: collection "${c}" must not be touched on this path`);
    return {doc: (id) => refOf(c, id)};
  },
  runTransaction: async (cb) => {
    transactions++;
    return cb({
      get: async (ref) => ref.get(),
      update: (ref, fields) => { updates.push({path: ref.path, fields}); store[ref.path] = {...store[ref.path], ...fields}; },
      set: () => { throw new Error('TRAP: tx.set must not be called here'); },
    });
  },
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}}, db: fakeDb, ADMIN_EMAILS: [], requireAdmin: () => {}},
};

const {analyzeDevice} = require('../src/analysis/analyzeDevice');
const {HttpsError} = require('firebase-functions/v2/https');

const reset = () => { for (const k of Object.keys(store)) delete store[k]; touched.clear(); transactions = 0; updates.length = 0; };
const past = () => new Date(Date.now() - 3600000);
const future = () => new Date(Date.now() + 3600000);
const MARKER = 'STORED-REPORT-MARKER';
const seedSession = (id, fields) => { store[key('scanSessions', id)] = {ownerId: 'owner', status: 'completed', joinedBy: 'joiner', scanId: 'scan-A', expiresAt: future(), ...fields}; };
const seedReport = (id, fields) => { store[key('reports', id)] = {userId: 'owner', pipeline: 'seeded_test', aiResponse: {grade: 'A', marker: MARKER}, ...fields}; };

async function call(data, uid) {
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' ')); console.error = (...a) => lines.push(a.join(' '));
  let value; let thrown = null;
  try {
    value = await analyzeDevice.run({data, auth: uid ? {uid, token: {}} : undefined, rawRequest: {headers: {}}});
  } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {value, thrown, lines};
}
const refusal = (r, code, message, reason, label) => {
  ok(r.thrown instanceof HttpsError && r.thrown.code === code && r.thrown.message === message, `${label}: ${code} «${message}» (الرمز والنصّ كما كانا حرفياً) — ${r.thrown && r.thrown.code}/${r.thrown && r.thrown.message}`);
  deq(r.thrown.details, {reasonCode: reason}, `${label}: details = {reasonCode: ${reason}} وحده`);
  ok(!JSON.stringify(r.thrown.toJSON()).includes(MARKER), `${label}: لا شيء من التقرير المخزَّن في الخطأ`);
};
const FP = {device: {model: 'M'}};

(async () => {
  // ═══ ١ — جلسة completed + تقرير مخزَّن + طالب مشروع ⟵ يُقدَّم ═══
  for (const [label, uid] of [['المنضمّ', 'joiner'], ['المالك', 'owner']]) {
    reset(); seedSession('S1', {}); seedReport('scan-A', {});
    const r = await call({scanId: 'scan-A', sessionId: 'S1', fingerprint: FP}, uid);
    ok(!r.thrown, `[١] ${label}: لا رفض (${r.thrown && r.thrown.message})`);
    deq(r.value, {grade: 'A', marker: MARKER}, `[١] ${label}: الردّ هو المخزَّن بعينه`);
    deq([...touched].sort(), ['reports', 'scanSessions'], `[١] ${label}: لم تُمسّ مجموعة غير scanSessions وreports (لا users ولا scanClaims: لا فحص جديد ولا حجز)`);
    eq(transactions, 0, `[١] ${label}: لا معاملة ولا كتابة (لا انتقال من نهائية إلى نهائية)`);
    ok(r.lines.some((l) => l.startsWith('[analyzeDevice] completed-session retry: the stored report is served session=#') && !l.includes('S1') && !l.includes('scan-A')), `[١] ${label}: سطر مسمّى بمعرّفين مُهشَّرين`);
    ok(!r.lines.some((l) => l.includes('completed-skipped')), `[١] ${label}: ولا سطر اكتمال`);
  }
  // انقضى expiresAt بعد اكتمال الفحص: إعادة المحاولة المشروعة تُخدَم رغم ذلك (الانقضاء لا يُبطل ردّاً اكتمل قبله، كما لا مهلة لمسار التقرير المخزَّن الشخصي)، ولا تُكتب «منتهية»
  {
    reset(); seedSession('S1b', {expiresAt: past()}); seedReport('scan-A', {});
    const r = await call({scanId: 'scan-A', sessionId: 'S1b', fingerprint: FP}, 'joiner');
    ok(!r.thrown, `[١ج] completed وانقضى expiresAt: لا رفض (${r.thrown && r.thrown.message})`);
    deq(r.value, {grade: 'A', marker: MARKER}, '[١ج] والردّ المخزَّن');
    eq(updates.length + transactions, 0, '[١ج] بلا كتابة ولا معاملة (لا تُسجَّل «منتهية» فوق «اكتملت»)');
    eq(store[key('scanSessions', 'S1b')].status, 'completed', '[١ج] والحالة تبقى completed');
  }
  // الردّ لجلسة V7: يُحذف منه ما يحذفه المسار القائم (strip) — يُثبَّت بأنه يمرّ بالمسار القائم نفسه: pipeline غير V7 يُردّ كما هو (أعلاه)

  // ═══ ٢ — completed بلا تقرير، وكل ما ليس scanning ═══
  {
    reset(); seedSession('S2', {});
    const r = await call({scanId: 'scan-A', sessionId: 'S2', fingerprint: FP}, 'joiner');
    refusal(r, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_COMPLETED', '[٢أ] completed بلا تقرير مخزَّن');
    deq([...touched].sort(), ['reports', 'scanSessions'], '[٢أ] قُرئ التقرير فقط ولم يُمسّ غيره');
  }
  for (const [label, fields, uid, reason] of [
    ['cancelled (المنضمّ)', {status: 'cancelled'}, 'joiner', 'SESSION_CANCELLED'],
    ['expired (المالك)', {status: 'expired'}, 'owner', 'SESSION_EXPIRED'],
    ['pending (المالك: لم ينضمّ أحد)', {status: 'pending', joinedBy: undefined, scanId: null}, 'owner', 'SESSION_NOT_STARTED'],
    ['حالة لا تعرفها الشيفرة', {status: 'done'}, 'joiner', 'SESSION_STATUS_UNKNOWN'],
    ['حالة غائبة', {status: undefined}, 'joiner', 'SESSION_STATUS_UNKNOWN'],
    ['completed وscanId الطلب ليس scanId الجلسة (طرف مشروع)', {status: 'completed', scanId: 'scan-OTHER'}, 'joiner', 'SESSION_COMPLETED'],
  ]) {
    reset(); seedSession('S3', fields); seedReport('scan-A', {});
    const r = await call({scanId: 'scan-A', sessionId: 'S3', fingerprint: FP}, uid);
    refusal(r, 'permission-denied', 'جلسة الفحص غير صالحة', reason, `[٢ب] ${label}`);
    ok(!touched.has('reports'), `[٢ب] ${label}: لا يُقرأ تقرير (الرفض قبل مسار التقرير المخزَّن)`);
    ok(!touched.has('users') && !touched.has('scanClaims'), `[٢ب] ${label}: لا users ولا scanClaims`);
  }
  // جلسة غير موجودة
  {
    reset();
    const r = await call({scanId: 'scan-A', sessionId: 'NOPE', fingerprint: FP}, 'joiner');
    refusal(r, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_NOT_PARTICIPANT', '[٢ج] جلسة غير موجودة (الرمز نفسه لغير الطرف: لا وسيط وجود)');
  }
  // انقضاء expiresAt لجلسة scanning
  {
    reset(); seedSession('S4', {status: 'scanning', expiresAt: past(), scanId: null});
    const r = await call({scanId: 'scan-B', sessionId: 'S4', fingerprint: FP}, 'joiner');
    refusal(r, 'failed-precondition', 'الجلسة منتهية', 'SESSION_EXPIRED', '[٢د] scanning وانقضى expiresAt (المنضمّ)');
    eq(updates.length, 1, '[٢د] وتُسجَّل «منتهية» كما كان (كتابة واحدة)');
    eq(store[key('scanSessions', 'S4')].status, 'expired', '[٢د] الحالة expired');
    reset(); seedSession('S5', {status: 'scanning', expiresAt: past(), scanId: null});
    const r2 = await call({scanId: 'scan-B', sessionId: 'S5', fingerprint: FP}, 'stranger');
    refusal(r2, 'failed-precondition', 'الجلسة منتهية', 'SESSION_NOT_PARTICIPANT', '[٢د] الانقضاء لغير طرف: NOT_PARTICIPANT');
    reset(); seedSession('S6', {status: 'scanning', expiresAt: undefined, scanId: null});
    const r3 = await call({scanId: 'scan-B', sessionId: 'S6', fingerprint: FP}, 'joiner');
    refusal(r3, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_EXPIRES_AT_INVALID', '[٢د] غياب expiresAt (المنضمّ): بلا كتابة');
    eq(updates.length, 0, '[٢د] غياب expiresAt بلا كتابة (القاعدة 22 كما كان)');
  }

  // ═══ ٣ — طالب غير مشروع: يُرفض ولا يُسرَّب ═══
  {
    reset(); seedSession('S7', {}); seedReport('scan-A', {});
    const r = await call({scanId: 'scan-A', sessionId: 'S7', fingerprint: FP}, 'stranger');
    refusal(r, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_NOT_PARTICIPANT', '[٣أ] مستدعٍ ليس مالكاً ولا منضمّاً');
    ok(!touched.has('reports'), '[٣أ] ولم يُقرأ التقرير أصلاً');

    reset(); seedSession('S7', {}); seedReport('scan-A', {});
    const r2 = await call({scanId: 'scan-A', sessionId: 'S7', fingerprint: FP}, null);
    refusal(r2, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_NOT_PARTICIPANT', '[٣ب] بلا auth');
    ok(!touched.has('reports'), '[٣ب] ولم يُقرأ التقرير');

    // طرف مشروع يطلب scanId آخر لتقرير موجود لغيره
    reset(); seedSession('S7', {}); seedReport('scan-A', {}); seedReport('scan-X', {userId: 'someone-else', aiResponse: {marker: 'OTHERS-REPORT'}});
    const r3 = await call({scanId: 'scan-X', sessionId: 'S7', fingerprint: FP}, 'joiner');
    refusal(r3, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_COMPLETED', '[٣ج] طرف مشروع يطلب scanId غير scanId جلسته');
    ok(!JSON.stringify(r3.thrown.toJSON()).includes('OTHERS-REPORT') && !touched.has('reports'), '[٣ج] ولا يُقرأ التقرير ولا يُسرَّب');

    // تقرير مخزَّن ملكيته لغير مالك الجلسة (scanId الجلسة يشير إلى تقرير غير ملكها)
    reset(); seedSession('S8', {}); seedReport('scan-A', {userId: 'someone-else'});
    const r4 = await call({scanId: 'scan-A', sessionId: 'S8', fingerprint: FP}, 'joiner');
    refusal(r4, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_COMPLETED', '[٣د] التقرير المخزَّن ليس لمالك الجلسة');
    ok(touched.has('reports'), '[٣د] قُرئ التقرير للمقارنة ولم يُردّ');

    // userId غائب في التقرير: لا يُقرأ الغياب مطابقةً (القاعدة 22)
    reset(); seedSession('S9', {}); seedReport('scan-A', {userId: undefined});
    const r5 = await call({scanId: 'scan-A', sessionId: 'S9', fingerprint: FP}, 'joiner');
    refusal(r5, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_COMPLETED', '[٣هـ] userId غائب في التقرير المخزَّن');

    // ownerId غائب في الجلسة
    reset(); seedSession('S10', {ownerId: undefined}); seedReport('scan-A', {userId: undefined});
    const r6 = await call({scanId: 'scan-A', sessionId: 'S10', fingerprint: FP}, 'joiner');
    refusal(r6, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_COMPLETED', '[٣و] ownerId غائب في الجلسة وuserId غائب في التقرير: لا تطابق بالغياب');

    // جلسة بلا joinedBy (انضمّ بلا هوية) وطالب بلا هوية
    reset(); seedSession('S11', {joinedBy: null}); seedReport('scan-A', {});
    const r7 = await call({scanId: 'scan-A', sessionId: 'S11', fingerprint: FP}, null);
    refusal(r7, 'permission-denied', 'جلسة الفحص غير صالحة', 'SESSION_NOT_PARTICIPANT', '[٣ز] joinedBy=null وطالب بلا هوية: غائب لا يساوي غائباً');
  }

  // ═══ ٥ — لا تغيّر في المسارات الأخرى ═══
  {
    // جلسة scanning صالحة بتقرير مخزَّن: تُردّ المخزَّنة ويُكتب «اكتملت» (المسار ب)
    reset(); seedSession('S12', {status: 'scanning', scanId: null}); seedReport('scan-B', {shortId: 'NC-AAAAAA', deviceModel: 'M'});
    const r = await call({scanId: 'scan-B', sessionId: 'S12', fingerprint: FP}, 'joiner');
    ok(!r.thrown, '[٥أ] scanning صالحة بتقرير مخزَّن: لا رفض');
    deq(r.value, {grade: 'A', marker: MARKER}, '[٥أ] الردّ المخزَّن كما كان');
    eq(store[key('scanSessions', 'S12')].status, 'completed', '[٥أ] وتُكتب «اكتملت» (المسار ب كما كان)');
    eq(store[key('scanSessions', 'S12')].scanId, 'scan-B', '[٥أ] وscanId على الجلسة');
    ok(r.lines.some((l) => l.startsWith('[sessionCompletion] completed path=cached-response')), '[٥أ] سطر المسار ب كما كان');
    ok(!r.lines.some((l) => l.includes('completed-session retry')), '[٥أ] ولا سطر إعادة المحاولة (ذاك لـcompleted فقط)');

    // الفحص الشخصي بتقرير مخزَّن (بلا sessionId): كما كان
    reset(); seedReport('scan-C', {});
    const r2 = await call({scanId: 'scan-C', fingerprint: FP}, 'owner');
    ok(!r2.thrown, '[٥ب] فحص شخصي بتقرير مخزَّن: لا رفض');
    deq(r2.value, {grade: 'A', marker: MARKER}, '[٥ب] الردّ المخزَّن كما كان');
    deq([...touched].sort(), ['reports'], '[٥ب] قراءة التقرير وحدها');
    eq(transactions, 0, '[٥ب] بلا معاملة');

    // بلا sessionId وبلا auth: كما كان
    reset();
    const r3 = await call({scanId: 'scan-C', fingerprint: FP}, null);
    ok(r3.thrown instanceof HttpsError && r3.thrown.code === 'unauthenticated' && r3.thrown.message === 'يجب تسجيل الدخول أو إدخال كود فحص', '[٥ج] بلا جلسة وبلا auth: كما كان');
  }

  console.log(`analyzeDeviceSessionRetry.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
