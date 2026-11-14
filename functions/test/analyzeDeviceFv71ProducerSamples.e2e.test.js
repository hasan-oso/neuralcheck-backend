// E2E test: حمولات المُنتِج الثلاث لـfv71 (M-02 وM-09/M-10 وP6-13) عبر analyzeDevice الحقيقية — مزامنة 2026-10-18 +03، القاعدة 37 (والقواعد 20 و22 و41).
//
// **من المُنتِج لا من العقد:** الحمولات نسخ حرفية من NeuralChek@3810146 (كانت f9e0571 عند كتابة هذا الاختبار 2026-10-18، ثم 4c0102c؛ تحديث الوصف 2026-10-22، تعليق وحده) (fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-{11ch-nothing-admitted,13ch-selinux-blocked-policy,16ch-four-policies-truncated-failures}.json؛
// صنعها اختبار التطبيق الذهبي من سلسلته الحقيقية؛ sha256 في fv68AppPayloadGoldenCopy.test.js). حلّ هذا الاختبار محلّ ثلاثة اختبارات e2e كانت على عيّنات بنيتُها من العقد (M-02 وأزرار الصوت وتوحيد الظروف — حُذفت: القاعدة 23).
//
// القاعدة 37: لا يُستبدَل إلا global.fetch (الشبكة نحو المزوّد: كعب محلّي، صفر طلب خارجي). والباقي — analyzeDevice.run، الحجز، runAnalysisInternal، قارئ fv68 وتحليل touchPath، الحارس، reportRaw،
// الخصم — الشيفرة الحقيقية على محاكي Firestore.
//
// ما يُثبَت لكل عيّنة:
//   ١) تقرير يصدر (V7)، وreportRaw يحمل خامّ M-02 وM-09/M-10 وحقول P6-13 **قيمةً قيمةً بعد التخزين الفعلي في Firestore** (والمنطقيّان الغائبان في read_failed يبقيان غائبين: لا false مختلَق)، وسطر [fv68] بالختم 71 وانتهاؤه anomalies=[].
//   ٢) **الخامّ لا يغادر الخادم** (القاعدة 20): لا مفتاح من M-02 ولا ف-04 ولا ف-05 في ردّ التطبيق ولا مستند التقرير المقروء ولا حمولة النموذج.
//   ٣) حالات الفنّي (pass · fail · not_tested) تصل النموذج كما كانت: لا حكم من الخامّ الجديد.
//   ٤) **السقف** (E18): عيّنة 16ch نفسها (15,000 نقطة = pathCap.maxPoints) تمرّ وتُحفظ كاملة؛ ونسخة **مشتقّة منها** (خطّها خمس مرّات: 75,000 نقطة) يرفضها الحارس بـresource-exhausted قبل أيّ كتابة — ويُثبَت أثر الرفض على الرصيد والقفل.
//      **(2026-10-22، أمر الباك اند ٧: كانت أربع مرّات = 60,000 نقطة؛ على عيّنة 16ch الجديدة (NeuralChek@3810146) إحداثيات الخطّ أقصر نصّاً فالأربع تعطي مستنداً 839,656 بايتاً تحت الحارس 900,000 (مقيس بدالّتي reportRawStore نفسيهما في السويت الأساسية: fv71ProducerSamples.test.js)، فلا ترفضها analyzeDevice. عُدِّل هنا بالقياس نفسه ولم يُشغَّل هذا الاختبار — e2e تحت المحاكي وحده.)**
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/analyzeDeviceFv71ProducerSamples.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده (عنوانه محلّي)؛ global.fetch نفسه يُستبدَل بكعب المزوّد

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

// Gemini: لا يُستدعى — كعب يرمي فيفشل أيّ مرور عليه بصوت عالٍ لا بشبكة.
const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => {
        throw new Error("stub gemini: must not be called");
      }};
    }
  }},
};

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {lightenFingerprintForStorage} = require("../src/analysis/lightenFingerprintForStorage");
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");
const {REPORT_RAW_FIELDS} = require("../src/analysis/reportRawStore");
const {readFv68, summarizeForLog} = require("../src/analysis/fv68Reader");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, "fixtures", "golden");
const FILES = {
  "11ch": "fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json",
  "13ch": "fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json",
  "16ch": "fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json",
};
const load = (k) => JSON.parse(fs.readFileSync(path.join(GOLDEN, FILES[k]), "utf8"));

