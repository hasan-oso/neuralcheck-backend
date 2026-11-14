// ===================================================
// serverRawSamplesStorage — القرار ٨٦ البند ٢ (نصّ الأمر حرفياً):
// "analyzeDevice يكتب ما استلمه من عيّنات كما استلمه، في كل فحص، إلى
// مسار في Storage منفصل عن مسار رفع التطبيق. ويكتب في مستند التقرير
// حقلين: المسار، وهل نجح الحفظ." والتعليل: "حفظ الملفّ الخام في مسار
// الشريك متروك لسباق داخل التطبيق (FirebaseSyncService.kt، مستودع آخر —
// لا يُتحقَّق منه هنا)، والخادم لا يحفظ العيّنات اليوم. المسار المنفصل
// يمنع أن يكتب كاتبان في الملفّ نفسه."
//
// ─── لماذا مسار منفصل لا نفس scans/{fingerprint}/{scanId}.ts.json.gz ────
// ذلك مسار التطبيق (storage.rules:19-21، `allow write: if request.auth
// != null`) — كاتبان (تطبيق + خادم) على نفس المسار يتسابقان. المقطع
// الأوّل هنا "serverSamples" حرفياً مختلف عن "scans"/"reports"/"shops" —
// الثلاثة الوحيدة التي تطابقها قواعد storage.rules الحالية (لا catch-all،
// rules_version='2' — أي مسار غير مُطابَق يُرفض افتراضياً). فالعميل لا
// يقرأ هذا المسار ولا يكتبه بلا أي تعديل على storage.rules (مُتحقَّق
// بالأداة: functions/scripts/verify-storage-path-unmatched.js — لا نشر
// لأي تعديل قواعد في هذه الجولة، القرار ٨٦).
//
// ─── القاعدة 20 ("الخام يُخزَّن حيث لا يقرؤه العميل") ────────────────────
// العيّنات نفسها (الخام) لا تدخل Firestore إطلاقاً هنا — تُكتب إلى Storage
// فقط، بمسار العميل لا يقرؤه (أعلاه). الحقلان اللذان يدخلان مستند
// reports/{scanId} (SERVER_SAMPLES_STORAGE_PATH_FIELD/SERVER_SAMPLES_SAVED_FIELD)
// نصّ مسار وقيمة منطقية — ليسا "الخام" — فلا يخالفان القاعدة 20 بذاتهما؛
// راجع تقرير مهمّة القرار ٨٦ البند ٢ لتفصيل قرار مكان هذين الحقلين
// (top-level لا aiAudit) وسببه.
//
// ─── بلا تحويل — القاعدة 20 بامتدادها ────────────────────────────────────
// samples يُسلسَل بـJSON.stringify حرفياً كما وصل — لا ×1000، لا ÷10، لا
// تنعيم، لا اختيار ذروة، لا قلب إشارة. نفس المصفوفة التي حذفتها
// lightenFingerprintForStorage.js:12 قبل الكتابة إلى Firestore.
// ===================================================

'use strict';

const zlib = require('zlib');
const {hashIdForLog} = require('../utils/logRedaction');
const {sanitizeFailureText} = require('../utils/failureText');

// مصدر واحد مُصدَّر لاسمَي الحقلين الجديدين على reports/{scanId} — القاعدة
// 24 موسَّعة ("كل قيمة حرفية يقوم عليها تمييز"): كل قارئ/كاتب مستقبلي
// يستورد هذين الثابتين، لا يكتب النصّ الحرفي في ملفّه.
const SERVER_SAMPLES_STORAGE_PATH_FIELD = 'serverSamplesStoragePath';
const SERVER_SAMPLES_SAVED_FIELD = 'serverSamplesSaved';

/**
 * مسار Storage الجديد — دالّة نقيّة، بلا I/O. منفصل عن
 * `scans/${deviceFingerprintSha}/${scanId}.ts.json.gz` (مسار رفع التطبيق،
 * analyzeDevice.js) بمقطع أوّل مختلف كلّياً ("serverSamples" لا "scans")،
 * ومفتاح بـscanId وحده (لا deviceFingerprintSha — ذاك قد يكون null حين
 * يصل header.deviceFingerprint فارغاً، وهذا الحفظ مطلوب "في كل فحص" بصرف
 * النظر عن ذلك).
 * @param {string} scanId
 * @return {?string} المسار، أو null إن غاب scanId (لا افتراض قيمة).
 */
function computeServerSamplesStoragePath(scanId) {
  if (typeof scanId !== 'string' || scanId.trim() === '') return null;
  return `serverSamples/${scanId}.json.gz`;
}

