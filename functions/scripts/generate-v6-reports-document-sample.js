#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v6-reports-document-sample — يبني عيّنة ذهبية من مستند
// reports/{scanId} V6 حقيقي (لا مُصطنَع)، من مخرَج
// export-v6-report-readonly.js بعد مراجعة حقلاً حقلاً — القرار ٨٢ البند ١
// + الملحق ٨٠-أ (2026-09-24 +03).
// ===================================================================
//
// المُدخل: ملفّ JSON من export-v6-report-readonly.js
// ({scanId, removedFields, replacedFields, forReview_notRedacted, document})
// — **مساره يُمرَّر وسيطاً دائماً، لا افتراضياً مُضمَّناً هنا**. الملفّ
// الخام يبقى في مجلّد القيادة (workspace)، ولا يدخل هذا المستودع أبداً
// (قيد صريح في نصّ المهمّة) — فهذا السكربت لا يملك ولا يفترض مساراً
// افتراضياً يشير إلى خارج المستودع.
//
// ─── أحكام المراجعة المُطبَّقة هنا (v6-report-review-2026-09-24.md، توقيع
// SHA256SUMS مُتحقَّق قبل هذه الكتابة) ────────────────────────────────────
//   removedFields/replacedFields من export-v6-report-readonly.js نفسه
//   (userId، sessionId، deviceFingerprintSha، timeSeriesStoragePath،
//   rawFingerprint.timeSeries.header.deviceFingerprint،
//   rawFingerprint.device.deviceProfileKey → محذوفة already؛ shortId
//   (الجذر) وrawFingerprint.timeSeries.header.scanId → "[REDACTED]" already)
//   — هذا السكربت **لا يعيد فحصها**، بل يتحقّق أنها غائبة/بالقيمة
//   المتوقَّعة فعلاً (دفاع في العمق) ثم يمرّرها كما هي.
//
//   فوق ذلك، حُكمان إضافيان من فحص القيم (ب) في المراجعة — لم يلتقطهما
//   export-v6-report-readonly.js:
//     aiResponse.shortId  — نسخة ثانية من shortId لم يلتقطها استبدال
//                            الجذر. **يُستبدل** بقيمة من الشكل نفسه (ثمانية
//                            أحرف بعد "NC-" — الشكل الحقيقي المُلاحَظ في
//                            هذا الفحص تحديداً، NC-B844090B، يختلف عن ستّة
//                            أحرف generateShortId() الحالية — فخّ V6 قديم
//                            بشكل مختلف، لا نسخة مستقلّة من تلك الدالّة).
//     …footer.samplesSha256 — بصمة عيّنات هذا الفحص وحده (مقبض فريد كالـ
//                            scanId، والعرض لا يقرؤها في أي مسار — تحقّق:
//                            grep "samplesSha256" على functions/src صفر
//                            نتيجة). **يُحذف** الحقل كاملاً، لا يُستبدل.
//
//   ⛔ **N-06 (اسم المشغّل، Operatör) — لم يُحسم بعد، مُتروك كما هو حرفياً.**
//   حكم المدقّق (نُقل في أمر المهمّة، 2026-09-24 +03): النموذج يقرأها
//   فعلياً (buildV7Payload.js:141، ورأى reasoning_content حقيقي يذكرها)
//   وتدخل فهرس إعفاء حارس device_spec (reportShapeV7.js) — شرط التوقّف في
//   نصّ المستخدم وقع. **لا استبدال هنا حتى قرار المستخدم.** كل ما عداه من
//   السبعة عشر حقلاً في forReview_notRedacted حُكم عليه "يبقى" — يمرّ دون
//   لمس.
//
// Run: node functions/scripts/generate-v6-reports-document-sample.js <مسار-ملف-التصدير-الخام>
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const DEST_FILE = path.join(GOLDEN_DIR, 'v6-reports-document-sample.json');

