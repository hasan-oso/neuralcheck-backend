"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("../sessions/sessionTimeout");
const {SESSION_STATUS, SESSION_ROLE} = require("../sessions/sessionNames");
const {STATUS_STATE, classifyStatus, sessionRoleOf, expiredWriteFields} = require("../sessions/sessionLifecycle");
const {evaluationEnabledDecision} = require("../sessions/evaluationEnabledState");
const {PROTOCOL_COLLECTION, FORM_CONTRACT_VERSION, FORM_STATE} = require("../protocol/protocolVocabulary");
const {readProtocolSettings, settingsVersionOf} = require("../protocol/protocolSettings");
const {DOUBLE_EVAL_DRAW_FIELD} = require("../protocol/doubleEval");
const {TECHNICIAN_FORM_REFUSAL: R, REFUSAL_RESPONSE} = require("./technicianFormRefusal");
const {
  FORM_SLOT, SYMPTOM_CHIPS, normalizeTechnicianForm, deriveFormFlags, computeBlindness, isSafeDocId,
} = require("./technicianFormContract");

// ===================================================
// استمارة الفنّي — الدوالّ الثلاث (S-P6-08، 2026-10-18 +03): submitTechnicianForm · getTechnicianFormConfig · recordReportFirstOpened
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠ (:1179-1376) وdocs/PROTOCOL_CONTRACT.md §٢ A5 وA7؛ أسماء الدوالّ الثلاث معتمدة (E6، 2026-10-15). التحقّق والاشتقاق والعمى في technicianFormContract.js (دوالّ نقيّة)،
// وأسباب الرفض وردودها في technicianFormRefusal.js. **أسماء حقول المدخل والردّ والمستند اقتراحي حيث لم يسمّها التصميم** (A5 «ما بُني وما عُلِّق»).
//
// ─── من يستدعي ────────────────────────────────────────────────────────────────────────────────────────────────────
// «استمارة الفنّي: على جهاز الفنّي لا هاتف الزبون» (PLAN-06:1181) و«الهاتف الذي أنشأ الجلسة بحساب المحلّ» (✓ قرار المستخدم ٨، :1219): **المستدعي مالك الجلسة** (request.auth.uid == ownerId)، لا الجهاز المنضمّ.
// غير المالك — منضمّاً أو غريباً — وجلسة غير موجودة: ردّ العميل واحد (SESSION_NOT_PARTICIPANT)؛ والسجلّ يفرّق. recordReportFirstOpened وحدها تقبل المالك والمنضمّ («على أيّ من الجهازين»: :1321).
//
// ─── submitTechnicianForm ─────────────────────────────────────────────────────────────────────────────────────────
//   المدخل: {sessionId, formContractVersion: 2, slot: 1|2, technicianId, grades, functional, defects, symptoms, symptomOrderShown, known_fault_before_scan, batteryHealth, gameTried, observedNote,
//            openedAt, firstTapAt, perAnswerAt[], submittedAt, [answersBeforePrompt, answersAfterPrompt, promptAction], [sentOffline]} (technicianFormContract.js).
//   الكتابة: `technicianForms/{sessionId}_{slot}` بـ**tx.create** (لا set: «الإرسال نهائي: الخادم يرفض إرسالاً ثانياً للفتحة نفسها، ولا `tx.set` فوقه»: :1312) في معاملة واحدة تقرأ كل ما تحتاجه قبل أول كتابة.
//   الشروط بالترتيب: الجلسة (مالك، حالة: scanning أو completed؛ pending ⟵ SESSION_NOT_STARTED؛ scanning منقضية ⟵ تُكتب «منتهية» ثم SESSION_EXPIRED) ← evaluationEnabled (وإلّا FORM_NOT_ENABLED: «ولا استمارة»: :1359) ←
//   الفتحة مُرسَلة (FORM_ALREADY_SUBMITTED) ← الفنّي (technicians/{id}: موجود وفعّال وملكه: وإلّا FORM_TECHNICIAN_UNKNOWN بسبب مسمّى في السجلّ) ← الفتحة ٢ لا تُقبل إلا لجلسة سُحبت للتقييم المزدوج
//   (protocolPending/{sessionId}.doubleEvalDraw.selected === true، E9؛ غياب السحب ⟵ FORM_SLOT_INVALID بسبب مسمّى — «لا يُفترض 10%»: P:893) ← الفنّي نفسه في الفتحتين ⟵ FORM_SLOT_SAME_TECHNICIAN (متناظر: من أيّ فتحة بدأ).
//   المشتقّات خادمية: allFourGradesEqual · fast · contradictionRules · blindness (+ basis وclock) · receivedAt. **ولا يُعيد الخادم استمارةً لأيّ عميل** (:1304): الردّ {sessionId, slot, formState} وحدها.
//
// ─── getTechnicianFormConfig ──────────────────────────────────────────────────────────────────────────────────────
//   المدخل {sessionId}؛ المالك وحده. المحلّ غير المفعَّل ⟵ {formState: not_enabled} بلا إعداد («ولا استمارة»). المفعَّل ⟵ حالة كل فتحة (submitted | not_submitted)، وهل سُحبت الفتحة ٢، وقائمة فنّيي المالك الفعّالين
//   (technicians: ownerId == uid و active == true: **مساواة بلا ترتيب ولا مدى**، A0 البند ٩)، وترتيب الأعراض، وsettingsVersion.
//   **ترتيب الأعراض: الجدول (الافتراضي) دائماً اليوم** — «والترتيب بعدد الاختيار في آخر 28 يوماً (...) يحسبه الخادم ويرسله مع إعداد الاستمارة» (:1281-1282) يحتاج مدى زمنياً على technicianForms (فهرس مركّب
//   ownerId + receivedAt) أو عدّاداً؛ وA0 البند ٩: «كل استعلام جديد في هذا العقد مساواة بلا ترتيب ولا مدى حتى يقرّر المستخدم غير ذلك» — **معلّق: قرار المستخدم**. settingsVersion من protocolSettings/current (S-P6-14: رقم النسخة أو SETTINGS_ABSENT).
//
// ─── recordReportFirstOpened ──────────────────────────────────────────────────────────────────────────────────────
//   المدخل {sessionId}؛ المالك أو المنضمّ. الجلسة completed بتقرير موجود (وإلّا SESSION_REPORT_NOT_AVAILABLE). يكتب `protocolPending/{sessionId}.reportFirstOpenedAt` (وقت الخادم) **أوّل مرّة فقط**: أوّل فتح يربح
//   («أوّل مرّة يُعرض فيها التقرير على أيّ من الجهازين»: :1321)، والنداء اللاحق لا يكتب ويردّ {recorded: false}. الموضع protocolPending لأنه «يكتبه دالّتا الجهاز والفنّي» (A0)، ولا يُنشأ مستند scanProtocol ناقص.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   سطر مسمّى لكل رفض `[<fn>] refused reason=<سبب> session=<#> caller=<#>` ولكل نجاح؛ المعرّفات كلّها عبر hashIdForLog؛ **لا نصّ ملاحظة ولا اسم فنّي ولا قيمة خام**. الفشل غير المتوقَّع: الصنف والرمز وحدهما.
//   لا حذف في أيّ مسار (القاعدة 42).

