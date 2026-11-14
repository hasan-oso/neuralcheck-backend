// E2E test: التصحيح بالإلحاق — correctProtocolRecord الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-18، 2026-10-21 +03).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch نحو deepseek وحده، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل — لأنّ الفحوص الحقيقية تُنتَج بـanalyzeDevice الحقيقية (createScanSession ← joinScanSession ← analyzeDevice)
// فيكون scanProtocol المصحَّح هو الذي يكتبه المنتِج الحقيقي (القاعدة 41). **لا استبدال لأيّ طبقة أخرى** (الدالّة والمعاملات والمحاكي كما هي)، ولا حقن فشل. حمولة الفحص fv67 الذهبية الحقيقية كما في repeatScan.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-٥ (:854-868) وdocs/PROTOCOL_CONTRACT.md §٢ A11 (يحمل نصّها المقتبس وكل شكل سلك وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ بوّابة المشرف: بلا auth · غير مشرف · غير مؤكَّد البريد · بلا بريد ⟵ رفض بالنصّين القائمين، بلا أثر على أيّ مجموعة.
//   ٢ exclude/unexclude على فحص حقيقي له scanProtocol: العلامة `exclusion {state, reasonCode, at}` على scanProtocol وباقي حقوله بحاله، والسطر الملحَق بتسعة حقول (قبل/بعد/رمز السبب/المشرف مُهشَّراً/seq/وقت الخادم)،
//      وغير المتغيّر لا يُكتب، وتغيير السبب سطر ثانٍ، والتراجع، والأسباب الثلاثة بكل قيمها، والهدف برمز التقرير (NC-…) بأيّ حالة أحرف، والقارئ الواحد readExclusion على المستندات الحقيقية.
//   ٣ **فحص أقدم من scanProtocol (E16)**: السطر وحده بأساس REPORT_ONLY ولا scanProtocol شكلي يُنشأ، والتراجع، والربط مرفوض، وفحص غير موجود، ورمز تقرير غير موجود/مكرَّر.
//   ٤ unlink وrelink على scanProtocol بحالات ربط مزروعة (الربط يبنيه P6-05): linkState وحده يتغيّر في unlink (linkedScanId وlinkMethod باقيان)، وrelink يكتب linkedScanId وlinkState، والرفوض بأسبابها.
//   ٥ سباق: فعلان متزامنان على فحص واحد ⟵ سطران بـseq 1 و2 (لا ضياع ولا تكرار)، والعلامة تساوي بعد آخرهما.
//   ٦ المدخل: كل رفض مسمّى بسببه (فعل · هدف · سبب · مفتاح مجهول · لا ينطبق) و resolveIdentityConflict ⟵ ACTION_NOT_SPECIFIED، بلا كتابة.
//   ٧ مستندات تالفة (علامة · سطور) ⟵ EXCLUSION_UNREADABLE بلا كتابة.
//   ٨ لا حذف أبداً: السطور لا تتناقص، ولا مستند يُحذف، والتقرير والخامّ لم يُمسّا؛ ولا معرّف خامّ (scanId · رمز التقرير · uid) في أيّ سطر سجلّ.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/protocolCorrection.e2e.test.js"

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

const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {correctProtocolRecord} = require("../src/admin/protocolCorrectionAdmin");
const {readExclusion} = require("../src/protocol/protocolCorrection");
const {clearCacheConfigCache} = require("../src/utils/resolveCacheConfig");
const {hashIdForLog} = require("../src/utils/logRedaction");

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
  const key = `pcx-${++fpSeq}-${Date.now()}`;
  f.device.deviceProfileKey = {primary: `prim-${key}`, layerA_keystore: `ks-${key}`, layerB_firebaseId: `fid-${key}`, layerC_androidId: `aid-${key}`, layerD_buildSig: `bs-${key}`, layerE_sensorSig: `ss-${key}`};
  return f;
}

