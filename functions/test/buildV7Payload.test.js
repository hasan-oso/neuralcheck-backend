'use strict';

// buildV7Payload.test.js — P1.4 (PLAN-01-ROADMAP.md، "P1.4 البرومبت v7":
// "callAI.js:143-166 يبني الحمولة من Findings + الثلاثيات + الحالات
// (بلا samples)") + applyV7Adjustments (قواعد adjustments[] من systemPromptV7.js).
//
// Run: node functions/test/buildV7Payload.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {buildV7Payload, applyV7Adjustments, ADJUSTMENT_ACCEPTED_NO_EFFECT, _internal: buildV7PayloadInternal} = require('../src/analysis/buildV7Payload');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates, deriveOverallFromCategories, CATEGORY_WEIGHTS} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {CATEGORIES} = require('../src/utils/categories');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── مُدخلات حقيقية (نفس فِخّ categoryStates.test.js/categoryStatesWiring) ─
const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const s10Fingerprint = {
  device: {model: 'SM-G977B'},
  timeSeries: s10Raw.timeSeries || s10Raw,
  functionalResults: s10Functional,
  manualResults: [],
};
const s10Findings = computeFindings(s10Fingerprint);
const s10Battery = sampleInputsFromRaw(s10Fingerprint);
const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional,
  manualResults: [],
  dev: null,
  findings: s10Findings,
  batterySampleInputs: s10Battery.sampleInputs,
  batteryDesignCapacityMah: s10Battery.design,
});

// ─── القرار ٤٢ البند ٢ (رسالة تصحيح لاحقة من المستخدم — "الباب يُغلق، ولا
// يُفتح إلا على مفردة مُعلَنة في الكود") — مراجع دليل **مُثبَتة** حقيقية على
// فِخّ S10 نفسه، لا أرقام خام. كل واحدة مُتحقَّق منها أدناه بالأداة قبل
// استعمالها (القاعدة 5/16 — لا افتراض شكلها).
const sec04Index = s10CategoryStates.testResults.findIndex((r) => r.testId === 'SEC-04');
ok(sec04Index >= 0, 'إعداد: SEC-04 موجود في testResults على S10 الحقيقي');
eq(s10CategoryStates.testResults[sec04Index].outcome, 'FAIL', 'إعداد: SEC-04.outcome=FAIL فعلياً على S10 — مفردة مُثبَتة (outcome=FAIL)');
const PROVEN_FAIL_REF = `categoryStates.testResults[${sec04Index}].outcome`;

// ⚠️ **القرار ٩٤ البند ١ (2026-09-25 +03)**: الثابتان أدناه (status=FIRED
// وdeterministicLetter=D) لم يعودا "مُثبَتَين" — isProvenSupportiveEvidence
// لم تعد تفحص status/حروفاً إطلاقاً (مفردة واحدة باقية: outcome=FAIL). أُبقي
// الاسمان القديمان ("PROVEN_") بلا تغيير عمداً (لا إعادة تسمية في هذا
// الالتزام — القيمتان أنفسهما لم تتغيّرا على الفِخّ، فقط دلالتهما تغيّرت)،
// ويُستعملان الآن حصراً في اختبارات تُثبت **الرفض** (تخفيض بحرف/ببوّابة) لا
// القبول — كل موضع استعمال مُعلَّق بسبب استعماله الجديد.
eq(s10CategoryStates.categories.security.gatesApplied[0] && s10CategoryStates.categories.security.gatesApplied[0].status, 'FIRED',
    'إعداد: security.gatesApplied[0].status=FIRED فعلياً (ROOT_DETECTED) — قيمة حقيقية، لم تعد "مُثبَتة" دليلاً بعد القرار ٩٤-١');
const PROVEN_GATE_FIRED_REF = 'categoryStates.categories.security.gatesApplied[0].status';

eq(s10CategoryStates.categories.security.deterministicLetter, 'D', 'إعداد: security.deterministicLetter=D فعلياً — قيمة حقيقية، لم تعد "مُثبَتة" دليلاً بعد القرار ٩٤-١');
const PROVEN_LETTER_D_REF = 'categoryStates.categories.security.deterministicLetter';

// **لا مرجع مُثبَت له علاقة بـcpu نفسها على هذا الفِخّ** (cpu.deterministicLetter=A،
// gatesApplied[0].status=DISABLED لا FIRED، لا FAIL على أي اختبار cpu) — تحقّق
// مباشر يُسجَّل هنا (القاعدة 5)، ويُستعمَل أدناه أكثر من مرّة كدليل على أثر
// الإغلاق نفسه (راجع تقرير المهمّة تحت "قياس قبل/بعد" لتفصيل هذا بالضبط).
eq(s10CategoryStates.categories.cpu.deterministicLetter, 'A', 'إعداد: cpu.deterministicLetter=A (لا C/D) — لا مفردة مُثبَتة متاحة لها على هذا الفِخّ');
eq(s10CategoryStates.categories.cpu.gatesApplied[0] && s10CategoryStates.categories.cpu.gatesApplied[0].status, 'DISABLED',
    'إعداد: cpu.gatesApplied[0].status=DISABLED لا FIRED — نفس الملاحظة');

// ─── القرار ٨٨ البند ٣ (نصّ المستخدم حرفياً): دليل التخفيض يُربط بالفئة
// المخفَّضة نفسها — "مسار تحت categoryStates.<الفئة>". الفقرة أعلاه توثّق
// أن cpu لا تحمل أي دليل مُثبَت من فئتها هي على هذا الفِخّ — وهذا بالضبط ما
// كان يجعل الاختبارات أدناه (قبل هذا القرار) تستشهد بدليل security على
// تخفيض cpu، **وهو النمط الذي صار يُرفَض الآن قبل الوصول لأي فحص آخر**
// (EVIDENCE_WRONG_CATEGORY). حيث كان قصد الاختبار فحص آليّات DOWN/UP نفسها
// (لا فحص مصدر الدليل)، دليل اصطناعي مُعلَّم من فئة cpu نفسها يحفظ ذلك
// القصد — نفس أسلوب "الفخّ المُهجَّن" المُستعمَل لاحقاً لفرع HARNESS_ERROR
// (استبدال عنصر واحد بعنصر حقيقي الشكل، لا تغيير المُدخل كلّه). **استُبدل
// لا أُضيف (القاعدة 23)** في كل موضع أدناه كان يستشهد بدليل security على
// فئة أخرى بقصد فحص آليّة عامّة لا خصوصية الفئة.
const s10TestResultsWithCpuFail = [
  ...s10CategoryStates.testResults,
  {category: 'cpu', testId: 'C-SYNTHETIC-FAIL', outcome: 'FAIL', kind: 'STATE', healthBearing: true},
];
const s10CategoryStatesWithCpuFail = {...s10CategoryStates, testResults: s10TestResultsWithCpuFail};
const PROVEN_CPU_FAIL_REF = `categoryStates.testResults[${s10TestResultsWithCpuFail.length - 1}].outcome`;

// بوّابة FIRED من فئة cpu نفسها — كانت تُستعمَل لإثبات "FIRED من الفئة
// نفسها يمرّ" (القرار ٨٨-٣)؛ تُستعمَل الآن حصراً لإثبات **الرفض**
// (القرار ٩٤ البند ١ — "لا بوّابة من بوّاباتها" مهما كانت فئتها أو أثرها).
// الاسم القديم أُبقي عمداً (نفس الملاحظة أعلاه — القيمة لم تتغيّر، دلالتها
// تغيّرت). ⚠️ متغيّر شقيق (`..._CAPPED_REF`، cappedThisLetter:true — كان
// يميّز "أثرها مطبَّق" عن "لا") **حُذف هنا**: كان بالفعل بلا أي استعمال في
// هذا الملفّ حتى قبل القرار ٩٤-١ (تحقّق بـgrep — التمييز الذي بُني لأجله،
// EVIDENCE_GATE_ALREADY_APPLIED، لم يعد له أثر أصلاً بعد حذفه من
// buildV7Payload.js) — تنظيف كود ميّت لا علاقة له بمنطق هذا القرار.
const cpuGateFiredIndex = s10CategoryStates.categories.cpu.gatesApplied.length;
const s10CategoriesWithCpuGateFired = {
  ...s10CategoryStates.categories,
  cpu: {
    ...s10CategoryStates.categories.cpu,
    gatesApplied: [
      ...s10CategoryStates.categories.cpu.gatesApplied,
      {name: 'SYNTHETIC_GATE', category: 'cpu', status: 'FIRED', cappedThisLetter: false, ceilingLetter: 'C', source: 'synthetic — القرار ٨٨-٣'},
    ],
  },
};
const s10CategoryStatesWithCpuGateFired = {...s10CategoryStates, categories: s10CategoriesWithCpuGateFired};
const PROVEN_CPU_GATE_FIRED_REF = `categoryStates.categories.cpu.gatesApplied[${cpuGateFiredIndex}].status`;

/**
 * تعميم النمط أعلاه لأيّ فئة أخرى بلا دليل مُثبَت حقيقي من فئتها هي على
 * هذا الفِخّ (القرار ٨٨-٣) — عنصر testResults اصطناعي واحد، category
 * المطلوبة، outcome=FAIL، ومرجع دليل يشير إليه مباشرة.
 * @param {Object} cs categoryStates أساس (لا يُعدَّل في المكان)
 * @param {string} category
 * @return {{categoryStates: Object, ref: string}}
 */
