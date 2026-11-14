#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v6-verifyReport-response-sample — يبني عيّنة استجابة
// verifyReport (`?scanId=`) لفرع V6، من مستند reports/{scanId} V6 الذهبي
// نفسه (v6-reports-document-sample.json، البند ب-١ من نفس المهمّة) —
// **بالمسار الحقيقي في verifyReport.js**، لا بعيّنة مبنيّة يدوياً. القرار
// ٨٢ البند ١ (2026-09-24 +03).
// ===================================================================
//
// السبب (نصّ المهمّة حرفياً): "كل صفحة تُختبر بالشكل الذي تستقبله هي، لا
// بعيّنة العقد" — verifyReport.js يفرّع بين buildV7Response/buildV6Response
// حسب report.pipeline (V6_PIPELINE_TAG = 'v6_raw_timeseries'، مطابق فعلاً
// لـpipeline في v6-reports-document-sample.json)، فهذا السكربت يُشغِّل
// المسار V6 الحقيقي بدل افتراض شكله.
//
// **نفس تقنية generate-v7-verifyReport-response-sample.js حرفياً**: يقرأ
// مصدر verifyReport.js وقت التوليد نفسه بين نفس العلامتين
// ('const report = reportDoc.data();' / 'res.json(response);')، ويبنيه
// بـnew Function، ثم يُشغِّله على fakeDoc(scanId, v6-reports-document-sample.json)
// — **صفر Firestore، صفر تعديل على verifyReport.js**. المدخل هنا هو
// **المستند المُلتزَم بالفعل** (بعد بند أ)، لا الملفّ الخام خارج المستودع —
// فهذا السكربت لا يحتاج مساراً خارجياً على الإطلاق، بخلاف
// generate-v6-reports-document-sample.js.
//
// Run: node functions/scripts/generate-v6-verifyReport-response-sample.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const SOURCE_DOCUMENT_FILE = path.join(GOLDEN_DIR, 'v6-reports-document-sample.json');
const DEST_FILE = path.join(GOLDEN_DIR, 'v6-verifyReport-response-sample.json');
const VERIFY_REPORT_SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');

// مستند وهمي — نفس scanId مُصطنَع بشكل UUID (الجذر الحقيقي مُستبدَل أصلاً
// بـ"[REDACTED]" داخل v6-reports-document-sample.json نفسها؛ رقم الوثيقة
// reportDoc.id هنا مستقلّ تماماً عن أي قيمة فحص حقيقية — لا مصدر آخر له).
const FAKE_DOC_ID = 'f1a4c9e2-2b6d-4a11-8f7a-9c0e5d3b7a41';

// ─── نفس تقنية generate-v7-verifyReport-response-sample.js حرفياً ───────
function buildResponse(reportDoc, warnSink) {
  const src = fs.readFileSync(VERIFY_REPORT_SRC, 'utf8');
  const startMarker = 'const report = reportDoc.data();';
  const endMarker = 'res.json(response);';
  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (!(startIdx > -1 && endIdx > -1 && endIdx > startIdx)) {
    throw new Error('generate-v6-verifyReport-response-sample: العلامتان غير موجودتين في verifyReport.js بالترتيب المتوقَّع — توقّف، الاستخراج غير آمن');
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
 * يبني استجابة verifyReport الكاملة لعيّنة V6 — في الذاكرة فقط، بلا كتابة.
 * @return {{response: Object, warns: string[], reportDocument: Object}}
 */
function buildVerifyReportResponseSampleV6() {
  const reportDocument = JSON.parse(fs.readFileSync(SOURCE_DOCUMENT_FILE, 'utf8'));
  if (reportDocument.pipeline !== V6_PIPELINE_TAG) {
    throw new Error(`generate-v6-verifyReport-response-sample: reportDocument.pipeline="${reportDocument.pipeline}" ≠ "${V6_PIPELINE_TAG}" — توقّف، لا افتراض`);
  }
  const warns = [];
  const response = buildResponse(fakeDoc(FAKE_DOC_ID, reportDocument), warns);
  if (typeof response.grade === 'undefined' || 'letter' in response) {
    // دفاع في العمق: تأكيد أنّ الفرع الذي رَكض فعلاً هو buildV6Response
    // (يبني grade/score) لا buildV7Response (يبني letter) — لو انقلب
    // الفرع لسبب ما (تغيّر في verifyReport.js لم يُرصَد) نتوقّف بدل كتابة
    // عيّنة V6 مغلوطة الشكل.
    throw new Error('generate-v6-verifyReport-response-sample: شكل الاستجابة لا يطابق buildV6Response المتوقَّع — توقّف');
  }
  return {response, warns, reportDocument};
}

function main() {
  const {response, warns} = buildVerifyReportResponseSampleV6();

  fs.writeFileSync(DEST_FILE, JSON.stringify(response, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`warns: ${warns.length === 0 ? '(لا شيء)' : JSON.stringify(warns)}`);
  console.log('');
  console.log('=== جدول الحقول أعلى مستوى ===');
  for (const k of Object.keys(response)) {
    const v = response[k];
    const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
    const example = (t === 'object' && v !== null) ? '{…}' : JSON.stringify(v);
    console.log(`${k}\t${t}\t${example}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {buildVerifyReportResponseSampleV6, DEST_FILE, buildResponse, fakeDoc, SOURCE_DOCUMENT_FILE};
