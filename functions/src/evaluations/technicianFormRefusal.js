"use strict";

// ===================================================
// technicianFormRefusal — أسباب رفض دوالّ استمارة الفنّي وردّ كل سبب (S-P6-08، 2026-10-18 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠-ج (:1356-1361): «رفض مسمّى لكل خطأ مُدخل على سابقة `submitEvaluationRefusal.js`، وسطر سجلّ بلا معرّف خامّ.»؛ وdocs/PROTOCOL_CONTRACT.md §٢ A5: «15 رمزاً `FORM_*` في `FORM_REFUSAL`»
// (E5، معتمد 2026-10-15؛ «نصّ كل رفض يراه الفنّي لم يُكتب»: §٥-أ B9). **المعتمَد منها ما في FORM_REFUSAL وحده** (مرجعه هناك، بلا نسخ: القاعدة 24)؛ **والباقي أسماء اقترحتُها** على نسقها وعلى نسق SET_PURPOSE_REFUSAL
// (sessionNames.js) وتُراجَع مع عقد التطبيق: FORM_NOT_AUTHENTICATED · FORM_SESSION_ID_REQUIRED · FORM_NOT_ENABLED · FORM_ALREADY_SUBMITTED — لا رمز معتمداً لقفل الإرسال الثاني ولا للمحلّ غير المفعَّل ولا لغياب الهوية.
// وما له قيمة قائمة أخذها منها: أسباب الجلسة من sessionNames.js (SESSION_NOT_FOUND · SESSION_NOT_PARTICIPANT · SESSION_NOT_OWNER · SESSION_NOT_STARTED · SESSION_CANCELLED · SESSION_EXPIRED · SESSION_EXPIRES_AT_INVALID ·
// SESSION_STATUS_UNKNOWN · SESSION_REPORT_NOT_AVAILABLE).
//
// **لا نصّ عربي جديد يصل مستخدماً** (القرار ٩٠): النصوص القائمة («يجب تسجيل الدخول» · «sessionId مطلوب» · «جلسة الفحص غير صالحة» · «الجلسة منتهية»)، وما لا نصّ قائم له يحمل رمزه نفسه رسالةً تقنية.
// **معلّق: نصّ بانتظار الاعتماد** لكل رفض يراه الفنّي (§٥-أ B9)؛ والعميل يميّز بـdetails.reasonCode.
//
// ردّ العميل لجلسة غير موجودة ولغير المالك واحد (SESSION_NOT_PARTICIPANT): لا يُكشف وجود جلسة. والسجلّ يفرّق.

const {FORM_REFUSAL} = require("../protocol/protocolVocabulary");
const {ANALYZE_SESSION_REFUSAL, CANCEL_REFUSAL, SET_PURPOSE_REFUSAL} = require("../sessions/sessionNames");

const TECHNICIAN_FORM_REFUSAL = Object.freeze({
  // ─── المعتمَدة (E5): من FORM_REFUSAL بمفاتيحها ───
  ...FORM_REFUSAL,
  // ─── اقتراحي (لا رمز معتمداً لها) ───
  NOT_AUTHENTICATED: "FORM_NOT_AUTHENTICATED", // لا request.auth
  SESSION_ID_REQUIRED: "FORM_SESSION_ID_REQUIRED", // sessionId غائب أو ليس معرّف مستند صالحاً
  NOT_ENABLED: "FORM_NOT_ENABLED", // المحلّ بلا evaluationEnabled (formState: not_enabled، P:1359): «ولا استمارة»
  ALREADY_SUBMITTED: "FORM_ALREADY_SUBMITTED", // «الإرسال نهائي: الخادم يرفض إرسالاً ثانياً للفتحة نفسها» (P:1312)
  // ─── من المصادر القائمة (قيم لا نسخ) ───
  SESSION_NOT_FOUND: CANCEL_REFUSAL.SESSION_NOT_FOUND,
  NOT_PARTICIPANT: CANCEL_REFUSAL.NOT_PARTICIPANT, // ما يراه العميل لغير المالك ولجلسة غير موجودة
  NOT_OWNER: SET_PURPOSE_REFUSAL.NOT_OWNER, // للسجلّ وحده
  SESSION_NOT_STARTED: ANALYZE_SESSION_REFUSAL.NOT_STARTED, // الجلسة pending: لا فحص بعد
  SESSION_CANCELLED: ANALYZE_SESSION_REFUSAL.CANCELLED,
  SESSION_EXPIRED: ANALYZE_SESSION_REFUSAL.EXPIRED,
  SESSION_EXPIRES_AT_INVALID: ANALYZE_SESSION_REFUSAL.EXPIRES_AT_INVALID,
  SESSION_STATUS_UNKNOWN: ANALYZE_SESSION_REFUSAL.STATUS_UNKNOWN,
  REPORT_NOT_AVAILABLE: ANALYZE_SESSION_REFUSAL.REPORT_NOT_AVAILABLE, // recordReportFirstOpened: لا تقرير للجلسة بعد
});

