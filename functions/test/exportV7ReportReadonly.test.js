'use strict';

// exportV7ReportReadonly.test.js — أمر مستخدم 2026-09-30 +03 «سكربت
// تصدير تقرير V7 للقراءة وحدها». يختبر الدوالّ الخالصة المُصدَّرة من
// scripts/export-v7-report-readonly.js (compareTestIds/extractLetterInfo/
// extractModelResponse/resolveScanIdFromShortId/buildExportOutput) على
// Firestore مزيَّف بالكامل في الذاكرة — صفر شبكة، صفر Admin SDK حقيقي.
// main() نفسها لا تُستدعى (تستدعي process.exit) ولا تُشغَّل هذه الجلسة
// السكربت أصلاً (القيد الصريح: "تكتبه ولا تشغّله").
//
// المُدخل: test/fixtures/golden/v7-reports-document-sample.json (عيّنة V7
// ذهبية حقيقية مُلتزَمة) + مستند aiRawResponses مصنوع بشكل ما يكتبه
// writeRawAiResponses.js بالضبط (نفس أسماء الحقول: scanId/attempts[]/
// writtenAt — راجع src/analysis/writeRawAiResponses.js:75).
//
// Run: node functions/test/exportV7ReportReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {
  EXPECTED_TEST_IDS, compareTestIds, extractLetterInfo, formatWrittenAt,
  extractModelResponse, resolveScanIdFromShortId, buildExportOutput, exportReportByShortId,
  REPORTS_COLLECTION,
} = require('../scripts/export-v7-report-readonly');
const {readReportRaw} = require('../src/analysis/reportRawStore');
const {wrapReadOnly} = require('../scripts/audit-device-profiles-readonly');
const {RAW_RESPONSES_COLLECTION} = require('../src/analysis/writeRawAiResponses');

// V8 نقل الخامّ (2026-10-09، الجزء ٢): السكربت يقرأ الخامّ بـreadReportRaw على الشكلين. المُدخل الأساس هنا شكل المستند القديم
// (EMBEDDED_LEGACY: المقروء + الخامّ مدموجَين من العيّنتين الذهبيتين)؛ والبند ٩ يمرّ بالشكل الجديد (PRIVATE) والغائب (ABSENT).
const goldenReport = loadLegacyEmbeddedV7Report();
const goldenReadable = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden', 'v7-reports-document-sample.json'), 'utf8'));
const goldenRawDoc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden', 'v7-report-raw-sample.json'), 'utf8'));
const memRawDb = (reports, raws) => ({
  collection: (c) => ({doc: (id) => ({get: async () => {
    const m = c === 'reportRaw' ? raws : reports;
    return {exists: Object.prototype.hasOwnProperty.call(m, id), id, data: () => m[id]};
  }})}),
});
const rawReadOf = (reportData, rawDoc) => readReportRaw({db: memRawDb({s: reportData}, rawDoc ? {s: rawDoc} : {}), scanId: 's', reportData});

