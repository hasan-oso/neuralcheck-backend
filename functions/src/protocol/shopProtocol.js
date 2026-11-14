"use strict";

// ===================================================
// shopProtocol — تفعيل أجزاء البروتوكول لكل محلّ وقائمة فنّيّيه: التحقّق (S-P6-14، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:787-792) وdocs/PROTOCOL_CONTRACT.md §٢ A10:
//   «التفعيل لكل محلّ: `users/{uid}.protocolParts = {purposes, batteryPairs, coldRepeat, returns, doubleEval, consent}` بجانب `evaluationEnabled`. الغائب «غير مفعَّل» ... ويُكتب كما يُكتب `evaluationEnabled` اليوم.
//   ✎ 2026-10-15 (+03): المفتاح `batteryPairs` ... صار `batteryBeforeAfter` (E42).»
//   «قائمة الفنّيين لكل محلّ (technicians). ✎ شاشة «الفنّيون» (قرار المستخدم 2026-10-10، بنصّه): «إضافة اسم، وتعديله، وإيقافه بلا حذف (فتبقى تقييماته القديمة مربوطة باسمه). ولا تُدخل أيّ أسماء الآن.»
//   ويُدخلها المستخدم بنفسه من لوحة الإدارة حين يبدأ العمل معهم. والربط بمعرّف ثابت للفنّي لا بنصّ اسمه، فالتعديل لا يقطع ربط تقييماته [اجتهاد تصميمي].»
//   وحقول technicians «الاسم المعروض، والمحلّ، وفعّال» (P:191): `displayName` · `ownerId` · `active` (+ `createdAt` · `updatedAt`) — E15 (معتمد بتعديل 2026-10-15).
// **دوالّ نقيّة بلا I/O** (القاعدة 41)؛ الكتابة في admin/shopProtocolAdmin.js. **لا أسماء ولا بيانات فنّيين في الكود ولا الاختبارات الحقيقية** («ولا تُدخل أيّ أسماء الآن»): الاختبارات تبذر أسماء وهمية موسومة في المحاكي وحده.
//
// «الكتابة المحروسة» (أمر S-P6-14): التصميم يقول «ويُكتب كما يُكتب evaluationEnabled اليوم» (كتابة مباشرة من لوحة المشرف بالقاعدة الشاملة `isAdmin`)؛ ودالّة الخادم **اقتراحي** تحرس الكتابة نفسها: مفاتيح الأجزاء من
// PROTOCOL_PART وحدها وقيمها منطقية وحدها (فنصّ «true» أو مفتاح خاطئ لا يُكتبان صامتَين فيُقرآن «غير مفعَّل» بلا أثر)، والمحلّ موجود (لا يُنشأ مستند مستخدم). الكتابة المباشرة تبقى ممكنة بالقاعدة الشاملة (قيد معروف: A0 البند ١).
//
// ─── الفنّي ──────────────────────────────────────────────────────────────────────────────────────────────────────
// `technicianId` معرّف المستند الذي يولّده Firestore (ثابت لا يُعاد استعماله ولا يتبع الاسم). الإيقاف `active: false` **لا حذف** (القاعدة 42): الفنّي الموقوف لا يظهر في getTechnicianFormConfig ولا يُقبل في submitTechnicianForm
// (technicianState = INACTIVE) وتبقى استماراته القديمة مربوطة بمعرّفه. **لا حدّ لعدد الفنّيين ولا تفرّد لاسمهم** (لم يُذكرا: الربط بالمعرّف لا بالاسم). الفنّي الجديد `active: true` عند الإضافة (قرار تنفيذ: «إضافة اسم» تعني اسماً يُستعمل).

const {PROTOCOL_PART} = require("./protocolVocabulary");
const {MAX_TECHNICIAN_NAME_LEN} = require("../evaluations/evaluationContract");
const {isSafeDocId} = require("../evaluations/technicianFormContract");

/** أفعال manageTechnician (اقتراحي: التصميم يذكر الأفعال الثلاثة «إضافة اسم، وتعديله، وإيقافه» ولا يسمّي النداء ولا قيم الفعل). لا فعل حذف. */
const TECHNICIAN_ACTION = Object.freeze({
  ADD: "add",
  RENAME: "rename",
  SET_ACTIVE: "set_active",
});