/** zlib.gzip غير متزامن — لا gzipSync، كي لا يحجب حلقة الأحداث أثناء نداء
 * النموذج الطويل الموازي (راجع تعليق الاستدعاء في analyzeDevice.js: هذا
 * الحفظ يبدأ متوازياً مع runAnalysisInternal لا بعده — "تصميم لا يزيد
 * زمن الدالّة"، أمر القرار ٨٦ البند ٢). قياس زمن الضغط الفعلي (بلا شبكة):
 * functions/scripts/measure-server-raw-samples-write.js.
 * @param {Buffer} buf
 * @return {Promise<Buffer>}
 */
function gzipAsync(buf) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buf, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

/**
 * يحفظ ما استلمه الخادم من عيّنات كما استلمه — بلا أي تحويل — إلى المسار
 * الجديد. فشل الحفظ **لا يُفشل التحليل**: يُعاد `{saved: false}` صراحةً،
 * لا رمي (نصّ الأمر: "فشل الحفظ لا يُفشل التحليل. يُسجَّل، ويُكتب الحقل
 * false").
 *
 * @param {Object} p
 * @param {Object} p.bucket admin.storage().bucket() — يُمرَّر لا يُستورَد
 *   هنا (نفس نمط rehydrateReportSamples.js:87-89 — قابلية اختبار بكعب
 *   بلا Storage حقيقي؛ صفر شبكة في اختبارات هذا الملف).
 * @param {string} p.scanId
 * @param {*} p.samples `fingerprint.timeSeries.samples` كما وصل — مصفوفة
 *   متوقَّعة؛ أي شيء آخر (undefined/null/فحص بلا timeSeries) يُعامَل
 *   "لا عيّنات لحفظها" صراحةً (القاعدة 22 — لا نجاح مُختلَق).
 * @return {Promise<{path: (?string), saved: boolean}>}
 */
async function saveServerRawSamples({bucket, scanId, samples}) {
  const path = computeServerSamplesStoragePath(scanId);
  if (!path) {
    console.error('[serverRawSamplesStorage] scanId غائب أو غير نصّي — لا مسار، لا حفظ');
    return {path: null, saved: false};
  }
  if (!Array.isArray(samples) || samples.length === 0) {
    console.warn(`[serverRawSamplesStorage] scanId=${hashIdForLog(scanId)}: لا عيّنات لحفظها ` +
        '(samples غائبة أو فارغة — فحص بلا timeSeries، أو مصفوفة فارغة فعلاً)');
    return {path, saved: false};
  }
  if (!bucket || typeof bucket.file !== 'function') {
    console.error(`[serverRawSamplesStorage] scanId=${hashIdForLog(scanId)}: bucket غير صالح — لا حفظ`);
    return {path, saved: false};
  }
  try {
    const json = JSON.stringify(samples);
    const gz = await gzipAsync(Buffer.from(json, 'utf-8'));
    await bucket.file(path).save(gz, {
      contentType: 'application/json',
      metadata: {contentEncoding: 'gzip'},
    });
    return {path, saved: true};
  } catch (e) {
    // القاعدة 36 تخصّ ردود مزوّدي نموذج (DeepSeek/Gemini) — هذا خطأ GCS
    // داخلي لا مزوّد نموذج، لكن حذراً بالمثل: لا كائن الخطأ الخام كاملاً (قد يحمل تفاصيل طلب HTTP داخلية).
    // S-SUB-2: نصّ خطأ GCS قد يحمل اسم الكائن serverSamples/<scanId>.json.gz (ومشفَّراً %2F في عنوان الطلب) — يُنقّى بالمنقّي الواحد (utils/failureText.js) والمعرّف معروف هنا،
    // فلا scanId خامّ ولا مسار كائن في السطر.
    // (يُحسب خارج نداء log: المعرّف الخامّ يدخل المنقّي وحده معروفاً ليُخفى، ولا يُطبَع — والحارس لا يرى هذا الفرق في وسيط نداء log فيرفضه.)
    const failure = sanitizeFailureText(e, {knownIds: [scanId]});
    console.error(`[serverRawSamplesStorage] فشل حفظ scanId=${hashIdForLog(scanId)} إلى serverSamples/<scanId>.json.gz: ${failure}`);
    return {path, saved: false};
  }
}

module.exports = {
  SERVER_SAMPLES_STORAGE_PATH_FIELD,
  SERVER_SAMPLES_SAVED_FIELD,
  computeServerSamplesStoragePath,
  saveServerRawSamples,
};
