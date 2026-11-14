// E2E test: إعفاء فحص «بعد» (maintenance_after) من خصم الفحصة في مرحلة الجمع (ق10، قرار المستخدم عبر حسن: «نطاق إعفاء الخصم يتبع س٢٠: البارد، فحص «بعد»، المرتجع. المنفَّذ البارد وحده»؛ أمر المنسّق 2026-10-23:
// «أضِف إعفاء maintenance_after إن سمحت آلية PROTOCOL_EXEMPT القائمة بتغيير صغير آمن؛ المرتجع لا يُبنى؛ واقرأ مسار الخصم كلّه وأثبت أنّ فحصَي normal وbefore لا يتأثّران»). المعالجات الحقيقية createScanSession وsetSessionPurpose
// وjoinScanSession وanalyzeDevice عبر `.run()` على محاكي Firestore. **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل. الفحص حمولة fv67 الذهبية الحقيقية (طلب 1.0.10).
//
// ما يثبته (الخصم الفعلي: رصيد المالك قبل/بعد):
//   ١ «بعد» في مرحلة الجمع (collectionPhase=true): لا خصم، scanProtocol.creditExemption = PROTOCOL_EXEMPT وscanPurpose = maintenance_after، وسطر الإعفاء المسمّى، وتقرير مكتمل وجلسة completed؛ ولا يُشترط رصيد ≥ 1
//      (محلّ استُنفد رصيده بفحص «قبل» يُكمل «بعده»)، وحجز قديم محمول على القفل يُعاد لصاحبه.
//   ٢ **ما لا يتأثّر (القاعدة 18: مقارنة قبل/بعد):** normal وmaintenance_before وفحص بلا جلسة، ومع collectionPhase=true، يُخصم منها فحصة واحدة بلا إعفاء — كما قبل التغيير؛ وبرصيد 0 يُرفض الاثنان بالبوّابة القائمة SHOP_NO_CREDIT.
//   ٣ «بعد» بلا علَم مرحلة الجمع الصريح (false · غائب · نصّ «true» · مستند الإعدادات غائب): يُخصم كأيّ فحص، وبرصيد 0 يُرفض بالبوّابة.
//   ٤ التكرار البارد على حاله (يبقى معفىً) والساخن يُخصم — لا تداخل بين الإعفاءين.
//   ٥ لا معرّف خامّ في أيّ سطر سجلّ جديد.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/afterScanCreditExemption.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

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

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {startRepeatScan} = require("../src/sessions/repeatScanCalls");
const {clearCacheConfigCache} = require("../src/utils/resolveCacheConfig");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const REQUEST_FILE = path.join(__dirname, "fixtures", "golden", "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json");
const BASE_FINGERPRINT = JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8")).fingerprint;
let fpSeq = 0;
/** نسخة من حمولة الفحص الذهبية بحرارة بدء معلومة (undefined ⟵ المفتاح يُحذف) ومفتاح جهاز فريد (فلا يلتقي ملفّ جهاز مشترك بين المشاهد). */
function fp(temp) {
  const f = JSON.parse(JSON.stringify(BASE_FINGERPRINT));
  if (temp === undefined) delete f.timeSeries.header.batteryTempStart;
  else f.timeSeries.header.batteryTempStart = temp;
  const key = `ase-${++fpSeq}-${Date.now()}`;
  f.device.deviceProfileKey = {primary: `prim-${key}`, layerA_keystore: `ks-${key}`, layerB_firebaseId: `fid-${key}`, layerC_androidId: `aid-${key}`, layerD_buildSig: `bs-${key}`, layerE_sensorSig: `ss-${key}`};
  return f;
}

