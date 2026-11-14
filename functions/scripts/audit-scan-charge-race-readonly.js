#!/usr/bin/env node
'use strict';

// ===================================================================
// audit-scan-charge-race-readonly — قراءة فقط. الملحق الثاني بالقرار ١٠٤
// (2026-09-26 +03)، البند ٢ (ب). **لا يُشغَّل من هذا الوكيل** — القيد
// الصريح: "سكربت قراءة فقط، لا يشغّله، وأشغّله أنا في جلسة التشغيل
// الجافّ." المستخدم يشغّله من طرفيّته بمفتاح Admin SDK حقيقي.
// ===================================================================
//
// ─── السياق (مدقّق، بقراءة الكود عند 83e121a — analyzeDevice.js) ────────
// سباق حقيقي في exports.analyzeDevice، موثَّق بالسطر:
//   :359-363 idempotency-first — يعيد المستند الموجود *قبل* أي رصيد أو
//            نداء نموذج (db.collection("reports").doc(scanId).get()).
//   :439-466 معاملة scanClaims (runTransaction) — تقرأ الـclaim وحده،
//            **لا تُعيد فحص reportRef** داخل نفس المعاملة. claim TTL
//            300000ms (:440، CLAIM_TTL_MS — ثابت محلّي غير مُصدَّر، يُكرَّر
//            رقمه هنا حرفياً أدناه لعدم وجود export، القاعدة 24 — مُعلَن
//            لا مُخفى).
//   :650    reportRef.set(reportDocument) — **set لا create**: لا حماية
//           "ارفض إن كان المستند موجوداً بالفعل" على مستوى قاعدة البيانات.
//   :654    users/{userId}.update({scansRemaining: increment(-1), ...}) —
//           خصم فحصة، بلا أي مرجع scanId في الكتابة نفسها.
//   :777    claimRef.delete() في finally — تحرير الـclaim (best-effort،
//           .catch() يبتلع فشل الحذف).
// فنداءان متوازيان لنفس scanId (مثال حقيقي مُلتقَط في تعليق الكود،
// :421-431 — التوقيت eba424aa) قد يجتازان كلاهما idempotency-first (كلا
// المستنَدين "غير موجود" بعد) وclaim (TTL انتهت أثناء تشغيل الأوّل) معاً
// — فيُنتجان نداءَي نموذج، وخصمَين من scansRemaining، ومستنداً واحداً في
// النهاية (الثاني يطمس الأوّل بالكامل، set لا merge).
//
// ─── هل يوجد "سجلّ خصم" لكل فحص؟ لا — مُتحقَّق بقراءة functions/src كاملة ──
// الخصم الوحيد الموجود: users/{userId}.scansRemaining عبر
// admin.firestore.FieldValue.increment(-1) (analyzeDevice.js:654) — عدّاد
// إجمالي على مستند المستخدم، **بلا أي حقل/مجموعة تُسجِّل الخصم بمعرِّف
// scanId** (تحقّق: grep "scansRemaining\|scanHistory\|deviceProfiles" على
// src/ كاملة — لا نتيجة لأي "ledger"/"deductions" أو ما شابه بمعرِّف فحص).
// **فهذا السكربت لا يدّعي عدّ "فحوص خُصم لها أكثر من رصيد واحد"** — القيمة
// دائماً NOT_RECORDED (القاعدة 22: الغياب لا يُقرأ صفراً ولا يُعَدّ).
//
// ─── ما يُعَدّ فعلاً بدلاً من ذلك (أثر السباق غير المباشر) ───────────────
//   ١. staleScanClaims — مستندات scanClaims أقدم من CLAIM_TTL_MS عند لحظة
//      التشغيل. **لا يثبت وحده سباقاً مزدوجاً**: قد يعني عطلاً صلباً منع
//      الوصول إلى finally (:777) بلا أي نداء ثانٍ إطلاقاً، أو قد يعني
//      النافذة الموصوفة في تعليق الكود فعلاً (:421-431). الحالتان لا
//      تُميَّزان من بيانات scanClaims وحدها.
//   ٢. duplicateScanHistoryEntries — مستندات deviceProfiles حيث نفس
//      scanId يظهر أكثر من مرّة داخل scanHistory[] لنفس المستند. المصدر:
//      appendScanToHistory.js:73 (`[newEntry, ...currentHistory].slice(0,5)`)
//      **لا تتحقّق من وجود scanId سابق قبل الإلحاق** — فتكرار scanId يعني
//      نداءين مستقلّين وصلا خطوة appendScanToHistory لنفس الفحص. بما أنّ
//      reportRef.set (analyzeDevice.js:650) يسبق هذه الخطوة **في نفس
//      تسلسل الكود لكل نداء على حدة** (analyzeDevice.js:679 يلي :650
//      خطّياً)، وجود التكرار **أقرب دليل متاح فعلياً** على أن reportRef.set
//      نفّذ مرّتين لذلك scanId — لا إثبات مباشر من reports نفسها (انظر
//      أدناه). **محدودية مزدوجة**: (أ) لا profile لكل فحص أصلاً
//      (analyzeDevice.js:679: deviceProfileKey.a==="unknown_fp" يُسقِط
//      الفحص من أي profile كلّياً)، (ب) السجلّ يحتفظ بآخر 5 فقط (FIFO) —
//      سباق أقدم قد يكون دُفع خارج النافذة المرئية.
//
// ─── ما لا يُعَدّ إطلاقاً (مُعلَن لا مُخفى، القاعدة 22) ──────────────────
//   - "فحوص خُصم لها أكثر من رصيد واحد" — NOT_RECORDED (أعلاه، لا سجلّ
//     بمعرِّف فحص إطلاقاً — لا مجرّد عدم توفّر وصول، بل غياب بنيوي).
//   - "تقارير كُتبت مرّتين" **مباشرة من مستند reports نفسه** — NOT_RECORDED:
//     buildReportDocument (analyzeDevice.js:226-...) لا يحمل حقل نسخة أو
//     تأريخ كتابة متعدّد؛ .set() يطمس الكتابة السابقة بالكامل بلا أثر
//     يُقرأ لاحقاً — الكتابة الأولى تختفي تماماً، لا "يُقرأ" غيابها لاحقاً
//     كإثبات (القاعدة 22 بامتدادها: العدم لا يُصبح دليلاً بالاستنتاج
//     العكسي أيضاً). الاستدلال غير المباشر عبر (٢) أعلاه هو الأقرب المتاح،
//     لا بديل مباشر عنه.
//   - "عدد التقارير مقابل ما خُصم" — **لم يُحاوَل**: لا سجلّ لإجمالي ما
//     مُنح للمستخدم تاريخياً (تسجيل/تجديد اشتراك/كود ترويجي — كلّها تزيد
//     scansRemaining بقيم متفاوتة بلا سجلّ تراكمي منفصل يُقرأ اليوم)، فلا
//     أساس أزيد لمقارنة عدد reports.userId ضدّه؛ فرق كهذا قد ينشأ من أسباب
//     لا علاقة لها بالسباق (حذف تقرير يدوياً، فحص سابق للاشتراك الحالي) —
//     عدّه كان سيُضلِّل قارئ المخرَج لا يُوضِّح له، فلم يُحسَب.
//
// ─── projectId مثبَّت في الكود (كما في audit-device-profiles-readonly.js
// بعد 44b8d04) — نفس السبب: لا اعتماد على GOOGLE_CLOUD_PROJECT/مشروع
// gcloud الافتراضي المنسي. يُطبَع أوّل حقل. ───────────────────────────────
//
// ─── القاعدة 36 — لا معرِّف خام في المخرَج: scanId/userId/profileId كلّها
// تُهشَّر (SHA-256، 12 حرفاً أولى) قبل الطباعة، بنفس اصطلاح
// audit-device-profiles-readonly.js (hashId) — لا استثناء لـ"أمثلة scanId"
// المطلوبة: هي أيضاً مُهشَّرة، لتبقى قابلة للمطابقة بين حقلين من نفس
// التشغيل بلا كشف هوية حقيقية. **scanId الخام يُستعمَل داخلياً فقط** (بناء
// مسار reports/{scanId} للقراءة الإضافية أدناه — readReportTimeFields) —
// **لا يُطبَع في أي حقل من حقول المخرَج**؛ إن احتاج المستخدم المعرِّف
// الخام لمتابعة حالة بعينها، فذلك قراره هو يتّخذه بنفسه (مثلاً بمطابقة
// الهاش يدوياً على القاعدة) — هذا السكربت لا يعرضه. ──────────────────────
//
// Usage — PowerShell، بصيغة سكربت الأجهزة نفسها (audit-device-profiles-readonly.js):
//
//   Set-Location "<home>\wep\neuralcheck-backend\functions"
//   gcloud auth application-default login
//   $d = Get-Date -Format "yyyy-MM-dd"
//   try {
//     cmd /c "node scripts/audit-scan-charge-race-readonly.js > <home>\neuralcheck-workspace\evidence\scan-charge-race-audit-$d.json"
//   } finally {
//     gcloud auth application-default revoke --quiet
//   }
// ===================================================================

