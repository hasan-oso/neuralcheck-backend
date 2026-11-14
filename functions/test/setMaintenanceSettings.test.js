'use strict';

// setMaintenanceSettings.test.js — أداة set-maintenance-settings.js (معاينة/كتابة/تراجع لإعداد الصيانة: openBeforeValidityHours = 72 وجزآ purposes وbatteryBeforeAfter لمحلّ واحد). بلا شبكة ولا محاكٍ (db في الذاكرة: lib/pairFakeDb.js).
//
// القرار (حسن، 2026-10-22، منقول عن أمر المنسّق بنصّه، غير متحقَّق من هذا المستودع): «طريقة الكتابة: كتلة PowerShell واحدة بمعاينة قراءة فقط ثم الكتابة ثم تراجع. لا صفحات /admin/protocol ولا Console يدوي.»
// «ما تكتبه فقط: openBeforeValidityHours = 72، وتفعيل جزأي purposes وbatteryBeforeAfter لمحلّ واحد. لا حقل غيرهما، ولا محلّ غيره. … (هـ) قراءة بعدية تثبت أن الحقلين فقط تغيّرا … (و) كتلة تراجع منفصلة تعيد القيم السابقة بالإلحاق لا الحذف.»
// الأمر (المنسّق): الأداة تكتب بـfirebase-admin وADC وتستعمل الدوالّ النقيّة نفسها (settingsWrite/protocolSettings/shopProtocol) والمعاملة نفسها؛ updatedBy = hashIdForLog(وسم ثابت)؛ المعاينة قراءة وحدها؛ الكتابة بنصّ تأكيد ثابت وملفّ تراجع يُكتب قبلها؛ ثم قراءة بعدية وفرق.
//
// **هذا الملفّ يعدّ الإخفاق ولا يرمي عند أول واحد** (كُتب قبل الأداة؛ القاعدتان 18 و23): كل قيد t(...) مستقلّ، والاستثناء داخله إخفاق واحد.
//
//   ١ الثوابت (مصدر واحد: القاعدة 24)           ٢ الوسائط            ٣ البيئة والمشروع (لا إنتاج بلا إنتاج، ولا محاكٍ بلا --emulator)
//   ٤ المعاينة: صفر كتابة، قناع حقول، لا بيانات خاصّة، ترتيب حتمي، سقف، الخطّة   ٥ الكتابة: التأكيد، الحلّ، ملفّ التراجع قبلها، المستندان بالضبط، غير المتغيّر، الفرق غير المتوقَّع
//   ٦ التراجع: القيم السابقة بالإلحاق، ABSENT، التحقّق من الملفّ   ٧ بنية المصدر: لا حذف، لا تسرّب، لا خارج المسموح، ولا ربط بـsrc
//
// Run: node functions/test/setMaintenanceSettings.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FN = path.join(__dirname, '..');
const SCRIPT = path.join(FN, 'scripts', 'set-maintenance-settings.js');
const LIB = path.join(FN, 'scripts', 'lib', 'maintenanceSettings.js');

let n = 0;
const failures = [];
const T = async (label, fn) => {
  n++;
  try { await fn(); } catch (e) { failures.push(`${label} — ${String((e && e.message) || e).split('\n')[0].slice(0, 240)}`); }
};
const eq = (a, b, m) => assert.strictEqual(a, b, m);
const deq = (a, b, m) => assert.deepStrictEqual(a, b, m);
const ok = (c, m) => assert.ok(c, m);

const {makePairDb, FieldValue, ts} = require('./lib/pairFakeDb');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {PROTOCOL_PART, PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH} = require('../src/protocol/protocolVocabulary');
const {SETTINGS_FIELD} = require('../src/protocol/protocolSettings');
const {SETTINGS_LIMITS, validateSettingsPatch} = require('../src/protocol/settingsWrite');

let L = null;
let TOOL = null;
let loadError = null;
try { L = require(LIB); TOOL = require(SCRIPT); } catch (e) { loadError = e; }
const need = (x, what) => { if (x === undefined || x === null) throw new Error(`${what} غير موجود${loadError ? ` (تحميل الأداة فشل: ${loadError.code || loadError.name})` : ''}`); return x; };

const NOW = 1_800_000_000_000;
const PROJECT = 'neuralchek-9b6d7';
const SETTINGS_COL = PROTOCOL_COLLECTION.PROTOCOL_SETTINGS;
const CUR = PROTOCOL_SETTINGS_PATH.CURRENT_DOC;
const HIST_COL = `${SETTINGS_COL}/${CUR}/${PROTOCOL_SETTINGS_PATH.HISTORY_SUBCOLLECTION}`;
const ACTOR = hashIdForLog('script:set-maintenance-settings');
const PH = PROTOCOL_PART;

