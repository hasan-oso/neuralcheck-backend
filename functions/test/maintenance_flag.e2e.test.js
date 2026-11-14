// E2E test for maintenance-flag PLACEMENT (fix/maintenance-flag-placement).
// Proves the fail→pass "maintenance suspected" marker lands INSIDE
// change_analysis (change_analysis.maintenance_suspected) — exactly where the
// Android app reads it — and NOT at the top level, without clobbering an
// existing change_analysis object emitted by the model.
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة): هذا الملفّ كان يثبت وضع العلامة داخل
// `change_analysis` في استجابة V6. `change_analysis` من حقول V6 التي «تختفي» بعد التبديل (docs/V7_DISPLAY_SHAPE_CONTRACT.md:87 و:505)؛
// وعلى المسار الحيّ V7 (منذ fd3a6ce) تُحسَب العلامة (runAnalysisInternal.js:202) ولا تصل أيّ سطح: وضعها في aiResult.change_analysis
// (:715-720) يقع في فرع V6 غير القابل للوصول بعد الإرجاع المبكّر على مسار V7. فالتأكيدات الأصلية على وجود العلامة في الاستجابة
// لا يمكن أن تتحقّق، وحُلَّ محلّها ما ينتجه الكود فعلاً: (١) كشف الانتقال اليدوي يُجبر تقييماً جديداً، وسببه مسجَّل في
// v5Metrics.cacheReason بوسم «(maintenance?)» لانتقال fail→pass وحده؛ (٢) لا change_analysis ولا maintenanceSuspected في استجابة
// V7 ولا في المستند — حتى حين يُصدر النموذج change_analysis (الحالة C). **سؤال مفتوح للمستخدم لا يحسمه هذا الاختبار:** العلامة
// المحسوبة بلا قارئ على V7 (مذكور في تقرير المهمّة).
//
// Runs the REAL analyzeDevice callable via .run() against the Firestore
// emulator. Stubs: global.fetch (DeepSeek) returns a per-case canned analysis;
// @google/generative-ai (Gemini fallback) is require-cache-stubbed to throw
// (never reached because DeepSeek "succeeds").
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/maintenance_flag.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// ---- Gemini fallback stub: always throws (never reached; DeepSeek succeeds) ----
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

// DeepSeek stub — الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل (+ مفاتيح إضافية يُصدرها «النموذج» إن طُلبت).
const {validV7ModelResponse, installDeepSeekStub} = require("./lib/v7ProviderStub");
function fetchSuccess(extra = {}) {
  installDeepSeekStub(() => ({...validV7ModelResponse(), ...extra}));
}
const getReportDoc = async (id) => (await db.collection("reports").doc(id).get()).data();

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {computeScanSignature} = require("../src/signatures/computeScanSignature");

// Healthy fingerprint; only manualResults vary so the manual transition is the
// SOLE trigger (verification + functional + battery stay identical old↔new).
function fp(suffix, manual = []) {
  return {
    device: {
      model: "TestPhone", androidVersion: "14", totalRamGb: 8,
      deviceProfileKey: {
        a: `hash_${suffix}`,
        layerA_keystore: `k_${suffix}`, layerB_firebaseId: `f_${suffix}`,
        layerC_androidId: `and_${suffix}`, layerD_buildSig: `b_${suffix}`,
        layerE_sensorSig: `s_${suffix}`,
      },
    },
    timeSeries: {
      header: {}, samples: [], variables: [],
      footer: {
        verificationResults: {
          cpuPrimeSieveCorrect: true, memoryMarchPassed: true,
          memoryWalkingOnesPassed: true, gpuComputeGemmCorrect: true,
          criticalDefectDetected: false, cpuFmaErrors: 0,
          memoryRandomVerifyErrors: 0, storageWriteVerifyErrors: 0,
          storageReadVerifyErrors: 0,
        },
        stressEffectiveness: {passedSaturationThreshold: true},
        dataQuality: {},
        batteryHealth: {
          designCapacityMah: 5000, cycleCount: 200,
          voltageStabilityMv: 30, dischargeRateUnderLoadMa: 2500, batteryTempRiseC: 5,
        },
      },
    },
    functionalResults: [],
    manualResults: manual,
  };
}