function withSyntheticProvenTestResult(cs, category) {
  const testResults = [
    ...cs.testResults,
    {category, testId: `${category.toUpperCase()}-SYNTHETIC-FAIL`, outcome: 'FAIL', kind: 'STATE', healthBearing: true},
  ];
  return {
    categoryStates: {...cs, testResults},
    ref: `categoryStates.testResults[${testResults.length - 1}].outcome`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 1. buildV7Payload — الشكل الصحيح، بلا samples إطلاقاً
// ═══════════════════════════════════════════════════════════════════════
{
  const {body, userMessage} = buildV7Payload({
    findings: s10Findings, categoryStates: s10CategoryStates,
    language: 'ar', scanId: 'test-scan', isFreeTrial: false, previousScan: null,
  });

  ok(body.findings !== null, 'body.findings موجود');
  eq(body.testResults.length, s10CategoryStates.testResults.length, 'body.testResults = categoryStates.testResults حرفياً');
  ok(body.testResults.length > 0, 'testResults غير فارغة على فِخّ S10 الحقيقي (85 عنصراً)');
  ok(body.categoryStates !== null, 'body.categoryStates موجود');
  eq(Object.keys(body.categoryStates.categories).length, 15, 'body.categoryStates.categories: 15 فئة');
  ok('overall' in body.categoryStates, 'body.categoryStates.overall موجود');
  ok('issues' in body.categoryStates, 'body.categoryStates.issues موجود');
  ok(!('testResults' in body.categoryStates), 'body.categoryStates لا يكرّر testResults (أُرسلت أعلى مستوى وحدها)');
  eq(body.scanId, 'test-scan', 'scanId يمرّ كما هو');
  eq(body.language, 'ar', 'language يمرّ كما هو');

  // بلا samples إطلاقاً — تحقّق نصّي مباشر على الحمولة المُسلسَلة كاملة.
  ok(!userMessage.includes('"samples"'), 'userMessage لا يحمل مفتاح "samples" إطلاقاً');
  ok(!/"v"\s*:\s*\[/.test(userMessage), 'userMessage لا يحمل نمط عيّنة خام {v:[...]}');
  ok(!userMessage.includes('rawFingerprint'), 'userMessage لا يحمل rawFingerprint (ذلك V6)');

  // مقارنة الحجم — نصّ المهمّة: "بعد التغيير الحمولة عشرات الكيلوبايت"
  // (P1.4، بند التحقّق) — لا نطابق رقماً غير مقيس (القاعدة 5)، لكن نتحقّق
  // من الاتّجاه فقط عبر عدد صريح من ملفّ مقيس مُسمّى إن وُجد. **لا يوجد
  // اليوم** — انظر تقرير المهمّة: "غير مُقاس" لهذا الرقم تحديداً؛ الاختبار
  // هنا يقتصر على ما يُقاس فعلياً الآن (طول userMessage نفسه، رقم من هذا
  // التشغيل بعينه، لا ادّعاء تحسين).
  console.log(`  userMessage.length = ${userMessage.length} بايت (رقم من هذا التشغيل، لا مطابقة مرجعية)`);
}
console.log('تحقّق 1: buildV7Payload — بلا samples، الثلاثيات + الحالات كاملة');

// ═══════════════════════════════════════════════════════════════════════
// 1-ب. القرار ٨٨ البند ٢ (نصّ الأمر حرفياً): "الاختبار الذي قُلبت نتيجته
// إلى ENVIRONMENT_UNSUITABLE يُحذف منه raw.status الخام في حمولة النموذج،
// ويبقى فيه outcome بعد القلب." التعليل: النموذج لا يرى raw.status:'fail'
// بجوار outcome:'NOT_MEASURED' فيكتب فشلاً لا يعدّه الخادم فشلاً.
//
// ⚠️ **لا فِخّ ذهبي حقيقي لهذا السلوك** — الفِخّان الوحيدان بـfunctionalResults
// حقيقية (b45c8cf6/34dff2b8) يحملان كل معرّفات ENVIRONMENT_EFFECT_IDS
// (N-10/N-05/N-06/N-08/L-02/L-03/SN-03/SN-08/SN-09) بحالة pass/not_tested/
// unavailable — لا واحد منها ENVIRONMENT_UNSUITABLE فعلياً على أيّ فحص
// مُلتزَم اليوم. مُتحقَّق أدناه صراحةً (لا افتراض): EXPECTED_V7_PAYLOAD_BYTES
// (expectedV7PayloadBytes.test.js) **بلا أي تغيير** بعد هذا الإصلاح —
// السلوك الجديد بلا أثر على أي فِخّ حقيقي، فيُختبَر اصطناعياً (نفس نمط
// N-10 fail المُستعمَل في القرار ٨٧-٣ أعلاه).
// ═══════════════════════════════════════════════════════════════════════
{
  const {sanitizeTestResultsForModelPayload} = buildV7PayloadInternal;

  // (أ) نقيّة — بمُدخل يدوي مباشر، لا حاجة لفحص حقيقي.
  const synthetic = [
    {testId: 'N-10', outcome: 'NOT_MEASURED', notMeasuredReason: 'ENVIRONMENT_UNSUITABLE',
      raw: {testId: 'N-10', status: 'fail', rawValue: '-95', rawValueUnit: 'dBm', categoryName: 'wireless'}},
    {testId: 'SEC-04', outcome: 'FAIL', notMeasuredReason: null,
      raw: {testId: 'SEC-04', status: 'fail', rawValue: 'مكتشف'}},
    {testId: 'T-04', outcome: 'NOT_MEASURED', notMeasuredReason: 'CAPABILITY_BLOCKED',
      raw: {testId: 'T-04', status: 'warning'}},
  ];
  const sanitized = sanitizeTestResultsForModelPayload(synthetic);
  ok(!('status' in sanitized[0].raw), '[القرار ٨٨-٢] N-10 (ENVIRONMENT_UNSUITABLE): raw.status محذوفة كلّياً — لا حتى null (غياب حقيقي)');
  eq(sanitized[0].outcome, 'NOT_MEASURED', '[القرار ٨٨-٢] N-10: outcome يبقى كما هو بعد القلب');
  eq(sanitized[0].raw.rawValue, '-95', '[القرار ٨٨-٢] N-10: raw.rawValue تبقى (الحذف يخصّ status وحدها)');
  eq(sanitized[0].raw.categoryName, 'wireless', '[القرار ٨٨-٢] N-10: بقيّة حقول raw كما هي');
  eq(sanitized[1].raw.status, 'fail', '[القرار ٨٨-٢] SEC-04 (outcome=FAIL عادي، ليس ENVIRONMENT_UNSUITABLE): raw.status تبقى بلا مساس');
  eq(sanitized[2].raw.status, 'warning', '[القرار ٨٨-٢] T-04 (CAPABILITY_BLOCKED لا ENVIRONMENT_UNSUITABLE): raw.status تبقى بلا مساس — التمييز بسبب القلب تحديداً لا NOT_MEASURED عموماً');
  ok(synthetic[0].raw.status === 'fail', '[القرار ٨٨-٢] لا تعديل في المكان — المصفوفة الأصلية بلا مساس');

  // (ب) موصولة فعلياً داخل buildV7Payload — لا اختبار الدالّة المعزولة وحدها
  // (القاعدة 30/37: الطبقة التي قد ترفض تُفحَص بمسارها الكامل).
  const F = s10Functional.map((r) => (r.testId === 'N-10' ? Object.assign({}, r, {status: 'fail', rawValue: '-95'}) : r));
  const csN10Fail = computeCategoryStates({
    functionalResults: F, manualResults: [], dev: null, findings: null,
    batterySampleInputs: null, batteryDesignCapacityMah: null,
  });
  const {body} = buildV7Payload({findings: null, categoryStates: csN10Fail, language: 'ar', scanId: 'x', isFreeTrial: false});
  const n10InPayload = body.testResults.find((r) => r.testId === 'N-10');
  ok(!!n10InPayload, '[القرار ٨٨-٢][موصول] N-10 حاضرة في body.testResults');
  ok(!('status' in n10InPayload.raw), '[القرار ٨٨-٢][موصول] raw.status غائبة فعلياً في الحمولة المبنيّة عبر buildV7Payload نفسها');
  eq(n10InPayload.outcome, 'NOT_MEASURED', '[القرار ٨٨-٢][موصول] outcome حاضر كما هو في الحمولة');
  // مقارنة مع فحص لا يحمل أي ENVIRONMENT_UNSUITABLE — s10CategoryStates
  // الحقيقي (N-10=pass فعلياً) — raw.status تصل كما وصلت دائماً.
  const {body: bodyBaseline} = buildV7Payload({findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar', scanId: 'x', isFreeTrial: false});
  const n10Baseline = bodyBaseline.testResults.find((r) => r.testId === 'N-10');
  eq(n10Baseline.raw.status, 'pass', '[القرار ٨٨-٢][موصول][مقارنة] N-10 الحقيقي (pass، لا قلب) — raw.status تصل كما هي، بلا حذف');

  console.log('تحقّق 1-ب [القرار ٨٨-٢]: raw.status محذوفة لعناصر ENVIRONMENT_UNSUITABLE فقط في حمولة النموذج — outcome وبقيّة raw تبقى، موصول داخل buildV7Payload فعلياً');
}

// ═══════════════════════════════════════════════════════════════════════
// 2. assertNoRawSamples — يرمي فعلاً لو تسرّبت عيّنات خام بالغلط
// ═══════════════════════════════════════════════════════════════════════
{
  let threw = false;
  try {
    buildV7Payload({
      findings: {samples: [{v: [0, 1, 2, 3, 4], phase: 0}]}, // مُدخل خاطئ عمداً
      categoryStates: s10CategoryStates, language: 'ar',
    });
  } catch (e) {
    threw = true;
    ok(/عيّنات خام/.test(e.message), 'رسالة الخطأ تشرح السبب');
  }
  ok(threw, 'buildV7Payload يرمي إن تسرّبت مصفوفة عيّنات خام في findings.samples');
}
console.log('تحقّق 2: assertNoRawSamples يمنع تسرّب العيّنات فعلياً، لا بالوعد فقط');

// ═══════════════════════════════════════════════════════════════════════
// 3. applyV7Adjustments — DOWN يُطبَّق بسقف درجة واحدة، UP يُحفَظ disputed
//
// القرار ٤٢ (2026-09-21 +03، جولتان) — تحديثات تستبدل (القاعدة 23) ما كان
// هذا القسم يُثبته سابقاً، لا تُضاف بجواره:
//   (أ) A62 — deterministicLetter لم يعد يُكتَب فوقه في DOWN مقبول (يبقى
//       ما قاله القياس). المُستعمَل فعلياً في الاشتقاق/العرض من الآن
//       finalLetter.
//   (ب) البند ١/٢ (الجولة الثانية — قرار المستخدم "الباب يُغلق"): evidenceRefs
//       يجب أن تُحلّ (EVIDENCE_NOT_FOUND)، وألّا تكون غياباً صريحاً
//       (EVIDENCE_NOT_MEASURED)، **وأن تحمل قيمة مُثبَتة بمفردة مُعلَنة في
//       الكود** (status=FIRED / outcome=FAIL / حرف C-D على deterministicLetter
//       أو finalLetter أو llmSuggestedLetter) — أيّ شيء آخر (أرقام خام،
//       PASS، NOT_FIRED/DISABLED/NOT_WIRED، حرف A/B) يُرفَض EVIDENCE_NOT_PROVEN.
//       كل تحقّق كان يستعمل مرجعاً غير مُثبَت («findings.meta.sampleCount»
//       من الجولة الأولى، أو ['x'] الأصلية) لاختبار سلوك *بعد* هذه النقطة
//       يستعمل الآن PROVEN_FAIL_REF/PROVEN_GATE_FIRED_REF/PROVEN_LETTER_D_REF
//       (مُعرَّفة أعلى الملفّ، كلّها مُتحقَّق منها بالأداة على S10 الحقيقي).
// ═══════════════════════════════════════════════════════════════════════
{
  // ⚠️ **استُبدل لا أُضيف (القاعدة 23)** — القرار ٨٨ البند ٣: كان هذا
  // القسم يستشهد بـPROVEN_LETTER_D_REF (حرف security=D) على تخفيض cpu —
  // ذلك بالضبط النمط عبر-الفئات الذي صار يُرفَض الآن (EVIDENCE_WRONG_CATEGORY)
  // قبل أن يبلغ فحص "الإثبات" إطلاقاً. القصد هنا فحص آليّة DOWN/A62 نفسها
  // لا خصوصية الفئة — فالبديل دليل اصطناعي مُعلَّم من فئة cpu نفسها
  // (s10CategoryStatesWithCpuFail/PROVEN_CPU_FAIL_REF، مُعرَّفان أعلى
  // الملفّ) يحفظ نفس القصد بلا كسر القاعدة الجديدة.
  eq(s10CategoryStates.categories.cpu.deterministicLetter, 'A', 'افتراض مسبق: cpu=A على S10 الحقيقي');
  eq(s10CategoryStates.categories.cpu.finalLetter, 'A', 'افتراض مسبق: finalLetter=deterministicLetter=A قبل أي تعديل (خط الأساس، categoryStates.js)');

  const adjusted = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', maxOneBand: true, evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'اصطناعي للاختبار'},
  ], s10Findings);
  eq(adjusted.categories.cpu.deterministicLetter, 'A', '[A62] deterministicLetter يبقى A — ما قاله القياس الحتمي وحده، لا يُكتَب فوقه أبداً بعد الآن');
  eq(adjusted.categories.cpu.finalLetter, 'B', '[A62] finalLetter هو المُستعمَل فعلياً بعد DOWN: A → B (درجة واحدة بالضبط)');
  eq(adjusted.categories.cpu.llmSuggestedLetter, 'B', 'llmSuggestedLetter = finalLetter الجديد (رأي النموذج المطبَّق)');
  eq(adjusted.categories.cpu.adjustmentApplied, true, 'adjustmentApplied=true على الفئة المُعدَّلة');
  eq(adjusted.categories.cpu.adjustmentReason, 'اصطناعي للاختبار', '[A62] adjustmentReason محفوظ على الفئة نفسها — رأي النموذج لا يضيع');
  deepEq(adjusted.categories.cpu.adjustmentEvidence, [PROVEN_CPU_FAIL_REF],
      '[A62] adjustmentEvidence محفوظ على الفئة نفسها');
  eq(adjusted.overall.adjustments.length, 1, 'overall.adjustments يحمل سجلّ التعديل');
  eq(adjusted.overall.adjustments[0].applied, true, 'سجلّ DOWN صحيح: applied=true');
  eq(adjusted.overall.adjustments[0].displayed, false, 'القرار ٤: adjustments تُحفَظ ولا تُعرض');
  eq(adjusted.overall.disputed, false, 'لا disputed هنا (كلّها DOWN صحيحة)');
  // لا تعديل في المكان — الأصل يبقى كما هو.
  eq(s10CategoryStates.categories.cpu.deterministicLetter, 'A', 'الأصل غير مُعدَّل (applyV7Adjustments لا تُغيّر في المكان)');
  eq(s10CategoryStates.categories.cpu.finalLetter, 'A', 'الأصل غير مُعدَّل: finalLetter الأصلي يبقى A أيضاً');
}

{
  // UP — يُحفَظ ولا يُطبَّق. مرجع دليل مُثبَت (FAIL من نفس الفئة) كي يبلغ
  // الاختبار فرع UP نفسه فعلاً. ⚠️ **استُبدل — القرار ٩٤ البند ١**: كان
  // PROVEN_LETTER_D_REF (حرف security=D) — الحرف لم يعد مُثبَتاً إطلاقاً
  // بعد اليوم، حتى من فئته هو؛ بديله دليل FAIL اصطناعي من security نفسها.
  const {categoryStates: csForSecurityUp, ref: securityUpProvenRef} = withSyntheticProvenTestResult(s10CategoryStates, 'security');
  const adjusted = applyV7Adjustments(csForSecurityUp, [
    {category: 'security', direction: 'UP', evidenceRefs: [securityUpProvenRef], reason: 'اصطناعي'},
  ], s10Findings);
  eq(adjusted.categories.security.deterministicLetter, s10CategoryStates.categories.security.deterministicLetter,
      'UP: الحرف الحتمي لا يتغيّر إطلاقاً');
  eq(adjusted.categories.security.finalLetter, s10CategoryStates.categories.security.finalLetter,
      'UP: finalLetter أيضاً لا يتغيّر (UP لا يُطبَّق أبداً على أيّ من الحقلين)');
  eq(adjusted.overall.disputed, true, 'UP يرفع overall.disputed=true');
  eq(adjusted.overall.adjustments[0].disputed, true, 'سجلّ UP يحمل disputed=true');
  eq(adjusted.overall.adjustments[0].applied, false, 'UP: applied=false دائماً');
}

{
  // بلا دليل — رفض كامل.
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: []},
  ], s10Findings);
  eq(adjusted.categories.cpu.finalLetter, 'A', 'بلا دليل: لا تطبيق (finalLetter يبقى A)');
  eq(adjusted.overall.adjustments[0].rejectedReason, 'NO_EVIDENCE', 'سبب الرفض مُسمّى: NO_EVIDENCE');
}

