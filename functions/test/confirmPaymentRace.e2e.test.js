"use strict";

// confirmPaymentRace.e2e.test.js — تأكيدان متزامنان لدفعة واحدة ⟵ منحة واحدة بالضبط (البند ٣، 2026-10-17 +03). على محاكي Firestore (المعالج الحقيقي confirmPayment.run، وFirestore حقيقي هو المحاكي).
//
// الواقع (قرأه المنسّق وتحقّقتُ منه في confirmPayment.js قبل الإصلاح): قراءة payments/{id} ثم شرط status === "pending" ثم payments.update ثم users.update — بلا runTransaction — فتأكيدان متزامنان يجتازان الشرط معاً.
// **ما يظهره العطب فعلاً** (تدقيق لنصّ الأمر: «يمنحان الرصيد مرّتين»): scansRemaining يُضبط مطلقاً (= scansGranted) لا يُزاد، فلا يتضاعف؛ ما يتضاعف scansTotal (increment(scansGranted) مرّتين)،
// ويُرجِع الاستدعاءان كلاهما `confirmed`، ويُرسَل الإشعار مرّتين، ويُعاد ضبط الرصيد إن استُهلك شيء بين التأكيدين. فالمقياس هنا: عدد الاستدعاءين الناجحين، وscansTotal.
// المستبدَل: لا شيء من الطبقات (لا بريد ولا FCM: المستخدم بلا email ولا fcmToken). الشبكة غير مستعملة.
//
// الجولات: عدّة دفعات، لكل منها تأكيدان بـPromise.allSettled — فالتداخل غير حتمي في الشيفرة القديمة (يُسجَّل في كل جولة)، وحتمي بعد الإصلاح (المعاملة: واحد ينجح والآخر failed-precondition).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/confirmPaymentRace.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {db, ADMIN_EMAILS} = require("../src/utils/admin");
const {confirmPayment} = require("../src/payments/confirmPayment");
const {HttpsError} = require("firebase-functions/v2/https");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const ADMIN = {uid: "admin", token: {email: ADMIN_EMAILS[0], email_verified: true}};
const GRANTED = 7;
const ROUNDS = 8;
const confirm = (paymentId) => confirmPayment.run({data: {paymentId}, auth: ADMIN});
const getUser = async (id) => (await db.collection("users").doc(id).get()).data();
const getPayment = async (id) => (await db.collection("payments").doc(id).get()).data();
const seedPair = async (i) => {
  await db.collection("users").doc(`u-${i}`).set({scansRemaining: 0, scansTotal: 0, plan: "free", isActive: false, name: "N", subExpiryEmailSent: true});
  await db.collection("payments").doc(`pay-${i}`).set({userId: `u-${i}`, plan: "shop_basic", scansGranted: GRANTED, amountUsd: 10, status: "pending"});
};
async function quiet(fn) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, real); }
}

