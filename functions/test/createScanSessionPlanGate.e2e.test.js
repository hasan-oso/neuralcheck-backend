// E2E test: createScanSession يشترط باقة تسمح بإنشاء جلسة (A-SUB، البند ١، 2026-10-17 +03). المعالج الحقيقي عبر `.run()` على محاكي Firestore (القاعدة 37).
// **الاستبدال الوحيد**: `admin.messaging` بمُرسِل لا يرسل (لا شبكة). لا نداء نموذج: createScanSession لا تكلّم مزوّداً.
//
// القرار (المنسّق، منقول من نصّ الأمر، غير متحقَّق من هذا المستودع): «createScanSession لا يتحقّق من باقة المالك … فمستخدم غير shop (free/single برصيد ≥ 1) يستطيع نداء
// الدالّة مباشرة ويُفوتَر فحص جلسته على رصيده، وهذا خارج ميزة الباقة». الفحص **بعد** شرطَي الرصيد والانتهاء (فلا يتغيّر رفض قائم ولا نصّه):
// `HttpsError("permission-denied", <نصّ عربي محايد>, {reasonCode: "SHOP_PLAN_REQUIRED"})` وبسطر سجلّ مسمّى بمعرّف مُهشَّر لا يطبع قيمة الباقة الخام.
//
// ما يثبته:
//   ١ العطب (قبل الإصلاح كان يفشل هنا): حساب free برصيد ≥ 1 وغير منتهٍ يُرفض ولا تُنشأ له جلسة (قبل الإصلاح كان ينشئ جلسة).
//   ٢ كل باقة غير مسموحة (free · single · نصّ فارغ · غائبة · null · رقم · unlimited · custom) ⟵ SHOP_PLAN_REQUIRED، بلا جلسة ولا تغيّر في الرصيد.
//   ٣ كل باقة مسموحة (shop_basic · shop_pro · basic · pro · PRO · Basic · professional · Professional-Month1) تُنشئ جلسة كما كان، بلا خصم رصيد.
//   ٤ الترتيب: رصيد 0 أو منتهٍ بباقة free ⟵ يبقى SHOP_NO_CREDIT / SHOP_SUBSCRIPTION_EXPIRED بنصّه القائم (الرصيد قبل الانتهاء قبل الباقة).
//   ٥ السلك: details = {reasonCode} وحدها، والنصّ هو CREATE_SESSION_PLAN_REQUIRED_TEXT، والرمز permission-denied.
//   ٦ السجلّ: السطر المسمّى بمعرّف مُهشَّر وحالة الباقة، ولا قيمة باقة خام ولا uid خامّ في أيّ سطر من النداء المرفوض.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/createScanSessionPlanGate.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {admin, db} = require("../src/utils/admin");
const {createScanSession, CREATE_SESSION_PLAN_REQUIRED_TEXT, CREATE_SESSION_NO_CREDIT_TEXT} = require("../src/sessions/createScanSession");
const {CREATE_SESSION_REFUSAL} = require("../src/sessions/sessionNames");
const {SCAN_REFUSAL, SCAN_REFUSAL_TEXT} = require("../src/analysis/scanRefusal");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

Object.defineProperty(admin, "messaging", {configurable: true, value: () => ({send: async () => "projects/demo-nc/messages/stub"})});

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function create(uid) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await createScanSession.run({data: {}, auth: {uid, token: {}}, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines};
}

const DAY = 24 * 3600 * 1000;
const future = () => new Date(Date.now() + 10 * DAY);
const past = () => new Date(Date.now() - DAY);
/** مالك بباقة معيَّنة؛ `plan` يُحذف من المستند حين تكون القيمة الرمز ABSENT (الغياب حالة لا قيمة). */
const ABSENT = Symbol("absent");
async function seedOwner(uid, plan, fields = {}) {
  const doc = {scansRemaining: 5, scansTotal: 5, isActive: true, expiresAt: future(), ...fields};
  if (plan !== ABSENT) doc.plan = plan;
  await db.collection("users").doc(uid).set(doc);
}
const sessionsOf = async (uid) => (await db.collection("scanSessions").where("ownerId", "==", uid).get()).docs;
const balance = async (uid) => (await db.collection("users").doc(uid).get()).data().scansRemaining;

