"use strict";

// ===================================================
// sessionLifecycle — منطق دورة جلسة الفحص المشترك بين joinScanSession وcancelScanSession وanalyzeDevice وsubmitEvaluation (الدفعة ٩، 2026-10-10 +03)
// ===================================================
//
// قرارات المستخدم (2026-10-10، بنصّها، منقولة من أمر المنسّق):
//   ١ «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى، بلا حذف (القاعدة 42)، ويُعاد الحجز المعلّق مرّة واحدة
//      بالآلية القائمة. واختبار للإلغاء المزدوج، وللإلغاء بعد الاكتمال (يُرفض).»
//   ٢ «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها. والجلسات العالقة الثلاث القديمة تُعدّ فقط ولا تُعدَّل،
//      إلا بأمر منّي.»
//
// ما في هذا الملفّ دوالّ نقيّة (الدور، التصنيف، حقول الكتابة) إلّا اثنتين تلمسان Firestore:
//   recordSessionExpiredIfDue — معاملة تكتب «منتهية» إن كانت الجلسة جارية وانقضى expiresAt (وإلا لا تكتب).
//   releaseSessionReservations — تعيد الحجز المعلّق على أقفال الجلسة، بـreleaseScanCredit نفسها (scanReservation.js)، مرّة واحدة.
//
// ─── لا حذف ────────────────────────────────────────────────────────────────────────────────────────────────────────
// لا هنا ولا في ما يستدعيه: لا delete() ولا FieldValue.delete() ولا دفعة حذف. الإلغاء والانتهاء يكتبان حالة وحقلاً؛ وقفل scanClaims يبقى بحجزه
// المُحرَّر (reservation: null) كما تفعل release-stuck-scan-reservations.js (القاعدة 42).
//
// ─── الغياب حالة صريحة (القاعدة 22) ─────────────────────────────────────────────────────────────────────────────────
// حالة غائبة أو غير معروفة، ومعرّف منضمّ غائب، وقفل بلا claimedAtMs مقروء، وحجز مشوَّه: كلٌّ حالة مسمّاة تُعاد وتُسجَّل، لا قيمة افتراضية.
// خصوصاً: joinedBy الغائب لا يساوي uid المستدعي أبداً (لا «null == null»)، فمن انضمّ بلا هوية لا يُعرَف منضمّاً.

const {toDateOrNull} = require("../utils/subscription");
const {SCAN_CLAIM_TTL_MS, releaseScanCredit} = require("../analysis/scanReservation");
const {
  SESSION_STATUS, ACTIVE_SESSION_STATUSES, KNOWN_SESSION_STATUSES, SESSION_ROLE, JOIN_REFUSAL, SWEEP_SKIP_REASON, ANALYZE_SESSION_REFUSAL,
} = require("./sessionNames");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("./sessionTimeout");
const {hashIdForLog} = require("../utils/logRedaction");

const CLAIMS_COLLECTION = "scanClaims";
const REPORTS_COLLECTION = "reports";

// ─── الحالة ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** حالة قراءة status: معروفة، أو غائبة، أو ليست نصّاً، أو نصّ لا تعرفه الشيفرة. */
const STATUS_STATE = Object.freeze({
  KNOWN: "KNOWN",
  ABSENT: "ABSENT",
  NOT_A_STRING: "NOT_A_STRING",
  UNRECOGNIZED: "UNRECOGNIZED",
});

/**
 * @param {?Object} data scanSessions/{id}.data()
 * @return {{state: string, status: ?string}} status يُملأ مع KNOWN فقط (لا يُعاد نصّ لا تعرفه الشيفرة: قد يكون أيّ شيء)
 */
function classifyStatus(data) {
  const v = data ? data.status : undefined;
  if (v === undefined || v === null) return {state: STATUS_STATE.ABSENT, status: null};
  if (typeof v !== "string") return {state: STATUS_STATE.NOT_A_STRING, status: null};
  if (KNOWN_SESSION_STATUSES.includes(v)) return {state: STATUS_STATE.KNOWN, status: v};
  return {state: STATUS_STATE.UNRECOGNIZED, status: null};
}

