// E2E test: استمارة الفنّي v2 — submitTechnicianForm وgetTechnicianFormConfig وrecordReportFirstOpened الحقيقية عبر `.run()` على محاكي Firestore (القاعدة 37) (S-P6-08، 2026-10-18 +03).
// **لا استبدال أيّ طبقة**: لا نداء مزوّد نموذج (الدوالّ الثلاث لا تكلّم مزوّداً) ولا حقن فشل — الدوالّ والمعاملات والمحاكي كما هي. معرّفات الفنّيين وأسماء عرضهم **وهمية موسومة** (fake-tech-* / FAKE-TECHNICIAN-*): لا أسماء ولا بيانات فنّيين حقيقية.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠ (:1179-1376) وdocs/PROTOCOL_CONTRACT.md §٢ A5 وA7 (يحمل نصّها المقتبس وما بُني وما عُلِّق).
//
// ما يثبته:
//   ١ submitTechnicianForm: مستند technicianForms/{sessionId}_{slot} بحقوله الاثنين والثلاثين (الإجابات كما أُرسلت، والمشتقّات الخادمية)، والردّ {sessionId, slot, formState} وحدها («لا يُعيد الخادم استمارةً لأيّ عميل»)، وسطر النجاح بلا ملاحظة ولا اسم.
//   ٢ القفل: الإرسال الثاني للفتحة نفسها FORM_ALREADY_SUBMITTED ولا يمسّ المستند، وسباق إرسالين متزامنين ينجح واحد منهما.
//   ٣ الفتحة الثانية: لا تُقبل إلا لجلسة سُحبت للتقييم المزدوج (غياب السحب · لم تُختَر · سحب مشوَّه ⟵ FORM_SLOT_INVALID بسبب مسمّى)، والفنّي نفسه في الفتحتين مرفوض من أيّ فتحة بدأ.
//   ٤ الفنّي: غير موجود · موقوف · لمالك آخر · active غائب ⟵ FORM_TECHNICIAN_UNKNOWN بحالة مسمّاة في السجلّ (لا اسم ولا معرّف خامّ).
//   ٥ التفعيل: المحلّ بلا evaluationEnabled ⟵ FORM_NOT_ENABLED بسبب القراءة (أربع حالات).
//   ٦ الجلسة: غير المالك (المنضمّ والغريب) وجلسة غير موجودة بالردّ نفسه؛ pending · cancelled · expired · حالة مجهولة ⟵ أسبابها؛ scanning منقضية ⟵ تُكتب «منتهية» ثم تُرفض؛ expiresAt غائب ⟵ بلا كتابة؛ completed تُقبل (إرسال متأخّر).
//   ٧ مُدخلات الاستمارة ترفضها الدالّة الحقيقية بأسبابها (E5) بلا كتابة.
//   ٨ العمى بالمسار الكامل: لا تقرير · المرجع أوّل فتح · الاحتياطي (إنشاء التقرير) · غياب المرجعين · ساعة الجهاز للإرسال دون شبكة.
//   ٩ recordReportFirstOpened: المالك والمنضمّ، وأوّل فتح يربح، والرفض المسمّى (غريب · جلسة غير مكتملة · لا تقرير).
//   ١٠ getTechnicianFormConfig: غير مفعَّل ⟵ not_enabled؛ المفعَّل ⟵ حالة الفتحتين وقائمة الفنّيين الفعّالين لهذا المالك وحده مرتّبة، وترتيب الأعراض الافتراضي، وSETTINGS_ABSENT؛ لا محتوى استمارة.
//   ١١ لا حذف، ولا معرّف خامّ ولا ملاحظة ولا اسم في أيّ سطر جديد.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/technicianForm.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {admin, db} = require("../src/utils/admin");
const {submitTechnicianForm, getTechnicianFormConfig, recordReportFirstOpened} = require("../src/evaluations/technicianForm");
const {hashIdForLog} = require("../src/utils/logRedaction");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const MIN = 60 * 1000;
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const PAST = (m = 10) => new Date(Date.now() - m * MIN);
const TS = (v) => v && typeof v.toMillis === "function";
const ts = (ms) => admin.firestore.Timestamp.fromMillis(ms);
const sid = (id) => hashIdForLog(id);
const getDoc = (col, id) => db.collection(col).doc(id).get();
const data = async (col, id) => (await getDoc(col, id)).data();
const exists = async (col, id) => (await getDoc(col, id)).exists;
const count = async (col) => (await db.collection(col).get()).size;
const seedOwner = (uid, extra = {}) => db.collection("users").doc(uid).set({scansRemaining: 5, scansTotal: 5, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000), evaluationEnabled: true, ...extra});
const seedTech = (id, fields) => db.collection("technicians").doc(id).set(fields);
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const settle = (p) => p.then((value) => ({ok: true, value}), (error) => ({ok: false, error}));

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
const CHIPS = ["battery_dies_before_day_end", "battery_jumps_or_shuts_down", "battery_swollen", "hot_while_charging", "charging_slow", "slow_or_freezes_daily",
  "restarts_under_load", "heats_fast_in_use", "system_heat_warning", "game_stutter_after_minutes", "game_screen_lines_or_flicker", "games_freeze_or_close"];
const GOOD = () => ({
  formContractVersion: 2, slot: 1, technicianId: "fake-tech-A",
  grades: {battery: "good", performance: "excellent", thermal: "good", overall: "good"},
  functional: {screen_touch: "works", camera: "works", audio: "works", buttons: "works", charging: "works", network: "works"},
  defects: {replaced_screen: "works", water_damage: "works", prior_repair: "works"},
  symptoms: ["none_noticed"], symptomOrderShown: [...CHIPS], known_fault_before_scan: false,
  batteryHealth: {kind: "percent", percent: 92, stateKey: null}, gameTried: true, observedNote: null,
  openedAt: 1000, firstTapAt: 2000, perAnswerAt: [2000, 5000], submittedAt: 20000,
});
const submit = (uid, sessionId, mut = () => {}, authOverride) => call(() => {
  const d = {...GOOD(), sessionId};
  mut(d);
  return submitTechnicianForm.run({data: d, auth: authOverride === undefined ? {uid, token: {}} : authOverride, rawRequest: {headers: {}}});
});
const config = (uid, sessionId, authOverride) => call(() => getTechnicianFormConfig.run({data: {sessionId}, auth: authOverride === undefined ? {uid, token: {}} : authOverride, rawRequest: {headers: {}}}));
const opened = (uid, sessionId, authOverride) => call(() => recordReportFirstOpened.run({data: {sessionId}, auth: authOverride === undefined ? {uid, token: {}} : authOverride, rawRequest: {headers: {}}}));
const named = (texts, fn) => texts.filter((t) => t.startsWith(`[${fn}] `));
const OBSERVED = [];
const note = (label, lines) => { OBSERVED.push(`  ${label}\n${lines.map((l) => `    ${l}`).join("\n")}`); };

