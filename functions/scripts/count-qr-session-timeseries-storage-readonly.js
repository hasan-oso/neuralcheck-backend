#!/usr/bin/env node
'use strict';

// ===================================================================
// count-qr-session-timeseries-storage-readonly — قراءة فقط. أمر مستخدم
// 2026-09-25 +03 (القرار ٨٦ البند ٣): "سكربت قراءة فقط، يكتبه backend-
// engineer ولا يشغّله، وأشغّله أنا: يعدّ تقارير جلسات QR في الإنتاج التي
// يوجد لها كائن في Storage عند timeSeriesStoragePath، والتي لا يوجد لها.
// للعلم، لا شرط توقّف فيه."
//
// **لا تُشغَّل من هذا الوكيل (القيد الصريح: "تكتبه ولا تشغّله")** —
// المستخدم يشغّلها من طرفيّته ببيانات اعتماد Admin SDK حقيقية على مشروع
// neuralchek-9b6d7.
//
// ─── لماذا هذا السكربت (السياق، القرار ٨٦ البند ٢) ───────────────────
// timeSeriesStoragePath هو مسار رفع **التطبيق** (`scans/{deviceFingerprintSha}
// /{scanId}.ts.json.gz`، analyzeDevice.js) — "حفظ الملفّ الخام في مسار
// الشريك متروك لسباق داخل التطبيق" (نصّ القرار ٨٦ البند ٢). هذا السكربت
// يقيس حجم تلك الفجوة فعلياً في الإنتاج: كم من تقارير جلسات QR (فحوص محلّ،
// لا فحص صاحب الحساب المباشر) تفتقد الكائن المتوقَّع في Storage رغم أن
// المستند نفسه يحمل مساراً له. **لا يقرأ ولا يذكر serverSamplesStoragePath**
// (الحقل الجديد الذي يكتبه الخادم نفسه، القرار ٨٦ البند ٢) — هذا خارج
// نطاق هذا السكربت تحديداً؛ نصّ الأمر يخصّ timeSeriesStoragePath وحده.
//
// ─── "جلسات QR" — التعريف بنصّ الأمر ───────────────────────────────────
// "جلسات QR تُعرَّف من المستند: sessionId غير null." — فحص صاحب المحل
// المباشر (sessionId=null، buildReportDocument.js: `sessionId: p.isSessionScan
// ? p.sessionId : null`) خارج العدّ. الاستعلام: `reports` حيث
// `sessionId != null`. ملاحظة Firestore: هذا المرشِّح **يستبعد أيضاً أي
// مستند لا يحمل حقل sessionId إطلاقاً** (لا يساوي null فقط، بل الحقل
// غائب بنيوياً) — لا أثر عملي هنا لأن buildReportDocument يكتب sessionId
// دائماً (null أو قيمة)، فكل مستند حديث يحمل الحقل فعلياً؛ مستندات قديمة
// جداً قد تسبق هذا الحقل (إن وُجدت) تُستبعَد بنفس منطق "ليست جلسة QR
// مُعلَنة" — لا خطأ، توثيق فقط.
//
// ─── V8 نقل الخامّ (الجزء ٢، 2026-10-09): sessionId وtimeSeriesStoragePath
// خرجا من reports/{scanId} إلى reportRaw/{scanId} (التقارير الجديدة والمُرحَّلة)،
// ويبقيان مضمَّنَين في تقارير لم تُرحَّل بعد. فالعدّ صار على الموضعين معاً، بلا
// ازدواج: مستند reportRaw موجود ⇒ هو المرجع (readReportRaw: PRIVATE)، وإلا فالمضمَّن
// (EMBEDDED_LEGACY). وتُعدّ المصادر منفصلة في sources. بعد أن يقول --verify في
// migrate-report-raw.js «0 باقياً» يصير الاستعلام على reports بلا نتائج ويُحذف فرعه.
//
// ─── القراءة — بنمط export-v6-report-readonly.js/audit-device-profiles-
// readonly.js ─────────────────────────────────────────────────────────
//   - wrapReadOnly(db) يمنع أي كتابة Firestore عرضية (يرمي قبل أي
//     set/update/delete/batch/runTransaction — القاعدة 16: أداة، لا وعد).
//   - Storage: `bucket.file(path).exists()` **وحدها** — لا save/delete/
//     upload/download في أي مسار من هذا الملفّ. هذا هو الحاجز الوحيد على
//     Storage (لا Proxy مماثل لـwrapReadOnly، لأن الكود لا يستدعي شيئاً
//     غير .exists() أصلاً — القيد الصريح في نصّ الأمر).
//   - projectId مثبَّت في الكود (نفس PROJECT_ID المُصدَّرة من
//     audit-device-profiles-readonly.js — القاعدة 24، مصدر واحد) ومطبوع
//     **أوّل حقل** في المخرَج.
//   - storageBucket مثبَّت أيضاً — نفس القيمة الحقيقية المستعملة فعلاً في
//     regenerate-report.js:57/measure-deepseek-only-variance.js:86
//     (`neuralchek-9b6d7.firebasestorage.app`) — لا تخمين، ولا اعتماد على
//     استدلال ضمني قد يخطئ خارج بيئة Cloud Functions (نفس تعليل تثبيت
//     projectId في audit-device-profiles-readonly.js).
//
// ─── المخرَج — أعداد بلا معرّفات (القاعدة 36) ───────────────────────────
// لا scanId ولا sessionId ولا shortId ولا مسار Storage الحقيقي يُطبَع —
// أعداد فقط. الأخطاء (فشل .exists() نفسها — صلاحية/شبكة، لا "الملفّ غير
// موجود" فذلك نتيجة صحيحة exists=false لا خطأ) تُجمَّع منفصلة عن
// withoutStorageObject (القاعدة 22 — لا يُقرأ عطب القراءة "لا يوجد
// كائن")، وتُوصَف بـe.code واسم الصنف (`e.constructor.name`) وحدهما — لا
// e.message كاملة (قد تحمل مساراً أو تفصيلاً داخلياً، القاعدة 36 بامتدادها
// لأي رسالة خطأ من مزوّد خدمة خارجي، لا مزوّد نموذج فقط).
//
// ─── لا شرط توقّف (نصّ الأمر صراحة) ──────────────────────────────────────
// لا `process.exit`/`throw` قبل اكتمال العدّ الكامل مهما كانت النتائج —
// خلافاً لسكربتات أخرى في هذا المستودع (audit-device-profiles-readonly.js
// مثلاً) التي تحمل شرط توقّف صريحاً واحداً. هذا السكربت للعدّ الإحصائي
// وحده.
//
// Usage (يُشغِّله المستخدم من طرفيّته، بصلاحية Admin SDK حقيقية —
// GOOGLE_APPLICATION_CREDENTIALS أو بيئة gcloud مصادَق عليها بدور يقرأ
// Firestore + Storage على مشروع neuralchek-9b6d7 — قراءة فقط):
//   node functions/scripts/count-qr-session-timeseries-storage-readonly.js > evidence/qr-session-timeseries-storage-count-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const {readReportRaw, RAW_STATE, REPORT_RAW_COLLECTION} = require('../src/analysis/reportRawStore');

