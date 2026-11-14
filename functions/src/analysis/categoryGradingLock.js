'use strict';

// categoryGradingLock.js — مصدر الحقيقة الوحيد لحقيقة واحدة كانت بمفردتين
// بلا مصدر يربطهما (القاعدة 24 — انجراف A102 بصيغة رابعة، رُصِد ومُصلِح في
// مهمّة 2026-09-21 +03، القرار ٤٤): "فئة البطارية مقفولة عن إنتاج حرف حتى
// تُعايَر عتبة PLAN-03 (batteryLayer.js) — بقرار، لا بغياب قياس".
//
// ─── الحالة قبل هذه المهمّة (مُتحقَّق منها، لا من الذاكرة) ────────────────
//   categoryStates.js:423   noLetterReason = 'NO_CALIBRATED_THRESHOLD (...)'
//                            نصّ خام، يُقرأ عبر categoryAbsenceReason
//                            (buildDisplayShapeV7.js) ويظهر حرفياً في
//                            display.categories.battery.reason — **معروض
//                            للمستخدم**، يحمل إحالة بشرية "انظر batteryLayer.js".
//   buildV7Payload.js:443   rejectedReason = 'CATEGORY_GRADING_LOCKED'
//                            رمز تصنيف، يُقارَن برمجياً في audit.adjustments[]
//                            (سبب رفض تعديل نموذج حاول تخفيض حرف بطارية).
// نفس الحقيقة، مفردتان، بلا استيراد مشترك — هذا ما يخالف القاعدة 24 حرفياً
// (بالضبط كما "v7_findings_based" قبل pipelineTags.js).
//
// ─── لماذا ثابتان لا ثابت واحد (تحذير المستخدم صريح في نصّ المهمّة) ──────
// المفردتان ليستا متطابقتين وظيفياً: واحدة نصّ معروض بإحالة بشرية،
// والأخرى رمز يُقارَن برمجياً (=== 'CATEGORY_GRADING_LOCKED' في اختبارات
// buildV7Payload.test.js وفي أي قارئ مستقبلي لـaudit.adjustments[].rejectedReason).
// اختزال أحدهما في الآخر (مثلاً استخراج الرمز من بادئة النصّ، أو بناء
// النصّ من الرمز) يغيّر شكل حقل معروض فعلياً أو سلوك مقارنة برمجية قائمة —
// كلاهما ممنوع بلا قرار مستخدم صريح (القرار ١/٧). فالمصدر الواحد هنا يحمل
// الاثنين **مرتبطين بالتعليق أعلاه وبالتصدير المشترك**، بلا تغيير حرف واحد
// في أيٍّ منهما عمّا كان مبعثراً في الملفّين.
//
// بلا أي require هنا (بنمط pipelineTags.js) — ثابتان نصّيان صرفان، لا
// حاجة لأي وحدة أخرى لبنائهما.

// الرمز — يُقارَن برمجياً. buildV7Payload.js (applyV7Adjustments) يكتبه
// في audit.adjustments[].rejectedReason حين النموذج يحاول تخفيض حرف فئة
// البطارية ولا حرف أساس لها لأن القفل بقرار (canGrade=false) لا لأن
// القياس غاب (القاعدة 21 — التمييز بنصّ السبب لا بصنف الحالة).
const CATEGORY_GRADING_LOCKED_CODE = 'CATEGORY_GRADING_LOCKED';

// النصّ — معروض للمستخدم (display.categories.battery.reason عبر
// categoryAbsenceReason في buildDisplayShapeV7.js). يحمل إحالة بشرية صريحة
// ("انظر batteryLayer.js") لا معنى لها في سياق مقارنة برمجية. **قيمة
// معروضة — نُقلت هنا بلا تعديل حرف واحد فيها؛ أي تغيير لاحق في نصّها شأن
// قرار مستخدم صريح (القرار ١/٧)، لا تنظيف كود.**
const CATEGORY_GRADING_LOCKED_TEXT =
    'NO_CALIBRATED_THRESHOLD (PLAN-03 لم يُنجَز — انظر batteryLayer.js)';

module.exports = {CATEGORY_GRADING_LOCKED_CODE, CATEGORY_GRADING_LOCKED_TEXT};
