"use strict";

// ===================================================
// sweepExpiredSessions — الكنس الآمن لجلسات الفاعل المنقضية عند إنشاء جلسة أو انضمام (S-SWEEP، 2026-10-15 +03)
// ===================================================
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-ج (الكنس الآمن) — وحدة واحدة يستدعيها createScanSession بمفتاح ownerId وjoinScanSession بمفتاح joinedBy.
// قرار المستخدم (2026-10-15، user-answers-p623-open-questions، منقول): «Creating a session sweeps the owner's expired sessions (ownerId). Joining sweeps the joining
// device's expired sessions (joinedBy). Cancel does not sweep … A device that joined without an identity (joinedBy null) is reached only through its owner.»
// والشكل الآمن (البند ٣ من user-decisions-deploy-text-sessions، منقول): «تُكتب «منتهية» للجلسات التي انقضى وقتها فقط، من جلسات الفاعل نفسه. ولا تُلغى جلسة صالحة أبداً.»
//
// ─── ما يفعله ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   ١ المفتاح غائب (انضمام بلا هوية): لا استعلام ولا كنس (state=NOT_RUN_NO_KEY). **لا يُستعلَم بـjoinedBy == null أبداً** (يطال جلسات غير الفاعل).
//   ٢ استعلامان بمساواة لا غير (E33): `key == uid && status == "pending"` و`… == "scanning"`. بلا ترتيب ولا مدى ولا فهرس مركّب (القاعدة 43). **المحاكي لا يفرض الفهارس**،
//     فعدم الحاجة إلى فهرس يُرصَد في السجلّ بعد النشر: READ_FAILED برمز الخطأ إن احتاج استعلامٌ فهرساً.
//   ٣ المرشَّحة: جلسة المفتاح الجارية المعروفة التي expiresAt فيها مقروء وفي الماضي (isDueForExpiredRecord: حكم sessionExpiryRefusal نفسه). **لا تُمسّ أبداً:** صالحة، بلا expiresAt أو
//     بقيمة تالفة (القاعدة 22)، نهائية، بحالة غائبة أو مجهولة، **الجلسة المُشغِّلة** (excludeSessionId)، وجلسة فاعل آخر.
//   ٤ الكتابة: `status: "expired"` و`expiredAt` وحدهما، بمعاملة بفحص مسبق (recordSessionExpiredIfDue) — فلا تُطمَس جلسة صارت completed بين القراءة والكتابة. **لا حذف** (القاعدة 42)،
//     ولا cancelled، ولا إعادة حجز (E29).
//   ٥ E32: تُتخطّى مرشَّحة لها قفل scanClaims حيّ (عمره < 300 ث) أو مجهول العمر، وتُعدّ «متخطّاة». القفل يُقرأ **داخل معاملة الكتابة نفسها** (مساواة على sessionId بلا فهرس، كما
//     cancelScanSession) فلا يُكتب «منتهية» تحت تحليل بدأ بين الفحص والكتابة.
//   ٦ E33: سقف SWEEP_WRITE_CAP محاولة كتابة في النداء؛ والباقي لنداء لاحق (state=CAPPED). **السقف يُفرض حيث تُرسَل المعاملة** (القاعدة 35): يُعدّ ما كُتب وما رمت معاملته.
//   ٧ E34: ميزانية الزمن SWEEP_PLAN[…].budgetMs (الإنشاء 10 ث والانضمام 3 ث؛ ثلث مهلة الدالّة). عند نفادها يُترك الباقي (state=BUDGET_EXHAUSTED). **والقراءة تحت الميزانية أيضاً**: استعلام
//     لم يعُد بحلولها = READ_FAILED برمز SWEEP_READ_BUDGET_EXHAUSTED (فالكنس لا يؤخّر النداء فوق ميزانيته ولو علقت القراءة).
//   ٨ أفضل جهد: لا يرمي أبداً (sweepAndLog). فشل الكنس لا يغيّر ردّ النداء. فشل مرشَّحة واحدة لا يوقف الباقي (failed). والسجلّ برمز الخطأ واسم الصنف وحدهما (القاعدة 36).
//
// ─── سطر السجلّ E34 (نصّه معتمد، §٦-ج) ───────────────────────────────────────────────────────────────────────────────
//   [sweepExpiredSessions] swept from=<createScanSession|joinScanSession> key=<ownerId|joinedBy> keyId=<hashIdForLog(uid)> state=<STATE> returned=<n|NOT_RUN> candidates=<n|NOT_RUN>
//     written=<n|NOT_RUN> skipped=<n|NOT_RUN> failed=<n|NOT_RUN> sweepMs=<ms|NOT_RUN> totalMs=<ms>   (وعند READ_FAILED يُلحق: ` [<ClassName>] code=<code|NO_CODE>`)
//   يُكتب مرّة واحدة بالضبط في كل نداء يبلغ نقطة الكنس — حتى حين لا يجري كنس — وهو آخر ما يُكتب قبل الإرجاع فيشمل totalMs الكنس. ونداء رُفض قبل نقطة الكنس لا سطر كنس له.
//   وسطران آخران، لكلّ مرشَّحة لا لكل نداء: `skipped` (السبب من SWEEP_SKIP_REASON) و`write FAILED` (الرمز واسم الصنف). المعرّفات كلّها عبر hashIdForLog، ولا sessionId ولا uid خامّ.
//
// ─── التعريفات (§٦-ج) ───────────────────────────────────────────────────────────────────────────────────────────────
//   returned ما أعاده الاستعلامان؛ candidates ما بقي بعد حكم المرشَّحة واستثناء المُشغِّلة؛ written ما كُتب؛ skipped مرشَّحة لم تُكتب لقفل حيّ أو لأنها لم تعد مستحقّة داخل المعاملة؛
//   failed مرشَّحة رمت معاملتها (أو قراءة قفلها). **NOT_RUN لا يُستبدل صفراً قطّ.** والمعادلة عند COMPLETED: candidates = written + skipped + failed.

