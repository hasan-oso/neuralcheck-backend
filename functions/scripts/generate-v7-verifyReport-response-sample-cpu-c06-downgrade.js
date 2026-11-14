#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-verifyReport-response-sample-cpu-c06-downgrade — يبني
// استجابة verifyReport.js الحقيقية لنفس حالة تخفيض cpu المقبولة بحرف
// يتغيّر فعلياً (B→C) — من مستند reports/{scanId} الحقيقي (شقيقه،
// generate-v7-reports-document-sample-cpu-c06-downgrade.js) — **صفر
// Firestore، صفر تعديل على verifyReport.js نفسه**.
// ===================================================================
//
// الغرض (القرار ٩٨ البند ٢، نصّ المستخدم حرفياً): "تدخل العيّنتان تحت
// الحارس، وتُطابَقان في المستودعات... والشكلان B وC." هذا هو الشكل C —
// أوّل عيّنة ذهبية في هذا المستودع تُظهر letterSource="LLM_ADJUSTED" مع
// letter يتغيّر ظاهرياً فعلاً (B→C) عبر استجابة verifyReport العامّة.
//
// نفس تقنية generate-v7-verifyReport-response-sample.js/-security-downgrade.js
// حرفياً (لا نسخة موازية، القاعدة 24): buildResponse/fakeDoc مُستوردتان من
// الملفّ الأصلي.
//
// Run: node functions/scripts/generate-v7-verifyReport-response-sample-cpu-c06-downgrade.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildReportsDocumentSampleCpuC06Downgrade, SCAN_ID} = require('./generate-v7-reports-document-sample-cpu-c06-downgrade');
const {buildResponse, fakeDoc} = require('./generate-v7-verifyReport-response-sample');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-verifyReport-response-sample-cpu-c06-downgrade.json');

/**
 * يبني استجابة verifyReport الكاملة لعيّنة تخفيض cpu المقبولة بحرف
 * متغيّر فعلياً — في الذاكرة فقط، بلا كتابة.
 * @return {Promise<{response: Object, warns: string[], reportDocument: Object}>}
 */
async function buildVerifyReportResponseSampleCpuC06Downgrade() {
  const {reportDocument} = await buildReportsDocumentSampleCpuC06Downgrade();
  const warns = [];
  const response = buildResponse(fakeDoc(SCAN_ID, reportDocument), warns);
  return {response, warns, reportDocument};
}

async function main() {
  const {response, warns} = await buildVerifyReportResponseSampleCpuC06Downgrade();

  fs.writeFileSync(DEST_FILE, JSON.stringify(response, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`warns (missingKeys المُسجَّلة، القاعدة 22): ${warns.length === 0 ? '(لا شيء)' : JSON.stringify(warns)}`);
  console.log('');
  console.log('=== aiResponse.categories.cpu ===');
  console.log(JSON.stringify(response.aiResponse.categories.cpu, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
}

module.exports = {buildVerifyReportResponseSampleCpuC06Downgrade, DEST_FILE};
