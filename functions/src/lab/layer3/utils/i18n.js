'use strict';

// Bilingual string table (English + Arabic). Used by templates.
// Each entry has { en, ar } strings and optional template-variable placeholders
// (in `${name}` syntax). Pure data; no logic.

const STRINGS = {
  // Section headers
  hdr_diagnostic_summary: { en: '# Diagnostic Summary', ar: '# الملخّص التشخيصي' },
  hdr_critical_findings: { en: '## Critical Findings', ar: '## النتائج الحرجة' },
  hdr_battery: { en: '## Battery Analysis', ar: '## تحليل البطارية' },
  hdr_thermal: { en: '## Thermal Analysis', ar: '## التحليل الحراري' },
  hdr_performance: { en: '## Performance Analysis', ar: '## تحليل الأداء' },
  hdr_anomalies: { en: '## Anomalies Detected', ar: '## الشذوذات المُكتَشَفة' },
  hdr_critical_window: { en: '## Critical Sample Window', ar: '## نافذة العيّنات الحرجة' },
  hdr_stress_validity: { en: '## Stress Test Validity', ar: '## صلاحية اختبار الإجهاد' },

  // Battery findings
  battery_internal_resistance: {
    en: 'Battery internal resistance is ${value} mΩ (${classification}).',
    ar: 'المقاومة الداخلية للبطارية ${value} ملي أوم (${classification_ar}).',
  },
  battery_internal_resistance_boundary: {
    en: ' This measurement is ${boundary_proximity_pct}% from the nearest band boundary; confidence has been capped to ${confidence}.',
    ar: ' هذا القياس على بُعد ${boundary_proximity_pct}% من أقرب حدّ تصنيف؛ تمّ تقييد الثقة عند ${confidence_ar}.',
  },
  battery_internal_resistance_method: {
    en: ' Method: ${method}. Confidence: ${confidence}.',
    ar: ' الطريقة: ${method}. الثقة: ${confidence_ar}.',
  },
  // v63 Step 1: handle R_int INSUFFICIENT_DATA cleanly (mirrors SoH/OCV branches).
  // Was previously rendered as "<empty> mΩ (INSUFFICIENT_DATA)" with a blank
  // value placeholder; now renders as a structured unavailable message.
  battery_internal_resistance_unavailable: {
    en: 'Battery internal resistance unavailable: ${reason}. ${detail}',
    ar: 'المقاومة الداخلية للبطارية غير متوفّرة: ${reason}. ${detail}',
  },
  battery_voltage_sag: {
    en: 'Voltage sag during burst phase: ${value}% drop (V_max=${V_max_mV} mV → V_min=${V_min_mV} mV; classification ${classification}).',
    ar: 'انخفاض الجهد خلال مرحلة النبضات: ${value}% (V_max=${V_max_mV} ملي فولت → V_min=${V_min_mV} ملي فولت؛ التصنيف ${classification_ar}).',
  },
  battery_soh_unavailable: {
    en: 'Coulombic state-of-health unavailable: ${reason}. ΔLevel observed = ${deltaLevel}% (threshold ≥5%). ${recommendation}.',
    ar: 'مقياس الصحة الكولومي غير متوفّر: ${reason}. ΔLevel المُلاحظ = ${deltaLevel}% (الحدّ الأدنى ≥5%). ${recommendation_ar}.',
  },
  battery_soh_official: {
    en: 'State-of-health from official API: ${value}% (${classification}).',
    ar: 'صحة البطارية من API الرسمي: ${value}% (${classification_ar}).',
  },
  battery_ocv_unavailable: {
    en: 'OCV signature analysis unavailable: ${reason}. Idle points found = ${idle_points_count}.',
    ar: 'تحليل توقيع OCV غير متوفّر: ${reason}. نقاط السكون المُكتَشَفة = ${idle_points_count}.',
  },
  battery_ocv_result: {
    en: 'OCV signature deviation from NMC reference: mean=${mean_deviation_mV} mV, std=${std_deviation_mV} mV (${classification}).',
    ar: 'انحراف توقيع OCV عن مرجع NMC: المتوسط=${mean_deviation_mV} ملي فولت، الانحراف المعياري=${std_deviation_mV} ملي فولت (${classification_ar}).',
  },
  battery_l2_spectral: {
    en: 'Voltage spectral signature (phase 6 FFT): dominant_freq=${dominant_freq_hz} Hz, centroid=${spectral_centroid_hz} Hz, entropy=${spectral_entropy_normalized} (${classification}).',
    ar: 'توقيع الجهد الطيفي (FFT للمرحلة 6): التردّد المهيمن=${dominant_freq_hz} هرتز، النقطة المركزية=${spectral_centroid_hz} هرتز، الإنتروبي=${spectral_entropy_normalized} (${classification_ar}).',
  },
  battery_l2_voltage_trend: {
    en: 'Voltage decline slope under combined load (phase 5): ${slope_mV_per_s} mV/s (${classification}). Total estimated drop: ${total_drop_mV} mV across phase 5.',
    ar: 'منحدر انخفاض الجهد تحت الحمل المركّب (المرحلة 5): ${slope_mV_per_s} ملي فولت/ثانية (${classification_ar}). الانخفاض الإجمالي المُقدَّر: ${total_drop_mV} ملي فولت عبر المرحلة 5.',
  },

  // Thermal findings
  thermal_resistance: {
    en: 'Thermal resistance R_thermal = ${value} °C/W (${classification}). Computed from peak skin temp ${peak_skin_C}°C minus ambient ${ambient_C}°C, divided by mean phase-5 power ${mean_power_W} W. Temp source: ${temp_source}.',
    ar: 'المقاومة الحرارية R_thermal = ${value} °س/واط (${classification_ar}). محسوبة من ذروة درجة حرارة الجلد ${peak_skin_C}°س مطروحة من المحيط ${ambient_C}°س، مقسومة على متوسط طاقة المرحلة 5 ${mean_power_W} واط. مصدر الحرارة: ${temp_source}.',
  },
  thermal_ttt: {
    en: 'Time-to-throttle: ${value} seconds from phase-3 start to first headroom ≥ ${threshold} (${classification}). Peak headroom reached: ${peakHeadroomReached}.',
    ar: 'وقت الوصول إلى التقييد الحراري: ${value} ثانية من بداية المرحلة 3 حتى أوّل headroom ≥ ${threshold} (${classification_ar}). الذروة المُسجَّلة: ${peakHeadroomReached}.',
  },
  thermal_ttt_no_throttle: {
    en: 'No thermal throttle event detected during stress phases. Peak headroom reached only ${peakHeadroomReached} (threshold ${threshold}).',
    ar: 'لم يُسجَّل أيّ حدث تقييد حراري خلال مراحل الإجهاد. الذروة المُسجَّلة ${peakHeadroomReached} فقط (الحدّ ${threshold}).',
  },
  thermal_cooldown: {
    en: 'Cooldown time constant τ = ${value} seconds (${classification}). Computed via ln-linear fit of phase 7 from T_0=${T_0_C}°C → T_∞=${T_inf_C}°C using ${samples_used} samples (source: ${temp_source}).',
    ar: 'ثابت زمن التبريد τ = ${value} ثانية (${classification_ar}). محسوب عبر ملاءمة لوغاريتمية-خطّية للمرحلة 7 من T_0=${T_0_C}°س → T_∞=${T_inf_C}°س باستخدام ${samples_used} عيّنة (المصدر: ${temp_source}).',
  },
  thermal_cooldown_unavailable: {
    en: 'Cooldown time constant unavailable: ${reason}. Cooling amplitude only ${amplitude_C}°C (threshold >1°C).',
    ar: 'ثابت زمن التبريد غير متوفّر: ${reason}. سعة التبريد ${amplitude_C}°س فقط (الحدّ >1°س).',
  },
  thermal_l2_temp_rise: {
    en: 'Skin-temperature rise slope (phase 5): ${slope_C_per_s} °C/s (${classification}). Estimated total rise: ${total_rise_C}°C.',
    ar: 'منحدر ارتفاع حرارة الجلد (المرحلة 5): ${slope_C_per_s} °س/ث (${classification_ar}). الارتفاع الإجمالي المُقدَّر: ${total_rise_C}°س.',
  },
  thermal_l2_correlation: {
    en: 'Cross-channel correlation battery_temp vs package_power (phase 5): r = ${r}. Expected positive (≥0.3); observed ${classification}.',
    ar: 'الترابط بين قنوات battery_temp و package_power (المرحلة 5): r = ${r}. المتوقّع موجب (≥0.3)؛ المُلاحظ ${classification_ar}.',
  },

  // Performance / CPU findings
  perf_psi: {
    en: 'CPU performance stability index (phase 3): PSI = ${value}% (${classification}). σ/μ over ${samples_used} samples; mean ${meanFreq_kHz} kHz, σ ${stdFreq_kHz} kHz.',
    ar: 'مؤشّر استقرار أداء المعالج (المرحلة 3): PSI = ${value}% (${classification_ar}). σ/μ عبر ${samples_used} عيّنة؛ المتوسط ${meanFreq_kHz} كيلوهرتز، σ ${stdFreq_kHz} كيلوهرتز.',
  },
  perf_drop: {
    en: 'Performance drop p3 → p5: ${value}% (${classification}). Big-cluster mean freq dropped from ${freq_p3_kHz} kHz (CPU-only) to ${freq_p5_kHz} kHz (combined load).',
    ar: 'هبوط الأداء بين المرحلتين 3 و 5: ${value}% (${classification_ar}). متوسط تردّد العنقود الكبير انخفض من ${freq_p3_kHz} كيلوهرتز (CPU وحده) إلى ${freq_p5_kHz} كيلوهرتز (حمل مركّب).',
  },
  perf_throttling: {
    en: 'Throttling classifier: ${value} → ${classification}. phase3CpuFreqRatio=${phase3CpuFreqRatio}, thermalHeadroomPeak=${thermalHeadroomPeak}, thermalStatusMax=${thermalStatusMax}. Saturation reason: ${saturationFailureReason}.',
    ar: 'مصنّف التقييد الحراري: ${value} → ${classification_ar}. phase3CpuFreqRatio=${phase3CpuFreqRatio}، thermalHeadroomPeak=${thermalHeadroomPeak}، thermalStatusMax=${thermalStatusMax}. سبب الإجهاد: ${saturationFailureReason}.',
  },
  perf_l2_freq_drift: {
    en: 'Big-cluster frequency drift (phase 3): ${pct_drift_per_s}%/s (${classification}). Mean freq ${mean_freq_kHz} kHz across ${n} samples.',
    ar: 'انجراف تردّد العنقود الكبير (المرحلة 3): ${pct_drift_per_s}%/ث (${classification_ar}). المتوسط ${mean_freq_kHz} كيلوهرتز عبر ${n} عيّنة.',
  },

  // Anomalies (Layer 2)
  anomaly_zscore: {
    en: '- Channel ${channel}: ${outlier_count} outliers (${outlier_ratio_pct}% of valid samples). Worst-cluster within a single phase: ${within_phase_cluster_max}. Classification: ${classification}.',
    ar: '- القناة ${channel}: ${outlier_count} شذوذ (${outlier_ratio_pct}% من العيّنات الصالحة). أكبر تجمّع داخل مرحلة واحدة: ${within_phase_cluster_max}. التصنيف: ${classification_ar}.',
  },
  anomaly_correlation: {
    en: '- ${label}: r = ${pearson_r} (expected ${expected}; classification ${classification}, n=${n}).',
    ar: '- ${label}: r = ${pearson_r} (المتوقّع ${expected}؛ التصنيف ${classification_ar}، n=${n}).',
  },
  anomalies_none: {
    en: 'No within-scan anomalies detected. All channel distributions are clean and physically consistent.',
    ar: 'لم تُكتَشَف شذوذات داخل الفحص. جميع توزيعات القنوات نظيفة ومتسقة فيزيائياً.',
  },

  // Critical window
  critical_window_intro: {
    en: 'Selected ${n} samples across phase boundaries, peak power, and detected outliers (full table below).',
    ar: 'تمّ اختيار ${n} عيّنة عبر حدود الأطوار وذروة الطاقة والشذوذات المُكتَشَفة (الجدول الكامل أدناه).',
  },

  // Stress validity
  stress_validity: {
    en: 'Stress test ${passed} saturation threshold. phase3CpuFreqRatio=${ratio}, phase3CpuUsageAvg=${usage}%, phase5PowerPeakMw=${powerPeak} mW. Reason: ${reason}.',
    ar: 'اختبار الإجهاد ${passed_ar} حدّ التشبّع. phase3CpuFreqRatio=${ratio}، phase3CpuUsageAvg=${usage}%، phase5PowerPeakMw=${powerPeak} ملي واط. السبب: ${reason}.',
  },
  stress_validity_passed: {
    en: 'PASSED — device was effectively stressed; cpu/thermal grades are derivable.',
    ar: 'ناجح — الجهاز خضع لضغط فعلي؛ يمكن استنتاج درجات cpu/thermal.',
  },
  stress_validity_failed_governor: {
    en: 'FAILED via OEM governor capping — silicon was prevented from reaching its thermal envelope by an OEM policy. cpu/thermal cannot be evaluated. This is NOT a device defect; it is OEM-side throttling policy.',
    ar: 'فشل بسبب تقييد المُحافظ من جهة الشركة المصنّعة — المنع من وصول السيليكون إلى مغلّفه الحراري بسبب سياسة الشركة. لا يمكن تقييم cpu/thermal. هذا ليس عيباً في الجهاز؛ بل سياسة تقييد من الشركة المصنّعة.',
  },
  stress_validity_failed_workload: {
    en: 'FAILED via under-saturated workload — the test did not engage enough cores to exercise the device. cpu/thermal cannot be evaluated under load that did not occur.',
    ar: 'فشل بسبب حمولة غير مُشبِعة — لم يُشغّل الاختبار عدداً كافياً من الأنوية لإجهاد الجهاز. لا يمكن تقييم cpu/thermal تحت حمل لم يحدث.',
  },

  // Class translations (English → Arabic)
  cls_healthy: { ar: 'سليم' },
  cls_aging: { ar: 'متقدّم في العمر' },
  cls_degraded: { ar: 'متدهور' },
  cls_end_of_life: { ar: 'نهاية العمر الافتراضي' },
  cls_minimal: { ar: 'ضئيل' },
  cls_moderate: { ar: 'معتدل' },
  cls_high: { ar: 'مرتفع' },
  cls_severe: { ar: 'حادّ' },
  cls_excellent: { ar: 'ممتاز' },
  cls_marginal: { ar: 'هامشي' },
  cls_severe_degradation: { ar: 'تدهور حادّ' },
  cls_no_throttle: { ar: 'بلا تقييد' },
  cls_excellent_cooling: { ar: 'تبريد ممتاز' },
  cls_normal: { ar: 'طبيعي' },
  cls_weak_cooling: { ar: 'تبريد ضعيف' },
  cls_degraded_cooling: { ar: 'تبريد متدهور' },
  cls_cooling_defect: { ar: 'عيب تبريد' },
  cls_slow: { ar: 'بطيء' },
  cls_very_slow: { ar: 'بطيء جدّاً' },
  cls_very_stable: { ar: 'مستقر جدّاً' },
  cls_unstable: { ar: 'غير مستقر' },
  cls_very_unstable: { ar: 'غير مستقر جدّاً' },
  cls_optimal: { ar: 'أمثل' },
  cls_oem_policy_not_defect: { ar: 'سياسة OEM وليست عيباً' },
  cls_oem_policy_aggressive: { ar: 'سياسة OEM عدوانية' },
  cls_expected_under_load: { ar: 'متوقّع تحت الحمل' },
  cls_cooling_concern: { ar: 'مخاوف تبريد' },
  cls_inconclusive: { ar: 'غير حاسم' },
  cls_consistent_with_nmc: { ar: 'متّسق مع كيمياء NMC' },
  cls_slight_deviation: { ar: 'انحراف طفيف' },
  cls_unusual_chemistry_or_aged: { ar: 'كيمياء غير اعتيادية أو متقادم' },
  cls_unstable_readings: { ar: 'قراءات غير مستقرّة' },
  cls_INSUFFICIENT_DATA: { ar: 'بيانات غير كافية' },
  cls_INSUFFICIENT_STRESS_DATA: { ar: 'بيانات إجهاد غير كافية' },
  cls_clean: { ar: 'نظيف' },
  cls_expected_boundary_artifacts: { ar: 'آثار حدود متوقّعة' },
  cls_mild_anomalies: { ar: 'شذوذات طفيفة' },
  cls_significant_anomalies: { ar: 'شذوذات هامّة' },
  cls_flat_signal: { ar: 'إشارة مسطّحة' },
  cls_physically_consistent: { ar: 'متّسق فيزيائياً' },
  cls_weak_but_correct_sign: { ar: 'ضعيف لكنّ الاتّجاه صحيح' },
  cls_no_correlation: { ar: 'بلا ترابط' },
  cls_sign_inverted_anomaly: { ar: 'شذوذ بانعكاس الاتّجاه' },
  cls_consistent_with_nmc_healthy: { ar: 'متّسق مع NMC السليم' },
  cls_dominant_freq_below_load_step: { ar: 'التردّد المهيمن أدنى من خطوة الحمل' },
  cls_high_frequency_content_anomaly: { ar: 'شذوذ بمحتوى عالي التردّد' },
  cls_broader_spectrum_aging_likely: { ar: 'طيف أوسع، شيخوخة محتملة' },
  cls_unstable_signal: { ar: 'إشارة غير مستقرّة' },
  cls_normal_decline: { ar: 'انخفاض طبيعي' },
  cls_moderate_decline: { ar: 'انخفاض معتدل' },
  cls_steep_decline_high_impedance: { ar: 'انخفاض حادّ — ممانعة عالية' },
  cls_severe_decline: { ar: 'انخفاض شديد' },
  cls_rising_voltage_anomaly: { ar: 'شذوذ ارتفاع الجهد' },
  cls_rapid_heating: { ar: 'تسخين سريع' },
  cls_normal_heating: { ar: 'تسخين طبيعي' },
  cls_flat_thermal_response: { ar: 'استجابة حرارية مسطّحة' },
  cls_cooling_during_load_anomaly: { ar: 'شذوذ تبريد أثناء الحمل' },
  cls_stable: { ar: 'مستقر' },
  cls_frequency_climb: { ar: 'صعود تردّد' },
  cls_mild_drift_down: { ar: 'انجراف هابط طفيف' },
  cls_rapid_throttling_drift: { ar: 'انجراف تقييد سريع' },
  cls_governor_capping: { ar: 'تقييد المُحافظ' },
  cls_governor_capping_severe: { ar: 'تقييد المُحافظ الحادّ' },
  cls_governor_capping_aggressive: { ar: 'تقييد المُحافظ العدواني' },
  cls_thermal_throttling_normal: { ar: 'تقييد حراري طبيعي' },
  cls_thermal_throttling_aggressive: { ar: 'تقييد حراري عدواني' },
  cls_none_well_cooled: { ar: 'لا تقييد، تبريد جيّد' },
  cls_none_thermal_pressure_within_design: { ar: 'لا تقييد، ضغط حراري ضمن التصميم' },
  cls_mixed_signals: { ar: 'إشارات مختلطة' },
  cls_concern: { ar: 'مخاوف' },
  cls_watch: { ar: 'مراقبة' },
  cls_partial_data: { ar: 'بيانات جزئية' },
  cls_computed: { ar: 'محسوب' },

  // Confidence translations
  conf_high: { ar: 'عالية' },
  conf_medium: { ar: 'متوسّطة' },
  conf_low: { ar: 'منخفضة' },

  // Misc
  na: { en: 'n/a', ar: 'غير متوفّر' },
  passed_token: { en: 'PASSED', ar: 'نجح' },
  failed_token: { en: 'FAILED', ar: 'فشل' },
  no_critical_findings: {
    en: 'No critical-severity findings. Device is in nominal condition relative to the signals available.',
    ar: 'لا توجد نتائج بدرجة حرجة. الجهاز في حالة طبيعية بالنسبة للإشارات المتاحة.',
  },
};

function tr(key, lang) {
  const entry = STRINGS[key];
  if (!entry) return '[' + key + '?]';
  return entry[lang] || entry.en || ('[' + key + '?]');
}

function trClass(classification, lang) {
  if (!classification) return '';
  if (lang === 'en') return classification;
  const entry = STRINGS['cls_' + classification];
  if (entry && entry.ar) return entry.ar;
  return classification; // fallback to English token if no Arabic
}

function trConfidence(conf, lang) {
  if (!conf) return '';
  if (lang === 'en') return conf;
  const entry = STRINGS['conf_' + conf];
  if (entry && entry.ar) return entry.ar;
  return conf;
}

// Simple ${name} template fill. Missing keys become empty string.
function fill(template, vars) {
  return String(template).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_, k) => {
    const v = vars[k];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}

// Build a translation block including {classification, classification_ar,
// confidence, confidence_ar} so templates can interpolate without per-call
// boilerplate.
function withTranslations(vars, lang) {
  return Object.assign({}, vars, {
    classification_ar: trClass(vars.classification, 'ar'),
    confidence_ar: trConfidence(vars.confidence, 'ar'),
  });
}

module.exports = { tr, trClass, trConfidence, fill, withTranslations, STRINGS };
