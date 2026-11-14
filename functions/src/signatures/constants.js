// V4 hardening: PIPELINE_VERSION is baked into every signature. Bumping it
// invalidates ALL prior signature-cache hits across all users — production
// code never compares this string directly (runAnalysisInternal.js:135-139
// compares the STORED value to the newly COMPUTED one; signatureDifference.js:14
// does the same) — only test/signature.test.js:56-57 pins the literal, so it
// must move in the same commit as any bump here (القاعدة 39-بامتدادها).
//
// ~~When the lab Layer 1+2+3 pipeline lands, change this to "v4-layer123"~~
// — لم يعد ذلك القرار سارياً: `src/prompts/systemPromptV4.js` ("V4 SYSTEM
// PROMPT — Layer 1+2+3 architecture") غير مُستورَد من أي ملفّ في هذا
// المستودع (تحقّق: grep صفر نتيجة) — كود ميت، لم يصر المسار الحيّ. المسار
// الحيّ اليوم هو V7 (findings-based، buildDisplayShapeV7.js) — بنية مختلفة
// تماماً عمّا توقّعه هذا التعليق.
//
// أمر مستخدم 2026-09-24 +03 (القرار ٧٦ البند ٣، الجولة الثانية): "ارفع
// PIPELINE_VERSION... ولا تختر قيمة تساوي 'v4-layer123' (يُصادم synthetic
// value مُختلَق في signature.test.js:59 لاختبار عدم التطابق — لو ساواه
// PIPELINE_VERSION الحقيقي لصار ذلك الاختبار يقارن قيمة بنفسها) ولا
// 'other-version-forces-miss' (v7SwitchProductionPathCounters.test.js:173،
// نفس السبب على اختبار آخر)." لم يصلني نصّ سبب هذا الرفع تحديداً (أيّ تغيير
// في القياس/الحمولة يستدعي إبطال كل الكاش) — فاخترت تسمية محايدة موسومة
// بتاريخ القرار بدل نصّ يدّعي سبباً معمارياً لم أتحقّق منه (القاعدة 13):
const PIPELINE_VERSION = "v4-2026-09-24-decision-76-3";

module.exports = {PIPELINE_VERSION};