// ─── الدور ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** لماذا لم يُعرَف المستدعي مالكاً ولا منضمّاً (للسجلّ فقط): حالة joinedBy المخزَّنة. */
const JOINED_BY_STATE = Object.freeze({
  ABSENT: "absent",
  NULL: "null", // انضمّ بلا هوية (joinScanSession يكتب null: joinerUid = request.auth?.uid || null)
  EMPTY: "empty",
  INVALID_TYPE: "invalid-type",
  OTHER_UID: "other-uid",
});

const isNonEmptyString = (v) => typeof v === "string" && v !== "";

/**
 * هل المستدعي هو الجهاز الذي انضمّ إلى هذه الجلسة؟ **مصدر واحد للمقارنة** (القاعدة 24): يستعملها الإلغاء (sessionRoleOf) وإعادة الانضمام (decideJoinForNonPending).
 * الغياب لا يُقرأ هويةً (القاعدة 22): uid غائب أو null أو فارغ أو غير نصّ ⟵ false، وjoinedBy غائب أو null أو فارغ أو غير نصّ ⟵ false — فلا «null == null»،
 * ومن انضمّ بلا هوية (joinScanSession تكتب joinedBy=null حين لا auth) لا يُعرَف منضمّاً أبداً.
 * @param {?Object} data scanSessions/{id}.data()
 * @param {*} uid request.auth.uid
 * @return {boolean}
 */
function isJoinedBy(data, uid) {
  return Boolean(data) && isNonEmptyString(uid) && isNonEmptyString(data.joinedBy) && data.joinedBy === uid;
}

/**
 * دور المستدعي في الجلسة. المالك أوّلاً (ownerId == uid)، ثم المنضمّ (joinedBy == uid). الغائب لا يساوي غائباً: uid الغائب أو الفارغ لا يُطابَق.
 * @param {?Object} data scanSessions/{id}.data()
 * @param {*} uid request.auth.uid
 * @return {{role: ?string, joinedByState: ?string}} role=null يعني لا مالك ولا منضمّ؛ joinedByState يُملأ حينها
 */
function sessionRoleOf(data, uid) {
  if (isNonEmptyString(uid) && data) {
    if (isNonEmptyString(data.ownerId) && data.ownerId === uid) return {role: SESSION_ROLE.OWNER, joinedByState: null};
    if (isJoinedBy(data, uid)) return {role: SESSION_ROLE.JOINER, joinedByState: null};
  }
  const jb = data ? data.joinedBy : undefined;
  let joinedByState;
  if (jb === undefined) joinedByState = JOINED_BY_STATE.ABSENT;
  else if (jb === null) joinedByState = JOINED_BY_STATE.NULL;
  else if (typeof jb !== "string") joinedByState = JOINED_BY_STATE.INVALID_TYPE;
  else if (jb === "") joinedByState = JOINED_BY_STATE.EMPTY;
  else joinedByState = JOINED_BY_STATE.OTHER_UID;
  return {role: null, joinedByState};
}

// ─── الانتهاء ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * حقول كتابة «منتهية»: الحالة ووقت التسجيل. expiredAt = لحظة تسجيل الخادم (لا expiresAt المخزَّن: ذاك يبقى كما كُتب عند الإنشاء).
 * @param {Object} FieldValue admin.firestore.FieldValue
 * @return {{status: string, expiredAt: *}}
 */
function expiredWriteFields(FieldValue) {
  return {status: SESSION_STATUS.EXPIRED, expiredAt: FieldValue.serverTimestamp()};
}

/**
 * هل يجب تسجيل «منتهية» لهذه الجلسة الآن؟ جارية (pending/scanning) وانقضى expiresAt فعلاً. غياب expiresAt أو تلفه **لا** يُقرأ انقضاءً
 * (لا يُعرَف أنه انقضى) — يبقى SESSION_EXPIRES_AT_INVALID رفضاً بلا كتابة (القاعدة 22).
 * @param {?Object} data
 * @param {Date} now
 * @return {boolean}
 */
function isDueForExpiredRecord(data, now) {
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN || !ACTIVE_SESSION_STATUSES.includes(status)) return false;
  const refusal = sessionExpiryRefusal(data, now);
  return refusal !== null && refusal.reason === SESSION_EXPIRY_REASON.EXPIRED;
}

