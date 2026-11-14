'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase, plausibleCurrentSamples } = require('../utils/extract');
const { mean, percentile } = require('../utils/stats');

const R_BOUNDARIES_MOHM = [120, 200, 350];

function classifyR(rmOhm) {
  if (rmOhm < 120) return { classification: 'healthy', confidence: 'high' };
  if (rmOhm < 200) return { classification: 'aging', confidence: 'medium' };
  if (rmOhm < 350) return { classification: 'degraded', confidence: 'medium' };
  return { classification: 'end_of_life', confidence: 'high' };
}

// Field error on R_int from voltage sag is ±20-30%, and we have no per-model
// calibration baseline. Cap confidence based on proximity to nearest band
// boundary so a measurement sitting near a threshold doesn't masquerade as
// a confident grade.
function capConfidenceByBoundary(rmOhm, currentConfidence) {
  let minDistancePct = Infinity;
  for (const b of R_BOUNDARIES_MOHM) {
    const d = Math.abs(rmOhm - b) / b * 100;
    if (d < minDistancePct) minDistancePct = d;
  }
  let cappedConfidence = currentConfidence;
  let confidence_capped = false;
  if (minDistancePct <= 20) {
    // Within ±20% of a band boundary — uncertainty exceeds field error budget.
    if (currentConfidence !== 'low') {
      cappedConfidence = 'low';
      confidence_capped = true;
    }
  }
  return {
    confidence: cappedConfidence,
    confidence_capped,
    boundary_proximity_pct: Number(minDistancePct.toFixed(1)),
  };
}

function computeBatteryInternalResistance(samples) {
  const phase6Raw = samplesInPhase(samples, PHASE.BURST);
  const { kept: phase6, filtered: outliers_filtered } = plausibleCurrentSamples(phase6Raw);

  if (phase6.length < 30) {
    return {
      value: null,
      value_unit: 'mOhm',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'voltage_sag_in_burst_phase',
        reason: 'fewer_than_30_plausible_burst_samples',
        burst_samples: phase6.length,
        outliers_filtered,
      },
    };
  }

  const absI = phase6.map((s) => Math.abs(s.v[CH.BATT_CURRENT]));
  const p25 = percentile(absI, 25);
  const p75 = percentile(absI, 75);

  const idleSamples = [];
  const peakSamples = [];
  for (let i = 0; i < phase6.length; i++) {
    const a = absI[i];
    if (a <= p25) idleSamples.push(phase6[i]);
    if (a >= p75) peakSamples.push(phase6[i]);
  }

  if (idleSamples.length < 5 || peakSamples.length < 5) {
    return {
      value: null,
      value_unit: 'mOhm',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'voltage_sag_in_burst_phase',
        reason: 'fewer_than_5_idle_or_peak_samples',
        idleSamples: idleSamples.length,
        peakSamples: peakSamples.length,
        outliers_filtered,
      },
    };
  }

  const V_idle = mean(idleSamples.map((s) => s.v[CH.BATT_VOLT]));
  const V_peak = mean(peakSamples.map((s) => s.v[CH.BATT_VOLT]));
  const I_idle_uA = mean(idleSamples.map((s) => Math.abs(s.v[CH.BATT_CURRENT])));
  const I_peak_uA = mean(peakSamples.map((s) => Math.abs(s.v[CH.BATT_CURRENT])));

  const I_idle_mA = I_idle_uA / 1000;
  const I_peak_mA = I_peak_uA / 1000;
  const deltaV_mV = V_idle - V_peak;
  const deltaI_mA = I_peak_mA - I_idle_mA;

  if (deltaI_mA < 100) {
    return {
      value: null,
      value_unit: 'mOhm',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'voltage_sag_in_burst_phase',
        reason: 'current_step_too_small',
        deltaI_mA: Number(deltaI_mA.toFixed(1)),
        I_idle_mA: Number(I_idle_mA.toFixed(1)),
        I_peak_mA: Number(I_peak_mA.toFixed(1)),
        outliers_filtered,
      },
    };
  }

  // v63 Fix 1: minimum voltage-response gate.
  // Phone battery voltage sensors typically resolve at 1–2 mV. A deltaV near
  // that resolution is indistinguishable from sensor noise — the resulting
  // R_mOhm is mechanically computable but meaningless. Reject below 5 mV
  // (5× the typical noise floor); a real impedance measurement on a phone
  // burst-phase current step ≥100 mA produces ≥5 mV sag on any non-trivial
  // battery (R = 5 mV / 100 mA = 50 mΩ minimum-detectable impedance).
  const MIN_DELTA_V_MV = 5;
  if (deltaV_mV < MIN_DELTA_V_MV) {
    return {
      value: null,
      value_unit: 'mOhm',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'voltage_sag_in_burst_phase',
        reason: 'voltage_sag_below_noise_floor',
        deltaV_mV: Number(deltaV_mV.toFixed(2)),
        threshold_mV: MIN_DELTA_V_MV,
        deltaI_mA: Number(deltaI_mA.toFixed(1)),
        I_idle_mA: Number(I_idle_mA.toFixed(1)),
        I_peak_mA: Number(I_peak_mA.toFixed(1)),
        V_idle_mV: Number(V_idle.toFixed(1)),
        V_peak_mV: Number(V_peak.toFixed(1)),
        outliers_filtered,
        structural_limit: 'load_did_not_draw_enough_current_to_measure_impedance',
      },
    };
  }

  const R_mOhm = (deltaV_mV / deltaI_mA) * 1000;

  if (R_mOhm < 0) {
    return {
      value: null,
      value_unit: 'mOhm',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'voltage_sag_in_burst_phase',
        reason: 'negative_resistance',
        R_mOhm: Number(R_mOhm.toFixed(1)),
        deltaV_mV: Number(deltaV_mV.toFixed(1)),
        deltaI_mA: Number(deltaI_mA.toFixed(1)),
        outliers_filtered,
      },
    };
  }

  const cls = classifyR(R_mOhm);
  const cap = capConfidenceByBoundary(R_mOhm, cls.confidence);

  return {
    value: Number(R_mOhm.toFixed(1)),
    value_unit: 'mOhm',
    classification: cls.classification,
    confidence: cap.confidence,
    evidence: {
      method: 'voltage_sag_in_burst_phase',
      V_idle_mV: Number(V_idle.toFixed(1)),
      V_peak_mV: Number(V_peak.toFixed(1)),
      deltaV_mV: Number(deltaV_mV.toFixed(1)),
      I_idle_mA: Number(I_idle_mA.toFixed(1)),
      I_peak_mA: Number(I_peak_mA.toFixed(1)),
      deltaI_mA: Number(deltaI_mA.toFixed(1)),
      idleSamples: idleSamples.length,
      peakSamples: peakSamples.length,
      outliers_filtered,
      boundary_proximity_pct: cap.boundary_proximity_pct,
      confidence_capped: cap.confidence_capped,
      confidence_band_unconstrained: cls.confidence,
    },
  };
}

module.exports = { computeBatteryInternalResistance };
