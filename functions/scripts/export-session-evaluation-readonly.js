#!/usr/bin/env node
'use strict';

// ===================================================================
// export-session-evaluation-readonly — قراءة فقط. يأخذ shortId، يحلّه
// إلى scanSessions/{id} (بحث shortId=='..')، ثم يقرأ evaluations/{scanId}
// (scanId المكتوب على الجلسة نفسها). يطبع حالة الجلسة وأوقاتها الخام كما
// في المستند، وحالة التقييم ووقت كتابته — لا نصوص الحكم.
//
// أمر مستخدم 2026-09-30 +03 («أمر — التقييم (ب)، ومهلة الجلسة، والبنود
// المعلّقة»، البند ٣)، على نمط export-v7-report-readonly.js في هذا
// المستودع (6e4dd69): نفس wrapReadOnly/PROJECT_ID (audit-device-profiles-
// readonly.js، مصدر واحد — القاعدة 24)، ونفس readPath/formatWrittenAt
// (export-v7-report-readonly.js، مصدر واحد — لا نسخة ثانية من نفس المنطق).
//
// ⚠️ **لا يُشغَّل من هذا الوكيل** (القيد الصريح: "ولا يشغّله الوكيل، ويُضاف
// إلى الجزء C") — المستخدم يشغّله من طرفيّته، بصلاحية Admin SDK حقيقية
// (قراءة فقط، لا حاجة لدور كتابة).
//
// ─── لماذا allowlist لا redactIdentifiers (فرق مقصود عن نمط v6/v7) ─────
// سكربتا export-v6/v7-report-readonly.js يُصدِّران المستند **كاملاً** ناقص
// مسارات محذوفة/مستبدَلة معروفة (denylist) — مناسب حين المطلوب "المستند
// كلّه بلا سرّه". هنا المطلوب معاكس تماماً: نصّ الأمر يعدّد حقولاً بعينها
// صراحة ("حالة الجلسة، وأوقاتها... وحالة التقييم... ولا تطبع نصوص الحكم").
// **allowlist أضيق وأصحّ هنا**: أيّ حقل غير مُدرَج صراحة في القوائم أدناه
// لا يُقرأ إلى المخرَج إطلاقاً — لا قيمته ولا نسخة منقّاة منه. فرق جوهري عن
// denylist: حقل جديد يُضاف لاحقاً إلى scanSessions/evaluations (مثل حقل
// مهلة جديد في البند ٢) **لا يتسرّب صامتاً** إلى هذا المخرَج — يحتاج تعديل
// صريح لإحدى القوائم أدناه كي يظهر، بعكس denylist حيث يظهر كل حقل جديد
// افتراضياً حتى يُحظَر بالاسم.
// للمراجعة البشرية فقط (لا حكماً نهائياً، بنفس تحذير export-v6-report-
// readonly.js): scanForIdentifierLikeNames (تلك الوحدة، مصدر واحد) تُطبَّق
// على المستندين الخامّين قبل بناء المخرَج — تسرد *أسماء* الحقول المشبوهة
// الحاضرة فعلاً، بلا قيمها أبداً.
//
// ─── shortId ⇐ الجلسة (نصّ الأمر: "اذكر كيف يجد السكربت الجلسة") ────────
// scanSessions/{id}.shortId **لا يُكتَب إلا عند الإكمال** — مُتحقَّق
// بالقراءة المباشرة هنا (analyzeDevice.js:665-671):
//   status:"completed", scanId, shortId, deviceModel, completedAt
// تُكتَب معاً بتحديث واحد. فالبحث
//   db.collection('scanSessions').where('shortId','==',shortIdUpper).get()
// **لا يميّز ثلاث حالات مختلفة تماماً عند صفر نتيجة**:
//   (أ) shortId غير موجود في أيّ مكان إطلاقاً (كود مكتوب خطأً).
//   (ب) shortId ينتمي لفحص لم يمرّ بجلسة محل قط (فحص مباشر بلا sessionId —
//       analyzeDevice.js لا يكتب شيئاً على أيّ scanSessions في هذا المسار).
//   (ج) الجلسة موجودة فعلاً لكنها لم تكتمل بعد (pending/scanning/expired)،
//       فحقل shortId لم يُكتَب عليها بعد أصلاً.
// **لا سبيل للتمييز بين الثلاث من استعلام scanSessions وحده** — نصّ الأمر
// يحصر القراءة في scanSessions/evaluations، لا reports (ذاك سكربت آخر:
// export-v7-report-readonly.js). الحالة الصريحة الواحدة
// SHORTID_NOT_FOUND_IN_SESSIONS تذكر الاحتمالات الثلاثة معاً بنصّها، ولا
// تخمّن أيّها وقع (القاعدة 22 — لا اختيار افتراضي أن أحدها هو الحاصل).
// أكثر من جلسة بالـshortId نفسه (SHORTID_AMBIGUOUS) حالة دفاعية منفصلة،
// بنمط resolveScanIdFromShortId (export-v7-report-readonly.js) — لا اختيار
// أوّل نتيجة بصمت مهما بدا نادراً (shortId من المفترض فريداً عالمياً).
//
// ─── ما يُظهر وما يُخفى (نصّ الأمر) — يُذكر أيضاً في outputScope أعلى
//     المخرَج JSON (نصّ الأمر: "اذكر ما أخفيته وما أظهرته في رأس المخرَج") ──
// **scanSessions**: status + createdAt/joinedAt/expiresAt/completedAt
// **كما هي في المستند بأسماء حقولها الحقيقية بلا اشتقاق** — لا "مهلة"
// محسوبة من أيّ حقلين معاً (نصّ الأمر: قاعدة المهلة ستتغيّر بالبند ٢ —
// 15 دقيقة للانضمام و60 دقيقة بعده — فالحقول الخام وحدها تُطبَع اليوم، قبل
// أن يُبنى أيّ حقل مهلة جديد). code/ownerId/ownerEmail/joinedBy/scanId
// (الداخلي، رابط evaluations)/deviceModel **غير مطلوبة بنصّ الأمر**
// ("حالة الجلسة وأوقاتها" فقط، لا كل حقولها) — لا تُقرأ إلى المخرَج
// إطلاقاً؛ أسماؤها فقط تُسرَد إن حضرت في sessionFieldsNotPrinted، لا قيمها.
// ⚠️ تصحيح 2026-10-01 +03 ("قواعد قراءة الجلسات") — ownerEmail حُذف من
// createScanSession.js (لا كاتب له بعد الآن) لكن **المستندات القديمة
// تبقى تحمله** (تحميها قاعدة القراءة الجديدة) — `sessionFieldsNotPrinted`
// يبقى ديناميكياً (Object.keys(data)، :215) فيسرد اسمه إن وُجد على مستند
// قديم بلا أي تعديل كود مطلوب هنا.
// scanId الداخلي تحديداً **لا يظهر في أيّ مكان بالمخرَج** — بنفس قرار
// export-v7-report-readonly.js ("shortId يكفي معرّفاً للمخرَج").
//
// **evaluations**: pending/ownerMismatch/source/revisionCount/createdAt/
// updatedAt/resolvedAt (كل حقل بحالة حضور صريحة — present:true/false، لا
// يُخلَط "غائب" بـ"حاضر بقيمة null"، القاعدة 22؛ مثال حقيقي: resolvedAt
// حاضر بقيمة null تحديداً ما دام pending=true — submitEvaluation.js:317).
// categoryRatings/visibleDefects/technicianGradeRaw **مُخفاة بنصّ الأمر
// صراحة** ("ولا تطبع نصوص الحكم... إلا بقرار") — تُذكر أسماؤها فقط في
// judgmentFieldsHiddenByDecision إن حضرت، لا قيمها أبداً. كل حقل آخر في
// evaluations (technicianGrade/agreement/errorMagnitude/disputedCategories/
// gradeDistance/consistencyFlag/technicianName/durationMs/
// linkageIncomplete/missingLinkageFields/ownerId/sessionId/scanId + حقول
// buildReportSnapshot المنسوخة بالكامل عبر `...snapshot` — من بينها
// deviceFingerprintSha/timeSeriesStoragePath، معرّفات حقيقية،
// evaluationContract.js:97-107) **غير مطلوبة بنصّ الأمر أيضاً** — أسماؤها
// فقط في evaluationFieldsNotPrinted.
//
// ─── وضع ثانٍ — سرد جلسات يوم كامل (أمر مستخدم 2026-09-30 +03 «قرار —
//     مهلة الجلسة ساعة»، الفقرة الأخيرة) ─────────────────────────────────
// نصّ الأمر: "يُضاف إليه وضع يسرد الجلسات المُنشأة في يوم معيّن: معرّفاتها
// مُهشَّرة، وحالتها، وأوقاتها (الإنشاء، والانضمام، والمهلة، وآخر تحديث).
// فتُقرأ بذلك جلسة تجربتي المنتهية دون shortId، لأنها لم تُنتج تقريراً."
// — أي جلسة لا يجدها الوضع الأوّل (يبحث بـshortId، وshortId لا يُكتَب إلا
// عند الإكمال) تصير مرئية هنا بالبحث بـcreatedAt بدلاً منه.
//   node export-session-evaluation-readonly.js --day <YYYY-MM-DD>
// اليوم بتوقيت +03 (نصّ الأمر: "من منتصف ليله إلى منتصف الليلة التالية")
// — dayRangeUtcPlus03 يحوّل التاريخ المحلّي إلى مدى UTC [start, end) مطابق
// (منتصف الليل +03 = UTC-3 ساعات).
// **معرّفاتها مُهشَّرة**: سطر الجلسة (doc id) وحده — hashId (استُعير من
// audit-device-profiles-readonly.js، مصدر واحد — القاعدة 24، نفس SHA-256/12
// حرفاً الذي يُستعمَل هناك لِـprofileId/scanId). **لم يُوسَّع الحسابُ إلى
// scanId الداخلي على الجلسة**: نصّ الأمر لم يطلبه صراحةً، وscanId يبقى
// حقلاً غير مطلوب (اسمه فقط في sessionFieldsNotPrinted)، بنفس قرار الوضع
// الأوّل. حالة و**نفس** الأوقات الأربع + allowlist الحقول الأخرى (owner/
// code/joinedBy أسماء فقط) — extractSessionFields نفسها، مصدر واحد
// (القاعدة 24)، لا نسخة موازية.
// **آخر تحديث**: لا حقل بهذا الاسم في مستند scanSessions (تحقّقتُ:
// الحقول الوحيدة المكتوبة عبر createScanSession.js/joinScanSession.js/
// analyzeDevice.js هي code/ownerId/status/createdAt/expiresAt/
// scanId/deviceModel/joinedAt/joinedBy/completedAt/shortId — لا updatedAt).
// ⚠️ تصحيح 2026-10-01 +03 ("قواعد قراءة الجلسات") — ownerEmail كانت في هذه
// القائمة (createScanSession.js كان يكتبها)؛ حُذفت من الكاتب — المستندات
// القديمة وحدها قد تحملها الآن، لا الجديدة.
// المصدر إذن `snapshot.updateTime` (ميتاداتا المستند من Firestore نفسها،
// لا من بيانات المستند) — يُذكر مصدره صراحةً في المخرَج (`source`) لكل جلسة.
//
// ─── الاختبار ───────────────────────────────────────────────────────
// Firestore مزيَّف بالكامل في الذاكرة (صفر شبكة، صفر Admin SDK حقيقي) —
// جلسة مكتملة مع تقييم، جلسة مكتملة بلا تقييم، shortId غير موجود، ووضع
// سرد اليوم (صفر/جلسة واحدة/عدّة جلسات، ويوم غير صالح الصيغة).
//
// Usage (يُشغِّله المستخدم من طرفيّته فقط):
//   node functions/scripts/export-session-evaluation-readonly.js <shortId> > evidence/session-evaluation-export-<تاريخ+03>.json
//   node functions/scripts/export-session-evaluation-readonly.js --day 2026-09-30 > evidence/session-day-listing-2026-09-30.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID, hashId} = require('./audit-device-profiles-readonly');
const {readPath, formatWrittenAt} = require('./export-v7-report-readonly');
const {scanForIdentifierLikeNames} = require('./export-v6-report-readonly');

