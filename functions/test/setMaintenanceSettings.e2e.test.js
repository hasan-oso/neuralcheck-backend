// E2E test: set-maintenance-settings.js مقابل النداءين الحقيقيين setProtocolSettings وsetShopProtocolParts على محاكي Firestore (القواعد 37 و41 و23).
// **الاستبدال: لا شيء.** الأداة تمرّ بمسار تهيئتها الحقيقي (تطبيق Admin مسمّى بمشروع الاختبار من البيئة عبر --emulator)، والنداءان بـ`.run()` على الدالّتين المُصدَّرتين (`protocolSettingsAdmin.setProtocolSettings` و`shopProtocolAdmin.setShopProtocolParts`)
// بطلب مشرف مؤكَّد البريد (ADMIN_EMAILS[0]). (أمر المنسّق قال «setShopProtocolPartsHandler المُصدَّر»: المعالج غير مُصدَّر في shopProtocolAdmin.js — المُصدَّر النداء المغلَّف setShopProtocolParts و`.run` يصل المعالج نفسه؛ فرق معلَن.)
//
// المقارنة: لكل حالة بذرة ← الأداة ← لقطة (الإعدادات وhistory والمحالّ وعدّاد reports) ← إعادة تفريغ المحاكي وإعادة البذرة نفسها ← النداءان ← لقطة؛ **المستندات متطابقة** عدا الفرق المعلَن: updatedBy/supersededBy (الأداة: hashIdForLog(وسم ثابت)؛ النداء: hashIdForLog(uid المشرف))
// وقيم الأوقات (وقت خادم في الحالتين: يُتحقَّق أنها Timestamp وتُستبدل بعلامة).
//
// **هذا الملفّ يعدّ الإخفاق ولا يرمي عند أول واحد** (كُتب قبل الأداة: القاعدتان 18 و23).
//
//   ١ تكافؤ الأداة والنداءين في أربع حالات (لا إعدادات/إعدادات حاضرة/hours موجودة/لا تغيير) وبحضور محالّ أخرى لا تُمسّ
//   ٢ المعاينة لا تغيّر شيئاً (لقطة قبل/بعد متطابقة)، ولا مشغّل: reports فارغة وisActive/expiresAt كما هما
//   ٣ التراجع على المحاكي: القيم السابقة بالإلحاق (version/history)، وABSENT لـhours يبقى 72 مُعلَناً، والجزآن false
//   ٤ فرق غير متوقَّع (كتابة جانبية حقيقية بعد المعاملة) ⟵ exit 3
//   ٥ البيئة: بلا --emulator ومضيف المحاكي مضبوط ⟵ exit 5 بلا قراءة ولا كتابة؛ ومع --emulator يعمل
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/setMaintenanceSettings.e2e.test.js"

require("./lib/emulatorOnlyGuard"); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

process.env.SMTP_USER = process.env.SMTP_USER || "dummy@x.com";
process.env.SMTP_PASS = process.env.SMTP_PASS || "dummy";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده (عنوانه محلّي)
const {admin, db, ADMIN_EMAILS} = require("../src/utils/admin");
const {setProtocolSettings} = require("../src/admin/protocolSettingsAdmin");
const {setShopProtocolParts} = require("../src/admin/shopProtocolAdmin");
const {hashIdForLog} = require("../src/utils/logRedaction");

let L = null;
let TOOL = null;
let loadError = null;
try { L = require("../scripts/lib/maintenanceSettings"); TOOL = require("../scripts/set-maintenance-settings"); } catch (e) { loadError = e; }

let n = 0;
const failures = [];
const ck = (cond, label) => { n++; if (!cond) failures.push(label); };
const ceq = (a, b, label) => { n++; if (!Object.is(a, b)) failures.push(`${label} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const cdeq = (a, b, label) => { n++; try { assert.deepStrictEqual(a, b); } catch (e) { failures.push(`${label} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); } };
const scene = async (name, fn) => {
  try { await fn(); } catch (e) { n++; failures.push(`SETUP/RUNTIME ERROR في المشهد ${name}: ${String((e && e.stack) || e).split("\n").slice(0, 3).join(" | ").slice(0, 400)}`); }
};

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = process.env.GCLOUD_PROJECT;
const ADMIN_AUTH = {uid: "admin-uid-sms-e2e", token: {email: ADMIN_EMAILS[0], email_verified: true}};
const ADMIN_ACTOR = hashIdForLog(ADMIN_AUTH.uid);
const TOOL_ACTOR = hashIdForLog("script:set-maintenance-settings");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "set-maintenance-settings-e2e-"));
let fileSeq = 0;
const newFile = () => path.join(tmpDir, `rollback-${++fileSeq}.json`);
const isTs = (v) => v !== null && typeof v === "object" && typeof v.toMillis === "function";