function getAtPath(obj, dottedPath) {
  return dottedPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ═══════════════════════════════════════════════════════════════════════
// ١ — EXPECTED_TEST_IDS: 82 بالضبط، ومطابقة لاشتقاق مباشر من نفس الفِخّ
//     (لا نسخة يدوية غير متحقَّق منها — القاعدة 24/40).
// ═══════════════════════════════════════════════════════════════════════
{
  eq(EXPECTED_TEST_IDS.length, 82, '[١] EXPECTED_TEST_IDS.length=82');
  const frMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden', 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
  const rederivedIds = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'].map((r) => r.testId).filter((id) => !['G-03', 'G-04', 'G-05'].includes(id));
  deepEq(EXPECTED_TEST_IDS.slice().sort(), rederivedIds.slice().sort(),
      '[١] EXPECTED_TEST_IDS يطابق حرفياً (85 من functionalResults-by-scanid.json ناقص G-03/G-04/G-05) — لا نسخة يدوية منجرفة');
  console.log('تحقّق ١: EXPECTED_TEST_IDS=82، يطابق الاشتقاق المباشر من الفِخّ حرفياً');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — compareTestIds على العيّنة الذهبية الحقيقية — قيم مقيسة لا مفترَضة.
// ═══════════════════════════════════════════════════════════════════════
{
  const cmp = compareTestIds(goldenReport);
  eq(cmp.state, 'COMPARED', '[٢] state=COMPARED');
  eq(cmp.expectedCount, 82, '[٢] expectedCount=82');
  eq(cmp.actualCount, 85, '[٢] actualCount=85 (مقيس من rawFingerprint.functionalResults.length الحقيقي)');
  deepEq(cmp.missing, [], '[٢] missing=[] — كل الـ82 المتوقَّعة حاضرة فعلياً في هذا الفِخّ');
  deepEq(cmp.extra.slice().sort(), ['G-03', 'G-04', 'G-05'], '[٢] extra=[G-03,G-04,G-05] — الثلاثة الزائدة بعينها');
  console.log('تحقّق ٢: compareTestIds على العيّنة الحقيقية — 85 فعلي، 0 ناقص، 3 زائد (G-03/G-04/G-05)، مقيس بتشغيل مباشر');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — compareTestIds حين rawFingerprint.functionalResults غائب — حالة
//     صريحة PATH_ABSENT، لا صفراً ولا استثناءً.
// ═══════════════════════════════════════════════════════════════════════
{
  const cmp = compareTestIds({rawFingerprint: {}});
  eq(cmp.state, 'PATH_ABSENT', '[٣] state=PATH_ABSENT حين rawFingerprint.functionalResults غائب');
  eq(cmp.path, 'rawFingerprint.functionalResults', '[٣] path مُسمّى بدقّة');
  console.log('تحقّق ٣: compareTestIds — PATH_ABSENT صريحة حين يغيب rawFingerprint.functionalResults');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — extractLetterInfo على العيّنة الذهبية — يُثبت تصحيح نصّ الأمر
//     (overall.letterCeilingReason غائب فعلياً؛ governingGateReason هو
//     الحقل الحقيقي المقابل)، وletterCeilingReason الحقيقي لكل فئة (قد
//     يكون null حاضراً — يُميَّز من الغياب).
// ═══════════════════════════════════════════════════════════════════════
{
  const info = extractLetterInfo(goldenReport);
  deepEq(info.overallLetter, {present: true, value: 'C'}, '[٤] overall.letter=C');
  deepEq(info.overallLetterSource, {present: true, value: 'GATE:ROOT_DETECTED'}, '[٤] overall.letterSource=GATE:ROOT_DETECTED');
  eq(info.overallLetterCeilingReason_expectedAbsent.present, false,
      '[٤][تصحيح نصّ الأمر] overall.letterCeilingReason غائب فعلياً من الشكل الحقيقي (buildDisplayShapeV7.js:456 لا يبنيه) — لا استنتاج صامت');
  // S1 (أمر مستخدم 2026-10-01 +03) — `text` حقل رابع جديد (name/source يبقيان).
  // S-1 (القسم ٥، نفس التاريخ) — بلا "في هذا الإصدار" في النصّ نفسه.
  deepEq(info.overallGoverningGateReason, {present: true, value: {name: 'ROOT_DETECTED', ceilingLetter: 'C', source: 'SEC-04=fail',
    text: 'أعلى حرف C: صلاحيات الجذر (الروت) مكتشَفة على الجهاز.'}},
      '[٤][S1] overall.governingGateReason هو الحقل الحقيقي المقابل — حاضر بقيمته الكاملة');
  deepEq(info.securityLetter, {present: true, value: 'D'}, '[٤] categories.security.letter=D');
  deepEq(info.securityLetterCeilingReason, {present: true, value: null},
      '[٤][مهمّ] categories.security.letterCeilingReason حاضر بقيمة null — present:true لا present:false (تمييز الحضور بقيمة null عن الغياب)');
  ok(CATEGORIES_PRESENT(info), '[٤] perCategoryLetterCeilingReason يحمل كل الفئات الخمس عشرة');
  eq(Array.isArray(info.gatesFired), true, '[٤] gatesFired مصفوفة (aiAudit.gatesApplied حاضر فعلياً)');
  eq(info.gatesFired.length, 10, '[٤] gatesFired.length=10 (مقيس من aiAudit.gatesApplied.filter(status===FIRED) الحقيقي)');
  ok(info.gatesFired.every((g) => g.status === 'FIRED'), '[٤] كل عنصر في gatesFired حالته FIRED فعلياً — لا تسريب لغير المُطلَقة');
  // القيمة تغيّرت (أمر مستخدم 2026-10-01 +03 «C-07 وS-06» البند ١):
  // issueSetHash يُشتقّ من display.issues[] فعلياً — ISS-S-06 لم تعد تُنتَج
  // (S-06 healthBearing=false)، فبصمة المجموعة تغيّرت. مُتحقَّق بتشغيل
  // مباشر بعد إعادة توليد v7-reports-document-sample.json (القاعدة 39).
  deepEq(info.reportAudit.issueSetHash, {present: true, value: '36ede850c5246b7986ea91f373c61655420037c5c61a721ed610601f51c5876a'},
      '[٤] reportAudit.issueSetHash — بصمة مختلفة تماماً عن "بصمة الحمولة"، بمسارها الحقيقي aiAudit.issueSetHash');
  console.log('تحقّق ٤: extractLetterInfo — letterSource/letterCeilingReason (عامّ+فئة)/gatesFired/حرف الأمان/الحرف العامّ، مع تصحيح غياب overall.letterCeilingReason');
}
function CATEGORIES_PRESENT(info) {
  const keys = Object.keys(info.perCategoryLetterCeilingReason);
  return keys.length === 15 && keys.every((k) => info.perCategoryLetterCeilingReason[k].present === true || info.perCategoryLetterCeilingReason[k].present === false);
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — formatWrittenAt: Firestore Timestamp حقيقي (toDate)، وأشكال أخرى،
//     وغياب.
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeTimestamp = {toDate: () => new Date('2026-09-30T01:23:45.000Z')};
  deepEq(formatWrittenAt(fakeTimestamp), {state: 'FIRESTORE_TIMESTAMP', value: '2026-09-30T01:23:45.000Z'},
      '[٥] Firestore Timestamp (toDate) يُهيَّأ إلى ISO string');
  deepEq(formatWrittenAt(null), {state: 'ABSENT', value: null}, '[٥] null صريح — ABSENT');
  deepEq(formatWrittenAt('2026-09-30T00:00:00.000Z'), {state: 'STRING_AS_STORED', value: '2026-09-30T00:00:00.000Z'},
      '[٥] نصّ كما هو (اختبار بمُدخل غير Firestore) — STRING_AS_STORED');
  console.log('تحقّق ٥: formatWrittenAt — Timestamp حقيقي/نصّ/غياب، كلّها حالات صريحة');
}

// ═══════════════════════════════════════════════════════════════════════
// ٦ — extractModelResponse: مستند aiRawResponses حاضر (شكل writeRawAiResponses.js
//     الحقيقي)، وغائب (DOCUMENT_ABSENT)، وبصمة الحمولة NOT_STORED دائماً.
// ═══════════════════════════════════════════════════════════════════════
{
  const rawDoc = {
    scanId: 'internal-scan-id-must-not-leak', // يُتحقَّق أدناه أنه لا يصل المخرَج
    attempts: [
      {attempt: 1, raw: 'نصّ تحليل تجريبي', provider: 'deepseek', durationMs: 1234},
      {attempt: 2, raw: 'نصّ آخر api_key: sk-shouldberedacted1234', provider: 'deepseek', durationMs: 987},
    ],
    writtenAt: {toDate: () => new Date('2026-09-30T02:00:00.000Z')},
  };
  const result = extractModelResponse(rawDoc);
  eq(result.state, 'DOCUMENT_PRESENT', '[٦] state=DOCUMENT_PRESENT');
  eq(result.attempts.length, 2, '[٦] محاولتان كما في المستند');
  eq(result.attempts[0].payloadFingerprint, 'NOT_STORED', '[٦] payloadFingerprint=NOT_STORED صراحة — لا حقل بصمة مخزَّن فعلياً (writeRawAiResponses.js:68-73)');
  eq(result.attempts[1].payloadFingerprint, 'NOT_STORED', '[٦] نفس الشيء للمحاولة الثانية');
  ok(!result.attempts[1].raw.includes('sk-shouldberedacted1234'), '[٦][القاعدة 36] مفتاح API داخل raw يُنقَّى (تنقية دفاع في العمق ثانية)');
  ok(result.attempts[1].raw.includes('[KEY-REDACTED]'), '[٦] العلامة الثابتة لتنقية المفاتيح حاضرة بدلاً من القيمة');
  eq(result.writtenAt.state, 'FIRESTORE_TIMESTAMP', '[٦] writtenAt مُهيَّأ من Timestamp حقيقي');
  ok(JSON.stringify(result).indexOf('internal-scan-id-must-not-leak') === -1,
      '[٦][الأهمّ] الحقل scanId المُكرَّر داخل مستند aiRawResponses لا يصل المخرَج إطلاقاً — لم يُنسَخ');

  const absent = extractModelResponse(null);
  eq(absent.state, 'DOCUMENT_ABSENT', '[٦] مستند aiRawResponses غائب → DOCUMENT_ABSENT صراحة');
  eq(absent.collection, RAW_RESPONSES_COLLECTION, '[٦] اسم المجموعة الحقيقي مذكور (aiRawResponses)');
  console.log('تحقّق ٦: extractModelResponse — الشكل الحقيقي، بصمة الحمولة NOT_STORED دائماً، تنقية مفاتيح، غياب المستند، scanId الداخلي لا يُنسَخ');
}

// ═══════════════════════════════════════════════════════════════════════
// ٧ — Firestore مزيَّف بالكامل: حالات shortId الثلاث (مطابقة واحدة/صفر/
//     أكثر من واحدة) عبر wrapReadOnly، صفر كتابة تمرّ.
// ═══════════════════════════════════════════════════════════════════════
function makeFakeDb(reportsByShortId) {
  let writeCalls = 0;
  const db = {
    collection: (name) => {
      if (name === REPORTS_COLLECTION) {
        return {
          where: (field, op, value) => ({
            get: async () => {
              assert.strictEqual(field, 'shortId');
              assert.strictEqual(op, '==');
              const matches = (reportsByShortId[value] || []);
              return {size: matches.length, docs: matches.map((docData, i) => ({
                id: docData.__scanId || `scan-${i}`,
                data: () => docData,
              }))};
            },
          }),
          doc: () => ({set: async () => { writeCalls++; }, update: async () => { writeCalls++; }, delete: async () => { writeCalls++; }}),
          add: async () => { writeCalls++; },
        };
      }
      if (name === 'reportRaw') {
        return {
          doc: (id) => ({
            get: async () => {
              const data = db.__reportRaw[id];
              return data ? {exists: true, id, data: () => data} : {exists: false, id, data: () => undefined};
            },
            set: async () => { writeCalls++; },
            update: async () => { writeCalls++; },
            delete: async () => { writeCalls++; },
          }),
        };
      }
      if (name === RAW_RESPONSES_COLLECTION) {
        return {
          doc: (id) => ({
            get: async () => {
              const data = db.__rawResponses[id];
              return data ? {exists: true, id, data: () => data} : {exists: false, id};
            },
            set: async () => { writeCalls++; },
            update: async () => { writeCalls++; },
            delete: async () => { writeCalls++; },
          }),
        };
      }
      throw new Error(`TRAP: unexpected collection in fake db: ${name}`);
    },
    __rawResponses: {},
    __reportRaw: {},
    batch: () => ({}),
    runTransaction: async () => {},
  };
  Object.defineProperty(db, '_writeCalls', {get: () => writeCalls});
  return db;
}

(async () => {
  // ٧-أ — مطابقة واحدة بالضبط → RESOLVED.
  {
    const scanId = 'real-internal-scan-id-abc123';
    const reportDoc = Object.assign({}, goldenReport, {__scanId: scanId});
    const fakeDb = makeFakeDb({'NC-TESTONE': [reportDoc]});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveScanIdFromShortId(ro, 'NC-TESTONE');
    eq(resolved.state, 'RESOLVED', '[٧-أ] state=RESOLVED لمطابقة واحدة');
    eq(resolved.scanId, scanId, '[٧-أ] scanId المُستخرَج يطابق معرّف المستند فعلياً');
    eq(resolved.matchCount, 1, '[٧-أ] matchCount=1');
    eq(fakeDb._writeCalls, 0, '[٧-أ] صفر استدعاء كتابة');
  }

  // ٧-ب — صفر مطابقة → SHORTID_NOT_FOUND، لا اختيار افتراضي.
  {
    const fakeDb = makeFakeDb({});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveScanIdFromShortId(ro, 'NC-NOMATCH1');
    eq(resolved.state, 'SHORTID_NOT_FOUND', '[٧-ب] state=SHORTID_NOT_FOUND');
    eq(resolved.scanId, null, '[٧-ب] scanId=null — لا شيء يُختار');
    eq(resolved.matchCount, 0, '[٧-ب] matchCount=0');
  }

  // ٧-ج — أكثر من مطابقة → SHORTID_AMBIGUOUS، لا اختيار أوّل مستند.
  {
    const doc1 = Object.assign({}, goldenReport, {__scanId: 'scan-dup-1'});
    const doc2 = Object.assign({}, goldenReport, {__scanId: 'scan-dup-2'});
    const fakeDb = makeFakeDb({'NC-DUPLICATE': [doc1, doc2]});
    const ro = wrapReadOnly(fakeDb);
    const resolved = await resolveScanIdFromShortId(ro, 'NC-DUPLICATE');
    eq(resolved.state, 'SHORTID_AMBIGUOUS', '[٧-ج][الأهمّ] state=SHORTID_AMBIGUOUS — لا يختار أوّل مستند بصمت');
    eq(resolved.scanId, null, '[٧-ج] scanId=null');
    eq(resolved.matchCount, 2, '[٧-ج] matchCount=2 (مقيس من حجم النتيجة الفعلي)');
  }

  // ٧-د — حارس الكتابة يرفض كل عمليات الكتابة على db المزيَّف نفسه.
  {
    const fakeDb = makeFakeDb({'NC-WX': [Object.assign({}, goldenReport, {__scanId: 's1'})]});
    const ro = wrapReadOnly(fakeDb);
    let threw = null;
    try {
      await ro.collection(REPORTS_COLLECTION).doc('x').set({evil: true});
    } catch (e) { threw = e; }
    ok(threw && /TRAP: write operation/.test(threw.message), '[٧-د] doc.set على reports يرمي TRAP');
    eq(fakeDb._writeCalls, 0, '[٧-د] صفر كتابة فعلية وصلت db المزيَّف');
  }
  console.log('تحقّق ٧: shortId → مطابقة واحدة/صفر/أكثر من واحدة (حالات صريحة، لا اختيار افتراضي)، وwrapReadOnly يرفض الكتابة على db المزيَّف');

  // ═══════════════════════════════════════════════════════════════════
  // ٨ — buildExportOutput الكامل: الإخفاء (لا uid/بريد/scanId خامّ)،
  //     shortId يبقى كما أُدخل، testIdComparison/letterInfo/modelResponse
  //     كلّها في مخرَج واحد.
  // ═══════════════════════════════════════════════════════════════════
  {
    const rawDoc = {
      scanId: goldenReport.rawFingerprint.timeSeries.header.scanId, // نفس الرقم الداخلي — يجب ألّا يظهر
      attempts: [{attempt: 1, raw: 'ملخّص تحليل V7 تجريبي', provider: 'deepseek', durationMs: 500}],
      writtenAt: {toDate: () => new Date('2026-09-30T03:00:00.000Z')},
    };
    const output = buildExportOutput('NC-USERINPUT', goldenReport, rawDoc, await rawReadOf(goldenReport, null));

    eq(output.projectId, 'neuralchek-9b6d7', '[٨] projectId أوّل حقل، مثبَّت');
    eq(output.shortId, 'NC-USERINPUT', '[٨][الأهمّ] shortId يبقى كما أُدخل حرفياً — لا علامة استبدال');
    eq(output.shortIdRetainedAsProvided, true, '[٨] shortIdRetainedAsProvided=true موثَّق صراحة');

    const outStr = JSON.stringify(output);
    ok(!outStr.includes(goldenReport.rawFingerprint.timeSeries.header.scanId), '[٨][الأهمّ] الـscanId الخام لا يظهر في أي مكان بالمخرَج كاملاً');
    ok(!('userId' in output.document), '[٨] لا uid (userId) في المستند المُصدَّر');
    ok(!('sessionId' in output.document), '[٨] لا sessionId');
    ok(!('deviceFingerprintSha' in output.document), '[٨] لا deviceFingerprintSha');
    ok(output.document.rawFingerprint.timeSeries.header.scanId !== goldenReport.rawFingerprint.timeSeries.header.scanId,
        '[٨] header.scanId (خامّ) استُبدل بعلامة ثابتة — ليس القيمة الحقيقية');
    ok(!('serverSamplesStoragePath' in output.document), '[٨][اكتُشف بالاختبار] serverSamplesStoragePath محذوف — كان يحمل الـscanId الخام حرفياً (serverSamples/<scanId>.json.gz)');
    ok(output.redaction.removedFields.includes('serverSamplesStoragePath'), '[٨] serverSamplesStoragePath مذكور في removedFields');
    // لا بريد في هذا المستودع أصلاً (تحقّق سلبي عام — لا حقل بريد في الشكل، القاعدة 22 — لا افتراض وجوده)
    ok(!outStr.toLowerCase().includes('@'), '[٨] لا حرف "@" في كامل المخرَج (لا بريد إلكتروني مهما كان مصدره)');

    eq(output.testIdComparison.state, 'COMPARED', '[٨] testIdComparison.state=COMPARED');
    eq(output.testIdComparison.actualCount, 85, '[٨] testIdComparison.actualCount=85');
    deepEq(output.testIdComparison.extra.slice().sort(), ['G-03', 'G-04', 'G-05'], '[٨] extra=[G-03,G-04,G-05]');

    eq(output.letterInfo.overallLetter.value, 'C', '[٨] letterInfo.overallLetter.value=C');
    eq(output.letterInfo.securityLetter.value, 'D', '[٨] letterInfo.securityLetter.value=D');

    eq(output.modelResponse.state, 'DOCUMENT_PRESENT', '[٨] modelResponse.state=DOCUMENT_PRESENT');
    eq(output.modelResponse.attempts[0].payloadFingerprint, 'NOT_STORED', '[٨] بصمة الحمولة NOT_STORED في المخرَج الكامل أيضاً');
    ok(!outStr.includes(rawDoc.scanId), '[٨] scanId المُكرَّر داخل aiRawResponses لا يصل المخرَج الكامل أيضاً');

    console.log('تحقّق ٨: buildExportOutput — projectId أوّل حقل، shortId يبقى كما أُدخل، صفر uid/scanId خامّ/بريد، مقارنة الـ82 وletterInfo وmodelResponse كلّها في مخرَج واحد');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٩ — V8 نقل الخامّ، الجزء ٢ (القاعدة 41): القارئ على الشكلين عبر المسار الذي تمرّ به main (حلّ shortId ← readReportWithRaw ←
  //     buildExportOutput) على db مزيَّف: المخرَج من تقرير مُرحَّل = المخرَج من تقرير لم يُرحَّل، وABSENT معلَن.
  // ═══════════════════════════════════════════════════════════════════
  {
    const sid = 'NC-SHAPES1';
    const mkDb = (reportDoc, rawDoc) => {
      const db = makeFakeDb({[sid]: [{...reportDoc, __scanId: 'scan-shapes-1'}]});
      if (rawDoc) db.__reportRaw['scan-shapes-1'] = rawDoc;
      return wrapReadOnly(db);
    };
    // makeFakeDb يعيد data() بما فيه __scanId — يُنزَع قبل المقارنة
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === '__scanId' ? undefined : v)));

    const legacyRun = await exportReportByShortId({db: mkDb(goldenReport, null), shortIdUpper: sid});
    const privateRun = await exportReportByShortId({db: mkDb(goldenReadable, goldenRawDoc), shortIdUpper: sid});
    const absentRun = await exportReportByShortId({db: mkDb(goldenReadable, null), shortIdUpper: sid});
    eq(legacyRun.output.rawState, 'EMBEDDED_LEGACY', '[٩] تقرير لم يُرحَّل → rawState=EMBEDDED_LEGACY');
    eq(privateRun.output.rawState, 'PRIVATE', '[٩] تقرير مُرحَّل → rawState=PRIVATE');
    eq(absentRun.output.rawState, 'ABSENT', '[٩] تقرير بلا خامّ → rawState=ABSENT');

    const a = strip(legacyRun.output); const b = strip(privateRun.output);
    delete a.rawState; delete b.rawState;
    deepEq(b, a, '[٩][الأهمّ] المخرَج الكامل (الإخفاء + مقارنة الـ82 + letterInfo + بصمات aiAudit + المستند) من الشكل الجديد = من الشكل القديم بالضبط');
    eq(privateRun.output.testIdComparison.state, 'COMPARED', '[٩] testIdComparison يعمل على الشكل الجديد (كان PATH_ABSENT لو قُرئ المستند المقروء وحده)');
    eq(privateRun.output.testIdComparison.actualCount, 85, '[٩] 85 اختباراً من rawFingerprint.functionalResults في reportRaw');
    eq(privateRun.output.letterInfo.reportAudit.issueSetHash.present, true, '[٩] بصمات aiAudit (من reportRaw) حاضرة في letterInfo');
    ok(privateRun.output.letterInfo.gatesFired.length === 10, '[٩] gatesFired (من reportRaw.aiAudit.gatesApplied) = 10');
    const privStr = JSON.stringify(privateRun.output);
    ok(!privStr.includes(goldenRawDoc.deviceFingerprintSha) && !privStr.includes(goldenRawDoc.timeSeriesStoragePath),
        '[٩] لا معرّف خامّ في المخرَج على الشكل الجديد (الإخفاء يسري على الخامّ المدموج)');
    eq(absentRun.output.testIdComparison.state, 'RAW_ABSENT', '[٩] ABSENT: testIdComparison=RAW_ABSENT (لا PATH_ABSENT المضلِّلة)');
    eq(absentRun.output.letterInfo.reportAudit.issueSetHash.present, false, '[٩] ABSENT: بصمات aiAudit غائبة صراحةً');
    eq(legacyRun.resolved.state, 'RESOLVED', '[٩] حلّ shortId كما كان');
    const missing = await exportReportByShortId({db: mkDb(goldenReadable, null), shortIdUpper: 'NC-NOPE'});
    eq(missing.output, null, '[٩] shortId غير موجود: لا مخرَج، والسبب في resolved.state');
    eq(missing.resolved.state, 'SHORTID_NOT_FOUND', '[٩] SHORTID_NOT_FOUND كما كان');
    let threw = null;
    try { buildExportOutput(sid, goldenReport, null); } catch (e) { threw = e; }
    ok(threw && /rawRead/.test(threw.message), '[٩] بلا rawRead يُرفض (لا قراءة غياب الخامّ نجاحاً — القاعدة 22)');
    console.log('تحقّق ٩: القارئ على الشكلين — المخرَج واحد، وABSENT معلَن، وبلا معرّف خامّ');
  }

  console.log(`\nexportV7ReportReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
