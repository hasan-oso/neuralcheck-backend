'use strict';

// ===================================================================
// deviceCheck03Before — لقطة «قبل الجلسات» لفحص الجهاز ٠٣ (الكتلة أ٣)، 2026-10-10 +03. قراءة بحتة. يستعمله device-check-03-before-readonly.js.
//
// ما يقرؤه (أمر المنسّق، بنصّه المنقول): بريد حساب المالك (حساب الـS10) من متغيّر بيئة، ثم:
//   ١) `users/{uid}.evaluationEnabled` **بقيمته ونوعه**، **وسببه المسمّى** من src/sessions/evaluationEnabledState.js — المصدر نفسه الذي تستعمله joinScanSession (دالّة القرار evaluationEnabledDecision
//      على مستند المالك أو null إن غاب، كما في joinScanSession.js: `owner = ownerDoc.exists ? ownerDoc.data() : null`). لا منطق نُسخ هنا.
//   ٢) **عدد تقارير الحساب** بالطريقة نفسها التي يعدّ بها s10PostDeploy: countAccountReports (دالّة واحدة مصدرها scripts/lib/s10PostDeploy.js).
//   ٣) **عدد الجلسات بحالاتها** من scripts/lib/activeSessions.js: collectActive وsummarize (القراءة نفسها لا نسخة منطقها) — لكل الجلسات (pending/scanning بنافذة createdAt، والنهائية، وغير المصنَّف).
//
// القاعدة 22: الغياب حالة صريحة — مستند المستخدم الغائب `userDocExists=false` (وسبب القرار OWNER_DOC_MISSING)، والحقل الغائب `present=false` (FLAG_ABSENT)؛ لا قيمة افتراضية تسدّ شيئاً منهما.
// المخرَج بلا بريد ولا uid: معرّف مُهشَّر (hashIdForLog) وأعداد وحالات وحدها.
// ===================================================================

const A = require('./activeSessions');
const {evaluationEnabledDecision, valueTypeForLog} = require('../../src/sessions/evaluationEnabledState');
const C = require('./deviceCheck03Common');

const USERS_COLLECTION = 'users';
const MODE = 'device-check-03-before';
/** نصّ يُطبَع كما هو إن كان قصيراً وبحروف اسم/رمز فقط؛ غيره لا يُطبَع (قد يحمل أيّ شيء) ويُذكر طوله. */
const PRINTABLE_STRING = /^[A-Za-z0-9_.:-]{0,32}$/;

/**
 * قيمة الحقل ونوعه للطباعة. الغائب ≠ null ≠ false (القاعدة 22).
 * @param {?Object} userData بيانات مستند المستخدم، أو null إن غاب المستند.
 * @return {{present: boolean, type: string, value: *, valuePrinted: boolean, stringLength?: number}}
 */
function describeFlagValue(userData) {
  if (!userData || !Object.prototype.hasOwnProperty.call(userData, 'evaluationEnabled') || userData.evaluationEnabled === undefined) {
    return {present: false, type: 'absent', value: null, valuePrinted: false};
  }
  const v = userData.evaluationEnabled;
  const type = valueTypeForLog(v);
  if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return {present: true, type, value: v, valuePrinted: true};
  if (typeof v === 'string') {
    if (PRINTABLE_STRING.test(v)) return {present: true, type, value: v, valuePrinted: true};
    return {present: true, type, value: null, valuePrinted: false, stringLength: v.length};
  }
  return {present: true, type, value: null, valuePrinted: false}; // رقم غير منتهٍ، كائن، مصفوفة: النوع وحده
}

/**
 * لقطة «قبل». قراءة بحتة.
 * @param {Object} p
 * @param {Object} p.db Firestore (مغلَّف بـwrapReadOnly)
 * @param {{getUserByEmail: function(string): Promise<{uid: string}>}} p.auth عمليّة Auth الوحيدة المتاحة
 * @param {string} p.email من متغيّر البيئة (لا يُطبَع ولا يُكتب)
 * @param {number} p.nowMs
 * @param {number} [p.claimsWindowMin]
 * @return {Promise<Object>} مخرَج بلا بريد ولا uid
 */
