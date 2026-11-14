'use strict';

// reportShapeV7.test.js — الحارس على مخرَج V7 (P1.4، PLAN-01-ROADMAP.md
// "الحارس" تحت P1.4). كل حالة هنا **اصطناعية** (مخرَج نموذج مُلفَّق يدوياً)
// — لا نداء نموذج حقيقي (القيد الصريح في أمر المهمّة: "نداءات النموذج
// تكلّف... توقّف واطلب الإذن"). الهدف: إثبات أن الحارس يرفض/يقبل بشكل
// صحيح على أمثلة معروفة يدوياً، لا قياس سلوك نموذج حقيقي.
//
// Run: node functions/test/reportShapeV7.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  validateV7Shape, validateIssueDescriptionKeys, extractNumbers,
  validateNumberGrounding, detectEnglishLeaksV7, guardV7Response,
  collectDeviceReference, computeLeaksV7,
} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const s10Fingerprint = {timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const s10Findings = computeFindings(s10Fingerprint);
const s10Battery = sampleInputsFromRaw(s10Fingerprint);
const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Battery.sampleInputs, batteryDesignCapacityMah: s10Battery.design,
});
const realIssueId = s10CategoryStates.issues[0].id; // معرّف عطب حقيقي من الفِخّ

function validSkeleton() {
  return {
    narrative: {
      summary: 'ملخّص سليم بلا أرقام',
      details: 'تفاصيل سليمة بلا أرقام',
      verdict: 'حكم سليم',
      buyerAdvice: {casual: 'نصيحة عادية سليمة', gamer: 'نصيحة ألعاب سليمة', photographer: 'نصيحة تصوير سليمة'},
      issueDescriptions: {[realIssueId]: 'وصف صحيح لعطب حقيقي'},
    },
    crossChecks: [{description: 'ملاحظة تقاطع', evidenceRefs: ['findings.battery.qIntMah']}],
    adjustments: [],
    modelObservations: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. validateV7Shape — [اصطناعي] حالات صحيحة وخاطئة يدوية
// ═══════════════════════════════════════════════════════════════════════
{
  const good = validateV7Shape(validSkeleton());
  eq(good.ok, true, '[اصطناعي] هيكل سليم كامل → ok=true');

  eq(validateV7Shape(null).ok, false, '[اصطناعي] null → مرفوض');
  eq(validateV7Shape([]).ok, false, '[اصطناعي] مصفوفة على المستوى الأعلى → مرفوضة');

  const withGrade = {...validSkeleton(), grade: 'A'};
  const r1 = validateV7Shape(withGrade);
  eq(r1.ok, false, '[اصطناعي] وجود grade في المخرَج → مرفوض ("لا تكتبها إطلاقاً")');
  ok(r1.errors.includes('FORBIDDEN_KEY_grade'), '[اصطناعي] سبب الرفض مُسمّى: FORBIDDEN_KEY_grade');

  const missingSummary = {...validSkeleton(), narrative: {...validSkeleton().narrative, summary: ''}};
  ok(!validateV7Shape(missingSummary).ok, '[اصطناعي] summary فارغ → مرفوض');

  const badAdjustment = {...validSkeleton(), adjustments: [{category: 'cpu', direction: 'SIDEWAYS', evidenceRefs: ['x']}]};
  const r2 = validateV7Shape(badAdjustment);
  eq(r2.ok, false, '[اصطناعي] direction غير صحيح → مرفوض');
  ok(r2.errors.some((e) => e.includes('INVALID_DIRECTION')), '[اصطناعي] السبب مُسمّى');

  const noEvidence = {...validSkeleton(), adjustments: [{category: 'cpu', direction: 'DOWN', evidenceRefs: []}]};
  const r3 = validateV7Shape(noEvidence);
  eq(r3.ok, false, '[اصطناعي] evidenceRefs فارغة على adjustment → مرفوض ("evidenceRefs[≥1]" حرفياً)');

  const tooManyObs = {...validSkeleton(), modelObservations: [
    {text: 'أ', evidenceRefs: ['x']}, {text: 'ب', evidenceRefs: ['x']}, {text: 'ج', evidenceRefs: ['x']},
  ]};
  const r4 = validateV7Shape(tooManyObs);
  eq(r4.ok, false, '[اصطناعي] modelObservations > 2 → مرفوض (قرار 8)');

  // ─── القرار ٢٤ (buyerAdvice ثلاثة حقول) — كائن سليم يُقبَل، نصّ واحد
  // (الشكل القديم) والكائن الناقص كلاهما يُرفَض.
  const buyerAdviceAsString = {...validSkeleton(), narrative: {...validSkeleton().narrative, buyerAdvice: 'نصّ واحد قديم'}};
  const r5 = validateV7Shape(buyerAdviceAsString);
  eq(r5.ok, false, '[القرار ٢٤][اصطناعي] buyerAdvice كنصّ واحد (الشكل القديم) → مرفوض الآن');
  ok(r5.errors.includes('NARRATIVE_BUYERADVICE_MISSING_OR_NOT_OBJECT'),
      '[القرار ٢٤][اصطناعي] سبب الرفض مُسمّى: NARRATIVE_BUYERADVICE_MISSING_OR_NOT_OBJECT');

  const buyerAdviceMissingProfile = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة ألعاب'}, // photographer غائب
  }};
  const r6 = validateV7Shape(buyerAdviceMissingProfile);
  eq(r6.ok, false, '[القرار ٢٤][اصطناعي] buyerAdvice بملفّين فقط (photographer غائب) → مرفوض');
  ok(r6.errors.includes('NARRATIVE_BUYERADVICE_PHOTOGRAPHER_MISSING_OR_EMPTY'),
      '[القرار ٢٤][اصطناعي] سبب الرفض يسمّي الملفّ الغائب تحديداً: photographer');

  const buyerAdviceFullObject = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة ألعاب', photographer: 'نصيحة تصوير'},
  }};
  eq(validateV7Shape(buyerAdviceFullObject).ok, true, '[القرار ٢٤][اصطناعي] buyerAdvice بثلاثة ملفّات كاملة → مقبول');

  // ─── القرار ٢٥ (predicted_problems تُسقَط) — دفاع في العمق: لو كتبها
  // النموذج رغم البرومبت، تُرفَض بنفس آلية grade/score/category_scores.
  const withPredictedProblems = {...validSkeleton(), predicted_problems: [{prediction: 'x'}]};
  const r7 = validateV7Shape(withPredictedProblems);
  eq(r7.ok, false, '[القرار ٢٥][اصطناعي] وجود predicted_problems في المخرَج → مرفوض');
  ok(r7.errors.includes('FORBIDDEN_KEY_predicted_problems'),
      '[القرار ٢٥][اصطناعي] سبب الرفض مُسمّى: FORBIDDEN_KEY_predicted_problems');

  const withPredictedProblemsCamel = {...validSkeleton(), predictedProblems: []};
  ok(!validateV7Shape(withPredictedProblemsCamel).ok,
      '[القرار ٢٥][اصطناعي] الاسم بصياغة camelCase (predictedProblems) مرفوض أيضاً — لا ثغرة تسمية');
}
console.log('تحقّق 1: validateV7Shape — [اصطناعي] أنواع/مدى/حضور (+ القرار ٢٤ buyerAdvice، القرار ٢٥ predicted_problems)');

