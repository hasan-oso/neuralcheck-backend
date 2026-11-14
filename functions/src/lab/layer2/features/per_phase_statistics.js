'use strict';

const { CH, PHASE } = require('../../layer1/utils/channels');
const {
  mean, std, variance, skewness, kurtosis, autocorrelation, percentile, iqr,
} = require('../utils/stats2');

// T4 — Per-phase statistical features.
//
// For each phase, compute textbook descriptive stats on key channels:
//   - cpu_freq_big: skewness, kurtosis (distribution shape)
//   - battery_current: variance (load consistency)
//   - thermal_headroom: range, IQR (thermal pressure spread; only plausible values)
//   - cpu_usage: lag-1 autocorrelation (smooth load vs jittery scheduler)
//
// Output is mostly descriptive — flagging is done by interpreting these per-phase
// numbers in context. We tag each phase's stats block with a coarse classification
// per channel for downstream consumption.

const PHASES_OF_INTEREST = [PHASE.CPU, PHASE.GPU, PHASE.COMBINED, PHASE.BURST, PHASE.COOLDOWN];
const PHASE_NAMES = { 0: 'INIT', 1: 'STORAGE', 2: 'MEMORY', 3: 'CPU', 4: 'GPU', 5: 'COMBINED', 6: 'BURST', 7: 'COOLDOWN' };

function classifySkewness(skew) {
  if (skew == null) return null;
  const a = Math.abs(skew);
  if (a < 0.5) return 'symmetric';
  if (a < 1.0) return 'moderate_skew';
  return 'high_skew';
}

function classifyKurtosis(kurt) {
  if (kurt == null) return null;
  // Excess kurtosis: 0 = normal, > 0 leptokurtic (heavy tails), < 0 platykurtic.
  if (kurt > 3) return 'heavy_tailed';
  if (kurt > 1) return 'somewhat_peaked';
  if (kurt < -1) return 'flat_distribution';
  return 'near_normal';
}

function classifyVariance(varVal, mean_) {
  if (varVal == null || mean_ == null || mean_ === 0) return null;
  const cv = Math.sqrt(varVal) / Math.abs(mean_); // coefficient of variation
  if (cv < 0.1) return 'very_consistent';
  if (cv < 0.3) return 'consistent';
  if (cv < 0.6) return 'variable';
  return 'highly_variable';
}

function classifyAutocorr(rho) {
  if (rho == null) return null;
  if (rho > 0.7) return 'smooth';
  if (rho > 0.3) return 'moderate_correlation';
  if (rho > -0.3) return 'low_correlation';
  return 'oscillatory';
}

function freqStats(samples) {
  const arr = samples.map((s) => s.v[CH.CPU_FREQ_BIG]).filter((v) => typeof v === 'number' && v > 0);
  if (arr.length < 4) return { n: arr.length, classification: 'INSUFFICIENT_DATA' };
  const m = mean(arr);
  const s = std(arr, m);
  const sk = skewness(arr);
  const ku = kurtosis(arr);
  return {
    channel: 'cpu_freq_big_kHz',
    n: arr.length,
    mean: Math.round(m),
    std: Math.round(s),
    skewness: Number(sk.toFixed(3)),
    kurtosis: Number(ku.toFixed(3)),
    skewness_classification: classifySkewness(sk),
    kurtosis_classification: classifyKurtosis(ku),
  };
}

function currentStats(samples) {
  const arr = samples
    .map((s) => s.v[CH.BATT_CURRENT])
    .filter((v) => typeof v === 'number' && Math.abs(v) <= 15_000_000);
  if (arr.length < 4) return { n: arr.length, classification: 'INSUFFICIENT_DATA' };
  // Work with absolute current in mA for interpretability.
  const mA = arr.map((v) => Math.abs(v) / 1000);
  const m = mean(mA);
  const v = variance(mA, m);
  return {
    channel: 'battery_current_abs_mA',
    n: mA.length,
    mean_mA: Number(m.toFixed(1)),
    variance_mA2: Number(v.toFixed(1)),
    cv: m > 0 ? Number((Math.sqrt(v) / m).toFixed(3)) : null,
    classification: classifyVariance(v, m),
  };
}

function headroomStats(samples) {
  const arr = samples
    .map((s) => s.v[CH.THERMAL_HEADROOM])
    .filter((v) => typeof v === 'number' && v >= 0 && v <= 2);
  if (arr.length < 4) return { n: arr.length, classification: 'INSUFFICIENT_DATA' };
  const lo = Math.min(...arr);
  const hi = Math.max(...arr);
  const range = hi - lo;
  const i = iqr(arr);
  return {
    channel: 'thermal_headroom_plausible',
    n: arr.length,
    min: Number(lo.toFixed(3)),
    max: Number(hi.toFixed(3)),
    range: Number(range.toFixed(3)),
    iqr: i == null ? null : Number(i.toFixed(3)),
    p50: Number(percentile(arr, 50).toFixed(3)),
  };
}

function usageStats(samples) {
  const arr = samples.map((s) => s.v[CH.CPU_USAGE]).filter((v) => typeof v === 'number');
  if (arr.length < 4) return { n: arr.length, classification: 'INSUFFICIENT_DATA' };
  const m = mean(arr);
  const s = std(arr, m);
  const r = autocorrelation(arr, 1);
  return {
    channel: 'cpu_usage_pct',
    n: arr.length,
    mean: Number(m.toFixed(2)),
    std: Number(s.toFixed(2)),
    autocorr_lag1: r == null ? null : Number(r.toFixed(3)),
    autocorr_classification: classifyAutocorr(r),
  };
}

function statsForPhase(samples, phase) {
  const inPhase = samples.filter((s) => s.phase === phase);
  if (inPhase.length === 0) {
    return { phase, name: PHASE_NAMES[phase], status: 'no_samples' };
  }
  return {
    phase,
    name: PHASE_NAMES[phase],
    n_samples: inPhase.length,
    cpu_freq_big: freqStats(inPhase),
    battery_current: currentStats(inPhase),
    thermal_headroom: headroomStats(inPhase),
    cpu_usage: usageStats(inPhase),
  };
}

function computePerPhaseStatistics(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'per_phase_descriptive_stats', reason: 'empty_samples' },
    };
  }
  const perPhase = PHASES_OF_INTEREST.map((p) => statsForPhase(samples, p));
  const phasesPopulated = perPhase.filter((p) => p.n_samples && p.n_samples > 0).length;

  return {
    value: { phases_populated: phasesPopulated },
    classification: phasesPopulated >= 3 ? 'computed' : 'INSUFFICIENT_DATA',
    confidence: phasesPopulated >= 3 ? 'high' : 'low',
    evidence: {
      method: 'per_phase_descriptive_stats',
      phases: perPhase,
    },
  };
}

module.exports = { computePerPhaseStatistics };
