// E2E test: set-account-subscription.js على محاكي Firestore وAuth (ضبط انتهاء حسابات الشريك، 2026-10-14 +03، القاعدتان 37 و41).
//
// أمر المنسّق (بنصّه المنقول): «وe2e على المحاكي (`*.e2e.test.js`، Firestore وAuth). القاعدة 37: لا يستبدل الطبقة التي قد ترفض. يشغّل السكربت الحقيقي: الجافّ لا يغيّر أيّ مستند؛ والكتابة تمسّ الحقول المسمّاة وحدها
// (والباقي بايتاً بايتاً كما هو)؛ والرمز البائت يُرفض بعد تعديل حساب بين الوضعين.»
//
// ─── ما يجري على الطبقات الحقيقية ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Firestore (محاكي) والمعاملة الحقيقية (runTransaction، getAll، update) والـTimestamp الحقيقي. Auth: **حقيقي** (محاكي Auth: createUser ثم getUserByEmail في السكربت) حين يوجد FIREBASE_AUTH_EMULATOR_HOST، والسكربت يُشغَّل
//   **بالأمر الذي يشغّله المستخدم** في عملية فرعية (node functions/scripts/set-account-subscription.js ...).
// ─── ما يُستبدَل (القاعدة 37، مُعلَن) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   بلا محاكي Auth (أمر --only firestore القياسي): getUserByEmail مزيَّف داخل العملية نفسها (main(argv, {db, auth}))؛ وتُطبَع «AUTH-EMULATOR CASES: FAKE» صراحةً. كل ما سوى Auth حقيقي في الحالتين (المعاملة والمستندات والغلاف والرمز).
//   لا شبكة نحو أيّ مزوّد: blockNonLocalNetwork في العملية، وفي الفرعية المضيفان المحليان من البيئة، وتُتحقَّق «target=EMULATOR» من stderr السكربت.
//
// Run (محاكي Firestore وAuth — كل الحالات بالأمر الحقيقي):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --config functions/test/firebase.firestore-auth.emulators.json --only firestore,auth --project demo-nc "node functions/test/setAccountSubscription.e2e.test.js"
// Run (قياسي: Firestore وحده، Auth مزيَّف):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc "node functions/test/setAccountSubscription.e2e.test.js"

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
const {Timestamp, FieldValue} = require('firebase-admin/firestore');
const C = require('../scripts/lib/deviceCheck03Common');
const L = require('../scripts/lib/setAccountSubscription');
const {main: mainFn} = require('../scripts/set-account-subscription');
const H = require('./lib/deviceCheck03Harness');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// تطبيقان مسمّيان بالمشروع المثبَّت نفسه الذي يفتحه السكربت (مضيف المحاكي محلّي بالحارس فكل مستنداته في المحاكي)
const app = admin.initializeApp({projectId: C.PROJECT_ID}, 'set-acct-sub-e2e');
const db = app.firestore();
const authApp = AUTH_HOST ? app.auth() : null; // لا عميل Auth إلا مع المحاكي