const SCAN_SESSIONS_COLLECTION = 'scanSessions';
const EVALUATIONS_COLLECTION = 'evaluations';

// حقل حالة الجلسة + أوقاتها الخام — نصّ الأمر حرفياً ("حالة الجلسة،
// وأوقاتها كلّها (الإنشاء، والانضمام، والمهلة، والإكمال)"). الترتيب هنا
// زمنيّ (الإنشاء ثم الانضمام ثم المهلة كما أُدخلت ثم الإكمال) — لا يعني
// أن expiresAt تقع بعد joinedAt زمنياً في كل الحالات (expiresAt يُكتَب عند
// الإنشاء ولا يُحدَّث بعده أبداً في الكود الحالي — راجع createScanSession.js
// :58، لا سطر update لها في joinScanSession.js/analyzeDevice.js).
const SESSION_STATUS_FIELD = 'status';
const SESSION_TIME_FIELDS = Object.freeze(['createdAt', 'joinedAt', 'expiresAt', 'completedAt']);

// حقول evaluations المطلوبة صراحة بنصّ الأمر.
const EVAL_SHOWN_FIELDS = Object.freeze(['pending', 'ownerMismatch', 'source', 'revisionCount']);
const EVAL_TIME_FIELDS = Object.freeze(['createdAt', 'updatedAt', 'resolvedAt']);
// نصوص الحكم — مُخفاة بقرار صريح في نصّ الأمر، لا افتراضاً (القاعدة 22:
// قرار مُعلَن هنا بالاسم، لا حذف صامت). "إلا بقرار" — أي حتى يُقرَّر خلاف
// ذلك صراحةً؛ لا تُضاف هذه المصفوفة إلى EVAL_SHOWN_FIELDS بدون ذلك القرار.
const EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION = Object.freeze([
  'categoryRatings', 'visibleDefects', 'technicianGradeRaw',
]);

