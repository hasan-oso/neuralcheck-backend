#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-reports-document-sample-security-downgrade — يبني مستند
// reports/{scanId} حقيقي فعلاً لحالة تخفيض مقبول فعلياً بدليل — عبر
// السلسلة الحقيقية الكاملة (resolveV7Report → applyV7Adjustments →
// buildDisplayShapeV7 → buildReportDocument)، لا استدعاء يدوي مبتور
// لأجزائها.
// ===================================================================
//
// ⚠️ **تحديث 2026-09-25 +03 (القرار ٩٨ البند ١)** — هذه العيّنة كانت
// LLM_ADJUSTED (القرار ٩٥-٣) حتى صدور القرار ٩٨-١: "letterSource =
// LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن الحرف الحتمي." security
// أصلاً D (أرضية STATE_FAIL_FLOOR) فتوقّف "مقبول بلا أثر"
// (ADJUSTMENT_ACCEPTED_NO_EFFECT) لا LLM_ADJUSTED — letterSource صار
// DETERMINISTIC هنا **بقرار المستخدم صريح**: "وتبقى عيّنةً على هذه
// القاعدة." عيّنة LLM_ADJUSTED الحقيقية (حرف يتغيّر فعلاً) في القرار ٩٨
// البند ٢.
//
// الغرض (القرار ٩٥ البند ٣، نصّ المستخدم حرفياً 2026-09-25 +03): بعد
// القرار ٩٤ البند ١ (لا حرف/حالة فئة/بوّابة دليلاً — FAIL داخل الفئة
// وحدها) صار **صفر عيّنة ذهبية** تحمل letterSource="LLM_ADJUSTED" أو
// تعديلاً applied=true (مُتحقَّق فعلياً — راجع
// functions/scripts/audit-golden-applied-llm-adjustments.js ومخرَجه
// المُلتزَم في تقرير تلك المهمّة). "تُولَّد عيّنة عبر السلسلة الحقيقية، من
// مدخل حقيقي هو فخّ S10، ومن ردّ نموذج مصنوع يطلب تخفيض فئة بدليل نتيجة
// FAIL لاختبار داخلها، ومثال ذلك SEC-04 في security. الكود الحقيقي هو
// الذي يقبل التخفيض ويكتب المستند (applyV7Adjustments وbuildReportDocument)."
// "والشكل هنا حقيقي لأن الكود أنتجه، والمصنوع هو محتوى الردّ وحده."
//
// ─── ما هو مصنوع بالضبط، وما هو حقيقي (بالضبط كالتحذير أعلاه) ───────────
// **حقيقي**: fingerprint/findings/categoryStates من فِخّ b45c8cf6 (S10)
// الحقيقي (نفس فِخّ applyV7AdjustmentsWiring.test.js حرفياً) — لا رقم
// مُختلَق. الدليل evidenceRefs يشير إلى `categoryStates.testResults[61].outcome`
// — نتيجة SEC-04 الحقيقية (outcome=FAIL فعلياً على هذا الفحص، مُتحقَّق
// دفاعياً أدناه قبل أي بناء — لا افتراض أن الفهرس ما زال صحيحاً). السلسلة
// الكاملة (resolveV7Report/applyV7Adjustments/buildDisplayShapeV7/
// buildReportDocument) حقيقية بلا استبدال — **لا يُستبدَل هنا إلا
// global.fetch** (القاعدة 37، نفس نمط applyV7AdjustmentsWiring.test.js).
// **مصنوع**: محتوى ردّ النموذج نفسه — لم يُستدعَ أي مزوّد فعلياً؛
// `global.fetch` يُعيد envelope مُجمَّداً في
// functions/test/fixtures/frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json
// (ملفّ منفصل، خارج golden/، اسمه يُعلن أنه مصنوع، وبياناته الوصفية
// `_provenance.kind="FAKE_MODEL_RESPONSE"` تُعلن ذلك أيضاً — لا طيّ).
// ذلك الملفّ نفسه مُشتقّ من ردّ حقيقي مُلتقَط سابقاً
// (frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json) بتعديل
// عنصر adjustments[1] الوحيد (كان gpu بأربعة مراجع findings، صار security
// بمرجع testResults حقيقي واحد) — بقيّة الردّ (narrative/crossChecks/
// modelObservations/adjustments[0]=cpu) حرفية من الأصل بلا مساس.
//
// ─── التحقّق من مطابقة شكل الردّ المصنوع لما يُنتجه النموذج فعلاً ────────
// القيد الصريح: "ردّ النموذج المصنوع يطابق صيغة ما يُنتجه النموذج فعلاً،
// ويُتحقَّق من ذلك بالحارس نفسه (guardFinal.ok===true)." — الحارس هنا هو
// **نفس حارس الإنتاج** (reportShapeV7.js عبر callAIv7 داخل resolveV7Report،
// لا حارس مبسَّط) — التحقّق الدفاعي أدناه يرمي إن لم يمرّ guardFinal.ok
// فعلاً، فلا يُكتَب ملفّ من ردّ كان سيُرفَض في الإنتاج الحقيقي.
//
// Run: node functions/scripts/generate-v7-reports-document-sample-security-downgrade.js
// ===================================================================

