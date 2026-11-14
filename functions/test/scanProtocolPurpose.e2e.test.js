// E2E test: غرض الفحص وscanProtocol — createScanSession وsetSessionPurpose وanalyzeDevice الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-03، 2026-10-18 +03).
// **الاستبدال الوحيد**: نداء المزوّد (global.fetch، لا شبكة، القاعدة 9) ووحدة Gemini بكعب يفشل. **وحقن الفشل** (لا يستبدل الطبقة: يمرّر الاستدعاء الحقيقي): غلاف على db.runTransaction يرمي من `tx.set` لمستند
// protocolPending وحده (مشهد الذرّية في setSessionPurpose)، وغلاف على db.batch يسجّل مسارات الكتابة ويُفشل التزاماً واحداً (مشهد الذرّية في analyzeDevice). كل ما سواه يمرّ إلى المحاكي كما هو.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٢ (:449-517) وdocs/PROTOCOL_CONTRACT.md §٢ A2 (يحمل نصّها المقتبس وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ createScanSession: الغرض الافتراضي normal في مستند الجلسة؛ مصدره في protocolPending/{id} (default مع جزء الأغراض، feature_disabled بدونه — «الغائب غير مفعَّل»)؛ الجلسة والمصدر في دفعة واحدة؛
//      protocolParts في الردّ (ستّة مفاتيح بـtrue/false)؛ رفض البوابات لا يكتب شيئاً.
//   ٢ setSessionPurpose: المالك يختار والجلسة pending فيُكتب الغرض والمصدر selected (حتى «عادي» المختار صراحةً) في معاملة واحدة؛ يُغيَّر ما دامت pending؛ ويُرفض بسبب مسمّى: بلا هوية/جلسة/غرض/غرض خارج الثلاثة،
//      غير المالك (الردّ نفسه لجلسة غير موجودة)، scanning/completed/cancelled/expired ⟵ PURPOSE_SESSION_NOT_PENDING، حالة غائبة/مجهولة، pending منقضية ⟵ تُكتب «منتهية»، expiresAt غائب ⟵ بلا كتابة؛
//      الجلسة المُنشأة قبل النشر تقبل الاختيار؛ وفشل كتابة المصدر يُسقط كتابة الغرض (ذرّية).
//   ٣ analyzeDevice: مستند scanProtocol/{scanId} في **الدفعة الذرّية نفسها** مع التقرير والخامّ (ثلاثة مستندات)؛ قيمه: الغرض ومصدره من الجلسة وprotocolPending، والربط none، وprotocolVersion، وsettingsVersion=SETTINGS_ABSENT؛
//      فحص بلا جلسة ⟵ NO_SESSION؛ جلسة بلا غرض (قبل النشر) أو بغرض مجهول ⟵ UNDECLARED بملاحظة مسمّاة؛ غرض معروف بلا مصدر ⟵ مصدر null بملاحظة؛ الإعادة من المخزَّن لا تكتب ثانيةً؛ فشل الالتزام لا يترك شيئاً من الثلاثة.
//   ٤ لا يتسرّب شيء من scanProtocol إلى مستند التقرير ولا الخامّ ولا ردّ التحليل، ولا معرّف خامّ في أيّ سطر سجلّ جديد، ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/scanProtocolPurpose.e2e.test.js"

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

const {admin, db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// حقن الفشل ١: غلاف على db.runTransaction يرمي من tx.set لمستند protocolPending وحده، حين يُفعَّل (مشهد ٢-ي).
let failPendingSet = 0;
let injectedPendingSet = 0;
const realRunTransaction = db.runTransaction.bind(db);
db.runTransaction = (cb, opts) => realRunTransaction(async (tx) => {
  const guarded = new Proxy(tx, {
    get(target, prop) {
      if (prop === "set") {
        return (ref, ...rest) => {
          if (failPendingSet > 0 && ref.path.startsWith("protocolPending/")) {
            failPendingSet--;
            injectedPendingSet++;
            throw Object.assign(new Error("injected protocolPending write failure"), {code: 7});
          }
          return target.set(ref, ...rest);
        };
      }
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return cb(guarded);
}, opts);
// حقن الفشل ٢: غلاف على db.batch: يسجّل مسار كل set، ويُفشل التزاماً واحداً حين يُفعَّل (مشهد ٣-ي).
let failNextCommit = false;
let injectedCommit = 0;
let batchSets = [];
const realBatch = db.batch.bind(db);
db.batch = () => {
  const b = realBatch();
  const set = b.set.bind(b);
  const commit = b.commit.bind(b);
  const mine = [];
  b.set = (ref, ...rest) => { mine.push(ref.path); return set(ref, ...rest); };
  b.commit = async () => {
    batchSets.push(mine.slice());
    if (failNextCommit) {
      failNextCommit = false;
      injectedCommit++;
      throw Object.assign(new Error("injected batch commit failure"), {code: 7});
    }
    return commit();
  };
  return b;
};

const FINGERPRINT = {
  device: {model: "TestPhone", androidVersion: "14", totalRamGb: 8},
  timeSeries: {header: {}, footer: {}, samples: [], variables: []},
  functionalResults: [],
  manualResults: [],
};
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
// S-P6-10 (2026-10-21، القاعدة 23): protocolPending لجلسة أنشأها createScanSession يحمل الآن سحب التقييم المزدوج (doubleEvalDraw) مع مصدر الغرض (كانت المقارنات تثبّت «المصدر وحده»: استُبدلت بهذا المساعد). يثبت وجود السحب سليم الشكل ويُرجع ما سواه؛ محتوى السحب وقيمه في doubleEval.e2e.test.js.
const pendingWithoutDraw = async (id) => {
  const d = await data("protocolPending", id);
  ok(d && d.doubleEvalDraw && typeof d.doubleEvalDraw === "object" && typeof d.doubleEvalDraw.selected === "boolean", `[S-P6-10] protocolPending/{${sid(id)}} يحمل سحب التقييم المزدوج سليم الشكل`);
  const {doubleEvalDraw, ...rest} = d;
  return rest;
};
// (2026-10-22) protocolPending بعد setSessionPurpose: المصدر selected ونوع العطل (أو null صريحاً) واختيار الربط ممسوح (null صريحة) — القاعدة 23: كان يثبّت {purposeSource: "selected"} وحده.
const SEL = (defectType) => ({purposeSource: "selected", defectType, linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null});
const credit =async (uid) => (await getDoc("users", uid)).data().scansRemaining;
const seedOwner = (uid, extra = {}) => db.collection("users").doc(uid).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), ...extra});
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
const setPurpose = (uid, sessionId, purpose, authOverride, defectType) => call(() => setSessionPurpose.run({
  // (2026-10-22، A2) maintenance_* تحمل نوع عطل (BATTERY افتراضياً هنا)؛ ويُمرَّر غيره بالمعامل الخامس. حالات رفض النوع وتخزينه في maintenancePair.e2e.test.js.
  data: {sessionId, purpose, ...(defectType !== undefined ? {defectType} : (typeof purpose === "string" && purpose.startsWith("maintenance_") ? {defectType: "BATTERY"} : {}))}, auth: authOverride === undefined ? {uid, token: tokenOf("google.com")} : authOverride, rawRequest: {headers: {}},
}));
const analyze = (scanId, sessionId, uid, provider) => call(() => analyzeDevice.run({
  data: {scanId, fingerprint: FINGERPRINT, ...(sessionId ? {sessionId} : {})}, auth: {uid, token: tokenOf(provider)}, rawRequest: {headers: {}},
}));
const purposeLines = (texts) => texts.filter((t) => t.startsWith("[setSessionPurpose] "));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };

