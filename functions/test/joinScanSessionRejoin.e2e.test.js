// E2E test: إعادة انضمام الجهاز نفسه إلى جلسته تُقبل بلا رسالة ولا أثر جانبي (2026-10-10 +03، إصلاح قبل نشر المحطّة ١).
// المعالج الحقيقي عبر `.run()` على محاكي Firestore (القاعدة 37). **الاستبدال الوحيد**: `admin.messaging` بمُرسِل يعدّ ولا يرسل (لا شبكة نحو أيّ مزوّد)؛ و**المراقبان التمريريان**
// (لا يستبدلان شيئاً — يمرّران الطلب الحقيقي إلى المحاكي ويعدّانه): Firestore.prototype.request لعدّ طلبات commit الناجحة التي تكتب مستند الجلسة (مقياس «كتابة انضمام واحدة»
// مستقلّ عن إعادة محاولات المعاملة)، وQuery.prototype.get لحقن تغيّر الحالة بين البحث والمعاملة (كما في scanSessionJoinStates.e2e.test.js).
//
// قرار المستخدم (2026-10-10، بنصّه): ««سبق الانضمام إلى هذه الجلسة»: يُعرض على جهاز آخر فقط. والجهاز المنضمّ نفسه إن أعاد الانضمام (عودة من الإعدادات، أو إعادة مسح) يُقبل بلا رسالة
// ولا أثر جانبي. أثبت بالأداة أن joinScanSession يفعل ذلك اليوم، فإن لم يفعل، فهو إصلاح قبل المحطّة ١، مع اختبار.»
// وجواباه: (١) «The server accepts a re-join from the same uid without a message or side effect: no new joinedAt, no second notification to the owner, the same response.»
// (٢) «Accepted silently only while the session is «scanning» (returning from settings or re-scanning before the scan finishes). After completion: a separate reason code SESSION_COMPLETED with
// the current visible text … Cancelled and expired keep their current refusals.»
//
// ما يثبته:
//   ١ الجهاز نفسه والجلسة scanning ⟵ نجاح بالردّ نفسه؛ updateTime مستند الجلسة لا يتغيّر (ولا joinedAt)؛ ولا طلب commit يكتبه؛ ولا إرسال FCM ثانٍ؛ وسطر rejoined مُهشَّر.
//   ٢ uid آخر على scanning أو completed ⟵ SESSION_ALREADY_JOINED؛ وبلا هوية كذلك. بلا كتابة ولا FCM.
//   ٣ joinerUid الغائب لا يطابق أبداً: من انضمّ بلا هوية يُرفض إن أعاد (بلا هوية أو بهوية) — SESSION_ALREADY_JOINED (القاعدة 22).
//   ٤ الجهاز نفسه بعد completed ⟵ SESSION_COMPLETED بالرمز والنصّ القائمين (not-found «الكود غير صالح أو منتهي الصلاحية»)؛ وجهاز آخر بعد completed ⟵ ALREADY_JOINED.
//   ٥ الملغاة والمنتهية: رفضهما القائم للجهاز نفسه ولغيره.
//   ٦ سباق: نداءان (وثلاثة) متزامنة من الجهاز نفسه على pending ⟵ كلّها نجاح بردّ واحد، **وكتابة انضمام واحدة**، وإشعار FCM واحد.
//   ٧ مرحلة المعاملة بالحقن: تتحوّل الجلسة بين البحث والمعاملة إلى scanning بالجهاز نفسه ⟵ نجاح بلا كتابة (seen=transaction)؛ وإلى completed ⟵ SESSION_COMPLETED؛ وبجهاز آخر ⟵ ALREADY_JOINED.
//   ٨ انقضاء الوقت على إعادة الانضمام (لم يرد في الأمر، يُبلَّغ): scanning منقضية ⟵ SESSION_EXPIRED وتُكتب «منتهية»؛ وبلا expiresAt ⟵ SESSION_EXPIRES_AT_INVALID بلا كتابة.
//   ٩ السجلّ: لا رمز جلسة ولا sessionId ولا uid خامّاً في أيّ سطر؛ ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/joinScanSessionRejoin.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {Firestore, Query} = require("firebase-admin/firestore");
const {admin, db} = require("../src/utils/admin");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {JOIN_REFUSAL: J} = require("../src/sessions/sessionNames");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// النصوص الظاهرة القائمة قبل هذا الإصلاح (joinScanSession.js — JOIN_TEXT) — يجب أن تبقى هي المعروضة: لا نصّ جديد يصل مستخدماً (القرار ٩٠).
const TEXT_GENERIC = "الكود غير صالح أو منتهي الصلاحية";
const TEXT_EXPIRED = "انتهت صلاحية الكود";
const TEXT_RACE = "الجلسة ليست متاحة للانضمام";
const TEXT_SESSION_INVALID = "جلسة الفحص غير صالحة";

