'use strict';

// ===================================================================
// ownerOpenSessions — الجلسات المفتوحة (pending وscanning) لمالك واحد، بكلّ تواريخها وبلا نافذة زمنية، 2026-10-15 +03. قراءة بحتة. يستعمله owner-open-sessions-readonly.js.
//
// السبب (نصّ المستخدم 2026-10-15، منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «C4: الجلسات pending=1 وscanning=6 … فالجلسات اليتيمة تتراكم: اعرض عليّ عددها ومصدر كلٍّ».
// المخرَج C4 (device-check-03-before-readonly.js) أعداد وحدها؛ وowner-activity-window-readonly.js نافذته ≤24 ساعة وجلسات اليتامى من 2026-10-10 إلى اليوم. هذه الأداة تسرد الجلسات المفتوحة
// لمالك واحد صفّاً لكلّ جلسة بكلّ تواريخها، وتقول هل انقضى وقتها الآن (دون أن تكتب شيئاً)، وهل يمنع كلٌّ منها النشر بمعيار count-active-sessions-readonly.js.
//
// **يشغّلها المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبها ويختبرها بلا شبكة (db مزيَّف في الذاكرة) ولا يشغّلها على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── ما أُعيد استعماله (مصدر واحد، القاعدة 24) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
//   • ownerActivityWindow.js: buildSessionItem (الحالة وcreatedAt وexpiresAt وjoinedAt والمنضمّ وscanId والحقول الأخرى للجلسة، مُهشَّرة) وreadInstant وdescribeScalar وSESSION_SELECT — وهو ما يقرؤه
//     owner-activity-window-readonly.js نفسه، فلا نسخة ثانية من وصف الجلسة. لم يُستعمل السكربت نفسه لأنّ نافذته ≤24 ساعة على createdAt وهو يقرأ تقارير المالك ورصيده وreportRaw (ما لا يلزم هنا).
//   • activeSessions.js: classifySessionStatus (جارية/نهائية/غير مصنَّفة) وclassifySession وSESSIONS_WINDOW_MIN (معيار حارس النشر نفسه).
//   • sessionTimeout.js: sessionExpiryRefusal — حكم «انقضى وقتها» هو حكم الخادم نفسه (analyzeDevice وsubmitEvaluation وjoinScanSession وcancelScanSession تستعمله).
//   • sessionLifecycle.js: claimLiveness (حيوية قفل scanClaims، كما يحكم cancelScanSession).  evaluationEnabledState.js: evaluationEnabledDecision (كما تحكم joinScanSession).
//
// ─── ما يُقرأ، وكيف يُختار (يُذكر في المخرَج نفسه تحت selection) ───────────────────────────────────────────────────────────────────────────────────────────
//   بريد المالك من DEVICE_CHECK_03_OWNER_EMAIL (لا من سطر الأمر، ولا يُطبَع) ← getUserByEmail ← uid (في الذاكرة وحدها).
//   scanSessions حيث ownerId == uid (مساواة على حقل واحد: الفهرس المفرد التلقائي) بقناع حقول؛ **الحالة تُصفّى في الذاكرة** — لا مرشّح نطاق ولا ترتيب ولا فهرس مركّب ولا اقتراح فهرس (القاعدة 43).
//   لكلّ جلسة مفتوحة، ثلاث قراءات بمساواة على sessionId وحده (مصدر الجلسة): عدّ reportRaw (ما ارتبط به تقرير V8) وعدّ reports (تقرير قديم مضمَّن) وscanClaims (أقفال الجلسة: حيويّتها وحجزها).
//
// ─── evaluationEnabled ليس حقلاً في مستند الجلسة ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// joinScanSession تحسبه عند الانضمام من users/{ownerId}.evaluationEnabled (evaluationEnabledDecision) وتعيده للتطبيق، ولا تكتبه على الجلسة؛ وأثره الوحيد سطر سجلّ عند الانضمام. فلا قيمة «وقت الانضمام» تُقرأ من
// Firestore. يطبع كلّ صفّ ما على مستند الجلسة (الغائب حالة صريحة) وقيمة حساب المالك **الآن** وسببها. (القاعدة 22: الغائب لا يُملأ بقيمة مفترضة.)
//
// ─── لا معرّف خامّ ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// المعرّفات كلّها بـhashIdForLog. لا بريد ولا uid ولا sessionId ولا scanId ولا joinedBy ولا رمز جلسة (حقل code لا يُقرأ أصلاً: ليس في SESSION_SELECT)، ولا نصّ خطأ من المزوّد (القاعدة 36).
// ===================================================================

