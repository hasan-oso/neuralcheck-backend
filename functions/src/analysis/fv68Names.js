'use strict';

// ===================================================================
// fv68Names.js — أسماء عقد fieldsVersion 68 وقيمه الحرفية، في موضع واحد
// (V8 / PLAN-05 الدفعة ٤، 2026-10-09 +03، القاعدة 24)
// ===================================================================
//
// القاعدة 24 بنصّها: «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم
// حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل ملفّ.»
// كل قارئ fv68 في هذا المستودع (fv68Reader.js، findings.js،
// signatures/*.js، admin/runConsistencyTest.js) يستورد من هنا، ويُخفق
// test/fv68Names.test.js إن ظهر اسم من هذه في ملفّ قارئ بنصّ حرفي مكرَّر.
//
// **المصدر:** docs/FV68_CONTRACT.md — نسخة بايتاً ببايت من NeuralChek
// a04b4f0 (sha256 في docs/FV68_CONTRACT.SOURCE.txt؛ كانت 738da89 حتى 2026-10-10). لكل مجموعة أدناه موضعها
// في العقد (عقد :سطر). ⚠️ أرقام الأسطر المذكورة «عقد :N» أُخذت من نسخة 738da89: في نسخة a04b4f0 يُضاف 1 للأسطر 6..1426
// و156 لما بعدها (التفصيل في docs/FV68_CONTRACT.SOURCE.txt)؛ وما يخصّ fv69 (M-02) مذكور بأسطر نسخة a04b4f0. والأسماء التي أقرّها المستخدم أو المنسّق مذكورة في
// العقد بوسم [ح]/[م]؛ وما سمّيتُه أنا (أسماء داخلية للخادم لا تُكتب على
// السلك) موسوم «اسم خادم» — لا يعتمد عليه التطبيق ولا الموقع.
//
// ما لا يفعله هذا الملف: لا منطق. ثوابت وقوائم مجمَّدة وأنماط فقط.

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

// ─── الختم ────────────────────────────────────────────────────────────
// fv68 = أوّل ختم يحمل المفاتيح أدناه (عقد :9 «قاعدة الختم»، ت-19 :659-673).
const FIELDS_VERSION_68 = 68;
// fv69 = الدفعة ١٠ من التطبيق (خطوات الفنّي): عقد §٧-ح (docs/FV68_CONTRACT.md:1429-1582، نسخة NeuralChek a04b4f0). يضيف على fv68: حالة اليدوي
// `unavailable`، وجذر manualResultsHeader.hiddenByModel، وM-02 timeToFirstTouchMs ودلالة elapsedMs الجديدة، وخامّ SN-04.
// الخادم يقرأ عتبةً لا تعدّد إصدارات: ≥ 68 «مُنطبِق» (fv68Reader.js) — و≥ 69 يحمل ما يخصّ M-02 أدناه.
const FIELDS_VERSION_69 = 69;
// fv70 = قرّاء D في الدفعة التالية من التطبيق (NeuralChek@80ca8c3، §٧-ط من عقد التطبيق؛ app/build.gradle.kts:486 — **منقول من أمر المنسّق 2026-10-13، غير متحقَّق من المستودع المصدر**؛ نسخة العقد هنا لا تحمل §٧-ط بعد:
// ستُنسخ بأمر لاحق). يضيف على fv69: `cpuKnownAnswerRuns[].sieveLimit`، والقيمة `skipped:time_budget` في sieveStatus وsha256Status، والقيمة `partial:time_budget` في cpuKnownAnswerState (و`ran` صار يعني «بلا متروك»).
// الخادم يقرأ عتبةً: ≥ 70 ⟵ `sieveLimit` متوقَّع في كل تشغيل نُفِّذ غربالُه (قارئ D في fv68Reader.js)؛ وقبلها (68 و69) N = SIEVE_LIMIT_WHEN_ABSENT_FV68_69.
const FIELDS_VERSION_70 = 70;
// fv71 = M-02 الشبكة الجديدة بالخامّ (الخيار ب) · أزرار الصوت M-09/M-10 · P6-13 توحيد الظروف: عقد التطبيق §٧-ي (NeuralChek@0af0b5c، docs/FV68_CONTRACT.md:1800-1986)،
// **نسخة القسم وحده** في docs/FV71_CONTRACT_SECTION.md (docs/FV71_CONTRACT_SECTION.SOURCE.txt: sha256 7130b544…). «71 يوضع في أوّل التزام كود يغيّر الشكل» (القسم، الختم) — الخادم يقرأ عتبةً ≥ 71 كما يفعل مع 69 و70،
// ولا قائمة بيضاء (fieldsVersionThresholds.test.js). **قارئ الخادم يُنشر قبل أن يرسل أيّ تطبيق fv71** (القسم، الختم؛ القاعدة 25).
const FIELDS_VERSION_71 = 71;

// ─── أعمدة v[0..10]: «كما هي» (عقد §٢.١ :398-402؛ ١.٤ :141-157) ──────────
// الترتيب هنا = الفهرس. لا يتحرّك فهرس ولا معنى منها في fv68.
const BASE_CHANNELS = deepFreeze({
  TIMESTAMP_MS: 'timestamp_ms',
  BATTERY_TEMP_C: 'battery_temp_c',
  BATTERY_VOLTAGE_MV: 'battery_voltage_mv',
  BATTERY_CURRENT_UA: 'battery_current_ua',
  BATTERY_LEVEL_PCT: 'battery_level_pct',
  CPU_FREQ_MAX_KHZ: 'cpu_freq_max_khz',
  CPU_USAGE_PCT: 'cpu_usage_pct',
  PACKAGE_POWER_MW: 'package_power_mw',
  STORAGE_THROUGHPUT_MBPS: 'storage_throughput_mbps',
  MEMORY_BANDWIDTH_MBPS: 'memory_bandwidth_mbps',
  GPU_FPS: 'gpu_fps',
});
const BASE_CHANNEL_ORDER = Object.freeze(Object.values(BASE_CHANNELS));
const BASE_CHANNEL_COUNT = BASE_CHANNEL_ORDER.length; // 11 (V2_SAMPLE_VAR_COUNT في التطبيق)

// ─── أعمدة fv68 المُلحَقة بعد v[10] (عقد §٢.١ :403-409؛ ت-01 :416-431؛ ت-05 :468-478) ──
const CHARGE_COUNTER_CHANNEL = 'charge_counter_raw';
// الوحدة المعلنة لعمود charge_counter_raw: «كما أعلنها الجهاز» (عقد :421 [ح س-09]) —
// ليست وحدة قياس بل إعلان بأن الوحدة غير معروفة للتطبيق؛ يستنتجها الخادم من السعة التصميمية والمستوى.
const CHARGE_COUNTER_UNIT_AS_DECLARED = 'as_declared_by_device';
const CPU_FREQ_POLICY_CHANNEL_RE = Object.freeze(/^cpu_freq_policy(\d+)_khz$/); // بلا g ولا y: exec لا يكتب lastIndex فالتجميد آمن

// ─── سقوف يعلنها العقد ─────────────────────────────────────────────────
const CHANNEL_READ_FAILURE_LIST_CAP = 200; // عقد :1001 (٧ بند 1 :1091) — سقف فهارس الفشل للقناة
const BATTERY_PAIRS_CAP = 200; //            عقد :496، :499 — سقف عناصر batteryPairs
const REASON_TEXT_CAP_CHARS = 200; //         عقد :1046-1048 [ح س-35] — سقف نصّ السبب

// ─── الوحدة: v[8]/v[9] والمقاطع (عقد ت-19 :659-673؛ س-19 :952-958) ────────
const THROUGHPUT_UNIT_MIB_PER_S = 'MiB/s';
// س-19 المصحَّح: «1.0.9 و1.0.10 تُقرأ MiB/s، و1.0.8-v6beta تُعلن «الوحدة غير محدَّدة»» (عقد :840، :669).
const APP_VERSIONS_READ_AS_MIB_PER_S = Object.freeze(['1.0.9', '1.0.10']);
const APP_VERSION_UNIT_UNDETERMINED = '1.0.8-v6beta';
// أساس الوحدة التي يُخرجها القارئ (throughputUnit.basis): وسمٌ يقرؤه من يحسب بالوحدة، فمصدر واحد (القاعدة 24).
const THROUGHPUT_UNIT_BASIS = deepFreeze({
  DECLARED_IN_PAYLOAD: 'DECLARED_IN_PAYLOAD', //                    ≥ 68: الوحدة معلَنة في عمود v[8]/v[9] والمقاطع وتتّفق
  APP_VERSION_RULE: 'APP_VERSION_RULE', //                        < 68: 1.0.9 و1.0.10 ← MiB/s
  UNDETERMINED_NO_DECLARED_UNIT: 'UNDETERMINED_NO_DECLARED_UNIT', // ≥ 68 ولا وحدة معلَنة (شذوذ)
  DECLARED_UNITS_DISAGREE: 'DECLARED_UNITS_DISAGREE', //          ≥ 68 والوحدات المعلَنة تتناقض (شذوذ)
  UNDETERMINED_APP_VERSION_V6BETA: 'UNDETERMINED_APP_VERSION_V6BETA', // 1.0.8-v6beta: «الوحدة غير محدَّدة» (عقد :840، :669)
  UNDETERMINED_NO_APP_VERSION: 'UNDETERMINED_NO_APP_VERSION',
  UNDETERMINED_APP_VERSION_NOT_IN_RULE: 'UNDETERMINED_APP_VERSION_NOT_IN_RULE',
});

// ─── مفاتيح التذييل (footer) — الجديدة والمتغيّرة (عقد §٢.٢، §٧) ──────────
const FOOTER = deepFreeze({
  FIELDS_VERSION: 'fieldsVersion',
  CPU_TEMP_FINAL_C: 'cpuTempFinalC',
  CPU_TEMP_FINAL_SOURCE: 'cpuTempFinalSource',
  MAX_CPU_TEMP_LEGACY: 'maxCpuTemp', // يغادر في ≥ 68 (عقد ت-10 :517-526)
  THERMAL_HEADROOM_READINGS: 'thermalHeadroomReadings',
  THERMAL_HEADROOM_STATE: 'thermalHeadroomState',
  THERMAL_STATUS_EVENTS: 'thermalStatusEvents',
  THERMAL_STATUS_STATE: 'thermalStatusState',
  CPU_POLICIES: 'cpuPolicies',
  BATTERY_PAIRS: 'batteryPairs',
  BATTERY_PAIRS_STATE: 'batteryPairsState',
  CHANNEL_DISCOVERY: 'channelDiscovery',
  CHANNEL_READ_FAILURES: 'channelReadFailures',
  CHANNEL_READ_FAILURE_COUNTS: 'channelReadFailureCounts',
  TRANSITIONAL_AGGREGATES: 'transitionalAggregates',
  UNMEASURED_DEFAULTS: 'unmeasuredDefaults',
  PRE_SCAN_WARNINGS_STATE: 'preScanWarningsState',
  SCAN_STILLNESS: 'scanStillness',
  FIELDS_NOT_IN_FILE: 'fieldsNotInFile',
  FOOTER_DIAGNOSTICS: 'footerDiagnostics',
  BATTERY_HEALTH: 'batteryHealth',
  VERIFICATION_RESULTS: 'verificationResults',
});

const SCAN_STILLNESS = deepFreeze({
  STILLNESS_STATE: 'stillnessState',
  IS_STILL: 'isStill',
  ACCEL_STD_DEV: 'accelStdDev',
  SAMPLE_COUNT: 'sampleCount',
});

const BATTERY_PAIRS_STATE = deepFreeze({
  RECEIVER_REGISTERED: 'receiverRegistered',
  BROADCAST_COUNT: 'broadcastCount',
  DROPPED_BY_CAP: 'droppedByCap',
  INVALID_READS: 'invalidReads',
});

const BATTERY_PAIR_ELEMENT = deepFreeze({
  T: 't',
  VOLTAGE_RAW: 'voltageRaw',
  CURRENT_RAW: 'currentRaw',
  CHARGE_COUNTER_RAW: 'chargeCounterRaw',
  LEVEL_RAW: 'levelRaw',
  LEVEL_SCALE: 'levelScale',
  TEMP_RAW: 'tempRaw',
});

const THERMAL_HEADROOM_ELEMENT = deepFreeze({T: 't', HEADROOM: 'headroom', STATE: 'state'});
const THERMAL_STATUS_ELEMENT = deepFreeze({T: 't', STATUS: 'status'});

const CPU_POLICY_ELEMENT = deepFreeze({
  POLICY: 'policy',
  RELATED_CPUS: 'relatedCpus',
  CPUINFO_MAX_FREQ_KHZ: 'cpuinfoMaxFreqKhz',
  UNREADABLE_REASON: 'unreadableReason',
});

const CHANNEL_DISCOVERY = deepFreeze({
  ATTEMPTED: 'attempted',
  AVAILABLE: 'available',
  BLOCKED_BY_SELINUX: 'blockedBySelinux',
  MISSING: 'missing',
  REASONS: 'reasons',
});

// ─── batteryHealth (عقد ت-18 صفّ 9-10 :651-652؛ §٧-ب :1121؛ §٧-ج :1192-1193) ─
const BATTERY_HEALTH = deepFreeze({
  DESIGN_CAPACITY_MAH: 'designCapacityMah',
  CYCLE_COUNT: 'cycleCount',
  CYCLE_COUNT_SOURCE: 'cycleCountSource',
  CYCLE_COUNT_STATE: 'cycleCountState',
  CHARGE_COUNTER_UAH: 'chargeCounterUah',
  CHARGE_COUNTER_UAH_STATE: 'chargeCounterUahState',
  ENERGY_COUNTER_NWH: 'energyCounterNwh',
  ENERGY_COUNTER_NWH_STATE: 'energyCounterNwhState',
  // مؤشّر → مفتاح حالته. القيمة تغيب حين لا تُحسب، ويبقى مفتاح الحالة حاضراً (عقد ت-18 :651).
  INDICATORS: {
    dischargeRateUnderLoadMa: 'dischargeRateUnderLoadMaState',
    voltageStabilityMv: 'voltageStabilityMvState',
    dischargeVsDesignRatioMah: 'dischargeVsDesignRatioMahState',
    batteryTempRiseC: 'batteryTempRiseCState',
    levelDropPct: 'levelDropPctState',
  },
});

