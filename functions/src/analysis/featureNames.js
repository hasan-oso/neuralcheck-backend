'use strict';

// ===================================================================
// featureNames.js — أسماء مكتبة الخصائص واللحظات وقيمها الحرفية في موضع واحد
// (V8 / PLAN-05 §٢-ب و§٣، الدفعة ٥، الصفّ S-B5، 2026-10-21 +03؛ القاعدة 24)
// ===================================================================
//
// القاعدة 24 بنصّها: «القيمة الحرفية التي يقوم عليها تمييز — وسم، مفتاح، اسم حقل — لها حكم رقم القياس: مصدر واحد مُصدَّر، لا نسخة في كل
// ملفّ.» كل ملفّ في هذه المكتبة (featureLibrary.js، moments.js، advisoryLetters.js) يستورد من هنا. ولا منطق هنا: ثوابت وقوائم مجمَّدة.
//
// **المصدر:** plan/PLAN-05-EVIDENCE-REPORT.md (مساحة العمل) — جدول الخصائص §٢-ب (:266-286)، جدول اللحظات §٣ (:331-337)،
// صيغة الاستشهاد §٣ (:343)، البنية §٤-أ (:352-361). ما سمّيتُه أنا (اسماً داخلياً للخادم لا يُكتب على السلك بعد) موسوم «اسم خادم» (S-B5).
//
// **ليس على السلك بعد:** لا شيء هنا يُرسَل إلى عميل ولا يُخزَّن في مستند اليوم. التخزين (featureStore) هو S-B6 والعرض S-B7 وحمولة
// النموذج S-B8 (PLAN-05 §١٠-أ :635-638). فإن وُصلت لاحقاً تُحدَّث docs/PROTOCOL_CONTRACT.md §٢-ب في الالتزام نفسه (القاعدتان 7 و39).

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

// ─── النسخ ────────────────────────────────────────────────────────────
// «كل تغيير معادلة يرفع featureSetVersion ويُعاد من الخام» (P5 :361). test/featureLibrary.test.js يحرس بصمة المعادلات والعتبات
// بحيث لا يتغيّر رقم أو معادلة بلا رفع هذا الرقم (القاعدة 39).
const FEATURE_SET_VERSION = 1;
const FORMULA_VERSION = 1;

// ─── أسماء الخصائص (P5 §٢-ب :266-286) ──────────────────────────────────
const FEATURE = deepFreeze({
  CPU_SUSTAINED_P3: 'cpu.sustained_p3', //            F1
  CPU_SUSTAINED_P5: 'cpu.sustained_p5', //            F2
  CPU_MIN_WINDOW_P5: 'cpu.min_window_p5', //          F3
  CPU_RECOVERY_P7: 'cpu.recovery_p7', //              F4
  CPU_PEAK_HOLD_S: 'cpu.peak_hold_s', //              F5 (جديدة)
  GPU_P4_MEDIAN_FPS: 'gpu.p4_median_fps', //          F6
  GPU_RATIO_P5_P4: 'gpu.ratio_p5_p4', //              F7
  GPU_DRIFT_P4: 'gpu.drift_p4', //                    F8
  STORAGE_IN_CACHE_MBPS: 'storage.in_cache_mbps', //  F9
  STORAGE_POST_CACHE_MBPS: 'storage.post_cache_mbps', // F10
  STORAGE_KNEE_GB: 'storage.knee_gb', //              F11
  BATTERY_TEMP_RISE_C: 'battery.temp_rise_c', //      F12
  BATTERY_TEMP_RATE_P345: 'battery.temp_rate_p345', // F13
  THERMAL_TEMP_PER_WH: 'thermal.temp_per_wh', //      F14 (جديدة)
  THERMAL_HEADROOM_PEAK: 'thermal.headroom_peak', //  F15
  THERMAL_STATUS_MAX: 'thermal.status_max', //        F16
  BATTERY_Q_INT_MAH: 'battery.q_int_mah', //          F17
  BATTERY_APPARENT_R: 'battery.apparent_r', //        F18 (مرفوضة بصيغتها)
  MEMORY_BW_MEDIAN: 'memory.bw_median', //            F19
  // منقولة من المختبر (P5 §٢-ج :307): «تُنقل إلى v7. قريبة من F14؛ وCV يُقاس». **اسم خادم** — الجدول لا يرقّمها.
  THERMAL_RESISTANCE: 'thermal.resistance_c_per_w',
});

