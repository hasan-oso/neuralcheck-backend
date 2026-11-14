'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase } = require('../utils/extract');
const { mean } = require('../utils/stats');

const T_INF_WINDOW_MS = 5000;
const TAU_MIN = 5;
const TAU_MAX = 600;

function classifyTau(tau) {
  if (tau < 30) return { classification: 'excellent', confidence: 'high' };
  if (tau < 60) return { classification: 'healthy', confidence: 'high' };
  if (tau < 120) return { classification: 'marginal', confidence: 'medium' };
  if (tau < 240) return { classification: 'slow', confidence: 'medium' };
  return { classification: 'very_slow', confidence: 'high' };
}

function pickTempSource(phase7Samples) {
  const skinValues = phase7Samples
    .map((s) => s.v[CH.SKIN_TEMP])
    .filter((t) => typeof t === 'number' && t > 0);
  if (skinValues.length > 0) return 'skin';
  return 'battery';
}

function tempForSample(s, source) {
  return source === 'skin' ? s.v[CH.SKIN_TEMP] : s.v[CH.BATT_TEMP];
}

function computeCooldownTimeConstant(samples) {
  const phase7 = samplesInPhase(samples, PHASE.COOLDOWN);

  if (phase7.length < 30) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'exponential_fit_phase7',
        reason: 'fewer_than_30_phase7_samples',
        samples_used: phase7.length,
      },
    };
  }

  const temp_source = pickTempSource(phase7);

  const t0Sample = phase7[0];
  const T_0 = tempForSample(t0Sample, temp_source);
  if (typeof T_0 !== 'number' || !(T_0 > 0)) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'exponential_fit_phase7', reason: 'T_0_invalid', temp_source },
    };
  }

  const phase7End = phase7[phase7.length - 1].ts;
  const tInfWindow = phase7
    .filter((s) => phase7End - s.ts <= T_INF_WINDOW_MS)
    .map((s) => tempForSample(s, temp_source))
    .filter((t) => typeof t === 'number' && t > 0);
  if (tInfWindow.length === 0) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'exponential_fit_phase7', reason: 'no_valid_tail_temp', temp_source },
    };
  }
  const T_inf = mean(tInfWindow);

  if (T_0 - T_inf <= 1.0) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'exponential_fit_phase7',
        reason: 'cooling_amplitude_below_1C',
        T_0_C: Number(T_0.toFixed(1)),
        T_inf_C: Number(T_inf.toFixed(1)),
        temp_source,
        structural_limit: 'phase7_amplitude_below_threshold',
      },
    };
  }

  // Linearize: y = ln((T_i - T_inf) / (T_0 - T_inf)) = -t / tau
  // Least squares with intercept fixed at 0: slope = sum(t*y) / sum(t*t).
  let sum_ty = 0;
  let sum_tt = 0;
  let used = 0;
  const t0Ms = t0Sample.ts;

  for (let i = 0; i < phase7.length; i++) {
    const T_i = tempForSample(phase7[i], temp_source);
    if (typeof T_i !== 'number' || !(T_i > 0)) continue;
    const num = T_i - T_inf;
    if (num <= 0) continue;
    const ratio = num / (T_0 - T_inf);
    if (ratio <= 0) continue;
    const y = Math.log(ratio);
    const t = (phase7[i].ts - t0Ms) / 1000;
    sum_ty += t * y;
    sum_tt += t * t;
    used++;
  }

  if (used < 10 || sum_tt <= 0) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'exponential_fit_phase7',
        reason: 'fewer_than_10_usable_log_points',
        samples_used: used,
        temp_source,
      },
    };
  }

  const slope = sum_ty / sum_tt;
  const tau = -1 / slope;

  if (!Number.isFinite(tau) || tau < TAU_MIN || tau > TAU_MAX) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'exponential_fit_phase7',
        reason: 'tau_out_of_plausible_range',
        tau_sec: Number.isFinite(tau) ? Number(tau.toFixed(2)) : null,
        T_0_C: Number(T_0.toFixed(1)),
        T_inf_C: Number(T_inf.toFixed(1)),
        samples_used: used,
        temp_source,
      },
    };
  }

  const cls = classifyTau(tau);

  return {
    value: Number(tau.toFixed(2)),
    value_unit: 'sec',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'exponential_fit_phase7',
      T_0_C: Number(T_0.toFixed(1)),
      T_inf_C: Number(T_inf.toFixed(1)),
      samples_used: used,
      temp_source,
    },
  };
}

module.exports = { computeCooldownTimeConstant };