// ─── verificationResults (عقد ت-13 :552-558؛ ت-16 :605-619؛ ت-17 :621-635؛ ت-18 :637-657؛ ت-20 :675-684) ──
const VERIFICATION = deepFreeze({
  // محذوفة أو لا تعود بدلالة جديدة في fv68 — تُقرأ إن وصلت (حمولات أقدم) وإلا تُعلَن غائبة.
  CPU_FMA_ERRORS_LEGACY: 'cpuFmaErrors',
  CPU_PRIME_SIEVE_CORRECT_LEGACY: 'cpuPrimeSieveCorrect',
  MEMORY_MARCH_PASSED_LEGACY: 'memoryMarchPassed',
  MEMORY_WALKING_ONES_PASSED_LEGACY: 'memoryWalkingOnesPassed',
  STORAGE_SLC_CACHE_SIZE_MB_REMOVED: 'storageSlcCacheSizeMb', // محذوف (ت-08 :509-511)
  // ذاكرة
  MEMORY_VERIFY_STATE: 'memoryVerifyState',
  MEMORY_MARCH_ERRORS: 'memoryMarchErrors',
  MEMORY_WALKING_ONES_ERRORS: 'memoryWalkingOnesErrors',
  MEMORY_RANDOM_VERIFY_ERRORS: 'memoryRandomVerifyErrors',
  MEMORY_VERIFY_BYTES: 'memoryVerifyBytes',
  MEMORY_VERIFY_BUFFER_BYTES: 'memoryVerifyBufferBytes',
  MEMORY_VERIFY_TIME_CAP_MS: 'memoryVerifyTimeCapMs',
  MEMORY_VERIFY_DURATION_MS: 'memoryVerifyDurationMs',
  MEMORY_VERIFY_FREE_BYTES: 'memoryVerifyFreeBytes',
  MEMORY_TESTED_BYTES: 'memoryTestedBytes',
  MEMORY_PHASE_WINDOWS: 'memoryPhaseWindows',
  // تخزين
  STORAGE_VERIFY_STATE: 'storageVerifyState',
  STORAGE_VERIFY_METHOD: 'storageVerifyMethod',
  STORAGE_VERIFY_BYTES_COMPARED: 'storageVerifyBytesCompared',
  STORAGE_VERIFY_BYTES_PLANNED: 'storageVerifyBytesPlanned',
  STORAGE_VERIFY_DURATION_MS: 'storageVerifyDurationMs',
  STORAGE_WRITE_VERIFY_ERRORS: 'storageWriteVerifyErrors',
  STORAGE_READ_VERIFY_ERRORS: 'storageReadVerifyErrors',
  STORAGE_THROUGHPUT_SEGMENTS: 'storageThroughputSegments',
  STORAGE_THROUGHPUT_SEGMENTS_UNIT: 'storageThroughputSegmentsUnit',
  // رسوميات وعيب حرج
  GPU_COMPUTE_GEMM_CORRECT: 'gpuComputeGemmCorrect',
  GPU_COMPUTE_GEMM_STATE: 'gpuComputeGemmState',
  // تجزئة الشظايا ومهلة السياج (S-B5a، 2026-10-21): مفاتيح قائمة في كل حمولة (عيّنات fv67 الحقيقية وحمولات fv71 من المُنتِج)؛ عقد fv68 يذكرها بقيم افتراضية 0/0 و0 «لا تميّز لم يُنفَّذ من 0 من 0» (docs/FV68_CONTRACT.md :249، :261)
  // — فيقرؤها القارئ بحالتها ولا يُقرأ الصفر سلامةً. تقوم عليها بوّابة GPU_HASH_MISMATCH (advisoryLetters.js، P5 :148 :177).
  GPU_FRAGMENT_HASH_MATCHES: 'gpuFragmentHashMatches',
  GPU_FRAGMENT_HASH_TOTAL: 'gpuFragmentHashTotal',
  GPU_FENCE_TIMEOUT_COUNT: 'gpuFenceTimeoutCount',
  CRITICAL_DEFECT_DETECTED: 'criticalDefectDetected',
  CRITICAL_DEFECT_INPUTS_NOT_RUN: 'criticalDefectInputsNotRun',
  // تثبيت العمّال
  WORKERS_PIN_STATE: 'workersPinState',
  WORKERS_PINNED: ['workersPinnedBig', 'workersPinnedMid', 'workersPinnedLittle'],
  WORKERS_PIN_FAILED: ['workersPinFailedBig', 'workersPinFailedMid', 'workersPinFailedLittle'],
  // معالج: نتيجة معروفة مسبقاً (ت-20)
  CPU_KNOWN_ANSWER_STATE: 'cpuKnownAnswerState',
  CPU_KNOWN_ANSWER_RUNS: 'cpuKnownAnswerRuns',
  CPU_KNOWN_ANSWER_TOTAL_MS_BY_PHASE: 'cpuKnownAnswerTotalMsByPhase',
  // مندوب الذكاء
  AI_ACTIVE_DELEGATE: 'aiActiveDelegate',
  AI_DELEGATE_INIT_ERROR: 'aiDelegateInitError', // يغيب لا `""` (ت-18 صفّ 12 :654)
});

const MEMORY_PHASE_WINDOW_ELEMENT = deepFreeze({NAME: 'name', START_MS: 'startMs', END_MS: 'endMs'});

const CPU_KNOWN_ANSWER_RUN_ELEMENT = deepFreeze({
  PHASE: 'phase',
  PLANNED_AT_PCT: 'plannedAtPct',
  T: 't',
  T_END: 'tEnd',
  SIEVE_STATUS: 'sieveStatus',
  SIEVE_LIMIT: 'sieveLimit', // fv70: N الذي شغّله الغربال فعلاً؛ يُشحن مع حالات الغربال في SIEVE_STATUS_KINDS_CARRYING_LIMIT (match وmismatch وalloc_failed وnative_status_unknown:*)، ويغيب مع native_call_failed وnative_result_unreadable وnot_reached وskipped:time_budget وcancelled
  SIEVE_PRIME_COUNT: 'sievePrimeCount',
  SIEVE_DURATION_MS: 'sieveDurationMs',
  SHA256_STATUS: 'sha256Status',
  SHA256_DURATION_MS: 'sha256DurationMs',
});

// المرجع π(N) بحسب N الذي شغّله الغربال — **لا بثابت واحد** (أمر المنسّق 2026-10-13: «المرجع π(N) بحسب sieveLimit، لا بثابت»؛ منقول من §٧-ط، غير متحقَّق من المستودع المصدر):
//   N = 1000000  ⟵ 78498  (التطبيق اليوم، fv70)
//   N = 10000000 ⟵ 664579 (ختم 68 و69 بلا sieveLimit: فيهما N = SIEVE_LIMIT_WHEN_ABSENT_FV68_69؛ والمرجع 664,579 مذكور في عقد التطبيق §٧-ج «reference_values.h» — docs/FV68_CONTRACT.md)
// القيمتان رياضيتان (عدد الأوّليات ≤ N) ويُعاد حسابهما بغربال مستقلّ في test/cpuKnownAnswerFv70.test.js. N غير المعدود هنا ⟵ لا مرجع (null) ويُعلَن، لا يُخمَّن.
const SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT = deepFreeze({1000000: 78498, 10000000: 664579});
// N حين لا يحمل العنصر sieveLimit في ختم 68 و69 (§٧-ط: «وختم 68 و69 بلا sieveLimit: فيهما N = 10000000»). **لا يُطبَّق على ختم ≥ 70** (هناك الغياب شذوذ مُعلَن) **ولا على ختم أقدم/مجهول** (لا مرجع).
const SIEVE_LIMIT_WHEN_ABSENT_FV68_69 = 10000000;

// ─── السلسلة الزمنية (timeSeries) ─────────────────────────────────────
const TIME_SERIES = deepFreeze({
  HEADER: 'header',
  FOOTER: 'footer',
  SAMPLES: 'samples',
  VARIABLES: 'variables',
  TIME_SERIES_STATE: 'timeSeriesState', // دائم الحضور (عقد §٧-ب بند 5 :1139)
});

const HEADER = deepFreeze({APP_VERSION: 'appVersion', ANDROID_API_LEVEL: 'androidApiLevel'});

// ─── نتائج الاختبارات: measurements (عقد ت-11 :528-538؛ ت-14 :560-570؛ ت-15 :572-603؛ §٧-ب بند 7-8 :1141-1142) ──
const MEASUREMENTS_KEY = 'measurements';
const MEASUREMENTS_UNENCODABLE_KEY = 'measurementsUnencodable'; // §٧ بند 5 :1095 «في خريطة measurements نفسها»
const MEASUREMENTS_UNREADABLE_KEY = 'measurementsUnreadable';
// معرّفات الاختبارات التي يعرف العقد شكل measurements لها (عقد: L-02 :528، SN-08/SN-09 :1142، M-02 :591).
const MEASURED_TEST_IDS = deepFreeze({GPS_SATELLITES: 'L-02', STEP_SENSOR_A: 'SN-08', STEP_SENSOR_B: 'SN-09', TOUCH_GRID: 'M-02'});
const L02_MEASUREMENT_KEYS = deepFreeze({
  VISIBLE_SATELLITES: 'visibleSatellites',
  USED_SATELLITES: 'usedSatellites',
  SATELLITE_STATUS_CALLBACKS: 'satelliteStatusCallbacks',
  TIME_TO_FIRST_FIX_MS: 'timeToFirstFixMs',
  LOCATION_UPDATE_COUNT: 'locationUpdateCount',
  GPS_PROVIDER_ENABLED: 'gpsProviderEnabled',
  GNSS_CALLBACK_STATE: 'gnssCallbackState',
  LOCATION_UPDATES_STATE: 'locationUpdatesState',
  TIME_TO_FIRST_FIX_STATE: 'timeToFirstFixState',
});
const STEP_SENSOR_MEASUREMENT_KEYS = deepFreeze({WINDOW_MS: 'windowMs', READINGS: 'readings'});
// M-02 (شبكة اللمس): الخامّ بعد fv69 — عقد §٧-ح (ب) (docs/FV68_CONTRACT.md:1463-1473، نسخة a04b4f0).
//   elapsedMs: **من أوّل لمسة** إلى نهاية التشغيل (قرار المستخدم 2026-10-10)، **غائب** إن لم تقع لمسة.
//   timeToFirstTouchMs [م]: من فتح الحوار إلى أوّل لمسة، **غائب** إن لم تقع لمسة. لم يوجد قبل fv69.
const TOUCH_GRID_MEASUREMENT_KEYS = deepFreeze({
  GRID_COLS: 'gridCols', GRID_ROWS: 'gridRows', TOUCHED_CELLS: 'touchedCells', TOTAL_CELLS: 'totalCells',
  ELAPSED_MS: 'elapsedMs', TIME_TO_FIRST_TOUCH_MS: 'timeToFirstTouchMs', END_REASON: 'endReason', MAX_SIMULTANEOUS_POINTERS: 'maxSimultaneousPointers',
});
// endReason: القيم الأربع كما كتبها التطبيق (عقد N-19؛ §٧-ح (ب) :1472، :1475). مصدر واحد (القاعدة 24).
//   auto_complete ⇒ pass · user_marked_not_working ⇒ fail · user_marked_not_tested ⇒ not_tested · dismissed ⇒ لا حالة جديدة (تبقى حالة سابقة أو not_tested).
//   (الخادم لا يستنتج الحالة منها هنا: يقرأ القيمة ويُعلن إن خرجت عن الأربع.)
const TOUCH_GRID_END_REASON = deepFreeze({
  AUTO_COMPLETE: 'auto_complete',
  USER_MARKED_NOT_WORKING: 'user_marked_not_working',
  USER_MARKED_NOT_TESTED: 'user_marked_not_tested',
  DISMISSED: 'dismissed',
});
// هل وقعت لمسة؟ — يُشتقّ من touchedCells (عقد :1470: «touchedCells = 0 يعلن السبب»). **اسم خادم**، لا يُكتب على السلك.
const TOUCH_GRID_TOUCH_STATE = deepFreeze({
  TOUCHED: 'TOUCHED', //                                   touchedCells > 0
  NO_TOUCH: 'NO_TOUCH', //                                 touchedCells = 0 — يشرح غياب elapsedMs وtimeToFirstTouchMs
  UNDETERMINED_NO_TOUCHED_CELLS_COUNT: 'UNDETERMINED_NO_TOUCHED_CELLS_COUNT', // touchedCells غائب أو بنوع خاطئ: لا حكم
});
// أساس elapsedMs: دلالته تغيّرت بين الإصدارين (قرار المستخدم 2026-10-10) — من يقارن زمنين من إصدارين مختلفين يقرأ هذا الوسم أوّلاً. **اسم خادم**.
const TOUCH_GRID_ELAPSED_BASIS = deepFreeze({
  FROM_FIRST_TOUCH: 'FROM_FIRST_TOUCH', //                           ≥ 69: من أوّل لمسة (عقد :1470)
  UNDETERMINED_BEFORE_FV69: 'UNDETERMINED_BEFORE_FV69', //           ≤ 68: العقد كتب «من أول لمسة؟ أم من فتح الشبكة؟ ينتظر تأكيداً» (عقد :592 قبل الحسم)؛ ولم يُشحن fv68 في أيّ APK
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION', // لا ختم في الحمولة
});

// ═══ fv71 — M-02 الشبكة الجديدة بالخامّ (الخيار ب) ═══════════════════════════════════════════════════════════════════
// المصدر الحاكم: docs/FV71_CONTRACT_SECTION.md (عقد التطبيق §٧-ي، ف-01 إلى ف-03 وE18 وE19 وE21) — **نسخة قسم، لا الملفّ كلّه**؛ وتصميم M-02 (design-m02-touch-grid-2026-10-13.md في مساحة العمل: §3 §6.3 §6.6)
// حيث لا يقول القسم. ما سمّاه القسم وسمه [م] («مقترح، للاعتماد») يُقرأ بوسمه؛ وما سمّيتُه أنا (أسماء داخلية لا تُكتب على السلك) موسوم «اسم خادم».

