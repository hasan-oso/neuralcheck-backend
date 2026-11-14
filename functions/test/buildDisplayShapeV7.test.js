'use strict';

// buildDisplayShapeV7.test.js — P1.5 البند ١ (PLAN-01-ROADMAP.md §🔒 قرارات
// شكل الاستجابة، القرارات ١-١٦). يختبر src/analysis/buildDisplayShapeV7.js
// كوحدة قائمة بذاتها — بلا استدعاء نموذج، بلا استهلاك من runAnalysisInternal
// (ذلك التبديل خارج نطاق هذه المهمّة — راجع تقرير المهمّة).
//
// فحصان حقيقيان (golden، بنفس فِخّاخ categoryStates.test.js):
//   b45c8cf6  S10 مجذَّر — GATE:ROOT_DETECTED، coverage=45%، letter=C
//   e4b65a2f  Honor — functionalResults=null (404 حقيقي) → HARNESS_ERROR
// وقسم اصطناعي واحد معلَّم صراحةً: NO_DATA (noDataAtAll بلا HARNESS_ERROR)
// — لا فِخّ حقيقي لهذه الحالة في هذا المستودع (نفس ملاحظة categoryStates.test.js).
//
// Run: node functions/test/buildDisplayShapeV7.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates, CATEGORY_WEIGHTS} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {CATEGORIES} = require('../src/utils/categories');
const {
  buildDisplayShapeV7, PIPELINE_TAG,
  _internal: {
    categoryAbsenceReason, buildGoverningGateReason,
    buildCategoryLetterCeilingReason, buildLowCoverageCeilingDisplayText, arabicTestCount,
  },
} = require('../src/analysis/buildDisplayShapeV7');
const {FORBIDDEN_TOP_LEVEL_KEYS} = require('../src/analysis/reportShapeV7');
const {applyV7Adjustments, ADJUSTMENT_ACCEPTED_NO_EFFECT} = require('../src/analysis/buildV7Payload');
const {GOVERNING_GATE_REASON_UNMATCHED_FIELDS} = require('../src/analysis/v7ContractFieldMap');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} — got ${a}, want ~${b} (±${tol})`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// إعداد — نفس بصمتَي categoryStates.test.js/categoryStatesWiring.test.js
// ═══════════════════════════════════════════════════════════════════════
const s10Raw = loadJson('b45c8cf6.ts.json');
const honorRaw = loadJson('e4b65a2f-honor.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
ok(Array.isArray(s10Functional) && s10Functional.length === 85, 'إعداد: S10(b45c8cf6) 85 عنصر functionalResults حقيقي');

const s10Fp = {device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const honorFp = {device: {}, timeSeries: honorRaw.timeSeries || honorRaw, functionalResults: null, manualResults: []};

const s10Findings = computeFindings(s10Fp);
const honorFindings = computeFindings(honorFp);
const s10Inputs = sampleInputsFromRaw(s10Raw);
const honorInputs = sampleInputsFromRaw(honorRaw);

const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
});
const honorCategoryStates = computeCategoryStates({
  functionalResults: null, manualResults: [], dev: null, findings: honorFindings,
  batterySampleInputs: honorInputs.sampleInputs, batteryDesignCapacityMah: honorInputs.design,
});

// aiAnalysis V7 بسيط — narrative فقط بوصف عطب واحد حقيقي من S10
// (DISC-T-03)، لإثبات مسار الدمج (issueDescriptions) دون نداء نموذج.
// القاعدة 23 — DISC-T-01 ⇐ DISC-T-03 (أمر مستخدم 2026-09-27 +03 «الإعدادات
// لا تُنزل الحرف»): T-01/T-02 صارا healthBearing=false (THERMAL_UNCALIBRATED_IDS)
// فلم يعودا يُنتجان عنصراً في categoryStates.issues — DISC-T-01 صار معرّفاً
// لا وجود له، فيفشل الدمج المُختبَر. T-03 خارج المجموعات الثلاث الجديدة.
const s10AiAnalysis = {
  narrative: {
    summary: 'ملخّص اختباري — لا نموذج حقيقي',
    details: 'تفصيل اختباري',
    verdict: 'حكم اختباري',
    buyerAdvice: {casual: 'نصيحة عادية اختبارية', gamer: 'نصيحة ألعاب اختبارية', photographer: 'نصيحة تصوير اختبارية'},
    issueDescriptions: {'DISC-T-03': 'وصف اختباري لعطب T-03 من النموذج'},
  },
  crossChecks: [{description: 'تحقّق تبادلي اختباري', evidenceRefs: ['findings.thermal']}],
  adjustments: [],
  modelObservations: [{text: 'ملاحظة نموذج اختبارية', evidenceRefs: ['findings.battery']}],
};

// ═══════════════════════════════════════════════════════════════════════
// 1. golden-real — S10 (b45c8cf6): GATE:ROOT_DETECTED، letter=C، coverage=45%
// ═══════════════════════════════════════════════════════════════════════
{
  const {display, audit} = buildDisplayShapeV7({
    categoryStates: s10CategoryStates, findings: s10Findings,
    aiAnalysis: s10AiAnalysis, language: 'ar',
  });

  eq(display.pipeline, PIPELINE_TAG, '[S10] display.pipeline = v7_findings_based');
  eq(display.pipeline, 'v7_findings_based', '[S10] القيمة الحرفية مطابقة لاسم مسار callAIv7 نفسه (callAI.js)');

  // القرار ٥ — كسر نظيف: صفر حقل V6 في أي مستوى من display (بناءً، لا حذفاً).
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    ok(!(forbidden in display), `[القرار ٥][S10] display لا يحمل الحقل الممنوع "${forbidden}" (V6/reportShapeV7.FORBIDDEN_TOP_LEVEL_KEYS)`);
  }
  ok(!('issues' in display) || Array.isArray(display.issues), '[القرار ٥][S10] display.issues (إن وُجد) مصفوفة حتمية، لا قائمة V6 مسطَّحة بلا معرّفات');

  // القرار ١٦ + ١٠ — letterSource وcoverage بالتعريف الجديد، تمريرة مباشرة
  eq(display.overall.letter, 'C', '[S10] letter=C (جذر مكشوف، ROOT_DETECTED يسقف)');
  eq(display.overall.letterSource, 'GATE:ROOT_DETECTED', '[القرار ١٦][S10] letterSource يسمّي البوّابة الحاكمة، لا PATCH_AGE (الثانية بلا أثر فعلي)');
  // القاعدة 23 — القيم المرجعية 0.4503809523809524/45/45 ⇐
  // 0.4587142857142857/45.9/45.9 (أمر مستخدم 2026-09-27 +03 «الإعدادات لا
  // تُنزل الحرف»): SEC-01/05/06/07 وCM-08 وT-01/T-02 خرجت من
  // declaredHb/executed (computeHealthBearingStats)، فتغيّر مقام تغطية
  // overall نفسه. قيم مقيسة بتشغيل مباشر (buildDisplayShapeV7 على نفس
  // المُدخل)، لا مكتوبة يدوياً.
  near(display.overall.coverage, 0.4587142857142857, 0.0001, '[القرار ١٠][S10] coverage = تمريرة مباشرة من categoryStates (البطارية مستبعَدة: coverage=100% لكن letter=null)');
  eq(display.overall.coveragePct, 45.9, '[S10] coveragePct = 45.9 (مطابق لِـ partialAssessmentTag.coveragePct)');
  eq(display.overall.partialAssessment, true, '[القرار ١][S10] partialAssessment=true (تغطية 45.9% < 60%)');
  deepEq(display.overall.partialAssessmentTag, {label: 'تقييم جزئي', coveragePct: 45.9, text: 'تقييم جزئي — تغطية 45.9%'},
      '[القرار ١][S10] partialAssessmentTag يحمل الرقم دائماً بجوار الوسم — لا "تقييم جزئي" بلا نسبة');

  // القرار ١٦ — governingGateReason يفسّر letterSource بلا استنتاج من القارئ
  // S1 (أمر مستخدم 2026-10-01 +03) — `text` حقل رابع جديد، جملة عرض عربية
  // (name/source الخامّان يبقيان بلا تغيير — للّوحة، القاعدة 8).
  // S-1 (أمر مستخدم 2026-10-01 +03، القسم ٥) — بلا "في هذا الإصدار" — ليست
  // قيداً مؤقّتاً (راجع buildGoverningGateDisplayText).
  deepEq(display.overall.governingGateReason,
      {name: 'ROOT_DETECTED', ceilingLetter: 'C', source: 'SEC-04=fail',
        text: 'أعلى حرف C: صلاحيات الجذر (الروت) مكتشَفة على الجهاز.'},
      '[القرار ١٦][S1][S10] governingGateReason={name,ceilingLetter,source,text} من gatesApplied — لا استنتاج، حقل صريح');

  // القرار ٧ — ليست حالة "صفر MEASURED" هنا (S10 لديه فئات MEASURED فعلاً)
  eq(display.overall.noDataAtAll, false, '[S10] noDataAtAll=false — توجد فئات MEASURED فعلياً');
  eq(display.overall.zeroMeasuredMessage, null, '[القرار ٧][S10] zeroMeasuredMessage=null — الحالة لا تنطبق');
  eq(display.overall.abstentionReasons, null, '[القرار ٧][S10] abstentionReasons=null — لا تُبنى إلا عند zeroMeasuredMessage');

  // القرار ١٢/١٣ — ليست HARNESS_ERROR
  eq(display.overall.harnessError, false, '[S10] harnessError=false');
  eq(display.overall.harnessErrorReason, null, '[S10] harnessErrorReason=null');
  // S3 (أمر مستخدم 2026-10-01 +03) — ليست حالة تعذّر تجهيز، فالجملة الجاهزة
  // غائبة صراحةً (null)، لا السلسلة الفارغة.
  eq(display.overall.harnessErrorMessage, null, '[S3][S10] harnessErrorMessage=null — ليست HARNESS_ERROR');

  // القرار ٦ — measuredCategoriesMean لا يصل display إطلاقاً
  ok(!('measuredCategoriesMean' in display.overall), '[القرار ٦][S10] measuredCategoriesMean غائب تماماً من display.overall (لا حتى null) — القرار ٦ حرفياً');
  ok(!('score' in display.overall), '[القرار ٦][S10] overall.score غائب — الاسم الممنوع نفسه لا يظهر ولو بقيمة مختلفة');

  // القرار ٢ — كل فئة تحمل state+reason؛ فئة بحرف فعلي → reason=null
  eq(Object.keys(display.categories).length, 15, '[S10] كل الفئات الـ15 حاضرة في display.categories');
  for (const cat of CATEGORIES) {
    const entry = display.categories[cat];
    ok(entry && typeof entry.state === 'string', `[القرار ٢][S10] categories.${cat}.state حاضر (لا حذف صامت)`);
    if (entry.letter === null) {
      ok(typeof entry.reason === 'string' && entry.reason.length > 0,
          `[القرار ٢][S10] categories.${cat}: letter=null → reason نصّي غير فارغ (لا إخفاء صامت)`);
    } else {
      eq(entry.reason, null, `[القرار ٢][S10] categories.${cat}: letter موجود → reason=null (لا امتناع)`);
    }
  }
  eq(display.categories.cpu.state, 'MEASURED', '[S10] cpu: MEASURED فعلياً (فِخّ حقيقي)');
  eq(display.categories.cpu.letter, 'A', '[S10] cpu letter=A (100% نجاح، لا بوّابة على cpu)');
  // القاعدة 23 — PARTIAL ⇐ MEASURED (أمر مستخدم 2026-09-27 +03 «الإعدادات
  // لا تُنزل الحرف»، نفس سبب categoryStates.test.js:397 بالضبط): بعد
  // استبعاد SEC-01/05/06/07 من healthBearing، تغطية الأمان صارت 6/6=100%
  // (بدل 9/10=90%) — MEASURED لا PARTIAL. letter يبقى D (STATE_FAIL_FLOOR
  // من SEC-04 وحدها، بلا تغيير).
  eq(display.categories.security.state, 'MEASURED', '[S10] security: MEASURED (6/6 اختبارات صحّية مُنفَّذة بعد استبعاد SEC-01/05/06/07، تغطية 100%)');
  eq(display.categories.security.letter, 'D', '[S10] security letter=D (STATE_FAIL_FLOOR — SEC-04=fail يفرض D على الفئة نفسها، قبل بوّابات overall)');

  // ═════════════════════════════════════════════════════════════════════
  // letterCeilingReason — أمر المهمّة 2026-09-22 +03 (البند الثاني).
  // القاعدة 30 — يُختبَر النصّ الفعلي (الدلالة)، لا مجرّد != null (الوصول).
  // أربع فئات حقيقية على b45c8cf6 (بصمة هذا القسم كلّه)، الأربعة أُثبتت
  // بتشغيل مباشر لـ computeCategoryStates قبل كتابة هذا الاختبار (تقرير
  // المهمّة يذكر مصدرها) — لا نصّ مُخترَع:
  //   gpu      belowThreshold+allNonMeasurement (2/5) → النصّ الحالي (القرار
  //            ٧٥ البند ١، 2026-09-24 +03 — أعاد صياغة الجزء اللاحق على
  //            "X من Y"، لا العدد نفسه): "تغطية منخفضة — اختباران من خمسة،
  //            وحرف مسقوف: لم يُعتمد بعدُ أيّ من اختبارات هذه الفئة قياساً
  //            للحالة"
  //   gps      [تحديث القاعدة 23، أمر 2026-09-27 +03] كانت "نفس حالتَي gpu
  //            لكن executed=1" — L-01 (الاختبار الوحيد) صارت healthBearing
  //            =false («الإعدادات لا تُنزل الحرف»)، فـexecuted يُفرَغ
  //            تماماً (0 من 0 صحّية) وgps.state يصير UNMEASURED لا PARTIAL:
  //            letter=null وreason="DECLARED_BUT_NONE_EXECUTED"
  //            وletterCeilingReason=null — نفس نمط thermal (الامتناع لا
  //            التسقيف)، لا نمط gpu (حرف موجود مسقوف) بعد اليوم.
  //   display  allNonMeasurement فقط (3/3، تغطية 100% كافية عددياً) — لا
  //            بادئة "تغطية منخفضة" (ستكون كاذبة، التغطية ليست منخفضة)
  //   cpu      لا بوّابة أسقفت letter فعلياً → null (رغم NOT_FIRED واضح)
  //   security بوّابة FIRED فعلاً ([تحديث القاعدة 23] 100%، 6/6 STATE —
  //            كانت 90%، 9/9 قبل أمر 2026-09-27 +03) لكن cappedThisLetter=
  //            false (D أصلاً أسوأ من السقف B) → null أيضاً — يُثبت أن
  //            الفحص على cappedThisLetter لا status='FIRED' وحدها
  // ═════════════════════════════════════════════════════════════════════
  // S4 (أمر مستخدم 2026-10-01 +03) — النصّ اللاحق على "X من Y" أُعيدت
  // صياغته مجدَّداً (بلا "معتمد قياساً للحالة") — العدد نفسه لم يتغيّر.
  deepEq(display.categories.gpu.letterCeilingReason,
      {name: 'LOW_CATEGORY_COVERAGE', ceilingLetter: 'B',
        text: 'تغطية منخفضة — اختباران من خمسة، وأعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.'},
      '[البند٢][S4][S10] gpu.letterCeilingReason — النصّ بعد إعادة الصياغة (S4، 2026-10-01 +03؛ 2/5 — العدد لم يتغيّر)');
  // [تحديث القاعدة 23، أمر 2026-09-27 +03] gps.letter=null الآن (UNMEASURED
  // — L-01 خرجت من healthBearing) — نمط "امتناع" (thermal) لا "تسقيف" (gpu).
  eq(display.categories.gps.state, 'UNMEASURED', '[البند٢][S10] gps.state=UNMEASURED — L-01 كانت الاختبار الوحيد المنفَّذ، واستبعادها من healthBearing يُفرغ executed تماماً');
  eq(display.categories.gps.letter, null, '[البند٢][S10] gps.letter=null — لا اختبار صحّي مُنفَّذ');
  eq(display.categories.gps.reason, 'DECLARED_BUT_NONE_EXECUTED', '[البند٢][S10] gps.reason=DECLARED_BUT_NONE_EXECUTED');
  eq(display.categories.gps.letterCeilingReason, null,
      '[البند٢][S10] gps.letterCeilingReason=null — لا حرف أصلاً ليُسقَّف (الامتناع لا التسقيف، نفس نمط thermal)');
  deepEq(display.categories.display.letterCeilingReason,
      {name: 'LOW_CATEGORY_COVERAGE', ceilingLetter: 'B',
        text: 'ثلاثة اختبارات من ثلاثة — أعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.'},
      '[البند٢][S4][S10] display.letterCeilingReason — allNonMeasurement فقط، بلا بادئة "تغطية منخفضة" (100% كافية)');
  eq(display.categories.cpu.letterCeilingReason, null,
      '[البند٢][S10] cpu.letterCeilingReason=null — البوّابة NOT_FIRED (100%، يتضمّن MEASUREMENT)');
  eq(display.categories.security.letterCeilingReason, null,
      '[البند٢][S10] security.letterCeilingReason=null — البوّابة FIRED فعلاً لكن cappedThisLetter=false (D أصلاً أسوأ من B)، لا status وحده');
  // القرار ٢٥/القاعدة ٣٠ البند ٤ — letterCeilingReason (حرف موجود يُسقَّف)
  // وreason (حرف غائب فسبب غيابه) لا يتطويان أبداً على نفس الفئة.
  ok(display.categories.gpu.letter !== null && display.categories.gpu.reason === null &&
      display.categories.gpu.letterCeilingReason !== null,
  '[القاعدة٣٠][S10] gpu: letter موجود + reason=null + letterCeilingReason≠null — التسقيف لا الامتناع');
  ok(display.categories.thermal.letter === null && display.categories.thermal.reason !== null &&
      display.categories.thermal.letterCeilingReason === null,
  '[القاعدة٣٠][S10] thermal: letter=null + reason≠null + letterCeilingReason=null — الامتناع لا التسقيف (لا تداخل)');

  // القرار ٣ — البطارية: ثلاث درجات وصفية + ثقة، لا نسبة مئوية
  const bat = display.categories.battery;
  eq(bat.state, 'PARTIAL', '[S10] battery.state=PARTIAL (4/4 مؤشّرات محسوبة، لكن verdict غير كافٍ)');
  eq(bat.letter, null, '[القرار ٣][S10] battery.letter=null — لا عتبة مُعايَرة بعد (batteryLayer.js، PLAN-03)');
  eq(bat.reason, 'NO_CALIBRATED_THRESHOLD (PLAN-03 لم يُنجَز — انظر batteryLayer.js)',
      '[القرار ٢+٣][S10] battery.reason = noLetterReason حرفياً من categoryStates.js');
  eq(bat.confidence, null, '[القرار ٣][S10] battery.confidence=null (aggregate.judgment=غير كافية)');
  eq(bat.tag, 'ESTIMATED', '[S10] battery.tag=ESTIMATED (P1.2 §تعديل 2026-09-20)');
  ok(bat.indicators && Object.keys(bat.indicators).length === 4,
      '[القرار ٣][S10] battery.indicators تحمل المؤشّرات الأربعة بقيمها الفيزيائية (°C/Wh، mΩ، mAh) — ليست نسبة مئوية');
  ok(!('percent' in bat) && !('healthPct' in bat) && !('score' in bat),
      '[القرار ٣][S10] لا حقل نسبة مئوية على فئة البطارية بأي اسم');
  // الفرق الموثَّق عن نصّ الخطّة — راجع رأس buildDisplayShapeV7.js
  eq(bat.socAtStart, 48, '[فرق موثَّق][S10] battery.socAtStart = findings.battery.socAtStart (مستوى الفحص كلّه، لا لكل مؤشّر)');
  eq(bat.socAtEnd, 43, '[فرق موثَّق][S10] battery.socAtEnd = findings.battery.socAtEnd');

  // القرار ٤ — llmSuggestedLetter/adjustments/disputed تصل audit فقط
  ok(!('llmSuggestedLetter' in bat), '[القرار ٤][S10] llmSuggestedLetter غائب من display.categories.battery');
  for (const cat of CATEGORIES) {
    ok(!('llmSuggestedLetter' in display.categories[cat]), `[القرار ٤][S10] llmSuggestedLetter غائب من display.categories.${cat}`);
  }
  ok(!('adjustments' in display.overall) && !('disputed' in display.overall),
      '[القرار ٤][S10] overall.adjustments/disputed غائبان من display.overall — audit فقط');
  deepEq(audit.adjustments, [], '[القرار ٤][S10] audit.adjustments موجود (مصفوفة فارغة — لا تعديلات في هذا الفحص)');
  eq(audit.disputed, false, '[القرار ٤][S10] audit.disputed موجود = false');
  eq(Object.keys(audit.categoryLlmSuggestedLetters).length, 15, '[القرار ٤][S10] audit.categoryLlmSuggestedLetters يحمل الـ15 فئة (كلّها null هنا)');
  ok(Object.values(audit.categoryLlmSuggestedLetters).every((v) => v === null),
      '[S10] لا اقتراح نموذج مخالف مسجَّل في هذا الفحص (لا adjustments)');

  // القرار ٦ (تكملة) — measuredCategoriesMean يصل audit كما هو
  // القاعدة 23 — 100 ⇐ 93.58974358974359 (أمر مستخدم 2026-09-27 +03 —
  // نفس سبب كل الاستبدالات أعلاه: security دخلت المتوسّط لأوّل مرّة
  // بدرجتها 83.33 بعد صيرورتها MEASURED).
  eq(audit.measuredCategoriesMean, 93.58974358974359, '[القرار ٦][S10] audit.measuredCategoriesMean=93.58974358974359 (متوسّط MEASURED وحدها — محفوظ للتدقيق)');
  // كان 5 (البوّابات الخمس الأصلية) — صار 19 بعد إضافة LOW_CATEGORY_COVERAGE
  // (أمر المهمّة 2026-09-22 +03، البند ١): بوّابة واحدة **لكل فئة غير
  // البطارية** (14 فئة × 1) + الخمس الأصلية = 19. لا حذف صامت (بند 3
  // categoryStates.js يبقى كما هو) — كل فئة تحمل حالتها (FIRED/NOT_FIRED)
  // صراحة، حتى حين لا تُسقِف شيئاً.
  eq(audit.gatesApplied.length, 19, '[S10] audit.gatesApplied يحمل البوّابات الخمس الأصلية + LOW_CATEGORY_COVERAGE لكل فئة (14) = 19 — لا حذف صامت (بند 3 categoryStates.js)');
  eq(audit.issueSetHash, s10CategoryStates.issueSetHash, '[S10] audit.issueSetHash = categoryStates.issueSetHash حرفياً');
  eq(audit.lettersHash, s10CategoryStates.lettersHash, '[S10] audit.lettersHash = categoryStates.lettersHash حرفياً');
  eq(audit.numbersHash, s10CategoryStates.numbersHash, '[S10] audit.numbersHash = categoryStates.numbersHash حرفياً');
  deepEq(audit.crossChecks, s10AiAnalysis.crossChecks, '[S10] audit.crossChecks تمريرة مباشرة من aiAnalysis');
  deepEq(audit.modelObservations, s10AiAnalysis.modelObservations, '[قرار 8][S10] audit.modelObservations تمريرة مباشرة — للمراجع لا للمشتري (لا تصل display)');
  ok(!('modelObservations' in display) && !('crossChecks' in display),
      '[قرار 8][S10] modelObservations/crossChecks غائبان من display — audit فقط');

  // narrative + issues — دمج وصف النموذج بمعرّف حقيقي (DISC-T-03، بعد
  // استبدال DISC-T-01 أعلاه — القاعدة 23)
  eq(display.narrative.summary, 'ملخّص اختباري — لا نموذج حقيقي', '[S10] narrative.summary تمريرة مباشرة من aiAnalysis.narrative');
  deepEq(display.narrative.buyerAdvice,
      {casual: 'نصيحة عادية اختبارية', gamer: 'نصيحة ألعاب اختبارية', photographer: 'نصيحة تصوير اختبارية'},
      '[القرار ٢٤][S10] narrative.buyerAdvice كائن بثلاثة ملفّات، كلٌّ تمريرة مباشرة من aiAnalysis.narrative.buyerAdvice');
  ok(!('issueDescriptions' in display.narrative), '[S10] narrative.issueDescriptions لا يظهر في narrative — يُدمَج داخل issues[] بدلاً من ذلك');
  eq(display.issues.length, s10CategoryStates.issues.length, '[S10] display.issues بنفس طول categoryStates.issues الحتمية (النموذج لا يؤلّف قائمة)');
  const t03 = display.issues.find((i) => i.id === 'DISC-T-03');
  ok(t03, '[S10] DISC-T-03 حاضر في display.issues (حتمي من categoryStates.js، لا من النموذج)');
  eq(t03.description, 'وصف اختباري لعطب T-03 من النموذج', '[S10] DISC-T-03.description مُدمَج من narrative.issueDescriptions["DISC-T-03"]');
  const otherIssue = display.issues.find((i) => i.id !== 'DISC-T-03');
  eq(otherIssue.description, null, '[S10] عطب حتمي بلا وصف من النموذج → description=null، لا نصّ مُختلَق');

  // القرار ٤٢ البند ٣ (letterSource، جلسة لاحقة) — بلا adjustments (حالة
  // s10AiAnalysis أعلاه: adjustments=[])، كل فئة تحمل letter من الحرف
  // الحتمي مباشرة، فـletterSource يجب أن يكون DETERMINISTIC للجميع —
  // ولا شيء تحته.
  for (const cat of CATEGORIES) {
    eq(display.categories[cat].letterSource, 'DETERMINISTIC',
        `[القرار ٤٢/٣][S10][بلا adjustments] categories.${cat}.letterSource=DETERMINISTIC`);
    eq(display.categories[cat].adjustmentReason, null,
        `[القرار ٤٢/٣][S10][بلا adjustments] categories.${cat}.adjustmentReason=null`);
    eq(display.categories[cat].adjustmentEvidence, null,
        `[القرار ٤٢/٣][S10][بلا adjustments] categories.${cat}.adjustmentEvidence=null`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ١-ب. القرار ٤٢ (A62 + letterSource، جلسة لاحقة 2026-09-21 +03) — الترتيب
//    الحقيقي المُلزِم (راجع docs/V7_DISPLAY_SHAPE_CONTRACT.md §٢): DOWN
//    مقبول عبر applyV7Adjustments (buildV7Payload.js) *قبل* buildDisplayShapeV7،
//    لا استدعاء buildDisplayShapeV7 مباشرة على categoryStates الخام كما في
//    القسم ١ أعلاه (adjustments=[] هناك — DETERMINISTIC فقط، لا يختبر
//    LLM_ADJUSTED إطلاقاً). هذا القسم يختبر السلسلة الحقيقية كاملة على S10:
//    computeCategoryStates → applyV7Adjustments(DOWN حقيقي على cpu) →
//    buildDisplayShapeV7 — يُثبت أن letter المعروض هو finalLetter (بعد
//    التعديل)، لا deterministicLetter (قبل التعديل)، وأن letterSource/
//    adjustmentReason/adjustmentEvidence تصل display فعلاً لا audit فقط.
// ═══════════════════════════════════════════════════════════════════════
{
  // القرار ٤٢ البند ٢ (جولة لاحقة — "الباب يُغلق") — evidenceRefs يجب أن
  // تحمل قيمة مُثبَتة بمفردة مُعلَنة (status=FIRED/outcome=FAIL/حرف C-D)،
  // لا رقماً خاماً من findings.sustainedCeiling كما كان سابقاً.
  //
  // ⚠️ **استُبدل الدليل — القاعدة 23/القرار ٨٨ البند ٣** ("دليل التخفيض
  // يُربط بالفئة المخفَّضة نفسها"): كان هذا القسم يستشهد بـ
  // security.deterministicLetter (فئة أخرى) على تخفيض cpu — ذلك بالضبط
  // النمط عبر-الفئات الذي صار يُرفَض الآن (EVIDENCE_WRONG_CATEGORY) قبل
  // بلوغ أي فحص لاحق. القصد هنا فحص letterSource/adjustmentReason في
  // display بعد DOWN مقبول فعلاً — لا خصوصية مصدر الدليل — فالبديل دليل
  // اصطناعي مُعلَّم من فئة cpu نفسها (لا FAIL/FIRED حقيقي من cpu على هذا
  // الفِخّ، مُتحقَّق في buildV7Payload.test.js) يحفظ نفس القصد.
  eq(s10CategoryStates.categories.cpu.deterministicLetter, 'A', 'مسبق: cpu=A على S10 قبل أي تعديل');
  const cpuTestResultsWithFail = [
    ...s10CategoryStates.testResults,
    {category: 'cpu', testId: 'C-SYNTHETIC-FAIL', outcome: 'FAIL', kind: 'STATE', healthBearing: true},
  ];
  const s10CategoryStatesWithCpuFail = {...s10CategoryStates, testResults: cpuTestResultsWithFail};
  const PROVEN_CPU_FAIL_REF = `categoryStates.testResults[${cpuTestResultsWithFail.length - 1}].outcome`;
  const adjustedCategoryStates = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'اختبار letterSource'},
  ], s10Findings);

  const {display: adjDisplay} = buildDisplayShapeV7({
    categoryStates: adjustedCategoryStates, findings: s10Findings,
    aiAnalysis: s10AiAnalysis, language: 'ar',
  });

  eq(adjDisplay.categories.cpu.letter, 'B',
      '[القرار ٤٢/٢][A62][السلسلة الحقيقية] cpu.letter المعروض = finalLetter بعد DOWN (B)، لا deterministicLetter الأصلي (A)');
  eq(adjDisplay.categories.cpu.letterSource, 'LLM_ADJUSTED',
      '[القرار ٤٢/٣][السلسلة الحقيقية] cpu.letterSource=LLM_ADJUSTED بعد DOWN مقبول');
  eq(adjDisplay.categories.cpu.adjustmentReason, 'اختبار letterSource',
      '[القرار ٤٢/٣][السلسلة الحقيقية] cpu.adjustmentReason يصل display فعلاً (لا audit فقط)');
  deepEq(adjDisplay.categories.cpu.adjustmentEvidence, [PROVEN_CPU_FAIL_REF],
      '[القرار ٤٢/٣][السلسلة الحقيقية] cpu.adjustmentEvidence يصل display فعلاً');
  // فئة أخرى لم تُعدَّل — تبقى DETERMINISTIC، ولا يتسرّب تعديل cpu إليها.
  eq(adjDisplay.categories.security.letterSource, 'DETERMINISTIC',
      '[القرار ٤٢/٣][السلسلة الحقيقية] security (لم تُعدَّل) تبقى letterSource=DETERMINISTIC');
  eq(adjDisplay.categories.security.adjustmentReason, null,
      '[القرار ٤٢/٣][السلسلة الحقيقية] security.adjustmentReason=null (لم تُعدَّل)');
}
console.log('تحقّق ١-ب [القرار ٤٢]: السلسلة الحقيقية applyV7Adjustments→buildDisplayShapeV7 — letter المعروض=finalLetter، letterSource/adjustmentReason/adjustmentEvidence تصل display فعلاً');

// ═══════════════════════════════════════════════════════════════════════
// ١-ج. القرار ٩٨ البند ١ (2026-09-25 +03، نصّ المستخدم حرفياً، **مطلوب
//    صراحةً**): "اختبار: تخفيض فئة حرفها D بالأرضية يُسجَّل «مقبولاً بلا
//    أثر»، ولا يغيّر letterSource." السلسلة الحقيقية الكاملة (applyV7Adjustments
//    → buildDisplayShapeV7) على security (D فعلياً بأرضية STATE_FAIL_FLOOR
//    على S10 — مُتحقَّق أدناه) بدليل FAIL اصطناعي من فئتها هي نفسها.
// ═══════════════════════════════════════════════════════════════════════
{
  eq(s10CategoryStates.categories.security.deterministicLetter, 'D', 'مسبق: security=D على S10 (أرضية STATE_FAIL_FLOOR)');
  const securityTestResultsWithFail = [
    ...s10CategoryStates.testResults,
    {category: 'security', testId: 'SEC-SYNTHETIC-FAIL', outcome: 'FAIL', kind: 'STATE', healthBearing: true},
  ];
  const s10CategoryStatesWithSecurityFail = {...s10CategoryStates, testResults: securityTestResultsWithFail};
  const PROVEN_SECURITY_FAIL_REF = `categoryStates.testResults[${securityTestResultsWithFail.length - 1}].outcome`;
  const noEffectAdjustedCategoryStates = applyV7Adjustments(s10CategoryStatesWithSecurityFail, [
    {category: 'security', direction: 'DOWN', evidenceRefs: [PROVEN_SECURITY_FAIL_REF], reason: 'اختبار مقبول بلا أثر'},
  ], s10Findings);

  eq(noEffectAdjustedCategoryStates.overall.adjustments[0].applied, true,
      '[القرار ٩٨/١] audit.adjustments: applied=true — الدليل مُثبَت ومقبول فعلاً');
  eq(noEffectAdjustedCategoryStates.overall.adjustments[0].noEffectReason, ADJUSTMENT_ACCEPTED_NO_EFFECT,
      '[القرار ٩٨/١][مطلوب صراحةً] audit.adjustments: مُسجَّل "مقبولاً بلا أثر" (noEffectReason=ACCEPTED_NO_EFFECT)');
  eq(noEffectAdjustedCategoryStates.categories.security.adjustmentApplied, false,
      '[القرار ٩٨/١] categoryStates.categories.security.adjustmentApplied=false — لا اختلاف حرف');

  const {display: noEffectDisplay} = buildDisplayShapeV7({
    categoryStates: noEffectAdjustedCategoryStates, findings: s10Findings,
    aiAnalysis: s10AiAnalysis, language: 'ar',
  });

  eq(noEffectDisplay.categories.security.letter, 'D', '[القرار ٩٨/١] security.letter المعروض يبقى D');
  eq(noEffectDisplay.categories.security.letterSource, 'DETERMINISTIC',
      '[القرار ٩٨/١][مطلوب صراحةً] security.letterSource **لا يتغيّر** — يبقى DETERMINISTIC رغم قبول التعديل فعلياً (لا اختلاف حرف)');
  eq(noEffectDisplay.categories.security.adjustmentReason, null,
      '[القرار ٩٨/١] security.adjustmentReason=null على العرض (buildDisplayShapeV7 تُصفِّرها حين !adjustmentApplied، بصرف النظر عن وجودها على categoryStates)');
  eq(noEffectDisplay.categories.security.adjustmentEvidence, null,
      '[القرار ٩٨/١] security.adjustmentEvidence=null على العرض لنفس السبب');
}
console.log('تحقّق ١-ج [القرار ٩٨/١]: تخفيض فئة حرفها D بالأرضية (security على S10) يُسجَّل "مقبولاً بلا أثر" (noEffectReason)، وletterSource يبقى DETERMINISTIC — لا LLM_ADJUSTED');

// ═══════════════════════════════════════════════════════════════════════
// 2. golden-real — Honor (e4b65a2f): functionalResults=null → HARNESS_ERROR
//    القرار ١٢/١٣ — يجب ألّا يُقرأ كـ"صفر فئة MEASURED" (NO_DATA)
// ═══════════════════════════════════════════════════════════════════════
{
  const {display, audit} = buildDisplayShapeV7({
    categoryStates: honorCategoryStates, findings: honorFindings,
    aiAnalysis: {}, language: 'ar', // aiAnalysis فارغ عمداً — يثبت أن display لا يرمي بلا narrative
  });

  eq(display.overall.coverage, null, '[القرار ١٢][Honor] overall.coverage=null — لا 0% (تعذّر تجهيز، لا "قِيس ولم يُغطَّ شيء")');
  eq(display.overall.coveragePct, null, '[القرار ١٢][Honor] coveragePct=null بالتبعية (لا Math.round(null))');
  eq(display.overall.letter, null, '[Honor] letter=null (functionalResults=null لكل الفئات غير البطارية)');
  eq(display.overall.letterSource, 'HARNESS_ERROR', '[القرار ١٦][Honor] letterSource=HARNESS_ERROR — لا BAND ولا NO_DATA');
  eq(display.overall.governingGateReason, null, '[Honor] governingGateReason=null (letterSource لا يبدأ بـGATE:)');

  // ⚠️ الفحص الحاسم — القرار ١٣/A97#3: هذا تعذّر تجهيز، لا "لم يُقَس شيء".
  eq(display.overall.noDataAtAll, false, '[القرار ١٣][Honor] noDataAtAll=false صراحةً — categoryStates.js يميّزها عمداً عن NO_DATA');
  eq(display.overall.zeroMeasuredMessage, null,
      '[القرار ١٣][Honor] zeroMeasuredMessage=null رغم letter=null — "لم يُقَس شيء قابل للحكم" تخصّ noDataAtAll لا HARNESS_ERROR');
  eq(display.overall.abstentionReasons, null, '[Honor] abstentionReasons=null (لم تُبنَ — الشرط zeroMeasuredMessage لم يتحقّق)');
  eq(display.overall.harnessError, true, '[القرار ١٢/١٣][Honor] harnessError=true — يظهر في overall لا في categories.<x>.reason وحده (A97#2)');
  eq(display.overall.harnessErrorReason, 'FUNCTIONAL_RESULTS_UNAVAILABLE', '[Honor] harnessErrorReason مُسمّى صراحةً');
  // S3 (أمر مستخدم 2026-10-01 +03)، نصّ مُصحَّح (ملحق S-13، 2026-10-01 +03
  // لاحقاً — يطابق نصّ W6 الاحتياطي في الموقع حرفياً بقراءة المنسّق لكلمة
  // "يطابق"، راجع HARNESS_ERROR_MESSAGE_AR في categoryStates.js).
  eq(display.overall.harnessErrorMessage, 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص، وهذا ليس حكماً على الجهاز.',
      '[S3][Honor] harnessErrorMessage جملة عربية جاهزة بجوار الرمز الخامّ');

  // كل الفئات غير البطارية HARNESS_ERROR بسبب مُسمّى؛ البطارية مستقلّة
  // (تُحسَب من samples لا من functionalResults) فتبقى PARTIAL بقيمها.
  for (const cat of CATEGORIES) {
    if (cat === 'battery') continue;
    eq(display.categories[cat].state, 'HARNESS_ERROR', `[Honor] categories.${cat}.state=HARNESS_ERROR`);
    eq(display.categories[cat].reason, 'HARNESS_ERROR', `[القرار ٢][Honor] categories.${cat}.reason=HARNESS_ERROR (سبب مُسمّى، لا صمت)`);
  }
  eq(display.categories.battery.state, 'PARTIAL', '[Honor] battery مستقلّة عن functionalResults — لا تسقط في HARNESS_ERROR');
  eq(display.categories.battery.socAtStart, 75, '[Honor] battery.socAtStart من findings (Honor الحقيقي)');
  eq(display.categories.battery.socAtEnd, 72, '[Honor] battery.socAtEnd من findings');

  eq(display.issues.length, 1, '[Honor] issue واحد فقط: DISC-HARNESS_ERROR (تعذّر التجهيز، لا 15 عطب "غير مقيس")');
  eq(display.issues[0].id, 'DISC-HARNESS_ERROR', '[Honor] معرّف العطب الوحيد');
  eq(display.issues[0].description, null, '[Honor] لا وصف من النموذج (aiAnalysis={} في هذا الاختبار)');

  eq(display.narrative.summary, null, '[Honor] narrative.summary=null بأمان حين aiAnalysis.narrative غائب — لا رمي (typeof guard)');

  eq(audit.measuredCategoriesMean, null, '[Honor] audit.measuredCategoriesMean=null');
  eq(audit.issueSetHash, honorCategoryStates.issueSetHash, '[Honor] audit.issueSetHash حرفي من categoryStates');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. اصطناعي — NO_DATA (noDataAtAll=true بلا HARNESS_ERROR). القرار ٧.
//    لا فِخّ حقيقي لهذه الحالة في هذا المستودع (نفس ملاحظة categoryStates.test.js)
// ═══════════════════════════════════════════════════════════════════════
{
  const emptyCategoryStates = computeCategoryStates({
    functionalResults: [], manualResults: [], dev: null, findings: null,
    batterySampleInputs: null, batteryDesignCapacityMah: null,
  });
  ok(emptyCategoryStates.overall.noDataAtAll === true && emptyCategoryStates.overall.harnessError === false,
      '[اصطناعي] إعداد: functionalResults=[] (لا null) → noDataAtAll=true، harnessError=false — يفصل NO_DATA عن HARNESS_ERROR فعلياً');

  const {display} = buildDisplayShapeV7({
    categoryStates: emptyCategoryStates, findings: null, aiAnalysis: {}, language: 'ar',
  });

  eq(display.overall.letter, null, '[اصطناعي][القرار ٧] letter=null — صفر فئة MEASURED');
  eq(display.overall.letterSource, 'NO_DATA', '[اصطناعي][القرار ١٦] letterSource=NO_DATA (لا بوّابة أطلقت لتُنقذه)');
  eq(display.overall.noDataAtAll, true, '[اصطناعي] noDataAtAll=true');
  eq(display.overall.zeroMeasuredMessage, 'لم يُقَس شيء قابل للحكم',
      '[اصطناعي][القرار ٧] الرسالة الحرفية المنصوصة في PLAN-01 §🔒 القرار ٧');
  eq(display.overall.harnessError, false, '[اصطناعي] هذه NO_DATA لا HARNESS_ERROR — الفرق مقصود ومُختبَر');

  ok(Array.isArray(display.overall.abstentionReasons) && display.overall.abstentionReasons.length === 15,
      '[اصطناعي][القرار ٧] abstentionReasons تحمل الـ15 فئة كلّها (لا فئة أنتجت حرفاً)');
  for (const entry of display.overall.abstentionReasons) {
    ok(CATEGORIES.includes(entry.category), '[اصطناعي] كل عنصر abstentionReasons.category من الـ15 فئة المعروفة');
    ok(typeof entry.reason === 'string' && entry.reason.length > 0, `[اصطناعي] abstentionReasons[${entry.category}].reason نصّي غير فارغ`);
  }
  const thermalAbstention = display.overall.abstentionReasons.find((e) => e.category === 'thermal');
  eq(thermalAbstention.reason, 'NO_HEALTH_BEARING_TESTS_DECLARED', '[اصطناعي] thermal: declaredCount=0 → NO_HEALTH_BEARING_TESTS_DECLARED');
  const batteryAbstention = display.overall.abstentionReasons.find((e) => e.category === 'battery');
  eq(batteryAbstention.reason, 'HARNESS_ERROR', '[اصطناعي] battery: batterySampleInputs=null → نفس reason الذي تنتجه computeBatteryCategory (تسمية موروثة، موثَّقة لا مُصلَحة هنا)');

  // socAtStart/End يبقيان null بأمان حين findings=null (لا رمي)
  eq(display.categories.battery.socAtStart, null, '[اصطناعي] battery.socAtStart=null بأمان حين findings=null');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. categoryAbsenceReason/buildGoverningGateReason — وحدات داخلية، أمثلة يدوية
// ═══════════════════════════════════════════════════════════════════════
{
  eq(categoryAbsenceReason(null), null, '[وحدة] categoryAbsenceReason(null)=null بأمان');
  eq(categoryAbsenceReason({category: 'cpu', state: 'MEASURED', deterministicLetter: 'A'}), null,
      '[وحدة] فئة بحرف فعلي → لا سبب امتناع');
  eq(categoryAbsenceReason({category: 'cpu', state: 'ATTESTED_ONLY', deterministicLetter: null}), 'MANUAL_ATTESTATION_ONLY',
      '[وحدة] ATTESTED_ONLY → MANUAL_ATTESTATION_ONLY');
  eq(categoryAbsenceReason({category: 'cpu', state: 'UNMEASURED', deterministicLetter: null, declaredCount: 0}), 'NO_HEALTH_BEARING_TESTS_DECLARED',
      '[وحدة] UNMEASURED + declaredCount=0 → NO_HEALTH_BEARING_TESTS_DECLARED');
  eq(categoryAbsenceReason({category: 'cpu', state: 'UNMEASURED', deterministicLetter: null, declaredCount: 3, executedCount: 0}), 'DECLARED_BUT_NONE_EXECUTED',
      '[وحدة] UNMEASURED + declaredCount>0 + executedCount=0 → DECLARED_BUT_NONE_EXECUTED');

  eq(buildGoverningGateReason(null), null, '[وحدة] buildGoverningGateReason(null)=null بأمان');
  eq(buildGoverningGateReason({letterSource: 'BAND'}), null, '[وحدة] letterSource=BAND → null (لا بوّابة)');
  eq(buildGoverningGateReason({letterSource: 'NO_DATA'}), null, '[وحدة] letterSource=NO_DATA → null');
  // أمر مستخدم 2026-09-30 +03 (النقطة ١) — استُبدل هذا الاختبار (القاعدة 23)
  // بدل إضافة إلى جانبه: النسخة القديمة (بلا cappedOverall في المُدخل) كانت
  // تُثبت السلوك الخاطئ نفسه (أوّل مطابقة بالاسم، بصرف النظر عن الحاكمية) —
  // راجع كتلة "NC-TM7PDN" أدناه لإثبات الفشل/النجاح الفعليَّين.
  // S1 (أمر مستخدم 2026-10-01 +03) — text=null هنا: 'X' اسم بوّابة غير معروف
  // (لا حالة له في buildGoverningGateDisplayText — الأسماء الستّة الحقيقية
  // فقط). حقل حاضر دائماً (القاعدة 22) حتى حين لا نصّ متاح.
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:X', gatesApplied: [{name: 'X', ceilingLetter: 'D', source: 'src', cappedOverall: true}]}),
      {name: 'X', ceilingLetter: 'D', source: 'src', text: null},
      '[وحدة][S1] letterSource=GATE:X مع X (cappedOverall=true) في gatesApplied → {name,ceilingLetter,source,text:null} (اسم غير معروف)',
  );
  // سقف البطارية BATTERY_MAX_ONE_BAND (categoryStates.js:812/854) — بنية
  // {name, from, to} بلا حقل cappedOverall إطلاقاً، ويُدفَع إلى القائمة فقط
  // حين أسقف فعلاً (categoryStates.js:811 `if (capped !== rank)`) — الحضور
  // نفسه إثبات، فلا حاجة لحقل cappedOverall هنا كي يُختار بأمان.
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:BATTERY_MAX_ONE_BAND', gatesApplied: [
        {name: 'ROOT_DETECTED', ceilingLetter: 'C', source: 'SEC-04=pass', cappedOverall: false},
        {name: 'BATTERY_MAX_ONE_BAND', from: 'A', to: 'B'},
      ]}),
      {name: 'BATTERY_MAX_ONE_BAND', ceilingLetter: 'B', source: 'سقف البطارية: A → B',
        // S-4 (أمر مستخدم 2026-10-01 +03، القسم ٥) — نصّ جديد يحلّ محلّ القديم.
        text: 'أثر البطارية على الحرف العامّ لا يتجاوز حرفاً واحداً.'},
      '[وحدة][S1][S-4] letterSource=GATE:BATTERY_MAX_ONE_BAND — بنية {name,from,to} بلا cappedOverall تُقبَل (الحضور وحده إثبات)',
  );

  // S-2/S-5/S-6/S-7 (أمر مستخدم 2026-10-01 +03، القسم ٥) — الأربعة الباقية
  // من السبعة بوّابات معروفة الاسم؛ لا فِخّ ذهبي يُطلقها فعلياً (PATCH_AGE/
  // STORAGE_VERIFY_ERRORS/GPU_HASH_MISMATCH/SUSTAINED_CEILING، راجع تعليق
  // رأس buildGoverningGateDisplayText) — أمثلة يدوية مباشرة تُغلق فجوة
  // "غير مُختبَرة بعيّنة فعلية" الموثَّقة هناك (القاعدة 30)، إضافة من هذه
  // الجلسة لم تُؤمَر بها حرفياً لكنها ضرورية لإثبات صحّة النصوص الجديدة.
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:PATCH_AGE', gatesApplied: [
        {name: 'PATCH_AGE', ceilingLetter: 'B', status: 'FIRED', source: 'SEC-03=... (40.0 شهراً)', cappedOverall: true},
      ]}),
      {name: 'PATCH_AGE', ceilingLetter: 'B', source: 'SEC-03=... (40.0 شهراً)',
        text: 'أعلى حرف B: آخر رقعة أمان على الجهاز أقدم من 36 شهراً.'},
      '[وحدة][S-2] PATCH_AGE — الرقم من PATCH_AGE_MAX_MONTHS (categoryStates.js) لا حرفياً هنا',
  );
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:STORAGE_VERIFY_ERRORS', gatesApplied: [
        {name: 'STORAGE_VERIFY_ERRORS', ceilingLetter: 'D', status: 'FIRED', source: 'x', cappedOverall: true},
      ]}),
      {name: 'STORAGE_VERIFY_ERRORS', ceilingLetter: 'D', source: 'x',
        text: 'أعلى حرف D: أخطاء تحقّق في التخزين الداخلي.'},
      '[وحدة][S-5] STORAGE_VERIFY_ERRORS — بلا "في هذا الإصدار" (خاملة اليوم، NOT_WIRED)',
  );
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:GPU_HASH_MISMATCH', gatesApplied: [
        {name: 'GPU_HASH_MISMATCH', ceilingLetter: 'D', status: 'FIRED', source: 'x', cappedOverall: true},
      ]}),
      {name: 'GPU_HASH_MISMATCH', ceilingLetter: 'D', source: 'x',
        // S-6 (مُصحَّح 2026-10-01 +03) — "معالج الرسومات" يطابق اسم الفئة
        // المعتمَد (CATEGORY_NAME_AR.gpu) الآن — راجع تعليق المصدر.
        text: 'أعلى حرف D: عدم تطابق في التحقّق من معالج الرسومات.'},
      '[وحدة][S-6] GPU_HASH_MISMATCH — بلا "في هذا الإصدار" (خاملة اليوم، NOT_WIRED)',
  );
  deepEq(
      buildGoverningGateReason({letterSource: 'GATE:SUSTAINED_CEILING', gatesApplied: [
        {name: 'SUSTAINED_CEILING', ceilingLetter: 'C', status: 'FIRED', source: 'x', cappedOverall: true},
      ]}),
      {name: 'SUSTAINED_CEILING', ceilingLetter: 'C', source: 'x',
        text: 'أعلى حرف C: أداء المعالج لم يحافظ على مستواه تحت الحمل المستمرّ.'},
      '[وحدة][S-7] SUSTAINED_CEILING — بلا "في هذا الإصدار" (خاملة اليوم، DISABLED)',
  );

  // ─── NC-TM7PDN حقيقي (مشتقّ) — أمر مستخدم 2026-09-30 +03 («ملحق —
  // الجوابان، وقرار C-07 وS-06»): تصدير حقيقي وصل فعلاً (shortId=NC-TM7PDN،
  // شغّله المستخدم 2026-09-30 21:40 +03). **استُبدل هذا الاختبار (القاعدة
  // 23)** — كان يستعمل بيانات مُختلَقة موسومة صراحةً "لا تصدير NC-TM7PDN
  // الحقيقي (لم يُشغَّل بعد)"؛ الآن وصل، فيُستعمَل حرفياً لا تقليداً له.
  // المصدر: derived-from-NC-TM7PDN-governing-gate-reason-2026-09-30.json
  // (مشتقّ من الملفّ الحقيقي خارج هذا المستودع — راجع _meta داخل الملفّ
  // المشتقّ نفسه لمصدره الكامل وقائمة تعديلاته الثلاث؛ القاعدة 12).
  // العطب الحقيقي المُبلَّغ عنه فعلياً في الإنتاج (لا محاكاة): «المعروض في
  // /verify: LOW_CATEGORY_COVERAGE · السقف B · لا اختبار مُنفَّذ — الفئة
  // غير مقيسة أصلاً، البوّابة لا تنطبق» — نصّ gatesApplied[5] (thermal،
  // INPUT_ABSENT)، والسقف الفعلي من gatesApplied[7] (gpu، FIRED،
  // cappedOverall=true) — **مُتحقَّق بالتشغيل المباشر على الملفّ المشتقّ
  // نفسه أدناه، لا افتراضاً**.
  const ncTm7pdnReal = loadJson('derived-from-NC-TM7PDN-governing-gate-reason-2026-09-30.json');
  eq(ncTm7pdnReal.gatesApplied.length, 19, '[NC-TM7PDN حقيقي] 19 بوّابة — يطابق التصدير الحقيقي حرفياً (تحقّق برمجي وقت الاشتقاق، راجع _meta)');
  eq(ncTm7pdnReal.gatesApplied[5].category, 'thermal', '[NC-TM7PDN حقيقي] gatesApplied[5]=thermal كما ورد في نصّ العطب المُبلَّغ');
  eq(ncTm7pdnReal.gatesApplied[5].status, 'INPUT_ABSENT', '[NC-TM7PDN حقيقي] gatesApplied[5].status=INPUT_ABSENT (الأولى بالاسم، بلا أثر)');
  eq(ncTm7pdnReal.gatesApplied[7].category, 'gpu', '[NC-TM7PDN حقيقي] gatesApplied[7]=gpu كما ورد في نصّ العطب المُبلَّغ');
  eq(ncTm7pdnReal.gatesApplied[7].cappedOverall, true, '[NC-TM7PDN حقيقي][الأهمّ] gatesApplied[7].cappedOverall=true — الحاكمة الفعلية');
  deepEq(
      buildGoverningGateReason({letterSource: ncTm7pdnReal.overallLetterSource, gatesApplied: ncTm7pdnReal.gatesApplied}),
      {name: 'LOW_CATEGORY_COVERAGE', ceilingLetter: 'B', source: '2/2 اختبار منفَّذ من صنف STATE — صفر MEASUREMENT',
        text: 'أعلى حرف في هذا الإصدار B: لا توجد لكل الفئات قياسات أداء معتمدة بعد.'},
      '[وحدة][S1][NC-TM7PDN حقيقي] على بيانات جهاز حقيقي فعلياً: الحاكمة gpu (index 7، cappedOverall=true) لا أوّل مطابقة بالاسم thermal (index 5، INPUT_ABSENT) — ' +
      'يطابق ما كان يجب أن يُعرَض في /verify بدل النصّ الخاطئ الفعلي المُسجَّل (aiResponse.overall.governingGateReason.source="لا اختبار مُنفَّذ..." في الإنتاج)',
  );

  // حالة 0 مطابقة (cappedOverall=true) رغم letterSource يدّعي بوّابة —
  // تعارض داخلي. **استُبدل هذا الاختبار (القاعدة 23)**: كان يُثبت أن الدالّة
  // تَرمي (تصميم سابق، تجاوزه قرار المستخدم 2026-09-30 +03 البند ٦: "لا يُرمى
  // استثناء... تُكتب حالة صريحة... ويبقى التقرير حيّاً"). الآن تُثبت أنها
  // تُعيد حالة صريحة {name, ceilingLetter:null, source:null, status:'UNMATCHED'}
  // ولا ترمي — لا افتراض صامت (القاعدة 22) بلا إسقاط التقرير كلّه.
  const unmatchedResult = buildGoverningGateReason({letterSource: 'GATE:Y', gatesApplied: [
    {name: 'Y', ceilingLetter: 'B', status: 'NOT_FIRED', source: 'لا أثر', cappedOverall: false},
  ]});
  deepEq(
      unmatchedResult,
      {name: 'Y', ceilingLetter: null, source: null, status: 'UNMATCHED', text: null},
      '[وحدة][تعارض][S1] letterSource=GATE:Y بلا أيّ عنصر cappedOverall=true بالاسم نفسه → حالة صريحة UNMATCHED، لا رمي ولا اختيار افتراضي (القاعدة 22)',
  );
  deepEq(Object.keys(unmatchedResult).sort(), [...GOVERNING_GATE_REASON_UNMATCHED_FIELDS].sort(),
      '[وحدة][تعارض][القاعدة 25] مفاتيح الشكل الفعلي تطابق v7ContractFieldMap.GOVERNING_GATE_REASON_UNMATCHED_FIELDS حرفياً — لا انجراف بين العقد والتنفيذ');

  // أمر المهمّة 2026-09-22 +03 (البند الثاني) — arabicTestCount/
  // buildLowCoverageCeilingDisplayText/buildCategoryLetterCeilingReason،
  // أمثلة يدوية بمُدخلات مُختلَقة (بجانب فحوصات القيمة على S10 الحقيقي
  // أعلاه في القسم ١).
  deepEq(arabicTestCount(1), {withNoun: 'اختبار واحد', bare: 'واحد'}, '[وحدة] arabicTestCount(1)');
  deepEq(arabicTestCount(2), {withNoun: 'اختباران', bare: 'اثنين'}, '[وحدة] arabicTestCount(2) — صيغة المثنّى');
  deepEq(arabicTestCount(5), {withNoun: 'خمسة اختبارات', bare: 'خمسة'}, '[وحدة] arabicTestCount(5)');
  deepEq(arabicTestCount(12), {withNoun: 'اثنا عشر اختباراً', bare: 'اثني عشر'}, '[وحدة] arabicTestCount(12) — أقصى declaredCount حقيقي مُتحقَّق منه (sensors)');
  deepEq(arabicTestCount(25), {withNoun: '25 اختباراً', bare: '25'}, '[وحدة] arabicTestCount(25) — خارج الجدول (0-20) → رقم خام، لا قواعد نحوية أعقد');

  // S4 (أمر مستخدم 2026-10-01 +03) — وسيط خامس جديد (ceilingLetter)، ونصّ
  // لاحق على "X من Y" مُعاد صياغته (بلا "معتمد قياساً للحالة").
  eq(buildLowCoverageCeilingDisplayText(2, 5, true, true, 'B'), 'تغطية منخفضة — اختباران من خمسة، وأعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.',
      '[وحدة][S4] buildLowCoverageCeilingDisplayText: كلا الشرطين');
  eq(buildLowCoverageCeilingDisplayText(1, 3, true, true, 'B'), 'تغطية منخفضة — اختبار واحد من ثلاثة، وأعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.',
      '[وحدة][S4] buildLowCoverageCeilingDisplayText: كلا الشرطين، executed=1 (العدد وحده يتغيّر)');
  eq(buildLowCoverageCeilingDisplayText(3, 3, false, true, 'B'), 'ثلاثة اختبارات من ثلاثة — أعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.',
      '[وحدة][S4] buildLowCoverageCeilingDisplayText: allNonMeasurement فقط، بلا بادئة "تغطية منخفضة"');
  eq(buildLowCoverageCeilingDisplayText(4, 10, true, false, 'B'), 'تغطية منخفضة — أربعة اختبارات من عشرة',
      '[وحدة][S4] buildLowCoverageCeilingDisplayText: belowThreshold فقط — بلا جملة نوع الاختبار (حافة غير مُتحقَّقة على بيانات حقيقية، مُختبَرة يدوياً)');

  eq(buildCategoryLetterCeilingReason(null), null, '[وحدة] buildCategoryLetterCeilingReason(null)=null بأمان');
  eq(buildCategoryLetterCeilingReason({gatesApplied: []}), null, '[وحدة] gatesApplied=[] → null');
  eq(buildCategoryLetterCeilingReason({gatesApplied: [
    {name: 'LOW_CATEGORY_COVERAGE', status: 'FIRED', cappedThisLetter: false, ceilingLetter: 'B', belowThreshold: true, allNonMeasurement: false},
  ]}), null, '[وحدة] FIRED لكن cappedThisLetter=false → null (لم يُسقِّف فعلياً)');
  eq(buildCategoryLetterCeilingReason({gatesApplied: [
    {name: 'ROOT_DETECTED', status: 'FIRED', cappedThisLetter: true, ceilingLetter: 'C'},
  ]}), null, '[وحدة] بوّابة مُسقِّفة فعلاً لكن ليست LOW_CATEGORY_COVERAGE → null (نطاق هذه المهمّة صراحة)');
  deepEq(buildCategoryLetterCeilingReason({
    executedCount: 2, declaredCount: 5,
    gatesApplied: [{name: 'LOW_CATEGORY_COVERAGE', status: 'FIRED', cappedThisLetter: true, ceilingLetter: 'B', belowThreshold: true, allNonMeasurement: true}],
  }), {name: 'LOW_CATEGORY_COVERAGE', ceilingLetter: 'B', text: 'تغطية منخفضة — اختباران من خمسة، وأعلى حرف لهذه الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.'},
  '[وحدة][S4] بوّابة LOW_CATEGORY_COVERAGE مُسقِّفة فعلاً → {name,ceilingLetter,text}');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. اصطناعي — governingGateReason UNMATCHED عبر buildDisplayShapeV7 الكاملة
//    (لا buildGoverningGateReason وحدها). تصحيح المستخدم 2026-09-30 +03،
//    البند ٦: "لا يُرمى استثناء ... ويبقى التقرير حيّاً". مبنيّ فوق S10
//    الحقيقي (letterSource/gatesApplied مُتّسقان فعلاً هناك) مع كسر واحد
//    مقصود ومُختلَق لإثبات أن التقرير كلّه — لا حقل واحد فقط — يبقى يُبنى.
// ═══════════════════════════════════════════════════════════════════════
{
  const brokenOverall = JSON.parse(JSON.stringify(s10CategoryStates.overall));
  eq(brokenOverall.letterSource, 'GATE:ROOT_DETECTED', '[اصطناعي][UNMATCHED] إعداد: letterSource=GATE:ROOT_DETECTED (S10 حقيقي، قبل الكسر)');
  const rootGate = brokenOverall.gatesApplied.find((g) => g.name === 'ROOT_DETECTED');
  ok(rootGate && rootGate.cappedOverall === true, '[اصطناعي][UNMATCHED] إعداد: ROOT_DETECTED.cappedOverall=true قبل الكسر (S10 حقيقي)');
  rootGate.cappedOverall = false; // الكسر المقصود الوحيد — بيانات مُختلَقة لهذا الاختبار حصراً
  const brokenCategoryStates = Object.assign({}, s10CategoryStates, {overall: brokenOverall});

  let threwUnexpectedly = false;
  let result = null;
  try {
    result = buildDisplayShapeV7({
      categoryStates: brokenCategoryStates, findings: s10Findings,
      aiAnalysis: s10AiAnalysis, language: 'ar',
    });
  } catch (e) {
    threwUnexpectedly = true;
  }
  ok(!threwUnexpectedly, '[اصطناعي][UNMATCHED] buildDisplayShapeV7 لا يرمي رغم letterSource/gatesApplied المتعارضين — التقرير يُبنى (تصحيح المستخدم 2026-09-30، البند ٦)');
  ok(result !== null && !!result.display && !!result.audit, '[اصطناعي][UNMATCHED] display وaudit عادا فعلياً، لا undefined');
  deepEq(result.display.overall.governingGateReason,
      {name: 'ROOT_DETECTED', ceilingLetter: null, source: null, status: 'UNMATCHED', text: null},
      '[اصطناعي][UNMATCHED][S1] governingGateReason = حالة صريحة {name,ceilingLetter:null,source:null,status:"UNMATCHED",text:null} — القاعدة 22');
  // بقية التقرير سليمة — الكسر مقصور على governingGateReason وحده، لا يُسقط
  // بقية display (letter/categories/issues) معه.
  eq(result.display.overall.letter, 'C', '[اصطناعي][UNMATCHED] letter يبقى C — letterSource/letter أنفسهما لم يُمسّا، الكسر في gatesApplied[ROOT_DETECTED].cappedOverall فقط');
  eq(result.display.overall.letterSource, 'GATE:ROOT_DETECTED', '[اصطناعي][UNMATCHED] letterSource يبقى كما وصل — التعارض في governingGateReason وحده');
  ok(Array.isArray(result.display.issues) && result.display.issues.length > 0, '[اصطناعي][UNMATCHED] display.issues يُبنى طبيعياً — التقرير حيّ بأكمله لا حقل واحد معزول');
  ok(typeof result.display.categories.security === 'object', '[اصطناعي][UNMATCHED] display.categories.security يُبنى طبيعياً');
}

// ═══════════════════════════════════════════════════════════════════════
// 6. رمي صريح — categoryStates غائب (لا بناء على عدم)
// ═══════════════════════════════════════════════════════════════════════
{
  let threw = false;
  try {
    buildDisplayShapeV7({categoryStates: null, findings: null, aiAnalysis: {}});
  } catch (e) {
    threw = true;
    ok(/categoryStates غائب/.test(e.message), '[رمي] رسالة الخطأ تسمّي السبب بدقّة');
  }
  ok(threw, '[رمي] buildDisplayShapeV7 يرمي صراحةً حين categoryStates غائب — لا كائن جزئي صامت');
}

console.log(`buildDisplayShapeV7.test.js: ${n}/${n} assertions passed`);
console.log(`CATEGORY_WEIGHTS sanity: total=${Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0)} ` +
    '(مرجع سياقي فقط — لا يُختبَر هنا، مُختبَر في categoryStates.test.js)');