// نفس القيمة الحقيقية المستعملة فعلاً في regenerate-report.js:57 و
// measure-deepseek-only-variance.js:86 — لا تخمين، لا نسخة ثانية من رقم
// اشتقاق (القاعدة 24 بامتدادها على قيمة حرفية تُستهلَك في أكثر من ملفّ،
// وإن كانت كل نسخة اليوم مكتوبة حرفياً بدل استيراد مصدر واحد — ذلك
// انجراف قائم سابقاً في هذين الملفّين، لا يُصلَح هنا، خارج نطاق هذه المهمّة).
const STORAGE_BUCKET = 'neuralchek-9b6d7.firebasestorage.app';

/**
 * تطبيق Firebase Admin منفصل، مُسمّى، بـprojectId/storageBucket صريحين —
 * لا يلمس التطبيق الافتراضي في src/utils/admin.js (نفس تعليل
 * audit-device-profiles-readonly.js: تعديل ذلك المصدر كان سيغيّر سلوك
 * الإنتاج لهدف تشخيصي بحت).
 * @return {{db: Object, bucket: Object}}
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'count-qr-session-timeseries-storage-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET}, appName);
  return {db: app.firestore(), bucket: app.storage().bucket()};
}

function nowPlus03() {
  const plus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return plus3.toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

/**
 * جلسات QR (sessionId != null) من الموضعين بلا ازدواج. select() يقتصر على الحقلين المطلوبين — لا نجلب المستند كاملاً
 * (rawFingerprint/aiAudit كبيران) لسكربت عدّ.
 * @param {{db: Object}} p db من Admin SDK (أو مغلَّف wrapReadOnly).
 * @return {Promise<{entries: Array<{source: string, path: *}>, embeddedShadowedByReportRaw: number}>}
 */