// ─── القرار ٤٢ البند ١ — الدليل يُحلّ فعلاً، لا الطول وحده ───────────────
{
  // مرجع لا يُحلّ إلى شيء موجود إطلاقاً — نصّ حرّ، أو مسار حقيقي الشكل لكن
  // لحقل غير موجود.
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['هذا ليس مساراً'], reason: 'دليل مختلَق'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_FOUND',
      '[القرار ٤٢/١] مرجع بلا شكل مسار صالح (جذر غير findings/categoryStates) → EVIDENCE_NOT_FOUND');
  eq(adjusted.categories.cpu.finalLetter, 'A', 'الرفض يمنع التطبيق فعلياً — لا تسرّب جزئي');
}
{
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['findings.thisFieldDoesNotExist'], reason: 'دليل مختلَق'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_FOUND',
      '[القرار ٤٢/١] مسار findings.* بشكل صحيح لكن لحقل غير موجود فعلاً → EVIDENCE_NOT_FOUND');
}
{
  // مرجع حقيقي الشكل ويُحلّ فعلاً، لكن قيمته علامة غياب صريحة (status:
  // NOT_MEASURED) — findings.battery.consist NOT_MEASURED فعلياً على S10
  // (fv≤67 — راجع findings.js:519-525 HARNESS_VERSION). تحقّق مباشر أدناه
  // قبل استعماله كدليل، كي لا يُفترَض شكله (القاعدة 5/16).
  ok(s10Findings.battery && s10Findings.battery.consist && s10Findings.battery.consist.status === 'NOT_MEASURED',
      'افتراض مسبق مُتحقَّق منه: findings.battery.consist.status=NOT_MEASURED فعلياً على فِخّ S10 (fv≤67)');
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['findings.battery.consist'], reason: 'استشهاد بحقل غير مقيس'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_MEASURED',
      '[القرار ٤٢/١] مرجع يُحلّ لحقل status=NOT_MEASURED صريح → EVIDENCE_NOT_MEASURED (القاعدة 22 — الغياب لا يُقرأ قياساً)، لا EVIDENCE_NOT_FOUND ولا NO_EVIDENCE (أسباب مختلفة، القاعدة 21)');
}
{
  // ✦ القرار ٤٢ البند ٢/الجولة الثانية — مرجع يُحلّ فعلاً وليس غياباً، لكن
  // بلا مفردة مُعلَنة تُثبت أنه يسند (رقم خام من findings.sustainedCeiling —
  // بالضبط مثال المستخدم الحيّ في v7-live-34dff2b8-*.json). "الباب مغلق":
  // EVIDENCE_NOT_PROVEN، لا EVIDENCE_NOT_FOUND (المرجع موجود فعلاً).
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['findings.sustainedCeiling.combined.meanWindowMaxRatio'], reason: 'رقم خام بلا عتبة'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٤٢/٢][الباب مغلق] رقم خام من findings — موجود فعلاً وليس غياباً، لكن لا مفردة مُعلَنة تُثبت أنه يسند → EVIDENCE_NOT_PROVEN');
}
{
  // نفس الفكرة على قيمة enum حقيقية لكن **بقيمة لا تُثبِت** (PASS/NOT_FIRED/
  // DISABLED/حرف A) — مفردة مُعلَنة، لكن قيمتها المحدَّدة ليست من الثلاث
  // المُثبَتة (FIRED/FAIL/C-D).
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['categoryStates.categories.cpu.gatesApplied[0].status'], reason: 'DISABLED لا يسند'},
  ], s10Findings);
  eq(s10CategoryStates.categories.cpu.gatesApplied[0].status, 'DISABLED', 'افتراض مسبق مُتحقَّق منه: cpu.gatesApplied[0].status=DISABLED فعلياً');
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٤٢/٢][الباب مغلق] status=DISABLED مفردة مُعلَنة لكن ليست FIRED → EVIDENCE_NOT_PROVEN (لا NOT_FOUND ولا NOT_MEASURED)');
}
{
  // FIRED — لا يُثبَت بعد اليوم، يُرفَض. ⚠️ **توقّع مقلوب — القاعدة 23،
  // القرار ٩٤ البند ١**: كان هذا يُثبت أن status=FIRED من فئة cpu نفسها
  // "يُثبَت فيمرّ" (applied=true، القرار ٨٨-٣) — صار الآن العكس تماماً:
  // "لا يُقبل ... بوّابة من بوّاباتها" ولو من الفئة نفسها ولو FIRED فعلاً.
  const adjusted = applyV7Adjustments(s10CategoryStatesWithCpuGateFired, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_GATE_FIRED_REF], reason: 'بوّابة مُطلَقة فعلاً'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١][كان applied=true قبل هذا القرار] status=FIRED من فئة cpu نفسها لم يعد يُثبَت شيئاً — يُرفَض');
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١] السبب: isProvenSupportiveEvidence لم تعد تفحص status إطلاقاً — لا بوّابة تُثبَت شيئاً بعد اليوم');
}
{
  // FAIL فعلياً — يُثبَت، يمرّ. [استُبدل — نفس السبب]: PROVEN_FAIL_REF كان
  // SEC-04 (security)؛ بديله اختبار cpu اصطناعي بـoutcome=FAIL.
  const adjusted = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'اختبار فاشل فعلاً'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].applied, true, '[القرار ٤٢/٢] outcome=FAIL مُثبَت → يمرّ، applied=true');
}
{
  // مرجع واحد مُثبَت + مرجع واحد رقم خام بجواره — التعديل كلّه يُرفَض (لا
  // "بعض الدليل يكفي"). ⚠️ **استُبدل — القرار ٩٤ البند ١**: المرجع الأوّل
  // كان PROVEN_CPU_GATE_FIRED_REF (بوّابة) — لم يعد "مُثبَتاً" بتاتاً بعد
  // اليوم؛ بديله PROVEN_CPU_FAIL_REF (FAIL من نفس الفئة، يبقى مُثبَتاً)
  // كي يبقى قصد الاختبار سليماً: مرجع مُثبَت واحد + مرجع ضعيف واحد → رفض كامل.
  const adjusted = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF, 'findings.sustainedCeiling.combined.meanWindowMaxRatio'], reason: 'خليط'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٤٢/١+٢] مرجع واحد غير مُثبَت ضمن مصفوفة فيها مرجع مُثبَت → التعديل كلّه يُرفَض (لا يكفي بعض الدليل)');
  eq(adjusted.categories.cpu.finalLetter, 'A', 'لا تطبيق جزئي — finalLetter لم يتغيّر');
}
{
  // مرجع واحد مختلَق (لا يُحلّ) + مرجع واحد مُثبَت — EVIDENCE_NOT_FOUND
  // تسبق (أوّل مرجع في المصفوفة يُقيَّم أوّلاً، والحلقة تتوقّف عند أوّل فشل).
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['مرجع مختلَق آخر', PROVEN_GATE_FIRED_REF], reason: 'خليط آخر'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_FOUND',
      '[القرار ٤٢/١] المرجع الأوّل في المصفوفة لا يُحلّ → EVIDENCE_NOT_FOUND (يتوقّف عند أوّل فشل — لا يفحص الباقي)');
}
{
  // بلا findings مُمرَّرة (3rd arg غائب) — كل مرجع بجذر findings يُرفَض
  // EVIDENCE_NOT_FOUND (فشل مغلَق موثَّق في تعليق applyV7Adjustments، لا
  // نجاح صامت لعدم توفّر ما يُتحقَّق منه). مرجع بجذر categoryStates (مُثبَت
  // أيضاً) يبقى يعمل رغم غياب findings — يُثبت أن الفشل مقصور على findings
  // فقط لا على الدالّة كلّها.
  const adjustedNoFindings = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['findings.sustainedCeiling.combined'], reason: 'بلا findings'},
  ]); // بلا الوسيط الثالث عمداً
  eq(adjustedNoFindings.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_FOUND',
      '[القرار ٤٢/١] findings غائبة عن applyV7Adjustments → كل مرجع بجذر findings يُرفَض (فشل مغلَق، لا تساهل)');
  // ⚠️ **استُبدل — القرار ٩٤ البند ١**: كان PROVEN_CPU_GATE_FIRED_REF (بوّابة)؛
  // بديله PROVEN_CPU_FAIL_REF (FAIL من نفس الفئة، يبقى مُثبَتاً).
  const adjustedCsOnly = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'بجذر categoryStates فقط'},
  ]); // بلا findings أيضاً
  eq(adjustedCsOnly.overall.adjustments[0].applied, true,
      '[القرار ٤٢/١] مرجع بجذر categoryStates (مُثبَت) يمرّ رغم غياب findings — الفشل مقصور على جذر findings وحده');
}
{
  // ⚠️ **توقّع مقلوب مرّة ثانية — القاعدة 23 (لا استبدال دليل هنا) — القرار
  // ٩٤ البند ١، نصّ الأمر حرفياً: "لا يُقبل حرف من أيّ فئة." هذا الاختبار
  // بعينه (كان "302-306" قبل القرار ٨٨-٣، ثم أصبح يُثبت EVIDENCE_WRONG_CATEGORY
  // من فئة خطأ) — يتغيّر توقّعه ثانيةً: صار الحرف مرفوضاً EVIDENCE_NOT_PROVEN
  // (شقّ الإثبات يسبق شقّ الفئة، evaluateEvidenceRef) بصرف النظر عن فئته —
  // **حتى من فئة التعديل نفسها** (اختبار مباشر أدناه)، لا فقط من فئة أخرى.
  //
  // **مطلوب صراحةً بالقرار ٩٤-١**: "اختبارات: تخفيض فئة بحرفها يُرفض."
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_LETTER_D_REF], reason: 'استشهاد بفئة أخرى'},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١] مرجع بجذر categoryStates يُحلّ فعلاً، ويحمل حرفاً C/D — لكن الحرف لم يعد يُثبَت شيئاً بتاتاً بعد اليوم');
  eq(adjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١][كان EVIDENCE_WRONG_CATEGORY قبل هذا القرار] السبب الآن: isProvenSupportiveEvidence لم تعد تفحص حقول الحرف إطلاقاً — يُرفَض قبل بلوغ فحص الفئة، بصرف النظر عمّا كانت فئته');
  eq(adjusted.categories.cpu.finalLetter, s10CategoryStates.categories.cpu.finalLetter,
      '[القرار ٩٤/١] cpu.finalLetter بلا تغيير — الرفض يمنع أي أثر جزئي');
}

{
  // **[القرار ٩٤-١][مطلوب صراحةً] تخفيض فئة بحرفها **هي نفسها** يُرفَض** —
  // الاختبار أعلاه استشهد بحرف فئة *أخرى* (security) على cpu، فيثبت الرفض
  // بسببين محتملين معاً (الحرف غير مُثبَت + فئة خطأ لو كان مُثبَتاً). هذا
  // الاختبار يعزل الحالة الأدقّ: فئة تُخفَّض بحرفها **هي نفسها** —
  // الاستدلال الدائري الذي حرّك القرار كلّه (نصّ التعليل: "لم يبقَ من أدلّة
  // الحروف إلا حرف الفئة نفسها، وهذا استدلال دائري"، ومثاله الحيّ storage
  // في عيّنة llm-adjusted).
  eq(s10CategoryStates.categories.security.deterministicLetter, 'D', 'افتراض مسبق: security.deterministicLetter=D فعلياً');
  const adjustedOwnLetter = applyV7Adjustments(s10CategoryStates, [
    {category: 'security', direction: 'DOWN', evidenceRefs: [PROVEN_LETTER_D_REF], reason: 'استدلال دائري — حرف الفئة نفسها'},
  ], s10Findings);
  eq(adjustedOwnLetter.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١] تخفيض security بحرفها deterministicLetter الخاصّ بها هي نفسها → يُرفَض (لا حتى من فئتها هي)');
  eq(adjustedOwnLetter.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١] السبب: EVIDENCE_NOT_PROVEN — الحرف لا يُثبَت دليلاً بصرف النظر عن فئته، حتى حين تتطابق الفئتان (لا EVIDENCE_WRONG_CATEGORY، الفئة صحيحة هنا فعلاً)');
  eq(adjustedOwnLetter.categories.security.finalLetter, s10CategoryStates.categories.security.finalLetter,
      '[القرار ٩٤/١] security.finalLetter بلا تغيير');
}

{
  // **[القرار ٩٤-١][مطلوب صراحةً] تخفيض فئة بحالتها (state) يُرفَض** — حالة
  // الفئة (MEASURED/PARTIAL/UNMEASURED/...) لم تكن مُثبَتة قبل القرار ٩٤-١
  // أصلاً (لا فرع لها في isProvenSupportiveEvidence)، لكنها لم تكن مُختبَرة
  // صراحةً — يُغلَق هذا الباب بالاختبار الآن، لا بمجرّد غياب فرع يفتحه.
  eq(s10CategoryStates.categories.cpu.state, 'MEASURED', 'افتراض مسبق: cpu.state=MEASURED فعلياً على S10');
  const adjustedByState = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['categoryStates.categories.cpu.state'], reason: 'استشهاد بحالة الفئة'},
  ], s10Findings);
  eq(adjustedByState.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١] تخفيض cpu بحالتها (state=MEASURED) → يُرفَض');
  eq(adjustedByState.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١] السبب: lastKeyName=\'state\' لم يُصنَّف إطلاقاً في isProvenSupportiveEvidence (لا فرع له) — EVIDENCE_NOT_PROVEN، بصرف النظر عن قيمته');
  eq(adjustedByState.categories.cpu.finalLetter, s10CategoryStates.categories.cpu.finalLetter,
      '[القرار ٩٤/١] cpu.finalLetter بلا تغيير');
}

