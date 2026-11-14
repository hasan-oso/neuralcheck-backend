'use strict';

// ===================================================================
// thresholdSetVersioned.js — مجموعة الحدود بنسخة (V8 / PLAN-05 §١-د-٤ :208، الدفعة ٥-أ، الصفّ S-B5a، 2026-10-21 +03)
// ===================================================================
// «والحدّ في `thresholdSet` بنسخة (مصدر واحد، القاعدة 24). وكل تقرير يحفظ نسخة الحدود التي حُسب بها؛ والخام باقٍ لإعادة الحساب (القاعدة 20)»
// (plan/PLAN-05-EVIDENCE-REPORT.md :208). هذا الملفّ يجمع **كل** حدّ يقوم عليه حرف أو بوّابة أو شرط ثبات بالشكل {value, label, source} نفسه الذي في
// findings.js:thresholdSet، ويحمل رقم نسخة واحداً. الحدّان القديمان (vsyncLockCombinedFraction وlowCategoryCoverageFraction) **يُستوردان من findings.js** لا يُنسخان.
//
// ما لا يفعله: لا يختم تقريراً بنسخته (ختم `thresholdSet` في كل تقرير = بند S-P6-26 «جزئي» الذي لا يُمسّ في هذا الأمر؛ P6 :1065-1067)، ولا يتغيّر `findings.thresholdSet` نفسه
// (يقرؤه categoryStates.js وbuildV7Payload.js وعيّنات ذهبية مجمَّدة). تغيير أيّ حدّ هنا ⟵ ارفع THRESHOLD_SET_VERSION: test/advisoryLetters.test.js يحرس بصمة المجموعة.

const crypto = require('crypto');
const {thresholdSet: legacyThresholdSet, UNSTABLE_CV_THRESHOLD_PCT} = require('./findings');
const {TENTATIVE, THERMAL_STATUS} = require('./featureNames');

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
};

const THRESHOLD_SET_VERSION = 1;

const entry = (value, label, source) => ({value, label, source});
const PLATFORM = 'منصّة';

const thresholds = deepFreeze({
  // ─── موروثان من findings.js (مصدر واحد: القاعدة 24) ────────────────────────
  vsyncLockCombinedFraction: legacyThresholdSet.vsyncLockCombinedFraction,
  lowCategoryCoverageFraction: legacyThresholdSet.lowCategoryCoverageFraction,

  // ─── شرط الثبات (P5 §١-د-٢ :157-163، §٢-أ.4 :251-255) ────────────────────────
  unstableCvPct: entry(UNSTABLE_CV_THRESHOLD_PCT, TENTATIVE,
      'findings.js UNSTABLE_CV_THRESHOLD_PCT (د-٤ ✓ معتمد مؤقّتاً)؛ P5 :159 «CV داخل الجهاز ≤ 15%»'),
  minRepeatedScans: entry(3, TENTATIVE,
      'P5 :373 «الفحوص الثلاثة لكل طراز هي بروتوكول [P03 §٤.٤ البند 2] نفسه (3 فحوص على جهاز واحد)» — أدنى عدد فحوص مكرّرة تُقبل لتقدير CV وثبات الحرف (اختيار S-B5a للرقم من هذا السطر)'),

  // ─── المعالج (P5 §١-د-١ :145) ──────────────────────────────────────────────
  cpuCeilingA: entry(0.90, TENTATIVE, 'P5 :145 «السقف ≥ 0.90» [P04 M4: «≥ 0.90 سليم · 0.75–0.90 يخنق»]'),
  cpuRecoveryA: entry(0.90, TENTATIVE, 'P5 :145 «التعافي ≥ 0.90» [P04 M4: «التعافي < 0.9 «لا يتعافى»»]'),
  cpuCeilingB: entry(0.75, TENTATIVE, 'P5 :145 «السقف ≥ 0.75» ⟵ B؛ وC ما دون ذلك؛ «ولا D من السقف» (د-٠-د)'),

  // ─── الحرارة (P5 §١-د-١ :146) ──────────────────────────────────────────────
  thermalHeadroomSevere: entry(1.0, TENTATIVE, 'P5 :146 «headroom < 1.0» ⟵ A و«headroom ≥ 1.0» ⟵ B؛ AOSP: «headroom 1.0 = SEVERE» [خبير §٦]؛ وموضع حدّ A/B عند SEVERE اجتهاد (P5 :146)'),
  thermalStatusSevere: entry(THERMAL_STATUS.SEVERE, PLATFORM, 'PowerManager.THERMAL_STATUS_SEVERE = 3 (P5 :146 «دون SEVERE» ⟵ A؛ «SEVERE (3)» ⟵ B)'),
  thermalStatusCritical: entry(THERMAL_STATUS.CRITICAL, PLATFORM, 'PowerManager.THERMAL_STATUS_CRITICAL = 4 (P5 :146 «CRITICAL (4)» ⟵ C)'),
  thermalStatusEmergency: entry(THERMAL_STATUS.EMERGENCY, PLATFORM, 'PowerManager.THERMAL_STATUS_EMERGENCY = 5 (P5 :146 «EMERGENCY أو SHUTDOWN (≥ 5)» ⟵ D)'),

  // ─── التخزين (P5 §١-د-١ :147) ──────────────────────────────────────────────
  storageCollapseRatio: entry(0.5, TENTATIVE, 'P5 :147 «النسبة ≥ 0.5 أو لا ركبة» ⟵ A و«النسبة < 0.5» ⟵ B [P04 M6: «< 0.5 = انهيار»]'),
});

// ترتيب المفاتيح ثابت (JSON.stringify) فالبصمة حتمية.
function thresholdSetFingerprint() {
  return crypto.createHash('sha256').update(JSON.stringify({version: THRESHOLD_SET_VERSION, thresholds})).digest('hex');
}

module.exports = {THRESHOLD_SET_VERSION, thresholds, thresholdSetFingerprint};
