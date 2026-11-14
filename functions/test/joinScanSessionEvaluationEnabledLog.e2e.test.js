// E2E test: سطر evaluationEnabled في joinScanSession (V8 قبل النشر، 2026-10-09 +03). المعالج الحقيقي عبر .run() على محاكي Firestore، بلا
// استبدال أيّ طبقة (القاعدة 37)؛ يُلتقَط كل ما يُكتب في console أثناء النداء.
//
// قرار المستخدم (بنصّه): «سطر evaluationEnabled في joinScanSession: نعم، قبل النشر. القيمة المُرجَعة، ومصدرها (مالك الجلسة موجود أم لا،
// والعلم true أم غيره)، بمعرّفات مُهشَّرة. فالقائمة تُبنى بعد التزامه.»
// والمطلوب: سطر واحد لكل انضمام ناجح بالقيمة وسببها المسمّى (المالك غائب / العلم true / false / غائب / غير منطقي)؛ الجلسة والمالك والمنضمّ
// عبر hashIdForLog، ولا رمز الجلسة ولا معرّف خامّ؛ والردّ إلى التطبيق لا يتغيّر لا مفاتيحه ولا قيمه.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/joinScanSessionEvaluationEnabledLog.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");

const {admin, db} = require("../src/utils/admin");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {EVALUATION_ENABLED_REASON: R} = require("../src/sessions/evaluationEnabledState");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m}`); n++; };

const OWNER = "owner-uid-join-raw-0001";
const JOINER = "joiner-anon-uid-join-raw-0002";
const future = () => new Date(Date.now() + 10 * 60 * 1000);
const past = () => new Date(Date.now() - 10 * 60 * 1000);
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info, debug: console.debug};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
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
async function clean() {
  for (const col of ["scanSessions", "users"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
async function seed({sessionId, code, ownerDoc, expiresAt = future(), status = "pending"}) {
  await db.collection("scanSessions").doc(sessionId).set({ownerId: OWNER, code: code.toUpperCase(), status, expiresAt});
  if (ownerDoc !== null) await db.collection("users").doc(OWNER).set(ownerDoc);
}

const oldExpression = (owner) => owner?.evaluationEnabled === true; // joinScanSession.js:97 عند b194da4
const evalLines = (lines) => lines.filter((l) => /^\[joinScanSession\] evaluationEnabled=/.test(l.text));

// كل صفّ: وثيقة المالك (null = لا مستند)، والسبب المنتظر، ونوع القيمة المنتظر في السطر (أو null)
const CASES = [
  {label: "المالك غائب", owner: null, reason: R.OWNER_DOC_MISSING, valueType: null},
  {label: "العلم true", owner: {language: "ar", evaluationEnabled: true}, reason: R.FLAG_TRUE, valueType: null},
  {label: "العلم false", owner: {language: "ar", evaluationEnabled: false}, reason: R.FLAG_FALSE, valueType: null},
  {label: "العلم غائب", owner: {language: "ar"}, reason: R.FLAG_ABSENT, valueType: null},
  {label: "العلم نصّ", owner: {evaluationEnabled: "true"}, reason: R.FLAG_NOT_BOOLEAN, valueType: "string"},
  {label: "العلم رقم", owner: {evaluationEnabled: 1}, reason: R.FLAG_NOT_BOOLEAN, valueType: "number"},
  {label: "العلم null", owner: {evaluationEnabled: null}, reason: R.FLAG_NOT_BOOLEAN, valueType: "null"},
  {label: "العلم خريطة", owner: {evaluationEnabled: {enabled: true}}, reason: R.FLAG_NOT_BOOLEAN, valueType: "object"},
  {label: "العلم مصفوفة", owner: {evaluationEnabled: [true]}, reason: R.FLAG_NOT_BOOLEAN, valueType: "array"},
];

(async () => {
  // ═══ ١ — كل حالة: الردّ كما كان بالضبط، وسطر واحد بسببها الصحيح، وبلا معرّف خامّ ═══
  const covered = new Set();
  let i = 0;
  for (const c of CASES) {
    i++;
    await clean();
    const SESSION = `session-join-raw-id-${String(i).padStart(4, "0")}`;
    const CODE = `NC-JE${i}X`;
    await seed({sessionId: SESSION, code: CODE, ownerDoc: c.owner});
    const {ret, threw, lines} = await join(CODE.toLowerCase(), authAnon(JOINER)); // الكود يُرسَل بحروف صغيرة: يُحوَّل كما كان
    const label = `[${c.label}]`;
    ok(threw === null, `${label} الانضمام ينجح`);
    // (ق15، 2026-10-23، القاعدة 23: كانت أربعة مفاتيح؛ استُبدلت بخمسة: أُضيف consentEnabled — false هنا لأن المالك بلا protocolParts؛ تفصيله في joinScanSessionConsentEnabled.e2e.test.js)
    deq(Object.keys(ret).sort(), ["consentEnabled", "evaluationEnabled", "ownerId", "sessionId", "status"], `${label} مفاتيح الردّ: الأربعة القائمة + consentEnabled`);
    deq(ret, {sessionId: SESSION, ownerId: OWNER, status: "scanning", evaluationEnabled: oldExpression(c.owner), consentEnabled: false}, `${label} قيم الردّ كما كانت، والقيمة = التعبير القديم، وconsentEnabled=false (بلا protocolParts)`);
    eq(typeof ret.evaluationEnabled, "boolean", `${label} والقيمة منطقية`);
    const found = evalLines(lines);
    eq(found.length, 1, `${label} سطر evaluationEnabled واحد`);
    eq(found[0].level, "log", `${label} بمستوى log`);
    const expected = `[joinScanSession] evaluationEnabled=${oldExpression(c.owner)} reason=${c.reason}` +
        (c.valueType ? ` valueType=${c.valueType}` : "") +
        ` session=${hashIdForLog(SESSION)} owner=${hashIdForLog(OWNER)} joiner=${hashIdForLog(JOINER)}`;
    eq(found[0].text, expected, `${label} السطر: القيمة وسببها المسمّى ونوع القيمة غير المنطقية والمعرّفات الثلاثة مُهشَّرة`);
    const all = lines.map((l) => l.text).join("\n");
    ok(![SESSION, OWNER, JOINER, CODE, CODE.toLowerCase()].some((v) => all.includes(v)), `${label} لا sessionId ولا ownerId ولا uid المنضمّ ولا رمز الجلسة خامّاً في أيّ سطر كُتب أثناء النداء`);
    const sessionAfter = (await db.collection("scanSessions").doc(SESSION).get()).data();
    ok(sessionAfter.status === "scanning" && sessionAfter.joinedBy === JOINER, `${label} والجلسة انتقلت إلى scanning بالمنضمّ كما كانت`);
    covered.add(c.reason);
  }
  console.log(`تحقّق ١: ${CASES.length} حالة`);

  // ═══ ٢ — منضمّ بلا هوية: المعرّف الغائب يُكتب «missing» لا تهشيراً للفراغ (القاعدة 22) ═══
  {
    await clean();
    const SESSION = "session-join-raw-id-noauth";
    await seed({sessionId: SESSION, code: "NC-NOAUTH", ownerDoc: {evaluationEnabled: true}});
    const {ret, threw, lines} = await join("NC-NOAUTH", null);
    ok(threw === null && ret.evaluationEnabled === true, "[٢] انضمام بلا هوية ينجح والقيمة true");
    eq(evalLines(lines)[0].text, `[joinScanSession] evaluationEnabled=true reason=FLAG_TRUE session=${hashIdForLog(SESSION)} owner=${hashIdForLog(OWNER)} joiner=missing`, "[٢] joiner=missing صريحة");
  }

  // ═══ ٣ — القيمة من المالك لا من المنضمّ: وثيقة المنضمّ تحمل true والمالك false ═══
  {
    await clean();
    const SESSION = "session-join-raw-id-fromowner";
    await seed({sessionId: SESSION, code: "NC-FROMOWNER", ownerDoc: {evaluationEnabled: false}});
    await db.collection("users").doc(JOINER).set({evaluationEnabled: true});
    const {ret, lines} = await join("NC-FROMOWNER", authAnon(JOINER));
    eq(ret.evaluationEnabled, false, "[٣] القيمة من حساب المالك لا المنضمّ");
    ok(/ evaluationEnabled=false reason=FLAG_FALSE /.test(evalLines(lines)[0].text), "[٣] والسطر يقول FLAG_FALSE");
  }

  // ═══ ٤ — انضمام مرفوض لا يكتب السطر (السطر لكل انضمام ناجح) ═══
  {
    await clean();
    const bad = await join("NC-NO-SUCH-CODE", authAnon(JOINER));
    ok(bad.threw && bad.threw.code === "not-found", "[٤] كود غير موجود: not-found كما كان");
    eq(evalLines(bad.lines).length, 0, "[٤] ولا سطر evaluationEnabled");
    await seed({sessionId: "session-join-raw-id-expired", code: "NC-EXPIRED", ownerDoc: {evaluationEnabled: true}, expiresAt: past()});
    const exp = await join("NC-EXPIRED", authAnon(JOINER));
    ok(exp.threw && exp.threw.code === "deadline-exceeded", "[٤] كود منتهٍ: deadline-exceeded كما كان");
    eq(evalLines(exp.lines).length, 0, "[٤] ولا سطر evaluationEnabled");
    const noCode = await join("", authAnon(JOINER));
    ok(noCode.threw && noCode.threw.code === "invalid-argument", "[٤] بلا كود: invalid-argument كما كان");
    eq(evalLines(noCode.lines).length, 0, "[٤] ولا سطر evaluationEnabled");
  }

  // ═══ ٥ — كل الحالات المعرَّفة في المصدر الواحد لها حالة هنا (حالة جديدة بلا اختبار تُفشل) ═══
  const missing = Object.values(R).filter((r) => !covered.has(r));
  eq(missing.length, 0, `[٥] كل سبب في EVALUATION_ENABLED_REASON مغطّى (الناقص: ${missing.join(",") || "لا شيء"})`);

  await clean();
  await admin.app().delete().catch(() => {});
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FAIL:", (e && e.stack) || e);
  process.exit(1);
});
