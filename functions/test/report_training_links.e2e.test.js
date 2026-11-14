// E2E test: report → training-data linkage (fix/report-training-links).
//
// Covers the three additive report fields:
//   - timeSeriesStoragePath  → scans/{header.deviceFingerprint}/{scanId}.ts.json.gz
//   - deviceFingerprintSha   → header.deviceFingerprint verbatim
//   - fieldsVersion/appVersion → mirrored from footer/header to the top level
//
// V8 raw move (2026-10-09, user decision): timeSeriesStoragePath and deviceFingerprintSha now live
// in reportRaw/{scanId} (written atomically with the report), NOT in the readable reports/{scanId}.
// The assertions below read them from reportRaw (rule 23: the assertions that proved they sit in the
// readable report were replaced, not left beside new ones); fieldsVersion/appVersion stay on the
// report. Case 1 also proves the readable report no longer carries the two identifiers.
//
// Path format is verified against the app (repo NeuralChek, branch
// fix/measurement-integrity-65):
//   FirebaseSyncService.kt:53
//     storage.reference.child("scans/${scan.deviceFingerprint}/${scan.scanId}.ts.json.gz")
//   StressTestService.kt — the same `deviceFp` value feeds BOTH
//     ScanEntity(deviceFingerprint = deviceFp)  (→ the Storage path)
//     TimeSeriesHeader(deviceFingerprint = deviceFp)  (→ the payload header)
//   BehaviorFingerprintBuilder.kt:157 copies it verbatim into the request,
//   and ships "" on the degraded path (timeSeries == null) — hence the
//   empty-string cases below.
//
// Run:
//   JAVA_HOME="<jdk>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/report_training_links.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini stub — never used on the success path, but required so a stray
// fallback attempt fails loudly instead of hitting the network.
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

const future = () => new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

// Fingerprint builder. `header` / `footer` are merged over the defaults so a
// case can omit a field entirely (undefined) or send "" like the app does.
function fp(profileSuffix, header, footer) {
  return {
    device: {
      model: "P", androidVersion: "14", totalRamGb: 8,
      deviceProfileKey: {a: `h_${profileSuffix}`},
    },
    timeSeries: {
      header: header === null ? undefined : {...header},
      footer: footer === null ? undefined : {...footer},
      samples: [], variables: [],
    },
    functionalResults: [], manualResults: [],
  };
}

const getReport = async (s) => (await db.collection("reports").doc(s).get()).data();
const getRaw = async (s) => (await db.collection("reportRaw").doc(s).get()).data();