{
  // فئة بلا حرف أصلاً (UNMEASURED) — لا شيء لتخفيضه. القرار ٤٢ البند ٤:
  // سبب الرفض يحمل اسم الحالة صراحةً (UNMEASURED/ATTESTED_ONLY) بدل الوكيل
  // العام NO_BASE_LETTER — مُتحقَّق ديناميكياً من entry.state الحقيقي (لا
  // افتراض أيّهما تحديداً، القاعدة 5). [استُبدل الدليل — القرار ٨٨-٣]: كان
  // PROVEN_LETTER_D_REF (فئة أخرى)؛ بديله دليل مُثبَت من noLetterCat نفسها
  // (اصطناعي — withSyntheticProvenTestResult) كي يبلغ الاختبار فرع
  // NO_BASE_LETTER فعلاً (لا يُرفَض عند فحص الفئة/الإثبات قبله).
  const noLetterCat = CATEGORIES.find((c) => s10CategoryStates.categories[c].deterministicLetter === null && c !== 'battery');
  ok(!!noLetterCat, 'يوجد فعلاً فئة بلا حرف على S10 الحقيقي (thermal/camera)');
  const expectedState = s10CategoryStates.categories[noLetterCat].state;
  ok(expectedState === 'UNMEASURED' || expectedState === 'ATTESTED_ONLY',
      `افتراض مسبق: ${noLetterCat}.state هو أحد الاسمين المُغطَّيين (UNMEASURED/ATTESTED_ONLY) — الحال فعلياً: ${expectedState}`);
  const {categoryStates: csForNoLetter, ref: noLetterProvenRef} = withSyntheticProvenTestResult(s10CategoryStates, noLetterCat);
  const adjusted = applyV7Adjustments(csForNoLetter, [
    {category: noLetterCat, direction: 'DOWN', evidenceRefs: [noLetterProvenRef]},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, expectedState,
      `[القرار ٤٢/٤] ${noLetterCat}: سبب الرفض = اسم الحالة (${expectedState}) صراحةً، لا NO_BASE_LETTER الوكيل العام`);
}

{
  // فجوة كانت موثَّقة (القرار ٤٢ البند ٤) أُغلقت هنا (نصّ مهمّة
  // 2026-09-21 +03): البطارية state=PARTIAL فعلياً على S10 مع
  // deterministicLetter=null — لا UNMEASURED ولا ATTESTED_ONLY، لكن
  // canGrade مُقفَل **بقرار** (PLAN-03 لم يُنجَز) لا بغياب قياس. القاعدة
  // 21: الفحص هنا على noLetterReason المُعلَن (categoryStates.js:423،
  // مبنيّ من نفس canGrade المحلّي في نفس الموضع الذي يبني منه
  // deterministicLetter — categoryStates.js:404 — لا أحدهما مُشتقّ من
  // الآخر)، لا على deterministicLetter=null (ذاك بوّابة الدخول للفرع
  // كلّه أصلاً، لا مصدر التمييز داخله).
  eq(s10CategoryStates.categories.battery.state, 'PARTIAL', 'افتراض مسبق مُتحقَّق منه: battery.state=PARTIAL فعلياً على S10 (batteryLayer.js)');
  eq(s10CategoryStates.categories.battery.deterministicLetter, null, 'افتراض مسبق: battery.deterministicLetter=null (canGrade مُقفَل)');
  eq(s10CategoryStates.categories.battery.noLetterReason, 'NO_CALIBRATED_THRESHOLD (PLAN-03 لم يُنجَز — انظر batteryLayer.js)',
      'افتراض مسبق: noLetterReason المُعلَن حاضر فعلياً على S10 (categoryStates.js:423) — لا حقل canGrade اسمه هذا على entry نفسها؛ noLetterReason هو الوكيل المُعلَن المُتاح');
  // [استُبدل الدليل — القرار ٨٨-٣]: كان PROVEN_LETTER_D_REF (فئة security)؛
  // بديله دليل مُثبَت من battery نفسها (اصطناعي — لا FAIL حقيقي على battery
  // في هذا الفِخّ، مُتحقَّق سابقاً في categoryGradingLock.test.js) كي يبلغ
  // الاختبار فرع CATEGORY_GRADING_LOCKED فعلاً لا EVIDENCE_WRONG_CATEGORY.
  const {categoryStates: csForBatteryLock, ref: batteryProvenRef} = withSyntheticProvenTestResult(s10CategoryStates, 'battery');
  const adjusted = applyV7Adjustments(csForBatteryLock, [
    {category: 'battery', direction: 'DOWN', evidenceRefs: [batteryProvenRef]},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'CATEGORY_GRADING_LOCKED',
      '[نصّ 2026-09-21][الفجوة أُغلقت] battery.state=PARTIAL مع noLetterReason مُعلَن (قفل بقرار حتى PLAN-03): سبب الرفض = CATEGORY_GRADING_LOCKED، لا NO_BASE_LETTER بعد اليوم');
}

{
  // HARNESS_ERROR — سبب رفض ثامن مُسمّى (نصّ مهمّة 2026-09-21 +03)، لا
  // يُدمَج في NO_BASE_LETTER العام. فخّ مُهجَّن: نسخة من s10CategoryStates
  // الحقيقي (categories.security تبقى كما هي — مصدر الدليل المُثبَت
  // PROVEN_LETTER_D_REF، الذي يُحلّ مقابل هذا الكائن نفسه بوصفه الوسيط
  // الأول لـapplyV7Adjustments لا مقابل findings؛ findings لا تحمل حقلاً
  // مُثبَتاً واحداً — راجع رأس هذا الملف "كل ما عداها... يبقى مغلقاً")
  // مع استبدال categories.cpu وحدها بعنصر HARNESS_ERROR الحقيقي —
  // harnessErrorCategoryEntry نفسها (categoryStates.js:114-126)، نفس ما
  // يبنيه buildHarnessErrorCategoryStates فعلياً على مسار
  // functionalResults===null (categoryStates.js:136-142) — لا كائن
  // مُخترَع بشكل مختلف عن الإنتاج.
  const {harnessErrorCategoryEntry} = require('../src/analysis/categoryStates')._internal;
  const harnessCpuCategoryStates = {
    ...s10CategoryStates,
    categories: {...s10CategoryStates.categories, cpu: harnessErrorCategoryEntry('cpu')},
  };
  eq(harnessCpuCategoryStates.categories.cpu.state, 'HARNESS_ERROR', 'إعداد: cpu.state=HARNESS_ERROR فعلياً (harnessErrorCategoryEntry الحقيقية)');
  // [استُبدل الدليل — القرار ٨٨-٣]: كان PROVEN_LETTER_D_REF (فئة security)؛
  // بديله دليل مُثبَت من cpu نفسها (اصطناعي) كي يبلغ الاختبار فرع
  // HARNESS_ERROR فعلاً لا EVIDENCE_WRONG_CATEGORY.
  const {categoryStates: csForHarnessCpu, ref: harnessCpuProvenRef} = withSyntheticProvenTestResult(harnessCpuCategoryStates, 'cpu');
  const adjusted = applyV7Adjustments(csForHarnessCpu, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [harnessCpuProvenRef]},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'HARNESS_ERROR',
      '[نصّ 2026-09-21] cpu.state=HARNESS_ERROR: سبب الرفض = HARNESS_ERROR صراحةً — سبب ثامن مُسمّى، لا NO_BASE_LETTER');
}

{
  // فئة غير معروفة — رفض. (UNKNOWN_CATEGORY يُفحَص *قبل* الدليل — evidenceRefs
  // هنا لا يهمّ شكلها.)
  const adjusted = applyV7Adjustments(s10CategoryStates, [
    {category: 'not_a_real_category', direction: 'DOWN', evidenceRefs: ['x']},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, 'UNKNOWN_CATEGORY', 'فئة مجهولة: رفض UNKNOWN_CATEGORY (قبل فحص الدليل)');
}

{
  // فئة أصلاً D — DOWN لا يُنزلها أكثر (لا E). القرار ٤٢/A62: finalLetter
  // يبقى D (لا تغيير رتبة)، وdeterministicLetter يبقى D أيضاً (لم يكن
  // يتغيّر أصلاً هنا حتى قبل هذه المهمّة — نفس الحرف). دليل FAIL اصطناعي
  // من security نفسها (القرار ٩٤ البند ١ — الحرف لم يعد مُثبَتاً).
  //
  // ⚠️ **توقّع مقلوب — القرار ٩٨ البند ١ (2026-09-25 +03)، نصّ المستخدم
  // حرفياً: "letterSource = LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن
  // الحرف الحتمي. التخفيض المقبول الذي لا يغيّر الحرف... يُسجَّل بأنه
  // «مقبول بلا أثر» مع سببه، ويبقى letterSource = DETERMINISTIC."**
  // **[مطلوب صراحةً] الاختبار**: تخفيض فئة حرفها D بالأرضية يُسجَّل «مقبولاً
  // بلا أثر» — لا adjustmentApplied=true بعد اليوم (كان صحيحاً قبل هذا
  // القرار، القاعدة 23/34).
  eq(s10CategoryStates.categories.security.deterministicLetter, 'D', 'افتراض مسبق: security=D على S10 المجذَّر');
  const {categoryStates: csForSecurityAlreadyD, ref: securityAlreadyDRef} = withSyntheticProvenTestResult(s10CategoryStates, 'security');
  const adjusted = applyV7Adjustments(csForSecurityAlreadyD, [
    {category: 'security', direction: 'DOWN', evidenceRefs: [securityAlreadyDRef], reason: 'اختبار — مقبول بلا أثر'},
  ], s10Findings);
  eq(adjusted.categories.security.deterministicLetter, 'D', 'deterministicLetter يبقى D — لا تخفيض تحت السقف الأدنى');
  eq(adjusted.categories.security.finalLetter, 'D', '[A62] finalLetter أيضاً D — نفس الرتبة، لا فرق بين الحقلين هنا');
  eq(adjusted.categories.security.adjustmentApplied, false,
      '[القرار ٩٨/١][كان true قبل هذا القرار] adjustmentApplied=false — لا اختلاف حرف، فلا LLM_ADJUSTED (buildDisplayShapeV7.js:309 يشتقّ letterSource منه مباشرة)');
  ok(Array.isArray(adjusted.categories.security.adjustmentEvidence) && adjusted.categories.security.adjustmentEvidence.length > 0,
      '[القرار ٩٨/١] adjustmentEvidence على categoryStates.categories.security تبقى مكتوبة (سجلّ تدقيقي داخلي — لا تصل العميل، buildDisplayShapeV7 تُصفِّرها عند !adjustmentApplied)');
  ok(typeof adjusted.categories.security.adjustmentReason === 'string' && adjusted.categories.security.adjustmentReason.length > 0,
      '[القرار ٩٨/١] adjustmentReason على categoryStates.categories.security تبقى مكتوبة لنفس السبب');
  eq(adjusted.overall.adjustments[0].applied, true, 'audit.adjustments: applied=true — الدليل مُثبَت ومقبول فعلاً، حتى بلا أثر مرئي');
  eq(adjusted.overall.adjustments[0].fromLetter, 'D', '[القرار ٩٨/١] audit.adjustments[0].fromLetter=D');
  eq(adjusted.overall.adjustments[0].toLetter, 'D', '[القرار ٩٨/١] audit.adjustments[0].toLetter=D — لا اختلاف');
  eq(adjusted.overall.adjustments[0].noEffectReason, ADJUSTMENT_ACCEPTED_NO_EFFECT,
      '[القرار ٩٨/١][مطلوب صراحةً] audit.adjustments[0].noEffectReason = القيمة الثابتة المُصدَّرة (ACCEPTED_NO_EFFECT) — "مقبول بلا أثر" مُسمّاة لا مُستنتَجة من fromLetter===toLetter');
}

{
  // ٦. ✦ الأثر على المرجع الحقيقي بعينه — القرار ٤٢/الجولة الثانية، البند
  // ٣ من رسالة المستخدم: هل يمرّ التعديل الحقيقي الوحيد المُسجَّل بعد
  // الإغلاق؟ مُقيَّم مقابل categoryStates/findings الحقيقيَّين المُعاد
  // حسابهما من فِخّ 34dff2b8.ts.json (نفس منهج اختبار هذا الملفّ لبقية
  // الفِخاخ).
  //
  // ⚠️ **تصحيح 2026-09-23 +03 (اكتُشف أثناء مهمّة لاحقة، غير ذات صلة
  // بمحتوى هذا القسم — عطب عرضي مكتشَف لا مُتعمَّد)**: القيم أدناه
  // ("cpu DOWN"، 8 مراجع، أوّلها deterministicLetter، letter=A) كانت
  // صحيحة عند كتابة هذا القسم، لكن `functions/scripts/out/v7-live-34dff2b8-*.json`
  // أُعيد توليده لاحقاً (commit d5069bd، "نداءان حيّان جديدان على
  // DeepSeek") فحمل تعديلاً **مختلفاً كلّياً** — `gpu DOWN` بأربعة مراجع
  // (أوّلها `coverage` لا `deterministicLetter`)، لا `cpu`. القيم أدناه
  // مُعاد اشتقاقها بالأداة من الملفّ **الحالي** فعلياً (لا تخمين) —
  // النتيجة الجوهرية (`EVIDENCE_NOT_PROVEN`) **لم تتغيّر**، الفئة/المراجع/
  // الحرف الأساسي هي ما تغيّر. راجع تقرير تلك المهمّة (القاعدة 34: كل قارئ
  // لملفّات v7-live-*.json عُدَّد قبل أي تعديل لاحق عليها).
  const raw34dff2b8 = loadJson('34dff2b8.ts.json');
  const functional34dff2b8 = frMap['34dff2b8-ce9e-4b40-86a9-1976c878e195'];
  ok(Array.isArray(functional34dff2b8) && functional34dff2b8.length > 0, 'إعداد: functionalResults حقيقية لفِخّ 34dff2b8 موجودة');
  const findings34 = computeFindings({device: {}, timeSeries: raw34dff2b8.timeSeries || raw34dff2b8, functionalResults: functional34dff2b8, manualResults: []});
  const battery34 = sampleInputsFromRaw({device: {}, timeSeries: raw34dff2b8.timeSeries || raw34dff2b8, functionalResults: functional34dff2b8, manualResults: []});
  const cs34 = computeCategoryStates({
    functionalResults: functional34dff2b8, manualResults: [], dev: null, findings: findings34,
    batterySampleInputs: battery34.sampleInputs, batteryDesignCapacityMah: battery34.design,
  });
  const realAdjustment = loadJson('../../../scripts/out/v7-live-34dff2b8-ce9e-4b40-86a9-1976c878e195.json').parsedResponse.adjustments[0];
  eq(realAdjustment.category, 'gpu', 'إعداد: التعديل الحقيقي الوحيد المُسجَّل مستهدف gpu (بعد إعادة التوليد d5069bd — كان cpu)');
  eq(realAdjustment.evidenceRefs.length, 4, 'إعداد: 4 مراجع دليل حرفياً كما كتبها النموذج (بعد إعادة التوليد — كانت 8)');
  eq(realAdjustment.evidenceRefs[0], 'categoryStates.categories.gpu.coverage', 'إعداد: المرجع الأوّل حرفياً كما وصل (بعد إعادة التوليد — كان .cpu.deterministicLetter)');
  // gpu.deterministicLetter=B لا A هنا — بوّابة LOW_CATEGORY_COVERAGE
  // (أُضيفت في مهمّة لاحقة لهذا القسم، 30ef54a) تُسقِّفه من A إلى B *قبل*
  // وصوله إلى applyV7Adjustments أصلاً؛ نصّ `reason` النموذج نفسه (أدناه)
  // يستشهد بحرف A لأنه كُتب *قبل* وجود تلك البوّابة على هذا الفحص.
  eq(cs34.categories.gpu.deterministicLetter, 'B', 'إعداد: gpu.deterministicLetter=B فعلياً على فِخّ 34dff2b8 المُعاد حسابه (مُسقَّف من A بواسطة LOW_CATEGORY_COVERAGE)');
  const realAdjusted = applyV7Adjustments(cs34, [realAdjustment], findings34);
  eq(realAdjusted.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٤٢/الجولة٢/البند٣] التعديل الحقيقي الوحيد المُسجَّل يُرفَض بعد الإغلاق — أوّل مرجع فيه (categoryStates.categories.gpu.coverage) يُحلّ فعلاً وليس غياباً (=0.4)، لكنه رقم تغطية لا حرف C/D مُثبَت → EVIDENCE_NOT_PROVEN (الحلقة تتوقّف عند أوّل فشل، فلا تُفحَص المراجع الثلاثة الباقية فعلياً — راجع تقرير المهمّة لتقييمها منفردة)');
}

// مصفوفة adjustments فارغة/غائبة — لا رمي، سجلّ فارغ.
{
  const adjusted1 = applyV7Adjustments(s10CategoryStates, [], s10Findings);
  eq(adjusted1.overall.adjustments.length, 0, 'مصفوفة فارغة: سجلّ فارغ');
  const adjusted2 = applyV7Adjustments(s10CategoryStates, undefined, s10Findings);
  eq(adjusted2.overall.adjustments.length, 0, 'undefined: يُعامَل كمصفوفة فارغة، لا رمي');
  eq(adjusted2.overall.disputed, false, 'undefined: disputed=false');
}

console.log('تحقّق 3: applyV7Adjustments — DOWN/UP/رفض بلا دليل/دليل لا يُحلّ/دليل لا يُسنِد/فئة مجهولة/فئة بلا حرف/سقف D — كلّها صحيحة (القرار ٤٢)');

// ═══════════════════════════════════════════════════════════════════════
// 3-ب. اختبار مسار النموذج — القرار ٨٧/٨٨ البند ٣ (نصّ المستخدم حرفياً):
// "اختبار بردّ نموذج مصنوع يطلب تخفيض wireless بدليل «N-10 fail»، ويجب أن
// يرفضه الحارس. فإن قبله: توقّف." — السياق: N-10 fail صار NOT_MEASURED/
// ENVIRONMENT_UNSUITABLE (القرار ٨٦-١)، فلا يجوز أن يبقى نموذج قادراً على
// انتزاع تخفيض wireless مستشهداً بأن N-10 "فشلت" فعلياً (raw.status الخام
// لا يزال 'fail' — القرار ٢ يحذفه من حمولة النموذج لاحقاً، لكن هذا
// الاختبار يتحقّق من طبقة الحارس applyV7Adjustments نفسها بصرف النظر عمّا
// يصل النموذج فعلاً — دفاع في العمق).
//
// حكم مدقّق (بالقراءة، مُتحقَّق هنا بالتشغيل): reportShapeV7.js:145-146 لا
// يفحص محتوى الدليل (مصفوفة غير فارغة فقط) — الرفض الفعلي في
// applyV7Adjustments (evaluateEvidenceRef أعلاه)، بعد أن يمرّ الحارس.
// المقبول مسار نقطي يبدأ بـ`findings` أو `categoryStates`، ويُحكم بمفردة
// اسم المفتاح الأخير: outcome==='FAIL'، أو status==='FIRED'، أو حرف C/D.
// **raw.status:"fail" لا يُقبل أبداً** — lastKeyName='status' لكن قيمته
// 'fail' لا 'FIRED' (الشرط الوحيد على 'status' يطلب 'FIRED' حرفياً).
// ═══════════════════════════════════════════════════════════════════════
{
  // مُدخل الأمر حرفياً: نسخة من فحص b45c8cf6 الحقيقي، N-10 محوَّلة إلى
  // status:'fail'/rawValue:'-95'، بلا findings/dev/بطارية (كما نصّ الأمر
  // بالضبط — dev:null, findings:null, batterySampleInputs:null,
  // batteryDesignCapacityMah:null).
  const F = s10Functional.map((r) => (r.testId === 'N-10' ? Object.assign({}, r, {status: 'fail', rawValue: '-95'}) : r));
  const csN10Fail = computeCategoryStates({
    functionalResults: F, manualResults: [], dev: null, findings: null,
    batterySampleInputs: null, batteryDesignCapacityMah: null,
  });

  // ─── شروط مسبقة (القاعدة 5/16 — تُفحَص بالتشغيل قبل استعمالها) ────────
  const n10Index = csN10Fail.testResults.findIndex((r) => r.testId === 'N-10');
  ok(n10Index >= 0, '[إعداد][القرار ٨٧-٣] N-10 موجودة في testResults');
  eq(csN10Fail.testResults[n10Index].raw.status, 'fail', '[إعداد] raw.status=\'fail\' كما وصل حرفياً (لم يتغيّر — الخام لا يُصحَّح، القاعدة 20)');
  eq(csN10Fail.testResults[n10Index].outcome, 'NOT_MEASURED', '[إعداد] outcome بعد القلب (القرار ٨٦-١) = NOT_MEASURED — لا FAIL');
  ok(!csN10Fail.issues.some((x) => x.id === 'ISS-N-10'), '[إعداد] ISS-N-10 غائب — N-10 لم تعد FAIL/WARNING صحّياً');
  const discIndex = csN10Fail.issues.findIndex((x) => x.id === 'DISC-N-10');
  ok(discIndex >= 0, '[إعداد] DISC-N-10 موجود (NOT_MEASURED مع notMeasuredReason)');
  const L0 = csN10Fail.categories.wireless.deterministicLetter;
  ok(typeof L0 === 'string', '[إعداد] wireless.deterministicLetter حرف حقيقي فعلاً (لا null) على هذا الفحص');

  // ─── ستّة مراجع دليل يحاول بها ردّ نموذج مصنوع الاستشهاد بـ"N-10 fail" —
  // كلّها يجب أن تُرفَض، ولا واحد منها يُغيّر حرف wireless. ─────────────────
  const CANDIDATE_REFS = [
    {ref: `categoryStates.testResults[${n10Index}].outcome`, expectedReason: 'EVIDENCE_NOT_PROVEN',
      note: 'outcome بعد القلب = NOT_MEASURED، ليست FAIL'},
    {ref: `categoryStates.testResults[${n10Index}].raw.status`, expectedReason: 'EVIDENCE_NOT_PROVEN',
      note: 'raw.status=\'fail\' (حرفياً) — lastKeyName=\'status\' يتطلّب \'FIRED\' حصراً، لا \'fail\''},
    {ref: `categoryStates.issues[${discIndex}].id`, expectedReason: 'EVIDENCE_NOT_PROVEN',
      note: 'يُحلّ فعلاً إلى النصّ \'DISC-N-10\' — lastKeyName=\'id\' غير مُصنَّف إطلاقاً (ليس من الثلاثة المُثبَتة)'},
    {ref: 'ISS-N-10', expectedReason: 'EVIDENCE_NOT_FOUND',
      note: 'ليس مساراً أصلاً (شرطة غير مسموحة في segment regex) — لا جذر findings/categoryStates'},
    {ref: 'N-10 fail', expectedReason: 'EVIDENCE_NOT_FOUND',
      note: 'نصّ حرّ بمسافة — ليس مساراً أصلاً'},
    {ref: `testResults[${n10Index}].outcome`, expectedReason: 'EVIDENCE_NOT_FOUND',
      note: 'بلا جذر categoryStates/findings — الجذر المسموح به الوحيدان'},
  ];
  for (const {ref, expectedReason, note} of CANDIDATE_REFS) {
    const adjusted = applyV7Adjustments(csN10Fail, [
      {category: 'wireless', direction: 'DOWN', maxOneBand: true, evidenceRefs: [ref], reason: 'N-10 fail'},
    ], null);
    eq(adjusted.overall.adjustments[0].applied, false,
        `[القرار ٨٧-٣] evidenceRef="${ref}" (${note}) → applied=false`);
    eq(adjusted.overall.adjustments[0].rejectedReason, expectedReason,
        `[القرار ٨٧-٣] evidenceRef="${ref}" → rejectedReason=${expectedReason} (${note})`);
    eq(adjusted.categories.wireless.finalLetter, L0,
        `[القرار ٨٧-٣] evidenceRef="${ref}" → wireless.finalLetter بلا تغيير (يبقى ${L0})`);
  }

  // ─── ضابط قبول — يُثبت أن الاختبار نفسه يرى القبول حين يصله دليل صالح
  // فعلاً (لا أن الرفض أعلاه ناتج عطب في الحارس نفسه لا يقبل شيئاً إطلاقاً).
  // يستهدف فئة الدليل نفسها (security، مصدر SEC-04) — لا wireless — كي لا
  // يعتمد هذا الضابط على سلوك عبر-الفئات الذي يُغلَق لاحقاً (القرار ٨٨
  // البند ٣: ربط الدليل بالفئة المخفَّضة).
  const sec04IndexForN10Fail = csN10Fail.testResults.findIndex((r) => r.testId === 'SEC-04');
  ok(sec04IndexForN10Fail >= 0, '[ضابط قبول][إعداد] SEC-04 موجودة في testResults');
  eq(csN10Fail.testResults[sec04IndexForN10Fail].outcome, 'FAIL', '[ضابط قبول][إعداد] SEC-04.outcome=FAIL فعلياً');
  const acceptedControl = applyV7Adjustments(csN10Fail, [
    {category: 'security', direction: 'DOWN', maxOneBand: true,
      evidenceRefs: [`categoryStates.testResults[${sec04IndexForN10Fail}].outcome`], reason: 'SEC-04 fail — ضابط قبول'},
  ], null);
  eq(acceptedControl.overall.adjustments[0].applied, true,
      '[ضابط قبول] دليل مقبول فعلاً (outcome=FAIL) → applied=true — يُثبت أن الاختبار يرى القبول لا يرفض كل شيء صمّاً');

  console.log(`تحقّق [القرار ٨٧-٣]: ستّة مراجع دليل زائفة لـ"N-10 fail" (wireless) — كلّها مرفوضة، الحرف الحتمي (${L0}) بلا تغيير؛ وضابط القبول (security/SEC-04) applied=true`);
}

// ═══════════════════════════════════════════════════════════════════════
// 3-ج. القرار ٩٤ البند ١ — لا بوّابة من بوّاباتها دليلاً (نصّ الأمر حرفياً):
// "ولا يُقبل ... بوّابة من بوّاباتها." يستبدل قسم القرار ٨٨-٣ (ب) بأكمله
// (كان يميّز بوّابة FIRED+مطبَّقة [ازدواج، رفض] عن FIRED+غير-مطبَّقة
// [تمرّ]) — التمييز نفسه سقط: **كل** بوّابة تُرفَض الآن EVIDENCE_NOT_PROVEN
// بصرف النظر عن cappedThisLetter أو فئتها (القاعدة 23 — استُبدلت توقّعات
// الثلاثة أدناه، لم تُضَف بجوارها؛ EVIDENCE_GATE_ALREADY_APPLIED والدالّة
// التي تنتجها حُذفتا من buildV7Payload.js نفسه — لا رجعة ممكنة لهذا السبب).
// ═══════════════════════════════════════════════════════════════════════
{
  // (كان "ب" — الحالة الأصلية) تخفيض wireless بدليل بوّابتها الحقيقية
  // LOW_CATEGORY_COVERAGE (FIRED، cappedThisLetter=true فعلياً على S10) —
  // **كان** يُرفَض EVIDENCE_GATE_ALREADY_APPLIED (ازدواج)؛ يُرفَض الآن
  // EVIDENCE_NOT_PROVEN (لا بوّابة تُثبَت شيئاً بتاتاً بعد اليوم).
  const wirelessGate = s10CategoryStates.categories.wireless.gatesApplied[0];
  ok(wirelessGate && wirelessGate.name === 'LOW_CATEGORY_COVERAGE', 'إعداد: wireless.gatesApplied[0] هي LOW_CATEGORY_COVERAGE فعلياً');
  eq(wirelessGate.status, 'FIRED', 'إعداد: wireless.gatesApplied[0].status=FIRED فعلياً على S10');
  eq(wirelessGate.cappedThisLetter, true, 'إعداد: wireless.gatesApplied[0].cappedThisLetter=true فعلياً — أثرها مطبَّق في حرف wireless بالفعل');
  const wirelessBaselineFinalLetter = s10CategoryStates.categories.wireless.finalLetter;
  eq(wirelessBaselineFinalLetter, 'B', 'إعداد: wireless.finalLetter=B فعلياً (مُسقَّف من A بهذه البوّابة بالذات)');

  const adjustedWireless = applyV7Adjustments(s10CategoryStates, [
    {category: 'wireless', direction: 'DOWN', maxOneBand: true,
      evidenceRefs: ['categoryStates.categories.wireless.gatesApplied[0].status'], reason: 'LOW_CATEGORY_COVERAGE — كان ضابط الازدواج'},
  ], s10Findings);
  eq(adjustedWireless.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١] تخفيض wireless بدليل بوّابتها (FIRED+مطبَّقة فعلاً) → applied=false — يُرفض كأيّ بوّابة الآن');
  eq(adjustedWireless.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١][كان EVIDENCE_GATE_ALREADY_APPLIED قبل هذا القرار] السبب الآن: لا بوّابة تُثبَت شيئاً بتاتاً — status لم يعد يُفحَص في isProvenSupportiveEvidence، بصرف النظر عن cappedThisLetter');
  eq(adjustedWireless.categories.wireless.finalLetter, wirelessBaselineFinalLetter,
      '[القرار ٩٤/١] wireless.finalLetter بلا تغيير (يبقى B)');

  // (كان الضابط الأوّل) نفس البوّابة، لكن FIRED بلا cappedThisLetter —
  // **كانت** تمرّ (applied=true، لا ازدواج حقيقي)؛ تُرفَض الآن أيضاً —
  // التمييز capped/غير-capped سقط كلّياً، كلتاهما بوّابة الآن.
  const adjustedFiredNotCapped = applyV7Adjustments(s10CategoryStatesWithCpuGateFired, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_GATE_FIRED_REF], reason: 'FIRED بلا ازدواج — كان ضابط قبول'},
  ], s10Findings);
  eq(adjustedFiredNotCapped.overall.adjustments[0].applied, false,
      '[القرار ٩٤/١][كان applied=true قبل هذا القرار] بوّابة FIRED من نفس الفئة، cappedThisLetter=false — تُرفَض الآن أيضاً، لا فرق بين capped وغير-capped بعد اليوم');
  eq(adjustedFiredNotCapped.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١] نفس السبب — لا بوّابة تُثبَت شيئاً');

  // (كان الضابط الثاني) نفس البوّابة المُطبَّقة، لكن مُستشهَداً بها على فئة
  // أخرى — **كانت** EVIDENCE_WRONG_CATEGORY (الشرط أ يسبق ب)؛ الآن
  // EVIDENCE_NOT_PROVEN يسبق الاثنين معاً (شقّ الإثبات هو الأوّل).
  const adjustedCappedWrongCategory = applyV7Adjustments(s10CategoryStates, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: ['categoryStates.categories.wireless.gatesApplied[0].status'], reason: 'بوّابة فئة أخرى مطبَّقة'},
  ], s10Findings);
  eq(adjustedCappedWrongCategory.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[القرار ٩٤/١][كان EVIDENCE_WRONG_CATEGORY قبل هذا القرار] بوّابة wireless مُستشهَد بها لتخفيض cpu → EVIDENCE_NOT_PROVEN الآن (شقّ الإثبات يسبق شقّ الفئة، ولا بوّابة تُثبَت شيئاً بعد اليوم — فلا حاجة لبلوغ فحص الفئة أصلاً)');

  console.log('تحقّق [القرار ٩٤/١][3-ج]: كل استشهاد ببوّابة (مطبَّقة أو لا، من فئة التعديل أو من غيرها) يُرفَض الآن EVIDENCE_NOT_PROVEN بلا استثناء — التمييز السابق (ازدواج/فئة) سقط كلّياً');
}
{
  // (كان الشرط أ) — findings بلا خريطة صريحة: كل دليل بجذر findings يُرفَض
  // لسبب الفئة **حتى لو كان "مُثبَتاً" فعلاً** (بعد القرار ٩٤-١: outcome=FAIL
  // هو الوحيد الباقي — findings.js لا يحمل هذه المفردة بمفردات categoryStates
  // فعلياً، فهذا اختبار على evaluateEvidenceRef مباشرة لعزل الشرط عن واقع
  // أن findings لا تنتجه أصلاً). ⚠️ **استُبدل شكل الدليل المُصطنَع مرّتين**:
  // كان {status:'FIRED'} (لم يعد "مُثبَتاً" بتاتاً)، صار {outcome:'FAIL'} —
  // ثم **القرار ٩٩ البند ١** أضاف شقّاً جديداً يفحص healthBearing على
  // كائن {outcome:'FAIL'} المُصطنَع؛ بلا هذا الحقل يُرفَض EVIDENCE_EXCLUDED_FROM_GRADE
  // قبل بلوغ شقّ الفئة المقصود هنا — أُضيف healthBearing:true صراحةً كي
  // يبقى هذا الاختبار يعزل شقّ الفئة وحده، لا شقّاً آخر بالصدفة.
  const {evaluateEvidenceRef} = buildV7PayloadInternal;
  const fakeProvenFindingsRoots = {
    findings: {fabricatedTest: {outcome: 'FAIL', healthBearing: true}}, // شكل لن ينتجه findings.js حقيقةً — لعزل شقّ الفئة فقط
    categoryStates: s10CategoryStates,
  };
  const verdict = evaluateEvidenceRef('findings.fabricatedTest.outcome', fakeProvenFindingsRoots, 'cpu');
  eq(verdict.ok, false, '[القرار ٨٨-٣][أ] دليل بجذر findings يُرفَض حتى لو كانت قيمته "مُثبَتة" فعلاً (outcome=FAIL)');
  eq(verdict.reason, 'EVIDENCE_WRONG_CATEGORY',
      '[القرار ٨٨-٣][أ] السبب: لا خريطة finding→فئة صريحة اليوم (مؤجَّلة بنصّ الأمر) — فكل دليل findings يُرفَض لسبب الفئة بصرف النظر عن إثباته');
  console.log('تحقّق [القرار ٨٨-٣][أ]: دليل findings يُرفَض دائماً لغياب خريطة صريحة — حتى مع قيمة مُثبَتة فعلاً (اختبار عزل مباشر على evaluateEvidenceRef)');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. اختبار انحدار إلزامي (نصّ P1.4، تعديل 2026-09-20 على P1.4، والحارس):
//    "التجزئات الثلاث (issueSetHash/lettersHash/numbersHash) متطابقة
//    بتّاً بين نداءين على Findings ثابتة." نتحقّق من ركنين:
//    (أ) computeCategoryStates حتمية — نداءان بنفس المُدخلات ينتجان نفس
//        التجزئات الثلاث بالضبط (لا اعتماد خفيّ على وقت/عشوائية).
//    (ب) applyV7Adjustments (طبقة جديدة في هذه المهمّة) **لا تُغيّر** هذه
//        التجزئات — فهي خاصّية الجزء الحتمي وحده، ولا يجوز أن يُفسدها
//        استهلاك مخرَج نموذج غير حتمي فوقها.
// ═══════════════════════════════════════════════════════════════════════
{
  const call1 = computeCategoryStates({
    functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
    batterySampleInputs: s10Battery.sampleInputs, batteryDesignCapacityMah: s10Battery.design,
  });
  const call2 = computeCategoryStates({
    functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
    batterySampleInputs: s10Battery.sampleInputs, batteryDesignCapacityMah: s10Battery.design,
  });
  eq(call1.issueSetHash, call2.issueSetHash, '[انحدار] issueSetHash متطابق بتّاً بين نداءين على Findings ثابتة');
  eq(call1.lettersHash, call2.lettersHash, '[انحدار] lettersHash متطابق بتّاً بين نداءين على Findings ثابتة');
  eq(call1.numbersHash, call2.numbersHash, '[انحدار] numbersHash متطابق بتّاً بين نداءين على Findings ثابتة');

  // evidenceRefs مُثبَتة (لا ['x'] ولا رقم خام) + findings مُمرَّرة — القرار
  // ٤٢ البند ١/٢ يرفض أيّاً منهما (EVIDENCE_NOT_FOUND/EVIDENCE_NOT_PROVEN)
  // قبل بلوغ فرع DOWN/UP، فكان سيُبطل هذا الاختبار (لا شيء يُطبَّق ليُختبَر
  // ثبات التجزئات تحته). [استُبدل دليل cpu — القرار ٨٨-٣]: كان
  // PROVEN_LETTER_D_REF (فئة أخرى)؛ بديله دليل مُثبَت من cpu نفسها.
  // [استُبدل دليل security أيضاً — القرار ٩٤ البند ١]: كان PROVEN_LETTER_D_REF
  // (حرف) — لم يعد مُثبَتاً بتاتاً؛ بديله دليل FAIL اصطناعي من security نفسها.
  const {categoryStates: call1WithCpuFail, ref: call1CpuProvenRef} = withSyntheticProvenTestResult(call1, 'cpu');
  const {categoryStates: call1ForAdjustments, ref: call1SecurityProvenRef} = withSyntheticProvenTestResult(call1WithCpuFail, 'security');
  const withAdjustments = applyV7Adjustments(call1ForAdjustments, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [call1CpuProvenRef]},
    {category: 'security', direction: 'UP', evidenceRefs: [call1SecurityProvenRef]},
  ], s10Findings);
  eq(withAdjustments.issueSetHash, call1.issueSetHash, '[انحدار] applyV7Adjustments لا يُغيّر issueSetHash (خاصّية الجزء الحتمي وحده)');
  // [A62] النصّ القديم هنا قال "حتّى لو غيّر categories.cpu.deterministicLetter
  // فعلياً" — لم يعد صحيحاً: DOWN المقبول يغيّر finalLetter الآن، لا
  // deterministicLetter (يبقى كما هو أصلاً). كلا التأكيدين مطلوبان معاً.
  eq(call1.categories.cpu.deterministicLetter, withAdjustments.categories.cpu.deterministicLetter,
      '[A62] deterministicLetter لم يتغيّر بتطبيق DOWN — كما هو قبل وبعد applyV7Adjustments');
  ok(withAdjustments.categories.cpu.finalLetter !== call1.categories.cpu.finalLetter,
      '[A62] لكن finalLetter تغيّر فعلياً (هو المُستعمَل فعلياً في overall أدناه)');
  eq(withAdjustments.lettersHash, call1.lettersHash, '[انحدار] applyV7Adjustments لا يُغيّر lettersHash المحفوظ (حتّى لو غيّر categories.cpu.finalLetter فعلياً)');
  eq(withAdjustments.numbersHash, call1.numbersHash, '[انحدار] applyV7Adjustments لا يُغيّر numbersHash');
}
console.log('تحقّق 4 [انحدار إلزامي]: التجزئات الثلاث حتمية ولا يُفسدها تطبيق adjustments فوقها');

