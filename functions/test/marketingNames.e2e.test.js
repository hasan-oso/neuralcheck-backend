// E2E test: خريطة الأسماء التجارية — setMarketingNames وgetMarketingNames الحقيقيتان عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-20، 2026-10-21 +03).
// **لا استبدال أيّ طبقة**: لا نداء مزوّد نموذج (الدالّتان لا تكلّمان مزوّداً) ولا حقن فشل — الدالّتان والمعاملات والمحاكي كما هي.
// **لا أسماء ولا طرازات حقيقية** («من بيانات يحرّرها المشرف»): البيانات وهمية موسومة (FAKE-*) وتُكتب في المحاكي وحده بنداء المشرف في الاختبار.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٥-أ-١ (:1527-1536) وdocs/PROTOCOL_CONTRACT.md §٢ A12 (يحمل نصّها المقتبس وكل شكل سلك وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ بوّابة المشرف: بلا auth · غير مشرف · غير مؤكَّد البريد · بلا بريد ⟵ رفض بالنصّين القائمين، بلا أثر، للدالّتين.
//   ٢ getMarketingNames قبل أيّ كتابة: ABSENT بلا مداخل افتراضية (الخريطة تبدأ غائبة)، وبيانات undefined/null/{} سواء.
//   ٣ setMarketingNames: أوّل كتابة (version 1 بلا history) بالمفاتيح الأربعة وبحروف عربية وتركية، التحديث بالطراز والإلحاق (بلا حذف ولا إعادة ترتيب)، history بـcreate لما سبق، «لم يتغيّر» بلا نسخة، ونداءان متزامنان.
//   ٤ الرفوض بأسبابها (مدخل · تكرار · سقف · مستند حاضر تالف)، بلا كتابة.
//   ٥ الحلّ resolveMarketingName على المستند الحقيقي: mapped وname_unmapped بأسبابها (طراز غير موجود · خريطة غائبة · تالفة).
//   ٦ `reports.deviceMarketingName` القائم لم يُمسّ (E14)، ولا طراز ولا اسم في أيّ سطر سجلّ، ولا حذف.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/marketingNames.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {db, ADMIN_EMAILS} = require("../src/utils/admin");
const {setMarketingNames, getMarketingNames} = require("../src/admin/marketingNamesAdmin");
const {readMarketingNamesDocument, resolveMarketingName} = require("../src/protocol/marketingNames");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const TS = (v) => v && typeof v.toMillis === "function";
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));
const ADMIN_UID = "admin-mn-1";
const ADMIN = {uid: ADMIN_UID, token: {email: ADMIN_EMAILS[0], email_verified: true}};

// التقاط سطور السجلّ **آمن للتزامن** (نداءان متزامنان في مشهد السباق): الخطّاف يُركَّب عند أوّل التقاط ويُنزَع عند آخر استعادة، وسطور كل نداء شريحته من المصفوفة المشتركة.
let hookDepth = 0;
let hookReal = null;
const hookLines = [];
function capture() {
  if (hookDepth === 0) {
    hookReal = {warn: console.warn, error: console.error, log: console.log, info: console.info};
    for (const level of Object.keys(hookReal)) console[level] = (...a) => { hookLines.push({level, text: a.join(" ")}); };
  }
  hookDepth++;
  const start = hookLines.length;
  let end = null;
  return {
    get lines() { return hookLines.slice(start, end === null ? undefined : end); },
    texts() { return this.lines.map((l) => l.text); },
    restore() {
      end = hookLines.length;
      hookDepth--;
      if (hookDepth === 0) for (const level of Object.keys(hookReal)) console[level] = hookReal[level];
    },
  };
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
const runSet = (d, auth = ADMIN) => call(() => setMarketingNames.run({data: d, auth, rawRequest: {headers: {}}}));
const runGet = (d, auth = ADMIN) => call(() => getMarketingNames.run({data: d, auth, rawRequest: {headers: {}}}));
const setE = (entries, auth) => runSet({entries}, auth);
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };
const E = (model, over = {}) => ({model, ar: `FAKE-AR-${model}`, tr: `FAKE-TR-${model}`, en: `FAKE-EN-${model}`, ...over});
const SET = "setMarketingNames";
const GET = "getMarketingNames";
const BAD = (reason) => ({code: "invalid-argument", message: reason, reasonCode: reason});

