#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-reports-document-sample-cpu-c06-downgrade — يبني مستند
// reports/{scanId} حقيقي فعلاً لحالة LLM_ADJUSTED **بحرف يتغيّر ظاهرياً
// فعلاً** (B→C) — عبر السلسلة الحقيقية الكاملة (resolveV7Report →
// applyV7Adjustments → buildDisplayShapeV7 → buildReportDocument).
// ===================================================================
//
// الغرض (القرار ٩٨ البند ٢، نصّ المستخدم حرفياً 2026-09-25 +03): بعد
// القرار ٩٨-١ (letterSource=LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن
// الحرف الحتمي)، عيّنة القرار ٩٥-٣ (security) لم تعد تحمل LLM_ADJUSTED
// حقيقياً (D→D، "مقبول بلا أثر"). "تُختار فئة حرفها الحتمي فوق D، ودليل
// تخفيضها FAIL في اختبار قياس (MEASUREMENT) داخلها، كـC-06 في cpu أو
// G-03/G-04 في gpu." اختيرت **C-06 في cpu** تحديداً (لا G-03/G-04): بحكم
// المدقّق، الـAPK الجديد لا يرسل G-03/G-04/G-05 (مُنتِجها حُذف في 7a963dd)
// ويرسل C-06 — فC-06 تمثّل ما قد يصل فعلاً، G-03/G-04 لا.
//
// ─── ما هو مُعدَّل، وما هو مصنوع، وما هو حقيقي (ثلاثة مستويات، لا اثنان) ──
// **حقيقي**: fingerprint (raw timeSeries) — بلا مساس. C-06 نفسها حقيقية
// (اختبار قياس فعلي، kind=MEASUREMENT بنصّ testKinds.js:109/145، rawValue
// حقيقي 9.1%) — **قيمتها المُبلَّغة وحدها معدَّلة** (status: pass→fail).
// **مُعدَّل** (القرار ٩٨-٢، نصّ الأمر: "فإن لم يكن في فخّ S10 الحقيقي FAIL
// كهذا: تُعدَّل نتيجة ذلك الاختبار وحده في نسخة من المدخل"): C-06 الحقيقية
// على b45c8cf6 هي status="pass" فعلياً (rawValue=9.1%، مُتحقَّق مباشرة) —
// **لا FAIL حقيقي متاح على هذا الفحص**. عنصر واحد (C-06) في **نسخة** من
// functionalResults يُعدَّل status إلى "fail" — 84 عنصراً آخر بلا مساس، لا
// تعديل على الملفّ المُلتزَم `functionalResults-by-scanid.json` نفسه.
// الأثر الحتمي المباشر لهذا التعديل وحده (بلا أي نموذج بعد): cpu.deterministicLetter
// A→B (score 100→80)، وPOS-cpu يختفي ويظهر ISS-C-06 — **حتمي من الكود، لا
// من نموذج**.
// **مصنوع**: محتوى ردّ النموذج (functions/test/fixtures/frozen-fake-model-
// response-cpu-down-c06-fail-modified-input-2026-09-25.json، خارج golden/،
// موسوم صراحة `_provenance.kind` بذلك) — لم يُستدعَ أي مزوّد فعلياً؛
// evidenceRefs يستشهد بنتيجة C-06 (بعد التعديل) الحقيقية على المدخل
// المعدَّل — لا قياس اختُلق فوق ما وُضع في التعديل أعلاه.
//
// **لا يُستبدَل هنا إلا global.fetch** (القاعدة 37، نفس نمط
// applyV7AdjustmentsWiring.test.js/generate-v7-reports-document-sample-
// security-downgrade.js) — resolveV7Report/applyV7Adjustments/
// buildDisplayShapeV7/buildReportDocument حقيقية بالكامل على المدخل
// المعدَّل. guardV7Response (حارس الإنتاج نفسه) تحقّق عند بناء الردّ
// المصنوع (guardVerifiedAtGenerationTime في الملفّ) — والتحقّق الدفاعي
// أدناه يعيد التأكيد عند كل تشغيل عبر guardFinal.ok من resolveV7Report
// الحقيقية نفسها.
//
// Run: node functions/scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-reports-document-sample-cpu-c06-downgrade: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {buildReportDocument, buildV7ResponseForStorage, SERVER_TIMESTAMP_MARKER} = require('../src/analysis/analyzeDevice');
const {buildReportRawDocument} = require('../src/analysis/reportRawStore');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {computeServerSamplesStoragePath} = require('../src/analysis/serverRawSamplesStorage');
const {generateShortId} = require('../src/utils/generateShortId');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const FAKE_RESPONSE_FILE = 'frozen-fake-model-response-cpu-down-c06-fail-modified-input-2026-09-25.json';
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-reports-document-sample-cpu-c06-downgrade.json');
const RAW_DEST_FILE = path.join(GOLDEN_DIR, 'v7-report-raw-sample-cpu-c06-downgrade.json');
const USERID_PLACEHOLDER = Object.freeze({__marker: 'NOT_FROM_FIRESTORE_OR_AUTH_USERID'});
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

