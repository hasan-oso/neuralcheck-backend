// E2E test: redeemPromoCode يرفض المجهول والمزوّد الغائب في أوّل الدالّة (V8، 2026-10-09). قرار المستخدم بنصّه: «redeemPromoCode:
// رفض صريح للمجهول والمزوّد الغائب في أوّل الدالّة، بفحص مصدره واحد مع registerUser، وبالنصّ القائم في :20. ومعه اختبار وحدة واختبار
// e2e. معتمد.» المعالج **الحقيقي** عبر .run() على محاكي Firestore (القاعدة 37)؛ لا شيء مستبدَل (لا شبكة: لا بريد ولا FCM لمستخدمين بلا بريد).
//
// ما يثبته:
//   ١. مجهول (sign_in_provider=anonymous): unauthenticated "يجب تسجيل الدخول" (النصّ القائم)، ومستند الكود لم يُمسّ (محتوى وupdateTime)،
//      ومستند المستخدم لم يُنشأ ولم يُعدَّل، و**لم تُقرأ** مجموعتا promoCodes وusers أصلاً (تسجيل أسماء المجموعات التي يمرّ بها db).
//   ٢. مزوّد غائب (token بلا firebase، firebase بلا sign_in_provider، نصّ فارغ): نفس الرفض ونفس عدم المسّ.
//   ٣. Google وكلمة المرور (وphone) كما كانا: يُستردّ الكود، تُمنح الفحوص، ويُسجَّل الاستخدام.
//   ٤. بلا request.auth أصلاً: الرفض القائم كما كان.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/redeemPromoCode.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const {admin, db} = require("../src/utils/admin");
const {redeemPromoCode} = require("../src/users/redeemPromoCode");

const results = [];
let failures = 0;
function assert(cond, name) {
  if (cond) results.push(`PASS  ${name}`);
  else {
    failures++; results.push(`FAIL  ${name}`);
  }
}

// تسجيل أسماء المجموعات التي يطلبها المعالج من db الحقيقي (التغليف على db نفسه لا يستبدل شيئاً منه: يمرّر إلى الأصل).
const touched = [];
const realCollection = db.collection.bind(db);
db.collection = (name) => {
  touched.push(name);
  return realCollection(name);
};

const tok = (provider) => ({firebase: {sign_in_provider: provider}});
const REJECT_TEXT = "يجب تسجيل الدخول";
const snapOf = async (col, id) => realCollection(col).doc(id).get();

async function seedCode(code, fields) {
  await realCollection("promoCodes").doc(code).set({
    code, usedCount: 0, isActive: true, maxUses: 100, durationDays: 30, plan: "shop_pro", scans: 25, ...fields,
  });
}
async function redeem(code, auth) {
  return redeemPromoCode.run({data: {code}, auth});
}
async function attempt(code, auth) {
  touched.length = 0;
  try {
    await redeem(code, auth);
    return {threw: null, touched: [...touched]};
  } catch (e) {
    return {threw: e, touched: [...touched]};
  }
}

(async () => {
  // ===== ١/٢: المرفوضون — لا يُمسّ شيء =====
  await seedCode("ANONCODE", {});
  const codeBefore = await snapOf("promoCodes", "ANONCODE");
  const rejected = [
    ["anonymous", {uid: "anon1", token: tok("anonymous")}],
    ["token بلا firebase", {uid: "anon2", token: {}}],
    ["firebase بلا sign_in_provider", {uid: "anon3", token: {firebase: {}}}],
    ["sign_in_provider نصّ فارغ", {uid: "anon4", token: tok("")}],
  ];
  for (const [label, auth] of rejected) {
    const r = await attempt("ANONCODE", auth);
    assert(r.threw && r.threw.code === "unauthenticated" && r.threw.message === REJECT_TEXT,
        `${label}: rejected with unauthenticated "${REJECT_TEXT}" (the existing text)`);
    assert(!r.touched.includes("promoCodes") && !r.touched.includes("users"),
        `${label}: neither promoCodes nor users was read (rejection comes first) — touched=[${r.touched.join(",")}]`);
    assert(!(await snapOf("users", auth.uid)).exists, `${label}: no user document created`);
  }
  const codeAfter = await snapOf("promoCodes", "ANONCODE");
  assert(codeAfter.updateTime.toMillis() === codeBefore.updateTime.toMillis() &&
      codeAfter.data().usedCount === 0 && !(codeAfter.data().usedBy || []).length,
  "the promo code document is untouched (same updateTime, usedCount 0, no usedBy)");

  // الرفض يسبق التحقّق من الكود أيضاً: كود غير موجود/فارغ من مجهول يعطي الرفض نفسه لا not-found/invalid-argument
  const noCode = await attempt("DOES-NOT-EXIST", {uid: "anon5", token: tok("anonymous")});
  assert(noCode.threw && noCode.threw.code === "unauthenticated", "anonymous with a non-existent code: still unauthenticated (not 'not-found')");
  touched.length = 0;
  let emptyThrew = null;
  try {
    await redeemPromoCode.run({data: {}, auth: {uid: "anon6", token: tok("anonymous")}});
  } catch (e) {
    emptyThrew = e;
  }
  assert(emptyThrew && emptyThrew.code === "unauthenticated", "anonymous with no code: unauthenticated (not 'invalid-argument')");

  // ===== ٤: بلا request.auth =====
  const noAuth = await attempt("ANONCODE", null);
  assert(noAuth.threw && noAuth.threw.code === "unauthenticated" && noAuth.threw.message === REJECT_TEXT, "no request.auth: unauthenticated, the existing text, as before");

  // ===== ٣: المسجَّلون كما كانوا =====
  for (const provider of ["google.com", "password", "phone"]) {
    const uid = `user-${provider.replace(".", "-")}`;
    const code = `OK-${provider.replace(".", "-").toUpperCase()}`;
    await seedCode(code, {plan: "pro", scans: 40});
    await realCollection("users").doc(uid).set({plan: "free", scansRemaining: 1, scansTotal: 1});
    const r = await attempt(code, {uid, token: tok(provider)});
    const u = (await snapOf("users", uid)).data();
    const c = (await snapOf("promoCodes", code)).data();
    assert(r.threw === null, `${provider}: redeems (no error)`);
    assert(u.scansRemaining === 41 && u.plan === "shop_pro" && u.isActive === true, `${provider}: scans granted (1 -> 41), legacy 'pro' normalized to shop_pro, isActive`);
    assert(c.usedCount === 1 && (c.usedBy || []).includes(uid), `${provider}: usage recorded on the promo code`);
    assert(r.touched.includes("promoCodes") && r.touched.includes("users"), `${provider}: the code was read normally`);
  }
  // الاستخدام المتكرّر بقي مرفوضاً بسببه القائم (لا بسبب المزوّد)
  const again = await attempt("OK-PASSWORD", {uid: "user-password", token: tok("password")});
  assert(again.threw && again.threw.code === "already-exists", "password: second redeem of the same code still fails with its own existing error (already-exists)");

  console.log("\n===== REDEEM PROMO CODE (anonymous / missing provider) E2E RESULTS =====");
  results.forEach((r) => console.log(r));
  console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
  await admin.app().delete().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("Test harness error:", e);
  process.exit(2);
});