// ═══════════════════════════════════════════════════════════════════════
// 2. validateIssueDescriptionKeys — لا اختلاق معرّف عطب
// ═══════════════════════════════════════════════════════════════════════
{
  const good = validSkeleton();
  eq(validateIssueDescriptionKeys(good, s10CategoryStates).ok, true, '[اصطناعي] معرّف حقيقي → مقبول');

  const invented = {...validSkeleton(), narrative: {...validSkeleton().narrative, issueDescriptions: {'ISS-INVENTED-999': 'x'}}};
  const r = validateIssueDescriptionKeys(invented, s10CategoryStates);
  eq(r.ok, false, '[اصطناعي] معرّف مُختلَق → مرفوض');
  eq(r.inventedIds[0], 'ISS-INVENTED-999', '[اصطناعي] المعرّف المُختلَق مُسمّى بالضبط');
}
console.log('تحقّق 2: validateIssueDescriptionKeys — لا مؤلّف قائمة، كاتب أوصاف فقط');

// ═══════════════════════════════════════════════════════════════════════
// 3. extractNumbers — يستخرج الأرقام الحرّة، يتجاهل معرّفات الاختبار
// ═══════════════════════════════════════════════════════════════════════
{
  eq(extractNumbers('التردد 3.34 جيجاهرتز والتغطية 45%').join(','), '3.34,45', '[اصطناعي] رقمان حرّان مُستخرَجان');
  eq(extractNumbers('الاختبار SEC-04 فشل، وكذلك S10 وC-04').length, 0,
      '[اصطناعي] أرقام معرّفات الاختبار (SEC-04, S10, C-04) لا تُستخرَج كأرقام حرّة');
  eq(extractNumbers('لا أرقام هنا إطلاقاً').length, 0, '[اصطناعي] نص بلا أرقام → مصفوفة فارغة');
}
console.log('تحقّق 3: extractNumbers يميّز الأرقام الحرّة عن معرّفات الاختبار');