// ─── الوحدات (حرفية لا تُستنتج من حجم الرقم — A38/A100) ───────────────────
const UNIT = deepFreeze({
  RATIO: 'ratio',
  SECONDS: 's',
  FPS: 'fps',
  GB: 'GB',
  CELSIUS: '°C',
  CELSIUS_PER_MINUTE: '°C/min',
  CELSIUS_PER_WH: '°C/Wh',
  CELSIUS_PER_WATT: '°C/W',
  MAH: 'mAh',
  HEADROOM: 'headroom', //        AOSP: 1.0 = SEVERE (P5 :73)؛ بلا وحدة فيزيائية
  THERMAL_STATUS: 'thermal_status_0_6', // NONE=0 … SHUTDOWN=6 (عقد fv68 ت-04 :462)
  ONE_PER_ONE: 'dimensionless',
  Z_NORMALIZED_DISTANCE: 'z_normalized_euclidean_distance', // L-4: وحدة الـdiscord
});

// ─── نوع الحكم المقترح لكل خاصّية (عمود «الحكم المقترح» P5 :266-286) ─────────
// **اقتراح يخضع لـ⛔ (د-٤)** — P5 :264. يقرؤه عارض التقرير لاحقاً (S-B7)؛ لا أثر له على الحساب هنا.
const JUDGEMENT = deepFreeze({
  RELATIVE_INTERNAL: 'RELATIVE_INTERNAL', //                    ● نسبي داخلي (F1–F4)
  BINARY_AOSP_GRADIENT: 'BINARY_AOSP_GRADIENT', //              ● ثنائي بتدرّج AOSP (F15)
  BINARY_REACHED_MODERATE: 'BINARY_REACHED_MODERATE', //        ● ثنائي «بلغ ≥ MODERATE» (F16)
  INFORMATION: 'INFORMATION', //                                معلومة لا حكم (F6، F9، F17، F19)
  ADVISORY_UNTIL_M5: 'ADVISORY_UNTIL_M5', //                    ◐ حتى M5 (F7، F8)
  ADVISORY: 'ADVISORY', //                                      ◐ إرشادي (F10، F12، F13)
  MOMENT_NOT_VERDICT: 'MOMENT_NOT_VERDICT', //                  لحظة لا حكم (F11)
  REJECTED_FORM: 'REJECTED_FORM', //                            مرفوضة بصيغتها؛ تُعاد بعد أزواج M3 (F18)
  PENDING_CV_MEASUREMENT: 'PENDING_CV_MEASUREMENT', //          «يُقاس قبل القبول» (F5، F14، والمنقولة من المختبر)
});

