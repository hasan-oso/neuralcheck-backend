// E2E test: ملاحظة الطراز LINK_MODEL_MISMATCH على «بعد» (ق36 أ، أقرّه حسن 2026-10-22؛ أمر المنسّق للمرحلة S10) — analyzeDevice وcorrectProtocolRecord وverifyReport الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل — كما في maintenancePair.e2e.test.js. كل ما سواه يمرّ إلى المحاكي كما هو.
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A3 البند ٤ («فحص الطراز عند الاكتمال») وA11 (إلحاق ق36 أ: unlink يُبطل وrelink يعيد الحساب) وأمر المنسّق (منقول عن DECISIONS-FOR-HASAN-2026-10-21.md:333-338: «ابنِ ملاحظة LINK_MODEL_MISMATCH على «بعد» حين يختلف طراز تقريرَي الزوج، بلا رفض ولا نصّ»).
//
// **هذا الملفّ يعدّ الإخفاق ولا يرمي عند أول واحد** (كُتب قبل البناء ويُسجَّل عدد الفاشل على b0a0f66؛ القاعدتان 18 و23): كل قيد ck(...) مستقلّ؛ وفشل بذر مشهد يُعدّ إخفاقاً مسمّى ويُكمَل ما بعده.
//
//   ١ اكتمال حقيقي بطرازين متطابقين ⟵ LINK_MODEL_MATCH، وبطرازين مختلفين ⟵ LINK_MODEL_MISMATCH بلا رفض ولا تأخير ولا خصم إضافي، وبسطر السجلّ المسمّى
//   ٢ الغياب بكل أشكاله على التدفّق الحقيقي: طراز غائب في إحدى البصمتين أو كلتيهما (احتياطي المستودع "Unknown") وطراز فارغ في تقرير مخزَّن ⟵ LINK_MODEL_ABSENT (لا MATCH أبداً)
//   ٣ لا مقارنة بلا هدف: هدف ضائع (خسر السباق) وفحص بلا ربط وفحص عادي و«قبل» ⟵ linkModelCheck = null صريحاً (المفتاح حاضر)
//   ٤ لا تسرّب: لا في تقرير reports ولا الخامّ reportRaw ولا ردّ analyzeDevice ولا ردّ verifyReport ولا أسطر السجلّ الخامّة (المعرّفات مُهشَّرة)
//   ٥ تصحيح المشرف (القاعدتان 20 و33): unlink يُبطل بـnull صريح، وrelink يعيد حسابه للهدف الجديد (MATCH ⟵ MISMATCH ⟵ ABSENT)، والسطر يحمل القيمة القديمة والجديدة بالإلحاق، وexclude لا يمسّ الحقل
//   ٦ الإعادة المشروعة من المخزَّن لا تكتب ولا تعيد سطراً ولا تغيّر الحالة
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/linkModelCheck.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد (القاعدة 9: لا طلب شبكة نحو مزوّد؛ أيّ عنوان آخر يُرمى).
let modelCalls = 0;
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
  return deepSeekHttpResponse(validV7ModelResponse());
};

const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {correctProtocolRecord} = require("../src/admin/protocolCorrectionAdmin");
const {confirmMaintenanceAfterLink} = require("../src/sessions/maintenancePairCalls");
const {verifyReport} = require("../src/reports/verifyReport");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const failures = [];
const ck = (cond, label) => { n++; if (!cond) failures.push(label); };
const ceq = (a, b, label) => { n++; if (!Object.is(a, b)) failures.push(`${label} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const cdeq = (a, b, label) => { n++; try { assert.deepStrictEqual(a, b); } catch (e) { failures.push(`${label} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); } };
const scene = async (name, fn) => {
  try { await fn(); } catch (e) { n++; failures.push(`SETUP/RUNTIME ERROR في المشهد ${name}: ${String((e && e.stack) || e).split("\n").slice(0, 3).join(" | ").slice(0, 400)}`); }
};

const MATCH = "LINK_MODEL_MATCH";
const MISMATCH = "LINK_MODEL_MISMATCH";
const ABSENT = "LINK_MODEL_ABSENT";

