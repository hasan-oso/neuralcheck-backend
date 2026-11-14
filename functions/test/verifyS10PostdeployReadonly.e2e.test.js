// E2E test: verify-s10-postdeploy-readonly على محاكي Firestore (قبل نشر الأمان، 2026-10-09 +03). وضع --after بالسكربت الحقيقي في عملية فرعية (يفتح Admin
// SDK بـprojectId المثبَّت على المحاكي)؛ والتقرير وreportRaw يُكتبان بدالّة الخادم الحقيقية writeReportAndRaw (الدفعة الذرّية نفسها: createTime واحد).
// الحارس المشترك أوّل الملفّ: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «بعد نشر الدوالّ والقواعد مباشرة، أجري فحصاً واحداً من الـS10 وهو على 1.0.10، من الرئيسية. يُقبل إن صدر
// التقرير، وكُتب reportRaw بالكتابة الذرّية، وخُصم الرصيد مرّة واحدة، ولم يبقَ حجز معلّق. ويُقرأ ذلك بكتلة قراءة تأتيني. وإن فشل: تراجع إلى d5b6c29 قبل
// أيّ ترحيل.» ونطاق التراجع (فشل الخادم ⇐ الدوالّ إلى d5b6c29 وتبقى القواعد؛ سليم والهاتف لا يعرض ⇐ القواعد إلى نسختها؛ تعذّر التمييز ⇐ الاثنان).
//
// ما يبنيه ويقرؤه: الحالات الأربع (أ التقرير، ب reportRaw بالكتابة الذرّية، ج الرصيد مرّة واحدة، د لا حجز معلّق) وكل ما يُفشلها أو يُعمّيها: لا تقرير، تقرير بلا خامّ،
// خامّ بـcreateTime مختلف، خصم مضاعف، لا خصم، حجز معلّق، فحص آخر بين اللقطتين، تقرير حساب آخر، shortId مكرَّر، تقرير أقدم من اللقطة، رصيد زاد، مستند مستخدم غائب.
//
// الاستبدال المعلَن (القاعدة 37): وضع --before يحتاج Auth.getUserByEmail؛ محاكي Auth لا يعمل بأمر الـe2e القياسي (--only firestore) — يُشغَّل بملفّ إعداد
// (functions/test/firebase.firestore-auth.emulators.json، انظر أدناه). فالمسار الأساسي لـ--before يجري **في العملية نفسها بـAuth مزيَّف** (getUserByEmail وحدها، بتمثيل
// خطأ auth/user-not-found الحقيقي)، وFirestore حقيقي. وإن وُجد FIREBASE_AUTH_EMULATOR_HOST محلّياً: تجري أيضاً **حالات Auth الحقيقية بالسكربت في عملية فرعية** (المحاكي
// الحقيقي). وإلّا تُطبَع «AUTH-EMULATOR CASES SKIPPED» صراحةً ويُذكر في سطر الختام (لا تجاهل صامت).
//
// Run (قياسي — حالات Auth الحقيقية تُتخطّى معلَنةً):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/verifyS10PostdeployReadonly.e2e.test.js"
// Run (مع محاكي Auth — كل الحالات):
//   JAVA_HOME="<jdk21>" firebase emulators:exec --config functions/test/firebase.firestore-auth.emulators.json --only firestore,auth --project demo-nc \
//     "node functions/test/verifyS10PostdeployReadonly.e2e.test.js"

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
const admin = require('firebase-admin');
const {FieldValue, Timestamp} = require('firebase-admin/firestore');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {main} = require('../scripts/verify-s10-postdeploy-readonly');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {writeReportAndRaw} = require('../src/analysis/reportRawStore');

const app = admin.initializeApp({projectId: PROJECT_ID}, 'e2e-verify-s10');
const db = app.firestore();

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-s10-postdeploy-readonly.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's10-e2e-'));
const UID = 'e2e-s10-uid-SECRET-0001';
const EMAIL = 's10.e2e.secret@example.test';
const OTHER_UID = 'e2e-other-uid-SECRET-0002';
const HOUR = 3600_000;
let counter = 0;
const nextShortId = () => `NC-S10${String(++counter).padStart(3, '0')}`;
const nextOut = (label) => path.join(tmp, `${label}-${++counter}.json`);

