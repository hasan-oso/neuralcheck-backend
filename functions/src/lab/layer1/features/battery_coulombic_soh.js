'use strict';

const { CH } = require('../utils/channels');
const { plausibleCurrentSamples } = require('../utils/extract');
const { mean } = require('../utils/stats');

function classifySoH(soh) {
  if (soh >= 90) return { classification: 'excellent', confidence: 'high' };
  if (soh >= 80) return { classification: 'good', confidence: 'high' };
  if (soh >= 70) return { classification: 'aging', confidence: 'medium' };
  if (soh >= 60) return { classification: 'degraded', confidence: 'medium' };
  return { classification: 'end_of_life', confidence: 'medium' };
}

function computeBatteryCoulombicSoH(samples, footer) {
  if (footer && footer.batteryHealth && typeof footer.batteryHealth.sohOfficialPercent === 'number') {
    const soh = footer.batteryHealth.sohOfficialPercent;
    const cls = classifySoH(soh);
    return {
      value: Number(soh.toFixed(1)),
      value_unit: '%',
      classification: cls.classification,
      confidence: 'high',
      evidence: {
        method: 'official_api',
        source: 'official_api',
        sohOfficialPercent: soh,
      },
    };
  }

  if (!Array.isArray(samples) || samples.length < 2) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'empty_or_too_few_samples',
        recommendation: 'extend_scan_or_use_official_api',
      },
    };
  }

  const designCapacityMah = footer && footer.batteryHealth && footer.batteryHealth.designCapacityMah;
  if (typeof designCapacityMah !== 'number' || !(designCapacityMah > 0)) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'designCapacityMah_missing',
        recommendation: 'extend_scan_or_use_official_api',
      },
    };
  }

  const headerStart = footer && typeof footer.batteryLevelStart === 'number'
    ? footer.batteryLevelStart
    : null;
  const footerEnd = footer && typeof footer.batteryLevelEnd === 'number' ? footer.batteryLevelEnd : null;

  const firstSampleLevel = samples[0] && samples[0].v && samples[0].v[CH.BATT_LEVEL];
  const lastSampleLevel = samples[samples.length - 1] && samples[samples.length - 1].v
    ? samples[samples.length - 1].v[CH.BATT_LEVEL]
    : null;

  const batteryLevelStart = headerStart !== null ? headerStart : firstSampleLevel;
  const batteryLevelEnd = footerEnd !== null ? footerEnd : lastSampleLevel;

  if (typeof batteryLevelStart !== 'number' || typeof batteryLevelEnd !== 'number') {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'battery_level_start_or_end_missing',
        batteryLevelStart,
        batteryLevelEnd,
        recommendation: 'extend_scan_or_use_official_api',
      },
    };
  }

  const deltaLevel = batteryLevelStart - batteryLevelEnd;

  if (deltaLevel < 5) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'delta_level_too_small',
        deltaLevel,
        batteryLevelStart,
        batteryLevelEnd,
        threshold: 5,
        recommendation: 'extend_scan_or_use_official_api',
        structural_limit: 'scan_duration_too_short_for_drain',
      },
    };
  }

  const duration_h = (samples[samples.length - 1].ts - samples[0].ts) / 3_600_000;
  if (!(duration_h > 0)) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'non_positive_duration',
        duration_h,
        recommendation: 'extend_scan_or_use_official_api',
      },
    };
  }

  const { kept, filtered: outliers_filtered } = plausibleCurrentSamples(samples);
  if (kept.length === 0) {
    return {
      value: null,
      value_unit: '%',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'coulomb_counting',
        reason: 'no_plausible_current_samples',
        outliers_filtered,
        recommendation: 'extend_scan_or_use_official_api',
      },
    };
  }

  const meanAbsCurrent_uA = mean(kept.map((s) => Math.abs(s.v[CH.BATT_CURRENT])));
  const meanCurrent_mA = meanAbsCurrent_uA / 1000;
  const observedCapacity_mAh = (meanCurrent_mA * duration_h) / (deltaLevel / 100);
  const SoH = (observedCapacity_mAh / designCapacityMah) * 100;

  const cls = classifySoH(SoH);
  // Per brief: confidence does not exceed medium for aging/degraded/end_of_life
  // (coulomb counting has ±10% field error). 'excellent' and 'good' keep high.

  return {
    value: Number(SoH.toFixed(1)),
    value_unit: '%',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'coulomb_counting',
      source: 'derived',
      deltaLevel,
      duration_h: Number(duration_h.toFixed(3)),
      meanCurrent_mA: Number(meanCurrent_mA.toFixed(1)),
      observedCapacity_mAh: Number(observedCapacity_mAh.toFixed(1)),
      designCapacityMah,
      outliers_filtered,
    },
  };
}

module.exports = { computeBatteryCoulombicSoH };
