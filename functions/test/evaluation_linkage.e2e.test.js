// E2E test: linkage guard + cross-path snapshot equivalence
// (fix/evaluation-linkage-guard; reworked for the V8 raw move, 2026-10-09).
//
// Born from a real production miss: the first genuine technician label came
// back with all four linkage fields null. The trigger was fine — the report
// itself lacked them, because analyzeDevice had never been redeployed after
// e45237e added them. Nothing surfaced the problem; it was found by eye.
//
// Guarantees locked in here:
//   1. An incomplete link (no raw, a raw with no path/sha, a report without the version mirrors)
//      raises linkageIncomplete on BOTH paths, and the raw STATE is stored explicitly
//      (linkageRawState: PRIVATE | EMBEDDED_LEGACY | ABSENT — rule 22), so the next
//      occurrence is visible in the row itself.
//   2. The session path and the authenticated path produce byte-identical
//      report snapshots — compared field by field, not spot-checked.
//   3. (V8 raw move — user decision 6: "no copying of the identifiers into evaluations, the link
//      stays on the server side") the evaluation NEVER carries timeSeriesStoragePath,
//      deviceFingerprintSha or sessionId, on either path, in any raw state. The link is the shared
//      scanId: evaluations/{scanId} <-> reportRaw/{scanId}.
//   4. The late-resolution trigger is the REAL handler (resolvePendingEvaluation.run) fed with the
//      real snapshot read back from the emulator — not a copy of its body (rule 37: the earlier
//      version mirrored the trigger body and so could never notice the trigger reading the raw from
//      its event payload, which is exactly what the raw move changes).
//
// Rule 23: the assertions that proved the identifiers were copied into the evaluation, and that
// sessionId was recorded on the session route, were REPLACED by the ones above, not left beside them.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/evaluation_linkage.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const {db} = require("../src/utils/admin");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {resolvePendingEvaluation} = require("../src/evaluations/resolvePendingEvaluation");
const {
  LINKAGE_FIELDS, RAW_LINKAGE_FIELDS, linkageStatus, buildReportSnapshot,
} = require("../src/evaluations/evaluationContract");
const {RAW_STATE} = require("../src/analysis/reportRawStore");

const SHA = "a".repeat(64);
const getEval = async (s) => (await db.collection("evaluations").doc(s).get()).data();
const future = () => new Date(Date.now() + 10 * 60 * 1000);
const IDENTIFIERS = ["timeSeriesStoragePath", "deviceFingerprintSha", "sessionId"];

async function run(data, uid) {
  return submitEvaluation.run({
    data, auth: uid ? {uid} : null, rawRequest: {headers: {}},
  });
}

// The readable report exactly as analyzeDevice writes it NOW (V8): no rawFingerprint, no sessionId,
// no deviceFingerprintSha, no timeSeriesStoragePath, no aiAudit. userId stays.
function modernReport(scanId, ownerUid) {
  return {
    userId: ownerUid,
    deviceFingerprint: "SM-G973F", deviceModel: "SM-G973F",
    deviceMarketingName: "Galaxy S10",
    fieldsVersion: 65, appVersion: "1.0.8-v6beta",
    aiModel: "deepseek-v4-flash", pipeline: "v6_raw_timeseries",
    grade: "B", score: 78, language: "ar",
    aiResponse: {
      grade: "B", score: 78,
      category_scores: {
        battery: {grade: "B", score: 72, pass_count: 3, total_count: 4, note: "ملاحظة"},
        cpu: {grade: "A", score: 90, pass_count: 5, total_count: 5, note: "ممتاز"},
      },
    },
  };
}

// The raw document analyzeDevice writes beside it (reportRaw/{scanId}).
function modernRaw(scanId) {
  return {
    scanId,
    rawFingerprint: {
      device: {model: "SM-G973F", androidVersion: "12", apiLevel: 31},
      timeSeries: {header: {androidApiLevel: 31}, footer: {}},
    },
    sessionId: null,
    deviceFingerprintSha: SHA,
    timeSeriesStoragePath: `scans/${SHA}/${scanId}.ts.json.gz`,
    aiAudit: null,
    source: "analyzeDevice",
  };
}

// A report written BEFORE the raw move: the raw embedded in the report itself (EMBEDDED_LEGACY).
function embeddedLegacyReport(scanId, ownerUid) {
  const {scanId: _s, source: _src, ...embedded} = modernRaw(scanId);
  return {...modernReport(scanId, ownerUid), ...embedded};
}

