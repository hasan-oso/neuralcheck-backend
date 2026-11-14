'use strict';

const { tr, fill, withTranslations } = require('../utils/i18n');

function renderThermalSection(layer1, layer2, lang) {
  const lines = [tr('hdr_thermal', lang), ''];

  const t = (layer1 && layer1.features && layer1.features.thermal) || {};

  // 1) Thermal resistance
  if (t.thermalResistance) {
    const r = t.thermalResistance;
    const ev = r.evidence || {};
    if (r.classification !== 'INSUFFICIENT_DATA' && r.classification !== 'INSUFFICIENT_STRESS_DATA') {
      lines.push('- ' + fill(tr('thermal_resistance', lang), withTranslations({
        value: r.value,
        peak_skin_C: ev.peak_skin_C,
        ambient_C: ev.ambient_C,
        mean_power_W: ev.mean_power_W,
        temp_source: ev.temp_source,
        classification: r.classification,
      }, lang)));
    }
  }

  // 2) Time-to-throttle
  if (t.timeToThrottle) {
    const ttt = t.timeToThrottle;
    const ev = ttt.evidence || {};
    if (ttt.classification === 'no_throttle') {
      lines.push('- ' + fill(tr('thermal_ttt_no_throttle', lang), withTranslations({
        peakHeadroomReached: ev.peakHeadroomReached,
        threshold: ev.threshold,
      }, lang)));
    } else if (ttt.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('thermal_ttt', lang), withTranslations({
        value: ttt.value,
        threshold: ev.threshold,
        peakHeadroomReached: ev.peakHeadroomReached,
        classification: ttt.classification,
      }, lang)));
    }
  }

  // 3) Cooldown time constant
  if (t.cooldownTimeConstant) {
    const c = t.cooldownTimeConstant;
    const ev = c.evidence || {};
    if (c.classification === 'INSUFFICIENT_DATA') {
      const amplitude = (ev.T_0_C != null && ev.T_inf_C != null) ? (ev.T_0_C - ev.T_inf_C).toFixed(2) : '?';
      lines.push('- ' + fill(tr('thermal_cooldown_unavailable', lang), {
        reason: ev.reason || '?',
        amplitude_C: amplitude,
      }));
    } else {
      lines.push('- ' + fill(tr('thermal_cooldown', lang), withTranslations({
        value: c.value,
        T_0_C: ev.T_0_C,
        T_inf_C: ev.T_inf_C,
        samples_used: ev.samples_used,
        temp_source: ev.temp_source,
        classification: c.classification,
      }, lang)));
    }
  }

  // 4) Layer 2 temperature rise
  const trends = layer2 && layer2.features && layer2.features.trends;
  const tempTrend = trends && trends.evidence && trends.evidence.trends && trends.evidence.trends.skin_temp_rise_phase5;
  if (tempTrend && tempTrend.classification && tempTrend.classification !== 'INSUFFICIENT_DATA') {
    lines.push('- ' + fill(tr('thermal_l2_temp_rise', lang), withTranslations({
      slope_C_per_s: tempTrend.slope_C_per_s,
      total_rise_C: tempTrend.total_rise_C_estimated,
      classification: tempTrend.classification,
    }, lang)));
  }

  // 5) Layer 2 cross-channel correlation: temp vs power
  const corr = layer2 && layer2.features && layer2.features.correlations;
  if (corr && corr.evidence && Array.isArray(corr.evidence.pairs)) {
    const pair = corr.evidence.pairs.find((p) => p.pair === 'temp_vs_power');
    if (pair && pair.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('thermal_l2_correlation', lang), withTranslations({
        r: pair.pearson_r,
        classification: pair.classification,
      }, lang)));
    }
  }

  return lines.join('\n');
}

module.exports = { renderThermalSection };
