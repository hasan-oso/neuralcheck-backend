'use strict';

// analyzeDeviceStoredReportOwner.test.js — التقرير المخزَّن (analyzeDevice، فرع 1b) لا يُردّ إلا لمالكه في كل المسارات (البند ٢، 2026-10-17 +03). بلا شبكة وبلا محاكٍ وبلا نداء نموذج.
//
// القرار (المنسّق، منقول من نصّ الأمر — غير متحقَّق منه هنا): قبل تقديم أيّ تقرير مخزَّن يجب `ownerCheckState(userId, reports/{scanId}.userId) === MATCH` في كل المسارات، حيث userId = ownerId الجلسة
// في مسارات الجلسة وuid المستدعي في المسار الشخصي. غير ذلك ⟵ رفض مسمّى بلا أيّ جزء من التقرير: SESSION_REPORT_NOT_AVAILABLE (مسار الجلسة، «جلسة الفحص غير صالحة») أو SCAN_REPORT_NOT_AVAILABLE
// (المسار الشخصي، permission-denied). الغياب (userId غائب في التقرير، أو ownerId غائب في الجلسة) حالة صريحة تُرفض وتُسجَّل بسطر مسمّى بمعرّفات مُهشَّرة. لا كتابة ولا خصم رصيد في الرفض.
//
// الحالات (أ–و من الأمر): أ المالك الشخصي يعيد المحاولة ⟵ يُقدَّم · ب uid آخر ⟵ رفض بلا حرف من aiResponse · ج زبون مجهول بـsessionId لجلسة scanning مالكها صاحب التقرير ⟵ يُقدَّم ·
// د جلسة completed: السلوك القائم كما هو · هـ تقرير بلا userId ⟵ رفض مسمّى · و سطر الرفض بمعرّفات مُهشَّرة (بحث نصّي عن uid وscanId الخامّين في كل ما طُبع).
// المستبدَل (القاعدة 37) وحده: utils/admin ⟵ db في الذاكرة بمجموعتين؛ أيّ مجموعة أخرى (users وscanClaims: فحص جديد/حجز/خصم) تُسجَّل وترمي. المعالج الحقيقي analyzeDevice.run والحرّاس كلّها حقيقية.
//
// Run: node functions/test/analyzeDeviceStoredReportOwner.test.js

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
    if (!ALLOWED.has(c)) throw new Error(`TRAP: collection "${c}" must not be touched on this path (a new scan, a reservation or a deduction would start)`);
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
const future = () => new Date(Date.now() + 3600000);
const MARKER = 'STORED-REPORT-MARKER-9f3a';
const SECRET_UID = 'uid-SECRET-stranger-77';
const SECRET_SCAN = 'scan-SECRET-id-4242';
const SECRET_SESSION = 'sess-SECRET-id-5151';
const AI = {grade: 'A', marker: MARKER, categories: [{name: 'x'}]};
const seedSession = (id, fields) => { store[key('scanSessions', id)] = {ownerId: 'owner', status: 'scanning', joinedBy: 'joiner', scanId: null, expiresAt: future(), ...fields}; };
const seedReport = (id, fields) => { store[key('reports', id)] = {userId: 'owner', pipeline: 'seeded_test', aiResponse: AI, shortId: 'NC-AAAAAA', deviceModel: 'M', ...fields}; };

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
const FP = {device: {model: 'M'}};
const SESSION_TEXT = 'جلسة الفحص غير صالحة';
const PERSONAL_TEXT = 'تعذّر إتمام الطلب';

/** رفض بلا أيّ جزء من التقرير ولا من هويّة، وبلا كتابة ولا فحص جديد. */
function refused(r, code, message, reason, label) {
  ok(r.thrown instanceof HttpsError, `${label}: HttpsError (لا ردّ: ${r.value === undefined ? 'لا قيمة' : JSON.stringify(r.value).slice(0, 80)}) — ${r.thrown && r.thrown.message}`);
  eq(r.thrown.code, code, `${label}: الرمز`);
  eq(r.thrown.message, message, `${label}: النصّ العربي المحايد`);
  deq(r.thrown.details, {reasonCode: reason}, `${label}: details = {reasonCode: ${reason}} وحده`);
  const wire = JSON.stringify(r.thrown.toJSON());
  ok(!wire.includes(MARKER) && !wire.includes('"grade"') && !wire.includes('categories'), `${label}: لا حرف من aiResponse في الخطأ`);
  ok(!wire.includes(SECRET_UID) && !wire.includes('owner') && !wire.includes(SECRET_SCAN), `${label}: ولا معرّف مستخدم أو مالك أو scanId في الخطأ`);
  ok(r.value === undefined, `${label}: ولا قيمة مردودة`);
  ok(!touched.has('users') && !touched.has('scanClaims'), `${label}: لا users ولا scanClaims (لا خصم ولا حجز ولا فحص جديد)`);
  eq(transactions, 0, `${label}: لا معاملة`);
  eq(updates.length, 0, `${label}: لا كتابة`);
}

