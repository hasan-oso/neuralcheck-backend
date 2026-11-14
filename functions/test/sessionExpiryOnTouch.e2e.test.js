// E2E test: «منتهية» تُكتب حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها — analyzeDevice وsubmitEvaluation (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03).
// المعالجان الحقيقيان عبر `.run()` على محاكي Firestore؛ لا يُستبدَل إلا نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) — القاعدة 37.
//
// قرار المستخدم (2026-10-10، بنصّه، منقول من أمر المنسّق): «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.
// والجلسات العالقة الثلاث القديمة تُعدّ فقط ولا تُعدَّل، إلا بأمر منّي.»  وأمر المنسّق: «والغياب حالة صريحة (القاعدة 22): جلسة بلا expiresAt لا تُقرأ «صالحة».»
//
// ما يثبته:
//   ١ analyzeDevice على جلسة scanning منقضية: يُرفض «الجلسة منتهية» (failed-precondition، كما كان)، وتُكتب في مستندها status=expired وexpiredAt، ولا يتغيّر
//     غيرهما (expiresAt وownerId وcode)؛ ولا قفل ولا تقرير ولا نداء نموذج ولا خصم؛ والنداء الثاني يُرفض «جلسة الفحص غير صالحة» ولا يعيد الكتابة.
//   ٢ expiresAt غائب أو تالف: يُرفض «جلسة الفحص غير صالحة» **بلا كتابة** (الجلسة تبقى scanning، لا expiredAt) — الغياب لا يُقرأ انقضاءً ولا صلاحيةً.
//   ٣ submitEvaluation: كالأوّل (الرفض بالسبب والرمز والنصّ القائمين + «منتهية» مكتوبة؛ والغياب بلا كتابة).
//   ٤ جلسة pending منقضية لا تمسّها analyzeDevice (حالتها ليست scanning فتُرفض قبل الانقضاء) — لا كتابة.
//   ٥ فحص جلسة صالح: القفل المكتوب على scanClaims (يُرصَد أثناء تحليل جارٍ بنداء نموذج محجوز) يحمل sessionId وuserId=المالك والحجز؛ وفحص شخصي بلا sessionId لا حقل له.
//   ٦ الفحص داخل معاملة القفل: جلسة تُلغى بين الفحص الأوّل والمعاملة ⇒ يُرفض التحليل «جلسة الفحص غير صالحة» بلا قفل ولا حجز ولا نداء نموذج.
//   ٧ لا حذف: مستند الجلسة موجود بعد كلّ ذلك، والجلسات الجارية الصالحة لا تُمسّ.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/sessionExpiryOnTouch.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد، معدودٌ، وقابلٌ للحجز (gate) كي يبقى تحليلٌ «جارياً» ونرصد قفله.
let modelCalls = 0;
let gate = null;
const newGate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return {promise, release};
};
// القاعدة 9 (صفر طلب شبكة نحو مزوّد نموذج): fetch لا يردّ إلا لعنوان DeepSeek (كعب بلا شبكة)، وأيّ عنوان آخر يُرمى؛ ووحدة Gemini مستبدَلة بكعب يفشل — فلو رُفض
// ردّ DeepSeek المحاكى لوقع الفشل داخل الاختبار لا نداءٌ حقيقي بمفتاح وهمي.
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => { throw new Error("stub gemini fail"); }};
    }
  }},
};
global.fetch = async (url) => {
  if (!/deepseek/i.test(String(url))) throw new Error("unexpected network call blocked by the test: " + String(url).slice(0, 40));
  modelCalls++;
  if (gate) await gate.promise;
  return deepSeekHttpResponse(validV7ModelResponse());
};

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {submitEvaluation} = require("../src/evaluations/submitEvaluation");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
};
const FUTURE = () => new Date(Date.now() + 10 * 60 * 1000);
const PAST = () => new Date(Date.now() - 10 * 60 * 1000);

const callAnalyze = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
const callSubmit = (data, auth) => submitEvaluation.run({data, auth, rawRequest: {headers: {}}});
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const sessionDoc = async (id) => db.collection("scanSessions").doc(id).get();
const credit = async (uid) => (await db.collection("users").doc(uid).get()).data().scansRemaining;
const seedOwner = (uid, scans = 5) => db.collection("users").doc(uid).set({scansRemaining: scans, scansTotal: scans, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000)});
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const exists = async (col, id) => (await db.collection(col).doc(id).get()).exists;
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}
function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
const TIMESTAMP_LIKE = (v) => v && typeof v.toMillis === "function";

