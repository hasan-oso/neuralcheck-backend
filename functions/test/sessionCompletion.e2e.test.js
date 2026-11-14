// E2E test: كتابة «اكتملت» على جلسة الفحص — مساراها (أ فحص جديد، ب ردّ مخزَّن) وشرط الحالة والمحاولات وحارس الملكية (S-SWEEP، 2026-10-15 +03). analyzeDevice الحقيقية عبر `.run()` على
// محاكي Firestore (القاعدة 37). **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل. **وحقن الفشل** (لا يستبدل الطبقة: يمرّر الاستدعاء الحقيقي):
// غلاف على db.runTransaction يرمي من `tx.update` لمعاملة الاكتمال وحدها (الجلسة scanning ⟵ completed) بعدد محاولات معلوم، فتُلغى المعاملة ولا يُكتب شيء. المشهد ١ بلا أيّ حقن.
// الرمز المحقون 7 (PERMISSION_DENIED) لا 14: رمز غير قابل للإعادة داخل Admin SDK؛ وأمّا UNAVAILABLE فيعيده الـSDK نفسه داخل runTransaction (قيس: ثلاث حقنات برمز 14 استهلكها الـSDK في محاولة واحدة فنجحت
// الكتابة من أوّل محاولة لهذه الطبقة) فلا يبلغ طبقة المحاولات هنا إلا بعد أن يستسلم الـSDK.
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-د. قرار المستخدم (E26، 2026-10-15، منقول): «The completed write is retried a bounded number of times. A final failure is logged with a named line,
// never swallowed. The write happens only while the session is still scanning, so it cannot overwrite cancelled or expired. The cached-response path (analyzeDevice.js:431-439) marks the
// session completed the same way before returning. The caller's answer is unchanged».
//
// ما يثبته:
//   ١ المسار أ بلا حقن (لا يستبدل شيئاً منه): الجلسة completed بـscanId وshortId وdeviceModel وcompletedAt، وسطر النجاح بنصّه، والرصيد والقفل كما كانا.
//   ٢ المسار أ: فشل ثلاث مرّات ⟵ سطر الفشل النهائي المسمّى (الرمز واسم الصنف وعدد المحاولات وحدها، بلا نصّ الخطأ ولا معرّف خامّ)، الجلسة تبقى scanning، **والردّ للمستدعي لا يتغيّر**
//      (مطابق لردّ نداء بلا فشل)، والتقرير محفوظ والفحصة مستهلَكة.
//   ٣ المسار أ: فشل ثم نجاح ⟵ completed بمحاولتين وسطرا المحاولة والنجاح.
//   ٤ المسار ب: بعد الفشل النهائي في ٢ يُعيد نداء ثانٍ لـscanId نفسه الردّ المخزَّن ويكتب «اكتملت» (حقولها من التقرير المخزَّن) بلا نداء نموذج ولا خصم؛ والردّ هو المخزَّن بعينه.
//   ٥ المسار ب وملكية التقرير: userId التقرير ≠ ownerId الجلسة ⟵ رفض مسمّى SESSION_REPORT_NOT_AVAILABLE قبل الاكتمال (البند ٢ 2026-10-17: استُبدل ما كان «يردّ ويتخطّى بـE35») وتبقى scanning؛ والغياب (userId التقرير غائب) حالة صريحة؛ والمطابق يكتب؛
//      والحقول الغائبة من التقرير تبقى غائبة (لا «Unknown»)، ويُسمّى غيابها في السطر.
//   ٦ المسار ب: فشل ثلاث مرّات (سطر FAILED بمسار ب) وفشل ثم نجاح؛ والردّ المخزَّن يعود في الحالتين.
//   ٧ السباق «completed تطمس expired»: الكنس (createScanSession الحقيقية) يكتب «منتهية» لجلسة تحليلها جارٍ بقفل قديم ⟵ الاكتمال يتخطّى (status=expired) والحالة تبقى expired؛
//      وبقفل حيّ يتخطّى الكنس (E32) فتُكتب «اكتملت» ولو انقضى expiresAt أثناء التحليل.
//   ٨ السباق «completed تطمس cancelled»: الإلغاء الحقيقي (cancelScanSession) بقفل قديم ثم اكتمال التحليل ⟵ يتخطّى الاكتمال (status=cancelled) وتبقى cancelled.
//   ٩ لا حذف: مستندات الجلسات والتقارير باقية؛ والقفل يُمحى بعد الحفظ كما كان؛ وسطور الاكتمال لا تحمل معرّفاً خامّاً.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/sessionCompletion.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد، معدودٌ، وقابلٌ للحجز (gate) كي يبقى تحليلٌ «جارياً». (القاعدة 9: لا طلب شبكة نحو مزوّد؛ أيّ عنوان آخر يُرمى.)
let modelCalls = 0;
let gate = null;
const newGate = () => {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return {promise, release};
};
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
const {analyzeDevice, stripNarrativeDetailsVerdictFromV7Response} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {cancelScanSession} = require("../src/sessions/cancelScanSession");
const {hashIdForLog} = require("../src/utils/logRedaction");
const {COMPLETION_MAX_ATTEMPTS, COMPLETION_RETRY_DELAYS_MS} = require("../src/sessions/sessionCompletion");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// حقن الفشل: غلاف على db.runTransaction يرمي من tx.update لمعاملة الاكتمال وحدها. كل ما سواه (القفل، الحجز، التقرير، الكنس، الإلغاء) يمرّ إلى المحاكي كما هو.
let completionFailures = 0; // كم معاملة اكتمال قادمة تُفشَل
let injected = 0;
const SECRET = "PERMISSION_DENIED SECRET-DETAIL projects/demo-nc/databases/(default)/documents/scanSessions/sess-fail sk-SECRETKEY-WXYZ";
const realRunTransaction = db.runTransaction.bind(db);
db.runTransaction = (cb, opts) => realRunTransaction(async (tx) => {
  const guarded = new Proxy(tx, {
    get(target, prop) {
      if (prop === "update") {
        return (ref, fields, ...rest) => {
          if (completionFailures > 0 && ref.path.startsWith("scanSessions/") && fields && fields.status === "completed") {
            completionFailures--;
            injected++;
            throw Object.assign(new Error(SECRET), {code: 7});
          }
          return target.update(ref, fields, ...rest);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return cb(guarded);
}, opts);

const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
};
const MIN = 60 * 1000;
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const PAST = (m = 10) => new Date(Date.now() - m * MIN);
const callAnalyze = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const sessionDoc = async (id) => (await db.collection("scanSessions").doc(id).get());
const sdata = async (id) => (await sessionDoc(id)).data();
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
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function analyze(data, auth, fn = callAnalyze) {
  const cap = capture();
  let r;
  try {
    r = await settle(fn(data, auth));
  } finally {
    cap.restore();
  }
  return {...r, lines: cap.lines, texts: cap.texts()};
}
const completionLines = (texts) => texts.filter((t) => t.startsWith("[sessionCompletion] "));
const TS = (v) => v && typeof v.toMillis === "function";
const allLogged = [];
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
const sid = (id) => hashIdForLog(id);

(async () => {
  // ═══ ١ — المسار أ بلا حقن ═══
  let reply1;
  {
    await seedOwner("own-1");
    await seedSession("sess-1", {ownerId: "own-1", status: "scanning", code: "NC-COMP01", expiresAt: FUTURE(), joinedBy: "joiner-1", scanId: null, deviceModel: null});
    modelCalls = 0;
    const r = await analyze({scanId: "scan-1", fingerprint: FINGERPRINT, sessionId: "sess-1"}, {uid: "joiner-1", token: {}});
    allLogged.push(...r.texts);
    ok(r.ok, "[١] التحليل نجح");
    reply1 = r.value;
    const s = await sdata("sess-1");
    eq(s.status, "completed", "[١] الجلسة completed");
    deq([s.scanId, s.deviceModel], ["scan-1", "TestPhone"], "[١] scanId وdeviceModel (من بصمة الطلب: المسار أ)");
    const report = (await db.collection("reports").doc("scan-1").get()).data();
    eq(s.shortId, report.shortId, "[١] shortId = shortId التقرير المحفوظ");
    eq(r.value.shortId, report.shortId, "[١] وهو shortId الردّ للمستدعي");
    ok(TS(s.completedAt) && Math.abs(s.completedAt.toMillis() - Date.now()) < 60000, "[١] completedAt وقت الخادم");
    deq([s.ownerId, s.code, s.joinedBy], ["own-1", "NC-COMP01", "joiner-1"], "[١] بقية الحقول لم تُمسّ");
    const lines = completionLines(r.texts);
    deq(lines, [`[sessionCompletion] completed path=fresh-scan session=${sid("sess-1")} attempts=1`], "[١] سطر النجاح بنصّه: المسار والمعرّف مُهشَّراً وعدد المحاولات (1)");
    note("المسار أ — نجاح من أول محاولة", lines);
    eq(await credit("own-1"), 4, "[١] الرصيد 4 (فحصة واحدة)");
    ok(!(await exists("scanClaims", "scan-1")), "[١] القفل يُمحى بعد الحفظ كما كان");
    eq(injected, 0, "[١] لا حقن في هذا المشهد (لا يستبدل شيئاً منه)");
    ok(!r.texts.join("\n").includes("Failed to update session"), "[١] ولا سطر «Failed to update session» القديم");
  }

  // ═══ ٢ — المسار أ: فشل ثلاث مرّات، والردّ لا يتغيّر ═══
  let reply2;
  {
    await seedOwner("own-2");
    await seedSession("sess-fail", {ownerId: "own-2", status: "scanning", code: "NC-COMP02", expiresAt: FUTURE(), joinedBy: "joiner-2", scanId: null, deviceModel: null});
    completionFailures = COMPLETION_MAX_ATTEMPTS;
    injected = 0;
    const t0 = Date.now();
    const r = await analyze({scanId: "scan-2", fingerprint: FINGERPRINT, sessionId: "sess-fail"}, {uid: "joiner-2", token: {}});
    const took = Date.now() - t0;
    allLogged.push(...r.texts);
    completionFailures = 0;
    ok(r.ok, "[٢] التحليل نجح رغم فشل كتابة الاكتمال (الردّ للمستدعي لا يتغيّر)");
    reply2 = r.value;
    eq(injected, 3, "[٢] فشلت ثلاث معاملات اكتمال بالضبط (لا رابعة)");
    const s = await sdata("sess-fail");
    eq(s.status, "scanning", "[٢] الجلسة تبقى scanning (لم يُكتب اكتمال)");
    ok(!("completedAt" in s) && s.scanId === null, "[٢] ولا completedAt ولا scanId");
    const lines = completionLines(r.texts);
    deq(lines, [
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid("sess-fail")} attempt=1/3 [Error] code=7`,
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid("sess-fail")} attempt=2/3 [Error] code=7`,
      `[sessionCompletion] completed-write FAILED path=fresh-scan session=${sid("sess-fail")} attempts=3 [Error] code=7`,
    ], "[٢] سطرا المحاولتين وسطر الفشل النهائي بنصّها: الصنف والرمز وعدد المحاولات وحدها");
    note("المسار أ — فشل نهائي (3 محاولات)", lines);
    ok(r.lines.find((l) => l.text.includes("completed-write FAILED")).level === "error", "[٢] الفشل النهائي بمستوى error (لا ابتلاع صامت)");
    const blob = r.texts.join("\n");
    ok(!blob.includes("SECRET") && !blob.includes("sk-SECRETKEY") && !blob.includes("sess-fail"), "[٢] ولا نصّ خطأ ولا معرّف جلسة خامّ في السجلّ (القاعدة 36)");
    ok(took >= COMPLETION_RETRY_DELAYS_MS[0] + COMPLETION_RETRY_DELAYS_MS[1], `[٢] الفاصلان (200 ثم 400 مل ث) مرّا فعلاً: ${took} مل ث`);
    ok(await exists("reports", "scan-2"), "[٢] التقرير محفوظ");
    eq(await credit("own-2"), 4, "[٢] والفحصة مستهلَكة (5 ⟵ 4: الحفظ سبق فشل الاكتمال)");
    ok(!(await exists("scanClaims", "scan-2")), "[٢] والقفل يُمحى");
    // الردّ للمستدعي لا يتغيّر: مطابق لردّ المشهد ١ (بلا فشل) عدا ما يخصّ الفحص الواحد
    const strip = (v) => { const {shortId: _s, ...rest} = v; return rest; };
    deq(Object.keys(reply2).sort(), Object.keys(reply1).sort(), "[٢] مفاتيح الردّ مع الفشل = مفاتيحه بلا فشل");
    deq(strip(reply2), strip(reply1), "[٢] والردّ كلّه مطابق لردّ نداء بلا فشل (عدا shortId الخاصّ بكلّ فحص)");
    ok(typeof reply2.shortId === "string" && reply2.shortId !== "", "[٢] وshortId حاضر في الردّ");
  }

  // ═══ ٣ — المسار أ: فشل ثم نجاح ═══
  {
    await seedOwner("own-3");
    await seedSession("sess-3", {ownerId: "own-3", status: "scanning", code: "NC-COMP03", expiresAt: FUTURE(), joinedBy: "joiner-3", scanId: null, deviceModel: null});
    completionFailures = 1;
    injected = 0;
    const r = await analyze({scanId: "scan-3", fingerprint: FINGERPRINT, sessionId: "sess-3"}, {uid: "joiner-3", token: {}});
    allLogged.push(...r.texts);
    completionFailures = 0;
    ok(r.ok, "[٣] التحليل نجح");
    eq(injected, 1, "[٣] فشلت معاملة واحدة");
    const s = await sdata("sess-3");
    deq([s.status, s.scanId, s.deviceModel], ["completed", "scan-3", "TestPhone"], "[٣] الجلسة completed بالمحاولة الثانية");
    const lines = completionLines(r.texts);
    deq(lines, [
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid("sess-3")} attempt=1/3 [Error] code=7`,
      `[sessionCompletion] completed path=fresh-scan session=${sid("sess-3")} attempts=2`,
    ], "[٣] سطر المحاولة الفاشلة ثم النجاح بمحاولتين");
    note("المسار أ — فشل ثم نجاح", lines);
    eq(await credit("own-3"), 4, "[٣] فحصة واحدة");
  }

  // ═══ ٤ — المسار ب: يُعيد الردّ المخزَّن ويكتب «اكتملت» لجلسة بقيت scanning بعد فشل نهائي ═══
  {
    const reportBefore = (await db.collection("reports").doc("scan-2").get()).data();
    const callsBefore = modelCalls;
    const creditBefore = await credit("own-2");
    const r = await analyze({scanId: "scan-2", fingerprint: FINGERPRINT, sessionId: "sess-fail"}, {uid: "joiner-2", token: {}});
    allLogged.push(...r.texts);
    ok(r.ok, "[٤] النداء الثاني نجح");
    deq(r.value, stripNarrativeDetailsVerdictFromV7Response(reportBefore.aiResponse), "[٤] والردّ هو الردّ المخزَّن بعينه (لا يتغيّر في المسار ب)");
    eq(modelCalls, callsBefore, "[٤] بلا نداء نموذج");
    eq(await credit("own-2"), creditBefore, "[٤] وبلا خصم");
    const s = await sdata("sess-fail");
    eq(s.status, "completed", "[٤] الجلسة التي علقت scanning صارت completed");
    deq([s.scanId, s.shortId, s.deviceModel], ["scan-2", reportBefore.shortId, reportBefore.deviceModel], "[٤] وحقولها من مستند التقرير المخزَّن (scanId وshortId وdeviceModel)");
    ok(TS(s.completedAt), "[٤] وcompletedAt");
    const lines = completionLines(r.texts);
    deq(lines, [`[sessionCompletion] completed path=cached-response session=${sid("sess-fail")} attempts=1`], "[٤] سطر المسار ب بنصّه");
    note("المسار ب — نجاح (استرداد جلسة علقت scanning)", lines);
    // نداء ثالث: الجلسة صارت completed. A-SUB الموجة الأولى (قرار المستخدم ١٢، «التقرير المخزَّن أولاً مع reasonCode»): كان يُرفض «جلسة الفحص غير صالحة» قبل بلوغ مسار الردّ المخزَّن؛ الآن
    // الطالب المشروع (المنضمّ نفسه، وscanId الطلب = scanId الجلسة، وuserId في التقرير = ownerId) يُقدَّم له الردّ المخزَّن بعينه — بلا نداء نموذج ولا خصم ولا كتابة اكتمال ثانية (استُبدل ما كان يثبّت الرفض، القاعدة 23).
    const callsBefore3 = modelCalls;
    const creditBefore3 = await credit("own-2");
    const r3 = await analyze({scanId: "scan-2", fingerprint: FINGERPRINT, sessionId: "sess-fail"}, {uid: "joiner-2", token: {}});
    ok(r3.ok, "[٤] نداء ثالث على completed من الجهاز المنضمّ نفسه: يُقدَّم الردّ المخزَّن لا الرفض");
    deq(r3.value, stripNarrativeDetailsVerdictFromV7Response(reportBefore.aiResponse), "[٤] والردّ هو المخزَّن بعينه");
    eq(modelCalls, callsBefore3, "[٤] بلا نداء نموذج");
    eq(await credit("own-2"), creditBefore3, "[٤] وبلا خصم");
    eq(completionLines(r3.texts).length, 0, "[٤] ولا سطر اكتمال له (الجلسة completed من قبل: لا كتابة ثانية)");
    ok(r3.texts.some((t) => t.startsWith("[analyzeDevice] completed-session retry: the stored report is served session=#")), "[٤] وسطر مسمّى بمعرّفين مُهشَّرين");
    // الطالب غير المشروع يُرفض ولا يُسرَّب: غير طرف الجلسة، وطرف يطلب scanId غير scanId جلسته
    const r4 = await analyze({scanId: "scan-2", fingerprint: FINGERPRINT, sessionId: "sess-fail"}, {uid: "stranger-2", token: {}});
    ok(!r4.ok && r4.error.code === "permission-denied" && r4.error.message === "جلسة الفحص غير صالحة" && r4.error.details && r4.error.details.reasonCode === "SESSION_NOT_PARTICIPANT",
        "[٤] نداء ثالث على completed من غير طرف: يُرفض «جلسة الفحص غير صالحة» بالرمز SESSION_NOT_PARTICIPANT ولا يُسرَّب التقرير");
    const r5 = await analyze({scanId: "scan-other", fingerprint: FINGERPRINT, sessionId: "sess-fail"}, {uid: "joiner-2", token: {}});
    ok(!r5.ok && r5.error.code === "permission-denied" && r5.error.message === "جلسة الفحص غير صالحة" && r5.error.details && r5.error.details.reasonCode === "SESSION_COMPLETED",
        "[٤] طرف مشروع يطلب scanId غير scanId جلسته: يُرفض بالرمز SESSION_COMPLETED");
    eq(modelCalls, callsBefore3, "[٤] وما زال بلا نداء نموذج");
  }

  // ═══ ٥ — المسار ب وحارس E35 ═══
  const seedReport = (id, fields) => db.collection("reports").doc(id).set({aiResponse: {grade: "A", marker: id}, pipeline: "seeded_test", createdAt: new Date(), ...fields});
  {
    await seedOwner("own-5");
    // (أ) تقرير غريب: userId ≠ ownerId الجلسة. **استُبدل (القاعدة 23، البند ٢ 2026-10-17)** ما كان يثبّت أنّ النداء «يُعيد الردّ المخزَّن» لتقرير غير مالك الجلسة ويتخطّى الاكتمال بحارس E35:
    // قرار المنسّق (منقول): قبل تقديم أيّ تقرير مخزَّن يجب ownerCheckState === MATCH في كل المسارات — فالرفض المسمّى SESSION_REPORT_NOT_AVAILABLE قبل مسار الاكتمال، والجلسة تبقى scanning.
    // (حارس E35 في sessionCompletion.js يبقى دفاعاً في العمق ويُختبَر وحده بالوحدة: sessionCompletion.test.js [٥]؛ لا يبلغه analyzeDevice بتقرير غير مطابق بعد الآن.)
    await seedSession("sess-5a", {ownerId: "own-5", status: "scanning", code: "NC-COMP5A", expiresAt: FUTURE(), joinedBy: "joiner-5", scanId: null, deviceModel: null});
    await seedReport("scan-5a", {userId: "someone-else", shortId: "RPT5AA", deviceModel: "ForeignPhone"});
    const rA = await analyze({scanId: "scan-5a", fingerprint: FINGERPRINT, sessionId: "sess-5a"}, {uid: "joiner-5", token: {}});
    allLogged.push(...rA.texts);
    ok(!rA.ok && rA.error.code === "permission-denied" && rA.error.message === "جلسة الفحص غير صالحة" && rA.error.details && rA.error.details.reasonCode === "SESSION_REPORT_NOT_AVAILABLE",
        "[٥] التقرير الغريب: يُرفض «جلسة الفحص غير صالحة» بالرمز SESSION_REPORT_NOT_AVAILABLE (لا يُردّ التقرير)");
    ok(!JSON.stringify(rA.error.toJSON ? rA.error.toJSON() : rA.error).includes("scan-5a"), "[٥] ولا شيء من التقرير ولا scanId خامّ في الخطأ");
    const sA = await sdata("sess-5a");
    ok(sA.status === "scanning" && sA.scanId === null && !("completedAt" in sA), "[٥] الجلسة تبقى scanning ولا scanId (لا اكتمال لجلسة بتقرير غيرها)");
    deq(completionLines(rA.texts), [], "[٥] ولا سطر اكتمال (الرفض قبل مسار الاكتمال)");
    const linesA = rA.texts.filter((t) => t.startsWith("[analyzeDevice] stored-report refused"));
    deq(linesA, [`[analyzeDevice] stored-report refused reason=SESSION_REPORT_NOT_AVAILABLE ownerCheck=MISMATCH path=session scanId=${sid("scan-5a")} session=${sid("sess-5a")}`], "[٥] السطر المسمّى بنصّه مع ownerCheck=MISMATCH ومعرّفين مُهشَّرين");
    note("رفض التقرير المخزَّن — مالك مختلف", linesA);

    // (ب) تقرير بلا userId: الغياب حالة صريحة لا تطابق — **استُبدل** كذلك: رفض مسمّى بـownerCheck=REPORT_USER_ABSENT، لا ردّ ولا اكتمال
    await seedSession("sess-5b", {ownerId: "own-5", status: "scanning", code: "NC-COMP5B", expiresAt: FUTURE(), joinedBy: "joiner-5", scanId: null, deviceModel: null});
    await seedReport("scan-5b", {shortId: "RPT5BB", deviceModel: "NoUserPhone"});
    const rB = await analyze({scanId: "scan-5b", fingerprint: FINGERPRINT, sessionId: "sess-5b"}, {uid: "joiner-5", token: {}});
    allLogged.push(...rB.texts);
    ok(!rB.ok && rB.error.details && rB.error.details.reasonCode === "SESSION_REPORT_NOT_AVAILABLE" && (await sdata("sess-5b")).status === "scanning", "[٥] تقرير بلا userId: يُرفض ولا يُكتب اكتمال");
    const linesB = rB.texts.filter((t) => t.startsWith("[analyzeDevice] stored-report refused"));
    deq(linesB, [`[analyzeDevice] stored-report refused reason=SESSION_REPORT_NOT_AVAILABLE ownerCheck=REPORT_USER_ABSENT path=session scanId=${sid("scan-5b")} session=${sid("sess-5b")}`], "[٥] السطر بـownerCheck=REPORT_USER_ABSENT");
    note("رفض التقرير المخزَّن — userId التقرير غائب", linesB);

    // (ج) مطابق: يُكتب بحقول التقرير
    await seedSession("sess-5c", {ownerId: "own-5", status: "scanning", code: "NC-COMP5C", expiresAt: FUTURE(), joinedBy: "joiner-5", scanId: null, deviceModel: null});
    await seedReport("scan-5c", {userId: "own-5", shortId: "RPT5CC", deviceModel: "ReportPhone"});
    const rC = await analyze({scanId: "scan-5c", fingerprint: FINGERPRINT, sessionId: "sess-5c"}, {uid: "joiner-5", token: {}});
    allLogged.push(...rC.texts);
    ok(rC.ok, "[٥] التقرير المطابق: النداء ينجح");
    deq(rC.value, {grade: "A", marker: "scan-5c"}, "[٥] والردّ المخزَّن بعينه");
    const sC = await sdata("sess-5c");
    deq([sC.status, sC.scanId, sC.shortId, sC.deviceModel], ["completed", "scan-5c", "RPT5CC", "ReportPhone"], "[٥] completed بحقول التقرير المخزَّن لا من بصمة الطلب (TestPhone)");
    deq(completionLines(rC.texts), [`[sessionCompletion] completed path=cached-response session=${sid("sess-5c")} attempts=1`], "[٥] سطر النجاح");

    // (د) حقول غائبة من التقرير: تبقى غائبة
    await seedSession("sess-5d", {ownerId: "own-5", status: "scanning", code: "NC-COMP5D", expiresAt: FUTURE(), joinedBy: "joiner-5", scanId: null, deviceModel: null});
    await seedReport("scan-5d", {userId: "own-5"});
    const rD = await analyze({scanId: "scan-5d", fingerprint: FINGERPRINT, sessionId: "sess-5d"}, {uid: "joiner-5", token: {}});
    allLogged.push(...rD.texts);
    ok(rD.ok, "[٥] تقرير بلا shortId وdeviceModel: ينجح");
    const sD = await sdata("sess-5d");
    ok(sD.status === "completed" && sD.scanId === "scan-5d", "[٥] completed بـscanId");
    ok(!("shortId" in sD), "[٥] shortId غائب يبقى غائباً (لا قيمة مختلَقة)");
    eq(sD.deviceModel, null, "[٥] وdeviceModel يبقى ما كان على الجلسة (null من الإنشاء) — لا «Unknown» ولا TestPhone");
    const linesD = completionLines(rD.texts);
    deq(linesD, [`[sessionCompletion] completed path=cached-response session=${sid("sess-5d")} attempts=1 absentFields=shortId,deviceModel`], "[٥] وسطر النجاح يُسمّي الحقلين الغائبين");
    note("المسار ب — حقول غائبة من التقرير", linesD);
  }

  // ═══ ٦ — المسار ب: فشل ثلاث مرّات، وفشل ثم نجاح ═══
  {
    await seedOwner("own-6b");
    await seedSession("sess-6a", {ownerId: "own-6b", status: "scanning", code: "NC-COMP6A", expiresAt: FUTURE(), joinedBy: "joiner-6", scanId: null, deviceModel: null});
    await seedReport("scan-6a", {userId: "own-6b", shortId: "RPT6AA", deviceModel: "SixPhone"});
    completionFailures = 3;
    injected = 0;
    const r = await analyze({scanId: "scan-6a", fingerprint: FINGERPRINT, sessionId: "sess-6a"}, {uid: "joiner-6", token: {}});
    allLogged.push(...r.texts);
    completionFailures = 0;
    ok(r.ok, "[٦] الردّ المخزَّن يعود رغم فشل الكتابة (لا يتغيّر)");
    deq(r.value, {grade: "A", marker: "scan-6a"}, "[٦] المخزَّن بعينه");
    eq(injected, 3, "[٦] ثلاث محاولات");
    eq((await sdata("sess-6a")).status, "scanning", "[٦] الجلسة تبقى scanning");
    const lines = completionLines(r.texts);
    eq(lines[lines.length - 1], `[sessionCompletion] completed-write FAILED path=cached-response session=${sid("sess-6a")} attempts=3 [Error] code=7`, "[٦] سطر الفشل النهائي بمسار cached-response");
    note("المسار ب — فشل نهائي (3 محاولات)", lines);
    ok(!r.texts.join("\n").includes("SECRET"), "[٦] ولا نصّ خطأ في السجلّ");

    completionFailures = 1;
    injected = 0;
    const r2 = await analyze({scanId: "scan-6a", fingerprint: FINGERPRINT, sessionId: "sess-6a"}, {uid: "joiner-6", token: {}});
    allLogged.push(...r2.texts);
    completionFailures = 0;
    ok(r2.ok, "[٦] النداء الثاني ينجح");
    const s2 = await sdata("sess-6a");
    deq([s2.status, s2.scanId, s2.shortId, s2.deviceModel], ["completed", "scan-6a", "RPT6AA", "SixPhone"], "[٦] فشل ثم نجاح: completed بحقول التقرير");
    deq(completionLines(r2.texts), [
      `[sessionCompletion] completed-write attempt failed path=cached-response session=${sid("sess-6a")} attempt=1/3 [Error] code=7`,
      `[sessionCompletion] completed path=cached-response session=${sid("sess-6a")} attempts=2`,
    ], "[٦] سطرا المحاولة الفاشلة ثم النجاح بمسار cached-response");
  }

  // ═══ ٧ — السباق «completed تطمس expired»: الكنس الحقيقي مقابل اكتمال تحليل جارٍ ═══
  {
    await seedOwner("own-7");
    await seedSession("sess-7a", {ownerId: "own-7", status: "scanning", code: "NC-COMP7A", expiresAt: FUTURE(), joinedBy: "joiner-7a", scanId: null, deviceModel: null});
    gate = newGate();
    modelCalls = 0;
    const pA = analyze({scanId: "scan-7a", fingerprint: FINGERPRINT, sessionId: "sess-7a"}, {uid: "joiner-7a", token: {}});
    await waitFor(async () => (await exists("scanClaims", "scan-7a")) && modelCalls >= 1);
    // انقضى expiresAt أثناء التحليل، وصار القفل قديماً (ما بعد TTL): الكنس لا يجد ما يمنعه
    await db.collection("scanSessions").doc("sess-7a").update({expiresAt: PAST()});
    await db.collection("scanClaims").doc("scan-7a").update({claimedAtMs: Date.now() - 6 * MIN});
    const cap = capture();
    let created;
    try {
      created = await createScanSession.run({data: {}, auth: {uid: "own-7", token: {}}, rawRequest: {headers: {}}});
    } finally {
      cap.restore();
    }
    ok(created && created.sessionId, "[٧] createScanSession نجحت");
    const sweptLine = cap.texts().find((t) => t.startsWith("[sweepExpiredSessions] swept "));
    ok(/state=COMPLETED returned=2 candidates=1 written=1 skipped=0 failed=0 /.test(sweptLine), `[٧] الكنس كتب «منتهية» للجلسة (قفلها قديم): ${sweptLine}`);
    eq((await sdata("sess-7a")).status, "expired", "[٧] sess-7a صارت expired والتحليل ما زال جارياً");
    gate.release();
    gate = null;
    const rA = await pA;
    allLogged.push(...rA.texts);
    ok(rA.ok, "[٧] التحليل يكتمل وينجح (الردّ للمستدعي لا يتغيّر)");
    const s = await sdata("sess-7a");
    eq(s.status, "expired", "[٧] «completed» لا تطمس «expired»: الحالة تبقى expired");
    ok(!("completedAt" in s) && s.scanId === null, "[٧] ولا completedAt ولا scanId");
    ok(await exists("reports", "scan-7a"), "[٧] والتقرير محفوظ (التحليل أنجز عمله)");
    const lines = completionLines(rA.texts);
    deq(lines, [`[sessionCompletion] completed-skipped status=expired path=fresh-scan session=${sid("sess-7a")}`], "[٧] السطر بنصّه: completed-skipped status=expired");
    note("السباق — الكنس سبق الاكتمال", lines);

    // قفل حيّ: الكنس يتخطّى (E32) فيُكتب الاكتمال ولو انقضى expiresAt أثناء التحليل
    await seedSession("sess-7b", {ownerId: "own-7", status: "scanning", code: "NC-COMP7B", expiresAt: FUTURE(), joinedBy: "joiner-7b", scanId: null, deviceModel: null});
    gate = newGate();
    modelCalls = 0;
    const pB = analyze({scanId: "scan-7b", fingerprint: FINGERPRINT, sessionId: "sess-7b"}, {uid: "joiner-7b", token: {}});
    await waitFor(async () => (await exists("scanClaims", "scan-7b")) && modelCalls >= 1);
    await db.collection("scanSessions").doc("sess-7b").update({expiresAt: PAST()}); // القفل يبقى حيّاً
    const cap2 = capture();
    try {
      await createScanSession.run({data: {}, auth: {uid: "own-7", token: {}}, rawRequest: {headers: {}}});
    } finally {
      cap2.restore();
    }
    const swept2 = cap2.texts().find((t) => t.startsWith("[sweepExpiredSessions] swept "));
    ok(/state=COMPLETED returned=\d+ candidates=1 written=0 skipped=1 failed=0 /.test(swept2), `[٧] القفل الحيّ: الكنس يتخطّى (skipped=1): ${swept2}`);
    eq((await sdata("sess-7b")).status, "scanning", "[٧] sess-7b تبقى scanning أثناء التحليل");
    gate.release();
    gate = null;
    const rB = await pB;
    allLogged.push(...rB.texts);
    ok(rB.ok, "[٧] التحليل يكتمل");
    const sB = await sdata("sess-7b");
    deq([sB.status, sB.scanId], ["completed", "scan-7b"], "[٧] الاكتمال يُكتب (لم يسبقه كنس): completed ولو انقضى expiresAt أثناء التحليل");
    deq(completionLines(rB.texts), [`[sessionCompletion] completed path=fresh-scan session=${sid("sess-7b")} attempts=1`], "[٧] سطر النجاح");
  }

  // ═══ ٨ — السباق «completed تطمس cancelled»: الإلغاء الحقيقي مقابل اكتمال تحليل جارٍ ═══
  {
    await seedOwner("own-8");
    await seedSession("sess-8", {ownerId: "own-8", status: "scanning", code: "NC-COMP08", expiresAt: FUTURE(), joinedBy: "joiner-8", scanId: null, deviceModel: null});
    gate = newGate();
    modelCalls = 0;
    const pA = analyze({scanId: "scan-8", fingerprint: FINGERPRINT, sessionId: "sess-8"}, {uid: "joiner-8", token: {}});
    await waitFor(async () => (await exists("scanClaims", "scan-8")) && modelCalls >= 1);
    await db.collection("scanClaims").doc("scan-8").update({claimedAtMs: Date.now() - 6 * MIN}); // قفل قديم: الإلغاء لا يُرفض «تحليل يجري»
    const cap = capture();
    let cancelled;
    try {
      cancelled = await settle(cancelScanSession.run({data: {sessionId: "sess-8", reason: "cancelled_by_owner"}, auth: {uid: "own-8", token: {}}, rawRequest: {headers: {}}}));
    } finally {
      cap.restore();
    }
    ok(cancelled.ok && cancelled.value.status === "cancelled", "[٨] الإلغاء الحقيقي نجح (القفل قديم)");
    eq((await sdata("sess-8")).status, "cancelled", "[٨] sess-8 cancelled والتحليل جارٍ");
    gate.release();
    gate = null;
    const rA = await pA;
    allLogged.push(...rA.texts);
    ok(rA.ok, "[٨] التحليل يكتمل وينجح (الردّ للمستدعي لا يتغيّر)");
    const s = await sdata("sess-8");
    eq(s.status, "cancelled", "[٨] «completed» لا تطمس «cancelled»: تبقى cancelled");
    ok(!("completedAt" in s) && s.scanId === null && s.cancelReason === "cancelled_by_owner", "[٨] وcancelReason كما كُتب، ولا اكتمال");
    const lines = completionLines(rA.texts);
    deq(lines, [`[sessionCompletion] completed-skipped status=cancelled path=fresh-scan session=${sid("sess-8")}`], "[٨] السطر بنصّه: completed-skipped status=cancelled");
    note("السباق — الإلغاء سبق الاكتمال", lines);
  }

  // ═══ ٩ — لا حذف، ولا معرّف خامّ في سطور الاكتمال ═══
  {
    for (const id of ["sess-1", "sess-fail", "sess-3", "sess-5a", "sess-5b", "sess-5c", "sess-5d", "sess-6a", "sess-7a", "sess-7b", "sess-8"]) ok((await sessionDoc(id)).exists, `[٩] مستند الجلسة ${id} موجود (لا حذف)`);
    for (const id of ["scan-1", "scan-2", "scan-3", "scan-5a", "scan-5b", "scan-5c", "scan-5d", "scan-6a", "scan-7a", "scan-7b", "scan-8"]) ok(await exists("reports", id), `[٩] التقرير ${id} موجود`);
    const completion = allLogged.filter((t) => t.startsWith("[sessionCompletion]"));
    ok(completion.length >= 15, `[٩] ${completion.length} سطر اكتمال مفحوص`);
    const blob = completion.join("\n");
    for (const id of ["sess-1", "sess-fail", "sess-3", "sess-5a", "sess-5b", "sess-5c", "sess-5d", "sess-6a", "sess-7a", "sess-7b", "sess-8", "own-1", "own-2", "own-5", "joiner-1", "joiner-2"]) {
      ok(!blob.includes(id), `[٩] «${id}» لا يظهر خامّاً في سطور الاكتمال`);
    }
    ok(!/SECRET|sk-/.test(blob), "[٩] ولا نصّ خطأ");
  }

  console.log("\nCompletion lines observed (this run):");
  console.log(OBSERVED.join("\n"));
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
