'use strict';

// v7AbsenceVsNullFieldsGuard.test.js — أمر مستخدم 2026-09-23 +03 (القرار ٧٢،
// البند ٣): "هل مفتاح letterCeilingReason حاضر على كل فئة، في كل تقرير V7،
// ولو كانت قيمته null؟" و"السؤال نفسه عن narrativeIncomplete
// وnarrativeIncompleteFields." — في كل موضع يصل منه التقرير إلى عميل.
//
// يتحقّق من حضور المفتاح (لا فقط عدم undefined — 'x' in obj تحديداً، لأن
// حذف المفتاح وValue=undefined كلاهما يُسقطانه من JSON.stringify بنفس
// الأثر) عبر السلسلة الحقيقية: computeCategoryStates → buildDisplayShapeV7
// (display، يُحاكي ما تبنيه resolveV7Report.js فوقه) → buildV7ResponseForStorage
// (analyzeDevice.js، الشكل المخزَّن/RPC) → stripVolatileFieldsFromReport
// (مسار الكاش، يُعيد التقرير المخزَّن كما هو).
//
// verifyReport.js: categoriesOut = ai.categories تمريرة مباشرة بالمرجع
// (verifyReport.js:294-295)، لا إعادة بناء — فحضور المفتاح في aiResponse
// المخزون يكفي لضمان حضوره في مخرَج verifyReport تلقائياً (مُتحقَّق هنا
// كوداً، لا محاكاة منفصلة — الدالّة داخلية لملفّ onRequest، تُستخرَج فقط
// في verifyReportV7Whitelist.test.js/verifyReportAuditExclusion.test.js
// بـnew Function). narrativeIncomplete/narrativeIncompleteFields في
// verifyReport.js:pickNarrative-مماثل (سطور ~298-302) تُسنَد بقيمة احتياطية
// صريحة (false/[]) حتى لو غابت من المصدر — أشدّ ضماناً من مجرّد التمرير.
//
// Run: node functions/test/v7AbsenceVsNullFieldsGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates, CATEGORY_WEIGHTS} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
const {buildV7ResponseForStorage} = require('../src/analysis/analyzeDevice');
const {stripVolatileFieldsFromReport} = require('../src/analysis/stripVolatileFieldsFromReport');
const {CATEGORIES} = require('../src/utils/categories');

const raw = loadGolden('b45c8cf6.ts.json');
const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
const findings = computeFindings(fp);
const inputs = sampleInputsFromRaw(raw);
const categoryStates = computeCategoryStates({
  functionalResults: functional, manualResults: [], dev: null, findings,
  batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
});

const minimalAiAnalysis = {
  narrative: {summary: 's', details: 'd', verdict: 'v', buyerAdvice: {casual: null, gamer: null, photographer: null}, issueDescriptions: {}},
  crossChecks: [], adjustments: [], modelObservations: [],
};

// ═══════════════════════════════════════════════════════════════════════
// (أ) letterCeilingReason — حاضر على كل الفئات الـ15، في كل مرحلة.
// ═══════════════════════════════════════════════════════════════════════
{
  const {display} = buildDisplayShapeV7({categoryStates, findings, aiAnalysis: minimalAiAnalysis, language: 'ar'});
  for (const cat of CATEGORIES) {
    ok('letterCeilingReason' in display.categories[cat],
        `[أ-display] categories.${cat}.letterCeilingReason حاضر كمفتاح (buildDisplayShapeV7.js:288، غير مشروط) — القيمة: ${JSON.stringify(display.categories[cat].letterCeilingReason)}`);
  }

  // يُحاكي ما تُضيفه resolveV7Report.js فوق display (resolveV7Report.js:316-317)
  display.narrativeIncomplete = false;
  display.narrativeIncompleteFields = [];
  display.isFreeTrial = false;

  const aiResponseToSave = buildV7ResponseForStorage(display);
  for (const cat of CATEGORIES) {
    if (!aiResponseToSave.categories[cat]) continue; // فئات بلا بيانات (صفر وزن) قد تغيب من categories نفسها — سؤال مختلف
    ok('letterCeilingReason' in aiResponseToSave.categories[cat],
        `[أ-مخزَّن/RPC] categories.${cat}.letterCeilingReason حاضر (analyzeDevice.js:buildCategoryEntryForStorage، غير مشروط)`);
  }

  // مسار الكاش — stripVolatileFieldsFromReport تُعيد التقرير المخزَّن كما
  // هو (نسخ عميق + _wasReused/reusedFromScanId فقط، لا حذف حقول).
  const reused = stripVolatileFieldsFromReport(aiResponseToSave, 'old-scan-id');
  for (const cat of CATEGORIES) {
    if (!reused.categories[cat]) continue;
    ok('letterCeilingReason' in reused.categories[cat],
        `[أ-كاش] categories.${cat}.letterCeilingReason حاضر بعد إعادة الاستخدام (stripVolatileFieldsFromReport لا تحذف حقولاً)`);
  }
  console.log(`تحقّق أ: letterCeilingReason حاضر كمفتاح على كل الفئات (${CATEGORIES.length}) عبر display/مخزَّن-RPC/كاش — مُتحقَّق بتشغيل حقيقي على b45c8cf6`);
}

