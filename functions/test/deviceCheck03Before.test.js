'use strict';

// deviceCheck03Before.test.js — السكربت device-check-03-before-readonly.js ومكتبته scripts/lib/deviceCheck03Before.js (فحص الجهاز ٠٣، الكتلة أ٣، 2026-10-10 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسار على المحاكي: deviceCheck03.e2e.test.js؛ وحارس «لا كتابة» وطفراته: deviceCheck03ReadOnlyGuard.test.js.
//
// أمر المنسّق (بنصّه المنقول): السكربت ١ — «المدخل: بريد حساب المالك (هو حساب الـS10) من متغيّر بيئة. يقرأ: users/{uid}.evaluationEnabled بقيمته ونوعه، وسببه المسمّى من evaluationEnabledState.js
// (المصدر نفسه الذي يستعمله joinScanSession). وعدد تقارير الحساب، بالطريقة نفسها التي يعدّ بها s10PostDeploy. وعدد الجلسات بحالاتها من lib/activeSessions.js (القراءة نفسها، بلا نسخ منطقها).»
//   ١ — الوسائط.  ٢ — وصف قيمة الحقل ونوعه (الغائب ≠ null ≠ false).  ٣ — كل سبب من الأسباب الخمسة المسمّاة (من المصدر الواحد) على db مزيَّف.  ٤ — عدد التقارير بالدالّة المشتركة.
//   ٥ — الجلسات = collectActive/summarize نفسهما.  ٦ — main: المخرَج بلا بريد ولا uid، والملفّ wx، وكل خطأ باسمه.  ٧ — الغلاف: Auth عملية واحدة، وStorage بقائمة بيضاء.
//
// الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في اختبار الوحدة وحدها؛ والطبقة الحقيقية في الـe2e.
//
// Run: node functions/test/deviceCheck03Before.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const B = require('../scripts/lib/deviceCheck03Before');
const A = require('../scripts/lib/activeSessions');
const S10 = require('../scripts/lib/s10PostDeploy');
const {main} = require('../scripts/device-check-03-before-readonly');
const {EVALUATION_ENABLED_REASON, evaluationEnabledDecision} = require('../src/sessions/evaluationEnabledState');
const {makeMemDb} = require('./lib/memFirestore');

const SECRET_EMAIL = 'owner.s10.secret@example.test';
const SECRET_UID = 'uid-OWNER-SECRET-424242';
const NOW = 1_800_000_000_000;
const ts = (ms) => ({toMillis: () => ms});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-before-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `before-${++counter}.json`);
const authFor = (uid = SECRET_UID) => ({getUserByEmail: async (email) => {
  if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  return {uid};
}});
const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};
const sessionsAndClaims = () => ({
  scanSessions: {
    s1: {status: 'scanning', createdAt: ts(NOW - 5 * 60_000)},
    s2: {status: 'pending', createdAt: ts(NOW - 10_000_000)},
    s3: {status: 'completed', createdAt: ts(NOW - 60_000)},
    s4: {status: 'cancelled', createdAt: ts(NOW - 60_000)},
    s5: {status: 'Weird_Status', createdAt: ts(NOW - 60_000)},
  },
  scanClaims: {c1: {claimedAtMs: NOW - 60_000, reservation: {x: 1}}, c2: {claimedAtMs: NOW - 99_000_000, reservation: null}},
});
const world = (userDoc, extra = {}) => ({
  users: userDoc === undefined ? {} : {[SECRET_UID]: userDoc},
  reports: {r1: {userId: SECRET_UID}, r2: {userId: SECRET_UID}, r3: {userId: SECRET_UID}, rx: {userId: 'someone-else'}},
  ...sessionsAndClaims(), ...extra,
});

