'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase, channelValues } = require('../utils/extract');
const { mean } = require('../utils/stats');

function classifyDrop(dropPct) {
  if (dropPct < 10) return { classification: 'excellent_cooling', confidence: 'high' };
  if (dropPct < 25) return { classification: 'normal', confidence: 'high' };
  if (dropPct < 40) return { classification: 'weak_cooling', confidence: 'medium' };
  return { classification: 'cooling_defect', confidence: 'high' };
}

function computePerformanceDrop(samples) {
  const p3 = samplesInPhase(samples, PHASE.CPU);
  const p5 = samplesInPhase(samples, PHASE.COMBINED);
  const freqs_p3 = channelValues(p3, CH.CPU_FREQ_BIG).filter((v) => v > 0);
  const freqs_p5 = channelValues(p5, CH.CPU_FREQ_BIG).filter((v) => v > 0);

  if (freqs_p3.length < 10 || freqs_p5.length < 10) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'big_cluster_freq_p3_vs_p5',
        reason: 'fewer_than_10_valid_freq_samples_in_phase3_or_phase5',
        samples_p3: freqs_p3.length,
        samples_p5: freqs_p5.length,
      },
    };
  }

  const freq_p3 = mean(freqs_p3);
  const freq_p5 = mean(freqs_p5);

  if (!(freq_p3 > 0) || !(freq_p5 > 0)) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'big_cluster_freq_p3_vs_p5',
        reason: 'non_positive_mean_frequency',
        freq_p3_kHz: freq_p3,
        freq_p5_kHz: freq_p5,
      },
    };
  }

  const drop_pct = ((freq_p3 - freq_p5) / freq_p3) * 100;

  let cls;
  if (drop_pct < 0) {
    cls = { classification: 'excellent_cooling', confidence: 'high' };
  } else {
    cls = classifyDrop(drop_pct);
  }

  return {
    value: Number(drop_pct.toFixed(2)),
    value_unit: '%',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'big_cluster_freq_p3_vs_p5',
      freq_p3_kHz: Math.round(freq_p3),
      freq_p5_kHz: Math.round(freq_p5),
      samples_p3: freqs_p3.length,
      samples_p5: freqs_p5.length,
    },
  };
}

module.exports = { computePerformanceDrop };
