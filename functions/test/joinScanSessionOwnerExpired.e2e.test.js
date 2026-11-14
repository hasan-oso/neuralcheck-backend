// E2E test: رفض الانضمام المبكّر لجلسة مالكها منتهٍ اشتراكه (S-SUB، 2026-10-16 +03، البند ٢).
// المعالج الحقيقي عبر `.run()` على محاكي Firestore (القاعدة 37). **الاستبدال الوحيد**: `admin.messaging` بمُرسِل يعدّ ولا يرسل (لا شبكة نحو أيّ مزوّد)؛ و**المراقب التمريري** (لا يستبدل شيئاً):
// Firestore.prototype.request لعدّ طلبات commit الناجحة التي تكتب مستند الجلسة (مقياس «لا كتابة» مستقلّ عن إعادة محاولات المعاملة).
//
// الأمر (بنصّه، من المنسّق، غير متحقَّق من هذا المستودع): «`joinScanSession` يرفض جلسةً مالكُها منتهٍ اشتراكه (`SHOP_SUBSCRIPTION_EXPIRED`)، قبل أن يقيس الفنّي ثماني دقائق. ورفض «بلا رصيد» عند الانضمام
// لم يُقرَّر. رفض استشاري لا يحجز شيئاً. بالحكم نفسه الذي تستعمله البوّابة (مصدر واحد). إعادة الانضمام (الجهاز نفسه وجلسته scanning) لا تُرفض بهذا الفحص. والكنس عند الانضمام كما هو.»
//
// ما يثبته:
//   ١ مالك منتهٍ اشتراكه (Timestamp ماضٍ) ⟵ رفض permission-denied بالنصّ القائم «انتهى اشتراكك، يرجى التجديد» وdetails={reasonCode: SHOP_SUBSCRIPTION_EXPIRED}؛ سطر `[joinScanSession] refused reason=…
//     stage=transaction session=#… joiner=#… owner=#…` واحد بمعرّفات مُهشَّرة؛ **بلا أيّ كتابة** (الجلسة pending كما هي بالبايت، لا joinedBy ولا joinedAt)، ولا FCM، ولا سطر evaluationEnabled، ولا كنس.
//   ٢ الحكم هو isSubscriptionExpired نفسها: expiresAt نصّ ISO ماضٍ أو رقم ms ماضٍ أيضاً منتهٍ؛ والرصيد 0 مع الانتهاء ⟵ الانتهاء (لا رصيد لا يُرفض عند الانضمام).
//   ٣ لا رفض: expiresAt مستقبلي، غائب، null، نصّ تالف، «بعد الآن بميلّي ثانية» · وثيقة المالك غائبة · رصيد المالك 0 وغير منتهٍ — كلّها تنضمّ كما كانت (الردّ نفسه، FCM، سطر الكنس).
//   ٤ الأسبقية: انقضاء وقت الجلسة (يُكتب «منتهية»)، والجلسة الملغاة، وexpiresAt الجلسة الغائب، وجلسة انضمّ إليها جهاز آخر — كلّها تسبق حكم المالك فتُرفض بسببها القائم لا بسبب الاشتراك.
//   ٥ إعادة الانضمام (الجهاز نفسه والجلسة scanning) تُقبل ولو انتهى اشتراك المالك بعد الانضمام الأوّل: بلا كتابة ولا FCM ولا رفض.
//   ٦ الرفض لا يترك أثراً: بعد تجديد المالك يضمّ الجهاز نفسه كأنّ شيئاً لم يكن (كتابة انضمام واحدة).
//   ٧ منضمّ بلا هوية (joinerUid غائب) ⟵ الرفض نفسه وjoiner=missing.
//   ٨ السجلّ: لا رمز جلسة ولا sessionId ولا uid خامّاً في أيّ سطر.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/joinScanSessionOwnerExpired.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {Firestore} = require("firebase-admin/firestore");
const {admin, db} = require("../src/utils/admin");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {JOIN_REFUSAL: J} = require("../src/sessions/sessionNames");
const {SCAN_REFUSAL, SCAN_REFUSAL_TEXT} = require("../src/analysis/scanRefusal");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// النصّ الظاهر لهذا الرفض: نصّ الانتهاء القائم حرفياً (لا نصّ جديد يصل مستخدماً — القرار ٩٠)، والفاصلة العربية U+060C.
const TEXT_EXPIRED = "انتهى اشتراكك، يرجى التجديد";
const TEXT_CODE_EXPIRED = "انتهت صلاحية الكود";
const TEXT_GENERIC = "الكود غير صالح أو منتهي الصلاحية";
const REASON = "SHOP_SUBSCRIPTION_EXPIRED";