async function clearEmulator() {
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {method: "DELETE"});
  if (!res.ok) throw new Error(`clear emulator failed: ${res.status}`);
}
const settingsRef = () => db.collection("protocolSettings").doc("current");

/** حالة البذرة: {settings: ?Object, users: {uid: Object}, reports: {id: Object}} */
async function seedState(state) {
  if (state.settings) await settingsRef().set(state.settings);
  for (const [uid, data] of Object.entries(state.users || {})) await db.collection("users").doc(uid).set(data);
  for (const [id, data] of Object.entries(state.reports || {})) await db.collection("reports").doc(id).set(data);
}
/** لقطة كاملة: الإعدادات وhistory وكل المحالّ وreports. الأوقات تبقى Timestamp (يطبّعها normalize لاحقاً). */
async function snapshot() {
  const settingsSnap = await settingsRef().get();
  const historySnap = await settingsRef().collection("history").get();
  const usersSnap = await db.collection("users").get();
  const reportsSnap = await db.collection("reports").get();
  return {
    settings: settingsSnap.exists ? settingsSnap.data() : null,
    history: Object.fromEntries(historySnap.docs.map((d) => [d.id, d.data()])),
    users: Object.fromEntries(usersSnap.docs.map((d) => [d.id, d.data()])),
    reports: reportsSnap.size,
  };
}
const normalize = (v, actors) => {
  if (isTs(v)) return "<TS>";
  if (Array.isArray(v)) return v.map((x) => normalize(x, actors));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalize(v[k], actors)]));
  return v;
};
/** يطبّع لقطة للمقارنة: الأوقات ⟵ <TS>؛ updatedBy/supersededBy ⟵ <ACTOR> (بعد التحقّق من قيمة الفاعل المتوقَّعة). */
function comparable(snap, expectedActor) {
  const out = JSON.parse(JSON.stringify(normalize(snap)));
  if (out.settings && out.settings.updatedBy !== undefined) { ck(snap.settings.updatedBy === expectedActor || snap.settings.updatedBy === "#aaaaaaaaaaaa", `updatedBy=${snap.settings.updatedBy} ≠ ${expectedActor}`); out.settings.updatedBy = "<ACTOR>"; }
  for (const [id, h] of Object.entries(out.history)) {
    if (h.supersededBy !== undefined) { ck(snap.history[id].supersededBy === expectedActor, `supersededBy(${id})=${snap.history[id].supersededBy} ≠ ${expectedActor}`); h.supersededBy = "<ACTOR>"; }
  }
  return out;
}

async function runTool(argv, io = {}) {
  const out = [];
  const err = [];
  const code = await TOOL.main(argv, {out: (s) => out.push(s), err: (s) => err.push(s), ...io});
  return {code, out, err, text: [...out, ...err].join("\n"), line: (p) => out.filter((l) => l.startsWith(p))};
}
const toolWrite = (uid, file, extra = []) => runTool(["--mode", "write", "--emulator", "--shop", uid, "--confirm", L.CONFIRM_WRITE, "--rollback-file", file, ...extra]);
const toolRollback = (file) => runTool(["--mode", "rollback", "--emulator", "--confirm", L.CONFIRM_ROLLBACK, "--rollback-file", file]);
const callHandlers = async (uid) => {
  const s = await setProtocolSettings.run({data: {settings: {openBeforeValidityHours: 72}}, auth: ADMIN_AUTH, rawRequest: {headers: {}}});
  const p = await setShopProtocolParts.run({data: {ownerId: uid, parts: {purposes: true, batteryBeforeAfter: true}}, auth: ADMIN_AUTH, rawRequest: {headers: {}}});
  return {s, p};
};

