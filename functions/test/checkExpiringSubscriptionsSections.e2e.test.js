// E2E test: checkExpiringSubscriptions بعد إصلاح القاعدة 43 (A-SUB البند ٤-أ، 2026-10-17 +03). المهمّة الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37).
// **الاستبدالات المعلَنة (لا تستبدل ما قد يرفض)**: `admin.messaging` بمُرسِل يعدّ ولا يرسل، وgetMailTransporter بناقل بريد يعدّ ولا يرسل (لا شبكة ولا SMTP).
// **المراقب التمريري** (لا يستبدل شيئاً: يمرّر الاستعلام الحقيقي إلى المحاكي): Query.prototype._get — يسجّل المجموعة والمرشِّحات، ويحقن فشلاً في قسم بعينه.
//
// القرار (المنسّق، منقول من نصّ الأمر؛ مصدره evidence/device-check-03/user-b8-read-results-and-decisions-2026-10-14.md القرار 2، غير متحقَّق من هذا المستودع):
// «حذف القسم (د) … و(أ) لا يصفّر الرصيد بل يطفئ فقط … وكل فرع في try/catch مستقلّ.»
//
// ما يثبته:
//   ١ (أ): المنتهي ⟵ isActive=false وsubExpiredNotified=true وsubExpiredAt، **والرصيد كما هو** (قيمة، صفر، وغائب يبقى غائباً)؛ بريد وإشعار انتهاء مرّة واحدة؛ المُعلَم مسبقاً يُعطَّل بلا إشعار؛ واللغة التركية بقالبها.
//   ٢ التشغيل الثاني لا يكرّر إشعار الانتهاء ولا تذكير اليوم.
//   ٣ لا قسم (د): لا استعلام على scanSessions أصلاً، ولا جلسة (pending أو scanning، منقضية أو لا) تُمسّ.
//   ٤ كل قسم مستقلّ: فشل (أ) أو (ب) أو (ج) وحده لا يمنع الآخرَين (أعمالهما تتمّ)، وسطر `[checkExpiringSubscriptions] section=<…> FAILED:` بنصّ منقّى (لا مسار مستند ولا معرّف)، وسطر الخلاصة يكتب FAILED لا صفراً، ولا رمي من المهمّة؛ وفشل الأقسام الثلاثة معاً كذلك.
//   ٥ فشل بريد مستخدم واحد لا يوقف الباقين، ومعرّفه مُهشَّر في السطر (لا uid خامّ).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/checkExpiringSubscriptionsSections.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {Query} = require("firebase-admin/firestore");
const {admin, db} = require("../src/utils/admin");
const emails = require("../src/utils/emails");

// ─── بريد وإشعارات تُعدّ ولا تُرسَل (قبل تحميل المهمّة: تستورد getMailTransporter بالتفكيك) ───
const sentMail = []; // {to, subject}
let mailFailureFor = null; // (to) ⟵ Error أو null
emails.getMailTransporter = () => ({
  sendMail: async (m) => {
    const err = mailFailureFor && mailFailureFor(m.to);
    if (err) throw err;
    sentMail.push({to: m.to, subject: m.subject});
    return {accepted: [m.to]};
  },
});
const sentPush = []; // {token, type}
Object.defineProperty(admin, "messaging", {
  configurable: true,
  value: () => ({send: async (msg) => { sentPush.push({token: msg.token, type: msg.data && msg.data.type}); return "projects/demo-nc/messages/stub"; }}),
});