(async () => {
  // ═══ ١ — العطب: free برصيد ≥ 1 وغير منتهٍ لا ينشئ جلسة ═══
  await seedOwner("own-free", "free", {scansRemaining: 3, scansTotal: 3});
  {
    const r = await create("own-free");
    ok(r.threw !== null, "[١] حساب free برصيد 3 وغير منتهٍ: **يُرفض** (قبل الإصلاح: أنشأ جلسة وأعاد sessionId — هذا هو العطب)");
    eq(r.threw && r.threw.code, "permission-denied", "[١] permission-denied");
    eq((await sessionsOf("own-free")).length, 0, "[١] ولا جلسة أُنشئت لهذا الحساب");
    eq(await balance("own-free"), 3, "[١] والرصيد كما هو (لا فوترة)");
  }

  // ═══ ٢ — كل باقة غير مسموحة ═══
  const REFUSED = [
    ["free", "free"], ["single", "single"], ["نصّ فارغ", ""], ["غائبة", ABSENT], ["null", null], ["رقم", 123],
    ["unlimited", "unlimited"], ["custom", "custom"], ["كائن", {tier: "pro"}],
  ];
  let k = 0;
  for (const [label, plan] of REFUSED) {
    const uid = `own-ref-${k++}`;
    await seedOwner(uid, plan);
    const r = await create(uid);
    ok(r.threw && r.threw.details && r.threw.details.reasonCode === CREATE_SESSION_REFUSAL.SHOP_PLAN_REQUIRED, `[٢] باقة «${label}»: يُرفض بـSHOP_PLAN_REQUIRED`);
    eq((await sessionsOf(uid)).length, 0, `[٢] باقة «${label}»: بلا جلسة`);
    eq(await balance(uid), 5, `[٢] باقة «${label}»: الرصيد كما هو (5)`);
  }

  // ═══ ٣ — كل باقة مسموحة تُنشئ كما كانت ═══
  const ALLOWED = ["shop_basic", "shop_pro", "basic", "pro", "PRO", "Basic", "professional", "Professional-Month1"];
  k = 0;
  for (const plan of ALLOWED) {
    const uid = `own-ok-${k++}`;
    await seedOwner(uid, plan);
    const r = await create(uid);
    ok(r.threw === null && r.ret && typeof r.ret.sessionId === "string" && /^NC-[0-9A-Z]{6}$/.test(r.ret.code), `[٣] باقة «${plan}»: تُنشأ جلسة برمز NC-XXXXXX`);
    eq(r.ret.expiresInMinutes, 60, `[٣] باقة «${plan}»: الردّ كما كان (60 دقيقة)`);
    const docs = await sessionsOf(uid);
    eq(docs.length, 1, `[٣] باقة «${plan}»: جلسة واحدة`);
    eq(docs[0].data().status, "pending", `[٣] باقة «${plan}»: pending كما كان`);
    eq(await balance(uid), 5, `[٣] باقة «${plan}»: إنشاء الجلسة لا يخصم (5)`);
  }

  // ═══ ٤ — الترتيب: الرصيد ثم الانتهاء ثم الباقة ═══
  await seedOwner("own-free-zero", "free", {scansRemaining: 0});
  await seedOwner("own-free-expired", "free", {expiresAt: past()});
  await seedOwner("own-free-zero-expired", "single", {scansRemaining: 0, expiresAt: past()});
  await seedOwner("own-pro-expired", "shop_pro", {expiresAt: past()});
  {
    const z = await create("own-free-zero");
    deq([z.threw.code, z.threw.message, z.threw.details], ["permission-denied", CREATE_SESSION_NO_CREDIT_TEXT, {reasonCode: SCAN_REFUSAL.SHOP_NO_CREDIT}], "[٤] free برصيد 0: SHOP_NO_CREDIT بنصّه القائم (لا الباقة)");
    const e = await create("own-free-expired");
    deq([e.threw.code, e.threw.message, e.threw.details], ["permission-denied", SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED], {reasonCode: SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED}], "[٤] free منتهٍ: SHOP_SUBSCRIPTION_EXPIRED بنصّه القائم (لا الباقة)");
    const ze = await create("own-free-zero-expired");
    eq(ze.threw.details.reasonCode, SCAN_REFUSAL.SHOP_NO_CREDIT, "[٤] single برصيد 0 ومنتهٍ: الرصيد أوّلاً (كما كان)");
    const pe = await create("own-pro-expired");
    eq(pe.threw.details.reasonCode, SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED, "[٤] shop_pro منتهٍ: الانتهاء كما كان (الباقة سليمة)");
    ok(!z.lines.concat(e.lines).some((l) => l.includes("SHOP_PLAN_REQUIRED")), "[٤] ولا سطر SHOP_PLAN_REQUIRED في رفض الرصيد أو الانتهاء");
  }

  // ═══ ٥ — السلك ═══
  {
    await seedOwner("own-wire", "free");
    const r = await create("own-wire");
    eq(r.threw.code, "permission-denied", "[٥] الرمز permission-denied");
    eq(r.threw.message, CREATE_SESSION_PLAN_REQUIRED_TEXT, "[٥] النصّ هو CREATE_SESSION_PLAN_REQUIRED_TEXT");
    deq(r.threw.details, {reasonCode: "SHOP_PLAN_REQUIRED"}, "[٥] details = {reasonCode: SHOP_PLAN_REQUIRED} وحدها");
    ok(![CREATE_SESSION_NO_CREDIT_TEXT, SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT], SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED]].includes(CREATE_SESSION_PLAN_REQUIRED_TEXT), "[٥] والنصّ ليس نصّاً قائماً (لا يلتبس برفض الرصيد أو الانتهاء)");
  }

  // ═══ ٦ — السجلّ: سطر مسمّى بلا قيمة خام ═══
  {
    const RAW_PLAN = "zzRawPlanValue9";
    await seedOwner("own-log-raw", RAW_PLAN);
    const r = await create("own-log-raw");
    const all = r.lines.join("\n");
    const named = r.lines.filter((l) => l.startsWith("[createScanSession] refused "));
    deq(named, [`[createScanSession] refused reason=SHOP_PLAN_REQUIRED user=${hashIdForLog("own-log-raw")} planState=not_owner_plan`], "[٦] سطر الرفض المسمّى الوحيد: سبب + معرّف مُهشَّر + حالة الباقة");
    ok(!all.includes(RAW_PLAN), "[٦] قيمة الباقة الخام لا تظهر في أيّ سطر من النداء");
    ok(!all.includes("own-log-raw"), "[٦] ولا uid خامّاً");
    for (const [uid, plan, state] of [["own-log-absent", ABSENT, "absent"], ["own-log-null", null, "absent"], ["own-log-num", 123, "not_a_string"]]) {
      await seedOwner(uid, plan);
      const x = await create(uid);
      deq(x.lines.filter((l) => l.startsWith("[createScanSession] refused ")), [`[createScanSession] refused reason=SHOP_PLAN_REQUIRED user=${hashIdForLog(uid)} planState=${state}`], `[٦] حالة الباقة ${state} صريحة في السطر`);
    }
  }

  console.log(`createScanSessionPlanGate.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
