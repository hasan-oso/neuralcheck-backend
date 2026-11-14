#!/usr/bin/env node
'use strict';

// ===================================================================
// export-v7-report-readonly — قراءة فقط. يأخذ shortId (رمز /verify
// العامّ)، يحلّه إلى scanId عبر reports.where("shortId","=="), ثم يقرأ
// مستند reports/{scanId} ومجموعة aiRawResponses/{scanId} (حيث يكتب
// الخادم ردّ النموذج الخام — writeRawAiResponses.js). يكتب كائن JSON
// واحد بترميز UTF-8 على stdout.
//
// أمر مستخدم 2026-09-30 +03 «سكربت تصدير تقرير V7 للقراءة وحدها»، على
// نمط export-v6-report-readonly.js/audit-device-profiles-readonly.js:
// نفس wrapReadOnly (يرفض أي كتابة)، نفس PROJECT_ID المثبَّت المطبوع أوّل
// حقل، نفس أسلوب الإخفاء (REDACT_DELETE_PATHS من export-v6-report-
// readonly.js، مصدر واحد — القاعدة 24) — **بفارق واحد مقصود**: shortId
// يبقى كما أُدخل (لا يُستبدَل بعلامة)، لأنه المُدخل نفسه لا سرّاً — راجع
// «الإخفاء» أدناه.
//
// ⚠️ **لا تُشغَّل من هذا الوكيل على الإنتاج** (القيد الصريح: "تكتبه ولا
// تشغّله") — المستخدم يشغّلها من طرفيّته، بتسجيل الدخول نفسه المُستعمَل في
// الجزء C، بصلاحية Admin SDK حقيقية على مشروع neuralchek-9b6d7 (قراءة
// فقط، لا حاجة لدور كتابة).
//
// ─── الإخفاء (القاعدة 36) ─────────────────────────────────────────────
// REDACT_DELETE_PATHS (مستوردة من export-v6-report-readonly.js، مصدر
// واحد): userId/sessionId/deviceFingerprintSha/timeSeriesStoragePath/
// rawFingerprint.timeSeries.header.deviceFingerprint/rawFingerprint.
// device.deviceProfileKey/rawFingerprint.timeSeries.footer.samplesSha256
// — تُحذَف كما هي، بلا تغيير.
// REDACT_REPLACE_PATHS **لا تُستعمَل هنا كما هي** — القائمة الافتراضية في
// export-v6-report-readonly.js تستبدل `shortId` نفسه بعلامة ثابتة (لأن
// ذلك السكربت يُصدِّر بمُدخل scanId، وshortId هناك بيانات إضافية مكشوفة
// عرَضاً). هنا shortId هو *المُدخل نفسه* الذي كتبه المُشغِّل على سطر
// الأوامر — إخفاؤه لا معنى له ولا يحمي شيئاً. فيُستدعى redactIdentifiers
// كما هي (تستبدل shortId مؤقّتاً)، ثم يُعاد shortId إلى قيمته الحقيقية
// صراحةً بعد الاستدعاء (redacted.shortId = shortIdInput) — يُذكر ذلك في
// المخرَج (`shortIdRetainedAsProvided: true`) بدل إسقاطه من replacedFields
// صامتاً. rawFingerprint.timeSeries.header.scanId **يُستبدَل** كالمعتاد
// (بصمة خام داخلية، لا "المُدخل"). scanId الداخلي (معرّف مستند Firestore،
// المُستعمَل لقراءة aiRawResponses) **لا يظهر في أي مكان بالمخرَج** — لا
// حقل باسمه في الغلاف أصلاً (خلافاً لـexport-v6-report-readonly.js الذي
// يستبدله بعلامة؛ هنا يُحذَف من الغلاف كلّياً لأن shortId يكفي مُعرِّفاً
// للمخرَج).
// aiRawResponses/{scanId}: الحقل الجذري `scanId` (تكرار) **لا يُنسَخ** في
// المخرَج المبنيّ يدوياً (لا حاجة لحذفه من نسخة — لم يُنسَخ أصلاً).
// attempts[].raw يُمرَّر عبر sanitizeRawText (مستوردة من
// writeRawAiResponses.js، مصدر واحد — القاعدة 24) مرّة إضافية دفاعاً في
// العمق، رغم أنها طُبِّقت مرّة عند الكتابة أصلاً.
//
// ─── «بصمة الحمولة وتاريخها» (نصّ الأمر) — مُتحقَّق بالكود لا افتراضاً ──
// aiRawResponses/{scanId} (writeRawAiResponses.js:75) يخزّن فعلياً:
// {scanId, attempts: [{attempt, raw, provider, durationMs}], writtenAt}.
// **لا بصمة (hash) للحمولة مخزَّنة مع أيّ محاولة على الإطلاق** — يُطبَع
// "NOT_STORED" صراحةً لكل محاولة (القاعدة 22)، لا صفراً ولا فراغاً.
// **التاريخ مخزَّن** على مستوى المستند (`writtenAt`، serverTimestamp) —
// يُطبَع مُهيَّأً (`.toDate().toISOString()`)؛ إن لم يكن Timestamp حقيقياً
// (اختبار بمُدخل غير Firestore) يُطبَع كما وصل مع وسم `rawShape`.
// **ملاحظة منفصلة**: مستند reports/{scanId} نفسه يحمل ثلاث "بصمات" أخرى
// كلّياً مختلفة الغرض — aiAudit.{issueSetHash,lettersHash,numbersHash}
// (buildDisplayShapeV7.js) — بصمات حتمية لحروف/أرقام categoryStates بعد
// البناء، لا بصمة "الحمولة المُرسَلة للنموذج". تُطبَع في `reportAudit`
// منفصلة بأسمائها الحقيقية، لا بديلاً عمّا سبق ولا مخلوطة به.
//
// ─── letterCeilingReason الإجمالي — تصحيح لنصّ الأمر (القاعدة 14) ─────
// نصّ الأمر يطلب "letterSource وletterCeilingReason، عامّاً ولكل فئة".
// **مُتحقَّق بالكود (buildDisplayShapeV7.js:456 مقابل :327)**:
// `overall.letterCeilingReason` **لا وجود له في الشكل الفعلي إطلاقاً** —
// الحقل الإجمالي المقابل اسمه `overall.governingGateReason` (يُبنى من
// buildGoverningGateReason، ويكون null إن لم تُطلَق بوّابة حاكمة).
// `letterCeilingReason` (حقيقي، قد يكون null حاضراً) موجود **لكل فئة
// فقط** (categories.<cat>.letterCeilingReason، :327). السكربت يطبع
// الحقلين الحقيقيّين بأسمائهما (overall.governingGateReason لكلّ التقرير،
// categories.<cat>.letterCeilingReason لكل فئة)، ويفحص أيضاً عن
// overall.letterCeilingReason احتياطاً (حالة صريحة PATH_ABSENT إن غاب،
// كما هو متوقَّع دائماً على الشكل الحالي) — لا افتراض صامت أنه موجود.
//
// ─── V8 نقل الخامّ (الجزء ٢، 2026-10-09 +03) ────────────────────────────────────────
// rawFingerprint وsessionId وdeviceFingerprintSha وtimeSeriesStoragePath وaiAudit صارت
// في reportRaw/{scanId} للتقارير الجديدة والمُرحَّلة (ومضمَّنة في تقارير لم تُرحَّل بعد).
// exportReportByShortId تقرأ الخامّ بـreadReportRaw (مصدر واحد للحالات الصريحة) وتدمجه
// في نسخة المستند قبل الإخفاء والمقارنة: فالمخرَج (الإخفاء ومقارنة الـ82 وletterInfo
// وبصمات aiAudit) واحد على الشكلين. وحالته تُطبع أعلى المخرَج (rawState)؛ وABSENT
// (لا reportRaw ولا حقول مضمَّنة) يُنتج testIdComparison بحالة RAW_ABSENT لا PATH_ABSENT
// المضلِّلة (الخامّ غائب كلّه لا مسار واحد).
//
// ─── الاختبار (القاعدة 41 من تعريف الوكيل) ─────────────────────────────
// مُدخل مشتقّ من test/fixtures/golden/v7-reports-document-sample.json
// (عيّنة V7 ذهبية حقيقية) + مستند aiRawResponses مصنوع بشكل ما يكتبه
// writeRawAiResponses.js بالضبط (نفس أسماء الحقول). Firestore مزيَّف في
// الذاكرة بالكامل — صفر شبكة.
//
// Usage (يُشغِّله المستخدم من طرفيّته فقط):
//   node functions/scripts/export-v7-report-readonly.js <shortId> > evidence/v7-report-export-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const {redactIdentifiers, scanForIdentifierLikeNames, REPLACEMENT_PLACEHOLDER} = require('./export-v6-report-readonly');
const {sanitizeRawText, RAW_RESPONSES_COLLECTION} = require('../src/analysis/writeRawAiResponses');
const {RAW_STATE} = require('../src/analysis/reportRawStore');
const {mergeRawIntoReport, readReportWithRaw} = require('./lib/reportRawReaders');
const {CATEGORIES} = require('../src/utils/categories');