const crypto = require('crypto');

const PROJECT_ID = 'neuralchek-9b6d7';

// analyzeDevice.js:440 — CLAIM_TTL_MS محلّي غير مُصدَّر (راجع تعليق رأس
// الملفّ) — نفس القيمة حرفياً، مُكرَّرة بالضرورة لا اختياراً.
const CLAIM_TTL_MS = 300_000;

// أمثلة scanId محدودة العدد لكل عدّ (نصّ الأمر) — سقف معقول يمنع مخرَجاً
// ضخماً بلا فائدة تشخيصية إضافية.
const MAX_EXAMPLES = 10;

/**
 * تطبيق Firebase Admin منفصل، مُسمّى، بـprojectId صريح — نفس نمط
 * audit-device-profiles-readonly.js:initReadOnlyAdmin حرفياً (اسم مختلف
 * لتفادي تصادم "already initialized").
 * @return {{db: Object}}
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'audit-scan-charge-race-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

function hashId(id) {
  if (typeof id !== 'string' || !id) return null;
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
}

function nowPlus03() {
  const plus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return plus3.toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

// ═══════════════════════════════════════════════════════════════════════
// القرار ١٠٤ ملحق رابع (2026-09-26 +03) — أوقات الكتابة على duplicateScanHistoryEntries.
// نصّ المستخدم: "duplicateScanHistoryEntries أكبر من صفر: يُعرض عليّ قبل
// النشر، ومعه الفحوص وأوقات كتاباتها." الحقول ومصدرها (لا افتراض — بالسطر):
//   - scanHistory[].scanDate — functions/src/profiles/appendScanToHistory.js:52
//     (`scanDate: admin.firestore.Timestamp.now()`) — Firestore Timestamp،
//     واحد لكل ظهور للـscanId داخل scanHistory[] (قد يتكرّر — هذا بالضبط
//     ما نعدّه).
//   - reports/{scanId}.createdAt — functions/src/analysis/analyzeDevice.js:649
//     (`admin.firestore.FieldValue.serverTimestamp()`) — Firestore Timestamp،
//     يُحسَم على خادم Firestore عند الكتابة الفعلية.
//   - reports/{scanId}.analyzedAt — functions/src/analysis/analyzeDevice.js:275
//     (`analyzedAt: p.analyzedAtMs`) — **رقم** (epoch ms)، لا Firestore
//     Timestamp؛ أُضيف لاحقاً (القرار ٧٥ البند ٤) — تقارير أقدم قد لا
//     تحمله (FIELD_ABSENT، لا صفر ولا وقت افتراضي — القاعدة 22).
// ═══════════════════════════════════════════════════════════════════════

/**
 * يحوِّل Firestore Timestamp (له .toDate()) أو رقم epoch ms إلى نصّ ISO
 * بتوقيت +03 وملّي ثانية. لا يخمّن شكلاً ثالثاً — أي قيمة أخرى ترجع null
 * صراحةً (القاعدة 22، لا استثناء يُبتلَع).
 * @param {*} value
 * @return {?string} نصّ ISO مثل "2026-09-26T12:34:56.789+03:00"، أو null
 */
