// ===================================================
// rehydrateReportSamples — يُعمِّم نمط regenerate-report.js:301-306: كل
// قارئ لمستند تقرير مخزون يُعيد جلب العيّنات من Storage قبل أي حساب على
// Findings/categoryStates (P1.4، PLAN-01-ROADMAP.md §١٤ "A98"، البند ب)
// ===================================================
//
// ─── السبب (منقول من نصّ المهمّة) ────────────────────────────────────────
// lightenFingerprintForStorage.js:12 — `delete lightTimeSeries.samples`.
// **المستند المخزون في Firestore بلا عيّنات دائماً.** أي كود يقرأ
// `report.rawFingerprint` من مستند مخزون ويمرّره مباشرةً إلى
// computeFindings/computeCategoryStates يحصل على samples=[] فيسقط في فرع
// HARNESS_ERROR — لا لأن الفحص فعلاً بلا بيانات، بل لأن قارئاً نسي إعادة
// الجلب. `regenerate-report.js:301-306` يحمل الحلّ الصحيح الوحيد المكتوب
// حتى الآن، لكنه محلّي لذلك السكربت (سكان واحد مُسمّى بثوابت في الملف).
// هذا الملف يعزل *النمط* (لا التفاصيل الخاصّة بذلك السكربت) في src/ كي
// يستعمله أي قارئ مستقبلي — أوّلهم المرشَّح: دفعة إعادة التوليد في P1.6،
// التي بلا هذا الملف تُنتج فرع الـ45% (تعريف التغطية الجديد، القرار ١٠)
// على **كل** تقرير تُعيد توليده، لا فقط ما كان فعلاً غير مقيس.
//
// ─── ما هذا الملف يقدّمه، ولماذا دالّتان منفصلتان لا واحدة ──────────────
//   1. rehydrateFingerprintSamples(rawFingerprint, samples) — دمج نقي بلا
//      شبكة ولا Firestore ولا Storage. هذا بالضبط ما في
//      regenerate-report.js:301-306 معزولاً عن كل شيء آخر في ذلك الملف
//      (ثوابت السكان الواحد، محاذاة عدد البايتات، إلخ). قابل للاختبار
//      بمدخلات اصطناعية بلا أي كعب.
//   2. fetchSamplesFromStorage(storagePath) — الشبكة، عبر admin.storage()
//      (Cloud Functions runtime). **يختلف عمداً** عن أسلوب
//      regenerate-report.js (REST + `gcloud auth print-access-token`):
//      ذلك السكربت يعمل خارج بيئة Cloud Functions (لا service account
//      مربوطة تلقائياً)، فيحتاج هويّة gcloud المستخدم صراحةً. أي كود يعمل
//      *داخل* دالّة سحابية (أو سكربت إداري يُشغَّل بحساب خدمة له صلاحية
//      Storage، كما GOOGLE_APPLICATION_CREDENTIALS) يملك admin.storage()
//      جاهزاً بلا رمز وصول يدوي — هذا المسار الأخير هو ما يُعمَّم هنا.
//      سكربت مثل regenerate-report.js يبقى REST عمداً (يُشغَّل من حاسوب
//      مطوّر بهويّة gcloud شخصية، لا بهويّة الدالّة) — هذا الملف **لا
//      يُلغي** ذلك المسار ولا يعيد كتابته؛ يوفّر المسار الآخر لمكان آخر.
//   3. rehydrateReportFingerprint(reportData) — يُركِّب الاثنتين: يقرأ
//      reportData.timeSeriesStoragePath (الحقل الذي يكتبه analyzeDevice.js
//      فعلاً — راجع analyzeDevice.js:253-283)، يجلب، يدمج، يُعيد fingerprint
//      كاملاً صالحاً لتمريره إلى computeFindings/computeCategoryStates.
//
// ⚠️ **غير مُستهلَك من أي مسار حيّ في هذا المستودع اليوم.** لا قارئ حالي
// (verifyReport.js، generateReportPdf.js، evaluationContract.js) يحتاج
// إعادة حساب Findings/categoryStates من مستند مخزون — كلّها تقرأ
// aiResponse/report المُخزَّن مباشرة بلا إعادة تحليل. أول مستهلك حقيقي
// متوقَّع هو دفعة P1.6 (خارج نطاق هذه المهمّة صراحةً: "لا تبدأ P1.5" ولا
// أُمرت ببناء P1.6). هذا الملف بنية تحتية جاهزة — بنفس نمط findings.js في
// P1.1 ("قائمة بذاتها... تُختبَر ذهبياً هنا ثم تُوصَل لاحقاً") — لا وصلة
// مزيَّفة إلى مستهلك لا وجود له اليوم.
// ===================================================

'use strict';

const zlib = require('zlib');

/**
 * يدمج عيّنات مُعاد جلبها من Storage في rawFingerprint مخزون (عيّناته
 * محذوفة بـlightenFingerprintForStorage). نقي بالكامل — بلا شبكة، بلا
 * حالة مشتركة. نفس دمج regenerate-report.js:301-306 حرفياً، معزولاً.
 *
 * نسخة Storage قد تحمل footer أغنى من نسخة المستند (calibration،
 * earlyStopReason، preScanWarnings — راجع تعليق regenerate-report.js:296-300)؛
 * لهذا الدمج يفضّل samples من Storage فقط، ويُبقي كل حقل آخر (header/footer/
 * variables/functionalResults/...) كما وصل في rawFingerprint المخزون —
 * وهو "المُرسَل حرفياً" بحسب نفس التعليق، لا نسخة Storage الأغنى.
 *
 * @param {Object} rawFingerprint rawFingerprint كما وصل من مستند مخزون
 *   (report.rawFingerprint) — timeSeries.samples غائب أو مصفوفة فارغة.
 * @param {Array} samples العيّنات الكاملة كما جاءت من Storage.
 * @return {Object} fingerprint كامل — timeSeries.samples مملوءة، كل شيء
 *   آخر كما كان.
 */
