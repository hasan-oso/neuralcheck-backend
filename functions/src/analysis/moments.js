'use strict';

// ===================================================================
// moments.js — اللحظات البارزة L-1..L-5 (V8 / PLAN-05 §٣ :324-344، الدفعة ٥، الصفّ S-B5، 2026-10-21 +03)
// ===================================================================
// «حدث بطابع زمني ومرحلة وقناة وقيمة. يحسبه الخادم ويُعطى للنموذج بمعرّف يستشهد به، **ولا يرى العيّنة**» (P5 :326). دالّة خالصة بلا شبكة.
//
// صيغة الاستشهاد (P5 :343 [اجتهاد]): {id, t_s, phase, channel, value, unit, templateKey}. أضفتُ إليها (اختياري الشكل لا الحضور، كل المفاتيح حاضرة دائماً):
//   kind     'EVENT' | 'CANDIDATE' — L-4 مرشَّح بلا حكم (P5 :340) وغيره واقعة.
//   detail   كائن بقيم خام من المصدر نفسه (يحتاجه حارس الأرقام ليطابق أيّ رقم يُستشهد به).
//   precisionS دقّة الزمن بالثواني حيث تُعلَن (L-2: ±30 ث)، وإلا null.
//   tBasis   من أين جاء t_s: 'SAMPLE_TIMESTAMP' | 'WINDOW_START' | 'EVENT_TIMESTAMP' | 'NONE' (L-3 بلا طابع: مقاطع التذييل بلا زمن).
// وt_s بالثواني منذ بدء الفحص (v[0] وt القوائم «ms منذ بدء الفحص» — عقد fv68 ت-03/ت-04 :446-462). **ليست على السلك بعد** (S-B6/S-B8).
//
// **الغياب حالة صريحة (القاعدة 22):** `momentStates` يحمل لكل (لحظة، نطاق) حالته {status, reason, occurred}. «لم تقع» (MEASURED + occurred=false) تختلف عن «لم تُقَس» (NOT_MEASURED + reason).
//
// ما لم يُبنَ ولماذا: النقل «مرشَّحاً للّحظات» لـwithin_phase_trends وzscore_outliers وcross_channel_correlation (P5 :315،:317،:318) — لا نوع لحظة لها في جدول §٣ (L-1..L-5)
// ولا تعريف لها ولا عتبة بمصدر في الخطّة: معلّق «مواصفة غائبة» (التقرير).

const N = require('./fv68Names');
const {passesEvidenceGate, EVIDENCE_MIN_SAMPLES, PHASE_NAMES, _internal: FI} = require('./findings');
const {readScanColumns, indicesInPhase, allFinite, unitScale, SECOND_UNITS} = require('./scanColumns');
const {matrixProfileDiscord} = require('./matrixProfile');
const {
  MOMENT, MOMENT_TEMPLATE_KEY, REASON, STATUS, UNIT, PARAMS, THERMAL_REACH_THRESHOLDS, ANOMALY_CHANNEL_KEYS,
} = require('./featureNames');

// نافذة السقف المستدام 5 ث: القيمة نفسها التي يستعملها windowStats في findings.js (لا نسخة ثانية — القاعدة 24).
const SUSTAINED_WINDOW_MS = FI.SUSTAINED_WINDOW_MS;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round6 = (x) => (typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x);

function moment(id, t_s, phase, channel, value, unit, kind, tBasis, detail, precisionS) {
  return {id, t_s, phase, channel, value, unit, templateKey: MOMENT_TEMPLATE_KEY[id], kind, tBasis, precisionS: precisionS === undefined ? null : precisionS, detail: detail || {}};
}
function state(id, scope, status, reason, occurred, reasonDetail) {
  return {id, phase: scope.phase === undefined ? null : scope.phase, channel: scope.channel === undefined ? null : scope.channel,
    threshold: scope.threshold === undefined ? null : scope.threshold, status, reason: status === STATUS.MEASURED ? null : reason,
    reasonDetail: status === STATUS.MEASURED || reasonDetail === undefined ? null : reasonDetail,
    occurred: status === STATUS.MEASURED ? occurred : null};
}
const notMeasured = (id, scope, reason) => state(id, scope, STATUS.NOT_MEASURED, reason, null);
const measuredState = (id, scope, occurred) => state(id, scope, STATUS.MEASURED, null, occurred);

