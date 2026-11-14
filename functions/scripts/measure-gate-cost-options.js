#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-gate-cost-options — قياس تفصيلي لكائنات gate داخل حمولة V7
// الفعلية (buildV7Payload، لا إعادة بناء يدوية) — أمر 2026-09-23، البند ٣:
// أين تقع الـ34 كائناً (منها 24 LOW_CATEGORY_COVERAGE)؟ هل مكرَّرة بين
// categories.<cat> وoverall؟ كم NOT_FIRED؟ كم بايتاً يشغل كل خيار حذف؟
//
// **لا يُعدِّل أي كود إنتاجي — قياس فقط، بلا قرار.**
//
// Usage: node functions/scripts/measure-gate-cost-options.js [--out path]
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

function payloadLenFromCs(findings, cs, scanId) {
  const {userMessage} = buildV7Payload({
    findings, categoryStates: cs, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });
  return userMessage.length;
}

// تعديلات على نسخة عميقة من cs — كلّها تُطبَّق قبل buildV7Payload الفعلية.
function withGateTransform(cs, transformGate) {
  const clone = JSON.parse(JSON.stringify(cs));
  const walkGatesArray = (arr) => {
    if (!Array.isArray(arr)) return arr;
    return arr.map(transformGate).filter((g) => g !== null);
  };
  if (clone.overall) clone.overall.gatesApplied = walkGatesArray(clone.overall.gatesApplied);
  if (clone.categories) {
    for (const cat of Object.keys(clone.categories)) {
      clone.categories[cat].gatesApplied = walkGatesArray(clone.categories[cat].gatesApplied);
    }
  }
  return clone;
}

const report = {generatedAt: new Date().toISOString(), scans: {}};

for (const {scanId, tsFile} of TARGETS) {
  const {findings, cs} = computeFor(scanId, tsFile);
  const scanReport = {};

  // ─── الموضع/العدّ ────────────────────────────────────────────────────
  let overallCount = 0; let overallLowCov = 0; let overallNotFired = 0;
  let categoryCount = 0; let categoryLowCov = 0; let categoryNotFired = 0;
  const perCategoryBreakdown = {};
  const duplicatedKeys = new Set(); // (category+name) الموجودة في overall
  const overallKeySet = new Set();

  for (const g of (cs.overall.gatesApplied || [])) {
    overallCount++;
    overallKeySet.add(`${g.category}::${g.name}`);
    if (g.name === 'LOW_CATEGORY_COVERAGE') overallLowCov++;
    if (g.status === 'NOT_FIRED') overallNotFired++;
  }
  for (const cat of Object.keys(cs.categories)) {
    const arr = cs.categories[cat].gatesApplied || [];
    if (arr.length) perCategoryBreakdown[cat] = arr.map((g) => ({name: g.name, status: g.status}));
    for (const g of arr) {
      categoryCount++;
      if (g.name === 'LOW_CATEGORY_COVERAGE') categoryLowCov++;
      if (g.status === 'NOT_FIRED') categoryNotFired++;
      const key = `${g.category}::${g.name}`;
      if (overallKeySet.has(key)) duplicatedKeys.add(key);
    }
  }
  scanReport.counts = {
    total: overallCount + categoryCount,
    overall: {total: overallCount, lowCategoryCoverage: overallLowCov, notFired: overallNotFired},
    perCategory: {total: categoryCount, lowCategoryCoverage: categoryLowCov, notFired: categoryNotFired},
    perCategoryBreakdown,
    duplicatedBetweenCategoryAndOverall: duplicatedKeys.size,
    duplicatedList: [...duplicatedKeys].sort(),
  };

  // ─── تكلفة البايت لكل خيار (على userMessage.length، buildV7Payload الفعلية) ─
  const baseline = payloadLenFromCs(findings, cs, scanId);

  const removeBelowAllNon = (g) => {
    const c = {...g}; delete c.belowThreshold; delete c.allNonMeasurement; return c;
  };
  const removeBelowAllNonCovPct = (g) => {
    const c = removeBelowAllNon(g); delete c.coveragePct; return c;
  };
  const removeBelowAllNonCovPctSource = (g) => {
    const c = removeBelowAllNonCovPct(g); delete c.source; return c;
  };
  const removeAllNotFired = (g) => (g.status === 'NOT_FIRED' ? null : g);
  const minimalFive = (g) => ({name: g.name, category: g.category, ceilingLetter: g.ceilingLetter, status: g.status, source: g.source});

  const options = {
    baseline_current: baseline,
    fix_belowThreshold_allNonMeasurement_only: payloadLenFromCs(findings, withGateTransform(cs, removeBelowAllNon), scanId),
    also_drop_coveragePct: payloadLenFromCs(findings, withGateTransform(cs, removeBelowAllNonCovPct), scanId),
    also_drop_source_technical: payloadLenFromCs(findings, withGateTransform(cs, removeBelowAllNonCovPctSource), scanId),
    also_drop_all_NOT_FIRED_gates: payloadLenFromCs(findings, withGateTransform(
        withGateTransform(cs, removeBelowAllNonCovPctSource), removeAllNotFired), scanId),
    minimal_five_fields_name_category_ceilingLetter_status_source: payloadLenFromCs(
        findings, withGateTransform(cs, minimalFive), scanId),
    remove_category_level_duplication_keep_overall_only: (() => {
      const clone = JSON.parse(JSON.stringify(cs));
      for (const cat of Object.keys(clone.categories)) clone.categories[cat].gatesApplied = [];
      return payloadLenFromCs(findings, clone, scanId);
    })(),
  };

  scanReport.byteOptions = {};
  for (const [label, val] of Object.entries(options)) {
    scanReport.byteOptions[label] = {payloadLength: val, deltaFromBaseline: val - baseline};
  }

  report.scans[scanId] = scanReport;
}

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, {recursive: true});
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = outIdx >= 0 ? argv[outIdx + 1] : path.join(OUT_DIR, `gate-cost-options-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('═══ measure-gate-cost-options — موجز ═══\n');
for (const {scanId} of TARGETS) {
  const s = report.scans[scanId];
  console.log(`── ${scanId} ──`);
  console.log(`  الإجمالي: ${s.counts.total} كائن gate`);
  console.log(`  overall.gatesApplied: ${s.counts.overall.total} (LOW_CATEGORY_COVERAGE=${s.counts.overall.lowCategoryCoverage}، NOT_FIRED=${s.counts.overall.notFired})`);
  console.log(`  categories.<cat>.gatesApplied مجتمعة: ${s.counts.perCategory.total} (LOW_CATEGORY_COVERAGE=${s.counts.perCategory.lowCategoryCoverage}، NOT_FIRED=${s.counts.perCategory.notFired})`);
  console.log(`  مكرَّرة بين categories.X وoverall (نفس category+name في الموضعين): ${s.counts.duplicatedBetweenCategoryAndOverall}`);
  console.log(`  تفصيل كل فئة: ${JSON.stringify(s.counts.perCategoryBreakdown)}`);
  console.log(`  خيارات البايت (userMessage.length، Δ عن الأساس الحالي):`);
  for (const [label, v] of Object.entries(s.byteOptions)) {
    console.log(`    ${label.padEnd(55)} ${v.payloadLength}  Δ=${v.deltaFromBaseline >= 0 ? '+' : ''}${v.deltaFromBaseline}`);
  }
  console.log('');
}
console.log(`مخرَج كامل محفوظ في: ${outPath}`);
