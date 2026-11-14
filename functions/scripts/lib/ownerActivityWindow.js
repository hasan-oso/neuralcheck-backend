'use strict';

// ===================================================================
// ownerActivityWindow — نشاط حساب مالك واحد في نافذة زمنية (تقارير وجلسات ورصيد)، 2026-10-14 +03. قراءة بحتة. يستعمله owner-activity-window-readonly.js.
//
// السبب (منقول من أمر المنسّق، 2026-10-14، غير متحقَّق من مصدره عندي): في الجولة ٢ الجلسة ١ انضمّ جهاز الزبون (الـS10) إلى جلسة ثانية وثالثة والفحص الأوّل جارٍ، وأُرسل analyzeDevice
// لفحص بدأ تحت الجلسة الأولى بمعرّف الجلسة الثانية، وعاد ردّ نهائي خلال ~4 ث لا يُعرف أفشلٌ سريع هو أم تقرير مخبَّأ. السكربت يقرأ ما يحسم: ما كُتب في reports وفي scanSessions
// لهذا المالك في نافذة، وأيّ تقرير ارتبط بأيّ جلسة، ورصيده الآن.
//
// **يشغّله المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبه ويختبره بلا شبكة وعلى المحاكي، ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── ما يُقرأ، وكيف يُختار (يُذكر في المخرَج نفسه تحت selection) ─────────────────────────────────────────────────────────────────────────────────────────
//   بريد المالك من DEVICE_CHECK_03_OWNER_EMAIL (لا من سطر الأمر، ولا يُطبَع) ← getUserByEmail ← uid (في الذاكرة وحدها).
//   • التقارير: reports حيث userId == uid. **فحص الجلسة يحمل في userId معرّف صاحب الجلسة لا الجهاز المفحوص** (analyzeDevice.js:411 `userId = sessionDoc.data().ownerId`، وbuildReportDocument:288 `userId: p.userId`)،
//     فمساواة واحدة تغطّي الفحص الشخصي وفحوص كلّ جلسات المالك. **لا استعلام بـsessionId على reports**: الحقل خرج من المستند المقروء في V8 إلى reportRaw/{scanId}.sessionId (reportRawStore.js، REPORT_RAW_FIELDS)،
//     فاستعلامٌ به على تقارير V8 لا يطابق شيئاً. الربط بالجلسة يُقرأ **لكل تقرير في النافذة** من reportRaw/{scanId}.sessionId، أو من reports.sessionId في تقرير مضمَّن قديم (readReportRaw، المصدر الواحد لحالات الخامّ).
//   • الجلسات: scanSessions حيث ownerId == uid.
//   • النافذة تُطبَّق **في الذاكرة** على createdAt (since ≤ createdAt < until)، فلا يحتاج الاستعلامان إلا الفهرس المفرد التلقائي (مساواة على حقل واحد) ولا فهرساً مركّباً (القاعدة 43). ثمنه قراءة
//     كل مستندات المالك بقناع حقول (select) حتى سقف مسمّى (MAX_DOCS_SCANNED)؛ بلوغ السقف يُعلَن ويُخرِج 3 لا نجاحاً صامتاً (القاعدة 22).
//   • رصيد المالك الآن (scansRemaining من users/{uid})، وعدد تقاريره الكلّي (countAccountReports، المصدر الواحد مع سكربتات فحص الجهاز ٠٣)، وعدد جلساته الكلّي (count).
//
// ─── ما لا يُطبَع ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   لا بريد، ولا uid، ولا scanId ولا sessionId خامّاً (hashIdForLog، المصدر الواحد src/utils/logRedaction.js)، ولا رمز جلسة (code: يشبه شكلُه shortId لكنه حقل آخر لا يُختار أصلاً)، ولا مسار Storage،
//   ولا نصّ aiFallbackReason (قد يكون رسالة مزوّد: القاعدة 36 — حضوره وطوله وحدهما). **shortId التقرير يُطبَع** بطلب المنسّق (رمز التقرير العلنيّ NC-XXXXXX، لا رمز الجلسة).
//   الحقول المقروءة قائمتان بيضاوان (REPORT_SELECT وSESSION_SELECT) بقناع select؛ ما سواها لا يصل ذاكرة العملية من المستند المقروء. (reportRaw/{scanId} يُقرأ كاملاً داخل readReportRaw ولا يُنسخ منه إلا sessionId.)
// ===================================================================

