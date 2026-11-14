#!/usr/bin/env node
'use strict';

// ===================================================================
// export-v7-replay-inputs-readonly — قراءة فقط. يأخذ shortId، يحلّه إلى
// scanId (نفس resolveScanIdFromShortId من export-v7-report-readonly.js،
// مصدر واحد — القاعدة 24)، ثم يعيد تجميع **مُدخل قابل لإعادة التشغيل**
// (fingerprint كامل: device + timeSeries.{header,footer,samples} +
// functionalResults + manualResults) من مصدرين معاً:
//   ١. rawFingerprint — يحمل كل شيء **عدا** timeSeries.samples
//      (lightenFingerprintForStorage.js يحذفها قبل الحفظ في Firestore،
//      ويستبدلها بـsamplesCount — راجع رأس ذلك الملفّ). **V8 نقل الخامّ
//      (الجزء ٢، 2026-10-09):** صار في reportRaw/{scanId} للتقارير الجديدة
//      والمُرحَّلة (ومضمَّناً في reports/{scanId} لتقرير لم يُرحَّل بعد)؛
//      يُقرأ بـreadReportRaw وحالته الصريحة تُطبع (rawState). ABSENT (لا
//      خامّ إطلاقاً) = لا مُدخل قابل لإعادة التشغيل: رمز الخروج 1.
//   ٢. serverSamples/{scanId}.json.gz في Storage (الحقل الجذري
//      serverSamplesStoragePath على نفس المستند يحمل هذا المسار؛
//      serverSamplesStorage.js:saveServerRawSamples يكتبه — JSON.stringify
//      لمصفوفة samples وحدها، بلا تحويل، القاعدة 20).
//
// ===================================================================
// أمر مستخدم 2026-10-01 +03 (البند ٦، "أدوات النداءات الحيّة"، الأداة
// الأولى — "سكربت قراءة العيّنات المحفوظة للتقارير الثلاثة"):
//   "يشغّله المستخدم ببيانات دخول يعدّها ثم يلغيها." — بيانات الدخول هنا
//   اعتماد Admin SDK (GOOGLE_APPLICATION_CREDENTIALS أو gcloud ADC)، نفس
//   ما يحتاجه export-v7-report-readonly.js أصلاً — لا سرّ جديد يخصّ هذا
//   الملفّ. **لا مفتاح مزوّد نموذج هنا إطلاقاً** (لا DeepSeek ولا Gemini)
//   — هذا سكربت قراءة Firestore/Storage وحدهما.
//   "يكتب المخرَج في مسار يُمرَّر له خارج المستودع." — وسيط ثانٍ إلزامي
//   (outPath)، لا stdout (القياس المتوقَّع: مُدخل كامل بما فيه العيّنات
//   الخام قد يتجاوز حجماً معقولاً لطرفية، ولأن الأمر طلب مساراً صراحة).
//   "ولا يطبع قيمة سرّ، ولا معرّف مستخدم خامّاً." — stdout يطبع فقط:
//   projectId، shortId (المُدخل نفسه، ليس سرّاً)، scanId (معرّف مستند
//   داخلي — **ليس** uid/email — لكن يُطبَع فقط بعد قرار صريح أدناه)،
//   samplesCount، ومسار الملفّ المكتوب. **لا userId/sessionId/بريد في أي
//   مكان** — تلك تُحذَف من الوثيقة قبل الكتابة، بنفس REDACT_DELETE_PATHS
//   المُستوردة من export-v6-report-readonly.js (مصدر واحد، القاعدة 24).
//
// ─── قرار: scanId يُطبَع (خلافاً لـexport-v7-report-readonly.js) ─────────
// ذلك الملفّ يحذف scanId من غلاف مخرَجه (shortId يكفي مُعرِّفاً). هنا
// scanId **ضروري تشغيلياً** لاسم ملفّ العيّنات في Storage
// (serverSamples/{scanId}.json.gz) ولإعادة تشغيل measure-resolveV7Report-
// live.js (يحتاج scanId لبناء userMessage/طلب حقيقي) — فيبقى في المخرَج
// المكتوب (لا نطبعه على stdout مع ذلك — فقط في الملفّ، تقليلاً للتسرّب
// عبر سجلّ الطرفية/التاريخ).
//
// Usage (يُشغِّله المستخدم من طرفيّته فقط، بعد ضبط GOOGLE_APPLICATION_
// CREDENTIALS أو gcloud auth application-default login):
//   node functions/scripts/export-v7-replay-inputs-readonly.js <shortId> <outPath.json>
// مثال:
//   node functions/scripts/export-v7-replay-inputs-readonly.js NC-5DYV7N ../../evidence/replay-input-NC-5DYV7N.json
// ===================================================================

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const {wrapReadOnly, PROJECT_ID, STORAGE_BUCKET} = require('./audit-device-profiles-readonly');
const {redactIdentifiers} = require('./export-v6-report-readonly');
const {resolveScanIdFromShortId, REPORTS_COLLECTION} = require('./export-v7-report-readonly');
const {readReportWithRaw, mergeRawIntoReport} = require('./lib/reportRawReaders');
const {RAW_STATE} = require('../src/analysis/reportRawStore');
const {computeServerSamplesStoragePath, SERVER_SAMPLES_STORAGE_PATH_FIELD, SERVER_SAMPLES_SAVED_FIELD} =
    require('../src/analysis/serverRawSamplesStorage');