const OUTCOME = Object.freeze({
  REFUSED: "REFUSED",
  OK: "OK",
  EXPIRE: "EXPIRE", // scanning منقضية: تُكتب «منتهية» ثم يُرفض
});

/** ما تقبله الدالّة من حالات الجلسة: الإرسال scanning وcompleted؛ والإعداد pending وscanning وcompleted. */
const GATE_MODE = Object.freeze({SUBMIT: "SUBMIT", CONFIG: "CONFIG"});

/**
 * حكم الجلسة للمالك (دالّة نقيّة): الوجود ← الملكية ← الحالة ← الانقضاء (الإرسال وحده، وscanning وحدها).
 * @param {{data: ?Object, uid: string, now: Date, mode: string}} p
 * @return {{outcome: string, refusal?: string, extra?: string}}
 */
function decideSessionGate({data, uid, now, mode}) {
  if (!data) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_NOT_FOUND};
  const {role, joinedByState} = sessionRoleOf(data, uid);
  if (role !== SESSION_ROLE.OWNER) {
    return {outcome: OUTCOME.REFUSED, refusal: R.NOT_OWNER, extra: role === SESSION_ROLE.JOINER ? " role=joiner" : ` role=none joinedByState=${joinedByState}`};
  }
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_STATUS_UNKNOWN, extra: ` statusState=${state}`};
  if (status === SESSION_STATUS.CANCELLED) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_CANCELLED};
  if (status === SESSION_STATUS.EXPIRED) return {outcome: OUTCOME.REFUSED, refusal: R.SESSION_EXPIRED};
  if (status === SESSION_STATUS.PENDING) {
    return mode === GATE_MODE.CONFIG ? {outcome: OUTCOME.OK} : {outcome: OUTCOME.REFUSED, refusal: R.SESSION_NOT_STARTED};
  }
  if (status === SESSION_STATUS.SCANNING && mode === GATE_MODE.SUBMIT) {
    const expiry = sessionExpiryRefusal(data, now);
    if (expiry !== null) {
      return expiry.reason === SESSION_EXPIRY_REASON.EXPIRED ? {outcome: OUTCOME.EXPIRE, refusal: R.SESSION_EXPIRED} : {outcome: OUTCOME.REFUSED, refusal: R.SESSION_EXPIRES_AT_INVALID};
    }
  }
  return {outcome: OUTCOME.OK};
}

