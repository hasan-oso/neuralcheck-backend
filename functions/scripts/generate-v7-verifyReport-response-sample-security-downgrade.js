#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-verifyReport-response-sample-security-downgrade — يبني
// استجابة verifyReport.js الحقيقية لنفس حالة تخفيض security المقبولة
// (LLM_ADJUSTED) — من مستند reports/{scanId} الحقيقي (شقيقه، generate-
// v7-reports-document-sample-security-downgrade.js) — **صفر Firestore،
// صفر تعديل على verifyReport.js نفسه**.
// ===================================================================
//
// الغرض (القرار ٩٥ البند ٣، نصّ المستخدم حرفياً): "والشكلان المطلوبان:
// مستند reports (B)، وردّ verifyReport (C)." هذا هو الشكل (C) — أوّل عيّنة
// ذهبية في هذا المستودع تُظهر aiResponse.categories.security بـ
// letterSource="LLM_ADJUSTED" فعلياً عبر استجابة verifyReport العامّة
// (نقطة الدخول التي تقرأها صفحات التحقّق عبر QR في wepsite).
//
// نفس تقنية generate-v7-verifyReport-response-sample.js حرفياً (لا نسخة
// موازية، القاعدة 24): buildResponse/fakeDoc مُستوردتان من ذلك الملفّ —
// يقرآن مصدر verifyReport.js **وقت التوليد نفسه** (لا نسخة مُجمَّدة من
// المنطق) بين نفس العلامتين، يبنيانه بـnew Function، ثم يُشغَّل على مستند
// حقيقي عبر fakeDoc(scanId, data).
//
// ─── المُدخل ────────────────────────────────────────────────────────────
//   buildReportsDocumentSampleSecurityDowngrade() (شقيقه، البند B من نفس
//   هذه المهمّة) → reportDocument → fakeDoc(SCAN_ID, reportDocument) →
//   buildResponse(...).
//
// Run: node functions/scripts/generate-v7-verifyReport-response-sample-security-downgrade.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {buildReportsDocumentSampleSecurityDowngrade, SCAN_ID} = require('./generate-v7-reports-document-sample-security-downgrade');
const {buildResponse, fakeDoc} = require('./generate-v7-verifyReport-response-sample');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-verifyReport-response-sample-security-downgrade.json');

/**
 * يبني استجابة verifyReport الكاملة لعيّنة تخفيض security المقبولة — في
 * الذاكرة فقط، بلا كتابة.
 * @return {Promise<{response: Object, warns: string[], reportDocument: Object}>}
 */
async function buildVerifyReportResponseSampleSecurityDowngrade() {
  const {reportDocument} = await buildReportsDocumentSampleSecurityDowngrade();
  const warns = [];
  const response = buildResponse(fakeDoc(SCAN_ID, reportDocument), warns);
  return {response, warns, reportDocument};
}

async function main() {
  const {response, warns} = await buildVerifyReportResponseSampleSecurityDowngrade();

  fs.writeFileSync(DEST_FILE, JSON.stringify(response, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`warns (missingKeys المُسجَّلة، القاعدة 22): ${warns.length === 0 ? '(لا شيء)' : JSON.stringify(warns)}`);
  console.log('');
  console.log('=== aiResponse.categories.security ===');
  console.log(JSON.stringify(response.aiResponse.categories.security, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
}

module.exports = {buildVerifyReportResponseSampleSecurityDowngrade, DEST_FILE};