// أساس الشبكة — يُحسب من **الختم وحده** (القسم ف-01: «FIXED_8X15 لكل ختم < 71، وMM_TARGET لكل ختم ≥ 71»)، لا من gridCols/gridRows. على طريقة elapsedMsBasis. **اسم خادم** (design §6.6 [م]).
// «لا تجوز مقارنة رقمين من إصدارين (touchedCells · totalCells) إلا بعد قراءة gridBasis» (القسم ف-01؛ design §6.7).
const TOUCH_GRID_GRID_BASIS = deepFreeze({
  FIXED_8X15: 'FIXED_8X15', //                                     ختم < 71 (ومنه 70): TouchGridRecorder.kt:35-36 شبكة 8×15 ثابتة (القسم «الحال اليوم»)
  MM_TARGET: 'MM_TARGET', //                                       ختم ≥ 71: الخليّة مستهدفة بالملّيمتر (cellTargetMm)؛ gridCols/gridRows تُشتقّان من السطح
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION', // لا ختم في الحمولة: لا يُفترَض أيّ من الأساسين
});
// أبعاد الشبكة الثابتة لكل ختم < 71 (TouchGridRecorder.kt:35-36 [ك] في القسم «الحال اليوم»؛ عقد §٧-ح (ب): 8 و15). القارئ يطابقها بأساس FIXED_8X15 ويُعلن التناقض، **ولا يشتقّ الأساس منها**.
const TOUCH_GRID_FIXED_DIMENSIONS = deepFreeze({COLS: 8, ROWS: 15});
// حالة M-02 اليدوية `pass`: تُقرأ بعد fv71 فتُعلَن إن غاب measurements (الكود الوحيد في الخادم الذي يحتاج هذه القيمة؛ عقد §٧-ح (ب): endReason ↔ الحالة).
const MANUAL_STATUS_PASS = 'pass';
// جواب M-02 اليدوي وعلاقته بالخامّ (القاعدة 22: الغياب حالة صريحة في أعلى المخرَج لا خطأ ولا صفر ولا اكتمال مفترَض). **اسم خادم**.
// **السبب (أمر المنسّق 2026-10-18 +03، منقول عن NeuralChek@5f90ce1 — منقول، غير متحقَّق من مستودعي):** نقرة «يعمل» على M-02 صارت تكتب `pass` مباشرةً بلا فتح الشبكة؛ فـM-02 = pass **بلا measurements**
// (أو بخامّ محفوظ من قياس سابق: E21-٣ المعتمد 2026-10-15 «نقرة الشريحة لا تمحو الخامّ المكتمل»، والتطبيق طبّقه لـ«يعمل» وحدها) **حالة مشروعة** من أجهزة ختم 70 وما بعده، لا عطب.
// القارئ لا يستنتج الحالة من endReason («ولا يستنتج القارئ الحالة من endReason (قد يختلفان)» — القسم E21-٣): الحالة على الصفّ جواب الفنّي، والخامّ دليل قد لا يسنده.
const TOUCH_GRID_ANSWER_STATE = deepFreeze({
  NOT_IN_MANUAL_RESULTS: 'NOT_IN_MANUAL_RESULTS', //     لا صفّ M-02 في manualResults
  PASS_WITHOUT_RAW: 'PASS_WITHOUT_RAW', //               status = pass ولا measurements: جواب بنقرة بلا دليل شبكة (مشروع بعد 5f90ce1)
  OTHER_STATUS_WITHOUT_RAW: 'OTHER_STATUS_WITHOUT_RAW', // حالة أخرى (أو غير مقروءة) ولا measurements: نقرة شريحة بلا فتح الحوار
  RAW_UNREADABLE: 'RAW_UNREADABLE', //                   measurements حاضر بنوع لا يطابق العقد (يُعلَن شذوذاً في مكانه)
  RAW_PRESENT: 'RAW_PRESENT', //                         measurements حاضر ومقروء: يُقرأ في touchGrid
});
// هل يسند الخامّ المحفوظ جوابَ pass؟ لـ pass وحده (حالات أخرى: لا مقارنة — الحالة جواب الفنّي والخامّ يحمل endReason خاصّاً به). **اسم خادم**.
const TOUCH_GRID_PASS_RAW_RELATION = deepFreeze({
  BACKS_PASS: 'BACKS_PASS', //                                         endReason = auto_complete (الطريق الوحيد إلى pass قبل 5f90ce1)
  DOES_NOT_BACK_PASS: 'DOES_NOT_BACK_PASS', //                         endReason معروف غير auto_complete: خامّ من قياس سابق (أو لا يطابق الجواب) — لا يُقرأ دليلاً على اكتمال
  UNDETERMINED_NO_END_REASON: 'UNDETERMINED_NO_END_REASON', //         endReason غائب أو بنوع خاطئ أو غير معروف: لا حكم
  NOT_APPLICABLE_STATUS_NOT_PASS: 'NOT_APPLICABLE_STATUS_NOT_PASS',
  NOT_APPLICABLE_NO_RAW: 'NOT_APPLICABLE_NO_RAW',
});
// حالة علامات العرض `displayedSuspects` (القسم ف-03، E21-٢): المفتاح غائب = لم تُعرض علامات؛ حاضر و[] = عُرضت ولم تُرَ مواضع. **اسم خادم**.
const TOUCH_PATH_DISPLAYED_STATE = deepFreeze({NOT_DISPLAYED: 'NOT_DISPLAYED', DISPLAYED_NONE: 'DISPLAYED_NONE', DISPLAYED: 'DISPLAYED'});
// ما قرأه القارئ من مفاتيح ف-02/ف-03 الجديدة في M-02: كتلة touchGrid.path. **اسم خادم**.
const TOUCH_PATH_STATE = deepFreeze({
  NOT_IN_FIELDS_VERSION: 'NOT_IN_FIELDS_VERSION', //               ختم < 71: المفاتيح لم توجد بعد (غيابها هو الحال، لا شذوذ؛ وحضورها شذوذ: TOUCH_PATH_KEYS_PRESENT_BEFORE_FV71)
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION', // لا ختم: لا حكم بأنها «لم توجد بعد»
  READ: 'READ', //                                                 ختم ≥ 71: المفاتيح مقروءة، كلّ بحالته
});
// مفاتيح measurements لـM-02 الجديدة في fv71 (القسم ف-02 وف-03). الأسماء اسم وكيل التصميم في وثيقة معتمدة [ن] (القسم ف-02)، ما عدا N71-01 وN71-02 فهما [م] أدناه.
const TOUCH_PATH_MEASUREMENT_KEYS = deepFreeze({
  SURFACE_WIDTH_PX: 'surfaceWidthPx', SURFACE_HEIGHT_PX: 'surfaceHeightPx', SURFACE_ORIGIN_X_PX: 'surfaceOriginXPx', SURFACE_ORIGIN_Y_PX: 'surfaceOriginYPx',
  DISPLAY_WIDTH_PX: 'displayWidthPx', DISPLAY_HEIGHT_PX: 'displayHeightPx', MODE_PHYSICAL_WIDTH_PX: 'modePhysicalWidthPx', MODE_PHYSICAL_HEIGHT_PX: 'modePhysicalHeightPx',
  XDPI: 'xdpi', YDPI: 'ydpi', DENSITY_DPI: 'densityDpi', PX_PER_MM: 'pxPerMm', DENSITY_SOURCE: 'densitySource', DENSITY_CHECK: 'densityCheck',
  CELL_TARGET_MM: 'cellTargetMm', CELL_WIDTH_PX: 'cellWidthPx', CELL_HEIGHT_PX: 'cellHeightPx',
  UNTOUCHED_CELLS: 'untouchedCells', CUTOUT_CELLS: 'cutoutCells',
  GESTURE_INSETS_PX: 'gestureInsetsPx', MANDATORY_GESTURE_INSETS_PX: 'mandatoryGestureInsetsPx', EXCLUSION_RECTS_PX: 'exclusionRectsPx',
  SYSTEM_BARS_HIDDEN: 'systemBarsHidden', CUTOUT_RECTS_PX: 'cutoutRectsPx', ROUNDED_CORNER_RADII_PX: 'roundedCornerRadiiPx', ROUNDED_CORNERS_STATE: 'roundedCornersState',
  ABSENT_FIELD_REASONS: 'absentFieldReasons', // N71-01 [م]: خريطة اسم الحقل ← سبب غيابه، حاضرة فقط حين غاب حقل واحد على الأقلّ
  STROKES: 'strokes', UNBUFFERED_DISPATCH: 'unbufferedDispatch', RESAMPLED_FLAG_STATE: 'resampledFlagState', DISPLAYED_SUSPECTS: 'displayedSuspects',
  PATH_CAP: 'pathCap', // N71-02 [م]: {maxPoints, reached, pointsDropped}
});
// حضور كل مفتاح (القسم ف-02/ف-03، «الغياب · ما يُعلنه القارئ»):
//   ALWAYS             «حاضر دائماً» في خامّ ختم ≥ 71 ⇒ غيابه شذوذ (TOUCH_PATH_REQUIRED_KEY_ABSENT) بحالة ABSENT.
//   REASONED           غيابه مشروع **بسببه** في absentFieldReasons (api_below_<n> · read_failed:<نصّ> · not_reported_by_device) ⇒ ABSENT_DECLARED؛ وبلا مدخل ⇒ شذوذ (TOUCH_PATH_ABSENT_WITHOUT_REASON) بحالة ABSENT
//                      (القسم N71-01: «مفتاح غائب بلا مدخل في absentFieldReasons ⇒ شذوذ يُعلنه القارئ»).
//   BY_DESIGN_OPTIONAL غيابه حالة بذاتها لا شذوذ: displayedSuspects («المفتاح غائب ⇒ لم تُعرض علامات») وabsentFieldReasons («حاضرة فقط حين غاب حقل»).
//   ONE_OF_PAIR        roundedCornerRadiiPx أو roundedCornersState: «أحدهما حاضر دائماً» (القسم ف-02).
// حضور xdpi/ydpi/densityDpi/pxPerMm/densitySource: كان القسم (نسخة 0af0b5c) لا يحدّده فعوملت REASONED (الأقلّ افتراضاً). **تغيّر في مزامنة fv71 (2026-10-18):** قسم NeuralChek@f9e0571 («حالة التنفيذ ← absentFieldReasons») يعدّد
// أسماء الحقول التي قد تغيب بسببها — displayWidthPx · displayHeightPx · modePhysicalWidthPx · modePhysicalHeightPx · gestureInsetsPx · mandatoryGestureInsetsPx · exclusionRectsPx · systemBarsHidden · cutoutRectsPx · unbufferedDispatch
// وstrokes.touchMajorPx — **وليس بينها مفاتيح الكثافة الخمسة**، وعيّنات المُنتِج الثلاث تحملها كلّها: فهي ALWAYS الآن (غيابها شذوذ، وسبب غياب لها شذوذ «سبب لمفتاح لا يغيب»). unbufferedDispatch يبقى REASONED (مسمّى في القائمة).
const TOUCH_PATH_PRESENCE = deepFreeze({ALWAYS: 'ALWAYS', REASONED: 'REASONED', BY_DESIGN_OPTIONAL: 'BY_DESIGN_OPTIONAL', ONE_OF_PAIR: 'ONE_OF_PAIR'});
const TOUCH_PATH_FIELD_SPEC = (() => {
  const M = TOUCH_PATH_MEASUREMENT_KEYS;
  const A = TOUCH_PATH_PRESENCE.ALWAYS;
  const R = TOUCH_PATH_PRESENCE.REASONED;
  const spec = {};
  for (const k of [M.SURFACE_WIDTH_PX, M.SURFACE_HEIGHT_PX, M.SURFACE_ORIGIN_X_PX, M.SURFACE_ORIGIN_Y_PX]) spec[k] = {type: 'int', presence: A};
  for (const k of [M.DISPLAY_WIDTH_PX, M.DISPLAY_HEIGHT_PX, M.MODE_PHYSICAL_WIDTH_PX, M.MODE_PHYSICAL_HEIGHT_PX]) spec[k] = {type: 'int', presence: R};
  spec[M.DENSITY_DPI] = {type: 'int', presence: A};
  for (const k of [M.XDPI, M.YDPI, M.PX_PER_MM]) spec[k] = {type: 'number', presence: A};
  spec[M.DENSITY_SOURCE] = {type: 'string', presence: A};
  spec[M.DENSITY_CHECK] = {type: 'array', presence: A};
  for (const k of [M.CELL_TARGET_MM, M.CELL_WIDTH_PX, M.CELL_HEIGHT_PX]) spec[k] = {type: 'number', presence: A};
  for (const k of [M.UNTOUCHED_CELLS, M.CUTOUT_CELLS]) spec[k] = {type: 'array', presence: A};
  for (const k of [M.GESTURE_INSETS_PX, M.MANDATORY_GESTURE_INSETS_PX]) spec[k] = {type: 'object', presence: R};
  for (const k of [M.EXCLUSION_RECTS_PX, M.CUTOUT_RECTS_PX]) spec[k] = {type: 'array', presence: R};
  spec[M.SYSTEM_BARS_HIDDEN] = {type: 'boolean', presence: R};
  spec[M.ROUNDED_CORNER_RADII_PX] = {type: 'object', presence: TOUCH_PATH_PRESENCE.ONE_OF_PAIR};
  spec[M.ROUNDED_CORNERS_STATE] = {type: 'string', presence: TOUCH_PATH_PRESENCE.ONE_OF_PAIR};
  spec[M.ABSENT_FIELD_REASONS] = {type: 'object', presence: TOUCH_PATH_PRESENCE.BY_DESIGN_OPTIONAL};
  spec[M.STROKES] = {type: 'array', presence: A};
  spec[M.UNBUFFERED_DISPATCH] = {type: 'boolean', presence: R};
  spec[M.RESAMPLED_FLAG_STATE] = {type: 'string', presence: A};
  spec[M.DISPLAYED_SUSPECTS] = {type: 'array', presence: TOUCH_PATH_PRESENCE.BY_DESIGN_OPTIONAL};
  spec[M.PATH_CAP] = {type: 'object', presence: A};
  return deepFreeze(spec);
})();
// ═══ fv71 — M-02 «إطار + X»: المجموعة المطلوبة جزء من الشبكة (2026-10-21 +03) ═══════════════════════════════════════════════════════════
// المصدر الحاكم: الحاشية «تحديث 2026-10-21 (أمر وكيل التطبيق ٨)» في docs/FV71_CONTRACT_SECTION.md، وعقد السلك الواحد (wire-m02-frame-x-2026-10-21.md، البنود 1–8) منقولاً فيها بحرفه.
// المفتاحان جديدان في `manualResults[M-02].measurements`؛ **ليسا في TOUCH_PATH_FIELD_SPEC عمداً**: غيابهما معاً تحت ختم ≥ 71 **ليس شذوذاً** (بناء الجولة 324578f وما قبله لم يكتبهما)
// بل حالة صريحة NOT_DECLARED (القاعدة 22، البند 7)، وحضورهما تحت ختم < 71 شذوذ (القاعدة 25، البند 8). فلا يصلحان لحضور ALWAYS ولا REASONED.
// القاعدة 24: الاسمان وقيمتا النمط مصدرهما هنا وحده؛ **هندسة النمط (الإطار والقطران) للتطبيق وحده** — الخادم لا ينسخها ويتحقّق من حدّ أدنى بسيط (FRAME_CELL_NOT_REQUIRED).
const TOUCH_GRID_PATTERN_KEYS = deepFreeze({GRID_PATTERN: 'gridPattern', NOT_REQUIRED_CELLS: 'notRequiredCells'});
// قيمتا gridPattern على السلك (البند: «نصّ، قيمتان»). التطبيق الجديد يكتب FRAME_AND_DIAGONALS دائماً؛ ALL_CELLS = كل خلايا الشبكة عدا cutoutCells (notRequiredCells فيه [] دائماً).
const TOUCH_GRID_PATTERN = deepFreeze({ALL_CELLS: 'ALL_CELLS', FRAME_AND_DIAGONALS: 'FRAME_AND_DIAGONALS'});
// ما أعلنه التقرير عن المجموعة المطلوبة (touchGrid.path.gridPatternState، ختم ≥ 71 وحده). **اسم خادم**، لا يُكتب على السلك. تحت ختم < 71 لا حالة جديدة: كتلة path بحالتها (NOT_IN_FIELDS_VERSION / UNDETERMINED_NO_FIELDS_VERSION في TOUCH_PATH_STATE) وحضور المفتاحين شذوذ باسمه.
const TOUCH_GRID_PATTERN_STATE = deepFreeze({
  DECLARED: 'DECLARED', //                                           ختم ≥ 71: المفتاحان حاضران، gridPattern إحدى القيمتين وnotRequiredCells قائمة
  NOT_DECLARED: 'NOT_DECLARED', //                                   ختم ≥ 71: المفتاحان غائبان معاً — حالة لا شذوذ (بناء ≤ 324578f)؛ تبقى العلاقتان القديمتان (notRequiredCells ≡ ∅) وgridPattern «ALL_CELLS ضمناً» بحالة لا بقيمة
  INVALID_VALUE: 'INVALID_VALUE', //                                 gridPattern نصّ خارج القيمتين (شذوذ)
  WRONG_TYPE: 'WRONG_TYPE', //                                       أحد المفتاحين بنوع لا يطابق العقد (gridPattern ليس نصّاً أو notRequiredCells ليست قائمة): شذوذ WRONG_TYPE في مكانه
  ONE_KEY_ABSENT: 'ONE_KEY_ABSENT', //                                     مفتاح حاضر والآخر غائب (التطبيق يكتبهما معاً دائماً): شذوذ — لا يُقرأ نمطاً ولا يُفترض أحدهما
});
// أساس «المطلوب» الذي طُبِّقت عليه علاقة totalCells (touchGrid.path.requiredCellsBasis). **اسم خادم.**
const TOUCH_GRID_REQUIRED_CELLS_BASIS = deepFreeze({
  NOT_REQUIRED_CELLS_DECLARED: 'NOT_REQUIRED_CELLS_DECLARED', //                  المطلوب = الشبكة − cutoutCells − notRequiredCells (كما شحنها التطبيق)
  ALL_NON_CUTOUT_PATTERN_NOT_DECLARED: 'ALL_NON_CUTOUT_PATTERN_NOT_DECLARED', //  NOT_DECLARED: المطلوب = الشبكة − cutoutCells (العلاقة القديمة)
  UNDETERMINED_PATTERN_NOT_READABLE: 'UNDETERMINED_PATTERN_NOT_READABLE', //      نوع خاطئ أو نمط ناقص: لا مجموعة مطلوبة تُحسب منها علاقة (الشذوذ في مكانه)
});
// الشذوذ الجديد لـ«إطار + X» (أسماء خادم، تُعلَن في anomalies بهذه الرموز). علاقات العقد الجديدة (البند 1–5) تُعلَن بأسماء جديدة، وتبقى أسماء العلاقات القديمة لما قبلها (NOT_DECLARED):
//   REQUIRED_CELLS_RELATION_BROKEN  totalCells ≠ gridCols × gridRows − |cutoutCells| − |notRequiredCells| (العلاقة 2) — تحت DECLARED وحدها؛ تحت NOT_DECLARED يبقى TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN
//   CUTOUT_NOT_REQUIRED_OVERLAP      فهرس في cutoutCells وnotRequiredCells معاً (العلاقة 1: منفصلتان)
//   UNTOUCHED_CELL_NOT_REQUIRED      فهرس في untouchedCells وهو مقصوص أو غير مطلوب (العلاقة 4: «لا تحوي مقصوصة ولا غير مطلوبة»)
//   FRAME_CELL_NOT_REQUIRED          خلية من الصفّ الأول/الأخير أو العمود الأول/الأخير في notRequiredCells (حدّ الخادم الأدنى، البند 6) — تحت FRAME_AND_DIAGONALS
//   ALL_CELLS_WITH_NOT_REQUIRED      gridPattern = ALL_CELLS وnotRequiredCells غير فارغة («فارغة [] لـALL_CELLS»)
//   VALUE_INVALID                    gridPattern خارج القيمتين (البند 7)
//   KEYS_INCOMPLETE                  أحد المفتاحين حاضر والآخر غائب
//   KEYS_PRESENT_BEFORE_FV71         حضور أيّ منهما تحت ختم < 71 (البند 8؛ النمط نفسه SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71)
// فهرس خلية خارج [0، cols×rows) أو غير صحيح في notRequiredCells يُعلَن بالرمز القائم TOUCH_GRID_CELL_INDEX_INVALID (المفتاح في التفصيل) — لا اسم ثانٍ لدلالة واحدة.
const TOUCH_GRID_PATTERN_ANOMALY = deepFreeze({
  REQUIRED_CELLS_RELATION_BROKEN: 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN',
  CUTOUT_NOT_REQUIRED_OVERLAP: 'TOUCH_GRID_CUTOUT_NOT_REQUIRED_OVERLAP',
  UNTOUCHED_CELL_NOT_REQUIRED: 'TOUCH_GRID_UNTOUCHED_CELL_NOT_REQUIRED',
  FRAME_CELL_NOT_REQUIRED: 'TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED',
  ALL_CELLS_WITH_NOT_REQUIRED: 'TOUCH_GRID_PATTERN_ALL_CELLS_WITH_NOT_REQUIRED',
  VALUE_INVALID: 'TOUCH_GRID_PATTERN_VALUE_INVALID',
  KEYS_INCOMPLETE: 'TOUCH_GRID_PATTERN_KEYS_INCOMPLETE',
  KEYS_PRESENT_BEFORE_FV71: 'TOUCH_GRID_PATTERN_KEYS_PRESENT_BEFORE_FV71',
});
// ═══ fv71 — أزرار الصوت M-09/M-10: أحداث المفاتيح الخامّة (S-VOL، 2026-10-18 +03) ════════════════════════════════════════════════════════
// المصدر الحاكم: docs/FV71_CONTRACT_SECTION.md ف-04 («أزرار الصوت M-09/M-10: أحداث المفاتيح مع الخامّ»، E22). قرار المستخدم 2026-10-14 (`NEURALCHECK-FINDINGS.md:9453` بنصّه في أمر المنسّق): «Station 2, fv71, with raw (Recommended)».
// **الأسماء [م] «مقترحة، تنتظر إقرار المنسّق» (VK:191) — لم تُقرّ بعد** (القسم ف-04 بنصّه): تُقرأ بوسمها عند كاتبها. **ما لا يحدّده القسم صراحةً معلّق ولا يُخمَّن** (٧.٤ من docs/FV68_READERS_INVENTORY.md):
//   • أيّ الاختبارين M-09 وM-10 رفع الصوت وأيّهما خفضه (القسم يقول فقط expectedKeyCode ∈ {24، 25}).
//   • نوع `flags` وشكله (القسم: «FLAG_FROM_SYSTEM على العنصر أو الخامّ»).
//   • معنى expectedDownCount (أيعدّ تكرار المفتاح repeat > 0؟) وotherKeyDownCount (أيعدّ غير الصوت؟) — فلا يُفرض تطابقهما مع events[].
//   • أيّ جهاز يحمل `source` (بتّات InputDevice): عدد صحيح بلا تفسير.
const VOLUME_BUTTON_TEST_IDS = Object.freeze(['M-09', 'M-10']);
const VOLUME_BUTTON_MEASUREMENT_KEYS = deepFreeze({
  EXPECTED_KEY_CODE: 'expectedKeyCode', EVENTS: 'events', EVENTS_TOTAL: 'eventsTotal', TIME_TO_FIRST_EXPECTED_DOWN_MS: 'timeToFirstExpectedDownMs',
  EXPECTED_DOWN_COUNT: 'expectedDownCount', OTHER_KEY_DOWN_COUNT: 'otherKeyDownCount', HOLD_MS: 'holdMs', WINDOW_MS: 'windowMs', END_REASON: 'endReason',
  FLAGS: 'flags', DETECTION_SOURCE: 'detectionSource', VOLUME_STREAM_MAX: 'volumeStreamMax', VOLUME_LEVEL_AT_OPEN: 'volumeLevelAtOpen', VOLUME_LEVEL_AT_END: 'volumeLevelAtEnd',
});
// حضور كل مفتاح (القسم ف-04، «الغياب · ما يُعلنه القارئ»):
//   ALWAYS           «حاضر دائماً».
//   WHEN_EXPECTED_DOWN timeToFirstExpectedDownMs: «غائب إن لم يحدث ضغط مطلوب (قاعدة 22: لا صفر)» ⇒ غيابه مع expectedDownCount = 0 حالة معلنة، وعدمه مع expectedDownCount > 0 شذوذ، وحضوره مع 0 شذوذ.
//   WHEN_UP_RECEIVED holdMs: «غائب إن لم يصل up بعد ضغط مطلوب».
//   WHEN_AUTO_DETECTED detectionSource (N71-04): «غائب إن لم يكن endReason = auto_detected (لا قيمة افتراضية)».
//   OPTIONAL         flags («غائب إن لم يُقرأ»)، وvolumeStreamMax/volumeLevelAtOpen/volumeLevelAtEnd (N71-05: «غائبة إن فشلت قراءتها أو لم يكن maxVol ≥ 2؛ لا صفر»): غيابها حالة لا شذوذ، إلا حين يقوم عليها
//                    قرار الكشف (detectionSource = volume_level_change) فهي «مُدخلات قرار» لا غنى عنها (القاعدة 20) ⇒ غيابها شذوذ.
const VOLUME_BUTTON_PRESENCE = deepFreeze({
  ALWAYS: 'ALWAYS', WHEN_EXPECTED_DOWN: 'WHEN_EXPECTED_DOWN', WHEN_UP_RECEIVED: 'WHEN_UP_RECEIVED', WHEN_AUTO_DETECTED: 'WHEN_AUTO_DETECTED', OPTIONAL: 'OPTIONAL',
});
const VOLUME_BUTTON_FIELD_SPEC = (() => {
  const V = VOLUME_BUTTON_MEASUREMENT_KEYS;
  const P = VOLUME_BUTTON_PRESENCE;
  const spec = {};
  for (const k of [V.EXPECTED_KEY_CODE, V.EVENTS_TOTAL, V.EXPECTED_DOWN_COUNT, V.OTHER_KEY_DOWN_COUNT, V.WINDOW_MS]) spec[k] = {type: 'int', presence: P.ALWAYS};
  spec[V.EVENTS] = {type: 'array', presence: P.ALWAYS};
  spec[V.END_REASON] = {type: 'string', presence: P.ALWAYS};
  spec[V.TIME_TO_FIRST_EXPECTED_DOWN_MS] = {type: 'int', presence: P.WHEN_EXPECTED_DOWN};
  spec[V.HOLD_MS] = {type: 'int', presence: P.WHEN_UP_RECEIVED};
  spec[V.DETECTION_SOURCE] = {type: 'string', presence: P.WHEN_AUTO_DETECTED};
  spec[V.FLAGS] = {type: null, presence: P.OPTIONAL}; // النوع غير محدَّد في القسم (معلّق): يمرّ كما وصل بلا فحص نوع
  for (const k of [V.VOLUME_STREAM_MAX, V.VOLUME_LEVEL_AT_OPEN, V.VOLUME_LEVEL_AT_END]) spec[k] = {type: 'int', presence: P.OPTIONAL};
  return deepFreeze(spec);
})();
// KEYCODE_VOLUME_UP = 24 وKEYCODE_VOLUME_DOWN = 25 (القسم ف-04: «expectedKeyCode: 24 (KEYCODE_VOLUME_UP) أو 25 (KEYCODE_VOLUME_DOWN)»)
const VOLUME_BUTTON_KEY_CODE = deepFreeze({VOLUME_UP: 24, VOLUME_DOWN: 25});
// المفاتيح التي يسجّلها التطبيق في events[] (قسم NeuralChek@f9e0571، «حالة التنفيذ ← M-09/M-10»): «عائلة الصوت (24 · 25 · 164 كتم)؛ وغيرها (رجوع، طاقة…) يُهمَل» — فمفتاح خارجها في events[] شذوذ معلَن (القاعدة 25).
const VOLUME_BUTTON_EVENT_KEY_CODES = Object.freeze([24, 25, 164]);
// سقف events: 64 [م] (القسم ف-04: «سقف 64 [م: VK:193-202]»)؛ eventsTotal العدد قبل السقف، و«eventsTotal > 64 ⇒ قُصَّت القائمة، ويُعلنه القارئ».
const VOLUME_BUTTON_EVENTS_CAP = 64;
// عنصر events[]: {tMs, keyCode, action, repeat, deviceId, source} (tMs = eventTime − لحظة فتح النافذة، repeat = repeatCount، source = بتّات InputDevice)
const VOLUME_BUTTON_EVENT_KEYS = deepFreeze({T_MS: 'tMs', KEY_CODE: 'keyCode', ACTION: 'action', REPEAT: 'repeat', DEVICE_ID: 'deviceId', SOURCE: 'source'});
const VOLUME_BUTTON_EVENT_ACTION = deepFreeze({DOWN: 'down', UP: 'up'});
// endReason: auto_detected · user_marked_working · user_marked_not_working · user_marked_not_tested · dismissed (القسم ف-04)
const VOLUME_BUTTON_END_REASON = deepFreeze({
  AUTO_DETECTED: 'auto_detected', USER_MARKED_WORKING: 'user_marked_working', USER_MARKED_NOT_WORKING: 'user_marked_not_working',
  USER_MARKED_NOT_TESTED: 'user_marked_not_tested', DISMISSED: 'dismissed',
});
// detectionSource (N71-04 [م]): key_event · volume_level_change — «كيف اكتُشف الضغط حين endReason = auto_detected»
const VOLUME_BUTTON_DETECTION_SOURCE = deepFreeze({KEY_EVENT: 'key_event', VOLUME_LEVEL_CHANGE: 'volume_level_change'});
const VOLUME_BUTTON_STATE = deepFreeze({
  NOT_IN_FIELDS_VERSION: 'NOT_IN_FIELDS_VERSION', //  ختم < 71: لا measurements لأزرار الصوت (القسم: «غائب (null)» في fv70)
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION',
  READ: 'READ',
});
// ما يقوله الخامّ عن وقوع الضغط **دون حكم**: «`[]` لا تعني «لم يضغط»: قد تعني «لم يصل الحدث إلى حوار Compose»… لا يقرأ القارئ `[]` بمفردها نجاحاً ولا فشلاً» (القسم ف-04). **اسم خادم.**
const VOLUME_BUTTON_PRESS_EVIDENCE = deepFreeze({
  KEY_EVENT_SEEN: 'KEY_EVENT_SEEN', //     expectedDownCount > 0: وصل حدث ضغط للمفتاح المطلوب
  LEVEL_CHANGE_ONLY: 'LEVEL_CHANGE_ONLY', // لم يصل حدث مفتاح، والكشف بتغيّر مستوى STREAM_MUSIC (detectionSource = volume_level_change)
  NOT_ESTABLISHED: 'NOT_ESTABLISHED', //   لا حدث ولا كشف بالمستوى: لا يُعلَم أضغط الفنّي أم لم يصل الحدث — لا نجاح ولا فشل
});
// جواب M-09/M-10 اليدوي وعلاقته بالخامّ — حالة صريحة (القاعدة 22) كما M-02. **اسم خادم.**
const VOLUME_BUTTON_ANSWER_STATE = deepFreeze({
  NOT_IN_MANUAL_RESULTS: 'NOT_IN_MANUAL_RESULTS', WITHOUT_RAW: 'WITHOUT_RAW', RAW_UNREADABLE: 'RAW_UNREADABLE', RAW_PRESENT: 'RAW_PRESENT',
});