const C = require('./deviceCheck03Common');
const S = require('./subscriptionState');
const W = require('./ownerActivityWindow');
const A = require('./activeSessions');
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require('../../src/sessions/sessionTimeout');
const {claimLiveness, CLAIM_LIVENESS} = require('../../src/sessions/sessionLifecycle');
const {SESSION_STATUS} = require('../../src/sessions/sessionNames');
const {evaluationEnabledDecision} = require('../../src/sessions/evaluationEnabledState');
const {toDateOrNull} = require('../../src/utils/subscription');

const MODE = 'owner-open-sessions';
const SCHEMA = 1;
const SESSIONS_COLLECTION = W.SESSIONS_COLLECTION;
const USERS_COLLECTION = W.USERS_COLLECTION;
const REPORTS_COLLECTION = W.REPORTS_COLLECTION;
const REPORT_RAW_COLLECTION = W.REPORT_RAW_COLLECTION;
const CLAIMS_COLLECTION = A.CLAIMS_COLLECTION;
const MINUTE_MS = 60 * 1000;

/** سقف مستندات الجلسات المقروءة، وسقف الجلسات المفتوحة التي تُقرأ لها الارتباطات الثلاثة. بلوغهما يُعلَن (القاعدة 22). يُحقَن في الاختبار فقط. */
const DEFAULT_CAPS = Object.freeze({sessions: 5000, openRows: 300});

/** القائمة البيضاء لحقول مستند الجلسة: ما في ownerActivityWindow + evaluationEnabled (ليُعلَن غيابه إن غاب). لا code ولا ownerId ولا deviceModel ولا shortId. */
const SESSION_SELECT = Object.freeze([...W.SESSION_SELECT, 'evaluationEnabled']);

/** حكم الوقت الآن بحكم الخادم نفسه (sessionExpiryRefusal): الغياب والتلف حالتان صريحتان لا «صالحة» ولا «منتهية». */
const EXPIRY_NOW = Object.freeze({
  EXPIRED_BY_TIME: 'EXPIRED_BY_TIME',
  STILL_VALID: 'STILL_VALID',
  EXPIRES_AT_ABSENT: 'EXPIRES_AT_ABSENT',
  EXPIRES_AT_UNREADABLE: 'EXPIRES_AT_UNREADABLE',
});

