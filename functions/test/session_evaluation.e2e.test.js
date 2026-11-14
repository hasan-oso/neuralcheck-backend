// E2E test: session-based evaluation contract (feat/session-evaluation-contract).
//
// Covers the app-side path added on top of the deployed /tech contract:
// anonymous caller + QR session, verbal grade scale, partial category ratings
// (absent vs not_tested), visible defects, evaluation submitted BEFORE the
// report exists + late resolution, and a regression guard proving the deployed
// authenticated path still behaves exactly as before.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/session_evaluation.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const {db} = require("../src/utils/admin");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
// V8 raw move (2026-10-09): the trigger below is the REAL handler (rule 37) — the earlier mirror of
// its body could not notice that the trigger now reads the raw from reportRaw, not from its event.
const {resolvePendingEvaluation} = require("../src/evaluations/resolvePendingEvaluation");

const getEval = async (s) => (await db.collection("evaluations").doc(s).get()).data();
const future = () => new Date(Date.now() + 10 * 60 * 1000);
// قرار مستخدم 2026-09-30 +03 («قرار — مهلة الجلسة ساعة») — يحلّ محلّ
// نافذة joinedAt+60 (fbcc74c) بالكامل. نافذة واحدة الآن: 60 دقيقة من
// الإنشاء، مخزَّنة في scanSessions.expiresAt مباشرة (createScanSession.js)
// — sessionTimeout.js يقرأها كما هي، بلا joinedAt. "expiresAtExpired"
// لاختبار انتهاء النافذة فعلياً.
const expiresAtExpired = () => new Date(Date.now() - 60 * 1000);

