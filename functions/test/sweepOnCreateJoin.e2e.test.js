// E2E test: الكنس الآمن عند إنشاء جلسة وعند الانضمام (S-SWEEP، 2026-10-15 +03). المعالجان الحقيقيان عبر `.run()` على محاكي Firestore (القاعدة 37).
// **الاستبدال الوحيد**: `admin.messaging` بمُرسِل يعدّ ولا يرسل (لا شبكة). و**المراقبان التمريريان** (لا يستبدلان شيئاً: يمرّران الطلب الحقيقي إلى المحاكي ويعدّانه أو يؤخّرانه أو يُفشلانه
// في موضع بعينه): Query.prototype._get (استعلامات الكنس: رصد الشكل وحقن فشل)، وFirestore.prototype.request (تأخير commit لإثبات الميزانية).
// لا نداء نموذج في هذا الملفّ: createScanSession وjoinScanSession وcancelScanSession لا تكلّمان مزوّداً.
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-ج. قرار المستخدم (2026-10-15، منقول): «Creating a session sweeps the owner's expired sessions (ownerId). Joining sweeps the joining device's expired
// sessions (joinedBy). Cancel does not sweep … A device that joined without an identity (joinedBy null) is reached only through its owner.» وE27 (منقول): «الثلاث القديمة لحساب الاختبار،
// فيكنسها أوّل إنشاء جلسة منه بعد نشر الكنس. ولا سكربت لمرّة واحدة.» وE34: «معتمد بحدّيه (الانضمام 3 ث، والإنشاء 10 ث) … بسطر سجلّ يُظهر عدد ما كُنس وزمنه.»
//
// ما يثبته:
//   ١ E27 (معيار القبول): حساب فيه سبع جلسات منقضية مفتوحة (اثنتان منها joinedBy=null) — أوّل createScanSession منه يكنسها كلّها وسطره state=COMPLETED written=7؛ ولا تُمسّ جلسات
//     حساب آخر ولا النهائية ولا الصالحة ولا الجديدة؛ وبعدها لا مفتوحة منقضية للحساب؛ والردّ للمستدعي لا يتغيّر؛ والنداء الثاني سطره COMPLETED بأصفار حقيقية.
//   ٢ E33: السقف 20: 25 منقضية ⟵ 20 وCAPPED، والنداء اللاحق يكنس الخمس ويُعيد COMPLETED.
//   ٣ الانضمام: مفتاح joinedBy — جلسات الجهاز المنقضية فقط (مهما كان مالكها)؛ لا جلسة بـjoinedBy=null ولا جلسة جهاز آخر ولا جلسة المالك التي لم يُنضَمّ إليها ولا الصالحة ولا النهائية؛
//     والمُشغِّلة لا تُمسّ؛ والردّ لا يتغيّر.
//   ٤ joinerUid=null (بلا auth): NOT_RUN_NO_KEY، ولا استعلام بـjoinedBy إطلاقاً، ولا كتابة.
//   ٥ إعادة الانضمام لا تكنس (قرار المستخدم 2026-10-16؛ كان المشهد يثبّت أنها تكنس): لا سطر كنس ولا استعلام كنس ولا كتابة في أيّ جلسة (ومنها المنقضية للجهاز نفسه)، والردّ هو ردّ الانضمام الأوّل.
//   ٦ المرفوض قبل نقطة الكنس لا سطر كنس له ولا كنس.
//   ٧ الإلغاء لا يكنس (E25).
//   ٨ E32: قفل حيّ يُتخطّى (skipped=1، وتبقى scanning)، والقديم لا؛ ولا يُمسّ قفل ولا حجز (E29)؛ وبعد أن يصير القفل قديماً يكنسها نداء لاحق.
//   ٩ READ_FAILED: فشل الاستعلام لا يغيّر ردّ النداء ولا يكتب شيئاً، والسطر بالرمز واسم الصنف وحدهما (القاعدة 36).
//   ١٠ BUDGET_EXHAUSTED: ميزانية الانضمام (3 ث) تنفد بكتابات بطيئة: يُترك الباقي ويُسجَّل، والردّ لا يتغيّر، والنداء اللاحق يكمل.
//   ١١ شكل الاستعلامات كلّها: مساواة وحدها، مرشِّحان، بلا ترتيب ولا حدّ (القاعدة 43)؛ ولا حذف في أيّ مرحلة؛ ولا cancelled كتبها الكنس.
//   ١٢ السجلّ: لا sessionId ولا uid خامّاً ولا نصّ خطأ في أيّ سطر كنس.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/sweepOnCreateJoin.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const {Firestore, Query} = require("firebase-admin/firestore");
const {admin, db} = require("../src/utils/admin");
const {createScanSession} = require("../src/sessions/createScanSession");
const {joinScanSession} = require("../src/sessions/joinScanSession");
const {cancelScanSession} = require("../src/sessions/cancelScanSession");
const {hashIdForLog} = require("../src/utils/logRedaction");
const {SWEEP_STATE, SWEEP_CALLER} = require("../src/sessions/sessionNames");
const {SWEEP_PLAN, SWEEP_WRITE_CAP} = require("../src/sessions/sweepExpiredSessions");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ─── المُرسِل والمراقبان ───────────────────────────────────────────────────────────────────────────────────────
Object.defineProperty(admin, "messaging", {configurable: true, value: () => ({send: async () => "projects/demo-nc/messages/stub"})});