function expectRefusal(label, r, {code = "invalid-argument", reasonCode, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, reasonCode, {reasonCode}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, SET).filter((t) => t.startsWith(`[${SET}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${SET}] refused reason=${reasonCode} caller=${sid(ADMIN_UID)}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${reasonCode}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا قيمة خامّة (${id}) في أيّ سطر`);
  return lines[0];
}

(async () => {
  // ═══ ١ — بوّابة المشرف ═══
  {
    const before = {marketing: await count("marketingNames")};
    const calls = [["setMarketingNames", (auth) => setE([E("FAKE-GATE")], auth)], ["getMarketingNames", (auth) => runGet({}, auth)]];
    for (const [name, fn] of calls) {
      const none = await fn(null);
      deq([none.threw && none.threw.code, none.threw && none.threw.message], ["unauthenticated", "غير مصادق"], `[١] ${name}: بلا auth ⟵ غير مصادق`);
      for (const [label, auth] of [
        ["غير مشرف", {uid: "u-not-admin", token: {email: "someone@example.com", email_verified: true}}],
        ["مشرف غير مؤكَّد البريد", {uid: "u-unverified", token: {email: ADMIN_EMAILS[0], email_verified: false}}],
        ["مشرف بلا ادّعاء التحقّق", {uid: "u-noclaim", token: {email: ADMIN_EMAILS[0]}}],
        ["بلا بريد", {uid: "u-noemail", token: {email_verified: true}}],
        ["email_verified نصّ", {uid: "u-str", token: {email: ADMIN_EMAILS[0], email_verified: "true"}}],
      ]) {
        const r = await fn(auth);
        deq([r.threw && r.threw.code, r.threw && r.threw.message], ["permission-denied", "صلاحية Admin مطلوبة"], `[١] ${name}: ${label} ⟵ صلاحية Admin مطلوبة`);
      }
    }
    deq({marketing: await count("marketingNames")}, before, "[١] كل الرفوض أعلاه بلا أثر");
  }

  // ═══ ٢ — getMarketingNames قبل أيّ كتابة ═══
  {
    const ref = await runGet({});
    ok(ref.threw === null, "[٢] المشرف يقرأ");
    deq(Object.keys(ref.ret).sort(), ["anomaly", "entries", "limits", "state", "updatedAtMs", "updatedBy", "version"], "[٢] سبعة مفاتيح بالضبط");
    deq([ref.ret.state, ref.ret.anomaly, ref.ret.version, ref.ret.entries, ref.ret.updatedAtMs, ref.ret.updatedBy], ["ABSENT", null, null, [], null, null], "[٢] قبل أيّ كتابة: ABSENT، ولا مداخل (الخريطة تبدأ غائبة: لا مدخل في الكود ولا بذرة)، والنسخة null");
    deq(ref.ret.limits, {maxEntries: 1000, modelMaxLength: 64, nameMaxLength: 120}, "[٢] الحدود");
    eq(named(ref.texts, GET)[0], `[${GET}] served state=ABSENT version=NONE entries=0 caller=${sid(ADMIN_UID)}`, "[٢] سطر الخدمة: أعداد وحدها");
    for (const [label, d] of [["undefined", undefined], ["null", null], ["{}", {}], ["كائن بمفاتيح لا تعنيها", {entries: [E("x")], version: 9}]]) {
      const r = await runGet(d);
      ok(r.threw === null, `[٢] بيانات ${label}: يُقبل`);
      deq(r.ret, ref.ret, `[٢] بيانات ${label}: الردّ نفسه (الدالّة لا تقرأ المدخل)`);
    }
    eq((await readMarketingNamesDocument(null)).state, "ABSENT", "[٢] والقارئ يقرؤه ABSENT");
    deq(resolveMarketingName({model: "FAKE-1", source: readMarketingNamesDocument((await getDoc("marketingNames", "current")).exists ? await data("marketingNames", "current") : null)}),
      {state: "name_unmapped", model: "FAKE-1", names: null, reason: "MAP_ABSENT", version: null}, "[٢] **الحلّ على خريطة غائبة** ⟵ name_unmapped بسبب MAP_ABSENT (لا اسم افتراضي)");
  }

  // ═══ ٣ — setMarketingNames ═══
  {
    // ٣-أ: أوّل كتابة (بأسماء عربية وتركية)
    const first = [
      {model: "FAKE-M1", ar: "اسم تجريبي أول", tr: "Deneme adı bir", en: "Test name one"},
      {model: "FAKE/M 2", ar: "اسم تجريبي ثانٍ", tr: "Deneme adı iki", en: "Test name two"},
    ];
    const r1 = await setE(first);
    ok(r1.threw === null, `[٣] أوّل كتابة نجحت (${r1.threw && r1.threw.message})`);
    deq(r1.ret, {changed: true, version: 1, added: 2, updated: 0}, "[٣] الردّ: version 1 وعدد المُلحَق والمُحدَّث");
    const d1 = await data("marketingNames", "current");
    deq(Object.keys(d1).sort(), ["entries", "updatedAt", "updatedBy", "version"], "[٣] المستند: entries وversion وupdatedAt وupdatedBy وحدها");
    deq([d1.version, d1.entries, d1.updatedBy], [1, first, sid(ADMIN_UID)], "[٣] المداخل بمفاتيحها الأربعة وبحروفها العربية والتركية كما أُرسلت، والمشرف مُهشَّراً");
    ok(TS(d1.updatedAt), "[٣] updatedAt وقت الخادم");
    eq(await count("marketingNames/current/history"), 0, "[٣] أوّل كتابة بلا history");
    deq(named(r1.texts, SET), [`[${SET}] written version=1 added=2 updated=0 caller=${sid(ADMIN_UID)}`], "[٣] سطر الكتابة: أعداد وحدها");
    note("setMarketingNames — كتابة", named(r1.texts, SET));
    ok(!r1.texts.join("\n").includes("FAKE") && !r1.texts.join("\n").includes("اسم تجريبي"), "[٣] **لا طراز ولا اسم في أيّ سطر سجلّ**");
    const g1 = await runGet({});
    deq([g1.ret.state, g1.ret.version, g1.ret.entries, g1.ret.updatedBy, TS({toMillis: () => g1.ret.updatedAtMs}) && typeof g1.ret.updatedAtMs], ["PRESENT", 1, first, sid(ADMIN_UID), "number"], "[٣] getMarketingNames تعيد المداخل بترتيبها ونسخة 1");
    eq(named(g1.texts, GET)[0], `[${GET}] served state=PRESENT version=1 entries=2 caller=${sid(ADMIN_UID)}`, "[٣] وسطر الخدمة");

    // ٣-ب: تحديث + إلحاق
    const r2 = await setE([E("FAKE-M3"), {model: "FAKE-M1", ar: "اسم معدَّل", tr: "Deneme adı bir", en: "Test name one"}]);
    deq(r2.ret, {changed: true, version: 2, added: 1, updated: 1}, "[٣] تحديث مدخل وإلحاق آخر ⟵ version 2، مُلحَق 1 ومُحدَّث 1");
    const d2 = await data("marketingNames", "current");
    deq(d2.entries.map((e) => e.model), ["FAKE-M1", "FAKE/M 2", "FAKE-M3"], "[٣] الترتيب: الموجود في موضعه، والجديد في الآخر (لا إعادة ترتيب)");
    deq([d2.entries[0].ar, d2.entries[1].ar], ["اسم معدَّل", "اسم تجريبي ثانٍ"], "[٣] المدخل المُحدَّث بالطراز، وغير المذكور بحاله (رقعة لا استبدال)");
    const h1 = await data("marketingNames/current/history", "1");
    deq([h1.version, h1.entries, h1.updatedBy, h1.supersededByVersion, h1.supersededBy], [1, first, sid(ADMIN_UID), 2, sid(ADMIN_UID)], "[٣] history/1 = المستند السابق كاملاً + supersededByVersion + supersededBy مُهشَّراً");
    ok(TS(h1.supersededAt) && TS(h1.updatedAt), "[٣] وsupersededAt وupdatedAt السابق");
    eq(await count("marketingNames/current/history"), 1, "[٣] نسخة سابقة واحدة");

    // ٣-ج: لم يتغيّر
    const before = await data("marketingNames", "current");
    const r3 = await setE([E("FAKE-M3"), {model: "FAKE-M1", ar: "اسم معدَّل", tr: "Deneme adı bir", en: "Test name one"}]);
    deq(r3.ret, {changed: false, version: 2, added: 0, updated: 0}, "[٣] القيم نفسها ⟵ changed:false بلا رفع نسخة");
    const after = await data("marketingNames", "current");
    eq(after.updatedAt.toMillis(), before.updatedAt.toMillis(), "[٣] والمستند لم يُكتب (updatedAt بحاله)");
    eq(await count("marketingNames/current/history"), 1, "[٣] ولا history جديد");
    eq(named(r3.texts, SET)[0], `[${SET}] unchanged version=2 caller=${sid(ADMIN_UID)}`, "[٣] سطر «لم يتغيّر»");

    // ٣-د: الأسماء تُشذَّب
    const r4 = await setE([{model: "FAKE-M4", ar: "  اسم  ", tr: " x ", en: " y "}]);
    deq(r4.ret, {changed: true, version: 3, added: 1, updated: 0}, "[٣] مدخل بأسماء بمسافات ⟵ يُكتب");
    deq((await data("marketingNames", "current")).entries[3], {model: "FAKE-M4", ar: "اسم", tr: "x", en: "y"}, "[٣] الأسماء الثلاثة مشذَّبة (والطراز كما أُرسل)");
    eq((await data("marketingNames/current/history", "2")).version, 2, "[٣] history/2 = النسخة 2");

    // ٣-هـ: ما كان حاضراً يبقى
    const cur = (await data("marketingNames", "current")).entries;
    for (const m of ["FAKE-M1", "FAKE/M 2", "FAKE-M3", "FAKE-M4"]) ok(cur.some((e) => e.model === m), `[٣] ${m} باقٍ (لا حذف مدخل)`);

    // ٣-و: نداءان متزامنان بطرازين مختلفين: لا ضياع
    const [a, b] = await Promise.all([setE([E("FAKE-RACE-A")]), setE([E("FAKE-RACE-B")])]);
    ok(a.threw === null && b.threw === null, "[٣] النداءان المتزامنان ينجحان");
    const dRace = await data("marketingNames", "current");
    ok(dRace.entries.some((e) => e.model === "FAKE-RACE-A") && dRace.entries.some((e) => e.model === "FAKE-RACE-B"), "[٣] المدخلان كلاهما في المستند (المعاملة تُعيد القراءة: لا يضيع أحدهما)");
    eq(dRace.version, 5, "[٣] والنسخة 5 (3 + نداءان)");
    eq(await count("marketingNames/current/history"), 4, "[٣] وأربع نسخ سابقة (1 · 2 · 3 · 4)");
    const h4 = await data("marketingNames/current/history", "4");
    eq(h4.version, 4, "[٣] وhistory/4 هي النسخة 4");
  }

  // ═══ ٤ — الرفوض ═══
  {
    const cur = JSON.stringify(await data("marketingNames", "current"));
    const hist = await count("marketingNames/current/history");
    const cases = [
      ["entries غائبة", undefined, "MARKETING_NAMES_ENTRIES_REQUIRED", ""],
      ["entries ليست مصفوفة", {}, "MARKETING_NAMES_ENTRIES_REQUIRED", ""],
      ["entries فارغة", [], "MARKETING_NAMES_ENTRIES_REQUIRED", ""],
      ["مدخل ليس كائناً", ["x"], "MARKETING_NAMES_ENTRY_INVALID", " index=0 cause=ENTRY_NOT_AN_OBJECT"],
      ["مفتاح زائد", [{...E("FAKE-X"), active: true}], "MARKETING_NAMES_ENTRY_INVALID", " index=0 cause=ENTRY_UNKNOWN_KEY"],
      ["tr غائب", [E("FAKE-OK"), {model: "FAKE-X", ar: "a", en: "c"}], "MARKETING_NAMES_ENTRY_INVALID", " index=1 cause=TR_MISSING"],
      ["model بمسافة", [E(" FAKE-X")], "MARKETING_NAMES_ENTRY_INVALID", " index=0 cause=MODEL_NOT_TRIMMED"],
      ["en فارغ", [E("FAKE-X", {en: "  "})], "MARKETING_NAMES_ENTRY_INVALID", " index=0 cause=EN_INVALID"],
      ["ar أطول من الحدّ", [E("FAKE-X", {ar: "ع".repeat(121)})], "MARKETING_NAMES_ENTRY_INVALID", " index=0 cause=AR_INVALID"],
      ["طراز مكرَّر", [E("FAKE-D"), E("FAKE-D", {ar: "آخر"})], "MARKETING_NAMES_DUPLICATE_MODEL", " index=1"],
      ["فوق السقف في نداء واحد", new Array(1001).fill(0).map((_, i) => E(`FAKE-C${i}`)), "MARKETING_NAMES_TOO_MANY_ENTRIES", " count=1001"],
    ];
    for (const [label, entries, reasonCode, logExtra] of cases) {
      expectRefusal(`[٤] ${label}`, await setE(entries), {reasonCode, logExtra, ids: ["FAKE-X", "FAKE-OK"]});
    }
    for (const bad of [undefined, null, "x", 5, []]) {
      const r = await runSet(bad);
      eq(r.threw && r.threw.details.reasonCode, "MARKETING_NAMES_ENTRIES_REQUIRED", `[٤] data ${JSON.stringify(bad)} ⟵ ENTRIES_REQUIRED`);
    }
    eq(JSON.stringify(await data("marketingNames", "current")), cur, "[٤] المستند بحاله بعد كل الرفوض");
    eq(await count("marketingNames/current/history"), hist, "[٤] ولا history جديد");
    // ما بعد الدمج فوق السقف: نملأ حتى السقف بنداء مسموح ثمّ نُلحق واحداً
    const filler = new Array(1000 - (await data("marketingNames", "current")).entries.length).fill(0).map((_, i) => E(`FAKE-FILL${i}`));
    const rf = await setE(filler);
    ok(rf.threw === null && rf.ret.changed === true, "[٤] ملء الخريطة حتى السقف (1000) ينجح");
    const over = await setE([E("FAKE-OVER")]);
    expectRefusal("[٤] إلحاق بعد بلوغ السقف", over, {reasonCode: "MARKETING_NAMES_TOO_MANY_ENTRIES", logExtra: " total=1001", ids: ["FAKE-OVER"]});
    eq((await data("marketingNames", "current")).entries.length, 1000, "[٤] وما زالت 1000 (لا كتابة)");
    const upd = await setE([E("FAKE-FILL0", {ar: "اسم بعد السقف"})]);
    deq([upd.threw, upd.ret.changed, upd.ret.updated], [null, true, 1], "[٤] وتحديث مدخل موجود عند السقف مقبول (لا يزيد العدد)");
  }

  // ═══ ٥ — الحلّ على المستند الحقيقي ═══
  {
    const doc = await data("marketingNames", "current");
    const src = readMarketingNamesDocument(doc);
    eq(src.state, "PRESENT", "[٥] المستند الحقيقي يُقرأ PRESENT");
    const hit = resolveMarketingName({model: "FAKE-M1", source: src});
    deq([hit.state, hit.names, hit.reason, hit.version === doc.version], ["mapped", {ar: "اسم معدَّل", tr: "Deneme adı bir", en: "Test name one"}, null, true], "[٥] طراز موجود ⟵ mapped بالأسماء الثلاثة ونسخة الخريطة");
    deq(resolveMarketingName({model: "FAKE/M 2", source: src}).state, "mapped", "[٥] وطراز يحمل `/` ومسافة يُحلّ (لذلك مصفوفة لا معرّف مستند)");
    const miss = resolveMarketingName({model: "FAKE-NOT-THERE", source: src});
    deq([miss.state, miss.model, miss.names, miss.reason], ["name_unmapped", "FAKE-NOT-THERE", null, "MODEL_NOT_IN_MAP"], "[٥] **طراز غير موجود** ⟵ name_unmapped والطراز كما هو (يُعرض Build.MODEL)");
    eq(resolveMarketingName({model: "fake-m1", source: src}).state, "name_unmapped", "[٥] والمطابقة حرفيّة (حالة الأحرف)");
    // خريطة تالفة
    await db.collection("marketingNames").doc("current").set({...doc, version: 0});
    const bad = readMarketingNamesDocument(await data("marketingNames", "current"));
    deq([bad.state, bad.anomaly], ["UNREADABLE", "VERSION_UNUSABLE"], "[٥] مستند بنسخة تالفة ⟵ UNREADABLE");
    eq(resolveMarketingName({model: "FAKE-M1", source: bad}).reason, "MAP_UNREADABLE", "[٥] والحلّ name_unmapped بسبب MAP_UNREADABLE");
    const g = await runGet({});
    deq([g.ret.state, g.ret.anomaly, g.ret.version, g.ret.entries], ["UNREADABLE", "VERSION_UNUSABLE", null, []], "[٥] getMarketingNames: UNREADABLE بسببه، بلا مداخل (الغائب غائب)");
    const w = await setE([E("FAKE-AFTER-BAD")]);
    expectRefusal("[٥] الكتابة فوق مستند حاضر تالف", w, {code: "failed-precondition", reasonCode: "MARKETING_NAMES_CURRENT_UNREADABLE", logExtra: " anomaly=VERSION_UNUSABLE", ids: ["FAKE-AFTER-BAD"]});
    deq((await data("marketingNames", "current")).version, 0, "[٥] والمستند التالف بحاله (لا يُخمَّن ما بعده: إصلاحه يدوي)");
    await db.collection("marketingNames").doc("current").set(doc); // إعادة المستند السليم لباقي المشاهد (بيانات الاختبار وحدها)
  }

  // ═══ ٦ — history لا يُكتب فوقه، و`reports.deviceMarketingName` لم يُمسّ ═══
  {
    await db.collection("reports").doc("rep-mn-1").set({deviceMarketingName: "Existing Marketing Name", rawDeviceModel: "FAKE-M1", userId: "u-mn"});
    const repBefore = JSON.stringify(await data("reports", "rep-mn-1"));
    const cur = await data("marketingNames", "current");
    const nextVersion = cur.version + 1;
    await db.collection("marketingNames").doc("current").collection("history").doc(String(cur.version)).set({sentinel: "pre-existing"});
    const r = await setE([E("FAKE-M1", {ar: "اسم يتصادم مع نسخة محفوظة"})]); // تحديث (لا إلحاق): الخريطة عند السقف بعد المشهد ٤
    ok(r.threw !== null, "[٦] نسخة سابقة موجودة بالمعرّف نفسه ⟵ تفشل المعاملة (create لا set: لا يُكتب فوق نسخة محفوظة)");
    eq((await data("marketingNames/current/history", String(cur.version))).sentinel, "pre-existing", "[٦] والنسخة الموجودة بحالها");
    eq((await data("marketingNames", "current")).version, cur.version, "[٦] والحاضر لم يتغيّر (المعاملة سقطت كلّها بلا أثر)");
    ok(named(r.texts, SET).some((t) => t.startsWith(`[${SET}] unexpected failure caller=${sid(ADMIN_UID)} [`)), "[٦] والفشل غير المتوقَّع بسطر مسمّى بلا نصّ مزوّد ");
    eq(JSON.stringify(await data("reports", "rep-mn-1")), repBefore, "[٦] **`reports.deviceMarketingName` القائم لم يُمسّ** (E14: لا يمسّ التقارير)");
    ok(nextVersion > 0, "[٦] (تمهيد) رقم النسخة التالي");
  }

  // ═══ ٧ — لا حذف ═══
  {
    const hist = await count("marketingNames/current/history");
    ok(hist >= 5, `[٧] النسخ السابقة تراكمت ولم تتناقص (${hist})`);
    ok(await exists("marketingNames", "current"), "[٧] والمستند الحاضر باقٍ");
  }

  console.log("\nمرصود (سطور السجلّ الجديدة):\n" + OBSERVED.join("\n"));
  console.log(`\nmarketingNames.e2e.test.js: ${n}/${n} assertions passed`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
