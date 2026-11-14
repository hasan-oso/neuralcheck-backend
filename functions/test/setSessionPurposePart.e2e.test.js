// E2E test: ق31 — رفض setSessionPurpose لمحلّ بلا الجزء، على محاكي Firestore، بالدوالّ الحقيقية createScanSession وjoinScanSession وsetSessionPurpose عبر `.run()` (القاعدة 37).
// قرار حسن 2026-10-22 (أمر المستخدم عبر المنسّق): «داخل معاملة الدالّة … يُرفض `purpose ≠ normal` إن كان `purposes !== true`، ويُرفض `maintenance_*` إن كان `batteryBeforeAfter !== true`، برمز `PURPOSE_PART_NOT_ENABLED` وسطر سجلّ مسمّى»
// (evidence/run-2026-10-18/DECISIONS-FOR-HASAN-2026-10-21.md ق31؛ منقول، غير متحقَّق إلا بالقراءة). **لا استبدال** هنا: لا نداء مزوّد أصلاً (setSessionPurpose لا تحلّل)؛ كل ما يمرّ إلى المحاكي كما هو.
//
// **يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): التأكيدات تُسجَّل فشلها بنصّها ولا توقف التشغيل، ويُطبع تقرير كامل (الخروج 1 إن فشل أيّ تأكيد).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/setSessionPurposePart.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {admin, db} = require("../src/utils/admin");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {setSessionPurpose} = require("../src/sessions/setSessionPurpose");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const failures = [];
const rec = (c, m) => { n++; if (!c) failures.push(m); };
const ok = (c, m) => rec(!!c, m);
const eq = (a, b, m) => rec(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const deq = (a, b, m) => {
  let same = true;
  try { assert.deepStrictEqual(a, b); } catch (e) { same = false; }
  rec(same, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

const DAY = 24 * 3600 * 1000;
const tokenOf = (provider) => ({firebase: {sign_in_provider: provider}});
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const seedOwner = (uid, extra = {}) => db.collection("users").doc(uid).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * DAY), ...extra});
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
// لقطة نصّية لمستند (الأوقات بالمللي ثانية) لمقارنة «لم يُمسّ»
const snapDoc = async (col, id) => JSON.stringify((await getDoc(col, id)).data() || null, (k, v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v));

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
const setPurpose = (uid, sessionId, purpose, defectType, authOverride) => call(() => setSessionPurpose.run({
  data: {sessionId, purpose, ...(defectType !== undefined ? {defectType} : (purpose.startsWith("maintenance_") ? {defectType: "BATTERY"} : {}))},
  auth: authOverride === undefined ? {uid, token: tokenOf("google.com")} : authOverride, rawRequest: {headers: {}},
}));
const purposeLines = (texts) => texts.filter((t) => t.startsWith("[setSessionPurpose] "));
const refusedLines = (texts) => purposeLines(texts).filter((t) => t.startsWith("[setSessionPurpose] refused "));
const pendingOf = async (id) => { const d = await data("protocolPending", id); const {doubleEvalDraw, ...rest} = d || {}; return rest; };

/** رفض جزء المحلّ على المحاكي: الرمز والرسالة وdetails وسطر السجلّ، ولا مسّ للجلسة ولا لـprotocolPending (لقطة قبل/بعد). */
async function expectPartRefusal(label, uid, sessionId, purpose, {part, ownerAbsent = false, defectType} = {}) {
  const sBefore = await snapDoc("scanSessions", sessionId);
  const pBefore = await snapDoc("protocolPending", sessionId);
  const r = await setPurpose(uid, sessionId, purpose, defectType);
  ok(r.threw !== null, `${label}: يُرفض`);
  if (r.threw) deq([r.threw.code, r.threw.message, r.threw.details], ["failed-precondition", "PURPOSE_PART_NOT_ENABLED", {reasonCode: "PURPOSE_PART_NOT_ENABLED"}], `${label}: failed-precondition ورسالته رمزه التقني وdetails.reasonCode`);
  deq(refusedLines(r.texts), [`[setSessionPurpose] refused reason=PURPOSE_PART_NOT_ENABLED session=${sid(sessionId)} caller=${sid(uid)}${ownerAbsent ? " owner=absent" : ""} part=${part}`], `${label}: سطر الرفض المسمّى الوحيد باسم الجزء الناقص${ownerAbsent ? " وowner=absent" : ""}`);
  ok(!r.texts.join("\n").includes(sessionId) && !r.texts.join("\n").includes(uid), `${label}: لا معرّف خامّ في السجلّ`);
  ok((await snapDoc("scanSessions", sessionId)) === sBefore, `${label}: مستند الجلسة لم يُمسّ (لا كتابة)`);
  ok((await snapDoc("protocolPending", sessionId)) === pBefore, `${label}: ومستند protocolPending لم يُمسّ`);
  return r;
}
async function expectAccepted(label, uid, sessionId, purpose, defectType) {
  const r = await setPurpose(uid, sessionId, purpose, defectType);
  ok(r.threw === null, `${label}: يُقبل${r.threw ? ` (رُفض: ${r.threw.message})` : ""}`);
  deq(r.ret, {sessionId, purpose, purposeSource: "selected"}, `${label}: الردّ لم يتغيّر`);
  eq((await data("scanSessions", sessionId)).purpose, purpose, `${label}: الغرض في الجلسة`);
  return r;
}
const reasonOf = (r) => (r.threw && r.threw.details ? r.threw.details.reasonCode : null);
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };

(async () => {
  // ═══ ١ — محلّ بلا protocolParts: maintenance_* مرفوضة بـpart=purposes، وnormal مقبول كما هو ═══
  {
    await seedOwner("own-q31-a");
    const id = (await create("own-q31-a")).ret.sessionId;
    deq(await pendingOf(id), {purposeSource: "feature_disabled"}, "[١] قبل الاختيار: feature_disabled (محلّ بلا الجزء)");
    for (const purpose of ["maintenance_before", "maintenance_after"]) {
      const r = await expectPartRefusal(`[١] محلّ بلا الأجزاء + ${purpose}`, "own-q31-a", id, purpose, {part: "purposes"});
      if (purpose === "maintenance_before") note("setSessionPurpose — رفض جزء المحلّ", refusedLines(r.texts));
    }
    const rn = await expectAccepted("[١] محلّ بلا الأجزاء + normal", "own-q31-a", id, "normal");
    deq(purposeLines(rn.texts), [`[setSessionPurpose] set session=${sid(id)} caller=${sid("own-q31-a")} purpose=normal previous=normal`], "[١] normal: سطر النجاح كما كان (لا تغيّر في سلوكه)");
    deq(await pendingOf(id), {purposeSource: "selected", defectType: null, linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null}, "[١] وnormal يكتب selected ونوعاً null كما كان");
  }

  // ═══ ٢ — الجزء بشكل خاطئ (نصّ «true» · رقم 1 · false · غائب مع الآخر مفعَّل) ⟵ يُرفض ═══
  {
    let i = 0;
    for (const [label, parts] of [["purposes نصّ «true»", {purposes: "true", batteryBeforeAfter: true}], ["purposes رقم 1", {purposes: 1, batteryBeforeAfter: true}], ["purposes false", {purposes: false, batteryBeforeAfter: true}], ["purposes غائب والآخر مفعَّل", {batteryBeforeAfter: true}], ["كل الأجزاء الأخرى بلا purposes", {coldRepeat: true, returns: true, doubleEval: true, consent: true, batteryBeforeAfter: true}]]) {
      const uid = `own-q31-b${i++}`;
      await seedOwner(uid, {protocolParts: parts});
      const id = (await create(uid)).ret.sessionId;
      await expectPartRefusal(`[٢] ${label} + maintenance_before`, uid, id, "maintenance_before", {part: "purposes"});
    }
  }

  // ═══ ٣ — purposes مفعَّل وbatteryBeforeAfter غير مفعَّل (أشكال خاطئة أيضاً) ⟵ normal مقبول وmaintenance_* مرفوضة بـpart=batteryBeforeAfter ═══
  {
    let i = 0;
    for (const [label, parts] of [["batteryBeforeAfter false", {purposes: true, batteryBeforeAfter: false}], ["batteryBeforeAfter غائب", {purposes: true}], ["batteryBeforeAfter نصّ «true»", {purposes: true, batteryBeforeAfter: "true"}], ["batteryBeforeAfter رقم 1", {purposes: true, batteryBeforeAfter: 1}]]) {
      const uid = `own-q31-c${i++}`;
      await seedOwner(uid, {protocolParts: parts});
      const id = (await create(uid)).ret.sessionId;
      await expectAccepted(`[٣] ${label} + normal`, uid, id, "normal");
      for (const purpose of ["maintenance_before", "maintenance_after"]) await expectPartRefusal(`[٣] ${label} + ${purpose}`, uid, id, purpose, {part: "batteryBeforeAfter"});
    }
  }

  // ═══ ٤ — الجزءان مفعَّلان ⟵ الأغراض الثلاثة مقبولة، ويُقبل الاختيار بعد تفعيل الجزء (لا أثر لرفض سابق) ═══
  {
    await seedOwner("own-q31-d", {protocolParts: {purposes: true, batteryBeforeAfter: true}});
    const id = (await create("own-q31-d")).ret.sessionId;
    for (const p of ["maintenance_before", "maintenance_after", "normal"]) await expectAccepted(`[٤] الجزءان مفعَّلان + ${p}`, "own-q31-d", id, p);
    // رفض ثم تفعيل ثم قبول
    await seedOwner("own-q31-d2", {protocolParts: {purposes: true}});
    const id2 = (await create("own-q31-d2")).ret.sessionId;
    await expectPartRefusal("[٤] بلا batteryBeforeAfter", "own-q31-d2", id2, "maintenance_after", {part: "batteryBeforeAfter"});
    await db.collection("users").doc("own-q31-d2").update({"protocolParts.batteryBeforeAfter": true});
    await expectAccepted("[٤] بعد تفعيل الجزء على المحلّ نفسه", "own-q31-d2", id2, "maintenance_after");
    deq((await pendingOf(id2)).defectType, "BATTERY", "[٤] ونوع العطل كُتب في protocolPending بعد القبول");
  }

  // ═══ ٥ — مستند المالك غائب: حالة صريحة بالرمز نفسه (owner=absent)؛ ولا ينشأ مستند المالك ═══
  {
    await seedSession("sess-q31-ghost", {code: "991122", ownerId: "own-q31-ghost", status: "pending", purpose: "normal", createdAt: admin.firestore.Timestamp.now(), expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3600 * 1000)});
    ok(!(await exists("users", "own-q31-ghost")), "[٥] (بذر) لا مستند للمالك");
    await expectPartRefusal("[٥] مستند المالك غائب + maintenance_before", "own-q31-ghost", "sess-q31-ghost", "maintenance_before", {part: "purposes", ownerAbsent: true});
    ok(!(await exists("users", "own-q31-ghost")), "[٥] ولم يُنشأ مستند المالك بالنداء (قراءة وحدها)");
    ok(!(await exists("protocolPending", "sess-q31-ghost")), "[٥] ولا protocolPending (لا كتابة)");
    await expectAccepted("[٥] مستند المالك غائب + normal", "own-q31-ghost", "sess-q31-ghost", "normal");
  }

  // ═══ ٦ — الترتيب مع حالة الجلسة والملكية على المحاكي (الجزء مُطفأ في كلّها) ═══
  {
    await seedOwner("own-q31-e");
    const created = await create("own-q31-e");
    const id = created.ret.sessionId;
    // غير المالك قبل الجزء
    const stranger = await setPurpose("stranger-q31", id, "maintenance_before", undefined, {uid: "stranger-q31", token: tokenOf("google.com")});
    eq(reasonOf(stranger), "SESSION_NOT_PARTICIPANT", "[٦] غير المالك ⟵ SESSION_NOT_PARTICIPANT (قبل الجزء)");
    // الجلسة scanning بعد الانضمام: PURPOSE_SESSION_NOT_PENDING قبل الجزء
    ok((await join(created.ret.code, "anon-q31-e")).threw === null, "[٦] (بذر) انضمّ جهاز: الجلسة scanning");
    const scanning = await setPurpose("own-q31-e", id, "maintenance_before");
    eq(reasonOf(scanning), "PURPOSE_SESSION_NOT_PENDING", "[٦] الجلسة scanning والجزء مُطفأ ⟵ PURPOSE_SESSION_NOT_PENDING (قبل الجزء)");
    deq(refusedLines(scanning.texts), [`[setSessionPurpose] refused reason=PURPOSE_SESSION_NOT_PENDING session=${sid(id)} caller=${sid("own-q31-e")} status=scanning`], "[٦] وسطره بسببه المسمّى لا بالجزء");
    // pending منقضية: «منتهية» تُكتب ثم SESSION_EXPIRED قبل الجزء
    await seedSession("sess-q31-exp", {code: "553311", ownerId: "own-q31-e", status: "pending", purpose: "normal", createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 7200 * 1000), expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 3600 * 1000)});
    const expired = await setPurpose("own-q31-e", "sess-q31-exp", "maintenance_before");
    eq(reasonOf(expired), "SESSION_EXPIRED", "[٦] pending منقضية والجزء مُطفأ ⟵ SESSION_EXPIRED (قبل الجزء)");
    eq((await data("scanSessions", "sess-q31-exp")).status, "expired", "[٦] وكُتبت «منتهية» في المعاملة نفسها");
    // رفض المدخل قبل أيّ قراءة
    await seedOwner("own-q31-f");
    const id3 = (await create("own-q31-f")).ret.sessionId;
    const badType = await setPurpose("own-q31-f", id3, "maintenance_before", "OTHER");
    eq(reasonOf(badType), "DEFECT_TYPE_INVALID", "[٦] نوع عطل فاسد والجزء مُطفأ ⟵ DEFECT_TYPE_INVALID (رفض المدخل أوّلاً، قبل قراءة المالك)");
  }

  // ═══ ٧ — الأجسام: ما يصل العميل بالضبط ═══
  {
    await seedOwner("own-q31-g");
    const id = (await create("own-q31-g")).ret.sessionId;
    const r = await setPurpose("own-q31-g", id, "maintenance_after");
    ok(r.threw !== null && r.threw.constructor && r.threw.constructor.name === "HttpsError", "[٧] الرفض HttpsError");
    if (r.threw) deq(Object.keys(r.threw.details), ["reasonCode"], "[٧] details = reasonCode وحده (لا اسم جزء ولا نصّ تجاري في الجسم؛ الجزء في سجلّ الخادم وحده)");
  }

  for (const t of OBSERVED) console.log(t);
  await admin.app().delete().catch(() => {});
  if (failures.length > 0) {
    console.error(`\nsetSessionPurposePart.e2e.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`setSessionPurposePart.e2e.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(2);
});
