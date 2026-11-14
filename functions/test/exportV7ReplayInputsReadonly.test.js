'use strict';

// exportV7ReplayInputsReadonly.test.js — أمر مستخدم 2026-10-01 +03 (البند
// ٦، "أدوات النداءات الحيّة"، الأداة الأولى). يختبر الدوالّ الخالصة
// المُصدَّرة من scripts/export-v7-replay-inputs-readonly.js
// (buildReplayInput/decompressSamples) — صفر شبكة، صفر Firestore/Storage
// حقيقيَّين (لا نداء .get()/.exists()/.download() في أي قسم). main() لا
// تُستدعى (القيد الصريح: "تكتبه ولا تشغّله").
//
// ⚠️ **تصحيح 2026-10-01 +03 (بعد تصحيح المنسّق على b4a08b4) — القاعدة 37**:
// الادّعاء السابق هنا "صفر Admin SDK حقيقي" كان **سبب** عدم اكتشاف عطب
// initReadOnlyAdminWithStorage الحقيقي (bucket() يرمي بلا storageBucket) —
// القسم ٥ أدناه يستدعي **الدالّة الحقيقية نفسها** (لا نسخة مُستبدَلة)
// بلا أي تمويه لـfirebase-admin، ويُثبت أنها لا ترمي وأن bucket.name
// صحيح. `admin.initializeApp()`/`app.storage().bucket()`/`app.firestore()`
// لا تُجري أي اتّصال شبكة بأنفسها (الاتّصال الفعلي يقع فقط عند استدعاء
// `.get()`/`.exists()`/`.download()` لاحقاً — غير مُستدعاة هنا) — مُتحقَّق
// بتشغيل فعلي بلا FIREBASE_CONFIG/GCLOUD_PROJECT/GOOGLE_APPLICATION_CREDENTIALS
// (نفس بيئة جهاز المستخدم تماماً).
//
// المُدخل: نفس test/fixtures/golden/v7-reports-document-sample.json
// المُستعمَل في exportV7ReportReadonly.test.js — عيّنة V7 ذهبية حقيقية،
// تحمل فعلاً serverSamplesStoragePath/serverSamplesSaved:true ورَقفـ
// rawFingerprint.timeSeries المُخفَّف (samplesCount لا samples) — نفس
// الشكل الحقيقي الذي ينتجه lightenFingerprintForStorage.js.
//
// Run: node functions/test/exportV7ReplayInputsReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');
const zlib = require('zlib');

const {
  buildReplayInput, decompressSamples, initReadOnlyAdminWithStorage, fetchSamplesFromStorage,
  sanitizeErrorMessage, exitCodeForSamplesFetchState, exitCodeForRawState,
} = require('../scripts/export-v7-replay-inputs-readonly');
const {readReportRaw} = require('../src/analysis/reportRawStore');
const {STORAGE_BUCKET} = require('../scripts/audit-device-profiles-readonly');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// V8 نقل الخامّ (2026-10-09، الجزء ٢): السكربت يقرأ الخامّ بـreadReportRaw على الشكلين. البنود ١-٦ على شكل المستند القديم
// (EMBEDDED_LEGACY: المقروء + الخامّ مدموجَين من العيّنتين الذهبيتين)؛ والبند ٧ على الشكل الجديد (PRIVATE) وABSENT.
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