const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin — نفس نمط كل مولّدات V7 الشقيقة ────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-reports-document-sample-security-downgrade: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {ADJUSTMENT_ACCEPTED_NO_EFFECT} = require('../src/analysis/buildV7Payload');
const {buildReportDocument, buildV7ResponseForStorage, SERVER_TIMESTAMP_MARKER} = require('../src/analysis/analyzeDevice');
const {buildReportRawDocument} = require('../src/analysis/reportRawStore');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {V7_OPERATIONAL_FIELDS} = require('../src/analysis/v7OperationalFields');
const {computeServerSamplesStoragePath} = require('../src/analysis/serverRawSamplesStorage');
const {generateShortId} = require('../src/utils/generateShortId');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');
const SCAN_ID = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
const FAKE_RESPONSE_FILE = 'frozen-fake-model-response-security-down-sec04-fail-2026-09-25.json';
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-reports-document-sample-security-downgrade.json');
const RAW_DEST_FILE = path.join(GOLDEN_DIR, 'v7-report-raw-sample-security-downgrade.json');
const USERID_PLACEHOLDER = Object.freeze({__marker: 'NOT_FROM_FIRESTORE_OR_AUTH_USERID'});
// نفس قيمة generate-v7-client-payload-sample.js (موسومة، ليست Date.now())
// — "وقت خادم حقيقي متاح"، لا UNKNOWN زوراً على بوّابة PATCH_AGE.
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

/**
 * يبني مستند reports/{scanId} كاملاً — عبر resolveV7Report الحقيقية
 * (global.fetch وحده مُستبدَل)، ثم buildReportDocument الحقيقية. في
 * الذاكرة فقط، بلا كتابة.
 * @return {Promise<{reportDocument: Object, resolved: Object, fingerprint: Object}>}
 */
