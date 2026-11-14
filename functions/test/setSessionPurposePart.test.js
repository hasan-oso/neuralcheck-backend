'use strict';

// setSessionPurposePart.test.js — ق31: رفض setSessionPurpose لمحلّ بلا الجزء (قرار حسن 2026-10-22؛ أمر المستخدم عبر المنسّق). بلا شبكة ولا محاكٍ؛ والمسار الحقيقي على المحاكي في setSessionPurposePart.e2e.test.js.
//
// المصدر (منقول من أمر المنسّق، غير متحقَّق إلا بالقراءة): evidence/run-2026-10-18/DECISIONS-FOR-HASAN-2026-10-21.md ق31 — «داخل معاملة الدالّة (تقرأ مستند المالك أصلاً: createScanSession.js:143-144) يُرفض `purpose ≠ normal` إن كان `purposes !== true`،
// ويُرفض `maintenance_*` إن كان `batteryBeforeAfter !== true`، برمز `PURPOSE_PART_NOT_ENABLED` وسطر سجلّ مسمّى؛ وتُحدَّث A2 في العقد.» وأقرّه حسن بتاريخ 2026-10-22.
//
// **الاختبار يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): كل تأكيد هنا يُسجَّل فشله بنصّه ولا يوقف التشغيل، وينتهي بتقرير كامل (الخروج 1 إن فشل أيّ تأكيد)، فيُعرف بالضبط أيّ تأكيدات تفشل قبل العلاج وأيّها ينجح بعده.
// ما يجب أن ينجح قبل العلاج وبعده (يحرس ما لا يتغيّر): normal مقبول كما هو، وترتيب الرفوض (مدخل ثم ملكية ثم حالة ثم انقضاء) وغياب أيّ قراءة قبل رفض المدخل.
//
// الاستبدال معلَن (القاعدة 37): utils/admin ⟵ db في الذاكرة (lib/pairFakeDb.js: معاملة تفاؤلية، **قراءة بعد كتابة ترمي**، لا حذف)؛ كل ما فوقه حقيقي: المعالج الكامل (التحقّق، المعاملة، القرارات، السجلّ). الطبقة الحقيقية تُفحص في setSessionPurposePart.e2e.test.js.
//
// Run: node functions/test/setSessionPurposePart.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const {makePairDb, ts, FieldValue, captureConsole} = require('./lib/pairFakeDb');
const {hashIdForLog} = require('../src/utils/logRedaction');

let n = 0;
const failures = [];
const rec = (c, m) => { n++; if (!c) failures.push(m); };
const ok = (c, m) => rec(!!c, m);
const eq = (a, b, m) => rec(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const deq = (a, b, m) => {
  let same = true;
  try { assert.deepStrictEqual(a, b); } catch (e) { same = false; }
  rec(same, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ─── utils/admin ⟵ db في الذاكرة (الاستبدال المُعلَن) ───
const state = {db: null};
const dbProxy = new Proxy({}, {
  get: (_t, prop) => {
    if (state.db === null) throw new Error('setSessionPurposePart: لا قاعدة مبذورة');
    const v = state.db[prop];
    return typeof v === 'function' ? v.bind(state.db) : v;
  },
});
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue}}, db: dbProxy, ADMIN_EMAILS: [], requireAdmin: () => {}},
};
const {setSessionPurpose, decidePurposePart} = require('../src/sessions/setSessionPurpose');

const HOUR = 3600 * 1000;
const OWNER = 'own-q31';
const OTHER = 'other-q31';
const SESSION = 'sess-q31';
const sid = (id) => hashIdForLog(id);

// ─── بذور ───
const sessionDoc = (over = {}) => ({ownerId: OWNER, status: 'pending', code: '123456', purpose: 'normal', createdAt: ts(Date.now() - HOUR), expiresAt: ts(Date.now() + HOUR), ...over});
const pendingInit = () => ({purposeSource: 'default', defectType: null, linkedScanId: null});
const shop = (parts) => ({plan: 'shop_pro', scansRemaining: 5, isActive: true, ...(parts === undefined ? {} : {protocolParts: parts})});
function world({users, session = sessionDoc()} = {}) {
  return makePairDb({
    scanSessions: {[SESSION]: session},
    users: users === undefined ? {[OWNER]: shop({purposes: true, batteryBeforeAfter: true})} : users,
    protocolPending: {[SESSION]: pendingInit()},
  }, {now: Date.now()});
}
const withParts = (parts) => world({users: {[OWNER]: shop(parts)}});
const noOwnerDoc = () => world({users: {}});

