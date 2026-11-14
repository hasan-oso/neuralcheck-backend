'use strict';

// ===================================================================
// featureLibrary.js — مكتبة الخصائص (V8 / PLAN-05 §٢-ب، الدفعة ٥، الصفّ S-B5، 2026-10-21 +03)
// ===================================================================
// يحسب خصائص الفحص F1..F19 (والمنقولة من المختبر) من fingerprint واحد، **بلا شبكة ولا نموذج ولا حالة مشتركة**، ويُخرج لكل خاصّية سجلّاً
//   {id, name, value, unit, status, reason, gate:{passed, reason}, formulaVersion, judgement}
// بنفس الشكل الذي سمّته الخطّة لمخزن الخصائص (P5 §٤-أ :355: features{name:{value, unit, gate:{passed, reason}, formulaVersion}}).
//
// ما يفعله هذا الملفّ وما لا يفعله (القاعدة 14: الفرق عن نصّ الخطّة مذكور):
//   • الخطّة: «توسيع findings.js» (P5 :635). هنا **وحدة مجاورة تستهلك findings.js ولا تضيف مفتاحاً إلى ناتج computeFindings**: ناتجه يمرّ اليوم
//     إلى حمولة النموذج وعارض التقرير (buildV7Payload.js، reportShapeV7.js، v7ModelPayloadWhitelist.js) وإلى عيّنات ذهبية مجمَّدة، وشكل جديد فيه
//     يحتاج تحديث كل قارئ له (القاعدة 25) — وذلك عمل S-B7/S-B8 لا S-B5. فلا خاصّية ولا لحظة تصل تقريراً ولا نموذجاً بعد هذا الصفّ.
//   • القائمة (F1–F4، F6–F13، F15–F17، F19) تُقرأ من ناتج findings.js نفسه: **معادلة واحدة لا نسختان** (القاعدة 24). والجديدة (F5، F14،
//     thermal.resistance) تُحسب هنا من الأعمدة بأسمائها.
//   • لا تخزين (featureStore = S-B6) ولا عدّ بالأجهزة (يحتاج مفتاح جهاز صالحاً: P5 §٤-ب)، ولا CV داخل الجهاز (يحتاج فحوصاً مكرّرة لجهاز
//     واحد: P5 :252). فكل خاصّية حكمُها المقترح (judgement) اقتراحٌ يخضع لـ⛔ د-٤، وقبولها بـCV معلَّق: classifyStability أدناه تُطبَّق حين تصل البيانات.
//
// شروط القبول الخمسة (P5 §٢-أ :242-256) وأين تُغطّى:
//   ١ قارئ يُعلن ما طلبه ولم يجده: كل غياب = {status:'NOT_MEASURED', reason:<اسم مسمّى>} — لا صفر ولا «طبيعي» (REASON في featureNames.js).
//   ٢ بوّابة صلاحية مسمّاة: EVIDENCE_MIN_SAMPLES وEVIDENCE_MIN_CADENCE_UPDATES (findings.js) — تُطبَّق كما هي في الخصائص القائمة، وعلى الجديدة بنفسها.
//   ٣ اختبار ذهبي من عيّنة حقيقية عند نقطة القراءة، ويمرّ بالقارئ كاملاً: test/featureLibrary.test.js (الفحوص الحقيقية الأربعة + مُنتِجات fv71).
//   ٤ CV داخل الجهاز: **معلَّق** (لا فحوص مكرّرة لجهاز واحد في هذا المستودع) — classifyStability تستورد UNSTABLE_CV_THRESHOLD_PCT (د-٤ ✓ معتمد، القاعدة 24).
//   ٥ العدّ بالأجهزة: S-B6.

const N = require('./fv68Names');
const {readFv68} = require('./fv68Reader');
const {
  computeFindings, passesEvidenceGate, UNSTABLE_CV_THRESHOLD_PCT, PHASE_NAMES, EVIDENCE_MIN_SAMPLES, _internal: FI,
} = require('./findings');
const {readScanColumns, indicesInPhase, allFinite, unitScale, VOLT_UNITS, AMPERE_UNITS, SECOND_UNITS, WATT_UNITS} = require('./scanColumns');
const {FEATURE, UNIT, JUDGEMENT, REASON, STATUS, PARAMS, FEATURE_SET_VERSION, FORMULA_VERSION} = require('./featureNames');

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

