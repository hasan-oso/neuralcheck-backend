#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-reports-document-sample — يبني عيّنة واحدة من مستند
// `reports/{scanId}` الفعلي الذي يكتبه `analyzeDevice.js` على فرع V7
// (`buildReportDocument`)، من نفس مُدخلات المخزون التي يستهلكها
// `generate-v7-client-payload-sample.js` — **صفر نداء نموذج، صفر Firestore**.
// ===================================================================
//
// الغرض (أمر مستخدم 2026-09-24 +03، القرار ٧٥، البند ٢-أ): قرّاء V7 في
// `wepsite` بُنوا واختُبروا على عيّنة ردّ `analyzeDevice` (شكل الإرجاع
// للتطبيق) — ولا تستقبل أيّ صفحة هذا الشكل بعينه؛ صفحات الموقع تقرأ مستند
// `reports/{scanId}` مباشرة (§٤/٨ في docs/V7_DISPLAY_SHAPE_CONTRACT.md).
// هذا السكربت يسدّ تلك الفجوة: عيّنة ذهبية لِـ*شكل المستند نفسه*، لا شكل
// الإرجاع.
//
// ─── المسار المُطبَّق هنا حرفياً ───────────────────────────────────────
//   1. buildClientPayloadSample() (generate-v7-client-payload-sample.js)
//      — نفس خط الأنابيب الكامل (findings→categoryStates→applyV7Adjustments
//      →buildDisplayShapeV7→buildV7ResponseForStorage) على نفس مُدخلات
//      `34dff2b8` الحقيقية. يُستهلَك هنا لا يُعاد بناؤه (القاعدة 24 —
//      مصدر واحد؛ راجع تعليق الإضافة في رأس ذلك الملفّ أسفل buildClientPayloadSample).
//   2. buildReportDocument(p) (analyzeDevice.js، مُصدَّرة — استُخرجت في
//      نفس هذه المهمّة، الجزء أ، الالتزام 01c5aac): دالّة نقيّة، نفس
//      الكائن الحرفي الذي يُكتب فعلياً إلى `reportRef.set(...)` —
//      لا نسخة موازية.
//
// ─── مصدر كل حقل في `p` (مُمرَّر إلى buildReportDocument) ──────────────
//
//   حقول حقيقية من نفس مُدخلات `34dff2b8` (لا اختراع، لا Firestore):
//     rawDeviceModel        — `fingerprint.device?.model || 'Unknown'`
//                              (analyzeDevice.js:515 نفسه). fingerprint هنا
//                              بلا مفتاح `device` (مطابق لـ
//                              measure-callAIv7-live.js:99-103 — راجع رأس
//                              generate-v7-client-payload-sample.js) →
//                              يسقط دائماً إلى 'Unknown'، ليس افتراضاً معزولاً.
//     deviceMarketingName   — `clientPayload.deviceMarketingName` (نفس
//                              القيمة المحسوبة فعلياً في analyzeDevice.js:387،
//                              مُعادة من buildClientPayloadSample عبر
//                              V7_OPERATIONAL_FIELDS).
//     fieldsVersion         — `fingerprint.timeSeries.footer.fieldsVersion`
//                              (analyzeDevice.js:535-539 حرفياً) — **67**،
//                              رقم حقيقي في 34dff2b8.ts.json:footer.fieldsVersion،
//                              لا Firestore.
//     appVersion            — `fingerprint.timeSeries.header.appVersion`
//                              (analyzeDevice.js:540-544 حرفياً) —
//                              "1.0.8-v6beta"، حقيقي في نفس الفخّ.
//     fingerprint           — الكائن نفسه المُعاد من buildClientPayloadSample
//                              (`{timeSeries: raw, functionalResults,
//                              manualResults: []}`) — نفس ما يُمرَّر فعلياً
//                              لـ`lightenFingerprintForStorage` في
//                              analyzeDevice.js.
//     aiResponseToSave      — من buildClientPayloadSample (نفس الكائن الذي
//                              يُكتب فعلياً تحت `aiResponse`).
//     aiResultAudit         — `audit` من buildClientPayloadSample، مطابق
//                              لـ`v7Result.audit` (runAnalysisInternal.js:393)
//                              — ⚠️ **ناقص حقل واحد موثَّق**: `audit` هنا من
//                              `buildDisplayShapeV7` وحدها؛ المسار الحيّ
//                              يمرّ عبر `resolveV7Report.js` الذي يضيف
//                              `regeneration{attempts,narrativeIncomplete,
//                              droppedFields,rounds}` فوقه (runAnalysisInternal.js:378-386)
//                              — غائب هنا بحكم نفس القيد الصريح في رأس
//                              generate-v7-client-payload-sample.js
//                              ("لا استدعاء لـresolveV7Report.js")، لا عطب.
//     aiModel               — `clientPayload.aiModel` (= `live.model`،
//                              "deepseek-flash"، نداء حقيقي سابق مأذون).
//     aiDurationMs          — `live.durationMs` (126146، من نفس نداء
//                              DeepSeek الحقيقي — v7-live-*.json:durationMs).
//     aiFallbackReason      — `null` (حرفي، يطابق مسار النجاح
//                              runAnalysisInternal.js:398 `aiFallbackReason: null`
//                              حين `aiFailed=false` — هذه عيّنة نجاح).
//     pipeline              — `clientPayload.pipeline` (= V7_PIPELINE_TAG).
//     aiResult              — من buildClientPayloadSample (`display` بعد
//                              مطابقة `isFreeTrial`/`shortId`) — **غير
//                              مقروء فعلياً** على فرع V7 داخل
//                              buildReportDocument (الفرع الشرطي
//                              `pipeline === V7_PIPELINE_TAG ? {} : {grade,score}`
//                              يُسقِط أيّ قراءة لـ`p.aiResult` هنا) — يُمرَّر
//                              مع ذلك بقيمته الحقيقية لا بقيمة بديلة، توثيقاً
//                              لا حاجة وظيفية.
//     language              — `clientPayload.language` (= 'ar').
//     shortId               — `clientPayload.shortId` (generateShortId()
//                              حقيقية، عشوائية بتصميمها — الحارس في البند ج
//                              يستثنيها من المطابقة، بنفس نمط
//                              v7ClientPayloadContractGuard.test.js).
//     isFreeTrial           — `clientPayload.isFreeTrial` (= false، نفس
//                              القيمة التي بُني بها userMessage المصدر).
//
//   حقول افتراض حقيقي (القيمة نفسها التي يبدأ بها الكود قبل أي جلسة/بروفايل
//   قائم — ليست Firestore، ولا مُخترَعة، بل نفس ثابت البداية في الكود):
//     isSessionScan         — `false` (analyzeDevice.js:297 `let isSessionScan
//                              = false;` — القيمة قبل أي تحقّق `sessionId`).
//                              الأثر الوحيد على المستند: `sessionId` يُكتب
//                              `null` بصرف النظر عن أي قيمة أخرى (buildReportDocument:
//                              `sessionId: p.isSessionScan ? p.sessionId : null`)
//                              — فـ`p.sessionId` نفسها لا تصل المستند أبداً هنا.
//     v5Metrics.cacheReason — `'first_scan'` (runAnalysisInternal.js:106
//                              `let cacheReason = "first_scan";` — القيمة
//                              الافتراضية قبل أي فحص profile/cache، تطابق
//                              عدم وجود existingProfile في هذا البناء).
//     v5Metrics.bodyBuildMs — `null` (`v7Result.bodyBuildMs ?? null` —
//                              resolveV7Report.js غير مُستدعاة هنا (القيد
//                              أعلاه) فلا قياس فعلي؛ `null` هو نفس ما ينتجه
//                              الكود عند غياب القياس، لا بديل مُخترَع).
//     v5Metrics.v7GuardOk   — `live.guard.ok` (= false على هذا الالتقاط
//                              تحديداً — موثَّق في رأس generate-v7-client-payload-sample.js).
//
//   ⚠️ **الحقل الوحيد المُخترَع فعلياً — علامة مسمّاة مُجمَّدة، لا قيمة**:
//     userId — لا مصدر له في أي فخّ مخزون (لا Firestore Auth حقيقي هنا).
//              `USERID_PLACEHOLDER` (مُعرَّف أدناه، `Object.freeze`) — بنفس
//              أسلوب `SERVER_TIMESTAMP_MARKER` (analyzeDevice.js) القائم
//              فعلاً في `buildReportDocument` نفسها لحقل `createdAt` (لا
//              نداء جديد، الدالّة تُعيده كما هو).
//
//   ⚠️ **فرق موثَّق عن نصّ أمر المهمّة (القاعدة 14 — توقّفت عن التنفيذ
//   الحرفي لهذا الجزء تحديداً وأبلغ، لا نفّذت ضمناً)**: نصّ الأمر عدّد
//   `deviceFingerprintSha` و"مسار Storage" (timeSeriesStoragePath) ضمن
//   "ما لا يُعرف دون Firestore" ويطلب علامة مسمّاة لهما. **الكود يناقض
//   هذا**: analyzeDevice.js:521-528 يشتقّهما حرفياً من
//   `fingerprint.timeSeries.header.deviceFingerprint` (البصمة الخام في
//   ترويسة السلسلة الزمنية نفسها، لا من أي قراءة Firestore) ثم تركيب
//   نصّي بسيط مع `scanId` — كلاهما حاضر فعلياً وحقيقي في نفس فخّ
//   `34dff2b8.ts.json` المُلتزَم أصلاً في هذا المستودع (لا معلومة جديدة
//   تُكشَف، القيمة كانت مقروءة للعامة أصلاً). استبدالهما بعلامة كان
//   سيُدخل بيانات غير حقيقية في عيّنة الغرض المُعلَن منها صراحة "توليد من
//   السلسلة الحقيقية" (نصّ القرار ٧٥) — فاستُعملت القيمة المُشتقّة الحقيقية
//   بدل العلامة لهذين الحقلين تحديداً:
//     deviceFingerprintSha  — `fingerprint.timeSeries.header.deviceFingerprint`
//                              (تحقّق: 34dff2b8.ts.json:header.deviceFingerprint).
//                              ⚠️ القرار ٨٢ البند ٢ (2026-09-24 +03): القيمة
//                              الحقيقية التي وُثِّقت هنا وقت كتابة هذا
//                              التعليق استُبدلت لاحقاً في 34dff2b8.ts.json
//                              بقيمة سداسية عشرية من الشكل نفسه (64 خانة) —
//                              لا قيمة حقيقية باقية في هذا التعليق أو الملفّ.
//     timeSeriesStoragePath — `scans/${deviceFingerprintSha}/${SCAN_ID}.ts.json.gz`
//                              (analyzeDevice.js:526-528 حرفياً).
//   `userId`/`sessionId` (الاثنان الباقيان في تعداد النصّ) **بلا** هذا
//   التناقض — لا مصدر لهما في أي فخّ هنا فعلاً؛ عولجا كما طلب النصّ
//   (`userId`→علامة، `sessionId`→moot عبر isSessionScan=false أعلاه).
//
// Run: node functions/scripts/generate-v7-reports-document-sample.js
// ===================================================================