const OWNER = "owner-uid-rejoin-0001";
const DEV_A = "device-anon-uid-rejoin-000A";
const DEV_B = "device-anon-uid-rejoin-000B";
const FUTURE = () => new Date(Date.now() + 30 * 60 * 1000);
const PAST = () => new Date(Date.now() - 30 * 60 * 1000);
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});

// ─── المراقبان والمُرسِل ───────────────────────────────────────────────────────────────────────────────────────
const fcmSent = [];
Object.defineProperty(admin, "messaging", {
  configurable: true,
  value: () => ({send: async (message) => { fcmSent.push(message); return "projects/demo-nc/messages/stub"; }}),
});
const committedDocs = []; // أسماء المستندات المكتوبة بطلبات commit الناجحة (كاملة: projects/…/documents/scanSessions/<id>)
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
const commitsTo = (sessionId) => committedDocs.filter((d) => d.endsWith(`/scanSessions/${sessionId}`)).length;
const fcmFor = (sessionId) => fcmSent.filter((m) => m.data && m.data.sessionId === sessionId).length;

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function join(code, auth, {capturing = true} = {}) {
  const cap = capturing ? capture() : null;
  let ret = null;
  let threw = null;
  try {
    ret = await joinScanSession.run({data: {code}, auth, rawRequest: {headers: {}}});
  } catch (e) {
    threw = e;
  } finally {
    if (cap) cap.restore();
  }
  return {ret, threw, lines: cap ? cap.lines : []};
}
const seed = (id, fields) => db.collection("scanSessions").doc(id).set({ownerId: OWNER, ...fields});
const snapOf = (id) => db.collection("scanSessions").doc(id).get();
const refusedLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] refused "));
const rejoinedLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] rejoined "));
const evalLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] evaluationEnabled="));

/** رفض بالرمز والنصّ الظاهرين وrefused-line واحد بالسبب. */
function expectRefusal(res, {code, message, reasonCode}, label) {
  ok(res.threw !== null && res.ret === null, `${label}: رُفض`);
  eq(res.threw.code, code, `${label}: رمز HttpsError الظاهر (${code})`);
  eq(res.threw.message, message, `${label}: النصّ الظاهر`);
  deq(res.threw.details, {reasonCode}, `${label}: details = {reasonCode: ${reasonCode}} وحده`);
  const lines = refusedLines(res.lines);
  eq(lines.length, 1, `${label}: سطر رفض واحد في السجلّ`);
  ok(lines[0].startsWith(`[joinScanSession] refused reason=${reasonCode} `), `${label}: سطر الرفض بالسبب المسمّى`);
  eq(rejoinedLines(res.lines).length, 0, `${label}: ولا سطر rejoined لمرفوض`);
  eq(evalLines(res.lines).length, 0, `${label}: ولا سطر evaluationEnabled لمرفوض`);
}
/** لا أثر جانبي: الجلسة كما كانت بالبايت (updateTime والبيانات)، ولا commit كتب مستندها، ولا FCM. */
async function expectNoSideEffect(id, before, commitsBefore, fcmBefore, label) {
  const after = await snapOf(id);
  ok(after.updateTime.isEqual(before.updateTime), `${label}: updateTime مستند الجلسة لم يتغيّر`);
  deq(after.data(), before.data(), `${label}: بيانات الجلسة كما كانت (لا joinedAt جديد ولا status ولا غيرهما)`);
  eq(commitsTo(id), commitsBefore, `${label}: لا طلب commit ناجح كتب مستند الجلسة`);
  eq(fcmFor(id), fcmBefore, `${label}: ولا إرسال FCM`);
}