// ─── L-1 هبوط مستدام ──────────────────────────────────────────────────
// «أوّل لحظة ينزل فيها أقصى نافذة 5 ث تحت 0.9 × الذروة ولا يعود حتى نهاية المرحلة [P04 M4 «ttl_over_0.9»]» (P5 :333)، قناة v5، المرحلتان 3 و5 (مرحلتا السقف المستدام).
// النوافذ هي نوافذ windowStats نفسها (مفتاح الدلو = floor((t − t0)/5000)). **اختيار S-B5:** النافذة الأخيرة تُهمَل إن كانت جزئية (آخر عيّنة فيها قبل نهاية النافذة بأكثر من
// الفاصل الوسيط بين العيّنات)، كي لا يُنتج طرف المرحلة «هبوطاً» من عيّنة أو اثنتين؛ وتُعلَن في detail.lastWindowExcluded. t_s = بداية النافذة الأولى من الذيل الهابط.
function computeSustainedDrop({sc, findings}) {
  const moments = [];
  const states = [];
  const sust = findings.sustainedCeiling;
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  const freq = sc.col(N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ);
  for (const phase of [3, 5]) {
    const scope = {phase, channel: N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ};
    if (!sust || sust.status !== STATUS.MEASURED) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, (sust && sust.notMeasuredReason) || REASON.INSUFFICIENT_SAMPLES));
      continue;
    }
    const peak = num(sust.peakFreqKhz);
    if (peak === null || peak <= 0) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, REASON.ZERO_DENOMINATOR));
      continue;
    }
    if (tScale === null) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, REASON.UNIT_UNDECLARED));
      continue;
    }
    const idx = indicesInPhase(sc.ph, phase);
    if (idx.length === 0) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, REASON.NO_SAMPLES_IN_PHASE));
      continue;
    }
    if (!allFinite(freq, idx) || !allFinite(sc.t, idx)) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, REASON.NON_NUMERIC_SAMPLE));
      continue;
    }
    if (!passesEvidenceGate(idx.length, FI.changes(idx.map((i) => freq[i])))) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, idx.length < EVIDENCE_MIN_SAMPLES ? REASON.INSUFFICIENT_SAMPLES : REASON.INSUFFICIENT_CADENCE));
      continue;
    }
    const t0 = sc.t[idx[0]];
    const buckets = new Map();
    for (const i of idx) {
      const key = Math.floor((sc.t[i] - t0) / SUSTAINED_WINDOW_MS);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(freq[i]);
    }
    const keys = [...buckets.keys()];
    const lastKey = keys[keys.length - 1];
    const dts = [];
    for (let k = 1; k < idx.length; k++) dts.push(sc.t[idx[k]] - sc.t[idx[k - 1]]);
    const medianDt = dts.length ? FI.median(dts) : 0;
    const tLast = sc.t[idx[idx.length - 1]] - t0;
    const lastPartial = tLast < (lastKey + 1) * SUSTAINED_WINDOW_MS - medianDt;
    const windows = keys.filter((k) => !(lastPartial && k === lastKey)).map((k) => ({key: k, ratio: Math.max(...buckets.get(k)) / peak}));
    if (windows.length === 0) {
      states.push(notMeasured(MOMENT.SUSTAINED_DROP, scope, REASON.INSUFFICIENT_SAMPLES));
      continue;
    }
    const thr = PARAMS.SUSTAINED_DROP_FRACTION.value;
    let start = -1;
    for (let k = windows.length - 1; k >= 0 && windows[k].ratio < thr; k--) start = k;
    if (start === -1) {
      states.push(measuredState(MOMENT.SUSTAINED_DROP, scope, false));
      continue;
    }
    states.push(measuredState(MOMENT.SUSTAINED_DROP, scope, true));
    moments.push(moment(MOMENT.SUSTAINED_DROP, (t0 + windows[start].key * SUSTAINED_WINDOW_MS) * tScale, phase, N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ,
        windows[start].ratio, UNIT.RATIO, 'EVENT', 'WINDOW_START', {
          thresholdFraction: thr, windowMs: SUSTAINED_WINDOW_MS, peakFreqKhz: peak, windowsInPhase: windows.length, windowsBelowToEnd: windows.length - start,
          lastWindowExcluded: lastPartial,
        }));
  }
  return {moments, states};
}