// قيم مميَّزة تُبحث في كل المخرَج: لا يجوز ظهور بريد ولا هاتف ولا uid خامّ ولا حقل خاصّ آخر
const PRIVATE = {
  emailA: 'owner-a.private@example.test', phoneA: '+905550010001', uidA: 'uid-shop-aaaaaaaaaaaaaaaaaaaa',
  emailB: 'owner-b.private@example.test', phoneB: '+905550010002', uidB: 'uid-shop-bbbbbbbbbbbbbbbbbbbb',
  emailC: 'owner-c.private@example.test', phoneC: '+905550010003', uidC: 'uid-shop-cccccccccccccccccccc',
  token: 'FCM-TOKEN-PRIVATE-9f3a', plan: 'plan-private-xyz',
};
const NAME_A = 'محلّ النور';
const userA = (over = {}) => ({name: NAME_A, displayName: 'Ahmad Private Display', type: 'shop', email: PRIVATE.emailA, phone: PRIVATE.phoneA, plan: 'shop_pro', isActive: true, expiresAt: ts(NOW + 86400000), scansRemaining: 30, scansTotal: 50, fcmToken: PRIVATE.token, lastLoginAt: ts(NOW - 5000), ...over});
const userB = (over = {}) => ({name: '', displayName: 'Display B', type: 'individual', email: PRIVATE.emailB, phone: PRIVATE.phoneB, plan: PRIVATE.plan, isActive: true, protocolParts: {purposes: true, batteryBeforeAfter: 'yes', coldRepeat: false}, ...over});
const userC = (over = {}) => ({type: 'shop', email: PRIVATE.emailC, phone: PRIVATE.phoneC, ...over});
const SETTINGS_V3 = (over = {}) => ({version: 3, repeatRate: 0.1, doubleEvalRate: 0.05, collectionPhase: true, updatedAt: ts(NOW - 100000), updatedBy: '#aaaaaaaaaaaa', ...over});
const world = (over = {}) => ({
  users: {[PRIVATE.uidA]: userA(), [PRIVATE.uidB]: userB(), [PRIVATE.uidC]: userC()},
  [SETTINGS_COL]: {[CUR]: SETTINGS_V3()},
  reports: {'scan-1': {userId: PRIVATE.uidA, deviceModel: 'X'}},
  ...over,
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-maintenance-settings-test-'));
let fileSeq = 0;
const newFile = () => path.join(tmpDir, `rollback-${++fileSeq}.json`);
const PROD_ENV = {};
const EMU_ENV = {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-nc'};

/** يشغّل main بـdb في الذاكرة ويلتقط stdout/stderr. */
async function run(argv, {seed = world(), env = PROD_ENV, db = null, io = {}} = {}) {
  const theDb = db || makePairDb(seed, {now: NOW});
  const out = [];
  const err = [];
  const code = await need(TOOL, 'الأداة').main(argv, {db: theDb, FieldValue, env, out: (s) => out.push(s), err: (s) => err.push(s), now: () => NOW, ...io});
  return {code, out, err, db: theDb, text: [...out, ...err].join('\n'), line: (prefix) => out.filter((l) => l.startsWith(prefix))};
}
const WRITE_ARGS = (shop, file, extra = []) => ['--mode', 'write', '--shop', shop, '--confirm', need(L, 'المكتبة').CONFIRM_WRITE, '--rollback-file', file, ...extra];
const ROLLBACK_ARGS = (file, extra = []) => ['--mode', 'rollback', '--confirm', need(L, 'المكتبة').CONFIRM_ROLLBACK, '--rollback-file', file, ...extra];
const noPrivate = (text, label) => { for (const [k, v] of Object.entries(PRIVATE)) ok(!text.includes(v), `${label}: ظهر ${k} في المخرَج`); };
const snapshotOf = (db) => JSON.parse(JSON.stringify(db.store, (k, v) => (v && typeof v.toMillis === 'function' ? {__ts: v.toMillis()} : v)));
const writeCountOf = (db) => db.writes.length + db.batches.length;
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1').replace(/^#!.*$/m, '');
const readSrc = (f) => strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
const SRC = {script: () => readSrc(SCRIPT), lib: () => readSrc(LIB)};

(async () => {
  // ═══ ١ — الثوابت ═══
  await T('[١] CONFIRM_WRITE نصّ ASCII واحد بلا مسافات', () => { eq(L.CONFIRM_WRITE, 'WRITE-MAINTENANCE-SETTINGS'); ok(/^[\x21-\x7E]+$/.test(L.CONFIRM_WRITE), 'ليس ASCII مرئياً'); });
  await T('[١] CONFIRM_ROLLBACK نصّ ASCII آخر مختلف', () => { eq(L.CONFIRM_ROLLBACK, 'ROLLBACK-MAINTENANCE-SETTINGS'); ok(/^[\x21-\x7E]+$/.test(L.CONFIRM_ROLLBACK), 'ليس ASCII'); ok(L.CONFIRM_ROLLBACK !== L.CONFIRM_WRITE, 'متطابقان'); });
  await T('[١] 72 يمرّ بمُحقِّق settingsWrite نفسه وفي مداه المُصدَّر (لا نسخة رقم)', () => {
    eq(L.MAINTENANCE_HOURS, 72);
    const v = validateSettingsPatch({[SETTINGS_FIELD.OPEN_BEFORE_VALIDITY_HOURS]: L.MAINTENANCE_HOURS});
    ok(v.ok === true, 'رُفضت');
    ok(L.MAINTENANCE_HOURS >= SETTINGS_LIMITS.openBeforeValidityHours.min && L.MAINTENANCE_HOURS <= SETTINGS_LIMITS.openBeforeValidityHours.max, 'خارج المدى');
  });
  await T('[١] الجزآن من PROTOCOL_PART وحده (purposes وbatteryBeforeAfter)', () => { deq([...L.MAINTENANCE_PARTS], [PH.PURPOSES, PH.BATTERY_BEFORE_AFTER]); deq([...L.MAINTENANCE_PARTS], ['purposes', 'batteryBeforeAfter']); ok(Object.isFrozen(L.MAINTENANCE_PARTS), 'غير مجمَّدة'); });
  await T('[١] وسم الفاعل مُصدَّر وupdatedBy = hashIdForLog(الوسم)', () => { eq(L.ACTOR_TAG, 'script:set-maintenance-settings'); eq(L.UPDATED_BY, ACTOR); ok(/^#[0-9a-f]{12}$/.test(L.UPDATED_BY), 'شكل'); });
  await T('[١] المشروع المثبَّت = .firebaserc الافتراضي', () => {
    const rc = JSON.parse(fs.readFileSync(path.join(FN, '..', '.firebaserc'), 'utf8'));
    eq(L.PROJECT_ID, rc.projects.default);
    eq(L.PROJECT_ID, PROJECT);
  });
  await T('[١] أكواد الخروج المسمّاة', () => deq({...L.EXIT}, {OK: 0, USAGE: 2, DIFF_UNEXPECTED: 3, REFUSED: 4, ENVIRONMENT: 5, UNDETERMINED: 6}));
  await T('[١] سقف مسح المحالّ 5000 وغياب الاسم «(بلا اسم)»', () => { eq(L.SHOP_SCAN_CAP, 5000); eq(L.NO_NAME, '(بلا اسم)'); });

  // ═══ ٢ — الوسائط ═══
  const P = (argv) => need(L, 'المكتبة').parseArgs(argv);
  await T('[٢] --help', () => eq(P(['--help']).help, true));
  for (const [label, argv, reason] of [
    ['بلا وسيط', [], 'MODE_REQUIRED'],
    ['mode مجهول', ['--mode', 'delete'], 'MODE_INVALID'],
    ['وسيط مجهول', ['--mode', 'preview', '--force'], 'UNKNOWN_ARGUMENT'],
    ['صيغة = غير مقبولة', ['--mode=preview'], 'UNKNOWN_ARGUMENT'],
    ['وسيط موضعي', ['preview'], 'UNKNOWN_ARGUMENT'],
    ['mode مكرَّر', ['--mode', 'preview', '--mode', 'preview'], 'DUPLICATE_ARGUMENT'],
    ['--shop بلا قيمة', ['--mode', 'preview', '--shop'], 'VALUE_MISSING'],
    ['--shop وقيمته علَم (لا تُبتلع القيمة)', ['--mode', 'preview', '--shop', '--ascii-names'], 'VALUE_MISSING'],
    ['--emulator مكرَّر (حتى المنطقي)', ['--mode', 'preview', '--emulator', '--emulator'], 'DUPLICATE_ARGUMENT'],
    ['--ascii-names مكرَّر', ['--mode', 'preview', '--ascii-names', '--ascii-names'], 'DUPLICATE_ARGUMENT'],
    ['preview مع --confirm', ['--mode', 'preview', '--confirm', 'X'], 'NOT_APPLICABLE'],
    ['preview مع --rollback-file', ['--mode', 'preview', '--rollback-file', 'f.json'], 'NOT_APPLICABLE'],
    ['write بلا --shop', ['--mode', 'write', '--confirm', 'X', '--rollback-file', 'f.json'], 'SHOP_REQUIRED'],
    ['write بلا --rollback-file', ['--mode', 'write', '--shop', 'a', '--confirm', 'X'], 'ROLLBACK_FILE_REQUIRED'],
    ['rollback بلا --rollback-file', ['--mode', 'rollback', '--confirm', 'X'], 'ROLLBACK_FILE_REQUIRED'],
    ['rollback مع --shop (المحلّ من الملفّ)', ['--mode', 'rollback', '--rollback-file', 'f.json', '--confirm', 'X', '--shop', 'a'], 'NOT_APPLICABLE'],
  ]) {
    await T(`[٢] ${label} ⟵ ${reason}`, () => {
      let thrown = null;
      try { P(argv); } catch (e) { thrown = e; }
      ok(thrown !== null, 'لم يُرمَ');
      eq(thrown.reason, reason);
    });
  }
  await T('[٢] write بلا --confirm يُقبل تحليلاً (يُرفض لاحقاً برفض مسمّى لا بخطأ استعمال)', () => { const a = P(['--mode', 'write', '--shop', 's', '--rollback-file', 'f.json']); eq(a.confirm, null); eq(a.mode, 'write'); });
  await T('[٢] preview + --shop + --ascii-names', () => { const a = P(['--mode', 'preview', '--shop', '#0123456789ab', '--ascii-names']); eq(a.mode, 'preview'); eq(a.shop, '#0123456789ab'); eq(a.asciiNames, true); eq(a.emulator, false); });
  await T('[٢] --emulator', () => eq(P(['--mode', 'preview', '--emulator']).emulator, true));
  await T('[٢] قيمة الوسيط لا تُطبع في رسالة الخطأ (مجهول بالاسم وحده)', () => {
    let thrown = null;
    try { P(['--mode', 'preview', `--secret=${PRIVATE.emailA}`]); } catch (e) { thrown = e; }
    ok(thrown && !String(thrown.message).includes(PRIVATE.emailA), 'سُرِّبت القيمة');
  });

  // ═══ ٣ — البيئة والمشروع ═══
  const E = (emulator, env) => need(L, 'المكتبة').checkEnvironment({emulator, env});
  await T('[٣] إنتاج بلا متغيّرات ⟵ مقبول بالمشروع المثبَّت', () => { const r = E(false, {}); ok(r.ok, 'رُفض'); eq(r.target, 'PRODUCTION'); eq(r.projectId, PROJECT); });
  await T('[٣] إنتاج ومعه GCLOUD_PROJECT = المثبَّت ⟵ مقبول', () => ok(E(false, {GCLOUD_PROJECT: PROJECT}).ok, 'رُفض'));
  await T('[٣] إنتاج وFIRESTORE_EMULATOR_HOST مضبوط ⟵ رفض EMULATOR_HOST_WITHOUT_FLAG', () => { const r = E(false, {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}); ok(!r.ok); ok(r.reasons.includes('EMULATOR_HOST_WITHOUT_FLAG'), JSON.stringify(r)); });
  await T('[٣] إنتاج والمتغيّر فارغ/مسافات لا يُعدّ مضبوطاً', () => ok(E(false, {FIRESTORE_EMULATOR_HOST: '  '}).ok, 'رُفض'));
  await T('[٣] إنتاج وGCLOUD_PROJECT آخر ⟵ PROJECT_MISMATCH', () => { const r = E(false, {GCLOUD_PROJECT: 'other-project'}); ok(!r.ok && r.reasons.includes('PROJECT_MISMATCH'), JSON.stringify(r)); });
  await T('[٣] إنتاج وGOOGLE_CLOUD_PROJECT آخر ⟵ PROJECT_MISMATCH', () => { const r = E(false, {GOOGLE_CLOUD_PROJECT: 'other-project'}); ok(!r.ok && r.reasons.includes('PROJECT_MISMATCH'), JSON.stringify(r)); });
  await T('[٣] إنتاج وFIREBASE_CONFIG بمشروع آخر ⟵ PROJECT_MISMATCH', () => { const r = E(false, {FIREBASE_CONFIG: JSON.stringify({projectId: 'other-project'})}); ok(!r.ok && r.reasons.includes('PROJECT_MISMATCH'), JSON.stringify(r)); });
  await T('[٣] إنتاج وFIREBASE_CONFIG لا يُقرأ ⟵ FIREBASE_CONFIG_UNREADABLE', () => { const r = E(false, {FIREBASE_CONFIG: '/no/such/file.json'}); ok(!r.ok && r.reasons.includes('FIREBASE_CONFIG_UNREADABLE'), JSON.stringify(r)); });
  await T('[٣] --emulator بلا FIRESTORE_EMULATOR_HOST ⟵ رفض', () => { const r = E(true, {GCLOUD_PROJECT: 'demo-nc'}); ok(!r.ok && r.reasons.includes('FIRESTORE_EMULATOR_HOST_MISSING'), JSON.stringify(r)); });
  await T('[٣] --emulator ومضيف غير محلّي ⟵ رفض', () => { const r = E(true, {FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443', GCLOUD_PROJECT: 'demo-nc'}); ok(!r.ok && r.reasons.includes('FIRESTORE_EMULATOR_HOST_NOT_LOCAL'), JSON.stringify(r)); });
  await T('[٣] --emulator ومشروع الإنتاج في البيئة ⟵ رفض', () => { const r = E(true, {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: PROJECT}); ok(!r.ok && r.reasons.includes('PROJECT_IS_PRODUCTION'), JSON.stringify(r)); });
  await T('[٣] --emulator بلا مشروع ⟵ رفض', () => { const r = E(true, {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}); ok(!r.ok && r.reasons.includes('PROJECT_ABSENT'), JSON.stringify(r)); });
  await T('[٣] --emulator سليم ⟵ EMULATOR بمشروع الاختبار من البيئة (لا المثبَّت)', () => { const r = E(true, EMU_ENV); ok(r.ok, JSON.stringify(r)); eq(r.target, 'EMULATOR'); eq(r.projectId, 'demo-nc'); });
  await T('[٣] --emulator ومشروعان مختلفان في البيئة ⟵ رفض PROJECT_AMBIGUOUS', () => { const r = E(true, {...EMU_ENV, GOOGLE_CLOUD_PROJECT: 'demo-other'}); ok(!r.ok && r.reasons.includes('PROJECT_AMBIGUOUS'), JSON.stringify(r)); });
  await T('[٣] main: إنتاج مع FIRESTORE_EMULATOR_HOST ⟵ exit 5 ولا قراءة ولا كتابة', async () => {
    const r = await run(['--mode', 'preview'], {env: {FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}});
    eq(r.code, 5); ok(r.db.reads.length === 0 && r.db.queries.length === 0 && writeCountOf(r.db) === 0, 'لمس db'); ok(r.text.includes('EMULATOR_HOST_WITHOUT_FLAG'), 'السبب غير مسمّى');
  });
  await T('[٣] main: --emulator بلا مضيف ⟵ exit 5', async () => { const r = await run(['--mode', 'preview', '--emulator'], {env: {GCLOUD_PROJECT: 'demo-nc'}}); eq(r.code, 5); ok(r.db.queries.length === 0, 'قرأ'); });
  await T('[٣] main: المشروع الفعّال مختلف ⟵ exit 5', async () => { const r = await run(['--mode', 'preview'], {env: {GCLOUD_PROJECT: 'wrong-project'}}); eq(r.code, 5); ok(r.text.includes('PROJECT_MISMATCH'), 'السبب'); });
  await T('[٣] main: --emulator سليم ⟵ يعمل (والمخرَج يُعلن EMULATOR)', async () => { const r = await run(['--mode', 'preview', '--emulator'], {env: EMU_ENV}); eq(r.code, 0); ok(r.out.some((l) => l.startsWith('PREVIEW|ENV target=EMULATOR project=demo-nc')), r.out[0]); });

  // ═══ ٤ — المعاينة ═══
  await T('[٤] المعاينة: صفر كتابة، ولا معاملة، واستعلام واحد بقناع الحقول الأربعة وسقف+1 بلا مرشّح (لا فهرس: القاعدة 43)', async () => {
    const r = await run(['--mode', 'preview']);
    eq(r.code, 0);
    eq(writeCountOf(r.db), 0, 'كتابات'); eq(r.db.txStarts, 0, 'معاملات');
    eq(r.db.queries.length, 1, `استعلامات ${r.db.queries.length}`);
    deq(r.db.queries[0], {collection: 'users', filters: [], limit: L.SHOP_SCAN_CAP + 1, inTx: false, select: ['name', 'displayName', 'type', 'protocolParts']});
  });
  await T('[٤] المعاينة: قراءة protocolSettings/current بالمسار (لا استعلام)', async () => {
    const r = await run(['--mode', 'preview']);
    ok(r.db.reads.some((x) => x.path === `${SETTINGS_COL}/${CUR}` && x.inTx === false), JSON.stringify(r.db.reads));
    ok(r.db.queries.every((q) => q.collection === 'users'), 'استعلام على غير users');
  });
  await T('[٤] المعاينة: لا uid ولا بريد ولا هاتف ولا حقل خاصّ في المخرَج كلّه (بذور مميَّزة)', async () => { const r = await run(['--mode', 'preview', '--shop', hashIdForLog(PRIVATE.uidA)]); eq(r.code, 0); noPrivate(r.text, 'preview'); });
  await T('[٤] قناع لا يطبّقه المزوّد (select يُرجع كل الحقول): الأداة لا تطبع ما لم تطلبه', async () => {
    const db = makePairDb(world(), {now: NOW});
    const real = db.collection.bind(db);
    db.collection = (name) => { const c = real(name); return {...c, select: () => c}; };
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA], {db});
    eq(r.code, 0, r.text);
    noPrivate(r.text, 'unmasked');
  });
  const SETTINGS_STATES = [
    ['PRESENT بلا openBeforeValidityHours', world(), 'PREVIEW|SETTINGS state=PRESENT version=3 openBeforeValidityHours=ABSENT'],
    ['PRESENT وقيمة 168', world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 168})}}), 'PREVIEW|SETTINGS state=PRESENT version=3 openBeforeValidityHours=168'],
    ['PRESENT وقيمة بنوع خاطئ', world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 'ten'})}}), 'PREVIEW|SETTINGS state=PRESENT version=3 openBeforeValidityHours=INVALID'],
    ['SETTINGS_ABSENT (لا مستند)', world({[SETTINGS_COL]: {}}), 'PREVIEW|SETTINGS state=SETTINGS_ABSENT version=NONE openBeforeValidityHours=ABSENT'],
    ['VERSION_UNUSABLE (مستند بلا version)', world({[SETTINGS_COL]: {[CUR]: {repeatRate: 0.2}}}), 'PREVIEW|SETTINGS state=VERSION_UNUSABLE version=NONE openBeforeValidityHours=ABSENT'],
    ['VERSION_UNUSABLE (version صفر)', world({[SETTINGS_COL]: {[CUR]: {version: 0, openBeforeValidityHours: 72}}}), 'PREVIEW|SETTINGS state=VERSION_UNUSABLE version=NONE openBeforeValidityHours=ABSENT'],
  ];
  for (const [label, seed, want] of SETTINGS_STATES) {
    await T(`[٤] حالة الإعدادات: ${label}`, async () => { const r = await run(['--mode', 'preview'], {seed}); eq(r.code, 0); deq(r.line('PREVIEW|SETTINGS'), [want]); });
  }
  const code = (uid) => hashIdForLog(uid);
  await T('[٤] قائمة المحالّ: ثلاثة صفوف مرتّبة (الاسم ثم الرمز) وبحقولها', async () => {
    const r = await run(['--mode', 'preview']);
    const rows = r.line('PREVIEW|SHOP ');
    eq(rows.length, 3, rows.join('\n'));
    const A = `PREVIEW|SHOP n=?? code=${code(PRIVATE.uidA)} name="${NAME_A}" nameSource=name type="shop" purposes=false batteryBeforeAfter=false protocolParts=ABSENT`;
    ok(rows.some((l) => l.replace(/ n=\d+ /, ' n=?? ') === A), `صفّ A غائب أو مختلف:\n${rows.join('\n')}`);
    ok(rows.some((l) => l.includes(`code=${code(PRIVATE.uidB)} name="Display B" nameSource=displayName type="individual" purposes=true batteryBeforeAfter=false protocolParts=PRESENT`)), `صفّ B (name فارغ ⟵ displayName احتياطاً؛ القارئ === true: «yes» تُقرأ false):\n${rows.join('\n')}`);
    ok(rows.some((l) => l.includes(`code=${code(PRIVATE.uidC)} name="(بلا اسم)" nameSource=NONE type="shop" purposes=false batteryBeforeAfter=false protocolParts=ABSENT`)), `صفّ C (لا اسم ولا displayName ولا protocolParts):\n${rows.join('\n')}`);
    deq(rows.map((l) => Number(/ n=(\d+) /.exec(l)[1])), [1, 2, 3], 'أرقام الصفوف');
    eq(r.line('PREVIEW|SHOPS')[0], 'PREVIEW|SHOPS count=3 cap=5000');
  });
  await T('[٤] الترتيب حتمي: الاسم ثم الرمز (بغضّ النظر عن ترتيب المخزن)', async () => {
    const seed = {users: {zz: {name: 'B', type: 'shop'}, aa: {name: 'A', type: 'shop'}, mm: {name: 'B', type: 'shop'}}, [SETTINGS_COL]: {[CUR]: SETTINGS_V3()}};
    const r1 = await run(['--mode', 'preview'], {seed});
    const seedRev = {users: {mm: {name: 'B', type: 'shop'}, aa: {name: 'A', type: 'shop'}, zz: {name: 'B', type: 'shop'}}, [SETTINGS_COL]: {[CUR]: SETTINGS_V3()}};
    const r2 = await run(['--mode', 'preview'], {seed: seedRev});
    const strip = (r) => r.line('PREVIEW|SHOP ').map((l) => l.replace(/^PREVIEW\|SHOP n=\d+ /, ''));
    deq(strip(r1), strip(r2));
    const names = r1.line('PREVIEW|SHOP ').map((l) => /name="([^"]*)"/.exec(l)[1]);
    deq(names, ['A', 'B', 'B']);
    const bCodes = r1.line('PREVIEW|SHOP ').filter((l) => l.includes('name="B"')).map((l) => /code=(#[0-9a-f]+)/.exec(l)[1]);
    deq(bCodes, [...bCodes].sort());
  });
  await T('[٤] حالة الجزأين تُقرأ بـ=== true وحدها (false صريحة وغياب وقيمة نصّية كلّها «false»)', async () => {
    const seed = {users: {u1: {name: 'one', protocolParts: {purposes: true, batteryBeforeAfter: true}}, u2: {name: 'two', protocolParts: {purposes: 'true', batteryBeforeAfter: 1}}, u3: {name: 'three', protocolParts: {purposes: false}}}, [SETTINGS_COL]: {}};
    const r = await run(['--mode', 'preview'], {seed});
    const rows = Object.fromEntries(r.line('PREVIEW|SHOP ').map((l) => [/name="([^"]*)"/.exec(l)[1], l]));
    ok(rows.one.includes('purposes=true batteryBeforeAfter=true'), rows.one);
    ok(rows.two.includes('purposes=false batteryBeforeAfter=false'), rows.two);
    ok(rows.three.includes('purposes=false batteryBeforeAfter=false'), rows.three);
  });
  await T('[٤] --ascii-names يهرب الأحرف غير ASCII في الاسم (\\uXXXX)، وبدونه الاسم كما هو', async () => {
    const plain = await run(['--mode', 'preview']);
    ok(plain.line('PREVIEW|SHOP ').some((l) => l.includes(`name="${NAME_A}"`)), 'الاسم الخام غائب');
    const asc = await run(['--mode', 'preview', '--ascii-names']);
    ok(asc.out.every((l) => /^[\x20-\x7E]*$/.test(l)), `سطر غير ASCII:\n${asc.out.filter((l) => !/^[\x20-\x7E]*$/.test(l)).join('\n')}`);
    ok(asc.line('PREVIEW|SHOP ').some((l) => l.includes('name="\\u0645')), asc.line('PREVIEW|SHOP ').join('\n'));
  });
  await T('[٤] اسم بمحارف حرجة (علامة اقتباس وسطر جديد وشريط) يبقى سطراً واحداً قابلاً للقراءة', async () => {
    const seed = {users: {u1: {name: 'a"b|c\nd=e', type: 'shop'}}, [SETTINGS_COL]: {}};
    const r = await run(['--mode', 'preview'], {seed});
    const rows = r.line('PREVIEW|SHOP ');
    eq(rows.length, 1); ok(!rows[0].includes('\n'), 'سطر جديد'); ok(rows[0].includes('name="a\\"b|c\\nd=e"'), rows[0]);
  });
  await T('[٤] سقف المسح: فوقه توقّف صريح (exit 4، CAP_EXCEEDED) لا صمت', async () => {
    const seed = {users: {u1: {name: '1'}, u2: {name: '2'}, u3: {name: '3'}, u4: {name: '4'}}, [SETTINGS_COL]: {}};
    const r = await run(['--mode', 'preview'], {seed, io: {scanCap: 3}});
    eq(r.code, 4); ok(r.text.includes('SHOP_SCAN_CAP_EXCEEDED'), r.text); ok(r.out.some((l) => l.startsWith('PREVIEW|SHOPS state=CAP_EXCEEDED cap=3')), r.out.join('\n'));
    eq(r.line('PREVIEW|SHOP ').length, 0, 'طُبعت صفوف رغم تجاوز السقف');
    eq(writeCountOf(r.db), 0);
  });
  await T('[٤] عدد المحالّ = السقف تماماً مقبول', async () => {
    const seed = {users: {u1: {name: '1'}, u2: {name: '2'}, u3: {name: '3'}}, [SETTINGS_COL]: {}};
    const r = await run(['--mode', 'preview'], {seed, io: {scanCap: 3}});
    eq(r.code, 0); eq(r.line('PREVIEW|SHOP ').length, 3);
  });
  const PLAN_LINES = (r) => r.line('PLAN|FIELD');
  await T('[٤] --shop (رمز): الخطّة لحقل hours وجزأين: كلها WRITE حين الغائب', async () => {
    const r = await run(['--mode', 'preview', '--shop', code(PRIVATE.uidA)]);
    eq(r.code, 0);
    deq(PLAN_LINES(r), [
      'PLAN|FIELD name=openBeforeValidityHours current=ABSENT new=72 action=WRITE',
      'PLAN|FIELD name=purposes current=ABSENT reads=false new=true action=WRITE',
      'PLAN|FIELD name=batteryBeforeAfter current=ABSENT reads=false new=true action=WRITE',
    ]);
    deq(r.line('PLAN|SUMMARY'), ['PLAN|SUMMARY writes=3 unchanged=0']);
    ok(r.line('PLAN|TARGET')[0].startsWith(`PLAN|TARGET code=${code(PRIVATE.uidA)} name="${NAME_A}" type="shop"`), r.line('PLAN|TARGET').join());
  });
  await T('[٤] --shop (uid): الخطّة نفسها (ولا uid خامّ في المخرَج)', async () => {
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA]);
    eq(r.code, 0); eq(r.line('PLAN|SUMMARY')[0], 'PLAN|SUMMARY writes=3 unchanged=0'); noPrivate(r.text, 'plan-uid');
  });
  await T('[٤] --shop والقيم الحالية = المطلوبة ⟵ UNCHANGED للثلاثة', async () => {
    const seed = world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 72})}, users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: true, batteryBeforeAfter: true}})}});
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA], {seed});
    deq(PLAN_LINES(r), [
      'PLAN|FIELD name=openBeforeValidityHours current=72 new=72 action=UNCHANGED',
      'PLAN|FIELD name=purposes current=true reads=true new=true action=UNCHANGED',
      'PLAN|FIELD name=batteryBeforeAfter current=true reads=true new=true action=UNCHANGED',
    ]);
    eq(r.line('PLAN|SUMMARY')[0], 'PLAN|SUMMARY writes=0 unchanged=3');
  });
  await T('[٤] --shop وhours = 168 وpurposes=false صريحة وbatteryBeforeAfter غائب', async () => {
    const seed = world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 168})}, users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: false}})}});
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA], {seed});
    deq(PLAN_LINES(r), [
      'PLAN|FIELD name=openBeforeValidityHours current=168 new=72 action=WRITE',
      'PLAN|FIELD name=purposes current=false reads=false new=true action=WRITE',
      'PLAN|FIELD name=batteryBeforeAfter current=ABSENT reads=false new=true action=WRITE',
    ]);
  });
  await T('[٤] --shop وإعدادات بلا version صالح ⟵ الخطّة تُعلن الرفض (لا تُخمَّن)', async () => {
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA], {seed: world({[SETTINGS_COL]: {[CUR]: {repeatRate: 0.2}}})});
    ok(r.line('PLAN|FIELD name=openBeforeValidityHours')[0].includes('action=REFUSED reason=SETTINGS_CURRENT_VERSION_INVALID'), r.line('PLAN|FIELD').join('\n'));
  });
  await T('[٤] --shop غير موجود ⟵ exit 4 SHOP_NOT_FOUND بلا خطّة', async () => {
    for (const shop of ['no-such-uid-123', '#0123456789ab', '0123456789ab']) {
      const r = await run(['--mode', 'preview', '--shop', shop]);
      eq(r.code, 4, `${shop}: ${r.code}`); ok(r.text.includes('SHOP_NOT_FOUND'), r.text); eq(r.line('PLAN|').length, 0, 'خطّة');
    }
  });
  await T('[٤] المعاينة تعمل على db يرمي TRAP عند أيّ كتابة (غلاف القراءة وحدها)', async () => {
    const db = makePairDb(world(), {now: NOW});
    const trapDb = new Proxy(db, {get(target, prop) { if (['runTransaction', 'batch', 'bulkWriter', 'recursiveDelete'].includes(prop)) return () => { throw new Error(`TRAP ${String(prop)}`); }; const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; }});
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA], {db: trapDb});
    eq(r.code, 0, r.text);
  });
  await T('[٤] خطأ من المزوّد أثناء القراءة ⟵ exit 5 بالصنف والرمز وحدهما (لا نصّ الرسالة)', async () => {
    const boom = Object.assign(new Error(`secret ${PRIVATE.emailA} token ${PRIVATE.token}`), {code: 7});
    const db = {collection: () => { throw boom; }, runTransaction: () => { throw boom; }};
    const r = await run(['--mode', 'preview'], {db});
    eq(r.code, 5); noPrivate(r.text, 'provider-error'); ok(/Error/.test(r.text) && /code=7/.test(r.text), r.text);
  });

  // ═══ ٥ — الكتابة ═══
  const settingsAfter = (db) => db.store[SETTINGS_COL][CUR];
  const userAfter = (db, uid) => db.store.users[uid];
  await T('[٥] بلا --confirm ⟵ exit 4 CONFIRM_MISSING: لا قراءة ولا كتابة ولا ملفّ', async () => {
    const file = newFile();
    const r = await run(['--mode', 'write', '--shop', PRIVATE.uidA, '--rollback-file', file]);
    eq(r.code, 4); ok(r.text.includes('CONFIRM_MISSING'), r.text);
    ok(r.db.reads.length === 0 && r.db.queries.length === 0 && writeCountOf(r.db) === 0 && r.db.txStarts === 0, 'لمس db'); ok(!fs.existsSync(file), 'كُتب ملفّ');
  });
  for (const bad of ['write-maintenance-settings', 'WRITE-MAINTENANCE-SETTINGS ', 'WRITE-MAINTENANCE-SETTING', 'ROLLBACK-MAINTENANCE-SETTINGS', 'yes', '٧٢']) {
    await T(`[٥] --confirm خاطئ «${bad}» ⟵ exit 4 CONFIRM_MISMATCH بلا أثر`, async () => {
      const file = newFile();
      const r = await run(['--mode', 'write', '--shop', PRIVATE.uidA, '--confirm', bad, '--rollback-file', file]);
      eq(r.code, 4); ok(r.text.includes('CONFIRM_MISMATCH'), r.text);
      ok(r.db.reads.length === 0 && r.db.queries.length === 0 && writeCountOf(r.db) === 0 && r.db.txStarts === 0, 'لمس db'); ok(!fs.existsSync(file), 'كُتب ملفّ');
    });
  }
  await T('[٥] write بلا --shop ⟵ exit 2 (استعمال)', async () => { const r = await run(['--mode', 'write', '--confirm', L.CONFIRM_WRITE, '--rollback-file', newFile()]); eq(r.code, 2); eq(writeCountOf(r.db), 0); });
  await T('[٥] الكتابة: إعدادات حاضرة (v3) ومحلّ بجزء آخر مفعَّل ⟵ المستندان بالضبط', async () => {
    const seed = world({users: {[PRIVATE.uidA]: userA({protocolParts: {coldRepeat: true, consent: false}})}});
    const before = snapshotOf(makePairDb(seed, {now: NOW}));
    const seedSettings = seed[SETTINGS_COL][CUR];
    const seedUser = seed.users[PRIVATE.uidA];
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file), {seed});
    eq(r.code, 0, r.text); noPrivate(r.out.join('\n') + r.err.join('\n'), 'write-output');
    const s = settingsAfter(r.db);
    deq({...s, updatedAt: undefined}, {...seedSettings, openBeforeValidityHours: 72, version: 4, updatedAt: undefined, updatedBy: ACTOR});
    eq(s.updatedAt.toMillis(), NOW, 'updatedAt من ساعة الخادم');
    const h = r.db.store[HIST_COL]['3'];
    deq({...h, supersededAt: undefined}, {...seedSettings, supersededAt: undefined, supersededByVersion: 4, supersededBy: ACTOR});
    eq(h.supersededAt.toMillis(), NOW);
    const u = userAfter(r.db, PRIVATE.uidA);
    deq(u.protocolParts, {coldRepeat: true, consent: false, purposes: true, batteryBeforeAfter: true});
    deq({...u, protocolParts: undefined}, {...seedUser, protocolParts: undefined});
    deq(Object.keys(r.db.store.users).sort(), Object.keys(before.users).sort());
    deq(r.line('RESULT'), ['RESULT|OK mode=write exit=0 writes=2']);
    deq(r.line('WRITE|AFTER'), ['WRITE|AFTER openBeforeValidityHours=72 settingsVersion=4 purposes=true batteryBeforeAfter=true'], 'سطر الحال بعد الكتابة (قراءة بعدية)');
  });
  await T('[٥] الكتابات بالتتابع والنوع: create لـhistory/3 ثم set للإعدادات ثم update للمحلّ بمفتاح protocolParts وحده (لا set للمحلّ ولا delete)', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()));
    deq(r.db.writes.map((w) => `${w.op}:${w.path}`), [`create:${HIST_COL}/3`, `set:${SETTINGS_COL}/${CUR}`, `update:users/${PRIVATE.uidA}`]);
    deq(Object.keys(r.db.writes[2].data), ['protocolParts']);
    deq(r.db.batches, []);
    ok(!JSON.stringify(r.db.writes).includes('__delete'), 'علامة حذف');
  });
  await T('[٥] الكتابة: لا مستند إعدادات ⟵ version 1 بلا history، والمحلّ بلا protocolParts', async () => {
    const seed = world({[SETTINGS_COL]: {}});
    const r = await run(WRITE_ARGS(PRIVATE.uidC, newFile()), {seed});
    eq(r.code, 0, r.text);
    const s = settingsAfter(r.db);
    deq({...s, updatedAt: undefined}, {openBeforeValidityHours: 72, version: 1, updatedAt: undefined, updatedBy: ACTOR});
    eq(r.db.store[HIST_COL], undefined, 'history بلا مستند سابق');
    deq(userAfter(r.db, PRIVATE.uidC).protocolParts, {purposes: true, batteryBeforeAfter: true});
    deq(r.db.writes.map((w) => `${w.op}:${w.path}`), [`set:${SETTINGS_COL}/${CUR}`, `update:users/${PRIVATE.uidC}`]);
  });
  await T('[٥] الكتابة بالرمز تعمل كالـuid (المحلّ نفسه)', async () => {
    const r = await run(WRITE_ARGS(code(PRIVATE.uidB), newFile()));
    eq(r.code, 0, r.text); deq(userAfter(r.db, PRIVATE.uidB).protocolParts, {purposes: true, batteryBeforeAfter: true, coldRepeat: false});
    ok(userAfter(r.db, PRIVATE.uidA).protocolParts === undefined && userAfter(r.db, PRIVATE.uidC).protocolParts === undefined, 'مُسّ محلّ آخر');
  });
  await T('[٥] الكتابة بالرمز مع «#» أو بدونه (اثنا عشر سداسياً)', async () => {
    const r = await run(WRITE_ARGS(code(PRIVATE.uidA).slice(1), newFile()));
    eq(r.code, 0, r.text); eq(userAfter(r.db, PRIVATE.uidA).protocolParts.purposes, true);
  });
  await T('[٥] غير المتغيّر لا يُكتب: لا كتابة ولا history ولا version جديدة، وRESULT UNCHANGED، وملفّ التراجع يُكتب مع ذلك', async () => {
    const seed = world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 72})}, users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: true, batteryBeforeAfter: true}})}});
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file), {seed});
    eq(r.code, 0, r.text); eq(writeCountOf(r.db), 0, 'كتابات'); eq(r.db.store[HIST_COL], undefined); eq(settingsAfter(r.db).version, 3);
    deq(r.line('RESULT'), ['RESULT|UNCHANGED mode=write exit=0 writes=0']);
    ok(fs.existsSync(file), 'لا ملفّ تراجع');
  });
  await T('[٥] جزء واحد متغيّر فقط ⟵ يُكتب المحلّ وحده والإعدادات لا (غير المتغيّر)', async () => {
    const seed = world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 72})}, users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: true}})}});
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {seed});
    deq(r.db.writes.map((w) => `${w.op}:${w.path}`), [`update:users/${PRIVATE.uidA}`]);
    eq(settingsAfter(r.db).version, 3);
  });
  await T('[٥] ملفّ التراجع يُكتب **قبل** المعاملة (يُرصد داخلها) بمحتواه الدقيق، ولا بريد ولا هاتف فيه', async () => {
    const file = newFile();
    let seenAtCommit = null;
    const db = makePairDb(world({users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: false, coldRepeat: true}})}}), {now: NOW});
    db.hooks.beforeCommit = () => { if (seenAtCommit === null) seenAtCommit = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'MISSING'; };
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file), {db});
    eq(r.code, 0, r.text);
    ok(seenAtCommit !== null && seenAtCommit !== 'MISSING', 'الملفّ لم يكن موجوداً قبل الإتمام');
    const f = JSON.parse(seenAtCommit);
    deq(Object.keys(f).sort(), ['afterVersions', 'previous', 'projectId', 'shopUid', 'target', 'version', 'writtenAtMs']);
    eq(f.version, 1); eq(f.writtenAtMs, NOW); eq(f.shopUid, PRIVATE.uidA); eq(f.projectId, PROJECT); eq(f.target, 'PRODUCTION');
    deq(f.previous, {openBeforeValidityHours: 'ABSENT', settingsVersion: 3, purposes: false, batteryBeforeAfter: 'ABSENT'});
    deq(f.afterVersions, {settingsVersion: 4});
    for (const v of [PRIVATE.emailA, PRIVATE.phoneA, PRIVATE.token, NAME_A]) ok(!seenAtCommit.includes(v), `الملفّ يحمل قيمة خاصّة: ${v}`);
  });
  await T('[٥] ملفّ التراجع في حالة «لا إعدادات»: previous.settingsVersion = ABSENT وafterVersions = 1', async () => {
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidC, file), {seed: world({[SETTINGS_COL]: {}})});
    eq(r.code, 0, r.text);
    const f = JSON.parse(fs.readFileSync(file, 'utf8'));
    deq(f.previous, {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}); deq(f.afterVersions, {settingsVersion: 1});
  });
  await T('[٥] ملفّ تراجع موجود ⟵ exit 4 ROLLBACK_FILE_EXISTS: لا استبدال ولا كتابة (الملفّ الأوّل يحمل القيم الأصلية)', async () => {
    const file = newFile();
    fs.writeFileSync(file, 'ORIGINAL');
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file));
    eq(r.code, 4); ok(r.text.includes('ROLLBACK_FILE_EXISTS'), r.text); eq(writeCountOf(r.db), 0); eq(r.db.txStarts, 0); eq(fs.readFileSync(file, 'utf8'), 'ORIGINAL');
    ok(r.db.reads.length === 0 && r.db.queries.length === 0, 'مسار الملفّ يُفحَص قبل أيّ اتصال بـFirestore (لا قراءة)');
  });
  await T('[٥] مجلّد ملفّ التراجع غير موجود ⟵ exit 4 ROLLBACK_FILE_UNWRITABLE ولا كتابة', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, path.join(tmpDir, 'no-such-dir', 'x.json')));
    eq(r.code, 4); ok(r.text.includes('ROLLBACK_FILE_UNWRITABLE'), r.text); eq(writeCountOf(r.db), 0); eq(r.db.txStarts, 0);
    ok(r.db.reads.length === 0 && r.db.queries.length === 0, 'مسار الملفّ يُفحَص قبل أيّ اتصال بـFirestore (لا قراءة)');
  });
  await T('[٥] ملفّ التراجع يفشل بعد الفحص المسبق (سباق) ⟵ لا كتابة', async () => {
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file), {io: {writeRollbackFile: () => { throw Object.assign(new Error('disk full'), {code: 'ENOSPC'}); }}});
    eq(r.code, 4); eq(writeCountOf(r.db), 0); eq(r.db.txStarts, 0);
  });
  await T('[٥] محلّ غير موجود (uid) ⟵ exit 4 SHOP_NOT_FOUND: لا ملفّ ولا كتابة ولا إنشاء للمحلّ', async () => {
    const file = newFile();
    const r = await run(WRITE_ARGS('uid-that-does-not-exist', file));
    eq(r.code, 4); ok(r.text.includes('SHOP_NOT_FOUND'), r.text); eq(writeCountOf(r.db), 0); ok(!fs.existsSync(file), 'ملفّ'); eq(r.db.store.users['uid-that-does-not-exist'], undefined, 'أُنشئ المحلّ');
  });
  await T('[٥] رمز لا يطابق أحداً ⟵ SHOP_NOT_FOUND', async () => { const r = await run(WRITE_ARGS('#0123456789ab', newFile())); eq(r.code, 4); ok(r.text.includes('SHOP_NOT_FOUND'), r.text); eq(writeCountOf(r.db), 0); });
  await T('[٥] رمز يطابق أكثر من محلّ ⟵ exit 4 SHOP_AMBIGUOUS ولا كتابة', async () => {
    const r = await run(WRITE_ARGS('#aaaaaaaaaaaa', newFile()), {io: {hashId: () => '#aaaaaaaaaaaa'}});
    eq(r.code, 4); ok(r.text.includes('SHOP_AMBIGUOUS'), r.text); eq(writeCountOf(r.db), 0);
  });
  await T('[٥] إعدادات بلا version صالح ⟵ exit 4 SETTINGS_CURRENT_VERSION_INVALID قبل ملفّ التراجع وبلا كتابة', async () => {
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidA, file), {seed: world({[SETTINGS_COL]: {[CUR]: {repeatRate: 0.2}}})});
    eq(r.code, 4); ok(r.text.includes('SETTINGS_CURRENT_VERSION_INVALID'), r.text); eq(writeCountOf(r.db), 0); ok(!fs.existsSync(file), 'كُتب ملفّ رغم الرفض');
  });
  await T('[٥] تغيّرت القيم السابقة بين اللقطة والمعاملة (سباق) ⟵ exit 4 SNAPSHOT_CHANGED ولا كتابة', async () => {
    const db = makePairDb(world(), {now: NOW});
    let first = true;
    db.hooks.beforeCommit = ({db: d}) => { if (first) { first = false; d.seed(SETTINGS_COL, CUR, SETTINGS_V3({openBeforeValidityHours: 100, version: 4})); } };
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {db});
    eq(r.code, 4, r.text); ok(r.text.includes('SNAPSHOT_CHANGED'), r.text); eq(writeCountOf(r.db), 0);
  });
  await T('[٥] فشل المعاملة (history موجود مسبقاً: create لا set) ⟵ exit 6 UNDETERMINED بالصنف والرمز وحدهما، ولا كتابة جزئية', async () => {
    const seed = world({[HIST_COL]: {'3': {version: 3, stale: true}}});
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {seed});
    eq(r.code, 6, r.text); eq(writeCountOf(r.db), 0, 'كتابة جزئية'); ok(r.line('RESULT')[0].startsWith('RESULT|UNDETERMINED'), r.line('RESULT').join());
    ok(!/stale/.test(r.text), 'تسرّب قيمة');
  });
  await T('[٥] لا حقل غير الأربعة يُمسّ: مستند محلّ وإعدادات بحقول كثيرة تبقى (بما فيها isActive وexpiresAt وplan)، وreports لا تُمسّ', async () => {
    const seed = world();
    const before = snapshotOf(makePairDb(seed, {now: NOW}));
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {seed});
    const after = snapshotOf(r.db);
    deq(after.reports, before.reports); deq(after.users[PRIVATE.uidB], before.users[PRIVATE.uidB]); deq(after.users[PRIVATE.uidC], before.users[PRIVATE.uidC]);
    for (const k of ['isActive', 'expiresAt', 'plan', 'scansRemaining', 'scansTotal', 'email', 'phone', 'name', 'type', 'fcmToken', 'lastLoginAt', 'displayName']) deq(after.users[PRIVATE.uidA][k], before.users[PRIVATE.uidA][k], `تغيّر ${k}`);
    const changedSettingsKeys = Object.keys(after[SETTINGS_COL][CUR]).filter((k) => JSON.stringify(after[SETTINGS_COL][CUR][k]) !== JSON.stringify(before[SETTINGS_COL][CUR][k])).sort();
    deq(changedSettingsKeys, ['openBeforeValidityHours', 'updatedAt', 'updatedBy', 'version']);
    deq(Object.keys(r.db.store).sort(), [HIST_COL, 'protocolSettings', 'reports', 'users'].sort());
  });
  await T('[٥] القراءة البعدية: الفرق المتوقَّع مُعلَن بأسماء المسارات (DIFF|…) والتاريخ بـmatches=true', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()));
    const diff = r.line('DIFF|');
    ok(diff.includes('DIFF|SETTINGS path=openBeforeValidityHours kind=ADDED expected=true'), diff.join('\n'));
    for (const p of ['version', 'updatedAt', 'updatedBy']) ok(diff.some((l) => l.startsWith(`DIFF|SETTINGS path=${p} kind=CHANGED expected=true`)), `${p}: ${diff.join('\n')}`);
    ok(diff.includes('DIFF|SHOP path=protocolParts.purposes kind=ADDED expected=true'), diff.join('\n'));
    ok(diff.includes('DIFF|SHOP path=protocolParts.batteryBeforeAfter kind=ADDED expected=true'), diff.join('\n'));
    ok(diff.includes('DIFF|HISTORY version=3 created=true matches=true'), diff.join('\n'));
    ok(!r.text.includes('DIFF-UNEXPECTED'), 'فرق غير متوقَّع');
  });
  await T('[٥] فرق غير متوقَّع على المحلّ (كتابة جانبية بعد المعاملة) ⟵ exit 3 وDIFF-UNEXPECTED باسم المسار وحده', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { db.seed('users', PRIVATE.uidA, {...db.store.users[PRIVATE.uidA], plan: 'sneaky-change-VALUE'}); }}});
    eq(r.code, 3, r.text); ok(r.out.includes('DIFF-UNEXPECTED SHOP:plan'), r.out.filter((l) => l.startsWith('DIFF')).join('\n')); ok(!r.text.includes('sneaky-change-VALUE'), 'قيمة'); ok(r.line('RESULT')[0].startsWith('RESULT|DIFF-UNEXPECTED mode=write exit=3'), r.line('RESULT').join());
  });
  await T('[٥] فرق غير متوقَّع على الإعدادات (حقل آخر تغيّر) ⟵ exit 3', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { db.seed(SETTINGS_COL, CUR, {...db.store[SETTINGS_COL][CUR], repeatRate: 0.99}); }}});
    eq(r.code, 3); ok(r.out.includes('DIFF-UNEXPECTED SETTINGS:repeatRate'), r.out.filter((l) => l.startsWith('DIFF')).join('\n'));
  });
  await T('[٥] فرق غير متوقَّع: حقل مُسح من المحلّ (REMOVED) ⟵ exit 3', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { const u = {...db.store.users[PRIVATE.uidA]}; delete u.scansTotal; db.seed('users', PRIVATE.uidA, u); }}});
    eq(r.code, 3); ok(r.out.includes('DIFF-UNEXPECTED SHOP:scansTotal'), r.out.filter((l) => l.startsWith('DIFF')).join('\n'));
  });
  await T('[٥] فرق غير متوقَّع: جزء آخر في protocolParts تغيّر ⟵ exit 3 باسم المسار الكامل', async () => {
    const seed = world({users: {[PRIVATE.uidA]: userA({protocolParts: {coldRepeat: false}})}});
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {seed, io: {afterTransaction: async ({db}) => { const u = JSON.parse(JSON.stringify(db.store.users[PRIVATE.uidA])); u.protocolParts.coldRepeat = true; db.seed('users', PRIVATE.uidA, {...db.store.users[PRIVATE.uidA], protocolParts: u.protocolParts}); }}});
    eq(r.code, 3); ok(r.out.includes('DIFF-UNEXPECTED SHOP:protocolParts.coldRepeat'), r.out.filter((l) => l.startsWith('DIFF')).join('\n'));
  });
  await T('[٥] مفتاح مسار غريب (قد يحمل بيانات) يُهشَّر في اسم المسار لا يُطبع خامّاً', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { db.seed('users', PRIVATE.uidA, {...db.store.users[PRIVATE.uidA], [PRIVATE.token]: 'x'}); }}});
    eq(r.code, 3); ok(!r.text.includes(PRIVATE.token), 'مفتاح خام'); ok(r.out.some((l) => /^DIFF-UNEXPECTED SHOP:<key:#[0-9a-f]{12}>$/.test(l)), r.out.filter((l) => l.startsWith('DIFF')).join('\n'));
  });
  await T('[٥] التخطيط قبل الكتابة: كتابة مخطَّطة لحقل غير مسموح تُمنع بلا كتابة (دفاع قبل الفرق)', async () => {
    const guard = need(L, 'المكتبة').verifyPlannedWrites;
    const v = guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: {...SETTINGS_V3(), openBeforeValidityHours: 72, version: 4, updatedAt: 'T', updatedBy: ACTOR, repeatRate: 0.5}, user: null}});
    ok(v.length > 0 && v.some((x) => x.includes('repeatRate')), JSON.stringify(v));
    const v2 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA({protocolParts: {coldRepeat: true}}), writes: {settings: null, user: {protocolParts: {coldRepeat: false, purposes: true, batteryBeforeAfter: true}}}});
    ok(v2.some((x) => x.includes('coldRepeat')), JSON.stringify(v2));
    const v3 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: null, user: {protocolParts: {purposes: true, batteryBeforeAfter: true}, plan: 'x'}}});
    ok(v3.some((x) => x.includes('plan')), JSON.stringify(v3));
    const v4 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA({protocolParts: {coldRepeat: true}}), writes: {settings: null, user: {protocolParts: {purposes: true, batteryBeforeAfter: true}}}});
    ok(v4.some((x) => x.includes('coldRepeat') && x.includes('REMOVED')), `جزء آخر يُمسح: ${JSON.stringify(v4)}`);
    const v5 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: null, user: {protocolParts: {purposes: 'yes', batteryBeforeAfter: true}}}});
    ok(v5.some((x) => x.includes('purposes') && x.includes('NOT_A_BOOLEAN')), `قيمة غير منطقية: ${JSON.stringify(v5)}`);
    const v7 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: {...SETTINGS_V3(), openBeforeValidityHours: 'ten', version: 4, updatedAt: 'T', updatedBy: ACTOR}, user: null}});
    ok(v7.some((x) => x.includes('openBeforeValidityHours') && x.includes('NOT_A_NUMBER')), `hours غير عددية: ${JSON.stringify(v7)}`);
    const v8 = guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: {version: 4, openBeforeValidityHours: 72, updatedAt: 'T', updatedBy: ACTOR}, user: null}});
    ok(v8.some((x) => x.includes('repeatRate') && x.includes('REMOVED')), `حقل إعدادات يُمسح: ${JSON.stringify(v8)}`);
    deq(guard({settingsBefore: SETTINGS_V3(), userBefore: userA(), writes: {settings: {...SETTINGS_V3(), openBeforeValidityHours: 72, version: 4, updatedAt: 'T', updatedBy: ACTOR}, user: {protocolParts: {purposes: true, batteryBeforeAfter: true}}}}), []);
  });
  await T('[٥] الأداة لا تفتح كتابة على reports ولا تلمس isActive/expiresAt (سجلّ الكتابات كلّه)', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()));
    ok(r.db.writes.every((w) => !w.path.startsWith('reports/')), 'كتابة على reports');
    ok(r.db.writes.every((w) => !JSON.stringify(w.data).match(/isActive|expiresAt/)), 'لمس isActive/expiresAt');
  });
  await T('[٥] لا قيمة خاصّة في مخرَج الكتابة بعد مرور شامل (stdout وstderr)', async () => { const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile())); noPrivate(r.text, 'write'); });
  await T('[٥] الأداة تستعمل ساعة الخادم (serverTimestamp) لـupdatedAt لا ساعة الأداة', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()));
    const w = r.db.writes.find((x) => x.path === `${SETTINGS_COL}/${CUR}`);
    ok(w.data.updatedAt && w.data.updatedAt.__serverTimestamp === true, JSON.stringify(w.data.updatedAt));
  });

  await T('[٤] --shop بجزء من uid لا يطابق (المطابقة تامّة لا احتواء)', async () => {
    const r = await run(['--mode', 'preview', '--shop', PRIVATE.uidA.slice(0, 10)]);
    eq(r.code, 4); ok(r.text.includes('SHOP_NOT_FOUND'), r.text);
  });
  await T('[٥] المحلّ يختفي بين اللقطة والمعاملة (سباق) ⟵ exit 4 SHOP_NOT_FOUND داخل المعاملة: لا كتابة ولا إنشاء', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {beforeTransaction: async ({db}) => { delete db.store.users[PRIVATE.uidA]; }}});
    eq(r.code, 4, r.text); ok(r.text.includes('SHOP_NOT_FOUND'), r.text); eq(writeCountOf(r.db), 0, 'كتابة'); eq(r.db.store.users[PRIVATE.uidA], undefined, 'أُنشئ المحلّ');
  });
  await T('[٥] مستند الإعدادات يفقد version بين اللقطة والمعاملة ⟵ exit 4 SETTINGS_CURRENT_VERSION_INVALID داخلها (لا تُخمَّن النسخة التالية)', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {beforeTransaction: async ({db}) => { db.seed(SETTINGS_COL, CUR, {repeatRate: 1}); }}});
    eq(r.code, 4, r.text); ok(r.text.includes('SETTINGS_CURRENT_VERSION_INVALID'), r.text); eq(writeCountOf(r.db), 0);
  });
  await T('[٥] تغيّر مطلوب لم يقع (القراءة البعدية تُعيد الحال القديم) ⟵ exit 3 وDIFF-MISSING باسم المسار', async () => {
    const seed = world();
    const original = seed[SETTINGS_COL][CUR];
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {seed, io: {afterTransaction: async ({db}) => { db.seed(SETTINGS_COL, CUR, original); }}});
    eq(r.code, 3, r.text); ok(r.out.includes('DIFF-MISSING SETTINGS:openBeforeValidityHours'), r.out.filter((l) => l.startsWith('DIFF')).join('\n')); ok(r.out.includes('DIFF-MISSING SETTINGS:version'), 'version');
  });
  await T('[٥] مستند history يخالف المتوقَّع ⟵ exit 3 وDIFF-UNEXPECTED HISTORY وmatches=false', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { db.seed(HIST_COL, '3', {...db.store[HIST_COL]['3'], repeatRate: 0.77}); }}});
    eq(r.code, 3, r.text); ok(r.out.includes('DIFF|HISTORY version=3 created=true matches=false'), r.out.filter((l) => l.startsWith('DIFF')).join('\n')); ok(r.out.includes('DIFF-UNEXPECTED HISTORY:repeatRate'), 'مسار');
  });
  await T('[٥] مستند history بلا supersededAt من نوع وقت ⟵ exit 3', async () => {
    const r = await run(WRITE_ARGS(PRIVATE.uidA, newFile()), {io: {afterTransaction: async ({db}) => { db.seed(HIST_COL, '3', {...db.store[HIST_COL]['3'], supersededAt: 'not-a-timestamp'}); }}});
    eq(r.code, 3, r.text); ok(r.out.includes('DIFF-UNEXPECTED HISTORY:supersededAt'), r.out.filter((l) => l.startsWith('DIFF')).join('\n'));
  });
  await T('[٧] الحارس قبل الكتابة مستدعى داخل المعاملة وقراره يمنع الكتابة (بنية المصدر)', () => {
    const s = SRC.lib();
    ok(/const violations = verifyPlannedWrites\(\{settingsBefore: current, userBefore: userData, writes: \{settings: settingsWrite, user: userWrite\}\}\);\s*if \(violations\.length > 0\) return \{refused: null, guard: violations\};/.test(s), 'نداء الحارس أو قراره');
    const iGuard = s.indexOf('const violations = verifyPlannedWrites');
    const iWrite = s.indexOf('tx.create(settingsRef.collection');
    ok(iGuard > 0 && iWrite > iGuard, 'الحارس بعد أول كتابة');
  });
  await T('[٥] ملفّ التراجع: جزء مخزَّن بنوع غير منطقي يُسجَّل INVALID لا false (والمنطقي كما هو)', async () => {
    const file = newFile();
    const r = await run(WRITE_ARGS(PRIVATE.uidB, file));
    eq(r.code, 0, r.text);
    deq(JSON.parse(fs.readFileSync(file, 'utf8')).previous, {openBeforeValidityHours: 'ABSENT', settingsVersion: 3, purposes: true, batteryBeforeAfter: 'INVALID'});
  });
  await T('[٧] المعاينة تمرّ بـdb مغلَّف بـwrapReadOnly وحده (بنية المدخل)', () => {
    const s = SRC.script();
    ok(/const ro = C\.wrapReadOnly\(admin\.db\);/.test(s) && /L\.runPreview\(\{db: ro,/.test(s), 'غلاف القراءة');
  });
  await T('[٧] القراءات كلّها قبل أول كتابة داخل المعاملة (بنية المصدر)', () => {
    const s = SRC.lib();
    const a = s.indexOf('async function applyInTransaction');
    const m = /\n(?:async )?function \w+/.exec(s.slice(a + 10));
    const body = s.slice(a, a + 10 + (m ? m.index : s.length));
    const gets = [...body.matchAll(/tx\.get\(/g)].map((m) => m.index);
    const writes = [...body.matchAll(/tx\.(set|update|create)\(/g)].map((m) => m.index);
    eq(gets.length, 2); eq(writes.length, 3);
    ok(Math.max(...gets) < Math.min(...writes), 'قراءة بعد كتابة');
    ok(!/throw\s/.test(body), 'throw داخل المعاملة');
  });

  // ═══ ٦ — التراجع ═══
  const writeThenRollbackWorld = async (seed, shop = PRIVATE.uidA) => {
    const file = newFile();
    const db = makePairDb(seed, {now: NOW});
    const w = await run(WRITE_ARGS(shop, file), {db});
    return {file, db, w};
  };
  await T('[٦] التراجع: جزآن غائبان وhours غائبة ⟵ الجزآن false صريحة، وhours تبقى 72 مُعلَنةً', async () => {
    const {file, db, w} = await writeThenRollbackWorld(world());
    eq(w.code, 0, w.text);
    const r = await run(ROLLBACK_ARGS(file), {db});
    eq(r.code, 0, r.text);
    deq(userAfter(db, PRIVATE.uidA).protocolParts, {purposes: false, batteryBeforeAfter: false});
    eq(settingsAfter(db).openBeforeValidityHours, 72); eq(settingsAfter(db).version, 4, 'لا إصدار جديد: لم يُكتب شيء في الإعدادات');
    ok(r.out.includes('ROLLBACK|HOURS previous=ABSENT action=KEPT reason=ABSENT_CANNOT_BE_CLEARED current=72'), r.line('ROLLBACK').join('\n'));
    ok(r.line('ROLLBACK|NOTE').some((l) => l.includes('ABSENT') && l.includes('false')), r.line('ROLLBACK|NOTE').join('\n'));
    noPrivate(r.text, 'rollback');
  });
  await T('[٦] التراجع: hours كانت 168 ⟵ تعود 168 بإصدار جديد وhistory (بالإلحاق)', async () => {
    const seed = world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 168})}});
    const {file, db, w} = await writeThenRollbackWorld(seed);
    eq(w.code, 0, w.text); eq(settingsAfter(db).openBeforeValidityHours, 72); eq(settingsAfter(db).version, 4);
    const r = await run(ROLLBACK_ARGS(file), {db});
    eq(r.code, 0, r.text);
    eq(settingsAfter(db).openBeforeValidityHours, 168); eq(settingsAfter(db).version, 5); eq(settingsAfter(db).updatedBy, ACTOR);
    ok(db.store[HIST_COL]['3'] && db.store[HIST_COL]['4'], `history: ${Object.keys(db.store[HIST_COL] || {})}`);
    eq(db.store[HIST_COL]['4'].openBeforeValidityHours, 72, 'النسخة السابقة محفوظة');
    ok(r.out.includes('ROLLBACK|HOURS previous=168 action=WRITE'), r.line('ROLLBACK').join('\n'));
  });
  await T('[٦] التراجع: الجزآن كانا true/false صريحَين ⟵ يعودان كما كانا؛ وجزء آخر يبقى', async () => {
    const seed = world({users: {[PRIVATE.uidA]: userA({protocolParts: {purposes: false, batteryBeforeAfter: true, coldRepeat: true}})}});
    const {file, db} = await writeThenRollbackWorld(seed);
    deq(userAfter(db, PRIVATE.uidA).protocolParts, {purposes: true, batteryBeforeAfter: true, coldRepeat: true});
    const r = await run(ROLLBACK_ARGS(file), {db});
    eq(r.code, 0, r.text);
    deq(userAfter(db, PRIVATE.uidA).protocolParts, {purposes: false, batteryBeforeAfter: true, coldRepeat: true});
  });
  await T('[٦] التراجع لا يحذف شيئاً: لا علامة حذف في كل الكتابات، ولا مستند يختفي', async () => {
    const {file, db} = await writeThenRollbackWorld(world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 168})}}));
    const keysBefore = Object.keys(db.store.users).sort();
    const r = await run(ROLLBACK_ARGS(file), {db});
    eq(r.code, 0, r.text);
    ok(!JSON.stringify(db.writes).includes('__delete'), 'علامة حذف');
    deq(Object.keys(db.store.users).sort(), keysBefore);
    const fieldsBefore = Object.keys(userA({protocolParts: {}})).sort();
    deq(Object.keys(userAfter(db, PRIVATE.uidA)).sort(), fieldsBefore, 'مفتاح اختفى من المحلّ');
  });
  await T('[٦] التراجع: قراءة بعدية وفرق متوقَّع، ولا DIFF-UNEXPECTED', async () => {
    const {file, db} = await writeThenRollbackWorld(world({[SETTINGS_COL]: {[CUR]: SETTINGS_V3({openBeforeValidityHours: 168})}}));
    const r = await run(ROLLBACK_ARGS(file), {db});
    ok(r.line('DIFF|').length > 0 && !r.text.includes('DIFF-UNEXPECTED'), r.line('DIFF').join('\n'));
    deq(r.line('RESULT'), ['RESULT|OK mode=rollback exit=0 writes=2']);
    deq(r.line('ROLLBACK|AFTER'), ['ROLLBACK|AFTER openBeforeValidityHours=168 settingsVersion=5 purposes=false batteryBeforeAfter=false'], 'سطر الحال بعد التراجع');
  });
  await T('[٦] التراجع: فرق غير متوقَّع (كتابة جانبية) ⟵ exit 3', async () => {
    const {file, db} = await writeThenRollbackWorld(world());
    const r = await run(ROLLBACK_ARGS(file), {db, io: {afterTransaction: async ({db: d}) => { d.seed('users', PRIVATE.uidA, {...d.store.users[PRIVATE.uidA], plan: 'changed'}); }}});
    eq(r.code, 3);
  });
  await T('[٦] التراجع بلا --confirm صحيح ⟵ exit 4 بلا قراءة ولا كتابة (حتى مع نصّ تأكيد الكتابة)', async () => {
    const {file, db} = await writeThenRollbackWorld(world());
    for (const bad of [null, 'ROLLBACK', L.CONFIRM_WRITE]) {
      const reads0 = db.reads.length; const writes0 = writeCountOf(db);
      const argv = ['--mode', 'rollback', '--rollback-file', file, ...(bad === null ? [] : ['--confirm', bad])];
      const r = await run(argv, {db});
      eq(r.code, 4, `${bad}: ${r.code}`); eq(db.reads.length, reads0, 'قراءة'); eq(writeCountOf(db), writes0, 'كتابة');
    }
  });
  const badFiles = [
    ['ليس JSON', 'not json {'],
    ['schema مختلف', JSON.stringify({version: 2, writtenAtMs: 1, shopUid: 'u', projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['مفتاح ناقص (shopUid)', JSON.stringify({version: 1, writtenAtMs: 1, projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['مفتاح زائد', JSON.stringify({version: 1, writtenAtMs: 1, shopUid: 'u', projectId: PROJECT, target: 'PRODUCTION', extra: 1, previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['previous.purposes قيمة غريبة', JSON.stringify({version: 1, writtenAtMs: 1, shopUid: 'u', projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'maybe', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['previous.openBeforeValidityHours نصّ غريب', JSON.stringify({version: 1, writtenAtMs: 1, shopUid: 'u', projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'soon', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['shopUid فارغ', JSON.stringify({version: 1, writtenAtMs: 1, shopUid: '', projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}})],
    ['مصفوفة بدل كائن', '[]'],
  ];
  for (const [label, content] of badFiles) {
    await T(`[٦] ملفّ تراجع غير صالح (${label}) ⟵ exit 4 ROLLBACK_FILE_INVALID بلا قراءة db ولا كتابة`, async () => {
      const file = newFile(); fs.writeFileSync(file, content);
      const r = await run(ROLLBACK_ARGS(file));
      eq(r.code, 4, r.text); ok(r.text.includes('ROLLBACK_FILE_INVALID'), r.text); ok(r.db.reads.length === 0 && r.db.queries.length === 0 && writeCountOf(r.db) === 0, 'لمس db');
    });
  }
  await T('[٦] ملفّ تراجع غير موجود ⟵ exit 4 ROLLBACK_FILE_MISSING', async () => { const r = await run(ROLLBACK_ARGS(path.join(tmpDir, 'none.json'))); eq(r.code, 4); ok(r.text.includes('ROLLBACK_FILE_MISSING'), r.text); });
  await T('[٦] ملفّ تراجع لمشروع آخر أو وجهة أخرى ⟵ exit 4 ROLLBACK_FILE_TARGET_MISMATCH بلا قراءة', async () => {
    const mk = (over) => { const f = newFile(); fs.writeFileSync(f, JSON.stringify({version: 1, writtenAtMs: 1, shopUid: PRIVATE.uidA, projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}, ...over})); return f; };
    for (const over of [{projectId: 'demo-nc'}, {target: 'EMULATOR'}]) {
      const r = await run(ROLLBACK_ARGS(mk(over)));
      eq(r.code, 4, JSON.stringify(over)); ok(r.text.includes('ROLLBACK_FILE_TARGET_MISMATCH'), r.text); ok(r.db.reads.length === 0 && writeCountOf(r.db) === 0, 'لمس db');
    }
  });
  await T('[٦] محلّ ملفّ التراجع لم يعد موجوداً ⟵ exit 4 SHOP_NOT_FOUND ولا كتابة', async () => {
    const f = newFile(); fs.writeFileSync(f, JSON.stringify({version: 1, writtenAtMs: 1, shopUid: 'uid-gone', projectId: PROJECT, target: 'PRODUCTION', previous: {openBeforeValidityHours: 'ABSENT', settingsVersion: 'ABSENT', purposes: 'ABSENT', batteryBeforeAfter: 'ABSENT'}, afterVersions: {settingsVersion: 1}}));
    const r = await run(ROLLBACK_ARGS(f)); eq(r.code, 4); ok(r.text.includes('SHOP_NOT_FOUND'), r.text); eq(writeCountOf(r.db), 0);
  });
  await T('[٦] إصدار الإعدادات الآن غير المتوقَّع في الملفّ ⟵ تحذير مسمّى (WARN) لا رفض', async () => {
    const {file, db} = await writeThenRollbackWorld(world());
    db.seed(SETTINGS_COL, CUR, {...db.store[SETTINGS_COL][CUR], version: 9});
    const r = await run(ROLLBACK_ARGS(file), {db});
    eq(r.code, 0, r.text); ok(r.out.some((l) => l.startsWith('ROLLBACK|WARN settings-version-changed expected=4 current=9')), r.line('ROLLBACK').join('\n'));
  });
  await T('[٦] تراجع ثانٍ بالملفّ نفسه بعد الأوّل ⟵ يعمل بلا ضرر (غير المتغيّر لا يُكتب)', async () => {
    const {file, db} = await writeThenRollbackWorld(world());
    const r1 = await run(ROLLBACK_ARGS(file), {db});
    eq(r1.code, 0, r1.text);
    const w0 = writeCountOf(db);
    const r2 = await run(ROLLBACK_ARGS(file), {db});
    eq(r2.code, 0, r2.text); eq(writeCountOf(db), w0, 'كتابة ثانية'); ok(r2.line('RESULT')[0].startsWith('RESULT|UNCHANGED mode=rollback'), r2.line('RESULT').join());
  });

  // ═══ ٧ — بنية المصدر ═══
  await T('[٧] الملفّان موجودان', () => { ok(fs.existsSync(SCRIPT), 'السكربت'); ok(fs.existsSync(LIB), 'المكتبة'); });
  await T('[٧] لا حذف في أيّ مسار: لا delete ولا FieldValue.delete ولا recursiveDelete ولا bulkWriter ولا batch (القاعدة 42)', () => {
    for (const k of ['script', 'lib']) ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(|\bdeleteField\b|tx\.delete/.test(SRC[k]()), k);
  });
  await T('[٧] لا import لـutils/admin (التطبيق الافتراضي) ولا لدالّة Cloud Functions في الأداة', () => {
    for (const k of ['script', 'lib']) ok(!/utils\/admin|firebase-functions/.test(SRC[k]()), k);
  });
  await T('[٧] الدوالّ النقيّة من وحداتها لا نسخة: validateSettingsPatch وapplySettingsPatch وreadSettingsDocument وvalidatePartsPatch وchangedParts وreadProtocolParts', () => {
    const s = SRC.lib();
    for (const name of ['validateSettingsPatch', 'applySettingsPatch', 'readSettingsDocument', 'validatePartsPatch', 'changedParts', 'readProtocolParts']) ok(new RegExp(`\\b${name}\\b`).test(s), `${name} غير مستعملة`);
    ok(/require\(['"]\.\.\/\.\.\/src\/protocol\/settingsWrite['"]\)/.test(s) && /require\(['"]\.\.\/\.\.\/src\/protocol\/shopProtocol['"]\)/.test(s) && /require\(['"]\.\.\/\.\.\/src\/protocol\/protocolSettings['"]\)/.test(s), 'مصادر الاستيراد');
  });
  await T('[٧] لا حرفية لأسماء الحقول المتغيّرة في الأداة (من SETTINGS_FIELD وPROTOCOL_PART وPROTOCOL_COLLECTION وPROTOCOL_SETTINGS_PATH)', () => {
    const s = SRC.lib() + SRC.script();
    for (const lit of ['openBeforeValidityHours', 'batteryBeforeAfter', 'protocolSettings', 'history', 'supersededAt', 'reports', 'isActive', 'expiresAt']) {
      if (lit === 'supersededAt' || lit === 'history') continue; // حقول التاريخ يكتبها بالاسم نفسه الذي في protocolSettingsAdmin.js:85 (يثبّته اختبار التكافؤ e2e)
      ok(!new RegExp(`["'\`]${lit}["'\`]`).test(s), `حرفية "${lit}"`);
    }
  });
  await T('[٧] لا إشارة إلى reports ولا isActive ولا expiresAt في مصدر الأداة (لا تكتب ولا تقرأ ما يُطلق مشغّلاً)', () => { const s = SRC.lib() + SRC.script(); ok(!/\breports\b|\bisActive\b|\bexpiresAt\b|checkExpiringSubscriptions/.test(s), 'إشارة'); });
  await T('[٧] مسار المعاينة بلا أيّ API كتابة (.set( .update( .create( runTransaction batch)', () => {
    const s = SRC.lib();
    const a = s.indexOf('async function runPreview');
    ok(a >= 0, 'runPreview غير موجودة');
    const rest = s.slice(a + 10);
    const m = /\n(?:async )?function \w+/.exec(rest);
    const body = s.slice(a, a + 10 + (m ? m.index : rest.length));
    ok(body.length > 200, 'جسم قصير');
    ok(!/\.set\(|\.update\(|\.create\(|runTransaction|\.batch\(|\.add\(|FieldValue|writeRollbackFile|writeOutputExclusive/.test(body), 'كتابة في المعاينة');
  });
  await T('[٧] وسطاء الأمر تُقرأ مرّة واحدة (process.argv) في المدخل وحده', () => { eq((SRC.script().match(/process\.argv/g) || []).length, 1); eq((SRC.lib().match(/process\.argv/g) || []).length, 0); });
  await T('[٧] لا يُطبع نصّ خطأ المزوّد ولا stack (القاعدة 36): لا .message ولا .stack خارج الأخطاء المسمّاة', () => {
    const s = SRC.lib() + SRC.script();
    ok(!/\.stack\b/.test(s), '.stack');
    const msgSites = [...s.matchAll(/\.message\b/g)].length;
    ok(msgSites <= 1, `.message ${msgSites} مواضع`);
  });
  await T('[٧] الطباعة عبر out()/err() وحدهما (لا console.log في المكتبة)', () => { ok(!/console\.(log|info|warn|error)/.test(SRC.lib()), 'console في المكتبة'); });
  await T('[٧] updatedBy من hashIdForLog(ACTOR_TAG) لا من uid مشرف', () => { const s = SRC.lib(); ok(/hashIdForLog\(\s*ACTOR_TAG\s*\)/.test(s), 'لا hashIdForLog(ACTOR_TAG)'); ok(!/request\.auth|auth\.uid/.test(s), 'uid مشرف'); });
  await T('[٧] لا src يستورد الأداة (فلا تدخل قائمة النشر)', () => {
    const files = [];
    (function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(p); } })(path.join(FN, 'src'));
    const hits = files.filter((f) => /maintenanceSettings|set-maintenance-settings/.test(fs.readFileSync(f, 'utf8')));
    deq(hits, []);
    ok(!/maintenanceSettings|set-maintenance-settings/.test(fs.readFileSync(path.join(FN, 'index.js'), 'utf8')), 'index.js');
  });
  await T('[٧] رسم تبعيات كل دالّة مُصدَّرة في index.js لا يضمّ ملفّاً من scripts/', () => {
    const {deps, resolveFile} = require('../scripts/deploy-list.js');
    const idx = fs.readFileSync(path.join(FN, 'index.js'), 'utf8');
    const entries = [...idx.matchAll(/const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g)].map((m) => m[2]);
    ok(entries.length > 20, `مداخل ${entries.length}`);
    for (const e of entries) { const g = deps(path.join(FN, e)); for (const f of g) ok(!/[\\/]scripts[\\/]/.test(f), `${e} يضمّ ${f}`); }
    ok(resolveFile !== undefined, 'ضابط');
  });
  await T('[٧] ثوابت الأسماء المحلّية (users وprotocolParts) تطابق ما في كاتبَي الدوالّ (المصدر الواحد غير مُصدَّر هناك)', () => {
    const shopSrc = fs.readFileSync(path.join(FN, 'src', 'admin', 'shopProtocolAdmin.js'), 'utf8');
    ok(shopSrc.includes(`const USERS = "${L.USERS_COLLECTION}";`), 'USERS');
    ok(/tx\.update\(userRef, \{protocolParts: /.test(shopSrc) && L.SHOP_PARTS_FIELD === 'protocolParts', 'protocolParts');
    const setSrc = fs.readFileSync(path.join(FN, 'src', 'admin', 'protocolSettingsAdmin.js'), 'utf8');
    ok(/supersededAt: FieldValue\.serverTimestamp\(\), supersededByVersion: nextVersion, supersededBy: actor/.test(setSrc), 'حقول history');
    deq({...L.HISTORY_FIELD}, {SUPERSEDED_AT: 'supersededAt', SUPERSEDED_BY_VERSION: 'supersededByVersion', SUPERSEDED_BY: 'supersededBy'});
  });
  await T('[٧] --help يطبع الأوضاع الثلاثة والأعلام الدقيقة وأكواد الخروج وأمثلة، بلا أيّ اتصال', async () => {
    const r = await run(['--help']);
    eq(r.code, 0); eq(r.db.queries.length + r.db.reads.length, 0);
    for (const needle of ['--mode preview', '--mode write', '--mode rollback', '--shop', '--confirm', '--rollback-file', '--emulator', '--ascii-names', L.CONFIRM_WRITE, L.CONFIRM_ROLLBACK, 'PREVIEW|', 'PLAN|', 'WRITE|', 'DIFF|', 'RESULT|', 'exit']) ok(r.text.includes(needle), `ينقص ${needle}`);
    // مسار المثال بشرطة عكسية واحدة (يُنسخ كما هو في PowerShell): لا مضاعفة
    ok(r.text.includes('"C:\\evidence\\rollback-maintenance.json"') && !r.text.includes('C:\\\\evidence'), 'مسار المثال');
    ok(r.text.includes('escape non-ASCII characters of shop names as \\uXXXX'), 'علَم --ascii-names');
  });

  // ═══ ٨ — المدخل كعملية حقيقية (process.argv وprocess.exitCode) بلا شبكة: كل حالة ترفض قبل أيّ اتصال ═══
  const {spawnSync} = require('child_process');
  const spawnTool = (argv, env = {}) => spawnSync(process.execPath, [SCRIPT, ...argv], {encoding: 'utf8', timeout: 60000, env: {PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env}});
  await T('[٨] --help كعملية: exit 0 ويطبع الأوضاع', () => { const r = spawnTool(['--help']); eq(r.status, 0, r.stderr); ok(r.stdout.includes('--mode preview') && r.stdout.includes(L.CONFIRM_WRITE), r.stdout.slice(0, 200)); });
  await T('[٨] وسيط مجهول كعملية: exit 2 وسطر RESULT|USAGE ولا يُطبع قيمة الوسيط', () => {
    const r = spawnTool(['--mode', 'preview', `--secret=${PRIVATE.emailA}`]);
    eq(r.status, 2, r.stderr); ok(r.stdout.includes('RESULT|USAGE reason=UNKNOWN_ARGUMENT exit=2'), r.stdout); ok(!(r.stdout + r.stderr).includes(PRIVATE.emailA), 'قيمة مسرَّبة');
  });
  await T('[٨] كتابة بلا --confirm كعملية: exit 4 CONFIRM_MISSING قبل أيّ اتصال (لا ADC ولا شبكة)', () => {
    const r = spawnTool(['--mode', 'write', '--shop', 'some-uid', '--rollback-file', path.join(tmpDir, 'never-written.json')]);
    eq(r.status, 4, r.stderr); ok(r.stdout.includes('RESULT|REFUSED mode=write reason=CONFIRM_MISSING exit=4'), r.stdout); ok(!fs.existsSync(path.join(tmpDir, 'never-written.json')), 'ملفّ');
  });
  await T('[٨] إنتاج ومضيف محاكٍ مضبوط بلا --emulator كعملية: exit 5 قبل أيّ اتصال', () => {
    const r = spawnTool(['--mode', 'preview'], {FIRESTORE_EMULATOR_HOST: '127.0.0.1:1'});
    eq(r.status, 5, r.stderr); ok(r.stdout.includes('reason=EMULATOR_HOST_WITHOUT_FLAG exit=5'), r.stdout);
  });
  await T('[٨] تراجع بملفّ غير موجود كعملية: exit 4 ROLLBACK_FILE_MISSING قبل أيّ اتصال', () => {
    const r = spawnTool(['--mode', 'rollback', '--confirm', L.CONFIRM_ROLLBACK, '--rollback-file', path.join(tmpDir, 'absent.json')]);
    eq(r.status, 4, r.stderr); ok(r.stdout.includes('reason=ROLLBACK_FILE_MISSING exit=4'), r.stdout);
  });

  fs.rmSync(tmpDir, {recursive: true, force: true});
  if (failures.length > 0) {
    console.error(`\nsetMaintenanceSettings.test.js: ${failures.length} FAILED of ${n}`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`setMaintenanceSettings.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
