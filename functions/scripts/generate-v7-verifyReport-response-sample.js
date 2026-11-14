#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-verifyReport-response-sample — يبني عيّنة واحدة من كائن
// الاستجابة الفعلي الذي يُعيده `verifyReport.js` (`?scanId=`) على تقرير
// V7 — من مستند `reports/{scanId}` الحقيقي (عيّنة البند أ،
// `v7-reports-document-sample.json`) — **صفر Firestore، صفر تعديل على
// verifyReport.js نفسه**.
// ===================================================================
//
// الغرض (أمر مستخدم 2026-09-24 +03، القرار ٧٥، البند ٢-ب): صفحات `wepsite`
// التي تتحقّق من تقرير عبر رمز QR تقرأ استجابة `verifyReport` — شكل ثالث
// مختلف عن شكل مستند `reports` (البند أ) وعن شكل إرجاع `analyzeDevice`
// (`v7-client-payload-sample.json`). قاس المنسّق: C = pipeline=V6·الحرف=null
// — القائمة البيضاء في verifyReport.js لا عيّنة ذهبية عليها بعد.
//
// ⚠️ **لا تعديل على verifyReport.js** (قيد صريح في نصّ المهمّة). `buildV7Response`
// دالّة محلّية داخل `onRequest` — رأس ذلك الملفّ نفسه يوثّق تفضيل عدم
// استخراجها (new Function لا تُغلِق على نطاق الوحدة، فتحتاج تمرير الثابتين
// V7_PIPELINE_TAG/V6_PIPELINE_TAG وسيطين صريحين). هذا السكربت يستعمل **نفس
// الأسلوب حرفياً** الذي يستعمله `test/verifyReportV7Whitelist.test.js`
// (وبنفس التقنية `test/verifyReportAuditExclusion.test.js`): يقرأ مصدر
// `verifyReport.js` **وقت التوليد نفسه** (لا نسخة مُجمَّدة من المنطق) بين
// نفس العلامتين (`startMarker`/`endMarker`)، ويبنيه بـ`new Function`، ثم
// يُشغِّله على مستند حقيقي عبر `fakeDoc(scanId, data)` — **الفرق الوحيد عن
// الاختبار**: هذا السكربت يكتب النتيجة إلى ملفّ (`main()`، خلف حارس
// `require.main`)؛ الدالّة القابلة للاستيراد (`buildVerifyReportResponseSample`)
// لا تكتب شيئاً، بنفس نمط `buildClientPayloadSample`/`buildReportsDocumentSample`.
//
// ─── المُدخل ────────────────────────────────────────────────────────────
//   buildReportsDocumentSample() (generate-v7-reports-document-sample.js،
//   البند أ من هذه المهمّة نفسها) → `reportDocument` → `fakeDoc(SCAN_ID,
//   reportDocument)` → `buildResponse(...)`.
//
//   ⚠️ `reportDocument.createdAt` يحمل `SERVER_TIMESTAMP_MARKER` (علامة
//   مُجمَّدة، لا Firestore Timestamp حقيقي — راجع رأس generate-v7-reports-
//   document-sample.js). `verifyReport.js:311` يمرّرها كما هي إلى
//   `response.date` (`date: rep.createdAt`، تمريرة مباشرة بلا تحويل) — فـ
//   `response.date` في هذه العيّنة يحمل نفس العلامة حرفياً، لا تاريخاً
//   حقيقياً مُخترَعاً. موثَّق هنا لا مُخفى.
//
// Run: node functions/scripts/generate-v7-verifyReport-response-sample.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildReportsDocumentSample} = require('./generate-v7-reports-document-sample');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
// القرار ٨٢ البند ٢ (2026-09-24 +03) — يطابق SCAN_ID المُحدَّث في
// generate-v7-reports-document-sample.js (كانت '34dff2b8-ce9e-4b40-86a9-1976c878e195'،
// نفس مصدر fakeDoc(SCAN_ID, ...) أدناه → response.scanId).
const SCAN_ID = 'bcab2f02-a4a3-45e0-831e-190bb2c1a0a4';
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-verifyReport-response-sample.json');
const VERIFY_REPORT_SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');

// ─── نفس تقنية test/verifyReportV7Whitelist.test.js حرفياً (buildResponse) ──
function buildResponse(reportDoc, warnSink) {
  const src = fs.readFileSync(VERIFY_REPORT_SRC, 'utf8');
  const startMarker = 'const report = reportDoc.data();';
  const endMarker = 'res.json(response);';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (!(startIdx > -1 && endIdx > -1 && endIdx > startIdx)) {
    throw new Error('generate-v7-verifyReport-response-sample: العلامتان غير موجودتين في verifyReport.js بالترتيب المتوقَّع — توقّف، الاستخراج غير آمن');
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
 * يبني استجابة verifyReport الكاملة لعيّنة V7 — في الذاكرة فقط، بلا كتابة.
 * @return {{response: Object, warns: string[], reportDocument: Object}}
 */
function buildVerifyReportResponseSample() {
  const {reportDocument} = buildReportsDocumentSample();
  const warns = [];
  const response = buildResponse(fakeDoc(SCAN_ID, reportDocument), warns);
  return {response, warns, reportDocument};
}

function main() {
  const {response, warns} = buildVerifyReportResponseSample();

  fs.writeFileSync(DEST_FILE, JSON.stringify(response, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`warns (missingKeys المُسجَّلة، القاعدة 22): ${warns.length === 0 ? '(لا شيء)' : JSON.stringify(warns)}`);
  console.log('');
  console.log('=== جدول الحقول أعلى مستوى (envelope) ===');
  for (const k of Object.keys(response)) {
    const v = response[k];
    const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
    const example = (t === 'object' && v !== null) ? '{…}' : JSON.stringify(v);
    console.log(`${k}\t${t}\t${example}`);
  }
  console.log('');
  console.log('=== response.aiResponse — كل حقل أعلى مستوى ===');
  for (const k of Object.keys(response.aiResponse)) {
    const v = response.aiResponse[k];
    const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
    const example = (t === 'object' && v !== null) ? '{…}' : JSON.stringify(v);
    console.log(`aiResponse.${k}\t${t}\t${example}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {buildVerifyReportResponseSample, DEST_FILE, buildResponse, fakeDoc, SCAN_ID};
