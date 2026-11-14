'use strict';

const { CH } = require('../utils/channels');
const { isPhysicallyPlausibleCurrent_uA } = require('../utils/extract');
const { mean, std, min, max } = require('../utils/stats');

const IDLE_CURRENT_THRESHOLD_uA = 100_000; // 100 mA absolute
const IDLE_RUN_MIN_LENGTH = 4; // candidate + 3 other neighbors agreeing

// NMC reference curve (level_pct -> expected_voltage_mV), piecewise linear.
const NMC_REFERENCE = [
  { level: 0, mv: 3300 },
  { level: 10, mv: 3600 },
  { level: 20, mv: 3680 },
  { level: 30, mv: 3730 },
  { level: 40, mv: 3780 },
  { level: 50, mv: 3830 },
  { level: 60, mv: 3900 },
  { level: 70, mv: 3970 },
  { level: 80, mv: 4030 },
  { level: 90, mv: 4100 },
  { level: 100, mv: 4200 },
];

function nmcExpected_mV(levelPct) {
  let lv = levelPct;
  if (lv < 0) lv = 0;
  if (lv > 100) lv = 100;
  for (let i = 0; i < NMC_REFERENCE.length - 1; i++) {
    const a = NMC_REFERENCE[i];
    const b = NMC_REFERENCE[i + 1];
    if (lv >= a.level && lv <= b.level) {
      const frac = (lv - a.level) / (b.level - a.level);
      return a.mv + frac * (b.mv - a.mv);
    }
  }
  return NMC_REFERENCE[NMC_REFERENCE.length - 1].mv;
}

// Idle points are samples within a run of >=IDLE_RUN_MIN_LENGTH consecutive samples
// where |I| < threshold (and the current value is physically plausible).
function findIdleSamples(samples) {
  const flags = new Array(samples.length).fill(false);
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] && samples[i].v;
    if (!v) continue;
    const I = v[CH.BATT_CURRENT];
    if (!isPhysicallyPlausibleCurrent_uA(I)) continue;
    if (Math.abs(I) < IDLE_CURRENT_THRESHOLD_uA) flags[i] = true;
  }

  const idle = [];
  let runStart = -1;
  for (let i = 0; i <= samples.length; i++) {
    const isIdle = i < samples.length && flags[i];
    if (isIdle) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const runLen = i - runStart;
        if (runLen >= IDLE_RUN_MIN_LENGTH) {
          for (let j = runStart; j < i; j++) idle.push(samples[j]);
        }
        runStart = -1;
      }
    }
  }
  return idle;
}

function classify(absMean, stdDev) {
  if (stdDev >= 80) return { classification: 'unstable_readings', confidence: 'low' };
  if (absMean >= 100) return { classification: 'unusual_chemistry_or_aged', confidence: 'low' };
  if (absMean >= 50 && stdDev < 50) return { classification: 'slight_deviation', confidence: 'low' };
  if (absMean < 50 && stdDev < 30) return { classification: 'consistent_with_nmc', confidence: 'medium' };
  return { classification: 'inconclusive', confidence: 'low' };
}

function computeOCVSignature(samples, _footer) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      value_unit: 'mV',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'ocv_curve_deviation_from_nmc_reference', reason: 'empty_samples' },
    };
  }

  const idle = findIdleSamples(samples);

  if (idle.length < 10) {
    return {
      value: null,
      value_unit: 'mV',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'ocv_curve_deviation_from_nmc_reference',
        reason: 'no_stable_idle',
        idle_points_count: idle.length,
        threshold_uA: IDLE_CURRENT_THRESHOLD_uA,
        run_min_length: IDLE_RUN_MIN_LENGTH,
        structural_limit: 'screen_on_baseline_above_idle_threshold',
      },
    };
  }

  const deviations = [];
  const levels = [];
  for (let i = 0; i < idle.length; i++) {
    const v = idle[i].v;
    const lvl = v[CH.BATT_LEVEL];
    const obs = v[CH.BATT_VOLT];
    if (typeof lvl !== 'number' || typeof obs !== 'number' || obs <= 0) continue;
    const expected = nmcExpected_mV(lvl);
    deviations.push(obs - expected);
    levels.push(lvl);
  }

  if (deviations.length < 10) {
    return {
      value: null,
      value_unit: 'mV',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'ocv_curve_deviation_from_nmc_reference',
        reason: 'fewer_than_10_paired_idle_voltage_level_samples',
        idle_points_count: idle.length,
        paired_count: deviations.length,
      },
    };
  }

  const mean_deviation_mV = mean(deviations);
  const std_deviation_mV = std(deviations);
  const absMean = Math.abs(mean_deviation_mV);
  const cls = classify(absMean, std_deviation_mV);

  return {
    value: Number(mean_deviation_mV.toFixed(1)),
    value_unit: 'mV',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'ocv_curve_deviation_from_nmc_reference',
      idle_points_count: deviations.length,
      mean_deviation_mV: Number(mean_deviation_mV.toFixed(1)),
      std_deviation_mV: Number(std_deviation_mV.toFixed(1)),
      level_range_min_pct: min(levels),
      level_range_max_pct: max(levels),
      idle_run_min_length: IDLE_RUN_MIN_LENGTH,
    },
  };
}

module.exports = { computeOCVSignature };
