'use strict';

const { CH, PHASE } = require('../../layer1/utils/channels');
const { pearson, std } = require('../utils/stats2');

// v63 Fix 2: per-channel minimum std thresholds, below which a Pearson
// correlation is statistically meaningless (signal is below sensor noise
// floor or steady-state idle). Sources:
//   - skin_temp_C / battery_temp_C: phone thermistor resolution ~0.1 °C;
//     0.3 °C threshold = 3× resolution to ensure non-trivial signal swing.
//   - package_power_mW: idle ripple typically 50–150 mW; 200 mW = 1.5× upper
//     idle range to require active load variation.
//   - cpu_freq_big_kHz: governor step granularity is 50–100 MHz on most SoCs;
//     50 MHz threshold = 1 governor step, the minimum non-static signal.
//   - cpu_usage_pct: scheduler reporting jitter ~1–3%; 5% = 2× jitter.
//   - battery_voltage_mV: typical sensor resolution 1–2 mV; 5 mV = 2.5×.
//   - battery_current_uA: idle noise ~30–50 mA; 100 mA threshold = 2× idle.
const STD_THRESHOLDS = {
  battery_temp_c: 0.3,
  skin_temp_c: 0.3,
  package_power_mw: 200,
  cpu_freq_big_khz: 50_000,
  cpu_usage_pct: 5,
  battery_voltage_mv: 5,
  battery_current_uA_abs: 100_000,
};

// T2 — Cross-channel correlation analysis (phase 5).
// Compute Pearson correlations between channels that are physically related.
// Significant deviations from physical expectation are diagnostic.
//
// Expected correlations under sustained combined load:
//   - battery_temp vs package_power : POSITIVE (~0.5-0.9). Power dissipates as heat.
//   - cpu_freq_big vs cpu_usage     : POSITIVE (~0.3-0.7). Higher freq tracks higher load.
//   - battery_voltage vs |battery_current| : NEGATIVE (~-0.3 to -0.9). Ohm's law: more current = more sag.

const PAIRS = [
  {
    key: 'temp_vs_power',
    label: 'battery_temp vs package_power',
    expected: 'positive',
    expectedRange: [0.3, 1.0],
    minValid: 30,
    channels: ['battery_temp_c', 'package_power_mw'],
    extract: (samples) => {
      const x = [], y = [];
      for (const s of samples) {
        const t = s.v[CH.BATT_TEMP];
        const p = s.v[CH.PACKAGE_POWER_MW];
        if (typeof t === 'number' && t > 0 && typeof p === 'number' && p > 0) {
          x.push(t); y.push(p);
        }
      }
      return { x, y };
    },
  },
  {
    key: 'freq_vs_usage',
    label: 'cpu_freq_big vs cpu_usage',
    expected: 'positive',
    expectedRange: [0.0, 1.0],
    minValid: 30,
    channels: ['cpu_freq_big_khz', 'cpu_usage_pct'],
    extract: (samples) => {
      const x = [], y = [];
      for (const s of samples) {
        const f = s.v[CH.CPU_FREQ_BIG];
        const u = s.v[CH.CPU_USAGE];
        if (typeof f === 'number' && f > 0 && typeof u === 'number') {
          x.push(f); y.push(u);
        }
      }
      return { x, y };
    },
  },
  {
    key: 'voltage_vs_abs_current',
    label: 'battery_voltage vs |battery_current|',
    expected: 'negative',
    expectedRange: [-1.0, -0.0],
    minValid: 30,
    channels: ['battery_voltage_mv', 'battery_current_uA_abs'],
    extract: (samples) => {
      const x = [], y = [];
      for (const s of samples) {
        const v = s.v[CH.BATT_VOLT];
        const i = s.v[CH.BATT_CURRENT];
        if (typeof v === 'number' && v > 0 && typeof i === 'number' && Math.abs(i) <= 15_000_000) {
          x.push(v); y.push(Math.abs(i));
        }
      }
      return { x, y };
    },
  },
];

