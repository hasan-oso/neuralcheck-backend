'use strict';

// findings.test.js — P1.1 (PLAN-01-ROADMAP §المرحلة ١، P1.1)
//
// ثلاث كتل:
//   1. اختبارات ذهبية على الفحوص الأربعة المتاحة في
//      functions/test/fixtures/golden/ — مطابقة ±0.01 لكل حقل يغطّيه
//      EXPECTED-timeseries_stats.json (s10/honor) أو
//      EXPECTED-timeseries_stats-variance.json (b45c8cf6/34dff2b8، الذي
//      أضافه المنسّق بنفس مخطَّط timeseries_stats.py — راجع
//      golden/README-variance-golden.md).
//   2. اختبار البتر (انحدار A76): حمولة بلا samples → كل مشتقّ
//      NOT_MEASURED/HARNESS_ERROR، لا صفر ولا null.
//   3. اختبارات اصطناعية غير ذهبية لِما لا تغطّيه الفِخاخ الأربعة
//      (UNSTABLE/ADVISORY من functionalResults — غائب من كل الفِخاخ
//      الأربعة؛ ومسار fv68 charge_counter_raw — لا فحص fv68 حقيقي من جهاز بعد؛
//      المسار بالاسم والعيّنات الفاشلة (S-27) في test/findingsFv68Readers.test.js).
//      كل قسم مُعلَّم صراحة "اصطناعي" في اسم الكتلة وفي console.log.
//
// Run: node functions/test/findings.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  computeFindings, UNSTABLE_TEST_IDS, ADVISORY_TEST_IDS,
  passesEvidenceGate, EVIDENCE_MIN_SAMPLES, EVIDENCE_MIN_CADENCE_UPDATES,
  VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD, VSYNC_LOCK_THRESHOLD_LABEL, thresholdSet,
  _internal,
} = require('../src/analysis/findings');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

let n = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  n++;
};
const near = (actual, expected, tol, m) => {
  assert.ok(typeof actual === 'number' && isFinite(actual),
      `${m} — actual is not a finite number (got ${actual})`);
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tol,
      `${m} — |${actual} - ${expected}| = ${diff} > ${tol}`);
  n++;
};

// ═══════════════════════════════════════════════════════════════════════
// 1. الاختبارات الذهبية — الفحوص الأربعة، ±0.01
// ═══════════════════════════════════════════════════════════════════════

const s10Raw = loadJson('8909e850-s10.ts.json');
const honorRaw = loadJson('e4b65a2f-honor.ts.json');
const run1Raw = loadJson('b45c8cf6.ts.json');
const run2Raw = loadJson('34dff2b8.ts.json');

const tsStats = loadJson('EXPECTED-timeseries_stats.json'); // مفاتيح: s10, honor
const variance = loadJson('EXPECTED-timeseries_stats-variance.json'); // مفاتيح: scanId

const CASES = [
  {label: 's10', raw: s10Raw, expected: tsStats.s10},
  {label: 'honor', raw: honorRaw, expected: tsStats.honor},
  {label: 'run1(b45c8cf6)', raw: run1Raw, expected: variance['b45c8cf6-e376-4765-8703-f68e9bc69844']},
  {label: 'run2(34dff2b8)', raw: run2Raw, expected: variance['34dff2b8-ce9e-4b40-86a9-1976c878e195']},
];

