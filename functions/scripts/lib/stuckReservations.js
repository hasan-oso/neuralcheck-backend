'use strict';

// ===================================================================
// stuckReservations — معيار «حجز رصيد عالق» وجرده، يستعملهما سكربتان: audit-stuck-scan-reservations-readonly.js (قراءة بحتة)
// وrelease-stuck-scan-reservations.js (إعادة، جافّ افتراضياً). V8 قبل أوّل نشر، 2026-10-09 +03.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «الحجوزات العالقة: سكربت قراءة يعدّ الحجوزات الأقدم من 10 دقائق بلا تقرير،
// وسكربت إعادة منفصل يستدعي releaseScanCredit نفسها، جافّ افتراضياً و--apply بيدي. ولا منظّف مجدوَل الآن. معتمد.»
//
// ─── المرجع في الكود (قُرئ وقورن) ─────────────────────────────────────────────────────────────────────────────────
// functions/src/analysis/scanReservation.js:30-33 (الحالة ٧-ج: «scanClaims بحقل reservation غير null وأقدم من TTL وبلا reports/{scanId}»)
// و:112-127 (releaseScanCredit). **فرق واحد يُبلَّغ:** تعليق ٧-ج يقول «أقدم من TTL» والـTTL = 300000 ms (5 دقائق،
// analyzeDevice.js:490، ثابت محلّي غير مُصدَّر)، وقرار المستخدم **10 دقائق** (600000 ms) — فالعتبة هنا 10 دقائق بنصّ القرار.
// أمان: 10 دقائق ضعف الـTTL وفوق مهلة الدالّة (300 ثانية، ANALYZE_DEVICE_TIMEOUT_MS) فلا يُعدّ حجز تحليل ما زال يجري.
//
// ─── المعيار (الدالّة classifyClaim) ───────────────────────────────────────────────────────────────────────────────
// مستند scanClaims/{scanId} يُصنَّف حالةً صريحة (القاعدة 22 — الغياب لا يُقرأ قِدَماً ولا حداثة):
//   NO_RESERVATION  لا حجز (reservation غائب أو null): قفل عابر لا يحمل فحصة.
//   MALFORMED       حجز موجود لكنه بلا userId نصّي أو reservedAtMs رقمي منتهٍ: لا يُعرَف عمره ولا صاحبه — يُعدّ ولا يُعاد.
//   RECENT          حجز عمره ≤ 10 دقائق (أو في المستقبل): قد يكون تحليلاً جارياً.
//   HAS_REPORT      حجز أقدم من 10 دقائق **ولـreports/{scanId} موجود**: الفحصة مستهلَكة بحقّ (التقرير حُفظ وفشل محو القفل) — لا إعادة.
//   STUCK           حجز أقدم من 10 دقائق **وبلا تقرير** — هو العالق.
// «أقدم من 10 دقائق» = العمر > 600000 ms اكتمالاً (العمر = الآن − reservedAtMs)؛ العمر المساوي للعتبة تماماً ليس أقدم.
//
// ─── ما يُهشَّر ────────────────────────────────────────────────────────────────────────────────────────────────────
// scanId ومعرّف المستخدم يخرجان بـhashIdForLog (src/utils/logRedaction.js — الدالّة المُصدَّرة في سياسة السجلّات: sha256 ← 12 محرفاً ← #).
// لا معرّف مستخدم صريح في أيّ مخرَج. وسبب كتابة المهشَّر لا الخام: المخرَج يُحفظ في evidence/.
// ===================================================================

const {hashIdForLog} = require('../../src/utils/logRedaction');
// الإعادة تستدعي الدالّة نفسها التي تستدعيها analyzeDevice عند الفشل — لا نسخة منها (القاعدة 24).
const {releaseScanCredit} = require('../../src/analysis/scanReservation');

const CLAIMS_COLLECTION = 'scanClaims';
const REPORTS_COLLECTION = 'reports';

/** عتبة «أقدم من 10 دقائق» — قرار المستخدم 2026-10-09. */
const STUCK_AFTER_MS = 10 * 60 * 1000;

const CLAIM_STATE = Object.freeze({
  NO_RESERVATION: 'NO_RESERVATION',
  MALFORMED: 'MALFORMED',
  RECENT: 'RECENT',
  HAS_REPORT: 'HAS_REPORT',
  STUCK: 'STUCK',
});

