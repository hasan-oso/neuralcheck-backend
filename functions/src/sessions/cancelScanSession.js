"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {
  SESSION_STATUS, CANCEL_REASON, CANCEL_REASONS_BY_ROLE, CANCEL_REFUSAL: R,
} = require("./sessionNames");
const {
  STATUS_STATE, CLAIM_LIVENESS, CLAIMS_COLLECTION,
  classifyStatus, sessionRoleOf, expiredWriteFields, cancelledWriteFields, claimLiveness, releaseSessionReservations,
} = require("./sessionLifecycle");

// ===================================================
// Cloud Function: cancelScanSession (callable) — إلغاء جلسة فحص أو مغادرتها (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03)
// ===================================================
//
// ما في خطّة PLAN-05 (PLAN-05-EVIDENCE-REPORT.md:529، بنصّه منقولاً من أمر المنسّق): «إلغاء أو مغادرة جلسة (callable جديدة في الخادم + زرّ)»؛
// وPLAN-06 §٨-ج: «رفض الموافقة ⇐ … والجلسة تُلغى بنداء الإلغاء من الدفعة ٩». الزرّ وبقيّة التطبيق في نصف الدفعة الذي يلي هذا.
//
// قرار المستخدم (2026-10-10، بنصّه، منقول من أمر المنسّق):
//   «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى، بلا حذف (القاعدة 42)، ويُعاد الحجز المعلّق مرّة واحدة
//    بالآلية القائمة. واختبار للإلغاء المزدوج، وللإلغاء بعد الاكتمال (يُرفض).»
//
// ─── المدخل ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   data: {sessionId: string, reason: "consent_declined" | "left_by_customer" | "cancelled_by_owner"} — المفردات من sessionNames.js (القاعدة 24).
//   لا قيمة افتراضية للسبب (القاعدة 22): غيابه رفض CANCEL_REASON_REQUIRED. والخادم يعرف الدور (مالك أو منضمّ) فلا يقبل سبباً لا يناسبه:
//   المالك لا يرسل إلا cancelled_by_owner، والمنضمّ لا يرسل إلا consent_declined أو left_by_customer.
//   auth مطلوب: المالك مسجَّل دائماً، والجهاز المنضمّ يسجّل دخولاً مجهولاً قبل أيّ نداء (analyzeDevice.js: «تطبيق العميل يُسجّل دخولاً مجهولاً»).
//
// ─── الصلاحية ─────────────────────────────────────────────────────────────────────────────────────────────────────
//   المالك (ownerId == uid) أو الجهاز المنضمّ (joinedBy == uid). **joinedBy الغائب أو null لا يُطابَق أبداً** (لا «null == null»): جهاز انضمّ بلا هوية
//   (joinScanSession.js يكتب joinedBy=null حين لا auth) لا يُعرَف منضمّاً فلا يُلغي — قيد معروف يوافق فجوة القواعد المسجَّلة (firestore.rules:126-133).
//   غير المالك وغير المنضمّ، والجلسة غير الموجودة: الردّ نفسه (permission-denied، reasonCode=SESSION_NOT_PARTICIPANT) كي لا يُكشف وجود جلسة؛
//   والسجلّ يفرّق بينهما (SESSION_NOT_FOUND / SESSION_NOT_PARTICIPANT مع حالة joinedBy).
//
// ─── الحالات ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   pending، scanning : تُكتب «ملغاة» (status + cancelledAt + cancelReason) في معاملة واحدة مع فحص الحالة — ذرّياً.
//   cancelled         : نداء متكافئ — لا كتابة ثانية، ويُرجَع alreadyCancelled=true. ويُعاد الحجز المعلّق الباقي إن بقي (الإلغاء الأوّل قد يكون سقط بين
//                       الكتابة والإعادة) — releaseScanCredit تعيد مرّة واحدة مهما تكرّر النداء، فالإلغاء الثاني لا يعيد ثانية.
//   completed         : رفض SESSION_COMPLETED (failed-precondition). الفحص اكتمل ولا يُلغى.
//   expired           : رفض SESSION_EXPIRED (failed-precondition) — النصّ والرمز القائمان لانتهاء الجلسة.
//   جارية وانقضى expiresAt (لم تُسجَّل بعد): تُكتب «منتهية» في معاملة المسّ نفسها ثم يُرفض النداء بـSESSION_EXPIRED (قرار المستخدم ٢: بلا منظّف مجدوَل).
//   expiresAt غائب أو تالف: رفض SESSION_EXPIRES_AT_INVALID بلا كتابة (لا يُقرأ الغياب انقضاءً ولا صلاحيةً — القاعدة 22).
//   حالة غائبة أو لا تعرفها الشيفرة: رفض SESSION_STATUS_UNKNOWN بلا كتابة.
//
// ─── تحليل يجري (قرار تصميم، يُبلَّغ في تقرير المهمّة) ─────────────────────────────────────────────────────────────────
//   analyzeDevice تكتب على scanClaims/{scanId} حقل sessionId (هذه الدفعة) وتفحص حالة الجلسة داخل معاملة القفل نفسها. فإن وُجد قفل للجلسة
//   عمره < SCAN_CLAIM_TTL_MS (scanReservation.js، مصدر واحد مع analyzeDevice) فالتحليل يجري: يُرفض الإلغاء SESSION_ANALYSIS_IN_FLIGHT، لأن النداء الحيّ
//   يمتلك الحجز ويُعيده بنفسه إن فشل ويستهلكه إن نجح — فإعادته من هنا تمنح فحصة مجانية إن نجح التحليل بعدها، وكتابة «ملغاة» تحت تحليل
//   يجري تُنتج جلسة ملغاة بتقرير محفوظ. وبعد انقضاء TTL لا نداء حيّ (مهلة الدالّة 300 ث = TTL) فيُعاد الحجز العالق.
//   قفل للجلسة بلا claimedAtMs مقروء: رفض SESSION_CLAIM_AGE_UNKNOWN (عمره مجهول؛ لا يُدَّعى قديماً).
//
// ─── إعادة الحجز المعلّق ──────────────────────────────────────────────────────────────────────────────────────────
//   بعد أن تُكتب «ملغاة» (فلا يبدأ تحليل جديد للجلسة)، لكلّ قفل قديم لها بحجز سليم وبلا reports/{scanId}: releaseScanCredit من scanReservation.js —
//   الدالّة نفسها التي تستدعيها analyzeDevice عند الفشل وسكربت release-stuck-scan-reservations.js اليدوي. الكتابتان (الحالة، ثم الإعادة) معاملتان
//   منفصلتان لأن releaseScanCredit معاملة بذاتها (لا معاملات متداخلة): انقطاع بينهما يترك جلسة ملغاة بحجز ظاهر على قفله، ويُصلحه نداء الإلغاء الثاني.
//   فشل الإعادة لا يُسقط الإلغاء (الحالة كُتبت)؛ يُسجَّل ويبقى الحجز ظاهراً على القفل. **لا حذف أبداً** — لا مستند ولا حقل.
//   الردّ لا يذكر الرصيد (الزبون المنضمّ لا يرى حساب المالك): {sessionId, status, alreadyCancelled}.
//   **قيد معروف:** حجز جلسة تنتهي دون إلغاء لا يُعاد من هنا (الإلغاء يُرفض على المنتهية)، ويبقى لسكربت الحجوزات العالقة اليدوي (10 دقائق، يشغّله المستخدم).
//   و**قيد معروف ثانٍ:** قفل كُتب قبل هذه الدفعة بلا sessionId لا يُربَط بجلسة، فلا يُعاد من هنا.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   سطر واحد بسبب مسمّى لكلّ رفض: `[cancelScanSession] refused reason=<سبب> session=<#> caller=<#>`،
//   وسطر لكلّ إلغاء: `[cancelScanSession] cancelled session=<#> caller=<#> owner=<#> role=… reason=… alreadyCancelled=… released=…`.
//   المعرّفات كلّها عبر hashIdForLog (سياسة السجلّات، الدفعة ١)، ولا sessionId خامّ ولا uid ولا رمز الجلسة.
//
// ─── رسائل الرفض ──────────────────────────────────────────────────────────────────────────────────────────────────
//   نصوص قائمة مُعاد استعمالها حيث للمعنى نصّ قائم: «يجب تسجيل الدخول» (createScanSession.js)، «جلسة الفحص غير صالحة» و«الجلسة منتهية»
//   (sessionTimeout.js وanalyzeDevice وsubmitEvaluation). وما لا نصّ قائم له يحمل رمزه نفسه رسالةً تقنيّةً (SESSION_COMPLETED …) — **لا نصّ عربي جديد
//   يصل مستخدماً** (القرار ٩٠: النصّ المعروض يعتمده المستخدم)؛ والمقترحات بالعربية والتركية في تقرير المهمّة. العميل يميّز بـ`details.reasonCode`.

