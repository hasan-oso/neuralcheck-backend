'use strict';

// footerIntegrity.test.js — the deterministic footer checks that do NOT
// belong in the prompt (fix/prompt-fields-version-66).
//
// The prompt teaches the model how to READ fields; that is inference and it
// belongs there. "Do two fields that must agree, disagree?" is arithmetic —
// leaving it to the model means it gets caught sometimes and missed others,
// and when caught it lands in report prose instead of a queryable flag.
//
// The tri-state matters as much as the check. At fieldsVersion <= 65
// maxBatteryTemp carried the END-OF-SCAN temperature, so it legitimately sits
// several degrees below batteryHealth.batteryTempMaxC after the phase-7
// cooldown. Flagging that would fire on every older scan — noise that trains
// people to ignore the flag. The check applies only where agreement is
// actually promised: 66 and up.
//
// Run: node functions/test/footerIntegrity.test.js

const assert = require('assert');
const {
  checkFooterIntegrity, TRUE_MAX_BATTERY_TEMP_SINCE,
  MAX_BATTERY_TEMP_TOLERANCE_C, MAX_STORAGE_PERCENT,
} = require('../src/analysis/footerIntegrity');

const footer = (fv, maxBt, btMax) => ({
  fieldsVersion: fv,
  maxBatteryTemp: maxBt,
  batteryHealth: btMax === undefined ? {} : {batteryTempMaxC: btMax},
});

let n = 0;
const ok = (c, m) => {
  assert.ok(c, m); n++;
};

// ─── 1. fieldsVersion extraction ────────────────────────────────────────
{
  ok(checkFooterIntegrity(footer(66, 41.2, 41.2)).fieldsVersion === 66,
      'numeric fieldsVersion is returned');
  ok(checkFooterIntegrity({}).fieldsVersion === null,
      'absent fieldsVersion → null');
  ok(checkFooterIntegrity({fieldsVersion: '66'}).fieldsVersion === null,
      'string fieldsVersion → null (no coercion)');
  ok(checkFooterIntegrity(null).fieldsVersion === null,
      'null footer does not throw');
  ok(checkFooterIntegrity(undefined).fieldsVersion === null,
      'undefined footer does not throw');
  ok(checkFooterIntegrity({fieldsVersion: 0}).fieldsVersion === 0,
      'fieldsVersion 0 preserved (0 is a real sentinel, not absence)');
}

// ─── 2. 66+: the two fields must agree ──────────────────────────────────
{
  const same = checkFooterIntegrity(footer(66, 41.2, 41.2));
  ok(same.maxBatteryTempMismatch === false, '66 + equal values → no mismatch');
  ok(same.maxBatteryTempDeltaC === 0, '66 + equal values → delta 0');

  // The real <=65-semantics-leaking-into-66 failure: an end-of-scan value
  // after a cooldown, several degrees under the true peak.
  const stale = checkFooterIntegrity(footer(66, 36.5, 41.2));
  ok(stale.maxBatteryTempMismatch === true,
      '66 + end-of-scan value instead of peak → MISMATCH');
  ok(stale.maxBatteryTempDeltaC === -4.7,
      'delta is reported signed and rounded (-4.7)');

  ok(checkFooterIntegrity(footer(67, 30, 41.2)).maxBatteryTempMismatch === true,
      'check applies to every version above 66, not just 66');
}

// ─── 3. Tolerance separates rounding from wrong semantics ───────────────
{
  ok(MAX_BATTERY_TEMP_TOLERANCE_C === 0.5, 'tolerance is 0.5°C');

  ok(checkFooterIntegrity(footer(66, 41.2, 41.0)).maxBatteryTempMismatch === false,
      '0.2°C apart → rounding, not a mismatch');
  ok(checkFooterIntegrity(footer(66, 41.5, 41.0)).maxBatteryTempMismatch === false,
      'exactly at tolerance → not a mismatch');
  ok(checkFooterIntegrity(footer(66, 41.6, 41.0)).maxBatteryTempMismatch === true,
      'just past tolerance → mismatch');
  // Direction-agnostic: either field can be the stale one.
  ok(checkFooterIntegrity(footer(66, 45.0, 41.0)).maxBatteryTempMismatch === true,
      'mismatch is detected in both directions');
}

