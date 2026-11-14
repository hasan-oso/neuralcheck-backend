'use strict';

const { CH, PHASE } = require('../../layer1/utils/channels');
const { resampleUniform, magnitudeSpectrum } = require('../utils/fft');

// T3 — Spectral analysis of battery voltage during phase 6 (BURST).
//
// Phase 6 design (per PROJECT_BRIEF §4): 5 × (6s peak + 3s idle) — a periodic
// 9-second load step. A healthy NMC cell tracks the load step cleanly, producing
// a dominant spectral component at the load period (1/9 ≈ 0.111 Hz). An aged
// or damaged cell shows broader spectral content (poorer charge transport,
// non-Markovian impedance memory) and higher entropy.
//
// References:
//  - Schmid et al., "On-line internal resistance measurement of lithium-ion cells",
//    J. Power Sources 396 (2018) — voltage transient methodology for SoH.
//  - Birkl et al., "Diagnosis and prognosis of degradation modes",
//    J. Power Sources 341 (2017) — frequency-domain signatures of NMC aging.
//
// We embed conservative thresholds rather than published exact values because
// the test workload (phone-side) differs from lab cell characterization.
// `confidence` capped at 'medium' for any non-INSUFFICIENT verdict.

const NMC_REFERENCE = {
  expected_dominant_freq_hz: { min: 0.08, max: 0.5 },     // healthy: load-step periodicity dominates
  expected_spectral_centroid_hz: { max: 1.0 },             // most energy below 1 Hz
  expected_spectral_entropy_normalized: { max: 0.55 },     // clean signal -> low entropy (in [0,1])
};

const RESAMPLE_LENGTH = 512;

// v63 Fix 5: 2D classification (dominant frequency × spectral entropy).
//
// Previously every "below load step" outcome was lumped under
// `dominant_freq_below_load_step` regardless of whether the rest of the
// spectrum was clean (likely test/workload mismatch) or noisy (likely
// genuine load-step failure or aging). Splitting on entropy disambiguates.
//
//                          domFreq < 0.08          0.08 ≤ domFreq ≤ 0.5      domFreq > 0.5
//                          (below load step)       (load step band)          (above)
//   entropy < 0.30         low_entropy_no_load_step  healthy_load_step_*      dominant_freq_above_load_step
//   0.30 ≤ entropy < 0.55  noisy_no_load_step        healthy_load_step_*      dominant_freq_above_load_step
//   entropy ≥ 0.55         noisy_no_load_step        noisy_load_step          high_frequency_content_anomaly
//   entropy ≥ 0.75         unstable_signal (any band; signal-level concern)
//
// Healthy reference (Schmid 2018 / Birkl 2017): NMC under a clean periodic
// load step shows dominant ≈ 0.111 Hz with entropy < 0.55. Aged cells
// broaden the spectrum (entropy ↑). A workload mismatch produces low
// dominant frequency with low entropy (no load-step signature but no noise
// either — signal is just smooth drift).
const ENTROPY_LOW = 0.30;        // below = clean / coherent
const ENTROPY_HIGH = 0.55;       // above = broadened / aged-likely
const ENTROPY_UNSTABLE = 0.75;   // above = unusable

function classify(domFreq, centroid, entropyNorm) {
  // Top-level concern: signal-level instability regardless of frequency band.
  if (entropyNorm >= ENTROPY_UNSTABLE) {
    return { classification: 'unstable_signal', confidence: 'low' };
  }

  const inLoadStepBand =
    domFreq >= NMC_REFERENCE.expected_dominant_freq_hz.min &&
    domFreq <= NMC_REFERENCE.expected_dominant_freq_hz.max;
  const aboveLoadStepBand = domFreq > NMC_REFERENCE.expected_dominant_freq_hz.max;
  const belowLoadStepBand = domFreq < NMC_REFERENCE.expected_dominant_freq_hz.min;

  if (aboveLoadStepBand) {
    if (entropyNorm >= ENTROPY_HIGH) {
      return { classification: 'high_frequency_content_anomaly', confidence: 'low' };
    }
    return { classification: 'dominant_freq_above_load_step', confidence: 'low' };
  }

  if (inLoadStepBand && centroid <= NMC_REFERENCE.expected_spectral_centroid_hz.max) {
    if (entropyNorm < ENTROPY_HIGH) {
      return { classification: 'healthy_load_step_signature', confidence: 'medium' };
    }
    return { classification: 'noisy_load_step', confidence: 'low' };
  }

  if (belowLoadStepBand) {
    if (entropyNorm < ENTROPY_LOW) {
      // Clean signal but no load-step signature — workload may not have produced
      // a coherent load step (test design mismatch with phase 6 9-second cycle)
      // OR battery responded smoothly without resonating at the expected period.
      return { classification: 'low_entropy_no_load_step', confidence: 'low' };
    }
    return { classification: 'noisy_no_load_step', confidence: 'low' };
  }

  return { classification: 'inconclusive', confidence: 'low' };
}

