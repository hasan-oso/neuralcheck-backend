'use strict';

// v7ContractFieldsGuard.test.js — الحارس ثنائي الاتّجاه لعقد شكل V7
// (القرار ٣٤ + القاعدة 25، مهمّة 2026-09-21 +03).
//
// الغرض: إغلاق الحلقة التي انفتحت ثلاث مرّات (aiModel، ثم deviceMarketingName،
// ثم ما كان سيليهما) — حقل يقرؤه قارئ خارجي (التطبيق) وليس في العقد
// المُختبَر، فيسقط صامتاً. هذا الاختبار يقارن src/analysis/v7ContractFieldMap.js
// (مصدر الحقيقة المُصدَّر — القاعدة 24) بمخرَج خط الأنابيب الفعلي
// (buildDisplayShapeV7 → buildV7ResponseForStorage → +V7_OPERATIONAL_FIELDS)
// في **الاتّجاهين معاً**:
//   (أ) حقل في v7ContractFieldMap.js وليس في المخرَج الفعلي — عقد ميّت،
//       وصف لحقل لم يعد/لم يصر موجوداً.
//   (ب) حقل في المخرَج الفعلي وليس في v7ContractFieldMap.js — بالضبط عطب
//       aiModel/deviceMarketingName: حقل يصل التطبيق ولا يحرسه أحد.
//
// ⚠️ S6 (أمر مستخدم 2026-10-01 +03): `actual` أدناه هو شكل **المخزون**
// (aiResponseToSave + الحقول التشغيلية) — كما كان قبل S6 تماماً، بلا أي
// تغيير هنا. منذ S6 لم يعد هذا يطابق ما يصل العميل فعلياً على narrative
// تحديداً (analyzeDevice.js/verifyReport.js يحذفان details/verdict عند
// الإرجاع لا عند البناء) — راجع §٦ أسفل هذا الملفّ للشكل العائد فعلاً،
// وv7ContractFieldMap.js (NARRATIVE_RETURNED_FIELDS) للتوثيق الكامل.
//
// docs/V7_DISPLAY_SHAPE_CONTRACT.md §٠-٣ نصّ Markdown بشري — **لا يُقرَأ
// آلياً هنا** (تحليل جدول Markdown بالتعبير النمطي هو بالضبط عطب حارس
// A102: اختبار يمرّ لأنه لا يفحص شيئاً فعلياً). المصدر المُختبَر آلياً
// الوحيد هو v7ContractFieldMap.js — الجداول في التوثيق وصف يجب أن يبقى
// مطابقاً له يدوياً، لا العكس.
//
// المُدخل: نفس عيّنة b45c8cf6 (S10 مجذَّر) التي تستعملها buildDisplayShapeV7.test.js
// — GATE:ROOT_DETECTED، 85 عنصر functionalResults حقيقي، تحمل فئة بطارية
// (لتظهر الحقول الخاصّة بها) وعطباً واحداً على الأقلّ من نوع ISS-*
// (evidence/evidenceUnit حقيقيان) وDISC-* (evidence/evidenceUnit غائبان في
// الشكل الخام، مُطبَّعان لاحقاً — راجع تعليق v7ContractFieldMap.js:ISSUE_FIELDS).
//
// Run: node functions/test/v7ContractFieldsGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {applyV7Adjustments} = require('../src/analysis/buildV7Payload');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
const {buildV7ResponseForStorage, stripNarrativeDetailsVerdictFromV7Response} =
    require('../src/analysis/analyzeDevice');