// ─── L-2 ذروة حرارة البطارية ───────────────────────────────────────────
// «لحظة أقصى حرارة. ودقّتها ±30 ث تُعلَن (كادنس البثّ 30.382–30.52 ث ✓)» (P5 :334)، المصدر v1. بوّابتها بوّابة F12 نفسها (كادنس الحرارة في الفحص كلّه) من findings.js.
function computeBatteryTempPeak({sc, findings}) {
  const scope = {channel: N.BASE_CHANNELS.BATTERY_TEMP_C};
  const rise = findings.thermal && findings.thermal.batteryTempRise;
  if (!rise || rise.status !== STATUS.MEASURED) return {moments: [], states: [notMeasured(MOMENT.BATTERY_TEMP_PEAK, scope, (rise && rise.reason) || REASON.HARNESS_ERROR)]};
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  if (tScale === null) return {moments: [], states: [notMeasured(MOMENT.BATTERY_TEMP_PEAK, scope, REASON.UNIT_UNDECLARED)]};
  const temp = sc.col(N.BASE_CHANNELS.BATTERY_TEMP_C);
  const all = Array.from({length: sc.n}, (_, i) => i);
  if (!allFinite(temp, all) || !allFinite(sc.t, all)) return {moments: [], states: [notMeasured(MOMENT.BATTERY_TEMP_PEAK, scope, REASON.NON_NUMERIC_SAMPLE)]};
  let at = 0;
  for (let i = 1; i < sc.n; i++) if (temp[i] > temp[at]) at = i; // أول عيّنة تبلغ الأقصى (حتمي عند التعادل)
  const unit = sc.unitOf(N.BASE_CHANNELS.BATTERY_TEMP_C) || UNIT.CELSIUS;
  return {
    moments: [moment(MOMENT.BATTERY_TEMP_PEAK, sc.t[at] * tScale, sc.ph[at], N.BASE_CHANNELS.BATTERY_TEMP_C, temp[at], unit, 'EVENT', 'SAMPLE_TIMESTAMP',
        {firstTempC: temp[0], riseC: temp[at] - temp[0]}, PARAMS.BATTERY_BROADCAST_PRECISION_S.value)],
    states: [measuredState(MOMENT.BATTERY_TEMP_PEAK, scope, true)],
  };
}

// ─── L-3 ركبة التخزين ─────────────────────────────────────────────────
// «المقطع والقيمتان قبله وبعده. تُعرض واقعة هذا الفحص لا حكماً (CV 50.9%)» (P5 :335)، المصدر مقاطع التذييل (بلا طابع زمني ⟵ t_s = null صريحاً).
// المقطع والموضع من findings.storage + detectStorageKnee نفسها. «القيمتان قبله وبعده» لم تُحدَّدا في الخطّة: أعطيتُ الاثنتين معاً في detail — مقطعَي الجوار المباشر
// (previousSegmentMbps/nextSegmentMbps) ووسيطَي ما قبل الركبة وما بعدها (inCacheMedianMbps/postCacheMedianMbps) — اختيار S-B5 مذكور في التقرير.
function computeStorageKnee({sc, findings, fv68}) {
  const scope = {channel: N.VERIFICATION.STORAGE_THROUGHPUT_SEGMENTS, phase: 1};
  const st = findings.storage;
  if (!st || st.status !== 'STATE_ONLY') {
    return {moments: [], states: [notMeasured(MOMENT.STORAGE_KNEE, scope, st && st.reason === 'ABSENT' ? REASON.STORAGE_SEGMENTS_ABSENT : ((st && st.reason) || REASON.HARNESS_ERROR))]};
  }
  const unit = fv68 && fv68.throughputUnit && typeof fv68.throughputUnit.unit === 'string' && fv68.throughputUnit.unit.trim() !== '' ? fv68.throughputUnit.unit : null;
  if (st.kneeState !== 'KNEE_DETECTED') return {moments: [], states: [measuredState(MOMENT.STORAGE_KNEE, scope, false)]};
  const segs = sc.footer.verificationResults.storageThroughputSegments;
  const mbps = segs.map((s) => s.mbps);
  const knee = FI.detectStorageKnee(mbps, segs.map((s) => s.cumulativeBytes));
  return {
    moments: [moment(MOMENT.STORAGE_KNEE, null, 1, N.VERIFICATION.STORAGE_THROUGHPUT_SEGMENTS, knee.cumulativeGb, UNIT.GB, 'EVENT', 'NONE', {
      segmentIndex: knee.segmentIndex, segmentMbps: knee.mbps, previousSegmentMbps: mbps[knee.segmentIndex - 1],
      nextSegmentMbps: knee.segmentIndex + 1 < mbps.length ? mbps[knee.segmentIndex + 1] : null,
      inCacheMedianMbps: st.inCacheMbps, postCacheMedianMbps: st.postCacheMbps, throughputUnit: unit, segmentCount: mbps.length,
    })],
    states: [measuredState(MOMENT.STORAGE_KNEE, scope, true)],
  };
}

