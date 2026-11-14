// E2E test: owner-activity-window-readonly.js على محاكي Firestore (وAuth إن وُجد) — جولة الفحص ٢ الجلسة ١، 2026-10-14 +03، القاعدتان 37 و41.
//
// ما يجري على الطبقات الحقيقية: Firestore (محاكي) باستعلامات select/limit/count/where الحقيقية وTimestamp الحقيقي وreportRaw الحقيقي؛ والسكربت يُشغَّل **بالأمر الذي يشغّله المستخدم** في عملية فرعية حين يوجد محاكي Auth
// (getUserByEmail حقيقي)، وإلا في العملية بـAuth مزيَّف (يُطبَع «AUTH-EMULATOR CASES: FAKE»). ما سوى Auth حقيقي في الحالتين.
//
// ⚠️ حدّ معلَن: **المحاكي لا يفرض الفهارس المركّبة**، فهذا الاختبار لا يثبت وحده أن الاستعلامين لا يحتاجان فهرساً مركّباً؛ يثبته بنيوياً ownerActivityWindow.test.js (كل مرشّح مساواة على userId/ownerId وحده، بلا orderBy ولا نطاق،
// ومراقب الاستعلامات يقرأ ما يُستدعى فعلاً). والمثبَت هنا على الطبقة الحقيقية: أن select وlimit وcount والمساواة تعمل بالشكل الذي تستعمله المكتبة، وأن قناع الحقول لا يُسرّب ما خارجه، وأن لا شيء يُكتب.
//
// Run (محاكي Firestore وAuth — كل الحالات بالأمر الحقيقي):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --config functions/test/firebase.firestore-auth.emulators.json --only firestore,auth --project demo-nc "node functions/test/ownerActivityWindowReadonly.e2e.test.js"
// Run (قياسي: Firestore وحده، Auth مزيَّف):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc "node functions/test/ownerActivityWindowReadonly.e2e.test.js"

require('./lib/emulatorOnlyGuard'); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // مضمون محلّي بالحارس أعلاه
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const LOCAL = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
if (AUTH_HOST && !LOCAL.test(AUTH_HOST)) {
  console.error('REFUSING TO RUN: FIREBASE_AUTH_EMULATOR_HOST ليس مضيفاً محلّياً.');
  process.exit(2);
}
const REAL_FETCH = global.fetch; // لتفريغ المحاكي وحده (عنوانه محلّي)

const admin = require('firebase-admin');
const {Timestamp} = require('firebase-admin/firestore');
const C = require('../scripts/lib/deviceCheck03Common');
const W = require('../scripts/lib/ownerActivityWindow');
const {main: mainFn} = require('../scripts/owner-activity-window-readonly');
const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../src/analysis/evaluationRulesVersion');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const H = require('./lib/deviceCheck03Harness');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const app = admin.initializeApp({projectId: C.PROJECT_ID}, 'owner-activity-window-e2e');
const db = app.firestore();
const authApp = AUTH_HOST ? app.auth() : null;

const HOUR = 60 * 60 * 1000;
const SCRIPT = path.join(__dirname, '..', 'scripts', 'owner-activity-window-readonly.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-activity-e2e-'));
let counter = 0;
const nextOut = () => path.join(tmp, `oa-${++counter}.json`);