const REPORTS_COLLECTION = 'reports';

// ─── حقل جديد بعد export-v6-report-readonly.js، غير مغطّى هناك ─────────
// serverSamplesStoragePath (جذر المستند، القرار ٨٦ البند ٢ —
// analyzeDevice.js:286/serverRawSamplesStorage.js:41) يحمل الـscanId
// الخام حرفياً داخل قيمته: computeServerSamplesStoragePath(scanId) =
// `serverSamples/${scanId}.json.gz`. **اكتشفه اختبار هذا الملفّ نفسه**
// (exportV7ReportReadonly.test.js تحقّق ٨: `!outStr.includes(scanId)`
// فشل قبل إضافة هذا الحذف) — لا نقلاً، بالتشغيل. export-v6-report-
// readonly.js لا يحذفه لأنه أُضيف بعد كتابة تلك القائمة (V6 لا يملك هذا
// الحقل أصلاً وقتها). يُحذَف هنا فقط — لا تعديل على export-v6-report-
// readonly.js (خارج حدود هذه المهمّة: "functions/src بلا أي تغيير"، وهذا
// امتداد مواز في scripts/ لا تعديل للمصدر المشترك).
const V7_EXTRA_DELETE_PATHS = Object.freeze([
  'serverSamplesStoragePath',
]);

