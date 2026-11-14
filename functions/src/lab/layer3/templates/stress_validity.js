'use strict';

const { tr, fill } = require('../utils/i18n');

function renderStressValiditySection(scanData, layer1, lang) {
  const lines = [tr('hdr_stress_validity', lang), ''];

  const footer = scanData.timeSeries?.footer || scanData.footer || {};
  const stress = footer.stressEffectiveness || {};
  const passed = stress.passedSaturationThreshold === true;

  const passedToken = passed ? tr('passed_token', 'en') : tr('failed_token', 'en');
  const passedTokenAr = passed ? tr('passed_token', 'ar') : tr('failed_token', 'ar');

  lines.push(fill(tr('stress_validity', lang), {
    passed: passedToken,
    passed_ar: passedTokenAr,
    ratio: stress.phase3CpuFreqRatio != null ? stress.phase3CpuFreqRatio.toFixed(3) : '–',
    usage: stress.phase3CpuUsageAvg != null ? stress.phase3CpuUsageAvg.toFixed(1) : '–',
    powerPeak: stress.phase5PowerPeakMw ?? '–',
    reason: stress.saturationFailureReason || (passed ? '–' : 'unknown'),
  }));
  lines.push('');

  // Categorize failure mode
  if (passed) {
    lines.push(tr('stress_validity_passed', lang));
  } else {
    // Look at L1 throttling classifier to disambiguate governor vs workload.
    const tt = layer1 && layer1.features && layer1.features.performance && layer1.features.performance.throttlingType;
    const ttClass = tt && tt.classification;
    if (ttClass === 'oem_policy_aggressive' || ttClass === 'oem_policy_not_defect') {
      lines.push(tr('stress_validity_failed_governor', lang));
    } else {
      lines.push(tr('stress_validity_failed_workload', lang));
    }
  }

  return lines.join('\n');
}

module.exports = { renderStressValiditySection };