/**
 * ردّ كل رفض: رمز HttpsError ونصّه، والرمز الذي يصل العميل في details.reasonCode (يُفرَّق في السجلّ وحده بين غياب الجلسة وعدم المشاركة).
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze({
  [R.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: R.NOT_AUTHENTICATED},
  [R.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: R.SESSION_ID_REQUIRED},
  [R.REASON_REQUIRED]: {code: "invalid-argument", message: R.REASON_REQUIRED, clientReasonCode: R.REASON_REQUIRED},
  [R.REASON_INVALID]: {code: "invalid-argument", message: R.REASON_INVALID, clientReasonCode: R.REASON_INVALID},
  [R.SESSION_NOT_FOUND]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.NOT_PARTICIPANT]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.NOT_PARTICIPANT},
  [R.REASON_NOT_ALLOWED_FOR_ROLE]: {code: "invalid-argument", message: R.REASON_NOT_ALLOWED_FOR_ROLE, clientReasonCode: R.REASON_NOT_ALLOWED_FOR_ROLE},
  [R.COMPLETED]: {code: "failed-precondition", message: R.COMPLETED, clientReasonCode: R.COMPLETED},
  [R.EXPIRED]: {code: "failed-precondition", message: "الجلسة منتهية", clientReasonCode: R.EXPIRED},
  [R.EXPIRES_AT_INVALID]: {code: "permission-denied", message: "جلسة الفحص غير صالحة", clientReasonCode: R.EXPIRES_AT_INVALID},
  [R.STATUS_UNKNOWN]: {code: "failed-precondition", message: R.STATUS_UNKNOWN, clientReasonCode: R.STATUS_UNKNOWN},
  [R.ANALYSIS_IN_FLIGHT]: {code: "failed-precondition", message: R.ANALYSIS_IN_FLIGHT, clientReasonCode: R.ANALYSIS_IN_FLIGHT},
  [R.CLAIM_AGE_UNKNOWN]: {code: "failed-precondition", message: R.CLAIM_AGE_UNKNOWN, clientReasonCode: R.CLAIM_AGE_UNKNOWN},
});

const OUTCOME = Object.freeze({
  REFUSED: "REFUSED",
  CANCEL: "CANCEL", // يُكتب «ملغاة» الآن
  ALREADY_CANCELLED: "ALREADY_CANCELLED", // نداء متكافئ
  EXPIRE: "EXPIRE", // جارية وانقضى وقتها: تُكتب «منتهية» ثم يُرفض
});

/**
 * قرار الإلغاء من مستند الجلسة وحده (دالّة نقيّة): الصلاحية، ثم السبب، ثم الحالة، ثم الانقضاء. فحص الأقفال (تحليل يجري) في المعاملة بعد هذا.
 * @param {{data: ?Object, uid: string, reason: string, now: Date}} p
 * @return {{outcome: string, refusal?: string, role?: string, extra?: string}}
 */
