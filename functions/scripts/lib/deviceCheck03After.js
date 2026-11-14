'use strict';

// ===================================================================
// deviceCheck03After — قراءة تقارير فحص الجهاز ٠٣ بعد الجلسات (الكتلتان ج٣ وج٤)، 2026-10-10 +03. قراءة بحتة. يستعمله device-check-03-after-readonly.js.
//
// أمر المنسّق (بنصّه المنقول): «المدخل: قائمة رموز تقارير بوسومها (مثلاً B1=NC-…,B2=NC-…,S1=NC-…,S2=NC-…,WAIT=NC-…)، وبريد حساب المالك من متغيّر البيئة.
// لكل رمز: مستند reports بالرمز ⟵ scanId ⟵ reportRaw/{scanId}. ثم قرّاؤك أنت (readFv68، وtestKinds، وما يلزم) لا نسخة منهم.»
//
// ─── من أين يُقرأ كل شيء (كل قارئ من مصدره الواحد) ───────────────────────────────────────────────────────────────────────────────────────────────────
//   readReportWithRaw (scripts/lib/reportRawReaders.js) ⟵ reports/{scanId} وreportRaw/{scanId} بحالاته الصريحة (PRIVATE · EMBEDDED_LEGACY · ABSENT).
//   readFv68 وcolumnIndex (src/analysis/fv68Reader.js) ⟵ ما يقرؤه الخادم من البصمة: الختم، M-02، L-02، الحرارة، بثّات البطارية، الذاكرة والتخزين، الدورات، D للمعالج، والتخطيط.
//   toTestResult (src/analysis/testKinds.js) ⟵ تصنيف اليدوي (`unavailable` ⟵ NOT_MEASURED/HARDWARE_ABSENT).
//   fv68Names (القيم الحرفية، القاعدة 24) · evaluationEnabled لا يخصّ هذا السكربت.
//   ما لا قارئ له في الخادم: SN-04 (قرار المستخدم 2026-10-10: «لا قارئ جديد لخامّ SN-04 قبل المحطّة ١» — fv68Reader.test.js:278) وmanualResultsHeader.hiddenByModel (لا قارئ في src، عقد §٧-ح (أ) :1448-1449 «يكتبه
//   وكيل الخادم بعد هذه الالتزامات»): يُستخرج منهما **رقمان وأعداد** هنا بقراءة تشخيصية في هذا السكربت وحده — لا قارئ يُضاف إلى الخادم، ولا قراءة تُحمَل إلى الإنتاج.
//
// ─── Storage ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// العيّنات ليست في reportRaw (lightenFingerprintForStorage يحذفها)؛ وهي في نسخة Storage (timeSeriesStoragePath). ثلاثة بنود من الأمر تحتاجها: «D للمعالج» (زمن المرحلة يُشتقّ من العيّنات بنصّ العقد
// §٧-د :1252: «زمن المرحلة يُشتقّ من العيّنات (phase وts/v[0])، ولا حقل له»)، و«ذيل gpu_fps»، و«زمن العيّنة». فيُنزَّل الملفّ **إلى الذاكرة** ويُترك (لا حفظ على القرص بأيّ شكل، كالسكربت ٣)، والخيار
// --no-storage يعطّله فتصير هذه البنود NOT_MEASURED:STORAGE_NOT_READ_BY_OPTION (لا صفر ولا نجاح). **هذا افتراض الوكيل** (الأمر لم يذكر Storage في السكربت ٢) ومذكور في تقريره.
//
// ─── الحكم من قيم المخرَج نفسه (القاعدة 22) ────────────────────────────────────────────────────────────────────────────────────────────────────────
// كل بند حكمٌ من أربعة: PASS · FAIL · NOT_MEASURED · INFO — وقاعدته المكتوبة في ITEM_RULES (تُكتب في المخرَج مرّة). لا افتراض: ما غاب يُعلَن NOT_MEASURED بسببه؛ وما لا معيار له INFO بقيمته.
//   FAIL = مخالفة معيار معلَن (قرار المستخدم أو العقد) أو شذوذ يُعلنه القارئ في قسم البند نفسه. INFO = قيمة مقيسة بلا معيار.
// معيار «D للمعالج» — **قرار المستخدم 2026-10-08 بنصّه (منقول من أمر المنسّق):** «والقبول: مجموع زمن D في المرحلة ≤ 1% من زمنها.»
// ===================================================================

const N = require('../../src/analysis/fv68Names');
const {readFv68, columnIndex, extractParts, parseState} = require('../../src/analysis/fv68Reader');
const {toTestResult} = require('../../src/analysis/testKinds');
const {rehydrateFingerprintSamples} = require('../../src/analysis/rehydrateReportSamples');
const {measureReportRawBytes, REPORT_RAW_MAX_BYTES, RAW_STATE, REPORT_RAW_FIELDS} = require('../../src/analysis/reportRawStore');
const {classifyStatus, STATUS_STATE} = require('../../src/sessions/sessionLifecycle');
const {SESSION_STATUS} = require('../../src/sessions/sessionNames');
const {RAW_LINKAGE_FIELDS} = require('../../src/evaluations/evaluationContract');
const {readReportWithRaw} = require('./reportRawReaders');
const {fetchSamplesFromStorage} = require('../export-v7-replay-inputs-readonly');
const C = require('./deviceCheck03Common');
const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../../src/analysis/evaluationRulesVersion');
const {CACHED_PIPELINE_TAG} = require('../../src/analysis/pipelineTags');
const {classifyCycleCount} = require('../../src/analysis/cycleCountClassification');
const {normalizeDeviceProfileKey, UNKNOWN_PRIMARY} = require('../../src/profiles/deviceProfileKey');

const MODE = 'device-check-03-after';
const REPORTS_COLLECTION = 'reports';
const SESSIONS_COLLECTION = 'scanSessions';
const EVALUATIONS_COLLECTION = 'evaluations';
const DEVICE_PROFILES_COLLECTION = 'deviceProfiles';
const MAX_TOKENS = 20;
const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
/** وسم يبدأ بـS = فحص جلسة (QR) — من الأمر: «وللجلستين (S1 وS2)». افتراض الوكيل المعلَن: وسم لا يبدأ بـS لا يُتوقَّع منه sessionId. */
const SESSION_TAG_PATTERN = /^S/;

const VERDICT = Object.freeze({PASS: 'PASS', FAIL: 'FAIL', NOT_MEASURED: 'NOT_MEASURED', INFO: 'INFO'});
const V = VERDICT;

/** المطلوب في فحص الجهاز ٠٣ بنصّ الأمر: «1.0.11 على الـS10 والـS21». قيمة حرفية يقوم عليها حكم (القاعدة 24): مصدرها هنا. */
const EXPECTED_APP_VERSION = '1.0.11';
/**
 * المطلوب في الجولة الثانية، **إصدار لكل مجموعة وسوم لا إصدار واحد للجولة** (الجزء السابع، 2026-10-14): بنصّ DEVICE-CHECK-03-2026-10-10.md:343 كما نُقل
 * («S1 وS2 على 1.0.14، وB8 على 1.0.12 كما جرى»). **مصدر واحد مُصدَّر لكل قيمة** (القاعدة 24): كل سطر في TAG_EXPECTATIONS_R2 يستعمل ثابتاً منهما، لا نسخة حرفية فيه.
 * (الجزء السادس كان يحمل الثلاثة على 1.0.12 بنصّ :278 — صار ذلك السطر مصدر إصدار B8 وختمه وحدهما؛ وختم S1 وS2 من :342 — VERSION_SOURCES_R2.)
 */
/** B8: فحص مستقلّ أُجري على 1.0.12 ولا يُعاد (:343) — مصدر إصداره سطر البناء :278 كما كان. */
const EXPECTED_APP_VERSION_R2_B8 = '1.0.12';
/** S1 وS2 (الجلستان): يُعادان على 1.0.14 (:343). */
const EXPECTED_APP_VERSION_R2_SESSIONS = '1.0.14';
/** معيار D بنصّ قرار المستخدم 2026-10-08 (منقول من أمر المنسّق، حرفياً). */
const D_SHARE_CRITERION_TEXT = 'والقبول: مجموع زمن D في المرحلة ≤ 1% من زمنها.';
const D_SHARE_MAX_PERCENT = 1;
const GPU_FPS_TAIL_COUNT = 10;

/** حالات اليدوي الخمس كما في العيّنات الذهبية fv69 (عقد §٧-ح (أ) :1452 — الأربع؛ والخامسة `warning` معروفة من ≤ fv68: كان M-02 يرسلها). لا مصدر مُصدَّر لها في src (testKinds يقرأها حرفياً). */
const MANUAL_STATUS = Object.freeze({PASS: 'pass', FAIL: 'fail', NOT_TESTED: 'not_tested', UNAVAILABLE: 'unavailable', WARNING: 'warning'});
const KNOWN_MANUAL_STATUSES = Object.freeze(Object.values(MANUAL_STATUS));

/** endReason ⟵ الحالة المقابلة (عقد §٧-ح (ب) :1472-1475)؛ dismissed «لا حالة جديدة» فلا مقابل له. المفاتيح من fv68Names (مصدر واحد). */
const END_REASON_STATUS = Object.freeze({
  [N.TOUCH_GRID_END_REASON.AUTO_COMPLETE]: MANUAL_STATUS.PASS,
  [N.TOUCH_GRID_END_REASON.USER_MARKED_NOT_WORKING]: MANUAL_STATUS.FAIL,
  [N.TOUCH_GRID_END_REASON.USER_MARKED_NOT_TESTED]: MANUAL_STATUS.NOT_TESTED,
});

/** مفاتيح خامّ SN-04 (عقد §٧-ح (ج) :1483-1490، fv69) — لا مصدر لها في fv68Names (لا قارئ لـSN-04 بقرار المستخدم)، فمصدرها هنا. */
const SN04 = Object.freeze({
  TEST_ID: 'SN-04', WINDOW_MS: 'windowMs', COVER_PROMPT_AT_MS: 'coverPromptAtMs', BEFORE: 'readingsBeforeCover', DURING: 'readingsDuringCover',
});
/** مفتاح رأس اليدوي (عقد §٧-ح (أ) :1448): جذر شقيق manualResults. */
const MANUAL_HEADER = Object.freeze({KEY: 'manualResultsHeader', HIDDEN: 'hiddenByModel'});
/** اختبار البطارية الذي يُطابَق به cycleCount (أمر المنسّق: «ومطابقته لـB-08»). */
const B08_TEST_ID = 'B-08';

/** تفاصيل حالات يقرؤها هذا السكربت بنصّها (أسباب not_run/partial في عقد §٧-ب؛ لا مصدر لها في fv68Names لأن القارئ يمرّر التفصيل نصّاً). */
const STATE_DETAIL = Object.freeze({
  INSUFFICIENT_FREE_MEMORY: 'insufficient_free_memory', TIME_CAP_REACHED: 'time_cap_reached', NO_TIME_LEFT: 'no_time_left',
});

/** فئات الأخطاء المسمّاة لكل بند (يقرأ هذا السكربت الحقائق ويحكم عليها — ولا يعيد حساب شيء من القارئ). */
const ITEM = Object.freeze({
  REPORT_FOUND: 'REPORT_FOUND', REPORT_OWNER: 'REPORT_OWNED_BY_OWNER_ACCOUNT', RAW_STATE: 'RAW_STATE', STORAGE_COPY: 'STORAGE_COPY',
  APP_VERSION: 'APP_VERSION', FIELDS_VERSION: 'FIELDS_VERSION', READER_ANOMALIES: 'READER_ANOMALIES',
  M02_RAW: 'M02_RAW', M02_MANUAL_STATUS: 'M02_MANUAL_STATUS', M02_END_REASON_VS_STATUS: 'M02_END_REASON_VS_STATUS',
  SN04_RAW: 'SN04_RAW', SN04_COVER_WINDOWS: 'SN04_COVER_WINDOWS',
  MANUAL_STATUS_VOCAB: 'MANUAL_STATUS_VOCAB', MANUAL_UNAVAILABLE_CLASS: 'MANUAL_UNAVAILABLE_CLASS', MANUAL_HIDDEN_BY_MODEL: 'MANUAL_HIDDEN_BY_MODEL',
  CPU_D_SHARE: 'CPU_D_SHARE', CPU_D_SHARE_PHASE: 'CPU_D_SHARE_PHASE', // الثاني بلاحقة _<رقم المرحلة>
  // الجولة الثانية (fv70، 2026-10-13): CPU_D_R2 حكم مجمَّع (PASS/FAIL/NOT_MEASURED) لتوقّعات D في fv70؛ والأربعة بلاحقة _<رقم المرحلة> صفوفها: ملخّص INFO، ثم ثلاثة أحكام (الأوّل منفَّذ، وsieveLimit، وsievePrimeCount)
  CPU_D_R2: 'CPU_D_R2', CPU_D_R2_SUMMARY: 'CPU_D_R2_SUMMARY', CPU_D_R2_FIRST_RUN: 'CPU_D_R2_FIRST_RUN', CPU_D_R2_SIEVE_LIMIT: 'CPU_D_R2_SIEVE_LIMIT', CPU_D_R2_SIEVE_PRIME_COUNT: 'CPU_D_R2_SIEVE_PRIME_COUNT',
  CPU_D_RUNS: 'CPU_D_RUNS', CPU_D_RUN: 'CPU_D_RUN', CPU_D_BREAKDOWN: 'CPU_D_BREAKDOWN', // تفصيل D (INFO): الأوّل ملخّص، والثاني بلاحقة _<مرحلة>_<ترتيب>، والثالث بلاحقة _<مرحلة>
  THERMAL_HEADROOM: 'THERMAL_HEADROOM', BATTERY_BROADCASTS: 'BATTERY_BROADCASTS', L02: 'L02', GPU_FPS_TAIL: 'GPU_FPS_TAIL',
  PAYLOAD_BYTES: 'PAYLOAD_BYTES', SAMPLING_TIME: 'SAMPLING_TIME', MEMORY_KERNEL: 'MEMORY_KERNEL', STORAGE_VERIFY: 'STORAGE_VERIFY',
  CYCLE_COUNT: 'CYCLE_COUNT', CYCLE_COUNT_MATCHES_B08: 'CYCLE_COUNT_MATCHES_B08',
  // الجولة الثانية (الجزء الخامس، 2026-10-13 +03، بعد النشر؛ إصدار التطبيق لكل وسم في TAG_EXPECTATIONS_R2): ختم قواعد التقييم في جذر مستند reports، وتصنيف الدورات من القارئ (التوقّع لكل وسم وسيط)، وبصمة الجهاز المحفوظة (INFO)
  EVALUATION_RULES_STAMP: 'EVALUATION_RULES_STAMP', CYCLE_CLASSIFICATION: 'CYCLE_CLASSIFICATION', CYCLE_CLASSIFICATION_SIGNATURE: 'CYCLE_CLASSIFICATION_SIGNATURE',
  SESSION_SCAN: 'SESSION_SCAN', SESSION_STATUS: 'SESSION_STATUS', SESSION_JOINED_BY: 'SESSION_JOINED_BY', SESSION_SCAN_LINK: 'SESSION_SCAN_LINK',
  EVALUATION_DOC: 'EVALUATION_DOC', EVALUATION_NO_MOVED_IDS: 'EVALUATION_NO_MOVED_IDS',
  ENERGY_COUNTER_NWH: 'ENERGY_COUNTER_NWH', CPU_TEMP_FINAL_SOURCE: 'CPU_TEMP_FINAL_SOURCE', WORKERS_PIN_STATE: 'WORKERS_PIN_STATE', MEMORY_VERIFY_STATE: 'MEMORY_VERIFY_STATE', TIME_TO_FIRST_FIX_STATE: 'TIME_TO_FIRST_FIX_STATE', // قيم INFO إضافية (2026-10-11)
});
/** بنود لا يُصدَر لها صفّ NOT_MEASURED عند غياب التقرير: REPORT_FOUND له صفّه، والباقية بنود بلاحقة (صفوف ديناميكية يُصدرها حكم بنده الأمّ فقط). */
const NOT_MEASURED_ALL_SKIP = new Set([ITEM.REPORT_FOUND, ITEM.CPU_D_SHARE_PHASE, ITEM.CPU_D_RUN, ITEM.CPU_D_BREAKDOWN,
  ITEM.CPU_D_R2_SUMMARY, ITEM.CPU_D_R2_FIRST_RUN, ITEM.CPU_D_R2_SIEVE_LIMIT, ITEM.CPU_D_R2_SIEVE_PRIME_COUNT]);

// ─── توقّعات الجولة الثانية لـD (fv70): منقولة من أمر المنسّق 2026-10-13 +03، غير متحقَّق من مصدرها عندي (القاعدة 29/32): «وتوقّع: النسبة ≤ 1%، والأوّل حاضر دائماً، و`sieveLimit` = 1000000، و`sievePrimeCount` = 78498.»
// النسبة ≤ 1% معيار CPU_D_SHARE القائم (D_SHARE_MAX_PERCENT). والعدد 78498 هو المرجع π(1000000) من جدول fv68Names.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT (مصدر واحد، القاعدة 24)، لا نسخة ثانية.
// «الأوّل حاضر دائماً» (افتراض الوكيل المعلَن): أوّل تشغيل في كل مرحلة **نُفِّذ** (لا skipped:time_budget ولا not_reached، وله t وtEnd) — فعناصر المرحلة الثلاثة حاضرة في القائمة دائماً بعقد §٧-ط (المتروك يبقى فيها)، فلا معنى للحضور في القائمة وحده.
/** N المتوقَّع في الجولة الثانية (التطبيق اليوم): 1000000. */
const ROUND2_EXPECTED_SIEVE_LIMIT = 1000000;
/** العدد المتوقَّع لـN أعلاه: المرجع من الجدول الواحد في fv68Names. */
const ROUND2_EXPECTED_SIEVE_PRIME_COUNT = N.SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT[ROUND2_EXPECTED_SIEVE_LIMIT];

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// جدول التوقّعات لكل وسم (جولة التصحيح 2026-10-10 +03) — مصدر واحد (القاعدة 24)، وكل سطر فيه يحمل سطر الوثيقة المنقول.
//
// ⚠️ **منقول، غير متحقَّق عندي (القاعدة 29):** الوثيقة `DEVICE-CHECK-03-2026-10-10.md` في مساحة العمل خارج مستودعي؛ والأسطر والاقتباسات هنا من نصّ أمر المنسّق (تصحيح 2026-10-10) الذي ينقلها منها. الخطأ الذي صُحِّح: أمري
// الأوّل قال «1.0.11 على الـS10 والـS21» ولم يقل إنّ **B1 فحص من 1.0.10** (ختم 67)، فكان السكربت يحكم عليه FAIL كذباً في APP_VERSION وFIELDS_VERSION وربّما في بنود fv68+.
//
// الوسوم الخمسة ثابتة بأسمائها (حسّاسة لحالة الأحرف): B1 · B2 · S1 · S2 · WAIT. **وسم غيرها: القواعد العامّة وحدها، ويُعلَن في المخرَج أنّه بلا توقّعات خاصّة.**
// ما تحمله الأسطر: الإصدارات (يعدّل بندَي APP_VERSION وFIELDS_VERSION)، وSESSION_JOINED_BY وEVALUATION_DOC (يشتدّان لـS1 وS2)، وصفوف EXPECT_* الجديدة (أسماء مميَّزة).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const CHECK_DOC = 'DEVICE-CHECK-03-2026-10-10.md';
const DOC_TRANSCRIPTION_NOTE = 'منقول من أمر المنسّق، غير متحقَّق من الوثيقة (مساحة العمل، خارج مستودع الباك اند)';
/** مصدر الإصدار 1.0.11 للفحوص الجديدة: أمر المنسّق الأوّل (لا سطر وثيقة منقول له). */
const ORDER1_SOURCE = 'أمر المنسّق الأوّل («1.0.11 على الـS10 والـS21») — لا سطر وثيقة منقول';
const docLine = (lines) => `${CHECK_DOC}:${lines}`;

const SCAN_KIND = Object.freeze({LEGACY_FV67: 'LEGACY_FV67', NEW_FV69: 'NEW_FV69'});
/** سبب NOT_MEASURED للبنود التي لا تحملها حمولة fv67 بطبيعتها. */
const LEGACY_FV67_SCAN = 'LEGACY_FV67_SCAN';
/** B1: فحص 1.0.10 أُعيد تحليله بعد التحديث (:79) — الإصدار والختم. */
const LEGACY_FV67 = Object.freeze({APP_VERSION: '1.0.10', FIELDS_VERSION: 67});

/** صفوف التوقّعات الجديدة — أسماء مميَّزة عن بنود القواعد العامّة. */
const EXPECT = Object.freeze({
  B1_LEGACY_FV67_SCAN: 'EXPECT_B1_LEGACY_FV67_SCAN',
  M02_AUTO_COMPLETE_FULL_GRID: 'EXPECT_M02_AUTO_COMPLETE_FULL_GRID',
  MANUAL_UNAVAILABLE_HARDWARE_ABSENT: 'EXPECT_MANUAL_UNAVAILABLE_HARDWARE_ABSENT',
  HIDDEN_BY_MODEL_EMPTY: 'EXPECT_HIDDEN_BY_MODEL_EMPTY',
  SN04_COVER_NO_THRESHOLD: 'EXPECT_SN04_COVER_NO_THRESHOLD',
  CYCLE_NOT_READ_DECLARED: 'EXPECT_CYCLE_NOT_READ_DECLARED',
  M02_NOT_WORKING_PARTIAL_GRID: 'EXPECT_M02_NOT_WORKING_PARTIAL_GRID',
  CYCLE_EXTRA_API34_POSITIVE: 'EXPECT_CYCLE_EXTRA_API34_POSITIVE',
});
/**
 * صفوف توقّعات الجولة الثانية التي لا نظير لها في الجولة ١ (الجزء السادس، 2026-10-14). **كائن مستقلّ عن EXPECT عمداً:** جدول الجولة ١ وحارسه (ومنه «كل EXPECT له قاعدة في rules») لا يُمسّان.
 * M15_UNAVAILABLE_HARDWARE_ABSENT أدقّ من EXPECT.MANUAL_UNAVAILABLE_HARDWARE_ABSENT: يسمّي M-15 (بطاقة SD، غائبة فعلاً في الـS21 Ultra والـS10 5G بنصّ الوثيقة :294 و:302، منقول).
 */
const EXPECT_R2 = Object.freeze({
  M15_UNAVAILABLE_HARDWARE_ABSENT: 'EXPECT_M15_UNAVAILABLE_HARDWARE_ABSENT',
});
/** معرّف اختبار بطاقة SD في manualResults (قيمة حرفية يقوم عليها تمييز، القاعدة 24: مصدرها هنا). */
const M15_TEST_ID = 'M-15';
const EXPECT_IDS = new Set([...Object.values(EXPECT), ...Object.values(EXPECT_R2)]);

// الاقتباسات حرفية كما وصلت (المسار والسطر في `source`).
const Q = Object.freeze({
  L79: 'بالأداة (ج٣): حمولة هذا الفحص بختم **67** (فحص 1.0.10، والخادم يقرؤه)، وتقريره صدر بـ`reportRaw` كاملاً.',
  L93: 'وقيم الثانية أدنى بوضوح إن غطّيتَ',
  L94_M02: 'M-02: `endReason = auto_complete`، و`elapsedMs` و`timeToFirstTouchMs` حاضران، و`touchedCells = totalCells`.',
  L94_MANUAL: 'اليدوي: الاختبار الذي اخترته `unavailable` في الحمولة، وتصنيفه في الخادم `NOT_MEASURED/HARDWARE_ABSENT`، و`manualResultsHeader.hiddenByModel = []`.',
  L98: 'البند ٤-أ (الـS10، API 30): غياب `cycleCount` معلن.',
  L110_M02: 'M-02: `endReason = user_marked_not_working`، والحالة `fail`، و`touchedCells < totalCells`.',
  L110_EVAL: 'مستند في evaluations مرتبط بالتقرير، بحالته الصحيحة، دون المعرّفات المنقولة',
  L110_SESSION: 'والجلسة: `completed`.',
  L126: '`joinedBy` غير فارغ … والحالة `completed` بعد الفحص.',
  L127: 'والتقييم الثاني: مستند في evaluations مرتبط بتقريره.',
  L130: 'الـS10، فحص من الرئيسية، فحصة رابعة',
  L141: '`cycleCount` في حمولة فحص الـS21 من `EXTRA_CYCLE_COUNT`، ومصدره `extra_api34`. … وهل يطابق `B-08` التذييل؟ وهل يظهر صفر «غير مدعوم» بحالة `read`؟',
  L166: '`footer.fieldsVersion` في فحص جديد ليس 69',
  L167: 'لا مستند تقييم بعد أيّ من الجلستين (البند ٦: شرط توقّف قبل الشريك).',
});

