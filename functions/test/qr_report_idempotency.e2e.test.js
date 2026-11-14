// E2E test: QR-session report attribution + idempotency-first
// (fix/analyze-idempotent-first). Confirms reports are owner-stamped and that
// re-opening / re-calling analyzeDevice for an existing scanId returns the
// saved report with NO second charge and NO AI call — even when the caller is
// out of credit. Verifies session billing still charges once (unbroken).
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة): الحالتان 2 و3 كانتا تؤكّدان `ret.grade === "B"`
// (شكل V6). التقرير المخزَّن اليوم V7: يُعاد من الذاكرة (idempotency-first) بلا grade — `aiResponse` المخزَّن بعد طرح
// narrative.details/verdict وحدهما (S6: يُحذفان عند الإرجاع فقط، analyzeDevice.js:240 (الدالّة) و:406-407 (الإرجاع من التقرير الموجود)).
// فالتأكيد صار: المُعاد = المخزَّن حرفياً (بعد ذلك الطرح)، لا قيمة grade.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/qr_report_idempotency.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini fallback stub: ALWAYS throws. Combined with a failing fetch (DeepSeek),
// any actual AI attempt becomes a hard failure → if idempotency did NOT
// short-circuit, the re-call would throw "unavailable". So "returns cached with
// both providers failing" proves no AI was called.
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

// الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل.
const {installDeepSeekStub} = require("./lib/v7ProviderStub");
function fetchSuccess() {
  installDeepSeekStub();
}
function fetchFail() {
  global.fetch = async () => {
    throw new Error("stub deepseek fail — AI must NOT be called on idempotent re-open");
  };
}

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");

const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
function fp(s) {
  return {device: {model: "P", androidVersion: "14", totalRamGb: 8, deviceProfileKey: {a: `h_${s}`}},
    timeSeries: {header: {}, footer: {}, samples: [], variables: []}, functionalResults: [], manualResults: []};
}
// المخزَّن بعد طرح narrative.details/verdict وحدهما — ما يُعاد للعميل من تقرير موجود (S6). نسخة عميقة صريحة لا استدعاء للدالّة المُختبَرة.
function storedAsReturned(aiResponse) {
  const copy = JSON.parse(JSON.stringify(aiResponse));
  if (copy.narrative) {
    delete copy.narrative.details;
    delete copy.narrative.verdict;
  }
  return copy;
}
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const getUser = async (u) => (await db.collection("users").doc(u).get()).data();
const getReport = async (s) => (await db.collection("reports").doc(s).get()).data();
async function run({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

(async () => {
  // ===== Case 1: QR scan → report stamped with ownerId + charged once =====
  fetchSuccess();
  await db.collection("users").doc("owner").set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: future()});
  await db.collection("scanSessions").doc("sess1").set({ownerId: "owner", status: "scanning", expiresAt: future()});
  await run({data: {scanId: "q1", fingerprint: fp("1"), sessionId: "sess1", usePrecomputed: true}, auth: {uid: "anon1", token: {}}});
  const rep1 = await getReport("q1");
  assert(rep1 && rep1.userId === "owner", "1. QR scan: reports/q1.userId == ownerId (NOT anon)");
  assert((await getUser("owner")).scansRemaining === 4, "1. QR scan: owner charged once (5 -> 4)");
  assert(!(await db.collection("users").doc("anon1").get()).exists, "1. QR scan: anon device NOT billed/created");

  // ===== Case 2: owner re-opens same scanId (uid, no session) → cached, no charge, no AI =====
  fetchFail(); // if AI were called, it would hard-fail; idempotency must short-circuit
  let threw2 = null; let ret2 = null;
  try {
    ret2 = await run({data: {scanId: "q1", fingerprint: fp("1"), usePrecomputed: true}, auth: {uid: "owner", token: {}}});
  } catch (e) {
    threw2 = e;
  }
  assert(threw2 === null && ret2 && stable(ret2) === stable(storedAsReturned(rep1.aiResponse)),
      "2. owner re-open (uid): returns CACHED report (== stored aiResponse minus narrative.details/verdict), no AI call");
  assert((await getUser("owner")).scansRemaining === 4, "2. owner re-open: NO second charge (stays 4)");

  // ===== Case 3: OUT-OF-CREDIT owner re-opens existing report → still cached (idempotency-first) =====
  await db.collection("users").doc("owner").update({scansRemaining: 0});
  fetchFail();
  let threw3 = null; let ret3 = null;
  try {
    // no fingerprint at all — viewing by scanId alone must still work
    ret3 = await run({data: {scanId: "q1", usePrecomputed: true}, auth: {uid: "owner", token: {}}});
  } catch (e) {
    threw3 = e;
  }
  assert(threw3 === null && ret3 && stable(ret3) === stable(storedAsReturned(rep1.aiResponse)),
      "3. out-of-credit owner re-open: returns CACHED (NOT 'no credit'), even without fingerprint");
  assert((await getUser("owner")).scansRemaining === 0, "3. out-of-credit re-open: balance unchanged (0)");

  // ===== Case 4: NEW session scan still charges owner once (billing unbroken) =====
  fetchSuccess();
  await db.collection("users").doc("owner2").set({scansRemaining: 3, scansTotal: 3, plan: "shop_pro", isActive: true, expiresAt: future()});
  await db.collection("scanSessions").doc("sess2").set({ownerId: "owner2", status: "scanning", expiresAt: future()});
  await run({data: {scanId: "q2", fingerprint: fp("2"), sessionId: "sess2", usePrecomputed: true}, auth: {uid: "anon2", token: {}}});
  assert((await getReport("q2")).userId === "owner2", "4. new session scan: reports/q2.userId == ownerId");
  assert((await getUser("owner2")).scansRemaining === 2, "4. new session scan: owner charged ONCE (3 -> 2) — billing unbroken");

  console.log("\n===== QR REPORT IDEMPOTENCY E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