const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
const viaJson = (v) => JSON.parse(JSON.stringify(v));

async function reset() {
  const project = process.env.GCLOUD_PROJECT || "demo-nc";
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, {method: "DELETE"});
  assert.ok(res.ok, "تعذّر تفريغ المحاكي");
}
const getDoc = async (col, id) => (await db.collection(col).doc(id).get());
const call = (data, auth) => analyzeDevice.run({data, auth, rawRequest: {headers: {}}});

// كعب المزوّد (الشبكة وحدها): يسجّل النداء ويلتقط الحمولة التي أرسلها الخادم للنموذج، ويقرأ رصيد المستخدم لحظة النداء.
function installProvider({watchUid}) {
  const state = {calls: 0, balanceAtCall: [], payloads: [], rawUserMessages: []};
  global.fetch = async (url, opts) => {
    state.calls++;
    if (watchUid) state.balanceAtCall.push((await getDoc("users", watchUid)).data().scansRemaining);
    const body = JSON.parse(opts.body);
    const userMessage = body.messages.find((m) => m.role === "user").content;
    state.rawUserMessages.push(userMessage);
    const payload = JSON.parse(userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ""));
    state.payloads.push(payload);
    const ids = ((payload.categoryStates && payload.categoryStates.issues) || []).map((i) => i.id);
    const content = {
      narrative: {
        summary: "ملخّص اختبار سليم الشكل", details: "تفاصيل اختبار سليمة الشكل", verdict: "حكم اختبار سليم الشكل",
        buyerAdvice: {casual: "نصيحة اختبار للمشتري العادي", gamer: "نصيحة اختبار للاعب", photographer: "نصيحة اختبار للمصوّر"},
        issueDescriptions: Object.fromEntries(ids.map((id) => [id, "وصف اختبار للعطب"])),
      },
      crossChecks: [], adjustments: [], modelObservations: [],
    };
    const envelope = {choices: [{message: {content: JSON.stringify(content)}, finish_reason: "stop"}],
      usage: {prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 20}};
    return {ok: true, status: 200, json: async () => envelope, text: async () => ""};
  };
  return state;
}