// ═══════════════════════════════════════════════════════════════════════
// 5. اختبار إلزامي (نصّ المهمّة): تعديل DOWN مقبول على فئة → overall
//    يُعاد اشتقاقه كاملاً (لا نسخ overall القديمة)، والحرف الجديد قابل
//    لإعادة الحساب من الجدول — اختبار آلي يعيد الاشتقاق ويطابق.
//
//    (أ) على فِخّ S10 الحقيقي (b45c8cf6): overall.letter يبقى C — مُقفَل
//        ببوّابة ROOT_DETECTED مهما انخفض متوسّط الفئات المقيسة. لكن
//        measuredCategoriesMean **يتغيّر فعلياً** — هذا بالضبط
//        الفرق بين الإصلاح والعطب: العطب القديم كان يُبقيها 100 حرفياً
//        (نسخ overall.القديمة بلا إعادة اشتقاق).
//    (ب) سيناريو اصطناعي (بلا بوّابات، تصنيف صريح لا فِخّ حقيقي — بنفس نمط
//        "[اصطناعي]" في categoryStates.test.js) يُثبت أن الحرف العامّ
//        نفسه يمكن أن ينقلب فعلياً حين لا بوّابة تحجبه، لا فقط الرقم
//        الداخلي.
// ═══════════════════════════════════════════════════════════════════════
{
  // (أ) فِخّ حقيقي — S10، تعديل DOWN على cpu (A/100 → B/84، البند 1 من
  // الإصلاح: score يُقصّ لسقف نطاق الحرف الجديد، لا الحرف وحده).
  const before = s10CategoryStates.overall;
  // القاعدة 23 — استبدال القيمة المرجعية 100 ⇐ 93.58974358974359 (أمر
  // مستخدم 2026-09-27 +03 «الإعدادات لا تُنزل الحرف»، نفس سبب categoryStates.
  // test.js:397 بالضبط): security انتقلت من PARTIAL إلى MEASURED (بعد
  // استبعاد SEC-01/05/06/07 من healthBearing، تغطيتها صارت 6/6=100%)
  // فدخلت لأوّل مرّة في المتوسّط المرجَّح بدرجتها 83.33 (وزن 15) — بدل ألّا
  // تُحسَب إطلاقاً. قيمة مقيسة بتشغيل مباشر (computeCategoryStates على نفس
  // فِخّ S10)، لا مكتوبة يدوياً.
  eq(before.measuredCategoriesMean, 93.58974358974359, 'مسبق [القاعدة 23]: measuredCategoriesMean=93.58974358974359 على S10 قبل أي تعديل (كانت 100 قبل أمر 2026-09-27)');
  eq(before.letter, 'C', 'مسبق: letter=C مقفَل ببوّابة ROOT_DETECTED رغم ذلك');

  // [استُبدل الدليل — القرار ٨٨-٣، ثم القرار ٩٤-١]: كان PROVEN_LETTER_D_REF
  // (فئة أخرى)، ثم PROVEN_CPU_GATE_FIRED_REF (بوّابة — لم تعد مُثبَتة
  // بتاتاً بعد اليوم)؛ بديله PROVEN_CPU_FAIL_REF (FAIL من cpu نفسها،
  // اصطناعي) — لا يمسّ categories.cpu.score (100 الأصلي، من
  // computeCategoryStates حرفياً) — الآلية لا تفرّق بأيّ دليل طُبِّق
  // التخفيض، فقط أنّه طُبِّق.
  const adjusted = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'اختبار إعادة الاشتقاق'},
  ], s10Findings);

  // إعادة اشتقاق مستقلّة — نداء ثانٍ صريح على deriveOverallFromCategories
  // بنفس categories/gates بعد التعديل، من طبقة الاختبار لا من buildV7Payload.js
  // نفسه (لولا هذا الاستقلال لكان التحقّق يعيد اختبار نفسه لا الإصلاح).
  const rederived = deriveOverallFromCategories(adjusted.categories, s10CategoryStates.gates);

  // القاعدة 23 — استبدال القيمة المرجعية 95 ⇐ 90.51282051282051 (السبب
  // نفسه أعلاه: security تدخل الآن المتوسّط بدرجتها 83.33 ووزنها 15، فوق
  // انخفاض cpu نفسه إلى 84). قيمة مقيسة بتشغيل مباشر (applyV7Adjustments
  // على نفس المُدخل)، لا الصيغة اليدوية القديمة (7.5*84+2*100+4.5*100+
  // 6*100+4*100)/24 التي لم تعد تعكس أوزان CATEGORY_WEIGHTS الفعلية أصلاً
  // (gpu=4.5 لا 2، display=2 لا 4.5) ولا تشمل security بعد اليوم.
  eq(adjusted.overall.measuredCategoriesMean, 90.51282051282051,
      'S10: measuredCategoriesMean يتغيّر فعلياً بعد DOWN على cpu (93.58974358974359 → 90.51282051282051) — العطب القديم كان يُبقيه ثابتاً بلا إعادة اشتقاق');
  ok(adjusted.overall.measuredCategoriesMean !== before.measuredCategoriesMean,
      'S10: overall أُعيد اشتقاقه فعلياً — ليس نسخة من overall القديمة (العطب المُصلَح)');
  eq(rederived.measuredCategoriesMean, adjusted.overall.measuredCategoriesMean,
      'S10: measuredCategoriesMean في adjusted.overall قابل لإعادة الاشتقاق حرفياً من categories المُعدَّلة + gates');
  eq(rederived.letter, adjusted.overall.letter,
      'S10: letter في adjusted.overall قابل لإعادة الاشتقاق حرفياً من categories المُعدَّلة + gates');
  eq(rederived.letterSource, adjusted.overall.letterSource,
      'S10: letterSource في adjusted.overall قابل لإعادة الاشتقاق حرفياً من categories المُعدَّلة + gates');
  eq(rederived.coverage, adjusted.overall.coverage,
      'S10: coverage في adjusted.overall قابل لإعادة الاشتقاق حرفياً من categories المُعدَّلة + gates');
  eq(adjusted.overall.letter, 'C', 'S10: letter يبقى C — ROOT_DETECTED يقفله بصرف النظر عن انخفاض المتوسّط داخل نطاق B/A');
  eq(adjusted.overall.letterSource, 'GATE:ROOT_DETECTED', 'S10: letterSource يبقى GATE:ROOT_DETECTED — لم يتغيّر مصدر القفل');

  // (ب) سيناريو اصطناعي — بلا بوّابات (gates=[])، فئة واحدة مقيسة (security،
  // وزن 15) على حافّة A/B (score=85 بالضبط) — تعديل DOWN عليها يُفترَض أن
  // يقلب overall.letter نفسه من A إلى B، لا الرقم الداخلي وحده. مُعلَّم
  // "اصطناعي" صراحة (بنفس نمط noDataAtAll في categoryStates.test.js) —
  // لا فِخّ حقيقي في هذا المستودع يخلو من بوّابة مسيطرة كهذا.
  const syntheticCategories = {};
  for (const cat of CATEGORIES) {
    syntheticCategories[cat] = {
      category: cat, coverage: 0, state: 'UNMEASURED',
      declaredCount: 0, executedCount: 0, passCount: 0, failCount: 0, warningCount: 0,
      score: null, deterministicLetter: null, gatesApplied: [], testIds: [], llmSuggestedLetter: null,
    };
  }
  syntheticCategories.security = {
    category: 'security', coverage: 1, state: 'MEASURED',
    declaredCount: 4, executedCount: 4, passCount: 4, failCount: 0, warningCount: 0,
    score: 85, deterministicLetter: 'A',
    gatesApplied: [], testIds: ['SEC-01'], llmSuggestedLetter: null,
  };
  // القرار ٩٤ البند ١ — بوّابة اصطناعية FIRED (كانت المفردة المُعلَنة
  // المُثبَتة أعلاه، القرار ٤٢/٢) لم تعد مُثبَتة بتاتاً بعد اليوم؛ بديلها
  // testResults[] اصطناعية بعنصر واحد FAIL من فئة security نفسها — الشقّ
  // الوحيد الباقي الذي "يُثبت" شيئاً (isProvenSupportiveEvidence).
  const syntheticTestResults = [{category: 'security', testId: 'SEC-SYNTHETIC-FAIL', outcome: 'FAIL', kind: 'STATE', healthBearing: true}];
  const syntheticCategoryStates = {categories: syntheticCategories, overall: {harnessError: false}, gates: [], testResults: syntheticTestResults};

  const syntheticBefore = deriveOverallFromCategories(syntheticCategories, []);
  eq(syntheticBefore.measuredCategoriesMean, 85, '[اصطناعي] قبل التعديل: measuredCategoriesMean=85 (فئة security وحدها المقيسة)');
  eq(syntheticBefore.letter, 'A', '[اصطناعي] قبل التعديل: letter=A (85 على حافّة نطاق A تماماً، بلا بوّابات)');
  eq(syntheticBefore.letterSource, 'BAND', '[اصطناعي] letterSource=BAND — بلا بوّابات إطلاقاً (gates=[])');

  // evidenceRefs بجذر categoryStates — يُحلّ مقابل syntheticCategoryStates
  // نفسه (الوسيط الأول لـapplyV7Adjustments)، بلا حاجة لـfindings حقيقية
  // (سيناريو اصطناعي بحت، لا فِخّ). المرجع outcome=FAIL مُثبَت (القرار ٩٤
  // البند ١) — ['x'] الأصلية/رقم score الخام/status=FIRED (بوّابة، القرار
  // ٤٢-٢ سابقاً) كلّها كانت سترفض الآن.
  const syntheticAdjusted = applyV7Adjustments(syntheticCategoryStates, [
    {category: 'security', direction: 'DOWN', evidenceRefs: ['categoryStates.testResults[0].outcome'], reason: 'اصطناعي'},
  ]);
  const syntheticRederived = deriveOverallFromCategories(syntheticAdjusted.categories, []);

  ok(CATEGORY_WEIGHTS.security === 15, 'مسبق: وزن security=15 (يؤكّد أنها الفئة الوحيدة المُسهِمة في المتوسّط هنا)');
  eq(syntheticAdjusted.categories.security.score, 84, '[اصطناعي] security.score يُقصّ إلى BAND_MAX.B=84 بعد DOWN (كان 85)');
  eq(syntheticAdjusted.overall.measuredCategoriesMean, 84, '[اصطناعي] measuredCategoriesMean=84 بعد التعديل (الفئة الوحيدة المقيسة)');
  eq(syntheticAdjusted.overall.letter, 'B', '[اصطناعي] overall.letter ينقلب فعلياً من A إلى B — لا بوّابة تحجبه هنا (العطب القديم كان يُبقيه A)');
  eq(syntheticAdjusted.overall.letterSource, 'BAND', '[اصطناعي] letterSource يبقى BAND — الانقلاب من الرقم مباشرة لا من بوّابة');
  eq(syntheticRederived.letter, syntheticAdjusted.overall.letter,
      '[اصطناعي] الحرف الجديد (B) قابل لإعادة الحساب من الجدول المُعدَّل مباشرة — نداء مستقلّ يطابق');
  eq(syntheticRederived.measuredCategoriesMean, syntheticAdjusted.overall.measuredCategoriesMean,
      '[اصطناعي] measuredCategoriesMean الجديد قابل لإعادة الحساب من الجدول المُعدَّل مباشرة — نداء مستقلّ يطابق');
}
console.log('تحقّق 5 [إلزامي]: DOWN مقبول → overall يُعاد اشتقاقه كاملاً، والنتيجة قابلة لإعادة الحساب من الجدول (فِخّ حقيقي + سيناريو اصطناعي بانقلاب حرف فعلي)');

