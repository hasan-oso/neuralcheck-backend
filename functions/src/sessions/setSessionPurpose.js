"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {SESSION_STATUS, SET_PURPOSE_REFUSAL: R} = require("./sessionNames");
const {STATUS_STATE, classifyStatus, expiredWriteFields} = require("./sessionLifecycle");
const {SETTABLE_SESSION_PURPOSE, PURPOSE_SOURCE, PROTOCOL_COLLECTION, PROTOCOL_PART} = require("../protocol/protocolVocabulary");
const {isMaintenancePurpose, validateDefectTypeForPurpose, pendingFieldsForPurposeChoice} = require("../protocol/maintenancePair");
const {readProtocolParts} = require("../protocol/scanProtocolDocument");

// ===================================================
// Cloud Function: setSessionPurpose (callable) — المالك يختار غرض الجلسة وهي pending (S-P6-03، 2026-10-18 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٢-ب-٣ (:480-485) وdocs/PROTOCOL_CONTRACT.md §٢ A2: «ولمسة على غيرها تنادي `setSessionPurpose` (دالّة جديدة للمالك). ويُقبل التغيير ما دامت الجلسة `pending`. وبعد الانضمام
// تُقفل الرقائق بنصّ.» و«رفض `setSessionPurpose` بعد الانضمام ⇐ رفض مسمّى بسطر سجلّ، على سابقة `submitEvaluationRefusal.js`» (:503)؛ **الرمز `PURPOSE_SESSION_NOT_PENDING` معتمد (E5، 2026-10-15)** من protocolVocabulary.PURPOSE_REFUSAL.
//
// ─── المدخل والردّ ────────────────────────────────────────────────────────────
//   data: {sessionId: string, purpose: "normal" | "maintenance_before" | "maintenance_after", defectType?: string} — القيم من protocolVocabulary.SETTABLE_SESSION_PURPOSE (مصدر واحد). لا قيمة افتراضية للغرض (القاعدة 22): غيابه رفض.
//   **(2026-10-22، أمر ربط «قبل/بعد صيانة»، A2):** maintenance_* تحلّان محلّ battery_before/battery_after في ما يُختار (الأخيرتان قيمتا قراءة تاريخيتان: SET_PURPOSE_INVALID إن اختيرتا). **defectType** (DEFECT_TYPE) **مطلوب** لـmaintenance_* و**ممنوع** لـnormal:
//   الرفوض DEFECT_TYPE_REQUIRED · DEFECT_TYPE_INVALID · DEFECT_TYPE_NOT_APPLICABLE **قبل أيّ قراءة للجلسة** (maintenancePair.validateDefectTypeForPurpose). ويُخزَّن في protocolPending/{sessionId}.defectType (خادمي) **لا في scanSessions**
//   (الهاتف المنضمّ يقرؤه بالقواعد: firestore.rules:140-144). **جزء المحلّ (ق31، أقرّه حسن 2026-10-22) يُفحص بعد فحوص الجلسة داخل المعاملة (القسم «جزء المحلّ» أدناه).**
//   **شكل المدخل والردّ لا يحدّدهما التصميم** (يسمّي الدالّة ولا يسمّي حقولها): اقترحتُ {sessionId, purpose} (على نسق cancelScanSession {sessionId, reason}) والردّ {sessionId, purpose, purposeSource}؛ يُراجَع مع عقد التطبيق (A-P6-03).
//   auth مطلوب. **المالك وحده** (ownerId == uid): غيره — الجهاز المنضمّ أو غريب أو جلسة غير موجودة — الردّ نفسه (permission-denied، reasonCode=SESSION_NOT_PARTICIPANT) كي لا يُكشف وجود جلسة؛ والسجلّ يفرّق (SESSION_NOT_FOUND / NOT_OWNER).
//
// ─── الكتابة ──────────────────────────────────────────────────────────────────
//   معاملة واحدة تقرأ الجلسة ثم تكتب: `scanSessions/{id}.purpose` (يقرؤه المالك والمنضمّ بالقواعد القائمة، ولا يكتبه العميل) و`protocolPending/{id}.purposeSource = selected` (PLAN-06 «اختاره الفنّي»؛ خادمي بلا `match` في
//   القواعد: A0 البند ١). **«selected» حتى لو اختار «عادي» صراحةً** — فيتميّز من «عادي» الافتراضي (:478). لا حذف أبداً (القاعدة 42): الكتابة تحديث/دمج فقط.
//   **ومعهما في المستند نفسه (2026-10-22):** `defectType` (النوع، أو null صريحاً لـnormal) ومسح اختيار الربط السابق (linkedScanId · linkMethod · linkConfirmedAt · linkConfirmedByTechnicianId ⟵ null) — null لا FieldValue.delete() (القاعدة 42).
//   الحالات: pending فقط تُقبل؛ scanning (بعد الانضمام) وcompleted وcancelled وexpired ⟵ PURPOSE_SESSION_NOT_PENDING؛ حالة غائبة أو مجهولة ⟵ SESSION_STATUS_UNKNOWN بلا كتابة (القاعدة 22).
//   pending وانقضى expiresAt ولم تُسجَّل: تُكتب «منتهية» في المعاملة نفسها ثم يُرفض النداء بـSESSION_EXPIRED (قرار المستخدم 2026-10-10: «تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها»)؛ expiresAt غائب أو تالف ⟵
//   SESSION_EXPIRES_AT_INVALID بلا كتابة (لا يُقرأ الغياب صلاحيةً — القاعدة 22). **الجلسة المُنشأة قبل النشر** (بلا purpose ولا protocolPending) تقبل الاختيار: يُنشأ protocolPending بالدمج.
//
// ─── جزء المحلّ (ق31، أقرّه حسن بتاريخ 2026-10-22) ───────────────────────────────────────────────────
//   **كانت ثغرة:** النداء لا يتحقّق من تفعيل الجزء للمحلّ (ق31 في DECISIONS-FOR-HASAN-2026-10-21.md؛ «لا رمز رفض له في المواصفة (E5 يعتمد رمزاً واحداً)» فلم يُختلق رمز). **عُولجت بأمر المستخدم (قرار حسن ق31):**
//   داخل المعاملة نفسها، بعد فحوص الجلسة القائمة (وجود، ملكية، حالة، انقضاء) وقبل أيّ كتابة، يُقرأ مستند المالك users/{uid} (كما تقرؤه createScanSession) فيُرفض: غرض ≠ normal إن كان protocolParts.purposes !== true؛
//   وmaintenance_* إن كان protocolParts.batteryBeforeAfter !== true أيضاً؛ برمز واحد مسمّى PURPOSE_PART_NOT_ENABLED (SET_PURPOSE_REFUSAL.PART_NOT_ENABLED، مصدره PURPOSE_REFUSAL، وسم proposal A2) وسطر سجلّ فيه الجزء الناقص
//   `part=purposes|batteryBeforeAfter`؛ ومستند المالك الغائب حالة صريحة بالرمز نفسه (`owner=absent`: لا نجاحاً ولا قيمة افتراضية، القاعدة 22). `=== true` وحدها تفعّل (readProtocolParts).
//   **normal يبقى مقبولاً كما كان** (لا قراءة لمستند المالك له: لا تغيّر في سلوكه ولا كلفته). الرفض بلا أيّ كتابة. التفصيل: docs/PROTOCOL_CONTRACT.md §٢ A2 («ما عُولج: ق31»).
//
// ─── رسائل الرفض ──────────────────────────────────────────────────────────────
//   نصوص قائمة مُعاد استعمالها حيث للمعنى نصّ قائم («يجب تسجيل الدخول»، «جلسة الفحص غير صالحة»، «الجلسة منتهية»). وما لا نصّ قائم له يحمل رمزه نفسه رسالةً تقنيّةً — **لا نصّ عربي جديد يصل مستخدماً** (القرار ٩٠).
//   **معلّق: نصّ بانتظار الاعتماد** لرفض PURPOSE_SESSION_NOT_PENDING الذي يراه الفنّي (PROTOCOL_CONTRACT §٥-أ B9: «نصّ كل رفض يراه الفنّي أو الزبون غير معتمد وغير مكتوب»)؛ العميل يميّز بـdetails.reasonCode.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────
//   سطر بسبب مسمّى لكل رفض: `[setSessionPurpose] refused reason=<سبب> session=<#> caller=<#>`، وسطر للنجاح: `[setSessionPurpose] set session=<#> caller=<#> purpose=<قيمة> previous=<قيمة|ABSENT>`
//   (و` defectType=<النوع>` يُلحَق لـmaintenance_* وحدها؛ ورفوض النوع تُلحق ` purpose=<..> given=<نوع القيمة المُرسَلة>` — **نوعها لا قيمتها**).
//   ورفض الجزء (ق31) يُلحق ` part=<purposes|batteryBeforeAfter>` (وقبله ` owner=absent` حين مستند المالك غائب): اسم الجزء في السجلّ وحده لا في جسم الردّ.
//   المعرّفات كلّها عبر hashIdForLog (سياسة السجلّات)، ولا sessionId خامّ ولا uid.