const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin — نفس نمط generate-v7-client-payload-sample.js.
// analyzeDevice.js يستورد admin عند require حتى بلا نداء exports.analyzeDevice.
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-reports-document-sample: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {buildClientPayloadSample} = require('./generate-v7-client-payload-sample');
const {buildReportDocument, SERVER_TIMESTAMP_MARKER} = require('../src/analysis/analyzeDevice');
const {buildReportRawDocument} = require('../src/analysis/reportRawStore');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
// القرار ٨٦ البند ٢ — دالّة نقيّة (بلا I/O)، مصدر واحد لصيغة المسار
// (القاعدة 24) — لا يُعاد كتابتها هنا يدوياً.
const {computeServerSamplesStoragePath} = require('../src/analysis/serverRawSamplesStorage');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
// القرار ٨٢ البند ٢ (2026-09-24 +03): استُبدل بقيمة من الشكل نفسه (UUID) —
// كانت '34dff2b8-ce9e-4b40-86a9-1976c878e195' (سكانId حقيقي، هو نفسه بادئة
// اسم ملفّ الفخّ 34dff2b8.ts.json — الاسم لا يُعاد تسميته هذه الجولة، القيمة
// الداخلية وحدها استُبدلت). يجب أن يطابق header.scanId المُستبدَل فعلياً في
// 34dff2b8.ts.json كي يبقى rawFingerprint.timeSeries.header.scanId
// وtimeSeriesStoragePath متّسقين داخل نفس المستند.
const SCAN_ID = 'bcab2f02-a4a3-45e0-831e-190bb2c1a0a4';
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-reports-document-sample.json');
const RAW_DEST_FILE = path.join(GOLDEN_DIR, 'v7-report-raw-sample.json');

