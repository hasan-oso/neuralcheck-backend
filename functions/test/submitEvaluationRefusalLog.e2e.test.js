// E2E test: سطر سجلّ قبل كل رفض في submitEvaluation (V8 قبل أوّل نشر، البند ٦، 2026-10-09). المعالج **الحقيقي** عبر .run() على محاكي Firestore
// (القاعدة 37): لا شيء مستبدَل إلا — في حالة الفشل غير المتوقَّع وحدها — db.runTransaction على النسخة المشتركة، لإحداث خطأ ليس HttpsError (لا
// سبيل لإحداثه طبيعياً).
//
// قرار المستخدم (بنصّه): «سطر سجلّ قبل كل رفض في submitEvaluation: معتمد، بنداً سادساً لوكيل الخادم. سبب مسمّى من مصدر واحد، بلا معرّف مستخدم ولا
// scanId خامّ (المُهشِّر المشترك من الدفعة ١). واختبار يثبت أن كل مسار رفض يكتب سطره.»
//
// الجدول أدناه يمرّ بكل سبب في SUBMIT_EVALUATION_REFUSAL (26): لكل حالة: رمز HttpsError ونصّه كما كانا قبل التغيير حرفياً (لا تغيير يراه المستخدم)،
// وسطر واحد بالسبب الصحيح، وبلا scanId خامّ ولا sessionId ولا uid ولا نصّ الرسالة، ومعه scanId مُهشَّراً حين يكون معروفاً وقت الرفض. وفي آخر
// الملفّ: أنّ الجدول يغطّي كل سبب (سبب جديد بلا حالة يُفشل)، وأنّ تقييماً ناجحاً لا يكتب سطر رفض.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/submitEvaluationRefusalLog.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");

const {admin, db} = require("../src/utils/admin");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {SUBMIT_EVALUATION_REFUSAL: R} = require("../src/evaluations/submitEvaluationRefusal");
const {
  VALID_TECHNICIAN_GRADES, VALID_GRADES_RAW, VALID_AGREEMENTS, VALID_ERROR_MAGNITUDES, DEPTH_CATEGORIES, RATING_CATEGORIES,
  VALID_RATINGS, VALID_VISIBLE_DEFECTS, MAX_TECHNICIAN_NAME_LEN,
} = require("../src/evaluations/evaluationContract");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const future = () => new Date(Date.now() + 30 * 60 * 1000);
const past = () => new Date(Date.now() - 30 * 60 * 1000);
const OWNER = "owner-uid-refusal-1";
const OTHER = "other-uid-refusal-2";
const SCAN = "scan-refusal-raw-id-aaa111";
const SESSION_RAW_ID = "session-refusal-raw-id-bbb222";
const authOwner = {uid: OWNER, token: {firebase: {sign_in_provider: "password"}}};
const authAnon = {uid: "anon-refusal-uid-3", token: {firebase: {sign_in_provider: "anonymous"}}};
const goodVerdict = {technicianGradeRaw: "good"};