/**
 * قراءة حقل عادي بحالة حضور صريحة — present:false يُميَّز عن present:true
 * بقيمة null (القاعدة 22).
 * @param {Object} obj
 * @param {string} field
 * @return {{present: boolean, value: *}|{present: boolean}}
 */
function readPlainField(obj, field) {
  const r = readPath(obj, field);
  return r.present ? {present: true, value: r.value} : {present: false};
}

/**
 * قراءة حقل وقت — يُميَّز "الحقل غائب كلّياً" (present:false) عن "حاضر
 * بقيمة أُهيِّئت صراحةً" (present:true، formatted من formatWrittenAt —
 * التي بدورها تُميَّز null الصريحة (state:'ABSENT') عن Timestamp حقيقي/
 * نصّ/شكل مجهول). مثال حقيقي للفرق المهمّ: evaluations.resolvedAt حاضر
 * بقيمة null تحديداً ما دام pending=true (submitEvaluation.js:317) — ذلك
 * present:true+ABSENT، لا present:false.
 * @param {Object} obj
 * @param {string} field
 * @return {{present: boolean, formatted: (Object|null)}}
 */
function readTimeField(obj, field) {
  const r = readPath(obj, field);
  return r.present ? {present: true, formatted: formatWrittenAt(r.value)} : {present: false, formatted: null};
}

