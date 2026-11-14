'use strict';

// emulatorOnlyGuard.test.js — يثبت الحارس المشترك functions/test/lib/emulatorOnlyGuard.js (V8 قبل النشر، 2026-10-09 +03). بلا محاكٍ وبلا شبكة:
// عمليات فرعية ببيئة مُنقّاة (لا اعتماد ADC، ولا مجلّد منزل حقيقي، ولا متغيّر FIREBASE_*) تُشغَّل فيها ملفّات الاختبار الحقيقية.
//
// قرار المستخدم (بنصّه): «لا يعمل أيّ اختبار يحذف إلا إذا كان FIRESTORE_EMULATOR_HOST مضبوطاً، والمشروع مشروع اختبار لا neuralchek-9b6d7،
// وإلا يتوقّف قبل أيّ نداء. واختبار يثبت الحارس.» والمطلوب: عملية فرعية لكل حالة رفض تخرج قبل أيّ نداء؛ وحالة القبول تمرّ.
//   ١ — المصدر الواحد: PRODUCTION_PROJECT_ID = .firebaserc (default)، وadmin.js يستدعي initializeApp() بلا projectId (المرجع الواقع).
//   ٢ — المنطق (emulatorEnvProblems) على جدول بيئات: القبول، وكل صنف رفض، وتركيبات.
//   ٣ — الاستيراد الحقيقي في عملية فرعية: الرفض يخرج برمز 2 قبل أن يُحمَّل firebase-admin؛ والقبول يمرّ ويُحمَّل.
//   ٤ — كل ملفّ من الجرد (WRITERS) يُشغَّل فعلاً في عملية فرعية بأربع بيئات معادية فيخرج برمز 2 برسالة الصنف الصحيح، بلا أيّ اتصال.
//
// Run: node functions/test/emulatorOnlyGuard.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const core = require('./lib/emulatorGuardCore');
const {inventory, REPO_ROOT} = require('./lib/emulatorGuardInventory');
const {PRODUCTION_PROJECT_ID, PROBLEM, emulatorEnvProblems, assertEmulatorOnly} = core;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const GUARD_ABS = path.join(__dirname, 'lib', 'emulatorOnlyGuard.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'emu-guard-'));
const EMPTY_HOME = path.join(TMP, 'home');
fs.mkdirSync(EMPTY_HOME);

// ═══════════════════════════════════════════════════════════════════
// ١ — المصدر الواحد والمرجع الواقع
// ═══════════════════════════════════════════════════════════════════
eq(PRODUCTION_PROJECT_ID, 'neuralchek-9b6d7', '[١] PRODUCTION_PROJECT_ID');
const firebaserc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.firebaserc'), 'utf8'));
eq(firebaserc.projects.default, PRODUCTION_PROJECT_ID, '[١] مشروع .firebaserc الافتراضي = PRODUCTION_PROJECT_ID (إن تغيّر أحدهما انكسر هذا — فلا يصير الحارس يحرس مشروعاً قديماً)');
const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'admin.js'), 'utf8');
ok(/admin\.initializeApp\(\)/.test(adminSrc) && !/projectId/.test(adminSrc), '[١] admin.js يستدعي initializeApp() بلا projectId (فمشروع التطبيق يُستنتج من البيئة وحدها — لذلك يفحصها الحارس)');
ok(core.PROJECT_ENV_VARS.includes('GCLOUD_PROJECT') && core.PROJECT_ENV_VARS.includes('GOOGLE_CLOUD_PROJECT'), '[١] مصادر المشروع في البيئة: GCLOUD_PROJECT وGOOGLE_CLOUD_PROJECT (+ FIREBASE_CONFIG)');

