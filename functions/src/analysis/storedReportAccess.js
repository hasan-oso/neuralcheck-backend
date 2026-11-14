"use strict";

// ===================================================
// storedReportAccess — من يُقدَّم له تقرير مخزَّن في analyzeDevice (فرع 1b): المالك وحده، في كل المسارات (البند ٢، 2026-10-17 +03)
// ===================================================
//
// القرار (المنسّق، منقول من نصّ الأمر — غير متحقَّق منه من هذا المستودع، القاعدة 29): «قبل تقديم أيّ تقرير مخزَّن يجب أن ownerCheckState(userId, existingReport.data().userId) === MATCH في **كل** المسارات،
// حيث userId عندك هو: ownerId الجلسة في مسارات الجلسة، وcallerUid في المسار الشخصي. غير ذلك ⟵ رفض مسمّى بلا أيّ جزء من التقرير ولا تسريب. حالة userId غائب في التقرير المخزَّن (أو أيّ حالة غير MATCH من
// OWNER_CHECK_STATE) حالة صريحة تُرفض وتُسجَّل بسطر مسمّى (القاعدة 22). المعرّفات في السطر مُهشَّرة. لا كتابة ولا خصم رصيد في الرفض.»
//
// ما كان قبل: analyzeDevice.js كان يردّ `existingData.aiResponse` لأيّ مستدعٍ يعرف scanId (سرّ الوصول الوحيد UUID يولّده العميل)، إلا في فرع جلسة completed (يُحرَس بـownerCheckState، سبب SESSION_COMPLETED).
// حارس ownerGuard في مسار الاكتمال (sessionCompletion.js) كان يحمي **كتابة الاكتمال** لا **الردّ**.
//
// ما هذا الملفّ (مصدر واحد، القاعدة 24): (١) الحكم storedReportServeVerdict على ownerCheckState وحدها (لا مقارنة ثانية)، (٢) رمز الرفض الشخصي ونصّه ورمز HttpsError، (٣) سطر السجلّ المسمّى.
// رمز مسار الجلسة (SESSION_REPORT_NOT_AVAILABLE) في sessionNames.js ANALYZE_SESSION_REFUSAL مع أخواته؛ والنصّ هناك «جلسة الفحص غير صالحة» القائم (sessionRefusal في analyzeDevice.js).
//
// لماذا رمز واحد لكل حالات غير MATCH (لا رمز لكل حالة): الرمز يصل العميل، فلو فرّق بين «تقرير لغيرك» و«تقرير بلا مالك» لكشف وجود التقرير وحاله لمن لا يملكه. الحالة الدقيقة (MISMATCH ·
// REPORT_USER_ABSENT · SESSION_OWNER_ABSENT) تُكتب في سطر السجلّ وحده (للخادم، لا للعميل).
// ولا نصّ يكشف وجود التقرير ولا مالكه: النصّ محايد «تعذّر إتمام الطلب».

const {ownerCheckState} = require("../sessions/sessionCompletion");
const {OWNER_CHECK_STATE} = require("../sessions/sessionNames");
const {hashIdForLog} = require("../utils/logRedaction");

/** رمز الرفض في المسار الشخصي (details.reasonCode). مسار الجلسة: ANALYZE_SESSION_REFUSAL.REPORT_NOT_AVAILABLE. */
const STORED_REPORT_REFUSAL = Object.freeze({
  NOT_AVAILABLE: "SCAN_REPORT_NOT_AVAILABLE",
});

/** نصّ الرفض الشخصي على السلك: محايد، لا يكشف وجود تقرير ولا مالكه. */
const STORED_REPORT_REFUSAL_TEXT = "تعذّر إتمام الطلب";

/** رمز HttpsError للمسار الشخصي (كما رفض البوّابة: permission-denied). */
const STORED_REPORT_REFUSAL_CODE = "permission-denied";

/** مساران في سطر السجلّ. */
const STORED_REPORT_PATH = Object.freeze({PERSONAL: "personal", SESSION: "session"});

/**
 * حكم تقديم التقرير المخزَّن. الحالة من ownerCheckState (مصدر المقارنة الواحد مع حارس جلسة completed وحارس كتابة الاكتمال) — الغياب لا يطابق (القاعدة 22).
 * @param {{userId: *, reportUserId: *}} p userId = ownerId الجلسة (مسار الجلسة) أو uid المستدعي (الشخصي)؛ reportUserId = `reports/{scanId}.userId`
 * @return {{serve: boolean, ownerState: string}} serve=true فقط عند MATCH
 */
function storedReportServeVerdict({userId, reportUserId}) {
  const ownerState = ownerCheckState(userId, reportUserId);
  return {serve: ownerState === OWNER_CHECK_STATE.MATCH, ownerState};
}

/**
 * سطر الرفض المسمّى (للخادم): `[analyzeDevice] stored-report refused reason=<رمز السلك> ownerCheck=<الحالة الدقيقة> path=personal|session scanId=#<هاش> session=no|#<هاش>`.
 * المعرّفات مُهشَّرة (hashIdForLog): لا scanId ولا sessionId ولا uid خامّ (القاعدة 36، سياسة السجلّات).
 * @param {{reason: string, ownerState: string, path: string, scanId: *, sessionId: *}} p
 */
function logStoredReportRefusal({reason, ownerState, path, scanId, sessionId}) {
  const session = path === STORED_REPORT_PATH.SESSION ? hashIdForLog(sessionId) : "no";
  console.warn(`[analyzeDevice] stored-report refused reason=${reason} ownerCheck=${ownerState} path=${path} scanId=${hashIdForLog(scanId)} session=${session}`);
}

module.exports = {
  STORED_REPORT_REFUSAL,
  STORED_REPORT_REFUSAL_TEXT,
  STORED_REPORT_REFUSAL_CODE,
  STORED_REPORT_PATH,
  storedReportServeVerdict,
  logStoredReportRefusal,
};