const fingerprintFor = (model) => ({
  device: {model, androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
});
const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const seedOwner = (uid, extra = {}) => db.collection("users").doc(uid).set({scansRemaining: 50, scansTotal: 50, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), protocolParts: {purposes: true, batteryBeforeAfter: true}, ...extra});
const setSettings = (hours) => db.collection("protocolSettings").doc("current").set({version: 1, openBeforeValidityHours: hours});
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn) {
  const cap = capture();
  let r;
  try {
    r = await settle(fn());
  } finally {
    cap.restore();
  }
  return {ret: r.ok ? r.value : null, threw: r.ok ? null : r.error, lines: cap.lines, texts: cap.texts()};
}
const create = (uid) => call(() => createScanSession.run({data: {}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const join = (code, uid) => call(() => joinScanSession.run({data: {code}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const setPurpose = (uid, sessionId, purpose, defectType) => call(() => setSessionPurpose.run({data: {sessionId, purpose, defectType}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const confirmLink = (uid, sessionId, beforeScanId) => call(() => confirmMaintenanceAfterLink.run({data: {sessionId, beforeScanId}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const analyze = (scanId, sessionId, uid, model) => call(() => analyzeDevice.run({data: {scanId, fingerprint: fingerprintFor(model), ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const creditOf = async (uid) => (await getDoc("users", uid)).data().scansRemaining;

/** «قبل» حقيقية بطراز معيّن: إنشاء ⟵ اختيار ⟵ انضمام ⟵ تحليل. */
async function realBefore({owner, anon, scanId, model, type = "BATTERY"}) {
  const created = await create(owner);
  const id = created.ret.sessionId;
  await setPurpose(owner, id, "maintenance_before", type);
  await join(created.ret.code, anon);
  const r = await analyze(scanId, id, anon, model);
  return {id, r};
}
/** جلسة «بعد» مربوطة بـ«قبل» مؤكَّدة؛ لا تحلَّل بعد. */
async function afterSession({owner, anon, link, type = "BATTERY"}) {
  const created = await create(owner);
  const id = created.ret.sessionId;
  await setPurpose(owner, id, "maintenance_after", type);
  if (link !== undefined) await confirmLink(owner, id, link);
  await join(created.ret.code, anon);
  return {id, anon};
}
const protocolOf = (scanId) => data("scanProtocol", scanId);
const modelLines = (texts) => texts.filter((t) => t.includes("modelCheck=") || t.includes("scanProtocol notes=LINK_MODEL_"));

(async () => {
  const OWN = "own-lmc";
  await seedOwner(OWN);
  await setSettings(72);

  // ═══ ١ — اكتمال حقيقي: متطابق ومختلف ═══
  let mismatchAfter = null;
  await scene("١-أ MATCH", async () => {
    const b = await realBefore({owner: OWN, anon: "anon-lmc-b1", scanId: "scan-lmc-b1", model: "PhoneM"});
    ck(b.r.threw === null, "[١] (بذر) تحليل «قبل» نجح");
    const a = await afterSession({owner: OWN, anon: "anon-lmc-a1", link: "scan-lmc-b1"});
    const credit0 = await creditOf(OWN);
    const r = await analyze("scan-lmc-a1", a.id, a.anon, "PhoneM");
    ck(r.threw === null, `[١] تحليل «بعد» نجح: ${r.threw && r.threw.message}`);
    ceq(credit0 - (await creditOf(OWN)), 1, "[١] **خُصمت فحصة واحدة كأيّ فحص عادي** (الملاحظة لا خصم إضافي ولا إعفاء)");
    const sp = await protocolOf("scan-lmc-a1");
    cdeq([sp.linkState, sp.linkedScanId, sp.linkMethod], ["active", "scan-lmc-b1", "manual"], "[١] الربط active/manual كما كان");
    ceq(sp.linkModelCheck, MATCH, "[١] طرازان متطابقان (PhoneM) ⟵ linkModelCheck = LINK_MODEL_MATCH");
    cdeq(modelLines(r.texts), [`[analyzeDevice] maintenance pair linked after=${sid("scan-lmc-a1")} before=${sid("scan-lmc-b1")} modelCheck=${MATCH}`], "[١] سطر الربط يحمل حالة الطراز، ولا سطر ملاحظة للمطابق");
    ck(r.texts.every((t) => !t.includes("scan-lmc-a1") && !t.includes("scan-lmc-b1")), "[١] ولا معرّف خامّ في الأسطر");
    ceq((await protocolOf("scan-lmc-b1")).pair.state, "COMPLETED", "[١] و«قبل» COMPLETED");
    ceq((await protocolOf("scan-lmc-b1")).linkModelCheck, null, "[١] و«قبل» linkModelCheck = null (لا مقارنة على «قبل»)");
  });
  await scene("١-ب MISMATCH", async () => {
    const b = await realBefore({owner: OWN, anon: "anon-lmc-b2", scanId: "scan-lmc-b2", model: "PhoneX"});
    ck(b.r.threw === null, "[١] (بذر) تحليل «قبل» PhoneX نجح");
    const a = await afterSession({owner: OWN, anon: "anon-lmc-a2", link: "scan-lmc-b2"});
    const credit0 = await creditOf(OWN);
    const calls0 = modelCalls;
    const r = await analyze("scan-lmc-a2", a.id, a.anon, "PhoneY");
    ck(r.threw === null, `[١] **تحليل «بعد» ينجح رغم اختلاف الطراز (لا رفض)**: ${r.threw && r.threw.message}`);
    ceq(modelCalls - calls0, 1, "[١] ونداء نموذج واحد (لا تأخير ولا إعادة)");
    ceq(credit0 - (await creditOf(OWN)), 1, "[١] وخُصمت فحصة واحدة");
    const sp = await protocolOf("scan-lmc-a2");
    cdeq([sp.linkState, sp.linkedScanId, sp.linkMethod], ["active", "scan-lmc-b2", "manual"], "[١] **الربط active كما هو** (الملاحظة لا تمسّ الربط ولا تجعله missing)");
    ceq(sp.linkModelCheck, MISMATCH, "[١] طرازان مختلفان (PhoneX وPhoneY) ⟵ linkModelCheck = LINK_MODEL_MISMATCH");
    cdeq([(await protocolOf("scan-lmc-b2")).pair.state, (await protocolOf("scan-lmc-b2")).pair.completedByScanId], ["COMPLETED", "scan-lmc-a2"], "[١] و«قبل» COMPLETED بـ«بعد» رغم الاختلاف");
    cdeq(modelLines(r.texts), [
      `[analyzeDevice] scanProtocol notes=${MISMATCH} purpose=maintenance_after`,
      `[analyzeDevice] maintenance pair linked after=${sid("scan-lmc-a2")} before=${sid("scan-lmc-b2")} modelCheck=${MISMATCH}`,
    ], "[١] سطر الملاحظة المسمّاة LINK_MODEL_MISMATCH ثم سطر الربط (بترتيب LINK_TARGET_LOST: الملاحظة أولاً)");
    ck(!r.texts.some((t) => t.includes("LINK_TARGET_LOST")), "[١] ولا ملاحظة ضياع هدف");
    const rep = await data("reports", "scan-lmc-a2");
    ck(rep && (await getDoc("reportRaw", "scan-lmc-a2")).exists, "[١] والتقرير والخامّ مكتوبان (التقرير يكتمل في كل حالة)");
    ceq(rep.deviceModel, "PhoneY", "[١] وطراز تقرير «بعد» هو ما قارنه (deviceModel من البصمة)");
    ceq((await data("reports", "scan-lmc-b2")).deviceModel, "PhoneX", "[١] وطراز تقرير «قبل» كذلك");
    ceq((await data("scanSessions", a.id)).status, "completed", "[١] والجلسة completed");
    mismatchAfter = {scanId: "scan-lmc-a2", beforeId: "scan-lmc-b2", ret: r.ret, sessionId: a.id, anon: a.anon};
  });
  await scene("١-ج حالة الأحرف", async () => {
    const b = await realBefore({owner: OWN, anon: "anon-lmc-b3", scanId: "scan-lmc-b3", model: "PhoneCase"});
    ck(b.r.threw === null, "[١] (بذر) «قبل» PhoneCase");
    const a = await afterSession({owner: OWN, anon: "anon-lmc-a3", link: "scan-lmc-b3"});
    const r = await analyze("scan-lmc-a3", a.id, a.anon, "phonecase");
    ck(r.threw === null, "[١] (بذر) تحليل «بعد» phonecase نجح");
    ceq((await protocolOf("scan-lmc-a3")).linkModelCheck, MISMATCH, "[١] المقارنة حرفية بلا مطبِّع: PhoneCase ≠ phonecase ⟵ MISMATCH (كما تقرأ resolveMarketingName حرفياً)");
  });

  // ═══ ٢ — الغياب بكل أشكاله على التدفّق الحقيقي ═══
  for (const [tag, beforeModel, afterModel] of [
    ["قبل-غائب", null, "PhoneA"],
    ["بعد-غائب", "PhoneA", null],
    ["كلاهما-غائب", null, null],
  ]) {
    await scene(`٢ ${tag}`, async () => {
      const b = await realBefore({owner: OWN, anon: `anon-lmc-${tag}-b`, scanId: `scan-lmc-${tag}-b`, model: beforeModel});
      ck(b.r.threw === null, `[٢] (بذر ${tag}) تحليل «قبل» نجح: ${b.r.threw && b.r.threw.message}`);
      const a = await afterSession({owner: OWN, anon: `anon-lmc-${tag}-a`, link: `scan-lmc-${tag}-b`});
      const r = await analyze(`scan-lmc-${tag}-a`, a.id, a.anon, afterModel);
      ck(r.threw === null, `[٢] ${tag}: التحليل ينجح (لا رفض): ${r.threw && r.threw.message}`);
      const sp = await protocolOf(`scan-lmc-${tag}-a`);
      ceq(sp.linkModelCheck, ABSENT, `[٢] ${tag}: الطراز غائب في أحد التقريرين أو كليهما ⟵ LINK_MODEL_ABSENT (لا MATCH ولا MISMATCH ولا null)`);
      ceq(sp.linkState, "active", `[٢] ${tag}: والربط active كما هو`);
      ck(r.texts.some((t) => t === `[analyzeDevice] scanProtocol notes=${ABSENT} purpose=maintenance_after`), `[٢] ${tag}: وسطر ملاحظة LINK_MODEL_ABSENT`);
      ck(r.texts.some((t) => t.endsWith(` modelCheck=${ABSENT}`)), `[٢] ${tag}: وسطر الربط يحمل modelCheck=LINK_MODEL_ABSENT`);
    });
  }
  await scene("٢ طراز مخزَّن فارغ", async () => {
    // تقرير «قبل» المخزَّن يُفسَد في المحاكي (كتابة لا حذف) لكل شكل: «قبل» جديدة لكلٍّ كي لا يمنع ربطٌ حيّ سابق اكتمالَ التالي
    const bads = [["empty", ""], ["spaces", "   "], ["null", null], ["number", 5], ["lower-unknown", "unknown"], ["upper-Unknown", "Unknown"]];
    for (let i = 0; i < bads.length; i++) {
      const [label, bad] = bads[i];
      const bid = `scan-lmc-e${i}-b`;
      const aid = `scan-lmc-e${i}-a`;
      const b = await realBefore({owner: OWN, anon: `anon-lmc-e${i}-b`, scanId: bid, model: "PhoneE"});
      ck(b.r.threw === null, `[٢] (بذر ${label}) «قبل» PhoneE`);
      await db.collection("reports").doc(bid).update({deviceModel: bad});
      const a = await afterSession({owner: OWN, anon: `anon-lmc-e${i}-a`, link: bid});
      const r = await analyze(aid, a.id, a.anon, "PhoneE");
      ck(r.threw === null, `[٢] طراز «قبل» المخزَّن ${label}: التحليل ينجح`);
      ceq((await protocolOf(aid)).linkModelCheck, ABSENT, `[٢] طراز «قبل» المخزَّن ${label} ⟵ LINK_MODEL_ABSENT`);
    }
  });

  // ═══ ٣ — لا مقارنة بلا هدف ═══
  await scene("٣ هدف ضائع", async () => {
    const b = await realBefore({owner: OWN, anon: "anon-lmc-l-b", scanId: "scan-lmc-l-b", model: "PhoneL"});
    ck(b.r.threw === null, "[٣] (بذر) «قبل» PhoneL");
    const X = await afterSession({owner: OWN, anon: "anon-lmc-l-x", link: "scan-lmc-l-b"});
    const Y = await afterSession({owner: OWN, anon: "anon-lmc-l-y", link: "scan-lmc-l-b"});
    ck((await analyze("scan-lmc-l-y", Y.id, Y.anon, "PhoneOther")).threw === null, "[٣] Y حُلِّلت أوّلاً وربطت «قبل» (طرازها مختلف: MISMATCH)");
    ceq((await protocolOf("scan-lmc-l-y")).linkModelCheck, MISMATCH, "[٣] (بذر) Y مختلفة الطراز ⟵ MISMATCH");
    const rx = await analyze("scan-lmc-l-x", X.id, X.anon, "PhoneL2");
    ck(rx.threw === null, "[٣] X تنجح رغم ضياع الهدف");
    const spX = await protocolOf("scan-lmc-l-x");
    ceq(spX.linkState, "missing", "[٣] X: linkState = missing");
    ck("linkModelCheck" in spX, "[٣] المفتاح حاضر في مستند X (القاعدة 22: لا غياب مفتاح)");
    ceq(spX.linkModelCheck, null, "[٣] **هدف ضائع ⟵ لا مقارنة: linkModelCheck = null** ولو اختلف طرازها (PhoneL2) عن «قبل» (PhoneL)");
    ck(rx.texts.some((t) => t.includes("LINK_TARGET_LOST")) && !rx.texts.some((t) => t.includes("LINK_MODEL_") || t.includes("modelCheck=")), "[٣] ملاحظة LINK_TARGET_LOST وحدها بلا أيّ أثر لفحص الطراز في السجلّ");
  });
  await scene("٣ فحوص بلا ربط", async () => {
    const created = await create(OWN);
    await setPurpose(OWN, created.ret.sessionId, "maintenance_after", "BATTERY"); // بلا تأكيد ربط
    await join(created.ret.code, "anon-lmc-n-a");
    const rAfter = await analyze("scan-lmc-n-a", created.ret.sessionId, "anon-lmc-n-a", "PhoneN");
    ck(rAfter.threw === null, "[٣] (بذر) «بعد» بلا ربط مختار");
    const spA = await protocolOf("scan-lmc-n-a");
    ck("linkModelCheck" in spA && spA.linkModelCheck === null, `[٣] «بعد» بلا ربط ⟵ linkModelCheck = null صريحاً (${JSON.stringify(spA.linkModelCheck)})`);
    const c2 = await create(OWN);
    await join(c2.ret.code, "anon-lmc-n-n");
    ck((await analyze("scan-lmc-n-n", c2.ret.sessionId, "anon-lmc-n-n", "PhoneN")).threw === null, "[٣] (بذر) فحص عادي");
    const spN = await protocolOf("scan-lmc-n-n");
    ck("linkModelCheck" in spN && spN.linkModelCheck === null, "[٣] فحص عادي ⟵ linkModelCheck = null صريحاً");
    const spB = await protocolOf("scan-lmc-b1");
    ck("linkModelCheck" in spB && spB.linkModelCheck === null, "[٣] و«قبل» ⟵ linkModelCheck = null صريحاً");
  });

  // ═══ ٤ — لا تسرّب ═══
  await scene("٤ لا تسرّب", async () => {
    ck(mismatchAfter !== null, "[٤] (بذر) «بعد» MISMATCH موجودة");
    if (mismatchAfter === null) return;
    const HIDDEN_NAMES = ["linkModelCheck"];
    const HIDDEN_VALUES = [MATCH, MISMATCH, ABSENT, "LINK_MODEL_"];
    const leaks = (label, v) => {
      const text = JSON.stringify(v);
      for (const k of HIDDEN_NAMES) ck(!text.includes(`"${k}"`), `[٤] ${label}: لا مفتاح ${k}`);
      for (const val of HIDDEN_VALUES) ck(!text.includes(val), `[٤] ${label}: ولا قيمة ${val}`);
    };
    for (const id of [mismatchAfter.scanId, mismatchAfter.beforeId, "scan-lmc-a1"]) {
      leaks(`تقرير ${id}`, await data("reports", id));
      leaks(`الخامّ ${id}`, await data("reportRaw", id));
    }
    leaks("ردّ analyzeDevice", mismatchAfter.ret);
    const verify = async (key, ip) => {
      let status = null; let body = null;
      const res = {status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; }, set() { return this; }, setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, on() { return this; }, once() { return this; }, emit() {}, end() {}, headersSent: false};
      const req = {method: "GET", query: {scanId: key}, headers: {"x-forwarded-for": ip}, ip, get: () => ""};
      const r = await call(() => verifyReport(req, res));
      return {status, body, threw: r.threw, texts: r.texts};
    };
    const v1 = await verify(mismatchAfter.scanId, "203.0.113.71");
    ck(v1.threw === null && v1.body && v1.body.verified === true, "[٤] verifyReport على «بعد» MISMATCH: 200 ناجح (الفحص ليس على رفض)");
    leaks("ردّ verifyReport (بعد)", v1.body);
    const shortId = (await data("reports", mismatchAfter.scanId)).shortId;
    const v2 = await verify(shortId, "203.0.113.72");
    ck(v2.threw === null && v2.body && v2.body.verified === true, "[٤] verifyReport بـshortId: 200 ناجح");
    leaks("ردّ verifyReport (shortId)", v2.body);
    ck(!v1.texts.join("\n").includes("LINK_MODEL_") && !v2.texts.join("\n").includes("LINK_MODEL_"), "[٤] ولا أثر في أسطر سجلّ verifyReport");
  });

  // ═══ ٥ — تصحيح المشرف ═══
  await scene("٥ unlink وrelink", async () => {
    const ADMIN = {uid: "admin-lmc", token: {email: ADMIN_EMAILS[0], email_verified: true}};
    const correct = (d) => call(() => correctProtocolRecord.run({data: d, auth: ADMIN, rawRequest: {headers: {}}}));
    const linesFor = async (scanId) => (await db.collection("protocolCorrections").where("scanId", "==", scanId).get()).docs.map((d) => d.data()).sort((a, b) => a.seq - b.seq);
    const modelLinesOf = (texts) => texts.filter((t) => t.startsWith("[correctProtocolRecord] link-model-check "));

    // «بعد» ص: بطراز PhoneP، مربوطة بـ«قبل» بالطراز نفسه ⟵ MATCH ثم تُصحَّح
    const bP = await realBefore({owner: OWN, anon: "anon-lmc-p-b", scanId: "scan-lmc-p-b", model: "PhoneP"});
    ck(bP.r.threw === null, "[٥] (بذر) «قبل» PhoneP");
    const aP = await afterSession({owner: OWN, anon: "anon-lmc-p-a", link: "scan-lmc-p-b"});
    ck((await analyze("scan-lmc-p-a", aP.id, aP.anon, "PhoneP")).threw === null, "[٥] (بذر) «بعد» PhoneP");
    ceq((await protocolOf("scan-lmc-p-a")).linkModelCheck, MATCH, "[٥] (بذر) MATCH قبل التصحيح");
    // أهداف relink: «قبل» بالطراز نفسه (MATCH) وأخرى مختلفة (MISMATCH) وثالثة بطراز فارغ (ABSENT)
    for (const [id, model] of [["scan-lmc-p-bsame", "PhoneP"], ["scan-lmc-p-bdiff", "PhoneQ"], ["scan-lmc-p-babs", "PhoneR"]]) {
      const x = await realBefore({owner: OWN, anon: `anon-${id}`, scanId: id, model});
      ck(x.r.threw === null, `[٥] (بذر) ${id}`);
    }
    await db.collection("reports").doc("scan-lmc-p-babs").update({deviceModel: ""});

    // unlink: يُبطل بـnull صريح
    const u1 = await correct({action: "unlink", scanId: "scan-lmc-p-a"});
    ck(u1.threw === null, `[٥] unlink نجح: ${u1.threw && u1.threw.message}`);
    const spU = await protocolOf("scan-lmc-p-a");
    ceq(spU.linkState, "unlinked_by_admin", "[٥] unlink: linkState = unlinked_by_admin");
    ck("linkModelCheck" in spU && spU.linkModelCheck === null, `[٥] **unlink يُبطل الملاحظة بـnull صريح** (لا تبقى MATCH قديمة: ق20 وق33) — ${JSON.stringify(spU.linkModelCheck)}`);
    const l1 = await linesFor("scan-lmc-p-a");
    cdeq([l1.length, l1[0] && l1[0].action, l1[0] && l1[0].before && l1[0].before.linkModelCheck, l1[0] && l1[0].after && l1[0].after.linkModelCheck], [1, "unlink", MATCH, null], "[٥] سطر unlink يحفظ القديمة MATCH في before وnull في after (بالإلحاق: القيمة القديمة لا تُمحى)");
    ceq(l1[0] && Object.keys(l1[0]).length, 9, "[٥] والسطر بتسعة حقول (لم يتغيّر شكله)");
    cdeq(modelLinesOf(u1.texts), [`[correctProtocolRecord] link-model-check cleared scan=${sid("scan-lmc-p-a")} caller=${sid(ADMIN.uid)}`], "[٥] سطر سجلّ الإبطال المسمّى (معرّفان مُهشَّران)");
    cdeq(Object.keys(u1.ret).sort(), ["action", "basis", "changed", "correctionSeq", "exclusion", "linkState", "linkedScanId", "scanId"], "[٥] وردّ الدالّة بلا حقل جديد (ثمانية مفاتيح)");

    // relink: MATCH ثم MISMATCH ثم ABSENT ثم MATCH (كل مرّة يُعاد الحساب)
    const sequence = [["scan-lmc-p-bsame", MATCH, null], ["scan-lmc-p-bdiff", MISMATCH, MATCH], ["scan-lmc-p-babs", ABSENT, MISMATCH], ["scan-lmc-p-bsame", MATCH, ABSENT]];
    let seq = 1;
    for (const [target, want, prev] of sequence) {
      seq++;
      const r = await correct({action: "relink", scanId: "scan-lmc-p-a", toScanId: target});
      ck(r.threw === null && r.ret.changed === true, `[٥] relink إلى ${target} نجح: ${r.threw && r.threw.message}`);
      ceq((await protocolOf("scan-lmc-p-a")).linkModelCheck, want, `[٥] **relink إلى ${target} ⟵ يعيد حساب الملاحظة: ${want}**`);
      const ls = await linesFor("scan-lmc-p-a");
      const last = ls[ls.length - 1];
      cdeq([ls.length, last.seq, last.action, last.before.linkModelCheck, last.after.linkModelCheck], [seq, seq, "relink", prev, want], `[٥] سطر relink ${seq}: before ${prev} ⟵ after ${want} (بالإلحاق)`);
      cdeq(modelLinesOf(r.texts), [`[correctProtocolRecord] link-model-check ${want} scan=${sid("scan-lmc-p-a")} caller=${sid(ADMIN.uid)}`], `[٥] سطر سجلّ ${want}`);
    }
    // الأسطر السابقة لم تتغيّر (إلحاق لا كتابة فوق)
    const all = await linesFor("scan-lmc-p-a");
    cdeq(all.map((l) => l.seq), [1, 2, 3, 4, 5], "[٥] خمسة أسطر متتالية");
    cdeq([all[0].before.linkModelCheck, all[0].after.linkModelCheck], [MATCH, null], "[٥] وسطر unlink الأول كما كُتب (لم يُعدَّل)");

    // relink إلى الهدف نفسه بالحالة نفسها: لا كتابة ولا تغيير
    const same = await correct({action: "relink", scanId: "scan-lmc-p-a", toScanId: "scan-lmc-p-bsame"});
    cdeq([same.ret.changed, same.ret.correctionSeq, modelLinesOf(same.texts)], [false, null, []], "[٥] relink إلى الهدف نفسه: changed=false بلا سطر ولا أثر على linkModelCheck");
    ceq((await protocolOf("scan-lmc-p-a")).linkModelCheck, MATCH, "[٥] والملاحظة باقية MATCH");

    // exclude/unexclude لا يمسّان الحقل ولا يضيفانه إلى سطرهما
    const before = (await protocolOf("scan-lmc-p-a")).linkModelCheck;
    const ex = await correct({action: "exclude", scanId: "scan-lmc-p-a", reason: "test"});
    ck(ex.threw === null, "[٥] exclude نجح");
    ceq((await protocolOf("scan-lmc-p-a")).linkModelCheck, before, "[٥] exclude لا يمسّ linkModelCheck");
    const lx = (await linesFor("scan-lmc-p-a")).slice(-1)[0];
    ck(!("linkModelCheck" in lx.before) && !("linkModelCheck" in lx.after), "[٥] وسطر exclude بلا linkModelCheck في before/after (شكله القديم)");
    ck(modelLinesOf(ex.texts).length === 0, "[٥] ولا سطر link-model-check لـexclude");
    const un = await correct({action: "unexclude", scanId: "scan-lmc-p-a"});
    ck(un.threw === null, "[٥] unexclude نجح");
    ceq((await protocolOf("scan-lmc-p-a")).linkModelCheck, before, "[٥] unexclude لا يمسّ linkModelCheck");

    // relink لفحصَين عاديَّين بطرازين مختلفين: يُحسب لأيّ فحص له scanProtocol (لا قواعد أزواج في relink)
    const c1 = await create(OWN); await join(c1.ret.code, "anon-lmc-r-1");
    const c2 = await create(OWN); await join(c2.ret.code, "anon-lmc-r-2");
    ck((await analyze("scan-lmc-r-1", c1.ret.sessionId, "anon-lmc-r-1", "PhoneR1")).threw === null && (await analyze("scan-lmc-r-2", c2.ret.sessionId, "anon-lmc-r-2", "PhoneR2")).threw === null, "[٥] (بذر) فحصان عاديان بطرازين مختلفين");
    const rn = await correct({action: "relink", scanId: "scan-lmc-r-1", toScanId: "scan-lmc-r-2"});
    ck(rn.threw === null && rn.ret.changed === true, "[٥] relink بين فحصين عاديَّين نجح");
    ceq((await protocolOf("scan-lmc-r-1")).linkModelCheck, MISMATCH, "[٥] relink لأيّ فحص له scanProtocol ⟵ يُحسب (قرار الوكيل: لا قواعد أزواج في relink)");
    // وunlink لفحص عادي مربوط يدوياً بقيمة مخزَّنة ⟵ null
    const un2 = await correct({action: "unlink", scanId: "scan-lmc-r-1"});
    ck(un2.threw === null, "[٥] unlink لفحص عادي نجح");
    ceq((await protocolOf("scan-lmc-r-1")).linkModelCheck, null, "[٥] وlinkModelCheck = null بعده");

    // لا حذف: كل المستندات باقية
    ck((await getDoc("scanProtocol", "scan-lmc-p-a")).exists && (await getDoc("reports", "scan-lmc-p-bsame")).exists, "[٥] لا حذف في أيّ مسار");
  });

  // ═══ ٦ — إعادة مشروعة من المخزَّن ═══
  await scene("٦ إعادة", async () => {
    const before = JSON.stringify(await protocolOf("scan-lmc-a2"), (k, v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v));
    ck(mismatchAfter !== null, "[٦] (بذر) «بعد» MISMATCH موجودة");
    if (mismatchAfter === null) return;
    const again = await analyze("scan-lmc-a2", mismatchAfter.sessionId, mismatchAfter.anon, "PhoneY");
    ck(again.threw === null, `[٦] الإعادة المشروعة لا ترمي: ${again.threw && again.threw.message}`);
    ck(!again.texts.some((t) => t.includes("modelCheck=") || t.includes("LINK_MODEL_") || t.includes("maintenance pair")), "[٦] والإعادة من المخزَّن بلا سطر ربط ولا ملاحظة طراز");
    const after = JSON.stringify(await protocolOf("scan-lmc-a2"), (k, v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v));
    ceq(after, before, "[٦] ومستند scanProtocol للإعادة لم يتغيّر بايتاً");
    ceq((await protocolOf("scan-lmc-a2")).linkModelCheck, MISMATCH, "[٦] وlinkModelCheck باقية MISMATCH");
  });

  // ═══ ٧ — سباق حقيقي: واحدة بحالة الطراز والخاسرة null ═══
  await scene("٧ سباق", async () => {
    const b = await realBefore({owner: OWN, anon: "anon-lmc-s-b", scanId: "scan-lmc-s-b", model: "PhoneS"});
    ck(b.r.threw === null, "[٧] (بذر) «قبل» PhoneS");
    const X = await afterSession({owner: OWN, anon: "anon-lmc-s-x", link: "scan-lmc-s-b"});
    const Y = await afterSession({owner: OWN, anon: "anon-lmc-s-y", link: "scan-lmc-s-b"});
    const run = (scanId, sessionId, uid, model) => analyzeDevice.run({data: {scanId, fingerprint: fingerprintFor(model), sessionId}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}});
    const both = await call(() => Promise.all([run("scan-lmc-s-x", X.id, X.anon, "PhoneS"), run("scan-lmc-s-y", Y.id, Y.anon, "PhoneT")]));
    ck(both.threw === null, `[٧] التحليلان المتزامنان نجحا: ${both.threw && both.threw.message}`);
    const spX = await protocolOf("scan-lmc-s-x");
    const spY = await protocolOf("scan-lmc-s-y");
    cdeq([spX.linkState, spY.linkState].sort(), ["active", "missing"], "[٧] واحدة active وواحدة missing");
    const winner = spX.linkState === "active" ? {sp: spX, expected: MATCH} : {sp: spY, expected: MISMATCH};
    const loser = spX.linkState === "active" ? spY : spX;
    ceq(winner.sp.linkModelCheck, winner.expected, `[٧] الفائزة تحمل حالتها من طرازها (${winner.expected})`);
    ceq(loser.linkModelCheck, null, "[٧] والخاسرة (الهدف ضاع) linkModelCheck = null");
    ceq(both.texts.filter((t) => t.includes("maintenance pair linked")).length, 1, "[٧] سطر «رُبط» واحد");
    ceq(both.texts.filter((t) => t.includes("scanProtocol notes=LINK_MODEL_")).length, winner.expected === MISMATCH ? 1 : 0, "[٧] وسطر ملاحظة الطراز للفائزة غير المطابقة وحدها");
  });

  // ═══ ٨ — أمان البيانات: لا حذف ═══
  await scene("٨ لا حذف", async () => {
    for (const id of ["scan-lmc-a1", "scan-lmc-a2", "scan-lmc-b1", "scan-lmc-b2"]) ck((await getDoc("reports", id)).exists && (await getDoc("scanProtocol", id)).exists, `[٨] ${id}: التقرير وscanProtocol باقيان`);
  });

  if (failures.length > 0) {
    console.error(`\nlinkModelCheck.e2e.test.js: ${failures.length} FAILED of ${n}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    await admin.app().delete().catch(() => {});
    process.exit(1);
  }
  console.log(`linkModelCheck.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
