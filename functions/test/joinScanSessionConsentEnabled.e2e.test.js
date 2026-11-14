// E2E test: حقل consentEnabled في ردّ joinScanSession (ق15، قرار حسن 2026-10-22: «جزء consent للمحلّ يتحكّم بظهور شاشة الموافقة، والخادم يرفض التسجيل لمحلّ بلا الجزء»؛ أمر المستخدم 2026-10-23).
// المعالج الحقيقي (joinScanSession وrecordScanConsent) عبر .run() على محاكي Firestore، بلا استبدال أيّ طبقة (القاعدة 37)؛ يُلتقَط كل ما يُكتب في console أثناء النداء.
//
// المطلوب: الجهاز المفحوص يعرف من ردّ الانضمام هل جزء الموافقة مفعَّل لمحلّ مالك الجلسة، فلا يعرض شاشة يرفض الخادم تسجيلها. الحقل **إضافة** (لا يُغيّر ما قبله: sessionId وownerId وstatus وevaluationEnabled)،
// منطقي دائماً على السلك (الغياب يُعلَن بسببه المسمّى في سطر السجلّ لا false مسدوداً، القاعدة 22)، من مستند المالك المقروء أصلاً (صفر قراءات إضافية)، ويُعاد في إعادة الانضمام أيضاً بقراءة طازجة.
// وما يثبته هنا:
//   ١ كل شكل لمستند المالك ⟵ الردّ بمفاتيحه الخمسة وقيمه، وسطر مسمّى واحد بسببه ونوع القيمة غير المنطقية ومعرّفات مُهشَّرة، ولا معرّف خامّ؛ وconsentEnabled ⟺ نجاح recordScanConsent التالي لنفس الجلسة.
//   ٢ إعادة الانضمام: الردّ نفسه بمفاتيحه، وقيمة consentEnabled من المالك لحظة النداء (لا نسخة قديمة).
//   ٣ منضمّ بلا هوية: joiner=missing؛ والقيمة من المالك لا من المنضمّ؛ والانضمام المرفوض لا يكتب سطراً.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/joinScanSessionConsentEnabled.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");