// ─── السجلّ: ترتيب الخصائص ومعرّفاتها وأحكامها المقترحة (P5 :266-286) ────────────
const SOURCE = deepFreeze({FINDINGS: 'FINDINGS', NEW: 'NEW', LAB_TRANSFER: 'LAB_TRANSFER', REJECTED: 'REJECTED'});
const FEATURE_REGISTRY = deepFreeze([
  {id: 'F1', name: FEATURE.CPU_SUSTAINED_P3, unit: UNIT.RATIO, judgement: JUDGEMENT.RELATIVE_INTERNAL, source: SOURCE.FINDINGS},
  {id: 'F2', name: FEATURE.CPU_SUSTAINED_P5, unit: UNIT.RATIO, judgement: JUDGEMENT.RELATIVE_INTERNAL, source: SOURCE.FINDINGS},
  {id: 'F3', name: FEATURE.CPU_MIN_WINDOW_P5, unit: UNIT.RATIO, judgement: JUDGEMENT.RELATIVE_INTERNAL, source: SOURCE.FINDINGS},
  {id: 'F4', name: FEATURE.CPU_RECOVERY_P7, unit: UNIT.RATIO, judgement: JUDGEMENT.RELATIVE_INTERNAL, source: SOURCE.FINDINGS},
  {id: 'F5', name: FEATURE.CPU_PEAK_HOLD_S, unit: UNIT.SECONDS, judgement: JUDGEMENT.PENDING_CV_MEASUREMENT, source: SOURCE.NEW},
  {id: 'F6', name: FEATURE.GPU_P4_MEDIAN_FPS, unit: UNIT.FPS, judgement: JUDGEMENT.INFORMATION, source: SOURCE.FINDINGS},
  {id: 'F7', name: FEATURE.GPU_RATIO_P5_P4, unit: UNIT.RATIO, judgement: JUDGEMENT.ADVISORY_UNTIL_M5, source: SOURCE.FINDINGS},
  {id: 'F8', name: FEATURE.GPU_DRIFT_P4, unit: UNIT.RATIO, judgement: JUDGEMENT.ADVISORY_UNTIL_M5, source: SOURCE.FINDINGS},
  {id: 'F9', name: FEATURE.STORAGE_IN_CACHE_MBPS, unit: null, judgement: JUDGEMENT.INFORMATION, source: SOURCE.FINDINGS}, //   الوحدة من القارئ
  {id: 'F10', name: FEATURE.STORAGE_POST_CACHE_MBPS, unit: null, judgement: JUDGEMENT.ADVISORY, source: SOURCE.FINDINGS},
  {id: 'F11', name: FEATURE.STORAGE_KNEE_GB, unit: UNIT.GB, judgement: JUDGEMENT.MOMENT_NOT_VERDICT, source: SOURCE.FINDINGS},
  {id: 'F12', name: FEATURE.BATTERY_TEMP_RISE_C, unit: UNIT.CELSIUS, judgement: JUDGEMENT.ADVISORY, source: SOURCE.FINDINGS},
  {id: 'F13', name: FEATURE.BATTERY_TEMP_RATE_P345, unit: UNIT.CELSIUS_PER_MINUTE, judgement: JUDGEMENT.ADVISORY, source: SOURCE.FINDINGS},
  {id: 'F14', name: FEATURE.THERMAL_TEMP_PER_WH, unit: UNIT.CELSIUS_PER_WH, judgement: JUDGEMENT.PENDING_CV_MEASUREMENT, source: SOURCE.NEW},
  {id: 'F15', name: FEATURE.THERMAL_HEADROOM_PEAK, unit: UNIT.HEADROOM, judgement: JUDGEMENT.BINARY_AOSP_GRADIENT, source: SOURCE.FINDINGS},
  {id: 'F16', name: FEATURE.THERMAL_STATUS_MAX, unit: UNIT.THERMAL_STATUS, judgement: JUDGEMENT.BINARY_REACHED_MODERATE, source: SOURCE.FINDINGS},
  {id: 'F17', name: FEATURE.BATTERY_Q_INT_MAH, unit: UNIT.MAH, judgement: JUDGEMENT.INFORMATION, source: SOURCE.FINDINGS},
  {id: 'F18', name: FEATURE.BATTERY_APPARENT_R, unit: null, judgement: JUDGEMENT.REJECTED_FORM, source: SOURCE.REJECTED},
  {id: 'F19', name: FEATURE.MEMORY_BW_MEDIAN, unit: null, judgement: JUDGEMENT.INFORMATION, source: SOURCE.FINDINGS}, //     الوحدة من القارئ
  {id: 'LAB-thermal_resistance', name: FEATURE.THERMAL_RESISTANCE, unit: UNIT.CELSIUS_PER_WATT, judgement: JUDGEMENT.PENDING_CV_MEASUREMENT, source: SOURCE.LAB_TRANSFER},
]);
const DEF = Object.freeze(Object.fromEntries(FEATURE_REGISTRY.map((d) => [d.name, d])));

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function record(def, value, unit, status, reason) {
  const measured = status === STATUS.MEASURED;
  return {
    id: def.id, name: def.name, value: measured ? value : null, unit: unit === undefined ? def.unit : unit,
    status, reason: measured ? null : reason,
    gate: {passed: measured, reason: measured ? null : reason},
    formulaVersion: FORMULA_VERSION, judgement: def.judgement,
  };
}
const ok = (name, value, unit) => record(DEF[name], value, unit, STATUS.MEASURED, null);
const nm = (name, reason, unit) => record(DEF[name], null, unit, STATUS.NOT_MEASURED, reason);