// ═══ fv71 — P6-13 توحيد الظروف: powerSaveState · brightnessLock · batteryWindowPct (S-P6-13، 2026-10-18 +03) ═══════════════════════════════════════
// المصدر الحاكم: docs/FV71_CONTRACT_SECTION.md ف-05 (و N71-06/07/08). **الخطّة** (PLAN-06-DATA-COLLECTION.md في مساحة العمل: صفّ الجدول `:1054` [الأمر يقول `:1052`: الصفّ انجرف سطرين] و§١٢-ب) مصدر ثانوي: ما يقوله القسم يحكم.
// الأسماء [م] لم تُقرّ بعد (القسم: «مقترح، للاعتماد»): `batteryWindowPct` (N71-07) وحقول `brightnessLock` (N71-08)؛ وأمّا `powerSaveState` فاسم الخطّة (P:1433) [ن].
// **ما لا يحمله الخادم (قرار المستخدم، القسم ف-05 / N71-06):** رقما النافذة 30 و85 — «فلا يحمل الخادم نسخة من الرقمين» (القاعدة 24): النافذة **يعلنها التطبيق** في الحمولة، والقارئ يقرأ ما أُعلِن.
// **معلّق (لا يُنفَّذ هنا):** وسم «البداية الساخنة» `hotStart` (PLAN-06 §١٢-ب: «يحسبها الخادم (القاعدة 20) في الحساب اليومي… وسيط بدايات اليوم + 4° [اجتهاد]…») — حساب **يومي عبر فحوص** لا مُدخل له في القسم المنسوخ،
//   و«اليوم» وسقف المجموعة غير محدَّدين فيه؛ فلا قارئ حمولة له.
const SCAN_CONDITIONS_KEYS = deepFreeze({
  POWER_SAVE_STATE: 'powerSaveState', //     جديد (ترويسة الملفّ وجذر البصمة، بجوار المنطقيّين)
  IS_POWER_SAVE_MODE: 'isPowerSaveMode', //  منطقيّ قديم في ترويسة الملفّ (يبقى لقارئيه القدامى)
  POWER_SAVE_MODE: 'powerSaveMode', //       منطقيّ قديم في جذر البصمة
  BRIGHTNESS_LOCK: 'brightnessLock', //      جديد في التذييل: {state, value, method}
  BATTERY_WINDOW_PCT: 'batteryWindowPct', // جديد في التذييل: {minPct, maxPct}
  BATTERY_LEVEL_START: 'batteryLevelStart', // **خامّ كما اليوم** في ترويسة الملفّ (القسم: «لا يتغيّر»): Int بحارس -1 للمجهول
});
// powerSaveState: off · on · read_failed (القسم ف-05). المنطقيّان يُشتقّان في ختم ≥ 71: on ⇒ true، off ⇒ false، **read_failed ⇒ غائب (لا false)**.
const POWER_SAVE_STATE = deepFreeze({OFF: 'off', ON: 'on', READ_FAILED: 'read_failed'});
// brightnessLock {state, value, method}: state ∈ applied · apply_failed:<نصّ الخطأ> · not_attempted:<سبب>؛ value عشرية في [0, 1]؛ method ∈ window_attribute · system_setting (N71-08 [م]).
// value وmethod **غائبان** حين state = not_attempted:* (لا صفر). «النجاح» = state (لا حقل منطقيّ ثانٍ).
const BRIGHTNESS_LOCK_KEYS = deepFreeze({STATE: 'state', VALUE: 'value', METHOD: 'method'});
const BRIGHTNESS_LOCK_STATE = deepFreeze({APPLIED: 'applied', APPLY_FAILED: 'apply_failed', NOT_ATTEMPTED: 'not_attempted'});
const BRIGHTNESS_LOCK_METHOD = deepFreeze({WINDOW_ATTRIBUTE: 'window_attribute', SYSTEM_SETTING: 'system_setting'});
// batteryWindowPct {minPct, maxPct}: أعداد صحيحة بنسبة الشحن (N71-07 [م]).
const BATTERY_WINDOW_KEYS = deepFreeze({MIN_PCT: 'minPct', MAX_PCT: 'maxPct'});
// قبل 71 «الحدّ فيه 25 ولا حدّ أعلى [ك: StressTestService.kt:243]» (القسم ف-05): حقيقة تاريخية لختم < 71، لا نسخة من حدّ الحاضر (الحاضر يُعلَن في الحمولة).
const BATTERY_WINDOW_LEGACY_MIN_PCT = 25;
// batteryLevelStart: -1 حارس «غير معروف» في ترويسة الملفّ (BatteryIndicators.kt:219 `levelsKnown = batteryLevelStart >= 0`، القسم ف-05).
const BATTERY_LEVEL_UNKNOWN_SENTINEL = -1;
const SCAN_CONDITIONS_STATE = deepFreeze({
  NOT_IN_FIELDS_VERSION: 'NOT_IN_FIELDS_VERSION', //            ختم < 71: المفاتيح الثلاثة الجديدة لم توجد بعد (حضورها شذوذ)
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION',
  READ: 'READ',
});
// ما يقوله الخامّ عن وضع توفير الطاقة: أساس القراءة. **اسم خادم.**
const POWER_SAVE_BASIS = deepFreeze({
  STATE_DECLARED: 'STATE_DECLARED', //                          ≥ 71: الحالة معلنة (off/on/read_failed) والمنطقيّ مشتقّ منها
  LEGACY_BOOLEAN_ONLY: 'LEGACY_BOOLEAN_ONLY', //                < 71: المنطقيّ وحده، وفشل القراءة فيه يُكتب false فلا يتميّز عن «غير مفعَّل» (القسم: «اليوم فشل القراءة يُكتب false»)
  UNDETERMINED_NO_FIELDS_VERSION: 'UNDETERMINED_NO_FIELDS_VERSION',
});
// نافذة الشحن: أساسها. **اسم خادم.**
const BATTERY_WINDOW_BASIS = deepFreeze({
  DECLARED_IN_PAYLOAD: 'DECLARED_IN_PAYLOAD', //                ≥ 71 والحمولة تعلن {minPct, maxPct} صالحين
  LEGACY_FIXED_MIN_NO_MAX: 'LEGACY_FIXED_MIN_NO_MAX', //        < 71: حدّ أدنى 25 ولا أعلى
  NO_VALID_WINDOW: 'NO_VALID_WINDOW', //                        ≥ 71 والنافذة غائبة أو غير صالحة (شذوذ مُعلَن)، أو لا ختم
});
// بداية الشحن مقابل النافذة — **وصف بلا حكم** (البوّابة متسامحة مع المجهول: يبقى batteryLevelStart يعلن المجهول). **اسم خادم.**
const START_LEVEL_VS_WINDOW = deepFreeze({
  WITHIN: 'WITHIN', BELOW_MIN: 'BELOW_MIN', ABOVE_MAX: 'ABOVE_MAX',
  START_LEVEL_UNKNOWN: 'START_LEVEL_UNKNOWN', //                -1 أو غائب (بسببه)
  START_LEVEL_INVALID: 'START_LEVEL_INVALID', //                خارج [-1، 100] أو بنوع خاطئ
  NO_WINDOW: 'NO_WINDOW',
});