// ═══════════════════════════════════════════════════════════════════════
// 4. validateNumberGrounding — رقم من Findings حقيقي يُقبَل، مُختلَق يُرفَض
// ═══════════════════════════════════════════════════════════════════════
{
  // رقم حقيقي من findings.battery.qIntMah (فِخّ b45c8cf6 — راجع batteryLayer.test.js: ≈143.84).
  const realNumber = s10Findings.battery.qIntMah;
  ok(typeof realNumber === 'number', '[اصطناعي] افتراض مسبق: qIntMah رقم حقيقي في هذا الفِخّ');

  const withRealNumber = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    details: `تكامل الشحنة قيس ${realNumber.toFixed(2)} مللي أمبير ساعة`,
  }};
  const r1 = validateNumberGrounding(withRealNumber, s10Findings, s10CategoryStates);
  eq(r1.ok, true, '[اصطناعي] رقم حقيقي من findings (±تقريب toFixed) → يُقبَل');

  const withFakeNumber = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    details: 'الجهاز يستهلك 87654.321 مللي أمبير — رقم لا مصدر له إطلاقاً',
  }};
  const r2 = validateNumberGrounding(withFakeNumber, s10Findings, s10CategoryStates);
  eq(r2.ok, false, '[اصطناعي] رقم مُختلَق كلّياً → يُرفَض');
  eq(r2.unmatchedFields[0].field, 'narrative.details', '[اصطناعي] اسم الحقل المرفوض مُسجَّل بالضبط');
  ok(r2.unmatchedFields[0].numbers.includes(87654.321), '[اصطناعي] الرقم المرفوض نفسه مُسجَّل');

  // رقم من categoryStates (لا findings) — يُقبَل أيضاً (كلاهما مصدر شرعي).
  const overallCoveragePct = Math.round(s10CategoryStates.overall.coverage * 1000) / 10;
  const withCsNumber = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    verdict: `التغطية الإجمالية ${overallCoveragePct}%`,
  }};
  const r3 = validateNumberGrounding(withCsNumber, s10Findings, s10CategoryStates);
  eq(r3.ok, true, '[اصطناعي] رقم حقيقي من categoryStates.overall.coverage → يُقبَل');
}
console.log('تحقّق 4: validateNumberGrounding — "غير المطابق يُرفض حقله" (نصّ P1.4 حرفياً)');

// ═══════════════════════════════════════════════════════════════════════
// 5. detectEnglishLeaksV7 — [اصطناعي] تسرّب إنجليزي في حقل V7
// ═══════════════════════════════════════════════════════════════════════
{
  const clean = validSkeleton();
  eq(detectEnglishLeaksV7(clean).length, 0, '[اصطناعي] هيكل سليم عربي بالكامل → صفر تسرّب');

  const leaky = {...validSkeleton(), narrative: {...validSkeleton().narrative, summary: 'This device has Throttling issues'}};
  const leaks = detectEnglishLeaksV7(leaky);
  ok(leaks.length > 0, '[اصطناعي] جملة إنجليزية كاملة → تسرّب مكتشَف');
  eq(leaks[0].path, 'narrative.summary', '[اصطناعي] مسار الحقل المتسرّب مُسجَّل بدقّة');
}
console.log('تحقّق 5: detectEnglishLeaksV7 — يعيد استعمال قاموس languageValidator.js (مصدر واحد)');

// ═══════════════════════════════════════════════════════════════════════
// 6. guardV7Response — التجميع الكامل
// ═══════════════════════════════════════════════════════════════════════
{
  const good = guardV7Response(validSkeleton(), {findings: s10Findings, categoryStates: s10CategoryStates});
  eq(good.ok, true, '[اصطناعي] مخرَج سليم كامل يجتاز الحارس الكامل (شكل+معرّفات+أرقام+لغة)');

  const bad = guardV7Response({grade: 'A'}, {findings: s10Findings, categoryStates: s10CategoryStates});
  eq(bad.ok, false, '[اصطناعي] مخرَج فاسد كلّياً → يفشل الحارس الكامل');
}
console.log('تحقّق 6: guardV7Response — نقطة التجميع تعمل صحيحاً');