/**
 * شرط ثبات الخاصّية داخل الجهاز (P5 §٢-أ.4 :251-255، §١-د-٢ :159): CV ≤ UNSTABLE_CV_THRESHOLD_PCT (15) ⟵ مستقرّة (● نسبي داخلي)، وفوقه ⟵ غير مستقرّة (◐ إرشادي).
 * الغياب لا يُقرأ ثباتاً (القاعدة 22): CV غير مقيس ⟵ NOT_MEASURED.
 * @param {number|null} cvPct معامل التغيّر % للخاصّية على فحوص جهاز واحد مكرّرة (يُحسب خارج هذا الملفّ حين تتوفّر الفحوص المكرّرة).
 * @return {string} 'STABLE' | 'UNSTABLE' | 'NOT_MEASURED'
 */
function classifyStability(cvPct) {
  if (typeof cvPct !== 'number' || !Number.isFinite(cvPct) || cvPct < 0) return STATUS.NOT_MEASURED;
  return cvPct <= UNSTABLE_CV_THRESHOLD_PCT ? 'STABLE' : 'UNSTABLE';
}

const throughputUnitOf = (fv68) => (fv68 && fv68.throughputUnit && typeof fv68.throughputUnit.unit === 'string' && fv68.throughputUnit.unit.trim() !== '' ?
  fv68.throughputUnit.unit : null);

// ─── الخصائص القائمة: تُقرأ من ناتج findings.js ──────────────────────────────

function sustainedFeature(name, findings, pick) {
  const s = findings.sustainedCeiling;
  if (!s || s.status !== STATUS.MEASURED) return nm(name, (s && s.notMeasuredReason) || REASON.INSUFFICIENT_SAMPLES);
  const v = num(pick(s));
  return v === null ? nm(name, REASON.NO_SAMPLES_IN_PHASE) : ok(name, v);
}

