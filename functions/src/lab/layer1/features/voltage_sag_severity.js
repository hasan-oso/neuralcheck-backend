'use strict';

const { CH, PHASE } = require('../utils/channels');
const { samplesInPhase, channelValues } = require('../utils/extract');
const { min, max } = require('../utils/stats');

function classifySag(dropPct) {
  if (dropPct < 3) return { classification: 'minimal', confidence: 'high' };
  if (dropPct < 6) return { classification: 'moderate', confidence: 'high' };
  if (dropPct < 10) return { classification: 'high', confidence: 'medium' };
  return { classification: 'severe', confidence: 'high' };
}

function computeVoltageSagSeverity(samples) {
  const phase6 = samplesInPhase(samples, PHASE.BURST);
  const voltages = channelValues(phase6, CH.BATT_VOLT).filter((v) => v > 0);

  if (voltages.length < 10) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'phase6_voltage_min_max',
        reason: 'fewer_than_10_valid_voltage_readings',
        valid_voltage_samples: voltages.length,
      },
    };
  }

  const V_max = max(voltages);
  const V_min = min(voltages);
  const drop_mV = V_max - V_min;
  const drop_pct = (drop_mV / V_max) * 100;

  const cls = classifySag(drop_pct);

  return {
    value: Number(drop_pct.toFixed(2)),
    value_unit: '%',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'phase6_voltage_min_max',
      V_max_mV: Number(V_max.toFixed(1)),
      V_min_mV: Number(V_min.toFixed(1)),
      max_drop_mV: Number(drop_mV.toFixed(1)),
      drop_pct: Number(drop_pct.toFixed(2)),
      samples_used: voltages.length,
    },
  };
}

module.exports = { computeVoltageSagSeverity };
