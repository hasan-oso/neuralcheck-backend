// Firestore security-rules tests for the scanSessions read lockdown
// (أمر مستخدم 2026-10-01 +03، "قواعد قراءة الجلسات"). القاعدة الأصل
// بنصّها: "قراءة مستند الجلسة لصاحبها وللجهاز المنضمّ إليها وحدهما. ولا
// سرد (list) لغيرهما."
//
// Run with the Firestore emulator (requires JDK 21+):
//   firebase emulators:exec --only firestore --project demo-nc \
//     "node rules-test/scanSessions.rules.test.js"
//
// Validates: only the session's owner (ownerId == uid) and the device
// that joined it (joinedBy == uid, safe when joinedBy is absent) can
// get() the document; list() queries that don't constrain themselves to
// ownerId/joinedBy == the caller's uid are rejected by Firestore itself
// (not filtered — the whole query fails); a pending session (joinedBy
// not written yet) is readable by its owner only; client writes remain
// fully blocked (create/update/delete all false, unchanged); the admin
// catch-all (decision 1's documented exception) still reads everything;
// the documented, unfixed gap from decision 2 (an anonymous-join device
// reading with its own ad-hoc auth uid, not the null stored in
// joinedBy) is proven to still be rejected, not silently patched here.
//
// Emulator used for the 19/19 run that validated this file (2026-10-01
// +03, demo-nc, firebase-tools 15.28.2, JDK 21.0.2): Firestore emulator
// jar cloud-firestore-emulator-v1.22.0.jar — already present in the
// local firebase-tools cache (not freshly downloaded this run) —
// sha256 9b6498b7f62714d67f48f59b3818883cd682dbcd46b9f59511de81c97bb5166c.

