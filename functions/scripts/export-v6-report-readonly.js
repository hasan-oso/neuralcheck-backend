#!/usr/bin/env node
'use strict';

// ===================================================================
// export-v6-report-readonly — قراءة فقط لمستند reports/{scanId} واحد،
// يحذف المعرِّفات بالمسار الكامل (لا مفتاح الجذر وحده) قبل الطباعة على
// stdout. أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٦، مُصحَّح في
// الجولة الثالثة بعد قياس المدقّق بالأداة): "سكربت تصدير لمستند V6 واحد،
// قراءة فقط، يحذف userId وكل معرّف ويطبع ما حذفه — يشغّله المستخدم؛
// المصدَّر في evidence/ لا في مستودع." **لا تُشغَّل من هذا الوكيل (القيد
// الصريح: "تكتبه ولا تشغّله")** — المستخدم يشغّلها من طرفيّته ببيانات
// اعتماد Admin SDK حقيقية.
//
// ⚠️ **تصحيح وصف (2026-09-24 +03، الجولة الرابعة)**: "يطبع ما حذفه" أعلاه
// نقلٌ حرفي لنصّ الأمر الأصلي — لا وصف دقيق للسلوك الفعلي. **أسماء الحقول
// المحذوفة/المُستبدَلة تُكتب داخل المخرَج الواحد (stdout) تحت مفتاحَي
// `removedFields`/`replacedFields` من كائن JSON واحد**، لا تُطبَع سطراً
// منفصلاً على الطرفية. وبما أن الاستعمال الموثَّق أدناه يُعيد توجيه stdout
// كاملاً إلى ملفّ (`> evidence/....json`)، فهذا الكائن — بما فيه
// removedFields/replacedFields — **لا يظهر على شاشة الطرفية إطلاقاً في
// الاستعمال المعتاد**؛ يصل الملفّ فقط، ويُقرأ بفتحه بعد التشغيل.
// ===================================================================
//
// ⚠️ **إصلاح الجولة الثالثة (القاعدة 16 — الأداة سبقت الفحص اليدوي في
// النسخة الأولى، فأخفقت)**: النسخة الأولى حذفت مفاتيح الجذر فقط
// (`userId`/`sessionId`/`deviceFingerprintSha`/`timeSeriesStoragePath`) —
// فأبقت أربعة معرِّفات فعلية حقيقية لم تُلمَس: `shortId` (رمز /verify
// العامّ)، `rawFingerprint.timeSeries.header.scanId`،
// `rawFingerprint.device.deviceProfileKey` (وحروفه a..f — العقد §١١)، ولم
// تُبدِّل `rawFingerprint.timeSeries.header.deviceFingerprint` (نفس بصمة
// `deviceFingerprintSha` مكرَّرة داخل الخام). القائمة أدناه مُشتقّة من
// شكل الكتابة الفعلي عند `42aa5ba:functions/src/analysis/analyzeDevice.js:275-300`
// (آخر التزام V6 خالص، قبل استخراج `buildReportDocument`) و`lightenFingerprintForStorage.js`
// (مطابق حرفياً بين `42aa5ba` وHEAD — تحقّق بـ`git show 42aa5ba:... | diff`)
// — لا اجتهاد حرّ، لكنه يبقى اجتهاداً مهندساً (القاعدة 13) في *تصنيف* كل
// حقل "معرِّفاً" أم لا؛ "العقد" الحرفي الذي يُسمّي هذه الحقول لم يصلني بعد
// (راجع القسم أسفله).
//
// ─── معرِّفات تُحذَف بالكامل (المسار الكامل من جذر المستند) ────────────
//   userId                — صاحب الحساب.
//   sessionId              — جلسة محل (تربط الفحص بحساب صاحب المحل).
//   deviceFingerprintSha   — بصمة SHA-256 حقيقية للجهاز.
//   timeSeriesStoragePath  — يحمل deviceFingerprintSha كاملاً داخل المسار.
//   rawFingerprint.timeSeries.header.deviceFingerprint — **نفس** بصمة
//     deviceFingerprintSha مكرَّرة هنا (rawFingerprint.timeSeries.header
//     يحمل نسخة الجهاز الأصلية) — حذف deviceFingerprintSha وحده كان
//     يُسرِّبها من هنا (القاعدة 22 — تصريح ناقص).
//   rawFingerprint.device.deviceProfileKey — الكائن كاملاً (a..f، أسماء
//     R8 — العقد §١١) — معرِّف جهاز مستقلّ تماماً عن deviceFingerprintSha.
//   rawFingerprint.timeSeries.footer.samplesSha256 (أُضيف 2026-09-24 +03،
//     الجولة الرابعة — مراجعة v6-report-review-2026-09-24.md، خارج هذا
//     المستودع) — بصمة عيّنات هذا الفحص وحده، مقبض فريد له كالـscanId؛
//     والعرض لا يقرؤها في أي مسار (تحقّق: grep "samplesSha256" على
//     functions/src صفر نتيجة). **يُحذف لا يُستبدل** — لا قارئ يعتمد على
//     حضور المفتاح.
//
// ─── معرِّفات تُستبدَل بعلامة ثابتة موسومة (لا تُحذَف) ──────────────────
// نصّ الأمر: "shortId وscanId يُستبدلان بقيمة ثابتة موسومة ولا يُحذفان،
// لأن قرّاء الموقع يفتحون المستند بهما" — أي مسار اسمه الأخير حرفياً
// `shortId` أو `scanId` (وليس فقط جذر المستند — نفس الاسم داخل
// rawFingerprint.timeSeries.header أيضاً، ومعرِّف الوسيط scanId في مخرَج
// هذا السكربت نفسه، القاعدة 36 — مخرَج مُصدَّر لملفّ evidence/ يجب ألّا
// يحمل القيمة الحقيقية حتى لو كتبها المُشغِّل نفسه سطر أوامر):
//   shortId
//   rawFingerprint.timeSeries.header.scanId
//   scanId (في غلاف مخرَج هذا السكربت نفسه — راجع main())
//   aiResponse.shortId (أُضيف 2026-09-24 +03، الجولة الرابعة — مراجعة
//     v6-report-review-2026-09-24.md: "نسخة ثانية من shortId داخل
//     aiResponse. السكربت استبدل نسخة الجذر وحدها" — النسخة الأولى من هذا
//     السكربت أخفقت عن هذا المسار تحديداً، القاعدة 16/22).
//
// ⛔ **لم يُضَف — بانتظار قرار المستخدم**:
// rawFingerprint.functionalResults[testId=N-06].rawValue (اسم مشغّل
// الشبكة، Operatör — "Turkcell" في العيّنة المراجَعة). حكم المدقّق
// (2026-09-24 +03): النموذج يقرأها فعلياً في حمولته (buildV7Payload.js:141)
// وتدخل فهرس إعفاء حارس device_spec (reportShapeV7.js) — شرط التوقّف بنصّ
// المهمّة وقع. **لا تُضاف N-06 إلى REDACT_DELETE_PATHS/REDACT_REPLACE_PATHS
// حتى قرار صريح من المستخدم.**
//
// ─── لم يُحذَف عمداً ────────────────────────────────────────────────────
// deviceFingerprint (جذر المستند) وrawFingerprint.timeSeries.header.deviceModel
// — كلاهما يحمل **موديل الجهاز** (نصّ عام كـ"Samsung Galaxy S10 5G"، لا
// بصمة فريدة) رغم اسم الحقل الأوّل المُضلِّل — تعليق analyzeDevice.js
// القائم يوثّق هذا صراحةً ("الحقل القائم deviceFingerprint... يحوي موديل
// الجهاز لا البصمة").
//
// ⚠️ **"العقد" الحرفي الذي يُسمّي هذه الحقول "معرِّفاً" لم يصلني بعد**
// (بحثت في docs/V7_DISPLAY_SHAPE_CONTRACT.md بالأداة — لا قائمة كهذه هناك،
// القاعدة 27/29). القائمة أعلاه اجتهاد مهندس مبنيّ على وظيفة كل حقل
// الفعلية (مُتحقَّق بالكود لا بالتخمين)، لا نقلاً عن عقد مُتحقَّق منه —
// راجع تقرير المهمّة تحت "افتراضات"، يُصحَّح فوراً إن وصل نصّ العقد الفعلي.
//
// ─── فحص إضافي — "للمراجعة، لم يُحذَف" (دفاع في العمق) ──────────────────
// بعد الحذف/الاستبدال أعلاه، يُمشَّط المستند بالكامل بحثاً عن أي مسار
// ورقة (leaf) اسمه الأخير يطابق نمط اسم معرِّف شائع (id|sha|serial|imei|
// android|email|phone|uid|token|key|fid|path) — قائمة أسماء فقط، لا
// قيمها. هذا لا يعني أن كل مطابقة معرِّف فعلي (مثلاً functionalResults[].testId
// يطابق نمط "id" لكنه اسم اختبار لا هويّة — "SEC-04"/"B-01") — القائمة
// للمراجعة البشرية، لا حكماً نهائياً.
//
// ─── V8 نقل الخامّ (الجزء ٢، 2026-10-09 +03) ────────────────────────────
// rawFingerprint وsessionId وdeviceFingerprintSha وtimeSeriesStoragePath وaiAudit
// خرجت من reports/{scanId} إلى reportRaw/{scanId} (التقارير الجديدة والمُرحَّلة).
// المصدَّر يبقى بالشكل نفسه الذي كان عليه (كلّ ما سبق من حذف واستبدال يسري على
// الخامّ): main تقرأ الخامّ بـreadReportRaw وتدمجه في نسخة المستند قبل الإخفاء.
// وحالته تُطبع صراحةً أعلى المخرَج (rawState: PRIVATE | EMBEDDED_LEGACY | ABSENT):
// ABSENT يعني أن المستند المصدَّر بلا خامّ أصلاً، لا أنّ الإخفاء أزاله.
//
// القاعدة 36 — الخطأ عند الفشل: e.code واسم الصنف وحدهما، لا e.stack ولا
// e.message الخام (رسالة خطأ من Firestore/الشبكة قد تحمل جزءاً من مسار
// داخلي أو بيانات اعتماد جزئية).
//
// Usage (يُشغِّله المستخدم من طرفيّته، بصلاحية Admin SDK حقيقية على
// مشروع neuralchek-9b6d7 — قراءة فقط):
//   node functions/scripts/export-v6-report-readonly.js <scanId> > evidence/v6-report-redacted-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {mergeRawIntoReport, readReportWithRaw} = require('./lib/reportRawReaders');