for (const {label, raw, expected} of CASES) {
  const f = computeFindings(raw);
  const TOL = 0.01;

  // ── البطارية: القيم "الإعلامية" لـ fv≤67 (§٤-أ) ─────────────────────
  near(f.battery.info.voltageStabilityMv, expected.voltageStabilityMv_recomputed, TOL,
      `${label}: voltageStabilityMv`);
  near(f.battery.info.dischargeRateUnderLoadMa, expected.dischargeRateUnderLoadMa_recomputed, TOL,
      `${label}: dischargeRateUnderLoadMa`);
  // qIntMah مقارَن مقرَّباً لمنزلة واحدة — دقّة الحقل المرجعي نفسها
  // (coulomb_whole_scan_mah = round(x, 1) في REFERENCE-timeseries_stats.py).
  near(Math.round(f.battery.qIntMah * 10) / 10, expected.coulomb_whole_scan_mah, TOL,
      `${label}: qIntMah (rounded to the reference's own precision)`);
  near(f.battery.info.rho, expected.level_x_design_over_coulomb, 0.02,
      `${label}: rho (ρ) — tol 0.02 لأن المرجع نفسه مقرَّب لمنزلتين`);

  // ── الحرارة: بوّابة الكادنس ──────────────────────────────────────────
  const cadenceOk = expected.cadence.battery_temp.changes_whole_scan >= EVIDENCE_MIN_CADENCE_UPDATES;
  ok(cadenceOk === (f.thermal.batteryTempRise.status === 'MEASURED'),
      `${label}: thermal gate agrees with cadence (${expected.cadence.battery_temp.changes_whole_scan} updates)`);
  if (cadenceOk) {
    near(f.thermal.batteryTempRise.valueC, expected.temp_rise, TOL, `${label}: temp_rise`);
    near(f.thermal.batteryTempRise.ratePerMinPhases345,
        expected.temp_rise_rate_c_per_min_phases_3_5, TOL, `${label}: temp rise rate/min (3-5)`);
  } else {
    ok(f.thermal.batteryTempRise.valueC === null,
        `${label}: temp rise value withheld when cadence gate fails (not silently shown)`);
  }
  ok(f.thermal.thermalHeadroomPeak === expected.thermalHeadroomPeak_footer,
      `${label}: thermalHeadroomPeak passthrough`);
  ok(f.thermal.thermalStatusMax === expected.thermalStatusMax_footer,
      `${label}: thermalStatusMax passthrough`);

  // ── السقف المستدام والتعافي (G3) ────────────────────────────────────
  near(f.sustainedCeiling.phase3.meanWindowMaxRatio,
      expected.sustained_ceiling_phase3.mean_window_max_ratio, TOL, `${label}: sustainedCeiling phase3 mean`);
  near(f.sustainedCeiling.phase5.meanWindowMaxRatio,
      expected.sustained_ceiling_phase5.mean_window_max_ratio, TOL, `${label}: sustainedCeiling phase5 mean`);
  near(f.sustainedCeiling.combined.meanWindowMaxRatio,
      expected.sustained_ceiling_phases_3_5.mean_window_max_ratio, TOL, `${label}: sustainedCeiling combined mean`);
  near(f.sustainedCeiling.combined.minWindowMaxRatio,
      expected.sustained_ceiling_phases_3_5.min_window_max_ratio, TOL, `${label}: sustainedCeiling combined min`);
  near(f.sustainedCeiling.recoveryPhase7Ratio, expected.recovery_phase7_max_ratio, TOL,
      `${label}: recovery phase7 ratio`);

  // ── الرسوميات (G2) ───────────────────────────────────────────────────
  // كسور vsync-lock تُقارَن بدقّة ±0.01 على النافذة الكاملة (غير مشذَّبة —
  // مطابقة تامّة للمرجع، انظر تعليق computeGraphics).
  near(f.graphics.vsyncLockFraction60, expected.fps_in_60_band_fraction, TOL,
      `${label}: vsync 60-band fraction`);
  near(f.graphics.vsyncLockFraction90, expected.fps_in_90_band_fraction, TOL,
      `${label}: vsync 90-band fraction`);
  if (f.graphics.status === 'MEASURED') {
    // المقياس مشذَّب (±2 ث) بنصّ P1.1؛ المرجع غير مشذَّب — الفارق موثَّق
    // ومحدود عملياً بأقل من 0.01 على الفحوص الأربعة (تحقّق يدوي مسبق).
    near(f.graphics.ratioPhase5OverPhase4, expected.fps_median_phase5_over_phase4, TOL,
        `${label}: graphics ratio phase5/phase4 (trimmed vs reference untrimmed)`);
  } else {
    ok(f.graphics.notMeasuredReason === 'HARNESS_VSYNC_LOCKED',
        `${label}: graphics correctly flagged HARNESS_VSYNC_LOCKED ` +
        `(${expected.fps_in_60_band_fraction} + ${expected.fps_in_90_band_fraction} in-band)`);
  }

  // ── قناة عامّة لكل (قناة، مرحلة) — البند ١، عبر cpu_usage_pct وcpu_freq_max_khz ──
  // usage_mean_phase3 مرجعياً مقرَّب لمنزلة واحدة (round(x,1) في السكربت)؛
  // نقارن بنفس دقّة المرجع كي يكون ±0.01 معنى لا عبثاً بالتقريب.
  near(Math.round(f.channels.cpu_usage_pct.CPU_SUSTAINED.mean * 10) / 10,
      expected.usage_mean_phase3, TOL, `${label}: cpu_usage_pct/CPU_SUSTAINED mean (rounded to reference precision)`);
  const freqCs = f.channels.cpu_freq_max_khz.CPU_SUSTAINED;
  const expFreqCs = expected.freq_by_phase.CPU_SUSTAINED;
  ok(freqCs.n === expFreqCs.n, `${label}: cpu_freq_max_khz/CPU_SUSTAINED n`);
  ok(Math.round(freqCs.mean / 1000) === expFreqCs.mean_mhz,
      `${label}: cpu_freq_max_khz/CPU_SUSTAINED mean (kHz->MHz rounded)`);
  ok(Math.round(freqCs.median / 1000) === expFreqCs.median_mhz,
      `${label}: cpu_freq_max_khz/CPU_SUSTAINED median (kHz->MHz rounded)`);
  ok(Math.round(freqCs.min / 1000) === expFreqCs.min_mhz,
      `${label}: cpu_freq_max_khz/CPU_SUSTAINED min (kHz->MHz rounded)`);
  ok(Math.round(freqCs.max / 1000) === expFreqCs.max_mhz,
      `${label}: cpu_freq_max_khz/CPU_SUSTAINED max (kHz->MHz rounded)`);

  // ── البطارية: لا حرف على fv67 مهما كانت النتائج أعلاه ────────────────
  ok(f.battery.consist.status === 'NOT_MEASURED' && f.battery.consist.reason === 'HARNESS_VERSION',
      `${label}: BAT-CONSIST is NOT_MEASURED/HARNESS_VERSION on fv67`);
  ok(f.battery.cap.status === 'NOT_MEASURED' && f.battery.cap.reason === 'HARNESS_VERSION',
      `${label}: BAT-CAP is NOT_MEASURED/HARNESS_VERSION on fv67`);
  ok(f.battery.socAtStart === raw.header.batteryLevelStart,
      `${label}: socAtStart present on the battery indicator`);

  // ── charge_counter — لقطة تذييل fv67، مهمّة 2026-09-21 +03 ───────────
  // القيمة الخام والوحدة (المُعلَنة لا المُستنتَجة) ومصدر الوحدة الثلاثة
  // تُصدَّر معاً؛ الأربعة الفِخاخ كلّها fv67 فلا سلسلة (BAT-FCC يحتاج
  // سلسلة، §٤-ج) — فقط اللقطة.
  const cc = f.battery.charge_counter;
  const rawFooterCC = raw.footer.batteryHealth && raw.footer.batteryHealth.chargeCounterUah;
  ok(cc.snapshot.rawValue === rawFooterCC,
      `${label}: charge_counter.snapshot.rawValue matches raw footer.batteryHealth.chargeCounterUah exactly (${rawFooterCC}) — no conversion`);
  ok(cc.snapshot.unit === null,
      `${label}: charge_counter.snapshot.unit is null — no unit is declared anywhere in the payload for this field`);
  ok(cc.snapshot.status === 'NOT_MEASURED' && cc.snapshot.reason === 'UNIT_UNDECLARED',
      `${label}: charge_counter.snapshot is NOT_MEASURED/UNIT_UNDECLARED (not guessed from magnitude — A38)`);
  ok(cc.series.status === 'NOT_MEASURED' && cc.series.reason === 'HARNESS_VERSION',
      `${label}: charge_counter.series is NOT_MEASURED/HARNESS_VERSION on fv67 — BAT-FCC needs a series, one snapshot is not one`);
  ok(cc.series.rawValues === null,
      `${label}: charge_counter.series.rawValues is null on fv67 (no v[11] channel exists at all)`);
}

console.log(`golden field-by-field (±0.01, 4 scans): section passed`);