/**
 * فكّ ضغط buffer gzip إلى نصّ UTF-8 ثم JSON.parse — لا تحويل آخر (القاعدة
 * 20: العيّنات تبقى كما كُتبت حرفياً).
 * @param {Buffer} gzBuffer بايتات gzip خامّة كما كُتبت (راجع fetchSamplesFromStorage
 *   أدناه — يجب أن يُستدعى بعد file.download({decompress: false}) لا قبله).
 * @return {Array} مصفوفة العيّنات كما وصلت من bucket.file(...).download()
 */
function decompressSamples(gzBuffer) {
  const json = zlib.gunzipSync(gzBuffer).toString('utf-8');
  return JSON.parse(json);
}

// ترويسة gzip المعيارية (RFC 1952، §2.3.1) — تُستعمل للتحقّق قبل فكّ
// الضغط (القاعدة 22: لا فكّ بديل صامت لبايتات لا تحمل هذه العلامة).
const GZIP_MAGIC_BYTE_0 = 0x1f;
const GZIP_MAGIC_BYTE_1 = 0x8b;

/**
 * تنقية نصّ خطأ قبل كتابته/طباعته (القاعدة 36 بامتدادها). هذا خطأ Storage
 * (GCS) داخلي لا ردّ مزوّد نموذج (DeepSeek/Gemini) — لا مفتاح نموذج في هذا
 * السكربت إطلاقاً (راجع رأس الملفّ) — لكن بالحذر نفسه: لا نصّ خام غير
 * محدود الطول، ولا نمط يشبه توقيعاً/رمزاً مضمَّناً (رسائل GCS قد تحمل
 * عنوان URL كاملاً لطلب فشل، وقد يحمل مقاطع استعلام شبيهة بتوقيع).
 *
 * ⚠️ **لماذا دالّة محلّية جديدة لا استيراد من سكربت آخر (القاعدة 24 مقابل
 * القاعدة 14)**: الدالّة الوحيدة الموجودة فعلياً بهذا الغرض في هذا
 * المستودع هي `sanitizeText` المُصدَّرة من
 * `functions/scripts/measure-resolveV7Report-live.js`. فحصها (أمر هذه
 * الجولة) أظهر أنها **لا تناسب الاستيراد هنا**: ذلك الملفّ يستبدل
 * `global.fetch` في أعلى الملفّ مباشرة عند `require()` وحده — بصرف النظر
 * عن استدعاء `main()` — بنصّه (سطر ~51 من ذلك الملفّ): "أي require() لهذا
 * الملفّ من كود آخر... يُثبِّت طبقة الشبكة/التنقية العالمية... تعمل مباشرة
 * عند التحميل". استيرادها هنا كان سيُركِّب اعتراضاً عالمياً لـfetch داخل
 * سكربت قراءة Firestore/Storage حقيقي (هذا الملفّ يُجري نداءات Admin SDK
 * فعلية) — خطر لا يتناسب مع فائدة مصدر واحد. فدالّة محلّية مستقلّة هنا
 * بدلاً من ذلك، على نمط `sanitizeRawText` في
 * `functions/src/analysis/writeRawAiResponses.js:40-43` (نفس التعليل:
 * "لا نسخة من دالّة سكربت القياس... لكن نفس الفكرة"). هذا توقّف واختيار
 * واعٍ (القاعدة 14) لا التفافاً صامتاً — مذكور في رأس تقرير هذه المهمّة.
 * @param {*} err كائن الخطأ (قد لا يحمل .message نصّياً)
 * @return {string}
 */