// ─── 4. Below 66 the divergence is EXPECTED — never flag it ─────────────
{
  ok(TRUE_MAX_BATTERY_TEMP_SINCE === 66, 'threshold is fieldsVersion 66');

  const old = checkFooterIntegrity(footer(65, 36.5, 41.2));
  ok(old.maxBatteryTempMismatch === null,
      '65 + large gap → null, NOT true (end-of-scan semantics are expected)');
  ok(old.maxBatteryTempDeltaC === null,
      '65 → no delta computed; there is nothing to compare');

  ok(checkFooterIntegrity(footer(62, 30, 45)).maxBatteryTempMismatch === null,
      'older versions equally exempt');
}

// ─── 5. Not applicable → null, never a false alarm ──────────────────────
{
  ok(checkFooterIntegrity(footer(undefined, 36.5, 41.2)).maxBatteryTempMismatch === null,
      'absent fieldsVersion → null (cannot know which semantics apply)');
  ok(checkFooterIntegrity(footer(66, undefined, 41.2)).maxBatteryTempMismatch === null,
      'missing maxBatteryTemp → null');
  ok(checkFooterIntegrity(footer(66, 41.2, undefined)).maxBatteryTempMismatch === null,
      'missing batteryTempMaxC → null');
  ok(checkFooterIntegrity({fieldsVersion: 66}).maxBatteryTempMismatch === null,
      'neither field present → null');
  ok(checkFooterIntegrity(footer(66, -1, 41.2)).maxBatteryTempMismatch === true,
      '-1 is a real number here and IS compared (a sentinel leaking in is a bug)');
}

