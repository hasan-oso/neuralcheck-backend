"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {SESSION_STATUS, SESSION_ROLE, RECORD_CONSENT_REFUSAL: R} = require("./sessionNames");
const {STATUS_STATE, classifyStatus, sessionRoleOf, expiredWriteFields} = require("./sessionLifecycle");
const {PROTOCOL_COLLECTION, PROTOCOL_PART, CONSENT_STATE} = require("../protocol/protocolVocabulary");
const {CONSENT_FIELD, STORED_CONSENT_STATE, validateConsentInput, buildAcceptedRecord, readStoredConsent} = require("../protocol/consent");
const {consentPartDecision} = require("./consentPartState");

// ===================================================
// Cloud Function: recordScanConsent (callable) — الجهاز المفحوص يسجّل موافقته بعد الانضمام وقبل بدء الفحص (S-P6-12، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١١ (:1377-1413) وdocs/PROTOCOL_CONTRACT.md §٢ A8: «مسار `consent` بين الانضمام و`pre_scan`» (:1388)؛ «**«أوافق»** ⇐ يُخزَّن في protocolPending ثم scanProtocol:
// `consent: {state: "accepted", textVersion, locale, acceptedAt (الخادم)}`» (:1393)؛ «**فشل تسجيل الموافقة** (شبكة) ⇐ الفحص لا يبدأ حتى تُسجَّل [اجتهاد]. **فالموافقة غير المسجَّلة لا تُقرأ موافقة.**» (:1402).
// **اسم الدالّة والمدخل والردّ ورموز الرفض اقتراحية** (التصميم يسمّي حقل الموافقة وقيمه ولا يسمّي دالّة تكتبه؛ «دالّتا الجهاز والفنّي» تكتبان protocolPending: :185) — يحاذيها وكيل التطبيق (A-P6-12) إلى A8 في docs/PROTOCOL_CONTRACT.md لا إلى هذا الكود.
// «**لا أوافق**» لا تمرّ من هنا: هو نداء cancelScanSession بسبب consent_declined (قائم منذ الدفعة ٩، :1394 و:1016)، ولا معرّف يُرسل.
//
// ─── المدخل والردّ ────────────────────────────────────────────────────────────────────────────────────────────────
//   data: {sessionId: string, textVersion: integer ∈ [1, CONSENT_TEXT_VERSION], locale: "ar" | "tr"} — بلا قيمة افتراضية لأيّ منها (القاعدة 22): غياب أيّ منها رفض بسببه.
//   الردّ: {sessionId, state: "accepted", textVersion, locale, alreadyRecorded: boolean} — القيم المخزَّنة (النداء الثاني يردّ الأولى: الأوّل يبقى).
//   auth مطلوب: الجهاز المنضمّ يسجّل دخولاً مجهولاً قبل أيّ نداء. **الجهاز المنضمّ وحده** (joinedBy == uid، المقارنة نفسها isJoinedBy: الغائب لا يساوي الغائب): المالك أو الغريب أو جلسة غير موجودة — الردّ نفسه
//   (permission-denied، reasonCode=SESSION_NOT_PARTICIPANT) كي لا يُكشف وجود جلسة؛ والسجلّ يفرّق (SESSION_NOT_FOUND / SESSION_NOT_JOINER).
//
// ─── الحالات ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   scanning وحدها تُقبل («بعد الانضمام»)؛ completed وcancelled وexpired ⟵ CONSENT_SESSION_NOT_SCANNING؛ حالة غائبة أو مجهولة ⟵ SESSION_STATUS_UNKNOWN بلا كتابة (القاعدة 22).
//   scanning وانقضى expiresAt ولم تُسجَّل: تُكتب «منتهية» في المعاملة نفسها ثم يُرفض النداء SESSION_EXPIRED (قرار المستخدم 2026-10-10: «تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها»)؛
//   expiresAt غائب أو تالف ⟵ SESSION_EXPIRES_AT_INVALID بلا كتابة.
//
// ─── الكتابة ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   معاملة واحدة تقرأ الجلسة ثم protocolPending/{sessionId}، ثم — حين يصل القرار إلى «اكتب» فقط — مستند المالك users/{ownerId} (كل القراءات قبل أيّ كتابة)، وتكتب **مفتاحاً واحداً** `consent` بالدمج (`{merge: true}`): لا يُمحى purposeSource ولا doubleEvalDraw ولا أيّ حقل آخر. لا حذف أبداً (القاعدة 42).
//   **الأوّل يبقى**: إن وُجد سجلّ موافقة مقروء لم تُكتب ثانية (alreadyRecorded=true بالمخزَّن، **بلا قراءة لمستند المالك**)؛ **المخزَّن غير المقروء** لا يُكتب فوقه (CONSENT_STORED_UNREADABLE، failed-precondition).
//   **جزء الموافقة للمحلّ (ق40، 2026-10-23، أقرّه حسن 2026-10-22 مع ق15):** يُرفض التسجيل CONSENT_PART_NOT_ENABLED (failed-precondition، رسالته رمزه، details.reasonCode) إن لم يكن users/{ownerId}.protocolParts.consent === true (`=== true` وحدها: readProtocolParts). مستند المالك غائب (أو ownerId الجلسة لا يصلح معرّف مستند: لا قراءة أصلاً) ⟵ الرمز نفسه مع ` owner=absent` (القاعدة 22).
//   الفحص **آخر القرارات**: بعد المدخل والجلسة والدور والحالة والانقضاء والمخزَّن (فرفضٌ أسبق يسبقه ولا يقرأ المالك)، وقراءة المالك **داخل المعاملة** على نمط ق31 (setSessionPurpose). ALREADY_RECORDED وانقضاء الجلسة لا يتأثّران (لا كتابة موافقة جديدة فيهما).
//
// ─── رسائل الرفض ──────────────────────────────────────────────────────────────────────────────────────────────────
//   نصوص قائمة مُعاد استعمالها حيث للمعنى نصّ قائم («يجب تسجيل الدخول»، «جلسة الفحص غير صالحة»، «الجلسة منتهية»، «sessionId مطلوب»). وما لا نصّ قائم له يحمل رمزه نفسه رسالةً تقنيّة — **لا نصّ عربي جديد يصل مستخدماً** (القرار ٩٠).
//   **معلّق: نصّ بانتظار الاعتماد** لرفض CONSENT_SESSION_NOT_SCANNING ورفض CONSENT_STORED_UNREADABLE الذي قد يراه الزبون (PROTOCOL_CONTRACT §٥-أ B9: «نصّ كل رفض يراه الفنّي أو الزبون غير معتمد وغير مكتوب»)؛ العميل يميّز بـdetails.reasonCode.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   `[recordScanConsent] refused reason=<سبب> session=<#> caller=<#>[ extra]` لكل رفض؛ و`[recordScanConsent] recorded session=<#> caller=<#> textVersion=<n> locale=<ar|tr> alreadyRecorded=<bool>[ differs=true]` للنجاح.
//   المعرّفات كلّها عبر hashIdForLog (سياسة السجلّات)، ولا sessionId خامّ ولا uid؛ نسخة النصّ واللغة قيمتان مغلقتان لا شخصيّتان.