// العلامة المسمّاة الوحيدة المُخترَعة فعلياً في هذه العيّنة — راجع تعليق
// رأس الملفّ ("الحقل الوحيد المُخترَع فعلياً"). لا تُقرأ في أي مسار داخل
// buildV7Response (verifyReport.js) — مُتحقَّق: `grep -n "rep.userId"
// src/reports/verifyReport.js` صفر نتيجة، فهذه العلامة لا تتسرّب إلى عيّنة
// البند ب.
const USERID_PLACEHOLDER = Object.freeze({__marker: 'NOT_FROM_FIRESTORE_OR_AUTH_USERID'});

/**
 * يبني مستند reports/{scanId} الكامل لعيّنة V7 — في الذاكرة فقط، بلا كتابة.
 * @return {{reportDocument: Object, clientPayload: Object, audit: Object, live: Object}}
 */
function buildReportsDocumentSample() {
  const {clientPayload, audit, live, aiResponseToSave, aiResult, fingerprint, analyzedAtMs} = buildClientPayloadSample();

  if (clientPayload.pipeline !== V7_PIPELINE_TAG) {
    throw new Error(`generate-v7-reports-document-sample: clientPayload.pipeline="${clientPayload.pipeline}" ≠ "${V7_PIPELINE_TAG}" — توقّف، لا افتراض`);
  }

  const tsHeader = (fingerprint.timeSeries && fingerprint.timeSeries.header) || {};
  const tsFooter = (fingerprint.timeSeries && fingerprint.timeSeries.footer) || {};

  // نفس اشتقاق analyzeDevice.js:521-528 حرفياً — راجع "فرق موثَّق" في رأس الملفّ.
  const rawFpSha = tsHeader.deviceFingerprint;
  const deviceFingerprintSha = (typeof rawFpSha === 'string' && rawFpSha.trim() !== '') ? rawFpSha : null;
  const timeSeriesStoragePath = deviceFingerprintSha ?
      `scans/${deviceFingerprintSha}/${SCAN_ID}.ts.json.gz` :
      null;

  // نفس اشتقاق analyzeDevice.js:535-544 حرفياً.
  const fieldsVersion = (typeof tsFooter.fieldsVersion === 'number' && isFinite(tsFooter.fieldsVersion)) ?
      tsFooter.fieldsVersion :
      null;
  const rawAppVersion = tsHeader.appVersion;
  const appVersion = (typeof rawAppVersion === 'string' && rawAppVersion.trim() !== '') ? rawAppVersion : null;

  const rawDeviceModel = fingerprint.device?.model || 'Unknown'; // analyzeDevice.js:515 نفسه

  // القرار ٨٦ البند ٢ — لا Storage حقيقي هنا (القيد الصريح أعلى الملفّ:
  // "صفر نداء نموذج، صفر Firestore" يمتدّ إلى صفر Storage بنفس المنطق).
  // المسار محسوب فعلياً بالدالّة النقيّة المُصدَّرة (لا نصّاً حرفياً
  // مكرَّراً)؛ `saved` مُشتقّة حقيقياً من وجود samples فعلية في نفس فخّ
  // 34dff2b8 (لا قيمة مُخترَعة) — samples حاضرة هنا (raw.samples من
  // 34dff2b8.ts.json، يُستهلَك أصلاً في buildClientPayloadSample→
  // sampleInputsFromRaw لحساب البطارية)، فحفظ حقيقي كان سينجح.
  const serverSamplesStoragePath = computeServerSamplesStoragePath(SCAN_ID);
  const serverSamplesRaw = fingerprint.timeSeries && fingerprint.timeSeries.samples;
  const serverSamplesSaved = Array.isArray(serverSamplesRaw) && serverSamplesRaw.length > 0;

  const p = {
    userId: USERID_PLACEHOLDER,
    rawDeviceModel,
    deviceMarketingName: clientPayload.deviceMarketingName,
    deviceFingerprintSha,
    timeSeriesStoragePath,
    fieldsVersion,
    appVersion,
    fingerprint,
    aiResponseToSave,
    aiResultAudit: audit,
    aiModel: clientPayload.aiModel,
    aiDurationMs: live.durationMs,
    aiFallbackReason: null,
    pipeline: clientPayload.pipeline,
    aiResult,
    language: clientPayload.language,
    isSessionScan: false,
    sessionId: null, // moot — راجع "isSessionScan" في رأس الملفّ
    shortId: clientPayload.shortId,
    isFreeTrial: clientPayload.isFreeTrial,
    // القرار ٧٥ البند ٤ (2026-09-24 +03) — نفس ANALYZED_AT_MS الثابتة
    // المُستهلَكة أصلاً داخل buildClientPayloadSample() لبناء categoryStates
    // (PATCH_AGE) — مصدر واحد لا نسخة موازية (القاعدة 24)، مُعاد هنا عبر
    // إعادة تصدير buildClientPayloadSample.
    analyzedAtMs,
    serverSamplesStoragePath,
    serverSamplesSaved,
    v5Metrics: {
      bodyBuildMs: null,
      cacheHit: false,
      cacheReason: 'first_scan',
      v7GuardOk: (live.guard && typeof live.guard.ok === 'boolean') ? live.guard.ok : null,
    },
  };

  const reportDocument = buildReportDocument(p);
  // V8 نقل الخامّ (2026-10-09): الخامّ في مستند reportRaw/{scanId} لا في المستند المقروء — نفس p، نفس السلسلة
  // الحقيقية (buildReportRawDocument)، العيّنة الذهبية الشقيقة لعيّنة المستند (القاعدة 39).
  const rawDocument = buildReportRawDocument({...p, scanId: SCAN_ID, createdAt: SERVER_TIMESTAMP_MARKER});
  // مطابقة تماماً لِما يفعله analyzeDevice.js:572 قبل reportRef.set — العلامة
  // نفسها تبقى (لا نداء Firestore هنا)، لكن نتحقّق أن buildReportDocument
  // فعلاً أعادتها كما هي (دفاع في العمق، لا حاجة وظيفية).
  if (reportDocument.createdAt !== SERVER_TIMESTAMP_MARKER) {
    throw new Error('generate-v7-reports-document-sample: createdAt ليس SERVER_TIMESTAMP_MARKER — توقّف');
  }

  return {reportDocument, rawDocument, clientPayload, audit, live};
}

