'use strict';

const { tr, fill, withTranslations } = require('../utils/i18n');

// Build the "Battery Analysis" section. Pulls from Layer 1 battery sub-features
// and Layer 2 spectral + voltage trend.
function renderBatterySection(layer1, layer2, lang) {
  const lines = [tr('hdr_battery', lang), ''];

  const b = (layer1 && layer1.features && layer1.features.battery) || {};

  // 1) Internal resistance
  if (b.internalResistance) {
    const r = b.internalResistance;
    const ev = r.evidence || {};
    if (r.classification === 'INSUFFICIENT_DATA') {
      // v63 Step 1: structured unavailable message (mirrors SoH/OCV branches).
      // Build a short detail snippet from whichever evidence fields are present.
      const detailParts = [];
      if (typeof ev.deltaV_mV === 'number') {
        detailParts.push('ΔV=' + ev.deltaV_mV + ' mV');
      }
      if (typeof ev.deltaI_mA === 'number') {
        detailParts.push('ΔI=' + ev.deltaI_mA + ' mA');
      }
      if (typeof ev.threshold_mV === 'number') {
        detailParts.push((lang === 'ar' ? 'الحدّ ' : 'threshold ') + '≥' + ev.threshold_mV + ' mV');
      }
      const line = fill(tr('battery_internal_resistance_unavailable', lang), {
        reason: ev.reason || '?',
        detail: detailParts.join(' · '),
      });
      lines.push('- ' + line);
    } else {
      let line = fill(tr('battery_internal_resistance', lang), withTranslations({
        value: r.value,
        classification: r.classification,
      }, lang));
      if (typeof ev.boundary_proximity_pct === 'number' && ev.confidence_capped) {
        line += fill(tr('battery_internal_resistance_boundary', lang), withTranslations({
          boundary_proximity_pct: ev.boundary_proximity_pct,
          confidence: r.confidence,
        }, lang));
      }
      line += fill(tr('battery_internal_resistance_method', lang), withTranslations({
        method: ev.method || '?',
        confidence: r.confidence,
      }, lang));
      lines.push('- ' + line);
    }
  }

  // 2) Voltage sag severity
  if (b.voltageSagSeverity) {
    const s = b.voltageSagSeverity;
    const ev = s.evidence || {};
    if (s.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('battery_voltage_sag', lang), withTranslations({
        value: s.value,
        V_max_mV: ev.V_max_mV,
        V_min_mV: ev.V_min_mV,
        classification: s.classification,
      }, lang)));
    }
  }

  // 3) Coulombic SoH (or its absence)
  if (b.coulombicSoH) {
    const c = b.coulombicSoH;
    const ev = c.evidence || {};
    if (c.classification === 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('battery_soh_unavailable', lang), {
        reason: ev.reason || '?',
        deltaLevel: ev.deltaLevel ?? '?',
        recommendation: ev.recommendation || '',
        recommendation_ar: ev.recommendation || '',
      }));
    } else if (c.classification !== 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('battery_soh_official', lang), withTranslations({
        value: c.value,
        classification: c.classification,
      }, lang)));
    }
  }

  // 4) OCV signature
  if (b.ocvSignature) {
    const o = b.ocvSignature;
    const ev = o.evidence || {};
    if (o.classification === 'INSUFFICIENT_DATA') {
      lines.push('- ' + fill(tr('battery_ocv_unavailable', lang), {
        reason: ev.reason || '?',
        idle_points_count: ev.idle_points_count ?? 0,
      }));
    } else {
      lines.push('- ' + fill(tr('battery_ocv_result', lang), withTranslations({
        mean_deviation_mV: ev.mean_deviation_mV,
        std_deviation_mV: ev.std_deviation_mV,
        classification: o.classification,
      }, lang)));
    }
  }

  // 5) Layer 2: spectral signature
  const spec = layer2 && layer2.features && layer2.features.spectral;
  if (spec && spec.classification !== 'INSUFFICIENT_DATA' && spec.value) {
    lines.push('- ' + fill(tr('battery_l2_spectral', lang), withTranslations({
      dominant_freq_hz: spec.value.dominant_freq_hz,
      spectral_centroid_hz: spec.value.spectral_centroid_hz,
      spectral_entropy_normalized: spec.value.spectral_entropy_normalized,
      classification: spec.classification,
    }, lang)));
  }

  // 6) Layer 2: voltage decline trend (load impedance signal)
  const trends = layer2 && layer2.features && layer2.features.trends;
  const vTrend = trends && trends.evidence && trends.evidence.trends && trends.evidence.trends.voltage_decline_phase5;
  if (vTrend && vTrend.classification && vTrend.classification !== 'INSUFFICIENT_DATA') {
    const totalDrop = vTrend.slope_mV_per_s != null ? Math.round(vTrend.slope_mV_per_s * 60) : null;
    lines.push('- ' + fill(tr('battery_l2_voltage_trend', lang), withTranslations({
      slope_mV_per_s: vTrend.slope_mV_per_s,
      total_drop_mV: totalDrop,
      classification: vTrend.classification,
    }, lang)));
  }

  return lines.join('\n');
}

module.exports = { renderBatterySection };