function sanitizeErrorMessage(err) {
  const raw = (err && typeof err.message === 'string') ? err.message : String(err);
  let out = raw.slice(0, 500);
  // لا يشترط سبق `?`/`&` — "token=..." قد تظهر في نثر الرسالة لا داخل
  // query string فقط (مُتحقَّق: نمط [?&] وحده فشل في التقاط "token=..."
  // حين سبقتها مسافة لا علامة استفهام/عطف — انظر اختبار ٦-هـ).
  out = out.replace(/\b(X-Goog-Signature|Signature|token|key|access_token)=[^&\s]+/gi, '$1=[REDACTED]');
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]');
  return out;
}

/**
 * رمز الخروج المتوقَّع من حالة جلب العيّنات. دالّة خالصة. العيّنات غرض
 * هذا السكربت (رأس الملفّ) — فأي حالة غير DOWNLOADED تُخرِج رمزاً غير 0.
 * @param {string} samplesFetchState
 * @return {number} 0 أو 1
 */
function exitCodeForSamplesFetchState(samplesFetchState) {
  return samplesFetchState === 'DOWNLOADED' ? 0 : 1;
}

/**
 * تطبيق Firebase Admin منفصل (اسم مختلف عن export-v7-report-readonly.js
 * كي لا يتصادم appName لو استُوردا معاً) — نفس PROJECT_ID المثبَّت. يعيد
 * db **وbucket** معاً (export-v7-report-readonly.js لا يحتاج bucket فلا
 * يعيده).
 *
 * ⚠️ **تصحيح المنسّق 2026-10-01 +03 (بعد b4a08b4) — عطب حقيقي كان يُسقط
 * السكربت كلّه**: `admin.initializeApp({projectId}, appName)` بلا
 * `storageBucket` ثم `app.storage().bucket()` بلا اسم يعتمد على قراءة
 * اسم الـbucket من متغيّر البيئة `FIREBASE_CONFIG` — ذلك المتغيّر **موجود
 * تلقائياً داخل بيئة تشغيل Cloud Functions وحدها**، **غائب على جهاز
 * المستخدم** حين يُشغَّل هذا السكربت من طرفيّته (نفس بيئة كل سكربتات
 * `*-readonly.js` في هذا المجلّد). فكان `bucket()` يرمي فوراً — "Bucket
 * name not specified or invalid..." — **قبل أي محاولة قراءة فعلية من
 * Firestore أو Storage**، بعد أن يسجّل المستخدم دخوله ويظنّ أن السكربت
 * بدأ عمله. **مُتحقَّق بتشغيل فعلي** بلا شبكة ولا اعتماد (نفس بيئة جهاز
 * المستخدم: FIREBASE_CONFIG غائب) — راجع
 * test/exportV7ReplayInputsReadonly.test.js تحقّق ٥.
 *
 * الإصلاح: `storageBucket` صريح بالقيمة الحقيقية المُصدَّرة من
 * audit-device-profiles-readonly.js (STORAGE_BUCKET) — سابقة قائمة في
 * هذا المستودع بالقيمة نفسها حرفياً: count-qr-session-timeseries-storage-
 * readonly.js:81 (باسم STORAGE_BUCKET محلّياً)، measure-deepseek-only-
 * variance.js:86 وregenerate-report.js:57 (باسم BUCKET محلّياً) — ثلاث
 * نسخ حرفية غير مُوحَّدة في مصدر واحد (القاعدة 24، لم تُصلَح هنا، خارج
 * نطاق هذا التصحيح — راجع تعليق STORAGE_BUCKET في ذلك الملفّ).
 * @return {Object} {db, bucket}
 */