// ═══════════════════════════════════════════════════════════════════════
// ٦. الحقول السبعة المُستبعَدة من حمولة النموذج — حرس بالاسم لا بالبايت
//    (الفجوة المرصودة، أمر المهمّة 2026-09-22 +03 البند ٤ حرفياً: "اختبار
//    يُثبت غياب الحقول السبعة حقلاً حقلاً بأسمائها، لا برقم مجمَّع. ومعه
//    تحقّق أنها حاضرة في display وفي المستند... الاستبعاد يُحرَس بالاسم لا
//    بالبايت — والثابت يبقى بوّابة ثانية لا وحيدة").
//
//    الثابت المقصود: scripts/measure-callAIv7-live.js:TARGETS[].expectedPayloadBytes
//    (بوّابة payloadBytes رقمية مجمَّعة — تبقى كما هي، أولى لا وحيدة). هذا
//    القسم بوّابة **ثانية** مستقلّة: فحص مباشر بالاسم لكل حقل من السبعة،
//    لا رقم بايت واحد قد يخفي إسقاطاً ناقصاً أو تغييراً آخر بالصدفة بنفس
//    الفارق.
//
//    القائمتان مستوردتان من buildV7Payload.js._internal مباشرة (لا نسخة
//    حرفية هنا) — القاعدة 24 بامتدادها: لو صارت الحقول ثمانية لاحقاً هذا
//    الاختبار يتبعها تلقائياً، لا قائمة تتخلّف عن مصدرها.
// ═══════════════════════════════════════════════════════════════════════
{
  const EXCLUDED_CATEGORY_FIELDS = buildV7PayloadInternal.MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS;
  const EXCLUDED_OVERALL_FIELDS = buildV7PayloadInternal.MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS;
  // ⚠️ تحديث 2026-09-23 +03 (أمر مستخدم، البند ٦) — overall.llmOverall
  // انضمّ إلى قائمة الاستبعاد (حقل ميّت، null دائماً — لا معلومة). صار
  // العدد ثمانية لا سبعة؛ العدّان أدناه من المصدر مباشرة (لا رقم مُقفَل)
  // فيتبعان أي تغيير لاحق تلقائياً — القاعدة 24.
  // S3 (أمر مستخدم 2026-10-01 +03) — harnessErrorMessage انضمّ إلى
  // الاستبعاد (جملة عرض بشري، النموذج يكفيه harnessErrorReason الخامّ).
  // صار العدد أربعة لا ثلاثة؛ تسعة لا ثمانية معاً — من المصدر مباشرة.
  eq(EXCLUDED_CATEGORY_FIELDS.length, 5, 'إعداد: خمسة حقول فئة مُستبعَدة فعلياً (من المصدر، لا عدّ يدوي)');
  eq(EXCLUDED_OVERALL_FIELDS.length, 4, 'إعداد: أربعة حقول overall مُستبعَدة فعلياً (adjustments/disputed/llmOverall/harnessErrorMessage — من المصدر، لا عدّ يدوي)');
  eq(EXCLUDED_CATEGORY_FIELDS.length + EXCLUDED_OVERALL_FIELDS.length, 9, 'إعداد: تسعة حقول معاً الآن (كانت ثمانية) — harnessErrorMessage أُضيف (S3، أمر 2026-10-01)');

  // تعديل DOWN حقيقي مقبول (نفس مرجع القسم ٥-أ، بعد استبداله مرّتين —
  // القرار ٨٨-٣ ثم القرار ٩٤-١: PROVEN_CPU_FAIL_REF، دليل FAIL مُثبَت من
  // cpu نفسها) — يضمن أن الحقول الخمسة على categories.cpu تحمل قيماً
  // **غير افتراضية** فعلاً قبل الفحص. لولا هذا: غياب حقل بقيمته الافتراضية
  // (null/false) في JSON.stringify لا يُميَّز بصرياً عن غيابه الفعلي — فحص
  // لا يُثبت شيئاً.
  const withReal = applyV7Adjustments(s10CategoryStatesWithCpuFail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [PROVEN_CPU_FAIL_REF], reason: 'تحقّق الإسقاط بالاسم — القسم ٦'},
  ], s10Findings);

  ok(withReal.categories.cpu.finalLetter !== null && withReal.categories.cpu.finalLetter !== withReal.categories.cpu.deterministicLetter,
      'إعداد: categories.cpu.finalLetter قيمة مميَّزة فعلاً (تغيّر عن deterministicLetter) — لا افتراضي');
  eq(withReal.categories.cpu.adjustmentApplied, true, 'إعداد: categories.cpu.adjustmentApplied=true فعلاً — لا الافتراضي false');
  ok(Array.isArray(withReal.categories.cpu.adjustmentEvidence) && withReal.categories.cpu.adjustmentEvidence.length > 0,
      'إعداد: categories.cpu.adjustmentEvidence مصفوفة غير فارغة فعلاً — لا الافتراضي null');
  ok(typeof withReal.categories.cpu.adjustmentReason === 'string' && withReal.categories.cpu.adjustmentReason.length > 0,
      'إعداد: categories.cpu.adjustmentReason نصّ غير فارغ فعلاً — لا الافتراضي null');
  ok(withReal.categories.cpu.llmSuggestedLetter !== null, 'إعداد: categories.cpu.llmSuggestedLetter قيمة فعلية — لا الافتراضي null');
  eq(withReal.overall.adjustments.length, 1, 'إعداد: overall.adjustments يحمل سجلّاً واحداً فعلاً — لا الافتراضي []');
  eq(typeof withReal.overall.disputed, 'boolean', 'إعداد: overall.disputed حاضر فعلاً على المصدر');

  const {body, userMessage} = buildV7Payload({
    findings: s10Findings, categoryStates: withReal,
    language: 'ar', scanId: 'test-scan-7fields', isFreeTrial: false, previousScan: null,
  });

  // الغياب بالاسم — كل حقل من السبعة على حدة، حقلاً حقلاً، لا رقم بايت
  // مجمَّع (الفجوة المرصودة تحديداً).
  for (const field of EXCLUDED_CATEGORY_FIELDS) {
    ok(!Object.prototype.hasOwnProperty.call(body.categoryStates.categories.cpu, field),
        `[الحقول السبعة] body.categoryStates.categories.cpu بلا مفتاح "${field}" — مُسقَط بالاسم لا بالبايت`);
  }
  for (const field of EXCLUDED_OVERALL_FIELDS) {
    ok(!Object.prototype.hasOwnProperty.call(body.categoryStates.overall, field),
        `[الحقول السبعة] body.categoryStates.overall بلا مفتاح "${field}" — مُسقَط بالاسم لا بالبايت`);
  }
  // بوّابة على نفس الالتزام عبر userMessage النصّي (ما يصل النموذج فعلياً
  // حرفياً، لا الكائن الوسيط body فقط) — لا وجود لاسم أيٍّ من السبعة
  // كمفتاح JSON على الإطلاق.
  for (const field of [...EXCLUDED_CATEGORY_FIELDS, ...EXCLUDED_OVERALL_FIELDS]) {
    ok(!userMessage.includes(`"${field}"`),
        `[الحقول السبعة] userMessage النصّي لا يحمل المفتاح "${field}" حرفياً`);
  }

  // الحضور في المصدر الأصلي (categoryStates غير المُعدَّلة للحمولة) — يبقى
  // كما هو، لا إسقاط عالمي. هذا هو المصدر الذي يستهلكه display
  // (buildDisplayShapeV7.js) والمستند (Firestore) فعلياً — القرار المُقتبَس
  // حرفياً في buildV7Payload.js:54-60: "تبقى في display وفي المستند،
  // وتُسقط عند بناء الحمولة" و"القرّاء الآخرون... يستهلكون تلك النسخة
  // الأصلية مباشرة من runAnalysisInternal.js، لا مخرَج هذه الدالّة". لا
  // استدعاء buildDisplayShapeV7 هنا (خارج نطاق وحدة buildV7Payload —
  // اختبارها في buildDisplayShapeV7.test.js) — التحقّق المباشر أدناه على
  // نفس الكائن (withReal) الذي تستهلكه تلك الطبقات فعلياً.
  for (const field of EXCLUDED_CATEGORY_FIELDS) {
    ok(Object.prototype.hasOwnProperty.call(withReal.categories.cpu, field),
        `[الحقول السبعة] المصدر الأصلي (categoryStates.categories.cpu، مصدر display/المستند) يحمل "${field}" — لم يُسقَط عالمياً`);
  }
  for (const field of EXCLUDED_OVERALL_FIELDS) {
    ok(Object.prototype.hasOwnProperty.call(withReal.overall, field),
        `[الحقول السبعة] المصدر الأصلي (categoryStates.overall، مصدر display/المستند) يحمل "${field}" — لم يُسقَط عالمياً`);
  }
}
console.log('تحقّق 6 [الفجوة المرصودة]: الحقول السبعة (صارت ثمانية) المُستبعَدة تُحرَس بالاسم حقلاً حقلاً — غائبة من الحمولة (body وuserMessage)، حاضرة في المصدر (display/المستند)');

