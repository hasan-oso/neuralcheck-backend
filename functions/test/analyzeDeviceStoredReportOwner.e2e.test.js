"use strict";

// analyzeDeviceStoredReportOwner.e2e.test.js — التقرير المخزَّن (analyzeDevice، فرع 1b) لا يُردّ إلا لمالكه، على محاكي Firestore (البند ٢، 2026-10-17 +03).
// القرار (المنسّق، منقول من نصّ الأمر): `ownerCheckState(userId, reports/{scanId}.userId) === MATCH` قبل تقديم أيّ تقرير مخزَّن في كل المسارات؛ غير ذلك ⟵ رفض مسمّى بلا أيّ جزء من التقرير، بلا كتابة ولا خصم رصيد.
// يقابل الاختبارَ الذي بالذاكرة (analyzeDeviceStoredReportOwner.test.js) بمحاكٍ حقيقي: المعالج الحقيقي وFirestore حقيقي (محاكٍ) والغلاف الحقيقي للمعاملة؛ المستبدَل الشبكة وحدها (fetch يرمي: أيّ نداء نموذج فشل صريح).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/analyzeDeviceStoredReportOwner.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

let networkCalls = 0;
global.fetch = async () => {
  networkCalls++;
  throw new Error("stub: no network — a model call here means a new scan started instead of the stored-report path");
};

const assert = require("assert");
const {db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {HttpsError} = require("firebase-functions/v2/https");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const future = () => new Date(Date.now() + 3600000);
const MARKER = "E2E-STORED-REPORT-MARKER-1c7b";
const AI = {grade: "A", marker: MARKER, categories: [{name: "x"}]};
const FP = {device: {model: "P", androidVersion: "14", totalRamGb: 8}};
const SESSION_TEXT = "جلسة الفحص غير صالحة";
const PERSONAL_TEXT = "تعذّر إتمام الطلب";

const seedUser = (id, fields) => db.collection("users").doc(id).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: future(), ...fields});
const seedReport = (id, fields) => db.collection("reports").doc(id).set({pipeline: "seeded_test", aiResponse: AI, shortId: "NC-AAAAAA", deviceModel: "M", createdAt: new Date(), ...fields});
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set({ownerId: "owner", status: "scanning", joinedBy: "joiner", scanId: null, deviceModel: null, code: `NC-${id}`, expiresAt: future(), ...fields});
const sdata = async (id) => (await db.collection("scanSessions").doc(id).get()).data();
const credit = async (id) => (await db.collection("users").doc(id).get()).data().scansRemaining;

async function call(data, uid) {
  const lines = [];
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = (...a) => lines.push(a.join(" ")); console.warn = (...a) => lines.push(a.join(" ")); console.error = (...a) => lines.push(a.join(" "));
  let value; let thrown = null;
  try {
    value = await analyzeDevice.run({data, auth: uid ? {uid, token: {}} : undefined, rawRequest: {headers: {}}});
  } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {value, thrown, lines};
}
function refused(r, message, reason, label) {
  ok(r.thrown instanceof HttpsError && r.thrown.code === "permission-denied", `${label}: permission-denied (${r.thrown && r.thrown.code}/${r.thrown && r.thrown.message}; value=${JSON.stringify(r.value)})`);
  eq(r.thrown.message, message, `${label}: النصّ`);
  deq(r.thrown.details, {reasonCode: reason}, `${label}: details = {reasonCode}`);
  ok(!JSON.stringify(r.thrown.toJSON()).includes(MARKER), `${label}: لا شيء من التقرير في الخطأ`);
  eq(r.value, undefined, `${label}: ولا قيمة مردودة`);
}

