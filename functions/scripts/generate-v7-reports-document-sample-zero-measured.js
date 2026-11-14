#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-reports-document-sample-zero-measured — عيّنات مشتقّة يولّدها الخادم نفسه من مُدخل لا تُنتج فيه أي فئة حرفاً،
// فيمتلئ zeroMeasuredMessage وabstentionReasons (أمر مستخدم، نصّه حرفياً):
// «ثم عيّنة مشتقّة يولّدها الخادم نفسه من مُدخل لا تُقاس فيه أي فئة، فيمتلئ zeroMeasuredMessage وabstentionReasons. ومصدرها مكتوب،
// وتطابق ما ينتجه الخادم (القاعدة 41)، وتُنسخ إلى التطبيق والموقع (القاعدة 39).» · «الإصلاح في العميلين، والخادم لا يتغيّر.»
// ===================================================================
//
// ─── التعريف من الكود (62f6a7a) — لا من الاسم ─────────────────────────────
//   noDataAtAll = (measuredCategoriesMean === null)           categoryStates.js (deriveOverallFromCategories)
//     measuredCategoriesMean = متوسّط الفئات التي state==='MEASURED' وlدَيها score رقم (weightedScore). فهو null حين **لا فئة أنتجت حرفاً**
//     — لا حين «لم يُقَس شيء». فالبطارية قد تكون مقيسة (PARTIAL، مؤشّراتها محسوبة) بلا حرف، وهذا مصدر NO_CALIBRATED_THRESHOLD.
//   zeroMeasuredMessage = (overall.letter === null && noDataAtAll) ? 'لم يُقَس شيء قابل للحكم' : null    buildDisplayShapeV7.js
//   abstentionReasons   = zeroMeasuredMessage ? buildAbstentionReasons(categories) : null                  buildDisplayShapeV7.js
//   ⚠️ شرط overall.letter===null يتطلّب ألّا تُنقِذ بوّابة حرفاً: بوّابة PATCH_AGE تقرأ rawValue وحده (تتجاهل status) فتُطلَق على تاريخ
//   رقعة قديم وتُعطي overall.letter='B' (letterSource GATE:PATCH_AGE) حتى بلا أي فئة بحرف — أوقفت التشغيل الأوّل لهذا المولّد. فالتحويل
//   يشمل SEC-03 (انظر TRANSFORMATION_DOC).
//
// ─── المُدخل الحقيقي ─────────────────────────────────────────────────────
// 34dff2b8.ts.json + functionalResults-by-scanid.json['34dff2b8-ce9e-4b40-86a9-1976c878e195'] (مُلتزَمان؛ لا تعديل عليهما — نسخة في
// الذاكرة فقط). التحويل مكتوب في _meta (v7-zero-measured-samples-meta.json) بما غُيِّر ولماذا — القاعدة 12: الحقيقي لا يُعدَّل والمشتقّ ملفّ جديد.
//
// ─── السلسلة الحقيقية وحدها ──────────────────────────────────────────────
// runAnalysisInternal (computeFindings + computeCategoryStates + resolveV7Report + buildDisplayShapeV7) هي نفسها دالّة الإنتاج. المُستبدَل
// شيء واحد: callAIv7 (نداء المزوّد) يُعيد قيمته الموثَّقة لـ«فشل المزوّد بلا احتياطي» (callAI.js providerFailedNoFallback، نفس المفاتيح)،
// فتبني resolveV7Report الحقيقية بنفسها الحالة الطرفية (buildProviderFailedOutcome) والعرض والتدقيق. لا نداء نموذج ولا شبكة (global.fetch
// فخّ يرمي)، ولا نصّ سرد مُختلَق (narrativeIncomplete=true). فرق عن الإنتاج: duration=0 وbodyBuildMs=null (لا نداء ولا بناء حمولة فعلي).
// ثم القليل الذي يفعله معالج analyzeDevice بعد runAnalysisInternal (مُصدَّر ما أمكن: buildV7ResponseForStorage وbuildReportDocument
// وstripNarrativeDetailsVerdictFromV7Response وV7_OPERATIONAL_FIELDS) كما تفعله عيّنات Honor وclient-payload الموجودة — بلا Firestore.
// ردّ verifyReport: buildResponse من generate-v7-verifyReport-response-sample-honor.js (مصدر واحد، لا نسخة).
//
// ─── عيّنتان بثلاثة أشكال لكل منهما (مستند reports، ردّ analyzeDevice للتطبيق، ردّ verifyReport للموقع) ───
//   default            — البطارية بعيّنات حقيقية → NO_CALIBRATED_THRESHOLD.
//   batteryHarnessError — timeSeries.samples=[] (تحويل على المُدخل لا حقنٌ في الحساب) → sampleInputsFromRaw يُعيد null → البطارية HARNESS_ERROR.
//
// ─── الرموز ───────────────────────────────────────────────────────────────
// المُغطّاة (محسوبة من المخرَج، تُكتب في _meta): NO_HEALTH_BEARING_TESTS_DECLARED، DECLARED_BUT_NONE_EXECUTED، NO_CALIBRATED_THRESHOLD،
// HARNESS_ERROR. غير الممكنة من مُدخل حقيقي بلا اختلاق: MANUAL_ATTESTATION_ONLY وNO_BATTERY_INDICATORS_MEASURED — الأسباب في UNREACHABLE_CODES.
//
// الأقسام الحاكمة: لا تغيير في كود الخادم (لا سطر في src/ يُمسّ).
//
// Run: node functions/scripts/generate-v7-reports-document-sample-zero-measured.js
// ===================================================================