const {admin, db} = require("../src/utils/admin");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {recordScanConsent} = require("../src/sessions/recordScanConsent");
const {CONSENT_PART_REASON: R} = require("../src/sessions/consentPartState");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m}`); n++; };

const OWNER = "owner-uid-join-consent-0001";
const JOINER = "joiner-anon-uid-join-consent-0002";
const future = () => new Date(Date.now() + 10 * 60 * 1000);
const authAnon = (uid) => ({uid, token: {firebase: {sign_in_provider: "anonymous"}}});

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info, debug: console.debug};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await fn();
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines};
}
const join = (code, auth) => call(() => joinScanSession.run({data: {code}, auth, rawRequest: {headers: {}}}));
const record = (sessionId, auth) => call(() => recordScanConsent.run({data: {sessionId, textVersion: 1, locale: "ar"}, auth, rawRequest: {headers: {}}}));
async function clean() {
  for (const col of ["scanSessions", "users", "protocolPending"]) {
    const snap = await db.collection(col).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
async function seed({sessionId, code, ownerDoc, expiresAt = future(), status = "pending"}) {
  await db.collection("scanSessions").doc(sessionId).set({ownerId: OWNER, code: code.toUpperCase(), status, expiresAt});
  if (ownerDoc !== null) await db.collection("users").doc(OWNER).set(ownerDoc);
}

const consentLines = (lines) => lines.filter((l) => /^\[joinScanSession\] consentEnabled=/.test(l.text));
const evalLines = (lines) => lines.filter((l) => /^\[joinScanSession\] evaluationEnabled=/.test(l.text));
const KEYS = ["consentEnabled", "evaluationEnabled", "ownerId", "sessionId", "status"];

// كل صفّ: وثيقة المالك (null = لا مستند)، والقيمة، والسبب المنتظر، ونوع القيمة المنتظر في السطر (أو null)
const CASES = [
  {label: "المالك غائب", owner: null, value: false, reason: R.OWNER_DOC_MISSING, valueType: null, recordExtra: " owner=absent part=consent"},
  {label: "بلا protocolParts", owner: {language: "ar", evaluationEnabled: true}, value: false, reason: R.PARTS_ABSENT, valueType: null, recordExtra: " part=consent"},
  {label: "protocolParts null", owner: {protocolParts: null}, value: false, reason: R.PARTS_NOT_OBJECT, valueType: null, recordExtra: " part=consent"},
  {label: "protocolParts نصّ", owner: {protocolParts: "garbage"}, value: false, reason: R.PARTS_NOT_OBJECT, valueType: null, recordExtra: " part=consent"},
  {label: "protocolParts فارغة", owner: {protocolParts: {}}, value: false, reason: R.PART_ABSENT, valueType: null, recordExtra: " part=consent"},
  {label: "الأجزاء الأخرى مفعَّلة بلا consent", owner: {protocolParts: {purposes: true, batteryBeforeAfter: true, coldRepeat: true, returns: true, doubleEval: true}}, value: false, reason: R.PART_ABSENT, valueType: null, recordExtra: " part=consent"},
  {label: "consent true", owner: {language: "ar", protocolParts: {consent: true}}, value: true, reason: R.PART_TRUE, valueType: null, recordExtra: null},
  {label: "consent true مع أجزاء أخرى", owner: {protocolParts: {consent: true, purposes: true, coldRepeat: true}}, value: true, reason: R.PART_TRUE, valueType: null, recordExtra: null},
  {label: "consent false", owner: {protocolParts: {consent: false}}, value: false, reason: R.PART_FALSE, valueType: null, recordExtra: " part=consent"},
  {label: "consent نصّ «true»", owner: {protocolParts: {consent: "true"}}, value: false, reason: R.PART_NOT_BOOLEAN, valueType: "string", recordExtra: " part=consent"},
  {label: "consent رقم 1", owner: {protocolParts: {consent: 1}}, value: false, reason: R.PART_NOT_BOOLEAN, valueType: "number", recordExtra: " part=consent"},
  {label: "consent null", owner: {protocolParts: {consent: null}}, value: false, reason: R.PART_NOT_BOOLEAN, valueType: "null", recordExtra: " part=consent"},
  {label: "consent خريطة", owner: {protocolParts: {consent: {enabled: true}}}, value: false, reason: R.PART_NOT_BOOLEAN, valueType: "object", recordExtra: " part=consent"},
  {label: "consent مصفوفة", owner: {protocolParts: {consent: [true]}}, value: false, reason: R.PART_NOT_BOOLEAN, valueType: "array", recordExtra: " part=consent"},
];

(async () => {
  // ═══ ١ — كل حالة: الردّ بمفاتيحه الخمسة، وسطر واحد بسببها، وبلا معرّف خامّ، وconsentEnabled ⟺ نجاح التسجيل التالي ═══
  const covered = new Set();
  let i = 0;
  for (const c of CASES) {
    i++;
    await clean();
    const SESSION = `session-join-consent-id-${String(i).padStart(4, "0")}`;
    const CODE = `NC-JC${i}X`;
    await seed({sessionId: SESSION, code: CODE, ownerDoc: c.owner});
    const {ret, threw, lines} = await join(CODE.toLowerCase(), authAnon(JOINER));
    const label = `[${c.label}]`;
    ok(threw === null, `${label} الانضمام ينجح`);
    deq(Object.keys(ret).sort(), KEYS, `${label} مفاتيح الردّ: الأربعة القائمة + consentEnabled`);
    deq(ret, {sessionId: SESSION, ownerId: OWNER, status: "scanning", evaluationEnabled: ret.evaluationEnabled, consentEnabled: c.value}, `${label} قيم الردّ`);
    eq(typeof ret.consentEnabled, "boolean", `${label} consentEnabled منطقية (لا غياب على السلك)`);
    eq(typeof ret.evaluationEnabled, "boolean", `${label} وevaluationEnabled كما كانت منطقية`);
    const found = consentLines(lines);
    eq(found.length, 1, `${label} سطر consentEnabled واحد`);
    eq(found[0].level, "log", `${label} بمستوى log`);
    const expected = `[joinScanSession] consentEnabled=${c.value} reason=${c.reason}` + (c.valueType ? ` valueType=${c.valueType}` : "") +
        ` session=${hashIdForLog(SESSION)} owner=${hashIdForLog(OWNER)} joiner=${hashIdForLog(JOINER)}`;
    eq(found[0].text, expected, `${label} السطر: القيمة وسببها المسمّى ونوع القيمة غير المنطقية والمعرّفات الثلاثة مُهشَّرة`);
    eq(evalLines(lines).length, 1, `${label} وسطر evaluationEnabled القائم لم يتغيّر عدده`);
    const all = lines.map((l) => l.text).join("\n");
    ok(![SESSION, OWNER, JOINER, CODE, CODE.toLowerCase()].some((v) => all.includes(v)), `${label} لا sessionId ولا ownerId ولا uid المنضمّ ولا رمز الجلسة خامّاً في أيّ سطر`);
    // الحقل ⟺ ما سيحكم به الخادم: التسجيل التالي ينجح إن وإلا فقط إن consentEnabled=true
    const rr = await record(SESSION, authAnon(JOINER));
    if (c.value) {
      ok(rr.threw === null && rr.ret.alreadyRecorded === false, `${label} consentEnabled=true ⟹ التسجيل يمرّ`);
    } else {
      ok(rr.threw !== null, `${label} consentEnabled=false ⟹ التسجيل يُرفض`);
      deq([rr.threw.code, rr.threw.message, rr.threw.details], ["failed-precondition", "CONSENT_PART_NOT_ENABLED", {reasonCode: "CONSENT_PART_NOT_ENABLED"}], `${label} بالرمز المسمّى`);
      const refused = rr.lines.filter((l) => l.text.startsWith("[recordScanConsent] refused "));
      eq(refused.length, 1, `${label} سطر رفض واحد`);
      ok(refused[0].text.endsWith(c.recordExtra), `${label} وسطر الرفض ينتهي بـ«${c.recordExtra}» — ${refused[0].text}`);
    }
    covered.add(c.reason);
  }
  deq([...covered].sort(), Object.values(R).sort(), "[١] كل الأسباب السبعة غُطّيت بحالة حقيقية على المحاكي");
  console.log(`تحقّق ١: ${CASES.length} حالة`);

  // ═══ ٢ — إعادة الانضمام: الردّ نفسه بالمفاتيح نفسها، والقيمة من المالك لحظة النداء (قراءة طازجة، لا تُخزَّن في الجلسة) ═══
  {
    await clean();
    const SESSION = "session-join-consent-rejoin";
    await seed({sessionId: SESSION, code: "NC-REJOIN", ownerDoc: {protocolParts: {consent: true}}});
    const first = await join("NC-REJOIN", authAnon(JOINER));
    eq(first.ret.consentEnabled, true, "[٢] الانضمام الأوّل: consentEnabled=true");
    const again = await join("NC-REJOIN", authAnon(JOINER));
    ok(again.threw === null, "[٢] إعادة الانضمام تنجح");
    deq(again.ret, first.ret, "[٢] الردّ نفسه تماماً");
    deq(Object.keys(again.ret), Object.keys(first.ret), "[٢] ومفاتيحه بالترتيب نفسه");
    eq(consentLines(again.lines).length, 1, "[٢] وسطر consentEnabled لإعادة الانضمام أيضاً (قيمة في الردّ)");
    const sessionDoc = (await db.collection("scanSessions").doc(SESSION).get()).data();
    ok(!("consentEnabled" in sessionDoc), "[٢] ولا consentEnabled مخزَّن في مستند الجلسة (يُقرأ من المالك عند كل نداء)");
    await db.collection("users").doc(OWNER).set({protocolParts: {consent: false}});
    const afterToggle = await join("NC-REJOIN", authAnon(JOINER));
    eq(afterToggle.ret.consentEnabled, false, "[٢] القيمة من حساب المالك لحظة النداء بعد إطفاء الجزء (لا نسخة قديمة)");
    deq({...afterToggle.ret, consentEnabled: true}, first.ret, "[٢] وما عداها من الردّ نفسه");
    ok(/ consentEnabled=false reason=PART_FALSE /.test(consentLines(afterToggle.lines)[0].text), "[٢] والسطر يقول PART_FALSE");
  }

  // ═══ ٣ — منضمّ بلا هوية: joiner=missing (القاعدة 22) ═══
  {
    await clean();
    const SESSION = "session-join-consent-noauth";
    await seed({sessionId: SESSION, code: "NC-NOAUTH", ownerDoc: {protocolParts: {consent: true}}});
    const {ret, threw, lines} = await join("NC-NOAUTH", null);
    ok(threw === null && ret.consentEnabled === true, "[٣] انضمام بلا هوية ينجح والقيمة true");
    eq(consentLines(lines)[0].text, `[joinScanSession] consentEnabled=true reason=PART_TRUE session=${hashIdForLog(SESSION)} owner=${hashIdForLog(OWNER)} joiner=missing`, "[٣] joiner=missing صريحة");
  }

  // ═══ ٤ — القيمة من المالك لا من المنضمّ ═══
  {
    await clean();
    await seed({sessionId: "session-join-consent-fromowner", code: "NC-FROMOWNER", ownerDoc: {protocolParts: {consent: false}}});
    await db.collection("users").doc(JOINER).set({protocolParts: {consent: true}});
    const {ret, lines} = await join("NC-FROMOWNER", authAnon(JOINER));
    eq(ret.consentEnabled, false, "[٤] القيمة من حساب المالك لا المنضمّ");
    ok(/ consentEnabled=false reason=PART_FALSE /.test(consentLines(lines)[0].text), "[٤] والسطر يقول PART_FALSE");
  }

  // ═══ ٥ — انضمام مرفوض لا يكتب السطر ═══
  {
    await clean();
    const bad = await join("NC-NO-SUCH-CODE", authAnon(JOINER));
    ok(bad.threw && bad.threw.code === "not-found", "[٥] كود غير موجود: not-found كما كان");
    eq(consentLines(bad.lines).length, 0, "[٥] ولا سطر consentEnabled");
    await seed({sessionId: "session-join-consent-expired", code: "NC-EXPIRED", ownerDoc: {protocolParts: {consent: true}}, expiresAt: new Date(Date.now() - 10 * 60 * 1000)});
    const expired = await join("NC-EXPIRED", authAnon(JOINER));
    ok(expired.threw && expired.threw.code === "deadline-exceeded", "[٥] جلسة منقضية: deadline-exceeded كما كان");
    eq(consentLines(expired.lines).length, 0, "[٥] ولا سطر consentEnabled لمرفوض");
  }

  console.log(`\njoinScanSessionConsentEnabled.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