const {checkExpiringSubscriptions, EXPIRY_SECTION, SECTION_FAILED} = require("../src/notifications/checkExpiringSubscriptions");
const {EMAIL_TEMPLATES} = emails;
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ─── المراقب التمريري ───
const queries = []; // {collection, fields:[حقل…]}
let queryFailure = null; // (q) ⟵ Error أو null
const realGet = Query.prototype._get;
Query.prototype._get = async function spiedGet(...args) {
  const o = this._queryOptions;
  const q = {collection: o.collectionId, fields: (o.filters || []).map((f) => `${f.field.formattedName} ${f.op}`)};
  queries.push(q);
  if (queryFailure) {
    const err = queryFailure(q);
    if (err) throw err;
  }
  return realGet.apply(this, args);
};
// الأقسام بشكل استعلامها (حقول المرشِّحات): أ = isActive + expiresAt<= ، ب = isActive + expiresAt<= + expiresAt> ، ج = isActive + scansRemaining<= + scansRemaining>
const isA = (q) => q.collection === "users" && q.fields.some((f) => f === "expiresAt LESS_THAN_OR_EQUAL") && !q.fields.some((f) => f === "expiresAt GREATER_THAN");
const isB = (q) => q.collection === "users" && q.fields.some((f) => f === "expiresAt GREATER_THAN");
const isC = (q) => q.collection === "users" && q.fields.some((f) => f.startsWith("scansRemaining"));

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push(a.join(" ")); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function runJob() {
  sentMail.length = 0; sentPush.length = 0; queries.length = 0;
  const cap = capture();
  let threw = null;
  try { await checkExpiringSubscriptions.run({}); } catch (e) { threw = e; } finally { cap.restore(); }
  return {threw, lines: cap.lines, mail: [...sentMail], push: [...sentPush], queries: [...queries]};
}
const summaryOf = (lines) => lines.filter((l) => l.startsWith("[checkExpiringSubscriptions] done "));
const DAY = 24 * 3600 * 1000;
const at = (days) => new Date(Date.now() + days * DAY);
const getUser = async (uid) => (await db.collection("users").doc(uid).get()).data();
const seed = (uid, fields) => db.collection("users").doc(uid).set(fields);
const mailTo = (r, addr) => r.mail.filter((m) => m.to === addr);
const pushTo = (r, token) => r.push.filter((p) => p.token === token);
const sessionSnapshot = async () => {
  const snap = await db.collection("scanSessions").get();
  const out = {};
  for (const d of snap.docs) out[d.id] = JSON.stringify(d.data(), (k, v) => ((v && typeof v.toDate === "function") ? v.toDate().toISOString() : v));
  return out;
};

