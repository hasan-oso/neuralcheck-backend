'use strict';

// lowCategoryCoverageGateTextInvariant.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٧٩ البند ب، الجولة الثانية): "اختبار يثبت: حيثما أُطلقت البوّابة
// في العيّنات الذهبية، لا يحمل أي اختبار معتمد قياساً في تلك الفئة حالةً
// مقيسة. ويُثبَت أنه يفشل إذا عُدّلت حالة أحدها في مُدخل الاختبار."
//
// السياق: نصّ nonMeasurementSubjectClause (buildDisplayShapeV7.js) يُعرَض
// كلّما `gatesApplied[cat].allNonMeasurement === true` (categoryStates.js:488،
// `executed.every(r => r.kind !== KIND.MEASUREMENT)`). هذا الاختبار **لا
// يعيد حساب allNonMeasurement بنفس الدالّة** (ذلك تكرار عديم الفائدة) —
// يتحقّق منه **بمسار مستقلّ**: يبني executed لكل فئة عبر
// `_internal.buildAllTestResults`/`_internal.computeHealthBearingStats`
// (نفس الدوالّ المُصدَّرة أصلاً من categoryStates.js — لا نسخة مستقلّة من
// منطق التصفية، لكن استدعاء مستقلّ هنا لا داخل computeGates)، ثم يقارن
// النتيجة بمطالبة `gatesApplied` — فلو انجرف أحد المصدرين عن الآخر مستقبلاً
// (تعديل في computeGates بلا تعديل مقابل، أو العكس) يظهر هنا كفرق فعلي، لا
// توافقاً صامتاً بحكم استدعاء الدالّة نفسها مرّتين.
//
// Run: node functions/test/lowCategoryCoverageGateTextInvariant.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates, _internal: csInternal} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {kindOf, KIND} = require('../src/analysis/testKinds');
const {buildAllTestResults, computeHealthBearingStats} = csInternal;

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(f) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, f), 'utf8')); }
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;

/**
 * executed لكل فئة، مبنيّ مباشرة من functionalResults الخام — مسار مستقلّ
 * عن computeGates الداخلي (نفس الدوالّ المُصدَّرة، استدعاء منفصل).
 * @param {Array} functionalResults
 * @param {Object} findings
 * @return {Object} {category: TestResult[]}
 */
function executedByCategory(functionalResults, findings) {
  const all = buildAllTestResults(functionalResults, [], null, findings);
  const byCat = {};
  for (const r of all) (byCat[r.category] = byCat[r.category] || []).push(r);
  const out = {};
  for (const cat of Object.keys(byCat)) out[cat] = computeHealthBearingStats(byCat[cat]).executed;
  return out;
}

/**
 * الفحص الجوهري (نصّ أمر المهمّة): لا عنصر MEASUREMENT واحد على الأقلّ في
 * executed لفئة زعم gatesApplied أنها allNonMeasurement=true.
 * @param {string} category
 * @param {Array<{testId:string}>} executed
 */
function assertNoAdoptedMeasurementInExecuted(category, executed) {
  const violators = executed.filter((r) => kindOf(r.testId) === KIND.MEASUREMENT);
  assert.strictEqual(violators.length, 0,
      `[${category}] وُجد ${violators.length} اختبار(ات) مُعتمَد(ة) MEASUREMENT ضمن executed رغم ` +
      `أن gatesApplied يزعم allNonMeasurement=true: ${violators.map((v) => v.testId).join(', ')}`);
}

function buildFor(scanId, tsFile) {
  const raw = loadJson(tsFile);
  const functionalResults = frMap[scanId];
  if (!Array.isArray(functionalResults)) throw new Error(`لا functionalResults لِـ ${scanId}`);
  const fingerprint = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults, manualResults: []};
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults, manualResults: [], dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
  });
  return {raw, functionalResults, findings, categoryStates};
}

