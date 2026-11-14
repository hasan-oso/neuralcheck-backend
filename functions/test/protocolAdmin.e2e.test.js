// E2E test: الإعدادات والتفعيل والفنّيون — setProtocolSettings وgetProtocolSettings وsetShopProtocolParts وmanageTechnician وgetShopProtocolConfig الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-14، 2026-10-21 +03).
// **لا استبدال أيّ طبقة**: لا نداء مزوّد نموذج (الدوالّ لا تكلّم مزوّداً) ولا حقن فشل — الدوالّ والمعاملات والمحاكي كما هي (ومع المسار الكامل: createScanSession وjoinScanSession وgetTechnicianFormConfig وsubmitTechnicianForm الحقيقية).
// **لا أسماء ولا بيانات فنّيين حقيقية** («ولا تُدخل أيّ أسماء الآن»): الأسماء وهمية موسومة (FAKE-TECH-*) وتُكتب في المحاكي وحده بنداء المشرف في الاختبار.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:767-793) وdocs/PROTOCOL_CONTRACT.md §٢ A10 (إلحاق مؤرَّخ بكل شكل سلك).
//
// ما يثبته:
//   ١ بوّابة المشرف: بلا auth · غير مشرف · مشرف غير مؤكَّد البريد · بلا بريد ⟵ رفض بالنصّين القائمين، بلا أثر، لكل دالّة من الخمس.
//   ٢ getProtocolSettings قبل أيّ كتابة: SETTINGS_ABSENT بلا افتراضي؛ وبعدها: الحقول الحاضرة وحدها + الحدود + المعلّقان.
//   ٢-ب شكل `limits` الكامل بقيمه وأنواعها، واستدعاء getProtocolSettings ببيانات undefined/null/{}/غيرها (الدالّة لا تقرأ request.data) — سؤال وكيل الموقع ٥ (S-P6-12).
//   ٣ setProtocolSettings: أوّل كتابة (version 1 بلا history)، رفع version وحفظ السابقة في history بـcreate، الدمج، «لم يتغيّر» بلا نسخة، الرفوض بأسبابها (مجهول · معلّق · خارج المدى · لا مسح)،
//      returnReasons (الإيقاف بدل الحذف)، مستند بلا version، سباق كتابتين، history لا يُكتب فوقه، ولا قيمة حقل في السجلّ.
//   ٤ setShopProtocolParts: رقعة الأجزاء بالدمج، لا كتابة لمحلّ غير موجود ولا ينشئه، ورفض batteryPairs وغير المنطقي، وتصحيح المخزَّن النصّي.
//   ٥ manageTechnician وgetShopProtocolConfig: إضافة · تعديل · إيقاف · إعادة تفعيل بلا حذف، فنّيو محلّ آخر معزولون، الترتيب، حالة active غير المقروءة، ولا اسم في أيّ سطر سجلّ.
//   ٦ التكامل مع استمارة الفنّي (S-P6-08): فنّي المشرف يظهر في getTechnicianFormConfig ويُقبل في submitTechnicianForm، والموقوف يختفي ويُرفض FORM_TECHNICIAN_UNKNOWN، وsettingsVersion = نسخة الإعدادات الحيّة.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/protocolAdmin.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {setProtocolSettings, getProtocolSettings} = require("../src/admin/protocolSettingsAdmin");
const {setShopProtocolParts, manageTechnician, getShopProtocolConfig} = require("../src/admin/shopProtocolAdmin");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {getTechnicianFormConfig, submitTechnicianForm} = require("../src/evaluations/technicianForm");
const {readProtocolSettings, settingsVersionOf} = require("../src/protocol/protocolSettings");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const MIN = 60 * 1000;
const DAY = 24 * 3600 * 1000;
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const ADMIN_UID = "admin-pa-1";
const ADMIN = {uid: ADMIN_UID, token: {email: ADMIN_EMAILS[0], email_verified: true}};
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});

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
const run = (fn, d, auth = ADMIN) => call(() => fn.run({data: d, auth, rawRequest: {headers: {}}}));
const setS = (settings, auth) => run(setProtocolSettings, {settings}, auth);
const getS = (auth) => run(getProtocolSettings, {}, auth);
const setParts = (ownerId, parts, auth) => run(setShopProtocolParts, {ownerId, parts}, auth);
const tech = (d, auth) => run(manageTechnician, d, auth);
const cfg = (ownerId, auth) => run(getShopProtocolConfig, {ownerId}, auth);
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
const seedShop = (uid, extra = {}) => {
  const d = {scansRemaining: 50, scansTotal: 50, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), ...extra};
  for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  return db.collection("users").doc(uid).set(d);
};