// ─── مفتاح الغياب المسمّى (القاعدة 22) ───────────────────────────────────
// الأسماء المشتركة مع findings.js مأخوذة منه حرفياً (INSUFFICIENT_SAMPLES، INSUFFICIENT_CADENCE، HARNESS_ERROR، ABSENT)؛ والباقي أسماء خادم لهذه المكتبة.
const REASON = deepFreeze({
  HARNESS_ERROR: 'HARNESS_ERROR', //                          لا عيّنات صالحة للحساب (findings.js: buildHarnessErrorFindings)
  HARNESS_VSYNC_LOCKED: 'HARNESS_VSYNC_LOCKED', //            الرسوميات مقفولة على vsync (حرفياً من findings.js computeGraphics؛ test/featureLibrary.test.js يحرس عدم انجراف الاسم — يمرّ بلا تغيير من ناتج findings، لذا لا يُستعمل في كود المكتبة)
  INSUFFICIENT_SAMPLES: 'INSUFFICIENT_SAMPLES', //            بوّابة EVIDENCE_MIN_SAMPLES
  INSUFFICIENT_CADENCE: 'INSUFFICIENT_CADENCE', //            بوّابة EVIDENCE_MIN_CADENCE_UPDATES
  NO_SAMPLES_IN_PHASE: 'NO_SAMPLES_IN_PHASE', //              المرحلة المطلوبة بلا عيّنة
  PEAK_NOT_REACHED: 'PEAK_NOT_REACHED', //                    F5: لا عيّنة ≥ 0.95×الذروة في الفحص (الذروة المعلنة فوق كل ما قيس)
  ABSENT_IN_FOOTER: 'ABSENT_IN_FOOTER', //                    المفتاح غير موجود في التذييل
  UNIT_UNDECLARED: 'UNIT_UNDECLARED', //                      وحدة العمود غير مُعلَنة أو غير معروفة (A100)
  UNIT_UNDETERMINED: 'UNIT_UNDETERMINED', //                  وحدة السرعة v[8]/v[9]/المقاطع لا تُحسم (resolveThroughputUnit)
  NO_KNEE_IN_SCAN: 'NO_KNEE_IN_SCAN', //                      لا ركبة تخزين في هذا الفحص (واقعة لا غياب بيانات)
  STORAGE_SEGMENTS_ABSENT: 'STORAGE_SEGMENTS_ABSENT', //      لا مقاطع تخزين
  ZERO_ENERGY: 'ZERO_ENERGY', //                              F14: تكامل القدرة صفر أو غير موجب
  ZERO_DENOMINATOR: 'ZERO_DENOMINATOR', //                    مقام صفر أو غير موجب (لا قسمة)
  POWER_ABSENT: 'POWER_ABSENT', //                            القدرة غائبة أو لا قيمة موجبة
  MEAN_POWER_BELOW_FLOOR: 'MEAN_POWER_BELOW_FLOOR', //        thermal_resistance: متوسّط القدرة دون الأرضية المنقولة من المختبر
  NO_VALID_BASELINE_TEMP: 'NO_VALID_BASELINE_TEMP', //        thermal_resistance: لا حرارة بداية صالحة في نافذة المرحلة 0
  FORMULA_REJECTED_AWAITING_M3_PAIRS: 'FORMULA_REJECTED_AWAITING_M3_PAIRS', // F18 (P5 :285)
  NON_NUMERIC_SAMPLE: 'NON_NUMERIC_SAMPLE', //                عيّنة غير رقمية في السلسلة (لا تُهمَل صامتةً)
  NO_NON_TRIVIAL_NEIGHBOR: 'NO_NON_TRIVIAL_NEIGHBOR', //      L-4: لا جار خارج منطقة الاستثناء لأيّ نافذة
  MATRIX_PROFILE_INPUT_INVALID: 'MATRIX_PROFILE_INPUT_INVALID', // L-4: مُدخل الدالّة نفسه غير صالح (نافذة/منطقة استثناء/سلسلة) — لا يقع بمُدخلات هذه المكتبة
  NO_THERMAL_STATUS_EVENTS: 'NO_THERMAL_STATUS_EVENTS', //    L-5: لا قائمة أحداث حالة حرارية (ختم < 68 مثلاً)
  THERMAL_STATUS_NOT_OK: 'THERMAL_STATUS_NOT_OK', //          L-5: حالة المستمع ليست ok (التفصيل في detail)
});

// ─── حالة الخاصّية ───────────────────────────────────────────────────────
const STATUS = deepFreeze({MEASURED: 'MEASURED', NOT_MEASURED: 'NOT_MEASURED'});

// ─── عتبات هذه المكتبة، كلٌّ بمصدره ووسمه (القاعدة 24؛ تُجمَّع في thresholdSetVersioned.js لاحقاً) ─
// الشكل {value, label, source} نفسه في findings.js:thresholdSet. «مبدئية — تحتاج معايرة» كما في بقيّة الملفّ.
const TENTATIVE = 'مبدئية — تحتاج معايرة';
const PARAMS = deepFreeze({
  // F5: «آخر لحظة التردّد فيها ≥ 0.95 × الذروة [خبير §٢]» (P5 :272).
  PEAK_HOLD_FRACTION: {value: 0.95, label: TENTATIVE, source: 'P5:272 — F5 «≥ 0.95 × الذروة» [خبير §٢]'},
  // L-1: «ينزل فيها أقصى نافذة 5 ث تحت 0.9 × الذروة ولا يعود حتى نهاية المرحلة [P04 M4 «ttl_over_0.9»]» (P5 :333).
  SUSTAINED_DROP_FRACTION: {value: 0.9, label: TENTATIVE, source: 'P5:333 — L-1 «تحت 0.9 × الذروة» [P04 M4 ttl_over_0.9]'},
  // L-2: «ودقّتها ±30 ث تُعلَن (كادنس البثّ 30.382–30.52 ث ✓)» (P5 :334).
  BATTERY_BROADCAST_PRECISION_S: {value: 30, label: 'مقيس', source: 'P5:334 — L-2 «±30 ث» (كادنس البثّ 30.382–30.52 ث ✓)'},
  // L-4: «النافذة 10 ث (40 عيّنة) [اجتهاد]» (P5 :336).
  ANOMALY_WINDOW_SAMPLES: {value: 40, label: TENTATIVE, source: 'P5:336 — L-4 «النافذة 10 ث (40 عيّنة) [اجتهاد]»'},
  // منطقة الاستثناء حول كل نافذة (المباريات التافهة): **اختيار الصفّ S-B5 نفسه، لا نصّ في الخطّة** — P5 لا يحدّدها. الأدبيّات: m/4 (stumpy) إلى m/2 (الورقة الأصلية).
  MATRIX_PROFILE_EXCLUSION_ZONE_FRACTION: {value: 0.5, label: TENTATIVE,
    source: 'اختيار S-B5 (القاعدة 45): P5 لا يحدّد منطقة الاستثناء؛ m/2 أشدّ من m/4 فلا مباراة تافهة تخفض الـdiscord'},
  // thermal_resistance المنقولة: أرضية متوسّط القدرة 2 واط وحدّ 20 عيّنة في المرحلة 5 من كود المختبر (layer1/features/thermal_resistance.js).
  // **ثابتان بلا مصدر خارجي** (المختبر نفسه): تُحمَلان كما هما وتُوسَمان، والحدّ الأدنى للعيّنات يُرفع إلى EVIDENCE_MIN_SAMPLES («أو أشدّ» P5 :247).
  THERMAL_RESISTANCE_MIN_MEAN_POWER_W: {value: 2.0, label: TENTATIVE,
    source: 'منقول من src/lab/layer1/features/thermal_resistance.js (mean_power_W < 2.0 ⟵ INSUFFICIENT_STRESS_DATA) — بلا مصدر خارجي'},
  THERMAL_RESISTANCE_BASELINE_WINDOW_MS: {value: 5000, label: TENTATIVE,
    source: 'منقول من src/lab/layer1/features/thermal_resistance.js (AMBIENT_WINDOW_MS = 5000) — بلا مصدر خارجي'},
});

