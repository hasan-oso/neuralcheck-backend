// ===================================================
// v7ContractFieldMap.js — مصدر واحد مُصدَّر لقائمة حقول عقد شكل V7
// (القرار ٣٤ + القاعدة 25 + القاعدة 24 — قيمة حرفية يقوم عليها تمييز
// لها حكم رقم القياس: مصدر واحد، لا نسخة في كل ملفّ)
// ===================================================
//
// الغرض: docs/V7_DISPLAY_SHAPE_CONTRACT.md §٠-٣ جداول Markdown — نصّ بشري
// لا يُختبَر آلياً (تحليل جدول Markdown بالتعبير النمطي هو بالضبط ما جعل
// حارس A102 يمرّ بلا أن يفحص شيئاً فعلياً). هذا الملفّ هو ما يُختبَر فعلاً:
// functions/test/v7ContractFieldsGuard.test.js يقارنه بمخرَج
// buildV7ResponseForStorage(buildDisplayShapeV7(...).display) + العملياتية
// (V7_OPERATIONAL_FIELDS) في الاتّجاهين معاً — حقل في هذا الملفّ وليس في
// المخرَج الفعلي (عقد ميّت)، وحقل في المخرَج الفعلي وليس في هذا الملفّ
// (تسريب صامت للتطبيق، نفس عطب aiModel/deviceMarketingName). الجداول في
// docs/V7_DISPLAY_SHAPE_CONTRACT.md وصف بشري يجب أن يبقى مطابقاً لهذا
// الملفّ يدوياً — التطابق الآلي الوحيد المضمون هو بين هذا الملفّ والكود.
//
// ما لا يفعله هذا الملفّ عمداً:
//   - لا يُعدِّد categories.battery.indicators حقلاً حقلاً. العيّنة الحقيقية
//     (functions/test/fixtures/golden/v7-client-payload-sample.json) تُظهر
//     أربعة مؤشّرات (BAT-THERMAL-EFF/BAT-R-APPARENT/BAT-FCC/BAT-COULOMB،
//     batteryLayer.js:207-210) تتشارك id/status/verdict/gate (مُتحقَّق:
//     batteryLayer.js:57-63 دوال abstain()/measured() المشتركة) لكن تختلف
//     فيما وراءها — بل gate نفسها تختلف مفاتيحها حتى *داخل* المؤشّر
//     الواحد بحسب فرع الامتناع (BAT-COULOMB: {n} في batteryLayer.js:158
//     مقابل {qIntMah, required, passes} في batteryLayer.js:160). value/unit
//     حاضران فقط حين status==="MEASURED" — الاستثناء الوحيد:
//     BAT-FCC/DESIGN_PINNED (batteryLayer.js:148-151) وهو ABSTAINED لكنه
//     يحمل value بلا unit. تعداد هذا حقلاً حقلاً هنا كان سيخترع مخطَّطاً
//     ثابتاً لا وجود له — indicators تبقى حقلاً "مُبهَماً" (OPAQUE): الحارس
//     يتحقّق من وجود المفتاح نفسه فقط، لا مما بداخله.
//     ⚠️ تحديث 2026-09-22 +03 (مهمّة لاحقة، سدّ فجوة §٣ "مستوى الشحن لكل
//     مؤشّر") — batteryLayer.js صار يُرفِق socAtWindowStart/socAtWindowEnd
//     على كل مؤشّر من الأربعة (راجع رأس batteryLayer.js). هذا **لا يغيّر**
//     القرار أعلاه: الحقلان الجديدان يقعان *داخل* الكائن المُبهَم نفسه
//     (كل عنصر indicators.<ID>)، فيبقيان خارج نطاق هذا الملفّ/الحارس تماماً
//     كبقيّة حقول المؤشّر — لا حاجة لتعديل OPAQUE_FIELDS ولا
//     v7ContractFieldsGuard.test.js (تحقّق مباشر بتشغيل فعلي بعد الإضافة:
//     130/130 assertions passed دون أي تعديل هنا).
//   - لا يحمل حقول audit (measuredCategoriesMean/gatesApplied/adjustments/
//     disputed/categoryLlmSuggestedLetters/crossChecks/modelObservations/
//     issueSetHash/lettersHash/numbersHash) — هذه لا تصل buildV7ResponseForStorage
//     أصلاً (القرار ٤+٦: تُحفَظ في aiAudit منفصلاً، لا تُعرض) فلا معنى
//     لحراستها هنا — راجع docs/V7_DISPLAY_SHAPE_CONTRACT.md §٤.
//
// 'OPAQUE' أدناه علامة اصطلاحية (لا قيمة بيانات حقيقية) يقرؤها الحارس
// ليتوقّف عن النزول داخل الحقل، لا قيمة يُتوقَّع ظهورها في أي كائن حقيقي.
'use strict';

const OPAQUE = '__V7_CONTRACT_OPAQUE__';