const REDACT_DELETE_PATHS = Object.freeze([
  'userId',
  'sessionId',
  'deviceFingerprintSha',
  'timeSeriesStoragePath',
  'rawFingerprint.timeSeries.header.deviceFingerprint',
  'rawFingerprint.device.deviceProfileKey',
  // أُضيف 2026-09-24 +03 (الجولة الرابعة) — راجع "معرِّفات تُحذَف" أعلاه.
  'rawFingerprint.timeSeries.footer.samplesSha256',
]);

const REDACT_REPLACE_PATHS = Object.freeze([
  'shortId',
  'rawFingerprint.timeSeries.header.scanId',
  // أُضيف 2026-09-24 +03 (الجولة الرابعة) — راجع "معرِّفات تُستبدَل" أعلاه.
  'aiResponse.shortId',
]);

const REPLACEMENT_PLACEHOLDER = '[REDACTED]';

// نمط أسماء الحقول المشبوهة للفحص الإضافي — راجع تعليق رأس الملفّ.
const IDENTIFIER_NAME_PATTERN = /(id|sha|serial|imei|android|email|phone|uid|token|key|fid|path)/i;

function getParent(obj, pathSegments) {
  let cur = obj;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[pathSegments[i]];
  }
  return (cur != null && typeof cur === 'object') ? cur : null;
}

