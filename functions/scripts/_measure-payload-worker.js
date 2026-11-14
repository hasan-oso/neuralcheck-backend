#!/usr/bin/env node
'use strict';

// _measure-payload-worker — عملية node مستقلّة تُستدعى من
// measure-payload-history.js لكل worktree على حدة (تفادي تلوّث ذاكرة
// require() بوحدات من التزامات مختلفة بنفس المسار). تبني الحمولة
// بـbuildV7Payload الفعلية (لا إعادة بناء يدوية — القيد الصريح: التشغيل
// اليدوي أظهر فارق 1807 بايت عن buildV7Payload الحقيقية) من وحدات
// <functionsDir> نفسها، وتطبع JSON على stdout.
//
// Usage: node _measure-payload-worker.js <functionsDir>

const fs = require('fs');
const path = require('path');

const functionsDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!functionsDir) {
  console.error('usage: _measure-payload-worker.js <functionsDir>');
  process.exit(2);
}

function req(rel) { return require(path.join(functionsDir, rel)); }

const out = {scans: {}, error: null};

try {
  const {computeFindings} = req('src/analysis/findings');
  const {computeCategoryStates} = req('src/analysis/categoryStates');
  const {buildV7Payload} = req('src/analysis/buildV7Payload');
  const {sampleInputsFromRaw} = req('src/analysis/sampleInputsFromRaw');

  const GOLDEN = path.join(functionsDir, 'test', 'fixtures', 'golden');
  function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')); }
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;

  const TARGETS = [
    {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
    {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
  ];

  for (const {scanId, tsFile} of TARGETS) {
    const raw = loadJson(tsFile);
    const functional = frMap[scanId];
    const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
    const findings = computeFindings(fp);
    const inputs = sampleInputsFromRaw(raw);
    const cs = computeCategoryStates({
      functionalResults: functional, manualResults: [], dev: null, findings,
      batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    });
    const {userMessage} = buildV7Payload({
      findings, categoryStates: cs, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
    });

    let gateObjCount = 0;
    let lowCovGateCount = 0;
    let notFiredCount = 0;
    const gateLocations = {overall: 0, categories: {}};
    const countGates = (arr, where) => {
      if (!Array.isArray(arr)) return;
      for (const g of arr) {
        gateObjCount++;
        if (g && g.name === 'LOW_CATEGORY_COVERAGE') lowCovGateCount++;
        if (g && g.status === 'NOT_FIRED') notFiredCount++;
        if (where === 'overall') gateLocations.overall++;
        else gateLocations.categories[where] = (gateLocations.categories[where] || 0) + 1;
      }
    };
    if (cs.overall && Array.isArray(cs.overall.gatesApplied)) countGates(cs.overall.gatesApplied, 'overall');
    if (cs.categories) {
      for (const cat of Object.keys(cs.categories)) {
        if (cs.categories[cat] && Array.isArray(cs.categories[cat].gatesApplied)) {
          countGates(cs.categories[cat].gatesApplied, cat);
        }
      }
    }

    out.scans[scanId] = {
      payloadLength: userMessage.length,
      gateObjCount, lowCovGateCount, notFiredCount,
      gateLocations,
      hasLowCategoryCoverageGate: lowCovGateCount > 0,
    };
  }
} catch (e) {
  out.error = String(e && e.stack || e);
}

process.stdout.write(JSON.stringify(out));
