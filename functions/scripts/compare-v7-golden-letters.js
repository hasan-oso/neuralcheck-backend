#!/usr/bin/env node
'use strict';

// ===================================================================
// compare-v7-golden-letters — يستخرج كل حقل `letter` (overall وكل فئة) من
// العيّنات الذهبية الثلاث، ويقارن لقطتين (قبل/بعد) — أداة الإثبات المطلوبة
// صراحة في القرار ٧٥ البند ٤/د: "لا يتغيّر أي حرف. يُثبَت ذلك بالأداة: فرق
// الحروف في العيّنات الذهبية المُعادة = 0، وإن لم يكن صفراً: توقّف."
// ===================================================================
//
// استخراج عام (لا بحسب شكل كل ملفّ يدوياً) — يمشي الشجرة كاملة ويلتقط كل
// مفتاح حرفي اسمه `letter` بمساره الكامل. الأشكال الثلاثة مختلفة بنيوياً
// (v7-client-payload-sample: overall.letter/categories.<cat>.letter —
// v7-reports-document-sample: aiResponse.overall.letter/aiResponse.categories
// .<cat>.letter — v7-verifyReport-response-sample: aiResponse.letter/
// aiResponse.categories.<cat>.letter) فلا فائدة من تعداد يدوي لكل شكل؛
// المشي العام يلتقط الثلاثة بنفس الكود، ويبقى صحيحاً حتى لو تغيّر عمق
// التداخل مستقبلاً.
//
// Usage:
//   node scripts/compare-v7-golden-letters.js --save <out.json>     # يحفظ لقطة من الملفّات المُلتزَمة الحالية على القرص
//   node scripts/compare-v7-golden-letters.js --save-fresh <out.json>  # يحفظ لقطة من مخرَج المولّدات الطازج (في الذاكرة، بلا كتابة على test/fixtures)
//   node scripts/compare-v7-golden-letters.js --diff <in.json>      # يقارن لقطة محفوظة بمخرَج المولّدات الطازج الحالي، يطبع العدد
// ===================================================================

const fs = require('fs');
const path = require('path');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const SAMPLES = [
  {name: 'v7-client-payload-sample.json', committedPath: path.join(GOLDEN_DIR, 'v7-client-payload-sample.json')},
  {name: 'v7-reports-document-sample.json', committedPath: path.join(GOLDEN_DIR, 'v7-reports-document-sample.json')},
  {name: 'v7-verifyReport-response-sample.json', committedPath: path.join(GOLDEN_DIR, 'v7-verifyReport-response-sample.json')},
];

function extractLetters(obj, prefix, out) {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => extractLetters(v, `${prefix}[${i}]`, out));
    return;
  }
  for (const k of Object.keys(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (k === 'letter') {
      out[p] = obj[k];
    } else {
      extractLetters(obj[k], p, out);
    }
  }
}

/** @return {Object} {sampleName: {path: letterValue}} من الملفّات المُلتزَمة على القرص */
function snapshotFromCommittedFiles() {
  const snap = {};
  for (const s of SAMPLES) {
    const data = JSON.parse(fs.readFileSync(s.committedPath, 'utf8'));
    const letters = {};
    extractLetters(data, '', letters);
    snap[s.name] = letters;
  }
  return snap;
}

/** @return {Object} نفس الشكل، لكن من مخرَج المولّدات الطازج في الذاكرة (لا قراءة قرص) */
function snapshotFromFreshGenerators() {
  const {buildClientPayloadSample} = require('./generate-v7-client-payload-sample');
  const {buildReportsDocumentSample} = require('./generate-v7-reports-document-sample');
  const {buildVerifyReportResponseSample} = require('./generate-v7-verifyReport-response-sample');

  const snap = {};
  {
    const {clientPayload} = buildClientPayloadSample();
    const letters = {};
    extractLetters(clientPayload, '', letters);
    snap['v7-client-payload-sample.json'] = letters;
  }
  {
    const {reportDocument} = buildReportsDocumentSample();
    const letters = {};
    extractLetters(reportDocument, '', letters);
    snap['v7-reports-document-sample.json'] = letters;
  }
  {
    const {response} = buildVerifyReportResponseSample();
    const letters = {};
    extractLetters(response, '', letters);
    snap['v7-verifyReport-response-sample.json'] = letters;
  }
  return snap;
}

function diffSnapshots(before, after) {
  const diffs = [];
  const sampleNames = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const sampleName of sampleNames) {
    const b = before[sampleName] || {};
    const a = after[sampleName] || {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    for (const k of keys) {
      if (b[k] !== a[k]) diffs.push(`${sampleName}::${k}: قبل=${JSON.stringify(b[k])} بعد=${JSON.stringify(a[k])}`);
    }
  }
  return diffs;
}

function main() {
  const argv = process.argv.slice(2);
  const saveIdx = argv.indexOf('--save');
  const saveFreshIdx = argv.indexOf('--save-fresh');
  const diffIdx = argv.indexOf('--diff');

  if (saveIdx !== -1) {
    const outPath = argv[saveIdx + 1];
    if (!outPath) throw new Error('compare-v7-golden-letters: --save يحتاج مساراً');
    const snap = snapshotFromCommittedFiles();
    fs.writeFileSync(outPath, JSON.stringify(snap, null, 2) + '\n', 'utf8');
    let total = 0;
    for (const s of Object.values(snap)) total += Object.keys(s).length;
    console.log(`لقطة مُلتزَمة (${total} حرفاً عبر ${Object.keys(snap).length} عيّنات) → ${outPath}`);
    return;
  }

  if (saveFreshIdx !== -1) {
    const outPath = argv[saveFreshIdx + 1];
    if (!outPath) throw new Error('compare-v7-golden-letters: --save-fresh يحتاج مساراً');
    const snap = snapshotFromFreshGenerators();
    fs.writeFileSync(outPath, JSON.stringify(snap, null, 2) + '\n', 'utf8');
    let total = 0;
    for (const s of Object.values(snap)) total += Object.keys(s).length;
    console.log(`لقطة طازجة (${total} حرفاً عبر ${Object.keys(snap).length} عيّنات) → ${outPath}`);
    return;
  }

  if (diffIdx !== -1) {
    const inPath = argv[diffIdx + 1];
    if (!inPath) throw new Error('compare-v7-golden-letters: --diff يحتاج مساراً');
    const before = JSON.parse(fs.readFileSync(inPath, 'utf8'));
    const after = snapshotFromFreshGenerators();
    const diffs = diffSnapshots(before, after);
    let totalBefore = 0;
    for (const s of Object.values(before)) totalBefore += Object.keys(s).length;
    let totalAfter = 0;
    for (const s of Object.values(after)) totalAfter += Object.keys(s).length;
    console.log(`قبل: ${totalBefore} حرفاً — بعد (طازج): ${totalAfter} حرفاً`);
    console.log(`فرق الحروف: ${diffs.length}`);
    if (diffs.length > 0) {
      for (const d of diffs) console.log(`  ${d}`);
    }
    process.exitCode = diffs.length === 0 ? 0 : 1;
    return;
  }

  throw new Error('compare-v7-golden-letters: استعمل --save <out.json> أو --save-fresh <out.json> أو --diff <in.json>');
}

if (require.main === module) {
  main();
}

module.exports = {extractLetters, snapshotFromCommittedFiles, snapshotFromFreshGenerators, diffSnapshots};
