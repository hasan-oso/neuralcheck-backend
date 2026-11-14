#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-verifyReport-response-sample-honor — ردّ verifyReport لعيّنة
// Honor (e4b65a2f، harnessError/letter=null) — نفس تقنية new Function التي
// يستعملها generate-v7-verifyReport-response-sample.js (والاختبار الذي
// أخذت عنه التقنية أصلاً)، على مستند v7-reports-document-sample-honor.json
// بدل عيّنة 34dff2b8. صفر تعديل على verifyReport.js، صفر Firestore، صفر
// نداء نموذج.
//
// أمر مستخدم 2026-09-24 +03 (القرار ٧٩ البند أ). راجع رأس
// generate-v7-reports-document-sample-honor.js لتفصيل "لماذا letter=null
// وأيّ فرع من resolveV7Report.js تُحاكي هذه العيّنة (providerFailedNoFallback،
// لا نداء نموذج حقيقي)".
//
// Run: node functions/scripts/generate-v7-verifyReport-response-sample-honor.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildReportsDocumentSampleHonor, SCAN_ID} = require('./generate-v7-reports-document-sample-honor');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-verifyReport-response-sample-honor.json');
const VERIFY_REPORT_SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');

// ─── نفس تقنية generate-v7-verifyReport-response-sample.js حرفياً ───────
function buildResponse(reportDoc, warnSink) {
  const src = fs.readFileSync(VERIFY_REPORT_SRC, 'utf8');
  const startMarker = 'const report = reportDoc.data();';
  const endMarker = 'res.json(response);';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (!(startIdx > -1 && endIdx > -1 && endIdx > startIdx)) {
    throw new Error('generate-v7-verifyReport-response-sample-honor: العلامتان غير موجودتين في verifyReport.js بالترتيب المتوقَّع — توقّف');
  }
  const bodySrc = src.slice(startIdx, endIdx);

  const warns = [];
  const cons = {
    log: () => {},
    warn: (...args) => { warns.push(args.join(' ')); },
    error: () => {},
  };
  const fn = new Function(
      'reportDoc', 'console', 'V7_PIPELINE_TAG', 'V6_PIPELINE_TAG', 'hashIdForLog', // hashIdForLog: S-SUB 2026-10-16 — سطر تحذير V7 يُهشِّر scanId؛ وسيط صريح (القاعدة 16: إصلاح الأداة)
      bodySrc + '\nreturn response;');
  const response = fn(reportDoc, cons, V7_PIPELINE_TAG, V6_PIPELINE_TAG, hashIdForLog);
  if (warnSink) warnSink.push(...warns);
  return response;
}

function fakeDoc(id, data) {
  return {id, data: () => data};
}

/**
 * @return {{response: Object, warns: string[], reportDocument: Object}}
 */
function buildVerifyReportResponseSampleHonor() {
  const {reportDocument} = buildReportsDocumentSampleHonor();
  const warns = [];
  const response = buildResponse(fakeDoc(SCAN_ID, reportDocument), warns);
  return {response, warns, reportDocument};
}

function main() {
  const {response, warns} = buildVerifyReportResponseSampleHonor();
  fs.writeFileSync(DEST_FILE, JSON.stringify(response, null, 2) + '\n', 'utf8');
  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`warns (missingKeys، القاعدة 22): ${warns.length === 0 ? '(لا شيء)' : JSON.stringify(warns)}`);
  console.log(`aiResponse.letter: ${JSON.stringify(response.aiResponse.letter)}`);
  console.log(`aiResponse.harnessError/harnessErrorReason: ${response.aiResponse.harnessError} / ${JSON.stringify(response.aiResponse.harnessErrorReason)}`);
  console.log(`aiResponse.narrativeIncomplete: ${response.aiResponse.narrativeIncomplete}`);
}

if (require.main === module) {
  main();
}

module.exports = {buildVerifyReportResponseSampleHonor, DEST_FILE, buildResponse, fakeDoc};