function decideCancel({data, uid, reason, now}) {
  if (!data) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_NOT_FOUND};
  const {role, joinedByState} = sessionRoleOf(data, uid);
  if (role === null) return {outcome: OUTCOME.REFUSED, refusal: R.NOT_PARTICIPANT, extra: ` joinedBy=${joinedByState}`};
  if (!CANCEL_REASONS_BY_ROLE[role].includes(reason)) {
    return {outcome: OUTCOME.REFUSED, refusal: R.REASON_NOT_ALLOWED_FOR_ROLE, role, extra: ` role=${role} reason=${reason}`};
  }
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) {
    return {outcome: OUTCOME.REFUSED, refusal: R.STATUS_UNKNOWN, role, extra: ` statusState=${state}`};
  }
  if (status === SESSION_STATUS.COMPLETED) return {outcome: OUTCOME.REFUSED, refusal: R.COMPLETED, role};
  if (status === SESSION_STATUS.EXPIRED) return {outcome: OUTCOME.REFUSED, refusal: R.EXPIRED, role};
  if (status === SESSION_STATUS.CANCELLED) return {outcome: OUTCOME.ALREADY_CANCELLED, role};
  // pending أو scanning: هل انقضى وقتها؟ (الغياب لا يُقرأ صلاحيةً: SESSION_EXPIRES_AT_INVALID بلا كتابة)
  const expiry = sessionExpiryRefusal(data, now);
  if (expiry !== null) {
    if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) return {outcome: OUTCOME.EXPIRE, refusal: R.EXPIRED, role};
    return {outcome: OUTCOME.REFUSED, refusal: R.EXPIRES_AT_INVALID, role};
  }
  return {outcome: OUTCOME.CANCEL, role};
}