function classifyDeviation(r, expected, expectedRange) {
  if (r == null) return { classification: 'INSUFFICIENT_DATA', confidence: 'low' };
  // Match expected sign?
  const signMatch =
    (expected === 'positive' && r > 0.1) ||
    (expected === 'negative' && r < -0.1);
  if (signMatch) {
    if (r >= expectedRange[0] && r <= expectedRange[1]) {
      return { classification: 'physically_consistent', confidence: 'high' };
    }
    // Right sign but weak magnitude.
    return { classification: 'weak_but_correct_sign', confidence: 'medium' };
  }
  // Wrong sign or near-zero.
  if (Math.abs(r) < 0.1) {
    return { classification: 'no_correlation', confidence: 'medium' };
  }
  return { classification: 'sign_inverted_anomaly', confidence: 'medium' };
}

function analyzePair(samples, pair) {
  const { x, y } = pair.extract(samples);
  if (x.length < pair.minValid) {
    return {
      pair: pair.key,
      label: pair.label,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      reason: 'fewer_than_min_valid_pairs',
      n: x.length,
      min_required: pair.minValid,
    };
  }

  // v63 Fix 2: minimum-variance gate. Pearson r on a near-flat signal is
  // statistically meaningless — it's noise correlation, not a physical
  // relationship. Reject before computing classification if either channel's
  // std is below its per-channel threshold.
  const stdX = std(x);
  const stdY = std(y);
  const thrX = STD_THRESHOLDS[pair.channels[0]];
  const thrY = STD_THRESHOLDS[pair.channels[1]];
  if (stdX != null && stdY != null && thrX != null && thrY != null
      && (stdX < thrX || stdY < thrY)) {
    // Still compute r for transparency; the classification overrides.
    const rNoisy = pearson(x, y);
    return {
      pair: pair.key,
      label: pair.label,
      classification: 'insufficient_signal_amplitude',
      confidence: 'low',
      reason: 'channel_std_below_minimum',
      pearson_r: rNoisy == null ? null : Number(rNoisy.toFixed(3)),
      std_channel_1: Number(stdX.toFixed(3)),
      std_channel_2: Number(stdY.toFixed(3)),
      threshold_channel_1: thrX,
      threshold_channel_2: thrY,
      channel_1: pair.channels[0],
      channel_2: pair.channels[1],
      expected: pair.expected,
      n: x.length,
    };
  }

  const r = pearson(x, y);
  if (r == null) {
    return {
      pair: pair.key,
      label: pair.label,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      reason: 'undefined_correlation_zero_variance',
      n: x.length,
    };
  }
  const cls = classifyDeviation(r, pair.expected, pair.expectedRange);
  return {
    pair: pair.key,
    label: pair.label,
    classification: cls.classification,
    confidence: cls.confidence,
    pearson_r: Number(r.toFixed(3)),
    expected: pair.expected,
    expected_range: pair.expectedRange,
    n: x.length,
    std_channel_1: Number(stdX.toFixed(3)),
    std_channel_2: Number(stdY.toFixed(3)),
  };
}

function computeCrossChannelCorrelation(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'pearson_phase5', reason: 'empty_samples' },
    };
  }

  const phase5 = samples.filter((s) => s && s.phase === PHASE.COMBINED);
  if (phase5.length < 30) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'pearson_phase5', reason: 'fewer_than_30_phase5_samples', phase5_count: phase5.length },
    };
  }

  const results = PAIRS.map((p) => analyzePair(phase5, p));

  // Aggregate worst classification. insufficient_signal_amplitude is treated as
  // a non-finding (rank below physically_consistent), since it means the test
  // didn't produce enough signal to evaluate, not that anything is wrong.
  const order = {
    INSUFFICIENT_DATA: 0,
    insufficient_signal_amplitude: 0,
    physically_consistent: 1,
    weak_but_correct_sign: 2,
    no_correlation: 3,
    sign_inverted_anomaly: 4,
  };
  let worst = results[0];
  for (const c of results) {
    if ((order[c.classification] || 0) > (order[worst.classification] || 0)) worst = c;
  }

  return {
    value: {
      pairs_evaluated: results.length,
      worst_pair: worst.pair,
      worst_classification: worst.classification,
    },
    classification: worst.classification,
    confidence: worst.confidence,
    evidence: {
      method: 'pearson_phase5',
      phase5_samples_used: phase5.length,
      pairs: results,
    },
  };
}

module.exports = { computeCrossChannelCorrelation };
