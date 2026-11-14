"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {SET_PURPOSE_REFUSAL: S, SESSION_STATUS} = require("./sessionNames");
const {STATUS_STATE, classifyStatus, expiredWriteFields} = require("./sessionLifecycle");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {isSafeDocId} = require("../evaluations/technicianFormContract");
const {
  SCAN_PURPOSE, PAIR_STATE, PAIR_CALL_REFUSAL: P, PAIR_LINK_REFUSAL: L, LINK_METHOD, PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH, PROTOCOL_PART,
} = require("../protocol/protocolVocabulary");
const {readProtocolParts} = require("../protocol/scanProtocolDocument");
const {readProtocolSettings, readSettingsDocument} = require("../protocol/protocolSettings");
const {readMarketingNamesDocument} = require("../protocol/marketingNames");
const {SCAN_PROTOCOL_FIELD} = require("../protocol/protocolCorrection");
const MP = require("../protocol/maintenancePair");

// ===================================================
// دالّتا ربط «قبل الصيانة» بـ«بعد الصيانة»: listOpenMaintenanceBefores وconfirmMaintenanceAfterLink (أمر المستخدم 2026-10-22؛ S4 وS5)
// ===================================================
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A3 (أُعيدت كتابته بالأمر نفسه؛ ومصدره الحاكم WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md: منقول، غير متحقَّق من هذا المستودع — القاعدة 29). **اسما الدالّتين اقتراح (ق33)** يحلّان محلّ
// اسمَي E6 المعتمدَين (listOpenBatteryBefores · confirmBatteryAfterLink)؛ وتعمل **خلف جزأَي المحلّ القائمين** purposes وbatteryBeforeAfter (مُطفآن ما لم يُكتبا) — استثناء بأمر المستخدم مكتوب في رأس protocolVocabulary.js.
// المنطق القراري كلّه في protocol/maintenancePair.js (دوالّ نقيّة: القاعدة 41)؛ هذا الملفّ I/O وسجلّ وردّ. **النوى (run…) تأخذ db صريحاً** فتُختبر بقاعدة في الذاكرة (القاعدة 37 تُستوفى بالمحاكي في maintenancePair.e2e.test.js).
//
// ─── listOpenMaintenanceBefores({sessionId}) — المالك وحده، قراءة وحدها (S4) ───────────────────────────────────────────────────────────────
//   الترتيب: مصادقة ← sessionId ← الجلسة (غير موجودة أو غير المالك: **ردّ واحد** SESSION_NOT_PARTICIPANT؛ والسجلّ يفرّق) ← غرض الجلسة = maintenance_after ← جزء المحلّ batteryBeforeAfter === true ←
//   openBeforeValidityHours (بلا قيمة افتراضية) ← نوع «بعد» من protocolPending ← الاستعلام. **لا تفحص حالة الجلسة** (قراءة).
//   الردّ: {validityHours, candidates: [{beforeScanId, deviceName: {state, model, names, reason}, scannedAtMs}]} — الأحدث أوّلاً. المرشَّح: المحلّ نفسه (reports/{id}.userId == uid) والنوع نفسه وpair OPEN وداخل النافذة وبلا ربط حيّ.
//   الاستعلامات (القاعدة 43: **مساواة بلا ترتيب ولا مدى ولا فهرس جديد**): (١) (S8) scanProtocol حيث pair.ownerId == uid **و**pair.state == OPEN: مساواتان على حقلين تُخدَمان بدمج فهرسَي الحقلين المفرَدَين التلقائيين (لا فهرس مركّب)،
//   بسقف OPEN_PAIR_SCAN_CAP **لكل محلّ** (limit(سقف+1): فوقه ⟵ PAIR_SCAN_CAP_EXCEEDED لا اقتطاع صامت)؛ (٢) reports/{id} بمعرّف المستند لكل ناجٍ من الترشيح في الذاكرة (دفاعاً مزدوجاً: userId فيه يجب أن يطابق pair.ownerId،
//   وإلا شذوذ PAIR_OWNER_MISMATCH: يُستبعد ويُعلَن بسبب مسمّى وسطر تحذير لا يُصمَت)؛ (٣) scanProtocol حيث linkedScanId == «قبل» لكل ناجٍ بعد المحلّ. **لا فهرس مركّب أبداً.**
//
// ─── confirmMaintenanceAfterLink({sessionId, beforeScanId}) — المالك وحده (S5) ──────────────────────────────────────────────────────────────
//   الجلسة pending أو scanning وغرضها maintenance_after. الترتيب: مصادقة ← sessionId ← beforeScanId (غائب ⟵ PAIR_BEFORE_SCAN_ID_REQUIRED؛ معرّف غير صالح ⟵ BEFORE_NOT_FOUND بلا قراءة) ← الجلسة (وجود/ملكية، حالة، pending|scanning، انقضاء: «منتهية» تُكتب
//   في المعاملة نفسها ثم SESSION_EXPIRED) ← غرض الجلسة ← الجزء ← المدّة ← نوع «بعد» (كما القائمة: decideListPreconditions) ← «قبل» (decideConfirmBefore: BEFORE_NOT_FOUND · BEFORE_NOT_OWNED · BEFORE_WRONG_PURPOSE · BEFORE_WRONG_DEFECT_TYPE ·
//   PAIR_BEFORE_UNREADABLE · BEFORE_ALREADY_PAIRED · BEFORE_EXPIRED). **معاملة واحدة، القراءات كلّها قبل الكتابة** (الجلسة والمالك والإعداد وpending و«قبل» وتقريرها واستعلام الربط الحيّ).
//   الكتابة: protocolPending/{sessionId} بالدمج: linkedScanId · linkMethod = manual · linkConfirmedAt (وقت الخادم) · linkConfirmedByTechnicianId = null صريحاً (لا هويّة فنّي في الطلب). **إعادة الاختيار تستبدل** ما في pending. **لا مطابقة تلقائية ولا auto_confirmed**،
//   **ولا شيء يُكتب على «قبل»** (الحجز لا يُنشأ: السباق بين جلستين يُحسم عند الاكتمال في analyzeDevice). الردّ: {sessionId, beforeScanId, linkMethod: "manual"}.
//
// ─── السجلّ ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   سطر مسمّى لكل رفض `[<fn>] refused reason=<سبب> session=<#> caller=<#>` ولكل نجاح؛ المعرّفات كلّها عبر hashIdForLog، **ولا اسم جهاز ولا طراز** في أيّ سطر. الفشل غير المتوقَّع: الصنف والرمز وحدهما (القاعدة 36).
//   **معلّق: نصّ بانتظار الاعتماد** لكل رفض يراه الفنّي (§٥-أ B9): رسالة الرفض رمزه التقني، إلا النصوص القائمة («يجب تسجيل الدخول» · «sessionId مطلوب» · «جلسة الفحص غير صالحة» · «الجلسة منتهية»).