/**
 * يحلّ shortId إلى مستند scanSessions واحد. راجع تعليق رأس الملفّ لتفصيل
 * الاحتمالات الثلاثة غير المميَّزة داخل SHORTID_NOT_FOUND_IN_SESSIONS.
 * @param {Object} readOnlyDb
 * @param {string} shortIdUpper
 * @return {Promise<{state: string, sessionId: ?string, scanId: ?string, data: ?Object, matchCount: number}>}
 */
async function resolveSessionFromShortId(readOnlyDb, shortIdUpper) {
  const snap = await readOnlyDb.collection(SCAN_SESSIONS_COLLECTION)
      .where('shortId', '==', shortIdUpper).get();
  if (snap.size === 0) {
    return {state: 'SHORTID_NOT_FOUND_IN_SESSIONS', sessionId: null, scanId: null, data: null, matchCount: 0};
  }
  if (snap.size > 1) {
    return {state: 'SHORTID_AMBIGUOUS', sessionId: null, scanId: null, data: null, matchCount: snap.size};
  }
  const doc = snap.docs[0];
  const data = doc.data() || {};
  return {
    state: 'RESOLVED',
    sessionId: doc.id,
    scanId: (typeof data.scanId === 'string' && data.scanId) ? data.scanId : null,
    data,
    matchCount: 1,
  };
}