const {toDateOrNull} = require("../utils/subscription");
const {hashIdForLog} = require("../utils/logRedaction");
const {
  SWEEP_STATE, SWEEP_CALLER, SWEEP_KEY_FIELD, SWEEP_NOT_RUN, SWEEP_SKIP_REASON, ACTIVE_SESSION_STATUSES,
} = require("./sessionNames");
const {
  isDueForExpiredRecord, recordSessionExpiredIfDue, claimsBlockingExpiry, CLAIMS_COLLECTION,
} = require("./sessionLifecycle");

const SESSIONS_COLLECTION = "scanSessions";
const LOG_PREFIX = "[sweepExpiredSessions]";

/** سقف محاولات الكتابة في النداء الواحد (E33، معتمد 2026-10-15): ≥ المفتوحة المنقضية الملاحَظة في o2 (7) كي يكنسها نداء واحد (E27). */
const SWEEP_WRITE_CAP = 20;

/**
 * خطة كل نداء: مفتاح الكنس وميزانية الزمن (E34، معتمد بحدّيه بقرار المستخدم 2026-10-15: «الانضمام 3 ث، والإنشاء 10 ث» — ثلث مهلة الدالّة:
 * createScanSession.js timeoutSeconds 30، joinScanSession.js timeoutSeconds 10؛ يحرس sweepExpiredSessions.test.js ألّا تتجاوز الميزانية ثلث المهلة).
 */
const SWEEP_PLAN = Object.freeze({
  [SWEEP_CALLER.CREATE_SCAN_SESSION]: Object.freeze({keyField: SWEEP_KEY_FIELD.OWNER_ID, budgetMs: 10_000}),
  [SWEEP_CALLER.JOIN_SCAN_SESSION]: Object.freeze({keyField: SWEEP_KEY_FIELD.JOINED_BY, budgetMs: 3_000}),
});

/** نفدت الميزانية والقراءة لم تنتهِ. صنف مسمّى كي يظهر اسمه في سطر READ_FAILED (القاعدة 36: اسم الصنف والرمز وحدهما). */
class SweepReadBudgetExhaustedError extends Error {
  constructor() {
    super("sweep read budget exhausted");
    this.name = "SweepReadBudgetExhaustedError";
    this.code = "SWEEP_READ_BUDGET_EXHAUSTED";
  }
}

const errorClassName = (e) => (e && e.constructor && e.constructor.name) || typeof e;
const errorCode = (e) => ((e && e.code !== undefined) ? e.code : "NO_CODE");