function initReadOnlyAdminWithStorage() {
  const admin = require('firebase-admin');
  const appName = 'export-v7-replay-inputs-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET}, appName);
  return {db: app.firestore(), bucket: app.storage().bucket()};
}

/**
 * يبني fingerprint قابلاً لإعادة التشغيل من مستند تقرير + عيّنات (قد
 * تكون غائبة). دالّة خالصة — قابلة للاختبار بلا Firestore/Storage حقيقيَّين.
 * @param {Object} reportData مستند reports/{scanId}.data() غير المُنقَّى
 * @param {?Array} samples مصفوفة العيّنات المُستعادة من Storage، أو null
 * @param {{state: string, raw: ?Object}} rawRead ناتج readReportRaw (PRIVATE | EMBEDDED_LEGACY | ABSENT) — مطلوب
 * @return {Object} {fingerprint, samplesSource, language, isFreeTrial, redaction, rawState}
 */
function buildReplayInput(reportData, samples, rawRead) {
  const merged = mergeRawIntoReport(reportData, rawRead);
  const {redacted, removedFields, replacedFields} = redactIdentifiers(merged);
  const rf = (redacted && typeof redacted.rawFingerprint === 'object' && redacted.rawFingerprint) || {};
  const lightTs = (rf.timeSeries && typeof rf.timeSeries === 'object') ? rf.timeSeries : {};
  const {samplesCount, ...tsWithoutCount} = lightTs; // samplesCount ليس حقلاً حقيقياً في الشكل الأصلي — أُضيف عند التخفيف

  let samplesSource;
  let fullTimeSeries;
  if (Array.isArray(samples)) {
    samplesSource = {state: 'RESTORED_FROM_STORAGE', count: samples.length,
      countMatchesLightened: (typeof samplesCount === 'number') ? samples.length === samplesCount : null};
    fullTimeSeries = {...tsWithoutCount, samples};
  } else {
    // القاعدة 22 — الغياب يبقى غائباً، لا مصفوفة فارغة مُختلَقة توحي
    // بجهاز بلا عيّنات فعلياً.
    samplesSource = {state: 'UNAVAILABLE', reportedSamplesCount: (typeof samplesCount === 'number') ? samplesCount : null};
    fullTimeSeries = {...tsWithoutCount};
  }

  const fingerprint = {
    device: rf.device || null,
    timeSeries: fullTimeSeries,
    functionalResults: Array.isArray(rf.functionalResults) ? rf.functionalResults : [],
    manualResults: Array.isArray(rf.manualResults) ? rf.manualResults : [],
  };

  return {
    fingerprint,
    samplesSource,
    language: (typeof redacted.language === 'string') ? redacted.language : 'ar',
    isFreeTrial: !!redacted.isFreeTrial,
    redaction: {removedFields, replacedFields},
    rawState: rawRead.state,
  };
}

/**
 * ABSENT (لا reportRaw ولا حقول مضمَّنة) = لا fingerprint لإعادة التشغيل: رمز خروج غير 0 (القاعدة 22 — لا يُقرأ نجاحاً).
 * @param {string} rawState
 * @return {number} 0 أو 1
 */
function exitCodeForRawState(rawState) {
  return rawState === RAW_STATE.ABSENT ? 1 : 0;
}

/**
 * ⚠️ **تصحيح المنسّق 2026-10-01 +03 — عطب حقيقي كان يُسقط استعادة العيّنات
 * في الثلاثة تقارير (NC-5DYV7N، NC-83XL4C، NC-TM7PDN) بـ0 صامت**:
 * `file.download()` بلا خيارات مع ملفّ مكتوب بـ`metadata: {contentEncoding:
 * 'gzip'}` (serverRawSamplesStorage.js:107-110) تجعل مكتبة
 * `@google-cloud/storage` (7.19.0، build/cjs/src/file.js:1009 — `options =
 * Object.assign({decompress: true}, options)`؛ :1065 `isCompressed =
 * headers['content-encoding'] === 'gzip'`؛ :1104-1105 `zlib.createGunzip()`
 * حين `isCompressed && options.decompress`) **تفكّ الضغط تلقائياً** قبل أن
 * تعيد البايتات. فـ`decompressSamples` أدناه كانت تحاول `gunzipSync` على
 * JSON مفكوكاً أصلاً فعلياً — `Z_DATA_ERROR` (خطأ zlib لا خطأ شبكة/صلاحية؛
 * الملفّ موجود ونُزِّل فعلاً). **الإصلاح: `file.download({decompress:
 * false})`** — البايتات تصل كما خُزِّنت حرفياً، و`decompressSamples`
 * الصريحة تبقى هي من تفكّ الضغط (القاعدة 20: لا تحويل مزدوج صامت).
 * ومُتحقَّق بالتحقّق ٦ في exportV7ReplayInputsReadonly.test.js (حاوية
 * مستبدَلة تحاكي سلوك المكتبة الحقيقي بالضبط: تُعيد JSON مفكوكاً حين لا
 * يصل `decompress:false`، وبايتات gzip حين يصل) — **لا** تشغيلاً حقيقياً؛
 * الإثبات الحقيقي الوحيد تشغيل المستخدم القادم على نفس التقارير الثلاثة.
 */