const PAGE_SIZE = 200;
const MAX_LISTED = 50; // سقف ما يُسرَد من المعرّفات المهشَّرة في المخرَج؛ الأعداد كاملة دائماً

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * يصنّف مستند قفل. دالّة نقيّة.
 * @param {Object} p
 * @param {?Object} p.claimData scanClaims/{scanId}.data()
 * @param {boolean} p.reportExists هل reports/{scanId} موجود (يُمرَّر دائماً؛ لا يُقرأ هنا)
 * @param {number} p.nowMs
 * @return {{state: string, ageMs: ?number}}
 */
function classifyClaim({claimData, reportExists, nowMs}) {
  const reservation = claimData && claimData.reservation;
  if (reservation === null || reservation === undefined) return {state: CLAIM_STATE.NO_RESERVATION, ageMs: null};
  if (typeof reservation !== 'object' || typeof reservation.userId !== 'string' || reservation.userId === '' ||
      !isFiniteNumber(reservation.reservedAtMs)) {
    return {state: CLAIM_STATE.MALFORMED, ageMs: null};
  }
  const ageMs = nowMs - reservation.reservedAtMs;
  if (!(ageMs > STUCK_AFTER_MS)) return {state: CLAIM_STATE.RECENT, ageMs};
  return {state: reportExists ? CLAIM_STATE.HAS_REPORT : CLAIM_STATE.STUCK, ageMs};
}

