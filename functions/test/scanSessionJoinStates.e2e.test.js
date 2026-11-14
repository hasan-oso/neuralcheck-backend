// E2E test: joinScanSession تميّز «رمز غير صالح» من «انضُمّ إليها» من «ملغاة» من «منتهية» (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03).
// المعالج الحقيقي عبر `.run()` على محاكي Firestore، بلا استبدال أيّ طبقة (القاعدة 37).
//
// خطّة PLAN-05 (PLAN-05-EVIDENCE-REPORT.md:530، بنصّها منقولاً من أمر المنسّق): «تمييز «جلسة انضُمّ إليها» من «رمز غير صالح» في الخادم: اليوم not-found واحد للحالتين.»
// أمر المنسّق: ««رمز غير صالح» و«انضُمّ إليها» و«ملغاة» و«منتهية»، كلٌّ برمز مسمّى من مصدر واحد (القاعدة 24) في `details`. ونصّ «انضُمّ إليها» بالعربية والتركية
// «مقترح للاعتماد» (القرار ٩٠)… ولا يصل إلى مستخدم قبل اعتماد المستخدم. فإن احتاج الكود نصّاً الآن، فالنصّ القائم «الكود غير صالح أو منتهي الصلاحية» يبقى معروضاً،
// والرمز المسمّى هو ما يميّز.»  وأمر المنسّق: «والغياب حالة صريحة (القاعدة 22): جلسة بلا expiresAt لا تُقرأ «صالحة».»
// قرار المستخدم (2026-10-10): «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
//
// ما يثبته:
//   ١ الحالات الأربع (+ الغياب): الرمز في details.reasonCode من مصدر واحد، **والنصّ والرمز الظاهران للتطبيق كما كانا حرفياً** (not-found + «الكود غير صالح أو منتهي الصلاحية»
//     للثلاثة الأولى، وdeadline-exceeded + «انتهت صلاحية الكود» للمنتهية) — لا نصّ جديد يصل مستخدماً.
//   ٢ الانتهاء يُكتب عند المسّ: pending منقضية ⇒ تُرفض وتُكتب في مستندها status=expired وexpiredAt (كانت الكتابة داخل معاملة ترمي فتُسقَط)، ولا joinedBy.
//   ٣ الغياب: expiresAt غائب أو تالف ⇒ «جلسة الفحص غير صالحة» (permission-denied) بلا كتابة، لا انضمام (كان ينضمّ بلا حدّ).
//   ٤ الحالات غير المعروفة (غائبة، «done») ⇒ SESSION_STATUS_UNKNOWN، لا تسقط إلى «انضُمّ إليها».
//   ٥ الرمز المتكرّر: pending جديدة بجانب جلسة قديمة بالرمز نفسه ⇒ تنضمّ للـpending؛ وجلستان غير pending ⇒ تُحكَم الأحدث إنشاءً.
//   ٦ سباق حقيقي: انضمامان متزامنان ⇒ واحد ينجح، والآخر يحمل SESSION_ALREADY_JOINED؛ وحقن تغيّر الحالة بين البحث والمعاملة (مسار المعاملة).
//   ٧ السجلّ: سطر `[joinScanSession] refused reason=…` لكلّ رفض بسبب مسمّى ومعرّفات مُهشَّرة، ولا رمز جلسة ولا معرّف خامّ؛ ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/scanSessionJoinStates.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {admin, db} = require("../src/utils/admin");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {JOIN_REFUSAL: J} = require("../src/sessions/sessionNames");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// النصوص القائمة قبل هذه الدفعة (joinScanSession.js:25 و:42 و:46 عند 83d7750) — يجب أن تبقى هي المعروضة.
const TEXT_GENERIC = "الكود غير صالح أو منتهي الصلاحية";
const TEXT_EXPIRED = "انتهت صلاحية الكود";
const TEXT_RACE = "الجلسة ليست متاحة للانضمام";
const TEXT_SESSION_INVALID = "جلسة الفحص غير صالحة";