// Seed a device profile whose last scan has manual M-02 = oldManualStatus, so a
// new scan with a different M-02 status produces the desired transition.
async function seedProfile(suffix, oldManualStatus) {
  const oldSig = computeScanSignature(fp(suffix, [{testId: "M-02", status: oldManualStatus}]));
  await db.collection("deviceProfiles").doc(`hash_${suffix}`).set({
    primaryFingerprint: `hash_${suffix}`,
    layerA_keystore: `k_${suffix}`,
    metadata: {scanCount: 1, firstSeen: admin.firestore.Timestamp.now(), lastSeen: admin.firestore.Timestamp.now()},
    scanHistory: [{
      scanId: `old_${suffix}`,
      scanDate: admin.firestore.Timestamp.now(),
      reportRef: `reports/old_${suffix}`,
      summary: {overallGrade: "C", overallScore: 60},
      signature: oldSig,
    }],
  });
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
async function callAnalyze({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

(async () => {
  await db.collection("users").doc("u1").set(
      {scansRemaining: 10, plan: "single", isActive: true, expiresAt: future()});

  // ===== Case A: fail→pass, model emits NO change_analysis =====
  // V7 الحيّ: انتقال fail→pass يُجبر تقييماً جديداً وسببه مسجَّل بوسم «(maintenance?)»؛
  // لا change_analysis ولا maintenanceSuspected في الاستجابة ولا في المستند المخزَّن.
  await seedProfile("A", "fail");
  fetchSuccess();
  const retA = await callAnalyze({
    data: {scanId: "scanA", fingerprint: fp("A", [{testId: "M-02", status: "pass"}]), usePrecomputed: true},
    auth: {uid: "u1", token: {}},
  });
  const repA = await getReportDoc("scanA");
  assert(repA && repA.v5Metrics && repA.v5Metrics.cacheHit === false &&
      repA.v5Metrics.cacheReason === "reeval:manual:M-02 fail→pass (maintenance?)",
  "A. fail→pass: forced fresh analysis, reason recorded with the (maintenance?) mark (reports/scanA.v5Metrics.cacheReason)");
  assert(retA && !("change_analysis" in retA) && retA.maintenanceSuspected === undefined,
      "A. V7 response carries no change_analysis (V6-only field) and no top-level maintenanceSuspected");
  assert(repA && repA.aiResponse && !("change_analysis" in repA.aiResponse) && !JSON.stringify(repA.aiResponse).includes("maintenance_suspected"),
      "A. persisted reports/scanA.aiResponse carries no change_analysis and no maintenance_suspected");

  // ===== Case B: pass→fail forces a fresh analysis but is NOT maintenance =====
  // Expect: the reason is recorded WITHOUT the (maintenance?) mark; no fake maintenance object fabricated.
  await seedProfile("B", "pass");
  fetchSuccess();
  const retB = await callAnalyze({
    data: {scanId: "scanB", fingerprint: fp("B", [{testId: "M-02", status: "fail"}]), usePrecomputed: true},
    auth: {uid: "u1", token: {}},
  });
  const repB = await getReportDoc("scanB");
  assert(repB && repB.v5Metrics && repB.v5Metrics.cacheHit === false &&
      repB.v5Metrics.cacheReason === "reeval:manual:M-02 pass→fail",
  "B. pass→fail: forced fresh analysis WITHOUT the (maintenance?) mark");
  assert(retB && !("change_analysis" in retB) && !JSON.stringify(retB).includes("maintenance_suspected"),
      "B. no change_analysis and no maintenance_suspected fabricated in the V7 response");

  // ===== Case C: fail→pass AND the model emits a V6-style change_analysis =====
  // V7: the model's change_analysis never reaches the response or the stored document (display is built field by field).
  await seedProfile("C", "fail");
  fetchSuccess({change_analysis: {has_significant_change: true, change_reasons: ["تغيّر اللمس"]}});
  const retC = await callAnalyze({
    data: {scanId: "scanC", fingerprint: fp("C", [{testId: "M-02", status: "pass"}]), usePrecomputed: true},
    auth: {uid: "u1", token: {}},
  });
  const repC = await getReportDoc("scanC");
  assert(repC && repC.v5Metrics && repC.v5Metrics.cacheReason === "reeval:manual:M-02 fail→pass (maintenance?)",
      "C. fail→pass with a model-emitted change_analysis: same recorded reason with the (maintenance?) mark");
  assert(retC && !("change_analysis" in retC) && !JSON.stringify(retC).includes("تغيّر اللمس"),
      "C. the model-emitted change_analysis does not reach the V7 response");
  assert(repC && repC.aiResponse && !JSON.stringify(repC.aiResponse).includes("تغيّر اللمس") && !("change_analysis" in repC.aiResponse),
      "C. nor the stored reports/scanC.aiResponse");

  console.log("\n===== MAINTENANCE-FLAG PLACEMENT E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