/** رموز الرفض (اقتراحي، بنسق REPEAT_* وSET_PURPOSE_*). */
const SHOP_PROTOCOL_REFUSAL = Object.freeze({
  SHOP_ID_REQUIRED: "SHOP_ID_REQUIRED", // ownerId غائب أو ليس معرّف مستند صالحاً
  SHOP_NOT_FOUND: "SHOP_NOT_FOUND", // لا مستند users/{ownerId} (لا يُنشأ)
  PARTS_REQUIRED: "SHOP_PARTS_REQUIRED", // parts غائب أو ليس كائناً أو فارغاً
  PARTS_KEY_UNKNOWN: "SHOP_PARTS_KEY_UNKNOWN", // مفتاح خارج PROTOCOL_PART (ومنه الاسم القديم batteryPairs)
  PARTS_VALUE_INVALID: "SHOP_PARTS_VALUE_INVALID", // قيمة ليست منطقية
  ACTION_REQUIRED: "TECHNICIAN_ACTION_REQUIRED",
  ACTION_INVALID: "TECHNICIAN_ACTION_INVALID",
  TECHNICIAN_ID_REQUIRED: "TECHNICIAN_ID_REQUIRED",
  NAME_INVALID: "TECHNICIAN_NAME_INVALID", // displayName غائب أو ليس نصّاً أو فارغ أو أطول من MAX_TECHNICIAN_NAME_LEN
  ACTIVE_INVALID: "TECHNICIAN_ACTIVE_INVALID", // active غائب أو ليس منطقياً (set_active)
  TECHNICIAN_NOT_FOUND: "TECHNICIAN_NOT_FOUND",
  TECHNICIAN_OWNER_MISMATCH: "TECHNICIAN_OWNER_MISMATCH", // الفنّي موجود لمحلّ آخر
});
const R = SHOP_PROTOCOL_REFUSAL;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @param {*} v request.data.ownerId
 * @return {?string} المعرّف مشذَّباً أو null إن لم يصلح
 */
function readShopId(v) {
  return typeof v === "string" && isSafeDocId(v) ? v.trim() : null;
}

/**
 * رقعة أجزاء المحلّ: مفاتيح PROTOCOL_PART وحدها بقيم منطقية.
 * @param {*} parts
 * @return {{ok: true, patch: Object<string, boolean>}|{ok: false, refusal: string, extra?: string}}
 */
function validatePartsPatch(parts) {
  if (!isObj(parts) || Object.keys(parts).length === 0) return {ok: false, refusal: R.PARTS_REQUIRED};
  const known = Object.values(PROTOCOL_PART);
  for (const k of Object.keys(parts)) {
    if (!known.includes(k)) return {ok: false, refusal: R.PARTS_KEY_UNKNOWN, extra: " part=UNKNOWN"}; // مفتاح العميل لا يُطبع (نصّ حرّ)
  }
  const patch = {};
  for (const k of known) {
    if (!Object.prototype.hasOwnProperty.call(parts, k)) continue;
    if (typeof parts[k] !== "boolean") return {ok: false, refusal: R.PARTS_VALUE_INVALID, extra: ` part=${k}`};
    patch[k] = parts[k];
  }
  return {ok: true, patch};
}

/**
 * أيّ الأجزاء يتغيّر فعلاً (المقروء الحالي بقاعدة «=== true وحدها» مقابل الرقعة).
 * @param {Object<string, boolean>} currentParts ناتج readProtocolParts (ستّة مفاتيح)
 * @param {Object<string, boolean>} patch
 * @return {string[]}
 */
function changedParts(currentParts, patch) {
  return Object.keys(patch).filter((k) => currentParts[k] !== patch[k]);
}

/**
 * مدخل manageTechnician.
 * @param {*} data request.data
 * @return {{ok: true, action: string, ownerId: string, technicianId: ?string, displayName: ?string, active: ?boolean}|{ok: false, refusal: string}}
 */
function validateTechnicianCall(data) {
  const d = isObj(data) ? data : {};
  const ownerId = readShopId(d.ownerId);
  if (ownerId === null) return {ok: false, refusal: R.SHOP_ID_REQUIRED};
  if (d.action === undefined || d.action === null || d.action === "") return {ok: false, refusal: R.ACTION_REQUIRED};
  const action = typeof d.action === "string" ? d.action : null;
  if (action === null || !Object.values(TECHNICIAN_ACTION).includes(action)) return {ok: false, refusal: R.ACTION_INVALID};
  let technicianId = null;
  if (action !== TECHNICIAN_ACTION.ADD) {
    technicianId = typeof d.technicianId === "string" && isSafeDocId(d.technicianId) ? d.technicianId.trim() : null;
    if (technicianId === null) return {ok: false, refusal: R.TECHNICIAN_ID_REQUIRED};
  }
  let displayName = null;
  if (action === TECHNICIAN_ACTION.ADD || action === TECHNICIAN_ACTION.RENAME) {
    displayName = typeof d.displayName === "string" ? d.displayName.trim() : null;
    if (displayName === null || displayName === "" || displayName.length > MAX_TECHNICIAN_NAME_LEN) return {ok: false, refusal: R.NAME_INVALID};
  }
  let active = null;
  if (action === TECHNICIAN_ACTION.SET_ACTIVE) {
    if (typeof d.active !== "boolean") return {ok: false, refusal: R.ACTIVE_INVALID};
    active = d.active;
  }
  return {ok: true, action, ownerId, technicianId, displayName, active};
}