const OWNER = "owner-uid-join-states-0001";
const JOINER = "joiner-anon-uid-join-states-0002";
const JOINER_B = "joiner-anon-uid-join-states-0003";
const FUTURE = () => new Date(Date.now() + 20 * 60 * 1000);
const PAST = () => new Date(Date.now() - 20 * 60 * 1000);
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});

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
const get = async (id) => (await db.collection("scanSessions").doc(id).get()).data();
const refusedLines = (lines) => lines.filter((l) => l.startsWith("[joinScanSession] refused "));
function expectRefusal(res, {code, message, reasonCode}, label) {
  ok(res.threw !== null && res.ret === null, `${label}: رُفض`);
  eq(res.threw.code, code, `${label}: رمز HttpsError الظاهر كما كان (${code})`);
  eq(res.threw.message, message, `${label}: النصّ الظاهر كما كان`);
  deq(res.threw.details, {reasonCode}, `${label}: details = {reasonCode: ${reasonCode}} وحده`);
  const lines = refusedLines(res.lines);
  eq(lines.length, 1, `${label}: سطر رفض واحد في السجلّ`);
  ok(lines[0].startsWith(`[joinScanSession] refused reason=${reasonCode} `), `${label}: سطر الرفض بالسبب المسمّى`);
}

(async () => {
  await db.collection("users").doc(OWNER).set({language: "ar", evaluationEnabled: false});

  // ═══ ١ — الحالات الأربع ═══
  {
    const r = await join("NC-NO-SUCH", authAnon(JOINER));
    expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.CODE_INVALID}, "[١] رمز غير صالح");
    ok(/ stage=lookup /.test(refusedLines(r.lines)[0]) && !/ session=/.test(refusedLines(r.lines)[0]), "[١] رمز غير صالح: المرحلة lookup وبلا معرّف جلسة (لا جلسة)");
  }
  {
    await seed("sess-joined", {code: "NC-JOINED", status: "scanning", expiresAt: FUTURE(), joinedBy: JOINER_B});
    const r = await join("NC-JOINED", authAnon(JOINER));
    expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[١] انضُمّ إليها (scanning)");
    const s = await get("sess-joined");
    ok(s.status === "scanning" && s.joinedBy === JOINER_B, "[١] انضُمّ إليها: الجلسة كما كانت (المنضمّ الأوّل باقٍ)");
    ok(new RegExp(` session=${hashIdForLog("sess-joined").replace("#", "#")} `).test(refusedLines(r.lines)[0]), "[١] وسطر الرفض يحمل معرّف الجلسة مُهشَّراً");
  }
  {
    await seed("sess-done", {code: "NC-DONE01", status: "completed", expiresAt: FUTURE(), joinedBy: JOINER_B, scanId: "scan-x"});
    const r = await join("nc-done01", authAnon(JOINER)); // بأحرف صغيرة: يُحوَّل كما كان
    expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[١] انضُمّ إليها (completed، الرمز بأحرف صغيرة)");
  }
  {
    await seed("sess-cancelled", {code: "NC-CANCEL1", status: "cancelled", expiresAt: FUTURE(), cancelReason: "cancelled_by_owner"});
    const before = await get("sess-cancelled");
    const r = await join("NC-CANCEL1", authAnon(JOINER));
    expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.CANCELLED}, "[١] ملغاة");
    deq(await get("sess-cancelled"), before, "[١] ملغاة: المستند لم يتغيّر");
  }
  {
    await seed("sess-expired", {code: "NC-EXPIRD1", status: "expired", expiresAt: PAST()});
    const r = await join("NC-EXPIRD1", authAnon(JOINER));
    expectRefusal(r, {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, "[١] منتهية (مسجَّلة)");
  }
  eq(J.CODE_INVALID, "SESSION_CODE_INVALID", "[١] والرموز من المصدر الواحد: رمز غير صالح");
  eq(J.ALREADY_JOINED, "SESSION_ALREADY_JOINED", "[١] انضُمّ إليها");
  eq(J.CANCELLED, "SESSION_CANCELLED", "[١] ملغاة");
  eq(J.EXPIRED, "SESSION_EXPIRED", "[١] منتهية");

  // ═══ ٢ — الانتهاء يُكتب عند المسّ ═══
  {
    const expiresAt = PAST();
    await seed("sess-touch", {code: "NC-TOUCH01", status: "pending", expiresAt, scanId: null});
    const r = await join("NC-TOUCH01", authAnon(JOINER));
    expectRefusal(r, {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, "[٢] pending منقضية");
    ok(/ stage=transaction /.test(refusedLines(r.lines)[0]), "[٢] المرحلة transaction");
    const s = await get("sess-touch");
    eq(s.status, "expired", "[٢] كُتبت «منتهية» في مستندها (قبل الإصلاح كانت الكتابة داخل معاملة ترمي فتُسقَط ويبقى pending)");
    ok(s.expiredAt && typeof s.expiredAt.toMillis === "function" && Math.abs(s.expiredAt.toMillis() - Date.now()) < 60000, "[٢] وexpiredAt وقت التسجيل");
    eq(s.expiresAt.toMillis(), expiresAt.getTime(), "[٢] وexpiresAt لم يتغيّر");
    ok(!("joinedBy" in s) && !("joinedAt" in s), "[٢] ولا joinedBy ولا joinedAt (لم ينضمّ أحد)");
    const again = await join("NC-TOUCH01", authAnon(JOINER));
    expectRefusal(again, {code: "deadline-exceeded", message: TEXT_EXPIRED, reasonCode: J.EXPIRED}, "[٢] المحاولة الثانية بالرمز نفسه (صارت مسجَّلة): الرمز والنصّ نفسهما");
    ok(/ stage=lookup /.test(refusedLines(again.lines)[0]), "[٢] والمرحلة هذه المرّة lookup (لا pending بعد الآن)");
  }

  // ═══ ٣ — الغياب حالة صريحة ═══
  for (const [label, fields] of [["غائب", {}], ["null", {expiresAt: null}], ["نصّ تالف", {expiresAt: "not-a-date"}], ["كائن بلا toDate", {expiresAt: {seconds: 5}}]]) {
    const id = `sess-noexp-${label.replace(/\s/g, "_")}`;
    const code = `NC-NOEXP${label.length}`;
    await seed(id, {code, status: "pending", ...fields});
    const before = await get(id);
    const r = await join(code, authAnon(JOINER));
    expectRefusal(r, {code: "permission-denied", message: TEXT_SESSION_INVALID, reasonCode: J.EXPIRES_AT_INVALID}, `[٣] expiresAt ${label}`);
    deq(await get(id), before, `[٣] expiresAt ${label}: المستند لم يتغيّر (لا انضمام ولا «منتهية»)`);
  }

  // ═══ ٤ — الحالات غير المعروفة ═══
  {
    await seed("sess-nostatus", {code: "NC-NOSTAT", expiresAt: FUTURE()});
    const r = await join("NC-NOSTAT", authAnon(JOINER));
    expectRefusal(r, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.STATUS_UNKNOWN}, "[٤] حالة غائبة");
    ok(/ statusState=ABSENT$/.test(refusedLines(r.lines)[0]), "[٤] والسجلّ يسمّي حالة الغياب (statusState=ABSENT)");
    await seed("sess-weird", {code: "NC-WEIRD01", status: "done", expiresAt: FUTURE()});
    const r2 = await join("NC-WEIRD01", authAnon(JOINER));
    expectRefusal(r2, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.STATUS_UNKNOWN}, "[٤] حالة لا تعرفها الشيفرة");
    ok(/ statusState=UNRECOGNIZED$/.test(refusedLines(r2.lines)[0]), "[٤] statusState=UNRECOGNIZED");
    ok(!refusedLines(r2.lines)[0].includes("done"), "[٤] ولا يُكتب نصّ الحالة غير المعروفة في السجلّ");
  }

  // ═══ ٥ — الرمز المتكرّر ═══
  {
    await seed("sess-reuse-old", {code: "NC-REUSE01", status: "completed", expiresAt: PAST(), createdAt: new Date(Date.now() - 5 * 3600 * 1000)});
    await seed("sess-reuse-new", {code: "NC-REUSE01", status: "pending", expiresAt: FUTURE(), createdAt: new Date()});
    const r = await join("NC-REUSE01", authAnon(JOINER));
    ok(r.threw === null && r.ret.sessionId === "sess-reuse-new" && r.ret.status === "scanning", "[٥] pending جديدة بجانب جلسة تاريخية بالرمز نفسه: تنضمّ للـpending");
    eq((await get("sess-reuse-old")).status, "completed", "[٥] والتاريخية لم تُمسّ");
    eq((await get("sess-reuse-new")).joinedBy, JOINER, "[٥] والمنضمّ هو المستدعي");

    await seed("sess-two-a", {code: "NC-TWOOLD1", status: "cancelled", expiresAt: PAST(), createdAt: new Date(Date.now() - 9 * 3600 * 1000)});
    await seed("sess-two-b", {code: "NC-TWOOLD1", status: "scanning", expiresAt: FUTURE(), joinedBy: JOINER_B, createdAt: new Date(Date.now() - 1 * 3600 * 1000)});
    const r2 = await join("NC-TWOOLD1", authAnon(JOINER));
    expectRefusal(r2, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.ALREADY_JOINED}, "[٥] ملغاة قديمة وscanning أحدث بالرمز نفسه: تُحكَم الأحدث (انضُمّ إليها)");
    await seed("sess-two-c", {code: "NC-TWONEW1", status: "scanning", expiresAt: FUTURE(), joinedBy: JOINER_B, createdAt: new Date(Date.now() - 9 * 3600 * 1000)});
    await seed("sess-two-d", {code: "NC-TWONEW1", status: "cancelled", expiresAt: FUTURE(), createdAt: new Date(Date.now() - 1 * 3600 * 1000)});
    const r3 = await join("NC-TWONEW1", authAnon(JOINER));
    expectRefusal(r3, {code: "not-found", message: TEXT_GENERIC, reasonCode: J.CANCELLED}, "[٥] والعكس: الملغاة أحدث فتُحكَم هي (ملغاة)");
    ok(/ matches=2$/.test(refusedLines(r3.lines)[0]), "[٥] والسجلّ يذكر عدد الجلسات المطابقة (matches=2)");
  }

  // ═══ ٦ — سباق حقيقي ═══
  {
    await seed("sess-race", {code: "NC-RACE001", status: "pending", expiresAt: FUTURE()});
    // الالتقاط مرّة واحدة حول النداءين المتزامنين (التقاطان متداخلان يتركان console مبتوراً)
    const raceCap = capture();
    let a;
    let b;
    try {
      [a, b] = await Promise.all([join("NC-RACE001", authAnon(JOINER), {capturing: false}), join("NC-RACE001", authAnon(JOINER_B), {capturing: false})]);
    } finally {
      raceCap.restore();
    }
    const winners = [a, b].filter((x) => x.threw === null);
    const losers = [a, b].filter((x) => x.threw !== null);
    eq(winners.length, 1, "[٦] انضمامان متزامنان: واحد ينجح فقط");
    eq(losers.length, 1, "[٦] والآخر يُرفض");
    eq(losers[0].threw.details.reasonCode, J.ALREADY_JOINED, "[٦] الخاسر يحمل SESSION_ALREADY_JOINED (من البحث أو من معاملة السباق)");
    eq(raceCap.lines.filter((l) => l.startsWith("[joinScanSession] refused reason=SESSION_ALREADY_JOINED ")).length, 1, "[٦] وسطر رفض واحد بسببه في السجلّ");
    ok(["not-found", "failed-precondition"].includes(losers[0].threw.code), "[٦] ورمزه الظاهر من القائمين: not-found (بعد الكتابة) أو failed-precondition (داخل المعاملة)");
    const winnerUid = winners[0] === a ? JOINER : JOINER_B;
    eq((await get("sess-race")).joinedBy, winnerUid, "[٦] ومنضمّ المستند هو الفائز");

    // حقن تغيّر الحالة بين البحث والمعاملة — المسار الذي لا يُرى بالتزامن العاديّ: يُكتب scanning/cancelled بعد أوّل استعلام
    const {Query} = require("firebase-admin/firestore");
    const origGet = Query.prototype.get;
    for (const [injectStatus, expected] of [["scanning", J.ALREADY_JOINED], ["cancelled", J.CANCELLED], ["expired", J.EXPIRED]]) {
      const id = `sess-inject-${injectStatus}`;
      const code = `NC-INJ-${injectStatus.slice(0, 3).toUpperCase()}`;
      await seed(id, {code, status: "pending", expiresAt: FUTURE()});
      let injected = false;
      Query.prototype.get = async function patchedGet(...args) {
        const snap = await origGet.apply(this, args);
        if (!injected) {
          injected = true;
          await db.collection("scanSessions").doc(id).update({status: injectStatus});
        }
        return snap;
      };
      let r;
      try {
        r = await join(code, authAnon(JOINER));
      } finally {
        Query.prototype.get = origGet;
      }
      ok(injected, `[٦] حُقن تغيّر الحالة إلى ${injectStatus} بعد البحث`);
      ok(r.threw !== null, `[٦] ${injectStatus}: رُفض`);
      eq(r.threw.details.reasonCode, expected, `[٦] ${injectStatus}: رمز السبب من حالة المعاملة (${expected})`);
      if (injectStatus === "expired") {
        eq(r.threw.code, "deadline-exceeded", "[٦] expired في المعاملة: النصّ والرمز كما في البحث (deadline-exceeded)");
        eq(r.threw.message, TEXT_EXPIRED, "[٦] expired في المعاملة: «انتهت صلاحية الكود»");
      } else {
        eq(r.threw.code, "failed-precondition", `[٦] ${injectStatus} في المعاملة: failed-precondition كما كان`);
        eq(r.threw.message, TEXT_RACE, `[٦] ${injectStatus} في المعاملة: «الجلسة ليست متاحة للانضمام» كما كان`);
      }
      ok(/ stage=transaction /.test(refusedLines(r.lines)[0]), `[٦] ${injectStatus}: المرحلة transaction في السجلّ`);
      eq((await get(id)).status, injectStatus, `[٦] ${injectStatus}: الحالة المحقونة باقية (لم تُكتب فوقها scanning)`);
      ok(!("joinedBy" in (await get(id))), `[٦] ${injectStatus}: ولا joinedBy`);
    }
  }

  // ═══ ٧ — السجلّ، والمسارات القائمة، ولا حذف ═══
  {
    await seed("sess-plain", {code: "NC-PLAIN01", status: "pending", expiresAt: FUTURE()});
    const r = await join("nc-plain01", null);
    ok(r.threw === null, "[٧] انضمام بلا هوية ينجح كما كان");
    deq(Object.keys(r.ret).sort(), ["consentEnabled", "evaluationEnabled", "ownerId", "sessionId", "status"], "[٧] مفاتيح الردّ: الأربعة القائمة + consentEnabled (ق15، 2026-10-23، القاعدة 23: كانت أربعة)");
    eq(r.ret.status, "scanning", "[٧] الحالة scanning");
    ok(r.lines.some((l) => l.startsWith("[joinScanSession] evaluationEnabled=")), "[٧] وسطر evaluationEnabled القائم لم يتغيّر");
    eq((await get("sess-plain")).joinedBy, null, "[٧] وjoinedBy=null لمن انضمّ بلا هوية (كما كان — لا يُبتدَع معرّف)");
    const noCode = await join("", authAnon(JOINER));
    ok(noCode.threw && noCode.threw.code === "invalid-argument" && noCode.threw.message === "الكود مطلوب", "[٧] بلا كود: invalid-argument «الكود مطلوب» كما كان");
    eq(refusedLines(noCode.lines).length, 0, "[٧] ولا سطر رفض لما لم يصل إلى البحث");
  }
  {
    // كل السجلّ: لا رمز جلسة ولا sessionId ولا uid خامّ في أيّ سطر رفض
    const probes = [["NC-JOINED", "sess-joined", JOINER], ["NC-CANCEL1", "sess-cancelled", JOINER], ["NC-NO-SUCH", null, JOINER_B], ["NC-EXPIRD1", "sess-expired", JOINER]];
    for (const [code, sid, uid] of probes) {
      const r = await join(code, authAnon(uid));
      const all = r.lines.join("\n");
      ok(![code, code.toLowerCase(), sid, uid].filter(Boolean).some((v) => all.includes(v)), `[٧] ${code}: لا رمز جلسة ولا sessionId ولا uid خامّ في أيّ سطر`);
      ok(refusedLines(r.lines)[0].includes(` joiner=${hashIdForLog(uid)}`), `[٧] ${code}: المنضمّ مُهشَّراً في السطر`);
    }
    for (const id of ["sess-joined", "sess-done", "sess-cancelled", "sess-expired", "sess-touch", "sess-race"]) {
      ok((await db.collection("scanSessions").doc(id).get()).exists, `[٧] مستند ${id} موجود (لا حذف)`);
    }
    // أنّ admin مستورد ويُستعمل في المسار الحقيقي (لا استبدال)
    ok(typeof admin.firestore.FieldValue.serverTimestamp === "function", "[٧] FieldValue الحقيقي");
  }

  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
