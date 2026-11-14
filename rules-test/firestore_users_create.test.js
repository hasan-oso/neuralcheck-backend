// Firestore rules test for the users/{uid} CREATE-path restore
// (fix/users-allow-create-shopsave). The self-write hardening removed the
// user's ability to create its own doc, which broke shop-save (set-merge)
// whenever the doc was absent → permission_denied. We restore create with the
// SAME non-sensitive allowlist (no credit self-seed). Update behavior + the
// sensitive-field block are re-verified for regression.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node rules-test/firestore_users_create.test.js"

require("../functions/test/lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const fs = require("fs");
const path = require("path");
const {initializeTestEnvironment, assertSucceeds, assertFails} =
  require("@firebase/rules-unit-testing");
const {doc, setDoc, updateDoc, getDocs, query, collection, where} =
  require("firebase/firestore");

const SHOP = {
  shopName: "متجري", shopDescription: "وصف", shopCity: "دمشق",
  shopPhone: "0900", shopAddress: "شارع", shopSlug: "my-shop", shopLogoUrl: "http://u",
};

const results = [];
let failures = 0;
async function check(name, p) {
  try {
    await p; results.push(`PASS  ${name}`);
  } catch (e) {
    failures++; results.push(`FAIL  ${name} — ${e.message || e}`);
  }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-nc",
    firestore: {rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")},
  });

  // Seed an EXISTING user doc (simulates registerUser/Admin SDK) for update tests.
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users/owner"), {
      plan: "shop_pro", scansRemaining: 150, scansTotal: 150, isActive: true,
      email: "e@x.com", name: "n", shopSlug: "existing",
    });
  });

  const alice = env.authenticatedContext("alice"); // fresh user, no doc yet
  const owner = env.authenticatedContext("owner"); // existing doc

  // ---- THE FIX: create own doc with non-sensitive shop fields ----
  await check("1. CREATE own doc with shop fields → ALLOW (fixes shop-save on absent doc)",
      assertSucceeds(setDoc(doc(alice.firestore(), "users/alice"), SHOP)));

  // (re-seed alice gone via cleanup between? No — keep; next creates use new uids)
  const bob = env.authenticatedContext("bob");
  await check("2. CREATE own doc with shop + fcmToken → ALLOW",
      assertSucceeds(setDoc(doc(bob.firestore(), "users/bob"),
          {fcmToken: "t", shopName: "x", shopCity: "c"})));

  // ---- Vulnerability stays closed: cannot self-seed credits via CREATE ----
  const carol = env.authenticatedContext("carol");
  await check("3. CREATE own doc with scansRemaining → DENY (no credit self-seed)",
      assertFails(setDoc(doc(carol.firestore(), "users/carol"),
          {scansRemaining: 9999, plan: "shop_pro"})));
  const dave = env.authenticatedContext("dave");
  await check("4. CREATE own doc mixing shop + scansRemaining → DENY",
      assertFails(setDoc(doc(dave.firestore(), "users/dave"),
          {shopName: "x", scansRemaining: 500})));
  await check("5. CREATE another user's doc → DENY",
      assertFails(setDoc(doc(alice.firestore(), "users/someoneelse"), {shopName: "x"})));

  // ---- Regression: update path unchanged ----
  await check("6. UPDATE existing doc shop fields → ALLOW (unchanged)",
      assertSucceeds(updateDoc(doc(owner.firestore(), "users/owner"),
          {shopName: "new", shopCity: "حلب"})));
  await check("7. UPDATE existing doc scansRemaining → DENY (still blocked)",
      assertFails(updateDoc(doc(owner.firestore(), "users/owner"), {scansRemaining: 9999})));

  // ---- T4 (documented, SEPARATE issue): slug-uniqueness query still denied ----
  // This is the likely real blocker for first-time shop setup (ensureSlugUnique).
  // It is PRE-EXISTING (read rule unchanged) and CANNOT be fixed by broadening
  // the users read rule without leaking all user data — needs an app/architecture
  // fix. Asserted here to document the current behavior.
  await check("8. [DOCUMENTED] slug query (where shopSlug==) → still DENY (T4, separate fix needed)",
      assertFails(getDocs(query(collection(owner.firestore(), "users"),
          where("shopSlug", "==", "existing")))));

  await env.cleanup();
  console.log("\n===== USERS CREATE-PATH RULES TEST =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