// ═══════════════════════════════════════════════════════════════════════
// 1-ب. A38 — فخّ الوحدة: قيمتان بمقياسين متباينين جداً، كلتاهما تُصدَّران
//       كما وردتا، بلا توحيد ولا تحويل ولا وحدة مُستنتَجة من الحجم.
//       s10 = 3,542,000 (رقم كبير — الفخّ: "إذن µAh") مقابل
//       honor = 5,596 (رقم صغير — الفخّ: "إذن mAh"). كلاهما وحدتهما
//       غير مُعلَنة فعلياً في الحمولة (لا variables، لا حقل شقيق في
//       footer.batteryHealth)، فكلاهما يجب أن يُعامَلا **بالتساوي**
//       (نفس status/reason/unit) رغم فارق المقياس — أي معاملة مختلفة
//       بينهما بناءً على حجم الرقم وحده هي A38 بعينه.
// ═══════════════════════════════════════════════════════════════════════
{
  const fS10 = computeFindings(s10Raw);
  const fHonor = computeFindings(honorRaw);
  const ccS10 = fS10.battery.charge_counter.snapshot;
  const ccHonor = fHonor.battery.charge_counter.snapshot;

  ok(ccS10.rawValue === 3542000, 'A38: s10 rawValue = 3542000 exactly, untouched');
  ok(ccHonor.rawValue === 5596, 'A38: honor rawValue = 5596 exactly, untouched');
  ok(ccS10.rawValue !== ccHonor.rawValue, 'A38 sanity: the two raw values really are on very different scales (633x apart)');

  // لا توحيد: لا قسمة ولا ضرب طبِّقا على أيّ من القيمتين — لو طُبِّق
  // تحويل µAh->mAh (÷1000) على s10 لأصبحت 3542 لا 3542000؛ التحقّق
  // أعلاه على القيمة الخام يكفي لإثبات غياب أي تحويل.
  ok(ccS10.unit === ccHonor.unit && ccS10.unit === null,
      'A38: both devices get unit=null identically — neither is guessed as µAh nor mAh from its magnitude');
  ok(ccS10.unitSource === ccHonor.unitSource && ccS10.unitSource === 'MISSING',
      'A38: both devices get the same unitSource (MISSING) — no special-casing by value size');
  ok(ccS10.status === ccHonor.status && ccS10.status === 'NOT_MEASURED' &&
     ccS10.reason === ccHonor.reason && ccS10.reason === 'UNIT_UNDECLARED',
  'A38: both devices get identical NOT_MEASURED/UNIT_UNDECLARED status — the guard is "is a unit declared", ' +
      'never "does this number look like µAh or mAh"');
}

console.log(`A38 unit-trap section passed — s10 (3542000) vs honor (5596), both raw, both un-normalized, both UNIT_UNDECLARED identically`);

// ── التخزين — knee detector (S10 والاثنان الآخران يحملان "ركبة"؛ Honor لا) ──
// ملاحظة: postCacheMbps هنا "وسيط المقاطع بعد الركبة" (§٤-ب) — كمّية
// مختلفة عمداً عن storage_collapse_detector.mbps المرجعي (قيمة المقطع
// الواحد عند الركبة فقط). المطابقة الذهبية على kneeGb (نفس التعريف
// بالضبط)؛ postCacheMbps يُتحقَّق ذاتياً من footer الفحص نفسه (بيانات
// أوّلية لا مشتقّة، فإعادة حسابها هنا مستقلّة حقاً عن findings.js).
function medianOf(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return (s.length % 2) ? s[m] : (s[m - 1] + s[m]) / 2;
}