// ما لا يصل **النموذج** من raw.measurements لكل اختبار (S-M02، 2026-10-18 +03). **السبب (بالأداة، e2e analyzeDeviceFv71M02):** testResults[].raw في حمولة النموذج هو عنصر manualResults/functionalResults كلّه
// (categoryStates.buildAllTestResults: `raw: r`) ولا قائمة بيضاء لـtestResults (v7ModelPayloadWhitelist.js) — فكان خامّ M-02 fv71 (strokes بآلاف النقاط) سيصل النموذج: كلفة رموز
// تُسقط الفحص، وقيمة لا يُبنى عليها حرف ولا عتبة معايَرة (قرار المستخدم 2026-10-06: «لا تصل إلى النموذج قيمة لا يُبنى عليها حرف… يصله «مقيس» أو «غير مقيس» وحده»). **مفاتيح fv71 وحدها تُحذف**؛
// المفاتيح الثمانية القديمة تصل كما كانت بايتاً ببايت (لا تغيير في سلوك ختم ≤ 70 — توسيع المبدأ إلى القديمة قرار مستخدم لم يُتَّخذ). **اسم خادم**.
const MODEL_HIDDEN_RAW_MEASUREMENT_KEYS = deepFreeze({
  // + مفتاحا «إطار + X» (gridPattern وnotRequiredCells، 2026-10-21): جديدان في fv71 وقائمة فهارس لا يُبنى عليها حرف (المفاتيح الثمانية القديمة، وفيها totalCells وtouchedCells، تصل كما كانت)
  [MEASURED_TEST_IDS.TOUCH_GRID]: [...Object.values(TOUCH_PATH_MEASUREMENT_KEYS), ...Object.values(TOUCH_GRID_PATTERN_KEYS)],
  // S-VOL: كل مفاتيح measurements لأزرار الصوت جديدة في fv71 (القسم: «غائب (null)» في fv70) فتُخفى كلّها؛ لا مفتاح قديم يلزم إبقاؤه
  [VOLUME_BUTTON_TEST_IDS[0]]: Object.values(VOLUME_BUTTON_MEASUREMENT_KEYS),
  [VOLUME_BUTTON_TEST_IDS[1]]: Object.values(VOLUME_BUTTON_MEASUREMENT_KEYS),
});
// عناصر strokes[] (القسم ف-03)
const TOUCH_PATH_STROKE_KEYS = deepFreeze({
  POINTER_ID: 'pointerId', TOOL_TYPE: 'toolType', DOWN_AT_MS: 'downAtMs', END: 'end', DT_MS: 'dtMs', X: 'x', Y: 'y', TOUCH_MAJOR_PX: 'touchMajorPx',
});
// strokes[].end: «up · cancel · cancel_flagged · open_at_end» (القسم ف-03). open_at_end: لا يزال الإصبع هابطاً عند نهاية التشغيل.
// **cancel_flagged:** كان القسم (0af0b5c) لا يشرحه («تُنقل في أمر البناء من M2» ولم تُنقل)؛ وقسم f9e0571 يسمّي منشأه: «cancel_flagged (FLAG_CANCELED)» أي أن الحدث يحمل FLAG_CANCELED. والخادم **لا يميّز** بينه وبين cancel (design §3.3: ACTION_CANCEL وFLAG_CANCELED كلاهما
// يُستبعد من الكشف ويبقى في الخامّ) ويُعلن ذلك صراحةً في TOUCH_PATH_DETECTOR_NOTES.
const TOUCH_PATH_STROKE_END = deepFreeze({UP: 'up', CANCEL: 'cancel', CANCEL_FLAGGED: 'cancel_flagged', OPEN_AT_END: 'open_at_end'});
// strokes[].toolType: touch · stylus · mouse · eraser · unknown، و`unknown:<n>` تكتبه التطبيق حين تأتي قيمة غير معروفة [م] (القسم ف-03).
const TOUCH_PATH_TOOL_TYPE = deepFreeze({TOUCH: 'touch', STYLUS: 'stylus', MOUSE: 'mouse', ERASER: 'eraser', UNKNOWN: 'unknown'});
// densitySource: XDPI · XDPI_MODE_SCALED · DENSITY_DPI_FALLBACK (القسم ف-02).
const TOUCH_PATH_DENSITY_SOURCE = deepFreeze({XDPI: 'XDPI', XDPI_MODE_SCALED: 'XDPI_MODE_SCALED', DENSITY_DPI_FALLBACK: 'DENSITY_DPI_FALLBACK'});
// عناصر densityCheck — **[ق] قرار تقني للتطبيق ليس في الأسماء المعتمدة نصّاً (يُراجَع ولا يُعامَل معتمداً)**، خمسة أسماء (قسم NeuralChek@f9e0571، «حالة التنفيذ ← M-02 ← القيم المعدَّدة»؛ كان القسم قبله يقول «لا أخترعها هنا»)،
// و«[] ما لم يُستعمل DENSITY_DPI_FALLBACK». لا عيّنة مُنتِج تحمل أيّاً منها (الثلاث كلّها densityCheck = []): معدَّدة من نصّ القسم وحده. اسم خارجها شذوذ معلَن (القاعدة 25) لا يُخمَّن.
const TOUCH_PATH_DENSITY_CHECK_CONDITIONS = deepFreeze({
  XDPI_OR_YDPI_NOT_POSITIVE: 'xdpi_or_ydpi_not_positive', XDPI_YDPI_DIFFER_OVER_5PCT: 'xdpi_ydpi_differ_over_5pct', PHONE_WIDTH_OUTSIDE_55_85MM: 'phone_width_outside_55_85mm',
  BOTH_CANDIDATES_PLAUSIBLE: 'both_candidates_plausible', DISPLAY_WIDTH_UNKNOWN: 'display_width_unknown',
});
// resampledFlagState — **[ق، معلّق: مواصفة غائبة]** (القسم نفسه): not_available_api (API < 35) · not_read_by_app (API ≥ 35)، حاضر دائماً. الأسماء معدَّدة؛ **دلالة المفتاح** (ماذا يعني للإحداثيات المعاد تشكيلها) غير موصوفة في أيّ مصدر فلا يحكم القارئ بها.
const TOUCH_PATH_RESAMPLED_FLAG_STATE = deepFreeze({NOT_AVAILABLE_API: 'not_available_api', NOT_READ_BY_APP: 'not_read_by_app'});
// displayedSuspects[].kind على السلك: gap_jump · coord_jump · edge_exit (القسم ف-03، E19). LIFT_BREAK **اسم خادم** لانقطاع برفع (design §3.1 (2)) — لا يُكتب على السلك ولا يوجد في displayedSuspects.
const TOUCH_PATH_SUSPECT_KIND = deepFreeze({GAP_JUMP: 'gap_jump', COORD_JUMP: 'coord_jump', EDGE_EXIT: 'edge_exit', LIFT_BREAK: 'lift_break'});
const TOUCH_PATH_DISPLAYED_SUSPECT_KINDS = Object.freeze([TOUCH_PATH_SUSPECT_KIND.GAP_JUMP, TOUCH_PATH_SUSPECT_KIND.COORD_JUMP, TOUCH_PATH_SUSPECT_KIND.EDGE_EXIT]);
const TOUCH_PATH_SUSPECT_ELEMENT = deepFreeze({KIND: 'kind', STROKE_INDEX: 'strokeIndex', FROM_POINT_INDEX: 'fromPointIndex', TO_POINT_INDEX: 'toPointIndex'});
const TOUCH_PATH_PATH_CAP_KEYS = deepFreeze({MAX_POINTS: 'maxPoints', REACHED: 'reached', POINTS_DROPPED: 'pointsDropped'});
const TOUCH_PATH_RECT_KEYS = deepFreeze({LEFT: 'left', TOP: 'top', RIGHT: 'right', BOTTOM: 'bottom'});
const TOUCH_PATH_ROUNDED_CORNER_KEYS = deepFreeze({TOP_LEFT: 'topLeft', TOP_RIGHT: 'topRight', BOTTOM_RIGHT: 'bottomRight', BOTTOM_LEFT: 'bottomLeft'});
// roundedCornersState: `not_available_api` على API < 31 (القسم ف-02، M2:161)، وغير ذلك `read_failed:<نصّ الخطأ>`.
const TOUCH_PATH_ROUNDED_CORNERS_STATE = deepFreeze({NOT_AVAILABLE_API: 'not_available_api'});
// absentFieldReasons (N71-01 [م]): قيم السبب `api_below_<n>` · `read_failed:<نصّ الخطأ>` · `not_reported_by_device`. `api_below_<n>` نمط لا بادئة بـ«:» فيُحلَّل بتعبير منتظم (بلا g ولا y: exec لا يكتب lastIndex).
const TOUCH_PATH_ABSENT_REASON = deepFreeze({NOT_REPORTED_BY_DEVICE: 'not_reported_by_device', API_BELOW: 'api_below'});
const TOUCH_PATH_ABSENT_REASON_API_BELOW_RE = Object.freeze(/^api_below_(\d+)$/);
// مفتاح العنصر داخل absentFieldReasons لـstrokes[].touchMajorPx: «تحت المفتاح `strokes.touchMajorPx`» (القسم ف-03).
const TOUCH_PATH_TOUCH_MAJOR_REASON_KEY = 'strokes.touchMajorPx';

