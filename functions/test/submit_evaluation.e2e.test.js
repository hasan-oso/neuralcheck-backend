// E2E test: submitEvaluation (feat/evaluations-collection).
//
// Covers: successful write with every field, ownership rejection, every
// invalid-value rejection, gradeDistance in both directions, the consistency
// flag, re-evaluation + revisionCount, and the all-optionals-absent path.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/submit_evaluation.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const {db} = require("../src/utils/admin");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");

const getEval = async (s) => (await db.collection("evaluations").doc(s).get()).data();

async function run(data, uid) {
  return submitEvaluation.run({
    data, auth: uid ? {uid} : null, rawRequest: {headers: {}},
  });
}

// Calls submitEvaluation and returns the HttpsError message, or null if it
// unexpectedly succeeded.
async function expectReject(data, uid) {
  try {
    await run(data, uid);
    return null;
  } catch (e) {
    return e.message || String(e);
  }
}

// V8 raw move (2026-10-09): the five fields below live in reportRaw/{scanId}, not in the readable report.
const RAW_KEYS = ["rawFingerprint", "sessionId", "deviceFingerprintSha", "timeSeriesStoragePath", "aiAudit"];

// Seeds a report shaped like what analyzeDevice writes NOW: the readable reports/{scanId} (no moved
// fields) plus the raw reportRaw/{scanId}. An override whose key is one of RAW_KEYS goes to the raw doc.
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
    deviceFingerprint: "SM-G973F",
    deviceModel: "SM-G973F",
    deviceMarketingName: "Galaxy S10",
    fieldsVersion: 65,
    appVersion: "1.9.65",
    aiModel: "deepseek-v4-flash",
    pipeline: "v6_raw_timeseries",
    grade: "B",
    score: 78,
    aiResponse: {
      grade: "B", score: 78,
      category_scores: {
        battery: {grade: "B", score: 72, pass_count: 3, total_count: 4, note: "ملاحظة"},
        cpu: {grade: "A", score: 90, pass_count: 5, total_count: 5, note: "ممتاز"},
      },
    },
  };
  for (const [k, v] of Object.entries(overrides)) (RAW_KEYS.includes(k) ? raw : readable)[k] = v;
  await db.collection("reports").doc(scanId).set(readable);
  await db.collection("reportRaw").doc(scanId).set(raw);
}

const results = []; let failures = 0;
function assert(c, n) {
  if (c) results.push(`PASS  ${n}`); else {
    failures++; results.push(`FAIL  ${n}`);
  }
}