const FUTURE = () => new Date(Date.now() + 30 * 24 * 3600 * 1000);
const OTHER_FIELDS = (over = {}) => ({name: "محلّ التجربة", displayName: "Display", type: "shop", email: "private-e2e@example.test", phone: "+905559990000", plan: "shop_pro", isActive: true, expiresAt: FUTURE(), scansRemaining: 12, scansTotal: 40, ...over});
const PEER = () => ({name: "محلّ آخر", type: "shop", email: "peer-e2e@example.test", isActive: true, expiresAt: FUTURE(), protocolParts: {purposes: false}});

const CASES = [
  {
    key: "no-settings", label: "لا مستند إعدادات + محلّ بلا protocolParts",
    seed: () => ({settings: null, users: {"shop-a": OTHER_FIELDS(), "shop-peer": PEER()}}),
    uid: "shop-a", expect: {version: 1, history: [], wrote: true},
  },
  {
    key: "settings-v3", label: "إعدادات v3 بلا hours + محلّ بجزء آخر مفعَّل وpurposes=false صريحة",
    seed: () => ({settings: {version: 3, repeatRate: 0.1, collectionPhase: true, updatedAt: new Date(Date.now() - 100000), updatedBy: "#aaaaaaaaaaaa"}, users: {"shop-a": OTHER_FIELDS({protocolParts: {coldRepeat: true, purposes: false}}), "shop-peer": PEER()}}),
    uid: "shop-a", expect: {version: 4, history: ["3"], wrote: true},
  },
  {
    key: "hours-168", label: "إعدادات v5 وhours=168 + محلّ purposes=true وbatteryBeforeAfter غائب",
    seed: () => ({settings: {version: 5, openBeforeValidityHours: 168, returnReasons: [{key: "k1", ar: "أ", tr: "a", active: true}], updatedAt: new Date(Date.now() - 100000), updatedBy: "#aaaaaaaaaaaa"}, users: {"shop-a": OTHER_FIELDS({protocolParts: {purposes: true}}), "shop-peer": PEER()}}),
    uid: "shop-a", expect: {version: 6, history: ["5"], wrote: true},
  },
  {
    key: "unchanged", label: "كل شيء مضبوط مسبقاً ⟵ لا كتابة",
    seed: () => ({settings: {version: 2, openBeforeValidityHours: 72, updatedAt: new Date(Date.now() - 100000), updatedBy: "#aaaaaaaaaaaa"}, users: {"shop-a": OTHER_FIELDS({protocolParts: {purposes: true, batteryBeforeAfter: true, coldRepeat: true}}), "shop-peer": PEER()}}),
    uid: "shop-a", expect: {version: 2, history: [], wrote: false},
  },
];

