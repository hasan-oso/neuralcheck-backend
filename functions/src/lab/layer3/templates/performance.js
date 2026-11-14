'use strict';

const { tr, fill, withTranslations } = require('../utils/i18n');

function renderPerformanceSection(layer1, layer2, lang) {
  const lines = [tr('hdr_performance', lang), ''];

  const p = (layer1 && layer1.features && layer1.features.performance) || {};

  // 1) PSI
  if (p.stabilityIndex) {
    const psi = p.stabilityIndex;
    const ev = psi.evidence || {};
    if (psi.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('perf_psi', lang), withTranslations({
        value: psi.value,
        samples_used: ev.samples_used,
        meanFreq_kHz: ev.meanFreq_kHz,
        stdFreq_kHz: ev.stdFreq_kHz,
        classification: psi.classification,
      }, lang)));
    }
  }

  // 2) Drop p3 → p5
  if (p.dropP3toP5) {
    const d = p.dropP3toP5;
    const ev = d.evidence || {};
    if (d.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('perf_drop', lang), withTranslations({
        value: d.value,
        freq_p3_kHz: ev.freq_p3_kHz,
        freq_p5_kHz: ev.freq_p5_kHz,
        classification: d.classification,
      }, lang)));
    }
  }

  // 3) Throttling classifier
  if (p.throttlingType) {
    const t = p.throttlingType;
    const ev = t.evidence || {};
    if (t.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('perf_throttling', lang), withTranslations({
        value: t.value,
        phase3CpuFreqRatio: ev.phase3CpuFreqRatio,
        thermalHeadroomPeak: ev.thermalHeadroomPeak,
        thermalStatusMax: ev.thermalStatusMax,
        saturationFailureReason: ev.saturationFailureReason || '–',
        classification: t.classification,
      }, lang)));
    }
  }

  // 4) Layer 2: freq drift
  const trends = layer2 && layer2.features && layer2.features.trends;
  const fTrend = trends && trends.evidence && trends.evidence.trends && trends.evidence.trends.cpu_freq_drift_phase3;
  if (fTrend && fTrend.classification && fTrend.classification !== 'INSUFFICIENT_DATA') {
    lines.push('- ' + fill(tr('perf_l2_freq_drift', lang), withTranslations({
      pct_drift_per_s: fTrend.pct_drift_per_s,
      mean_freq_kHz: fTrend.mean_freq_kHz,
      n: fTrend.n,
      classification: fTrend.classification,
    }, lang)));
  }

  return lines.join('\n');
}

module.exports = { renderPerformanceSection };