/**
 * ردّ كل رفض: رمز HttpsError ونصّه، والرمز الذي يصل العميل في details.reasonCode.
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze({
  [R.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: R.NOT_AUTHENTICATED},
  [R.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: R.SESSION_ID_REQUIRED},
  [R.PURPOSE_REQUIRED]: {code: "invalid-argument", message: R.PURPOSE_REQUIRED, clientReasonCode: R.PURPOSE_REQUIRED},
  [R.PURPOSE_INVALID]: {code: "invalid-argument", message: R.PURPOSE_INVALID, clientReasonCode: R.PURPOSE_INVALID},
  [R.SESSION_NOT_FOUND]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.NOT_OWNER]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.NOT_PENDING]: {code: "failed-precondition", message: R.NOT_PENDING, clientReasonCode: R.NOT_PENDING},
  [R.EXPIRED]: {code: "failed-precondition", message: "الجلسة منتهية", clientReasonCode: R.EXPIRED},
  [R.EXPIRES_AT_INVALID]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.EXPIRES_AT_INVALID},
  [R.STATUS_UNKNOWN]: {code: "failed-precondition", message: R.STATUS_UNKNOWN, clientReasonCode: R.STATUS_UNKNOWN},
  [R.DEFECT_TYPE_REQUIRED]: {code: "invalid-argument", message: R.DEFECT_TYPE_REQUIRED, clientReasonCode: R.DEFECT_TYPE_REQUIRED},
  [R.DEFECT_TYPE_INVALID]: {code: "invalid-argument", message: R.DEFECT_TYPE_INVALID, clientReasonCode: R.DEFECT_TYPE_INVALID},
  [R.DEFECT_TYPE_NOT_APPLICABLE]: {code: "invalid-argument", message: R.DEFECT_TYPE_NOT_APPLICABLE, clientReasonCode: R.DEFECT_TYPE_NOT_APPLICABLE},
  // (ق31، 2026-10-22) لا نصّ عربي جديد: الرسالة رمزه التقني (نصّ الفنّي معلّق: PROTOCOL_CONTRACT §٥-أ B9)
  [R.PART_NOT_ENABLED]: {code: "failed-precondition", message: R.PART_NOT_ENABLED, clientReasonCode: R.PART_NOT_ENABLED},
});

const OUTCOME = Object.freeze({
  REFUSED: "REFUSED",
  SET: "SET", // يُكتب الغرض الآن
  EXPIRE: "EXPIRE", // pending وانقضى وقتها: تُكتب «منتهية» ثم يُرفض
});

/**
 * قرار الاختيار من مستند الجلسة وحده (دالّة نقيّة): الوجود، ثم الملكية، ثم الحالة، ثم الانقضاء.
 * @param {{data: ?Object, uid: string, now: Date}} p
 * @return {{outcome: string, refusal?: string, extra?: string}}
 */
