// E2E test: مفتاح الجهاز بالشكلين (a..f في إصدار R8، والأسماء الكاملة) على المعالج الحقيقي analyzeDevice + المحاكي (V8 قبل نشر الأمان، 2026-10-09 +03).
// لا يُستبدَل إلا الشبكة نحو المزوّد (global.fetch، كما في analyzeDevice1010Compat.e2e.test.js) وGemini (كعب يرمي)، فكل الشيفرة الحقيقية تعمل:
// analyzeDevice · runAnalysisInternal · findDeviceProfile · createDeviceProfile · appendScanToHistory · deviceProfileKey.js (القاعدة 37).
//
// قرار المستخدم (بنصّه): «القراءة المتوافقة للاسمين (deviceProfileKey.a وprimary معاً) تدخل نشر الأمان هذا، بنداً رابعاً لوكيل الخادم، مع اختبار على
// الحمولتين.» وسياقه: «أسماء R8 (a..f) في deviceProfiles: هو الخطوة الأولى في إصلاح مفتاح الجهاز ... واختبار على حمولة الإصدار الحقيقية لا debug.»
// والمطلوب لكل حمولة، على المعالج الحقيقي: البحث بالأساسي؛ وكتابة ملفّ الجهاز بطبقات حقيقية لا حرّاس؛ وعدم تخطّي كتلة تحديث deviceProfiles في analyzeDevice.
//
// ما استُعمل لكل حمولة (لا عيّنة R8 مسجَّلة حقيقية في هذا المستودع — ابحث بـgrep عن "deviceProfileKey" في test/fixtures: كلها بالأسماء الكاملة):
//   • الأسماء الكاملة: عيّنة fv67 الذهبية الحقيقية (طلب 1.0.10 من الملفّ الزمني 34dff2b8). تنبيه: بُنيت في JVM فأسماؤها كاملة، وقيمها بديلة (synthetic-golden-*).
//   • حمولة R8 (a..f): **مشتقّة** من الأولى بإعادة تسمية الحقول الستّة وحدها بالأسماء المنقولة من نصّ الأمر (primary→a … layerE_sensorSig→f؛ منقولة، غير متحقَّقة من
//     التطبيق)، بنسخة مستقلّة هنا لا من المُطبِّع (كي لا تدور الشيفرة على نفسها). ليست عيّنة مسجَّلة: لا ملفّ جديد يُحفظ في golden ولا ملفّ مسجَّل يُعدَّل (قاعدة الردود).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/deviceProfileKeyShapes.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده؛ global.fetch نفسه يُستبدَل بكعب المزوّد أدناه

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
        throw new Error("stub gemini: must not be called");
      }};
    }
  }},
};

const {db} = require("../src/utils/admin");
const {analyzeDevice} = require("../src/analysis/analyzeDevice");
const {findDeviceProfile} = require("../src/profiles/findDeviceProfile");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const REQUEST_FILE = path.join(__dirname, "fixtures", "golden", "fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json");
const readRequest = () => JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8"));
const GOLDEN_KEY = readRequest().fingerprint.device.deviceProfileKey;

// نسخة مستقلّة من نصّ الأمر (لا من المُطبِّع)
const R8_NAME = {primary: "a", layerA_keystore: "b", layerB_firebaseId: "c", layerC_androidId: "d", layerD_buildSig: "e", layerE_sensorSig: "f"};
const toR8 = (key) => Object.fromEntries(Object.entries(key).map(([k, v]) => [R8_NAME[k], v]));
const withValues = (tag) => Object.fromEntries(Object.keys(R8_NAME).map((k) => [k, `${tag}-${k}`]));

const UID = "u-keyshapes";
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const future = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

async function reset() {
  const project = process.env.GCLOUD_PROJECT || "demo-nc";
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, {method: "DELETE"});
  assert.ok(res.ok, "تعذّر تفريغ المحاكي");
  await db.collection("users").doc(UID).set({scansRemaining: 50, scansTotal: 50, plan: "single", isActive: true, expiresAt: future()});
}

