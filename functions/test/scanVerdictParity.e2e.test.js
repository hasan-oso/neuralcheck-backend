// E2E test: حقل الحكم في ردّ checkSubscription مقابل البوّابة الحقيقية في analyzeDevice، على كل حالة (S-SUB، 2026-10-16 +03، البند ٣، القاعدة 30).
// المعالجان الحقيقيان عبر `.run()` على محاكي Firestore (القاعدة 37): checkSubscription وanalyzeDevice (وrunAnalysisInternal وresolveV7Report وwriteReportAndRaw كلّها الشيفرة الحقيقية). **لا يُستبدَل إلا نداء المزوّد**
// (global.fetch، لا شبكة من الاختبارات — القاعدة 9)، ويُعَدّ؛ ومكتبة Gemini بمحاكاة تفشل (لا نداء).
//
// الأمر (بنصّه، من المنسّق، غير متحقَّق من هذا المستودع): «حقل حكم واحد في الردّ يحسبه الخادم بالحكم نفسه (البوّابة)، قيمه قائمة مغلقة (يُسمح، أو سبب الرفض من SCAN_REFUSAL). والحقول القائمة لا تتغيّر (قرّاء 1.0.14
// والموقع). واختبار يثبت أن الحكم في الردّ والبوّابة متطابقان على كل حالة (القاعدة 30).»
//
// ما يثبته (لكل حالة من مصفوفة بمستندات مزروعة على المحاكي):
//   ١ قيمة \`scanVerdict\` في ردّ checkSubscription = المتوقَّع المكتوب هنا مستقلّاً (لا من الدالّة نفسها)، ومن القائمة المغلقة {ALLOWED, NO_CREDIT, SUBSCRIPTION_EXPIRED}.
//   ٢ البوّابة الحقيقية (analyzeDevice على فحص شخصي بمستخدم الحالة): إن كان الحكم سبب رفض ⟵ ترفض analyzeDevice بالسبب نفسه (details.reasonCode) وبنصّه القائم، بصفر نداء نموذج؛ وإن كان ALLOWED ⟵ يمرّ الفحص
//     (الاستثناء المُعلَن: باقة free بجهاز مستعمَل ⟵ ALLOWED في الردّ وFREE_DEVICE_USED في البوّابة، لأن ردّ checkSubscription لا يحمل جهازاً).
//   ٣ الحقول القائمة في الردّ بقيمها وترتيبها كما كانت (plan · scansRemaining · scansTotal · expiresAt · isActive · isFreeTrial · features) والحقل الجديد آخرها وحده؛ والمستخدم غير المسجَّل بردّه الحرفي القديم + الحكم.
//   ٤ نداء بلا مصادقة: unauthenticated «غير مصادق» كما كان.
//   ٥ حدّ مُعلَن: الحكم لحساب المستدعي الشخصي لا لفحص جلسة المحلّ — حساب الفنّي المجهول بلا مستند يقول NO_CREDIT بينما فحصه بجلسة مالكها سليم يمرّ (البوّابة تحكم على المالك هناك).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/scanVerdictParity.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const path = require("path");
const assert = require("assert");

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const geminiPath = require.resolve("@google/generative-ai");
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {generateContent: async () => {
        throw new Error("stub gemini fail");
      }};
    }
  }},
};

// الطبقة الوحيدة المستبدَلة: نداء HTTP للمزوّد، مَعدودة.
let modelCalls = 0;
const CANNED_AI = {
  grade: "B", score: 80, deviceMarketingName: "Test", summary: "س", details: "د",
  verdict: "ت", issues: [], categoryScores: {},
};
global.fetch = async () => {
  modelCalls++;
  return {
    ok: true, status: 200,
    json: async () => ({
      choices: [{message: {content: JSON.stringify(CANNED_AI)}, finish_reason: "stop"}],
      usage: {completion_tokens: 20},
    }),
    text: async () => "",
  };
};

const warns = [];
const origWarn = console.warn.bind(console);
console.warn = (...a) => { warns.push(a.join(" ")); origWarn(...a); };

const SRC = path.join(__dirname, "..", "src");
const {db} = require(path.join(SRC, "utils", "admin"));
const {analyzeDevice} = require(path.join(SRC, "analysis", "analyzeDevice"));
const {checkSubscription} = require(path.join(SRC, "users", "checkSubscription"));
const R = require(path.join(SRC, "analysis", "scanRefusal"));

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const HOUR = 3600 * 1000;
const past = () => new Date(Date.now() - 24 * HOUR);
const future = () => new Date(Date.now() + 10 * 24 * HOUR);

