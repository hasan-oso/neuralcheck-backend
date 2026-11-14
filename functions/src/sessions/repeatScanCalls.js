"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {SESSION_STATUS} = require("./sessionNames");
const {STATUS_STATE, classifyStatus} = require("./sessionLifecycle");
const {SESSION_VALIDITY_MINUTES} = require("./createScanSession");
const {isSafeDocId} = require("../evaluations/technicianFormContract");
const {PROTOCOL_COLLECTION, REPEAT_STATE} = require("../protocol/protocolVocabulary");
const {
  REPEAT_CALL_REFUSAL: R, REPEAT_REFUSAL_RESPONSE, decidePairAccess, decideRepeatStart, buildChildSession, buildChildPending, readStoredStartTemp,
} = require("../protocol/repeatScan");

// ===================================================
// دالّتا التكرار البارد: startRepeatScan وgetRepeatScanOffer (S-P6-07، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٤-ب (:615-657) وdocs/PROTOCOL_CONTRACT.md §٢ A4 (الذي يحمل نصّها المقتبس وكل شكل سلك بنوعه وحضوره وقيمه في إلحاق مؤرَّخ). المنطق القراري كلّه في protocol/repeatScan.js
// (دوالّ نقيّة: القاعدة 41)؛ هذا الملفّ I/O وسجلّ وردّ.
//
// ─── startRepeatScan({sessionId, scanId, startedBeforeCooling?}) — اسم الدالّة من التصميم (P:639، E6 لا يعتمد غيره) ──────────────────────────────────────────────
//   «تنشئ جلسة ابنة بحالة scanning، فلا رمز ولا انضمام ولا تسجيل خروج. التفويض بالزوج (sessionId، scanId): جلسة completed بالفحص نفسه، ومختار للتكرار، ولم يبدأ. لا بـjoinedBy، فقد يكون null لمسار الدخول بلا حساب» (P:639-641)
//   — فالمستدعي أيّ حساب مصادَق (ومنه المجهول) يحمل الزوج؛ **لا يُفحَص أنه المالك ولا المنضمّ** (scanId معرّف يولّده التطبيق سرّاً). **شكل المدخل والردّ لا يحدّده التصميم** (يسمّي الدالّة والزوج): اقترحتُ
//   `startedBeforeCooling` (منطقي اختياري): «وبدء الفنّي قبل التبريد يُقبل بتحذير مرّة، ويُخزَّن startedBeforeCooling: true» (P:648) — حقلٌ يُعلنه العميل (الخادم لا يعرف أنّ المستخدم ضغط «ابدأ رغم ذلك»)؛ غائبه يُخزَّن null لا false
//   (القاعدة 22). والتصنيف بارد/ساخن من الحرارتين وحدهما لا من هذا الحقل. الردّ: {sessionId: <الجلسة الابنة>, parentSessionId, state: "STARTED", expiresInMinutes}.
//   الكتابة (معاملة واحدة: تقرأ الأمّ وسجلّ الفحص قبل أيّ كتابة، فبدءان متزامنان ينجح أحدهما والآخر يُرفض ALREADY_STARTED):
//     ١ `scanSessions/{الابن}` (create): {ownerId, joinedBy (منسوخ من الأمّ: E41), status: "scanning", createdAt, expiresAt = الآن + 60 د (SESSION_VALIDITY_MINUTES: مصدر واحد)، scanId: null, deviceModel: null} **بلا code**.
//     ٢ `protocolPending/{الابن}` (create): {repeatOfSessionId, repeatOfScanId, firstScanStartTemp {state, valueC} (منسوخ من سجلّ الاختيار)، startedBeforeCooling، purposeSource: "repeat_flow"} (E8).
//     ٣ `scanProtocol/{scanId الأمّ}` (update): repeat.state = STARTED، repeat.childSessionId، repeat.startedAt.
//   الرفض بالترتيب: مصادقة ← sessionId ← scanId ← startedBeforeCooling ← الزوج (جلسة غير موجودة أو scanId لا يطابق: ردّ واحد، لا يُكشف وجود جلسة) ← completed ← سجلّ repeat ← الحالة (لم تُختَر / بدأت) ← مالك الأمّ ← منضمّ الأمّ (REPEAT_PARENT_JOINER_UNKNOWN: E41).
//
// ─── getRepeatScanOffer({sessionId, scanId}) — **اسم اقتراحي** (لا اسم لها في التصميم؛ P:629-631: «جهاز الفنّي يعرض بعد اكتمال الفحص الأوّل: «اختير هذا الهاتف لفحص مكرّر بارد» ... والهاتف يستلم حرارة البدء الأولى من الخادم، لا من Room») ──────
//   التفويض بالزوج نفسه. تعيد حالة التكرار وحرارة البدء الأولى (للشريط نحو الهدف بلا أرقام: P:635) ومعرّف الجلسة الابنة. **«PROMPT_DELIVERED (حين يجلبه جهاز الفنّي)» (P:662):** إن كان المستدعي مالك الجلسة (جهاز الفنّي) والحالة SELECTED
//   انتقلت إلى PROMPT_DELIVERED في المعاملة نفسها (وقت التسليم repeat.promptDeliveredAt). **EXPIRED تُحسب عند القراءة** (على نسق انقضاء الأزواج «يُحسب عند القراءة»: P:563): حالة STARTED وجلستها الابنة منتهية (مسجَّلة «منتهية»
//   أو انقضى expiresAt ولم تكتمل) ⟵ تُعاد EXPIRED ولا تُكتب (تثبيتها للحساب اليومي، بعد التسليم: P6-15). غير مكتوبة اليوم (معلّق: مواصفة غائبة — لا نداء مسمّى لها): DECLINED («ليس الآن») وWAITING_COOLING («شاشة انتظار التبريد»).
//
// ─── السجلّ ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   سطر مسمّى لكل رفض `[<fn>] refused reason=<سبب> session=<#> caller=<#>` ولكل نجاح؛ المعرّفات كلّها عبر hashIdForLog، **ولا قيمة حرارة** ولا اسم. الفشل غير المتوقَّع: الصنف والرمز وحدهما (القاعدة 36). لا حذف في أيّ مسار (القاعدة 42).
//   **معلّق: نصّ بانتظار الاعتماد** لكل رفض يراه الفنّي أو الزبون (§٥-أ B9، E41: نصوص الرفض غير مكتوبة): رسالة الرفض رمزه نفسه (أو نصّ قائم: «يجب تسجيل الدخول» · «sessionId مطلوب» · «جلسة الفحص غير صالحة»).