// ─── المجموعة المتوقَّعة (82) — مُشتقّة بالأداة، لا مكتوبة يدوياً ─────────
// أمر: node -e "const frMap=require('./test/fixtures/golden/functionalResults-by-scanid.json').byScanId; const ids=frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'].map(r=>r.testId); console.log(JSON.stringify(ids.filter(id=>!['G-03','G-04','G-05'].includes(id))))"
// (85 معرّفاً على فِخّ b45c8cf6 ناقص G-03/G-04/G-05 — لا G-03..G-05 حقيقيّان
// على هذا الفِخّ إطلاقاً؛ حكم المدقّق: verifier-decision96-97-testset-
// cvref-2026-09-25.md:22-26 [خارج هذا المستودع، منقول بمصدره — القاعدة
// 29]: "التطبيق، launch | 82 (بلا SN-13 وSEC-12 وINFO-01 وINFO-02)"،
// و"الفِخاخ b45c8cf6 (و34dff2b8 بالمجموعة نفسها) | 85"، و"الفِخاخ − launch
// | 3: G-03 · G-04 · G-05" — أي أن 82 = 85 − 3، لا 82 مستقلّ محسوب من
// SN-13/SEC-12/INFO-01/INFO-02 (تلك أربعة غائبة أصلاً من التطبيق لا من
// الفِخّ). مُتحقَّق بالأمر أعلاه مباشرة على هذا المستودع، لا نقلاً بلا
// تحقّق.
const EXPECTED_TEST_IDS = Object.freeze([
  'B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06', 'B-07', 'B-08',
  'C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'C-07',
  'CM-01', 'CM-02', 'CM-03', 'CM-04', 'CM-05', 'CM-06', 'CM-07', 'CM-08', 'CM-10', 'CM-11',
  'D-01', 'D-02', 'D-03',
  'G-01', 'G-02',
  'L-01', 'L-02', 'L-03',
  'N-01', 'N-02', 'N-03', 'N-04', 'N-05', 'N-06', 'N-07', 'N-08', 'N-09', 'N-10', 'N-11', 'N-12', 'N-13',
  'R-01', 'R-02', 'R-03',
  'S-01', 'S-02', 'S-03', 'S-04', 'S-05', 'S-06',
  'SEC-01', 'SEC-02', 'SEC-03', 'SEC-04', 'SEC-05', 'SEC-06', 'SEC-07', 'SEC-08', 'SEC-09', 'SEC-10', 'SEC-11',
  'SN-01', 'SN-02', 'SN-03', 'SN-04', 'SN-05', 'SN-06', 'SN-07', 'SN-08', 'SN-09', 'SN-10', 'SN-11', 'SN-12',
  'T-01', 'T-02', 'T-03', 'T-04',
]);
if (EXPECTED_TEST_IDS.length !== 82) {
  throw new Error(`export-v7-report-readonly: توقّف — EXPECTED_TEST_IDS.length=${EXPECTED_TEST_IDS.length} ≠ 82`);
}

