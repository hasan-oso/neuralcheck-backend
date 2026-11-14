"use strict";

// ===================================================
// sessionCompletion — كتابة «اكتملت» على جلسة الفحص: شرط الحالة، ومحاولات محدودة، وفشل مسمّى لا مبتلَع (S-SWEEP، 2026-10-15 +03)
// ===================================================
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-د (مسارا الاكتمال). قرار المستخدم (E26، 2026-10-15، منقول): «The completed write is retried a bounded number of times. A final failure is
// logged with a named line, never swallowed. The write happens only while the session is still scanning, so it cannot overwrite cancelled or expired. The cached-response path
// (analyzeDevice.js:431-439) marks the session completed the same way before returning. The caller's answer is unchanged».
// وأصله (SD:15، منقول): الردّ المخزَّن قبل كتابة الاكتمال، وفشل كتابة الاكتمال المبتلَع — «فلا يُبتلع بعد اليوم، بل يُسجَّل ويُعاد. مع اختبارات.»
//
// ما كان قبل هذا الملفّ (analyzeDevice.js عند 310c14a:793-805): `.update` مباشر بلا شرط حالة، وفشله يُبتلَع بسطر `console.error("Failed to update session", …)` بلا إعادة. فتقرير محفوظ
// بلا اكتمال كان يترك الجلسة scanning حتى يمسّها وقتٌ فتُسجَّل «منتهية» وفيها تقرير؛ وكتابة بلا شرط كانت تطمس cancelled أو expired.
//
// ─── ما يفعله ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   معاملة واحدة لكل محاولة: تقرأ الجلسة، **وتكتب completed فقط إن كانت scanning**؛ غيرها لا يُكتب ويُسجَّل `completed-skipped` (لا محاولة جديدة على التخطّي: التخطّي ليس فشلاً).
//   المسار ب (ردّ مخزَّن) يزيد **حارس E35**: يُكتب فقط إن كان userId في التقرير المخزَّن = ownerId الجلسة (القراءة الطازجة داخل المعاملة)؛ وإلّا `completed-skipped reason=report_owner_mismatch`.
//   فشل الكتابة (المعاملة ترمي): تُعاد حتى COMPLETION_MAX_ATTEMPTS مرّات بفاصل COMPLETION_RETRY_DELAYS_MS (200 ثم 400 مل ث؛ معتمد 2026-10-15). بعد الأخيرة سطر `FAILED` مسمّى
//   برمز الخطأ واسم الصنف وعدد المحاولات وحدها (القاعدة 36)، **لا ابتلاع صامت ولا رمي**: الردّ للمستدعي لا يتغيّر (`[ق]`) فلا يرمي هذا الملفّ أبداً.
//   لا تُطمَس cancelled ولا expired. لا حذف (القاعدة 42): كتابة حالة وحقول فقط.
//
// ─── سطور السجلّ (المعرّف مُهشَّر hashIdForLog؛ لا sessionId ولا uid خامّ) ─────────────────────────────────────────────────
//   [sessionCompletion] completed path=<fresh-scan|cached-response> session=<#> attempts=<n>[ absentFields=<a,b>]
//   [sessionCompletion] completed-skipped status=<الحالة> path=<…> session=<#>                       (الجلسة ليست scanning: الحالة، أو ABSENT/NOT_A_STRING/UNRECOGNIZED لغير المعروفة)
//   [sessionCompletion] completed-skipped reason=<session_missing|report_owner_mismatch> path=<…> session=<#>[ ownerCheck=<…>]
//   [sessionCompletion] completed-write attempt failed path=<…> session=<#> attempt=<i>/<max> [<ClassName>] code=<code|NO_CODE>
//   [sessionCompletion] completed-write FAILED path=<…> session=<#> attempts=<n> [<ClassName>] code=<code|NO_CODE>

const {hashIdForLog} = require("../utils/logRedaction");
const {
  SESSION_STATUS, COMPLETION_SKIP, OWNER_CHECK_STATE,
} = require("./sessionNames");
const {classifyStatus} = require("./sessionLifecycle");

const LOG_PREFIX = "[sessionCompletion]";

