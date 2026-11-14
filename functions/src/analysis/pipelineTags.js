'use strict';

// pipelineTags.js — مصدر الحقيقة الوحيد لعلامتَي pipeline اللتين تُميّزان
// شكل تقرير V6 عن V7 عبر النظام. القاعدة 5 مخالَفة سابقاً في نصّ أمر
// المهمّة (2026-09-21 +03): القيمة "v7_deterministic" ذُكرت هناك اختراعاً
// لا نقلاً عن ملف — لا وجود لها في هذا المستودع، لا اليوم ولا قبل هذه
// المهمّة (تحقّق: grep على functions/src قبل هذا الملف، صفر نتيجة). القيمة
// الوحيدة التي كتبها الكاتب (callAI.js → runAnalysisInternal.js →
// analyzeDevice.js) وقرأها القارئ (verifyReport.js) دائماً هي
// "v7_findings_based" أدناه — محسومة، لا سؤال مفتوح.
//
// سلسلة الكتابة/القراءة الفعلية (مُتحقَّق منها بـgrep على functions/src،
// لا من الذاكرة):
//   الكاتب: callAI.js (callAIv7 تُعيد pipeline) →
//           runAnalysisInternal.js (تتبنّى القيمة في متغيّر `pipeline`) →
//           analyzeDevice.js (تكتب report.pipeline في المستند)
//   القارئ: verifyReport.js (تقرأ report.pipeline لتقرّر شكل V7 مقابل V6)
// buildDisplayShapeV7.PIPELINE_TAG منفصل عن هذه السلسلة — يكتب
// aiResponse.pipeline (حقل متداخل داخل شكل العرض)، لا report.pipeline
// (الحقل الجذر الذي يقرؤه verifyReport.js). كلا الثابتين يُشتقّان من هنا
// الآن كي لا ينجرف أحدهما عن الآخر بلا رصد.
//
// بلا أي require هنا عمداً: تُحمَّل من verifyReport.js (دالّة HTTP عامة
// بلا مصادقة، على مسار البداية الباردة) — لا يجوز أن يجرّ استيرادها وحدة
// التحليل كاملةً (callAI/callDeepSeek/callGemini/buildV7Payload/...) معها.

const V7_PIPELINE_TAG = 'v7_findings_based';
const V6_PIPELINE_TAG = 'v6_raw_timeseries';

// أمر مستخدم 2026-09-24 +03 (القرار ٧٦ البند ٣، الجولة الثانية) — جرد
// المدقّق: "cached" كانت حرفية مكرَّرة (runAnalysisInternal.js:246 يكتبها،
// ولا مصدر مُصدَّر واحد لها) — نفس فصيلة V7_PIPELINE_TAG/V6_PIPELINE_TAG
// أعلاه (القاعدة 24، توسيعها: كل قيمة حرفية يقوم عليها تمييز). هذه ليست
// V6 ولا V7 — قيمة ثالثة مستقلّة يكتبها runAnalysisInternal.js وحده حين
// يُعاد استعمال تقرير سابق بلا نداء نموذج جديد (raية داخلية على مخرَج
// runAnalysisInternal، لا تصل report.pipeline المخزون ولا aiResponse.pipeline
// — مُتحقَّق: v7SwitchProductionPathCounters.test.js:253 "إشارة داخلية، لا
// تصل aiResponse.pipeline المخزون"). قرّاء الوسم في NeuralChek/wepsite بعد
// الفحص — خارج حدود هذا المستودع، لم تُمَسّ.
const CACHED_PIPELINE_TAG = 'cached';

module.exports = {V7_PIPELINE_TAG, V6_PIPELINE_TAG, CACHED_PIPELINE_TAG};