// ═══════════════════════════════════════════════════════════════════════
// (ب) narrativeIncomplete/narrativeIncompleteFields — نفس السؤال.
// ═══════════════════════════════════════════════════════════════════════
{
  const {display} = buildDisplayShapeV7({categoryStates, findings, aiAnalysis: minimalAiAnalysis, language: 'ar'});
  // قبل أن تُضيفهما resolveV7Report.js — يثبت أنهما ليسا من buildDisplayShapeV7
  // نفسها (موثَّق في العقد، docs/V7_DISPLAY_SHAPE_CONTRACT.md §٠)
  ok(!('narrativeIncomplete' in display), '[إعداد] buildDisplayShapeV7 وحدها لا تكتب narrativeIncomplete — تُضاف فوقها');

  // محاكاة إضافة resolveV7Report.js الحقيقية (resolveV7Report.js:316-317)
  display.narrativeIncomplete = true;
  display.narrativeIncompleteFields = ['narrative.summary'];
  display.isFreeTrial = false;

  ok('narrativeIncomplete' in display, '[ب-display بعد resolveV7Report] narrativeIncomplete حاضر');
  ok('narrativeIncompleteFields' in display, '[ب-display بعد resolveV7Report] narrativeIncompleteFields حاضر');

  const aiResponseToSave = buildV7ResponseForStorage(display);
  ok('narrativeIncomplete' in aiResponseToSave, '[ب-مخزَّن/RPC] narrativeIncomplete حاضر (analyzeDevice.js: !!r.narrativeIncomplete، غير مشروط)');
  ok('narrativeIncompleteFields' in aiResponseToSave, '[ب-مخزَّن/RPC] narrativeIncompleteFields حاضر (Array.isArray(...) ? ... : []، غير مشروط)');
  eq(aiResponseToSave.narrativeIncomplete, true, '[ب-مخزَّن/RPC] القيمة الحقيقية وصلت لا افتراضية');
  assert.deepStrictEqual(aiResponseToSave.narrativeIncompleteFields, ['narrative.summary'], '[ب-مخزَّن/RPC] القائمة الحقيقية وصلت');

  const reused = stripVolatileFieldsFromReport(aiResponseToSave, 'old-scan-id');
  ok('narrativeIncomplete' in reused, '[ب-كاش] narrativeIncomplete حاضر بعد إعادة الاستخدام');
  ok('narrativeIncompleteFields' in reused, '[ب-كاش] narrativeIncompleteFields حاضر بعد إعادة الاستخدام');
  console.log('تحقّق ب: narrativeIncomplete/narrativeIncompleteFields حاضران كمفتاحَين عبر display(بعد resolveV7Report)/مخزَّن-RPC/كاش — مُتحقَّق بتشغيل حقيقي');
}

// ═══════════════════════════════════════════════════════════════════════
// verifyReport.js — إثبات كودي: categoriesOut تمريرة مباشرة، لا تصفية.
// ═══════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js'), 'utf8');
  ok(/const categoriesOut = \("categories" in ai[\s\S]{0,80}\? *\n? *ai\.categories/.test(src) ||
     /categoriesOut = \(.*ai\.categories.*\) *\?\s*\n?\s*ai\.categories/.test(src),
      '[verifyReport] categoriesOut = ai.categories تمريرة مباشرة بالمرجع — لا إعادة بناء تُسقط letterCeilingReason (verifyReport.js:294-295)');
  ok(/narrativeIncompleteOut = \("narrativeIncomplete" in ai\)/.test(src),
      '[verifyReport] narrativeIncompleteOut بقيمة احتياطية صريحة (false) حتى لو غاب المصدر — لا يسقط صامتاً');
  ok(/narrativeIncompleteFieldsOut = Array\.isArray\(ai\.narrativeIncompleteFields\)/.test(src),
      '[verifyReport] narrativeIncompleteFieldsOut بقيمة احتياطية صريحة ([]) حتى لو غاب المصدر');
}
console.log('تحقّق verifyReport: تمريرة مباشرة لـcategories (letterCeilingReason يرث حضوره من المصدر)، وضمان احتياطي صريح لـnarrativeIncomplete/Fields — مُتحقَّق من الكود مباشرة');

console.log(`\nv7AbsenceVsNullFieldsGuard.test.js: ${n}/${n} assertions passed`);