function fp(suffix, deviceModel) {
  return {
    device: {model: deviceModel, androidVersion: "14", apiLevel: 34, totalRamGb: 8, deviceProfileKey: {a: `res_${suffix}`}},
    timeSeries: {
      header: {deviceFingerprint: "c".repeat(64), appVersion: "1.0.11", androidApiLevel: 34},
      footer: {fieldsVersion: 68}, samples: [{ts: 1, v: [1]}], variables: [],
    },
    functionalResults: [], manualResults: [],
  };
}
const callCheck = (uid) => checkSubscription.run({data: {}, auth: {uid, token: {}}, rawRequest: {headers: {}}});
const scan = (uid, scanId, fingerprint, extra = {}) => analyzeDevice.run({data: {scanId, fingerprint, ...extra}, auth: {uid, token: {}}, rawRequest: {headers: {}}})
    .then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

// الحرفية المقابلة لكل حالة مكتوبة هنا مستقلّةً عن الدالّة (القيم المتوقَّعة لا تُشتقّ من الكود الذي تختبره)
const NO_CREDIT = "لا يوجد رصيد فحوصات. يرجى شراء اشتراك.";
const EXPIRED = "انتهى اشتراكك، يرجى التجديد";
const FREE_USED = "تم استخدام الفحص المجاني لهذا الجهاز سابقاً";
const TEXT = {NO_CREDIT, SUBSCRIPTION_EXPIRED: EXPIRED, FREE_DEVICE_USED: FREE_USED};

const FEATURES_FREE = {pdf: false, qr: false, history: false, shopPage: false, remoteCode: false, deviceManagement: false, shopLogo: false, stats: false, prioritySupport: false};
const FEATURES_BASIC = {pdf: true, qr: true, history: true, shopPage: true, remoteCode: true, deviceManagement: false, shopLogo: false, stats: false, prioritySupport: false};
const FEATURES_PRO = {pdf: true, qr: true, history: true, shopPage: true, remoteCode: true, deviceManagement: true, shopLogo: true, stats: true, prioritySupport: true};
const FEATURES_OTHER_PLAN = {pdf: true, qr: true, history: false, shopPage: false, remoteCode: false, deviceManagement: false, shopLogo: false, stats: false, prioritySupport: false};

// [وصف، مستند المستخدم (null = لا مستند)، موديل الجهاز، حكم checkSubscription المتوقَّع، ما تفعله البوّابة الحقيقية: 'ok' أو سبب الرفض]
const MATRIX = [
  ["لا مستند users (غير مسجَّل)", null, "D01", "NO_CREDIT", "NO_CREDIT"],
  ["رصيد 0 (shop_pro)", {scansRemaining: 0, plan: "shop_pro", isActive: true}, "D02", "NO_CREDIT", "NO_CREDIT"],
  ["رصيد سالب", {scansRemaining: -1, plan: "shop_pro", isActive: true}, "D03", "NO_CREDIT", "NO_CREDIT"],
  ["رصيد غائب", {plan: "shop_basic", isActive: true}, "D04", "NO_CREDIT", "NO_CREDIT"],
  ["رصيد 0 ومنتهٍ ⟵ الرصيد قبل التاريخ", {scansRemaining: 0, plan: "shop_pro", isActive: true, expiresAt: past()}, "D05", "NO_CREDIT", "NO_CREDIT"],
  ["منتهٍ (Timestamp ماضٍ) ورصيد 5", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: past()}, "D06", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRED"],
  ["منتهٍ (نصّ ISO ماضٍ)", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: past().toISOString()}, "D07", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRED"],
  ["منتهٍ (رقم ms ماضٍ)", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: Date.now() - 24 * HOUR}, "D08", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRED"],
  ["منتهٍ وisActive=false (الحكم لا يقرأ isActive)", {scansRemaining: 5, plan: "shop_pro", isActive: false, expiresAt: past()}, "D09", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRED"],
  ["expiresAt مستقبلي ورصيد 5", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: future()}, "D10", "ALLOWED", "ok"],
  ["expiresAt غائب (لا انتهاء)", {scansRemaining: 5, plan: "shop_pro", isActive: true}, "D11", "ALLOWED", "ok"],
  ["expiresAt null (لا انتهاء)", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: null}, "D12", "ALLOWED", "ok"],
  ["expiresAt نصّ تالف (لا انتهاء)", {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: "not-a-date"}, "D13", "ALLOWED", "ok"],
  ["isActive=false وصالح (البوّابة لا تقرأ isActive)", {scansRemaining: 5, plan: "shop_pro", isActive: false, expiresAt: future()}, "D14", "ALLOWED", "ok"],
  ["free بجهاز جديد ورصيد 3", {scansRemaining: 3, plan: "free", isActive: true, freeTrialUsedDevices: []}, "D15", "ALLOWED", "ok"],
  ["shop_basic وجهازه في قائمة المجاني (لا ينطبق)", {scansRemaining: 3, plan: "shop_basic", isActive: true, freeTrialUsedDevices: ["D16_14_8"]}, "D16", "ALLOWED", "ok"],
  ["free بجهاز مستعمَل — الفجوة المُعلَنة: ALLOWED في الردّ (لا جهاز في النداء) وFREE_DEVICE_USED في البوّابة", {scansRemaining: 3, plan: "free", isActive: true, freeTrialUsedDevices: ["D17_14_8"]}, "D17", "ALLOWED", "FREE_DEVICE_USED"],
  ["free برصيد 0 وجهاز مستعمَل ⟵ الرصيد قبل الجهاز", {scansRemaining: 0, plan: "free", isActive: true, freeTrialUsedDevices: ["D18_14_8"]}, "D18", "NO_CREDIT", "NO_CREDIT"],
  ["free ومنتهٍ بجهاز مستعمَل ⟵ التاريخ قبل الجهاز", {scansRemaining: 3, plan: "free", isActive: true, expiresAt: past(), freeTrialUsedDevices: ["D19_14_8"]}, "D19", "SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_EXPIRED"],
];