const queryLog = []; // استعلامات يمرّ بها Query._get (ويشمل استعلامات المعاملات): {filters: [[حقل، عملية، قيمة]]، orderBys، hasLimit}؛ يُصفَّر داخل بعض المشاهد
const everQueries = []; // كل الاستعلامات عبر الاختبار كلّه (لا يُصفَّر): لفحص الشكل في ١١
let queryFailure = null; // (filters) ⟵ Error أو null
const realQueryGet = Query.prototype._get;
Query.prototype._get = async function spiedGet(...args) {
  const o = this._queryOptions;
  const filters = (o.filters || []).map((f) => [f.field.formattedName, f.op, f.value]);
  const entry = {filters, orderBys: (o.fieldOrders || []).length, hasLimit: o.limit !== undefined && o.limit !== null};
  queryLog.push(entry);
  everQueries.push(entry);
  if (queryFailure) {
    const err = queryFailure(filters);
    if (err) throw err;
  }
  return realQueryGet.apply(this, args);
};
let commitDelayFor = null; // (اسم مستند مكتوب) ⟵ مللي ثانية تأخير قبل commit
const realRequest = Firestore.prototype.request;
Firestore.prototype.request = async function spiedRequest(methodName, request, ...rest) {
  if (methodName === "commit" && commitDelayFor && request && Array.isArray(request.writes)) {
    let delay = 0;
    for (const w of request.writes) {
      const name = (w.update && w.update.name) || (w.transform && w.transform.document) || null;
      if (name) delay = Math.max(delay, commitDelayFor(name));
    }
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return realRequest.call(this, methodName, request, ...rest);
};
const hasFilter = (q, field) => q.filters.some(([f]) => f === field);
const sweepSessionQueries = (log = queryLog) => log.filter((q) => (hasFilter(q, "ownerId") || hasFilter(q, "joinedBy")) && hasFilter(q, "status"));

function capture() {
  const lines = [];
  const real = {warn: console.warn, error: console.error, log: console.log, info: console.info};
  for (const level of Object.keys(real)) console[level] = (...a) => { lines.push({level, text: a.join(" ")}); };
  return {lines, texts: () => lines.map((l) => l.text), restore: () => { for (const level of Object.keys(real)) console[level] = real[level]; }};
}
async function call(fn, p) {
  const cap = capture();
  let ret = null;
  let threw = null;
  try {
    ret = await fn.run({rawRequest: {headers: {}}, ...p});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {ret, threw, lines: cap.lines, texts: cap.texts()};
}
const create = (uid) => call(createScanSession, {data: {}, auth: uid ? {uid, token: {}} : undefined});
const join = (code, uid) => call(joinScanSession, {data: {code}, auth: uid ? {uid, token: {firebase: {sign_in_provider: "anonymous"}}} : undefined});
const cancel = (sessionId, reason, uid) => call(cancelScanSession, {data: {sessionId, reason}, auth: {uid, token: {}}});
const sweptLines = (texts) => texts.filter((t) => t.startsWith("[sweepExpiredSessions] swept "));
const E34_OBSERVED = [];
const noteE34 = (label, line) => { E34_OBSERVED.push(`  ${label}\n    ${line}`); };
const sweepRelated = []; // كل سطر سجلّ يخصّ الكنس، لفحص التهشير في ١٢
const collectSweepLogs = (texts) => { for (const t of texts) if (t.startsWith("[sweepExpiredSessions]") || t.includes("from=sweepExpiredSessions:")) sweepRelated.push(t); };

const MIN = 60 * 1000;
const PAST = (m = 30) => new Date(Date.now() - m * MIN);
const FUTURE = (m = 30) => new Date(Date.now() + m * MIN);
const seedOwner = (uid, scans = 50) => db.collection("users").doc(uid).set({scansRemaining: scans, scansTotal: scans, plan: "shop_pro", isActive: true, expiresAt: new Date(Date.now() + 10 * 24 * 3600 * 1000)});
const seedSession = (id, fields) => db.collection("scanSessions").doc(id).set(fields);
const sessionSnap = (id) => db.collection("scanSessions").doc(id).get();
const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => ((v && typeof v.toDate === "function") ? v.toDate().toISOString() : v)));
async function allSessions() {
  const snap = await db.collection("scanSessions").get();
  const out = {};
  for (const d of snap.docs) out[d.id] = norm(d.data());
  return out;
}
async function allClaims() {
  const snap = await db.collection("scanClaims").get();
  const out = {};
  for (const d of snap.docs) out[d.id] = norm(d.data());
  return out;
}
const parseLine = (line) => {
  const m = line.match(/^\[sweepExpiredSessions\] swept from=(\S+) key=(\S+) keyId=(\S+) state=(\S+) returned=(\S+) candidates=(\S+) written=(\S+) skipped=(\S+) failed=(\S+) sweepMs=(\S+) totalMs=(\d+)(.*)$/);
  if (!m) return null;
  return {from: m[1], key: m[2], keyId: m[3], state: m[4], returned: m[5], candidates: m[6], written: m[7], skipped: m[8], failed: m[9], sweepMs: m[10], totalMs: Number(m[11]), tail: m[12]};
};
const counts = (p) => [p.returned, p.candidates, p.written, p.skipped, p.failed];
/** مستندات لم تتغيّر بين لقطتين (باستثناء ما سُمّي). */
function expectUnchanged(before, after, ids, label) {
  for (const id of ids) deq(after[id], before[id], `${label}: ${id} لم تُمسّ`);
}
const SECRET_IDS = []; // كل معرّف/uid يُستعمل هنا يُفحص ألّا يظهر خامّاً في سطور الكنس (١٢)
const track = (...ids) => { SECRET_IDS.push(...ids); return ids[0]; };
const everSeen = new Set();
const trackAll = async () => { for (const id of Object.keys(await allSessions())) everSeen.add(id); };