async function buildReportsDocumentSampleSecurityDowngrade() {
  const raw = loadJson(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functionalResults = frMap[SCAN_ID];
  if (!Array.isArray(functionalResults)) {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: لا functionalResults لِـ ${SCAN_ID}`);
  }

  // fingerprint — مطابق حرفياً لـ applyV7AdjustmentsWiring.test.js (نفس الفخّ).
  const fingerprint = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults, manualResults: []};
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults, manualResults: [], dev: null, findings,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
    analyzedAtMs: ANALYZED_AT_MS,
  });

  // ─── تحقّق دفاعي قبل أي بناء (القاعدة 16/22) — الدليل الحقيقي المتوقَّع
  // (SEC-04.outcome=FAIL، فئتها security) لا يزال كما هو. الفهرس نفسه
  // (61) مُثبَّت في الردّ المصنوع المُلتزَم أدناه — إن تغيّر هذا الفحص
  // الحقيقي مستقبلاً (تعديل على b45c8cf6.ts.json أو منطق التصنيف) يتوقّف
  // هذا المولّد بصوت عالٍ بدل عيّنة مضلِّلة صامتة.
  const sec04Index = categoryStates.testResults.findIndex((t) => t.testId === 'SEC-04');
  if (sec04Index < 0 || categoryStates.testResults[sec04Index].outcome !== 'FAIL' ||
      categoryStates.testResults[sec04Index].category !== 'security') {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — الدليل الحقيقي المتوقَّع (SEC-04.outcome=FAIL، فئة security) لم يعد كما هو. sec04Index=${sec04Index}, testResult=${JSON.stringify(categoryStates.testResults[sec04Index])}`);
  }

  const fakeResponseWrapper = loadJson(path.join(FIXTURES_DIR, FAKE_RESPONSE_FILE));
  if (!fakeResponseWrapper._provenance || fakeResponseWrapper._provenance.kind !== 'FAKE_MODEL_RESPONSE — ردّ نموذج مصنوع، لا نداء نموذج فعلي') {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — ${FAKE_RESPONSE_FILE} غير موسوم كردّ مصنوع كما هو متوقَّع`);
  }
  const expectedEvidenceRef = `categoryStates.testResults[${sec04Index}].outcome`;
  const fakeContent = JSON.parse(fakeResponseWrapper.rawEnvelope.choices[0].message.content);
  const securityAdj = fakeContent.adjustments.find((a) => a.category === 'security');
  if (!securityAdj || securityAdj.evidenceRefs[0] !== expectedEvidenceRef) {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — الردّ المصنوع لا يستشهد بالفهرس الحقيقي المتوقَّع (${expectedEvidenceRef})، وجد: ${JSON.stringify(securityAdj)}`);
  }

  // ─── global.fetch وحده يُستبدَل (القاعدة 37) — كل شيء آخر حقيقي ─────────
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

  // ─── التحقّق المطلوب صراحةً: الردّ المصنوع اجتاز حارس الإنتاج نفسه ──────
  if (fetchCallCount !== 1) {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — fetchCallCount=${fetchCallCount} ≠ 1 (كان يجب أن يُقبَل من المحاولة الأولى، لا رفض شكلي يستهلك محاولة ثانية)`);
  }
  if (!resolved.guardFinal || resolved.guardFinal.ok !== true) {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — guardFinal.ok≠true: ${JSON.stringify(resolved.guardFinal)}`);
  }
  // ⚠️ تحديث 2026-09-25 +03 (القرار ٩٨ البند ١، نصّ المستخدم حرفياً):
  // "letterSource = LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن الحرف
  // الحتمي... التخفيض المقبول الذي لا يغيّر الحرف... «مقبول بلا أثر»،
  // ويبقى letterSource = DETERMINISTIC." security أصلاً D (أرضية
  // STATE_FAIL_FLOOR على هذا الفحص) — فهذه العيّنة **بقرار المستخدم**
  // تبقى مثالاً على "مقبول بلا أثر" لا LLM_ADJUSTED (القرار ٩٥-٣ سمّاها
  // العيّنة الأولى؛ القرار ٩٨-٢ يضيف عيّنة ثانية بحرف يتغيّر فعلاً).
  const securityRecord = resolved.audit.adjustments.find((a) => a.category === 'security');
  if (!securityRecord || securityRecord.applied !== true || securityRecord.noEffectReason !== ADJUSTMENT_ACCEPTED_NO_EFFECT) {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — تعديل security لم يُسجَّل "مقبولاً بلا أثر" كما هو متوقَّع: ${JSON.stringify(securityRecord)}`);
  }
  if (resolved.display.categories.security.letterSource !== 'DETERMINISTIC') {
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: توقّف — display.categories.security.letterSource≠DETERMINISTIC: ${JSON.stringify(resolved.display.categories.security)}`);
  }

  // ─── من هنا فصاعداً: نفس تذييل analyzeDevice.js (376-644) حرفياً ────────
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
    throw new Error(`generate-v7-reports-document-sample-security-downgrade: pipeline="${aiResponseToSave.pipeline}" ≠ "${V7_PIPELINE_TAG}" — توقّف`);
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
    throw new Error('generate-v7-reports-document-sample-security-downgrade: createdAt ليس SERVER_TIMESTAMP_MARKER — توقّف');
  }

  return {reportDocument, rawDocument, resolved, fingerprint, sec04Index};
}

async function main() {
  const {reportDocument, rawDocument, resolved, sec04Index} = await buildReportsDocumentSampleSecurityDowngrade();

  fs.writeFileSync(DEST_FILE, JSON.stringify(reportDocument, null, 2) + '\n', 'utf8');
  fs.writeFileSync(RAW_DEST_FILE, JSON.stringify(rawDocument, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`المُدخل: b45c8cf6.ts.json (S10) + functionalResults-by-scanid.json[${SCAN_ID}] + ${FAKE_RESPONSE_FILE} (ردّ مصنوع)`);
  console.log(`fetchCallCount=1، guardFinal.ok=${resolved.guardFinal.ok}`);
  console.log('');
  console.log('=== security — قبل/بعد ===');
  console.log(`deterministicLetter: ${JSON.stringify(resolved.audit.adjustments.find((a) => a.category === 'security'))}`);
  console.log(`display.categories.security: ${JSON.stringify(reportDocument.aiResponse.categories.security, null, 2)}`);
  console.log('');
  console.log(`evidenceRefs الحقيقي: categoryStates.testResults[${sec04Index}].outcome (SEC-04، outcome=FAIL)`);
  console.log('');
  console.log(`audit.adjustments كاملة: ${JSON.stringify(resolved.audit.adjustments, null, 2)}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
}

module.exports = {buildReportsDocumentSampleSecurityDowngrade, DEST_FILE, RAW_DEST_FILE, USERID_PLACEHOLDER, SCAN_ID, FAKE_RESPONSE_FILE};