function graphicsFeatures(findings, sc) {
  const g = findings.graphics;
  const out = {};
  const gate = (name) => (g && g.status === STATUS.MEASURED ? null : nm(name, (g && g.notMeasuredReason) || REASON.HARNESS_ERROR));
  const fpsUnit = sc.unitOf(N.BASE_CHANNELS.GPU_FPS);
  out[FEATURE.GPU_P4_MEDIAN_FPS] = gate(FEATURE.GPU_P4_MEDIAN_FPS) ||
    (fpsUnit === null ? nm(FEATURE.GPU_P4_MEDIAN_FPS, REASON.UNIT_UNDECLARED) : ok(FEATURE.GPU_P4_MEDIAN_FPS, g.phase4.median, fpsUnit));
  out[FEATURE.GPU_RATIO_P5_P4] = gate(FEATURE.GPU_RATIO_P5_P4) || ok(FEATURE.GPU_RATIO_P5_P4, g.ratioPhase5OverPhase4);
  out[FEATURE.GPU_DRIFT_P4] = gate(FEATURE.GPU_DRIFT_P4) ||
    (num(g.phase4DriftRatio) === null ? nm(FEATURE.GPU_DRIFT_P4, REASON.ZERO_DENOMINATOR) : ok(FEATURE.GPU_DRIFT_P4, g.phase4DriftRatio));
  return out;
}

function storageFeatures(findings, fv68) {
  const st = findings.storage;
  const out = {};
  const unit = throughputUnitOf(fv68);
  if (!st || st.status !== 'STATE_ONLY') {
    const reason = st && st.reason === 'ABSENT' ? REASON.STORAGE_SEGMENTS_ABSENT : ((st && st.reason) || REASON.HARNESS_ERROR);
    for (const n of [FEATURE.STORAGE_IN_CACHE_MBPS, FEATURE.STORAGE_POST_CACHE_MBPS, FEATURE.STORAGE_KNEE_GB]) out[n] = nm(n, reason);
    return out;
  }
  out[FEATURE.STORAGE_IN_CACHE_MBPS] = unit === null ? nm(FEATURE.STORAGE_IN_CACHE_MBPS, REASON.UNIT_UNDETERMINED) :
    ok(FEATURE.STORAGE_IN_CACHE_MBPS, st.inCacheMbps, unit);
  out[FEATURE.STORAGE_POST_CACHE_MBPS] = st.postCacheMbps === null ? nm(FEATURE.STORAGE_POST_CACHE_MBPS, REASON.NO_KNEE_IN_SCAN) :
    (unit === null ? nm(FEATURE.STORAGE_POST_CACHE_MBPS, REASON.UNIT_UNDETERMINED) : ok(FEATURE.STORAGE_POST_CACHE_MBPS, st.postCacheMbps, unit));
  out[FEATURE.STORAGE_KNEE_GB] = st.kneeGb === null ? nm(FEATURE.STORAGE_KNEE_GB, REASON.NO_KNEE_IN_SCAN) : ok(FEATURE.STORAGE_KNEE_GB, st.kneeGb);
  return out;
}