async function fetchSamplesFromStorage(bucket, storagePath) {
  try {
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) return {samples: null, state: 'FILE_NOT_FOUND', path: storagePath};
    const [buf] = await file.download({decompress: false});

    // القاعدة 22 — لا فكّ بديل صامت: إن لم تبدأ البايتات بعلامة gzip، حالة
    // صريحة باسمها بدل تمرير buf غير الصالح إلى gunzipSync (الذي قد يرمي
    // Z_DATA_ERROR نفسه أو، أسوأ، نوعاً آخر من فشل غامض حسب المحتوى).
    const looksLikeGzip = Buffer.isBuffer(buf) && buf.length >= 2 &&
        buf[0] === GZIP_MAGIC_BYTE_0 && buf[1] === GZIP_MAGIC_BYTE_1;
    if (!looksLikeGzip) {
      return {
        samples: null, state: 'DOWNLOADED_NOT_GZIP', path: storagePath,
        downloadedByteLength: Buffer.isBuffer(buf) ? buf.length : null,
      };
    }

    try {
      const samples = decompressSamples(buf);
      return {samples, state: 'DOWNLOADED', path: storagePath};
    } catch (gunzipErr) {
      // علامة gzip صحيحة لكن فكّ الضغط نفسه فشل (تيّار تالف جزئياً، مثلاً)
      // — حالة مميَّزة عن DOWNLOAD_ERROR (ذلك فشل الجلب نفسه، لا فكّ ما وصل).
      const code = (gunzipErr && gunzipErr.code) || '(no code)';
      const className = (gunzipErr && gunzipErr.constructor && gunzipErr.constructor.name) || typeof gunzipErr;
      return {
        samples: null, state: 'GUNZIP_ERROR', path: storagePath,
        errorCode: code, errorClass: className, errorMessage: sanitizeErrorMessage(gunzipErr),
      };
    }
  } catch (e) {
    // القاعدة 36 — رسالة مُنقّاة أيضاً، لا code/الصنف وحدهما (البند ٣ من
    // أمر هذه الجولة: تُكتب بجوار errorCode/errorClass في الملفّ وstdout).
    const code = (e && e.code) || '(no code)';
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    return {
      samples: null, state: 'DOWNLOAD_ERROR', path: storagePath,
      errorCode: code, errorClass: className, errorMessage: sanitizeErrorMessage(e),
    };
  }
}