/** حالة الفنّي في مستند technicians/{id} لمالك الجلسة (للسجلّ والحكم): غير الفعّال وغير المملوك وغير الموجود وغائب `active` كلٌّ بحالة مسمّاة. */
const TECHNICIAN_STATE = Object.freeze({
  ACTIVE: "ACTIVE",
  NOT_FOUND: "NOT_FOUND",
  OWNER_MISMATCH: "OWNER_MISMATCH",
  INACTIVE: "INACTIVE",
  ACTIVE_FLAG_UNREADABLE: "ACTIVE_FLAG_UNREADABLE",
});
/**
 * @param {?Object} data technicians/{id}.data() أو null
 * @param {string} ownerUid
 * @return {string}
 */
function technicianState(data, ownerUid) {
  if (!data) return TECHNICIAN_STATE.NOT_FOUND;
  if (typeof data.ownerId !== "string" || data.ownerId === "" || data.ownerId !== ownerUid) return TECHNICIAN_STATE.OWNER_MISMATCH;
  if (data.active === true) return TECHNICIAN_STATE.ACTIVE;
  if (data.active === false) return TECHNICIAN_STATE.INACTIVE;
  return TECHNICIAN_STATE.ACTIVE_FLAG_UNREADABLE;
}

/** حالة سحب التقييم المزدوج في protocolPending (E9): الفتحة ٢ لا تُقبل إلا SELECTED. */
const DOUBLE_EVAL_STATE = Object.freeze({SELECTED: "SELECTED", NOT_SELECTED: "NOT_SELECTED", DRAW_ABSENT: "DRAW_ABSENT", DRAW_MALFORMED: "DRAW_MALFORMED"});
/**
 * @param {?Object} pendingData protocolPending/{sessionId}.data() أو null
 * @return {string}
 */
function doubleEvalState(pendingData) {
  const draw = pendingData ? pendingData[DOUBLE_EVAL_DRAW_FIELD] : undefined;
  if (draw === undefined || draw === null) return DOUBLE_EVAL_STATE.DRAW_ABSENT;
  if (typeof draw !== "object" || Array.isArray(draw) || typeof draw.selected !== "boolean") return DOUBLE_EVAL_STATE.DRAW_MALFORMED;
  return draw.selected ? DOUBLE_EVAL_STATE.SELECTED : DOUBLE_EVAL_STATE.NOT_SELECTED;
}