function decideSetPurpose({data, uid, now}) {
  if (!data) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_NOT_FOUND};
  if (typeof data.ownerId !== "string" || data.ownerId === "" || data.ownerId !== uid) {
    return {outcome: OUTCOME.REFUSED, refusal: R.NOT_OWNER, extra: ` ownerState=${typeof data.ownerId === "string" && data.ownerId !== "" ? "SET" : "ABSENT"}`};
  }
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return {outcome: OUTCOME.REFUSED, refusal: R.STATUS_UNKNOWN, extra: ` statusState=${state}`};
  if (status !== SESSION_STATUS.PENDING) return {outcome: OUTCOME.REFUSED, refusal: R.NOT_PENDING, extra: ` status=${status}`};
  const expiry = sessionExpiryRefusal(data, now);
  if (expiry !== null) {
    if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) return {outcome: OUTCOME.EXPIRE, refusal: R.EXPIRED};
    return {outcome: OUTCOME.REFUSED, refusal: R.EXPIRES_AT_INVALID};
  }
  return {outcome: OUTCOME.SET};
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * جزء المحلّ اللازم للغرض (ق31، أقرّه حسن 2026-10-22)، دالّة نقيّة: normal لا يحتاج جزءاً؛ وغيره يحتاج purposes، وmaintenance_* يحتاج معه batteryBeforeAfter.
 * `=== true` وحدها تفعّل (readProtocolParts: الغائب و`false` و`"true"` نصّاً و`1` رقماً و`null` ⟵ غير مفعَّل)، والفحص بالترتيب فيُسمّى الجزء الناقص الأوّل.
 * مستند المالك غير الكائن (غائب) حالة صريحة (owner=absent) بالرمز نفسه، لا نجاحاً ولا قيمة افتراضية (القاعدة 22).
 * @param {{purpose: string, ownerData: ?Object}} p
 * @return {{ok: true}|{ok: false, refusal: string, extra: string}}
 */
