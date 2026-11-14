// Unit test for Task 4 — pipelineVersion in scan signature.
// Run: node functions/test/signature.test.js
//
// Validates two properties:
//   1. Two signatures with different pipelineVersion → signatureDifference == 1.0
//      (forces a cache miss when V4 lands).
//   2. Two signatures from identical fingerprints → signatureDifference < 0.01
//      (deterministic; no false invalidations).

const assert = require("assert");

const {computeScanSignature} = require("../src/signatures/computeScanSignature");
const {signatureDifference} = require("../src/signatures/signatureDifference");
const {PIPELINE_VERSION} = require("../src/signatures/constants");

// Minimal fingerprint mock with all the fields signature looks at.
const mockFingerprint = {
  timeSeries: {
    footer: {
      verificationResults: {
        cpuFmaErrors: 0,
        cpuPrimeSieveCorrect: true,
        memoryMarchPassed: true,
        memoryWalkingOnesPassed: true,
        memoryRandomVerifyErrors: 0,
        storageWriteVerifyErrors: 0,
        storageReadVerifyErrors: 0,
        gpuComputeGemmCorrect: true,
        criticalDefectDetected: false,
      },
      stressEffectiveness: {
        passedSaturationThreshold: true,
        saturationFailureReason: "",
      },
      dataQuality: {
        cpuTempCoveragePct: 80,
        skinTempCoveragePct: 80,
        batteryScalingLocked: true,
      },
      batteryHealth: {
        sohOfficialPercent: 92,
      },
    },
  },
  functionalResults: [
    {testId: "B-01", categoryName: "battery", status: "pass"},
    {testId: "T-01", categoryName: "thermal", status: "pass"},
    {testId: "C-01", categoryName: "cpu", status: "pass"},
  ],
};

// --- Test 1: pipelineVersion mismatch forces full miss ---
const sig1 = computeScanSignature(mockFingerprint);
assert.strictEqual(sig1.pipelineVersion, PIPELINE_VERSION,
    "computeScanSignature must bake in PIPELINE_VERSION");
assert.strictEqual(PIPELINE_VERSION, "v4-2026-09-24-decision-76-3",
    "Current production label expected to be v4-2026-09-24-decision-76-3 (القرار ٧٦ البند ٣، 2026-09-24 +03)");

const sig1Modified = {...sig1, pipelineVersion: "v4-layer123"};
assert.strictEqual(
    signatureDifference(sig1, sig1Modified), 1.0,
    "Different pipelineVersion must yield difference == 1.0",
);

// --- Test 2: identical fingerprints yield ~0 difference ---
const sig2 = computeScanSignature(mockFingerprint);
const diff = signatureDifference(sig1, sig2);
assert(diff < 0.01,
    `Identical fingerprints must yield difference < 0.01, got ${diff}`);

// --- Test 3: missing-side returns 1.0 (existing behavior, unchanged) ---
assert.strictEqual(signatureDifference(null, sig1), 1.0);
assert.strictEqual(signatureDifference(sig1, null), 1.0);

console.log("PASS  signature.test.js");
console.log(`      PIPELINE_VERSION = ${PIPELINE_VERSION}`);
console.log(`      sig1 == sig2 difference = ${diff}`);
console.log(`      v3 vs v4 difference     = 1.0 (forced miss)`);
