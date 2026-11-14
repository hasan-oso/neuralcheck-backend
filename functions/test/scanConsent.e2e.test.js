// E2E test: الموافقة على الهاتف المفحوص — createScanSession وjoinScanSession وrecordScanConsent وcancelScanSession وanalyzeDevice الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-12، 2026-10-21 +03).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch نحو deepseek وحده، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل — لأنّ analyzeDevice تنادي مزوّداً ولا يُختبر هنا. **لا استبدال لأيّ طبقة أخرى** (الدوالّ والمعاملات والمحاكي كما هي)،
// ولا حقن فشل. الفحص حمولة fv67 الذهبية الحقيقية (طلب 1.0.10) كما في repeatScan.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١١ (:1377-1413) وdocs/PROTOCOL_CONTRACT.md §٢ A8 (يحمل نصّها المقتبس وكل شكل سلك وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ المسار الكامل: createScanSession ← joinScanSession ← recordScanConsent ← analyzeDevice: scanProtocol.consent = المسجَّل بمفاتيحه الأربعة ووقت الخادم، وscanProtocol بثلاثة عشر حقلاً، ومستند protocolPending
//      يحتفظ بما كتبه غير الموافقة (الدمج). اللغتان (ar · tr).
//   ٢ الغياب حالة صريحة: جلسة بلا نداء موافقة (تطبيق قديم) ⟵ not_collected؛ فحص بلا جلسة ⟵ not_collected؛ مخزَّن غير مقروء ⟵ not_collected مع ملاحظة CONSENT_NOT_RECOGNIZED؛ والموافقة لا تُستنتج من غياب.
//   ٣ الأوّل يبقى: نداء ثانٍ لا يكتب (alreadyRecorded) ويردّ المخزَّن، ومع قيم مختلفة يُسجَّل differs؛ ونداءان متزامنان ⟵ كتابة واحدة.
//   ٤ الرفوض كلّها بأسبابها على الدالّة الحقيقية: بلا auth · مدخل ناقص/غير صالح (كل سبب قراءة) · المالك · غريب · جلسة غير موجودة (الردّ نفسه) · pending · completed · cancelled · expired (تُسجَّل منتهية) ·
//      حالة/expiresAt تالفان · مخزَّن غير مقروء — بلا كتابة حيث لا كتابة.
//   ٥ «لا أوافق»: cancelScanSession بسبب consent_declined تلغي الجلسة ولا تكتب موافقة ولا scanProtocol، ثم يُرفض التسجيل؛ ولا معرّف يُرسل.
//   ٦ جزء الموافقة للمحلّ (ق40، 2026-10-23، القاعدة 23: كان «لا يمنع التسجيل (معلّق)» فاستُبدل): محلّ بلا consent=true ⟵ CONSENT_PART_NOT_ENABLED بلا كتابة؛ مستند المالك غائب ⟵ الرمز مع owner=absent؛
//      «الأوّل يبقى» ولو أُطفئ الجزء بعدها؛ والانقضاء يسبق الجزء. ٧ لا معرّف خامّ في أيّ سطر سجلّ جديد، ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/scanConsent.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {validV7ModelResponse, deepSeekHttpResponse} = require("./lib/v7ProviderStub");

// الاستبدال الوحيد: نداء المزوّد. (القاعدة 9: لا طلب شبكة نحو مزوّد؛ أيّ عنوان آخر يُرمى.)
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
  return deepSeekHttpResponse(validV7ModelResponse());
};

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {cancelScanSession} = require("../src/sessions/cancelScanSession");
const {recordScanConsent} = require("../src/sessions/recordScanConsent");
const {clearCacheConfigCache} = require("../src/utils/resolveCacheConfig");
const {hashIdForLog} = require("../src/utils/logRedaction");
const {CONSENT_TEXT_VERSION} = require("../src/protocol/protocolVocabulary");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const REQUEST_FILE = path.join(__dirname, "fixtures", "golden", "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json");
const BASE_FINGERPRINT = JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8")).fingerprint;
let fpSeq = 0;
/** نسخة من حمولة الفحص الذهبية بمفتاح جهاز فريد (فلا يلتقي ملفّ جهاز مشترك بين المشاهد). */
function fp() {
  const f = JSON.parse(JSON.stringify(BASE_FINGERPRINT));
  const key = `cns-${++fpSeq}-${Date.now()}`;
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
const seedOwner = (uid, extra = {}) => {
  const d = {scansRemaining: 500, scansTotal: 500, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), ...extra};
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return db.collection("users").doc(uid).set(d);
};
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