const newScanVersionLines = () => [
  {item: ITEM.APP_VERSION, source: ORDER1_SOURCE, quote: '1.0.11 على الـS10 والـS21', rule: `PASS: header.appVersion = ${EXPECTED_APP_VERSION}؛ FAIL غيره؛ NOT_MEASURED غائب`},
  {item: ITEM.FIELDS_VERSION, source: docLine('166'), quote: Q.L166, rule: `PASS: footer.fieldsVersion = ${N.FIELDS_VERSION_69} بالضبط (لا ≥)؛ FAIL غيره (شرط التوقّف)؛ NOT_MEASURED غائب`},
];
const sessionStrictLines = (jb, ev, st, evNo) => [
  {item: ITEM.SESSION_STATUS, source: docLine(st), quote: st === '110-112' ? Q.L110_SESSION : Q.L126, rule: 'PASS: scanSessions.status = completed؛ FAIL حالة أخرى؛ NOT_MEASURED مستند الجلسة غائب'},
  {item: ITEM.SESSION_JOINED_BY, source: docLine(jb), quote: Q.L126, rule: 'PASS: joinedBy حاضر (نصّ غير فارغ)؛ FAIL: غائب أو فارغ'},
  {item: ITEM.EVALUATION_DOC, source: `${docLine(ev)} + ${docLine('167')}`, quote: `${ev === '110-112' ? Q.L110_EVAL : Q.L127} / ${Q.L167}`,
    rule: 'FAIL: لا مستند evaluations (شرط التوقّف)؛ أو pending ≠ false (لم يُربط بعد صدور التقرير)؛ أو linkageIncomplete ≠ false؛ أو ownerMismatch ≠ false؛ أو linkageRawState ≠ PRIVATE. PASS: مستند مرتبط مستكمل'},
  {item: ITEM.EVALUATION_NO_MOVED_IDS, source: docLine(evNo), quote: Q.L110_EVAL, rule: 'PASS: لا مفتاح منقول على أيّ عمق؛ FAIL: وُجد؛ NOT_MEASURED: المستند غائب'},
  {item: EXPECT.CYCLE_EXTRA_API34_POSITIVE, source: docLine('141-142'), quote: Q.L141,
    rule: 'PASS: مصدر الدورات extra_api34 وحالتها read وقيمتها > 0. FAIL بسبب مسمّى: CYCLE_COUNT_ZERO_WITH_READ_STATE (0 بحالة read) · CYCLE_COUNT_SOURCE_NOT_EXTRA_API34 · CYCLE_COUNT_NOT_READ · CYCLE_COUNT_ABSENT · CYCLE_COUNT_STATE_ABSENT · CYCLE_COUNT_VALUE_ABSENT · CYCLE_COUNT_NEGATIVE'},
];

/**
 * جدول التوقّعات. المفتاح الاسم الحرفي للوسم. appVersion/fieldsVersion يعدّلان بندَي الإصدار؛ sessionStrict يشدّ SESSION_JOINED_BY وEVALUATION_DOC؛ lines سرد كل توقّع بسطر وثيقته واقتباسه وقاعدة حكمه.
 */
const TAG_EXPECTATIONS = Object.freeze({
  B1: Object.freeze({
    scan: SCAN_KIND.LEGACY_FV67, appVersion: LEGACY_FV67.APP_VERSION, fieldsVersion: LEGACY_FV67.FIELDS_VERSION, sessionStrict: false,
    lines: Object.freeze([
      {item: ITEM.APP_VERSION, source: docLine('79'), quote: Q.L79, rule: `PASS: header.appVersion = ${LEGACY_FV67.APP_VERSION} (فحص 1.0.10)؛ FAIL غيره؛ NOT_MEASURED غائب`},
      {item: ITEM.FIELDS_VERSION, source: docLine('79'), quote: Q.L79, rule: `PASS: footer.fieldsVersion = ${LEGACY_FV67.FIELDS_VERSION} بالضبط؛ FAIL غيره (ختم ≥ 68 ⟵ FAIL: الوسم لا يطابق الفحص)؛ NOT_MEASURED غائب`},
      {item: ITEM.RAW_STATE, source: docLine('79'), quote: 'وتقريره صدر بـ`reportRaw` كاملاً.', rule: 'PASS: PRIVATE (تقرير جديد بعد النشر)؛ FAIL: ABSENT أو EMBEDDED_LEGACY'},
      {item: EXPECT.B1_LEGACY_FV67_SCAN, source: docLine('79'), quote: Q.L79,
        rule: `PASS: ختم ${LEGACY_FV67.FIELDS_VERSION} ⟵ كل بند لا تحمله حمولة fv67 بطبيعتها (LEGACY_BY_NATURE، يُسرد في legacyByNature) NOT_MEASURED:${LEGACY_FV67_SCAN} لا FAIL. FAIL: أيّ ختم آخر (≥ 68: الوسم لا يطابق الفحص)`},
    ]),
  }),
  B2: Object.freeze({
    scan: SCAN_KIND.NEW_FV69, appVersion: EXPECTED_APP_VERSION, fieldsVersion: N.FIELDS_VERSION_69, sessionStrict: false,
    lines: Object.freeze([
      ...newScanVersionLines(),
      {item: EXPECT.M02_AUTO_COMPLETE_FULL_GRID, source: docLine('94-95'), quote: Q.L94_M02,
        rule: 'PASS: endReason = auto_complete، وelapsedMs وtimeToFirstTouchMs حاضران (حالتهما PRESENT)، وtouchedCells = totalCells. FAIL: غير ذلك أو M-02/measurements غائب (الإجابة مطلوبة)'},
      {item: EXPECT.MANUAL_UNAVAILABLE_HARDWARE_ABSENT, source: docLine('94-95'), quote: Q.L94_MANUAL,
        rule: 'PASS: `unavailable` واحد على الأقلّ في الحمولة وكلّها ⟵ NOT_MEASURED/HARDWARE_ABSENT (toTestResult). FAIL: لا `unavailable` (غيابه FAIL: الإجابة مطلوبة عمداً) أو تصنيف آخر'},
      {item: EXPECT.HIDDEN_BY_MODEL_EMPTY, source: docLine('94-95'), quote: Q.L94_MANUAL, rule: 'PASS: manualResultsHeader.hiddenByModel مصفوفة فارغة بالضبط. FAIL: غير فارغة أو غائبة أو بنوع خاطئ'},
      {item: EXPECT.SN04_COVER_NO_THRESHOLD, source: docLine('93'), quote: Q.L93, rule: 'INFO: متوسّطا النافذتين (قبل التغطية وأثناءها) كما في SN04_COVER_WINDOWS. لا عتبة رقمية في القرار فلا حكم (لا تُخترَع عتبة)؛ NOT_MEASURED: SN-04 غائب'},
      {item: EXPECT.CYCLE_NOT_READ_DECLARED, source: docLine('98'), quote: Q.L98,
        rule: 'PASS: الدورات بحالة معلنة غير مقروءة (cycleCountState = not_read:…) بلا قيمة. FAIL: رقم بحالة read، أو قيمة مع not_read، أو غياب الحقل بلا حالة، أو حالة غير معروفة'},
    ]),
  }),
  S1: Object.freeze({
    scan: SCAN_KIND.NEW_FV69, appVersion: EXPECTED_APP_VERSION, fieldsVersion: N.FIELDS_VERSION_69, sessionStrict: true,
    lines: Object.freeze([
      ...newScanVersionLines(),
      {item: EXPECT.M02_NOT_WORKING_PARTIAL_GRID, source: docLine('110-112'), quote: Q.L110_M02,
        rule: 'PASS: endReason = user_marked_not_working، والحالة اليدوية fail، وtouchedCells < totalCells. FAIL: غير ذلك أو M-02/measurements غائب'},
      ...sessionStrictLines('126', '110-112', '110-112', '110-112'),
    ]),
  }),
  S2: Object.freeze({
    scan: SCAN_KIND.NEW_FV69, appVersion: EXPECTED_APP_VERSION, fieldsVersion: N.FIELDS_VERSION_69, sessionStrict: true,
    lines: Object.freeze([
      ...newScanVersionLines(),
      ...sessionStrictLines('126-127', '126-127', '126-127', '126-127'),
    ]),
  }),
  WAIT: Object.freeze({
    scan: SCAN_KIND.NEW_FV69, appVersion: EXPECTED_APP_VERSION, fieldsVersion: N.FIELDS_VERSION_69, sessionStrict: false,
    lines: Object.freeze([
      ...newScanVersionLines(),
      {item: ITEM.SESSION_SCAN, source: docLine('130'), quote: Q.L130, rule: 'فحص فردي: لا sessionId متوقَّع (INFO). قاعدة وسم S العامّة تكفي (وسم WAIT لا يبدأ بـS)؛ لا صفّ EXPECT خاصّ'},
    ]),
  }),
});
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// جدول توقّعات الجولة الثانية TAG_EXPECTATIONS_R2 (الجزء السادس، 2026-10-14) — يُختار بـ`--round 2` (الغائب = الجولة ١ كما كان؛ وأيّ قيمة غير 1 أو 2 USAGE). ختم 70 للثلاثة؛ **والإصدار لكل مجموعة: B8 على 1.0.12 وS1 وS2 على 1.0.14** (الجزء السابع، 2026-10-14؛ :343).
//
// ⚠️ **منقول، غير متحقَّق عندي (القاعدة 29):** الأسطر والاقتباسات من نصّ أمر المنسّق (2026-10-14) الذي ينقلها من DEVICE-CHECK-03-2026-10-10.md كما هي عند 2026-10-14؛ الوثيقة في مساحة العمل خارج مستودعي ولم أقرأها.
//
// الوسوم الثلاثة: B8 (فحص مستقلّ على الـS21 Ultra) · S1 وS2 (الجلستان، والـS10 5G فيهما هاتف الزبون). وسم غيرها في الجولة ٢: القواعد العامّة وحدها ويُعلَن ذلك.
//
// **ما لا يُحكم به من الخادم (القاعدة 22): ظهور البطاقة على شاشة الزبون (الوثيقة :193)** — سجلّ الهاتف، يُحكم به من ج٨. لا صفّ له هنا ولا في المخرَج حكمٌ عليه.
// **تصنيف صفر الدورات (:293: «وتصنيف صفر الدورات (unsupported:zero_from_extra_api34)؛»)** لا يُكتب في الجدول: توقّعه لكل وسم وسيط `--cycle-expect` (CYCLE_CLASSIFICATION، الجزء الخامس): B8=classified وS1=none وS2=none.
// لا صفّ لـEVALUATION_NO_MOVED_IDS في سطور S1/S2: لا سطر وثيقة منقول له في هذه الجولة (الصفّ العامّ يبقى لكل وسم)، فلا يُختلَق مصدر.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const SCAN_KIND_NEW_FV70 = 'NEW_FV70';
const Q2 = Object.freeze({
  L278: 'البناء صار 1.0.12 = ce7c517 (APK 5401331c…، 36738226 بايتاً؛ evidence/apk-build-2026-10-13-ce7c517-launchRelease/).',
  // :343 اقتباس حرفي من السطر **بلا رمز التقرير** (قرار الأمر: لا رمز تقرير حقيقي في المستودع)؛ والسطر منقول من أمر المنسّق 2026-10-14، غير متحقَّق من الوثيقة.
  L343: 'S1 وS2 على 1.0.14، وB8 على 1.0.12 كما جرى',
  // :342 نصّه الخامّ في الأمر: «- **و`fieldsVersion` 70 كما هو، ولا تغيير في الخادم.**» — الاقتباس بلا رموز markdown على عادة هذا الكائن (كما L297)؛ منقول غير متحقَّق من الوثيقة.
  L342: 'وfieldsVersion 70 كما هو، ولا تغيير في الخادم.',
  L295: 'و«يعمل» على M-02: يجب أن تفتح الشبكة. أكملها.',
  L294: 'وشريحة «غير متوفر»: اضغطها على M-15 (بطاقة SD، غائبة فعلاً في الـS21 Ultra بنصّك)؛',
  L303: 'وفي ب٣ الشبكة بزرّ الفنّي كما في الخطّة (لمس خلايا قليلة، ثم ~15 ث، ثم «لا يعمل»).',
  L268: 'شبكة اللمس بزرّ الفنّي: المس خلايا قليلة، وانتظر نحو 15 ثانية، واضغط «لا يعمل».',
  L302: 'شريحة «غير متوفر» على M-15: الـS10 5G (SM-G977N) بلا مكان لبطاقة SD، فهي إجابة صادقة لا مصطنعة (بنصّك)؛',
  L297: 'ب٣ وب٤، مع ج٨ يعمل على الكمبيوتر طوال كل جلسة: blocks/c8-s10-logcat-session.ps1 -Label S1 ثم -Label S2.',
  L191: 'لا مستند تقييم بعد أيّ من الجلستين (البند ٦: شرط توقّف قبل الشريك).',
});
/**
 * مصدرا صفّي الإصدار (APP_VERSION وFIELDS_VERSION) لكل مجموعة وسوم في الجولة ٢: سطر الوثيقة واقتباسه لكل صفّ.
 * B8: السطران من :278 كما كانا. S1 وS2 (الجزء السابع): الإصدار من :343 (1.0.14)، والختم من :342 («fieldsVersion 70 كما هو، ولا تغيير في الخادم»).
 */
const VERSION_SOURCES_R2 = Object.freeze({
  B8: Object.freeze({app: Object.freeze({line: '278', quote: Q2.L278}), stamp: Object.freeze({line: '278', quote: Q2.L278})}),
  SESSIONS: Object.freeze({app: Object.freeze({line: '343', quote: Q2.L343}), stamp: Object.freeze({line: '342', quote: Q2.L342})}),
});
/** سطرا الإصدار لوسم من الجولة ٢: الإصدار المتوقَّع (من أحد الثابتَين المُصدَّرَين) ومصدرا الصفّين (VERSION_SOURCES_R2) يُمرَّران، والختم 70 واحد للثلاثة. */
const newScanVersionLinesR2 = (appVersion, sources) => [
  {item: ITEM.APP_VERSION, source: docLine(sources.app.line), quote: sources.app.quote, rule: `PASS: header.appVersion = ${appVersion}؛ FAIL غيره؛ NOT_MEASURED غائب`},
  {item: ITEM.FIELDS_VERSION, source: docLine(sources.stamp.line), quote: sources.stamp.quote, rule: `PASS: footer.fieldsVersion = ${N.FIELDS_VERSION_70} بالضبط (لا ≥)؛ FAIL غيره؛ NOT_MEASURED غائب`},
];
const m15Line = (line, quote) => ({item: EXPECT_R2.M15_UNAVAILABLE_HARDWARE_ABSENT, source: docLine(line), quote,
  rule: `PASS: صفّ ${M15_TEST_ID} في manualResults حالته unavailable في الحمولة وتصنيفه في الخادم NOT_MEASURED/HARDWARE_ABSENT (toTestResult). FAIL: ${M15_TEST_ID} غائب (الإجابة مطلوبة عمداً: غيابها FAIL) أو حالته غير unavailable أو تصنيفه آخر`});
const sessionStrictLinesR2 = () => [
  {item: ITEM.SESSION_STATUS, source: docLine('297'), quote: Q2.L297, rule: 'PASS: scanSessions.status = completed؛ FAIL حالة أخرى؛ NOT_MEASURED مستند الجلسة غائب'},
  {item: ITEM.SESSION_JOINED_BY, source: docLine('297'), quote: Q2.L297, rule: 'PASS: joinedBy حاضر (نصّ غير فارغ)؛ FAIL: غائب أو فارغ'},
  {item: ITEM.EVALUATION_DOC, source: `${docLine('297')} + ${docLine('191')}`, quote: `${Q2.L297} / ${Q2.L191}`,
    rule: 'FAIL: لا مستند evaluations (شرط التوقّف)؛ أو pending ≠ false (لم يُربط بعد صدور التقرير)؛ أو linkageIncomplete ≠ false؛ أو ownerMismatch ≠ false؛ أو linkageRawState ≠ PRIVATE. PASS: مستند مرتبط مستكمل'},
];
/** جدول توقّعات الجولة الثانية. نفس شكل TAG_EXPECTATIONS. */
const TAG_EXPECTATIONS_R2 = Object.freeze({
  B8: Object.freeze({
    scan: SCAN_KIND_NEW_FV70, appVersion: EXPECTED_APP_VERSION_R2_B8, fieldsVersion: N.FIELDS_VERSION_70, sessionStrict: false,
    lines: Object.freeze([
      ...newScanVersionLinesR2(EXPECTED_APP_VERSION_R2_B8, VERSION_SOURCES_R2.B8),
      {item: EXPECT.M02_AUTO_COMPLETE_FULL_GRID, source: docLine('295'), quote: Q2.L295,
        rule: 'PASS: endReason = auto_complete، وelapsedMs وtimeToFirstTouchMs حاضران (حالتهما PRESENT)، وtouchedCells = totalCells. FAIL: غير ذلك أو M-02/measurements غائب (الإجابة مطلوبة)'},
      m15Line('294', Q2.L294),
    ]),
  }),
  S1: Object.freeze({
    scan: SCAN_KIND_NEW_FV70, appVersion: EXPECTED_APP_VERSION_R2_SESSIONS, fieldsVersion: N.FIELDS_VERSION_70, sessionStrict: true,
    lines: Object.freeze([
      ...newScanVersionLinesR2(EXPECTED_APP_VERSION_R2_SESSIONS, VERSION_SOURCES_R2.SESSIONS),
      {item: EXPECT.M02_NOT_WORKING_PARTIAL_GRID, source: `${docLine('303')} + ${docLine('268')}`, quote: `${Q2.L303} / ${Q2.L268}`,
        rule: 'PASS: endReason = user_marked_not_working، والحالة اليدوية fail، وtouchedCells < totalCells. FAIL: غير ذلك أو M-02/measurements غائب'},
      m15Line('302', Q2.L302),
      ...sessionStrictLinesR2(),
    ]),
  }),
  S2: Object.freeze({
    scan: SCAN_KIND_NEW_FV70, appVersion: EXPECTED_APP_VERSION_R2_SESSIONS, fieldsVersion: N.FIELDS_VERSION_70, sessionStrict: true,
    lines: Object.freeze([
      ...newScanVersionLinesR2(EXPECTED_APP_VERSION_R2_SESSIONS, VERSION_SOURCES_R2.SESSIONS),
      m15Line('302', Q2.L302),
      ...sessionStrictLinesR2(),
    ]),
  }),
});
/** ما لا يُحكم به من الخادم في الجولة ٢: يُكتب في المخرَج (expectationsOutput) لا صفّاً. */
const NOT_JUDGED_FROM_SERVER_R2 = Object.freeze([
  {what: 'ظهور البطاقة على شاشة الزبون', source: docLine('193'), judgedBy: 'ج٨ (سجلّ الهاتف)', reason: 'لا يُقرأ من الخادم (القاعدة 22): لا صفّ يدّعيه'},
]);

/** الجولة: غائب = 1؛ 1 أو 2؛ غير ذلك خطأ صريح (القاعدة 22) — لا اختيار صامت لجدول. */
function roundOf(value) {
  if (value === undefined) return 1;
  if (value === 1 || value === 2) return value;
  throw new Error(`USAGE: --round: 1 أو 2 (وصل ${typeof value === 'string' ? JSON.stringify(value) : String(value)})`);
}
const tableOfRound = (round) => (roundOf(round) === 2 ? TAG_EXPECTATIONS_R2 : TAG_EXPECTATIONS);
const tagExpectation = (tag, round) => { const t = tableOfRound(round); return typeof tag === 'string' && Object.prototype.hasOwnProperty.call(t, tag) ? t[tag] : null; };
/** صفوف EXPECT التي يُصدرها وسم (بترتيب أسطره) في الجولة المطلوبة (الغائب = 1). */
const expectItemsOf = (tag, round) => { const e = tagExpectation(tag, round); return e ? e.lines.filter((l) => EXPECT_IDS.has(l.item)).map((l) => l.item) : []; };

/**
 * البنود التي لا تحملها حمولة fv67 بطبيعتها ⟵ NOT_MEASURED:LEGACY_FV67_SCAN في B1 (لا FAIL). **تُقرَّر من القارئ والعقد لا من الذاكرة:**
 *  • since=68: مفاتيح يعلن القارئ غيابها بـNOT_IN_FIELDS_VERSION حين الختم < 68 (fv68Reader.js: absentStatus) — ويثبّت الاختبار ذلك على عيّنة fv67 الحقيقية قسماً قسماً؛ ومواضعها في العقد (docs/FV68_CONTRACT.md) بالأسطر أدناه.
 *  • since=69: ما أُضيف في الدفعة ١٠ (fieldsVersion 69 = N.FIELDS_VERSION_69): خامّ M-02 وSN-04 وحالة `unavailable` وmanualResultsHeader — عقد §٧-ح (:1429-1490).
 * ما ليس هنا يبقى بقاعدته العامّة لأنّ fv67 يحمله: الإصدارات، حالات اليدوي الأربع القديمة (MANUAL_STATUS_VOCAB)، الحالة اليدوية لـM-02 (M02_MANUAL_STATUS)، العيّنات (ذيل gpu_fps وزمن العيّنة وحجم الحمولة)، وشذوذ القارئ.
 */
const LEGACY_BY_NATURE = Object.freeze({
  [ITEM.M02_RAW]: {since: 69, source: 'docs/FV68_CONTRACT.md:1458 (§٧-ح (ب): خامّ M-02 جديد في fv69)'},
  [ITEM.M02_END_REASON_VS_STATUS]: {since: 69, source: 'docs/FV68_CONTRACT.md:1458 (§٧-ح (ب): endReason جديد في fv69)'},
  [ITEM.SN04_RAW]: {since: 69, source: 'docs/FV68_CONTRACT.md:1478 (§٧-ح (ج): خامّ SN-04 جديد في fv69)'},
  [ITEM.SN04_COVER_WINDOWS]: {since: 69, source: 'docs/FV68_CONTRACT.md:1478 (§٧-ح (ج))'},
  [ITEM.MANUAL_UNAVAILABLE_CLASS]: {since: 69, source: 'docs/FV68_CONTRACT.md:1450 (§٧-ح (أ): الحالة `unavailable` جديدة في fv69)'},
  [ITEM.MANUAL_HIDDEN_BY_MODEL]: {since: 69, source: 'docs/FV68_CONTRACT.md:1450 (§٧-ح (أ): manualResultsHeader جديد في fv69)'},
  [ITEM.CPU_D_SHARE]: {since: 68, source: 'docs/FV68_CONTRACT.md:676 (ت-20: منتِج D للمعالج)'},
  [ITEM.CPU_D_RUNS]: {since: 68, source: 'docs/FV68_CONTRACT.md:676 (ت-20: cpuKnownAnswerRuns[] من منتِج D)'},
  [ITEM.THERMAL_HEADROOM]: {since: 68, source: 'docs/FV68_CONTRACT.md:447 (ت-03: قائمة headroom)'},
  [ITEM.BATTERY_BROADCASTS]: {since: 68, source: 'docs/FV68_CONTRACT.md:493 (ت-06: batteryPairs)'},
  [ITEM.L02]: {since: 68, source: 'docs/FV68_CONTRACT.md:529 (ت-11: measurements لـL-02)'},
  [ITEM.MEMORY_KERNEL]: {since: 68, source: 'docs/FV68_CONTRACT.md:622 (ت-17: تحقّق الذاكرة)'},
  [ITEM.STORAGE_VERIFY]: {since: 68, source: 'docs/FV68_CONTRACT.md:606 (ت-16: تحقّق التخزين)'},
  [ITEM.CYCLE_COUNT]: {since: 68, source: 'docs/FV68_CONTRACT.md:434 (ت-02: الدورات من EXTRA_CYCLE_COUNT)'},
  [ITEM.CYCLE_COUNT_MATCHES_B08]: {since: 68, source: 'docs/FV68_CONTRACT.md:434 (ت-02: الدورات؛ المطابقة تتبعها)'},
});

const linesOfItem = (item, table = TAG_EXPECTATIONS) => Object.entries(table).flatMap(([tag, e]) => e.lines.filter((l) => l.item === item).map((l) => ({tag, ...l})));
const lineText = (l) => `${l.tag}: ${l.rule} — «${l.quote}» [${l.source}]`;
const withVariants = (item, base, table = TAG_EXPECTATIONS) => {
  const ls = linesOfItem(item, table);
  return ls.length === 0 ? base : `${base} || توقّعات الوسوم: ${ls.map(lineText).join(' | ')}`;
};