const EXPECTED_REMOVED_FIELDS = [
  'userId',
  'sessionId',
  'deviceFingerprintSha',
  'timeSeriesStoragePath',
  'rawFingerprint.timeSeries.header.deviceFingerprint',
  'rawFingerprint.device.deviceProfileKey',
];

const REAL_N06_RAWVALUE_KNOWN_AT_REVIEW_TIME = 'Turkcell';

/**
 * يولّد بديلاً من الشكل نفسه لـshortId الثانوي (aiResponse.shortId) —
 * ثمانية أحرف سداسية عشرية كبيرة بعد "NC-"، مطابقة لطول القيمة الحقيقية
 * المُلاحَظة في هذا الفحص (NC-B844090B) لا لِـgenerateShortId() الحالية
 * (ستّة أحرف من أبجدية مختلفة) — فخّ V6 قديم، لا نسخة من دالّة أخرى.
 * @return {string}
 */
function fakeSecondaryShortId() {
  const hex = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 خانة
  return `NC-${hex}`;
}

/**
 * يبني مستند reports/{scanId} V6 الذهبي من مخرَج export-v6-report-readonly.js
 * بعد تطبيق حُكمَي المراجعة الإضافيَّين (shortId الثانوي، samplesSha256).
 * لا كتابة، لا Firestore، لا نداء نموذج — قراءة ملفّ واحدة فقط.
 * @param {string} inputPath مسار ملفّ JSON من export-v6-report-readonly.js
 * @return {{reportDocument: Object}}
 */