/**
 * قراءة مسار منقّط بأمان — يميّز "غائب" (present:false) عن "حاضر بقيمة
 * null" (present:true, value:null) — القاعدة 22، ونصّ الأمر: "letterCeilingReason
 * قد يكون null حاضراً، فميّزه من الغياب."
 * @param {*} obj
 * @param {string} dottedPath
 * @return {{present: boolean, value: *}}
 */
function readPath(obj, dottedPath) {
  const segments = dottedPath.split('.');
  let cur = obj;
  for (const seg of segments) {
    if (cur === null || typeof cur !== 'object' || !(seg in cur)) {
      return {present: false, value: undefined};
    }
    cur = cur[seg];
  }
  return {present: true, value: cur};
}

/**
 * يقارن معرّفات الاختبارات الفعلية في التقرير بالمجموعة المتوقَّعة (82).
 * مصدر معرّفات التقرير: rawFingerprint.functionalResults[].testId (نصّ
 * الأمر: "rawFingerprint.functionalResults أو ما يكتبه الخادم" — مُتحقَّق
 * بالكود: lightenFingerprintForStorage.js لا يمسّ .functionalResults،
 * فتصل reports/{scanId}.rawFingerprint.functionalResults كما ولّدها
 * التطبيق، بلا تعديل خادم).
 * @param {Object} reportData مستند reports/{scanId} كما وصل (غير مُنقَّى)
 * @return {Object} نتيجة صريحة — PATH_ABSENT إن غاب rawFingerprint.functionalResults
 */
function compareTestIds(reportData) {
  const fr = readPath(reportData, 'rawFingerprint.functionalResults');
  if (!fr.present || !Array.isArray(fr.value)) {
    return {
      state: 'PATH_ABSENT',
      path: 'rawFingerprint.functionalResults',
      expectedCount: EXPECTED_TEST_IDS.length,
    };
  }
  const actualIds = fr.value.map((r) => (r && typeof r.testId === 'string') ? r.testId : null).filter(Boolean);
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(EXPECTED_TEST_IDS);
  const missing = EXPECTED_TEST_IDS.filter((id) => !actualSet.has(id));
  const extra = actualIds.filter((id) => !expectedSet.has(id));
  return {
    state: 'COMPARED',
    expectedCount: EXPECTED_TEST_IDS.length,
    actualCount: actualIds.length,
    missing, // في المتوقَّع لا في التقرير
    extra, // في التقرير لا في المتوقَّع
  };
}