const toMillisOrNull = (v) => {
  if (v && typeof v.toMillis === "function") {
    const ms = v.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return v instanceof Date && Number.isFinite(v.getTime()) ? v.getTime() : null;
};
const otherSlot = (slot) => (slot === FORM_SLOT.FIRST ? FORM_SLOT.SECOND : FORM_SLOT.FIRST);

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` في هذا الملفّ** (يحرسه technicianFormGuard.test.js).
 * @param {string} fn اسم الدالّة في السطر
 * @param {string} reason من TECHNICIAN_FORM_REFUSAL (له ردّ في REFUSAL_RESPONSE)
 * @param {{sessionId?: ?string, uid?: ?string, extra?: string}} [ctx]
 */
function refuse(fn, reason, {sessionId = null, uid = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`technicianForm: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${fn}] refused reason=${reason}` + (sessionId ? ` session=${hashIdForLog(sessionId)}` : "") + ` caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن (REFUSAL_RESPONSE)، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

/**
 * مقدّمة مشتركة: المصادقة ثم معرّف الجلسة.
 * @param {string} fn
 * @param {Object} request
 * @return {{uid: string, sessionId: string, d: Object}}
 */
function readCallerAndSession(fn, request) {
  const uid = request.auth && typeof request.auth.uid === "string" && request.auth.uid !== "" ? request.auth.uid : null;
  if (uid === null) refuse(fn, R.NOT_AUTHENTICATED);
  const d = request.data && typeof request.data === "object" && !Array.isArray(request.data) ? request.data : {};
  const sessionId = typeof d.sessionId === "string" ? d.sessionId.trim() : "";
  if (!isSafeDocId(sessionId)) refuse(fn, R.SESSION_ID_REQUIRED, {uid});
  return {uid, sessionId, d};
}