/** شكل الجلسة المفتوحة من حقول مستندها وحدها: «شكل» لا «سبب» — أسباب البقاء مفتوحة في تقرير التشخيص لا هنا. */
const SHAPE = Object.freeze({
  PENDING_NOT_JOINED: 'PENDING_NOT_JOINED', // pending، لا joinedBy ولا joinedAt: لم ينضمّ أحد
  PENDING_WITH_JOIN_FIELDS: 'PENDING_WITH_JOIN_FIELDS', // pending وعليها joinedBy أو joinedAt: شاذّة (الانضمام يكتبهما مع status=scanning في كتابة واحدة)
  SCANNING_JOINED_NO_RESULT: 'SCANNING_JOINED_NO_RESULT', // scanning، منضمّ بهوية، لا scanId ولا completedAt: انضمّ ولم يكتمل فحصه
  SCANNING_JOINED_WITHOUT_IDENTITY: 'SCANNING_JOINED_WITHOUT_IDENTITY', // scanning وjoinedBy=null: انضمّ مستدعٍ بلا auth (لا يملك صلاحية الإلغاء)
  SCANNING_WITHOUT_JOINED_BY: 'SCANNING_WITHOUT_JOINED_BY', // scanning بلا حقل joinedBy أصلاً: شاذّة (الانضمام يكتبه دائماً، ولو null)
  SCANNING_JOINED_BY_UNREADABLE: 'SCANNING_JOINED_BY_UNREADABLE', // joinedBy فارغ أو بنوع غير نصّ
  SCANNING_WITH_RESULT_FIELDS: 'SCANNING_WITH_RESULT_FIELDS', // scanning وعليها scanId أو completedAt: شاذّة (الاكتمال يكتب status=completed معهما في كتابة واحدة)
  STATUS_UNCLASSIFIED: 'STATUS_UNCLASSIFIED', // الحالة غائبة أو غير مقروءة أو لا تعرفها الشيفرة (تُعلَن ولا تُسقَط)
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const round1 = (x) => Math.round(x * 10) / 10;

// ───────────────────────── الوسائط ─────────────────────────

/**
 * --preflight وحدها، أو (بلا وسيط) تشغيل عادي؛ و--out <ملفّ> اختياري. لا بريد ولا شيء آخر من سطر الأمر.
 * @param {string[]} argv
 * @return {{mode: string, out: ?string}}
 */
function parseArgs(argv) {
  const p = C.parseFlags(argv, {values: ['--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (Object.keys(p.values).length > 0) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', out: null};
  }
  return {mode: 'run', out: p.values['--out'] === undefined ? null : p.values['--out']};
}

// ───────────────────────── الأحكام (دوالّ نقيّة) ─────────────────────────

/**
 * هل انقضى وقت الجلسة الآن؟ **حكم الخادم نفسه** (sessionExpiryRefusal) لا نسخة منه. الغياب والتلف حالتان صريحتان.
 * @param {?Object} data مستند الجلسة
 * @param {number} nowMs
 * @return {{state: string, minutesLeft: ?number, expiredMinutesAgo: ?number}}
 */
function expiryNowOf(data, nowMs) {
  const refusal = sessionExpiryRefusal(data, new Date(nowMs));
  if (refusal === null) {
    const exp = toDateOrNull(data && data.expiresAt);
    return {state: EXPIRY_NOW.STILL_VALID, minutesLeft: round1((exp.getTime() - nowMs) / MINUTE_MS), expiredMinutesAgo: null};
  }
  if (refusal.reason === SESSION_EXPIRY_REASON.EXPIRED) {
    const exp = toDateOrNull(data.expiresAt);
    return {state: EXPIRY_NOW.EXPIRED_BY_TIME, minutesLeft: null, expiredMinutesAgo: round1((nowMs - exp.getTime()) / MINUTE_MS)};
  }
  const absent = !data || !has(data, 'expiresAt') || data.expiresAt === undefined;
  return {state: absent ? EXPIRY_NOW.EXPIRES_AT_ABSENT : EXPIRY_NOW.EXPIRES_AT_UNREADABLE, minutesLeft: null, expiredMinutesAgo: null};
}

/** العمر منذ الإنشاء بالدقائق، أو حالة createdAt الصريحة. */
function ageOf(data, nowMs) {
  const r = W.readInstant(data ? data.createdAt : undefined);
  return r.state === 'OK' ? {state: 'OK', minutes: round1((nowMs - r.ms) / MINUTE_MS)} : {state: `CREATED_AT_${r.state}`, minutes: null};
}

/** المدّة المخزَّنة بين الإنشاء وانتهاء الصلاحية (يُتوقَّع 60: createScanSession.js SESSION_VALIDITY_MINUTES) — أو سبب تعذّر الحساب. */
function lifetimeOf(data) {
  const c = W.readInstant(data ? data.createdAt : undefined);
  const e = W.readInstant(data ? data.expiresAt : undefined);
  if (c.state !== 'OK') return {state: `CREATED_AT_${c.state}`, minutes: null};
  if (e.state !== 'OK') return {state: `EXPIRES_AT_${e.state}`, minutes: null};
  return {state: 'OK', minutes: round1((e.ms - c.ms) / MINUTE_MS)};
}

/**
 * هل تمنع هذه الجلسة النشر بمعيار count-active-sessions-readonly.js؟ (نافذة createdAt: 120 دقيقة؛ والغائب وغير المقروء يمنعان؛ والحالة غير المصنَّفة تمنع.)
 * @param {?Object} data
 * @param {number} nowMs
 * @param {boolean} statusUnclassified
 * @return {{windowMinutes: number, createdAtState: string, blocksDeploy: boolean, basis: string}}
 */
function deployGuardOf(data, nowMs, statusUnclassified) {
  const {state} = A.classifySession({data, nowMs, windowMs: A.SESSIONS_WINDOW_MIN * MINUTE_MS});
  if (statusUnclassified) return {windowMinutes: A.SESSIONS_WINDOW_MIN, createdAtState: state, blocksDeploy: true, basis: 'STATUS_UNCLASSIFIED_BLOCKS'};
  return {windowMinutes: A.SESSIONS_WINDOW_MIN, createdAtState: state, blocksDeploy: state !== A.SESSION_STATE.OLDER_THAN_WINDOW, basis: 'CREATED_AT_WINDOW'};
}

/**
 * شكل الجلسة المفتوحة. دالّة نقيّة على عنصر buildSessionItem (الحالة والمنضمّ وscanId وjoinedAt وcompletedAt).
 * @param {{status: {state: string, value: ?string}, joiner: {state: string}, scanLink: {state: string}, joinedAt: {present: boolean}, completedAt: {present: boolean}}} item
 * @return {string} من SHAPE
 */
function classifyShape(item) {
  const st = item.status.value;
  if (item.status.state !== 'KNOWN' || (st !== SESSION_STATUS.PENDING && st !== SESSION_STATUS.SCANNING)) return SHAPE.STATUS_UNCLASSIFIED;
  const joinerState = item.joiner.state;
  if (st === SESSION_STATUS.PENDING) {
    return (joinerState === W.JOINER_STATE.ABSENT && !item.joinedAt.present) ? SHAPE.PENDING_NOT_JOINED : SHAPE.PENDING_WITH_JOIN_FIELDS;
  }
  if (item.scanLink.state !== 'SCAN_ID_ABSENT' && item.scanLink.state !== 'SCAN_ID_NULL') return SHAPE.SCANNING_WITH_RESULT_FIELDS;
  if (item.completedAt.present) return SHAPE.SCANNING_WITH_RESULT_FIELDS;
  if (joinerState === W.JOINER_STATE.PRESENT) return SHAPE.SCANNING_JOINED_NO_RESULT;
  if (joinerState === W.JOINER_STATE.NULL) return SHAPE.SCANNING_JOINED_WITHOUT_IDENTITY;
  if (joinerState === W.JOINER_STATE.ABSENT) return SHAPE.SCANNING_WITHOUT_JOINED_BY;
  return SHAPE.SCANNING_JOINED_BY_UNREADABLE; // EMPTY أو INVALID_TYPE
}

// ───────────────────────── الارتباطات (قراءات بمساواة على sessionId) ─────────────────────────

/**
 * ما ارتبط بجلسة مفتوحة: تقارير في reportRaw (V8) وفي reports (قديم مضمَّن)، وأقفال scanClaims (حيويّتها وحجزها). أعداد وحدها.
 * @param {{db: Object, sessionId: string, nowMs: number}} p
 * @return {Promise<Object>}
 */
async function readLinked({db, sessionId, nowMs}) {
  const reportsInReportRaw = (await db.collection(REPORT_RAW_COLLECTION).where('sessionId', '==', sessionId).count().get()).data().count;
  const reportsLegacyEmbedded = (await db.collection(REPORTS_COLLECTION).where('sessionId', '==', sessionId).count().get()).data().count;
  const claimsSnap = await db.collection(CLAIMS_COLLECTION).where('sessionId', '==', sessionId).select('claimedAtMs', 'reservation').get();
  const claims = {count: 0, withReservation: 0, inFlight: 0, stale: 0, ageUnknown: 0};
  for (const d of claimsSnap.docs) {
    const data = d.data() || {};
    claims.count++;
    if (data.reservation !== null && data.reservation !== undefined) claims.withReservation++;
    const live = claimLiveness(data, nowMs);
    if (live === CLAIM_LIVENESS.IN_FLIGHT) claims.inFlight++;
    else if (live === CLAIM_LIVENESS.STALE) claims.stale++;
    else claims.ageUnknown++;
  }
  return {state: 'READ', reportsInReportRaw, reportsLegacyEmbedded, claims};
}

const NOT_READ_LINKED = Object.freeze({state: 'NOT_READ_CAP_REACHED'});

// ───────────────────────── الجدول المضغوط (سطر لكلّ جلسة، للقراءة بالعين) ─────────────────────────

/** رؤوس أعمدة table.rows بترتيبها. كلّ خلية إمّا قيمة أو حالة صريحة بين قوسين — لا خلية فارغة تُقرأ صفراً أو نجاحاً (القاعدة 22). */
const TABLE_COLUMNS = 'hash | status | createdAt(+03) | ageMin | expiresAt(+03) | expiryNow | joinedAt(+03) | joinedBy | scanId | evaluationEnabled(onSession/ownerNow) | blocksDeploy | shape | reports(reportRaw/legacy) | claims(count/reserved/inFlight)';

const shortTime = (plus03) => plus03.slice(0, 16).replace('T', ' ');
const timeCell = (field) => (!field.present ? '(absent)' : (field.plus03 ? shortTime(field.plus03) : `(unreadable:${field.unreadableType})`));
const joinerCell = (j) => (j.state === W.JOINER_STATE.PRESENT ? j.hash : `(${j.state.toLowerCase()})`);
const SCAN_CELL = Object.freeze({SCAN_ID_ABSENT: '(absent)', SCAN_ID_NULL: '(null)', SCAN_ID_UNREADABLE: '(unreadable)'});
const scanCell = (l) => (l.state === 'SCAN_ID_SET' ? l.scanIdHash : (SCAN_CELL[l.state] || `(${l.state})`));

/**
 * سطر واحد لصفّ جلسة. دالّة نقيّة على صفّ collectOwnerOpenSessions؛ لا شيء فيه غير ما في الصفّ (مُهشَّر).
 * @param {Object} row
 * @return {string}
 */
function tableLine(row) {
  const status = row.status.value !== null ? row.status.value : `(${row.status.state})`;
  const created = row.createdAtPlus03 !== null ? shortTime(row.createdAtPlus03) : `(${row.age.state})`;
  const age = row.age.minutes !== null ? String(row.age.minutes) : `(${row.age.state})`;
  const ex = row.expiryNow;
  const expiry = ex.state === EXPIRY_NOW.EXPIRED_BY_TIME ? `EXPIRED(${ex.expiredMinutesAgo}m ago)` : (ex.state === EXPIRY_NOW.STILL_VALID ? `VALID(${ex.minutesLeft}m left)` : ex.state);
  const doc = row.evaluationEnabled.onSessionDocument;
  const evalDoc = doc.present ? String(doc.value !== undefined ? doc.value : doc.type) : 'absent';
  const lk = row.linked;
  const reports = lk.state === 'READ' ? `${lk.reportsInReportRaw}/${lk.reportsLegacyEmbedded}` : `(${lk.state})`;
  const claims = lk.state === 'READ' ? `${lk.claims.count}/${lk.claims.withReservation}/${lk.claims.inFlight}` : `(${lk.state})`;
  return [
    row.sessionHash, status, created, age, timeCell(row.expiresAt), expiry, timeCell(row.joinedAt), joinerCell(row.joiner), scanCell(row.scanLink),
    `${evalDoc}/${row.evaluationEnabled.ownerAccountNow.value}`, row.deployGuard.blocksDeploy ? 'YES' : 'no', row.shape, reports, claims,
  ].join(' | ');
}

// ───────────────────────── الجمع ─────────────────────────

const byAgeThenHash = (a, b) => {
  if (a._ms !== b._ms) return a._ms - b._ms;
  return a.sessionHash < b.sessionHash ? -1 : (a.sessionHash > b.sessionHash ? 1 : 0);
};

/**
 * قراءة بحتة: getUserByEmail ← uid ← (users/{uid}، جلسات المالك) ← صفّ لكلّ جلسة مفتوحة أو غير مصنَّفة الحالة. مخرَج بلا بريد ولا uid ولا معرّف خامّ.
 * @param {{db: Object, auth: {getUserByEmail: function(string): Promise<{uid: string}>}, email: string, nowMs: number, caps?: {sessions: number, openRows: number}}} p
 * @return {Promise<Object>}
 */
async function collectOwnerOpenSessions({db, auth, email, nowMs, caps = DEFAULT_CAPS}) {
  const {uid, accountHash} = await C.resolveOwner({auth, email});

  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : null;
  const evalDecision = evaluationEnabledDecision(userData);

  const sessionsTotal = (await db.collection(SESSIONS_COLLECTION).where('ownerId', '==', uid).count().get()).data().count;
  const snap = await db.collection(SESSIONS_COLLECTION).where('ownerId', '==', uid).select(...SESSION_SELECT).limit(caps.sessions + 1).get();
  const capReached = snap.docs.length > caps.sessions;
  const docs = snap.docs.slice(0, caps.sessions).map((d) => ({id: d.id, data: d.data() || {}}));

  const byStatus = {pending: 0, scanning: 0, completed: 0, expired: 0, cancelled: 0};
  const unclassified = {statusAbsent: 0, statusUnreadable: 0, statusUnknown: 0, unknownNames: {}};
  const listed = [];
  for (const d of docs) {
    const c = A.classifySessionStatus(d.data);
    if (c.kind === A.STATUS_KIND.ACTIVE) {
      byStatus[c.status]++;
      listed.push({...d, listedBecause: 'OPEN', statusUnclassified: false});
    } else if (c.kind === A.STATUS_KIND.TERMINAL) {
      byStatus[c.status]++;
    } else {
      if (c.kind === A.STATUS_KIND.STATUS_ABSENT) unclassified.statusAbsent++;
      else if (c.kind === A.STATUS_KIND.STATUS_UNREADABLE) unclassified.statusUnreadable++;
      else {
        unclassified.statusUnknown++;
        unclassified.unknownNames[c.name] = (unclassified.unknownNames[c.name] || 0) + 1;
      }
      listed.push({...d, listedBecause: 'STATUS_UNCLASSIFIED', statusUnclassified: true});
    }
  }

  const rows = [];
  let rowsRead = 0;
  let rowCapReached = false;
  for (const d of listed) {
    const item = W.buildSessionItem({id: d.id, data: d.data, nowMs});
    const created = W.readInstant(d.data.createdAt);
    let linked;
    if (rowsRead >= caps.openRows) {
      rowCapReached = true;
      linked = NOT_READ_LINKED;
    } else {
      rowsRead++;
      linked = await readLinked({db, sessionId: d.id, nowMs});
    }
    rows.push({
      _ms: created.state === 'OK' ? created.ms : Number.POSITIVE_INFINITY,
      ...item,
      createdAtPlus03: created.state === 'OK' ? item.createdAtPlus03 : null, // الغائب أو غير المقروء null صريحة (لا مفتاح محذوف)، وسببه في age.state
      listedBecause: d.listedBecause,
      shape: classifyShape(item),
      age: ageOf(d.data, nowMs),
      lifetime: lifetimeOf(d.data),
      expiryNow: expiryNowOf(d.data, nowMs),
      deployGuard: deployGuardOf(d.data, nowMs, d.statusUnclassified),
      evaluationEnabled: {
        onSessionDocument: W.describeScalar(d.data, 'evaluationEnabled'),
        ownerAccountNow: {value: evalDecision.value, reason: evalDecision.reason},
      },
      linked,
    });
  }
  rows.sort(byAgeThenHash);

  const open = rows.filter((r) => r.listedBecause === 'OPEN');
  const count = (arr, fn) => arr.reduce((m, r) => { const k = fn(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const withLinked = rows.filter((r) => r.linked.state === 'READ');
  const readable = rows.filter((r) => Number.isFinite(r._ms));
  const complete = !capReached && !rowCapReached;

  return {
    now: {plus03: S.toPlus03(nowMs)},
    account: {
      accountHash,
      userDocExists: userData !== null,
      evaluationEnabledNow: {
        value: evalDecision.value, reason: evalDecision.reason, valueType: evalDecision.valueType,
        source: 'users/{uid}.evaluationEnabled through src/sessions/evaluationEnabledState.js evaluationEnabledDecision (the source joinScanSession uses). Not stored on the session document.',
      },
      sessionsTotal,
    },
    totals: {docsRead: docs.length, byStatus, unclassified},
    completeness: {
      complete,
      sessions: {docsRead: docs.length, cap: caps.sessions, capReached},
      perSessionReads: {done: rowsRead, cap: caps.openRows, capReached: rowCapReached},
    },
    summary: {
      listed: rows.length,
      open: open.length,
      openByStatus: {pending: open.filter((r) => r.status.value === SESSION_STATUS.PENDING).length, scanning: open.filter((r) => r.status.value === SESSION_STATUS.SCANNING).length},
      statusUnclassifiedListed: rows.length - open.length,
      expiryNow: count(open, (r) => r.expiryNow.state),
      deployGuard: {
        windowMinutes: A.SESSIONS_WINDOW_MIN,
        blocksNow: rows.filter((r) => r.deployGuard.blocksDeploy).length,
        byCreatedAtState: count(rows, (r) => r.deployGuard.createdAtState),
      },
      byShape: count(rows, (r) => r.shape),
      linked: {
        rowsRead: withLinked.length,
        rowsNotRead: rows.length - withLinked.length,
        rowsWithReportInReportRaw: withLinked.filter((r) => r.linked.reportsInReportRaw > 0).length,
        rowsWithLegacyEmbeddedReport: withLinked.filter((r) => r.linked.reportsLegacyEmbedded > 0).length,
        rowsWithClaims: withLinked.filter((r) => r.linked.claims.count > 0).length,
        rowsWithReservedClaim: withLinked.filter((r) => r.linked.claims.withReservation > 0).length,
      },
      createdAt: {
        readable: readable.length,
        notReadable: rows.length - readable.length,
        oldestPlus03: readable.length > 0 ? S.toPlus03(readable[0]._ms) : null,
        newestPlus03: readable.length > 0 ? S.toPlus03(readable[readable.length - 1]._ms) : null,
      },
    },
    table: {columns: TABLE_COLUMNS, rows: rows.map(tableLine)},
    selection: {
      sessions: 'scanSessions where ownerId == the owner uid (one equality: the automatic single-field index). Status is filtered in memory. Listed: pending and scanning, plus any session whose status is absent, unreadable or unknown to the code (declared, never dropped).',
      indexes: 'One equality per query; no range filter, no ordering, no composite index used or needed.',
      perSession: 'Per listed session, three equality reads on sessionId only: count of reportRaw (V8: reportRaw.sessionId), count of reports (legacy embedded reports.sessionId only), and scanClaims (count, with reservation, in-flight / stale / age-unknown by claimLiveness, the verdict cancelScanSession uses).',
      expiryNow: 'sessionExpiryRefusal (the server verdict): EXPIRED_BY_TIME, STILL_VALID, or an explicit absent/unreadable expiresAt. Nothing is written.',
      deployGuard: `count-active-sessions criterion: createdAt within ${A.SESSIONS_WINDOW_MIN} minutes; absent/unreadable createdAt and unclassified status block. Expiry by time is NOT part of that criterion.`,
      printedSessionFields: [...SESSION_SELECT],
      notPrinted: ['code (the join credential)', 'ownerId', 'deviceModel', 'shortId', 'any raw id'],
    },
    sessions: rows.map(({_ms, ...rest}) => rest),
  };
}

// ───────────────────────── الفحص الذاتي بلا شبكة ─────────────────────────

/** فحص ذاتي بلا شبكة. حالة فاشلة = السكربت لا يُشغَّل على الإنتاج. */
function preflightChecks(env = process.env) {
  const NOW = Date.UTC(2026, 9, 15, 9, 0, 0);
  const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const item = (o) => ({status: {state: 'KNOWN', value: 'scanning'}, joiner: {state: 'PRESENT'}, scanLink: {state: 'SCAN_ID_NULL'}, joinedAt: {present: true}, completedAt: {present: false}, ...o});
  const checks = [
    ['بلا وسائط: تشغيل عادي', parseArgs([]).mode === 'run' && parseArgs([]).out === null],
    ['--out يُقبل', parseArgs(['--out', 'x.json']).out === 'x.json'],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--out', 'x.json'], /--preflight وحدها/)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['وسيط موضعي مرفوض', bad(['x.json'], /وسيط مجهول/)],
    ['expiresAt بعد ساعة: STILL_VALID', expiryNowOf({expiresAt: ts(NOW + 3600000)}, NOW).state === EXPIRY_NOW.STILL_VALID],
    ['expiresAt قبل دقيقة: EXPIRED_BY_TIME', expiryNowOf({expiresAt: ts(NOW - 60000)}, NOW).state === EXPIRY_NOW.EXPIRED_BY_TIME],
    ['expiresAt غائب: EXPIRES_AT_ABSENT (لا صالحة ولا منتهية)', expiryNowOf({}, NOW).state === EXPIRY_NOW.EXPIRES_AT_ABSENT],
    ['expiresAt null: EXPIRES_AT_UNREADABLE', expiryNowOf({expiresAt: null}, NOW).state === EXPIRY_NOW.EXPIRES_AT_UNREADABLE],
    ['expiresAt نصّ غير تاريخ: EXPIRES_AT_UNREADABLE', expiryNowOf({expiresAt: 'soon'}, NOW).state === EXPIRY_NOW.EXPIRES_AT_UNREADABLE],
    ['pending بلا انضمام: PENDING_NOT_JOINED', classifyShape(item({status: {state: 'KNOWN', value: 'pending'}, joiner: {state: 'ABSENT'}, joinedAt: {present: false}})) === SHAPE.PENDING_NOT_JOINED],
    ['scanning منضمّ بهوية: SCANNING_JOINED_NO_RESULT', classifyShape(item({})) === SHAPE.SCANNING_JOINED_NO_RESULT],
    ['scanning وjoinedBy=null: SCANNING_JOINED_WITHOUT_IDENTITY', classifyShape(item({joiner: {state: 'NULL'}})) === SHAPE.SCANNING_JOINED_WITHOUT_IDENTITY],
    ['scanning وعليها scanId: SCANNING_WITH_RESULT_FIELDS (شاذّة، تُعلَن)', classifyShape(item({scanLink: {state: 'SCAN_ID_SET'}})) === SHAPE.SCANNING_WITH_RESULT_FIELDS],
    ['حالة غير معروفة: STATUS_UNCLASSIFIED', classifyShape(item({status: {state: 'UNRECOGNIZED', value: null}})) === SHAPE.STATUS_UNCLASSIFIED],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
    ['إزاحة +03', S.toPlus03(Date.UTC(2026, 9, 15, 6, 0, 0)) === '2026-10-15T09:00:00.000+03:00'],
    ['حارس النشر: 120 دقيقة', A.SESSIONS_WINDOW_MIN === 120],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), ownerEmailEnvPresent: typeof env[C.OWNER_EMAIL_ENV] === 'string' && env[C.OWNER_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {
  MODE, SCHEMA, SESSIONS_COLLECTION, USERS_COLLECTION, REPORTS_COLLECTION, REPORT_RAW_COLLECTION, CLAIMS_COLLECTION,
  DEFAULT_CAPS, SESSION_SELECT, EXPIRY_NOW, SHAPE, TABLE_COLUMNS,
  parseArgs, expiryNowOf, ageOf, lifetimeOf, deployGuardOf, classifyShape, tableLine, readLinked, collectOwnerOpenSessions, preflightChecks,
};