/**
 * letterSource/letterCeilingReason/gatesApplied/حرف الأمان/الحرف العامّ —
 * كل حقل بحالته الصريحة (PATH_ABSENT أو {present:true, value}). راجع
 * تعليق رأس الملفّ لتصحيح overall.letterCeilingReason مقابل
 * overall.governingGateReason.
 * @param {Object} reportData
 * @return {Object}
 */
function extractLetterInfo(reportData) {
  const out = {};
  const paths = {
    overallLetter: 'aiResponse.overall.letter',
    overallLetterSource: 'aiResponse.overall.letterSource',
    // مُتوقَّع دائماً PATH_ABSENT على الشكل الحالي — راجع رأس الملفّ.
    overallLetterCeilingReason_expectedAbsent: 'aiResponse.overall.letterCeilingReason',
    overallGoverningGateReason: 'aiResponse.overall.governingGateReason',
    securityLetter: 'aiResponse.categories.security.letter',
    securityLetterSource: 'aiResponse.categories.security.letterSource',
    securityLetterCeilingReason: 'aiResponse.categories.security.letterCeilingReason',
  };
  for (const [key, path] of Object.entries(paths)) {
    const r = readPath(reportData, path);
    out[key] = r.present ? {present: true, value: r.value} : {present: false, path};
  }

  out.perCategoryLetterCeilingReason = {};
  for (const cat of CATEGORIES) {
    const r = readPath(reportData, `aiResponse.categories.${cat}.letterCeilingReason`);
    out.perCategoryLetterCeilingReason[cat] = r.present ? {present: true, value: r.value} : {present: false};
  }

  const gatesR = readPath(reportData, 'aiAudit.gatesApplied');
  if (gatesR.present && Array.isArray(gatesR.value)) {
    out.gatesFired = gatesR.value.filter((g) => g && g.status === 'FIRED');
  } else {
    out.gatesFired = {present: false, path: 'aiAudit.gatesApplied'};
  }

  // "بصمات" الحمولة المخزَّنة في مستند التقرير نفسه — راجع تعليق الرأس،
  // ليست بديلاً عن بصمة الحمولة المُرسَلة للنموذج (تلك غير مخزَّنة أصلاً).
  out.reportAudit = {};
  for (const field of ['issueSetHash', 'lettersHash', 'numbersHash']) {
    const r = readPath(reportData, `aiAudit.${field}`);
    out.reportAudit[field] = r.present ? {present: true, value: r.value} : {present: false};
  }

  return out;
}

/**
 * يُهيِّئ writtenAt (Firestore Timestamp حقيقي، أو أي شكل آخر في الاختبار)
 * إلى نصّ صريح — لا يفترض شكلاً واحداً (القاعدة 22).
 * @param {*} v
 * @return {{state: string, value: ?string}}
 */
function formatWrittenAt(v) {
  if (v === null || v === undefined) return {state: 'ABSENT', value: null};
  if (typeof v.toDate === 'function') {
    try {
      return {state: 'FIRESTORE_TIMESTAMP', value: v.toDate().toISOString()};
    } catch (e) {
      return {state: 'TIMESTAMP_TODATE_FAILED', value: null};
    }
  }
  if (typeof v === 'string') return {state: 'STRING_AS_STORED', value: v};
  if (typeof v === 'number') return {state: 'EPOCH_MS_AS_STORED', value: new Date(v).toISOString()};
  return {state: 'UNKNOWN_SHAPE', value: null};
}

/**
 * ردّ النموذج كما خُزّن في aiRawResponses/{scanId} (writeRawAiResponses.js:75) —
 * لا نسخ للمستند الخام كاملاً (لا حقل scanId المُكرَّر يصل المخرَج إطلاقاً).
 * @param {?Object} rawDocData بيانات aiRawResponses/{scanId}.data()، أو null إن غاب المستند
 * @return {Object}
 */