function thermalAndBatteryFeatures(findings, sc) {
  const out = {};
  const th = findings.thermal;
  const rise = th && th.batteryTempRise;
  const riseOk = rise && rise.status === STATUS.MEASURED;
  out[FEATURE.BATTERY_TEMP_RISE_C] = riseOk ? ok(FEATURE.BATTERY_TEMP_RISE_C, rise.valueC) :
    nm(FEATURE.BATTERY_TEMP_RISE_C, (rise && rise.reason) || REASON.HARNESS_ERROR);
  if (!riseOk) out[FEATURE.BATTERY_TEMP_RATE_P345] = nm(FEATURE.BATTERY_TEMP_RATE_P345, (rise && rise.reason) || REASON.HARNESS_ERROR);
  else if (num(rise.ratePerMinPhases345) === null) out[FEATURE.BATTERY_TEMP_RATE_P345] = nm(FEATURE.BATTERY_TEMP_RATE_P345, REASON.NO_SAMPLES_IN_PHASE);
  else out[FEATURE.BATTERY_TEMP_RATE_P345] = ok(FEATURE.BATTERY_TEMP_RATE_P345, rise.ratePerMinPhases345);

  const headroom = num(th && th.thermalHeadroomPeak);
  out[FEATURE.THERMAL_HEADROOM_PEAK] = headroom === null ? nm(FEATURE.THERMAL_HEADROOM_PEAK, REASON.ABSENT_IN_FOOTER) : ok(FEATURE.THERMAL_HEADROOM_PEAK, headroom);
  const statusMax = num(th && th.thermalStatusMax);
  out[FEATURE.THERMAL_STATUS_MAX] = statusMax === null ? nm(FEATURE.THERMAL_STATUS_MAX, REASON.ABSENT_IN_FOOTER) : ok(FEATURE.THERMAL_STATUS_MAX, statusMax);

  // F17: coulombMah في findings.js يفترض µA وms — يُتحقَّق من الوحدتين المعلنتين هنا (A100) فلا يُقرأ الافتراض نجاحاً.
  const q = num(findings.battery && findings.battery.qIntMah);
  const unitsOk = unitScale(sc.unitOf(N.BASE_CHANNELS.BATTERY_CURRENT_UA), AMPERE_UNITS) === 1e-6 &&
    unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS) === 1e-3;
  if (!unitsOk) out[FEATURE.BATTERY_Q_INT_MAH] = nm(FEATURE.BATTERY_Q_INT_MAH, REASON.UNIT_UNDECLARED);
  else if (q === null) out[FEATURE.BATTERY_Q_INT_MAH] = nm(FEATURE.BATTERY_Q_INT_MAH, REASON.INSUFFICIENT_SAMPLES);
  else out[FEATURE.BATTERY_Q_INT_MAH] = ok(FEATURE.BATTERY_Q_INT_MAH, q);
  return out;
}

function memoryFeature(findings, fv68) {
  const unit = throughputUnitOf(fv68);
  const byPhase = findings.channels && findings.channels[N.BASE_CHANNELS.MEMORY_BANDWIDTH_MBPS];
  const stats = byPhase && byPhase[PHASE_NAMES[2]];
  if (!stats) return nm(FEATURE.MEMORY_BW_MEDIAN, REASON.NO_SAMPLES_IN_PHASE);
  if (!passesEvidenceGate(stats.n, stats.sourceCadenceUpdates)) {
    return nm(FEATURE.MEMORY_BW_MEDIAN, stats.n < EVIDENCE_MIN_SAMPLES ? REASON.INSUFFICIENT_SAMPLES : REASON.INSUFFICIENT_CADENCE);
  }
  return unit === null ? nm(FEATURE.MEMORY_BW_MEDIAN, REASON.UNIT_UNDETERMINED) : ok(FEATURE.MEMORY_BW_MEDIAN, stats.median, unit);
}

// ─── الخصائص الجديدة (تُحسب هنا من الأعمدة بأسمائها) ──────────────────────────

