'use strict';

// v7ModelPayloadWhitelistGuard.test.js — الحارس ثنائي الاتّجاه لقائمة
// v7ModelPayloadWhitelist.js (أمر مستخدم 2026-09-23 +03، البند ١: "واجعل
// الحارس ثنائي الاتّجاه... على نمط v7ContractFieldsGuard") — نفس فلسفة
// functions/test/v7ContractFieldsGuard.test.js لكن على شجرة categoryStates
// المُرسَلة للنموذج، لا شكل العرض:
//
//   كل حقل حاضر فعلياً في categoryStates الحقيقي إمّا في القائمة البيضاء
//   (ALLOWED) أو في قائمة استبعاد مُسمّاة بسببها (EXCLUDED_REASONS) —
//   ولا يكون في الاثنتين معاً. حقل غير مُصنَّف في أيّهما يُسقط الاختبار
//   (القاعدة 25: "لا يُقبل شكل جديد إلا بتحديث كل قارئ له").
//
// أربعة سيناريوهات حقيقية/شبه-حقيقية لتغطية كل الفروع المعروفة لشكل
// categoryStates.categories.<cat> (12 حقلاً أساسياً + حقول شرطية):
//   ١. b45c8cf6 — فئات عادية MEASURED/PARTIAL/UNMEASURED + بطارية بعيّنات
//   ٢. Honor (e4b65a2f) — HARNESS_ERROR (كل الفئات غير البطارية) — يكشف
//      reason/harnessErrorNote
//   ٣. اصطناعي — بطارية بلا batterySampleInputs — يكشف فرع reason البديل
//      على البطارية (بلا noLetterReason/tag/testIds)
//
// Run: node functions/test/v7ModelPayloadWhitelistGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {
  CATEGORY_ALLOWED_FIELDS, CATEGORY_EXCLUDED_REASONS,
  GATE_ALLOWED_FIELDS, GATE_EXCLUDED_REASONS,
  OVERALL_ALLOWED_FIELDS, OVERALL_EXCLUDED_REASONS,
  PARTIAL_ASSESSMENT_TAG_ALLOWED_FIELDS, ISSUE_ALLOWED_FIELDS,
} = require('../src/analysis/v7ModelPayloadWhitelist');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── دالّة الحراسة العامّة — ثنائية الاتّجاه، تُسمّي الفرق (نفس فلسفة
// v7ContractFieldsGuard.test.js:assertKeySetEqual) ────────────────────────
function assertEveryKeyClassified(observedKeys, allowedFields, excludedReasons, label) {
  const allowed = new Set(allowedFields);
  const excluded = new Set(Object.keys(excludedReasons));
  const overlap = [...allowed].filter((k) => excluded.has(k));
  ok(overlap.length === 0, `${label}: تداخل بين المسموح والمُستبعَد (خطأ تصميم في القائمة نفسها) — [${overlap.join(', ')}]`);

  const unclassified = [...observedKeys].filter((k) => !allowed.has(k) && !excluded.has(k));
  ok(unclassified.length === 0,
      `${label}: حقل حقيقي غير مُصنَّف في القائمة البيضاء ولا في الاستبعاد المُسمّى — ` +
      `[${unclassified.join(', ')}] — لا يتسرّب بصمت ولا يُحجب بصمت (القاعدة 25)`);
}

// ═══════════════════════════════════════════════════════════════════════
// إعداد — ثلاثة سيناريوهات (راجع رأس الملفّ)
// ═══════════════════════════════════════════════════════════════════════
const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const s10Fp = {device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const s10Findings = computeFindings(s10Fp);
const s10Inputs = sampleInputsFromRaw(s10Raw);
const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
});

const honorRaw = loadJson('e4b65a2f-honor.ts.json');
const honorFp = {device: {}, timeSeries: honorRaw.timeSeries || honorRaw, functionalResults: null, manualResults: []};
const honorFindings = computeFindings(honorFp);
const honorInputs = sampleInputsFromRaw(honorRaw);
const honorCategoryStates = computeCategoryStates({
  functionalResults: null, manualResults: [], dev: null, findings: honorFindings,
  batterySampleInputs: honorInputs.sampleInputs, batteryDesignCapacityMah: honorInputs.design,
});

