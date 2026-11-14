'use strict';

// ===================================================================
// subscriptionState — لقطة اشتراك ورصيد حساب واحد، وما تحكم به بوابة analyzeDevice والمهمّة المجدولة checkExpiringSubscriptions عليها، 2026-10-14 +03. قراءة بحتة.
// يستعمله subscription-state-readonly.js.
//
// السبب (نصّ المستخدم، 2026-10-14، منقول من أمر المنسّق، غير متحقَّق): فحص الـS21 اكتمل قياسه ولم يصدر تقريره، وظهر «انتهى اشتراكك يرجى التجديد»، والفحص باقٍ على الهاتف.
// الفرضية المطروحة: المهمّة المجدولة صفّرت scansRemaining. والسكربت يقرأ ما يحسم: القيم الفعلية لحقول الاشتراك، وما تقوله البوابة عليها، وما ستفعله المهمّة عليها.
//
// ─── ما يُقرأ ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   مستند users/{uid} لحساب واحد (البريد من DEVICE_CHECK_03_OWNER_EMAIL ← getUserByEmail ← uid في الذاكرة وحدها). **الحقول المطبوعة قائمة بيضاء من عشرة** (FIELDS أدناه) وما سواها لا يُنسخ إلى المخرَج:
//   لا بريد، ولا fcmToken، ولا اسم، ولا هاتف، ولا أيّ مفتاح آخر (ولا أسماؤها). الـAdmin SDK لا يدعم قناع حقول لـDocumentReference.get() فيصل المستند كلّه إلى ذاكرة العملية، ولا يُنسخ منه إلا ما في القائمة.
//   freeTrialUsedDevices يُطبَع **عدده فقط** (قائمة أجهزة، تقرؤها البوابة لباقة free وحدها).
//
// ─── ما يُحسَب (مرآة مُعلَنة لا مصدر ثانٍ) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   gate  : **الدالّة الحقيقية نفسها** (S-SUB، 2026-10-16): الحكم من checkSubscriptionVerdict (src/analysis/scanRefusal.js: الجزء غير المعتمد على الجهاز من scanGateVerdict — الرصيد فالانتهاء) التي
//           يستدعي أصلها الفحصُ المبكّر في analyzeDevice.js ومعاملة الحجز في scanReservation.js وردُّ checkSubscription، والنصّ والرمز من SCAN_REFUSAL_TEXT وSCAN_REFUSAL_CODE (مستوردة لا منسوخة). كان
//           هنا مرآة بترتيب analyzeDevice.js:456-474 وscanReservation.js:94-99 وشرط رصيد مزدوج (المبكّر `<= 0` والحجز `>= 1`)؛ فلا مرآة بعد الآن، ويحرس الاتّساق مع المصادر subscriptionState.test.js
//           وscanRefusalGuard.test.js. فحص الجهاز المجاني خارج الحكم هنا (يحتاج بصمة الجهاز المفحوص).
//   cron  : شروط الاستعلامات الثلاثة في checkExpiringSubscriptions.js:59-62 و:111-115 و:163-167 وما تكتبه (:67-72). **وجود الفهرس المركّب الذي تحتاجه هذه الاستعلامات غير مقروء من هنا** (يُعلَن في المخرَج).
//
// القاعدة 22: الغياب حالة صريحة (present=false، type=absent)، ولا قيمة افتراضية تسدّه إلا حيث تسدّه الشيفرة الحقيقية (وتُسمّى: scansRemainingEffective = scansRemaining || 0 كما في analyzeDevice.js:456).
// المخرَج بلا بريد ولا uid: معرّف مُهشَّر (hashIdForLog). التواريخ بـ+03 (لا توقيت صيفي في +03 منذ 2016 لتركيا ومنذ 2022 لدمشق؛ يُتحقَّق من دمشق بـIntl في nextCronRun).
// ===================================================================

const C = require('./deviceCheck03Common');
const {toDateOrNull, isSubscriptionExpired} = require('../../src/utils/subscription');
const {
  SCAN_REFUSAL_TEXT, SCAN_REFUSAL_CODE, CHECK_SUBSCRIPTION_VERDICT, checkSubscriptionVerdict,
} = require('../../src/analysis/scanRefusal');

const MODE = 'subscription-state';
const USERS_COLLECTION = 'users';