function main() {
  const {reportDocument, rawDocument} = buildReportsDocumentSample();

  fs.writeFileSync(DEST_FILE, JSON.stringify(reportDocument, null, 2) + '\n', 'utf8');
  fs.writeFileSync(RAW_DEST_FILE, JSON.stringify(rawDocument, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`كُتبت عيّنة الخامّ إلى: ${RAW_DEST_FILE}`);
  console.log('');
  console.log('=== جدول الحقول أعلى مستوى ===');
  for (const k of Object.keys(reportDocument)) {
    const v = reportDocument[k];
    const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
    const example = (t === 'object' && v !== null) ? '{…}' : JSON.stringify(v);
    console.log(`${k}\t${t}\t${example}`);
  }
  console.log('');
  console.log(`userId (علامة مسمّاة): ${JSON.stringify(reportDocument.userId)}`);
  console.log(`deviceFingerprintSha (حقيقي، لا Firestore، في reportRaw): ${rawDocument.deviceFingerprintSha}`);
  console.log(`timeSeriesStoragePath (مُشتقّ، في reportRaw): ${rawDocument.timeSeriesStoragePath}`);
  console.log(`fieldsVersion: ${reportDocument.fieldsVersion}  appVersion: ${reportDocument.appVersion}`);
  console.log(`createdAt (علامة): ${JSON.stringify(reportDocument.createdAt)}`);
  console.log(`aiDurationMs: ${reportDocument.aiDurationMs}`);
  console.log(`v5Metrics: ${JSON.stringify(reportDocument.v5Metrics)}`);
}

if (require.main === module) {
  main();
}

module.exports = {buildReportsDocumentSample, DEST_FILE, RAW_DEST_FILE, USERID_PLACEHOLDER};
