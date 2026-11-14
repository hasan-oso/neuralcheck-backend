// E2E test: التقييم المزدوج وهويّة الفنّي — القرعة في createScanSession ثم التسلسل كاملاً مع استمارة الفنّي وإدارة الفنّيين، بالدوالّ الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-10، 2026-10-21 +03).
// **لا استبدال أيّ طبقة**: لا نداء مزوّد نموذج (الدوالّ لا تكلّم مزوّداً). **حقن الفشل** (لا يستبدل الطبقة: يمرّر الاستدعاء الحقيقي): غلاف على db.batch يسجّل مسارات set ويُفشل التزاماً واحداً (مشهد الذرّية). والعشوائية:
// Math.random تُثبَّت حول نداء createScanSession وحده على قيمة معلومة **للقرعة وحدها** (يُعرف طالبها من مكدّس الاستدعاء: protocolSelection؛ وتوليد كود الجلسة يبقى حقيقياً) وتُعاد فوراً (مشاهد حدّ القرعة). **لا أسماء ولا بيانات فنّيين حقيقية**: أسماء وهمية موسومة (FAKE-TECH-*) تُكتب في المحاكي بنداء المشرف.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠-ب-٦ (:1300-1309) وdocs/PROTOCOL_CONTRACT.md §٢ A7 (يحمل نصّها المقتبس وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ createScanSession تكتب doubleEvalDraw في protocolPending في **الدفعة الذرّية نفسها** مع الجلسة: الأسباب بترتيبها (إعدادات غائبة · جزء غير مفعَّل · نسبة غائبة/خارج المدى) والقرعة draw < rate بحدّها
//      وبقيم معلومة، ونسخة الإعدادات الحيّة، والجزء بـ«=== true» وحدها؛ وردّ الإنشاء لا يتغيّر ولا يحمل السحب؛ وsetSessionPurpose تحفظه (دمج)؛ وفشل الالتزام لا يترك جلسة ولا سحباً.
//   ٢ التسلسل كاملاً على الخادم: مشرف يكتب الإعدادات ويفعّل الجزء ويضيف فنّيَين ⟵ إنشاء الجلسة (سحب مختار) ⟵ getTechnicianFormConfig يعلن slots[1].drawn ⟵ الفتحة ١ بفنّي ⟵ الفتحة ٢ بالفنّي نفسه
//      FORM_SLOT_SAME_TECHNICIAN وبفنّي آخر تُقبل؛ وجلسة غير مسحوبة (نسبة 0 · جزء مُطفأ · إعدادات غائبة · قبل النشر) ⟵ الفتحة ٢ FORM_SLOT_INVALID بسبب مسمّى؛ والموقوف FORM_TECHNICIAN_UNKNOWN.
//   ٣ «ولا يُعيد الخادم استمارةً لأيّ عميل»: ردّ الإرسال وردّ الإعداد بلا أيّ محتوى استمارة، ولا مستند استمارة في أيّ ردّ؛ والفنّي الثاني لا يصله شيء من الأوّل.
//   ٤ الجلسة الابنة للتكرار (startRepeatScan) لا قرعة لها (القرعة «عند إنشاء الجلسة» لا الفحص).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/doubleEval.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {startRepeatScan} = require("../src/sessions/repeatScanCalls");
const {getTechnicianFormConfig, submitTechnicianForm} = require("../src/evaluations/technicianForm");
const {setProtocolSettings} = require("../src/admin/protocolSettingsAdmin");
const {setShopProtocolParts, manageTechnician} = require("../src/admin/shopProtocolAdmin");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// حقن الفشل: غلاف على db.batch: يسجّل مسار كل set، ويُفشل التزاماً واحداً حين يُفعَّل.
let failNextCommit = false;
let injectedCommit = 0;
let batchSets = [];
let batchKeys = []; // لكل دفعة: {مسار المستند: مفاتيح ما كُتب فيه} — يثبت أن السحب يُكتب **في الدفعة** لا بعدها
const realBatch = db.batch.bind(db);
db.batch = () => {
  const b = realBatch();
  const set = b.set.bind(b);
  const commit = b.commit.bind(b);
  const mine = [];
  const keys = {};
  b.set = (ref, data, ...rest) => { mine.push(ref.path); keys[ref.path] = Object.keys(data || {}).sort(); return set(ref, data, ...rest); };
  b.commit = async () => {
    batchSets.push(mine.slice());
    batchKeys.push({...keys});
    if (failNextCommit && mine.some((p) => p.startsWith("scanSessions/"))) {
      failNextCommit = false;
      injectedCommit++;
      throw Object.assign(new Error("injected batch commit failure"), {code: 7});
    }
    return commit();
  };
  return b;
};