function toIso03Timestamp(value) {
  let d = null;
  if (value && typeof value.toDate === 'function') {
    d = value.toDate();
  } else if (typeof value === 'number' && isFinite(value)) {
    d = new Date(value);
  }
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const plus3 = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  return plus3.toISOString().replace('Z', '+03:00');
}

/**
 * حقل وقت واحد بحالته الصريحة — لا قيمة افتراضية تسدّ غياباً (القاعدة 22).
 * @param {*} rawValue القيمة الخام كما قُرئت من المستند/العنصر
 * @param {boolean} fieldPresentOnObject هل المفتاح موجود على الكائن أصلاً
 *   (Object.prototype.hasOwnProperty) — يُميِّز "غائب" عن "موجود بقيمة
 *   غير صالحة"
 * @return {{iso: ?string, status: string}}
 */
function buildTimeField(rawValue, fieldPresentOnObject) {
  if (!fieldPresentOnObject || rawValue === undefined || rawValue === null) {
    return {iso: null, status: 'FIELD_ABSENT'};
  }
  const iso = toIso03Timestamp(rawValue);
  if (iso === null) return {iso: null, status: 'INVALID_TYPE'};
  return {iso, status: 'PRESENT'};
}

/**
 * أوقات مستند reports/{scanId} (createdAt/analyzedAt) لـscanId واحد —
 * قراءة إضافية واحدة لكل scanId مكرَّر فقط (لا لكل الفحوص، تجنّباً لقراءة
 * غير ضرورية على كل تقرير في القاعدة).
 * @param {Object} readOnlyDb
 * @param {string} scanId خام (غير مُهشَّر) — يُستهلَك للقراءة فقط، لا يُطبَع
 * @return {Promise<Object>} {documentStatus, createdAt, analyzedAt}
 */