const fs = require('fs');
const path = require('path');

// ─── فخّ Firestore + فخّ الشبكة + استبدال نداء المزوّد — قبل أي require لما يحمّل resolveV7Report ───
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {
      collection: () => { throw new Error('generate-v7-reports-document-sample-zero-measured: Firestore must not be touched'); },
      doc: () => { throw new Error('generate-v7-reports-document-sample-zero-measured: Firestore must not be touched'); },
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const callAIModule = require('../src/analysis/callAI');
const RESOLVE_V7_PATH = require.resolve('../src/analysis/resolveV7Report');
if (require.cache[RESOLVE_V7_PATH]) {
  throw new Error('generate-v7-reports-document-sample-zero-measured: resolveV7Report حُمِّلت قبل استبدال callAIv7 — توقّف (كان النداء الحقيقي سيُستدعى)');
}
// نصّ العلامة يظهر في audit.regeneration.rounds[0].rejectedReasons — إعلان صريح لا تمويه.
const PROVIDER_STUB_MARKER = 'SIMULATED_NO_MODEL_CALL — عيّنة zero-measured: لا نداء نموذج ولا شبكة';
let providerStubCalls = 0;
callAIModule.callAIv7 = async () => {
  providerStubCalls++;
  // نفس مفاتيح callAI.js (فرع providerFailedNoFallback) حرفاً: aiAnalysis، aiModel، duration، pipeline، bodyBuildMs، guard، rawResponseText،
  // rawResponseProvider، providerFailedNoFallback، primaryError.
  return {
    aiAnalysis: null, aiModel: null, duration: 0, pipeline: V7_PIPELINE_TAG,
    bodyBuildMs: null, guard: null, rawResponseText: null, rawResponseProvider: null,
    providerFailedNoFallback: true, primaryError: PROVIDER_STUB_MARKER,
  };
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {
  buildReportDocument, buildV7ResponseForStorage, stripNarrativeDetailsVerdictFromV7Response, SERVER_TIMESTAMP_MARKER,
} = require('../src/analysis/analyzeDevice');
const {buildReportRawDocument} = require('../src/analysis/reportRawStore');
const {V7_OPERATIONAL_FIELDS} = require('../src/analysis/v7OperationalFields');
const {computeServerSamplesStoragePath} = require('../src/analysis/serverRawSamplesStorage');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {generateShortId} = require('../src/utils/generateShortId');
const {buildResponse: buildVerifyReportResponse, fakeDoc} = require('./generate-v7-verifyReport-response-sample-honor');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const TS_FILE = '34dff2b8.ts.json';
const REAL_SCAN_ID_FOR_LOOKUP = '34dff2b8-ce9e-4b40-86a9-1976c878e195';
const META_FILE = path.join(GOLDEN_DIR, 'v7-zero-measured-samples-meta.json');
const USERID_PLACEHOLDER = Object.freeze({__marker: 'NOT_FROM_FIRESTORE_OR_AUTH_USERID'});

// الفئات التسع التي كانت تنتج حرفاً على 34dff2b8 الحقيقي (وكل ما عداها بلا حرف أصلاً: thermal/camera/gps declaredCount>0 وexecutedCount=0،
// audio/input declaredCount=0، البطارية بلا verdict معايَر). status وحده يتغيّر إلى 'not_tested' — قيمة حقيقية تحملها 16 عنصراً في المُدخل نفسه.
const SUPPRESSED_LETTER_CATEGORIES = Object.freeze(['cpu', 'gpu', 'display', 'memory', 'storage', 'security', 'sensors', 'cellular', 'wireless']);
const NOT_EXECUTED_STATUS_VALUE = 'not_tested';
// SEC-03: الشكل الذي يحمله SEC-07 (نفس الفئة) وT-01/T-02/T-03 في المُدخل نفسه حين لا قراءة: status='unavailable'، rawValue='N/A'.
const PATCH_TEST_ID = 'SEC-03';
const UNREADABLE_STATUS_VALUE = 'unavailable';
const UNREADABLE_RAW_VALUE = 'N/A';

const VARIANTS = Object.freeze({
  default: Object.freeze({
    key: 'default', label: 'default (battery NO_CALIBRATED_THRESHOLD)',
    scanId: 'aba0afae-192b-4121-baf9-f2e004def8a1', emptySamples: false,
    expectBatteryCode: 'NO_CALIBRATED_THRESHOLD',
    files: Object.freeze({
      reportsDocument: 'v7-reports-document-sample-zero-measured.json',
      rawDocument: 'v7-report-raw-sample-zero-measured.json',
      clientPayload: 'v7-client-payload-sample-zero-measured.json',
      verifyReport: 'v7-verifyReport-response-sample-zero-measured.json',
    }),
  }),
  batteryHarnessError: Object.freeze({
    key: 'batteryHarnessError', label: 'battery HARNESS_ERROR (samples=[])',
    scanId: '85ca0ceb-e142-4be4-aaf6-c929037538a5', emptySamples: true,
    expectBatteryCode: 'HARNESS_ERROR',
    files: Object.freeze({
      reportsDocument: 'v7-reports-document-sample-zero-measured-battery-harness-error.json',
      rawDocument: 'v7-report-raw-sample-zero-measured-battery-harness-error.json',
      clientPayload: 'v7-client-payload-sample-zero-measured-battery-harness-error.json',
      verifyReport: 'v7-verifyReport-response-sample-zero-measured-battery-harness-error.json',
    }),
  }),
});

const SHARED_EXPECTED_CODES = Object.freeze(['NO_HEALTH_BEARING_TESTS_DECLARED', 'DECLARED_BUT_NONE_EXECUTED']);

// رموز لا يمكن إنتاجها من مُدخل حقيقي بلا اختلاق — تُكتب في _meta بسببها (لا إخفاء).
const UNREACHABLE_CODES = Object.freeze([
  {
    code: 'MANUAL_ATTESTATION_ONLY',
    reason: 'تنتج categoryAbsenceReason هذا الرمز حين state==="ATTESTED_ONLY"، وهي لا تنتج إلا حين تكون كل اختبارات الفئة المنفَّذة attested=true، ' +
        'وattested=true لا يُعطى إلا لعناصر manualResults (categoryStates.js buildAllTestResults، isManual:true). لا عنصر manualResults ' +
        'واحد مُلتزَم في المستودع (git grep لمصفوفة manualResults غير فارغة: صفر نتيجة) — كل استعمال حالي `[]`. بناء عنصر كهذا اختلاق شهادة فنّي لم تقع.',
  },
  {
    code: 'NO_BATTERY_INDICATORS_MEASURED',
    reason: 'احتياطي categoryAbsenceReason للبطارية حين لا noLetterReason ولا reason. computeBatteryCategory (categoryStates.js) يضع ' +
        'noLetterReason=CATEGORY_GRADING_LOCKED_TEXT دائماً مع وجود عيّنات (canGrade ثابت false حتى PLAN-03)، ويضع reason="HARNESS_ERROR" ' +
        'حين لا عيّنات — فلا مسار حقيقي يصل الاحتياطي اليوم (حتى مع measuredCount=0 يبقى noLetterReason حاضراً فيخرج NO_CALIBRATED_THRESHOLD). ' +
        'بلوغه يتطلّب تعديل كود الخادم (ممنوع في هذه المهمّة).',
  },
]);

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

/**
 * المُدخل المحوَّل — نسخة في الذاكرة من الملفّين الحقيقيَّين؛ يُعيد التحويل مع أعداده (تُكتب في _meta).
 * @param {Object} variant عنصر من VARIANTS
 * @return {{timeSeries: Object, functionalResults: Array, transformation: Array<Object>}}
 */
function buildTransformedInput(variant) {
  const rawReal = loadJson(TS_FILE);
  const realFunctionalResults = loadJson('functionalResults-by-scanid.json').byScanId[REAL_SCAN_ID_FOR_LOOKUP];
  if (!Array.isArray(realFunctionalResults) || realFunctionalResults.length === 0) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured: توقّف — functionalResults غائبة لِـ${REAL_SCAN_ID_FOR_LOOKUP}`);
  }
  const suppressed = new Set(SUPPRESSED_LETTER_CATEGORIES);
  const changedByCategory = {};
  let sec03Before = null;
  const functionalResults = realFunctionalResults.map((r) => {
    if (r.testId === PATCH_TEST_ID) {
      sec03Before = {status: r.status, rawValue: r.rawValue};
      return Object.assign({}, r, {status: UNREADABLE_STATUS_VALUE, rawValue: UNREADABLE_RAW_VALUE});
    }
    if (suppressed.has(r.categoryName)) {
      changedByCategory[r.categoryName] = (changedByCategory[r.categoryName] || 0) + 1;
      return Object.assign({}, r, {status: NOT_EXECUTED_STATUS_VALUE});
    }
    return r;
  });
  if (!sec03Before) throw new Error(`generate-v7-reports-document-sample-zero-measured: توقّف — ${PATCH_TEST_ID} غير موجود في المُدخل`);
  const notTestedInReal = realFunctionalResults.filter((r) => r.status === NOT_EXECUTED_STATUS_VALUE).length;
  const unavailableNaInReal = realFunctionalResults.filter((r) => r.status === UNREADABLE_STATUS_VALUE && r.rawValue === UNREADABLE_RAW_VALUE).map((r) => r.testId);

  const timeSeries = JSON.parse(JSON.stringify(rawReal));
  const realHeaderScanId = timeSeries.header && timeSeries.header.scanId;
  timeSeries.header.scanId = variant.scanId;
  const transformation = [
    {
      target: 'functionalResults[*].status — عناصر الفئات ' + SUPPRESSED_LETTER_CATEGORIES.join('، '),
      from: 'القيم الحقيقية (pass/warning/fail/…)', to: NOT_EXECUTED_STATUS_VALUE,
      changedCountByCategory: changedByCategory,
      reason: 'كي لا تُنتج الفئة حرفاً: declaredCount يبقى (الاختبار ما زال مُصرَّحاً به) وexecutedCount=0 → state=UNMEASURED → DECLARED_BUT_NONE_EXECUTED — ' +
          'الآلية الطبيعية نفسها التي تُنتج thermal/camera/gps على المُدخل الحقيقي. القيمة "' + NOT_EXECUTED_STATUS_VALUE + '" حقيقية في المُدخل نفسه (' +
          notTestedInReal + ' عنصراً تحملها فعلاً). status وحده — rawValue/rawValueUnit/notes/componentName بلا مساس.',
    },
    {
      target: `functionalResults[testId=${PATCH_TEST_ID}] — status وrawValue`,
      from: {status: sec03Before.status, rawValue: sec03Before.rawValue},
      to: {status: UNREADABLE_STATUS_VALUE, rawValue: UNREADABLE_RAW_VALUE},
      reason: 'بوّابة PATCH_AGE تقرأ rawValue وحده (تتجاهل status — categoryStates.js computeGates). مع التاريخ الحقيقي (' + sec03Before.rawValue +
          '، أكثر من 36 شهراً) تُطلَق وتُنقذ حرفاً عامّاً (overall.letter="B"، letterSource="GATE:PATCH_AGE") فلا يبقى letter=null ولا يمتلئ zeroMeasuredMessage ' +
          '(قيس: أوقف التشغيل الأوّل لهذا المولّد). الشكل البديل هو ما يحمله المُدخل نفسه لاختبارات لا قراءة لها: status="' + UNREADABLE_STATUS_VALUE +
          '" وrawValue="' + UNREADABLE_RAW_VALUE + '" (' + unavailableNaInReal.join('، ') + '). ROOT_DETECTED يقرأ status وحده، وSEC-04 صار not_tested بالتحويل الأوّل → INPUT_ABSENT.',
    },
    {
      target: 'timeSeries.header.scanId',
      from: realHeaderScanId, to: variant.scanId,
      reason: 'معرّف مميَّز لكل عيّنة مشتقّة كي لا تتصادم هوية المستند والمسار (timeSeriesStoragePath) مع عيّنات 34dff2b8 الحقيقية الأخرى؛ ' +
          'تبقى ترويسة السلسلة متّسقة مع scanId المستند.',
    },
  ];
  if (variant.emptySamples) {
    const samplesBefore = Array.isArray(timeSeries.samples) ? timeSeries.samples.length : null;
    timeSeries.samples = [];
    transformation.push({
      target: 'timeSeries.samples', from: `مصفوفة بـ${samplesBefore} عيّنة`, to: '[]',
      reason: 'المسار الحقيقي لبطارية HARNESS_ERROR: runAnalysisInternal يستدعي sampleInputsFromRaw(fingerprint) الذي يُعيد sampleInputs=null بلا عيّنات ' +
          '(sampleInputsFromRaw.js)، فتُنتج computeBatteryCategory reason="HARNESS_ERROR" — تحويل على المُدخل لا حقنٌ في الحساب. ' +
          'أثر جانبي حقيقي تحسبه computeFindings نفسها: findings.status=NOT_MEASURED.',
    });
  }
  return {timeSeries, functionalResults, transformation};
}

function codeOf(reason) {
  return String(reason).split(' ')[0];
}

/**
 * يبني الأشكال الثلاثة لعيّنة واحدة عبر السلسلة الحقيقية. في الذاكرة فقط — لا كتابة.
 * @param {string} variantKey 'default' | 'batteryHarnessError'
 * @return {Promise<Object>}
 */
async function buildZeroMeasuredSamples(variantKey) {
  const variant = VARIANTS[variantKey];
  if (!variant) throw new Error(`generate-v7-reports-document-sample-zero-measured: متغيّر غير معروف ${variantKey}`);
  const label = variant.label;
  const {timeSeries, functionalResults, transformation} = buildTransformedInput(variant);
  const fingerprint = {device: {}, timeSeries, functionalResults, manualResults: []};

  // فخّ الشبكة — يُركَّب طوال البناء ويُستعاد بعده.
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('generate-v7-reports-document-sample-zero-measured: TRAP — network must not be touched'); };
  let result;
  const callsBefore = providerStubCalls;
  try {
    // scanContext غائب عمداً: يُسقِط كتابة aiRawResponses (Firestore) — runAnalysisInternal يشترط scanContext.scanId لها.
    result = await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: null, geminiKey: null, scanContext: undefined, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
    });
  } finally {
    global.fetch = realFetch;
  }
  if (providerStubCalls !== callsBefore + 1) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — نداء المزوّد المُستبدَل لم يُستدعَ مرّة واحدة بالضبط (${providerStubCalls - callsBefore})`);
  }
  if (result.aiFailed || !result.aiResult || !result.aiResultAudit) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — runAnalysisInternal لم يُعِد مخرَجاً كاملاً: aiFailed=${result.aiFailed}`);
  }
  const {aiResult, aiResultAudit, categoryStates, findings} = result;

  // ─── التحقّق الذاتي — يتوقّف إن لم يتحقّق (نصّ الأمر) ───────────────────
  const overall = aiResult.overall;
  if (overall.letter !== null || overall.noDataAtAll !== true) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — overall.letter/noDataAtAll ليسا كما هو متوقَّع: ${JSON.stringify({letter: overall.letter, letterSource: overall.letterSource, noDataAtAll: overall.noDataAtAll})}`);
  }
  if (typeof overall.zeroMeasuredMessage !== 'string' || overall.zeroMeasuredMessage.length === 0) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — zeroMeasuredMessage فارغ/غائب: ${JSON.stringify(overall.zeroMeasuredMessage)}`);
  }
  if (!Array.isArray(overall.abstentionReasons) || overall.abstentionReasons.length === 0 ||
      !overall.abstentionReasons.every((a) => a && typeof a === 'object' && typeof a.category === 'string' && typeof a.reason === 'string' && a.reason.length > 0)) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — abstentionReasons ليست مصفوفة كائنات غير فارغة: ${JSON.stringify(overall.abstentionReasons)}`);
  }
  for (const [cat, entry] of Object.entries(categoryStates.categories)) {
    if (entry.deterministicLetter !== null) {
      throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — الفئة "${cat}" أنتجت حرفاً (${entry.deterministicLetter}) — ليست عيّنة صفر حرف`);
    }
  }
  const codes = [...new Set(overall.abstentionReasons.map((a) => codeOf(a.reason)))].sort();
  const batteryReason = overall.abstentionReasons.find((a) => a.category === 'battery');
  if (!batteryReason || codeOf(batteryReason.reason) !== variant.expectBatteryCode) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — سبب البطارية ${JSON.stringify(batteryReason)} ≠ ${variant.expectBatteryCode}`);
  }
  for (const c of SHARED_EXPECTED_CODES) {
    if (!codes.includes(c)) throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — الرمز ${c} غائب عن abstentionReasons: ${JSON.stringify(codes)}`);
  }
  const rounds = aiResultAudit.regeneration && aiResultAudit.regeneration.rounds;
  if (!Array.isArray(rounds) || rounds.length !== 1 || !String(rounds[0].rejectedReasons[0]).includes(PROVIDER_STUB_MARKER)) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — audit.regeneration لا يحمل علامة المحاكاة كما هو متوقَّع`);
  }

  // ─── من هنا: ما يفعله معالج analyzeDevice بعد runAnalysisInternal (بلا Firestore) ───
  const rawDeviceModel = (fingerprint.device && fingerprint.device.model) || 'Unknown';
  const deviceMarketingName = aiResult.deviceMarketingName || rawDeviceModel;
  const isFreeTrial = false;
  aiResult.isFreeTrial = isFreeTrial;
  const shortId = (typeof aiResult.shortId === 'string' && aiResult.shortId) ? aiResult.shortId : generateShortId();

  const tsHeader = (fingerprint.timeSeries && fingerprint.timeSeries.header) || {};
  const tsFooter = (fingerprint.timeSeries && fingerprint.timeSeries.footer) || {};
  const rawFpSha = tsHeader.deviceFingerprint;
  const deviceFingerprintSha = (typeof rawFpSha === 'string' && rawFpSha.trim() !== '') ? rawFpSha : null;
  const timeSeriesStoragePath = deviceFingerprintSha ? `scans/${deviceFingerprintSha}/${variant.scanId}.ts.json.gz` : null;
  const fieldsVersion = (typeof tsFooter.fieldsVersion === 'number' && isFinite(tsFooter.fieldsVersion)) ? tsFooter.fieldsVersion : null;
  const rawAppVersion = tsHeader.appVersion;
  const appVersion = (typeof rawAppVersion === 'string' && rawAppVersion.trim() !== '') ? rawAppVersion : null;

  const aiResponseToSave = buildV7ResponseForStorage(aiResult);
  const serverSamplesStoragePath = computeServerSamplesStoragePath(variant.scanId);
  const samplesRaw = fingerprint.timeSeries && fingerprint.timeSeries.samples;
  const serverSamplesSaved = Array.isArray(samplesRaw) && samplesRaw.length > 0;

  const reportInputs = {
    userId: USERID_PLACEHOLDER, rawDeviceModel, deviceMarketingName, deviceFingerprintSha, timeSeriesStoragePath, fieldsVersion, appVersion,
    fingerprint, aiResponseToSave, aiResultAudit,
    aiModel: result.aiModel, aiDurationMs: result.aiDurationMs, aiFallbackReason: result.aiFallbackReason, pipeline: result.pipeline,
    aiResult, language: 'ar', isSessionScan: false, sessionId: null, shortId, isFreeTrial,
    analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
    serverSamplesStoragePath, serverSamplesSaved,
    v5Metrics: result.v5Metrics,
  };
  const reportDocument = buildReportDocument(reportInputs);
  // V8 نقل الخامّ (2026-10-09): الخامّ في reportRaw/{scanId} — نفس المُدخلات، نفس السلسلة الحقيقية (القاعدة 39).
  const rawDocument = buildReportRawDocument({...reportInputs, scanId: variant.scanId, createdAt: SERVER_TIMESTAMP_MARKER});
  if (reportDocument.createdAt !== SERVER_TIMESTAMP_MARKER) {
    throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — createdAt ليس SERVER_TIMESTAMP_MARKER`);
  }

  const operationalFieldValues = {shortId, isFreeTrial, aiModel: result.aiModel, deviceMarketingName};
  const operationalExtras = {};
  for (const f of V7_OPERATIONAL_FIELDS) operationalExtras[f] = operationalFieldValues[f];
  const clientPayload = {...stripNarrativeDetailsVerdictFromV7Response(aiResponseToSave), ...operationalExtras};

  const warns = [];
  const verifyReportResponse = buildVerifyReportResponse(fakeDoc(variant.scanId, reportDocument), warns);

  // الأشكال الثلاثة تحمل الحقلين فعلاً (لا افتراض) — القارئ في العميلين يقرأ overall.zeroMeasuredMessage/abstentionReasons.
  for (const [shape, ov] of [
    ['reportsDocument', reportDocument.aiResponse.overall],
    ['clientPayload', clientPayload.overall],
    // ردّ verifyReport يُسطِّح overall داخل aiResponse (pickOverall، verifyReport.js) — الحقلان على aiResponse مباشرة لا aiResponse.overall.
    ['verifyReport', verifyReportResponse.aiResponse],
  ]) {
    if (!ov || ov.zeroMeasuredMessage !== overall.zeroMeasuredMessage || JSON.stringify(ov.abstentionReasons) !== JSON.stringify(overall.abstentionReasons)) {
      throw new Error(`generate-v7-reports-document-sample-zero-measured (${label}): توقّف — الشكل "${shape}" لا يحمل zeroMeasuredMessage/abstentionReasons كما في display`);
    }
  }

  return {
    variant, reportDocument, rawDocument, clientPayload, verifyReportResponse, verifyReportWarns: warns,
    transformation, codes,
    codeCategories: Object.fromEntries(codes.map((c) => [c, overall.abstentionReasons.filter((a) => codeOf(a.reason) === c).map((a) => a.category)])),
    zeroMeasuredMessage: overall.zeroMeasuredMessage, abstentionReasons: overall.abstentionReasons,
    findingsStatus: findings && findings.status,
  };
}

/** @return {Promise<{files: Object, meta: Object}>} محتوى الملفّات التسعة كلّها (في الذاكرة). */
async function buildAllZeroMeasuredFiles() {
  const files = {};
  const perVariant = {};
  for (const key of Object.keys(VARIANTS)) {
    const s = await buildZeroMeasuredSamples(key);
    files[VARIANTS[key].files.reportsDocument] = s.reportDocument;
    files[VARIANTS[key].files.rawDocument] = s.rawDocument;
    files[VARIANTS[key].files.clientPayload] = s.clientPayload;
    files[VARIANTS[key].files.verifyReport] = s.verifyReportResponse;
    perVariant[key] = s;
  }
  const allCodes = [...new Set(Object.values(perVariant).flatMap((s) => s.codes))].sort();
  const meta = {
    _meta: {
      label: 'مشتقّ، ليس ردّاً حقيقياً ولا فحصاً حقيقياً — عيّنات zero-measured من مُدخل حقيقي محوَّل (القاعدة 12)',
      userOrder: 'ثم عيّنة مشتقّة يولّدها الخادم نفسه من مُدخل لا تُقاس فيه أي فئة، فيمتلئ zeroMeasuredMessage وabstentionReasons. ومصدرها مكتوب، وتطابق ما ينتجه الخادم (القاعدة 41)، وتُنسخ إلى التطبيق والموقع (القاعدة 39).',
      whySeparateFile: 'القاعدة 41: العيّنة يجب أن تطابق ما يُنتجه الخادم — فلا مفتاح _meta داخل المستند أو الردّ. المصدر والتحويل هنا في ملفّ مستقلّ.',
      generatedBy: 'functions/scripts/generate-v7-reports-document-sample-zero-measured.js',
      guard: 'functions/test/v7ZeroMeasuredSamplesContractGuard.test.js',
      source: {
        timeSeries: 'functions/test/fixtures/golden/' + TS_FILE,
        functionalResults: `functions/test/fixtures/golden/functionalResults-by-scanid.json["${REAL_SCAN_ID_FOR_LOOKUP}"]`,
        unchanged: 'الملفّان الحقيقيان بلا مساس — التحويل نسخة في الذاكرة فقط',
      },
      definition: {
        noDataAtAll: 'measuredCategoriesMean === null — لا فئة أنتجت حرفاً (categoryStates.js، deriveOverallFromCategories)، لا «لم يُقَس شيء»',
        zeroMeasuredMessage: 'overall.letter === null && noDataAtAll (buildDisplayShapeV7.js)',
        abstentionReasons: 'تُبنى حين zeroMeasuredMessage مملوء — لكل فئة بلا حرف {category, reason} (buildAbstentionReasons)',
      },
      chain: 'runAnalysisInternal الحقيقية (computeFindings، computeCategoryStates، resolveV7Report، buildDisplayShapeV7) + buildV7ResponseForStorage + buildReportDocument + ' +
          'stripNarrativeDetailsVerdictFromV7Response + buildResponse (verifyReport). المُستبدَل نداء المزوّد وحده.',
      simulated: {
        what: 'callAIv7 يُعيد قيمة providerFailedNoFallback الموثَّقة (callAI.js) — لا نداء نموذج ولا شبكة؛ global.fetch فخّ يرمي طوال البناء',
        marker: PROVIDER_STUB_MARKER,
        effects: 'narrativeIncomplete=true (السرد غائب، لا نصّ مُختلَق)؛ audit.regeneration.rounds[0].rejectedReasons يحمل العلامة؛ aiModel=null؛ durationMs=0؛ v5Metrics.bodyBuildMs=null',
        analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
      },
      variants: Object.fromEntries(Object.entries(perVariant).map(([k, s]) => [k, {
        label: s.variant.label, scanId: s.variant.scanId, files: s.variant.files,
        transformation: s.transformation,
        zeroMeasuredMessage: s.zeroMeasuredMessage,
        codesCovered: s.codes, codeCategories: s.codeCategories,
        findingsStatus: s.findingsStatus,
      }])),
      codesCoveredAcrossVariants: allCodes,
      codesNotReachable: UNREACHABLE_CODES,
      selfChecks: 'المولّد يتوقّف إن لم يتحقّق: overall.letter===null وnoDataAtAll===true، zeroMeasuredMessage نصّ غير فارغ، abstentionReasons مصفوفة كائنات {category, reason} غير فارغة، ' +
          'كل فئة deterministicLetter===null، سبب البطارية = رمز المتغيّر، الرمزان المشتركان حاضران، علامة المحاكاة في audit.regeneration، والأشكال الثلاثة تحمل الحقلين نفسيهما.',
      excludedFromComparison: 'shortId (عشوائي بتصميمه، generateShortId) على المستوى الأعلى للمستند/الردّ',
    },
  };
  files[path.basename(META_FILE)] = meta;
  return {files, meta, perVariant};
}

async function main() {
  const {files, meta, perVariant} = await buildAllZeroMeasuredFiles();
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(GOLDEN_DIR, name), JSON.stringify(content, null, 2) + '\n', 'utf8');
    console.log(`كُتب: ${path.join(GOLDEN_DIR, name)}`);
  }
  for (const [key, s] of Object.entries(perVariant)) {
    console.log(`\n── ${key} ──`);
    console.log(`zeroMeasuredMessage: ${JSON.stringify(s.zeroMeasuredMessage)}`);
    console.log(`abstentionReasons: ${JSON.stringify(s.abstentionReasons)}`);
    console.log(`الرموز المُغطّاة: ${s.codes.join(', ')}`);
    console.log(`verifyReport warns: ${s.verifyReportWarns.length === 0 ? '(لا شيء)' : JSON.stringify(s.verifyReportWarns)}`);
  }
  console.log(`\nالرموز المُغطّاة عبر العيّنتين: ${meta._meta.codesCoveredAcrossVariants.join(', ')}`);
  console.log(`غير الممكنة: ${UNREACHABLE_CODES.map((u) => u.code).join(', ')}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = {
  buildZeroMeasuredSamples, buildAllZeroMeasuredFiles, VARIANTS, META_FILE, GOLDEN_DIR,
  SUPPRESSED_LETTER_CATEGORIES, NOT_EXECUTED_STATUS_VALUE, PATCH_TEST_ID, UNREACHABLE_CODES, PROVIDER_STUB_MARKER,
};