(async () => {
const legacyRawRead = await rawReadOf(goldenReport, null);

// ═══════════════════════════════════════════════════════════════════════
// ١ — decompressSamples: فكّ ضغط حرفي، بلا أي تحويل (القاعدة 20).
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeSamples = [{t: 0, v: 1.5}, {t: 1, v: 2.25}, {t: 2, v: -3}];
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(fakeSamples), 'utf-8'));
  const restored = decompressSamples(gz);
  deepEq(restored, fakeSamples, '[١] decompressSamples يُعيد نفس المصفوفة حرفياً بعد الضغط/فكّه — بلا فقد ولا تحويل');
}
console.log('تحقّق ١: decompressSamples يفكّ الضغط بلا أي تحويل على العيّنات (القاعدة 20)');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — buildReplayInput مع عيّنات مُستعادة فعلاً — fingerprint كامل قابل
//     لإعادة التشغيل، وsamplesSource يُثبت المطابقة مع samplesCount
//     المخزون في المستند (لا افتراضاً).
// ═══════════════════════════════════════════════════════════════════════
{
  const storedCount = goldenReport.rawFingerprint.timeSeries.samplesCount;
  ok(typeof storedCount === 'number' && storedCount > 0, '[إعداد] العيّنة الذهبية تحمل samplesCount رقمياً حقيقياً');
  const fakeSamples = Array.from({length: storedCount}, (_, i) => ({idx: i}));

  const result = buildReplayInput(goldenReport, fakeSamples, legacyRawRead);
  eq(result.samplesSource.state, 'RESTORED_FROM_STORAGE', '[٢] samplesSource.state=RESTORED_FROM_STORAGE حين تصل مصفوفة فعلية');
  eq(result.samplesSource.count, storedCount, '[٢] samplesSource.count يطابق طول المصفوفة المُستعادة');
  eq(result.samplesSource.countMatchesLightened, true, '[٢] العدد المُستعاد يطابق samplesCount المخزون في المستند — تحقّق تناسق فعلي');

  ok(Array.isArray(result.fingerprint.timeSeries.samples), '[٢] fingerprint.timeSeries.samples مصفوفة فعلية بعد إعادة التجميع');
  eq(result.fingerprint.timeSeries.samples.length, storedCount, '[٢] طول samples المُعاد تجميعها يطابق العدد المتوقَّع');
  ok(!('samplesCount' in result.fingerprint.timeSeries), '[٢] samplesCount (حقل تخفيف مؤقّت) لا يظهر في fingerprint المُعاد — استُبدل بـsamples الحقيقية');
  ok('header' in result.fingerprint.timeSeries && 'footer' in result.fingerprint.timeSeries,
      '[٢] header/footer الحقيقيّان من rawFingerprint.timeSeries محفوظان كما هما');
  eq(result.fingerprint.functionalResults.length, 85, '[٢] functionalResults تصل كاملة (85) — لم تُخفَّف أصلاً في المستند');
  deepEq(result.fingerprint.manualResults, [], '[٢] manualResults مصفوفة (فارغة على هذه العيّنة) لا undefined');
}
console.log('تحقّق ٢: buildReplayInput يُعيد fingerprint كاملاً قابلاً لإعادة التشغيل، مع إثبات تطابق عدد العيّنات لا افتراضه');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — buildReplayInput بلا عيّنات (Storage فشل/الملفّ غائب) — القاعدة 22:
//     الغياب يبقى غائباً صراحةً (samples غائبة من fingerprint، لا [] مُختلَقة).
// ═══════════════════════════════════════════════════════════════════════
{
  const result = buildReplayInput(goldenReport, null, legacyRawRead);
  eq(result.samplesSource.state, 'UNAVAILABLE', '[٣] samplesSource.state=UNAVAILABLE حين samples=null');
  eq(result.samplesSource.reportedSamplesCount, goldenReport.rawFingerprint.timeSeries.samplesCount,
      '[٣] العدد المُبلَّغ عنه في المستند (samplesCount) يُنقَل للتشخيص رغم غياب العيّنات الفعلية');
  ok(!('samples' in result.fingerprint.timeSeries),
      '[٣][القاعدة 22] fingerprint.timeSeries.samples غائب تماماً (لا [] مُختلَقة) حين تعذّر الاستعادة');
}
console.log('تحقّق ٣: غياب العيّنات (تعذّر Storage) يبقى غائباً صراحةً في fingerprint — لا [] كاذبة');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — الإخفاء (redaction) — userId/sessionId/إلخ تُحذَف فعلاً من المستند
//     المصدر قبل أي استخدام (نفس REDACT_DELETE_PATHS من export-v6-report-
//     readonly.js، القاعدة 24) — مُتحقَّق بمستند مُصطنَع يحمل هذه الحقول.
// ═══════════════════════════════════════════════════════════════════════
{
  const withIdentifiers = JSON.parse(JSON.stringify(goldenReport));
  withIdentifiers.userId = 'REAL-UID-SHOULD-NOT-LEAK';
  withIdentifiers.sessionId = 'REAL-SESSION-SHOULD-NOT-LEAK';
  const result = buildReplayInput(withIdentifiers, null, await rawReadOf(withIdentifiers, null));
  const serialized = JSON.stringify(result);
  ok(!serialized.includes('REAL-UID-SHOULD-NOT-LEAK'), '[٤] userId المُصطنَع لا يتسرّب إلى مخرَج buildReplayInput');
  ok(!serialized.includes('REAL-SESSION-SHOULD-NOT-LEAK'), '[٤] sessionId المُصطنَع لا يتسرّب إلى مخرَج buildReplayInput');
  ok(result.redaction.removedFields.includes('userId'), '[٤] userId مُسجَّل في removedFields (لا حذف صامت)');
}
console.log('تحقّق ٤: userId/sessionId يُحذَفان فعلياً قبل أي استخدام — مُسجَّلان في removedFields لا حذفاً صامتاً');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — تصحيح المنسّق 2026-10-01 +03 (بعد b4a08b4، القاعدة 37): استدعاء
//     initReadOnlyAdminWithStorage() **الحقيقية بلا أي استبدال** — لا فخّ
//     لـfirebase-admin، لا require.cache. يُثبت العطب المُصلَح فعلياً: كان
//     admin.initializeApp({projectId}, appName) بلا storageBucket يجعل
//     app.storage().bucket() يرمي "Bucket name not specified or invalid"
//     فوراً — قبل أي قراءة Firestore/Storage حقيقية — لأن اسم الـbucket
//     لم يكن يُحَلّ إلا من FIREBASE_CONFIG (موجود تلقائياً داخل بيئة
//     Cloud Functions وحدها، غائب على جهاز المستخدم). **بلا شبكة ولا
//     اعتماد هنا** — admin.initializeApp()/app.firestore()/app.storage()
//     .bucket() كائنات محلّية بحتة؛ الاتّصال الفعلي يقع فقط عند
//     .get()/.exists()/.download() — غير مُستدعاة في هذا التحقّق إطلاقاً.
// ═══════════════════════════════════════════════════════════════════════
{
  const savedEnv = {
    FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
  // محاكاة بيئة جهاز المستخدم فعلياً — لا الاكتفاء بغيابها المصادف هنا.
  delete process.env.FIREBASE_CONFIG;
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let threw = null;
  let result = null;
  try {
    result = initReadOnlyAdminWithStorage();
  } catch (e) {
    threw = e;
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  ok(!threw, `[٥][العطب المُصلَح] initReadOnlyAdminWithStorage() لا ترمي بلا FIREBASE_CONFIG/GCLOUD_PROJECT/GOOGLE_APPLICATION_CREDENTIALS — ${threw ? threw.message : ''}`);
  ok(result && result.db && typeof result.db.collection === 'function', '[٥] result.db كائن Firestore حقيقي صالح (collection() دالّة)');
  ok(result && result.bucket, '[٥] result.bucket حاضر (لا undefined/null)');
  eq(result.bucket.name, STORAGE_BUCKET, `[٥][الإصلاح] bucket.name يساوي STORAGE_BUCKET المُصدَّر من audit-device-profiles-readonly.js حرفياً — "${STORAGE_BUCKET}"`);
}
console.log(`تحقّق ٥: initReadOnlyAdminWithStorage() الحقيقية (بلا استبدال، القاعدة 37) لا ترمي بلا FIREBASE_CONFIG — bucket.name=${STORAGE_BUCKET} صحيح، صفر اتّصال فعلي`);

// ═══════════════════════════════════════════════════════════════════════
// ٦ — تصحيح المنسّق 2026-10-01 +03 (عطب تنزيل العيّنات، الثلاثة تقارير
//     NC-5DYV7N/NC-83XL4C/NC-TM7PDN بـZ_DATA_ERROR وDOWNLOAD_ERROR):
//     حاوية مستبدَلة تحاكي سلوك مكتبة @google-cloud/storage 7.19.0 **كما
//     تحقَّقنا منه فعلياً** في functions/node_modules/@google-cloud/storage
//     /build/cjs/src/file.js:1009 (`options = Object.assign({decompress:
//     true}, options)`) و:1065/:1104-1105 (`isCompressed && options.decompress`
//     → `zlib.createGunzip()`): حين لا يصل `{decompress:false}` تُعيد
//     المكتبة الحقيقية **JSON مفكوكاً بالفعل** (ملفّ مكتوب بـcontentEncoding:
//     gzip metadata) — لا بايتات gzip خامّة. القاعدة 37: اختبار يستبدل
//     الطبقة التي قد ترفض لا يفحصها؛ هذه الحاوية تُعيد بالضبط ما تُعيده
//     المكتبة الحقيقية في الحالتين، لا ما يفترضه الكود المُختبَر.
//
//     ⚠️ **الإثبات الحقيقي الوحيد لهذا الإصلاح تشغيل المستخدم القادم على
//     نفس شورت-آي-دي الثلاثة من طرفيّته (GOOGLE_APPLICATION_CREDENTIALS/
//     gcloud ADC) — لا هذا الاختبار.** هذا الاختبار صفر شبكة وصفر Storage
//     حقيقي؛ يُثبت فقط أن الكود يمرِّر {decompress:false} فعلياً وأن
//     الحالتين (معه/بدونه) تُنتجان ما تتوقّعه المكتبة الحقيقية — لا أن
//     bucket الحقيقي سيُعيد هذه البايتات بعينها.
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeSamples6 = [{t: 0, v: 1.1}, {t: 1, v: -2.2}, {t: 2, v: 3.3}];
  const gzBuf6 = zlib.gzipSync(Buffer.from(JSON.stringify(fakeSamples6), 'utf-8'));
  const decompressedBuf6 = Buffer.from(JSON.stringify(fakeSamples6), 'utf-8');

  function makeRealisticFakeBucket6({exists = true, forceNonGzipEvenWithFlag = false} = {}) {
    const downloadCalls = [];
    return {
      downloadCalls,
      file(p) {
        return {
          async exists() { return [exists]; },
          async download(options) {
            downloadCalls.push(options);
            if (forceNonGzipEvenWithFlag) return [decompressedBuf6];
            const decompress = !(options && options.decompress === false);
            return [decompress ? decompressedBuf6 : gzBuf6];
          },
        };
      },
    };
  }

  // ٦-أ — السكربت المُصلَح يمرِّر {decompress:false} فعلياً، فيستقبل gzip
  //        الخامّ من الحاوية الواقعية، ويفكّه بنفسه بنجاح — DOWNLOADED.
  {
    const bucket = makeRealisticFakeBucket6();
    const result = await fetchSamplesFromStorage(bucket, 'serverSamples/fake-scan-a.json.gz');
    eq(result.state, 'DOWNLOADED', '[٦-أ] الكود المُصلَح يُنتج DOWNLOADED مع حاوية تحاكي المكتبة الحقيقية');
    deepEq(result.samples, fakeSamples6, '[٦-أ] العيّنات المُستعادة تطابق الأصل حرفياً بعد فكّ الضغط');
    ok(bucket.downloadCalls.length === 1 && bucket.downloadCalls[0] && bucket.downloadCalls[0].decompress === false,
        '[٦-أ][الإصلاح الفعلي] fetchSamplesFromStorage يستدعي file.download({decompress:false}) فعلاً — لا استدعاء بلا خيارات');
  }
  console.log('تحقّق ٦-أ: fetchSamplesFromStorage يمرِّر {decompress:false} فعلاً، فيحصل على gzip خامّ من حاوية تحاكي المكتبة الحقيقية ويفكّه بنجاح');

  // ٦-ب — إثبات العطب الذي وقع فعلياً: لو نُودي download() **بلا** الإصلاح
  //        (بلا decompress:false) مقابل نفس الحاوية الواقعية، تصل بايتات
  //        مفكوكة أصلاً — ومحاولة gunzipSync عليها تفشل (Z_DATA_ERROR) تماماً
  //        كما وقع مع التقارير الثلاثة الحقيقية. هذا تحقّق على decompressSamples
  //        مباشرة (لا على الكود المُصلَح — ذلك ما كان يقع قبل هذا الالتزام).
  {
    const bucket = makeRealisticFakeBucket6();
    const file = bucket.file('serverSamples/fake-scan-a.json.gz');
    const [exists] = await file.exists();
    ok(exists, '[٦-ب][إعداد] الملفّ موجود');
    const [bufWithoutFix] = await file.download(); // بلا {decompress:false} — سلوك ما قبل الإصلاح
    let threwZDataError = false;
    try {
      decompressSamples(bufWithoutFix);
    } catch (e) {
      threwZDataError = (e && e.code) === 'Z_DATA_ERROR';
    }
    ok(threwZDataError, '[٦-ب][توثيق العطب] download() بلا decompress:false يُعيد JSON مفكوكاً فعلاً من حاوية واقعية — وgunzipSync عليه يرمي Z_DATA_ERROR، بالضبط عطب التقارير الثلاثة الحقيقية قبل هذا الإصلاح');
  }
  console.log('تحقّق ٦-ب: يُوثِّق العطب الحقيقي (Z_DATA_ERROR) الذي كان يقع بلا {decompress:false} — لا يُثبته بوصفه سلوكاً صحيحاً (القاعدة 23: هذا توثيق تشخيصي لا اختبار يحرس العطب)');

  // ٦-ج — بايتات لا تبدأ بعلامة gzip (1f 8b) حتى مع decompress:false —
  //        حالة صريحة DOWNLOADED_NOT_GZIP، لا فكّ بديل صامت ولا رمي غير مُلتقَط.
  {
    const bucket = makeRealisticFakeBucket6({forceNonGzipEvenWithFlag: true});
    const result = await fetchSamplesFromStorage(bucket, 'serverSamples/fake-scan-b.json.gz');
    eq(result.state, 'DOWNLOADED_NOT_GZIP', '[٦-ج][القاعدة 22] بايتات لا تحمل علامة gzip تُنتج حالة صريحة باسمها، لا رمي غير مُلتقَط ولا فكّ بديل');
    eq(result.samples, null, '[٦-ج] samples=null صراحة — لا مصفوفة مُختلَقة');
  }
  console.log('تحقّق ٦-ج: بايتات بلا علامة gzip تُنتج DOWNLOADED_NOT_GZIP صريحة — لا فكّ بديل صامت (القاعدة 22)');

  // ٦-د — FILE_NOT_FOUND يبقى مميَّزاً عن DOWNLOAD_ERROR (بنصّ exists()/الحالة
  //        لا بصنف استثناء — القاعدة 21).
  {
    const bucket = makeRealisticFakeBucket6({exists: false});
    const result = await fetchSamplesFromStorage(bucket, 'serverSamples/missing.json.gz');
    eq(result.state, 'FILE_NOT_FOUND', '[٦-د][القاعدة 21] غياب الملفّ (exists()===false) يُنتج FILE_NOT_FOUND مميَّزاً — لا DOWNLOAD_ERROR عامّاً');
  }
  console.log('تحقّق ٦-د: FILE_NOT_FOUND مميَّز عن DOWNLOAD_ERROR بحالة exists() صريحة لا بصنف استثناء (القاعدة 21)');

  // ٦-هـ — DOWNLOAD_ERROR يحمل errorCode/errorClass/errorMessage منقّاة
  //        (القاعدة 36)، لا رمياً غير مُلتقَط ولا رسالة خامّة غير محدودة.
  {
    const throwingBucket = {
      file() {
        return {
          async exists() { return [true]; },
          async download() {
            const err = new Error('Permission denied for token=SECRET-SHOULD-NOT-LEAK-ABCDEF1234567890 on https://storage.googleapis.com/x?X-Goog-Signature=abcdef0123456789abcdef0123456789');
            err.code = 403;
            throw err;
          },
        };
      },
    };
    const result = await fetchSamplesFromStorage(throwingBucket, 'serverSamples/forbidden.json.gz');
    eq(result.state, 'DOWNLOAD_ERROR', '[٦-هـ] فشل download() يُنتج DOWNLOAD_ERROR');
    eq(result.errorCode, 403, '[٦-هـ] errorCode محفوظ كما وصل');
    ok(typeof result.errorMessage === 'string' && !result.errorMessage.includes('SECRET-SHOULD-NOT-LEAK-ABCDEF1234567890'),
        '[٦-هـ][القاعدة 36] رسالة الخطأ المحفوظة لا تحمل قيمة token الخامّة');
    ok(!result.errorMessage.includes('abcdef0123456789abcdef0123456789'),
        '[٦-هـ][القاعدة 36] توقيع X-Goog-Signature المضمَّن في رسالة الخطأ مُنقّى');
  }
  console.log('تحقّق ٦-هـ: DOWNLOAD_ERROR يحمل errorMessage مُنقّاة فعلاً — لا تسريب لمقاطع تشبه توقيعاً/رمزاً من رسالة الخطأ الخامّة (القاعدة 36)');

  // ٦-و — exitCodeForSamplesFetchState: الدالّة الخالصة التي يعتمد عليها
  //        main() لرمز الخروج (main() نفسها لا تُستدعى هنا، راجع رأس الملفّ).
  eq(exitCodeForSamplesFetchState('DOWNLOADED'), 0, '[٦-و] DOWNLOADED → رمز خروج 0');
  for (const badState of ['DOWNLOAD_ERROR', 'FILE_NOT_FOUND', 'DOWNLOADED_NOT_GZIP', 'GUNZIP_ERROR', 'NOT_ATTEMPTED']) {
    eq(exitCodeForSamplesFetchState(badState), 1, `[٦-و] ${badState} → رمز خروج غير 0 (العيّنات غرض السكربت)`);
  }
  console.log('تحقّق ٦-و: exitCodeForSamplesFetchState يُعيد 0 لـDOWNLOADED وحدها، وغير 0 لكل حالة أخرى (البند ٢ من أمر هذه الجولة)');

  // ٦-ز — sanitizeErrorMessage: تنقية مستقلّة، لا استيراد من
  //        measure-resolveV7Report-live.js (راجع تعليق القرار في السكربت).
  {
    const msg = sanitizeErrorMessage(new Error('token=abcd1234efgh5678 Bearer xyz.abc-123_TOKEN'));
    ok(!msg.includes('abcd1234efgh5678'), '[٦-ز] sanitizeErrorMessage ينقّي قيمة token');
    ok(!msg.includes('xyz.abc-123_TOKEN'), '[٦-ز] sanitizeErrorMessage ينقّي قيمة Bearer');
    eq(sanitizeErrorMessage(undefined), 'undefined', '[٦-ز] مُدخل undefined لا يرمي — يُعامَل بـString() صراحة');
    eq(sanitizeErrorMessage({}), '[object Object]', '[٦-ز] مُدخل كائن بلا .message نصّي لا يرمي — يُعامَل بـString() صراحة');
  }
  console.log('تحقّق ٦-ز: sanitizeErrorMessage دالّة محلّية مستقلّة (لا استيراد من سكربت القياس الحيّ، راجع تعليق القرار) تنقّي أنماط شبيهة بتوكن/Bearer');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ — V8 نقل الخامّ، الجزء ٢ (القاعدة 41): المُدخل القابل لإعادة التشغيل من تقرير مُرحَّل (PRIVATE) = من تقرير لم يُرحَّل
  //     (EMBEDDED_LEGACY)، والإخفاء يسري على الخامّ المدموج، وABSENT معلَن برمز خروج غير 0.
  // ═══════════════════════════════════════════════════════════════════
  {
    const storedCount = goldenReport.rawFingerprint.timeSeries.samplesCount;
    const samples = Array.from({length: storedCount}, (_, i) => ({idx: i}));
    const rLegacy = await rawReadOf(goldenReport, null);
    const rPrivate = await rawReadOf(goldenReadable, goldenRawDoc);
    const rAbsent = await rawReadOf(goldenReadable, null);
    eq(rLegacy.state, 'EMBEDDED_LEGACY', '[٧] تقرير لم يُرحَّل → EMBEDDED_LEGACY');
    eq(rPrivate.state, 'PRIVATE', '[٧] تقرير مُرحَّل → PRIVATE');
    eq(rAbsent.state, 'ABSENT', '[٧] تقرير بلا خامّ → ABSENT');

    const fromLegacy = buildReplayInput(goldenReport, samples, rLegacy);
    const fromPrivate = buildReplayInput(goldenReadable, samples, rPrivate);
    eq(fromLegacy.rawState, 'EMBEDDED_LEGACY', '[٧] المخرَج يحمل الحالة (قديم)');
    eq(fromPrivate.rawState, 'PRIVATE', '[٧] المخرَج يحمل الحالة (جديد)');
    const {rawState: _l, ...legacyBody} = fromLegacy;
    const {rawState: _p, ...privateBody} = fromPrivate;
    deepEq(privateBody, legacyBody, '[٧][الأهمّ] المُدخل القابل لإعادة التشغيل (fingerprint + samplesSource + redaction + language) من الشكل الجديد = من القديم بالضبط');
    eq(fromPrivate.fingerprint.functionalResults.length, 85, '[٧] functionalResults (85) تصل من reportRaw — كانت تصير [] بصمت لو قُرئ المستند المقروء وحده');
    ok(fromPrivate.fingerprint.timeSeries.header && fromPrivate.fingerprint.timeSeries.footer, '[٧] header/footer من reportRaw.rawFingerprint');
    eq(fromPrivate.samplesSource.state, 'RESTORED_FROM_STORAGE', '[٧] وسلسلة العيّنات تُعاد تجميعها فوقه');

    // الإخفاء يسري على الخامّ المدموج: معرّفات حقيقية داخل reportRaw لا تصل المخرَج
    const leakyRaw = {...goldenRawDoc, sessionId: 'REAL-SESSION-IN-RAW-DOC', deviceFingerprintSha: 'REAL-SHA-IN-RAW-DOC'};
    const leakyReadable = {...goldenReadable, userId: 'REAL-UID-IN-READABLE'};
    const leaked = JSON.stringify(buildReplayInput(leakyReadable, null, await rawReadOf(leakyReadable, leakyRaw)));
    ok(!leaked.includes('REAL-SESSION-IN-RAW-DOC') && !leaked.includes('REAL-SHA-IN-RAW-DOC') && !leaked.includes('REAL-UID-IN-READABLE'),
        '[٧] sessionId/deviceFingerprintSha في reportRaw وuserId في المقروء: لا شيء منها يتسرّب (الإخفاء بعد الدمج)');

    const fromAbsent = buildReplayInput(goldenReadable, samples, rAbsent);
    eq(fromAbsent.rawState, 'ABSENT', '[٧] ABSENT معلَن في المخرَج');
    eq(fromAbsent.fingerprint.device, null, '[٧] ABSENT: fingerprint.device=null (لا بصمة مختلَقة)');
    deepEq(fromAbsent.fingerprint.functionalResults, [], '[٧] ABSENT: functionalResults فارغة — والسبب معلَن في rawState لا بالصمت');
    eq(exitCodeForRawState('ABSENT'), 1, '[٧] ABSENT → رمز خروج 1 (لا مُدخل لإعادة التشغيل)');
    eq(exitCodeForRawState('PRIVATE'), 0, '[٧] PRIVATE → 0');
    eq(exitCodeForRawState('EMBEDDED_LEGACY'), 0, '[٧] EMBEDDED_LEGACY → 0');
    let threw = null;
    try { buildReplayInput(goldenReport, null); } catch (e) { threw = e; }
    ok(threw && /rawRead/.test(threw.message), '[٧] بلا rawRead يُرفض (لا قراءة غياب الخامّ نجاحاً — القاعدة 22)');
    console.log('تحقّق ٧: القارئ على الشكلين — المُدخل واحد، الإخفاء بعد الدمج، وABSENT معلَن برمز خروج 1');
  }

  console.log(`\nexportV7ReplayInputsReadonly.test.js: ${n}/${n} assertions passed`);
}
})().catch((e) => {
  console.error('✗ exportV7ReplayInputsReadonly.test.js فشل:', e);
  process.exit(1);
});
