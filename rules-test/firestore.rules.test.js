// Firestore security-rules tests for the users/{uid} self-write hardening
// (fix/users-selfwrite-rule).
//
// Run with the Firestore emulator (requires JDK 21+):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node rules-test/firestore.rules.test.js"
//
// Validates: a user can NO LONGER self-grant credits; can still write the
// non-sensitive profile/device fields the app legitimately writes; cross-user
// writes blocked; admins + server (Admin SDK) unaffected.

require("../functions/test/lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {doc, setDoc, updateDoc} = require("firebase/firestore");

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
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
    },
  });

  // Seed alice + bob via rules-bypass (simulates server/Admin SDK create).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, "users/alice"), {
      scansRemaining: 5, scansTotal: 5, plan: "single",
      isActive: true, fcmToken: "old-token",
    });
    await setDoc(doc(d, "users/bob"), {scansRemaining: 5, plan: "single"});
  });

  const alice = testEnv.authenticatedContext("alice"); // regular user
  const adminCtx = testEnv.authenticatedContext("adminUid", {
    email: "admin1@example.com", // matches firestore.rules isAdmin()
    email_verified: true, // isAdmin() requires it since 2026-10-09 (an unverified admin email is rejected)
  });

  // (1) THE FIX: user cannot self-grant credits.
  await check("1. user CANNOT write scansRemaining to own doc",
      assertFails(updateDoc(doc(alice.firestore(), "users/alice"), {scansRemaining: 9999})));
  await check("1b. user CANNOT write plan/expiresAt/isActive to own doc",
      assertFails(updateDoc(doc(alice.firestore(), "users/alice"),
          {plan: "shop_pro", isActive: true})));

  // (2) user CAN still write the non-sensitive fields the app writes.
  await check("2a. user CAN write fcmToken to own doc",
      assertSucceeds(updateDoc(doc(alice.firestore(), "users/alice"), {fcmToken: "new-token"})));
  await check("2b. user CAN write shop profile fields to own doc",
      assertSucceeds(updateDoc(doc(alice.firestore(), "users/alice"), {
        shopName: "متجري", shopCity: "دمشق", shopPhone: "0900",
        shopAddress: "شارع", shopDescription: "وصف",
      })));

  // (3) mixing an allowed field with a sensitive one is still rejected (hasOnly).
  await check("3. user CANNOT smuggle scansRemaining alongside fcmToken",
      assertFails(updateDoc(doc(alice.firestore(), "users/alice"),
          {fcmToken: "x", scansRemaining: 500})));

  // (4) cross-user write blocked.
  await check("4. user CANNOT write another user's doc",
      assertFails(updateDoc(doc(alice.firestore(), "users/bob"), {fcmToken: "z"})));

  // (5) client cannot create a users doc (registerUser/Admin SDK owns creation).
  await check("5. user CANNOT create a fresh users doc (self-seed credits)",
      assertFails(setDoc(doc(alice.firestore(), "users/alice2"),
          {scansRemaining: 1000, plan: "shop_pro"})));

  // (6) admin still has full write (dashboard not broken).
  await check("6. admin CAN write scansRemaining to any user",
      assertSucceeds(updateDoc(doc(adminCtx.firestore(), "users/alice"), {scansRemaining: 150})));

  // (7) server (Admin SDK ≈ rules disabled) can write sensitive fields.
  await check("7. server (Admin SDK) CAN write scansRemaining",
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "users/alice"), {scansRemaining: 50, plan: "shop_pro"});
      }));

  await testEnv.cleanup();
  console.log("\n===== FIRESTORE RULES TEST RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
