// E2E test for legacy promo-plan normalization in redeemPromoCode
// (fix/promo-plan-normalize). Runs the REAL redeemPromoCode callable via
// .run() against the Firestore emulator. No network (no email/FCM since
// seeded users have neither).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/promo_normalize.e2e.test.js"
//
// Verifies legacy 'basic'/'pro' codes now grant canonical shop_basic/shop_pro
// on the user doc (so checkSubscription isShop works) — existing codes are
// protected without manual correction. Canonical codes pass through unchanged.

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const {admin, db} = require("../src/utils/admin");
const {redeemPromoCode} = require("../src/users/redeemPromoCode");

const results = [];
let failures = 0;
function assert(cond, name) {
  if (cond) results.push(`PASS  ${name}`);
  else {
    failures++; results.push(`FAIL  ${name}`);
  }
}

async function seedCode(code, fields) {
  await db.collection("promoCodes").doc(code).set({
    code, usedCount: 0, isActive: true, maxUses: 100, durationDays: 30, ...fields,
  });
}
async function seedUser(uid, fields) {
  await db.collection("users").doc(uid).set(fields);
}
async function getUser(uid) {
  return (await db.collection("users").doc(uid).get()).data();
}
async function redeem(code, uid) {
  // 2026-10-09: redeemPromoCode يرفض المجهول والمزوّد الغائب في أوّل الدالّة (src/utils/signInProvider.js). رمز Firebase الحقيقي
  // يحمل دائماً firebase.sign_in_provider؛ وسياق `token: {}` السابق لا يطابق أيّ رمز حقيقي (القاعدة 23: استُبدل لا أُضيف بجانبه).
  return redeemPromoCode.run({data: {code}, auth: {uid, token: {firebase: {sign_in_provider: "password"}}}});
}

(async () => {
  // Case 1: legacy 'pro' → shop_pro
  await seedCode("LEGACYPRO", {plan: "pro", scans: 150});
  await seedUser("u1", {plan: "free", scansRemaining: 0, scansTotal: 0});
  let ret1 = null;
  try {
    ret1 = await redeem("LEGACYPRO", "u1");
  } catch (e) {
    /* */
  }
  const u1 = await getUser("u1");
  assert(u1.plan === "shop_pro", "1. legacy 'pro' code → user.plan normalized to shop_pro");
  assert(u1.scansRemaining === 150, "1. legacy 'pro' code → scans granted (150)");
  assert(ret1 && ret1.plan === "shop_pro", "1. returned plan normalized to shop_pro");

  // Case 2: legacy 'basic' → shop_basic
  await seedCode("LEGACYBASIC", {plan: "basic", scans: 50});
  await seedUser("u2", {plan: "free", scansRemaining: 0, scansTotal: 0});
  try {
    await redeem("LEGACYBASIC", "u2");
  } catch (e) {
    /* */
  }
  const u2 = await getUser("u2");
  assert(u2.plan === "shop_basic", "2. legacy 'basic' code → user.plan normalized to shop_basic");
  assert(u2.scansRemaining === 50, "2. legacy 'basic' code → scans granted (50)");

  // Case 3: canonical 'shop_pro' passes through unchanged (no double-map)
  await seedCode("CANONPRO", {plan: "shop_pro", scans: 150});
  await seedUser("u3", {plan: "free", scansRemaining: 0, scansTotal: 0});
  try {
    await redeem("CANONPRO", "u3");
  } catch (e) {
    /* */
  }
  const u3 = await getUser("u3");
  assert(u3.plan === "shop_pro", "3. canonical 'shop_pro' code → stays shop_pro (no double-map)");

  // Case 4: scans-only code (plan null) → normalize(null)=null, scans still granted.
  // (Note: wiping plan to null on a scans-only code is PRE-EXISTING behavior,
  // unaffected by normalization — out of scope here.)
  await seedCode("SCANSONLY", {plan: null, scans: 5});
  await seedUser("u4", {plan: "single", scansRemaining: 1, scansTotal: 1});
  try {
    await redeem("SCANSONLY", "u4");
  } catch (e) {
    /* */
  }
  const u4 = await getUser("u4");
  assert(u4.scansRemaining === 6, "4. scans-only code → scans incremented (1→6), no crash on null plan");

  console.log("\n===== PROMO PLAN NORMALIZATION E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
