'use strict';

const { normalizeScanData } = require('../layer1');
const { tr, trClass, trConfidence, fill, withTranslations } = require('./utils/i18n');
const { rankFindings, severityOf } = require('./utils/severity_ranker');
const { selectSamples, formatSamplesTable } = require('./utils/sample_selector');
const { getDeviceTier } = require('./utils/tier_lookup');
const { renderBatterySection } = require('./templates/battery');
const { renderThermalSection } = require('./templates/thermal');
const { renderPerformanceSection } = require('./templates/performance');
const { renderAnomaliesSection } = require('./templates/anomalies');
const { renderStressValiditySection } = require('./templates/stress_validity');
const { renderPerPhaseStatsSection } = require('./templates/per_phase_stats');

// Build a one-sentence message for a finding shown in "Critical Findings".
function findingMessage(source, category, key, feature, lang) {
  const cls = feature.classification;
  const conf = feature.confidence;
  const ev = feature.evidence || {};
  const en = (s) => s; // identity for English; Arabic fork below

  if (lang === 'ar') {
    if (source === 'L1') {
      if (category === 'battery' && key === 'internalResistance') {
        return `المقاومة الداخلية ${feature.value} ملي أوم — ${trClass(cls, 'ar')} (الثقة ${trConfidence(conf, 'ar')}; على بُعد ${ev.boundary_proximity_pct ?? '?'}% من حدّ التصنيف).`;
      }
      if (category === 'battery' && key === 'voltageSagSeverity') {
        return `انخفاض الجهد في النبضات ${feature.value}% — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'battery' && key === 'coulombicSoH') {
        return `صحة البطارية الكولومية ${feature.value ?? 'غير متوفّرة'} — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'battery' && key === 'ocvSignature') {
        return `توقيع OCV — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'thermal' && key === 'thermalResistance') {
        return `المقاومة الحرارية ${feature.value} °س/واط — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'thermal' && key === 'timeToThrottle') {
        return cls === 'no_throttle'
          ? `لم يُسجَّل تقييد حراري — ${trClass(cls, 'ar')}.`
          : `وقت الوصول إلى التقييد ${feature.value} ثانية — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'thermal' && key === 'cooldownTimeConstant') {
        return `ثابت زمن التبريد — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'performance' && key === 'stabilityIndex') {
        return `مؤشّر استقرار الأداء ${feature.value}% — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'performance' && key === 'dropP3toP5') {
        return `هبوط الأداء ${feature.value}% — ${trClass(cls, 'ar')}.`;
      }
      if (category === 'performance' && key === 'throttlingType') {
        return `نوع التقييد: ${feature.value} — ${trClass(cls, 'ar')}.`;
      }
    } else if (source === 'L2') {
      if (category === 'anomalies') return `كشف الشذوذات الإحصائية — ${trClass(cls, 'ar')}.`;
      if (category === 'correlations') return `ترابطات بين القنوات — ${trClass(cls, 'ar')}.`;
      if (category === 'spectral') return `تحليل طيفي للجهد — ${trClass(cls, 'ar')}.`;
      if (category === 'trends') return `الاتجاهات داخل الطور — ${trClass(cls, 'ar')}.`;
    }
    return `${source} ${category}/${key}: ${trClass(cls, 'ar')}.`;
  }

  // English
  if (source === 'L1') {
    if (category === 'battery' && key === 'internalResistance') {
      return `Battery internal resistance ${feature.value} mΩ — ${cls} (confidence ${conf}; ${ev.boundary_proximity_pct ?? '?'}% from band boundary).`;
    }
    if (category === 'battery' && key === 'voltageSagSeverity') {
      return `Burst voltage sag ${feature.value}% — ${cls}.`;
    }
    if (category === 'battery' && key === 'coulombicSoH') {
      return `Coulombic SoH ${feature.value ?? 'unavailable'} — ${cls}.`;
    }
    if (category === 'battery' && key === 'ocvSignature') {
      return `OCV signature — ${cls}.`;
    }
    if (category === 'thermal' && key === 'thermalResistance') {
      return `Thermal resistance ${feature.value} °C/W — ${cls}.`;
    }
    if (category === 'thermal' && key === 'timeToThrottle') {
      return cls === 'no_throttle'
        ? `No throttle event observed — ${cls}.`
        : `Time-to-throttle ${feature.value} s — ${cls}.`;
    }
    if (category === 'thermal' && key === 'cooldownTimeConstant') {
      return `Cooldown τ — ${cls}.`;
    }
    if (category === 'performance' && key === 'stabilityIndex') {
      return `Performance stability index ${feature.value}% — ${cls}.`;
    }
    if (category === 'performance' && key === 'dropP3toP5') {
      return `Performance drop p3→p5 ${feature.value}% — ${cls}.`;
    }
    if (category === 'performance' && key === 'throttlingType') {
      return `Throttling type: ${feature.value} — ${cls}.`;
    }
  } else if (source === 'L2') {
    if (category === 'anomalies') return `Statistical outlier detection — ${cls}.`;
    if (category === 'correlations') return `Cross-channel correlations — ${cls}.`;
    if (category === 'spectral') return `Voltage spectral analysis — ${cls}.`;
    if (category === 'trends') return `Within-phase trends — ${cls}.`;
  }
  return `${source} ${category}/${key}: ${cls}.`;
}

function renderCriticalFindings(layer1, layer2, lang) {
  const lines = [tr('hdr_critical_findings', lang), ''];
  const findings = rankFindings(layer1, layer2, lang, findingMessage);
  // Severity ≥ 2 (warning + critical) goes into Critical Findings.
  // INSUFFICIENT_STRESS_DATA gets a clear callout regardless of severity score.
  const critical = findings.filter((f) => f.severity >= 2 || f.classification === 'INSUFFICIENT_STRESS_DATA');
  if (critical.length === 0) {
    lines.push(tr('no_critical_findings', lang));
    return lines.join('\n');
  }
  for (const f of critical) {
    const marker = f.severity >= 3 ? '🛑' : (f.severity === 2 ? '⚠' : '·');
    lines.push(`- ${marker} ${f.msg}`);
  }
  return lines.join('\n');
}

// Quick "Key Numbers" overview block at the top of the summary. Lists the
// most consequential numerical findings so DeepSeek can scan them at a glance
// before reading the detailed sections.
function renderKeyNumbers(scanData, layer1, layer2, lang) {
  const lines = [];
  if (lang === 'ar') {
    lines.push('## أرقام رئيسية');
  } else {
    lines.push('## Key Numbers');
  }
  lines.push('');

  const f = layer1?.features || {};
  const items = [];

  if (f.battery?.internalResistance?.value != null) {
    items.push([
      lang === 'ar' ? 'المقاومة الداخلية للبطارية' : 'Battery internal resistance',
      `${f.battery.internalResistance.value} mΩ (${f.battery.internalResistance.classification})`,
    ]);
  }
  if (f.battery?.voltageSagSeverity?.value != null) {
    items.push([
      lang === 'ar' ? 'انخفاض جهد النبضات' : 'Burst voltage sag',
      `${f.battery.voltageSagSeverity.value}% (${f.battery.voltageSagSeverity.classification})`,
    ]);
  }
  if (f.thermal?.thermalResistance?.value != null) {
    items.push([
      lang === 'ar' ? 'المقاومة الحرارية' : 'Thermal resistance',
      `${f.thermal.thermalResistance.value} °C/W (${f.thermal.thermalResistance.classification})`,
    ]);
  }
  if (f.thermal?.timeToThrottle?.value != null) {
    items.push([
      lang === 'ar' ? 'وقت الوصول للتقييد' : 'Time-to-throttle',
      `${f.thermal.timeToThrottle.value} s (${f.thermal.timeToThrottle.classification})`,
    ]);
  } else if (f.thermal?.timeToThrottle?.classification === 'no_throttle') {
    items.push([
      lang === 'ar' ? 'وقت الوصول للتقييد' : 'Time-to-throttle',
      'no_throttle',
    ]);
  }
  if (f.performance?.stabilityIndex?.value != null) {
    items.push([
      lang === 'ar' ? 'مؤشّر استقرار الأداء' : 'Performance stability index',
      `${f.performance.stabilityIndex.value}% (${f.performance.stabilityIndex.classification})`,
    ]);
  }
  if (f.performance?.dropP3toP5?.value != null) {
    items.push([
      lang === 'ar' ? 'هبوط الأداء p3→p5' : 'Performance drop p3→p5',
      `${f.performance.dropP3toP5.value}% (${f.performance.dropP3toP5.classification})`,
    ]);
  }
  if (f.performance?.throttlingType?.value != null) {
    items.push([
      lang === 'ar' ? 'مصنّف التقييد' : 'Throttling type',
      `${f.performance.throttlingType.value} → ${f.performance.throttlingType.classification}`,
    ]);
  }
  // L2 highlights
  const corr = layer2?.features?.correlations;
  if (corr?.evidence?.pairs) {
    const ssiAnoms = corr.evidence.pairs.filter((p) => p.classification === 'sign_inverted_anomaly').length;
    if (ssiAnoms > 0) {
      items.push([
        lang === 'ar' ? 'ترابطات معكوسة الإشارة' : 'Sign-inverted correlations',
        `${ssiAnoms}`,
      ]);
    }
  }
  const totalOutliers = layer2?.features?.anomalies?.value?.total_outliers ?? 0;
  items.push([
    lang === 'ar' ? 'إجمالي شذوذات Z-score' : 'Total Z-score outliers',
    `${totalOutliers}`,
  ]);

  for (const [k, v] of items) lines.push(`- **${k}**: ${v}`);
  return lines.join('\n');
}

function renderMethodologyFooter(lang) {
  if (lang === 'ar') {
    return [
      '## ملاحظة منهجية',
      '',
      'تمّ حساب جميع الأرقام أعلاه محلّياً على بيانات هذا الفحص فقط، بدون أيّ مقارنة مع قاعدة بيانات لمستخدمين سابقين.',
      'تأتي الميزات في الطبقة 1 من الصيغ الفيزيائية المغلقة (R = ΔV/ΔI، R_thermal = ΔT/ΔP، إلخ). الطبقة 2 تُضيف:',
      '- كشف شذوذات Z-score داخل-الفحص (3σ).',
      '- ترابطات Pearson بين القنوات في المرحلة 5 لاكتشاف عدم الاتّساق الفيزيائي.',
      '- تحليل طيفي FFT لجهد المرحلة 6 (load-step signature) مع كاشف هاينينغ ومرجع NMC مدمج.',
      '- إحصاءات وصفية لكل طور (التواء، تفلطح، ترابط ذاتي).',
      '- اتجاهات OLS داخل الطور (انخفاض الجهد، ارتفاع الحرارة، انجراف التردّد).',
      'كلّ الحدود التصنيفية ثابتة في الكود ومستندة إلى أبحاث منشورة (Schmid 2018 للبطارية، Birkl 2017 لتشخيص NMC، Phone-nomenon 2.0 للحرارة).',
    ].join('\n');
  }
  return [
    '## Methodology Note',
    '',
    'All numbers above were computed locally from this scan only — no comparison against any user database, no learned model, no shared baseline.',
    'Layer 1 features come from closed-form physics equations (R = ΔV/ΔI, R_thermal = ΔT/ΔP, etc.). Layer 2 adds:',
    '- Within-scan Z-score outlier detection (3σ).',
    '- Pearson cross-channel correlations in phase 5 to detect physical inconsistency.',
    '- FFT spectral analysis on phase 6 voltage (load-step signature) with Hann window + linear detrend; embedded NMC reference.',
    '- Per-phase descriptive statistics (skewness, kurtosis, autocorrelation).',
    '- Within-phase OLS trends (voltage decline, temp rise, freq drift).',
    'All classification thresholds are hardcoded in source and grounded in published research (Schmid 2018 for battery internal resistance, Birkl 2017 for NMC degradation modes, Phone-nomenon 2.0 for thermal envelope).',
  ].join('\n');
}

// Cross-references findings between L1 and L2 to surface convergent or
// divergent signals. This addresses the "DeepSeek lost in the middle" risk by
// showing the model how independently-computed findings agree or disagree.
function renderSynthesis(layer1, layer2, lang) {
  const lines = [];
  if (lang === 'ar') {
    lines.push('## التركيب التحليلي');
  } else {
    lines.push('## Cross-Layer Synthesis');
  }
  lines.push('');

  const observations = [];

  // 1) Battery convergence: R_int + voltage trend slope.
  const r = layer1?.features?.battery?.internalResistance;
  const vTrend = layer2?.features?.trends?.evidence?.trends?.voltage_decline_phase5;
  if (r && r.value != null && vTrend && vTrend.slope_mV_per_s != null) {
    const isAged = ['aging', 'degraded', 'end_of_life'].includes(r.classification);
    const isSteepDecline = ['steep_decline_high_impedance', 'severe_decline'].includes(vTrend.classification);
    if (isAged && isSteepDecline) {
      observations.push(lang === 'ar'
        ? `كلا القياسَين المستقلَّين (R_int=${r.value} ملي أوم و منحدر الجهد=${vTrend.slope_mV_per_s} ملي فولت/ث) يشيران إلى ممانعة بطارية مرتفعة؛ نتيجتان متّفقتان.`
        : `Two independent measurements (R_int=${r.value} mΩ and voltage slope=${vTrend.slope_mV_per_s} mV/s) both point to elevated battery impedance; convergent finding.`);
    } else if (!isAged && !isSteepDecline) {
      observations.push(lang === 'ar'
        ? `كلا القياسَين المستقلَّين (R_int=${r.value} ملي أوم و منحدر الجهد=${vTrend.slope_mV_per_s} ملي فولت/ث) ضمن المجال السليم؛ توافق إيجابي.`
        : `Both independent measurements (R_int=${r.value} mΩ, voltage slope=${vTrend.slope_mV_per_s} mV/s) are in healthy range; positive convergence.`);
    } else {
      observations.push(lang === 'ar'
        ? `R_int=${r.value} ملي أوم (${r.classification}) و منحدر الجهد=${vTrend.slope_mV_per_s} ملي فولت/ث (${vTrend.classification}) لا يتّفقان تماماً؛ يحتاج مزيداً من البيانات.`
        : `R_int=${r.value} mΩ (${r.classification}) and voltage slope=${vTrend.slope_mV_per_s} mV/s (${vTrend.classification}) do not fully agree; more data needed.`);
    }
  }

  // 2) Thermal convergence: TTT + temp rise slope + thermalResistance.
  const ttt = layer1?.features?.thermal?.timeToThrottle;
  const thermR = layer1?.features?.thermal?.thermalResistance;
  const tempTrend = layer2?.features?.trends?.evidence?.trends?.skin_temp_rise_phase5;
  if (ttt && thermR && tempTrend) {
    if (ttt.classification === 'no_throttle' && tempTrend.slope_C_per_s < 0.05) {
      observations.push(lang === 'ar'
        ? `عدم تسجيل تقييد حراري + معدّل ارتفاع حرارة منخفض (${tempTrend.slope_C_per_s} °س/ث) يشير إلى أن الجهاز لم يُدفع إلى حدّه الحراري — قد يكون الاختبار غير مُشبع، وليس بالضرورة دليلاً على تبريد ممتاز.`
        : `No throttle event + low temp rise slope (${tempTrend.slope_C_per_s} °C/s) suggests the device was not driven to its thermal envelope — likely under-saturated test, not necessarily proof of excellent cooling.`);
    }
  }

  // 3) Performance / saturation interaction.
  const tt = layer1?.features?.performance?.throttlingType;
  const stats = layer2?.features?.statistics;
  if (tt && tt.classification && stats) {
    if (tt.classification === 'oem_policy_aggressive') {
      observations.push(lang === 'ar'
        ? `مصنّف التقييد يكشف سياسة المُحافظ العدوانية. هذا يحدّ من قدرة الفحص على تقييم الأداء الحقيقي للسيليكون؛ النتائج الحرارية وأداء المعالج تحت الحمل غير قابلة للاشتقاق.`
        : `Throttling classifier shows aggressive governor capping. This limits the test's ability to evaluate the silicon's true performance; thermal/cpu under-load grades are not derivable.`);
    } else if (tt.classification === 'normal' && tt.evidence?.phase3CpuFreqRatio >= 0.85) {
      observations.push(lang === 'ar'
        ? `تشغيل التردّد الكامل تقريباً (${tt.evidence.phase3CpuFreqRatio}) دون تقييد حراري حادّ — السيليكون متاح، لكنّ ضعف التشبّع يحدّ من تقييم الذروة.`
        : `Near-full frequency utilization (${tt.evidence.phase3CpuFreqRatio}) without aggressive throttling — silicon is available, but workload under-saturation limits peak evaluation.`);
    }
  }

  // 4) L2 anomalies summary.
  const anomalies = layer2?.features?.anomalies;
  const corr = layer2?.features?.correlations;
  if (anomalies && corr) {
    const totalOutliers = anomalies.value?.total_outliers ?? 0;
    const corrAnoms = (corr.evidence?.pairs || []).filter((p) => p.classification === 'sign_inverted_anomaly').length;
    if (totalOutliers === 0 && corrAnoms === 0) {
      observations.push(lang === 'ar'
        ? 'لا شذوذات داخل-الفحص: التوزيعات نظيفة، الترابطات بين القنوات متّسقة فيزيائياً.'
        : 'No within-scan anomalies: distributions are clean and cross-channel correlations are physically consistent.');
    } else if (corrAnoms >= 2) {
      observations.push(lang === 'ar'
        ? `${corrAnoms} ترابطات بين القنوات معكوسة الإشارة — قد يعكس هيمنة الانجراف الزمني على الاستجابة قصيرة الأمد، أو اختلال مستشعر. راجع نافذة العيّنات.`
        : `${corrAnoms} cross-channel correlations show inverted sign — may reflect long-term drift dominating short-term load response, or a sensor anomaly. Inspect the sample window.`);
    } else if (totalOutliers > 0) {
      observations.push(lang === 'ar'
        ? `${totalOutliers} شذوذ Z-score مُكتَشَف؛ معظمها على حدود الأطوار (متوقّع للبيانات متعدّدة الأنماط).`
        : `${totalOutliers} Z-score outliers detected; mostly at phase boundaries (expected for multi-modal data).`);
    }
  }

  if (observations.length === 0) {
    observations.push(lang === 'ar'
      ? 'لا توجد ملاحظات تركيبية بارزة بين الطبقتين 1 و 2.'
      : 'No standout cross-layer observations between Layers 1 and 2.');
  }

  for (const o of observations) lines.push('- ' + o);
  return lines.join('\n');
}

function renderTierContext(scanData, lang) {
  const tier = getDeviceTier(scanData);
  if (!tier) return '';
  const footer = scanData.timeSeries?.footer || scanData.footer || {};
  const peakMw = footer.stressEffectiveness?.phase5PowerPeakMw;
  if (typeof peakMw !== 'number') return '';
  const peakW = peakMw / 1000;
  const ratio = (peakW / tier.tdp_w * 100).toFixed(0);
  if (lang === 'ar') {
    return `ذروة طاقة المرحلة 5 ${peakW.toFixed(2)} واط = ${ratio}% من المغلّف الحراري المتوقّع للسوق (${tier.tdp_w} واط لـ ${tier.name} / ${tier.tier}).`;
  }
  return `Phase-5 peak power ${peakW.toFixed(2)} W = ${ratio}% of expected envelope (${tier.tdp_w} W for ${tier.name} / ${tier.tier}).`;
}

function renderCriticalSampleWindow(scanData, layer2, lang) {
  const norm = normalizeScanData(scanData);
  const samples = norm.timeSeries.samples;
  const selected = selectSamples(samples, layer2);
  const lines = [tr('hdr_critical_window', lang), ''];
  lines.push(fill(tr('critical_window_intro', lang), { n: selected.length }));
  lines.push('');
  lines.push(formatSamplesTable(selected));
  return { markdown: lines.join('\n'), selectedCount: selected.length };
}

// Main entry point.
function generateClinicalSummary(scanData, layer1, layer2, options) {
  const opts = options || {};
  const lang = opts.language || 'ar';

  const norm = normalizeScanData(scanData);
  const sampleCount = norm.timeSeries.samples.length;

  const sections = [];
  sections.push(tr('hdr_diagnostic_summary', lang));
  sections.push('');

  // Tier context line, if available.
  const tierCtx = renderTierContext(scanData, lang);
  if (tierCtx) {
    sections.push('> ' + tierCtx);
    sections.push('');
  }

  sections.push(renderKeyNumbers(scanData, layer1, layer2, lang));
  sections.push('');
  sections.push(renderCriticalFindings(layer1, layer2, lang));
  sections.push('');
  sections.push(renderBatterySection(layer1, layer2, lang));
  sections.push('');
  sections.push(renderThermalSection(layer1, layer2, lang));
  sections.push('');
  sections.push(renderPerformanceSection(layer1, layer2, lang));
  sections.push('');
  sections.push(renderAnomaliesSection(layer2, lang));
  sections.push('');
  sections.push(renderPerPhaseStatsSection(layer2, lang));
  sections.push('');

  // Synthesis paragraph: cross-reference L1 + L2 findings.
  sections.push(renderSynthesis(layer1, layer2, lang));
  sections.push('');

  const window = renderCriticalSampleWindow(scanData, layer2, lang);
  sections.push(window.markdown);
  sections.push('');

  sections.push(renderStressValiditySection(scanData, layer1, lang));
  sections.push('');
  sections.push(renderMethodologyFooter(lang));

  const markdown = sections.join('\n');
  const tier = getDeviceTier(scanData);

  return {
    schemaVersion: 'layer3.v1',
    computedAt: new Date().toISOString(),
    language: lang,
    markdown,
    metadata: {
      total_samples_in_scan: sampleCount,
      selected_samples_in_window: window.selectedCount,
      device_tier: tier,
      word_count: markdown.split(/\s+/).filter(Boolean).length,
      character_count: markdown.length,
    },
  };
}

module.exports = { generateClinicalSummary };