/** قاعدة الحكم لكل بند — تُكتب في المخرَج مرّة (rules) فالجدول يُقرأ بلا الرجوع إلى الكود. */
const BASE_RULES = Object.freeze({
  [ITEM.REPORT_FOUND]: 'PASS: reports بالرمز = مستند واحد. FAIL: لا مستند. NOT_MEASURED: أكثر من مستند (الرمز ملتبس) — وكل بند آخر NOT_MEASURED:REPORT_ABSENT.',
  [ITEM.REPORT_OWNER]: 'PASS: userId التقرير (مُهشَّراً) = حساب المالك. FAIL: حساب آخر. NOT_MEASURED: userId غائب.',
  [ITEM.RAW_STATE]: 'PASS: PRIVATE (تقرير جديد). FAIL: ABSENT أو EMBEDDED_LEGACY (تقرير جديد يجب أن يكتب reportRaw بالدفعة الذرّية).',
  [ITEM.STORAGE_COPY]: 'INFO: حالة نسخة Storage (DOWNLOADED أو سببها). FAIL: خطأ فكّ أو تنزيل. NOT_MEASURED: لا مسار أو --no-storage أو لا خامّ.',
  [ITEM.APP_VERSION]: `وسم بلا توقّعات خاصّة — PASS: header.appVersion = ${EXPECTED_APP_VERSION} (نصّ الأمر). FAIL: غيره. NOT_MEASURED: غائب.`,
  [ITEM.FIELDS_VERSION]: `وسم بلا توقّعات خاصّة — PASS: timeSeries.footer.fieldsVersion ≥ ${N.FIELDS_VERSION_69} (عتبة fv69 كما يقرؤها القارئ). FAIL: أقلّ. NOT_MEASURED: غائب.`,
  [ITEM.READER_ANOMALIES]: 'PASS: readFv68 لا يُعلن شذوذاً. FAIL: شذوذ واحد على الأقلّ (يُسرد section:code). NOT_MEASURED: لا بصمة أو القارئ رمى.',
  [ITEM.M02_RAW]: 'PASS: خامّ M-02 كامل (touchedCells وtotalCells وendReason معروف؛ وelapsedMs وtimeToFirstTouchMs حاضران أو غائبان بإعلان «لا لمسة») بلا شذوذ في القارئ. FAIL: غير ذلك. NOT_MEASURED: لا M-02 أو لا measurements.',
  [ITEM.M02_MANUAL_STATUS]: 'INFO: الحالة اليدوية لـM-02 مع القيم الخمس (endReason وelapsedMs وtimeToFirstTouchMs وtouchedCells/totalCells).',
  [ITEM.M02_END_REASON_VS_STATUS]: 'PASS: endReason ⟵ الحالة بالعقد (auto_complete⟵pass · user_marked_not_working⟵fail · user_marked_not_tested⟵not_tested). FAIL: تناقض. INFO: dismissed (لا حالة جديدة). NOT_MEASURED: لا endReason.',
  [ITEM.SN04_RAW]: 'PASS: windowMs وcoverPromptAtMs عددان صحيحان، والقائمتان حاضرتان بعناصر {t, values} سليمة، وt قبل الفاصل في الأولى ولا أقلّ منه في الثانية. FAIL: غير ذلك (أو measurements غائب في fv69). NOT_MEASURED: لا SN-04 أو الختم أقدم من 69.',
  [ITEM.SN04_COVER_WINDOWS]: 'INFO: عدد عناصر القائمتين ومتوسّط القيم في كلٍّ (رقمان، لا القراءات) وwindowMs وcoverPromptAtMs. لا حكم: «الخادم يقرّر من القيم» في دفعات التقرير (عقد §٧-ح (ج)).',
  [ITEM.MANUAL_STATUS_VOCAB]: 'PASS: كل manualResults[].status من الخمس المعروفة (pass · fail · not_tested · unavailable · warning). FAIL: حالة خارجها أو غائبة. NOT_MEASURED: لا نتائج يدوية.',
  [ITEM.MANUAL_UNAVAILABLE_CLASS]: 'PASS: كل `unavailable` ⟵ NOT_MEASURED/HARDWARE_ABSENT بـtoTestResult. FAIL: تصنيف آخر. NOT_MEASURED: لا `unavailable` في هذا التقرير.',
  [ITEM.MANUAL_HIDDEN_BY_MODEL]: 'PASS (fv ≥ 69): manualResultsHeader.hiddenByModel مصفوفة نصوص (تُسرد). FAIL: غائبة أو بنوع خاطئ. NOT_MEASURED: الختم أقدم من 69.',
  [ITEM.CPU_D_SHARE]: `${D_SHARE_CRITERION_TEXT} PASS: كل مرحلة ≤ ${D_SHARE_MAX_PERCENT}%. FAIL: مرحلة فوقها (يُعرض على المستخدم قبل التسليم). NOT_MEASURED: لا cpuKnownAnswerState=ran أو لا مجاميع أو لا عيّنات لزمن المرحلة. زمن المرحلة = امتداد v[0] لعيّنات المرحلة (عقد §٧-د).`,
  [ITEM.CPU_D_SHARE_PHASE]: 'نفس قاعدة CPU_D_SHARE لمرحلة واحدة: totalMs × 100 ≤ durationMs × 1 ⟵ PASS.',
  [ITEM.CPU_D_R2]: `توقّعات الجولة الثانية لـD (ختم ≥ ${N.FIELDS_VERSION_70}؛ منقولة من أمر المنسّق 2026-10-13، غير متحقَّق من مصدرها): PASS: كل صفوف أحكام CPU_D_R2_* PASS. FAIL: أحدها FAIL. NOT_MEASURED: ختم < ${N.FIELDS_VERSION_70} (BEFORE_FV70) أو لا تشغيلات أو لا أحكام قابلة للقياس. النسبة ≤ ${D_SHARE_MAX_PERCENT}% في CPU_D_SHARE القائم (وهي تُحسب الآن في partial:time_budget أيضاً على التشغيلات المنفَّذة وحدها).`,
  [ITEM.CPU_D_R2_SUMMARY]: 'INFO لكل مرحلة (ختم ≥ 70): عدد التشغيلات والمنفَّذ والمتروك (skipped:time_budget) وغير المبلَّغ (not_reached) والملغى (cancelled: بدأ وقطعته المرحلة؛ لا يُعدّ منفَّذاً)، ومجموع D المشحون ونسبته من زمن المرحلة (من CPU_D_SHARE_PHASE)، وقيم sieveLimit الموجودة وأعداد sievePrimeCount. المتروك لا يدخل المجموع ولا النسبة (لا نجاح ولا فشل ولا صفر).',
  [ITEM.CPU_D_R2_FIRST_RUN]: `PASS: أوّل تشغيل في المرحلة منفَّذ (لا skipped:time_budget ولا not_reached ولا cancelled، وله t وtEnd). FAIL: متروك أو لم يُبلَّغ أو مُلغى أو بلا t/tEnd. NOT_MEASURED: لا تشغيل في المرحلة. «الأوّل حاضر دائماً» — افتراض الوكيل المعلَن: حاضر = منفَّذ.`,
  [ITEM.CPU_D_R2_SIEVE_LIMIT]: `PASS: كل تشغيل يُشحن معه sieveLimit (غربال match أو mismatch أو alloc_failed أو native_status_unknown:*؛ المصدر الواحد fv68Names.SIEVE_STATUS_KINDS_CARRYING_LIMIT) يحمله = ${ROUND2_EXPECTED_SIEVE_LIMIT}. FAIL: غائب أو بنوع خاطئ أو قيمة أخرى (يُسرد). NOT_MEASURED: لا غربال منفَّذ في المرحلة. المتروك وcancelled وnot_reached وnative_call_failed وnative_result_unreadable لا يحملونه بالتصميم فلا يدخلون الحكم (وحضوره مع cancelled شذوذ يُعلَنه القارئ في READER_ANOMALIES).`,
  [ITEM.CPU_D_R2_SIEVE_PRIME_COUNT]: `PASS: كل تشغيل بغربال match أو mismatch يحمل sievePrimeCount = ${ROUND2_EXPECTED_SIEVE_PRIME_COUNT} (المرجع π(${ROUND2_EXPECTED_SIEVE_LIMIT}) من fv68Names). FAIL: عدد آخر (ومنه عدم التطابق الحقيقي) أو غائب (يُسرد). NOT_MEASURED: لا غربال مُبلَّغ في المرحلة.`,
  [ITEM.CPU_D_RUNS]: 'INFO (بلا حكم، ولا يغيّر حكم أيّ بند): تفصيل D لكل تشغيل من cpuKnownAnswerRuns[] في البصمة كما شُحنت — الصفوف CPU_D_RUN_<مرحلة>_<ترتيب في المرحلة> (المرحلة والترتيب وplannedAtPct وt وtEnd والفرق tEnd−t وحالة الغربال وsievePrimeCount وsieveDurationMs وحالة SHA وsha256DurationMs والباقي = الفرق − الغربال − SHA)، والصفوف CPU_D_BREAKDOWN_<مرحلة> (مجموع الفرق والغربال وSHA والباقي، كلٌّ بعدد التشغيلات التي دخلت فيه، ومعه المجموع المشحون cpuKnownAnswerTotalMsByPhase ومقارنته). حقل غائب يُكتب ABSENT وبنوع خاطئ WRONG_TYPE(<النوع>) — لا صفراً؛ ومجموع بلا قيمة ABSENT(n=0). الباقي لتشغيل بلا قيمة من الثلاث NOT_COMPUTED(<الحقول>)، ويُستثنى من مجموع الباقي (remainderExcluded). NOT_MEASURED: لا قارئ، أو cpuKnownAnswerRuns غائبة. لا حساب لأيّ خيار: القيم وحدها (طلب المنسّق 2026-10-11).',
  [ITEM.ENERGY_COUNTER_NWH]: 'INFO (بلا حكم): batteryHealth.energyCounterNwh في الطلب (البصمة في reportRaw) وفي ملفّ Storage المنزَّل إلى الذاكرة، وenergyCounterNwhState في الطلب. الخلية: القيمة رقماً · NULL (null صريحة) · ABSENT (المفتاح غائب) · WRONG_TYPE(<نوع>) · CONTAINER_*(<حاوية>) — لا صفر. comparison تسمية لا حكم: SAME_NUMBER · DIFFERENT_NUMBER · <فئة>_BOTH · <فئة الملفّ>_IN_FILE_<فئة الطلب>_IN_REQUEST (مثلاً NULL_IN_FILE_ABSENT_IN_REQUEST: null صريحة في الملفّ وغائب من الطلب؛ NUMBER_IN_FILE_ABSENT_IN_REQUEST: رقم في الملفّ وغائب من الطلب — «عطب» بقول وكيل التطبيق كما نقله المنسّق، منقول غير متحقَّق، وهنا INFO بلا حكم) · FILE_NOT_COMPARED(<سبب تعذّر الملفّ>).',
  [ITEM.CPU_TEMP_FINAL_SOURCE]: 'INFO: cpuTempFinalSource نصّه كما شُحن في الطلب؛ يُقطع عند 200 حرف ويُعلَن القطع وطول الأصل في الصفّ (…[TRUNCATED_TO_200_CHARS length=N]). غائب ABSENT، وnull صريحة NULL.',
  [ITEM.WORKERS_PIN_STATE]: 'INFO: verificationResults.workersPinState نصّه كما شُحن (غائب ABSENT).',
  [ITEM.MEMORY_VERIFY_STATE]: 'INFO: verificationResults.memoryVerifyState نصّه كما شُحن (غائب ABSENT).',
  [ITEM.TIME_TO_FIRST_FIX_STATE]: 'INFO: timeToFirstFixState من measurements في نتيجة L-02 الوظيفية في الطلب (L02_ABSENT إن غاب L-02؛ CONTAINER_ABSENT(measurements) إن غاب؛ ABSENT إن غاب المفتاح).',
  [ITEM.CPU_D_RUN]: 'INFO: تشغيل واحد لـD (انظر CPU_D_RUNS). المرحلة والترتيب: ترتيب العنصر بين عناصر المرحلة نفسها في المصفوفة (i<موضع> لعنصر بلا مرحلة صحيحة).',
  [ITEM.CPU_D_BREAKDOWN]: 'INFO: مراحل D (انظر CPU_D_RUNS). diffSumVsShipped: EQUAL · DIFFERENT (المجموعان حاضران ويختلفان) · ONLY_IN_RUNS · ONLY_IN_SHIPPED · BOTH_ABSENT.',
  [ITEM.THERMAL_HEADROOM]: 'INFO: حالة getThermalHeadroom وعدد القراءات بأصنافها (ok وnan وغيرها)؛ FAIL: شذوذ القارئ في القسم؛ NOT_MEASURED: القائمة غائبة.',
  [ITEM.BATTERY_BROADCASTS]: 'INFO: عدد بثّات البطارية وحالة المستقبِل؛ FAIL: شذوذ؛ NOT_MEASURED: الحالة غائبة.',
  [ITEM.L02]: 'INFO: حالة L-02 وtimeToFirstFix وحالة المحرّك؛ FAIL: شذوذ؛ NOT_MEASURED: L-02 أو measurements غائب.',
  [ITEM.GPU_FPS_TAIL]: 'INFO: آخر 10 قيم لعمود gpu_fps وطول الصفر المتّصل في الذيل؛ NOT_MEASURED: لا عيّنات أو العمود غير محلول.',
  [ITEM.PAYLOAD_BYTES]: 'INFO: حجم مستند reportRaw بالبايت (تقدير) وسقفه، وحجم البصمة المُعاد تركيبها (تقريبي)؛ حجم الطلب على السلك NOT_CARRIED (لا يُحفظ).',
  [ITEM.SAMPLING_TIME]: 'INFO: عدد العيّنات وامتدادها ومتوسّط الفاصل وأقصاه؛ NOT_MEASURED: لا عيّنات.',
  [ITEM.MEMORY_KERNEL]: 'INFO: حالة النواة وزمنها وسقفها وبلوغه وnot_run:insufficient_free_memory وmemoryVerifyFreeBytes؛ FAIL: شذوذ؛ NOT_MEASURED: الحالة غائبة.',
  [ITEM.STORAGE_VERIFY]: 'INFO: حالة التخزين وطريقته وO_DIRECT وأخطاء الكتابة (الختم) والقراءة الراجعة وnot_run:no_time_left؛ FAIL: شذوذ؛ NOT_MEASURED: الحالة غائبة.',
  [ITEM.CYCLE_COUNT]: 'INFO: cycleCount ومصدره (extra_api34 أو غيره) وحالته؛ FAIL: شذوذ؛ NOT_MEASURED: الدورات غائبة أو حالتها not_read (لم تُقرأ؛ الحالة والمصدر في الأساس).',
  [ITEM.CYCLE_COUNT_MATCHES_B08]: 'PASS: cycleCount = rawValue لـB-08 (رقماً). FAIL: يختلفان. NOT_MEASURED: B-08 غائب من الحمولة أو rawValue ليس رقماً أو cycleCount غائب.',
  [ITEM.EVALUATION_RULES_STAMP]: `الجولة الثانية (ختم ≥ ${N.FIELDS_VERSION_70}) — PASS: ${EVALUATION_RULES_VERSION_FIELD} في جذر مستند reports = EVALUATION_RULES_VERSION (الثابت الواحد في src/analysis/evaluationRulesVersion.js؛ لا نسخة حرفية هنا). FAIL: غائب أو بنوع خاطئ أو قيمة أخرى في تقرير كُتب بعد النشر. NOT_MEASURED: ختم < ${N.FIELDS_VERSION_70}، أو التقرير pipeline=cached والمفتاح غائب (التقرير المخبَّأ يحمل ختم الأصل إن حمله وإلا يغيب: analyzeDevice.js evaluationRulesStampFields)، أو مستند reports لم يُقرأ للختم.`,
  [ITEM.CYCLE_CLASSIFICATION]: `الجولة الثانية (ختم ≥ ${N.FIELDS_VERSION_70}) — تصنيف الدورات من القارئ نفسه: classifyCycleCount(batteryHealth.cycleCount) (cycleCountClassification.js). التوقّع لكل وسم **وسيط** (--cycle-expect الوسم=classified|none) لا ثابت في الكود: classified = ${N.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34}، none = null. PASS: المرصود = المتوقَّع. FAIL: غيره. INFO: لا توقّع لهذا الوسم. NOT_MEASURED: ختم < ${N.FIELDS_VERSION_70} أو لا قارئ.`,
  [ITEM.CYCLE_CLASSIFICATION_SIGNATURE]: `INFO (لا حكم): ما حُفظ في بصمة الجهاز deviceProfiles/{primary}.scanHistory[scanId].signature.battery.cycleCountClassification (قراءة بحتة، المفتاح primary من deviceProfileKey بالمُطبِّع نفسه؛ أحدث 5 فحوص فقط). تُسمّى كل حالة تعذّر صراحةً (PROFILE_BY_PRIMARY_NOT_FOUND: قد يكون الملفّ وُجد بطبقة أخرى لا primary · SCAN_NOT_IN_HISTORY · SIGNATURE_NULL · …) ولا تُقرأ غياباً أو نجاحاً. المفتاح يغيب من التوقيع حين لم يقع التصنيف (computeScanSignature).`,
  [ITEM.SESSION_SCAN]: 'INFO: هل التقرير فحص جلسة (sessionId في reportRaw). FAIL: وسم يبدأ بـS بلا sessionId. باقي بنود SESSION_* لفحوص الجلسة وحدها.',
  [ITEM.SESSION_STATUS]: 'PASS: scanSessions/{sessionId}.status = completed. FAIL: حالة أخرى معروفة أو غير معروفة أو غائبة. NOT_MEASURED: مستند الجلسة غائب.',
  [ITEM.SESSION_JOINED_BY]: 'وسم بلا توقّعات خاصّة — INFO: joinedBy حاضر أم لا (مُهشَّراً) وjoinedAt.',
  [ITEM.SESSION_SCAN_LINK]: 'PASS: scanId الجلسة = scanId التقرير، وownerId الجلسة (مُهشَّراً) = حساب المالك. FAIL: غير ذلك. NOT_MEASURED: مستند الجلسة غائب.',
  [ITEM.EVALUATION_DOC]: 'وسم بلا توقّعات خاصّة — PASS (فحص جلسة): evaluations/{scanId} موجود وpending=false. INFO: موجود وpending=true، أو غائب في تقرير غير جلسة. NOT_MEASURED: غائب في فحص جلسة (لم يُرسَل بعد).',
  [ITEM.EVALUATION_NO_MOVED_IDS]: `PASS: لا مفتاح من الحقول المنقولة إلى reportRaw (${REPORT_RAW_FIELDS.join(' · ')}؛ والمعرّفات منها بنصّ evaluationContract.js:72-80: ${RAW_LINKAGE_FIELDS.join(' · ')}) على أيّ عمق في مستند evaluations. FAIL: وُجد مفتاح منها. NOT_MEASURED: المستند غائب.`,
});
/** القواعد النهائية: العامّة (مع متغيّرات الوسوم المسرودة بسطر وثيقتها) + قاعدة كل صفّ EXPECT_* (نصّه واقتباسه ومصدره). */
const ITEM_RULES = Object.freeze({
  ...Object.fromEntries(Object.entries(BASE_RULES).map(([item, text]) => [item, withVariants(item, text)])),
  ...Object.fromEntries(Object.values(EXPECT).map((id) => [id, linesOfItem(id).map(lineText).join(' | ')])),
});
/** قواعد الجولة الثانية (`--round 2`): البنود العامّة بمتغيّرات وسوم جدول الجولة ٢، وكل صفّ EXPECT يستعمله جدولها (ومنها M15) بنصّه واقتباسه وسطر وثيقته. */
const ITEM_RULES_R2 = Object.freeze({
  ...Object.fromEntries(Object.entries(BASE_RULES).map(([item, text]) => [item, withVariants(item, text, TAG_EXPECTATIONS_R2)])),
  ...Object.fromEntries([...Object.values(EXPECT), ...Object.values(EXPECT_R2)].filter((id) => linesOfItem(id, TAG_EXPECTATIONS_R2).length > 0).map((id) => [id, linesOfItem(id, TAG_EXPECTATIONS_R2).map(lineText).join(' | ')])),
});

const isObj =(v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);
const row = (item, verdict, basis) => ({item, verdict, basis});
const fmt = (v) => (v === null ? 'null' : (v === undefined ? 'absent' : (typeof v === 'object' ? JSON.stringify(v) : String(v))));
const kv = (o) => Object.entries(o).map(([k, v]) => `${k}=${fmt(v)}`).join(' ');
const round = (x, d = 4) => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const stateRaw = (cell) => (cell && cell.state ? cell.state.raw : null);
const stateKind = (cell) => (cell && cell.state ? cell.state.kind : null);
const stateDetail = (cell) => (cell && cell.state ? cell.state.detail : null);
const plus03Iso = (ms) => new Date(ms + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00');

// ───────────────────────── الوسائط ─────────────────────────

/**
 * --tokens B1=NC-AAAAAA,B2=NC-BBBBBB … — الوسم نصّ قصير، والرمز shortId (NC- وستّة أحرف كبيرة أو أرقام). وسم مكرَّر أو رمز مكرَّر أو فارغ = خطأ صريح (لا اختيار صامت).
 * @param {string} text
 * @return {Array<{tag: string, shortId: string}>}
 */
function parseTokens(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('USAGE: --tokens فارغ');
  const parts = text.split(',').map((s) => s.trim());
  if (parts.length > MAX_TOKENS) throw new Error(`USAGE: --tokens أكثر من ${MAX_TOKENS}`);
  const tokens = [];
  for (const p of parts) {
    const m = /^([^=]+)=(.+)$/.exec(p);
    if (!m) throw new Error('USAGE: --tokens بصيغة الوسم=NC-XXXXXX مفصولاً بفواصل (عنصر بلا =)');
    const [, tag, shortId] = m;
    if (!TAG_PATTERN.test(tag)) throw new Error('USAGE: وسم غير صالح (حرف ثم حتى 23 حرفاً أو رقماً أو _ أو -)');
    if (!C.SHORT_ID_PATTERN.test(shortId)) throw new Error('USAGE: --tokens: الرمز بصيغة NC-XXXXXX (ستّة أحرف كبيرة أو أرقام)');
    if (tokens.some((t) => t.tag === tag)) throw new Error('USAGE: --tokens: وسم مكرَّر');
    if (tokens.some((t) => t.shortId === shortId)) throw new Error('USAGE: --tokens: رمز مكرَّر');
    tokens.push({tag, shortId});
  }
  return tokens;
}

/** توقّع تصنيف الدورات لكل وسم: classified (الوسم الوحيد اليوم) أو none (null). وسيط لا ثابت (الجزء الخامس). */
const CYCLE_EXPECT_VALUES = Object.freeze(['classified', 'none']);
/**
 * --cycle-expect S1=classified,B1=none — الوسم يجب أن يكون في --tokens، والقيمة classified أو none. وسم مكرَّر أو قيمة أخرى = خطأ صريح.
 * @param {string} text
 * @param {Array<{tag: string}>} tokens
 * @return {Object<string, string>} وسم ← classified|none
 */
function parseCycleExpect(text, tokens) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('USAGE: --cycle-expect فارغ');
  const out = {};
  for (const part of text.split(',').map((s) => s.trim())) {
    const m = /^([^=]+)=(.+)$/.exec(part);
    if (!m) throw new Error('USAGE: --cycle-expect بصيغة الوسم=classified|none (عنصر بلا =)');
    const [, tag, value] = m;
    if (!tokens.some((t) => t.tag === tag)) throw new Error('USAGE: --cycle-expect: وسم ليس في --tokens');
    if (!CYCLE_EXPECT_VALUES.includes(value)) throw new Error('USAGE: --cycle-expect: القيمة classified أو none');
    if (Object.prototype.hasOwnProperty.call(out, tag)) throw new Error('USAGE: --cycle-expect: وسم مكرَّر');
    out[tag] = value;
  }
  return out;
}

/**
 * --round 1|2 (الجزء السادس): الجولة التي يُحكَم بجدول توقّعاتها. الغائب = 1 (الجولة ١ كما كانت، لقراءة تقاريرها ثانيةً)؛ وأيّ قيمة غير "1" أو "2" USAGE (القاعدة 22) — لا اختيار صامت.
 * @param {?string} text
 * @return {number} 1 أو 2
 */
function parseRound(text) {
  if (text === undefined) return 1;
  if (text === '1') return 1;
  if (text === '2') return 2;
  throw new Error('USAGE: --round: 1 أو 2');
}

/** الوسائط: --tokens <قائمة> --out <file.json> [--no-storage] [--cycle-expect الوسم=classified|none,…] [--round 1|2] | --preflight. */
function parseArgs(argv) {
  const usage = 'USAGE: --tokens B1=NC-XXXXXX,S1=NC-XXXXXX,… --out <after.json> [--no-storage] [--round 1|2] [--cycle-expect S1=classified,B1=none] | --preflight';
  const p = C.parseFlags(argv, {values: ['--tokens', '--out', '--cycle-expect', '--round'], flags: ['--preflight', '--no-storage']});
  if (p.flags['--preflight']) {
    if (p.values['--tokens'] !== undefined || p.values['--out'] !== undefined || p.values['--cycle-expect'] !== undefined || p.values['--round'] !== undefined || p.flags['--no-storage']) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', tokens: null, out: null, useStorage: null, cycleExpect: null, round: null};
  }
  if (p.values['--tokens'] === undefined || p.values['--out'] === undefined) throw new Error(usage);
  const tokens = parseTokens(p.values['--tokens']);
  return {mode: 'run', tokens, out: p.values['--out'], useStorage: !p.flags['--no-storage'], cycleExpect: p.values['--cycle-expect'] === undefined ? {} : parseCycleExpect(p.values['--cycle-expect'], tokens), round: parseRound(p.values['--round'])};
}

// ───────────────────────── الجمع (قراءة بحتة) ─────────────────────────

/**
 * يجمع حقائق تقرير واحد. لا حكم هنا. ما في الذاكرة من معرّفات خامّة لا يخرج (المعرّفات تُهشَّر هنا قبل أيّ مخرَج).
 * @param {Object} p
 * @param {Object} p.db مغلَّف بـwrapReadOnly
 * @param {?Object} p.bucket مغلَّف بـwrapReadOnlyBucket (null مع useStorage=false)
 * @param {string} p.tag
 * @param {string} p.shortId
 * @param {string} p.accountHash حساب المالك (مُهشَّراً)
 * @param {boolean} p.useStorage
 * @return {Promise<Object>}
 */
/**
 * بصمة الجهاز المحفوظة لهذا الفحص: deviceProfiles/{primary} (قراءة doc واحدة)، ثم عنصر scanHistory الذي scanId فيه = scanId التقرير، ثم signature.battery.cycleCountClassification.
 * كل تعذّر حالة مسمّاة (القاعدة 22): primary وحده يُقرأ — ملفّ وُجد بطبقة أخرى (A/B/C) لا يظهر هنا (PROFILE_BY_PRIMARY_NOT_FOUND لا تعني غياب الملفّ). scanHistory أحدث 5 فحوص فقط. المعرّف يُهشَّر.
 * @param {{db: Object, raw: ?Object, scanId: string}} p
 * @return {Promise<Object>}
 */
async function gatherProfileFacts({db, raw, scanId}) {
  const fp = raw && isObj(raw.rawFingerprint) ? raw.rawFingerprint : null;
  if (fp === null) return {state: 'NO_RAW_FINGERPRINT'};
  const key = isObj(fp.device) ? fp.device.deviceProfileKey : undefined;
  const norm = normalizeDeviceProfileKey(key);
  if (!norm.usable) return {state: 'DEVICE_PROFILE_KEY_UNUSABLE'};
  const primary = norm.key.primary;
  if (primary === UNKNOWN_PRIMARY) return {state: 'PRIMARY_IS_UNKNOWN_FALLBACK'};
  const profileIdHash = C.hashIdForLog(primary);
  try {
    const snap = await db.collection(DEVICE_PROFILES_COLLECTION).doc(primary).get();
    if (!snap.exists) return {state: 'PROFILE_BY_PRIMARY_NOT_FOUND', profileIdHash};
    const data = snap.data() || {};
    const hist = Array.isArray(data.scanHistory) ? data.scanHistory : null;
    if (hist === null) return {state: 'SCAN_HISTORY_ABSENT_OR_NOT_ARRAY', profileIdHash};
    const entry = hist.find((e) => isObj(e) && e.scanId === scanId);
    if (entry === undefined) return {state: 'SCAN_NOT_IN_HISTORY', profileIdHash, historyLength: hist.length};
    const sig = entry.signature;
    if (sig === null) return {state: 'ENTRY_FOUND', profileIdHash, historyLength: hist.length, signatureState: 'SIGNATURE_NULL', classification: null};
    if (!isObj(sig)) return {state: 'ENTRY_FOUND', profileIdHash, historyLength: hist.length, signatureState: 'SIGNATURE_ABSENT_OR_NOT_OBJECT', classification: null};
    if (!isObj(sig.battery)) return {state: 'ENTRY_FOUND', profileIdHash, historyLength: hist.length, signatureState: 'SIGNATURE_BATTERY_ABSENT_OR_NOT_OBJECT', classification: null};
    return {state: 'ENTRY_FOUND', profileIdHash, historyLength: hist.length, signatureState: 'OBJECT', classification: valueCell(sig.battery, 'signature.battery', 'cycleCountClassification', 'string')};
  } catch (e) {
    return {state: 'PROFILE_READ_FAILED', profileIdHash, errorClass: String(e && e.constructor && e.constructor.name), errorCode: e && e.code !== undefined ? String(e.code) : undefined};
  }
}