// كعب المزوّد (الشبكة وحدها): ردّ صالح الشكل يبني وصفاً لكل عطب أرسله الخادم — كما في analyzeDevice1010Compat.e2e.test.js
function installProvider() {
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const userMessage = body.messages.find((m) => m.role === "user").content;
    const payload = JSON.parse(userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ""));
    const ids = ((payload.categoryStates && payload.categoryStates.issues) || []).map((i) => i.id);
    const content = {
      narrative: {
        summary: "ملخّص اختبار سليم الشكل", details: "تفاصيل اختبار سليمة الشكل", verdict: "حكم اختبار سليم الشكل",
        buyerAdvice: {casual: "نصيحة اختبار للمشتري العادي", gamer: "نصيحة اختبار للاعب", photographer: "نصيحة اختبار للمصوّر"},
        issueDescriptions: Object.fromEntries(ids.map((id) => [id, "وصف اختبار للعطب"])),
      },
      crossChecks: [], adjustments: [], modelObservations: [],
    };
    const envelope = {choices: [{message: {content: JSON.stringify(content)}, finish_reason: "stop"}], usage: {prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10, completion_tokens: 20}};
    return {ok: true, status: 200, json: async () => envelope, text: async () => ""};
  };
}

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info, debug: console.debug};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
// يحلّل فحصاً واحداً بمفتاح الجهاز المعطى (undefined = احذف المفتاح من الطلب)؛ يُرجع الردّ والسجلّ والمعرّف
async function scan(deviceProfileKey) {
  const request = readRequest();
  request.scanId = crypto.randomUUID();
  if (deviceProfileKey === undefined) delete request.fingerprint.device.deviceProfileKey;
  else request.fingerprint.device.deviceProfileKey = deviceProfileKey;
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await analyzeDevice.run({data: request, auth: {uid: UID, token: tokenOf("password")}, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines, scanId: request.scanId};
}
const profileDoc = async (id) => (await db.collection("deviceProfiles").doc(id).get());
const issued = async (r) => r.threw === null && (await db.collection("reports").doc(r.scanId).get()).exists;
const has = (lines, re) => lines.some((l) => re.test(l));
const LAYER_KEYS = ["layerA_keystore", "layerB_firebaseId", "layerC_androidId", "layerD_buildSig", "layerE_sensorSig"];
const GUARD_VALUES = {layerA_keystore: "no_keystore", layerB_firebaseId: "no_fid", layerC_androidId: "no_android_id", layerD_buildSig: "unknown", layerE_sensorSig: "no_sensors"};

// تأكيدات «حُدِّث ملفّ الجهاز» المشتركة: الملفّ موجود بمعرّف الأساسي، وطبقاته الخمس القيم الحقيقية لا الحرّاس، وفحصه الأوّل في السجلّ
async function assertProfileWritten({label, primary, key, r, shape, scanCount = 1}) {
  const snap = await profileDoc(primary);
  ok(snap.exists, `${label}: deviceProfiles/${primary} موجود (لم تُتخطَّ كتلة تحديث deviceProfiles)`);
  const d = snap.data();
  eq(d.primaryFingerprint, primary, `${label}: primaryFingerprint = الأساسي`);
  for (const k of LAYER_KEYS) {
    eq(d[k], key[k], `${label}: ${k} = القيمة الحقيقية من الحمولة`);
    ok(d[k] !== GUARD_VALUES[k], `${label}: ${k} ليست قيمة الحارس (${GUARD_VALUES[k]})`);
  }
  eq(d.metadata.scanCount, scanCount, `${label}: metadata.scanCount = ${scanCount}`);
  ok(d.scanHistory.some((h) => h.scanId === r.scanId), `${label}: scanHistory فيه الفحص ${scanCount === 1 ? "الأوّل" : "الأخير"}`);
  ok(!has(r.lines, /profile write skipped/), `${label}: لا سطر «profile write skipped»`);
  ok(has(r.lines, /\[analyzeDevice\] (created profile|appended scan to profile)/), `${label}: سطر created/appended في السجلّ`);
  if (shape) ok(has(r.lines, new RegExp(`\\[ProfileLookup\\] deviceProfileKey shape=${shape} usable=true`)), `${label}: سطر البحث يسمّي الشكل ${shape}`);
  return d;
}

(async () => {
  // ═══ ١ — حمولة R8 (a..f): الإصدار 1.0.10 كما يُرسل فعلاً ═══
  {
    await reset(); installProvider();
    const R8 = toR8(GOLDEN_KEY);
    deq(Object.keys(R8).sort(), ["a", "b", "c", "d", "e", "f"], "[١] الحمولة a..f وحدها");
    const P = GOLDEN_KEY.primary;
    const r1 = await scan(R8);
    ok(await issued(r1), "[١] الفحص يكتمل ويصدر التقرير (الأولى)");
    await assertProfileWritten({label: "[١] R8 فحص أوّل", primary: P, key: GOLDEN_KEY, r: r1, shape: "R8_SHORT_NAMES"});
    ok(has(r1.lines, /\[analyzeDevice\] created profile synthetic-golden-primary \(shape=R8_SHORT_NAMES usable=true\)/), "[١] سطر الإنشاء يسمّي الأساسي والشكل");
    // البحث بالأساسي: الفحص الثاني للجهاز نفسه يجد ملفّه
    const r2 = await scan(R8);
    ok(await issued(r2), "[١] الفحص الثاني يكتمل");
    ok(has(r2.lines, /\[ProfileLookup\] Found by primary: synthetic-golden-primary/), "[١] البحث بالأساسي وجد الملفّ (R8)");
    await assertProfileWritten({label: "[١] R8 فحص ثانٍ", primary: P, key: GOLDEN_KEY, r: r2, shape: "R8_SHORT_NAMES", scanCount: 2});
    eq((await db.collection("deviceProfiles").get()).size, 1, "[١] ملفّ جهاز واحد (لا ملفّ ثانٍ للفحص الثاني)");
    // البحث المباشر بالشكلين يصل إلى الملفّ نفسه
    for (const [name, key] of [["R8", R8], ["الأسماء الكاملة", GOLDEN_KEY]]) {
      const found = await findDeviceProfile(key);
      ok(found && found.profileId === P && found.matchedBy === "primary", `[١] findDeviceProfile(${name}) → الملفّ نفسه بالأساسي`);
    }
  }

  // ═══ ٢ — حمولة الأسماء الكاملة (عيّنة fv67 الذهبية، بُنيت في JVM): كانت تتخطّى كتلة deviceProfiles كلّها ═══
  {
    await reset(); installProvider();
    const P = GOLDEN_KEY.primary;
    const r1 = await scan(GOLDEN_KEY);
    ok(await issued(r1), "[٢] الفحص يكتمل ويصدر التقرير");
    await assertProfileWritten({label: "[٢] أسماء كاملة فحص أوّل", primary: P, key: GOLDEN_KEY, r: r1, shape: "FULL_NAMES"});
    const r2 = await scan(GOLDEN_KEY);
    ok(has(r2.lines, /\[ProfileLookup\] Found by primary: synthetic-golden-primary/), "[٢] البحث بالأساسي وجد الملفّ (الأسماء الكاملة)");
    await assertProfileWritten({label: "[٢] أسماء كاملة فحص ثانٍ", primary: P, key: GOLDEN_KEY, r: r2, shape: "FULL_NAMES", scanCount: 2});
  }

  // ═══ ٣ — الجهاز نفسه بين الإصدارين: 1.0.10 (R8) ثم 1.0.11 (كاملة) وبالعكس — ملفّ واحد ═══
  {
    await reset(); installProvider();
    const P = GOLDEN_KEY.primary;
    const a = await scan(toR8(GOLDEN_KEY));
    const b = await scan(GOLDEN_KEY);
    ok(has(b.lines, /Found by primary: synthetic-golden-primary/), "[٣] R8 ثم الكاملة: الثانية وجدت ملفّ الأولى");
    const dd = await assertProfileWritten({label: "[٣] R8 ثم كاملة", primary: P, key: GOLDEN_KEY, r: b, shape: "FULL_NAMES", scanCount: 2});
    ok(dd.scanHistory.some((h) => h.scanId === a.scanId), "[٣] وتاريخ الملفّ يحمل الفحصين");
    eq((await db.collection("deviceProfiles").get()).size, 1, "[٣] ملفّ جهاز واحد");
    await reset(); installProvider();
    await scan(GOLDEN_KEY);
    const c = await scan(toR8(GOLDEN_KEY));
    ok(has(c.lines, /Found by primary: synthetic-golden-primary/), "[٣] الكاملة ثم R8: الثانية وجدت ملفّ الأولى");
    await assertProfileWritten({label: "[٣] كاملة ثم R8", primary: P, key: GOLDEN_KEY, r: c, shape: "R8_SHORT_NAMES", scanCount: 2});
  }

  // ═══ ٤ — مختلط (a + طبقات بالأسماء الكاملة) وكلا الشكلين بالقيم نفسها ═══
  {
    await reset(); installProvider();
    const K = withValues("mixed");
    const mixed = {a: K.primary, layerA_keystore: K.layerA_keystore, layerB_firebaseId: K.layerB_firebaseId, layerC_androidId: K.layerC_androidId, layerD_buildSig: K.layerD_buildSig, layerE_sensorSig: K.layerE_sensorSig};
    const r = await scan(mixed);
    ok(await issued(r), "[٤] مختلط: الفحص يكتمل");
    await assertProfileWritten({label: "[٤] مختلط", primary: K.primary, key: K, r, shape: "MIXED_FORMS"});
    await reset(); installProvider();
    const A = withValues("agree");
    const both = {...A, ...toR8(A)};
    const r2 = await scan(both);
    ok(await issued(r2), "[٤] الشكلان بقيم واحدة: الفحص يكتمل");
    await assertProfileWritten({label: "[٤] الشكلان معاً بقيم واحدة", primary: A.primary, key: A, r: r2, shape: "BOTH_FORMS_AGREE"});
  }

  // ═══ ٥ — الشكلان بقيمتين مختلفتين: لا بحث ولا كتابة، ولا إلحاق بملفّ جهاز آخر؛ والفحص يكتمل ═══
  {
    await reset(); installProvider();
    const other = withValues("conflict");
    // ملفّ جهاز موجود بمعرّف قيمة primary: لو اختُير الاسم الكامل لأُلحق به الفحص (scanCount يتقدّم)، ولو اختُير القصير لأُنشئ ملفّ بقيمة a — والاختبار يلتقط الاثنين
    const seeded = await scan(toR8(other));
    ok(await issued(seeded), "[٥] تمهيد: فحص بشكل R8 ينشئ ملفّاً بالأساسي conflict-primary");
    const before = (await profileDoc(other.primary)).data();
    const conflicting = {...other, ...toR8(other), a: "conflict-OTHER-primary"}; // primary ≠ a
    const r = await scan(conflicting);
    ok(await issued(r), "[٥] التعارض: الفحص يكتمل ويصدر التقرير (فشل مغلق في الملفّ لا في الفحص)");
    ok(has(r.lines, /\[ProfileLookup\] deviceProfileKey shape=BOTH_FORMS_CONFLICT usable=false reason=FORMS_CONFLICT conflicts=\[primary\]/), "[٥] سطر البحث يسمّي الشكل والسبب والحقل المتعارض");
    ok(has(r.lines, /\[ProfileLookup\] Skipping lookup: unusable/), "[٥] لا بحث");
    ok(has(r.lines, /\[analyzeDevice\] profile write skipped: shape=BOTH_FORMS_CONFLICT usable=false reason=FORMS_CONFLICT conflicts=\[primary\]/), "[٥] التخطّي مسمّى في analyzeDevice");
    const after = (await profileDoc(other.primary)).data();
    eq(after.metadata.scanCount, before.metadata.scanCount, "[٥] ملفّ الجهاز الموجود لم يُلحَق به الفحص (scanCount ثابت)");
    eq(after.scanHistory.length, before.scanHistory.length, "[٥] ولا تاريخه تغيّر");
    ok(!(await profileDoc("conflict-OTHER-primary")).exists, "[٥] ولم يُنشأ ملفّ بقيمة الاسم القصير");
    eq((await db.collection("deviceProfiles").get()).size, 1, "[٥] ملفّ جهاز واحد فقط (الممهَّد)");
  }

  // ═══ ٦ — غياب المفتاح، والأساسي الاحتياطي: لا كتابة ولا بحث، والتخطّي مسمّى لا صامت ═══
  {
    await reset(); installProvider();
    const absent = await scan(undefined);
    ok(await issued(absent), "[٦] بلا مفتاح: الفحص يكتمل");
    ok(has(absent.lines, /\[analyzeDevice\] profile write skipped: shape=ABSENT usable=false reason=KEY_ABSENT/), "[٦] بلا مفتاح: التخطّي مسمّى (ABSENT / KEY_ABSENT)");
    const fb = await scan({...toR8(withValues("fb")), a: "unknown_fp"});
    ok(await issued(fb), "[٦] أساسي احتياطي: الفحص يكتمل");
    ok(has(fb.lines, /\[analyzeDevice\] profile write skipped: primary is unknown_fp/), "[٦] أساسي احتياطي: التخطّي مسمّى");
    const nonObj = await scan("abcdef0123456789");
    ok(has(nonObj.lines, /\[analyzeDevice\] profile write skipped: shape=NOT_AN_OBJECT/), "[٦] مفتاح نصّي: التخطّي مسمّى (NOT_AN_OBJECT)");
    eq((await db.collection("deviceProfiles").get()).size, 0, "[٦] لا ملفّ جهاز في أيّ من الثلاث");
  }

  // ═══ ٧ — الطبقات الحقيقية صارت مقروءة لشكل R8: جهاز تغيّر أساسيّه وبقي مفتاح keystore يُعرف بالطبقة (matchedBy) ═══
  {
    await reset(); installProvider();
    const K = withValues("layers");
    await scan(toR8(K));
    const moved = {...toR8(K), a: "layers-NEW-primary"}; // الأساسي تغيّر، الطبقات نفسها
    const found = await findDeviceProfile(moved);
    ok(found && found.profileId === K.primary && found.matchedBy === "layerA_keystore", "[٧] R8 بأساسي جديد وطبقات قديمة: وُجد الملفّ القديم بطبقة keystore (كانت طبقات R8 غير مقروءة فلا مطابقة)");
    const noMatch = await findDeviceProfile({...toR8(withValues("zzz"))});
    eq(noMatch, null, "[٧] جهاز آخر بكل قيمه: لا مطابقة");
  }

  await reset();
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", (e && e.stack) || e);
  process.exit(1);
});