/**
 * معاملة: تقرأ الجلسة، وإن كانت جارية وانقضى وقتها تكتب «منتهية». لا تكتب غير ذلك. تُستدعى من الدوالّ التي تمسّ جلسة وترفضها
 * بسبب انقضاء الوقت (analyzeDevice وsubmitEvaluation) فيُسجَّل الانتهاء مع الرفض لا بمنظّف مجدوَل (قرار المستخدم ٢).
 * @param {Object} p
 * @param {Object} p.db Firestore
 * @param {Object} p.FieldValue admin.firestore.FieldValue
 * @param {Object} p.sessionRef مرجع scanSessions/{id}
 * @param {Date} [p.now]
 * @param {string} p.source اسم الدالّة المستدعية (للسجلّ)
 * @param {?Function} [p.guard] ({tx, data, sessionRef, now}) ⟵ Promise<?string>: يُستدعى داخل المعاملة بعد ثبوت الاستحقاق وقبل الكتابة (القراءات كلّها قبل الكتابة)؛ سبب نصّي ⟵ لا كتابة
 *   وتُعاد النتيجة بـskipReason. الكنس يمرّر حارس الأقفال (E32) هنا فيُقرأ القفل في المعاملة نفسها لا قبلها. غائب ⟵ السلوك القائم بلا تغيير (analyzeDevice وsubmitEvaluation).
 * @return {Promise<{written: boolean, previousStatus: ?string, skipReason?: string}>}
 */
async function recordSessionExpiredIfDue({db, FieldValue, sessionRef, now = new Date(), source, guard = null}) {
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) return {written: false, previousStatus: null};
    const data = snap.data();
    if (!isDueForExpiredRecord(data, now)) return {written: false, previousStatus: classifyStatus(data).status};
    if (guard !== null) {
      const skipReason = await guard({tx, data, sessionRef, now});
      if (skipReason) return {written: false, previousStatus: classifyStatus(data).status, skipReason};
    }
    tx.update(sessionRef, expiredWriteFields(FieldValue));
    return {written: true, previousStatus: classifyStatus(data).status};
  });
  if (result.written) {
    console.log(`[sessionLifecycle] recorded expired from=${source} previous=${result.previousStatus} session=${hashIdForLog(sessionRef.id)}`);
  }
  return result;
}

/**
 * نسخة لا ترمي: فشل تسجيل الانتهاء لا يغيّر رفض النداء (الرفض قائم بصرف النظر) لكنه يُسجَّل بالرمز واسم الصنف وحدهما (القاعدة 36).
 * @param {Object} p نفس recordSessionExpiredIfDue
 * @return {Promise<?{written: boolean, previousStatus: ?string}>} null إن فشل التسجيل
 */
async function recordSessionExpiredIfDueSafely(p) {
  try {
    return await recordSessionExpiredIfDue(p);
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[sessionLifecycle] recording expired FAILED from=${p.source} session=${hashIdForLog(p.sessionRef && p.sessionRef.id)} ` +
        `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    return null;
  }
}

// ─── الإلغاء ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * حقول كتابة «ملغاة».
 * @param {Object} FieldValue admin.firestore.FieldValue
 * @param {string} reason من CANCEL_REASON
 * @return {{status: string, cancelledAt: *, cancelReason: string}}
 */
function cancelledWriteFields(FieldValue, reason) {
  return {status: SESSION_STATUS.CANCELLED, cancelledAt: FieldValue.serverTimestamp(), cancelReason: reason};
}

// ─── أقفال الجلسة (scanClaims بحقل sessionId الذي تكتبه analyzeDevice) ─────────────────────────────────────────────────

/** حيوية القفل: تحليل يجري، أو قديم، أو عمر مجهول. */
const CLAIM_LIVENESS = Object.freeze({
  IN_FLIGHT: "IN_FLIGHT", // عمر القفل < SCAN_CLAIM_TTL_MS: نداء analyzeDevice ما زال يمتلكه (analyzeDevice: ageMs < CLAIM_TTL_MS)
  STALE: "STALE", // عمره ≥ TTL: لا نداء حيّ بعد مهلة الدالّة (300 ث = TTL)
  AGE_UNKNOWN: "AGE_UNKNOWN", // claimedAtMs غائب أو غير رقمي: لا يُدَّعى قديماً ولا حديثاً
});