/**
 * الفشل غير المتوقَّع (ما ليس رفضاً مسمّى): سطر بالصنف والرمز وحدهما (بلا نصّ الخطأ ولا معرّف خامّ: القاعدة 36)، ثم يُعاد رميه كما هو.
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

// ─── submitTechnicianForm ─────────────────────────────────────────────────────────────────────────────────────────

const SUBMIT = "submitTechnicianForm";

const submitTechnicianFormHandler = async (request) => {
  const {uid, sessionId, d} = readCallerAndSession(SUBMIT, request);
  const normalized = normalizeTechnicianForm(d);
  if (!normalized.ok) refuse(SUBMIT, normalized.refusal, {sessionId, uid, extra: normalized.extra});
  const form = normalized.form;

  const sessionRef = db.collection("scanSessions").doc(sessionId);
  const formRef = db.collection(PROTOCOL_COLLECTION.TECHNICIAN_FORMS).doc(`${sessionId}_${form.slot}`);
  const otherRef = db.collection(PROTOCOL_COLLECTION.TECHNICIAN_FORMS).doc(`${sessionId}_${otherSlot(form.slot)}`);
  const pendingRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId);
  const technicianRef = db.collection(PROTOCOL_COLLECTION.TECHNICIANS).doc(form.technicianId);
  const ownerRef = db.collection("users").doc(uid);

  let decided;
  try {
    // معاملة واحدة: كل القراءات قبل أول كتابة. تُرجِع قراراً لا ترمي (الرمي داخلها يُسقط كتابة «منتهية»).
    decided = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const data = sessionSnap.exists ? sessionSnap.data() : null;
      const gate = decideSessionGate({data, uid, now: new Date(), mode: GATE_MODE.SUBMIT});
      if (gate.outcome === OUTCOME.REFUSED) return gate;
      if (gate.outcome === OUTCOME.EXPIRE) {
        tx.update(sessionRef, expiredWriteFields(admin.firestore.FieldValue));
        return {outcome: OUTCOME.REFUSED, refusal: gate.refusal, expiredRecorded: true};
      }
      const refusedWith = (refusal, extra = "") => ({outcome: OUTCOME.REFUSED, refusal, extra});

      const ownerSnap = await tx.get(ownerRef);
      const enabled = evaluationEnabledDecision(ownerSnap.exists ? ownerSnap.data() : null);
      if (!enabled.value) return refusedWith(R.NOT_ENABLED, ` reason=${enabled.reason}`);

      const formSnap = await tx.get(formRef);
      if (formSnap.exists) return refusedWith(R.ALREADY_SUBMITTED);

      const technicianSnap = await tx.get(technicianRef);
      const techState = technicianState(technicianSnap.exists ? technicianSnap.data() : null, uid);
      if (techState !== TECHNICIAN_STATE.ACTIVE) return refusedWith(R.TECHNICIAN_UNKNOWN, ` technicianState=${techState}`);

      const pendingSnap = await tx.get(pendingRef);
      const pendingData = pendingSnap.exists ? pendingSnap.data() : null;
      if (form.slot === FORM_SLOT.SECOND) {
        const drawn = doubleEvalState(pendingData);
        if (drawn !== DOUBLE_EVAL_STATE.SELECTED) return refusedWith(R.SLOT_INVALID, ` cause=DOUBLE_EVAL_${drawn}`);
      }
      const otherSnap = await tx.get(otherRef);
      const other = otherSnap.exists ? otherSnap.data() : null;
      if (other && other.technicianId === form.technicianId) return refusedWith(R.SLOT_SAME_TECHNICIAN);

      // العمى: التقرير موجود إن كانت الجلسة بـscanId وللتقرير مستند.
      const scanId = typeof data.scanId === "string" && data.scanId !== "" && isSafeDocId(data.scanId) ? data.scanId : null;
      const reportSnap = scanId ? await tx.get(db.collection("reports").doc(scanId)) : null;
      const reportExists = Boolean(reportSnap && reportSnap.exists);
      const reportFirstOpenedAt = pendingData ? pendingData.reportFirstOpenedAt : undefined;
      const receivedMs = Date.now();
      const blind = computeBlindness({
        reportExists,
        reportFirstOpenedMs: toMillisOrNull(reportFirstOpenedAt),
        reportCreatedMs: reportExists ? toMillisOrNull(reportSnap.data().createdAt) : null,
        submittedMs: form.submittedAt,
        receivedMs,
        sentOffline: form.sentOffline,
      });
      const flags = deriveFormFlags(form);

      tx.create(formRef, {
        formContractVersion: FORM_CONTRACT_VERSION,
        formState: FORM_STATE.SUBMITTED,
        sessionId,
        slot: form.slot,
        ownerId: uid,
        technicianId: form.technicianId,
        grades: form.grades,
        functional: form.functional,
        defects: form.defects,
        symptoms: form.symptoms,
        symptomOrderShown: form.symptomOrderShown,
        known_fault_before_scan: form.knownFaultBeforeScan,
        batteryHealth: form.batteryHealth,
        batteryHealthState: form.batteryHealthState,
        gameTried: form.gameTried,
        observedNote: form.observedNote,
        openedAt: form.openedAt,
        firstTapAt: form.firstTapAt,
        perAnswerAt: form.perAnswerAt,
        submittedAt: form.submittedAt,
        receivedAt: admin.firestore.FieldValue.serverTimestamp(),
        sentOffline: form.sentOffline,
        answersBeforePrompt: form.answersBeforePrompt,
        answersAfterPrompt: form.answersAfterPrompt,
        promptAction: form.promptAction,
        allFourGradesEqual: flags.allFourGradesEqual,
        fast: flags.fast,
        contradictionRules: flags.contradictionRules,
        blindness: blind.blindness,
        blindnessBasis: blind.blindnessBasis,
        clock: blind.clock,
        reportFirstOpenedAt: reportFirstOpenedAt === undefined ? null : reportFirstOpenedAt,
      });
      return {outcome: OUTCOME.OK, blind, flags};
    });
  } catch (e) {
    logUnexpected(SUBMIT, e, sessionId, uid);
    throw e;
  }
  if (decided.outcome === OUTCOME.REFUSED) {
    refuse(SUBMIT, decided.refusal, {sessionId, uid, extra: (decided.extra || "") + (decided.expiredRecorded ? " expiredRecorded=true" : "")});
  }
  console.log(`[${SUBMIT}] submitted session=${hashIdForLog(sessionId)} slot=${form.slot} technician=${hashIdForLog(form.technicianId)} caller=${hashIdForLog(uid)} ` +
      `blindness=${decided.blind.blindness} basis=${decided.blind.blindnessBasis} clock=${decided.blind.clock} fast=${decided.flags.fast} ` +
      `equal=${decided.flags.allFourGradesEqual} contradictions=${decided.flags.contradictionRules.length} offline=${form.sentOffline}`);
  return {sessionId, slot: form.slot, formState: FORM_STATE.SUBMITTED};
};

// ─── getTechnicianFormConfig ──────────────────────────────────────────────────────────────────────────────────────

const CONFIG = "getTechnicianFormConfig";

const getTechnicianFormConfigHandler = async (request) => {
  const {uid, sessionId} = readCallerAndSession(CONFIG, request);
  let sessionData;
  let ownerData;
  let forms;
  let pendingData;
  try {
    const sessionSnap = await db.collection("scanSessions").doc(sessionId).get();
    sessionData = sessionSnap.exists ? sessionSnap.data() : null;
    const gate = decideSessionGate({data: sessionData, uid, now: new Date(), mode: GATE_MODE.CONFIG});
    if (gate.outcome !== OUTCOME.OK) {
      // قراءة وحدها: لا كتابة «منتهية» هنا (EXPIRE لا يصدر في هذا الوضع)
      refuse(CONFIG, gate.refusal, {sessionId, uid, extra: gate.extra || ""});
    }
    const ownerSnap = await db.collection("users").doc(uid).get();
    ownerData = ownerSnap.exists ? ownerSnap.data() : null;
    const enabled = evaluationEnabledDecision(ownerData);
    if (!enabled.value) {
      console.log(`[${CONFIG}] not_enabled session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} reason=${enabled.reason}`);
      return {sessionId, formContractVersion: FORM_CONTRACT_VERSION, enabled: false, formState: FORM_STATE.NOT_ENABLED};
    }
    const formSnaps = await Promise.all([FORM_SLOT.FIRST, FORM_SLOT.SECOND].map((s) => db.collection(PROTOCOL_COLLECTION.TECHNICIAN_FORMS).doc(`${sessionId}_${s}`).get()));
    forms = formSnaps.map((s) => s.exists);
    const pendingSnap = await db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId).get();
    pendingData = pendingSnap.exists ? pendingSnap.data() : null;
    // فنّيو المالك الفعّالون: مساواة على ownerId وactive بلا ترتيب ولا مدى (A0 البند ٩: لا فهرس جديد).
    const techSnaps = await db.collection(PROTOCOL_COLLECTION.TECHNICIANS).where("ownerId", "==", uid).where("active", "==", true).get();
    // S-P6-14 (2026-10-21): settingsVersion من protocolSettings/current (كان الثابت SETTINGS_ABSENT «حتى P6-14»: القاعدة 23، استُبدل): رقم النسخة أو SETTINGS_ABSENT حين لا مستند صالح.
    const settingsVersion = settingsVersionOf(await readProtocolSettings({db}));
    const technicians = techSnaps.docs
        .map((doc) => ({technicianId: doc.id, displayName: typeof doc.data().displayName === "string" ? doc.data().displayName : null}))
        .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)) || (a.technicianId < b.technicianId ? -1 : 1));
    console.log(`[${CONFIG}] served session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} technicians=${technicians.length} ` +
        `slot1=${forms[0] ? FORM_STATE.SUBMITTED : FORM_STATE.NOT_SUBMITTED} slot2=${forms[1] ? FORM_STATE.SUBMITTED : FORM_STATE.NOT_SUBMITTED}`);
    return {
      sessionId,
      formContractVersion: FORM_CONTRACT_VERSION,
      enabled: true,
      slots: [
        {slot: FORM_SLOT.FIRST, formState: forms[0] ? FORM_STATE.SUBMITTED : FORM_STATE.NOT_SUBMITTED},
        {slot: FORM_SLOT.SECOND, formState: forms[1] ? FORM_STATE.SUBMITTED : FORM_STATE.NOT_SUBMITTED, drawn: doubleEvalState(pendingData) === DOUBLE_EVAL_STATE.SELECTED},
      ],
      technicians,
      symptomOrder: [...SYMPTOM_CHIPS],
      settingsVersion,
    };
  } catch (e) {
    if (!(e instanceof HttpsError)) logUnexpected(CONFIG, e, sessionId, uid);
    throw e;
  }
};

// ─── recordReportFirstOpened ──────────────────────────────────────────────────────────────────────────────────────

const RECORD = "recordReportFirstOpened";

const recordReportFirstOpenedHandler = async (request) => {
  const {uid, sessionId} = readCallerAndSession(RECORD, request);
  const sessionRef = db.collection("scanSessions").doc(sessionId);
  const pendingRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId);
  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      const data = sessionSnap.exists ? sessionSnap.data() : null;
      if (!data) return {refusal: R.SESSION_NOT_FOUND};
      const {role, joinedByState} = sessionRoleOf(data, uid);
      if (role === null) return {refusal: R.NOT_OWNER, extra: ` role=none joinedByState=${joinedByState}`};
      const {state, status} = classifyStatus(data);
      if (state !== STATUS_STATE.KNOWN) return {refusal: R.SESSION_STATUS_UNKNOWN, extra: ` statusState=${state}`};
      const scanId = typeof data.scanId === "string" && data.scanId !== "" && isSafeDocId(data.scanId) ? data.scanId : null;
      if (status !== SESSION_STATUS.COMPLETED || scanId === null) return {refusal: R.REPORT_NOT_AVAILABLE, extra: ` status=${status} scanIdState=${scanId === null ? "ABSENT" : "SET"}`};
      const reportSnap = await tx.get(db.collection("reports").doc(scanId));
      if (!reportSnap.exists) return {refusal: R.REPORT_NOT_AVAILABLE, extra: " report=ABSENT"};
      const pendingSnap = await tx.get(pendingRef);
      const already = pendingSnap.exists && pendingSnap.data().reportFirstOpenedAt !== undefined && pendingSnap.data().reportFirstOpenedAt !== null;
      if (already) return {recorded: false, role};
      tx.set(pendingRef, {reportFirstOpenedAt: admin.firestore.FieldValue.serverTimestamp()}, {merge: true});
      return {recorded: true, role};
    });
  } catch (e) {
    logUnexpected(RECORD, e, sessionId, uid);
    throw e;
  }
  if (decided.refusal) refuse(RECORD, decided.refusal, {sessionId, uid, extra: decided.extra || ""});
  console.log(`[${RECORD}] ${decided.recorded ? "recorded" : "already recorded"} session=${hashIdForLog(sessionId)} caller=${hashIdForLog(uid)} role=${decided.role}`);
  return {sessionId, recorded: decided.recorded};
};

exports.submitTechnicianForm = onCall({timeoutSeconds: 30, memory: "256MiB"}, submitTechnicianFormHandler);
exports.getTechnicianFormConfig = onCall({timeoutSeconds: 30, memory: "256MiB"}, getTechnicianFormConfigHandler);
exports.recordReportFirstOpened = onCall({timeoutSeconds: 30, memory: "256MiB"}, recordReportFirstOpenedHandler);

// مُصدَّرة للاختبار (القاعدة 41): الدوالّ النقيّة والمعالجات بلا onCall.
exports.OUTCOME = OUTCOME;
exports.GATE_MODE = GATE_MODE;
exports.TECHNICIAN_STATE = TECHNICIAN_STATE;
exports.DOUBLE_EVAL_STATE = DOUBLE_EVAL_STATE;
exports.decideSessionGate = decideSessionGate;
exports.technicianState = technicianState;
exports.doubleEvalState = doubleEvalState;
exports.refuse = refuse;
exports.submitTechnicianFormHandler = submitTechnicianFormHandler;
exports.getTechnicianFormConfigHandler = getTechnicianFormConfigHandler;
exports.recordReportFirstOpenedHandler = recordReportFirstOpenedHandler;