(async () => {
  // ═══ ١ — E27: سبع جلسات منقضية مفتوحة (اثنتان joinedBy=null) تكنسها أوّل createScanSession ═══
  {
    const OWN = track("owner-e27-uid");
    await seedOwner(OWN);
    // مرآة o2 (§٦-ج، E27): للمالك 11 جلسة؛ سبع مفتوحة (pending واحدة وست scanning) كلّها منقضية بالوقت، واثنتان من الستّ joinedBy=null؛ والأربع الباقية نهائية.
    await seedSession(track("e27-p1"), {ownerId: OWN, status: "pending", code: "NC-E27P01", expiresAt: PAST(60 * 24 * 11), scanId: null, deviceModel: null});
    await seedSession(track("e27-s1"), {ownerId: OWN, status: "scanning", code: "NC-E27S01", expiresAt: PAST(60 * 24 * 15), joinedBy: track("dev-e27-a"), scanId: null});
    await seedSession(track("e27-s2"), {ownerId: OWN, status: "scanning", code: "NC-E27S02", expiresAt: PAST(60 * 24 * 7), joinedBy: track("dev-e27-b"), scanId: null});
    await seedSession(track("e27-s3"), {ownerId: OWN, status: "scanning", code: "NC-E27S03", expiresAt: PAST(60 * 24 * 3), joinedBy: track("dev-e27-c"), scanId: null});
    await seedSession(track("e27-s4"), {ownerId: OWN, status: "scanning", code: "NC-E27S04", expiresAt: PAST(60 * 24), joinedBy: track("dev-e27-d"), scanId: null});
    await seedSession(track("e27-n1"), {ownerId: OWN, status: "scanning", code: "NC-E27N01", expiresAt: PAST(60 * 20), joinedBy: null, scanId: null});
    await seedSession(track("e27-n2"), {ownerId: OWN, status: "scanning", code: "NC-E27N02", expiresAt: PAST(60 * 5), joinedBy: null, scanId: null});
    for (const [id, st] of [["e27-t1", "completed"], ["e27-t2", "expired"], ["e27-t3", "cancelled"], ["e27-t4", "completed"]]) {
      await seedSession(track(id), {ownerId: OWN, status: st, code: `NC-${id.replace("-", "").toUpperCase()}`, expiresAt: PAST(60 * 24 * 30), joinedBy: "dev-e27-z"});
    }
    // حساب آخر في الاختبار نفسه: منقضية مفتوحة (إحداها منضمّ إليها بالجهاز dev-e27-a نفسه) — لا يطالها كنس المالك
    const OTHER = track("owner-other-uid");
    await seedSession(track("oth-p1"), {ownerId: OTHER, status: "pending", code: "NC-OTH001", expiresAt: PAST(600), scanId: null});
    await seedSession(track("oth-s1"), {ownerId: OTHER, status: "scanning", code: "NC-OTH002", expiresAt: PAST(600), joinedBy: "dev-e27-a", scanId: null});
    // صالحة للمالك نفسه (في o2 لا صالحة؛ هنا لإثبات ألّا تُمسّ ولا تُلغى)
    await seedSession(track("e27-valid"), {ownerId: OWN, status: "pending", code: "NC-E27VAL", expiresAt: FUTURE(40), scanId: null});

    const before = await allSessions();
    const r = await create(OWN);
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[١] createScanSession نجحت");
    // S-P6-03 (2026-10-18 +03، القاعدة 23: استُبدل ما كان يثبّت المفاتيح الثلاثة وحدها): الردّ صار بأربعة بإضافة protocolParts (docs/PROTOCOL_CONTRACT.md §٢ A2: «createScanSession تعيد protocolParts في ردّها»)؛ الكنس نفسه لا يغيّر الردّ.
    deq(Object.keys(r.ret).sort(), ["code", "expiresInMinutes", "protocolParts", "sessionId"], "[١] ردّ الإنشاء بمفاتيحه الثلاثة القائمة + protocolParts (الكنس لا يغيّر الردّ)");
    eq(r.ret.expiresInMinutes, 60, "[١] expiresInMinutes = 60");
    ok(typeof r.ret.sessionId === "string" && /^NC-[A-Z0-9]{6}$/.test(r.ret.code), "[١] sessionId وcode بشكلهما");
    track(r.ret.sessionId);

    const swept = sweptLines(r.texts);
    eq(swept.length, 1, "[١] سطر E34 واحد بالضبط في النداء");
    const p = parseLine(swept[0]);
    ok(p !== null, `[١] السطر بالصيغة المعتمدة: ${swept[0]}`);
    deq([p.from, p.key, p.keyId, p.state], ["createScanSession", "ownerId", hashIdForLog(OWN), "COMPLETED"], "[١] from=createScanSession key=ownerId keyId=<مُهشَّر> state=COMPLETED");
    // returned: pending (e27-p1، e27-valid، الجديدة) + scanning (الست) = 9؛ والنهائية الأربع لا يُعيدها الاستعلامان؛ candidates=7 (الصالحة والجديدة خارجها)
    deq(counts(p), ["9", "7", "7", "0", "0"], "[١] returned=9 candidates=7 written=7 skipped=0 failed=0 (E27: written=7)");
    ok(/^\d+$/.test(p.sweepMs) && p.totalMs >= Number(p.sweepMs), `[١] sweepMs عدد وtotalMs ≥ sweepMs (${p.sweepMs} / ${p.totalMs})`);
    eq(p.tail, "", "[١] لا ذيل (لا READ_FAILED)");
    noteE34("E27 — الإنشاء بسبع منقضية مفتوحة (اثنتان joinedBy=null)", swept[0]);

    const after = await allSessions();
    for (const id of ["e27-p1", "e27-s1", "e27-s2", "e27-s3", "e27-s4", "e27-n1", "e27-n2"]) {
      eq(after[id].status, "expired", `[١] ${id}: expired`);
      ok(typeof after[id].expiredAt === "string" && Math.abs(new Date(after[id].expiredAt).getTime() - Date.now()) < 120000, `[١] ${id}: expiredAt = وقت الخادم الآن`);
      const {status: _a, expiredAt: _b, ...restAfter} = after[id];
      const {status: _c, ...restBefore} = before[id];
      deq(restAfter, restBefore, `[١] ${id}: بقية الحقول (ownerId وcode وexpiresAt وjoinedBy وscanId) كما كانت`);
    }
    ok(after["e27-n1"].joinedBy === null && after["e27-n2"].joinedBy === null, "[١] الجلستان بلا joinedBy كُنستا بمفتاح المالك (joinedBy يبقى null)");
    expectUnchanged(before, after, ["e27-t1", "e27-t2", "e27-t3", "e27-t4", "oth-p1", "oth-s1", "e27-valid"], "[١]");
    eq(after[r.ret.sessionId].status, "pending", "[١] والجلسة الجديدة pending صالحة (المُشغِّلة لا تُكنس)");
    eq(Object.keys(after).length, Object.keys(before).length + 1, "[١] لا حذف: كل مستندات الجلسات باقية وزادت الجديدة وحدها");
    const stillOpenExpired = Object.entries(after).filter(([, s]) => s.ownerId === OWN && ["pending", "scanning"].includes(s.status) && new Date(s.expiresAt).getTime() < Date.now());
    eq(stillOpenExpired.length, 0, "[١] E27: بعد أوّل جلسة جديدة لا مفتوحة منقضية قديمة للحساب (o2 يُظهر 0)");
    ok(!Object.values(after).some((s) => s.status === "cancelled" && s.expiredAt), "[١] ولا cancelled كتبها الكنس");

    // النداء الثاني: لا مرشَّحة ⟵ سطر COMPLETED بأصفار حقيقية (written=0 يعني أن الكنس جرى ولم يكتب) — المعتاد «بدونه»
    const r2 = await create(OWN);
    collectSweepLogs(r2.texts);
    track(r2.ret.sessionId);
    const s2 = sweptLines(r2.texts);
    eq(s2.length, 1, "[١] النداء الثاني: سطر E34 واحد حتى حين لا يُكتب شيء");
    const p2 = parseLine(s2[0]);
    deq([p2.state, ...counts(p2)], ["COMPLETED", "3", "0", "0", "0", "0"], "[١] النداء الثاني: state=COMPLETED returned=3 (e27-valid والجديدتان) candidates=0 written=0 (المعتاد «بدونه»)");
    noteE34("المعتاد «بدونه» — النداء الثاني من الحساب نفسه (candidates=0)", s2[0]);
    const open = Object.values(await allSessions()).filter((s) => s.ownerId === OWN && ["pending", "scanning"].includes(s.status));
    ok(open.length === 3 && open.every((s) => s.status === "pending" && new Date(s.expiresAt).getTime() > Date.now()), "[١] المفتوح للحساب بعد النداءين ثلاث pending صالحة: e27-valid والجديدتان");
    await trackAll();
  }

  // ═══ ٢ — E33: السقف 20 ═══
  {
    const OWN = track("owner-cap-uid");
    await seedOwner(OWN);
    for (let i = 0; i < 25; i++) {
      await seedSession(track(`cap-${String(i).padStart(3, "0")}`), {ownerId: OWN, status: i % 2 === 0 ? "pending" : "scanning", code: `NC-CAP${String(i).padStart(3, "0")}`, expiresAt: PAST(1000 - i), ...(i % 2 === 0 ? {} : {joinedBy: `dev-cap-${i}`})});
    }
    const r = await create(OWN);
    collectSweepLogs(r.texts);
    track(r.ret.sessionId);
    const p = parseLine(sweptLines(r.texts)[0]);
    deq([p.state, ...counts(p)], ["CAPPED", "26", "25", "20", "0", "0"], "[٢] 25 منقضية: تُكتب 20 وCAPPED (returned=26 بالجديدة)");
    noteE34("E33 — السقف: 25 منقضية في نداء واحد", sweptLines(r.texts)[0]);
    const s1 = await allSessions();
    const expiredNow = Object.keys(s1).filter((id) => id.startsWith("cap-") && s1[id].status === "expired").sort();
    deq(expiredNow, Array.from({length: SWEEP_WRITE_CAP}, (_, i) => `cap-${String(i).padStart(3, "0")}`), "[٢] المكتوب العشرون الأقدم انقضاءً (حتمي)");
    for (let i = SWEEP_WRITE_CAP; i < 25; i++) ok(s1[`cap-${String(i).padStart(3, "0")}`].status !== "expired", `[٢] cap-${i} تبقى لنداء لاحق`);
    const r2 = await create(OWN);
    collectSweepLogs(r2.texts);
    track(r2.ret.sessionId);
    const p2 = parseLine(sweptLines(r2.texts)[0]);
    deq([p2.state, ...counts(p2)], ["COMPLETED", "7", "5", "5", "0", "0"], "[٢] النداء اللاحق يكنس الخمس الباقية: COMPLETED");
    const s2 = await allSessions();
    ok(Object.keys(s2).filter((id) => id.startsWith("cap-")).every((id) => s2[id].status === "expired"), "[٢] كل الخمس والعشرين منتهية الآن");
    await trackAll();
  }

  // ═══ ٣ — الانضمام: مفتاح joinedBy ═══
  const DEV = track("dev-j1-uid");
  {
    const OWN4 = track("owner-j4-uid");
    const OWN5 = track("owner-j5-uid");
    await seedSession(track("j-target"), {ownerId: OWN4, status: "pending", code: "NC-JOIN01", expiresAt: FUTURE(40), scanId: null});
    await seedSession(track("j-old-1"), {ownerId: OWN4, status: "scanning", code: "NC-JOLD01", expiresAt: PAST(300), joinedBy: DEV, scanId: null});
    await seedSession(track("j-old-2"), {ownerId: OWN5, status: "scanning", code: "NC-JOLD02", expiresAt: PAST(200), joinedBy: DEV, scanId: null});
    // خارج مفتاح الجهاز
    await seedSession(track("j-valid"), {ownerId: OWN5, status: "scanning", code: "NC-JVAL01", expiresAt: FUTURE(20), joinedBy: DEV, scanId: null});
    await seedSession(track("j-other-dev"), {ownerId: OWN4, status: "scanning", code: "NC-JODV01", expiresAt: PAST(100), joinedBy: track("dev-j2-uid"), scanId: null});
    await seedSession(track("j-null"), {ownerId: OWN4, status: "scanning", code: "NC-JNUL01", expiresAt: PAST(100), joinedBy: null, scanId: null});
    await seedSession(track("j-owner-pending-old"), {ownerId: OWN4, status: "pending", code: "NC-JOPD01", expiresAt: PAST(100), scanId: null});
    await seedSession(track("j-done"), {ownerId: OWN4, status: "completed", code: "NC-JDON01", expiresAt: PAST(100), joinedBy: DEV, scanId: "scan-done"});
    const before = await allSessions();
    queryLog.length = 0;
    const r = await join("NC-JOIN01", DEV);
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[٣] joinScanSession نجحت");
    deq(Object.keys(r.ret).sort(), ["consentEnabled", "evaluationEnabled", "ownerId", "sessionId", "status"], "[٣] ردّ الانضمام بمفاتيحه الخمسة (ق15، 2026-10-23، القاعدة 23: كانت أربعة؛ أُضيف consentEnabled)");
    deq([r.ret.sessionId, r.ret.ownerId, r.ret.status, r.ret.evaluationEnabled], ["j-target", OWN4, "scanning", false], "[٣] وقيمه");
    const swept = sweptLines(r.texts);
    eq(swept.length, 1, "[٣] سطر E34 واحد بالضبط");
    const p = parseLine(swept[0]);
    deq([p.from, p.key, p.keyId, p.state], ["joinScanSession", "joinedBy", hashIdForLog(DEV), "COMPLETED"], "[٣] from=joinScanSession key=joinedBy keyId=<مُهشَّر> state=COMPLETED");
    // returned: scanning لـDEV: j-target (انضمّ الآن، مُستثناة) وj-old-1 وj-old-2 وj-valid = 4؛ pending لـDEV: لا شيء. candidates=2.
    deq(counts(p), ["4", "2", "2", "0", "0"], "[٣] returned=4 candidates=2 written=2 skipped=0 failed=0");
    noteE34("الانضمام — جهاز له جلستان منقضيتان (بمفتاح joinedBy)", swept[0]);
    const after = await allSessions();
    eq(after["j-old-1"].status, "expired", "[٣] j-old-1 (مالك آخر أيضاً) كُنست");
    eq(after["j-old-2"].status, "expired", "[٣] j-old-2 كُنست");
    expectUnchanged(before, after, ["j-valid", "j-other-dev", "j-null", "j-owner-pending-old", "j-done"], "[٣]");
    eq(after["j-target"].status, "scanning", "[٣] الجلسة المنضمّ إليها scanning (المُشغِّلة: لا تُكنس)");
    eq(after["j-target"].joinedBy, DEV, "[٣] وjoinedBy = الجهاز");
    ok(typeof after["j-target"].joinedAt === "string", "[٣] وjoinedAt كُتب (الانضمام نفسه نجح)");
    ok(!("expiredAt" in after["j-target"]), "[٣] ولا expiredAt على الجلسة المُشغِّلة");
    const sq = sweepSessionQueries().filter((q) => hasFilter(q, "joinedBy"));
    eq(sq.length, 2, "[٣] استعلاما الكنس بمفتاح joinedBy بالضبط (pending وscanning)");
    ok(sq.every((q) => q.filters[0][0] === "joinedBy" && q.filters[0][2] === DEV), "[٣] كلاهما على joinedBy == uid الجهاز");
    await trackAll();
  }

  // ═══ ٤ — joinerUid=null (بلا auth): لا كنس ولا استعلام ═══
  {
    const OWN6 = track("owner-j6-uid");
    await seedSession(track("jn-target"), {ownerId: OWN6, status: "pending", code: "NC-JNOID1", expiresAt: FUTURE(40), scanId: null});
    await seedSession(track("jn-old-null"), {ownerId: OWN6, status: "scanning", code: "NC-JNOID2", expiresAt: PAST(100), joinedBy: null, scanId: null});
    await seedSession(track("jn-old-dev"), {ownerId: OWN6, status: "scanning", code: "NC-JNOID3", expiresAt: PAST(100), joinedBy: "dev-jn-x", scanId: null});
    const before = await allSessions();
    queryLog.length = 0;
    const r = await join("NC-JNOID1", null);
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[٤] الانضمام بلا هوية نجح (يكتب joinedBy=null كما كان)");
    deq([r.ret.sessionId, r.ret.status], ["jn-target", "scanning"], "[٤] والردّ كما كان");
    const swept = sweptLines(r.texts);
    eq(swept.length, 1, "[٤] السطر يُكتب مرّة واحدة حتى حين لا يجري كنس");
    eq(swept[0].replace(/totalMs=\d+/, "totalMs=<ms>"), "[sweepExpiredSessions] swept from=joinScanSession key=joinedBy keyId=missing state=NOT_RUN_NO_KEY returned=NOT_RUN candidates=NOT_RUN written=NOT_RUN skipped=NOT_RUN failed=NOT_RUN sweepMs=NOT_RUN totalMs=<ms>",
        "[٤] NOT_RUN_NO_KEY بنصّه: كل الأعداد وsweepMs NOT_RUN، والمعرّف missing");
    noteE34("الانضمام بلا هوية (joinerUid=null)", swept[0]);
    eq(queryLog.filter((q) => hasFilter(q, "joinedBy")).length, 0, "[٤] لا استعلام بـjoinedBy إطلاقاً (لا «joinedBy == null»)");
    eq(sweepSessionQueries().length, 0, "[٤] ولا أيّ استعلام كنس");
    const after = await allSessions();
    expectUnchanged(before, after, ["jn-old-null", "jn-old-dev"], "[٤]");
    await trackAll();
  }

  // ═══ ٥ — إعادة الانضمام لا تكنس (قرار المستخدم 2026-10-16)، ولا تكتب شيئاً في أيّ جلسة ═══
  // (2026-10-16، القاعدة 23: المشهد كان يثبّت أن إعادة الانضمام تكنس أيضاً — سطر E34 واحد بـreturned=3 candidates=1 written=1 وj-old-4 تصير expired — فاستُبدل بما يثبّت عدم الكنس.
  //  قرار المستخدم (منقول عن أمر المنسّق): «الكنس عند إعادة الانضمام: (ب) لا كنس. السطر الواحد مع اختباره.»)
  {
    await seedSession(track("j-old-4"), {ownerId: "owner-j4-uid", status: "scanning", code: "NC-JOLD04", expiresAt: PAST(150), joinedBy: DEV, scanId: null});
    const targetBefore = await sessionSnap("j-target");
    const before = await allSessions();
    queryLog.length = 0;
    const r = await join("NC-JOIN01", DEV);
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[٥] إعادة الانضمام نجحت (الجهاز نفسه والجلسة scanning)");
    deq(Object.keys(r.ret).sort(), ["consentEnabled", "evaluationEnabled", "ownerId", "sessionId", "status"], "[٥] ردّ إعادة الانضمام بمفاتيحه الخمسة (ق15، 2026-10-23، القاعدة 23: كانت أربعة؛ أُضيف consentEnabled)");
    deq([r.ret.sessionId, r.ret.ownerId, r.ret.status, r.ret.evaluationEnabled], ["j-target", "owner-j4-uid", "scanning", false], "[٥] وقيمه هي قيم الانضمام الأوّل بعينها");
    ok(r.texts.some((t) => t.startsWith("[joinScanSession] rejoined seen=lookup ")), "[٥] سطر rejoined القائم");
    eq(sweptLines(r.texts).length, 0, "[٥] ولا سطر كنس E34 في إعادة الانضمام");
    eq(r.texts.filter((t) => t.includes("[sweepExpiredSessions]")).length, 0, "[٥] ولا أيّ سطر من الكنس (لا swept ولا skipped ولا write FAILED)");
    eq(sweepSessionQueries().length, 0, "[٥] ولا استعلام كنس إطلاقاً (لا قراءة لجلسات الجهاز)");
    eq(queryLog.filter((q) => hasFilter(q, "joinedBy")).length, 0, "[٥] ولا استعلام بـjoinedBy");
    const after = await allSessions();
    deq(after, before, "[٥] كل مستندات الجلسات كما هي بالبايت: لا كتابة في أيّ جلسة");
    eq(after["j-old-4"].status, "scanning", "[٥] j-old-4 (منقضية، للجهاز نفسه) تبقى scanning: لم تُكنس");
    ok(!("expiredAt" in after["j-old-4"]), "[٥] ولا expiredAt عليها");
    deq(after["j-target"], before["j-target"], "[٥] الجلسة المُعاد الانضمام إليها كما هي بالبايت (لا joinedAt جديد ولا status)");
    ok((await sessionSnap("j-target")).updateTime.isEqual(targetBefore.updateTime), "[٥] وupdateTime لم يتغيّر");
    await trackAll();
  }

  // ═══ ٦ — المرفوض قبل نقطة الكنس: لا سطر كنس ولا كنس ═══
  {
    await seedSession(track("j-old-5"), {ownerId: "owner-j4-uid", status: "scanning", code: "NC-JOLD05", expiresAt: PAST(150), joinedBy: DEV, scanId: null});
    await seedSession(track("jx-expired-target"), {ownerId: "owner-j4-uid", status: "pending", code: "NC-JOINX2", expiresAt: PAST(10), scanId: null});
    const before = await allSessions();
    const r1 = await join("NC-NOSUCH", DEV);
    collectSweepLogs(r1.texts);
    ok(r1.threw && r1.threw.details && r1.threw.details.reasonCode === "SESSION_CODE_INVALID", "[٦] رمز لا جلسة له: SESSION_CODE_INVALID");
    eq(sweptLines(r1.texts).length, 0, "[٦] ولا سطر كنس");
    const r2 = await join("NC-JOINX2", DEV);
    collectSweepLogs(r2.texts);
    ok(r2.threw && r2.threw.details && r2.threw.details.reasonCode === "SESSION_EXPIRED", "[٦] جلسة منتهية بالوقت: SESSION_EXPIRED (رفضها القائم)");
    eq(sweptLines(r2.texts).length, 0, "[٦] ولا سطر كنس لمرفوض بعد معاملة الانضمام أيضاً");
    const after = await allSessions();
    eq(after["jx-expired-target"].status, "expired", "[٦] المسّ القائم يكتب «منتهية» للجلسة المستهدفة وحدها (بلا تغيير عن قبل)");
    deq(after["j-old-5"], before["j-old-5"], "[٦] وجلسات الجهاز الأخرى المنقضية لا تُكنس عند رفضه");
    await trackAll();
  }

  // ═══ ٧ — الإلغاء لا يكنس (E25) ═══
  {
    const OWN7 = track("owner-x7-uid");
    await seedSession(track("cx-valid"), {ownerId: OWN7, status: "pending", code: "NC-CXVAL1", expiresAt: FUTURE(40), scanId: null});
    await seedSession(track("cx-old-1"), {ownerId: OWN7, status: "pending", code: "NC-CXOLD1", expiresAt: PAST(100), scanId: null});
    await seedSession(track("cx-old-2"), {ownerId: OWN7, status: "scanning", code: "NC-CXOLD2", expiresAt: PAST(100), joinedBy: "dev-cx", scanId: null});
    const before = await allSessions();
    queryLog.length = 0;
    const r = await cancel("cx-valid", "cancelled_by_owner", OWN7);
    ok(r.threw === null, "[٧] الإلغاء نجح");
    eq(r.ret.status, "cancelled", "[٧] cx-valid cancelled");
    eq(sweptLines(r.texts).length, 0, "[٧] ولا سطر كنس");
    eq(sweepSessionQueries().length, 0, "[٧] ولا استعلام كنس");
    const after = await allSessions();
    expectUnchanged(before, after, ["cx-old-1", "cx-old-2"], "[٧] الإلغاء لا يكنس: المنقضيتان");
    await trackAll();
  }

  // ═══ ٨ — E32: القفل الحيّ يُتخطّى، والقديم لا، ولا يُمسّ قفل ولا حجز (E29) ═══
  {
    const OWN8 = track("owner-cl-uid");
    await seedOwner(OWN8);
    await seedSession(track("cl-live"), {ownerId: OWN8, status: "scanning", code: "NC-CLLIV1", expiresAt: PAST(10), joinedBy: "dev-cl-a", scanId: null});
    await seedSession(track("cl-stale"), {ownerId: OWN8, status: "scanning", code: "NC-CLSTL1", expiresAt: PAST(20), joinedBy: "dev-cl-b", scanId: null});
    await seedSession(track("cl-plain"), {ownerId: OWN8, status: "scanning", code: "NC-CLPLN1", expiresAt: PAST(30), joinedBy: "dev-cl-c", scanId: null});
    const reservation = (ms) => ({userId: OWN8, isFreeTrial: false, deviceFP: null, reservedAtMs: ms});
    await db.collection("scanClaims").doc(track("scan-cl-live")).set({scanId: "scan-cl-live", userId: OWN8, sessionId: "cl-live", claimedAtMs: Date.now() - 1000, claimedAt: new Date(), reservation: reservation(Date.now() - 1000)});
    await db.collection("scanClaims").doc(track("scan-cl-stale")).set({scanId: "scan-cl-stale", userId: OWN8, sessionId: "cl-stale", claimedAtMs: Date.now() - 10 * MIN, claimedAt: new Date(Date.now() - 10 * MIN), reservation: reservation(Date.now() - 10 * MIN)});
    const claimsBefore = await allClaims();
    const before = await allSessions();
    const r = await create(OWN8);
    collectSweepLogs(r.texts);
    track(r.ret.sessionId);
    const swept = sweptLines(r.texts);
    const p = parseLine(swept[0]);
    deq([p.state, ...counts(p)], ["COMPLETED", "4", "3", "2", "1", "0"], "[٨] returned=4 candidates=3 written=2 skipped=1: القفل الحيّ متخطّى (وتُحسب مرشَّحة)");
    noteE34("E32 — قفل حيّ (skipped=1) وقفل قديم وجلسة بلا قفل", swept[0]);
    ok(r.texts.includes(`[sweepExpiredSessions] skipped from=createScanSession session=${hashIdForLog("cl-live")} reason=claim_in_flight`), "[٨] سطر التخطّي بسببه المسمّى ومعرّفه مُهشَّراً");
    const after = await allSessions();
    eq(after["cl-live"].status, "scanning", "[٨] cl-live تبقى scanning (تحليل يجري)");
    eq(after["cl-stale"].status, "expired", "[٨] القفل القديم لا يمنع: cl-stale كُنست");
    eq(after["cl-plain"].status, "expired", "[٨] وجلسة بلا قفل كُنست");
    deq(await allClaims(), claimsBefore, "[٨] لا قفل مُسّ ولا حجز أُعيد ولا مستند حُذف (E29: الكنس لا يعيد حجزاً)");
    // القفل الحيّ يصير قديماً ⟵ النداء اللاحق يكنسها
    await db.collection("scanClaims").doc("scan-cl-live").update({claimedAtMs: Date.now() - 6 * MIN});
    const r2 = await create(OWN8);
    collectSweepLogs(r2.texts);
    track(r2.ret.sessionId);
    const p2 = parseLine(sweptLines(r2.texts)[0]);
    deq([p2.state, ...counts(p2)], ["COMPLETED", "3", "1", "1", "0", "0"], "[٨] بعد أن يصير القفل قديماً: النداء اللاحق يكنسها (written=1)");
    eq((await sessionSnap("cl-live")).data().status, "expired", "[٨] cl-live منتهية الآن");
    await trackAll();
  }

  // ═══ ٩ — READ_FAILED: لا يغيّر الردّ ولا يكتب ═══
  {
    const OWN9 = track("owner-rf-uid");
    await seedOwner(OWN9);
    await seedSession(track("rf-1"), {ownerId: OWN9, status: "scanning", code: "NC-RF0001", expiresAt: PAST(100), joinedBy: "dev-rf", scanId: null});
    await seedSession(track("rf-2"), {ownerId: OWN9, status: "pending", code: "NC-RF0002", expiresAt: PAST(100), scanId: null});
    const SECRET = "SECRET-FAILED_PRECONDITION: The query requires an index. https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=ZZ sk-SECRETKEY-WXYZ";
    queryFailure = (filters) => (filters.some(([f, , v]) => f === "ownerId" && v === OWN9) && filters.some(([f, , v]) => f === "status" && v === "scanning") ?
      Object.assign(new Error(SECRET), {code: 9}) : null);
    const before = await allSessions();
    let r;
    try {
      r = await create(OWN9);
    } finally {
      queryFailure = null;
    }
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[٩] createScanSession نجحت رغم فشل قراءة الكنس");
    deq(Object.keys(r.ret).sort(), ["code", "expiresInMinutes", "protocolParts", "sessionId"], "[٩] والردّ بمفاتيحه الثلاثة القائمة + protocolParts (S-P6-03، القاعدة 23)");
    track(r.ret.sessionId);
    const swept = sweptLines(r.texts);
    eq(swept.length, 1, "[٩] سطر E34 واحد");
    const normalized = swept[0].replace(/sweepMs=\d+ totalMs=\d+/, "sweepMs=<ms> totalMs=<ms>");
    eq(normalized, `[sweepExpiredSessions] swept from=createScanSession key=ownerId keyId=${hashIdForLog(OWN9)} state=READ_FAILED returned=NOT_RUN candidates=NOT_RUN written=NOT_RUN skipped=NOT_RUN failed=NOT_RUN sweepMs=<ms> totalMs=<ms> [Error] code=9`,
        "[٩] READ_FAILED بنصّه: الأعداد NOT_RUN، وsweepMs عدد، ويُلحَق الصنف والرمز");
    noteE34("READ_FAILED — فشل استعلام الكنس (رمز 9)", swept[0]);
    ok(!r.texts.join("\n").includes("SECRET") && !r.texts.join("\n").includes("sk-SECRETKEY"), "[٩] ونصّ رسالة الخطأ لا يصل السجلّ (القاعدة 36: الصنف والرمز وحدهما)");
    const after = await allSessions();
    expectUnchanged(before, after, ["rf-1", "rf-2"], "[٩] لا كنس جزئي: المنقضيتان");
    ok(r.lines.find((l) => l.text.startsWith("[sweepExpiredSessions] swept ")).level === "error", "[٩] السطر بمستوى error");
    await trackAll();
  }

  // ═══ ١٠ — BUDGET_EXHAUSTED: ميزانية الانضمام 3 ث تنفد بكتابات بطيئة ═══
  {
    const OWNB = track("owner-bx-uid");
    const DEVB = track("dev-bx-uid");
    for (let i = 0; i < 14; i++) {
      await seedSession(track(`bx-${String(i).padStart(2, "0")}`), {ownerId: OWNB, status: "scanning", code: `NC-BX${String(i).padStart(4, "0")}`, expiresAt: PAST(1000 - i), joinedBy: DEVB, scanId: null});
    }
    await seedSession(track("bx-target"), {ownerId: OWNB, status: "pending", code: "NC-BUDG01", expiresAt: FUTURE(40), scanId: null});
    await seedSession(track("bx-target2"), {ownerId: OWNB, status: "pending", code: "NC-BUDG02", expiresAt: FUTURE(40), scanId: null});
    commitDelayFor = (name) => (/\/scanSessions\/bx-\d\d$/.test(name) ? 450 : 0); // كتابات الكنس وحدها بطيئة، لا معاملة الانضمام نفسها
    let r;
    const t0 = Date.now();
    try {
      r = await join("NC-BUDG01", DEVB);
    } finally {
      commitDelayFor = null;
    }
    const took = Date.now() - t0;
    collectSweepLogs(r.texts);
    ok(r.threw === null, "[١٠] الانضمام نجح والكنس بطيء");
    deq([r.ret.sessionId, r.ret.status], ["bx-target", "scanning"], "[١٠] والردّ كما كان");
    const swept = sweptLines(r.texts);
    const p = parseLine(swept[0]);
    eq(p.state, "BUDGET_EXHAUSTED", "[١٠] state=BUDGET_EXHAUSTED");
    eq(p.candidates, "14", "[١٠] candidates=14");
    const written = Number(p.written);
    ok(written >= 5 && written <= 12, `[١٠] written=${written}: بعض ما عولج قبل نفاد 3 ث، لا كلّه ولا لا شيء`);
    deq([p.skipped, p.failed], ["0", "0"], "[١٠] skipped=0 failed=0");
    ok(Number(p.sweepMs) >= SWEEP_PLAN[SWEEP_CALLER.JOIN_SCAN_SESSION].budgetMs && Number(p.sweepMs) < 5500, `[١٠] sweepMs=${p.sweepMs} في [3000، 5500): توقّف عند نفاد الميزانية لا بعدها بكثير`);
    ok(p.totalMs >= Number(p.sweepMs), "[١٠] totalMs ≥ sweepMs");
    ok(took < 6000, `[١٠] النداء كلّه ${took} مل ث: لم يُؤخَّر فوق ميزانية الكنس`);
    noteE34("E34 — ميزانية الانضمام (3 ث) تنفد بكتابات بطيئة", swept[0]);
    const s1 = await allSessions();
    const nowExpired = Object.keys(s1).filter((id) => /^bx-\d\d$/.test(id) && s1[id].status === "expired");
    eq(nowExpired.length, written, "[١٠] ما كُتب فعلاً = written المُعلَن");
    // النداء اللاحق (من الجهاز نفسه، بلا تأخير) يكمل الباقي
    const r2 = await join("NC-BUDG02", DEVB);
    collectSweepLogs(r2.texts);
    const p2 = parseLine(sweptLines(r2.texts)[0]);
    deq([p2.state, p2.candidates, p2.written], ["COMPLETED", String(14 - written), String(14 - written)], "[١٠] النداء اللاحق يكنس الباقي: COMPLETED");
    const s2 = await allSessions();
    ok(Object.keys(s2).filter((id) => /^bx-\d\d$/.test(id)).every((id) => s2[id].status === "expired"), "[١٠] كل الأربع عشرة منتهية بعد النداءين");
    await trackAll();
  }

  // ═══ ١١ — شكل الاستعلامات كلّها، ولا حذف ═══
  {
    const sq = sweepSessionQueries(everQueries);
    ok(sq.length >= 20, `[١١] رُصد ${sq.length} استعلام كنس عبر الاختبار كلّه`);
    ok(sq.every((q) => q.filters.length === 2 && q.filters.every(([, op]) => op === "EQUAL")), "[١١] كل استعلام كنس مرشِّحان بمساواة لا غير (المفتاح وstatus)");
    ok(sq.every((q) => q.orderBys === 0 && !q.hasLimit), "[١١] ولا ترتيب ولا حدّ في أيّ منها (لا فهرس مركّب: القاعدة 43)");
    const claimQs = everQueries.filter((q) => hasFilter(q, "sessionId"));
    ok(claimQs.length >= 3 && claimQs.every((q) => q.filters.length === 1 && q.filters[0][1] === "EQUAL" && q.orderBys === 0 && !q.hasLimit), `[١١] واستعلامات الأقفال (${claimQs.length}) مساواة واحدة على sessionId`);
    const finalSessions = await allSessions();
    for (const id of everSeen) ok(id in finalSessions, `[١١] ${id} ما زالت موجودة (لا حذف)`);
    ok(!Object.entries(finalSessions).some(([, s]) => s.status === "cancelled" && s.expiredAt), "[١١] ولا جلسة cancelled كتبها الكنس");
  }

  // ═══ ١٢ — السجلّ: لا معرّف ولا uid خامّ ولا نصّ خطأ في سطور الكنس ═══
  {
    ok(sweepRelated.length >= 20, `[١٢] ${sweepRelated.length} سطر كنس مفحوص`);
    const blob = sweepRelated.join("\n");
    for (const id of SECRET_IDS) ok(!blob.includes(id), `[١٢] المعرّف «${id}» لا يظهر خامّاً في سطور الكنس`);
    ok(!/SECRET|sk-/.test(blob), "[١٢] ولا نصّ خطأ");
    ok(sweepRelated.every((t) => !/code=NC-/.test(t)), "[١٢] ولا رمز جلسة");
  }

  console.log("\nE34 lines observed (this run):");
  console.log(E34_OBSERVED.join("\n"));
  console.log(`\nALL PASS (${n} assertions)`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL:", (e && e.stack) || e);
  process.exit(1);
});