const EMAIL = 'e2e.owner.shop.SECRET@example.test';
const OWNER = 'e2e-uid-OWNER-SECRET-0001';
const OTHER = 'e2e-uid-OTHER-SECRET-0002';
const JOINER = 'e2e-uid-JOINER-SECRET-0003';
const SESS = {A: 'e2e-sess-A-SECRET-0001', B: 'e2e-sess-B-SECRET-0002', C: 'e2e-sess-C-SECRET-0003', OLD: 'e2e-sess-OLD-SECRET-0004', OTHERS: 'e2e-sess-OTHERS-SECRET-0005'};
const SCAN = {X: 'e2e-scan-X-SECRET-0001', P: 'e2e-scan-P-SECRET-0002', L: 'e2e-scan-L-SECRET-0003', N: 'e2e-scan-N-SECRET-0004', OLD: 'e2e-scan-OLD-SECRET-0005', OTHERS: 'e2e-scan-OTHERS-SECRET-0006'};
const CODE = {A: 'NC-E2ECA2', B: 'NC-E2ECB3', C: 'NC-E2ECC4'};
const SHORT = {X: 'NC-XXXX22', P: 'NC-PPPP33', L: 'NC-LLLL44', N: 'NC-NNNN55'};
const SECRET_STRINGS = [EMAIL, 'e2e.owner.shop', OWNER, OTHER, JOINER, ...Object.values(SESS), ...Object.values(SCAN), ...Object.values(CODE), 'SECRET-FCM', 'SECRET raw', 'SM-SECRET-MODEL', 'sk-SECRETKEY'];
const NOW = Date.now();
// النافذة: [الآن − 3 ساعات، الآن − 1 ساعة)؛ كل التواريخ نسبية، تُحوَّل إلى ISO بـ+03 للوسيط
const T = (minutesAgo) => NOW - minutesAgo * 60 * 1000;
const isoPlus03 = (ms) => `${new Date(ms + 3 * HOUR).toISOString().slice(0, 19)}+03:00`;
const SINCE = Math.floor((NOW - 3 * HOUR) / 1000) * 1000;
const UNTIL = Math.floor((NOW - 1 * HOUR) / 1000) * 1000;
const WINDOW = ['--since', isoPlus03(SINCE), '--until', isoPlus03(UNTIL)];
const ts = (ms) => Timestamp.fromMillis(ms);

async function reset() {
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${C.PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}
function ser(v) {
  if (v instanceof Timestamp) return {__ts: `${v.seconds}.${v.nanoseconds}`};
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ser(v[k])]));
  return v;
}
async function dumpAll() {
  const out = {};
  for (const col of await db.listCollections()) {
    const snap = await col.get();
    for (const d of snap.docs) out[`${col.id}/${d.id}`] = {data: ser(d.data()), updateTime: `${d.updateTime.seconds}.${d.updateTime.nanoseconds}`, createTime: `${d.createTime.seconds}.${d.createTime.nanoseconds}`};
  }
  return out;
}

async function seed() {
  await reset();
  await db.collection('users').doc(OWNER).set({scansRemaining: 41, plan: 'shop_pro', email: EMAIL, fcmToken: 'SECRET-FCM', expiresAt: ts(NOW + 20 * HOUR), isActive: true});
  const sess = (id, data) => db.collection('scanSessions').doc(id).set(data);
  // الواقعة: A جارية (انضمّ إليها الجهاز)، B اكتملت بفحص X، C جارية لمنضمّ آخر؛ وجلسة قديمة خارج النافذة؛ وجلسة مالك آخر
  await sess(SESS.A, {ownerId: OWNER, code: CODE.A, status: 'scanning', createdAt: ts(T(170)), expiresAt: ts(T(110)), joinedBy: JOINER, joinedAt: ts(T(168)), scanId: null, deviceModel: 'SM-SECRET-MODEL'});
  await sess(SESS.B, {ownerId: OWNER, code: CODE.B, status: 'completed', createdAt: ts(T(150)), expiresAt: ts(T(90)), joinedBy: JOINER, joinedAt: ts(T(147)), scanId: SCAN.X, completedAt: ts(T(145)), shortId: SHORT.X, deviceModel: 'SM-SECRET-MODEL'});
  await sess(SESS.C, {ownerId: OWNER, code: CODE.C, status: 'scanning', createdAt: ts(T(130)), expiresAt: ts(T(70)), joinedBy: null, joinedAt: ts(T(128)), scanId: null});
  await sess(SESS.OLD, {ownerId: OWNER, status: 'expired', createdAt: ts(T(600)), expiresAt: ts(T(540)), expiredAt: ts(T(500)), scanId: null});
  await sess(SESS.OTHERS, {ownerId: OTHER, status: 'scanning', createdAt: ts(T(140)), expiresAt: ts(T(80))});
  const rep = (id, data) => db.collection('reports').doc(id).set(data);
  await rep(SCAN.X, {userId: OWNER, createdAt: ts(T(145)), shortId: SHORT.X, pipeline: CACHED_PIPELINE_TAG, fieldsVersion: 70, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, appVersion: '1.0.12', aiModel: 'cached_signature_match', aiDurationMs: 812, aiFallbackReason: null, isFreeTrial: false, aiResponse: {narrative: {summary: 'SECRET raw text'}}});
  await rep(SCAN.P, {userId: OWNER, createdAt: ts(T(125)), shortId: SHORT.P, pipeline: V7_PIPELINE_TAG, fieldsVersion: 70, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, appVersion: '1.0.12', aiModel: 'deepseek-chat', aiDurationMs: 41234, aiFallbackReason: 'deepseek 401 sk-SECRETKEY-WXYZ', isFreeTrial: false});
  await rep(SCAN.L, {userId: OWNER, createdAt: ts(T(160)), shortId: SHORT.L, pipeline: V6_PIPELINE_TAG, sessionId: SESS.A, rawFingerprint: {big: 'SECRET raw'}});
  await rep(SCAN.N, {userId: OWNER, createdAt: ts(T(100)), shortId: SHORT.N});
  await rep(SCAN.OLD, {userId: OWNER, createdAt: ts(T(700)), shortId: 'NC-OOOO66', pipeline: V7_PIPELINE_TAG});
  await rep(SCAN.OTHERS, {userId: OTHER, createdAt: ts(T(140)), shortId: 'NC-ZZZZ77', pipeline: V7_PIPELINE_TAG});
  await db.collection('reportRaw').doc(SCAN.X).set({scanId: SCAN.X, sessionId: SESS.B, rawFingerprint: {big: 'SECRET raw'}, source: 'analyzeDevice', createdAt: ts(T(145))});
  await db.collection('reportRaw').doc(SCAN.P).set({scanId: SCAN.P, sessionId: null, rawFingerprint: {big: 'SECRET raw'}, source: 'analyzeDevice', createdAt: ts(T(125))});
  await db.collection('settings').doc('keepme').set({untouchable: true});
}