// القرار ٩٨ البند ٢ — التعديل الوحيد المُسمّى على المدخل (راجع تعليق رأس
// الملفّ): C-06 وحدها، status فقط، pass→fail.
const MODIFIED_TEST_ID = 'C-06';

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

/**
 * يبني مستند reports/{scanId} كاملاً على مدخل معدَّل عنصراً واحداً — عبر
 * resolveV7Report الحقيقية (global.fetch وحده مُستبدَل)، ثم buildReportDocument
 * الحقيقية. في الذاكرة فقط، بلا كتابة.
 * @return {Promise<{reportDocument: Object, resolved: Object, c06Index: number}>}
 */
async function buildReportsDocumentSampleCpuC06Downgrade() {
  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const realFunctionalResults = frMap[SCAN_ID];
  if (!Array.isArray(realFunctionalResults)) {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: لا functionalResults لِـ ${SCAN_ID}`);
  }

  // ─── تحقّق دفاعي: C-06 الحقيقية فعلاً pass قبل أي تعديل (القاعدة 16/22 —
  // لا افتراض أن التعديل ما زال ضرورياً؛ إن صارت C-06 fail حقيقياً على هذا
  // الفِخّ لاحقاً، يجب توقّف هذا المولّد لا افتراض المدخل نفسه). ──────────
  const realC06 = realFunctionalResults.find((r) => r.testId === MODIFIED_TEST_ID);
  if (!realC06 || realC06.status !== 'pass' || realC06.categoryName !== 'cpu') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — ${MODIFIED_TEST_ID} الحقيقية لم تعد كما هو موثَّق (pass، cpu). الفعلي: ${JSON.stringify(realC06)}`);
  }

  // نسخة معدَّلة — عنصر واحد فقط (القرار ٩٨-٢).
  const functionalResults = realFunctionalResults.map((r) =>
    (r.testId === MODIFIED_TEST_ID ? Object.assign({}, r, {status: 'fail'}) : r));

  const fingerprint = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults, manualResults: []};
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults, manualResults: [], dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
    analyzedAtMs: ANALYZED_AT_MS,
  });

  // ─── تحقّق دفاعي: الأثر الحتمي المتوقَّع للتعديل وحده (بلا أي نموذج بعد). ──
  const c06Index = categoryStates.testResults.findIndex((t) => t.testId === MODIFIED_TEST_ID);
  if (c06Index < 0 || categoryStates.testResults[c06Index].outcome !== 'FAIL' ||
      categoryStates.testResults[c06Index].category !== 'cpu') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — نتيجة ${MODIFIED_TEST_ID} بعد التعديل غير كما هو متوقَّع. c06Index=${c06Index}, testResult=${JSON.stringify(categoryStates.testResults[c06Index])}`);
  }
  if (categoryStates.categories.cpu.deterministicLetter !== 'B') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — cpu.deterministicLetter بعد تعديل المدخل ≠ B (المتوقَّع من score=80). الفعلي: ${JSON.stringify(categoryStates.categories.cpu)}`);
  }

  const fakeResponseWrapper = loadJson(path.join(FIXTURES_DIR, FAKE_RESPONSE_FILE));
  if (!fakeResponseWrapper._provenance || fakeResponseWrapper._provenance.kind !== 'FAKE_MODEL_RESPONSE_ON_MODIFIED_INPUT — مدخل معدَّل وردّ نموذج مصنوع، لا نداء نموذج فعلي') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — ${FAKE_RESPONSE_FILE} غير موسوم كردّ مصنوع على مدخل معدَّل كما هو متوقَّع`);
  }
  const expectedEvidenceRef = `categoryStates.testResults[${c06Index}].outcome`;
  const fakeContent = JSON.parse(fakeResponseWrapper.rawEnvelope.choices[0].message.content);
  const cpuAdj = fakeContent.adjustments.find((a) => a.category === 'cpu');
  if (!cpuAdj || cpuAdj.evidenceRefs[0] !== expectedEvidenceRef) {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — الردّ المصنوع لا يستشهد بالفهرس الحقيقي المتوقَّع (${expectedEvidenceRef})، وجد: ${JSON.stringify(cpuAdj)}`);
  }

  const originalFetch = global.fetch;
  let fetchCallCount = 0;
  global.fetch = async (url) => {
    fetchCallCount++;
    if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
    if (fetchCallCount > 1) throw new Error('TRAP: fetch queue exhausted — المحاولة الأولى يجب أن تُقبَل');
    return {ok: true, status: 200, json: async () => fakeResponseWrapper.rawEnvelope, text: async () => JSON.stringify(fakeResponseWrapper.rawEnvelope)};
  };

  let resolved;
  try {
    resolved = await resolveV7Report({
      findings, categoryStates, language: 'ar',
      scanContext: {scanId: SCAN_ID, isFreeTrial: false},
      previousScan: null, deepseekApiKey: 'irrelevant-fetch-stubbed', geminiApiKey: undefined,
    });
  } finally {
    global.fetch = originalFetch;
  }

  if (fetchCallCount !== 1) {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — fetchCallCount=${fetchCallCount} ≠ 1`);
  }
  if (!resolved.guardFinal || resolved.guardFinal.ok !== true) {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — guardFinal.ok≠true: ${JSON.stringify(resolved.guardFinal)}`);
  }
  const cpuRecord = resolved.audit.adjustments.find((a) => a.category === 'cpu');
  if (!cpuRecord || cpuRecord.applied !== true || cpuRecord.fromLetter !== 'B' || cpuRecord.toLetter !== 'C') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — تعديل cpu لم يُقبَل كالمتوقَّع (B→C): ${JSON.stringify(cpuRecord)}`);
  }
  if (resolved.display.categories.cpu.letterSource !== 'LLM_ADJUSTED' || resolved.display.categories.cpu.letter !== 'C') {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: توقّف — display.categories.cpu غير كما هو متوقَّع: ${JSON.stringify(resolved.display.categories.cpu)}`);
  }

  const aiResult = resolved.display;
  const rawDeviceModel = fingerprint.device?.model || 'Unknown';
  const deviceMarketingName = aiResult.deviceMarketingName || rawDeviceModel;
  const isFreeTrial = false;
  aiResult.isFreeTrial = isFreeTrial;
  const shortId = (typeof aiResult.shortId === 'string' && aiResult.shortId) ? aiResult.shortId : generateShortId();
  const aiModel = resolved.aiModel;
  const aiResponseToSave = buildV7ResponseForStorage(aiResult);

  const tsHeader = (fingerprint.timeSeries && fingerprint.timeSeries.header) || {};
  const tsFooter = (fingerprint.timeSeries && fingerprint.timeSeries.footer) || {};
  const rawFpSha = tsHeader.deviceFingerprint;
  const deviceFingerprintSha = (typeof rawFpSha === 'string' && rawFpSha.trim() !== '') ? rawFpSha : null;
  const timeSeriesStoragePath = deviceFingerprintSha ? `scans/${deviceFingerprintSha}/${SCAN_ID}.ts.json.gz` : null;
  const fieldsVersion = (typeof tsFooter.fieldsVersion === 'number' && isFinite(tsFooter.fieldsVersion)) ? tsFooter.fieldsVersion : null;
  const rawAppVersion = tsHeader.appVersion;
  const appVersion = (typeof rawAppVersion === 'string' && rawAppVersion.trim() !== '') ? rawAppVersion : null;
  const serverSamplesStoragePath = computeServerSamplesStoragePath(SCAN_ID);
  const serverSamplesRaw = fingerprint.timeSeries && fingerprint.timeSeries.samples;
  const serverSamplesSaved = Array.isArray(serverSamplesRaw) && serverSamplesRaw.length > 0;

  if (aiResponseToSave.pipeline !== V7_PIPELINE_TAG) {
    throw new Error(`generate-v7-reports-document-sample-cpu-c06-downgrade: pipeline="${aiResponseToSave.pipeline}" ≠ "${V7_PIPELINE_TAG}" — توقّف`);
  }

  const p = {
    userId: USERID_PLACEHOLDER,
    rawDeviceModel, deviceMarketingName, deviceFingerprintSha, timeSeriesStoragePath,
    fieldsVersion, appVersion, fingerprint,
    aiResponseToSave, aiResultAudit: resolved.audit,
    aiModel, aiDurationMs: resolved.duration, aiFallbackReason: null,
    pipeline: aiResponseToSave.pipeline, aiResult,
    language: 'ar', isSessionScan: false, sessionId: null,
    shortId, isFreeTrial, analyzedAtMs: ANALYZED_AT_MS,
    serverSamplesStoragePath, serverSamplesSaved,
    v5Metrics: {
      bodyBuildMs: resolved.bodyBuildMs ?? null, cacheHit: false, cacheReason: 'first_scan',
      v7GuardOk: resolved.guardFinal.ok,
    },
  };

  const reportDocument = buildReportDocument(p);
  // V8 نقل الخامّ (2026-10-09): الخامّ في مستند reportRaw/{scanId} لا في المستند المقروء — نفس p، نفس السلسلة
  // الحقيقية (buildReportRawDocument)، العيّنة الذهبية الشقيقة لعيّنة المستند (القاعدة 39).
  const rawDocument = buildReportRawDocument({...p, scanId: SCAN_ID, createdAt: SERVER_TIMESTAMP_MARKER});
  if (reportDocument.createdAt !== SERVER_TIMESTAMP_MARKER) {
    throw new Error('generate-v7-reports-document-sample-cpu-c06-downgrade: createdAt ليس SERVER_TIMESTAMP_MARKER — توقّف');
  }

  return {reportDocument, rawDocument, resolved, c06Index};
}

