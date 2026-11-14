// ===================================================
// writeRawAiResponses — يكتب نصّ رد النموذج الخام إلى مجموعة Firestore
// منفصلة، لا إلى مستند التقرير (أمر مستخدم 2026-09-23 +03، القرار ٤)
// ===================================================
//
// نصّ المستخدم: "(أ) مجموعة منفصلة — والقواعد الحالية تمنع غير المشرف من
// قراءتها، فلا نشر لازم... اسم المجموعة واضح، مثل aiRawResponses/{scanId}.
// فيها لكل محاولة: رقمها، والخام، والوقت، والمزوّد. وبعد التنقية (القاعدة
// 36): لا طرف مفتاح في الخام."
//
// **لماذا لا نشرة قواعد لازمة** — تحقّق حرفي من firestore.rules (جذر
// المستودع، لا functions/firestore.rules — صحَّحتُ هذا الخطأ بعد تصحيح
// المنسّق): firestore.rules:15-16 `match /{document=**} { allow read,
// write: if isAdmin(); }` هو المطابقة الوحيدة لأي مسار لا يحمل match
// صريحاً خاصّاً به (Firestore يرفض افتراضياً بلا مطابقة صريحة تسمح). لا
// نضيف match لِـaiRawResponses هنا، فتبقى مقصورة على isAdmin() فقط — أي
// عميل غير مُشرف يُرفَض افتراضياً، بلا أي نشرة قواعد جديدة.
//
// **مكان الكتابة**: من طرف المستدعي (runAnalysisInternal.js، الطبقة التي
// تكتب المستند) — لا من resolveV7Report.js ولا callAIv7 (القيد الصريح).
// هذا الملفّ دالّة خالصة تأخذ rawResponseLog مُجهَّزاً، لا يعرف شيئاً عن
// resolveV7Report نفسها.
//
// **فشل الكتابة لا يُسقط الفحص** — يُلتقَط هنا ويُعاد بسبب مُسمّى، لا يُرمى.

const {db, admin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sanitizeRawText, sanitizeFailureText} = require("../utils/failureText");

const RAW_RESPONSES_COLLECTION = "aiRawResponses";

// sanitizeRawText (تنقية القاعدة 36: لا طرف مفتاح في الخام المكتوب) نُقلت مع sanitizeFailureText إلى utils/failureText.js — المصدر الواحد (S-SUB-2)؛ وتُعاد تصديرها أدناه لمن يستوردها من هنا.

/**
 * يكتب رد(ود) النموذج الخام لفحص واحد إلى aiRawResponses/{scanId} —
 * مجموعة منفصلة تماماً عن reports/{scanId}، لا تُقرأ إلا من المشرف
 * (firestore.rules، راجع تعليق الرأس). لا يُكتب إلا حين تتوفّر بيانات
 * فعلية (rawResponseLog غير فارغة) — عادة يعني ذلك أن مسار V7 (resolveV7Report)
 * شُغِّل فعلاً لهذا الفحص.
 *
 * @param {string} scanId مُعرِّف الفحص
 * @param {Array<{attempt: number, rawResponseText: ?string,
 *   rawResponseProvider: ?string, durationMs: ?number}>} rawResponseLog
 *   من resolveV7Report.js مباشرة، بلا تعديل شكلي — القاعدة 24.
 * @return {Promise<{written: boolean, reason: ?string}>} نتيجة الكتابة —
 *   لا رمي أبداً (فشل الكتابة لا يُسقط الفحص، القيد الصريح).
 */
async function writeRawAiResponses(scanId, rawResponseLog) {
  if (!scanId || typeof scanId !== "string") {
    return {written: false, reason: "NO_SCAN_ID"};
  }
  if (!Array.isArray(rawResponseLog) || rawResponseLog.length === 0) {
    return {written: false, reason: "NO_DATA"};
  }

  try {
    const attempts = rawResponseLog.map((entry) => ({
      attempt: typeof entry.attempt === "number" ? entry.attempt : null,
      raw: sanitizeRawText(entry.rawResponseText),
      provider: entry.rawResponseProvider || null,
      durationMs: typeof entry.durationMs === "number" ? entry.durationMs : null,
    }));

    await db.collection(RAW_RESPONSES_COLLECTION).doc(scanId).set({
      scanId,
      attempts,
      // وقت الكتابة الفعلي (لا وقت النداء — ذاك في durationMs لكل محاولة).
      writtenAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return {written: true, reason: null};
  } catch (e) {
    // نصّ خطأ Firestore يحمل غالباً مسار المستند aiRawResponses/<scanId>: يُنقّى مرّة واحدة (utils/failureText.js، والمعرّف معروف هنا فيُخفى ولو لم يرد في مسار) ويُستعمل نفسه في السطر
    // وفي السبب المُعاد — runAnalysisInternal.js يطبع الأخير في سطر [analysis][v7] aiRawResponses write skipped/failed، فهو سطر سجلّ ثالث للنصّ نفسه (S-SUB-2).
    const failure = sanitizeFailureText(e, {knownIds: [scanId]});
    console.error(`[writeRawAiResponses] FAILED for scanId=${hashIdForLog(scanId)}: ${failure} — ` +
        `الفحص يتابع بلا توقّف (القيد الصريح: فشل الكتابة لا يُسقط الفحص)`);
    return {written: false, reason: `WRITE_FAILED: ${failure}`};
  }
}

module.exports = {
  writeRawAiResponses,
  sanitizeRawText,
  RAW_RESPONSES_COLLECTION,
};
