// End-to-end test for monthly-subscription expiry enforcement
// (feat/subscription-expiry). Runs the REAL callables/scheduled job via their
// v2 `.run()` entry against the Firestore EMULATOR. AI HTTP is stubbed.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/subscription_expiry.e2e.test.js"
//
// Cases:
//   1. expired sub + remaining credit -> analyzeDevice REJECTS
//   2. active sub + credit            -> analyzeDevice SUCCEEDS (decrements)
//   3. new purchase                   -> RESETS balance to plan value + 30d expiry
//   4. legacy user (no expiresAt)     -> analyzeDevice SUCCEEDS (no expiry)
//   5. scheduled job                  -> deactivates expired (isActive=false; balance KEPT — A-SUB item 4a, 2026-10-17)
//   6. createScanSession expired owner-> REJECTS
//
// 2026-10-09 (ملفّات e2e الستّ قبل أوّل نشر V8، القاعدة 23 — استبدال لا إضافة): الحالتان 2 و4 كانتا تؤكّدان
// `typeof ret.grade === "string"` وCANNED_AI بشكل V6. المسار الحيّ منذ fd3a6ce V7: الردّ بلا grade/score (القرار ٥)، وجسم V6 يرفضه
// الحارس (`need one of narrative`) فيمرّ التحليل على مسار فشل المزوّد. صار الكعب جسم V7 سليماً (lib/v7ProviderStub.js)،
// والتأكيد على ما ينتجه الكود: pipeline=V7 و`overall` كائن (حرفه null على بصمة فارغة — لا شيء مقيس).

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// الاستبدال للشبكة وحدها (القاعدة 37): ردّ مزوّد V7 سليم الشكل.
const {installDeepSeekStub} = require("./lib/v7ProviderStub");
installDeepSeekStub();
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");
const isV7Analysis = (r) => !!(r && r.pipeline === V7_PIPELINE_TAG && r.overall && typeof r.overall === "object");

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {confirmPayment} = require("../src/payments/confirmPayment");
const {createScanSession} = require("../src/sessions/createScanSession");
const {checkExpiringSubscriptions} = require("../src/notifications/checkExpiringSubscriptions");

const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [], manualResults: [],
};

const results = [];
let failures = 0;
function assert(cond, name) {
  if (cond) results.push(`PASS  ${name}`);
  else {
    failures++; results.push(`FAIL  ${name}`);
  }
}
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const getUser = async (uid) => (await db.collection("users").doc(uid).get()).data();

async function callAnalyze({data, auth}) {
  return analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
}