// ═══════════════════════════════════════════════════════════════════════
// 7. معايرة v7.1 (2026-09-21 +03) — الفئات الأربع (+ measurement_unit
//    الزائدة) لا تفتح الباب. كل حالة هنا على فِخّ b45c8cf6 الحقيقي، لا
//    نداء نموذج (نفس قيد بقيّة الملفّ).
// ═══════════════════════════════════════════════════════════════════════
{
  // فئة ١ (device) — C-05.raw.rawValue = "exynos9820 / exynos9820" (STATE،
  // لا MEASUREMENT) → "9820" مقبول عبر device، رغم أنه لا مكان له في
  // Findings/categoryStates كرقم قائم بذاته (مُلتصق بحروف في raw.rawValue).
  const c05 = s10CategoryStates.testResults.find((tr) => tr.testId === 'C-05');
  ok(c05 && c05.kind === 'STATE', '[افتراض مسبق] C-05 من نوع STATE لا MEASUREMENT في هذا الفِخّ');
  ok(c05.raw.rawValue.includes('9820'), '[افتراض مسبق] C-05.raw.rawValue يحمل "9820" (اسم الشريحة)');

  const deviceRef = collectDeviceReference(s10CategoryStates);
  ok(deviceRef.numbers.has(9820), '[معايرة v7.1] فئة ١ — 9820 داخل مرجع device (من C-05 STATE)');

  const withChipsetNumber = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    details: 'المعالج Exynos 9820',
  }};
  const rChip = validateNumberGrounding(withChipsetNumber, s10Findings, s10CategoryStates);
  eq(rChip.ok, true, '[معايرة v7.1] فئة ١ — "9820" في نصّ النموذج يُقبَل (مستبعد device لا مرفوض)');
  eq(rChip.excludedDevice.length, 1, '[معايرة v7.1] فئة ١ — الاستبعاد مُسجَّل في excludedDevice، لا صامت');
  eq(rChip.excludedDevice[0].number, 9820, '[معايرة v7.1] فئة ١ — الرقم المستبعد نفسه مُسجَّل');

  // اختبار انحدار صريح (نصّ أمر المهمّة: "رقم قياس مُختلَق يجب أن يُرفض،
  // المعايرة لا تفتح الباب") — رقم لا صلة له بالفِخّ إطلاقاً، ولا بأي رقم
  // من كل رقعة device (STATE/SPEC) — يبقى مرفوضاً رغم device الجديد.
  const withInvented = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    details: 'قياس مُختلَق كلّياً: 555444.333 وحدة لا معنى لها',
  }};
  const rInvented = validateNumberGrounding(withInvented, s10Findings, s10CategoryStates);
  eq(rInvented.ok, false, '[معايرة v7.1] انحدار — رقم مُختلَق لا يطابق Findings ولا device → يبقى مرفوضاً');
  ok(rInvented.unmatchedFields[0].numbers.includes(555444.333),
      '[معايرة v7.1] انحدار — الرقم المُختلَق نفسه في unmatchedFields لا excludedDevice');
  eq(rInvented.excludedDevice.length, 0, '[معايرة v7.1] انحدار — لا استبعاد device زائف لرقم لا صلة له بأي STATE/SPEC');

  // فئة ٢ (أسماء حقول Findings/categoryStates) — cappedOverall مفتاح حقيقي
  // (categoryStates.js gatesApplied[].cappedOverall)، والقيمة true حقيقية
  // لبوّابة ROOT_DETECTED في هذا الفِخّ تحديداً.
  const rootGate = s10CategoryStates.overall.gatesApplied.find((g) => g.name === 'ROOT_DETECTED');
  ok(rootGate && rootGate.status === 'FIRED', '[افتراض مسبق] ROOT_DETECTED مُطلَقة في هذا الفِخّ');
  const leakCapped = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    summary: `cappedOverall = ${rootGate.cappedOverall}`,
  }};
  const rCapped = computeLeaksV7(leakCapped, {findings: s10Findings, categoryStates: s10CategoryStates});
  eq(rCapped.leaks.length, 0, '[معايرة v7.1] فئة ٢ — استشهاد حرفي بمفتاح+قيمة بوليّة حقيقيَّين من categoryStates لا يُعَدّ تسرّباً');

  // انحدار لغة: كلمة إنجليزية حرّة (لا اسم حقل ولا بوّابة ولا وحدة ولا
  // device) تبقى تسرّباً رغم كل الاستثناءات الجديدة.
  const leakFree = {...validSkeleton(), narrative: {
    ...validSkeleton().narrative,
    summary: 'This is definitely English prose not grounded anywhere',
  }};
  const rFreeLeak = computeLeaksV7(leakFree, {findings: s10Findings, categoryStates: s10CategoryStates});
  ok(rFreeLeak.leaks.length > 0, '[معايرة v7.1] انحدار — نثر إنجليزي حرّ يبقى تسرّباً رغم فهرس الاستثناء الجديد');

  // guardV7Response الكامل مع device+ctx — يستهلك كل ما سبق معاً.
  const fullGood = guardV7Response(withChipsetNumber, {findings: s10Findings, categoryStates: s10CategoryStates});
  ok(fullGood.excluded && Array.isArray(fullGood.excluded.deviceSpecNumbers),
      '[معايرة v7.1] guardV7Response.excluded.deviceSpecNumbers موجود دوماً (حتى لو فارغاً)');
  ok(Array.isArray(fullGood.excluded.languageTokens),
      '[معايرة v7.1] guardV7Response.excluded.languageTokens موجود دوماً (حتى لو فارغاً)');
}
console.log('تحقّق 7: معايرة v7.1 — الفئات الأربع (device/أسماء حقول/بوّابات/وحدات) لا تفتح الباب أمام رقم أو رمز مُختلَق');