function rehydrateFingerprintSamples(rawFingerprint, samples) {
  const docTs = (rawFingerprint && rawFingerprint.timeSeries) || {};
  return {
    ...(rawFingerprint || {}),
    timeSeries: {...docTs, samples: Array.isArray(samples) ? samples : []},
  };
}

/**
 * يجلب ملفّ العيّنات المضغوط (`{scanId}.ts.json.gz`) من Cloud Storage عبر
 * admin.storage() (بيئة Cloud Functions أو سكربت إداري بحساب خدمة) ويفكّ
 * ضغطه ويُحلّله. **لا** يستعمل REST/gcloud (ذلك مسار regenerate-report.js
 * المنفصل عمداً — راجع تعليق رأس الملف، بند 2).
 *
 * @param {Object} admin كائن firebase-admin المُهيَّأ (utils/admin.js:
 *   `const {admin} = require("../utils/admin")`) — يُمرَّر بدل استيراده
 *   هنا مباشرةً كي يبقى هذا الملف قابلاً للاختبار بكعب بلا Firestore حقيقي.
 * @param {string} storagePath المسار داخل الحاوية الافتراضية، كما يكتبه
 *   analyzeDevice.js:253-254 (`scans/{deviceFingerprintSha}/{scanId}.ts.json.gz`).
 * @return {Promise<Object>} محتوى ملفّ العيّنات المُفكَّك (عادةً
 *   `{header, footer, samples, variables}` أو مصفوفة samples فقط — الشكل
 *   يعتمد على ما رفعه التطبيق؛ هذه الدالّة لا تفترض أكثر من "JSON صالح
 *   بعد فكّ الضغط").
 */
async function fetchSamplesFromStorage(admin, storagePath) {
  if (!storagePath || typeof storagePath !== 'string') {
    throw new Error('fetchSamplesFromStorage: storagePath غائب أو غير نصّي — ' +
        'لا مسار لإعادة الجلب (انظر analyzeDevice.js:253: timeSeriesStoragePath ' +
        'يكون null إن غاب header.deviceFingerprint وقت الفحص)');
  }
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new Error(`fetchSamplesFromStorage: الملفّ غير موجود في Storage: ${storagePath}`);
  }
  const [buf] = await file.download();
  const json = zlib.gunzipSync(buf).toString('utf-8');
  return JSON.parse(json);
}

/**
 * يُركِّب fetchSamplesFromStorage + rehydrateFingerprintSamples: من مصدر الخامّ
 * المخزون إلى fingerprint صالح لتمريره إلى computeFindings/computeCategoryStates.
 *
 * V8 نقل الخامّ (2026-10-09): `rawFingerprint` و`timeSeriesStoragePath` صارا في
 * `reportRaw/{scanId}` لا في مستند التقرير المقروء. فالمصدر المُمرَّر هو **أيّ كائن يحمل
 * هذين الحقلين**: `readReportRaw(...).raw` (الحالتان PRIVATE وEMBEDDED_LEGACY — الأخيرة
 * تقرأهما من مستند تقرير ما قبل الترحيل)، أو مستند تقرير قديم مضمَّن مباشرةً. حالة
 * ABSENT (raw=null) ترمي صراحةً — لا يُقرأ غياب الخامّ نجاحاً (القاعدة 22).
 *
 * يرمي صراحةً (لا يُعيد null بصمت) إن غاب timeSeriesStoragePath — تلك
 * حالة حقيقية موثَّقة في هذا المستودع (analyzeDevice.js:248-252: يقع حين
 * وصل header.deviceFingerprint فارغاً وقت الفحص الأصلي)، والمستدعي هو من
 * يقرّر كيف يُعامِلها (على الأرجح HARNESS_ERROR بنفس منطق القرار ١٢ —
 * "غياب مُدخل حاكم" — لا اختراع قيمة هنا في طبقة عامّة لا تعرف سياق
 * الاستدعاء).
 *
 * @param {Object} admin كائن firebase-admin المُهيَّأ.
 * @param {?Object} reportData `readReportRaw(...).raw` (المسار الحالي)، أو `reportSnapshot.data()` لمستند
 *   قديم مضمَّن الخامّ، أو null (ABSENT) فيُرمى خطأ صريح.
 * @return {Promise<Object>} fingerprint كامل بعيّنات حقيقية.
 */
async function rehydrateReportFingerprint(admin, reportData) {
  const storagePath = reportData && reportData.timeSeriesStoragePath;
  if (!storagePath) {
    throw new Error('rehydrateReportFingerprint: لا timeSeriesStoragePath على هذا ' +
        'المستند — تعذّر التجهيز (لا "غير مقيس") — راجع القرار ١٢ في PLAN-01-ROADMAP.md');
  }
  const tsFromStorage = await fetchSamplesFromStorage(admin, storagePath);
  const samples = Array.isArray(tsFromStorage) ? tsFromStorage :
      (tsFromStorage && tsFromStorage.samples) || [];
  return rehydrateFingerprintSamples(reportData && reportData.rawFingerprint, samples);
}

module.exports = {
  rehydrateFingerprintSamples,
  fetchSamplesFromStorage,
  rehydrateReportFingerprint,
};