const FN_LIST = "listOpenMaintenanceBefores";
const FN_CONFIRM = "confirmMaintenanceAfterLink";
const COLLECTION_SESSIONS = "scanSessions";
const COLLECTION_USERS = "users";
const COLLECTION_REPORTS = "reports";

/**
 * ردّ كل رفض: رمز HttpsError ونصّه، والرمز الذي يصل العميل في details.reasonCode. غير المالك وجلسة غير موجودة: الردّ نفسه (NOT_PARTICIPANT) كي لا يُكشف وجود جلسة؛ السجلّ يفرّق.
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze(Object.fromEntries(Object.entries({
  [P.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: P.NOT_AUTHENTICATED},
  [P.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: P.SESSION_ID_REQUIRED},
  [S.SESSION_NOT_FOUND]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: S.NOT_PARTICIPANT},
  [S.NOT_OWNER]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: S.NOT_PARTICIPANT},
  [P.SESSION_NOT_AFTER]: {code: "failed-precondition", message: P.SESSION_NOT_AFTER, clientReasonCode: P.SESSION_NOT_AFTER},
  [P.PART_NOT_ENABLED]: {code: "failed-precondition", message: P.PART_NOT_ENABLED, clientReasonCode: P.PART_NOT_ENABLED},
  [P.VALIDITY_SETTING_ABSENT]: {code: "failed-precondition", message: P.VALIDITY_SETTING_ABSENT, clientReasonCode: P.VALIDITY_SETTING_ABSENT},
  [P.SESSION_DEFECT_TYPE_ABSENT]: {code: "failed-precondition", message: P.SESSION_DEFECT_TYPE_ABSENT, clientReasonCode: P.SESSION_DEFECT_TYPE_ABSENT},
  [P.SCAN_CAP_EXCEEDED]: {code: "failed-precondition", message: P.SCAN_CAP_EXCEEDED, clientReasonCode: P.SCAN_CAP_EXCEEDED},
  // (S5) التأكيد:
  [P.BEFORE_SCAN_ID_REQUIRED]: {code: "invalid-argument", message: P.BEFORE_SCAN_ID_REQUIRED, clientReasonCode: P.BEFORE_SCAN_ID_REQUIRED},
  [S.EXPIRED]: {code: "failed-precondition", message: "الجلسة منتهية", clientReasonCode: S.EXPIRED},
  [S.EXPIRES_AT_INVALID]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: S.EXPIRES_AT_INVALID},
  [S.STATUS_UNKNOWN]: {code: "failed-precondition", message: S.STATUS_UNKNOWN, clientReasonCode: S.STATUS_UNKNOWN},
  [P.SESSION_NOT_ACTIVE]: {code: "failed-precondition", message: P.SESSION_NOT_ACTIVE, clientReasonCode: P.SESSION_NOT_ACTIVE},
  [L.BEFORE_NOT_FOUND]: {code: "not-found", message: L.BEFORE_NOT_FOUND, clientReasonCode: L.BEFORE_NOT_FOUND},
  [L.BEFORE_NOT_OWNED]: {code: "permission-denied", message: L.BEFORE_NOT_OWNED, clientReasonCode: L.BEFORE_NOT_OWNED},
  [L.BEFORE_WRONG_PURPOSE]: {code: "failed-precondition", message: L.BEFORE_WRONG_PURPOSE, clientReasonCode: L.BEFORE_WRONG_PURPOSE},
  [L.BEFORE_WRONG_DEFECT_TYPE]: {code: "failed-precondition", message: L.BEFORE_WRONG_DEFECT_TYPE, clientReasonCode: L.BEFORE_WRONG_DEFECT_TYPE},
  [P.BEFORE_UNREADABLE]: {code: "failed-precondition", message: P.BEFORE_UNREADABLE, clientReasonCode: P.BEFORE_UNREADABLE},
  [P.OWNER_MISMATCH]: {code: "failed-precondition", message: P.OWNER_MISMATCH, clientReasonCode: P.OWNER_MISMATCH}, // (S8)
  [L.BEFORE_ALREADY_PAIRED]: {code: "failed-precondition", message: L.BEFORE_ALREADY_PAIRED, clientReasonCode: L.BEFORE_ALREADY_PAIRED},
  [L.BEFORE_EXPIRED]: {code: "failed-precondition", message: L.BEFORE_EXPIRED, clientReasonCode: L.BEFORE_EXPIRED},
}).map(([k, v]) => [k, Object.freeze(v)])));

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه الاختبار).
 * @param {string} fn اسم الدالّة في السطر
 * @param {string} reason له ردّ في REFUSAL_RESPONSE
 * @param {{sessionId?: ?string, uid?: ?string, beforeScanId?: ?string, extra?: string}} [ctx]
 */
