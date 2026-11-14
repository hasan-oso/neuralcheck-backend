// E2E test: سطرا submitEvaluation (الربط الناقص، والتقييم الناجح) يكتبان scanId مُهشَّراً لا خامّاً (V8 قبل أوّل نشر، 2026-10-09 +03).
// المعالج الحقيقي عبر .run() على محاكي Firestore، بلا استبدال أيّ طبقة (القاعدة 37)؛ يُلتقَط كل ما يُكتب في console أثناء النداء
// (لا سطر submitEvaluation وحده: لو كتبت وحدة مستدعاة معرّفاً خامّاً لظهر هنا).
//
// قرار المستخدم (بنصّه): «scanId في submitEvaluation.js:309 و:380: يُهشَّر بـ hashIdForLog، في التزام صغير قبل قائمة النشر، مع اختبار.»
// والمطلوب: السطران يكتبان scanId= بـhashIdForLog(scanId) بالصيغة التي تكتبها refuse (# ثم 12 خانة سداسية عشرية) وبقيّة السطرين كما هي؛
// والمسارات الحقيقية: ربط ناقص، وتقييم ناجح؛ والمهشَّر حاضر والخامّ غائب؛ وإعادة الخامّ تُفشل الاختبار (ضوابط سلبية في تقرير الالتزام).
// لم يكن في السويت اختبار يثبّت هذين السطرين بالقيمة الخامّة (grep عند 217dd0a: الإشارة الوحيدة نصّ تاريخي في piiLogGuardSeeded.test.js:145
// ضمن مُدخلات مرفوضة بقصد، وهو لا يقرأ المصدر)، فلا استبدال هنا بحكم القاعدة 23 — اختبار جديد لسلوك جديد.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/submitEvaluationScanIdLog.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");

const {admin, db} = require("../src/utils/admin");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const SHA = "a".repeat(64);
const OWNER = "owner-uid-scanidlog-1";
const future = () => new Date(Date.now() + 10 * 60 * 1000);