async function seedReport(scanId, doc) {
  await db.collection("reports").doc(scanId).set(doc);
}
async function seedRaw(scanId, doc) {
  await db.collection("reportRaw").doc(scanId).set(doc);
}
async function seedSession(id, ownerUid) {
  await db.collection("scanSessions").doc(id).set({
    ownerId: ownerUid, status: "scanning", expiresAt: future(), code: "NC-T1",
  });
}

// The REAL trigger handler, fed the real report snapshot (event.data) and params — the emulator runs
// Firestore only (no functions runtime to fire triggers), so the event is built by hand but the
// handler body, the transaction and the raw read are the production code.
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
const noIdentifiers = (ev) => IDENTIFIERS.every((f) => !(f in ev));

(async () => {
  // ===== Case 1: complete report + PRIVATE raw → no flag, on both paths =====
  await seedReport("c1", modernReport("c1", "owner"));
  await seedRaw("c1", modernRaw("c1"));
  const ret1 = await run({scanId: "c1", technicianGrade: "C"}, "owner");
  const v1 = await getEval("c1");
  assert(v1.linkageIncomplete === false, "1. auth path, complete report + reportRaw → linkageIncomplete false");
  assert(Array.isArray(v1.missingLinkageFields) && v1.missingLinkageFields.length === 0,
      "1. missingLinkageFields empty");
  assert(v1.linkageRawState === RAW_STATE.PRIVATE, "1. linkageRawState === PRIVATE (stored explicitly)");
  assert(ret1.linkageIncomplete === false, "1. flag echoed in the response");
  assert(noIdentifiers(v1), "1. evaluation carries NO timeSeriesStoragePath / deviceFingerprintSha / sessionId (decision 6)");
  assert(v1.androidVersion === "12" && v1.apiLevel === 31,
      "1. androidVersion/apiLevel still snapshotted (read from reportRaw — they are not identifiers)");

  await seedSession("s2", "owner");
  await seedReport("c2", modernReport("c2", "owner"));
  await seedRaw("c2", modernRaw("c2"));
  await run({scanId: "c2", sessionId: "s2", technicianGradeRaw: "fair"}, null);
  const v2 = await getEval("c2");
  assert(v2.linkageIncomplete === false && v2.linkageRawState === RAW_STATE.PRIVATE,
      "1. session path, complete report + reportRaw → false / PRIVATE");
  assert(noIdentifiers(v2), "1. session path: evaluation carries none of the three identifiers either");
  assert(v2.source === "session", "1. session path: the route is still recorded by source, not by sessionId");

  // ===== Case 2: the pre-migration shape — raw embedded in the report =====
  await seedReport("m1", embeddedLegacyReport("m1", "owner"));
  const retM = await run({scanId: "m1", technicianGrade: "C"}, "owner");
  const vm = await getEval("m1");
  assert(vm.linkageIncomplete === false && vm.linkageRawState === RAW_STATE.EMBEDDED_LEGACY,
      "2. report written before the raw move (raw embedded) → complete, linkageRawState EMBEDDED_LEGACY");
  assert(noIdentifiers(vm), "2. even from an embedded raw, nothing identifying is copied into the evaluation");
  assert(vm.androidVersion === "12" && vm.apiLevel === 31, "2. device snapshot read from the embedded raw");
  assert(retM.linkageIncomplete === false, "2. flag echoed");

  // ===== Case 3: ABSENT — no reportRaw and nothing embedded =====
  await seedReport("c3", modernReport("c3", "owner"));     // readable report only, raw missing
  const ret3 = await run({scanId: "c3", technicianGrade: "C"}, "owner");
  const v3 = await getEval("c3");
  assert(v3.linkageIncomplete === true, "3. no raw anywhere → linkageIncomplete TRUE");
  assert(v3.linkageRawState === RAW_STATE.ABSENT, "3. linkageRawState === ABSENT (a distinct, visible state — not read as success)");
  assert(RAW_LINKAGE_FIELDS.every((f) => v3.missingLinkageFields.includes(f)) &&
         v3.missingLinkageFields.length === 2,
  "3. the two raw-side linkage fields named as missing (version mirrors are present on the report)");
  assert(ret3.linkageIncomplete === true, "3. caller is told immediately in the response");
  assert(v3.technicianGrade === "C" && v3.appGrade === "B" && v3.gradeDistance === 1,
      "3. the label itself is still stored and scored — flag does not reject");
  assert(v3.androidVersion === null && v3.apiLevel === null, "3. device snapshot fields null (no raw to read), not invented");

  // PRIVATE but with a degraded header (no fingerprint was shipped): path/sha null in the raw
  await seedReport("c4", modernReport("c4", "owner"));
  await seedRaw("c4", {...modernRaw("c4"), deviceFingerprintSha: null, timeSeriesStoragePath: null});
  await run({scanId: "c4", technicianGrade: "B"}, "owner");
  const v4 = await getEval("c4");
  assert(v4.linkageIncomplete === true && v4.linkageRawState === RAW_STATE.PRIVATE &&
         v4.missingLinkageFields.length === 2,
  "3. PRIVATE raw with a null path/sha → incomplete, state PRIVATE (told apart from ABSENT)");

  // partial staleness: version mirrors missing on the report
  const partial = modernReport("c5", "owner");
  delete partial.fieldsVersion; delete partial.appVersion;
  await seedReport("c5", partial);
  await seedRaw("c5", modernRaw("c5"));
  await run({scanId: "c5", technicianGrade: "B"}, "owner");
  const v5 = await getEval("c5");
  assert(v5.linkageIncomplete === true && v5.missingLinkageFields.length === 2 &&
         v5.missingLinkageFields.includes("fieldsVersion") &&
         v5.missingLinkageFields.includes("appVersion"),
  "3. partial staleness names exactly the missing two (the mirrors stay on the readable report)");

  // ===== Case 4: pending → null, not a false alarm; the REAL trigger resolves it =====
  await seedSession("s6", "owner");          // report deliberately absent
  const ret6 = await run({scanId: "c6", sessionId: "s6", technicianGradeRaw: "weak"}, null);
  const v6 = await getEval("c6");
  assert(v6.linkageIncomplete === null,
      "4. pending → linkageIncomplete null (undetermined, NOT a false alarm)");
  assert(v6.missingLinkageFields.length === 0, "4. pending → no missing list yet");
  assert(v6.linkageRawState === null, "4. pending → linkageRawState null (undetermined)");
  assert(ret6.pending === true, "4. response says pending");

  // analyzeDevice's atomic batch: the raw is committed together with the report, so the trigger finds it.
  await seedRaw("c6", modernRaw("c6"));
  await seedReport("c6", modernReport("c6", "owner"));
  await fireResolveTrigger("c6");
  const v6r = await getEval("c6");
  assert(v6r.linkageIncomplete === false && v6r.linkageRawState === RAW_STATE.PRIVATE,
      "4. REAL trigger, report + reportRaw present → flag decided: false / PRIVATE (the raw is read, not taken from the event)");
  assert(noIdentifiers(v6r), "4. the trigger copies no identifier into the evaluation");
  assert(v6r.pending === false && v6r.androidVersion === "12", "4. trigger resolved the row and filled the device snapshot from the raw");

  // pending → resolved against a report with NO raw → flag raised at resolution
  await seedSession("s7", "owner");
  await run({scanId: "c7", sessionId: "s7", technicianGradeRaw: "good"}, null);
  const v7p = await getEval("c7");
  assert(v7p.linkageIncomplete === null, "4. still undetermined while pending");
  await seedReport("c7", modernReport("c7", "owner"));      // no reportRaw
  await fireResolveTrigger("c7");
  const v7r = await getEval("c7");
  assert(v7r.linkageIncomplete === true && v7r.linkageRawState === RAW_STATE.ABSENT && v7r.missingLinkageFields.length === 2,
      "4. REAL trigger raises the flag when the raw never arrived (ABSENT) — visible in the row");

  // owner mismatch is still caught by the real trigger before any raw read matters
  await seedSession("s8", "owner");
  await run({scanId: "c8", sessionId: "s8", technicianGradeRaw: "good"}, null);
  await seedReport("c8", modernReport("c8", "someone-else"));
  await seedRaw("c8", modernRaw("c8"));
  await fireResolveTrigger("c8");
  const v8 = await getEval("c8");
  assert(v8.ownerMismatch === true && v8.pending === false && v8.linkageIncomplete === null,
      "4. owner mismatch → flagged and not scored (unchanged behaviour)");

  // ===== Case 5: CROSS-PATH SNAPSHOT EQUIVALENCE, field by field =====
  // Same report content, same technician verdict, two different routes.
  // Every snapshot field must match — this is the invariant the production
  // miss made us doubt.
  const SNAPSHOT_FIELDS = [
    "deviceModel", "androidVersion", "apiLevel",
    "fieldsVersion", "appVersion", "aiModel", "pipeline",
    "appGrade", "appScore", "appCategoryScores", "linkageRawState",
  ];

  // Route A — authenticated, report already present
  await seedReport("xA", modernReport("xA", "owner"));
  await seedRaw("xA", modernRaw("xA"));
  await run({scanId: "xA", technicianGradeRaw: "fair"}, "owner");
  const A = await getEval("xA");

  // Route B — session, evaluation first, report second, the REAL trigger resolves
  await seedSession("sB", "owner");
  await run({scanId: "xB", sessionId: "sB", technicianGradeRaw: "fair"}, null);
  await seedRaw("xB", modernRaw("xB"));
  await seedReport("xB", modernReport("xB", "owner"));
  await fireResolveTrigger("xB");
  const B = await getEval("xB");

  let mismatches = 0;
  for (const f of SNAPSHOT_FIELDS) {
    const equal = JSON.stringify(A[f]) === JSON.stringify(B[f]);
    if (!equal) mismatches++;
    assert(equal, `5. cross-path field identical: ${f}` +
        (equal ? "" : ` (auth=${JSON.stringify(A[f])} session=${JSON.stringify(B[f])})`));
  }
  assert(mismatches === 0, "5. ZERO snapshot mismatches across the two paths");

  // the derived + guard fields must agree too
  assert(A.gradeDistance === B.gradeDistance && A.gradeDistance === 1,
      "5. gradeDistance identical across paths");
  assert(A.technicianGrade === B.technicianGrade && A.technicianGrade === "C",
      "5. derived technicianGrade identical across paths");
  assert(A.linkageIncomplete === B.linkageIncomplete && A.linkageIncomplete === false,
      "5. linkageIncomplete identical across paths");
  assert(A.consistencyFlag === B.consistencyFlag,
      "5. consistencyFlag identical across paths");

  // and the field that SHOULD differ, does — the route is told apart by `source`, no identifier needed
  assert(A.source === "authenticated" && B.source === "session",
      "5. source correctly distinguishes the two routes");
  assert(noIdentifiers(A) && noIdentifiers(B),
      "5. neither route records an identifier (the old 'sessionId recorded only on the session route' check is replaced)");

  // ===== Case 6: linkageStatus / buildReportSnapshot unit behaviour =====
  const present = {state: RAW_STATE.PRIVATE, raw: {timeSeriesStoragePath: "p", deviceFingerprintSha: "s"}};
  assert(linkageStatus({}, true).linkageIncomplete === null && linkageStatus({}, true).linkageRawState === null,
      "6. linkageStatus(pending) → null / null regardless of snapshot");
  assert(linkageStatus(buildReportSnapshot(null), false, {state: RAW_STATE.ABSENT, raw: null}).missingLinkageFields.length === 4,
      "6. empty snapshot + ABSENT raw → all four reported missing");
  assert(linkageStatus(buildReportSnapshot(modernReport("z", "o"), present), false, present).linkageIncomplete === false,
      "6. full snapshot + present raw → complete");
  assert(LINKAGE_FIELDS.length === 4 && RAW_LINKAGE_FIELDS.every((f) => LINKAGE_FIELDS.includes(f)),
      "6. LINKAGE_FIELDS still four; the raw-side two are a subset (one source)");
  assert(IDENTIFIERS.every((f) => !(f in buildReportSnapshot(null))) &&
         IDENTIFIERS.every((f) => !(f in buildReportSnapshot(modernReport("z", "o"), present))),
  "6. buildReportSnapshot never emits an identifier key");
  let threw = false;
  try {
    buildReportSnapshot(modernReport("z", "o"));
  } catch (e) {
    threw = /rawRead/.test(e.message);
  }
  assert(threw, "6. buildReportSnapshot(report) without a raw read throws — absence is never read as success (rule 22)");
  threw = false;
  try {
    linkageStatus({}, false);
  } catch (e) {
    threw = /rawRead/.test(e.message);
  }
  assert(threw, "6. linkageStatus(…, pending=false) without a raw read throws");

  console.log("\n" + results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ` +
      `(${results.length} assertions)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("TEST CRASHED:", e);
  process.exit(1);
});
