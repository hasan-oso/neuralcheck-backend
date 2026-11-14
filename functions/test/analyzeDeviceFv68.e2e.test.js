// E2E test: قرّاء fv68 في الخادم عبر analyzeDevice الحقيقية — V8 الدفعة ٤ (PLAN-05)، أمر المنسّق 2026-10-09 +03، البند ٣ (القاعدة 37).
// **مُحدَّث 2026-10-10 +03 إلى حمولات fv69 (الدفعة ١٠، NeuralChek@a04b4f0)**: fv68 لم يُشحن في أيّ APK فلا منتِج لشكله في الميدان، وحلّت عيّنات fv69 محلّ عيّنات fv68.
//
// القاعدة 37: «الاختبار الذي يستبدل الطبقة التي قد ترفض لا يفحصها. وكل مسار يمرّ به الإنتاج يحتاج اختباراً واحداً على الأقلّ لا يستبدل شيئاً منه.»
// هنا لا يُستبدَل إلا global.fetch (الشبكة نحو المزوّد: كعب محلّي، صفر طلب خارجي). والباقي — analyzeDevice.run، الحجز، runAnalysisInternal، findings،
// قارئ fv68، الحارس، resolveV7Report، buildReportDocument، reportRaw، الخصم — الشيفرة الحقيقية على محاكي Firestore.
//
// الحمولات (كلّها مُلتزَمة، مشتقّة لا مسجَّلة من جهاز fv69 — القاعدة 41، قيد مُعلَن: مرحلة ٢ بعد صدور APK fv69):
//   ١) fv69 · 11ch-nothing-admitted — لا charge_counter_raw ولا سياسات؛ cpuTempFinalSource = absent:<سبب>؛ manualResultsHeader.hiddenByModel = []؛ M-02 مكتمل تلقائياً (auto_complete).
//   ٢) fv69 · 13ch-selinux-blocked-policy — charge_counter_raw (4 قراءات فاشلة: [100,101,102,900]) وسياسة واحدة؛ سياسة 4 محجوبة EACCES؛ hiddenByModel = ["M-14","M-15"]؛ M-02 بإعلان الفنّي «لا يعمل».
//   ٣) fv69 · 16ch-four-policies-truncated-failures — أربع سياسات؛ قائمة فشل مبتورة (230 فاشلة والمسمّاة 200)، وجلسة QR (الزبون المجهول)؛ M-02 «لم أختبر» بلا لمسة (لا elapsedMs ولا timeToFirstTouchMs).
//   (والثلاث تحمل الحالات الخمس لليدوي: pass وfail وnot_tested وunavailable وwarning، وخامّ SN-04 بقائمتيه.)
//   ٤) fv67 · طلب 1.0.10 — analyzeDevice1010Compat.e2e.test.js يبقى أخضر على حاله؛ وهنا نفس الطلب يمرّ بالقارئ الجديد: «غير مُفعَّل» لا «لا فشل».
//
// ما يُثبَت لكل حمولة:
//   - تقرير يصدر (pipeline V7) بـfieldsVersion/appVersion من الحمولة؛ ومستند reportRaw يحمل بصمتها المخفَّفة بلا مساس بمفتاح (القاعدة 25).
//   - الفحصة تُحجز قبل نداء المزوّد وتُخصم مرّة واحدة؛ وقفل scanClaims يُمحى.
//   - سطر [fv68] يصل سجلّ الخادم بالأرقام التي تخصّ هذه الحمولة (applicable، عدد الأعمدة، فهارس الفشل، الوحدة).
//   - ما يصل النموذج: findings.notMeasuredFields يحوي cpuTempFinalC (سبب NO_CPU_TEMP_SENSOR) في 11ch وحدها (عقد ت-10 :517-526).
//   - ما لا يغادر الخادم: قراءات fv68 (readerVersion) لا تظهر في حمولة النموذج ولا في الردّ للتطبيق ولا في مستند التقرير ولا في reportRaw.
//   - fv69 «غير قديم» (ق٨ في جرد الدفعة ١٠): سطر [fv68] يحمل fieldsVersion=69 applicable=true بلا أيّ شذوذ (anomalies=[])، والتقرير يصدر بالمسار نفسه.
//   - **الحقول الجديدة تصل reportRaw/{scanId} كما أُرسلت** (قرار المستخدم 2026-10-10: «تُحفظ في reportRaw كاملة»): manualResultsHeader.hiddenByModel،
//     وخامّ M-02 بمفاتيحه كلّها (ومنها timeToFirstTouchMs)، وخامّ SN-04 بقائمتيه وwindowMs وcoverPromptAtMs، وحالات اليدوي الخمس. وطلب fv67 لا يكسب شيئاً منها (الغياب يبقى غياباً).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/analyzeDeviceFv68.e2e.test.js"

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
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {REPORT_RAW_FIELDS} = require("../src/analysis/reportRawStore");
const {lightenFingerprintForStorage} = require("../src/analysis/lightenFingerprintForStorage");
const {V7_PIPELINE_TAG} = require("../src/analysis/pipelineTags");
const N = require("../src/analysis/fv68Names");
const {readFv68, summarizeForLog} = require("../src/analysis/fv68Reader");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const GOLDEN = path.join(__dirname, "fixtures", "golden");
const APP_STEM = "fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-";
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), "utf8"));
const FV67_REQUEST = "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json";