// النصوص كما كانت قبل التغيير حرفياً (من submitEvaluation.js و sessionTimeout.js عند 8ae6a2b)
const list = (a, sep) => a.join(sep);
const CASES = [
  {reason: R.NOT_AUTHENTICATED_NO_SESSION, data: {scanId: SCAN, ...goodVerdict}, auth: null, code: "unauthenticated", message: "يجب تسجيل الدخول أو إدخال كود فحص", scanKnown: false},
  {reason: R.SESSION_NOT_FOUND, data: {sessionId: "no-such-session-raw-id", scanId: SCAN, ...goodVerdict}, auth: authAnon, code: "permission-denied", message: "جلسة الفحص غير صالحة", scanKnown: false},
  {reason: R.SESSION_NOT_SCANNING, setup: () => db.collection("scanSessions").doc(SESSION_RAW_ID).set({ownerId: OWNER, status: "completed", expiresAt: future()}),
    data: {sessionId: SESSION_RAW_ID, scanId: SCAN, ...goodVerdict}, auth: authAnon, code: "permission-denied", message: "جلسة الفحص غير صالحة", scanKnown: false},
  {reason: R.SESSION_EXPIRES_AT_INVALID, setup: () => db.collection("scanSessions").doc(SESSION_RAW_ID).set({ownerId: OWNER, status: "scanning"}),
    data: {sessionId: SESSION_RAW_ID, scanId: SCAN, ...goodVerdict}, auth: authAnon, code: "permission-denied", message: "جلسة الفحص غير صالحة", scanKnown: false},
  {reason: R.SESSION_EXPIRED, setup: () => db.collection("scanSessions").doc(SESSION_RAW_ID).set({ownerId: OWNER, status: "scanning", expiresAt: past()}),
    data: {sessionId: SESSION_RAW_ID, scanId: SCAN, ...goodVerdict}, auth: authAnon, code: "failed-precondition", message: "الجلسة منتهية", scanKnown: false},
  {reason: R.SCAN_ID_REQUIRED, data: {...goodVerdict}, auth: authOwner, code: "invalid-argument", message: "scanId مطلوب", scanKnown: false},
  {reason: R.INVALID_TECHNICIAN_GRADE_RAW, data: {scanId: SCAN, technicianGradeRaw: "superb"}, auth: authOwner, code: "invalid-argument",
    message: `technicianGradeRaw يجب أن يكون أحد: ${list(VALID_GRADES_RAW, "/")}`, scanKnown: true},
  {reason: R.INVALID_TECHNICIAN_GRADE, data: {scanId: SCAN, technicianGrade: "Z"}, auth: authOwner, code: "invalid-argument",
    message: `technicianGrade يجب أن يكون أحد: ${list(VALID_TECHNICIAN_GRADES, "/")}`, scanKnown: true},
  {reason: R.INVALID_AGREEMENT, data: {scanId: SCAN, ...goodVerdict, agreement: "maybe"}, auth: authOwner, code: "invalid-argument",
    message: `agreement يجب أن يكون أحد: ${list(VALID_AGREEMENTS, "/")}`, scanKnown: true},
  {reason: R.INVALID_ERROR_MAGNITUDE, data: {scanId: SCAN, ...goodVerdict, errorMagnitude: "huge"}, auth: authOwner, code: "invalid-argument",
    message: `errorMagnitude يجب أن يكون أحد: ${list(VALID_ERROR_MAGNITUDES, "/")}`, scanKnown: true},
  {reason: R.CATEGORY_RATINGS_NOT_MAP, data: {scanId: SCAN, ...goodVerdict, categoryRatings: "x"}, auth: authOwner, code: "invalid-argument", message: "categoryRatings يجب أن تكون خريطة", scanKnown: true},
  {reason: R.CATEGORY_RATINGS_UNKNOWN_CATEGORY, data: {scanId: SCAN, ...goodVerdict, categoryRatings: {not_a_category: "good"}}, auth: authOwner, code: "invalid-argument",
    message: `فئة غير مقبولة في categoryRatings: "not_a_category". المقبول حصراً: ${list(RATING_CATEGORIES, ", ")}`, scanKnown: true},
  {reason: R.CATEGORY_RATINGS_INVALID_RATING, data: {scanId: SCAN, ...goodVerdict, categoryRatings: {[RATING_CATEGORIES[0]]: "stellar"}}, auth: authOwner, code: "invalid-argument",
    message: `تقييم غير مقبول للفئة "${RATING_CATEGORIES[0]}": "stellar". المقبول حصراً: ${list(VALID_RATINGS, "/")}`, scanKnown: true},
  {reason: R.VISIBLE_DEFECTS_NOT_ARRAY, data: {scanId: SCAN, ...goodVerdict, visibleDefects: "cracked"}, auth: authOwner, code: "invalid-argument", message: "visibleDefects يجب أن تكون مصفوفة", scanKnown: true},
  {reason: R.VISIBLE_DEFECTS_TOO_MANY, data: {scanId: SCAN, ...goodVerdict, visibleDefects: Array(VALID_VISIBLE_DEFECTS.length + 1).fill(VALID_VISIBLE_DEFECTS[0])}, auth: authOwner,
    code: "invalid-argument", message: `visibleDefects تتجاوز الحد (${VALID_VISIBLE_DEFECTS.length})`, scanKnown: true},
  {reason: R.VISIBLE_DEFECTS_INVALID_VALUE, data: {scanId: SCAN, ...goodVerdict, visibleDefects: ["cracked_everything"]}, auth: authOwner, code: "invalid-argument",
    message: `عيب غير مقبول في visibleDefects: "cracked_everything". المقبول حصراً: ${list(VALID_VISIBLE_DEFECTS, ", ")}`, scanKnown: true},
  {reason: R.DISPUTED_CATEGORIES_NOT_ARRAY, data: {scanId: SCAN, ...goodVerdict, disputedCategories: "battery"}, auth: authOwner, code: "invalid-argument", message: "disputedCategories يجب أن تكون مصفوفة", scanKnown: true},
  {reason: R.DISPUTED_CATEGORIES_TOO_MANY, data: {scanId: SCAN, ...goodVerdict, disputedCategories: Array(DEPTH_CATEGORIES.length + 1).fill(DEPTH_CATEGORIES[0])}, auth: authOwner,
    code: "invalid-argument", message: `disputedCategories تتجاوز الحد (${DEPTH_CATEGORIES.length})`, scanKnown: true},
  {reason: R.DISPUTED_CATEGORIES_INVALID_VALUE, data: {scanId: SCAN, ...goodVerdict, disputedCategories: ["no_such_depth_category"]}, auth: authOwner, code: "invalid-argument",
    message: `فئة غير مقبولة في disputedCategories: "no_such_depth_category". المقبول حصراً: ${list(DEPTH_CATEGORIES, ", ")}`, scanKnown: true},
  {reason: R.TECHNICIAN_NAME_NOT_STRING, data: {scanId: SCAN, ...goodVerdict, technicianName: 12345}, auth: authOwner, code: "invalid-argument", message: "technicianName يجب أن يكون نصاً", scanKnown: true},
  {reason: R.TECHNICIAN_NAME_TOO_LONG, data: {scanId: SCAN, ...goodVerdict, technicianName: "x".repeat(MAX_TECHNICIAN_NAME_LEN + 1)}, auth: authOwner, code: "invalid-argument",
    message: `technicianName يتجاوز ${MAX_TECHNICIAN_NAME_LEN} محرفاً`, scanKnown: true},
  {reason: R.DURATION_MS_INVALID, data: {scanId: SCAN, ...goodVerdict, durationMs: -5}, auth: authOwner, code: "invalid-argument", message: "durationMs يجب أن يكون عدداً موجباً", scanKnown: true},
  {reason: R.EVALUATION_EMPTY, data: {scanId: SCAN}, auth: authOwner, code: "invalid-argument", message: "التقييم فارغ: أرسل درجة أو تقييم فئات أو عيوباً ظاهرة على الأقل", scanKnown: true},
  {reason: R.REPORT_NOT_FOUND, data: {scanId: SCAN, ...goodVerdict}, auth: authOwner, code: "not-found", message: "التقرير غير موجود", scanKnown: true},
  {reason: R.REPORT_NOT_OWNED, setup: () => db.collection("reports").doc(SCAN).set({userId: OTHER, pipeline: "v7_findings_based", aiResponse: {}}),
    data: {scanId: SCAN, ...goodVerdict}, auth: authOwner, code: "permission-denied", message: "هذا التقرير ليس ضمن حسابك", scanKnown: true},
];