/** مولِّد صفحات scanClaims بترتيب معرّف المستند (المجموعة صغيرة: القفل يُمحى في finally). */
async function* iterateClaimPages({db, pageSize = PAGE_SIZE}) {
  const {FieldPath} = require('firebase-admin/firestore');
  let last = null;
  for (;;) {
    let q = db.collection(CLAIMS_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    last = snap.docs[snap.docs.length - 1];
    yield snap.docs;
    if (snap.size < pageSize) return;
  }
}

/**
 * جرد قراءة بحتة: كل قفل مُصنَّف. يقرأ reports/{scanId} للأقفال ذات الحجز وحدها.
 * @param {Object} p
 * @param {Object} p.db Firestore (مغلَّف بـwrapReadOnly في الاستعمال).
 * @param {number} p.nowMs
 * @return {Promise<{totalClaims: number, byState: Object, stuck: Array}>}
 */
async function collectClaims({db, nowMs, pageSize = PAGE_SIZE}) {
  const byState = Object.fromEntries(Object.values(CLAIM_STATE).map((s) => [s, 0]));
  const stuck = [];
  let totalClaims = 0;
  for await (const docs of iterateClaimPages({db, pageSize})) {
    for (const doc of docs) {
      totalClaims++;
      const data = doc.data() || {};
      const hasReservation = data.reservation !== null && data.reservation !== undefined;
      let reportExists = false;
      if (hasReservation) {
        reportExists = (await db.collection(REPORTS_COLLECTION).doc(doc.id).get()).exists;
      }
      const {state, ageMs} = classifyClaim({claimData: data, reportExists, nowMs});
      byState[state]++;
      if (state === CLAIM_STATE.STUCK) {
        stuck.push({
          scanId: doc.id,
          userId: data.reservation.userId,
          isFreeTrial: data.reservation.isFreeTrial === true,
          ageMs,
          claimedAtMs: isFiniteNumber(data.claimedAtMs) ? data.claimedAtMs : null,
        });
      }
    }
  }
  return {totalClaims, byState, stuck};
}

const minutes = (ms) => (ms === null || ms === undefined) ? null : Math.round((ms / 60000) * 10) / 10;

/**
 * ملخّص المخرَج: أعداد ومعرّفات مهشَّرة فقط (لا معرّف خامّ، لا معرّف مستخدم صريح).
 * @param {{totalClaims: number, byState: Object, stuck: Array}} collected
 * @return {Object}
 */
function summarizeCollected(collected) {
  const byUser = {};
  for (const s of collected.stuck) {
    const h = hashIdForLog(s.userId);
    byUser[h] = (byUser[h] || 0) + 1;
  }
  const ages = collected.stuck.map((s) => s.ageMs).sort((a, b) => a - b);
  return {
    totalClaims: collected.totalClaims,
    byState: collected.byState,
    stuckCount: collected.stuck.length,
    // كل حجز عالق = فحصة واحدة محجوزة لم تُعَد.
    creditsHeldByStuckReservations: collected.stuck.length,
    stuckFreeTrial: collected.stuck.filter((s) => s.isFreeTrial).length,
    stuckAgeMinutes: {min: minutes(ages[0]), max: minutes(ages[ages.length - 1])},
    stuckByUserHashed: byUser,
    stuckListedHashed: collected.stuck.slice(0, MAX_LISTED).map((s) => ({
      scanId: hashIdForLog(s.scanId), userId: hashIdForLog(s.userId), ageMinutes: minutes(s.ageMs), isFreeTrial: s.isFreeTrial,
    })),
    stuckListTruncated: collected.stuck.length > MAX_LISTED,
  };
}

/**
 * فحص ذاتي بلا شبكة (--preflight): المعيار على حالات اصطناعية، وصيغة التهشير، والعتبة.
 * @return {{ok: boolean, checks: Array<{name: string, ok: boolean}>}}
 */
function preflightChecks() {
  const now = 1_000_000_000_000;
  const res = (userId = 'u', reservedAtMs = now - STUCK_AFTER_MS - 1) => ({reservation: {userId, isFreeTrial: false, deviceFP: null, reservedAtMs}});
  const cases = [
    ['older than 10 minutes and no report is STUCK', classifyClaim({claimData: res(), reportExists: false, nowMs: now}).state === CLAIM_STATE.STUCK],
    ['exactly 10 minutes is not older (RECENT)', classifyClaim({claimData: res('u', now - STUCK_AFTER_MS), reportExists: false, nowMs: now}).state === CLAIM_STATE.RECENT],
    ['older than 10 minutes with a report is HAS_REPORT', classifyClaim({claimData: res(), reportExists: true, nowMs: now}).state === CLAIM_STATE.HAS_REPORT],
    ['a null reservation is NO_RESERVATION', classifyClaim({claimData: {reservation: null}, reportExists: false, nowMs: now}).state === CLAIM_STATE.NO_RESERVATION],
    ['a reservation without reservedAtMs is MALFORMED', classifyClaim({claimData: {reservation: {userId: 'u'}}, reportExists: false, nowMs: now}).state === CLAIM_STATE.MALFORMED],
    ['hashed ids look like #<12 hex> and never the raw id', /^#[0-9a-f]{12}$/.test(hashIdForLog('some-user-id')) && !hashIdForLog('some-user-id').includes('some-user-id')],
    ['the threshold is 10 minutes', STUCK_AFTER_MS === 600000],
  ];
  const checks = cases.map(([name, ok]) => ({name, ok}));
  return {ok: checks.every((c) => c.ok), checks};
}

// ───────────────────────── الإعادة (release-stuck-scan-reservations.js) ─────────────────────────

const RELEASE_RESULT = Object.freeze({
  RELEASED: 'RELEASED', // releaseScanCredit أعادت الفحصة ومحت الحجز
  ALREADY_RELEASED: 'ALREADY_RELEASED', // releaseScanCredit لم تجد حجزاً (أُعيد قبل لحظة) — لا إعادة مزدوجة
  SKIPPED_CLAIM_GONE: 'SKIPPED_CLAIM_GONE', // القفل مُحي بين الجرد والإعادة
  SKIPPED_NOT_STUCK_NOW: 'SKIPPED_NOT_STUCK_NOW', // لم يعد المعيار صادقاً عند إعادة الفحص (حجز جديد/محوّ/مشوَّه)
  SKIPPED_HAS_REPORT_NOW: 'SKIPPED_HAS_REPORT_NOW', // ظهر تقرير للمعرّف بين الجرد والإعادة — الفحصة مستهلَكة بحقّ
  SKIPPED_RETRY_IN_FLIGHT: 'SKIPPED_RETRY_IN_FLIGHT', // القفل نفسه حديث (claimedAtMs ≤ 10 دقائق): إعادة طلب تتبنّى الحجز الآن
  FAILED: 'FAILED', // رمت releaseScanCredit (مثلاً مستند المستخدم غير موجود) — يبقى الحجز ظاهراً في الجرد
});

/**
 * إعادة فحص المعيار على الحالة الحيّة قبل كلّ إعادة (أمر المنسّق: «ويعيد فحص المعيار قبل كل إعادة»): قراءة جديدة للقفل
 * وللتقرير، وتصنيف بالدالّة نفسها. وحارس إضافي واحد: القفل الحديث (claimedAtMs ≤ 10 دقائق) يعني أن analyzeDevice كتبته للتوّ
 * (إعادة طلب تحمل الحجز القديم بعمره القديم وتتبنّاه — analyzeDevice.js:491-512)، فإعادة الفحصة الآن تُعطي فحصة مجانية؛ يُتخطّى.
 * @return {Promise<{result: ?string, state: ?string}>} result=null إن بقي المعيار صادقاً (تجوز الإعادة)
 */
async function recheckBeforeRelease({db, scanId, nowMs}) {
  const claimSnap = await db.collection(CLAIMS_COLLECTION).doc(scanId).get();
  if (!claimSnap.exists) return {result: RELEASE_RESULT.SKIPPED_CLAIM_GONE, state: null};
  const claimData = claimSnap.data() || {};
  const hasReservation = claimData.reservation !== null && claimData.reservation !== undefined;
  const reportExists = hasReservation ? (await db.collection(REPORTS_COLLECTION).doc(scanId).get()).exists : false;
  const {state} = classifyClaim({claimData, reportExists, nowMs});
  if (state === CLAIM_STATE.HAS_REPORT) return {result: RELEASE_RESULT.SKIPPED_HAS_REPORT_NOW, state};
  if (state !== CLAIM_STATE.STUCK) return {result: RELEASE_RESULT.SKIPPED_NOT_STUCK_NOW, state};
  if (isFiniteNumber(claimData.claimedAtMs) && (nowMs - claimData.claimedAtMs) <= STUCK_AFTER_MS) {
    return {result: RELEASE_RESULT.SKIPPED_RETRY_IN_FLIGHT, state};
  }
  return {result: null, state};
}

/**
 * يعيد الحجوزات العالقة. بلا apply: جافّ — يعدّ ما سيُعاد ولا يستدعي releaseScanCredit.
 * @param {Object} p
 * @param {Object} p.db Firestore (مغلَّف بـwrapReadOnly في الجافّ، والحقيقي مع apply)
 * @param {Object} p.FieldValue admin.firestore.FieldValue
 * @param {boolean} p.apply
 * @param {function(): number} p.now
 * @param {function(string): void} [p.log]
 * @return {Promise<{before: Object, results: Object, after: ?Object, listed: Array, failedExamples: Array}>}
 */
async function releaseStuck({db, FieldValue, apply, now, log = () => {}}) {
  const nowMs = now();
  const collected = await collectClaims({db, nowMs});
  const before = summarizeCollected(collected);
  const results = Object.fromEntries(Object.values(RELEASE_RESULT).map((r) => [r, 0]));
  const listed = [];
  const failedExamples = [];
  if (!apply) return {before, results, after: null, listed, failedExamples, wouldRelease: collected.stuck.length};

  for (const c of collected.stuck) {
    let result;
    try {
      const re = await recheckBeforeRelease({db, scanId: c.scanId, nowMs: now()});
      if (re.result) {
        result = re.result;
      } else {
        const claimRef = db.collection(CLAIMS_COLLECTION).doc(c.scanId);
        const r = await releaseScanCredit({db, FieldValue, claimRef});
        result = r.released ? RELEASE_RESULT.RELEASED : RELEASE_RESULT.ALREADY_RELEASED;
      }
    } catch (e) {
      result = RELEASE_RESULT.FAILED;
      if (failedExamples.length < MAX_LISTED) {
        failedExamples.push({scanId: hashIdForLog(c.scanId), code: (e && e.code !== undefined) ? String(e.code) : 'NO_CODE',
          className: (e && e.constructor && e.constructor.name) || typeof e});
      }
    }
    results[result]++;
    if (listed.length < MAX_LISTED) listed.push({scanId: hashIdForLog(c.scanId), userId: hashIdForLog(c.userId), result});
    log(`[release] ${hashIdForLog(c.scanId)} ${result}`);
  }
  const after = summarizeCollected(await collectClaims({db, nowMs: now()}));
  return {before, results, after, listed, failedExamples};
}

module.exports = {
  RELEASE_RESULT, recheckBeforeRelease, releaseStuck,
  CLAIMS_COLLECTION, REPORTS_COLLECTION, STUCK_AFTER_MS, CLAIM_STATE, PAGE_SIZE, MAX_LISTED,
  classifyClaim, iterateClaimPages, collectClaims, summarizeCollected, preflightChecks,
};