const C = require('./deviceCheck03Common');
const S = require('./subscriptionState');
const {readReportRaw, RAW_STATE, REPORT_RAW_FIELDS, REPORT_RAW_COLLECTION} = require('../../src/analysis/reportRawStore');
const {classifyStatus, STATUS_STATE, isDueForExpiredRecord} = require('../../src/sessions/sessionLifecycle');
const {CANCEL_REASON} = require('../../src/sessions/sessionNames');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require('../../src/analysis/pipelineTags');
const {EVALUATION_RULES_VERSION_FIELD} = require('../../src/analysis/evaluationRulesVersion');

const MODE = 'owner-activity-window';
const SCHEMA = 1;
const REPORTS_COLLECTION = 'reports';
const SESSIONS_COLLECTION = 'scanSessions';
const USERS_COLLECTION = 'users';
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** سقف المستندات المقروءة لكل استعلام، وسقف قراءات reportRaw. بلوغهما يُعلَن (القاعدة 22). يُحقَن في الاختبار فقط. */
const DEFAULT_CAPS = Object.freeze({reports: 5000, sessions: 5000, rawReads: 200});

/**
 * القائمتان البيضاوان الوحيدتان لما يُقرأ من المستندين (قناع select). مصدر واحد (القاعدة 24).
 * reports: sessionId يُقرأ لتقرير مضمَّن قديم وحده (V8 نقله إلى reportRaw). ختم قواعد التقييم باسمه المصدَّر (evaluationRulesVersion.js).
 * scanSessions: ما كتبته دوالّ الخادم على الجلسة: createScanSession (status/createdAt/expiresAt/scanId=null) · joinScanSession (joinedAt/joinedBy) · الاكتمال (sessionCompletion.js:103 بنداء analyzeDevice، S-SWEEP 2026-10-15؛ كان analyzeDevice:795-801) (completedAt/scanId) ·
 * recordSessionExpiredIfDue (expiredAt) · cancelScanSession (cancelledAt/cancelReason).
 */
const REPORT_SELECT = Object.freeze([
  'createdAt', 'shortId', 'pipeline', 'fieldsVersion', EVALUATION_RULES_VERSION_FIELD, 'appVersion', 'aiModel', 'aiDurationMs', 'aiFallbackReason', 'isFreeTrial', 'sessionId',
]);
const SESSION_SELECT = Object.freeze([
  'status', 'createdAt', 'expiresAt', 'joinedBy', 'joinedAt', 'scanId', 'completedAt', 'expiredAt', 'cancelledAt', 'cancelReason',
]);

const TAG_PATTERN = /^[A-Za-z0-9_.:+-]{1,80}$/;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ───────────────────────── الوسائط والنافذة ─────────────────────────

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * لحظة ISO بإزاحة **صريحة** (Z أو ±hh:mm) إلى ميلّي ثانية. بلا إزاحة = رفض (لا توقيت محلّي مفترَض: القاعدة 22). يُفحص صلاحية التقويم (30 شباط مرفوض). لا يُكرَّر النصّ المُدخَل في الرسالة.
 * @param {string} text
 * @param {string} flag اسم الوسيط (للرسالة)
 * @return {number}
 */
