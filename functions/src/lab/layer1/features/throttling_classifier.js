'use strict';

const TYPE_TO_CLASSIFICATION = {
  none_well_cooled: { classification: 'optimal', confidence: 'high' },
  none_thermal_pressure_within_design: { classification: 'normal', confidence: 'high' },
  governor_capping: { classification: 'oem_policy_not_defect', confidence: 'high' },
  governor_capping_severe: { classification: 'oem_policy_aggressive', confidence: 'high' },
  thermal_throttling_normal: { classification: 'expected_under_load', confidence: 'high' },
  thermal_throttling_aggressive: { classification: 'cooling_concern', confidence: 'medium' },
  mixed_signals: { classification: 'inconclusive', confidence: 'low' },
};

function decideType(ratio, headroom, status) {
  if (ratio >= 0.85 && headroom < 0.5 && status <= 1) return 'none_well_cooled';
  if (ratio >= 0.85 && headroom >= 0.7 && status >= 2) return 'none_thermal_pressure_within_design';
  if (ratio >= 0.6 && ratio < 0.85 && headroom < 0.3 && status === 0) return 'governor_capping';
  if (ratio >= 0.6 && ratio < 0.85 && headroom >= 0.7 && status >= 2) return 'thermal_throttling_normal';
  if (ratio < 0.6 && headroom < 0.3 && status === 0) return 'governor_capping_severe';
  if (ratio < 0.6 && headroom >= 0.7 && status >= 2) return 'thermal_throttling_aggressive';
  return 'mixed_signals';
}

function classifyThrottling(_samples, footer) {
  if (!footer || !footer.stressEffectiveness) {
    return {
      value: null,
      value_unit: 'type',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'rule_based_decision_table', reason: 'footer_or_stressEffectiveness_missing' },
    };
  }

  const ratio = footer.stressEffectiveness.phase3CpuFreqRatio;
  const headroom = footer.thermalHeadroomPeak;
  const status = footer.thermalStatusMax;
  const saturationFailureReason = footer.stressEffectiveness.saturationFailureReason;

  if (typeof ratio !== 'number' || typeof headroom !== 'number') {
    return {
      value: null,
      value_unit: 'type',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'rule_based_decision_table',
        reason: 'phase3CpuFreqRatio_or_thermalHeadroomPeak_missing',
        phase3CpuFreqRatio: ratio,
        thermalHeadroomPeak: headroom,
      },
    };
  }

  const statusVal = typeof status === 'number' ? status : 0;
  const type = decideType(ratio, headroom, statusVal);
  const meta = TYPE_TO_CLASSIFICATION[type];

  return {
    value: type,
    value_unit: 'type',
    classification: meta.classification,
    confidence: meta.confidence,
    evidence: {
      method: 'rule_based_decision_table',
      type,
      phase3CpuFreqRatio: Number(ratio.toFixed(3)),
      thermalHeadroomPeak: Number(headroom.toFixed(3)),
      thermalStatusMax: statusVal,
      saturationFailureReason: saturationFailureReason ?? null,
    },
  };
}

module.exports = { classifyThrottling };