/**
 * @param {?Object} claimData scanClaims/{scanId}.data()
 * @param {number} nowMs
 * @return {string} من CLAIM_LIVENESS. العمر السالب (ساعة متقدّمة) = جارٍ، كما تعامله analyzeDevice (ageMs < TTL).
 */
function claimLiveness(claimData, nowMs) {
  const v = claimData ? claimData.claimedAtMs : undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) return CLAIM_LIVENESS.AGE_UNKNOWN;
  return (nowMs - v) < SCAN_CLAIM_TTL_MS ? CLAIM_LIVENESS.IN_FLIGHT : CLAIM_LIVENESS.STALE;
}

/**
 * قرار الأقفال للكنس (دالّة نقيّة، E32): هل يمنع قفلٌ للجلسة كتابة «منتهية» لها؟ **نفس تصنيف claimLiveness** الذي تحكم به cancelScanSession (مصدر واحد للحيوية، القاعدة 24):
 * قفل حيّ (عمره < SCAN_CLAIM_TTL_MS) ⟵ تحليل يجري؛ وقفل بلا claimedAtMs مقروء ⟵ عمره مجهول فلا يُدَّعى قديماً (القاعدة 22). القديم لا يمنع (لا نداء حيّ يمتلكه).
 * @param {Array<?Object>} claimsData بيانات أقفال scanClaims التي sessionId فيها = الجلسة
 * @param {number} nowMs
 * @return {?string} من SWEEP_SKIP_REASON: CLAIM_IN_FLIGHT أو CLAIM_AGE_UNKNOWN، أو null إن لم يمنع شيء. الجاري يسبق مجهول العمر.
 */
function claimsBlockingExpiry(claimsData, nowMs) {
  let sawUnknown = false;
  for (const c of claimsData) {
    const liveness = claimLiveness(c, nowMs);
    if (liveness === CLAIM_LIVENESS.IN_FLIGHT) return SWEEP_SKIP_REASON.CLAIM_IN_FLIGHT;
    if (liveness === CLAIM_LIVENESS.AGE_UNKNOWN) sawUnknown = true;
  }
  return sawUnknown ? SWEEP_SKIP_REASON.CLAIM_AGE_UNKNOWN : null;
}

/** حالة قفل قديم من جهة الإعادة. */
const STALE_CLAIM_STATE = Object.freeze({
  NO_RESERVATION: "NO_RESERVATION", // لا حجز (غائب أو null): لا شيء يُعاد
  MALFORMED_RESERVATION: "MALFORMED_RESERVATION", // حجز بلا userId نصّي: لا يُعرَف صاحبه فلا يُعاد ولا يُخمَّن
  HAS_REPORT: "HAS_REPORT", // التقرير محفوظ: الفحصة مستهلَكة بحقّ
  RELEASABLE: "RELEASABLE", // حجز سليم بلا تقرير وبلا نداء حيّ: يُعاد
});

/**
 * @param {{claimData: ?Object, reportExists: boolean}} p
 * @return {string} من STALE_CLAIM_STATE
 */
function classifyStaleClaim({claimData, reportExists}) {
  const reservation = claimData ? claimData.reservation : undefined;
  if (reservation === null || reservation === undefined) return STALE_CLAIM_STATE.NO_RESERVATION;
  if (typeof reservation !== "object" || !isNonEmptyString(reservation.userId)) return STALE_CLAIM_STATE.MALFORMED_RESERVATION;
  return reportExists ? STALE_CLAIM_STATE.HAS_REPORT : STALE_CLAIM_STATE.RELEASABLE;
}

/**
 * يُعيد الحجز المعلّق على أقفال الجلسة. **بعد** أن كُتبت «ملغاة» (فلا يبدأ تحليل جديد لها: analyzeDevice تفحص حالة الجلسة داخل معاملة القفل).
 * لكلّ قفل قديم بحجز سليم وبلا تقرير: releaseScanCredit — الدالّة نفسها التي تستدعيها analyzeDevice عند الفشل ويستدعيها سكربت الإعادة اليدوي،
 * وهي معاملة تقرأ القفل وتمحو حجزه فتكون الإعادة واحدة مهما تكرّر الاستدعاء (الإلغاء الثاني يجد الحجز null فلا يعيد).
 * لا تحذف مستند القفل. فشل إعادة واحدة لا يوقف الباقي ولا يُسقط الإلغاء: يبقى حجزها ظاهراً على القفل (يُتبنّى أو يُعاد في إلغاء/سكربت لاحق).
 * @param {Object} p
 * @param {Object} p.db Firestore
 * @param {Object} p.FieldValue admin.firestore.FieldValue
 * @param {string} p.sessionId
 * @param {number} p.nowMs
 * @return {Promise<{claims: number, released: number, noReservation: number, malformed: number, hasReport: number,
 *   inFlightSkipped: number, ageUnknownSkipped: number, failed: number}>} أعداد وحدها
 */