/**
 * قرار الأقفال (دالّة نقيّة): هل يمنع قفل للجلسة الإلغاء؟
 * @param {Array<?Object>} claimsData بيانات أقفال scanClaims التي sessionId فيها = الجلسة
 * @param {number} nowMs
 * @return {?string} CANCEL_REFUSAL.ANALYSIS_IN_FLIGHT أو CLAIM_AGE_UNKNOWN، أو null إن لم يمنع شيء. الجاري يسبق مجهول العمر.
 */
function claimsBlockingCancel(claimsData, nowMs) {
  let sawUnknown = false;
  for (const c of claimsData) {
    const liveness = claimLiveness(c, nowMs);
    if (liveness === CLAIM_LIVENESS.IN_FLIGHT) return R.ANALYSIS_IN_FLIGHT;
    if (liveness === CLAIM_LIVENESS.AGE_UNKNOWN) sawUnknown = true;
  }
  return sawUnknown ? R.CLAIM_AGE_UNKNOWN : null;
}

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه cancelScanSessionGuard.test.js).
 * @param {string} reason من CANCEL_REFUSAL
 * @param {{sessionId?: ?string, uid?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {sessionId = null, uid = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`cancelScanSession: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[cancelScanSession] refused reason=${reason}` +
      (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  throw new HttpsError(spec.code, spec.message, {reasonCode: spec.clientReasonCode});
}

const cancelScanSessionHandler = async (request) => {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(R.NOT_AUTHENTICATED);

  const d = request.data || {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (sessionId === "") refuse(R.SESSION_ID_REQUIRED, {uid});
  if (d.reason === undefined || d.reason === null || d.reason === "") refuse(R.REASON_REQUIRED, {sessionId, uid});
  if (typeof d.reason !== "string" || !Object.values(CANCEL_REASON).includes(d.reason)) refuse(R.REASON_INVALID, {sessionId, uid});
  const reason = d.reason;

  const sessionRef = db.collection("scanSessions").doc(sessionId);
  let decided;
  try {
    // معاملة واحدة: قراءة الجلسة، وأقفالها، ثم الكتابة — القراءات كلّها قبل الكتابات. تُرجِع قراراً لا ترمي، كي تُثبَّت كتابة «منتهية» قبل أن يُرفض النداء
    // (الرمي داخل المعاملة يُسقطها — وهذا ما كان يُبطل «expired» في joinScanSession القديمة).
    decided = await db.runTransaction(async (tx) => {
      const now = new Date();
      const snap = await tx.get(sessionRef);
      const data = snap.exists ? snap.data() : null;
      const decision = decideCancel({data, uid, reason, now});
      const ownerId = data ? data.ownerId : null;
      if (decision.outcome === OUTCOME.REFUSED || decision.outcome === OUTCOME.ALREADY_CANCELLED) return {...decision, ownerId};
      if (decision.outcome === OUTCOME.EXPIRE) {
        tx.update(sessionRef, expiredWriteFields(admin.firestore.FieldValue));
        return {...decision, outcome: OUTCOME.REFUSED, expiredRecorded: true, ownerId};
      }
      // OUTCOME.CANCEL — هل يجري تحليل للجلسة؟
      const claimsSnap = await tx.get(db.collection(CLAIMS_COLLECTION).where("sessionId", "==", sessionId));
      const blocking = claimsBlockingCancel(claimsSnap.docs.map((c) => c.data()), now.getTime());
      if (blocking !== null) return {outcome: OUTCOME.REFUSED, refusal: blocking, role: decision.role, ownerId, extra: ` claims=${claimsSnap.size}`};
      tx.update(sessionRef, cancelledWriteFields(admin.firestore.FieldValue, reason));
      return {...decision, ownerId};
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[cancelScanSession] unexpected failure session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} ` +
        `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }

  if (decided.outcome === OUTCOME.REFUSED) {
    refuse(decided.refusal, {sessionId, uid, extra: (decided.extra || "") + (decided.expiredRecorded ? " expiredRecorded=true" : "")});
  }

  // «ملغاة» مكتوبة (الآن، أو من نداء سابق): أعِد الحجز المعلّق. فشلها لا يُسقط الإلغاء.
  let released = {claims: 0, released: 0, noReservation: 0, malformed: 0, hasReport: 0, inFlightSkipped: 0, ageUnknownSkipped: 0, failed: 0};
  let releaseQueryFailed = false;
  try {
    released = await releaseSessionReservations({db, FieldValue: admin.firestore.FieldValue, sessionId, nowMs: Date.now()});
  } catch (e) {
    releaseQueryFailed = true;
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[cancelScanSession] reservation lookup FAILED session=${hashIdForLog(sessionId)} [${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
  }
  const alreadyCancelled = decided.outcome === OUTCOME.ALREADY_CANCELLED;
  console.log(`[cancelScanSession] cancelled session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} owner=${hashIdForLog(decided.ownerId)} ` +
      `role=${decided.role} reason=${reason} alreadyCancelled=${alreadyCancelled} claims=${released.claims} released=${released.released} ` +
      `noReservation=${released.noReservation} hasReport=${released.hasReport} malformed=${released.malformed} ` +
      `inFlightSkipped=${released.inFlightSkipped} ageUnknownSkipped=${released.ageUnknownSkipped} releaseFailed=${released.failed}` +
      (releaseQueryFailed ? " releaseLookupFailed=true" : ""));
  return {sessionId, status: SESSION_STATUS.CANCELLED, alreadyCancelled};
};

exports.cancelScanSession = onCall({timeoutSeconds: 30, memory: "256MiB"}, cancelScanSessionHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.OUTCOME = OUTCOME;
exports.decideCancel = decideCancel;
exports.claimsBlockingCancel = claimsBlockingCancel;
exports.refuse = refuse;