// أحكام الخادم على الخامّ — مصدر العتبات الوحيد (design §6.6: «الأسماء والعتبات مصدرها الوحيد fv68Names.js»). **كلّها [اجتهاد] من design §3 غير مُعايرة**:
// «لا مصدر لمعدّل عيّنات اللمس على الـS10 5G ولا على الـS21 Ultra… فالمعدّل يُقاس من الخامّ نفسه في يوم التجربة» (design §3.2) و«عتبات اليوم لا بدّ أن تتغيّر بعد يوم التجربة» (§6.4)؛
// فتغييرها هنا (لا في APK) ويُرفع VERSION معها كي تُقرأ البيانات القديمة بالنسخة التي أُنتج بها حكمها. لا تدخل الحرف اليوم: «القراءات تُعاد مع النتيجة ولا تدخل الحرف» (design §6.6).
const TOUCH_PATH_DETECTOR = deepFreeze({
  VERSION: 'touch-path-detector-1', //       detectorVersion [م] (design §6.6) — يُعاد مع كل قراءة
  V_MIN_MM_PER_S: 20, //                     design §3.1: «سرعة الإصبع في آخر 3 خطوات قبل الموضع لا تقلّ عن V_MIN = 20 مم/ث [اجتهاد]»
  SPEED_WINDOW_STEPS: 3, //                  «آخر 3 خطوات»
  J_MIN_MM: 1.5, //                          «max(J_MIN = 1.5 مم، 3 × وسيط آخر 8 خطوات في الخطّ نفسه)»
  JUMP_MEDIAN_FACTOR: 3,
  MEDIAN_WINDOW_STEPS: 8,
  GAP_MIN_MS: 20, //                         gap_jump: «dt > max(20 مث، 3 × وسيط الفاصل)»
  GAP_MEDIAN_FACTOR: 3,
  R_MAX_MS: 120, //                          انقطاع برفع: «بين 0 وR_MAX = 120 مث [اجتهاد]»
  STRONG_LIFT_GAP_MS: 40, //                 «إن كان الفاصل أقلّ من 40 مث وُسم قويّاً» (DOUBLE_TAP_MIN_TIME في AOSP: نقله هنا اجتهاد)
  LANDING_MIN_MM: 3, //                      «على بُعد لا يتجاوز max(3 مم، نصف الإزاحة المتوقّعة) من الموضع الذي كان سيبلغه»
  LANDING_EXPECTED_FRACTION: 0.5,
  RETURN_MIN_SAMPLES: 3, //                  العودة: «يستمرّ المسار 3 عيّنات و2 مم على الأقلّ باتّجاه لا يبعد أكثر من 45°»
  RETURN_MIN_MM: 2,
  RETURN_MAX_ANGLE_DEG: 45,
  PALM_TOUCH_MAJOR_MM: 15, //                راحة اليد: «touchMajor كبير، بأكثر من 15 مم [اجتهاد]»
  EDGE_MARGIN_MM: 5, //                      edge_exit: «بُعد أقلّ من EDGE_MARGIN = 5 مم من الحافّة والإصبع متّجه إليها»
  MIN_HISTORY_STEPS: 3, //                   **اشتقاق من «آخر 3 خطوات»** (لا رقم في design): بلا ثلاث خطوات سابقة لا يُقاس تحرّك الإصبع فلا يُقيَّم المقطع
});
// حالة الكشف: يُعلن القارئ لماذا لم يقع كشف بدل أن يُقرأ «لا مواضع» نجاحاً (القاعدة 22). **اسم خادم**.
const TOUCH_PATH_DETECTION_STATE = deepFreeze({
  RAN: 'RAN',
  UNDETERMINED_NO_STROKES_READ: 'UNDETERMINED_NO_STROKES_READ', //     strokes غائب أو بنوع خاطئ
  UNDETERMINED_NO_PX_PER_MM: 'UNDETERMINED_NO_PX_PER_MM', //           «مُدخلات الكثافة غائبة: لا مواضع محسوبة بالملّيمتر، ويُعلَن UNDETERMINED» (design §6.6)
  UNDETERMINED_NO_SURFACE: 'UNDETERMINED_NO_SURFACE', //               بلا أبعاد السطح لا حافّة ولا شبكة
  UNDETERMINED_NO_USABLE_STROKES: 'UNDETERMINED_NO_USABLE_STROKES', // كل الخطوط خارج الكشف أو غير قابلة للقراءة
  ANALYSIS_ERROR: 'ANALYSIS_ERROR', //                                 استثناء داخل التحليل: معلن، ولا يُسقط بقيّة قراءات الحمولة
});
// ما يُعلنه الكاشف في مخرَجه كمواضع معلّقة/افتراضات، فلا تُقرأ نتيجته أدقّ مما هي. **اسم خادم** (مفاتيح الرموز) ونصوص إنجليزية للسجلّ لا للمستخدم.
const TOUCH_PATH_DETECTOR_NOTES = deepFreeze({
  CANCEL_FLAGGED_AS_CANCEL: 'cancel_flagged (the contract section names its origin: FLAG_CANCELED on the event) is handled exactly like cancel (design section 3.3); the section does not say the app treats it differently',
  THRESHOLDS_UNCALIBRATED: 'thresholds are design proposals (design-m02 section 3), not calibrated on a device; they change here, with a new detectorVersion',
  EDGE_IS_SURFACE_EDGE: 'edge distances and edge_exit use the touch-surface edges in the surface-local frame (surfaceWidthPx x surfaceHeightPx), not the physical screen edges',
  LIFT_BREAK_IS_SERVER_NAME: 'lift_break is a server-side name for a break with a lift; it is not a wire value',
});
// سبب استبعاد خطّ من الكشف (يبقى في الخامّ؛ design §3.3 «راحة اليد»): **اسم خادم**.
const TOUCH_PATH_EXCLUSION = deepFreeze({
  CANCELLED: 'CANCELLED', //                       end = cancel أو cancel_flagged
  CONCURRENT_POINTER: 'CONCURRENT_POINTER', //     «إصبع ثانٍ متزامن»: فترته تتداخل مع خطّ آخر
  PALM_TOUCH_MAJOR: 'PALM_TOUCH_MAJOR', //         touchMajor أكبر من PALM_TOUCH_MAJOR_MM
  UNRECOGNIZED_END: 'UNRECOGNIZED_END', //         end خارج الأربع: لا يُعرف أرُفع أم أُلغي
  UNUSABLE_ARRAYS: 'UNUSABLE_ARRAYS', //           dtMs/x/y بأطوال مختلفة أو عناصر غير صالحة (شذوذ معلن)
});
// سقف ما يُسرد في مخرَج القارئ من قوائم (خطوط، مواضع، خلايا): المخرَج يُعاد مع النتيجة ولا يُخزَّن؛ ما فوق السقف يُعدّ ويُعلَن `truncated` لا يُسقَط صامتاً. **اسم خادم**.
const TOUCH_PATH_OUTPUT_LIST_CAP = 64;
// حالة أقرب بُعد من الحافّة وأساسه وجهاتها، ومصدر edge_exit. **اسم خادم**.
const TOUCH_PATH_EDGES_STATE = deepFreeze({READ: 'READ', NO_POINTS: 'NO_POINTS', NO_SURFACE: 'NO_SURFACE'});
const TOUCH_PATH_EDGE_BASIS = deepFreeze({SURFACE_LOCAL_FRAME: 'SURFACE_LOCAL_FRAME'}); // حافّة سطح اللمس بإحداثيّاته المحلّية، لا حافّة الشاشة الفيزيائية
const TOUCH_PATH_EDGE_SIDE = deepFreeze({LEFT: 'left', RIGHT: 'right', TOP: 'top', BOTTOM: 'bottom'});
const TOUCH_PATH_EDGE_EXIT_SOURCE = deepFreeze({JUMP: 'jump', LIFT: 'lift'});
const TOUCH_PATH_CELLS_CHECK = deepFreeze({
  MATCH: 'MATCH',
  // كاشف القفز لم يعمل (لا كثافة/سطح): قاعدة «لا استيفاء عبر قفزة» لا تُطبَّق، فلا حكم بالاتّفاق ولا بالاختلاف — الأعداد تبقى مسرودة
  UNDETERMINED_DETECTOR_NOT_RUN: 'UNDETERMINED_DETECTOR_NOT_RUN',
  DISAGREE: 'DISAGREE', //                                           يُعلَن شذوذاً TOUCH_GRID_CELLS_DISAGREE_WITH_PATH [م] (design §6.6)
  UNDETERMINED_NO_CELL_GEOMETRY: 'UNDETERMINED_NO_CELL_GEOMETRY', // gridCols/gridRows/cellWidthPx/cellHeightPx غائبة أو غير صالحة
  // «إطار + X» (2026-10-21): المجموعة المطلوبة = الشبكة − cutoutCells − notRequiredCells؛ إن لم تُقرأ notRequiredCells (نوع خاطئ أو نمط ناقص، TOUCH_GRID_PATTERN_STATE) فلا مجموعة مطلوبة: لا حكم بالاتّفاق ولا بالاختلاف
  UNDETERMINED_REQUIRED_SET_UNKNOWN: 'UNDETERMINED_REQUIRED_SET_UNKNOWN',
  UNDETERMINED_NO_REPORTED_CELLS: 'UNDETERMINED_NO_REPORTED_CELLS', // touchedCells أو untouchedCells غائب
  UNDETERMINED_NO_STROKES: 'UNDETERMINED_NO_STROKES', //            لا خطوط مقروءة للمقارنة
});

