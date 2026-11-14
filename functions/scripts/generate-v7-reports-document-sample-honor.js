#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-reports-document-sample-honor — عيّنة ثانية من مستند
// reports/{scanId} V7، على فحص Honor (e4b65a2f) بدل 34dff2b8 — الحالة
// المقابلة: functionalResults **غائبة** (404 حقيقي، موثَّق في
// test/fixtures/golden/README.md) → HARNESS_ERROR/letter=null، لا
// MEASURED/letter=حرف حقيقي كما في العيّنة الأولى.
// ===================================================================
//
// أمر مستخدم 2026-09-24 +03 (القرار ٧٩ البند أ، رأس الجولة الثانية):
// "تُشغَّل الأداة على شكلَي تقرير Honor (e4b65a2f)، مستند reports وردّ
// verifyReport. وحرفه null، وحالته FUNCTIONAL_RESULTS_UNAVAILABLE."
//
// ─── السؤال الذي حُسم بالكود لا بالافتراض: هل يستدعي V7 النموذج لتقرير
// فيه harnessError؟ ────────────────────────────────────────────────────
// **نعم.** لا فحص لـ`categoryStates.overall.harnessError` قبل نداء النموذج
// في أي مكان بين runAnalysisInternal.js ↔ resolveV7Report.js ↔ callAI.js
// (تحقّق: grep "harnessError" على الثلاثة، صفر نتيجة خارج buildV7Payload.js/
// categoryStates.js أنفسهما؛ resolveV7Report.js:317 يستدعي `callAIv7(p)`
// غير مشروط في أوّل سطر من جسم الدالّة). فالمسار الحقيقي لِـHonor **كان
// سيستدعي النموذج فعلياً** — ولا ردّ نموذج مسجَّل له في هذا المستودع (لا
// v7-live-e4b65a2f-*.json، بخلاف b45c8cf6/34dff2b8). **صفر نداء نموذج هنا**
// (قيد صريح) — فهذا المولّد يبني ما تبنيه resolveV7Report.js نفسها حين
// **يغيب ردّ النموذج تماماً** (DeepSeek فشل، Gemini مُعطَّل — الفرع
// `providerFailedNoFallback:true` في callAI.js:538-546)، بإعادة تنفيذ ذلك
// الفرع يدوياً بنفس القيم التي يبنيها فعلياً (لا نداء، لا تخمين):
//   finalAttempt = {aiAnalysis: null, aiModel: null, duration: 0,
//                   pipeline: V7_PIPELINE_TAG, guard: {ok:false, ...}}
//     (نفس شكل callAI.js:538-546 حرفياً، duration=0 بدل Date.now()-startTime
//      الحقيقي — لا نداء فعلياً فلا وقت انتظار شبكة يُقاس؛ 0 قيمة حقيقية
//      لـ"لا محاولة"، لا رقم مُخترَع لتمويه غياب القياس).
//   rejectedPaths = {'narrative','crossChecks','adjustments','modelObservations'}
//     (PROVIDER_FAILED_REJECTED_PATHS، resolveV7Report.js:247)
// ثم نفس تسلسل resolveV7Report.js:412-443 حرفياً، مُستدعىً بدواله
// المُصدَّرة فعلاً (`_internal.sanitizeNarrativeForDisplay`/
// `_internal.expandDroppedDisplayFields`) — لا نسخة مستقلّة من منطقهما.
// **مُوسَّم بذلك في README** (test/fixtures/golden/README.md) كما طلب
// النصّ — هذه عيّنة "غاب فيها ردّ النموذج"، لا عيّنة نجاح كاملة.
//
// ─── بقيّة المُدخلات — نفس بصمة buildDisplayShapeV7.test.js §"Honor
// (e4b65a2f)" حرفياً (honorFp/honorFindings/honorCategoryStates) ────────
//
// Run: node functions/scripts/generate-v7-reports-document-sample-honor.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-reports-document-sample-honor: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
const {_internal: resolveV7Internal} = require('../src/analysis/resolveV7Report');
const {buildReportDocument, SERVER_TIMESTAMP_MARKER} = require('../src/analysis/analyzeDevice');
const {buildReportRawDocument} = require('../src/analysis/reportRawStore');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
// القرار ٨٦ البند ٢ — دالّة نقيّة، مصدر واحد لصيغة المسار (القاعدة 24).
const {computeServerSamplesStoragePath} = require('../src/analysis/serverRawSamplesStorage');
const {generateShortId} = require('../src/utils/generateShortId');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
// القرار ٨٢ البند ٢ (2026-09-24 +03): كانت SCAN_ID ثابتاً واحداً بقيمة
// حقيقية ('e4b65a2f-3a0c-4f11-939d-17eab7d0912f') يُستعمَل لغرضين مختلفين —
// (أ) مفتاح البحث في functionalResults-by-scanid.json (فخّ منفصل، خارج
// نطاق هذه الجولة، مفاتيحه تبقى حقيقية) و(ب) هوية المستند الناتج
// (timeSeriesStoragePath، وSCAN_ID المُصدَّرة التي يستهلكها
// generate-v7-verifyReport-response-sample-honor.js لبناء fakeDoc). بعد
// استبدال header.scanId في e4b65a2f-honor.ts.json بقيمة UUID من الشكل
// نفسه لا يصحّ أن يبقى ثابت واحد يخدم الغرضين — البحث يحتاج القيمة
// الحقيقية القديمة (الفخّ الآخر لم يُعَد تسميته)، والهوية الناتجة تحتاج
// القيمة الجديدة. فصلا إلى ثابتين:
const REAL_SCAN_ID_FOR_FUNCTIONAL_RESULTS_LOOKUP = 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f';
const SCAN_ID = '8fa88e6c-8a7b-43f4-9664-5c4a86c5fa29';
const TS_FILE = 'e4b65a2f-honor.ts.json';
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-reports-document-sample-honor.json');
const RAW_DEST_FILE = path.join(GOLDEN_DIR, 'v7-report-raw-sample-honor.json');