async function releaseSessionReservations({db, FieldValue, sessionId, nowMs}) {
  const summary = {claims: 0, released: 0, noReservation: 0, malformed: 0, hasReport: 0, inFlightSkipped: 0, ageUnknownSkipped: 0, failed: 0};
  const snap = await db.collection(CLAIMS_COLLECTION).where("sessionId", "==", sessionId).get();
  for (const doc of snap.docs) {
    summary.claims++;
    const claimData = doc.data();
    const liveness = claimLiveness(claimData, nowMs);
    if (liveness === CLAIM_LIVENESS.IN_FLIGHT) {
      summary.inFlightSkipped++;
      continue;
    }
    if (liveness === CLAIM_LIVENESS.AGE_UNKNOWN) {
      summary.ageUnknownSkipped++;
      continue;
    }
    // scanClaims/{scanId} — معرّف المستند هو scanId نفسه (analyzeDevice: db.collection("scanClaims").doc(scanId)).
    const reportExists = (await db.collection(REPORTS_COLLECTION).doc(doc.id).get()).exists;
    const state = classifyStaleClaim({claimData, reportExists});
    if (state === STALE_CLAIM_STATE.NO_RESERVATION) {
      summary.noReservation++;
    } else if (state === STALE_CLAIM_STATE.MALFORMED_RESERVATION) {
      summary.malformed++;
    } else if (state === STALE_CLAIM_STATE.HAS_REPORT) {
      summary.hasReport++;
    } else {
      try {
        const r = await releaseScanCredit({db, FieldValue, claimRef: doc.ref});
        if (r.released) summary.released++;
        else summary.noReservation++; // سبقتها إعادة أخرى بين القراءة والمعاملة: لا إعادة ثانية
      } catch (e) {
        summary.failed++;
        const className = (e && e.constructor && e.constructor.name) || typeof e;
        console.error(`[sessionLifecycle] reservation release FAILED session=${hashIdForLog(sessionId)} scan=${hashIdForLog(doc.id)} ` +
            `[${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"} — the claim keeps the reservation`);
      }
    }
  }
  return summary;
}

// ─── joinScanSession: أيّ جلسة يُحكَم بحالتها حين لا pending لرمز ─────────────────────────────────────────────────────

/** قرار الانضمام لجلسة ليست pending: يُرفض بسبب مسمّى، أو يُقبل إعادةَ انضمام (الجهاز نفسه، والجلسة scanning). */
const JOIN_DECISION = Object.freeze({
  REFUSE: "REFUSE", // reason من JOIN_REFUSAL
  REJOIN: "REJOIN", // الجهاز المنضمّ نفسه والجلسة scanning: يُقبل بلا كتابة ولا إشعار
});

/**
 * قرار joinScanSession لجلسة ليست pending. دالّة نقيّة.
 *
 * قرار المستخدم (2026-10-10، بنصّه): ««سبق الانضمام إلى هذه الجلسة»: يُعرض على جهاز آخر فقط. والجهاز المنضمّ نفسه إن أعاد الانضمام (عودة من الإعدادات، أو إعادة مسح)
 * يُقبل بلا رسالة ولا أثر جانبي.» وجوابه: «Accepted silently only while the session is «scanning» … After completion: a separate reason code SESSION_COMPLETED with the
 * current visible text … Cancelled and expired keep their current refusals.»
 *
 *   الحالة      الجهاز نفسه (joinedBy == uid)        جهاز آخر، أو بلا هوية (joinerUid غائب)
 *   scanning    REJOIN (يُقبل)                        REFUSE ALREADY_JOINED
 *   completed   REFUSE COMPLETED                      REFUSE ALREADY_JOINED
 *   cancelled   REFUSE CANCELLED                      REFUSE CANCELLED       (لا فرق بين الجهازين)
 *   expired     REFUSE EXPIRED                        REFUSE EXPIRED         (لا فرق بين الجهازين)
 *   غائبة/مجهولة/pending   REFUSE STATUS_UNKNOWN       REFUSE STATUS_UNKNOWN  (pending لا يصل هنا: تُستعمل للانضمام — تُعلَن لا تُسقَط إلى ALREADY_JOINED)
 * joinerUid الغائب لا يطابق أبداً (isJoinedBy، القاعدة 22) فيبقى رفضه القائم ALREADY_JOINED.
 * @param {?Object} data
 * @param {*} joinerUid request.auth?.uid || null
 * @return {{decision: string, reason: ?string}} decision من JOIN_DECISION؛ reason من JOIN_REFUSAL مع REFUSE، وnull مع REJOIN
 */
