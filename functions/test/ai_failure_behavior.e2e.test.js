// E2E test for hard-AI-failure behavior + report-before-profile ordering
// (fix/ai-hard-failure-no-charge). Runs the REAL analyzeDevice callable via
// .run() against the Firestore emulator.
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة):
//   (أ) «الفشل الصلب» = فشل DeepSeek **وGemini معاً**. منذ قرار ٢ (2026-09-23) يقع Gemini خلف راية settings/geminiFallback.enabled،
//       مطفأة افتراضياً: DeepSeek وحده إن فشل لا يرفض التحليل (callAI.js:529-545 (الشرط عند :530) ← providerFailedNoFallback ← عرض حتمي بلا سرد،
//       التقرير يُحفظ وتُخصَم الفحصة — القرار ٢١) — فكانت الحالات 1/5/4 تنتظر unavailable ولا تُنتجه. الشرط السابق لفشل صلب
//       صار صريحاً هنا: الراية مُشعَلة (بذرة + تفريغ الكاش)، فتُنتج التأكيدات الأصلية نفسها فشلاً صلباً حقيقياً.
//       (مسار الراية المطفأة محروس بوحدات callAIv7/geminiFallbackFlag/resolveV7Report.)
//   (ب) الحالة 2 كانت تؤكّد `ret2.grade` (V6): صار الكعب جسم V7 سليماً (lib/v7ProviderStub.js) والتأكيد على pipeline=V7 و`overall`.
//
// Stubs: global.fetch (DeepSeek) is swapped per-case (success vs throw);
// @google/generative-ai (Gemini fallback) is require-cache-stubbed to ALWAYS
// throw (it's only reached when DeepSeek fails → simulates a hard both-fail).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/ai_failure_behavior.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// ---- Gemini fallback stub: always throws (callGemini require()s it lazily) ----
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {generateContent: async () => {
          throw new Error("stubbed gemini failure");
        }};
      }
    },
  },
};

// الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل.
const {installDeepSeekStub} = require("./lib/v7ProviderStub");
function fetchSuccess() {
  installDeepSeekStub();
}
function fetchFail() {
  global.fetch = async () => {
    throw new Error("stubbed deepseek network failure");
  };
}

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {clearGeminiFallbackConfigCache} = require("../src/utils/resolveGeminiFallbackConfig");
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");

function fp(profileHashSuffix) {
  return {
    device: {
      model: "TestPhone", androidVersion: "14", totalRamGb: 8,
      deviceProfileKey: {
        a: `hash_${profileHashSuffix}`,
        layerA_keystore: `k_${profileHashSuffix}`, layerB_firebaseId: `f_${profileHashSuffix}`,
        layerC_androidId: `and_${profileHashSuffix}`, layerD_buildSig: `b_${profileHashSuffix}`,
        layerE_sensorSig: `s_${profileHashSuffix}`,
      },
    },
    timeSeries: {header: {}, footer: {}, samples: [], variables: []},
    functionalResults: [], manualResults: [],
  };
}
const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