async function gatherReportFacts({db, bucket, tag, shortId, accountHash, useStorage}) {
  const found = await db.collection(REPORTS_COLLECTION).where('shortId', '==', shortId).select('userId').limit(3).get();
  const facts = {tag, shortIdHash: C.hashIdForLog(shortId), found: found.size};
  if (found.size !== 1) return facts;
  const scanId = found.docs[0].id;
  const read = await readReportWithRaw({db, scanId});
  if (!read.exists) return {...facts, found: 0, vanished: true};
  const userId = read.reportData.userId;
  facts.scanIdHash = C.hashIdForLog(scanId);
  facts.userHash = C.hashIdForLog(userId);
  facts.ownerMatches = typeof userId === 'string' && userId !== '' ? C.hashIdForLog(userId) === accountHash : null;
  facts.rawRead = read.rawRead;
  const raw = read.rawRead && read.rawRead.raw ? read.rawRead.raw : null;
  // الجولة الثانية (الجزء الخامس): ختم قواعد التقييم وpipeline من جذر مستند reports (حقلان لا المستند)؛ وبصمة الجهاز المحفوظة (قراءة بحتة).
  facts.rulesStamp = {
    stamp: valueCell(read.reportData, REPORTS_COLLECTION, EVALUATION_RULES_VERSION_FIELD, 'string'),
    pipeline: valueCell(read.reportData, REPORTS_COLLECTION, 'pipeline', 'string'),
  };
  facts.profile = await gatherProfileFacts({db, raw, scanId});

  // Storage: إلى الذاكرة وحدها
  const storagePath = raw ? raw.timeSeriesStoragePath : undefined;
  if (raw === null) facts.storage = {state: 'RAW_ABSENT'};
  else if (typeof storagePath !== 'string' || storagePath.trim() === '') facts.storage = {state: 'STORAGE_PATH_ABSENT'};
  else if (!useStorage) facts.storage = {state: 'STORAGE_NOT_READ_BY_OPTION'};
  else {
    const r = await fetchSamplesFromStorage(bucket, storagePath);
    facts.storage = r.state === 'DOWNLOADED' ?
      {state: 'DOWNLOADED', json: r.samples} :
      {state: r.state, ...(r.errorCode !== undefined ? {errorCode: String(r.errorCode), errorClass: String(r.errorClass)} : {})};
  }

  // الجلسة
  const sessionId = raw ? raw.sessionId : undefined;
  if (raw === null || sessionId === undefined || sessionId === null) {
    facts.session = {state: 'NOT_A_SESSION_SCAN'};
  } else if (typeof sessionId !== 'string' || sessionId === '') {
    facts.session = {state: 'SESSION_ID_UNREADABLE'};
  } else {
    const snap = await db.collection(SESSIONS_COLLECTION).doc(sessionId).get();
    facts.session = snap.exists ? {state: 'READ', data: snap.data() || {}, sessionIdHash: C.hashIdForLog(sessionId), scanIdMatches: null} : {state: 'SESSION_DOC_ABSENT', sessionIdHash: C.hashIdForLog(sessionId)};
    if (snap.exists) {
      const d = facts.session.data;
      facts.session.scanIdMatches = typeof d.scanId === 'string' && d.scanId !== '' ? d.scanId === scanId : null;
      facts.session.ownerMatches = typeof d.ownerId === 'string' && d.ownerId !== '' ? C.hashIdForLog(d.ownerId) === accountHash : null;
    }
  }

  // evaluations/{scanId}
  const evSnap = await db.collection(EVALUATIONS_COLLECTION).doc(scanId).get();
  facts.evaluation = evSnap.exists ? {exists: true, data: evSnap.data() || {}} : {exists: false};
  return facts;
}

// ───────────────────────── تحليل ─────────────────────────

/** مفاتيح كائن على أيّ عمق (أسماء المفاتيح وحدها) — للبحث عن المنقولة. */
function allKeysDeep(value, acc = new Set(), depth = 0) {
  if (depth > 12) return acc;
  if (Array.isArray(value)) { for (const v of value) allKeysDeep(v, acc, depth + 1); return acc; }
  if (isObj(value) && Object.getPrototypeOf(value) === Object.prototype) {
    for (const k of Object.keys(value)) { acc.add(k); allKeysDeep(value[k], acc, depth + 1); }
  }
  return acc;
}

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * ما يُستخرج من العيّنات (أرقام وأعداد، لا قراءات): الامتداد، امتداد كل مرحلة، وذيل gpu_fps. التخطيط من القارئ (columnIndex بالاسم) لا من موضع ثابت.
 * @param {Array} samples
 * @param {Object} layout ناتج readFv68(...).layout
 * @return {Object}
 */