async function reset() {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}
async function dump() {
  const out = {};
  for (const col of ['reports', 'reportRaw', 'users', 'scanClaims']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) out[`${col}/${d.id}`] = JSON.stringify([d.data(), d.updateTime.toMillis()]);
  }
  return JSON.stringify(out);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {env: {...process.env, ...env}, encoding: 'utf8', cwd: path.join(__dirname, '..')});
  return {code: r.status, stdout: r.stdout || '', stderr: r.stderr || ''};
};
const fakeAuth = () => ({getUserByEmail: async (email) => {
  if (email === EMAIL) return {uid: UID};
  throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
}});

// ─── مشهد: حساب S10 برصيد وتقارير قديمة، ثم لقطة «قبل» ───
async function baseScene({balance = 10, oldReports = 2} = {}) {
  await reset();
  await db.collection('users').doc(UID).set({scansRemaining: balance, plan: 'single'});
  for (let i = 0; i < oldReports; i++) {
    await db.collection('reports').doc(`old-${i}`).set({userId: UID, shortId: `NC-OLD00${i}`, createdAt: Timestamp.fromMillis(Date.now() - 5 * HOUR)});
  }
  const beforePath = nextOut('before');
  const outs = [];
  const errs = [];
  const code = await main(['--before', '--out', beforePath], {env: {S10_ACCOUNT_EMAIL: EMAIL}, out: (s) => outs.push(s), err: (s) => errs.push(s), db, auth: fakeAuth()});
  eq(code, 0, '[تمهيد] لقطة «قبل» تنجح');
  return {beforePath};
}
// فحص S10 كما يكتبه الخادم: تقرير وreportRaw في دفعة واحدة (دالّة الخادم الحقيقية)، وقفل محوّ، والرصيد مخصوم
async function scanDone({scanId, shortId, userId = UID, deduct = 1, balanceAfter, atomic = true, withRaw = true, claim, createdAtMs}) {
  const reportRef = db.collection('reports').doc(scanId);
  const reportDocument = {userId, shortId, createdAt: createdAtMs ? Timestamp.fromMillis(createdAtMs) : FieldValue.serverTimestamp(), pipeline: 'v7_findings_based', fieldsVersion: 67};
  const rawDocument = {scanId, source: 'analyzeDevice', createdAt: FieldValue.serverTimestamp(), rawFingerprint: {device: {model: 'S10'}}, sessionId: null};
  if (atomic && withRaw) {
    await writeReportAndRaw({db, reportRef, scanId, reportDocument, rawDocument});
  } else {
    await reportRef.set(reportDocument);
    if (withRaw) {
      await sleep(40); // كتابة منفصلة لاحقاً: createTime مختلف (ليست الدفعة الذرّية)
      await db.collection('reportRaw').doc(scanId).set(rawDocument);
    }
  }
  if (balanceAfter !== undefined) await db.collection('users').doc(userId).set({scansRemaining: balanceAfter}, {merge: true});
  else if (deduct) await db.collection('users').doc(userId).update({scansRemaining: FieldValue.increment(-deduct)});
  if (claim !== undefined) await db.collection('scanClaims').doc(scanId).set(claim);
}
async function after(shortId, beforePath, label) {
  const outPath = nextOut(`after-${label}`);
  const stateBefore = await dump();
  const r = cli(['--after', '--short-id', shortId, '--before', beforePath, '--out', outPath]);
  ok((await dump()) === stateBefore, `[${label}] --after لم يغيّر شيئاً في المحاكي (قراءة بحتة: محتوى وupdateTime)`);
  const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  return {...r, outPath, fileText, json: fileText ? JSON.parse(fileText) : null};
}
const noSecrets = (label, ...texts) => ok(![UID, OTHER_UID, EMAIL, 'scan-', shortIdsSeen].flat().some((v) => typeof v === 'string' && v !== '' && texts.some((t) => t && t.includes(v))), `[${label}] لا uid ولا بريد ولا scanId ولا shortId خامّ في stdout ولا stderr ولا الملفّ`);
const shortIdsSeen = [];

