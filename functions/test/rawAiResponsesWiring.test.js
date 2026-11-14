'use strict';

// rawAiResponsesWiring.test.js — أمر مستخدم 2026-09-23 +03، القرار ٤: إثبات
// تكاملي أن الكتابة تقع في runAnalysisInternal.js (طبقة الكتابة)، وأن ما
// يعود إلى analyzeDevice.js (aiResult/aiResultAudit — ما سيُكتب لاحقاً تحت
// aiResponse/aiAudit في مستند reports) يبقى خالياً من الخام تماماً — عزل
// تكاملي، لا افتراض.
//
// تحديث 2026-09-23 +03 (أمر التبديل، القاعدة 23): كانت الكتابة محروسة
// بـv7ResolveReportEnabled (نداء ظلّي تجريبي) — الراية حُذفت، والكتابة
// صارت غير مشروطة (resolveV7Report هي المسار الوحيد الحيّ). السيناريو ٢
// القديم ("الراية غائبة ← صفر كتابة") لم يعد له معنى (V6 لا يُستدعى إطلاقاً
// الآن) — استُبدل بسيناريو "rawResponseLog فارغة ← صفر كتابة" (الضمانة
// الحقيقية المتبقّية: الكتابة تتبع البيانات لا راية).
//
// كاتب Firestore محقون (لا محاكي) يسجّل كل استدعاء set() بمجموعته.
//
// Run: node functions/test/rawAiResponsesWiring.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── كاتب Firestore محقون — يسجّل كل استدعاء بمجموعته ───────────────────
let writeLog = []; // [{collection, docId}]
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}},
    db: {
      collection: (name) => ({
        doc: (docId) => ({
          set: async (data) => { writeLog.push({collection: name, docId, data}); },
          get: async () => { throw new Error(`TRAP: unexpected get() on ${name}/${docId}`); },
        }),
      }),
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب resolveV7Report — قابل للتبديل بين محتوى بخام وبلا خام ────────
const CANARY = 'INTEGRATION_CANARY_7f2a';
let cannedRawResponseLog = [];
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => ({
      display: {overall: {letter: 'C'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
      audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
      aiModel: 'deepseek-flash', duration: 100, pipeline: 'v7_findings_based', bodyBuildMs: 1,
      guardFinal: {ok: true},
      // الحقل الوحيد الذي يحمل الخام — خارج audit/display تماماً (نفس
      // التصميم الحقيقي في resolveV7Report.js).
      rawResponseLog: cannedRawResponseLog,
    }),
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {RAW_RESPONSES_COLLECTION} = require('../src/analysis/writeRawAiResponses');

const minimalFingerprint = {device: {}, timeSeries: {}, functionalResults: {}, manualResults: []};

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — resolveV7Report هي المسار الوحيد الحيّ (بلا أي راية) ← الكتابة
  // تقع في aiRawResponses/{scanId} وحدها؛ aiResult/aiResultAudit خاليان
  // من الخام.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = [];
  cannedRawResponseLog = [{attempt: 1, rawResponseText: `رد خام حقيقي يحمل ${CANARY}`, rawResponseProvider: 'deepseek', durationMs: 50}];
  const out1 = await runAnalysisInternal({
    fingerprint: minimalFingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
    scanContext: {scanId: 'integration-scan-1'},
  });

  const rawWrites = writeLog.filter((w) => w.collection === RAW_RESPONSES_COLLECTION);
  eq(rawWrites.length, 1, '[١] كتابة واحدة على aiRawResponses');
  eq(rawWrites[0].docId, 'integration-scan-1', '[١] معرِّف المستند = scanId');
  ok(JSON.stringify(rawWrites[0].data).includes(CANARY), '[١] الخام (بعلامته) وصل aiRawResponses فعلاً — الكتابة تعمل لا صامتة النجاح');

  const otherWrites = writeLog.filter((w) => w.collection !== RAW_RESPONSES_COLLECTION);
  eq(otherWrites.length, 0, '[١] صفر كتابة على أي مجموعة أخرى — runAnalysisInternal لا يكتب reports أصلاً (تلك مهمّة analyzeDevice.js)');

  const returnedSerialized = JSON.stringify({aiResult: out1.aiResult, aiResultAudit: out1.aiResultAudit});
  ok(!returnedSerialized.includes(CANARY),
      '[١] aiResult/aiResultAudit (ما سيُكتب لاحقاً تحت aiResponse/aiAudit في مستند reports) خاليان من العلامة تماماً — عزل تكاملي مؤكَّد');
  console.log('تحقّق ١: resolveV7Report المسار الوحيد ← الخام يصل aiRawResponses وحدها، aiResult/aiResultAudit نظيفان تماماً');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — rawResponseLog فارغة (لا محاولات مُسجَّلة) ← صفر كتابة على
  // aiRawResponses (writeRawAiResponses.js: NO_DATA). الضمانة تتبع
  // البيانات لا راية بعد الآن.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = [];
  cannedRawResponseLog = [];
  await runAnalysisInternal({
    fingerprint: minimalFingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
    scanContext: {scanId: 'integration-scan-2'},
  });
  eq(writeLog.length, 0, '[٢] صفر كتابة إطلاقاً — rawResponseLog فارغة، writeRawAiResponses تُسقِط الكتابة (NO_DATA)');
  console.log('تحقّق ٢: rawResponseLog فارغة ← صفر كتابة على aiRawResponses (الضمانة تتبع البيانات، لا راية)');

  console.log(`\nrawAiResponsesWiring.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