// الحقول الجذر — analyzeDevice.js:120-169 (buildV7ResponseForStorage) +
// analyzeDevice.js:638-643 (V7_OPERATIONAL_FIELDS مُلحَقة فوق الإرجاع فقط،
// v7OperationalFields.js). 12 حقلاً.
const ROOT_FIELDS = Object.freeze([
  'pipeline', 'language', 'overall', 'categories', 'issues', 'narrative',
  'narrativeIncomplete', 'narrativeIncompleteFields',
  'shortId', 'isFreeTrial', 'aiModel', 'deviceMarketingName',
]);

// display.overall — buildDisplayShapeV7.js:265-278 (الكائن الحرفي) +
// analyzeDevice.js:130-143 (buildV7ResponseForStorage — نفس المفاتيح
// حرفياً، دفاع في العمق). كلاهما يبني كل المفاتيح أدناه بلا شرط — حاضرة
// دائماً، القيمة وحدها قد تكون null (القاعدة 22: غياب المفتاح شيء، قيمته
// null شيء آخر).
const OVERALL_FIELDS = Object.freeze([
  'letter', 'letterSource', 'coverage', 'coveragePct', 'partialAssessment',
  'partialAssessmentTag', 'governingGateReason', 'noDataAtAll',
  'zeroMeasuredMessage', 'abstentionReasons', 'harnessError', 'harnessErrorReason',
  // S3 (أمر مستخدم 2026-10-01 +03) — حقل ثالث عشر جديد، جملة عرض عربية
  // جاهزة بجوار harnessErrorReason الخامّ (يبقى بلا تغيير).
  'harnessErrorMessage',
]);

// كائنان مُتداخلان داخل overall — غير null فقط حين تُبنى فعلياً
// (buildDisplayShapeV7.js:271 partialAssessmentTag تمريرة من categoryStates؛
// buildDisplayShapeV7.js:272/184-196 buildGoverningGateReason) — يُحرَسان
// بشكلهما حين != null، لا كل تشغيلة (تعتمد على السيناريو).
const PARTIAL_ASSESSMENT_TAG_FIELDS = Object.freeze(['label', 'coveragePct', 'text']);
// S1 (أمر مستخدم 2026-10-01 +03) — `text` حقل رابع جديد: جملة عرض عربية
// جاهزة (buildDisplayShapeV7.js:buildGoverningGateDisplayText)، بلا اسم
// البوّابة ولا مصدرها الخام. `name`/`source` يبقيان — للّوحة الإدارية،
// لا للعرض للمشتري (قرار عرض في طبقة العميل، لا حذف حقل هنا).
const GOVERNING_GATE_REASON_FIELDS = Object.freeze(['name', 'ceilingLetter', 'source', 'text']);

// شكل استثنائي موثَّق (أمر مستخدم 2026-09-30 +03، البند ٦ — governingGateReason
// لا يُرمى استثناء حين letterSource يسمّي بوّابة ولا عنصر gatesApplied يثبتها
// بمعيار الحاكمية؛ buildDisplayShapeV7.js buildGoverningGateReason). عندها
// الشكل الطبيعي الثلاثي أعلاه يصير أربعة حقول: ceilingLetter/source يصيران
// null، وstatus='UNMATCHED' يُضاف. **مُتحقَّق بالبناء أن هذا الفرع غير واقع
// اليوم على أيّ مُدخل حقيقي** (راجع تعليق buildGoverningGateReason) — فلا
// فِخّ ذهبي (عيّنة JSON مجمَّدة) يُمارسه، ولا يفحصه v7ContractFieldsGuard.test.js
// (ذاك يفحص عيّنة S10 الحقيقية GATE:ROOT_DETECTED، الشكل الطبيعي وحده).
// الثابت هنا توثيقي/استعدادي — مُختبَر مباشرة في buildDisplayShapeV7.test.js
// عبر كسر مُختلَق (mutation)، لا عيّنة مجمَّدة.
// S1: text=null مُضاف هنا أيضاً (خامساً) — تعارض داخلي لا جملة عربية له
// (القاعدة 22)، راجع تعليق buildGoverningGateReason.
const GOVERNING_GATE_REASON_UNMATCHED_FIELDS = Object.freeze(['name', 'ceilingLetter', 'source', 'status', 'text']);

// display.categories.<cat> — الحقول المشتركة بين الفئات الـ15 كلّها.
// buildDisplayShapeV7.js (buildCategoryDisplay) + analyzeDevice.js
// (buildCategoryEntryForStorage). 9 حقول (كانت 8 — letterCeilingReason
// أُضيف بأمر المهمّة 2026-09-22 +03، البند الثاني — راجع تعليق
// buildCategoryLetterCeilingReason في buildDisplayShapeV7.js للتمييز عن
// `reason`: ذاك سبب *امتناع* عن حرف، هذا سبب *تسقيف* حرف موجود فعلاً).
const CATEGORY_COMMON_FIELDS = Object.freeze([
  'state', 'letter', 'letterSource', 'adjustmentReason', 'adjustmentEvidence',
  'coverage', 'reason', 'letterCeilingReason', 'testIds',
]);