const R = TECHNICIAN_FORM_REFUSAL;
const SESSION_INVALID_TEXT = "جلسة الفحص غير صالحة";
const INPUT = (code, reason) => ({code, message: reason, clientReasonCode: reason});
const SESSION_DENIED = (clientReasonCode) => ({code: "permission-denied", message: SESSION_INVALID_TEXT, clientReasonCode});

/**
 * ردّ كل سبب: رمز HttpsError ونصّه، والرمز الذي يصل العميل في details.reasonCode. الأسباب كلّها من R، فلا مفتاح بلا ردّ (يحرسه الاختبار).
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze({
  [R.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: R.NOT_AUTHENTICATED},
  [R.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: R.SESSION_ID_REQUIRED},
  // مُدخلات الاستمارة: invalid-argument، والرسالة رمزها
  [R.CONTRACT_VERSION_INVALID]: INPUT("invalid-argument", R.CONTRACT_VERSION_INVALID),
  [R.SLOT_INVALID]: INPUT("invalid-argument", R.SLOT_INVALID),
  [R.SLOT_SAME_TECHNICIAN]: INPUT("failed-precondition", R.SLOT_SAME_TECHNICIAN),
  [R.TECHNICIAN_UNKNOWN]: INPUT("invalid-argument", R.TECHNICIAN_UNKNOWN),
  [R.GRADES_INVALID]: INPUT("invalid-argument", R.GRADES_INVALID),
  [R.FUNCTIONAL_INVALID]: INPUT("invalid-argument", R.FUNCTIONAL_INVALID),
  [R.DEFECTS_INVALID]: INPUT("invalid-argument", R.DEFECTS_INVALID),
  [R.SYMPTOMS_INVALID]: INPUT("invalid-argument", R.SYMPTOMS_INVALID),
  [R.SYMPTOM_ORDER_INVALID]: INPUT("invalid-argument", R.SYMPTOM_ORDER_INVALID),
  [R.BATTERY_HEALTH_INVALID]: INPUT("invalid-argument", R.BATTERY_HEALTH_INVALID),
  [R.KNOWN_FAULT_INVALID]: INPUT("invalid-argument", R.KNOWN_FAULT_INVALID),
  [R.GAME_TRIED_INVALID]: INPUT("invalid-argument", R.GAME_TRIED_INVALID),
  [R.NOTE_INVALID]: INPUT("invalid-argument", R.NOTE_INVALID),
  [R.TIMES_INVALID]: INPUT("invalid-argument", R.TIMES_INVALID),
  [R.EMPTY]: INPUT("invalid-argument", R.EMPTY),
  // حالة المحلّ والفتحة
  [R.NOT_ENABLED]: INPUT("failed-precondition", R.NOT_ENABLED),
  [R.ALREADY_SUBMITTED]: INPUT("already-exists", R.ALREADY_SUBMITTED),
  // الجلسة (كما analyzeDevice: permission-denied + «جلسة الفحص غير صالحة» + reasonCode، والانتهاء failed-precondition «الجلسة منتهية»)
  [R.SESSION_NOT_FOUND]: SESSION_DENIED(R.NOT_PARTICIPANT),
  [R.NOT_OWNER]: SESSION_DENIED(R.NOT_PARTICIPANT),
  [R.SESSION_NOT_STARTED]: SESSION_DENIED(R.SESSION_NOT_STARTED),
  [R.SESSION_CANCELLED]: SESSION_DENIED(R.SESSION_CANCELLED),
  [R.SESSION_EXPIRED]: {code: "failed-precondition", message: "الجلسة منتهية", clientReasonCode: R.SESSION_EXPIRED},
  [R.SESSION_EXPIRES_AT_INVALID]: SESSION_DENIED(R.SESSION_EXPIRES_AT_INVALID),
  [R.SESSION_STATUS_UNKNOWN]: INPUT("failed-precondition", R.SESSION_STATUS_UNKNOWN),
  [R.REPORT_NOT_AVAILABLE]: SESSION_DENIED(R.REPORT_NOT_AVAILABLE),
});

module.exports = {TECHNICIAN_FORM_REFUSAL, REFUSAL_RESPONSE};