/** القائمة البيضاء الوحيدة لما يُنسَخ من مستند المستخدم (مصدر واحد، القاعدة 24). */
const FIELDS = Object.freeze([
  'plan', 'scansRemaining', 'scansTotal', 'isActive', 'expiresAt',
  'subExpiredNotified', 'subExpiredAt', 'subExpiryEmailSent', 'subExpiryFcmDate', 'freeTrialUsedDevices',
]);

/** نصّ يُطبَع كما هو إن كان قصيراً وبحروف اسم/رمز/تاريخ فقط؛ غيره لا يُطبَع ويُذكر طوله. */
const PRINTABLE_STRING = /^[A-Za-z0-9_.:+-]{0,40}$/;

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** ثوابت المهمّة المجدولة كما في checkExpiringSubscriptions.js:27-28 و:34 و:165 و:172 (يحرسها الاختبار). */
const CRON = Object.freeze({
  functionName: 'checkExpiringSubscriptions',
  schedule: 'every day 09:00',
  timeZone: 'Asia/Damascus',
  localHour: 9,
  reminderWindowDays: 3,
  lowScansMax: 3,
  shopPlans: Object.freeze(['shop_basic', 'shop_pro']),
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** وقت بصيغة ISO بإزاحة +03 (إزاحة ثابتة: +03 بلا توقيت صيفي). */
function toPlus03(ms) {
  return new Date(ms + OFFSET_MS).toISOString().replace('Z', '+03:00');
}

/** نوع القيمة كما يميّزه Firestore: timestamp (كائن Timestamp) ≠ number ≠ string. الغائب ≠ null. */
function valueKind(v) {
  if (v === undefined) return 'absent';
  if (v === null) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (typeof v === 'object' && typeof v.toMillis === 'function' && typeof v.toDate === 'function') return 'timestamp';
  if (typeof v === 'object') return 'object';
  return typeof v;
}

/** ميلّي ثانية Timestamp أو null إن تعذّر (لا استثناء يتسرّب). */
function timestampMs(v) {
  try {
    const ms = v.toMillis();
    return Number.isFinite(ms) ? ms : null;
  } catch (e) {
    return null;
  }
}

/**
 * وصف حقل واحد: حضوره ونوعه وقيمته (إن كانت قابلة للطباعة بأمان). الغائب ≠ null ≠ false (القاعدة 22).
 * @param {?Object} userData مستند المستخدم، أو null إن غاب.
 * @param {string} name اسم حقل من FIELDS.
 * @return {Object}
 */
function describeField(userData, name) {
  if (!FIELDS.includes(name)) throw new Error(`FIELD_NOT_WHITELISTED: ${name}`);
  if (!userData || !has(userData, name) || userData[name] === undefined) return {present: false, type: 'absent'};
  const v = userData[name];
  const type = valueKind(v);
  switch (type) {
    case 'null': return {present: true, type, value: null};
    case 'boolean': return {present: true, type, value: v};
    case 'number': return Number.isFinite(v) ? {present: true, type, value: v} : {present: true, type, value: null, valuePrinted: false};
    case 'string':
      return PRINTABLE_STRING.test(v) ? {present: true, type, value: v} : {present: true, type, value: null, valuePrinted: false, stringLength: v.length};
    case 'timestamp': {
      const ms = timestampMs(v);
      return ms === null ? {present: true, type, plus03: null, epochMs: null} : {present: true, type, plus03: toPlus03(ms), epochMs: ms};
    }
    case 'date': {
      const ms = v.getTime();
      return Number.isFinite(ms) ? {present: true, type, plus03: toPlus03(ms), epochMs: ms} : {present: true, type, plus03: null, epochMs: null};
    }
    case 'array': return {present: true, type, length: v.length}; // freeTrialUsedDevices: العدد وحده
    default: return {present: true, type, value: null, valuePrinted: false};
  }
}

/**
 * المشغَّل التالي والسابق للمهمّة المجدولة: 09:00 بتوقيت Asia/Damascus (checkExpiringSubscriptions.js:27-28). يُتحقَّق بـIntl أن الساعة هناك 09:00 فعلاً عند الحساب بإزاحة +03.
 * @param {number} nowMs
 * @return {{next: {ms: number, plus03: string}, previous: {ms: number, plus03: string}, damascusWallClockVerified: boolean}}
 */
function nextCronRun(nowMs) {
  const local = new Date(nowMs + OFFSET_MS); // حقول UTC فيه = الساعة الجدارية بـ+03
  let next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), CRON.localHour, 0, 0) - OFFSET_MS;
  if (next <= nowMs) next += DAY_MS;
  const wall = (ms) => new Intl.DateTimeFormat('en-GB', {timeZone: CRON.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(ms));
  const expectedWall = `${String(CRON.localHour).padStart(2, '0')}:00`;
  const previous = next - DAY_MS;
  return {
    next: {ms: next, plus03: toPlus03(next)},
    previous: {ms: previous, plus03: toPlus03(previous)},
    damascusWallClockVerified: wall(next) === expectedWall && wall(previous) === expectedWall,
  };
}

/**
 * ما تحكم به البوابة على هذا المستند الآن — من الدالّة الحقيقية نفسها (checkSubscriptionVerdict في scanRefusal.js: الرصيد ثم الانتهاء)، لا من مرآة. الحقول والقيم كما كانت: verdict
 * هو 'PASSES_BALANCE_AND_EXPIRY' أو سبب الرفض ('NO_CREDIT (users doc missing)' للمستند الغائب)؛ والمراحل (stages) تُشتقّ من نتيجة الدالّة لا من شروط منسوخة.
 * @param {?Object} userData مستند المستخدم أو null.
 * @param {number} nowMs
 * @return {Object}
 */
function evaluateGate(userData, nowMs) {
  const stages = [];
  const now = new Date(nowMs);
  const balanceRaw = userData ? userData.scansRemaining : undefined;
  const effective = userData ? (userData.scansRemaining || 0) : 0; // scanRefusal.js: `(userData && userData.scansRemaining) || 0`
  const expired = userData ? isSubscriptionExpired(userData, now) : false;
  const parsed = userData ? toDateOrNull(userData.expiresAt) : null;
  const GATE_LABEL = 'scanRefusal.js scanGateVerdict (analyzeDevice early check + scanReservation transaction; checkSubscription reads the same)';

  const gate = checkSubscriptionVerdict(userData, now); // ALLOWED | NO_CREDIT | SUBSCRIPTION_EXPIRED
  const reason = gate === CHECK_SUBSCRIPTION_VERDICT.ALLOWED ? null : gate;
  const refusal = reason === null ? null : {
    stage: GATE_LABEL,
    reason: (userData === null && reason === CHECK_SUBSCRIPTION_VERDICT.NO_CREDIT) ? 'NO_CREDIT (users doc missing)' : reason,
    message: SCAN_REFUSAL_TEXT[reason],
    errorCode: SCAN_REFUSAL_CODE,
  };
  // المراحل من نتيجة الدالّة: الرصيد ثم الانتهاء (ما بعد أوّل رفض لا يُقيَّم).
  stages.push({stage: 'scanGateVerdict step 1 — balance: (scansRemaining || 0) >= 1', passes: reason !== CHECK_SUBSCRIPTION_VERDICT.NO_CREDIT});
  if (reason !== CHECK_SUBSCRIPTION_VERDICT.NO_CREDIT) {
    stages.push({stage: 'scanGateVerdict step 2 — expiry: isSubscriptionExpired(userData)', passes: reason !== CHECK_SUBSCRIPTION_VERDICT.SUBSCRIPTION_EXPIRED});
  }
  if (userData && reason === null) {
    const planForTrial = userData.plan || 'free';
    stages.push({
      stage: 'scanGateVerdict step 3 — free-trial device check (plan free only)',
      passes: null,
      note: planForTrial === 'free' ? 'NOT_EVALUATED — needs the scanned device fingerprint (model_androidVersion_totalRamGb)' : 'not applicable (plan is not free)',
    });
  }

  const anomalies = [];
  if (userData) {
    if (valueKind(balanceRaw) !== 'number' && balanceRaw !== undefined) anomalies.push(`SCANS_REMAINING_NOT_A_NUMBER (type=${valueKind(balanceRaw)})`);
    if (valueKind(userData.expiresAt) !== 'absent' && parsed === null) anomalies.push('EXPIRES_AT_UNPARSEABLE (the gate treats it as no expiry)');
  }
  const planEffective = userData ? (userData.plan || 'free') : null;
  return {
    mirrorOf: GATE_LABEL,
    userDocExists: userData !== null,
    scansRemainingEffective: userData && valueKind(balanceRaw) !== 'number' && balanceRaw !== undefined ? `non-number (${valueKind(balanceRaw)})` : effective,
    expiresAtParsedPlus03: parsed ? toPlus03(parsed.getTime()) : null,
    subscriptionExpired: expired,
    expiryRuleNote: 'absent / null / unparseable expiresAt = no expiry (utils/subscription.js:7-10); expired = expiresAt < now (strict)',
    isActiveIsReadByTheGate: false, // scanRefusal.js وanalyzeDevice.js وscanReservation.js وcreateScanSession.js لا تقرأ isActive إطلاقاً
    planEffective,
    verdict: refusal === null ? 'PASSES_BALANCE_AND_EXPIRY' : refusal.reason,
    refusedAt: refusal ? refusal.stage : null,
    refusal: refusal ? {code: refusal.errorCode, message: refusal.message} : null,
    stages,
    anomalies,
  };
}

/**
 * ما ستفعله المهمّة المجدولة على هذا المستند: هل يطابق استعلامها، الآن وعند المشغَّل التالي؟ (لا تقدير لوجود الفهرس.)
 * @param {?Object} userData
 * @param {number} nowMs
 * @return {Object}
 */
function evaluateCron(userData, nowMs) {
  const run = nextCronRun(nowMs);
  const isActiveTrue = !!userData && userData.isActive === true; // where("isActive","==",true): تطابق منطقيٌّ true وحده
  const expKind = userData ? valueKind(userData.expiresAt) : 'absent';
  const expMs = expKind === 'timestamp' ? timestampMs(userData.expiresAt) : null; // استعلام Firestore بـDate لا يطابق إلا قيماً من نوع timestamp
  const zeroedAt = (atMs) => isActiveTrue && expMs !== null && expMs <= atMs;
  const remindAt = (atMs) => isActiveTrue && expMs !== null && expMs <= atMs + CRON.reminderWindowDays * DAY_MS && expMs > atMs;
  const balance = userData ? userData.scansRemaining : undefined;
  const lowAt = isActiveTrue && typeof balance === 'number' && balance <= CRON.lowScansMax && balance > 0;
  const plan = userData ? userData.plan : undefined;
  const anomalies = [];
  if (userData && expKind !== 'absent' && expKind !== 'timestamp') anomalies.push(`EXPIRES_AT_NOT_A_TIMESTAMP (type=${expKind}) — the cron queries (a)(b) never match it, while the gate may still treat it as expired`);
  if (userData && userData.isActive !== undefined && typeof userData.isActive !== 'boolean') anomalies.push(`IS_ACTIVE_NOT_A_BOOLEAN (type=${valueKind(userData.isActive)})`);
  return {
    mirrorOf: 'checkExpiringSubscriptions.js (a) :59-62 · (b) :111-115 · (c) :163-167',
    schedule: {expression: CRON.schedule, timeZone: CRON.timeZone, nextRunPlus03: run.next.plus03, previousRunPlus03: run.previous.plus03, damascusWallClockVerified: run.damascusWallClockVerified},
    indexNote: 'Each of the three users queries combines an equality filter and a range filter on different fields, so Firestore needs a manual (composite) index for each; firestore.indexes.json declares none for users (only two for reports), and live indexes are NOT read here — check with: gcloud firestore indexes composite list --project neuralchek-9b6d7',
    zeroing: {
      query: 'users where isActive == true AND expiresAt <= now',
      isActiveIsTrue: isActiveTrue,
      expiresAtType: expKind,
      expiresAtIsTimestamp: expKind === 'timestamp',
      matchesAtPreviousRun: zeroedAt(run.previous.ms), // هل كان سيطابق عند المشغَّل السابق؟ مطابقة سابقة مع رصيد سليم الآن = المهمّة لم تصفّره (فهرس مفقود أو فشل أو لم تُشغَّل)
      matchesNow: zeroedAt(nowMs),
      matchesAtNextRun: zeroedAt(run.next.ms),
      writesIfMatched: {isActive: false, subExpiredNotified: true, subExpiredAt: 'serverTimestamp'}, // A-SUB البند ٤-أ (2026-10-17): لا تصفير — scansRemaining لا يُكتب والرصيد يبقى (كان {scansRemaining: 0, …} قبل الإصلاح)
      emailAndPushWouldBeSkipped: !!userData && !!userData.subExpiredNotified, // :76
    },
    reminder: {query: 'users where isActive == true AND now < expiresAt <= now+3d', matchesNow: remindAt(nowMs), matchesAtNextRun: remindAt(run.next.ms)},
    lowScans: {
      query: 'users where isActive == true AND 0 < scansRemaining <= 3 (email only if plan is shop_basic/shop_pro and user.email is present — email presence is not read here)',
      matchesNow: lowAt,
      planIsShop: CRON.shopPlans.includes(plan),
    },
    anomalies,
  };
}

/**
 * البناء الخالص للمخرَج من مستند (أو null).
 * @param {{accountHash: string, userData: ?Object, nowMs: number}} p
 * @return {Object}
 */
function buildState({accountHash, userData, nowMs}) {
  const fields = {};
  for (const f of FIELDS) fields[f] = describeField(userData, f);
  return {
    account: {accountHash, userDocExists: userData !== null},
    fields,
    gate: evaluateGate(userData, nowMs),
    cron: evaluateCron(userData, nowMs),
  };
}

/**
 * قراءة بحتة: getUserByEmail ← uid ← users/{uid}.get() ← buildState.
 * @param {{db: Object, auth: {getUserByEmail: function(string): Promise<{uid: string}>}, email: string, nowMs: number}} p
 * @return {Promise<Object>} مخرَج بلا بريد ولا uid
 */
async function collectSubscriptionState({db, auth, email, nowMs}) {
  const {uid, accountHash} = await C.resolveOwner({auth, email});
  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  const userData = userSnap.exists ? (userSnap.data() || {}) : null;
  return buildState({accountHash, userData, nowMs});
}

/** الوسائط: --preflight وحدها، أو (بلا وسائط | --out <path>). لا بريد ولا شيء آخر من سطر الأمر. */
function parseArgs(argv) {
  const p = C.parseFlags(argv, {values: ['--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (p.values['--out'] !== undefined) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', out: null};
  }
  return {mode: 'run', out: p.values['--out'] === undefined ? null : p.values['--out']};
}

/** فحص ذاتي بلا شبكة. */
function preflightChecks(env = process.env) {
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const NOW = Date.UTC(2026, 9, 14, 7, 30, 0); // 2026-10-14T10:30+03
  const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
  const gateOf = (u) => evaluateGate(u, NOW);
  const checks = [
    ['بلا وسائط: وضع التشغيل بلا ملفّ', (() => { const a = parseArgs([]); return a.mode === 'run' && a.out === null; })()],
    ['--out يُقبَل', parseArgs(['--out', 's.json']).out === 's.json'],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--out', 's.json'], /--preflight وحدها/)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['حقل خارج القائمة البيضاء يُرمى', (() => { try { describeField({email: 'x'}, 'email'); return false; } catch (e) { return /FIELD_NOT_WHITELISTED/.test(e.message); } })()],
    ['الرصيد 0 ⟵ NO_CREDIT', gateOf({scansRemaining: 0}).verdict === 'NO_CREDIT'],
    ['رصيد موجب وانتهاء مضى ⟵ SUBSCRIPTION_EXPIRED', gateOf({scansRemaining: 5, expiresAt: ts(NOW - 1000)}).verdict === 'SUBSCRIPTION_EXPIRED'],
    ['رصيد موجب وexpiresAt غائب ⟵ يمرّ', gateOf({scansRemaining: 5}).verdict === 'PASSES_BALANCE_AND_EXPIRY'],
    ['إزاحة +03', toPlus03(Date.UTC(2026, 9, 14, 6, 0, 0)) === '2026-10-14T09:00:00.000+03:00'],
    ['المشغَّل التالي 09:00 بتوقيت دمشق', (() => { const r = nextCronRun(NOW); return r.damascusWallClockVerified && r.next.plus03 === '2026-10-15T09:00:00.000+03:00' && r.previous.plus03 === '2026-10-14T09:00:00.000+03:00'; })()],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), ownerEmailEnvPresent: typeof env[C.OWNER_EMAIL_ENV] === 'string' && env[C.OWNER_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {
  MODE, USERS_COLLECTION, FIELDS, PRINTABLE_STRING, CRON, OFFSET_MS, DAY_MS,
  toPlus03, valueKind, timestampMs, describeField, nextCronRun, evaluateGate, evaluateCron, buildState, collectSubscriptionState, parseArgs, preflightChecks,
};