function extractModelResponse(rawDocData) {
  if (!rawDocData) {
    return {state: 'DOCUMENT_ABSENT', collection: RAW_RESPONSES_COLLECTION};
  }
  const attemptsR = readPath(rawDocData, 'attempts');
  const attempts = (attemptsR.present && Array.isArray(attemptsR.value)) ? attemptsR.value.map((a) => ({
    attempt: (a && typeof a.attempt === 'number') ? a.attempt : null,
    provider: (a && a.provider) || null,
    durationMs: (a && typeof a.durationMs === 'number') ? a.durationMs : null,
    // القاعدة 36 — تنقية دفاع في العمق إضافية (طُبِّقت مرّة عند الكتابة).
    raw: (a && typeof a.raw === 'string') ? sanitizeRawText(a.raw) : null,
    // نصّ الأمر: "مع بصمة الحمولة... إن لم يُخزَّنا يُكتب ذلك نصّاً" —
    // لا حقل بصمة مخزَّن مع أي محاولة (writeRawAiResponses.js:68-73) —
    // مُتحقَّق بالكود، لا افتراضاً.
    payloadFingerprint: 'NOT_STORED',
  })) : {present: false, path: 'attempts'};

  return {
    state: 'DOCUMENT_PRESENT',
    attempts,
    writtenAt: formatWrittenAt(rawDocData.writtenAt),
  };
}

/**
 * يحلّ shortId إلى مستند reports/{scanId} واحد. حالتان صريحتان لا
 * "اختيار أوّل مستند" (نصّ الأمر): صفر تطابق، أو أكثر من تطابق.
 * @param {Object} readOnlyDb
 * @param {string} shortIdUpper
 * @return {Promise<{state: string, scanId: ?string, data: ?Object, matchCount: number}>}
 */
async function resolveScanIdFromShortId(readOnlyDb, shortIdUpper) {
  const snap = await readOnlyDb.collection(REPORTS_COLLECTION).where('shortId', '==', shortIdUpper).get();
  if (snap.size === 0) return {state: 'SHORTID_NOT_FOUND', scanId: null, data: null, matchCount: 0};
  if (snap.size > 1) return {state: 'SHORTID_AMBIGUOUS', scanId: null, data: null, matchCount: snap.size};
  const doc = snap.docs[0];
  return {state: 'RESOLVED', scanId: doc.id, data: doc.data() || {}, matchCount: 1};
}

/**
 * تطبيق Firebase Admin منفصل بـprojectId مثبَّت — نفس PROJECT_ID المصدَّرة
 * من audit-device-profiles-readonly.js (القاعدة 24، مصدر واحد).
 * @return {Object} {db}
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'export-v7-report-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

/**
 * يبني المخرَج الكامل (كائن JSON واحد) من مستند تقرير + مستند aiRawResponses
 * (قد يكون null) + shortId كما أُدخل. دالّة خالصة — قابلة للاختبار بلا
 * Firestore (تُستدعى من main() ومن الاختبار كليهما).
 * @param {string} shortIdInput كما أُدخل على سطر الأوامر (بعد toUpperCase)
 * @param {Object} reportData مستند reports/{scanId}.data()
 * @param {?Object} rawResponseDocData مستند aiRawResponses/{scanId}.data()، أو null
 * @param {{state: string, raw: ?Object}} rawRead ناتج readReportRaw للتقرير (PRIVATE | EMBEDDED_LEGACY | ABSENT)
 * @return {Object}
 */