async function main() {
  const shortIdArg = process.argv[2];
  const outPathArg = process.argv[3];
  if (!shortIdArg || !outPathArg) {
    console.error('Usage: node export-v7-replay-inputs-readonly.js <shortId> <outPath.json>');
    console.error('مثال: node export-v7-replay-inputs-readonly.js NC-5DYV7N ../../evidence/replay-input-NC-5DYV7N.json');
    process.exit(1);
  }
  const shortIdUpper = String(shortIdArg).trim().toUpperCase();
  const outPath = path.resolve(outPathArg);

  // دفاع في العمق — لا كتابة داخل هذا المستودع نفسه (القيد الصريح: خارج
  // المستودع). REPO_ROOT = مجلّد functions الأب (نفس بنية سكربتات أخرى).
  const REPO_ROOT = path.join(__dirname, '..', '..');
  if (outPath.startsWith(REPO_ROOT + path.sep) || outPath === REPO_ROOT) {
    console.error(`✗ توقّف: المسار المطلوب (${outPath}) داخل المستودع (${REPO_ROOT}) — يجب أن يكون خارجه صراحة.`);
    process.exit(1);
  }

  const {db, bucket} = initReadOnlyAdminWithStorage();
  const readOnlyDb = wrapReadOnly(db);

  const resolved = await resolveScanIdFromShortId(readOnlyDb, shortIdUpper);
  if (resolved.state !== 'RESOLVED') {
    console.error(`✗ shortId=${shortIdUpper}: ${resolved.state} (matchCount=${resolved.matchCount})`);
    process.exit(1);
  }

  const reportData = resolved.data || {};
  const storagePath = (typeof reportData[SERVER_SAMPLES_STORAGE_PATH_FIELD] === 'string') ?
      reportData[SERVER_SAMPLES_STORAGE_PATH_FIELD] :
      computeServerSamplesStoragePath(resolved.scanId);
  const wasSaved = reportData[SERVER_SAMPLES_SAVED_FIELD] === true;

  let samplesResult = {samples: null, state: 'NOT_ATTEMPTED', path: storagePath};
  if (wasSaved && storagePath) {
    samplesResult = await fetchSamplesFromStorage(bucket, storagePath);
  }

  const read = await readReportWithRaw({db: readOnlyDb, scanId: resolved.scanId, reportData});
  const {fingerprint, samplesSource, language, isFreeTrial, redaction, rawState} = buildReplayInput(reportData, samplesResult.samples, read.rawRead);

  // samplesFetch — state/path/errorCode/errorClass/errorMessage معاً، في
  // الملفّ وعلى stdout كليهما (أمر هذه الجولة، البند ٣؛ errorMessage مُنقّاة
  // بـsanitizeErrorMessage، القاعدة 36).
  const samplesFetchReport = {
    state: samplesResult.state,
    path: samplesResult.path,
    errorCode: samplesResult.errorCode || null,
    errorClass: samplesResult.errorClass || null,
    errorMessage: samplesResult.errorMessage || null,
  };

  const output = {
    projectId: PROJECT_ID,
    shortId: shortIdUpper,
    scanId: resolved.scanId, // في الملفّ فقط — لا على stdout، راجع رأس الملفّ
    serverSamplesSaved: wasSaved,
    rawState,
    samplesFetch: samplesFetchReport,
    samplesSource,
    redaction,
    language,
    isFreeTrial,
    fingerprint,
  };

  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // stdout — بلا scanId، بلا أي معرّف مستخدم (راجع رأس الملفّ).
  console.log(JSON.stringify({
    projectId: PROJECT_ID,
    shortId: shortIdUpper,
    serverSamplesSaved: wasSaved,
    rawState,
    samplesFetch: samplesFetchReport,
    samplesCount: Array.isArray(samplesResult.samples) ? samplesResult.samples.length : null,
    functionalResultsCount: fingerprint.functionalResults.length,
    writtenTo: outPath,
  }, null, 2));

  // رمز الخروج — العيّنات غرض هذا السكربت (رأس الملفّ)؛ أي حالة غير
  // DOWNLOADED تُخرِج رمزاً غير 0 (أمر هذه الجولة، البند ٢). يُضبَط عبر
  // process.exitCode لا process.exit() كي يكتمل تدفّق stdout/الملفّ أعلاه
  // أولاً بلا قطع.
  process.exitCode = Math.max(exitCodeForSamplesFetchState(samplesResult.state), exitCodeForRawState(rawState));
}

if (require.main === module) {
  main().catch((e) => {
    const code = (e && e.code) || '(no code)';
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`✗ توقّف بخطأ: [${className}] code=${code}`);
    process.exit(1);
  });
}

module.exports = {
  buildReplayInput, decompressSamples, initReadOnlyAdminWithStorage, fetchSamplesFromStorage,
  REPORTS_COLLECTION,
  // تصحيح المنسّق 2026-10-01 +03 (عطب تنزيل العيّنات) — مُصدَّرة للاختبار
  // المباشر بلا main()/شبكة حقيقية.
  sanitizeErrorMessage, exitCodeForSamplesFetchState, exitCodeForRawState,
};
