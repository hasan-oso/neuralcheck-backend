// ===================================================
// sampleInputsFromRaw — يستخرج مُدخلات طبقة البطارية (٤-ج) من fingerprint
// خام واحد (P1.4، PLAN-01-ROADMAP.md §١٤ "A98" + القائمة الملزمة، البند ٢)
// ===================================================
//
// حتى الآن (قبل هذا الملف) كانت هذه الدالّة تعيش بنسختين متطابقتين تقريباً
// في test/categoryStates.test.js:35-48 و test/batteryLayer.test.js:32-44 —
// بخلاف طفيف بينهما (اسم الحقل sampleInputs/inputs، وحارس المصفوفة الفارغة
// موجود في نسخة categoryStates.test.js فقط). النصّ الملزم: "اكتب
// sampleInputsFromRaw في src/ لا في الاختبارات... الاختبارات تستورده من
// src/ بعدها، ولا تحتفظ بنسختها."
//
// هذا الملف هو النسخة الوحيدة القانونية الآن. الشكل المُعتمَد هو شكل
// categoryStates.test.js (الأغنى: حارس المصفوفة الفارغة + {sampleInputs,
// design})، و batteryLayer.test.js عُدِّل ليطابقه (انظر تقرير المهمّة).
//
// ─── ما هذا الملف لا يفعله ──────────────────────────────────────────────
// لا يقرأ Storage ولا Firestore. مُدخله دائماً كائن JS كامل العيّنات في
// الذاكرة — سواء وصل من fingerprint فحص حيّ (analyzeDevice/runConsistency
// Test، العيّنات موجودة أصلاً) أو من إعادة بناء بعد جلب من Storage
// (rehydrateReportFingerprint في هذا المجلّد، الملف المجاور). الفصل مقصود:
// دالّة استخراج نقية لا تعرف مصدر بياناتها.
// ===================================================

'use strict';

/**
 * يستخرج مُدخلات البطارية الخام (n, t, ph, temp, volt, cur, lvl) وسعة
 * التصميم من fingerprint خام واحد — سواء بصيغة {timeSeries: {...}} (كما
 * يصل من التطبيق) أو صيغة مسطَّحة {samples, footer} (كما تحمله بعض
 * السلاسل الزمنية المنقولة من rebuld/). لا يرمي أبداً: مدخل بلا عيّنات
 * يُعيد sampleInputs: null بدل رمي استثناء أو اختلاق مصفوفات فارغة.
 *
 * @param {Object} raw fingerprint أو timeSeries خام
 * @return {{sampleInputs: (Object|null), design: (number|null)}}
 */
function sampleInputsFromRaw(raw) {
  const ts = (raw && raw.timeSeries) || {};
  const samples = ts.samples || (raw && raw.samples) || [];
  const footer = ts.footer || (raw && raw.footer) || {};
  if (!Array.isArray(samples) || !samples.length) {
    return {sampleInputs: null, design: null};
  }
  const n = samples.length;
  const t = samples.map((s) => s.v[0]);
  const ph = samples.map((s) => s.phase);
  const col = (idx) => samples.map((s) => s.v[idx]);
  return {
    sampleInputs: {n, t, ph, temp: col(1), volt: col(2), cur: col(3), lvl: col(4)},
    design: (footer.batteryHealth && footer.batteryHealth.designCapacityMah) || null,
  };
}

module.exports = {sampleInputsFromRaw};
