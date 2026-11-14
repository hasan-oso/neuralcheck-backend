'use strict';

const { normalizeScanData } = require('../layer1');
const { computeZScoreOutliers } = require('./features/zscore_outliers');
const { computeCrossChannelCorrelation } = require('./features/cross_channel_correlation');
const { computeVoltageSpectral } = require('./features/voltage_spectral');
const { computePerPhaseStatistics } = require('./features/per_phase_statistics');
const { computeWithinPhaseTrends } = require('./features/within_phase_trends');

// Compute Layer 2 statistical features for a single scan. Reads scan data and
// (optionally) Layer 1 output. Self-contained per scan; no cross-scan baseline.
function computeLayer2Features(scanData, _layer1Output) {
  const norm = normalizeScanData(scanData);
  const samples = norm.timeSeries.samples;

  return {
    schemaVersion: 'layer2.v2',
    computedAt: new Date().toISOString(),
    features: {
      anomalies:    computeZScoreOutliers(samples),
      correlations: computeCrossChannelCorrelation(samples),
      spectral:     computeVoltageSpectral(samples),
      statistics:   computePerPhaseStatistics(samples),
      trends:       computeWithinPhaseTrends(samples),
    },
  };
}

module.exports = { computeLayer2Features };