// ─── L-4 شذوذ داخل المرحلة (مرشَّح بلا حكم، بلا عرض: د-٨ P5 :794) ──────────────
// لكل قناة كثيفة (التيّار v3، التردّد v5، الاستخدام v6، القدرة v7) ولكل مرحلة على حدة: أعلى discord بنافذة 40 عيّنة (PARAMS.ANOMALY_WINDOW_SAMPLES).
// «فيُبلَّغ أعلى discord لكل مرحلة «مرشَّحاً» بلا حكم» (P5 :340): كل (مرحلة، قناة) تُبلَّغ مرشَّحاً، ويُوسَم detail.topOfPhase للأعلى بين قنوات المرحلة. العتبة غير معايَرة
// (P5 :339) فلا حكم ولا عتبة هنا؛ وثبات الموضع عبر الفحوص المكرّرة شرط قبوله لحظةً تُعرض (P5 :341) ⟵ detail.acceptance = 'PENDING_REPEATABILITY'.
// بوّابتها: بوّابة الأدلّة (EVIDENCE_MIN_SAMPLES وEVIDENCE_MIN_CADENCE_UPDATES على قيم القناة في المرحلة) ثم شرط بنيوي: نافذة واحدة على الأقلّ لها جار خارج منطقة الاستثناء.
function computeWithinPhaseAnomalies({sc}) {
  const moments = [];
  const states = [];
  const m = PARAMS.ANOMALY_WINDOW_SAMPLES.value;
  const ez = Math.ceil(m * PARAMS.MATRIX_PROFILE_EXCLUSION_ZONE_FRACTION.value);
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  const found = []; // [{phase, item}]
  for (const key of ANOMALY_CHANNEL_KEYS) {
    const channel = N.BASE_CHANNELS[key];
    const col = sc.col(channel);
    for (let phase = 0; phase <= 7; phase++) {
      const scope = {phase, channel};
      const idx = indicesInPhase(sc.ph, phase);
      if (idx.length === 0) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, REASON.NO_SAMPLES_IN_PHASE));
        continue;
      }
      if (tScale === null) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, REASON.UNIT_UNDECLARED));
        continue;
      }
      if (!allFinite(col, idx) || !allFinite(sc.t, idx)) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, REASON.NON_NUMERIC_SAMPLE));
        continue;
      }
      const series = idx.map((i) => col[i]);
      if (!passesEvidenceGate(series.length, FI.changes(series))) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, series.length < EVIDENCE_MIN_SAMPLES ? REASON.INSUFFICIENT_SAMPLES : REASON.INSUFFICIENT_CADENCE));
        continue;
      }
      const mp = matrixProfileDiscord(series, m, ez);
      if (!mp.ok) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, mp.reason === 'SERIES_SHORTER_THAN_WINDOW' ? REASON.INSUFFICIENT_SAMPLES :
          (mp.reason === 'NON_NUMERIC_SAMPLE' ? REASON.NON_NUMERIC_SAMPLE : REASON.MATRIX_PROFILE_INPUT_INVALID)));
        continue;
      }
      if (mp.discord === null) {
        states.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, scope, REASON.NO_NON_TRIVIAL_NEIGHBOR));
        continue;
      }
      states.push(measuredState(MOMENT.WITHIN_PHASE_ANOMALY, scope, true));
      const startIdx = idx[mp.discord.index];
      const endIdx = idx[mp.discord.index + m - 1];
      const dts = [];
      for (let k = 1; k < idx.length; k++) dts.push(sc.t[idx[k]] - sc.t[idx[k - 1]]);
      const item = moment(MOMENT.WITHIN_PHASE_ANOMALY, sc.t[startIdx] * tScale, phase, channel, round6(mp.discord.distance), UNIT.Z_NORMALIZED_DISTANCE, 'CANDIDATE', 'WINDOW_START', {
        phaseName: PHASE_NAMES[phase], windowSamples: m, windowSeconds: (sc.t[endIdx] - sc.t[startIdx]) * tScale, medianSampleIntervalS: FI.median(dts) * tScale,
        exclusionZone: ez, discordStartIndexInPhase: mp.discord.index, neighborStartIndexInPhase: mp.discord.neighborIndex,
        nSubsequences: mp.nSubsequences, nSubsequencesWithNeighbor: mp.nWithNeighbor, flatSubsequences: mp.flatSubsequences,
        topOfPhase: false, acceptance: 'PENDING_REPEATABILITY', channelUnit: sc.unitOf(channel),
      });
      found.push({phase, item});
      moments.push(item);
    }
  }
  for (let phase = 0; phase <= 7; phase++) {
    const inPhase = found.filter((f) => f.phase === phase);
    if (inPhase.length === 0) continue;
    let top = inPhase[0];
    for (const f of inPhase) if (f.item.value > top.item.value) top = f;
    top.item.detail.topOfPhase = true;
  }
  return {moments, states};
}