function buildReportsDocumentSampleV6(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('generate-v6-reports-document-sample: يحتاج مسار ملفّ التصدير الخام وسيطاً — لا افتراض، راجع رأس الملفّ');
  }
  const absPath = path.resolve(inputPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`generate-v6-reports-document-sample: الملفّ غير موجود: ${absPath}`);
  }
  const exportOutput = JSON.parse(fs.readFileSync(absPath, 'utf8'));

  if (!exportOutput || typeof exportOutput !== 'object' || !exportOutput.document) {
    throw new Error('generate-v6-reports-document-sample: الملفّ لا يحمل حقل "document" — ليس مخرَج export-v6-report-readonly.js المتوقَّع');
  }

  const actualRemoved = Array.isArray(exportOutput.removedFields) ? exportOutput.removedFields : [];
  const missingFromRemoved = EXPECTED_REMOVED_FIELDS.filter((f) => !actualRemoved.includes(f));
  if (missingFromRemoved.length > 0) {
    throw new Error(`generate-v6-reports-document-sample: removedFields لا يحمل الحقول المتوقَّعة: ${JSON.stringify(missingFromRemoved)} — توقّف، لا افتراض`);
  }

  // نسخة عميقة — لا تعديل على exportOutput.document نفسه.
  const reportDocument = JSON.parse(JSON.stringify(exportOutput.document));

  // ─── دفاع في العمق: الحقول المحذوفة فعلاً غائبة من document نفسه. ───────
  if ('userId' in reportDocument || 'sessionId' in reportDocument ||
      'deviceFingerprintSha' in reportDocument || 'timeSeriesStoragePath' in reportDocument) {
    throw new Error('generate-v6-reports-document-sample: حقل من removedFields ما زال حاضراً في document — توقّف');
  }
  const tsHeader = reportDocument.rawFingerprint && reportDocument.rawFingerprint.timeSeries && reportDocument.rawFingerprint.timeSeries.header;
  if (tsHeader && 'deviceFingerprint' in tsHeader) {
    throw new Error('generate-v6-reports-document-sample: rawFingerprint.timeSeries.header.deviceFingerprint ما زال حاضراً — توقّف');
  }
  if (reportDocument.rawFingerprint && reportDocument.rawFingerprint.device && 'deviceProfileKey' in reportDocument.rawFingerprint.device) {
    throw new Error('generate-v6-reports-document-sample: rawFingerprint.device.deviceProfileKey ما زال حاضراً — توقّف');
  }

  // ─── الحكم الأوّل: aiResponse.shortId (نسخة ثانية) ⇐ يُستبدل. ──────────
  if (!reportDocument.aiResponse || typeof reportDocument.aiResponse.shortId !== 'string') {
    throw new Error('generate-v6-reports-document-sample: aiResponse.shortId غائب أو ليس نصّاً — الحالة تغيّرت عن وقت المراجعة، توقّف');
  }
  if (reportDocument.aiResponse.shortId === '[REDACTED]') {
    throw new Error('generate-v6-reports-document-sample: aiResponse.shortId يحمل "[REDACTED]" بالفعل — كان يُفترَض أنه القيمة الحقيقية وقت المراجعة، الحالة تغيّرت، توقّف بدل الافتراض');
  }
  reportDocument.aiResponse.shortId = fakeSecondaryShortId();

  // ─── الحكم الثاني: …footer.samplesSha256 ⇐ يُحذف كاملاً. ──────────────
  const tsFooter = reportDocument.rawFingerprint && reportDocument.rawFingerprint.timeSeries && reportDocument.rawFingerprint.timeSeries.footer;
  if (!tsFooter || typeof tsFooter.samplesSha256 !== 'string') {
    throw new Error('generate-v6-reports-document-sample: rawFingerprint.timeSeries.footer.samplesSha256 غائب أو ليس نصّاً — الحالة تغيّرت عن وقت المراجعة، توقّف');
  }
  delete tsFooter.samplesSha256;

  // ─── N-06 — لم يُحسم، يبقى حرفياً. تحقّق فقط أنه لم يتغيّر عن حالة وقت
  // المراجعة، دفاعاً — لا استبدال. ────────────────────────────────────────
  const functionalResults = (reportDocument.rawFingerprint && reportDocument.rawFingerprint.functionalResults) || [];
  const n06 = functionalResults.find((r) => r && r.testId === 'N-06');
  if (n06 && n06.rawValue !== REAL_N06_RAWVALUE_KNOWN_AT_REVIEW_TIME) {
    console.warn(
        `⚠️ generate-v6-reports-document-sample: N-06.rawValue تغيّر عن حالة وقت المراجعة ` +
        `("${REAL_N06_RAWVALUE_KNOWN_AT_REVIEW_TIME}" → "${n06.rawValue}") — لا يزال غير مُستبدَل ` +
        `بانتظار قرار المستخدم، لكن هذا يستحقّ التنبّه.`);
  }

  return {reportDocument};
}

function main() {
  const inputPath = process.argv[2];
  const {reportDocument} = buildReportsDocumentSampleV6(inputPath);

  fs.writeFileSync(DEST_FILE, JSON.stringify(reportDocument, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`pipeline: ${reportDocument.pipeline}`);
  console.log(`shortId (الجذر، مُستبدَل مسبقاً بالأداة المصدر): ${JSON.stringify(reportDocument.shortId)}`);
  console.log(`aiResponse.shortId (مُستبدَل هنا): ${reportDocument.aiResponse.shortId}`);
  console.log(`rawFingerprint.timeSeries.header.scanId (مُستبدَل مسبقاً): ${JSON.stringify(reportDocument.rawFingerprint.timeSeries.header.scanId)}`);
  console.log(`rawFingerprint.timeSeries.footer.samplesSha256 حاضر؟ ${'samplesSha256' in (reportDocument.rawFingerprint.timeSeries.footer || {})}`);
  const n06 = (reportDocument.rawFingerprint.functionalResults || []).find((r) => r.testId === 'N-06');
  console.log(`⛔ N-06.rawValue (بقيّة معلَّقة بقرار — لم تُستبدَل): ${JSON.stringify(n06 && n06.rawValue)}`);
}

if (require.main === module) {
  main();
}

module.exports = {buildReportsDocumentSampleV6, DEST_FILE, fakeSecondaryShortId};