function refuse(fn, reason, {sessionId = null, uid = null, beforeScanId = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`maintenancePairCalls: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${fn}] refused reason=${reason}` + (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + (beforeScanId ? ` before=${hashIdForLog(beforeScanId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن (REFUSAL_RESPONSE)، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * وصول المالك إلى جلسته: الوجود ثم الملكية (الاثنان ردّ واحد عند العميل). دالّة نقيّة.
 * @param {{data: ?Object, uid: string}} p
 * @return {{ok: true}|{ok: false, refusal: string, extra: string}}
 */
function decideSessionAccess({data, uid}) {
  if (!isObj(data)) return {ok: false, refusal: S.SESSION_NOT_FOUND, extra: ""};
  if (typeof data.ownerId !== "string" || data.ownerId === "" || data.ownerId !== uid) {
    return {ok: false, refusal: S.NOT_OWNER, extra: ` ownerState=${typeof data.ownerId === "string" && data.ownerId !== "" ? "SET" : "ABSENT"}`};
  }
  return {ok: true};
}

/** حالة غرض الجلسة لسطر السجلّ: قيمة معروفة من SCAN_PURPOSE بنصّها، وإلا حالة مسمّاة (لا نصّ خامّ). */
function purposeStateOf(purpose) {
  if (purpose === undefined || purpose === null) return "ABSENT";
  if (typeof purpose !== "string") return "NOT_A_STRING";
  return Object.values(SCAN_PURPOSE).includes(purpose) ? purpose : "UNRECOGNIZED";
}

/**
 * شروط القائمة المسبقة بعد الملكية: غرض «بعد»، ثم جزء المحلّ، ثم المدّة، ثم نوع «بعد». دالّة نقيّة.
 * @param {{sessionData: Object, ownerData: ?Object, settings: {state: string, data: ?Object}, pendingData: ?Object}} p
 * @return {{ok: true, validityHours: number, afterDefectType: string}|{ok: false, refusal: string, extra: string}}
 */
function decideListPreconditions({sessionData, ownerData, settings, pendingData}) {
  if (sessionData.purpose !== SCAN_PURPOSE.MAINTENANCE_AFTER) return {ok: false, refusal: P.SESSION_NOT_AFTER, extra: ` purpose=${purposeStateOf(sessionData.purpose)}`};
  if (readProtocolParts(ownerData)[PROTOCOL_PART.BATTERY_BEFORE_AFTER] !== true) return {ok: false, refusal: P.PART_NOT_ENABLED, extra: ""};
  const validity = MP.readValidityHours(settings);
  if (validity.state !== MP.VALIDITY_STATE.SET) return {ok: false, refusal: P.VALIDITY_SETTING_ABSENT, extra: ` state=${validity.state}`};
  const raw = isObj(pendingData) ? pendingData[MP.PENDING_FIELD.DEFECT_TYPE] : undefined;
  if (!MP.isDefectType(raw)) return {ok: false, refusal: P.SESSION_DEFECT_TYPE_ABSENT, extra: ` state=${raw === undefined || raw === null ? "ABSENT" : "NOT_RECOGNIZED"}`};
  return {ok: true, validityHours: validity.hours, afterDefectType: raw};
}

const CONFIRM_OUTCOME = Object.freeze({REFUSED: "REFUSED", EXPIRE: "EXPIRE", CONTINUE: "CONTINUE"});

/**
 * قرار الجلسة للتأكيد من مستندها وحده (دالّة نقيّة): الوجود والملكية، ثم الحالة المعروفة، ثم pending أو scanning، ثم الانقضاء (EXPIRE: تُكتب «منتهية» ثم يُرفض النداء؛ قرار المستخدم 2026-10-10).
 * @param {{data: ?Object, uid: string, now: Date}} p
 * @return {{outcome: string, refusal?: string, extra?: string}}
 */
function decideConfirmSession({data, uid, now}) {
  const access = decideSessionAccess({data, uid});
  if (!access.ok) return {outcome: CONFIRM_OUTCOME.REFUSED, refusal: access.refusal, extra: access.extra};
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return {outcome: CONFIRM_OUTCOME.REFUSED, refusal: S.STATUS_UNKNOWN, extra: ` statusState=${state}`};
  if (status !== SESSION_STATUS.PENDING && status !== SESSION_STATUS.SCANNING) return {outcome: CONFIRM_OUTCOME.REFUSED, refusal: P.SESSION_NOT_ACTIVE, extra: ` status=${status}`};
  const expiry = sessionExpiryRefusal(data, now);
  if (expiry !== null) {
    if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) return {outcome: CONFIRM_OUTCOME.EXPIRE, refusal: S.EXPIRED};
    return {outcome: CONFIRM_OUTCOME.REFUSED, refusal: S.EXPIRES_AT_INVALID};
  }
  return {outcome: CONFIRM_OUTCOME.CONTINUE};
}

const countsText = (counts) => {
  const parts = Object.entries(counts).filter(([, c]) => c > 0).map(([k, c]) => `${k}:${c}`);
  return parts.length === 0 ? "none" : parts.join(",");
};

/**
 * نواة القائمة (قراءة وحدها). تُعيد {refusal, extra} أو {response, openRead, excluded}.
 * @param {{db: Object, uid: string, sessionId: string, nowMs: number}} p
 * @return {Promise<Object>}
 */
async function runListOpenBefores({db: store, uid, sessionId, nowMs}) {
  const sessionSnap = await store.collection(COLLECTION_SESSIONS).doc(sessionId).get();
  const sessionData = sessionSnap.exists ? sessionSnap.data() : null;
  const access = decideSessionAccess({data: sessionData, uid});
  if (!access.ok) return {refusal: access.refusal, extra: access.extra};

  const [ownerSnap, settings, pendingSnap] = await Promise.all([
    store.collection(COLLECTION_USERS).doc(uid).get(),
    readProtocolSettings({db: store}),
    store.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId).get(),
  ]);
  const pre = decideListPreconditions({
    sessionData, ownerData: ownerSnap.exists ? ownerSnap.data() : null, settings, pendingData: pendingSnap.exists ? pendingSnap.data() : null,
  });
  if (!pre.ok) return {refusal: pre.refusal, extra: pre.extra};

  // (١) (S8) «قبل» المفتوحة لهذا المحلّ وحده: مساواتان على pair.ownerId وpair.state (دمج فهرسَين مفرَدَين تلقائيين؛ لا فهرس مركّب)، بسقف مسمّى لكل محلّ، ثم الترشيح في الذاكرة
  const openSnap = await store.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL)
      .where(`${SCAN_PROTOCOL_FIELD.PAIR}.${MP.PAIR_KEY.OWNER_ID}`, "==", uid)
      .where(`${SCAN_PROTOCOL_FIELD.PAIR}.${MP.PAIR_KEY.STATE}`, "==", PAIR_STATE.OPEN).limit(MP.OPEN_PAIR_SCAN_CAP + 1).get();
  if (openSnap.size > MP.OPEN_PAIR_SCAN_CAP) return {refusal: P.SCAN_CAP_EXCEEDED, extra: ` cap=${MP.OPEN_PAIR_SCAN_CAP}`};
  const E = MP.PAIR_EXCLUDED;
  const excluded = Object.fromEntries(Object.values(E).map((k) => [k, 0]));
  const stage1 = [];
  const anomalies = []; // (S8) «قبل» pair.ownerId فيها = المستدعي لكن userId في تقريرها غيره: شذوذ مسمّى يُعلَن
  for (const doc of openSnap.docs) {
    const c = MP.classifyOpenBefore({data: doc.data(), afterDefectType: pre.afterDefectType, uid, nowMs, validityHours: pre.validityHours});
    if (c.include) stage1.push({beforeScanId: doc.id, openedAtMs: c.openedAtMs});
    else excluded[c.reason]++;
  }

  // (٢) المحلّ والطراز من تقرير «قبل» (مستند بمعرّفه)
  const reports = await Promise.all(stage1.map((c) => store.collection(COLLECTION_REPORTS).doc(c.beforeScanId).get()));
  const stage2 = [];
  stage1.forEach((c, i) => {
    const snap = reports[i];
    if (!snap.exists) { excluded[E.REPORT_ABSENT]++; return; }
    const r = snap.data();
    if (!isObj(r) || typeof r[MP.REPORT_FIELD.USER_ID] !== "string" || r[MP.REPORT_FIELD.USER_ID] === "") { excluded[E.OWNER_UNKNOWN]++; return; }
    if (r[MP.REPORT_FIELD.USER_ID] !== uid) { excluded[E.OWNER_MISMATCH]++; anomalies.push(c.beforeScanId); return; } // (S8) pair.ownerId = uid بحكم الاستعلام والترشيح الأوّل ⟵ اختلاف التقرير شذوذ لا «محلّ آخر»
    stage2.push({...c, deviceModel: r[MP.REPORT_FIELD.DEVICE_MODEL]});
  });

  // (٣) لا ربط حيّ من أيّ «بعد» (مساواة على linkedScanId)
  const links = await Promise.all(stage2.map((c) => store.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).where(SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID, "==", c.beforeScanId).get()));
  const stage3 = [];
  stage2.forEach((c, i) => {
    if (links[i].docs.some((d) => MP.hasLiveLink(d.data()))) excluded[E.LIVE_LINK]++;
    else stage3.push(c);
  });

  // الأسماء التجارية: مستند واحد يُقرأ مرّة، ولا اسم مختلَق
  const namesSnap = await store.collection(PROTOCOL_COLLECTION.MARKETING_NAMES).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC).get();
  const source = readMarketingNamesDocument(namesSnap.exists ? namesSnap.data() : null);
  const candidates = MP.sortNewestFirst(stage3).map((c) => ({beforeScanId: c.beforeScanId, deviceName: MP.deviceNameFor({model: c.deviceModel, source}), scannedAtMs: c.openedAtMs}));
  return {response: {validityHours: pre.validityHours, candidates}, openRead: openSnap.size, excluded, anomalies};
}

/**
 * نواة التأكيد: معاملة واحدة، القراءات كلّها قبل أيّ كتابة، وتُرجِع قراراً لا ترمي (الرمي داخلها يُسقط كتابة «منتهية»).
 * @param {{db: Object, uid: string, sessionId: string, beforeScanId: string, now: Date, FieldValue: Object}} p
 * @return {Promise<{refusal: string, extra: string}|{confirmed: true, replaced: boolean}>}
 */
async function runConfirmAfterLink({db: store, uid, sessionId, beforeScanId, now, FieldValue}) {
  const sessionRef = store.collection(COLLECTION_SESSIONS).doc(sessionId);
  const pendingRef = store.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId);
  const userRef = store.collection(COLLECTION_USERS).doc(uid);
  const settingsRef = store.collection(PROTOCOL_COLLECTION.PROTOCOL_SETTINGS).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC);
  const beforeRef = store.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(beforeScanId);
  const reportRef = store.collection(COLLECTION_REPORTS).doc(beforeScanId);
  const linksQuery = store.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).where(SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID, "==", beforeScanId);
  return store.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef);
    const sessionData = sessionSnap.exists ? sessionSnap.data() : null;
    const sdec = decideConfirmSession({data: sessionData, uid, now});
    if (sdec.outcome === CONFIRM_OUTCOME.REFUSED) return {refusal: sdec.refusal, extra: sdec.extra};
    if (sdec.outcome === CONFIRM_OUTCOME.EXPIRE) {
      tx.update(sessionRef, expiredWriteFields(FieldValue));
      return {refusal: sdec.refusal, extra: " expiredRecorded=true"};
    }
    const [ownerSnap, settingsSnap, pendingSnap, beforeSnap, reportSnap, linksSnap] = await Promise.all([
      tx.get(userRef), tx.get(settingsRef), tx.get(pendingRef), tx.get(beforeRef), tx.get(reportRef), tx.get(linksQuery),
    ]);
    const pendingData = pendingSnap.exists ? pendingSnap.data() : null;
    const pre = decideListPreconditions({
      sessionData, ownerData: ownerSnap.exists ? ownerSnap.data() : null, settings: readSettingsDocument(settingsSnap.exists ? settingsSnap.data() : null), pendingData,
    });
    if (!pre.ok) return {refusal: pre.refusal, extra: pre.extra};
    const dec = MP.decideConfirmBefore({
      uid, beforeData: beforeSnap.exists ? beforeSnap.data() : null, reportData: reportSnap.exists ? reportSnap.data() : null,
      afterDefectType: pre.afterDefectType, validityHours: pre.validityHours, nowMs: now.getTime(), linkedDocs: linksSnap.docs.map((d) => d.data()),
    });
    if (!dec.ok) return {refusal: dec.refusal, extra: dec.extra};
    const previous = isObj(pendingData) ? pendingData[MP.PENDING_FIELD.LINKED_SCAN_ID] : undefined;
    tx.set(pendingRef, {
      [MP.PENDING_FIELD.LINKED_SCAN_ID]: beforeScanId,
      [MP.PENDING_FIELD.LINK_METHOD]: LINK_METHOD.MANUAL,
      [MP.PENDING_FIELD.LINK_CONFIRMED_AT]: FieldValue.serverTimestamp(),
      [MP.PENDING_FIELD.LINK_CONFIRMED_BY_TECHNICIAN_ID]: null, // لا هويّة فنّي في الطلب: null صريح لا غياب (E7)
    }, {merge: true});
    return {confirmed: true, replaced: typeof previous === "string" && previous !== "" && previous !== beforeScanId};
  });
}

const logUnexpected = (fn, e, sessionId, uid) => {
  const className = (e && e.constructor && e.constructor.name) || typeof e;
  console.error(`[${fn}] unexpected failure session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} ` +
      `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
};

const listOpenMaintenanceBeforesHandler = async (request) => {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(FN_LIST, P.NOT_AUTHENTICATED);
  const d = isObj(request.data) ? request.data : {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (!isSafeDocId(sessionId)) refuse(FN_LIST, P.SESSION_ID_REQUIRED, {uid});

  let result;
  try {
    result = await runListOpenBefores({db, uid, sessionId, nowMs: Date.now()});
  } catch (e) {
    logUnexpected(FN_LIST, e, sessionId, uid);
    throw e;
  }
  if (result.refusal) refuse(FN_LIST, result.refusal, {sessionId, uid, extra: result.extra || ""});
  console.log(`[${FN_LIST}] served session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} validityHours=${result.response.validityHours} ` +
      `openRead=${result.openRead} candidates=${result.response.candidates.length} excluded=${countsText(result.excluded)}`);
  if (result.anomalies.length > 0) {
    console.warn(`[${FN_LIST}] anomaly reason=${P.OWNER_MISMATCH} count=${result.anomalies.length} sample=${result.anomalies.slice(0, 3).map((id) => hashIdForLog(id)).join(",")} ` +
        `session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)}`);
  }
  return result.response;
};

const confirmMaintenanceAfterLinkHandler = async (request) => {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(FN_CONFIRM, P.NOT_AUTHENTICATED);
  const d = isObj(request.data) ? request.data : {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (!isSafeDocId(sessionId)) refuse(FN_CONFIRM, P.SESSION_ID_REQUIRED, {uid});
  if (typeof d.beforeScanId !== "string" || d.beforeScanId.trim() === "") refuse(FN_CONFIRM, P.BEFORE_SCAN_ID_REQUIRED, {sessionId, uid});
  const beforeScanId = d.beforeScanId.trim();
  if (!isSafeDocId(beforeScanId)) refuse(FN_CONFIRM, L.BEFORE_NOT_FOUND, {sessionId, uid, extra: " cause=ID_INVALID"});

  let result;
  try {
    result = await runConfirmAfterLink({db, uid, sessionId, beforeScanId, now: new Date(), FieldValue: admin.firestore.FieldValue});
  } catch (e) {
    logUnexpected(FN_CONFIRM, e, sessionId, uid);
    throw e;
  }
  if (result.refusal) refuse(FN_CONFIRM, result.refusal, {sessionId, uid, beforeScanId, extra: result.extra || ""});
  console.log(`[${FN_CONFIRM}] confirmed session=${hashIdForLog(sessionId)} before=${hashIdForLog(beforeScanId)} caller=${hashIdForLog(uid)} replaced=${result.replaced}`);
  return {sessionId, beforeScanId, linkMethod: LINK_METHOD.MANUAL};
};

exports.listOpenMaintenanceBefores = onCall({timeoutSeconds: 30, memory: "256MiB"}, listOpenMaintenanceBeforesHandler);
exports.confirmMaintenanceAfterLink = onCall({timeoutSeconds: 30, memory: "256MiB"}, confirmMaintenanceAfterLinkHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore الحقيقي/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.refuse = refuse;
exports.decideSessionAccess = decideSessionAccess;
exports.decideListPreconditions = decideListPreconditions;
exports.runListOpenBefores = runListOpenBefores;
exports.listOpenMaintenanceBeforesHandler = listOpenMaintenanceBeforesHandler;
exports.CONFIRM_OUTCOME = CONFIRM_OUTCOME;
exports.decideConfirmSession = decideConfirmSession;
exports.runConfirmAfterLink = runConfirmAfterLink;
exports.confirmMaintenanceAfterLinkHandler = confirmMaintenanceAfterLinkHandler;