function parseInstant(text, flag) {
  const fail = () => { throw new Error(`USAGE: ${flag} لحظة ISO بإزاحة صريحة، مثل 2026-10-14T17:00:00+03:00`); };
  const m = ISO_PATTERN.exec(text);
  if (!m) fail();
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  const msPart = m[7] === undefined ? 0 : Number(m[7].padEnd(3, '0'));
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || sec > 59) fail();
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) fail();
  let offsetMin = 0;
  if (m[8] !== 'Z') {
    const sign = m[8][0] === '-' ? -1 : 1;
    const oh = Number(m[8].slice(1, 3));
    const om = Number(m[8].slice(4, 6));
    if (oh > 23 || om > 59) fail();
    offsetMin = sign * (oh * 60 + om);
  }
  return Date.UTC(y, mo - 1, d, h, mi, sec, msPart) - offsetMin * MINUTE_MS;
}

/**
 * الوسائط: --preflight وحدها، أو --since و--until (إلزاميان، نافذة لا تتجاوز 24 ساعة) و--out اختياري. لا بريد ولا شيء آخر من سطر الأمر.
 * @param {string[]} argv
 * @return {{mode: string, sinceMs: ?number, untilMs: ?number, out: ?string}}
 */
function parseArgs(argv) {
  const p = C.parseFlags(argv, {values: ['--since', '--until', '--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (Object.keys(p.values).length > 0) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', sinceMs: null, untilMs: null, out: null};
  }
  if (p.values['--since'] === undefined || p.values['--until'] === undefined) throw new Error('USAGE: --since و--until مطلوبان');
  const sinceMs = parseInstant(p.values['--since'], '--since');
  const untilMs = parseInstant(p.values['--until'], '--until');
  if (untilMs <= sinceMs) throw new Error('USAGE: --until يجب أن يلي --since');
  if (untilMs - sinceMs > MAX_WINDOW_MS) throw new Error('USAGE: النافذة تتجاوز 24 ساعة');
  return {mode: 'run', sinceMs, untilMs, out: p.values['--out'] === undefined ? null : p.values['--out']};
}

// ───────────────────────── قراءة القيم ─────────────────────────

/**
 * وقت حقل: مقروء (ms)، أو غائب، أو غير مقروء بنوعه. الغائب ≠ غير المقروء (القاعدة 22).
 * @param {*} v
 * @return {{state: string, ms: ?number, type: ?string}}
 */
function readInstant(v) {
  const type = S.valueKind(v);
  if (type === 'absent') return {state: 'ABSENT', ms: null, type: null};
  if (type === 'timestamp') {
    const ms = S.timestampMs(v);
    return ms === null ? {state: 'UNREADABLE', ms: null, type} : {state: 'OK', ms, type};
  }
  if (type === 'date') {
    const ms = v.getTime();
    return Number.isFinite(ms) ? {state: 'OK', ms, type} : {state: 'UNREADABLE', ms: null, type};
  }
  return {state: 'UNREADABLE', ms: null, type}; // null أو نصّ أو رقم: لا يُحسَب وقتاً (لا تحويل بالتخمين)
}

/** وقت مطبوع بـ+03، أو حالة صريحة. */
function instantForOutput(v) {
  const r = readInstant(v);
  if (r.state === 'OK') return {present: true, plus03: S.toPlus03(r.ms)};
  if (r.state === 'ABSENT') return {present: false};
  return {present: true, plus03: null, unreadableType: r.type};
}

/**
 * وصف حقل غير وقتي: الغائب ≠ null ≠ قيمة (القاعدة 22). النصّ يُطبَع إن طابق pattern وحده؛ وإلا حضوره وطوله. printString=false: لا يُطبَع نصّ أبداً (حضور وطول).
 * @param {?Object} data
 * @param {string} name
 * @param {{pattern?: RegExp, printString?: boolean}} [opt]
 * @return {Object}
 */
function describeScalar(data, name, {pattern = TAG_PATTERN, printString = true} = {}) {
  if (!data || !has(data, name) || data[name] === undefined) return {present: false, type: 'absent'};
  const v = data[name];
  const type = S.valueKind(v);
  if (type === 'null') return {present: true, type, value: null};
  if (type === 'boolean') return {present: true, type, value: v};
  if (type === 'number') return Number.isFinite(v) ? {present: true, type, value: v} : {present: true, type, value: null, valuePrinted: false};
  if (type === 'string') {
    return (printString && pattern.test(v)) ? {present: true, type, value: v} : {present: true, type, value: null, valuePrinted: false, stringLength: v.length};
  }
  return {present: true, type, value: null, valuePrinted: false};
}

/** نوع التقرير من وسم pipeline (الوسوم من pipelineTags.js، المصدر الواحد). الغائب والمجهول حالتان صريحتان. */
function reportKind(pipelineDesc) {
  if (!pipelineDesc.present) return 'ABSENT';
  if (pipelineDesc.value === V7_PIPELINE_TAG) return 'V7';
  if (pipelineDesc.value === V6_PIPELINE_TAG) return 'V6';
  if (pipelineDesc.value === CACHED_PIPELINE_TAG) return 'CACHED';
  return 'OTHER_OR_UNPRINTED';
}

// ───────────────────────── التقارير ─────────────────────────

/**
 * ربط تقرير بجلسته: من reportRaw/{scanId}.sessionId، أو من reports.sessionId (قديم مضمَّن) — readReportRaw المصدر الواحد لحالات الخامّ.
 * الحالات: SESSION · NOT_A_SESSION_SCAN (sessionId=null: فحص شخصي) · SESSION_FIELD_ABSENT · SESSION_FIELD_UNREADABLE · NO_RAW_DOC_AND_NO_LEGACY_FIELD (لا يُعرف الربط).
 * @param {{db: Object, scanId: string, reportData: Object}} p
 * @return {Promise<{state: string, source: string, sessionIdHash: ?string}>}
 */
async function readSessionLink({db, scanId, reportData}) {
  const rawRead = await readReportRaw({db, scanId, reportData});
  if (rawRead.state === RAW_STATE.ABSENT) return {state: 'NO_RAW_DOC_AND_NO_LEGACY_FIELD', source: rawRead.state, sessionIdHash: null};
  const raw = rawRead.raw || {};
  const source = rawRead.state === RAW_STATE.PRIVATE ? 'reportRaw.sessionId' : 'reports.sessionId (legacy embedded)';
  if (!has(raw, 'sessionId') || raw.sessionId === undefined) return {state: 'SESSION_FIELD_ABSENT', source, sessionIdHash: null};
  if (raw.sessionId === null) return {state: 'NOT_A_SESSION_SCAN', source, sessionIdHash: null};
  if (typeof raw.sessionId !== 'string' || raw.sessionId === '') return {state: 'SESSION_FIELD_UNREADABLE', source, sessionIdHash: null};
  return {state: 'SESSION', source, sessionIdHash: C.hashIdForLog(raw.sessionId)};
}

/** عنصر تقرير واحد للمخرَج. دالّة نقيّة على (id، data، ربط الجلسة). */
function buildReportItem({id, data, sessionLink}) {
  const pipeline = describeScalar(data, 'pipeline');
  return {
    scanIdHash: C.hashIdForLog(id),
    createdAtPlus03: instantForOutput(data.createdAt).plus03,
    shortId: describeScalar(data, 'shortId', {pattern: C.SHORT_ID_PATTERN}),
    kind: reportKind(pipeline),
    pipeline,
    sessionLink,
    seal: {
      fieldsVersion: describeScalar(data, 'fieldsVersion'),
      [EVALUATION_RULES_VERSION_FIELD]: describeScalar(data, EVALUATION_RULES_VERSION_FIELD),
    },
    ai: {
      aiModel: describeScalar(data, 'aiModel'),
      aiDurationMs: describeScalar(data, 'aiDurationMs'),
      aiFallbackReason: describeScalar(data, 'aiFallbackReason', {printString: false}), // قد يكون رسالة مزوّد (القاعدة 36): حضور وطول
    },
    appVersion: describeScalar(data, 'appVersion'),
    isFreeTrial: describeScalar(data, 'isFreeTrial'),
  };
}

// ───────────────────────── الجلسات ─────────────────────────

const JOINER_STATE = Object.freeze({ABSENT: 'ABSENT', NULL: 'NULL', EMPTY: 'EMPTY', INVALID_TYPE: 'INVALID_TYPE', PRESENT: 'PRESENT'});

/** المنضمّ: حالة صريحة ومعرّف مُهشَّر. joinScanSession تكتب joinedBy=null حين لا auth (joinScanSession.js:184 `joinedBy: joinerUid`). */
function describeJoiner(data) {
  if (!has(data, 'joinedBy') || data.joinedBy === undefined) return {state: JOINER_STATE.ABSENT, hash: null};
  const v = data.joinedBy;
  if (v === null) return {state: JOINER_STATE.NULL, hash: null};
  if (typeof v !== 'string') return {state: JOINER_STATE.INVALID_TYPE, hash: null};
  if (v === '') return {state: JOINER_STATE.EMPTY, hash: null};
  return {state: JOINER_STATE.PRESENT, hash: C.hashIdForLog(v)};
}

/** scanId على الجلسة: createScanSession تكتبه null عند الإنشاء، والاكتمال يكتب القيمة وحده (sessionCompletion.js:103 بنداء analyzeDevice، S-SWEEP 2026-10-15؛ كان analyzeDevice.js:795-801). */
function describeSessionScanId(data) {
  if (!has(data, 'scanId') || data.scanId === undefined) return {state: 'SCAN_ID_ABSENT', scanIdHash: null};
  if (data.scanId === null) return {state: 'SCAN_ID_NULL', scanIdHash: null};
  if (typeof data.scanId !== 'string' || data.scanId === '') return {state: 'SCAN_ID_UNREADABLE', scanIdHash: null};
  return {state: 'SCAN_ID_SET', scanIdHash: C.hashIdForLog(data.scanId)};
}

/** الحالة: معروفة بقيمتها، أو حالة صريحة (لا تُطبَع قيمة لا تعرفها الشيفرة: classifyStatus المصدر الواحد). */
function describeSessionStatus(data) {
  const c = classifyStatus(data);
  return c.state === STATUS_STATE.KNOWN ? {state: c.state, value: c.status} : {state: c.state, value: null};
}

/** عنصر جلسة واحدة للمخرَج. activeButPastExpiry: جارية (pending/scanning) وانقضى expiresAt ولم تُكتب «منتهية» بعد (isDueForExpiredRecord، المصدر الواحد). */
function buildSessionItem({id, data, nowMs}) {
  const cancelReason = describeScalar(data, 'cancelReason');
  const rawReason = has(data, 'cancelReason') ? data.cancelReason : undefined;
  const outsideVocabulary = typeof rawReason === 'string' && !Object.values(CANCEL_REASON).includes(rawReason);
  return {
    sessionHash: C.hashIdForLog(id),
    status: describeSessionStatus(data),
    createdAtPlus03: instantForOutput(data.createdAt).plus03,
    expiresAt: instantForOutput(data.expiresAt),
    activeButPastExpiry: isDueForExpiredRecord(data, new Date(nowMs)),
    joiner: describeJoiner(data),
    scanLink: describeSessionScanId(data),
    joinedAt: instantForOutput(data.joinedAt),
    completedAt: instantForOutput(data.completedAt),
    expiredAt: instantForOutput(data.expiredAt),
    cancelledAt: instantForOutput(data.cancelledAt),
    cancelReason: outsideVocabulary ? {present: true, type: 'string', value: null, valuePrinted: false, stringLength: rawReason.length, outsideKnownVocabulary: true} : cancelReason,
  };
}

// ───────────────────────── الجمع ─────────────────────────

const byTimeThenHash = (hashKey) => (a, b) => {
  if (a._ms !== b._ms) return a._ms - b._ms;
  return a[hashKey] < b[hashKey] ? -1 : (a[hashKey] > b[hashKey] ? 1 : 0);
};

/**
 * يقسم مستندات استعلام إلى داخل النافذة (since ≤ createdAt < until) وخارجها وغير مقروء الوقت. لا يُسقط مستنداً بصمت: غير المقروء يُعدّ ويُسمّى بمعرّفه المُهشَّر.
 * @param {Array<{id: string, data: Object}>} docs
 * @param {number} sinceMs
 * @param {number} untilMs
 * @return {{inWindow: Array<{id: string, data: Object, ms: number}>, outside: number, unreadable: Array<{hash: string, state: string, type: ?string}>}}
 */
function partitionByWindow(docs, sinceMs, untilMs) {
  const inWindow = [];
  const unreadable = [];
  let outside = 0;
  for (const d of docs) {
    const t = readInstant(d.data.createdAt);
    if (t.state !== 'OK') { unreadable.push({hash: C.hashIdForLog(d.id), state: t.state, type: t.type}); continue; }
    if (t.ms >= sinceMs && t.ms < untilMs) inWindow.push({...d, ms: t.ms});
    else outside++;
  }
  return {inWindow, outside, unreadable};
}

/**
 * قراءة بحتة: getUserByEmail ← uid ← (users/{uid}، تقارير المالك، جلساته) ← مخرَج بلا بريد ولا uid ولا معرّف خامّ.
 * @param {{db: Object, auth: {getUserByEmail: function(string): Promise<{uid: string}>}, email: string, sinceMs: number, untilMs: number, nowMs: number, caps?: {reports: number, sessions: number, rawReads: number}}} p
 * @return {Promise<Object>}
 */
async function collectOwnerActivity({db, auth, email, sinceMs, untilMs, nowMs, caps = DEFAULT_CAPS}) {
  const {uid, accountHash} = await C.resolveOwner({auth, email});

  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : null;

  // التقارير: مساواة userId وحدها (فهرس مفرد تلقائي)، بقناع حقول، حتى السقف+1 ليُعرَف بلوغه.
  const reportsTotal = await C.countAccountReports(db, uid);
  const repSnap = await db.collection(REPORTS_COLLECTION).where('userId', '==', uid).select(...REPORT_SELECT).limit(caps.reports + 1).get();
  const repCapReached = repSnap.docs.length > caps.reports;
  const repDocs = repSnap.docs.slice(0, caps.reports).map((d) => ({id: d.id, data: d.data() || {}}));
  const repPart = partitionByWindow(repDocs, sinceMs, untilMs);

  // ربط كل تقرير في النافذة بجلسته (حتى سقف قراءات reportRaw؛ ما فوقه حالة صريحة لا غياب).
  const reportItems = [];
  let rawReads = 0;
  let rawCapReached = false;
  for (const d of repPart.inWindow) {
    let sessionLink;
    if (rawReads >= caps.rawReads) {
      rawCapReached = true;
      sessionLink = {state: 'NOT_READ_RAW_CAP_REACHED', source: null, sessionIdHash: null};
    } else {
      rawReads++;
      sessionLink = await readSessionLink({db, scanId: d.id, reportData: d.data});
    }
    reportItems.push({_ms: d.ms, ...buildReportItem({id: d.id, data: d.data, sessionLink})});
  }
  reportItems.sort(byTimeThenHash('scanIdHash'));

  // الجلسات: مساواة ownerId وحدها.
  const sessionsTotal = (await db.collection(SESSIONS_COLLECTION).where('ownerId', '==', uid).count().get()).data().count;
  const sesSnap = await db.collection(SESSIONS_COLLECTION).where('ownerId', '==', uid).select(...SESSION_SELECT).limit(caps.sessions + 1).get();
  const sesCapReached = sesSnap.docs.length > caps.sessions;
  const sesDocs = sesSnap.docs.slice(0, caps.sessions).map((d) => ({id: d.id, data: d.data() || {}}));
  const sesPart = partitionByWindow(sesDocs, sinceMs, untilMs);
  const sessionItems = sesPart.inWindow
      .map((d) => ({_ms: d.ms, ...buildSessionItem({id: d.id, data: d.data, nowMs})}))
      .sort(byTimeThenHash('sessionHash'));

  const links = buildLinks(reportItems, sessionItems);
  const strip = (items) => items.map(({_ms, ...rest}) => rest);
  const complete = !repCapReached && !sesCapReached && !rawCapReached;

  return {
    window: {
      sincePlus03: S.toPlus03(sinceMs), untilPlus03: S.toPlus03(untilMs), spanMinutes: (untilMs - sinceMs) / MINUTE_MS,
      rule: 'since <= createdAt < until (applied in memory; createdAt must be a Firestore Timestamp or Date)',
    },
    account: {
      accountHash,
      userDocExists: userData !== null,
      scansRemaining: S.describeField(userData, 'scansRemaining'),
      reportsTotal,
      sessionsTotal,
    },
    completeness: {
      complete,
      reports: {docsRead: repDocs.length, cap: caps.reports, capReached: repCapReached},
      sessions: {docsRead: sesDocs.length, cap: caps.sessions, capReached: sesCapReached},
      reportRawReads: {done: rawReads, cap: caps.rawReads, capReached: rawCapReached},
    },
    selection: {
      reports: 'reports where userId == the owner uid. Session scans store the session OWNER in userId (analyzeDevice.js:411 userId = sessionDoc.data().ownerId; buildReportDocument userId: p.userId), so one equality covers ' +
          'personal scans and the scans of every session the owner created. The session link is read per report from reportRaw/{scanId}.sessionId (V8 moved sessionId off the report document: reportRawStore.js REPORT_RAW_FIELDS), ' +
          'or from reports.sessionId in a legacy embedded report. No query by sessionId on reports (it would match nothing for V8 reports).',
      sessions: 'scanSessions where ownerId == the owner uid.',
      indexes: 'Both queries are a single equality filter (the automatic single-field index); the time window is applied in memory. No composite index is used or needed.',
      printedReportFields: [...REPORT_SELECT],
      printedSessionFields: [...SESSION_SELECT],
    },
    reports: {
      inWindow: reportItems.length,
      outsideWindow: repPart.outside,
      unreadableCreatedAt: {count: repPart.unreadable.length, items: repPart.unreadable},
      items: strip(reportItems),
    },
    sessions: {
      inWindow: sessionItems.length,
      outsideWindow: sesPart.outside,
      unreadableCreatedAt: {count: sesPart.unreadable.length, items: sesPart.unreadable},
      items: strip(sessionItems),
    },
    links,
  };
}

/**
 * ربط الفحص بالجلسات من الجهتين: reportRaw.sessionId (ما ارتبط به التقرير) وscanSessions.scanId (ما كتبه الخادم على الجلسة عند الاكتمال). فحص واحد تحت أكثر من جلسة يظهر هنا بـmultipleSessions=true.
 * يُبنى من عناصر النافذة وحدها (جلسة خارج النافذة لا تظهر؛ تُذكر بمعرّفها المُهشَّر إن ربطها تقرير).
 * @param {Array<Object>} reportItems
 * @param {Array<Object>} sessionItems
 * @return {Array<Object>}
 */
function buildLinks(reportItems, sessionItems) {
  // قواميس بلا Map.set/Set.add: يحرس الحارس الساكن (ownerActivityWindow.test.js §٩) كلّ `.add(`/`.set(` كتابةَ Firestore محتملة، فلا تُستعمل هنا.
  const byScan = {};
  const entry = (scanIdHash) => {
    if (!has(byScan, scanIdHash)) byScan[scanIdHash] = {scanIdHash, reportLinkedSessions: [], sessionsPointingAtScan: []};
    return byScan[scanIdHash];
  };
  const pushUnique = (arr, v) => { if (!arr.includes(v)) arr.push(v); };
  for (const r of reportItems) if (r.sessionLink.state === 'SESSION') pushUnique(entry(r.scanIdHash).reportLinkedSessions, r.sessionLink.sessionIdHash);
  for (const s of sessionItems) if (s.scanLink.state === 'SCAN_ID_SET') pushUnique(entry(s.scanLink.scanIdHash).sessionsPointingAtScan, s.sessionHash);
  const windowSessionHashes = sessionItems.map((s) => s.sessionHash);
  const out = [];
  for (const e of Object.values(byScan)) {
    const all = [];
    for (const h of [...e.reportLinkedSessions, ...e.sessionsPointingAtScan]) pushUnique(all, h);
    out.push({
      scanIdHash: e.scanIdHash,
      reportLinkedSession: [...e.reportLinkedSessions].sort(),
      sessionsPointingAtScan: [...e.sessionsPointingAtScan].sort(),
      distinctSessions: all.length,
      multipleSessions: all.length > 1,
      reportLinkedSessionOutsideWindow: e.reportLinkedSessions.filter((h) => !windowSessionHashes.includes(h)).sort(),
    });
  }
  return out.sort((a, b) => (a.scanIdHash < b.scanIdHash ? -1 : (a.scanIdHash > b.scanIdHash ? 1 : 0)));
}

/** فحص ذاتي بلا شبكة. */
function preflightChecks(env = process.env) {
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const T = (s) => parseInstant(s, '--since');
  const checks = [
    ['نافذة صالحة', (() => { const a = parseArgs(['--since', '2026-10-14T17:00:00+03:00', '--until', '2026-10-14T18:00:00+03:00']); return a.mode === 'run' && a.untilMs - a.sinceMs === 3600000 && a.out === null; })()],
    ['Z و+03 يطابقان', T('2026-10-14T14:00:00Z') === T('2026-10-14T17:00:00+03:00')],
    ['بلا إزاحة مرفوضة', bad(['--since', '2026-10-14T17:00:00', '--until', '2026-10-14T18:00:00+03:00'], /إزاحة صريحة/)],
    ['30 شباط مرفوض', bad(['--since', '2026-02-30T00:00:00+03:00', '--until', '2026-03-01T00:00:00+03:00'], /إزاحة صريحة/)],
    ['أكثر من 24 ساعة مرفوض', bad(['--since', '2026-10-14T00:00:00+03:00', '--until', '2026-10-15T00:00:01+03:00'], /24 ساعة/)],
    ['24 ساعة بالضبط مقبولة', parseArgs(['--since', '2026-10-14T00:00:00+03:00', '--until', '2026-10-15T00:00:00+03:00']).mode === 'run'],
    ['--until بعد --since', bad(['--since', '2026-10-14T18:00:00+03:00', '--until', '2026-10-14T17:00:00+03:00'], /يلي/)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--since', '2026-10-14T17:00:00+03:00'], /--preflight وحدها/)],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
    ['إزاحة +03', S.toPlus03(Date.UTC(2026, 9, 14, 6, 0, 0)) === '2026-10-14T09:00:00.000+03:00'],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), ownerEmailEnvPresent: typeof env[C.OWNER_EMAIL_ENV] === 'string' && env[C.OWNER_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {
  MODE, SCHEMA, REPORTS_COLLECTION, SESSIONS_COLLECTION, USERS_COLLECTION, MAX_WINDOW_MS, DEFAULT_CAPS, REPORT_SELECT, SESSION_SELECT, JOINER_STATE,
  REPORT_RAW_FIELDS, REPORT_RAW_COLLECTION, toPlus03: S.toPlus03,
  parseInstant, parseArgs, readInstant, describeScalar, reportKind, readSessionLink, buildReportItem, describeJoiner, describeSessionScanId, describeSessionStatus, buildSessionItem,
  partitionByWindow, buildLinks, collectOwnerActivity, preflightChecks,
};