// التقرير المقروء كما تكتبه analyzeDevice الآن (V8)، والخامّ بجانبه — كما في evaluation_linkage.e2e.test.js
function modernReport(ownerUid) {
  return {
    userId: ownerUid,
    deviceFingerprint: "SM-G973F", deviceModel: "SM-G973F", deviceMarketingName: "Galaxy S10",
    fieldsVersion: 65, appVersion: "1.0.8-v6beta", aiModel: "deepseek-v4-flash", pipeline: "v6_raw_timeseries",
    grade: "B", score: 78, language: "ar",
    aiResponse: {grade: "B", score: 78, category_scores: {battery: {grade: "B", score: 72, pass_count: 3, total_count: 4, note: "x"}}},
  };
}
function modernRaw(scanId) {
  return {
    scanId,
    rawFingerprint: {device: {model: "SM-G973F", androidVersion: "12", apiLevel: 31}, timeSeries: {header: {androidApiLevel: 31}, footer: {}}},
    sessionId: null, deviceFingerprintSha: SHA, timeSeriesStoragePath: `scans/${SHA}/${scanId}.ts.json.gz`, aiAudit: null, source: "analyzeDevice",
  };
}

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info, debug: console.debug};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function run(data, uid) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await submitEvaluation.run({data, auth: uid ? {uid, token: {firebase: {sign_in_provider: "password"}}} : null, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines};
}
async function clean() {
  for (const col of ["scanSessions", "reports", "evaluations", "reportRaw"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const SUCCESS_LINE = /^\[submitEvaluation\] scanId=#[0-9a-f]{12} owner=#[0-9a-f]{12} source=(auth|session) pending=(true|false) gradeRaw=\S+ grade=\S+ appGrade=\S+ distance=\S+ ratings=\d+ defects=\d+ revision=\d+$/;
const linkageLines = (lines) => lines.filter((l) => /LINKAGE INCOMPLETE/.test(l.text));
const successLines = (lines) => lines.filter((l) => /^\[submitEvaluation\] scanId=/.test(l.text));

(async () => {
  // ═══ أ — مسار مصادَق، تقييم ناجح، ربط كامل (تقرير + خامّ) ═══
  {
    await clean();
    const SCAN = "scan-ok-auth-rawid-0001";
    await db.collection("reports").doc(SCAN).set(modernReport(OWNER));
    await db.collection("reportRaw").doc(SCAN).set(modernRaw(SCAN));
    const {ret, threw, lines} = await run({scanId: SCAN, technicianGrade: "C"}, OWNER);
    ok(threw === null && ret && ret.success === true && ret.linkageIncomplete === false, "[أ] التقييم ينجح وبلا ربط ناقص");
    const ok1 = successLines(lines);
    eq(ok1.length, 1, "[أ] سطر نجاح واحد");
    ok(SUCCESS_LINE.test(ok1[0].text), `[أ] صيغة السطر محفوظة كما كانت (scanId مُهشَّر ثم owner مُهشَّر ثم بقيّة الحقول): ${ok1[0].text}`);
    ok(ok1[0].text.startsWith(`[submitEvaluation] scanId=${hashIdForLog(SCAN)} owner=${hashIdForLog(OWNER)} source=auth pending=false `), "[أ] السطر يحمل hashIdForLog(scanId) بعينه، والمالك مُهشَّراً، والمصدر auth والحالة غير معلّقة");
    ok(/ revision=0$/.test(ok1[0].text), `[أ] وبقيّة السطر كما كانت (أوّل كتابة revision=0): ${ok1[0].text}`);
    eq(linkageLines(lines).length, 0, "[أ] ولا سطر ربط ناقص مع ربط كامل");
    const all = lines.map((l) => l.text).join("\n");
    ok(!all.includes(SCAN) && !all.includes(OWNER), "[أ] لا scanId خامّ ولا uid خامّ في أيّ سطر كُتب أثناء النداء");
    // مراجعة التقييم نفسه: السطر مُهشَّر أيضاً، والعدّاد يتقدّم
    const second = await run({scanId: SCAN, technicianGrade: "B"}, OWNER);
    const ok2 = successLines(second.lines);
    eq(ok2.length, 1, "[أ] مراجعة التقييم: سطر نجاح واحد");
    ok(SUCCESS_LINE.test(ok2[0].text) && ok2[0].text.startsWith(`[submitEvaluation] scanId=${hashIdForLog(SCAN)} `) && / revision=1$/.test(ok2[0].text), `[أ] المراجعة: مُهشَّر وrevision=1: ${ok2[0].text}`);
    ok(!second.lines.map((l) => l.text).join("\n").includes(SCAN), "[أ] المراجعة: لا scanId خامّ");
  }

  // ═══ ب — مسار مصادَق، ربط ناقص (تقرير بلا خامّ: ABSENT) — يُكتب السطران في النداء نفسه ═══
  {
    await clean();
    const SCAN = "scan-incomplete-auth-rawid-0002";
    await db.collection("reports").doc(SCAN).set(modernReport(OWNER));
    const {ret, threw, lines} = await run({scanId: SCAN, technicianGrade: "C"}, OWNER);
    ok(threw === null && ret && ret.success === true && ret.linkageIncomplete === true, "[ب] التقييم ينجح مع راية الربط الناقص (الراية لا ترفض)");
    const inc = linkageLines(lines);
    eq(inc.length, 1, "[ب] سطر ربط ناقص واحد");
    eq(inc[0].level, "error", "[ب] بمستوى error كما كان");
    ok(inc[0].text.startsWith(`[submitEvaluation] LINKAGE INCOMPLETE scanId=${hashIdForLog(SCAN)} missing=[`), "[ب] السطر يحمل hashIdForLog(scanId) بعينه ثم missing=[ كما كان");
    ok(/ rawState=ABSENT — /.test(inc[0].text) && inc[0].text.includes("التسمية غير قابلة للربط بالقراءات الخام"), "[ب] وبقيّة السطر: rawState والنصّ التوضيحي كما كانا");
    const ok1 = successLines(lines);
    eq(ok1.length, 1, "[ب] وسطر النجاح كذلك (النداء نفسه)");
    ok(SUCCESS_LINE.test(ok1[0].text) && ok1[0].text.includes(`scanId=${hashIdForLog(SCAN)} `), "[ب] وهو مُهشَّر أيضاً");
    const all = lines.map((l) => l.text).join("\n");
    ok(!all.includes(SCAN) && !all.includes(OWNER), "[ب] لا scanId خامّ ولا uid خامّ في أيّ سطر كُتب أثناء النداء");
  }

  // ═══ ج — مسار الجلسة (QR)، ربط ناقص: sessionId أيضاً لا يظهر خامّاً ═══
  {
    await clean();
    const SCAN = "scan-incomplete-session-rawid-0003";
    const SESSION = "session-rawid-0003";
    await db.collection("scanSessions").doc(SESSION).set({ownerId: OWNER, status: "scanning", expiresAt: future(), code: "NC-T3"});
    await db.collection("reports").doc(SCAN).set(modernReport(OWNER));
    const {ret, threw, lines} = await run({scanId: SCAN, sessionId: SESSION, technicianGrade: "C"}, null);
    ok(threw === null && ret && ret.success === true && ret.linkageIncomplete === true, "[ج] مسار الجلسة: ينجح مع راية الربط الناقص");
    const inc = linkageLines(lines);
    eq(inc.length, 1, "[ج] سطر ربط ناقص واحد");
    ok(inc[0].text.startsWith(`[submitEvaluation] LINKAGE INCOMPLETE scanId=${hashIdForLog(SCAN)} `), "[ج] مُهشَّر على مسار الجلسة أيضاً");
    const ok1 = successLines(lines);
    eq(ok1.length, 1, "[ج] سطر نجاح واحد");
    ok(SUCCESS_LINE.test(ok1[0].text) && ok1[0].text.includes(" source=session pending=false "), "[ج] source=session، والصيغة محفوظة");
    const all = lines.map((l) => l.text).join("\n");
    ok(!all.includes(SCAN) && !all.includes(SESSION) && !all.includes(OWNER), "[ج] لا scanId ولا sessionId ولا uid خامّ في أيّ سطر");
  }

  // ═══ د — مسار الجلسة، تقييم معلَّق (لا تقرير بعد): سطر النجاح فقط، pending=true، بلا سطر ربط ناقص (غير محسوم لا إنذار كاذب) ═══
  {
    await clean();
    const SCAN = "scan-pending-session-rawid-0004";
    const SESSION = "session-rawid-0004";
    await db.collection("scanSessions").doc(SESSION).set({ownerId: OWNER, status: "scanning", expiresAt: future(), code: "NC-T4"});
    const {ret, threw, lines} = await run({scanId: SCAN, sessionId: SESSION, technicianGradeRaw: "weak"}, null);
    ok(threw === null && ret && ret.success === true && ret.pending === true, "[د] التقييم المعلَّق ينجح");
    eq(linkageLines(lines).length, 0, "[د] ولا سطر ربط ناقص (غير محسوم)");
    const ok1 = successLines(lines);
    eq(ok1.length, 1, "[د] سطر نجاح واحد");
    ok(SUCCESS_LINE.test(ok1[0].text) && ok1[0].text.includes(" source=session pending=true "), "[د] pending=true والصيغة محفوظة");
    ok(ok1[0].text.startsWith(`[submitEvaluation] scanId=${hashIdForLog(SCAN)} owner=${hashIdForLog(OWNER)} `), "[د] مُهشَّر");
    const all = lines.map((l) => l.text).join("\n");
    ok(!all.includes(SCAN) && !all.includes(SESSION) && !all.includes(OWNER), "[د] لا معرّف خامّ في أيّ سطر");
  }

  // ═══ هـ — شكل المُهشَّر نفسه: # + 12 خانة سداسية عشرية، ثابت للمعرّف نفسه ومختلف بين معرّفين (فلا يصير السطر بلا معنى) ═══
  ok(/^#[0-9a-f]{12}$/.test(hashIdForLog("scan-ok-auth-rawid-0001")), "[هـ] صيغة hashIdForLog: # ثم 12 خانة");
  ok(hashIdForLog("scan-a") === hashIdForLog("scan-a") && hashIdForLog("scan-a") !== hashIdForLog("scan-b"), "[هـ] ثابت للمعرّف ومختلف بين معرّفين");

  await clean();
  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", (e && e.stack) || e);
  process.exit(1);
});