const realAuth = AUTH_HOST ? Object.freeze({getUserByEmail: (email) => authApp.getUserByEmail(email)}) : null;
const fakeAuth = {getUserByEmail: async (email) => {
  if (String(email).toLowerCase() !== EMAIL.toLowerCase()) throw Object.assign(new Error(`There is no user record corresponding to the provided identifier: ${email}`), {code: 'auth/user-not-found'});
  return {uid: OWNER};
}};
const childEnv = (() => {
  const env = {...process.env, FIRESTORE_EMULATOR_HOST: HOST, [C.OWNER_EMAIL_ENV]: EMAIL};
  if (AUTH_HOST) env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  delete env.GOOGLE_APPLICATION_CREDENTIALS; // لا اعتماد إنتاج في العملية الفرعية حتى لو سقط المضيف المحلّي سهواً
  return env;
})();
const runLog = [];
/** يشغّل السكربت بالأمر الحقيقي في عملية فرعية (مع محاكي Auth)، أو في العملية بـAuth مزيَّف. caps تُحقَن في العملية وحدها. */
async function runScript(argv, {caps = null} = {}) {
  if (AUTH_HOST && caps === null) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 120000});
    runLog.push({mode: 'subprocess', code: r.status});
    ok(/target=EMULATOR /.test(r.stderr || '') || (r.status === 2 && !/target=/.test(r.stderr || '')), 'السكربت الفرعي يعلن target=EMULATOR (أو رُفض قبل أيّ اتصال)');
    return {code: r.status, stdout: r.stdout || '', stderr: r.stderr || ''};
  }
  const outs = [];
  const errs = [];
  const env = {...process.env, [C.OWNER_EMAIL_ENV]: EMAIL};
  const code = await mainFn(argv, {env, db, auth: AUTH_HOST ? realAuth : fakeAuth, caps: caps || undefined, out: (s) => outs.push(s), err: (s) => errs.push(s)});
  runLog.push({mode: 'in-process', code});
  return {code, stdout: outs.join('\n'), stderr: errs.join('\n')};
}
const leaksIn = (...texts) => SECRET_STRINGS.filter((s) => texts.some((t) => typeof t === 'string' && t.includes(s)));