async function readReportTimeFields(readOnlyDb, scanId) {
  try {
    const doc = await readOnlyDb.collection('reports').doc(scanId).get();
    if (!doc.exists) {
      return {
        documentStatus: 'DOCUMENT_ABSENT',
        createdAt: {iso: null, status: 'DOCUMENT_ABSENT'},
        analyzedAt: {iso: null, status: 'DOCUMENT_ABSENT'},
      };
    }
    const data = doc.data() || {};
    return {
      documentStatus: 'EXISTS',
      createdAt: buildTimeField(data.createdAt, Object.prototype.hasOwnProperty.call(data, 'createdAt')),
      analyzedAt: buildTimeField(data.analyzedAt, Object.prototype.hasOwnProperty.call(data, 'analyzedAt')),
    };
  } catch (e) {
    const readError = String((e && e.message) || e);
    return {
      documentStatus: 'READ_ERROR',
      readError,
      createdAt: {iso: null, status: 'READ_ERROR'},
      analyzedAt: {iso: null, status: 'READ_ERROR'},
    };
  }
}

/**
 * يبني عنصر عدّ واحداً بالشكل المُلزَم (نصّ الأمر): value/definition/status
 * (COUNTED/NOT_RECORDED/READ_ERROR) + examples محدودة العدد.
 * @param {string} definition
 * @param {'COUNTED'|'NOT_RECORDED'|'READ_ERROR'} status
 * @param {?number} value
 * @param {Array<string>} [examples]
 * @param {?string} [note]
 * @return {Object}
 */