// ═══════════════════════════════════════════════════════════════════════
// ٧. حقلا gate الداخليّان — belowThreshold/allNonMeasurement (أمر
//    2026-09-23 +03، البند ٢): تسرّبا إلى حمولة النموذج عبر
//    overall.gatesApplied/categories.<cat>.gatesApplied (+1146 بايت،
//    functions/scripts/out/gate-cost-options-*.json) — يُستبعَدان وحدهما
//    من كائن gate، لا coveragePct/source/status/cappedThisLetter/
//    cappedOverall/note (قرار مستخدم صريح: تبقى — راجع تعليق
//    MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS في buildV7Payload.js).
//    نفس منهج القسم ٦ — بالاسم حقلاً حقلاً، لا رقم بايت مجمَّع.
// ═══════════════════════════════════════════════════════════════════════
{
  const EXCLUDED_GATE_FIELDS = buildV7PayloadInternal.MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS;
  deepEq(EXCLUDED_GATE_FIELDS, ['belowThreshold', 'allNonMeasurement'],
      'إعداد: حقلا gate المُستبعَدان بالاسم (من المصدر، لا عدّ يدوي)');

  // فِخّ حقيقي: gpu على S10 — بوّابة LOW_CATEGORY_COVERAGE مُطلَقة فعلياً
  // (belowThreshold=true وallNonMeasurement=true معاً، مُتحقَّق مسبقاً في
  // categoryStates.test.js) — قيم غير افتراضية (true لا false/null).
  const gpuSourceGate = s10CategoryStates.categories.gpu.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE');
  ok(gpuSourceGate && gpuSourceGate.belowThreshold === true && gpuSourceGate.allNonMeasurement === true,
      'إعداد: gpu.gatesApplied LOW_CATEGORY_COVERAGE على S10 — belowThreshold/allNonMeasurement=true معاً فعلياً (لا افتراضي)');

  const {body: gateBody, userMessage: gateMsg} = buildV7Payload({
    findings: s10Findings, categoryStates: s10CategoryStates,
    language: 'ar', scanId: 'test-scan-gate-fields', isFreeTrial: false, previousScan: null,
  });

  const gpuOverallGate = gateBody.categoryStates.overall.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE' && g.category === 'gpu');
  const gpuCatGate = gateBody.categoryStates.categories.gpu.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE');
  for (const field of EXCLUDED_GATE_FIELDS) {
    ok(!Object.prototype.hasOwnProperty.call(gpuOverallGate, field),
        `[حقلا gate][overall] gpu LOW_CATEGORY_COVERAGE بلا مفتاح "${field}"`);
    ok(!Object.prototype.hasOwnProperty.call(gpuCatGate, field),
        `[حقلا gate][الفئة] gpu LOW_CATEGORY_COVERAGE بلا مفتاح "${field}"`);
    ok(!gateMsg.includes(`"${field}"`), `[حقلا gate] userMessage لا يحمل المفتاح "${field}" حرفياً`);
    ok(Object.prototype.hasOwnProperty.call(gpuSourceGate, field),
        `[حقلا gate] المصدر الأصلي (categoryStates.categories.gpu.gatesApplied) يحمل "${field}" — لم يُسقَط عالمياً`);
  }
  // الحقول التي **تبقى** — تحقّق إيجابي، لا افتراض بالسكوت (القاعدة 22).
  for (const field of ['name', 'category', 'ceilingLetter', 'status', 'source', 'coveragePct']) {
    ok(Object.prototype.hasOwnProperty.call(gpuOverallGate, field),
        `[حقول تبقى][overall] gpu LOW_CATEGORY_COVERAGE يحمل "${field}" — قرار مستخدم صريح بالإبقاء`);
  }
  ok(Object.prototype.hasOwnProperty.call(gpuCatGate, 'cappedThisLetter'), '[حقول تبقى][الفئة] cappedThisLetter حاضر');
  ok(Object.prototype.hasOwnProperty.call(gpuOverallGate, 'cappedOverall'), '[حقول تبقى][overall] cappedOverall حاضر');
  ok(Object.prototype.hasOwnProperty.call(gpuOverallGate, 'note'), '[حقول تبقى][overall] note حاضر (gpu: "الحرف العامّ أسوأ من السقف أصلاً — لا أثر")');
}
console.log('تحقّق ٧: حقلا gate الداخليّان (belowThreshold/allNonMeasurement) مُستبعَدان بالاسم — بقيّة حقول gate (بما فيها coveragePct/source/cappedThisLetter/cappedOverall/note) تبقى بقرار مستخدم صريح');