// letterCeilingReason حين != null — كائن مُتداخل بثلاثة حقول، بنفس نمط
// GOVERNING_GATE_REASON_FIELDS أعلاه (overall.governingGateReason) لكن
// `text` بدل `source`: هذا نصّ **عرض بشري** جاهز، لا نصّاً تقنياً (ذلك
// يبقى في audit.gatesApplied[].source كما كان — لا تغيير هناك).
const CATEGORY_LETTER_CEILING_REASON_FIELDS = Object.freeze(['name', 'ceilingLetter', 'text']);

// حقول إضافية على categories.battery فقط — buildDisplayShapeV7.js:146-154
// (confidence/tag/indicators) + buildDisplayShapeV7.js:302-309
// (socAtStart/socAtEnd، مُلحَقان بعد buildCategoryDisplay) +
// analyzeDevice.js:76-82 (buildCategoryEntryForStorage — نفس الخمسة).
// **لا تظهر على أي فئة غير battery** — مُتحقَّق: buildDisplayShapeV7.js:146
// `if (entry.category === 'battery')` وحيدة الشرط. 5 حقول.
const CATEGORY_BATTERY_EXTRA_FIELDS = Object.freeze([
  'confidence', 'tag', 'indicators', 'socAtStart', 'socAtEnd',
]);

// الحقول التي لا يُنزَل داخلها — راجع تعليق رأس الملفّ.
const OPAQUE_FIELDS = Object.freeze({
  'categories.battery.indicators': OPAQUE,
});

// display.issues[] بعد الطبقتين معاً — categoryStates.js:446-460
// (buildDeterministicIssues، الشكل الخام: evidence/evidenceUnit **غائبان
// فعلياً لا null** على عناصر DISC-*/POS-*، حاضران فقط على ISS-* عبر
// r.evidence/r.evidenceUnit) ثم buildDisplayShapeV7.js:206-212
// (buildIssuesDisplay — Object.assign يُبقي نفس الغياب، يضيف description
// فقط) ثم **التطبيع الفعلي** analyzeDevice.js:104-114 (buildIssueForStorage
// — يضمن المفاتيح السبعة كلّها حاضرة دائماً، evidence/evidenceUnit يسقطان
// null حين غائبين بدل أن يبقيا محذوفين). الشكل الذي يصل التخزين/العميل هو
// الشكل المُطبَّع (بعد analyzeDevice.js) — هذا ما يحرسه هذا الملفّ، لا شكل
// categoryStates.js/buildDisplayShapeV7.js الخام الأسبق في خط الأنابيب.
// 7 حقول.
const ISSUE_FIELDS = Object.freeze([
  'id', 'category', 'severity', 'title', 'evidence', 'evidenceUnit', 'description',
]);

// display.narrative — buildDisplayShapeV7.js:288-293 +
// analyzeDevice.js:144-153. buyerAdvice كائن مُتداخل بثلاثة حقول (القرار
// ٢٤) — قيمتها الحرفية (casual/gamer/photographer) مُستوردة من
// reportShapeV7.BUYER_ADVICE_PROFILES (مصدر مُصدَّر واحد، لا نسخة هنا —
// القاعدة 24).
const {BUYER_ADVICE_PROFILES} = require('./reportShapeV7');
const NARRATIVE_FIELDS = Object.freeze(['summary', 'details', 'verdict', 'buyerAdvice']);

// display.narrative كما **يصل العميل فعلياً** — S6 (أمر مستخدم 2026-10-01
// +03). حتى هذه المهمّة كان "سطحان لا ثلاثة" يعني أن NARRATIVE_FIELDS أعلاه
// يصف المخزون *والعائد* معاً بحقل واحد. S6 كسر هذا التطابق عمداً على
// narrative وحدها: aiResponseToSave/المستند يبقيان بأربعة الحقول (المصدر
// أعلاه بلا تغيير)، لكن الردّ الفعلي لعميل V7 — كلا الموقعين، analyzeDevice.js
// (stripNarrativeDetailsVerdictFromV7Response على مخرَج التحليل الحيّ
// والتقرير المخزون سلفاً) وverifyReport.js (buildV7Response، لا pickNarrative
// لـdetails/verdict أصلاً) — يحذف details/verdict قبل المغادرة. هذا الثابت
// يصف تلك النتيجة النهائية فقط، ولا يستبدل NARRATIVE_FIELDS (لا يزال يصف
// المخزون بدقّة). V6 غير معنيّ إطلاقاً — بنية مختلفة كلّياً (جذر aiResult لا
// narrative متداخلة، runAnalysisInternal.js).
const NARRATIVE_RETURNED_FIELDS = Object.freeze(['summary', 'buyerAdvice']);

module.exports = {
  OPAQUE,
  ROOT_FIELDS,
  OVERALL_FIELDS,
  PARTIAL_ASSESSMENT_TAG_FIELDS,
  GOVERNING_GATE_REASON_FIELDS,
  GOVERNING_GATE_REASON_UNMATCHED_FIELDS,
  CATEGORY_COMMON_FIELDS,
  CATEGORY_LETTER_CEILING_REASON_FIELDS,
  CATEGORY_BATTERY_EXTRA_FIELDS,
  OPAQUE_FIELDS,
  ISSUE_FIELDS,
  NARRATIVE_FIELDS,
  NARRATIVE_RETURNED_FIELDS,
  BUYER_ADVICE_PROFILES,
};
