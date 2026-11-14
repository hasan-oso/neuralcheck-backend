"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db, requireAdmin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {PROTOCOL_COLLECTION, PROTOCOL_PART} = require("../protocol/protocolVocabulary");
const {readProtocolParts} = require("../protocol/scanProtocolDocument");
const {
  TECHNICIAN_ACTION, SHOP_PROTOCOL_REFUSAL: R, REFUSAL_RESPONSE, readShopId, validatePartsPatch, changedParts, validateTechnicianCall,
  buildTechnicianDocument, technicianUpdate, readTechnicianForView,
} = require("../protocol/shopProtocol");

// ===================================================
// setShopProtocolParts / manageTechnician / getShopProtocolConfig — تفعيل الأجزاء وفنّيو المحلّ من لوحة الإدارة (S-P6-14، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:787-792) وdocs/PROTOCOL_CONTRACT.md §٢ A10 (إلحاق مؤرَّخ بكل شكل سلك). التحقّق دوالّ نقيّة في protocol/shopProtocol.js (القاعدة 41)؛ هذا الملفّ I/O وسجلّ وردّ.
// **أسماء الدوالّ الثلاث اقتراحية** (التصميم يذكر الأفعال لا النداءات). **المشرف** بـrequireAdmin (بريد مؤكَّد). لا حذف في أيّ مسار (القاعدة 42). **لا أسماء ولا بيانات فنّيين** تُكتب من الكود («ولا تُدخل أيّ أسماء الآن»): الكتابة
// بنداء المشرف وحده حين يبدأ العمل. لا استعلام بترتيب أو مدى أو فهرس: مساواة على `ownerId` وحدها (A0 البند ٩، القاعدة 43).
//
// ─── setShopProtocolParts({ownerId, parts}) ───────────────────────────────────────────────────────────────────────
//   `parts` رقعة: مفاتيح من PROTOCOL_PART (`purposes` · `batteryBeforeAfter` · `coldRepeat` · `returns` · `doubleEval` · `consent`) بقيم منطقية؛ والاسم القديم `batteryPairs` مرفوض (E42). معاملة: تقرأ مستند المحلّ (غائب ⟵ SHOP_NOT_FOUND، ولا يُنشأ)،
//   وتكتب `protocolParts` مدموجاً (ما لم تمسّه الرقعة يبقى بحاله) **إن تغيّر جزء فعلاً**. الردّ `{ownerId, parts, changed}` — `parts` الستّة بقاعدة القراءة نفسها (`=== true` وحدها)، و`changed` أسماء الأجزاء المتغيّرة.
//
// ─── manageTechnician({ownerId, action, technicianId?, displayName?, active?}) ─────────────────────────────────
//   `action` ∈ {add, rename, set_active} — لا فعل حذف. add: {ownerId, displayName} ⟵ `technicians/{معرّف يولّده Firestore}` = {displayName, ownerId, active: true, createdAt, updatedAt} (E15)؛ المحلّ يجب أن يكون موجوداً.
//   rename: {ownerId, technicianId, displayName}؛ set_active: {ownerId, technicianId, active}. الفنّي يجب أن يكون لهذا المحلّ (TECHNICIAN_OWNER_MISMATCH وإلا TECHNICIAN_NOT_FOUND). غير المتغيّر لا يُكتب (`changed: false`).
//   الردّ `{technicianId, ownerId, displayName, active, changed}`. الحقول الأخرى في المدخل تُتجاهل (لا تُرفض) ما لم يكن الفعل يقرؤها.
//
// ─── getShopProtocolConfig({ownerId}) ─────────────────────────────────────────────────────────────────────────────
//   الردّ `{ownerId, partsState, parts, technicians}`: `partsState` ∈ {"PRESENT", "ABSENT"} (المستند يحمل `protocolParts` كائناً أم لا؛ الغائب ⟵ كل الأجزاء false)؛ `parts` الستّة؛ technicians كل فنّيي المحلّ (الفعّالين والموقوفين)
//   `{technicianId, displayName, active, activeState, createdAtMs, updatedAtMs}` مرتّبة في الذاكرة بـ`createdAtMs` ثم المعرّف (الاستعلام مساواة بلا ترتيب)؛ `activeState` ∈ {ACTIVE, INACTIVE, ACTIVE_FLAG_UNREADABLE}.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   `[<fn>] <done> owner=<#> caller=<#>[ technician=<#>] ...` — **لا اسم فنّي ولا قيمة** (أسماء الأجزاء وعددها فقط). الفشل غير المتوقَّع: الصنف والرمز وحدهما (القاعدة 36).