(async () => {
  ok(db instanceof Firestore, "[٠] db هو Firestore الذي يراقبه المراقب (المراقب يرى كتابات هذه العملية)");
  await db.collection("users").doc(OWNER).set({language: "ar", evaluationEnabled: true, fcmToken: "stub-fcm-token-not-a-real-token"});

  // ═══ ١ — الجهاز نفسه والجلسة scanning ═══
  {
    const ID = "sess-rejoin-1";
    const CODE = "NC-RJOIN01";
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    const seeded = commitsTo(ID); // الزرع نفسه commit — الأعداد أدناه نسبةً إليه
    const first = await join(CODE, authAnon(DEV_A));
    ok(first.threw === null, "[١] الانضمام الأوّل ينجح");
    deq(first.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: true, consentEnabled: false}, "[١] ردّ الانضمام الأوّل (ق15: + consentEnabled=false، المالك بلا protocolParts)");
    // شواهد أن المراقبَين يريان (لئلّا يكون «صفر» لاحقاً غياب رؤية لا غياب أثر — القاعدة 22)
    eq(fcmFor(ID), 1, "[١] المراقب يرى إشعار FCM الأوّل (واحد)");
    eq(commitsTo(ID), seeded + 1, "[١] والمراقب يرى كتابة الانضمام الأوّل (طلب commit واحد يكتب مستند الجلسة بعد الزرع)");
    ok(evalLines(first.lines).length === 1 && refusedLines(first.lines).length === 0 && rejoinedLines(first.lines).length === 0, "[١] سطر evaluationEnabled واحد للأوّل، وبلا refused ولا rejoined");
    eq(fcmSent[fcmSent.length - 1].token, "stub-fcm-token-not-a-real-token", "[١] والإشعار الأوّل لمالك الجلسة");
    const before = await snapOf(ID);
    const d0 = before.data();
    eq(d0.status, "scanning", "[١] الجلسة scanning");
    eq(d0.joinedBy, DEV_A, "[١] وjoinedBy = الجهاز المنضمّ");
    ok(d0.joinedAt && typeof d0.joinedAt.toMillis === "function", "[١] وjoinedAt مكتوب");

    for (const [label, codeArg] of [["إعادة أولى", CODE], ["إعادة ثانية (الرمز بأحرف صغيرة)", CODE.toLowerCase()], ["إعادة ثالثة", CODE]]) {
      const r = await join(codeArg, authAnon(DEV_A));
      ok(r.threw === null, `[١] ${label}: تنجح`);
      deq(r.ret, first.ret, `[١] ${label}: الردّ نفسه تماماً (sessionId وownerId وstatus وevaluationEnabled)`);
      deq(Object.keys(r.ret), Object.keys(first.ret), `[١] ${label}: ومفاتيح الردّ بالترتيب نفسه`);
      await expectNoSideEffect(ID, before, seeded + 1, 1, `[١] ${label}`);
      eq(refusedLines(r.lines).length, 0, `[١] ${label}: ولا سطر رفض`);
      const rj = rejoinedLines(r.lines);
      eq(rj.length, 1, `[١] ${label}: سطر rejoined مسمّى واحد`);
      eq(rj[0], `[joinScanSession] rejoined seen=lookup session=${hashIdForLog(ID)} owner=${hashIdForLog(OWNER)} joiner=${hashIdForLog(DEV_A)}`, `[١] ${label}: السطر بمعرّفات مُهشَّرة وموضع الرؤية (lookup: الجلسة كانت scanning عند البحث)`);
      eq(evalLines(r.lines).length, 1, `[١] ${label}: وسطر evaluationEnabled القائم لما أُعيد (قيمة في الردّ)`);
      ok(!r.lines.some((l) => l.includes("no fcmToken")), `[١] ${label}: ولا تحذير «no fcmToken» (مسار الإشعار لم يُسلَك أصلاً)`);
      const all = r.lines.join("\n");
      ok(![ID, DEV_A, OWNER, CODE, CODE.toLowerCase()].some((v) => all.includes(v)), `[١] ${label}: لا sessionId ولا uid ولا ownerId ولا رمز جلسة خامّاً في أيّ سطر`);
    }
    // evaluationEnabled من حساب المالك الحالي (قراءة طازجة) — لا يُخزَّن في الجلسة
    await db.collection("users").doc(OWNER).update({evaluationEnabled: false});
    const afterToggle = await join(CODE, authAnon(DEV_A));
    eq(afterToggle.ret.evaluationEnabled, false, "[١] evaluationEnabled من حساب المالك لحظة الاستدعاء (لا نسخة قديمة)");
    deq({...afterToggle.ret, evaluationEnabled: true}, first.ret, "[١] وما عداها من الردّ نفسه");
    await db.collection("users").doc(OWNER).update({evaluationEnabled: true});
    await expectNoSideEffect(ID, before, seeded + 1, 1, "[١] بعد تبديل علم المالك");
  }

  // ═══ ٢ — جهاز آخر، وبلا هوية: SESSION_ALREADY_JOINED ═══
  for (const status of ["scanning", "completed"]) {
    const ID = `sess-rejoin-2-${status}`;
    const CODE = `NC-RJ2${status.slice(0, 3).toUpperCase()}`;
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    ok((await join(CODE, authAnon(DEV_A))).threw === null, `[٢] ${status}: انضمّ الجهاز A`);
    if (status === "completed") await db.collection("scanSessions").doc(ID).update({status: "completed", scanId: "scan-2"});
    const before = await snapOf(ID);
    const c0 = commitsTo(ID);
    const f0 = fcmFor(ID);
    const other = await join(CODE, authAnon(DEV_B));
    expectRefusal(other, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, `[٢] ${status} / جهاز آخر (B)`);
    const anon = await join(CODE, null);
    expectRefusal(anon, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, `[٢] ${status} / بلا هوية`);
    ok(/ joiner=missing$| joiner=missing /.test(refusedLines(anon.lines)[0]), `[٢] ${status} / بلا هوية: joiner=missing صريحة في السجلّ`);
    await expectNoSideEffect(ID, before, c0, f0, `[٢] ${status}`);
    eq((await snapOf(ID)).data().joinedBy, DEV_A, `[٢] ${status}: المنضمّ الأوّل باقٍ`);
  }

  // ═══ ٣ — joinerUid الغائب لا يطابق أبداً ═══
  {
    const ID = "sess-rejoin-3";
    const CODE = "NC-RJ3NOID";
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    const first = await join(CODE, null);
    ok(first.threw === null && first.ret.status === "scanning", "[٣] الانضمام بلا هوية ينجح كما كان");
    eq((await snapOf(ID)).data().joinedBy, null, "[٣] وjoinedBy = null (لا يُبتدَع معرّف)");
    const before = await snapOf(ID);
    const c0 = commitsTo(ID);
    const f0 = fcmFor(ID);
    const again = await join(CODE, null);
    expectRefusal(again, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[٣] إعادة بلا هوية بعد انضمام بلا هوية: لا «null == null»");
    const withUid = await join(CODE, authAnon(DEV_A));
    expectRefusal(withUid, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[٣] وبهوية بعد انضمام بلا هوية: لا يطابق");
    await expectNoSideEffect(ID, before, c0, f0, "[٣]");
    // وauth بلا uid نصّي (قيم غائبة) لا يطابق كذلك
    for (const [label, auth] of [["auth بلا uid", {token: {}}], ["uid فارغ", {uid: "", token: {}}]]) {
      const r = await join(CODE, auth);
      expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, `[٣] ${label}`);
    }
    // ومنضمّ بهوية، مستدعٍ بلا هوية: لا يطابق (الاتجاه المعاكس)
    const ID2 = "sess-rejoin-3b";
    await seed(ID2, {code: "NC-RJ3WITH", status: "pending", expiresAt: FUTURE(), scanId: null});
    ok((await join("NC-RJ3WITH", authAnon(DEV_A))).threw === null, "[٣] انضمّ A بهوية");
    expectRefusal(await join("NC-RJ3WITH", null), {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[٣] إعادة بلا هوية لجلسة منضمّها A: ALREADY_JOINED");
  }

  // ═══ ٤ — الجهاز نفسه بعد completed: SESSION_COMPLETED ═══
  {
    const ID = "sess-rejoin-4";
    const CODE = "NC-RJ4DONE";
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    ok((await join(CODE, authAnon(DEV_A))).threw === null, "[٤] انضمّ الجهاز A");
    await db.collection("scanSessions").doc(ID).update({status: "completed", scanId: "scan-4"});
    const before = await snapOf(ID);
    const c0 = commitsTo(ID);
    const f0 = fcmFor(ID);
    const same = await join(CODE, authAnon(DEV_A));
    expectRefusal(same, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.COMPLETED}, "[٤] الجهاز نفسه بعد الاكتمال");
    eq(J.COMPLETED, "SESSION_COMPLETED", "[٤] الرمز من المصدر الواحد: SESSION_COMPLETED");
    ok(/ stage=lookup /.test(refusedLines(same.lines)[0]) && refusedLines(same.lines)[0].includes(` session=${hashIdForLog(ID)} `), "[٤] السجلّ: المرحلة lookup ومعرّف الجلسة مُهشَّراً");
    ok(refusedLines(same.lines)[0].includes(` joiner=${hashIdForLog(DEV_A)}`), "[٤] والمنضمّ مُهشَّراً");
    await expectNoSideEffect(ID, before, c0, f0, "[٤]");
    const other = await join(CODE, authAnon(DEV_B));
    expectRefusal(other, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[٤] جهاز آخر بعد الاكتمال: ALREADY_JOINED (لا يُكشف له أنه «مكتمل»)");
    ok(J.COMPLETED !== J.ALREADY_JOINED, "[٤] ورمزا الحالتين متمايزان");
  }

  // ═══ ٥ — الملغاة والمنتهية: رفضهما القائم، للجهاز نفسه ولغيره ═══
  for (const [status, expected, extra] of [
    ["cancelled", {code: "not-found", message: TEXT_GENERIC, reasonCode: J.CANCELLED}, {cancelReason: "left_by_customer"}],
    ["expired", {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, {}],
  ]) {
    const ID = `sess-rejoin-5-${status}`;
    const CODE = `NC-RJ5${status.slice(0, 3).toUpperCase()}`;
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    ok((await join(CODE, authAnon(DEV_A))).threw === null, `[٥] ${status}: انضمّ الجهاز A`);
    await db.collection("scanSessions").doc(ID).update({status, ...extra});
    const before = await snapOf(ID);
    const c0 = commitsTo(ID);
    const f0 = fcmFor(ID);
    expectRefusal(await join(CODE, authAnon(DEV_A)), expected, `[٥] ${status} / الجهاز نفسه`);
    expectRefusal(await join(CODE, authAnon(DEV_B)), expected, `[٥] ${status} / جهاز آخر`);
    expectRefusal(await join(CODE, null), expected, `[٥] ${status} / بلا هوية`);
    await expectNoSideEffect(ID, before, c0, f0, `[٥] ${status}`);
  }

  // ═══ ٦ — سباق: نداءات متزامنة من الجهاز نفسه على pending ═══
  {
    const seenDistribution = {lookup: 0, transaction: 0};
    for (let round = 1; round <= 6; round++) {
      const parties = round <= 3 ? 2 : 3; // ثلاث جولات بنداءين، وثلاث بثلاثة
      const ID = `sess-rejoin-race-${round}`;
      const CODE = `NC-RJRACE${round}`;
      await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
      const seeded = commitsTo(ID);
      const cap = capture(); // التقاط واحد حول كل النداءات المتزامنة (التقاطان متداخلان يتركان console مبتوراً)
      let results;
      try {
        results = await Promise.all(Array.from({length: parties}, () => join(CODE, authAnon(DEV_A), {capturing: false})));
      } finally {
        cap.restore();
      }
      const label = `[٦] جولة ${round} (${parties} نداءات)`;
      ok(results.every((r) => r.threw === null), `${label}: كلّها نجاح (لا رفض لمن خسر السباق — كان يُرفض SESSION_ALREADY_JOINED)`);
      for (const r of results) deq(r.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: true, consentEnabled: false}, `${label}: الردّ نفسه لكلّ نداء (ق15: + consentEnabled=false)`);
      eq(commitsTo(ID), seeded + 1, `${label}: **كتابة انضمام واحدة** على مستند الجلسة (طلب commit ناجح واحد يكتبه بعد الزرع — مهما أعادت المعاملة محاولتها)`);
      eq(fcmFor(ID), 1, `${label}: وإشعار FCM واحد للمالك`);
      eq(cap.lines.filter((l) => l.startsWith("[joinScanSession] refused ")).length, 0, `${label}: ولا سطر رفض`);
      const rj = rejoinedLines(cap.lines);
      eq(rj.length, parties - 1, `${label}: وكلّ من لم يكتب الانضمام سطره rejoined (${parties - 1})`);
      for (const line of rj) {
        const m = /^\[joinScanSession\] rejoined seen=(lookup|transaction) session=(#[0-9a-f]+) owner=(#[0-9a-f]+) joiner=(#[0-9a-f]+)$/.exec(line);
        ok(m !== null, `${label}: شكل سطر rejoined`);
        seenDistribution[m[1]]++;
      }
      eq(evalLines(cap.lines).length, parties, `${label}: وسطر evaluationEnabled لكلّ نداء ناجح (${parties})`);
      const s = (await snapOf(ID)).data();
      ok(s.status === "scanning" && s.joinedBy === DEV_A && s.joinedAt && typeof s.joinedAt.toMillis === "function", `${label}: والجلسة scanning بمنضمّها وjoinedAt مكتوب مرّة`);
      const all = cap.lines.join("\n");
      ok(![ID, DEV_A, OWNER, CODE].some((v) => all.includes(v)), `${label}: لا معرّف خامّ في السجلّ`);
    }
    console.log(`[٦] موضع رؤية scanning بمنضمّها عند الخاسرين: ${JSON.stringify(seenDistribution)}`);
  }

  // ═══ ٧ — مرحلة المعاملة بالحقن: تتحوّل الجلسة بين البحث والمعاملة ═══
  {
    const origGet = Query.prototype.get;
    /** يحقن حقول `inject` في مستند الجلسة بعد أوّل استعلام (يراه البحث pending) وقبل المعاملة. */
    async function joinWithInjection(id, code, inject, auth) {
      let injected = false;
      Query.prototype.get = async function patchedGet(...args) {
        const snap = await origGet.apply(this, args);
        if (!injected) {
          injected = true;
          await db.collection("scanSessions").doc(id).update(inject);
        }
        return snap;
      };
      let r;
      try {
        r = await join(code, auth);
      } finally {
        Query.prototype.get = origGet;
      }
      ok(injected, `[٧] ${id}: حُقن التغيّر بعد البحث`);
      return r;
    }
    // (أ) الجهاز نفسه: صارت scanning بمنضمّها بين البحث والمعاملة (ضغطتان) ⟵ نجاح بلا كتابة (seen=transaction)
    {
      const ID = "sess-rejoin-7a";
      const CODE = "NC-RJ7A";
      await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
      const seeded = commitsTo(ID);
      const injectFields = {status: "scanning", joinedBy: DEV_A, joinedAt: new Date(Date.now() - 1000)};
      const r = await joinWithInjection(ID, CODE, injectFields, authAnon(DEV_A));
      ok(r.threw === null, "[٧أ] الجهاز نفسه: صارت scanning بمنضمّها بين البحث والمعاملة ⟵ نجاح");
      deq(r.ret, {sessionId: ID, ownerId: OWNER, status: "scanning", evaluationEnabled: true, consentEnabled: false}, "[٧أ] الردّ نفسه (ق15: + consentEnabled=false)");
      eq(commitsTo(ID), seeded + 1, "[٧أ] لم يُكتب مستند الجلسة بعد الزرع إلا مرّة واحدة — **الحقن نفسه**؛ فلا كتابة من هذا النداء");
      eq(fcmFor(ID), 0, "[٧أ] ولا FCM من هذا النداء");
      const rj = rejoinedLines(r.lines);
      eq(rj.length, 1, "[٧أ] سطر rejoined واحد");
      ok(rj[0].startsWith("[joinScanSession] rejoined seen=transaction "), "[٧أ] seen=transaction: رُئيت scanning في المعاملة لا في البحث");
      const s = (await snapOf(ID)).data();
      eq(s.joinedBy, DEV_A, "[٧أ] وjoinedBy كما حُقن");
      eq(s.joinedAt.toMillis(), injectFields.joinedAt.getTime(), "[٧أ] وjoinedAt كما حُقن (لم يُكتب فوقه joinedAt جديد)");
    }
    // (ب) جهاز آخر في الحقن نفسه ⟵ ALREADY_JOINED في مرحلة المعاملة بالنصّ القائم لتغيّر الحالة
    {
      const ID = "sess-rejoin-7b";
      const CODE = "NC-RJ7B";
      await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
      const r = await joinWithInjection(ID, CODE, {status: "scanning", joinedBy: DEV_A, joinedAt: new Date()}, authAnon(DEV_B));
      expectRefusal(r, {code: "failed-precondition", message: TEXT_RACE, reasonCode: J.ALREADY_JOINED}, "[٧ب] جهاز آخر: صارت scanning بمنضمّ غيره");
      ok(/ stage=transaction /.test(refusedLines(r.lines)[0]), "[٧ب] المرحلة transaction");
      eq((await snapOf(ID)).data().joinedBy, DEV_A, "[٧ب] المنضمّ الأوّل باقٍ");
    }
    // (ج) الجهاز نفسه: صارت completed ⟵ SESSION_COMPLETED في المعاملة؛ وصارت cancelled/expired ⟵ رفضهما القائم
    for (const [status, expected] of [
      ["completed", {code: "failed-precondition", message: TEXT_RACE, reasonCode: J.COMPLETED}],
      ["cancelled", {code: "failed-precondition", message: TEXT_RACE, reasonCode: J.CANCELLED}],
      ["expired", {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}],
    ]) {
      const ID = `sess-rejoin-7c-${status}`;
      const CODE = `NC-RJ7C${status.slice(0, 3).toUpperCase()}`;
      await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
      const r = await joinWithInjection(ID, CODE, {status, joinedBy: DEV_A}, authAnon(DEV_A));
      expectRefusal(r, expected, `[٧ج] الجهاز نفسه: صارت ${status} بين البحث والمعاملة`);
      ok(/ stage=transaction /.test(refusedLines(r.lines)[0]), `[٧ج] ${status}: المرحلة transaction`);
      eq((await snapOf(ID)).data().status, status, `[٧ج] ${status}: الحالة المحقونة باقية`);
    }
  }

  // ═══ ٨ — انقضاء الوقت على إعادة الانضمام (لم يرد في الأمر؛ يُبلَّغ) ═══
  {
    const ID = "sess-rejoin-8a";
    const CODE = "NC-RJ8EXP";
    await seed(ID, {code: CODE, status: "pending", expiresAt: FUTURE(), scanId: null});
    ok((await join(CODE, authAnon(DEV_A))).threw === null, "[٨] انضمّ الجهاز A");
    await db.collection("scanSessions").doc(ID).update({expiresAt: PAST()});
    const r = await join(CODE, authAnon(DEV_A));
    expectRefusal(r, {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, "[٨] scanning منقضية الوقت: SESSION_EXPIRED بالرمز والنصّ القائمين للانتهاء (كما لـpending منقضية)");
    ok(/ expiredRecorded=true$/.test(refusedLines(r.lines)[0]), "[٨] والسجلّ: expiredRecorded=true");
    const s = (await snapOf(ID)).data();
    eq(s.status, "expired", "[٨] وتُكتب «منتهية» (قرار المستخدم ٢: عند مسّ الجلسة بعد انقضاء وقتها)");
    ok(s.expiredAt && typeof s.expiredAt.toMillis === "function", "[٨] وexpiredAt مكتوب");
    eq(s.joinedBy, DEV_A, "[٨] وjoinedBy لم يُمسّ");
    eq(fcmFor(ID), 1, "[٨] ولا FCM إضافي (الأوّل فقط)");
    // وبعدها: المحاولة التالية رفض «منتهية» المسجَّلة بالنصّ القائم للانتهاء
    expectRefusal(await join(CODE, authAnon(DEV_A)), {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, "[٨] وبعد تسجيلها: رفض المنتهية القائم");
  }
  for (const [label, fields] of [["expiresAt غائب", {}], ["expiresAt تالف", {expiresAt: "not-a-date"}]]) {
    const ID = `sess-rejoin-8b-${label.length}`;
    const CODE = `NC-RJ8B${label.length}`;
    // جلسة scanning بمنضمّها (مزروعة مباشرةً — بلا حذف حقل من مستند)، وexpiresAt غائب أو تالف
    await seed(ID, {code: CODE, status: "scanning", joinedBy: DEV_A, joinedAt: new Date(), scanId: null, ...fields});
    const before = await snapOf(ID);
    const c0 = commitsTo(ID);
    const f0 = fcmFor(ID);
    expectRefusal(await join(CODE, authAnon(DEV_A)), {code: "permission-denied", message: TEXT_SESSION_INVALID, reasonCode: J.EXPIRES_AT_INVALID}, `[٨] ${label}`);
    await expectNoSideEffect(ID, before, c0, f0, `[٨] ${label}: بلا كتابة`);
  }

  // ═══ ٩ — لا حذف ═══
  for (const id of ["sess-rejoin-1", "sess-rejoin-2-scanning", "sess-rejoin-2-completed", "sess-rejoin-3", "sess-rejoin-4", "sess-rejoin-5-cancelled", "sess-rejoin-5-expired", "sess-rejoin-race-1", "sess-rejoin-8a"]) {
    ok((await snapOf(id)).exists, `[٩] مستند ${id} موجود (لا حذف)`);
  }
  ok(committedDocs.every((d) => d.includes("/documents/")), "[٩] والمراقب لم يرَ إلا كتابات مستندات");

  Firestore.prototype.request = realRequest;
  console.log(`\nALL PASS (${n} assertions) — commits observed on session docs: ${committedDocs.filter((d) => d.includes("/scanSessions/")).length}, FCM stub sends: ${fcmSent.length}`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