const results = [];
let failures = 0;
function assert(cond, name) {
  if (cond) results.push(`PASS  ${name}`);
  else {
    failures++; results.push(`FAIL  ${name}`);
  }
}
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists;
const getUser = async (uid) => (await db.collection("users").doc(uid).get()).data();
async function callAnalyze({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

(async () => {
  // شرط الفشل الصلب: Gemini مُفعَّل (وكعبه يرمي دائماً) — راجع رأس الملفّ (أ).
  await db.collection("settings").doc("geminiFallback").set({enabled: true});
  clearGeminiFallbackConfigCache();

  // ===== Case 1: HARD FAILURE (personal scan) =====
  fetchFail();
  await db.collection("users").doc("u1").set({scansRemaining: 5, plan: "single", isActive: true, expiresAt: future()});
  let threw1 = null;
  try {
    await callAnalyze({data: {scanId: "f1", fingerprint: fp("1"), usePrecomputed: true}, auth: {uid: "u1", token: {}}});
  } catch (e) {
    threw1 = e;
  }
  assert(threw1 && threw1.code === "unavailable" && /إعادة المحاولة/.test(threw1.message),
      "1. hard failure: clear 'retry' error (code=unavailable)");
  assert(!(await exists("reports", "f1")), "1. hard failure: NO report saved");
  assert((await getUser("u1")).scansRemaining === 5, "1. hard failure: scansRemaining UNCHANGED (5, not charged)");
  assert(!(await exists("deviceProfiles", "hash_1")), "1. hard failure: NO device profile written");
  assert(!(await exists("scanClaims", "f1")), "1. hard failure: scanClaim RELEASED (not left locked)");

  // ===== Case 5 (claim released → retry possible): re-call same scanId after failure =====
  fetchFail();
  let threw5 = null;
  try {
    await callAnalyze({data: {scanId: "f1", fingerprint: fp("1"), usePrecomputed: true}, auth: {uid: "u1", token: {}}});
  } catch (e) {
    threw5 = e;
  }
  assert(threw5 && threw5.code === "unavailable",
      "5. retry after failure NOT blocked by stale claim (got 'unavailable', not 'already-exists')");

  // ===== Case 2: SUCCESS (personal scan) =====
  fetchSuccess();
  await db.collection("users").doc("u2").set({scansRemaining: 5, plan: "single", isActive: true, expiresAt: future()});
  let threw2 = null; let ret2 = null;
  try {
    ret2 = await callAnalyze({data: {scanId: "f2", fingerprint: fp("2"), usePrecomputed: true}, auth: {uid: "u2", token: {}}});
  } catch (e) {
    threw2 = e;
  }
  assert(threw2 === null && ret2 && ret2.pipeline === V7_PIPELINE_TAG && ret2.overall && typeof ret2.overall === "object",
      "2. success: returns analysis (no error; the V7 analysis)");
  assert(await exists("reports", "f2"), "2. success: report saved");
  assert((await getUser("u2")).scansRemaining === 4, "2. success: scan charged (5 -> 4)");
  assert(await exists("deviceProfiles", "hash_2"), "2. success: device profile created");

  // ===== Case 3: ORDERING — profile references an existing report (no orphan) =====
  const prof2 = (await db.collection("deviceProfiles").doc("hash_2").get()).data();
  const reportRef = prof2?.scanHistory?.[0]?.reportRef; // "reports/f2"
  const refTargetId = (reportRef || "").split("/")[1];
  assert(reportRef === "reports/f2", "3. ordering: profile.scanHistory[0].reportRef points to reports/f2");
  assert(refTargetId && (await exists("reports", refTargetId)),
      "3. ordering: the report the profile references EXISTS (no orphan reportRef)");

  // ===== Case 4: HARD FAILURE in a shop session — owner not charged, session intact =====
  fetchFail();
  await db.collection("users").doc("ownerS").set({scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: future()});
  await db.collection("scanSessions").doc("sessS").set({ownerId: "ownerS", status: "scanning", expiresAt: future()});
  let threw4 = null;
  try {
    await callAnalyze({data: {scanId: "f4", fingerprint: fp("4"), sessionId: "sessS", usePrecomputed: true}, auth: {uid: "anonS", token: {}}});
  } catch (e) {
    threw4 = e;
  }
  const sessS = (await db.collection("scanSessions").doc("sessS").get()).data();
  assert(threw4 && threw4.code === "unavailable", "4. session hard failure: clear error");
  assert((await getUser("ownerS")).scansRemaining === 5, "4. session hard failure: OWNER NOT charged (stays 5)");
  assert(sessS.status === "scanning", "4. session hard failure: session left 'scanning' (not 'completed')");
  assert(!(await exists("reports", "f4")), "4. session hard failure: NO report saved");
  assert(!(await exists("scanClaims", "f4")), "4. session hard failure: scanClaim RELEASED");

  console.log("\n===== AI FAILURE BEHAVIOR E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