(async () => {
  // ═══ ١ — الوسائط ═══
  const pa = B.parseArgs;
  deq(pa(['--out', 'b.json']), {mode: 'run', out: 'b.json'}, '[١] --out');
  deq(pa(['--preflight']), {mode: 'preflight', out: null}, '[١] --preflight');
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
  bad([], /USAGE: --out/, '[١] بلا وسائط');
  bad(['--out'], /يحتاج قيمة/, '[١] --out بلا قيمة');
  bad(['--out', '--preflight'], /يحتاج قيمة/, '[١] --out تتبعه علامة');
  bad(['--out', 'a.json', '--out', 'b.json'], /مكرَّر/, '[١] --out مكرَّر');
  bad(['--preflight', '--preflight'], /مكرَّر/, '[١] --preflight مكرَّر');
  bad(['--preflight', '--out', 'b.json'], /--preflight وحدها/, '[١] --preflight مع --out');
  bad(['--out', 'b.json', '--email', 'x@y.z'], /وسيط مجهول --email/, '[١] البريد لا يُقبل من سطر الأمر');
  bad(['--out', 'b.json', '--owner-email', 'x@y.z'], /وسيط مجهول/, '[١] ولا بأيّ اسم آخر');
  bad(['x'], /\(موضعي\)/, '[١] وسيط موضعي');
  eq(C.OWNER_EMAIL_ENV, 'DEVICE_CHECK_03_OWNER_EMAIL', '[١] اسم متغيّر البيئة المعلَن');

  // ═══ ٢ — وصف قيمة الحقل ونوعه ═══
  const d = B.describeFlagValue;
  deq(d(null), {present: false, type: 'absent', value: null, valuePrinted: false}, '[٢] مستند غائب: الحقل غائب');
  deq(d({}), {present: false, type: 'absent', value: null, valuePrinted: false}, '[٢] الحقل غائب');
  deq(d({evaluationEnabled: undefined}), {present: false, type: 'absent', value: null, valuePrinted: false}, '[٢] undefined = غائب');
  deq(d({evaluationEnabled: true}), {present: true, type: 'boolean', value: true, valuePrinted: true}, '[٢] true');
  deq(d({evaluationEnabled: false}), {present: true, type: 'boolean', value: false, valuePrinted: true}, '[٢] false');
  deq(d({evaluationEnabled: null}), {present: true, type: 'null', value: null, valuePrinted: true}, '[٢] null حاضر (≠ غائب)');
  deq(d({evaluationEnabled: 1}), {present: true, type: 'number', value: 1, valuePrinted: true}, '[٢] رقم 1');
  deq(d({evaluationEnabled: 'true'}), {present: true, type: 'string', value: 'true', valuePrinted: true}, '[٢] نصّ "true" قصير يُطبَع (نوعه string)');
  deq(d({evaluationEnabled: 'a b'}), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 3}, '[٢] نصّ بمسافة لا يُطبَع (طوله فقط)');
  deq(d({evaluationEnabled: 'x'.repeat(33)}), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 33}, '[٢] نصّ أطول من 32 لا يُطبَع');
  deq(d({evaluationEnabled: {k: 1}}), {present: true, type: 'object', value: null, valuePrinted: false}, '[٢] كائن: النوع وحده');
  deq(d({evaluationEnabled: [true]}), {present: true, type: 'array', value: null, valuePrinted: false}, '[٢] مصفوفة: النوع وحده');
  deq(d({evaluationEnabled: NaN}), {present: true, type: 'number', value: null, valuePrinted: false}, '[٢] NaN لا يُطبَع');

  // ═══ ٣ — كل سبب من الأسباب الخمسة المسمّاة، من المصدر الواحد ═══
  const R = EVALUATION_ENABLED_REASON;
  const cases = [
    ['مستند المستخدم غائب', undefined, R.OWNER_DOC_MISSING, false, {userDocExists: false, present: false, type: 'absent'}],
    ['العلم true', {evaluationEnabled: true}, R.FLAG_TRUE, true, {userDocExists: true, present: true, type: 'boolean', value: true}],
    ['العلم false', {evaluationEnabled: false}, R.FLAG_FALSE, false, {userDocExists: true, present: true, type: 'boolean', value: false}],
    ['العلم غائب', {plan: 'single'}, R.FLAG_ABSENT, false, {userDocExists: true, present: false, type: 'absent'}],
    ['العلم نصّ "true"', {evaluationEnabled: 'true'}, R.FLAG_NOT_BOOLEAN, false, {userDocExists: true, present: true, type: 'string', value: 'true'}],
    ['العلم رقم 1', {evaluationEnabled: 1}, R.FLAG_NOT_BOOLEAN, false, {userDocExists: true, present: true, type: 'number', value: 1}],
    ['العلم null', {evaluationEnabled: null}, R.FLAG_NOT_BOOLEAN, false, {userDocExists: true, present: true, type: 'null', value: null}],
    ['العلم خريطة', {evaluationEnabled: {on: true}}, R.FLAG_NOT_BOOLEAN, false, {userDocExists: true, present: true, type: 'object'}],
    ['العلم مصفوفة', {evaluationEnabled: [true]}, R.FLAG_NOT_BOOLEAN, false, {userDocExists: true, present: true, type: 'array'}],
  ];
  eq(new Set(cases.map((c) => c[2])).size, 5, '[٣] الحالات الخمس كلّها مغطّاة (السبب لكل حالة من EVALUATION_ENABLED_REASON)');
  for (const [name, userDoc, reason, decisionValue, expectFlag] of cases) {
    const db = makeMemDb(world(userDoc));
    const snap = await B.collectBefore({db, auth: authFor(), email: SECRET_EMAIL, nowMs: NOW});
    eq(snap.evaluationEnabled.decision.reason, reason, `[٣] ${name}: السبب ${reason}`);
    eq(snap.evaluationEnabled.decision.value, decisionValue, `[٣] ${name}: القيمة المُعادة لـjoinScanSession = ${decisionValue}`);
    const direct = evaluationEnabledDecision(userDoc === undefined ? null : userDoc);
    deq(snap.evaluationEnabled.decision, {value: direct.value, reason: direct.reason, valueType: direct.valueType}, `[٣] ${name}: القرار = evaluationEnabledDecision نفسها (لا نسخة منطق)`);
    for (const [k, v] of Object.entries(expectFlag)) deq(snap.evaluationEnabled[k], v, `[٣] ${name}: ${k}`);
    eq(snap.evaluationEnabled.decision.valueType !== null, reason === R.FLAG_NOT_BOOLEAN, `[٣] ${name}: valueType يُملأ مع FLAG_NOT_BOOLEAN وحدها`);
    deq(db.writeAttempts, [], `[٣] ${name}: لا كتابة`);
  }

  // ═══ ٤ — عدد تقارير الحساب بالدالّة المشتركة ═══
  {
    const db = makeMemDb(world({evaluationEnabled: true}));
    const snap = await B.collectBefore({db, auth: authFor(), email: SECRET_EMAIL, nowMs: NOW});
    eq(snap.reports.accountReportsCount, 3, '[٤] ثلاثة تقارير للحساب (تقرير حساب آخر لا يُعدّ)');
    eq(snap.reports.accountReportsCount, await S10.countAccountReports(db, SECRET_UID), '[٤] = s10PostDeploy.countAccountReports (دالّة واحدة)');
    eq(await C.countAccountReports(db, SECRET_UID), await S10.countAccountReports(db, SECRET_UID), '[٤] والمُصدَّرة من المكتبة المشتركة هي نفسها');
    const empty = makeMemDb({users: {[SECRET_UID]: {}}, reports: {}, scanSessions: {}, scanClaims: {}});
    eq((await B.collectBefore({db: empty, auth: authFor(), email: SECRET_EMAIL, nowMs: NOW})).reports.accountReportsCount, 0, '[٤] صفر تقارير: صفر مقيس (لا غياب)');
  }

  // ═══ ٥ — الجلسات = collectActive وsummarize نفسهما ═══
  {
    const db = makeMemDb(world({evaluationEnabled: true}));
    const snap = await B.collectBefore({db, auth: authFor(), email: SECRET_EMAIL, nowMs: NOW});
    const direct = A.summarize(await A.collectActive({db: makeMemDb(world({})), nowMs: NOW}), {claimsWindowMin: A.CLAIMS_WINDOW_MIN_DEFAULT, claimsWindowIsDefault: true});
    deq(snap.activeSessions.sessions, direct.sessions, '[٥] sessions = ناتج collectActive نفسه');
    deq(snap.activeSessions.claims, direct.claims, '[٥] claims = ناتج collectActive نفسه');
    deq(snap.activeSessions.criteria, direct.criteria, '[٥] criteria = ناتج summarize نفسه');
    eq(snap.activeSessions.sessions.byStatus.scanning.total, 1, '[٥] جلسة scanning واحدة');
    eq(snap.activeSessions.sessions.byStatus.scanning.IN_WINDOW, 1, '[٥] داخل النافذة');
    eq(snap.activeSessions.sessions.byStatus.pending.OLDER_THAN_WINDOW, 1, '[٥] pending قديمة: خارج النافذة');
    eq(snap.activeSessions.sessions.terminal.completed, 1, '[٥] completed نهائية');
    eq(snap.activeSessions.sessions.terminal.cancelled, 1, '[٥] cancelled نهائية');
    eq(snap.activeSessions.sessions.unclassified.statusUnknown, 1, '[٥] حالة لا تعرفها الأداة تُعلَن (لا تُعدّ «لا تمنع» بصمت)');
    deq(snap.activeSessions.sessions.unclassified.unknownNames, {'(unprintable)': 1}, '[٥] واسمها بحروف كبيرة (ليس snake_case) فلا يُطبَع: يُجمَع تحت (unprintable)');
    eq(snap.activeSessions.claims.inWindow, 1, '[٥] قفل حديث واحد');
    eq(snap.activeSessions.claims.inWindowWithReservation, 1, '[٥] وحجزه مُعلَن');
    eq(snap.activeSessions.claims.OLDER_THAN_WINDOW, 1, '[٥] وقفل قديم');
    eq(snap.activeSessions.verdict.blocksDeploy, true, '[٥] الحكم الموروث من المصدر: يمنع النشر (جلسة داخل النافذة)');
    const text = JSON.stringify(snap);
    ok(!/"(s[1-5]|c[12]|r[1-3x])"/.test(text) && !text.includes(SECRET_UID), '[٥] لا معرّف جلسة ولا قفل ولا تقرير ولا uid في المخرَج (أعداد وحدها)');
  }

  // ═══ ٦ — main ═══
  const run = async (argv, {env = ENV, db, auth = authFor()} = {}) => {
    const outs = [];
    const errs = [];
    const code = await main(argv, {env, now: () => NOW, db, auth, out: (s) => outs.push(s), err: (s) => errs.push(s)});
    return {code, outs, errs};
  };
  const secretIn = (...texts) => texts.some((t) => t && (t.includes(SECRET_EMAIL) || t.includes(SECRET_UID) || t.includes('owner.s10')));
  {
    const outPath = nextOut();
    const db = makeMemDb(world({evaluationEnabled: true}));
    const r = await run(['--out', outPath], {db});
    eq(r.code, 0, '[٦] النجاح: 0');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٦] UTF-8 بلا BOM');
    const text = bytes.toString('utf8');
    const j = JSON.parse(text);
    eq(Object.keys(j)[0], 'projectId', '[٦] projectId أوّل حقل');
    eq(j.projectId, 'neuralchek-9b6d7', '[٦] projectId المثبَّت');
    eq(j.mode, 'device-check-03-before', '[٦] mode');
    eq(j.schema, 1, '[٦] schema');
    ok(/^#[0-9a-f]{12}$/.test(j.account.accountHash), '[٦] المعرّف مُهشَّر (hashIdForLog)');
    eq(j.account.accountHash, C.hashIdForLog(SECRET_UID), '[٦] وهو تهشير uid الحساب');
    ok(!secretIn(text, r.outs.join('\n'), r.errs.join('\n')), '[٦] لا بريد ولا uid خامّ في الملفّ ولا stdout ولا stderr');
    ok(/^device-check-03 before written: accountHash=#[0-9a-f]{12} evaluationEnabled=true\(FLAG_TRUE\)/.test(r.outs[0]), `[٦] سطر الملخّص — ${r.outs[0]}`);
    deq(db.writeAttempts, [], '[٦] لا كتابة Firestore');
    const r2 = await run(['--out', outPath], {db});
    eq(r2.code, 2, '[٦] ملفّ موجود: لا استبدال (2)');
    ok(r2.errs.some((e) => /OUT_EXISTS/.test(e)), '[٦] والسبب OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), text, '[٦] والملفّ القائم لم يُمسّ');
  }
  {
    const r = await run(['--out', path.join(tmp, 'no-such-dir', 'x.json')], {db: makeMemDb(world({}))});
    eq(r.code, 2, '[٦] مجلّد المخرَج غائب: 2');
    ok(r.errs.some((e) => /OUT_DIR_MISSING/.test(e)), '[٦] OUT_DIR_MISSING');
    const noEnv = await run(['--out', nextOut()], {env: {}, db: makeMemDb(world({}))});
    eq(noEnv.code, 2, '[٦] بلا متغيّر البيئة: 2');
    ok(noEnv.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)), '[٦] OWNER_EMAIL_ENV_MISSING');
    const blank = await run(['--out', nextOut()], {env: {[C.OWNER_EMAIL_ENV]: '   '}, db: makeMemDb(world({}))});
    ok(blank.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)), '[٦] متغيّر فارغ = غائب');
    const invalid = await run(['--out', nextOut()], {env: {[C.OWNER_EMAIL_ENV]: 'not-an-email'}, db: makeMemDb(world({}))});
    ok(invalid.errs.some((e) => /OWNER_EMAIL_INVALID/.test(e)), '[٦] OWNER_EMAIL_INVALID');
    ok(!invalid.errs.join('\n').includes('not-an-email'), '[٦] ولا يُطبَع ما كُتب فيه');
    const notFound = await run(['--out', nextOut()], {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: makeMemDb(world({}))});
    eq(notFound.code, 2, '[٦] حساب غير موجود: 2');
    ok(notFound.errs.some((e) => /OWNER_ACCOUNT_NOT_FOUND \(code=auth\/user-not-found\)/.test(e)), '[٦] OWNER_ACCOUNT_NOT_FOUND');
    ok(!secretIn(notFound.errs.join('\n')) && !notFound.errs.join('\n').includes('other@example.test'), '[٦] نصّ خطأ المزوّد (يحمل البريد) لا يُطبَع');
    const authBoom = {getUserByEmail: async (email) => { throw Object.assign(new Error(`boom for ${email} token=SECRETTOKEN`), {code: 'auth/internal-error'}); }};
    const boom = await run(['--out', nextOut()], {db: makeMemDb(world({})), auth: authBoom});
    eq(boom.code, 2, '[٦] فشل Auth غير مسمّى: 2');
    ok(boom.errs.some((e) => /AUTH_LOOKUP_FAILED \(code=auth\/internal-error\)/.test(e)), '[٦] AUTH_LOOKUP_FAILED بالرمز وحده');
    ok(!boom.errs.join('\n').includes('SECRETTOKEN') && !secretIn(boom.errs.join('\n')), '[٦] لا نصّ خطأ ولا بريد (القاعدة 36)');
    const noUid = await run(['--out', nextOut()], {db: makeMemDb(world({})), auth: {getUserByEmail: async () => ({})}});
    ok(noUid.errs.some((e) => /AUTH_LOOKUP_FAILED \(code=NO_UID\)/.test(e)), '[٦] ردّ Auth بلا uid: AUTH_LOOKUP_FAILED NO_UID');
    const badArgs = await run(['--email', 'x@y.z']);
    eq(badArgs.code, 2, '[٦] وسيط مجهول: 2');
    const pf = await run(['--preflight']);
    eq(pf.code, 0, '[٦] --preflight: 0 بلا شبكة ولا db');
    const pfj = JSON.parse(pf.outs.join('\n'));
    deq([pfj.mode, pfj.network, pfj.readOnly, pfj.ok, pfj.ownerEmailEnvPresent], ['preflight', false, true, true, true], '[٦] preflight: بلا شبكة، قراءة فقط، المتغيّر مضبوط (حضوره فقط)');
    ok(!secretIn(pf.outs.join('\n')), '[٦] preflight لا يطبع البريد');
    const pf2 = JSON.parse((await run(['--preflight'], {env: {}})).outs.join('\n'));
    eq(pf2.ownerEmailEnvPresent, false, '[٦] preflight: المتغيّر غير مضبوط يُقال صراحةً');
  }

  // ═══ ٧ — الغلاف ═══
  {
    const {auth} = C.initReadOnlyAdmin({appName: 'dc03-before-unit-app', withAuth: true});
    deq(Object.keys(auth), ['getUserByEmail'], '[٧] Auth المعروضة عملية واحدة: getUserByEmail');
    ok(Object.isFrozen(auth), '[٧] مجمَّدة (لا إضافة عملية لاحقاً)');
    eq(auth.updateUser, undefined, '[٧] لا updateUser');
    eq(auth.deleteUser, undefined, '[٧] ولا deleteUser');
    const calls = [];
    const fakeFile = {exists: async () => { calls.push('exists'); return [true]; }, download: async (o) => { calls.push(`download:${JSON.stringify(o)}`); return [Buffer.from('x')]; }, getMetadata: async () => { calls.push('meta'); return [{}]; },
      save: async () => { calls.push('SAVE'); }, delete: async () => { calls.push('DELETE'); }, createWriteStream: () => { calls.push('WS'); }};
    const bucket = C.wrapReadOnlyBucket({file: () => fakeFile, upload: async () => { calls.push('UPLOAD'); }});
    deq(Object.keys(bucket), ['file'], '[٧] bucket: file وحدها');
    const f = bucket.file('p');
    deq(Object.keys(f).sort(), ['download', 'exists', 'getMetadata'], '[٧] ملفّ: exists وdownload وgetMetadata وحدها');
    await f.exists(); await f.download({decompress: false}); await f.getMetadata();
    deq(calls, ['exists', 'download:{"decompress":false}', 'meta'], '[٧] القراءات تمرّ');
    let t = null;
    try { await f.download({destination: '/tmp/x'}); } catch (e) { t = e; }
    ok(t && /^TRAP: .*destination/.test(t.message), '[٧] download({destination}) يرمي TRAP (الكتابة على القرص)');
    eq(calls.length, 3, '[٧] ولم يصل النداء الممنوع إلى الملفّ');
    for (const op of ['save', 'delete', 'createWriteStream', 'move', 'copy', 'setMetadata']) eq(typeof f[op], 'undefined', `[٧] لا ${op} على الملفّ`);
    eq(typeof bucket.upload, 'undefined', '[٧] ولا upload على الـbucket');
  }

  fs.rmSync(tmp, {recursive: true, force: true}); // ملفّات الاختبار المؤقّتة وحدها
  console.log(`\ndeviceCheck03Before.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});
