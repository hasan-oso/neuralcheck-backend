'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase, firstSampleInPhase } = require('../utils/extract');
const { mean, max } = require('../utils/stats');

const AMBIENT_WINDOW_MS = 5000;

function classifyR(rThermal) {
  if (rThermal < 1.5) return { classification: 'excellent', confidence: 'high' };
  if (rThermal < 2.5) return { classification: 'healthy', confidence: 'high' };
  if (rThermal < 3.5) return { classification: 'marginal', confidence: 'medium' };
  if (rThermal < 5.0) return { classification: 'degraded', confidence: 'medium' };
  return { classification: 'severe_degradation', confidence: 'high' };
}

function computeThermalResistance(samples) {
  const phase0 = samplesInPhase(samples, PHASE.INIT);
  const phase5 = samplesInPhase(samples, PHASE.COMBINED);

  if (phase0.length === 0) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'dT_over_dP_in_combined_phase', reason: 'no_phase0_samples' },
    };
  }

  if (phase5.length < 20) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'dT_over_dP_in_combined_phase',
        reason: 'fewer_than_20_phase5_samples',
        phase5_samples: phase5.length,
      },
    };
  }

  const phase0Start = firstSampleInPhase(samples, PHASE.INIT);
  const ambientWindow = phase0.filter((s) => s.ts - phase0Start.ts <= AMBIENT_WINDOW_MS);
  const ambientTemps = ambientWindow
    .map((s) => s.v[CH.BATT_TEMP])
    .filter((t) => typeof t === 'number' && t > 0);

  if (ambientTemps.length === 0) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'dT_over_dP_in_combined_phase',
        reason: 'no_valid_battery_temp_in_phase0_window',
      },
    };
  }
  const ambient_C = mean(ambientTemps);

  // Skin temp source policy: prefer skin_temp_c values that are > 0; if no valid skin
  // readings exist in phase 5, fall back to battery_temp_c. Mixed (some valid, some -1)
  // is treated as "skin available" — we filter -1 and use the rest.
  const phase5SkinValid = phase5
    .map((s) => s.v[CH.SKIN_TEMP])
    .filter((t) => typeof t === 'number' && t > 0);

  let temp_source;
  let peak_temp_C;
  if (phase5SkinValid.length > 0) {
    temp_source = 'skin';
    peak_temp_C = max(phase5SkinValid);
  } else {
    temp_source = 'battery';
    const battTemps = phase5
      .map((s) => s.v[CH.BATT_TEMP])
      .filter((t) => typeof t === 'number' && t > 0);
    if (battTemps.length === 0) {
      return {
        value: null,
        value_unit: 'C/W',
        classification: 'INSUFFICIENT_DATA',
        confidence: 'low',
        evidence: {
          method: 'dT_over_dP_in_combined_phase',
          reason: 'no_valid_skin_or_battery_temp_in_phase5',
        },
      };
    }
    peak_temp_C = max(battTemps);
  }

  if (!(peak_temp_C > 0)) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'dT_over_dP_in_combined_phase',
        reason: 'non_positive_peak_temp',
        peak_temp_C,
      },
    };
  }

  const powers_mW = phase5
    .map((s) => s.v[CH.PACKAGE_POWER_MW])
    .filter((p) => typeof p === 'number' && p > 0);

  if (powers_mW.length === 0) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'dT_over_dP_in_combined_phase', reason: 'no_valid_power_samples_in_phase5' },
    };
  }

  const mean_power_W = mean(powers_mW) / 1000;

  if (mean_power_W < 2.0) {
    return {
      value: null,
      value_unit: 'C/W',
      classification: 'INSUFFICIENT_STRESS_DATA',
      confidence: 'low',
      evidence: {
        method: 'dT_over_dP_in_combined_phase',
        reason: 'mean_power_below_2W_indicates_under_stress',
        mean_power_W: Number(mean_power_W.toFixed(2)),
        peak_temp_C: Number(peak_temp_C.toFixed(1)),
        ambient_C: Number(ambient_C.toFixed(1)),
        temp_source,
      },
    };
  }

  const R_thermal = (peak_temp_C - ambient_C) / mean_power_W;
  const cls = classifyR(R_thermal);

  return {
    value: Number(R_thermal.toFixed(2)),
    value_unit: 'C/W',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'dT_over_dP_in_combined_phase',
      ambient_C: Number(ambient_C.toFixed(1)),
      peak_skin_C: Number(peak_temp_C.toFixed(1)),
      mean_power_W: Number(mean_power_W.toFixed(2)),
      temp_source,
      ambient_window_samples: ambientWindow.length,
      phase5_power_samples: powers_mW.length,
    },
  };
}

module.exports = { computeThermalResistance };