// ─── مفردات الحالات النصّية على السلك (كما كتبها التطبيق) ───────────────
// STATE_KIND: القيم الحرفية التي يقوم عليها التمييز (القاعدة 24) — قيمة واحدة في موضع واحد، يستوردها كل قارئ.
const STATE_KIND = deepFreeze({
  OK: 'ok', FAIL: 'fail',
  PASSED: 'passed', FAILED: 'failed',
  RAN: 'ran', PARTIAL: 'partial', NOT_RUN: 'not_run',
  ATTEMPTED: 'attempted', NOT_ATTEMPTED: 'not_attempted', PIN_RESULT_UNREADABLE: 'pin_result_unreadable',
  READ: 'read', NOT_READ: 'not_read', READ_FAILED: 'read_failed', NOT_WRITTEN: 'not_written',
  COMPUTED: 'computed', NOT_COMPUTED: 'not_computed',
  ABSENT: 'absent', LIVE_READ_AT_FINALIZE: 'live_read_at_finalize', SAMPLER_MAX_CPU: 'sampler_max_cpu',
  MEASURED: 'measured', INSUFFICIENT_ACCEL_SAMPLES: 'insufficient_accel_samples',
  MATCH: 'match', MISMATCH: 'mismatch', NOT_REACHED: 'not_reached',
  // fv70 (§٧-ط): الفحص تُرك لضيق الوقت. قيمتان حرفيتان كاملتان (لا بادئة + سبب مفتوح): ما خرج عنهما (skipped:<سبب آخر>، partial:<سبب آخر>) يُقرأ «غير معروف» ويُعلَن (القاعدة 25).
  // المتروك لا نجاح ولا فشل ولا صفر (القاعدة 22): لا يدخل عدّاد عدم التطابق، ولا مجموع زمن D.
  SKIPPED_TIME_BUDGET: 'skipped:time_budget', // في sieveStatus وsha256Status معاً
  PARTIAL_TIME_BUDGET: 'partial:time_budget', //  في cpuKnownAnswerState: أُبلغ نصف فحص واحد على الأقلّ وتُرك تشغيل واحد على الأقلّ
  SELF_TEST_FAILED: 'self_test_failed', ALLOC_FAILED: 'alloc_failed',
  // cancelled (الجزء الخامس، 2026-10-13 +03): التشغيل بدأ وقطعته المرحلة (عقد §٧-ط :1630 في نسخة 450d9ed). يُرسله التطبيق في sieveStatus وsha256Status (من قبل fv70، CpuKnownAnswerScheduler.kt:152,156,176,196، منقول، غير متحقَّق)
  // وهو في مفردات الحالتين في العقد (:1616) وليس من EXECUTED_STATUSES (match وmismatch وalloc_failed وself_test_failed): لا نجاح ولا فشل ولا عدم تطابق، ولا يجعل الحالة الإجمالية ran بنفسه، ولا يدخل عدّاد عدم التطابق.
  CANCELLED: 'cancelled',
  NATIVE_CALL_FAILED: 'native_call_failed', NATIVE_RESULT_UNREADABLE: 'native_result_unreadable', NATIVE_STATUS_UNKNOWN: 'native_status_unknown',
  NAN: 'nan', EXCEPTION: 'exception', NON_FINITE: 'non_finite',
  API_BELOW_30: 'api_below_30', API_BELOW_29: 'api_below_29', NO_READING_TAKEN: 'no_reading_taken',
  START_FAILED: 'start_failed', LISTENER_REGISTRATION_FAILED: 'listener_registration_failed', INITIAL_READ_FAILED: 'initial_read_failed',
  FILE: 'file', FOOTER_BACKUP: 'footer_backup', NO_FILE: 'no_file',
  EXTRA_API34: 'extra_api34', UNAVAILABLE: 'unavailable', SYSFS: 'sysfs',
  O_DIRECT_SEQUENTIAL: 'o_direct_sequential', DONTNEED_SEQUENTIAL: 'dontneed_sequential',
});
const K = STATE_KIND;
// حالات الغربال التي يُنتظَر معها sieveLimit في ختم ≥ 70: **مصدر واحد** يقرؤه القارئ وسكربت الفحص ٠٣ (القاعدة 24). المصدر: عقد التطبيق §٧-ط (د)، نسخة 450d9ed (docs/FV68_CONTRACT.md):
// «حاضر في كل مصفوفة مقروءة: match · mismatch · alloc_failed (N الذي حاول) · native_status_unknown:<n>»، وغائب مع not_reached وskipped:time_budget وnative_call_failed:* وnative_result_unreadable:size=<n>.
// (جوابٌ لسؤال الجزء الرابع: alloc_failed للغربال أيضاً — الدليل في الكود: SieveReading(STATUS_ALLOC_FAILED, null, duration, limit) في CpuKnownAnswer.kt عند 450d9ed، منقول من أمر المنسّق، غير متحقَّق. وكان سطر العقد القديم يعدّد أسباب فشل SHA ولا ينفي ذلك عن الغربال.)
// cancelled **ليس** منها: عند إلغاء الغربال sieveStatus=cancelled وsieveLimit غائب دائماً (CpuKnownAnswerScheduler.kt:147-158 عند 450d9ed — المصدر الكود لا العقد، منقول، غير متحقَّق)؛ فغيابه معه معلوم بالتصميم وحضوره شذوذ (CANCELLED_WITH_SIEVE_LIMIT).
const SIEVE_STATUS_KINDS_CARRYING_LIMIT = Object.freeze([K.MATCH, K.MISMATCH, K.ALLOC_FAILED, K.NATIVE_STATUS_UNKNOWN]);

// VOCAB: اسم كل مفردة (مفتاح STATE_VOCABULARY). بعضها يطابق اسم مفتاح التذييل الذي يحملها، وبعضها لا مفتاح له (عنصر داخل قائمة).
const VOCAB = deepFreeze({
  THERMAL_HEADROOM_STATE: 'thermalHeadroomState',
  THERMAL_HEADROOM_READING: 'thermalHeadroomReading',
  THERMAL_STATUS_STATE: 'thermalStatusState',
  TIME_SERIES_STATE: 'timeSeriesState',
  PRE_SCAN_WARNINGS_STATE: 'preScanWarningsState',
  STILLNESS_STATE: 'stillnessState',
  CYCLE_COUNT_STATE: 'cycleCountState',
  CYCLE_COUNT_SOURCE: 'cycleCountSource',
  CHARGE_COUNTER_UAH_STATE: 'chargeCounterUahState',
  ENERGY_COUNTER_NWH_STATE: 'energyCounterNwhState',
  BATTERY_INDICATOR_STATE: 'batteryIndicatorState',
  CPU_TEMP_FINAL_SOURCE: 'cpuTempFinalSource',
  MEMORY_VERIFY_STATE: 'memoryVerifyState',
  STORAGE_VERIFY_STATE: 'storageVerifyState',
  STORAGE_VERIFY_METHOD: 'storageVerifyMethod',
  GPU_COMPUTE_GEMM_STATE: 'gpuComputeGemmState',
  WORKERS_PIN_STATE: 'workersPinState',
  CPU_KNOWN_ANSWER_STATE: 'cpuKnownAnswerState',
  CPU_KNOWN_ANSWER_SIEVE_STATUS: 'cpuKnownAnswerSieveStatus',
  CPU_KNOWN_ANSWER_SHA256_STATUS: 'cpuKnownAnswerSha256Status',
  FOOTER_DIAGNOSTIC: 'footerDiagnostic',
  TOUCH_GRID_END_REASON: 'touchGridEndReason',
  // fv71 (M-02 الخامّ): مفردات الخطّ والكثافة والعلامات والزوايا وسبب الغياب (القسم ف-02 وف-03)
  TOUCH_PATH_TOOL_TYPE: 'touchPathToolType',
  TOUCH_PATH_STROKE_END: 'touchPathStrokeEnd',
  TOUCH_PATH_DENSITY_SOURCE: 'touchPathDensitySource',
  TOUCH_PATH_DISPLAYED_SUSPECT_KIND: 'touchPathDisplayedSuspectKind',
  TOUCH_PATH_ROUNDED_CORNERS_STATE: 'touchPathRoundedCornersState',
  TOUCH_PATH_ABSENT_REASON: 'touchPathAbsentReason',
  TOUCH_PATH_RESAMPLED_FLAG_STATE: 'touchPathResampledFlagState',
  // fv71 (أزرار الصوت، ف-04)
  VOLUME_BUTTON_END_REASON: 'volumeButtonEndReason',
  VOLUME_BUTTON_EVENT_ACTION: 'volumeButtonEventAction',
  VOLUME_BUTTON_DETECTION_SOURCE: 'volumeButtonDetectionSource',
  // fv71 (P6-13، ف-05)
  POWER_SAVE_STATE: 'powerSaveState',
  BRIGHTNESS_LOCK_STATE: 'brightnessLockState',
  BRIGHTNESS_LOCK_METHOD: 'brightnessLockMethod',
});

// كل مفردة: exact = قيم حرفية كاملة، prefixed = بادئة قبل «:» ويتبعها نصّ السبب.
// ما خرج عنهما يُقرأ «غير معروف» صراحةً ولا يُسقَط (القاعدة 25) ولا يُقرأ نجاحاً (القاعدة 22).
const NATIVE_FAILURES = [K.NATIVE_CALL_FAILED, K.NATIVE_RESULT_UNREADABLE, K.NATIVE_STATUS_UNKNOWN];
const STATE_VOCABULARY = deepFreeze({
  [VOCAB.THERMAL_HEADROOM_STATE]: {exact: [K.OK, K.API_BELOW_30, K.NO_READING_TAKEN], prefixed: [K.START_FAILED]},
  [VOCAB.THERMAL_HEADROOM_READING]: {exact: [K.OK, K.NAN, K.API_BELOW_30], prefixed: [K.EXCEPTION, K.NON_FINITE]},
  [VOCAB.THERMAL_STATUS_STATE]: {exact: [K.OK, K.API_BELOW_29], prefixed: [K.LISTENER_REGISTRATION_FAILED, K.INITIAL_READ_FAILED]},
  [VOCAB.TIME_SERIES_STATE]: {exact: [K.FILE, K.FOOTER_BACKUP], prefixed: [K.NO_FILE]},
  [VOCAB.PRE_SCAN_WARNINGS_STATE]: {exact: [K.READ, K.NOT_WRITTEN], prefixed: [K.READ_FAILED]},
  [VOCAB.STILLNESS_STATE]: {exact: [K.MEASURED, K.INSUFFICIENT_ACCEL_SAMPLES], prefixed: []},
  [VOCAB.CYCLE_COUNT_STATE]: {exact: [K.READ], prefixed: [K.NOT_READ]},
  [VOCAB.CYCLE_COUNT_SOURCE]: {exact: [K.EXTRA_API34, K.UNAVAILABLE], prefixed: [K.SYSFS]}, // عقد :1396
  [VOCAB.CHARGE_COUNTER_UAH_STATE]: {exact: [K.READ], prefixed: [K.NOT_READ]},
  [VOCAB.ENERGY_COUNTER_NWH_STATE]: {exact: [K.READ], prefixed: [K.NOT_READ]},
  [VOCAB.BATTERY_INDICATOR_STATE]: {exact: [K.COMPUTED], prefixed: [K.NOT_COMPUTED]},
  [VOCAB.CPU_TEMP_FINAL_SOURCE]: {exact: [K.LIVE_READ_AT_FINALIZE, K.SAMPLER_MAX_CPU], prefixed: [K.ABSENT]},
  [VOCAB.MEMORY_VERIFY_STATE]: {exact: [K.RAN], prefixed: [K.PARTIAL, K.NOT_RUN]},
  [VOCAB.STORAGE_VERIFY_STATE]: {exact: [K.RAN], prefixed: [K.PARTIAL, K.NOT_RUN]},
  [VOCAB.STORAGE_VERIFY_METHOD]: {exact: [K.O_DIRECT_SEQUENTIAL], prefixed: [K.DONTNEED_SEQUENTIAL]},
  [VOCAB.GPU_COMPUTE_GEMM_STATE]: {exact: [K.PASSED, K.FAILED], prefixed: [K.NOT_RUN]},
  [VOCAB.WORKERS_PIN_STATE]: {exact: [K.ATTEMPTED], prefixed: [K.NOT_ATTEMPTED, K.PIN_RESULT_UNREADABLE]},
  // fv70: `ran` = بلا متروك؛ `partial:time_budget` = أُبلغ نصف فحص واحد على الأقلّ وتُرك تشغيل؛ `not_run:<سبب>` متى لم يُبلَّغ أيّ نصف (ولو وُجد متروك).
  [VOCAB.CPU_KNOWN_ANSWER_STATE]: {exact: [K.RAN, K.PARTIAL_TIME_BUDGET], prefixed: [K.NOT_RUN]},
  // الجزء الخامس: alloc_failed للغربال أيضاً، وcancelled للحالتين (عقد :1616 في نسخة 450d9ed). self_test_failed للـSHA وحده (العقد: «self_test_failed (SHA)»).
  [VOCAB.CPU_KNOWN_ANSWER_SIEVE_STATUS]: {exact: [K.MATCH, K.MISMATCH, K.NOT_REACHED, K.ALLOC_FAILED, K.CANCELLED, K.SKIPPED_TIME_BUDGET], prefixed: NATIVE_FAILURES},
  [VOCAB.CPU_KNOWN_ANSWER_SHA256_STATUS]: {
    exact: [K.MATCH, K.MISMATCH, K.NOT_REACHED, K.SELF_TEST_FAILED, K.ALLOC_FAILED, K.CANCELLED, K.SKIPPED_TIME_BUDGET], prefixed: NATIVE_FAILURES,
  },
  // footerDiagnostics: «ok» أو «ok:<تفصيل>» أو «fail:<صنف الاستثناء>» (عقد ١.٧ :228)
  [VOCAB.FOOTER_DIAGNOSTIC]: {exact: [K.OK], prefixed: [K.OK, K.FAIL]},
  // endReason لـM-02: أربع قيم حرفية بلا بادئة (عقد :1472). ما خرج عنها يُقرأ UNRECOGNIZED ويُعلَن شذوذاً (القاعدة 25).
  [VOCAB.TOUCH_GRID_END_REASON]: {exact: Object.values(TOUCH_GRID_END_REASON), prefixed: []},
  // fv71: toolType = خمس قيم + `unknown:<n>` (القسم ف-03)؛ end أربع؛ densitySource ثلاث؛ displayedSuspects.kind ثلاث؛ roundedCornersState = not_available_api أو read_failed:<نصّ>؛
  // سبب الغياب = not_reported_by_device أو read_failed:<نصّ> (و api_below_<n> نمط يُحلَّل على حدة في القارئ).
  [VOCAB.TOUCH_PATH_TOOL_TYPE]: {exact: Object.values(TOUCH_PATH_TOOL_TYPE), prefixed: [TOUCH_PATH_TOOL_TYPE.UNKNOWN]},
  [VOCAB.TOUCH_PATH_STROKE_END]: {exact: Object.values(TOUCH_PATH_STROKE_END), prefixed: []},
  [VOCAB.TOUCH_PATH_DENSITY_SOURCE]: {exact: Object.values(TOUCH_PATH_DENSITY_SOURCE), prefixed: []},
  [VOCAB.TOUCH_PATH_DISPLAYED_SUSPECT_KIND]: {exact: [...TOUCH_PATH_DISPLAYED_SUSPECT_KINDS], prefixed: []},
  [VOCAB.TOUCH_PATH_ROUNDED_CORNERS_STATE]: {exact: Object.values(TOUCH_PATH_ROUNDED_CORNERS_STATE), prefixed: [K.READ_FAILED]},
  [VOCAB.TOUCH_PATH_ABSENT_REASON]: {exact: [TOUCH_PATH_ABSENT_REASON.NOT_REPORTED_BY_DEVICE], prefixed: [K.READ_FAILED]},
  [VOCAB.TOUCH_PATH_RESAMPLED_FLAG_STATE]: {exact: Object.values(TOUCH_PATH_RESAMPLED_FLAG_STATE), prefixed: []},
  // fv71 أزرار الصوت (ف-04): endReason خمس قيم؛ action قيمتان؛ detectionSource قيمتان — بلا بادئات
  [VOCAB.VOLUME_BUTTON_END_REASON]: {exact: Object.values(VOLUME_BUTTON_END_REASON), prefixed: []},
  [VOCAB.VOLUME_BUTTON_EVENT_ACTION]: {exact: Object.values(VOLUME_BUTTON_EVENT_ACTION), prefixed: []},
  [VOCAB.VOLUME_BUTTON_DETECTION_SOURCE]: {exact: Object.values(VOLUME_BUTTON_DETECTION_SOURCE), prefixed: []},
  // fv71 P6-13: powerSaveState ثلاث قيم حرفية؛ brightnessLock.state = applied حرفياً + apply_failed:<نصّ> + not_attempted:<سبب>؛ method قيمتان
  [VOCAB.POWER_SAVE_STATE]: {exact: Object.values(POWER_SAVE_STATE), prefixed: []},
  [VOCAB.BRIGHTNESS_LOCK_STATE]: {exact: [BRIGHTNESS_LOCK_STATE.APPLIED], prefixed: [BRIGHTNESS_LOCK_STATE.APPLY_FAILED, BRIGHTNESS_LOCK_STATE.NOT_ATTEMPTED]},
  [VOCAB.BRIGHTNESS_LOCK_METHOD]: {exact: Object.values(BRIGHTNESS_LOCK_METHOD), prefixed: []},
});

