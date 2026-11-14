// E2E test: التكرار البارد والساخن — createScanSession وjoinScanSession وanalyzeDevice وstartRepeatScan وgetRepeatScanOffer الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-07، 2026-10-21 +03).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل. **وحقن الفشل** (لا يستبدل الطبقة: يمرّر الاستدعاء الحقيقي): غلاف على db.batch يسجّل مسارات set/update ويُفشل التزاماً واحداً
// (مشهد الذرّية). والعشوائية: Math.random تُثبَّت على قيمة معلومة حول analyzeDevice وحدها (مشهد حدّ القرعة)، وتُعاد فوراً. الفحص حمولة fv67 الذهبية الحقيقية (طلب 1.0.10) كما في deviceProfileKeyShapes.e2e.test.js —
// ترويستها تحمل batteryTempStart = 32.8 الحقيقية، وتُعدَّل نسخة منها لحرارة كل مشهد.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٤ (:596-681) وdocs/PROTOCOL_CONTRACT.md §٢ A4 (يحمل نصّها المقتبس وكل شكل سلك وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ الاختيار في analyzeDevice: سجلّ repeat في scanProtocol بكل حالاته (SELECTED · NOT_SELECTED · NOT_ELIGIBLE بأسبابها: إعدادات غائبة · جزء غير مفعَّل · غرض ليس normal · أمّ بلا joinedBy بكل أشكالها · نسبة غائبة/خارج المدى)،
//      وحدّ القرعة draw < rate، وsettingsVersion من الإعدادات الحيّة، وحرارة البدء الأولى (حاضرة · غائبة · صفر الحارس)، و«الهاتف بلا تكرار سابق» معلَن NOT_EVALUATED.
//   ٢ getRepeatScanOffer: المالك يجلبه فتنتقل SELECTED إلى PROMPT_DELIVERED، وغير المالك يقرأ بلا كتابة، وEXPIRED تُحسب عند القراءة ولا تُكتب، وlا ينطبق لغير المختار، والرفوض.
//   ٣ startRepeatScan: الجلسة الابنة (E41) والمعلَّق للابن وتحديث الأمّ في معاملة واحدة؛ كل حالة من REPEAT_STATE؛ الأمّ بلا joinedBy؛ سباق بدءين؛ المدخلات.
//   ٤ الفحص الثاني (الابن) على analyzeDevice الحقيقية: التصنيف بارد/ساخن/غير مصنَّف، والإعفاء PROTOCOL_EXEMPT للبارد وحده بمرحلة جمع true، والحجز/الخصم للباقي، وإعادة حجز عالق، ورصيد صفر، وتحديث الأمّ في الدفعة الذرّية نفسها،
//      وفشل الالتزام لا يترك شيئاً، ومنع الكاش وpreviousScan للابن (وbattery_after) مع تحكّم: العادي يُخبَّأ.
//   ٥ لا معرّف خامّ ولا قيمة حرارة في أيّ سطر سجلّ جديد، ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/repeatScan.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد، معدودٌ. (القاعدة 9: لا طلب شبكة نحو مزوّد؛ أيّ عنوان آخر يُرمى.)
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
const {startRepeatScan, getRepeatScanOffer} = require("../src/sessions/repeatScanCalls");
const {recordScanConsent} = require("../src/sessions/recordScanConsent"); // (ق14) وراثة الابن موافقة الأمّ
const {clearCacheConfigCache} = require("../src/utils/resolveCacheConfig");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// حقن الفشل: غلاف على db.batch: يسجّل مسار كل set/update، ويُفشل التزاماً واحداً حين يُفعَّل.
let failNextCommit = false;
let injectedCommit = 0;
let batchOps = [];
const realBatch = db.batch.bind(db);
db.batch = () => {
  const b = realBatch();
  const set = b.set.bind(b);
  const update = b.update.bind(b);
  const commit = b.commit.bind(b);
  const mine = [];
  b.set = (ref, ...rest) => { mine.push(`set ${ref.path}`); return set(ref, ...rest); };
  b.update = (ref, ...rest) => { mine.push(`update ${ref.path}`); return update(ref, ...rest); };
  b.commit = async () => {
    batchOps.push(mine.slice());
    if (failNextCommit && mine.some((p) => p.startsWith("set reports/"))) {
      failNextCommit = false;
      injectedCommit++;
      throw Object.assign(new Error("injected batch commit failure"), {code: 7});
    }
    return commit();
  };
  return b;
};

const REQUEST_FILE = path.join(__dirname, "fixtures", "golden", "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json");
const BASE_FINGERPRINT = JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8")).fingerprint;
let fpSeq = 0;
/** نسخة من حمولة الفحص الذهبية بحرارة بدء معلومة (undefined ⟵ المفتاح يُحذف) ومفتاح جهاز فريد (فلا يلتقي ملفّ جهاز مشترك بين المشاهد). */
function fp(temp, {sharedKey = null} = {}) {
  const f = JSON.parse(JSON.stringify(BASE_FINGERPRINT));
  if (temp === undefined) delete f.timeSeries.header.batteryTempStart;
  else f.timeSeries.header.batteryTempStart = temp;
  const key = sharedKey || `rpt-${++fpSeq}-${Date.now()}`;
  f.device.deviceProfileKey = {primary: `prim-${key}`, layerA_keystore: `ks-${key}`, layerB_firebaseId: `fid-${key}`, layerC_androidId: `aid-${key}`, layerD_buildSig: `bs-${key}`, layerE_sensorSig: `ss-${key}`};
  return f;
}