async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  const origErr = console.error;
  console.log = (...args) => { lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  console.error = (...args) => { lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  try {
    const result = await fn();
    return {result, lines, error: null};
  } catch (e) {
    return {result: null, lines, error: e};
  } finally {
    console.log = orig;
    console.error = origErr;
  }
}

const rowOf = (fp, id) => fp.manualResults.find((m) => m.testId === id);
// مفاتيح الخامّ الجديدة (M-02 وف-04 وف-05) ونصّ فشل التثبيت في 16ch: لا يصل أيٌّ منها النموذج ولا ردّ التطبيق ولا مستند التقرير المقروء
const LEAK_PROBES = ["strokes", "pathCap", "surfaceWidthPx", "readerVersion", "touchMajorPx", "untouchedCells", "displayedSuspects", "expectedKeyCode", "eventsTotal", "detectionSource", "volumeStreamMax", "volumeLevelAtOpen",
  "timeToFirstExpectedDownMs", "expectedDownCount", "brightnessLock", "batteryWindowPct", "powerSaveState", "apply_failed", "the window refused the brightness attribute", "minPct", "maxPct",
  // «إطار + X» (2026-10-21): مفتاحا المجموعة المطلوبة جديدان في fv71 وقائمة فهارس لا يُبنى عليها حرف — لا يصلان النموذج ولا ردّ التطبيق ولا مستند التقرير المقروء
  "gridPattern", "notRequiredCells", "FRAME_AND_DIAGONALS"];
// حالة الفنّي كما تصل النموذج (القاعدة 20: لا حكم من الخامّ الجديد)
const modelOf = (t) => (t.notMeasuredReason ? `NOT_MEASURED:${t.notMeasuredReason}` : t.outcome);
const EXPECT_MODEL = {pass: "PASS", fail: "FAIL", not_tested: "NOT_MEASURED:OPERATOR_SKIPPED"};

(async () => {
  const UID = "u-fv71-producer";
  const seedUser = async () => db.collection("users").doc(UID).set({scansRemaining: 5, scansTotal: 5, plan: "single", isActive: true, expiresAt: future()});

  // ١+٢+٣) العيّنات الثلاث: التقرير يصدر، والخامّ يصل reportRaw كما أُرسل، ولا يسرّب
  for (const k of Object.keys(FILES)) {
    const label = `[${k}]`;
    const fingerprint = load(k);
    const scanId = fingerprint.timeSeries.header.scanId;
    await reset();
    await seedUser();
    const provider = installProvider({watchUid: UID});
    const cap = await captureLogs(() => call({scanId, fingerprint: viaJson(fingerprint), language: "ar", usePrecomputed: true}, {uid: UID, token: tokenOf("password")}));
    ok(cap.error === null, `${label}: analyzeDevice لم ترفض الحمولة: ${cap.error && cap.error.message}`);
    const ret = cap.result;
    const rep = await getDoc("reports", scanId);
    ok(rep.exists, `${label}: reports/{scanId} موجود (التقرير صدر)`);
    const r = rep.data();
    eq(r.pipeline, V7_PIPELINE_TAG, `${label}: pipeline=V7`);
    eq(r.fieldsVersion, 71, `${label}: fieldsVersion=71 مرآة في المستند (من footer الحمولة)`);
    ok(REPORT_RAW_FIELDS.every((f) => !(f in r)), `${label}: المفاتيح الخمسة غائبة من التقرير المقروء`);
    const rawSnap = await getDoc("reportRaw", scanId);
    ok(rawSnap.exists, `${label}: reportRaw/{scanId} موجود`);
    const raw = rawSnap.data();
    eq(stable(raw.rawFingerprint), stable(viaJson(lightenFingerprintForStorage(fingerprint))), `${label}: rawFingerprint المخزَّن = lighten(الحمولة) مفتاحاً مفتاحاً بعد التخزين الفعلي في Firestore`);
    for (const id of ["M-02", "M-09", "M-10"]) {
      eq(stable(rowOf(raw.rawFingerprint, id).measurements), stable(viaJson(rowOf(fingerprint, id).measurements)), `${label}: خامّ ${id} المخزَّن = المُرسَل قيمةً قيمةً`);
      eq(rowOf(raw.rawFingerprint, id).status, rowOf(fingerprint, id).status, `${label}: وحالة ${id} المخزَّنة كما أُرسلت`);
    }
    eq(rowOf(raw.rawFingerprint, "M-02").measurements.strokes.reduce((a, st) => a + st.x.length, 0), rowOf(fingerprint, "M-02").measurements.strokes.reduce((a, st) => a + st.x.length, 0), `${label}: عدد نقاط M-02 المخزَّن = المُرسَل`);
    const sentTs = fingerprint.timeSeries;
    const storedTs = raw.rawFingerprint.timeSeries;
    eq(stable(storedTs.footer.brightnessLock), stable(viaJson(sentTs.footer.brightnessLock)), `${label}: brightnessLock المخزَّن = المُرسَل قيمةً قيمةً`);
    eq(stable(storedTs.footer.batteryWindowPct), stable(viaJson(sentTs.footer.batteryWindowPct)), `${label}: batteryWindowPct المخزَّن = المُرسَل`);
    eq(storedTs.header.powerSaveState, sentTs.header.powerSaveState, `${label}: powerSaveState (ترويسة الملفّ) المخزَّن = المُرسَل`);
    eq(raw.rawFingerprint.powerSaveState, fingerprint.powerSaveState, `${label}: powerSaveState (جذر البصمة) المخزَّن = المُرسَل`);
    eq(stable(["isPowerSaveMode" in storedTs.header, "powerSaveMode" in raw.rawFingerprint]), stable(["isPowerSaveMode" in sentTs.header, "powerSaveMode" in fingerprint]), `${label}: المنطقيّان حضوراً وغياباً كما أُرسلا (لا false مختلَق عند read_failed)`);
    // سطر [fv68]
    const fv68Lines = cap.lines.filter((l) => l.startsWith("[fv68]"));
    eq(fv68Lines.length, 1, `${label}: سطر [fv68] واحد`);
    eq(fv68Lines[0], summarizeForLog(readFv68(fingerprint)), `${label}: والسطر = ما يقوله القارئ عن هذه الحمولة`);
    ok(fv68Lines[0].includes("fieldsVersion=71 ") && fv68Lines[0].includes("applicable=true"), `${label}: السطر: الختم 71 مُنطبِق — ${fv68Lines[0].slice(0, 110)}`);
    ok(fv68Lines[0].endsWith("anomalies=[]"), `${label}: ولا شذوذ — ${fv68Lines[0].slice(-60)}`);
    // الخصم والقفل
    ok(!(await getDoc("scanClaims", scanId)).exists, `${label}: قفل scanClaims محوّ`);
    eq((await getDoc("users", UID)).data().scansRemaining, 4, `${label}: الرصيد 5 ← 4`);
    eq(provider.calls, 1, `${label}: نداء واحد للمزوّد`);
    // المعنى عند النموذج: حالات الفنّي اليدوية تصل كما كانت (لا حكم من الخامّ الجديد)
    const mt = (id) => provider.payloads[0].testResults.find((t) => t.testId === id);
    for (const id of ["M-02", "M-09", "M-10"]) {
      const status = rowOf(fingerprint, id).status;
      eq(modelOf(mt(id)), EXPECT_MODEL[status], `${label}: حمولة النموذج: ${id} ${status} ⟵ ${EXPECT_MODEL[status]} (حالة الفنّي لا الخامّ)`);
    }
    // الخامّ لا يغادر الخادم (القاعدة 20): يُجمَع التسرّب لكل سطح ثم يُحكم (لا يتوقّف عند أوّل مسبار)
    const surfaces = {model: provider.rawUserMessages[0], appReply: JSON.stringify(ret), readableReport: JSON.stringify(r)};
    const leaks = [];
    for (const [surface, text] of Object.entries(surfaces)) for (const probe of LEAK_PROBES) if (text.includes(probe)) leaks.push(`${surface}:${probe}`);
    eq(JSON.stringify(leaks), "[]", `${label}: خامّ M-02 وأزرار الصوت وحقول P6-13 لا تصل النموذج ولا ردّ التطبيق ولا مستند التقرير المقروء (القاعدة 20)`);
    console.log(`تحقّق ${k}: ${fv68Lines[0].slice(0, 150)}`);
  }

  // ٤) السقف: 16ch (15,000 نقطة) مرّت كاملة أعلاه؛ ونسخة مشتقّة بخمسة أضعاف يرفضها الحارس قبل أيّ كتابة (كانت أربعة حتى 2026-10-22: انظر الرأس)
  {
    const fingerprint = load("16ch");
    const stored15 = rowOf(fingerprint, "M-02").measurements;
    eq(stored15.strokes[0].x.length, 15000, "[16ch]: الحمولة تحمل 15,000 نقطة (pathCap.maxPoints) كما شحنها المُنتِج");
    const big = viaJson(fingerprint);
    const m = rowOf(big, "M-02").measurements;
    m.strokes = [0, 1, 2, 3, 4].map(() => viaJson(stored15.strokes[0]));
    const scanId = big.timeSeries.header.scanId;
    await reset();
    await seedUser();
    const provider = installProvider({watchUid: UID});
    const cap = await captureLogs(() => call({scanId, fingerprint: viaJson(big), language: "ar", usePrecomputed: true}, {uid: UID, token: tokenOf("password")}));
    ok(cap.error !== null, "[75000]: analyzeDevice ترفض الحمولة");
    eq(cap.error.code, "resource-exhausted", `[75000]: الرمز resource-exhausted (HttpsError) — ${cap.error && cap.error.message}`);
    ok(cap.lines.some((l) => l.includes("REPORT_RAW_TOO_LARGE") || l.includes("reportRaw:")), "[75000]: وسطر الخادم يسمّي الحجم والعتبة");
    ok(!(await getDoc("reports", scanId)).exists, "[75000]: لا مستند تقرير (الفحص قبل الكتابة الذرّية)");
    ok(!(await getDoc("reportRaw", scanId)).exists, "[75000]: ولا reportRaw");
    ok(!(await getDoc("scanClaims", scanId)).exists, "[75000]: وقفل scanClaims محوّ");
    const balance = (await getDoc("users", UID)).data().scansRemaining;
    console.log(`  [أثر الرفض] الرصيد بعد الرفض = ${balance}، ونداءات المزوّد = ${provider.calls} (الحمولة ${Buffer.byteLength(JSON.stringify(m))} بايتاً لـM-02)`);
    eq(balance, 5, "[75000]: الرصيد بعد الرفض 5 — الحجز أُفرِج عنه (فحصة لا تُخصَم لفحص لم يُحفَظ)");
    eq(provider.calls, 1, "[75000]: نداء المزوّد وقع قبل الرفض (الحارس بعد التحليل لا قبله) — هذا ما يجعل سقف التطبيق لازماً");
  }

  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error("FAIL:", e && e.stack || e);
  process.exit(1);
});