const {V7_OPERATIONAL_FIELDS} = require('../src/analysis/v7OperationalFields');
const {CATEGORIES} = require('../src/utils/categories');
const {
  OPAQUE,
  ROOT_FIELDS,
  OVERALL_FIELDS,
  PARTIAL_ASSESSMENT_TAG_FIELDS,
  GOVERNING_GATE_REASON_FIELDS,
  CATEGORY_COMMON_FIELDS,
  CATEGORY_LETTER_CEILING_REASON_FIELDS,
  CATEGORY_BATTERY_EXTRA_FIELDS,
  OPAQUE_FIELDS,
  ISSUE_FIELDS,
  NARRATIVE_FIELDS,
  NARRATIVE_RETURNED_FIELDS,
  BUYER_ADVICE_PROFILES,
} = require('../src/analysis/v7ContractFieldMap');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// مقارنة مجموعتَي مفاتيح ثنائية الاتّجاه — تسمّي الفرق في كلا الاتّجاهين
// بدل true/false عمياء (نفس فلسفة رسائل هذا المستودع — راجع القاعدة 22).
function assertKeySetEqual(actualKeys, expectedKeys, label) {
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const extraInCode = [...actual].filter((k) => !expected.has(k));
  const missingFromCode = [...expected].filter((k) => !actual.has(k));
  ok(extraInCode.length === 0,
      `${label}: حقل ينتجه الكود وليس في v7ContractFieldMap.js (عقد ميّت أو تسريب صامت) — [${extraInCode.join(', ')}]`);
  ok(missingFromCode.length === 0,
      `${label}: حقل في v7ContractFieldMap.js لم يعد ينتجه الكود — [${missingFromCode.join(', ')}]`);
}

// ═══════════════════════════════════════════════════════════════════════
// إعداد — نفس بصمة buildDisplayShapeV7.test.js (b45c8cf6، S10 مجذَّر)
// ═══════════════════════════════════════════════════════════════════════
const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
ok(Array.isArray(s10Functional) && s10Functional.length === 85,
    'إعداد: S10(b45c8cf6) 85 عنصر functionalResults حقيقي (نفس فِخّ buildDisplayShapeV7.test.js)');

const s10Fp = {device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const s10Findings = computeFindings(s10Fp);
const s10Inputs = sampleInputsFromRaw(s10Raw);
const s10CategoryStatesRaw = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
});

// ترتيب التركيب المُلزِم (docs/V7_DISPLAY_SHAPE_CONTRACT.md §٢): applyV7Adjustments
// قبل buildDisplayShapeV7 — بلا تعديلات هنا (adjustments=[]) كي لا يعتمد
// هذا الحارس على استقرار مخرَج النموذج، فقط على شكل الأنابيب.
const s10CategoryStatesAdjusted = applyV7Adjustments(s10CategoryStatesRaw, [], s10Findings);

const aiAnalysis = {
  narrative: {
    summary: 'ملخّص اختباري', details: 'تفصيل اختباري', verdict: 'حكم اختباري',
    buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة ألعاب', photographer: 'نصيحة تصوير'},
    issueDescriptions: {'DISC-T-01': 'وصف اختباري'},
  },
  crossChecks: [], adjustments: [], modelObservations: [],
};

const {display} = buildDisplayShapeV7({
  categoryStates: s10CategoryStatesAdjusted, findings: s10Findings, aiAnalysis, language: 'ar',
});

// ─── من هنا فصاعداً: نفس analyzeDevice.js:376-644 (بلا Firestore) ────────
const aiResponseToSave = buildV7ResponseForStorage(display);
const operationalFieldValues = {
  shortId: 'TEST0000', isFreeTrial: false, aiModel: 'test-model', deviceMarketingName: 'Test Device',
};
const operationalExtras = {};
for (const f of V7_OPERATIONAL_FIELDS) operationalExtras[f] = operationalFieldValues[f];
const actual = {...aiResponseToSave, ...operationalExtras};