// F5 `cpu.peak_hold_s` — «آخر لحظة التردّد فيها ≥ 0.95 × الذروة [خبير §٢]» (P5 :272، قناة v5، «قابلة 6/6»). القراءة الحرفية: على الفحص كلّه، بالثواني منذ بدء الفحص (v[0] «ms منذ بدء
// الفحص» — عقد fv68 ت-04 :462)، والذروة هي نفسها ذروة F1–F4 (findings.sustainedCeiling.peakFreqKhz: peakBigFreqKhzAnywhere ثم أقصى العيّنات). **تحقّقتُ من هذه القراءة بمرجع مستقلّ قائم:**
// EXPECTED-timeseries_stats*.json يحمل last_time_freq_ge_2600MHz_s (151 · 141 · 120 ث على الفحوص الثلاثة ذات الذروة 2.73 GHz) — العتبة 0.95×2730000 = 2593.5 MHz تقع بين درجتَي التردّد
// 2530 و2600 MHz فتطابق «≥ 2600 MHz» (test/featureLibrary.test.js). بوّابتها بوّابة الأدلّة على قناة v5 في الفحص كلّه (EVIDENCE_MIN_SAMPLES وEVIDENCE_MIN_CADENCE_UPDATES).
// (مسودّتي الأولى قصرتها على المرحلة 3 باختيار مني؛ أسقطتُها حين ظهر أنّ المرجع القائم يحسبها على الفحص كلّه وأنّ المرحلة 3 لا تبلغ 0.95×الذروة في ثلاثة من الفحوص الأربعة.)
function computePeakHold(findings, sc) {
  const s = findings.sustainedCeiling;
  const peak = num(s && s.peakFreqKhz);
  if (peak === null) return nm(FEATURE.CPU_PEAK_HOLD_S, REASON.HARNESS_ERROR);
  if (peak <= 0) return nm(FEATURE.CPU_PEAK_HOLD_S, REASON.ZERO_DENOMINATOR);
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  if (tScale === null) return nm(FEATURE.CPU_PEAK_HOLD_S, REASON.UNIT_UNDECLARED);
  const all = Array.from({length: sc.n}, (_, i) => i);
  const freq = sc.col(N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ);
  if (!allFinite(freq, all) || !allFinite(sc.t, all)) return nm(FEATURE.CPU_PEAK_HOLD_S, REASON.NON_NUMERIC_SAMPLE);
  if (!passesEvidenceGate(sc.n, FI.changes(freq))) {
    return nm(FEATURE.CPU_PEAK_HOLD_S, sc.n < EVIDENCE_MIN_SAMPLES ? REASON.INSUFFICIENT_SAMPLES : REASON.INSUFFICIENT_CADENCE);
  }
  const threshold = PARAMS.PEAK_HOLD_FRACTION.value * peak;
  let last = -1;
  for (let i = 0; i < sc.n; i++) if (freq[i] >= threshold) last = i;
  if (last === -1) return nm(FEATURE.CPU_PEAK_HOLD_S, REASON.PEAK_NOT_REACHED);
  return ok(FEATURE.CPU_PEAK_HOLD_S, sc.t[last] * tScale);
}

// تكامل |V·I| بالـWh على الفحص كلّه (شبه المنحرف، كـcoulombMah): الوحدات من variables[].unit المعلنة (mV/µA/ms) لا من حجم الرقم.
function energyWh(sc) {
  const vScale = unitScale(sc.unitOf(N.BASE_CHANNELS.BATTERY_VOLTAGE_MV), VOLT_UNITS);
  const iScale = unitScale(sc.unitOf(N.BASE_CHANNELS.BATTERY_CURRENT_UA), AMPERE_UNITS);
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  if (vScale === null || iScale === null || tScale === null) return {reason: REASON.UNIT_UNDECLARED};
  const v = sc.col(N.BASE_CHANNELS.BATTERY_VOLTAGE_MV);
  const c = sc.col(N.BASE_CHANNELS.BATTERY_CURRENT_UA);
  const all = Array.from({length: sc.n}, (_, i) => i);
  if (!allFinite(v, all) || !allFinite(c, all) || !allFinite(sc.t, all)) return {reason: REASON.NON_NUMERIC_SAMPLE};
  let joules = 0;
  for (let i = 0; i < sc.n - 1; i++) {
    const p0 = Math.abs(v[i] * vScale * c[i] * iScale);
    const p1 = Math.abs(v[i + 1] * vScale * c[i + 1] * iScale);
    joules += (p0 + p1) / 2 * (sc.t[i + 1] - sc.t[i]) * tScale;
  }
  return {wh: joules / 3600};
}

// F14 `thermal.temp_per_wh` — «ارتفاع الحرارة ÷ ∫|V·I|dt بالـWh [خبير §١]» (P5 :281). الارتفاع = تعريف F12 نفسه (أقصى − أوّل حرارة بطارية، ببوّابة F12)؛
// الطاقة على الفحص كلّه. **تنبيه (القاعدة 14):** عمود «القنوات» في الخطّة يقول «v1، v7» والصيغة نصّاً ∫|V·I| (القناتان v2 وv3)؛ المحسوب هنا من
// v2 وv3 نصّاً بالصيغة. وعلى الفحوص الحقيقية الأربعة v7 (package_power_mw) = |V·I| بالـmW (فرق ≤ 1 mW في كل عيّنة: test/featureLibrary.test.js)، فالنتيجة واحدة.
function computeTempPerWh(findings, sc) {
  const rise = findings.thermal && findings.thermal.batteryTempRise;
  if (!rise || rise.status !== STATUS.MEASURED) return nm(FEATURE.THERMAL_TEMP_PER_WH, (rise && rise.reason) || REASON.HARNESS_ERROR);
  const e = energyWh(sc);
  if (e.reason) return nm(FEATURE.THERMAL_TEMP_PER_WH, e.reason);
  if (!(e.wh > 0)) return nm(FEATURE.THERMAL_TEMP_PER_WH, REASON.ZERO_ENERGY);
  return ok(FEATURE.THERMAL_TEMP_PER_WH, rise.valueC / e.wh);
}

