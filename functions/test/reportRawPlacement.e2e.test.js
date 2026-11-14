// E2E test: the V8 raw move, end to end on the Firestore emulator
// (الجزء ١-ج، 2026-10-09). مسار analyzeDevice ← الدفعة الذرّية ← المشغّل resolvePendingEvaluation
// ← submitEvaluation — **القاعدة 37: لا يُستبدَل منه إلا نداء المزوّد (global.fetch)** كما في سائر ملفّات
// e2e هنا؛ analyzeDevice وrunAnalysisInternal وresolveV7Report وwriteReportAndRaw والمشغّل وsubmitEvaluation
// كلّها الشيفرة الحقيقية على قاعدة بيانات المحاكي. (الملفّات القديمة كانت تُحاكي جسم المشغّل بنسخة منه،
// فلا تلاحظ أنه صار يقرأ الخامّ من reportRaw لا من حمولة الحدث.)
//
// ما يثبته:
//   1. فحص مصادَق: يُكتب مستند التقرير المقروء ومستند reportRaw بالمعرّف نفسه؛ المقروء بلا الحقول الخمسة،
//      وuserId يبقى؛ reportRaw يحمل الخامّ (rawFingerprint مخفَّف) والمعرّفات وaiAudit وبلا userId.
//   2. الذرّية: المستندان في دفعة واحدة (createTime واحد).
//   3. فحص جلسة: sessionId يُكتب في reportRaw وحده، وuserId المقروء = صاحب المحل.
//   4. المشغّل الحقيقي يُكمل تقييماً معلّقاً بقراءة reportRaw (لا حمولة الحدث): linkageIncomplete=false،
//      linkageRawState=PRIVATE، ولا معرّف يُنسخ إلى evaluations.
//   5. submitEvaluation الحقيقي على التقرير نفسه: لا معرّف في evaluations، والحالة PRIVATE.
//   6. فوق عتبة الحجم: خطأ resource-exhausted صريح قبل أيّ كتابة — لا تقرير ولا reportRaw ولا خصم فحصة،
//      ولا يبقى قفل scanClaims.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/reportRawPlacement.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini stub — never used here; a stray fallback attempt fails loudly instead of touching the network.
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

// The ONLY substituted layer: the provider's HTTP call (no network from tests — rule 9).
const CANNED_AI = {
  grade: "B", score: 80, deviceMarketingName: "Test", summary: "س", details: "د",
  verdict: "ت", issues: [], categoryScores: {},
};
global.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    choices: [{message: {content: JSON.stringify(CANNED_AI)}, finish_reason: "stop"}],
    usage: {completion_tokens: 20},
  }),
  text: async () => "",
});