/**
 * يحذف/يستبدل حقول REDACT_DELETE_PATHS/REDACT_REPLACE_PATHS بالمسار
 * الكامل من نسخة عميقة (deep clone) من المستند — لا يلمس المستند الأصلي.
 * @param {Object} doc بيانات المستند كما وصلت من Firestore
 * @return {{redacted: Object, removedFields: string[], replacedFields: string[]}}
 */
function redactIdentifiers(doc) {
  const redacted = JSON.parse(JSON.stringify(doc));
  const removedFields = [];
  const replacedFields = [];

  for (const path of REDACT_DELETE_PATHS) {
    const segments = path.split('.');
    const parent = getParent(redacted, segments);
    const leaf = segments[segments.length - 1];
    if (parent && leaf in parent) {
      delete parent[leaf];
      removedFields.push(path);
    }
  }

  for (const path of REDACT_REPLACE_PATHS) {
    const segments = path.split('.');
    const parent = getParent(redacted, segments);
    const leaf = segments[segments.length - 1];
    if (parent && leaf in parent) {
      parent[leaf] = REPLACEMENT_PLACEHOLDER;
      replacedFields.push(path);
    }
  }

  return {redacted, removedFields, replacedFields};
}

/**
 * يمشِّط المستند (بعد الحذف/الاستبدال) بحثاً عن مسارات ورقة (leaf) اسمها
 * الأخير يطابق IDENTIFIER_NAME_PATTERN — للمراجعة البشرية، لا حكماً
 * نهائياً (راجع تعليق رأس الملفّ). المسارات داخل مصفوفات تُطبَّع بـ`[]`
 * بدل الفهرس الرقمي لتفادي تكرار نفس الاسم عشرات المرّات (مثلاً
 * functionalResults[0].testId..functionalResults[84].testId → سطر واحد).
 * `excludePaths` (افتراضياً REDACT_REPLACE_PATHS) يستثني مسارات عولجت
 * بالفعل بالاستبدال — قيمتها صارت REPLACEMENT_PLACEHOLDER، لكن اسمها
 * (`shortId`/`scanId`) يطابق النمط أيضاً؛ بلا هذا الاستثناء كانت ستظهر
 * زوراً في "للمراجعة، لم يُحذَف" رغم معالجتها فعلاً — عطب وجدته اختبارات
 * هذا الملفّ نفسها.
 * @param {*} node
 * @param {string} path
 * @param {Set<string>} out
 * @param {Set<string>} [excludePaths]
 */