require("../functions/test/lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where,
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

(async () => {
  const testEnv = await initializeTestEnvironment({
    projectId: "demo-nc",
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
    },
  });

  // Seed sessions via rules-bypass (simulates server/Admin SDK —
  // createScanSession.js/joinScanSession.js both use Admin SDK, which
  // bypasses rules entirely; this mirrors that, not a client write).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    // جلسة pending — لم ينضمّ إليها أحد بعد. joinedBy غائب كلّياً من
    // المستند (createScanSession.js لا يكتبه أصلاً، لا يكتبه بقيمة فارغة).
    await setDoc(doc(d, "scanSessions/pending-session"), {
      code: "NC-PEND01", ownerId: "owner-alice", status: "pending",
    });
    // جلسة scanning — منضمّ إليها بجهاز مُصادَق فعلياً (joiner-bob).
    await setDoc(doc(d, "scanSessions/joined-session"), {
      code: "NC-JOIN01", ownerId: "owner-alice", status: "scanning", joinedBy: "joiner-bob",
    });
    // جلسة scanning — منضمّ إليها بجهاز مجهول الهويّة (مسار "لدي كود فحص"
    // من شاشة الدخول، joinScanSession.js:31 يكتب joinedBy=null تحديداً).
    await setDoc(doc(d, "scanSessions/anon-joined-session"), {
      code: "NC-ANON01", ownerId: "owner-alice", status: "scanning", joinedBy: null,
    });
    // الدفعة ٩ «مسار الجلسة» (2026-10-10 +03): حالتان جديدتان تكتبهما الدوالّ (Admin SDK) وتقرؤهما الواجهة — cancelled (cancelScanSession) وexpired
    // (joinScanSession/analyzeDevice/submitEvaluation/cancelScanSession عند المسّ بعد expiresAt). القواعد لا تنظر في status أصلاً، فلا تغيير فيها —
    // والقسم (10) أدناه يثبت ذلك بدل أن يُفترَض.
    await setDoc(doc(d, "scanSessions/cancelled-session"), {
      code: "NC-CANC01", ownerId: "owner-alice", status: "cancelled", joinedBy: "joiner-bob",
      cancelReason: "left_by_customer",
    });
    await setDoc(doc(d, "scanSessions/expired-session"), {
      code: "NC-EXPR01", ownerId: "owner-alice", status: "expired", joinedBy: "joiner-bob",
    });
  });

  const alice = testEnv.authenticatedContext("owner-alice"); // المالك
  const bob = testEnv.authenticatedContext("joiner-bob"); // الجهاز المنضمّ (مُصادَق)
  const stranger = testEnv.authenticatedContext("stranger-carol"); // حساب مسجَّل غريب
  // جهاز انضمّ فعلياً بالمسار المجهول (joinedBy=null على مستنده) لكنه هنا
  // يملك جلسة مصادقة مجهولة خاصّة به بـuid عشوائي — غير null بالضرورة،
  // ولا علاقة له بقيمة joinedBy المخزونة (الفجوة المُسجَّلة، القرار ٢).
  const anonDeviceOwnUid = testEnv.authenticatedContext("anon-device-ephemeral-uid");

  // ── (1) غريب يُرفض في get() ──────────────────────────────────────────
  await check("1. stranger CANNOT get() the pending session",
      assertFails(getDoc(doc(stranger.firestore(), "scanSessions/pending-session"))));
  await check("1b. stranger CANNOT get() the joined session",
      assertFails(getDoc(doc(stranger.firestore(), "scanSessions/joined-session"))));

  // ── (2) غريب يُرفض في list() — حتى استعلام مقيَّد بملكية غيره ─────────
  await check("2. stranger CANNOT list() scanSessions unconstrained",
      assertFails(getDocs(collection(stranger.firestore(), "scanSessions"))));
  await check("2b. stranger CANNOT list() with a query filtered to someone else's ownerId",
      assertFails(getDocs(query(collection(stranger.firestore(), "scanSessions"), where("ownerId", "==", "owner-alice")))));

  // ── (3) المالك يقرأ (get) كل جلساته — بما فيها المعلّقة ───────────────
  await check("3. owner CAN get() the pending session (joinedBy absent)",
      assertSucceeds(getDoc(doc(alice.firestore(), "scanSessions/pending-session"))));
  await check("3b. owner CAN get() the joined session",
      assertSucceeds(getDoc(doc(alice.firestore(), "scanSessions/joined-session"))));
  await check("3c. owner CAN list() scanSessions filtered to own ownerId",
      assertSucceeds(getDocs(query(collection(alice.firestore(), "scanSessions"), where("ownerId", "==", "owner-alice")))));
  // حتى المالك: استعلام list غير مقيَّد يُرفض — سلوك Firestore نفسه (لا
  // يمكن إثبات الشرط بلا قيد على الاستعلام، بصرف النظر عمّن يستدعيه؛ نصّ
  // أمر التنفيذ: "الاستعلام الذي لا يقيّد نفسه بـownerId == uid يُرفض").
  await check("3d. even the owner CANNOT list() scanSessions unconstrained",
      assertFails(getDocs(collection(alice.firestore(), "scanSessions"))));

  // ── (4) المنضمّ (joinedBy == uid) يقرأ ────────────────────────────────
  await check("4. joined device (joinedBy==uid) CAN get() the joined session",
      assertSucceeds(getDoc(doc(bob.firestore(), "scanSessions/joined-session"))));
  await check("4b. joined device CANNOT get() a different session it didn't join",
      assertFails(getDoc(doc(bob.firestore(), "scanSessions/pending-session"))));

  // ── (5) joinedBy غائب — لا يقرأ معه إلا المالك ────────────────────────
  await check("5. a registered stranger CANNOT get() a pending session even without joinedBy set",
      assertFails(getDoc(doc(stranger.firestore(), "scanSessions/pending-session"))));

  // ── (6) فجوة مُسجَّلة بلا إصلاح (القرار ٢، بنصّه) — إثبات لا عطب ──────
  await check("6. [فجوة موثَّقة، لا عطب] anonymous-joined session NOT readable by the device's own ad-hoc auth uid (joinedBy stays null)",
      assertFails(getDoc(doc(anonDeviceOwnUid.firestore(), "scanSessions/anon-joined-session"))));
  await check("6b. owner CAN still get() the anonymously-joined session (joinedBy=null doesn't block the owner)",
      assertSucceeds(getDoc(doc(alice.firestore(), "scanSessions/anon-joined-session"))));

  // ── (7) الكتابة من العميل مرفوضة كما هي اليوم — بلا تغيير ─────────────
  await check("7. owner CANNOT create a new scanSessions doc from the client",
      assertFails(setDoc(doc(alice.firestore(), "scanSessions/client-created"),
          {code: "X", ownerId: "owner-alice", status: "pending"})));
  await check("7b. owner CANNOT update their own session from the client",
      assertFails(updateDoc(doc(alice.firestore(), "scanSessions/pending-session"), {status: "completed"})));
  await check("7c. owner CANNOT delete their own session from the client",
      assertFails(deleteDoc(doc(alice.firestore(), "scanSessions/pending-session"))));
  await check("7d. joined device CANNOT update the session it joined",
      assertFails(updateDoc(doc(bob.firestore(), "scanSessions/joined-session"), {status: "completed"})));

  // ── (8) الأدمن يبقى يقرأ كل شيء (استثناء القرار ١، القاعدة الشاملة) ───
  const adminCtx = testEnv.authenticatedContext("adminUid", {email: "admin1@example.com", email_verified: true}); // isAdmin() requires email_verified since 2026-10-09
  await check("8. admin CAN get() any session (catch-all exception, decision 1)",
      assertSucceeds(getDoc(doc(adminCtx.firestore(), "scanSessions/pending-session"))));

  // ── (10) الحالتان الجديدتان (الدفعة ٩): القراءة نفسها، والكتابة من العميل مرفوضة — لا تغيير في القواعد ──
  await check("10. owner CAN get() a cancelled session (the app sees the terminal state)",
      assertSucceeds(getDoc(doc(alice.firestore(), "scanSessions/cancelled-session"))));
  await check("10b. joined device CAN get() the cancelled session it joined (consent declined / left: its own listener sees it)",
      assertSucceeds(getDoc(doc(bob.firestore(), "scanSessions/cancelled-session"))));
  await check("10c. owner CAN get() an expired session",
      assertSucceeds(getDoc(doc(alice.firestore(), "scanSessions/expired-session"))));
  await check("10d. joined device CAN get() the expired session it joined",
      assertSucceeds(getDoc(doc(bob.firestore(), "scanSessions/expired-session"))));
  await check("10e. stranger CANNOT get() a cancelled session",
      assertFails(getDoc(doc(stranger.firestore(), "scanSessions/cancelled-session"))));
  await check("10f. stranger CANNOT get() an expired session",
      assertFails(getDoc(doc(stranger.firestore(), "scanSessions/expired-session"))));
  await check("10g. owner CANNOT cancel from the client (status=cancelled write denied: cancellation goes through the callable)",
      assertFails(updateDoc(doc(alice.firestore(), "scanSessions/pending-session"), {status: "cancelled", cancelReason: "cancelled_by_owner"})));
  await check("10h. joined device CANNOT cancel from the client",
      assertFails(updateDoc(doc(bob.firestore(), "scanSessions/joined-session"), {status: "cancelled", cancelReason: "left_by_customer"})));
  await check("10i. nobody can write expired from the client",
      assertFails(updateDoc(doc(alice.firestore(), "scanSessions/joined-session"), {status: "expired"})));
  await check("10j. owner CANNOT resurrect a cancelled session from the client",
      assertFails(updateDoc(doc(alice.firestore(), "scanSessions/cancelled-session"), {status: "scanning"})));
  await check("10k. owner CAN list() own sessions including cancelled/expired (constrained to ownerId)",
      assertSucceeds(getDocs(query(collection(alice.firestore(), "scanSessions"), where("ownerId", "==", "owner-alice")))));

  // ── (9) الخادم (Admin SDK ≈ تعطيل القواعد) يكتب بحرّية كما اليوم ──────
  await check("9. server (Admin SDK) CAN write scanSessions",
      testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), "scanSessions/pending-session"),
            {status: "scanning", joinedBy: "joiner-bob"});
      }));

  await testEnv.cleanup();
  console.log("\n===== SCANSESSIONS RULES TEST RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