(async () => {
  // ═══ ١ — analyzeDevice: scanning منقضية ═══
  {
    await seedOwner("own-1");
    const expiresAt = PAST();
    await seedSession("sess-1", {ownerId: "own-1", status: "scanning", code: "NC-EXP001", expiresAt, joinedBy: "joiner-1"});
    modelCalls = 0;
    const cap = capture();
    let r;
    try {
      r = await settle(callAnalyze({scanId: "scan-1", fingerprint: FINGERPRINT, sessionId: "sess-1"}, {uid: "joiner-1", token: {}}));
    } finally {
      cap.restore();
    }
    ok(!r.ok && r.error.code === "failed-precondition" && r.error.message === "الجلسة منتهية", "[١] analyzeDevice: الرفض failed-precondition «الجلسة منتهية» كما كان (لا تغيير في الرمز ولا النصّ)");
    const s = (await sessionDoc("sess-1")).data();
    eq(s.status, "expired", "[١] وفي مستند الجلسة status=expired (كانت تبقى scanning)");
    ok(TIMESTAMP_LIKE(s.expiredAt) && Math.abs(s.expiredAt.toMillis() - Date.now()) < 60000, "[١] وexpiredAt وقت التسجيل (Timestamp حديث)");
    eq(s.expiresAt.toMillis(), expiresAt.getTime(), "[١] وexpiresAt لم يتغيّر");
    deq([s.ownerId, s.code, s.joinedBy], ["own-1", "NC-EXP001", "joiner-1"], "[١] وownerId وcode وjoinedBy كما كانت");
    ok(!("cancelledAt" in s) && !("cancelReason" in s) && !("completedAt" in s) && !("scanId" in s), "[١] ولا حقل إلغاء ولا اكتمال");
    eq(modelCalls, 0, "[١] لا نداء نموذج");
    ok(!(await exists("scanClaims", "scan-1")) && !(await exists("reports", "scan-1")), "[١] لا قفل ولا تقرير");
    eq(await credit("own-1"), 5, "[١] ولا خصم (5)");
    ok(cap.lines.some((l) => l === `[sessionLifecycle] recorded expired from=analyzeDevice previous=scanning session=${hashIdForLog("sess-1")}`), "[١] سطر السجلّ: المصدر والحالة السابقة والمعرّف مُهشَّراً");
    ok(!cap.lines.join("\n").includes("sess-1"), "[١] ولا sessionId خامّ في أيّ سطر");
    // النداء الثاني: الجلسة صارت expired — يُرفض بالفحص الأوّل ولا يُعاد الكتابة
    const expiredAtBefore = s.expiredAt.toMillis();
    const r2 = await settle(callAnalyze({scanId: "scan-1b", fingerprint: FINGERPRINT, sessionId: "sess-1"}, {uid: "joiner-1", token: {}}));
    ok(!r2.ok && r2.error.code === "permission-denied" && r2.error.message === "جلسة الفحص غير صالحة", "[١] نداء ثانٍ على المنتهية: «جلسة الفحص غير صالحة» (حالتها ليست scanning)");
    eq((await sessionDoc("sess-1")).data().expiredAt.toMillis(), expiredAtBefore, "[١] ولا إعادة كتابة لـexpiredAt");
    eq(modelCalls, 0, "[١] ولا نداء نموذج في الثاني");
  }

  // ═══ ٢ — analyzeDevice: expiresAt غائب أو تالف = رفض بلا كتابة ═══
  for (const [label, fields] of [
    ["غائب", {}],
    ["null", {expiresAt: null}],
    ["نصّ تالف", {expiresAt: "not-a-date"}],
    ["كائن بلا toDate", {expiresAt: {seconds: 1}}],
  ]) {
    const sid = `sess-2-${label.replace(/\s/g, "_")}`;
    await seedOwner(`own-${sid}`);
    await seedSession(sid, {ownerId: `own-${sid}`, status: "scanning", code: "NC-NOEXP", ...fields});
    modelCalls = 0;
    const cap = capture();
    let r;
    try {
      r = await settle(callAnalyze({scanId: `scan-${sid}`, fingerprint: FINGERPRINT, sessionId: sid}, {uid: "anon", token: {}}));
    } finally {
      cap.restore();
    }
    ok(!r.ok && r.error.code === "permission-denied" && r.error.message === "جلسة الفحص غير صالحة", `[٢] expiresAt ${label}: «جلسة الفحص غير صالحة» لا «صالحة»`);
    const s = (await sessionDoc(sid)).data();
    eq(s.status, "scanning", `[٢] expiresAt ${label}: الجلسة تبقى scanning (لا تُكتب «منتهية» لما لا يُعرَف أنه انقضى)`);
    ok(!("expiredAt" in s), `[٢] expiresAt ${label}: ولا expiredAt`);
    eq(modelCalls, 0, `[٢] expiresAt ${label}: لا نداء نموذج`);
    ok(!cap.lines.some((l) => l.includes("recorded expired")), `[٢] expiresAt ${label}: ولا سطر «recorded expired»`);
  }

  // ═══ ٣ — submitEvaluation ═══
  {
    await seedOwner("own-3");
    const expiresAt = PAST();
    await seedSession("sess-3", {ownerId: "own-3", status: "scanning", code: "NC-EXP003", expiresAt});
    const cap = capture();
    let r;
    try {
      r = await settle(callSubmit({sessionId: "sess-3", scanId: "scan-3", technicianGradeRaw: "good"}, {uid: "anon-3", token: {}}));
    } finally {
      cap.restore();
    }
    ok(!r.ok && r.error.code === "failed-precondition" && r.error.message === "الجلسة منتهية", "[٣] submitEvaluation: الرفض failed-precondition «الجلسة منتهية» كما كان");
    const s = (await sessionDoc("sess-3")).data();
    eq(s.status, "expired", "[٣] وكُتبت «منتهية»");
    ok(TIMESTAMP_LIKE(s.expiredAt), "[٣] وexpiredAt");
    eq(s.expiresAt.toMillis(), expiresAt.getTime(), "[٣] وexpiresAt لم يتغيّر");
    ok(cap.lines.some((l) => l === `[sessionLifecycle] recorded expired from=submitEvaluation previous=scanning session=${hashIdForLog("sess-3")}`), "[٣] سطر «recorded expired» بمصدره submitEvaluation");
    ok(cap.lines.some((l) => l === `[submitEvaluation] refused reason=SESSION_EXPIRED`), "[٣] وسطر الرفض المسمّى SESSION_EXPIRED كما كان");
    ok(!(await exists("evaluations", "scan-3")), "[٣] ولا تقييم");

    await seedSession("sess-3b", {ownerId: "own-3", status: "scanning", code: "NC-NOEXP3"});
    const r2 = await settle(callSubmit({sessionId: "sess-3b", scanId: "scan-3b", technicianGradeRaw: "good"}, {uid: "anon-3", token: {}}));
    ok(!r2.ok && r2.error.code === "permission-denied" && r2.error.message === "جلسة الفحص غير صالحة", "[٣] expiresAt غائب: «جلسة الفحص غير صالحة»");
    const s2 = (await sessionDoc("sess-3b")).data();
    ok(s2.status === "scanning" && !("expiredAt" in s2), "[٣] وبلا كتابة (تبقى scanning بلا expiredAt)");
  }

  // ═══ ٤ — pending منقضية لا تمسّها analyzeDevice ═══
  {
    await seedOwner("own-4");
    await seedSession("sess-4", {ownerId: "own-4", status: "pending", code: "NC-PEND04", expiresAt: PAST()});
    const r = await settle(callAnalyze({scanId: "scan-4", fingerprint: FINGERPRINT, sessionId: "sess-4"}, {uid: "anon-4", token: {}}));
    ok(!r.ok && r.error.code === "permission-denied" && r.error.message === "جلسة الفحص غير صالحة", "[٤] pending: «جلسة الفحص غير صالحة» (ليست scanning) كما كان");
    const s = (await sessionDoc("sess-4")).data();
    ok(s.status === "pending" && !("expiredAt" in s), "[٤] ولا كتابة: تبقى pending (جلسة لم يُنضَمّ إليها تُسجَّل منتهية عند مسّ join/cancel لا analyzeDevice)");
  }

  // ═══ ٥ — القفل يحمل sessionId (تحليل جارٍ بنداء نموذج محجوز) ═══
  {
    await seedOwner("own-5", 5);
    await seedOwner("own-5p", 5);
    await seedSession("sess-5", {ownerId: "own-5", status: "scanning", code: "NC-LIVE05", expiresAt: FUTURE(), joinedBy: "joiner-5"});
    gate = newGate();
    modelCalls = 0;
    const pSession = settle(callAnalyze({scanId: "scan-5", fingerprint: FINGERPRINT, sessionId: "sess-5"}, {uid: "joiner-5", token: {}}));
    const pPersonal = settle(callAnalyze({scanId: "scan-5p", fingerprint: FINGERPRINT}, {uid: "own-5p", token: {}}));
    await waitFor(async () => (await exists("scanClaims", "scan-5")) && (await exists("scanClaims", "scan-5p")));
    await waitFor(async () => modelCalls >= 2);
    const claim = (await db.collection("scanClaims").doc("scan-5").get()).data();
    eq(claim.sessionId, "sess-5", "[٥] قفل فحص الجلسة يحمل sessionId");
    eq(claim.userId, "own-5", "[٥] وuserId = المالك (الفوترة على صاحب المحلّ)");
    ok(claim.reservation && claim.reservation.userId === "own-5", "[٥] والحجز على المالك (حُجز قبل نداء النموذج)");
    ok(typeof claim.claimedAtMs === "number" && Math.abs(claim.claimedAtMs - Date.now()) < 60000, "[٥] وclaimedAtMs رقم حديث");
    const claimP = (await db.collection("scanClaims").doc("scan-5p").get()).data();
    ok(!("sessionId" in claimP), "[٥] وقفل الفحص الشخصي بلا حقل sessionId (غائب لا null)");
    eq(claimP.userId, "own-5p", "[٥] وuserId = صاحب الفحص الشخصي");
    eq(await credit("own-5"), 4, "[٥] والرصيد مخصوم أثناء الجريان (5 → 4: الحجز)");
    eq((await sessionDoc("sess-5")).data().status, "scanning", "[٥] والجلسة scanning أثناء التحليل");
    gate.release();
    gate = null;
    const [a, b] = await Promise.all([pSession, pPersonal]);
    ok(a.ok && b.ok, "[٥] والتحليلان ينجحان بعد الإفراج");
    const done = (await sessionDoc("sess-5")).data();
    ok(done.status === "completed" && done.scanId === "scan-5", "[٥] والجلسة completed بـscanId");
    ok(!(await exists("scanClaims", "scan-5")) && !(await exists("scanClaims", "scan-5p")), "[٥] والقفلان يُمحيان بعد الحفظ كما كان");
    eq(await credit("own-5"), 4, "[٥] والرصيد 4 (فحصة واحدة)");
  }

  // ═══ ٦ — فحص الجلسة داخل معاملة القفل: ألغيت بين الفحص الأوّل والمعاملة ═══
  {
    await seedOwner("own-6", 5);
    await seedSession("sess-6", {ownerId: "own-6", status: "scanning", code: "NC-RACE06", expiresAt: FUTURE(), joinedBy: "joiner-6"});
    // حقن سباق: بعد أوّل get() مباشر لمستند الجلسة (الفحص الأوّل) تُكتب «ملغاة» — قبل معاملة القفل. (يُستبدَل get وحده ولمرّة واحدة؛ المعاملة تقرأ بـtx.get فلا تتأثّر.)
    const {DocumentReference} = require("firebase-admin/firestore");
    const origGet = DocumentReference.prototype.get;
    let injected = false;
    DocumentReference.prototype.get = async function patchedGet(...args) {
      const snap = await origGet.apply(this, args);
      if (!injected && this.path === "scanSessions/sess-6") {
        injected = true;
        await this.update({status: "cancelled", cancelledAt: admin.firestore.FieldValue.serverTimestamp(), cancelReason: "cancelled_by_owner"});
      }
      return snap;
    };
    modelCalls = 0;
    let r;
    try {
      r = await settle(callAnalyze({scanId: "scan-6", fingerprint: FINGERPRINT, sessionId: "sess-6"}, {uid: "joiner-6", token: {}}));
    } finally {
      DocumentReference.prototype.get = origGet;
    }
    ok(injected, "[٦] السباق حُقن فعلاً (الإلغاء كُتب بعد الفحص الأوّل)");
    ok(!r.ok && r.error.code === "permission-denied" && r.error.message === "جلسة الفحص غير صالحة", "[٦] التحليل يُرفض «جلسة الفحص غير صالحة» من فحص المعاملة (الفحص الأوّل رآها scanning)");
    ok(!(await exists("scanClaims", "scan-6")), "[٦] ولا قفل كُتب");
    eq(modelCalls, 0, "[٦] ولا نداء نموذج");
    eq(await credit("own-6"), 5, "[٦] ولا حجز ولا خصم (5)");
    eq((await sessionDoc("sess-6")).data().status, "cancelled", "[٦] والجلسة تبقى cancelled (لم يكتب التحليل فوقها)");
  }

  // ═══ ٧ — لا حذف، والصالحة لا تُمسّ ═══
  {
    for (const id of ["sess-1", "sess-3", "sess-4", "sess-5", "sess-6"]) {
      ok((await sessionDoc(id)).exists, `[٧] مستند الجلسة ${id} موجود (لا حذف)`);
    }
    await seedOwner("own-7");
    const exp = FUTURE();
    await seedSession("sess-7", {ownerId: "own-7", status: "scanning", code: "NC-OK0007", expiresAt: exp});
    const r = await settle(callSubmit({sessionId: "sess-7", scanId: "scan-7", technicianGradeRaw: "good"}, {uid: "anon-7", token: {}}));
    const s = (await sessionDoc("sess-7")).data();
    ok(s.status === "scanning" && !("expiredAt" in s), `[٧] جلسة صالحة مسّتها submitEvaluation: تبقى scanning بلا expiredAt (${r.ok ? "قُبل" : r.error.message})`);
  }

  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