const PARTS_ALL_FALSE = {purposes: false, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: false, consent: false};
// (2026-10-22، القاعدة 23: كان بلا defectType وpair؛ استُبدل: المستند بخمسة عشر حقلاً، والنوع والزوج null صريحان لغير الصيانة — A2 وA3)
// (ق36 أ، 2026-10-22، القاعدة 23: وأُضيف linkModelCheck: null صريحاً — لا مقارنة طراز بلا ربط محلول)
const SP_STATIC = {linkedScanId: null, linkState: "none", linkMethod: null, protocolVersion: 1, settingsVersion: "SETTINGS_ABSENT", defectType: null, pair: null, linkModelCheck: null};

function expectRefusal(label, r, {code, message, reasonCode, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode}], `${label}: الرمز والنصّ والتفصيل`);
  const named = purposeLines(r.texts).filter((t) => t.startsWith("[setSessionPurpose] refused "));
  eq(named.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(named[0].startsWith(`[setSessionPurpose] refused reason=${logReason}`) && named[0].endsWith(logExtra), `${label}: السطر بسببه المسمّى ${logReason}${logExtra} — ${named[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return named[0];
}

(async () => {
  // ═══ ١ — createScanSession ═══
  let sessA1;
  {
    await seedOwner("own-sp-a1");
    batchSets = [];
    const r = await create("own-sp-a1");
    ok(r.threw === null && r.ret && typeof r.ret.sessionId === "string", "[١] الجلسة أُنشئت");
    sessA1 = r.ret.sessionId;
    deq(Object.keys(r.ret).sort(), ["code", "expiresInMinutes", "protocolParts", "sessionId"], "[١] مفاتيح الردّ: الثلاثة القائمة + protocolParts");
    deq(r.ret.protocolParts, PARTS_ALL_FALSE, "[١] مالك بلا protocolParts: ستّة مفاتيح كلّها false («الغائب غير مفعَّل») — لا مفتاح غائب");
    const s = await data("scanSessions", sessA1);
    eq(s.purpose, "normal", "[١] الغرض الافتراضي normal في مستند الجلسة");
    eq(s.status, "pending", "[١] والحالة pending كما كانت");
    deq(Object.keys(s).sort(), ["code", "createdAt", "deviceModel", "expiresAt", "ownerId", "purpose", "scanId", "status"], "[١] مستند الجلسة: الحقول القائمة + purpose وحده (لا مصدر الغرض فيه)");
    deq(await pendingWithoutDraw(sessA1), {purposeSource: "feature_disabled"}, "[١] protocolPending/{id}: المصدر feature_disabled («المحلّ بلا تفعيل الغرض») ولا شيء غيره سوى سحب التقييم المزدوج (S-P6-10)");
    deq(batchSets.filter((b) => b.some((p) => p.startsWith("scanSessions/"))), [[`scanSessions/${sessA1}`, `protocolPending/${sessA1}`]], "[١] الجلسة والمصدر في **دفعة واحدة** (التزام واحد بمستندين)");
    ok(!r.texts.join("\n").includes(sessA1), "[١] لا معرّف جلسة خامّ في أيّ سطر سجلّ");
    ok(r.texts.some((t) => t === `4 - Session saved: ${sid(sessA1)}`), "[١] وسطر الحفظ بالمعرّف المُهشَّر (كما كان)");
  }
  {
    await seedOwner("own-sp-a2", {protocolParts: {purposes: true, consent: true}});
    const r = await create("own-sp-a2");
    deq(r.ret.protocolParts, {...PARTS_ALL_FALSE, purposes: true, consent: true}, "[١] جزء الأغراض والموافقة مفعَّلان: كلّ جزء بقيمته (والباقي false)");
    eq((await data("scanSessions", r.ret.sessionId)).purpose, "normal", "[١] الغرض normal دائماً عند الإنشاء");
    deq(await pendingWithoutDraw(r.ret.sessionId), {purposeSource: "default"}, "[١] مع جزء الأغراض: المصدر default (\"عادي\" الافتراضي)");
  }
  let a3 = 0;
  for (const [label, parts] of [["purposes نصّ «true»", {purposes: "true"}], ["purposes الرقم 1", {purposes: 1}], ["protocolParts نصّ", "purposes"], ["جزء غير الأغراض وحده", {consent: true}], ["purposes false", {purposes: false}]]) {
    const uid = `own-sp-a3-${a3++}`;
    await seedOwner(uid, {protocolParts: parts});
    const r = await create(uid);
    eq(r.ret.protocolParts.purposes, false, `[١] ${label}: غير مفعَّل (=== true وحدها تفعّل)`);
    deq(await pendingWithoutDraw(r.ret.sessionId), {purposeSource: "feature_disabled"}, `[١] ${label}: المصدر feature_disabled`);
  }
  {
    // رفض البوابات لا يكتب شيئاً
    await seedOwner("own-sp-a4-free", {plan: "free"});
    await seedOwner("own-sp-a4-zero", {scansRemaining: 0});
    const sessionsBefore = await count("scanSessions");
    const pendingBefore = await count("protocolPending");
    const f = await create("own-sp-a4-free");
    const z = await create("own-sp-a4-zero");
    ok(f.threw && z.threw, "[١] رفض الباقة ورفض الرصيد قائمان");
    eq(await count("scanSessions"), sessionsBefore, "[١] الرفض لا ينشئ جلسة");
    eq(await count("protocolPending"), pendingBefore, "[١] ولا protocolPending (لا مستند معلَّق بلا جلسة)");
  }

  // ═══ ٢ — setSessionPurpose ═══
  {
    // ٢-أ: النجاح، والمصدر selected حتى لـ«عادي» المختار صراحةً، والتغيير ما دامت pending
    // (2026-10-22، القاعدة 23) كانت المشاهد تختار battery_before/battery_after؛ صارت maintenance_before/maintenance_after بنوع عطل: هما اللتان تُختاران بعد أمر ربط «قبل/بعد صيانة» (A2)، وbattery_* قيمتا قراءة تاريخيتان.
    // (ق31، 2026-10-22، القاعدة 23: كان الجزء purposes وحده؛ maintenance_* في هذا المشهد صارت تحتاج batteryBeforeAfter أيضاً)
    await seedOwner("own-sp-b1", {protocolParts: {purposes: true, batteryBeforeAfter: true}});
    const created = await create("own-sp-b1");
    const id = created.ret.sessionId;
    const before = await data("scanSessions", id);
    deq(await pendingWithoutDraw(id), {purposeSource: "default"}, "[٢] قبل الاختيار: المصدر default");
    const r1 = await setPurpose("own-sp-b1", id, "maintenance_before");
    ok(r1.threw === null, "[٢] الاختيار نجح");
    deq(r1.ret, {sessionId: id, purpose: "maintenance_before", purposeSource: "selected"}, "[٢] الردّ: {sessionId, purpose, purposeSource: selected}");
    const after = await data("scanSessions", id);
    deq({...after, purpose: undefined}, {...before, purpose: undefined}, "[٢] مستند الجلسة: purpose وحده تغيّر (الحالة والرمز والانتهاء والمالك كما هي)");
    eq(after.purpose, "maintenance_before", "[٢] والغرض الجديد maintenance_before");
    deq(await pendingWithoutDraw(id), SEL("BATTERY"), "[٢] المصدر صار selected (والسحب باقٍ: setSessionPurpose يدمج)");
    deq(purposeLines(r1.texts), [`[setSessionPurpose] set session=${sid(id)} caller=${sid("own-sp-b1")} purpose=maintenance_before previous=normal defectType=BATTERY`], "[٢] سطر النجاح الوحيد: المعرّفان مُهشَّران والغرض والسابق");
    ok(!r1.texts.join("\n").includes(id) && !r1.texts.join("\n").includes("own-sp-b1"), "[٢] لا معرّف خامّ في السجلّ");
    note("setSessionPurpose — نجاح", purposeLines(r1.texts));
    // التغيير ما دامت pending
    const r2 = await setPurpose("own-sp-b1", id, "maintenance_after");
    deq(r2.ret, {sessionId: id, purpose: "maintenance_after", purposeSource: "selected"}, "[٢] تغيير الغرض ما دامت الجلسة pending مقبول");
    ok(purposeLines(r2.texts)[0].endsWith("purpose=maintenance_after previous=maintenance_before defectType=BATTERY"), "[٢] والسجلّ يحمل الغرض السابق");
    // «عادي» المختار صراحةً يتميّز من الافتراضي: المصدر selected
    const r3 = await setPurpose("own-sp-b1", id, "normal");
    eq(r3.ret.purposeSource, "selected", "[٢] «عادي» بالاختيار الصريح: المصدر selected (لا default) — فيتميّز من «عادي» الافتراضي (PLAN-06:478)");
    deq(await pendingWithoutDraw(id), SEL(null), "[٢] والمخزَّن selected");
    // كل غرض من الثلاثة
    for (const p of ["normal", "maintenance_before", "maintenance_after"]) {
      const x = await setPurpose("own-sp-b1", id, p);
      eq(x.ret && x.ret.purpose, p, `[٢] الغرض ${p} مقبول`);
    }
  }
  {
    // ٢-ب: جلسة مالك بلا جزء الأغراض (feature_disabled): النداء **مرفوض** بـPURPOSE_PART_NOT_ENABLED بلا أيّ كتابة — ق31، أقرّه حسن 2026-10-22.
    // (القاعدة 23: كان هذا المشهد يثبّت القبول بتعليق «معلّق: قرار المستخدم»؛ استُبدل ولم يُضَف إليه. التفصيل الكامل في setSessionPurposePart.e2e.test.js.)
    await seedOwner("own-sp-b2");
    const created = await create("own-sp-b2");
    const id = created.ret.sessionId;
    deq(await pendingWithoutDraw(id), {purposeSource: "feature_disabled"}, "[٢] قبل الاختيار: feature_disabled");
    const sessionBefore = await data("scanSessions", id);
    const r = await setPurpose("own-sp-b2", id, "maintenance_before");
    ok(r.threw !== null, "[٢] ق31: النداء من محلّ بلا جزء الأغراض مرفوض");
    deq(r.threw && [r.threw.code, r.threw.message, r.threw.details], ["failed-precondition", "PURPOSE_PART_NOT_ENABLED", {reasonCode: "PURPOSE_PART_NOT_ENABLED"}], "[٢] ق31: failed-precondition ورسالته رمزه التقني وdetails.reasonCode");
    deq(purposeLines(r.texts), [`[setSessionPurpose] refused reason=PURPOSE_PART_NOT_ENABLED session=${sid(id)} caller=${sid("own-sp-b2")} part=purposes`], "[٢] ق31: سطر الرفض المسمّى باسم الجزء الناقص");
    deq(await data("scanSessions", id), sessionBefore, "[٢] ق31: مستند الجلسة لم يُمسّ");
    deq(await pendingWithoutDraw(id), {purposeSource: "feature_disabled"}, "[٢] ق31: ومصدر الغرض باقٍ feature_disabled (لا كتابة)");
  }
  {
    // ٢-ج: المدخلات
    await seedOwner("own-sp-c");
    const id = (await create("own-sp-c")).ret.sessionId;
    const before = await data("scanSessions", id);
    const pendingBefore = await data("protocolPending", id);
    const ids = [id, "own-sp-c"];
    expectRefusal("[٢] بلا auth", await setPurpose(null, id, "normal", null), {code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "SET_PURPOSE_NOT_AUTHENTICATED", logReason: "SET_PURPOSE_NOT_AUTHENTICATED", ids});
    expectRefusal("[٢] auth بلا uid", await setPurpose(null, id, "normal", {token: {}}), {code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "SET_PURPOSE_NOT_AUTHENTICATED", logReason: "SET_PURPOSE_NOT_AUTHENTICATED", ids});
    for (const [label, sess] of [["sessionId غائب", undefined], ["sessionId فارغ", ""], ["sessionId مسافات", "   "], ["sessionId رقم", 7]]) {
      expectRefusal(`[٢] ${label}`, await setPurpose("own-sp-c", sess, "normal"), {code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "SET_PURPOSE_SESSION_ID_REQUIRED", logReason: "SET_PURPOSE_SESSION_ID_REQUIRED", ids});
    }
    for (const [label, p] of [["غرض غائب", undefined], ["غرض null", null], ["غرض فارغ", ""]]) {
      expectRefusal(`[٢] ${label}`, await setPurpose("own-sp-c", id, p), {code: "invalid-argument", message: "SET_PURPOSE_REQUIRED", reasonCode: "SET_PURPOSE_REQUIRED", logReason: "SET_PURPOSE_REQUIRED", ids});
    }
    for (const [label, p] of [["غرض مجهول", "technician_check"], ["battery_before (قيمة قراءة تاريخية: لم تعد تُختار)", "battery_before"], ["battery_after (قيمة قراءة تاريخية)", "battery_after"], ["NO_SESSION", "NO_SESSION"], ["UNDECLARED", "UNDECLARED"], ["repeat_cold (ليس مما يختاره المالك)", "repeat_cold"], ["أحرف مختلفة", "Normal"], ["رقم", 5], ["كائن", {a: 1}]]) {
      expectRefusal(`[٢] ${label}`, await setPurpose("own-sp-c", id, p), {code: "invalid-argument", message: "SET_PURPOSE_INVALID", reasonCode: "SET_PURPOSE_INVALID", logReason: "SET_PURPOSE_INVALID", ids});
    }
    deq(await data("scanSessions", id), before, "[٢] كل الرفوض أعلاه لم تمسّ مستند الجلسة");
    deq(await data("protocolPending", id), pendingBefore, "[٢] ولا protocolPending");
  }
  {
    // ٢-د: غير المالك والجلسة غير الموجودة: الردّ نفسه
    await seedOwner("own-sp-d");
    const id = (await create("own-sp-d")).ret.sessionId;
    const sessionsBefore = await count("scanSessions");
    const before = await data("scanSessions", id);
    const ids = [id, "own-sp-d", "stranger-sp-d"];
    const stranger = await setPurpose("stranger-sp-d", id, "maintenance_before");
    const missing = await setPurpose("own-sp-d", "no-such-session-sp-d", "maintenance_before");
    const wire = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT"};
    expectRefusal("[٢] غريب", stranger, {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=SET", ids});
    expectRefusal("[٢] جلسة غير موجودة", missing, {...wire, logReason: "SESSION_NOT_FOUND", ids: ["no-such-session-sp-d", "own-sp-d"]});
    deq([stranger.threw.code, stranger.threw.message, stranger.threw.details], [missing.threw.code, missing.threw.message, missing.threw.details], "[٢] **ردّ الغريب هو ردّ الجلسة غير الموجودة نفسه**: لا يُكشف وجود جلسة");
    // المنضمّ ليس المالك
    await db.collection("scanSessions").doc(id).update({status: "scanning", joinedBy: "joiner-sp-d"});
    const joiner = await setPurpose("joiner-sp-d", id, "maintenance_before");
    expectRefusal("[٢] المنضمّ (ليس المالك) على جلسة scanning", joiner, {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=SET", ids: [id, "joiner-sp-d"]});
    const strangerOnScanning = await setPurpose("stranger-sp-d", id, "normal");
    expectRefusal("[٢] غريب على scanning: الملكية قبل الحالة", strangerOnScanning, {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=SET"});
    // ownerId غائب في مستند الجلسة
    await seedSession("sess-sp-d-noowner", {status: "pending", expiresAt: FUTURE(), code: "NC-SPD001"});
    expectRefusal("[٢] جلسة بلا ownerId", await setPurpose("someone", "sess-sp-d-noowner", "normal"), {...wire, logReason: "SESSION_NOT_OWNER", logExtra: " ownerState=ABSENT"});
    eq((await data("scanSessions", id)).purpose, "normal", "[٢] ما رُفض لم يغيّر الغرض (بقي normal)");
    eq(await count("scanSessions"), sessionsBefore + 1, "[٢] ولا جلسة حُذفت أو أُنشئت بسبب الرفض (جلسة البذر وحدها)");
    ok(before.status === "pending", "[٢] (للتحقّق من البذر)");
  }
  {
    // ٢-هـ: بعد الانضمام تُقفل الرقائق: كل حالة غير pending ⟵ PURPOSE_SESSION_NOT_PENDING
    for (const status of ["scanning", "completed", "cancelled", "expired"]) {
      const uid = `own-sp-e-${status}`;
      const id = `sess-sp-e-${status}`;
      await seedOwner(uid);
      await seedSession(id, {ownerId: uid, status, code: `NC-SPE${status.length}`, expiresAt: FUTURE(), joinedBy: "joiner-e", purpose: "normal", scanId: null, deviceModel: null});
      await db.collection("protocolPending").doc(id).set({purposeSource: "default"});
      const before = await data("scanSessions", id);
      const r = await setPurpose(uid, id, "maintenance_before");
      expectRefusal(`[٢] المالك على ${status}`, r, {code: "failed-precondition", message: "PURPOSE_SESSION_NOT_PENDING", reasonCode: "PURPOSE_SESSION_NOT_PENDING", logReason: "PURPOSE_SESSION_NOT_PENDING", logExtra: ` status=${status}`, ids: [id, uid]});
      deq(await data("scanSessions", id), before, `[٢] ${status}: مستند الجلسة لم يُمسّ (الغرض باقٍ)`);
      deq(await data("protocolPending", id), {purposeSource: "default"}, `[٢] ${status}: والمصدر باقٍ default`);
    }
    note("setSessionPurpose — بعد الانضمام", [(await setPurpose("own-sp-e-scanning", "sess-sp-e-scanning", "normal")).texts.filter((t) => t.includes("refused"))[0]]);
    // scanning منقضية: الحالة قبل الانقضاء (لا تُكتب «منتهية» من هنا)
    await seedOwner("own-sp-e2");
    await seedSession("sess-sp-e2", {ownerId: "own-sp-e2", status: "scanning", code: "NC-SPE900", expiresAt: PAST(), joinedBy: "j", purpose: "normal"});
    const r = await setPurpose("own-sp-e2", "sess-sp-e2", "maintenance_before");
    expectRefusal("[٢] scanning منقضية", r, {code: "failed-precondition", message: "PURPOSE_SESSION_NOT_PENDING", reasonCode: "PURPOSE_SESSION_NOT_PENDING", logReason: "PURPOSE_SESSION_NOT_PENDING", logExtra: " status=scanning"});
    eq((await data("scanSessions", "sess-sp-e2")).status, "scanning", "[٢] ولا تُكتب «منتهية» لغير pending من هنا (الكاتب الوحيد: pending المنقضية)");
  }
  {
    // ٢-و: حالة غائبة أو مجهولة
    let k = 0;
    for (const [label, statusField, state] of [["غائبة", ABSENT_FIELD(), "ABSENT"], ["null", {status: null}, "ABSENT"], ["رقم", {status: 5}, "NOT_A_STRING"], ["لا تعرفها الشيفرة", {status: "done"}, "UNRECOGNIZED"], ["أحرف مختلفة", {status: "Pending"}, "UNRECOGNIZED"]]) {
      const uid = `own-sp-f-${k}`;
      const id = `sess-sp-f-${k++}`;
      await seedOwner(uid);
      await seedSession(id, {ownerId: uid, code: `NC-SPF00${k}`, expiresAt: FUTURE(), ...statusField});
      const before = await data("scanSessions", id);
      const r = await setPurpose(uid, id, "maintenance_before");
      expectRefusal(`[٢] حالة ${label}`, r, {code: "failed-precondition", message: "SESSION_STATUS_UNKNOWN", reasonCode: "SESSION_STATUS_UNKNOWN", logReason: "SESSION_STATUS_UNKNOWN", logExtra: ` statusState=${state}`, ids: [id, uid]});
      deq(await data("scanSessions", id), before, `[٢] حالة ${label}: لا كتابة (لا تُقرأ pending من الغياب)`);
      ok(!(await exists("protocolPending", id)), `[٢] حالة ${label}: ولا protocolPending`);
    }
  }
  {
    // ٢-ز: pending منقضية تُكتب «منتهية» ثم يُرفض؛ expiresAt غائب/تالف رفض بلا كتابة
    await seedOwner("own-sp-g");
    await seedSession("sess-sp-g-exp", {ownerId: "own-sp-g", status: "pending", code: "NC-SPG001", expiresAt: PAST(), purpose: "normal", scanId: null, deviceModel: null});
    await db.collection("protocolPending").doc("sess-sp-g-exp").set({purposeSource: "default"});
    const r = await setPurpose("own-sp-g", "sess-sp-g-exp", "maintenance_before");
    expectRefusal("[٢] pending منقضية", r, {code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED", logExtra: " expiredRecorded=true", ids: ["sess-sp-g-exp", "own-sp-g"]});
    const s = await data("scanSessions", "sess-sp-g-exp");
    ok(s.status === "expired" && TS(s.expiredAt), "[٢] وكُتبت «منتهية» (status=expired وexpiredAt) في المعاملة نفسها — الرمي بعد إتمامها لا داخلها");
    eq(s.purpose, "normal", "[٢] والغرض لم يتغيّر");
    deq(await data("protocolPending", "sess-sp-g-exp"), {purposeSource: "default"}, "[٢] ولا المصدر");
    const again = await setPurpose("own-sp-g", "sess-sp-g-exp", "maintenance_before");
    expectRefusal("[٢] النداء الثاني بعد تسجيل «منتهية»", again, {code: "failed-precondition", message: "PURPOSE_SESSION_NOT_PENDING", reasonCode: "PURPOSE_SESSION_NOT_PENDING", logReason: "PURPOSE_SESSION_NOT_PENDING", logExtra: " status=expired"});
    let k = 0;
    for (const [label, expiresField] of [["غائب", {}], ["null", {expiresAt: null}], ["نصّ تالف", {expiresAt: "garbage"}]]) {
      const id = `sess-sp-g-inv-${k++}`;
      await seedSession(id, {ownerId: "own-sp-g", status: "pending", code: `NC-SPG10${k}`, ...expiresField});
      const before = await data("scanSessions", id);
      const x = await setPurpose("own-sp-g", id, "maintenance_before");
      expectRefusal(`[٢] expiresAt ${label}`, x, {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_EXPIRES_AT_INVALID", logReason: "SESSION_EXPIRES_AT_INVALID", ids: [id]});
      deq(await data("scanSessions", id), before, `[٢] expiresAt ${label}: بلا كتابة (لا «صالحة» ولا «منتهية»)`);
    }
  }
  {
    // ٢-ح: جلسة أُنشئت قبل النشر (بلا purpose ولا protocolPending) تقبل الاختيار
    // (ق31، 2026-10-22، القاعدة 23: بذرة المالك بلا الأجزاء؛ صار maintenance_* يحتاج الجزأين. المثبَّت هنا شكل الجلسة المُنشأة قبل النشر لا فحص الجزء)
    await seedOwner("own-sp-h", {protocolParts: {purposes: true, batteryBeforeAfter: true}});
    await seedSession("sess-sp-h-legacy", {ownerId: "own-sp-h", status: "pending", code: "NC-SPH001", expiresAt: FUTURE(), scanId: null, deviceModel: null});
    ok(!(await exists("protocolPending", "sess-sp-h-legacy")), "[٢] (قبل: لا protocolPending)");
    const r = await setPurpose("own-sp-h", "sess-sp-h-legacy", "maintenance_before");
    deq(r.ret, {sessionId: "sess-sp-h-legacy", purpose: "maintenance_before", purposeSource: "selected"}, "[٢] الجلسة المُنشأة قبل النشر تقبل الاختيار");
    eq((await data("scanSessions", "sess-sp-h-legacy")).purpose, "maintenance_before", "[٢] والغرض كُتب");
    deq(await data("protocolPending", "sess-sp-h-legacy"), SEL("BATTERY"), "[٢] وأُنشئ protocolPending بالدمج");
    ok(purposeLines(r.texts)[0].endsWith("purpose=maintenance_before previous=ABSENT defectType=BATTERY"), "[٢] والسجلّ يقول previous=ABSENT (الغياب حالة صريحة)");
  }
  {
    // ٢-ي: الذرّية — فشل كتابة المصدر يُسقط كتابة الغرض
    await seedOwner("own-sp-i", {protocolParts: {purposes: true, batteryBeforeAfter: true}}); // (ق31، القاعدة 23: maintenance_* في هذا المشهد تحتاج الجزأين؛ المثبَّت غير فحص الجزء)
    const id = (await create("own-sp-i")).ret.sessionId;
    const sBefore = await data("scanSessions", id);
    failPendingSet = 1;
    injectedPendingSet = 0;
    const r = await setPurpose("own-sp-i", id, "maintenance_before");
    failPendingSet = 0;
    eq(injectedPendingSet, 1, "[٢] حُقن فشل واحد في tx.set لمستند protocolPending");
    ok(r.threw !== null && r.threw.code === 7, "[٢] النداء فشل (الخطأ غير المتوقَّع يعاد رميه كما هو؛ onCall يحوّله internal)");
    deq(await data("scanSessions", id), sBefore, "[٢] **كتابة الغرض سقطت مع كتابة المصدر**: الجلسة كما كانت (purpose لم يتغيّر)");
    deq(await pendingWithoutDraw(id), {purposeSource: "default"}, "[٢] والمصدر لم يتغيّر");
    const lines = purposeLines(r.texts);
    deq(lines, [`[setSessionPurpose] unexpected failure session=${sid(id)} caller=${sid("own-sp-i")} [Error] code=7`], "[٢] سطر الفشل الوحيد: الصنف والرمز وحدهما (بلا نصّ الخطأ)");
    ok(!r.texts.join("\n").includes("injected protocolPending") && !r.texts.join("\n").includes(id), "[٢] لا نصّ خطأ ولا معرّف خامّ في السجلّ (القاعدة 36)");
    const ok2 = await setPurpose("own-sp-i", id, "maintenance_before");
    ok(ok2.threw === null && (await data("scanSessions", id)).purpose === "maintenance_before", "[٢] ونداء لاحق بلا حقن ينجح (لا حالة عالقة)");
  }

  // ═══ ٣ — analyzeDevice: scanProtocol في الدفعة الذرّية ═══
  const spOf = async (scanId) => {
    const s = await data("scanProtocol", scanId);
    // S-P6-07 (2026-10-21): scanProtocol صار اثني عشر حقلاً؛ الأربعة الجديدة (repeat · repeatOf · repeatClassification · creditExemption) تُفصل هنا وتُثبَّت في repeatScan.e2e.test.js بكل حالاتها،
    // ويبقى هذا الملفّ على غرض الفحص ومصدره (rest) — القاعدة 23: استُبدل تثبيت «الثمانية».
    // S-P6-12 (2026-10-21): والخامس consent (الموافقة) يُفصل أيضاً ويُثبَّت في scanConsent.e2e.test.js بكل حالاته؛ هنا يُثبَّت غيابه المعلَن (لا نداء تسجيل في هذه المشاهد: تطبيق قديم ⟵ not_collected).
    const {createdAt, repeat, repeatOf, repeatClassification, creditExemption, consent, ...rest} = s;
    return {rest, createdAt, repeat, repeatOf, repeatClassification, creditExemption, consent, keys: Object.keys(s).sort()};
  };
  const SP_KEYS = ["consent", "createdAt", "creditExemption", "defectType", "linkMethod", "linkModelCheck", "linkState", "linkedScanId", "pair", "protocolVersion", "purposeSource", "repeat", "repeatClassification", "repeatOf", "scanPurpose", "settingsVersion"];
  const checkNoLeak = async (label, scanId, ret) => {
    const report = await data("reports", scanId);
    const raw = await data("reportRaw", scanId);
    for (const f of ["scanPurpose", "purposeSource", "linkedScanId", "linkState", "linkMethod", "protocolVersion", "settingsVersion", "scanProtocol", "repeat", "repeatOf", "repeatClassification", "creditExemption", "defectType", "pair", "linkModelCheck"]) {
      ok(!(f in report) && !(f in raw), `${label}: ${f} ليس في مستند التقرير ولا الخامّ`);
    }
    ok(!JSON.stringify(ret).includes("scanPurpose") && !JSON.stringify(ret).includes("purposeSource"), `${label}: ولا في ردّ التحليل`);
  };
  {
    // ٣-أ: المسار الكامل بالدوالّ الحقيقية: إنشاء ⟵ اختيار ⟵ انضمام ⟵ تحليل
    await seedOwner("own-sp-j1", {protocolParts: {purposes: true, batteryBeforeAfter: true}}); // (ق31، القاعدة 23: maintenance_* في هذا المشهد تحتاج الجزأين؛ المثبَّت غير فحص الجزء)
    const created = await create("own-sp-j1");
    const id = created.ret.sessionId;
    const joined = await join(created.ret.code, "anon-sp-j1");
    eq(joined.ret && joined.ret.sessionId, id, "[٣] الزبون المجهول انضمّ بالرمز");
    modelCalls = 0;
    batchSets = [];
    const r = await analyze("scan-sp-j1", id, "anon-sp-j1", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح");
    eq(modelCalls, 1, "[٣] نداء نموذج واحد (كعب محلّي)");
    const sp = await spOf("scan-sp-j1");
    deq(sp.keys, SP_KEYS, "[٣] مستند scanProtocol: ستّة عشر مفتاحاً بالضبط (الثمانية + repeat · repeatOf · repeatClassification · creditExemption من S-P6-07 + consent من S-P6-12 + defectType · pair من أمر الصيانة 2026-10-22 + linkModelCheck من ق36 أ — استُبدل اختبار الخمسة عشر: القاعدة 23)");
    deq([sp.repeat.state, sp.repeat.reason, sp.repeatOf, sp.repeatClassification, sp.creditExemption], ["NOT_ELIGIBLE", "SETTINGS_ABSENT", null, null, null], "[٣] سجلّ repeat حاضر بحالة صريحة (لا إعدادات ⟵ SETTINGS_ABSENT) والباقي null «لا ينطبق»");
    deq(sp.rest, {scanPurpose: "normal", purposeSource: "default", ...SP_STATIC}, "[٣] الافتراضي: normal/default (جزء الأغراض مفعَّل، لم يختر المالك)");
    deq(sp.consent, {state: "not_collected", textVersion: null, locale: null, acceptedAt: null}, "[٣] وconsent: not_collected بالمفاتيح الأربعة (لا نداء تسجيل موافقة في هذا المشهد: تطبيق قديم، والغياب حالة صريحة)");
    ok(TS(sp.createdAt) && Math.abs(sp.createdAt.toMillis() - Date.now()) < 120000, "[٣] createdAt وقت الخادم");
    ok(await exists("reports", "scan-sp-j1") && await exists("reportRaw", "scan-sp-j1"), "[٣] والتقرير والخامّ محفوظان معاً");
    const analyzeBatches = batchSets.filter((b) => b.includes("reports/scan-sp-j1"));
    deq(analyzeBatches, [["reports/scan-sp-j1", "reportRaw/scan-sp-j1", "scanProtocol/scan-sp-j1"]], "[٣] **الدفعة الذرّية نفسها**: التقرير والخامّ وscanProtocol في التزام واحد");
    ok(!r.texts.some((t) => t.includes("scanProtocol notes=")), "[٣] ولا سطر ملاحظات (الحالة عادية)");
    await checkNoLeak("[٣]", "scan-sp-j1", r.ret);
    eq((await data("scanSessions", id)).status, "completed", "[٣] الجلسة completed كما كانت");
    // الإعادة من المخزَّن لا تكتب ثانيةً
    const spBefore = (await data("scanProtocol", "scan-sp-j1")).createdAt.toMillis();
    const creditBefore = await credit("own-sp-j1");
    batchSets = [];
    const again = await analyze("scan-sp-j1", id, "anon-sp-j1", "anonymous");
    ok(again.threw === null, "[٣] إعادة المحاولة المشروعة للجلسة completed: تُقدَّم من المخزَّن");
    eq(modelCalls, 1, "[٣] بلا نداء نموذج ثانٍ");
    eq(await credit("own-sp-j1"), creditBefore, "[٣] وبلا خصم");
    eq((await data("scanProtocol", "scan-sp-j1")).createdAt.toMillis(), spBefore, "[٣] **scanProtocol لم يُكتب ثانيةً** (createdAt كما هو)");
    eq(batchSets.filter((b) => b.some((p) => p.startsWith("scanProtocol/"))).length, 0, "[٣] ولا دفعة بمستند scanProtocol في الإعادة");
  }
  {
    // ٣-ب: اختيار المالك ثم التحليل ⟵ maintenance_after/selected
    await seedOwner("own-sp-j2", {protocolParts: {purposes: true, batteryBeforeAfter: true}}); // (ق31، القاعدة 23: maintenance_* في هذا المشهد تحتاج الجزأين؛ المثبَّت غير فحص الجزء)
    const created = await create("own-sp-j2");
    const id = created.ret.sessionId;
    const sel = await setPurpose("own-sp-j2", id, "maintenance_after");
    ok(sel.threw === null, "[٣] المالك اختار maintenance_after");
    await join(created.ret.code, "anon-sp-j2");
    const r = await analyze("scan-sp-j2", id, "anon-sp-j2", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح");
    deq((await spOf("scan-sp-j2")).rest, {scanPurpose: "maintenance_after", purposeSource: "selected", ...SP_STATIC, defectType: "BATTERY"}, "[٣] scanProtocol: maintenance_after/selected ونوع العطل BATTERY من protocolPending (والزوج null: يُفتح على «قبل» وحده)");
    // اختيار «عادي» صراحةً ⟵ normal/selected (يتميّز من الافتراضي)
    await seedOwner("own-sp-j2b", {protocolParts: {purposes: true, batteryBeforeAfter: true}}); // (ق31، القاعدة 23: maintenance_* في هذا المشهد تحتاج الجزأين؛ المثبَّت غير فحص الجزء)
    const c2 = await create("own-sp-j2b");
    await setPurpose("own-sp-j2b", c2.ret.sessionId, "normal");
    await join(c2.ret.code, "anon-sp-j2b");
    await analyze("scan-sp-j2b", c2.ret.sessionId, "anon-sp-j2b", "anonymous");
    deq((await spOf("scan-sp-j2b")).rest, {scanPurpose: "normal", purposeSource: "selected", ...SP_STATIC}, "[٣] «عادي» المختار صراحةً: normal/selected — ليس default");
  }
  {
    // ٣-ج: محلّ بلا جزء الأغراض ⟵ normal/feature_disabled
    await seedOwner("own-sp-j3");
    const created = await create("own-sp-j3");
    await join(created.ret.code, "anon-sp-j3");
    const r = await analyze("scan-sp-j3", created.ret.sessionId, "anon-sp-j3", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح");
    deq((await spOf("scan-sp-j3")).rest, {scanPurpose: "normal", purposeSource: "feature_disabled", ...SP_STATIC}, "[٣] محلّ بلا الجزء: normal/feature_disabled (يتميّز من «عادي» الافتراضي)");
  }
  {
    // ٣-د: جلسة أُنشئت قبل النشر (بلا purpose ولا protocolPending) ⟵ UNDECLARED، لا «عادي» صامتاً
    await seedOwner("own-sp-j4");
    await seedSession("sess-sp-j4", {ownerId: "own-sp-j4", status: "scanning", code: "NC-SPJ400", expiresAt: FUTURE(), joinedBy: "joiner-sp-j4", scanId: null, deviceModel: null});
    const r = await analyze("scan-sp-j4", "sess-sp-j4", "joiner-sp-j4", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح (الغياب لا يُفشل الفحص)");
    const sp = await spOf("scan-sp-j4");
    deq(sp.rest, {scanPurpose: "UNDECLARED", purposeSource: null, ...SP_STATIC}, "[٣] جلسة بلا غرض: UNDECLARED ومصدر null (لا «normal» صامتاً، ولا مصدر مختلَق)");
    const noteLines = r.texts.filter((t) => t.includes("scanProtocol notes="));
    deq(noteLines, ["[analyzeDevice] scanProtocol notes=PURPOSE_ABSENT purpose=UNDECLARED"], "[٣] وسطر الملاحظة المسمّاة الوحيد");
    note("analyzeDevice — جلسة بلا غرض", noteLines);
    await checkNoLeak("[٣]", "scan-sp-j4", r.ret);
  }
  {
    // ٣-هـ: غرض مجهول ⟵ UNDECLARED بملاحظة؛ والنصّ المجهول لا يُطبع
    await seedOwner("own-sp-j5");
    await seedSession("sess-sp-j5", {ownerId: "own-sp-j5", status: "scanning", code: "NC-SPJ500", expiresAt: FUTURE(), joinedBy: "joiner-sp-j5", purpose: "zzUnknownPurposeValue", scanId: null, deviceModel: null});
    await db.collection("protocolPending").doc("sess-sp-j5").set({purposeSource: "selected"});
    const r = await analyze("scan-sp-j5", "sess-sp-j5", "joiner-sp-j5", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح");
    deq((await spOf("scan-sp-j5")).rest, {scanPurpose: "UNDECLARED", purposeSource: null, ...SP_STATIC}, "[٣] غرض خارج المفردات: UNDECLARED (لا يُلحَق بأقرب قيمة ولا يُنسب له المصدر)");
    deq(r.texts.filter((t) => t.includes("scanProtocol notes=")), ["[analyzeDevice] scanProtocol notes=PURPOSE_NOT_RECOGNIZED purpose=UNDECLARED"], "[٣] والملاحظة PURPOSE_NOT_RECOGNIZED");
    ok(!r.texts.join("\n").includes("zzUnknownPurposeValue"), "[٣] ولا قيمة الغرض الخام في أيّ سطر (تُسمّى الحالة لا القيمة)");
  }
  {
    // ٣-و: غرض معروف بلا مصدر ⟵ مصدر null بملاحظة
    await seedOwner("own-sp-j6");
    await seedSession("sess-sp-j6", {ownerId: "own-sp-j6", status: "scanning", code: "NC-SPJ600", expiresAt: FUTURE(), joinedBy: "joiner-sp-j6", purpose: "battery_before", scanId: null, deviceModel: null});
    const r = await analyze("scan-sp-j6", "sess-sp-j6", "joiner-sp-j6", "anonymous");
    ok(r.threw === null, "[٣] التحليل نجح");
    deq((await spOf("scan-sp-j6")).rest, {scanPurpose: "battery_before", purposeSource: null, ...SP_STATIC}, "[٣] الغرض معروف والمصدر غائب: الغرض يبقى والمصدر null (لا مصدر مختلَق)");
    deq(r.texts.filter((t) => t.includes("scanProtocol notes=")), ["[analyzeDevice] scanProtocol notes=PURPOSE_SOURCE_ABSENT purpose=battery_before"], "[٣] والملاحظة PURPOSE_SOURCE_ABSENT");
  }
  {
    // ٣-ز: فحص بلا جلسة ⟵ NO_SESSION
    await seedOwner("own-sp-j7", {plan: "single"});
    const r = await analyze("scan-sp-j7", null, "own-sp-j7", "password");
    ok(r.threw === null, "[٣] فحص المستخدم لجهازه (بلا جلسة) نجح");
    deq((await spOf("scan-sp-j7")).rest, {scanPurpose: "NO_SESSION", purposeSource: null, ...SP_STATIC}, "[٣] بلا جلسة: NO_SESSION ومصدر null (لا ينطبق)");
    ok(!r.texts.some((t) => t.includes("scanProtocol notes=")), "[٣] ولا ملاحظة (حالة عادية)");
    await checkNoLeak("[٣]", "scan-sp-j7", r.ret);
    const spBefore = (await data("scanProtocol", "scan-sp-j7")).createdAt.toMillis();
    const again = await analyze("scan-sp-j7", null, "own-sp-j7", "password");
    ok(again.threw === null, "[٣] إعادة الطلب بالمعرّف نفسه");
    eq((await data("scanProtocol", "scan-sp-j7")).createdAt.toMillis(), spBefore, "[٣] والمخزَّن يُعاد: scanProtocol لا يُكتب ثانيةً");
  }
  {
    // ٣-ح: فشل الالتزام لا يترك شيئاً من الثلاثة، والفحصة تُعاد
    await seedOwner("own-sp-j8", {protocolParts: {purposes: true, batteryBeforeAfter: true}}); // (ق31، القاعدة 23: maintenance_* في هذا المشهد تحتاج الجزأين؛ المثبَّت غير فحص الجزء)
    const created = await create("own-sp-j8");
    await join(created.ret.code, "anon-sp-j8");
    const creditBefore = await credit("own-sp-j8");
    failNextCommit = true;
    injectedCommit = 0;
    batchSets = [];
    const r = await analyze("scan-sp-j8", created.ret.sessionId, "anon-sp-j8", "anonymous");
    failNextCommit = false;
    eq(injectedCommit, 1, "[٣] حُقن فشل في التزام الدفعة");
    ok(r.threw !== null, "[٣] التحليل فشل");
    deq(batchSets.filter((b) => b.includes("reports/scan-sp-j8")), [["reports/scan-sp-j8", "reportRaw/scan-sp-j8", "scanProtocol/scan-sp-j8"]], "[٣] والدفعة الفاشلة كانت تحمل المستندات الثلاثة (فلا تقرير بلا سجلّ بروتوكوله ولا العكس)");
    for (const col of ["reports", "reportRaw", "scanProtocol"]) ok(!(await exists(col, "scan-sp-j8")), `[٣] فشل الالتزام: لا ${col}/{scanId}`);
    eq(await credit("own-sp-j8"), creditBefore, "[٣] والفحصة المحجوزة أُعيدت (لا خصم بلا تقرير)");
    eq((await data("scanSessions", created.ret.sessionId)).status, "scanning", "[٣] والجلسة تبقى scanning (لا اكتمال بلا تقرير)");
    const ok3 = await analyze("scan-sp-j8", created.ret.sessionId, "anon-sp-j8", "anonymous");
    ok(ok3.threw === null, "[٣] والإعادة بعد الفشل تنجح");
    deq((await spOf("scan-sp-j8")).rest, {scanPurpose: "normal", purposeSource: "default", ...SP_STATIC}, "[٣] وتكتب الثلاثة معاً");
  }

  // ═══ ٤ — لا حذف، ولا معرّف خامّ ═══
  {
    ok((await count("scanSessions")) > 10 && (await count("scanProtocol")) >= 8, "[٤] المستندات باقية (الجلسات وscanProtocol): لا حذف في أيّ مسار");
    for (const t of OBSERVED) console.log(t);
  }

  console.log(`scanProtocolPurpose.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});

/** حالة «الحقل غائب» لمستند بذرة: لا مفتاح status (الغياب حالة لا قيمة). */
function ABSENT_FIELD() { return {}; }