const DEV_A = "device-anon-uid-ownerexp-000A";
const DEV_B = "device-anon-uid-ownerexp-000B";
const FUTURE = () => new Date(Date.now() + 30 * 60 * 1000);
const PAST = () => new Date(Date.now() - 30 * 60 * 1000);
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});

// ─── المراقب والمُرسِل ──────────────────────────────────────────────────────────────────────────────────────────
const fcmSent = [];
Object.defineProperty(admin, "messaging", {
  configurable: true,
  value: () => ({send: async (message) => { fcmSent.push(message); return "projects/demo-nc/messages/stub"; }}),
});
const committedDocs = [];
const realRequest = Firestore.prototype.request;
Firestore.prototype.request = async function spiedRequest(methodName, request, ...rest) {
  const res = await realRequest.call(this, methodName, request, ...rest);
  if (methodName === "commit" && request && Array.isArray(request.writes)) {
    for (const w of request.writes) {
      const name = (w.update && w.update.name) || (w.transform && w.transform.document) || (typeof w.delete === "string" ? w.delete : null);
      if (name) committedDocs.push(name);
    }
  }
  return res;
};
const commitsTo = (collection, id) => committedDocs.filter((d) => d.endsWith(`/${collection}/${id}`)).length;
const fcmFor = (sessionId) => fcmSent.filter((m) => m.data && m.data.sessionId === sessionId).length;

const allLines = [];
function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { const l = a.join(" "); lines.push(l); allLines.push(l); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function join(code, auth) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await joinScanSession.run({data: {code}, auth, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines};
}
let seq = 0;
const nextIds = (tag) => { seq++; return {OWNER: `owner-uid-ownerexp-${tag}-${seq}`, ID: `sess-ownerexp-${tag}-${seq}`, CODE: `NC-OE${String(seq).padStart(4, "0")}`}; };
const seedOwner = (uid, fields) => db.collection("users").doc(uid).set(fields);
const seedSession = (id, ownerId, fields) => db.collection("scanSessions").doc(id).set({ownerId, scanId: null, ...fields});
const snapOf = (id) => db.collection("scanSessions").doc(id).get();
const refusedLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] refused "));
const sweepLines = (lines) => lines.filter((l) => l.startsWith("[sweepExpiredSessions] swept "));
const evalLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] evaluationEnabled="));
const rejoinedLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] rejoined "));

/** الرفض بسبب انتهاء اشتراك المالك: الرمز والنصّ وdetails وسطر السجلّ الكامل، وبلا أثر. */
async function expectOwnerExpired(res, {ID, OWNER, joiner, stage = "transaction"}, label, effects) {
  ok(res.threw !== null && res.ret === null, `${label}: رُفض`);
  eq(res.threw.code, "permission-denied", `${label}: الرمز permission-denied (كما لرفض الانتهاء القائم في analyzeDevice)`);
  eq(res.threw.message, TEXT_EXPIRED, `${label}: النصّ القائم «انتهى اشتراكك، يرجى التجديد» حرفياً`);
  deq(res.threw.details, {reasonCode: REASON}, `${label}: details = {reasonCode: ${REASON}} وحده`);
  const lines = refusedLines(res.lines);
  eq(lines.length, 1, `${label}: سطر رفض واحد`);
  eq(lines[0], `[joinScanSession] refused reason=${REASON} stage=${stage} session=${hashIdForLog(ID)} joiner=${hashIdForLog(joiner)} owner=${hashIdForLog(OWNER)}`, `${label}: السطر كاملاً بمعرّفات مُهشَّرة`);
  eq(evalLines(res.lines).length + rejoinedLines(res.lines).length + sweepLines(res.lines).length, 0, `${label}: ولا evaluationEnabled ولا rejoined ولا كنس (يعود قبل نقطة الكنس)`);
  if (effects) {
    const after = await snapOf(ID);
    ok(after.updateTime.isEqual(effects.before.updateTime), `${label}: updateTime مستند الجلسة لم يتغيّر`);
    deq(after.data(), effects.before.data(), `${label}: بيانات الجلسة كما كانت (pending: لا status ولا joinedAt ولا joinedBy)`);
    eq(commitsTo("scanSessions", ID), effects.commits, `${label}: لا طلب commit كتب مستند الجلسة`);
    eq(fcmFor(ID), effects.fcm, `${label}: ولا FCM للمالك`);
  }
}
async function snapshotBefore(ID) {
  return {before: await snapOf(ID), commits: commitsTo("scanSessions", ID), fcm: fcmFor(ID)};
}
const OWNER_OK = {language: "ar", evaluationEnabled: true, fcmToken: "stub-fcm-token-not-a-real-token", scansRemaining: 5, plan: "shop_pro"};