function decidePurposePart({purpose, ownerData}) {
  if (purpose === SETTABLE_SESSION_PURPOSE.NORMAL) return {ok: true};
  const needed = [PROTOCOL_PART.PURPOSES, ...(isMaintenancePurpose(purpose) ? [PROTOCOL_PART.BATTERY_BEFORE_AFTER] : [])];
  const parts = readProtocolParts(ownerData);
  const missing = needed.find((part) => parts[part] !== true);
  if (missing === undefined) return {ok: true};
  return {ok: false, refusal: R.PART_NOT_ENABLED, extra: `${isObj(ownerData) ? "" : " owner=absent"} part=${missing}`};
}

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه setSessionPurpose.test.js).
 * @param {string} reason من SET_PURPOSE_REFUSAL
 * @param {{sessionId?: ?string, uid?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {sessionId = null, uid = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`setSessionPurpose: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[setSessionPurpose] refused reason=${reason}` +
      (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن (REFUSAL_RESPONSE)، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

const setSessionPurposeHandler = async (request) => {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(R.NOT_AUTHENTICATED);

  const d = request.data || {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (sessionId === "") refuse(R.SESSION_ID_REQUIRED, {uid});
  if (d.purpose === undefined || d.purpose === null || d.purpose === "") refuse(R.PURPOSE_REQUIRED, {sessionId, uid});
  if (typeof d.purpose !== "string" || !Object.values(SETTABLE_SESSION_PURPOSE).includes(d.purpose)) refuse(R.PURPOSE_INVALID, {sessionId, uid});
  const purpose = d.purpose;
  // نوع العطل مع الغرض (A2): قبل أيّ قراءة للجلسة. غائب ≠ null مُرسَل (القاعدة 22).
  const typeCheck = validateDefectTypeForPurpose({purpose, defectType: d.defectType});
  if (!typeCheck.ok) refuse(typeCheck.refusal, {sessionId, uid, extra: typeCheck.extra});
  const defectType = typeCheck.defectType;

  const sessionRef = db.collection("scanSessions").doc(sessionId);
  const pendingRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId);
  const ownerRef = db.collection("users").doc(uid); // (ق31) مستند المالك: uid هو المالك بعد فحص الملكية
  let decided;
  try {
    // معاملة واحدة: قراءة الجلسة ثم الكتابة. تُرجِع قراراً لا ترمي (الرمي داخل المعاملة يُسقطها فلا تُسجَّل «منتهية»).
    decided = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      const data = snap.exists ? snap.data() : null;
      const decision = decideSetPurpose({data, uid, now: new Date()});
      if (decision.outcome === OUTCOME.REFUSED) return decision;
      if (decision.outcome === OUTCOME.EXPIRE) {
        tx.update(sessionRef, expiredWriteFields(admin.firestore.FieldValue));
        return {outcome: OUTCOME.REFUSED, refusal: decision.refusal, expiredRecorded: true};
      }
      // (ق31) جزء المحلّ: بعد قرار الجلسة وقبل أيّ كتابة (القراءة بعد كتابة ترمي في Firestore). normal لا يقرأ مستند المالك أصلاً: سلوكه وكلفته كما كانا.
      if (purpose !== SETTABLE_SESSION_PURPOSE.NORMAL) {
        const ownerSnap = await tx.get(ownerRef);
        const partDecision = decidePurposePart({purpose, ownerData: ownerSnap.exists ? ownerSnap.data() : null});
        if (!partDecision.ok) return {outcome: OUTCOME.REFUSED, refusal: partDecision.refusal, extra: partDecision.extra};
      }
      const previous = typeof data.purpose === "string" ? data.purpose : "ABSENT";
      tx.update(sessionRef, {purpose});
      tx.set(pendingRef, {purposeSource: PURPOSE_SOURCE.SELECTED, ...pendingFieldsForPurposeChoice({defectType})}, {merge: true});
      return {...decision, previous};
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[setSessionPurpose] unexpected failure session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} ` +
        `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }
  if (decided.outcome === OUTCOME.REFUSED) {
    refuse(decided.refusal, {sessionId, uid, extra: (decided.extra || "") + (decided.expiredRecorded ? " expiredRecorded=true" : "")});
  }
  console.log(`[setSessionPurpose] set session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} purpose=${purpose} previous=${decided.previous}${isMaintenancePurpose(purpose) ? ` defectType=${defectType}` : ""}`);
  return {sessionId, purpose, purposeSource: PURPOSE_SOURCE.SELECTED};
};

exports.setSessionPurpose = onCall({timeoutSeconds: 30, memory: "256MiB"}, setSessionPurposeHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.OUTCOME = OUTCOME;
exports.decideSetPurpose = decideSetPurpose;
exports.decidePurposePart = decidePurposePart;
exports.refuse = refuse;
exports.setSessionPurposeHandler = setSessionPurposeHandler;