/**
 * يسابق وعداً بالميزانية. المؤقّت يُلغى دائماً (لا يُبقي العملية حيّة). الوعد الأصلي إن تأخّر يُترك: لا كتابة بعده (الكتابة بعد القراءة في السلسلة نفسها).
 * @param {Promise} promise
 * @param {number} ms
 * @return {Promise}
 */
function withinBudget(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new SweepReadBudgetExhaustedError()), Math.max(0, ms));
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const emptyCounts = () => ({returned: null, candidates: null, written: null, skipped: null, failed: null});

/**
 * @param {Object} p
 * @param {Object} p.db Firestore
 * @param {Object} p.FieldValue admin.firestore.FieldValue
 * @param {string} p.from من SWEEP_CALLER
 * @param {*} p.uid قيمة المفتاح: request.auth.uid (الإنشاء) أو joinerUid (الانضمام)؛ غير النصّ أو الفارغ ⟵ NOT_RUN_NO_KEY
 * @param {string} [p.excludeSessionId] الجلسة المُشغِّلة (لا تُكنس أبداً)
 * @param {Function} [p.nowFn] مصدر الوقت بالمللي ثانية (حقن للاختبار)
 * @param {number} [p.capWrites] سقف محاولات الكتابة (حقن للاختبار)
 * @param {number} [p.budgetMs] ميزانية الزمن (حقن للاختبار؛ الافتراضي من SWEEP_PLAN)
 * @return {Promise<{state: string, returned: ?number, candidates: ?number, written: ?number, skipped: ?number, failed: ?number, sweepMs: ?number,
 *   readError: ?{className: string, code: *}}>} الأعداد null = NOT_RUN. لا ترمي إلا لنداء غير مُدرَج (خطأ برمجة).
 */
async function sweepExpiredSessions({db, FieldValue, from, uid, excludeSessionId = null, nowFn = Date.now, capWrites = SWEEP_WRITE_CAP, budgetMs}) {
  const plan = SWEEP_PLAN[from];
  if (!plan) throw new Error(`sweepExpiredSessions: نداء غير مُدرَج: ${String(from)}`);
  const budget = budgetMs === undefined ? plan.budgetMs : budgetMs;

  if (typeof uid !== "string" || uid === "") {
    return {state: SWEEP_STATE.NOT_RUN_NO_KEY, ...emptyCounts(), sweepMs: null, readError: null};
  }

  const t0 = nowFn();
  const readFailed = (e) => ({state: SWEEP_STATE.READ_FAILED, ...emptyCounts(), sweepMs: nowFn() - t0, readError: {className: errorClassName(e), code: errorCode(e)}});

  // ٢ — استعلامان بمساواة لا غير. القراءة تحت الميزانية: فشل أيّ منهما يوقف الكنس كلّه بلا كتابة (لا كنس جزئي مجهول الحدّ).
  let settled;
  try {
    const reads = ACTIVE_SESSION_STATUSES.map((status) => db.collection(SESSIONS_COLLECTION)
        .where(plan.keyField, "==", uid)
        .where("status", "==", status)
        .get());
    settled = await withinBudget(Promise.allSettled(reads), budget - (nowFn() - t0));
  } catch (e) {
    return readFailed(e);
  }
  const rejected = settled.find((s) => s.status === "rejected");
  if (rejected) return readFailed(rejected.reason);

  // ٣ — المرشَّحة. returned = ما أعاده الاستعلامان؛ الباقي بعد الحكم واستثناء المُشغِّلة = candidates.
  let returned = 0;
  const candidates = [];
  for (const s of settled) {
    for (const doc of s.value.docs) {
      returned++;
      const data = doc.data();
      if (doc.id === excludeSessionId) continue; // الجلسة المُشغِّلة
      if (!data || data[plan.keyField] !== uid) continue; // جلسة فاعل آخر لا تُمسّ ولو أخطأ الاستعلام (دفاع في العمق)
      if (!isDueForExpiredRecord(data, new Date(nowFn()))) continue; // صالحة، أو بلا expiresAt/تالفه، أو نهائية، أو حالة مجهولة
      candidates.push({id: doc.id, ref: doc.ref, expiresMs: toDateOrNull(data.expiresAt).getTime()});
    }
  }
  // ترتيب حتمي في الذاكرة (لا orderBy في الاستعلام: لا فهرس): الأقدم انقضاءً أوّلاً ثم بالمعرّف، فيكون ما يتأخّر عن السقف هو الأحدث انقضاءً.
  candidates.sort((a, b) => (a.expiresMs - b.expiresMs) || (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)));

  let written = 0;
  let skipped = 0;
  let failed = 0;
  let state = SWEEP_STATE.COMPLETED;
  // E32: قفل الجلسة يُقرأ داخل معاملة الكتابة نفسها (مساواة على sessionId بلا فهرس، كما cancelScanSession) فلا تُكتب «منتهية» تحت تحليل بدأ بين الفحص والكتابة.
  const guard = async ({tx, sessionRef, now}) => {
    const claims = await tx.get(db.collection(CLAIMS_COLLECTION).where("sessionId", "==", sessionRef.id));
    return claimsBlockingExpiry(claims.docs.map((c) => c.data()), now.getTime());
  };
  for (const c of candidates) {
    if (written + failed >= capWrites) { state = SWEEP_STATE.CAPPED; break; }
    if (nowFn() - t0 >= budget) { state = SWEEP_STATE.BUDGET_EXHAUSTED; break; }
    try {
      const r = await recordSessionExpiredIfDue({
        db, FieldValue, sessionRef: c.ref, now: new Date(nowFn()), source: `sweepExpiredSessions:${from}`, guard,
      });
      if (r.written) {
        written++;
      } else {
        skipped++;
        console.log(`${LOG_PREFIX} skipped from=${from} session=${hashIdForLog(c.id)} reason=${r.skipReason || SWEEP_SKIP_REASON.NO_LONGER_DUE}`);
      }
    } catch (e) {
      failed++;
      console.error(`${LOG_PREFIX} write FAILED from=${from} session=${hashIdForLog(c.id)} [${errorClassName(e)}] code=${errorCode(e)}`);
    }
  }
  return {state, returned, candidates: candidates.length, written, skipped, failed, sweepMs: nowFn() - t0, readError: null};
}

