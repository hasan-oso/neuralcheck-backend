// Firestore security-rules tests for the report-read lockdown
// (أمر مستخدم 2026-10-09، "إصلاح القواعد"، بنصّه):
//   «1. حذف :65-66 [قراءة أي مصادَق للمعروض/المباع]. 2. isAdmin() يشترط
//    request.auth.token.email_verified == true. … يُرفض: مجهول وغريب على
//    تقرير معروض، وبريد مشرف غير مؤكَّد. ويُقبل: المالك، والمشرف المؤكَّد،
//    والخادم.»
//
// Run with the Firestore emulator (requires JDK 21+):
//   firebase emulators:exec --only firestore --project demo-nc \
//     "node rules-test/reports.rules.test.js"
//
// Negative control (the test must DETECT the old behaviour — rule 37): point it at
// a copy of the rules from before the fix, e.g.
//   git show 34fcb71:firestore.rules > <tmp>/firestore.rules.old
//   RULES_PATH=<tmp>/firestore.rules.old firebase emulators:exec --only firestore \
//     --project demo-nc "node rules-test/reports.rules.test.js"
// — cases A1..A4 (anonymous / foreign / list / sold) and A6..A7 (unverified admin)
// must FAIL against the old rules, which is what proves they test the fix and not
// something the query shape already blocked.
//
// Every case runs on a report with listingStatus "for_sale" (or "sold") — the
// state the deleted rule opened — except where a case says otherwise.
//
// Group D (V8 raw move, 2026-10-09, user decision "the server alone reads the raw"): reportRaw/{scanId}
// has NO client rule on purpose (precedent: aiRawResponses) — denied to the owner, a foreign signed-in
// account, an anonymous one and an unauthenticated caller, for read, list and write; read by the VERIFIED
// admin through the catch-all rule (the user knows: design section 4-3-1) and by the server. The
// admin read is PROVEN here, not hidden. Negative control for group D: run this file against a copy
// of the rules that adds `match /reportRaw/{id} { allow read: if request.auth != null; }` — D1, D1b, D2, D3, D5 and D7 must FAIL (D4, the unauthenticated case, is denied either way).
//
// "Server": the emulator's tool for the Admin SDK bypass is
// testEnv.withSecurityRulesDisabled() — it evaluates no rules, which is what the Admin
// SDK does in production (rules do not apply to it). It is NOT the firebase-admin
// package itself (not installed at this repo's root).

require("../functions/test/lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, orderBy,
} = require("firebase/firestore");

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