async function run({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

async function seedUser(uid) {
  await db.collection("users").doc(uid).set({
    scansRemaining: 20, scansTotal: 20, plan: "shop_pro",
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
  // ===== Case 1: full header/footer → path built, mirrors populated =====
  const SHA = "a".repeat(64);
  await seedUser("u1");
  await run({
    data: {
      scanId: "s1",
      fingerprint: fp("1",
          {deviceFingerprint: SHA, appVersion: "1.9.65"},
          {fieldsVersion: 65}),
    },
    auth: {uid: "u1"},
  });
  const r1 = await getReport("s1");
  const w1 = await getRaw("s1");
  assert(w1 && w1.timeSeriesStoragePath === `scans/${SHA}/s1.ts.json.gz`,
      "1. reportRaw.timeSeriesStoragePath == scans/{sha}/{scanId}.ts.json.gz (matches app upload path)");
  assert(w1 && w1.deviceFingerprintSha === SHA,
      "1. reportRaw.deviceFingerprintSha == header.deviceFingerprint verbatim");
  assert(!("timeSeriesStoragePath" in r1) && !("deviceFingerprintSha" in r1) &&
         !("rawFingerprint" in r1) && !("sessionId" in r1) && !("aiAudit" in r1),
      "1. the readable report carries none of the five moved fields (V8 raw move)");
  assert(r1.userId === "u1", "1. userId stays on the readable report");
  assert(r1.fieldsVersion === 65, "1. fieldsVersion mirrored (65)");
  assert(r1.appVersion === "1.9.65", "1. appVersion mirrored");

  // Regression guard: the pre-existing deviceFingerprint field still holds the
  // device MODEL, and must NOT have been repurposed to the hash.
  assert(r1.deviceFingerprint === "P" && r1.deviceModel === "P",
      "1. legacy deviceFingerprint still == device model (not overwritten)");

  // ===== Case 2: fingerprint absent (key missing) → null, no guessed path =====
  await seedUser("u2");
  await run({
    data: {scanId: "s2", fingerprint: fp("2", {appVersion: "1.9.65"}, {fieldsVersion: 65})},
    auth: {uid: "u2"},
  });
  const r2 = await getReport("s2");
  const w2 = await getRaw("s2");
  assert(w2 && w2.timeSeriesStoragePath === null,
      "2. missing fingerprint → reportRaw.timeSeriesStoragePath === null");
  assert(w2 && w2.deviceFingerprintSha === null,
      "2. missing fingerprint → reportRaw.deviceFingerprintSha === null");
  assert(!String(w2.timeSeriesStoragePath).includes("undefined"),
      "2. no 'undefined' ever written into a path");
  assert(r2.fieldsVersion === 65 && r2.appVersion === "1.9.65",
      "2. version mirrors still populated when fingerprint is absent");

  // ===== Case 3: app's degraded path — empty strings, not undefined =====
  await seedUser("u3");
  await run({
    data: {
      scanId: "s3",
      fingerprint: fp("3", {deviceFingerprint: "", appVersion: ""}, {fieldsVersion: 65}),
    },
    auth: {uid: "u3"},
  });
  const r3 = await getReport("s3");
  const w3 = await getRaw("s3");
  assert(w3 && w3.timeSeriesStoragePath === null,
      "3. empty-string fingerprint treated as absent → reportRaw path null");
  assert(w3 && w3.deviceFingerprintSha === null,
      "3. empty-string fingerprint → reportRaw.deviceFingerprintSha null");
  assert(r3.appVersion === null,
      "3. empty-string appVersion → null (not \"\")");

  // ===== Case 4: version mirrors absent → explicit nulls =====
  await seedUser("u4");
  await run({
    data: {scanId: "s4", fingerprint: fp("4", {deviceFingerprint: SHA}, {})},
    auth: {uid: "u4"},
  });
  const r4 = await getReport("s4");
  const w4 = await getRaw("s4");
  assert(r4.fieldsVersion === null, "4. missing footer.fieldsVersion → null");
  assert(r4.appVersion === null, "4. missing header.appVersion → null");
  assert("fieldsVersion" in r4 && "appVersion" in r4,
      "4. mirror fields are always present (queryable), never omitted");
  assert(w4 && w4.timeSeriesStoragePath === `scans/${SHA}/s4.ts.json.gz`,
      "4. reportRaw path still built when only the version mirrors are missing");

  // ===== Case 5: timeSeries wholly absent → all four null, no crash =====
  await seedUser("u5");
  await run({
    data: {scanId: "s5", fingerprint: {
      device: {model: "P", androidVersion: "14", totalRamGb: 8,
        deviceProfileKey: {a: "h_5"}},
      functionalResults: [], manualResults: [],
    }},
    auth: {uid: "u5"},
  });
  const r5 = await getReport("s5");
  const w5 = await getRaw("s5");
  assert(w5 && w5.timeSeriesStoragePath === null && w5.deviceFingerprintSha === null &&
         r5.fieldsVersion === null && r5.appVersion === null,
  "5. no timeSeries at all → all four fields null (two in reportRaw, two mirrors on the report), write still succeeds");

  // ===== Case 6: non-numeric fieldsVersion is rejected, not coerced =====
  await seedUser("u6");
  await run({
    data: {scanId: "s6", fingerprint: fp("6",
        {deviceFingerprint: SHA}, {fieldsVersion: "65"})},
    auth: {uid: "u6"},
  });
  const r6 = await getReport("s6");
  assert(r6.fieldsVersion === null,
      "6. string fieldsVersion \"65\" → null (type preserved, not coerced)");

  // ===== Case 7: fieldsVersion 0 sentinel is kept as a number =====
  // App ships Int? where 0/absent means "device did not stamp a version".
  // 0 is a real value the query side may want to see — it must not become null.
  await seedUser("u7");
  await run({
    data: {scanId: "s7", fingerprint: fp("7", {deviceFingerprint: SHA}, {fieldsVersion: 0})},
    auth: {uid: "u7"},
  });
  const r7 = await getReport("s7");
  assert(r7.fieldsVersion === 0, "7. fieldsVersion 0 preserved as 0 (not null)");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
