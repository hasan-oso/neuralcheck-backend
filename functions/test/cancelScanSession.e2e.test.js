// E2E test: cancelScanSession — إلغاء جلسة الفحص أو مغادرتها (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03).
// المعالجات الحقيقية عبر `.run()` على محاكي Firestore: createScanSession وjoinScanSession وcancelScanSession وanalyzeDevice وsubmitEvaluation وreserveScanCredit —
// لا يُستبدَل إلا نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) — القاعدة 37.
//
// خطّة PLAN-05 (PLAN-05-EVIDENCE-REPORT.md:529، بنصّها منقولاً من أمر المنسّق): «إلغاء أو مغادرة جلسة (callable جديدة في الخادم + زرّ).»
// قرار المستخدم (2026-10-10، بنصّه): «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى، بلا حذف (القاعدة 42)، ويُعاد الحجز المعلّق
// مرّة واحدة بالآلية القائمة. واختبار للإلغاء المزدوج، وللإلغاء بعد الاكتمال (يُرفض).»
// أمر المنسّق: الإلغاء قبل الانضمام وبعده · الإلغاء المزدوج (لا إعادة ثانية) · الإلغاء بعد completed (يُرفض) · إلغاء من غير المالك وغير المنضمّ (يُرفض) ·
// حجز بلا تقرير يُعاد مرّة واحدة · الانتهاء يُكتب عند المسّ.
//
// الأقسام:
//   ١ المالك قبل الانضمام  ٢ المنضمّ والمالك بعد الانضمام (الأسباب الثلاثة)  ٣ الرفض: الدور/السبب/الهوية/الحالات  ٤ بعد completed (تدفّق حقيقي كامل)
//   ٥ الإلغاء المزدوج  ٦ الحجز المعلّق (تعاد مرّة واحدة؛ تقرير؛ مجاني؛ ما لا يُعاد)  ٧ تحليل يجري (قفل حديث، عمره مجهول، حدّ TTL)
//   ٨ الانتهاء عند المسّ  ٩ بعد الإلغاء لا عمل (analyzeDevice وsubmitEvaluation)  ١٠ سباق إلغاءين  ١١ السجلّ  ١٢ لا حذف
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/cancelScanSession.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد، معدودٌ وقابلٌ للحجز (gate) كي يبقى تحليل «جارياً».
let modelCalls = 0;
let gate = null;
const newGate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return {promise, release};
};
// القاعدة 9 (صفر طلب شبكة نحو مزوّد نموذج): fetch لا يردّ إلا لعنوان DeepSeek (كعب بلا شبكة)، وأيّ عنوان آخر يُرمى؛ ووحدة Gemini مستبدَلة بكعب يفشل — فلو رُفض
// ردّ DeepSeek المحاكى لوقع الفشل داخل الاختبار لا نداءٌ حقيقي بمفتاح وهمي.
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => { throw new Error("stub gemini fail"); }};
    }
  }},
};
global.fetch = async (url) => {
  if (!/deepseek/i.test(String(url))) throw new Error("unexpected network call blocked by the test: " + String(url).slice(0, 40));
  modelCalls++;
  if (gate) await gate.promise;
  return deepSeekHttpResponse(validV7ModelResponse());
};

const {admin, db} = require("../src/utils/admin");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {cancelScanSession} = require("../src/sessions/cancelScanSession");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {reserveScanCredit, SCAN_CLAIM_TTL_MS} = require("../src/analysis/scanReservation");
const {CANCEL_REASON: CR, CANCEL_REFUSAL: R} = require("../src/sessions/sessionNames");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const FieldValue = admin.firestore.FieldValue;
const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
};
const FUTURE = () => new Date(Date.now() + 30 * 60 * 1000);
const PAST = () => new Date(Date.now() - 30 * 60 * 1000);
const authOwner = (uid) => ({uid, token: {}});
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});
const run = (fn, data, auth) => fn.run({data, auth, rawRequest: {headers: {}}});

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
/** يشغّل نداءً ويلتقط ما يكتبه في console، ويعيد {ret, threw, lines}. */
async function call(fn, data, auth) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await run(fn, data, auth);
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines};
}
const cancel = (data, auth) => call(cancelScanSession, data, auth);
const sessionData = async (id) => (await db.collection("scanSessions").doc(id).get()).data();
const sessionDoc = async (id) => db.collection("scanSessions").doc(id).get();
const claimData = async (id) => (await db.collection("scanClaims").doc(id).get()).data();
const userData = async (uid) => (await db.collection("users").doc(uid).get()).data();
const credit = async (uid) => (await userData(uid)).scansRemaining;
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists;
const seedOwner = (uid, fields = {}) => db.collection("users").doc(uid).set({
  scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 20 * 24 * 3600 * 1000), ...fields,
});
const cancelLines = (lines, kind) => lines.filter((l) => l.startsWith(`[cancelScanSession] ${kind}`));
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** جلسة حقيقية: createScanSession ثم (اختيارياً) joinScanSession بجهاز الزبون. */
async function newSession(owner, {joiner = null, joinAuth = undefined} = {}) {
  const created = await run(createScanSession, {}, authOwner(owner));
  let joined = null;
  if (joiner !== null || joinAuth === null) {
    joined = await run(joinScanSession, {code: created.code}, joinAuth === null ? null : authAnon(joiner));
  }
  return {sessionId: created.sessionId, code: created.code, joined};
}
/** حجز معلَّق حقيقي: reserveScanCredit على قفل يحمل sessionId (يخصم من المالك) ثم يُقدَّم عمر القفل. */
async function seedReservation({scanId, owner, sessionId = null, ageMs, deviceFP = "TestPhone_14_8"}) {
  const claimRef = db.collection("scanClaims").doc(scanId);
  await claimRef.set({scanId, userId: owner, claimedAtMs: Date.now() - ageMs, reservation: null, ...(sessionId ? {sessionId} : {})});
  await reserveScanCredit({db, FieldValue, userId: owner, deviceFP, claimRef, nowMs: Date.now() - ageMs, isSessionScan: sessionId !== null});
  return claimRef;
}
const expectRefusal = (res, code, reasonCode, label) => {
  ok(res.threw !== null && res.ret === null, `${label}: رُفض`);
  eq(res.threw.code, code, `${label}: رمز HttpsError ${code}`);
  deq(res.threw.details, {reasonCode}, `${label}: details = {reasonCode: ${reasonCode}} وحده`);
};
const refusedReason = (res) => {
  const l = cancelLines(res.lines, "refused");
  eq(l.length, 1, "سطر رفض واحد في السجلّ");
  return (l[0].match(/ reason=(\S+)/) || [])[1];
};