const USERID_PLACEHOLDER = Object.freeze({__marker: 'NOT_FROM_FIRESTORE_OR_AUTH_USERID'});

// أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤) — نفس التاريخ الثابت
// المُستعمَل في generate-v7-client-payload-sample.js (مصدر واحد بالقيمة،
// القاعدة 24) — analyzeDevice.js الحقيقي يكتب analyzedAt دائماً حتى على
// مسار harnessError (functionStartTime يُلتقَط قبل أي فرع). PATCH_AGE هنا
// غير ذي صلة أصلاً (Honor يأخذ فرع buildHarnessErrorCategoryStates المبكر،
// قبل computeGates) لكن حقل المستند analyzedAt يبقى حاضراً كما في الإنتاج.
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

/**
 * يبني مستند reports/{scanId} الكامل لعيّنة Honor (harnessError، غياب ردّ
 * نموذج) — في الذاكرة فقط، بلا كتابة، بلا نداء نموذج.
 * @return {{reportDocument: Object, audit: Object}}
 */
function buildReportsDocumentSampleHonor() {
  const raw = loadJson(TS_FILE);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  if (frMap[REAL_SCAN_ID_FOR_FUNCTIONAL_RESULTS_LOOKUP] !== null) {
    throw new Error(`generate-v7-reports-document-sample-honor: functionalResults-by-scanid.json[${REAL_SCAN_ID_FOR_FUNCTIONAL_RESULTS_LOOKUP}] ليست null كما هو موثَّق في README — توقّف`);
  }

  // نفس بصمة test/buildDisplayShapeV7.test.js §"Honor (e4b65a2f)" حرفياً.
  const honorFp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: null, manualResults: []};
  const findings = computeFindings(honorFp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: null, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    // موجودة للاتّساق فقط — functionalResults=null يأخذ فرع
    // buildHarnessErrorCategoryStates المبكر، قبل computeGates/PATCH_AGE،
    // فهذه القيمة لا تُستهلَك فعلياً هنا.
    analyzedAtMs: ANALYZED_AT_MS,
  });

  if (categoryStates.overall.harnessError !== true ||
      categoryStates.overall.harnessErrorReason !== 'FUNCTIONAL_RESULTS_UNAVAILABLE') {
    throw new Error(`generate-v7-reports-document-sample-honor: categoryStates.overall.harnessError/harnessErrorReason ليسا كما هو متوقَّع — ${JSON.stringify(categoryStates.overall)}`);
  }

  // ─── نفس تسلسل resolveV7Report.js:412-443 حرفياً على finalAttempt مبنيّ
  // يدوياً بشكل providerFailedNoFallback (راجع رأس الملفّ) — بلا نداء. ────
  const finalAttempt = {
    aiAnalysis: null, aiModel: null, duration: 0, pipeline: V7_PIPELINE_TAG,
    guard: {
      ok: false, shape: {ok: false, errors: ['PROVIDER_FAILED_NO_FALLBACK']},
      issueKeys: {ok: true, inventedIds: []}, numbers: {ok: true, unmatchedFields: [], excludedDevice: []},
      languageLeaks: [], excluded: {deviceSpecNumbers: [], languageTokens: []},
    },
  };
  const rejectedPaths = new Set(['narrative', 'crossChecks', 'adjustments', 'modelObservations']);

  const aiAnalysisForDisplay = Object.assign({}, finalAttempt.aiAnalysis, {
    narrative: resolveV7Internal.sanitizeNarrativeForDisplay(finalAttempt.aiAnalysis, rejectedPaths),
  });
  // finalAttempt.guard.ok === false → categoryStatesForDisplay تبقى الخام
  // بلا applyV7Adjustments (نفس شرط resolveV7Report.js:437-439 حرفياً).
  const categoryStatesForDisplay = categoryStates;

  const {display, audit} = buildDisplayShapeV7({
    categoryStates: categoryStatesForDisplay, findings, aiAnalysis: aiAnalysisForDisplay, language: 'ar',
  });

  const droppedDisplayFields = resolveV7Internal.expandDroppedDisplayFields(rejectedPaths);
  const narrativeIncomplete = droppedDisplayFields.length > 0;
  display.narrativeIncomplete = narrativeIncomplete;
  display.narrativeIncompleteFields = droppedDisplayFields;
  audit.regeneration = {
    attempts: 1, narrativeIncomplete, droppedFields: droppedDisplayFields,
    rounds: [{
      attempt: 1, aiModel: null, guardOk: false, durationMs: 0, tokensUsed: null,
      rejectedReasons: ['PROVIDER_FAILED_NO_FALLBACK: لا نداء نموذج — عيّنة Honor، القيد الصريح (القرار ٧٩ أ)'],
    }],
  };

  // ─── من هنا فصاعداً: نفس analyzeDevice.js على فرع "نجاح resolveV7Report،
  // narrative غير مكتمل" — أيّ ما يُبنى حين v7Error فارغ وv7Result موجود
  // (runAnalysisInternal.js:376-405) — aiFailed=false، aiFallbackReason=null. ──
  const aiResult = display;
  aiResult.isFreeTrial = false;
  const shortId = (typeof aiResult.shortId === 'string' && aiResult.shortId) ? aiResult.shortId : generateShortId();

  const tsHeader = (honorFp.timeSeries && honorFp.timeSeries.header) || {};
  const tsFooter = (honorFp.timeSeries && honorFp.timeSeries.footer) || {};
  const rawFpSha = tsHeader.deviceFingerprint;
  const deviceFingerprintSha = (typeof rawFpSha === 'string' && rawFpSha.trim() !== '') ? rawFpSha : null;
  const timeSeriesStoragePath = deviceFingerprintSha ? `scans/${deviceFingerprintSha}/${SCAN_ID}.ts.json.gz` : null;
  const fieldsVersion = (typeof tsFooter.fieldsVersion === 'number' && isFinite(tsFooter.fieldsVersion)) ? tsFooter.fieldsVersion : null;
  const rawAppVersion = tsHeader.appVersion;
  const appVersion = (typeof rawAppVersion === 'string' && rawAppVersion.trim() !== '') ? rawAppVersion : null;
  const rawDeviceModel = honorFp.device?.model || 'Unknown'; // analyzeDevice.js:515 — device:{} هنا أيضاً، مثل 34dff2b8

  const {buildV7ResponseForStorage} = require('../src/analysis/analyzeDevice');
  const aiResponseToSave = buildV7ResponseForStorage(aiResult);

  // القرار ٨٦ البند ٢ — Honor: functionalResults غائبة (404 حقيقي، harnessError)
  // لكن samples الخام حقيقية ومستقلّة عنها (نفس ما أثبتته categoryStates.test.js
  // للبطارية: "العيّنات حقيقية ومستقلّة عن functionalResults") — فحفظ
  // العيّنات كان سينجح فعلياً على هذا الفحص أيضاً رغم harnessError على بقيّة
  // الفئات؛ لا صلة بين الاثنين (samples تصل الخادم بصرف النظر عن نجاح
  // functionalResults). saved مُشتقّة من وجودها الفعلي هنا، لا مُختلَقة.
  const serverSamplesStoragePath = computeServerSamplesStoragePath(SCAN_ID);
  const honorSamplesRaw = honorFp.timeSeries && honorFp.timeSeries.samples;
  const serverSamplesSaved = Array.isArray(honorSamplesRaw) && honorSamplesRaw.length > 0;

  const p = {
    userId: USERID_PLACEHOLDER,
    rawDeviceModel,
    deviceMarketingName: aiResult.deviceMarketingName || rawDeviceModel,
    deviceFingerprintSha,
    timeSeriesStoragePath,
    fieldsVersion,
    appVersion,
    fingerprint: honorFp,
    aiResponseToSave,
    aiResultAudit: audit,
    aiModel: finalAttempt.aiModel,
    aiDurationMs: finalAttempt.duration,
    aiFallbackReason: null,
    pipeline: finalAttempt.pipeline,
    aiResult,
    language: 'ar',
    isSessionScan: false,
    sessionId: null,
    shortId,
    isFreeTrial: false,
    analyzedAtMs: ANALYZED_AT_MS,
    serverSamplesStoragePath,
    serverSamplesSaved,
    v5Metrics: {
      bodyBuildMs: null, // غير مقيس — لا استدعاء حقيقي لـbuildV7Payload هنا (لا نداء نموذج، القيد الصريح)
      cacheHit: false,
      cacheReason: 'first_scan',
      v7GuardOk: finalAttempt.guard.ok,
    },
  };

  const reportDocument = buildReportDocument(p);
  // V8 نقل الخامّ (2026-10-09): الخامّ في مستند reportRaw/{scanId} لا في المستند المقروء — نفس p، نفس السلسلة
  // الحقيقية (buildReportRawDocument)، العيّنة الذهبية الشقيقة لعيّنة المستند (القاعدة 39).
  const rawDocument = buildReportRawDocument({...p, scanId: SCAN_ID, createdAt: SERVER_TIMESTAMP_MARKER});
  if (reportDocument.createdAt !== SERVER_TIMESTAMP_MARKER) {
    throw new Error('generate-v7-reports-document-sample-honor: createdAt ليس SERVER_TIMESTAMP_MARKER — توقّف');
  }

  return {reportDocument, rawDocument, audit};
}

function main() {
  const {reportDocument, rawDocument} = buildReportsDocumentSampleHonor();
  fs.writeFileSync(DEST_FILE, JSON.stringify(reportDocument, null, 2) + '\n', 'utf8');
  fs.writeFileSync(RAW_DEST_FILE, JSON.stringify(rawDocument, null, 2) + '\n', 'utf8');
  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`aiResponse.overall.letter: ${JSON.stringify(reportDocument.aiResponse.overall.letter)}`);
  console.log(`aiResponse.overall.harnessError/harnessErrorReason: ${reportDocument.aiResponse.overall.harnessError} / ${reportDocument.aiResponse.overall.harnessErrorReason}`);
  console.log(`aiModel: ${JSON.stringify(reportDocument.aiModel)}  aiDurationMs: ${reportDocument.aiDurationMs}`);
  console.log(`narrativeIncomplete: ${reportDocument.aiResponse.narrativeIncomplete}  narrativeIncompleteFields: ${JSON.stringify(reportDocument.aiResponse.narrativeIncompleteFields)}`);
}

if (require.main === module) {
  main();
}

module.exports = {buildReportsDocumentSampleHonor, DEST_FILE, RAW_DEST_FILE, USERID_PLACEHOLDER, SCAN_ID};