(async () => {
  await seedUser("owner", {});
  await seedUser("other-user", {});

  // ═══ المسار الشخصي ═══
  await seedReport("scan-p1", {userId: "owner"});
  const a = await call({scanId: "scan-p1", fingerprint: FP}, "owner");
  ok(!a.thrown, `[شخصي أ] المالك يعيد المحاولة: يُقدَّم (${a.thrown && a.thrown.message})`);
  deq(a.value, AI, "[شخصي أ] الردّ المخزَّن بعينه");
  eq(await credit("owner"), 5, "[شخصي أ] بلا خصم");

  const b = await call({scanId: "scan-p1", fingerprint: FP}, "other-user");
  refused(b, PERSONAL_TEXT, "SCAN_REPORT_NOT_AVAILABLE", "[شخصي ب] uid آخر (له رصيد ولو شاء لدخل فحصاً جديداً)");
  eq(await credit("other-user"), 5, "[شخصي ب] لا خصم من المستدعي");
  eq(await credit("owner"), 5, "[شخصي ب] ولا من المالك");
  ok(!(await db.collection("scanClaims").doc("scan-p1").get()).exists, "[شخصي ب] ولا قفل scanClaims (لم يبدأ فحص جديد)");
  ok(b.lines.some((l) => /^\[analyzeDevice\] stored-report refused reason=SCAN_REPORT_NOT_AVAILABLE ownerCheck=MISMATCH path=personal scanId=#[0-9a-f]{12} session=no$/.test(l)) && !b.lines.join("\n").includes("scan-p1"),
      "[شخصي ب] السطر المسمّى بمعرّف مُهشَّر");

  await seedReport("scan-p2", {});
  const e = await call({scanId: "scan-p2", fingerprint: FP}, "owner");
  refused(e, PERSONAL_TEXT, "SCAN_REPORT_NOT_AVAILABLE", "[شخصي هـ] تقرير بلا userId");
  ok(e.lines.some((l) => l.includes("ownerCheck=REPORT_USER_ABSENT")), "[شخصي هـ] والسطر يسمّي REPORT_USER_ABSENT");

  // ═══ مسار الجلسة (scanning) ═══
  await seedSession("sess-c", {});
  await seedReport("scan-c", {userId: "owner"});
  const c = await call({scanId: "scan-c", sessionId: "sess-c", fingerprint: FP}, "customer-anon");
  ok(!c.thrown, `[جلسة ج] زبون مجهول بـsessionId، مالك الجلسة = صاحب التقرير: يُقدَّم (${c.thrown && c.thrown.message})`);
  deq(c.value, AI, "[جلسة ج] الردّ المخزَّن بعينه");
  const sc = await sdata("sess-c");
  deq([sc.status, sc.scanId, sc.shortId, sc.deviceModel], ["completed", "scan-c", "NC-AAAAAA", "M"], "[جلسة ج] وتُكتب «اكتملت» بحقول التقرير (المسار ب كما كان)");
  ok(!(await db.collection("users").doc("customer-anon").get()).exists, "[جلسة ج] والجهاز المجهول بلا مستند users");

  await seedSession("sess-m", {});
  await seedReport("scan-m", {userId: "someone-else"});
  const m = await call({scanId: "scan-m", sessionId: "sess-m", fingerprint: FP}, "customer-anon");
  refused(m, SESSION_TEXT, "SESSION_REPORT_NOT_AVAILABLE", "[جلسة ج٢] التقرير ملكيته لغير مالك الجلسة");
  const sm = await sdata("sess-m");
  ok(sm.status === "scanning" && sm.scanId === null && !("completedAt" in sm), "[جلسة ج٢] الجلسة تبقى scanning ولا scanId ولا completedAt");
  ok(m.lines.some((l) => /^\[analyzeDevice\] stored-report refused reason=SESSION_REPORT_NOT_AVAILABLE ownerCheck=MISMATCH path=session scanId=#[0-9a-f]{12} session=#[0-9a-f]{12}$/.test(l)) && !m.lines.join("\n").includes("sess-m"),
      "[جلسة ج٢] السطر المسمّى بمعرّفين مُهشَّرين");
  eq(await credit("owner"), 5, "[جلسة ج٢] بلا خصم من مالك الجلسة");

  await seedSession("sess-n", {});
  await seedReport("scan-n", {});
  const nn = await call({scanId: "scan-n", sessionId: "sess-n", fingerprint: FP}, "joiner");
  refused(nn, SESSION_TEXT, "SESSION_REPORT_NOT_AVAILABLE", "[جلسة هـ] تقرير بلا userId");
  eq((await sdata("sess-n")).status, "scanning", "[جلسة هـ] الجلسة تبقى scanning");

  // ═══ جلسة completed: السلوك القائم كما هو ═══
  await seedSession("sess-d", {status: "completed", scanId: "scan-d"});
  await seedReport("scan-d", {userId: "owner"});
  const d = await call({scanId: "scan-d", sessionId: "sess-d", fingerprint: FP}, "joiner");
  ok(!d.thrown, "[جلسة د] completed بتقرير المالك والطالب مشروع: يُقدَّم");
  deq(d.value, AI, "[جلسة د] الردّ المخزَّن");
  await seedSession("sess-d2", {status: "completed", scanId: "scan-d2"});
  await seedReport("scan-d2", {userId: "someone-else"});
  const d2 = await call({scanId: "scan-d2", sessionId: "sess-d2", fingerprint: FP}, "joiner");
  refused(d2, SESSION_TEXT, "SESSION_COMPLETED", "[جلسة د] completed بتقرير غير المالك: الرمز القائم");

  eq(networkCalls, 0, "[عام] صفر نداء شبكة/نموذج في كل المسارات");
  console.log(`analyzeDeviceStoredReportOwner.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