/** عدد محاولات كتابة «اكتملت» (E26 قرّر «عدداً محدوداً»؛ سمّاه المنسّق 3 بإذن المستخدم، 2026-10-15). */
const COMPLETION_MAX_ATTEMPTS = 3;
/** الفاصل قبل المحاولة الثانية ثم الثالثة، بالمللي ثانية (200 ثم 400؛ معتمد 2026-10-15). طوله = COMPLETION_MAX_ATTEMPTS − 1. */
const COMPLETION_RETRY_DELAYS_MS = Object.freeze([200, 400]);

/** نتيجة إتمام الكتابة (تُعاد ولا تُرمى). */
const COMPLETION_OUTCOME = Object.freeze({
  WRITTEN: "WRITTEN",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
});

const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const errorClassName = (e) => (e && e.constructor && e.constructor.name) || typeof e;
const errorCode = (e) => ((e && e.code !== undefined) ? e.code : "NO_CODE");
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * حارس الملكية E35 (دالّة نقيّة). الغياب لا يُقرأ هويةً (القاعدة 22): غياب أيّ الطرفين حالة صريحة لا تطابق.
 * @param {*} sessionOwnerId ownerId في مستند الجلسة (القراءة الطازجة)
 * @param {*} reportUserId userId في التقرير المخزَّن
 * @return {string} من OWNER_CHECK_STATE
 */
function ownerCheckState(sessionOwnerId, reportUserId) {
  if (!isNonEmptyString(reportUserId)) return OWNER_CHECK_STATE.REPORT_USER_ABSENT;
  if (!isNonEmptyString(sessionOwnerId)) return OWNER_CHECK_STATE.SESSION_OWNER_ABSENT;
  return reportUserId === sessionOwnerId ? OWNER_CHECK_STATE.MATCH : OWNER_CHECK_STATE.MISMATCH;
}

/**
 * حقول المسار ب من مستند التقرير المخزَّن (§٦-د): scanId دائماً (معرّف التقرير نفسه)، وshortId وdeviceModel من المستند إن كانا نصّاً غير فارغ.
 * **الغائب يبقى غائباً** (القاعدة 22): لا «Unknown» ولا null ولا undefined مكتوبة — المفتاح لا يُكتب فيبقى ما كان على الجلسة، ويُسمّى في absentFields.
 * مصدر deviceModel: `reports/{scanId}.deviceModel` (analyzeDevice.js buildReportDocument ⟵ rawDeviceModel)؛ والمسار أ يكتب `fingerprint.device?.model || "Unknown"`.
 * @param {{scanId: string, reportData: ?Object}} p
 * @return {{fields: Object, absentFields: string[]}}
 */
function cachedCompletionFields({scanId, reportData}) {
  const fields = {scanId};
  const absentFields = [];
  for (const key of ["shortId", "deviceModel"]) {
    const v = reportData ? reportData[key] : undefined;
    if (isNonEmptyString(v)) fields[key] = v;
    else absentFields.push(key);
  }
  return {fields, absentFields};
}

/**
 * محاولة واحدة: معاملة تقرأ الجلسة وتكتب «اكتملت» إن كانت scanning (وإن مرّ حارس E35). تُرجِع قراراً ولا ترمي بسببه (الرمي = فشل كتابة يُعاد).
 */
async function attemptOnce({db, FieldValue, sessionRef, fields, ownerGuard}) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) return {outcome: COMPLETION_OUTCOME.SKIPPED, skip: COMPLETION_SKIP.SESSION_MISSING};
    const data = snap.data();
    const {state, status} = classifyStatus(data);
    if (status !== SESSION_STATUS.SCANNING) {
      return {outcome: COMPLETION_OUTCOME.SKIPPED, skip: COMPLETION_SKIP.NOT_SCANNING, statusToken: status === null ? state : status};
    }
    if (ownerGuard) {
      const ownerCheck = ownerCheckState(data.ownerId, ownerGuard.reportUserId);
      if (ownerCheck !== OWNER_CHECK_STATE.MATCH) {
        return {outcome: COMPLETION_OUTCOME.SKIPPED, skip: COMPLETION_SKIP.REPORT_OWNER_MISMATCH, ownerCheck};
      }
    }
    // الحقول بترتيبها السابق (status، ثم scanId وshortId وdeviceModel، ثم completedAt) كما كتبتها analyzeDevice قبل هذا الملفّ.
    tx.update(sessionRef, {status: SESSION_STATUS.COMPLETED, ...fields, completedAt: FieldValue.serverTimestamp()});
    return {outcome: COMPLETION_OUTCOME.WRITTEN};
  });
}