async function collectBefore({db, auth, email, nowMs, claimsWindowMin = A.CLAIMS_WINDOW_MIN_DEFAULT}) {
  const {uid, accountHash} = await C.resolveOwner({auth, email});
  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : null;
  const decision = evaluationEnabledDecision(userData);
  const evaluationEnabled = {
    userDocExists: userSnap.exists,
    ...describeFlagValue(userData),
    decision: {value: decision.value, reason: decision.reason, valueType: decision.valueType},
    reasonSource: 'src/sessions/evaluationEnabledState.js (evaluationEnabledDecision — the same source joinScanSession uses)',
  };
  const accountReportsCount = await C.countAccountReports(db, uid);
  const collected = await A.collectActive({db, nowMs, claimsWindowMin});
  const summary = A.summarize(collected, {claimsWindowMin, claimsWindowIsDefault: claimsWindowMin === A.CLAIMS_WINDOW_MIN_DEFAULT});
  return {
    account: {accountHash},
    evaluationEnabled,
    reports: {accountReportsCount, countMethod: "reports.where('userId' == uid).count() — s10PostDeploy.countAccountReports"},
    activeSessions: {criteria: summary.criteria, sessions: summary.sessions, claims: summary.claims, verdict: summary.verdict},
  };
}

/** الوسائط: --out <before.json> أو --preflight. (لا بريد ولا أيّ شيء آخر من سطر الأمر.) */
function parseArgs(argv) {
  const usage = 'USAGE: --out <before.json> | --preflight';
  const p = C.parseFlags(argv, {values: ['--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (p.values['--out'] !== undefined) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', out: null};
  }
  if (p.values['--out'] === undefined) throw new Error(usage);
  return {mode: 'run', out: p.values['--out']};
}

/** فحص ذاتي بلا شبكة. */
function preflightChecks(env = process.env) {
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const flag = (v) => describeFlagValue({evaluationEnabled: v});
  const checks = [
    ['--out وحده: وضع التشغيل', (() => { const a = parseArgs(['--out', 'b.json']); return a.mode === 'run' && a.out === 'b.json'; })()],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--out', 'b.json'], /--preflight وحدها/)],
    ['بلا وسائط: USAGE', bad([], /USAGE: --out/)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--out', 'b.json', '--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['وسيط موضعي يُرفض', bad(['x'], /وسيط موضعي|\(موضعي\)/)],
    ['القرار: true ⟵ FLAG_TRUE', evaluationEnabledDecision({evaluationEnabled: true}).reason === 'FLAG_TRUE'],
    ['القرار: false ⟵ FLAG_FALSE', evaluationEnabledDecision({evaluationEnabled: false}).reason === 'FLAG_FALSE'],
    ['القرار: الحقل غائب ⟵ FLAG_ABSENT', evaluationEnabledDecision({}).reason === 'FLAG_ABSENT'],
    ['القرار: المستند غائب ⟵ OWNER_DOC_MISSING', evaluationEnabledDecision(null).reason === 'OWNER_DOC_MISSING'],
    ['القرار: نصّ "true" ⟵ FLAG_NOT_BOOLEAN بنوع string', (() => { const d = evaluationEnabledDecision({evaluationEnabled: 'true'}); return d.reason === 'FLAG_NOT_BOOLEAN' && d.valueType === 'string' && d.value === false; })()],
    ['الوصف: القيمة المنطقية تُطبَع', (() => { const f = flag(true); return f.present && f.type === 'boolean' && f.value === true && f.valuePrinted; })()],
    ['الوصف: الغائب ≠ null', (() => { const g = describeFlagValue({}); const n = flag(null); return g.present === false && g.type === 'absent' && n.present === true && n.type === 'null'; })()],
    ['الوصف: نصّ طويل أو بحروف غريبة لا يُطبَع (طوله فقط)', (() => { const f = flag('x@y.z'); return f.valuePrinted === false && f.value === null && f.stringLength === 5; })()],
    ['الوصف: كائن ومصفوفة: النوع وحده', flag({a: 1}).type === 'object' && flag([1]).type === 'array' && flag({a: 1}).valuePrinted === false],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), ownerEmailEnvPresent: typeof env[C.OWNER_EMAIL_ENV] === 'string' && env[C.OWNER_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {MODE, USERS_COLLECTION, PRINTABLE_STRING, describeFlagValue, collectBefore, parseArgs, preflightChecks};