// ═══════════════════════════════════════════════════════════════════════
// ٨ — القرار ٩٤ البند ١ — إغلاق شامل: isProvenSupportiveEvidence مفردة
// واحدة فقط (outcome==='FAIL') بعد أن كانت ثلاثاً. ⚠️ **استُبدل بالكامل
// (القاعدة 23)** — كان هذا القسم يثبت أن `status` قائمة بيضاء لـ'FIRED'
// وحدها ضمن مفردات أخرى مقبولة (INPUT_ABSENT/2026-09-23)؛ بعد اليوم
// `status` **لا تُفحَص إطلاقاً** — فإثبات "FIRED يبقى مُثبِتاً" (الشطر
// الأوّل القديم) صار خطأً، لا مجرّد قديم. يُستبدَل بتغطية شاملة للمفردة
// الوحيدة الباقية + كل ما أُغلق اليوم، حقلاً حقلاً.
// ═══════════════════════════════════════════════════════════════════════
{
  const {isProvenSupportiveEvidence} = buildV7PayloadInternal;
  // المفردة الوحيدة الباقية.
  eq(isProvenSupportiveEvidence('outcome', 'FAIL'), true, '[القرار ٩٤/١] outcome=FAIL — الوحيدة المُثبَتة بعد اليوم');
  // كل ما أُغلق اليوم بعد أن كان مفتوحاً (status/الحرف).
  eq(isProvenSupportiveEvidence('status', 'FIRED'), false, '[القرار ٩٤/١][كان true قبل هذا القرار] status=FIRED لم تعد تُثبِت شيئاً — status لا تُفحَص إطلاقاً بعد اليوم');
  eq(isProvenSupportiveEvidence('status', 'INPUT_ABSENT'), false, '[إعداد] status=INPUT_ABSENT — لا تُفحَص أصلاً (نفس النتيجة، سبب مختلف الآن)');
  eq(isProvenSupportiveEvidence('status', 'NOT_FIRED'), false, '[إعداد] status=NOT_FIRED — لا تُفحَص أصلاً');
  eq(isProvenSupportiveEvidence('status', 'NOT_WIRED'), false, '[إعداد] status=NOT_WIRED — لا تُفحَص أصلاً');
  eq(isProvenSupportiveEvidence('status', 'DISABLED'), false, '[إعداد] status=DISABLED — لا تُفحَص أصلاً');
  eq(isProvenSupportiveEvidence('deterministicLetter', 'D'), false, '[القرار ٩٤/١][كان true قبل هذا القرار] deterministicLetter=D لم تعد تُثبِت شيئاً');
  eq(isProvenSupportiveEvidence('finalLetter', 'C'), false, '[القرار ٩٤/١][كان true قبل هذا القرار] finalLetter=C لم تعد تُثبِت شيئاً');
  eq(isProvenSupportiveEvidence('llmSuggestedLetter', 'D'), false, '[القرار ٩٤/١][كان true قبل هذا القرار] llmSuggestedLetter=D لم تعد تُثبِت شيئاً');
  // ما كان مغلقاً ويبقى مغلقاً — بلا تغيير.
  eq(isProvenSupportiveEvidence('deterministicLetter', 'A'), false, '[إعداد] حرف A — لا يُثبَت بتاتاً (بلا تغيير)');
  eq(isProvenSupportiveEvidence('outcome', 'PASS'), false, '[إعداد] outcome=PASS — لا يُثبَت (بلا تغيير)');
  eq(isProvenSupportiveEvidence('state', 'MEASURED'), false, '[القرار ٩٤/١][مطلوب صراحةً] state (حالة الفئة) — لا فرع لها، لم تُثبَت قبل اليوم ولا بعده');

  // تكامل — evidenceRefs يستشهد بـROOT_DETECTED.status (INPUT_ABSENT فعلياً،
  // SEC-04 غائب) → يُرفَض EVIDENCE_NOT_PROVEN (سبب مختلف عن قبل هذا القرار،
  // نتيجة واحدة).
  const csHarness = require('../src/analysis/categoryStates').computeCategoryStates({
    functionalResults: [], manualResults: [], batterySampleInputs: null, batteryDesignCapacityMah: null,
  });
  const rootGateAbsent = csHarness.overall.gatesApplied.find((g) => g.name === 'ROOT_DETECTED');
  eq(rootGateAbsent.status, 'INPUT_ABSENT', '[إعداد] functionalResults=[] فعلياً → ROOT_DETECTED.status=INPUT_ABSENT (SEC-04 غائب)');
  const rejectedAdj = applyV7Adjustments(csHarness, [
    {category: 'security', direction: 'DOWN', evidenceRefs: ['categoryStates.overall.gatesApplied[0].status'], reason: 'اختبار INPUT_ABSENT كدليل'},
  ], null);
  eq(rejectedAdj.overall.adjustments[0].rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[تكامل] الاستشهاد بحقل status=INPUT_ABSENT كدليل يُرفَض EVIDENCE_NOT_PROVEN — لا يُقبَل كسند لتخفيض');
}
console.log('تحقّق ٨ [القرار ٩٤/١]: isProvenSupportiveEvidence مفردة واحدة (outcome=FAIL) — كل ما عداها مغلق (status بكل قيمه، الحرف من أي حقل، حالة الفئة)، ومُتحقَّق بتكامل كامل عبر applyV7Adjustments');

// ═══════════════════════════════════════════════════════════════════════
// ٩ — القرار ٩٩ البند ١ (2026-09-25 +03، نصّ المستخدم حرفياً، **مطلوب
//    صراحةً**): "تخفيض cpu بدليل FAIL في C-03 يُرفض، وبدليل FAIL في C-06
//    يُقبل." المصدر (لا قائمة IDs يدوية، القاعدة 24): healthBearing —
//    الحقل نفسه الذي يستهلكه computeHealthBearingStats (categoryStates.js:446-452)
//    فعلياً لبناء score/executed. مُتحقَّق أدناه عبر السلسلة الحقيقية
//    الكاملة (functionalResults معدَّلة → toTestResult الحقيقية →
//    healthBearing) — لا كائن اصطناعي يُخمَّن شكله.
// ═══════════════════════════════════════════════════════════════════════
{
  // C-03 (UNSTABLE_IDS) — حقيقياً pass على S10 (rawValue=2.14GHz، مُتحقَّق
  // من نفس فِخّ functionalResults-by-scanid.json)، بلا FAIL حقيقي متاح —
  // تُعدَّل نسخة واحدة من functionalResults (عنصر C-03 وحده) لإنتاج FAIL
  // حقيقي عبر toTestResult الفعلية (لا افتراض شكل healthBearing يدوياً).
  const realC03 = s10Functional.find((r) => r.testId === 'C-03');
  ok(realC03 && realC03.status === 'pass' && realC03.categoryName === 'cpu',
      '[إعداد ٩] C-03 الحقيقية على S10: pass، فئة cpu (كما هو موثَّق) — قبل التعديل');
  const functionalC03Fail = s10Functional.map((r) => (r.testId === 'C-03' ? Object.assign({}, r, {status: 'fail'}) : r));
  const csC03Fail = computeCategoryStates({
    functionalResults: functionalC03Fail, manualResults: [], dev: null, findings: null,
    batterySampleInputs: null, batteryDesignCapacityMah: null,
  });
  const c03Index = csC03Fail.testResults.findIndex((t) => t.testId === 'C-03');
  ok(c03Index >= 0, '[إعداد ٩] C-03 موجودة في testResults بعد التعديل');
  eq(csC03Fail.testResults[c03Index].outcome, 'FAIL', '[إعداد ٩] C-03.outcome=FAIL فعلياً بعد التعديل (toTestResult الحقيقية)');
  eq(csC03Fail.testResults[c03Index].healthBearing, false,
      '[إعداد ٩][جوهري] C-03.healthBearing=false فعلياً (isHealthBearing/isUnstable في testKinds.js — لا افتراض، من الحساب الحقيقي)');

  const rejectedByExclusion = applyV7Adjustments(csC03Fail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [`categoryStates.testResults[${c03Index}].outcome`], reason: 'اختبار الاستبعاد — C-03'},
  ], null);
  eq(rejectedByExclusion.overall.adjustments[0].rejectedReason, 'EVIDENCE_EXCLUDED_FROM_GRADE',
      '[القرار ٩٩/١][مطلوب صراحةً] تخفيض cpu بدليل FAIL في C-03 (UNSTABLE، healthBearing=false) → EVIDENCE_EXCLUDED_FROM_GRADE — يُرفض');

  // C-06 — نفس الفكرة، لكن هذه المرّة healthBearing=true فعلياً (ليست
  // UNSTABLE، ليست SPEC) — يجب أن **يُقبل**. نفس فِخّ S10، عنصر C-06 وحده.
  const realC06 = s10Functional.find((r) => r.testId === 'C-06');
  ok(realC06 && realC06.status === 'pass' && realC06.categoryName === 'cpu',
      '[إعداد ٩] C-06 الحقيقية على S10: pass، فئة cpu — قبل التعديل');
  const functionalC06Fail = s10Functional.map((r) => (r.testId === 'C-06' ? Object.assign({}, r, {status: 'fail'}) : r));
  const csC06Fail = computeCategoryStates({
    functionalResults: functionalC06Fail, manualResults: [], dev: null, findings: null,
    batterySampleInputs: null, batteryDesignCapacityMah: null,
  });
  const c06Index = csC06Fail.testResults.findIndex((t) => t.testId === 'C-06');
  eq(csC06Fail.testResults[c06Index].outcome, 'FAIL', '[إعداد ٩] C-06.outcome=FAIL فعلياً بعد التعديل');
  eq(csC06Fail.testResults[c06Index].healthBearing, true,
      '[إعداد ٩][جوهري] C-06.healthBearing=true فعلياً (ليست UNSTABLE، ليست SPEC — "معطّلة حتى P2" لا تعني مستبعَدة من الحرف، testKinds.js)');

  const acceptedC06 = applyV7Adjustments(csC06Fail, [
    {category: 'cpu', direction: 'DOWN', evidenceRefs: [`categoryStates.testResults[${c06Index}].outcome`], reason: 'اختبار القبول — C-06'},
  ], null);
  eq(acceptedC06.overall.adjustments[0].applied, true,
      '[القرار ٩٩/١][مطلوب صراحةً] تخفيض cpu بدليل FAIL في C-06 (healthBearing=true) → applied=true — يُقبل، لا EVIDENCE_EXCLUDED_FROM_GRADE');
  ok(!acceptedC06.overall.adjustments[0].rejectedReason, '[القرار ٩٩/١] لا rejectedReason على تعديل C-06 المقبول');

  // ضابط وحدة مباشر — isExcludedFromGrade نفسها، بلا مرور بـapplyV7Adjustments.
  const {isExcludedFromGrade} = buildV7PayloadInternal;
  eq(isExcludedFromGrade({healthBearing: true}), false, '[وحدة] healthBearing=true → غير مستبعَد');
  eq(isExcludedFromGrade({healthBearing: false}), true, '[وحدة] healthBearing=false → مستبعَد');
  eq(isExcludedFromGrade({}), true, '[وحدة][الباب مغلق افتراضياً] لا حقل healthBearing إطلاقاً → مستبعَد (غياب لا يُقرأ قبولاً، القاعدة 22)');
  eq(isExcludedFromGrade(null), true, '[وحدة] كائن غائب كلّياً → مستبعَد');

  console.log(`تحقّق ٩ [القرار ٩٩/١]: تخفيض cpu بدليل FAIL في C-03 (UNSTABLE، healthBearing=false) يُرفض EVIDENCE_EXCLUDED_FROM_GRADE، وبدليل FAIL في C-06 (healthBearing=true) يُقبل applied=true — المصدر healthBearing (computeHealthBearingStats)، لا قائمة IDs يدوية`);
}

console.log(`\nbuildV7Payload.test.js: ${n}/${n} assertions passed`);