// عقد §٧-ح (ب) :1463-1473 — مفاتيح خامّ M-02: الثمانية (مع لمسة)، أو الستّة بلا elapsedMs وtimeToFirstTouchMs (لا لمسة: «غائب إن لم تقع لمسة»)
const M02_KEYS_WITH_TOUCH = ["elapsedMs", "endReason", "gridCols", "gridRows", "maxSimultaneousPointers", "timeToFirstTouchMs", "totalCells", "touchedCells"];
const M02_KEYS_NO_TOUCH = ["endReason", "gridCols", "gridRows", "maxSimultaneousPointers", "totalCells", "touchedCells"];
// عقد §٧-ح (ج) :1485-1490 — مفاتيح خامّ SN-04 الأربعة
const SN04_KEYS = ["coverPromptAtMs", "readingsBeforeCover", "readingsDuringCover", "windowMs"];

// كل حالة: fingerprintOf() نسخة جديدة في كل نداء (لا مشاركة كائن بين السيناريوهات)
const CASES = [
  // fv69: ما يخصّ الدفعة ١٠ مكتوب هنا بالقيمة (من العقد §٧-ح ومن العيّنة)، لا مشتقّاً من الملفّ وحده — فلو فقدت عيّنةٌ حقلاً لسقط الاختبار بدل أن يمرّ على غيابه.
  //   hiddenByModel: قائمة الرأس · m02Keys: مفاتيح خامّ M-02 (الستّة بلا الزمنين حين لا لمسة) · sn04: طولا قائمتَي SN-04 (قبل التغطية، أثناءها)
  {key: "11ch", file: `${APP_STEM}11ch-nothing-admitted.json`, fingerprintOf: (j) => j, fv: 69, app: "1.0.11", columns: 11, applicable: true, cpuTempFinalInList: true,
    hiddenByModel: [], m02Status: "pass", m02Keys: M02_KEYS_WITH_TOUCH, sn04: [2, 3]},
  {key: "13ch", file: `${APP_STEM}13ch-selinux-blocked-policy.json`, fingerprintOf: (j) => j, fv: 69, app: "1.0.11", columns: 13, applicable: true, cpuTempFinalInList: false,
    hiddenByModel: ["M-14", "M-15"], m02Status: "fail", m02Keys: M02_KEYS_WITH_TOUCH, sn04: [2, 2]},
  {key: "16ch", file: `${APP_STEM}16ch-four-policies-truncated-failures.json`, fingerprintOf: (j) => j, fv: 69, app: "1.0.11", columns: 16, applicable: true, cpuTempFinalInList: false, qr: true,
    hiddenByModel: [], m02Status: "not_tested", m02Keys: M02_KEYS_NO_TOUCH, sn04: [1, 1]},
  {key: "fv67", file: FV67_REQUEST, fingerprintOf: (j) => j.fingerprint, fv: 67, app: "1.0.8-v6beta", columns: 11, applicable: false, cpuTempFinalInList: false},
];

const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});

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

// يلتقط سطور console.log أثناء نداء واحد (سطر [fv68] من runAnalysisInternal) ثم يعيدها
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  try {
    const result = await fn();
    return {result, lines};
  } finally {
    console.log = orig;
  }
}

const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};
// Firestore يسقط undefined ولا يحتفظ بمفتاح قيمته undefined؛ والمقارنة بعد جولة JSON كما يخزَّن فعلاً
const viaJson = (v) => JSON.parse(JSON.stringify(v));

