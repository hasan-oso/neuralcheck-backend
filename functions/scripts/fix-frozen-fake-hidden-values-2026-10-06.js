#!/usr/bin/env node
'use strict';

// ===================================================================
// fix-frozen-fake-hidden-values-2026-10-06 — يُحدِّث **في مكانه** ردَّي النموذج
// المصنوعَين (FAKE_MODEL_RESPONSE*) كي لا يستشهد أيٌّ منهما برقم محجوب عن
// حمولة النموذج. أمر مستخدم 2026-10-06 (D6) بنصّه: "الملفّات المصنوعة تُحدَّث
// في مكانها، والمشتقّة تُكتب نسخة جديدة موسومة. فلا يستشهد أيٌّ منها برقم
// محجوب."
// ===================================================================
//
// - frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json
//   (مدخل: b45c8cf6 مع C-06 pass→fail — راجع generate-v7-reports-document-sample-
//   cpu-c06-downgrade.js)
// - frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json
//   (مدخل: b45c8cf6 بلا تعديل)
// كلاهما موسوم `_provenance.kind` FAKE_MODEL_RESPONSE — ليس ردّاً حقيقياً مسجَّلاً
// (القاعدة التي تحمي الردود الحقيقية المسجَّلة لا تشمله). **لا يستشهد أيٌّ منهما
// بقيمة حقيقية محجوبة** بعد هذا التحديث: يُدقَّق بـscripts/audit-fixtures-hidden-
// number-citations.js (مصدر كل رقم في scripts/lib/fixtureTextEdits.js).
//
// يرمي إن لم يجد أيّ عبارة مرّة واحدة بالضبط، أو إن رفض الحارس الحقيقي الناتج
// (على الحمولة الفعلية: body.findings + categoryStates+testResults).
//
// Run: node functions/scripts/fix-frozen-fake-hidden-values-2026-10-06.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {
  applyTextEdits, B45_FAMILY_COMMON, B45_FAMILY_TREE_2026_10_06, B45_FAMILY_TREE_2026_10_07, B45_ADJ_CPU_SUSTAINED, B45_ADJ_GPU_SUSTAINED,
} = require('./lib/fixtureTextEdits');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

const TARGETS = Object.freeze([
  {
    file: 'frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json',
    kind: 'FAKE_MODEL_RESPONSE_ON_MODIFIED_INPUT — مدخل معدَّل وردّ نموذج مصنوع، لا نداء نموذج فعلي',
    modifiedC06: true,
    edits: [...B45_FAMILY_COMMON, ...B45_FAMILY_TREE_2026_10_06, ...B45_ADJ_GPU_SUSTAINED],
    edits07: B45_FAMILY_TREE_2026_10_07, // أمر 2026-10-07 (قرار القوائم)
  },
  {
    file: 'frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json',
    kind: 'FAKE_MODEL_RESPONSE — ردّ نموذج مصنوع، لا نداء نموذج فعلي',
    modifiedC06: false,
    edits: [...B45_FAMILY_COMMON, ...B45_FAMILY_TREE_2026_10_06, ...B45_ADJ_CPU_SUSTAINED],
    edits07: B45_FAMILY_TREE_2026_10_07,
  },
]);

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function scanInputs(modifiedC06) {
  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const real = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId[SCAN_ID];
  const functionalResults = modifiedC06 ?
      real.map((r) => (r.testId === 'C-06' ? Object.assign({}, r, {status: 'fail'}) : r)) : real;
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults, manualResults: []});
  const battery = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults, manualResults: [], dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
    analyzedAtMs: ANALYZED_AT_MS,
  });
  return {findings, categoryStates};
}

function main() {
  for (const t of TARGETS) {
    const file = path.join(FIXTURES_DIR, t.file);
    const wrapper = loadJson(file);
    if (!wrapper._provenance || wrapper._provenance.kind !== t.kind) {
      throw new Error(`fix-frozen-fake-hidden-values: توقّف — ${t.file} غير موسوم كما هو متوقَّع (${t.kind}) — لا تعديل`);
    }
    const parsed = JSON.parse(wrapper.rawEnvelope.choices[0].message.content);
    applyTextEdits(parsed, [...t.edits, ...t.edits07], `fix-frozen-fake-hidden-values(${t.file})`, {allowAlreadyApplied: true}); // إعادة تشغيل آمنة: ما طُبِّق سابقاً يُتخطّى

    const {findings, categoryStates} = scanInputs(t.modifiedC06);
    const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: SCAN_ID, isFreeTrial: false, previousScan: null});
    const csForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});
    const guard = guardV7Response(parsed, {findings: body.findings, categoryStates: csForGuard});
    if (!guard.ok) {
      throw new Error(`fix-frozen-fake-hidden-values: توقّف — guard.ok≠true بعد التعديل (${t.file}): ${JSON.stringify(guard)}`);
    }

    wrapper.rawEnvelope.choices[0].message.content = JSON.stringify(parsed);
    wrapper._provenance.hiddenValuesEdit2026_10_06 = {
      date: '2026-10-06',
      reason: 'أمر مستخدم (D6): الملفّات المصنوعة تُحدَّث في مكانها كي لا يستشهد أيٌّ منها برقم محجوب عن حمولة النموذج.',
      script: 'functions/scripts/fix-frozen-fake-hidden-values-2026-10-06.js',
      replacements: t.edits,
      verifiedBy: 'guardV7Response على الحمولة الفعلية ok===true؛ scripts/audit-fixtures-hidden-number-citations.js = 0 استشهاد',
    };
    wrapper._provenance.hiddenValuesEdit2026_10_07 = {
      date: '2026-10-07',
      reason: 'أمر مستخدم (قرار القوائم): حُجبت قيم S-02 وR-02 وB-02 وB-03 عن حمولة النموذج، فلا يستشهد بها هذا الملفّ المصنوع (يُحدَّث في مكانه، D6).',
      script: 'functions/scripts/fix-frozen-fake-hidden-values-2026-10-06.js',
      replacements: t.edits07,
      verifiedBy: 'guardV7Response على الحمولة الفعلية ok===true؛ scripts/audit-fixtures-hidden-number-citations.js = 0 استشهاد',
    };
    fs.writeFileSync(file, JSON.stringify(wrapper, null, 2) + '\n', 'utf8');
    console.log(`fix-frozen-fake-hidden-values: ${t.file} — guard.ok=true، ${t.edits.length} استبدالاً`);
  }
}

main();