{
  const fS10 = computeFindings(s10Raw);
  ok(fS10.storage.kneeState === 'KNEE_DETECTED', 's10: storage knee detected');
  near(fS10.storage.kneeGb, tsStats.s10.storage_collapse_detector.cumulative_gb, 0.01, 's10: kneeGb');
  const s10Segs = s10Raw.footer.verificationResults.storageThroughputSegments.map((x) => x.mbps);
  const s10KneeIdx = tsStats.s10.storage_collapse_detector.segment_index;
  near(fS10.storage.postCacheMbps, medianOf(s10Segs.slice(s10KneeIdx)), 0.001,
      's10: postCacheMbps = median(segments from knee onward), recomputed independently from raw footer');
  near(fS10.storage.inCacheMbps, medianOf(s10Segs.slice(0, s10KneeIdx)), 0.001,
      's10: inCacheMbps = median(segments before knee), recomputed independently from raw footer');

  const fHonor = computeFindings(honorRaw);
  ok(fHonor.storage.kneeState === 'IN_CACHE_THROUGHOUT', 'honor: no knee (in-cache throughout, matches null collapse detector)');
  ok(fHonor.storage.postCacheMbps === null, 'honor: postCacheMbps null when no knee');
  ok(fHonor.storage.kneeGb === null, 'honor: kneeGb null when no knee');

  const fRun1 = computeFindings(run1Raw);
  const expRun1 = variance['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  near(fRun1.storage.kneeGb, expRun1.storage_collapse_detector.cumulative_gb, 0.01, 'run1: kneeGb');
  const run1Segs = run1Raw.footer.verificationResults.storageThroughputSegments.map((x) => x.mbps);
  const run1KneeIdx = expRun1.storage_collapse_detector.segment_index;
  near(fRun1.storage.postCacheMbps, medianOf(run1Segs.slice(run1KneeIdx)), 0.001,
      'run1: postCacheMbps recomputed independently from raw footer');

  const fRun2 = computeFindings(run2Raw);
  ok(fRun2.storage.kneeState === 'IN_CACHE_THROUGHOUT', 'run2: no knee (matches null collapse detector)');
}

console.log(`storage knee section passed`);

// ═══════════════════════════════════════════════════════════════════════
// 2. G7 — قائمة الحقول‑بحسب‑الإصدار (على fv67، الفِخاخ الأربعة متطابقة)
// ═══════════════════════════════════════════════════════════════════════
{
  const f = computeFindings(s10Raw);
  const fields = f.notMeasuredFields.map((x) => x.field).sort();
  const expectedFields = [
    'deviceTierMeasured', 'intensityFactor', 'storageSlcCacheSizeMb',
    'tempRiseRateInProbe', 'maxCpuTemp',
    'cpuTempCoveragePct', 'gpuTempCoveragePct', 'skinTempCoveragePct',
    'cpuFmaErrors', 'cpuPrimeSieveCorrect', 'memoryMarchPassed',
    'memoryWalkingOnesPassed', 'memoryRandomVerifyErrors',
  ].sort();
  ok(fields.length === 13, `G7 list has 13 entries on fv67 (got ${fields.length})`);
  ok(JSON.stringify(fields) === JSON.stringify(expectedFields),
      `G7 list matches the verified field set exactly`);
  // نفس القائمة على كل الفِخاخ الأربعة (كلّها fv67 بنفس بنية footer).
  for (const {label, raw} of CASES) {
    const list = computeFindings(raw).notMeasuredFields.map((x) => x.field).sort();
    ok(JSON.stringify(list) === JSON.stringify(expectedFields), `${label}: G7 list identical`);
  }
}

console.log(`G7 not-measured-fields section passed`);

// ═══════════════════════════════════════════════════════════════════════
// 3. اختبار البتر — انحدار A76: حمولة بلا samples
// ═══════════════════════════════════════════════════════════════════════
{
  const footerLike = s10Raw.footer;
  const headerLike = s10Raw.header;

  const payloads = [
    {label: 'samples absent entirely', fp: {header: headerLike, footer: footerLike}},
    {label: 'samples empty array', fp: {header: headerLike, footer: footerLike, samples: []}},
    {label: 'samples not an array', fp: {header: headerLike, footer: footerLike, samples: 'oops'}},
    {label: 'fingerprint.timeSeries shape, samples missing',
      fp: {timeSeries: {header: headerLike, footer: footerLike}}},
    {label: 'completely empty fingerprint', fp: {}},
    {label: 'samples non-empty but malformed elements (no .v field)',
      fp: {header: headerLike, footer: footerLike, samples: [{phase: 0}, {phase: 1}]}},
  ];

  for (const {label, fp} of payloads) {
    const f = computeFindings(fp);
    const isHarnessError = (v) => v && typeof v === 'object' &&
        v.status === 'NOT_MEASURED' && v.reason === 'HARNESS_ERROR';

    ok(f.status === 'NOT_MEASURED' && f.notMeasuredReason === 'HARNESS_ERROR',
        `[truncation:${label}] top-level status is NOT_MEASURED/HARNESS_ERROR`);

    // كل حقل مشتقّ من samples يجب أن يكون الوسم الصريح — لا 0 ولا null عارٍ.
    ok(isHarnessError(f.channels), `[truncation:${label}] channels is HARNESS_ERROR sentinel, not {} or null`);
    ok(isHarnessError(f.perChannelUpdateCount), `[truncation:${label}] perChannelUpdateCount is HARNESS_ERROR`);
    ok(isHarnessError(f.unstableMeasurements), `[truncation:${label}] unstableMeasurements is HARNESS_ERROR`);
    ok(isHarnessError(f.advisoryMeasurements), `[truncation:${label}] advisoryMeasurements is HARNESS_ERROR`);
    ok(isHarnessError(f.notMeasuredFields), `[truncation:${label}] notMeasuredFields is HARNESS_ERROR (not [])`);

    ok(f.sustainedCeiling.status === 'NOT_MEASURED' && f.sustainedCeiling.notMeasuredReason === 'HARNESS_ERROR',
        `[truncation:${label}] sustainedCeiling flagged`);
    ok(f.sustainedCeiling.phase3 === null && f.sustainedCeiling.combined === null,
        `[truncation:${label}] sustainedCeiling sub-fields null, not 0`);

    ok(f.graphics.status === 'NOT_MEASURED' && f.graphics.notMeasuredReason === 'HARNESS_ERROR',
        `[truncation:${label}] graphics flagged`);
    ok(f.graphics.ratioPhase5OverPhase4 === null,
        `[truncation:${label}] graphics ratio null, not 0`);

    ok(isHarnessError(f.battery.qIntMah), `[truncation:${label}] battery.qIntMah is HARNESS_ERROR, not 0/null`);
    ok(isHarnessError(f.battery.qCcMah), `[truncation:${label}] battery.qCcMah is HARNESS_ERROR`);
    ok(isHarnessError(f.battery.ccUpdates), `[truncation:${label}] battery.ccUpdates is HARNESS_ERROR (NOT 0 — the A76 trap)`);
    ok(isHarnessError(f.battery.charge_counter.snapshot), `[truncation:${label}] battery.charge_counter.snapshot is HARNESS_ERROR, not 0/null`);
    ok(isHarnessError(f.battery.charge_counter.series), `[truncation:${label}] battery.charge_counter.series is HARNESS_ERROR (distinct from the fv67 HARNESS_VERSION reason)`);
    ok(f.battery.consist.status === 'NOT_MEASURED' && f.battery.consist.reason === 'HARNESS_ERROR',
        `[truncation:${label}] battery.consist flagged HARNESS_ERROR (distinct from the fv67 HARNESS_VERSION reason)`);
    ok(f.battery.cap.status === 'NOT_MEASURED' && f.battery.cap.reason === 'HARNESS_ERROR',
        `[truncation:${label}] battery.cap flagged HARNESS_ERROR`);
    ok(isHarnessError(f.battery.info.dischargeRateUnderLoadMa),
        `[truncation:${label}] battery.info.dischargeRateUnderLoadMa is HARNESS_ERROR, not 0/null`);
    ok(isHarnessError(f.battery.info.voltageStabilityMv),
        `[truncation:${label}] battery.info.voltageStabilityMv is HARNESS_ERROR, not 0/null`);
    ok(isHarnessError(f.battery.info.rho), `[truncation:${label}] battery.info.rho is HARNESS_ERROR, not 0/null`);

    ok(f.storage.status === 'NOT_MEASURED' && f.storage.reason === 'HARNESS_ERROR',
        `[truncation:${label}] storage flagged`);
    ok(f.thermal.batteryTempRise.status === 'NOT_MEASURED' &&
        f.thermal.batteryTempRise.reason === 'HARNESS_ERROR',
    `[truncation:${label}] thermal.batteryTempRise flagged`);
    ok(f.thermal.batteryTempRise.valueC === null,
        `[truncation:${label}] thermal.batteryTempRise.valueC null, not 0`);

    // لا رمية أبداً — الدالة عادت بكائن منظّم في كل الحالات الخمس.
    ok(typeof f === 'object' && f !== null, `[truncation:${label}] computeFindings never throws`);
  }
}

console.log(`truncation regression (A76) section passed — 5 payload shapes`);

// ═══════════════════════════════════════════════════════════════════════
// 4. اصطناعي — UNSTABLE/ADVISORY من functionalResults
//    (لا فحص من الأربعة يحمل functionalResults؛ اختبار بمُدخل مُركَّب)
// ═══════════════════════════════════════════════════════════════════════
{
  const syntheticFunctionalResults = [
    {testId: 'C-04', categoryName: 'cpu', status: 'warning', rawValue: '3271', rawValueUnit: 'MFLOPS'},
    {testId: 'C-03', categoryName: 'cpu', status: 'pass', rawValue: '1.66', rawValueUnit: 'GHz'},
    // S-04 وS-05 عمداً غائبان — لاختبار مسار found:false.
  ];
  const fp = {
    header: s10Raw.header, footer: s10Raw.footer, samples: s10Raw.samples,
    variables: s10Raw.variables, functionalResults: syntheticFunctionalResults,
  };
  const f = computeFindings(fp);

  ok(Object.keys(f.unstableMeasurements).length === UNSTABLE_TEST_IDS.length,
      '[synthetic] unstableMeasurements covers all 4 declared testIds');
  ok(f.unstableMeasurements['C-04'].found === true && f.unstableMeasurements['C-04'].class === 'UNSTABLE',
      '[synthetic] C-04 found and tagged UNSTABLE');
  ok(f.unstableMeasurements['C-04'].entersGrade === false && f.unstableMeasurements['C-04'].entersFault === false,
      '[synthetic] C-04 never enters a grade or a fault');
  ok(f.unstableMeasurements['C-04'].rawValue === '3271',
      '[synthetic] C-04 relays rawValue as-is (no recomputation, no live CV)');
  ok(typeof f.unstableMeasurements['C-04'].criterion === 'string' &&
     f.unstableMeasurements['C-04'].criterion.includes('15%'),
  '[synthetic] C-04 carries the policy-not-measurement criterion note (decision 7)');
  ok(f.unstableMeasurements['S-04'].found === false &&
     f.unstableMeasurements['S-04'].reason === 'ABSENT_FROM_FUNCTIONAL_RESULTS',
  '[synthetic] S-04 absent from functionalResults is reported, not silently zero');

  ok(Object.keys(f.advisoryMeasurements).length === ADVISORY_TEST_IDS.length,
      '[synthetic] advisoryMeasurements covers S-06');
  ok(f.advisoryMeasurements['S-06'].found === false,
      '[synthetic] S-06 absent here too (not in the synthetic functionalResults)');
}

console.log(`synthetic UNSTABLE/ADVISORY section passed — NOT golden (no fixture carries functionalResults)`);

// ═══════════════════════════════════════════════════════════════════════
// 4-ب. ذهبي حقيقي — UNSTABLE/ADVISORY من functionalResults الفعلية
//      (الفجوة 2). المصدر: Firestore reports/{scanId}.rawFingerprint.
//      functionalResults، جُلب بـ
//      functions/scripts/fetch-functional-results-golden.js (قراءة فقط،
//      REST + gcloud auth print-access-token) إلى
//      functions/test/fixtures/golden/functionalResults-by-scanid.json.
//
//      ⚠️ سدّت جزئياً لا كلّياً: من الفحوص الأربعة المطلوبة، مستندان فقط
//      موجودان فعلياً في مجموعة reports (GET مباشر بمعرّف السكان —
//      نفس نمط .doc(scanId) في src/analysis/analyzeDevice.js:71):
//        b45c8cf6-e376-4765-8703-f68e9bc69844  → 200 OK، 85 عنصر functionalResults
//        34dff2b8-ce9e-4b40-86a9-1976c878e195  → 200 OK، 85 عنصر functionalResults
//        8909e850-b10c-466c-899a-ce97cb5c4fbe  → 404 NOT_FOUND (لا مستند إطلاقاً)
//        e4b65a2f-3a0c-4f11-939d-17eab7d0912f  → 404 NOT_FOUND (لا مستند إطلاقاً)
//      يطابق ما وثّقه golden/README.md أصلاً: هذان الفحصان (S10/Honor)
//      مصدرهما rebuld/s10-timeseries.json وrebuld/honor-timeseries.json —
//      سلسلتان زمنيتان خارجيتان لم تمرّا بمسار analyzeDevice المُخزِّن
//      لتقرير Firestore كامل بـfunctionalResults؛ ولا توجد قيمة C-04
//      حقيقية يمكن التحقّق منها لهذين السكانين. راجع تقرير المهمّة —
//      تناقض بين نصّ الأمر (أربعة مستندات) والواقع (اثنان فقط، القاعدة 14).
// ═══════════════════════════════════════════════════════════════════════
const functionalResultsByScanId = loadJson('functionalResults-by-scanid.json').byScanId;

{
  const REAL_CASES = [
    {
      label: 'b45c8cf6', raw: run1Raw,
      scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844',
      expectC04: {rawValue: '3271', status: 'warning'},
      expectS04: {rawValue: '1618', status: 'pass'},
      expectS05: {rawValue: '110516', status: 'pass'},
      expectC03: {rawValue: '2.14', status: 'pass'},
      expectS06: {rawValue: '3265', status: 'pass'},
    },
    {
      label: '34dff2b8', raw: run2Raw,
      scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195',
      expectC04: {rawValue: '5864', status: 'pass'},
      expectS04: {rawValue: '2359', status: 'pass'},
      expectS05: {rawValue: '98932', status: 'pass'},
      expectC03: {rawValue: '1.96', status: 'pass'},
      expectS06: {rawValue: '2597', status: 'warning'},
    },
  ];

  for (const c of REAL_CASES) {
    const fr = functionalResultsByScanId[c.scanId];
    ok(Array.isArray(fr) && fr.length > 0,
        `[golden-real:${c.label}] functionalResults-by-scanid.json carries a real array for ${c.scanId}`);

    // لا "DEGRADED" في المفردات الفعلية لحالة أي اختبار وظيفي — يثبت أن
    // الأرضية الإلزامية للأعطال (قرار 10) ليست مفهوماً موجوداً في بيانات
    // الإنتاج نفسها، لا فقط غائبة من الكود هنا.
    const statuses = new Set(fr.map((r) => r && r.status));
    ok(!statuses.has('DEGRADED'),
        `[golden-real:${c.label}] no functionalResults entry carries status DEGRADED (observed: ${[...statuses].join(',')})`);

    const fp = {
      header: c.raw.header, footer: c.raw.footer, samples: c.raw.samples,
      variables: c.raw.variables, functionalResults: fr,
    };
    const f = computeFindings(fp);

    // ── C-04: يجب أن يُوسَم UNSTABLE، لا يُنتج DEGRADED، لا يدخل الأرضية ──
    const c04 = f.unstableMeasurements['C-04'];
    ok(c04.found === true && c04.class === 'UNSTABLE',
        `[golden-real:${c.label}] C-04 found and tagged UNSTABLE`);
    ok(c04.rawValue === c.expectC04.rawValue,
        `[golden-real:${c.label}] C-04 rawValue matches Firestore (${c.expectC04.rawValue})`);
    ok(c04.testStatus === c.expectC04.status,
        `[golden-real:${c.label}] C-04 testStatus relayed as-is (${c.expectC04.status})`);
    ok(c04.testStatus !== 'DEGRADED',
        `[golden-real:${c.label}] C-04 does not produce DEGRADED`);
    ok(c04.entersGrade === false && c04.entersFault === false,
        `[golden-real:${c.label}] C-04 never enters a grade or the mandatory fault floor (decision 10) — ` +
        `this file has no grade/fault consumer at all yet (P1.3/P1.4), so entersGrade/entersFault are the only gate`);

    // ── S-04, S-05, C-03 نفس المعاملة ────────────────────────────────────
    for (const [testId, expect] of [['S-04', c.expectS04], ['S-05', c.expectS05], ['C-03', c.expectC03]]) {
      const m = f.unstableMeasurements[testId];
      ok(m.found === true && m.class === 'UNSTABLE',
          `[golden-real:${c.label}] ${testId} found and tagged UNSTABLE`);
      ok(m.rawValue === expect.rawValue,
          `[golden-real:${c.label}] ${testId} rawValue matches Firestore (${expect.rawValue})`);
      ok(m.testStatus !== 'DEGRADED',
          `[golden-real:${c.label}] ${testId} does not produce DEGRADED`);
      ok(m.entersGrade === false && m.entersFault === false,
          `[golden-real:${c.label}] ${testId} never enters a grade or the mandatory fault floor`);
    }

    // ── S-06: ADVISORY لا UNSTABLE ───────────────────────────────────────
    const s06 = f.advisoryMeasurements['S-06'];
    ok(s06.found === true && s06.class === 'ADVISORY',
        `[golden-real:${c.label}] S-06 found and tagged ADVISORY (not UNSTABLE)`);
    ok(s06.rawValue === c.expectS06.rawValue,
        `[golden-real:${c.label}] S-06 rawValue matches Firestore (${c.expectS06.rawValue})`);
    ok(s06.testStatus !== 'DEGRADED',
        `[golden-real:${c.label}] S-06 does not produce DEGRADED`);
  }

  // ── الفحصان بلا مستند Firestore — موثَّق صراحة، لا صمت ──────────────────
  ok(functionalResultsByScanId['8909e850-b10c-466c-899a-ce97cb5c4fbe'] === null,
      '[golden-real] 8909e850 (S10) has no Firestore reports/ document — 404, confirmed by fetch script, not a permissions gap');
  ok(functionalResultsByScanId['e4b65a2f-3a0c-4f11-939d-17eab7d0912f'] === null,
      '[golden-real] e4b65a2f (Honor) has no Firestore reports/ document — 404, confirmed by fetch script, not a permissions gap');
}

console.log(`golden-real UNSTABLE/ADVISORY section passed — 2/4 scans (b45c8cf6, 34dff2b8); ` +
    `8909e850/e4b65a2f have no Firestore document (see comment)`);

// ═══════════════════════════════════════════════════════════════════════
// 5. اصطناعي — البطارية fv68 (charge_counter_raw لكل عيّنة، بالاسم). لا فحص fv68 حقيقي من جهاز بعد.
//    (استُبدلت هذه الكتلة في الدفعة ٤: كانت تُثبّت القراءة بـ{index:11, name:'charge_counter_uah'} — اسم لا وجود له في أيّ حمولة،
//    وفهرس لا تحمله الحمولة الحقيقية. القاعدة 23: يُستبدل الاختبار الذي كان يُثبت السلوك الخاطئ.)
// ═══════════════════════════════════════════════════════════════════════
{
  // بناء عيّنات اصطناعية: 60 عيّنة، مستوى شحن يهبط من 90 إلى 85 بخطوات
  // منتظمة، وCC يتناقص خطّياً بمعدّل مستقلّ (غير مشتقّ من level) —
  // ليجتاز مسار "غير CC_DERIVED".
  const N = 60;
  const samples = [];
  for (let i = 0; i < N; i++) {
    const level = 90 - Math.floor(i / 10); // ينزل 1% كل 10 عيّنات → 6 مستويات
    const cc = 300000 - i * 500; // µAh، تناقص ثابت لا علاقة له بـlevel مباشرة
    samples.push({
      phase: (i < 5) ? 0 : (i >= N - 5) ? 7 : 3,
      v: [i * 5000, 30, 3800, -500000, level, 2000000, 50, 5000, 0, 0, 0, cc],
    });
  }
  // الحمولة الحقيقية: variables[] بـ{name, source, unit} **بلا index** (قيس على عيّنات fv68 الذهبية الثلاث)؛ فالفهرس = الموضع.
  // العمود 11 باسمه المحسوم charge_counter_raw ووحدته المعلنة «as_declared_by_device» (عقد ت-01 :420-421) — إعلان بعدم المعرفة لا وحدة.
  const variablesFv68 = [
    {name: 'timestamp_ms'}, {name: 'battery_temp_c'},
    {name: 'battery_voltage_mv'}, {name: 'battery_current_ua'},
    {name: 'battery_level_pct'}, {name: 'cpu_freq_max_khz'},
    {name: 'cpu_usage_pct'}, {name: 'package_power_mw'},
    {name: 'storage_throughput_mbps'}, {name: 'memory_bandwidth_mbps'},
    {name: 'gpu_fps'}, {name: 'charge_counter_raw', unit: 'as_declared_by_device'},
  ];
  const fp68 = {
    header: {scanId: 'synthetic-fv68', deviceModel: 'Synthetic', batteryLevelStart: 90, startTimestamp: 0},
    footer: {
      fieldsVersion: 68, batteryLevelEnd: 85, endTimestamp: N * 5000,
      batteryHealth: {designCapacityMah: 4000},
      stressEffectiveness: {peakBigFreqKhzAnywhere: 2000000},
      // س-27: القناة المُدرجة متتبَّعة — قائمة فارغة كاملة = «لا فشل» (≠ غياب المفتاح = «غير متتبَّع»).
      channelReadFailures: {charge_counter_raw: []},
      channelReadFailureCounts: {charge_counter_raw: 0},
    },
    samples, variables: variablesFv68,
  };

  const f = computeFindings(fp68);
  ok(f.battery.fieldsVersion === 68, '[synthetic fv68] fieldsVersion read as 68');
  ok(f.battery.ccDerived === false,
      '[synthetic fv68] a CC series independent of level is NOT flagged CC_DERIVED');
  ok(f.battery.ccUpdates === N - 1,
      '[synthetic fv68] ccUpdates counts every sample-to-sample change');

  // ── A100 (2026-09-21 +03) — qCcMah لا يُحسب إلا بوحدة مُعلَنة ───────────
  // وحدة العمود في fp68/variablesFv68 هي «as_declared_by_device» (كحال حمولة fv68 الحقيقية) — إعلان بعدم المعرفة لا وحدة قياس،
  // فهذا هو مُدخل الحالة الثالثة من الجدول الذهبي مباشرةً:
  // "سلسلة بلا وحدة → NOT_MEASURED/UNIT_UNDECLARED". قبل هذا الإصلاح كان
  // qCcMah يقسم على 1000 افتراضاً أنها µAh دائماً بصرف النظر عن أي وحدة
  // مُعلَنة فعلياً — نفس فخّ A38 (رقم كبير ≠ µAh حتماً، s10=3,542,000
  // مقابل honor=5,596 بنفس اسم الحقل).
  ok(f.battery.qCcMah && typeof f.battery.qCcMah === 'object' &&
      f.battery.qCcMah.status === 'NOT_MEASURED' && f.battery.qCcMah.reason === 'UNIT_UNDECLARED',
      '[A100][synthetic fv68] no unit declared: qCcMah = NOT_MEASURED/UNIT_UNDECLARED — no default /1000 (locks the A100 fix in)');
  ok(f.battery.consist.status === 'NOT_MEASURED' && f.battery.consist.reason === 'UNIT_UNDECLARED',
      '[A100][synthetic fv68] BAT-CONSIST is NOT_MEASURED/UNIT_UNDECLARED without a declared unit — the k=qCcMah/qIntMah gate never runs without a real qCcMah');
  ok(f.battery.cap.status === 'NOT_MEASURED' && f.battery.cap.reason === 'UNIT_UNDECLARED',
      '[A100][synthetic fv68] BAT-CAP is NOT_MEASURED/UNIT_UNDECLARED without a declared unit — same gate as BAT-CONSIST');

  // CC_DERIVED: نبني سلسلة حيث CC ثابت تماماً على قيمة FCC_est*level.
  // فحص نسبي مستقلّ عن الوحدة (CC_i مقابل level فقط) — يبقى صحيحاً حتى
  // بلا وحدة مُعلَنة، فيسبق بوّابة الوحدة على consist/cap. أمّا qCcMah
  // نفسه فيبقى UNIT_UNDECLARED — البوّابتان مستقلّتان تماماً.
  const samplesDerived = samples.map((s, i) => {
    const level = s.v[4];
    return Object.assign({}, s, {v: s.v.slice(0, 11).concat([Math.round(3000 * level)])});
  });
  const fDerived = computeFindings(Object.assign({}, fp68, {samples: samplesDerived}));
  ok(fDerived.battery.ccDerived === true,
      '[synthetic fv68] CC == FCC_est * level exactly → flagged CC_DERIVED');
  ok(fDerived.battery.consist.status === 'INFO_ONLY' && fDerived.battery.consist.reason === 'CC_DERIVED',
      '[synthetic fv68] CC_DERIVED reports BAT-CONSIST as information, not a verdict');
  ok(fDerived.battery.qCcMah && fDerived.battery.qCcMah.status === 'NOT_MEASURED' &&
      fDerived.battery.qCcMah.reason === 'UNIT_UNDECLARED',
      '[A100][synthetic fv68] qCcMah stays UNIT_UNDECLARED even on the CC_DERIVED path — the CC_DERIVED pattern check and the unit gate are independent of each other');

  // ── charge_counter.series — fv68، مهمّة 2026-09-21 +03. وحدة العمود في
  //    variablesFv68 أعلاه «as_declared_by_device» (كحال حمولة fv68 الحقيقية) —
  //    فالسلسلة تُصدَّر خامًا لكن NOT_MEASURED/UNIT_UNDECLARED، لا وحدة
  //    مخمَّنة من الاسم ولا من حجم القيم.
  const ccSeries = f.battery.charge_counter.series;
  ok(ccSeries.status === 'NOT_MEASURED' && ccSeries.reason === 'UNIT_UNDECLARED',
      '[synthetic fv68] series is NOT_MEASURED/UNIT_UNDECLARED when the channel\'s declared unit is "as_declared_by_device" — that is a declaration of not knowing, not a unit');
  ok(ccSeries.unit === null && ccSeries.unitSource === 'AS_DECLARED_BY_DEVICE',
      '[synthetic fv68] series.unit is null and unitSource says why (AS_DECLARED_BY_DEVICE) — not guessed as µAh or mAh from the magnitude');
  ok(Array.isArray(ccSeries.rawValues) && ccSeries.rawValues.length === N,
      '[synthetic fv68] series.rawValues carries the raw per-sample values (still stored — rule 20), length matches sample count');
  ok(ccSeries.rawValues[0] === 300000 && ccSeries.rawValues[N - 1] === 300000 - (N - 1) * 500,
      '[synthetic fv68] series.rawValues[0]/[last] match the synthetic v[11] values exactly, untouched');

  // ── نفس المُدخل، لكن variables[11] يُعلن .unit فعلياً هذه المرّة — يتحقّق
  //    مسار "الوحدة من مصدرها" (لا يوجد فحص fv68 حقيقي يحمل هذا اليوم؛
  //    اصطناعي بحت، يثبت الميكانيكا فقط).
  const variablesFv68WithUnit = variablesFv68.map((v) =>
    v.name === 'charge_counter_raw' ? Object.assign({}, v, {unit: 'µAh'}) : v);
  const fWithUnit = computeFindings(Object.assign({}, fp68, {variables: variablesFv68WithUnit}));
  const ccSeriesWithUnit = fWithUnit.battery.charge_counter.series;
  ok(ccSeriesWithUnit.status === 'MEASURED' && ccSeriesWithUnit.reason === null,
      '[synthetic fv68] series is MEASURED when the channel unit is a real unit declared in the payload');
  ok(ccSeriesWithUnit.unit === 'µAh' && ccSeriesWithUnit.unitSource === 'DECLARED_IN_VARIABLES',
      '[synthetic fv68] series.unit is read verbatim from the declared channel unit — not hardcoded, not inferred');

  // ── A100 — الجدول الذهبي كاملاً: نفس ccSeq الخام (rawCcDelta = 29,500)
  //    بثلاث وحدات مُعلَنة مختلفة، على نفس مسار computeBattery المُستخدَم
  //    أعلاه لـ f/fWithUnit. الحالة الثالثة (بلا وحدة) مُثبَتة أعلاه على
  //    f مباشرة؛ هنا الحالتان الرقميتان تثبتان أن التحويل من unit
  //    المُعلَن حرفياً لا من حجم الرقم (القسمة تختلف كلياً بين الحالتين
  //    رغم أن ccSeq الخام مطابق تماماً).
  const rawCcDelta = 300000 - (300000 - (N - 1) * 500); // = 29,500 خام، من نفس samples أعلاه

  // الحالة ١ — µAh مُعلَنة: qCcMah = rawDelta / 1000.
  ok(typeof fWithUnit.battery.qCcMah === 'number',
      '[A100][golden×3 · µAh] qCcMah IS a number once the channel unit = "µAh" is actually declared');
  near(fWithUnit.battery.qCcMah, rawCcDelta / 1000, 0.001,
      '[A100][golden×3 · µAh] qCcMah = rawDelta / 1000 (µAh → mAh), derived from the declared unit');

  // الحالة ٢ — نفس ccSeq الخام بالضبط، لكن الوحدة المُعلَنة mAh هذه المرّة
  // — تحويل هويّة بلا قسمة، على قيم خام مطابقة حرفياً لِـ fWithUnit.
  const variablesFv68WithMahUnit = variablesFv68.map((v) =>
    v.name === 'charge_counter_raw' ? Object.assign({}, v, {unit: 'mAh'}) : v);
  const fWithMahUnit = computeFindings(Object.assign({}, fp68, {variables: variablesFv68WithMahUnit}));
  ok(typeof fWithMahUnit.battery.qCcMah === 'number',
      '[A100][golden×3 · mAh] qCcMah IS a number once the channel unit = "mAh" is actually declared');
  near(fWithMahUnit.battery.qCcMah, rawCcDelta, 0.001,
      '[A100][golden×3 · mAh] qCcMah = rawDelta verbatim (identity conversion, NOT divided by 1000)');
  ok(Math.abs(fWithMahUnit.battery.qCcMah - fWithUnit.battery.qCcMah) > 1,
      '[A100][golden×3] µAh-declared vs mAh-declared on the IDENTICAL raw ccSeq give genuinely different qCcMah values — ' +
      'the conversion is derived from the declared channel unit, never guessed from the magnitude of the number (that guess is A38 itself)');
}

console.log(`synthetic fv68 battery section passed — NOT a recorded device golden; the derived fv68 payloads are exercised in findingsFv68Readers.test.js and analyzeDeviceFv68.e2e.test.js`);

// ═══════════════════════════════════════════════════════════════════════
// 6. البوّابة المشترَكة passesEvidenceGate — عقد صريح لِـ P1.2
// ═══════════════════════════════════════════════════════════════════════
{
  ok(passesEvidenceGate(40, 5) === true, 'gate: exactly at both minimums passes');
  ok(passesEvidenceGate(39, 5) === false, 'gate: nSamples just under minimum fails');
  ok(passesEvidenceGate(40, 4) === false, 'gate: cadence just under minimum fails');
  ok(EVIDENCE_MIN_SAMPLES === 40 && EVIDENCE_MIN_CADENCE_UPDATES === 5,
      'gate thresholds match P1.2\'s literal text (nSamples >= 40, sourceCadenceUpdates >= 5)');
}

// ═══════════════════════════════════════════════════════════════════════
// 7. دوال داخلية — تحقّق سريع على أمثلة معروفة يدوياً
// ═══════════════════════════════════════════════════════════════════════
{
  ok(_internal.median([1, 2, 3]) === 2, 'median: odd length');
  ok(_internal.median([1, 2, 3, 4]) === 2.5, 'median: even length');
  ok(_internal.changes([1, 1, 2, 2, 3]) === 2, 'changes: counts transitions only');
  ok(_internal.percentile([1, 2, 3, 4, 5], 0.5) === 3, 'percentile: median via p50');
  near(_internal.pstdev([2, 4, 4, 4, 5, 5, 7, 9]), 2, 0.001, 'pstdev: textbook population stdev example');
}

// ═══════════════════════════════════════════════════════════════════════
// 8. الفجوة 1 — thresholdSet (بذرة) لعتبة قفل vsync
// ═══════════════════════════════════════════════════════════════════════
{
  ok(typeof thresholdSet === 'object' && thresholdSet !== null,
      'thresholdSet exists (seed — did not exist anywhere in the repo before this change)');
  const entry = thresholdSet.vsyncLockCombinedFraction;
  ok(entry && entry.value === VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD,
      'thresholdSet.vsyncLockCombinedFraction.value matches the constant actually used in computeGraphics');
  ok(entry.label === VSYNC_LOCK_THRESHOLD_LABEL && entry.label === 'مبدئية — تحتاج معايرة',
      'thresholdSet entry is explicitly labeled preliminary/needs-calibration, not a proven threshold');
  ok(typeof entry.source === 'string' && entry.source.includes('0.941') &&
     entry.source.includes('62%') && entry.source.includes('32%'),
  'thresholdSet entry cites the two reference numbers (Honor 62%+32%=0.941 vs S10 free)');
}

// ═══════════════════════════════════════════════════════════════════════
// 9. الفجوة 5 — cvPct حيّ في channels.*.* (مختلف عن CV قرار 7)
// ═══════════════════════════════════════════════════════════════════════
{
  const f = computeFindings(s10Raw);
  const cpuUsagePhase3 = f.channels.cpu_usage_pct.CPU_SUSTAINED;
  ok(typeof cpuUsagePhase3.cvPct === 'number' && isFinite(cpuUsagePhase3.cvPct),
      'cvPct is a live finite number on a populated (channel, phase) bucket, not static/undefined');

  // إعادة حساب مستقلّة من raw samples مباشرة (لا عبر channelStats) —
  // تحقّق حقيقي من الصيغة، لا مجرّد "الحقل موجود".
  const idx = [];
  for (let i = 0; i < s10Raw.samples.length; i++) {
    if (s10Raw.samples[i].phase === 3) idx.push(i);
  }
  const cpuUsageIdx = s10Raw.variables.find((v) => v.name === 'cpu_usage_pct').index;
  const values = idx.map((i) => s10Raw.samples[i].v[cpuUsageIdx]);
  const m = _internal.mean(values);
  const sd = _internal.pstdev(values);
  const expectedCvPct = (sd / Math.abs(m)) * 100;
  near(cpuUsagePhase3.cvPct, expectedCvPct, 0.0001,
      's10: cvPct on cpu_usage_pct/CPU_SUSTAINED matches an independent pstdev/|mean|*100 computed here from raw samples');

  // اسم مميَّز عمداً عن CV قرار 7 — لا خلط بين البُعدين (زمن لا تكرار):
  // cvPct لا يظهر إطلاقاً داخل unstableMeasurements (ذاك يحمل rawValue/
  // testStatus فقط من functionalResults، لا أي حقل من channels).
  ok(!JSON.stringify(f.unstableMeasurements).includes('cvPct'),
      'cvPct (within-scan, per channel/phase) never leaks into unstableMeasurements — ' +
      'a distinct concept from decision-7 CV (cross-session, 5 repeats), see findings.js channelStats comment');

  // مساواة صفرية: سلسلة ثابتة تماماً (تباين صفر، متوسط ≠ صفر) → الصيغة
  // تعطي 0 بالضبط لا null — تحقّق مباشر من صيغة pstdev/|mean|*100 نفسها.
  const zeroVarianceCvPct = (_internal.pstdev([5, 5, 5]) / Math.abs(_internal.mean([5, 5, 5]))) * 100;
  ok(zeroVarianceCvPct === 0, 'sanity: pstdev/|mean| formula gives exactly 0 on a constant series (not null)');
}

console.log(`\nfindings.test.js: ${n}/${n} assertions passed`);