async function assertOutcome({c, label, fingerprint, scanId, expectedUserId, expectedSessionId, ret, provider, logLines}) {
  const rep = await getDoc("reports", scanId);
  ok(rep.exists, `${label}: reports/{scanId} موجود (التقرير صدر)`);
  const r = rep.data();
  eq(r.pipeline, V7_PIPELINE_TAG, `${label}: pipeline=V7`);
  eq(r.userId, expectedUserId, `${label}: التقرير منسوب إلى صاحب الرصيد`);
  ok(REPORT_RAW_FIELDS.every((f) => !(f in r)), `${label}: المفاتيح الخمسة غائبة من التقرير المقروء`);
  eq(r.fieldsVersion, c.fv, `${label}: fieldsVersion=${c.fv} مرآة في المستند (من footer الحمولة)`);
  eq(r.appVersion, c.app, `${label}: appVersion=${c.app} من header الحمولة`);

  // reportRaw: البصمة المخفَّفة بلا مساس بمفتاح (القاعدة 25) — كل مفتاح fv68 الجديد يصل كما أرسله التطبيق
  const rawSnap = await getDoc("reportRaw", scanId);
  ok(rawSnap.exists, `${label}: reportRaw/{scanId} موجود`);
  const raw = rawSnap.data();
  eq(raw.sessionId, expectedSessionId, `${label}: sessionId في reportRaw`);
  const expectedRaw = viaJson(lightenFingerprintForStorage(fingerprint));
  eq(stable(raw.rawFingerprint), stable(expectedRaw), `${label}: rawFingerprint المخزَّن = lighten(الحمولة) مفتاحاً مفتاحاً بعد التخزين الفعلي في Firestore`);
  const footer = raw.rawFingerprint.timeSeries.footer;
  eq(footer.fieldsVersion, c.fv, `${label}: footer.fieldsVersion حرفياً`);
  if (c.applicable) {
    ok(N.FOOTER.CHANNEL_READ_FAILURES in footer && N.FOOTER.CPU_TEMP_FINAL_SOURCE in footer,
        `${label}: مفاتيح fv68 (channelReadFailures وcpuTempFinalSource) في reportRaw`);
    // cpuTempFinalC: حاضرة حين لها قيمة، وغائبة حين يعلن المصدر absent:<سبب> (عقد ت-10) — لا تُخترع قيمة عند التخزين
    eq(N.FOOTER.CPU_TEMP_FINAL_C in footer, !c.cpuTempFinalInList, `${label}: cpuTempFinalC ${c.cpuTempFinalInList ? "غائبة (المصدر absent:…)" : "حاضرة"} في reportRaw كما أرسلها التطبيق`);
    ok(!(N.FOOTER.MAX_CPU_TEMP_LEGACY in footer), `${label}: maxCpuTemp غائب كما أرسله التطبيق (لم يُعاد اختراعه عند التخزين)`);
    eq(raw.rawFingerprint.timeSeries.variables.length, c.columns, `${label}: variables[] المخزَّنة بطولها المتغيّر (${c.columns})`);
    ok(raw.rawFingerprint.timeSeries.variables.every((v) => !("index" in v)), `${label}: variables[] بلا index كما أرسلها التطبيق`);
  }

  // fv69 (الدفعة ١٠) — الحقول الجديدة تصل reportRaw كما أُرسلت (قرار المستخدم 2026-10-10: «تُحفظ في reportRaw كاملة»). حالة fv67: الغياب يبقى غياباً.
  {
    const fpStored = raw.rawFingerprint;
    if (c.fv >= 69) {
      ok("manualResultsHeader" in fpStored, `${label}: manualResultsHeader في reportRaw (جذر شقيق manualResults)`);
      deepEq(fpStored.manualResultsHeader, {hiddenByModel: c.hiddenByModel}, `${label}: manualResultsHeader.hiddenByModel = ${JSON.stringify(c.hiddenByModel)} كما أُرسلت`);
      eq(stable(fpStored.manualResultsHeader), stable(viaJson(fingerprint.manualResultsHeader)), `${label}: والرأس المخزَّن = المُرسَل مفتاحاً مفتاحاً`);
      const m02 = fpStored.manualResults.find((m) => m.testId === "M-02");
      ok(m02 !== undefined && typeof m02.measurements === "object" && m02.measurements !== null, `${label}: M-02 ومعه measurements في reportRaw`);
      deepEq(Object.keys(m02.measurements).sort(), c.m02Keys, `${label}: مفاتيح خامّ M-02 المخزَّنة = ${c.m02Keys.length} (${c.m02Keys.includes("timeToFirstTouchMs") ? "بالزمنين" : "بلا لمسة فلا زمنان"})`);
      eq(stable(m02.measurements), stable(viaJson(fingerprint.manualResults.find((m) => m.testId === "M-02").measurements)), `${label}: وخامّ M-02 المخزَّن = المُرسَل قيمةً قيمةً`);
      eq(m02.status, c.m02Status, `${label}: وحالة M-02 المخزَّنة ${c.m02Status}`);
      if (c.m02Keys.includes("timeToFirstTouchMs")) {
        ok(Number.isInteger(m02.measurements.timeToFirstTouchMs) && Number.isInteger(m02.measurements.elapsedMs), `${label}: timeToFirstTouchMs وelapsedMs عددان صحيحان في reportRaw`);
      } else {
        ok(!("elapsedMs" in m02.measurements) && !("timeToFirstTouchMs" in m02.measurements), `${label}: لا لمسة: لا elapsedMs ولا timeToFirstTouchMs في reportRaw (لم يُختلَق شيء عند التخزين)`);
        eq(m02.measurements.touchedCells, 0, `${label}: وtouchedCells = 0 يعلن السبب`);
      }
      const sn04 = fpStored.functionalResults.find((f) => f.testId === "SN-04");
      ok(sn04 !== undefined && typeof sn04.measurements === "object", `${label}: SN-04 ومعه measurements في reportRaw`);
      deepEq(Object.keys(sn04.measurements).sort(), SN04_KEYS, `${label}: مفاتيح خامّ SN-04 الأربعة`);
      eq(sn04.measurements.windowMs, 4000, `${label}: SN-04 windowMs=4000`);
      eq(sn04.measurements.coverPromptAtMs, 1000, `${label}: SN-04 coverPromptAtMs=1000 (فاصل القائمتين)`);
      deepEq([sn04.measurements.readingsBeforeCover.length, sn04.measurements.readingsDuringCover.length], c.sn04, `${label}: قائمتا SN-04 بطوليهما ${JSON.stringify(c.sn04)} (لا تخفيف ولا دمج)`);
      ok(sn04.measurements.readingsBeforeCover.concat(sn04.measurements.readingsDuringCover).every((e) => Number.isInteger(e.t) && Array.isArray(e.values)), `${label}: عناصر القائمتين {t, values} كما أُرسلت`);
      eq(stable(sn04.measurements), stable(viaJson(fingerprint.functionalResults.find((f) => f.testId === "SN-04").measurements)), `${label}: وخامّ SN-04 المخزَّن = المُرسَل قيمةً قيمةً`);
      eq(sn04.status, fingerprint.functionalResults.find((f) => f.testId === "SN-04").status, `${label}: وحالة SN-04 المخزَّنة هي ما أرسله التطبيق (لا حكم خادم عليها قبل المحطّة ١)`);
      // حالات اليدوي الخمس كلّها تصل كما أُرسلت
      deepEq(fpStored.manualResults.map((m) => m.status).sort(), fingerprint.manualResults.map((m) => m.status).sort(), `${label}: حالات manualResults المخزَّنة = المُرسَلة`);
      deepEq([...new Set(fpStored.manualResults.map((m) => m.status))].sort(), ["fail", "not_tested", "pass", "unavailable", "warning"], `${label}: الحالات الخمس حاضرة (pass وfail وnot_tested وunavailable وwarning)`);
      eq(fpStored.manualResults.length, 6, `${label}: ستّ نتائج يدوية في reportRaw`);
      // ما يراه النموذج لليدوي (الدفعة ١٠، قرار المستخدم 2026-10-10: «غير متوفر في هذا الجهاز» ⇒ HARDWARE_ABSENT): M-08 (unavailable) بسببه، وM-11 (لم أختبر) بسبب آخر،
      // ولا عطب منهما — بالطبقات الحقيقية كلّها (analyzeDevice ← runAnalysisInternal ← categoryStates ← buildV7Payload) لا بدالّة وحدها
      const mt = (id) => provider.payloads[0].testResults.find((t) => t.testId === id);
      deepEq([mt("M-08").outcome, mt("M-08").notMeasuredReason, mt("M-08").raw.status], ["NOT_MEASURED", "HARDWARE_ABSENT", "unavailable"], `${label}: حمولة النموذج: M-08 «غير متوفر» ⟵ HARDWARE_ABSENT (والحالة الخام تصل)`);
      deepEq([mt("M-11").outcome, mt("M-11").notMeasuredReason], ["NOT_MEASURED", "OPERATOR_SKIPPED"], `${label}: وM-11 «لم أختبر» ⟵ OPERATOR_SKIPPED (سببان مختلفان للنموذج)`);
      deepEq([mt("M-19").outcome, mt("M-09").outcome, mt("M-07").outcome], ["FAIL", "WARNING", "PASS"], `${label}: وfail وwarning وpass تصل نتائج (warning الخامسة المعروفة لا تُسقَط)`);
      const reportText = JSON.stringify(r);
      ok(reportText.includes('"DISC-M-08"') && !reportText.includes('"ISS-M-08"'), `${label}: مستند التقرير: «غير مقيس» (DISC) لـM-08 لا عطب (ISS)`);
      ok(reportText.includes('"ISS-M-19"') && reportText.includes('"ISS-M-09"'), `${label}: وعطبا fail وwarning اليدويان في المستند`);
    } else {
      ok(!("manualResultsHeader" in fpStored), `${label}: طلب fv67: لا manualResultsHeader في reportRaw (الغياب يبقى غياباً: لم يُختلَق «لا إخفاء»)`);
      ok(fpStored.manualResults.every((m) => !("measurements" in m)), `${label}: وبلا measurements لأيّ يدوي`);
      ok(fpStored.functionalResults.every((f) => !("measurements" in f)), `${label}: ولا لأيّ وظيفي (1.0.10 بلا measurements)`);
    }
  }

  // الخصم والقفل
  ok(!(await getDoc("scanClaims", scanId)).exists, `${label}: قفل scanClaims محوّ`);
  eq(provider.calls, 1, `${label}: نداء واحد للمزوّد`);
  deepEq(provider.balanceAtCall, [4], `${label}: الرصيد لحظة النداء = 4 (الفحصة محجوزة قبل النداء)`);
  eq((await getDoc("users", expectedUserId)).data().scansRemaining, 4, `${label}: الرصيد بعد الفحص: 5 ← 4 (خُصمت فحصة واحدة)`);
  eq(ret.pipeline, V7_PIPELINE_TAG, `${label}: الردّ للتطبيق pipeline=V7`);

  // سطر سجلّ الخادم [fv68]
  const fv68Lines = logLines.filter((l) => l.startsWith("[fv68]"));
  eq(fv68Lines.length, 1, `${label}: سطر [fv68] واحد في سجلّ الخادم`);
  eq(fv68Lines[0], summarizeForLog(readFv68(fingerprint)), `${label}: والسطر = ما يقوله القارئ عن هذه الحمولة`);
  ok(fv68Lines[0].includes(`fieldsVersion=${c.fv} appVersion=${c.app} applicable=${c.applicable} columns=${c.columns} `),
      `${label}: السطر يحمل fieldsVersion/appVersion/applicable/columns الصحيحة لهذه الحمولة: ${fv68Lines[0].slice(0, 110)}`);
  if (c.fv >= 69) ok(fv68Lines[0].endsWith("anomalies=[]"), `${label}: fv69 «غير قديم» ولا قارئ يُعلن شيئاً لم يُتوقَّع: السطر ينتهي بـanomalies=[] — ${fv68Lines[0].slice(-60)}`);

  // ما يصل النموذج
  const payload = provider.payloads[0];
  const nmf = (payload.findings && payload.findings.notMeasuredFields) || [];
  const cpuFinal = nmf.filter((e) => e.field === N.FOOTER.CPU_TEMP_FINAL_C);
  eq(cpuFinal.length, c.cpuTempFinalInList ? 1 : 0, `${label}: cpuTempFinalC ${c.cpuTempFinalInList ? "في" : "ليست في"} findings.notMeasuredFields المُرسَلة للنموذج`);
  if (c.cpuTempFinalInList) eq(cpuFinal[0].reason, "NO_CPU_TEMP_SENSOR", `${label}: وسبب غيابها NO_CPU_TEMP_SENSOR (القرار من الحمولة لا من قيمة حارسة)`);
  ok(!nmf.some((e) => e.field === N.FOOTER.MAX_CPU_TEMP_LEGACY && c.applicable), `${label}: maxCpuTemp لا يُعلَن «غير مقيس» لحمولة fv68 (حُذف بالعقد، لا غاب)`);

  // ما لا يغادر الخادم: قراءات fv68
  const leakProbe = "readerVersion";
  ok(!provider.rawUserMessages[0].includes(leakProbe), `${label}: قراءات fv68 لا تصل النموذج`);
  ok(!JSON.stringify(ret).includes(leakProbe), `${label}: ولا الردّ للتطبيق`);
  ok(!JSON.stringify(r).includes(leakProbe), `${label}: ولا مستند التقرير المقروء`);
  ok(!JSON.stringify(raw).includes(leakProbe), `${label}: ولا reportRaw`);
  return {report: r, raw};
}