// ─── L-5 بلوغ حالة حرارية ─────────────────────────────────────────────
// «لحظة أوّل بلوغ لـMODERATE/SEVERE — مستمع الحالة — **fv68** (التذييل اليوم أقصى بلا طابع)» (P5 :337). المصدر footer.thermalStatusEvents[] كما يقرؤها fv68Reader.readThermalLists:
// {t (ms منذ بدء الفحص)، status 0..6}. أوّل عنصر قراءةٌ عند التسجيل لا انتقال (عقد ت-04 :462) ⟵ detail.atRegistration. الغياب مسمّى: لا قائمة ⟵ NO_THERMAL_STATUS_EVENTS،
// وحالة المستمع غير ok ⟵ THERMAL_STATUS_NOT_OK مع reasonDetail = نوع الحالة كما أخرجها القارئ (api_below_29 · listener_registration_failed · initial_read_failed · …) — القاعدة 21: سبب الفشل بنصّه لا بصنفه.
function computeThermalStateReached({sc, fv68}) {
  const moments = [];
  const states = [];
  const th = fv68 && fv68.thermal && fv68.thermal.status;
  const tScale = unitScale(sc.unitOf(N.BASE_CHANNELS.TIMESTAMP_MS), SECOND_UNITS);
  for (const thr of THERMAL_REACH_THRESHOLDS) {
    const scope = {channel: N.FOOTER.THERMAL_STATUS_EVENTS, threshold: thr.name};
    if (!th || !th.events || th.events.status !== N.KEY_STATUS.PRESENT) {
      states.push(notMeasured(MOMENT.THERMAL_STATE_REACHED, scope, REASON.NO_THERMAL_STATUS_EVENTS));
      continue;
    }
    const kind = th.state && th.state.state ? th.state.state.kind : null;
    if (kind !== N.STATE_KIND.OK) {
      states.push(state(MOMENT.THERMAL_STATE_REACHED, scope, STATUS.NOT_MEASURED, REASON.THERMAL_STATUS_NOT_OK, null, kind === null ? 'STATE_ABSENT' : kind));
      continue;
    }
    if (tScale === null) {
      states.push(notMeasured(MOMENT.THERMAL_STATE_REACHED, scope, REASON.UNIT_UNDECLARED));
      continue;
    }
    const items = th.events.items;
    const hitIndex = items.findIndex((e) => e.status !== null && e.status >= thr.status && e.t !== null);
    if (hitIndex === -1) {
      states.push(measuredState(MOMENT.THERMAL_STATE_REACHED, scope, false));
      continue;
    }
    const hit = items[hitIndex];
    // مرحلة اللحظة: مرحلة آخر عيّنة طابعها ≤ t الحدث؛ وإن سبق الحدثُ أوّلَ عيّنة فلا مرحلة (null) لا تخمين.
    let phase = null;
    for (let i = 0; i < sc.n; i++) {
      if (typeof sc.t[i] === 'number' && sc.t[i] <= hit.t) phase = sc.ph[i];
      else if (typeof sc.t[i] === 'number' && sc.t[i] > hit.t) break;
    }
    states.push(measuredState(MOMENT.THERMAL_STATE_REACHED, scope, true));
    moments.push(moment(MOMENT.THERMAL_STATE_REACHED, hit.t * tScale, phase, N.FOOTER.THERMAL_STATUS_EVENTS, hit.status, UNIT.THERMAL_STATUS, 'EVENT', 'EVENT_TIMESTAMP', {
      threshold: thr.name, thresholdStatus: thr.status, atRegistration: hitIndex === 0, eventIndex: hitIndex, eventCount: items.length,
      phaseBasis: phase === null ? 'EVENT_BEFORE_FIRST_SAMPLE' : 'LAST_SAMPLE_AT_OR_BEFORE_EVENT',
    }));
  }
  return {moments, states};
}