/**
 * يكتب «اكتملت» على الجلسة بالشروط والمحاولات أعلاه. **لا يرمي أبداً.**
 * @param {Object} p
 * @param {Object} p.db Firestore
 * @param {Object} p.FieldValue admin.firestore.FieldValue
 * @param {Object} p.sessionRef مرجع scanSessions/{id}
 * @param {string} p.path من COMPLETION_PATH
 * @param {Object} p.fields الحقول المكتوبة مع status وcompletedAt (scanId وshortId وdeviceModel)
 * @param {?{reportUserId: *}} [p.ownerGuard] حارس E35 للمسار ب؛ الحقل مطلوب الوجود (reportUserId الغائب = حالة صريحة لا إعفاء)، وnull/غائب للمسار أ
 * @param {string[]} [p.absentFields] أسماء حقول غابت من المصدر (للسجلّ)
 * @param {Function} [p.sleep] (ms) ⟵ Promise، حقن للاختبار
 * @return {Promise<{outcome: string, attempts: number, skip?: string}>}
 */
async function completeSessionBestEffort({db, FieldValue, sessionRef, path, fields, ownerGuard = null, absentFields = [], sleep = defaultSleep}) {
  const sid = hashIdForLog(sessionRef && sessionRef.id);
  let lastError = null;
  for (let attempt = 1; attempt <= COMPLETION_MAX_ATTEMPTS; attempt++) {
    let r;
    try {
      r = await attemptOnce({db, FieldValue, sessionRef, fields, ownerGuard});
    } catch (e) {
      lastError = e;
      if (attempt < COMPLETION_MAX_ATTEMPTS) {
        console.warn(`${LOG_PREFIX} completed-write attempt failed path=${path} session=${sid} attempt=${attempt}/${COMPLETION_MAX_ATTEMPTS} ` +
            `[${errorClassName(e)}] code=${errorCode(e)}`);
        await sleep(COMPLETION_RETRY_DELAYS_MS[attempt - 1]);
      }
      continue;
    }
    if (r.outcome === COMPLETION_OUTCOME.WRITTEN) {
      console.log(`${LOG_PREFIX} completed path=${path} session=${sid} attempts=${attempt}` + (absentFields.length > 0 ? ` absentFields=${absentFields.join(",")}` : ""));
      return {outcome: COMPLETION_OUTCOME.WRITTEN, attempts: attempt};
    }
    // تخطٍّ: ليس فشلاً — لا محاولة جديدة.
    if (r.skip === COMPLETION_SKIP.NOT_SCANNING) {
      console.log(`${LOG_PREFIX} completed-skipped status=${r.statusToken} path=${path} session=${sid}`);
    } else {
      console.log(`${LOG_PREFIX} completed-skipped reason=${r.skip} path=${path} session=${sid}` + (r.ownerCheck ? ` ownerCheck=${r.ownerCheck}` : ""));
    }
    return {outcome: COMPLETION_OUTCOME.SKIPPED, attempts: attempt, skip: r.skip};
  }
  console.error(`${LOG_PREFIX} completed-write FAILED path=${path} session=${sid} attempts=${COMPLETION_MAX_ATTEMPTS} ` +
      `[${errorClassName(lastError)}] code=${errorCode(lastError)}`);
  return {outcome: COMPLETION_OUTCOME.FAILED, attempts: COMPLETION_MAX_ATTEMPTS};
}

module.exports = {
  COMPLETION_MAX_ATTEMPTS,
  COMPLETION_RETRY_DELAYS_MS,
  COMPLETION_OUTCOME,
  ownerCheckState,
  cachedCompletionFields,
  completeSessionBestEffort,
};
