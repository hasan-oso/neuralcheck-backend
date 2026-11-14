'use strict';

const { CH } = require('../../layer1/utils/channels');
const { mean, std } = require('../utils/stats2');

// T1 — Within-scan Z-score outlier detection.
// For each tracked channel, compute mean and std across the whole scan and flag
// any sample more than `sigmaThreshold` standard deviations away. Surface count,
// timing, and a few worst-offender samples.
//
// NOTE: a whole-scan Z-score will naturally tag samples at phase boundaries as
// outliers because channel ranges differ across phases. That is BY DESIGN —
// transition points are diagnostically interesting. The interesting case is
// whether outliers cluster within a single phase (real anomaly) or sit on
// boundaries (multimodal data, expected). We surface both signals.

const SIGMA_THRESHOLD = 3;

const TRACKED_CHANNELS = [
  { key: 'battery_voltage_mV', idx: CH.BATT_VOLT, sentinelTest: (v) => v > 0 },
  { key: 'battery_current_uA', idx: CH.BATT_CURRENT, sentinelTest: (v) => Number.isFinite(v) && Math.abs(v) <= 15_000_000 },
  { key: 'package_power_mW',   idx: CH.PACKAGE_POWER_MW, sentinelTest: (v) => v > 0 },
];

function classifyByCount(totalOutliers, withinPhaseClusterMax, totalSamplesValid) {
  if (totalSamplesValid === 0) return { classification: 'INSUFFICIENT_DATA', confidence: 'low' };
  const ratio = totalOutliers / totalSamplesValid;
  // A clean scan should have <0.3% outliers with most concentrated at phase boundaries.
  if (ratio < 0.003 && withinPhaseClusterMax < 3) return { classification: 'clean', confidence: 'high' };
  if (ratio < 0.01 && withinPhaseClusterMax < 5) return { classification: 'expected_boundary_artifacts', confidence: 'high' };
  if (ratio < 0.03) return { classification: 'mild_anomalies', confidence: 'medium' };
  return { classification: 'significant_anomalies', confidence: 'medium' };
}

function analyzeChannel(samples, ch) {
  const valid = [];
  const validIdx = [];
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] && samples[i].v && samples[i].v[ch.idx];
    if (typeof v === 'number' && ch.sentinelTest(v)) {
      valid.push(v);
      validIdx.push(i);
    }
  }
  if (valid.length < 10) {
    return {
      channel: ch.key,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      reason: 'fewer_than_10_valid_samples',
      valid_count: valid.length,
    };
  }
  const m = mean(valid);
  const s = std(valid, m);
  if (!(s > 0)) {
    return {
      channel: ch.key,
      classification: 'flat_signal',
      confidence: 'high',
      reason: 'zero_std',
      mean: Number(m.toFixed(2)),
      valid_count: valid.length,
      outlier_count: 0,
    };
  }

  const outliers = [];
  const perPhaseCount = {};
  for (let i = 0; i < valid.length; i++) {
    const z = (valid[i] - m) / s;
    if (Math.abs(z) > SIGMA_THRESHOLD) {
      const sample = samples[validIdx[i]];
      outliers.push({
        sampleIndex: validIdx[i],
        ts: sample.ts,
        phase: sample.phase,
        value: valid[i],
        z: Number(z.toFixed(2)),
      });
      perPhaseCount[sample.phase] = (perPhaseCount[sample.phase] || 0) + 1;
    }
  }

  // Boundary-aware: are outliers concentrated at one phase, or spread across boundaries?
  let withinPhaseClusterMax = 0;
  for (const p in perPhaseCount) {
    if (perPhaseCount[p] > withinPhaseClusterMax) withinPhaseClusterMax = perPhaseCount[p];
  }
  outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const worst = outliers.slice(0, 5);

  const cls = classifyByCount(outliers.length, withinPhaseClusterMax, valid.length);

  return {
    channel: ch.key,
    classification: cls.classification,
    confidence: cls.confidence,
    mean: Number(m.toFixed(2)),
    std: Number(s.toFixed(2)),
    valid_count: valid.length,
    outlier_count: outliers.length,
    outlier_ratio_pct: Number((outliers.length / valid.length * 100).toFixed(3)),
    outliers_per_phase: perPhaseCount,
    within_phase_cluster_max: withinPhaseClusterMax,
    worst_offenders: worst,
  };
}

function computeZScoreOutliers(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'within_scan_zscore', reason: 'empty_samples' },
    };
  }

  const perChannel = TRACKED_CHANNELS.map((ch) => analyzeChannel(samples, ch));

  // Aggregate classification: worst across channels.
  const order = { INSUFFICIENT_DATA: 0, clean: 1, expected_boundary_artifacts: 2, flat_signal: 2, mild_anomalies: 3, significant_anomalies: 4 };
  let worst = perChannel[0];
  for (const c of perChannel) {
    if ((order[c.classification] || 0) > (order[worst.classification] || 0)) worst = c;
  }

  return {
    value: {
      total_outliers: perChannel.reduce((a, c) => a + (c.outlier_count || 0), 0),
      worst_channel: worst.channel,
      worst_classification: worst.classification,
    },
    classification: worst.classification,
    confidence: worst.confidence,
    evidence: {
      method: 'within_scan_zscore',
      sigma_threshold: SIGMA_THRESHOLD,
      per_channel: perChannel,
    },
  };
}

module.exports = { computeZScoreOutliers };