async function collectQrSessionReports({db}) {
  const byId = new Map();
  const rawSnap = await db.collection(REPORT_RAW_COLLECTION)
      .where('sessionId', '!=', null).select('sessionId', 'timeSeriesStoragePath').get();
  for (const doc of rawSnap.docs) {
    byId.set(doc.id, {source: RAW_STATE.PRIVATE, path: doc.get('timeSeriesStoragePath')});
  }

  let embeddedShadowedByReportRaw = 0;
  const legacySnap = await db.collection('reports')
      .where('sessionId', '!=', null).select('sessionId', 'timeSeriesStoragePath').get();
  for (const doc of legacySnap.docs) {
    if (byId.has(doc.id)) { embeddedShadowedByReportRaw++; continue; } // reportRaw يعدّه جلسة QR: المرجع
    const embedded = {sessionId: doc.get('sessionId'), timeSeriesStoragePath: doc.get('timeSeriesStoragePath')};
    const rawRead = await readReportRaw({db, scanId: doc.id, reportData: embedded});
    if (rawRead.state === RAW_STATE.PRIVATE) { embeddedShadowedByReportRaw++; continue; } // reportRaw موجود ولا يعدّه جلسة
    byId.set(doc.id, {source: RAW_STATE.EMBEDDED_LEGACY, path: embedded.timeSeriesStoragePath});
  }
  return {entries: Array.from(byId.values()), embeddedShadowedByReportRaw};
}

async function main() {
  const {db, bucket} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const summary = {
    projectId: PROJECT_ID, // أوّل حقل (نفس اصطلاح audit-device-profiles-readonly.js)
    storageBucket: STORAGE_BUCKET,
    generatedAtPlus03: nowPlus03(),
    // "جلسات QR" = reports حيث sessionId != null (نصّ الأمر الحرفي).
    totalQrSessionReports: 0,
    // timeSeriesStoragePath غائب/فارغ على المستند نفسه — لا شيء لفحصه في
    // Storage أصلاً (القاعدة 22: حالة ثالثة صريحة، لا تُطوى في "بلا كائن").
    pathMissingOnDocument: 0,
    withStorageObject: 0,
    withoutStorageObject: 0,
    // من أين جاء كلّ تقرير (V8 نقل الخامّ): PRIVATE = reportRaw/{scanId}، EMBEDDED_LEGACY = مضمَّن في تقرير لم يُرحَّل.
    sources: {[RAW_STATE.PRIVATE]: 0, [RAW_STATE.EMBEDDED_LEGACY]: 0},
    // تقارير ما زال فيها sessionId مضمَّناً لكنّ لها مستند reportRaw لا يعدّها جلسة QR — لا تُعدّ (المرجع reportRaw).
    embeddedShadowedByReportRaw: 0,
    // فشل نداء .exists() نفسه (صلاحية/شبكة) — منفصل عن withoutStorageObject.
    checkErrors: 0,
    // أعداد الأخطاء بحسب {code, className} فقط — بلا معرِّف ولا رسالة
    // كاملة (القاعدة 36). مفتاح نصّي "code|className" → عدد التكرار.
    checkErrorsByCodeAndClass: {},
  };

  const collected = await collectQrSessionReports({db: readOnlyDb});
  summary.embeddedShadowedByReportRaw = collected.embeddedShadowedByReportRaw;

  for (const entry of collected.entries) {
    summary.totalQrSessionReports++;
    summary.sources[entry.source]++;
    const path = entry.path;
    if (typeof path !== 'string' || path.trim() === '') {
      summary.pathMissingOnDocument++;
      continue;
    }
    try {
      const [exists] = await bucket.file(path).exists();
      if (exists) summary.withStorageObject++;
      else summary.withoutStorageObject++;
    } catch (e) {
      summary.checkErrors++;
      const code = (e && e.code !== undefined) ? String(e.code) : 'NO_CODE';
      const className = (e && e.constructor && e.constructor.name) || 'UnknownError';
      const key = `${code}|${className}`;
      summary.checkErrorsByCodeAndClass[key] = (summary.checkErrorsByCodeAndClass[key] || 0) + 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((e) => {
    // خطأ غير متوقَّع في السكربت نفسه (لا في نداء .exists() فردي، ذلك
    // مُعالَج أعلاه ضمن الحلقة) — code/className فقط، لا رسالة قد تحمل
    // تفصيلاً داخلياً (القاعدة 36 بامتدادها).
    console.error(JSON.stringify({
      fatalError: true,
      code: (e && e.code !== undefined) ? String(e.code) : 'NO_CODE',
      className: (e && e.constructor && e.constructor.name) || 'UnknownError',
    }));
    process.exitCode = 1;
  });
}

module.exports = {initReadOnlyAdmin, STORAGE_BUCKET, collectQrSessionReports};