function findDominantFreq(magnitudes, freqsHz) {
  // Skip the DC bin (k=0) because we already removed mean before FFT.
  let bestK = 1;
  let bestMag = -Infinity;
  // Only inspect up to Nyquist; magnitudes already one-sided.
  for (let k = 1; k < magnitudes.length; k++) {
    if (magnitudes[k] > bestMag) {
      bestMag = magnitudes[k];
      bestK = k;
    }
  }
  return { freqHz: freqsHz[bestK], magnitude: bestMag, binIndex: bestK };
}

function spectralCentroid(magnitudes, freqsHz) {
  let num = 0, den = 0;
  // Skip DC bin.
  for (let k = 1; k < magnitudes.length; k++) {
    num += freqsHz[k] * magnitudes[k];
    den += magnitudes[k];
  }
  if (den === 0) return null;
  return num / den;
}

function spectralEntropyNormalized(magnitudes) {
  // Power spectrum, skip DC.
  const power = [];
  for (let k = 1; k < magnitudes.length; k++) power.push(magnitudes[k] * magnitudes[k]);
  let total = 0;
  for (const p of power) total += p;
  if (total === 0) return null;
  let H = 0;
  for (const p of power) {
    const pn = p / total;
    if (pn > 0) H -= pn * Math.log2(pn);
  }
  // Normalize to [0, 1] by dividing by max entropy log2(N).
  const maxH = Math.log2(power.length);
  if (maxH <= 0) return 0;
  return H / maxH;
}

function computeVoltageSpectral(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'fft_phase6_voltage', reason: 'empty_samples' },
    };
  }
  const phase6 = samples.filter((s) => s && s.phase === PHASE.BURST);
  const valid = phase6.filter((s) => s.v && typeof s.v[CH.BATT_VOLT] === 'number' && s.v[CH.BATT_VOLT] > 0);
  if (valid.length < 64) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'fft_phase6_voltage',
        reason: 'fewer_than_64_valid_phase6_voltage_samples',
        valid_count: valid.length,
      },
    };
  }

  const t = valid.map((s) => s.ts);
  const v = valid.map((s) => s.v[CH.BATT_VOLT]);
  const totalDurationSec = (t[t.length - 1] - t[0]) / 1000;

  if (totalDurationSec < 20) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'fft_phase6_voltage',
        reason: 'phase6_too_short_for_spectral_analysis',
        duration_s: Number(totalDurationSec.toFixed(1)),
      },
    };
  }

  let resampled;
  try {
    resampled = resampleUniform(t, v, RESAMPLE_LENGTH);
  } catch (e) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'fft_phase6_voltage', reason: 'resample_failed', error: e.message },
    };
  }

  const sampleRateHz = 1000 / resampled.dt; // dt is in ms (since ts in ms)
  const spec = magnitudeSpectrum(resampled.values, sampleRateHz, { applyHann: true, removeDC: true });

  const dom = findDominantFreq(spec.magnitudes, spec.freqsHz);
  const centroid = spectralCentroid(spec.magnitudes, spec.freqsHz);
  const entropyNorm = spectralEntropyNormalized(spec.magnitudes);

  if (dom.freqHz == null || centroid == null || entropyNorm == null) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'fft_phase6_voltage',
        reason: 'spectral_metrics_undefined',
      },
    };
  }

  const cls = classify(dom.freqHz, centroid, entropyNorm);

  return {
    value: {
      dominant_freq_hz: Number(dom.freqHz.toFixed(4)),
      spectral_centroid_hz: Number(centroid.toFixed(4)),
      spectral_entropy_normalized: Number(entropyNorm.toFixed(3)),
    },
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'fft_phase6_voltage',
      n_input_samples: valid.length,
      n_resampled: RESAMPLE_LENGTH,
      sample_rate_hz: Number(sampleRateHz.toFixed(2)),
      duration_s: Number(totalDurationSec.toFixed(1)),
      reference: 'NMC voltage-step signature; healthy load-step ~0.111 Hz',
      reference_thresholds: NMC_REFERENCE,
      window: 'hann',
    },
  };
}

module.exports = { computeVoltageSpectral };