/**
 * ردّ كل رفض: رمز HttpsError ونصّه، والرمز الذي يصل العميل في details.reasonCode.
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze({
  [R.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: R.NOT_AUTHENTICATED},
  [R.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: R.SESSION_ID_REQUIRED},
  [R.TEXT_VERSION_REQUIRED]: {code: "invalid-argument", message: R.TEXT_VERSION_REQUIRED, clientReasonCode: R.TEXT_VERSION_REQUIRED},
  [R.TEXT_VERSION_INVALID]: {code: "invalid-argument", message: R.TEXT_VERSION_INVALID, clientReasonCode: R.TEXT_VERSION_INVALID},
  [R.LOCALE_REQUIRED]: {code: "invalid-argument", message: R.LOCALE_REQUIRED, clientReasonCode: R.LOCALE_REQUIRED},
  [R.LOCALE_INVALID]: {code: "invalid-argument", message: R.LOCALE_INVALID, clientReasonCode: R.LOCALE_INVALID},
  [R.SESSION_NOT_FOUND]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.NOT_JOINER]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.NOT_SCANNING]: {code: "failed-precondition", message: R.NOT_SCANNING, clientReasonCode: R.NOT_SCANNING},
  [R.EXPIRED]: {code: "failed-precondition", message: "الجلسة منتهية", clientReasonCode: R.EXPIRED},
  [R.EXPIRES_AT_INVALID]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.EXPIRES_AT_INVALID},
  [R.STATUS_UNKNOWN]: {code: "failed-precondition", message: R.STATUS_UNKNOWN, clientReasonCode: R.STATUS_UNKNOWN},
  [R.STORED_UNREADABLE]: {code: "failed-precondition", message: R.STORED_UNREADABLE, clientReasonCode: R.STORED_UNREADABLE},
  [R.PART_NOT_ENABLED]: {code: "failed-precondition", message: R.PART_NOT_ENABLED, clientReasonCode: R.PART_NOT_ENABLED},
});

const OUTCOME = Object.freeze({
  REFUSED: "REFUSED",
  RECORD: "RECORD", // يُكتب سجلّ الموافقة الآن
  ALREADY_RECORDED: "ALREADY_RECORDED", // موافقة مسجَّلة مقروءة: لا كتابة، والمخزَّن يُردّ
  EXPIRE: "EXPIRE", // scanning وانقضى وقتها: تُكتب «منتهية» ثم يُرفض
});

/**
 * قرار التسجيل من مستند الجلسة ومستند protocolPending (دالّة نقيّة): الوجود، ثم الدور (المنضمّ وحده)، ثم الحالة، ثم الانقضاء، ثم المخزَّن.
 * @param {{data: ?Object, pendingData: ?Object, uid: string, now: Date}} p
 * @return {{outcome: string, refusal?: string, extra?: string, stored?: Object}}
 */