(async () => {
  // ═══ ١ — تأكيدان متزامنان: منحة واحدة بالضبط، والثاني failed-precondition ═══
  const summary = [];
  for (let i = 0; i < ROUNDS; i++) {
    await seedPair(i);
    const settled = await quiet(() => Promise.allSettled([confirm(`pay-${i}`), confirm(`pay-${i}`)]));
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    const u = await getUser(`u-${i}`);
    summary.push({round: i, fulfilled: fulfilled.length, rejected: rejected.map((r) => `${r.reason && r.reason.code}`), scansTotal: u.scansTotal, scansRemaining: u.scansRemaining});
    eq(fulfilled.length, 1, `[١] الجولة ${i}: تأكيد واحد ينجح بالضبط (نجح ${fulfilled.length})`);
    deq(fulfilled[0].value, {status: "confirmed", scansAdded: GRANTED}, `[١] الجولة ${i}: ردّ الناجح {status, scansAdded} كما كان`);
    eq(rejected.length, 1, `[١] الجولة ${i}: والآخر يُرفض`);
    ok(rejected[0].reason instanceof HttpsError && rejected[0].reason.code === "failed-precondition" && rejected[0].reason.message === "الدفعة ليست معلقة", `[١] الجولة ${i}: failed-precondition «الدفعة ليست معلقة» (${rejected[0].reason && rejected[0].reason.code}/${rejected[0].reason && rejected[0].reason.message})`);
    eq(u.scansTotal, GRANTED, `[١] الجولة ${i}: scansTotal زيد مرّة واحدة فقط (${u.scansTotal})`);
    eq(u.scansRemaining, GRANTED, `[١] الجولة ${i}: scansRemaining = المنحة`);
    eq((await getPayment(`pay-${i}`)).status, "confirmed", `[١] الجولة ${i}: الدفعة confirmed`);
  }
  console.log(`[قياس] جولات التأكيد المتزامن (${ROUNDS}): ${JSON.stringify(summary)}`);

  // ═══ ٢ — الردّ والأخطاء كما كانت ═══
  await seedPair("seq");
  deq(await confirm("pay-seq"), {status: "confirmed", scansAdded: GRANTED}, "[٢] التأكيد المتتابع الأوّل: {status, scansAdded}");
  let e1 = null; try { await confirm("pay-seq"); } catch (e) { e1 = e; }
  ok(e1 instanceof HttpsError && e1.code === "failed-precondition" && e1.message === "الدفعة ليست معلقة", "[٢] التأكيد الثاني المتتابع: failed-precondition «الدفعة ليست معلقة»");
  let e2 = null; try { await quiet(() => confirm("pay-nope")); } catch (e) { e2 = e; }
  ok(e2 instanceof HttpsError && e2.code === "not-found" && e2.message === "الدفعة غير موجودة", "[٢] دفعة غير موجودة: not-found «الدفعة غير موجودة»");
  await db.collection("payments").doc("pay-rej").set({userId: "u-seq", plan: "shop_basic", scansGranted: 3, status: "rejected"});
  let e3 = null; try { await confirm("pay-rej"); } catch (e) { e3 = e; }
  ok(e3 instanceof HttpsError && e3.code === "failed-precondition" && e3.message === "الدفعة ليست معلقة", "[٢] دفعة مرفوضة: failed-precondition «الدفعة ليست معلقة»");

  // ═══ ٣ — الحقول المكتوبة ═══
  await db.collection("users").doc("u-keys").set({scansRemaining: 999, scansTotal: 10, plan: "free", isActive: false, name: "K", untouched: "keep-me", subExpiryEmailSent: true, subExpiryFcmDate: "2026-01-01", subExpiredNotified: true});
  await db.collection("payments").doc("pay-keys").set({userId: "u-keys", plan: "shop_pro", scansGranted: 150, amountUsd: 20, status: "pending", note: "keep-me-too"});
  await confirm("pay-keys");
  const uk = await getUser("u-keys");
  const pk = await getPayment("pay-keys");
  deq(Object.keys(uk).sort(), ["isActive", "expiresAt", "name", "plan", "scansRemaining", "scansTotal", "untouched"].sort(), "[٣] مفاتيح المستخدم بعد التأكيد: الحقول الخمسة المكتوبة + ما لم يُمسّ، وأعلام التذكير الثلاثة محذوفة");
  deq([uk.plan, uk.scansRemaining, uk.scansTotal, uk.isActive, uk.untouched], ["shop_pro", 150, 160, true, "keep-me"], "[٣] قيم المستخدم (الرصيد يُضبط مطلقاً، scansTotal يُزاد، وما لم يُمسّ باقٍ)");
  const days = (uk.expiresAt.toDate().getTime() - Date.now()) / 86400000;
  ok(days > 29.9 && days < 30.1, `[٣] expiresAt ≈ الآن + 30 يوماً (${days.toFixed(3)})`);
  deq(Object.keys(pk).sort(), ["amountUsd", "confirmedAt", "discountPercent", "note", "plan", "scansGranted", "status", "userId"].sort(), "[٣] مفاتيح الدفعة بعد التأكيد: الثلاثة المكتوبة (status, discountPercent, confirmedAt) + الأصلية");
  deq([pk.status, pk.discountPercent, pk.note], ["confirmed", 0, "keep-me-too"], "[٣] قيم الدفعة");
  ok(pk.confirmedAt && typeof pk.confirmedAt.toDate === "function", "[٣] confirmedAt طابع زمني من الخادم");

  // ═══ ٤ — حالتان صريحتان (القاعدة 22): بلا كتابة قبل الرفض ═══
  await db.collection("payments").doc("pay-nouser").set({plan: "shop_basic", scansGranted: 5, status: "pending"});
  let e4 = null; try { await quiet(() => confirm("pay-nouser")); } catch (e) { e4 = e; }
  ok(e4 instanceof HttpsError && e4.details && e4.details.reasonCode === "PAYMENT_USER_ABSENT", `[٤] دفعة بلا userId: رفض مسمّى PAYMENT_USER_ABSENT (${e4 && e4.code}/${e4 && e4.message})`);
  eq((await getPayment("pay-nouser")).status, "pending", "[٤] والدفعة تبقى pending (لا كتابة قبل الرفض)");
  await db.collection("payments").doc("pay-nodoc").set({userId: "u-missing-doc", plan: "shop_basic", scansGranted: 5, status: "pending"});
  let e5 = null; try { await quiet(() => confirm("pay-nodoc")); } catch (e) { e5 = e; }
  ok(e5 instanceof HttpsError && e5.details && e5.details.reasonCode === "PAYMENT_USER_NOT_FOUND", `[٤] مستخدم الدفعة بلا مستند: رفض مسمّى PAYMENT_USER_NOT_FOUND (${e5 && e5.code}/${e5 && e5.message})`);
  eq((await getPayment("pay-nodoc")).status, "pending", "[٤] والدفعة تبقى pending (لا تُؤكَّد دفعة بلا مستخدم، وكانت تُؤكَّد ثم تنهار كتابة المستخدم)");
  ok(!(await db.collection("users").doc("u-missing-doc").get()).exists, "[٤] ولا يُنشأ مستند مستخدم");

  console.log(`confirmPaymentRace.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