(async () => {
  const OWNER = "own-cancel-0001";
  const JOINER = "anon-joiner-0001";
  const STRANGER = "anon-stranger-0001";
  await seedOwner(OWNER, {scansRemaining: 50, scansTotal: 50, evaluationEnabled: false});
  const allSessions = [];
  const allClaims = [];

  // ═══ ١ — المالك يُلغي قبل الانضمام ═══
  {
    const s = await newSession(OWNER);
    allSessions.push(s.sessionId);
    const before = await sessionData(s.sessionId);
    eq(before.status, "pending", "[١] الجلسة pending قبل الإلغاء");
    const stranger = await cancel({sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authAnon(STRANGER));
    expectRefusal(stranger, "permission-denied", R.NOT_PARTICIPANT, "[١] غريب قبل الانضمام");
    eq((await sessionData(s.sessionId)).status, "pending", "[١] والجلسة تبقى pending بعد رفض الغريب");
    const res = await cancel({sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    ok(res.threw === null, "[١] المالك يُلغي pending");
    deq(res.ret, {sessionId: s.sessionId, status: "cancelled", alreadyCancelled: false}, "[١] الردّ: sessionId وstatus وalreadyCancelled وحدها (لا رصيد في الردّ)");
    const after = await sessionData(s.sessionId);
    eq(after.status, "cancelled", "[١] status=cancelled");
    eq(after.cancelReason, "cancelled_by_owner", "[١] cancelReason=cancelled_by_owner");
    ok(after.cancelledAt && typeof after.cancelledAt.toMillis === "function" && Math.abs(after.cancelledAt.toMillis() - Date.now()) < 60000, "[١] cancelledAt Timestamp حديث");
    for (const k of ["code", "ownerId", "createdAt", "expiresAt", "scanId", "deviceModel"]) {
      const norm = (v) => (v === undefined || v === null ? null : (typeof v.toMillis === "function" ? v.toMillis() : v));
      deq(norm(after[k]), norm(before[k]), `[١] الحقل ${k} لم يتغيّر`);
    }
    ok(!("joinedBy" in after) && !("completedAt" in after), "[١] ولا joinedBy ولا completedAt");
    ok((await sessionDoc(s.sessionId)).exists, "[١] مستند الجلسة موجود (لا حذف)");
    const logs = cancelLines(res.lines, "cancelled");
    eq(logs.length, 1, "[١] سطر cancelled واحد");
    eq(logs[0], `[cancelScanSession] cancelled session=${hashIdForLog(s.sessionId)} caller=${hashIdForLog(OWNER)} owner=${hashIdForLog(OWNER)} role=owner reason=cancelled_by_owner alreadyCancelled=false claims=0 released=0 noReservation=0 hasReport=0 malformed=0 inFlightSkipped=0 ageUnknownSkipped=0 releaseFailed=0`, "[١] نصّ السطر كاملاً: معرّفات مُهشَّرة وأعداد");
    // من يحاول الانضمام بعدها يرى «ملغاة» (التكامل مع joinScanSession)
    const late = await call(joinScanSession, {code: s.code}, authAnon(JOINER));
    ok(late.threw && late.threw.details && late.threw.details.reasonCode === "SESSION_CANCELLED", "[١] ومن ينضمّ بعدها يتلقّى SESSION_CANCELLED");
  }

  // ═══ ٢ — بعد الانضمام: المنضمّ والمالك، والأسباب الثلاثة ═══
  for (const [label, who, reason] of [
    ["المنضمّ يرفض الموافقة", "joiner", CR.CONSENT_DECLINED],
    ["المنضمّ يغادر", "joiner", CR.LEFT_BY_CUSTOMER],
    ["المالك يُلغي بعد الانضمام", "owner", CR.CANCELLED_BY_OWNER],
  ]) {
    const joiner = `anon-joiner-${reason}`;
    const s = await newSession(OWNER, {joiner});
    allSessions.push(s.sessionId);
    eq((await sessionData(s.sessionId)).status, "scanning", `[٢] ${label}: الجلسة scanning قبل الإلغاء`);
    eq((await sessionData(s.sessionId)).joinedBy, joiner, `[٢] ${label}: joinedBy = معرّف الجهاز المنضمّ`);
    const auth = who === "joiner" ? authAnon(joiner) : authOwner(OWNER);
    const res = await cancel({sessionId: s.sessionId, reason}, auth);
    ok(res.threw === null, `[٢] ${label}: نجح`);
    deq(res.ret, {sessionId: s.sessionId, status: "cancelled", alreadyCancelled: false}, `[٢] ${label}: الردّ`);
    const after = await sessionData(s.sessionId);
    deq([after.status, after.cancelReason, after.joinedBy], ["cancelled", reason, joiner], `[٢] ${label}: status وcancelReason (${reason}) وjoinedBy باقٍ`);
    ok(/role=(owner|joiner) reason=/.test(cancelLines(res.lines, "cancelled")[0]) && cancelLines(res.lines, "cancelled")[0].includes(`role=${who} reason=${reason}`), `[٢] ${label}: السجلّ بدوره وسببه`);
  }

  // ═══ ٣ — الرفض: الهوية والدور والسبب والحالات ═══
  {
    const s = await newSession(OWNER, {joiner: JOINER});
    allSessions.push(s.sessionId);
    const sid = s.sessionId;
    const unchanged = async (label) => eq((await sessionData(sid)).status, "scanning", `[٣] ${label}: الجلسة تبقى scanning`);

    let r = await cancel({sessionId: sid, reason: CR.CANCELLED_BY_OWNER}, null);
    expectRefusal(r, "unauthenticated", R.NOT_AUTHENTICATED, "[٣] بلا auth");
    eq(r.threw.message, "يجب تسجيل الدخول", "[٣] بلا auth: النصّ القائم لتسجيل الدخول (createScanSession)");
    eq(refusedReason(r), R.NOT_AUTHENTICATED, "[٣] بلا auth: السبب في السجلّ");
    await unchanged("بلا auth");

    r = await cancel({sessionId: sid, reason: CR.CANCELLED_BY_OWNER}, {uid: "", token: {}});
    expectRefusal(r, "unauthenticated", R.NOT_AUTHENTICATED, "[٣] uid فارغ");

    r = await cancel({reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.SESSION_ID_REQUIRED, "[٣] بلا sessionId");
    r = await cancel({sessionId: "   ", reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.SESSION_ID_REQUIRED, "[٣] sessionId فراغ");
    r = await cancel({sessionId: 12345, reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.SESSION_ID_REQUIRED, "[٣] sessionId ليس نصّاً");

    r = await cancel({sessionId: sid}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.REASON_REQUIRED, "[٣] بلا reason (لا قيمة افتراضية)");
    r = await cancel({sessionId: sid, reason: null}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.REASON_REQUIRED, "[٣] reason null");
    r = await cancel({sessionId: sid, reason: ""}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.REASON_REQUIRED, "[٣] reason فارغ");
    for (const bad of ["Cancelled_By_Owner", "cancel", "timeout", 7, {a: 1}, ["left_by_customer"]]) {
      r = await cancel({sessionId: sid, reason: bad}, authOwner(OWNER));
      expectRefusal(r, "invalid-argument", R.REASON_INVALID, `[٣] reason خارج المفردات (${JSON.stringify(bad)})`);
    }

    r = await cancel({sessionId: sid, reason: CR.CANCELLED_BY_OWNER}, authAnon(STRANGER));
    expectRefusal(r, "permission-denied", R.NOT_PARTICIPANT, "[٣] غير المالك وغير المنضمّ");
    eq(r.threw.message, "جلسة الفحص غير صالحة", "[٣] والنصّ القائم «جلسة الفحص غير صالحة»");
    eq(refusedReason(r), R.NOT_PARTICIPANT, "[٣] السبب في السجلّ NOT_PARTICIPANT");
    ok(/ joinedBy=other-uid$/.test(cancelLines(r.lines, "refused")[0]), "[٣] وحالة joinedBy في السجلّ (other-uid)");
    for (const reason of Object.values(CR)) {
      r = await cancel({sessionId: sid, reason}, authAnon(STRANGER));
      expectRefusal(r, "permission-denied", R.NOT_PARTICIPANT, `[٣] الغريب بسبب ${reason}`);
    }
    await unchanged("الغريب");

    // أسباب لا تناسب الدور
    r = await cancel({sessionId: sid, reason: CR.CONSENT_DECLINED}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.REASON_NOT_ALLOWED_FOR_ROLE, "[٣] المالك يدّعي consent_declined");
    r = await cancel({sessionId: sid, reason: CR.LEFT_BY_CUSTOMER}, authOwner(OWNER));
    expectRefusal(r, "invalid-argument", R.REASON_NOT_ALLOWED_FOR_ROLE, "[٣] المالك يدّعي left_by_customer");
    r = await cancel({sessionId: sid, reason: CR.CANCELLED_BY_OWNER}, authAnon(JOINER));
    expectRefusal(r, "invalid-argument", R.REASON_NOT_ALLOWED_FOR_ROLE, "[٣] المنضمّ يدّعي cancelled_by_owner");
    ok(/ role=joiner reason=cancelled_by_owner$/.test(cancelLines(r.lines, "refused")[0]), "[٣] والسجلّ بالدور والسبب");
    await unchanged("الأسباب غير المناسبة");

    // جلسة غير موجودة: الردّ نفسه الذي لغير المشارك (لا يُكشف وجود جلسة) والسجلّ يفرّق
    r = await cancel({sessionId: "no-such-session-id-xyz", reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    expectRefusal(r, "permission-denied", R.NOT_PARTICIPANT, "[٣] جلسة غير موجودة: details = NOT_PARTICIPANT نفسه (لا كشف وجود)");
    eq(r.threw.message, "جلسة الفحص غير صالحة", "[٣] وبالنصّ نفسه");
    eq(refusedReason(r), R.SESSION_NOT_FOUND, "[٣] والسجلّ يقول SESSION_NOT_FOUND");
    ok(!(await exists("scanSessions", "no-such-session-id-xyz")), "[٣] ولا مستند أُنشئ للجلسة غير الموجودة");

    // انضمّ بلا هوية: joinedBy=null — لا يُطابَق أحد (لا null == null)، والمالك وحده يُلغي
    const anon = await newSession(OWNER, {joinAuth: null});
    allSessions.push(anon.sessionId);
    eq((await sessionData(anon.sessionId)).joinedBy, null, "[٣] انضمّ بلا هوية: joinedBy=null");
    r = await cancel({sessionId: anon.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(STRANGER));
    expectRefusal(r, "permission-denied", R.NOT_PARTICIPANT, "[٣] جهاز انضمّ بلا هوية لا يُعرَف منضمّاً (قيد معروف)");
    ok(/ joinedBy=null$/.test(cancelLines(r.lines, "refused")[0]), "[٣] والسجلّ يسمّي joinedBy=null");
    r = await cancel({sessionId: anon.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
    ok(r.threw === null && r.ret.status === "cancelled", "[٣] والمالك يُلغيها");

    // حالات المستند الشاذّة: لا كتابة
    for (const [label, fields, reasonCode, code] of [
      ["حالة غائبة", {}, R.STATUS_UNKNOWN, "failed-precondition"],
      ["حالة لا تعرفها الشيفرة", {status: "done"}, R.STATUS_UNKNOWN, "failed-precondition"],
      ["حالة ليست نصّاً", {status: 5}, R.STATUS_UNKNOWN, "failed-precondition"],
      ["scanning بلا expiresAt", {status: "scanning"}, R.EXPIRES_AT_INVALID, "permission-denied"],
      ["pending بـexpiresAt تالف", {status: "pending", expiresAt: "garbage"}, R.EXPIRES_AT_INVALID, "permission-denied"],
    ]) {
      const id = `weird-${label.replace(/\s/g, "_")}`;
      await db.collection("scanSessions").doc(id).set({ownerId: OWNER, code: "NC-WEIRD", ...fields});
      allSessions.push(id);
      const before = await sessionData(id);
      const w = await cancel({sessionId: id, reason: CR.CANCELLED_BY_OWNER}, authOwner(OWNER));
      expectRefusal(w, code, reasonCode, `[٣] ${label}`);
      deq(await sessionData(id), before, `[٣] ${label}: المستند لم يتغيّر`);
    }
  }

  // ═══ ٤ — بعد completed (تدفّق حقيقي كامل: إنشاء ← انضمام ← تحليل) ═══
  {
    const owner = "own-completed-0001";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner: "anon-completed-joiner"});
    allSessions.push(s.sessionId);
    modelCalls = 0;
    const analysis = await call(analyzeDevice, {scanId: "scan-completed-1", fingerprint: FINGERPRINT, sessionId: s.sessionId}, authAnon("anon-completed-joiner"));
    ok(analysis.threw === null, "[٤] التحليل الحقيقي نجح");
    const done = await sessionData(s.sessionId);
    deq([done.status, done.scanId], ["completed", "scan-completed-1"], "[٤] الجلسة completed بـscanId");
    eq(await credit(owner), 4, "[٤] والرصيد 5 → 4 (فحصة مستهلَكة)");
    ok(await exists("reports", "scan-completed-1"), "[٤] والتقرير محفوظ");
    const before = await sessionDoc(s.sessionId);
    for (const [who, auth, reason] of [["المالك", authOwner(owner), CR.CANCELLED_BY_OWNER], ["المنضمّ", authAnon("anon-completed-joiner"), CR.LEFT_BY_CUSTOMER]]) {
      const r = await cancel({sessionId: s.sessionId, reason}, auth);
      expectRefusal(r, "failed-precondition", R.COMPLETED, `[٤] ${who} يُلغي بعد completed`);
      eq(r.threw.message, R.COMPLETED, `[٤] ${who}: الرسالة رمزٌ تقنيّ لا نصّاً عربياً جديداً`);
      eq(refusedReason(r), R.COMPLETED, `[٤] ${who}: السبب في السجلّ`);
    }
    const after = await sessionDoc(s.sessionId);
    deq(after.data(), before.data(), "[٤] مستند الجلسة لم يتغيّر");
    eq(after.updateTime.toMillis(), before.updateTime.toMillis(), "[٤] ولا كتابة (updateTime نفسه)");
    eq(await credit(owner), 4, "[٤] والرصيد لم يُعَد (الفحص اكتمل بحقّ)");
    ok(await exists("reports", "scan-completed-1"), "[٤] والتقرير باقٍ");
    // غريب على completed: يرى NOT_PARTICIPANT لا COMPLETED (لا يُكشف شيء عن جلسة لا يملكها)
    const g = await cancel({sessionId: s.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(STRANGER));
    expectRefusal(g, "permission-denied", R.NOT_PARTICIPANT, "[٤] غريب على completed: NOT_PARTICIPANT");
  }

  // ═══ ٥ — الإلغاء المزدوج ═══
  {
    const owner = "own-double-0001";
    const joiner = "anon-double-joiner";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner});
    allSessions.push(s.sessionId);
    await seedReservation({scanId: "double-1", owner, sessionId: s.sessionId, ageMs: 10 * 60 * 1000});
    allClaims.push("double-1");
    eq(await credit(owner), 4, "[٥] حجز معلّق حقيقي: الرصيد 5 → 4");
    const first = await cancel({sessionId: s.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(joiner));
    ok(first.threw === null && first.ret.alreadyCancelled === false, "[٥] الإلغاء الأوّل (المنضمّ، left_by_customer)");
    eq(await credit(owner), 5, "[٥] وأعاد الحجز: الرصيد 4 → 5");
    eq((await claimData("double-1")).reservation, null, "[٥] والقفل يحمل reservation=null (لا حذف للقفل)");
    ok(/ released=1 /.test(cancelLines(first.lines, "cancelled")[0]), "[٥] وسطر الأوّل released=1");
    const snap1 = await sessionDoc(s.sessionId);

    const second = await cancel({sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    ok(second.threw === null, "[٥] الإلغاء الثاني (المالك) لا يُرفض: نداء متكافئ");
    deq(second.ret, {sessionId: s.sessionId, status: "cancelled", alreadyCancelled: true}, "[٥] ويردّ alreadyCancelled=true");
    eq(await credit(owner), 5, "[٥] **ولا إعادة ثانية**: الرصيد يبقى 5 لا 6");
    const snap2 = await sessionDoc(s.sessionId);
    eq(snap2.data().cancelReason, "left_by_customer", "[٥] وسبب الإلغاء الأوّل يبقى (الثاني لا يكتب فوقه)");
    eq(snap2.updateTime.toMillis(), snap1.updateTime.toMillis(), "[٥] ولا كتابة على مستند الجلسة (updateTime نفسه)");
    ok(/ alreadyCancelled=true /.test(cancelLines(second.lines, "cancelled")[0]) && / released=0 /.test(cancelLines(second.lines, "cancelled")[0]), "[٥] وسطر الثاني alreadyCancelled=true released=0");
    const third = await cancel({sessionId: s.sessionId, reason: CR.CONSENT_DECLINED}, authAnon(joiner));
    ok(third.threw === null && third.ret.alreadyCancelled === true, "[٥] والثالث كذلك");
    eq(await credit(owner), 5, "[٥] والرصيد 5 بعد ثلاثة إلغاءات");
    // الإلغاء الثاني ما زال يتحقّق من الهوية والسبب
    const bad = await cancel({sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authAnon(STRANGER));
    expectRefusal(bad, "permission-denied", R.NOT_PARTICIPANT, "[٥] والغريب يُرفض حتى على ملغاة");
    const bad2 = await cancel({sessionId: s.sessionId, reason: CR.CONSENT_DECLINED}, authOwner(owner));
    expectRefusal(bad2, "invalid-argument", R.REASON_NOT_ALLOWED_FOR_ROLE, "[٥] والسبب غير المناسب للدور يُرفض حتى على ملغاة");
    // شفاء الإلغاء المنقطع: ملغاة (كُتبت) وبقي حجز على قفلها ← النداء الثاني يعيده مرّة واحدة
    const owner2 = "own-heal-0001";
    await seedOwner(owner2, {scansRemaining: 5});
    const h = await newSession(owner2, {joiner: "anon-heal-joiner"});
    allSessions.push(h.sessionId);
    await db.collection("scanSessions").doc(h.sessionId).update({status: "cancelled", cancelledAt: FieldValue.serverTimestamp(), cancelReason: "cancelled_by_owner"}); // كما لو انقطع الإلغاء بعد الكتابة وقبل الإعادة
    await seedReservation({scanId: "heal-1", owner: owner2, sessionId: h.sessionId, ageMs: 20 * 60 * 1000});
    allClaims.push("heal-1");
    eq(await credit(owner2), 4, "[٥] جلسة ملغاة بحجز باقٍ: الرصيد 4");
    const healed = await cancel({sessionId: h.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    ok(healed.threw === null && healed.ret.alreadyCancelled === true, "[٥] الإلغاء الثاني للمنقطعة: alreadyCancelled=true");
    eq(await credit(owner2), 5, "[٥] ويعيد الحجز الباقي (4 → 5)");
    await cancel({sessionId: h.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    eq(await credit(owner2), 5, "[٥] والثالث لا يعيد ثانيةً (5)");
  }

  // ═══ ٦ — الحجز المعلّق: يُعاد مرّة واحدة؛ وما لا يُعاد ═══
  {
    const owner = "own-reserve-0001";
    await seedOwner(owner, {scansRemaining: 10});
    // أ) حجز بلا تقرير يُعاد (والجهاز المجاني — اختبار منفصل أدناه)
    const a = await newSession(owner, {joiner: "anon-reserve-a"});
    allSessions.push(a.sessionId);
    await seedReservation({scanId: "res-a", owner, sessionId: a.sessionId, ageMs: 7 * 60 * 1000});
    allClaims.push("res-a");
    // ب) حجز بتقرير محفوظ: الفحصة مستهلَكة بحقّ فلا تُعاد
    await seedReservation({scanId: "res-b", owner, sessionId: a.sessionId, ageMs: 8 * 60 * 1000});
    allClaims.push("res-b");
    await db.collection("reports").doc("res-b").set({userId: owner, note: "saved report for the consumed reservation"});
    // ج) قفل بلا حجز (reservation: null)
    await db.collection("scanClaims").doc("res-c").set({scanId: "res-c", userId: owner, claimedAtMs: Date.now() - 9 * 60 * 1000, reservation: null, sessionId: a.sessionId});
    allClaims.push("res-c");
    // د) حجز مشوَّه (بلا userId)
    await db.collection("scanClaims").doc("res-d").set({scanId: "res-d", userId: owner, claimedAtMs: Date.now() - 9 * 60 * 1000, sessionId: a.sessionId, reservation: {isFreeTrial: false, reservedAtMs: 1}});
    allClaims.push("res-d");
    // هـ) حجز قفل جلسة أخرى، وحجز قفل بلا sessionId (فحص شخصي أو قديم): لا يُمسّان
    const other = await newSession(owner, {joiner: "anon-reserve-other"});
    allSessions.push(other.sessionId);
    await seedReservation({scanId: "res-e", owner, sessionId: other.sessionId, ageMs: 9 * 60 * 1000});
    allClaims.push("res-e");
    await seedReservation({scanId: "res-f", owner, sessionId: null, ageMs: 9 * 60 * 1000});
    allClaims.push("res-f");
    // و) حجز صاحبه بلا مستند مستخدم: الإعادة تفشل ولا تُسقط الإلغاء
    const ghost = await newSession(owner, {joiner: "anon-reserve-ghost"});
    allSessions.push(ghost.sessionId);
    await seedReservation({scanId: "res-g", owner, sessionId: ghost.sessionId, ageMs: 9 * 60 * 1000});
    allClaims.push("res-g");
    await db.collection("scanClaims").doc("res-g").update({"reservation.userId": "user-doc-that-does-not-exist"});
    const creditBefore = await credit(owner);
    eq(creditBefore, 10 - 5, "[٦] خمسة حجوزات حقيقية مخصومة (a وb وe وf وg): الرصيد 5 (قبل الإلغاء؛ c وd بلا خصم)");

    const res = await cancel({sessionId: a.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    ok(res.threw === null && res.ret.alreadyCancelled === false, "[٦] الإلغاء ينجح");
    eq(await credit(owner), creditBefore + 1, "[٦] أُعيدت فحصة واحدة فقط: حجز res-a وحده (لا res-b بتقرير، ولا res-c بلا حجز، ولا res-d مشوَّه، ولا قفل جلسة أخرى، ولا قفل بلا sessionId)");
    eq((await claimData("res-a")).reservation, null, "[٦] res-a: reservation=null");
    ok((await claimData("res-b")).reservation && (await claimData("res-b")).reservation.userId === owner, "[٦] res-b: الحجز باقٍ (تقرير محفوظ)");
    eq((await claimData("res-c")).reservation, null, "[٦] res-c: كما كان");
    deq((await claimData("res-d")).reservation, {isFreeTrial: false, reservedAtMs: 1}, "[٦] res-d: الحجز المشوَّه باقٍ كما هو (لا يُخمَّن صاحبه)");
    ok((await claimData("res-e")).reservation !== null, "[٦] res-e (جلسة أخرى): الحجز باقٍ");
    ok((await claimData("res-f")).reservation !== null, "[٦] res-f (بلا sessionId): الحجز باقٍ");
    const line = cancelLines(res.lines, "cancelled")[0];
    ok(/ claims=4 released=1 noReservation=1 hasReport=1 malformed=1 inFlightSkipped=0 ageUnknownSkipped=0 releaseFailed=0$/.test(line), `[٦] وسطر السجلّ بأعداده: ${line.slice(line.indexOf(" claims="))}`);
    for (const id of ["res-a", "res-b", "res-c", "res-d", "res-e", "res-f"]) ok(await exists("scanClaims", id), `[٦] قفل ${id} موجود (لا حذف)`);

    // و) فشل الإعادة لا يُسقط الإلغاء
    const g = await cancel({sessionId: ghost.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    ok(g.threw === null && g.ret.status === "cancelled", "[٦] فشل الإعادة (مستخدم الحجز بلا مستند): الإلغاء ينجح");
    eq((await sessionData(ghost.sessionId)).status, "cancelled", "[٦] والحالة كُتبت");
    ok((await claimData("res-g")).reservation !== null, "[٦] والحجز باقٍ ظاهراً على القفل (يُصلحه نداء لاحق أو السكربت اليدوي)");
    ok(/ releaseFailed=1$/.test(cancelLines(g.lines, "cancelled")[0]), "[٦] والسجلّ releaseFailed=1");
    ok(g.lines.some((l) => l.startsWith("[sessionLifecycle] reservation release FAILED ") && l.includes("the claim keeps the reservation")), "[٦] وسطر خطأ الإعادة (بلا نصّ الخطأ الخام)");
    ok(!g.lines.join("\n").includes("user-doc-that-does-not-exist"), "[٦] ولا معرّف مستخدم خامّ في أيّ سطر");

    // ز) الفحص المجاني: يُعاد الجهاز المسجَّل
    const freeOwner = "own-free-0001";
    // A-SUB البند ١ (2026-10-17): createScanSession لم تعد تُنشئ جلسة لباقة free (SHOP_PLAN_REQUIRED). فالجلسة تُنشأ والمالك بباقة محلّ (كما يصحّ إنشاؤها فعلاً) ثم تصير باقته free قبل الحجز والإلغاء
    // (تخفيض الباقة بعد إنشاء الجلسة)؛ والمثبَت هنا كما كان: إعادة الجهاز المسجَّل إلى freeTrialUsedDevices عند الإلغاء.
    await seedOwner(freeOwner, {plan: "shop_pro", scansRemaining: 3, freeTrialUsedDevices: []});
    const f = await newSession(freeOwner, {joiner: "anon-free-joiner"});
    allSessions.push(f.sessionId);
    await db.collection("users").doc(freeOwner).update({plan: "free"});
    await seedReservation({scanId: "res-free", owner: freeOwner, sessionId: f.sessionId, ageMs: 6 * 60 * 1000, deviceFP: "FreeDev_14_8"});
    allClaims.push("res-free");
    let fu = await userData(freeOwner);
    deq([fu.scansRemaining, fu.freeTrialUsedDevices], [2, ["FreeDev_14_8"]], "[٦] الفحص المجاني: حُجزت فحصة وسُجّل الجهاز");
    const fr = await cancel({sessionId: f.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(freeOwner));
    ok(fr.threw === null, "[٦] إلغاء جلسة الفحص المجاني");
    fu = await userData(freeOwner);
    deq([fu.scansRemaining, fu.freeTrialUsedDevices], [3, []], "[٦] وأُعيدت الفحصة وأُزيل الجهاز من قائمة المجاني");
  }

  // ═══ ٧ — تحليل يجري: قفل حديث يمنع الإلغاء ═══
  {
    const owner = "own-flight-0001";
    const joiner = "anon-flight-joiner";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner});
    allSessions.push(s.sessionId);
    gate = newGate();
    modelCalls = 0;
    const analysis = call(analyzeDevice, {scanId: "scan-flight-1", fingerprint: FINGERPRINT, sessionId: s.sessionId}, authAnon(joiner));
    await waitFor(async () => (await exists("scanClaims", "scan-flight-1")) && modelCalls >= 1);
    eq((await claimData("scan-flight-1")).sessionId, s.sessionId, "[٧] القفل الحقيقي لتحليل جارٍ يحمل sessionId");
    eq(await credit(owner), 4, "[٧] والحجز مخصوم (5 → 4)");
    for (const [who, auth, reason] of [["المالك", authOwner(owner), CR.CANCELLED_BY_OWNER], ["المنضمّ", authAnon(joiner), CR.LEFT_BY_CUSTOMER]]) {
      const r = await cancel({sessionId: s.sessionId, reason}, auth);
      expectRefusal(r, "failed-precondition", R.ANALYSIS_IN_FLIGHT, `[٧] ${who} يُلغي أثناء تحليل جارٍ`);
      eq(refusedReason(r), R.ANALYSIS_IN_FLIGHT, `[٧] ${who}: السبب في السجلّ`);
      ok(/ claims=1$/.test(cancelLines(r.lines, "refused")[0]), `[٧] ${who}: وعدد الأقفال في السطر`);
    }
    eq((await sessionData(s.sessionId)).status, "scanning", "[٧] والجلسة تبقى scanning (لم تُكتب «ملغاة» تحت تحليل جارٍ)");
    ok((await claimData("scan-flight-1")).reservation !== null, "[٧] والحجز باقٍ لصاحبه الحيّ (لم يُعَد: كان سيمنح فحصة مجانية)");
    gate.release();
    gate = null;
    const finished = await analysis;
    ok(finished.threw === null, "[٧] وينجح التحليل بعد الإفراج");
    deq([(await sessionData(s.sessionId)).status, (await sessionData(s.sessionId)).scanId], ["completed", "scan-flight-1"], "[٧] والجلسة completed (لم يُكتب فوق «ملغاة»)");
    eq(await credit(owner), 4, "[٧] والرصيد 4 (فحصة واحدة)");
    const after = await cancel({sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    expectRefusal(after, "failed-precondition", R.COMPLETED, "[٧] وبعد الاكتمال: COMPLETED");

    // حدّ TTL على قفل حقيقي الشكل: عمره TTL−5 ث يجري، وTTL+5 ث عالق فيُعاد
    const owner2 = "own-ttl-0001";
    await seedOwner(owner2, {scansRemaining: 5});
    const young = await newSession(owner2, {joiner: "anon-ttl-a"});
    const old = await newSession(owner2, {joiner: "anon-ttl-b"});
    allSessions.push(young.sessionId, old.sessionId);
    await seedReservation({scanId: "ttl-young", owner: owner2, sessionId: young.sessionId, ageMs: SCAN_CLAIM_TTL_MS - 5000});
    await seedReservation({scanId: "ttl-old", owner: owner2, sessionId: old.sessionId, ageMs: SCAN_CLAIM_TTL_MS + 5000});
    allClaims.push("ttl-young", "ttl-old");
    eq(await credit(owner2), 3, "[٧] حجزان: الرصيد 3");
    const ry = await cancel({sessionId: young.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    expectRefusal(ry, "failed-precondition", R.ANALYSIS_IN_FLIGHT, "[٧] قفل عمره TTL−5 ث: تحليل يجري");
    const ro = await cancel({sessionId: old.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    ok(ro.threw === null, "[٧] قفل عمره TTL+5 ث: عالق، الإلغاء ينجح");
    eq(await credit(owner2), 4, "[٧] ويُعاد حجزه (3 → 4)، وحجز الجاري باقٍ");

    // قفل للجلسة بلا claimedAtMs: عمره مجهول — لا يُدَّعى قديماً
    const u = await newSession(owner2, {joiner: "anon-ttl-c"});
    allSessions.push(u.sessionId);
    await db.collection("scanClaims").doc("ttl-unknown").set({scanId: "ttl-unknown", userId: owner2, sessionId: u.sessionId, reservation: {userId: owner2, isFreeTrial: false, deviceFP: null, reservedAtMs: 1}});
    allClaims.push("ttl-unknown");
    const ru = await cancel({sessionId: u.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    expectRefusal(ru, "failed-precondition", R.CLAIM_AGE_UNKNOWN, "[٧] قفل بلا claimedAtMs: CLAIM_AGE_UNKNOWN");
    eq((await sessionData(u.sessionId)).status, "scanning", "[٧] ولا كتابة");
    await db.collection("scanClaims").doc("ttl-unknown2").set({scanId: "ttl-unknown2", userId: owner2, sessionId: u.sessionId, claimedAtMs: "yesterday", reservation: null});
    allClaims.push("ttl-unknown2");
    const ru2 = await cancel({sessionId: u.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner2));
    expectRefusal(ru2, "failed-precondition", R.CLAIM_AGE_UNKNOWN, "[٧] claimedAtMs نصّي: CLAIM_AGE_UNKNOWN");
  }

  // ═══ ٨ — الانتهاء عند المسّ ═══
  {
    const owner = "own-expire-0001";
    await seedOwner(owner, {scansRemaining: 5});
    for (const startStatus of ["pending", "scanning"]) {
      const id = `expire-${startStatus}`;
      const exp = PAST();
      await db.collection("scanSessions").doc(id).set({
        ownerId: owner, code: `NC-EX-${startStatus.slice(0, 3).toUpperCase()}`, status: startStatus, expiresAt: exp, createdAt: FieldValue.serverTimestamp(), ...(startStatus === "scanning" ? {joinedBy: "anon-expire-j"} : {}),
      });
      allSessions.push(id);
      const r = await cancel({sessionId: id, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
      expectRefusal(r, "failed-precondition", R.EXPIRED, `[٨] ${startStatus} منقضية: الإلغاء يُرفض SESSION_EXPIRED`);
      eq(r.threw.message, "الجلسة منتهية", `[٨] ${startStatus}: بالنصّ القائم «الجلسة منتهية»`);
      const s = await sessionData(id);
      eq(s.status, "expired", `[٨] ${startStatus}: وكُتبت «منتهية» في المعاملة نفسها`);
      ok(s.expiredAt && typeof s.expiredAt.toMillis === "function", `[٨] ${startStatus}: وexpiredAt`);
      eq(s.expiresAt.toMillis(), exp.getTime(), `[٨] ${startStatus}: وexpiresAt لم يتغيّر`);
      ok(!("cancelledAt" in s) && !("cancelReason" in s), `[٨] ${startStatus}: ولا حقل إلغاء`);
      ok(/ expiredRecorded=true$/.test(cancelLines(r.lines, "refused")[0]), `[٨] ${startStatus}: والسجلّ expiredRecorded=true`);
      const again = await cancel({sessionId: id, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
      expectRefusal(again, "failed-precondition", R.EXPIRED, `[٨] ${startStatus}: ثانياً على المسجَّلة: SESSION_EXPIRED`);
      ok(!/ expiredRecorded=true/.test(cancelLines(again.lines, "refused")[0]), `[٨] ${startStatus}: ولا كتابة ثانية`);
      eq((await sessionData(id)).expiredAt.toMillis(), s.expiredAt.toMillis(), `[٨] ${startStatus}: expiredAt لم يتغيّر`);
    }
    // ملغاة قبل الانقضاء ثم مضى وقتها: تبقى ملغاة (النهائية لا تتحوّل)، والإلغاء الثاني متكافئ
    const id = "expire-after-cancel";
    await db.collection("scanSessions").doc(id).set({ownerId: owner, code: "NC-EXCANC", status: "cancelled", cancelReason: "cancelled_by_owner", expiresAt: PAST()});
    allSessions.push(id);
    const r = await cancel({sessionId: id, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    ok(r.threw === null && r.ret.alreadyCancelled === true, "[٨] ملغاة منقضية: الإلغاء الثاني متكافئ (لا تُكتب فوقها «منتهية»)");
    eq((await sessionData(id)).status, "cancelled", "[٨] وتبقى cancelled");
    // completed منقضية: COMPLETED
    const cid = "expire-completed";
    await db.collection("scanSessions").doc(cid).set({ownerId: owner, code: "NC-EXCOMP", status: "completed", scanId: "x", expiresAt: PAST()});
    allSessions.push(cid);
    const rc = await cancel({sessionId: cid, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner));
    expectRefusal(rc, "failed-precondition", R.COMPLETED, "[٨] completed منقضية: COMPLETED (لا تُكتب فوقها «منتهية»)");
    eq((await sessionData(cid)).status, "completed", "[٨] وتبقى completed");
    // حجز عالق على جلسة تنتهي دون إلغاء: لا يُعاد من هنا (قيد معروف يُبلَّغ)
    const eo = "own-expire-res-0001";
    await seedOwner(eo, {scansRemaining: 5});
    const eid = "expire-with-reservation";
    await db.collection("scanSessions").doc(eid).set({ownerId: eo, code: "NC-EXRES1", status: "scanning", expiresAt: PAST(), joinedBy: "anon-x"});
    allSessions.push(eid);
    await seedReservation({scanId: "expire-res-1", owner: eo, sessionId: eid, ageMs: 15 * 60 * 1000});
    allClaims.push("expire-res-1");
    await cancel({sessionId: eid, reason: CR.CANCELLED_BY_OWNER}, authOwner(eo));
    eq(await credit(eo), 4, "[٨] جلسة منقضية بحجز عالق: الإلغاء المرفوض لا يعيده (قيد معروف: يبقى لسكربت الحجوزات العالقة اليدوي) — الرصيد 4");
  }

  // ═══ ٩ — بعد الإلغاء لا عمل: analyzeDevice وsubmitEvaluation ═══
  {
    const owner = "own-after-0001";
    const joiner = "anon-after-joiner";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner});
    allSessions.push(s.sessionId);
    await cancel({sessionId: s.sessionId, reason: CR.CONSENT_DECLINED}, authAnon(joiner));
    modelCalls = 0;
    const a = await call(analyzeDevice, {scanId: "scan-after-1", fingerprint: FINGERPRINT, sessionId: s.sessionId}, authAnon(joiner));
    ok(a.threw && a.threw.code === "permission-denied" && a.threw.message === "جلسة الفحص غير صالحة", "[٩] analyzeDevice على ملغاة: «جلسة الفحص غير صالحة»");
    eq(modelCalls, 0, "[٩] بلا نداء نموذج");
    ok(!(await exists("scanClaims", "scan-after-1")) && !(await exists("reports", "scan-after-1")), "[٩] ولا قفل ولا تقرير");
    eq(await credit(owner), 5, "[٩] ولا حجز (5)");
    const e = await call(submitEvaluation, {sessionId: s.sessionId, scanId: "scan-after-1", technicianGradeRaw: "good"}, authAnon(joiner));
    ok(e.threw && e.threw.code === "permission-denied" && e.threw.message === "جلسة الفحص غير صالحة", "[٩] submitEvaluation على ملغاة: «جلسة الفحص غير صالحة»");
    ok(e.lines.some((l) => l === "[submitEvaluation] refused reason=SESSION_NOT_SCANNING"), "[٩] وسبب الرفض المسمّى SESSION_NOT_SCANNING");
    eq((await sessionData(s.sessionId)).status, "cancelled", "[٩] والجلسة تبقى cancelled");
  }

  // ═══ ١٠ — سباق إلغاءين متزامنين: إعادة واحدة ═══
  {
    const owner = "own-race-0001";
    const joiner = "anon-race-joiner";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner});
    allSessions.push(s.sessionId);
    await seedReservation({scanId: "race-res-1", owner, sessionId: s.sessionId, ageMs: 12 * 60 * 1000});
    allClaims.push("race-res-1");
    eq(await credit(owner), 4, "[١٠] حجز معلّق: 5 → 4");
    const cap = capture();
    let results;
    try {
      results = await Promise.all([
        run(cancelScanSession, {sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authOwner(owner)).then((v) => ({ok: true, v}), (e) => ({ok: false, e})),
        run(cancelScanSession, {sessionId: s.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(joiner)).then((v) => ({ok: true, v}), (e) => ({ok: false, e})),
      ]);
    } finally {
      cap.restore();
    }
    ok(results.every((r) => r.ok), "[١٠] الإلغاءان المتزامنان ينجحان كلاهما (واحد يكتب والآخر متكافئ)");
    eq(results.filter((r) => r.v.alreadyCancelled === false).length, 1, "[١٠] واحد فقط كتب «ملغاة»");
    eq(results.filter((r) => r.v.alreadyCancelled === true).length, 1, "[١٠] والآخر alreadyCancelled=true");
    eq(await credit(owner), 5, "[١٠] **الرصيد 5 لا 6**: أُعيد الحجز مرّة واحدة رغم تزامن الإلغاءين");
    const total = cancelLines(cap.lines, "cancelled").map((l) => Number((l.match(/ released=(\d+) /) || [])[1])).reduce((a, b) => a + b, 0);
    eq(total, 1, "[١٠] ومجموع released في السطرين = 1");
    ok(["cancelled_by_owner", "left_by_customer"].includes((await sessionData(s.sessionId)).cancelReason), "[١٠] وcancelReason أحد السببين (الأوّل الكاتب)");
  }

  // ═══ ١١ — السجلّ: لا معرّف خامّ ولا رمز جلسة ═══
  {
    const owner = "own-logs-0001";
    const joiner = "anon-logs-joiner";
    await seedOwner(owner, {scansRemaining: 5});
    const s = await newSession(owner, {joiner});
    allSessions.push(s.sessionId);
    const lines = [];
    for (const [data, auth] of [
      [{sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, authAnon(STRANGER)],
      [{sessionId: s.sessionId, reason: CR.CONSENT_DECLINED}, authOwner(owner)],
      [{sessionId: s.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(joiner)],
      [{sessionId: s.sessionId, reason: CR.LEFT_BY_CUSTOMER}, authAnon(joiner)],
      [{sessionId: s.sessionId, reason: CR.CANCELLED_BY_OWNER}, null],
    ]) {
      lines.push(...(await cancel(data, auth)).lines);
    }
    const all = lines.join("\n");
    ok(![s.sessionId, s.code, owner, joiner, STRANGER].some((v) => all.includes(v)), "[١١] لا sessionId ولا رمز جلسة ولا uid (مالك/منضمّ/غريب) خامّاً في أيّ سطر");
    ok(lines.every((l) => l.startsWith("[cancelScanSession] ")), "[١١] وكل سطر مكتوب يبدأ باسم الدالّة");
    ok(lines.some((l) => l.includes(`session=${hashIdForLog(s.sessionId)}`)) && lines.some((l) => l.includes(`caller=${hashIdForLog(joiner)}`)), "[١١] والمعرّفات مُهشَّرة بـhashIdForLog المشترك");
    ok(lines.some((l) => l === `[cancelScanSession] refused reason=${R.NOT_AUTHENTICATED} caller=missing`), "[١١] وبلا هوية: caller=missing (الغياب حالة صريحة لا تهشيراً للفراغ)");
  }

  // ═══ ١٢ — لا حذف ═══
  for (const id of allSessions) ok((await sessionDoc(id)).exists, `[١٢] مستند الجلسة ${id.slice(0, 22)} موجود`);
  for (const id of allClaims) ok(await exists("scanClaims", id), `[١٢] قفل ${id} موجود`);

  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