function scanForIdentifierLikeNames(node, path, out, excludePaths) {
  const exclude = excludePaths || new Set(REDACT_REPLACE_PATHS);
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) scanForIdentifierLikeNames(item, `${path}[]`, out, exclude);
    return;
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    const fullPath = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      scanForIdentifierLikeNames(value, fullPath, out, exclude);
    } else if (IDENTIFIER_NAME_PATTERN.test(key) && !exclude.has(fullPath)) {
      out.add(fullPath);
    }
  }
}

/**
 * تطبيق Firebase Admin منفصل بـprojectId مثبَّت — نفس PROJECT_ID المُصدَّرة
 * من audit-device-profiles-readonly.js (القاعدة 24، مصدر واحد) — لا نسخة
 * ثانية من الثابت نفسه.
 * @return {Object} {db}
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'export-v6-report-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

/**
 * يبني مخرَج التصدير (كائن JSON واحد) من مستند التقرير وناتج readReportRaw. دالّة خالصة — قابلة للاختبار بلا Firestore.
 * الخامّ يُدمج في نسخة المستند ثم يُخفى كما كان (REDACT_*)، فالمخرَج على الشكلين (مضمَّن/reportRaw) واحد.
 * @param {{reportData: Object, rawRead: {state: string, raw: ?Object}}} p
 * @return {Object}
 */
function buildV6Export({reportData, rawRead}) {
  const merged = mergeRawIntoReport(reportData, rawRead);
  const {redacted, removedFields, replacedFields} = redactIdentifiers(merged);

  const remainingSuspects = new Set();
  scanForIdentifierLikeNames(redacted, '', remainingSuspects);

  return {
    scanId: REPLACEMENT_PLACEHOLDER, // راجع "معرِّفات تُستبدَل" في رأس الملفّ — لا القيمة الحقيقية حتى في المخرَج
    rawState: rawRead.state, // PRIVATE | EMBEDDED_LEGACY | ABSENT — غياب الخامّ يُعلَن ولا يُقرأ نجاحاً (القاعدة 22)
    removedFields,
    replacedFields,
    forReview_notRedacted: Array.from(remainingSuspects).sort(),
    document: redacted,
  };
}

async function main() {
  const scanId = process.argv[2];
  if (!scanId) {
    console.error('Usage: node export-v6-report-readonly.js <scanId>');
    process.exit(1);
  }

  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const read = await readReportWithRaw({db: readOnlyDb, scanId});
  if (!read.exists) {
    console.error(`✗ reports/${scanId} غير موجود.`);
    process.exit(1);
  }

  const data = read.reportData;

  // اسم السكربت "تصدير مستند V6" — تحذير لا رفض إن كان المستند V7 فعلاً
  // (منطق حذف المعرِّفات لا يخصّ V6/V7 — كلاهما يحمل نفس حقول الجذر/
  // rawFingerprint المُدرجة أعلاه — لكن الاسم يُحدَّد بوضوح لتجنّب الالتباس).
  if (data.pipeline === V7_PIPELINE_TAG) {
    console.error(`⚠️ reports/${scanId}.pipeline="${V7_PIPELINE_TAG}" — مستند V7 لا V6. الحذف أدناه يسري كما هو (حقول مشتركة)، لكن هذا السكربت سُمِّي لتصدير V6.`);
  }

  console.log(JSON.stringify(buildV6Export({reportData: data, rawRead: read.rawRead}), null, 2));
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
  redactIdentifiers, scanForIdentifierLikeNames, initReadOnlyAdmin, buildV6Export,
  REDACT_DELETE_PATHS, REDACT_REPLACE_PATHS, REPLACEMENT_PLACEHOLDER, IDENTIFIER_NAME_PATTERN,
};
