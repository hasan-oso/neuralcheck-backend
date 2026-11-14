'use strict';

const { trClass } = require('../utils/i18n');

// Render the Layer 2 T4 (per-phase descriptive statistics) into a compact
// markdown section. Surfaces skewness/kurtosis/autocorrelation/IQR — values
// that are otherwise buried in the layer2 JSON.

const HEADERS = {
  en: '## Per-Phase Distribution Statistics',
  ar: '## إحصاءات التوزيع لكل طور',
};

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function renderPerPhaseStatsSection(layer2, lang) {
  const stats = layer2 && layer2.features && layer2.features.statistics;
  const lines = [HEADERS[lang] || HEADERS.en, ''];
  if (!stats || !stats.evidence || !Array.isArray(stats.evidence.phases)) {
    lines.push(lang === 'ar' ? '_بيانات إحصائية غير متوفّرة._' : '_Statistical data unavailable._');
    return lines.join('\n');
  }

  // Markdown table: phase, channel, key stats.
  lines.push('| phase | channel | n | mean | std/cv/var | skew/kurt | autocorr / classification |');
  lines.push('|---|---|---:|---:|---|---|---|');
  for (const ph of stats.evidence.phases) {
    if (!ph.n_samples) continue;
    const tableRow = (cells) => '| ' + cells.join(' | ') + ' |';
    if (ph.cpu_freq_big && ph.cpu_freq_big.classification !== 'INSUFFICIENT_DATA') {
      const f = ph.cpu_freq_big;
      lines.push(tableRow([
        ph.name,
        'cpu_freq_big_kHz',
        f.n,
        f.mean,
        f.std,
        `skew=${f.skewness} (${trClass(f.skewness_classification, lang) || '–'}); kurt=${f.kurtosis}`,
        '–',
      ]));
    }
    if (ph.battery_current && ph.battery_current.classification && ph.battery_current.classification !== 'INSUFFICIENT_DATA') {
      const c = ph.battery_current;
      lines.push(tableRow([
        ph.name,
        'battery_current_abs_mA',
        c.n,
        c.mean_mA,
        `cv=${c.cv}`,
        '–',
        trClass(c.classification, lang),
      ]));
    }
    if (ph.thermal_headroom && ph.thermal_headroom.classification !== 'INSUFFICIENT_DATA' && ph.thermal_headroom.n) {
      const h = ph.thermal_headroom;
      lines.push(tableRow([
        ph.name,
        'thermal_headroom',
        h.n,
        h.p50,
        `range=${h.range}; iqr=${h.iqr}`,
        '–',
        '–',
      ]));
    }
    if (ph.cpu_usage && ph.cpu_usage.classification !== 'INSUFFICIENT_DATA') {
      const u = ph.cpu_usage;
      lines.push(tableRow([
        ph.name,
        'cpu_usage_pct',
        u.n,
        u.mean,
        u.std,
        '–',
        `r1=${u.autocorr_lag1} (${trClass(u.autocorr_classification, lang) || '–'})`,
      ]));
    }
  }

  return lines.join('\n');
}

module.exports = { renderPerPhaseStatsSection };
