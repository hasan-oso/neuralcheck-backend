'use strict';

const { tr, fill, withTranslations } = require('../utils/i18n');

function renderAnomaliesSection(layer2, lang) {
  const lines = [tr('hdr_anomalies', lang), ''];

  const f = layer2 && layer2.features;
  if (!f) {
    lines.push('- ' + tr('anomalies_none', lang));
    return lines.join('\n');
  }

  let anyEmitted = false;

  // T1 Z-score outliers
  const an = f.anomalies;
  if (an && an.evidence && Array.isArray(an.evidence.per_channel)) {
    for (const c of an.evidence.per_channel) {
      if (!c || c.outlier_count === 0) continue;
      anyEmitted = true;
      lines.push(fill(tr('anomaly_zscore', lang), withTranslations({
        channel: c.channel,
        outlier_count: c.outlier_count,
        outlier_ratio_pct: c.outlier_ratio_pct,
        within_phase_cluster_max: c.within_phase_cluster_max,
        classification: c.classification,
      }, lang)));
    }
  }

  // T2 Correlation anomalies (only flag the ones with classification != physically_consistent)
  const corr = f.correlations;
  if (corr && corr.evidence && Array.isArray(corr.evidence.pairs)) {
    for (const p of corr.evidence.pairs) {
      if (!p) continue;
      if (p.classification === 'physically_consistent' || p.classification === 'INSUFFICIENT_DATA') continue;
      anyEmitted = true;
      lines.push(fill(tr('anomaly_correlation', lang), withTranslations({
        label: p.label,
        pearson_r: p.pearson_r,
        expected: p.expected,
        n: p.n,
        classification: p.classification,
      }, lang)));
    }
  }

  if (!anyEmitted) {
    lines.push('- ' + tr('anomalies_none', lang));
  }

  return lines.join('\n');
}

module.exports = { renderAnomaliesSection };