function decideRecordConsent({data, pendingData, uid, now}) {
  if (!data) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_NOT_FOUND};
  const {role, joinedByState} = sessionRoleOf(data, uid);
  if (role !== SESSION_ROLE.JOINER) {
    return {outcome: OUTCOME.REFUSED, refusal: R.NOT_JOINER, extra: role === null ? ` joinedBy=${joinedByState}` : ` role=${role}`};
  }
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return {outcome: OUTCOME.REFUSED, refusal: R.STATUS_UNKNOWN, extra: ` statusState=${state}`};
  if (status !== SESSION_STATUS.SCANNING) return {outcome: OUTCOME.REFUSED, refusal: R.NOT_SCANNING, extra: ` status=${status}`};
  const expiry = sessionExpiryRefusal(data, now);
  if (expiry !== null) {
    if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) return {outcome: OUTCOME.EXPIRE, refusal: R.EXPIRED};
    return {outcome: OUTCOME.REFUSED, refusal: R.EXPIRES_AT_INVALID};
  }
  const stored = readStoredConsent(pendingData);
  if (stored.state === STORED_CONSENT_STATE.UNREADABLE) return {outcome: OUTCOME.REFUSED, refusal: R.STORED_UNREADABLE};
  if (stored.state === STORED_CONSENT_STATE.PRESENT) return {outcome: OUTCOME.ALREADY_RECORDED, stored: stored.record};
  return {outcome: OUTCOME.RECORD};
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * معرّف مستند المالك من مستند الجلسة، أو null إن لم يصلح معرّف مستند (غير نصّ، فارغ، يحمل `/`، `.`/`..`، أو أطول من حدّ Firestore): فلا قراءة، ويُعامَل المالك غائباً (owner=absent) بدل أن يرمي مرجع المستند خطأً داخلياً.
 * @param {?Object} data مستند الجلسة
 * @return {?string}
 */
function ownerDocIdOf(data) {
  const id = data ? data.ownerId : undefined;
  if (typeof id !== "string" || id === "" || id.includes("/") || id === "." || id === ".." || id.length > 1500) return null;
  return id;
}

/**
 * جزء الموافقة للمحلّ (ق40، أقرّه حسن 2026-10-22)، دالّة نقيّة: `protocolParts.consent === true` وحدها تفعّل (الحكم consentPartDecision من consentPartState.js — المصدر الواحد نفسه لحقل consentEnabled في ردّ joinScanSession، ق15).
 * مستند المالك غير الكائن (غائب) حالة صريحة (owner=absent) بالرمز نفسه، لا نجاحاً ولا قيمة افتراضية (القاعدة 22).
 * @param {{ownerData: ?Object}} p
 * @return {{ok: true}|{ok: false, refusal: string, extra: string}}
 */