(async () => {
  // ═══ ١ — SERVER_OK: الحالات الأربع سليمة ═══
  {
    const {beforePath} = await baseScene();
    const shortId = nextShortId(); shortIdsSeen.push(shortId);
    await scanDone({scanId: 'scan-ok-1', shortId});
    const a = await after(shortId, beforePath, 'ok');
    eq(a.code, 0, '[ok] رمز 0');
    eq(a.json.verdict, 'SERVER_OK', '[ok] الحكم SERVER_OK');
    deq(a.json.failed, [], '[ok] لا فشل');
    deq(a.json.undetermined, [], '[ok] ولا عدم حكم');
    deq([a.json.conditions.A.state, a.json.conditions.B.state, a.json.conditions.C.state, a.json.conditions.D.state],
        ['A_REPORT_FOUND', 'B_RAW_ATOMIC_OK', 'C_DEDUCTED_ONCE_OK', 'D_NO_PENDING_RESERVATION_OK'], '[ok] كل شرط بحالته المسمّاة');
    eq(a.json.conditions.C.scansRemainingBefore, 10, '[ok] الرصيد قبل 10');
    eq(a.json.conditions.C.scansRemainingAfter, 9, '[ok] وبعد 9');
    eq(a.json.conditions.C.newReports, 1, '[ok] وتقرير جديد واحد');
    deq(a.json.conditions.B.reportCreateTime, a.json.conditions.B.rawCreateTime, '[ok] createTime التقرير = createTime reportRaw (الدفعة الذرّية)');
    eq(a.json.projectId, PROJECT_ID, '[ok] projectId مثبَّت');
    eq(Object.keys(a.json)[0], 'projectId', '[ok] وهو أوّل حقل');
    ok(/^EMULATOR /.test(a.json.target), '[ok] والهدف مطبوع (المحاكي)');
    eq(a.json.decision.forThisVerdict, 'الخادم سليم من جهة هذا الفحص: لا تراجع للدوالّ.', '[ok] نصّ القرار المقابل');
    ok(/الخادم سليم والهاتف لا يعرض التقرير: ترجع القواعد إلى نسختها الاحتياطية/.test(a.json.decision.phoneNote) && /يحكم فيه المستخدم بعينه/.test(a.json.decision.phoneNote), '[ok] ونصّ الهاتف يذكّر أن عرضه يحكم فيه المستخدم');
    ok(a.stdout.startsWith('verdict=SERVER_OK'), '[ok] وstdout يبدأ بالحكم');
    ok(!(a.fileText.charCodeAt(0) === 0xfeff), '[ok] الملفّ بلا BOM');
    noSecrets('ok', a.stdout, a.stderr, a.fileText);
    eq(a.json.input.shortIdHash, hashIdForLog(shortId), '[ok] shortId مُهشَّر في الملفّ');
    const again = cli(['--after', '--short-id', shortId, '--before', beforePath, '--out', a.outPath]);
    eq(again.code, 2, '[ok] إعادة الكتابة على ملفّ «بعد» موجود: رمز 2');
    ok(/OUT_EXISTS/.test(again.stderr) && again.stdout === '', '[ok] OUT_EXISTS بلا مخرَج (wx: لا استبدال)');
  }
  // قفل بقي بـreservation = null لا يمنع (د)؛ وقفل بلا حقل reservation كذلك
  for (const [label, claim] of [['claim-null', {scanId: 'x', claimedAtMs: Date.now(), reservation: null}], ['claim-nofield', {scanId: 'x', claimedAtMs: Date.now()}]]) {
    const {beforePath} = await baseScene();
    const shortId = nextShortId(); shortIdsSeen.push(shortId);
    await scanDone({scanId: `scan-${label}`, shortId, claim});
    const a = await after(shortId, beforePath, label);
    eq(a.code, 0, `[${label}] قفل بلا حجز معلّق: رمز 0`);
    eq(a.json.conditions.D.state, 'D_NO_PENDING_RESERVATION_OK', `[${label}] د مقبول`);
    eq(a.json.conditions.D.claimDocExists, true, `[${label}] والقفل موجود ويُعلَن`);
  }

  // ═══ ٢ — SERVER_FAIL: كل فشل باسمه ═══
  const FAILS = [
    ['A: لا تقرير بهذا shortId', async () => { /* لا فحص */ }, 'A_REPORT_ABSENT', {requestShortId: 'NC-NONE00'}],
    ['B: تقرير بلا reportRaw', async (s) => scanDone({scanId: 'scan-noraw', shortId: s, atomic: false, withRaw: false}), 'B_RAW_ABSENT'],
    ['B: reportRaw بـcreateTime مختلف (كتابة منفصلة لا ذرّية)', async (s) => scanDone({scanId: 'scan-notatomic', shortId: s, atomic: false}), 'B_RAW_CREATE_TIME_DIFFERS'],
    ['C: خصم مضاعف (الرصيد −2)', async (s) => scanDone({scanId: 'scan-double', shortId: s, deduct: 2}), 'C_DOUBLE_DEDUCTION'],
    ['C: لا خصم (الرصيد كما كان)', async (s) => scanDone({scanId: 'scan-nodeduct', shortId: s, deduct: 0}), 'C_NO_DEDUCTION'],
    ['D: حجز معلّق في scanClaims', async (s) => scanDone({scanId: 'scan-pending', shortId: s, claim: {scanId: 'x', claimedAtMs: Date.now(), reservation: {userId: UID, reservedAtMs: Date.now(), isFreeTrial: false}}}), 'D_RESERVATION_PENDING'],
  ];
  for (const [label, make, state, opt] of FAILS) {
    const {beforePath} = await baseScene();
    const shortId = (opt && opt.requestShortId) || nextShortId();
    shortIdsSeen.push(shortId);
    await make(shortId);
    const a = await after(shortId, beforePath, label);
    eq(a.code, 1, `[${label}] رمز 1 (SERVER_FAIL)`);
    eq(a.json.verdict, 'SERVER_FAIL', `[${label}] الحكم SERVER_FAIL`);
    ok(a.json.failed.includes(state), `[${label}] يُسمّي ${state} (${JSON.stringify(a.json.failed)})`);
    eq(a.json.decision.forThisVerdict, 'فشل في جانب الخادم (لا تقرير، أو لا reportRaw، أو خصم مضاعف، أو حجز معلّق): ترجع الدوالّ إلى d5b6c29 وتبقى القواعد.', `[${label}] نصّ قرار المستخدم المقابل حرفياً`);
    ok(a.stdout.includes('الدوالّ إلى d5b6c29 وتبقى القواعد') && /يحكم فيه المستخدم بعينه|الخادم سليم والهاتف لا يعرض/.test(a.stdout), `[${label}] ويُطبع النصّان (التراجع ونصّ الهاتف)`);
    noSecrets(label, a.stdout, a.stderr, a.fileText);
  }

  // ═══ ٣ — UNDETERMINED: لا يُحكم، بسببه ═══
  const UNDET = [
    ['فحص آخر بين اللقطتين', async (s) => { await scanDone({scanId: 'scan-a', shortId: s}); await scanDone({scanId: 'scan-b', shortId: nextShortId(), deduct: 0}); }, 'C_OTHER_SCAN_BETWEEN_SNAPSHOTS'],
    ['تقرير حساب آخر (حتى لو بلا خامّ)', async (s) => { await db.collection('users').doc(OTHER_UID).set({scansRemaining: 3}); await scanDone({scanId: 'scan-other', shortId: s, userId: OTHER_UID, atomic: false, withRaw: false}); }, 'C_ACCOUNT_HASH_MISMATCH'],
    ['الرصيد زاد بين اللقطتين', async (s) => scanDone({scanId: 'scan-up', shortId: s, balanceAfter: 15}), 'C_BALANCE_INCREASED'],
    ['مستند المستخدم غائب بعد الفحص', async (s) => { await scanDone({scanId: 'scan-nouser', shortId: s, deduct: 0}); await db.collection('users').doc(UID).delete(); }, 'C_USER_DOC_ABSENT'],
    ['الرصيد بعد غير رقمي', async (s) => scanDone({scanId: 'scan-strbal', shortId: s, balanceAfter: '9'}), 'C_BALANCE_UNREADABLE'],
  ];
  for (const [label, make, state] of UNDET) {
    const {beforePath} = await baseScene();
    const shortId = nextShortId(); shortIdsSeen.push(shortId);
    await make(shortId);
    const a = await after(shortId, beforePath, label);
    eq(a.code, 3, `[${label}] رمز 3 (UNDETERMINED)`);
    eq(a.json.verdict, 'UNDETERMINED', `[${label}] الحكم UNDETERMINED`);
    ok(a.json.undetermined.includes(state), `[${label}] يُسمّي ${state} (${JSON.stringify(a.json.undetermined)})`);
    eq(a.json.failed.length, 0, `[${label}] ولا فشل منسوب`);
    eq(a.json.decision.forThisVerdict, 'إن تعذّر التمييز: يُرجَع الاثنان.', `[${label}] نصّ قرار المستخدم لتعذّر التمييز حرفياً`);
    noSecrets(label, a.stdout, a.stderr, a.fileText);
  }
  {
    // shortId مكرَّر: تقريران
    const {beforePath} = await baseScene();
    const shortId = nextShortId(); shortIdsSeen.push(shortId);
    await scanDone({scanId: 'scan-dup-1', shortId});
    await db.collection('reports').doc('scan-dup-2').set({userId: UID, shortId, createdAt: FieldValue.serverTimestamp()});
    const a = await after(shortId, beforePath, 'dup');
    eq(a.code, 3, '[dup] shortId مكرَّر: رمز 3');
    ok(a.json.undetermined.includes('A_SHORT_ID_AMBIGUOUS'), '[dup] A_SHORT_ID_AMBIGUOUS');
    eq(a.json.conditions.A.reportsFoundByShortId, 2, '[dup] ويعدّ التقارير (2)');
  }
  {
    // تقرير أقدم من اللقطة (وقت createdAt قبل اللقطة بخمس ساعات) كُتب بعدها: لا يُنسب إلى هذا الفحص
    const {beforePath} = await baseScene();
    const shortId = nextShortId(); shortIdsSeen.push(shortId);
    await scanDone({scanId: 'scan-predates', shortId, createdAtMs: Date.now() - 5 * HOUR});
    const a = await after(shortId, beforePath, 'predates');
    eq(a.code, 3, '[predates] تقرير أقدم من اللقطة: رمز 3');
    ok(a.json.undetermined.includes('C_REPORT_PREDATES_BEFORE_SNAPSHOT'), '[predates] C_REPORT_PREDATES_BEFORE_SNAPSHOT');
  }

  // ═══ ٤ — أخطاء: رمز 2 قبل أيّ اتصال/كتابة ═══
  {
    const {beforePath} = await baseScene();
    const outPath = nextOut('err');
    const dead = {FIRESTORE_EMULATOR_HOST: '127.0.0.1:1'};
    let r = cli(['--after', '--short-id', 'nc-bad', '--before', beforePath, '--out', outPath], dead);
    eq(r.code, 2, '[خطأ] shortId بصيغة خاطئة: رمز 2');
    ok(/NC-XXXXXX/.test(r.stderr) && !fs.existsSync(outPath), '[خطأ] رسالة استعمال ولا ملفّ');
    r = cli(['--after', '--short-id', 'NC-ABC123', '--before', path.join(tmp, 'no-such.json'), '--out', outPath], dead);
    eq(r.code, 2, '[خطأ] ملفّ «قبل» غائب: رمز 2');
    ok(/BEFORE_FILE_UNREADABLE/.test(r.stderr) && !fs.existsSync(outPath), '[خطأ] BEFORE_FILE_UNREADABLE قبل أيّ اتصال (المضيف ميّت ولم يُحاوَل)');
    const badBefore = path.join(tmp, 'bad-before.json');
    fs.writeFileSync(badBefore, JSON.stringify({mode: 's10-before', schema: 1, accountHash: UID, scansRemaining: 5, takenAtMs: Date.now(), accountReportsCount: 1}));
    r = cli(['--after', '--short-id', 'NC-ABC123', '--before', badBefore, '--out', outPath], dead);
    eq(r.code, 2, '[خطأ] ملفّ «قبل» يحمل uid خامّاً بدل المُهشَّر: يُرفض برمز 2');
    ok(/BEFORE_FILE_INVALID: accountHash/.test(r.stderr), '[خطأ] ويُسمّي الحقل');
    r = cli(['--after', '--short-id', 'NC-ABC123', '--before', beforePath, '--out', path.join(tmp, 'no-dir', 'o.json')], dead);
    eq(r.code, 2, '[خطأ] مجلّد المخرَج غير موجود: رمز 2');
    ok(/OUT_DIR_MISSING/.test(r.stderr), '[خطأ] OUT_DIR_MISSING');
    r = cli(['--after', '--short-id', 'NC-ABC123', '--before', beforePath, '--out', outPath], dead);
    eq(r.code, 2, '[خطأ] تعذّر الاتصال (مضيف ميّت): رمز 2 لا حكم');
    ok(!fs.existsSync(outPath) && /توقّف بخطأ|✗/.test(r.stderr), '[خطأ] ولا ملفّ مخرَج');
    r = cli(['--before', '--out', nextOut('b-noenv')], {S10_ACCOUNT_EMAIL: ''});
    eq(r.code, 2, '[خطأ] --before بلا متغيّر البريد: رمز 2');
    ok(/S10_EMAIL_ENV_MISSING/.test(r.stderr), '[خطأ] S10_EMAIL_ENV_MISSING');
    r = cli(['--preflight'], {...dead, S10_ACCOUNT_EMAIL: EMAIL});
    eq(r.code, 0, '[خطأ] --preflight بمضيف ميّت: رمز 0 (بلا شبكة)');
    const pj = JSON.parse(r.stdout);
    ok(pj.network === false && pj.checks.every((c) => c.ok) && pj.s10EmailEnvPresent === true && !r.stdout.includes(EMAIL), '[خطأ] وفحوصه ناجحة ولا يطبع البريد');
  }

  // ═══ ٥ — وضع --before: Auth المزيَّف (معلَن) وFirestore الحقيقي ═══
  {
    await reset();
    await db.collection('users').doc(UID).set({scansRemaining: 7});
    await db.collection('reports').doc('a1').set({userId: UID, shortId: 'NC-AAA001', createdAt: Timestamp.now()});
    await db.collection('reports').doc('a2').set({userId: OTHER_UID, shortId: 'NC-AAA002', createdAt: Timestamp.now()});
    const outPath = nextOut('before-main');
    const outs = [];
    const errs = [];
    const stateBefore = await dump();
    const code = await main(['--before', '--out', outPath], {env: {S10_ACCOUNT_EMAIL: EMAIL}, out: (s) => outs.push(s), err: (s) => errs.push(s), db, auth: fakeAuth()});
    eq(code, 0, '[قبل] --before: رمز 0');
    const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    eq(j.accountHash, hashIdForLog(UID), '[قبل] المعرّف مُهشَّر بـhashIdForLog');
    eq(j.scansRemaining, 7, '[قبل] الرصيد');
    eq(j.accountReportsCount, 1, '[قبل] تقارير الحساب (لا تقارير الآخرين)');
    ok(Math.abs(j.takenAtMs - Date.now()) < 60_000, '[قبل] والوقت');
    ok(![fs.readFileSync(outPath, 'utf8'), ...outs, ...errs].some((t) => t.includes(EMAIL) || t.includes(UID) || t.includes('SECRET')), '[قبل] لا بريد ولا uid خامّ في الملفّ ولا stdout ولا stderr');
    ok((await dump()) === stateBefore, '[قبل] ولم يتغيّر شيء في Firestore');
    eq(await main(['--before', '--out', outPath], {env: {S10_ACCOUNT_EMAIL: EMAIL}, out: () => {}, err: () => {}, db, auth: fakeAuth()}), 2, '[قبل] على ملفّ موجود: رمز 2');
    eq(await main(['--before', '--out', nextOut('b-nf')], {env: {S10_ACCOUNT_EMAIL: 'nobody@example.test'}, out: () => {}, err: (s) => errs.push(s), db, auth: fakeAuth()}), 2, '[قبل] حساب غير موجود: رمز 2');
    ok(errs.some((e) => /S10_ACCOUNT_NOT_FOUND/.test(e)) && !errs.join('\n').includes('nobody'), '[قبل] S10_ACCOUNT_NOT_FOUND بلا بريد');
    await db.collection('users').doc(UID).delete();
    eq(await main(['--before', '--out', nextOut('b-nodoc')], {env: {S10_ACCOUNT_EMAIL: EMAIL}, out: () => {}, err: (s) => errs.push(s), db, auth: fakeAuth()}), 2, '[قبل] مستند المستخدم غائب: رمز 2');
    ok(errs.some((e) => /USER_DOC_ABSENT/.test(e)), '[قبل] USER_DOC_ABSENT');
    await db.collection('users').doc(UID).set({scansRemaining: '7'});
    eq(await main(['--before', '--out', nextOut('b-strbal')], {env: {S10_ACCOUNT_EMAIL: EMAIL}, out: () => {}, err: (s) => errs.push(s), db, auth: fakeAuth()}), 2, '[قبل] scansRemaining نصّي: رمز 2');
    ok(errs.some((e) => /SCANS_REMAINING_NOT_A_NUMBER/.test(e)), '[قبل] SCANS_REMAINING_NOT_A_NUMBER');
  }

  // ═══ ٦ — حالات Auth الحقيقية (محاكي Auth) إن وُجد ═══
  let authCases = 'SKIPPED';
  if (AUTH_HOST) {
    authCases = 'RAN';
    const authApp = admin.initializeApp({projectId: PROJECT_ID}, 'e2e-verify-s10-auth');
    const user = await authApp.auth().createUser({email: EMAIL});
    await reset();
    await db.collection('users').doc(user.uid).set({scansRemaining: 12});
    await db.collection('reports').doc('real-auth-old').set({userId: user.uid, shortId: 'NC-RAU001', createdAt: Timestamp.now()});
    const outPath = nextOut('before-real-auth');
    let r = cli(['--before', '--out', outPath], {S10_ACCOUNT_EMAIL: EMAIL});
    eq(r.code, 0, '[Auth حقيقي] --before بالسكربت في عملية فرعية وAuth emulator: رمز 0');
    const j = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    eq(j.accountHash, hashIdForLog(user.uid), '[Auth حقيقي] المعرّف المُهشَّر لـuid الذي أنشأه المحاكي');
    eq(j.scansRemaining, 12, '[Auth حقيقي] الرصيد');
    eq(j.accountReportsCount, 1, '[Auth حقيقي] والتقارير');
    ok(![fs.readFileSync(outPath, 'utf8'), r.stdout, r.stderr].some((t) => t.includes(EMAIL) || t.includes(user.uid)), '[Auth حقيقي] لا بريد ولا uid خامّ في أيّ مخرَج');
    r = cli(['--before', '--out', nextOut('before-real-auth-nf')], {S10_ACCOUNT_EMAIL: 'nobody.real@example.test'});
    eq(r.code, 2, '[Auth حقيقي] حساب غير موجود: رمز 2');
    ok(/S10_ACCOUNT_NOT_FOUND/.test(r.stderr) && !r.stderr.includes('nobody.real'), '[Auth حقيقي] S10_ACCOUNT_NOT_FOUND بلا بريد (رسالة المزوّد الحقيقية لا تُنقل)');
    // سلسلة كاملة بالسكربتين الحقيقيين: قبل ← فحص ← بعد
    await db.collection('users').doc(user.uid).set({scansRemaining: 12});
    const sid = nextShortId(); shortIdsSeen.push(sid);
    const beforeFull = nextOut('before-full');
    r = cli(['--before', '--out', beforeFull], {S10_ACCOUNT_EMAIL: EMAIL});
    eq(r.code, 0, '[Auth حقيقي] السلسلة: قبل');
    await scanDone({scanId: 'scan-real-auth', shortId: sid, userId: user.uid});
    const a = await after(sid, beforeFull, 'real-auth-chain');
    eq(a.code, 0, '[Auth حقيقي] السلسلة: بعد SERVER_OK');
    await authApp.delete();
  } else {
    console.log('AUTH-EMULATOR CASES SKIPPED: FIREBASE_AUTH_EMULATOR_HOST غير مضبوط — حالات getUserByEmail الحقيقية لم تجرِ في هذا التشغيل (الاستبدال بـAuth مزيَّف معلَن في الرأس)؛ شغّل بملفّ إعداد Auth لتجري.');
  }

  fs.rmSync(tmp, {recursive: true, force: true});
  await reset();
  await app.delete();
  console.log(`\nALL PASS (${n} assertions; auth-emulator cases: ${authCases})`);
})().catch((e) => {
  console.error('FAIL:', (e && e.stack) || e);
  process.exitCode = 1;
});
