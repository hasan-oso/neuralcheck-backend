// E2E test: registerUser grants no free scans to an anonymous account (addendum to the V8 raw move, 2026-10-09).
// User decision (relayed, verbatim): «registerUser لا يمنح freeScansForNewUser لحساب مجهول (sign_in_provider =
// anonymous).» The REAL handler (registerUser.run) on the emulator; analyzeDevice is the real one too, with only the
// provider call stubbed and counted (no network from tests — rule 9).
//
// ما يثبته:
//   مجهول: لا مستند يُنشأ، والاستجابة scansRemaining=0 وfreeScansGranted=false وreason=ANONYMOUS (تكرار النداء بلا أثر).
//   غير مجهول (google.com، password): مستند بخطّة free ورصيد settings/app.freeScansForNewUser — كما كان.
//   الغياب (ادّعاء المزوّد غائب): لا منح ولا مستند، بسبب مسمّى.
//   الترقية: المعرّف نفسه مجهول ثم google.com ⇒ يُمنح عند ذلك (ربط الحساب يُبقي uid).
//   مجهول بمستند قائم (منح قبل هذا التغيير): لا يُمسّ رصيده — فرع «المستخدم القائم» كما هو.
//   أثره في analyzeDevice: المجهول بلا مستند يُرفض «لا رصيد» بلا نداء نموذج؛ وجهاز الزبون في جلسة لا يحتاج مستنداً (يُخصَم من
//   صاحب المحل) — مُثبَت أيضاً في scanReservation.e2e.test.js الحالة ٦.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/registerUserAnonymous.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

let modelCalls = 0;
global.fetch = async () => {
  modelCalls++;
  throw new Error("no network from tests");
};

// NC_SRC_DIR: negative control — run this file against an older copy of src (it must fail on the pre-change one).
const path = require("path");
const SRC = process.env.NC_SRC_DIR ? path.resolve(process.env.NC_SRC_DIR) : path.join(__dirname, "..", "src");
const {db} = require(path.join(SRC, "utils", "admin"));
const {registerUser} = require(path.join(SRC, "users", "registerUser"));
const {analyzeDevice} = require(path.join(SRC, "analysis", "analyzeDevice"));

// NB: tokens carry NO email, so the handler's welcome-mail branch (SMTP) is never reached.
const authOf = (uid, provider) => ({uid, token: provider === undefined ? {} : {firebase: {sign_in_provider: provider}}});
const reg = (uid, provider) => registerUser.run({data: {}, auth: authOf(uid, provider), rawRequest: {headers: {}}});
const userDoc = async (uid) => db.collection("users").doc(uid).get();

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

(async () => {
  await db.collection("settings").doc("app").set({freeScansForNewUser: 3});

  // ===== anonymous =====
  const r1 = await reg("anon-1", "anonymous");
  assert(r1.success === true && r1.scansRemaining === 0 && r1.existing === false && r1.freeScansGranted === false && r1.reason === "ANONYMOUS",
      "1. anonymous: success, scansRemaining 0, freeScansGranted false, reason ANONYMOUS");
  assert(!(await userDoc("anon-1")).exists, "1. anonymous: NO users document is created");
  await reg("anon-1", "anonymous"); await reg("anon-1", "anonymous");
  assert(!(await userDoc("anon-1")).exists, "1. anonymous: repeating the call still creates nothing");

  // ===== non-anonymous =====
  const g = await reg("goog-1", "google.com");
  const gd = (await userDoc("goog-1")).data();
  assert(g.scansRemaining === 3 && g.existing === false && g.freeScansGranted === undefined, "2. google.com: success with scansRemaining = freeScansForNewUser (3), response shape unchanged");
  assert(gd && gd.plan === "free" && gd.scansRemaining === 3 && gd.scansTotal === 3 && Array.isArray(gd.freeTrialUsedDevices) && gd.freeTrialUsedDevices.length === 0,
      "2. google.com: users document created as before (plan free, 3 scans, empty device list)");
  const p = await reg("pass-1", "password");
  assert(p.scansRemaining === 3 && (await userDoc("pass-1")).exists, "2. password provider: granted as before");
  const again = await reg("goog-1", "google.com");
  assert(again.existing === true && again.scansRemaining === 3, "2. an existing user is returned as existing, balance untouched");

  // ===== absent provider claim =====
  const u = await reg("unk-1", undefined);
  assert(u.freeScansGranted === false && u.reason === "SIGN_IN_PROVIDER_UNKNOWN" && !(await userDoc("unk-1")).exists,
      "3. no provider claim at all: not read as non-anonymous — no grant, no document, named reason");

  // ===== upgrade: the same uid becomes non-anonymous =====
  await reg("up-1", "anonymous");
  assert(!(await userDoc("up-1")).exists, "4. upgrade: while anonymous there is no document");
  const up = await reg("up-1", "google.com");
  assert(up.scansRemaining === 3 && (await userDoc("up-1")).data().scansRemaining === 3, "4. upgrade: once linked (provider google.com) the same uid is granted");

  // ===== anonymous with an EXISTING document (granted before this change) =====
  await db.collection("users").doc("legacy-anon").set({plan: "free", scansRemaining: 2, scansTotal: 3, isActive: true, freeTrialUsedDevices: []});
  const l = await reg("legacy-anon", "anonymous");
  const ld = (await userDoc("legacy-anon")).data();
  assert(l.existing === true && l.scansRemaining === 2 && ld.scansRemaining === 2, "5. an anonymous uid that already has a document keeps it untouched (existing branch)");

  // ===== effect in analyzeDevice: an anonymous account with no document is refused, no model call =====
  modelCalls = 0;
  let err = null;
  try {
    await analyzeDevice.run({
      data: {scanId: "anon-scan-1", fingerprint: {device: {model: "P", androidVersion: "14", totalRamGb: 8}, timeSeries: {header: {}, footer: {}, samples: [], variables: []}, functionalResults: [], manualResults: []}},
      auth: {uid: "anon-1"}, rawRequest: {headers: {}},
    });
  } catch (e) {
    err = e;
  }
  assert(err && err.code === "permission-denied", "6. analyzeDevice refuses the anonymous account with no document (no credit)");
  assert(modelCalls === 0, "6. ...with zero model calls");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
