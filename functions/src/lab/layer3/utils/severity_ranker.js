'use strict';

// Severity-based ordering for the "Critical Findings" section. Counters
// DeepSeek's lost-in-the-middle tendency by surfacing high-severity items first.
//
// v63 Fix 4: completeness audit. Every classification string produced by
// Layer 1 and Layer 2 is now explicitly mapped. Previously-missing strings
// (e.g. degraded_cooling, oem_policy_not_defect, weak_but_correct_sign) used
// to silently default to severity 1 — meaning they wouldn't surface in the
// Critical Findings preface even when they should.
//
// Severity scale (higher = more urgent):
//   3 — critical: hard-defect or hard-warning findings
//   2 — warning: concerning but not critical (also includes
//                INSUFFICIENT_STRESS_DATA which signals an evaluation failure)
//   1 — watch: borderline, low-magnitude, or context-dependent
//   0 — info / nominal: healthy, expected, or "test design didn't probe this"

const SEVERITY = {
  // ── 3: critical ────────────────────────────────────────────────────────
  // Layer 1 worst-tier classifications
  end_of_life: 3,
  severe_degradation: 3,
  cooling_defect: 3,
  governor_capping_severe: 3,
  very_unstable: 3,
  // Layer 2 critical findings (real anomalies, not noise)
  sign_inverted_anomaly: 3,        // After Fix 2's variance gate, this only fires on real signal
  severe_decline: 3,
  rapid_throttling_drift: 3,
  cooling_during_load_anomaly: 3,
  significant_anomalies: 3,
  rising_voltage_anomaly: 3,

  // ── 2: warning ────────────────────────────────────────────────────────
  // Layer 1 mid-tier classifications
  degraded: 2,
  degraded_cooling: 2,             // ← previously missing; affected Xiaomi v4 narrative
  weak_cooling: 2,
  cooling_concern: 2,
  slow: 2,
  very_slow: 2,
  thermal_throttling_aggressive: 2,
  oem_policy_aggressive: 2,
  governor_capping: 2,
  governor_capping_aggressive: 2,
  high: 2,                         // voltage_sag_severity classification
  unusual_chemistry_or_aged: 2,
  // Stress-test failures fall in warning tier
  INSUFFICIENT_STRESS_DATA: 2,
  // Layer 2 warning-tier
  broader_spectrum_aging_likely: 2,
  unstable_signal: 2,
  mild_anomalies: 2,
  steep_decline_high_impedance: 2,
  rapid_heating: 2,
  high_frequency_content_anomaly: 2,
  noisy_load_step: 2,              // Fix 5 introduces this
  noisy_no_load_step: 2,           // Fix 5 introduces this
  concern: 2,                      // L2 trends aggregate
  high_skew: 2,                    // per-phase distribution warning
  heavy_tailed: 2,                 // distribution shape warning

  // ── 1: watch ────────────────────────────────────────────────────────
  aging: 1,
  marginal: 1,
  unstable: 1,
  oem_policy_not_defect: 1,        // ← was 1 already; explicit so audit stays clean
  expected_under_load: 1,
  flat_thermal_response: 1,
  flat_signal: 1,
  moderate: 1,                     // voltage_sag_severity moderate band
  moderate_decline: 1,
  moderate_skew: 1,
  somewhat_peaked: 1,
  flat_distribution: 1,
  slight_deviation: 1,
  inconclusive: 1,
  expected_boundary_artifacts: 1,
  partial_data: 1,
  watch: 1,                        // L2 trends aggregate
  weak_but_correct_sign: 1,        // ← previously missing
  no_correlation: 1,               // factual, mild concern
  mild_drift_down: 1,
  dominant_freq_below_load_step: 1, // legacy class; Fix 5 splits this
  low_entropy_no_load_step: 1,     // Fix 5 introduces this
  dominant_freq_above_load_step: 1, // Fix 5 introduces this
  oscillatory: 1,                  // autocorr classification (low/negative)

  // ── 0: info / nominal ─────────────────────────────────────────────────
  healthy: 0,
  minimal: 0,
  normal: 0,
  very_stable: 0,
  excellent: 0,
  optimal: 0,
  no_throttle: 0,
  excellent_cooling: 0,
  consistent_with_nmc: 0,
  consistent_with_nmc_healthy: 0,
  healthy_load_step_signature: 0,  // Fix 5 introduces this
  physically_consistent: 0,
  clean: 0,
  stable: 0,
  normal_decline: 0,
  normal_heating: 0,
  good: 0,
  none_well_cooled: 0,
  none_thermal_pressure_within_design: 0,
  thermal_throttling_normal: 0,
  computed: 0,
  symmetric: 0,
  near_normal: 0,
  smooth: 0,
  moderate_correlation: 0,
  low_correlation: 0,
  consistent: 0,
  very_consistent: 0,
  variable: 0,                     // factual, not a concern
  highly_variable: 1,              // → escalates to watch
  // Factual / non-finding states (do not flag in critical):
  INSUFFICIENT_DATA: 0,
  insufficient_signal_amplitude: 0, // Fix 2 introduces this — purely informational
  unstable_readings: 1,             // OCV: noisy data — watch but not warning
  frequency_climb: 1,
};