function decideJoinForNonPending(data, joinerUid) {
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return {decision: JOIN_DECISION.REFUSE, reason: JOIN_REFUSAL.STATUS_UNKNOWN};
  const sameDevice = isJoinedBy(data, joinerUid);
  if (status === SESSION_STATUS.SCANNING) {
    return sameDevice ?
      {decision: JOIN_DECISION.REJOIN, reason: null} :
      {decision: JOIN_DECISION.REFUSE, reason: JOIN_REFUSAL.ALREADY_JOINED};
  }
  if (status === SESSION_STATUS.COMPLETED) {
    return {decision: JOIN_DECISION.REFUSE, reason: sameDevice ? JOIN_REFUSAL.COMPLETED : JOIN_REFUSAL.ALREADY_JOINED};
  }
  if (status === SESSION_STATUS.CANCELLED) return {decision: JOIN_DECISION.REFUSE, reason: JOIN_REFUSAL.CANCELLED};
  if (status === SESSION_STATUS.EXPIRED) return {decision: JOIN_DECISION.REFUSE, reason: JOIN_REFUSAL.EXPIRED};
  return {decision: JOIN_DECISION.REFUSE, reason: JOIN_REFUSAL.STATUS_UNKNOWN}; // pending: لا يجوز بلوغه (يُستعمل للانضمام قبل هذا)
}

// ─── analyzeDevice على الجلسة (A-SUB الموجة الأولى، قرار المستخدم ١٢، 2026-10-17) ───────────────────────────────

/**
 * سبب رفض analyzeDevice لجلسة ليست scanning (أو غائبة) — **لطرفي الجلسة وحدهما** تُكشَف الحالة (القاعدة نفسها في cancelScanSession: لا وسيط وجود لغير الطرفين). غير الطرف، وغياب الجلسة،
 * يخرجان NOT_PARTICIPANT بالرمز نفسه. الغائبة/المجهولة الحالة STATUS_UNKNOWN (القاعدة 22). دالّة نقيّة.
 * @param {?Object} data scanSessions/{id}.data() أو null إن لم توجد
 * @param {*} uid request.auth.uid (قد يكون غائباً)
 * @return {string} من ANALYZE_SESSION_REFUSAL
 */
function analyzeSessionRefusalReason(data, uid) {
  if (!data) return ANALYZE_SESSION_REFUSAL.NOT_PARTICIPANT;
  if (sessionRoleOf(data, uid).role === null) return ANALYZE_SESSION_REFUSAL.NOT_PARTICIPANT;
  const {state, status} = classifyStatus(data);
  if (state !== STATUS_STATE.KNOWN) return ANALYZE_SESSION_REFUSAL.STATUS_UNKNOWN;
  if (status === SESSION_STATUS.PENDING) return ANALYZE_SESSION_REFUSAL.NOT_STARTED;
  if (status === SESSION_STATUS.COMPLETED) return ANALYZE_SESSION_REFUSAL.COMPLETED;
  if (status === SESSION_STATUS.CANCELLED) return ANALYZE_SESSION_REFUSAL.CANCELLED;
  if (status === SESSION_STATUS.EXPIRED) return ANALYZE_SESSION_REFUSAL.EXPIRED;
  return ANALYZE_SESSION_REFUSAL.STATUS_UNKNOWN; // scanning لا يبلغ هنا (يُفحَص انقضاؤه لا حالته)؛ وغيره لا تعرفه الشيفرة
}

