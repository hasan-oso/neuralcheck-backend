#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-score-field-bytes — قياس منفرد لتكلفة categories.<cat>.score
// وحده في حمولة V7 (أمر مستخدم 2026-09-23 +03، القرار ٥ب: "أبقِه في
// القائمة البيضاء، وقِس بايتاته وحده كي يُعرف الثابت البديل إن أصرّ
// المستخدم" — القرار حُسم لاحقاً: score يبقى، هذا القياس للتوثيق فقط،
// لا لتغيير الثابت).
//
// Usage: node functions/scripts/measure-score-field-bytes.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {EXPECTED_V7_PAYLOAD_BYTES} = require('../src/analysis/expectedV7PayloadBytes');

const GOLDEN = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN, name), 'utf8')); }

function deepDeleteField(obj, field) {
  if (Array.isArray(obj)) {
    for (const item of obj) deepDeleteField(item, field);
  } else if (obj && typeof obj === 'object') {
    if (field in obj) delete obj[field];
    for (const k of Object.keys(obj)) deepDeleteField(obj[k], field);
  }
}

const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const report = {generatedAt: new Date().toISOString(), scans: {}};

for (const {scanId, tsFile, expectedPayloadBytes} of EXPECTED_V7_PAYLOAD_BYTES) {
  const raw = loadJson(tsFile);
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const cs = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const {userMessage: withScore} = buildV7Payload({
    findings, categoryStates: cs, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });

  const csWithoutScore = JSON.parse(JSON.stringify(cs));
  deepDeleteField(csWithoutScore, 'score');
  const {userMessage: withoutScore} = buildV7Payload({
    findings, categoryStates: csWithoutScore, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });

  const delta = withScore.length - withoutScore.length;
  report.scans[scanId] = {
    withScoreLength: withScore.length, withoutScoreLength: withoutScore.length,
    scoreFieldBytes: delta, matchesCurrentConstant: withScore.length === expectedPayloadBytes,
  };
  console.log(`${scanId}: مع score=${withScore.length}  بلا score=${withoutScore.length}  تكلفة score وحده=${delta} بايت`);
}

const OUT_DIR = path.join(__dirname, 'out');
fs.mkdirSync(OUT_DIR, {recursive: true});
const outPath = path.join(OUT_DIR, 'score-field-bytes-2026-09-23.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nمخرَج محفوظ في: ${outPath}`);