// ─── التقاط السجلّ ───────────────────────────────────────────────────────────────────────────────────────
function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log};
  const push = (level) => (...a) => { lines.push({level, text: a.join(" ")}); };
  console.warn = push("warn");
  console.error = push("error");
  console.log = push("log");
  return {lines, restore: () => { console.warn = real.warn; console.error = real.error; console.log = real.log; }};
}
async function run(data, auth) {
  const cap = capture();
  let threw = null;
  let ret = null;
  try {
    ret = await submitEvaluation.run({data, auth, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {threw, ret, lines: cap.lines};
}
async function clean() {
  for (const col of ["scanSessions", "reports", "evaluations", "reportRaw"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
const RAW_IDS = [OWNER, OTHER, SCAN, SESSION_RAW_ID, "no-such-session-raw-id", "anon-refusal-uid-3"];

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — كل مسار رفض: سطره بسببه الصحيح، والرمز والنصّ كما كانا، وبلا معرّف خامّ
  // ═══════════════════════════════════════════════════════════════════
  const covered = new Set();
  for (const c of CASES) {
    await clean();
    if (c.setup) await c.setup();
    const {threw, lines} = await run(c.data, c.auth);
    const label = `[${c.reason}]`;
    ok(threw && threw.code === c.code && threw.message === c.message, `${label} الرمز والنصّ كما كانا حرفياً (${c.code}) — got ${threw && threw.code}: ${threw && threw.message}`);
    const refusals = lines.filter((l) => /\[submitEvaluation\] refused /.test(l.text));
    eq(refusals.length, 1, `${label} سطر رفض واحد بالضبط`);
    eq(refusals[0].level, "warn", `${label} بمستوى warn`);
    const expectedLine = `[submitEvaluation] refused reason=${c.reason}` + (c.scanKnown ? ` scanId=${hashIdForLog(SCAN)}` : "");
    eq(refusals[0].text, expectedLine, `${label} السطر: السبب الصحيح${c.scanKnown ? " + scanId مُهشَّراً" : " بلا أيّ معرّف"}`);
    const all = lines.map((l) => l.text).join("\n");
    ok(!RAW_IDS.some((id) => all.includes(id)), `${label} لا scanId ولا sessionId ولا uid خامّ في أيّ سطر سجلّ من النداء`);
    ok(!all.includes(c.message), `${label} ولا نصّ الرسالة (قد يقتبس مُدخل العميل)`);
    ok(!lines.some((l) => /failed reason=UNEXPECTED_FAILURE/.test(l.text)), `${label} ولا سطر «فشل غير متوقَّع» (الرفض المسمّى ليس فشلاً)`);
    covered.add(c.reason);
  }
  console.log(`تحقّق ١: ${CASES.length} مساراً مسمّى`);

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الفشل غير المتوقَّع: سطر بالسبب UNEXPECTED_FAILURE ونصّ منقّى، ثم يُرمى كما كان
  // ═══════════════════════════════════════════════════════════════════
  await clean();
  await db.collection("reports").doc(SCAN).set({userId: OWNER, pipeline: "v7_findings_based", aiResponse: {}});
  const realRunTransaction = db.runTransaction.bind(db);
  const boom = Object.assign(new Error(`10 ABORTED: transaction failed on projects/demo-nc/databases/(default)/documents/evaluations/${SCAN} token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 api_key: sk-leaked-secret-123`), {code: 10});
  db.runTransaction = async () => { throw boom; };
  let unexpected;
  try {
    unexpected = await run({scanId: SCAN, ...goodVerdict}, authOwner);
  } finally {
    db.runTransaction = realRunTransaction;
  }
  ok(unexpected.threw === boom, "[UNEXPECTED_FAILURE] الخطأ يُرمى كما كان (الكائن نفسه، لا مغلَّف)");
  const failedLines = unexpected.lines.filter((l) => /failed reason=UNEXPECTED_FAILURE/.test(l.text));
  eq(failedLines.length, 1, "[UNEXPECTED_FAILURE] سطر واحد");
  eq(failedLines[0].level, "error", "[UNEXPECTED_FAILURE] بمستوى error");
  ok(/\[Error\] code=10 /.test(failedLines[0].text), "[UNEXPECTED_FAILURE] الصنف والرمز في السطر");
  ok(!failedLines[0].text.includes(SCAN) && !/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(failedLines[0].text) && !/sk-leaked-secret/.test(failedLines[0].text),
      "[UNEXPECTED_FAILURE] النصّ منقّى: لا scanId ولا رمز طويل ولا مفتاح (القاعدة 36)");
  ok(/evaluations\/\[id\]/.test(failedLines[0].text), "[UNEXPECTED_FAILURE] المسار بلا معرّفه");
  ok(!unexpected.lines.some((l) => /refused reason=/.test(l.text)), "[UNEXPECTED_FAILURE] ولا سطر رفض مسمّى (ليس رفضاً)");
  covered.add(R.UNEXPECTED_FAILURE);
  console.log("تحقّق ٢: الفشل غير المتوقَّع");

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — الجدول يغطّي كل سبب؛ وتقييم ناجح لا يكتب سطر رفض
  // ═══════════════════════════════════════════════════════════════════
  const all = new Set(Object.values(R));
  const missing = [...all].filter((r) => !covered.has(r));
  eq(missing.length, 0, `[٣] كل سبب في SUBMIT_EVALUATION_REFUSAL له حالة في هذا الجدول (الناقص: ${missing.join(",") || "لا شيء"})`);
  eq(covered.size, 26, "[٣] 26 سبباً مغطّى");
  await clean();
  await db.collection("reports").doc(SCAN).set({userId: OWNER, pipeline: "v7_findings_based", aiResponse: {}});
  const good = await run({scanId: SCAN, ...goodVerdict}, authOwner);
  ok(good.threw === null && good.ret && good.ret.success === true, "[٣] تقييم صالح ينجح كما كان");
  ok(!good.lines.some((l) => /refused reason=|failed reason=/.test(l.text)), "[٣] ولا يكتب سطر رفض ولا فشل");

  await clean();
  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", e && e.stack || e);
  process.exit(1);
});