// ─── اللحظات (P5 §٣ :331-337) ──────────────────────────────────────────
const MOMENT = deepFreeze({
  SUSTAINED_DROP: 'L-1', //        هبوط مستدام
  BATTERY_TEMP_PEAK: 'L-2', //     ذروة حرارة البطارية
  STORAGE_KNEE: 'L-3', //          ركبة التخزين
  WITHIN_PHASE_ANOMALY: 'L-4', //  شذوذ داخل المرحلة (مرشَّح بلا عرض: د-٨ P5 :794)
  THERMAL_STATE_REACHED: 'L-5', // بلوغ حالة حرارية
});
const MOMENT_IDS = Object.freeze(Object.values(MOMENT));
// templateKey: مفتاح قالب العرض الذي سيُسمّى في S-B8. **اسم خادم** لا نصّ مستخدم (لا نصّ جديد هنا).
const MOMENT_TEMPLATE_KEY = deepFreeze({
  'L-1': 'sustained_drop',
  'L-2': 'battery_temp_peak',
  'L-3': 'storage_knee',
  'L-4': 'within_phase_anomaly_candidate',
  'L-5': 'thermal_state_reached',
});

// حالات الحرارة الستّ المعلنة (AOSP PowerManager.THERMAL_STATUS_*؛ عقد fv68 ت-04 :462): NONE=0 … SHUTDOWN=6.
const THERMAL_STATUS = deepFreeze({NONE: 0, LIGHT: 1, MODERATE: 2, SEVERE: 3, CRITICAL: 4, EMERGENCY: 5, SHUTDOWN: 6});
// عتبتا L-5 («أوّل بلوغ لـMODERATE/SEVERE» P5 :337).
const THERMAL_REACH_THRESHOLDS = deepFreeze([
  {name: 'MODERATE', status: THERMAL_STATUS.MODERATE},
  {name: 'SEVERE', status: THERMAL_STATUS.SEVERE},
]);

// قنوات L-4 الكثيفة: «التيّار، والتردّد، والاستخدام، والقدرة» (P5 :328) = v3/v5/v6/v7 في ختم 67 (P5 :336 «v3، v5، v6، v7»). الأسماء من fv68Names.BASE_CHANNELS (القاعدة 24).
const ANOMALY_CHANNEL_KEYS = Object.freeze(['BATTERY_CURRENT_UA', 'CPU_FREQ_MAX_KHZ', 'CPU_USAGE_PCT', 'PACKAGE_POWER_MW']);

module.exports = {
  FEATURE_SET_VERSION, FORMULA_VERSION,
  FEATURE, UNIT, JUDGEMENT, REASON, STATUS, PARAMS, TENTATIVE,
  MOMENT, MOMENT_IDS, MOMENT_TEMPLATE_KEY, THERMAL_STATUS, THERMAL_REACH_THRESHOLDS,
  ANOMALY_CHANNEL_KEYS,
};