(async () => {
  // ═══ أ — المسار الشخصي: المالك يعيد المحاولة ⟵ يُقدَّم المخزَّن ═══
  {
    reset(); seedReport('scan-P1', {userId: 'personal-owner'});
    const r = await call({scanId: 'scan-P1', fingerprint: FP}, 'personal-owner');
    ok(!r.thrown, `[أ] المالك الشخصي: لا رفض (${r.thrown && r.thrown.message})`);
    deq(r.value, AI, '[أ] الردّ هو المخزَّن بعينه');
    deq([...touched].sort(), ['reports'], '[أ] قراءة reports وحدها (لا users ولا scanClaims: لا حجز ولا خصم)');
    eq(transactions, 0, '[أ] بلا معاملة');
  }

  // ═══ ب — المسار الشخصي: uid آخر ⟵ رفض مسمّى ولا يظهر حرف من aiResponse ═══
  {
    reset(); seedReport(SECRET_SCAN, {userId: 'personal-owner'});
    const r = await call({scanId: SECRET_SCAN, fingerprint: FP}, SECRET_UID);
    refused(r, 'permission-denied', PERSONAL_TEXT, 'SCAN_REPORT_NOT_AVAILABLE', '[ب] uid آخر');
    ok(r.lines.some((l) => /^\[analyzeDevice\] stored-report refused reason=SCAN_REPORT_NOT_AVAILABLE ownerCheck=MISMATCH path=personal scanId=#[0-9a-f]{12} session=no$/.test(l)),
        `[ب] السطر المسمّى بنصّه: ${JSON.stringify(r.lines)}`);
    // الحالة نفسها لمستدعٍ بلا sessionId لكن بتقرير مخزَّن بنسخة V7: يُرفض كذلك (لا يمرّ بمسار strip إلى المستدعي)
    reset(); seedReport('scan-P2', {userId: 'personal-owner', pipeline: 'v7'});
    const r2 = await call({scanId: 'scan-P2', fingerprint: FP}, SECRET_UID);
    refused(r2, 'permission-denied', PERSONAL_TEXT, 'SCAN_REPORT_NOT_AVAILABLE', '[ب] تقرير V7 لغير مالكه');
  }

  // ═══ ج — جلسة scanning: زبون مجهول بـsessionId، مالك الجلسة = صاحب التقرير ⟵ يُقدَّم ═══
  for (const [label, uid] of [['زبون بـuid مجهول', 'customer-anon'], ['زبون بلا auth', null], ['المنضمّ', 'joiner'], ['المالك', 'owner']]) {
    reset(); seedSession('S-C', {}); seedReport('scan-C', {userId: 'owner'});
    const r = await call({scanId: 'scan-C', sessionId: 'S-C', fingerprint: FP}, uid);
    ok(!r.thrown, `[ج] ${label}: لا رفض (${r.thrown && r.thrown.message})`);
    deq(r.value, AI, `[ج] ${label}: الردّ المخزَّن بعينه`);
    ok(!touched.has('users') && !touched.has('scanClaims'), `[ج] ${label}: لا users ولا scanClaims`);
    eq(store[key('scanSessions', 'S-C')].status, 'completed', `[ج] ${label}: وتُكتب «اكتملت» (المسار ب كما كان)`);
    eq(store[key('scanSessions', 'S-C')].scanId, 'scan-C', `[ج] ${label}: وscanId على الجلسة`);
  }

  // ═══ ج٢ — جلسة scanning: التقرير ملكيته لغير مالك الجلسة ⟵ رفض مسمّى، والجلسة لا تُمسّ ═══
  {
    reset(); seedSession(SECRET_SESSION, {}); seedReport(SECRET_SCAN, {userId: SECRET_UID});
    const r = await call({scanId: SECRET_SCAN, sessionId: SECRET_SESSION, fingerprint: FP}, 'customer-anon');
    refused(r, 'permission-denied', SESSION_TEXT, 'SESSION_REPORT_NOT_AVAILABLE', '[ج٢] جلسة scanning بتقرير غير مالكها');
    eq(store[key('scanSessions', SECRET_SESSION)].status, 'scanning', '[ج٢] الجلسة تبقى scanning');
    eq(store[key('scanSessions', SECRET_SESSION)].scanId, null, '[ج٢] ولا scanId يُكتب على الجلسة');
    ok(r.lines.some((l) => /^\[analyzeDevice\] stored-report refused reason=SESSION_REPORT_NOT_AVAILABLE ownerCheck=MISMATCH path=session scanId=#[0-9a-f]{12} session=#[0-9a-f]{12}$/.test(l)),
        `[ج٢] السطر المسمّى بنصّه: ${JSON.stringify(r.lines)}`);
    ok(!r.lines.some((l) => l.includes('completed-skipped')), '[ج٢] ولا سطر اكتمال (الرفض قبل مسار الاكتمال)');
  }

  // ═══ د — جلسة completed: السلوك القائم كما هو ═══
  {
    reset(); seedSession('S-D1', {status: 'completed', scanId: 'scan-D'}); seedReport('scan-D', {userId: 'owner'});
    const r = await call({scanId: 'scan-D', sessionId: 'S-D1', fingerprint: FP}, 'joiner');
    ok(!r.thrown, '[د] completed بتقرير المالك والطالب مشروع: يُقدَّم');
    deq(r.value, AI, '[د] والردّ المخزَّن');
    eq(updates.length + transactions, 0, '[د] بلا كتابة');
    reset(); seedSession('S-D2', {status: 'completed', scanId: 'scan-D'}); seedReport('scan-D', {userId: 'someone-else'});
    const r2 = await call({scanId: 'scan-D', sessionId: 'S-D2', fingerprint: FP}, 'joiner');
    refused(r2, 'permission-denied', SESSION_TEXT, 'SESSION_COMPLETED', '[د] completed بتقرير غير المالك: الرمز القائم SESSION_COMPLETED لا الجديد');
  }

  // ═══ هـ — الغياب حالة صريحة تُرفض ═══
  for (const [label, userIdField] of [['غائب', undefined], ['null', null], ['نصّ فارغ', ''], ['غير نصّ', 12345]]) {
    reset(); seedReport('scan-E1', {userId: userIdField});
    const r = await call({scanId: 'scan-E1', fingerprint: FP}, 'personal-owner');
    refused(r, 'permission-denied', PERSONAL_TEXT, 'SCAN_REPORT_NOT_AVAILABLE', `[هـ] المسار الشخصي، userId التقرير ${label}`);
    ok(r.lines.some((l) => /^\[analyzeDevice\] stored-report refused reason=SCAN_REPORT_NOT_AVAILABLE ownerCheck=REPORT_USER_ABSENT path=personal scanId=#[0-9a-f]{12} session=no$/.test(l)),
        `[هـ] السطر يُسمّي الحالة REPORT_USER_ABSENT (لا تُقرأ غياباً ولا عدم تطابق): ${JSON.stringify(r.lines)}`);
    reset(); seedSession('S-E2', {}); seedReport('scan-E2', {userId: userIdField});
    const r2 = await call({scanId: 'scan-E2', sessionId: 'S-E2', fingerprint: FP}, 'joiner');
    refused(r2, 'permission-denied', SESSION_TEXT, 'SESSION_REPORT_NOT_AVAILABLE', `[هـ] مسار الجلسة، userId التقرير ${label}`);
    eq(store[key('scanSessions', 'S-E2')].status, 'scanning', `[هـ] الجلسة تبقى scanning (${label})`);
  }
  {
    // ownerId غائب في الجلسة: الحالة الثانية للغياب
    reset(); seedSession('S-E3', {ownerId: undefined}); seedReport('scan-E3', {userId: 'owner'});
    const r = await call({scanId: 'scan-E3', sessionId: 'S-E3', fingerprint: FP}, 'joiner');
    refused(r, 'permission-denied', SESSION_TEXT, 'SESSION_REPORT_NOT_AVAILABLE', '[هـ] ownerId غائب في الجلسة');
    ok(r.lines.some((l) => l.includes('ownerCheck=SESSION_OWNER_ABSENT')), `[هـ] والسطر يُسمّي SESSION_OWNER_ABSENT: ${JSON.stringify(r.lines)}`);
  }

  // ═══ و — لا معرّف خامّ في كل ما طُبع ═══
  {
    const printed = [];
    reset(); seedReport(SECRET_SCAN, {userId: 'personal-owner'});
    printed.push(...(await call({scanId: SECRET_SCAN, fingerprint: FP}, SECRET_UID)).lines);
    reset(); seedSession(SECRET_SESSION, {ownerId: 'owner-SECRET-owner-88'}); seedReport(SECRET_SCAN, {userId: SECRET_UID});
    printed.push(...(await call({scanId: SECRET_SCAN, sessionId: SECRET_SESSION, fingerprint: FP}, SECRET_UID)).lines);
    reset(); seedReport(SECRET_SCAN, {userId: undefined});
    printed.push(...(await call({scanId: SECRET_SCAN, fingerprint: FP}, SECRET_UID)).lines);
    ok(printed.length >= 3, `[و] طُبعت سطور (${printed.length})`);
    const all = printed.join('\n');
    for (const raw of [SECRET_UID, SECRET_SCAN, SECRET_SESSION, 'owner-SECRET-owner-88', MARKER]) ok(!all.includes(raw), `[و] «${raw}» لا يظهر خاماً في أيّ سطر مطبوع`);
    ok(printed.filter((l) => l.startsWith('[analyzeDevice] stored-report refused')).length === 3, '[و] ثلاثة أسطر مسمّاة بالضبط (سطر لكل رفض)');
  }

  console.log(`analyzeDeviceStoredReportOwner.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