const DAY = 24 * 3600 * 1000;
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const credit = async (uid) => (await getDoc("users", uid)).data().scansRemaining;
const seedOwner = (uid, extra = {}) => {
  const d = {scansRemaining: 500, scansTotal: 500, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), protocolParts: {purposes: true, batteryBeforeAfter: true, coldRepeat: true}, ...extra};
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return db.collection("users").doc(uid).set(d);
};
const setSettings = (fields) => db.collection("protocolSettings").doc("current").set(fields);
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn) {
  const cap = capture();
  let r;
  try {
    r = await settle(fn());
  } finally {
    cap.restore();
  }
  return {ret: r.ok ? r.value : null, threw: r.ok ? null : r.error, texts: cap.lines};
}
const create = (uid) => call(() => createScanSession.run({data: {}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const join = (code, uid) => call(() => joinScanSession.run({data: {code}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const setPurpose = (uid, sessionId, purpose) => call(() => setSessionPurpose.run({
  data: {sessionId, purpose, ...(purpose.startsWith("maintenance_") ? {defectType: "BATTERY"} : {})}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}},
}));
const analyze = (scanId, sessionId, uid, fingerprint) => call(() => analyzeDevice.run({
  data: {scanId, fingerprint, ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf(sessionId ? "anonymous" : "google.com")}, rawRequest: {headers: {}},
}));
const startRepeat = (uid, d) => call(() => startRepeatScan.run({data: d, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
let scanSeq = 0;
const newScanId = (tag) => `scan-ase-${tag}-${++scanSeq}-${Date.now()}`;
const exemptLine = (texts) => texts.filter((t) => t.startsWith("[analyzeDevice] credit exempt (PROTOCOL_EXEMPT) scanId="));

/** جلسة حقيقية: createScanSession ← (setSessionPurpose) ← joinScanSession. تعيد المعرّفات. */
async function session({owner, joiner, purpose = null}) {
  const created = await create(owner);
  assert.ok(created.threw === null, `إنشاء الجلسة: ${created.threw && created.threw.message}`);
  if (purpose !== null) {
    const p = await setPurpose(owner, created.ret.sessionId, purpose);
    assert.ok(p.threw === null, `اختيار الغرض ${purpose}: ${p.threw && p.threw.message}`);
  }
  const joined = await join(created.ret.code, joiner);
  assert.ok(joined.threw === null, `الانضمام: ${joined.threw && joined.threw.message}`);
  return {sessionId: created.ret.sessionId};
}

(async () => {
  clearCacheConfigCache();
  const OWN = "own-ase-1";
  const PHONE = "phone-ase-1";
  await seedOwner(OWN);
  await setSettings({version: 40, repeatRate: 1, collectionPhase: true});

  // ═══ ١ — «بعد» في مرحلة الجمع: معفى ═══
  {
    const s = await session({owner: OWN, joiner: PHONE, purpose: "maintenance_after"});
    const before = await credit(OWN);
    modelCalls = 0;
    const scanId = newScanId("after");
    const a = await analyze(scanId, s.sessionId, PHONE, fp(33.0));
    ok(a.threw === null, `[١] التحليل نجح (${a.threw && a.threw.message})`);
    eq(await credit(OWN), before, "[١] **لا خصم**: رصيد المالك لم يتغيّر (فحص «بعد» في مرحلة الجمع)");
    const sp = await data("scanProtocol", scanId);
    deq([sp.scanPurpose, sp.creditExemption], ["maintenance_after", "PROTOCOL_EXEMPT"], "[١] scanProtocol: الغرض maintenance_after والإعفاء PROTOCOL_EXEMPT مكتوبان");
    eq(sp.settingsVersion, 40, "[١] settingsVersion من الإعدادات الحيّة");
    ok(await exists("reports", scanId) && await exists("reportRaw", scanId), "[١] والتقرير والخامّ مكتوبان");
    eq((await data("scanSessions", s.sessionId)).status, "completed", "[١] والجلسة اكتملت");
    eq(modelCalls, 1, "[١] نداء نموذج واحد");
    const lines = exemptLine(a.texts);
    eq(lines.length, 1, "[١] سطر إعفاء مسمّى واحد");
    ok(lines[0].endsWith("no reservation, no charge carriedReservationReleased=false"), `[١] السطر بلا حجز ولا خصم — ${lines[0]}`);
    ok(!a.texts.join("\n").includes(scanId) && !a.texts.join("\n").includes(s.sessionId) && !a.texts.join("\n").includes(PHONE) && !a.texts.join("\n").includes(OWN), "[١] لا معرّف خامّ في أيّ سطر");
    ok(!(await exists("scanClaims", scanId)), "[١] والقفل مُحي في finally كعادته");
  }
  // ١-ب: رصيد صفر: «بعد» المعفى يمرّ، ولا يصير سالباً
  {
    const owner = "own-ase-zero";
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-ase-zero", purpose: "maintenance_after"});
    await db.collection("users").doc(owner).update({scansRemaining: 0});
    const a = await analyze(newScanId("zero"), s.sessionId, "phone-ase-zero", fp(33.0));
    ok(a.threw === null, `[١] رصيد 0: «بعد» المعفى يمرّ (${a.threw && a.threw.message})`);
    eq(await credit(owner), 0, "[١] والرصيد باقٍ 0 (لا يصير سالباً)");
  }
  // ١-ج: حجز قديم محمول على قفل المعرّف نفسه ثم صار الفحص معفىً: يُعاد لصاحبه
  {
    const owner = "own-ase-carry";
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-ase-carry", purpose: "maintenance_after"});
    const scanId = newScanId("carry");
    await db.collection("users").doc(owner).update({scansRemaining: admin.firestore.FieldValue.increment(-1)});
    const creditBefore = await credit(owner);
    await db.collection("scanClaims").doc(scanId).set({
      scanId, userId: owner, claimedAtMs: Date.now() - 400000, sessionId: s.sessionId,
      reservation: {userId: owner, isFreeTrial: false, deviceFP: null, reservedAtMs: Date.now() - 400000},
    });
    const a = await analyze(scanId, s.sessionId, "phone-ase-carry", fp(33.0));
    ok(a.threw === null, `[١] قفل قديم حامل حجزاً: نجح (${a.threw && a.threw.message})`);
    eq(await credit(owner), creditBefore + 1, "[١] الحجز القديم أُعيد لصاحبه (+1) ثم لم تُخصم فحصة (معفى)");
    ok(a.texts.some((x) => x.endsWith("no reservation, no charge carriedReservationReleased=true")), "[١] وسطر الإعفاء يعلن carriedReservationReleased=true");
  }

  // ═══ ٢ — ما لا يتأثّر: normal وmaintenance_before وبلا جلسة يُخصمون بلا إعفاء (collectionPhase=true) ═══
  for (const [label, purpose] of [["normal (الغرض الافتراضي)", null], ["normal مختاراً", "normal"], ["maintenance_before", "maintenance_before"]]) {
    const owner = `own-ase-un-${label.replace(/\W/g, "") || "x"}`;
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-" + owner, purpose});
    const before = await credit(owner);
    const scanId = newScanId("un");
    const a = await analyze(scanId, s.sessionId, "phone-" + owner, fp(33.0));
    ok(a.threw === null, `[٢] ${label}: التحليل نجح (${a.threw && a.threw.message})`);
    eq(await credit(owner), before - 1, `[٢] ${label}: **تُخصم فحصة واحدة** (لا إعفاء مع collectionPhase=true — كما قبل التغيير)`);
    const sp = await data("scanProtocol", scanId);
    eq(sp.creditExemption, null, `[٢] ${label}: creditExemption=null`);
    eq(exemptLine(a.texts).length, 0, `[٢] ${label}: ولا سطر إعفاء`);
  }
  {
    const owner = "own-ase-nosession";
    await seedOwner(owner);
    const before = await credit(owner);
    const scanId = newScanId("nosession");
    const a = await analyze(scanId, null, owner, fp(33.0));
    ok(a.threw === null, `[٢] فحص شخصي بلا جلسة: نجح (${a.threw && a.threw.message})`);
    eq(await credit(owner), before - 1, "[٢] فحص بلا جلسة: تُخصم فحصة (الإعفاء لفحص جلسة وحدها)");
    eq((await data("scanProtocol", scanId)).creditExemption, null, "[٢] فحص بلا جلسة: creditExemption=null");
  }
  // ٢-ب: برصيد 0 يُرفض normal وbefore بالبوّابة القائمة (البوّابة لم تُمسّ)
  for (const [label, purpose] of [["normal", null], ["maintenance_before", "maintenance_before"]]) {
    const owner = `own-ase-zerogate-${label}`;
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-" + owner, purpose});
    await db.collection("users").doc(owner).update({scansRemaining: 0});
    const scanId = newScanId("zg");
    const a = await analyze(scanId, s.sessionId, "phone-" + owner, fp(33.0));
    ok(a.threw !== null && a.threw.details && a.threw.details.reasonCode === "SHOP_NO_CREDIT", `[٢] ${label} برصيد 0: يُرفض بالبوّابة القائمة SHOP_NO_CREDIT (${a.threw && a.threw.message})`);
    ok(!(await exists("reports", scanId)) && !(await exists("scanProtocol", scanId)), `[٢] ${label} برصيد 0: لا تقرير ولا بروتوكول`);
    eq(await credit(owner), 0, `[٢] ${label} برصيد 0: الرصيد 0`);
  }

  // ═══ ٣ — «بعد» بلا علَم مرحلة الجمع الصريح: يُخصم كأيّ فحص ═══
  let phaseSeq = 0;
  for (const [label, settings] of [
    ["collectionPhase false", {version: 41, repeatRate: 1, collectionPhase: false}],
    ["collectionPhase غائب", {version: 42, repeatRate: 1}],
    ["collectionPhase نصّ «true»", {version: 43, repeatRate: 1, collectionPhase: "true"}],
  ]) {
    phaseSeq++;
    await setSettings(settings);
    const owner = `own-ase-phase-${phaseSeq}`;
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-" + owner, purpose: "maintenance_after"});
    const before = await credit(owner);
    const scanId = newScanId("ph");
    const a = await analyze(scanId, s.sessionId, "phone-" + owner, fp(33.0));
    ok(a.threw === null, `[٣] ${label}: التحليل نجح (${a.threw && a.threw.message})`);
    eq(await credit(owner), before - 1, `[٣] ${label}: تُخصم فحصة (الإعفاء لا يقوم إلا على collectionPhase=true صريحة)`);
    const sp = await data("scanProtocol", scanId);
    deq([sp.scanPurpose, sp.creditExemption], ["maintenance_after", null], `[٣] ${label}: maintenance_after بلا إعفاء`);
  }
  {
    // مستند إعدادات موجود بلا version صالح (كتابة يدوية على المحاكي): يُقرأ غائباً (protocolSettings.js) فلا collectionPhase ولا إعفاء
    await db.collection("protocolSettings").doc("current").set({});
    const owner = "own-ase-nosettings";
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-" + owner, purpose: "maintenance_after"});
    const before = await credit(owner);
    const a = await analyze(newScanId("ns"), s.sessionId, "phone-" + owner, fp(33.0));
    ok(a.threw === null, `[٣] مستند إعدادات بلا version: التحليل نجح`);
    eq(await credit(owner), before - 1, "[٣] مستند إعدادات غير صالح: تُخصم فحصة (لا إعفاء)");
  }
  {
    // «بعد» بلا إعفاء برصيد 0: يُرفض بالبوّابة
    await setSettings({version: 44, repeatRate: 1, collectionPhase: false});
    const owner = "own-ase-phase-zero";
    await seedOwner(owner);
    const s = await session({owner, joiner: "phone-" + owner, purpose: "maintenance_after"});
    await db.collection("users").doc(owner).update({scansRemaining: 0});
    const a = await analyze(newScanId("pz"), s.sessionId, "phone-" + owner, fp(33.0));
    ok(a.threw !== null && a.threw.details && a.threw.details.reasonCode === "SHOP_NO_CREDIT", `[٣] «بعد» برصيد 0 بلا مرحلة جمع: يُرفض SHOP_NO_CREDIT (${a.threw && a.threw.message})`);
  }

  // ═══ ٤ — التكرار البارد على حاله (معفىً) والساخن يُخصم ═══
  await setSettings({version: 45, repeatRate: 1, collectionPhase: true});
  for (const [label, childTemp, exempt] of [["بارد", 33.1, true], ["ساخن", 36.0, false]]) {
    const owner = `own-ase-rep-${label === "بارد" ? "cold" : "hot"}`;
    await seedOwner(owner);
    const p = await session({owner, joiner: "phone-" + owner});
    const parentScan = newScanId("rp");
    const pa = await analyze(parentScan, p.sessionId, "phone-" + owner, fp(32.8));
    ok(pa.threw === null, `[٤] ${label}: الفحص الأوّل نجح`);
    const st = await startRepeat("phone-" + owner, {sessionId: p.sessionId, scanId: parentScan});
    ok(st.threw === null, `[٤] ${label}: بدء التكرار (${st.threw && st.threw.message})`);
    const before = await credit(owner);
    const childScan = newScanId("rc");
    const a = await analyze(childScan, st.ret.sessionId, "phone-" + owner, fp(childTemp));
    ok(a.threw === null, `[٤] ${label}: الفحص الثاني نجح`);
    eq(await credit(owner), exempt ? before : before - 1, `[٤] ${label}: ${exempt ? "لا خصم (كما كان)" : "تُخصم فحصة (كما كان)"}`);
    eq((await data("scanProtocol", childScan)).creditExemption, exempt ? "PROTOCOL_EXEMPT" : null, `[٤] ${label}: creditExemption`);
  }

  console.log(`\nafterScanCreditExemption.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
