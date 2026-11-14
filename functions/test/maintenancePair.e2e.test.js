// E2E test: ربط «قبل الصيانة» بـ«بعد الصيانة» — setSessionPurpose وanalyzeDevice (وفي المراحل التالية listOpenMaintenanceBefores وconfirmMaintenanceAfterLink وcorrectProtocolRecord) الحقيقية عبر `.run()` على محاكي Firestore
// (القاعدة 37) (أمر المستخدم 2026-10-22؛ المراحل S2 إلى S6).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل. كل ما سواه يمرّ إلى المحاكي كما هو (لا غلاف على db ولا على الدفعات).
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A2 وA3 وA11 (إلحاقات 2026-10-22؛ ومصدرها WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md: منقول، غير متحقَّق).
//
// ما يثبته (يُلحَق بكل مرحلة):
//   ٢ (S2) setSessionPurpose بنوع العطل: يُخزَّن في protocolPending لا scanSessions؛ رفوضه الثلاثة قبل أيّ قراءة للجلسة (ولجلسة غير موجودة) ولا تمسّ جلسة ولا pending؛ التغيير يستبدل النوع ويمسح اختيار الربط؛
//      normal يكتب النوع null صريحاً؛ battery_* لم تعد تُختار.
//   ٣ (S3) analyzeDevice: defectType وpair في scanProtocol (خمسة عشر حقلاً) في الدفعة الذرّية نفسها؛ لا تسرّب إلى التقرير ولا الخامّ ولا الردّ.
//   ٥ (S5) confirmMaintenanceAfterLink واكتمال «بعد» في analyzeDevice: الربط active و«قبل» COMPLETED ذرّياً، وضياع الهدف (missing: التقرير يكتمل بلا خصم إضافي)، والسباق الحقيقي بتحليلين متزامنين، وإعادة الاختيار تستبدل، وكل رفض بسببه.
//   ٦ (S6) correctProtocolRecord (unlink/relink) يُبقي pair على «قبل» متّسقاً: unlink يُعيدها OPEN، وrelink تُعيد القديمة وتُكتمل الجديدة، والمكتملة بغير «بعد» لا تُمسّ وتُعلَن، والسطر بتسعة حقول بالإلحاق وحده.
//   ٤ (S4) listOpenMaintenanceBefores على «قبل» كتبها analyzeDevice الحقيقي: المحلّ والنوع والنافذة بالإعداد (يسري على المفتوح بلا كتابة) والمربوط والاسم التجاري وكل رفض بسببه، وقراءة وحدها.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/maintenancePair.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "dummy-key";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "dummy-key";
process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
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

const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {correctProtocolRecord} = require("../src/admin/protocolCorrectionAdmin");
const {listOpenMaintenanceBefores, confirmMaintenanceAfterLink} = require("../src/sessions/maintenancePairCalls");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const fingerprintFor = (model) => ({
  device: {model, androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
});
const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const seedOwner = (uid, extra = {}) => db.collection("users").doc(uid).set({scansRemaining: 50, scansTotal: 50, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), protocolParts: {purposes: true, batteryBeforeAfter: true}, ...extra});
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
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
const setPurpose = (uid, sessionId, purpose, defectType, auth) => call(() => setSessionPurpose.run({
  data: {sessionId, purpose, ...(defectType !== undefined ? {defectType} : {})}, auth: auth === undefined ? {uid, token: tokenOf("google.com")} : auth, rawRequest: {headers: {}},
}));
const analyze = (scanId, sessionId, uid, provider, model = "TestPhone") => call(() => analyzeDevice.run({
  data: {scanId, fingerprint: fingerprintFor(model), ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf(provider)}, rawRequest: {headers: {}},
}));
const purposeLines = (texts) => texts.filter((t) => t.startsWith("[setSessionPurpose] "));
const LINK_NULLS = {linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null};
const pendingNoDraw = async (id) => { const {doubleEvalDraw, ...rest} = await data("protocolPending", id); return rest; };
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };

function expectRefusal(label, r, {code, reasonCode, message = reasonCode, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode}], `${label}: الرمز والرسالة (رمزه التقني) والتفصيل`);
  const named = purposeLines(r.texts).filter((t) => t.startsWith("[setSessionPurpose] refused "));
  eq(named.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(named[0].startsWith(`[setSessionPurpose] refused reason=${logReason}`) && named[0].endsWith(logExtra), `${label}: السطر بسببه ${logReason}${logExtra} — ${named[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return named[0];
}

(async () => {
  // ═══ ٢ — setSessionPurpose بنوع العطل (S2) ═══
  {
    // ٢-أ: النوع يُخزَّن في protocolPending لا في scanSessions؛ والردّ لم يتغيّر
    await seedOwner("own-mp-a");
    const created = await create("own-mp-a");
    const id = created.ret.sessionId;
    const sBefore = await data("scanSessions", id);
    const r = await setPurpose("own-mp-a", id, "maintenance_before", "BATTERY");
    ok(r.threw === null, "[٢] maintenance_before + BATTERY: نجح");
    deq(r.ret, {sessionId: id, purpose: "maintenance_before", purposeSource: "selected"}, "[٢] الردّ لم يتغيّر: {sessionId, purpose, purposeSource} (لا حقل نوع فيه)");
    const sAfter = await data("scanSessions", id);
    deq({...sAfter, purpose: undefined}, {...sBefore, purpose: undefined}, "[٢] مستند الجلسة: purpose وحده تغيّر (**لا defectType فيه**: الهاتف المنضمّ يقرؤه بالقواعد)");
    eq(sAfter.purpose, "maintenance_before", "[٢] والغرض maintenance_before");
    ok(!("defectType" in sAfter), "[٢] لا حقل defectType في scanSessions أبداً (firestore.rules:140-144)");
    deq(await pendingNoDraw(id), {purposeSource: "selected", defectType: "BATTERY", ...LINK_NULLS}, "[٢] protocolPending: المصدر selected ونوع العطل BATTERY واختيار الربط null صريح");
    ok(!r.texts.join("\n").includes(id) && !r.texts.join("\n").includes("own-mp-a"), "[٢] لا معرّف خامّ في السجلّ");
    deq(purposeLines(r.texts), [`[setSessionPurpose] set session=${sid(id)} caller=${sid("own-mp-a")} purpose=maintenance_before previous=normal defectType=BATTERY`], "[٢] سطر النجاح الوحيد: الغرض والسابق والنوع (للصيانة وحدها)");
    note("setSessionPurpose — نجاح بنوع عطل", purposeLines(r.texts));
    // التغيير ما دامت pending: النوع يُستبدل (وغرض «بعد» كذلك)
    const r2 = await setPurpose("own-mp-a", id, "maintenance_after", "THERMAL");
    deq(r2.ret, {sessionId: id, purpose: "maintenance_after", purposeSource: "selected"}, "[٢] تغيير الغرض والنوع ما دامت الجلسة pending");
    deq(await pendingNoDraw(id), {purposeSource: "selected", defectType: "THERMAL", ...LINK_NULLS}, "[٢] النوع الجديد THERMAL يستبدل القديم");
    ok(purposeLines(r2.texts)[0].endsWith("purpose=maintenance_after previous=maintenance_before defectType=THERMAL"), "[٢] والسجلّ يحمل الغرض السابق والنوع الجديد");
    // كل نوع من الخمسة مقبول لكل من الغرضين
    for (const purpose of ["maintenance_before", "maintenance_after"]) {
      for (const t of ["BATTERY", "CHARGING_PORT", "THERMAL", "MOTHERBOARD", "SOFTWARE"]) {
        const x = await setPurpose("own-mp-a", id, purpose, t);
        ok(x.threw === null && (await pendingNoDraw(id)).defectType === t, `[٢] ${purpose} + ${t} مقبول ومخزَّن`);
      }
    }
    // normal: النوع null صريح (لا حذف حقل)، ويمسح اختيار الربط
    await db.collection("protocolPending").doc(id).set({linkedScanId: "some-before", linkMethod: "manual", linkConfirmedAt: new Date(), linkConfirmedByTechnicianId: null}, {merge: true});
    const r3 = await setPurpose("own-mp-a", id, "normal");
    deq(r3.ret, {sessionId: id, purpose: "normal", purposeSource: "selected"}, "[٢] normal بلا نوع مقبول");
    deq(await pendingNoDraw(id), {purposeSource: "selected", defectType: null, ...LINK_NULLS}, "[٢] **normal: النوع null صريح (لا حذف) واختيار الربط الذي كان مؤكَّداً مُسح**");
    ok("defectType" in (await pendingNoDraw(id)), "[٢] والحقل باقٍ في المستند بقيمة null (لا FieldValue.delete: القاعدة 42)");
    ok(!purposeLines(r3.texts)[0].includes("defectType="), "[٢] وسطر النجاح لـnormal بلا defectType (كما كان)");
    // الربط المؤكَّد يُمسح أيضاً عند تغيير الغرض بين الصيانتين
    await db.collection("protocolPending").doc(id).set({linkedScanId: "another-before", linkMethod: "manual", linkConfirmedAt: new Date()}, {merge: true});
    await setPurpose("own-mp-a", id, "maintenance_after", "BATTERY");
    deq(await pendingNoDraw(id), {purposeSource: "selected", defectType: "BATTERY", ...LINK_NULLS}, "[٢] اختيار جديد لـmaintenance_after يمسح الربط السابق (الربط لغرض ونوع محدَّدين)");
  }
  {
    // ٢-ب: رفوض النوع الثلاثة: قبل أيّ قراءة للجلسة، ولا تمسّ جلسة ولا pending
    await seedOwner("own-mp-b");
    const id = (await create("own-mp-b")).ret.sessionId;
    await setPurpose("own-mp-b", id, "maintenance_before", "SOFTWARE");
    const sBefore = await data("scanSessions", id);
    const pBefore = await data("protocolPending", id);
    const ids = [id, "own-mp-b"];
    const cases = [
      ["maintenance_before بلا نوع", "maintenance_before", undefined, "DEFECT_TYPE_REQUIRED", " purpose=maintenance_before"],
      ["maintenance_after بلا نوع", "maintenance_after", undefined, "DEFECT_TYPE_REQUIRED", " purpose=maintenance_after"],
      ["maintenance_before و«OTHER»", "maintenance_before", "OTHER", "DEFECT_TYPE_INVALID", " purpose=maintenance_before given=string"],
      ["maintenance_after ونصّ فارغ", "maintenance_after", "", "DEFECT_TYPE_INVALID", " purpose=maintenance_after given=string"],
      ["maintenance_before ورقم", "maintenance_before", 4, "DEFECT_TYPE_INVALID", " purpose=maintenance_before given=number"],
      ["maintenance_after وأحرف صغيرة", "maintenance_after", "battery", "DEFECT_TYPE_INVALID", " purpose=maintenance_after given=string"],
      ["maintenance_before و null", "maintenance_before", null, "DEFECT_TYPE_INVALID", " purpose=maintenance_before given=null"],
      ["maintenance_after وكائن", "maintenance_after", {type: "BATTERY"}, "DEFECT_TYPE_INVALID", " purpose=maintenance_after given=object"],
      ["normal ونوع", "normal", "BATTERY", "DEFECT_TYPE_NOT_APPLICABLE", " purpose=normal given=string"],
      ["normal و null", "normal", null, "DEFECT_TYPE_NOT_APPLICABLE", " purpose=normal given=null"],
    ];
    for (const [label, purpose, type, reason, extra] of cases) {
      const r = await setPurpose("own-mp-b", id, purpose, type);
      const line = expectRefusal(`[٢] ${label}`, r, {code: "invalid-argument", reasonCode: reason, logReason: reason, logExtra: extra, ids});
      if (typeof type === "string" && type !== "") ok(!line.includes(type), `[٢] ${label}: القيمة المُرسَلة لا تُطبع`);
    }
    deq(await data("scanSessions", id), sBefore, "[٢] **كل الرفوض لم تمسّ مستند الجلسة**");
    deq(await data("protocolPending", id), pBefore, "[٢] ولا protocolPending (النوع والمصدر باقيان)");
    note("setSessionPurpose — رفض نوع العطل", [purposeLines((await setPurpose("own-mp-b", id, "maintenance_before", "OTHER")).texts)[0]]);
    // قبل أيّ قراءة: جلسة غير موجودة بنوع فاسد ⟵ رفض النوع (لا SESSION_NOT_PARTICIPANT)
    const missing = await setPurpose("own-mp-b", "no-such-session-mp-b", "maintenance_before", "OTHER");
    expectRefusal("[٢] جلسة غير موجودة بنوع فاسد: **رفض النوع قبل أيّ قراءة**", missing, {code: "invalid-argument", reasonCode: "DEFECT_TYPE_INVALID", logReason: "DEFECT_TYPE_INVALID", logExtra: " purpose=maintenance_before given=string", ids: ["no-such-session-mp-b"]});
    const strangerBad = await setPurpose("stranger-mp-b", id, "normal", "BATTERY");
    expectRefusal("[٢] غريب بنوع مع normal: رفض النوع لا الملكية", strangerBad, {code: "invalid-argument", reasonCode: "DEFECT_TYPE_NOT_APPLICABLE", logReason: "DEFECT_TYPE_NOT_APPLICABLE", logExtra: " purpose=normal given=string"});
    // الجلسة غير الموجودة بنوع صحيح ⟵ رفض الجلسة القائم (الردّ نفسه لغير المالك)
    const missingOk = await setPurpose("own-mp-b", "no-such-session-mp-b", "maintenance_before", "BATTERY");
    expectRefusal("[٢] جلسة غير موجودة بنوع صحيح: رفض الجلسة القائم", missingOk, {code: "permission-denied", reasonCode: "SESSION_NOT_PARTICIPANT", message: "جلسة الفحص غير صالحة", logReason: "SESSION_NOT_FOUND"});
  }
  {
    // ٢-ج: battery_before/battery_after لم تعودا تُختاران (قيمتا قراءة تاريخيتان) ولو بنوع صحيح
    await seedOwner("own-mp-c");
    const id = (await create("own-mp-c")).ret.sessionId;
    const pBefore = await data("protocolPending", id);
    for (const purpose of ["battery_before", "battery_after"]) {
      for (const type of [undefined, "BATTERY"]) {
        const r = await setPurpose("own-mp-c", id, purpose, type);
        expectRefusal(`[٢] ${purpose}${type ? " + نوع صحيح" : ""}`, r, {code: "invalid-argument", reasonCode: "SET_PURPOSE_INVALID", logReason: "SET_PURPOSE_INVALID", ids: [id]});
      }
    }
    deq(await data("protocolPending", id), pBefore, "[٢] والرفض لم يمسّ protocolPending");
    eq((await data("scanSessions", id)).purpose, "normal", "[٢] ولا الغرض");
  }
  {
    // ٢-د: لا مستند جلسة في المحاكي يحمل defectType (الهاتف المنضمّ يقرأ scanSessions)
    const all = await db.collection("scanSessions").get();
    ok(all.size >= 3, "[٢] جلسات المشاهد موجودة");
    ok(all.docs.every((d) => !("defectType" in d.data())), "[٢] **لا مستند في scanSessions يحمل defectType** (يقرؤه الهاتف المنضمّ: لا يُوضع فيه ما لا يراه الزبون)");
  }

  // ═══ ٣ — analyzeDevice: defectType وpair في scanProtocol، في الدفعة الذرّية نفسها (S3) ═══
  // (ق36 أ، 2026-10-22؛ القاعدة 23: كانت خمسة عشر مفتاحاً؛ صارت ستّة عشر بـlinkModelCheck — null صريح لكل فحص إلا «بعد» التي حُلّ هدف ربطها)
  const SP_ALL_KEYS = ["consent", "createdAt", "creditExemption", "defectType", "linkMethod", "linkModelCheck", "linkState", "linkedScanId", "pair", "protocolVersion", "purposeSource", "repeat", "repeatClassification", "repeatOf", "scanPurpose", "settingsVersion"];
  // (ق36 أ، القاعدتان 41 و37) linkModelCheck محظور على السلك: لا في التقرير ولا الخامّ ولا ردّ التحليل
  const LEAK_FIELDS = ["scanPurpose", "defectType", "linkedScanId", "linkState", "linkMethod", "pair", "scanProtocol", "purposeSource", "linkModelCheck"];
  const assertNoLeak = async (label, scanId, ret) => {
    const report = await data("reports", scanId);
    const raw = await data("reportRaw", scanId);
    for (const f of LEAK_FIELDS) ok(!(f in report) && !(f in raw), `${label}: ${f} ليس في مستند التقرير ولا الخامّ`);
    ok(!LEAK_FIELDS.some((f) => JSON.stringify(ret).includes(`"${f}"`)), `${label}: ولا في ردّ التحليل`);
  };
  // مشهد كامل: إنشاء ← اختيار (غرض ونوع) ← انضمام ← تحليل
  const fullScan = async ({owner, anon, scanId, purpose, defectType, model = "TestPhone", parts}) => {
    await seedOwner(owner, parts ? {protocolParts: parts} : {});
    const created = await create(owner);
    const id = created.ret.sessionId;
    if (purpose !== undefined) ok((await setPurpose(owner, id, purpose, defectType)).threw === null, `(${scanId}) اختيار ${purpose} نجح`);
    await join(created.ret.code, anon);
    const r = await analyze(scanId, id, anon, "anonymous", model);
    ok(r.threw === null, `(${scanId}) التحليل نجح: ${r.threw && r.threw.message}`);
    return {id, r, sp: await data("scanProtocol", scanId)};
  };
  {
    // ٣-أ: maintenance_before ⟵ نوع العطل وpair OPEN
    const {id, r, sp} = await fullScan({owner: "own-mp-s3a", anon: "anon-mp-s3a", scanId: "scan-mp-s3a", purpose: "maintenance_before", defectType: "THERMAL"});
    deq(Object.keys(sp).sort(), SP_ALL_KEYS, "[٣] scanProtocol بستّة عشر مفتاحاً (الثلاثة عشر + defectType وpair + linkModelCheck من ق36 أ)");
    eq(sp.linkModelCheck, null, "[٣] (ق36 أ) وlinkModelCheck = null صريحاً على «قبل» (لا مقارنة: لا ربط)");
    deq([sp.scanPurpose, sp.purposeSource, sp.defectType], ["maintenance_before", "selected", "THERMAL"], "[٣] الغرض والمصدر ونوع العطل من الجلسة وprotocolPending");
    deq(Object.keys(sp.pair).sort(), ["openedAt", "ownerId", "state"], "[٣] pair بثلاثة مفاتيح لا غير عند الفتح (لا expiresAt مخزَّن، ولا completedByScanId؛ S8: +ownerId، القاعدة 23)");
    eq(sp.pair.ownerId, "own-mp-s3a", "[٣] (S8) pair.ownerId = ownerId مستند الجلسة (صاحب المحلّ) لا الهاتف المنضمّ");
    eq(sp.pair.state, "OPEN", "[٣] pair.state = OPEN");
    ok(TS(sp.pair.openedAt) && TS(sp.createdAt), "[٣] openedAt وcreatedAt وقتا خادم");
    eq(sp.pair.openedAt.toMillis(), sp.createdAt.toMillis(), "[٣] **openedAt هو createdAt نفسه** (وسم خادم واحد في الدفعة)");
    ok(Math.abs(sp.pair.openedAt.toMillis() - Date.now()) < 120000, "[٣] وهو وقت الآن تقريباً");
    deq([sp.linkedScanId, sp.linkState, sp.linkMethod], [null, "none", null], "[٣] والربط none (لا ربط على «قبل»)");
    ok(await exists("reports", "scan-mp-s3a") && await exists("reportRaw", "scan-mp-s3a"), "[٣] والتقرير والخامّ محفوظان مع scanProtocol (الدفعة الذرّية)");
    const opened = r.texts.filter((t) => t.startsWith("[analyzeDevice] maintenance pair opened"));
    deq(opened, [`[analyzeDevice] maintenance pair opened scan=${sid("scan-mp-s3a")} defectType=THERMAL`], "[٣] سطر «فُتح الزوج» الوحيد: المعرّف مُهشَّر ونوع العطل");
    note("analyzeDevice — فتح الزوج", opened);
    ok(!r.texts.join("\n").includes("scan-mp-s3a") && !r.texts.join("\n").includes(id), "[٣] لا معرّف فحص ولا جلسة خامّ في أيّ سطر");
    ok(!r.texts.some((t) => t.includes("scanProtocol notes=")), "[٣] ولا ملاحظة (حالة عادية)");
    await assertNoLeak("[٣]", "scan-mp-s3a", r.ret);
    eq((await data("scanSessions", id)).status, "completed", "[٣] والجلسة completed");
    ok(!("defectType" in (await data("scanSessions", id))), "[٣] ولا defectType في مستند الجلسة بعد التحليل");
    // الإعادة من المخزَّن لا تكتب ثانيةً ولا تفتح زوجاً ثانياً
    const before = (await data("scanProtocol", "scan-mp-s3a")).pair.openedAt.toMillis();
    const again = await analyze("scan-mp-s3a", id, "anon-mp-s3a", "anonymous");
    ok(again.threw === null && !again.texts.some((t) => t.includes("maintenance pair opened")), "[٣] الإعادة المشروعة تُقدَّم من المخزَّن بلا سطر فتح");
    eq((await data("scanProtocol", "scan-mp-s3a")).pair.openedAt.toMillis(), before, "[٣] ولا يُكتب pair ثانيةً (openedAt كما هو)");
  }
  {
    // ٣-ب: maintenance_after ⟵ النوع، وpair null صريح، والربط none (لا ربط مختار)
    const {r, sp} = await fullScan({owner: "own-mp-s3b", anon: "anon-mp-s3b", scanId: "scan-mp-s3b", purpose: "maintenance_after", defectType: "CHARGING_PORT"});
    deq([sp.scanPurpose, sp.defectType, sp.pair, sp.linkedScanId, sp.linkState, sp.linkMethod], ["maintenance_after", "CHARGING_PORT", null, null, "none", null], "[٣] maintenance_after: النوع، وpair null صريح، والربط none");
    ok("pair" in sp && sp.pair === null, "[٣] pair حاضر بقيمة null (لا غياب)");
    ok(!r.texts.some((t) => t.includes("maintenance pair opened")), "[٣] ولا سطر فتح لـ«بعد»");
    await assertNoLeak("[٣]", "scan-mp-s3b", r.ret);
  }
  {
    // ٣-ج: غير الصيانة: defectType وpair null صريحان
    const {r, sp} = await fullScan({owner: "own-mp-s3c", anon: "anon-mp-s3c", scanId: "scan-mp-s3c", purpose: "normal"});
    deq([sp.scanPurpose, sp.defectType, sp.pair], ["normal", null, null], "[٣] normal (مختار صراحةً): defectType وpair null");
    ok("defectType" in sp && "pair" in sp, "[٣] المفتاحان حاضران");
    const d = await fullScan({owner: "own-mp-s3d", anon: "anon-mp-s3d", scanId: "scan-mp-s3d"});
    deq([d.sp.scanPurpose, d.sp.defectType, d.sp.pair], ["normal", null, null], "[٣] الافتراضي: null/null");
    // مالك ثم تراجع: اختار maintenance_before ثم عاد إلى normal ⟵ النوع null في pending فيُكتب null
    await seedOwner("own-mp-s3e");
    const created = await create("own-mp-s3e");
    await setPurpose("own-mp-s3e", created.ret.sessionId, "maintenance_before", "SOFTWARE");
    await setPurpose("own-mp-s3e", created.ret.sessionId, "normal");
    await join(created.ret.code, "anon-mp-s3e");
    await analyze("scan-mp-s3e", created.ret.sessionId, "anon-mp-s3e", "anonymous");
    const e = await data("scanProtocol", "scan-mp-s3e");
    deq([e.scanPurpose, e.defectType, e.pair], ["normal", null, null], "[٣] **عاد إلى normal بعد maintenance_before: لا نوع ولا زوج** (النوع يتبع الغرض الحاضر)");
    // فحص بلا جلسة
    await seedOwner("own-mp-s3f", {plan: "single"});
    const solo = await analyze("scan-mp-s3f", null, "own-mp-s3f", "password");
    ok(solo.threw === null, "[٣] فحص بلا جلسة نجح");
    const s = await data("scanProtocol", "scan-mp-s3f");
    deq([s.scanPurpose, s.defectType, s.pair], ["NO_SESSION", null, null], "[٣] بلا جلسة: NO_SESSION وnull/null");
    // بذر جلسة بغرض قراءة تاريخي (battery_before): يُقرأ ولا زوج له
    await seedSession("sess-mp-s3g", {ownerId: "own-mp-s3g", status: "scanning", code: "NC-MPS300", expiresAt: FUTURE(), joinedBy: "joiner-mp-s3g", purpose: "battery_before", scanId: null, deviceModel: null});
    await seedOwner("own-mp-s3g");
    await db.collection("protocolPending").doc("sess-mp-s3g").set({purposeSource: "selected"});
    const h = await analyze("scan-mp-s3g", "sess-mp-s3g", "joiner-mp-s3g", "anonymous");
    ok(h.threw === null, "[٣] جلسة بغرض تاريخي battery_before تُحلَّل");
    const hs = await data("scanProtocol", "scan-mp-s3g");
    deq([hs.scanPurpose, hs.defectType, hs.pair], ["battery_before", null, null], "[٣] battery_before قيمة قراءة تاريخية: تُقرأ ولا نوع ولا زوج لها");
  }
  {
    // ٣-د: الغياب حالة صريحة: maintenance_before بلا نوع في pending (شذوذ) ⟵ defectType null بملاحظة، والزوج يُفتح
    await seedOwner("own-mp-s3h");
    await seedSession("sess-mp-s3h", {ownerId: "own-mp-s3h", status: "scanning", code: "NC-MPS301", expiresAt: FUTURE(), joinedBy: "joiner-mp-s3h", purpose: "maintenance_before", scanId: null, deviceModel: null});
    await db.collection("protocolPending").doc("sess-mp-s3h").set({purposeSource: "selected"});
    const r = await analyze("scan-mp-s3h", "sess-mp-s3h", "joiner-mp-s3h", "anonymous");
    ok(r.threw === null, "[٣] التحليل ينجح (الشذوذ يُعلَن ولا يُسقط الفحص)");
    const sp = await data("scanProtocol", "scan-mp-s3h");
    deq([sp.scanPurpose, sp.defectType, sp.pair.state], ["maintenance_before", null, "OPEN"], "[٣] النوع null (لا نوع مختلَق) والزوج مفتوح");
    deq(r.texts.filter((t) => t.includes("scanProtocol notes=")), ["[analyzeDevice] scanProtocol notes=DEFECT_TYPE_ABSENT purpose=maintenance_before"], "[٣] والملاحظة المسمّاة DEFECT_TYPE_ABSENT");
    deq(r.texts.filter((t) => t.includes("maintenance pair opened")), [`[analyzeDevice] maintenance pair opened scan=${sid("scan-mp-s3h")} defectType=NONE`], "[٣] وسطر الفتح يقول defectType=NONE");
    // نوع مجهول مخزَّن: ملاحظة NOT_RECOGNIZED ولا يُطبع النصّ الخام
    await seedOwner("own-mp-s3i");
    await seedSession("sess-mp-s3i", {ownerId: "own-mp-s3i", status: "scanning", code: "NC-MPS302", expiresAt: FUTURE(), joinedBy: "joiner-mp-s3i", purpose: "maintenance_after", scanId: null, deviceModel: null});
    await db.collection("protocolPending").doc("sess-mp-s3i").set({purposeSource: "selected", defectType: "zzUnknownType"});
    const r2 = await analyze("scan-mp-s3i", "sess-mp-s3i", "joiner-mp-s3i", "anonymous");
    const sp2 = await data("scanProtocol", "scan-mp-s3i");
    deq([sp2.defectType, sp2.pair], [null, null], "[٣] نوع مخزَّن مجهول: null");
    deq(r2.texts.filter((t) => t.includes("scanProtocol notes=")), ["[analyzeDevice] scanProtocol notes=DEFECT_TYPE_NOT_RECOGNIZED,PAIR_LINK_NOT_CHOSEN purpose=maintenance_after"], "[٣] والملاحظتان DEFECT_TYPE_NOT_RECOGNIZED (S3) وPAIR_LINK_NOT_CHOSEN (S5: «بعد» بلا ربط مؤكَّد)");
    ok(!r2.texts.join("\n").includes("zzUnknownType"), "[٣] ولا القيمة الخام في أيّ سطر");
  }

  // ═══ ٤ — listOpenMaintenanceBefores على «قبل» كتبها analyzeDevice الحقيقي (S4) ═══
  const setSettings = (hours) => db.collection("protocolSettings").doc("current").set(hours === undefined ? {version: 1} : {version: 1, openBeforeValidityHours: hours});
  const listBefores = (uid, sessionId, authOverride) => call(() => listOpenMaintenanceBefores.run({data: {sessionId}, auth: authOverride === undefined ? {uid, token: tokenOf("google.com")} : authOverride, rawRequest: {headers: {}}}));
  const listLines = (texts) => texts.filter((t) => t.startsWith("[listOpenMaintenanceBefores] "));
  const afterSession = async (owner, type = "BATTERY") => {
    const created = await create(owner);
    ok((await setPurpose(owner, created.ret.sessionId, "maintenance_after", type)).threw === null, `(${owner}) اختيار maintenance_after`);
    return created.ret.sessionId;
  };
  {
    await setSettings(72);
    await db.collection("marketingNames").doc("current").set({version: 1, entries: [{model: "PhoneA", ar: "هاتف ألف", tr: "Telefon A", en: "Phone A"}]});
    // «قبل» حقيقيتان لمحلّ واحد (نوعان) و«قبل» لمحلّ آخر بالنوع نفسه
    const b1 = await fullScan({owner: "own-mp-s4", anon: "anon-mp-s4a", scanId: "scan-mp-s4a", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneA"});
    // المحلّ نفسه: جلسة «قبل» ثانية بنوع THERMAL
    const c2 = await create("own-mp-s4");
    await setPurpose("own-mp-s4", c2.ret.sessionId, "maintenance_before", "THERMAL");
    await join(c2.ret.code, "anon-mp-s4b");
    ok((await analyze("scan-mp-s4b", c2.ret.sessionId, "anon-mp-s4b", "anonymous", "PhoneB")).threw === null, "[٤] «قبل» THERMAL حُلِّلت");
    // «قبل» ثالثة بالنوع نفسه لكن في محلّ آخر
    await fullScan({owner: "own-mp-s4-other", anon: "anon-mp-s4c", scanId: "scan-mp-s4c", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneA"});
    // «قبل» رابعة للمحلّ نفسه وبالنوع نفسه بطراز غير مربوط بالخريطة
    const c4 = await create("own-mp-s4");
    await setPurpose("own-mp-s4", c4.ret.sessionId, "maintenance_before", "BATTERY");
    await join(c4.ret.code, "anon-mp-s4d");
    ok((await analyze("scan-mp-s4d", c4.ret.sessionId, "anon-mp-s4d", "anonymous", "PhoneZ")).threw === null, "[٤] «قبل» رابعة حُلِّلت");

    const afterId = await afterSession("own-mp-s4", "BATTERY");
    const pBefore = await data("protocolPending", afterId);
    const r = await listBefores("own-mp-s4", afterId);
    ok(r.threw === null, `[٤] القائمة نجحت: ${r.threw && r.threw.message}`);
    deq(Object.keys(r.ret), ["validityHours", "candidates"], "[٤] مفتاحا الردّ");
    eq(r.ret.validityHours, 72, "[٤] validityHours من protocolSettings (72)");
    deq(r.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s4d", "scan-mp-s4a"], "[٤] **المرشَّحان بالضبط: «قبل» المحلّ نفسه بالنوع نفسه** (لا THERMAL ولا محلّ آخر) والأحدث أوّلاً");
    const spA = await data("scanProtocol", "scan-mp-s4a");
    const spD = await data("scanProtocol", "scan-mp-s4d");
    deq(r.ret.candidates.map((c) => c.scannedAtMs), [spD.pair.openedAt.toMillis(), spA.pair.openedAt.toMillis()], "[٤] scannedAtMs = pair.openedAt بالمللي ثانية");
    ok(spD.pair.openedAt.toMillis() >= spA.pair.openedAt.toMillis(), "[٤] والأحدث أوّلاً");
    deq(r.ret.candidates[1].deviceName, {state: "mapped", model: "PhoneA", names: {ar: "هاتف ألف", tr: "Telefon A", en: "Phone A"}, reason: null}, "[٤] الطراز في الخريطة ⟵ mapped (الطراز من التقرير الذي كتبه analyzeDevice: deviceModel)");
    deq(r.ret.candidates[0].deviceName, {state: "name_unmapped", model: "PhoneZ", names: null, reason: "MODEL_NOT_IN_MAP"}, "[٤] وغير المربوط ⟵ name_unmapped ويُعاد Build.MODEL (لا اسم مختلَق)");
    ok(!JSON.stringify(r.ret).includes("anon-mp") && !("hardware" in r.ret) && r.ret.candidates.every((c) => Object.keys(c).sort().join() === "beforeScanId,deviceName,scannedAtMs"), "[٤] لا معرّف عتاد ولا هويّة جهاز في الردّ");
    const served = listLines(r.texts);
    // المقروء = كل scanProtocol بـpair.state == OPEN في المحاكي (فيه «قبل» المشاهد السابقة أيضاً): يُحسب بالاستعلام نفسه لا باليد
    // (S8، القاعدة 23: كان المقروء كل «قبل» مفتوحة في المحاكي والاستبعاد يعدّ «محلّ آخر: واحدة»؛ صار الاستعلام مساواتين pair.ownerId وpair.state فلا يُقرأ إلا ما لهذا المحلّ)
    const openCount = (await db.collection("scanProtocol").where("pair.ownerId", "==", "own-mp-s4").where("pair.state", "==", "OPEN").get()).size;
    eq(openCount, 3, "[٤] «قبل» مفتوحة لهذا المحلّ: ثلاث (BATTERY مربوطة بالخريطة، وTHERMAL، وBATTERY بطراز غير مربوط)");
    deq(served, [`[listOpenMaintenanceBefores] served session=${sid(afterId)} caller=${sid("own-mp-s4")} validityHours=72 openRead=${openCount} candidates=2 excluded=WRONG_TYPE:${openCount - 2}`], "[٤] سطر النجاح الوحيد: المعرّفان مُهشَّران، والمقروء «قبل» هذا المحلّ وحدها (محلّ آخر لا يُقرأ أصلاً)، والاستبعاد بأسبابه (نوع مختلف: THERMAL)");
    note("listOpenMaintenanceBefores — نجاح", served);
    ok(!r.texts.join("\n").includes("PhoneA") && !r.texts.join("\n").includes(afterId) && !r.texts.join("\n").includes("own-mp-s4"), "[٤] لا طراز ولا معرّف خامّ في السجلّ");
    deq(await data("protocolPending", afterId), pBefore, "[٤] والقائمة لم تكتب شيئاً (قراءة وحدها)");

    // النافذة بالإعداد: يُقدَّم openedAt إلى الوراء ثم يُخفَض الإعداد
    await db.collection("scanProtocol").doc("scan-mp-s4a").update({"pair.openedAt": new Date(Date.now() - 70 * 3600 * 1000)});
    deq((await listBefores("own-mp-s4", afterId)).ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s4d", "scan-mp-s4a"], "[٤] «قبل» عمرها 70 ساعة والمدّة 72: تظهر");
    await db.collection("scanProtocol").doc("scan-mp-s4a").update({"pair.openedAt": new Date(Date.now() - 73 * 3600 * 1000)});
    deq((await listBefores("own-mp-s4", afterId)).ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s4d"], "[٤] وعمرها 73 ساعة: لا تظهر (والمخزَّن لم يتغيّر: pair.state ما زال OPEN)");
    eq((await data("scanProtocol", "scan-mp-s4a")).pair.state, "OPEN", "[٤] pair.state ما زال OPEN: الانقضاء يُحسب عند القراءة ولا يُخزَّن");
    await setSettings(100);
    deq((await listBefores("own-mp-s4", afterId)).ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s4d", "scan-mp-s4a"], "[٤] **رفع الإعداد إلى 100 ساعة: تعود بلا كتابة عليها**");
    eq((await listBefores("own-mp-s4", afterId)).ret.validityHours, 100, "[٤] والردّ يحمل المدّة الجديدة");
    await setSettings(72);

    // ربط حيّ يُخفي «قبل» (يُبذر مستند «بعد» حيّ الربط، ثم يُفكّ)
    await db.collection("scanProtocol").doc("after-linked-s4").set({scanPurpose: "maintenance_after", linkedScanId: "scan-mp-s4d", linkState: "active", linkMethod: "manual", pair: null});
    await db.collection("scanProtocol").doc("scan-mp-s4a").update({"pair.openedAt": new Date(Date.now() - 1 * 3600 * 1000)});
    deq((await listBefores("own-mp-s4", afterId)).ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s4a"], "[٤] «قبل» لها ربط حيّ (active) من «بعد»: تختفي");
    await db.collection("scanProtocol").doc("after-linked-s4").update({linkState: "unlinked_by_admin"});
    deq((await listBefores("own-mp-s4", afterId)).ret.candidates.length, 2, "[٤] وبعد فكّ المشرف (unlinked_by_admin): تعود");

    // الرفوض بالدالّة الحقيقية
    const expectList = (label, rr, {code, message, reasonCode, logReason, logExtra = "", ids = []}) => {
      ok(rr.threw !== null, `${label}: يُرفض`);
      deq([rr.threw.code, rr.threw.message, rr.threw.details], [code, message === undefined ? reasonCode : message, {reasonCode}], `${label}: الرمز والرسالة والتفصيل`);
      const named = listLines(rr.texts).filter((t) => t.startsWith("[listOpenMaintenanceBefores] refused "));
      eq(named.length, 1, `${label}: سطر رفض مسمّى واحد`);
      ok(named[0].startsWith(`[listOpenMaintenanceBefores] refused reason=${logReason}`) && named[0].endsWith(logExtra), `${label}: السطر ${logReason}${logExtra} — ${named[0]}`);
      for (const id of ids) ok(!rr.texts.join("\n").includes(id), `${label}: لا معرّف خامّ`);
    };
    const wire = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT"};
    expectList("[٤] بلا auth", await listBefores(null, afterId, null), {code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "PAIR_NOT_AUTHENTICATED", logReason: "PAIR_NOT_AUTHENTICATED"});
    expectList("[٤] sessionId غائب", await listBefores("own-mp-s4", undefined), {code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "PAIR_SESSION_ID_REQUIRED", logReason: "PAIR_SESSION_ID_REQUIRED"});
    expectList("[٤] غير المالك", await listBefores("anon-mp-s4a", afterId), {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=SET", ids: [afterId, "anon-mp-s4a"]});
    expectList("[٤] جلسة غير موجودة", await listBefores("own-mp-s4", "no-such-session-s4"), {...wire, logReason: "SESSION_NOT_FOUND", ids: ["no-such-session-s4"]});
    const normalSession = (await create("own-mp-s4")).ret.sessionId;
    expectList("[٤] جلسة غرضها normal", await listBefores("own-mp-s4", normalSession), {code: "failed-precondition", reasonCode: "PAIR_SESSION_NOT_AFTER", logReason: "PAIR_SESSION_NOT_AFTER", logExtra: " purpose=normal"});
    const beforeSession = (await create("own-mp-s4")).ret.sessionId;
    await setPurpose("own-mp-s4", beforeSession, "maintenance_before", "BATTERY");
    expectList("[٤] جلسة غرضها maintenance_before", await listBefores("own-mp-s4", beforeSession), {code: "failed-precondition", reasonCode: "PAIR_SESSION_NOT_AFTER", logReason: "PAIR_SESSION_NOT_AFTER", logExtra: " purpose=maintenance_before"});
    // الجزء
    // (ق31، أقرّه حسن 2026-10-22؛ القاعدة 23) كان محلّ بلا batteryBeforeAfter يختار maintenance_after؛ صار setSessionPurpose يرفضه. فالجلسة تُختار والجزء مفعَّل ثم يُطفأ، وهذا هو الشكل الوحيد لجلسة «بعد» عند محلّ بلا الجزء الآن: والقائمة تفحص الجزء بنفسها
    await seedOwner("own-mp-s4-noparts", {protocolParts: {purposes: true, batteryBeforeAfter: true}});
    const npSession = await afterSession("own-mp-s4-noparts");
    await db.collection("users").doc("own-mp-s4-noparts").update({"protocolParts.batteryBeforeAfter": false});
    expectList("[٤] جزء batteryBeforeAfter غير مفعَّل", await listBefores("own-mp-s4-noparts", npSession), {code: "failed-precondition", reasonCode: "PAIR_PART_NOT_ENABLED", logReason: "PAIR_PART_NOT_ENABLED"});
    // المدّة غير مكتوبة: لا قيمة افتراضية
    await db.collection("protocolSettings").doc("current").set({version: 1});
    expectList("[٤] openBeforeValidityHours غير مكتوب", await listBefores("own-mp-s4", afterId), {code: "failed-precondition", reasonCode: "PAIR_VALIDITY_SETTING_ABSENT", logReason: "PAIR_VALIDITY_SETTING_ABSENT", logExtra: " state=ABSENT"});
    await db.collection("protocolSettings").doc("current").set({version: 1, openBeforeValidityHours: 0});
    expectList("[٤] openBeforeValidityHours صفر", await listBefores("own-mp-s4", afterId), {code: "failed-precondition", reasonCode: "PAIR_VALIDITY_SETTING_ABSENT", logReason: "PAIR_VALIDITY_SETTING_ABSENT", logExtra: " state=INVALID"});
    await setSettings(72);
    // نوع «بعد» غائب في pending (شذوذ)
    await db.collection("protocolPending").doc(afterId).set({defectType: null}, {merge: true});
    expectList("[٤] نوع «بعد» غائب في pending", await listBefores("own-mp-s4", afterId), {code: "failed-precondition", reasonCode: "PAIR_SESSION_DEFECT_TYPE_ABSENT", logReason: "PAIR_SESSION_DEFECT_TYPE_ABSENT", logExtra: " state=ABSENT"});
    await db.collection("protocolPending").doc(afterId).set({defectType: "BATTERY"}, {merge: true});
    // الخريطة غائبة ⟵ name_unmapped: MAP_ABSENT (لا اسم مختلَق)
    await db.collection("marketingNames").doc("current").set({version: 1, entries: "broken"});
    const unreadable = await listBefores("own-mp-s4", afterId);
    ok(unreadable.ret.candidates.every((c) => c.deviceName.state === "name_unmapped" && c.deviceName.reason === "MAP_UNREADABLE"), "[٤] خريطة بشكل لا يُقرأ ⟵ كل الأسماء name_unmapped: MAP_UNREADABLE");
    // المستندات باقية: لا حذف
    ok(await exists("scanProtocol", "scan-mp-s4a") && await exists("reports", "scan-mp-s4a"), "[٤] لا حذف في أيّ مسار");
  }

  // ═══ ٥ — confirmMaintenanceAfterLink والاكتمال في analyzeDevice: الربط والخسارة والسباق (S5) ═══
  const confirmLink = (uid, sessionId, beforeScanId, authOverride) => call(() => confirmMaintenanceAfterLink.run({data: {sessionId, beforeScanId}, auth: authOverride === undefined ? {uid, token: tokenOf("google.com")} : authOverride, rawRequest: {headers: {}}}));
  const confirmLines = (texts) => texts.filter((t) => t.startsWith("[confirmMaintenanceAfterLink] "));
  const creditOf = async (uid) => (await getDoc("users", uid)).data().scansRemaining;
  const sessionFor = async (owner, {type = "BATTERY", link, purpose = "maintenance_after"} = {}) => {
    const created = await create(owner);
    const id = created.ret.sessionId;
    ok((await setPurpose(owner, id, purpose, type)).threw === null, `(${owner}) اختيار ${purpose} ${type}`);
    if (link !== undefined) {
      const c = await confirmLink(owner, id, link);
      ok(c.threw === null, `(${owner}) تأكيد الربط بـ${link}: ${c.threw && c.threw.message}`);
    }
    return {id, code: created.ret.code};
  };
  const ownerOf = "own-mp-s5";
  {
    await seedOwner(ownerOf);
    await setSettings(72);
    // «قبل» حقيقية B1 (BATTERY، طراز PhoneA مربوط بالخريطة)
    await db.collection("marketingNames").doc("current").set({version: 1, entries: [{model: "PhoneA", ar: "هاتف ألف", tr: "Telefon A", en: "Phone A"}]});
    const b1 = await fullScan({owner: ownerOf, anon: "anon-mp-s5-b1", scanId: "scan-mp-s5-b1", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneA"});
    const openedB1 = b1.sp.pair.openedAt.toMillis();

    // ٥-أ: القائمة ← التأكيد ← الانضمام ← التحليل ⟵ الربط active و«قبل» COMPLETED
    const x = await sessionFor(ownerOf);
    const listed = await listBefores(ownerOf, x.id);
    deq(listed.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s5-b1"], "[٥] القائمة تعرض «قبل» الوحيدة");
    const cf = await confirmLink(ownerOf, x.id, "scan-mp-s5-b1");
    ok(cf.threw === null, `[٥] التأكيد نجح: ${cf.threw && cf.threw.message}`);
    deq(cf.ret, {sessionId: x.id, beforeScanId: "scan-mp-s5-b1", linkMethod: "manual"}, "[٥] الردّ {sessionId, beforeScanId, linkMethod: manual}");
    const p = await pendingNoDraw(x.id);
    deq([p.linkedScanId, p.linkMethod, p.defectType, p.purposeSource], ["scan-mp-s5-b1", "manual", "BATTERY", "selected"], "[٥] protocolPending: الربط manual والمعرّف، والنوع والمصدر باقيان (دمج)");
    ok(TS(p.linkConfirmedAt) && Math.abs(p.linkConfirmedAt.toMillis() - Date.now()) < 120000, "[٥] linkConfirmedAt وقت الخادم");
    ok("linkConfirmedByTechnicianId" in p && p.linkConfirmedByTechnicianId === null, "[٥] **linkConfirmedByTechnicianId null صريح** (المفتاح حاضر)");
    deq(Object.keys(p).sort(), ["defectType", "linkConfirmedAt", "linkConfirmedByTechnicianId", "linkMethod", "linkedScanId", "purposeSource"].sort(), "[٥] حقول pending بعد التأكيد (بلا حقل زائد)");
    deq(confirmLines(cf.texts), [`[confirmMaintenanceAfterLink] confirmed session=${sid(x.id)} before=${sid("scan-mp-s5-b1")} caller=${sid(ownerOf)} replaced=false`], "[٥] سطر النجاح الوحيد: المعرّفات مُهشَّرة وreplaced=false");
    note("confirmMaintenanceAfterLink — نجاح", confirmLines(cf.texts));
    ok(!cf.texts.join("\n").includes("scan-mp-s5-b1") && !cf.texts.join("\n").includes(x.id) && !cf.texts.join("\n").includes(ownerOf), "[٥] لا معرّف خامّ في السجلّ");
    eq((await data("scanProtocol", "scan-mp-s5-b1")).pair.state, "OPEN", "[٥] **«قبل» ما زالت OPEN بعد التأكيد** (لا حجز: الاكتمال وحده يغلقها)");

    await join(x.code, "anon-mp-s5-a1");
    const creditBefore = await creditOf(ownerOf);
    const a1 = await analyze("scan-mp-s5-a1", x.id, "anon-mp-s5-a1", "anonymous", "PhoneA");
    ok(a1.threw === null, `[٥] تحليل «بعد» نجح: ${a1.threw && a1.threw.message}`);
    eq(creditBefore - (await creditOf(ownerOf)), 1, "[٥] **خُصمت فحصة واحدة** كأيّ فحص عادي (لا خصم إضافي للربط)");
    const spA = await data("scanProtocol", "scan-mp-s5-a1");
    deq([spA.scanPurpose, spA.defectType, spA.pair, spA.linkedScanId, spA.linkState, spA.linkMethod], ["maintenance_after", "BATTERY", null, "scan-mp-s5-b1", "active", "manual"], "[٥] **«بعد»: النوع وpair null والربط active/manual بمعرّف «قبل»**");
    deq(Object.keys(spA).sort(), SP_ALL_KEYS, "[٥] وستّة عشر مفتاحاً (ق36 أ، القاعدة 23: كانت خمسة عشر)");
    eq(spA.linkModelCheck, "LINK_MODEL_MATCH", "[٥] (ق36 أ) وlinkModelCheck = LINK_MODEL_MATCH: طراز «قبل» و«بعد» PhoneA كلاهما");
    const spB = await data("scanProtocol", "scan-mp-s5-b1");
    eq(spB.pair.ownerId, ownerOf, "[٥] (S8) ownerId لم يُمسّ باكتمال «قبل»");
    deq([spB.pair.state, spB.pair.completedByScanId, spB.pair.openedAt.toMillis(), spB.scanPurpose, spB.defectType], ["COMPLETED", "scan-mp-s5-a1", openedB1, "maintenance_before", "BATTERY"], "[٥] **«قبل»: COMPLETED مكتملة بـ«بعد» وopenedAt كما هو**");
    deq(a1.texts.filter((t) => t.startsWith("[analyzeDevice] maintenance pair")), [`[analyzeDevice] maintenance pair linked after=${sid("scan-mp-s5-a1")} before=${sid("scan-mp-s5-b1")} modelCheck=LINK_MODEL_MATCH`], "[٥] سطر «رُبط» الوحيد (المعرّفان مُهشَّران) ومعه modelCheck (ق36 أ، القاعدة 23: كان بلا حالة الطراز)");
    note("analyzeDevice — اكتمال الربط", a1.texts.filter((t) => t.startsWith("[analyzeDevice] maintenance pair")));
    ok(!a1.texts.some((t) => t.includes("LINK_TARGET_LOST")), "[٥] ولا ملاحظة ضياع");
    ok(await exists("reports", "scan-mp-s5-a1") && await exists("reportRaw", "scan-mp-s5-a1"), "[٥] والتقرير والخامّ محفوظان");
    await assertNoLeak("[٥]", "scan-mp-s5-a1", a1.ret);
    eq((await data("scanSessions", x.id)).status, "completed", "[٥] والجلسة completed");
    // الإعادة من المخزَّن لا تكتب ولا تربط ثانيةً
    const writesBefore = JSON.stringify((await data("scanProtocol", "scan-mp-s5-b1")).pair.completedByScanId);
    const again = await analyze("scan-mp-s5-a1", x.id, "anon-mp-s5-a1", "anonymous", "PhoneA");
    ok(again.threw === null && !again.texts.some((t) => t.includes("maintenance pair")), "[٥] الإعادة المشروعة تُقدَّم من المخزَّن بلا سطر ربط");
    eq(JSON.stringify((await data("scanProtocol", "scan-mp-s5-b1")).pair.completedByScanId), writesBefore, "[٥] ولا تمسّ «قبل»");

    // «قبل» المكتملة تختفي من القائمة وتُرفض في التأكيد
    const y = await sessionFor(ownerOf);
    deq((await listBefores(ownerOf, y.id)).ret.candidates.map((c) => c.beforeScanId), [], "[٥] **«قبل» المكتملة تختفي من القائمة** (pair.state صار COMPLETED)");
    const cy = await confirmLink(ownerOf, y.id, "scan-mp-s5-b1");
    ok(cy.threw !== null && cy.threw.details.reasonCode === "BEFORE_ALREADY_PAIRED", "[٥] ويُرفض تأكيدها: BEFORE_ALREADY_PAIRED");
    ok(cy.texts.some((t) => t.includes("refused reason=BEFORE_ALREADY_PAIRED") && t.endsWith(" via=PAIR_STATE")), "[٥] والسجلّ يقول via=PAIR_STATE");
    eq((await pendingNoDraw(y.id)).linkedScanId, null, "[٥] ولا ربط كُتب في pending");
  }
  {
    // ٥-ب: **ضياع الهدف**: X تؤكّد «قبل» B2، ثم تكمل Y الربط بها أوّلاً، ثم تُحلَّل X ⟵ التقرير يكتمل وlinkState = missing
    await seedOwner("own-mp-s5b");
    await setSettings(72);
    await fullScan({owner: "own-mp-s5b", anon: "anon-mp-s5b-b", scanId: "scan-mp-s5b-b2", purpose: "maintenance_before", defectType: "THERMAL", model: "PhoneB"});
    const X = await sessionFor("own-mp-s5b", {type: "THERMAL", link: "scan-mp-s5b-b2"});
    const Y = await sessionFor("own-mp-s5b", {type: "THERMAL", link: "scan-mp-s5b-b2"});
    await join(Y.code, "anon-mp-s5b-y");
    ok((await analyze("scan-mp-s5b-y", Y.id, "anon-mp-s5b-y", "anonymous", "PhoneB")).threw === null, "[٥] Y حُلِّلت أوّلاً وربطت «قبل»");
    eq((await data("scanProtocol", "scan-mp-s5b-b2")).pair.completedByScanId, "scan-mp-s5b-y", "[٥] «قبل» مكتملة بـY");
    await join(X.code, "anon-mp-s5b-x");
    const creditBefore = await creditOf("own-mp-s5b");
    const rx = await analyze("scan-mp-s5b-x", X.id, "anon-mp-s5b-x", "anonymous", "PhoneB");
    ok(rx.threw === null, `[٥] **تحليل X ينجح رغم ضياع الهدف**: ${rx.threw && rx.threw.message}`);
    eq(creditBefore - (await creditOf("own-mp-s5b")), 1, "[٥] وخُصمت فحصة واحدة فقط (لا خصم إضافي ولا رصيد يُفقد)");
    const spX = await data("scanProtocol", "scan-mp-s5b-x");
    deq([spX.linkedScanId, spX.linkState, spX.linkMethod, spX.defectType, spX.pair], ["scan-mp-s5b-b2", "missing", "manual", "THERMAL", null], "[٥] X: linkState = missing (والمعرّف المختار محفوظ)");
    ok(await exists("reports", "scan-mp-s5b-x") && await exists("reportRaw", "scan-mp-s5b-x"), "[٥] **تقرير الزبون كُتب** (لا يسقط)");
    eq((await data("scanProtocol", "scan-mp-s5b-b2")).pair.completedByScanId, "scan-mp-s5b-y", "[٥] و«قبل» بقيت لـY (لم يُكتب فوقها)");
    eq((await data("scanSessions", X.id)).status, "completed", "[٥] وجلسة X completed");
    const lost = rx.texts.filter((t) => t.includes("LINK_TARGET_LOST") || t.includes("maintenance pair target lost"));
    deq(lost, ["[analyzeDevice] scanProtocol notes=LINK_TARGET_LOST:TARGET_NOT_OPEN purpose=maintenance_after", `[analyzeDevice] maintenance pair target lost reason=TARGET_NOT_OPEN after=${sid("scan-mp-s5b-x")} before=${sid("scan-mp-s5b-b2")}`], "[٥] ملاحظة LINK_TARGET_LOST مسمّاة بسببها وسطر الضياع (معرّفان مُهشَّران)");
    note("analyzeDevice — ضياع الهدف", lost);
    await assertNoLeak("[٥]", "scan-mp-s5b-x", rx.ret);
  }
  {
    // ٥-ج: **السباق الحقيقي**: جلستا «بعد» تختاران «قبل» B3 معاً وتُحلَّلان متزامنتين
    await seedOwner("own-mp-s5c");
    await setSettings(72);
    await fullScan({owner: "own-mp-s5c", anon: "anon-mp-s5c-b", scanId: "scan-mp-s5c-b3", purpose: "maintenance_before", defectType: "MOTHERBOARD", model: "PhoneC"});
    const X = await sessionFor("own-mp-s5c", {type: "MOTHERBOARD", link: "scan-mp-s5c-b3"});
    const Y = await sessionFor("own-mp-s5c", {type: "MOTHERBOARD", link: "scan-mp-s5c-b3"});
    await join(X.code, "anon-mp-s5c-x");
    await join(Y.code, "anon-mp-s5c-y");
    const run = (scanId, sessionId, uid) => analyzeDevice.run({data: {scanId, fingerprint: fingerprintFor("PhoneC"), sessionId}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}});
    const creditBefore = await creditOf("own-mp-s5c");
    const both = await call(() => Promise.all([run("scan-mp-s5c-x", X.id, "anon-mp-s5c-x"), run("scan-mp-s5c-y", Y.id, "anon-mp-s5c-y")]));
    ok(both.threw === null, `[٥] التحليلان المتزامنان نجحا كلاهما: ${both.threw && both.threw.message}`);
    const states = [(await data("scanProtocol", "scan-mp-s5c-x")).linkState, (await data("scanProtocol", "scan-mp-s5c-y")).linkState].sort();
    deq(states, ["active", "missing"], "[٥] **السباق: واحدة active وواحدة missing**");
    const winner = (await data("scanProtocol", "scan-mp-s5c-x")).linkState === "active" ? "scan-mp-s5c-x" : "scan-mp-s5c-y";
    const loser = winner === "scan-mp-s5c-x" ? "scan-mp-s5c-y" : "scan-mp-s5c-x";
    const b3 = await data("scanProtocol", "scan-mp-s5c-b3");
    deq([b3.pair.state, b3.pair.completedByScanId], ["COMPLETED", winner], "[٥] «قبل» مكتملة بالفائزة وحدها");
    ok(await exists("reports", "scan-mp-s5c-x") && await exists("reports", "scan-mp-s5c-y") && await exists("reportRaw", "scan-mp-s5c-x") && await exists("reportRaw", "scan-mp-s5c-y"), "[٥] **كلا التقريرين والخامّين كُتبت**");
    eq(creditBefore - (await creditOf("own-mp-s5c")), 2, "[٥] وخُصمت فحصتان (واحدة لكل فحص: لا خصم إضافي للخاسرة)");
    const loserSp = await data("scanProtocol", loser);
    deq([loserSp.linkedScanId, loserSp.linkState], ["scan-mp-s5c-b3", "missing"], "[٥] الخاسرة missing بالمعرّف المختار");
    eq(both.texts.filter((t) => t.includes("maintenance pair linked")).length, 1, "[٥] سطر «رُبط» واحد");
    eq(both.texts.filter((t) => t.includes("maintenance pair target lost")).length, 1, "[٥] وسطر «ضاع» واحد");
    deq([(await data("scanSessions", X.id)).status, (await data("scanSessions", Y.id)).status], ["completed", "completed"], "[٥] والجلستان completed");
    // «قبل» مكتملة واحدة: القائمة لا تعيدها
    const z = await sessionFor("own-mp-s5c", {type: "MOTHERBOARD"});
    deq((await listBefores("own-mp-s5c", z.id)).ret.candidates, [], "[٥] والقائمة لا تعيدها");
  }
  {
    // ٥-د: بلا ربط مختار ⟵ none وملاحظة PAIR_LINK_NOT_CHOSEN؛ وتغيير الغرض بعد التأكيد يمسح الربط؛ وجلسة scanning تقبل التأكيد
    await seedOwner("own-mp-s5d");
    await setSettings(72);
    await fullScan({owner: "own-mp-s5d", anon: "anon-mp-s5d-b", scanId: "scan-mp-s5d-b", purpose: "maintenance_before", defectType: "SOFTWARE", model: "PhoneD"});
    const N = await sessionFor("own-mp-s5d", {type: "SOFTWARE"});
    await join(N.code, "anon-mp-s5d-n");
    const rn = await analyze("scan-mp-s5d-n", N.id, "anon-mp-s5d-n", "anonymous", "PhoneD");
    const spN = await data("scanProtocol", "scan-mp-s5d-n");
    deq([spN.linkedScanId, spN.linkState, spN.linkMethod, spN.defectType], [null, "none", null, "SOFTWARE"], "[٥] بلا ربط مختار: none ونوع «بعد» محفوظ");
    deq(rn.texts.filter((t) => t.includes("scanProtocol notes=")), ["[analyzeDevice] scanProtocol notes=PAIR_LINK_NOT_CHOSEN purpose=maintenance_after"], "[٥] والملاحظة المسمّاة PAIR_LINK_NOT_CHOSEN");
    eq((await data("scanProtocol", "scan-mp-s5d-b")).pair.state, "OPEN", "[٥] و«قبل» لم تُمسّ");
    // الربط بعد تغيير الغرض: يُمسح
    const C1 = await sessionFor("own-mp-s5d", {type: "SOFTWARE", link: "scan-mp-s5d-b"});
    ok((await setPurpose("own-mp-s5d", C1.id, "maintenance_after", "SOFTWARE")).threw === null, "[٥] إعادة اختيار الغرض نفسه");
    eq((await pendingNoDraw(C1.id)).linkedScanId, null, "[٥] **إعادة اختيار الغرض تمسح الربط المؤكَّد**");
    await join(C1.code, "anon-mp-s5d-c1");
    await analyze("scan-mp-s5d-c1", C1.id, "anon-mp-s5d-c1", "anonymous", "PhoneD");
    eq((await data("scanProtocol", "scan-mp-s5d-c1")).linkState, "none", "[٥] والتحليل بعده بلا ربط (none)");
    eq((await data("scanProtocol", "scan-mp-s5d-b")).pair.state, "OPEN", "[٥] و«قبل» ما زالت مفتوحة");
    // جلسة scanning (بعد الانضمام) تقبل التأكيد ثم الاكتمال
    const S2 = await create("own-mp-s5d");
    ok((await setPurpose("own-mp-s5d", S2.ret.sessionId, "maintenance_after", "SOFTWARE")).threw === null, "(scanning) اختيار الغرض");
    await join(S2.ret.code, "anon-mp-s5d-s2");
    eq((await data("scanSessions", S2.ret.sessionId)).status, "scanning", "[٥] الجلسة scanning بعد الانضمام");
    const cs = await confirmLink("own-mp-s5d", S2.ret.sessionId, "scan-mp-s5d-b");
    ok(cs.threw === null, `[٥] **جلسة scanning تقبل التأكيد**: ${cs.threw && cs.threw.message}`);
    const rs = await analyze("scan-mp-s5d-s2", S2.ret.sessionId, "anon-mp-s5d-s2", "anonymous", "PhoneD");
    ok(rs.threw === null, "[٥] وتكتمل");
    deq([(await data("scanProtocol", "scan-mp-s5d-s2")).linkState, (await data("scanProtocol", "scan-mp-s5d-b")).pair.completedByScanId], ["active", "scan-mp-s5d-s2"], "[٥] الربط active و«قبل» مكتملة بها");
    // إعادة الاختيار تستبدل: «قبل» ثانية
    await fullScan({owner: "own-mp-s5d", anon: "anon-mp-s5d-b2", scanId: "scan-mp-s5d-b-two", purpose: "maintenance_before", defectType: "SOFTWARE", model: "PhoneD"});
    await fullScan({owner: "own-mp-s5d", anon: "anon-mp-s5d-b3", scanId: "scan-mp-s5d-b-three", purpose: "maintenance_before", defectType: "SOFTWARE", model: "PhoneD"});
    const R2 = await sessionFor("own-mp-s5d", {type: "SOFTWARE", link: "scan-mp-s5d-b-two"});
    const rep = await confirmLink("own-mp-s5d", R2.id, "scan-mp-s5d-b-three");
    deq(confirmLines(rep.texts), [`[confirmMaintenanceAfterLink] confirmed session=${sid(R2.id)} before=${sid("scan-mp-s5d-b-three")} caller=${sid("own-mp-s5d")} replaced=true`], "[٥] إعادة الاختيار: replaced=true في السجلّ");
    eq((await pendingNoDraw(R2.id)).linkedScanId, "scan-mp-s5d-b-three", "[٥] **الأحدث يربح** في pending");
    await join(R2.code, "anon-mp-s5d-r2");
    await analyze("scan-mp-s5d-r2", R2.id, "anon-mp-s5d-r2", "anonymous", "PhoneD");
    deq([(await data("scanProtocol", "scan-mp-s5d-r2")).linkedScanId, (await data("scanProtocol", "scan-mp-s5d-b-three")).pair.state, (await data("scanProtocol", "scan-mp-s5d-b-two")).pair.state], ["scan-mp-s5d-b-three", "COMPLETED", "OPEN"], "[٥] الربط بالمختارة الأخيرة وحدها؛ والأولى بقيت OPEN");
  }
  {
    // ٥-هـ: رفوض التأكيد بالدالّة الحقيقية: لا مساس بـpending ولا «قبل»
    await seedOwner("own-mp-s5e");
    await setSettings(72);
    await fullScan({owner: "own-mp-s5e", anon: "anon-mp-s5e-b", scanId: "scan-mp-s5e-b", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneE"});
    await fullScan({owner: "own-mp-s5e", anon: "anon-mp-s5e-t", scanId: "scan-mp-s5e-thermal", purpose: "maintenance_before", defectType: "THERMAL", model: "PhoneE"});
    await fullScan({owner: "own-mp-s5e-other", anon: "anon-mp-s5e-o", scanId: "scan-mp-s5e-other", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneE"});
    const normalScan = await fullScan({owner: "own-mp-s5e", anon: "anon-mp-s5e-n", scanId: "scan-mp-s5e-normal", purpose: "normal", model: "PhoneE"});
    ok(normalScan.sp.pair === null, "(للتحقّق من البذر)");
    const S = await sessionFor("own-mp-s5e", {type: "BATTERY"});
    const expectConfirm = (label, rr, {code, reasonCode, message, logReason, logExtra = "", ids = []}) => {
      ok(rr.threw !== null, `${label}: يُرفض`);
      deq([rr.threw.code, rr.threw.message, rr.threw.details], [code, message === undefined ? reasonCode : message, {reasonCode}], `${label}: الرمز والرسالة والتفصيل`);
      const named = confirmLines(rr.texts).filter((t) => t.startsWith("[confirmMaintenanceAfterLink] refused "));
      eq(named.length, 1, `${label}: سطر رفض مسمّى واحد`);
      ok(named[0].startsWith(`[confirmMaintenanceAfterLink] refused reason=${logReason}`) && named[0].endsWith(logExtra), `${label}: السطر ${logReason}${logExtra} — ${named[0]}`);
      for (const id of ids) ok(!rr.texts.join("\n").includes(id), `${label}: لا معرّف خامّ`);
    };
    expectConfirm("[٥] بلا auth", await confirmLink(null, S.id, "scan-mp-s5e-b", null), {code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "PAIR_NOT_AUTHENTICATED", logReason: "PAIR_NOT_AUTHENTICATED"});
    expectConfirm("[٥] beforeScanId غائب", await confirmLink("own-mp-s5e", S.id, undefined), {code: "invalid-argument", reasonCode: "PAIR_BEFORE_SCAN_ID_REQUIRED", logReason: "PAIR_BEFORE_SCAN_ID_REQUIRED"});
    expectConfirm("[٥] معرّف «قبل» غير صالح", await confirmLink("own-mp-s5e", S.id, "a/b"), {code: "not-found", reasonCode: "BEFORE_NOT_FOUND", logReason: "BEFORE_NOT_FOUND", logExtra: " cause=ID_INVALID"});
    const wire = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT"};
    expectConfirm("[٥] غير المالك", await confirmLink("anon-mp-s5e-b", S.id, "scan-mp-s5e-b"), {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=SET", ids: [S.id, "anon-mp-s5e-b"]});
    expectConfirm("[٥] جلسة غير موجودة", await confirmLink("own-mp-s5e", "no-such-s5e", "scan-mp-s5e-b"), {...wire, logReason: "SESSION_NOT_FOUND"});
    expectConfirm("[٥] «قبل» غير موجودة", await confirmLink("own-mp-s5e", S.id, "ghost-before"), {code: "not-found", reasonCode: "BEFORE_NOT_FOUND", logReason: "BEFORE_NOT_FOUND", ids: ["ghost-before"]});
    expectConfirm("[٥] «قبل» لمحلّ آخر", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-other"), {code: "permission-denied", reasonCode: "BEFORE_NOT_OWNED", logReason: "BEFORE_NOT_OWNED", logExtra: " ownerState=OTHER"});
    expectConfirm("[٥] فحص عادي لا «قبل» صيانة (لا scanProtocol.pair)", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-normal"), {code: "failed-precondition", reasonCode: "BEFORE_WRONG_PURPOSE", logReason: "BEFORE_WRONG_PURPOSE"});
    expectConfirm("[٥] **نوع مختلف** (THERMAL لجلسة BATTERY)", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-thermal"), {code: "failed-precondition", reasonCode: "BEFORE_WRONG_DEFECT_TYPE", logReason: "BEFORE_WRONG_DEFECT_TYPE"});
    // انقضاء «قبل» بتقديم openedAt
    await db.collection("scanProtocol").doc("scan-mp-s5e-b").update({"pair.openedAt": new Date(Date.now() - 80 * 3600 * 1000)});
    expectConfirm("[٥] «قبل» خارج النافذة", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-b"), {code: "failed-precondition", reasonCode: "BEFORE_EXPIRED", logReason: "BEFORE_EXPIRED"});
    await setSettings(100);
    ok((await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-b")).threw === null, "[٥] ورفع المدّة إلى 100 ساعة يُجيز تأكيدها (النافذة من الإعداد)");
    await setSettings(72);
    // شروط الجلسة والإعداد
    const nsession = await create("own-mp-s5e");
    expectConfirm("[٥] جلسة غرضها normal", await confirmLink("own-mp-s5e", nsession.ret.sessionId, "scan-mp-s5e-b"), {code: "failed-precondition", reasonCode: "PAIR_SESSION_NOT_AFTER", logReason: "PAIR_SESSION_NOT_AFTER", logExtra: " purpose=normal"});
    // (ق31، القاعدة 23) كما في S4: الجزء مفعَّل وقت الاختيار ثم يُطفأ، والتأكيد يفحص الجزء بنفسه
    await seedOwner("own-mp-s5e-np", {protocolParts: {purposes: true, batteryBeforeAfter: true}});
    const npSession = await sessionFor("own-mp-s5e-np", {type: "BATTERY"});
    await db.collection("users").doc("own-mp-s5e-np").update({"protocolParts.batteryBeforeAfter": false});
    expectConfirm("[٥] جزء الزوج غير مفعَّل", await confirmLink("own-mp-s5e-np", npSession.id, "scan-mp-s5e-b"), {code: "failed-precondition", reasonCode: "PAIR_PART_NOT_ENABLED", logReason: "PAIR_PART_NOT_ENABLED"});
    await db.collection("protocolSettings").doc("current").set({version: 1});
    expectConfirm("[٥] المدّة غير مكتوبة", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-b"), {code: "failed-precondition", reasonCode: "PAIR_VALIDITY_SETTING_ABSENT", logReason: "PAIR_VALIDITY_SETTING_ABSENT", logExtra: " state=ABSENT"});
    await setSettings(72);
    // حالة الجلسة: ملغاة، منتهية بالمسّ
    await db.collection("scanSessions").doc(S.id).update({status: "cancelled"});
    expectConfirm("[٥] جلسة ملغاة", await confirmLink("own-mp-s5e", S.id, "scan-mp-s5e-b"), {code: "failed-precondition", reasonCode: "PAIR_SESSION_NOT_ACTIVE", logReason: "PAIR_SESSION_NOT_ACTIVE", logExtra: " status=cancelled"});
    const E = await sessionFor("own-mp-s5e", {type: "BATTERY"});
    await db.collection("scanSessions").doc(E.id).update({expiresAt: new Date(Date.now() - 60 * 1000)});
    expectConfirm("[٥] جلسة pending منقضية", await confirmLink("own-mp-s5e", E.id, "scan-mp-s5e-b"), {code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED", logExtra: " expiredRecorded=true", ids: [E.id]});
    const eSession = await data("scanSessions", E.id);
    ok(eSession.status === "expired" && TS(eSession.expiredAt), "[٥] وكُتبت «منتهية» في المعاملة نفسها");
    eq((await pendingNoDraw(E.id)).linkedScanId, null, "[٥] ولا ربط كُتب");
    // «قبل» المرفوضة كلّها لم تُمسّ
    ok((await data("scanProtocol", "scan-mp-s5e-thermal")).pair.state === "OPEN" && (await data("scanProtocol", "scan-mp-s5e-other")).pair.state === "OPEN", "[٥] «قبل» المرفوضة لم تُمسّ");
    // لا حذف
    ok(await exists("scanProtocol", "scan-mp-s5e-b") && await exists("reports", "scan-mp-s5e-b"), "[٥] لا حذف في أيّ مسار");
  }

  // ═══ ٦ — اتّساق correctProtocolRecord (unlink/relink) مع pair على «قبل» (S6) ═══
  {
    const ADMIN = {uid: "admin-mp-s6", token: {email: ADMIN_EMAILS[0], email_verified: true}};
    const correct = (d) => call(() => correctProtocolRecord.run({data: d, auth: ADMIN, rawRequest: {headers: {}}}));
    const syncLines = (texts) => texts.filter((t) => t.startsWith("[correctProtocolRecord] pair-sync "));
    const pairOf = async (scanId) => (await data("scanProtocol", scanId)).pair;
    const linesFor = async (scanId) => (await db.collection("protocolCorrections").where("scanId", "==", scanId).get()).docs.map((d) => d.data()).sort((a, b) => a.seq - b.seq);
    const OWN = "own-mp-s6";
    await seedOwner(OWN);
    await setSettings(72);
    // «قبل» B1 وB2، و«بعد» A1 تربط B1 باكتمال حقيقي
    const bf1 = await fullScan({owner: OWN, anon: "anon-mp-s6-b1", scanId: "scan-mp-s6-b1", purpose: "maintenance_before", defectType: "THERMAL", model: "PhoneS6"});
    await fullScan({owner: OWN, anon: "anon-mp-s6-b2", scanId: "scan-mp-s6-b2", purpose: "maintenance_before", defectType: "THERMAL", model: "PhoneS6"});
    const openedB1 = bf1.sp.pair.openedAt.toMillis();
    const A1 = await sessionFor(OWN, {type: "THERMAL", link: "scan-mp-s6-b1"});
    await join(A1.code, "anon-mp-s6-a1");
    ok((await analyze("scan-mp-s6-a1", A1.id, "anon-mp-s6-a1", "anonymous", "PhoneS6")).threw === null, "[٦] «بعد» A1 اكتملت");
    deq([(await data("scanProtocol", "scan-mp-s6-a1")).linkState, (await pairOf("scan-mp-s6-b1")).state, (await pairOf("scan-mp-s6-b1")).completedByScanId], ["active", "COMPLETED", "scan-mp-s6-a1"], "[٦] (بذر) A1 مربوطة بـB1 وB1 COMPLETED بها");

    // ٦-أ: unlink على A1 ⟵ B1 تُعاد OPEN
    const u1 = await correct({action: "unlink", scanId: "scan-mp-s6-a1"});
    ok(u1.threw === null, `[٦] unlink نجح: ${u1.threw && u1.threw.message}`);
    deq([u1.ret.changed, u1.ret.linkState, u1.ret.linkedScanId, u1.ret.correctionSeq], [true, "unlinked_by_admin", "scan-mp-s6-b1", 1], "[٦] الردّ كما كان (لم يتغيّر شكله): changed وlinkState وlinkedScanId وcorrectionSeq");
    deq(Object.keys(u1.ret).sort(), ["action", "basis", "changed", "correctionSeq", "exclusion", "linkState", "linkedScanId", "scanId"], "[٦] مفاتيح الردّ كما هي (ثمانية)");
    const spA1 = await data("scanProtocol", "scan-mp-s6-a1");
    deq([spA1.linkState, spA1.linkedScanId, spA1.linkMethod], ["unlinked_by_admin", "scan-mp-s6-b1", "manual"], "[٦] A1: unlinked_by_admin ولا يمسّ linkedScanId ولا linkMethod");
    const pB1 = await pairOf("scan-mp-s6-b1");
    deq([pB1.state, pB1.completedByScanId, pB1.openedAt.toMillis()], ["OPEN", null, openedB1], "[٦] **B1: أُعيدت OPEN وcompletedByScanId = null، وopenedAt لم يُمسّ**");
    deq(Object.keys(pB1).sort(), ["completedByScanId", "openedAt", "ownerId", "state"], "[٦] pair على B1: أربعة مفاتيح (completedByScanId صار null صريحاً، وownerId باقٍ؛ S8: القاعدة 23)");
    eq(pB1.ownerId, OWN, "[٦] (S8) ownerId على B1 لم يُمسّ بإعادة الفتح");
    const lines1 = await linesFor("scan-mp-s6-a1");
    deq(lines1.map((l) => [l.action, l.seq, l.reasonCode, l.before.linkState, l.after.linkState, l.after.linkedScanId]), [["unlink", 1, null, "active", "unlinked_by_admin", "scan-mp-s6-b1"]], "[٦] سطر التصحيح كما كان: تسعة حقول، reasonCode null (ق18)، والقيم قبل/بعد");
    eq(Object.keys(lines1[0]).length, 9, "[٦] السطر بتسعة حقول بالضبط (لم يتغيّر شكله)");
    deq(await linesFor("scan-mp-s6-b1"), [], "[٦] **لا سطر لـB1** (أثرها يُستدلّ عليه من سطر A1: before/after.linkedScanId)");
    deq(syncLines(u1.texts), [`[correctProtocolRecord] pair-sync reopened role=OLD before=${sid("scan-mp-s6-b1")} scan=${sid("scan-mp-s6-a1")} caller=${sid(ADMIN.uid)}`], "[٦] سطر pair-sync الوحيد: أُعيدت فتحها (المعرّفات مُهشَّرة)");
    note("correctProtocolRecord — اتّساق pair عند unlink", syncLines(u1.texts));
    ok(!u1.texts.join("\n").includes("scan-mp-s6-b1") && !u1.texts.join("\n").includes("scan-mp-s6-a1"), "[٦] لا معرّف خامّ في السجلّ");
    // B1 تظهر في القائمة من جديد ويصحّ تأكيدها واكتمالها بـA2
    const A2 = await sessionFor(OWN, {type: "THERMAL"});
    deq((await listBefores(OWN, A2.id)).ret.candidates.map((c) => c.beforeScanId).sort(), ["scan-mp-s6-b1", "scan-mp-s6-b2"], "[٦] **B1 عادت إلى القائمة** بعد unlink (مع B2)");
    ok((await confirmLink(OWN, A2.id, "scan-mp-s6-b1")).threw === null, "[٦] وتأكيدها يصحّ ثانيةً");
    await join(A2.code, "anon-mp-s6-a2");
    ok((await analyze("scan-mp-s6-a2", A2.id, "anon-mp-s6-a2", "anonymous", "PhoneS6")).threw === null, "[٦] واكتملت بـA2");
    deq([(await data("scanProtocol", "scan-mp-s6-a2")).linkState, (await pairOf("scan-mp-s6-b1")).state, (await pairOf("scan-mp-s6-b1")).completedByScanId], ["active", "COMPLETED", "scan-mp-s6-a2"], "[٦] A2 active وB1 COMPLETED بـA2");
    eq((await data("scanProtocol", "scan-mp-s6-a1")).linkState, "unlinked_by_admin", "[٦] وA1 بقيت unlinked_by_admin");

    // ٦-ب: relink A1 (الفاكّة) إلى B1 المكتملة بـA2 ⟵ لا تُمسّ ويُعلَن
    const r1 = await correct({action: "relink", scanId: "scan-mp-s6-a1", toScanId: "scan-mp-s6-b1"});
    ok(r1.threw === null, `[٦] relink نجح (لا رفض جديداً: قواعد الأزواج معلّقة): ${r1.threw && r1.threw.message}`);
    deq([r1.ret.changed, r1.ret.linkState, r1.ret.linkedScanId], [true, "relinked_by_admin", "scan-mp-s6-b1"], "[٦] A1: relinked_by_admin إلى B1");
    deq([(await pairOf("scan-mp-s6-b1")).state, (await pairOf("scan-mp-s6-b1")).completedByScanId], ["COMPLETED", "scan-mp-s6-a2"], "[٦] **B1 بقيت COMPLETED بـA2 (لم تُمسّ)**");
    deq(syncLines(r1.texts), [`[correctProtocolRecord] pair-sync skipped role=NEW before=${sid("scan-mp-s6-b1")} scan=${sid("scan-mp-s6-a1")} caller=${sid(ADMIN.uid)} reason=TARGET_ALREADY_COMPLETED`], "[٦] ويُعلَن بسطر مسمّى TARGET_ALREADY_COMPLETED");
    note("correctProtocolRecord — relink إلى «قبل» مكتملة بغيرها", syncLines(r1.texts));
    // unlink A1 الآن (حيّة): الهدف القديم B1 مكتملة بـA2 لا A1 ⟵ لا تُعاد فتحها
    const u2 = await correct({action: "unlink", scanId: "scan-mp-s6-a1"});
    ok(u2.threw === null, "[٦] unlink على A1 الحيّة نجح");
    deq([(await pairOf("scan-mp-s6-b1")).state, (await pairOf("scan-mp-s6-b1")).completedByScanId], ["COMPLETED", "scan-mp-s6-a2"], "[٦] **B1 باقية COMPLETED بـA2**: unlink لـA1 لا يفتح «قبل» اكتملت بغيرها");
    deq(syncLines(u2.texts), [`[correctProtocolRecord] pair-sync skipped role=OLD before=${sid("scan-mp-s6-b1")} scan=${sid("scan-mp-s6-a1")} caller=${sid(ADMIN.uid)} reason=TARGET_NOT_COMPLETED_BY_THIS`], "[٦] والسطر TARGET_NOT_COMPLETED_BY_THIS");

    // ٦-ج: relink A2 (الحيّة بـB1) إلى B2 المفتوحة ⟵ B1 تُعاد OPEN وB2 تصير COMPLETED بـA2
    const r2 = await correct({action: "relink", scanId: "scan-mp-s6-a2", toScanId: "scan-mp-s6-b2"});
    ok(r2.threw === null, `[٦] relink A2 إلى B2 نجح: ${r2.threw && r2.threw.message}`);
    deq([r2.ret.linkState, r2.ret.linkedScanId], ["relinked_by_admin", "scan-mp-s6-b2"], "[٦] A2: relinked_by_admin إلى B2");
    deq([(await pairOf("scan-mp-s6-b1")).state, (await pairOf("scan-mp-s6-b1")).completedByScanId], ["OPEN", null], "[٦] **B1 القديمة أُعيدت OPEN**");
    deq([(await pairOf("scan-mp-s6-b2")).state, (await pairOf("scan-mp-s6-b2")).completedByScanId], ["COMPLETED", "scan-mp-s6-a2"], "[٦] **وB2 الجديدة صارت COMPLETED بـA2**");
    deq(syncLines(r2.texts), [
      `[correctProtocolRecord] pair-sync reopened role=OLD before=${sid("scan-mp-s6-b1")} scan=${sid("scan-mp-s6-a2")} caller=${sid(ADMIN.uid)}`,
      `[correctProtocolRecord] pair-sync completed role=NEW before=${sid("scan-mp-s6-b2")} scan=${sid("scan-mp-s6-a2")} caller=${sid(ADMIN.uid)}`,
    ], "[٦] سطران: القديمة أُعيدت والجديدة اكتملت");
    note("correctProtocolRecord — relink بين «قبل» مفتوحة ومكتملة", syncLines(r2.texts));
    // القائمة: B1 (OPEN) تظهر؛ B2 (COMPLETED + ربط حيّ) لا تظهر
    const A3 = await sessionFor(OWN, {type: "THERMAL"});
    deq((await listBefores(OWN, A3.id)).ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s6-b1"], "[٦] القائمة: B1 تظهر وB2 لا (مكتملة وبربط حيّ)");
    // relink إلى الهدف نفسه: لا تغيير ولا أثر
    const same = await correct({action: "relink", scanId: "scan-mp-s6-a2", toScanId: "scan-mp-s6-b2"});
    deq([same.ret.changed, same.ret.correctionSeq, syncLines(same.texts)], [false, null, []], "[٦] relink إلى الهدف نفسه: changed=false بلا سطر ولا أثر pair");
    eq((await pairOf("scan-mp-s6-b2")).completedByScanId, "scan-mp-s6-a2", "[٦] وB2 لم تُمسّ");
    // unlink A2 الحيّة (relinked_by_admin بـB2): B2 تُعاد OPEN (اكتملت بـA2)
    const u3 = await correct({action: "unlink", scanId: "scan-mp-s6-a2"});
    deq([u3.ret.linkState, (await pairOf("scan-mp-s6-b2")).state, (await pairOf("scan-mp-s6-b2")).completedByScanId], ["unlinked_by_admin", "OPEN", null], "[٦] unlink لـA2 (relinked_by_admin): B2 أُعيدت OPEN");
    // الأسطر: لكل فحص «بعد» سطره بـseq تصاعدي، ولا سطر لـ«قبل»؛ ولا حذف
    deq((await linesFor("scan-mp-s6-a2")).map((l) => [l.seq, l.action]), [[1, "relink"], [2, "unlink"]], "[٦] سطرا A2: relink ثم unlink (seq 1 و2)");
    deq((await linesFor("scan-mp-s6-a1")).map((l) => [l.seq, l.action]), [[1, "unlink"], [2, "relink"], [3, "unlink"]], "[٦] أسطر A1 الثلاثة بالإلحاق: لا كتابة فوق سابق ولا حذف");
    ok((await db.collection("protocolCorrections").get()).docs.every((d) => Object.keys(d.data()).length === 9 && d.data().reasonCode === null), "[٦] كل أسطر التصحيح بتسعة حقول وreasonCode null (ق18)");
    ok(await exists("scanProtocol", "scan-mp-s6-b1") && await exists("scanProtocol", "scan-mp-s6-b2") && await exists("reports", "scan-mp-s6-b1"), "[٦] لا حذف في أيّ مسار");
    // فحوص ليست «قبل» صيانة: relink/unlink بينها لا أثر لها على pair ولا سطر pair-sync (ما ليس زوجاً لا يُعلَن)
    const n1 = await fullScan({owner: OWN, anon: "anon-mp-s6-n1", scanId: "scan-mp-s6-n1", purpose: "normal", model: "PhoneS6"});
    const n2 = await fullScan({owner: OWN, anon: "anon-mp-s6-n2", scanId: "scan-mp-s6-n2", purpose: "normal", model: "PhoneS6"});
    ok(n1.sp.pair === null && n2.sp.pair === null, "(للتحقّق من البذر)");
    const rn = await correct({action: "relink", scanId: "scan-mp-s6-n1", toScanId: "scan-mp-s6-n2"});
    deq([rn.threw, rn.ret.changed, rn.ret.linkState, syncLines(rn.texts)], [null, true, "relinked_by_admin", []], "[٦] relink بين فحصين عاديَّين: يُكتب ولا سطر pair-sync (ما ليس «قبل» صيانة لا يُعلَن)");
    const un = await correct({action: "unlink", scanId: "scan-mp-s6-n1"});
    deq([un.threw, un.ret.changed, un.ret.linkState, syncLines(un.texts)], [null, true, "unlinked_by_admin", []], "[٦] unlink لفحص عادي: بلا سطر pair-sync");
    deq([(await data("scanProtocol", "scan-mp-s6-n2")).pair, (await data("scanProtocol", "scan-mp-s6-n1")).pair], [null, null], "[٦] وpair الفحصين العاديَّين باقٍ null");
    // الأفعال الأخرى لا تمسّ pair
    const exA = await correct({action: "exclude", scanId: "scan-mp-s6-a2", reason: "test"});
    ok(exA.threw === null && syncLines(exA.texts).length === 0, "[٦] exclude لا أثر له على pair ولا سطر pair-sync");
  }

  // ═══ ٧ — الظهور (قرار حسن 4): verifyReport الحقيقية على تقرير «قبل» وتقرير «بعد» مربوط (S7) ═══
  // الحارس الوحدوي (maintenancePairVisibility.test.js) يفحص العيّنات والتسرّب العدائي؛ وهنا الدالّة الحقيقية على المحاكي بتقارير كتبها analyzeDevice الحقيقي: لا شيء من الزوج يصل زائر الصفحة العامة.
  {
    const {verifyReport} = require("../src/reports/verifyReport");
    const HIDDEN = [...LEAK_FIELDS]; // الستّة المحظورة + scanProtocol + purposeSource (LEAK_FIELDS أعلاه)
    const deepHidden = (v, p = "") => {
      const out = [];
      if (Array.isArray(v)) v.forEach((x, i) => out.push(...deepHidden(x, `${p}[${i}]`)));
      else if (v !== null && typeof v === "object") for (const k of Object.keys(v)) { if (HIDDEN.includes(k)) out.push(`${p}.${k}`); out.push(...deepHidden(v[k], `${p}.${k}`)); }
      return out;
    };
    const verify = async (scanId, ip) => {
      let status = null; let body = null;
      const res = {
        status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; },
        set() { return this; }, setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, on() { return this; }, once() { return this; }, emit() {}, end() {}, headersSent: false,
      };
      const req = {method: "GET", query: {scanId}, headers: {"x-forwarded-for": ip}, ip, get: () => ""};
      const r = await call(() => verifyReport(req, res));
      return {status, body, threw: r.threw, texts: r.texts};
    };
    const OWN7 = "own-mp-s7";
    await seedOwner(OWN7);
    await setSettings(72);
    const b7 = await fullScan({owner: OWN7, anon: "anon-mp-s7-b", scanId: "scan-mp-s7-b", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneS7"});
    const x7 = await sessionFor(OWN7, {link: "scan-mp-s7-b"});
    await join(x7.code, "anon-mp-s7-a");
    const a7 = await analyze("scan-mp-s7-a", x7.id, "anon-mp-s7-a", "anonymous", "PhoneS7");
    ok(a7.threw === null, `[٧] تحليل «بعد» المربوط نجح: ${a7.threw && a7.threw.message}`);
    const spB = await data("scanProtocol", "scan-mp-s7-b");
    const spA = await data("scanProtocol", "scan-mp-s7-a");
    deq([spA.scanPurpose, spA.linkState, spA.linkedScanId, spB.pair.state, spB.pair.completedByScanId], ["maintenance_after", "active", "scan-mp-s7-b", "COMPLETED", "scan-mp-s7-a"], "[٧] (بذر) «بعد» مربوطة بـ«قبل» و«قبل» COMPLETED: أقصى ما يحمله الزوج من حقول في scanProtocol");
    await assertNoLeak("[٧] قبل", "scan-mp-s7-b", b7.r.ret);
    await assertNoLeak("[٧] بعد", "scan-mp-s7-a", a7.ret);
    // verifyReport الحقيقية: بمعرّف التقرير، وبـshortId (المسار الثاني في الدالّة)
    const shortA = (await data("reports", "scan-mp-s7-a")).shortId;
    const shortB = (await data("reports", "scan-mp-s7-b")).shortId;
    ok(typeof shortA === "string" && shortA.length > 0 && typeof shortB === "string" && shortB.length > 0, "[٧] (بذر) للتقريرين shortId");
    let ipSeq = 0;
    for (const [label, key, idOwn, idOther] of [["قبل", "scan-mp-s7-b", "scan-mp-s7-b", "scan-mp-s7-a"], ["بعد", "scan-mp-s7-a", "scan-mp-s7-a", "scan-mp-s7-b"], ["قبل (shortId)", shortB, "scan-mp-s7-b", "scan-mp-s7-a"], ["بعد (shortId)", shortA, "scan-mp-s7-a", "scan-mp-s7-b"]]) {
      const v = await verify(key, `203.0.113.${++ipSeq}`);
      ok(v.threw === null, `[٧] verifyReport ${label}: لا رمي`);
      ok(v.status === null && v.body && v.body.verified === true, `[٧] verifyReport ${label}: ردّ 200 ناجح (verified=true) — الفحص ليس على رفض`);
      eq(v.body.scanId, idOwn, `[٧] verifyReport ${label}: scanId هو تقرير الطلب`);
      deq(deepHidden(v.body), [], `[٧] verifyReport ${label}: لا حقل محظور بأيّ عمق في الردّ الحقيقي`);
      const text = JSON.stringify(v.body);
      ok(!text.includes(idOther) && !text.includes("maintenance_before") && !text.includes("maintenance_after"), `[٧] verifyReport ${label}: لا معرّف الطرف الآخر من الزوج ولا قيمة غرض صيانة في الردّ`);
      ok(!v.texts.join("\n").includes(idOwn) && !v.texts.join("\n").includes(idOther), `[٧] verifyReport ${label}: ولا معرّف فحص خامّ في أسطر السجلّ`);
    }
    // التقريران لا يختلفان في مفاتيح الردّ عن فحص عادي: الزوج لا يغيّر شكل الصفحة العامة
    const plain = await fullScan({owner: OWN7, anon: "anon-mp-s7-n", scanId: "scan-mp-s7-n", purpose: "normal", model: "PhoneS7"});
    const vPlain = await verify("scan-mp-s7-n", `203.0.113.${++ipSeq}`);
    const vAfter = await verify("scan-mp-s7-a", `203.0.113.${++ipSeq}`);
    ok(plain.r.threw === null && vPlain.body && vAfter.body, "[٧] (بذر) ردّ فحص عادي وردّ «بعد»");
    deq(Object.keys(vAfter.body), Object.keys(vPlain.body), "[٧] مفاتيح ردّ verifyReport لتقرير «بعد» مربوط = مفاتيح فحص عادي (الزوج لا يغيّر شكل الصفحة العامة)");
    deq(Object.keys(vAfter.body.aiResponse), Object.keys(vPlain.body.aiResponse), "[٧] وكذلك مفاتيح aiResponse");
  }

  // ═══ ٨ — (S8) المحلّ من pair.ownerId والسقف لكل محلّ: محلّان على المحاكي، «قبل» كتبها analyzeDevice الحقيقي ═══
  // ملاحظة صريحة: المحاكي لا يفرض الفهارس، فنجاح الاستعلام بمساواتين هنا لا يُثبت غياب الحاجة إلى فهرس على الإنتاج (مبنيّ على سلوك Firestore الموثَّق: دمج فهرسَي الحقلين المفرَدَين).
  {
    const A8 = "own-mp-s8-a";
    const B8 = "own-mp-s8-b";
    const CAP = 500;
    await seedOwner(A8);
    await seedOwner(B8);
    await setSettings(72);
    const sb1 = await fullScan({owner: B8, anon: "anon-mp-s8-b1", scanId: "scan-mp-s8-b1", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneS8"});
    const sb2 = await fullScan({owner: B8, anon: "anon-mp-s8-b2", scanId: "scan-mp-s8-b2", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneS8"});
    const sa1 = await fullScan({owner: A8, anon: "anon-mp-s8-a1", scanId: "scan-mp-s8-a1", purpose: "maintenance_before", defectType: "BATTERY", model: "PhoneS8"});
    deq([sa1.sp.pair.ownerId, sb1.sp.pair.ownerId, sb2.sp.pair.ownerId], [A8, B8, B8], "[٨] pair.ownerId = ownerId مستند الجلسة وقت الفتح (analyzeDevice الحقيقي، ثلاث «قبل» لمحلّين)");
    ok(!("ownerId" in sa1.sp) && Object.keys(sa1.sp).length === 16, "[٨] ولا مفتاح علوي جديد في scanProtocol: الستّة عشر كما هي (ق36 أ، القاعدة 23: كانت خمسة عشر)، والمالك داخل pair وحده");

    // A يملأ فوق السقف: «قبل» A الحقيقية منسوخة 500 مرّة (بالشكل الذي كتبه analyzeDevice نفسه) ⟵ 501 مفتوحة لـA
    const bulkIds = [];
    for (let start = 0; start < CAP; start += 250) {
      const batch = db.batch();
      for (let i = start; i < Math.min(start + 250, CAP); i++) {
        const id = `scan-mp-s8-bulk-${String(i).padStart(3, "0")}`;
        bulkIds.push(id);
        batch.set(db.collection("scanProtocol").doc(id), sa1.sp);
      }
      await batch.commit();
    }
    const oldShape = await db.collection("scanProtocol").where("pair.state", "==", "OPEN").limit(CAP + 1).get();
    eq(oldShape.size, CAP + 1, "[٨] **قبل S8**: الاستعلام العامّ pair.state == OPEN وحده يبلغ السقف + 1 على هذه البيانات ⟵ كان B يُرفض هو أيضاً بسبب A");
    const forB = await db.collection("scanProtocol").where("pair.ownerId", "==", B8).where("pair.state", "==", "OPEN").limit(CAP + 1).get();
    eq(forB.size, 2, "[٨] **بعد S8**: الاستعلام بمساواتين (pair.ownerId وpair.state) يُعيد «قبل» B الاثنتين وحدهما");

    const xB = await afterSession(B8);
    const rB = await listBefores(B8, xB);
    ok(rB.threw === null, `[٨] B يُخدَم رغم أنّ A فوق السقف: ${rB.threw && rB.threw.message}`);
    deq(rB.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s8-b2", "scan-mp-s8-b1"], "[٨] مرشَّحو B وحدهم والأحدث أوّلاً (لا شيء من «قبل» A)");
    const servedB = listLines(rB.texts).find((t) => t.includes(" served "));
    ok(servedB.includes("openRead=2 candidates=2"), `[٨] سطر الخدمة لـB: openRead=2 (المقروء لـB وحده) — ${servedB}`);

    const xA = await afterSession(A8);
    const rA = await listBefores(A8, xA);
    ok(rA.threw !== null, "[٨] A (501 مفتوحة) يُرفض");
    deq([rA.threw.code, rA.threw.message, rA.threw.details], ["failed-precondition", "PAIR_SCAN_CAP_EXCEEDED", {reasonCode: "PAIR_SCAN_CAP_EXCEEDED"}], "[٨] برفض مسمّى PAIR_SCAN_CAP_EXCEEDED (لا اقتطاع صامت)");
    ok(listLines(rA.texts).some((t) => t.startsWith(`[listOpenMaintenanceBefores] refused reason=PAIR_SCAN_CAP_EXCEEDED session=${sid(xA)}`) && t.endsWith(` cap=${CAP}`)), "[٨] وسطر الرفض باسمه وcap=500");

    // تكتمل واحدة من A (COMPLETED تخرج من العدّ) فيُخدَم ثانيةً: 500 بالضبط مقبول
    await db.collection("scanProtocol").doc(bulkIds[0]).update({"pair.state": "COMPLETED", "pair.completedByScanId": "scan-mp-s8-x"});
    const rA2 = await listBefores(A8, xA);
    ok(rA2.threw === null, `[٨] A بـ500 مفتوحة (بعد اكتمال واحدة) يُخدَم: ${rA2.threw && rA2.threw.message}`);
    deq(rA2.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s8-a1"], "[٨] ومرشَّحه الوحيد «قبل» الحقيقية (للنُّسَخ بلا تقرير: REPORT_ABSENT)");
    const servedA = listLines(rA2.texts).find((t) => t.includes(" served "));
    ok(servedA.includes(`openRead=${CAP} `) && servedA.includes("REPORT_ABSENT:499"), `[٨] سطر الخدمة لـA: openRead=500 وREPORT_ABSENT:499 — ${servedA}`);

    // شذوذ: تقرير b2 يصير لمحلّ A بينما pair.ownerId = B ⟵ يُستبعد ويُعلَن ولا يُصمَت
    await db.collection("reports").doc("scan-mp-s8-b2").update({userId: A8});
    const rB2 = await listBefores(B8, xB);
    deq(rB2.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s8-b1"], "[٨] شذوذ b2 (pair.ownerId = B والتقرير لـA): تُستبعد من قائمة B");
    const anomalyLines = rB2.lines.filter((l) => l.level === "warn" && l.text.startsWith("[listOpenMaintenanceBefores] anomaly "));
    deq(anomalyLines.map((l) => l.text), [`[listOpenMaintenanceBefores] anomaly reason=PAIR_OWNER_MISMATCH count=1 sample=${sid("scan-mp-s8-b2")} session=${sid(xB)} caller=${sid(B8)}`], "[٨] **الشذوذ يُعلَن بسطر تحذير مسمّى** (المعرّفات مُهشَّرة، بلا طراز ولا اسم)");
    ok(listLines(rB2.texts).find((t) => t.includes(" served ")).includes("OWNER_MISMATCH:1"), "[٨] وسطر الخدمة يعدّ OWNER_MISMATCH:1");
    ok(!rB2.texts.join("\n").includes("scan-mp-s8-b2") && !rB2.texts.join("\n").includes(B8) && !rB2.texts.join("\n").includes("PhoneS8"), "[٨] ولا معرّف خامّ ولا طراز في أيّ سطر");
    // التأكيد على الشذوذ نفسه يُرفض به (من الجهتين) ولا يُكتب شيء
    const cB = await confirmLink(B8, xB, "scan-mp-s8-b2");
    ok(cB.threw !== null, "[٨] تأكيد B لـb2 يُرفض");
    deq([cB.threw.code, cB.threw.message, cB.threw.details], ["failed-precondition", "PAIR_OWNER_MISMATCH", {reasonCode: "PAIR_OWNER_MISMATCH"}], "[٨] بـPAIR_OWNER_MISMATCH");
    ok(confirmLines(cB.texts).some((t) => t.startsWith("[confirmMaintenanceAfterLink] refused reason=PAIR_OWNER_MISMATCH ") && t.endsWith(" ownerState=PAIR_DIFFERS_FROM_REPORT")), "[٨] وسطر الرفض بسببه وownerState=PAIR_DIFFERS_FROM_REPORT");
    eq((await pendingNoDraw(xB)).linkedScanId, null, "[٨] ولا ربط كُتب");
    // «قبل» محلّ آخر حقاً (pair والتقرير معاً): NOT_OWNED لا شذوذ
    const cA = await confirmLink(A8, xA, "scan-mp-s8-b1");
    deq([cA.threw.code, cA.threw.message], ["permission-denied", "BEFORE_NOT_OWNED"], "[٨] A يؤكّد «قبل» B الحقيقية ⟵ BEFORE_NOT_OWNED (pair والتقرير لـB: ليس شذوذاً)");
    await db.collection("reports").doc("scan-mp-s8-b2").update({userId: B8});

    // «قبل» بلا pair.ownerId (null صريح؛ شكل قديم أو مالك مجهول) لا تظهر ولا تُؤكَّد
    await db.collection("scanProtocol").doc("scan-mp-s8-b1").update({"pair.ownerId": null});
    const rB3 = await listBefores(B8, xB);
    deq(rB3.ret.candidates.map((c) => c.beforeScanId), ["scan-mp-s8-b2"], "[٨] «قبل» بلا pair.ownerId لا تظهر في قائمة B (لا تطابق الاستعلام)");
    const cB3 = await confirmLink(B8, xB, "scan-mp-s8-b1");
    deq([cB3.threw.code, cB3.threw.message], ["failed-precondition", "PAIR_BEFORE_UNREADABLE"], "[٨] ولا تُؤكَّد: PAIR_BEFORE_UNREADABLE (الغياب لا يُقرأ تطابقاً)");
    await db.collection("scanProtocol").doc("scan-mp-s8-b1").update({"pair.ownerId": B8});

    // اتّساق S6 (التصحيح) والاكتمال لا يمسّان ownerId: اكتمال حقيقي ثم unlink/relink بالمشرف
    const yB = await sessionFor(B8, {link: "scan-mp-s8-b2"});
    await join(yB.code, "anon-mp-s8-y");
    const aY = await analyze("scan-mp-s8-y", yB.id, "anon-mp-s8-y", "anonymous", "PhoneS8");
    ok(aY.threw === null, `[٨] تحليل «بعد» المربوط نجح: ${aY.threw && aY.threw.message}`);
    deq([(await data("scanProtocol", "scan-mp-s8-b2")).pair.state, (await data("scanProtocol", "scan-mp-s8-b2")).pair.ownerId], ["COMPLETED", B8], "[٨] الاكتمال الحقيقي: pair.state = COMPLETED وownerId لم يُمسّ");
    const ADM8 = {uid: "admin-mp-s8", token: {email: ADMIN_EMAILS[0], email_verified: true}};
    const unlink8 = await call(() => correctProtocolRecord.run({data: {action: "unlink", scanId: "scan-mp-s8-y"}, auth: ADM8, rawRequest: {headers: {}}}));
    ok(unlink8.threw === null, `[٨] unlink بالمشرف نجح: ${unlink8.threw && unlink8.threw.message}`);
    deq([(await data("scanProtocol", "scan-mp-s8-b2")).pair.state, (await data("scanProtocol", "scan-mp-s8-b2")).pair.ownerId], ["OPEN", B8], "[٨] unlink (S6) يُعيد «قبل» OPEN وownerId باقٍ (تحديثان منقَّطان)");
    deq(Object.keys((await data("scanProtocol", "scan-mp-s8-b2")).pair).sort(), ["completedByScanId", "openedAt", "ownerId", "state"], "[٨] مفاتيح pair بعد إعادة الفتح: الأربعة (completedByScanId = null صريح)");
    deq((await listBefores(B8, xB)).ret.candidates.map((c) => c.beforeScanId).sort(), ["scan-mp-s8-b1", "scan-mp-s8-b2"], "[٨] وتعود «قبل» b2 إلى قائمة B بعد unlink");
  }

  // @@SCENES-END@@

  for (const t of OBSERVED) console.log(t);
  console.log(`maintenancePair.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});