const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const PAST = (m = 10) => new Date(Date.now() - m * MIN);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const credit = async (uid) => (await getDoc("users", uid)).data().scansRemaining;
const seedOwner = (uid, extra = {}) => {
  const d = {scansRemaining: 500, scansTotal: 500, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), protocolParts: {coldRepeat: true}, ...extra};
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k]; // «بلا الحقل» لا «الحقل undefined» (Firestore يرفض undefined)
  return db.collection("users").doc(uid).set(d);
};
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const seedProtocol = (scanId, repeat) => db.collection("scanProtocol").doc(scanId).set({repeat});
const setSettings = (fields) => db.collection("protocolSettings").doc("current").set(fields);
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn, {random = null} = {}) {
  const cap = capture();
  const realRandom = Math.random;
  if (random !== null) Math.random = () => random;
  let r;
  try {
    r = await settle(fn());
  } finally {
    Math.random = realRandom;
    cap.restore();
  }
  return {ret: r.ok ? r.value : null, threw: r.ok ? null : r.error, lines: cap.lines, texts: cap.texts()};
}
const create = (uid) => call(() => createScanSession.run({data: {}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const join = (code, uid) => call(() => joinScanSession.run({data: {code}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
// (2026-10-22، A2) maintenance_* تحمل نوع عطل (BATTERY هنا): battery_* لم تعد مما يُختار (القاعدة 23: كانت المشاهد تختارهما).
const setPurpose = (uid, sessionId, purpose) => call(() => setSessionPurpose.run({data: {sessionId, purpose, ...(typeof purpose === "string" && purpose.startsWith("maintenance_") ? {defectType: "BATTERY"} : {})}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
// (ق31، أقرّه حسن 2026-10-22؛ القاعدة 23) setSessionPurpose صار يرفض maintenance_* لمحلّ بلا الجزأين purposes وbatteryBeforeAfter؛ وهذا الملفّ يثبّت التكرار لا فحص الجزء، فيُفعَّل الجزآن للمحلّ وقت نداء الاختيار وحده ثم يُعاد ما كان (false) كي لا يتغيّر مصدر الغرض الافتراضي لباقي الجلسات.
const setPurposeWithParts = async (uid, sessionId, purpose) => {
  const ref = db.collection("users").doc(uid);
  await ref.update({"protocolParts.purposes": true, "protocolParts.batteryBeforeAfter": true});
  try { return await setPurpose(uid, sessionId, purpose); } finally { await ref.update({"protocolParts.purposes": false, "protocolParts.batteryBeforeAfter": false}); }
};
const analyze = (scanId, sessionId, uid, fingerprint, opts) => call(() => analyzeDevice.run({
  data: {scanId, fingerprint, ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf(sessionId ? "anonymous" : "google.com")}, rawRequest: {headers: {}},
}), opts);
const startRepeat = (uid, d, authOverride) => call(() => startRepeatScan.run({data: d, auth: authOverride === undefined ? {uid, token: tokenOf("anonymous")} : authOverride, rawRequest: {headers: {}}}));
const offer = (uid, d, authOverride) => call(() => getRepeatScanOffer.run({data: d, auth: authOverride === undefined ? {uid, token: tokenOf("anonymous")} : authOverride, rawRequest: {headers: {}}}));
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
let scanSeq = 0;
const newScanId = (tag) => `scan-rpt-${tag}-${++scanSeq}-${Date.now()}`;

function expectRefusal(label, r, {fn, code, message, reasonCode, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, fn).filter((t) => t.startsWith(`[${fn}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${fn}] refused reason=${logReason}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${logReason}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return lines[0];
}
const START = "startRepeatScan";
const OFFER = "getRepeatScanOffer";
const TECH = (reason) => ({code: "failed-precondition", message: reason, reasonCode: reason});
const PAIR_GONE = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "REPEAT_PAIR_NOT_FOUND"};

/** فحص أوّل بجلسة حقيقية: createScanSession ← joinScanSession ← analyzeDevice. يعيد المعرّفات والردود. */
async function parentScan({owner, joiner, temp = 32.8, tag = "p", prepare = null, random = null, fingerprint = null}) {
  const created = await create(owner);
  assert.ok(created.threw === null, `إنشاء الجلسة: ${created.threw && created.threw.message}`);
  const sessionId = created.ret.sessionId;
  if (prepare) await prepare(sessionId);
  const joined = await join(created.ret.code, joiner);
  assert.ok(joined.threw === null, `الانضمام: ${joined.threw && joined.threw.message}`);
  const scanId = newScanId(tag);
  const a = await analyze(scanId, sessionId, joiner, fingerprint || fp(temp === null ? undefined : temp), {random}); // temp = null ⟵ حرارة البدء غائبة من الترويسة (undefined تُستبدل بالافتراضي)
  assert.ok(a.threw === null, `التحليل: ${a.threw && a.threw.message}`);
  return {sessionId, scanId, analyze: a, created};
}

(async () => {
  const OWN = "own-rpt-1";
  const PHONE = "phone-rpt-1";
  await seedOwner(OWN);

  // ═══ ١ — الاختيار في analyzeDevice ═══
  // ١-أ: إعدادات غائبة ⟵ NOT_ELIGIBLE: SETTINGS_ABSENT (P:893: لا يُفترض 10%)
  {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "absent"});
    const sp = await data("scanProtocol", p.scanId);
    deq(Object.keys(sp).sort(), ["consent", "createdAt", "creditExemption", "defectType", "linkMethod", "linkModelCheck", "linkState", "linkedScanId", "pair", "protocolVersion", "purposeSource", "repeat", "repeatClassification", "repeatOf", "scanPurpose", "settingsVersion"], "[١] مستند scanProtocol: ستّة عشر حقلاً بالضبط (الاثنا عشر ومعها consent من S-P6-12، ثم defectType وpair من أمر الصيانة 2026-10-22، ثم linkModelCheck من ق36 أ 2026-10-22 — استُبدل اختبار الخمسة عشر: القاعدة 23)");
    deq(sp.repeat.state, "NOT_ELIGIBLE", "[١] لا إعدادات ⟵ NOT_ELIGIBLE");
    deq([sp.repeat.reason, sp.repeat.draw, sp.repeat.rate, sp.repeat.settingsVersion, sp.settingsVersion], ["SETTINGS_ABSENT", null, null, "SETTINGS_ABSENT", "SETTINGS_ABSENT"], "[١] السبب SETTINGS_ABSENT، ولا قرعة (draw وrate null: لا صفراً يشبه سحباً)، والنسخة SETTINGS_ABSENT");
    ok(TS(sp.repeat.decidedAt), "[١] decidedAt وقت الخادم");
    deq(sp.repeat.priorRepeatCheck, {state: "NOT_EVALUATED", reason: "DEVICE_IDENTITY_UNAVAILABLE"}, "[١] «الهاتف بلا تكرار سابق مكتمل» معلَن NOT_EVALUATED (هويّة الجهاز غائبة: معلّق S-P6-01)");
    deq([sp.repeat.firstScanStartTemp, sp.repeatOf, sp.repeatClassification, sp.creditExemption], [null, null, null, null], "[١] غير المختار: حرارة البدء وrepeatOf وrepeatClassification وcreditExemption كلّها null («لا ينطبق»)");
    ok(await exists("reports", p.scanId) && await exists("reportRaw", p.scanId), "[١] والتقرير والخامّ حاضران (الاختيار لا يمسّ الفحص)");
    const lines = named(p.analyze.texts, "analyzeDevice").filter((t) => t.includes("scanProtocol repeat"));
    deq(lines, ["[analyzeDevice] scanProtocol repeat state=NOT_ELIGIBLE reason=SETTINGS_ABSENT settingsVersion=SETTINGS_ABSENT"], "[١] سطر مسمّى للاختيار بلا معرّف ولا حرارة");
    note("analyzeDevice — الاختيار", lines);
  }

  // ١-ب: إعدادات حاضرة: نسبة 1 ⟵ SELECTED؛ حرارة البدء الأولى تُنسخ؛ settingsVersion من الإعدادات
  await setSettings({version: 3, repeatRate: 1, collectionPhase: true});
  let selected;
  {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "sel", temp: 32.8});
    selected = p;
    const sp = await data("scanProtocol", p.scanId);
    deq([sp.repeat.state, sp.repeat.reason, sp.repeat.rate, sp.repeat.settingsVersion, sp.settingsVersion], ["SELECTED", null, 1, 3, 3], "[١] نسبة 1 ⟵ SELECTED، وsettingsVersion 3 في السجلّ وفي المستند (استُبدل الثابت: القاعدة 23)");
    ok(typeof sp.repeat.draw === "number" && sp.repeat.draw >= 0 && sp.repeat.draw < 1, "[١] draw رقم في [0,1) مخزَّن خامّاً (فالسحب يُعاد حسابه)");
    deq(sp.repeat.firstScanStartTemp, {state: "PRESENT", valueC: 32.8}, "[١] حرارة البدء الأولى من الترويسة الحقيقية 32.8 تُنسخ في السجلّ");
    deq(sp.repeat.priorRepeatCheck, {state: "NOT_EVALUATED", reason: "DEVICE_IDENTITY_UNAVAILABLE"}, "[١] وحالة «لا سابق مكتمل» غير مقيَّمة");
    deq([sp.scanPurpose, sp.purposeSource], ["normal", "feature_disabled"], "[١] غرض الفحص الأصلي لم يتغيّر (normal، ومصدره كما في createScanSession)");
    eq((await data("scanSessions", p.sessionId)).status, "completed", "[١] والجلسة اكتملت كما كانت");
    ok(!p.analyze.texts.join("\n").includes("32.8"), "[١] لا قيمة حرارة في أيّ سطر سجلّ");
  }
  // ١-ج: حدّ القرعة draw < rate، بقيمة معلومة
  await setSettings({version: 4, repeatRate: 0.25});
  for (const [draw, want] of [[0.2499, "SELECTED"], [0.25, "NOT_SELECTED"], [0, "SELECTED"], [0.9999, "NOT_SELECTED"]]) {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "draw", random: draw});
    const sp = await data("scanProtocol", p.scanId);
    deq([sp.repeat.state, sp.repeat.draw, sp.repeat.rate, sp.repeat.settingsVersion], [want, draw, 0.25, 4], `[١] draw=${draw} مع rate=0.25 ⟵ ${want} (الاختيار draw < rate)، والسحب والنسبة والنسخة مخزَّنة`);
    deq(sp.repeat.firstScanStartTemp, want === "SELECTED" ? {state: "PRESENT", valueC: 32.8} : null, `[١] وحرارة البدء ${want === "SELECTED" ? "تُنسخ للمختار" : "null لغيره"}`);
  }
  await setSettings({version: 5, repeatRate: 0});
  {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "r0", random: 0});
    const sp = await data("scanProtocol", p.scanId);
    deq([sp.repeat.state, sp.repeat.rate, sp.repeat.draw], ["NOT_SELECTED", 0, 0], "[١] نسبة 0 لا تختار أبداً ولو draw = 0 (وتُخزَّن 0 لا null: القرعة جرت)");
  }
  // ١-د: الأسباب
  {
    await setSettings({version: 6});
    const noRate = await parentScan({owner: OWN, joiner: PHONE, tag: "norate"});
    deq([(await data("scanProtocol", noRate.scanId)).repeat.reason, (await data("scanProtocol", noRate.scanId)).repeat.settingsVersion], ["RATE_ABSENT", 6], "[١] إعدادات حاضرة بلا repeatRate ⟵ RATE_ABSENT (حالة غير SETTINGS_ABSENT) بنسخة 6");
    for (const bad of [2, -0.5, "0.25", NaN]) {
      await setSettings({version: 7, repeatRate: bad});
      const p = await parentScan({owner: OWN, joiner: PHONE, tag: "badrate"});
      eq((await data("scanProtocol", p.scanId)).repeat.reason, "RATE_INVALID", `[١] repeatRate ${JSON.stringify(bad)} ⟵ RATE_INVALID`);
    }
    // مستند إعدادات بلا version صالح: يُقرأ غائباً ويُعلَن
    await setSettings({repeatRate: 1});
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "nover"});
    deq([(await data("scanProtocol", p.scanId)).repeat.reason, (await data("scanProtocol", p.scanId)).settingsVersion], ["SETTINGS_ABSENT", "SETTINGS_ABSENT"], "[١] مستند إعدادات بلا version ⟵ يُقرأ غائباً (SETTINGS_ABSENT)");
    ok(p.analyze.texts.includes("[analyzeDevice] protocolSettings document present but unusable anomaly=VERSION_UNUSABLE — read as SETTINGS_ABSENT"), "[١] وشذوذه يُعلَن بسطر مسمّى (لا يُسكَت عنه)");
    await setSettings({version: 8, repeatRate: 1, collectionPhase: true});
    // الجزء غير مفعَّل
    for (const [label, parts] of [["بلا protocolParts", undefined], ["coldRepeat false", {coldRepeat: false}], ["coldRepeat نصّ", {coldRepeat: "true"}], ["جزء آخر وحده", {purposes: true}]]) {
      const uid = `own-rpt-part-${label.length}`;
      await seedOwner(uid, {protocolParts: parts});
      const q = await parentScan({owner: uid, joiner: PHONE, tag: "part"});
      eq((await data("scanProtocol", q.scanId)).repeat.reason, "PART_NOT_ENABLED", `[١] ${label} ⟵ PART_NOT_ENABLED`);
    }
    // الغرض ليس normal
    for (const purpose of ["maintenance_before", "maintenance_after"]) {
      const q = await parentScan({owner: OWN, joiner: PHONE, tag: "purpose", prepare: async (id) => { const r = await setPurposeWithParts(OWN, id, purpose); assert.ok(r.threw === null); }});
      const sp = await data("scanProtocol", q.scanId);
      deq([sp.scanPurpose, sp.repeat.state, sp.repeat.reason], [purpose, "NOT_ELIGIBLE", "PURPOSE_NOT_NORMAL"], `[١] غرض ${purpose} ⟵ NOT_ELIGIBLE: PURPOSE_NOT_NORMAL`);
    }
    // فحص بلا جلسة
    {
      const scanId = newScanId("nosession");
      const a = await analyze(scanId, null, OWN, fp(32.8));
      ok(a.threw === null, "[١] فحص المالك جهازه بلا جلسة نجح");
      const sp = await data("scanProtocol", scanId);
      deq([sp.scanPurpose, sp.repeat.state, sp.repeat.reason], ["NO_SESSION", "NOT_ELIGIBLE", "PURPOSE_NOT_NORMAL"], "[١] بلا جلسة ⟵ NO_SESSION وغير مؤهَّل (لا جهاز فنّي يعرض)");
    }
    // الأمّ بلا joinedBy: كل شكل (E44)
    let k = 0;
    for (const [label, joinedBy] of [["غائب", undefined], ["null", null], ["فارغ", ""]]) {
      const sessionId = `sess-rpt-nojoin-${++k}`;
      await seedSession(sessionId, {ownerId: OWN, status: "scanning", expiresAt: FUTURE(), scanId: null, deviceModel: null, purpose: "normal", ...(joinedBy === undefined ? {} : {joinedBy})});
      await db.collection("protocolPending").doc(sessionId).set({purposeSource: "default"});
      const scanId = newScanId("nojoin");
      const a = await analyze(scanId, sessionId, "someone", fp(32.8));
      ok(a.threw === null, `[١] فحص جلسة joinedBy ${label} نجح (الفحص لا يتأثّر)`);
      const sp = await data("scanProtocol", scanId);
      deq([sp.repeat.state, sp.repeat.reason], ["NOT_ELIGIBLE", "PARENT_JOINER_UNKNOWN"], `[١] joinedBy ${label} ⟵ NOT_ELIGIBLE: PARENT_JOINER_UNKNOWN (E44: يُخفى العرض، لا تُختار SELECTED ولو كانت النسبة 1)`);
    }
    // حرارة البدء الأولى للمختار: كل حالة
    for (const [label, temp, want] of [["غائبة", null, {state: "ABSENT", valueC: null}], ["صفر الحارس", 0, {state: "SENTINEL_ZERO", valueC: 0}], ["38.5", 38.5, {state: "PRESENT", valueC: 38.5}]]) {
      const q = await parentScan({owner: OWN, joiner: PHONE, tag: "temp", temp});
      const sp = await data("scanProtocol", q.scanId);
      deq([sp.repeat.state, sp.repeat.firstScanStartTemp], ["SELECTED", want], `[١] حرارة البدء ${label}: يُختار ويُخزَّن المرجع بحالته (الغياب يُعلَن عند التصنيف لا هنا)`);
    }
  }

  // ═══ ٢ — getRepeatScanOffer ═══
  await setSettings({version: 9, repeatRate: 1, collectionPhase: true});
  let pairA;
  {
    pairA = await parentScan({owner: OWN, joiner: PHONE, tag: "offer"});
    const {sessionId, scanId} = pairA;
    // غير المالك (الجهاز المفحوص) يقرأ بلا كتابة
    const before = await data("scanProtocol", scanId);
    const rJ = await offer(PHONE, {sessionId, scanId});
    ok(rJ.threw === null, `[٢] الجهاز المفحوص يجلب العرض (${rJ.threw && rJ.threw.message})`);
    deq(rJ.ret, {sessionId, scanId, state: "SELECTED", reason: null, firstScanStartTemp: {state: "PRESENT", valueC: 32.8}, childSessionId: null, childStatus: null}, "[٢] ردّ العرض: الحالة وحرارة البدء الأولى (للشريط نحو الهدف) ومعرّف الابن null");
    deq(Object.keys(rJ.ret), ["sessionId", "scanId", "state", "reason", "firstScanStartTemp", "childSessionId", "childStatus"], "[٢] سبعة مفاتيح بالضبط");
    deq(await data("scanProtocol", scanId), before, "[٢] غير المالك: لا كتابة (الحالة SELECTED باقية)");
    eq(named(rJ.texts, OFFER)[0], `[${OFFER}] served session=${sid(sessionId)} caller=${sid(PHONE)} role=other state=SELECTED delivered=false reference=PRESENT`, "[٢] سطر الخدمة: مُهشَّر، بلا حرارة");
    // المالك (جهاز الفنّي): SELECTED ⟵ PROMPT_DELIVERED
    const rO = await offer(OWN, {sessionId, scanId}, {uid: OWN, token: tokenOf("google.com")});
    eq(rO.ret.state, "PROMPT_DELIVERED", "[٢] المالك يجلبه ⟵ PROMPT_DELIVERED (حين يجلبه جهاز الفنّي: P:662)");
    eq(named(rO.texts, OFFER)[0], `[${OFFER}] served session=${sid(sessionId)} caller=${sid(OWN)} role=owner state=PROMPT_DELIVERED delivered=true reference=PRESENT`, "[٢] سطر الخدمة: role=owner وdelivered=true");
    const after = await data("scanProtocol", scanId);
    eq(after.repeat.state, "PROMPT_DELIVERED", "[٢] والمخزَّن PROMPT_DELIVERED");
    ok(TS(after.repeat.promptDeliveredAt), "[٢] ووقت التسليم من الخادم");
    deq({...after.repeat, state: "x", promptDeliveredAt: null}, {...before.repeat, state: "x", promptDeliveredAt: null}, "[٢] والباقي من سجلّ الاختيار لم يتغيّر");
    const stamp = after.repeat.promptDeliveredAt.toMillis();
    const rO2 = await offer(OWN, {sessionId, scanId}, {uid: OWN, token: tokenOf("google.com")});
    eq(rO2.ret.state, "PROMPT_DELIVERED", "[٢] جلب ثانٍ: الحالة نفسها");
    eq((await data("scanProtocol", scanId)).repeat.promptDeliveredAt.toMillis(), stamp, "[٢] ولا يُعاد ختم وقت التسليم");
    eq(named(rO2.texts, OFFER)[0].includes("delivered=false"), true, "[٢] وdelivered=false في الجلب الثاني");
    // الجهاز المفحوص بعد التسليم: يقرأ الحالة الحالية بلا كتابة
    eq((await offer(PHONE, {sessionId, scanId})).ret.state, "PROMPT_DELIVERED", "[٢] الجهاز المفحوص بعد التسليم يرى PROMPT_DELIVERED");
    // حامل الزوج غير الطرفين: التفويض بالزوج لا بالدور
    const rS = await offer("stranger-rpt", {sessionId, scanId}, {uid: "stranger-rpt", token: tokenOf("anonymous")});
    ok(rS.threw === null && rS.ret.state === "PROMPT_DELIVERED", "[٢] حامل الزوج ولو لم يكن طرفاً: يقرأ (التفويض بالزوج: P:641) ولا يكتب");
    note("getRepeatScanOffer — خدمة", [named(rO.texts, OFFER)[0], named(rJ.texts, OFFER)[0]]);
  }
  // غير المختار: لا ينطبق
  {
    await setSettings({version: 10, repeatRate: 0});
    const q = await parentScan({owner: OWN, joiner: PHONE, tag: "offer-ns"});
    const r = await offer(OWN, {sessionId: q.sessionId, scanId: q.scanId}, {uid: OWN, token: tokenOf("google.com")});
    deq(r.ret, {sessionId: q.sessionId, scanId: q.scanId, state: "NOT_SELECTED", reason: null, firstScanStartTemp: null, childSessionId: null, childStatus: null}, "[٢] NOT_SELECTED: حرارة البدء null («لا ينطبق»)، ولا انتقال حتى للمالك");
    eq((await data("scanProtocol", q.scanId)).repeat.state, "NOT_SELECTED", "[٢] والمخزَّن لم يتغيّر");
    await setSettings({version: 11});
    const q2 = await parentScan({owner: OWN, joiner: PHONE, tag: "offer-ne"});
    const r2 = await offer(OWN, {sessionId: q2.sessionId, scanId: q2.scanId}, {uid: OWN, token: tokenOf("google.com")});
    deq([r2.ret.state, r2.ret.reason, r2.ret.firstScanStartTemp], ["NOT_ELIGIBLE", "RATE_ABSENT", null], "[٢] NOT_ELIGIBLE: السبب يصل (RATE_ABSENT)");
    await setSettings({version: 12, repeatRate: 1, collectionPhase: true});
  }
  // الرفوض
  {
    const {sessionId, scanId} = pairA;
    const ids = [sessionId, scanId, OWN];
    expectRefusal("[٢] بلا auth", await offer(null, {sessionId, scanId}, null), {fn: OFFER, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "REPEAT_NOT_AUTHENTICATED", logReason: "REPEAT_NOT_AUTHENTICATED", ids});
    expectRefusal("[٢] auth بلا uid", await offer(null, {sessionId, scanId}, {token: {}}), {fn: OFFER, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "REPEAT_NOT_AUTHENTICATED", logReason: "REPEAT_NOT_AUTHENTICATED", ids});
    for (const [label, s] of [["sessionId غائب", undefined], ["فارغ", ""], ["مسافات", "   "], ["رقم", 5], ["يحوي /", "a/b"], ["نقطة", "."]]) {
      expectRefusal(`[٢] ${label}`, await offer(PHONE, {sessionId: s, scanId}), {fn: OFFER, code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "REPEAT_SESSION_ID_REQUIRED", logReason: "REPEAT_SESSION_ID_REQUIRED", ids});
    }
    for (const [label, s] of [["scanId غائب", undefined], ["فارغ", ""], ["رقم", 5], ["يحوي /", "a/b"]]) {
      expectRefusal(`[٢] ${label}`, await offer(PHONE, {sessionId, scanId: s}), {fn: OFFER, code: "invalid-argument", message: "REPEAT_SCAN_ID_REQUIRED", reasonCode: "REPEAT_SCAN_ID_REQUIRED", logReason: "REPEAT_SCAN_ID_REQUIRED", ids});
    }
    expectRefusal("[٢] جلسة غير موجودة", await offer(PHONE, {sessionId: "no-such-session-rpt", scanId}), {fn: OFFER, ...PAIR_GONE, logReason: "REPEAT_PAIR_NOT_FOUND", logExtra: " cause=SESSION_ABSENT", ids: ["no-such-session-rpt", scanId]});
    const wrong = await offer(PHONE, {sessionId, scanId: "other-scan-rpt"});
    expectRefusal("[٢] scanId لا يطابق", wrong, {fn: OFFER, ...PAIR_GONE, logReason: "REPEAT_PAIR_NOT_FOUND", logExtra: " cause=SCAN_ID_MISMATCH", ids});
    deq([wrong.threw.code, wrong.threw.message, wrong.threw.details], [PAIR_GONE.code, PAIR_GONE.message, {reasonCode: PAIR_GONE.reasonCode}], "[٢] ردّ العميل لمطابقة فاشلة هو ردّ الجلسة غير الموجودة نفسه (لا وسيط وجود)");
    // حالات الجلسة غير completed
    let k = 0;
    for (const status of ["pending", "scanning", "expired", "cancelled"]) {
      const sId = `sess-rpt-st-${++k}`;
      await seedSession(sId, {ownerId: OWN, joinedBy: PHONE, status, scanId: "scan-st", expiresAt: FUTURE()});
      expectRefusal(`[٢] جلسة ${status}`, await offer(PHONE, {sessionId: sId, scanId: "scan-st"}), {fn: OFFER, ...TECH("REPEAT_SESSION_NOT_COMPLETED"), logReason: "REPEAT_SESSION_NOT_COMPLETED", logExtra: ` status=${status}`, ids: [sId]});
    }
    for (const [label, doc, state] of [["بلا status", {ownerId: OWN, scanId: "scan-st2"}, "ABSENT"], ["status رقم", {ownerId: OWN, scanId: "scan-st2", status: 5}, "NOT_A_STRING"], ["status مجهول", {ownerId: OWN, scanId: "scan-st2", status: "archived"}, "UNRECOGNIZED"]]) {
      const sId = `sess-rpt-st-${++k}`;
      await seedSession(sId, doc);
      expectRefusal(`[٢] ${label}`, await offer(PHONE, {sessionId: sId, scanId: "scan-st2"}), {fn: OFFER, ...TECH("SESSION_STATUS_UNKNOWN"), logReason: "SESSION_STATUS_UNKNOWN", logExtra: ` statusState=${state}`, ids: [sId]});
    }
    // completed بلا مستند scanProtocol / بلا سجلّ repeat / حالة مجهولة
    await seedSession("sess-rpt-noproto", {ownerId: OWN, joinedBy: PHONE, status: "completed", scanId: "scan-noproto"});
    expectRefusal("[٢] completed بلا scanProtocol", await offer(PHONE, {sessionId: "sess-rpt-noproto", scanId: "scan-noproto"}), {fn: OFFER, ...TECH("REPEAT_RECORD_ABSENT"), logReason: "REPEAT_RECORD_ABSENT", logExtra: " cause=NO_PROTOCOL_DOCUMENT", ids: ["sess-rpt-noproto"]});
    await seedSession("sess-rpt-norepeat", {ownerId: OWN, joinedBy: PHONE, status: "completed", scanId: "scan-norepeat"});
    await db.collection("scanProtocol").doc("scan-norepeat").set({scanPurpose: "normal"});
    expectRefusal("[٢] scanProtocol بلا repeat (كُتب قبل S-P6-07)", await offer(PHONE, {sessionId: "sess-rpt-norepeat", scanId: "scan-norepeat"}), {fn: OFFER, ...TECH("REPEAT_RECORD_ABSENT"), logReason: "REPEAT_RECORD_ABSENT", logExtra: " cause=NO_REPEAT_FIELD", ids: ["sess-rpt-norepeat"]});
    await seedSession("sess-rpt-badstate", {ownerId: OWN, joinedBy: PHONE, status: "completed", scanId: "scan-badstate"});
    await seedProtocol("scan-badstate", {state: "WHATEVER"});
    expectRefusal("[٢] حالة repeat مجهولة", await offer(PHONE, {sessionId: "sess-rpt-badstate", scanId: "scan-badstate"}), {fn: OFFER, ...TECH("REPEAT_STATE_UNKNOWN"), logReason: "REPEAT_STATE_UNKNOWN", ids: ["sess-rpt-badstate"]});
  }

  // ═══ ٣ — startRepeatScan ═══
  let started;
  {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "start"});
    const {sessionId, scanId} = p;
    const sessionsBefore = await count("scanSessions");
    const parentBefore = await data("scanSessions", sessionId);
    const r = await startRepeat(PHONE, {sessionId, scanId, startedBeforeCooling: false});
    ok(r.threw === null, `[٣] البدء نجح (${r.threw && r.threw.message})`);
    deq(Object.keys(r.ret).sort(), ["expiresInMinutes", "parentSessionId", "sessionId", "state"], "[٣] مفاتيح الردّ الأربعة");
    deq([r.ret.parentSessionId, r.ret.state, r.ret.expiresInMinutes], [sessionId, "STARTED", 60], "[٣] الردّ: الأمّ والحالة STARTED و60 دقيقة (مصدر واحد: SESSION_VALIDITY_MINUTES)");
    const childId = r.ret.sessionId;
    ok(typeof childId === "string" && childId !== sessionId, "[٣] معرّف الجلسة الابنة جديد");
    const child = await data("scanSessions", childId);
    deq(Object.keys(child).sort(), ["createdAt", "deviceModel", "expiresAt", "joinedBy", "ownerId", "scanId", "status"], "[٣] الجلسة الابنة: سبعة حقول بالضبط، **بلا code** وبلا joinedAt وبلا purpose");
    deq([child.ownerId, child.joinedBy, child.status, child.scanId, child.deviceModel], [OWN, PHONE, "scanning", null, null], "[٣] ownerId وjoinedBy منسوخان من الأمّ (E41)، وscanning، وscanId وdeviceModel null");
    ok(TS(child.createdAt) && TS(child.expiresAt), "[٣] createdAt وexpiresAt (Timestamp)");
    const life = child.expiresAt.toMillis() - child.createdAt.toMillis();
    ok(life > 59.5 * MIN && life < 60.5 * MIN, `[٣] صلاحية الابن 60 دقيقة من إنشائها (${life})`);
    deq(await data("protocolPending", childId), {repeatOfSessionId: sessionId, repeatOfScanId: scanId, firstScanStartTemp: {state: "PRESENT", valueC: 32.8}, startedBeforeCooling: false, purposeSource: "repeat_flow"}, "[٣] protocolPending للابن (E8): الربط بالأمّ وحرارة البدء الأولى وإعلان الفنّي ومصدر الغرض");
    const sp = await data("scanProtocol", scanId);
    deq([sp.repeat.state, sp.repeat.childSessionId], ["STARTED", childId], "[٣] الأمّ: STARTED ومعرّف ابنها");
    ok(TS(sp.repeat.startedAt), "[٣] وstartedAt وقت الخادم");
    deq(await data("scanSessions", sessionId), parentBefore, "[٣] مستند جلسة الأمّ لم يُمسّ");
    eq(await count("scanSessions"), sessionsBefore + 1, "[٣] جلسة واحدة جديدة وحدها");
    eq(named(r.texts, START)[0], `[${START}] started session=${sid(sessionId)} child=${sid(childId)} caller=${sid(PHONE)} beforeCooling=false reference=PRESENT`, "[٣] سطر البدء: المعرّفات مُهشَّرة، بلا حرارة");
    ok(!r.texts.join("\n").includes(sessionId) && !r.texts.join("\n").includes(childId) && !r.texts.join("\n").includes(scanId), "[٣] لا معرّف خامّ في أيّ سطر");
    note("startRepeatScan — نجاح", named(r.texts, START));
    started = {...p, childId};
    // الجلسة الابنة لا تُنضمّ بالرمز (لا رمز) ولا تظهر لـjoinScanSession
    const j = await join("NC-NONE00", "x");
    ok(j.threw !== null, "[٣] (تحكّم) joinScanSession ترفض رمزاً غير موجود");
    // الابنة تُقرأ من الطرفين بالقواعد القائمة: ownerId وjoinedBy حاضران (يُتحقَّق بقواعد firestore.rules في اختبارها)
  }
  // ٣-أ: بعد البدء: الجلب يعيد STARTED ثم EXPIRED محسوبة
  {
    const {sessionId, scanId, childId} = started;
    const r = await offer(PHONE, {sessionId, scanId});
    deq(r.ret, {sessionId, scanId, state: "STARTED", reason: null, firstScanStartTemp: {state: "PRESENT", valueC: 32.8}, childSessionId: childId, childStatus: "scanning"}, "[٣] بعد البدء: STARTED ومعرّف الابن وحالته scanning");
    // الابن ينقضي بلا فحص: «يُحسب عند القراءة»
    await db.collection("scanSessions").doc(childId).update({expiresAt: PAST(5)});
    const before = await data("scanProtocol", scanId);
    const r2 = await offer(PHONE, {sessionId, scanId});
    deq([r2.ret.state, r2.ret.childStatus], ["EXPIRED", "scanning"], "[٣] الابن scanning وانقضى expiresAt ⟵ EXPIRED محسوبة");
    deq(await data("scanProtocol", scanId), before, "[٣] EXPIRED لا تُكتب (تثبيتها للحساب اليومي: معلّق P6-15)");
    await db.collection("scanSessions").doc(childId).update({status: "expired", expiredAt: admin.firestore.FieldValue.serverTimestamp()});
    eq((await offer(PHONE, {sessionId, scanId})).ret.state, "EXPIRED", "[٣] والابن مسجَّل «منتهية» ⟵ EXPIRED");
    await db.collection("scanSessions").doc(childId).update({status: "cancelled", cancelledAt: admin.firestore.FieldValue.serverTimestamp(), cancelReason: "left_by_customer"});
    deq([(await offer(PHONE, {sessionId, scanId})).ret.state, (await offer(PHONE, {sessionId, scanId})).ret.childStatus], ["STARTED", "cancelled"], "[٣] والابن ملغى ⟵ STARTED وchildStatus=cancelled (التفسير للقارئ؛ لا حالة EXPIRED مختلَقة)");
    await db.collection("scanSessions").doc(childId).update({status: "scanning", expiresAt: FUTURE(30)}); // أعده كما كان للمشاهد التالية
    // الابن غائب/معرّف الابن غائب
    await db.collection("scanProtocol").doc(scanId).update({"repeat.childSessionId": "gone-child"});
    const r3 = await offer(PHONE, {sessionId, scanId});
    deq([r3.ret.state, r3.ret.childSessionId, r3.ret.childStatus], ["STARTED", "gone-child", null], "[٣] الابن غير موجود ⟵ STARTED بحالة ابن null (لا انقضاء مختلَق)");
    await db.collection("scanProtocol").doc(scanId).update({"repeat.childSessionId": childId});
  }
  // ٣-ب: ثانياً: لا بدء ثانٍ
  {
    const {sessionId, scanId} = started;
    const sessionsBefore = await count("scanSessions");
    const r = await startRepeat(PHONE, {sessionId, scanId});
    expectRefusal("[٣] بدء ثانٍ", r, {fn: START, ...TECH("REPEAT_ALREADY_STARTED"), logReason: "REPEAT_ALREADY_STARTED", logExtra: " repeatState=STARTED", ids: [sessionId, scanId]});
    eq(await count("scanSessions"), sessionsBefore, "[٣] ولا جلسة ثانية");
  }
  // ٣-ج: كل قيمة من REPEAT_STATE (القاعدة 30)
  {
    const STATES = ["NOT_ELIGIBLE", "NOT_SELECTED", "SELECTED", "PROMPT_DELIVERED", "DECLINED", "WAITING_COOLING", "STARTED", "COMPLETED_COLD", "COMPLETED_HOT", "COMPLETED_UNCLASSIFIED", "EXPIRED"];
    let i = 0;
    for (const state of STATES) {
      const sId = `sess-rpt-state-${++i}`;
      const cId = `scan-rpt-state-${i}`;
      await seedSession(sId, {ownerId: OWN, joinedBy: PHONE, status: "completed", scanId: cId});
      await seedProtocol(cId, {state, reason: null, firstScanStartTemp: {state: "PRESENT", valueC: 33}});
      const sessionsBefore = await count("scanSessions");
      const r = await startRepeat(PHONE, {sessionId: sId, scanId: cId});
      if (["SELECTED", "PROMPT_DELIVERED", "DECLINED", "WAITING_COOLING"].includes(state)) {
        ok(r.threw === null && r.ret.state === "STARTED", `[٣] ${state} ⟵ يبدأ`);
        eq(await count("scanSessions"), sessionsBefore + 1, `[٣] ${state}: جلسة ابنة واحدة`);
        eq((await data("scanProtocol", cId)).repeat.state, "STARTED", `[٣] ${state}: الأمّ STARTED`);
      } else if (["NOT_ELIGIBLE", "NOT_SELECTED"].includes(state)) {
        expectRefusal(`[٣] ${state}`, r, {fn: START, ...TECH("REPEAT_NOT_SELECTED"), logReason: "REPEAT_NOT_SELECTED", logExtra: ` repeatState=${state}`, ids: [sId, cId]});
        eq(await count("scanSessions"), sessionsBefore, `[٣] ${state}: لا جلسة`);
      } else {
        expectRefusal(`[٣] ${state}`, r, {fn: START, ...TECH("REPEAT_ALREADY_STARTED"), logReason: "REPEAT_ALREADY_STARTED", logExtra: ` repeatState=${state}`, ids: [sId, cId]});
        eq(await count("scanSessions"), sessionsBefore, `[٣] ${state}: لا جلسة`);
        eq((await data("scanProtocol", cId)).repeat.state, state, `[٣] ${state}: الأمّ لم تُمسّ`);
      }
    }
  }
  // ٣-د: الأمّ بلا joinedBy (E41): كل شكل
  {
    let k = 0;
    for (const [label, joinedBy, word] of [["غائب", undefined, "absent"], ["null", null, "null"], ["فارغ", "", "empty"], ["رقم", 5, "invalid-type"]]) {
      const sId = `sess-rpt-e41-${++k}`;
      const cId = `scan-rpt-e41-${k}`;
      await seedSession(sId, {ownerId: OWN, status: "completed", scanId: cId, ...(joinedBy === undefined ? {} : {joinedBy})});
      await seedProtocol(cId, {state: "SELECTED", reason: null, firstScanStartTemp: {state: "PRESENT", valueC: 33}});
      const sessionsBefore = await count("scanSessions");
      const pendingBefore = await count("protocolPending");
      const before = await data("scanProtocol", cId);
      const r = await startRepeat("any-uid", {sessionId: sId, scanId: cId});
      expectRefusal(`[٣] joinedBy ${label}`, r, {fn: START, ...TECH("REPEAT_PARENT_JOINER_UNKNOWN"), logReason: "REPEAT_PARENT_JOINER_UNKNOWN", logExtra: ` joinedByState=${word}`, ids: [sId, cId]});
      eq(await count("scanSessions"), sessionsBefore, `[٣] joinedBy ${label}: لا جلسة ابنة تولد (E41)`);
      eq(await count("protocolPending"), pendingBefore, `[٣] joinedBy ${label}: ولا protocolPending`);
      deq(await data("scanProtocol", cId), before, `[٣] joinedBy ${label}: والأمّ لم تُمسّ`);
    }
    // ownerId غائب
    await seedSession("sess-rpt-noowner", {joinedBy: PHONE, status: "completed", scanId: "scan-rpt-noowner"});
    await seedProtocol("scan-rpt-noowner", {state: "SELECTED", reason: null});
    expectRefusal("[٣] ownerId غائب", await startRepeat(PHONE, {sessionId: "sess-rpt-noowner", scanId: "scan-rpt-noowner"}), {fn: START, ...TECH("REPEAT_PARENT_OWNER_UNKNOWN"), logReason: "REPEAT_PARENT_OWNER_UNKNOWN", ids: ["sess-rpt-noowner"]});
  }
  // ٣-هـ: المدخلات وstartedBeforeCooling
  {
    const mk = async (tag) => { const p = await parentScan({owner: OWN, joiner: PHONE, tag}); return p; };
    const p1 = await mk("sbc-1");
    for (const bad of ["yes", 1, 0, "true", {}, []]) {
      expectRefusal(`[٣] startedBeforeCooling ${JSON.stringify(bad)}`, await startRepeat(PHONE, {sessionId: p1.sessionId, scanId: p1.scanId, startedBeforeCooling: bad}), {fn: START, code: "invalid-argument", message: "REPEAT_STARTED_BEFORE_COOLING_INVALID", reasonCode: "REPEAT_STARTED_BEFORE_COOLING_INVALID", logReason: "REPEAT_STARTED_BEFORE_COOLING_INVALID", ids: [p1.sessionId, p1.scanId]});
    }
    eq((await data("scanProtocol", p1.scanId)).repeat.state, "SELECTED", "[٣] الرفوض لم تمسّ الأمّ");
    const absent = await startRepeat(PHONE, {sessionId: p1.sessionId, scanId: p1.scanId});
    deq((await data("protocolPending", absent.ret.sessionId)).startedBeforeCooling, null, "[٣] startedBeforeCooling غائب ⟵ null (لا false: القاعدة 22)");
    eq(named(absent.texts, START)[0].includes("beforeCooling=ABSENT"), true, "[٣] والسطر beforeCooling=ABSENT");
    const p2 = await mk("sbc-2");
    deq((await data("protocolPending", (await startRepeat(PHONE, {sessionId: p2.sessionId, scanId: p2.scanId, startedBeforeCooling: true})).ret.sessionId)).startedBeforeCooling, true, "[٣] true تُخزَّن true");
    const p3 = await mk("sbc-3");
    deq((await data("protocolPending", (await startRepeat(PHONE, {sessionId: p3.sessionId, scanId: p3.scanId, startedBeforeCooling: null})).ret.sessionId)).startedBeforeCooling, null, "[٣] null صريحة ⟵ null");
    const ids = [p1.sessionId, p1.scanId];
    expectRefusal("[٣] بلا auth", await startRepeat(null, {sessionId: p1.sessionId, scanId: p1.scanId}, null), {fn: START, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "REPEAT_NOT_AUTHENTICATED", logReason: "REPEAT_NOT_AUTHENTICATED", ids});
    expectRefusal("[٣] sessionId غائب", await startRepeat(PHONE, {scanId: p1.scanId}), {fn: START, code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "REPEAT_SESSION_ID_REQUIRED", logReason: "REPEAT_SESSION_ID_REQUIRED", ids});
    expectRefusal("[٣] scanId غائب", await startRepeat(PHONE, {sessionId: p1.sessionId}), {fn: START, code: "invalid-argument", message: "REPEAT_SCAN_ID_REQUIRED", reasonCode: "REPEAT_SCAN_ID_REQUIRED", logReason: "REPEAT_SCAN_ID_REQUIRED", ids});
    expectRefusal("[٣] زوج لا يطابق", await startRepeat(PHONE, {sessionId: p1.sessionId, scanId: "other-scan"}), {fn: START, ...PAIR_GONE, logReason: "REPEAT_PAIR_NOT_FOUND", logExtra: " cause=SCAN_ID_MISMATCH", ids});
    // جلسة pending (قبل الفحص)
    const created = await create(OWN);
    expectRefusal("[٣] جلسة pending", await startRepeat(PHONE, {sessionId: created.ret.sessionId, scanId: "x-scan"}), {fn: START, ...PAIR_GONE, logReason: "REPEAT_PAIR_NOT_FOUND", logExtra: " cause=SESSION_SCAN_ID_ABSENT", ids: [created.ret.sessionId]});
  }
  // ٣-و: سباق بدءين متزامنين
  {
    const p = await parentScan({owner: OWN, joiner: PHONE, tag: "race"});
    const pendingBefore = await count("protocolPending");
    // التقاط واحد حول النداءين المتزامنين (التقاطان متداخلان يتركان console مستبدَلاً)
    const cap = capture();
    let results;
    try {
      results = await Promise.all([PHONE, "other-phone"].map((uid) => settle(startRepeatScan.run({data: {sessionId: p.sessionId, scanId: p.scanId}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}))));
    } finally {
      cap.restore();
    }
    const [a, b] = results.map((r) => ({ret: r.ok ? r.value : null, threw: r.ok ? null : r.error}));
    const winners = [a, b].filter((x) => x.threw === null);
    const losers = [a, b].filter((x) => x.threw !== null);
    eq(winners.length, 1, "[٣] سباق بدءين: ينجح واحد فقط");
    eq(losers.length, 1, "[٣] ويُرفض الآخر");
    eq(losers[0].threw.details.reasonCode, "REPEAT_ALREADY_STARTED", "[٣] برفض ALREADY_STARTED");
    eq(await count("protocolPending"), pendingBefore + 1, "[٣] ومستند protocolPending واحد جديد (جلسة ابنة واحدة)");
    eq((await db.collection("protocolPending").where("repeatOfScanId", "==", p.scanId).get()).size, 1, "[٣] ابن واحد لهذا الفحص");
  }

  // ═══ ٤ — الفحص الثاني (الابن) على analyzeDevice الحقيقية ═══
  /** يبدأ التكرار لفحص أوّل جديد ويعيد معرّفاتهما. */
  async function startedPair({owner = OWN, tag, parentTemp = 32.8, settings = {version: 20, repeatRate: 1, collectionPhase: true}}) {
    await setSettings(settings);
    const p = await parentScan({owner, joiner: PHONE, tag, temp: parentTemp});
    const s = await startRepeat(PHONE, {sessionId: p.sessionId, scanId: p.scanId});
    assert.ok(s.threw === null, `بدء التكرار: ${s.threw && s.threw.message}`);
    return {...p, childId: s.ret.sessionId};
  }
  // ٤-أ: بارد ومعفى
  {
    const t = await startedPair({tag: "cold"});
    const creditBefore = await credit(OWN);
    modelCalls = 0;
    batchOps = [];
    const childScan = newScanId("cold-child");
    const a = await analyze(childScan, t.childId, PHONE, fp(33.1));
    ok(a.threw === null, `[٤] التحليل نجح (${a.threw && a.threw.message})`);
    const sp = await data("scanProtocol", childScan);
    deq([sp.scanPurpose, sp.purposeSource, sp.linkState, sp.linkedScanId], ["repeat_cold", "repeat_flow", "none", null], "[٤] الابن بارد: الغرض من تصنيف الخادم، والمصدر repeat_flow، ولا ربط أزواج");
    deq(sp.repeatOf, {sessionId: t.sessionId, scanId: t.scanId}, "[٤] repeatOf: الأمّ");
    deq(sp.repeatClassification, {absence: null, firstScanStartTemp: {state: "PRESENT", valueC: 32.8}, secondScanStartTemp: {state: "PRESENT", valueC: 33.1}, deltaC: 0.3, thresholdC: 1, startedBeforeCooling: null}, "[٤] repeatClassification: الخام والفرق والعتبة");
    eq(sp.creditExemption, "PROTOCOL_EXEMPT", "[٤] creditExemption = PROTOCOL_EXEMPT (يُكتب الإعفاء في scanProtocol: P:657)");
    deq([sp.repeat.state, sp.repeat.reason], ["NOT_ELIGIBLE", "PURPOSE_NOT_NORMAL"], "[٤] والابن نفسه لا يُختار لتكرار آخر");
    eq(sp.settingsVersion, 20, "[٤] settingsVersion = 20");
    eq(await credit(OWN), creditBefore, "[٤] **لا خصم**: رصيد المالك لم يتغيّر (التكرار البارد في مرحلة الجمع)");
    const parent = await data("scanProtocol", t.scanId);
    deq([parent.repeat.state, parent.repeat.completedByScanId, parent.repeat.childSessionId], ["COMPLETED_COLD", childScan, t.childId], "[٤] الأمّ COMPLETED_COLD ومعرّف فحص الابن ومعرّف جلسته");
    ok(TS(parent.repeat.completedAt), "[٤] وcompletedAt وقت الخادم");
    const ops = batchOps.find((b) => b.some((o) => o === `set reports/${childScan}`));
    deq(ops, [`set reports/${childScan}`, `set reportRaw/${childScan}`, `set scanProtocol/${childScan}`, `update scanProtocol/${t.scanId}`], "[٤] **دفعة ذرّية واحدة** من أربعة: التقرير والخامّ وبروتوكول الابن وتحديث الأمّ");
    eq((await data("scanSessions", t.childId)).status, "completed", "[٤] وجلسة الابن اكتملت");
    eq(modelCalls, 1, "[٤] نداء نموذج واحد (تقرير جديد لا مخبَّأ)");
    const lines = named(a.texts, "analyzeDevice");
    ok(lines.includes(`[analyzeDevice] repeat scan session=${sid(t.childId)} purpose=repeat_cold absence=none deltaC=0.3 exempt=true`), "[٤] سطر التصنيف: بلا معرّف خامّ ولا قيمة حرارة");
    ok(lines.some((l) => l.startsWith("[analyzeDevice] credit exempt (PROTOCOL_EXEMPT) scanId=") && l.endsWith("no reservation, no charge carriedReservationReleased=false")), "[٤] وسطر الإعفاء");
    ok(!a.texts.join("\n").includes(childScan) && !a.texts.join("\n").includes(t.childId) && !a.texts.join("\n").includes("33.1"), "[٤] لا معرّف خامّ ولا حرارة في أيّ سطر");
    note("analyzeDevice — الابن البارد", lines.filter((l) => l.includes("repeat") || l.includes("exempt")));
    ok(!(await exists("scanClaims", childScan)), "[٤] والقفل مُحي في finally كعادته");
  }
  // ٤-ب: ساخن وغير مصنَّف: يُخصمان
  for (const [label, parentTemp, childTemp, purpose, state, absence, delta] of [
    ["ساخن", 32.8, 34.0, "repeat_hot", "COMPLETED_HOT", null, 1.2],
    ["ساخن بفرق سالب", 35.0, 33.0, "repeat_hot", "COMPLETED_HOT", null, -2],
    ["الثانية غائبة", 32.8, undefined, "repeat_unclassified", "COMPLETED_UNCLASSIFIED", "SECOND_START_TEMP_ABSENT", null],
    ["الثانية صفر الحارس", 32.8, 0, "repeat_unclassified", "COMPLETED_UNCLASSIFIED", "SECOND_START_TEMP_ABSENT", null],
    ["الأولى غائبة", null, 33.0, "repeat_unclassified", "COMPLETED_UNCLASSIFIED", "COOLING_REFERENCE_ABSENT", null],
    ["الأولى صفر الحارس", 0, 33.0, "repeat_unclassified", "COMPLETED_UNCLASSIFIED", "COOLING_REFERENCE_ABSENT", null],
  ]) {
    const t = await startedPair({tag: "nc", parentTemp});
    const creditBefore = await credit(OWN);
    const childScan = newScanId("nc-child");
    const a = await analyze(childScan, t.childId, PHONE, fp(childTemp));
    ok(a.threw === null, `[٤] ${label}: التحليل نجح (${a.threw && a.threw.message})`);
    const sp = await data("scanProtocol", childScan);
    deq([sp.scanPurpose, sp.repeatClassification.absence, sp.repeatClassification.deltaC, sp.creditExemption], [purpose, absence, delta, null], `[٤] ${label}: ${purpose}${absence ? ` بسبب ${absence}` : ""}، ولا إعفاء`);
    eq(await credit(OWN), creditBefore - 1, `[٤] ${label}: **تُخصم فحصة** (الإعفاء للبارد وحده: س٢٠ بنصّه)`);
    eq((await data("scanProtocol", t.scanId)).repeat.state, state, `[٤] ${label}: الأمّ ${state}`);
    if (absence) ok(a.texts.some((x) => x.includes(`scanProtocol notes=REPEAT_UNCLASSIFIED:${absence} purpose=repeat_unclassified`)), `[٤] ${label}: ملاحظة REPEAT_UNCLASSIFIED:${absence} في السجلّ`);
  }
  // ٤-ج: البارد بلا علَم مرحلة الجمع: يُخصم
  for (const [label, settings] of [["collectionPhase false", {version: 21, repeatRate: 1, collectionPhase: false}], ["collectionPhase غائب", {version: 22, repeatRate: 1}], ["collectionPhase نصّ «true»", {version: 23, repeatRate: 1, collectionPhase: "true"}]]) {
    const t = await startedPair({tag: "phase", settings});
    const creditBefore = await credit(OWN);
    const childScan = newScanId("phase-child");
    const a = await analyze(childScan, t.childId, PHONE, fp(33.0));
    ok(a.threw === null, `[٤] ${label}: التحليل نجح`);
    const sp = await data("scanProtocol", childScan);
    deq([sp.scanPurpose, sp.creditExemption], ["repeat_cold", null], `[٤] ${label}: بارد بلا إعفاء`);
    eq(await credit(OWN), creditBefore - 1, `[٤] ${label}: تُخصم فحصة (الإعفاء لا يقوم إلا على collectionPhase=true صريحة)`);
    eq((await data("scanProtocol", t.scanId)).repeat.state, "COMPLETED_COLD", `[٤] ${label}: والأمّ COMPLETED_COLD`);
  }
  // ٤-د: رصيد المالك صفر: البارد المعفى يمرّ، والساخن يُرفض بالبوّابة القائمة
  {
    const lowOwner = "own-rpt-lowcredit";
    await seedOwner(lowOwner, {scansRemaining: 1});
    const t = await startedPair({owner: lowOwner, tag: "low"});
    eq(await credit(lowOwner), 0, "[٤] (إعداد) الفحص الأوّل استهلك آخر فحصة");
    const cold = await analyze(newScanId("low-cold"), t.childId, PHONE, fp(33.0));
    ok(cold.threw === null, `[٤] رصيد 0: البارد المعفى يمرّ (${cold.threw && cold.threw.message})`);
    eq(await credit(lowOwner), 0, "[٤] والرصيد باقٍ 0 (لا يصير سالباً)");
    const owner2 = "own-rpt-lowcredit-hot";
    await seedOwner(owner2, {scansRemaining: 1});
    const t2 = await startedPair({owner: owner2, tag: "low-hot"});
    eq(await credit(owner2), 0, "[٤] (إعداد) رصيد 0");
    const childScan = newScanId("low-hot-child");
    const batchesBefore = batchOps.length;
    const a = await analyze(childScan, t2.childId, PHONE, fp(36.0));
    ok(a.threw !== null && a.threw.details && a.threw.details.reasonCode === "SHOP_NO_CREDIT", `[٤] الساخن برصيد 0: يُرفض بالبوّابة القائمة SHOP_NO_CREDIT (${a.threw && a.threw.message})`);
    ok(!(await exists("scanProtocol", childScan)) && !(await exists("reports", childScan)), "[٤] ولا تقرير ولا بروتوكول للابن");
    eq((await data("scanSessions", t2.childId)).status, "scanning", "[٤] والجلسة الابنة تبقى scanning");
    eq((await data("scanProtocol", t2.scanId)).repeat.state, "STARTED", "[٤] والأمّ STARTED");
    eq(batchOps.length, batchesBefore, "[٤] ولا دفعة كتابة");
  }
  // ٤-هـ: حجز قديم محمول على قفل المعرّف نفسه ثم صار الفحص معفىً: يُعاد لصاحبه ولا يضيع بمحو القفل
  {
    const t = await startedPair({tag: "carry"});
    const childScan = newScanId("carry-child");
    await db.collection("users").doc(OWN).update({scansRemaining: admin.firestore.FieldValue.increment(-1)}); // الفحصة التي خُصمت في المحاولة السابقة
    const creditBefore = await credit(OWN);
    await db.collection("scanClaims").doc(childScan).set({
      scanId: childScan, userId: OWN, claimedAtMs: Date.now() - 400000, sessionId: t.childId,
      reservation: {userId: OWN, isFreeTrial: false, deviceFP: null, reservedAtMs: Date.now() - 400000},
    });
    const a = await analyze(childScan, t.childId, PHONE, fp(33.0));
    ok(a.threw === null, `[٤] الابن البارد بقفل قديم حامل حجزاً: نجح (${a.threw && a.threw.message})`);
    eq(await credit(OWN), creditBefore + 1, "[٤] الحجز القديم أُعيد لصاحبه (+1) ثم لم تُخصم فحصة (معفى): لا يضيع بمحو القفل");
    ok(a.texts.some((x) => x.endsWith("no reservation, no charge carriedReservationReleased=true")), "[٤] وسطر الإعفاء يعلن carriedReservationReleased=true");
    eq((await data("scanProtocol", childScan)).creditExemption, "PROTOCOL_EXEMPT", "[٤] والإعفاء مكتوب");
    ok(!(await exists("scanClaims", childScan)), "[٤] والقفل مُحي بعد أن لم يعد يحمل حجزاً");
  }
  // ٤-و: الذرّية: فشل الالتزام لا يترك شيئاً من الأربعة، ولا يُخصم، والأمّ تبقى STARTED؛ وإعادة المحاولة تنجح
  {
    const t = await startedPair({tag: "atomic"});
    const childScan = newScanId("atomic-child");
    const creditBefore = await credit(OWN);
    failNextCommit = true;
    const bad = await analyze(childScan, t.childId, PHONE, fp(34.5));
    ok(bad.threw !== null && injectedCommit === 1, "[٤] فشل الالتزام المحقون: التحليل يفشل");
    ok(!(await exists("reports", childScan)) && !(await exists("reportRaw", childScan)) && !(await exists("scanProtocol", childScan)), "[٤] لا تقرير ولا خامّ ولا بروتوكول للابن");
    eq((await data("scanProtocol", t.scanId)).repeat.state, "STARTED", "[٤] والأمّ ما زالت STARTED (لم تُحدَّث وحدها)");
    eq(await credit(OWN), creditBefore, "[٤] والفحصة المحجوزة أُعيدت (الساخن غير معفى: حُجزت ثم أُعيدت)");
    eq((await data("scanSessions", t.childId)).status, "scanning", "[٤] والجلسة الابنة scanning فتصحّ إعادة المحاولة");
    const retry = await analyze(childScan, t.childId, PHONE, fp(34.5));
    ok(retry.threw === null, `[٤] إعادة المحاولة بالمعرّف نفسه تنجح (${retry.threw && retry.threw.message})`);
    deq([(await data("scanProtocol", t.scanId)).repeat.state, await credit(OWN)], ["COMPLETED_HOT", creditBefore - 1], "[٤] والأمّ COMPLETED_HOT وخُصمت فحصة واحدة (الساخن)");
    const again = await analyze(childScan, t.childId, PHONE, fp(34.5));
    ok(again.threw === null, `[٤] طلب ثالث بالمعرّف نفسه بعد اكتمال الجلسة: إعادة محاولة مشروعة تُخدَم من المخزَّن (A-SUB، القرار ١٢) لا فحص جديداً (${again.threw && again.threw.message})`);
    eq(await credit(OWN), creditBefore - 1, "[٤] ولا خصم ثانٍ");
    eq((await data("scanProtocol", t.scanId)).repeat.state, "COMPLETED_HOT", "[٤] ولا يُعاد تحديث الأمّ");
  }
  // ٤-ز: الأمّ لا تُحدَّث إلا إن كانت STARTED لهذا الابن: غير ذلك يُعلَن ولا يُفشل الفحص
  {
    await setSettings({version: 30, repeatRate: 1, collectionPhase: true});
    let k = 0;
    const cases = [
      ["الأمّ SELECTED لم تبدأ", async (cId) => { await seedProtocol(cId, {state: "SELECTED", reason: null}); return {parentScanId: cId}; }, "PARENT_NOT_STARTED:SELECTED"],
      ["الأمّ بلا مستند", async () => ({parentScanId: "scan-rpt-gone-parent"}), "PARENT_DOCUMENT_ABSENT"],
      ["الأمّ STARTED لابن آخر", async (cId) => { await seedProtocol(cId, {state: "STARTED", reason: null, childSessionId: "another-child"}); return {parentScanId: cId}; }, "PARENT_CHILD_MISMATCH"],
      ["الأمّ بلا سجلّ repeat", async (cId) => { await db.collection("scanProtocol").doc(cId).set({scanPurpose: "normal"}); return {parentScanId: cId}; }, "PARENT_RECORD_UNREADABLE:REPEAT_RECORD_ABSENT"],
      ["pending بلا repeatOfScanId", async () => ({parentScanId: undefined}), "PARENT_SCAN_ID_ABSENT"],
    ];
    for (const [label, prepare, reason] of cases) {
      const childId = `sess-rpt-orphan-${++k}`;
      const parentScanId = `scan-rpt-orphan-parent-${k}`;
      const extra = await prepare(parentScanId);
      await seedSession(childId, {ownerId: OWN, joinedBy: PHONE, status: "scanning", expiresAt: FUTURE(), scanId: null, deviceModel: null});
      await db.collection("protocolPending").doc(childId).set({
        repeatOfSessionId: "sess-orphan-parent", ...(extra.parentScanId ? {repeatOfScanId: extra.parentScanId} : {}),
        firstScanStartTemp: {state: "PRESENT", valueC: 32.8}, startedBeforeCooling: null, purposeSource: "repeat_flow",
      });
      const parentBefore = extra.parentScanId ? (await getDoc("scanProtocol", extra.parentScanId)).data() : undefined;
      const childScan = newScanId("orphan-child");
      const a = await analyze(childScan, childId, PHONE, fp(33.0));
      ok(a.threw === null, `[٤] ${label}: الفحص ينجح (التحديث المعلَّق لا يُفشله): ${a.threw && a.threw.message}`);
      ok(a.texts.includes(`[analyzeDevice] repeat parent not updated reason=${reason} session=${sid(childId)}`), `[٤] ${label}: سطر مسمّى بسبب عدم تحديث الأمّ ${reason}`);
      if (extra.parentScanId) deq((await getDoc("scanProtocol", extra.parentScanId)).data(), parentBefore, `[٤] ${label}: الأمّ لم تُمسّ`);
      eq((await data("scanProtocol", childScan)).scanPurpose, "repeat_cold", `[٤] ${label}: بروتوكول الابن مكتوب (بارد)`);
    }
    // مرجع الأمّ المخزَّن مشوَّه ⟵ التصنيف غير مصنَّف بسبب COOLING_REFERENCE_ABSENT لا بارد
    const childId = "sess-rpt-badref";
    await seedSession(childId, {ownerId: OWN, joinedBy: PHONE, status: "scanning", expiresAt: FUTURE(), scanId: null, deviceModel: null});
    await db.collection("protocolPending").doc(childId).set({repeatOfSessionId: "p", repeatOfScanId: "q", firstScanStartTemp: "garbage", purposeSource: "repeat_flow"});
    const childScan = newScanId("badref");
    const a = await analyze(childScan, childId, PHONE, fp(33.0));
    ok(a.threw === null, "[٤] مرجع مشوَّه: الفحص ينجح");
    const sp = await data("scanProtocol", childScan);
    deq([sp.scanPurpose, sp.repeatClassification.absence, sp.repeatClassification.firstScanStartTemp.state, sp.repeatClassification.startedBeforeCooling], ["repeat_unclassified", "COOLING_REFERENCE_ABSENT", "STORED_MALFORMED", null], "[٤] المرجع المخزَّن المشوَّه ⟵ STORED_MALFORMED ⟵ غير مصنَّف (لا بارد)");
  }
  // ٤-ح: منع الكاش وpreviousScan في الفحوص البروتوكولية (P:404-407) مع تحكّم: العادي يُخبَّأ
  {
    await db.collection("settings").doc("cache").set({reuseEnabled: true});
    clearCacheConfigCache();
    await setSettings({version: 40, repeatRate: 1, collectionPhase: true});
    const KEY = `cache-${Date.now()}`;
    const p1 = await parentScan({owner: OWN, joiner: PHONE, tag: "cache1", fingerprint: fp(32.8, {sharedKey: KEY})});
    const callsAfter1 = modelCalls;
    // تحكّم: فحص عادي ثانٍ لجهاز بالتوقيع نفسه يقرّر الكاش إعادة الاستعمال (سطر القرار). ما بعد القرار خارج هذا الصفّ: مسار التقرير المخبَّأ لتقرير V7 يكتب grade وscore غير معرَّفتين فيرفضه Firestore
    // (analyzeDevice.js:326-328: الفرع غير V7) — عطب قائم قبل هذا الصفّ، لا يظهر لأن راية الكاش معطّلة افتراضياً؛ فلا يُثبَّت هنا نجاحه ولا فشله (اختبار يحرس العطب يُخفق عند إصلاحه: القاعدة 23)، يُثبَّت قرار الكاش وحده.
    const created2 = await create(OWN);
    await join(created2.ret.code, PHONE);
    const control = await analyze(newScanId("cache2"), created2.ret.sessionId, PHONE, fp(32.8, {sharedKey: KEY}));
    ok(control.texts.some((x) => x.includes("[ScanCompare] reusing previous report (below threshold, no new defect)")), "[٤] (تحكّم) فحص عادي ثانٍ بالتوقيع نفسه: قرار الكاش إعادة الاستعمال");
    ok(!control.texts.some((x) => x.includes("cache reuse blocked")), "[٤] (تحكّم) ولا سطر منع للفحص العادي");
    const callsAfterControl = modelCalls;
    ok(callsAfterControl === callsAfter1, "[٤] (تحكّم) ولا نداء نموذج للفحص العادي (قرار الكاش سبق النموذج)");
    // الابن: لا كاش ولو التوقيع نفسه
    const s = await startRepeat(PHONE, {sessionId: p1.sessionId, scanId: p1.scanId});
    ok(s.threw === null, "[٤] بدء تكرار الفحص الأوّل");
    const childScan = newScanId("cache-child");
    const before = modelCalls;
    const c = await analyze(childScan, s.ret.sessionId, PHONE, fp(32.8, {sharedKey: KEY}));
    ok(!c.texts.some((x) => x.includes("[ScanCompare] reusing previous report")), "[٤] الابن: لا قرار إعادة استعمال رغم التوقيع نفسه");
    ok(c.threw === null, `[٤] الابن نجح (${c.threw && c.threw.message})`);
    ok((await data("reports", childScan)).aiModel !== "cached_signature_match", "[٤] **الابن لا يُخدَم من الكاش** (تكرار يقيس ثبات النتائج بتقرير جديد)");
    eq(modelCalls, before + 1, "[٤] ونداء نموذج جديد");
    ok(c.texts.some((x) => x.includes("[ScanCompare] protocol scan — cache reuse blocked, calling model without previousScan")), "[٤] وسطر المنع المسمّى");
    eq((await data("scanProtocol", childScan)).scanPurpose, "repeat_cold", "[٤] والابن بارد (فرق 0)");
    // maintenance_after (كان battery_after: القاعدة 23): الغرض نفسه يمنع الكاش
    const KEY2 = `cache-ba-${Date.now()}`;
    await parentScan({owner: OWN, joiner: PHONE, tag: "cache-ba1", fingerprint: fp(32.8, {sharedKey: KEY2})});
    const before2 = modelCalls;
    const ba = await parentScan({owner: OWN, joiner: PHONE, tag: "cache-ba2", fingerprint: fp(32.8, {sharedKey: KEY2}), prepare: async (id) => { const r = await setPurposeWithParts(OWN, id, "maintenance_after"); assert.ok(r.threw === null); }});
    ok((await data("reports", ba.scanId)).aiModel !== "cached_signature_match", "[٤] جلسة maintenance_after لا تُخدَم من الكاش (P:405)");
    eq(modelCalls, before2 + 1, "[٤] ونداء نموذج جديد");
    ok(ba.analyze.texts.some((x) => x.includes("[ScanCompare] protocol scan — cache reuse blocked")), "[٤] وسطر المنع المسمّى");
    // أعد الراية كما كانت
    await db.collection("settings").doc("cache").set({reuseEnabled: false});
    clearCacheConfigCache();
  }

  // ٤-ز: (ق14، 2026-10-23، قرار حسن 2026-10-22) الابن يرث موافقة الأمّ المسجَّلة المقبولة بحالة وراثة مسمّاة؛ وكل ما سواه كما كان
  {
    const consentCall = (uid, sessionId, locale) => call(() => recordScanConsent.run({data: {sessionId, textVersion: 1, locale}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
    const CONSENT_LINE = (text) => named(text, "analyzeDevice").filter((t) => t.includes("scanProtocol consent"));
    await setSettings({version: 30, repeatRate: 1, collectionPhase: true});
    /** أمّ بموافقة مسجَّلة (locale) أو بلا موافقة (null)، ثم بدء التكرار. */
    async function pairWithConsent({owner, joiner, tag, parentLocale}) {
      await seedOwner(owner, {protocolParts: {coldRepeat: true, consent: true}});
      const created = await create(owner);
      assert.ok(created.threw === null, `إنشاء الجلسة: ${created.threw && created.threw.message}`);
      const joined = await join(created.ret.code, joiner);
      assert.ok(joined.threw === null, `الانضمام: ${joined.threw && joined.threw.message}`);
      if (parentLocale !== null) {
        const rc = await consentCall(joiner, created.ret.sessionId, parentLocale);
        assert.ok(rc.threw === null, `تسجيل موافقة الأمّ: ${rc.threw && rc.threw.message}`);
      }
      const scanId = newScanId(tag);
      const a = await analyze(scanId, created.ret.sessionId, joiner, fp(32.8));
      assert.ok(a.threw === null, `تحليل الأمّ: ${a.threw && a.threw.message}`);
      const s = await startRepeat(joiner, {sessionId: created.ret.sessionId, scanId});
      assert.ok(s.threw === null, `بدء التكرار: ${s.threw && s.threw.message}`);
      return {owner, joiner, sessionId: created.ret.sessionId, scanId, childId: s.ret.sessionId, parentAnalyze: a};
    }
    // أ) أمّ بموافقة مسجَّلة (tr) والابن بلا سجلّ ذاتي ⟵ inherited بنسخة الأمّ ولغتها ووقتها
    {
      const t = await pairWithConsent({owner: "own-rpt-cn-a", joiner: "phone-rpt-cn-a", tag: "cn-a", parentLocale: "tr"});
      const parent = await data("scanProtocol", t.scanId);
      deq([parent.consent.state, parent.consent.textVersion, parent.consent.locale], ["accepted", 1, "tr"], "[٤-ز] (إعداد) موافقة الأمّ مسجَّلة accepted/1/tr");
      const childScan = newScanId("cn-a-child");
      const a = await analyze(childScan, t.childId, t.joiner, fp(33.1));
      ok(a.threw === null, `[٤-ز] تحليل الابن نجح (${a.threw && a.threw.message})`);
      const sp = await data("scanProtocol", childScan);
      deq(Object.keys(sp.consent).sort(), ["acceptedAt", "locale", "state", "textVersion"], "[٤-ز] المفاتيح الأربعة نفسها");
      deq([sp.consent.state, sp.consent.textVersion, sp.consent.locale], ["inherited", 1, "tr"], "[٤-ز] الابن: inherited بنسخة الأمّ ولغتها");
      eq(sp.consent.acceptedAt.toMillis(), parent.consent.acceptedAt.toMillis(), "[٤-ز] ووقت قبول الأمّ نفسه (لا وقت التحليل)");
      deq(CONSENT_LINE(a.texts), ["[analyzeDevice] scanProtocol consent state=inherited basis=INHERITED"], "[٤-ز] سطر مسمّى: الحالة وأساس INHERITED");
      const parentAfter = await data("scanProtocol", t.scanId);
      deq([parentAfter.consent.state, parentAfter.repeat.state], ["accepted", "COMPLETED_COLD"], "[٤-ز] والأمّ بقيت accepted (الدفعة تكتب repeat.* وحده) وكُتب إكمالها");
      ok(!(await exists("protocolPending", childScan)), "[٤-ز] ولا كتابة موافقة في protocolPending (الوراثة في scanProtocol وحده)");
      ok(!a.texts.join("\n").includes(t.joiner) && !a.texts.join("\n").includes(childScan), "[٤-ز] لا معرّف خامّ في أيّ سطر");
      note("analyzeDevice — الابن يرث الموافقة", CONSENT_LINE(a.texts));
    }
    // ب) أمّ بلا موافقة مسجَّلة (تطبيق قديم) ⟵ الابن كما كان: not_collected/NOT_RECORDED
    {
      const t = await pairWithConsent({owner: "own-rpt-cn-b", joiner: "phone-rpt-cn-b", tag: "cn-b", parentLocale: null});
      deq((await data("scanProtocol", t.scanId)).consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٤-ز] (إعداد) موافقة الأمّ not_collected");
      const childScan = newScanId("cn-b-child");
      const a = await analyze(childScan, t.childId, t.joiner, fp(33.1));
      ok(a.threw === null, "[٤-ز] تحليل الابن نجح");
      deq((await data("scanProtocol", childScan)).consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٤-ز] أمّ بلا موافقة ⟵ الابن not_collected (غياب صريح، لا وراثة من غير مقبول)");
      deq(CONSENT_LINE(a.texts), ["[analyzeDevice] scanProtocol consent state=not_collected basis=NOT_RECORDED"], "[٤-ز] وأساسه NOT_RECORDED كما كان");
    }
    // ج) الابن سجّل موافقة بنفسه ⟵ سجلّه الذاتي يفوز (RECORDED) ولو كانت الأمّ بلغة أخرى
    {
      const t = await pairWithConsent({owner: "own-rpt-cn-c", joiner: "phone-rpt-cn-c", tag: "cn-c", parentLocale: "tr"});
      const rc = await consentCall(t.joiner, t.childId, "ar");
      ok(rc.threw === null, `[٤-ز] تسجيل موافقة الابن بنفسه (${rc.threw && rc.threw.message})`);
      const childScan = newScanId("cn-c-child");
      const a = await analyze(childScan, t.childId, t.joiner, fp(33.1));
      ok(a.threw === null, "[٤-ز] تحليل الابن نجح");
      const sp = await data("scanProtocol", childScan);
      deq([sp.consent.state, sp.consent.locale], ["accepted", "ar"], "[٤-ز] سجلّ الابن الذاتي يفوز: accepted بلغته لا الموروثة");
      deq(CONSENT_LINE(a.texts), ["[analyzeDevice] scanProtocol consent state=accepted basis=RECORDED"], "[٤-ز] وأساسه RECORDED");
    }
    // د) فحص عادي بجلسة (ليس ابناً) بلا موافقة: لا يرث من أحد
    {
      const owner = "own-rpt-cn-d";
      await seedOwner(owner, {protocolParts: {coldRepeat: true, consent: true}});
      const p = await parentScan({owner, joiner: "phone-rpt-cn-d", tag: "cn-d"});
      deq((await data("scanProtocol", p.scanId)).consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٤-ز] فحص عادي بلا موافقة ⟵ not_collected (لا وراثة لغير الابن)");
    }
  }

  // ═══ ٥ — لا حذف ═══
  {
    for (const f of ["src/protocol/repeatScan.js", "src/protocol/protocolSelection.js", "src/protocol/protocolSettings.js", "src/sessions/repeatScanCalls.js"]) {
      const code = fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(code), `[٥] ${f}: لا حذف بأيّ وسيلة (القاعدة 42)`);
    }
  }

  console.log(`\n${OBSERVED.join("\n")}`);
  console.log(`\nrepeatScan.e2e.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