function makeCount(definition, status, value, examples, note) {
  return {
    definition, status, value: (typeof value === 'number') ? value : null,
    examplesHashed: Array.isArray(examples) ? examples.slice(0, MAX_EXAMPLES) : [],
    note: note || null,
  };
}

/**
 * يبني الخلاصة كاملة من db مُغلَّف (حقيقي أو مُزيَّف) — دالّة قابلة
 * للاستيراد المباشر (نفس نمط buildX() في مولّدات هذه الجلسة)، كي يختبرها
 * auditScanChargeRaceReadonly.test.js على db مُزيَّف بالكامل، بلا Admin SDK
 * ولا شبكة، ويُثبت أنها تعدّ عيّنة مصطنعة فيها سباق فعلياً — لا الغلاف
 * الكاتب (wrapReadOnly) وحده كما في الحارس الشقيق.
 * @param {Object} readOnlyDb db (مُغلَّف بـwrapReadOnly بالفعل قبل الاستدعاء)
 * @return {Promise<Object>} summary كما يُطبَع في main()
 */
async function buildSummary(readOnlyDb) {
  const summary = {
    projectId: PROJECT_ID, // أوّل حقل (نفس اصطلاح audit-device-profiles-readonly.js)
    generatedAtPlus03: nowPlus03(),
    claimTtlMsSource: 'analyzeDevice.js:440 (CLAIM_TTL_MS، محلّي غير مُصدَّر — القاعدة 24، مُعلَن لا مُخفى)',
    claimTtlMs: CLAIM_TTL_MS,
    counts: {
      // القيمة التي طُلبت أوّلاً — مُعلَنة NOT_RECORDED بنيوياً (راجع رأس الملفّ).
      scansChargedMoreThanOnce: makeCount(
          'فحوص (scanId) خُصم لها أكثر من رصيد واحد',
          'NOT_RECORDED', null, [],
          'لا سجلّ خصم بمعرِّف scanId في functions/src إطلاقاً — الخصم الوحيد الموجود ' +
          '(users/{userId}.scansRemaining، increment(-1)، analyzeDevice.js:653-654) عدّاد ' +
          'إجمالي على مستند المستخدم بلا أي مرجع scanId في الكتابة نفسها. لا يمكن اشتقاق هذا ' +
          'العدد من أي بيانات محفوظة اليوم — ليس نقصاً في هذا السكربت، بل غياب بنيوي في المخطَّط.'),
      reportsWrittenTwiceDirect: makeCount(
          'تقارير (reports/{scanId}) تحمل دليلاً مباشراً على أنها كُتبت أكثر من مرّة',
          'NOT_RECORDED', null, [],
          'buildReportDocument (analyzeDevice.js:226) لا يحمل حقل نسخة/عدّاد كتابة/تأريخ ' +
          'كتابات سابقة — reportRef.set (:650) يطمس أي كتابة سابقة بالكامل بلا أثر يبقى ' +
          'مقروءاً. لا يمكن التمييز بعد وقوعه بين مستند كُتب مرّة واحدة ومستند كُتب مرّتين ' +
          'من محتواه وحده.'),
      reportsCountVsChargedNotAttempted: makeCount(
          'مقارنة عدد تقارير المستخدم (reports.userId) بإجمالي ما خُصم منه تاريخياً',
          'NOT_RECORDED', null, [],
          'لم يُحاوَل: لا سجلّ لإجمالي ما مُنح للمستخدم تاريخياً (تسجيل/تجديد/كود ترويجي، كل ' +
          'منها يزيد scansRemaining بقيم متفاوتة بلا سجلّ تراكمي منفصل) — مقارنة بلا خطّ أساس ' +
          'موثوق تُضلِّل قارئ المخرَج لا توضِّح له، فلم تُحسَب.'),
      staleScanClaims: makeCount(
          'مستندات scanClaims أقدم من claimTtlMs عند لحظة التشغيل',
          'COUNTED', 0, [],
          'لا يثبت وحده سباقاً مزدوجاً فعلياً — قد يعني عطلاً صلباً منع الوصول إلى finally ' +
          '(analyzeDevice.js:777) بلا أي نداء ثانٍ إطلاقاً، أو النافذة الموصوفة في تعليق الكود ' +
          '(analyzeDevice.js:421-431) فعلاً. الحالتان لا تُميَّزان من هذه البيانات وحدها.'),
      duplicateScanHistoryEntries: makeCount(
          'مستندات deviceProfiles حيث نفس scanId يظهر أكثر من مرّة داخل scanHistory[]',
          'COUNTED', 0, [],
          'أقرب دليل متاح فعلياً على أن reportRef.set نفّذ مرّتين لنفس scanId (راجع رأس الملفّ ' +
          'للتسلسل الذي يجعل هذا استدلالاً لا إثباتاً مباشراً) — محدود بغياب profile لكل فحص ' +
          '(deviceProfileKey.a==="unknown_fp") وبسقف السجلّ الخمسة الأخيرة (FIFO). ' +
          'كل مكرَّر مُدرَج في examplesHashed يحمل الآن (القرار ١٠٤ ملحق رابع): ' +
          'scanHistoryTimestamps (وقت كل ظهور — appendScanToHistory.js:52 scanDate)، ' +
          'وreport.createdAt/report.analyzedAt (analyzeDevice.js:649/275) — كل وقت ' +
          '{iso, status}، status∈{PRESENT,FIELD_ABSENT,INVALID_TYPE,DOCUMENT_ABSENT,READ_ERROR} ' +
          '(القاعدة 22 — لا صفر ولا وقت افتراضي).'),
    },
  };

  // ─── ١. scanClaims المتبقّية ─────────────────────────────────────────
  try {
    const now = Date.now();
    const claimsSnap = await readOnlyDb.collection('scanClaims').get();
    const staleExamples = [];
    let staleCount = 0;
    for (const doc of claimsSnap.docs) {
      const data = doc.data() || {};
      const claimedAtMs = typeof data.claimedAtMs === 'number' ? data.claimedAtMs : null;
      if (claimedAtMs === null) continue; // لا نقرأ الغياب تقادماً — القاعدة 22
      const ageMs = now - claimedAtMs;
      if (ageMs > CLAIM_TTL_MS) {
        staleCount++;
        if (staleExamples.length < MAX_EXAMPLES) {
          staleExamples.push({scanIdHash: hashId(doc.id), ageMs});
        }
      }
    }
    summary.counts.staleScanClaims.value = staleCount;
    summary.counts.staleScanClaims.examplesHashed = staleExamples;
    summary.scanClaimsTotalDocs = claimsSnap.size;
  } catch (e) {
    summary.counts.staleScanClaims.status = 'READ_ERROR';
    summary.counts.staleScanClaims.readError = String((e && e.message) || e);
  }

  // ─── ٢. deviceProfiles.scanHistory[] بمعرِّف scanId مكرَّر — ومعه أوقات
  // الكتابة (القرار ١٠٤ ملحق رابع): كل ظهور في scanHistory (scanDate)، ثم
  // reports/{scanId}.createdAt/.analyzedAt (قراءة إضافية واحدة لكل scanId
  // مكرَّر فقط، لا لكل تقرير في القاعدة). ─────────────────────────────────
  try {
    const profilesSnap = await readOnlyDb.collection('deviceProfiles').get();
    const dupExamples = [];
    let dupProfileCount = 0;
    let profilesScanned = 0;
    for (const doc of profilesSnap.docs) {
      profilesScanned++;
      const data = doc.data() || {};
      const scanHistory = Array.isArray(data.scanHistory) ? data.scanHistory : [];
      // بالترتيب المُشاهَد في scanHistory (الأحدث أوّلاً، appendScanToHistory.js:73)
      // — sid → [{iso,status}, ...] لكل ظهور، لا عدّ فقط.
      const occurrencesBySid = new Map();
      for (const entry of scanHistory) {
        const sid = entry && typeof entry.scanId === 'string' ? entry.scanId : null;
        if (!sid) continue;
        const hasScanDate = !!entry && Object.prototype.hasOwnProperty.call(entry, 'scanDate');
        const timeField = buildTimeField(entry.scanDate, hasScanDate);
        if (!occurrencesBySid.has(sid)) occurrencesBySid.set(sid, []);
        occurrencesBySid.get(sid).push(timeField);
      }
      const dupEntries = [...occurrencesBySid.entries()].filter(([, occ]) => occ.length > 1);
      if (dupEntries.length > 0) {
        dupProfileCount++;
        if (dupExamples.length < MAX_EXAMPLES) {
          const duplicateScanIdHashes = [];
          for (const [sid, scanHistoryTimestamps] of dupEntries) {
            // قراءة reports/{scanId} — مرّة واحدة لكل scanId مكرَّر مُدرَج
            // في الأمثلة فقط (لا لكل مكرَّر في القاعدة كلّها إن تجاوز
            // MAX_EXAMPLES في هذا الملفّ الواحد — نادر عملياً، لكن مُتّسق
            // مع سقف الأمثلة نفسه).
            const report = await readReportTimeFields(readOnlyDb, sid);
            duplicateScanIdHashes.push({
              scanIdHash: hashId(sid),
              occurrences: scanHistoryTimestamps.length,
              scanHistoryTimestamps,
              report,
            });
          }
          dupExamples.push({profileIdHash: hashId(doc.id), duplicateScanIdHashes});
        }
      }
    }
    summary.counts.duplicateScanHistoryEntries.value = dupProfileCount;
    summary.counts.duplicateScanHistoryEntries.examplesHashed = dupExamples;
    summary.deviceProfilesTotalDocs = profilesScanned;
  } catch (e) {
    summary.counts.duplicateScanHistoryEntries.status = 'READ_ERROR';
    summary.counts.duplicateScanHistoryEntries.readError = String((e && e.message) || e);
  }

  return summary;
}