/**
 * حالة الجلسة + أوقاتها الخام فقط (allowlist — راجع رأس الملفّ).
 * @param {Object} sessionData مستند scanSessions/{id}.data()
 * @return {{status: Object, times: Object, sessionFieldsNotPrinted: string[]}}
 */
function extractSessionFields(sessionData) {
  const data = sessionData || {};
  const status = readPlainField(data, SESSION_STATUS_FIELD);
  const times = {};
  for (const field of SESSION_TIME_FIELDS) {
    times[field] = readTimeField(data, field);
  }
  const requested = new Set([SESSION_STATUS_FIELD, ...SESSION_TIME_FIELDS]);
  const sessionFieldsNotPrinted = Object.keys(data).filter((k) => !requested.has(k)).sort();
  return {status, times, sessionFieldsNotPrinted};
}

/**
 * يحوّل تاريخاً محلّياً (+03) بصيغة YYYY-MM-DD إلى مدى UTC [start, end)
 * مطابق ليومه الكامل بتوقيت +03 — منتصف ليله إلى منتصف الليلة التالية
 * (نصّ الأمر). null صراحةً إن كانت الصيغة غير صالحة — لا تخمين (القاعدة 22).
 * @param {string} dayStr
 * @return {{start: Date, end: Date}|null}
 */
function dayRangeUtcPlus03(dayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayStr || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // منتصف ليل اليوم المطلوب بتوقيت +03 = تلك اللحظة بتوقيت UTC ناقص 3 ساعات.
  const startUtcMs = Date.UTC(y, mo - 1, d, 0, 0, 0, 0) - 3 * 60 * 60 * 1000;
  const start = new Date(startUtcMs);
  // Date.UTC يرفض قيماً مستحيلة (مثل شهر 13) بلفّها لتاريخ آخر بصمت — حارس
  // صريح: نعيد التأكّد أن المكوّنات المطلوبة طابقت ما وصل فعلاً بعد الحساب
  // (بالرجوع إلى منتصف الليل +03 نفسه، قبل خصم الفارق).
  const check = new Date(startUtcMs + 3 * 60 * 60 * 1000);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const end = new Date(startUtcMs + 24 * 60 * 60 * 1000);
  return {start, end};
}

/**
 * ملخّص جلسة واحدة لوضع سرد اليوم — نفس allowlist extractSessionFields
 * حرفياً (مصدر واحد، القاعدة 24) + معرّف مُهشَّر + آخر تحديث من ميتاداتا
 * Firestore (راجع تعليق رأس الملفّ لسبب عدم وجود حقل بهذا الاسم في المستند).
 * @param {string} sessionId معرّف مستند scanSessions (doc.id)
 * @param {Object} sessionData doc.data()
 * @param {*} snapshotUpdateTime doc.updateTime (Firestore Timestamp من الميتاداتا)
 * @return {Object}
 */
function extractSessionSummaryForDayListing(sessionId, sessionData, snapshotUpdateTime) {
  const base = extractSessionFields(sessionData);
  return {
    sessionIdHash: hashId(sessionId),
    status: base.status,
    times: Object.assign({}, base.times, {
      lastUpdatedAt: {
        present: true,
        source: 'snapshot.updateTime', // ميتاداتا المستند من Firestore — لا حقل في بيانات المستند نفسها
        formatted: formatWrittenAt(snapshotUpdateTime),
      },
    }),
    sessionFieldsNotPrinted: base.sessionFieldsNotPrinted,
  };
}

/**
 * يبني مخرَج وضع سرد اليوم الكامل — دالّة خالصة، قابلة للاختبار بلا
 * Firestore (تأخذ مصفوفة عناصر جاهزة بدل QuerySnapshot حيّ).
 * @param {string} dayStr كما أُدخل (YYYY-MM-DD)
 * @param {{start: Date, end: Date}} range مخرَج dayRangeUtcPlus03
 * @param {Array<{id: string, data: Object, updateTime: *}>} sessionDocs
 * @return {Object}
 */