async function main() {
  const {reportDocument, rawDocument, resolved, c06Index} = await buildReportsDocumentSampleCpuC06Downgrade();

  fs.writeFileSync(DEST_FILE, JSON.stringify(reportDocument, null, 2) + '\n', 'utf8');
  fs.writeFileSync(RAW_DEST_FILE, JSON.stringify(rawDocument, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`المُدخل: b45c8cf6.ts.json (S10) + functionalResults-by-scanid.json[${SCAN_ID}] مُعدَّلاً (C-06: pass→fail) + ${FAKE_RESPONSE_FILE} (ردّ مصنوع)`);
  console.log(`fetchCallCount=1، guardFinal.ok=${resolved.guardFinal.ok}`);
  console.log('');
  console.log('=== cpu — قبل/بعد ===');
  console.log(`audit.adjustments[cpu]: ${JSON.stringify(resolved.audit.adjustments.find((a) => a.category === 'cpu'))}`);
  console.log(`display.categories.cpu: ${JSON.stringify(reportDocument.aiResponse.categories.cpu, null, 2)}`);
  console.log('');
  console.log(`evidenceRefs الحقيقي: categoryStates.testResults[${c06Index}].outcome (C-06 بعد تعديل المدخل، outcome=FAIL)`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
}

module.exports = {buildReportsDocumentSampleCpuC06Downgrade, DEST_FILE, RAW_DEST_FILE, USERID_PLACEHOLDER, SCAN_ID, FAKE_RESPONSE_FILE, MODIFIED_TEST_ID};
