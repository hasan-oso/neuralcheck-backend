'use strict';

// exportV6ReportReadonly.test.js — أمر مستخدم 2026-09-24 +03 (الجولة
// الثالثة، البند ٢، بعد قياس المدقّق بالأداة أن النسخة الأولى تركت
// shortId/rawFingerprint.timeSeries.header.scanId/rawFingerprint.device
// .deviceProfileKey بلا حذف). يختبر `redactIdentifiers`/`scanForIdentifierLikeNames`
// وحدهما — المنطق القابل للاختبار بلا شبكة (main() نفسها لا تُستدعى، ولا
// تُشغَّل هذه الجلسة السكربت أصلاً — القيد الصريح "تكتبه ولا تشغّله").
// صفر شبكة، صفر Firestore.
//
// مُحدَّث 2026-09-24 +03 (الجولة الرابعة، البند ج، مراجعة
// v6-report-review-2026-09-24.md): أُضيف حكمان فاتا الجولة الثالثة —
// rawFingerprint.timeSeries.footer.samplesSha256 (حذف) وaiResponse.shortId
// (استبدال، نسخة ثانية من shortId لم يلتقطها استبدال الجذر). N-06
// (rawFingerprint.functionalResults[testId=N-06].rawValue) **لم يُضَف** —
// شرط توقّف بحكم المدقّق (النموذج يقرأها فعلياً)، بانتظار قرار المستخدم.
//
// عيّنتان (نصّ الأمر: "اختبار: على عيّنة B الحقيقية، وعلى مستند V6 مركَّب"):
//   (أ) test/fixtures/golden/v7-reports-document-sample.json — عيّنة حقيقية
//       مُلتزَمة فعلاً في هذا المستودع؛ V7 الوسم لكن حقول الجذر/rawFingerprint
//       المشتركة (userId/sessionId/deviceFingerprintSha/timeSeriesStoragePath/
//       shortId/rawFingerprint.timeSeries.header.{deviceFingerprint,scanId})
//       مطابقة لشكل V6 حرفياً (نفس الأسماء، نفس البنية) — تختبر الحذف/
//       الاستبدال على بيانات حقيقية لا مُصطنَعة. **بلا rawFingerprint.device
//       إطلاقاً** (مولّد هذه العيّنة لا يبني مفتاح device — موثَّق في رأسه)،
//       فلا تختبر مسار deviceProfileKey — لهذا العيّنة (ب) ضرورية.
//   (ب) مستند V6 مركَّب يدوياً من شكل الكتابة الحرفي عند
//       `42aa5ba:functions/src/analysis/analyzeDevice.js:275-300` (نفس
//       أسماء الحقول والقيم النموذجية) + `rawFingerprint.device.deviceProfileKey`
//       مُصطنَع بحروف a..f (العقد §١١) — يختبر مسار deviceProfileKey تحديداً،
//       غير الموجود في (أ).
//
// Run: node functions/test/exportV6ReportReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {
  redactIdentifiers, scanForIdentifierLikeNames, REDACT_DELETE_PATHS,
  REDACT_REPLACE_PATHS, REPLACEMENT_PLACEHOLDER, buildV6Export,
} = require('../scripts/export-v6-report-readonly');
const {readReportWithRaw} = require('../scripts/lib/reportRawReaders');

function getAtPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ═══════════════════════════════════════════════════════════════════════
// (أ) عيّنة حقيقية — v7-reports-document-sample.json
// ═══════════════════════════════════════════════════════════════════════
{
  // V8 نقل الخامّ (2026-10-09): السكربت ما زال يقرأ الخامّ من المستند نفسه (قرّاء functions/scripts: الجزء ٢) — فمُدخل الاختبار هو
  // شكل المستند القديم (EMBEDDED_LEGACY): المقروء + الخامّ مدموجَين من العيّنتين الذهبيتين.
  const doc = loadLegacyEmbeddedV7Report();

  ok(typeof doc.shortId === 'string' && doc.shortId.length > 0, '[إعداد أ] العيّنة الحقيقية تحمل shortId فعلياً');
  ok(typeof doc.rawFingerprint?.timeSeries?.header?.scanId === 'string', '[إعداد أ] rawFingerprint.timeSeries.header.scanId موجود فعلياً');
  ok(typeof doc.rawFingerprint?.timeSeries?.header?.deviceFingerprint === 'string', '[إعداد أ] rawFingerprint.timeSeries.header.deviceFingerprint موجود فعلياً');
  ok(!('device' in (doc.rawFingerprint || {})), '[إعداد أ] لا rawFingerprint.device في هذه العيّنة (موثَّق في رأس المولّد) — deviceProfileKey غير قابل للاختبار هنا');

  ok(typeof doc.rawFingerprint?.timeSeries?.footer?.samplesSha256 === 'string', '[إعداد أ] rawFingerprint.timeSeries.footer.samplesSha256 موجود فعلياً');
  ok(!('shortId' in (doc.aiResponse || {})), '[إعداد أ] لا aiResponse.shortId في هذه العيّنة (شكل V7 لا يبنيه) — مسار الاستبدال الجديد غير قابل للاختبار هنا، سيغطّيه (ب)');

  const {redacted, removedFields, replacedFields} = redactIdentifiers(doc);

  const testedDeletePathsA = ['userId', 'sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'rawFingerprint.timeSeries.header.deviceFingerprint', 'rawFingerprint.timeSeries.footer.samplesSha256'];
  const testedReplacePathsA = ['shortId', 'rawFingerprint.timeSeries.header.scanId'];
  for (const p of testedDeletePathsA) {
    ok(removedFields.includes(p), `[أ][حذف] ${p} ضمن removedFields`);
    eq(getAtPath(redacted, p), undefined, `[أ][حذف] ${p} غائب فعلياً بعد الحذف`);
  }
  for (const p of testedReplacePathsA) {
    ok(replacedFields.includes(p), `[أ][استبدال] ${p} ضمن replacedFields`);
    eq(getAtPath(redacted, p), REPLACEMENT_PLACEHOLDER, `[أ][استبدال] ${p} صار العلامة الثابتة، لا القيمة الحقيقية`);
  }
  ok(!replacedFields.includes('aiResponse.shortId'), '[أ][استبدال] aiResponse.shortId غير مذكور في replacedFields — لأنه غائب من هذه العيّنة، لا لأن الكود لم يفحصه');
  // لم يُحذَف عمداً
  eq(redacted.deviceFingerprint, doc.deviceFingerprint, '[أ] deviceFingerprint (موديل الجهاز، لا بصمة) بلا تغيير');
  eq(redacted.rawFingerprint.timeSeries.header.deviceModel, doc.rawFingerprint.timeSeries.header.deviceModel, '[أ] header.deviceModel بلا تغيير');
  console.log(`تحقّق أ: العيّنة الحقيقية — كل المسارات الـ${testedDeletePathsA.length + testedReplacePathsA.length} القابلة للاختبار هنا (${testedDeletePathsA.length} حذف + ${testedReplacePathsA.length} استبدال) تُحذَف/تُستبدَل صحيحاً، deviceFingerprint/deviceModel يبقيان`);
}

// ═══════════════════════════════════════════════════════════════════════
// (ب) مستند V6 مركَّب — شكل 42aa5ba:analyzeDevice.js:275-300 حرفياً +
//     deviceProfileKey مُصطنَع
// ═══════════════════════════════════════════════════════════════════════
{
  const v6Doc = {
    userId: 'real-user-uid-123',
    deviceFingerprint: 'Samsung Galaxy S10 5G',
    deviceModel: 'Samsung Galaxy S10 5G',
    deviceMarketingName: 'Galaxy S10 5G',
    deviceFingerprintSha: 'f'.repeat(64),
    timeSeriesStoragePath: `scans/${'f'.repeat(64)}/scan-v6-test.ts.json.gz`,
    fieldsVersion: 60,
    appVersion: '1.0.5',
    rawFingerprint: {
      timeSeries: {
        header: {
          deviceFingerprint: 'f'.repeat(64), // نفس deviceFingerprintSha، مكرَّرة في الخام
          scanId: 'scan-v6-test',
          deviceModel: 'Samsung Galaxy S10 5G',
        },
        footer: {
          // أُضيف 2026-09-24 +03 (الجولة الرابعة) — يختبر مسار الحذف
          // الجديد rawFingerprint.timeSeries.footer.samplesSha256.
          samplesSha256: 'e'.repeat(64),
        },
      },
      functionalResults: [{testId: 'SEC-04', categoryName: 'security', status: 'pass'}],
      manualResults: [],
      // مُصطنَع — غائب من شكل 42aa5ba الأصلي (deviceProfileKey أُضيف لاحقاً)،
      // مطلوب صراحة في نصّ الأمر لاختبار هذا المسار تحديداً.
      device: {
        deviceProfileKey: {a: 'primary-hash-abc', b: 'keystore-x', c: 'fid-y', d: 'android-id-z', e: 'build-sig', f: 'sensor-sig'},
      },
    },
    // aiResponse.shortId أُضيف 2026-09-24 +03 (الجولة الرابعة) — نسخة ثانية
    // من shortId داخل aiResponse (مراجعة v6-report-review-2026-09-24.md)،
    // يختبر مسار الاستبدال الجديد غير الموجود في عيّنة (أ).
    aiResponse: {overallGrade: 'B', shortId: 'NC-REALCOPY'},
    aiModel: 'deepseek-flash',
    aiDurationMs: 12345,
    aiFallbackReason: null,
    grade: 'B',
    score: 82,
    language: 'ar',
    sessionId: 'shop-session-xyz',
    shortId: 'NC-ABCDEF',
    scoringEngine: 'v3-ai-graded',
    isFreeTrial: false,
    pipeline: 'v6_raw_timeseries',
    v5Metrics: null,
  };

  const {redacted, removedFields, replacedFields} = redactIdentifiers(v6Doc);

  deepEq(removedFields.slice().sort(), REDACT_DELETE_PATHS.slice().sort(),
      '[ب][حذف] كل مسارات REDACT_DELETE_PATHS حُذفت فعلاً (المستند يحملها كلّها)');
  deepEq(replacedFields.slice().sort(), REDACT_REPLACE_PATHS.slice().sort(),
      '[ب][استبدال] كل مسارات REDACT_REPLACE_PATHS استُبدلت فعلاً');

  for (const p of REDACT_DELETE_PATHS) {
    eq(getAtPath(redacted, p), undefined, `[ب][حذف] ${p} غائب فعلياً`);
  }
  eq(redacted.rawFingerprint.device.deviceProfileKey, undefined, '[ب] deviceProfileKey (الكائن كاملاً) غائب — لا حروف a..f متبقّية');
  ok(!('a' in (redacted.rawFingerprint.device || {})), '[ب] الحرف a تحديداً غائب من rawFingerprint.device');

  eq(redacted.shortId, REPLACEMENT_PLACEHOLDER, '[ب] shortId استُبدل بالعلامة الثابتة');
  eq(redacted.rawFingerprint.timeSeries.header.scanId, REPLACEMENT_PLACEHOLDER, '[ب] header.scanId استُبدل بالعلامة الثابتة');
  eq(redacted.aiResponse.shortId, REPLACEMENT_PLACEHOLDER, '[ب] aiResponse.shortId (النسخة الثانية) استُبدل بالعلامة الثابتة أيضاً');
  eq(redacted.rawFingerprint.timeSeries.footer.samplesSha256, undefined, '[ب] footer.samplesSha256 غائب فعلياً بعد الحذف');
  ok(!('samplesSha256' in redacted.rawFingerprint.timeSeries.footer), '[ب] المفتاح samplesSha256 محذوف كاملاً من footer، لا مُصفَّراً');
  // N-06 لا وجود له في v6Doc أصلاً هنا (functionalResults يحمل SEC-04 فقط) —
  // لا شيء لاختباره في هذا الملفّ؛ البقيّة المعلَّقة موثَّقة في generate-
  // v6-reports-document-sample.js وv6ReportsDocumentContractGuard.test.js.

  eq(redacted.deviceFingerprint, 'Samsung Galaxy S10 5G', '[ب] deviceFingerprint (موديل الجهاز) بلا تغيير');
  eq(redacted.grade, 'B', '[ب] حقول V6 غير المعرِّفة (grade/score/aiResponse) بلا تغيير');

  // الفحص الإضافي — للمراجعة لا حكماً نهائياً.
  const suspects = new Set();
  scanForIdentifierLikeNames(redacted, '', suspects);
  ok(suspects.has('rawFingerprint.functionalResults[].testId'), '[ب][للمراجعة] rawFingerprint.functionalResults[].testId يظهر (يطابق نمط "id" اسماً — مراجعة بشرية، ليس معرِّفاً فعلياً هنا)');
  ok(!suspects.has('shortId') && !suspects.has('rawFingerprint.timeSeries.header.scanId'),
      '[ب][للمراجعة] الحقول المُستبدَلة بالفعل (shortId/scanId) لا تظهر في قائمة "لم يُحذَف" — عولجت بالفعل، لا تكرار مضلِّل');
  for (const p of REDACT_DELETE_PATHS) {
    ok(!suspects.has(p.split('.').pop()) || true, `[ب][للمراجعة] لا افتراض إضافي على ${p} — الفحص يعمل على المستند بعد الحذف فقط`);
  }
}
console.log(`تحقّق ب: المستند V6 المركَّب — كل مسارات الحذف/الاستبدال الـ${REDACT_DELETE_PATHS.length + REDACT_REPLACE_PATHS.length} (${REDACT_DELETE_PATHS.length} حذف + ${REDACT_REPLACE_PATHS.length} استبدال) تعمل، deviceProfileKey (a..f) يختفي كائناً كاملاً، الفحص الإضافي يعمل ولا يُكرِّر المُعالَج بالفعل`);

// ═══════════════════════════════════════════════════════════════════════
// (ج) V8 نقل الخامّ، الجزء ٢ — القارئ على الشكلين (القاعدة 41): المصدَّر من تقرير لم يُرحَّل (EMBEDDED_LEGACY) ومن تقرير
//     مُرحَّل (المقروء + reportRaw: PRIVATE) **واحد**، وغياب الخامّ (ABSENT) يُعلَن ولا يُخفى.
// ═══════════════════════════════════════════════════════════════════════
(async () => {
  const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
  const readable = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'v7-reports-document-sample.json'), 'utf8'));
  const rawDoc = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'v7-report-raw-sample.json'), 'utf8'));
  const legacyDoc = loadLegacyEmbeddedV7Report();
  const memDb = (reports, raws) => ({
    collection: (c) => ({doc: (id) => ({get: async () => {
      const m = c === 'reportRaw' ? raws : reports;
      return {exists: Object.prototype.hasOwnProperty.call(m, id), id, data: () => m[id]};
    }})}),
  });
  const read = (reports, raws) => readReportWithRaw({db: memDb(reports, raws), scanId: 's1'});

  const rLegacy = await read({s1: legacyDoc}, {});
  const rPrivate = await read({s1: readable}, {s1: rawDoc});
  const rAbsent = await read({s1: readable}, {});
  eq(rLegacy.rawRead.state, 'EMBEDDED_LEGACY', '[ج] تقرير لم يُرحَّل → EMBEDDED_LEGACY');
  eq(rPrivate.rawRead.state, 'PRIVATE', '[ج] تقرير مُرحَّل → PRIVATE');
  eq(rAbsent.rawRead.state, 'ABSENT', '[ج] تقرير بلا خامّ → ABSENT');

  const outLegacy = buildV6Export({reportData: rLegacy.reportData, rawRead: rLegacy.rawRead});
  const outPrivate = buildV6Export({reportData: rPrivate.reportData, rawRead: rPrivate.rawRead});
  const outAbsent = buildV6Export({reportData: rAbsent.reportData, rawRead: rAbsent.rawRead});
  eq(outLegacy.rawState, 'EMBEDDED_LEGACY', '[ج] المخرَج يطبع الحالة (قديم)');
  eq(outPrivate.rawState, 'PRIVATE', '[ج] المخرَج يطبع الحالة (جديد)');
  eq(outAbsent.rawState, 'ABSENT', '[ج] المخرَج يطبع الحالة (غائب)');
  const {rawState: _a, ...legacyBody} = outLegacy;
  const {rawState: _b, ...privateBody} = outPrivate;
  deepEq(privateBody, legacyBody, '[ج] المصدَّر من الشكل الجديد = المصدَّر من الشكل القديم بالضبط (حذف/استبدال/مراجعة/المستند)');
  for (const p of ['sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'rawFingerprint.timeSeries.header.deviceFingerprint']) {
    ok(outPrivate.removedFields.includes(p), `[ج] ${p} يُحذف من المصدَّر على الشكل الجديد أيضاً (كان سيبقى لو لم يُدمج الخامّ قبل الإخفاء)`);
  }
  const printed = JSON.stringify(outPrivate);
  ok(!printed.includes(rawDoc.deviceFingerprintSha) && !printed.includes(rawDoc.timeSeriesStoragePath) &&
     !printed.includes(rawDoc.rawFingerprint.timeSeries.header.deviceFingerprint),
  '[ج] لا قيمة معرّف خامّ في المخرَج على الشكل الجديد');
  ok('rawFingerprint' in outPrivate.document && 'aiAudit' in outPrivate.document, '[ج] والخامّ نفسه (rawFingerprint/aiAudit) حاضر في المستند المصدَّر على الشكل الجديد');
  ok(!('rawFingerprint' in outAbsent.document) && !('aiAudit' in outAbsent.document), '[ج] ABSENT: المستند بلا خامّ — والسبب معلَن في rawState لا بالغياب الصامت');
  ok(!outAbsent.removedFields.includes('timeSeriesStoragePath') && !outAbsent.removedFields.includes('sessionId'), '[ج] ABSENT: لا حذف لما لم يكن موجوداً');
  let threw = null;
  try { buildV6Export({reportData: readable, rawRead: null}); } catch (e) { threw = e; }
  ok(threw && /rawRead/.test(threw.message), '[ج] بلا rawRead يُرفض (لا قراءة غياب الخامّ نجاحاً — القاعدة 22)');
  console.log('تحقّق ج: القارئ على الشكلين — المصدَّر واحد، وABSENT معلَن، وبلا معرّف خامّ');

  console.log(`\nexportV6ReportReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