function analyzeSamples(samples, layout) {
  if (!Array.isArray(samples) || samples.length === 0) return {state: 'NO_SAMPLES', sampleCount: 0};
  const ti = columnIndex(layout, N.BASE_CHANNELS.TIMESTAMP_MS);
  const gi = columnIndex(layout, N.BASE_CHANNELS.GPU_FPS);
  const out = {state: 'READ', sampleCount: samples.length, timestampColumn: ti, gpuFpsColumn: gi};
  if (ti === null) return {...out, state: 'TIMESTAMP_COLUMN_UNRESOLVED'};
  const ts = samples.map((s) => (isObj(s) && Array.isArray(s.v) && Number.isFinite(s.v[ti]) ? s.v[ti] : null));
  const finite = ts.filter((t) => t !== null);
  out.timestampsReadable = finite.length;
  if (finite.length < 2) return {...out, state: 'TIMESTAMPS_UNREADABLE'};
  const gaps = [];
  for (let i = 1; i < ts.length; i++) if (ts[i] !== null && ts[i - 1] !== null) gaps.push(ts[i] - ts[i - 1]);
  out.firstMs = finite[0];
  out.lastMs = finite[finite.length - 1];
  out.spanMs = Math.max(...finite) - Math.min(...finite);
  out.medianIntervalMs = median(gaps);
  out.maxIntervalMs = gaps.length ? Math.max(...gaps) : null;
  out.monotonic = gaps.every((g) => g >= 0);
  const phases = {};
  samples.forEach((s, i) => {
    if (!isObj(s) || !Number.isInteger(s.phase) || ts[i] === null) return;
    const p = phases[s.phase] || (phases[s.phase] = {samples: 0, minMs: Infinity, maxMs: -Infinity});
    p.samples++;
    p.minMs = Math.min(p.minMs, ts[i]);
    p.maxMs = Math.max(p.maxMs, ts[i]);
  });
  for (const p of Object.values(phases)) p.durationMs = p.maxMs - p.minMs;
  out.phases = phases;
  if (gi !== null) {
    const vals = samples.map((s) => (isObj(s) && Array.isArray(s.v) && Number.isFinite(s.v[gi]) ? s.v[gi] : null));
    const tail = vals.slice(-GPU_FPS_TAIL_COUNT);
    let zeroRun = 0;
    for (let i = vals.length - 1; i >= 0 && vals[i] === 0; i--) zeroRun++;
    let nonNumericRun = 0;
    for (let i = vals.length - 1; i >= 0 && vals[i] === null; i--) nonNumericRun++;
    out.gpuFps = {tail, tailCount: tail.length, trailingZeroRun: zeroRun, trailingNonNumericRun: nonNumericRun, nonNumericCount: vals.filter((v) => v === null).length};
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════════════
// تفصيل D لكل تشغيل — طلب المنسّق 2026-10-11 +03 (قراءة وحدها، صفوف INFO وحدها).
//
// السبب (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): تشغيل المستخدم للسكربت ٢ على الإنتاج 2026-10-11 10:13 +03 أخرج FAIL لمعيار D في B2 وS1 (1.0745 و1.2149 و1.4596 بالمئة).
// قرار المستخدم 2026-10-08 بنصّه: «فالخياران المفضّلان قبل تغيير المعيار: تشغيل واحد لكل مرحلة بدل ثلاثة، أو غربال حتى مليون بدل عشرة ملايين (ونتيجته المعروفة 78,498). ويُعرض عليّ بالأرقام.»
// والأرقام تحتاج زمن الغربال وزمن SHA-256 لكل تشغيل، وهما في الحمولة (عقد docs/FV68_CONTRACT.md:1253: «لا sieveDurationMs وsha256DurationMs وحدهما (يبقيان)»).
//
// ما يُخرَج: لكل عنصر من cpuKnownAnswerRuns[] في البصمة (reportRaw كما شُحنت): المرحلة والترتيب وt وtEnd والفرق (tEnd − t) وحالة الغربال وعدده الأوّلي وزمنه وحالة SHA وزمنه والباقي (الفرق − الغربال − SHA).
// ولكل مرحلة: مجموع الفرق ومجموع الغربال ومجموع SHA والباقي — كلٌّ بعدد التشغيلات التي دخلت فيه.
// القاعدة 22: حقل غائب يُعلَن غائباً (ABSENT)، وحقل بنوع خاطئ WRONG_TYPE — لا صفراً. ومجموع بلا أيّ قيمة null لا 0.
// **لا حكم ولا حساب للخيارين هنا:** القيم وحدها، والحساب عند المنسّق. ولا يتغيّر حكم أيّ بند قائم (CPU_D_SHARE وصفوفه كما هي، ومعيار D ومصدره).
// حالة الغربال وSHA تُقرأ بـparseState من المصدر الواحد (fv68Reader) وبمفردة العقد (N.VOCAB.CPU_KNOWN_ANSWER_SIEVE_STATUS/SHA256_STATUS).
// ═════════════════════════════════════════════════════════════════════════════════════

/** مفتاح مرحلة بلا قيمة صحيحة في عنصر التشغيل (يُجمَع تحته ما لا مرحلة له). */
const CPU_PHASE_NONE = 'NA';
const FIELD_PRESENT = N.KEY_STATUS.PRESENT;
const typeName = (v) => (v === null ? 'null' : (Array.isArray(v) ? 'array' : typeof v));
/** حالة الحقل نصّاً: PRESENT أو ABSENT (المفتاح غائب) أو WRONG_TYPE(<النوع>) (ومنه null) — ألفاظ N.KEY_STATUS (القاعدة 24). */
const wrongType = (v) => `${N.KEY_STATUS.WRONG_TYPE}(${typeName(v)})`;
/** قيمة عددية في عنصر. */
function runNumber(el, key) {
  if (!has(el, key)) return {state: N.KEY_STATUS.ABSENT, value: null};
  const v = el[key];
  return typeof v === 'number' && Number.isFinite(v) ? {state: FIELD_PRESENT, value: v} : {state: wrongType(v), value: null};
}
/** حالة نصّية في عنصر (الغربال أو SHA): النصّ كما شُحن، وصنفه ومعرفته من parseState بمفردة العقد. */
function runStatus(el, key, vocab) {
  if (!has(el, key)) return {state: N.KEY_STATUS.ABSENT, value: null, kind: null, recognized: null};
  const v = el[key];
  if (typeof v !== 'string') return {state: wrongType(v), value: null, kind: null, recognized: null};
  const p = parseState(v, vocab);
  return {state: FIELD_PRESENT, value: v, kind: p.kind, recognized: p.recognized};
}
/** سبب الغياب لحقل (null إن حاضر). */
const cellBad = (name, c) => (c.state === FIELD_PRESENT ? null : `${name}:${c.state}`);
/** نصّ القيمة في صفّ الجدول: القيمة، أو حالة الغياب نصّاً (لا صفر). */
const cellShow = (c) => (c.state === FIELD_PRESENT ? String(c.value) : c.state);
const sumList = (list) => ({sumMs: list.length > 0 ? list.reduce((x, y) => x + y, 0) : null, runsCounted: list.length});

/**
 * تفصيل D لكل تشغيل ولكل مرحلة، قراءة بحتة.
 * @param {*} vr ‏`timeSeries.footer.verificationResults` كما شُحن (كائن أو غيره)
 * @param {Object} k ‏`readFv68(...).verification.cpuKnownAnswer` (حالة خلية المصفوفة وخلية المجاميع المشحونة)
 * @param {{fieldsVersion?: ?number}} [opts] ختم الحمولة إن عُرف: يحدّد هل يُصرَّح بغياب sieveLimit في صفّ التشغيل (≥ 70) أم يُسكَت عنه (68 و69: N = 10000000 بالعقد)
 * @return {Object} ‏{source, fieldsVersion, runsStatus, shippedTotalsStatus, runs|null, byPhase|null, phaseExtras|null}
 */
function readCpuRunDetail(vr, k, opts = {}) {
  const fieldsVersion = opts && Number.isInteger(opts.fieldsVersion) ? opts.fieldsVersion : null;
  const R = N.CPU_KNOWN_ANSWER_RUN_ELEMENT;
  const rawRuns = isObj(vr) && has(vr, N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS) ? vr[N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS] : undefined;
  const out = {
    source: `${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS} (البصمة في reportRaw كما شُحنت)`,
    fieldsVersion, runsStatus: k.runs.status, shippedTotalsStatus: k.totalMsByPhase.status, runs: null, byPhase: null, phaseExtras: null,
  };
  if (k.runs.status !== N.KEY_STATUS.PRESENT || !Array.isArray(rawRuns)) return out;
  const orderCounter = {};
  out.runs = rawRuns.map((el, index) => {
    if (!isObj(el)) {
      const why = `NOT_OBJECT(${typeName(el)})`;
      return {index, phase: null, phaseKey: CPU_PHASE_NONE, orderInPhase: null, elementState: why, notPresent: [`element:${why}`]};
    }
    const phase = runNumber(el, R.PHASE);
    const planned = runNumber(el, R.PLANNED_AT_PCT);
    const t = runNumber(el, R.T);
    const tEnd = runNumber(el, R.T_END);
    const sieveStatus = runStatus(el, R.SIEVE_STATUS, N.VOCAB.CPU_KNOWN_ANSWER_SIEVE_STATUS);
    const sieveCount = runNumber(el, R.SIEVE_PRIME_COUNT);
    const sieveMs = runNumber(el, R.SIEVE_DURATION_MS);
    const shaStatus = runStatus(el, R.SHA256_STATUS, N.VOCAB.CPU_KNOWN_ANSWER_SHA256_STATUS);
    const shaMs = runNumber(el, R.SHA256_DURATION_MS);
    // fv70 (§٧-ط): N خارج `cells` عمداً — غيابه في fv68/69 بالتصميم فلا يُسرد في notPresent ولا يغيّر عدّ runsWithFieldsNotPresent القائم.
    const sieveLimit = runNumber(el, R.SIEVE_LIMIT);
    const skipped = sieveStatus.kind === N.STATE_KIND.SKIPPED_TIME_BUDGET || shaStatus.kind === N.STATE_KIND.SKIPPED_TIME_BUDGET;
    const notReached = sieveStatus.kind === N.STATE_KIND.NOT_REACHED;
    // cancelled (الجزء الخامس): بدأ وقطعته المرحلة — ليس من EXECUTED_STATUSES، فلا يُعدّ منفَّذاً ولا يُحسب نجاحاً ولا فشلاً.
    const cancelled = sieveStatus.kind === N.STATE_KIND.CANCELLED || shaStatus.kind === N.STATE_KIND.CANCELLED;
    const shipsSieveLimit = N.SIEVE_STATUS_KINDS_CARRYING_LIMIT.includes(sieveStatus.kind);
    const phaseKey = phase.state === FIELD_PRESENT && Number.isInteger(phase.value) ? String(phase.value) : CPU_PHASE_NONE;
    const orderInPhase = phaseKey === CPU_PHASE_NONE ? null : (orderCounter[phaseKey] = (orderCounter[phaseKey] || 0) + 1);
    const diffMissing = [cellBad(R.T, t), cellBad(R.T_END, tEnd)].filter((x) => x !== null);
    const diffMs = diffMissing.length === 0 ? tEnd.value - t.value : null;
    const remMissing = [...diffMissing, cellBad(R.SIEVE_DURATION_MS, sieveMs), cellBad(R.SHA256_DURATION_MS, shaMs)].filter((x) => x !== null);
    const remainderMs = remMissing.length === 0 ? diffMs - sieveMs.value - shaMs.value : null;
    const cells = {
      [R.PHASE]: phase, [R.PLANNED_AT_PCT]: planned, [R.T]: t, [R.T_END]: tEnd, [R.SIEVE_STATUS]: sieveStatus, [R.SIEVE_PRIME_COUNT]: sieveCount,
      [R.SIEVE_DURATION_MS]: sieveMs, [R.SHA256_STATUS]: shaStatus, [R.SHA256_DURATION_MS]: shaMs,
    };
    return {
      index, phase: phase.value, phaseKey, orderInPhase, plannedAtPct: planned.value, t: t.value, tEnd: tEnd.value,
      diffMs, diffState: diffMissing.length === 0 ? (diffMs < 0 ? 'NEGATIVE' : 'COMPUTED') : `NOT_COMPUTED(${diffMissing.join(',')})`,
      sieve: {status: sieveStatus.value, kind: sieveStatus.kind, recognized: sieveStatus.recognized, primeCount: sieveCount.value, durationMs: sieveMs.value},
      sha256: {status: shaStatus.value, kind: shaStatus.kind, recognized: shaStatus.recognized, durationMs: shaMs.value},
      remainderMs, remainderState: remMissing.length === 0 ? 'COMPUTED' : `NOT_COMPUTED(${remMissing.join(',')})`,
      sieveLimit, skipped, cancelled, notReached, shipsSieveLimit,
      fieldStates: Object.fromEntries(Object.entries(cells).map(([name, c]) => [name, c.state])),
      notPresent: Object.entries(cells).map(([name, c]) => cellBad(name, c)).filter((x) => x !== null),
    };
  });
  // المجاميع لكل مرحلة (والمراحل التي في المجاميع المشحونة وحدها تظهر بصفر تشغيلات)
  const shippedByPhase = k.totalMsByPhase.status === N.KEY_STATUS.PRESENT ? k.totalMsByPhase.byPhase : null;
  // مراحل التشغيلات ثم مراحل المجموع المشحون (بلا .add: حارس «لا كتابة» الساكن يمنع .add على غير المستقبِلات المسموحة)
  const phaseKeys = [...new Set([...out.runs.map((r) => r.phaseKey), ...(shippedByPhase !== null ? Object.keys(shippedByPhase) : [])])];
  out.byPhase = {};
  for (const key of phaseKeys.sort((a, b) => (a === CPU_PHASE_NONE ? 1 : (b === CPU_PHASE_NONE ? -1 : Number(a) - Number(b))))) {
    const rs = out.runs.filter((r) => r.phaseKey === key && r.elementState === undefined);
    const diff = sumList(rs.filter((r) => r.diffMs !== null).map((r) => r.diffMs));
    const sieve = sumList(rs.filter((r) => r.sieve.durationMs !== null).map((r) => r.sieve.durationMs));
    const sha = sumList(rs.filter((r) => r.sha256.durationMs !== null).map((r) => r.sha256.durationMs));
    const remRuns = rs.filter((r) => r.remainderMs !== null);
    const remainder = {...sumList(remRuns.map((r) => r.remainderMs)), excluded: rs.filter((r) => r.remainderMs === null).map((r) => ({index: r.index, reason: r.remainderState}))};
    const shipped = shippedByPhase !== null && has(shippedByPhase, key) ? shippedByPhase[key] : null;
    const shippedState = k.totalMsByPhase.status !== N.KEY_STATUS.PRESENT ? k.totalMsByPhase.status : (shipped !== null ? N.KEY_STATUS.PRESENT : 'ABSENT_FOR_PHASE');
    let vs;
    if (diff.sumMs !== null && shipped !== null) vs = diff.sumMs === shipped ? 'EQUAL' : 'DIFFERENT';
    else if (diff.sumMs !== null) vs = shippedState === N.KEY_STATUS.PRESENT || shippedState === 'ABSENT_FOR_PHASE' ? 'ONLY_IN_RUNS' : `RUNS_ONLY(shipped:${shippedState})`;
    else if (shipped !== null) vs = 'ONLY_IN_SHIPPED';
    else vs = 'BOTH_ABSENT';
    out.byPhase[key] = {
      phase: key === CPU_PHASE_NONE ? null : Number(key), runs: rs.length, runIndexes: rs.map((r) => r.index),
      diff, sieve, sha256: sha, remainder,
      shippedTotalMs: shipped, shippedTotalState: shippedState, diffSumVsShipped: vs,
    };
  }
  // fv70: ما يلزم صفوف الجولة الثانية لكل مرحلة — خارج byPhase (لا يمسّ شكلها القائم). المتروك لا يدخل أيّ مجموع (لا نجاح ولا فشل ولا صفر).
  out.phaseExtras = {};
  for (const key of Object.keys(out.byPhase)) {
    const rs = out.runs.filter((r) => r.phaseKey === key && r.elementState === undefined);
    out.phaseExtras[key] = {
      runs: rs.length,
      executed: rs.filter((r) => r.diffMs !== null && !r.skipped && !r.notReached && !r.cancelled).length,
      skipped: rs.filter((r) => r.skipped).length,
      cancelled: rs.filter((r) => r.cancelled).length,
      notReached: rs.filter((r) => r.notReached).length,
      sieveLimits: rs.filter((r) => r.sieveLimit.state === FIELD_PRESENT).map((r) => r.sieveLimit.value).filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b),
      sievePrimeCounts: rs.filter((r) => r.sieve.primeCount !== null).map((r) => r.sieve.primeCount),
    };
  }
  return out;
}

/** صفوف INFO من التفصيل: صفّ لكل تشغيل وصفّ لكل مرحلة. لا حكم. القيمة الغائبة تُكتب حالة غيابها (ABSENT أو WRONG_TYPE) لا صفراً. */
function cpuRunDetailRows(detail) {
  const rows = [];
  for (const r of detail.runs) {
    const item = `${ITEM.CPU_D_RUN}_${r.phaseKey}_${r.orderInPhase === null ? `i${r.index}` : r.orderInPhase}`;
    if (r.elementState !== undefined) {
      rows.push(row(item, V.INFO, `index=${r.index} element=${r.elementState}`));
      continue;
    }
    const show = (name, value) => (r.fieldStates[name] === FIELD_PRESENT ? String(value) : r.fieldStates[name]);
    const F = N.CPU_KNOWN_ANSWER_RUN_ELEMENT;
    // sieveLimit يُضاف في آخر الصفّ: حين يكون حاضراً، أو ممّا يُشحن معه في ختم ≥ 70 (فغيابه حينها يُكتب حالته لا يُسكَت عنه). في 68 و69 غيابه بالتصميم فلا يُذكر (الصفّ كما كان بايتاً).
    const limitText = r.sieveLimit.state === FIELD_PRESENT ? [`sieveLimit=${r.sieveLimit.value}`] :
      (r.shipsSieveLimit && detail.fieldsVersion !== null && detail.fieldsVersion >= N.FIELDS_VERSION_70 ? [`sieveLimit=${r.sieveLimit.state}`] : []);
    rows.push(row(item, V.INFO, [
      `index=${r.index}`, `phase=${show(F.PHASE, r.phase)}`, `order=${r.orderInPhase === null ? 'ABSENT' : r.orderInPhase}`,
      `plannedAtPct=${show(F.PLANNED_AT_PCT, r.plannedAtPct)}`, `t=${show(F.T, r.t)}`, `tEnd=${show(F.T_END, r.tEnd)}`,
      `diffMs=${r.diffMs === null ? r.diffState : (r.diffState === 'NEGATIVE' ? `${r.diffMs}(NEGATIVE)` : r.diffMs)}`,
      `sieveStatus=${show(F.SIEVE_STATUS, r.sieve.status)}`, `sievePrimeCount=${show(F.SIEVE_PRIME_COUNT, r.sieve.primeCount)}`, `sieveDurationMs=${show(F.SIEVE_DURATION_MS, r.sieve.durationMs)}`,
      `sha256Status=${show(F.SHA256_STATUS, r.sha256.status)}`, `sha256DurationMs=${show(F.SHA256_DURATION_MS, r.sha256.durationMs)}`,
      `remainderMs=${r.remainderMs === null ? r.remainderState : r.remainderMs}`,
      ...limitText,
    ].join(' ')));
  }
  const sm = (x) => (x.sumMs === null ? 'ABSENT(n=0)' : `${x.sumMs}(n=${x.runsCounted})`);
  for (const [key, p] of Object.entries(detail.byPhase)) {
    rows.push(row(`${ITEM.CPU_D_BREAKDOWN}_${key}`, V.INFO, [
      `runs=${p.runs}`, `sumDiffMs=${sm(p.diff)}`, `sumSieveMs=${sm(p.sieve)}`, `sumSha256Ms=${sm(p.sha256)}`, `remainderMs=${sm(p.remainder)}`,
      ...(p.remainder.excluded.length ? [`remainderExcluded=${JSON.stringify(p.remainder.excluded)}`] : []),
      `shippedTotalMs=${p.shippedTotalMs === null ? p.shippedTotalState : p.shippedTotalMs}`, `diffSumVsShipped=${p.diffSumVsShipped}`,
      ...(detail.phaseExtras && detail.phaseExtras[key] && detail.phaseExtras[key].skipped > 0 ? [`skippedRuns=${detail.phaseExtras[key].skipped}`] : []),
    ].join(' ')));
  }
  return rows;
}

/**
 * صفوف توقّعات الجولة الثانية لـD (ختم ≥ 70) — ملخّص INFO لكل مرحلة، وثلاثة أحكام لكل مرحلة، ثم الحكم المجمَّع CPU_D_R2. قراءة بحتة من تفصيل التشغيلات (readCpuRunDetail) ومن حساب نسبة المرحلة القائم.
 * المتروك لا يدخل نجاحاً ولا فشلاً ولا صفراً (القاعدة 22): يُعدّ ويُسرد، ولا يُحسب في مجموع D ولا في أيّ حكم من الأحكام الثلاثة (إلا «الأوّل منفَّذ» الذي يُفشله تركُ الأوّل).
 * @param {Object} detail ناتج readCpuRunDetail (runs غير null)
 * @param {Array<{phase: string, totalMs: number, phaseDurationMs: ?number, percent: ?number, verdict: string}>} shareByPhase block.cpuD.phases (فارغة إن لم تُحسب النسبة)
 * @return {{rows: Array, aggregate: {verdict: string, basis: string}}}
 */
function cpuDRound2Rows(detail, shareByPhase) {
  const rows = [];
  const verdicts = [];
  const sortedKeys = Object.keys(detail.phaseExtras).sort((a, b) => (a === CPU_PHASE_NONE ? 1 : (b === CPU_PHASE_NONE ? -1 : Number(a) - Number(b))));
  for (const key of sortedKeys) {
    const ex = detail.phaseExtras[key];
    const rs = detail.runs.filter((r) => r.phaseKey === key && r.elementState === undefined);
    const share = shareByPhase.find((x) => x.phase === key) || null;
    const shipped = detail.byPhase[key].shippedTotalMs;
    rows.push(row(`${ITEM.CPU_D_R2_SUMMARY}_${key}`, V.INFO, [
      `phase=${key}`, `runs=${ex.runs}`, `executedRuns=${ex.executed}`, `skippedRuns=${ex.skipped}`, `notReachedRuns=${ex.notReached}`, `cancelledRuns=${ex.cancelled}`,
      `totalDMs=${shipped === null ? detail.byPhase[key].shippedTotalState : shipped}`,
      `phaseDurationMs=${share && share.phaseDurationMs !== null ? share.phaseDurationMs : 'NOT_MEASURED'}`, `percent=${share && share.percent !== null ? share.percent : 'NOT_MEASURED'}`,
      `sieveLimits=[${ex.sieveLimits.join(',')}]`, `sievePrimeCounts=[${ex.sievePrimeCounts.join(',')}]`,
    ].join(' ')));
    // الأوّل منفَّذ
    const first = rs.length > 0 ? rs[0] : null;
    let firstV;
    let firstWhy;
    if (first === null) { firstV = V.NOT_MEASURED; firstWhy = 'لا تشغيل في المرحلة'; }
    else if (first.skipped) { firstV = V.FAIL; firstWhy = 'FIRST_RUN_SKIPPED(skipped:time_budget)'; }
    else if (first.notReached) { firstV = V.FAIL; firstWhy = 'FIRST_RUN_NOT_REACHED'; }
    else if (first.cancelled) { firstV = V.FAIL; firstWhy = 'FIRST_RUN_CANCELLED'; }
    else if (first.diffMs === null) { firstV = V.FAIL; firstWhy = `FIRST_RUN_WITHOUT_T_TEND(${first.diffState})`; }
    else { firstV = V.PASS; firstWhy = `index=${first.index} t=${first.t} tEnd=${first.tEnd}`; }
    rows.push(row(`${ITEM.CPU_D_R2_FIRST_RUN}_${key}`, firstV, `phase=${key} ${firstWhy}`));
    // sieveLimit
    const withLimit = rs.filter((r) => r.shipsSieveLimit);
    const limitBad = withLimit.filter((r) => r.sieveLimit.state !== FIELD_PRESENT || r.sieveLimit.value !== ROUND2_EXPECTED_SIEVE_LIMIT);
    const limitV = withLimit.length === 0 ? V.NOT_MEASURED : (limitBad.length === 0 ? V.PASS : V.FAIL);
    rows.push(row(`${ITEM.CPU_D_R2_SIEVE_LIMIT}_${key}`, limitV, withLimit.length === 0 ?
      `phase=${key} لا غربال يُشحن معه N (match/mismatch/alloc_failed/native_status_unknown) في المرحلة` :
      `phase=${key} runsWithLimit=${withLimit.length} expected=${ROUND2_EXPECTED_SIEVE_LIMIT}${limitBad.length ? ` bad=[${limitBad.map((r) => `order=${r.orderInPhase === null ? `i${r.index}` : r.orderInPhase}:${r.sieveLimit.state === FIELD_PRESENT ? r.sieveLimit.value : r.sieveLimit.state}`).join(',')}]` : ''}`));
    // sievePrimeCount
    const reported = rs.filter((r) => r.sieve.kind === N.STATE_KIND.MATCH || r.sieve.kind === N.STATE_KIND.MISMATCH);
    const countBad = reported.filter((r) => r.sieve.primeCount !== ROUND2_EXPECTED_SIEVE_PRIME_COUNT);
    const countV = reported.length === 0 ? V.NOT_MEASURED : (countBad.length === 0 ? V.PASS : V.FAIL);
    rows.push(row(`${ITEM.CPU_D_R2_SIEVE_PRIME_COUNT}_${key}`, countV, reported.length === 0 ?
      `phase=${key} لا غربال مُبلَّغ (match/mismatch) في المرحلة` :
      `phase=${key} reportedRuns=${reported.length} expected=${ROUND2_EXPECTED_SIEVE_PRIME_COUNT}${countBad.length ? ` bad=[${countBad.map((r) => `order=${r.orderInPhase === null ? `i${r.index}` : r.orderInPhase}:${r.sieve.kind}:${r.sieve.primeCount === null ? 'ABSENT' : r.sieve.primeCount}`).join(',')}]` : ''}`));
    verdicts.push(firstV, limitV, countV);
  }
  const measured = verdicts.filter((v) => v !== V.NOT_MEASURED);
  let verdict;
  if (verdicts.includes(V.FAIL)) verdict = V.FAIL;
  else if (measured.length === 0) verdict = V.NOT_MEASURED;
  else verdict = V.PASS;
  return {rows, aggregate: {verdict, basis: `phases=[${sortedKeys.join(',')}] ${verdicts.length === 0 ? 'لا مراحل' : `verdicts=${verdicts.join('/')}`}`}};
}

// ═════════════════════════════════════════════════════════════════════════════════════
// قيم حالات ونصوص إضافية (INFO فقط، لا حكم) — إضافة المنسّق 2026-10-11 +03 (منقولة عن تشخيص وكيل التطبيق بالقراءة، غير متحقَّق منها عندي):
// batteryHealth.energyCounterNwh (في الطلب وفي ملفّ Storage) وenergyCounterNwhState (في الطلب) · cpuTempFinalSource · workersPinState · memoryVerifyState · timeToFirstFixState (من L-02 الوظيفية).
// «نصوص حالات وأرقام وحدها، لا معرّف. ونصّ cpuTempFinalSource قد يطول، فاقطعه إلى 200 حرف وقل ذلك.»
// «وكيل التطبيق يقول إن الملفّ يكتبه null صريحاً والطلب يُسقطه. فإن كان رقماً في الملفّ وغائباً من الطلب، فهو عطب» — يُعلَن هنا تسميةً (comparison) لا حكماً.
// الخلية: PRESENT (القيمة) · ABSENT (المفتاح غائب) · NULL (null صريحة — تُميَّز عن الغياب) · WRONG_TYPE(<النوع>) · CONTAINER_ABSENT(<حاوية>) · CONTAINER_NULL · CONTAINER_WRONG_TYPE.
// الطلب = البصمة في reportRaw كما شُحنت (التذييل بـextractParts، كالقارئ)؛ وملفّ Storage = ما نُزِّل إلى الذاكرة (footer فيه) أو سبب تعذّره.
// ═════════════════════════════════════════════════════════════════════════════════════

/** سقف طول النصّ المعروض (حرفاً)، ويُقال في الصفّ إن قُطع. */
const STATE_TEXT_CAP = 200;
/** خلية قيمة في حاوية. type: 'number' | 'string'. */
function valueCell(container, containerName, key, type) {
  if (container === undefined) return {state: `CONTAINER_ABSENT(${containerName})`, value: null};
  if (container === null) return {state: `CONTAINER_NULL(${containerName})`, value: null};
  if (!isObj(container)) return {state: `CONTAINER_WRONG_TYPE(${containerName}:${typeName(container)})`, value: null};
  if (!has(container, key)) return {state: N.KEY_STATUS.ABSENT, value: null};
  const v = container[key];
  if (v === null) return {state: 'NULL', value: null};
  if (type === 'number') return typeof v === 'number' && Number.isFinite(v) ? {state: FIELD_PRESENT, value: v} : {state: wrongType(v), value: null};
  return typeof v === 'string' ? {state: FIELD_PRESENT, value: v} : {state: wrongType(v), value: null};
}
/** نصّ الخلية للصفّ: القيمة (والنصّ الطويل مقطوع ومعلَن)، أو حالة غيابها نصّاً. */
const showValueCell = (c) => {
  if (c.state !== FIELD_PRESENT) return c.state;
  if (typeof c.value === 'string' && c.value.length > STATE_TEXT_CAP) return `${c.value.slice(0, STATE_TEXT_CAP)}[TRUNCATED_TO_${STATE_TEXT_CAP}_CHARS length=${c.value.length}]`;
  return String(c.value);
};
/** الخلية للمخرَج JSON: النصّ الطويل مقطوع ومعلَن. */
const jsonValueCell = (c) => (typeof c.value === 'string' && c.value.length > STATE_TEXT_CAP ? {state: c.state, value: c.value.slice(0, STATE_TEXT_CAP), truncated: true, length: c.value.length} : {state: c.state, value: c.value});
/** فئة الخلية للمقارنة: PRESENT · NULL · ABSENT، وما سواها (نوع خاطئ أو حاوية) بنصّ حالتها. */
const cellClass = (c) => c.state;
/**
 * تسمية مقارنة قيمة الملفّ بقيمة الطلب (لا حكم): SAME_NUMBER · DIFFERENT_NUMBER · <فئة>_BOTH · <فئة الملفّ>_IN_FILE_<فئة الطلب>_IN_REQUEST (الرقم يُكتب NUMBER).
 * @param {{state: string, value: *}} req خلية الطلب
 * @param {{state: string, value: *}} file خلية ملفّ Storage
 * @return {string}
 */
function compareFileToRequest(req, file) {
  const rc = cellClass(req);
  const fc = cellClass(file);
  if (rc === FIELD_PRESENT && fc === FIELD_PRESENT) return req.value === file.value ? 'SAME_NUMBER' : 'DIFFERENT_NUMBER';
  if (rc === fc) return `${rc}_BOTH`;
  const nm = (c) => (c === FIELD_PRESENT ? 'NUMBER' : c);
  return `${nm(fc)}_IN_FILE_${nm(rc)}_IN_REQUEST`;
}

/** خلية في حاوية متداخلة: يُسار في المسار، وأول حاوية غائبة أو ليست كائناً تُعلَن حالتها (باسمها الكامل). */
function valueCellAt(root, path, key, type) {
  let cur = root;
  let name = '';
  for (const seg of path) {
    if (!isObj(cur)) return valueCell(cur, name === '' ? 'root' : name, key, type);
    name = name === '' ? seg : `${name}.${seg}`;
    cur = has(cur, seg) ? cur[seg] : undefined;
  }
  return valueCell(cur, name === '' ? 'root' : name, key, type);
}

/**
 * القيم الإضافية الخمس من البصمة (الطلب) ومن ملفّ Storage. قراءة بحتة.
 * @param {Object} fp0 ‏rawFingerprint من reportRaw (كائن)
 * @param {{state: string, json?: *}} storage حالة نسخة Storage وما نُزِّل
 * @return {Object}
 */
function readStateValues(fp0, storage) {
  const footer = extractParts(fp0).footer;
  const parts = extractParts(fp0);
  const B = N.BATTERY_HEALTH;
  const reqEnergy = valueCellAt(footer, [N.FOOTER.BATTERY_HEALTH], B.ENERGY_COUNTER_NWH, 'number');
  const reqEnergyState = valueCellAt(footer, [N.FOOTER.BATTERY_HEALTH], B.ENERGY_COUNTER_NWH_STATE, 'string');
  // ملفّ Storage: كائن فيه footer (الشكل الحالي)؛ مصفوفة عيّنات (الشكل القديم) لا تذييل فيها؛ وغير ذلك أو التعذّر يُعلَن سببه.
  const st = storage || {state: 'RAW_ABSENT'};
  let fileEnergy = null;
  let fileNote = null;
  if (st.state !== 'DOWNLOADED') fileNote = `STORAGE_FILE_NOT_READ(${st.state})`;
  else if (Array.isArray(st.json)) fileNote = 'STORAGE_FILE_IS_SAMPLES_ARRAY(no footer)';
  else if (!isObj(st.json)) fileNote = `STORAGE_FILE_NOT_OBJECT(${typeName(st.json)})`;
  else fileEnergy = valueCellAt(st.json, [N.TIME_SERIES.FOOTER, N.FOOTER.BATTERY_HEALTH], B.ENERGY_COUNTER_NWH, 'number');
  const l02 = findEntry(parts.functionalResults, N.MEASURED_TEST_IDS.GPS_SATELLITES).entry;
  const ttff = l02 === null ? {state: 'L02_ABSENT', value: null} : valueCellAt(l02, [N.MEASUREMENTS_KEY], N.L02_MEASUREMENT_KEYS.TIME_TO_FIRST_FIX_STATE, 'string');
  const vrCell = (key) => valueCellAt(footer, [N.FOOTER.VERIFICATION_RESULTS], key, 'string');
  const cells = {
    energyCounterNwhRequest: reqEnergy, energyCounterNwhStateRequest: reqEnergyState,
    energyCounterNwhFile: fileEnergy === null ? {state: fileNote, value: null} : fileEnergy,
    cpuTempFinalSource: valueCellAt(footer, [], N.FOOTER.CPU_TEMP_FINAL_SOURCE, 'string'),
    workersPinState: vrCell(N.VERIFICATION.WORKERS_PIN_STATE), memoryVerifyState: vrCell(N.VERIFICATION.MEMORY_VERIFY_STATE), timeToFirstFixState: ttff,
  };
  const comparison = fileEnergy === null ? `FILE_NOT_COMPARED(${fileNote})`: compareFileToRequest(reqEnergy, fileEnergy);
  return {
    energyCounterNwh: {request: jsonValueCell(reqEnergy), requestState: jsonValueCell(reqEnergyState), file: jsonValueCell(cells.energyCounterNwhFile), comparison},
    cpuTempFinalSource: jsonValueCell(cells.cpuTempFinalSource),
    workersPinState: jsonValueCell(cells.workersPinState),
    memoryVerifyState: jsonValueCell(cells.memoryVerifyState),
    timeToFirstFixState: jsonValueCell(cells.timeToFirstFixState),
    _cells: cells,
  };
}

/** صفوف INFO الخمسة (لا حكم). */
function stateValueRows(sv) {
  const c = sv._cells;
  const sh = showValueCell;
  return [
    row(ITEM.ENERGY_COUNTER_NWH, V.INFO, `request.energyCounterNwh=${sh(c.energyCounterNwhRequest)} request.energyCounterNwhState=${sh(c.energyCounterNwhStateRequest)} file.energyCounterNwh=${sh(c.energyCounterNwhFile)} comparison=${sv.energyCounterNwh.comparison}`),
    row(ITEM.CPU_TEMP_FINAL_SOURCE, V.INFO, `cpuTempFinalSource=${sh(c.cpuTempFinalSource)}`),
    row(ITEM.WORKERS_PIN_STATE, V.INFO, `workersPinState=${sh(c.workersPinState)}`),
    row(ITEM.MEMORY_VERIFY_STATE, V.INFO, `memoryVerifyState=${sh(c.memoryVerifyState)}`),
    row(ITEM.TIME_TO_FIRST_FIX_STATE, V.INFO, `L-02 timeToFirstFixState=${sh(c.timeToFirstFixState)}`),
  ];
}

/**
 * خامّ SN-04: عدد عناصر كل قائمة ومتوسّط القيم في كلٍّ (رقمان) وwindowMs وcoverPromptAtMs، بصحّة الشكل. لا قراءة تُخرَج.
 * @param {*} m ‏`measurements` لـSN-04
 * @return {Object}
 */
function readSn04(m) {
  const out = {keysPresent: isObj(m) ? Object.keys(m).sort() : [], problems: []};
  const windowMs = isObj(m) ? m[SN04.WINDOW_MS] : undefined;
  const prompt = isObj(m) ? m[SN04.COVER_PROMPT_AT_MS] : undefined;
  out.windowMs = Number.isInteger(windowMs) ? windowMs : null;
  out.coverPromptAtMs = Number.isInteger(prompt) ? prompt : null;
  if (out.windowMs === null) out.problems.push(`${SN04.WINDOW_MS}:${windowMs === undefined ? 'absent' : 'wrong_type'}`);
  if (out.coverPromptAtMs === null) out.problems.push(`${SN04.COVER_PROMPT_AT_MS}:${prompt === undefined ? 'absent' : 'wrong_type'}`);
  const list = (key, side) => {
    const raw = isObj(m) ? m[key] : undefined;
    if (!Array.isArray(raw)) {
      out.problems.push(`${key}:${raw === undefined ? 'absent' : 'not_an_array'}`);
      return {state: raw === undefined ? 'ABSENT' : 'WRONG_TYPE', count: null, mean: null, valuesCount: 0, componentsMax: null, boundaryViolations: 0};
    }
    let sum = 0;
    let valuesCount = 0;
    let componentsMax = 0;
    let malformed = 0;
    let boundary = 0;
    for (const el of raw) {
      if (!isObj(el) || !Number.isInteger(el.t) || !Array.isArray(el.values) || !el.values.every((x) => Number.isFinite(x))) { malformed++; continue; }
      componentsMax = Math.max(componentsMax, el.values.length);
      for (const x of el.values) { sum += x; valuesCount++; }
      if (out.coverPromptAtMs !== null && (side === 'before' ? el.t >= out.coverPromptAtMs : el.t < out.coverPromptAtMs)) boundary++;
    }
    if (malformed > 0) out.problems.push(`${key}:malformed_elements=${malformed}`);
    if (boundary > 0) out.problems.push(`${key}:boundary_violations=${boundary}`);
    return {state: raw.length === 0 ? 'EMPTY_DECLARED' : 'HAS_READINGS', count: raw.length, mean: valuesCount > 0 ? sum / valuesCount : null, valuesCount, componentsMax: raw.length === 0 ? null : componentsMax, boundaryViolations: boundary};
  };
  out.before = list(SN04.BEFORE, 'before');
  out.during = list(SN04.DURING, 'during');
  return out;
}

const sectionAnomalies = (reader, test) => (reader.anomalies || []).filter((a) => test(String(a.section))).map((a) => `${a.section}:${a.code}`);

/** حكم بند سلوك: شذوذ في قسمه ⟵ FAIL؛ غير مقيس ⟵ NOT_MEASURED؛ وإلا INFO بقيمته. */
function behaviorRow(item, {anomalies, measured, reason, values}) {
  if (anomalies.length > 0) return row(item, V.FAIL, `${kv(values)} anomalies=[${anomalies.join(',')}]`);
  if (!measured) return row(item, V.NOT_MEASURED, `${reason}${values ? ` ${kv(values)}` : ''}`);
  return row(item, V.INFO, kv(values));
}

const findEntry = (list, testId) => {
  const arr = Array.isArray(list) ? list : [];
  const i = arr.findIndex((e) => isObj(e) && e.testId === testId);
  return {index: i, entry: i >= 0 ? arr[i] : null};
};

// ───────────────────────── توقّعات الوسوم (كل دالّة: [حكم، أساس]) ─────────────────────────
// ex = ما جمعه evaluateReport من القارئ: {footerFv, m02: {entry, status, tg}, manual: {entries, hiddenState, hidden}, sn04: {s4}|null, cc}

const KS = N.KEY_STATUS;
const cellOf = (st) => (st === undefined ? 'absent' : st);

function checkM02(ex, want) {
  const m = ex.m02;
  if (!m || m.entry === null) return [V.FAIL, 'M02_ABSENT_FROM_MANUAL_RESULTS (الإجابة مطلوبة عمداً)'];
  const tg = m.tg;
  if (tg === null) return [V.FAIL, `M02_MEASUREMENTS_ABSENT (status=${fmt(m.status)})`];
  const p = [];
  if (tg.endReason !== want.endReason) p.push(`endReason=${fmt(tg.endReason)} expected=${want.endReason}`);
  if (want.status !== undefined && m.status !== want.status) p.push(`status=${fmt(m.status)} expected=${want.status}`);
  if (want.timing) {
    if (tg.elapsedMsStatus !== KS.PRESENT) p.push(`elapsedMs:${cellOf(tg.elapsedMsStatus)}`);
    if (tg.timeToFirstTouchMsStatus !== KS.PRESENT) p.push(`timeToFirstTouchMs:${cellOf(tg.timeToFirstTouchMsStatus)}`);
  }
  if (tg.touchedCellsStatus !== KS.PRESENT || tg.totalCellsStatus !== KS.PRESENT) {
    p.push(`touchedCells:${cellOf(tg.touchedCellsStatus)} totalCells:${cellOf(tg.totalCellsStatus)}`);
  } else if (want.grid === 'FULL' ? tg.touchedCells !== tg.totalCells : !(tg.touchedCells < tg.totalCells)) {
    p.push(`touchedCells=${tg.touchedCells} totalCells=${tg.totalCells} expected ${want.grid === 'FULL' ? 'equal' : 'touchedCells < totalCells'}`);
  }
  return [p.length === 0 ? V.PASS : V.FAIL, `${kv({endReason: tg.endReason, status: m.status, elapsedMs: tg.elapsedMs, timeToFirstTouchMs: tg.timeToFirstTouchMs, touchedCells: tg.touchedCells, totalCells: tg.totalCells})}${p.length ? ` problems=[${p.join(' ; ')}]` : ''}`];
}

function checkUnavailable(ex) {
  const entries = ex.manual ? ex.manual.entries : [];
  const unav = entries.filter((e) => e.status === MANUAL_STATUS.UNAVAILABLE);
  if (unav.length === 0) return [V.FAIL, 'NO_UNAVAILABLE_ENTRY (الإجابة مطلوبة عمداً: غيابها FAIL)'];
  const wrong = unav.filter((e) => !(e.outcome === 'NOT_MEASURED' && e.notMeasuredReason === 'HARDWARE_ABSENT'));
  return [wrong.length === 0 ? V.PASS : V.FAIL, `${unav.map((e) => `${e.testId}:${e.outcome}/${e.notMeasuredReason}`).join(' ')}${wrong.length ? ' expected=NOT_MEASURED/HARDWARE_ABSENT' : ''}`];
}

/** الجولة ٢: صفّ M-15 تحديداً (لا «أيّ unavailable») — حالته unavailable في الحمولة وتصنيفه NOT_MEASURED/HARDWARE_ABSENT. غيابه FAIL (الإجابة مطلوبة عمداً). */
function checkM15Unavailable(ex) {
  const entries = ex.manual ? ex.manual.entries : null;
  if (entries === null) return [V.FAIL, `NO_${M15_TEST_ID.replace('-', '')}_ENTRY (manualResults غائب أو لم يُقرأ؛ الإجابة مطلوبة عمداً: غيابها FAIL)`];
  const m15 = entries.filter((e) => e.testId === M15_TEST_ID);
  if (m15.length === 0) return [V.FAIL, `NO_${M15_TEST_ID.replace('-', '')}_ENTRY (${M15_TEST_ID} غائب من manualResults وفيها ${entries.length} نتيجة؛ الإجابة مطلوبة عمداً: غيابها FAIL)`];
  const bad = m15.filter((e) => !(e.status === MANUAL_STATUS.UNAVAILABLE && e.outcome === 'NOT_MEASURED' && e.notMeasuredReason === 'HARDWARE_ABSENT'));
  return [bad.length === 0 ? V.PASS : V.FAIL, `${m15.map((e) => `${e.testId}:status=${fmt(e.status)} ${e.outcome}/${e.notMeasuredReason}`).join(' ')}${bad.length ? ' expected=status unavailable ⟵ NOT_MEASURED/HARDWARE_ABSENT' : ''}`];
}

function checkHiddenEmpty(ex) {
  const mn = ex.manual;
  if (!mn) return [V.FAIL, 'HIDDEN_BY_MODEL_STATE_UNKNOWN'];
  if (mn.hiddenState !== 'PRESENT') return [V.FAIL, `hiddenByModel state=${mn.hiddenState} (expected PRESENT with [])`];
  return [mn.hidden.length === 0 ? V.PASS : V.FAIL, `hiddenByModel=${JSON.stringify(mn.hidden)}${mn.hidden.length === 0 ? '' : ' expected=[]'}`];
}

function checkSn04Info(ex) {
  const s4 = ex.sn04 ? ex.sn04.s4 : null;
  if (!s4) return [V.NOT_MEASURED, 'SN-04 غائب أو بلا measurements (لا متوسّطان)'];
  return [V.INFO, `${kv({before_mean: round(s4.before.mean), during_mean: round(s4.during.mean), before_count: s4.before.count, during_count: s4.during.count})} (لا عتبة رقمية في القرار فلا حكم)`];
}

/** حالة الدورات المقروءة: {kind, recognized} أو null (لا حالة). */
function cycleStateOf(cc) { return cc && cc.state ? {kind: cc.state.kind, recognized: cc.state.recognized, raw: cc.state.raw} : null; }

function checkCycleNotRead(ex) {
  const cc = ex.cc;
  if (!cc || cc.valueStatus === undefined) return [V.FAIL, 'CYCLE_COUNT_ABSENT (batteryHealth أو الحقل غائب بلا حالة)'];
  const s = cycleStateOf(cc);
  if (s === null) return [V.FAIL, `CYCLE_COUNT_STATE_ABSENT (valueStatus=${cellOf(cc.valueStatus)} stateStatus=${cellOf(cc.stateStatus)}: غياب بلا حالة)`];
  if (!s.recognized) return [V.FAIL, 'CYCLE_COUNT_STATE_UNRECOGNIZED'];
  if (s.kind === N.STATE_KIND.READ) return [V.FAIL, `CYCLE_COUNT_READ value=${fmt(cc.value)} state=${s.raw} (توقّع: غير مقروء بحالة معلنة)`];
  if (s.kind !== N.STATE_KIND.NOT_READ) return [V.FAIL, `CYCLE_COUNT_STATE_UNEXPECTED kind=${s.kind}`];
  if (cc.valueStatus === KS.PRESENT) return [V.FAIL, `CYCLE_COUNT_VALUE_WITH_NOT_READ_STATE value=${fmt(cc.value)}`];
  return [V.PASS, `state=${s.raw} source=${cc.source ? cc.source.raw : 'absent'} value=absent_declared`];
}

function checkCycleExtraApi34(ex) {
  const cc = ex.cc;
  if (!cc || cc.valueStatus === undefined) return [V.FAIL, 'CYCLE_COUNT_ABSENT (batteryHealth أو الحقل غائب)'];
  const s = cycleStateOf(cc);
  const p = [];
  if (s === null) p.push('CYCLE_COUNT_STATE_ABSENT');
  else if (s.kind === N.STATE_KIND.NOT_READ) p.push('CYCLE_COUNT_NOT_READ');
  else if (s.kind !== N.STATE_KIND.READ) p.push(`CYCLE_COUNT_STATE_UNEXPECTED(kind=${s.kind})`);
  if (!cc.source || cc.source.kind !== N.STATE_KIND.EXTRA_API34) p.push(`CYCLE_COUNT_SOURCE_NOT_EXTRA_API34(source=${cc.source ? cc.source.raw : 'absent'})`);
  if (cc.valueStatus !== KS.PRESENT) p.push('CYCLE_COUNT_VALUE_ABSENT');
  else if (cc.value === 0 && s !== null && s.kind === N.STATE_KIND.READ) p.push('CYCLE_COUNT_ZERO_WITH_READ_STATE');
  else if (cc.value < 0) p.push('CYCLE_COUNT_NEGATIVE');
  const vals = kv({value: cc.value, state: s ? s.raw : null, source: cc.source ? cc.source.raw : null});
  return [p.length === 0 ? V.PASS : V.FAIL, p.length === 0 ? vals : `${vals} problems=[${p.join(',')}]`];
}

function checkLegacyScan(ex, exp) {
  if (ex.footerFv === null) return [V.NOT_MEASURED, 'fieldsVersion غائب'];
  if (ex.footerFv === exp.fieldsVersion) return [V.PASS, `fieldsVersion=${ex.footerFv}: بنود LEGACY_BY_NATURE NOT_MEASURED:${LEGACY_FV67_SCAN}`];
  return [V.FAIL, `fieldsVersion=${ex.footerFv} expected=${exp.fieldsVersion} (الوسم لا يطابق الفحص${ex.footerFv >= N.FIELDS_VERSION_68 ? ': ختم ≥ 68' : ''})`];
}

const EXPECT_CHECKS = Object.freeze({
  [EXPECT.B1_LEGACY_FV67_SCAN]: (ex, exp) => checkLegacyScan(ex, exp),
  [EXPECT.M02_AUTO_COMPLETE_FULL_GRID]: (ex) => checkM02(ex, {endReason: N.TOUCH_GRID_END_REASON.AUTO_COMPLETE, timing: true, grid: 'FULL'}),
  [EXPECT.MANUAL_UNAVAILABLE_HARDWARE_ABSENT]: (ex) => checkUnavailable(ex),
  [EXPECT.HIDDEN_BY_MODEL_EMPTY]: (ex) => checkHiddenEmpty(ex),
  [EXPECT.SN04_COVER_NO_THRESHOLD]: (ex) => checkSn04Info(ex),
  [EXPECT.CYCLE_NOT_READ_DECLARED]: (ex) => checkCycleNotRead(ex),
  [EXPECT.M02_NOT_WORKING_PARTIAL_GRID]: (ex) => checkM02(ex, {endReason: N.TOUCH_GRID_END_REASON.USER_MARKED_NOT_WORKING, status: MANUAL_STATUS.FAIL, grid: 'PARTIAL'}),
  [EXPECT.CYCLE_EXTRA_API34_POSITIVE]: (ex) => checkCycleExtraApi34(ex),
  [EXPECT_R2.M15_UNAVAILABLE_HARDWARE_ABSENT]: (ex) => checkM15Unavailable(ex),
});

/** كتلة التوقّعات في مخرَج التقرير: وسم بلا توقّعات خاصّة يُعلَن، وغيره يُسرد بأسطره ومصادرها. */
function expectationBlock(tag, round) {
  const exp = tagExpectation(tag, round);
  if (exp === null) return {special: false, note: `وسم بلا توقّعات خاصّة: القواعد العامّة وحدها (الوسوم ذات التوقّعات${roundOf(round) === 2 ? ' في الجولة 2' : ''}: ${Object.keys(tableOfRound(round)).join(' · ')})`};
  return {
    special: true, ...(roundOf(round) === 2 ? {round: 2} : {}), scan: exp.scan, appVersion: exp.appVersion, fieldsVersion: exp.fieldsVersion, sessionStrict: exp.sessionStrict, document: CHECK_DOC, transcription: DOC_TRANSCRIPTION_NOTE,
    lines: exp.lines.map((l) => ({item: l.item, source: l.source, quote: l.quote, rule: l.rule})),
  };
}

/** كتلة التوقّعات على مستوى المخرَج: الجدول كلّه والبنود القديمة بطبيعتها، ومن بين وسوم هذا التشغيل أيّها بلا توقّعات خاصّة. */
function expectationsOutput(tags, round) {
  const rnd = roundOf(round);
  const table = tableOfRound(rnd);
  return {
    document: CHECK_DOC, transcription: DOC_TRANSCRIPTION_NOTE,
    ...(rnd === 2 ? {round: 2, notJudgedFromServer: NOT_JUDGED_FROM_SERVER_R2.map((x) => ({...x}))} : {}),
    tagsWithExpectations: Object.keys(table),
    thisRun: tags.map((t) => ({tag: t, special: tagExpectation(t, rnd) !== null, ...(tagExpectation(t, rnd) === null ? {note: 'بلا توقّعات خاصّة: القواعد العامّة وحدها'} : {})})),
    table: Object.fromEntries(Object.entries(table).map(([tag, e]) => [tag, {
      scan: e.scan, appVersion: e.appVersion, fieldsVersion: e.fieldsVersion, sessionStrict: e.sessionStrict,
      lines: e.lines.map((l) => ({item: l.item, source: l.source, quote: l.quote, rule: l.rule})),
    }])),
    legacyByNature: {reason: LEGACY_FV67_SCAN, appliesTo: 'B1 حين fieldsVersion = 67', items: Object.entries(LEGACY_BY_NATURE).map(([item, s]) => ({item, sinceFieldsVersion: s.since, source: s.source}))},
  };
}

/**
 * يحكم على تقرير واحد من حقائقه. دالّة نقيّة (لا I/O): تُختبر على حقائق اصطناعية وعلى العيّنات الذهبية.
 * @param {Object} facts ناتج gatherReportFacts
 * @param {{accountHash: string}} ctx
 * @return {{block: Object, rows: Array<{item: string, verdict: string, basis: string}>}}
 */
function evaluateReport(facts, ctx) {
  const rows = [];
  const R = (item, verdict, basis) => { rows.push(row(item, verdict, basis)); };
  const roundNo = roundOf(ctx ? ctx.round : undefined); // الجزء السادس: 1 (الغائب) أو 2؛ غيرهما خطأ صريح
  const block = {tag: facts.tag, shortIdHash: facts.shortIdHash, found: facts.found === 1, expectations: expectationBlock(facts.tag, roundNo)};
  const exp = tagExpectation(facts.tag, roundNo); // null = وسم بلا توقّعات خاصّة: القواعد العامّة وحدها
  const ex = {footerFv: null, m02: null, manual: null, sn04: null, cc: null}; // ما يجمعه التقييم للتوقّعات
  const notMeasuredAll = (reason) => {
    for (const item of Object.values(ITEM)) if (!NOT_MEASURED_ALL_SKIP.has(item)) R(item, V.NOT_MEASURED, `REPORT_ABSENT: ${reason}`);
    for (const item of expectItemsOf(facts.tag, roundNo)) R(item, V.NOT_MEASURED, `REPORT_ABSENT: ${reason}`);
  };

  // أ — التقرير
  if (facts.found === 0) {
    R(ITEM.REPORT_FOUND, V.FAIL, facts.vanished ? 'reports بالرمز وُجد بالاستعلام وغاب عند القراءة' : 'لا مستند reports بهذا الرمز');
    block.reportsFoundByShortId = 0;
    notMeasuredAll('no reports document');
    return {block, rows};
  }
  if (facts.found > 1) {
    R(ITEM.REPORT_FOUND, V.NOT_MEASURED, `SHORT_ID_AMBIGUOUS: ${facts.found} مستنداً بالرمز نفسه`);
    block.reportsFoundByShortId = facts.found;
    notMeasuredAll('short id ambiguous');
    return {block, rows};
  }
  R(ITEM.REPORT_FOUND, V.PASS, 'مستند واحد');
  block.scanIdHash = facts.scanIdHash;
  block.accountHash = facts.userHash;
  if (facts.ownerMatches === null) R(ITEM.REPORT_OWNER, V.NOT_MEASURED, 'userId غائب أو ليس نصّاً');
  else R(ITEM.REPORT_OWNER, facts.ownerMatches ? V.PASS : V.FAIL, facts.ownerMatches ? 'userId = حساب المالك' : 'userId حساب آخر');

  // ب — الخامّ
  const rawState = facts.rawRead ? facts.rawRead.state : null;
  const raw = facts.rawRead && facts.rawRead.raw ? facts.rawRead.raw : null;
  block.raw = {state: rawState, fieldsPresent: raw ? Object.keys(raw).sort() : []};
  R(ITEM.RAW_STATE, rawState === RAW_STATE.PRIVATE ? V.PASS : V.FAIL, `state=${rawState}`);
  const fp0 = raw && isObj(raw.rawFingerprint) ? raw.rawFingerprint : null;

  // Storage
  const st = facts.storage || {state: 'RAW_ABSENT'};
  let samples = null;
  let storageJson = null;
  block.storage = {state: st.state, ...(st.errorCode !== undefined ? {errorCode: st.errorCode, errorClass: st.errorClass} : {})};
  if (st.state === 'DOWNLOADED') {
    storageJson = st.json;
    samples = Array.isArray(st.json) ? st.json : (isObj(st.json) && Array.isArray(st.json.samples) ? st.json.samples : null);
    block.storage.topLevel = Array.isArray(st.json) ? 'array' : (isObj(st.json) ? 'object' : typeof st.json);
    block.storage.samplesFound = samples !== null;
    R(ITEM.STORAGE_COPY, samples !== null ? V.INFO : V.FAIL, samples !== null ? `state=DOWNLOADED samples=${samples.length}` : `state=DOWNLOADED لكن لا مصفوفة samples (top=${block.storage.topLevel})`);
  } else if (['DOWNLOADED_NOT_GZIP', 'GUNZIP_ERROR', 'DOWNLOAD_ERROR'].includes(st.state)) {
    R(ITEM.STORAGE_COPY, V.FAIL, `state=${st.state}${st.errorCode !== undefined ? ` code=${st.errorCode} class=${st.errorClass}` : ''}`);
  } else if (st.state === 'FILE_NOT_FOUND') {
    R(ITEM.STORAGE_COPY, V.FAIL, 'state=FILE_NOT_FOUND (المسار في reportRaw ولا كائن)');
  } else {
    R(ITEM.STORAGE_COPY, V.NOT_MEASURED, `state=${st.state}`);
  }

  // القارئ
  let reader = null;
  let fp = null;
  if (fp0 !== null) {
    fp = samples !== null ? rehydrateFingerprintSamples(fp0, samples) : fp0;
    reader = readFv68(fp);
    if (reader.readerError) {
      block.readerError = true;
      reader = null;
    }
  }
  const noReader = (item, reason) => R(item, V.NOT_MEASURED, reason);
  const noReaderReason = fp0 === null ? 'RAW_FINGERPRINT_ABSENT' : 'READER_ERROR';

  // ج — الإصدارات
  const appVersion = reader ? reader.appVersion : null; // الختم والإصدار من القارئ (readFv68) لا من قراءة ثانية
  const footerFv = reader ? reader.fieldsVersion : null;
  block.versions = {appVersion, fieldsVersion: footerFv};
  ex.footerFv = footerFv;
  if (reader === null) {
    R(ITEM.APP_VERSION, V.NOT_MEASURED, noReaderReason);
    R(ITEM.FIELDS_VERSION, V.NOT_MEASURED, noReaderReason);
  } else {
    // الوسم ذو التوقّعات: الإصدار والختم المتوقَّعان من جدوله (B1: 1.0.10 وختم 67 بالضبط؛ والجدد: 1.0.11 وختم 69 بالضبط لا ≥). غيره: القاعدة العامّة (1.0.11 وختم ≥ 69).
    const expectedApp = exp ? exp.appVersion : EXPECTED_APP_VERSION;
    if (appVersion === null) R(ITEM.APP_VERSION, V.NOT_MEASURED, 'header.appVersion غائب');
    // fv70 (الجولة الثانية): وسم بلا توقّعات خاصّة وختمه ≥ 70 ⟵ INFO بلا حكم: إصدار التطبيق المتوقَّع للجولة الثانية **لم يُعطَ** (EXPECTED_APP_VERSION = 1.0.11 من أمر الجولة الأولى لا يصدق عليها، وعيّنات fv70 الذهبية تحمل 1.0.11 في ترويستها). لا تُخترَع قيمة.
    else if (!exp && footerFv !== null && footerFv >= N.FIELDS_VERSION_70) R(ITEM.APP_VERSION, V.INFO, `appVersion=${appVersion} (fieldsVersion=${footerFv} ≥ ${N.FIELDS_VERSION_70}: إصدار التطبيق المتوقَّع للجولة الثانية غير معطى — لا حكم)`);
    else R(ITEM.APP_VERSION, appVersion === expectedApp ? V.PASS : V.FAIL, `appVersion=${appVersion} expected=${expectedApp}`);
    if (footerFv === null) R(ITEM.FIELDS_VERSION, V.NOT_MEASURED, 'footer.fieldsVersion غائب');
    else if (exp) R(ITEM.FIELDS_VERSION, footerFv === exp.fieldsVersion ? V.PASS : V.FAIL, `fieldsVersion=${footerFv} expected=${exp.fieldsVersion} (exact)`);
    else R(ITEM.FIELDS_VERSION, footerFv >= N.FIELDS_VERSION_69 ? V.PASS : V.FAIL, `fieldsVersion=${footerFv} threshold=${N.FIELDS_VERSION_69}`);
  }
  const sinceFv69 = footerFv !== null && footerFv >= N.FIELDS_VERSION_69;
  if (reader === null) {
    noReader(ITEM.READER_ANOMALIES, noReaderReason);
  } else {
    const codes = [...new Set((reader.anomalies || []).map((a) => `${a.section}:${a.code}`))];
    block.readerAnomalies = codes;
    R(ITEM.READER_ANOMALIES, codes.length === 0 ? V.PASS : V.FAIL, codes.length === 0 ? 'anomalies=[]' : `anomalies=[${codes.join(',')}]`);
  }

  // د — M-02
  {
    const manual = fp0 && Array.isArray(fp0.manualResults) ? fp0.manualResults : null;
    const {index, entry} = findEntry(manual, N.MEASURED_TEST_IDS.TOUCH_GRID);
    const status = entry ? (typeof entry.status === 'string' ? entry.status : null) : null;
    const item = reader ? reader.measurements.items.find((i) => i.source === 'manualResults' && i.testId === N.MEASURED_TEST_IDS.TOUCH_GRID) : null;
    const tg = item && item.touchGrid ? item.touchGrid : null;
    ex.m02 = {entry, index, status, tg};
    block.m02 = {
      present: entry !== null, manualStatus: status,
      ...(tg ? {
        endReason: tg.endReason, endReasonStatus: tg.endReasonStatus, elapsedMs: tg.elapsedMs, elapsedMsStatus: tg.elapsedMsStatus, elapsedMsBasis: tg.elapsedMsBasis,
        timeToFirstTouchMs: tg.timeToFirstTouchMs, timeToFirstTouchMsStatus: tg.timeToFirstTouchMsStatus, touchedCells: tg.touchedCells, touchedCellsStatus: tg.touchedCellsStatus,
        totalCells: tg.totalCells, totalCellsStatus: tg.totalCellsStatus, touchState: tg.touchState, maxSimultaneousPointers: tg.maxSimultaneousPointers,
      } : {}),
    };
    if (reader === null) {
      noReader(ITEM.M02_RAW, noReaderReason); noReader(ITEM.M02_MANUAL_STATUS, noReaderReason); noReader(ITEM.M02_END_REASON_VS_STATUS, noReaderReason);
    } else if (entry === null) {
      const why = manual === null ? 'manualResults غائب' : 'M-02 غائب من manualResults';
      R(ITEM.M02_RAW, V.NOT_MEASURED, why); R(ITEM.M02_MANUAL_STATUS, V.NOT_MEASURED, why); R(ITEM.M02_END_REASON_VS_STATUS, V.NOT_MEASURED, why);
    } else if (tg === null) {
      R(ITEM.M02_RAW, V.NOT_MEASURED, `M-02 بلا measurements (status=${status})`);
      R(ITEM.M02_MANUAL_STATUS, V.INFO, `status=${status} (لا خامّ)`);
      R(ITEM.M02_END_REASON_VS_STATUS, V.NOT_MEASURED, 'لا measurements فلا endReason');
    } else {
      const an = sectionAnomalies(reader, (s) => s.startsWith(`manualResults[${index}].${N.MEASUREMENTS_KEY}`));
      const S = N.KEY_STATUS;
      const timingOk = (st2) => st2 === S.PRESENT || st2 === S.ABSENT_DECLARED;
      const problems = [];
      if (tg.touchedCellsStatus !== S.PRESENT) problems.push(`touchedCells:${tg.touchedCellsStatus}`);
      if (tg.totalCellsStatus !== S.PRESENT) problems.push(`totalCells:${tg.totalCellsStatus}`);
      if (tg.endReasonStatus !== S.PRESENT || !(tg.endReasonState && tg.endReasonState.recognized)) problems.push(`endReason:${tg.endReasonStatus === S.PRESENT ? 'UNRECOGNIZED' : tg.endReasonStatus}`);
      if (!timingOk(tg.elapsedMsStatus)) problems.push(`elapsedMs:${tg.elapsedMsStatus}`);
      if (!timingOk(tg.timeToFirstTouchMsStatus)) problems.push(`timeToFirstTouchMs:${tg.timeToFirstTouchMsStatus}`);
      const all = [...problems, ...an];
      const values = {endReason: tg.endReason, elapsedMs: tg.elapsedMs, timeToFirstTouchMs: tg.timeToFirstTouchMs, touchedCells: tg.touchedCells, totalCells: tg.totalCells, status};
      R(ITEM.M02_RAW, all.length === 0 ? V.PASS : V.FAIL, `${kv(values)} touchState=${tg.touchState}${all.length ? ` problems=[${all.join(',')}]` : ''}`);
      R(ITEM.M02_MANUAL_STATUS, V.INFO, `${kv(values)} timeToFirstTouchMsStatus=${tg.timeToFirstTouchMsStatus} elapsedMsStatus=${tg.elapsedMsStatus}`);
      if (!(tg.endReasonState && tg.endReasonState.recognized)) {
        R(ITEM.M02_END_REASON_VS_STATUS, V.NOT_MEASURED, `endReason غير معروف أو غائب (${tg.endReasonStatus})`);
      } else if (tg.endReason === N.TOUCH_GRID_END_REASON.DISMISSED) {
        R(ITEM.M02_END_REASON_VS_STATUS, V.INFO, `endReason=dismissed (لا حالة جديدة بالعقد) status=${status}`);
      } else {
        const expected = END_REASON_STATUS[tg.endReason];
        R(ITEM.M02_END_REASON_VS_STATUS, expected === status ? V.PASS : V.FAIL, `endReason=${tg.endReason} expectedStatus=${expected} status=${status}`);
      }
    }
  }

  // هـ — SN-04 (قراءة تشخيصية هنا: لا قارئ في الخادم)
  {
    const fr = fp0 && Array.isArray(fp0.functionalResults) ? fp0.functionalResults : null;
    const {entry} = findEntry(fr, SN04.TEST_ID);
    if (fp0 === null) {
      R(ITEM.SN04_RAW, V.NOT_MEASURED, noReaderReason); R(ITEM.SN04_COVER_WINDOWS, V.NOT_MEASURED, noReaderReason);
    } else if (entry === null) {
      block.sn04 = {present: false};
      R(ITEM.SN04_RAW, V.NOT_MEASURED, fr === null ? 'functionalResults غائب' : 'SN-04 غائب من functionalResults'); R(ITEM.SN04_COVER_WINDOWS, V.NOT_MEASURED, 'SN-04 غائب');
    } else if (!isObj(entry.measurements)) {
      block.sn04 = {present: true, measurements: has(entry, N.MEASUREMENTS_KEY) ? 'WRONG_TYPE' : 'ABSENT', functionalStatus: entry.status === undefined ? null : entry.status};
      R(ITEM.SN04_RAW, sinceFv69 ? V.FAIL : V.NOT_MEASURED, sinceFv69 ? 'measurements غائب من SN-04 في ختم ≥ 69 (عقد: حاضر دائماً)' : 'الختم أقدم من 69 أو غير مقروء: الخامّ لم يوجد بعد');
      R(ITEM.SN04_COVER_WINDOWS, V.NOT_MEASURED, 'لا measurements');
    } else {
      const s4 = readSn04(entry.measurements);
      ex.sn04 = {s4};
      block.sn04 = {
        present: true, functionalStatus: entry.status === undefined ? null : entry.status, windowMs: s4.windowMs, coverPromptAtMs: s4.coverPromptAtMs,
        before: {state: s4.before.state, count: s4.before.count, mean: round(s4.before.mean), componentsMax: s4.before.componentsMax},
        during: {state: s4.during.state, count: s4.during.count, mean: round(s4.during.mean), componentsMax: s4.during.componentsMax},
        keysPresent: s4.keysPresent, problems: s4.problems,
      };
      R(ITEM.SN04_RAW, s4.problems.length === 0 ? V.PASS : V.FAIL, s4.problems.length === 0 ? 'keys=4 lists ok boundary ok' : `problems=[${s4.problems.join(',')}]`);
      R(ITEM.SN04_COVER_WINDOWS, V.INFO, kv({before_count: s4.before.count, during_count: s4.during.count, before_mean: round(s4.before.mean), during_mean: round(s4.during.mean), windowMs: s4.windowMs, coverPromptAtMs: s4.coverPromptAtMs, before_state: s4.before.state, during_state: s4.during.state}));
    }
  }

  // و — اليدوي
  {
    const manual = fp0 && Array.isArray(fp0.manualResults) ? fp0.manualResults : null;
    if (fp0 === null) {
      R(ITEM.MANUAL_STATUS_VOCAB, V.NOT_MEASURED, noReaderReason); R(ITEM.MANUAL_UNAVAILABLE_CLASS, V.NOT_MEASURED, noReaderReason); R(ITEM.MANUAL_HIDDEN_BY_MODEL, V.NOT_MEASURED, noReaderReason);
    } else {
      const entries = (manual || []).filter(isObj).map((e) => {
        const tr = toTestResult(e, null, null, {isManual: true});
        return {testId: typeof e.testId === 'string' ? e.testId : null, status: e.status === undefined ? null : e.status, outcome: tr.outcome, notMeasuredReason: tr.notMeasuredReason};
      });
      block.manual = {entries};
      if (entries.length === 0) {
        R(ITEM.MANUAL_STATUS_VOCAB, V.NOT_MEASURED, manual === null ? 'manualResults غائب' : 'manualResults فارغ');
      } else {
        const unknown = entries.filter((e) => !KNOWN_MANUAL_STATUSES.includes(e.status));
        const st = (e) => (e.status === null ? 'absent' : e.status); // الغائب يُكتب absent لا null (القاعدة 22)
        R(ITEM.MANUAL_STATUS_VOCAB, unknown.length === 0 ? V.PASS : V.FAIL, `statuses=${JSON.stringify(entries.map((e) => `${e.testId}:${st(e)}`))}${unknown.length ? ` unknown=${JSON.stringify(unknown.map((e) => `${e.testId}:${st(e)}`))}` : ''}`);
      }
      const unav = entries.filter((e) => e.status === MANUAL_STATUS.UNAVAILABLE);
      if (unav.length === 0) {
        R(ITEM.MANUAL_UNAVAILABLE_CLASS, V.NOT_MEASURED, 'لا `unavailable` في هذا التقرير');
      } else {
        const wrong = unav.filter((e) => !(e.outcome === 'NOT_MEASURED' && e.notMeasuredReason === 'HARDWARE_ABSENT'));
        R(ITEM.MANUAL_UNAVAILABLE_CLASS, wrong.length === 0 ? V.PASS : V.FAIL, unav.map((e) => `${e.testId}:${e.outcome}/${e.notMeasuredReason}`).join(' ') + (wrong.length ? ` expected=NOT_MEASURED/HARDWARE_ABSENT` : ''));
      }
      // hiddenByModel
      const header = isObj(fp0) && has(fp0, MANUAL_HEADER.KEY) ? fp0[MANUAL_HEADER.KEY] : undefined;
      const hidden = isObj(header) ? header[MANUAL_HEADER.HIDDEN] : undefined;
      let hiddenState;
      if (header === undefined) hiddenState = 'HEADER_ABSENT';
      else if (!isObj(header)) hiddenState = 'HEADER_WRONG_TYPE';
      else if (hidden === undefined) hiddenState = 'HIDDEN_BY_MODEL_ABSENT';
      else if (!Array.isArray(hidden) || !hidden.every((x) => typeof x === 'string')) hiddenState = 'HIDDEN_BY_MODEL_WRONG_TYPE';
      else hiddenState = 'PRESENT';
      block.manual.hiddenByModel = {state: hiddenState, ...(hiddenState === 'PRESENT' ? {list: [...hidden]} : {})};
      ex.manual = {entries, hiddenState, hidden: hiddenState === 'PRESENT' ? [...hidden] : null};
      if (!sinceFv69) R(ITEM.MANUAL_HIDDEN_BY_MODEL, V.NOT_MEASURED, `الختم ${fmt(footerFv)} أقدم من 69: الرأس لم يوجد بعد (غيابه لا معرفة)`);
      else if (hiddenState === 'PRESENT') R(ITEM.MANUAL_HIDDEN_BY_MODEL, V.PASS, `hiddenByModel=${JSON.stringify(hidden)}`);
      else R(ITEM.MANUAL_HIDDEN_BY_MODEL, V.FAIL, `state=${hiddenState} (عقد: حاضرة دائماً في fv69)`);
    }
  }

  // ز — العيّنات وما يُشتقّ منها (D، ذيل gpu_fps، زمن العيّنة، حجم الحمولة)
  const sampleInfo = reader && samples !== null ? analyzeSamples(samples, reader.layout) : null;
  block.sampling = sampleInfo === null ? {state: st.state === 'STORAGE_NOT_READ_BY_OPTION' ? 'STORAGE_NOT_READ_BY_OPTION' : 'SAMPLES_UNAVAILABLE'} : {
    state: sampleInfo.state, sampleCount: sampleInfo.sampleCount, spanMs: sampleInfo.spanMs === undefined ? null : sampleInfo.spanMs,
    medianIntervalMs: sampleInfo.medianIntervalMs === undefined ? null : sampleInfo.medianIntervalMs, maxIntervalMs: sampleInfo.maxIntervalMs === undefined ? null : sampleInfo.maxIntervalMs,
    monotonic: sampleInfo.monotonic === undefined ? null : sampleInfo.monotonic,
  };
  const samplesWhy = () => (st.state === 'STORAGE_NOT_READ_BY_OPTION' ? 'STORAGE_NOT_READ_BY_OPTION' : `SAMPLES_UNAVAILABLE(storage=${st.state})`);

  // D للمعالج
  if (reader === null) {
    noReader(ITEM.CPU_D_SHARE, noReaderReason);
    block.cpuD = {state: noReaderReason};
  } else {
    const k = reader.verification.cpuKnownAnswer;
    const stateCellPresent = k.state && k.state.status === N.KEY_STATUS.PRESENT;
    const kind = stateKind(k.state);
    const an = sectionAnomalies(reader, (s) => s.startsWith(`${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.CPU_KNOWN_ANSWER_STATE}`) || s.startsWith(`${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.CPU_KNOWN_ANSWER_RUNS}`) || s.startsWith(`${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.CPU_KNOWN_ANSWER_TOTAL_MS_BY_PHASE}`));
    block.cpuD = {criterion: {text: D_SHARE_CRITERION_TEXT, maxPercent: D_SHARE_MAX_PERCENT}, state: stateCellPresent ? stateRaw(k.state) : k.state.status, runs: k.counts ? k.counts.runs : null, phases: []};
    if (!stateCellPresent) {
      R(ITEM.CPU_D_SHARE, V.NOT_MEASURED, `cpuKnownAnswerState ${k.state.status}`);
    } else if (kind !== N.STATE_KIND.RAN && kind !== N.STATE_KIND.PARTIAL_TIME_BUDGET) {
      R(ITEM.CPU_D_SHARE, V.NOT_MEASURED, `cpuKnownAnswerState=${stateRaw(k.state)} (لم يجرِ فحص D)`);
    } else if (k.totalMsByPhase.status !== N.KEY_STATUS.PRESENT) {
      R(ITEM.CPU_D_SHARE, V.NOT_MEASURED, `cpuKnownAnswerTotalMsByPhase ${k.totalMsByPhase.status}`);
    } else if (Object.keys(k.totalMsByPhase.byPhase).length === 0) {
      R(ITEM.CPU_D_SHARE, V.NOT_MEASURED, 'cpuKnownAnswerTotalMsByPhase فارغة: لم يبدأ تشغيل في أيّ مرحلة');
    } else if (sampleInfo === null || sampleInfo.state !== 'READ' || sampleInfo.phases === undefined) {
      R(ITEM.CPU_D_SHARE, V.NOT_MEASURED, `زمن المرحلة يُشتقّ من العيّنات: ${sampleInfo === null ? samplesWhy() : sampleInfo.state}`);
    } else {
      const phaseRows = [];
      for (const [phaseKey, totalMs] of Object.entries(k.totalMsByPhase.byPhase).sort((a, b) => Number(a[0]) - Number(b[0]))) {
        const p = Number(phaseKey);
        const item = `${ITEM.CPU_D_SHARE_PHASE}_${phaseKey}`;
        const info = Number.isInteger(p) ? sampleInfo.phases[p] : undefined;
        if (!info || !(info.durationMs > 0)) {
          phaseRows.push(row(item, V.NOT_MEASURED, `phase=${phaseKey} totalMs=${totalMs} زمن المرحلة غير مشتقّ (${info ? 'امتداد غير موجب' : 'لا عيّنات موسومة بها'})`));
          block.cpuD.phases.push({phase: phaseKey, totalMs, phaseDurationMs: info ? info.durationMs : null, percent: null, verdict: V.NOT_MEASURED});
          continue;
        }
        const pass = totalMs * 100 <= info.durationMs * D_SHARE_MAX_PERCENT;
        const percent = round((totalMs * 100) / info.durationMs);
        phaseRows.push(row(item, pass ? V.PASS : V.FAIL, `phase=${phaseKey} totalMs=${totalMs} phaseDurationMs=${info.durationMs} percent=${percent} max=${D_SHARE_MAX_PERCENT} samples=${info.samples}`));
        block.cpuD.phases.push({phase: phaseKey, totalMs, phaseDurationMs: info.durationMs, percent, verdict: pass ? V.PASS : V.FAIL});
      }
      const verdicts = phaseRows.map((r) => r.verdict);
      const aggregate = an.length > 0 ? V.FAIL : (verdicts.includes(V.FAIL) ? V.FAIL : (verdicts.every((x) => x === V.PASS) ? V.PASS : V.NOT_MEASURED));
      // fv70: في partial:time_budget تُحسب النسبة على التشغيلات المنفَّذة وحدها (مجموع D المشحون لا يدخله المتروك)، ويُقال ذلك في الأساس — المتروك لا نجاح ولا فشل ولا صفر.
      const partialNote = kind === N.STATE_KIND.PARTIAL_TIME_BUDGET ? ` state=${N.STATE_KIND.PARTIAL_TIME_BUDGET} skippedHalves=${k.counts.sieveSkipped + k.counts.shaSkipped}(لا يدخل المجموع)` : '';
      R(ITEM.CPU_D_SHARE, aggregate, `${phaseRows.map((r) => `${r.item.slice(ITEM.CPU_D_SHARE_PHASE.length + 1)}:${r.verdict}`).join(' ')}${an.length ? ` anomalies=[${an.join(',')}]` : ''}${partialNote}`);
      rows.push(...phaseRows);
    }
  }

  // D: تفصيل كل تشغيل (INFO فقط، لا حكم، ولا يغيّر حكم ما قبله) — من cpuKnownAnswerRuns[] في البصمة كما شُحنت.
  if (reader === null) {
    noReader(ITEM.CPU_D_RUNS, noReaderReason);
    noReader(ITEM.CPU_D_R2, noReaderReason);
    block.cpuD.runDetail = {state: noReaderReason};
  } else {
    const detail = readCpuRunDetail(extractParts(fp).footer[N.FOOTER.VERIFICATION_RESULTS], reader.verification.cpuKnownAnswer, {fieldsVersion: footerFv});
    block.cpuD.runDetail = detail;
    // توقّعات الجولة الثانية (fv70): الحكم المجمَّع يُصدَر دائماً (NOT_MEASURED بسببه قبل 70)، وصفوفه حين الختم ≥ 70 وللتشغيلات قراءة.
    const round2Applicable = footerFv !== null && footerFv >= N.FIELDS_VERSION_70;
    if (!round2Applicable) {
      R(ITEM.CPU_D_R2, V.NOT_MEASURED, footerFv === null ? 'footer.fieldsVersion غائب' : `BEFORE_FV70: fieldsVersion=${footerFv} < ${N.FIELDS_VERSION_70} (لا sieveLimit ولا skipped:time_budget قبلها)`);
    } else if (detail.runs === null) {
      R(ITEM.CPU_D_R2, V.NOT_MEASURED, `cpuKnownAnswerRuns ${detail.runsStatus}`);
    } else {
      const r2 = cpuDRound2Rows(detail, block.cpuD.phases);
      block.cpuD.round2 = r2.rows.map((x) => ({item: x.item, verdict: x.verdict}));
      R(ITEM.CPU_D_R2, r2.aggregate.verdict, r2.aggregate.basis);
      rows.push(...r2.rows);
    }
    if (detail.runs === null) {
      R(ITEM.CPU_D_RUNS, V.NOT_MEASURED, `cpuKnownAnswerRuns ${detail.runsStatus}`);
    } else {
      const kRun = reader.verification.cpuKnownAnswer;
      const phases = Object.keys(detail.byPhase);
      R(ITEM.CPU_D_RUNS, V.INFO, kv({cpuKnownAnswerState: kRun.state && kRun.state.status === KS.PRESENT ? stateRaw(kRun.state) : (kRun.state ? kRun.state.status : 'absent'), runs: detail.runs.length, phases: `[${phases.join(',')}]`, runsWithFieldsNotPresent: detail.runs.filter((r) => r.notPresent.length > 0).length}));
      rows.push(...cpuRunDetailRows(detail));
    }
  }

  // قيم الحالات والنصوص الإضافية (INFO فقط): من البصمة (الطلب) ومن ملفّ Storage — لا تحتاج القارئ.
  if (fp0 === null) {
    for (const item of [ITEM.ENERGY_COUNTER_NWH, ITEM.CPU_TEMP_FINAL_SOURCE, ITEM.WORKERS_PIN_STATE, ITEM.MEMORY_VERIFY_STATE, ITEM.TIME_TO_FIRST_FIX_STATE]) noReader(item, 'RAW_FINGERPRINT_ABSENT');
  } else {
    const sv = readStateValues(fp0, st);
    const {_cells: ignored, ...svJson} = sv; void ignored;
    block.stateValues = svJson;
    rows.push(...stateValueRows(sv));
  }

  // حجم الحمولة (لا يحتاج القارئ: reportRaw وStorage المفكوك)
  const emitPayload = () => {
    if (raw === null) {
      R(ITEM.PAYLOAD_BYTES, V.NOT_MEASURED, 'RAW_ABSENT');
    } else {
      const reportRawBytes = measureReportRawBytes({...raw});
      const rehydratedBytes = fp !== null ? Buffer.byteLength(JSON.stringify(fp), 'utf8') : null;
      const storageJsonBytes = storageJson !== null ? Buffer.byteLength(JSON.stringify(storageJson), 'utf8') : null;
      block.payload = {
        reportRawBytes, reportRawBytesMax: REPORT_RAW_MAX_BYTES, reportRawPercentOfMax: round((reportRawBytes * 100) / REPORT_RAW_MAX_BYTES, 3),
        reportRawBytesNote: 'تقدير: الحقول الخمسة المنقولة من reportRaw بعد الاسترجاع (measureReportRawBytes)',
        rehydratedFingerprintBytes: rehydratedBytes, storageJsonBytes, approximate: 'المُعاد تركيبه من reportRaw + Storage المفكوك، لا بايتات السلك',
        requestWireBytes: {state: 'NOT_CARRIED'},
      };
      R(ITEM.PAYLOAD_BYTES, V.INFO, kv({reportRawBytes, reportRawBytesMax: REPORT_RAW_MAX_BYTES, rehydratedFingerprintBytes: rehydratedBytes, storageJsonBytes, requestWireBytes: 'NOT_CARRIED'}));
    }
  };

  // سلوك الجهاز
  if (reader === null) {
    for (const item of [ITEM.THERMAL_HEADROOM, ITEM.BATTERY_BROADCASTS, ITEM.L02, ITEM.GPU_FPS_TAIL, ITEM.SAMPLING_TIME, ITEM.MEMORY_KERNEL, ITEM.STORAGE_VERIFY, ITEM.CYCLE_COUNT, ITEM.CYCLE_COUNT_MATCHES_B08]) noReader(item, noReaderReason);
    emitPayload();
  } else {
    // getThermalHeadroom
    {
      const h = reader.thermal.headroom;
      const items = h.readings.items;
      const kinds = h.readings.byKind;
      const vals = {state: stateRaw(h.state) === null ? h.state.status : stateRaw(h.state), readings: items.length, ok: kinds[N.STATE_KIND.OK] || 0, nan: kinds[N.STATE_KIND.NAN] || 0, byKind: kinds};
      block.thermalHeadroom = {state: vals.state, readings: vals.readings, byKind: kinds, nanCount: vals.nan, okMin: h.readings.okMin, okMax: h.readings.okMax};
      rows.push(behaviorRow(ITEM.THERMAL_HEADROOM, {
        anomalies: sectionAnomalies(reader, (s) => s.startsWith(N.FOOTER.THERMAL_HEADROOM_READINGS) || s.startsWith(N.FOOTER.THERMAL_HEADROOM_STATE)),
        measured: h.readings.status === N.KEY_STATUS.PRESENT || h.state.status === N.KEY_STATUS.PRESENT, reason: `thermalHeadroom ${h.readings.status}/${h.state.status}`, values: vals,
      }));
    }
    // بثّات البطارية
    {
      const bp = reader.batteryPairs;
      const s = bp.state;
      const vals = {kind: s.kind === undefined ? s.status : s.kind, broadcastCount: s.broadcastCount === undefined ? null : s.broadcastCount, receiverRegistered: s.receiverRegistered === undefined ? null : s.receiverRegistered,
        droppedByCap: s.droppedByCap === undefined ? null : s.droppedByCap, invalidReads: s.invalidReads === undefined ? null : s.invalidReads, kept: bp.pairs.items.length};
      block.batteryBroadcasts = vals;
      rows.push(behaviorRow(ITEM.BATTERY_BROADCASTS, {
        anomalies: sectionAnomalies(reader, (x) => x.startsWith(N.FOOTER.BATTERY_PAIRS)), measured: s.status === N.KEY_STATUS.PRESENT, reason: `batteryPairsState ${s.status}`, values: vals,
      }));
    }
    // L-02
    {
      const fr = fp0 && Array.isArray(fp0.functionalResults) ? fp0.functionalResults : null;
      const {index, entry} = findEntry(fr, N.MEASURED_TEST_IDS.GPS_SATELLITES);
      const item = reader.measurements.items.find((i) => i.source === 'functionalResults' && i.testId === N.MEASURED_TEST_IDS.GPS_SATELLITES);
      const l = item && item.l02 ? item.l02 : null;
      block.l02 = {present: entry !== null, functionalStatus: entry && entry.status !== undefined ? entry.status : null, ...(l ? {...l} : {})};
      const ab = (v) => (v === null || v === undefined ? 'absent' : v); // القارئ يُخرج الغائب null: يُكتب هنا «absent» لا null ليُقرأ غياباً (القاعدة 22)
      const vals = l ? {status: block.l02.functionalStatus, engineState: l.engineState, timeToFirstFixMs: ab(l.timeToFirstFixMs), timeToFirstFixState: ab(l.timeToFirstFixState), gnssCallbackState: ab(l.gnssCallbackState), locationUpdatesState: ab(l.locationUpdatesState),
        callbacks: ab(l.satelliteStatusCallbacks), visible: ab(l.visibleSatellites), used: ab(l.usedSatellites)} : {status: block.l02.functionalStatus};
      rows.push(behaviorRow(ITEM.L02, {
        anomalies: index >= 0 ? sectionAnomalies(reader, (x) => x.startsWith(`functionalResults[${index}].${N.MEASUREMENTS_KEY}`)) : [],
        measured: l !== null, reason: entry === null ? 'L-02 غائب من functionalResults' : 'L-02 بلا measurements', values: vals,
      }));
    }
    // ذيل gpu_fps وزمن العيّنة
    {
      if (sampleInfo === null) {
        R(ITEM.GPU_FPS_TAIL, V.NOT_MEASURED, samplesWhy());
        R(ITEM.SAMPLING_TIME, V.NOT_MEASURED, samplesWhy());
      } else if (sampleInfo.state === 'NO_SAMPLES') {
        R(ITEM.GPU_FPS_TAIL, V.NOT_MEASURED, 'NO_SAMPLES'); R(ITEM.SAMPLING_TIME, V.NOT_MEASURED, 'NO_SAMPLES');
      } else {
        if (sampleInfo.gpuFps) {
          block.gpuFpsTail = {columnIndex: sampleInfo.gpuFpsColumn, ...sampleInfo.gpuFps};
          R(ITEM.GPU_FPS_TAIL, V.INFO, `tail=${JSON.stringify(sampleInfo.gpuFps.tail)} trailingZeroRun=${sampleInfo.gpuFps.trailingZeroRun} nonNumeric=${sampleInfo.gpuFps.nonNumericCount}`);
        } else {
          R(ITEM.GPU_FPS_TAIL, V.NOT_MEASURED, `عمود ${N.BASE_CHANNELS.GPU_FPS} غير محلول في التخطيط`);
        }
        if (sampleInfo.state === 'READ') R(ITEM.SAMPLING_TIME, V.INFO, kv({sampleCount: sampleInfo.sampleCount, spanMs: sampleInfo.spanMs, medianIntervalMs: sampleInfo.medianIntervalMs, maxIntervalMs: sampleInfo.maxIntervalMs, monotonic: sampleInfo.monotonic}));
        else R(ITEM.SAMPLING_TIME, V.NOT_MEASURED, sampleInfo.state);
      }
    }
    emitPayload();
    // نواة الذاكرة
    {
      const m = reader.verification.memory;
      const kind = stateKind(m.state);
      const present = m.state.status === N.KEY_STATUS.PRESENT;
      const reachedCap = m.durationMs !== null && m.timeCapMs !== null ? m.durationMs >= m.timeCapMs : null;
      const vals = {
        state: present ? stateRaw(m.state) : m.state.status, durationMs: m.durationMs, timeCapMs: m.timeCapMs, reachedCap,
        partialTimeCapReached: present ? (kind === N.STATE_KIND.PARTIAL && stateDetail(m.state) === STATE_DETAIL.TIME_CAP_REACHED) : null,
        notRunInsufficientFreeMemory: present ? (kind === N.STATE_KIND.NOT_RUN && stateDetail(m.state) === STATE_DETAIL.INSUFFICIENT_FREE_MEMORY) : null,
        memoryVerifyFreeBytes: m.bytes.freeBytes, verifiedBytes: m.bytes.verified, bufferBytes: m.bytes.buffer,
        errors: m.errors,
      };
      block.memoryKernel = vals;
      rows.push(behaviorRow(ITEM.MEMORY_KERNEL, {
        anomalies: sectionAnomalies(reader, (s) => s.startsWith(`${N.FOOTER.VERIFICATION_RESULTS}.${N.VERIFICATION.MEMORY_VERIFY_STATE}`) || /verificationResults\.memory/.test(s)),
        measured: present, reason: `memoryVerifyState ${m.state.status}`, values: vals,
      }));
    }
    // التخزين
    {
      const s = reader.verification.storage;
      const kind = stateKind(s.state);
      const present = s.state.status === N.KEY_STATUS.PRESENT;
      const vals = {
        state: present ? stateRaw(s.state) : s.state.status, method: stateRaw(s.method), oDirect: s.method.state ? stateKind(s.method) === N.STATE_KIND.O_DIRECT_SEQUENTIAL : null,
        writeErrors_stamp: s.errors.write, readErrors_readBack: s.errors.read, bytesCompared: s.bytes.compared, bytesPlanned: s.bytes.planned, durationMs: s.durationMs,
        notRunNoTimeLeft: present ? (kind === N.STATE_KIND.NOT_RUN && stateDetail(s.state) === STATE_DETAIL.NO_TIME_LEFT) : null,
      };
      block.storageVerify = vals;
      rows.push(behaviorRow(ITEM.STORAGE_VERIFY, {
        anomalies: sectionAnomalies(reader, (x) => /verificationResults\.storage/.test(x)), measured: present, reason: `storageVerifyState ${s.state.status}`, values: vals,
      }));
    }
    // الدورات ومطابقتها لـB-08
    {
      const cc = reader.batteryHealth.cycleCount;
      ex.cc = cc;
      const hasCc = !!cc && cc.valueStatus !== undefined;
      const vals = hasCc ? {value: cc.value, state: stateRaw(cc), source: cc.source ? cc.source.raw : null, sourceIsExtraApi34: cc.source ? cc.source.kind === N.STATE_KIND.EXTRA_API34 : null, valueStatus: cc.valueStatus, sourceStatus: cc.sourceStatus} : {state: 'ABSENT'};
      block.cycleCount = vals;
      rows.push(behaviorRow(ITEM.CYCLE_COUNT, {
        anomalies: sectionAnomalies(reader, (x) => x.startsWith(`${N.FOOTER.BATTERY_HEALTH}.${N.BATTERY_HEALTH.CYCLE_COUNT}`)),
        measured: hasCc && cc.valueStatus === N.KEY_STATUS.PRESENT, reason: `batteryHealth.cycleCount ${hasCc ? cc.valueStatus : 'ABSENT'} (غائبة أو حالتها not_read: لم تُقرأ)`, values: vals,
      }));
      const fr = fp0 && Array.isArray(fp0.functionalResults) ? fp0.functionalResults : null;
      const {entry} = findEntry(fr, B08_TEST_ID);
      const b08Raw = entry ? entry.rawValue : undefined;
      const b08Num = typeof b08Raw === 'string' && /^-?\d+(\.\d+)?$/.test(b08Raw.trim()) ? Number(b08Raw) : (typeof b08Raw === 'number' && Number.isFinite(b08Raw) ? b08Raw : null);
      block.b08 = {present: entry !== null, status: entry && entry.status !== undefined ? entry.status : null, rawValueNumeric: b08Num, rawValueUnit: entry && entry.rawValueUnit !== undefined ? entry.rawValueUnit : null};
      if (entry === null) R(ITEM.CYCLE_COUNT_MATCHES_B08, V.NOT_MEASURED, `B-08 غائب من الحمولة (cycleCount=${fmt(vals.value)})`);
      else if (b08Num === null) R(ITEM.CYCLE_COUNT_MATCHES_B08, V.NOT_MEASURED, `rawValue لـB-08 ليس رقماً (status=${block.b08.status})`);
      else if (!hasCc || cc.valueStatus !== N.KEY_STATUS.PRESENT) R(ITEM.CYCLE_COUNT_MATCHES_B08, V.NOT_MEASURED, `cycleCount غائب (B-08=${b08Num})`);
      else R(ITEM.CYCLE_COUNT_MATCHES_B08, cc.value === b08Num ? V.PASS : V.FAIL, `cycleCount=${cc.value} B-08=${b08Num}`);
    }
  }

  // ─── الجولة الثانية (الجزء الخامس، 2026-10-13 +03): ختم قواعد التقييم وتصنيف الدورات وبصمة الجهاز المحفوظة (بعد النشر؛ إصدار التطبيق لكل وسم في TAG_EXPECTATIONS_R2) ───
  {
    const round2 = footerFv !== null && footerFv >= N.FIELDS_VERSION_70;
    const beforeReason = footerFv === null ? 'footer.fieldsVersion غائب' : `BEFORE_FV70: fieldsVersion=${footerFv} < ${N.FIELDS_VERSION_70}`;
    // ختم القواعد: يقرؤه الحقل من جذر مستند reports، لا من القارئ.
    const rs = facts.rulesStamp || null;
    if (!round2) R(ITEM.EVALUATION_RULES_STAMP, V.NOT_MEASURED, beforeReason);
    else if (rs === null) R(ITEM.EVALUATION_RULES_STAMP, V.NOT_MEASURED, 'NOT_COLLECTED: مستند reports لم يُقرأ لحقل الختم');
    else {
      const pipelineText = rs.pipeline.state === FIELD_PRESENT ? rs.pipeline.value : rs.pipeline.state;
      const cached = rs.pipeline.state === FIELD_PRESENT && rs.pipeline.value === CACHED_PIPELINE_TAG;
      block.rulesStamp = {field: EVALUATION_RULES_VERSION_FIELD, state: rs.stamp.state, value: rs.stamp.state === FIELD_PRESENT ? rs.stamp.value : null, expected: EVALUATION_RULES_VERSION, pipeline: pipelineText};
      if (rs.stamp.state === FIELD_PRESENT) {
        R(ITEM.EVALUATION_RULES_STAMP, rs.stamp.value === EVALUATION_RULES_VERSION ? V.PASS : V.FAIL, `${EVALUATION_RULES_VERSION_FIELD}=${rs.stamp.value} expected=${EVALUATION_RULES_VERSION} pipeline=${pipelineText}`);
      } else if (cached && rs.stamp.state === N.KEY_STATUS.ABSENT) {
        R(ITEM.EVALUATION_RULES_STAMP, V.NOT_MEASURED, `${EVALUATION_RULES_VERSION_FIELD}=ABSENT في تقرير pipeline=${CACHED_PIPELINE_TAG} (المخبَّأ يحمل ختم الأصل إن حمله وإلا يغيب) expected=${EVALUATION_RULES_VERSION}`);
      } else {
        R(ITEM.EVALUATION_RULES_STAMP, V.FAIL, `${EVALUATION_RULES_VERSION_FIELD}=${rs.stamp.state} (غائب أو بنوع خاطئ في تقرير كُتب بعد النشر) expected=${EVALUATION_RULES_VERSION} pipeline=${pipelineText}`);
      }
    }
    // تصنيف الدورات من القارئ نفسه؛ التوقّع وسيط لكل وسم (ctx.cycleExpect) لا ثابت هنا.
    const cexpMap = ctx && isObj(ctx.cycleExpect) ? ctx.cycleExpect : {};
    const cexp = Object.prototype.hasOwnProperty.call(cexpMap, facts.tag) ? cexpMap[facts.tag] : undefined;
    let observedClass;
    if (reader === null) noReader(ITEM.CYCLE_CLASSIFICATION, noReaderReason);
    else if (!round2) R(ITEM.CYCLE_CLASSIFICATION, V.NOT_MEASURED, beforeReason);
    else {
      observedClass = classifyCycleCount(reader.batteryHealth.cycleCount);
      const ccv = block.cycleCount || {};
      const seen = `observed=${fmt(observedClass)} cycleCountState=${fmt(ccv.state)} source=${fmt(ccv.source)} value=${fmt(ccv.value)}`;
      const expectedValue = cexp === 'classified' ? N.CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 : (cexp === 'none' ? null : undefined);
      block.cycleClassification = {observed: observedClass, expectation: cexp === undefined ? 'NOT_SUPPLIED' : cexp, expected: expectedValue === undefined ? null : expectedValue};
      if (cexp === undefined) R(ITEM.CYCLE_CLASSIFICATION, V.INFO, `${seen} expectation=NOT_SUPPLIED_FOR_TAG(${facts.tag})`);
      else R(ITEM.CYCLE_CLASSIFICATION, observedClass === expectedValue ? V.PASS : V.FAIL, `${seen} expected=${fmt(expectedValue)} (${cexp})`);
    }
    // بصمة الجهاز المحفوظة: INFO فقط (لا حكم)، وكل تعذّر حالة مسمّاة.
    const pf = facts.profile || null;
    if (!round2) R(ITEM.CYCLE_CLASSIFICATION_SIGNATURE, V.NOT_MEASURED, beforeReason);
    else if (pf === null) R(ITEM.CYCLE_CLASSIFICATION_SIGNATURE, V.INFO, 'NOT_COLLECTED: بصمة الجهاز المحفوظة لم تُقرأ');
    else {
      block.profileSignature = pf;
      if (pf.state !== 'ENTRY_FOUND') {
        R(ITEM.CYCLE_CLASSIFICATION_SIGNATURE, V.INFO, kv({profileState: pf.state, ...(pf.profileIdHash ? {profileIdHash: pf.profileIdHash} : {}), ...(pf.historyLength !== undefined ? {historyLength: pf.historyLength} : {}), ...(pf.errorClass ? {errorClass: pf.errorClass} : {}), ...(pf.errorCode !== undefined ? {errorCode: pf.errorCode} : {})}));
      } else {
        const saved = pf.classification === null ? pf.signatureState : (pf.classification.state === FIELD_PRESENT ? pf.classification.value : `KEY_${pf.classification.state}`);
        const same = pf.classification !== null && pf.classification.state === FIELD_PRESENT && observedClass !== undefined ? String(pf.classification.value === observedClass) : 'NOT_COMPARABLE';
        R(ITEM.CYCLE_CLASSIFICATION_SIGNATURE, V.INFO, kv({profileState: pf.state, profileIdHash: pf.profileIdHash, historyLength: pf.historyLength, savedClassification: saved, observedInReport: observedClass === undefined ? 'NOT_COMPUTED' : observedClass, sameAsObserved: same}));
      }
    }
    // حمولة النموذج: لا تُخزَّن، فلا صفّ يدّعي وصول B-08 إلى النموذج أو عدمه (القاعدة 22). الدليل الوحيد سطر السجلّ (بلا scanId) في runAnalysisInternal.js — يُسمّى هنا ويُربط بنافذة الوقت.
    block.b08ModelPayload = {state: 'NOT_READABLE_FROM_PRODUCTION', evidence: 'سجلّ analyzeDevice: سطر «[cycleCount] classification=<الوسم> — B-08 omitted from categoryStates.testResults (not sent to the model)» يُطبَع حين يقع التصنيف فقط، بلا scanId؛ غيابه لا يثبت أن B-08 وصل'};
  }

  // الجلسة
  const sess = facts.session || {state: 'NOT_A_SESSION_SCAN'};
  block.session = {state: sess.state};
  const isSessionScan = sess.state !== 'NOT_A_SESSION_SCAN';
  const expectsSession = SESSION_TAG_PATTERN.test(facts.tag);
  if (!isSessionScan) {
    R(ITEM.SESSION_SCAN, expectsSession ? V.FAIL : V.INFO, expectsSession ? 'وسم S ولا sessionId في reportRaw' : 'sessionId=null (فحص فردي)');
  } else {
    R(ITEM.SESSION_SCAN, sess.state === 'SESSION_ID_UNREADABLE' ? V.FAIL : V.INFO, `sessionId حاضر state=${sess.state}`);
    if (sess.state === 'READ') {
      const cls = classifyStatus(sess.data);
      const status = cls.state === STATUS_STATE.KNOWN ? cls.status : null;
      const d = sess.data;
      const joinedByPresent = typeof d.joinedBy === 'string' && d.joinedBy !== '';
      const joinedAtMs = d.joinedAt && typeof d.joinedAt.toMillis === 'function' ? d.joinedAt.toMillis() : (d.joinedAt instanceof Date ? d.joinedAt.getTime() : null);
      block.session = {
        state: 'READ', sessionIdHash: sess.sessionIdHash, statusState: cls.state, status, joinedByPresent, joinedByHash: C.hashIdForLog(d.joinedBy),
        joinedAtPresent: joinedAtMs !== null && Number.isFinite(joinedAtMs), joinedAtPlus03: joinedAtMs !== null && Number.isFinite(joinedAtMs) ? plus03Iso(joinedAtMs) : null,
        scanIdMatchesReport: sess.scanIdMatches, ownerMatchesAccount: sess.ownerMatches,
      };
      R(ITEM.SESSION_STATUS, status === SESSION_STATUS.COMPLETED ? V.PASS : V.FAIL, `status=${status === null ? cls.state : status}`);
      // S1 وS2 (:126 «joinedBy غير فارغ»): حاضر = PASS، غائب أو فارغ = FAIL. غيرهما: INFO كما كان.
      R(ITEM.SESSION_JOINED_BY, exp && exp.sessionStrict ? (joinedByPresent ? V.PASS : V.FAIL) : V.INFO, `joinedByPresent=${joinedByPresent} joinedByHash=${block.session.joinedByHash} joinedAt=${fmt(block.session.joinedAtPlus03)}`);
      const linkOk = sess.scanIdMatches === true && sess.ownerMatches === true;
      R(ITEM.SESSION_SCAN_LINK, linkOk ? V.PASS : V.FAIL, `scanIdMatchesReport=${fmt(sess.scanIdMatches)} ownerMatchesAccount=${fmt(sess.ownerMatches)}`);
    } else {
      const why = sess.state === 'SESSION_DOC_ABSENT' ? 'scanSessions/{sessionId} غائب' : 'sessionId غير مقروء';
      block.session = {state: sess.state, ...(sess.sessionIdHash ? {sessionIdHash: sess.sessionIdHash} : {})};
      R(ITEM.SESSION_STATUS, V.NOT_MEASURED, why); R(ITEM.SESSION_JOINED_BY, V.NOT_MEASURED, why); R(ITEM.SESSION_SCAN_LINK, V.NOT_MEASURED, why);
    }
  }

  // evaluations/{scanId}
  {
    const ev = facts.evaluation || {exists: false};
    const strictEval = !!(exp && exp.sessionStrict); // S1 وS2 (:167): غياب التقييم أو عدم ربطه بعد صدور التقرير = FAIL بسببه
    if (!ev.exists) {
      block.evaluation = {exists: false};
      if (strictEval) R(ITEM.EVALUATION_DOC, V.FAIL, 'EVALUATION_ABSENT_AFTER_SESSION (لا مستند تقييم بعد الجلسة: شرط توقّف)');
      else R(ITEM.EVALUATION_DOC, isSessionScan ? V.NOT_MEASURED : V.INFO, isSessionScan ? 'EVALUATION_NOT_SUBMITTED_YET (فحص جلسة بلا تقييم)' : 'لا تقييم (تقرير فردي)');
      R(ITEM.EVALUATION_NO_MOVED_IDS, V.NOT_MEASURED, 'EVALUATION_DOC_ABSENT');
    } else {
      const d = ev.data;
      const keys = allKeysDeep(d);
      const moved = [...new Set([...REPORT_RAW_FIELDS, ...RAW_LINKAGE_FIELDS])].filter((k) => keys.has(k)).sort();
      block.evaluation = {
        exists: true, pending: typeof d.pending === 'boolean' ? d.pending : null, ownerMismatch: typeof d.ownerMismatch === 'boolean' ? d.ownerMismatch : null,
        linkageIncomplete: typeof d.linkageIncomplete === 'boolean' ? d.linkageIncomplete : null,
        missingLinkageFields: Array.isArray(d.missingLinkageFields) ? d.missingLinkageFields.filter((x) => typeof x === 'string') : null,
        linkageRawState: typeof d.linkageRawState === 'string' ? d.linkageRawState : null, source: typeof d.source === 'string' ? d.source : null,
        revisionCount: Number.isInteger(d.revisionCount) ? d.revisionCount : null, resolvedAtPresent: d.resolvedAt !== undefined && d.resolvedAt !== null,
        movedKeysFound: moved,
      };
      const pending = block.evaluation.pending;
      if (strictEval) {
        const ev2 = block.evaluation;
        const problems = [];
        if (pending !== false) problems.push(pending === true ? 'EVALUATION_PENDING_NOT_LINKED_AFTER_REPORT' : 'EVALUATION_PENDING_FLAG_UNREADABLE');
        if (ev2.linkageIncomplete !== false) problems.push(ev2.linkageIncomplete === true ? `EVALUATION_LINKAGE_INCOMPLETE(missing=${JSON.stringify(ev2.missingLinkageFields)})` : 'EVALUATION_LINKAGE_FLAG_UNREADABLE');
        if (ev2.ownerMismatch !== false) problems.push(ev2.ownerMismatch === true ? 'EVALUATION_OWNER_MISMATCH' : 'EVALUATION_OWNER_MISMATCH_FLAG_UNREADABLE');
        if (ev2.linkageRawState !== RAW_STATE.PRIVATE) problems.push(`EVALUATION_LINKAGE_RAW_STATE_NOT_PRIVATE(state=${fmt(ev2.linkageRawState)})`);
        R(ITEM.EVALUATION_DOC, problems.length === 0 ? V.PASS : V.FAIL, `pending=${fmt(pending)} linkageIncomplete=${fmt(ev2.linkageIncomplete)} linkageRawState=${fmt(ev2.linkageRawState)} ownerMismatch=${fmt(ev2.ownerMismatch)}${problems.length ? ` problems=[${problems.join(',')}]` : ''}`);
      } else if (pending === false) R(ITEM.EVALUATION_DOC, isSessionScan ? V.PASS : V.INFO, `pending=false linkageIncomplete=${fmt(block.evaluation.linkageIncomplete)} linkageRawState=${fmt(block.evaluation.linkageRawState)} ownerMismatch=${fmt(block.evaluation.ownerMismatch)}`);
      else R(ITEM.EVALUATION_DOC, V.INFO, `pending=${fmt(pending)} (لم يُستكمل بعد أو الحقل غائب) linkageRawState=${fmt(block.evaluation.linkageRawState)}`);
      R(ITEM.EVALUATION_NO_MOVED_IDS, moved.length === 0 ? V.PASS : V.FAIL, moved.length === 0 ? 'لا مفتاح منقول في المستند' : `movedKeysFound=${JSON.stringify(moved)}`);
    }
  }

  // توقّعات الوسم: صفوف EXPECT_* ثم (B1 بختم 67) البنود التي لا تحملها حمولة fv67 بطبيعتها ⟵ NOT_MEASURED:LEGACY_FV67_SCAN لا FAIL.
  if (exp) {
    for (const item of expectItemsOf(facts.tag, roundNo)) {
      if (reader === null) { R(item, V.NOT_MEASURED, noReaderReason); continue; }
      const [verdict, basis] = EXPECT_CHECKS[item](ex, exp);
      R(item, verdict, basis);
    }
    if (exp.scan === SCAN_KIND.LEGACY_FV67 && footerFv === exp.fieldsVersion) {
      const applied = [];
      rows.forEach((r, i) => {
        const spec = LEGACY_BY_NATURE[r.item];
        if (!spec) return;
        rows[i] = row(r.item, V.NOT_MEASURED, `${LEGACY_FV67_SCAN}: لا تحمله حمولة fv${exp.fieldsVersion} بطبيعتها (يوجد من fv${spec.since}؛ ${spec.source}) — الأصل: ${r.verdict}: ${r.basis}`);
        applied.push({item: r.item, sinceFieldsVersion: spec.since, originalVerdict: r.verdict});
      });
      block.legacyByNature = {reason: LEGACY_FV67_SCAN, items: applied};
    }
  }

  void ctx;
  return {block, rows};
}

// ───────────────────────── المخرَج ─────────────────────────

/**
 * يجمع تقارير الوسوم في مخرَج واحد: كتل، وجدول مسطَّح واحد، وملخّص. دالّة نقيّة.
 * @param {Array<{tag: string, block: Object, rows: Array}>} evaluated
 * @return {{reports: Array, table: Array, summary: Object}}
 */
function assembleOutput(evaluated) {
  const table = [];
  const counts = {PASS: 0, FAIL: 0, NOT_MEASURED: 0, INFO: 0};
  const byTag = {};
  for (const e of evaluated) {
    byTag[e.block.tag] = {PASS: 0, FAIL: 0, NOT_MEASURED: 0, INFO: 0};
    for (const r of e.rows) {
      table.push({tag: e.block.tag, item: r.item, verdict: r.verdict, basis: r.basis});
      counts[r.verdict]++;
      byTag[e.block.tag][r.verdict]++;
    }
  }
  return {reports: evaluated.map((e) => e.block), table, summary: {rows: table.length, verdicts: counts, byTag, hasFail: counts.FAIL > 0}};
}

// ───────────────────────── الفحص الذاتي ─────────────────────────

function preflightChecks(env = process.env) {
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const toks = parseTokens('B1=NC-AAAAAA, S1=NC-BBBBBB,WAIT=NC-CCCCCC');
  const sn = readSn04({windowMs: 4000, coverPromptAtMs: 1000, readingsBeforeCover: [{t: 100, values: [10]}, {t: 600, values: [20]}], readingsDuringCover: [{t: 1100, values: [1]}]});
  const an = analyzeSamples([{phase: 3, v: [0]}, {phase: 3, v: [100]}, {phase: 5, v: [200]}, {phase: 5, v: [500]}], {byName: {[N.BASE_CHANNELS.TIMESTAMP_MS]: 0}});
  const dFp = {timeSeries: {footer: {fieldsVersion: N.FIELDS_VERSION_69, verificationResults: {cpuKnownAnswerState: 'ran', cpuKnownAnswerTotalMsByPhase: {3: 150}, cpuKnownAnswerRuns: [
    {phase: 3, plannedAtPct: 25, t: 1000, tEnd: 1100, sieveStatus: 'match', sievePrimeCount: 664579, sieveDurationMs: 60, sha256Status: 'match', sha256DurationMs: 30},
    {phase: 3, plannedAtPct: 60, t: 2000, tEnd: 2050, sieveStatus: 'match', sievePrimeCount: 664579, sha256Status: 'match', sha256DurationMs: 20}]}}}};
  const dDet = readCpuRunDetail(dFp.timeSeries.footer.verificationResults, readFv68(dFp).verification.cpuKnownAnswer);
  const sVals = readStateValues({timeSeries: {footer: {cpuTempFinalSource: 'y'.repeat(300), batteryHealth: {energyCounterNwhState: 'not_read:x'}, verificationResults: {memoryVerifyState: 'ran'}}}, functionalResults: []}, {state: 'DOWNLOADED', json: {footer: {batteryHealth: {energyCounterNwh: null}}}});
  const checks = [
    ['--tokens --out: وضع التشغيل بوسوم ورموز', (() => { const a = parseArgs(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json']); return a.mode === 'run' && a.useStorage === true && a.tokens.length === 1 && a.out === 'a.json'; })()],
    ['--no-storage يعطّل Storage', parseArgs(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json', '--no-storage']).useStorage === false],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--out', 'a.json'], /--preflight وحدها/)],
    ['بلا وسائط: USAGE', bad([], /USAGE: --tokens/)],
    ['قائمة بثلاثة وسوم (مع مسافات)', toks.length === 3 && toks[1].tag === 'S1' && toks[2].shortId === 'NC-CCCCCC'],
    ['وسم مكرَّر يُرفض', bad(['--tokens', 'B1=NC-AAAAAA,B1=NC-BBBBBB', '--out', 'a.json'], /وسم مكرَّر/)],
    ['رمز مكرَّر يُرفض', bad(['--tokens', 'B1=NC-AAAAAA,B2=NC-AAAAAA', '--out', 'a.json'], /رمز مكرَّر/)],
    ['رمز بصيغة خاطئة يُرفض', bad(['--tokens', 'B1=nc-aaaaaa', '--out', 'a.json'], /NC-XXXXXX/)],
    ['عنصر بلا = يُرفض', bad(['--tokens', 'NC-AAAAAA', '--out', 'a.json'], /الوسم=NC-XXXXXX/)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--tokens', 'B1=NC-AAAAAA', '--out', 'a.json', '--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['SN-04: عددا القائمتين ومتوسّطاهما', sn.before.count === 2 && sn.during.count === 1 && sn.before.mean === 15 && sn.during.mean === 1 && sn.problems.length === 0],
    ['العيّنات: امتداد كل مرحلة', an.phases[3].durationMs === 100 && an.phases[5].durationMs === 300 && an.spanMs === 500],
    ['تفصيل D: مجاميع المرحلة بأعدادها، والغائب ABSENT لا 0 (فرق 100+50، غربال 60 من تشغيل واحد، باقي 10 من التشغيل الكامل وحده)', dDet.byPhase[3] !== undefined && dDet.byPhase[3].diff.sumMs === 150 && dDet.byPhase[3].diff.runsCounted === 2 && dDet.byPhase[3].sieve.sumMs === 60 && dDet.byPhase[3].sieve.runsCounted === 1 && dDet.byPhase[3].remainder.sumMs === 10 && dDet.byPhase[3].remainder.runsCounted === 1 && dDet.byPhase[3].diffSumVsShipped === 'EQUAL' && dDet.runs[1].sieve.durationMs === null && dDet.runs[1].fieldStates.sieveDurationMs === N.KEY_STATUS.ABSENT],
    ['قيم الحالات: null صريحة في الملفّ وغائب من الطلب ⟵ NULL_IN_FILE_ABSENT_IN_REQUEST، وبعد 200 حرف يُقطع ويُعلَن، وغياب L-02 ⟵ L02_ABSENT', sVals.energyCounterNwh.comparison === 'NULL_IN_FILE_ABSENT_IN_REQUEST' && sVals.energyCounterNwh.requestState.value === 'not_read:x' && sVals.cpuTempFinalSource.truncated === true && sVals.cpuTempFinalSource.length === 300 && sVals.cpuTempFinalSource.value.length === STATE_TEXT_CAP && sVals.timeToFirstFixState.state === 'L02_ABSENT' && sVals.workersPinState.state === N.KEY_STATUS.ABSENT],
    ['معيار D: 1٪ بالضبط يمرّ (≤)', 1000 * 100 <= 100000 * D_SHARE_MAX_PERCENT && !(1001 * 100 <= 100000 * D_SHARE_MAX_PERCENT)],
    ['نصّ معيار D كما في قرار المستخدم', D_SHARE_CRITERION_TEXT === 'والقبول: مجموع زمن D في المرحلة ≤ 1% من زمنها.'],
    ['الحالات اليدوية الخمس معروفة', KNOWN_MANUAL_STATUSES.length === 5],
    ['جدول التوقّعات: الوسوم الخمسة بأسمائها', JSON.stringify(Object.keys(TAG_EXPECTATIONS)) === JSON.stringify(['B1', 'B2', 'S1', 'S2', 'WAIT']) && tagExpectation('b1') === null && tagExpectation('X') === null],
    ['جدول التوقّعات: B1 = 1.0.10 وختم 67 بالضبط؛ والأربعة الجدد = 1.0.11 وختم 69 بالضبط',
      TAG_EXPECTATIONS.B1.appVersion === '1.0.10' && TAG_EXPECTATIONS.B1.fieldsVersion === 67 && ['B2', 'S1', 'S2', 'WAIT'].every((t) => TAG_EXPECTATIONS[t].appVersion === '1.0.11' && TAG_EXPECTATIONS[t].fieldsVersion === 69)],
    ['جدول التوقّعات: كل سطر بمصدر (سطر وثيقة أو أمر المنسّق الأوّل) واقتباس وقاعدة، وكل EXPECT له قاعدة في rules',
      Object.values(TAG_EXPECTATIONS).every((e) => e.lines.every((l) => (/^DEVICE-CHECK-03-2026-10-10\.md:\d+(-\d+)?/.test(l.source) || l.source === ORDER1_SOURCE) && l.quote.length > 0 && l.rule.length > 0)) && Object.values(EXPECT).every((id) => ITEM_RULES[id] && ITEM_RULES[id].includes('DEVICE-CHECK-03-2026-10-10.md:'))],
    ['الجولة ٢: --round غائب = 1، و2 يُقبل، وغيرهما USAGE', parseArgs(['--tokens', 'B8=NC-AAAAAA', '--out', 'a.json']).round === 1 && parseArgs(['--tokens', 'B8=NC-AAAAAA', '--out', 'a.json', '--round', '2']).round === 2 && bad(['--tokens', 'B8=NC-AAAAAA', '--out', 'a.json', '--round', '3'], /--round: 1 أو 2/) && bad(['--tokens', 'B8=NC-AAAAAA', '--out', 'a.json', '--round', ''], /--round: 1 أو 2/)],
    ['جدول الجولة ٢: B8 وS1 وS2 بختم 70 بالضبط، والإصدار لكل مجموعة (B8 على 1.0.12 وS1 وS2 على 1.0.14، وهما مختلفان)، يُختار بالجولة 2 وحدها',
      JSON.stringify(Object.keys(TAG_EXPECTATIONS_R2)) === JSON.stringify(['B8', 'S1', 'S2']) && ['B8', 'S1', 'S2'].every((t) => tagExpectation(t, 2).fieldsVersion === N.FIELDS_VERSION_70)
      && tagExpectation('B8', 2).appVersion === EXPECTED_APP_VERSION_R2_B8 && ['S1', 'S2'].every((t) => tagExpectation(t, 2).appVersion === EXPECTED_APP_VERSION_R2_SESSIONS) && EXPECTED_APP_VERSION_R2_B8 !== EXPECTED_APP_VERSION_R2_SESSIONS
      && tagExpectation('B8') === null && tagExpectation('S1').appVersion === EXPECTED_APP_VERSION],
    ['جدول الجولة ٢: كل سطر بمصدر سطر وثيقة واقتباس وقاعدة، وكل EXPECT فيه له قاعدة في ITEM_RULES_R2', Object.values(TAG_EXPECTATIONS_R2).every((e) => e.lines.every((l) => /^DEVICE-CHECK-03-2026-10-10\.md:\d+/.test(l.source) && l.quote.length > 0 && l.rule.length > 0)) && Object.values(TAG_EXPECTATIONS_R2).every((e) => e.lines.filter((l) => EXPECT_IDS.has(l.item)).every((l) => ITEM_RULES_R2[l.item] && ITEM_RULES_R2[l.item].includes('DEVICE-CHECK-03-2026-10-10.md:')))],
    ['البنود القديمة بطبيعتها: كل بند له since ومصدر عقد', Object.values(LEGACY_BY_NATURE).every((s) => (s.since === 68 || s.since === 69) && /^docs\/FV68_CONTRACT\.md:\d+/.test(s.source))],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), ownerEmailEnvPresent: typeof env[C.OWNER_EMAIL_ENV] === 'string' && env[C.OWNER_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {
  MODE, VERDICT, ITEM, ITEM_RULES, ITEM_RULES_R2, EXPECTED_APP_VERSION, EXPECTED_APP_VERSION_R2_B8, EXPECTED_APP_VERSION_R2_SESSIONS, D_SHARE_CRITERION_TEXT, D_SHARE_MAX_PERCENT, GPU_FPS_TAIL_COUNT, MANUAL_STATUS, KNOWN_MANUAL_STATUSES, END_REASON_STATUS, SN04, MANUAL_HEADER, B08_TEST_ID, STATE_DETAIL,
  CHECK_DOC, ORDER1_SOURCE, SCAN_KIND, LEGACY_FV67, LEGACY_FV67_SCAN, LEGACY_BY_NATURE, EXPECT, EXPECT_R2, M15_TEST_ID, TAG_EXPECTATIONS, TAG_EXPECTATIONS_R2, NOT_JUDGED_FROM_SERVER_R2, tagExpectation, expectItemsOf, expectationBlock, expectationsOutput, roundOf,
  MAX_TOKENS, parseTokens, parseArgs, gatherReportFacts, analyzeSamples, readCpuRunDetail, cpuRunDetailRows, cpuDRound2Rows, ROUND2_EXPECTED_SIEVE_LIMIT, ROUND2_EXPECTED_SIEVE_PRIME_COUNT, readStateValues, stateValueRows, compareFileToRequest, STATE_TEXT_CAP, readSn04, evaluateReport, assembleOutput, preflightChecks,
};