(async () => {
  ok(db instanceof Firestore, "[٠] db هو Firestore الذي يراقبه المراقب");
  eq(SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED], TEXT_EXPIRED, "[٠] نصّ SHOP_SUBSCRIPTION_EXPIRED في المصدر الواحد = نصّ الانتهاء القائم حرفياً");
  eq(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED, REASON, "[٠] والرمز");

  // ═══ ١ — مالك منتهٍ اشتراكه ═══
  {
    const {OWNER, ID, CODE} = nextIds("1");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: PAST()});
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: FUTURE()});
    const fx = await snapshotBefore(ID);
    ok(fx.commits >= 1, "[١] المراقب يرى كتابة الزرع (شاهد أن «صفر» لاحقاً ليس غياب رؤية)");
    const r = await join(CODE, authAnon(DEV_A));
    await expectOwnerExpired(r, {ID, OWNER, joiner: DEV_A}, "[١] مالك منتهٍ (Timestamp ماضٍ)", fx);
    const s = (await snapOf(ID)).data();
    eq(s.status, "pending", "[١] الجلسة ما زالت pending");
    ok(!("joinedBy" in s) && !("joinedAt" in s), "[١] ولا joinedBy ولا joinedAt");
    // الرفض يتكرّر بلا أثر
    const r2 = await join(CODE, authAnon(DEV_A));
    await expectOwnerExpired(r2, {ID, OWNER, joiner: DEV_A}, "[١] المحاولة الثانية", fx);
    // ٦ — بعد تجديد المالك: ينضمّ الجهاز نفسه كأنّ شيئاً لم يكن
    await db.collection("users").doc(OWNER).update({expiresAt: FUTURE()});
    const r3 = await join(CODE, authAnon(DEV_A));
    ok(r3.threw === null, "[٦] بعد تجديد المالك: الانضمام ينجح");
    deq(r3.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: true, consentEnabled: false}, "[٦] بالردّ المعتاد (ق15: + consentEnabled=false، المالك بلا protocolParts)");
    eq(commitsTo("scanSessions", ID), fx.commits + 1, "[٦] وكتابة انضمام واحدة فقط (الرفضان السابقان لم يكتبا)");
    eq(fcmFor(ID), 1, "[٦] وإشعار FCM واحد");
    eq(sweepLines(r3.lines).length, 1, "[٦] وسطر الكنس يُكتب للانضمام الأوّل كما كان");
  }

  // ═══ ٢ — الحكم هو isSubscriptionExpired نفسها، والرصيد لا يُرفض عند الانضمام ═══
  for (const [label, fields] of [
    ["expiresAt نصّ ISO ماضٍ", {expiresAt: new Date(Date.now() - 3600 * 1000).toISOString()}],
    ["expiresAt رقم ms ماضٍ", {expiresAt: Date.now() - 3600 * 1000}],
    ["expiresAt قبل الآن بدقيقة والرصيد 0 (الانتهاء يُرفض ولو لا رصيد: «بلا رصيد» لم يُقرَّر عند الانضمام)", {expiresAt: new Date(Date.now() - 60 * 1000), scansRemaining: 0}],
  ]) {
    const {OWNER, ID, CODE} = nextIds("2");
    await seedOwner(OWNER, {...OWNER_OK, ...fields});
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: FUTURE()});
    const fx = await snapshotBefore(ID);
    await expectOwnerExpired(await join(CODE, authAnon(DEV_A)), {ID, OWNER, joiner: DEV_A}, `[٢] ${label}`, fx);
  }

  // ═══ ٣ — لا رفض ═══
  const NO_REFUSAL = [
    ["expiresAt مستقبلي", {expiresAt: FUTURE()}, true],
    ["expiresAt غائب (لا انتهاء — أمان للمستخدمين القدامى)", {}, true],
    ["expiresAt null", {expiresAt: null}, true],
    ["expiresAt نصّ تالف (لا انتهاء)", {expiresAt: "not-a-date"}, true],
    ["expiresAt بعد الآن بدقيقة", {expiresAt: new Date(Date.now() + 60 * 1000)}, true],
    ["رصيد المالك 0 وغير منتهٍ (لا رفض «بلا رصيد» عند الانضمام)", {scansRemaining: 0, expiresAt: FUTURE()}, true],
    ["رصيد المالك غائب وغير منتهٍ", {scansRemaining: undefined, expiresAt: FUTURE()}, true],
    ["وثيقة المالك غائبة (لا يُحكم عليها: تُترك للبوّابة)", null, false],
  ];
  for (const [label, fields, hasOwnerDoc] of NO_REFUSAL) {
    const {OWNER, ID, CODE} = nextIds("3");
    if (hasOwnerDoc) {
      const doc = {...OWNER_OK, ...fields};
      for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
      await seedOwner(OWNER, doc);
    }
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: FUTURE()});
    const c0 = commitsTo("scanSessions", ID);
    const r = await join(CODE, authAnon(DEV_A));
    ok(r.threw === null, `[٣] ${label}: ينضمّ`);
    deq(r.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: hasOwnerDoc, consentEnabled: false}, `[٣] ${label}: الردّ المعتاد (ق15: + consentEnabled=false)`);
    eq(refusedLines(r.lines).length, 0, `[٣] ${label}: بلا سطر رفض`);
    eq(commitsTo("scanSessions", ID), c0 + 1, `[٣] ${label}: كتابة انضمام واحدة`);
    eq(fcmFor(ID), hasOwnerDoc ? 1 : 0, `[٣] ${label}: FCM ${hasOwnerDoc ? "واحد" : "لا (لا رمز FCM للمالك)"}`);
    eq(sweepLines(r.lines).length, 1, `[٣] ${label}: سطر الكنس كما كان`);
    eq(evalLines(r.lines).length, 1, `[٣] ${label}: سطر evaluationEnabled كما كان`);
  }

  // ═══ ٤ — الأسبقية: ما يخصّ الجلسة نفسها يسبق حكم المالك ═══
  {
    // ٤-أ جلسة انقضى وقتها + مالك منتهٍ ⟵ SESSION_EXPIRED، وتُكتب «منتهية»
    const {OWNER, ID, CODE} = nextIds("4a");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: PAST()});
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: PAST()});
    const r = await join(CODE, authAnon(DEV_A));
    ok(r.threw && r.threw.code === "deadline-exceeded" && r.threw.message === TEXT_CODE_EXPIRED, "[٤-أ] انقضاء وقت الجلسة يسبق حكم المالك: deadline-exceeded بنصّه القائم");
    deq(r.threw.details, {reasonCode: J.EXPIRED}, "[٤-أ] details = SESSION_EXPIRED لا SHOP_SUBSCRIPTION_EXPIRED");
    eq((await snapOf(ID)).data().status, "expired", "[٤-أ] وتُكتب «منتهية» (قرار المستخدم ٢ القائم: عند المسّ بعد انقضاء الوقت)");
  }
  {
    // ٤-ب جلسة ملغاة + مالك منتهٍ ⟵ رفض الملغاة القائم
    const {OWNER, ID, CODE} = nextIds("4b");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: PAST()});
    await seedSession(ID, OWNER, {code: CODE, status: "cancelled", expiresAt: FUTURE(), cancelReason: "cancelled_by_owner"});
    const r = await join(CODE, authAnon(DEV_A));
    ok(r.threw && r.threw.code === "not-found" && r.threw.message === TEXT_GENERIC, "[٤-ب] الجلسة الملغاة تسبق حكم المالك: not-found بنصّه القائم");
    deq(r.threw.details, {reasonCode: J.CANCELLED}, "[٤-ب] details = SESSION_CANCELLED");
  }
  {
    // ٤-ج expiresAt الجلسة غائب + مالك منتهٍ ⟵ SESSION_EXPIRES_AT_INVALID
    const {OWNER, ID, CODE} = nextIds("4c");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: PAST()});
    await seedSession(ID, OWNER, {code: CODE, status: "pending"});
    const r = await join(CODE, authAnon(DEV_A));
    ok(r.threw && r.threw.code === "permission-denied" && r.threw.message === "جلسة الفحص غير صالحة", "[٤-ج] expiresAt الجلسة الغائب يسبق حكم المالك بنصّه القائم");
    deq(r.threw.details, {reasonCode: J.EXPIRES_AT_INVALID}, "[٤-ج] details = SESSION_EXPIRES_AT_INVALID");
  }
  {
    // ٤-د جلسة scanning انضمّ إليها A: جهاز آخر B ⟵ SESSION_ALREADY_JOINED ولو انتهى اشتراك المالك
    const {OWNER, ID, CODE} = nextIds("4d");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: FUTURE()});
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: FUTURE()});
    ok((await join(CODE, authAnon(DEV_A))).threw === null, "[٤-د] انضمّ A والمالك سليم");
    await db.collection("users").doc(OWNER).update({expiresAt: PAST()});
    const r = await join(CODE, authAnon(DEV_B));
    ok(r.threw && r.threw.code === "not-found" && r.threw.message === TEXT_GENERIC, "[٤-د] جهاز آخر على scanning: رفضه القائم (not-found) لا حكم الاشتراك");
    deq(r.threw.details, {reasonCode: J.ALREADY_JOINED}, "[٤-د] details = SESSION_ALREADY_JOINED");

    // ═══ ٥ — إعادة انضمام A تُقبل ولو انتهى اشتراك المالك بعد الانضمام الأوّل ═══
    const fx = await snapshotBefore(ID);
    const re = await join(CODE, authAnon(DEV_A));
    ok(re.threw === null, "[٥] إعادة انضمام A تُقبل ولو انتهى اشتراك المالك بعد الانضمام الأوّل");
    deq(re.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: true, consentEnabled: false}, "[٥] بالردّ نفسه (ق15: + consentEnabled=false)");
    eq(refusedLines(re.lines).length, 0, "[٥] بلا سطر رفض");
    eq(rejoinedLines(re.lines).length, 1, "[٥] وبسطر rejoined المعتاد");
    const after = await snapOf(ID);
    ok(after.updateTime.isEqual(fx.before.updateTime), "[٥] بلا كتابة على مستند الجلسة (updateTime لم يتغيّر)");
    eq(commitsTo("scanSessions", ID), fx.commits, "[٥] ولا طلب commit");
    eq(fcmFor(ID), fx.fcm, "[٥] ولا FCM ثانٍ");
    eq(sweepLines(re.lines).length, 0, "[٥] ولا كنس (قرار 2026-10-16: إعادة الانضمام لا تكنس)");
  }

  // ═══ ٧ — منضمّ بلا هوية ═══
  {
    const {OWNER, ID, CODE} = nextIds("7");
    await seedOwner(OWNER, {...OWNER_OK, expiresAt: PAST()});
    await seedSession(ID, OWNER, {code: CODE, status: "pending", expiresAt: FUTURE()});
    const fx = await snapshotBefore(ID);
    await expectOwnerExpired(await join(CODE, undefined), {ID, OWNER, joiner: null}, "[٧] منضمّ بلا هوية", fx);
  }

  // ═══ ٨ — السجلّ: لا معرّف خامّ ولا رمز جلسة ═══
  const blob = allLines.join("\n");
  for (const [what, re] of [
    ["رمز جلسة (NC-…)", /NC-OE\d{4}/], ["sessionId خامّ", /sess-ownerexp-/], ["uid المالك الخامّ", /owner-uid-ownerexp-/], ["uid الجهاز الخامّ", /device-anon-uid-ownerexp-/],
  ]) ok(!re.test(blob), `[٨] لا ${what} في أيّ سطر سجلّ مكتوب أثناء النداءات`);
  ok(committedDocs.every((d) => d.includes("/documents/")), "[٨] والمراقب لم يرَ إلا كتابات مستندات (لا حذف)");

  Firestore.prototype.request = realRequest;
  console.log(`\nALL PASS (${n} assertions) — commits observed on session docs: ${committedDocs.filter((d) => d.includes("/scanSessions/")).length}, FCM stub sends: ${fcmSent.length}`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
