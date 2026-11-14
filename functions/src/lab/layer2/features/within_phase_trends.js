'use strict';

const { CH, PHASE } = require('../../layer1/utils/channels');
const { ols } = require('../utils/stats2');

// T5 — Linear-trend detection within phases via ordinary least squares.
//
// Three trends are diagnostic:
//   - voltage_decline_phase5: slope of battery_voltage over phase 5.
//     Expected: small negative slope. Steep negative = high impedance under sustained load.
//   - skin_temp_rise_phase5: slope of skin_temp (or battery_temp fallback) over phase 5.
//     Expected: positive slope (heating). Negative = thermal sensor lying or under-stress.
//   - cpu_freq_drift_phase3: slope of cpu_freq_big over phase 3.
//     Expected: ~0 slope. Significant positive or negative drift = freq governor instability.

function classifyVoltageDeclineSlope(slope_mV_per_s) {
  if (slope_mV_per_s == null) return null;
  // Expect mild negative slope under sustained load.
  if (slope_mV_per_s > 1) return 'rising_voltage_anomaly'; // voltage going up under load — odd
  if (slope_mV_per_s > -0.5) return 'normal_decline';
  if (slope_mV_per_s > -1.5) return 'moderate_decline';
  if (slope_mV_per_s > -3) return 'steep_decline_high_impedance';
  return 'severe_decline';
}

function classifyTempRiseSlope(slope_C_per_s) {
  if (slope_C_per_s == null) return null;
  // Phase 5 is 60 s; expect 1-5 °C total rise → 0.017-0.083 °C/s.
  if (slope_C_per_s > 0.1) return 'rapid_heating';
  if (slope_C_per_s > 0.02) return 'normal_heating';
  if (slope_C_per_s > -0.02) return 'flat_thermal_response';
  return 'cooling_during_load_anomaly';
}

function classifyFreqDriftSlope(slope_kHz_per_s, meanFreq_kHz) {
  if (slope_kHz_per_s == null || meanFreq_kHz == null || meanFreq_kHz === 0) return null;
  // Normalize to %/s of mean.
  const pctPerSec = (slope_kHz_per_s / meanFreq_kHz) * 100;
  if (Math.abs(pctPerSec) < 0.05) return 'stable';
  if (pctPerSec > 0.05) return 'frequency_climb';
  if (pctPerSec > -0.2) return 'mild_drift_down';
  return 'rapid_throttling_drift';
}

function timeSeconds(samples) {
  if (samples.length === 0) return [];
  const t0 = samples[0].ts;
  return samples.map((s) => (s.ts - t0) / 1000);
}

function voltageDeclinePhase5(samples) {
  const phase5 = samples.filter((s) => s.phase === PHASE.COMBINED);
  const valid = phase5.filter((s) => typeof s.v[CH.BATT_VOLT] === 'number' && s.v[CH.BATT_VOLT] > 0);
  if (valid.length < 30) {
    return {
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      reason: 'fewer_than_30_phase5_voltage_samples',
      n: valid.length,
    };
  }
  const t = timeSeconds(valid);
  const v = valid.map((s) => s.v[CH.BATT_VOLT]);
  const fit = ols(t, v);
  if (!fit) return { classification: 'INSUFFICIENT_DATA', confidence: 'low', reason: 'ols_failed' };
  return {
    method: 'ols_voltage_phase5',
    slope_mV_per_s: Number(fit.slope.toFixed(3)),
    intercept_mV: Number(fit.intercept.toFixed(1)),
    r2: Number(fit.r2.toFixed(3)),
    n: fit.n,
    classification: classifyVoltageDeclineSlope(fit.slope),
    confidence: fit.r2 > 0.5 ? 'high' : (fit.r2 > 0.2 ? 'medium' : 'low'),
  };
}