// Track unmapped classifications so we can surface them.
// If a classification string is encountered that's NOT in SEVERITY:
//   - Log a warning to stderr (once per unique string)
//   - Default to severity 2 (safer than 1 — surfaces as "watch" rather than
//     hidden in critical preface)
const UNKNOWN_SEEN = new Set();
function severityOf(classification) {
  if (!classification) return 0;
  if (SEVERITY[classification] !== undefined) return SEVERITY[classification];
  if (!UNKNOWN_SEEN.has(classification)) {
    UNKNOWN_SEEN.add(classification);
    try {
      // eslint-disable-next-line no-console
      console.warn('[severity_ranker] Unknown classification "' + classification + '"; defaulting to severity 2');
    } catch (_) { /* best-effort */ }
  }
  return 2;
}

// Build a flat list of {category, key, classification, severity, oneLineMsg}
// from Layer 1 + Layer 2 outputs. Used by the "Critical Findings" section.
function rankFindings(layer1, layer2, lang, msgFor) {
  const findings = [];

  function pushL1(category, key, feature) {
    if (!feature) return;
    findings.push({
      source: 'L1',
      category,
      key,
      classification: feature.classification,
      severity: severityOf(feature.classification),
      confidence: feature.confidence,
      msg: msgFor ? msgFor('L1', category, key, feature, lang) : null,
    });
  }
  function pushL2(category, key, feature) {
    if (!feature) return;
    findings.push({
      source: 'L2',
      category,
      key,
      classification: feature.classification,
      severity: severityOf(feature.classification),
      confidence: feature.confidence,
      msg: msgFor ? msgFor('L2', category, key, feature, lang) : null,
    });
  }

  if (layer1 && layer1.features) {
    const f = layer1.features;
    if (f.battery) {
      pushL1('battery', 'internalResistance', f.battery.internalResistance);
      pushL1('battery', 'voltageSagSeverity', f.battery.voltageSagSeverity);
      pushL1('battery', 'coulombicSoH', f.battery.coulombicSoH);
      pushL1('battery', 'ocvSignature', f.battery.ocvSignature);
    }
    if (f.thermal) {
      pushL1('thermal', 'thermalResistance', f.thermal.thermalResistance);
      pushL1('thermal', 'timeToThrottle', f.thermal.timeToThrottle);
      pushL1('thermal', 'cooldownTimeConstant', f.thermal.cooldownTimeConstant);
    }
    if (f.performance) {
      pushL1('performance', 'stabilityIndex', f.performance.stabilityIndex);
      pushL1('performance', 'dropP3toP5', f.performance.dropP3toP5);
      pushL1('performance', 'throttlingType', f.performance.throttlingType);
    }
  }

  if (layer2 && layer2.features) {
    const f = layer2.features;
    pushL2('anomalies', 'zscore', f.anomalies);
    pushL2('correlations', 'phase5_pearson', f.correlations);
    pushL2('spectral', 'phase6_fft', f.spectral);
    pushL2('trends', 'phase5_phase3', f.trends);
  }

  // Sort by severity DESC, then put L2 before L1 within the same severity for variety.
  findings.sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    return (b.source === 'L2' ? 1 : 0) - (a.source === 'L2' ? 1 : 0);
  });

  return findings;
}

module.exports = { severityOf, rankFindings, SEVERITY };
