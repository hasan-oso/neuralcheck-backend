const {HttpsError} = require("firebase-functions/v2/https");
const {toDateOrNull} = require("../utils/subscription");

// ===================================================
// sessionTimeout — هل ما زالت جلسة QR صالحة؟ (مشتركة بين analyzeDevice.js
// وsubmitEvaluation.js، القاعدة 24: مصدر واحد للفحص وللنصّ/الرمز الناتج
// عنه، لا نسخة في كل ملفّ).
// ===================================================
//
// ⚠️ **هذا الملفّ يحلّ محلّ نسخة fbcc74c (2026-09-30 +03 مبكراً) — قرار
// مستخدم لاحق أبطلها بالكامل** («قرار — مهلة الجلسة ساعة»، 2026-09-30 +03،
// بواقعة حقيقية مقيسة لا مستنتَجة: "الفحص في الجلسة اكتمل، لكني تأخّرت في
// الضغط على زرّ الإرسال، فانتهت الجلسة، ولم يعد تقرير. فمهلة الـ15 دقيقة
// تُضيّع فحص الزبون كاملاً"). القرار الجديد بنصّه: **"الجلسة صالحة 60 دقيقة
// من إنشائها، للانضمام والتحليل والتقييم معاً."** — نافذة واحدة، لا
// نافذتان منفصلتان كما في fbcc74c (لم يعد هناك "15 للانضمام ثم 60 من
// الانضمام").
//
// **التنفيذ بأقلّ تغيير (بنصّ المستخدم، حكم المدقّق)**: بما أن كل مواضع
// الفحص (joinScanSession.js:43-46، وهذا الملفّ عبر analyzeDevice.js/
// submitEvaluation.js) تقرأ `scanSessions.expiresAt` نفسه، والكاتب الوحيد
// له `createScanSession.js:58`، **فالتغيير هناك وحده** (15 دقيقة → 60) —
// لا حاجة لهذا الملفّ أن يعرف "كم دقيقة" إطلاقاً بعد اليوم، ولا لحقل
// `joinedAt` (الذي بنته fbcc74c لهذا الغرض تحديداً وصار زائداً الآن؛
// still exists on the document — joinScanSession.js:50 لم يتغيّر — لكن لا
// قارئ يعتمد عليه للمهلة بعد الآن). هذا الملفّ الآن **مجرّد فحص واحد**: هل
// `expiresAt` ما زال في المستقبل؟
//
// ─── الغياب لا يعني "لا حدّ" هنا (خلاف isSubscriptionExpired) — القاعدة 22 ──
// toDateOrNull (utils/subscription.js، مصدر واحد — القاعدة 24) تُعيد null
// لقيمة غائبة/غير قابلة للتحويل — لا Invalid Date تمرّ صامتة كـ"صالحة بلا
// حدّ" (العطب الذي كان النمط القديم `x?.toDate?.() || new Date(x)` يُخفيه:
// Invalid Date < now تُعطي false دائماً). isSubscriptionExpired تقرأ الغياب
// "لا انتهاء" عمداً (حماية حسابات قديمة) — **هنا العكس صراحةً بقرار
// المستخدم**: جلسة بلا expiresAt (لا يُفترَض وقوعه — createScanSession.js
// يكتبه دائماً عند الإنشاء) تُرفَض، لا تُقبَل بلا حدّ.
//
// ─── نصّ الرفض للحالتين — كلاهما نصّ قائم مُعاد استعماله، لا نصّ جديد
//     (القاعدة 13 — بارز لأنه يُعرض على المستخدم) ─────────────────────────
// (أ) غياب/تلف expiresAt → `HttpsError("permission-denied", "جلسة الفحص
//     غير صالحة")` — نفس نصّ/رمز الفحص الأسبق مباشرة في كلا المستدعيَين
//     ("!sessionDoc.exists || status !== 'scanning'"). لم يتغيّر عن fbcc74c.
// (ب) `expiresAt` في الماضي فعلاً → `HttpsError("failed-precondition",
//     "الجلسة منتهية")` — **بلا تغيير عن fbcc74c ولا عن الأصل قبله**؛ أمر
//     المستخدم الصريح: "رمز التجاوز ونصّه كما هما... فالتطبيق يعاملهما
//     رفضاً نهائياً".
//
// @param {Object} sessionData وثيقة scanSessions/{id}.data() كما وصلت
// @param {Date} [now] الوقت المرجعي (حقن للاختبار فقط)
// @return {void} لا قيمة إرجاع — ترمي HttpsError عند عدم الصلاحية، وإلّا تعود بصمت

// أسباب الرفض المسمّاة (V8 قبل أوّل نشر، البند ٦، 2026-10-09): submitEvaluation تكتب سطر سجلّ بسبب مسمّى قبل كل رفض، ورفضا هذا الملفّ
// يبلغانها عبر sessionExpiryRefusal (تُعيد السبب والرمز والنصّ بدل أن ترمي) — فالمصدر واحد: هذه الدالّة هي التي تحدّد الفحص والسبب
// والرمز والنصّ، وassertSessionNotExpired ترمي منها حرفياً. لا تغيير في رمز ولا نصّ ولا سلوك.
// (الدفعة ٩، 2026-10-10: لم تعد analyzeDevice.js تستعمل assertSessionNotExpired — تستعمل sessionExpiryRefusal مباشرة لتسجّل «منتهية» مع الرفض؛ فبقيت assertSessionNotExpired
// مُصدَّرة ومختبَرة (sessionTimeout.test.js) بلا مستعمل في src.)
const SESSION_EXPIRY_REASON = Object.freeze({
  EXPIRES_AT_INVALID: "SESSION_EXPIRES_AT_INVALID", // (أ) غياب/تلف expiresAt
  EXPIRED: "SESSION_EXPIRED", // (ب) expiresAt في الماضي
});

/**
 * هل ترفض الجلسة بسبب الصلاحية؟ نفس منطق assertSessionNotExpired، تُعيد الرفض بدل رميه.
 * @param {Object} sessionData وثيقة scanSessions/{id}.data()
 * @param {Date} [now]
 * @return {?{reason: string, code: string, message: string}} null إن كانت الجلسة صالحة
 */
function sessionExpiryRefusal(sessionData, now = new Date()) {
  const expiresAt = toDateOrNull(sessionData && sessionData.expiresAt);
  if (expiresAt === null) {
    // غياب/تلف expiresAt — راجع "الغياب لا يعني لا حدّ هنا" أعلاه.
    return {reason: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, code: "permission-denied", message: "جلسة الفحص غير صالحة"};
  }
  if (expiresAt < now) {
    return {reason: SESSION_EXPIRY_REASON.EXPIRED, code: "failed-precondition", message: "الجلسة منتهية"};
  }
  return null;
}

function assertSessionNotExpired(sessionData, now = new Date()) {
  const refusal = sessionExpiryRefusal(sessionData, now);
  if (refusal) throw new HttpsError(refusal.code, refusal.message);
}

module.exports = {assertSessionNotExpired, sessionExpiryRefusal, SESSION_EXPIRY_REASON};