async function main() {
  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);
  const summary = await buildSummary(readOnlyDb);
  console.log(JSON.stringify(summary, null, 2));
}

// ─── حارس عدم الكتابة — نفس نمط audit-device-profiles-readonly.js حرفياً
// (Proxy على db/collection/doc، يرمي قبل أي set/update/delete/add/batch/
// runTransaction). ────────────────────────────────────────────────────
function wrapReadOnly(db) {
  function throwOnWrite(name) {
    return () => { throw new Error(`TRAP: write operation "${name}" is forbidden in this read-only audit script`); };
  }
  function wrapDocRef(docRef) {
    return new Proxy(docRef, {
      get(target, prop) {
        if (['set', 'update', 'delete'].includes(prop)) return throwOnWrite(`doc.${String(prop)}`);
        if (prop === 'collection') return (...args) => wrapCollectionRef(target.collection(...args));
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }
  function wrapCollectionRef(colRef) {
    return new Proxy(colRef, {
      get(target, prop) {
        if (['add'].includes(prop)) return throwOnWrite(`collection.${String(prop)}`);
        if (prop === 'doc') return (...args) => wrapDocRef(target.doc(...args));
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }
  return new Proxy(db, {
    get(target, prop) {
      if (['batch', 'runTransaction'].includes(prop)) return throwOnWrite(`db.${String(prop)}`);
      if (prop === 'collection') return (...args) => wrapCollectionRef(target.collection(...args));
      if (prop === 'doc') return (...args) => wrapDocRef(target.doc(...args));
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

module.exports = {
  wrapReadOnly, hashId, makeCount, buildSummary, PROJECT_ID, CLAIM_TTL_MS, MAX_EXAMPLES,
  toIso03Timestamp, buildTimeField, readReportTimeFields,
};

if (require.main === module) {
  main().catch((e) => {
    console.error('✗ توقّف بخطأ:', e && e.stack || e);
    process.exit(1);
  });
}