const HR = 60 * 60 * 1000;
const DAY = 24 * HR;
const SCRIPT = path.join(__dirname, '..', 'scripts', 'set-account-subscription.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'set-acct-sub-e2e-'));
let counter = 0;
const nextPath = (ext = 'json') => path.join(tmp, `f-${++counter}.${ext}`);
const writeAccounts = (text) => { const p = nextPath('csv'); fs.writeFileSync(p, text); return p; };

const EMAIL = {A: 'e2e.gharir.a.SECRET@example.test', B: 'e2e.gharir.b.SECRET@example.test', C: 'e2e.gharir.c.SECRET@example.test', D: 'e2e.gharir.d.SECRET@example.test', X: 'e2e.bystander.x.SECRET@example.test', Z: 'e2e.nodoc.z.SECRET@example.test'};
const UID = {A: 'e2e-uid-A-SECRET-0001', B: 'e2e-uid-B-SECRET-0002', C: 'e2e-uid-C-SECRET-0003', D: 'e2e-uid-D-SECRET-0004', X: 'e2e-uid-X-SECRET-0005', Y: 'e2e-uid-Y-SECRET-0006', Z: 'e2e-uid-Z-SECRET-0007'};
const SECRET_VALUES = ['SECRET-FCM', 'SECRET-NAME', 'SECRET-PHONE', 'secret-shop-slug', 'SECRET'];

/** تاريخ اليوم بـ+03 مُزاحاً بأيّام، بصيغة YYYY-MM-DD. */
const plus03Date = (offsetDays) => new Date(Date.now() + 3 * HR + offsetDays * DAY).toISOString().slice(0, 10);
/** نهاية اليوم بـ+03 (23:59:59.999)، محسوبة هنا مستقلّةً عن المكتبة. */
const eodMs = (dateStr) => { const [y, m, d] = dateStr.split('-').map(Number); return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 3 * HR; };
const D1 = plus03Date(10);
const D2 = plus03Date(20);
const D3 = plus03Date(5);

async function reset() {
  const res = await REAL_FETCH(`http://${HOST}/emulator/v1/projects/${C.PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}

/** تمثيل قانوني لقيمة Firestore (Timestamp بثوانيه ونانوثانيه، مفاتيح مرتَّبة). */
function ser(v) {
  if (v instanceof Timestamp) return {__ts: `${v.seconds}.${v.nanoseconds}`};
  if (Array.isArray(v)) return v.map(ser);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ser(v[k])]));
  return v;
}
/** كل المجموعات كلّها: لكل مستند بياناته وupdateTime وcreateTime. */
async function dumpAll() {
  const out = {};
  for (const col of await db.listCollections()) {
    const snap = await col.get();
    for (const d of snap.docs) out[`${col.id}/${d.id}`] = {data: ser(d.data()), updateTime: `${d.updateTime.seconds}.${d.updateTime.nanoseconds}`, createTime: `${d.createTime.seconds}.${d.createTime.nanoseconds}`};
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const withoutKeys = (data, keys) => Object.fromEntries(Object.entries(data).filter(([k]) => !keys.includes(k)));

function seedDocs() {
  const now = Date.now();
  return {
    [UID.A]: {
      plan: 'shop_pro', scansRemaining: 12, scansTotal: 100, isActive: true, expiresAt: Timestamp.fromMillis(now - 2 * HR),
      subExpiredNotified: true, subExpiredAt: Timestamp.fromMillis(now - 90 * 60 * 1000), subExpiryEmailSent: true, subExpiryFcmDate: '2026-10-13',
      email: EMAIL.A, fcmToken: 'SECRET-FCM-TOKEN-A', name: 'SECRET-NAME-A', phone: 'SECRET-PHONE-A', shopSlug: 'secret-shop-slug', language: 'ar',
      freeTrialUsedDevices: ['m1_14_8', 'm2_13_6'], nested: {a: {b: [1, 2, {c: null}]}, t: Timestamp.fromMillis(now - DAY), flag: false}, createdAt: Timestamp.fromMillis(now - 90 * DAY),
    },
    [UID.B]: {plan: 'shop_basic', scansRemaining: 0, scansTotal: 50, isActive: false, expiresAt: new Date(now - 4 * DAY).toISOString(), email: EMAIL.B, name: 'SECRET-NAME-B', zero: 0, empty: '', nothing: null},
    [UID.C]: {plan: 'free', scansRemaining: 3, scansTotal: 3, isActive: true, expiresAt: Timestamp.fromMillis(now + 60 * DAY), fcmToken: 'SECRET-FCM-TOKEN-C', phone: 'SECRET-PHONE-C'},
    [UID.D]: {plan: 'shop_pro', isActive: true, expiresAt: Timestamp.fromMillis(now + 2 * DAY)}, // الرصيد والإجمالي غائبان
    [UID.X]: {plan: 'shop_pro', scansRemaining: 40, scansTotal: 40, isActive: true, expiresAt: Timestamp.fromMillis(now + 3 * DAY), email: EMAIL.X, name: 'SECRET-NAME-X'}, // مارّ: لا يُسمَّى في أيّ ملفّ
    [UID.Y]: {plan: 'free', scansRemaining: 1, scansTotal: 1, isActive: true, phone: 'SECRET-PHONE-Y'}, // مارّ بلا Auth
  };
}
async function seed() {
  await reset();
  for (const [uid, data] of Object.entries(seedDocs())) await db.collection('users').doc(uid).set(data);
  await db.collection('settings').doc('keepme').set({untouchable: true, t: Timestamp.fromMillis(Date.now())}); // مجموعة أخرى: لا تُمسّ
}

// Auth: حقيقي إن وُجد المحاكي، وإلا مزيَّف داخل العملية
const realAuth = AUTH_HOST ? Object.freeze({getUserByEmail: (email) => authApp.getUserByEmail(email)}) : null; // العملية الواحدة العارضة نفسها التي يمرّرها السكربت الحقيقي
const fakeAuth = {getUserByEmail: async (email) => {
  const hit = Object.entries(EMAIL).find(([, e]) => e.toLowerCase() === String(email).toLowerCase());
  if (!hit || hit[0] === 'Y') throw Object.assign(new Error(`There is no user record corresponding to the provided identifier: ${email}`), {code: 'auth/user-not-found'});
  return {uid: UID[hit[0]]};
}};
const childEnv = (() => {
  const env = {...process.env, FIRESTORE_EMULATOR_HOST: HOST};
  if (AUTH_HOST) env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  delete env.GOOGLE_APPLICATION_CREDENTIALS; // لا اعتماد إنتاج في العملية الفرعية حتى لو سقط المضيف المحلّي سهواً
  return env;
})();
const runLog = [];
/** يشغّل السكربت: بالأمر الحقيقي في عملية فرعية (مع محاكي Auth)، أو في العملية بـAuth مزيَّف. */
async function runScript(argv, {inProcessOnly = false} = {}) {
  if (AUTH_HOST && !inProcessOnly) {
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 120000});
    runLog.push({mode: 'subprocess', code: r.status});
    ok(/target=EMULATOR /.test(r.stderr || '') || r.status === 2 && !/target=/.test(r.stderr || ''), 'السكربت الفرعي يعلن target=EMULATOR (أو رُفض قبل أيّ اتصال)');
    return {code: r.status, stdout: r.stdout || '', stderr: r.stderr || ''};
  }
  const outs = [];
  const errs = [];
  const code = await mainFn(argv, {env: process.env, db, auth: AUTH_HOST ? realAuth : fakeAuth, out: (s) => outs.push(s), err: (s) => errs.push(s)});
  runLog.push({mode: 'in-process', code});
  return {code, stdout: outs.join('\n'), stderr: errs.join('\n')};
}
const leaksIn = (...texts) => [...Object.values(EMAIL), ...Object.values(UID), ...Object.values(EMAIL).map((e) => e.split('@')[0]), ...SECRET_VALUES].filter((s) => texts.some((t) => typeof t === 'string' && t.includes(s)));

const FILE_THREE = `# e2e gharir accounts\n${EMAIL.A},${D1},add:5\n${EMAIL.B},${D2},set:30\n${EMAIL.C},${D3}\n`;

(async () => {
  const netGuard = H.blockNonLocalNetwork(); // صفر اتصال بغير المضيف المحلّي في العملية طوال الاختبار
  try {
    // ═══ ٠ — تهيئة Auth ═══
    let authMode = 'FAKE';
    if (AUTH_HOST) {
      authMode = 'REAL-EMULATOR';
      for (const k of ['A', 'B', 'C', 'D', 'X', 'Z']) await authApp.createUser({uid: UID[k], email: EMAIL[k]});
    } else {
      console.log('AUTH-EMULATOR CASES: FAKE — FIREBASE_AUTH_EMULATOR_HOST غير مضبوط: getUserByEmail مزيَّف داخل العملية (مُعلَن في الرأس)؛ شغّل بملفّ إعداد Auth ليجري السكربت الحقيقي في عملية فرعية.');
    }

    // ═══ ١ — الفحص الذاتي بالأمر الحقيقي (بلا شبكة) ═══
    {
      const r = spawnSync(process.execPath, [SCRIPT, '--preflight'], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      eq(r.status, 0, '[١] --preflight بالأمر الحقيقي: 0');
      const j = JSON.parse(r.stdout);
      deq([j.projectId, j.mode, j.network, j.writesOnlyWithCommit, j.ok], [C.PROJECT_ID, 'preflight', false, true, true], '[١] preflight: projectId المثبَّت، بلا شبكة، كل الفحوص تمرّ');
      const noMode = spawnSync(process.execPath, [SCRIPT, '--accounts', 'x.csv'], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(noMode.status === 2 && /MODE_NOT_EXPLICIT/.test(noMode.stderr), '[١] بلا وضع صريح بالأمر الحقيقي: 2 MODE_NOT_EXPLICIT');
      const noToken = spawnSync(process.execPath, [SCRIPT, '--commit', '--accounts', 'x.csv'], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(noToken.status === 2 && /TOKEN_REQUIRED/.test(noToken.stderr), '[١] --commit بلا --token بالأمر الحقيقي: 2 TOKEN_REQUIRED');
      const cliEmail = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--accounts', 'x.csv', `--email=${EMAIL.A}`], {env: childEnv, encoding: 'utf8', cwd: path.join(__dirname, '..')});
      ok(cliEmail.status === 2 && /USAGE_UNKNOWN_ARGUMENT/.test(cliEmail.stderr) && leaksIn(cliEmail.stdout, cliEmail.stderr).length === 0, '[١] البريد من سطر الأمر مرفوض ولا يُنسخ إلى المخرَج');
    }

    // ═══ ٢ — الجافّ لا يغيّر أيّ مستند ═══
    await seed();
    const file3 = writeAccounts(FILE_THREE);
    let token;
    {
      const before = await dumpAll();
      const spy = H.spyFsWrites();
      const outPath = nextPath();
      let r;
      try { r = await runScript(['--dry-run', '--accounts', file3, '--out', outPath], {inProcessOnly: true}); } finally { spy.restore(); }
      deq(spy.writes.map((w) => path.resolve(w.path)), [path.resolve(outPath)], '[٢] (في العملية) القرص: الكتابة الوحيدة هي ملفّ --out');
      eq(r.code, 0, '[٢] الجافّ: 0');
      deq(await dumpAll(), before, '[٢][الأهمّ] الجافّ: كل المستندات في كل المجموعات كما هي — البيانات وupdateTime وcreateTime');
      const j = JSON.parse(r.stdout);
      token = j.token;
      deq([j.projectId, j.mode, j.run, j.nothingWritten, Object.keys(j)[0]], [C.PROJECT_ID, 'set-account-subscription', 'dry-run', true, 'projectId'], '[٢] الرأس');
      ok(/^[0-9a-f]{64}$/.test(token) && r.stderr.includes(`token=${token}`), '[٢] الرمز: 64 خانة سداسية، وعلى stderr أيضاً');
      ok(/target=EMULATOR /.test(r.stderr), '[٢] stderr يعلن target=EMULATOR');
      deq(j.accounts.map((a) => a.account), [C.hashIdForLog(UID.A), C.hashIdForLog(UID.B), C.hashIdForLog(UID.C)], '[٢] الحسابات مُهشَّرة بـhashIdForLog(uid)');
      const [a, b, c] = j.accounts;
      deq(a.afterPlanned.expiresAt, {present: true, type: 'timestamp', plus03: `${D1}T23:59:59.999+03:00`, epochMs: eodMs(D1)}, '[٢] A «بعد» المخطَّط: Timestamp بنهاية اليوم +03 مطبوعاً بقيمته المطلقة');
      deq([a.before.scansRemaining.value, a.afterPlanned.scansRemaining.value, a.before.scansTotal.value, a.afterPlanned.scansTotal.value], [12, 17, 100, 105], '[٢] A: add:5 ⟵ الرصيد 17 والإجمالي 105');
      deq([b.before.expiresAt.type, b.afterPlanned.expiresAt.type, b.afterPlanned.scansRemaining.value, b.afterPlanned.scansTotal.value], ['string', 'timestamp', 30, 50], '[٢] B: expiresAt كان نصّاً (string) وسيصير timestamp؛ set:30 والإجمالي لا يتغيّر');
      deq(c.writes, ['expiresAt'], '[٢] C: expiresAt وحده');
      deq(a.warnings.map((w) => w.code), ['FLAG_SET', 'FLAG_SET', 'FLAG_SET', 'FLAG_SET'], '[٢] A: أربعة أعلام مضبوطة (تحذير بلا مسّ)');
      deq(b.warnings.map((w) => w.code), ['IS_ACTIVE_FALSE', 'EXPIRES_AT_NOT_A_TIMESTAMP'], '[٢] B: isActive=false وexpiresAt ليس Timestamp');
      deq(c.warnings.map((w) => w.code), ['PLAN_NOT_SHOP', 'NEW_EXPIRY_EARLIER_THAN_CURRENT'], '[٢] C: plan=free والتاريخ الجديد أقدم');
      deq(Object.keys(a.before), [...L.PRINT_FIELDS], '[٢] الحقول المطبوعة هي القائمة البيضاء التسعة');
      const text = fs.readFileSync(outPath, 'utf8');
      eq(text, `${JSON.stringify(j, null, 2)}\n`, '[٢] ملفّ --out = المطبوع (UTF-8 بلا BOM)');
      ok(leaksIn(r.stdout, r.stderr, text).length === 0, `[٢][الأهمّ] لا بريد ولا uid ولا حقل خارج القائمة في stdout/stderr/--out: ${leaksIn(r.stdout, r.stderr, text)}`);
      for (const k of ['email', 'fcmToken', 'phone', 'name', 'shopSlug', 'nested', 'freeTrialUsedDevices', 'language']) ok(!r.stdout.includes(`"${k}"`), `[٢] لا مفتاح خارج القائمة في المخرَج: ${k}`);
      // والتشغيل الجافّ بالأمر الحقيقي (في عملية فرعية إن وُجد Auth) يعطي الرمز نفسه لحالة المستندات والملفّ نفسيهما
      const r2 = await runScript(['--dry-run', '--accounts', file3]);
      eq(r2.code, 0, '[٢] الجافّ ثانيةً: 0');
      eq(JSON.parse(r2.stdout).token, token, '[٢] الرمز حتمي: الحالة والملفّ نفسيهما ⟵ الرمز نفسه');
      deq(await dumpAll(), before, '[٢] وبعد التشغيل الثاني المخزن كما هو');
    }

    // ═══ ٣ — رمز خاطئ ═══
    {
      const before = await dumpAll();
      const r = await runScript(['--commit', '--accounts', file3, '--token', '0'.repeat(64)]);
      ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr), '[٣] رمز خاطئ (صحيح الشكل) ⟵ 2 TOKEN_MISMATCH');
      deq(await dumpAll(), before, '[٣][الأهمّ] ولا مستند تغيّر');
      ok(leaksIn(r.stdout, r.stderr).length === 0, '[٣] ولا تسرّب في الرفض');
    }

    // ═══ ٤ — الكتابة بالرمز الصحيح: الحقول المسمّاة وحدها، والباقي بايتاً بايتاً ═══
    {
      const before = await dumpAll();
      const outPath = nextPath();
      const r = await runScript(['--commit', '--accounts', file3, '--token', token, '--out', outPath]);
      eq(r.code, 0, '[٤] الكتابة بالرمز الصحيح: 0');
      const j = JSON.parse(r.stdout);
      deq([j.run, j.committed, j.tokenVerifiedInsideTransaction, j.summary.allMatch, j.summary.readBack], ['commit', true, true, true, 'OK'], '[٤] الرأس: committed والرمز تُحقّق داخل المعاملة والقراءة اللاحقة مطابقة');
      deq(j.summary.written, {expiresAt: 3, scansRemaining: 2, scansTotal: 1}, '[٤] المكتوب: expiresAt×3 وscansRemaining×2 وscansTotal×1');
      const after = await dumpAll();
      const written = {[UID.A]: ['expiresAt', 'scansRemaining', 'scansTotal'], [UID.B]: ['expiresAt', 'scansRemaining'], [UID.C]: ['expiresAt']};
      // الحقول المكتوبة بنوعها الحقيقي وقيمها
      const snapA = (await db.collection('users').doc(UID.A).get()).data();
      const snapB = (await db.collection('users').doc(UID.B).get()).data();
      const snapC = (await db.collection('users').doc(UID.C).get()).data();
      ok(snapA.expiresAt instanceof Timestamp && snapA.expiresAt.toMillis() === eodMs(D1), '[٤] A.expiresAt: Timestamp حقيقي = نهاية D1 بـ+03 (23:59:59.999)');
      ok(snapB.expiresAt instanceof Timestamp && snapB.expiresAt.toMillis() === eodMs(D2), '[٤] B.expiresAt كان نصّاً وصار Timestamp = نهاية D2 بـ+03');
      ok(snapC.expiresAt instanceof Timestamp && snapC.expiresAt.toMillis() === eodMs(D3), '[٤] C.expiresAt: Timestamp = نهاية D3 (وهو أقدم من السابق: كُتب لأن المستخدم سمّاه)');
      deq([snapA.scansRemaining, snapA.scansTotal, snapB.scansRemaining, snapB.scansTotal, snapC.scansRemaining, snapC.scansTotal], [17, 105, 30, 50, 3, 3], '[٤] الأرصدة: A add:5 ⟵ 17/105 · B set:30 ⟵ 30/50 · C لم يُطلب ⟵ 3/3');
      eq(typeof snapA.scansRemaining, 'number', '[٤] والرصيد number لا string');
      // الباقي كما هو، حقلاً حقلاً ومفتاحاً مفتاحاً
      for (const uid of [UID.A, UID.B, UID.C]) {
        const keysBefore = Object.keys(before[`users/${uid}`].data).sort();
        const keysAfter = Object.keys(after[`users/${uid}`].data).sort();
        deq(keysAfter, keysBefore, `[٤] ${uid.slice(8, 15)}: مجموعة المفاتيح نفسها (لا مفتاح أُضيف ولا حُذف)`);
        ok(same(withoutKeys(after[`users/${uid}`].data, written[uid]), withoutKeys(before[`users/${uid}`].data, written[uid])), `[٤][الأهمّ] ${uid.slice(8, 15)}: كل حقل غير مكتوب كما هو بايتاً بايتاً (الأنواع والقيم والتداخل)`);
        eq(after[`users/${uid}`].createTime, before[`users/${uid}`].createTime, `[٤] ${uid.slice(8, 15)}: createTime لم يتغيّر (المستند لم يُنشأ من جديد)`);
        ok(after[`users/${uid}`].updateTime !== before[`users/${uid}`].updateTime, `[٤] ${uid.slice(8, 15)}: updateTime تغيّر (كُتب)`);
      }
      // المارّة والمجموعات الأخرى: صفر مسّ
      for (const key of [`users/${UID.D}`, `users/${UID.X}`, `users/${UID.Y}`, 'settings/keepme']) {
        ok(same(after[key], before[key]), `[٤][الأهمّ] ${key.slice(0, 18)}: لم يُمسّ (البيانات وupdateTime وcreateTime)`);
      }
      deq(Object.keys(after).sort(), Object.keys(before).sort(), '[٤] ولا مستند أُنشئ ولا حُذف في أيّ مجموعة');
      // التحقّق في المخرَج
      for (const acc of j.accounts) {
        ok(acc.verification.allMatch && acc.verification.writtenFields.every((f) => f.match) && acc.verification.unchangedFields.mismatched.length === 0, '[٤] التحقّق حقلاً حقلاً يطابق في كل حساب');
        deq(acc.afterActual, acc.afterPlanned, '[٤] «بعد» الفعلي = «بعد» المخطَّط');
      }
      deq(j.accounts[0].afterActual.expiresAt, {present: true, type: 'timestamp', plus03: `${D1}T23:59:59.999+03:00`, epochMs: eodMs(D1)}, '[٤] «بعد» الفعلي لـexpiresAt: Timestamp بقيمته المطلقة');
      eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٤] ملفّ --out = المطبوع');
      ok(leaksIn(r.stdout, r.stderr, fs.readFileSync(outPath, 'utf8')).length === 0, '[٤][الأهمّ] لا بريد ولا uid ولا حقل خارج القائمة بعد الكتابة');
      // إعادة تشغيل الرمز نفسه: قيم «قبل» تغيّرت ⟵ يُرفض بلا كتابة
      const snap = await dumpAll();
      const replay = await runScript(['--commit', '--accounts', file3, '--token', token]);
      ok(replay.code === 2 && /TOKEN_MISMATCH/.test(replay.stderr), '[٤] إعادة تشغيل الرمز نفسه بعد الكتابة ⟵ 2 TOKEN_MISMATCH');
      deq(await dumpAll(), snap, '[٤] ولا كتابة جديدة (المخزن كما هو)');
      // جافّ بعد الكتابة: يعرض الحالة الجديدة
      const dry = await runScript(['--dry-run', '--accounts', file3]);
      const jd = JSON.parse(dry.stdout);
      eq(jd.accounts[0].before.expiresAt.plus03, `${D1}T23:59:59.999+03:00`, '[٤] جافّ بعد الكتابة: «قبل» = ما كُتب');
      ok(jd.token !== token, '[٤] ورمزه جديد');
    }

    // ═══ ٥ — الرمز البائت بعد تعديل حساب بين الوضعين ═══
    {
      await seed();
      const t0 = JSON.parse((await runScript(['--dry-run', '--accounts', file3])).stdout).token;
      await db.collection('users').doc(UID.B).update({scansRemaining: 1}); // تعديل متزامن (فحصة استُهلكت أو رُدّت) بين الوضعين
      const before = await dumpAll();
      const r = await runScript(['--commit', '--accounts', file3, '--token', t0]);
      ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr), '[٥][الأهمّ] تعديل حساب بين الوضعين ⟵ الرمز البائت يُرفض 2 TOKEN_MISMATCH');
      deq(await dumpAll(), before, '[٥][الأهمّ] ولا مستند تغيّر — ولا A ولا C السليمين (كلّها أو لا شيء)');
      // تعديل expiresAt لحساب آخر
      const t1 = JSON.parse((await runScript(['--dry-run', '--accounts', file3])).stdout).token;
      await db.collection('users').doc(UID.A).update({expiresAt: Timestamp.fromMillis(Date.now() + 5 * DAY)});
      const before2 = await dumpAll();
      const r2 = await runScript(['--commit', '--accounts', file3, '--token', t1]);
      ok(r2.code === 2 && /TOKEN_MISMATCH/.test(r2.stderr), '[٥] تعديل expiresAt لحساب بين الوضعين ⟵ يُرفض');
      deq(await dumpAll(), before2, '[٥] ولا كتابة');
      // تعديل ملفّ المدخل
      const t2 = JSON.parse((await runScript(['--dry-run', '--accounts', file3])).stdout).token;
      const edited = writeAccounts(`${FILE_THREE}# edited after the dry run\n`);
      const before3 = await dumpAll();
      const r3 = await runScript(['--commit', '--accounts', edited, '--token', t2]);
      ok(r3.code === 2 && /TOKEN_MISMATCH/.test(r3.stderr), '[٥] تعديل ملفّ المدخل بين الوضعين (تعليق) ⟵ يُرفض');
      deq(await dumpAll(), before3, '[٥] ولا كتابة');
      // حقل غير مكتوب (plan) لا يُبطل الرمز بحسب نصّ الأمر — وتبقى قيمته الجديدة كما هي
      await seed();
      const t3 = JSON.parse((await runScript(['--dry-run', '--accounts', file3])).stdout).token;
      await db.collection('users').doc(UID.A).update({plan: 'shop_basic'});
      const r4 = await runScript(['--commit', '--accounts', file3, '--token', t3]);
      eq(r4.code, 0, '[٥] تعديل plan (غير مكتوب) بين الوضعين لا يُبطل الرمز (نطاقه الحقول المكتوبة)');
      eq((await db.collection('users').doc(UID.A).get()).data().plan, 'shop_basic', '[٥] وplan الجديد باقٍ كما هو (لا يُكتب فوقه)');
    }

    // ═══ ٦ — كلّها أو لا شيء على المعاملة الحقيقية ═══
    {
      await seed();
      // (أ) حساب بلا مستند users: الجافّ يرفض
      let before = await dumpAll();
      const fileZ = writeAccounts(`${EMAIL.A},${D1},add:5\n${EMAIL.Z},${D1}\n`);
      let r = await runScript(['--dry-run', '--accounts', fileZ]);
      ok(r.code === 2 && /line 2 USER_DOC_MISSING/.test(r.stderr), '[٦] حساب Auth بلا مستند users ⟵ USER_DOC_MISSING بالسطر 2');
      deq(await dumpAll(), before, '[٦] ولا كتابة');
      // (ب) رفض داخل المعاملة: الرصيد يغيب بين الوضعين مع add
      await db.collection('users').doc(UID.D).update({scansRemaining: 4, scansTotal: 9});
      const fileAD = writeAccounts(`${EMAIL.A},${D1},add:5\n${EMAIL.D},${D1},add:3\n`);
      const t = JSON.parse((await runScript(['--dry-run', '--accounts', fileAD])).stdout).token;
      await db.collection('users').doc(UID.D).update({scansRemaining: FieldValue.delete()}); // اختبار على المحاكي وحده (الحارس أعلاه يمنع الإنتاج)
      before = await dumpAll();
      r = await runScript(['--commit', '--accounts', fileAD, '--token', t]);
      ok(r.code === 2 && /line 2 CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER/.test(r.stderr), '[٦] add والرصيد غاب بين الوضعين ⟵ رفض داخل المعاملة CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER (القاعدة 22)');
      deq(await dumpAll(), before, '[٦][الأهمّ] كلّها أو لا شيء: A السليم لم يُكتب لأن D رُفض');
      // (ج) add على حساب بلا رصيد أصلاً: الجافّ يرفض بلا مسّ
      before = await dumpAll();
      const fileD = writeAccounts(`${EMAIL.D},${D1},add:3\n`);
      r = await runScript(['--dry-run', '--accounts', fileD]);
      ok(r.code === 2 && /line 1 CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER/.test(r.stderr) && !/CURRENT_TOTAL/.test(r.stderr) && r.stdout === '', '[٦] add على حساب رصيده غائب (وإجماليه 9 موجود) ⟵ CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER وحده ولا JSON');
      deq(await dumpAll(), before, '[٦] ولا مسّ');
      // set على الحساب نفسه مقبول (لا يقرأ الحالي)
      const fileDset = writeAccounts(`${EMAIL.D},${D1},set:7\n`);
      r = await runScript(['--dry-run', '--accounts', fileDset]);
      eq(r.code, 0, '[٦] set على حساب بلا رصيد ⟵ مقبول في الجافّ');
      const tSet = JSON.parse(r.stdout).token;
      r = await runScript(['--commit', '--accounts', fileDset, '--token', tSet]);
      eq(r.code, 0, '[٦] ويُكتب');
      const dd = (await db.collection('users').doc(UID.D).get()).data();
      deq([dd.scansRemaining, dd.scansTotal, dd.plan, dd.isActive], [7, 9, 'shop_pro', true], '[٦] D: scansRemaining=7 (غائب ثم set)، وscansTotal بقي 9 (set لا يمسّه)، وplan وisActive لم يُمسّا');
    }

    // ═══ ٧ — الرفض بالسلسلة الحقيقية: بلا كتابة ولا تسرّب ═══
    {
      await seed();
      const before = await dumpAll();
      const cases = [
        ['بريد غير موجود', `${EMAIL.A},${D1}\nnobody.real.SECRET@example.test,${D1}\n`, /line 2 ACCOUNT_NOT_FOUND/],
        ['تاريخ ماضٍ', `${EMAIL.A},${plus03Date(-1)}\n`, /line 1 DATE_IN_PAST/],
        ['تاريخ غير مقروء', `${EMAIL.A},2026-02-30\n`, /line 1 DATE_UNREADABLE/],
        ['N ليس عدداً', `${EMAIL.A},${D1},add:x\n`, /line 1 N_NOT_AN_INTEGER/],
        ['add:0', `${EMAIL.A},${D1},add:0\n`, /line 1 N_OUT_OF_RANGE/],
        ['set:-1', `${EMAIL.A},${D1},set:-1\n`, /line 1 N_OUT_OF_RANGE/],
        ['بريد مكرَّر', `${EMAIL.A},${D1}\n${EMAIL.A.toUpperCase()},${D2}\n`, /line 2 DUPLICATE_ACCOUNT/],
        ['أحد عشر سطراً', Array.from({length: 11}, (_, i) => `u${i}@example.test,${D1}`).join('\n'), /TOO_MANY_LINES/],
        ['ملفّ بلا أسطر', '# nothing\n', /NO_ACCOUNT_LINES/],
        ['سطر بلا تاريخ', `${EMAIL.A}\n`, /LINE_FORMAT_INVALID/],
      ];
      for (const [label, text, re] of cases) {
        const r = await runScript(['--dry-run', '--accounts', writeAccounts(text)]);
        ok(r.code === 2 && re.test(r.stderr) && r.stdout === '', `[٧] ${label} ⟵ 2 برمز مسمّى ولا JSON`);
        ok(leaksIn(r.stdout, r.stderr).length === 0 && !r.stderr.includes('nobody'), `[٧] ${label}: لا بريد في الرسالة (ونصّ خطأ المزوّد لا يُنسخ — القاعدة 36)`);
        const c = await runScript(['--commit', '--accounts', writeAccounts(text), '--token', 'a'.repeat(64)]);
        ok(c.code === 2 && re.test(c.stderr), `[٧] ${label}: الكتابة ترفض بالرمز نفسه قبل أيّ معاملة`);
      }
      const missing = await runScript(['--dry-run', '--accounts', path.join(tmp, 'absent.csv')]);
      ok(missing.code === 2 && /ACCOUNTS_FILE_MISSING/.test(missing.stderr), '[٧] ملفّ غائب ⟵ ACCOUNTS_FILE_MISSING');
      const bad = await runScript(['--commit', '--accounts', file3, '--token', 'xyz']);
      ok(bad.code === 2 && /TOKEN_FORMAT_INVALID/.test(bad.stderr), '[٧] رمز بصيغة خاطئة ⟵ TOKEN_FORMAT_INVALID');
      const none = await runScript(['--accounts', file3]);
      ok(none.code === 2 && /MODE_NOT_EXPLICIT/.test(none.stderr), '[٧] بلا وضع ⟵ MODE_NOT_EXPLICIT');
      const both = await runScript(['--dry-run', '--commit', '--accounts', file3, '--token', 'a'.repeat(64)]);
      ok(both.code === 2 && /MODE_CONFLICT/.test(both.stderr), '[٧] الوضعان معاً ⟵ MODE_CONFLICT');
      deq(await dumpAll(), before, '[٧][الأهمّ] كل هذه الرفوض: المخزن كلّه كما هو بايتاً بايتاً');
    }

    // ═══ ٨ — --out: الفحص قبل أيّ كتابة ═══
    {
      await seed();
      const t = JSON.parse((await runScript(['--dry-run', '--accounts', file3])).stdout).token;
      const before = await dumpAll();
      const existing = nextPath();
      fs.writeFileSync(existing, 'keep');
      const r = await runScript(['--commit', '--accounts', file3, '--token', t, '--out', existing]);
      ok(r.code === 2 && /OUT_EXISTS/.test(r.stderr), '[٨] --out موجود ⟵ 2 OUT_EXISTS');
      eq(fs.readFileSync(existing, 'utf8'), 'keep', '[٨] والملفّ القائم لم يُمسّ');
      deq(await dumpAll(), before, '[٨][الأهمّ] ولا كتابة Firestore (فُحص --out قبل المعاملة)');
      const r2 = await runScript(['--commit', '--accounts', file3, '--token', t, '--out', path.join(tmp, 'no-such-dir', 'x.json')]);
      ok(r2.code === 2 && /OUT_DIR_MISSING/.test(r2.stderr), '[٨] مجلّد --out غائب ⟵ 2 OUT_DIR_MISSING');
      deq(await dumpAll(), before, '[٨] ولا كتابة');
    }

    // ═══ ٩ — الغلاف على Firestore الحقيقي (المعاملة والمستندات حقيقية) ═══
    {
      await seed();
      const writer = L.createGuardedWriter(db);
      const before = await dumpAll();
      const attack = async (label, body, viaWriter = false) => {
        let err = null;
        try {
          if (viaWriter) await body(writer);
          else await writer.runTransaction(async (gtx) => { await gtx.readUsers([UID.A]); await body(gtx); });
        } catch (e) { err = e; }
        ok(err !== null && L.isTrap(err), `[٩] ${label} ⟵ TRAP`);
        deq(await dumpAll(), before, `[٩] ${label}: المخزن لم يتغيّر`);
      };
      await attack('مفتاح plan', (g) => g.update(UID.A, {plan: 'free'}));
      await attack('مفتاح plan بقيمة رقمية (يقبلها فحص النوع: لا يمنعها إلا قائمة المفاتيح)', (g) => g.update(UID.A, {plan: 5}));
      await attack('مفتاح isActive بقيمة رقمية', (g) => g.update(UID.A, {isActive: 1}));
      await attack('مفتاح subExpiredNotified بقيمة رقمية', (g) => g.update(UID.A, {subExpiredNotified: 0}));
      await attack('FieldValue.delete لـexpiresAt', (g) => g.update(UID.A, {expiresAt: FieldValue.delete()}));
      await attack('FieldValue.delete لـscansRemaining', (g) => g.update(UID.A, {scansRemaining: FieldValue.delete()}));
      await attack('FieldValue.increment', (g) => g.update(UID.A, {scansRemaining: FieldValue.increment(1)}));
      await attack('expiresAt بـDate', (g) => g.update(UID.A, {expiresAt: new Date()}));
      await attack('رصيد سالب', (g) => g.update(UID.A, {scansRemaining: -1}));
      await attack('set', (g) => g.set(UID.A, {scansRemaining: 1}));
      await attack('create', (g) => g.create(UID.A, {scansRemaining: 1}));
      await attack('delete', (g) => g.delete(UID.A));
      await attack('batch', (w) => w.batch(), true);
      await attack('bulkWriter', (w) => w.bulkWriter(), true);
      await attack('recursiveDelete', (w) => w.recursiveDelete(), true);
      // المشروع يعمل بالغلاف نفسه على المعاملة الحقيقية
      await writer.runTransaction(async (gtx) => {
        const [snap] = await gtx.readUsers([UID.A]);
        gtx.update(UID.A, {scansRemaining: snap.data.scansRemaining + 1});
      });
      const a = (await db.collection('users').doc(UID.A).get()).data();
      eq(a.scansRemaining, 13, '[٩] تحديث مشروع واحد عبر الغلاف يُطبَّق على المحاكي الحقيقي (12 + 1)');
      ok(a.plan === 'shop_pro' && a.subExpiredNotified === true, '[٩] والحقول الأخرى لم تُمسّ');
      // كاتب مبنيّ على db مغلَّف بـwrapReadOnly: TRAP قبل أيّ معاملة
      let trapped = null;
      try { await L.createGuardedWriter(C.wrapReadOnly(db)).runTransaction(async () => {}); } catch (e) { trapped = e; }
      ok(trapped && /TRAP: write operation "db.runTransaction"/.test(trapped.message), '[٩] كاتب على db المغلَّف بـwrapReadOnly ⟵ TRAP');
    }

    // ═══ ١٠ — حدود الصحّة: تواريخ بـ+03 بالسلسلة الحقيقية ═══
    {
      await seed();
      const r = await runScript(['--dry-run', '--accounts', writeAccounts(`${EMAIL.C},${plus03Date(0)}\n`)]);
      eq(r.code, 0, '[١٠] اليوم نفسه (+03) مقبول ما لم تنتهِ نهايته');
      const j = JSON.parse(r.stdout);
      eq(j.accounts[0].afterPlanned.expiresAt.epochMs, eodMs(plus03Date(0)), '[١٠] expiresAt المخطَّط = نهاية اليوم بـ+03 محسوبة مستقلّةً');
      ok(j.accounts[0].afterPlanned.expiresAt.plus03.endsWith('T23:59:59.999+03:00'), '[١٠] ويُطبَع 23:59:59.999+03:00');
    }

    // ═══ ١١ — مَن سُمِّي وحده ═══
    {
      await seed();
      const before = await dumpAll();
      const f = writeAccounts(`${EMAIL.D},${D1}\n`);
      const t = JSON.parse((await runScript(['--dry-run', '--accounts', f])).stdout).token;
      const r = await runScript(['--commit', '--accounts', f, '--token', t]);
      eq(r.code, 0, '[١١] حساب واحد مسمّى: الكتابة 0');
      const after = await dumpAll();
      for (const key of Object.keys(before).filter((k) => k !== `users/${UID.D}`)) ok(same(after[key], before[key]), `[١١] ${key.slice(0, 18)}: لم يُمسّ`);
      const d = (await db.collection('users').doc(UID.D).get()).data();
      ok(d.expiresAt instanceof Timestamp && d.expiresAt.toMillis() === eodMs(D1) && d.plan === 'shop_pro' && d.isActive === true && !('scansRemaining' in d), '[١١] D: expiresAt وحده تغيّر (والرصيد الغائب بقي غائباً)');
    }

    fs.rmSync(tmp, {recursive: true, force: true});
    await reset();
    await app.delete();
    const modes = runLog.reduce((m, x) => { m[x.mode] = (m[x.mode] || 0) + 1; return m; }, {});
    console.log(`\nsetAccountSubscription.e2e.test.js: ${n}/${n} assertions passed`);
    console.log(`ALL PASS (${n} assertions; auth-emulator cases: ${authMode}; script runs: ${JSON.stringify(modes)})`);
  } finally {
    netGuard.restore();
  }
})().catch((e) => {
  console.error('FAIL:', (e && e.stack) || e);
  process.exitCode = 1;
});