async function run(data, uid) {
  return submitEvaluation.run({
    data, auth: uid ? {uid} : null, rawRequest: {headers: {}},
  });
}
async function expectReject(data, uid) {
  try {
    await run(data, uid);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

// V8 raw move: the readable reports/{scanId} no longer carries rawFingerprint / sessionId /
// deviceFingerprintSha / timeSeriesStoragePath / aiAudit — they are written beside it in reportRaw/{scanId}.
const RAW_KEYS = ["rawFingerprint", "sessionId", "deviceFingerprintSha", "timeSeriesStoragePath", "aiAudit"];
async function seedReport(scanId, ownerUid, overrides = {}) {
  const raw = {
    scanId,
    rawFingerprint: {
      device: {model: "SM-G973F", androidVersion: "12", apiLevel: 31},
      timeSeries: {header: {androidApiLevel: 31}, footer: {}},
    },
    sessionId: null,
    deviceFingerprintSha: "f".repeat(64),
    timeSeriesStoragePath: `scans/${"f".repeat(64)}/${scanId}.ts.json.gz`,
    aiAudit: null,
    source: "analyzeDevice",
  };
  const readable = {
    userId: ownerUid,
    deviceModel: "SM-G973F",
    fieldsVersion: 65, appVersion: "1.9.65",
    aiModel: "deepseek-v4-flash", pipeline: "v6_raw_timeseries",
    grade: "B", score: 78,
    aiResponse: {
      grade: "B", score: 78,
      category_scores: {battery: {grade: "B", score: 72, pass_count: 3, total_count: 4}},
    },
  };
  for (const [k, v] of Object.entries(overrides)) (RAW_KEYS.includes(k) ? raw : readable)[k] = v;
  await db.collection("reports").doc(scanId).set(readable);
  await db.collection("reportRaw").doc(scanId).set(raw);
}
async function seedSession(id, ownerUid, overrides) {
  await db.collection("scanSessions").doc(id).set({
    ownerId: ownerUid, status: "scanning", expiresAt: future(), code: "NC-T1",
    ...overrides,
  });
}

// What analyzeDevice's report write triggers: resolvePendingEvaluation. The emulator used here runs
// Firestore only (no functions runtime to fire triggers), so the event is built by hand — but the REAL
// handler runs on it, fed the real report snapshot read back from the emulator.
async function fireResolveTrigger(scanId) {
  const snap = await db.collection("reports").doc(scanId).get();
  await resolvePendingEvaluation.run({params: {scanId}, data: snap});
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

(async () => {
  // ===== Case 1: anonymous caller + valid session =====
  await seedSession("sessA", "shopOwner");
  await seedReport("s1", "shopOwner");
  const r1 = await run({
    scanId: "s1", sessionId: "sessA",
    technicianGradeRaw: "fair",
    categoryRatings: {battery: "weak", storage: "not_tested"},
    visibleDefects: ["weak_battery", "prior_repair"],
    technicianName: "أبو علي",
  }, null); // ← anonymous: no auth at all
  const v1 = await getEval("s1");

  assert(r1.success === true, "1. anonymous caller + session: accepted");
  assert(v1.ownerId === "shopOwner",
      "1. ownerId derived from session (NOT from the anonymous caller)");
  assert(v1.source === "session" && !("sessionId" in v1),
      "1. source recorded; sessionId NOT copied into the evaluation (V8 raw move, decision 6)");

  // ===== Case 2: verbal scale → letter derivation =====
  assert(v1.technicianGradeRaw === "fair", "2. technicianGradeRaw stored verbatim");
  assert(v1.technicianGrade === "C", "2. fair → C derived server-side");
  assert(v1.gradeDistance === 1,
      "2. gradeDistance computed from derived grade (app B=1, tech C=2 → +1)");
  for (const [raw, letter] of [["excellent", "A"], ["good", "B"], ["fair", "C"], ["weak", "D"]]) {
    await seedSession(`ss_${raw}`, "shopOwner");
    await seedReport(`sg_${raw}`, "shopOwner");
    await run({scanId: `sg_${raw}`, sessionId: `ss_${raw}`, technicianGradeRaw: raw}, null);
    const g = await getEval(`sg_${raw}`);
    assert(g.technicianGrade === letter && g.technicianGradeRaw === raw,
        `2. ${raw} → ${letter}`);
  }

  // ===== Case 3: absent key vs not_tested =====
  assert(v1.categoryRatings.battery === "weak", "3. answered category stored");
  assert(v1.categoryRatings.storage === "not_tested",
      "3. not_tested stored as an explicit answer");
  assert(!("cpu_performance" in v1.categoryRatings) &&
         !("memory" in v1.categoryRatings),
  "3. unanswered categories ABSENT from the map (not null, not not_tested)");
  assert(Object.keys(v1.categoryRatings).length === 2,
      "3. exactly the two answered keys are present");

  // ===== Case 4: visible defects =====
  assert(v1.visibleDefects.length === 2 &&
         v1.visibleDefects.includes("weak_battery") &&
         v1.visibleDefects.includes("prior_repair"),
  "4. visibleDefects stored");

  await seedSession("sessNone", "shopOwner"); await seedReport("sNone", "shopOwner");
  await run({scanId: "sNone", sessionId: "sessNone", visibleDefects: ["none_noticed"]}, null);
  const vNone = await getEval("sNone");
  assert(vNone.visibleDefects.length === 1 && vNone.visibleDefects[0] === "none_noticed",
      "4. none_noticed is a positive answer, distinct from an empty array");

  // ===== Case 5: invalid session / expired session =====
  await seedReport("sBad", "shopOwner");
  assert(await expectReject({scanId: "sBad", sessionId: "nope", technicianGradeRaw: "good"}, null),
      "5. unknown sessionId rejected");

  await seedSession("sessDone", "shopOwner", {status: "completed"});
  const errDone = await expectReject(
      {scanId: "sBad", sessionId: "sessDone", technicianGradeRaw: "good"}, null);
  assert(errDone && /غير صالحة/.test(errDone), "5. non-scanning session rejected");

  // القاعدة 23 — استُبدل هذا مرّتين الآن: fbcc74c جعله "66 دقيقة بعد
  // الانضمام"، وقرار المستخدم اللاحق («قرار — مهلة الجلسة ساعة»،
  // 2026-09-30 +03) أبطل ذلك وردّ الفحص إلى expiresAt وحدها مباشرة — لا
  // حاجة لـjoinedAt إطلاقاً بعد الآن، الجلسة "منتهية" إن كانت expiresAt
  // نفسها في الماضي فقط.
  await seedSession("sessExp", "shopOwner", {expiresAt: expiresAtExpired()});
  const errExp = await expectReject(
      {scanId: "sBad", sessionId: "sessExp", technicianGradeRaw: "good"}, null);
  assert(errExp && /منتهية/.test(errExp),
      "5. session expired (expiresAt في الماضي، قرار «مهلة الجلسة ساعة»): رفض بنفس النصّ/الرمز القائمين (لا تغيير عليهما)");

  // نصّ الأمر: "جلسة بلا expiresAt تُرفض في التحليل والتقييم" — جلسة
  // "scanning" بلا expiresAt إطلاقاً (تعارض داخلي، لا يُفترَض وقوعه فعلياً
  // — createScanSession.js يكتبه دائماً عند الإنشاء) تُرفَض، لا تُقبَل بلا
  // حدّ (القاعدة 22). كتابة مباشرة لا عبر seedSession — كي لا يحمل المستند
  // مفتاح expiresAt إطلاقاً.
  await db.collection("scanSessions").doc("sessNoExp").set({
    ownerId: "shopOwner", status: "scanning", code: "NC-T1",
  });
  const errNoExp = await expectReject(
      {scanId: "sBad", sessionId: "sessNoExp", technicianGradeRaw: "good"}, null);
  assert(errNoExp && /غير صالحة/.test(errNoExp),
      "5. [نصّ الأمر] session بلا expiresAt: رفض — «جلسة الفحص غير صالحة» (permission-denied)، لا قبول بلا حدّ");

  assert(await expectReject({scanId: "sBad", technicianGradeRaw: "good"}, null),
      "5. no session and no auth rejected");
  assert((await getEval("sBad")) === undefined, "5. no document written by any rejection");

  // ===== Case 6: client cannot supply ownerId =====
  await seedSession("sessOwn", "shopOwner"); await seedReport("sOwn", "shopOwner");
  await run({
    scanId: "sOwn", sessionId: "sessOwn", technicianGradeRaw: "good",
    ownerId: "attacker", userId: "attacker",
  }, null);
  const vOwn = await getEval("sOwn");
  assert(vOwn.ownerId === "shopOwner",
      "6. client-supplied ownerId IGNORED — server derives it from the session");

  // ===== Case 7: closed vocabularies =====
  await seedSession("sessV", "shopOwner"); await seedReport("sV", "shopOwner");
  const base = {scanId: "sV", sessionId: "sessV", technicianGradeRaw: "good"};
  assert(await expectReject({...base, visibleDefects: ["cracked_frame"]}, null),
      "7. unknown visibleDefect rejected");
  assert(await expectReject({...base, technicianGradeRaw: "amazing"}, null),
      "7. unknown technicianGradeRaw rejected");
  assert(await expectReject({...base, categoryRatings: {battery: "terrible"}}, null),
      "7. unknown category rating rejected");
  assert(await expectReject({...base, categoryRatings: {camera: "good"}}, null),
      "7. category outside the four rating categories rejected");
  assert(await expectReject({...base, categoryRatings: ["battery"]}, null),
      "7. array categoryRatings rejected");
  assert((await getEval("sV")) === undefined, "7. no document written by any rejection");

  // ===== Case 8: partial submissions, every shape =====
  const shapes = [
    ["grade only", {technicianGradeRaw: "good"}],
    ["ratings only", {categoryRatings: {memory: "excellent"}}],
    ["defects only", {visibleDefects: ["water_damage"]}],
  ];
  for (let i = 0; i < shapes.length; i++) {
    const [label, payload] = shapes[i];
    await seedSession(`sessP${i}`, "shopOwner"); await seedReport(`sP${i}`, "shopOwner");
    const ret = await run({scanId: `sP${i}`, sessionId: `sessP${i}`, ...payload}, null);
    assert(ret.success === true, `8. partial submission accepted — ${label}`);
  }
  const vP1 = await getEval("sP1");
  assert(vP1.technicianGrade === null && vP1.gradeDistance === null,
      "8. ratings-only: no grade → technicianGrade and gradeDistance null");
  assert(vP1.agreement === null && vP1.errorMagnitude === null &&
         vP1.consistencyFlag === false,
  "8. agreement/errorMagnitude absent (app never sends them) → null, no flag");

  await seedSession("sessE", "shopOwner"); await seedReport("sE", "shopOwner");
  assert(await expectReject({scanId: "sE", sessionId: "sessE"}, null),
      "8. wholly empty submission (no verdict at all) rejected");

  // ===== Case 9: evaluation BEFORE the report, then late resolution =====
  await seedSession("sessPre", "shopOwner"); // report intentionally absent
  const rPre = await run({
    scanId: "sPre", sessionId: "sessPre",
    technicianGradeRaw: "weak",
    categoryRatings: {battery: "weak"},
  }, null);
  const vPre = await getEval("sPre");

  assert(rPre.success === true && rPre.pending === true,
      "9. evaluation accepted BEFORE the report exists (not rejected)");
  assert(vPre.pending === true, "9. stored with pending: true");
  assert(vPre.appGrade === null && vPre.gradeDistance === null &&
         vPre.appCategoryScores === null && vPre.resolvedAt === null,
  "9. report snapshot null while pending");
  assert(vPre.technicianGrade === "D" && vPre.technicianGradeRaw === "weak",
      "9. technician verdict fully recorded while pending");

  await seedReport("sPre", "shopOwner");   // analyzeDevice writes the report
  await fireResolveTrigger("sPre");        // trigger fires
  const vPost = await getEval("sPre");

  assert(vPost.pending === false, "9. late resolution clears pending");
  assert(vPost.appGrade === "B" && vPost.appScore === 78,
      "9. report snapshot filled in on resolution");
  assert(vPost.gradeDistance === 2,
      "9. gradeDistance computed late (app B=1, tech D=3 → +2)");
  assert(vPost.appCategoryScores && vPost.appCategoryScores.battery.grade === "B",
      "9. category_scores snapshot filled in on resolution");
  assert(!("timeSeriesStoragePath" in vPost) && !("deviceFingerprintSha" in vPost) &&
         vPost.fieldsVersion === 65 && vPost.linkageRawState === "PRIVATE" && vPost.linkageIncomplete === false,
  "9. version fields filled in on resolution; link decided from reportRaw (PRIVATE), no identifier copied");
  assert(vPost.technicianGrade === "D" && vPost.categoryRatings.battery === "weak",
      "9. technician verdict untouched by resolution");
  assert(vPost.ownerMismatch === false, "9. ownerMismatch false on a matching owner");

  // idempotency: re-firing must not overwrite an already-resolved row
  await fireResolveTrigger("sPre");
  const vTwice = await getEval("sPre");
  assert(vTwice.gradeDistance === 2 && vTwice.pending === false,
      "9. re-firing the trigger is a no-op (at-least-once delivery safe)");

  // ===== Case 10: owner mismatch caught at resolution =====
  await seedSession("sessMis", "shopOwner");
  await run({scanId: "sMis", sessionId: "sessMis", technicianGradeRaw: "good"}, null);
  await seedReport("sMis", "someoneElse");  // report belongs to a different account
  await fireResolveTrigger("sMis");
  const vMis = await getEval("sMis");
  assert(vMis.ownerMismatch === true && vMis.pending === false,
      "10. owner mismatch flagged at resolution, row kept for audit");
  assert(vMis.gradeDistance === null,
      "10. no distance computed on mismatch (never mis-attributed)");

  // ===== Case 11: session path still enforces ownership when report EXISTS =====
  await seedSession("sessX", "shopOwner");
  await seedReport("sX", "otherOwner");
  const errX = await expectReject(
      {scanId: "sX", sessionId: "sessX", technicianGradeRaw: "good"}, null);
  assert(errX && /ليس ضمن حسابك/.test(errX),
      "11. existing report owned by someone else → rejected even via session");

  // ===== Case 12: REGRESSION GUARD — deployed authenticated path unchanged =====
  await seedReport("sLegacy", "owner");
  const rLeg = await run({
    scanId: "sLegacy",
    technicianGrade: "C",
    agreement: "app_lenient",
    errorMagnitude: "moderate",
    disputedCategories: ["battery", "thermal"],
    technicianName: "أبو أحمد",
    durationMs: 41000,
  }, "owner");
  const vLeg = await getEval("sLegacy");

  assert(rLeg.success === true, "12. legacy /tech payload still accepted");
  assert(vLeg.source === "authenticated" && !("sessionId" in vLeg),
      "12. legacy path marked authenticated (no sessionId on the evaluation)");
  assert(vLeg.technicianGrade === "C" && vLeg.technicianGradeRaw === null,
      "12. letter grade accepted directly; raw null when not sent");
  assert(vLeg.gradeDistance === 1 && vLeg.consistencyFlag === false,
      "12. gradeDistance + consistencyFlag unchanged on the legacy path");
  assert(vLeg.agreement === "app_lenient" && vLeg.errorMagnitude === "moderate",
      "12. agreement/errorMagnitude still stored for the legacy path");
  assert(vLeg.disputedCategories.length === 2, "12. disputedCategories still stored");
  assert(vLeg.pending === false && vLeg.ownerMismatch === false,
      "12. legacy path resolves immediately (report present)");
  assert(vLeg.appGrade === "B" && vLeg.fieldsVersion === 65,
      "12. report snapshot still copied on the legacy path");

  assert(await expectReject({scanId: "missing", technicianGrade: "A"}, "owner"),
      "12. authenticated path STILL requires the report (ownership gate intact)");
  assert(await expectReject({scanId: "sLegacy", technicianGrade: "A"}, "intruder"),
      "12. authenticated non-owner still rejected");

  // consistency flag still raised on the legacy path
  await seedReport("sFlag", "owner");
  await run({scanId: "sFlag", technicianGrade: "D", agreement: "agree"}, "owner");
  const vFlag = await getEval("sFlag");
  assert(vFlag.consistencyFlag === true && vFlag.gradeDistance === 2,
      "12. contradiction still flagged, not rejected");

  // ===== Case 13: revision replaces, keeps createdAt, counts =====
  const createdBefore = vLeg.createdAt.toDate().getTime();
  const rRev = await run({
    scanId: "sLegacy", technicianGradeRaw: "excellent",
    categoryRatings: {cpu_performance: "good"},
  }, "owner");
  const vRev = await getEval("sLegacy");
  assert(rRev.isRevision === true && vRev.revisionCount === 1,
      "13. revision counted");
  assert(vRev.createdAt.toDate().getTime() === createdBefore,
      "13. original createdAt preserved");
  assert(vRev.technicianGrade === "A" && vRev.technicianGradeRaw === "excellent",
      "13. revision switches the legacy row to the verbal scale");
  assert(vRev.agreement === null && vRev.disputedCategories.length === 0,
      "13. omitted fields reset (full overwrite, not merge)");
  assert(vRev.gradeDistance === -1,
      "13. gradeDistance recomputed on revision (app B=1, tech A=0 → -1)");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