function decideConsentPart({ownerData}) {
  if (consentPartDecision(ownerData).value) return {ok: true};
  return {ok: false, refusal: R.PART_NOT_ENABLED, extra: `${isObj(ownerData) ? "" : " owner=absent"} part=${PROTOCOL_PART.CONSENT}`};
}

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه consent.test.js).
 * @param {string} reason من RECORD_CONSENT_REFUSAL
 * @param {{sessionId?: ?string, uid?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {sessionId = null, uid = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`recordScanConsent: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[recordScanConsent] refused reason=${reason}` +
      (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن (REFUSAL_RESPONSE)، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

const recordScanConsentHandler = async (request) => {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(R.NOT_AUTHENTICATED);

  const d = request.data || {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (sessionId === "") refuse(R.SESSION_ID_REQUIRED, {uid});
  const input = validateConsentInput(d);
  if (!input.ok) refuse(input.refusal, {sessionId, uid, extra: input.extra});

  // معرّف لا يصلح معرّف مستند (يحمل `/` أو هو `.`/`..` أو أطول من حدّ Firestore) لا جلسة له: يُعامَل جلسةً غير موجودة (الردّ الموحَّد) بدل أن يرمي مرجع المستند خطأً داخلياً. (setSessionPurpose يرثها: قيد معروف لم يُمسّ.)
  if (sessionId.includes("/") || sessionId === "." || sessionId === ".." || sessionId.length > 1500) refuse(R.SESSION_NOT_FOUND, {sessionId, uid, extra: " cause=SESSION_ID_NOT_A_DOCUMENT_ID"});
  const sessionRef = db.collection("scanSessions").doc(sessionId);
  const pendingRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId);
  let decided;
  try {
    // معاملة واحدة: قراءة الجلسة ثم protocolPending (ثم مستند المالك حين يصل القرار إلى «اكتب») ثم الكتابة. تُرجِع قراراً لا ترمي (الرمي داخل المعاملة يُسقطها فلا تُسجَّل «منتهية»).
    decided = await db.runTransaction(async (tx) => {
      const snap = await tx.get(sessionRef);
      const pendingSnap = await tx.get(pendingRef);
      const data = snap.exists ? snap.data() : null;
      const decision = decideRecordConsent({data, pendingData: pendingSnap.exists ? pendingSnap.data() : null, uid, now: new Date()});
      if (decision.outcome === OUTCOME.REFUSED || decision.outcome === OUTCOME.ALREADY_RECORDED) return decision;
      if (decision.outcome === OUTCOME.EXPIRE) {
        tx.update(sessionRef, expiredWriteFields(admin.firestore.FieldValue));
        return {outcome: OUTCOME.REFUSED, refusal: decision.refusal, expiredRecorded: true};
      }
      // (ق40) جزء المحلّ: آخر القرارات، قبل أيّ كتابة (القراءة بعد كتابة ترمي في Firestore). ALREADY_RECORDED وEXPIRE لا يصلان هنا فلا يقرآن مستند المالك.
      const ownerId = ownerDocIdOf(data);
      const ownerRef = ownerId === null ? null : db.collection("users").doc(ownerId);
      const ownerSnap = ownerRef === null ? null : await tx.get(ownerRef);
      const partDecision = decideConsentPart({ownerData: ownerSnap !== null && ownerSnap.exists ? ownerSnap.data() : null});
      if (!partDecision.ok) return {outcome: OUTCOME.REFUSED, refusal: partDecision.refusal, extra: partDecision.extra};
      const record = buildAcceptedRecord({textVersion: input.textVersion, locale: input.locale, acceptedAt: admin.firestore.FieldValue.serverTimestamp()});
      tx.set(pendingRef, {[CONSENT_FIELD]: record}, {merge: true});
      return {...decision, stored: {textVersion: input.textVersion, locale: input.locale}};
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[recordScanConsent] unexpected failure session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} ` +
        `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }
  if (decided.outcome === OUTCOME.REFUSED) {
    refuse(decided.refusal, {sessionId, uid, extra: (decided.extra || "") + (decided.expiredRecorded ? " expiredRecorded=true" : "")});
  }
  const alreadyRecorded = decided.outcome === OUTCOME.ALREADY_RECORDED;
  const differs = alreadyRecorded && (decided.stored.textVersion !== input.textVersion || decided.stored.locale !== input.locale);
  console.log(`[recordScanConsent] recorded session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} textVersion=${decided.stored.textVersion} locale=${decided.stored.locale} alreadyRecorded=${alreadyRecorded}` +
      (differs ? " differs=true" : ""));
  return {sessionId, state: CONSENT_STATE.ACCEPTED, textVersion: decided.stored.textVersion, locale: decided.stored.locale, alreadyRecorded};
};

exports.recordScanConsent = onCall({timeoutSeconds: 30, memory: "256MiB"}, recordScanConsentHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.OUTCOME = OUTCOME;
exports.decideRecordConsent = decideRecordConsent;
exports.decideConsentPart = decideConsentPart;
exports.refuse = refuse;
exports.recordScanConsentHandler = recordScanConsentHandler;