function buildExportOutput(shortIdInput, reportData, rawResponseDocData, rawRead) {
  // الخامّ يُدمج في نسخة المستند (الشكل المضمَّن الذي تقرؤه الدوالّ أدناه) — rawRead مطلوب (القاعدة 22).
  const merged = mergeRawIntoReport(reportData, rawRead);
  const {redacted, removedFields, replacedFields} = redactIdentifiers(merged);
  // راجع «الإخفاء» في رأس الملفّ — shortId يُعاد إلى قيمته الحقيقية (هي
  // نفسها shortIdInput أصلاً، بما أنه معيار البحث) بعد redactIdentifiers.
  const shortIdWasReplaced = replacedFields.includes('shortId');
  redacted.shortId = shortIdInput;
  const finalReplacedFields = replacedFields.filter((p) => p !== 'shortId');

  // حقول V7 إضافية غير مغطّاة في export-v6-report-readonly.js — راجع
  // تعليق V7_EXTRA_DELETE_PATHS أعلى الملفّ.
  const extraRemovedFields = [];
  for (const path of V7_EXTRA_DELETE_PATHS) {
    if (path in redacted) {
      delete redacted[path];
      extraRemovedFields.push(path);
    }
  }
  const allRemovedFields = removedFields.concat(extraRemovedFields);

  const suspects = new Set();
  scanForIdentifierLikeNames(redacted, '', suspects);

  return {
    projectId: PROJECT_ID,
    shortId: shortIdInput,
    shortIdRetainedAsProvided: true,
    rawState: rawRead.state, // PRIVATE | EMBEDDED_LEGACY | ABSENT — غياب الخامّ يُعلَن ولا يُقرأ نجاحاً
    redaction: {
      removedFields: allRemovedFields,
      replacedFields: finalReplacedFields,
      shortIdExcludedFromReplacement: shortIdWasReplaced,
      forReview_notRedacted: Array.from(suspects).sort(),
    },
    testIdComparison: rawRead.state === RAW_STATE.ABSENT ?
      {state: 'RAW_ABSENT', path: 'rawFingerprint.functionalResults', expectedCount: EXPECTED_TEST_IDS.length} :
      compareTestIds(merged),
    letterInfo: extractLetterInfo(merged),
    modelResponse: extractModelResponse(rawResponseDocData),
    document: redacted,
  };
}

/**
 * يحلّ shortId، يقرأ التقرير وخامّه (readReportRaw) وردّ النموذج الخام، ويبني المخرَج. قراءة فقط.
 * @param {{db: Object, shortIdUpper: string}} p db مغلَّف بـwrapReadOnly
 * @return {Promise<{resolved: Object, output: ?Object}>} output=null إن لم يُحَلّ shortId إلى تقرير واحد
 */
async function exportReportByShortId({db, shortIdUpper}) {
  const resolved = await resolveScanIdFromShortId(db, shortIdUpper);
  if (resolved.state !== 'RESOLVED') return {resolved, output: null};

  const read = await readReportWithRaw({db, scanId: resolved.scanId, reportData: resolved.data});
  const rawSnap = await db.collection(RAW_RESPONSES_COLLECTION).doc(resolved.scanId).get();
  const rawResponseDocData = rawSnap.exists ? (rawSnap.data() || {}) : null;
  return {resolved, output: buildExportOutput(shortIdUpper, resolved.data, rawResponseDocData, read.rawRead)};
}

async function main() {
  const shortIdArg = process.argv[2];
  if (!shortIdArg) {
    console.error('Usage: node export-v7-report-readonly.js <shortId>');
    process.exit(1);
  }
  const shortIdUpper = String(shortIdArg).trim().toUpperCase();

  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const {resolved, output} = await exportReportByShortId({db: readOnlyDb, shortIdUpper});
  if (!output) {
    console.log(JSON.stringify({
      projectId: PROJECT_ID,
      shortId: shortIdUpper,
      error: resolved.state,
      matchCount: resolved.matchCount,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    // القاعدة 36 — e.code واسم الصنف وحدهما، لا e.stack ولا e.message الخام.
    const code = (e && e.code) || '(no code)';
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`✗ توقّف بخطأ: [${className}] code=${code}`);
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_TEST_IDS, readPath, compareTestIds, extractLetterInfo, formatWrittenAt,
  extractModelResponse, resolveScanIdFromShortId, buildExportOutput, exportReportByShortId, initReadOnlyAdmin,
  REPORTS_COLLECTION,
};