const RULES_PATH = process.env.RULES_PATH || path.join(__dirname, "..", "firestore.rules");
const ADMIN_EMAIL = "admin1@example.com"; // one of the three in isAdmin()

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-nc",
    firestore: {rules: fs.readFileSync(RULES_PATH, "utf8")},
  });

  // Seed via rules-bypass (the server: analyzeDevice writes reports with the Admin SDK).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    const base = {price: 100, currency: "USD", sellerNote: "n", shortId: "NC-TEST01",
      aiResponse: {overall: {letter: "B"}}, pipeline: "v7", createdAt: new Date("2026-10-01")};
    await setDoc(doc(d, "reports/listed-1"), {...base, userId: "owner-alice", listingStatus: "for_sale"});
    await setDoc(doc(d, "reports/sold-1"), {...base, userId: "owner-alice", listingStatus: "sold"});
    await setDoc(doc(d, "reports/private-1"), {...base, userId: "owner-alice"}); // not listed
    await setDoc(doc(d, "reports/listed-bob"), {...base, userId: "owner-bob", listingStatus: "for_sale"});
    await setDoc(doc(d, "settings/app"), {freeScansForNewUser: 1});
    // reportRaw (V8): server-written raw — shape as analyzeDevice writes it (no userId).
    const raw = {scanId: "listed-1", rawFingerprint: {device: {model: "P"}}, sessionId: null,
      deviceFingerprintSha: "a".repeat(64), timeSeriesStoragePath: "scans/x/listed-1.ts.json.gz", aiAudit: null, source: "analyzeDevice"};
    await setDoc(doc(d, "reportRaw/listed-1"), raw);
    // even a raw doc that DID carry the owner's userId must stay unreadable: no rule depends on it.
    await setDoc(doc(d, "reportRaw/with-userid"), {...raw, scanId: "with-userid", userId: "owner-alice"});
  });

  const GOOGLE = {firebase: {sign_in_provider: "google.com"}};
  const owner = testEnv.authenticatedContext("owner-alice", {email: "alice@example.com", email_verified: true, ...GOOGLE});
  const foreign = testEnv.authenticatedContext("foreign-bob2", {email: "bob2@example.com", email_verified: true, ...GOOGLE});
  const anon = testEnv.authenticatedContext("anon-carol", {firebase: {sign_in_provider: "anonymous"}});
  const unauth = testEnv.unauthenticatedContext();
  const adminUnverified = testEnv.authenticatedContext("admin-uid", {email: ADMIN_EMAIL, email_verified: false, firebase: {sign_in_provider: "password"}});
  const adminNoClaim = testEnv.authenticatedContext("admin-uid", {email: ADMIN_EMAIL});
  const adminVerified = testEnv.authenticatedContext("admin-uid", {email: ADMIN_EMAIL, email_verified: true, ...GOOGLE});
  const verifiedNonAdmin = testEnv.authenticatedContext("other-uid", {email: "someone.else@gmail.com", email_verified: true, ...GOOGLE});

  const listedQuery = (db) => query(collection(db, "reports"),
      where("listingStatus", "in", ["for_sale", "sold"]));

  // ── A. يُرفض — على تقرير for_sale/sold ─────────────────────────────────
  await check("A1. anonymous account CANNOT get() a for_sale report",
      assertFails(getDoc(doc(anon.firestore(), "reports/listed-1"))));
  await check("A2. foreign signed-in (verified, not the owner) CANNOT get() a for_sale report",
      assertFails(getDoc(doc(foreign.firestore(), "reports/listed-1"))));
  await check("A3. foreign signed-in CANNOT list for_sale/sold reports (listingStatus in [...])",
      assertFails(getDocs(listedQuery(foreign.firestore()))));
  await check("A3b. anonymous CANNOT list for_sale/sold reports",
      assertFails(getDocs(listedQuery(anon.firestore()))));
  await check("A4. foreign signed-in CANNOT get() a SOLD report",
      assertFails(getDoc(doc(foreign.firestore(), "reports/sold-1"))));
  await check("A5. unauthenticated CANNOT get() a for_sale report",
      assertFails(getDoc(doc(unauth.firestore(), "reports/listed-1"))));
  await check("A6. admin email with email_verified:false CANNOT get() a for_sale report",
      assertFails(getDoc(doc(adminUnverified.firestore(), "reports/listed-1"))));
  await check("A6b. admin email with email_verified:false CANNOT list all reports",
      assertFails(getDocs(collection(adminUnverified.firestore(), "reports"))));
  await check("A7. admin email with NO email_verified claim at all CANNOT get() (absence = unverified)",
      assertFails(getDoc(doc(adminNoClaim.firestore(), "reports/listed-1"))));
  await check("A8. verified account whose email is NOT in the admin list CANNOT get() a for_sale report",
      assertFails(getDoc(doc(verifiedNonAdmin.firestore(), "reports/listed-1"))));
  await check("A9. foreign signed-in CANNOT get() a report that is not listed (baseline, unchanged)",
      assertFails(getDoc(doc(foreign.firestore(), "reports/private-1"))));

  // ── B. يُقبل ───────────────────────────────────────────────────────────
  await check("B1. owner CAN get() own for_sale report",
      assertSucceeds(getDoc(doc(owner.firestore(), "reports/listed-1"))));
  await check("B1b. owner CAN get() own unlisted report",
      assertSucceeds(getDoc(doc(owner.firestore(), "reports/private-1"))));
  await check("B2. owner CAN list own reports (where userId == uid, orderBy createdAt)",
      assertSucceeds(getDocs(query(collection(owner.firestore(), "reports"),
          where("userId", "==", "owner-alice"), orderBy("createdAt", "desc")))));
  await check("B2b. owner CAN list own for_sale/sold reports (userId + listingStatus in [...])",
      assertSucceeds(getDocs(query(collection(owner.firestore(), "reports"),
          where("userId", "==", "owner-alice"), where("listingStatus", "in", ["for_sale", "sold"])))));
  await check("B3. VERIFIED admin CAN get() any for_sale report (catch-all, owner of the report is someone else)",
      assertSucceeds(getDoc(doc(adminVerified.firestore(), "reports/listed-bob"))));
  await check("B3b. VERIFIED admin CAN list all reports (no where)",
      assertSucceeds(getDocs(collection(adminVerified.firestore(), "reports"))));
  await check("B4. server (rules bypass, the emulator's stand-in for the Admin SDK) CAN read and write reports",
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await getDoc(doc(d, "reports/listed-1"));
        await setDoc(doc(d, "reports/server-written"), {userId: "owner-alice", listingStatus: "for_sale", shortId: "NC-SRV"});
      }));

  // ── C. لا انحدار في ما بقي ─────────────────────────────────────────────
  await check("C1. owner CAN still update price/currency/sellerNote/listingStatus on own report",
      assertSucceeds(updateDoc(doc(owner.firestore(), "reports/private-1"),
          {price: 90, currency: "EUR", sellerNote: "x", listingStatus: "for_sale"})));
  await check("C2. foreign signed-in CANNOT update someone else's for_sale report",
      assertFails(updateDoc(doc(foreign.firestore(), "reports/listed-1"), {price: 1})));
  await check("C3. owner CANNOT write a field outside the four (hasOnly) — e.g. rawFingerprint",
      assertFails(updateDoc(doc(owner.firestore(), "reports/listed-1"), {rawFingerprint: {x: 1}})));
  await check("C4. owner CANNOT create a report",
      assertFails(setDoc(doc(owner.firestore(), "reports/owner-made"), {userId: "owner-alice"})));
  await check("C5. isAdmin() change is global: unverified admin CANNOT write settings/app",
      assertFails(setDoc(doc(adminUnverified.firestore(), "settings/app"), {freeScansForNewUser: 99})));
  await check("C5b. VERIFIED admin CAN write settings/app (settings rule + catch-all)",
      assertSucceeds(setDoc(doc(adminVerified.firestore(), "settings/app"), {freeScansForNewUser: 2})));

  // ── D. reportRaw: الخادم وحده (قرار 2026-10-09) ─────────────────────────
  await check("D1. owner CANNOT get() reportRaw/{scanId} (no client rule exists)",
      assertFails(getDoc(doc(owner.firestore(), "reportRaw/listed-1"))));
  await check("D1b. owner CANNOT get() a reportRaw doc even when it carries her own userId",
      assertFails(getDoc(doc(owner.firestore(), "reportRaw/with-userid"))));
  await check("D2. foreign signed-in CANNOT get() reportRaw",
      assertFails(getDoc(doc(foreign.firestore(), "reportRaw/listed-1"))));
  await check("D3. anonymous account CANNOT get() reportRaw",
      assertFails(getDoc(doc(anon.firestore(), "reportRaw/listed-1"))));
  await check("D4. unauthenticated CANNOT get() reportRaw",
      assertFails(getDoc(doc(unauth.firestore(), "reportRaw/listed-1"))));
  await check("D5. owner / foreign / anonymous CANNOT list reportRaw (not even constrained by userId)",
      Promise.all([
        assertFails(getDocs(query(collection(owner.firestore(), "reportRaw"), where("userId", "==", "owner-alice")))),
        assertFails(getDocs(collection(foreign.firestore(), "reportRaw"))),
        assertFails(getDocs(collection(anon.firestore(), "reportRaw"))),
      ]));
  await check("D6. owner CANNOT create or update reportRaw",
      Promise.all([
        assertFails(setDoc(doc(owner.firestore(), "reportRaw/new-by-owner"), {scanId: "x"})),
        assertFails(updateDoc(doc(owner.firestore(), "reportRaw/listed-1"), {source: "tampered"})),
      ]));
  await check("D7. admin email with email_verified:false CANNOT get() reportRaw",
      assertFails(getDoc(doc(adminUnverified.firestore(), "reportRaw/listed-1"))));
  await check("D8. VERIFIED admin CAN get() reportRaw — through the catch-all rule (known to the user; proven, not hidden)",
      assertSucceeds(getDoc(doc(adminVerified.firestore(), "reportRaw/listed-1"))));
  await check("D8b. VERIFIED admin CAN list reportRaw (catch-all)",
      assertSucceeds(getDocs(collection(adminVerified.firestore(), "reportRaw"))));
  await check("D9. server (rules bypass, the emulator's stand-in for the Admin SDK) CAN read and write reportRaw",
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        const d = ctx.firestore();
        await getDoc(doc(d, "reportRaw/listed-1"));
        await setDoc(doc(d, "reportRaw/server-written"), {scanId: "server-written", source: "analyzeDevice"});
      }));

  await testEnv.cleanup();
  console.log(`\n===== REPORTS RULES TEST RESULTS (rules: ${path.basename(RULES_PATH)}) =====`);
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