// ═══════════════════════════════════════════════════════════════════
// ٢ — المنطق: جدول بيئات
// ═══════════════════════════════════════════════════════════════════
const goodCfg = JSON.stringify({projectId: 'demo-nc', storageBucket: 'demo-nc.appspot.com', databaseURL: 'https://demo-nc.firebaseio.com'}); // الشكل المقيس من emulators:exec --project demo-nc
const prodCfg = JSON.stringify({projectId: PRODUCTION_PROJECT_ID, storageBucket: `${PRODUCTION_PROJECT_ID}.appspot.com`, databaseURL: `https://${PRODUCTION_PROJECT_ID}.firebaseio.com`}); // المقيس بلا --project
const cfgFileGood = path.join(TMP, 'good.json');
const cfgFileProd = path.join(TMP, 'prod.json');
fs.writeFileSync(cfgFileGood, goodCfg);
fs.writeFileSync(cfgFileProd, prodCfg);
const H = '127.0.0.1:8080';
const ROWS = [
  // [env, problems المنتظرة (مرتَّبة), وصف]
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc'}, [], 'قبول: محلّي + GCLOUD_PROJECT اختبار'],
  [{FIRESTORE_EMULATOR_HOST: 'localhost:9090', GOOGLE_CLOUD_PROJECT: 'demo-x'}, [], 'قبول: localhost بمنفذ آخر + GOOGLE_CLOUD_PROJECT'],
  [{FIRESTORE_EMULATOR_HOST: '[::1]:8080', FIREBASE_CONFIG: '{"projectId":"demo-nc"}'}, [], 'قبول: [::1] + FIREBASE_CONFIG وحده'],
  [{FIRESTORE_EMULATOR_HOST: '127.0.0.1', GCLOUD_PROJECT: 'demo-nc'}, [], 'قبول: بلا منفذ'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: goodCfg}, [], 'قبول: الشكل المقيس من emulators:exec --project demo-nc'],
  [{FIRESTORE_EMULATOR_HOST: H, FIREBASE_CONFIG: cfgFileGood}, [], 'قبول: FIREBASE_CONFIG مسار ملفّ JSON (كما تقبله SDK)'],
  [{GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_MISSING], 'رفض: FIRESTORE_EMULATOR_HOST غير مضبوط'],
  [{FIRESTORE_EMULATOR_HOST: '   ', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_MISSING], 'رفض: المضيف فراغ'],
  [{FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: مضيف Google'],
  [{FIRESTORE_EMULATOR_HOST: '10.0.0.5:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: عنوان شبكة داخلية'],
  [{FIRESTORE_EMULATOR_HOST: '127.0.0.1.evil.com:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: نطاق يبدأ بـ127.0.0.1'],
  [{FIRESTORE_EMULATOR_HOST: 'localhost.evil.com:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: نطاق يبدأ بـlocalhost'],
  [{FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080,evil.com:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: قائمة مضيفين'],
  [{FIRESTORE_EMULATOR_HOST: 'http://127.0.0.1:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: بمخطّط URL'],
  [{FIRESTORE_EMULATOR_HOST: '0.0.0.0:8080', GCLOUD_PROJECT: 'demo-nc'}, [PROBLEM.HOST_NOT_LOCAL], 'رفض: 0.0.0.0'],
  [{FIRESTORE_EMULATOR_HOST: H}, [PROBLEM.PROJECT_ABSENT], 'رفض: لا مشروع في أيّ مصدر'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: '  ', GOOGLE_CLOUD_PROJECT: ''}, [PROBLEM.PROJECT_ABSENT], 'رفض: مصادر المشروع فارغة'],
  [{FIRESTORE_EMULATOR_HOST: H, FIREBASE_CONFIG: '{"storageBucket":"x"}'}, [PROBLEM.PROJECT_ABSENT], 'رفض: FIREBASE_CONFIG بلا projectId'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: PRODUCTION_PROJECT_ID}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: GCLOUD_PROJECT = الإنتاج'],
  [{FIRESTORE_EMULATOR_HOST: H, GOOGLE_CLOUD_PROJECT: PRODUCTION_PROJECT_ID}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: GOOGLE_CLOUD_PROJECT = الإنتاج'],
  [{FIRESTORE_EMULATOR_HOST: H, FIREBASE_CONFIG: prodCfg}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: FIREBASE_CONFIG.projectId = الإنتاج'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: prodCfg}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: أيّ مصدر يكفي (GCLOUD_PROJECT اختبار وFIREBASE_CONFIG إنتاج)'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: `  ${PRODUCTION_PROJECT_ID.toUpperCase()} `}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: بحروف كبيرة ومسافات'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: cfgFileProd}, [PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: FIREBASE_CONFIG مسار ملفّ مشروعه الإنتاج'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: PRODUCTION_PROJECT_ID, FIREBASE_CONFIG: prodCfg}, [PROBLEM.PROJECT_IS_PRODUCTION, PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: الحالة المقيسة بلا --project (المصدران إنتاج) — مشكلتان'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: '{bad json'}, [PROBLEM.CONFIG_UNREADABLE], 'رفض: FIREBASE_CONFIG JSON تالف (فلا يُعرف مشروعه)'],
  [{FIRESTORE_EMULATOR_HOST: H, FIREBASE_CONFIG: path.join(TMP, 'no-such-config.json')}, [PROBLEM.CONFIG_UNREADABLE], 'رفض: FIREBASE_CONFIG مسار غير موجود'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: '[1]'}, [PROBLEM.CONFIG_UNREADABLE], 'رفض: FIREBASE_CONFIG ليس كائناً'],
  [{GCLOUD_PROJECT: PRODUCTION_PROJECT_ID}, [PROBLEM.HOST_MISSING, PROBLEM.PROJECT_IS_PRODUCTION], 'رفض: مشكلتان معاً (بلا محاكٍ + مشروع الإنتاج) — تُطبعان كلتاهما'],
  [{}, [PROBLEM.HOST_MISSING, PROBLEM.PROJECT_ABSENT], 'رفض: بيئة فارغة'],
];
for (const [env, expected, label] of ROWS) {
  const r = emulatorEnvProblems(env);
  deq(r.problems.map((p) => p.code).sort(), [...expected].sort(), `[٢] ${label}`);
}
ok(ROWS.filter(([, e]) => e.length === 0).length >= 5 && ROWS.filter(([, e]) => e.length > 0).length >= 20, '[٢] الجدول يحمل حالات قبول وحالات رفض معاً');
for (const code of Object.values(PROBLEM)) ok(ROWS.some(([, e]) => e.includes(code)), `[٢] كل صنف رفض له صفّ في الجدول: ${code}`);

// assertEmulatorOnly: الخروج برمز 2 يُحقَن؛ والقبول لا يستدعيه
{
  const errors = [];
  const realErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const exits = [];
  assertEmulatorOnly({GCLOUD_PROJECT: PRODUCTION_PROJECT_ID}, (c) => exits.push(c));
  const accepted = [];
  assertEmulatorOnly({FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc'}, (c) => accepted.push(c));
  console.error = realErr;
  deq(exits, [2], '[٢] الرفض يستدعي الخروج برمز 2');
  deq(accepted, [], '[٢] القبول لا يستدعي الخروج');
  ok(errors[0].startsWith('REFUSING TO RUN') && errors.some((l) => l.includes(PROBLEM.HOST_MISSING)) && errors.some((l) => l.includes(PROBLEM.PROJECT_IS_PRODUCTION)), '[٢] الرسالة تبدأ بـREFUSING TO RUN وتسمّي كل مشكلة');
  ok(!errors.join('\n').includes(goodCfg) && !errors.join('\n').includes('storageBucket'), '[٢] ولا تطبع محتوى FIREBASE_CONFIG');
}

// ═══════════════════════════════════════════════════════════════════
// ٣ — الاستيراد الحقيقي في عملية فرعية: يخرج قبل أن يُحمَّل firebase-admin
// ═══════════════════════════════════════════════════════════════════
const FIREBASE_ADMIN_ABS = require.resolve('firebase-admin', {paths: [path.join(__dirname, '..')]});
const CHILD = path.join(TMP, 'child-import-guard.js');
fs.writeFileSync(CHILD, [
  'const Module = require("module");',
  'const loaded = [];',
  'const orig = Module._load;',
  'Module._load = function (request) { loaded.push(request); return orig.apply(this, arguments); };',
  'process.on("exit", () => { process.stderr.write("LOADED_FIREBASE_ADMIN=" + loaded.some((r) => /firebase-admin/.test(r)) + "\\n"); });',
  `require(${JSON.stringify(GUARD_ABS)});`,
  'process.stdout.write("AFTER_GUARD\\n");',
  `require(${JSON.stringify(FIREBASE_ADMIN_ABS)});`,
  'process.stdout.write("AFTER_ADMIN\\n");',
].join('\n'));

function scrubbedEnv(extra) {
  const base = {};
  for (const k of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT']) if (process.env[k] !== undefined) base[k] = process.env[k];
  Object.assign(base, {
    HOME: EMPTY_HOME, USERPROFILE: EMPTY_HOME, APPDATA: EMPTY_HOME, LOCALAPPDATA: EMPTY_HOME, CLOUDSDK_CONFIG: EMPTY_HOME,
    GOOGLE_APPLICATION_CREDENTIALS: path.join(EMPTY_HOME, 'no-such-credentials.json'), // لا اعتماد ADC حتى لو فاتَ حارسٌ ملفّاً
  });
  return {...base, ...extra};
}
function spawnNode(file, env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], {env: scrubbedEnv(env), encoding: 'utf8', timeout: 30000, cwd: REPO_ROOT, windowsHide: true});
  return {status: r.status, signal: r.signal, stdout: r.stdout || '', stderr: r.stderr || '', ms: Date.now() - t0, error: r.error};
}

const REJECT_ENVS = [
  [{GCLOUD_PROJECT: 'demo-nc'}, PROBLEM.HOST_MISSING, 'بلا FIRESTORE_EMULATOR_HOST'],
  [{FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443', GCLOUD_PROJECT: 'demo-nc'}, PROBLEM.HOST_NOT_LOCAL, 'مضيف غير محلّي'],
  [{FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: PRODUCTION_PROJECT_ID}, PROBLEM.PROJECT_IS_PRODUCTION, 'مشروع الإنتاج'],
  [{FIRESTORE_EMULATOR_HOST: H}, PROBLEM.PROJECT_ABSENT, 'بلا مشروع'],
];
for (const [env, code, label] of REJECT_ENVS) {
  const r = spawnNode(CHILD, env);
  eq(r.status, 2, `[٣] ${label}: الخروج برمز 2`);
  ok(r.stderr.includes('REFUSING TO RUN') && r.stderr.includes(code), `[٣] ${label}: الرسالة تسمّي ${code}`);
  ok(!r.stdout.includes('AFTER_GUARD') && !r.stdout.includes('AFTER_ADMIN'), `[٣] ${label}: لم يمرّ سطر بعد الاستيراد`);
  ok(r.stderr.includes('LOADED_FIREBASE_ADMIN=false'), `[٣] ${label}: لم يُحمَّل firebase-admin قبل الخروج (قبل أيّ تهيئة وأيّ نداء)`);
}
{
  const r = spawnNode(CHILD, {FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc'});
  eq(r.status, 0, '[٣] القبول: الخروج برمز 0');
  ok(r.stdout.includes('AFTER_GUARD') && r.stdout.includes('AFTER_ADMIN'), '[٣] القبول: يمرّ بعد الحارس ويُحمَّل firebase-admin (فالعلامة في الحالة السابقة ذات معنى)');
  ok(r.stderr.includes('LOADED_FIREBASE_ADMIN=true') && !r.stderr.includes('REFUSING'), '[٣] القبول: بلا رسالة رفض');
}
{
  const r = spawnNode(CHILD, {FIRESTORE_EMULATOR_HOST: H, GCLOUD_PROJECT: 'demo-nc', FIREBASE_CONFIG: goodCfg});
  eq(r.status, 0, '[٣] القبول بالشكل المقيس (GCLOUD_PROJECT + FIREBASE_CONFIG): الخروج برمز 0');
}

// ═══════════════════════════════════════════════════════════════════
// ٤ — كل ملفّ من الجرد يُشغَّل فعلاً ببيئات معادية: يخرج برمز 2 قبل أيّ نداء
// ═══════════════════════════════════════════════════════════════════
const inv = inventory();
ok(inv.writers.length >= 25, `[٤] الجرد بالأداة: ${inv.writers.length} ملفّاً (WRITERS) من ${inv.scanned} ملفّاً مفحوصاً، منها ${inv.deleters.length} يحذف`);
const notFirst = inv.rows.filter((r) => r.writer && !(r.guard.imported && r.guard.first));
deq(notFirst.map((r) => r.file), [], '[٤] لا ملفّ من الجرد بلا الحارس أوّلاً (وإلا لا يُشغَّل هنا: لا نُشغّل ملفّاً قد يصل إلى Firestore حقيقي)');
let spawned = 0;
for (const row of inv.rows.filter((r) => r.writer && r.guard.imported && r.guard.first)) {
  const abs = path.join(REPO_ROOT, row.file);
  for (const [env, code, label] of REJECT_ENVS) {
    const r = spawnNode(abs, env);
    spawned++;
    eq(r.status, 2, `[٤] ${row.file} — ${label}: خرج برمز 2`);
    ok(r.stderr.includes('REFUSING TO RUN') && r.stderr.includes(code), `[٤] ${row.file} — ${label}: الرسالة تسمّي ${code}`);
    ok(r.stdout.trim() === '', `[٤] ${row.file} — ${label}: لم يكتب الاختبار شيئاً (لم يبدأ)`);
    ok(r.ms < 20000 && !r.error, `[٤] ${row.file} — ${label}: خرج فوراً (${r.ms}ms) لا بانتظار اتصال`);
  }
}
eq(spawned, inv.writers.length * REJECT_ENVS.length, `[٤] ${inv.writers.length} ملفّاً × ${REJECT_ENVS.length} بيئات معادية = ${spawned} عملية فرعية`);

try { fs.rmSync(TMP, {recursive: true, force: true}); } catch (e) { /* مجلّد مؤقّت */ }
console.log(`\nemulatorOnlyGuard.test.js: ${n}/${n} assertions passed (writers=${inv.writers.length}, deleters=${inv.deleters.length}, scanned=${inv.scanned}, spawned=${spawned})`);
