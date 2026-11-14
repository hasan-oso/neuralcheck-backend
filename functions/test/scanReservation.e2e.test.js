// E2E test: credit reservation in a transaction BEFORE the model call (addendum to the V8 raw move,
// 2026-10-09). User decision (relayed, verbatim): «حجز الرصيد في معاملة قبل نداء النموذج، وإعادته إن فشل
// التحليل، في دفعة الخادم نفسها، مع اختبار يثبت أن فحصين متزامنين برصيد واحد يمرّ أحدهما فقط.»
//
// القاعدة 37: معاملات Firestore **حقيقية** على المحاكي، وanalyzeDevice وrunAnalysisInternal وresolveV7Report
// وwriteReportAndRaw كلّها الشيفرة الحقيقية — لا يُستبدَل إلا نداء المزوّد (global.fetch، لا شبكة من الاختبارات،
// القاعدة 9)، ويُعَدّ لإثبات «بلا نداء نموذج».
//
// ما يثبته:
//   1. فحص منفرد: يخصم فحصة واحدة، ويحذف القفل؛ يُقاس k = نداءات النموذج لتحليل ناجح واحد.
//   2. التزامن: ستّة فحوص متوازية (معرّفات مختلفة) برصيد واحد ⇒ يمرّ واحد فقط، والخمسة تُرفض permission-denied،
//      الرصيد 0 لا سالب، نداءات النموذج الكلّية = k (الخاسرون بلا نداء نموذج)، ولا قفل متبقٍّ، ورُفض واحد على الأقلّ
//      **من طبقة المعاملة** (سجلّ [scanReservation] refused) لا من الفحص المبكّر وحده.
//   3. الفحص المجاني لكل جهاز: فحصان متوازيان لنفس الجهاز (حساب free) ⇒ يمرّ واحد، والجهاز يُسجَّل مرّة واحدة.
//   4. الإعادة عند الفشل: خامّ فوق العتبة (resource-exhausted بعد نداء النموذج) ⇒ يُعاد الرصيد والجهاز المجاني،
//      لا تقرير ولا reportRaw ولا قفل؛ وإعادة المحاولة الناجحة تخصم فحصة واحدة (لا مضاعفة).
//   5. تبنّي حجز قديم (انهيار/مهلة): قفل قديم بحجز لنفس المستخدم ⇒ لا خصم ثانٍ؛ ولمستخدم آخر ⇒ يُعاد لصاحبه ويُخصَم من الجديد.
//   6. فحص الجلسة: يحجز من رصيد صاحب المحل؛ جهاز الزبون (مجهول) بلا مستند رصيد؛ وفحصان متوازيان برصيد واحد ⇒ يمرّ واحد.
//   7. التكافؤ: تقرير محفوظ يُعاد بلا حجز ولا خصم ولا نداء نموذج.
//   8. حساب مجهول بلا رصيد يكرّر النداء: كلّها مرفوضة، صفر نداء نموذج، ولا قفل مكتوب (الفحص المبكّر).
//   S-SUB (2026-10-16، scanRefusal.js): كل رفض يحمل details.reasonCode ويكتب سطراً مسمّى `[analyzeDevice] refused reason=… stage=early|reservation scanId=#<هاش> session=yes|no`
//   (بلا scanId خامّ ولا معرّف مستخدم)، والرمز ونصّه العربي كما كانا حرفياً. فالحالات ٢ و٣ و٦ و٨ مشدَّدة بذلك، وتُضاف:
//   9.  جلسة محلّ مالكها منتهٍ اشتراكه: SHOP_SUBSCRIPTION_EXPIRED بالنصّ القائم وstage=early وsession=yes؛ وجلسة مالكها بلا رصيد: SHOP_NO_CREDIT.
//   10. فحص شخصي: منتهٍ ⟵ SUBSCRIPTION_EXPIRED، ومنتهٍ بلا رصيد ⟵ NO_CREDIT (الرصيد قبل التاريخ)، وباقة free بجهاز مستعمَل ⟵ FREE_DEVICE_USED مبكّراً — كلّها بصفر نداء نموذج ولا قفل.
//   11. الغاية: لا رفض أيّاً كان يكتب سطراً بمعرّف الفحص الخامّ.
//   12. createScanSession (المستدعي هو المالك نفسه): نصّاها كما كانا حرفياً («انتهى اشتراكك، يرجى التجديد» — صار من scanRefusal.js — و«لا يوجد رصيد فحوصات»)، permission-denied، **و`details.reasonCode` (A-SUB الموجة الأولى): SHOP_SUBSCRIPTION_EXPIRED وSHOP_NO_CREDIT** (كان «بلا details»).
//
// ضابط سلبي (القاعدة 37): شغِّل الملفّ على نسخة src السابقة للحجز: NC_SRC_DIR=<مجلّد src قديم> — يجب أن تفشل حالات
// التزامن والإعادة (انظر تقرير المهمّة).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/scanReservation.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const path = require("path");

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => {
        throw new Error("stub gemini fail");
      }};
    }
  }},
};