(async () => {
  for (const c of CASES) {
    const label = `[${c.key}]`;
    const file = readJson(c.file);
    const mkFingerprint = () => c.fingerprintOf(readJson(c.file));
    const fingerprint = c.fingerprintOf(file);
    const scanId = fingerprint.timeSeries.header.scanId;
    await reset();
    const UID = `u-${c.key}`;
    await db.collection("users").doc(UID).set({scansRemaining: 5, scansTotal: 5, plan: "single", isActive: true, expiresAt: future()});
    const provider = installProvider({watchUid: UID});
    const {result: ret, lines} = await captureLogs(() => call({scanId, fingerprint: mkFingerprint(), language: "ar", usePrecomputed: true}, {uid: UID, token: tokenOf("password")}));
    const {report} = await assertOutcome({c, label, fingerprint, scanId, expectedUserId: UID, expectedSessionId: null, ret, provider, logLines: lines});

    // إعادة الطلب بالمعرّف نفسه: لا نداء ثانٍ ولا خصم ثانٍ ولا قراءة ثانية تُطبع (المحفوظ يُعاد)
    const retry = await captureLogs(() => call({scanId, fingerprint: mkFingerprint(), language: "ar", usePrecomputed: true}, {uid: UID, token: tokenOf("password")}));
    eq(provider.calls, 1, `${label}: إعادة الطلب: لا نداء ثانٍ للمزوّد`);
    eq((await getDoc("users", UID)).data().scansRemaining, 4, `${label}: إعادة الطلب: لا خصم ثانٍ`);
    eq(retry.lines.filter((l) => l.startsWith("[fv68]")).length, 0, `${label}: إعادة الطلب تُعاد من المحفوظ: لا تحليل جديد ولا سطر [fv68]`);
    ok(!JSON.stringify(retry.result).includes("readerVersion"), `${label}: والمُعاد بلا قراءات fv68`);
    ok(typeof report.shortId === "string", `${label}: shortId في المستند`);
    console.log(`تحقّق ${c.key}: طلب فردي — ${lines.find((l) => l.startsWith("[fv68]")).slice(0, 160)}`);

    // جلسة QR: الحمولة نفسها يرسلها الزبون المجهول، والخصم من المالك (16ch وحدها — الحالة التي تحمل قوائم فشل مبتورة)
    if (c.qr) {
      await reset();
      const OWNER = `owner-${c.key}`;
      const ANON = `anon-${c.key}`;
      await db.collection("users").doc(OWNER).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: future()});
      const providerQ = installProvider({watchUid: OWNER});
      const created = await createScanSession.run({data: {}, auth: {uid: OWNER, token: tokenOf("google.com")}, rawRequest: {headers: {}}});
      const joined = await joinScanSession.run({data: {code: created.code}, auth: {uid: ANON, token: tokenOf("anonymous")}, rawRequest: {headers: {}}});
      eq(joined.sessionId, created.sessionId, `${label}[QR]: الزبون المجهول انضمّ بالرمز`);
      const q = await captureLogs(() => call({scanId, fingerprint: mkFingerprint(), language: "ar", usePrecomputed: true, sessionId: joined.sessionId}, {uid: ANON, token: tokenOf("anonymous")}));
      await assertOutcome({c, label: `${label}[QR]`, fingerprint, scanId, expectedUserId: OWNER, expectedSessionId: joined.sessionId, ret: q.result, provider: providerQ, logLines: q.lines});
      ok(!(await getDoc("users", ANON)).exists, `${label}[QR]: لا مستند رصيد للزبون المجهول`);
      eq((await getDoc("scanSessions", joined.sessionId)).data().status, "completed", `${label}[QR]: الجلسة completed`);
      console.log(`تحقّق ${c.key}: جلسة QR`);
    }
  }

  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error("FAIL:", e && e.stack || e);
  process.exit(1);
});