(async () => {
  ck(loadError === null && L !== null && TOOL !== null, `تحميل الأداة فشل: ${loadError && (loadError.code || loadError.name)}`);

  // ═══ ١ — التكافؤ مع النداءين الحقيقيين ═══
  for (const c of CASES) {
    await scene(`١ ${c.key}`, async () => {
      await clearEmulator();
      await seedState({...c.seed(), reports: {"scan-r": {userId: c.uid, deviceModel: "X"}}});
      const seeded = await snapshot();
      const file = newFile();
      const t = await toolWrite(c.uid, file);
      ceq(t.code, 0, `[١] ${c.key}: الأداة exit 0 — ${t.text.slice(0, 300)}`);
      ceq(t.line("RESULT")[0], c.expect.wrote ? "RESULT|OK mode=write exit=0 writes=2" : "RESULT|UNCHANGED mode=write exit=0 writes=0", `[١] ${c.key}: سطر RESULT`);
      ck(!t.text.includes("DIFF-UNEXPECTED"), `[١] ${c.key}: DIFF-UNEXPECTED`);
      const afterTool = await snapshot();

      await clearEmulator();
      await seedState({...c.seed(), reports: {"scan-r": {userId: c.uid, deviceModel: "X"}}});
      const h = await callHandlers(c.uid);
      ceq(h.s.changed, c.key !== "unchanged", `[١] ${c.key}: (ضابط) النداء الحقيقي كتب الإعدادات أو لم يكتب كما هو متوقَّع`);
      const afterHandlers = await snapshot();

      // المقارنة: نفس البنية والقيم عدا الفرق المعلَن (الفاعل) والأوقات
      cdeq(comparable(afterTool, TOOL_ACTOR), comparable(afterHandlers, ADMIN_ACTOR), `[١] ${c.key}: **مستندات الأداة = مستندات النداءين** (عدا الفاعل المعلَن والأوقات)`);
      cdeq(Object.keys(afterTool.history).sort(), c.expect.history, `[١] ${c.key}: مستندات history`);
      ceq(afterTool.settings.version, c.expect.version, `[١] ${c.key}: version`);
      if (c.expect.wrote && afterTool.settings.updatedAt !== undefined) {
        ck(isTs(afterTool.settings.updatedAt), `[١] ${c.key}: updatedAt Timestamp`);
        ceq(afterTool.settings.updatedBy, TOOL_ACTOR, `[١] ${c.key}: updatedBy = hashIdForLog(الوسم الثابت)`);
        ceq(afterHandlers.settings.updatedBy, ADMIN_ACTOR, `[١] ${c.key}: (ضابط) updatedBy النداء = hashIdForLog(uid المشرف)`);
      }
      for (const id of c.expect.history) { ck(isTs(afterTool.history[id].supersededAt), `[١] ${c.key}: supersededAt Timestamp`); ceq(afterTool.history[id].supersededBy, TOOL_ACTOR, `[١] ${c.key}: supersededBy`); }
      // ما لم تُمسّه الأداة: المحلّ الآخر وreports وحقول المحلّ الأخرى (isActive وexpiresAt وplan…)
      cdeq(normalize(afterTool.users["shop-peer"]), normalize(seeded.users["shop-peer"]), `[١] ${c.key}: المحلّ الآخر لم يُمسّ`);
      ceq(afterTool.reports, seeded.reports, `[١] ${c.key}: reports لم تتغيّر (لا مشغّل)`);
      for (const k of ["isActive", "expiresAt", "plan", "scansRemaining", "scansTotal", "email", "phone", "name", "displayName", "type"]) cdeq(normalize(afterTool.users["shop-a"][k]), normalize(seeded.users["shop-a"][k]), `[١] ${c.key}: حقل المحلّ ${k} لم يتغيّر`);
      if (c.key !== "unchanged") {
        const parts = afterTool.users["shop-a"].protocolParts;
        ceq(parts.purposes, true, `[١] ${c.key}: purposes`); ceq(parts.batteryBeforeAfter, true, `[١] ${c.key}: batteryBeforeAfter`);
        for (const k of Object.keys(seeded.users["shop-a"].protocolParts || {})) if (!["purposes", "batteryBeforeAfter"].includes(k)) ceq(parts[k], seeded.users["shop-a"].protocolParts[k], `[١] ${c.key}: الجزء ${k} بقي`);
      } else {
        cdeq(normalize(afterTool), normalize(seeded), `[١] unchanged: اللقطة = البذرة (لا كتابة)`);
      }
      const rf = JSON.parse(fs.readFileSync(file, "utf8"));
      ceq(rf.shopUid, c.uid, `[١] ${c.key}: ملفّ التراجع للمحلّ`);
      ceq(rf.projectId, PROJECT, `[١] ${c.key}: projectId في الملفّ`);
      ceq(rf.target, "EMULATOR", `[١] ${c.key}: target في الملفّ`);
      ck(!JSON.stringify(rf).includes("private-e2e@example.test") && !JSON.stringify(rf).includes("+905559990000"), `[١] ${c.key}: لا بريد ولا هاتف في ملفّ التراجع`);
      ck(!t.text.includes("private-e2e@example.test") && !t.text.includes("+905559990000") && !t.text.includes(c.uid), `[١] ${c.key}: لا بريد ولا هاتف ولا uid خامّ في المخرَج`);
    });
  }

  // ═══ ٢ — المعاينة لا تغيّر شيئاً ═══
  await scene("٢ المعاينة", async () => {
    await clearEmulator();
    await seedState({...CASES[1].seed(), reports: {"scan-r": {userId: "shop-a", deviceModel: "X"}}});
    const before = await snapshot();
    const p1 = await runTool(["--mode", "preview", "--emulator"]);
    ceq(p1.code, 0, `[٢] المعاينة exit 0 — ${p1.text.slice(0, 200)}`);
    const p2 = await runTool(["--mode", "preview", "--emulator", "--shop", "shop-a"]);
    ceq(p2.code, 0, "[٢] المعاينة مع --shop exit 0");
    const after = await snapshot();
    cdeq(normalize(after), normalize(before), "[٢] **لقطة قبل المعاينة = بعدها** (لا كتابة ولا history)");
    ck(p1.line("PREVIEW|SHOP ").length === 2, `[٢] صفّا محلّين (${p1.line("PREVIEW|SHOP ").length})`);
    ck(p1.line("PREVIEW|SETTINGS")[0] === "PREVIEW|SETTINGS state=PRESENT version=3 openBeforeValidityHours=ABSENT", `[٢] سطر الإعدادات: ${p1.line("PREVIEW|SETTINGS")[0]}`);
    ck(p2.line("PLAN|SUMMARY")[0] === "PLAN|SUMMARY writes=3 unchanged=0", `[٢] الخطّة: ${p2.line("PLAN|SUMMARY")[0]}`);
    ck(!p1.text.includes("private-e2e@example.test") && !p1.text.includes("+905559990000") && !p1.text.includes("shop-a") && !p2.text.includes("shop-a"), "[٢] لا بريد ولا هاتف ولا uid خامّ");
    ck(p1.line("PREVIEW|ENV")[0] === `PREVIEW|ENV target=EMULATOR project=${PROJECT}`, `[٢] سطر البيئة: ${p1.line("PREVIEW|ENV")[0]}`);
    ceq(after.reports, 1, "[٢] reports كما هي");
  });

  // ═══ ٣ — التراجع على المحاكي ═══
  await scene("٣ تراجع settings-v3", async () => {
    const c = CASES[1];
    await clearEmulator();
    await seedState(c.seed());
    const seeded = await snapshot();
    const file = newFile();
    const w = await toolWrite(c.uid, file);
    ceq(w.code, 0, `[٣] الكتابة — ${w.text.slice(0, 200)}`);
    const r = await toolRollback(file);
    ceq(r.code, 0, `[٣] التراجع exit 0 — ${r.text.slice(0, 300)}`);
    ck(!r.text.includes("DIFF-UNEXPECTED"), "[٣] لا DIFF-UNEXPECTED");
    const after = await snapshot();
    const parts = after.users[c.uid].protocolParts;
    cdeq(parts, {coldRepeat: true, purposes: false, batteryBeforeAfter: false}, "[٣] الجزآن: purposes عادت false، وbatteryBeforeAfter كانت غائبة فصارت false صريحة (مُعلَن)، وجزء آخر بقي");
    ceq(after.settings.openBeforeValidityHours, 72, "[٣] hours كانت غائبة: لا تُمحى فتبقى 72");
    ceq(after.settings.version, 4, "[٣] لا إصدار جديد للإعدادات في التراجع (لا شيء يُكتب هناك)");
    ck(r.out.includes("ROLLBACK|HOURS previous=ABSENT action=KEPT reason=ABSENT_CANNOT_BE_CLEARED current=72"), `[٣] إعلان hours: ${r.line("ROLLBACK").join(" | ")}`);
    for (const k of Object.keys(seeded.users[c.uid])) ck(after.users[c.uid][k] !== undefined, `[٣] الحقل ${k} ما زال موجوداً (لا حذف)`);
    cdeq(Object.keys(after.history), ["3"], "[٣] history/3 باقية (بالإلحاق)");
  });
  await scene("٣ تراجع hours-168", async () => {
    const c = CASES[2];
    await clearEmulator();
    await seedState(c.seed());
    const file = newFile();
    const w = await toolWrite(c.uid, file);
    ceq(w.code, 0, `[٣] الكتابة — ${w.text.slice(0, 200)}`);
    const r = await toolRollback(file);
    ceq(r.code, 0, `[٣] التراجع exit 0 — ${r.text.slice(0, 300)}`);
    const after = await snapshot();
    ceq(after.settings.openBeforeValidityHours, 168, "[٣] hours عادت 168");
    ceq(after.settings.version, 7, "[٣] version 5 ← 6 (الكتابة) ← 7 (التراجع)");
    cdeq(Object.keys(after.history).sort(), ["5", "6"], "[٣] history/5 وhistory/6");
    ceq(after.history["6"].openBeforeValidityHours, 72, "[٣] history/6 تحمل 72 (النسخة السابقة للتراجع)");
    ceq(after.users[c.uid].protocolParts.purposes, true, "[٣] purposes بقيت true (كانت true)");
    ceq(after.users[c.uid].protocolParts.batteryBeforeAfter, false, "[٣] batteryBeforeAfter كانت غائبة ⟵ false");
    ceq(after.settings.updatedBy, TOOL_ACTOR, "[٣] updatedBy");
    cdeq(after.settings.returnReasons, [{key: "k1", ar: "أ", tr: "a", active: true}], "[٣] حقل الإعدادات الآخر بقي");
  });

  // ═══ ٤ — فرق غير متوقَّع (كتابة جانبية حقيقية) ═══
  await scene("٤ فرق غير متوقَّع", async () => {
    const c = CASES[1];
    await clearEmulator();
    await seedState(c.seed());
    const t = await toolWrite(c.uid, newFile(), []);
    ceq(t.code, 0, "[٤] (ضابط) الكتابة العادية تنجح");
    await clearEmulator();
    await seedState(c.seed());
    const side = await runTool(["--mode", "write", "--emulator", "--shop", c.uid, "--confirm", L.CONFIRM_WRITE, "--rollback-file", newFile()], {
      afterTransaction: async () => { await db.collection("users").doc(c.uid).update({plan: "SIDE-WRITE-VALUE"}); },
    });
    ceq(side.code, 3, `[٤] كتابة جانبية ⟵ exit 3 — ${side.text.slice(0, 200)}`);
    ck(side.out.includes("DIFF-UNEXPECTED SHOP:plan"), `[٤] DIFF-UNEXPECTED SHOP:plan — ${side.line("DIFF").join(" | ")}`);
    ck(!side.text.includes("SIDE-WRITE-VALUE"), "[٤] القيمة لا تُطبع");
  });

  // ═══ ٥ — البيئة ═══
  await scene("٥ البيئة", async () => {
    await clearEmulator();
    await seedState(CASES[1].seed());
    const before = await snapshot();
    const noFlag = await runTool(["--mode", "preview"]);
    ceq(noFlag.code, 5, `[٥] بلا --emulator والمضيف مضبوط ⟵ exit 5 — ${noFlag.text.slice(0, 200)}`);
    ck(noFlag.text.includes("EMULATOR_HOST_WITHOUT_FLAG"), "[٥] السبب مسمّى");
    const noFlagWrite = await runTool(["--mode", "write", "--shop", "shop-a", "--confirm", L.CONFIRM_WRITE, "--rollback-file", newFile()]);
    ceq(noFlagWrite.code, 5, "[٥] الكتابة بلا --emulator ⟵ exit 5");
    const wrongProject = await runTool(["--mode", "preview", "--emulator"], {env: {...process.env, GCLOUD_PROJECT: L.PROJECT_ID, GOOGLE_CLOUD_PROJECT: L.PROJECT_ID, FIREBASE_CONFIG: JSON.stringify({projectId: L.PROJECT_ID})}});
    ceq(wrongProject.code, 5, "[٥] --emulator ومشروع الإنتاج في البيئة ⟵ exit 5");
    cdeq(normalize(await snapshot()), normalize(before), "[٥] لا أثر في أيّ حالة رفض");
    const ok1 = await runTool(["--mode", "preview", "--emulator"]);
    ceq(ok1.code, 0, "[٥] --emulator سليم يعمل");
  });

  fs.rmSync(tmpDir, {recursive: true, force: true});
  if (failures.length > 0) {
    console.error(`\nsetMaintenanceSettings.e2e.test.js: ${failures.length} FAILED of ${n}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    await admin.app().delete().catch(() => {});
    process.exit(1);
  }
  console.log(`setMaintenanceSettings.e2e.test.js: ${n}/${n} assertions passed`);
  await admin.app().delete().catch(() => {});
})().catch((e) => {
  console.error("FATAL:", e && e.stack || e);
  process.exit(1);
});