async function run(db, {uid = OWNER, purpose, defectType, sessionId = SESSION} = {}) {
  state.db = db;
  const cap = captureConsole();
  let ret = null;
  let threw = null;
  try {
    ret = await setSessionPurpose.run({data: {sessionId, purpose, ...(defectType !== undefined ? {defectType} : {})}, auth: {uid, token: {firebase: {sign_in_provider: 'google.com'}}}, rawRequest: {headers: {}}});
  } catch (e) { threw = e; } finally { cap.restore(); }
  return {ret, threw, texts: cap.texts()};
}
const snapshot = (db) => JSON.stringify(db.store);
const MAINT = [['maintenance_before', 'BATTERY'], ['maintenance_after', 'THERMAL']];
const refusedLines = (r) => r.texts.filter((t) => t.startsWith('[setSessionPurpose] refused '));
const usersRead = (db) => db.reads.filter((x) => x.path.startsWith('users/'));

/** رفض جزء المحلّ كما يجب: الرمز والرسالة وdetails وسطر السجلّ وبلا أيّ كتابة، ومستند المالك قُرئ داخل المعاملة. */
function expectPartRefusal(label, db, before, r, {part, ownerAbsent = false, uid = OWNER}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  if (r.threw) {
    deq([r.threw.code, r.threw.message, r.threw.details], ['failed-precondition', 'PURPOSE_PART_NOT_ENABLED', {reasonCode: 'PURPOSE_PART_NOT_ENABLED'}], `${label}: failed-precondition ورسالته رمزه التقني وdetails.reasonCode`);
  }
  eq(db.writes.length, 0, `${label}: لا أيّ كتابة`);
  ok(snapshot(db) === before, `${label}: المخزن كما كان حرفاً (scanSessions وprotocolPending لم يُمسّا)`);
  deq(refusedLines(r), [`[setSessionPurpose] refused reason=PURPOSE_PART_NOT_ENABLED session=${sid(SESSION)} caller=${sid(uid)}${ownerAbsent ? ' owner=absent' : ''} part=${part}`], `${label}: سطر الرفض المسمّى الوحيد باسم الجزء الناقص${ownerAbsent ? ' وowner=absent' : ''}`);
  ok(!r.texts.join('\n').includes(SESSION) && !r.texts.join('\n').includes(uid), `${label}: لا معرّف خامّ في أيّ سطر`);
  ok(db.reads.some((x) => x.path === `users/${uid}` && x.inTx), `${label}: مستند المالك قُرئ **داخل المعاملة**`);
}

/** قبول: الردّ، والكتابتان (الغرض في الجلسة، والمصدر selected في protocolPending). */
function expectAccepted(label, db, r, purpose, defectType) {
  ok(r.threw === null, `${label}: يُقبل${r.threw ? ` (رُفض: ${r.threw.message})` : ''}`);
  deq(r.ret, {sessionId: SESSION, purpose, purposeSource: 'selected'}, `${label}: الردّ {sessionId, purpose, purposeSource: selected} لم يتغيّر`);
  eq(db.store.scanSessions[SESSION].purpose, purpose, `${label}: الغرض كُتب في الجلسة`);
  eq(db.store.protocolPending[SESSION].purposeSource, 'selected', `${label}: والمصدر selected`);
  eq(db.store.protocolPending[SESSION].defectType, defectType === undefined ? null : defectType, `${label}: ونوع العطل في protocolPending (null صريح لـnormal)`);
  ok(!('defectType' in db.store.scanSessions[SESSION]), `${label}: ولا defectType في scanSessions (يقرؤه الهاتف المنضمّ)`);
}