// ─── نقطة الدخول ────────────────────────────────────────────────────────

/**
 * @param {Object} input {fingerprint, findings, fv68, sc?} — findings وfv68 من المسار نفسه الذي يحسبه runAnalysisInternal (computeFindings وreadFv68)؛ sc قارئ الأعمدة (يُحسب إن غاب).
 * @return {Object} {moments: [..مرتّبة بـt_s ثم المعرّف..]، momentStates: [..]} — لا يرمي.
 */
function computeMoments(input) {
  const fingerprint = input && input.fingerprint;
  const sc = (input && input.sc) || readScanColumns(fingerprint);
  const findings = input && input.findings;
  const fv68 = input && input.fv68;
  const everyScope = () => {
    const out = [];
    for (const phase of [3, 5]) out.push(notMeasured(MOMENT.SUSTAINED_DROP, {phase, channel: N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ}, REASON.HARNESS_ERROR));
    out.push(notMeasured(MOMENT.BATTERY_TEMP_PEAK, {channel: N.BASE_CHANNELS.BATTERY_TEMP_C}, REASON.HARNESS_ERROR));
    out.push(notMeasured(MOMENT.STORAGE_KNEE, {phase: 1, channel: N.VERIFICATION.STORAGE_THROUGHPUT_SEGMENTS}, REASON.HARNESS_ERROR));
    out.push(notMeasured(MOMENT.WITHIN_PHASE_ANOMALY, {}, REASON.HARNESS_ERROR));
    for (const thr of THERMAL_REACH_THRESHOLDS) out.push(notMeasured(MOMENT.THERMAL_STATE_REACHED, {channel: N.FOOTER.THERMAL_STATUS_EVENTS, threshold: thr.name}, REASON.HARNESS_ERROR));
    return out;
  };
  if (!sc.ok || !findings || findings.status !== STATUS.MEASURED) return {moments: [], momentStates: everyScope()};
  const parts = [
    computeSustainedDrop({sc, findings}),
    computeBatteryTempPeak({sc, findings}),
    computeStorageKnee({sc, findings, fv68}),
    computeWithinPhaseAnomalies({sc}),
    computeThermalStateReached({sc, fv68}),
  ];
  const moments = [];
  const momentStates = [];
  for (const p of parts) {
    moments.push(...p.moments);
    momentStates.push(...p.states);
  }
  const order = (x) => (x.t_s === null ? Infinity : x.t_s);
  moments.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id) || (a.phase === null ? -1 : a.phase) - (b.phase === null ? -1 : b.phase) ||
    String(a.channel).localeCompare(String(b.channel)));
  return {moments, momentStates};
}

module.exports = {computeMoments, SUSTAINED_WINDOW_MS};
