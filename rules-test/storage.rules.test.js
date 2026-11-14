// Storage security-rules behavioral tests.
//
// Run with the Firebase Storage emulator (requires JDK 21+):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only storage --project demo-nc \
//     "node rules-test/storage.rules.test.js"
//
// Validates the hardened storage.rules (fix/storage-rules-hardening):
//   1. A signed-in user cannot READ another path's file (scans/ + reports/ closed).
//   2. An anonymous/authenticated device CAN still upload to scans/ (shop sessions).
//   3. reports/ is fully closed to direct client access (read + write).
//   + shop logo: owner-only write, public read; unauthenticated scans/ write denied.

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {ref, uploadBytes, getBytes} = require("firebase/storage");

const BYTES = new Uint8Array([1, 2, 3, 4]);
const results = [];
let failures = 0;

async function check(name, promise) {
  try {
    await promise;
    results.push(`PASS  ${name}`);
  } catch (e) {
    failures++;
    results.push(`FAIL  ${name} — ${e.message || e}`);
  }
}

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-nc",
    storage: {
      rules: fs.readFileSync(path.join(__dirname, "..", "storage.rules"), "utf8"),
    },
  });

  // Seed files via a rules-bypassing context so we can test READ access.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const s = ctx.storage();
    await uploadBytes(ref(s, "scans/FP_ABC/scan1.ts.json.gz"), BYTES);
    await uploadBytes(ref(s, "reports/scan1/report.pdf"), BYTES);
    await uploadBytes(ref(s, "shops/alice/logo.jpg"), BYTES);
  });

  const alice = testEnv.authenticatedContext("alice");
  const bob = testEnv.authenticatedContext("bob");
  const anon = testEnv.authenticatedContext("anon-customer-9f3"); // anonymous = auth present
  const noauth = testEnv.unauthenticatedContext();

  // (1) Signed-in user cannot READ another user's files (scans/ + reports/ closed).
  await check("1a. signed-in user CANNOT read scans/ time-series",
      assertFails(getBytes(ref(bob.storage(), "scans/FP_ABC/scan1.ts.json.gz"))));
  await check("1b. signed-in user CANNOT read reports/ PDF",
      assertFails(getBytes(ref(bob.storage(), "reports/scan1/report.pdf"))));

  // (2) Anonymous/authenticated device CAN upload to scans/ (shop-session path).
  await check("2a. anonymous device CAN upload to scans/ (shop session)",
      assertSucceeds(uploadBytes(
          ref(anon.storage(), "scans/FP_XYZ/scanNew.ts.json.gz"), BYTES)));
  await check("2b. unauthenticated upload to scans/ is DENIED (auth required)",
      assertFails(uploadBytes(
          ref(noauth.storage(), "scans/FP_NO/scanNo.ts.json.gz"), BYTES)));

  // (3) reports/ fully closed to direct client access.
  await check("3a. client CANNOT write reports/ PDF",
      assertFails(uploadBytes(
          ref(bob.storage(), "reports/scanZ/report.pdf"), BYTES)));
  await check("3b. client CANNOT read reports/ PDF (re-assert)",
      assertFails(getBytes(ref(alice.storage(), "reports/scan1/report.pdf"))));

  // (+) shop logo: owner-only write, public read.
  await check("4a. owner CAN write own shop logo",
      assertSucceeds(uploadBytes(
          ref(alice.storage(), "shops/alice/logo.jpg"), BYTES)));
  await check("4b. other user CANNOT write someone else's shop logo",
      assertFails(uploadBytes(
          ref(bob.storage(), "shops/alice/logo.jpg"), BYTES)));
  await check("4c. public (unauthenticated) CAN read shop logo",
      assertSucceeds(getBytes(ref(noauth.storage(), "shops/alice/logo.jpg"))));

  // (+) catch-all removed: an arbitrary unmatched path is denied for clients.
  await check("5. arbitrary unmatched path is DENIED for signed-in client",
      assertFails(uploadBytes(
          ref(bob.storage(), "random/path/x.bin"), BYTES)));

  await testEnv.cleanup();

  console.log("\n===== STORAGE RULES TEST RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