(async () => {
  // ===== Case 1: expired sub + remaining credit -> REJECT =====
  {
    await db.collection("users").doc("expUser").set({
      scansRemaining: 5, scansTotal: 5, plan: "single",
      isActive: true, expiresAt: daysFromNow(-1),
    });
    let threw = null;
    try {
      await callAnalyze({data: {scanId: "s-exp1", fingerprint: FINGERPRINT, usePrecomputed: true}, auth: {uid: "expUser", token: {}}});
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "permission-denied" && /انتهى اشتراكك/.test(threw.message),
        "1. expired sub + credit: scan REJECTED with renew message");
    assert((await getUser("expUser")).scansRemaining === 5, "1. expired sub: credit NOT consumed (stays 5)");
    const rep = await db.collection("reports").doc("s-exp1").get();
    assert(!rep.exists, "1. expired sub: no report created");
  }

  // ===== Case 2: active sub + credit -> SUCCEED =====
  {
    await db.collection("users").doc("actUser").set({
      scansRemaining: 5, scansTotal: 5, plan: "single",
      isActive: true, expiresAt: daysFromNow(20),
    });
    let threw = null; let ret = null;
    try {
      ret = await callAnalyze({data: {scanId: "s-act1", fingerprint: FINGERPRINT, usePrecomputed: true}, auth: {uid: "actUser", token: {}}});
    } catch (e) {
      threw = e;
    }
    assert(threw === null && isV7Analysis(ret), "2. active sub: scan SUCCEEDS (returns the V7 analysis)");
    assert((await getUser("actUser")).scansRemaining === 4, "2. active sub: credit consumed (5 -> 4)");
  }

  // ===== Case 3: new purchase RESETS balance + 30d expiry =====
  {
    // buyer already had a big leftover balance + old expiry + a stale reminder flag
    await db.collection("users").doc("buyer1").set({
      scansRemaining: 999, scansTotal: 999, plan: "shop_basic",
      isActive: true, expiresAt: daysFromNow(-5), subExpiryEmailSent: true,
    });
    await db.collection("payments").doc("pay1").set({
      userId: "buyer1", plan: "shop_pro", scansGranted: 150,
      amountUsd: 20, status: "pending",
    });
    let threw = null;
    try {
      await confirmPayment.run({data: {paymentId: "pay1"}, auth: {uid: "admin", token: {email: "admin1@example.com", email_verified: true}}}); // requireAdmin needs email_verified since 2026-10-09 (rule 23: the unverified context proved the behaviour being removed)
    } catch (e) {
      threw = e;
    }
    const b = await getUser("buyer1");
    const exp = b.expiresAt && b.expiresAt.toDate ? b.expiresAt.toDate() : null;
    assert(threw === null, "3. new purchase: confirmPayment ran (admin)");
    assert(b.scansRemaining === 150, "3. new purchase: balance RESET to plan value (150, not 999+150)");
    assert(b.plan === "shop_pro", "3. new purchase: plan updated to shop_pro");
    assert(exp && exp > daysFromNow(29) && exp < daysFromNow(31), "3. new purchase: expiresAt set to ~now+30d");
    assert(b.subExpiryEmailSent === undefined, "3. new purchase: stale reminder flag cleared");
  }

  // ===== Case 4: legacy user (no expiresAt) -> SUCCEED =====
  {
    await db.collection("users").doc("legacyUser").set({
      scansRemaining: 5, scansTotal: 5, plan: "single", isActive: true,
      // intentionally NO expiresAt field
    });
    let threw = null; let ret = null;
    try {
      ret = await callAnalyze({data: {scanId: "s-leg1", fingerprint: FINGERPRINT, usePrecomputed: true}, auth: {uid: "legacyUser", token: {}}});
    } catch (e) {
      threw = e;
    }
    assert(threw === null && isV7Analysis(ret), "4. legacy (no expiresAt): scan SUCCEEDS (no expiry; returns the V7 analysis)");
    assert((await getUser("legacyUser")).scansRemaining === 4, "4. legacy: credit consumed (5 -> 4)");
  }

  // ===== Case 5: scheduled job deactivates expired =====
  {
    await db.collection("users").doc("jobExp").set({
      scansRemaining: 7, scansTotal: 7, plan: "shop_pro",
      isActive: true, expiresAt: daysFromNow(-2), // expired, no email/fcm -> no sends
    });
    await db.collection("users").doc("jobActive").set({
      scansRemaining: 9, scansTotal: 9, plan: "shop_pro",
      isActive: true, expiresAt: daysFromNow(20), // healthy -> untouched
    });
    await checkExpiringSubscriptions.run({});
    const e = await getUser("jobExp");
    const a = await getUser("jobActive");
    // A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال): كانت تُثبت «scans=0»؛ قرار المستخدم 2026-10-14: (أ) يطفئ ولا يصفّر، والانتهاء تحكم به البوّابة عبر expiresAt (الحالة 1 أعلاه). التفصيل في checkExpiringSubscriptionsSections.e2e.test.js.
    assert(e.scansRemaining === 7 && e.isActive === false, "5. job: expired user DEACTIVATED (isActive=false) and its balance KEPT (7, not zeroed)");
    assert(e.subExpiredNotified === true, "5. job: expired user flagged subExpiredNotified");
    assert(a.scansRemaining === 9 && a.isActive === true, "5. job: healthy user UNTOUCHED");
  }

  // ===== Case 6: createScanSession with expired owner -> REJECT =====
  {
    await db.collection("users").doc("shopExp").set({
      scansRemaining: 10, scansTotal: 10, plan: "shop_pro",
      isActive: true, expiresAt: daysFromNow(-1),
    });
    let threw = null;
    try {
      await createScanSession.run({data: {}, auth: {uid: "shopExp", token: {email: "shop@x.com"}}});
    } catch (e) {
      threw = e;
    }
    assert(threw && threw.code === "permission-denied" && /انتهى اشتراكك/.test(threw.message),
        "6. createScanSession expired owner: REJECTED");
  }

  console.log("\n===== SUBSCRIPTION EXPIRY E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