/**
 * مستند فنّي جديد (E15: displayName · ownerId · active + createdAt · updatedAt).
 * @param {{ownerId: string, displayName: string, now: *}} p now الوقت (FieldValue.serverTimestamp() حيّاً) — يُمرَّر صراحةً
 * @return {Object}
 */
function buildTechnicianDocument({ownerId, displayName, now}) {
  return {displayName, ownerId, active: true, createdAt: now, updatedAt: now};
}

/**
 * ما يُكتب في تعديل فنّي قائم. غير المتغيّر لا يُكتب.
 * @param {{action: string, displayName: ?string, active: ?boolean}} call
 * @param {Object} current بيانات الفنّي الحالية
 * @return {{changed: boolean, fields: Object}}
 */
function technicianUpdate(call, current) {
  if (call.action === TECHNICIAN_ACTION.RENAME) return current.displayName === call.displayName ? {changed: false, fields: {}} : {changed: true, fields: {displayName: call.displayName}};
  return current.active === call.active ? {changed: false, fields: {}} : {changed: true, fields: {active: call.active}};
}

/**
 * حالة الفنّي المخزَّن للعرض: `active` الغائب أو غير المنطقي يُعلَن ولا يُقرأ فعّالاً (القاعدة 22، كما technicianState في technicianForm.js).
 * @param {?Object} data
 * @return {{displayName: ?string, active: ?boolean, activeState: string}}
 */
function readTechnicianForView(data) {
  const d = isObj(data) ? data : {};
  const activeState = d.active === true ? "ACTIVE" : d.active === false ? "INACTIVE" : "ACTIVE_FLAG_UNREADABLE";
  return {displayName: typeof d.displayName === "string" ? d.displayName : null, active: typeof d.active === "boolean" ? d.active : null, activeState};
}

const REFUSAL_RESPONSE = Object.freeze({
  [R.SHOP_ID_REQUIRED]: {code: "invalid-argument", message: R.SHOP_ID_REQUIRED, clientReasonCode: R.SHOP_ID_REQUIRED},
  [R.SHOP_NOT_FOUND]: {code: "not-found", message: R.SHOP_NOT_FOUND, clientReasonCode: R.SHOP_NOT_FOUND},
  [R.PARTS_REQUIRED]: {code: "invalid-argument", message: R.PARTS_REQUIRED, clientReasonCode: R.PARTS_REQUIRED},
  [R.PARTS_KEY_UNKNOWN]: {code: "invalid-argument", message: R.PARTS_KEY_UNKNOWN, clientReasonCode: R.PARTS_KEY_UNKNOWN},
  [R.PARTS_VALUE_INVALID]: {code: "invalid-argument", message: R.PARTS_VALUE_INVALID, clientReasonCode: R.PARTS_VALUE_INVALID},
  [R.ACTION_REQUIRED]: {code: "invalid-argument", message: R.ACTION_REQUIRED, clientReasonCode: R.ACTION_REQUIRED},
  [R.ACTION_INVALID]: {code: "invalid-argument", message: R.ACTION_INVALID, clientReasonCode: R.ACTION_INVALID},
  [R.TECHNICIAN_ID_REQUIRED]: {code: "invalid-argument", message: R.TECHNICIAN_ID_REQUIRED, clientReasonCode: R.TECHNICIAN_ID_REQUIRED},
  [R.NAME_INVALID]: {code: "invalid-argument", message: R.NAME_INVALID, clientReasonCode: R.NAME_INVALID},
  [R.ACTIVE_INVALID]: {code: "invalid-argument", message: R.ACTIVE_INVALID, clientReasonCode: R.ACTIVE_INVALID},
  [R.TECHNICIAN_NOT_FOUND]: {code: "not-found", message: R.TECHNICIAN_NOT_FOUND, clientReasonCode: R.TECHNICIAN_NOT_FOUND},
  [R.TECHNICIAN_OWNER_MISMATCH]: {code: "failed-precondition", message: R.TECHNICIAN_OWNER_MISMATCH, clientReasonCode: R.TECHNICIAN_OWNER_MISMATCH},
});

module.exports = {
  TECHNICIAN_ACTION, SHOP_PROTOCOL_REFUSAL, REFUSAL_RESPONSE,
  readShopId, validatePartsPatch, changedParts, validateTechnicianCall, buildTechnicianDocument, technicianUpdate, readTechnicianForView,
};