(async () => {
  // ═══ البذور ═══
  await seed("exp-main", {plan: "shop_pro", scansRemaining: 7, scansTotal: 50, isActive: true, expiresAt: at(-2), email: "exp-main@x.test", fcmToken: "T-exp-main", language: "ar", name: "N1"});
  await seed("exp-notified", {plan: "free", scansRemaining: 3, scansTotal: 3, isActive: true, expiresAt: at(-1), subExpiredNotified: true, email: "exp-notified@x.test", fcmToken: "T-exp-notified"});
  await seed("exp-zero", {plan: "single", scansRemaining: 0, scansTotal: 1, isActive: true, expiresAt: at(-1)});
  await seed("exp-nobalance", {plan: "single", scansTotal: 1, isActive: true, expiresAt: at(-1)}); // لا scansRemaining
  await seed("exp-tr", {plan: "shop_basic", scansRemaining: 4, scansTotal: 50, isActive: true, expiresAt: at(-3), email: "exp-tr@x.test", fcmToken: "T-exp-tr", language: "tr"});
  await seed("soon-1", {plan: "shop_basic", scansRemaining: 2, scansTotal: 50, isActive: true, expiresAt: at(2), email: "soon-1@x.test", fcmToken: "T-soon-1"});
  await seed("low-1", {plan: "shop_pro", scansRemaining: 3, scansTotal: 150, isActive: true, expiresAt: at(20), email: "low-1@x.test"});
  await seed("low-free", {plan: "free", scansRemaining: 2, scansTotal: 3, isActive: true, expiresAt: at(20), email: "low-free@x.test"});
  await seed("healthy", {plan: "shop_pro", scansRemaining: 50, scansTotal: 150, isActive: true, expiresAt: at(20), email: "healthy@x.test"});
  await seed("inactive", {plan: "shop_pro", scansRemaining: 5, scansTotal: 150, isActive: false, expiresAt: at(-5), email: "inactive@x.test"});
  const PAST = () => at(-1);
  await db.collection("scanSessions").doc("s-pending-exp").set({status: "pending", ownerId: "exp-main", code: "NC-AAAAAA", expiresAt: PAST(), createdAt: at(-2)});
  await db.collection("scanSessions").doc("s-scanning-exp").set({status: "scanning", ownerId: "exp-main", joinedBy: "j1", code: "NC-BBBBBB", expiresAt: PAST(), createdAt: at(-2)});
  await db.collection("scanSessions").doc("s-pending-valid").set({status: "pending", ownerId: "healthy", code: "NC-CCCCCC", expiresAt: at(1), createdAt: new Date()});
  const sessionsBefore = await sessionSnapshot();

  // ═══ ١ — التشغيل الأوّل ═══
  const r1 = await runJob();
  eq(r1.threw, null, "[١] المهمّة لا ترمي");
  {
    const m = await getUser("exp-main");
    deq([m.isActive, m.scansRemaining, m.scansTotal, m.subExpiredNotified], [false, 7, 50, true], "[١] المنتهي: isActive=false والرصيد 7 كما هو (لا تصفير) والعلم مكتوب");
    ok(m.subExpiredAt && typeof m.subExpiredAt.toDate === "function", "[١] subExpiredAt مكتوب (Timestamp)");
    const z = await getUser("exp-zero");
    deq([z.isActive, z.scansRemaining], [false, 0], "[١] رصيد 0 يبقى 0 ويُعطَّل");
    const nb = await getUser("exp-nobalance");
    eq(nb.isActive, false, "[١] بلا رصيد: يُعطَّل");
    eq("scansRemaining" in nb, false, "[١] والرصيد الغائب يبقى غائباً (لا يُكتب صفر: القاعدة 22)");
    const nt = await getUser("exp-notified");
    deq([nt.isActive, nt.scansRemaining], [false, 3], "[١] المُعلَم مسبقاً يُعطَّل والرصيد كما هو");
    const tr = await getUser("exp-tr");
    deq([tr.isActive, tr.scansRemaining], [false, 4], "[١] التركي: يُعطَّل والرصيد كما هو");
    deq([(await getUser("healthy")).isActive, (await getUser("healthy")).scansRemaining], [true, 50], "[١] السليم لا يُمسّ");
    deq([(await getUser("inactive")).isActive, (await getUser("inactive")).scansRemaining], [false, 5], "[١] المعطَّل مسبقاً لا يُمسّ (رصيده كما هو)");
  }
  // الإشعارات: مرّة واحدة لمن لم يُعلَم
  deq(mailTo(r1, "exp-main@x.test").map((m) => m.subject), [EMAIL_TEMPLATES.subscriptionExpired.ar.subject], "[١] بريد الانتهاء للمنتهي: واحد بقالبه العربي");
  deq(mailTo(r1, "exp-tr@x.test").map((m) => m.subject), [EMAIL_TEMPLATES.subscriptionExpired.tr.subject], "[١] وللتركي: واحد بقالبه التركي");
  eq(mailTo(r1, "exp-notified@x.test").length, 0, "[١] المُعلَم مسبقاً: لا بريد");
  deq(pushTo(r1, "T-exp-main").map((p) => p.type), ["subscription_expired"], "[١] إشعار الانتهاء: واحد");
  eq(pushTo(r1, "T-exp-notified").length, 0, "[١] المُعلَم مسبقاً: لا إشعار");
  // (ب) و(ج) كما كانا
  deq(mailTo(r1, "soon-1@x.test").map((m) => m.subject).sort(), [EMAIL_TEMPLATES.subscriptionExpiring.ar.subject, EMAIL_TEMPLATES.scansRunningLow.ar.subject].sort(), "[١] soon-1: بريد التذكير وبريد الرصيد المنخفض (قسما ب وج)");
  deq(pushTo(r1, "T-soon-1").map((p) => p.type), ["subscription_expiring"], "[١] soon-1: إشعار تذكير واحد");
  deq(mailTo(r1, "low-1@x.test").map((m) => m.subject), [EMAIL_TEMPLATES.scansRunningLow.ar.subject], "[١] low-1 (shop_pro، رصيد 3): بريد الرصيد المنخفض");
  eq(mailTo(r1, "low-free@x.test").length, 0, "[١] باقة free: لا بريد رصيد منخفض (لباقات المحلّ فقط)");
  eq(mailTo(r1, "healthy@x.test").length, 0, "[١] السليم: لا بريد");
  const u1 = await getUser("soon-1");
  deq([u1.subExpiryEmailSent, typeof u1.subExpiryFcmDate], [true, "string"], "[١] أعلام التذكير مكتوبة");
  deq(summaryOf(r1.lines), [`[checkExpiringSubscriptions] done ${EXPIRY_SECTION.DEACTIVATE_EXPIRED}=5 ${EXPIRY_SECTION.REMIND_EXPIRING}=1 ${EXPIRY_SECTION.LOW_BALANCE}=3`], "[١] سطر الخلاصة: خمسة عُطّلوا، وواحد ذُكِّر، وثلاثة طابقوا استعلام الرصيد (soon-1 وlow-1 وlow-free)");
  ok(!r1.lines.some((l) => l.includes("FAILED")), "[١] ولا سطر فشل");

  // ═══ ٣ — لا قسم (د) ═══
  deq(await sessionSnapshot(), sessionsBefore, "[٣] مستندات scanSessions كلّها كما هي حرفاً (pending منقضية وscanning منقضية وصالحة) — لا كتابة");
  eq(r1.queries.filter((q) => q.collection === "scanSessions").length, 0, "[٣] ولا استعلام على scanSessions في المهمّة");
  eq((await db.collection("scanSessions").doc("s-pending-exp").get()).data().status, "pending", "[٣] الجلسة pending المنقضية تبقى pending (لا «expired» من المهمّة)");

  // ═══ ٢ — التشغيل الثاني: لا تكرار ═══
  const r2 = await runJob();
  eq(r2.threw, null, "[٢] المهمّة لا ترمي");
  eq(r2.mail.filter((m) => [EMAIL_TEMPLATES.subscriptionExpired.ar.subject, EMAIL_TEMPLATES.subscriptionExpired.tr.subject].includes(m.subject)).length, 0, "[٢] لا بريد انتهاء ثانٍ");
  eq(r2.push.filter((p) => p.type === "subscription_expired").length, 0, "[٢] ولا إشعار انتهاء ثانٍ");
  eq(r2.mail.filter((m) => m.subject === EMAIL_TEMPLATES.subscriptionExpiring.ar.subject).length, 0, "[٢] ولا بريد تذكير ثانٍ (العلم)");
  eq(r2.push.filter((p) => p.type === "subscription_expiring").length, 0, "[٢] ولا إشعار تذكير ثانٍ في اليوم نفسه (subExpiryFcmDate)");
  deq(summaryOf(r2.lines), [`[checkExpiringSubscriptions] done ${EXPIRY_SECTION.DEACTIVATE_EXPIRED}=0 ${EXPIRY_SECTION.REMIND_EXPIRING}=1 ${EXPIRY_SECTION.LOW_BALANCE}=3`], "[٢] الخلاصة: صفر تعطيل مقيس (القسم جرى)، والتذكير والرصيد المنخفض يطابقان الاستعلام نفسه");
  eq((await getUser("exp-main")).scansRemaining, 7, "[٢] والرصيد 7 كما هو بعد تشغيلين");

  // ═══ ٤ — استقلال الأقسام ═══
  const SECTIONS = [
    [EXPIRY_SECTION.DEACTIVATE_EXPIRED, isA], [EXPIRY_SECTION.REMIND_EXPIRING, isB], [EXPIRY_SECTION.LOW_BALANCE, isC],
  ];
  const ERR_TEXT = "boom at projects/demo-nc/databases/(default)/documents/users/uidSecretXYZ123456 failed";
  let k = 0;
  for (const [failing, pred] of SECTIONS) {
    k++;
    // بذور جديدة لكل جولة: كلٌّ من الأقسام الثلاثة له عمل ينتظر
    await seed(`i${k}-exp`, {plan: "shop_pro", scansRemaining: 9, isActive: true, expiresAt: at(-1), email: `i${k}-exp@x.test`});
    await seed(`i${k}-soon`, {plan: "free", scansRemaining: 40, isActive: true, expiresAt: at(2), email: `i${k}-soon@x.test`});
    await seed(`i${k}-low`, {plan: "shop_basic", scansRemaining: 1, isActive: true, expiresAt: at(30), email: `i${k}-low@x.test`});
    queryFailure = (q) => (pred(q) ? Object.assign(new Error(ERR_TEXT), {code: 9}) : null);
    const r = await runJob();
    queryFailure = null;
    eq(r.threw, null, `[٤] فشل «${failing}»: المهمّة لا ترمي`);
    const doneA = (await getUser(`i${k}-exp`)).isActive === false;
    const doneB = mailTo(r, `i${k}-soon@x.test`).length === 1;
    const doneC = mailTo(r, `i${k}-low@x.test`).length === 1;
    deq([doneA, doneB, doneC], [failing !== EXPIRY_SECTION.DEACTIVATE_EXPIRED, failing !== EXPIRY_SECTION.REMIND_EXPIRING, failing !== EXPIRY_SECTION.LOW_BALANCE], `[٤] فشل «${failing}» وحده: القسمان الآخران يُتمّان عملهما (أ ب ج)`);
    const failLines = r.lines.filter((l) => l.startsWith("[checkExpiringSubscriptions] section="));
    eq(failLines.length, 1, `[٤] فشل «${failing}»: سطر فشل مسمّى واحد`);
    ok(failLines[0].startsWith(`[checkExpiringSubscriptions] section=${failing} FAILED: `), `[٤] والسطر باسم القسم «${failing}»`);
    ok(failLines[0].includes("code=9") && failLines[0].includes("boom at"), "[٤] نصّ الخطأ حاضر (الصنف والرمز والرسالة — التمييز بالنصّ، القاعدة 21)");
    ok(!r.lines.join("\n").includes("uidSecretXYZ123456"), "[٤] والمعرّف في مسار المستند منقّى (القاعدة 36)");
    const summary = summaryOf(r.lines)[0] || "";
    ok(summary.includes(`${failing}=${SECTION_FAILED}`), `[٤] الخلاصة تكتب ${failing}=FAILED لا صفراً`);
    for (const [other] of SECTIONS.filter(([s]) => s !== failing)) ok(!summary.includes(`${other}=${SECTION_FAILED}`), `[٤] ولا تُعلن فشل «${other}»`);
  }
  // الأقسام الثلاثة معاً
  {
    await seed("all-exp", {plan: "shop_pro", scansRemaining: 9, isActive: true, expiresAt: at(-1), email: "all-exp@x.test"});
    queryFailure = (q) => (q.collection === "users" ? Object.assign(new Error("every users query fails"), {code: 14}) : null);
    const r = await runJob();
    queryFailure = null;
    eq(r.threw, null, "[٤] فشل الأقسام الثلاثة معاً: المهمّة لا ترمي");
    eq(r.lines.filter((l) => l.startsWith("[checkExpiringSubscriptions] section=")).length, 3, "[٤] ثلاثة أسطر فشل مسمّاة");
    deq(summaryOf(r.lines), [`[checkExpiringSubscriptions] done ${EXPIRY_SECTION.DEACTIVATE_EXPIRED}=FAILED ${EXPIRY_SECTION.REMIND_EXPIRING}=FAILED ${EXPIRY_SECTION.LOW_BALANCE}=FAILED`], "[٤] والخلاصة FAILED الثلاثة");
    eq((await getUser("all-exp")).isActive, true, "[٤] ولا كتابة حين فشلت القراءة");
    const after = await runJob(); // بعد زوال العطل: يعمل كل شيء من جديد (لا حالة عالقة)
    eq((await getUser("all-exp")).isActive, false, "[٤] والتشغيل التالي بلا عطل يُعطّله");
    ok(!after.lines.some((l) => l.includes("FAILED")), "[٤] ولا فشل في التشغيل التالي");
  }

  // ═══ ٥ — فشل بريد مستخدم واحد لا يوقف الباقين ═══
  {
    await seed("mail-a-uid-RAW1", {plan: "shop_pro", scansRemaining: 9, isActive: true, expiresAt: at(-1), email: "mail-a@x.test"});
    await seed("mail-b-uid-RAW2", {plan: "shop_pro", scansRemaining: 9, isActive: true, expiresAt: at(-1), email: "mail-b@x.test", fcmToken: "T-mail-b"});
    // البند ٤-د (2026-10-18، القاعدة 23: يستبدل خطأ «connection refused» بلا عنوان): ردّ SMTP حقيقيّ الشكل يحمل عنوان المستلم.
    mailFailureFor = (to) => (to === "mail-a@x.test" ? Object.assign(new Error("550 5.1.1 <mail-a@x.test>: Recipient address rejected"), {code: "EENVELOPE"}) : null);
    const r = await runJob();
    mailFailureFor = null;
    eq(r.threw, null, "[٥] المهمّة لا ترمي");
    deq([(await getUser("mail-a-uid-RAW1")).isActive, (await getUser("mail-b-uid-RAW2")).isActive], [false, false], "[٥] المستخدمان يُعطَّلان رغم فشل بريد الأوّل");
    eq(mailTo(r, "mail-b@x.test").length, 1, "[٥] وبريد الثاني يُرسَل");
    eq(pushTo(r, "T-mail-b").length, 1, "[٥] وإشعاره");
    const fl = r.lines.filter((l) => l.startsWith("Failed to send expired email for user"));
    eq(fl.length, 1, "[٥] سطر فشل بريد الانتهاء واحد");
    ok(fl[0].includes(hashIdForLog("mail-a-uid-RAW1")) && fl[0].includes("EENVELOPE") && fl[0].includes("5.1.1 <email>: Recipient address rejected"), "[٥] بمعرّف مُهشَّر ونصّ الخطأ، والعنوان في الرسالة مُقنَّع <email>");
    const all = r.lines.join("\n");
    ok(!all.includes("mail-a-uid-RAW1") && !all.includes("mail-a@x.test"), "[٥] ولا uid خامّ ولا بريد المستخدم في أيّ سطر");
    ok(!r.lines.some((l) => l.startsWith("[checkExpiringSubscriptions] section=")), "[٥] وفشل بريد مستخدم لا يُعدّ فشل قسم");
  }

  // ═══ ٥-ب — مواضع catch الثلاثة للبريد (انتهاء، تذكير، رصيد منخفض) تُنقّي عنوان المستلم (البند ٤-د، 2026-10-18) ═══
  {
    await seed("mail-c-uid-RAW3", {plan: "shop_basic", scansRemaining: 2, scansTotal: 50, isActive: true, expiresAt: at(2), email: "mail-c@x.test"});
    mailFailureFor = (to) => (to === "mail-c@x.test" ? Object.assign(new Error("550 5.1.1 <mail-c@x.test>: Recipient address rejected"), {code: "EENVELOPE"}) : null);
    const r = await runJob();
    mailFailureFor = null;
    eq(r.threw, null, "[٥-ب] المهمّة لا ترمي");
    for (const marker of ["Failed to send expiring email for user", "Failed to send low-scans email for user"]) {
      const l = r.lines.filter((x) => x.startsWith(marker));
      eq(l.length, 1, `[٥-ب] سطر «${marker}» واحد (الموضع نُفِّذ فعلاً)`);
      ok(l[0].includes(hashIdForLog("mail-c-uid-RAW3")) && l[0].includes("EENVELOPE") && l[0].includes("5.1.1 <email>: Recipient address rejected"), `[٥-ب] «${marker}»: معرّف مُهشَّر ورمز الخطأ والعنوان مُقنَّع`);
    }
    const all = r.lines.join("\n");
    ok(!all.includes("mail-c@x.test") && !all.includes("mail-c-uid-RAW3"), "[٥-ب] ولا العنوان ولا uid الخامّ في أيّ سطر");
  }

  console.log(`checkExpiringSubscriptionsSections.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