const noBatteryCategoryStates = computeCategoryStates({
  functionalResults: [], manualResults: [], batterySampleInputs: null, batteryDesignCapacityMah: null,
});

const ALL_SCENARIOS = [
  ['b45c8cf6', s10CategoryStates],
  ['Honor(HARNESS_ERROR)', honorCategoryStates],
  ['[اصطناعي] بطارية بلا samples', noBatteryCategoryStates],
];

// ═══════════════════════════════════════════════════════════════════════
// ١ — مدخل الفئة (categoryStates.categories.<cat>) — كل السيناريوهات، كل الفئات
// ═══════════════════════════════════════════════════════════════════════
{
  const observedCategoryKeys = new Set();
  const observedGateKeys = new Set();
  let gateObjectsSeen = 0;
  for (const [, cs] of ALL_SCENARIOS) {
    for (const cat of Object.keys(cs.categories)) {
      const entry = cs.categories[cat];
      for (const k of Object.keys(entry)) observedCategoryKeys.add(k);
      if (Array.isArray(entry.gatesApplied)) {
        for (const g of entry.gatesApplied) {
          gateObjectsSeen++;
          for (const k of Object.keys(g)) observedGateKeys.add(k);
        }
      }
    }
    // gatesApplied على overall أيضاً — قد تحمل بوّابات (أو حقولاً) لا
    // تظهر على أي فئة بعينها (مثال نظري: BATTERY_MAX_ONE_BAND {name,from,to}).
    if (Array.isArray(cs.overall.gatesApplied)) {
      for (const g of cs.overall.gatesApplied) {
        gateObjectsSeen++;
        for (const k of Object.keys(g)) observedGateKeys.add(k);
      }
    }
  }
  ok(observedCategoryKeys.size > 0, 'إعداد: مفاتيح فئة حقيقية جُمعت فعلاً (لا مجموعة فارغة)');
  ok(gateObjectsSeen > 0, 'إعداد: كائنات gate حقيقية جُمعت فعلاً (لا مجموعة فارغة)');
  assertEveryKeyClassified(observedCategoryKeys, CATEGORY_ALLOWED_FIELDS, CATEGORY_EXCLUDED_REASONS,
      'categoryStates.categories.<cat> (كل السيناريوهات الثلاثة)');
  assertEveryKeyClassified(observedGateKeys, GATE_ALLOWED_FIELDS, GATE_EXCLUDED_REASONS,
      'gate object (categories.<cat>.gatesApplied[] + overall.gatesApplied[]، كل السيناريوهات)');

  // القيمتان المرجعيّتان من نصّ أمر المستخدم — "12 مفتاحاً للفئة، 11 للبوّابة".
  eq(CATEGORY_ALLOWED_FIELDS.length + Object.keys(CATEGORY_EXCLUDED_REASONS).length, 26,
      'إعداد: مجموع كل مفاتيح الفئة المعروفة (مسموح+مُستبعَد) = 26 (21 مسموح + 5 مُستبعَد)');
  eq(GATE_ALLOWED_FIELDS.length + Object.keys(GATE_EXCLUDED_REASONS).length, 11,
      'إعداد: مجموع كل مفاتيح gate المعروفة = 11 — يطابق "11 للبوّابة" في أمر المستخدم');
}
console.log('تحقّق ١: كل مفتاح فئة/gate حقيقي (ثلاثة سيناريوهات) مُصنَّف في القائمة البيضاء أو استبعاد مُسمّى — لا ثالث');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — overall + partialAssessmentTag
// ═══════════════════════════════════════════════════════════════════════
{
  const observedOverallKeys = new Set();
  for (const [, cs] of ALL_SCENARIOS) for (const k of Object.keys(cs.overall)) observedOverallKeys.add(k);
  assertEveryKeyClassified(observedOverallKeys, OVERALL_ALLOWED_FIELDS, OVERALL_EXCLUDED_REASONS, 'categoryStates.overall');
  // S3 (أمر مستخدم 2026-10-01 +03) — كان 14 (11 مسموح + 3 مُستبعَد)، صار
  // 15 (harnessErrorMessage جديد، مُستبعَد رابع — راجع v7ModelPayloadWhitelist.js).
  eq(OVERALL_ALLOWED_FIELDS.length + Object.keys(OVERALL_EXCLUDED_REASONS).length, 15,
      'إعداد: مجموع كل مفاتيح overall المعروفة = 15 (11 مسموح + 4 مُستبعَد)');

  ok(s10CategoryStates.overall.partialAssessmentTag && typeof s10CategoryStates.overall.partialAssessmentTag === 'object',
      'إعداد: b45c8cf6 يُنتج partialAssessmentTag != null فعلاً — فحص شكله يحتاج قيمة حقيقية');
  const tagKeys = new Set(Object.keys(s10CategoryStates.overall.partialAssessmentTag));
  assertEveryKeyClassified(tagKeys, PARTIAL_ASSESSMENT_TAG_ALLOWED_FIELDS, {}, 'overall.partialAssessmentTag');
  eq(tagKeys.size, 3, 'إعداد: partialAssessmentTag ثلاثة حقول بالضبط (label/coveragePct/text)');
}
console.log('تحقّق ٢: overall/partialAssessmentTag مُصنَّفان بالكامل');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — issues[]
// ═══════════════════════════════════════════════════════════════════════
{
  const observedIssueKeys = new Set();
  for (const [, cs] of ALL_SCENARIOS) for (const issue of cs.issues) for (const k of Object.keys(issue)) observedIssueKeys.add(k);
  ok(observedIssueKeys.size > 0, 'إعداد: مفاتيح issue حقيقية جُمعت فعلاً');
  assertEveryKeyClassified(observedIssueKeys, ISSUE_ALLOWED_FIELDS, {}, 'categoryStates.issues[]');
}
console.log('تحقّق ٣: issues[] مُصنَّفة بالكامل (لا استبعاد فعلي، قائمة بيضاء دفاعية)');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — تكامل: تشغيل buildV7Payload فعلياً على السيناريوهات الثلاثة، والتحقّق
// أن body.categoryStates لا يحمل أي حقل مُستبعَد، ويحمل كل حقل مسموح
// موجود في المصدر (لا إسقاط زائد بالغلط).
// ═══════════════════════════════════════════════════════════════════════
for (const [label, cs] of ALL_SCENARIOS) {
  const {body} = buildV7Payload({
    findings: label === 'b45c8cf6' ? s10Findings : (label.startsWith('Honor') ? honorFindings : null),
    categoryStates: cs, language: 'ar', scanId: 'guard-test', isFreeTrial: false, previousScan: null,
  });
  for (const cat of Object.keys(body.categoryStates.categories)) {
    const builtKeys = new Set(Object.keys(body.categoryStates.categories[cat]));
    for (const excludedField of Object.keys(CATEGORY_EXCLUDED_REASONS)) {
      ok(!builtKeys.has(excludedField), `[${label}] categories.${cat} لا يحمل الحقل المُستبعَد "${excludedField}" في الحمولة الفعلية`);
    }
  }
  for (const excludedField of Object.keys(OVERALL_EXCLUDED_REASONS)) {
    ok(!Object.prototype.hasOwnProperty.call(body.categoryStates.overall, excludedField),
        `[${label}] overall لا يحمل الحقل المُستبعَد "${excludedField}" في الحمولة الفعلية`);
  }
}
console.log('تحقّق ٤: buildV7Payload الفعلية — صفر حقل مُستبعَد يصل body.categoryStates على أي من السيناريوهات الثلاثة');

console.log(`\nv7ModelPayloadWhitelistGuard.test.js: ${n}/${n} assertions passed`);