// ═══════════════════════════════════════════════════════════════════════
// ١ — الجذر
// ═══════════════════════════════════════════════════════════════════════
assertKeySetEqual(Object.keys(actual), ROOT_FIELDS, 'الجذر');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — overall (+ partialAssessmentTag/governingGateReason حين != null —
// b45c8cf6 يحمل كليهما فعلياً: coverage=45% < 60% وGATE:ROOT_DETECTED)
// ═══════════════════════════════════════════════════════════════════════
ok(actual.overall && typeof actual.overall === 'object', 'إعداد: actual.overall كائن');
assertKeySetEqual(Object.keys(actual.overall), OVERALL_FIELDS, 'overall');

ok(actual.overall.partialAssessmentTag !== null,
    'إعداد: b45c8cf6 (coverage=45%) يُنتج partialAssessmentTag != null — فحص شكله يحتاج قيمة حقيقية');
if (actual.overall.partialAssessmentTag !== null) {
  assertKeySetEqual(Object.keys(actual.overall.partialAssessmentTag), PARTIAL_ASSESSMENT_TAG_FIELDS,
      'overall.partialAssessmentTag');
}

ok(actual.overall.governingGateReason !== null,
    'إعداد: b45c8cf6 (GATE:ROOT_DETECTED) يُنتج governingGateReason != null — فحص شكله يحتاج قيمة حقيقية');
if (actual.overall.governingGateReason !== null) {
  assertKeySetEqual(Object.keys(actual.overall.governingGateReason), GOVERNING_GATE_REASON_FIELDS,
      'overall.governingGateReason');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — categories.<cat> — كل الفئات الحاضرة فعلياً (يُفترَض الـ15 كلّها)،
// المشتركة + إضافات البطارية فقط عليها
// ═══════════════════════════════════════════════════════════════════════
const actualCategoryKeys = Object.keys(actual.categories || {});
ok(actualCategoryKeys.length === CATEGORIES.length,
    `إعداد: عدد الفئات الحاضرة (${actualCategoryKeys.length}) = CATEGORIES.length (${CATEGORIES.length})`);

for (const cat of actualCategoryKeys) {
  const expected = cat === 'battery' ?
      [...CATEGORY_COMMON_FIELDS, ...CATEGORY_BATTERY_EXTRA_FIELDS] :
      CATEGORY_COMMON_FIELDS;
  assertKeySetEqual(Object.keys(actual.categories[cat]), expected, `categories.${cat}`);
}

// letterCeilingReason — أمر المهمّة 2026-09-22 +03 (البند الثاني). حاضر
// كمفتاح على كل فئة (الحلقة أعلاه تحقّقت من ذلك عبر CATEGORY_COMMON_FIELDS)
// — هنا نفحص شكله الداخلي حين != null (بنفس نمط governingGateReason
// أعلاه)، وأن القيمة نفسها != null على فئة حقيقية على b45c8cf6 (gpu،
// مُتحقَّق بتشغيل فعلي في تقرير المهمّة: FIRED+cappedThisLetter=true).
ok(actual.categories.gpu.letterCeilingReason !== null,
    'إعداد: b45c8cf6 (gpu، LOW_CATEGORY_COVERAGE FIRED+cappedThisLetter) يُنتج letterCeilingReason != null — فحص شكله يحتاج قيمة حقيقية');
if (actual.categories.gpu.letterCeilingReason !== null) {
  assertKeySetEqual(Object.keys(actual.categories.gpu.letterCeilingReason), CATEGORY_LETTER_CEILING_REASON_FIELDS,
      'categories.gpu.letterCeilingReason');
}
// وفئة بلا بوّابة أسقفت letter فعلياً (cpu — NOT_FIRED) → null، لا تُطوى
// إحدى الحالتين في الأخرى (القاعدة 30 البند 4).
ok(actual.categories.cpu.letterCeilingReason === null,
    'إعداد: b45c8cf6 (cpu، لا بوّابة مُسقِّفة) يُنتج letterCeilingReason === null');

// indicators — مُبهَم بتصميم (راجع v7ContractFieldMap.js). الحارس يتحقّق
// من وجود المفتاح نفسه فقط (البطارية) وغيابه على كل فئة أخرى — لا يفحص
// ما بداخله.
ok(OPAQUE_FIELDS['categories.battery.indicators'] === OPAQUE,
    'إعداد: categories.battery.indicators مُعلَّم OPAQUE في v7ContractFieldMap.js عمداً');
ok('indicators' in (actual.categories.battery || {}),
    'categories.battery.indicators: المفتاح حاضر (لا نفحص شكله الداخلي — لا مخطَّط ثابت، batteryLayer.js)');
for (const cat of actualCategoryKeys) {
  if (cat === 'battery') continue;
  ok(!('indicators' in actual.categories[cat]),
      `categories.${cat}.indicators: غائب كما هو متوقَّع (البطارية وحدها) — categories.${cat} حمل indicators لولا هذا الفحص`);
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — issues[] — اتّحاد المفاتيح عبر كل العناصر (بعد التطبيع النهائي
// buildIssueForStorage، analyzeDevice.js) — يُفترَض تجانس تامّ (كل عنصر
// يحمل المفاتيح السبعة كلّها)، والاختبار يتحقّق من ذلك صراحة لا يفترضه
// ═══════════════════════════════════════════════════════════════════════
ok(Array.isArray(actual.issues) && actual.issues.length > 0,
    `إعداد: actual.issues مصفوفة غير فارغة (${Array.isArray(actual.issues) ? actual.issues.length : 'n/a'} عنصراً) — b45c8cf6 يحمل أعطاباً حقيقية`);

const hasFailOrWarning = actual.issues.some((it) => it.id && it.id.startsWith('ISS-'));
const hasDiscOrPositive = actual.issues.some((it) => it.id && (it.id.startsWith('DISC-') || it.id.startsWith('POS-')));
ok(hasFailOrWarning, 'إعداد: b45c8cf6 يحمل عنصر ISS-* واحداً على الأقلّ (evidence/evidenceUnit حقيقيان قبل التطبيع)');
ok(hasDiscOrPositive, 'إعداد: b45c8cf6 يحمل عنصر DISC-*/POS-* واحداً على الأقلّ (evidence/evidenceUnit غائبان قبل التطبيع)');

for (const issue of actual.issues) {
  assertKeySetEqual(Object.keys(issue), ISSUE_FIELDS, `issues[] (${issue.id})`);
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — narrative (+ buyerAdvice)
// ═══════════════════════════════════════════════════════════════════════
ok(actual.narrative && typeof actual.narrative === 'object', 'إعداد: actual.narrative كائن');
assertKeySetEqual(Object.keys(actual.narrative), NARRATIVE_FIELDS, 'narrative');
ok(actual.narrative.buyerAdvice && typeof actual.narrative.buyerAdvice === 'object', 'إعداد: narrative.buyerAdvice كائن');
assertKeySetEqual(Object.keys(actual.narrative.buyerAdvice), BUYER_ADVICE_PROFILES, 'narrative.buyerAdvice');

// ═══════════════════════════════════════════════════════════════════════
// ٦ — narrative كما **يصل العميل فعلياً** بعد S6 (أمر مستخدم 2026-10-01
// +03) — يطبّق stripNarrativeDetailsVerdictFromV7Response (analyzeDevice.js،
// نفس الدالّة التي يستعملها analyzeDevice حرفياً — لا نسخة منطق هنا) على
// نفس `actual.narrative` أعلاه (شكل المخزون)، ويقارن الناتج بـ
// NARRATIVE_RETURNED_FIELDS. §٥ أعلاه يبقى يحرس المخزون (بلا تغيير)؛ هذا
// القسم يحرس العائد فقط — الاثنان معاً يغطّيان السطحين المفترقين حديثاً.
// ═══════════════════════════════════════════════════════════════════════
const returnedNarrative = stripNarrativeDetailsVerdictFromV7Response(actual).narrative;
ok(returnedNarrative && typeof returnedNarrative === 'object', 'إعداد: returnedNarrative كائن');
assertKeySetEqual(Object.keys(returnedNarrative), NARRATIVE_RETURNED_FIELDS, '[S6] narrative العائد للعميل');
ok(!('details' in returnedNarrative) && !('verdict' in returnedNarrative),
    '[S6] narrative العائد بلا details/verdict إطلاقاً — لا حتى null (الشكل تغيّر لا القيمة)');
ok('details' in actual.narrative && 'verdict' in actual.narrative,
    '[S6] narrative المخزون (actual، غير المُعدَّل) لا يزال يحمل details/verdict — S6 لا يمسّ التخزين');

// ═══════════════════════════════════════════════════════════════════════
console.log(`${n}/${n} assertions passed`);