const COLLECTION_SESSIONS = "scanSessions";
const START = "startRepeatScan";
const OFFER = "getRepeatScanOffer";

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه الاختبار).
 * @param {string} fn اسم الدالّة في السطر
 * @param {string} reason من REPEAT_CALL_REFUSAL (له ردّ في REPEAT_REFUSAL_RESPONSE)
 * @param {{sessionId?: ?string, uid?: ?string, extra?: string}} [ctx]
 */
function refuse(fn, reason, {sessionId = null, uid = null, extra = ""} = {}) {
  const spec = REPEAT_REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`repeatScanCalls: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${fn}] refused reason=${reason}` + (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن (REPEAT_REFUSAL_RESPONSE)، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

/**
 * مقدّمة مشتركة: المصادقة ثم الزوج (sessionId، scanId) معرّفَي مستند صالحين.
 * @param {string} fn
 * @param {Object} request
 * @return {{uid: string, sessionId: string, scanId: string, d: Object}}
 */
function readCallerAndPair(fn, request) {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(fn, R.NOT_AUTHENTICATED);
  const d = request.data && typeof request.data === "object" && !Array.isArray(request.data) ? request.data : {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (!isSafeDocId(sessionId)) refuse(fn, R.SESSION_ID_REQUIRED, {uid});
  const scanId = typeof d.scanId === "string" ? d.scanId.trim() : "";
  if (!isSafeDocId(scanId)) refuse(fn, R.SCAN_ID_REQUIRED, {sessionId, uid});
  return {uid, sessionId, scanId, d};
}

/**
 * الفشل غير المتوقَّع (ما ليس رفضاً مسمّى): سطر بالصنف والرمز وحدهما (القاعدة 36)، ثم يُعاد رميه كما هو.
 * @param {string} fn
 * @param {*} e
 * @param {string} sessionId
 * @param {string} uid
 */
function logUnexpected(fn, e, sessionId, uid) {
  const className = (e && e.constructor && e.constructor.name) || typeof e;
  console.error(`[${fn}] unexpected failure session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} ` +
      `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
}

const boolWord = (v) => (v === null ? "ABSENT" : String(v));

// ─── startRepeatScan ─────────────────────────────────────────────────────────────────────────────────────────────

const startRepeatScanHandler = async (request) => {
  const {uid, sessionId, scanId, d} = readCallerAndPair(START, request);
  let startedBeforeCooling = null;
  if (d.startedBeforeCooling !== undefined && d.startedBeforeCooling !== null) {
    if (typeof d.startedBeforeCooling !== "boolean") refuse(START, R.STARTED_BEFORE_COOLING_INVALID, {sessionId, uid});
    startedBeforeCooling = d.startedBeforeCooling;
  }

  const parentRef = db.collection(COLLECTION_SESSIONS).doc(sessionId);
  const protocolRef = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(scanId);
  const childRef = db.collection(COLLECTION_SESSIONS).doc();
  const childPendingRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(childRef.id);

  let decided;
  try {
    // معاملة واحدة: كل القراءات قبل أول كتابة. تُرجِع قراراً لا ترمي.
    decided = await db.runTransaction(async (tx) => {
      const [parentSnap, protocolSnap] = await Promise.all([tx.get(parentRef), tx.get(protocolRef)]);
      const sessionData = parentSnap.exists ? parentSnap.data() : null;
      const access = decidePairAccess({sessionData, scanId, protocolData: protocolSnap.exists ? protocolSnap.data() : null});
      if (!access.ok) return access;
      const start = decideRepeatStart({state: access.state, sessionData});
      if (!start.ok) return start;
      const reference = readStoredStartTemp(access.repeat.firstScanStartTemp);
      const FieldValue = admin.firestore.FieldValue;
      tx.create(childRef, buildChildSession({
        parent: sessionData, createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + SESSION_VALIDITY_MINUTES * 60 * 1000),
      }));
      tx.create(childPendingRef, buildChildPending({parentSessionId: sessionId, parentScanId: scanId, reference, startedBeforeCooling}));
      tx.update(protocolRef, {
        "repeat.state": REPEAT_STATE.STARTED,
        "repeat.childSessionId": childRef.id,
        "repeat.startedAt": FieldValue.serverTimestamp(),
      });
      return {ok: true, referenceState: reference.state};
    });
  } catch (e) {
    logUnexpected(START, e, sessionId, uid);
    throw e;
  }
  if (!decided.ok) refuse(START, decided.refusal, {sessionId, uid, extra: decided.extra || ""});
  console.log(`[${START}] started session=${hashIdForLog(sessionId)} child=${hashIdForLog(childRef.id)} caller=${hashIdForLog(uid)} beforeCooling=${boolWord(startedBeforeCooling)} reference=${decided.referenceState}`);
  return {sessionId: childRef.id, parentSessionId: sessionId, state: REPEAT_STATE.STARTED, expiresInMinutes: SESSION_VALIDITY_MINUTES};
};

// ─── getRepeatScanOffer ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * حالة التكرار كما تُرى الآن: STARTED وجلستها الابنة منتهية ⟵ EXPIRED (محسوبة، لا مكتوبة). **دالّة نقيّة.**
 * @param {{state: string, childData: ?Object, now: Date}} p
 * @return {{state: string, childStatus: ?string}} childStatus حالة الجلسة الابنة المقروءة (null إن لم تُقرأ أو لم تُعرَف)
 */
function viewState({state, childData, now}) {
  if (state !== REPEAT_STATE.STARTED) return {state, childStatus: null};
  const classified = classifyStatus(childData);
  const childStatus = classified.state === STATUS_STATE.KNOWN ? classified.status : null;
  if (childStatus === SESSION_STATUS.EXPIRED) return {state: REPEAT_STATE.EXPIRED, childStatus};
  if (childStatus === SESSION_STATUS.PENDING || childStatus === SESSION_STATUS.SCANNING) {
    const refusal = sessionExpiryRefusal(childData, now);
    if (refusal !== null && refusal.reason === SESSION_EXPIRY_REASON.EXPIRED) return {state: REPEAT_STATE.EXPIRED, childStatus};
  }
  return {state, childStatus};
}

const getRepeatScanOfferHandler = async (request) => {
  const {uid, sessionId, scanId} = readCallerAndPair(OFFER, request);
  const parentRef = db.collection(COLLECTION_SESSIONS).doc(sessionId);
  const protocolRef = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(scanId);
  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const [parentSnap, protocolSnap] = await Promise.all([tx.get(parentRef), tx.get(protocolRef)]);
      const sessionData = parentSnap.exists ? parentSnap.data() : null;
      const access = decidePairAccess({sessionData, scanId, protocolData: protocolSnap.exists ? protocolSnap.data() : null});
      if (!access.ok) return access;
      const repeat = access.repeat;
      const childSessionId = typeof repeat.childSessionId === "string" && repeat.childSessionId !== "" ? repeat.childSessionId : null;
      let childData = null;
      if (access.state === REPEAT_STATE.STARTED && childSessionId !== null && isSafeDocId(childSessionId)) {
        const childSnap = await tx.get(db.collection(COLLECTION_SESSIONS).doc(childSessionId));
        childData = childSnap.exists ? childSnap.data() : null;
      }
      const isOwner = typeof sessionData.ownerId === "string" && sessionData.ownerId !== "" && sessionData.ownerId === uid;
      let state = access.state;
      let delivered = false;
      if (isOwner && state === REPEAT_STATE.SELECTED) {
        tx.update(protocolRef, {"repeat.state": REPEAT_STATE.PROMPT_DELIVERED, "repeat.promptDeliveredAt": admin.firestore.FieldValue.serverTimestamp()});
        state = REPEAT_STATE.PROMPT_DELIVERED;
        delivered = true;
      }
      const view = viewState({state, childData, now: new Date()});
      const applicable = ![REPEAT_STATE.NOT_ELIGIBLE, REPEAT_STATE.NOT_SELECTED].includes(access.state);
      return {
        ok: true, isOwner, delivered,
        offer: {
          sessionId,
          scanId,
          state: view.state,
          reason: typeof repeat.reason === "string" ? repeat.reason : null,
          // «لا ينطبق» لغير المختار (NOT_ELIGIBLE/NOT_SELECTED): null لا قيمة بلا معنى (القاعدة 22).
          firstScanStartTemp: applicable ? readStoredStartTemp(repeat.firstScanStartTemp) : null,
          childSessionId,
          childStatus: view.childStatus,
        },
      };
    });
  } catch (e) {
    logUnexpected(OFFER, e, sessionId, uid);
    throw e;
  }
  if (!decided.ok) refuse(OFFER, decided.refusal, {sessionId, uid, extra: decided.extra || ""});
  const reference = decided.offer.firstScanStartTemp === null ? "NOT_APPLICABLE" : decided.offer.firstScanStartTemp.state;
  console.log(`[${OFFER}] served session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} role=${decided.isOwner ? "owner" : "other"} state=${decided.offer.state} delivered=${decided.delivered} reference=${reference}`);
  return decided.offer;
};

exports.startRepeatScan = onCall({timeoutSeconds: 30, memory: "256MiB"}, startRepeatScanHandler);
exports.getRepeatScanOffer = onCall({timeoutSeconds: 30, memory: "256MiB"}, getRepeatScanOfferHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.refuse = refuse;
exports.viewState = viewState;
exports.startRepeatScanHandler = startRepeatScanHandler;
exports.getRepeatScanOfferHandler = getRepeatScanOfferHandler;