const {db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {resolvePendingEvaluation} = require("../src/evaluations/resolvePendingEvaluation");
const {REPORT_RAW_FIELDS, REPORT_RAW_MAX_BYTES} = require("../src/analysis/reportRawStore");

const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const SHA = "b".repeat(64);
const IDENTIFIERS = ["timeSeriesStoragePath", "deviceFingerprintSha", "sessionId"];

function fp(profileSuffix, extra = {}) {
  return {
    device: {
      model: "P", androidVersion: "14", apiLevel: 34, totalRamGb: 8,
      deviceProfileKey: {a: `rr_${profileSuffix}`},
    },
    timeSeries: {
      header: {deviceFingerprint: SHA, appVersion: "1.0.11", androidApiLevel: 34},
      footer: {fieldsVersion: 68},
      samples: [{ts: 1, v: [1]}, {ts: 2, v: [2]}], variables: [],
    },
    functionalResults: [], manualResults: [],
    ...extra,
  };
}

const getReportSnap = (s) => db.collection("reports").doc(s).get();
const getRawSnap = (s) => db.collection("reportRaw").doc(s).get();
const getEval = async (s) => (await db.collection("evaluations").doc(s).get()).data();

async function runAnalyze({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}
async function seedUser(uid, scans = 20) {
  await db.collection("users").doc(uid).set({
    scansRemaining: scans, scansTotal: scans, plan: "shop_pro",
    isActive: true, expiresAt: future(),
  });
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

(async () => {
  // ===== 1+2. authenticated scan: both documents, atomically =====
  await seedUser("u1");
  await runAnalyze({data: {scanId: "rr-1", fingerprint: fp("1")}, auth: {uid: "u1"}});
  const rep1 = await getReportSnap("rr-1");
  const raw1 = await getRawSnap("rr-1");
  assert(rep1.exists && raw1.exists, "1. analyzeDevice wrote BOTH reports/rr-1 and reportRaw/rr-1");
  const r1 = rep1.data(); const w1 = raw1.data();
  for (const f of REPORT_RAW_FIELDS) {
    assert(!(f in r1), `1. the readable report does NOT carry "${f}"`);
  }
  assert(r1.userId === "u1", "1. userId stays on the readable report");
  assert(typeof r1.aiResponse === "object" && typeof r1.shortId === "string" && r1.fieldsVersion === 68 && r1.appVersion === "1.0.11",
      "1. what the readable report displays/mirrors is intact (aiResponse, shortId, fieldsVersion, appVersion)");
  assert(w1.scanId === "rr-1" && w1.source === "analyzeDevice" && w1.createdAt, "1. reportRaw: scanId, source, createdAt");
  assert(w1.deviceFingerprintSha === SHA && w1.timeSeriesStoragePath === `scans/${SHA}/rr-1.ts.json.gz`,
      "1. reportRaw: deviceFingerprintSha verbatim + timeSeriesStoragePath derived");
  assert(w1.sessionId === null, "1. reportRaw: sessionId null for a non-session scan (written as null, not omitted)");
  assert(w1.rawFingerprint && w1.rawFingerprint.device && w1.rawFingerprint.device.model === "P" &&
         !("samples" in w1.rawFingerprint.timeSeries) && w1.rawFingerprint.timeSeries.samplesCount === 2,
  "1. reportRaw.rawFingerprint is the lightened fingerprint (no samples, samplesCount=2)");
  assert("aiAudit" in w1, "1. reportRaw carries aiAudit (the readable report does not)");
  assert(!("userId" in w1), "1. reportRaw has NO userId (the server alone reads it)");
  assert(rep1.createTime.isEqual(raw1.createTime) && rep1.updateTime.isEqual(raw1.updateTime),
      "2. ATOMIC: both documents carry the same createTime/updateTime (one batch, one commit)");

  // ===== 3. session scan =====
  await db.collection("scanSessions").doc("sess-1").set({
    ownerId: "shopOwner", status: "scanning", expiresAt: future(), code: "NC-RR1",
  });
  await seedUser("shopOwner");
  await runAnalyze({data: {scanId: "rr-2", sessionId: "sess-1", fingerprint: fp("2")}, auth: null});
  const r2 = (await getReportSnap("rr-2")).data(); const w2 = (await getRawSnap("rr-2")).data();
  assert(r2.userId === "shopOwner" && !("sessionId" in r2), "3. session scan: readable report userId = the shop owner, no sessionId");
  assert(w2.sessionId === "sess-1", "3. session scan: the session id is recorded in reportRaw only");

  // ===== 4. the REAL trigger resolves a pending evaluation by reading reportRaw =====
  // The evaluation is submitted BEFORE the report exists (session path) -> pending.
  await db.collection("scanSessions").doc("sess-3").set({
    ownerId: "u3", status: "scanning", expiresAt: future(), code: "NC-RR3",
  });
  const pend = await submitEvaluation.run({
    data: {scanId: "rr-3", sessionId: "sess-3", technicianGradeRaw: "good"}, auth: null, rawRequest: {headers: {}},
  });
  assert(pend.pending === true, "4. evaluation accepted before the report (pending)");
  await seedUser("u3");
  await runAnalyze({data: {scanId: "rr-3", sessionId: "sess-3", fingerprint: fp("3")}, auth: null});
  const repSnap3 = await getReportSnap("rr-3");
  await resolvePendingEvaluation.run({params: {scanId: "rr-3"}, data: repSnap3});
  const e3 = await getEval("rr-3");
  assert(e3.pending === false && e3.linkageIncomplete === false && e3.linkageRawState === "PRIVATE",
      "4. REAL trigger: resolved; link complete; raw state PRIVATE (read from reportRaw — the event carried no raw)");
  assert(IDENTIFIERS.every((f) => !(f in e3)), "4. the evaluation carries none of the three identifiers");
  assert(e3.androidVersion === "14" && e3.apiLevel === 34, "4. device snapshot taken from the raw (androidVersion/apiLevel)");
  assert(e3.fieldsVersion === 68 && e3.appVersion === "1.0.11", "4. version mirrors taken from the readable report");

  // ===== 5. REAL submitEvaluation on an existing report (authenticated path) =====
  await submitEvaluation.run({data: {scanId: "rr-1", technicianGrade: "B"}, auth: {uid: "u1"}, rawRequest: {headers: {}}});
  const e1 = await getEval("rr-1");
  assert(e1.linkageIncomplete === false && e1.linkageRawState === "PRIVATE" && IDENTIFIERS.every((f) => !(f in e1)),
      "5. submitEvaluation on an analyzeDevice report: PRIVATE, complete, no identifier copied");

  // ===== 6. over the size guard: explicit error, nothing written, nobody charged =====
  await seedUser("u6", 5);
  let err = null;
  try {
    await runAnalyze({
      data: {
        scanId: "rr-6",
        fingerprint: fp("6", {functionalResults: [{testId: "X-01", categoryName: "cpu", status: "pass", rawValue: "x".repeat(REPORT_RAW_MAX_BYTES + 1000)}]}),
      },
      auth: {uid: "u6"},
    });
  } catch (e) {
    err = e;
  }
  assert(err && err.code === "resource-exhausted", `6. oversize raw → explicit resource-exhausted (got ${err && err.code})`);
  assert(!(await getReportSnap("rr-6")).exists && !(await getRawSnap("rr-6")).exists,
      "6. neither reports/rr-6 nor reportRaw/rr-6 was written (no partial write)");
  assert((await db.collection("users").doc("u6").get()).data().scansRemaining === 5, "6. scansRemaining unchanged (no scan charged)");
  assert(!(await db.collection("scanClaims").doc("rr-6").get()).exists, "6. no stale scanClaims lock left behind");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
