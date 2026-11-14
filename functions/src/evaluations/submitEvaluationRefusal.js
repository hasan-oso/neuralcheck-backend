"use strict";

// ===================================================
// submitEvaluationRefusal — أسباب رفض submitEvaluation (V8 قبل أوّل نشر، البند ٦، 2026-10-09)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «سطر سجلّ قبل كل رفض في submitEvaluation: معتمد، بنداً سادساً لوكيل الخادم. سبب مسمّى من
// مصدر واحد، بلا معرّف مستخدم ولا scanId خامّ (المُهشِّر المشترك من الدفعة ١). واختبار يثبت أن كل مسار رفض يكتب سطره.»
//
// ما كان قبل: submitEvaluation ترفض بـ20 موضع `throw new HttpsError` (+ موضعا sessionTimeout.js اللذان يبلغهما submitEvaluation.js:83) بلا سطر
// في السجلّ؛ فالرفض لا يُرى إلا عند العميل. الآن: دالّة واحدة `refuse(reason, scanId, code, message)` في submitEvaluation.js تكتب سطراً بسبب
// مسمّى ثم ترمي — وهي الموضع الوحيد لـ`throw new HttpsError` في الملفّ (يحرسه submitEvaluationRefusalGuard.test.js). رسائل المستخدم ورموز
// الأخطاء كما كانت حرفياً.
//
// ─── أسباب بقيم مجمَّدة، من هذا الملفّ وحده (القاعدة 24) ─────────────────────────────────────────────────────────
// موضع واحد قد يخدم أكثر من سبب (optionalEnum لثلاثة حقول؛ فحص الجلسة لسببين) فالأسباب أكثر من المواضع. أسباب الجلسة (انتهاء الصلاحية)
// تأتي من sessionTimeout.js (مصدرها هناك: analyzeDevice تستعمل الفحص نفسه) وتُدرَج هنا بالقيمة نفسها لا بنسخة.
//
// ─── الفشل غير المتوقَّع ───────────────────────────────────────────────────────────────────────────────────────
// ما ليس HttpsError (خطأ معاملة Firestore، أو buildReportSnapshot يرمي عند غياب rawRead مع تقرير): سطر واحد بالسبب UNEXPECTED_FAILURE ونصّ
// خطأ منقّى (القاعدة 36: لا معرّف مستند ولا رمز طويل)، ثم يُرمى كما كان.

const {SESSION_EXPIRY_REASON} = require("../sessions/sessionTimeout");
// sanitizeFailureText نُقلت (مع sanitizeRawText) إلى utils/failureText.js — المصدر الواحد (S-SUB-2: صارت تُستعمل أيضاً في writeRawAiResponses.js وserverRawSamplesStorage.js، وكان استيراد
// sanitizeRawText من writeRawAiResponses.js هنا سيصير دورة)؛ وتُعاد تصديرها أدناه لمن يستوردها من هذا الملفّ.
const {sanitizeFailureText} = require("../utils/failureText");

const SUBMIT_EVALUATION_REFUSAL = Object.freeze({
  // ─── الهوية والجلسة ───
  NOT_AUTHENTICATED_NO_SESSION: "NOT_AUTHENTICATED_NO_SESSION", // لا sessionId ولا request.auth
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND", // sessionId لا مستند له
  SESSION_NOT_SCANNING: "SESSION_NOT_SCANNING", // الجلسة موجودة وحالتها ليست scanning
  SESSION_EXPIRES_AT_INVALID: SESSION_EXPIRY_REASON.EXPIRES_AT_INVALID, // expiresAt غائب/تالف (sessionTimeout.js)
  SESSION_EXPIRED: SESSION_EXPIRY_REASON.EXPIRED, // expiresAt في الماضي (sessionTimeout.js)
  // ─── المدخلات ───
  SCAN_ID_REQUIRED: "SCAN_ID_REQUIRED",
  INVALID_TECHNICIAN_GRADE_RAW: "INVALID_TECHNICIAN_GRADE_RAW",
  INVALID_TECHNICIAN_GRADE: "INVALID_TECHNICIAN_GRADE",
  INVALID_AGREEMENT: "INVALID_AGREEMENT",
  INVALID_ERROR_MAGNITUDE: "INVALID_ERROR_MAGNITUDE",
  CATEGORY_RATINGS_NOT_MAP: "CATEGORY_RATINGS_NOT_MAP",
  CATEGORY_RATINGS_UNKNOWN_CATEGORY: "CATEGORY_RATINGS_UNKNOWN_CATEGORY",
  CATEGORY_RATINGS_INVALID_RATING: "CATEGORY_RATINGS_INVALID_RATING",
  VISIBLE_DEFECTS_NOT_ARRAY: "VISIBLE_DEFECTS_NOT_ARRAY",
  VISIBLE_DEFECTS_TOO_MANY: "VISIBLE_DEFECTS_TOO_MANY",
  VISIBLE_DEFECTS_INVALID_VALUE: "VISIBLE_DEFECTS_INVALID_VALUE",
  DISPUTED_CATEGORIES_NOT_ARRAY: "DISPUTED_CATEGORIES_NOT_ARRAY",
  DISPUTED_CATEGORIES_TOO_MANY: "DISPUTED_CATEGORIES_TOO_MANY",
  DISPUTED_CATEGORIES_INVALID_VALUE: "DISPUTED_CATEGORIES_INVALID_VALUE",
  TECHNICIAN_NAME_NOT_STRING: "TECHNICIAN_NAME_NOT_STRING",
  TECHNICIAN_NAME_TOO_LONG: "TECHNICIAN_NAME_TOO_LONG",
  DURATION_MS_INVALID: "DURATION_MS_INVALID",
  EVALUATION_EMPTY: "EVALUATION_EMPTY", // لا درجة ولا فئات ولا عيوب ولا فئات متنازع عليها
  // ─── التقرير ───
  REPORT_NOT_FOUND: "REPORT_NOT_FOUND", // المسار المصادَق: لا تقرير لهذا scanId
  REPORT_NOT_OWNED: "REPORT_NOT_OWNED", // التقرير لحساب آخر
  // ─── ما ليس رفضاً مسمّى ───
  UNEXPECTED_FAILURE: "UNEXPECTED_FAILURE", // ما ليس HttpsError — يُسجَّل بنصّ منقّى ثم يُرمى كما كان
});

const REFUSAL_REASONS = Object.freeze(new Set(Object.values(SUBMIT_EVALUATION_REFUSAL)));

module.exports = {SUBMIT_EVALUATION_REFUSAL, REFUSAL_REASONS, sanitizeFailureText};