(async () => {
  const netGuard = H.blockNonLocalNetwork(); // صفر اتصال بغير المضيف المحلّي في العملية طوال الاختبار
  try {
    let authMode = 'FAKE';
    if (AUTH_HOST) {
      authMode = 'REAL-EMULATOR';
      await authApp.createUser({uid: OWNER, email: EMAIL});
    } else {
      console.log('AUTH-EMULATOR CASES: FAKE — FIREBASE_AUTH_EMULATOR_HOST غير مضبوط: getUserByEmail مزيَّف داخل العملية (مُعلَن في الرأس)؛ شغّل بملفّ إعداد Auth ليجري السكربت الحقيقي في عملية فرعية.');
    }

    // ═══ ١ — الفحص الذاتي بالأمر الحقيقي (بلا شبكة) ═══
    {
      const r = spawnSync(process.execPath, [SCRIPT, '--preflight'], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      eq(r.status, 0, '[١] --preflight بالأمر الحقيقي: 0');
      const j = JSON.parse(r.stdout);
      deq([j.projectId, j.mode, j.network, j.readOnly, j.ok], [C.PROJECT_ID, 'preflight', false, true, true], '[١] preflight: projectId المثبَّت، بلا شبكة، قراءة فقط، كل الفحوص تمرّ');
      const badWin = spawnSync(process.execPath, [SCRIPT, '--since', '2026-10-14T00:00:00+03:00', '--until', '2026-10-16T00:00:00+03:00'], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(badWin.status === 2 && /النافذة تتجاوز 24 ساعة/.test(badWin.stderr) && !/target=/.test(badWin.stderr), '[١] نافذة فوق 24 ساعة بالأمر الحقيقي: 2 قبل أيّ اتصال');
      const cliEmail = spawnSync(process.execPath, [SCRIPT, ...WINDOW, `--email=${EMAIL}`], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(cliEmail.status === 2 && /وسيط مجهول/.test(cliEmail.stderr) && leaksIn(cliEmail.stdout, cliEmail.stderr).length === 0, '[١] البريد من سطر الأمر مرفوض ولا يُنسخ إلى المخرَج');
    }

    // ═══ ٢ — الواقعة على المحاكي: كل ما يُقرأ، وكل ما لا يُطبَع ═══
    await seed();
    const before = await dumpAll();
    {
      const outPath = nextOut();
      const r = await runScript([...WINDOW, '--out', outPath]);
      eq(r.code, 0, '[٢] النجاح: 0');
      const j = JSON.parse(r.stdout);
      eq(Object.keys(j)[0], 'projectId', '[٢] projectId أوّل حقل');
      eq(j.projectId, C.PROJECT_ID, '[٢] projectId المثبَّت');
      ok(/^EMULATOR /.test(j.target), '[٢] الهدف المطبوع: المحاكي');
      eq(j.account.accountHash, C.hashIdForLog(OWNER), '[٢] المعرّف مُهشَّر');
      eq(j.account.scansRemaining.value, 41, '[٢] الرصيد الآن (Firestore حقيقي)');
      eq(j.account.reportsTotal, 5, '[٢] عدد تقارير المالك (count() حقيقي): X وP وL وN وOLD، ليس تقرير الآخر');
      eq(j.account.sessionsTotal, 4, '[٢] عدد جلسات المالك (count() حقيقي): A وB وC وOLD، ليس جلسة الآخر');
      deq(j.reports.items.map((i) => i.scanIdHash), [SCAN.L, SCAN.X, SCAN.P, SCAN.N].map(C.hashIdForLog), '[٢] تقارير النافذة بالترتيب الزمني: L (160) · X (145) · P (125) · N (100)');
      eq(j.reports.outsideWindow, 1, '[٢] OLD خارج النافذة');
      deq(j.sessions.items.map((i) => i.sessionHash), [SESS.A, SESS.B, SESS.C].map(C.hashIdForLog), '[٢] جلسات النافذة بالترتيب: A (170) · B (150) · C (130)');
      eq(j.sessions.outsideWindow, 1, '[٢] OLD خارج النافذة');
      const rx = j.reports.items.find((i) => i.scanIdHash === C.hashIdForLog(SCAN.X));
      deq([rx.kind, rx.shortId.value, rx.sessionLink.state, rx.sessionLink.sessionIdHash, rx.seal.fieldsVersion.value, rx.seal[EVALUATION_RULES_VERSION_FIELD].value, rx.ai.aiDurationMs.value],
          ['CACHED', SHORT.X, 'SESSION', C.hashIdForLog(SESS.B), 70, EVALUATION_RULES_VERSION, 812], '[٢] X: مخبَّأ، وshortId، ومربوط بـB من reportRaw الحقيقي، والختم، والمدّة');
      const rl = j.reports.items.find((i) => i.scanIdHash === C.hashIdForLog(SCAN.L));
      deq([rl.kind, rl.sessionLink.state, rl.sessionLink.source, rl.sessionLink.sessionIdHash], ['V6', 'SESSION', 'reports.sessionId (legacy embedded)', C.hashIdForLog(SESS.A)], '[٢] L: ربط قديم مضمَّن في مستند التقرير (قُرئ بالقناع)');
      const rp = j.reports.items.find((i) => i.scanIdHash === C.hashIdForLog(SCAN.P));
      deq([rp.sessionLink.state, rp.ai.aiFallbackReason.valuePrinted, rp.ai.aiFallbackReason.present], ['NOT_A_SESSION_SCAN', false, true], '[٢] P: فحص شخصي، وaiFallbackReason حضور وطول لا نصّ');
      const rn = j.reports.items.find((i) => i.scanIdHash === C.hashIdForLog(SCAN.N));
      deq([rn.sessionLink.state, rn.kind, rn.seal.fieldsVersion.present], ['NO_RAW_DOC_AND_NO_LEGACY_FIELD', 'ABSENT', false], '[٢] N: بلا reportRaw ولا حقل قديم ⟵ الربط غير معروف، والنوع غائب، والختم غائب');
      const sa = j.sessions.items.find((i) => i.sessionHash === C.hashIdForLog(SESS.A));
      deq([sa.status.value, sa.scanLink.state, sa.joiner.state, sa.activeButPastExpiry], ['scanning', 'SCAN_ID_NULL', 'PRESENT', true], '[٢] A: scanning، scanId=null، منضمّها معروف، وانقضى وقتها ولم تُكتب «منتهية» (جلسة يتيمة: لا دالّة مسّتها بعد expiresAt)');
      const sb = j.sessions.items.find((i) => i.sessionHash === C.hashIdForLog(SESS.B));
      deq([sb.status.value, sb.scanLink.scanIdHash, sb.joiner.hash], ['completed', C.hashIdForLog(SCAN.X), C.hashIdForLog(JOINER)], '[٢] B: completed وscanId الخادم والمنضمّ');
      const sc = j.sessions.items.find((i) => i.sessionHash === C.hashIdForLog(SESS.C));
      deq([sc.joiner.state, sc.activeButPastExpiry], ['NULL', true], '[٢] C: انضمّت بلا هوية (joinedBy=null) وجارية منقضية الوقت');
      const lx = j.links.find((l) => l.scanIdHash === C.hashIdForLog(SCAN.X));
      deq([lx.multipleSessions, lx.distinctSessions], [false, 1], '[٢] X: جلسة واحدة');
      eq(j.completeness.complete, true, '[٢] النافذة كاملة');
      // ما لا يُطبَع: القناع الحقيقي على المحاكي
      ok(leaksIn(r.stdout, r.stderr).length === 0, `[٢][الأهمّ] لا بريد ولا uid ولا scanId ولا sessionId ولا رمز جلسة ولا خامّ ولا موديل جهاز ولا نصّ مزوّد في stdout ولا stderr — ${leaksIn(r.stdout, r.stderr).join(' | ')}`);
      ok(!/"(?:code|ownerId|deviceModel|rawFingerprint|aiResponse|fcmToken)"\s*:/.test(r.stdout), '[٢] ولا مفتاح JSON خارج القائمتين البيضاوين');
      const bytes = fs.readFileSync(outPath);
      ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٢] الملفّ UTF-8 بلا BOM');
      eq(bytes.toString('utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٢] الملفّ = المطبوع');
      const again = await runScript([...WINDOW, '--out', outPath]);
      ok(again.code === 2 && /OUT_EXISTS/.test(again.stderr), '[٢] ملفّ موجود: لا استبدال (2، OUT_EXISTS)');
      eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٢] والملفّ القائم لم يُمسّ');
    }
    deq(await dumpAll(), before, '[٢][الأهمّ] لا كتابة: كل المستندات في كل المجموعات (بياناتها وupdateTime وcreateTime) كما كانت بعد التشغيلين');

    // ═══ ٣ — حدود النافذة على Timestamp حقيقي ═══
    {
      const edge = (ms) => isoPlus03(ms);
      await db.collection('reports').doc('e2e-edge-since').set({userId: OWNER, createdAt: ts(SINCE), shortId: 'NC-EDGE22', pipeline: V7_PIPELINE_TAG});
      await db.collection('reports').doc('e2e-edge-until').set({userId: OWNER, createdAt: ts(UNTIL), shortId: 'NC-EDGE33', pipeline: V7_PIPELINE_TAG});
      const r = await runScript(['--since', edge(SINCE), '--until', edge(UNTIL)]);
      const j = JSON.parse(r.stdout);
      ok(j.reports.items.some((i) => i.scanIdHash === C.hashIdForLog('e2e-edge-since')), '[٣] createdAt = since مشمول');
      ok(!j.reports.items.some((i) => i.scanIdHash === C.hashIdForLog('e2e-edge-until')), '[٣] createdAt = until مستثنى');
    }

    // ═══ ٤ — السقوف على الاستعلام الحقيقي (في العملية: caps تُحقَن) ═══
    {
      const r = await runScript(WINDOW, {caps: {reports: 2, sessions: 100, rawReads: 100}});
      eq(r.code, 3, '[٤] بلوغ سقف التقارير على limit(cap+1) الحقيقي: 3');
      const j = JSON.parse(r.stdout);
      deq([j.completeness.complete, j.completeness.reports.capReached, j.completeness.reports.docsRead], [false, true, 2], '[٤] completeness: ناقص، والسقف مُعلَن');
      const ex = await runScript(WINDOW, {caps: {reports: 7, sessions: 4, rawReads: 100}});
      eq(ex.code, 0, '[٤] العدد = السقف بالضبط (7 تقارير وهي 7 الآن، 4 جلسات): ليس بلوغاً');
    }

    // ═══ ٥ — أخطاء بلا تسريب ═══
    {
      const env2 = {...childEnv, [C.OWNER_EMAIL_ENV]: 'not.registered.SECRET@example.test'};
      if (AUTH_HOST) {
        const r = spawnSync(process.execPath, [SCRIPT, ...WINDOW], {env: env2, encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 120000});
        ok(r.status === 2 && /OWNER_ACCOUNT_NOT_FOUND/.test(r.stderr), '[٥] حساب غير موجود في Auth الحقيقي: 2 OWNER_ACCOUNT_NOT_FOUND');
        ok(!`${r.stdout}${r.stderr}`.includes('not.registered'), '[٥] نصّ خطأ المزوّد (يحمل البريد) لا يُطبَع (القاعدة 36)');
      }
      const noEnv = spawnSync(process.execPath, [SCRIPT, ...WINDOW], {env: {...childEnv, [C.OWNER_EMAIL_ENV]: ''}, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(noEnv.status === 2 && /OWNER_EMAIL_ENV_MISSING/.test(noEnv.stderr), '[٥] بلا متغيّر البيئة بالأمر الحقيقي: 2');
    }
    ok(netGuard.blocked.length === 0, `[٦] صفر اتصال بغير المضيف المحلّي: ${netGuard.blocked.join(',')}`);
    console.log(`AUTH-EMULATOR CASES: ${authMode}; runs: ${runLog.map((x) => `${x.mode}:${x.code}`).join(' ')}`);
  } finally {
    netGuard.restore();
  }
  console.log(`ownerActivityWindowReadonly.e2e.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