// ═══════════════════════════════════════════════════════════════════════
// ١ — على العيّنات الذهبية الحقيقية (34dff2b8 + b45c8cf6): حيثما زعم
//     gatesApplied أن LOW_CATEGORY_COVERAGE أُطلقت بسبب allNonMeasurement،
//     تحقّق مستقلّ أن executed تلك الفئة فعلاً بلا أي MEASUREMENT.
// ═══════════════════════════════════════════════════════════════════════
const FIXTURES = [
  {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
  {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
];

let checkedCount = 0;
let firstRealCase = null; // {scanId, category, executed} — لبند ٢ (إثبات السقوط)

for (const {scanId, tsFile} of FIXTURES) {
  const {functionalResults, findings, categoryStates} = buildFor(scanId, tsFile);
  const executed = executedByCategory(functionalResults, findings);
  for (const cat of Object.keys(categoryStates.categories)) {
    if (cat === 'battery') continue;
    const entry = categoryStates.categories[cat];
    const gate = Array.isArray(entry.gatesApplied) ?
        entry.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE') : null;
    if (gate && gate.allNonMeasurement === true) {
      assertNoAdoptedMeasurementInExecuted(cat, executed[cat] || []);
      checkedCount++;
      if (!firstRealCase && cat === 'gpu' && scanId.startsWith('34dff2b8')) {
        firstRealCase = {scanId, category: cat, executed: executed[cat] || [], functionalResults};
      }
    }
  }
}

ok(checkedCount > 0, `[١] على الأقلّ فئة واحدة أُطلقت فيها البوّابة بسبب allNonMeasurement عبر العيّنتين — فُحصت ${checkedCount} فئة (ليس اختباراً فارغاً)`);
console.log(`تحقّق ١: ${checkedCount} فئة (عبر 34dff2b8 + b45c8cf6) — صفر اختبار MEASUREMENT ضمن executed في كل واحدة منها`);
ok(!!firstRealCase, '[إعداد] وُجدت حالة gpu/34dff2b8 حقيقية لبند ٢ (إثبات السقوط)');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — إثبات السقوط الحقيقي (نصّ أمر المهمّة صراحة): عدِّل حالة G-03 (gpu،
//     34dff2b8) من "not_tested" إلى "pass" في **مُدخل** functionalResults
//     (نسخة معزولة، لا تُغيّر الملفّ)، أعِد بناء executed مستقلاً من هذا
//     المُدخل المُعدَّل — والاختبار يجب أن يُخفق الآن (المُدَّعى الأصلي
//     allNonMeasurement=true من نفس هذا الفحص لم يعد صادقاً مقابل executed
//     المُعدَّل — نفس السيناريو الذي يحرس منه هذا الاختبار: انجراف بين ما
//     يُعرَض وما هو صحيح فعلياً).
// ═══════════════════════════════════════════════════════════════════════
{
  const {category, functionalResults} = firstRealCase;
  const g03 = functionalResults.find((r) => r.testId === 'G-03');
  ok(!!g03 && g03.categoryName === 'gpu' && g03.status === 'not_tested',
      '[إعداد٢] G-03 موجودة فعلاً في مُدخل 34dff2b8 بحالة not_tested (مُعتمَدة MEASUREMENT، غير مُنفَّذة)');

  const mutatedFunctionalResults = functionalResults.map((r) =>
    (r.testId === 'G-03' ? {...r, status: 'pass'} : r));
  const {findings: findings2} = buildFor('34dff2b8-ce9e-4b40-86a9-1976c878e195', '34dff2b8.ts.json');
  const executed2 = executedByCategory(mutatedFunctionalResults, findings2);

  ok(executed2[category].some((r) => r.testId === 'G-03'),
      '[إعداد٢] بعد التعديل، G-03 صارت ضمن executed.gpu فعلاً (outcome=PASS الآن)');

  let threw = false;
  let message = '';
  try {
    assertNoAdoptedMeasurementInExecuted(category, executed2[category]);
  } catch (e) {
    threw = true;
    message = e.message;
  }
  ok(threw, `[٢][إثبات السقوط] assertNoAdoptedMeasurementInExecuted يُخفق فعلاً بعد تعديل حالة G-03 إلى pass — ${message}`);
  ok(message.includes('G-03'), '[٢] رسالة الفشل تسمّي G-03 صراحة، لا فشلاً صامتاً');
  console.log(`تحقّق ٢ (إثبات السقوط): بعد تعديل G-03 (${category}) إلى status=pass — الاختبار أخفق فعلاً: "${message}"`);
}

console.log(`\nlowCategoryCoverageGateTextInvariant.test.js: ${n}/${n} assertions passed`);