const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const ADMIN = {uid: "admin-de-1", token: {email: ADMIN_EMAILS[0], email_verified: true}};

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn, {random = null} = {}) {
  const cap = capture();
  const realRandom = Math.random;
  // القيمة المعلومة تُعاد لمن يطلبها من protocolSelection (القرعة) وحده؛ ويبقى توليد كود الجلسة حقيقياً (قيمة ثابتة تُصادم أكواد جلسات معلَّقة فتفشل الجلسة بـ«تعذّر توليد كود فريد»).
  if (random !== null) Math.random = () => ((new Error().stack || "").includes("protocolSelection") ? random : realRandom());
  let r;
  try {
    r = await settle(fn());
  } finally {
    Math.random = realRandom;
    cap.restore();
  }
  return {ret: r.ok ? r.value : null, threw: r.ok ? null : r.error, lines: cap.lines, texts: cap.texts()};
}
const seedShop = (uid, extra = {}) => {
  const d = {scansRemaining: 500, scansTotal: 500, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), evaluationEnabled: true, ...extra};
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return db.collection("users").doc(uid).set(d);
};
const adm = (fn, d) => call(() => fn.run({data: d, auth: ADMIN, rawRequest: {headers: {}}}));
const create = (uid, opts) => call(() => createScanSession.run({data: {}, auth: {uid, token: tokenOf("google.com")}, rawRequest: {headers: {}}}), opts);
const join = (code, uid) => call(() => joinScanSession.run({data: {code}, auth: {uid, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
const config = (uid, sessionId) => call(() => getTechnicianFormConfig.run({data: {sessionId}, auth: {uid, token: {}}, rawRequest: {headers: {}}}));
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };

const DRAW_KEYS = ["decidedAt", "draw", "rate", "reason", "selected", "settingsVersion"];
const noDraw = (reason, settingsVersion) => ({selected: false, reason, draw: null, rate: null, settingsVersion});
const strip = (d) => { const {decidedAt, ...rest} = d; ok(TS(decidedAt) && Math.abs(decidedAt.toMillis() - Date.now()) < 120000, "decidedAt وقت الخادم"); return rest; };

(async () => {
  // ═══ ١ — القرعة في createScanSession ═══
  // ١-أ: إعدادات غائبة: لا يُفترض 10% (P:893)
  const SHOP0 = "shop-de-0";
  await seedShop(SHOP0, {protocolParts: {doubleEval: true}});
  {
    batchSets = [];
    batchKeys = [];
    const r = await create(SHOP0);
    ok(r.threw === null, `[١] الإنشاء نجح (${r.threw && r.threw.message})`);
    const id = r.ret.sessionId;
    const pending = await data("protocolPending", id);
    deq(Object.keys(pending).sort(), ["doubleEvalDraw", "purposeSource"], "[١] protocolPending: المصدر والسحب وحدهما");
    deq(Object.keys(pending.doubleEvalDraw).sort(), DRAW_KEYS, "[١] doubleEvalDraw: ستّة مفاتيح (E9 الخمسة + reason)");
    deq(strip(pending.doubleEvalDraw), noDraw("SETTINGS_ABSENT", "SETTINGS_ABSENT"), "[١] لا إعدادات ⟵ selected false بسبب SETTINGS_ABSENT، ولا قرعة (draw وrate null: لا صفراً يشبه سحباً)، والنسخة SETTINGS_ABSENT — حتى مع جزء doubleEval مفعَّل");
    deq(Object.keys(r.ret).sort(), ["code", "expiresInMinutes", "protocolParts", "sessionId"], "[١] ردّ الإنشاء كما هو: أربعة مفاتيح (السحب لا يصل العميل بالإنشاء)");
    ok(!JSON.stringify(r.ret).includes("doubleEvalDraw") && !JSON.stringify(r.ret).includes("draw"), "[١] ولا أثر للسحب في الردّ");
    deq(batchSets.filter((b) => b.some((p) => p.startsWith("scanSessions/"))), [[`scanSessions/${id}`, `protocolPending/${id}`]], "[١] الجلسة وprotocolPending (بالسحب) في **دفعة واحدة**");
    const sessionBatch = batchKeys.filter((b) => Object.keys(b).some((p) => p.startsWith("scanSessions/")));
    deq(sessionBatch.map((b) => b[`protocolPending/${id}`]), [["doubleEvalDraw", "purposeSource"]], "[١] والسحب **مكتوب في الدفعة نفسها**: مستند protocolPending في الدفعة يحمل المفتاحين purposeSource وdoubleEvalDraw معاً (لا كتابة لاحقة منفصلة)");
    eq(named(r.texts, "createScanSession").length, 0, "[١] (تحكّم) لا سطر مسمّى جديد في الإنشاء بلا داعٍ");
    ok(!r.texts.join("\n").includes(id) || r.texts.some((t) => t === `4 - Session saved: ${sid(id)}`), "[١] ولا معرّف خامّ في السجلّ");
  }
  // ١-ب: إعدادات حاضرة (بنداء المشرف الحقيقي)
  {
    const w = await adm(setProtocolSettings, {settings: {doubleEvalRate: 1}});
    deq([w.ret.version, w.ret.fields], [1, ["doubleEvalRate"]], "[١] (إعداد) المشرف كتب doubleEvalRate = 1 (النسخة 1)");
    const r = await create(SHOP0);
    const d = (await data("protocolPending", r.ret.sessionId)).doubleEvalDraw;
    const s = strip(d);
    ok(s.selected === true && s.reason === null && s.rate === 1 && s.settingsVersion === 1 && typeof s.draw === "number" && s.draw >= 0 && s.draw < 1, `[١] نسبة 1 ⟵ selected true، وdraw في [0,1) مخزَّن خامّاً، وrate 1، والنسخة 1 (${JSON.stringify(s)})`);
    // حدّ القرعة بقيم معلومة
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 0.1}});
    for (const [value, want] of [[0.0999, true], [0.1, false], [0, true], [0.9999, false]]) {
      const q = await create(SHOP0, {random: value});
      const dd = strip((await data("protocolPending", q.ret.sessionId)).doubleEvalDraw);
      deq(dd, {selected: want, reason: null, draw: value, rate: 0.1, settingsVersion: 2}, `[١] draw=${value} مع rate=0.1 ⟵ selected ${want} (الاختيار draw < rate)، والسحب والنسبة والنسخة 2 مخزَّنة`);
    }
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 0}});
    const z = strip((await data("protocolPending", (await create(SHOP0, {random: 0})).ret.sessionId)).doubleEvalDraw);
    deq(z, {selected: false, reason: null, draw: 0, rate: 0, settingsVersion: 3}, "[١] نسبة 0 لا تختار أبداً ولو draw = 0، وتُخزَّن 0 لا null (القرعة جرت)");
    note("createScanSession — القرعة", [JSON.stringify(z)]);
  }
  // ١-ج: الأسباب الأخرى
  {
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 1}});
    const cur = (await data("protocolSettings", "current")).version;
    for (const [label, parts] of [["بلا protocolParts", undefined], ["doubleEval false", {doubleEval: false}], ["doubleEval نصّ «true»", {doubleEval: "true"}], ["جزء آخر وحده", {coldRepeat: true}]]) {
      const uid = `shop-de-part-${label.length}`;
      await seedShop(uid, {protocolParts: parts});
      const q = await create(uid);
      deq(strip((await data("protocolPending", q.ret.sessionId)).doubleEvalDraw), noDraw("PART_NOT_ENABLED", cur), `[١] ${label} ⟵ PART_NOT_ENABLED (=== true وحدها تفعّل) ولا قرعة`);
    }
    // نسبة غائبة (إعدادات حاضرة بلا doubleEvalRate): نسخة جديدة بلا الحقل لا تُكتب من الخادم (لا مسح)، فيُبذَر مستند بنسخة بلا الحقل يدوياً
    await db.collection("protocolSettings").doc("current").set({version: 50, repeatRate: 1});
    const q1 = await create(SHOP0);
    deq(strip((await data("protocolPending", q1.ret.sessionId)).doubleEvalDraw), noDraw("RATE_ABSENT", 50), "[١] إعدادات حاضرة بلا doubleEvalRate ⟵ RATE_ABSENT (لا تُعوَّض بـrepeatRate)");
    for (const bad of [2, -1, "0.1"]) {
      await db.collection("protocolSettings").doc("current").set({version: 51, doubleEvalRate: bad});
      const q = await create(SHOP0);
      deq(strip((await data("protocolPending", q.ret.sessionId)).doubleEvalDraw), noDraw("RATE_INVALID", 51), `[١] doubleEvalRate ${JSON.stringify(bad)} ⟵ RATE_INVALID`);
    }
    // مستند إعدادات بلا version
    await db.collection("protocolSettings").doc("current").set({doubleEvalRate: 1});
    const q2 = await create(SHOP0);
    deq(strip((await data("protocolPending", q2.ret.sessionId)).doubleEvalDraw), noDraw("SETTINGS_ABSENT", "SETTINGS_ABSENT"), "[١] مستند إعدادات بلا version ⟵ يُقرأ غائباً (SETTINGS_ABSENT)");
    // أعد الإعدادات بنسخة سليمة بنسبة 1 لما يلي
    await db.collection("protocolSettings").doc("current").set({version: 60, doubleEvalRate: 1});
  }
  // ١-د: setSessionPurpose يحفظ السحب (دمج)، والذرّية
  {
    const r = await create(SHOP0);
    const id = r.ret.sessionId;
    const before = (await data("protocolPending", id)).doubleEvalDraw;
    // (ق31، أقرّه حسن 2026-10-22؛ القاعدة 23) كان المشهد يختار maintenance_before لمحلّ بجزء doubleEval وحده؛ صار الخادم يرفضه لمحلّ بلا الجزأين، والمثبَّت هنا دمج السحب لا الغرض، فيُختار normal (يبقى مقبولاً كما كان)
    const sp = await call(() => setSessionPurpose.run({data: {sessionId: id, purpose: "normal"}, auth: {uid: SHOP0, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
    ok(sp.threw === null, "[١] setSessionPurpose نجح");
    const after = await data("protocolPending", id);
    ok(after.doubleEvalDraw && typeof after.doubleEvalDraw === "object", "[١] السحب باقٍ بعد setSessionPurpose (الكتابة دمج لا استبدال)");
    deq([after.purposeSource, after.doubleEvalDraw.selected, after.doubleEvalDraw.draw, after.doubleEvalDraw.decidedAt.toMillis() === before.decidedAt.toMillis()], ["selected", true, before.draw, true], "[١] setSessionPurpose يدمج المصدر ولا يمسّ السحب (selected وdraw وdecidedAt كما كانت)");
    // الذرّية: فشل الالتزام لا يترك جلسة ولا سحباً
    const sessionsBefore = await count("scanSessions");
    const pendingBefore = await count("protocolPending");
    failNextCommit = true;
    const bad = await create(SHOP0);
    ok(bad.threw !== null && injectedCommit === 1, "[١] فشل الالتزام المحقون: الإنشاء يفشل");
    eq(await count("scanSessions"), sessionsBefore, "[١] ولا جلسة");
    eq(await count("protocolPending"), pendingBefore, "[١] ولا protocolPending (ولا سحب يتيم)");
  }

  // ═══ ٢ — التسلسل كاملاً ═══
  const SHOP = "shop-de-chain";
  const PHONE = "phone-de-chain";
  const CHIPS = ["battery_dies_before_day_end", "battery_jumps_or_shuts_down", "battery_swollen", "hot_while_charging", "charging_slow", "slow_or_freezes_daily",
    "restarts_under_load", "heats_fast_in_use", "system_heat_warning", "game_stutter_after_minutes", "game_screen_lines_or_flicker", "games_freeze_or_close"];
  const form = (sessionId, technicianId, slot) => ({
    sessionId, formContractVersion: 2, slot, technicianId,
    grades: {battery: "good", performance: "excellent", thermal: "good", overall: "good"},
    functional: {screen_touch: "works", camera: "works", audio: "works", buttons: "works", charging: "works", network: "works"},
    defects: {replaced_screen: "works", water_damage: "works", prior_repair: "works"},
    symptoms: ["none_noticed"], symptomOrderShown: [...CHIPS], known_fault_before_scan: false,
    batteryHealth: {kind: "percent", percent: 92, stateKey: null}, gameTried: true, observedNote: null,
    openedAt: 1000, firstTapAt: 2000, perAnswerAt: [2000, 5000], submittedAt: 20000,
  });
  const submit = (uid, d) => call(() => submitTechnicianForm.run({data: d, auth: {uid, token: {}}, rawRequest: {headers: {}}}));
  const refusalOf = (r) => r.threw && r.threw.details && r.threw.details.reasonCode;
  {
    await seedShop(SHOP);
    const pa = await adm(setShopProtocolParts, {ownerId: SHOP, parts: {doubleEval: true}});
    ok(pa.threw === null && pa.ret.parts.doubleEval === true, "[٢] المشرف فعّل جزء التقييم المزدوج للمحلّ");
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 1}});
    const t1 = (await adm(manageTechnician, {ownerId: SHOP, action: "add", displayName: "FAKE-TECH-DE-1"})).ret.technicianId;
    const t2 = (await adm(manageTechnician, {ownerId: SHOP, action: "add", displayName: "FAKE-TECH-DE-2"})).ret.technicianId;
    const t3 = (await adm(manageTechnician, {ownerId: SHOP, action: "add", displayName: "FAKE-TECH-DE-3"})).ret.technicianId;
    // محلّ آخر وفنّيه
    await seedShop("shop-de-other");
    const tOther = (await adm(manageTechnician, {ownerId: "shop-de-other", action: "add", displayName: "FAKE-TECH-DE-OTHER"})).ret.technicianId;

    const created = await create(SHOP, {random: 0.05});
    const sessionId = created.ret.sessionId;
    deq(strip((await data("protocolPending", sessionId)).doubleEvalDraw), {selected: true, reason: null, draw: 0.05, rate: 1, settingsVersion: (await data("protocolSettings", "current")).version}, "[٢] الجلسة سُحبت للتقييم المزدوج بنسخة الإعدادات الحيّة");
    ok((await join(created.ret.code, PHONE)).threw === null, "[٢] الجهاز المفحوص انضمّ");
    const c1 = await config(SHOP, sessionId);
    ok(c1.threw === null, `[٢] getTechnicianFormConfig (${c1.threw && c1.threw.message})`);
    deq(c1.ret.slots, [{slot: 1, formState: "not_submitted"}, {slot: 2, formState: "not_submitted", drawn: true}], "[٢] الإعداد يعلن الفتحة ٢ مسحوبة (drawn: true) وحالتي الفتحتين");
    deq(c1.ret.technicians.map((t) => t.technicianId).sort(), [t1, t2, t3].sort(), "[٢] فنّيو المحلّ الفعّالون هم من أضافهم المشرف (ولا فنّي المحلّ الآخر)");
    ok(!c1.ret.technicians.some((t) => t.technicianId === tOther), "[٢] فنّي المحلّ الآخر لا يظهر");
    // الفتحة ١ بالفنّي 1
    const s1 = await submit(SHOP, form(sessionId, t1, 1));
    ok(s1.threw === null, `[٢] الفتحة ١ بالفنّي الأوّل (${s1.threw && s1.threw.message})`);
    deq(s1.ret, {sessionId, slot: 1, formState: "submitted"}, "[٢] الردّ {sessionId, slot, formState} وحدها («لا يعيد الخادم استمارةً لأيّ عميل»)");
    // الفتحة ٢ بالفنّي نفسه: مرفوضة
    const same = await submit(SHOP, form(sessionId, t1, 2));
    eq(refusalOf(same), "FORM_SLOT_SAME_TECHNICIAN", "[٢] الفتحة ٢ بالفنّي نفسه ⟵ FORM_SLOT_SAME_TECHNICIAN (رفض مسمّى)");
    ok(!(await exists("technicianForms", `${sessionId}_2`)), "[٢] ولا مستند للفتحة ٢");
    // بفنّي آخر: مقبولة
    const s2 = await submit(SHOP, form(sessionId, t2, 2));
    ok(s2.threw === null, `[٢] الفتحة ٢ بفنّي آخر والجلسة مسحوبة ⟵ تُقبل (${s2.threw && s2.threw.message})`);
    deq(s2.ret, {sessionId, slot: 2, formState: "submitted"}, "[٢] ردّ الفتحة ٢ بالشكل نفسه (لا محتوى استمارة ولا أيّ إشارة للفتحة ١)");
    const f1 = await data("technicianForms", `${sessionId}_1`);
    const f2 = await data("technicianForms", `${sessionId}_2`);
    deq([f1.technicianId, f2.technicianId, f1.slot, f2.slot], [t1, t2, 1, 2], "[٢] المستندان مربوطان بمعرّفَي الفنّيَين (لا بالاسم)، كلٌّ بفتحته");
    ok(!JSON.stringify([f1, f2]).includes("FAKE-TECH"), "[٢] ولا اسم فنّي في المستندين");
    // الإعداد بعد الإرسال: حالتا الفتحتين submitted ولا محتوى
    const c2 = await config(SHOP, sessionId);
    deq(c2.ret.slots, [{slot: 1, formState: "submitted"}, {slot: 2, formState: "submitted", drawn: true}], "[٢] الإعداد بعد الإرسال: الفتحتان submitted");
    const allKeys = new Set();
    const walk = (v) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { allKeys.add(k); walk(x); } };
    walk(c2.ret); walk(s1.ret); walk(s2.ret);
    for (const forbidden of ["grades", "functional", "defects", "symptoms", "observedNote", "batteryHealth", "gameTried", "blindness", "submittedAt", "overall", "battery", "thermal", "performance"]) {
      ok(!allKeys.has(forbidden), `[٣] لا مفتاح «${forbidden}» في أيّ ردّ (الفنّي الثاني لا يصله محتوى الأوّل: «لا يعيد الخادم استمارةً لأيّ عميل»)`);
    }
    // الموقوف
    await adm(manageTechnician, {ownerId: SHOP, action: "set_active", technicianId: t3, active: false});
    const sessionB = (await create(SHOP, {random: 0})).ret;
    await join(sessionB.code, PHONE);
    const stopped = await submit(SHOP, form(sessionB.sessionId, t3, 1));
    eq(refusalOf(stopped), "FORM_TECHNICIAN_UNKNOWN", "[٢] فنّي موقوف ⟵ FORM_TECHNICIAN_UNKNOWN");
    ok(named(stopped.texts, "submitTechnicianForm").some((t) => t.includes("technicianState=INACTIVE")), "[٢] والسبب INACTIVE في السجلّ");
    const foreign = await submit(SHOP, form(sessionB.sessionId, tOther, 1));
    eq(refusalOf(foreign), "FORM_TECHNICIAN_UNKNOWN", "[٢] فنّي محلّ آخر ⟵ FORM_TECHNICIAN_UNKNOWN");
    ok(named(foreign.texts, "submitTechnicianForm").some((t) => t.includes("technicianState=OWNER_MISMATCH")), "[٢] والسبب OWNER_MISMATCH");
    note("submitTechnicianForm — فنّي موقوف", named(stopped.texts, "submitTechnicianForm"));
    // الفتحة ٢ أوّلاً ثم ١ بالفنّي نفسه (تناظر) على الجلسة B (مسحوبة)
    ok((await submit(SHOP, form(sessionB.sessionId, t2, 2))).threw === null, "[٢] الفتحة ٢ أوّلاً تُقبل (جلسة مسحوبة)");
    eq(refusalOf(await submit(SHOP, form(sessionB.sessionId, t2, 1))), "FORM_SLOT_SAME_TECHNICIAN", "[٢] ثم الفتحة ١ بالفنّي نفسه ⟵ FORM_SLOT_SAME_TECHNICIAN (متناظر)");
    ok((await submit(SHOP, form(sessionB.sessionId, t1, 1))).threw === null, "[٢] والفتحة ١ بفنّي آخر تُقبل");
  }
  // ٢-ب: جلسات لا تُسحب ⟵ الفتحة ٢ FORM_SLOT_INVALID بسبب مسمّى (كل حالة)
  {
    const t1 = (await adm(manageTechnician, {ownerId: SHOP, action: "add", displayName: "FAKE-TECH-DE-4"})).ret.technicianId;
    const slot2 = async (sessionId) => submit(SHOP, form(sessionId, t1, 2));
    const cases = [];
    // نسبة 0
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 0}});
    cases.push(["نسبة 0", (await create(SHOP, {random: 0})).ret, "DOUBLE_EVAL_NOT_SELECTED"]);
    // جزء مُطفأ
    await seedShop("shop-de-nopart");
    await adm(setProtocolSettings, {settings: {doubleEvalRate: 1}});
    const np = (await create("shop-de-nopart")).ret;
    cases.push(["الجزء غير مفعَّل", np, "DOUBLE_EVAL_NOT_SELECTED"]);
    for (const [label, created, cause] of cases) {
      const uid = label === "الجزء غير مفعَّل" ? "shop-de-nopart" : SHOP;
      await join(created.code, PHONE);
      if (uid !== SHOP) await db.collection("technicians").doc("tech-de-nopart").set({ownerId: uid, active: true, displayName: "FAKE-TECH-NOPART"});
      const tid = uid === SHOP ? t1 : "tech-de-nopart";
      const r = await submit(uid, form(created.sessionId, tid, 2));
      eq(refusalOf(r), "FORM_SLOT_INVALID", `[٢] ${label}: الفتحة ٢ ⟵ FORM_SLOT_INVALID`);
      ok(named(r.texts, "submitTechnicianForm").some((t) => t.includes(`cause=${cause}`)), `[٢] ${label}: والسبب ${cause} في السجلّ`);
      ok(!(await exists("technicianForms", `${created.sessionId}_2`)), `[٢] ${label}: ولا مستند`);
    }
    // جلسة قبل النشر (بلا doubleEvalDraw)
    await db.collection("scanSessions").doc("sess-de-legacy").set({ownerId: SHOP, status: "scanning", code: "NC-DELEG1", expiresAt: new Date(Date.now() + 30 * MIN), joinedBy: PHONE, scanId: null, deviceModel: null});
    const lr = await slot2("sess-de-legacy");
    eq(refusalOf(lr), "FORM_SLOT_INVALID", "[٢] جلسة قبل النشر بلا سحب: الفتحة ٢ ⟵ FORM_SLOT_INVALID");
    ok(named(lr.texts, "submitTechnicianForm").some((t) => t.includes("cause=DOUBLE_EVAL_DRAW_ABSENT")), "[٢] والسبب DOUBLE_EVAL_DRAW_ABSENT (الغياب لا يُقرأ اختياراً)");
    // الفتحة ١ تعمل في كل الحالات (التقييم المزدوج لا يمنع الأولى)
    ok((await submit(SHOP, form("sess-de-legacy", t1, 1))).threw === null, "[٢] والفتحة ١ تُقبل في كل حال");
  }

  // ═══ ٤ — الجلسة الابنة للتكرار: لا قرعة ═══
  {
    // جلسة أمّ مكتملة بسجلّ repeat مختار (بذر مباشر: مسار التحليل الكامل مغطّى في repeatScan.e2e.test.js)
    await db.collection("scanSessions").doc("sess-de-parent").set({ownerId: SHOP, joinedBy: PHONE, status: "completed", scanId: "scan-de-parent"});
    await db.collection("scanProtocol").doc("scan-de-parent").set({repeat: {state: "SELECTED", reason: null, firstScanStartTemp: {state: "PRESENT", valueC: 32.8}}});
    const r = await call(() => startRepeatScan.run({data: {sessionId: "sess-de-parent", scanId: "scan-de-parent"}, auth: {uid: PHONE, token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
    ok(r.threw === null, "[٤] بدء التكرار");
    const pending = await data("protocolPending", r.ret.sessionId);
    ok(!("doubleEvalDraw" in pending), "[٤] protocolPending للجلسة الابنة بلا doubleEvalDraw (القرعة عند إنشاء الجلسة لا الفحص؛ والاستمارة لا تُطلب في التكرار: P:655)");
  }

  // ═══ ٥ — لا حذف ═══
  {
    for (const f of ["src/protocol/doubleEval.js", "src/sessions/createScanSession.js"]) {
      const code = fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(code), `[٥] ${f}: لا حذف بأيّ وسيلة (القاعدة 42)`);
    }
  }

  console.log(`\n${OBSERVED.join("\n")}`);
  console.log(`\ndoubleEval.e2e.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