// thermal_resistance المنقولة من المختبر (P5 :307 «تُنقل إلى v7. قريبة من F14؛ وCV يُقاس») — **المعادلة فقط**: R = (أقصى حرارة في المرحلة 5 − حرارة البداية) ÷ متوسّط القدرة بالواط.
// حرارة البداية = متوسّط حرارة البطارية الموجبة في أول 5 ث من المرحلة 0 (نافذة المختبر). حرارة الجلد غائبة من الأعمدة الأساسية (P5 :308) فالمصدر حرارة البطارية.
// **لا تُنقل تسميات المختبر** (excellent/healthy/marginal…): عتباتها بلا مصدر (القاعدة 24/«وكل حدّ بمصدره»). بوّابتها: بوّابة F12 (كادنس الحرارة)، و≥ EVIDENCE_MIN_SAMPLES في
// المرحلة 5 (المختبر كان 20 والخطّة «أو أشدّ»)، وأرضية متوسّط القدرة (من المختبر، موسومة مبدئية بلا مصدر).
function computeThermalResistance(findings, sc) {
  const rise = findings.thermal && findings.thermal.batteryTempRise;
  if (!rise || rise.status !== STATUS.MEASURED) return nm(FEATURE.THERMAL_RESISTANCE, (rise && rise.reason) || REASON.HARNESS_ERROR);
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  const pScale = unitScale(sc.unitOf(N.BASE_CHANNELS.PACKAGE_POWER_MW), WATT_UNITS);
  if (tScale === null || pScale === null) return nm(FEATURE.THERMAL_RESISTANCE, REASON.UNIT_UNDECLARED);
  const idx0 = indicesInPhase(sc.ph, 0);
  const idx5 = indicesInPhase(sc.ph, 5);
  if (idx0.length === 0 || idx5.length === 0) return nm(FEATURE.THERMAL_RESISTANCE, REASON.NO_SAMPLES_IN_PHASE);
  if (idx5.length < EVIDENCE_MIN_SAMPLES) return nm(FEATURE.THERMAL_RESISTANCE, REASON.INSUFFICIENT_SAMPLES);
  const temp = sc.col(N.BASE_CHANNELS.BATTERY_TEMP_C);
  const power = sc.col(N.BASE_CHANNELS.PACKAGE_POWER_MW);
  if (!allFinite(temp, idx0) || !allFinite(temp, idx5) || !allFinite(power, idx5) || !allFinite(sc.t, idx0)) {
    return nm(FEATURE.THERMAL_RESISTANCE, REASON.NON_NUMERIC_SAMPLE);
  }
  const t0 = sc.t[idx0[0]];
  const windowMs = PARAMS.THERMAL_RESISTANCE_BASELINE_WINDOW_MS.value;
  const baseline = idx0.filter((i) => sc.t[i] - t0 <= windowMs && temp[i] > 0).map((i) => temp[i]);
  if (baseline.length === 0) return nm(FEATURE.THERMAL_RESISTANCE, REASON.NO_VALID_BASELINE_TEMP);
  const temps5 = idx5.map((i) => temp[i]).filter((x) => x > 0);
  const powers5 = idx5.map((i) => power[i]).filter((x) => x > 0);
  if (temps5.length === 0) return nm(FEATURE.THERMAL_RESISTANCE, REASON.NO_VALID_BASELINE_TEMP);
  if (powers5.length === 0) return nm(FEATURE.THERMAL_RESISTANCE, REASON.POWER_ABSENT);
  const meanPowerW = (powers5.reduce((a, b) => a + b, 0) / powers5.length) * pScale;
  if (meanPowerW < PARAMS.THERMAL_RESISTANCE_MIN_MEAN_POWER_W.value) return nm(FEATURE.THERMAL_RESISTANCE, REASON.MEAN_POWER_BELOW_FLOOR);
  const ambient = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  return ok(FEATURE.THERMAL_RESISTANCE, (Math.max(...temps5) - ambient) / meanPowerW);
}