function buildDayListingOutput(dayStr, range, sessionDocs) {
  return {
    projectId: PROJECT_ID,
    mode: 'day-listing',
    day: dayStr,
    dayRangeUtc: {start: range.start.toISOString(), end: range.end.toISOString()},
    outputScope: {
      approach: 'allowlist — نفس approach الوضع الأوّل حرفياً (مصدر واحد، extractSessionFields)',
      sessionShown: [SESSION_STATUS_FIELD, ...SESSION_TIME_FIELDS, 'lastUpdatedAt (من snapshot.updateTime، لا من بيانات المستند)'],
      note_sessionIdHashedOnly: 'sessionIdHash فقط — لا scanId الداخلي (غير مطلوب بنصّ الأمر، اسمه فقط في sessionFieldsNotPrinted إن حضر)',
    },
    sessionCount: sessionDocs.length,
    sessions: sessionDocs.map((d) => extractSessionSummaryForDayListing(d.id, d.data, d.updateTime)),
  };
}

/**
 * حالة التقييم (allowlist) — ثلاث حالات جذرية صريحة قبل أيّ حقل:
 * SESSION_SCANID_ABSENT (تعارض داخلي: shortId طابق جلسة لكن لا scanId
 * عليها — غير واقع اليوم بحكم الكتابة الذرّية في analyzeDevice.js:665-671،
 * حارس دفاعي فقط)، DOCUMENT_ABSENT (لا مستند evaluations لهذا scanId —
 * جلسة مكتملة بلا تقييم بعد)، DOCUMENT_PRESENT (الحالة العادية).
 * @param {{state: string, data: ?Object}} evalLookup
 * @return {Object}
 */
function extractEvaluationFields(evalLookup) {
  if (evalLookup.state === 'SESSION_SCANID_ABSENT') {
    return {
      state: 'SESSION_SCANID_ABSENT',
      note: 'الجلسة طابقت shortId لكن حقل scanId عليها غائب/فارغ — تعارض داخلي، ' +
          'لا استعلام evaluations ممكن بلا scanId (لا افتراض — القاعدة 22)',
    };
  }
  if (evalLookup.state === 'DOCUMENT_ABSENT') {
    return {state: 'DOCUMENT_ABSENT', collection: EVALUATIONS_COLLECTION};
  }
  const data = evalLookup.data || {};
  const fields = {};
  for (const field of EVAL_SHOWN_FIELDS) {
    fields[field] = readPlainField(data, field);
  }
  const times = {};
  for (const field of EVAL_TIME_FIELDS) {
    times[field] = readTimeField(data, field);
  }
  const judgmentFieldsHiddenByDecision = EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION.filter((f) => f in data);
  const requested = new Set([
    ...EVAL_SHOWN_FIELDS, ...EVAL_TIME_FIELDS, ...EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION,
  ]);
  const evaluationFieldsNotPrinted = Object.keys(data).filter((k) => !requested.has(k)).sort();
  return {state: 'DOCUMENT_PRESENT', fields, times, judgmentFieldsHiddenByDecision, evaluationFieldsNotPrinted};
}

/**
 * يبني المخرَج الكامل من مستند جلسة + نتيجة قراءة evaluations + shortId
 * كما أُدخل. دالّة خالصة — قابلة للاختبار بلا Firestore.
 * @param {string} shortIdInput كما أُدخل (بعد toUpperCase)
 * @param {Object} sessionData مستند scanSessions/{id}.data()
 * @param {{state: string, data: ?Object}} evalLookup مخرَج تحديد evaluations (راجع main())
 * @return {Object}
 */