function skinTempRisePhase5(samples) {
  const phase5 = samples.filter((s) => s.phase === PHASE.COMBINED);
  // Prefer skin temp, fallback to battery temp if all -1 / non-positive.
  const skinValid = phase5.filter((s) => typeof s.v[CH.SKIN_TEMP] === 'number' && s.v[CH.SKIN_TEMP] > 0);
  let usedSource = 'skin';
  let valid = skinValid;
  if (skinValid.length < 30) {
    const battValid = phase5.filter((s) => typeof s.v[CH.BATT_TEMP] === 'number' && s.v[CH.BATT_TEMP] > 0);
    if (battValid.length >= 30) {
      valid = battValid;
      usedSource = 'battery';
    } else {
      return {
        classification: 'INSUFFICIENT_DATA',
        confidence: 'low',
        reason: 'fewer_than_30_phase5_temp_samples',
        skin_n: skinValid.length,
        batt_n: battValid.length,
      };
    }
  }
  const t = timeSeconds(valid);
  const T = valid.map((s) => (usedSource === 'skin' ? s.v[CH.SKIN_TEMP] : s.v[CH.BATT_TEMP]));
  const fit = ols(t, T);
  if (!fit) return { classification: 'INSUFFICIENT_DATA', confidence: 'low', reason: 'ols_failed' };
  return {
    method: 'ols_temp_phase5',
    temp_source: usedSource,
    slope_C_per_s: Number(fit.slope.toFixed(4)),
    total_rise_C_estimated: Number((fit.slope * (t[t.length - 1] - t[0])).toFixed(2)),
    r2: Number(fit.r2.toFixed(3)),
    n: fit.n,
    classification: classifyTempRiseSlope(fit.slope),
    confidence: fit.r2 > 0.6 ? 'high' : (fit.r2 > 0.3 ? 'medium' : 'low'),
  };
}

function freqDriftPhase3(samples) {
  const phase3 = samples.filter((s) => s.phase === PHASE.CPU);
  const valid = phase3.filter((s) => typeof s.v[CH.CPU_FREQ_BIG] === 'number' && s.v[CH.CPU_FREQ_BIG] > 0);
  if (valid.length < 30) {
    return {
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      reason: 'fewer_than_30_phase3_freq_samples',
      n: valid.length,
    };
  }
  const t = timeSeconds(valid);
  const f = valid.map((s) => s.v[CH.CPU_FREQ_BIG]);
  const fit = ols(t, f);
  if (!fit) return { classification: 'INSUFFICIENT_DATA', confidence: 'low', reason: 'ols_failed' };
  const meanFreq = f.reduce((a, b) => a + b, 0) / f.length;
  return {
    method: 'ols_freq_big_phase3',
    slope_kHz_per_s: Number(fit.slope.toFixed(2)),
    pct_drift_per_s: Number(((fit.slope / meanFreq) * 100).toFixed(4)),
    mean_freq_kHz: Math.round(meanFreq),
    r2: Number(fit.r2.toFixed(3)),
    n: fit.n,
    classification: classifyFreqDriftSlope(fit.slope, meanFreq),
    confidence: fit.r2 > 0.3 ? 'medium' : 'low',
  };
}

function computeWithinPhaseTrends(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'within_phase_ols_trends', reason: 'empty_samples' },
    };
  }
  const voltage = voltageDeclinePhase5(samples);
  const temp = skinTempRisePhase5(samples);
  const freq = freqDriftPhase3(samples);

  const trends = { voltage_decline_phase5: voltage, skin_temp_rise_phase5: temp, cpu_freq_drift_phase3: freq };

  // Aggregate worst classification.
  const concernSet = new Set([
    'severe_decline',
    'rapid_throttling_drift',
    'cooling_during_load_anomaly',
    'rising_voltage_anomaly',
  ]);
  const watchSet = new Set([
    'steep_decline_high_impedance',
    'rapid_heating',
    'mild_drift_down',
    'flat_thermal_response',
  ]);

  let aggregateClass = 'normal';
  let aggregateConf = 'high';
  for (const t of [voltage, temp, freq]) {
    if (t.classification === 'INSUFFICIENT_DATA') {
      if (aggregateClass === 'normal') aggregateClass = 'partial_data';
      if (aggregateConf === 'high') aggregateConf = 'medium';
    } else if (concernSet.has(t.classification)) {
      aggregateClass = 'concern';
      aggregateConf = 'medium';
    } else if (watchSet.has(t.classification) && aggregateClass === 'normal') {
      aggregateClass = 'watch';
      aggregateConf = 'medium';
    }
  }

  return {
    value: { aggregate: aggregateClass },
    classification: aggregateClass,
    confidence: aggregateConf,
    evidence: { method: 'within_phase_ols_trends', trends },
  };
}

module.exports = { computeWithinPhaseTrends };
