// Unit test for the defect-oriented + directional reevaluation decision
// (fix/reevaluation-defect-directional). Pure functions — no emulator needed.
//   node functions/test/reevaluation.test.js

const {computeScanSignature} = require("../src/signatures/computeScanSignature");
const {signatureDifference} = require("../src/signatures/signatureDifference");
const {reevaluationDecision} = require("../src/signatures/reevaluationDecision");

// Build a fingerprint with a healthy baseline + overrides.
function fp({vr = {}, battery = {}, manual = [], functional = []} = {}) {
  return {
    timeSeries: {
      footer: {
        verificationResults: {
          cpuPrimeSieveCorrect: true, memoryMarchPassed: true,
          memoryWalkingOnesPassed: true, gpuComputeGemmCorrect: true,
          criticalDefectDetected: false, cpuFmaErrors: 0,
          memoryRandomVerifyErrors: 0, storageWriteVerifyErrors: 0,
          storageReadVerifyErrors: 0, ...vr,
        },
        stressEffectiveness: {passedSaturationThreshold: true},
        dataQuality: {},
        batteryHealth: {
          designCapacityMah: 5000, cycleCount: 200,
          voltageStabilityMv: 30, dischargeRateUnderLoadMa: 2500,
          batteryTempRiseC: 5, ...battery,
        },
      },
    },
    functionalResults: functional,
    manualResults: manual,
  };
}
function sig(over) {
  return computeScanSignature(fp(over));
}

const results = [];
let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}
// decision(newOverrides, oldOverrides)
function decide(newOver, oldOver) {
  return reevaluationDecision(sig(newOver), sig(oldOver));
}

// 1. verification cpuPrimeSieveCorrect pass→fail → force (not diluted)
{
  const d = decide({vr: {cpuPrimeSieveCorrect: false}}, {});
  assert(d.forceReevaluate && d.reasons.some((r) => /cpuPrimeSieveCorrect/.test(r)),
      "1. verification pass→fail (cpuPrimeSieveCorrect) → forceReevaluate");
  // and confirm the aggregate alone would have DILUTED it (< 20%)
  const agg = signatureDifference(sig({vr: {cpuPrimeSieveCorrect: false}}), sig({}));
  assert(agg < 0.20, `1b. aggregate alone = ${(agg * 100).toFixed(1)}% < 20% (would have been missed)`);
}

// 2. criticalDefectDetected →true → force
{
  const d = decide({vr: {criticalDefectDetected: true}}, {});
  assert(d.forceReevaluate && d.reasons.some((r) => /criticalDefectDetected/.test(r)),
      "2. criticalDefectDetected →true → forceReevaluate");
}

// 2c. error counter 0→positive → force
{
  const d = decide({vr: {memoryRandomVerifyErrors: 3}}, {});
  assert(d.forceReevaluate && d.reasons.some((r) => /memoryRandomVerifyErrors/.test(r)),
      "2c. error counter 0→3 → forceReevaluate");
}

// 3. manual M-02 pass→fail → force
{
  const d = decide({manual: [{testId: "M-02", status: "fail"}]},
      {manual: [{testId: "M-02", status: "pass"}]});
  assert(d.forceReevaluate && d.reasons.some((r) => /M-02 pass→fail/.test(r)),
      "3. manual M-02 pass→fail → forceReevaluate");
}

// 4. manual pass→not_tested → NO force (the bug fix: not_tested ≠ fail)
{
  const d = decide({manual: [{testId: "M-02", status: "not_tested"}]},
      {manual: [{testId: "M-02", status: "pass"}]});
  assert(!d.forceReevaluate, "4. manual pass→not_tested → NO reevaluation (not_tested ≠ fail)");
}

// 4b. manual not_tested→pass → NO force
{
  const d = decide({manual: [{testId: "M-02", status: "pass"}]},
      {manual: [{testId: "M-02", status: "not_tested"}]});
  assert(!d.forceReevaluate, "4b. manual not_tested→pass → NO reevaluation");
}

// 4c. manual not_tested→fail → force (defect appeared)
{
  const d = decide({manual: [{testId: "M-02", status: "fail"}]},
      {manual: [{testId: "M-02", status: "not_tested"}]});
  assert(d.forceReevaluate, "4c. manual not_tested→fail → forceReevaluate");
}

// 5. manual fail→pass → force + maintenanceSuspected
{
  const d = decide({manual: [{testId: "M-02", status: "pass"}]},
      {manual: [{testId: "M-02", status: "fail"}]});
  assert(d.forceReevaluate && d.maintenanceSuspected === true,
      "5. manual fail→pass → forceReevaluate + maintenanceSuspected");
}

// 6. battery designCapacityMah changed → force
{
  const d = decide({battery: {designCapacityMah: 4000}}, {battery: {designCapacityMah: 5000}});
  assert(d.forceReevaluate && d.reasons.some((r) => /designCapacityMah/.test(r)),
      "6. battery designCapacityMah 5000→4000 → forceReevaluate (swap)");
}

// 7. healthy: identical objective facts (only AI score differs / natural noise)
//    → NO reevaluation. score is not in the signature at all.
{
  const d = decide({}, {});
  const agg = signatureDifference(sig({}), sig({}));
  assert(!d.forceReevaluate && agg === 0,
      "7. healthy rescan (no fact change) → NO reevaluation (forceReeval=false, agg=0)");
}

// 7b. confirm signature now carries battery + manual blocks
{
  const s = sig({manual: [{testId: "M-01", status: "pass"}]});
  assert(s.battery && typeof s.battery.designCapacityMah === "number" &&
      s.manual && s.manual["M-01"] === "pass",
  "7b. signature now includes battery + manual blocks");
}

console.log("\n===== REEVALUATION DECISION UNIT TEST =====");
results.forEach((r) => console.log(r));
console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