/**
 * السبب المسمّى الذي يُكشَف عن جلسة لهذا المستدعي: `reason` لطرفها (مالك أو منضمّ)، وNOT_PARTICIPANT لغيره. للرفض الذي سببه معروف للخادم أصلاً (انقضاء expiresAt من sessionTimeout.js) فلا يُكشَف لغير الطرفين.
 * @param {?Object} data scanSessions/{id}.data()
 * @param {*} uid request.auth.uid
 * @param {string} reason من ANALYZE_SESSION_REFUSAL
 * @return {string} من ANALYZE_SESSION_REFUSAL
 */
function analyzeSessionReasonForCaller(data, uid, reason) {
  return (data && sessionRoleOf(data, uid).role !== null) ? reason : ANALYZE_SESSION_REFUSAL.NOT_PARTICIPANT;
}

/**
 * هل طلب analyzeDevice على جلسة **completed** إعادة محاولة مشروعة لنفس الفحص، فيُقدَّم له ردّه المخزَّن؟ (ردّ ضاع بعد اكتمال الفحص: كان يُرفض «جلسة الفحص غير صالحة» قبل بلوغ مسار الردّ المخزَّن.)
 * **ثلاثة شروط معاً، وغيابها رفض لا تسريب:** (١) الجلسة completed فعلاً (قراءة الخادم لا ادّعاء العميل)؛ (٢) المستدعي طرفها: مالكها أو الجهاز المنضمّ (sessionRoleOf — مصدر المقارنة الواحد مع
 * الإلغاء، والغائب لا يطابق أبداً)؛ (٣) scanId الطلب هو scanId الذي سجّلته الجلسة عند اكتمالها (فلا يُقدَّم تقرير فحص آخر لمن يعرف معرّفه). والشرط الرابع (ملكية التقرير المخزَّن: userId فيه = ownerId
 * الجلسة) يفحصه المستدعي بعد قراءة التقرير (ownerCheckState، مصدره sessionCompletion.js). دالّة نقيّة.
 * @param {?Object} data scanSessions/{id}.data()
 * @param {*} scanId scanId الطلب
 * @param {*} uid request.auth.uid
 * @return {boolean}
 */
function isLegitCompletedSessionRetry(data, scanId, uid) {
  if (!data) return false;
  if (classifyStatus(data).status !== SESSION_STATUS.COMPLETED) return false;
  if (sessionRoleOf(data, uid).role === null) return false;
  if (typeof scanId !== "string" || scanId === "") return false;
  return typeof data.scanId === "string" && data.scanId === scanId;
}

/**
 * من عدّة جلسات تحمل الرمز نفسه (الرمز فريد بين pending وقت الإنشاء فقط، فقد يتكرّر مع جلسة تاريخية)، تُختار الأحدث إنشاءً.
 * createdAt غير المقروء يُرتَّب أخيراً (لا يُقدَّم على مقروء)، والتعادل بترتيب المعرّف كي يكون الاختيار حتمياً.
 * @param {Array<{id: string, data: Object}>} entries
 * @return {?{id: string, data: Object}}
 */
function pickLatestSession(entries) {
  let best = null;
  let bestMs = -Infinity;
  for (const e of entries) {
    const d = toDateOrNull(e.data && e.data.createdAt);
    const ms = d === null ? -Infinity : d.getTime();
    if (best === null || ms > bestMs || (ms === bestMs && e.id > best.id)) {
      best = e;
      bestMs = ms;
    }
  }
  return best;
}

module.exports = {
  CLAIMS_COLLECTION,
  STATUS_STATE,
  JOINED_BY_STATE,
  CLAIM_LIVENESS,
  STALE_CLAIM_STATE,
  JOIN_DECISION,
  classifyStatus,
  isJoinedBy,
  sessionRoleOf,
  analyzeSessionRefusalReason,
  analyzeSessionReasonForCaller,
  isLegitCompletedSessionRetry,
  expiredWriteFields,
  cancelledWriteFields,
  isDueForExpiredRecord,
  recordSessionExpiredIfDue,
  recordSessionExpiredIfDueSafely,
  claimLiveness,
  claimsBlockingExpiry,
  classifyStaleClaim,
  releaseSessionReservations,
  decideJoinForNonPending,
  pickLatestSession,
};