(async () => {
  // ===== Case 1: full write — every field present =====
  await seedReport("e1", "owner");
  const ret1 = await run({
    scanId: "e1",
    technicianGrade: "C",
    agreement: "app_lenient",
    errorMagnitude: "moderate",
    disputedCategories: ["battery", "thermal"],
    technicianName: "أبو أحمد",
    durationMs: 41000,
  }, "owner");
  const v1 = await getEval("e1");

  assert(ret1.success === true, "1. returns success");
  // الربط
  assert(v1.scanId === "e1" && v1.ownerId === "owner",
      "1. linkage: scanId + ownerId");
  assert(v1.technicianName === "أبو أحمد", "1. technicianName stored");
  // V8 raw move, decision 6 (rule 23: replaces the two assertions that proved the identifiers were
  // copied from the report into the evaluation): the link stays on the server side, by scanId.
  assert(!("timeSeriesStoragePath" in v1) && !("deviceFingerprintSha" in v1) && !("sessionId" in v1),
      "1. identifiers (timeSeriesStoragePath / deviceFingerprintSha / sessionId) NOT copied into the evaluation");
  assert(v1.linkageRawState === "PRIVATE" && v1.linkageIncomplete === false,
      "1. the raw state is stored explicitly (PRIVATE) and the link is complete");
  // لقطة الجهاز
  assert(v1.deviceModel === "SM-G973F" && v1.androidVersion === "12" &&
         v1.apiLevel === 31, "1. device snapshot (model/android/api)");
  // لقطة الإصدار
  assert(v1.fieldsVersion === 65 && v1.appVersion === "1.9.65" &&
         v1.aiModel === "deepseek-v4-flash" && v1.pipeline === "v6_raw_timeseries",
  "1. version snapshot (fieldsVersion/appVersion/aiModel/pipeline)");
  // ما قاله التطبيق
  assert(v1.appGrade === "B" && v1.appScore === 78, "1. appGrade + appScore");
  assert(v1.appCategoryScores && v1.appCategoryScores.battery.grade === "B" &&
         v1.appCategoryScores.cpu.pass_count === 5,
  "1. full category_scores snapshot copied verbatim");
  // ما قاله الفنّي
  assert(v1.technicianGrade === "C" && v1.agreement === "app_lenient" &&
         v1.errorMagnitude === "moderate",
  "1. technician verdict fields");
  assert(Array.isArray(v1.disputedCategories) &&
         v1.disputedCategories.length === 2 &&
         v1.disputedCategories.includes("battery") &&
         v1.disputedCategories.includes("thermal"),
  "1. disputedCategories stored");
  // القياس
  assert(v1.durationMs === 41000, "1. durationMs stored");
  assert(v1.createdAt && typeof v1.createdAt.toDate === "function",
      "1. createdAt is a server timestamp");
  assert(v1.updatedAt === null && v1.revisionCount === 0,
      "1. first write: updatedAt null, revisionCount 0");

  // ===== Case 2: gradeDistance — app lenient (positive) =====
  // app=B(1), tech=C(2) → 2-1 = +1
  assert(v1.gradeDistance === 1,
      "2. gradeDistance +1 when app graded better than technician (lenient)");
  assert(v1.consistencyFlag === false,
      "2. agreement app_lenient matches positive distance → no flag");

  // ===== Case 3: gradeDistance — app harsh (negative) =====
  // app=B(1), tech=A(0) → 0-1 = -1
  await seedReport("e3", "owner");
  await run({scanId: "e3", technicianGrade: "A", agreement: "app_harsh"}, "owner");
  const v3 = await getEval("e3");
  assert(v3.gradeDistance === -1,
      "3. gradeDistance -1 when app graded worse than technician (harsh)");
  assert(v3.consistencyFlag === false, "3. app_harsh matches negative distance");

  // ===== Case 4: exact agreement → 0 =====
  await seedReport("e4", "owner");
  await run({scanId: "e4", technicianGrade: "B", agreement: "agree"}, "owner");
  const v4 = await getEval("e4");
  assert(v4.gradeDistance === 0 && v4.consistencyFlag === false,
      "4. identical grades → distance 0, no flag");

  // ===== Case 5: consistency flag — claim contradicts the arithmetic =====
  // Technician says "agree" but graded D while the app said B.
  await seedReport("e5", "owner");
  const ret5 = await run({
    scanId: "e5", technicianGrade: "D", agreement: "agree",
  }, "owner");
  const v5 = await getEval("e5");
  assert(v5.gradeDistance === 2, "5. contradiction still records true distance (+2)");
  assert(v5.agreement === "agree", "5. contradiction stores the claim verbatim");
  assert(v5.consistencyFlag === true, "5. consistencyFlag raised, request NOT rejected");
  assert(ret5.success === true, "5. contradictory submission still succeeds");

  // ===== Case 6: app grade with a +/- suffix folds to its letter =====
  await seedReport("e6", "owner", {grade: "B+", aiResponse: {grade: "B+", score: 84}});
  await run({scanId: "e6", technicianGrade: "B", agreement: "agree"}, "owner");
  const v6 = await getEval("e6");
  assert(v6.appGrade === "B+" && v6.gradeDistance === 0,
      "6. 'B+' stored verbatim but compared as B → distance 0");

  // ===== Case 7: ownership =====
  await seedReport("e7", "owner");
  const errForeign = await expectReject(
      {scanId: "e7", technicianGrade: "A", agreement: "agree"}, "intruder");
  assert(errForeign && /ليس ضمن حسابك/.test(errForeign),
      "7. non-owner rejected (permission-denied)");
  assert((await getEval("e7")) === undefined,
      "7. non-owner write left NO document");

  const errAnon = await expectReject(
      {scanId: "e7", technicianGrade: "A", agreement: "agree"}, null);
  assert(errAnon && /تسجيل الدخول/.test(errAnon), "7. unauthenticated rejected");

  const errMissing = await expectReject(
      {scanId: "nope", technicianGrade: "A", agreement: "agree"}, "owner");
  assert(errMissing && /غير موجود/.test(errMissing), "7. missing report rejected");

  // ===== Case 8: every invalid value is rejected =====
  await seedReport("e8", "owner");
  const base = {scanId: "e8", technicianGrade: "A", agreement: "agree"};

  assert(await expectReject({...base, scanId: ""}, "owner"),
      "8. empty scanId rejected");
  assert(await expectReject({...base, technicianGrade: "F"}, "owner"),
      "8. technicianGrade 'F' rejected");
  assert(await expectReject({...base, technicianGrade: "B+"}, "owner"),
      "8. technicianGrade 'B+' rejected (technician scale is A-D only)");
  assert(await expectReject({...base, technicianGrade: 2}, "owner"),
      "8. numeric technicianGrade rejected");
  assert(await expectReject({...base, agreement: "yes"}, "owner"),
      "8. agreement 'yes' rejected");
  assert(await expectReject({...base, errorMagnitude: "huge"}, "owner"),
      "8. errorMagnitude 'huge' rejected");
  assert(await expectReject({...base, disputedCategories: "battery"}, "owner"),
      "8. non-array disputedCategories rejected");
  assert(await expectReject({...base, durationMs: -5}, "owner"),
      "8. negative durationMs rejected");
  assert(await expectReject({...base, durationMs: "41000"}, "owner"),
      "8. string durationMs rejected");
  assert(await expectReject({...base, technicianName: "x".repeat(200)}, "owner"),
      "8. over-long technicianName rejected");

  // Surface categories are deliberately NOT accepted — the buyer inspects
  // display/camera/wireless directly, so technician disputes on them would
  // pollute the training signal.
  for (const surface of ["display", "camera", "wireless"]) {
    const err = await expectReject(
        {...base, disputedCategories: [surface]}, "owner");
    assert(err && /فئة غير مقبولة/.test(err),
        `8. surface category "${surface}" rejected from disputedCategories`);
  }
  assert(await expectReject({...base, disputedCategories: ["battery", "banana"]}, "owner"),
      "8. unknown category 'banana' rejected");

  assert((await getEval("e8")) === undefined,
      "8. no document written by any rejected call");

  // ===== Case 9: all optionals absent =====
  await seedReport("e9", "owner");
  const ret9 = await run({
    scanId: "e9", technicianGrade: "A", agreement: "app_harsh",
  }, "owner");
  const v9 = await getEval("e9");
  assert(ret9.success === true, "9. minimal submission succeeds");
  assert(v9.errorMagnitude === null && v9.technicianName === null &&
         v9.durationMs === null,
  "9. absent optionals written as explicit null (never undefined)");
  assert(Array.isArray(v9.disputedCategories) && v9.disputedCategories.length === 0,
      "9. absent disputedCategories → empty array");
  assert(v9.gradeDistance === -1, "9. derived fields still computed");

  // ===== Case 10: report missing the e45237e fields → nulls, no crash =====
  await seedReport("e10", "owner", {
    timeSeriesStoragePath: null, deviceFingerprintSha: null,
    fieldsVersion: null, appVersion: null,
  });
  await run({scanId: "e10", technicianGrade: "B", agreement: "agree"}, "owner");
  const v10 = await getEval("e10");
  assert(v10.fieldsVersion === null && v10.appVersion === null &&
         v10.linkageIncomplete === true && v10.missingLinkageFields.length === 4 &&
         v10.linkageRawState === "PRIVATE" &&
         !("timeSeriesStoragePath" in v10) && !("deviceFingerprintSha" in v10),
  "10. report with null linkage fields (path/sha null in the raw, mirrors null) → four missing named, state PRIVATE, no crash, nothing copied");

  // ===== Case 11: re-evaluation keeps createdAt, counts revisions =====
  const createdAtBefore = v1.createdAt.toDate().getTime();
  const ret11 = await run({
    scanId: "e1",
    technicianGrade: "B",
    agreement: "agree",
    errorMagnitude: "minor",
    disputedCategories: ["cpu"],
    technicianName: "أبو أحمد",
  }, "owner");
  const v11 = await getEval("e1");

  assert(ret11.isRevision === true && ret11.revisionCount === 1,
      "11. re-evaluation reported as revision #1");
  assert(v11.createdAt.toDate().getTime() === createdAtBefore,
      "11. original createdAt PRESERVED across revision");
  assert(v11.updatedAt && typeof v11.updatedAt.toDate === "function",
      "11. updatedAt set on revision");
  assert(v11.revisionCount === 1, "11. revisionCount incremented 0 → 1");
  assert(v11.technicianGrade === "B" && v11.agreement === "agree" &&
         v11.gradeDistance === 0 && v11.consistencyFlag === false,
  "11. revised verdict replaces the previous one, derived fields recomputed");
  assert(v11.errorMagnitude === "minor" &&
         v11.disputedCategories.length === 1 && v11.disputedCategories[0] === "cpu",
  "11. revised optional fields replaced (not merged with the old ones)");

  const ret12 = await run({
    scanId: "e1", technicianGrade: "A", agreement: "app_harsh",
  }, "owner");
  const v12 = await getEval("e1");
  assert(ret12.revisionCount === 2 && v12.revisionCount === 2,
      "11. second revision → revisionCount 2");
  assert(v12.errorMagnitude === null && v12.disputedCategories.length === 0,
      "11. optionals omitted on revision reset to null/empty (full overwrite)");
  assert(v12.createdAt.toDate().getTime() === createdAtBefore,
      "11. createdAt still the original after two revisions");

  // ===== Case 12: duplicate categories collapse =====
  await seedReport("e13", "owner");
  await run({
    scanId: "e13", technicianGrade: "C", agreement: "app_lenient",
    disputedCategories: ["battery", "battery", "BATTERY"],
  }, "owner");
  const v13 = await getEval("e13");
  assert(v13.disputedCategories.length === 1 && v13.disputedCategories[0] === "battery",
      "12. duplicate / differently-cased categories collapse to one");

  // ===== Case 13: reports collection untouched by evaluation writes =====
  const r1 = (await db.collection("reports").doc("e1").get()).data();
  assert(r1.grade === "B" && r1.score === 78 &&
         r1.technicianGrade === undefined && r1.agreement === undefined,
  "13. reports/{scanId} NOT modified — no evaluation field leaked into it");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