// ═══════════════════════════════════════════════════════════════════════
// 8. انحدار حقيقي — إعادة تشغيل الحارس على استجابتَي نموذج حقيقيّتين
//    مُجمَّدتين (test/fixtures/frozen-real-model-output-*.json) بعد تصدير
//    charge_counter من findings.js (مهمّة 2026-09-21 +03). **بلا نداء
//    نموذج جديد**.
//
//    تصحيح 2026-09-23 +03 (أمر مستخدم، القرار ٣، القاعدة 37): كان هذا
//    القسم يقرأ functions/scripts/out/v7-live-*.json (الاسمان الحرفيّان،
//    بلا طابع زمني) — ملفّان **متتبَّعان لكن متحرّكان**: أعاد المستخدم
//    تشغيل measure-callAIv7-live.js لاحقاً (commit d5069bd) فاستبدل
//    محتواهما برد نموذج جديد لا يحمل "charge"/"counter" في نفس المواضع،
//    فسقط هذا القسم — "اختبار مثبَّت على نصّ حرّ يكتبه النموذج يسقط عند أي
//    نداء جديد؛ فهو يحرس ما لا يُحرَس" (نصّ المستخدم). الإصلاح: تجميد نصّ
//    الردّ القديم في ملفّ ثابت الاسم لا يُكتَب فوقه أي سكربت قياس مستقبلاً:
//      المصدر: git show 953ed9f:functions/scripts/out/v7-live-<scanId>.json
//      (الالتزام الذي أدخل النداءين، قبل إعادة التشغيل d5069bd مباشرة)
//      sha256(b45c8cf6) = a0164cdd366dbbeb94c2f0e8601b699f00265835343a9892dd447b76b2ba22ab
//      sha256(34dff2b8) = 0cce11652c4c986e822a4a57c635fc1663053dad5091c0ad02e41b026f474bf5
//      (مطابقان حرفياً — تحقّقتُ بـsha256sum — لِما كان محفوظاً في
//      functions/scripts/out/pre-rerun-2026-09-22/ غير المتتبَّع، وهو نفسه
//      نصّ نموذج حقيقي فعلي من نداءين مأذونين، لا اصطناعي — يُوسَم بذلك
//      صراحةً في اسم الملفّ: "frozen-real-model-output").
//    القاعدة 23: هذا استبدال لمصدر القراءة، لا إضافة قسم مواز — القسم نفسه،
//    نفس التأكيدات، مصدر بيانات ثابت لا يتحرّك بدل مصدر متحرّك.
//
//    .guard المحفوظ داخل الملفّين المُجمَّدين نفسه **قديم** (حُسب بكود ما
//    قبل معايرة v7.1 16bc65d وقبل charge_counter) — لا يُقرأ هنا، فقط
//    parsedResponse (مخرَج النموذج الخام) يُعاد فحصه بكود اليوم.
// ═══════════════════════════════════════════════════════════════════════
{
  const FIXTURES_DIR = path.join(__dirname, 'fixtures');
  const LIVE_TARGETS = [
    {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json', frozenFile: 'frozen-real-model-output-b45c8cf6-2026-09-20.json'},
    {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json', frozenFile: 'frozen-real-model-output-34dff2b8-2026-09-20.json'},
  ];

  for (const t of LIVE_TARGETS) {
    const raw = loadJson(t.tsFile);
    const functional = frMap[t.scanId];
    const fingerprint = {timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
    const findings = computeFindings(fingerprint);
    const battery = sampleInputsFromRaw(fingerprint);
    const categoryStates = computeCategoryStates({
      functionalResults: functional, manualResults: [], dev: null, findings,
      batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
    });

    const live = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, t.frozenFile), 'utf8'));
    ok(live.parsedResponse && typeof live.parsedResponse === 'object',
        `[انحدار حقيقي:${t.scanId}] frozen-real-model-output-*.json يحمل parsedResponse صالحاً (لا نداء جديد — محفوظ، مُجمَّد)`);

    // مُهايئ توافق — القرار ٢٤ (buyerAdvice ثلاثة حقول، مهمّة 2026-09-21 +03
    // لاحقة لهذين النداءين المحفوظين): parsedResponse المحفوظ هنا سبق
    // القرار ٢٤ فيحمل narrative.buyerAdvice نصّاً واحداً — الشكل الجديد
    // validateV7Shape يرفضه الآن بنيوياً (NARRATIVE_BUYERADVICE_MISSING_OR_NOT_OBJECT)،
    // فيسقط shape.ok قبل أن يصل guardV7Response إلى computeLeaksV7/
    // validateNumberGrounding أصلاً (الأمر الحقيقي الذي يختبره هذا القسم:
    // "charge"/"counter" في crossChecks[3]/[4] — تحقّقتُ مباشرة، ليست في
    // buyerAdvice في أيٍّ من الفخّين). **لا نداء نموذج جديد** (القيد
    // الصريح) — بدلاً من ذلك: نسخة محلّية من parsedResponse يُعاد فيها
    // تشكيل buyerAdvice فقط إلى {casual, gamer, photographer} بنفس النصّ
    // القديم مكرَّراً على الثلاثة، كي يجتاز الشكل البنيوي دون تغيير أي
    // محتوى نصّي حقيقي يختبره هذا القسم فعلياً.
    const parsedResponseV24 = Object.assign({}, live.parsedResponse, {
      narrative: Object.assign({}, live.parsedResponse.narrative, {
        buyerAdvice: {
          casual: live.parsedResponse.narrative.buyerAdvice,
          gamer: live.parsedResponse.narrative.buyerAdvice,
          photographer: live.parsedResponse.narrative.buyerAdvice,
        },
      }),
    });

    const guard = guardV7Response(parsedResponseV24, {findings, categoryStates});

    const leaksWithChargeOrCounter = guard.languageLeaks.filter(
        (l) => l.tokens.some((tok) => ['charge', 'counter'].includes(tok.toLowerCase())));
    eq(leaksWithChargeOrCounter.length, 0,
        `[انحدار حقيقي:${t.scanId}] "charge"/"counter" لم يعودا يتسرّبان — كانا مرفوضين قبل هذه المهمّة ` +
        `(تحقّق مباشر على .guard المحفوظ في ${t.frozenFile}: crossChecks تحمل "charge","counter" ضمن tokens المرفوضة)`);

    const excludedChargeCounter = guard.excluded.languageTokens.filter(
        (e) => ['charge', 'counter'].includes(e.token.toLowerCase()));
    ok(excludedChargeCounter.length >= 2,
        `[انحدار حقيقي:${t.scanId}] "charge" و"counter" يظهران في .excluded.languageTokens بفئة findings_field_name ` +
        `— مفتاح حقيقي في Findings الآن (battery.charge_counter)، لا استثناء يدوي`);
    ok(excludedChargeCounter.every((e) => e.category === 'findings_field_name'),
        `[انحدار حقيقي:${t.scanId}] فئة الاستثناء = findings_field_name (الفئة ٢، بنيوية من مفاتيح Findings الفعلية) ` +
        `لا استثناء مُخصَّص جديد`);
  }
}
console.log('تحقّق 8: انحدار حقيقي على الاستجابتين المحفوظتين — charge_counter لم يعد يتسرّب على أيّهما (بلا نداء جديد)');

console.log(`\nreportShapeV7.test.js: ${n}/${n} assertions passed`);