// The ONLY substituted layer: the provider's HTTP call, counted.
let modelCalls = 0;
const CANNED_AI = {
  grade: "B", score: 80, deviceMarketingName: "Test", summary: "س", details: "د",
  verdict: "ت", issues: [], categoryScores: {},
};
global.fetch = async () => {
  modelCalls++;
  return {
    ok: true, status: 200,
    json: async () => ({
      choices: [{message: {content: JSON.stringify(CANNED_AI)}, finish_reason: "stop"}],
      usage: {completion_tokens: 20},
    }),
    text: async () => "",
  };
};

// Capture console.warn lines (still printed) to see WHICH layer refused.
const warns = [];
const origWarn = console.warn.bind(console);
console.warn = (...a) => { warns.push(a.join(" ")); origWarn(...a); };

const SRC = process.env.NC_SRC_DIR ? path.resolve(process.env.NC_SRC_DIR) : path.join(__dirname, "..", "src");
const {db} = require(path.join(SRC, "utils", "admin"));
const {analyzeDevice} = require(path.join(SRC, "analysis", "analyzeDevice"));
const {createScanSession} = require(path.join(SRC, "sessions", "createScanSession"));

const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const past = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
const NO_CREDIT = "لا يوجد رصيد فحوصات. يرجى شراء اشتراك.";
const FREE_USED = "تم استخدام الفحص المجاني لهذا الجهاز سابقاً";
const EXPIRED = "انتهى اشتراكك، يرجى التجديد"; // الفاصلة العربية U+060C
const {hashIdForLog} = require(path.join(SRC, "utils", "logRedaction"));
/** سطور الرفض المسمّاة من warns: [analyzeDevice] refused reason=… stage=… scanId=#… session=… */
const refusalLines = () => warns.filter((w) => w.startsWith("[analyzeDevice] refused "));
const lineFor = (reason, stage, scanId, session) => `[analyzeDevice] refused reason=${reason} stage=${stage} scanId=${hashIdForLog(scanId)} session=${session}`;

function fp(suffix, deviceModel = "P") {
  return {
    device: {model: deviceModel, androidVersion: "14", apiLevel: 34, totalRamGb: 8, deviceProfileKey: {a: `res_${suffix}`}},
    timeSeries: {
      header: {deviceFingerprint: "c".repeat(64), appVersion: "1.0.11", androidApiLevel: 34},
      footer: {fieldsVersion: 68}, samples: [{ts: 1, v: [1]}], variables: [],
    },
    functionalResults: [], manualResults: [],
  };
}

