#!/usr/bin/env node
'use strict';

// ===================================================================
// fix-frozen-fake-cpu-c06-postredaction-2026-10-01 — تصحيح وحيد وموثَّق
// على test/fixtures/frozen-fake-model-response-cpu-down-c06-fail-modified-
// input-2026-09-25.json بعد مهمّة 2026-10-01 +03 (بنود ٢-٥ من أمر المستخدم،
// "إخفاء القيم غير المعايَرة عن حمولة النموذج").
// ===================================================================
//
// لماذا: هذا الملفّ موسوم `_provenance.kind`
// "FAKE_MODEL_RESPONSE_ON_MODIFIED_INPUT" — **ليس** "ردّاً حقيقياً مسجَّلاً"
// (القاعدة التي تحمي الردود الحقيقية المسجَّلة من التعديل لا تشمله، نصّاً:
// "والقاعدة 8 تحمي الردود والفحوص الحقيقية المسجَّلة وحدها"). لكن محتواه
// (بتوثيق _provenance.whatWasFabricated نفسه) "حرفي من الأصل بلا مساس" في
// كل حقل عدا adjustments[0] وحذف مفتاح POS-cpu — أي أن narrative/crossChecks
// منسوخة من frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json
// بلا تغيير. وقد صار crossChecks[3].description فيه مرفوضاً بعد البند ٢:
// "كمّية شحن مقيسة 143.84 ملي أمبير-ساعة" مصدرها مؤشّر بطارية محجوب الآن
// (BAT-COULOMB أو مشتقّ منه)، فلا مصدر له في الحمولة المُرسَلة — مُتحقَّق
// بتشغيل مباشر (guardV7Response على body.findings/body.categoryStates+
// testResults الحقيقيَّين لهذا الفِخّ بعد تعديل C-06، لا تخمين): unmatchedFields
// = [{field:"crossChecks[3].description", numbers:[143.84]}] وحده — لا شيء
// آخر (issueKeys.ok=true، languageLeaks=0، شكل سليم). هذا يكسر فرضية مولّد
// generate-v7-reports-document-sample-cpu-c06-downgrade.js: "يُقبَل من
// المحاولة الأولى" (fetchCallCount===1)، التي وثّقها _provenance نفسه
// ("guardVerifiedAtGenerationTime: نعم").
//
// نفس الاستبدال بالضبط المُطبَّق سابقاً على derived-from-frozen-real-2026-
// 09-23-adjustments-usersettings-fix.json (functions/scripts/generate-
// derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix.js،
// POST_REDACTION_REPLACEMENTS_2026_10_01) — نفس الجملة حرفياً في كلا
// الملفّين (كلاهما من نفس المصدر الأصلي). التحقّق الذاتي أدناه عبر
// guardV7Response الحقيقية على buildV7Payload الحقيقية (لا افتراض).
//
// Run: node functions/scripts/fix-frozen-fake-cpu-c06-postredaction-2026-10-01.js

const fs = require('fs');
const path = require('path');

const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const TARGET_FILE = path.join(FIXTURES_DIR, 'frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

const FROM_TEXT = 'مقابل سعة تصميمية 4400 وبنسبة إلى التصميم 0.8587، وكمية شحن مقيسة 143.84 ملي أمبير-ساعة';
const TO_TEXT = 'مقابل سعة التصميم المعلَنة — وهو ما لا يحمل حكماً بلا عتبة معايَرة';

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function buildScanInputsWithC06Fail() {
  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const realFunctionalResults = frMap[SCAN_ID];
  const functionalResults = realFunctionalResults.map((r) =>
    (r.testId === 'C-06' ? Object.assign({}, r, {status: 'fail'}) : r));
  const fingerprint = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults, manualResults: []};
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults, manualResults: [], dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
    analyzedAtMs: ANALYZED_AT_MS,
  });
  return {findings, categoryStates};
}

function main() {
  const wrapper = loadJson(TARGET_FILE);
  if (!wrapper._provenance || wrapper._provenance.kind !== 'FAKE_MODEL_RESPONSE_ON_MODIFIED_INPUT — مدخل معدَّل وردّ نموذج مصنوع، لا نداء نموذج فعلي') {
    throw new Error('fix-frozen-fake-cpu-c06-postredaction: توقّف — الملفّ غير موسوم كما هو متوقَّع، لا تعديل');
  }
  const parsed = JSON.parse(wrapper.rawEnvelope.choices[0].message.content);
  const text = parsed.crossChecks[3] && parsed.crossChecks[3].description;
  if (typeof text !== 'string' || !text.includes(FROM_TEXT)) {
    throw new Error(`fix-frozen-fake-cpu-c06-postredaction: توقّف — النصّ المتوقَّع غير موجود في crossChecks[3].description: ${JSON.stringify(FROM_TEXT)}`);
  }
  if (text.split(FROM_TEXT).length - 1 !== 1) {
    throw new Error('fix-frozen-fake-cpu-c06-postredaction: توقّف — النصّ يتكرّر أكثر من مرّة، الاستبدال غير آمن');
  }
  parsed.crossChecks[3].description = text.split(FROM_TEXT).join(TO_TEXT);

  // ─── تحقّق ذاتي بالحارس الحقيقي على الحمولة الحقيقية (لا افتراض) ───────
  const {findings, categoryStates} = buildScanInputsWithC06Fail();
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
  const categoryStatesForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});
  const guard = guardV7Response(parsed, {findings: body.findings, categoryStates: categoryStatesForGuard});
  if (!guard.ok) {
    throw new Error(`fix-frozen-fake-cpu-c06-postredaction: توقّف — guard.ok≠true بعد التعديل: ${JSON.stringify(guard)}`);
  }

  wrapper.rawEnvelope.choices[0].message.content = JSON.stringify(parsed);
  wrapper._provenance.postRedactionEdit2026_10_01 = {
    date: '2026-10-01',
    reason: 'مهمّة إخفاء القيم غير المعايَرة عن حمولة النموذج (البند ٢) — crossChecks[3].description استشهد برقم مصدره مؤشّر بطارية محجوب الآن (143.84، كمّية شحن مقيسة)، فصار مرفوضاً من حارس الأرقام (guardV7Response) ويكسر فرضية "مقبول من المحاولة الأولى" لمولّد generate-v7-reports-document-sample-cpu-c06-downgrade.js.',
    field: 'crossChecks[3].description',
    from: FROM_TEXT,
    to: TO_TEXT,
    verifiedBy: 'guardV7Response(parsed, {findings: body.findings, categoryStates: {...body.categoryStates, testResults: body.testResults}}).ok === true بعد التعديل (buildV7Payload الحقيقية، C-06=fail)',
  };

  fs.writeFileSync(TARGET_FILE, JSON.stringify(wrapper, null, 2) + '\n', 'utf8');
  console.log('fix-frozen-fake-cpu-c06-postredaction: تم — guard.ok=true بعد التعديل، الملفّ مكتوب:', TARGET_FILE);
}

main();
