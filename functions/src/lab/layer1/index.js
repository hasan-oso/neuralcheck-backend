'use strict';

const { computeBatteryInternalResistance } = require('./features/battery_internal_resistance');
const { computeVoltageSagSeverity } = require('./features/voltage_sag_severity');
const { computeBatteryCoulombicSoH } = require('./features/battery_coulombic_soh');
const { computeOCVSignature } = require('./features/ocv_signature');
const { computeThermalResistance } = require('./features/thermal_resistance');
const { computeTimeToThrottle } = require('./features/time_to_throttle');
const { computeCooldownTimeConstant } = require('./features/cooldown_time_constant');
const { computePerformanceStabilityIndex } = require('./features/performance_stability_index');
const { computePerformanceDrop } = require('./features/performance_drop_p3_to_p5');
const { classifyThrottling } = require('./features/throttling_classifier');

// Accepts both shapes:
//   Storage shape (.ts.json export): { samples, footer, header, variables }
//   Firestore shape: { rawFingerprint: { device, functionalResults, manualResults }, timeSeries: { samples, footer, header, variables } }
// Returns a normalized envelope with timeSeries always populated.
function normalizeScanData(input) {
  if (!input || typeof input !== 'object') {
    return {
      device: {},
      functionalResults: [],
      manualResults: [],
      timeSeries: { samples: [], footer: {}, header: {}, variables: [] },
    };
  }

  if (input.timeSeries && typeof input.timeSeries === 'object') {
    const rfp = input.rawFingerprint || {};
    return {
      device: rfp.device || {},
      functionalResults: rfp.functionalResults || [],
      manualResults: rfp.manualResults || [],
      timeSeries: {
        samples: input.timeSeries.samples || [],
        footer: input.timeSeries.footer || {},
        header: input.timeSeries.header || {},
        variables: input.timeSeries.variables || [],
      },
    };
  }

  return {
    device: {},
    functionalResults: [],
    manualResults: [],
    timeSeries: {
      samples: input.samples || [],
      footer: input.footer || {},
      header: input.header || {},
      variables: input.variables || [],
    },
  };
}

function computeAllFeatures(scanData) {
  const norm = normalizeScanData(scanData);
  const samples = norm.timeSeries.samples;
  const footer = norm.timeSeries.footer;

  return {
    schemaVersion: 'layer1.v2',
    computedAt: new Date().toISOString(),
    features: {
      battery: {
        internalResistance: computeBatteryInternalResistance(samples),
        voltageSagSeverity: computeVoltageSagSeverity(samples),
        coulombicSoH: computeBatteryCoulombicSoH(samples, footer),
        ocvSignature: computeOCVSignature(samples, footer),
      },
      thermal: {
        thermalResistance: computeThermalResistance(samples),
        timeToThrottle: computeTimeToThrottle(samples, footer),
        cooldownTimeConstant: computeCooldownTimeConstant(samples),
      },
      performance: {
        stabilityIndex: computePerformanceStabilityIndex(samples),
        dropP3toP5: computePerformanceDrop(samples),
        throttlingType: classifyThrottling(samples, footer),
      },
    },
  };
}

module.exports = { computeAllFeatures, normalizeScanData };