// تصنيف الخادم لنصّ سبب القناة (القاعدة 21: بنصّ الخطأ لا بصنف الاستثناء) — **اسم خادم**، لا يُكتب على السلك.
// الترتيب مهمّ: أوّل نمط يطابق.
const CHANNEL_REASON_KIND = deepFreeze({
  BLOCKED_ACCESS_DENIED: 'BLOCKED_ACCESS_DENIED', //          EACCES / Permission denied (عقد :487)
  ABSENT_NO_SUCH_FILE: 'ABSENT_NO_SUCH_FILE', //              ENOENT / No such file or directory
  UNSUPPORTED_BY_PLATFORM: 'UNSUPPORTED_BY_PLATFORM', //      Long.MIN_VALUE «unsupported marker»
  ERROR_TEXT_NOT_EXPOSED: 'ERROR_TEXT_NOT_EXPOSED', //        «the reader does not expose its error text» (عقد §٧ قيد 1 :1101)
  OTHER: 'OTHER',
});

// حالات المفتاح داخل الحمولة (قراءة الخادم له، لا حالة التطبيق).
const KEY_STATUS = deepFreeze({
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT', //                 غاب في ختم ≥ 68 ولم يُعلَن سببه في fieldsNotInFile
  NOT_IN_FILE: 'NOT_IN_FILE', //       سمّاه fieldsNotInFile: الملفّ أقدم من fv68 (عقد :1191)
  NOT_IN_FIELDS_VERSION: 'NOT_IN_FIELDS_VERSION', // الختم < 68 ولا fieldsNotInFile: المفتاح لم يوجد بعد
  ABSENT_DECLARED: 'ABSENT_DECLARED', //   غاب وتشرح غيابَه حالةٌ شقيقة حاضرة (not_run / not_read / not_computed / absent:…)
  REMOVED_IN_FV68: 'REMOVED_IN_FV68', //   حُذف بالعقد من ≥ 68 (maxCpuTemp، storageSlcCacheSizeMb، …Passed، cpuFmaErrors، cpuPrimeSieveCorrect): غيابه هو الحال
  WRONG_TYPE: 'WRONG_TYPE', //         حاضر بنوع لا يطابق العقد
});

// حالة درجة حرارة المعالج النهائية كما يُخرجها القارئ (cpuTemp.state) — وسمٌ يقرؤه من يتّخذ قراراً بقيمتها، فمصدر واحد (القاعدة 24).
const CPU_TEMP_STATE = deepFreeze({
  LIVE_READ_AT_FINALIZE: 'LIVE_READ_AT_FINALIZE', // قراءة حيّة عند الإنهاء (عقد ت-10)
  SAMPLER_MAX_CPU: 'SAMPLER_MAX_CPU', //             أقصى قيمة من الأخذ المتواصل
  ABSENT_DECLARED: 'ABSENT_DECLARED', //             غائبة بإعلان absent:<سبب> — القيمة null لا -1 ولا 0
});

// تصنيف الخادم لصفر الدورات القادم من EXTRA_CYCLE_COUNT — **اسم خادم**، لا يُكتب على السلك، **وقيمة واحدة مُصدَّرة** (القاعدة 24): يستوردها
// cycleCountClassification.js (القرار) ويقرؤها من يتّخذ قراراً بنتيجته (categoryStates.js، التوقيع). لا نسخة حرفية منها في أيّ ملفّ كود آخر.
// قرار المستخدم 2026-10-13 +03 (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): «صفر الدورات: الشرط كما كتبتَه (cycleCountState == "read" وcycleCountSource == "extra_api34"
// وcycleCount === 0 ⇐ unsupported:zero_from_extra_api34) معتمد، باسمه، ولكل العلامات.»
// **لماذا ليس الصفر وحده قياساً** (من تقرير الباحث 2026-10-11، منقول، غير متحقَّق من مصادره عندي): شيفرة AOSP تضع الحقل في كل بثّ ولا تعرّف له قيمة «غير معروف»،
// وتتركه صفراً حين لا يجد الـHAL عقدة cycle_count (وهذا غير متحقَّق على Samsung) — فالصفر من الحقل وحده لا يُميَّز عن صفر حقيقي. ولا تقول Samsung ولا Google في أيّ مصدر وُجد إن الصفر من
// EXTRA_CYCLE_COUNT على Samsung يعني «غير مدعوم»؛ وإعدادات الـS21 لا تعرض الدورات. فهذا **قرار خادم مبنيّ على قاعدة معلَنة** لا حقيقة موثَّقة من المصنِّع.
const CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 = 'unsupported:zero_from_extra_api34';

const READER_STATE = deepFreeze({
  UNRECOGNIZED: 'UNRECOGNIZED', // حالة نصّية خارج المفردة المعروفة
  ABSENT: 'ABSENT',
  NOT_APPLICABLE_FIELDS_VERSION: 'NOT_APPLICABLE_FIELDS_VERSION',
});

module.exports = {
  FIELDS_VERSION_68, FIELDS_VERSION_69, FIELDS_VERSION_70, FIELDS_VERSION_71,
  BASE_CHANNELS, BASE_CHANNEL_ORDER, BASE_CHANNEL_COUNT,
  CHARGE_COUNTER_CHANNEL, CHARGE_COUNTER_UNIT_AS_DECLARED, CPU_FREQ_POLICY_CHANNEL_RE,
  CHANNEL_READ_FAILURE_LIST_CAP, BATTERY_PAIRS_CAP, REASON_TEXT_CAP_CHARS,
  THROUGHPUT_UNIT_MIB_PER_S, APP_VERSIONS_READ_AS_MIB_PER_S, APP_VERSION_UNIT_UNDETERMINED, THROUGHPUT_UNIT_BASIS,
  FOOTER, SCAN_STILLNESS, BATTERY_PAIRS_STATE, BATTERY_PAIR_ELEMENT,
  THERMAL_HEADROOM_ELEMENT, THERMAL_STATUS_ELEMENT, CPU_POLICY_ELEMENT, CHANNEL_DISCOVERY,
  BATTERY_HEALTH, VERIFICATION, MEMORY_PHASE_WINDOW_ELEMENT, CPU_KNOWN_ANSWER_RUN_ELEMENT,
  TIME_SERIES, HEADER,
  MEASUREMENTS_KEY, MEASUREMENTS_UNENCODABLE_KEY, MEASUREMENTS_UNREADABLE_KEY, MEASURED_TEST_IDS,
  L02_MEASUREMENT_KEYS, STEP_SENSOR_MEASUREMENT_KEYS, TOUCH_GRID_MEASUREMENT_KEYS,
  TOUCH_GRID_END_REASON, TOUCH_GRID_TOUCH_STATE, TOUCH_GRID_ELAPSED_BASIS, TOUCH_GRID_GRID_BASIS,
  TOUCH_PATH_STATE, TOUCH_PATH_MEASUREMENT_KEYS, TOUCH_PATH_PRESENCE, TOUCH_PATH_FIELD_SPEC, TOUCH_PATH_STROKE_KEYS, TOUCH_PATH_STROKE_END, TOUCH_PATH_TOOL_TYPE,
  TOUCH_PATH_DENSITY_SOURCE, TOUCH_PATH_DENSITY_CHECK_CONDITIONS, TOUCH_PATH_RESAMPLED_FLAG_STATE, TOUCH_PATH_SUSPECT_KIND, TOUCH_PATH_DISPLAYED_SUSPECT_KINDS, TOUCH_PATH_SUSPECT_ELEMENT, TOUCH_PATH_PATH_CAP_KEYS, TOUCH_PATH_RECT_KEYS,
  TOUCH_PATH_ROUNDED_CORNER_KEYS, TOUCH_PATH_ROUNDED_CORNERS_STATE, TOUCH_PATH_ABSENT_REASON, TOUCH_PATH_ABSENT_REASON_API_BELOW_RE, TOUCH_PATH_TOUCH_MAJOR_REASON_KEY,
  TOUCH_PATH_DETECTOR, TOUCH_PATH_DETECTOR_NOTES, TOUCH_PATH_DETECTION_STATE, TOUCH_PATH_EXCLUSION, TOUCH_PATH_CELLS_CHECK,
  TOUCH_PATH_OUTPUT_LIST_CAP, TOUCH_PATH_EDGES_STATE, TOUCH_PATH_EDGE_BASIS, TOUCH_PATH_EDGE_SIDE, TOUCH_PATH_EDGE_EXIT_SOURCE,
  TOUCH_GRID_FIXED_DIMENSIONS, MANUAL_STATUS_PASS, TOUCH_PATH_DISPLAYED_STATE, TOUCH_GRID_ANSWER_STATE, TOUCH_GRID_PASS_RAW_RELATION, MODEL_HIDDEN_RAW_MEASUREMENT_KEYS,
  TOUCH_GRID_PATTERN_KEYS, TOUCH_GRID_PATTERN, TOUCH_GRID_PATTERN_STATE, TOUCH_GRID_REQUIRED_CELLS_BASIS, TOUCH_GRID_PATTERN_ANOMALY,
  VOLUME_BUTTON_TEST_IDS, VOLUME_BUTTON_MEASUREMENT_KEYS, VOLUME_BUTTON_PRESENCE, VOLUME_BUTTON_FIELD_SPEC, VOLUME_BUTTON_KEY_CODE, VOLUME_BUTTON_EVENT_KEY_CODES, VOLUME_BUTTON_EVENTS_CAP, VOLUME_BUTTON_EVENT_KEYS,
  VOLUME_BUTTON_EVENT_ACTION, VOLUME_BUTTON_END_REASON, VOLUME_BUTTON_DETECTION_SOURCE, VOLUME_BUTTON_STATE, VOLUME_BUTTON_PRESS_EVIDENCE, VOLUME_BUTTON_ANSWER_STATE,
  SCAN_CONDITIONS_KEYS, POWER_SAVE_STATE, BRIGHTNESS_LOCK_KEYS, BRIGHTNESS_LOCK_STATE, BRIGHTNESS_LOCK_METHOD, BATTERY_WINDOW_KEYS, BATTERY_WINDOW_LEGACY_MIN_PCT, BATTERY_LEVEL_UNKNOWN_SENTINEL,
  SCAN_CONDITIONS_STATE, POWER_SAVE_BASIS, BATTERY_WINDOW_BASIS, START_LEVEL_VS_WINDOW,
  STATE_KIND, VOCAB, STATE_VOCABULARY, CHANNEL_REASON_KIND, KEY_STATUS, CPU_TEMP_STATE, READER_STATE,
  CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34,
  SIEVE_REFERENCE_PRIME_COUNT_BY_LIMIT, SIEVE_LIMIT_WHEN_ABSENT_FV68_69, SIEVE_STATUS_KINDS_CARRYING_LIMIT,
};