// ─── نقطة الدخول ────────────────────────────────────────────────────────

/**
 * @param {Object} input {fingerprint, findings?, fv68?} — findings وfv68 اختياريان (تُحسبان من fingerprint إن غابا؛ المسار الحقيقي يمرّر ما حسبه runAnalysisInternal).
 * @return {Object} {featureSetVersion, status, reason, features: {[name]: سجلّ}} — كل خاصّية في السجلّ حاضرة دائماً (الغياب حالة مسمّاة).
 */
function computeFeatureLibrary(input) {
  const fingerprint = input && input.fingerprint;
  const findings = (input && input.findings) || computeFindings(fingerprint);
  const fv68 = (input && input.fv68) || readFv68(fingerprint);
  const sc = readScanColumns(fingerprint);
  const features = {};

  if (!findings || findings.status !== STATUS.MEASURED || !sc.ok) {
    for (const d of FEATURE_REGISTRY) features[d.name] = d.source === SOURCE.REJECTED ? nm(d.name, REASON.FORMULA_REJECTED_AWAITING_M3_PAIRS) : nm(d.name, REASON.HARNESS_ERROR);
    return {featureSetVersion: FEATURE_SET_VERSION, status: STATUS.NOT_MEASURED, reason: REASON.HARNESS_ERROR, features};
  }

  Object.assign(features, {
    [FEATURE.CPU_SUSTAINED_P3]: sustainedFeature(FEATURE.CPU_SUSTAINED_P3, findings, (s) => s.phase3 && s.phase3.meanWindowMaxRatio),
    [FEATURE.CPU_SUSTAINED_P5]: sustainedFeature(FEATURE.CPU_SUSTAINED_P5, findings, (s) => s.phase5 && s.phase5.meanWindowMaxRatio),
    [FEATURE.CPU_MIN_WINDOW_P5]: sustainedFeature(FEATURE.CPU_MIN_WINDOW_P5, findings, (s) => s.phase5 && s.phase5.minWindowMaxRatio),
    [FEATURE.CPU_RECOVERY_P7]: sustainedFeature(FEATURE.CPU_RECOVERY_P7, findings, (s) => s.recoveryPhase7Ratio),
    [FEATURE.CPU_PEAK_HOLD_S]: computePeakHold(findings, sc),
    ...graphicsFeatures(findings, sc),
    ...storageFeatures(findings, fv68),
    ...thermalAndBatteryFeatures(findings, sc),
    [FEATURE.THERMAL_TEMP_PER_WH]: computeTempPerWh(findings, sc),
    [FEATURE.BATTERY_APPARENT_R]: nm(FEATURE.BATTERY_APPARENT_R, REASON.FORMULA_REJECTED_AWAITING_M3_PAIRS),
    [FEATURE.MEMORY_BW_MEDIAN]: memoryFeature(findings, fv68),
    [FEATURE.THERMAL_RESISTANCE]: computeThermalResistance(findings, sc),
  });
  // ترتيب السجلّ = ترتيب الجدول (P5 :266-286)، وكل اسم مسجَّل حاضر (لا حذف صامت).
  const ordered = {};
  for (const d of FEATURE_REGISTRY) ordered[d.name] = features[d.name];
  return {featureSetVersion: FEATURE_SET_VERSION, status: STATUS.MEASURED, reason: null, features: ordered};
}

module.exports = {
  computeFeatureLibrary, classifyStability, FEATURE_REGISTRY, SOURCE,
  // مُصدَّرة للاختبار الذهبي وحده.
  _internal: {energyWh, computePeakHold, computeTempPerWh, computeThermalResistance, FI},
};
