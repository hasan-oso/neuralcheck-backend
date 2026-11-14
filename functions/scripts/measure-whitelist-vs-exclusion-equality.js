#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-whitelist-vs-exclusion-equality — يشترط (نصّ المستخدم
// حرفياً): "القائمة البيضاء تعطي عدد البايتات نفسه الذي يعطيه
// الاستبعاد — وأي فرق حقل لم يُسمَّ." يبني userMessage بطريقتين مستقلّتين
// من نفس categoryStates الحقيقي:
//   (أ) الاستبعاد اليدوي (نسخ سطحي ثم حذف الحقول المُسمّاة — أسلوب
//       commit d7893b8 قبل هذه المهمّة، مُعاد بناؤه هنا حرفياً للمقارنة
//       المستقلّة، لا استيراداً من buildV7Payload.js الذي صار يستهلك
//       القائمة البيضاء فعلياً الآن).
//   (ب) القائمة البيضاء الفعلية (v7ModelPayloadWhitelist.js، ما يستهلكه
//       buildV7Payload.js اليوم فعلياً).
// ويقارن السلسلتين النصّيتين الكاملتين بمساواة === حرفاً بحرف — لا الطول
// وحده (طولان متساويان قد يُخفيان حقلين تبادلا مكانهما).
//
// Usage: node functions/scripts/measure-whitelist-vs-exclusion-equality.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')); }

const TARGETS = [
  {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
  {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
];

// ─── (أ) إعادة بناء أسلوب الاستبعاد اليدوي حرفياً (commit d7893b8) ────────
const EXCLUDED_CATEGORY_FIELDS = ['finalLetter', 'adjustmentEvidence', 'adjustmentReason', 'adjustmentApplied', 'llmSuggestedLetter'];
const EXCLUDED_OVERALL_FIELDS = ['adjustments', 'disputed', 'llmOverall'];
const EXCLUDED_GATE_FIELDS = ['belowThreshold', 'allNonMeasurement'];

function stripGateFieldsOld(gatesApplied) {
  if (!Array.isArray(gatesApplied)) return gatesApplied;
  return gatesApplied.map((g) => {
    if (!g || typeof g !== 'object') return g;
    const copy = {...g};
    for (const f of EXCLUDED_GATE_FIELDS) delete copy[f];
    return copy;
  });
}
function stripCategoryFieldsOld(categories) {
  if (!categories || typeof categories !== 'object') return categories;
  const out = {};
  for (const cat of Object.keys(categories)) {
    const entry = categories[cat];
    if (!entry || typeof entry !== 'object') { out[cat] = entry; continue; }
    const copy = {...entry};
    for (const f of EXCLUDED_CATEGORY_FIELDS) delete copy[f];
    if ('gatesApplied' in copy) copy.gatesApplied = stripGateFieldsOld(copy.gatesApplied);
    out[cat] = copy;
  }
  return out;
}
function stripOverallFieldsOld(overall) {
  if (!overall || typeof overall !== 'object') return overall;
  const copy = {...overall};
  for (const f of EXCLUDED_OVERALL_FIELDS) delete copy[f];
  if ('gatesApplied' in copy) copy.gatesApplied = stripGateFieldsOld(copy.gatesApplied);
  return copy;
}

function buildUserMessageViaExclusion(findings, cs, scanId) {
  const body = {
    scanId: scanId || null, language: 'ar', isFreeTrial: false, findings: findings || null,
    testResults: (cs && Array.isArray(cs.testResults)) ? cs.testResults : [],
    categoryStates: cs ? {
      categories: stripCategoryFieldsOld(cs.categories),
      overall: stripOverallFieldsOld(cs.overall),
      issues: cs.issues,
    } : null,
    previousScan: null, priorRejection: null,
  };
  return JSON.stringify(body) + '\n\nProduce the analysis JSON now.';
}

function computeFor(scanId, tsFile) {
  const raw = loadJson(tsFile);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const cs = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  return {findings, cs};
}

const report = {generatedAt: new Date().toISOString(), scans: {}};
let allIdentical = true;

for (const {scanId, tsFile} of TARGETS) {
  const {findings, cs} = computeFor(scanId, tsFile);
  const viaExclusion = buildUserMessageViaExclusion(findings, cs, scanId);
  const {userMessage: viaWhitelist} = buildV7Payload({
    findings, categoryStates: cs, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });

  const identical = viaExclusion === viaWhitelist;
  allIdentical = allIdentical && identical;

  let firstDiffAt = -1;
  if (!identical) {
    const minLen = Math.min(viaExclusion.length, viaWhitelist.length);
    for (let i = 0; i < minLen; i++) {
      if (viaExclusion[i] !== viaWhitelist[i]) { firstDiffAt = i; break; }
    }
    if (firstDiffAt === -1) firstDiffAt = minLen;
  }

  report.scans[scanId] = {
    exclusionLength: viaExclusion.length,
    whitelistLength: viaWhitelist.length,
    identicalStrictEquality: identical,
    firstDiffAt: firstDiffAt === -1 ? null : firstDiffAt,
    contextAroundFirstDiff: firstDiffAt === -1 ? null : {
      exclusion: viaExclusion.slice(Math.max(0, firstDiffAt - 60), firstDiffAt + 60),
      whitelist: viaWhitelist.slice(Math.max(0, firstDiffAt - 60), firstDiffAt + 60),
    },
  };

  console.log(`${scanId}: exclusion.length=${viaExclusion.length} whitelist.length=${viaWhitelist.length} identical(===)=${identical}`);
  if (!identical) {
    console.log('  أوّل اختلاف عند index', firstDiffAt);
    console.log('  [استبعاد]:', report.scans[scanId].contextAroundFirstDiff.exclusion);
    console.log('  [قائمة بيضاء]:', report.scans[scanId].contextAroundFirstDiff.whitelist);
  }
}

report.allIdentical = allIdentical;
const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, {recursive: true});
const outPath = path.join(OUT_DIR, `whitelist-vs-exclusion-equality-2026-09-23.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nallIdentical (كلا الفِخّين): ${allIdentical}`);
console.log(`مخرَج محفوظ في: ${outPath}`);
if (!allIdentical) process.exit(1);