(async () => {
  eq(R.CHECK_SUBSCRIPTION_VERDICT_FIELD, "scanVerdict", "[٠] اسم الحقل");
  const seenVerdicts = new Set();
  const seenGate = new Set();

  for (let i = 0; i < MATRIX.length; i++) {
    const [label, doc, deviceModel, wantVerdict, wantGate] = MATRIX[i];
    const uid = `parity-${i}`;
    if (doc !== null) await db.collection("users").doc(uid).set(doc);

    // ١ — ردّ checkSubscription
    const resp = await callCheck(uid);
    eq(resp[R.CHECK_SUBSCRIPTION_VERDICT_FIELD], wantVerdict, `[١] ${label}: scanVerdict`);
    ok(Object.values(R.CHECK_SUBSCRIPTION_VERDICT).includes(resp.scanVerdict), `[١] ${label}: من القائمة المغلقة`);
    seenVerdicts.add(resp.scanVerdict);

    // ٣ — الحقول القائمة بقيمها وترتيبها، والجديد آخرها
    if (doc === null) {
      deq(resp, {
        plan: "free", scansRemaining: 0, scansTotal: 0, expiresAt: null, isActive: false, isFreeTrial: true, features: FEATURES_FREE, scanVerdict: "NO_CREDIT",
      }, `[٣] ${label}: ردّ غير المسجَّل حرفياً كما كان + الحكم`);
      deq(Object.keys(resp), ["plan", "scansRemaining", "scansTotal", "expiresAt", "isActive", "isFreeTrial", "features", "scanVerdict"], `[٣] ${label}: ترتيب المفاتيح والجديد آخرها`);
    } else {
      deq(Object.keys(resp), ["plan", "scansRemaining", "scansTotal", "expiresAt", "isActive", "isFreeTrial", "features", "scanVerdict"], `[٣] ${label}: المفاتيح القائمة بترتيبها والجديد آخرها وحده`);
      eq(resp.plan, doc.plan || "free", `[٣] ${label}: plan كما كان`);
      eq(resp.scansRemaining, doc.scansRemaining || 0, `[٣] ${label}: scansRemaining كما كان`);
      eq(resp.scansTotal, doc.scansTotal || 0, `[٣] ${label}: scansTotal كما كان`);
      eq(resp.isActive, doc.isActive || false, `[٣] ${label}: isActive كما كان`);
      eq(resp.isFreeTrial, (doc.plan || "free") === "free", `[٣] ${label}: isFreeTrial كما كان`);
      eq(resp.expiresAt === null, doc.expiresAt === undefined || doc.expiresAt === null, `[٣] ${label}: expiresAt null حين لا قيمة (كما كان: user.expiresAt || null)`);
      const wantFeatures = doc.plan === "shop_pro" ? FEATURES_PRO : doc.plan === "shop_basic" ? FEATURES_BASIC : (doc.plan || "free") === "free" ? FEATURES_FREE : FEATURES_OTHER_PLAN;
      deq(resp.features, wantFeatures, `[٣] ${label}: features كما كانت`);
    }

    // ٢ — البوّابة الحقيقية: فحص شخصي بالمستخدم نفسه
    modelCalls = 0; warns.length = 0;
    const outcome = await scan(uid, `parity-scan-${i}`, fp(`par${i}`, deviceModel));
    if (wantGate === "ok") {
      ok(outcome.ok, `[٢] ${label}: البوّابة تُمرّر الفحص (الحكم ALLOWED) — ${outcome.ok ? "" : outcome.error.code + " " + outcome.error.message}`);
      ok(modelCalls >= 1, `[٢] ${label}: وصل الفحص إلى النموذج (k=${modelCalls})`);
      eq(warns.filter((w) => w.startsWith("[analyzeDevice] refused ")).length, 0, `[٢] ${label}: ولا سطر رفض`);
      seenGate.add("ok");
    } else {
      ok(!outcome.ok && outcome.error.code === "permission-denied", `[٢] ${label}: البوّابة ترفض permission-denied`);
      eq(outcome.error.details && outcome.error.details.reasonCode, wantGate, `[٢] ${label}: details.reasonCode = ${wantGate}`);
      eq(outcome.error.message, TEXT[wantGate], `[٢] ${label}: النصّ القائم حرفياً`);
      eq(modelCalls, 0, `[٢] ${label}: صفر نداء نموذج`);
      ok(warns.some((w) => w.startsWith(`[analyzeDevice] refused reason=${wantGate} stage=early `)), `[٢] ${label}: السطر المسمّى بمرحلة early`);
      seenGate.add(wantGate);
      if (wantVerdict !== "ALLOWED") eq(resp.scanVerdict, wantGate, `[٢] ${label}: حكم الردّ = سبب البوّابة نفسه (تطابق على كل حالة رفض)`);
      else eq(wantGate, "FREE_DEVICE_USED", `[٢] ${label}: الاستثناء الوحيد من «ALLOWED ⟹ يمرّ»: الجهاز المجاني (مُعلَن)`);
    }
  }
  deq([...seenVerdicts].sort(), ["ALLOWED", "NO_CREDIT", "SUBSCRIPTION_EXPIRED"], "[١] المصفوفة تمرّ بقيم الحكم الثلاث كلّها (القاعدة 30)");
  deq([...seenGate].sort(), ["FREE_DEVICE_USED", "NO_CREDIT", "SUBSCRIPTION_EXPIRED", "ok"], "[٢] وبكل نتائج البوّابة: تمرير وثلاثة أسباب رفض");

  // ٤ — بلا مصادقة
  {
    let err = null;
    try { await checkSubscription.run({data: {}, rawRequest: {headers: {}}}); } catch (e) { err = e; }
    ok(err && err.code === "unauthenticated" && err.message === "غير مصادق", "[٤] نداء بلا مصادقة: unauthenticated «غير مصادق» كما كان");
  }

  // ٥ — حدّ مُعلَن: الحكم لحساب المستدعي، لا لفحص الجلسة
  {
    await db.collection("users").doc("par-shop-owner").set({scansRemaining: 4, plan: "shop_pro", isActive: true, expiresAt: future()});
    await db.collection("scanSessions").doc("par-sess").set({ownerId: "par-shop-owner", status: "scanning", expiresAt: future(), code: "NC-PAR01"});
    const techResp = await callCheck("par-tech-anon"); // الفنّي المجهول: لا مستند users
    eq(techResp.scanVerdict, "NO_CREDIT", "[٥] حساب الفنّي المجهول (بلا مستند) حكم checkSubscription له NO_CREDIT");
    modelCalls = 0;
    const sessionScan = await scan("par-tech-anon", "par-session-scan-1", fp("sess", "SESSDEV"), {sessionId: "par-sess"});
    ok(sessionScan.ok, "[٥] ومع ذلك فحصه بجلسة مالكها سليم يمرّ: البوّابة تحكم على المالك، فحكم الردّ لا يُطبَّق على مسار الجلسة (موثَّق في §١٠)");
  }

  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