(async () => {
  // ═══ ١ — جزء purposes مُطفأ/غائب/بشكل خاطئ ⟵ كل غرض غير normal يُرفض بـpart=purposes (ولو كان batteryBeforeAfter مفعَّلاً) ═══
  const OFF_PURPOSES = [
    ['protocolParts غائبة', undefined], ['protocolParts كائن فارغ', {}], ['purposes false', {purposes: false, batteryBeforeAfter: true}],
    ['purposes نصّ «true»', {purposes: 'true', batteryBeforeAfter: true}], ['purposes رقم 1', {purposes: 1, batteryBeforeAfter: true}], ['purposes null', {purposes: null, batteryBeforeAfter: true}],
    ['مفتاح purposes غائب (الآخر مفعَّل)', {batteryBeforeAfter: true}], ['protocolParts نصّ تالف', 'garbage'], ['purposes مصفوفة', {purposes: [true], batteryBeforeAfter: true}],
  ];
  for (const [label, parts] of OFF_PURPOSES) {
    for (const [purpose, defectType] of MAINT) {
      const db = withParts(parts);
      const before = snapshot(db);
      const r = await run(db, {purpose, defectType});
      expectPartRefusal(`[١] ${label} + ${purpose}`, db, before, r, {part: 'purposes'});
    }
    // normal يبقى مقبولاً كما هو، ولا يقرأ مستند المالك أصلاً (لا تغيّر في سلوكه ولا كلفته)
    const dbN = withParts(parts);
    const rN = await run(dbN, {purpose: 'normal'});
    expectAccepted(`[١] ${label} + normal`, dbN, rN, 'normal');
    eq(usersRead(dbN).length, 0, `[١] ${label} + normal: لا قراءة لمستند المالك`);
  }

  // ═══ ٢ — purposes مفعَّل وbatteryBeforeAfter مُطفأ/غائب ⟵ normal مقبول وmaintenance_* مرفوض بـpart=batteryBeforeAfter ═══
  const OFF_BBA = [
    ['batteryBeforeAfter false', {purposes: true, batteryBeforeAfter: false}], ['batteryBeforeAfter غائب', {purposes: true}], ['batteryBeforeAfter نصّ «true»', {purposes: true, batteryBeforeAfter: 'true'}],
    ['batteryBeforeAfter رقم 1', {purposes: true, batteryBeforeAfter: 1}], ['batteryBeforeAfter null', {purposes: true, batteryBeforeAfter: null}], ['الأجزاء الأخرى مفعَّلة كلّها', {purposes: true, coldRepeat: true, returns: true, doubleEval: true, consent: true}],
  ];
  for (const [label, parts] of OFF_BBA) {
    for (const [purpose, defectType] of MAINT) {
      const db = withParts(parts);
      const before = snapshot(db);
      const r = await run(db, {purpose, defectType});
      expectPartRefusal(`[٢] ${label} + ${purpose}`, db, before, r, {part: 'batteryBeforeAfter'});
    }
    const dbN = withParts(parts);
    expectAccepted(`[٢] ${label} + normal`, dbN, await run(dbN, {purpose: 'normal'}), 'normal');
  }

  // ═══ ٣ — الجزءان مفعَّلان ⟵ الأغراض الثلاثة مقبولة كما كانت ═══
  for (const [purpose, defectType] of [['normal', undefined], ...MAINT]) {
    const db = withParts({purposes: true, batteryBeforeAfter: true});
    const r = await run(db, {purpose, defectType});
    expectAccepted(`[٣] الجزءان مفعَّلان + ${purpose}`, db, r, purpose, defectType);
    eq(db.writes.length, 2, `[٣] الجزءان مفعَّلان + ${purpose}: كتابتان لا غير (الغرض في الجلسة، والمصدر في protocolPending)`);
    if (purpose !== 'normal') {
      deq(r.texts.filter((t) => t.startsWith('[setSessionPurpose] set ')), [`[setSessionPurpose] set session=${sid(SESSION)} caller=${sid(OWNER)} purpose=${purpose} previous=normal defectType=${defectType}`], `[٣] ${purpose}: سطر النجاح كما كان`);
      ok(db.reads.some((x) => x.path === `users/${OWNER}` && x.inTx), `[٣] ${purpose}: ومستند المالك قُرئ داخل المعاملة قبل الكتابتين`);
    }
  }
  {
    // الأجزاء الأخرى مفعَّلة بلا purposes: لا تغني (الجزءان وحدهما)
    const dbOnly = withParts({batteryBeforeAfter: true, coldRepeat: true, returns: true, doubleEval: true, consent: true});
    const before = snapshot(dbOnly);
    expectPartRefusal('[٣] كل الأجزاء إلا purposes + maintenance_before', dbOnly, before, await run(dbOnly, {purpose: 'maintenance_before', defectType: 'BATTERY'}), {part: 'purposes'});
  }

  // ═══ ٤ — مستند المالك غائب: حالة صريحة بالرمز نفسه (owner=absent)، لا نجاحاً ولا قيمة افتراضية؛ وnormal مقبول ═══
  for (const [purpose, defectType] of MAINT) {
    const db = noOwnerDoc();
    const before = snapshot(db);
    const r = await run(db, {purpose, defectType});
    expectPartRefusal(`[٤] مستند المالك غائب + ${purpose}`, db, before, r, {part: 'purposes', ownerAbsent: true});
  }
  {
    const db = noOwnerDoc();
    expectAccepted('[٤] مستند المالك غائب + normal', db, await run(db, {purpose: 'normal'}), 'normal');
    eq(usersRead(db).length, 0, '[٤] مستند المالك غائب + normal: لا قراءة له');
  }

  // ═══ ٥ — الترتيب مع بقية الرفوض (جزء المحلّ آخرها بعد فحوص الجلسة، ويسبقه رفض المدخل قبل أيّ قراءة) ═══
  // الجزء مُطفأ في كل هذه المشاهد: فلو سبق الجزءُ غيرَه لظهر PURPOSE_PART_NOT_ENABLED.
  const PARTS_OFF = {purposes: false};
  const reasonOf = (r) => (r.threw && r.threw.details ? r.threw.details.reasonCode : null);
  {
    // غير المالك قبل الجزء (والجزء الذي يُفحَص لا يُقرأ أصلاً)
    const db = withParts(PARTS_OFF);
    const before = snapshot(db);
    const r = await run(db, {uid: OTHER, purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'SESSION_NOT_PARTICIPANT', '[٥] غير المالك ⟵ SESSION_NOT_PARTICIPANT (قبل الجزء)');
    deq(refusedLines(r).map((t) => t.replace(/ caller=#[0-9a-f]+/, '')), [`[setSessionPurpose] refused reason=SESSION_NOT_OWNER session=${sid(SESSION)} ownerState=SET`], '[٥] وسطر السجلّ يفرّق: SESSION_NOT_OWNER');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند أيّ مستخدم قبل رفض الملكية');
    ok(snapshot(db) === before, '[٥] ولا كتابة');
  }
  {
    const db = withParts(PARTS_OFF);
    const r = await run(db, {sessionId: 'no-such-session', purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'SESSION_NOT_PARTICIPANT', '[٥] جلسة غير موجودة ⟵ SESSION_NOT_PARTICIPANT (الردّ نفسه)');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك');
  }
  for (const status of ['scanning', 'completed', 'cancelled', 'expired']) {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({status})});
    const before = snapshot(db);
    const r = await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'PURPOSE_SESSION_NOT_PENDING', `[٥] الجلسة ${status} والجزء مُطفأ ⟵ PURPOSE_SESSION_NOT_PENDING (قبل الجزء)`);
    eq(usersRead(db).length, 0, `[٥] الجلسة ${status}: لا قراءة لمستند المالك`);
    ok(snapshot(db) === before, `[٥] الجلسة ${status}: لا كتابة`);
  }
  for (const [label, session] of [['حالة غائبة', sessionDoc({status: undefined})], ['حالة مجهولة', sessionDoc({status: 'weird'})]]) {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session});
    const r = await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'SESSION_STATUS_UNKNOWN', `[٥] ${label} والجزء مُطفأ ⟵ SESSION_STATUS_UNKNOWN (قبل الجزء)`);
    eq(usersRead(db).length, 0, `[٥] ${label}: لا قراءة لمستند المالك`);
  }
  {
    // pending منقضية: تُكتب «منتهية» في المعاملة نفسها ثم SESSION_EXPIRED، قبل الجزء ودون قراءته
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({expiresAt: ts(Date.now() - HOUR)})});
    const r = await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'SESSION_EXPIRED', '[٥] pending منقضية والجزء مُطفأ ⟵ SESSION_EXPIRED (قبل الجزء)');
    deq(db.writes.map((w) => `${w.op}:${w.path}`), [`update:scanSessions/${SESSION}`], '[٥] وكتابة «منتهية» الوحيدة في المعاملة نفسها');
    eq(db.store.scanSessions[SESSION].status, 'expired', '[٥] والجلسة صارت expired');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك بعد كتابة (قراءة بعد كتابة ترمي في Firestore)');
    ok(r.threw !== null && r.threw.code === 'failed-precondition', '[٥] والرفض failed-precondition (لا فشل معاملة)');
  }
  {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({expiresAt: undefined})});
    const r = await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'});
    eq(reasonOf(r), 'SESSION_EXPIRES_AT_INVALID', '[٥] expiresAt غائب والجزء مُطفأ ⟵ SESSION_EXPIRES_AT_INVALID (قبل الجزء)');
    eq(db.writes.length, 0, '[٥] بلا كتابة');
  }
  // رفض المدخل قبل أيّ قراءة (والجزء مُطفأ)
  for (const [label, data, want] of [
    ['نوع العطل غائب', {purpose: 'maintenance_before'}, 'DEFECT_TYPE_REQUIRED'],
    ['نوع العطل فاسد', {purpose: 'maintenance_after', defectType: 'OTHER'}, 'DEFECT_TYPE_INVALID'],
    ['نوع مع normal', {purpose: 'normal', defectType: 'BATTERY'}, 'DEFECT_TYPE_NOT_APPLICABLE'],
    ['غرض خارج المفردات', {purpose: 'battery_before', defectType: 'BATTERY'}, 'SET_PURPOSE_INVALID'],
    ['غرض غائب', {}, 'SET_PURPOSE_REQUIRED'],
  ]) {
    const db = withParts(PARTS_OFF);
    const r = await run(db, data);
    eq(reasonOf(r), want, `[٥] ${label} والجزء مُطفأ ⟵ ${want} (رفض المدخل أوّلاً)`);
    eq(db.reads.length, 0, `[٥] ${label}: **لا أيّ قراءة** قبل رفض المدخل`);
  }

  // ═══ ٦ — رفض ثم نجاح: الرفض لا يترك أثراً، ثم يُقبل الاختيار حين يُفعَّل الجزء ═══
  {
    const db = withParts({purposes: true});
    const before = snapshot(db);
    expectPartRefusal('[٦] بلا batteryBeforeAfter', db, before, await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'}), {part: 'batteryBeforeAfter'});
    db.seed('users', OWNER, shop({purposes: true, batteryBeforeAfter: true}));
    const r2 = await run(db, {purpose: 'maintenance_before', defectType: 'BATTERY'});
    expectAccepted('[٦] بعد تفعيل الجزء', db, r2, 'maintenance_before', 'BATTERY');
    eq(db.queries.length, 0, '[٦] ولا استعلام (قراءة بمعرّف مستند وحده: القاعدة 43)');
  }

  // ═══ ٧ — القرار النقيّ decidePurposePart مباشرةً (بلا معاملة): ما يقرّره لكل غرض ولكل شكل لمستند المالك ═══
  {
    const D = (purpose, ownerData) => decidePurposePart({purpose, ownerData});
    const REF = 'PURPOSE_PART_NOT_ENABLED';
    for (const [label, owner] of [['مستند غائب', null], ['مستند بلا أجزاء', {}], ['purposes false', {protocolParts: {purposes: false}}], ['protocolParts نصّ', {protocolParts: 'x'}]]) {
      deq(D('normal', owner), {ok: true}, `[٧] normal + ${label} ⟵ مقبول (لا يحتاج جزءاً)`);
    }
    const BOTH = {protocolParts: {purposes: true, batteryBeforeAfter: true}};
    for (const p of ['maintenance_before', 'maintenance_after']) {
      deq(D(p, BOTH), {ok: true}, `[٧] ${p} + الجزءان مفعَّلان ⟵ مقبول`);
      deq(D(p, null), {ok: false, refusal: REF, extra: ' owner=absent part=purposes'}, `[٧] ${p} + مستند المالك غائب ⟵ مرفوض صراحةً: owner=absent part=purposes`);
      deq(D(p, undefined), {ok: false, refusal: REF, extra: ' owner=absent part=purposes'}, `[٧] ${p} + مستند المالك undefined ⟵ نفسه`);
      deq(D(p, {}), {ok: false, refusal: REF, extra: ' part=purposes'}, `[٧] ${p} + مستند بلا أجزاء ⟵ part=purposes (والمستند حاضر فلا owner=absent)`);
      deq(D(p, {protocolParts: {purposes: true}}), {ok: false, refusal: REF, extra: ' part=batteryBeforeAfter'}, `[٧] ${p} + purposes وحده ⟵ part=batteryBeforeAfter`);
      deq(D(p, {protocolParts: {batteryBeforeAfter: true}}), {ok: false, refusal: REF, extra: ' part=purposes'}, `[٧] ${p} + batteryBeforeAfter وحده ⟵ part=purposes (الجزء الناقص الأوّل)`);
      deq(D(p, {protocolParts: {purposes: 'true', batteryBeforeAfter: 1}}), {ok: false, refusal: REF, extra: ' part=purposes'}, `[٧] ${p} + «true» نصّاً و1 رقماً ⟵ غير مفعَّلين (=== true وحدها)`);
    }
    const frozen = Object.freeze({protocolParts: Object.freeze({purposes: true})});
    deq(D('maintenance_before', frozen).ok, false, '[٧] المُدخل المجمَّد لا يُعدَّل ولا يرمي');
  }

  if (failures.length > 0) {
    console.error(`\nsetSessionPurposePart.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`setSessionPurposePart.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(2); });