function expectRefusal(label, r, {fn, code, message, reasonCode, field = null, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode, ...(field ? {field} : {})}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, fn).filter((t) => t.startsWith(`[${fn}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${fn}] refused reason=${logReason}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${logReason}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return lines[0];
}
const BAD = (reason, extra = {}) => ({code: "invalid-argument", message: reason, reasonCode: reason, ...extra});

(async () => {
  // ═══ ١ — بوّابة المشرف ═══
  {
    const before = {settings: await count("protocolSettings"), users: await count("users"), technicians: await count("technicians")};
    const calls = [
      ["setProtocolSettings", (auth) => setS({repeatRate: 0.5}, auth)],
      ["getProtocolSettings", (auth) => getS(auth)],
      ["setShopProtocolParts", (auth) => setParts("shop-gate", {purposes: true}, auth)],
      ["manageTechnician", (auth) => tech({ownerId: "shop-gate", action: "add", displayName: "FAKE-TECH-GATE"}, auth)],
      ["getShopProtocolConfig", (auth) => cfg("shop-gate", auth)],
    ];
    for (const [name, fn] of calls) {
      const none = await fn(null);
      deq([none.threw && none.threw.code, none.threw && none.threw.message], ["unauthenticated", "غير مصادق"], `[١] ${name}: بلا auth ⟵ غير مصادق`);
      for (const [label, auth] of [
        ["غير مشرف", {uid: "u-not-admin", token: {email: "someone@example.com", email_verified: true}}],
        ["مشرف غير مؤكَّد البريد", {uid: "u-unverified", token: {email: ADMIN_EMAILS[0], email_verified: false}}],
        ["مشرف بلا ادّعاء التحقّق", {uid: "u-noclaim", token: {email: ADMIN_EMAILS[0]}}],
        ["بلا بريد", {uid: "u-noemail", token: {email_verified: true}}],
        ["email_verified نصّ", {uid: "u-str", token: {email: ADMIN_EMAILS[0], email_verified: "true"}}],
      ]) {
        const r = await fn(auth);
        deq([r.threw && r.threw.code, r.threw && r.threw.message], ["permission-denied", "صلاحية Admin مطلوبة"], `[١] ${name}: ${label} ⟵ صلاحية Admin مطلوبة`);
      }
    }
    deq({settings: await count("protocolSettings"), users: await count("users"), technicians: await count("technicians")}, before, "[١] كل الرفوض أعلاه بلا أثر على أيّ مجموعة");
  }

  // ═══ ٢ — getProtocolSettings قبل أيّ كتابة ═══
  {
    const r = await getS();
    ok(r.threw === null, "[٢] المشرف يقرأ");
    deq(Object.keys(r.ret).sort(), ["anomaly", "limits", "notSpecified", "settings", "state", "updatedAtMs", "updatedBy", "version"], "[٢] ثمانية مفاتيح بالضبط");
    deq([r.ret.state, r.ret.anomaly, r.ret.version, r.ret.settings, r.ret.updatedAtMs, r.ret.updatedBy], ["SETTINGS_ABSENT", null, null, {}, null, null], "[٢] قبل أيّ كتابة: SETTINGS_ABSENT، والحقول {} (لا افتراضي: P:773)، والنسخة null");
    deq(r.ret.notSpecified, ["symptomChips", "targets"], "[٢] الحقلان المعلّقان معلنان");
    deq(r.ret.limits.rate, {min: 0, max: 1}, "[٢] حدّ النسب");
    deq(r.ret.limits.openBeforeValidityHours, {min: 1, max: 8760, integer: true}, "[٢] حدّ الساعات");
    deq(r.ret.limits.returnReasons, {maxEntries: 50, keyPattern: "^[a-z][a-z0-9_]{0,39}$", textMaxLength: 120}, "[٢] حدود قائمة المرتجع");
    eq(named(r.texts, "getProtocolSettings")[0], `[getProtocolSettings] served state=SETTINGS_ABSENT version=NONE caller=${sid(ADMIN_UID)}`, "[٢] سطر الخدمة");
    eq((await readProtocolSettings({db})).state, "ABSENT", "[٢] والقارئ يقرأه غائباً");
    eq(settingsVersionOf(await readProtocolSettings({db})), "SETTINGS_ABSENT", "[٢] وsettingsVersion = SETTINGS_ABSENT");
  }

  // ═══ ٢-ب — شكل `limits` واستدعاء getProtocolSettings ببيانات فارغة (S-P6-12، سؤال وكيل الموقع ٥؛ A10 إلحاق 2026-10-21) ═══
  {
    const ref = await getS();
    const L = ref.ret.limits;
    deq(Object.keys(L).sort(), ["blindnessAlertBelowPct", "minAppVersion", "openBeforeValidityHours", "rate", "returnReasons"], "[٢-ب] `limits` خمسة مفاتيح لا تسعة: rate (للنسبتين معاً) · openBeforeValidityHours · blindnessAlertBelowPct · returnReasons · minAppVersion — ولا مفتاح لـcollectionPhase ولا للمعلّقَين");
    deq(L, {
      rate: {min: 0, max: 1},
      openBeforeValidityHours: {min: 1, max: 8760, integer: true},
      blindnessAlertBelowPct: {min: 0, max: 100},
      returnReasons: {maxEntries: 50, keyPattern: "^[a-z][a-z0-9_]{0,39}$", textMaxLength: 120},
      minAppVersion: {maxLength: 32, pattern: "^\\d+(\\.\\d+){1,3}([-+][0-9A-Za-z.-]+)?$"},
    }, "[٢-ب] **الشكل الكامل بقيمه وأنواعها** كما تُردّ فعلاً (أعداد JSON وأنماط نصّية)");
    for (const [k, fields] of Object.entries({rate: ["min", "max"], openBeforeValidityHours: ["min", "max"], blindnessAlertBelowPct: ["min", "max"], returnReasons: ["maxEntries", "textMaxLength"], minAppVersion: ["maxLength"]})) {
      for (const f of fields) eq(typeof L[k][f], "number", `[٢-ب] limits.${k}.${f} عدد`);
    }
    eq(L.openBeforeValidityHours.integer, true, "[٢-ب] limits.openBeforeValidityHours.integer منطقي true");
    eq(typeof L.returnReasons.keyPattern + typeof L.minAppVersion.pattern, "stringstring", "[٢-ب] الأنماط نصوص (تُركَّب بـnew RegExp بلا أعلام)");
    ok(new RegExp(L.returnReasons.keyPattern).test("late_return") && !new RegExp(L.returnReasons.keyPattern).test("Late-Return"), "[٢-ب] keyPattern يُركَّب ويعمل");
    ok(new RegExp(L.minAppVersion.pattern).test("1.0.14") && new RegExp(L.minAppVersion.pattern).test("1.0.8-v6beta") && !new RegExp(L.minAppVersion.pattern).test("v1"), "[٢-ب] وpattern الإصدار يُركَّب ويعمل");
    deq(JSON.parse(JSON.stringify(L)), L, "[٢-ب] وكلّه JSON خالص يمرّ بلا فقد (لا دوالّ ولا undefined)");
    // الاستدعاء ببيانات فارغة: الدالّة لا تقرأ request.data فالنتيجة واحدة
    for (const [label, d] of [["undefined", undefined], ["null", null], ["{}", {}], ["نصّ", "x"], ["رقم", 5], ["مصفوفة", []], ["كائن بمفاتيح لا تعنيها", {settings: {repeatRate: 99}, ownerId: "zzz"}]]) {
      const r = await run(getProtocolSettings, d);
      ok(r.threw === null, `[٢-ب] بيانات ${label}: يُقبل الاستدعاء`);
      deq(r.ret, ref.ret, `[٢-ب] بيانات ${label}: الردّ نفسه كاملاً (الدالّة لا تقرأ المدخل)`);
    }
    for (const [label, auth, code, message] of [["بلا auth", null, "unauthenticated", "غير مصادق"], ["غير مشرف", {uid: "u-not-admin-lim", token: {email: "someone@example.com", email_verified: true}}, "permission-denied", "صلاحية Admin مطلوبة"]]) {
      for (const d of [undefined, null, {}]) {
        const r = await run(getProtocolSettings, d, auth);
        deq([r.threw && r.threw.code, r.threw && r.threw.message], [code, message], `[٢-ب] ${label} وبيانات ${JSON.stringify(d)}: الرفض بالنصّين القائمين (البيانات الفارغة لا تُسقط بوّابة المشرف)`);
      }
    }
  }

  // ═══ ٣ — setProtocolSettings ═══
  {
    // ٣-أ: أوّل كتابة
    const r1 = await setS({repeatRate: 0.25, collectionPhase: true});
    ok(r1.threw === null, `[٣] أوّل كتابة نجحت (${r1.threw && r1.threw.message})`);
    deq(r1.ret, {changed: true, version: 1, fields: ["repeatRate", "collectionPhase"]}, "[٣] الردّ: version 1 وأسماء الحقول (بترتيب العقد: repeatRate ثم collectionPhase)");
    const d1 = await data("protocolSettings", "current");
    deq(Object.keys(d1).sort(), ["collectionPhase", "repeatRate", "updatedAt", "updatedBy", "version"], "[٣] المستند: الحقول المكتوبة + version وupdatedAt وupdatedBy وحدها (لا افتراضي لغيرها)");
    deq([d1.version, d1.repeatRate, d1.collectionPhase, d1.updatedBy], [1, 0.25, true, sid(ADMIN_UID)], "[٣] القيم والمشرف مُهشَّراً");
    ok(TS(d1.updatedAt), "[٣] updatedAt وقت الخادم");
    eq((await db.collection("protocolSettings").doc("current").collection("history").get()).size, 0, "[٣] أوّل كتابة: لا history (لا سابقة)");
    eq(named(r1.texts, "setProtocolSettings")[0], `[setProtocolSettings] written version=1 fields=repeatRate,collectionPhase caller=${sid(ADMIN_UID)}`, "[٣] سطر الكتابة: أسماء الحقول وحدها بلا قيم");
    ok(!r1.texts.join("\n").includes("0.25") && !r1.texts.join("\n").includes(ADMIN_UID), "[٣] لا قيمة حقل ولا uid خامّ في السجلّ");
    note("setProtocolSettings — كتابة", named(r1.texts, "setProtocolSettings"));
    // قراءة المشرف بعد الكتابة
    const g = await getS();
    deq([g.ret.state, g.ret.version, g.ret.settings, g.ret.updatedBy], ["PRESENT", 1, {repeatRate: 0.25, collectionPhase: true}, sid(ADMIN_UID)], "[٣] getProtocolSettings بعد الكتابة: الحاضر وحده (الغائب غائب لا null)");
    ok(typeof g.ret.updatedAtMs === "number" && Math.abs(g.ret.updatedAtMs - Date.now()) < 120000, "[٣] updatedAtMs رقم قريب من الآن");
    const live = await readProtocolSettings({db});
    deq([live.state, live.version, settingsVersionOf(live)], ["PRESENT", 1, 1], "[٣] وقارئ الخادم (الذي يقرؤه الاختيار) يرى النسخة 1");

    // ٣-ب: رفع النسخة وحفظ السابقة
    const before = await data("protocolSettings", "current");
    const r2 = await setS({repeatRate: 0.1});
    deq(r2.ret, {changed: true, version: 2, fields: ["repeatRate"]}, "[٣] الكتابة الثانية: version 2، والحقل المتغيّر وحده");
    const d2 = await data("protocolSettings", "current");
    deq([d2.version, d2.repeatRate, d2.collectionPhase], [2, 0.1, true], "[٣] الدمج: collectionPhase (غير المذكور) باقٍ");
    const h1 = await data("protocolSettings/current/history", "1");
    ok(h1 !== undefined, "[٣] history/1 موجود (النسخة السابقة)");
    deq([h1.version, h1.repeatRate, h1.collectionPhase, h1.supersededByVersion, h1.supersededBy], [1, 0.25, true, 2, sid(ADMIN_UID)], "[٣] history/1: المستند السابق كاملاً + supersededByVersion + المشرف مُهشَّراً");
    deq(h1.updatedAt.toMillis(), before.updatedAt.toMillis(), "[٣] وupdatedAt السابق محفوظ كما كان");
    ok(TS(h1.supersededAt), "[٣] وsupersededAt وقت الخادم");
    eq((await db.collection("protocolSettings").doc("current").collection("history").get()).size, 1, "[٣] نسخة سابقة واحدة بعد كتابتين");

    // ٣-ج: لم يتغيّر
    const stamp = (await data("protocolSettings", "current")).updatedAt.toMillis();
    const r3 = await setS({repeatRate: 0.1, collectionPhase: true});
    deq(r3.ret, {changed: false, version: 2, fields: []}, "[٣] القيم نفسها ⟵ changed false بلا رفع نسخة");
    eq((await data("protocolSettings", "current")).updatedAt.toMillis(), stamp, "[٣] والمستند لم يُمسّ");
    eq((await db.collection("protocolSettings").doc("current").collection("history").get()).size, 1, "[٣] ولا history جديد");
    eq(named(r3.texts, "setProtocolSettings")[0], `[setProtocolSettings] unchanged version=2 caller=${sid(ADMIN_UID)}`, "[٣] سطر unchanged");
    // 0 قيمة لا غياب
    const rz = await setS({repeatRate: 0});
    deq(rz.ret, {changed: true, version: 3, fields: ["repeatRate"]}, "[٣] 0.1 ← 0 تغيّر (0 قيمة تُكتب)");
    eq((await data("protocolSettings", "current")).repeatRate, 0, "[٣] والمخزَّن 0 لا غائب");
    // كل الحقول السبعة دفعة واحدة
    const all = await setS({repeatRate: 0.25, doubleEvalRate: 0.1, openBeforeValidityHours: 168, collectionPhase: false, blindnessAlertBelowPct: 80, minAppVersion: "1.0.15", returnReasons: [{key: "late_complaint", ar: "FAKE-سبب", tr: "FAKE-neden", active: true}]});
    deq(all.ret, {changed: true, version: 4, fields: ["repeatRate", "doubleEvalRate", "openBeforeValidityHours", "collectionPhase", "blindnessAlertBelowPct", "returnReasons", "minAppVersion"]}, "[٣] الحقول السبعة معاً: version 4 والمتغيّرة كلّها (repeatRate 0←0.25، collectionPhase true←false)");
    const d4 = await data("protocolSettings", "current");
    deq([d4.version, d4.repeatRate, d4.doubleEvalRate, d4.openBeforeValidityHours, d4.collectionPhase, d4.blindnessAlertBelowPct, d4.minAppVersion], [4, 0.25, 0.1, 168, false, 80, "1.0.15"], "[٣] القيم السبع");
    deq(d4.returnReasons, [{key: "late_complaint", ar: "FAKE-سبب", tr: "FAKE-neden", active: true}], "[٣] قائمة المرتجع بشكلها (key · ar · tr · active)");
    eq((await db.collection("protocolSettings").doc("current").collection("history").get()).size, 3, "[٣] ثلاث نسخ سابقة (1 و2 و3)");
    ok(!all.texts.join("\n").includes("FAKE-") && !all.texts.join("\n").includes("late_complaint"), "[٣] لا نصّ سبب ولا مفتاحه في السجلّ");
  }

  // ٣-د: الرفوض: لا أثر
  {
    const snapshot = async () => JSON.stringify([await data("protocolSettings", "current"), (await db.collection("protocolSettings").doc("current").collection("history").get()).size]);
    const before = await snapshot();
    const refuseWith = async (label, settings, spec) => {
      const r = await setS(settings);
      expectRefusal(`[٣] ${label}`, r, {fn: "setProtocolSettings", ...spec});
      eq(await snapshot(), before, `[٣] ${label}: لا أثر على المستند ولا history`);
    };
    for (const bad of [undefined, null, {}, [], "x", 5]) await refuseWith(`settings ${JSON.stringify(bad)}`, bad, {...BAD("SETTINGS_PATCH_REQUIRED"), logReason: "SETTINGS_PATCH_REQUIRED"});
    await refuseWith("مفتاح مجهول", {repeatRate: 0.3, zzz: 1}, {...BAD("SETTINGS_FIELD_UNKNOWN", {field: "zzz"}), logReason: "SETTINGS_FIELD_UNKNOWN", logExtra: " field=zzz"});
    await refuseWith("version من العميل", {version: 99}, {...BAD("SETTINGS_FIELD_UNKNOWN", {field: "version"}), logReason: "SETTINGS_FIELD_UNKNOWN", logExtra: " field=version"});
    await refuseWith("symptomChips معلّق", {symptomChips: ["battery_swollen"]}, {code: "failed-precondition", message: "SETTINGS_FIELD_NOT_SPECIFIED", reasonCode: "SETTINGS_FIELD_NOT_SPECIFIED", field: "symptomChips", logReason: "SETTINGS_FIELD_NOT_SPECIFIED", logExtra: " field=symptomChips"});
    await refuseWith("targets معلّق", {targets: {x: 1}}, {code: "failed-precondition", message: "SETTINGS_FIELD_NOT_SPECIFIED", reasonCode: "SETTINGS_FIELD_NOT_SPECIFIED", field: "targets", logReason: "SETTINGS_FIELD_NOT_SPECIFIED", logExtra: " field=targets"});
    for (const [label, settings, field, cause] of [
      ["نسبة 1.5", {repeatRate: 1.5}, "repeatRate", "OUT_OF_RANGE"], ["نسبة -0.1", {doubleEvalRate: -0.1}, "doubleEvalRate", "OUT_OF_RANGE"], ["نسبة نصّ", {repeatRate: "0.25"}, "repeatRate", "NOT_A_FINITE_NUMBER"],
      ["ساعات 0", {openBeforeValidityHours: 0}, "openBeforeValidityHours", "OUT_OF_RANGE"], ["ساعات كسر", {openBeforeValidityHours: 1.5}, "openBeforeValidityHours", "NOT_AN_INTEGER"],
      ["عمى 101", {blindnessAlertBelowPct: 101}, "blindnessAlertBelowPct", "OUT_OF_RANGE"], ["مرحلة جمع نصّ", {collectionPhase: "true"}, "collectionPhase", "NOT_A_BOOLEAN"],
      ["إصدار أدنى خاطئ", {minAppVersion: "v1"}, "minAppVersion", "FORMAT_INVALID"], ["مسح حقل (null)", {repeatRate: null}, "repeatRate", "CANNOT_CLEAR"],
      ["قائمة مرتجع ليست مصفوفة", {returnReasons: "x"}, "returnReasons", "NOT_AN_ARRAY"], ["مفتاح مرتجع خاطئ", {returnReasons: [{key: "Bad Key", ar: "a", tr: "b", active: true}]}, "returnReasons", "KEY_INVALID"],
    ]) {
      await refuseWith(label, settings, {...BAD("SETTINGS_FIELD_INVALID", {field}), logReason: "SETTINGS_FIELD_INVALID", logExtra: ` field=${field} cause=${cause}`});
    }
    // الإيقاف بدل الحذف: حذف المفتاح المحفوظ يُرفض
    await refuseWith("حذف مفتاح مرتجع محفوظ", {returnReasons: [{key: "other_reason", ar: "FAKE", tr: "FAKE", active: true}]}, {code: "failed-precondition", message: "SETTINGS_RETURN_REASON_KEY_REMOVED", reasonCode: "SETTINGS_RETURN_REASON_KEY_REMOVED", field: "returnReasons", logReason: "SETTINGS_RETURN_REASON_KEY_REMOVED", logExtra: " field=returnReasons cause=KEY_REMOVED"});
    await refuseWith("تفريغ قائمة المرتجع", {returnReasons: []}, {code: "failed-precondition", message: "SETTINGS_RETURN_REASON_KEY_REMOVED", reasonCode: "SETTINGS_RETURN_REASON_KEY_REMOVED", field: "returnReasons", logReason: "SETTINGS_RETURN_REASON_KEY_REMOVED", logExtra: " field=returnReasons cause=KEY_REMOVED"});
    // الإيقاف مقبول، وإضافة مفتاح مقبولة، وتعديل النصّ مقبول — والنسخة ترتفع ويُحفظ السابق
    const stop = await setS({returnReasons: [{key: "late_complaint", ar: "FAKE-سبب معدَّل", tr: "FAKE-neden", active: false}, {key: "second_reason", ar: "FAKE-2", tr: "FAKE-2", active: true}]});
    deq(stop.ret, {changed: true, version: 5, fields: ["returnReasons"]}, "[٣] الإيقاف + إضافة مفتاح + تعديل نصّ: مقبول، version 5");
    const h4 = await data("protocolSettings/current/history", "4");
    deq(h4.returnReasons, [{key: "late_complaint", ar: "FAKE-سبب", tr: "FAKE-neden", active: true}], "[٣] history/4 يحفظ القائمة السابقة كما كانت (لا يضيع نصّ قديم)");
  }

  // ٣-هـ: مستند بلا version صالح (كتابة يدوية): يُرفض بلا تخمين، ويُقرأ غائباً
  {
    const good = await data("protocolSettings", "current");
    await db.collection("protocolSettings").doc("current").set({repeatRate: 0.4});
    const r = await setS({repeatRate: 0.5});
    expectRefusal("[٣] المستند الحاضر بلا version", r, {fn: "setProtocolSettings", code: "failed-precondition", message: "SETTINGS_CURRENT_VERSION_INVALID", reasonCode: "SETTINGS_CURRENT_VERSION_INVALID", logReason: "SETTINGS_CURRENT_VERSION_INVALID"});
    deq(await data("protocolSettings", "current"), {repeatRate: 0.4}, "[٣] ولا أثر");
    const g = await getS();
    deq([g.ret.state, g.ret.anomaly, g.ret.version, g.ret.settings], ["SETTINGS_ABSENT", "VERSION_UNUSABLE", null, {}], "[٣] getProtocolSettings: يُقرأ غائباً ويُعلَن شذوذه");
    await db.collection("protocolSettings").doc("current").set(good); // الإصلاح اليدوي (بيد الاختبار)
  }

  // ٣-و: سباق كتابتين متزامنتين: ترتيب نسخ بلا ضياع، وكل سابقة محفوظة
  {
    const base = (await data("protocolSettings", "current")).version;
    const cap = capture();
    let results;
    try {
      results = await Promise.all([{doubleEvalRate: 0.2}, {blindnessAlertBelowPct: 70}].map((settings) => settle(setProtocolSettings.run({data: {settings}, auth: ADMIN, rawRequest: {headers: {}}}))));
    } finally {
      cap.restore();
    }
    ok(results.every((r) => r.ok), "[٣] الكتابتان المتزامنتان نجحتا (المعاملة تُعيد المحاولة)");
    deq(results.map((r) => r.value.version).sort((a, b) => a - b), [base + 1, base + 2], "[٣] نسختان متتاليتان بلا تكرار ولا ضياع");
    const cur = await data("protocolSettings", "current");
    deq([cur.version, cur.doubleEvalRate, cur.blindnessAlertBelowPct], [base + 2, 0.2, 70], "[٣] والمستند يحمل أثر الكتابتين معاً (لا تطمس إحداهما الأخرى)");
    ok(await exists("protocolSettings/current/history", String(base)) && await exists("protocolSettings/current/history", String(base + 1)), "[٣] وhistory للسابقتين محفوظ");
  }

  // ٣-ز: history لا يُكتب فوقه (create لا set)
  {
    const cur = await data("protocolSettings", "current");
    await db.collection("protocolSettings").doc("current").collection("history").doc(String(cur.version)).set({marker: "DO-NOT-OVERWRITE"});
    const r = await setS({repeatRate: 0.77});
    ok(r.threw !== null, "[٣] نسخة سابقة موجودة بالمعرّف نفسه ⟵ الكتابة تفشل (لا يُكتب فوق history)");
    deq(await data("protocolSettings", "current"), cur, "[٣] والمستند الحاضر لم يتغيّر (المعاملة كلّها سقطت)");
    deq(await data("protocolSettings/current/history", String(cur.version)), {marker: "DO-NOT-OVERWRITE"}, "[٣] وسجلّ history المسبق باقٍ بحرفه");
    ok(named(r.texts, "setProtocolSettings").some((t) => t.startsWith("[setProtocolSettings] unexpected failure caller=")), "[٣] وسطر الفشل غير المتوقَّع بالصنف والرمز وحدهما");
    ok(!r.texts.join("\n").includes("DO-NOT-OVERWRITE") && !r.texts.join("\n").includes("0.77"), "[٣] بلا قيم في السطر (القاعدة 36)");
    // أزل التعارض ليستمرّ الاختبار: السابقة المسبقة تُحرَّك إلى نسخة بعيدة بيد الاختبار (إضافة لا حذف)
    await db.collection("protocolSettings").doc("current").collection("history").doc(String(cur.version + 1000)).set({marker: "moved-by-test"});
    await db.collection("protocolSettings").doc("current").set({...cur, version: cur.version + 1000});
  }

  // ═══ ٤ — setShopProtocolParts ═══
  {
    await seedShop("shop-pa-1", {evaluationEnabled: true, protocolParts: {purposes: true, consent: "true", extraPart: 7}});
    const before = await data("users", "shop-pa-1");
    const r = await setParts("shop-pa-1", {coldRepeat: true, purposes: true, consent: true});
    ok(r.threw === null, `[٤] الكتابة نجحت (${r.threw && r.threw.message})`);
    deq(r.ret, {ownerId: "shop-pa-1", parts: {purposes: true, batteryBeforeAfter: false, coldRepeat: true, returns: false, doubleEval: false, consent: true}, changed: ["coldRepeat", "consent"]}, "[٤] الردّ: الأجزاء الستّة والمتغيّرة (consent «true» نصّاً كانت تُقرأ false فصُحِّحت)");
    const after = await data("users", "shop-pa-1");
    deq(after.protocolParts, {purposes: true, consent: true, extraPart: 7, coldRepeat: true}, "[٤] protocolParts مدموجاً: ما لم تمسّه الرقعة باقٍ (extraPart)");
    deq({...after, protocolParts: undefined}, {...before, protocolParts: undefined}, "[٤] وباقي مستند المحلّ (الرصيد والباقة وevaluationEnabled) لم يُمسّ");
    eq(named(r.texts, "setShopProtocolParts")[0], `[setShopProtocolParts] written owner=${sid("shop-pa-1")} caller=${sid(ADMIN_UID)} changed=coldRepeat,consent`, "[٤] سطر الكتابة: أسماء الأجزاء وحدها");
    ok(!r.texts.join("\n").includes("shop-pa-1"), "[٤] لا معرّف خامّ");
    note("setShopProtocolParts — كتابة", named(r.texts, "setShopProtocolParts"));
    // لم يتغيّر
    const same = await setParts("shop-pa-1", {coldRepeat: true});
    deq(same.ret.changed, [], "[٤] القيمة نفسها ⟵ changed فارغة");
    eq(named(same.texts, "setShopProtocolParts")[0], `[setShopProtocolParts] unchanged owner=${sid("shop-pa-1")} caller=${sid(ADMIN_UID)} changed=none`, "[٤] سطر unchanged");
    deq((await data("users", "shop-pa-1")).protocolParts, after.protocolParts, "[٤] والمستند لم يُمسّ");
    // إيقاف
    deq((await setParts("shop-pa-1", {coldRepeat: false})).ret.parts.coldRepeat, false, "[٤] إيقاف جزء (false)");
    deq((await data("users", "shop-pa-1")).protocolParts.coldRepeat, false, "[٤] والمخزَّن false صريحاً (لا يُحذف المفتاح)");
    // قراءة الخادم الحقيقية لما كُتب
    const {readProtocolParts} = require("../src/protocol/scanProtocolDocument");
    deq(readProtocolParts(await data("users", "shop-pa-1")), {purposes: true, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: false, consent: true}, "[٤] قارئ الخادم (createScanSession وanalyzeDevice) يقرأ ما كُتب");
    // محلّ بلا protocolParts: الحقل يُنشأ
    await seedShop("shop-pa-2");
    const created = await setParts("shop-pa-2", {doubleEval: true});
    deq([created.ret.parts.doubleEval, (await data("users", "shop-pa-2")).protocolParts], [true, {doubleEval: true}], "[٤] محلّ بلا protocolParts: يُنشأ الحقل بالجزء المكتوب وحده (غيره غائب = غير مفعَّل)");
    // محلّ بـprotocolParts غير كائن: يُستبدل بالرقعة
    await seedShop("shop-pa-3", {protocolParts: "garbage"});
    deq((await setParts("shop-pa-3", {returns: true})).ret.parts.returns, true, "[٤] protocolParts تالف (نصّ) ⟵ يُستبدل بكائن الرقعة");
    deq((await data("users", "shop-pa-3")).protocolParts, {returns: true}, "[٤] والمخزَّن {returns: true}");
    // محلّ غير موجود
    const usersBefore = await count("users");
    expectRefusal("[٤] محلّ غير موجود", await setParts("no-such-shop-pa", {purposes: true}), {fn: "setShopProtocolParts", code: "not-found", message: "SHOP_NOT_FOUND", reasonCode: "SHOP_NOT_FOUND", logReason: "SHOP_NOT_FOUND", ids: ["no-such-shop-pa"]});
    eq(await count("users"), usersBefore, "[٤] ولا يُنشأ مستند مستخدم");
    // المدخلات
    const snapshot = JSON.stringify(await data("users", "shop-pa-1"));
    for (const [label, d, spec] of [
      ["ownerId غائب", {parts: {purposes: true}}, {...BAD("SHOP_ID_REQUIRED"), logReason: "SHOP_ID_REQUIRED"}],
      ["ownerId يحوي /", {ownerId: "a/b", parts: {purposes: true}}, {...BAD("SHOP_ID_REQUIRED"), logReason: "SHOP_ID_REQUIRED"}],
      ["parts غائب", {ownerId: "shop-pa-1"}, {...BAD("SHOP_PARTS_REQUIRED"), logReason: "SHOP_PARTS_REQUIRED", ids: ["shop-pa-1"]}],
      ["parts فارغ", {ownerId: "shop-pa-1", parts: {}}, {...BAD("SHOP_PARTS_REQUIRED"), logReason: "SHOP_PARTS_REQUIRED"}],
      ["الاسم القديم batteryPairs", {ownerId: "shop-pa-1", parts: {batteryPairs: true}}, {...BAD("SHOP_PARTS_KEY_UNKNOWN"), logReason: "SHOP_PARTS_KEY_UNKNOWN", logExtra: " part=UNKNOWN"}],
      ["قيمة نصّية", {ownerId: "shop-pa-1", parts: {purposes: "true"}}, {...BAD("SHOP_PARTS_VALUE_INVALID"), logReason: "SHOP_PARTS_VALUE_INVALID", logExtra: " part=purposes"}],
      ["مجهول بين صالحة", {ownerId: "shop-pa-1", parts: {purposes: false, bogus: true}}, {...BAD("SHOP_PARTS_KEY_UNKNOWN"), logReason: "SHOP_PARTS_KEY_UNKNOWN", logExtra: " part=UNKNOWN"}],
    ]) {
      expectRefusal(`[٤] ${label}`, await run(setShopProtocolParts, d), {fn: "setShopProtocolParts", ...spec});
    }
    eq(JSON.stringify(await data("users", "shop-pa-1")), snapshot, "[٤] كل الرفوض لم تمسّ المحلّ (ولا كتابة جزئية)");
  }

  // ═══ ٥ — manageTechnician وgetShopProtocolConfig ═══
  const SHOP = "shop-pa-t1";
  const OTHER = "shop-pa-t2";
  let tA;
  let tB;
  {
    await seedShop(SHOP);
    await seedShop(OTHER);
    const techsBefore = await count("technicians");
    const a = await tech({ownerId: SHOP, action: "add", displayName: "  FAKE-TECH-A  "});
    ok(a.threw === null, `[٥] الإضافة نجحت (${a.threw && a.threw.message})`);
    tA = a.ret.technicianId;
    deq(a.ret, {technicianId: tA, ownerId: SHOP, displayName: "FAKE-TECH-A", active: true, changed: true}, "[٥] الردّ: المعرّف والمحلّ والاسم مشذَّباً وactive true");
    ok(typeof tA === "string" && tA.length >= 10 && !tA.includes("FAKE"), "[٥] المعرّف يولّده Firestore (لا يتبع الاسم)");
    const docA = await data("technicians", tA);
    deq(Object.keys(docA).sort(), ["active", "createdAt", "displayName", "ownerId", "updatedAt"], "[٥] مستند الفنّي: الحقول الخمسة بالضبط (E15)");
    deq([docA.displayName, docA.ownerId, docA.active], ["FAKE-TECH-A", SHOP, true], "[٥] القيم");
    ok(TS(docA.createdAt) && TS(docA.updatedAt) && docA.createdAt.toMillis() === docA.updatedAt.toMillis(), "[٥] createdAt = updatedAt عند الإضافة");
    eq(named(a.texts, "manageTechnician")[0], `[manageTechnician] added owner=${sid(SHOP)} technician=${sid(tA)} caller=${sid(ADMIN_UID)}`, "[٥] سطر الإضافة: مُهشَّر بلا اسم");
    ok(!a.texts.join("\n").includes("FAKE-TECH") && !a.texts.join("\n").includes(tA) && !a.texts.join("\n").includes(SHOP), "[٥] لا اسم فنّي ولا معرّف خامّ في أيّ سطر");
    note("manageTechnician — إضافة", named(a.texts, "manageTechnician"));
    await new Promise((r) => setTimeout(r, 15));
    const b = await tech({ownerId: SHOP, action: "add", displayName: "FAKE-TECH-B"});
    tB = b.ret.technicianId;
    ok(tB !== tA, "[٥] فنّي ثانٍ بمعرّف آخر");
    // اسم مكرَّر مقبول (لا تفرّد: الربط بالمعرّف)
    const dup = await tech({ownerId: SHOP, action: "add", displayName: "FAKE-TECH-B"});
    ok(dup.threw === null && dup.ret.technicianId !== tB, "[٥] اسم مكرَّر مقبول بمعرّف آخر (لا تفرّد: الربط بالمعرّف لا بنصّ الاسم)");
    // فنّي لمحلّ آخر
    const o = await tech({ownerId: OTHER, action: "add", displayName: "FAKE-TECH-OTHER"});
    // تعديل
    await new Promise((r) => setTimeout(r, 15));
    const stampA = (await data("technicians", tA)).updatedAt.toMillis();
    const ren = await tech({ownerId: SHOP, action: "rename", technicianId: tA, displayName: "FAKE-TECH-A2"});
    deq(ren.ret, {technicianId: tA, ownerId: SHOP, displayName: "FAKE-TECH-A2", active: true, changed: true}, "[٥] التعديل: الاسم الجديد والمعرّف نفسه");
    const afterRen = await data("technicians", tA);
    deq([afterRen.displayName, afterRen.active, afterRen.ownerId, afterRen.createdAt.toMillis() === docA.createdAt.toMillis()], ["FAKE-TECH-A2", true, SHOP, true], "[٥] التعديل لا يمسّ غير displayName وupdatedAt (createdAt والملكية وactive باقية)");
    ok(afterRen.updatedAt.toMillis() > stampA, "[٥] updatedAt يتقدّم");
    const renSame = await tech({ownerId: SHOP, action: "rename", technicianId: tA, displayName: "FAKE-TECH-A2"});
    deq([renSame.ret.changed, named(renSame.texts, "manageTechnician")[0].startsWith("[manageTechnician] unchanged ")], [false, true], "[٥] الاسم نفسه ⟵ changed false بلا كتابة");
    eq((await data("technicians", tA)).updatedAt.toMillis(), afterRen.updatedAt.toMillis(), "[٥] وupdatedAt لم يتقدّم");
    // إيقاف: لا حذف
    const stop = await tech({ownerId: SHOP, action: "set_active", technicianId: tA, active: false});
    deq([stop.ret.changed, stop.ret.active, stop.ret.displayName], [true, false, "FAKE-TECH-A2"], "[٥] الإيقاف: active false (الاسم باقٍ)");
    deq([(await data("technicians", tA)).active, (await data("technicians", tA)).displayName], [false, "FAKE-TECH-A2"], "[٥] والمستند باقٍ موقوفاً **لا محذوفاً** (فتبقى تقييماته القديمة مربوطة بمعرّفه)");
    eq(await count("technicians"), techsBefore + 4, "[٥] أربعة مستندات (ثلاثة للمحلّ وواحد لآخر) ولا حذف");
    const stopAgain = await tech({ownerId: SHOP, action: "set_active", technicianId: tA, active: false});
    eq(stopAgain.ret.changed, false, "[٥] إيقاف الموقوف ⟵ changed false");
    // إعادة تفعيل
    const back = await tech({ownerId: SHOP, action: "set_active", technicianId: tA, active: true});
    deq([back.ret.changed, (await data("technicians", tA)).active], [true, true], "[٥] إعادة التفعيل");
    await tech({ownerId: SHOP, action: "set_active", technicianId: tA, active: false});
    // الرفوض
    await db.collection("technicians").doc("tech-noowner-pa").set({displayName: "FAKE-NOOWNER", active: true});
    const snapshot = JSON.stringify([await data("technicians", tA), await data("technicians", tB), await data("technicians", "tech-noowner-pa"), await count("technicians")]);
    expectRefusal("[٥] add لمحلّ غير موجود", await tech({ownerId: "no-such-shop-pa2", action: "add", displayName: "FAKE-TECH-X"}), {fn: "manageTechnician", code: "not-found", message: "SHOP_NOT_FOUND", reasonCode: "SHOP_NOT_FOUND", logReason: "SHOP_NOT_FOUND", ids: ["no-such-shop-pa2"]});
    expectRefusal("[٥] rename فنّي محلّ آخر", await tech({ownerId: OTHER, action: "rename", technicianId: tA, displayName: "FAKE-HIJACK"}), {fn: "manageTechnician", code: "failed-precondition", message: "TECHNICIAN_OWNER_MISMATCH", reasonCode: "TECHNICIAN_OWNER_MISMATCH", logReason: "TECHNICIAN_OWNER_MISMATCH", ids: [tA, OTHER]});
    expectRefusal("[٥] set_active فنّي محلّ آخر", await tech({ownerId: OTHER, action: "set_active", technicianId: tA, active: true}), {fn: "manageTechnician", code: "failed-precondition", message: "TECHNICIAN_OWNER_MISMATCH", reasonCode: "TECHNICIAN_OWNER_MISMATCH", logReason: "TECHNICIAN_OWNER_MISMATCH", ids: [tA, OTHER]});
    expectRefusal("[٥] فنّي غير موجود", await tech({ownerId: SHOP, action: "rename", technicianId: "no-such-tech-pa", displayName: "FAKE-X"}), {fn: "manageTechnician", code: "not-found", message: "TECHNICIAN_NOT_FOUND", reasonCode: "TECHNICIAN_NOT_FOUND", logReason: "TECHNICIAN_NOT_FOUND", ids: ["no-such-tech-pa", SHOP]});
    expectRefusal("[٥] فنّي بلا ownerId مخزَّن", await tech({ownerId: SHOP, action: "set_active", technicianId: "tech-noowner-pa", active: false}), {fn: "manageTechnician", code: "failed-precondition", message: "TECHNICIAN_OWNER_MISMATCH", reasonCode: "TECHNICIAN_OWNER_MISMATCH", logReason: "TECHNICIAN_OWNER_MISMATCH", ids: ["tech-noowner-pa"]});
    for (const [label, d, reason] of [
      ["ownerId غائب", {action: "add", displayName: "FAKE-X"}, "SHOP_ID_REQUIRED"], ["action غائب", {ownerId: SHOP, displayName: "FAKE-X"}, "TECHNICIAN_ACTION_REQUIRED"],
      ["فعل حذف", {ownerId: SHOP, action: "delete", technicianId: tA}, "TECHNICIAN_ACTION_INVALID"], ["technicianId غائب", {ownerId: SHOP, action: "rename", displayName: "FAKE-X"}, "TECHNICIAN_ID_REQUIRED"],
      ["اسم فارغ", {ownerId: SHOP, action: "add", displayName: "   "}, "TECHNICIAN_NAME_INVALID"], ["اسم 121 حرفاً", {ownerId: SHOP, action: "add", displayName: "x".repeat(121)}, "TECHNICIAN_NAME_INVALID"],
      ["active نصّ", {ownerId: SHOP, action: "set_active", technicianId: tA, active: "false"}, "TECHNICIAN_ACTIVE_INVALID"],
    ]) {
      expectRefusal(`[٥] ${label}`, await tech(d), {fn: "manageTechnician", ...BAD(reason), logReason: reason, ids: [tA, SHOP]});
    }
    eq(JSON.stringify([await data("technicians", tA), await data("technicians", tB), await data("technicians", "tech-noowner-pa"), await count("technicians")]), snapshot, "[٥] الرفوض لم تمسّ أيّ فنّي ولا أنشأت");
  }
  {
    // getShopProtocolConfig
    const r = await cfg(SHOP);
    ok(r.threw === null, "[٥] قراءة الإعداد");
    deq(Object.keys(r.ret).sort(), ["ownerId", "parts", "partsState", "technicians"], "[٥] أربعة مفاتيح");
    deq([r.ret.ownerId, r.ret.partsState, r.ret.parts], [SHOP, "ABSENT", {purposes: false, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: false, consent: false}], "[٥] محلّ بلا protocolParts: partsState ABSENT وكل الأجزاء false («الغائب غير مفعَّل»)");
    eq(r.ret.technicians.length, 3, "[٥] ثلاثة فنّيين لهذا المحلّ (A وB والمكرَّر) بلا فنّي المحلّ الآخر ولا العديم المالك (ownerId لا يطابق)");
    deq(r.ret.technicians.map((t) => t.displayName).sort(), ["FAKE-TECH-A2", "FAKE-TECH-B", "FAKE-TECH-B"], "[٥] أسماؤهم (المعدَّلة والمكرَّر)");
    const view = r.ret.technicians.find((t) => t.technicianId === tA);
    deq([view.displayName, view.active, view.activeState], ["FAKE-TECH-A2", false, "INACTIVE"], "[٥] الموقوف يظهر في قراءة المشرف بحالته (لا يُخفى)");
    ok(typeof view.createdAtMs === "number" && typeof view.updatedAtMs === "number", "[٥] createdAtMs وupdatedAtMs أرقام");
    const order = r.ret.technicians.map((t) => t.createdAtMs);
    deq(order, [...order].sort((x, y) => x - y), "[٥] مرتّبون بـcreatedAtMs (في الذاكرة: الاستعلام مساواة بلا ترتيب)");
    eq(r.ret.technicians[0].technicianId, tA, "[٥] الأقدم أوّلاً");
    eq(named(r.texts, "getShopProtocolConfig")[0], `[getShopProtocolConfig] served owner=${sid(SHOP)} caller=${sid(ADMIN_UID)} technicians=3`, "[٥] سطر الخدمة بالعدد وحده");
    ok(!r.texts.join("\n").includes("FAKE-TECH"), "[٥] ولا اسم في السجلّ");
    // محلّ آخر: فنّيه وحده
    const o = await cfg(OTHER);
    deq(o.ret.technicians.map((t) => t.displayName), ["FAKE-TECH-OTHER"], "[٥] محلّ آخر: فنّيه وحده (معزول)");
    // active غير مقروء
    await db.collection("technicians").doc("tech-noflag-pa").set({displayName: "FAKE-NOFLAG", ownerId: OTHER});
    const f = (await cfg(OTHER)).ret.technicians.find((t) => t.technicianId === "tech-noflag-pa");
    deq([f.active, f.activeState, f.createdAtMs], [null, "ACTIVE_FLAG_UNREADABLE", null], "[٥] active غائب ⟵ ACTIVE_FLAG_UNREADABLE (لا يُقرأ فعّالاً) وcreatedAtMs null");
    eq((await cfg(OTHER)).ret.technicians[(await cfg(OTHER)).ret.technicians.length - 1].technicianId, "tech-noflag-pa", "[٥] ومن بلا createdAt يأتي أخيراً");
    // محلّ بـprotocolParts
    const p = await cfg("shop-pa-1");
    deq([p.ret.partsState, p.ret.parts.consent, p.ret.parts.purposes, p.ret.technicians], ["PRESENT", true, true, []], "[٥] محلّ بـprotocolParts: PRESENT وأجزاؤه وبلا فنّيين (قائمة فارغة لا غائبة)");
    expectRefusal("[٥] محلّ غير موجود", await cfg("no-such-shop-pa3"), {fn: "getShopProtocolConfig", code: "not-found", message: "SHOP_NOT_FOUND", reasonCode: "SHOP_NOT_FOUND", logReason: "SHOP_NOT_FOUND", ids: ["no-such-shop-pa3"]});
    expectRefusal("[٥] ownerId غائب", await run(getShopProtocolConfig, {}), {fn: "getShopProtocolConfig", ...BAD("SHOP_ID_REQUIRED"), logReason: "SHOP_ID_REQUIRED"});
  }

  // ═══ ٦ — التكامل مع استمارة الفنّي (S-P6-08) ═══
  {
    const OWN = "shop-pa-form";
    await seedShop(OWN, {evaluationEnabled: true});
    const t1 = (await tech({ownerId: OWN, action: "add", displayName: "FAKE-TECH-FORM-1"})).ret.technicianId;
    const t2 = (await tech({ownerId: OWN, action: "add", displayName: "FAKE-TECH-FORM-2"})).ret.technicianId;
    const created = await call(() => createScanSession.run({data: {}, auth: {uid: OWN, token: tokenOf("google.com")}, rawRequest: {headers: {}}}));
    ok(created.threw === null, `[٦] الجلسة أُنشئت (${created.threw && created.threw.message})`);
    const sessionId = created.ret.sessionId;
    const joined = await call(() => joinScanSession.run({data: {code: created.ret.code}, auth: {uid: "phone-pa-form", token: tokenOf("anonymous")}, rawRequest: {headers: {}}}));
    ok(joined.threw === null, "[٦] الانضمام");
    const config = () => call(() => getTechnicianFormConfig.run({data: {sessionId}, auth: {uid: OWN, token: {}}, rawRequest: {headers: {}}}));
    const live = (await data("protocolSettings", "current")).version;
    const c1 = await config();
    ok(c1.threw === null, `[٦] getTechnicianFormConfig (${c1.threw && c1.threw.message})`);
    deq(c1.ret.technicians.map((t) => t.technicianId).sort(), [t1, t2].sort(), "[٦] فنّيا المشرف الفعّالان يظهران لجهاز الفنّي بمعرّفَيهما");
    eq(c1.ret.settingsVersion, live, "[٦] settingsVersion = نسخة protocolSettings/current الحيّة (استُبدل ثابت SETTINGS_ABSENT: القاعدة 23)");
    const CHIPS = ["battery_dies_before_day_end", "battery_jumps_or_shuts_down", "battery_swollen", "hot_while_charging", "charging_slow", "slow_or_freezes_daily",
      "restarts_under_load", "heats_fast_in_use", "system_heat_warning", "game_stutter_after_minutes", "game_screen_lines_or_flicker", "games_freeze_or_close"];
    const form = (technicianId, slot = 1) => ({
      sessionId, formContractVersion: 2, slot, technicianId,
      grades: {battery: "good", performance: "excellent", thermal: "good", overall: "good"},
      functional: {screen_touch: "works", camera: "works", audio: "works", buttons: "works", charging: "works", network: "works"},
      defects: {replaced_screen: "works", water_damage: "works", prior_repair: "works"},
      symptoms: ["none_noticed"], symptomOrderShown: [...CHIPS], known_fault_before_scan: false,
      batteryHealth: {kind: "percent", percent: 92, stateKey: null}, gameTried: true, observedNote: null,
      openedAt: 1000, firstTapAt: 2000, perAnswerAt: [2000, 5000], submittedAt: 20000,
    });
    const submit = (d) => call(() => submitTechnicianForm.run({data: d, auth: {uid: OWN, token: {}}, rawRequest: {headers: {}}}));
    // موقوف ⟵ يختفي ويُرفض
    await tech({ownerId: OWN, action: "set_active", technicianId: t2, active: false});
    const c2 = await config();
    deq(c2.ret.technicians.map((t) => t.technicianId), [t1], "[٦] الموقوف يختفي من إعداد الاستمارة");
    const refused = await submit(form(t2));
    ok(refused.threw !== null && refused.threw.details.reasonCode === "FORM_TECHNICIAN_UNKNOWN", "[٦] إرسال الموقوف ⟵ FORM_TECHNICIAN_UNKNOWN");
    ok(named(refused.texts, "submitTechnicianForm").some((t) => t.includes("technicianState=INACTIVE")), "[٦] والسبب في السجلّ INACTIVE");
    ok(!(await exists("technicianForms", `${sessionId}_1`)), "[٦] ولا مستند استمارة");
    // الفعّال يُقبل
    const okSub = await submit(form(t1));
    ok(okSub.threw === null, `[٦] إرسال فنّي المشرف الفعّال مقبول (${okSub.threw && okSub.threw.message})`);
    eq((await data("technicianForms", `${sessionId}_1`)).technicianId, t1, "[٦] والاستمارة مربوطة بمعرّفه (لا باسمه)");
    // تعديل الاسم لا يقطع الربط
    await tech({ownerId: OWN, action: "rename", technicianId: t1, displayName: "FAKE-TECH-FORM-1-RENAMED"});
    eq((await data("technicianForms", `${sessionId}_1`)).technicianId, t1, "[٦] تعديل اسم الفنّي لا يقطع ربط استمارته (الربط بالمعرّف: «اجتهاد تصميمي» P:792)");
    ok(!JSON.stringify(await data("technicianForms", `${sessionId}_1`)).includes("FAKE-TECH-FORM"), "[٦] ولا اسم فنّي في مستند الاستمارة");
    // إعادة التفعيل تُرجعه
    await tech({ownerId: OWN, action: "set_active", technicianId: t2, active: true});
    deq((await config()).ret.technicians.map((t) => t.technicianId).sort(), [t1, t2].sort(), "[٦] إعادة التفعيل تُرجعه إلى الإعداد");
    // الإعدادات الجديدة تنعكس في الإعداد
    await setS({minAppVersion: "1.0.16"});
    eq((await config()).ret.settingsVersion, (await data("protocolSettings", "current")).version, "[٦] ونسخة الإعدادات في الإعداد تتبع آخر كتابة");
  }

  // ═══ ٧ — لا حذف ═══
  {
    for (const f of ["src/protocol/settingsWrite.js", "src/protocol/shopProtocol.js", "src/admin/protocolSettingsAdmin.js", "src/admin/shopProtocolAdmin.js"]) {
      const code = fs.readFileSync(path.join(__dirname, "..", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(code), `[٧] ${f}: لا حذف بأيّ وسيلة (القاعدة 42)`);
    }
  }

  console.log(`\n${OBSERVED.join("\n")}`);
  console.log(`\nprotocolAdmin.e2e.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