function buildExportOutput(shortIdInput, sessionData, evalLookup) {
  const suspectFieldNames = new Set();
  scanForIdentifierLikeNames(sessionData || {}, SCAN_SESSIONS_COLLECTION, suspectFieldNames);
  if (evalLookup.state === 'DOCUMENT_PRESENT' && evalLookup.data) {
    scanForIdentifierLikeNames(evalLookup.data, EVALUATIONS_COLLECTION, suspectFieldNames);
  }

  return {
    projectId: PROJECT_ID,
    shortId: shortIdInput,
    // نصّ الأمر: "اذكر ما أخفيته وما أظهرته في رأس المخرَج" — هذا القسم هو
    // ذلك الرأس. راجع رأس الملفّ للتفصيل الكامل بمصدره (اسم الحقل وسطره).
    outputScope: {
      approach: 'allowlist — لا يُقرأ أيّ حقل غير مذكور هنا إلى الذاكرة أصلاً (لا حذف بعد قراءة)',
      sessionShown: [SESSION_STATUS_FIELD, ...SESSION_TIME_FIELDS],
      evaluationShown: [...EVAL_SHOWN_FIELDS, ...EVAL_TIME_FIELDS],
      evaluationHiddenByDecision: [...EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION],
      note_scanIdNeverShown: 'scanId الداخلي (الرابط بين scanSessions وevaluations) لا يظهر في أيّ مكان بالمخرَج — shortId يكفي معرّفاً',
      forReview_identifierLikeFieldNames: Array.from(suspectFieldNames).sort(),
    },
    session: extractSessionFields(sessionData),
    evaluation: extractEvaluationFields(evalLookup),
  };
}

/**
 * تطبيق Firebase Admin منفصل بـprojectId مثبَّت — نفس PROJECT_ID المُصدَّرة
 * من audit-device-profiles-readonly.js (القاعدة 24، مصدر واحد).
 * @return {Object} {db}
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'export-session-evaluation-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

/**
 * وضع سرد اليوم — يُشغَّل من main() عند `--day <YYYY-MM-DD>`.
 * @param {string} dayArg
 * @return {Promise<void>}
 */
async function runDayListingMode(dayArg) {
  const range = dayRangeUtcPlus03(dayArg);
  if (!range) {
    console.error('Usage: node export-session-evaluation-readonly.js --day <YYYY-MM-DD> (بتوقيت +03)');
    process.exit(1);
    return;
  }

  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const snap = await readOnlyDb.collection(SCAN_SESSIONS_COLLECTION)
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<', range.end)
      .get();
  const sessionDocs = snap.docs.map((doc) => ({id: doc.id, data: doc.data() || {}, updateTime: doc.updateTime}));

  const output = buildDayListingOutput(dayArg, range, sessionDocs);
  console.log(JSON.stringify(output, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === '--day') {
    await runDayListingMode(argv[1]);
    return;
  }

  const shortIdArg = argv[0];
  if (!shortIdArg) {
    console.error('Usage: node export-session-evaluation-readonly.js <shortId>');
    console.error('   or: node export-session-evaluation-readonly.js --day <YYYY-MM-DD>');
    process.exit(1);
  }
  const shortIdUpper = String(shortIdArg).trim().toUpperCase();

  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const resolved = await resolveSessionFromShortId(readOnlyDb, shortIdUpper);
  if (resolved.state !== 'RESOLVED') {
    console.log(JSON.stringify({
      projectId: PROJECT_ID,
      shortId: shortIdUpper,
      error: resolved.state,
      matchCount: resolved.matchCount,
    }, null, 2));
    process.exit(1);
  }

  let evalLookup;
  if (!resolved.scanId) {
    evalLookup = {state: 'SESSION_SCANID_ABSENT', data: null};
  } else {
    const evalSnap = await readOnlyDb.collection(EVALUATIONS_COLLECTION).doc(resolved.scanId).get();
    evalLookup = evalSnap.exists ?
        {state: 'DOCUMENT_PRESENT', data: evalSnap.data() || {}} :
        {state: 'DOCUMENT_ABSENT', data: null};
  }

  const output = buildExportOutput(shortIdUpper, resolved.data, evalLookup);
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
  SCAN_SESSIONS_COLLECTION, EVALUATIONS_COLLECTION,
  SESSION_STATUS_FIELD, SESSION_TIME_FIELDS,
  EVAL_SHOWN_FIELDS, EVAL_TIME_FIELDS, EVAL_JUDGMENT_FIELDS_HIDDEN_BY_DECISION,
  readPlainField, readTimeField,
  resolveSessionFromShortId, extractSessionFields, extractEvaluationFields, buildExportOutput,
  dayRangeUtcPlus03, extractSessionSummaryForDayListing, buildDayListingOutput,
  initReadOnlyAdmin,
};
