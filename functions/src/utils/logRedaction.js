"use strict";

// ===================================================
// logRedaction — مصدر واحد لتهشير المعرّفات وتسجيل الحضور في سجلّات الخادم
// ===================================================
//
// قرار المستخدم (V8، الدفعة ١ «الخصوصية»، 2026-10-08 +03، بنصّه):
// «لا مستند مستخدم ولا بريد ولا هاتف ولا رمز FCM في أيّ سجلّ، والمعرّفات
//  مُهشَّرة. ويُضاف اختبار يرفض ذلك في الكود.»
//
// القاعدة 24: هذه الصيغة (sha256 → 12 محرفاً سداسياً → مسبوقة بـ#) والكلمات
// الثلاث للحالة قيم حرفية يقوم عليها تمييز — فهي مُعرَّفة هنا مرّة واحدة وكل
// موضع في functions/src يستوردها. الحارس functions/test/piiLogGuard.test.js
// يقرأ أسماء الدالّتين من هذا الملفّ (`.name`) ويرفض أيّ نداء log يحمل معرّف
// مستخدم أو حقلاً شخصياً خارج إحداهما.
//
// الصيغة (من المنسّق، 2026-10-08 — لا قرار مستخدم فيها): تُطابق أدوات قراءة
// السجلّات عند المنسّق، فيُطابَق المعرّف في السجلّ بقراءاتها. وسكربتا
// functions/scripts/audit-device-profiles-readonly.js:96-99 وaudit-scan-charge-
// race-readonly.js:131-134 يحسبان الجزء السداسي نفسه (بلا البادئة #، ويُعيدان
// null للغائب) — لم أمسّهما: ليسا في سجلّات الخادم.

const crypto = require("crypto");

/** بادئة المعرّف المُهشَّر — تفرّقه عن كلمات الحالة أدناه. */
const LOG_ID_PREFIX = "#";
/** عدد المحارف السداسية المأخوذة من sha256. */
const LOG_ID_HEX_LENGTH = 12;

// القاعدة 22: الغياب حالة صريحة تظهر في السجلّ — لا تهشيراً للفراغ ولا قيمة
// افتراضية. وهذه الكلمات لا تبدأ بـ# فلا تلتبس بمعرّف مُهشَّر.
const LOG_STATE_MISSING = "missing";
const LOG_STATE_PRESENT = "present";
const LOG_STATE_INVALID_TYPE = "invalid-type";

/**
 * @param {*} value
 * @return {boolean} غائبة: null/undefined/نصّ فارغ أو مسافات فقط.
 */
function isBlank(value) {
  return value === null || value === undefined ||
      (typeof value === "string" && value.trim() === "");
}

/**
 * يُهشِّر معرّفاً (uid / userId / ownerId …) للكتابة في سجلّ.
 * sha256 على نصّ المعرّف بترميز UTF-8، أوّل 12 محرفاً سداسياً، مسبوقة بـ#.
 * الغائب أو الفارغ → "missing" (لا تهشير). وغير النصّ → "invalid-type".
 * @param {*} id
 * @return {string}
 */
function hashIdForLog(id) {
  if (isBlank(id)) return LOG_STATE_MISSING;
  if (typeof id !== "string") return LOG_STATE_INVALID_TYPE;
  return LOG_ID_PREFIX +
      crypto.createHash("sha256").update(id, "utf8").digest("hex")
          .slice(0, LOG_ID_HEX_LENGTH);
}

/**
 * يُسجِّل حضور قيمة حسّاسة (رمز FCM، بريد، هاتف …) حالةً لا قيمةً — لا جزءاً
 * منها ولا طولها ولا بصمتها.
 * @param {*} value
 * @return {string} "present" | "missing" | "invalid-type"
 */
function presenceForLog(value) {
  if (isBlank(value)) return LOG_STATE_MISSING;
  if (typeof value !== "string") return LOG_STATE_INVALID_TYPE;
  return LOG_STATE_PRESENT;
}

module.exports = {
  hashIdForLog,
  presenceForLog,
  LOG_ID_PREFIX,
  LOG_ID_HEX_LENGTH,
  LOG_STATE_MISSING,
  LOG_STATE_PRESENT,
  LOG_STATE_INVALID_TYPE,
};
