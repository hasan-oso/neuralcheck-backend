'use strict';

// v7OperationalFields.js — القرار ٤٢ البند ٥ (A112، نصّ المستخدم حرفياً):
// "الحقول التشغيلية تصير قائمة مُعلَنة... التعداد يصير مُنفَذاً لا عُرفاً —
// كما صار وسم pipeline بـpipelineTags.js." هذا الملف هو ذلك المصدر الوحيد
// (بنفس نمط pipelineTags.js)، لا نسخة نصّية في كل ملفّ (القاعدة 24 —
// توسيعها المُقرَّر في هذه المهمّة: كل قيمة حرفية يقوم عليها تمييز، لا أرقام
// القياس وحدها).
//
// ─── ما هي "الحقول التشغيلية" ────────────────────────────────────────────
// حقول لا تنتمي إلى `display` (buildDisplayShapeV7.js — السرد/الدرجات
// المُشتقّة من findings/categoryStates) لكن التطبيق يحتاجها فعلياً في
// استجابة `analyzeDevice` نفسها: معرِّفات وأعلام تشغيلية، لا حكماً على
// الجهاز. ثلاثة الأربعة مُضافة صراحةً فوق `aiResponseToSave` في
// `analyzeDevice.js` منذ مهامّ سابقة (A106/A108)؛ الرابع (`deviceMarketingName`)
// كان "غائباً من الاستجابة المُعادة للعميل" — رصدٌ مُوثَّق في
// docs/V7_DISPLAY_SHAPE_CONTRACT.md §٠-٣ قبل هذه المهمّة — أُغلق هنا (راجع
// analyzeDevice.js).
//
// ─── مصدر كل حقل (مُتحقَّق منه بالكود، لا بالذاكرة) ──────────────────────
//   shortId              — معرِّف التقرير القصير (رمز QR/رابط) — ليس جزءاً
//                          من الحكم على الجهاز.
//   isFreeTrial          — التطبيق يستعملها لإخفاء PDF/QR (تعليق analyzeDevice.js).
//   aiModel              — A108: `AiScoringEngine.kt:305` يقرؤه (منقول من
//                          رسالة المنسّق، لم يُتحقَّق منه في هذا المستودع —
//                          خارج حدود وكيل الباك اند، راجع docs/V7_DISPLAY_SHAPE_CONTRACT.md §٠-٣).
//   deviceMarketingName  — A112: الاسم التسويقي المعروض للمستخدم (احتياطي
//                          rawDeviceModel إن غاب من مخرَج النموذج).
//
// **اختبار انحدار يحرس هذه القائمة**: functions/test/aiAuditWiring.e2e.test.js
// (حالة "الأسطح الثلاثة") — يتحقّق أن كل مفتاح top-level في استجابة العميل
// V7 إمّا من `display` (مُشتقّ عبر buildV7ResponseForStorage) أو من هذه
// القائمة بالضبط، لا ثالثاً صامتاً (نمط A106/A108: حقل يُضاف للإرجاع بلا
// تسجيل في أي قائمة).
const V7_OPERATIONAL_FIELDS = Object.freeze(['shortId', 'isFreeTrial', 'aiModel', 'deviceMarketingName']);

module.exports = {V7_OPERATIONAL_FIELDS};