// ─── 6. The flag reaches Firestore without touching analyzeDevice ───────
// callAI returns footerIntegrity; runAnalysisInternal folds it into
// v5Metrics; analyzeDevice already persists v5Metrics verbatim. That last
// link is the point — the flag is stored with no change to the write path.
{
  const fs = require('fs');
  const callAi = fs.readFileSync(
      require.resolve('../src/analysis/callAI'), 'utf8');
  const runInternal = fs.readFileSync(
      require.resolve('../src/analysis/runAnalysisInternal'), 'utf8');
  const analyze = fs.readFileSync(
      require.resolve('../src/analysis/analyzeDevice'), 'utf8');

  ok(/fieldsVersion=\$\{integrity\.fieldsVersion/.test(callAi),
      'callAI logs fieldsVersion on every V6 call');
  ok(/integrity\.maxBatteryTempMismatch === true/.test(callAi),
      'callAI logs the mismatch at error level, and only when true');
  ok(/footerIntegrity: integrity/.test(callAi),
      'callAI returns the integrity result to its caller');

  ok(/maxBatteryTempMismatch:\s*\n?\s*callAiRaw\.footerIntegrity/.test(runInternal),
      'runAnalysisInternal folds the flag into v5Metrics');
  ok(/fieldsVersion: callAiRaw\.footerIntegrity/.test(runInternal),
      'runAnalysisInternal folds fieldsVersion into v5Metrics');
  ok(/storagePercentInvalid:\s*\n?\s*callAiRaw\.footerIntegrity/.test(runInternal),
      'runAnalysisInternal folds storagePercentInvalid into v5Metrics');
  ok(/availableStorageGbInvalid:\s*\n?\s*callAiRaw\.footerIntegrity/.test(runInternal),
      'runAnalysisInternal folds availableStorageGbInvalid into v5Metrics');
  ok(/checkFooterIntegrity\(\s*\n?\s*rawFingerprintForAi\.footer, rawFingerprintForAi\.device/
      .test(callAi),
  'callAI passes device alongside footer so the storage checks can run');
  ok(/integrity\.storagePercentInvalid === true/.test(callAi) &&
     /integrity\.availableStorageGbInvalid === true/.test(callAi),
  'callAI logs each storage flag at error level, and only when true');

  ok(/v5Metrics: p\.v5Metrics \|\| null/.test(analyze),
      'analyzeDevice persists v5Metrics verbatim — no write-path change needed (buildReportDocument, 2026-09-24 extraction)');
}

// ─── 7. Storage impossibility checks (fieldsVersion 67) ─────────────────
// storagePercent and availableStorageGb changed meaning at 67 while keeping
// their name AND their type, so nothing downstream errors — a <=66 write
// speed of 635 simply reads as "635% free" and becomes a healthy verdict.
//
// These two checks deliberately do NOT require fieldsVersion. Gating them on
// the version would disarm them exactly where they are needed: a row with no
// version is the row whose meaning is unknown, so it must be checked, not
// excused. They are impossibility checks, not version checks — a percentage
// above 100 is impossible and free space above capacity is impossible, at
// every version.
const dev = (o) => ({device: o});

// (a) storagePercent — both observed <=66 values are caught.
{
  ok(checkFooterIntegrity({}, {storagePercent: 635}).storagePercentInvalid === true,
      'observed 635 MB/s write speed → INVALID as a percentage');
  ok(checkFooterIntegrity({}, {storagePercent: 166}).storagePercentInvalid === true,
      'observed 166 MB/s write speed → INVALID as a percentage');
  ok(checkFooterIntegrity({}, {storagePercent: 100}).storagePercentInvalid === false,
      '100 is a legal percentage — boundary is exclusive');
  ok(checkFooterIntegrity({}, {storagePercent: 67.5}).storagePercentInvalid === false,
      'a plausible percentage is not flagged');
  ok(checkFooterIntegrity({}, {storagePercent: 0}).storagePercentInvalid === false,
      '0% free is legal (a full disk), not an error');
  ok(MAX_STORAGE_PERCENT === 100, 'threshold is 100');
}

// (b) The check runs WITHOUT fieldsVersion, and at every version.
{
  ok(checkFooterIntegrity({}, {storagePercent: 635}).fieldsVersion === null,
      'no fieldsVersion present in this fixture');
  ok(checkFooterIntegrity({fieldsVersion: 67}, {storagePercent: 635})
      .storagePercentInvalid === true,
  'flagged even when the version claims 67 — a mislabelled build is caught');
  ok(checkFooterIntegrity({fieldsVersion: 65}, {storagePercent: 635})
      .storagePercentInvalid === true,
  'flagged on old versions too');
}

// (c) availableStorageGb — free space cannot exceed capacity.
{
  ok(checkFooterIntegrity({}, {availableStorageGb: 149.2, totalStorageGb: 220.9})
      .availableStorageGbInvalid === false,
  'real free space below capacity → valid');
  ok(checkFooterIntegrity({}, {availableStorageGb: 67.5, totalStorageGb: 64})
      .availableStorageGbInvalid === true,
  'a 67.5% value on a 64 GB device exceeds capacity → INVALID');
  ok(checkFooterIntegrity({}, {availableStorageGb: 64, totalStorageGb: 64})
      .availableStorageGbInvalid === false,
  'free == total is legal (an empty device)');
}

// (d) COVERAGE LIMIT, asserted rather than assumed.
// The observed bad row was 67.5 reported as GB on a device with 220.9 GB
// total — and 67.5 <= 220.9, so this check CANNOT catch it. Writing a test
// that pretends otherwise would hide the gap. The consistency check only
// catches a percentage on a device small enough for the percentage to exceed
// its capacity; the prompt's version branch is what covers the rest, which is
// why both were kept.
{
  const observed = checkFooterIntegrity(
      {}, {availableStorageGb: 67.5, totalStorageGb: 220.9});
  ok(observed.availableStorageGbInvalid === false,
      'the observed 67.5-on-220.9 row is NOT caught — documented coverage gap');
}

// (e) Not applicable → null, never a false alarm.
{
  ok(checkFooterIntegrity({}, {}).storagePercentInvalid === null,
      'missing storagePercent → null');
  ok(checkFooterIntegrity({}).storagePercentInvalid === null,
      'absent device object → null, no throw');
  ok(checkFooterIntegrity({}, {storagePercent: '635'}).storagePercentInvalid === null,
      'string storagePercent → null (no coercion)');
  ok(checkFooterIntegrity({}, {availableStorageGb: 67.5}).availableStorageGbInvalid === null,
      'no totalStorageGb → null, nothing to compare against');
  ok(checkFooterIntegrity({}, {availableStorageGb: 67.5, totalStorageGb: 0})
      .availableStorageGbInvalid === null,
  'totalStorageGb 0 → null, not a division-by-nothing verdict');
  ok(checkFooterIntegrity({}, {totalStorageGb: 220.9}).availableStorageGbInvalid === null,
      'no availableStorageGb → null');
}

// (f) The storage checks are independent of the battery check.
{
  const r = checkFooterIntegrity(
      {fieldsVersion: 67, maxBatteryTemp: 41.2, batteryHealth: {batteryTempMaxC: 41.2}},
      {storagePercent: 635, availableStorageGb: 300, totalStorageGb: 220.9});
  ok(r.maxBatteryTempMismatch === false, 'battery check unaffected');
  ok(r.storagePercentInvalid === true && r.availableStorageGbInvalid === true,
      'both storage flags raised independently in the same call');
}

console.log(`footerIntegrity: ${n}/${n} assertions passed`);