function expectRefusal(label, r, {fn, code, message, reasonCode, logReason, logExtra = "", ids = []}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  deq([r.threw.code, r.threw.message, r.threw.details], [code, message, {reasonCode}], `${label}: الرمز والنصّ والتفصيل`);
  const lines = named(r.texts, fn).filter((t) => t.startsWith(`[${fn}] refused `));
  eq(lines.length, 1, `${label}: سطر رفض مسمّى واحد`);
  ok(lines[0].startsWith(`[${fn}] refused reason=${logReason}`) && lines[0].endsWith(logExtra), `${label}: السطر بسببه ${logReason}${logExtra} — ${lines[0]}`);
  for (const id of ids) ok(!r.texts.join("\n").includes(id), `${label}: لا معرّف خامّ (${id.slice(0, 8)}…) في أيّ سطر`);
  return lines[0];
}
const SUBMIT = "submitTechnicianForm";
const INPUT = (reason) => ({fn: SUBMIT, code: "invalid-argument", message: reason, reasonCode: reason, logReason: reason});
const GONE = {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_PARTICIPANT"};
const ALL_KEYS = ["formContractVersion", "formState", "sessionId", "slot", "ownerId", "technicianId", "grades", "functional", "defects", "symptoms", "symptomOrderShown", "known_fault_before_scan", "batteryHealth",
  "batteryHealthState", "gameTried", "observedNote", "openedAt", "firstTapAt", "perAnswerAt", "submittedAt", "receivedAt", "sentOffline", "answersBeforePrompt", "answersAfterPrompt", "promptAction",
  "allFourGradesEqual", "fast", "contradictionRules", "blindness", "blindnessBasis", "clock", "reportFirstOpenedAt"];

(async () => {
  // ═══ ١ — الإرسال الصحيح ═══
  const OWN = "own-tf-1";
  await seedOwner(OWN);
  await seedTech("fake-tech-A", {ownerId: OWN, active: true, displayName: "FAKE-TECHNICIAN-A"});
  await seedTech("fake-tech-B", {ownerId: OWN, active: true, displayName: "FAKE-TECHNICIAN-B"});
  await seedSession("sess-tf-1", {ownerId: OWN, status: "scanning", code: "NC-TF0001", expiresAt: FUTURE(), joinedBy: "joiner-tf-1", scanId: null, deviceModel: null});
  {
    const r = await submit(OWN, "sess-tf-1");
    ok(r.threw === null, `[١] الإرسال نجح (${r.threw && r.threw.message})`);
    deq(r.ret, {sessionId: "sess-tf-1", slot: 1, formState: "submitted"}, "[١] الردّ {sessionId, slot, formState} وحدها — لا محتوى استمارة");
    const f = await data("technicianForms", "sess-tf-1_1");
    deq(Object.keys(f).sort(), [...ALL_KEYS].sort(), "[١] مستند الاستمارة: اثنان وثلاثون حقلاً بالضبط");
    deq([f.formContractVersion, f.formState, f.sessionId, f.slot, f.ownerId, f.technicianId], [2, "submitted", "sess-tf-1", 1, OWN, "fake-tech-A"], "[١] الربط والهويّة");
    deq(f.grades, GOOD().grades, "[١] الدرجات كما أُرسلت");
    deq(f.functional, GOOD().functional, "[١] القائمة الوظيفية");
    deq(f.defects, GOOD().defects, "[١] العيوب الثلاثة");
    deq([f.symptoms, f.symptomOrderShown, f.known_fault_before_scan, f.batteryHealth, f.batteryHealthState, f.gameTried, f.observedNote], [["none_noticed"], CHIPS, false, {kind: "percent", percent: 92, stateKey: null}, "answered", true, null], "[١] الأعراض وترتيبها وصحّة البطارية واللعبة");
    deq([f.openedAt, f.firstTapAt, f.perAnswerAt, f.submittedAt], [1000, 2000, [2000, 5000], 20000], "[١] أزمنة الجهاز كما أُرسلت");
    ok(TS(f.receivedAt) && Math.abs(f.receivedAt.toMillis() - Date.now()) < 120000, "[١] receivedAt وقت الخادم");
    deq([f.allFourGradesEqual, f.fast, f.contradictionRules], [false, false, []], "[١] المشتقّات: درجات غير متساوية، 18 ثانية ليست fast، لا تناقض");
    deq([f.blindness, f.blindnessBasis, f.clock, f.reportFirstOpenedAt, f.sentOffline], ["blind", "report_not_yet_created", null, null, false], "[١] الإرسال قبل أيّ تقرير ⟵ blind بأساس مسمّى وبلا ساعة ولا فتح");
    deq([f.answersBeforePrompt, f.answersAfterPrompt, f.promptAction], [null, null, null], "[١] بلا تنبيه تناقض: الثلاثة null");
    const lines = named(r.texts, SUBMIT);
    deq(lines, [`[${SUBMIT}] submitted session=${sid("sess-tf-1")} slot=1 technician=${sid("fake-tech-A")} caller=${sid(OWN)} blindness=blind basis=report_not_yet_created clock=null fast=false equal=false contradictions=0 offline=false`], "[١] سطر النجاح الوحيد: المعرّفات مُهشَّرة والمشتقّات، بلا ملاحظة ولا اسم");
    ok(!r.texts.join("\n").includes("FAKE-TECHNICIAN") && !r.texts.join("\n").includes("sess-tf-1") && !r.texts.join("\n").includes("fake-tech-A") && !r.texts.join("\n").includes(OWN), "[١] لا اسم فنّي ولا معرّف خامّ في أيّ سطر");
    note("submitTechnicianForm — نجاح", lines);
    eq((await data("scanSessions", "sess-tf-1")).status, "scanning", "[١] مستند الجلسة لم يُمسّ");
  }

  // ═══ ٢ — القفل ═══
  {
    const before = await data("technicianForms", "sess-tf-1_1");
    const r = await submit(OWN, "sess-tf-1", (d) => { d.grades.overall = "weak"; d.observedNote = "تغيير"; });
    const line = expectRefusal("[٢] الإرسال الثاني للفتحة نفسها", r, {fn: SUBMIT, code: "already-exists", message: "FORM_ALREADY_SUBMITTED", reasonCode: "FORM_ALREADY_SUBMITTED", logReason: "FORM_ALREADY_SUBMITTED", ids: ["sess-tf-1", OWN]});
    note("submitTechnicianForm — قفل", [line]);
    deq(await data("technicianForms", "sess-tf-1_1"), before, "[٢] **المستند لم يُمسّ** (الإرسال نهائي، ولا set فوقه)");
    // سباق إرسالين متزامنين لفتحة جديدة
    await seedSession("sess-tf-2", {ownerId: OWN, status: "scanning", code: "NC-TF0002", expiresAt: FUTURE(), joinedBy: "joiner-tf-2", scanId: null});
    const [a, b] = await Promise.all([submit(OWN, "sess-tf-2", (d) => { d.technicianId = "fake-tech-A"; }), submit(OWN, "sess-tf-2", (d) => { d.technicianId = "fake-tech-B"; })]);
    const wins = [a, b].filter((x) => x.threw === null);
    const losses = [a, b].filter((x) => x.threw !== null);
    eq(wins.length, 1, "[٢] سباق إرسالين متزامنين لفتحة واحدة: ينجح واحد فقط");
    eq(losses[0].threw.details.reasonCode, "FORM_ALREADY_SUBMITTED", "[٢] والآخر يُرفض بقفل الإرسال");
    eq((await db.collection("technicianForms").where("sessionId", "==", "sess-tf-2").get()).size, 1, "[٢] ومستند واحد في المحاكي");
  }

  // ═══ ٣ — الفتحة الثانية ═══
  {
    await seedSession("sess-tf-3", {ownerId: OWN, status: "scanning", code: "NC-TF0003", expiresAt: FUTURE(), joinedBy: "joiner-tf-3", scanId: null});
    const slot2 = (extra = () => {}) => submit(OWN, "sess-tf-3", (d) => { d.slot = 2; d.technicianId = "fake-tech-B"; extra(d); });
    const ids = ["sess-tf-3", OWN];
    expectRefusal("[٣] الفتحة ٢ بلا سحب (لا protocolPending)", await slot2(), {...INPUT("FORM_SLOT_INVALID"), logExtra: " cause=DOUBLE_EVAL_DRAW_ABSENT", ids});
    await db.collection("protocolPending").doc("sess-tf-3").set({purposeSource: "default"});
    expectRefusal("[٣] الفتحة ٢ بلا doubleEvalDraw", await slot2(), {...INPUT("FORM_SLOT_INVALID"), logExtra: " cause=DOUBLE_EVAL_DRAW_ABSENT", ids});
    await db.collection("protocolPending").doc("sess-tf-3").set({doubleEvalDraw: {selected: false, draw: 0.5, rate: 0.1, settingsVersion: "SETTINGS_ABSENT", decidedAt: 1}}, {merge: true});
    expectRefusal("[٣] الفتحة ٢ والسحب لم يختر الجلسة", await slot2(), {...INPUT("FORM_SLOT_INVALID"), logExtra: " cause=DOUBLE_EVAL_NOT_SELECTED", ids});
    await db.collection("protocolPending").doc("sess-tf-3").set({doubleEvalDraw: {selected: "yes"}}, {merge: true});
    expectRefusal("[٣] الفتحة ٢ وسحب مشوَّه", await slot2(), {...INPUT("FORM_SLOT_INVALID"), logExtra: " cause=DOUBLE_EVAL_DRAW_MALFORMED", ids});
    eq(await count("technicianForms") >= 1 && !(await exists("technicianForms", "sess-tf-3_2")), true, "[٣] ولا مستند للفتحة ٢ بعد كل ذلك");
    await db.collection("protocolPending").doc("sess-tf-3").set({doubleEvalDraw: {selected: true, draw: 0.05, rate: 0.1, settingsVersion: "SETTINGS_ABSENT", decidedAt: 1}}, {merge: true});
    const first = await submit(OWN, "sess-tf-3", (d) => { d.technicianId = "fake-tech-A"; });
    ok(first.threw === null, "[٣] الفتحة ١ بالفنّي A");
    expectRefusal("[٣] الفتحة ٢ بالفنّي نفسه (A)", await slot2((d) => { d.technicianId = "fake-tech-A"; }), {fn: SUBMIT, code: "failed-precondition", message: "FORM_SLOT_SAME_TECHNICIAN", reasonCode: "FORM_SLOT_SAME_TECHNICIAN", logReason: "FORM_SLOT_SAME_TECHNICIAN", ids});
    const second = await slot2();
    ok(second.threw === null, "[٣] الفتحة ٢ بفنّي آخر (B) والجلسة مسحوبة ⟵ تُقبل");
    const f2 = await data("technicianForms", "sess-tf-3_2");
    deq([f2.slot, f2.technicianId, f2.sessionId], [2, "fake-tech-B", "sess-tf-3"], "[٣] مستند الفتحة ٢");
    ok(await exists("technicianForms", "sess-tf-3_1"), "[٣] والفتحة ١ باقية");
    // التناظر: الفتحة ٢ أوّلاً ثم الفتحة ١ بالفنّي نفسه
    await seedSession("sess-tf-3b", {ownerId: OWN, status: "scanning", code: "NC-TF003B", expiresAt: FUTURE(), joinedBy: "joiner-tf-3b", scanId: null});
    await db.collection("protocolPending").doc("sess-tf-3b").set({doubleEvalDraw: {selected: true}});
    ok((await submit(OWN, "sess-tf-3b", (d) => { d.slot = 2; d.technicianId = "fake-tech-B"; })).threw === null, "[٣] الفتحة ٢ أوّلاً تُقبل");
    expectRefusal("[٣] ثم الفتحة ١ بالفنّي نفسه (B): الفحص متناظر", await submit(OWN, "sess-tf-3b", (d) => { d.slot = 1; d.technicianId = "fake-tech-B"; }), {fn: SUBMIT, code: "failed-precondition", message: "FORM_SLOT_SAME_TECHNICIAN", reasonCode: "FORM_SLOT_SAME_TECHNICIAN", logReason: "FORM_SLOT_SAME_TECHNICIAN"});
    ok((await submit(OWN, "sess-tf-3b", (d) => { d.slot = 1; d.technicianId = "fake-tech-A"; })).threw === null, "[٣] والفتحة ١ بفنّي آخر تُقبل");
  }

  // ═══ ٤ — الفنّي ═══
  {
    const OWN4 = "own-tf-4";
    await seedOwner(OWN4);
    await seedTech("fake-tech-active", {ownerId: OWN4, active: true, displayName: "FAKE-TECHNICIAN-ACTIVE"});
    await seedTech("fake-tech-stopped", {ownerId: OWN4, active: false, displayName: "FAKE-TECHNICIAN-STOPPED"});
    await seedTech("fake-tech-foreign", {ownerId: "someone-else-tf", active: true, displayName: "FAKE-TECHNICIAN-FOREIGN"});
    await seedTech("fake-tech-noflag", {ownerId: OWN4, displayName: "FAKE-TECHNICIAN-NOFLAG"});
    await seedTech("fake-tech-strflag", {ownerId: OWN4, active: "true"});
    await seedTech("fake-tech-noowner", {active: true});
    await seedSession("sess-tf-4", {ownerId: OWN4, status: "scanning", code: "NC-TF0004", expiresAt: FUTURE(), joinedBy: "j4"});
    for (const [label, techId, state] of [["غير موجود", "fake-tech-missing", "NOT_FOUND"], ["موقوف", "fake-tech-stopped", "INACTIVE"], ["لمالك آخر", "fake-tech-foreign", "OWNER_MISMATCH"],
      ["بلا ownerId", "fake-tech-noowner", "OWNER_MISMATCH"], ["active غائب", "fake-tech-noflag", "ACTIVE_FLAG_UNREADABLE"], ["active نصّ «true»", "fake-tech-strflag", "ACTIVE_FLAG_UNREADABLE"]]) {
      const r = await submit(OWN4, "sess-tf-4", (d) => { d.technicianId = techId; });
      expectRefusal(`[٤] فنّي ${label}`, r, {...INPUT("FORM_TECHNICIAN_UNKNOWN"), logExtra: ` technicianState=${state}`, ids: [techId, "sess-tf-4", OWN4, "FAKE-TECHNICIAN"]});
    }
    ok(!(await exists("technicianForms", "sess-tf-4_1")), "[٤] ولا مستند لأيّ منها");
    ok((await submit(OWN4, "sess-tf-4", (d) => { d.technicianId = "fake-tech-active"; })).threw === null, "[٤] الفنّي الفعّال الملك يُقبل");
  }

  // ═══ ٥ — التفعيل ═══
  {
    let k = 0;
    for (const [label, ownerFields, reason, withDoc] of [["العلم غائب", {evaluationEnabled: undefined}, "FLAG_ABSENT", true], ["العلم false", {evaluationEnabled: false}, "FLAG_FALSE", true],
      ["العلم نصّ «true»", {evaluationEnabled: "true"}, "FLAG_NOT_BOOLEAN", true], ["العلم رقم 1", {evaluationEnabled: 1}, "FLAG_NOT_BOOLEAN", true], ["مستند المالك غائب", null, "OWNER_DOC_MISSING", false]]) {
      const uid = `own-tf-5-${k}`;
      const id = `sess-tf-5-${k++}`;
      if (withDoc) {
        const doc = {scansRemaining: 5, plan: "shop_pro", isActive: true, expiresAt: FUTURE(60 * 24), ...ownerFields};
        if (doc.evaluationEnabled === undefined) delete doc.evaluationEnabled;
        await db.collection("users").doc(uid).set(doc);
      }
      await seedTech("fake-tech-5", {ownerId: uid, active: true});
      await seedSession(id, {ownerId: uid, status: "scanning", code: `NC-TF050${k}`, expiresAt: FUTURE(), joinedBy: "j5"});
      const r = await submit(uid, id, (d) => { d.technicianId = "fake-tech-5"; });
      expectRefusal(`[٥] المحلّ ${label}`, r, {fn: SUBMIT, code: "failed-precondition", message: "FORM_NOT_ENABLED", reasonCode: "FORM_NOT_ENABLED", logReason: "FORM_NOT_ENABLED", logExtra: ` reason=${reason}`, ids: [id, uid]});
      ok(!(await exists("technicianForms", `${id}_1`)), `[٥] ${label}: «ولا استمارة»`);
    }
  }

  // ═══ ٦ — الجلسة ═══
  {
    const OWN6 = "own-tf-6";
    await seedOwner(OWN6);
    await seedTech("fake-tech-6", {ownerId: OWN6, active: true});
    const base = {ownerId: OWN6, code: "NC-TF0060", expiresAt: FUTURE(), joinedBy: "joiner-tf-6"};
    const t6 = (d) => { d.technicianId = "fake-tech-6"; };
    // غير المالك والجلسة غير الموجودة: ردّ العميل نفسه
    await seedSession("sess-tf-6a", {...base, status: "scanning"});
    const stranger = await submit("stranger-tf-6", "sess-tf-6a", t6);
    const joiner = await submit("joiner-tf-6", "sess-tf-6a", t6);
    const missing = await submit(OWN6, "sess-tf-6-missing", t6);
    expectRefusal("[٦] غريب", stranger, {fn: SUBMIT, ...GONE, logReason: "SESSION_NOT_OWNER", logExtra: " role=none joinedByState=other-uid", ids: ["sess-tf-6a", "stranger-tf-6", OWN6]});
    expectRefusal("[٦] الجهاز المنضمّ (ليس جهاز الفنّي)", joiner, {fn: SUBMIT, ...GONE, logReason: "SESSION_NOT_OWNER", logExtra: " role=joiner", ids: ["sess-tf-6a", "joiner-tf-6"]});
    expectRefusal("[٦] جلسة غير موجودة", missing, {fn: SUBMIT, ...GONE, logReason: "SESSION_NOT_FOUND", ids: ["sess-tf-6-missing", OWN6]});
    deq([stranger.threw.code, stranger.threw.message, stranger.threw.details], [missing.threw.code, missing.threw.message, missing.threw.details], "[٦] **ردّ الغريب هو ردّ الجلسة غير الموجودة نفسه**: لا يُكشف وجود جلسة");
    deq([joiner.threw.code, joiner.threw.message, joiner.threw.details], [missing.threw.code, missing.threw.message, missing.threw.details], "[٦] وكذلك المنضمّ");
    // الحالات
    const cases = [["pending", {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_NOT_STARTED", logReason: "SESSION_NOT_STARTED"}],
      ["cancelled", {code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_CANCELLED", logReason: "SESSION_CANCELLED"}],
      ["expired", {code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED"}]];
    for (const [status, spec] of cases) {
      const id = `sess-tf-6-${status}`;
      await seedSession(id, {...base, status});
      expectRefusal(`[٦] ${status}`, await submit(OWN6, id, t6), {fn: SUBMIT, ...spec, ids: [id, OWN6]});
      ok(!(await exists("technicianForms", `${id}_1`)), `[٦] ${status}: لا مستند`);
    }
    let k = 0;
    for (const [label, statusField, state] of [["غائبة", {}, "ABSENT"], ["null", {status: null}, "ABSENT"], ["رقم", {status: 5}, "NOT_A_STRING"], ["لا تعرفها الشيفرة", {status: "done"}, "UNRECOGNIZED"]]) {
      const id = `sess-tf-6-unk-${k++}`;
      await seedSession(id, {...base, ...statusField});
      expectRefusal(`[٦] حالة ${label}`, await submit(OWN6, id, t6), {fn: SUBMIT, code: "failed-precondition", message: "SESSION_STATUS_UNKNOWN", reasonCode: "SESSION_STATUS_UNKNOWN", logReason: "SESSION_STATUS_UNKNOWN", logExtra: ` statusState=${state}`});
    }
    // scanning منقضية: تُكتب «منتهية» ثم تُرفض
    await seedSession("sess-tf-6-exp", {...base, status: "scanning", expiresAt: PAST()});
    expectRefusal("[٦] scanning منقضية", await submit(OWN6, "sess-tf-6-exp", t6), {fn: SUBMIT, code: "failed-precondition", message: "الجلسة منتهية", reasonCode: "SESSION_EXPIRED", logReason: "SESSION_EXPIRED", logExtra: " expiredRecorded=true", ids: ["sess-tf-6-exp"]});
    const exp = await data("scanSessions", "sess-tf-6-exp");
    ok(exp.status === "expired" && TS(exp.expiredAt), "[٦] وكُتبت «منتهية» في المعاملة نفسها (status=expired وexpiredAt)");
    ok(!(await exists("technicianForms", "sess-tf-6-exp_1")), "[٦] ولا مستند");
    // expiresAt غائب/تالف: رفض بلا كتابة
    let invK = 0;
    for (const [label, field] of [["غائب", {}], ["null", {expiresAt: null}], ["نصّ تالف", {expiresAt: "garbage"}]]) {
      const id = `sess-tf-6-inv-${invK++}`;
      await seedSession(id, {ownerId: OWN6, code: "NC-TF0061", joinedBy: "j", status: "scanning", ...field});
      const before = await data("scanSessions", id);
      expectRefusal(`[٦] scanning بـexpiresAt ${label}`, await submit(OWN6, id, t6), {fn: SUBMIT, code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_EXPIRES_AT_INVALID", logReason: "SESSION_EXPIRES_AT_INVALID"});
      deq(await data("scanSessions", id), before, `[٦] expiresAt ${label}: بلا كتابة على الجلسة`);
    }
    // completed (ولو انقضى expiresAt): إرسال متأخّر يُقبل
    await seedSession("sess-tf-6-done", {...base, status: "completed", expiresAt: PAST(600), scanId: null});
    ok((await submit(OWN6, "sess-tf-6-done", t6)).threw === null, "[٦] completed منقضية: الإرسال المتأخّر يُقبل");
  }

  // ═══ ٧ — مُدخلات الاستمارة ═══
  {
    const OWN7 = "own-tf-7";
    await seedOwner(OWN7);
    await seedTech("fake-tech-7", {ownerId: OWN7, active: true});
    await seedSession("sess-tf-7", {ownerId: OWN7, status: "scanning", code: "NC-TF0070", expiresAt: FUTURE(), joinedBy: "j7"});
    const t7 = (mut) => (d) => { d.technicianId = "fake-tech-7"; mut(d); };
    const ids = ["sess-tf-7", OWN7, "fake-tech-7"];
    const cases = [
      ["نسخة 1", (d) => { d.formContractVersion = 1; }, "FORM_CONTRACT_VERSION_INVALID", " cause=NOT_THE_CURRENT_VERSION"],
      ["فتحة 3", (d) => { d.slot = 3; }, "FORM_SLOT_INVALID", " cause=NOT_1_OR_2"],
      ["فنّي بمعرّف فيه /", (d) => { d.technicianId = "a/b"; }, "FORM_TECHNICIAN_UNKNOWN", " cause=NOT_A_SAFE_ID"],
      ["درجة بفئة v1", (d) => { d.grades = {cpu_performance: "good"}; }, "FORM_GRADES_INVALID", " cause=UNKNOWN_KEY"],
      ["وظيفي بقيمة غريبة", (d) => { d.functional.camera = "ok"; }, "FORM_FUNCTIONAL_INVALID", " cause=VALUE_NOT_ALLOWED key=camera"],
      ["عيب weak_battery", (d) => { d.defects = {weak_battery: "faulty"}; }, "FORM_DEFECTS_INVALID", " cause=UNKNOWN_KEY"],
      ["أعراض بتكرار", (d) => { d.symptoms = ["charging_slow", "charging_slow"]; }, "FORM_SYMPTOMS_INVALID", " cause=DUPLICATE"],
      ["ترتيب أعراض غائب", (d) => { delete d.symptomOrderShown; }, "FORM_SYMPTOM_ORDER_INVALID", " cause=ABSENT"],
      ["عطب معروف نصّ", (d) => { d.known_fault_before_scan = "true"; }, "FORM_KNOWN_FAULT_INVALID", " cause=NOT_A_BOOLEAN"],
      ["صحّة بطارية 101%", (d) => { d.batteryHealth = {kind: "percent", percent: 101}; }, "FORM_BATTERY_HEALTH_INVALID", " cause=PERCENT_NOT_INTEGER_0_100"],
      ["لعبة نصّ", (d) => { d.gameTried = "yes"; }, "FORM_GAME_TRIED_INVALID", " cause=NOT_A_BOOLEAN"],
      ["درجة ضعيفة بلا ملاحظة", (d) => { d.grades.thermal = "weak"; }, "FORM_NOTE_INVALID", " cause=REQUIRED_BELOW_GOOD"],
      ["أزمنة معكوسة", (d) => { d.submittedAt = 1500; d.perAnswerAt = []; }, "FORM_TIMES_INVALID", " cause=SUBMITTED_BEFORE_FIRST_TAP"],
      ["استمارة فارغة", (d) => { for (const k of ["grades", "functional", "defects", "symptoms", "known_fault_before_scan", "batteryHealth", "gameTried", "observedNote"]) delete d[k]; }, "FORM_EMPTY", ""],
    ];
    for (const [label, mut, reason, extra] of cases) {
      expectRefusal(`[٧] ${label}`, await submit(OWN7, "sess-tf-7", t7(mut)), {...INPUT(reason), logExtra: extra, ids});
    }
    ok(!(await exists("technicianForms", "sess-tf-7_1")), "[٧] لا مستند بعد كل المُدخلات المرفوضة");
    expectRefusal("[٧] بلا auth", await submit(OWN7, "sess-tf-7", t7(() => {}), null), {fn: SUBMIT, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "FORM_NOT_AUTHENTICATED", logReason: "FORM_NOT_AUTHENTICATED", ids});
    for (const [label, bad] of [["غائب", undefined], ["فارغ", ""], ["مسافات", "   "], ["رقم", 7], ["فيه /", "a/b"]]) {
      expectRefusal(`[٧] sessionId ${label}`, await call(() => submitTechnicianForm.run({data: {...GOOD(), sessionId: bad}, auth: {uid: OWN7, token: {}}, rawRequest: {headers: {}}})), {fn: SUBMIT, code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "FORM_SESSION_ID_REQUIRED", logReason: "FORM_SESSION_ID_REQUIRED", ids});
    }
    // ما يخصّ الخادم لا يُقبل من العميل
    const spoof = await submit(OWN7, "sess-tf-7", t7((d) => { Object.assign(d, {fast: true, blindness: "not_blind", clock: "device", receivedAt: 1, ownerId: "someone", formState: "abandoned", allFourGradesEqual: true, contradictionRules: ["x"], reportFirstOpenedAt: 5}); }));
    ok(spoof.threw === null, "[٧] إرسال بحقول مشتقّة مزوَّرة يُقبل (تُهمَل)");
    const f = await data("technicianForms", "sess-tf-7_1");
    deq([f.fast, f.blindness, f.clock, f.ownerId, f.formState, f.allFourGradesEqual, f.contradictionRules, f.reportFirstOpenedAt], [false, "blind", null, OWN7, "submitted", false, [], null], "[٧] **المشتقّات من الخادم لا من العميل**: ما زوَّره العميل لم يصل المستند");
    ok(f.receivedAt.toMillis() > 1000, "[٧] وreceivedAt وقت الخادم");
  }
  {
    // التناقض وأعلام الجودة والتنبيه بالمسار الحقيقي
    const OWN7b = "own-tf-7b";
    await seedOwner(OWN7b);
    await seedTech("fake-tech-7b", {ownerId: OWN7b, active: true});
    await seedSession("sess-tf-7b", {ownerId: OWN7b, status: "scanning", code: "NC-TF007B", expiresAt: FUTURE(), joinedBy: "j7b"});
    const before = {battery: "weak", performance: "good", thermal: "good", overall: "good"};
    const after = {battery: "weak", performance: "good", thermal: "good", overall: "good"};
    const r = await submit(OWN7b, "sess-tf-7b", (d) => {
      d.technicianId = "fake-tech-7b"; d.grades = before; d.observedNote = "ملاحظة اختبار"; d.answersBeforePrompt = before; d.answersAfterPrompt = after; d.promptAction = "confirmed_send";
      d.firstTapAt = 1000; d.openedAt = 900; d.submittedAt = 8999; d.perAnswerAt = [1000];
    });
    ok(r.threw === null, "[٧] إرسال بتناقض وتنبيه وسرعة");
    const f = await data("technicianForms", "sess-tf-7b_1");
    deq([f.contradictionRules, f.fast, f.allFourGradesEqual, f.promptAction, f.answersBeforePrompt, f.answersAfterPrompt, f.observedNote], [["overall_high_with_weak_category"], true, false, "confirmed_send", before, after, "ملاحظة اختبار"], "[٧] تناقض (عامّ جيّد مع بطارية ضعيفة) وfast (7999 مل ث) ولقطتا التنبيه وفعله والملاحظة");
    ok(!r.texts.join("\n").includes("ملاحظة اختبار"), "[٧] نصّ الملاحظة لا يظهر في أيّ سطر سجلّ");
    ok(named(r.texts, SUBMIT)[0].includes("fast=true") && named(r.texts, SUBMIT)[0].includes("contradictions=1"), "[٧] والسطر يعدّ التناقض ويذكر fast");
  }

  // ═══ ٨ — العمى بالمسار الكامل ═══
  {
    const OWN8 = "own-tf-8";
    await seedOwner(OWN8);
    await seedTech("fake-tech-8", {ownerId: OWN8, active: true});
    const t8 = (extra = () => {}) => (d) => { d.technicianId = "fake-tech-8"; extra(d); };
    let k = 0;
    const scenario = async (label, {report, opened, sentOffline = false, submittedAt, expect}) => {
      const id = `sess-tf-8-${k}`;
      const scanId = `scan-tf-8-${k++}`;
      await seedSession(id, {ownerId: OWN8, status: "completed", code: `NC-TF08${k}`, expiresAt: PAST(600), joinedBy: "j8", scanId});
      if (report !== null) await db.collection("reports").doc(scanId).set(report === "no-created-at" ? {userId: OWN8} : {userId: OWN8, createdAt: ts(report)});
      if (opened !== undefined) await db.collection("protocolPending").doc(id).set({reportFirstOpenedAt: ts(opened)});
      const r = await submit(OWN8, id, t8((d) => { d.sentOffline = sentOffline; if (submittedAt !== undefined) { d.submittedAt = submittedAt; d.perAnswerAt = []; } }));
      ok(r.threw === null, `[٨] ${label}: الإرسال نجح (${r.threw && r.threw.message})`);
      const f = await data("technicianForms", `${id}_1`);
      deq([f.blindness, f.blindnessBasis, f.clock], expect, `[٨] ${label}: العمى ⟵ ${expect.join("/")}`);
      return {f, id};
    };
    const NOW = Date.now();
    await scenario("لا تقرير (الجلسة بـscanId ولا مستند تقرير)", {report: null, expect: ["blind", "report_not_yet_created", null]});
    await scenario("المرجع أوّل فتح قبل الإرسال بدقيقة ⟵ not_blind", {report: NOW - 30 * MIN, opened: NOW - MIN, expect: ["not_blind", "report_first_opened", "server"]});
    const futureOpen = await scenario("المرجع أوّل فتح بعد الإرسال (مستقبل) ⟵ blind", {report: NOW - 30 * MIN, opened: NOW + 60 * MIN, expect: ["blind", "report_first_opened", "server"]});
    ok(TS(futureOpen.f.reportFirstOpenedAt), "[٨] reportFirstOpenedAt المرجع المستعمَل يُحفظ في الاستمارة");
    await scenario("لا فتح مسجَّل والتقرير أُنشئ قبل الإرسال ⟵ not_blind بالاحتياطي", {report: NOW - 30 * MIN, expect: ["not_blind", "created_at_fallback", "server"]});
    await scenario("لا فتح مسجَّل والتقرير ينشأ لاحقاً (مستقبل) ⟵ blind بالاحتياطي", {report: NOW + 60 * MIN, expect: ["blind", "created_at_fallback", "server"]});
    await scenario("تقرير بلا createdAt ولا فتح ⟵ unverifiable", {report: "no-created-at", expect: ["unverifiable", null, null]});
    await scenario("دون شبكة: ساعة الجهاز قبل الفتح ⟵ blind بـclock: device (ولو وصلت بعده)", {report: NOW - 30 * MIN, opened: NOW - MIN, sentOffline: true, submittedAt: NOW - 5 * MIN, expect: ["blind", "report_first_opened", "device"]});
    await scenario("دون شبكة: ساعة الجهاز بعد الفتح ⟵ not_blind بـclock: device", {report: NOW - 30 * MIN, opened: NOW - 10 * MIN, sentOffline: true, submittedAt: NOW - MIN, expect: ["not_blind", "report_first_opened", "device"]});
    await scenario("دون شبكة والمرجع احتياطي", {report: NOW - 10 * MIN, sentOffline: true, submittedAt: NOW - 20 * MIN, expect: ["blind", "created_at_fallback", "device"]});
    // الجلسة scanning بلا scanId: لا تقرير
    await seedSession("sess-tf-8-scanning", {ownerId: OWN8, status: "scanning", code: "NC-TF08S0", expiresAt: FUTURE(), joinedBy: "j8", scanId: null});
    ok((await submit(OWN8, "sess-tf-8-scanning", t8())).threw === null, "[٨] scanning بلا scanId");
    deq([(await data("technicianForms", "sess-tf-8-scanning_1")).blindness], ["blind"], "[٨] scanning بلا scanId ⟵ blind (لا تقرير بعد)");
  }

  // ═══ ٩ — recordReportFirstOpened ═══
  {
    const OWN9 = "own-tf-9";
    await seedOwner(OWN9);
    await seedSession("sess-tf-9", {ownerId: OWN9, status: "completed", code: "NC-TF0090", expiresAt: PAST(600), joinedBy: "joiner-tf-9", scanId: "scan-tf-9"});
    await db.collection("reports").doc("scan-tf-9").set({userId: OWN9, createdAt: ts(Date.now() - 20 * MIN)});
    await db.collection("protocolPending").doc("sess-tf-9").set({purposeSource: "default"});
    const RO = "recordReportFirstOpened";
    const first = await opened("joiner-tf-9", "sess-tf-9");
    ok(first.threw === null && first.ret.recorded === true, "[٩] أوّل فتح (من المنضمّ) يُسجَّل");
    deq(first.ret, {sessionId: "sess-tf-9", recorded: true}, "[٩] الردّ {sessionId, recorded}");
    const p1 = await data("protocolPending", "sess-tf-9");
    ok(TS(p1.reportFirstOpenedAt) && Math.abs(p1.reportFirstOpenedAt.toMillis() - Date.now()) < 120000, "[٩] reportFirstOpenedAt وقت الخادم");
    eq(p1.purposeSource, "default", "[٩] والدمج لم يمسّ بقيّة protocolPending");
    deq(named(first.texts, RO), [`[${RO}] recorded session=${sid("sess-tf-9")} caller=${sid("joiner-tf-9")} role=joiner`], "[٩] سطر التسجيل المسمّى بالدور");
    note("recordReportFirstOpened — تسجيل", named(first.texts, RO));
    const second = await opened(OWN9, "sess-tf-9");
    deq(second.ret, {sessionId: "sess-tf-9", recorded: false}, "[٩] الفتح الثاني (من المالك): recorded=false — أوّل فتح يربح");
    eq((await data("protocolPending", "sess-tf-9")).reportFirstOpenedAt.toMillis(), p1.reportFirstOpenedAt.toMillis(), "[٩] **الوقت لم يتغيّر**");
    deq(named(second.texts, RO), [`[${RO}] already recorded session=${sid("sess-tf-9")} caller=${sid(OWN9)} role=owner`], "[٩] وسطر «already recorded»");
    // رفوض
    expectRefusal("[٩] غريب", await opened("stranger-tf-9", "sess-tf-9"), {fn: RO, ...GONE, logReason: "SESSION_NOT_OWNER", logExtra: " role=none joinedByState=other-uid", ids: ["sess-tf-9", "stranger-tf-9"]});
    expectRefusal("[٩] جلسة غير موجودة", await opened(OWN9, "sess-tf-9-missing"), {fn: RO, ...GONE, logReason: "SESSION_NOT_FOUND"});
    expectRefusal("[٩] بلا auth", await opened(null, "sess-tf-9", null), {fn: RO, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "FORM_NOT_AUTHENTICATED", logReason: "FORM_NOT_AUTHENTICATED"});
    expectRefusal("[٩] sessionId غير صالح", await opened(OWN9, "a/b"), {fn: RO, code: "invalid-argument", message: "sessionId مطلوب", reasonCode: "FORM_SESSION_ID_REQUIRED", logReason: "FORM_SESSION_ID_REQUIRED"});
    const NA = {fn: RO, code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_REPORT_NOT_AVAILABLE", logReason: "SESSION_REPORT_NOT_AVAILABLE"};
    await seedSession("sess-tf-9-scanning", {ownerId: OWN9, status: "scanning", code: "NC-TF0091", expiresAt: FUTURE(), joinedBy: "j9", scanId: null});
    expectRefusal("[٩] جلسة scanning (لا تقرير بعد)", await opened(OWN9, "sess-tf-9-scanning"), {...NA, logExtra: " status=scanning scanIdState=ABSENT"});
    await seedSession("sess-tf-9-noreport", {ownerId: OWN9, status: "completed", code: "NC-TF0092", expiresAt: PAST(600), joinedBy: "j9", scanId: "scan-tf-9-gone"});
    expectRefusal("[٩] completed بـscanId ولا مستند تقرير", await opened(OWN9, "sess-tf-9-noreport"), {...NA, logExtra: " report=ABSENT"});
    ok(!(await exists("protocolPending", "sess-tf-9-noreport")) && !(await exists("protocolPending", "sess-tf-9-scanning")), "[٩] ولا protocolPending أُنشئ للمرفوضة");
    await seedSession("sess-tf-9-unk", {ownerId: OWN9, code: "NC-TF0093", expiresAt: FUTURE(), joinedBy: "j9"});
    expectRefusal("[٩] حالة غائبة", await opened(OWN9, "sess-tf-9-unk"), {fn: RO, code: "failed-precondition", message: "SESSION_STATUS_UNKNOWN", reasonCode: "SESSION_STATUS_UNKNOWN", logReason: "SESSION_STATUS_UNKNOWN", logExtra: " statusState=ABSENT"});
    // الجلسة التي لها protocolPending غائب: يُنشأ بالدمج (جلسة قبل النشر)
    await seedSession("sess-tf-9-legacy", {ownerId: OWN9, status: "completed", code: "NC-TF0094", expiresAt: PAST(600), joinedBy: "j9", scanId: "scan-tf-9-legacy"});
    await db.collection("reports").doc("scan-tf-9-legacy").set({userId: OWN9});
    const leg = await opened(OWN9, "sess-tf-9-legacy");
    eq(leg.ret && leg.ret.recorded, true, "[٩] جلسة بلا protocolPending: يُنشأ بالدمج ويُسجَّل");
    deq(Object.keys(await data("protocolPending", "sess-tf-9-legacy")), ["reportFirstOpenedAt"], "[٩] ولا حقل غيره في المستند المنشأ");
    // أثره على العمى: استمارة جلسة sess-tf-9 تُحكَم بأوّل فتح
    await seedTech("fake-tech-9", {ownerId: OWN9, active: true});
    const f = await submit(OWN9, "sess-tf-9", (d) => { d.technicianId = "fake-tech-9"; });
    ok(f.threw === null, "[٩] استمارة بعد تسجيل الفتح");
    deq([(await data("technicianForms", "sess-tf-9_1")).blindness, (await data("technicianForms", "sess-tf-9_1")).blindnessBasis], ["not_blind", "report_first_opened"], "[٩] أُرسلت بعد أوّل فتح ⟵ not_blind بأساس report_first_opened");
  }

  // ═══ ١٠ — getTechnicianFormConfig ═══
  {
    const OWN10 = "own-tf-10";
    const OFF10 = "own-tf-10-off";
    await seedOwner(OWN10);
    await seedOwner(OFF10, {evaluationEnabled: false});
    await seedTech("fake-tech-10b", {ownerId: OWN10, active: true, displayName: "FAKE-TECHNICIAN-B"});
    await seedTech("fake-tech-10a", {ownerId: OWN10, active: true, displayName: "FAKE-TECHNICIAN-A"});
    await seedTech("fake-tech-10c", {ownerId: OWN10, active: false, displayName: "FAKE-TECHNICIAN-C"});
    await seedTech("fake-tech-10d", {ownerId: "other-owner-tf-10", active: true, displayName: "FAKE-TECHNICIAN-D"});
    await seedTech("fake-tech-10e", {ownerId: OWN10, active: true});
    await seedSession("sess-tf-10", {ownerId: OWN10, status: "pending", code: "NC-TF0100", expiresAt: FUTURE(), scanId: null});
    await seedSession("sess-tf-10-off", {ownerId: OFF10, status: "pending", code: "NC-TF0101", expiresAt: FUTURE(), scanId: null});
    const CF = "getTechnicianFormConfig";
    const r = await config(OWN10, "sess-tf-10");
    ok(r.threw === null, `[١٠] الإعداد نجح (${r.threw && r.threw.message})`);
    deq(Object.keys(r.ret).sort(), ["enabled", "formContractVersion", "sessionId", "settingsVersion", "slots", "symptomOrder", "technicians"], "[١٠] مفاتيح الردّ");
    deq([r.ret.sessionId, r.ret.formContractVersion, r.ret.enabled, r.ret.settingsVersion], ["sess-tf-10", 2, true, "SETTINGS_ABSENT"], "[١٠] الجلسة والنسخة والتفعيل وsettingsVersion = SETTINGS_ABSENT حين لا مستند protocolSettings (S-P6-14: يتبع الإعدادات الحيّة؛ النسخة الحاضرة في protocolAdmin.e2e.test.js §٦ — استُبدل تثبيت «الثابت حتى P6-14»: القاعدة 23)");
    deq(r.ret.technicians, [{technicianId: "fake-tech-10a", displayName: "FAKE-TECHNICIAN-A"}, {technicianId: "fake-tech-10b", displayName: "FAKE-TECHNICIAN-B"}, {technicianId: "fake-tech-10e", displayName: null}],
        "[١٠] فنّيو المالك الفعّالون وحدهم، مرتّبون بالاسم؛ الموقوف وفنّيّ مالك آخر غائبان؛ واسم غائب null صريح");
    deq(r.ret.symptomOrder, CHIPS, "[١٠] ترتيب الأعراض: الجدول (الافتراضي) — بالتكرار 28 يوماً معلّق (يحتاج مدى زمنياً)");
    deq(r.ret.slots, [{slot: 1, formState: "not_submitted"}, {slot: 2, formState: "not_submitted", drawn: false}], "[١٠] الفتحتان لم تُرسَلا، والثانية لم تُسحب");
    ok(!JSON.stringify(r.ret).includes("grades") && !JSON.stringify(r.ret).includes("observedNote"), "[١٠] لا محتوى استمارة في الردّ");
    deq(named(r.texts, CF), [`[${CF}] served session=${sid("sess-tf-10")} caller=${sid(OWN10)} technicians=3 slot1=not_submitted slot2=not_submitted`], "[١٠] سطر الإعداد: العدد وحالة الفتحتين بلا أسماء");
    ok(!r.texts.join("\n").includes("FAKE-TECHNICIAN") && !r.texts.join("\n").includes("sess-tf-10") && !r.texts.join("\n").includes(OWN10), "[١٠] لا اسم ولا معرّف خامّ في السجلّ");
    note("getTechnicianFormConfig — إعداد", named(r.texts, CF));
    // بعد إرسال الفتحة ١ وسحب التقييم المزدوج
    await seedSession("sess-tf-10b", {ownerId: OWN10, status: "scanning", code: "NC-TF0102", expiresAt: FUTURE(), joinedBy: "j10"});
    await db.collection("protocolPending").doc("sess-tf-10b").set({doubleEvalDraw: {selected: true}});
    ok((await submit(OWN10, "sess-tf-10b", (d) => { d.technicianId = "fake-tech-10a"; })).threw === null, "[١٠] إرسال الفتحة ١");
    const r2 = await config(OWN10, "sess-tf-10b");
    deq(r2.ret.slots, [{slot: 1, formState: "submitted"}, {slot: 2, formState: "not_submitted", drawn: true}], "[١٠] بعد الإرسال: الفتحة ١ submitted، والثانية مسحوبة ولم تُرسَل");
    // غير مفعَّل
    const off = await config(OFF10, "sess-tf-10-off");
    deq(off.ret, {sessionId: "sess-tf-10-off", formContractVersion: 2, enabled: false, formState: "not_enabled"}, "[١٠] المحلّ غير المفعَّل ⟵ {formState: not_enabled} بلا إعداد ولا قائمة فنّيين");
    ok(named(off.texts, CF)[0].includes("reason=FLAG_FALSE"), "[١٠] وسبب القراءة في السجلّ");
    // الرفوض
    expectRefusal("[١٠] غريب", await config("stranger-tf-10", "sess-tf-10"), {fn: CF, ...GONE, logReason: "SESSION_NOT_OWNER", logExtra: " role=none joinedByState=absent", ids: ["sess-tf-10", "stranger-tf-10"]});
    expectRefusal("[١٠] المنضمّ", await config("j10", "sess-tf-10b"), {fn: CF, ...GONE, logReason: "SESSION_NOT_OWNER", logExtra: " role=joiner"});
    expectRefusal("[١٠] جلسة غير موجودة", await config(OWN10, "sess-tf-10-missing"), {fn: CF, ...GONE, logReason: "SESSION_NOT_FOUND"});
    await seedSession("sess-tf-10-cancel", {ownerId: OWN10, status: "cancelled", code: "NC-TF0103", expiresAt: FUTURE()});
    expectRefusal("[١٠] جلسة ملغاة", await config(OWN10, "sess-tf-10-cancel"), {fn: CF, code: "permission-denied", message: "جلسة الفحص غير صالحة", reasonCode: "SESSION_CANCELLED", logReason: "SESSION_CANCELLED"});
    expectRefusal("[١٠] بلا auth", await config(OWN10, "sess-tf-10", null), {fn: CF, code: "unauthenticated", message: "يجب تسجيل الدخول", reasonCode: "FORM_NOT_AUTHENTICATED", logReason: "FORM_NOT_AUTHENTICATED"});
    // قراءة وحدها: لا كتابة «منتهية»
    await seedSession("sess-tf-10-late", {ownerId: OWN10, status: "scanning", code: "NC-TF0104", expiresAt: PAST(), joinedBy: "j10"});
    const late = await config(OWN10, "sess-tf-10-late");
    ok(late.threw === null && (await data("scanSessions", "sess-tf-10-late")).status === "scanning", "[١٠] الإعداد قراءة وحدها: لا يكتب «منتهية» ولو انقضى الوقت");
  }

  // ═══ ١١ — لا حذف ═══
  {
    ok((await count("technicianForms")) >= 20 && (await count("scanSessions")) >= 40 && (await count("technicians")) >= 15, "[١١] المستندات باقية: الاستمارات والجلسات والفنّيون — لا حذف في أيّ مسار");
    for (const t of OBSERVED) console.log(t);
  }

  console.log(`technicianForm.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