/**
 * نصّ سطر E34 (دالّة نقيّة).
 * @param {Object} result ناتج sweepExpiredSessions
 * @param {{from: string, uid: *, totalMs: number}} ctx
 * @return {string}
 */
function formatSweepLine(result, {from, uid, totalMs}) {
  const plan = SWEEP_PLAN[from];
  const num = (v) => (v === null ? SWEEP_NOT_RUN : String(v));
  let line = `${LOG_PREFIX} swept from=${from} key=${plan.keyField} keyId=${hashIdForLog(uid)} state=${result.state} ` +
      `returned=${num(result.returned)} candidates=${num(result.candidates)} written=${num(result.written)} skipped=${num(result.skipped)} ` +
      `failed=${num(result.failed)} sweepMs=${num(result.sweepMs)} totalMs=${totalMs}`;
  if (result.state === SWEEP_STATE.READ_FAILED) line += ` [${result.readError.className}] code=${result.readError.code}`;
  return line;
}

/**
 * يكنس ويكتب سطر E34 — **لا يرمي أبداً** (أفضل جهد: فشل الكنس لا يغيّر ردّ النداء). يُستدعى في نقطة واحدة من كل نداء، آخر ما قبل الإرجاع.
 * @param {Object} p نفس sweepExpiredSessions، ومعها:
 * @param {number} p.callStartMs بدء النداء كلّه (Date.now() أوّل الدالّة): منه totalMs
 * @return {Promise<?Object>} ناتج الكنس، أو null إن فشل ما هو غير متوقَّع (يُسجَّل سطر مسمّى بدل سطر E34)
 */
async function sweepAndLog(p) {
  const nowFn = p.nowFn || Date.now;
  try {
    const result = await sweepExpiredSessions(p);
    const line = formatSweepLine(result, {from: p.from, uid: p.uid, totalMs: nowFn() - p.callStartMs});
    if (result.state === SWEEP_STATE.READ_FAILED) console.error(line);
    else if (result.state === SWEEP_STATE.BUDGET_EXHAUSTED) console.warn(line);
    else console.log(line);
    return result;
  } catch (e) {
    console.error(`${LOG_PREFIX} FAILED unexpectedly from=${String(p.from)} [${errorClassName(e)}] code=${errorCode(e)}`);
    return null;
  }
}

module.exports = {
  SWEEP_WRITE_CAP,
  SWEEP_PLAN,
  SweepReadBudgetExhaustedError,
  sweepExpiredSessions,
  formatSweepLine,
  sweepAndLog,
};