const DAY = 24 * 3600 * 1000;
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const linesOf = async (scanId) => (await db.collection("protocolCorrections").where("scanId", "==", scanId).get()).docs.map((d) => d.data()).sort((a, b) => a.seq - b.seq);
const seedOwner = (uid) => db.collection("users").doc(uid).set({scansRemaining: 500, scansTotal: 500, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY)});
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const ADMIN_UID = "admin-pcx-1";
const ADMIN = {uid: ADMIN_UID, token: {email: ADMIN_EMAILS[0], email_verified: true}};

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
const run = (d, auth = ADMIN) => call(() => correctProtocolRecord.run({data: d, auth, rawRequest: {headers: {}}}));
const create = (uid) => call(() => createScanSession.run({data: {}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
const join = (code, uid) => call(() => joinScanSession.run({data: {code}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const analyze = (scanId, sessionId, uid, fingerprint) => call(() => analyzeDevice.run({
  data: {scanId, fingerprint, sessionId}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}},
}));
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const FN = "correctProtocolRecord";
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
let scanSeq = 0;
const newScanId = (tag) => `scan-pcx-${tag}-${++scanSeq}-${Date.now()}`;

function expectRefusal(label, r, {code, reasonCode, field = null, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, reasonCode, {reasonCode, ...(field ? {field} : {})}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, FN).filter((t) => t.startsWith(`[${FN}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${FN}] refused reason=${reasonCode} caller=${sid(ADMIN_UID)}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${reasonCode}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return lines[0];
}
const INVALID = "invalid-argument";
const PRECOND = "failed-precondition";
const NOTFOUND = "not-found";

/** فحص حقيقي بجلسة: createScanSession ← joinScanSession ← analyzeDevice. يعيد scanId ورمز التقرير. */
async function realScan(owner, joiner, tag) {
  const created = await create(owner);
  assert.ok(created.threw === null, `إنشاء الجلسة: ${created.threw && created.threw.message}`);
  const joined = await join(created.ret.code, joiner);
  assert.ok(joined.threw === null, `الانضمام: ${joined.threw && joined.threw.message}`);
  const scanId = newScanId(tag);
  const a = await analyze(scanId, created.ret.sessionId, joiner, fp());
  assert.ok(a.threw === null, `التحليل: ${a.threw && a.threw.message}`);
  // رمز التقرير الذي أنتجه المنتِج الحقيقي؛ إن لم يكن فريداً بين الفحوص (كعب المزوّد يعيد الردّ نفسه) يُجعَل فريداً في بيانات الاختبار وحدها كي يُحلّ هدف الرمز بلا غموض.
  const rep = await data("reports", scanId);
  const unique = `NC-T${String(scanSeq).padStart(2, "0")}${String(Date.now()).slice(-3)}`;
  await db.collection("reports").doc(scanId).update({shortId: unique});
  return {scanId, shortId: unique, producedShortId: rep.shortId, sessionId: created.ret.sessionId};
}

(async () => {
  const OWN = "own-pcx-1";
  await seedOwner(OWN);
  clearCacheConfigCache();

  // ═══ ١ — بوّابة المشرف ═══
  {
    const before = {protocol: await count("scanProtocol"), corrections: await count("protocolCorrections"), reports: await count("reports")};
    for (const [label, auth, code, message] of [
      ["بلا auth", null, "unauthenticated", "غير مصادق"],
      ["غير مشرف", {uid: "u-not-admin", token: {email: "someone@example.com", email_verified: true}}, "permission-denied", "صلاحية Admin مطلوبة"],
      ["مشرف غير مؤكَّد البريد", {uid: "u-unverified", token: {email: ADMIN_EMAILS[0], email_verified: false}}, "permission-denied", "صلاحية Admin مطلوبة"],
      ["مشرف بلا ادّعاء التحقّق", {uid: "u-noclaim", token: {email: ADMIN_EMAILS[0]}}, "permission-denied", "صلاحية Admin مطلوبة"],
      ["بلا بريد", {uid: "u-noemail", token: {email_verified: true}}, "permission-denied", "صلاحية Admin مطلوبة"],
      ["email_verified نصّ", {uid: "u-str", token: {email: ADMIN_EMAILS[0], email_verified: "true"}}, "permission-denied", "صلاحية Admin مطلوبة"],
    ]) {
      const r = await run({action: "exclude", scanId: "gate-scan", reason: "test"}, auth);
      deq([r.threw && r.threw.code, r.threw && r.threw.message], [code, message], `[١] ${label} ⟵ ${message}`);
    }
    deq({protocol: await count("scanProtocol"), corrections: await count("protocolCorrections"), reports: await count("reports")}, before, "[١] كل الرفوض أعلاه بلا أثر على أيّ مجموعة");
  }

  // ═══ ٢ — exclude/unexclude على فحص حقيقي له scanProtocol ═══
  let real;
  {
    real = await realScan(OWN, "phone-pcx-1", "real");
    const spBefore = await data("scanProtocol", real.scanId);
    const reportBefore = JSON.stringify(await data("reports", real.scanId));
    const rawBefore = JSON.stringify(await data("reportRaw", real.scanId));
    ok(!("exclusion" in spBefore), "[٢] (تمهيد) scanProtocol الحقيقي بلا علامة استبعاد قبل أيّ تصحيح (ثلاثة عشر حقلاً بلا exclusion)");
    deq(readExclusion({protocolData: spBefore, correctionLines: []}), {state: "NOT_RECORDED", reasonCode: null}, "[٢] والقارئ الواحد يقرأه NOT_RECORDED (حالة صريحة، لا «غير مستبعَد» صامتاً)");

    const r1 = await run({action: "exclude", scanId: real.scanId, reason: "test"});
    ok(r1.threw === null, `[٢] exclude ينجح: ${r1.threw && r1.threw.message}`);
    deq(r1.ret, {scanId: real.scanId, action: "exclude", changed: true, basis: "SCAN_PROTOCOL", exclusion: {state: "excluded", reasonCode: "test"}, linkState: "none", linkedScanId: null, correctionSeq: 1}, "[٢] الردّ: الحالة بعد الفعل ورقم السطر الملحَق");
    const sp1 = await data("scanProtocol", real.scanId);
    deq(Object.keys(sp1.exclusion).sort(), ["at", "reasonCode", "state"], "[٢] العلامة exclusion بثلاثة مفاتيح: state · reasonCode · at");
    deq([sp1.exclusion.state, sp1.exclusion.reasonCode], ["excluded", "test"], "[٢] مستبعَد بسبب test");
    ok(TS(sp1.exclusion.at), "[٢] at وقت الخادم");
    const {exclusion: _e1, ...rest1} = sp1;
    const {...restBefore} = spBefore;
    deq(JSON.parse(JSON.stringify(rest1)), JSON.parse(JSON.stringify(restBefore)), "[٢] **باقي حقول scanProtocol بحالها** (التصحيح يلمس العلامة وحدها)");
    const lines1 = await linesOf(real.scanId);
    eq(lines1.length, 1, "[٢] سطر واحد ملحَق");
    deq(Object.keys(lines1[0]).sort(), ["action", "after", "at", "basis", "before", "by", "reasonCode", "scanId", "seq"], "[٢] السطر بتسعة حقول بالضبط");
    deq([lines1[0].scanId, lines1[0].action, lines1[0].reasonCode, lines1[0].basis, lines1[0].seq, lines1[0].by], [real.scanId, "exclude", "test", "SCAN_PROTOCOL", 1, sid(ADMIN_UID)], "[٢] قيم السطر: الفحص والفعل والسبب والأساس وseq والمشرف مُهشَّراً");
    deq([lines1[0].before, lines1[0].after], [{exclusion: null, linkState: "none", linkedScanId: null}, {exclusion: {state: "excluded", reasonCode: "test"}, linkState: "none", linkedScanId: null}], "[٢] القيم قبل وبعد");
    ok(TS(lines1[0].at), "[٢] وقت السطر وقت الخادم");
    note("correctProtocolRecord — كتابة", named(r1.texts, FN));
    deq(named(r1.texts, FN), [`[${FN}] written action=exclude scan=${sid(real.scanId)} caller=${sid(ADMIN_UID)} basis=SCAN_PROTOCOL seq=1 reason=test`], "[٢] سطر الكتابة المسمّى");
    ok(!r1.texts.join("\n").includes(real.scanId) && !r1.texts.join("\n").includes(ADMIN_UID), "[٢] لا scanId خامّ ولا uid");
    deq(readExclusion({protocolData: sp1, correctionLines: lines1}), {state: "excluded", reasonCode: "test"}, "[٢] القارئ الواحد على المستندين الحقيقيين: excluded بسببه");
    eq(JSON.stringify(await data("reports", real.scanId)), reportBefore, "[٢] التقرير لم يُمسّ");
    eq(JSON.stringify(await data("reportRaw", real.scanId)), rawBefore, "[٢] والخامّ لم يُمسّ");

    // نداء ثانٍ بالسبب نفسه: لا كتابة
    const atBefore = sp1.exclusion.at.toMillis();
    const r2 = await run({action: "exclude", scanId: real.scanId, reason: "test"});
    deq(r2.ret, {scanId: real.scanId, action: "exclude", changed: false, basis: "SCAN_PROTOCOL", exclusion: {state: "excluded", reasonCode: "test"}, linkState: "none", linkedScanId: null, correctionSeq: null}, "[٢] exclude بالسبب نفسه ⟵ changed:false بلا رقم سطر");
    eq((await data("scanProtocol", real.scanId)).exclusion.at.toMillis(), atBefore, "[٢] والعلامة لم تُكتب (at بحاله)");
    eq((await linesOf(real.scanId)).length, 1, "[٢] ولا سطر ثانٍ");
    deq(named(r2.texts, FN), [`[${FN}] unchanged action=exclude scan=${sid(real.scanId)} caller=${sid(ADMIN_UID)} basis=SCAN_PROTOCOL`], "[٢] سطر «لم يتغيّر» المسمّى");

    // سبب آخر: سطر ثانٍ
    const r3 = await run({action: "exclude", scanId: real.scanId, reason: "wrong"});
    deq([r3.ret.changed, r3.ret.exclusion, r3.ret.correctionSeq], [true, {state: "excluded", reasonCode: "wrong"}, 2], "[٢] سبب آخر ⟵ تغيير يُسجَّل بـseq 2");
    const lines3 = await linesOf(real.scanId);
    deq([lines3.length, lines3[1].before.exclusion, lines3[1].after.exclusion, lines3[0].after.exclusion], [2, {state: "excluded", reasonCode: "test"}, {state: "excluded", reasonCode: "wrong"}, {state: "excluded", reasonCode: "test"}], "[٢] السطران: الأوّل كما كُتب (لا يُعدَّل)، والثاني قبل: test وبعد: wrong");
    // السبب الثالث golden_reference
    const r4 = await run({action: "exclude", scanId: real.scanId, reason: "golden_reference"});
    deq([r4.ret.changed, r4.ret.exclusion.reasonCode, r4.ret.correctionSeq], [true, "golden_reference", 3], "[٢] والسبب الثالث golden_reference ⟵ seq 3 (الأسباب الثلاثة بكل قيمها)");
    // unexclude
    const r5 = await run({action: "unexclude", scanId: real.scanId});
    deq(r5.ret, {scanId: real.scanId, action: "unexclude", changed: true, basis: "SCAN_PROTOCOL", exclusion: {state: "not_excluded", reasonCode: null}, linkState: "none", linkedScanId: null, correctionSeq: 4}, "[٢] unexclude ⟵ غير مستبعَد، وseq 4");
    const sp5 = await data("scanProtocol", real.scanId);
    deq([sp5.exclusion.state, sp5.exclusion.reasonCode, TS(sp5.exclusion.at)], ["not_excluded", null, true], "[٢] العلامة بعد التراجع: not_excluded وreasonCode null وat جديد (العلامة تبقى ولا تُحذف)");
    const lines5 = await linesOf(real.scanId);
    deq([lines5.length, lines5[3].reasonCode, lines5[3].before.exclusion, lines5[3].after.exclusion], [4, null, {state: "excluded", reasonCode: "golden_reference"}, {state: "not_excluded", reasonCode: null}], "[٢] السطر الرابع: reasonCode: null صريح (لا قائمة أسباب للتراجع في التصميم)");
    deq(readExclusion({protocolData: sp5, correctionLines: lines5}), {state: "not_excluded", reasonCode: null}, "[٢] والقارئ الواحد: not_excluded");
    const r6 = await run({action: "unexclude", scanId: real.scanId});
    deq([r6.ret.changed, r6.ret.correctionSeq], [false, null], "[٢] unexclude ثانية ⟵ changed:false");
    eq((await linesOf(real.scanId)).length, 4, "[٢] والسطور أربعة بلا زيادة");
    const r7 = await run({action: "exclude", scanId: real.scanId, reason: "test"});
    deq([r7.ret.changed, r7.ret.correctionSeq], [true, 5], "[٢] exclude بعد التراجع ⟵ يعود الاستبعاد (seq 5)");
    // السطور القديمة لم تتغيّر (بالإلحاق وحده)
    const lines7 = await linesOf(real.scanId);
    deq(lines7.slice(0, 4).map((l) => JSON.stringify([l.seq, l.action, l.reasonCode, l.before, l.after])), lines5.map((l) => JSON.stringify([l.seq, l.action, l.reasonCode, l.before, l.after])), "[٢] **السطور الأربعة الأولى لم تتغيّر بعد الخامس** (بالإلحاق لا بالاستبدال)");
    eq(await count("scanProtocol") >= 1, true, "[٢] لا scanProtocol حُذف");

    // الهدف برمز التقرير
    const bySid = await run({action: "unexclude", shortId: real.shortId.toLowerCase()});
    deq([bySid.ret.scanId, bySid.ret.changed, bySid.ret.exclusion], [real.scanId, true, {state: "not_excluded", reasonCode: null}], "[٢] الهدف برمز التقرير بأحرف صغيرة ⟵ يُحلّ إلى الفحص نفسه (التطبيع: تشذيب ورفع)");
    ok(!bySid.texts.join("\n").includes(real.shortId) && !bySid.texts.join("\n").includes(real.shortId.toLowerCase()), "[٢] ورمز التقرير (مفتاح وصول علني) لا يُطبع في أيّ سطر");
    const bySid2 = await run({action: "exclude", shortId: ` ${real.shortId} `, reason: "wrong"});
    deq([bySid2.ret.scanId, bySid2.ret.exclusion.reasonCode], [real.scanId, "wrong"], "[٢] ومع مسافات حول الرمز");
    eq((await linesOf(real.scanId)).length, 7, "[٢] سبعة سطور بعد كل ما سبق");
  }

  // ═══ ٣ — فحص أقدم من scanProtocol (E16) ═══
  {
    const OLD = "scan-old-pcx-1";
    await db.collection("reports").doc(OLD).set({shortId: "NC-OLD111", userId: "u-old", createdAt: new Date()});
    const reportBefore = JSON.stringify(await data("reports", OLD));
    const protoCount = await count("scanProtocol");
    const r1 = await run({action: "exclude", scanId: OLD, reason: "test"});
    deq(r1.ret, {scanId: OLD, action: "exclude", changed: true, basis: "REPORT_ONLY", exclusion: {state: "excluded", reasonCode: "test"}, linkState: null, linkedScanId: null, correctionSeq: 1}, "[٣] **E16**: exclude لفحص بلا scanProtocol ⟵ REPORT_ONLY، والربط null (لا ينطبق)");
    ok(!(await exists("scanProtocol", OLD)), "[٣] **لا scanProtocol شكلي يُنشأ** (E16: تُسجَّل في protocolCorrections وحدها)");
    eq(await count("scanProtocol"), protoCount, "[٣] وعدد scanProtocol لم يتغيّر");
    const l1 = await linesOf(OLD);
    deq([l1.length, l1[0].basis, l1[0].before, l1[0].after], [1, "REPORT_ONLY", {exclusion: null, linkState: null, linkedScanId: null}, {exclusion: {state: "excluded", reasonCode: "test"}, linkState: null, linkedScanId: null}], "[٣] السطر الوحيد بأساس REPORT_ONLY وقبل/بعد بلا ربط");
    deq(readExclusion({protocolData: null, correctionLines: l1}), {state: "excluded", reasonCode: "test"}, "[٣] القارئ الواحد لفحص أقدم: من آخر سطر (استعلام مساواة على scanId كما قرّر E16)");
    eq(JSON.stringify(await data("reports", OLD)), reportBefore, "[٣] والتقرير لم يُمسّ");
    const r2 = await run({action: "exclude", scanId: OLD, reason: "test"});
    deq([r2.ret.changed, r2.ret.correctionSeq], [false, null], "[٣] ثانية بالسبب نفسه ⟵ changed:false (الحالة من آخر سطر)");
    const r3 = await run({action: "unexclude", shortId: "nc-old111"});
    deq([r3.ret.scanId, r3.ret.changed, r3.ret.exclusion, r3.ret.correctionSeq], [OLD, true, {state: "not_excluded", reasonCode: null}, 2], "[٣] unexclude برمز التقرير (NC-OLD111 بأحرف صغيرة) ⟵ سطر seq 2");
    deq(readExclusion({protocolData: null, correctionLines: await linesOf(OLD)}), {state: "not_excluded", reasonCode: null}, "[٣] والقارئ: not_excluded بعد التراجع");
    eq((await run({action: "unexclude", scanId: OLD})).ret.changed, false, "[٣] unexclude على غير مستبعَد ⟵ changed:false");
    // الربط مرفوض لفحص بلا scanProtocol
    for (const d of [{action: "unlink", scanId: OLD}, {action: "relink", scanId: OLD, toScanId: "x"}]) {
      const r = await run(d);
      expectRefusal(`[٣] ${d.action} على فحص بلا scanProtocol`, r, {code: PRECOND, reasonCode: "CORRECTION_NO_PROTOCOL_RECORD", logExtra: " basis=REPORT_ONLY", ids: [OLD]});
    }
    // فحص غير موجود
    const ghost = await run({action: "exclude", scanId: "scan-ghost-pcx", reason: "test"});
    expectRefusal("[٣] فحص لا scanProtocol له ولا تقرير", ghost, {code: NOTFOUND, reasonCode: "CORRECTION_SCAN_NOT_FOUND", ids: ["scan-ghost-pcx"]});
    ok(!(await exists("protocolCorrections", "x")) && (await linesOf("scan-ghost-pcx")).length === 0, "[٣] ولا سطر لفحص غير موجود");
    // رمز تقرير غير موجود / مكرَّر
    const nf = await run({action: "exclude", shortId: "NC-NOPE99", reason: "test"});
    expectRefusal("[٣] رمز تقرير غير موجود", nf, {code: NOTFOUND, reasonCode: "CORRECTION_SHORT_ID_NOT_FOUND", logExtra: ` shortId=${sid("NC-NOPE99")}`, ids: ["NC-NOPE99"]});
    await db.collection("reports").doc("scan-dup-pcx-1").set({shortId: "NC-DUP222"});
    await db.collection("reports").doc("scan-dup-pcx-2").set({shortId: "NC-DUP222"});
    const dup = await run({action: "exclude", shortId: "NC-DUP222", reason: "test"});
    expectRefusal("[٣] رمز تقرير مكرَّر في تقريرين", dup, {code: PRECOND, reasonCode: "CORRECTION_SHORT_ID_AMBIGUOUS", logExtra: ` shortId=${sid("NC-DUP222")} matches=2`, ids: ["NC-DUP222"]});
    eq((await linesOf("scan-dup-pcx-1")).length + (await linesOf("scan-dup-pcx-2")).length, 0, "[٣] والغموض لا يكتب لأيّ منهما (بلا limit(1): لا يُختار أحدهما)");
  }

  // ═══ ٤ — unlink وrelink على حالات ربط مزروعة ═══
  {
    const seedProto = (id, over = {}) => db.collection("scanProtocol").doc(id).set({scanPurpose: "battery_after", purposeSource: "selected", linkedScanId: null, linkState: "none", linkMethod: null, protocolVersion: 1, settingsVersion: "SETTINGS_ABSENT", createdAt: new Date(), ...over});
    await seedProto("link-before-1", {scanPurpose: "battery_before"});
    await seedProto("link-before-2", {scanPurpose: "battery_before"});
    await seedProto("link-a", {linkedScanId: "link-before-1", linkState: "active", linkMethod: "auto_confirmed"});
    const spBefore = await data("scanProtocol", "link-a");
    const u1 = await run({action: "unlink", scanId: "link-a"});
    deq(u1.ret, {scanId: "link-a", action: "unlink", changed: true, basis: "SCAN_PROTOCOL", exclusion: null, linkState: "unlinked_by_admin", linkedScanId: "link-before-1", correctionSeq: 1}, "[٤] unlink على ربط active ⟵ unlinked_by_admin، وlinkedScanId يبقى مسجَّلاً");
    const sp1 = await data("scanProtocol", "link-a");
    deq([sp1.linkState, sp1.linkedScanId, sp1.linkMethod], ["unlinked_by_admin", "link-before-1", "auto_confirmed"], "[٤] **linkMethod لا يتغيّر** (P:491: «تصحيح المشرف لا يغيّر linkMethod») وlinkedScanId بحاله");
    // (ق36 أ، 2026-10-22؛ القاعدة 23: كان «ولا مفتاح جديد على المستند»؛ unlink يُبطل الآن ملاحظة الطراز بـnull صريح فيُضاف المفتاح linkModelCheck على المستند المزروع بلا الحقل — ولا غيره، والتصحيح لم يضف exclusion لأنه لم يستبعد)
    deq(Object.keys(sp1).sort(), [...Object.keys(spBefore), "linkModelCheck"].sort(), "[٤] والمفتاح الجديد الوحيد على المستند linkModelCheck (null صريح: إبطال لا حذف)");
    eq(sp1.linkModelCheck, null, "[٤] وقيمته null");
    const l1 = await linesOf("link-a");
    deq([l1[0].action, l1[0].reasonCode, l1[0].before, l1[0].after], ["unlink", null, {exclusion: null, linkState: "active", linkedScanId: "link-before-1", linkModelCheck: null}, {exclusion: null, linkState: "unlinked_by_admin", linkedScanId: "link-before-1", linkModelCheck: null}], "[٤] السطر: قبل وبعد (ومعهما linkModelCheck: null؛ ق36 أ)، وreasonCode: null");
    const u2 = await run({action: "unlink", scanId: "link-a"});
    expectRefusal("[٤] unlink ثانية", u2, {code: PRECOND, reasonCode: "CORRECTION_NOT_LINKED", logExtra: " linkState=unlinked_by_admin linked=PRESENT", ids: ["link-a"]});
    // relink
    const rl = await run({action: "relink", scanId: "link-a", toScanId: "link-before-2"});
    deq(rl.ret, {scanId: "link-a", action: "relink", changed: true, basis: "SCAN_PROTOCOL", exclusion: null, linkState: "relinked_by_admin", linkedScanId: "link-before-2", correctionSeq: 2}, "[٤] relink إلى هدف موجود ⟵ relinked_by_admin وlinkedScanId الجديد");
    const sp2 = await data("scanProtocol", "link-a");
    deq([sp2.linkState, sp2.linkedScanId, sp2.linkMethod], ["relinked_by_admin", "link-before-2", "auto_confirmed"], "[٤] والمستند: linkMethod ما زال كما هو");
    const rl2 = await run({action: "relink", scanId: "link-a", toScanId: "link-before-2"});
    deq([rl2.ret.changed, rl2.ret.correctionSeq], [false, null], "[٤] relink إلى الهدف نفسه بالحالة نفسها ⟵ changed:false");
    expectRefusal("[٤] relink إلى الفحص نفسه", await run({action: "relink", scanId: "link-a", toScanId: "link-a"}), {code: INVALID, reasonCode: "CORRECTION_RELINK_SELF", ids: ["link-a"]});
    expectRefusal("[٤] relink إلى هدف بلا scanProtocol", await run({action: "relink", scanId: "link-a", toScanId: "link-ghost"}), {code: NOTFOUND, reasonCode: "CORRECTION_RELINK_TARGET_NOT_FOUND", ids: ["link-ghost"]});
    const ul = await run({action: "unlink", scanId: "link-a"});
    deq([ul.ret.changed, ul.ret.linkState, ul.ret.linkedScanId, ul.ret.correctionSeq], [true, "unlinked_by_admin", "link-before-2", 3], "[٤] unlink بعد relink ⟵ يعمل (الحالتان الحيّتان active وrelinked_by_admin)");
    // relink من حالة none
    await seedProto("link-b");
    const rb = await run({action: "relink", scanId: "link-b", toScanId: "link-before-1"});
    deq([rb.ret.changed, rb.ret.linkState, rb.ret.linkedScanId], [true, "relinked_by_admin", "link-before-1"], "[٤] relink من حالة none ⟵ يربط يدوياً");
    eq((await data("scanProtocol", "link-b")).linkMethod, null, "[٤] وlinkMethod يبقى null (المسؤول لا يغيّره)");
    // unlink من none
    await seedProto("link-c");
    expectRefusal("[٤] unlink على none", await run({action: "unlink", scanId: "link-c"}), {code: PRECOND, reasonCode: "CORRECTION_NOT_LINKED", logExtra: " linkState=none linked=ABSENT", ids: ["link-c"]});
    // حالة ربط مجهولة
    await seedProto("link-d", {linkState: "weird", linkedScanId: "link-before-1"});
    expectRefusal("[٤] linkState مجهولة", await run({action: "unlink", scanId: "link-d"}), {code: PRECOND, reasonCode: "CORRECTION_LINK_STATE_UNKNOWN", logExtra: " linkState=UNRECOGNIZED", ids: ["link-d"]});
    await db.collection("scanProtocol").doc("link-e").set({scanPurpose: "normal", linkedScanId: "link-before-1"});
    expectRefusal("[٤] linkState غائبة", await run({action: "relink", scanId: "link-e", toScanId: "link-before-2"}), {code: PRECOND, reasonCode: "CORRECTION_LINK_STATE_UNKNOWN", logExtra: " linkState=ABSENT", ids: ["link-e"]});
    // الاستبعاد والربط معاً على مستند واحد
    const ex = await run({action: "exclude", scanId: "link-b", reason: "wrong"});
    deq([ex.ret.exclusion, ex.ret.linkState, ex.ret.linkedScanId], [{state: "excluded", reasonCode: "wrong"}, "relinked_by_admin", "link-before-1"], "[٤] exclude على مستند مربوط ⟵ العلامة تُضاف والربط يبقى");
    const lb = await linesOf("link-b");
    deq([lb.length, lb[1].before.linkState, lb[1].after.linkState, lb[1].after.exclusion.reasonCode], [2, "relinked_by_admin", "relinked_by_admin", "wrong"], "[٤] والسطر الثاني بـseq 2: الربط في قبل وبعد معاً");
  }

  // ═══ ٥ — سباق: فعلان متزامنان ═══
  {
    const joiner = "phone-pcx-race";
    const s = await realScan(OWN, joiner, "race");
    const [a, b] = await Promise.all([
      run({action: "exclude", scanId: s.scanId, reason: "test"}),
      run({action: "exclude", scanId: s.scanId, reason: "wrong"}),
    ]);
    ok(a.threw === null && b.threw === null, "[٥] الفعلان المتزامنان ينجحان");
    const lines = await linesOf(s.scanId);
    deq(lines.map((l) => l.seq), [1, 2], "[٥] سطران بـseq 1 و2 (لا ضياع ولا تكرار: المعاملة تحسم السباق وتُعيد القراءة)");
    deq([lines[1].before.exclusion.reasonCode, lines[0].after.exclusion.reasonCode], [lines[0].after.exclusion.reasonCode, lines[0].after.exclusion.reasonCode], "[٥] وقبل السطر الثاني هو بعد الأوّل (سلسلة متّصلة)");
    const sp = await data("scanProtocol", s.scanId);
    deq([sp.exclusion.state, sp.exclusion.reasonCode], [lines[1].after.exclusion.state, lines[1].after.exclusion.reasonCode], "[٥] والعلامة تساوي بعد آخر سطر");
    const rets = [a.ret, b.ret].map((r) => r.correctionSeq).sort();
    deq(rets, [1, 2], "[٥] ورقما السطرين في الردّين 1 و2");
  }

  // ═══ ٦ — المدخل ═══
  {
    const before = {corrections: await count("protocolCorrections"), protocol: await count("scanProtocol")};
    const S = real.scanId;
    for (const [label, d, code, reasonCode, field] of [
      ["بلا فعل", {scanId: S, reason: "test"}, INVALID, "CORRECTION_ACTION_REQUIRED", "action"],
      ["فعل مجهول delete", {action: "delete", scanId: S}, INVALID, "CORRECTION_ACTION_INVALID", "action"],
      ["فعل Exclude بحرف كبير", {action: "Exclude", scanId: S, reason: "test"}, INVALID, "CORRECTION_ACTION_INVALID", "action"],
      ["resolveIdentityConflict", {action: "resolveIdentityConflict", scanId: S}, PRECOND, "CORRECTION_ACTION_NOT_SPECIFIED", "action"],
      ["مفتاح مجهول", {action: "exclude", scanId: S, reason: "test", force: true}, INVALID, "CORRECTION_FIELD_UNKNOWN", "force"],
      ["بلا هدف", {action: "exclude", reason: "test"}, INVALID, "CORRECTION_TARGET_REQUIRED", null],
      ["هدفان", {action: "exclude", scanId: S, shortId: "NC-ABC123", reason: "test"}, INVALID, "CORRECTION_TARGET_AMBIGUOUS", null],
      ["scanId يحمل /", {action: "exclude", scanId: "a/b", reason: "test"}, INVALID, "CORRECTION_SCAN_ID_INVALID", "scanId"],
      ["shortId بصيغة خاطئة", {action: "exclude", shortId: "ABC123", reason: "test"}, INVALID, "CORRECTION_SHORT_ID_INVALID", "shortId"],
      ["exclude بلا سبب", {action: "exclude", scanId: S}, INVALID, "CORRECTION_REASON_REQUIRED", "reason"],
      ["exclude بسبب خارج القائمة", {action: "exclude", scanId: S, reason: "other"}, INVALID, "CORRECTION_REASON_INVALID", "reason"],
      ["exclude مع toScanId", {action: "exclude", scanId: S, reason: "test", toScanId: "x"}, INVALID, "CORRECTION_FIELD_NOT_APPLICABLE", "toScanId"],
      ["unexclude مع سبب", {action: "unexclude", scanId: S, reason: "test"}, INVALID, "CORRECTION_FIELD_NOT_APPLICABLE", "reason"],
      ["unlink مع toScanId", {action: "unlink", scanId: S, toScanId: "x"}, INVALID, "CORRECTION_FIELD_NOT_APPLICABLE", "toScanId"],
      ["relink بلا toScanId", {action: "relink", scanId: S}, INVALID, "CORRECTION_TO_SCAN_ID_REQUIRED", "toScanId"],
      ["relink مع سبب", {action: "relink", scanId: S, toScanId: "x", reason: "test"}, INVALID, "CORRECTION_FIELD_NOT_APPLICABLE", "reason"],
      ["relink بـtoScanId تالف", {action: "relink", scanId: S, toScanId: "a/b"}, INVALID, "CORRECTION_TO_SCAN_ID_INVALID", "toScanId"],
    ]) {
      expectRefusal(`[٦] ${label}`, await run(d), {code, reasonCode, field, logExtra: field ? ` field=${field}` : "", ids: [S]});
    }
    for (const bad of [undefined, null, "x", 5, []]) {
      const r = await run(bad);
      eq(r.threw && r.threw.details.reasonCode, "CORRECTION_ACTION_REQUIRED", `[٦] data ${JSON.stringify(bad)} ⟵ ACTION_REQUIRED`);
    }
    deq({corrections: await count("protocolCorrections"), protocol: await count("scanProtocol")}, before, "[٦] كل الرفوض أعلاه بلا كتابة");
  }

  // ═══ ٧ — مستندات تالفة ═══
  {
    await db.collection("scanProtocol").doc("bad-marker").set({scanPurpose: "normal", linkedScanId: null, linkState: "none", exclusion: {state: "excluded", reasonCode: "nope", at: new Date()}});
    const docBefore = JSON.stringify(await data("scanProtocol", "bad-marker"));
    const r = await run({action: "exclude", scanId: "bad-marker", reason: "test"});
    expectRefusal("[٧] علامة تالفة", r, {code: PRECOND, reasonCode: "CORRECTION_EXCLUSION_UNREADABLE", logExtra: " source=MARKER", ids: ["bad-marker"]});
    eq(JSON.stringify(await data("scanProtocol", "bad-marker")), docBefore, "[٧] والمستند بحاله (لا يُكتب فوق ما لا يُقرأ)");
    eq((await linesOf("bad-marker")).length, 0, "[٧] ولا سطر");
    await db.collection("reports").doc("bad-lines").set({shortId: "NC-BAD333"});
    const mk = (seq) => ({scanId: "bad-lines", action: "exclude", reasonCode: "test", basis: "REPORT_ONLY", before: {exclusion: null, linkState: null, linkedScanId: null}, after: {exclusion: {state: "excluded", reasonCode: "test"}, linkState: null, linkedScanId: null}, seq, at: new Date(), by: "#x"});
    await db.collection("protocolCorrections").doc("bl-1").set(mk(1));
    await db.collection("protocolCorrections").doc("bl-2").set(mk(1));
    const r2 = await run({action: "unexclude", scanId: "bad-lines"});
    expectRefusal("[٧] سطور بـseq مكرَّر", r2, {code: PRECOND, reasonCode: "CORRECTION_EXCLUSION_UNREADABLE", logExtra: " source=LINES", ids: ["bad-lines"]});
    eq((await linesOf("bad-lines")).length, 2, "[٧] ولم يُلحَق سطر ثالث على سجلّ فاسد");
  }

  // ═══ ٨ — لا حذف ═══
  {
    const total = await count("protocolCorrections");
    ok(total >= 7 + 2 + 3 + 2 + 2, `[٨] السطور تراكمت ولم تتناقص (${total})`);
    ok(await exists("reports", real.scanId) && await exists("reportRaw", real.scanId) && await exists("scanProtocol", real.scanId), "[٨] التقرير والخامّ وscanProtocol للفحص المصحَّح كلّها باقية");
  }

  console.log("\nمرصود (سطور السجلّ الجديدة):\n" + OBSERVED.join("\n"));
  console.log(`\nprotocolCorrection.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