const run = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
const settle = (data, auth) => run(data, auth).then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const getUser = async (u) => (await db.collection("users").doc(u).get()).data();
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists;
async function seedUser(uid, fields) {
  await db.collection("users").doc(uid).set({
    scansRemaining: 1, scansTotal: 1, plan: "shop_pro", isActive: true, expiresAt: future(), ...fields,
  });
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}
const nodeAssert = require("assert");
function deq(a, b, n) {
  let same = true;
  try { nodeAssert.deepStrictEqual(a, b); } catch (e) { same = false; }
  assert(same, same ? n : `${n} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

(async () => {
  // ===== 1. solo scan: one credit, claim removed, k measured =====
  await seedUser("solo", {scansRemaining: 5});
  modelCalls = 0;
  await run({scanId: "solo-1", fingerprint: fp("solo")}, {uid: "solo"});
  const k = modelCalls;
  assert((await getUser("solo")).scansRemaining === 4, "1. a successful scan deducts exactly one credit (5 → 4)");
  assert(await exists("reports", "solo-1") && await exists("reportRaw", "solo-1"), "1. the report and its reportRaw exist");
  assert(!(await exists("scanClaims", "solo-1")), "1. the claim (and its reservation record) is gone after a saved report");
  assert(k >= 1, `1. model calls for one successful analysis measured: k=${k}`);

  // ===== 2. concurrency: 6 parallel scans, one credit =====
  await seedUser("race", {scansRemaining: 1});
  modelCalls = 0; warns.length = 0;
  const N = 6;
  const outcomes = await Promise.all(Array.from({length: N}, (_, i) => settle({scanId: `race-${i}`, fingerprint: fp(`race${i}`)}, {uid: "race"})));
  const passed = outcomes.filter((o) => o.ok);
  const refused = outcomes.filter((o) => !o.ok);
  assert(passed.length === 1, `2. exactly ONE of ${N} concurrent scans with one credit passes (got ${passed.length})`);
  assert(refused.length === N - 1 && refused.every((o) => o.error.code === "permission-denied" && o.error.message === NO_CREDIT),
      "2. the other five are refused permission-denied with the no-credit message");
  assert((await getUser("race")).scansRemaining === 0, "2. the balance is 0, never negative");
  assert(modelCalls === k, `2. total model calls = ${modelCalls} = k (${k}): the five losers made ZERO model calls`);
  let savedReports = 0;
  for (let i = 0; i < N; i++) if (await exists("reports", `race-${i}`)) savedReports++;
  assert(savedReports === 1, "2. exactly one report was saved");
  let leftoverClaims = 0;
  for (let i = 0; i < N; i++) if (await exists("scanClaims", `race-${i}`)) leftoverClaims++;
  assert(leftoverClaims === 0, "2. no claim is left behind (the refused scans released theirs)");
  assert(refused.every((o) => o.error.details && o.error.details.reasonCode === "NO_CREDIT" && Object.keys(o.error.details).length === 1),
      "2. every refusal carries details = {reasonCode: NO_CREDIT} (the text and the code are unchanged)");
  const reservationRefusals = refusalLines().filter((w) => w.includes(" stage=reservation "));
  assert(reservationRefusals.length >= 1 && reservationRefusals.every((w) => /^\[analyzeDevice\] refused reason=NO_CREDIT stage=reservation scanId=#[0-9a-f]{12} session=no$/.test(w)),
      "2. at least one refusal came from the RESERVATION TRANSACTION (not only the early pre-check): the named line reason=NO_CREDIT stage=reservation session=no");
  assert(refusalLines().length === N - 1 && !refusalLines().join("\n").includes("race-"),
      "2. exactly one named line per refusal (five), and none carries the raw scanId (it is hashed)");
  assert(!warns.some((w) => w.includes("[scanReservation] refused")), "2. the old [scanReservation] refused line (raw scanId) is gone");

  // ===== 3. free trial: one device, two concurrent scans =====
  await seedUser("free", {plan: "free", scansRemaining: 3, freeTrialUsedDevices: []});
  modelCalls = 0; warns.length = 0;
  const fo = await Promise.all([
    settle({scanId: "free-a", fingerprint: fp("fa", "SAMEDEV")}, {uid: "free"}),
    settle({scanId: "free-b", fingerprint: fp("fb", "SAMEDEV")}, {uid: "free"}),
  ]);
  assert(fo.filter((o) => o.ok).length === 1, "3. free trial, same device, two concurrent scans → exactly one passes");
  const lost = fo.find((o) => !o.ok);
  assert(lost && lost.error.code === "permission-denied" && lost.error.message === FREE_USED, "3. the other is refused: free scan already used for this device");
  assert(lost.error.details && lost.error.details.reasonCode === "FREE_DEVICE_USED", "3. with details.reasonCode = FREE_DEVICE_USED");
  assert(refusalLines().length === 1 && /^\[analyzeDevice\] refused reason=FREE_DEVICE_USED stage=reservation scanId=#[0-9a-f]{12} session=no$/.test(refusalLines()[0]),
      "3. and the transaction layer wrote the named line (stage=reservation)");
  const fu = await getUser("free");
  assert(fu.scansRemaining === 2 && fu.freeTrialUsedDevices.length === 1 && fu.freeTrialUsedDevices[0].startsWith("SAMEDEV_"),
      "3. one credit taken (3 → 2) and the device recorded once");
  assert(modelCalls === k, `3. the refused scan made no model call (${modelCalls} = k)`);

  // ===== 4. refund on failure (oversize raw → resource-exhausted after the model call) =====
  await seedUser("refund", {plan: "free", scansRemaining: 2, freeTrialUsedDevices: []});
  const HUGE = {testId: "X-01", categoryName: "cpu", status: "pass", rawValue: "x".repeat(950000)};
  const bad = fp("refund", "REFDEV");
  bad.functionalResults = [HUGE];
  modelCalls = 0;
  const failed = await settle({scanId: "refund-1", fingerprint: bad}, {uid: "refund"});
  assert(!failed.ok && failed.error.code === "resource-exhausted", "4. the analysis fails after the model call (oversize raw)");
  assert(modelCalls >= 1, "4. the model WAS called before the failure (the reservation preceded it)");
  const ru = await getUser("refund");
  assert(ru.scansRemaining === 2 && ru.freeTrialUsedDevices.length === 0, "4. credit and the free-trial device are restored after the failure (2 / [])");
  assert(!(await exists("reports", "refund-1")) && !(await exists("reportRaw", "refund-1")) && !(await exists("scanClaims", "refund-1")),
      "4. no report, no reportRaw, no claim left");
  const retry = await settle({scanId: "refund-2", fingerprint: fp("refund2", "REFDEV")}, {uid: "refund"});
  assert(retry.ok, "4. the retry after the refund succeeds (the device was not left locked)");
  const ru2 = await getUser("refund");
  assert(ru2.scansRemaining === 1 && ru2.freeTrialUsedDevices.length === 1, "4. the retry costs exactly one credit (no double charge): 2 → 1");

  // ===== 5. adopting a stale reservation (crash / timeout left it on the claim) =====
  await seedUser("adopt", {scansRemaining: 2});            // already decremented by the crashed attempt (3 → 2)
  await db.collection("scanClaims").doc("adopt-1").set({
    scanId: "adopt-1", userId: "adopt", claimedAtMs: Date.now() - 400000,
    reservation: {userId: "adopt", isFreeTrial: false, deviceFP: null, reservedAtMs: Date.now() - 400000},
  });
  warns.length = 0;
  const adoptRun = await settle({scanId: "adopt-1", fingerprint: fp("adopt")}, {uid: "adopt"});
  assert(adoptRun.ok, "5. a retry with the same scanId after the claim went stale succeeds");
  assert((await getUser("adopt")).scansRemaining === 2, "5. NO second deduction: the stale reservation is adopted (balance stays 2)");
  assert(warns.some((w) => w.includes("adopted a stale reservation")), "5. the adoption is logged by name");
  assert(!(await exists("scanClaims", "adopt-1")) && await exists("reports", "adopt-1"), "5. the report is saved and the claim removed");

  await seedUser("oldowner", {scansRemaining: 0});         // the crashed attempt had taken their only credit
  await seedUser("newowner", {scansRemaining: 3});
  await db.collection("scanClaims").doc("adopt-2").set({
    scanId: "adopt-2", userId: "oldowner", claimedAtMs: Date.now() - 400000,
    reservation: {userId: "oldowner", isFreeTrial: false, deviceFP: null, reservedAtMs: Date.now() - 400000},
  });
  const otherRun = await settle({scanId: "adopt-2", fingerprint: fp("adopt2")}, {uid: "newowner"});
  assert(otherRun.ok, "5. another user reusing a stale scanId succeeds");
  assert((await getUser("oldowner")).scansRemaining === 1, "5. the stale reservation is RETURNED to its owner (0 → 1), not lost");
  assert((await getUser("newowner")).scansRemaining === 2, "5. and the new user is charged once (3 → 2)");

  // ===== 6. session scan: charged to the shop owner, the customer device needs no credit =====
  await seedUser("shop", {scansRemaining: 1});
  await db.collection("scanSessions").doc("sess-r").set({ownerId: "shop", status: "scanning", expiresAt: future(), code: "NC-RS1"});
  modelCalls = 0;
  const so = await Promise.all([
    settle({scanId: "sess-r-a", sessionId: "sess-r", fingerprint: fp("sa")}, {uid: "customer-anon"}),
    settle({scanId: "sess-r-b", sessionId: "sess-r", fingerprint: fp("sb")}, null),
  ]);
  assert(so.filter((o) => o.ok).length === 1, "6. two concurrent session scans, the owner has one credit → exactly one passes");
  assert((await getUser("shop")).scansRemaining === 0, "6. the credit is taken from the SHOP OWNER (1 → 0)");
  assert(!(await exists("users", "customer-anon")), "6. the anonymous customer device has no credit document and needs none");
  assert(so.every((o) => o.ok || o.error.code === "permission-denied"), "6. the refused one is permission-denied (no credit)");
  const sessionRefused = so.find((o) => !o.ok);
  assert(sessionRefused && sessionRefused.error.message === NO_CREDIT && sessionRefused.error.details && sessionRefused.error.details.reasonCode === "SHOP_NO_CREDIT",
      "6. the refused session scan keeps the existing Arabic text and carries details.reasonCode = SHOP_NO_CREDIT (the shop's credit, not the phone's)");
  assert(refusalLines().some((w) => /^\[analyzeDevice\] refused reason=SHOP_NO_CREDIT stage=reservation scanId=#[0-9a-f]{12} session=yes$/.test(w)) && !refusalLines().join("\n").includes("sess-r"),
      "6. the named line says reason=SHOP_NO_CREDIT session=yes, with no raw scanId and no session id");

  // ===== 7. idempotency: a saved report is returned without a reservation =====
  await seedUser("idem", {scansRemaining: 2});
  await run({scanId: "idem-1", fingerprint: fp("idem")}, {uid: "idem"});
  const balanceAfterFirst = (await getUser("idem")).scansRemaining;
  modelCalls = 0;
  const again = await run({scanId: "idem-1", fingerprint: fp("idem")}, {uid: "idem"});
  assert(again && (await getUser("idem")).scansRemaining === balanceAfterFirst && modelCalls === 0,
      "7. re-requesting a saved scanId returns the stored report: no reservation, no deduction, no model call");
  assert(!(await exists("scanClaims", "idem-1")), "7. and writes no claim");

  // ===== 8. an anonymous account with no balance repeating the call =====
  modelCalls = 0;
  const spam = [];
  for (let i = 0; i < 3; i++) spam.push(await settle({scanId: `spam-${i}`, fingerprint: fp(`spam${i}`)}, {uid: "anon-nobody"}));
  assert(spam.every((o) => !o.ok && o.error.code === "permission-denied"), "8. an account with no credit document is refused every time");
  assert(modelCalls === 0, "8. ZERO model calls for the refused calls");
  let spamClaims = 0;
  for (let i = 0; i < 3; i++) if (await exists("scanClaims", `spam-${i}`)) spamClaims++;
  assert(spamClaims === 0, "8. the early pre-check writes nothing (no claim document)");
  assert(spam.every((o) => o.error.details && o.error.details.reasonCode === "NO_CREDIT"), "8. each refusal carries details.reasonCode = NO_CREDIT");
  assert(spam.every((o, i) => refusalLines().includes(lineFor("NO_CREDIT", "early", `spam-${i}`, "no"))),
      "8. and each wrote the named early line (the early refusal used to write nothing at all)");

  // ===== 9. session scan: the OWNER's subscription expired / no credit → the shop variants, at the early stage =====
  await seedUser("shopx", {scansRemaining: 5, expiresAt: past()});
  await db.collection("scanSessions").doc("sess-x").set({ownerId: "shopx", status: "scanning", expiresAt: future(), code: "NC-RX1"});
  modelCalls = 0; warns.length = 0;
  const sx = await settle({scanId: "sess-x-a", sessionId: "sess-x", fingerprint: fp("sxa")}, {uid: "customer-anon"});
  assert(!sx.ok && sx.error.code === "permission-denied" && sx.error.message === EXPIRED, "9. a session whose owner's subscription expired: permission-denied with the existing text");
  assert(sx.error.details && sx.error.details.reasonCode === "SHOP_SUBSCRIPTION_EXPIRED" && Object.keys(sx.error.details).length === 1, "9. details.reasonCode = SHOP_SUBSCRIPTION_EXPIRED");
  deq(refusalLines(), [lineFor("SHOP_SUBSCRIPTION_EXPIRED", "early", "sess-x-a", "yes")], "9. one named line: reason=SHOP_SUBSCRIPTION_EXPIRED stage=early session=yes");
  assert(modelCalls === 0 && !(await exists("scanClaims", "sess-x-a")), "9. zero model calls and no claim written (early, no write)");
  assert((await getUser("shopx")).scansRemaining === 5, "9. the owner's credit is untouched");
  await seedUser("shopz", {scansRemaining: 0});
  await db.collection("scanSessions").doc("sess-z").set({ownerId: "shopz", status: "scanning", expiresAt: future(), code: "NC-RZ1"});
  warns.length = 0;
  const sz = await settle({scanId: "sess-z-a", sessionId: "sess-z", fingerprint: fp("sza")}, {uid: "customer-anon"});
  assert(!sz.ok && sz.error.message === NO_CREDIT && sz.error.details && sz.error.details.reasonCode === "SHOP_NO_CREDIT", "9. a session whose owner has no credit: SHOP_NO_CREDIT with the existing text");
  deq(refusalLines(), [lineFor("SHOP_NO_CREDIT", "early", "sess-z-a", "yes")], "9. the early named line with session=yes");

  // ===== 10. personal scans: every early reason, in the gate's order =====
  await seedUser("pexp", {scansRemaining: 5, expiresAt: past()});
  await seedUser("pexpzero", {scansRemaining: 0, expiresAt: past()});
  await seedUser("pfree", {plan: "free", scansRemaining: 3, freeTrialUsedDevices: ["USEDDEV_14_8"]});
  modelCalls = 0; warns.length = 0;
  const pe = await settle({scanId: "pexp-1", fingerprint: fp("pe")}, {uid: "pexp"});
  const pz = await settle({scanId: "pexpzero-1", fingerprint: fp("pz")}, {uid: "pexpzero"});
  const pf = await settle({scanId: "pfree-1", fingerprint: fp("pf", "USEDDEV")}, {uid: "pfree"});
  assert(!pe.ok && pe.error.code === "permission-denied" && pe.error.message === EXPIRED && pe.error.details.reasonCode === "SUBSCRIPTION_EXPIRED", "10. personal scan, expired: SUBSCRIPTION_EXPIRED with the existing text");
  assert(!pz.ok && pz.error.message === NO_CREDIT && pz.error.details.reasonCode === "NO_CREDIT", "10. expired AND no credit: NO_CREDIT (the balance is judged before the date — the order is unchanged)");
  assert(!pf.ok && pf.error.message === FREE_USED && pf.error.details.reasonCode === "FREE_DEVICE_USED", "10. free plan on a used device: FREE_DEVICE_USED at the early stage");
  deq(refusalLines(), [
    lineFor("SUBSCRIPTION_EXPIRED", "early", "pexp-1", "no"), lineFor("NO_CREDIT", "early", "pexpzero-1", "no"), lineFor("FREE_DEVICE_USED", "early", "pfree-1", "no"),
  ], "10. three named early lines with session=no");
  assert(modelCalls === 0 && !(await exists("scanClaims", "pexp-1")) && !(await exists("scanClaims", "pfree-1")), "10. zero model calls, no claim");
  assert((await getUser("pfree")).scansRemaining === 3 && (await getUser("pfree")).freeTrialUsedDevices.length === 1, "10. nothing was deducted or recorded");

  // ===== 11. no refusal line ever carries a raw scan id =====
  const allRefusalText = refusalLines().join("\n");
  assert(!/pexp-1|pexpzero-1|pfree-1|sess-x-a|sess-z-a/.test(allRefusalText), "11. no raw scan id in any named refusal line (hashed)");

  // ===== 12. createScanSession: the owner is the caller; its two texts are as they were, now with details.reasonCode (A-SUB wave 1, item 4; replaces the "no details" assertions — rule 23) =====
  await seedUser("cs-exp", {scansRemaining: 5, expiresAt: past()});
  await seedUser("cs-zero", {scansRemaining: 0});
  const createAs = (uid) => createScanSession.run({data: {}, auth: {uid, token: {}}, rawRequest: {headers: {}}}).then(() => null, (e) => e);
  const csExp = await createAs("cs-exp");
  const csZero = await createAs("cs-zero");
  assert(csExp && csExp.code === "permission-denied" && csExp.message === EXPIRED &&
      csExp.details && csExp.details.reasonCode === "SHOP_SUBSCRIPTION_EXPIRED" && Object.keys(csExp.details).length === 1,
  "12. createScanSession, expired owner: permission-denied with the exact existing text and details = {reasonCode: SHOP_SUBSCRIPTION_EXPIRED} alone");
  assert(csZero && csZero.code === "permission-denied" && csZero.message === "لا يوجد رصيد فحوصات" &&
      csZero.details && csZero.details.reasonCode === "SHOP_NO_CREDIT" && Object.keys(csZero.details).length === 1,
  "12. createScanSession, no credit: its own text («لا يوجد رصيد فحوصات», without the purchase sentence, unchanged) and details = {reasonCode: SHOP_NO_CREDIT} alone");
  assert(csZero.message !== NO_CREDIT, "12. and it is not the gate's NO_CREDIT text (a different text, so not a copy)");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
