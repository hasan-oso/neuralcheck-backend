'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase, channelValues } = require('../utils/extract');
const { mean, std } = require('../utils/stats');

function classifyPSI(psiPct) {
  if (psiPct < 5) return { classification: 'very_stable', confidence: 'high' };
  if (psiPct < 15) return { classification: 'normal', confidence: 'high' };
  if (psiPct < 25) return { classification: 'unstable', confidence: 'medium' };
  return { classification: 'very_unstable', confidence: 'high' };
}

function computePerformanceStabilityIndex(samples) {
  const phase3 = samplesInPhase(samples, PHASE.CPU);
  const freqs = channelValues(phase3, CH.CPU_FREQ_BIG).filter((v) => v > 0);

  if (freqs.length < 30) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'std_over_mean_phase3_big_freq',
        reason: 'fewer_than_30_valid_freq_samples_in_phase3',
        samples_used: freqs.length,
      },
    };
  }

  const meanFreq = mean(freqs);
  const stdFreq = std(freqs);

  if (!(meanFreq > 0)) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'std_over_mean_phase3_big_freq',
        reason: 'non_positive_mean_frequency',
        meanFreq_kHz: meanFreq,
      },
    };
  }

  const psi_pct = (stdFreq / meanFreq) * 100;
  const cls = classifyPSI(psi_pct);

  return {
    value: Number(psi_pct.toFixed(2)),
    value_unit: '%',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'std_over_mean_phase3_big_freq',
      meanFreq_kHz: Math.round(meanFreq),
      stdFreq_kHz: Math.round(stdFreq),
      samples_used: freqs.length,
    },
  };
}

module.exports = { computePerformanceStabilityIndex };