// التقاط سطور السجلّ **آمن للتزامن** (نداءان متزامنان في مشهد السباق): الخطّاف يُركَّب عند أوّل التقاط ويُنزَع عند آخر استعادة، وسطور كل نداء شريحته من المصفوفة المشتركة.
let hookDepth = 0;
let hookReal = null;
const hookLines = [];
function capture() {
  if (hookDepth === 0) {
    hookReal = {warn: console.warn, error: console.error, log: console.log, info: console.info};
    for (const level of Object.keys(hookReal)) console[level] = (...a) => { hookLines.push({level, text: a.join(" ")}); };
  }
  hookDepth++;
  const start = hookLines.length;
  let end = null;
  return {
    get lines() { return hookLines.slice(start, end === null ? undefined : end); },
    texts() { return this.lines.map((l) => l.text); },
    restore() {
      end = hookLines.length;
      hookDepth--;
      if (hookDepth === 0) for (const level of Object.keys(hookReal)) console[level] = hookReal[level];
    },
  };
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
const consent = (uid, d, authOverride) => call(() => recordScanConsent.run({data: d, auth: authOverride === undefined ? {uid, token: tokenOf("anonymous")} : authOverride, rawRequest: {headers: {}}}));
const cancel = (uid, sessionId, reason) => call(() => cancelScanSession.run({data: {sessionId, reason}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const analyze = (scanId, sessionId, uid, fingerprint) => call(() => analyzeDevice.run({
  data: {scanId, fingerprint, ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf(sessionId ? "anonymous" : "google.com")}, rawRequest: {headers: {}},
}));
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
let scanSeq = 0;
const newScanId = (tag) => `scan-cns-${tag}-${++scanSeq}-${Date.now()}`;
const FN = "recordScanConsent";

function expectRefusal(label, r, {code, message, reasonCode, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, FN).filter((t) => t.startsWith(`[${FN}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${FN}] refused reason=${logReason}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${logReason}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return lines[0];
}
const TECH = (reason) => ({code: "failed-precondition", message: reason, reasonCode: reason});
const BAD = (reason) => ({code: "invalid-argument", message: reason, reasonCode: reason});
const GONE = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT"};
// (2026-10-22، القاعدة 23: كان ثلاثة عشر مفتاحاً؛ استُبدل بخمسة عشر: أُضيف defectType وpair بأمر ربط «قبل/بعد صيانة»)
// (ق36 أ، 2026-10-22، القاعدة 23: كان خمسة عشر مفتاحاً؛ استُبدل بستّة عشر: أُضيف linkModelCheck — null صريح لغير «بعد» المربوطة)
const SCAN_PROTOCOL_KEYS = ["consent", "createdAt", "creditExemption", "defectType", "linkMethod", "linkModelCheck", "linkState", "linkedScanId", "pair", "protocolVersion", "purposeSource", "repeat", "repeatClassification", "repeatOf", "scanPurpose", "settingsVersion"];

/** جلسة حقيقية: createScanSession ← joinScanSession. تعيد المعرّفات. */
async function session({owner, joiner}) {
  const created = await create(owner);
  assert.ok(created.threw === null, `إنشاء الجلسة: ${created.threw && created.threw.message}`);
  const joined = await join(created.ret.code, joiner);
  assert.ok(joined.threw === null, `الانضمام: ${joined.threw && joined.threw.message}`);
  return {sessionId: created.ret.sessionId, code: created.ret.code};
}

(async () => {
  const OWN = "own-cns-1";
  await seedOwner(OWN, {protocolParts: {consent: true}}); // (ق40) المحلّ يفعّل جزء الموافقة — دونه يُرفض التسجيل (مشهد ٦)
  clearCacheConfigCache();

  // ═══ ١ — المسار الكامل بالعربية ═══
  {
    const joiner = "phone-cns-1";
    const s = await session({owner: OWN, joiner});
    const pendingBefore = await data("protocolPending", s.sessionId);
    deq(Object.keys(pendingBefore).sort(), ["doubleEvalDraw", "purposeSource"], "[١] protocolPending قبل التسجيل: مصدر الغرض وسحب التقييم المزدوج (لا موافقة)");
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    ok(r.threw === null, `[١] التسجيل ينجح: ${r.threw && r.threw.message}`);
    deq(r.ret, {sessionId: s.sessionId, state: "accepted", textVersion: 1, locale: "ar", alreadyRecorded: false}, "[١] الردّ: القيم المخزَّنة وalreadyRecorded=false");
    const pending = await data("protocolPending", s.sessionId);
    deq(Object.keys(pending).sort(), ["consent", "doubleEvalDraw", "purposeSource"], "[١] protocolPending بعد التسجيل: consent أُضيف ولم يُمحَ شيء (الدمج)");
    deq(Object.keys(pending.consent).sort(), ["acceptedAt", "locale", "state", "textVersion"], "[١] consent بالمفاتيح الأربعة المعتمدة (E11)");
    deq([pending.consent.state, pending.consent.textVersion, pending.consent.locale], ["accepted", 1, "ar"], "[١] القيم المرسَلة");
    ok(TS(pending.consent.acceptedAt) && Math.abs(pending.consent.acceptedAt.toMillis() - Date.now()) < 60 * 1000, "[١] acceptedAt وقت الخادم (Timestamp قريب من الآن)");
    deq([pending.purposeSource, pending.doubleEvalDraw.selected], [pendingBefore.purposeSource, pendingBefore.doubleEvalDraw.selected], "[١] ما كتبه غيرها بحاله");
    const lines = named(r.texts, FN);
    deq(lines, [`[${FN}] recorded session=${sid(s.sessionId)} caller=${sid(joiner)} textVersion=1 locale=ar alreadyRecorded=false`], "[١] سطر نجاح مسمّى بمعرّفين مُهشَّرين وقيمتين مغلقتين");
    note("recordScanConsent — النجاح", lines);
    ok(!r.texts.join("\n").includes(s.sessionId) && !r.texts.join("\n").includes(joiner), "[١] لا معرّف خامّ");

    const scanId = newScanId("ar");
    const a = await analyze(scanId, s.sessionId, joiner, fp());
    ok(a.threw === null, `[١] التحليل ينجح: ${a.threw && a.threw.message}`);
    const sp = await data("scanProtocol", scanId);
    deq(Object.keys(sp).sort(), SCAN_PROTOCOL_KEYS, "[١] مستند scanProtocol: ستّة عشر حقلاً بالضبط (الاثنا عشر ومعها consent، ثم defectType وpair من أمر الصيانة 2026-10-22، ثم linkModelCheck من ق36 أ)");
    deq(Object.keys(sp.consent).sort(), ["acceptedAt", "locale", "state", "textVersion"], "[١] scanProtocol.consent بالمفاتيح الأربعة");
    deq([sp.consent.state, sp.consent.textVersion, sp.consent.locale], ["accepted", 1, "ar"], "[١] المسجَّل يُنسخ إلى scanProtocol");
    eq(sp.consent.acceptedAt.toMillis(), pending.consent.acceptedAt.toMillis(), "[١] وقت القبول هو وقت التسجيل نفسه (لا وقت التحليل)");
    ok(await exists("reports", scanId) && await exists("reportRaw", scanId), "[١] والتقرير والخامّ حاضران (الموافقة لا تمسّ الفحص)");
    const cl = named(a.texts, "analyzeDevice").filter((t) => t.includes("scanProtocol consent"));
    deq(cl, ["[analyzeDevice] scanProtocol consent state=accepted basis=RECORDED"], "[١] سطر مسمّى: الحالة وأساسها بلا معرّف ولا قيمة شخصية");
    note("analyzeDevice — الموافقة", cl);
    ok(!named(a.texts, "analyzeDevice").some((t) => /scanProtocol notes=/.test(t) && /CONSENT/.test(t)), "[١] ولا ملاحظة موافقة (الحالة الطبيعية)");
    eq((await data("scanSessions", s.sessionId)).status, "completed", "[١] والجلسة اكتملت كما كانت");
    const resp = a.ret;
    ok(!JSON.stringify(resp).includes("acceptedAt") && !("consent" in resp), "[١] **لا يصل شيء من الموافقة ردّ التحليل ولا التقرير** (حقل خادمي: القاعدة 20)");
    const rep = await data("reports", scanId);
    const raw = await data("reportRaw", scanId);
    ok(!("consent" in rep) && !("consent" in raw), "[١] ولا reports ولا reportRaw تحمل consent");
  }

  // ١-ب: التركية
  {
    const joiner = "phone-cns-2";
    const s = await session({owner: OWN, joiner});
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "tr"});
    deq([r.threw, r.ret.locale, r.ret.alreadyRecorded], [null, "tr", false], "[١] التركية تُسجَّل");
    const scanId = newScanId("tr");
    await analyze(scanId, s.sessionId, joiner, fp());
    const sp = await data("scanProtocol", scanId);
    deq([sp.consent.state, sp.consent.locale, sp.consent.textVersion], ["accepted", "tr", 1], "[١] وتصل scanProtocol بلغتها");
  }

  // ═══ ٢ — الغياب حالة صريحة ═══
  // ٢-أ: جلسة بلا نداء موافقة (تطبيق قديم)
  {
    const joiner = "phone-cns-3";
    const s = await session({owner: OWN, joiner});
    const scanId = newScanId("old");
    const a = await analyze(scanId, s.sessionId, joiner, fp());
    ok(a.threw === null, "[٢] الفحص يجري بلا موافقة (تطبيق قديم لا يرسلها: الفحص لا يُرفض)");
    const sp = await data("scanProtocol", scanId);
    deq(sp.consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٢] جلسة بلا نداء موافقة ⟵ not_collected بالمفاتيح الأربعة نفسها (الغياب null صريح؛ **لا موافقة تُستنتج**)");
    const cl = named(a.texts, "analyzeDevice").filter((t) => t.includes("scanProtocol consent"));
    deq(cl, ["[analyzeDevice] scanProtocol consent state=not_collected basis=NOT_RECORDED"], "[٢] السطر المسمّى: الأساس NOT_RECORDED");
    note("analyzeDevice — بلا سجلّ موافقة", cl);
    ok(!named(a.texts, "analyzeDevice").some((t) => /scanProtocol notes=/.test(t) && /CONSENT/.test(t)), "[٢] وهي الحالة المتوقَّعة لتطبيق قديم: لا ملاحظة شذوذ");
  }
  // ٢-ب: فحص بلا جلسة
  {
    const scanId = newScanId("nosess");
    const a = await analyze(scanId, null, OWN, fp());
    ok(a.threw === null, "[٢] فحص المالك جهازه بلا جلسة ينجح");
    const sp = await data("scanProtocol", scanId);
    deq([sp.consent, sp.scanPurpose], [{state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "NO_SESSION"], "[٢] فحص بلا جلسة ⟵ not_collected، وscanPurpose NO_SESSION يميّزه (الموافقة عنده محلّية: لا مسار خادمي، معلّق في A8)");
    deq(named(a.texts, "analyzeDevice").filter((t) => t.includes("scanProtocol consent")), ["[analyzeDevice] scanProtocol consent state=not_collected basis=NO_SESSION"], "[٢] أساسه NO_SESSION");
  }
  // ٢-ج: مخزَّن غير مقروء
  {
    const joiner = "phone-cns-4";
    const s = await session({owner: OWN, joiner});
    await db.collection("protocolPending").doc(s.sessionId).set({consent: {state: "declined", textVersion: 1, locale: "ar", acceptedAt: new Date()}}, {merge: true});
    const scanId = newScanId("unread");
    const a = await analyze(scanId, s.sessionId, joiner, fp());
    ok(a.threw === null, "[٢] المخزَّن غير المقروء لا يُفشل الفحص");
    const sp = await data("scanProtocol", scanId);
    deq(sp.consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٢] حالة declined مخزَّنة بيد ⟵ not_collected (لا تُقرأ موافقةً)");
    deq(named(a.texts, "analyzeDevice").filter((t) => t.includes("scanProtocol consent")), ["[analyzeDevice] scanProtocol consent state=not_collected basis=UNREADABLE"], "[٢] والأساس UNREADABLE يُعلَن");
    ok(named(a.texts, "analyzeDevice").some((t) => t.startsWith("[analyzeDevice] scanProtocol notes=") && t.includes("CONSENT_NOT_RECOGNIZED")), "[٢] وملاحظة شذوذ مسمّاة CONSENT_NOT_RECOGNIZED (تُطبَع ولا تُكتب)");
    ok(!("notes" in sp), "[٢] والملاحظة لا تُكتب في المستند");
  }

  // ═══ ٣ — الأوّل يبقى ═══
  {
    const joiner = "phone-cns-5";
    const s = await session({owner: OWN, joiner});
    const first = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    const stored1 = (await data("protocolPending", s.sessionId)).consent;
    const second = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    deq([first.ret.alreadyRecorded, second.ret.alreadyRecorded], [false, true], "[٣] النداء الثاني بالقيم نفسها: alreadyRecorded=true");
    deq({...second.ret}, {sessionId: s.sessionId, state: "accepted", textVersion: 1, locale: "ar", alreadyRecorded: true}, "[٣] ويردّ المخزَّن");
    const stored2 = (await data("protocolPending", s.sessionId)).consent;
    eq(stored2.acceptedAt.toMillis(), stored1.acceptedAt.toMillis(), "[٣] acceptedAt لم يتغيّر: لا كتابة ثانية (الدليل لا يُعاد كتابته)");
    eq(named(second.texts, FN)[0], `[${FN}] recorded session=${sid(s.sessionId)} caller=${sid(joiner)} textVersion=1 locale=ar alreadyRecorded=true`, "[٣] سطر النداء الثاني: alreadyRecorded=true بلا differs");
    const third = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "tr"});
    deq([third.ret.locale, third.ret.alreadyRecorded], ["ar", true], "[٣] نداء بلغة أخرى ⟵ يردّ المخزَّن (ar) لا المرسَل: الأوّل يبقى");
    eq(named(third.texts, FN)[0], `[${FN}] recorded session=${sid(s.sessionId)} caller=${sid(joiner)} textVersion=1 locale=ar alreadyRecorded=true differs=true`, "[٣] والسجلّ يعلن differs=true");
    deq((await data("protocolPending", s.sessionId)).consent.locale, "ar", "[٣] والمستند بحاله (ar)");
    note("recordScanConsent — النداء الثاني", [named(second.texts, FN)[0], named(third.texts, FN)[0]]);
  }
  // ٣-ب: نداءان متزامنان
  {
    const joiner = "phone-cns-6";
    const s = await session({owner: OWN, joiner});
    const [a, b] = await Promise.all([
      consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"}),
      consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"}),
    ]);
    ok(a.threw === null && b.threw === null, "[٣] النداءان المتزامنان ينجحان");
    eq([a.ret.alreadyRecorded, b.ret.alreadyRecorded].filter((x) => x === false).length, 1, "[٣] واحد منهما فقط كتب (alreadyRecorded=false) والآخر وجد المكتوب — المعاملة تحسم السباق");
    deq([a.ret.locale, b.ret.locale, a.ret.textVersion, b.ret.textVersion], ["ar", "ar", 1, 1], "[٣] وكلاهما بالقيم المخزَّنة");
  }

  // ═══ ٤ — الرفوض على الدالّة الحقيقية ═══
  {
    const joiner = "phone-cns-7";
    const s = await session({owner: OWN, joiner});
    const sidRaw = s.sessionId;
    const pendingBefore = await count("protocolPending");
    const beforeDoc = JSON.stringify(await data("protocolPending", sidRaw));
    // بلا auth
    let r = await consent(null, {sessionId: sidRaw, textVersion: 1, locale: "ar"}, null);
    expectRefusal("[٤] بلا auth", r, {code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "CONSENT_NOT_AUTHENTICATED", logReason: "CONSENT_NOT_AUTHENTICATED", logExtra: ` caller=${sid(null)}`});
    r = await consent(null, {sessionId: sidRaw, textVersion: 1, locale: "ar"}, {uid: "", token: tokenOf("anonymous")});
    eq(r.threw.details.reasonCode, "CONSENT_NOT_AUTHENTICATED", "[٤] uid فارغ ⟵ غير مصادق");
    // sessionId
    for (const [label, d] of [["غائب", {textVersion: 1, locale: "ar"}], ["فارغ", {sessionId: "", textVersion: 1, locale: "ar"}], ["مسافات", {sessionId: "   ", textVersion: 1, locale: "ar"}], ["رقم", {sessionId: 5, textVersion: 1, locale: "ar"}]]) {
      r = await consent(joiner, d);
      deq([r.threw.code, r.threw.message, r.threw.details], ["invalid-argument", "sessionId مطلوب", {reasonCode: "CONSENT_SESSION_ID_REQUIRED"}], `[٤] sessionId ${label} ⟵ CONSENT_SESSION_ID_REQUIRED`);
    }
    // نسخة النصّ: كل سبب قراءة
    for (const [label, v, reason, extra] of [
      ["غائبة", undefined, "CONSENT_TEXT_VERSION_REQUIRED", ""], ["null", null, "CONSENT_TEXT_VERSION_REQUIRED", ""],
      ["صفر", 0, "CONSENT_TEXT_VERSION_INVALID", " cause=BELOW_FIRST_VERSION"], ["كسر", 1.5, "CONSENT_TEXT_VERSION_INVALID", " cause=NOT_AN_INTEGER"],
      ["أحدث من الحالية", CONSENT_TEXT_VERSION + 1, "CONSENT_TEXT_VERSION_INVALID", " cause=ABOVE_CURRENT_VERSION"], ["نصّ", "1", "CONSENT_TEXT_VERSION_INVALID", " cause=NOT_A_FINITE_NUMBER"],
    ]) {
      r = await consent(joiner, {sessionId: sidRaw, ...(v === undefined ? {} : {textVersion: v}), locale: "ar"});
      expectRefusal(`[٤] نسخة ${label}`, r, {code: "invalid-argument", message: reason, reasonCode: reason, logReason: reason, logExtra: extra, ids: [sidRaw, joiner]});
    }
    // اللغة
    for (const [label, loc, reason] of [["غائبة", undefined, "CONSENT_LOCALE_REQUIRED"], ["فارغة", "", "CONSENT_LOCALE_REQUIRED"], ["إنجليزية", "en", "CONSENT_LOCALE_INVALID"], ["بأحرف كبيرة", "AR", "CONSENT_LOCALE_INVALID"]]) {
      r = await consent(joiner, {sessionId: sidRaw, textVersion: 1, ...(loc === undefined ? {} : {locale: loc})});
      expectRefusal(`[٤] لغة ${label}`, r, {code: "invalid-argument", message: reason, reasonCode: reason, logReason: reason});
    }
    // المالك
    r = await consent(OWN, {sessionId: sidRaw, textVersion: 1, locale: "ar"});
    expectRefusal("[٤] المالك يسجّل موافقة الهاتف المفحوص", r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT", logReason: "SESSION_NOT_JOINER", logExtra: " role=owner", ids: [sidRaw, OWN]});
    // غريب
    r = await consent("stranger-cns", {sessionId: sidRaw, textVersion: 1, locale: "ar"});
    expectRefusal("[٤] غريب", r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT", logReason: "SESSION_NOT_JOINER", logExtra: " joinedBy=other-uid"});
    // جلسة غير موجودة: الردّ نفسه
    r = await consent(joiner, {sessionId: "no-such-session-cns", textVersion: 1, locale: "ar"});
    expectRefusal("[٤] جلسة غير موجودة", r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT", logReason: "SESSION_NOT_FOUND"});
    ok(!(await exists("protocolPending", "no-such-session-cns")) && !(await exists("scanSessions", "no-such-session-cns")), "[٤] ولم يُنشأ شيء لجلسة غير موجودة");
    // معرّف لا يصلح معرّف مستند: الردّ الموحَّد لا خطأ داخلي
    for (const bad of ["a/b", "..", ".", "x".repeat(1501)]) {
      r = await consent(joiner, {sessionId: bad, textVersion: 1, locale: "ar"});
      expectRefusal(`[٤] sessionId لا يصلح معرّف مستند (${bad.slice(0, 6)}…)`, r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT", logReason: "SESSION_NOT_FOUND", logExtra: " cause=SESSION_ID_NOT_A_DOCUMENT_ID"});
    }
    // كل ما سبق بلا أثر
    eq(await count("protocolPending"), pendingBefore, "[٤] عدد مستندات protocolPending لم يتغيّر");
    eq(JSON.stringify(await data("protocolPending", sidRaw)), beforeDoc, "[٤] ومستند الجلسة بحاله: كل الرفوض أعلاه بلا كتابة");
  }
  // ٤-ب: pending — لم ينضمّ أحد
  {
    const created = await create(OWN);
    const r = await consent("phone-cns-8", {sessionId: created.ret.sessionId, textVersion: 1, locale: "ar"});
    expectRefusal("[٤] pending (لم ينضمّ أحد)", r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT", logReason: "SESSION_NOT_JOINER", logExtra: " joinedBy=absent"});
    ok(!("consent" in (await data("protocolPending", created.ret.sessionId))), "[٤] ولا موافقة كُتبت");
    const own = await consent(OWN, {sessionId: created.ret.sessionId, textVersion: 1, locale: "ar"});
    eq(own.threw.details.reasonCode, "SESSION_NOT_PARTICIPANT", "[٤] والمالك على pending أيضاً مرفوض");
  }
  // ٤-ج: completed بعد التحليل
  {
    const joiner = "phone-cns-9";
    const s = await session({owner: OWN, joiner});
    await analyze(newScanId("done"), s.sessionId, joiner, fp());
    eq((await data("scanSessions", s.sessionId)).status, "completed", "[٤] (تمهيد) الجلسة اكتملت");
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    expectRefusal("[٤] completed", r, {...TECH("CONSENT_SESSION_NOT_SCANNING"), logReason: "CONSENT_SESSION_NOT_SCANNING", logExtra: " status=completed"});
    ok(!("consent" in (await data("protocolPending", s.sessionId))), "[٤] ولا موافقة متأخّرة تُكتب بعد الفحص (لا تُسجَّل موافقة على فحص جرى)");
  }
  // ٤-د: cancelled و«لا أوافق»
  {
    const joiner = "phone-cns-10";
    const s = await session({owner: OWN, joiner});
    const c = await cancel(joiner, s.sessionId, "consent_declined");
    ok(c.threw === null, `[٥] «لا أوافق»: الجهاز المنضمّ يلغي بسبب consent_declined: ${c.threw && c.threw.message}`);
    const sess = await data("scanSessions", s.sessionId);
    deq([sess.status, sess.cancelReason], ["cancelled", "consent_declined"], "[٥] الجلسة ملغاة بسبب consent_declined (السجلّ الوحيد للرفض: عدد بلا معرّف جهاز)");
    ok(!("deviceId" in sess) && !("identifiers" in sess) && !("fingerprint" in sess), "[٥] ولا معرّف جهاز في مستند الجلسة (لا يُرسل معرّف)");
    const pending = await data("protocolPending", s.sessionId);
    ok(!("consent" in pending), "[٥] ولا سجلّ موافقة كُتب لجلسة رُفضت (declined لا يُكتب في أيّ مستند خادمي)");
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    expectRefusal("[٥] تسجيل بعد الرفض", r, {...TECH("CONSENT_SESSION_NOT_SCANNING"), logReason: "CONSENT_SESSION_NOT_SCANNING", logExtra: " status=cancelled"});
    const declinedScanId = newScanId("declined");
    const a = await analyze(declinedScanId, s.sessionId, joiner, fp());
    ok(a.threw !== null, "[٥] والتحليل على الجلسة الملغاة يُرفض (لا فحص بعد الرفض)");
    ok(!(await exists("scanProtocol", declinedScanId)) && !(await exists("reports", declinedScanId)), "[٥] ولا scanProtocol ولا تقرير لجلسة ملغاة");
  }
  // ٤-هـ: expired — منتهية مسجَّلة، ومنقضية لم تُسجَّل
  {
    const joiner = "phone-cns-11";
    await seedSession("s-cns-expired-rec", {ownerId: OWN, joinedBy: joiner, status: "expired", createdAt: PAST(120), expiresAt: PAST(60)});
    let r = await consent(joiner, {sessionId: "s-cns-expired-rec", textVersion: 1, locale: "ar"});
    expectRefusal("[٤] expired مسجَّلة", r, {...TECH("CONSENT_SESSION_NOT_SCANNING"), logReason: "CONSENT_SESSION_NOT_SCANNING", logExtra: " status=expired"});
    await seedSession("s-cns-expired-due", {ownerId: OWN, joinedBy: joiner, status: "scanning", createdAt: PAST(120), expiresAt: PAST(60)});
    r = await consent(joiner, {sessionId: "s-cns-expired-due", textVersion: 1, locale: "ar"});
    expectRefusal("[٤] scanning انقضى وقتها", r, {code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED", logExtra: " expiredRecorded=true"});
    const sess = await data("scanSessions", "s-cns-expired-due");
    eq(sess.status, "expired", "[٤] وتُكتب «منتهية» في المعاملة نفسها (قرار المستخدم: تُكتب حين تمسّها دالّة بعد انقضاء وقتها)");
    ok(TS(sess.expiredAt), "[٤] مع expiredAt وقت الخادم");
    ok(!(await exists("protocolPending", "s-cns-expired-due")), "[٤] ولا موافقة كُتبت لجلسة منقضية");
  }
  // ٤-و: حالة وexpiresAt تالفان
  {
    const joiner = "phone-cns-12";
    await seedSession("s-cns-nostatus", {ownerId: OWN, joinedBy: joiner, expiresAt: FUTURE()});
    let r = await consent(joiner, {sessionId: "s-cns-nostatus", textVersion: 1, locale: "ar"});
    expectRefusal("[٤] حالة غائبة", r, {...TECH("SESSION_STATUS_UNKNOWN"), logReason: "SESSION_STATUS_UNKNOWN", logExtra: " statusState=ABSENT"});
    await seedSession("s-cns-noexp", {ownerId: OWN, joinedBy: joiner, status: "scanning"});
    r = await consent(joiner, {sessionId: "s-cns-noexp", textVersion: 1, locale: "ar"});
    expectRefusal("[٤] expiresAt غائب", r, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_EXPIRES_AT_INVALID", logReason: "SESSION_EXPIRES_AT_INVALID"});
    ok(!(await exists("protocolPending", "s-cns-nostatus")) && !(await exists("protocolPending", "s-cns-noexp")), "[٤] والرفضان بلا كتابة");
    eq((await data("scanSessions", "s-cns-noexp")).status, "scanning", "[٤] والجلسة تالفة الوقت لا تُكتب منتهية (لا يُقرأ الغياب انقضاءً)");
  }
  // ٤-ز: مخزَّن غير مقروء لا يُكتب فوقه
  {
    const joiner = "phone-cns-13";
    const s = await session({owner: OWN, joiner});
    const weird = {state: "accepted", textVersion: CONSENT_TEXT_VERSION + 1, locale: "ar", acceptedAt: new Date()}; // (2026-10-23) «فوق الحالية» مشتقّ من الثابت لا رقم حرفي (كان 7)
    await db.collection("protocolPending").doc(s.sessionId).set({consent: weird}, {merge: true});
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    expectRefusal("[٤] مخزَّن بنسخة لا يعرفها الخادم", r, {...TECH("CONSENT_STORED_UNREADABLE"), logReason: "CONSENT_STORED_UNREADABLE"});
    const after = (await data("protocolPending", s.sessionId)).consent;
    deq([after.state, after.textVersion, after.locale], ["accepted", CONSENT_TEXT_VERSION + 1, "ar"], "[٤] والمخزَّن بحاله: لا يُكتب فوق ما لا يُقرأ");
  }

  // ═══ ٥-ب — النسخة الحالية والأقدم (2026-10-23: رُفعت CONSENT_TEXT_VERSION من 1 إلى 2): كلتاهما تُسجَّلان بنسختها وتُنسخان إلى scanProtocol؛ وفوق الحالية يُرفض ═══
  {
    let seq = 0;
    for (const v of [1, 2]) { // 1 القديمة و2 الجديدة (ما يرسله التطبيق بعد تغيير النصّ)
      seq++;
      const joiner = `phone-cns-tv-${seq}`;
      const s = await session({owner: OWN, joiner});
      const r = await consent(joiner, {sessionId: s.sessionId, textVersion: v, locale: "ar"});
      ok(r.threw === null, `[٥-ب] نسخة ${v}: التسجيل ينجح (${r.threw && r.threw.message})`);
      deq([r.ret.textVersion, r.ret.alreadyRecorded], [v, false], `[٥-ب] نسخة ${v}: الردّ بالنسخة المخزَّنة`);
      eq((await data("protocolPending", s.sessionId)).consent.textVersion, v, `[٥-ب] نسخة ${v}: المخزَّن بنسختها`);
      const scanId = newScanId(`tv${v}`);
      const a = await analyze(scanId, s.sessionId, joiner, fp());
      ok(a.threw === null, `[٥-ب] نسخة ${v}: التحليل ينجح`);
      deq([(await data("scanProtocol", scanId)).consent.state, (await data("scanProtocol", scanId)).consent.textVersion], ["accepted", v], `[٥-ب] نسخة ${v}: وscanProtocol.consent بنسختها`);
    }
    const joiner = "phone-cns-tv-above";
    const s = await session({owner: OWN, joiner});
    const r = await consent(joiner, {sessionId: s.sessionId, textVersion: CONSENT_TEXT_VERSION + 1, locale: "ar"});
    expectRefusal("[٥-ب] نسخة الحالية + 1", r, {...BAD("CONSENT_TEXT_VERSION_INVALID"), logReason: "CONSENT_TEXT_VERSION_INVALID", logExtra: " cause=ABOVE_CURRENT_VERSION"});
    ok(!("consent" in ((await data("protocolPending", s.sessionId)) || {})), "[٥-ب] ولا موافقة كُتبت");
  }

  // ═══ ٦ — جزء الموافقة للمحلّ (ق40): consent=true وحدها تفعّل؛ غيرها يُرفض CONSENT_PART_NOT_ENABLED بلا كتابة ═══
  const PART_CODE = "CONSENT_PART_NOT_ENABLED";
  let partSeq = 0;
  for (const [label, parts, enabled] of [
    ["محلّ بالجزء consent=true", {consent: true}, true],
    ["محلّ بالجزء false", {consent: false}, false],
    ["محلّ بلا protocolParts", undefined, false],
    ["محلّ بـconsent نصّ «true»", {consent: "true"}, false],
    ["محلّ بأجزاء أخرى مفعَّلة بلا consent", {purposes: true, batteryBeforeAfter: true, coldRepeat: true, returns: true, doubleEval: true}, false],
  ]) {
    partSeq++;
    const owner = `own-cns-part-${partSeq}`;
    const joiner = `phone-cns-part-${partSeq}`;
    await seedOwner(owner, parts === undefined ? {} : {protocolParts: parts});
    const created = await create(owner);
    await join(created.ret.code, joiner);
    const sessionId = created.ret.sessionId;
    const pendingBefore = await data("protocolPending", sessionId);
    const r = await consent(joiner, {sessionId, textVersion: 1, locale: "ar"});
    if (enabled) {
      deq([r.threw, r.ret.alreadyRecorded], [null, false], `[٦] ${label}: التسجيل ينجح`);
      ok("consent" in (await data("protocolPending", sessionId)), `[٦] ${label}: ومفتاح consent كُتب`);
    } else {
      const line = expectRefusal(`[٦] ${label}`, r, {...TECH(PART_CODE), logReason: PART_CODE, logExtra: " part=consent", ids: [sessionId, joiner, owner]});
      note("recordScanConsent — رفض جزء المحلّ", [line]);
      deq(await data("protocolPending", sessionId), pendingBefore, `[٦] ${label}: protocolPending كما كان حرفاً (لا موافقة مسجَّلة)`);
      eq((await data("scanSessions", sessionId)).status, "scanning", `[٦] ${label}: والجلسة على scanning (الرفض لا يمسّها)`);
    }
  }
  {
    // مستند المالك غائب: جلسة scanning مزروعة بمالك لا مستند له ⟵ الرمز نفسه مع owner=absent (لا نجاح ولا قيمة افتراضية)
    const joiner = "phone-cns-ghost";
    await seedSession("s-cns-ghost-owner", {ownerId: "own-cns-ghost", joinedBy: joiner, status: "scanning", createdAt: PAST(5), expiresAt: FUTURE()});
    const r = await consent(joiner, {sessionId: "s-cns-ghost-owner", textVersion: 1, locale: "ar"});
    expectRefusal("[٦] مستند المالك غائب", r, {...TECH(PART_CODE), logReason: PART_CODE, logExtra: " owner=absent part=consent", ids: ["s-cns-ghost-owner", joiner, "own-cns-ghost"]});
    ok(!(await exists("protocolPending", "s-cns-ghost-owner")), "[٦] مستند المالك غائب: لا protocolPending أُنشئ (لا كتابة)");
  }
  {
    // الأوّل يبقى: موافقة مسجَّلة تُردّ كما هي ولو أُطفئ الجزء بعدها
    const owner = "own-cns-part-flip";
    const joiner = "phone-cns-part-flip";
    await seedOwner(owner, {protocolParts: {consent: true}});
    const created = await create(owner);
    await join(created.ret.code, joiner);
    const first = await consent(joiner, {sessionId: created.ret.sessionId, textVersion: 1, locale: "ar"});
    deq([first.threw, first.ret.alreadyRecorded], [null, false], "[٦] قلب الجزء: التسجيل الأوّل ينجح");
    await seedOwner(owner, {protocolParts: {consent: false}});
    const second = await consent(joiner, {sessionId: created.ret.sessionId, textVersion: 1, locale: "ar"});
    deq([second.threw, second.ret.alreadyRecorded], [null, true], "[٦] قلب الجزء: النداء الثاني بعد إطفاء الجزء يردّ المخزَّن alreadyRecorded=true (لا رفض)");
  }
  {
    // الانقضاء يسبق الجزء: مالك بلا الجزء وجلسة scanning منقضية ⟵ SESSION_EXPIRED وتُكتب «منتهية»
    const owner = "own-cns-part-expired";
    const joiner = "phone-cns-part-expired";
    await seedOwner(owner, {protocolParts: {consent: false}});
    await seedSession("s-cns-part-expired", {ownerId: owner, joinedBy: joiner, status: "scanning", createdAt: PAST(120), expiresAt: PAST(60)});
    const r = await consent(joiner, {sessionId: "s-cns-part-expired", textVersion: 1, locale: "ar"});
    expectRefusal("[٦] منقضية ومالك بلا الجزء", r, {code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED", logExtra: " expiredRecorded=true", ids: ["s-cns-part-expired", joiner, owner]});
    eq((await data("scanSessions", "s-cns-part-expired")).status, "expired", "[٦] منقضية ومالك بلا الجزء: كُتبت «منتهية» (الانقضاء يسبق الجزء)");
  }

  // ═══ ٧ — لا حذف ═══
  {
    const sessionsBefore = await count("scanSessions");
    const joiner = "phone-cns-14";
    const s = await session({owner: OWN, joiner});
    await consent(joiner, {sessionId: s.sessionId, textVersion: 1, locale: "ar"});
    eq(await count("scanSessions"), sessionsBefore + 1, "[٧] التسجيل لا يحذف جلسة");
  }

  console.log("\nمرصود (سطور السجلّ الجديدة):\n" + OBSERVED.join("\n"));
  console.log(`\nscanConsent.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