const SET_PARTS = "setShopProtocolParts";
const MANAGE = "manageTechnician";
const GET_CONFIG = "getShopProtocolConfig";
const USERS = "users";

const toMillisOrNull = (v) => (v && typeof v.toMillis === "function" && Number.isFinite(v.toMillis()) ? v.toMillis() : null);

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` الخاصّ بهذا الملفّ**.
 * @param {string} fn
 * @param {string} reason من SHOP_PROTOCOL_REFUSAL
 * @param {{uid?: ?string, ownerId?: ?string, extra?: string}} [ctx]
 */
function refuse(fn, reason, {uid = null, ownerId = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`shopProtocolAdmin: سبب رفض غير مُدرَج: ${String(reason)}`);
  // المعرّفان بـhashIdForLog وحده (حارسا piiLogGuard وlogIdInventory يرفضان معرّفاً خامّاً ولو شرطاً أو متغيّراً مشتقّاً)؛ الغائب يُطبع «missing» لا مخفياً (القاعدة 22).
  console.warn(`[${fn}] refused reason=${reason} owner=${hashIdForLog(ownerId)} caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

function logUnexpected(fn, e, uid) {
  const className = (e && e.constructor && e.constructor.name) || typeof e;
  console.error(`[${fn}] unexpected failure caller=${hashIdForLog(uid)} [${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ─── setShopProtocolParts ──────────────────────────────────────────────────────────────────────────────────────────

const setShopProtocolPartsHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const d = isObj(request.data) ? request.data : {};
  const ownerId = readShopId(d.ownerId);
  if (ownerId === null) refuse(SET_PARTS, R.SHOP_ID_REQUIRED, {uid});
  const validated = validatePartsPatch(d.parts);
  if (!validated.ok) refuse(SET_PARTS, validated.refusal, {uid, ownerId, extra: validated.extra || ""});

  const userRef = db.collection(USERS).doc(ownerId);
  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return {refused: R.SHOP_NOT_FOUND};
      const data = snap.data();
      const changed = changedParts(readProtocolParts(data), validated.patch);
      if (changed.length > 0) {
        const existing = isObj(data.protocolParts) ? data.protocolParts : {};
        tx.update(userRef, {protocolParts: {...existing, ...validated.patch}});
      }
      const after = readProtocolParts({protocolParts: {...(isObj(data.protocolParts) ? data.protocolParts : {}), ...validated.patch}});
      return {changed, parts: after};
    });
  } catch (e) {
    logUnexpected(SET_PARTS, e, uid);
    throw e;
  }
  if (decided.refused) refuse(SET_PARTS, decided.refused, {uid, ownerId});
  console.log(`[${SET_PARTS}] ${decided.changed.length > 0 ? "written" : "unchanged"} owner=${hashIdForLog(ownerId)} caller=${hashIdForLog(uid)} changed=${decided.changed.join(",") || "none"}`);
  return {ownerId, parts: decided.parts, changed: decided.changed};
};

// ─── manageTechnician ──────────────────────────────────────────────────────────────────────────────────────────────

const manageTechnicianHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const call = validateTechnicianCall(request.data);
  const rawOwner = isObj(request.data) ? readShopId(request.data.ownerId) : null;
  if (!call.ok) refuse(MANAGE, call.refusal, {uid, ownerId: rawOwner});
  const {ownerId} = call;
  const userRef = db.collection(USERS).doc(ownerId);
  const techRef = call.action === TECHNICIAN_ACTION.ADD ?
      db.collection(PROTOCOL_COLLECTION.TECHNICIANS).doc() :
      db.collection(PROTOCOL_COLLECTION.TECHNICIANS).doc(call.technicianId);

  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const FieldValue = admin.firestore.FieldValue;
      if (call.action === TECHNICIAN_ACTION.ADD) {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) return {refused: R.SHOP_NOT_FOUND};
        tx.create(techRef, buildTechnicianDocument({ownerId, displayName: call.displayName, now: FieldValue.serverTimestamp()}));
        return {changed: true, technicianId: techRef.id, displayName: call.displayName, active: true, word: "added"};
      }
      const techSnap = await tx.get(techRef);
      if (!techSnap.exists) return {refused: R.TECHNICIAN_NOT_FOUND};
      const current = techSnap.data();
      if (typeof current.ownerId !== "string" || current.ownerId !== ownerId) return {refused: R.TECHNICIAN_OWNER_MISMATCH};
      const update = technicianUpdate(call, current);
      if (update.changed) tx.update(techRef, {...update.fields, updatedAt: FieldValue.serverTimestamp()});
      const view = readTechnicianForView({...current, ...update.fields});
      return {changed: update.changed, technicianId: techRef.id, displayName: view.displayName, active: view.active, word: update.changed ? call.action : "unchanged"};
    });
  } catch (e) {
    logUnexpected(MANAGE, e, uid);
    throw e;
  }
  if (decided.refused) refuse(MANAGE, decided.refused, {uid, ownerId});
  console.log(`[${MANAGE}] ${decided.word} owner=${hashIdForLog(ownerId)} technician=${hashIdForLog(decided.technicianId)} caller=${hashIdForLog(uid)}`);
  return {technicianId: decided.technicianId, ownerId, displayName: decided.displayName, active: decided.active, changed: decided.changed};
};

// ─── getShopProtocolConfig ─────────────────────────────────────────────────────────────────────────────────────────

const getShopProtocolConfigHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const d = isObj(request.data) ? request.data : {};
  const ownerId = readShopId(d.ownerId);
  if (ownerId === null) refuse(GET_CONFIG, R.SHOP_ID_REQUIRED, {uid});
  let userSnap;
  let techSnap;
  try {
    userSnap = await db.collection(USERS).doc(ownerId).get();
    if (userSnap.exists) techSnap = await db.collection(PROTOCOL_COLLECTION.TECHNICIANS).where("ownerId", "==", ownerId).get();
  } catch (e) {
    logUnexpected(GET_CONFIG, e, uid);
    throw e;
  }
  if (!userSnap.exists) refuse(GET_CONFIG, R.SHOP_NOT_FOUND, {uid, ownerId});
  const data = userSnap.data();
  const technicians = techSnap.docs.map((doc) => {
    const t = doc.data();
    const view = readTechnicianForView(t);
    return {technicianId: doc.id, displayName: view.displayName, active: view.active, activeState: view.activeState, createdAtMs: toMillisOrNull(t.createdAt), updatedAtMs: toMillisOrNull(t.updatedAt)};
  });
  technicians.sort((a, b) => {
    if (a.createdAtMs !== b.createdAtMs) {
      if (a.createdAtMs === null) return 1;
      if (b.createdAtMs === null) return -1;
      return a.createdAtMs - b.createdAtMs;
    }
    return a.technicianId < b.technicianId ? -1 : a.technicianId > b.technicianId ? 1 : 0;
  });
  console.log(`[${GET_CONFIG}] served owner=${hashIdForLog(ownerId)} caller=${hashIdForLog(uid)} technicians=${technicians.length}`);
  return {ownerId, partsState: isObj(data.protocolParts) ? "PRESENT" : "ABSENT", parts: readProtocolParts(data), technicians};
};

exports.setShopProtocolParts = onCall({timeoutSeconds: 30, memory: "256MiB"}, setShopProtocolPartsHandler);
exports.manageTechnician = onCall({timeoutSeconds: 30, memory: "256MiB"}, manageTechnicianHandler);
exports.getShopProtocolConfig = onCall({timeoutSeconds: 30, memory: "256MiB"}, getShopProtocolConfigHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.refuse = refuse;
exports.PROTOCOL_PART_KEYS = Object.values(PROTOCOL_PART);
