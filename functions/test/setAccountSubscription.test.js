'use strict';

// setAccountSubscription.test.js — السكربت set-account-subscription.js ومكتبته scripts/lib/setAccountSubscription.js وغلافه scripts/lib/subscriptionWriteGuard.js (ضبط انتهاء حسابات الشريك، 2026-10-14 +03).
// وحدة بلا شبكة ولا محاكٍ. الاستبدال معلَن (القاعدة 37): Firestore وAuth مزيَّفان في الذاكرة في هذا الاختبار وحده (db مزيَّف بمعاملة تُخزِّن الكتابات وتطبّقها عند النجاح). الطبقات الحقيقية — Firestore وAuth
// والسكربت بالأمر الذي يشغّله المستخدم في عملية فرعية — تُفحص في setAccountSubscription.e2e.test.js على المحاكي.
//
// ١ الوسائط · ٢ نهاية اليوم بـ+03 وتحليل الملفّ ورفضه · ٣ التخطيط والتحذيرات · ٤ الرمز · ٥ الغلاف وطفراته · ٦ التشغيل الجافّ (main) · ٧ الكتابة (main): الرمز البائت، كلّها أو لا شيء، القراءة اللاحقة
// · ٨ طفرات المكتبة (في الذاكرة) · ٩ الحارس الساكن وطفراته · ١٠ الفحص الذاتي
//
// الطفرات كلّها **في الذاكرة** (تُترجَم نسخة معدَّلة من المصدر بـModule._compile؛ لا يُكتب ملفّ ولا يُمسّ المصدر).
//
// Run: node functions/test/setAccountSubscription.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const {Timestamp, FieldValue} = require('firebase-admin/firestore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const SS = require('../scripts/lib/subscriptionState');
const L = require('../scripts/lib/setAccountSubscription');
const G = require('../scripts/lib/subscriptionWriteGuard');
const {main} = require('../scripts/set-account-subscription');
const {stripComments} = require('./lib/emulatorGuardInventory');

const FN = path.join(__dirname, '..');
const readSrc = (rel) => fs.readFileSync(path.join(FN, rel), 'utf8').replace(/\r\n/g, '\n');

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = Date.UTC(2026, 9, 14, 7, 30, 0); // 2026-10-14T10:30:00+03:00
const eod = (y, m, d) => Date.UTC(y, m - 1, d, 23, 59, 59, 999) - 3 * H; // نهاية اليوم بـ+03، محسوبة هنا مستقلّةً عن المكتبة
const ts = (ms) => Timestamp.fromMillis(ms);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'set-acct-sub-unit-'));
let counter = 0;
const nextPath = (ext = 'json') => path.join(tmp, `f-${++counter}.${ext}`);
const writeAccounts = (text) => { const p = nextPath('csv'); fs.writeFileSync(p, text); return p; };

// ───────────────────────── مزيَّفات ─────────────────────────
const EMAIL = {A: 'gharir.shop.a.SECRET@example.test', B: 'gharir.shop.b.SECRET@example.test', C: 'gharir.shop.c.SECRET@example.test', D: 'gharir.shop.d.SECRET@example.test'};
const UID = {A: 'uid-A-SECRET-111111', B: 'uid-B-SECRET-222222', C: 'uid-C-SECRET-333333', D: 'uid-D-SECRET-444444'};
const SECRET_VALUES = ['SECRET-FCM-TOKEN', 'SECRET-NAME', 'SECRET-PHONE', 'secret-shop-slug'];

function makeAuth(map = {[EMAIL.A]: UID.A, [EMAIL.B]: UID.B, [EMAIL.C]: UID.C, [EMAIL.D]: UID.D}) {
  const calls = [];
  const lower = Object.fromEntries(Object.entries(map).map(([e, u]) => [e.toLowerCase(), u]));
  return {
    calls,
    getUserByEmail: async (email) => {
      calls.push('getUserByEmail');
      const uid = lower[String(email).toLowerCase()];
      if (!uid) throw Object.assign(new Error(`There is no user record corresponding to the provided identifier: ${email}`), {code: 'auth/user-not-found'});
      return {uid};
    },
  };
}

/**
 * db مزيَّف بمعاملة: الكتابات داخل المعاملة تُخزَّن وتُطبَّق عند النجاح وحده (كلّها أو لا شيء)؛ وأيّ كتابة مباشرة (مرجع/دفعة/bulk) تُسجَّل في log.directWrites وترمي.
 * opts: afterCommit(users) · txError (يُرمى بعد التطبيق: «خطأ مزوّد بعد التثبيت») · readFailsAfterCommit.
 */
function makeTxDb(initial, opts = {}) {
  const users = new Map(Object.entries(initial).map(([k, v]) => [k, {...v}]));
  const log = {reads: [], ops: [], directWrites: [], txCount: 0, txReads: 0};
  let committed = false;
  const snap = (uid) => ({id: uid, exists: users.has(uid), data: () => (users.has(uid) ? {...users.get(uid)} : undefined)}); // نسخة جديدة في كل قراءة، كما يفعل Firestore (وTimestamp غير قابل للتعديل)
  const direct = (name) => () => { log.directWrites.push(name); throw new Error(`fake: direct write ${name}`); };
  const refOf = (col, id) => ({
    id, path: `${col}/${id}`,
    get: async () => {
      if (opts.readFailsAfterCommit && committed) throw Object.assign(new Error('provider read failure SECRET-PROVIDER-TEXT'), {code: 14});
      log.reads.push(`doc:${col}/${id}`);
      return snap(id);
    },
    set: direct('doc.set'), update: direct('doc.update'), delete: direct('doc.delete'), create: direct('doc.create'),
  });
  return {
    users, log,
    collection: (col) => ({doc: (id) => refOf(col, id), add: direct('collection.add')}),
    batch: direct('db.batch'), bulkWriter: direct('db.bulkWriter'), recursiveDelete: direct('db.recursiveDelete'),
    runTransaction: async (fn) => {
      log.txCount++;
      const buffered = [];
      const record = (op) => (ref, data, ...rest) => { buffered.push({op, path: ref.path, id: ref.id, data, restLength: rest.length}); return tx; };
      const tx = {
        getAll: async (...refs) => { log.txReads++; log.reads.push(`tx.getAll:${refs.map((r) => r.path).join(',')}`); return refs.map((r) => snap(r.id)); },
        get: async (ref) => { log.txReads++; return snap(ref.id); },
        update: record('update'), set: record('set'), create: record('create'), delete: record('delete'),
      };
      const result = await fn(tx);
      for (const b of buffered) {
        if (b.op !== 'update') throw new Error(`fake: only update is applied, got ${b.op}`);
        if (!users.has(b.id)) throw new Error('fake: update on a missing doc');
      }
      for (const b of buffered) {
        Object.assign(users.get(b.id), b.data);
        log.ops.push({op: b.op, path: b.path, keys: Object.keys(b.data), restLength: b.restLength});
      }
      committed = true;
      if (opts.afterCommit) opts.afterCommit(users);
      if (opts.txError) throw opts.txError;
      return result;
    },
  };
}

const baseUsers = () => ({
  [UID.A]: {
    plan: 'shop_pro', scansRemaining: 12, scansTotal: 100, isActive: true, expiresAt: ts(NOW - 2 * H),
    subExpiredNotified: true, subExpiredAt: ts(NOW - 90 * 60 * 1000), subExpiryEmailSent: true, subExpiryFcmDate: '2026-10-13',
    email: EMAIL.A, fcmToken: 'SECRET-FCM-TOKEN-A', name: 'SECRET-NAME-A', phone: 'SECRET-PHONE-A', shopSlug: 'secret-shop-slug', freeTrialUsedDevices: ['m1_14_8'],
  },
  [UID.B]: {plan: 'shop_basic', scansRemaining: 0, scansTotal: 50, isActive: false, expiresAt: '2026-10-10T00:00:00.000Z', email: EMAIL.B, name: 'SECRET-NAME-B'},
  [UID.C]: {plan: 'free', scansRemaining: 3, scansTotal: 3, isActive: true, expiresAt: ts(NOW + 30 * D), fcmToken: 'SECRET-FCM-TOKEN-C', phone: 'SECRET-PHONE-C'},
  [UID.D]: {plan: 'shop_pro', isActive: true, expiresAt: ts(NOW + 2 * D)}, // الرصيد والإجمالي غائبان
});

/** صورة المخزن كلّه بالأنواع والقيم (Timestamp بثوانيه ونانوثانيه) للمقارنة بايتاً بايتاً. */
const snapshotUsers = (db) => JSON.stringify([...db.users.entries()].map(([k, v]) => [k, Object.keys(v).sort().map((f) => [f, v[f] && typeof v[f].toMillis === 'function' ? `ts:${v[f].seconds}.${v[f].nanoseconds}` : v[f]])]));

const THREE_LINES = `# gharir accounts (comment lines are not counted)\n${EMAIL.A},2026-10-20,add:5\n${EMAIL.B},2026-10-25,set:30\n${EMAIL.C},2026-10-18\n`;

const run = async (argv, {db, auth = makeAuth(), now = NOW, env = {}} = {}) => {
  const outs = [];
  const errs = [];
  const code = await main(argv, {env, now: () => now, db, auth, out: (s) => outs.push(s), err: (s) => errs.push(s)});
  return {code, stdout: outs.join('\n'), stderr: errs.join('\n')};
};
const leaksIn = (...texts) => {
  const needles = [...Object.values(EMAIL), ...Object.values(UID), ...Object.values(EMAIL).map((e) => e.split('@')[0]), ...SECRET_VALUES, 'SECRET'];
  return needles.filter((s) => texts.some((t) => typeof t === 'string' && t.includes(s)));
};
const rejectedCodes = (e) => (e && e.rejections ? e.rejections.map((r) => `${r.line === null ? '-' : r.line}:${r.code}`) : null);
const thrown = (fn) => { try { fn(); } catch (e) { return e; } return null; };
const thrownAsync = async (fn) => { try { await fn(); } catch (e) { return e; } return null; };

/** يترجم نسخة معدَّلة من مصدر في الذاكرة (لا كتابة ولا مسّ بالملفّ). */
function loadMutant(rel, from, to) {
  const file = path.join(FN, rel);
  const src = fs.readFileSync(file, 'utf8');
  ok(src.includes(from), `[طفرة] النصّ المستهدَف موجود في ${rel}: ${from.slice(0, 60)}`);
  const mutated = src.replace(from, to);
  ok(mutated !== src, `[طفرة] التعديل غيّر المصدر: ${rel}`);
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(mutated, file);
  return m.exports;
}

(async () => {
  // ═══ ١ — الوسائط ═══
  const pa = L.parseArgs;
  const T64 = 'b'.repeat(64);
  deq(pa(['--dry-run', '--accounts', 'f.csv']), {mode: 'dry-run', accounts: 'f.csv', token: null, out: null}, '[١] --dry-run مع ملفّ');
  deq(pa(['--dry-run', '--accounts', 'f.csv', '--out', 'o.json']), {mode: 'dry-run', accounts: 'f.csv', token: null, out: 'o.json'}, '[١] --dry-run مع --out');
  deq(pa(['--commit', '--accounts', 'f.csv', '--token', T64]), {mode: 'commit', accounts: 'f.csv', token: T64, out: null}, '[١] --commit مع رمز');
  deq(pa(['--preflight']), {mode: 'preflight'}, '[١] --preflight');
  const bad = (argv, code, m) => {
    const e = thrown(() => pa(argv));
    ok(e && e.reason === code, `${m} — ${e && e.reason}`);
    return e;
  };
  bad([], 'MODE_NOT_EXPLICIT', '[١] بلا وسائط: وضع غير صريح');
  bad(['--accounts', 'f.csv'], 'MODE_NOT_EXPLICIT', '[١] ملفّ بلا وضع: غير صريح');
  bad(['--dry-run', '--commit', '--accounts', 'f.csv', '--token', T64], 'MODE_CONFLICT', '[١] الوضعان معاً');
  bad(['--commit', '--accounts', 'f.csv'], 'TOKEN_REQUIRED', '[١] --commit بلا --token');
  bad(['--commit', '--accounts', 'f.csv', '--token', 'abc'], 'TOKEN_FORMAT_INVALID', '[١] رمز قصير');
  bad(['--commit', '--accounts', 'f.csv', '--token', 'B'.repeat(64)], 'TOKEN_FORMAT_INVALID', '[١] رمز بحروف كبيرة: يُرفض (سداسي صغير فقط)');
  bad(['--dry-run', '--accounts', 'f.csv', '--token', T64], 'TOKEN_NOT_ALLOWED_IN_DRY_RUN', '[١] --token مع --dry-run');
  bad(['--dry-run'], 'ACCOUNTS_FILE_REQUIRED', '[١] بلا --accounts');
  bad(['--preflight', '--accounts', 'f.csv'], 'USAGE_PREFLIGHT_ALONE', '[١] --preflight مع غيرها');
  bad(['--preflight', '--dry-run'], 'USAGE_PREFLIGHT_ALONE', '[١] --preflight مع --dry-run');
  bad(['--dry-run', '--dry-run', '--accounts', 'f'], 'USAGE_DUPLICATE_ARGUMENT', '[١] علم مكرَّر');
  bad(['--dry-run', '--accounts', 'a', '--accounts', 'b'], 'USAGE_DUPLICATE_ARGUMENT', '[١] قيمة مكرَّرة');
  bad(['--dry-run', '--accounts'], 'USAGE_VALUE_MISSING', '[١] --accounts بلا قيمة');
  bad(['--dry-run', '--accounts', '--out', 'x'], 'USAGE_VALUE_MISSING', '[١] --accounts يليه وسيط');
  {
    const e = bad(['--dry-run', '--accounts', 'f', '--email=owner.cli.SECRET@example.test'], 'USAGE_UNKNOWN_ARGUMENT', '[١] البريد لا يُقبل من سطر الأمر');
    ok(!C.safeErrorText(e).includes('SECRET') && !e.message.includes('SECRET'), '[١] ولا يُنسخ الوسيط إلى نصّ الخطأ (قد يحمل بريداً)');
    const e2 = bad(['owner.cli.SECRET@example.test'], 'USAGE_UNKNOWN_ARGUMENT', '[١] وسيط موضعي (بريد) مرفوض');
    ok(!C.safeErrorText(e2).includes('SECRET'), '[١] ولا يُنسخ الموضعيّ');
  }

  // ═══ ٢ — نهاية اليوم بـ+03 وتحليل الملفّ ورفضه ═══
  eq(L.endOfDayPlus03Ms('2026-10-14'), Date.UTC(2026, 9, 14, 20, 59, 59, 999), '[٢] نهاية 2026-10-14 بـ+03 = 20:59:59.999 UTC');
  eq(SS.toPlus03(L.endOfDayPlus03Ms('2026-10-14')), '2026-10-14T23:59:59.999+03:00', '[٢] وتُطبَع بقيمتها المطلقة 23:59:59.999+03:00');
  eq(L.endOfDayPlus03Ms('2026-12-31'), Date.UTC(2026, 11, 31, 20, 59, 59, 999), '[٢] آخر السنة');
  eq(L.endOfDayPlus03Ms('2028-02-29'), Date.UTC(2028, 1, 29, 20, 59, 59, 999), '[٢] 29 شباط في سنة كبيسة مقبول');
  for (const badDate of ['2027-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00', '2026-1-4', '26-10-14', '2026/10/14', '2026-10-14T00:00', '', ' 2026-10-14', '14-10-2026', '2026-10-1x', '0099-01-01x']) {
    eq(L.endOfDayPlus03Ms(badDate), null, `[٢] تاريخ غير مقروء: «${badDate}»`);
  }
  eq(L.endOfDayPlus03Ms('0099-01-01'), null, '[٢] السنوات 0000-0099 تُرفض غير مقروءة (JS يحوّلها إلى 19xx؛ فحص الذهاب والإياب يكشف ذلك)');
  // حدّ الماضي: نهاية اليوم <= الآن مرفوضة
  const dayEnd = L.endOfDayPlus03Ms('2026-10-14');
  const parse1 = (text, now) => L.parseAccountsText(text, now);
  const line1 = `${EMAIL.A},2026-10-14`;
  eq(rejectedCodes(thrown(() => parse1(line1, dayEnd)))[0], '1:DATE_IN_PAST', '[٢] الآن = نهاية اليوم تماماً ⟵ ماضٍ');
  eq(rejectedCodes(thrown(() => parse1(line1, dayEnd + 1)))[0], '1:DATE_IN_PAST', '[٢] بعد نهاية اليوم بميلّي ثانية ⟵ ماضٍ');
  eq(parse1(line1, dayEnd - 1).length, 1, '[٢] قبل نهاية اليوم بميلّي ثانية ⟵ يُقبَل');
  eq(parse1(line1, NOW).length, 1, '[٢] اليوم نفسه قبل منتصف الليل +03 ⟵ يُقبَل');
  eq(rejectedCodes(thrown(() => parse1(`${EMAIL.A},2026-10-13`, NOW)))[0], '1:DATE_IN_PAST', '[٢] أمس ⟵ ماضٍ');
  eq(rejectedCodes(thrown(() => parse1(line1, Date.UTC(2026, 9, 14, 21, 0, 0))))[0], '1:DATE_IN_PAST', '[٢] 21:00 UTC = 00:00 بـ+03 من اليوم التالي ⟵ يومُه الماضي مرفوض');

  {
    const e = parse1(`${EMAIL.A},2026-10-20 \n  ${EMAIL.B} , 2026-10-21 , set:0 \r\n\r\n# c\n   # indented comment\n${EMAIL.C},2026-10-22,add:1`, NOW);
    deq(e.map((x) => [x.line, x.email, x.date, x.balance]), [[1, EMAIL.A, '2026-10-20', null], [2, EMAIL.B, '2026-10-21', {mode: 'set', n: 0}], [6, EMAIL.C, '2026-10-22', {mode: 'add', n: 1}]],
        '[٢] تحليل: فراغات وCRLF وتعليقات وأرقام السطور الأصلية، set:0 وadd:1 مقبولان');
  }
  {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push(`u${i}@example.test,2026-10-20`);
    eq(parse1(`${lines.join('\n')}\n# c1\n# c2\n\n\n# c3\n`, NOW).length, 10, '[٢] عشرة أسطر حسابات + تعليقات وفراغ كثير ⟵ مقبول (التعليقات لا تُعدّ)');
    const e = thrown(() => parse1(`${lines.join('\n')}\nu10@example.test,2026-10-20`, NOW));
    deq(rejectedCodes(e), ['-:TOO_MANY_LINES'], '[٢] أحد عشر سطراً ⟵ TOO_MANY_LINES');
    deq(rejectedCodes(thrown(() => parse1('# only comments\n\n', NOW))), ['-:NO_ACCOUNT_LINES'], '[٢] لا أسطر حسابات ⟵ NO_ACCOUNT_LINES');
    deq(rejectedCodes(thrown(() => parse1('', NOW))), ['-:NO_ACCOUNT_LINES'], '[٢] ملفّ فارغ');
  }
  {
    // عشرة أسطر كحدّ أقصى: كل حالات الرفض في مجموعتين (الحدّ نفسه يُرفض قبل التحليل)
    const group1 = [
      'no-comma-at-all', // 1
      'line2-single-field@example.test', // 2: حقل واحد
      'line3@example.test,2026-10-20,add:5,extra', // 3: أربعة حقول
      'not-an-email,2026-10-20', // 4
      'line5@example.test,2026-02-30', // 5
      'line6@example.test,2026-10-13', // 6 (ماضٍ)
      'line7@example.test,2026-10-20,add:0', // 7
      'line8@example.test,2026-10-20,add:-3', // 8
      'line9@example.test,2026-10-20,set:-1', // 9
      'line10@example.test,2026-10-20,set:1.5', // 10
    ].join('\n');
    const e1 = thrown(() => parse1(group1, NOW));
    deq(rejectedCodes(e1), [
      '1:LINE_FORMAT_INVALID', '2:LINE_FORMAT_INVALID', '3:LINE_FORMAT_INVALID', '4:EMAIL_INVALID', '5:DATE_UNREADABLE', '6:DATE_IN_PAST',
      '7:N_OUT_OF_RANGE', '8:N_OUT_OF_RANGE', '9:N_OUT_OF_RANGE', '10:N_NOT_AN_INTEGER',
    ], '[٢] المجموعة ١: كل حالات الرفض تُجمَع بأرقام أسطرها (add:0 وadd:-3 وset:-1 خارج النطاق، وset:1.5 ليس صحيحاً)');
    ok(leaksIn(e1.message, C.safeErrorText(e1)).length === 0 && !e1.message.includes('not-an-email') && !e1.message.includes('example.test') && !e1.message.includes('2026-'), '[٢] رسالة الرفض: رموز وأرقام أسطر فقط — لا بريد ولا نصّ سطر ولا تاريخ');
    ok(/^REJECTED: line 1 LINE_FORMAT_INVALID; /.test(e1.message), '[٢] صيغة الرسالة');
    const group2 = [
      'line1@example.test,2026-10-20,add:abc', // 1
      'line2@example.test,2026-10-20,set:', // 2
      'line3@example.test,2026-10-20,plus:5', // 3
      'line4@example.test,2026-10-20,SET:5', // 4
      'line5@example.test,2026-10-20,set:007', // 5
      'line6@example.test,2026-10-20,set:-0', // 6
      'line7@example.test,2026-10-20,set:1e3', // 7
      'line8@example.test,2026-10-20,set:99999999999999999999', // 8
      `${EMAIL.D},2026-10-20`, // 9 (سليم)
      `${EMAIL.D.toUpperCase()},2026-10-21`, // 10 (مكرَّر ببريد بحروف كبيرة)
    ].join('\n');
    deq(rejectedCodes(thrown(() => parse1(group2, NOW))), [
      '1:N_NOT_AN_INTEGER', '2:N_NOT_AN_INTEGER', '3:BALANCE_DIRECTIVE_INVALID', '4:BALANCE_DIRECTIVE_INVALID', '5:N_NOT_AN_INTEGER', '6:N_NOT_AN_INTEGER',
      '7:N_NOT_AN_INTEGER', '8:N_NOT_AN_INTEGER', '10:DUPLICATE_ACCOUNT',
    ], '[٢] المجموعة ٢: add:abc وset: وset:007 وset:-0 وset:1e3 والعدد الأكبر من الآمن ⟵ N_NOT_AN_INTEGER؛ plus:5 وSET:5 ⟵ BALANCE_DIRECTIVE_INVALID؛ السطر 9 سليم، والسطر 10 مكرَّر');
  }

  // قراءة الملفّ
  {
    const raw = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(`${EMAIL.A},2026-10-20\r\n`, 'utf8')]);
    const p = nextPath('csv');
    fs.writeFileSync(p, raw);
    const r = L.readAccountsFile(p);
    eq(r.text.charCodeAt(0) === 0xFEFF, false, '[٢] BOM يُنزَع');
    eq(L.parseAccountsText(r.text, NOW)[0].email, EMAIL.A, '[٢] وأوّل سطر بعد BOM يُقرأ سليماً');
    eq(r.sha256, require('crypto').createHash('sha256').update(raw).digest('hex'), '[٢] بصمة الملفّ = sha256 للبايتات الخام (مع BOM)');
    eq(r.bytes, raw.length, '[٢] عدد البايتات');
  }
  const fileErr = (p) => (thrown(() => L.readAccountsFile(p)) || {}).reason;
  eq(fileErr(path.join(tmp, 'no-such-file.csv')), 'ACCOUNTS_FILE_MISSING', '[٢] ملفّ غائب ⟵ ACCOUNTS_FILE_MISSING');
  eq(fileErr(tmp), 'ACCOUNTS_FILE_UNREADABLE', '[٢] مجلّد بدل ملفّ ⟵ ACCOUNTS_FILE_UNREADABLE');
  {
    const big = nextPath('csv');
    fs.writeFileSync(big, `#${'x'.repeat(L.MAX_FILE_BYTES)}\n`);
    eq(fileErr(big), 'ACCOUNTS_FILE_TOO_LARGE', '[٢] ملفّ أكبر من الحدّ ⟵ ACCOUNTS_FILE_TOO_LARGE');
    const notUtf8 = nextPath('csv');
    fs.writeFileSync(notUtf8, Buffer.from([0x61, 0xC3, 0x28, 0x0A]));
    eq(fileErr(notUtf8), 'ACCOUNTS_FILE_NOT_UTF8', '[٢] بايتات غير UTF-8 ⟵ ACCOUNTS_FILE_NOT_UTF8');
    const e = thrown(() => L.readAccountsFile(path.join(tmp, 'secret-looking-owner@example.test.csv')));
    ok(e && !C.safeErrorText(e).includes('owner@example'), '[٢] مسار الملفّ لا يظهر في نصّ الخطأ');
  }

  // ═══ ٣ — التخطيط والتحذيرات ═══
  const entry = (extra = {}) => ({line: 1, email: EMAIL.A, date: '2026-10-20', endOfDayMs: eod(2026, 10, 20), balance: null, ...extra});
  const plan = (userData, balance) => L.planAccount({entry: entry({balance}), userData});
  {
    const p = plan({scansRemaining: 12, scansTotal: 100}, null);
    deq(Object.keys(p.writes), ['expiresAt'], '[٣] بلا توجيه: expiresAt وحده');
    ok(p.writes.expiresAt instanceof Timestamp && p.writes.expiresAt.toMillis() === eod(2026, 10, 20), '[٣] expiresAt من نوع Timestamp وبنهاية اليوم +03');
    deq(p.rejections, [], '[٣] بلا رفض');
    const s = plan({scansRemaining: 12, scansTotal: 100}, {mode: 'set', n: 30});
    deq([Object.keys(s.writes).sort(), s.writes.scansRemaining], [['expiresAt', 'scansRemaining'], 30], '[٣] set:30 ⟵ scansRemaining=30 وscansTotal لا يُكتب');
    const s0 = plan({scansRemaining: 12, scansTotal: 100}, {mode: 'set', n: 0});
    eq(s0.writes.scansRemaining, 0, '[٣] set:0 مقبول (التصفير بطلب صريح)');
    const sAbsent = plan({}, {mode: 'set', n: 7});
    deq([sAbsent.rejections, sAbsent.writes.scansRemaining], [[], 7], '[٣] set على رصيد غائب مقبول (لا يقرأ الحالي)');
    const a = plan({scansRemaining: 12, scansTotal: 100}, {mode: 'add', n: 5});
    deq([a.writes.scansRemaining, a.writes.scansTotal], [17, 105], '[٣] add:5 ⟵ الرصيد 12+5=17 والإجمالي 100+5=105');
    const aZero = plan({scansRemaining: 0, scansTotal: 0}, {mode: 'add', n: 5});
    deq([aZero.writes.scansRemaining, aZero.writes.scansTotal], [5, 5], '[٣] add على رصيد صفر حقيقي (0 رقم لا غياب)');
    const aNeg = plan({scansRemaining: -1, scansTotal: 10}, {mode: 'add', n: 3});
    deq([aNeg.rejections, aNeg.writes.scansRemaining], [[], 2], '[٣] رصيد حالي -1 + 3 = 2 ≥ 0 مقبول');
    deq(plan({scansRemaining: -5, scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['NEGATIVE_BALANCE_RESULT'], '[٣] رصيد حالي -5 + 2 = -3 ⟵ NEGATIVE_BALANCE_RESULT');
    deq(plan({scansRemaining: 5, scansTotal: -9}, {mode: 'add', n: 2}).rejections, ['NEGATIVE_BALANCE_RESULT'], '[٣] إجمالي ناتج سالب ⟵ NEGATIVE_BALANCE_RESULT');
    deq(plan({scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER'], '[٣][القاعدة 22] add والرصيد غائب ⟵ يُرفض (لا يُقرأ صفراً)');
    deq(plan({scansRemaining: null, scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER'], '[٣] الرصيد null ⟵ يُرفض');
    deq(plan({scansRemaining: '5', scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER'], '[٣] الرصيد نصّ "5" ⟵ يُرفض');
    deq(plan({scansRemaining: NaN, scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER'], '[٣] الرصيد NaN ⟵ يُرفض');
    deq(plan({scansRemaining: Infinity, scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER'], '[٣] الرصيد Infinity ⟵ يُرفض');
    deq(plan({scansRemaining: 2.5, scansTotal: 10}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_NOT_AN_INTEGER'], '[٣] الرصيد كسر ⟵ يُرفض');
    deq(plan({scansRemaining: 5}, {mode: 'add', n: 2}).rejections, ['CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER'], '[٣] add والإجمالي غائب ⟵ يُرفض (افتراض مُعلَن)');
    deq(plan({scansRemaining: 5, scansTotal: 1.5}, {mode: 'add', n: 2}).rejections, ['CURRENT_TOTAL_NOT_AN_INTEGER'], '[٣] إجمالي كسر ⟵ يُرفض');
    deq(plan({}, {mode: 'add', n: 2}).rejections, ['CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER', 'CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER'], '[٣] الاثنان غائبان ⟵ الرفضان معاً');
    deq(plan({scansRemaining: Number.MAX_SAFE_INTEGER, scansTotal: 1}, {mode: 'add', n: 5}).rejections, ['RESULT_NOT_A_SAFE_INTEGER'], '[٣] ناتج يتجاوز العدد الآمن ⟵ RESULT_NOT_A_SAFE_INTEGER');
  }
  {
    const W = (u, newMs = eod(2026, 10, 20)) => L.warningsFor(u, newMs);
    const codes = (u, newMs) => W(u, newMs).map((x) => `${x.code}${x.field ? `:${x.field}` : ''}`);
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW)}), [], '[٣] حساب نظيف ⟵ لا تحذير');
    deq(codes({plan: 'shop_basic', isActive: true, expiresAt: ts(NOW)}), [], '[٣] shop_basic نظيف');
    deq(codes({plan: 'free', isActive: true, expiresAt: ts(NOW)}), ['PLAN_NOT_SHOP:plan'], '[٣] plan=free ⟵ PLAN_NOT_SHOP');
    deq(codes({isActive: true, expiresAt: ts(NOW)}), ['PLAN_NOT_SHOP:plan'], '[٣] plan غائب ⟵ PLAN_NOT_SHOP (والغياب مكتوب في detail)');
    ok(W({isActive: true, expiresAt: ts(NOW)})[0].detail.includes('absent'), '[٣] detail يقول absent');
    deq(codes({plan: 7, isActive: true, expiresAt: ts(NOW)}), ['PLAN_NOT_SHOP:plan'], '[٣] plan رقم ⟵ PLAN_NOT_SHOP');
    deq(codes({plan: 'shop pro', isActive: true, expiresAt: ts(NOW)}), ['PLAN_NOT_SHOP:plan'], '[٣] plan نصّ غير قابل للطباعة ⟵ PLAN_NOT_SHOP');
    deq(codes({plan: 'shop_pro', isActive: false, expiresAt: ts(NOW)}), ['IS_ACTIVE_FALSE:isActive'], '[٣] isActive=false ⟵ IS_ACTIVE_FALSE');
    deq(codes({plan: 'shop_pro', expiresAt: ts(NOW)}), ['IS_ACTIVE_NOT_A_BOOLEAN:isActive'], '[٣] isActive غائب ⟵ IS_ACTIVE_NOT_A_BOOLEAN (القاعدة 22: ليس false ولا true)');
    deq(codes({plan: 'shop_pro', isActive: 'yes', expiresAt: ts(NOW)}), ['IS_ACTIVE_NOT_A_BOOLEAN:isActive'], '[٣] isActive نصّ ⟵ IS_ACTIVE_NOT_A_BOOLEAN');
    for (const f of ['subExpiredNotified', 'subExpiryEmailSent']) {
      deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW), [f]: true}), [`FLAG_SET:${f}`], `[٣] ${f}=true ⟵ FLAG_SET`);
      deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW), [f]: false}), [], `[٣] ${f}=false ⟵ ليس مضبوطاً`);
      deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW), [f]: null}), [], `[٣] ${f}=null ⟵ ليس مضبوطاً`);
    }
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW), subExpiryFcmDate: '2026-10-13'}), ['FLAG_SET:subExpiryFcmDate'], '[٣] subExpiryFcmDate مضبوط ⟵ FLAG_SET');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(NOW), subExpiredAt: ts(NOW - H)}), ['FLAG_SET:subExpiredAt'], '[٣] subExpiredAt مضبوط ⟵ FLAG_SET');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: '2026-10-10T00:00:00.000Z'}), ['EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt'], '[٣] expiresAt نصّ ⟵ EXPIRES_AT_NOT_A_TIMESTAMP');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: Date.UTC(2026, 9, 10)}), ['EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt'], '[٣] expiresAt رقم ⟵ EXPIRES_AT_NOT_A_TIMESTAMP');
    deq(codes({plan: 'shop_pro', isActive: true}), ['EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt'], '[٣] expiresAt غائب ⟵ EXPIRES_AT_NOT_A_TIMESTAMP');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: null}), ['EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt'], '[٣] expiresAt=null ⟵ EXPIRES_AT_NOT_A_TIMESTAMP');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(eod(2026, 10, 25))}), ['NEW_EXPIRY_EARLIER_THAN_CURRENT:expiresAt'], '[٣] التاريخ الجديد أقدم من الحالي (Timestamp) ⟵ NEW_EXPIRY_EARLIER_THAN_CURRENT');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: ts(eod(2026, 10, 20))}), [], '[٣] مساوٍ للحالي ⟵ لا تحذير (ليس أقدم)');
    deq(codes({plan: 'shop_pro', isActive: true, expiresAt: '2026-10-25T00:00:00.000Z'}), ['EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt', 'NEW_EXPIRY_EARLIER_THAN_CURRENT:expiresAt'], '[٣] نصّ ISO أحدث من الجديد ⟵ تحذيران (النوع والأقدمية بفهم البوّابة)');
    ok(W({plan: 'shop_pro', isActive: true, expiresAt: ts(eod(2026, 10, 25))})[0].detail.includes('2026-10-25T23:59:59.999+03:00') && W({plan: 'shop_pro', isActive: true, expiresAt: ts(eod(2026, 10, 25))})[0].detail.includes('2026-10-20T23:59:59.999+03:00'), '[٣] تحذير الأقدمية يطبع القيمتين مطلقتين بـ+03');
    eq(codes({plan: 'free', isActive: false, expiresAt: '2026-10-25T00:00:00.000Z', subExpiredNotified: true, subExpiryEmailSent: true, subExpiryFcmDate: 'x', subExpiredAt: ts(NOW)}).length, 8, '[٣] كل التحذيرات معاً: plan + isActive + أربعة أعلام + النوع + الأقدمية = 8');
  }

  // ═══ ٤ — الرمز ═══
  {
    const base = () => ({projectId: C.PROJECT_ID, fileSha256: 'a'.repeat(64), accounts: [
      {line: 1, uid: UID.A, userData: {scansRemaining: 12, scansTotal: 100, expiresAt: ts(NOW), plan: 'shop_pro'}, writes: {expiresAt: ts(eod(2026, 10, 20)), scansRemaining: 17, scansTotal: 105}},
      {line: 2, uid: UID.B, userData: {scansRemaining: 0, scansTotal: 50, expiresAt: '2026-10-10'}, writes: {expiresAt: ts(eod(2026, 10, 25)), scansRemaining: 30}},
    ]});
    const t0 = L.computeToken(base());
    ok(/^[0-9a-f]{64}$/.test(t0), '[٤] الرمز 64 خانة سداسية');
    eq(L.computeToken(base()), t0, '[٤] حتمي: المدخلات نفسها ⟵ الرمز نفسه');
    ok(leaksIn(t0).length === 0, '[٤] الرمز لا يحمل بريداً ولا uid');
    const changed = (mut) => { const b = base(); mut(b); return L.computeToken(b) !== t0; };
    ok(changed((b) => { b.projectId = 'other'; }), '[٤] يتغيّر بتغيّر المشروع');
    ok(changed((b) => { b.fileSha256 = 'c'.repeat(64); }), '[٤] يتغيّر ببصمة الملفّ');
    ok(changed((b) => { b.accounts[0].uid = 'other-uid'; }), '[٤] يتغيّر بـuid');
    ok(changed((b) => { b.accounts.reverse(); }), '[٤] يتغيّر بترتيب الحسابات');
    ok(changed((b) => { b.accounts.pop(); }), '[٤] يتغيّر بعدد الحسابات');
    ok(changed((b) => { b.accounts[0].line = 9; }), '[٤] يتغيّر برقم السطر');
    ok(changed((b) => { b.accounts[0].userData.scansRemaining = 11; }), '[٤] يتغيّر بـ«قبل» لـscansRemaining');
    ok(changed((b) => { b.accounts[0].userData.scansTotal = 101; }), '[٤] يتغيّر بـ«قبل» لـscansTotal');
    ok(changed((b) => { b.accounts[0].userData.expiresAt = ts(NOW + 1); }), '[٤] يتغيّر بـ«قبل» لـexpiresAt (ميلّي ثانية)');
    ok(changed((b) => { b.accounts[0].userData.expiresAt = Timestamp.fromMillis(NOW).seconds ? new Timestamp(Timestamp.fromMillis(NOW).seconds, 1) : null; }), '[٤] يتغيّر بنانوثانية واحدة في expiresAt');
    ok(changed((b) => { b.accounts[1].userData.expiresAt = '2026-10-11'; }), '[٤] يتغيّر بـexpiresAt نصّاً آخر');
    ok(changed((b) => { b.accounts[1].userData.expiresAt = undefined; }), '[٤] الغائب ≠ النصّ');
    ok(changed((b) => { b.accounts[1].userData.expiresAt = null; }), '[٤] null ≠ النصّ');
    ok(changed((b) => { b.accounts[0].writes.scansRemaining = 18; }), '[٤] يتغيّر بالكتابة المخطَّطة');
    ok(changed((b) => { delete b.accounts[0].writes.scansTotal; }), '[٤] يتغيّر بحذف كتابة مخطَّطة');
    ok(changed((b) => { b.accounts[0].writes.expiresAt = ts(eod(2026, 10, 21)); }), '[٤] يتغيّر بتاريخ الانتهاء المخطَّط');
    const absent = (mk) => { const b = base(); b.accounts[0].userData = mk; return L.computeToken(b); };
    ok(new Set([absent({scansTotal: 100, expiresAt: ts(NOW)}), absent({scansRemaining: null, scansTotal: 100, expiresAt: ts(NOW)}), absent({scansRemaining: 0, scansTotal: 100, expiresAt: ts(NOW)}), absent({scansRemaining: '0', scansTotal: 100, expiresAt: ts(NOW)})]).size === 4, '[٤] غائب ≠ null ≠ 0 ≠ "0" (أربع قيم أربعة رموز)');
    const unchanged = (mut) => { const b = base(); mut(b); return L.computeToken(b) === t0; };
    ok(unchanged((b) => { b.accounts[0].userData.plan = 'free'; b.accounts[0].userData.isActive = false; b.accounts[0].userData.subExpiredNotified = true; b.accounts[0].userData.email = 'x@y.z'; }), '[٤] لا يتغيّر بحقول خارج الحقول الثلاثة (plan وisActive والأعلام) — وفق نصّ الأمر');
  }

  // ═══ ٥ — الغلاف وطفراته ═══
  const T_NOW = ts(NOW);
  /** هجمات وحالات مشروعة على الغلاف G؛ تُرجع أسماء ما فشل. على الحقيقي: []. وعلى طفرة: غير فارغ. */
  async function guardViolations(GM) {
    const violations = [];
    const attempt = async (name, body, {expectTrap = true, writer = false} = {}) => {
      const fx = makeTxDb({[UID.A]: {scansRemaining: 5}});
      const w = GM.createGuardedWriter(fx);
      let err = null;
      try {
        if (writer) await body(w);
        else await w.runTransaction(async (gtx) => { await gtx.readUsers([UID.A]); await body(gtx); });
      } catch (e) { err = e; }
      const blocked = err !== null && GM.isTrap(err) && fx.log.ops.length === 0 && fx.log.directWrites.length === 0;
      if (expectTrap && !blocked) violations.push(name);
      if (!expectTrap && (err !== null || fx.log.ops.length !== 1)) violations.push(name);
      return fx;
    };
    const U = UID.A;
    await attempt('KEY_PLAN', (g) => g.update(U, {plan: 'free'}));
    await attempt('KEY_PLAN_NUMERIC', (g) => g.update(U, {plan: 5})); // قيمة يقبلها فحص النوع: لا يمنعها إلا فحص المفتاح
    await attempt('KEY_IS_ACTIVE', (g) => g.update(U, {isActive: false}));
    await attempt('KEY_IS_ACTIVE_NUMERIC', (g) => g.update(U, {isActive: 1}));
    await attempt('KEY_FLAG', (g) => g.update(U, {subExpiredNotified: false}));
    await attempt('KEY_FLAG_NUMERIC', (g) => g.update(U, {subExpiryFcmDate: 1}));
    await attempt('KEY_FLAG_TIMESTAMP', (g) => g.update(U, {subExpiredAt: T_NOW}));
    await attempt('KEY_MIXED_WITH_ALLOWED', (g) => g.update(U, {expiresAt: T_NOW, plan: 'free'}));
    await attempt('KEY_DOTTED_PATH', (g) => g.update(U, {'expiresAt.x': 1}));
    await attempt('KEY_EMPTY_STRING', (g) => g.update(U, {'': 1}));
    await attempt('FIELDVALUE_DELETE_EXPIRES', (g) => g.update(U, {expiresAt: FieldValue.delete()}));
    await attempt('FIELDVALUE_DELETE_BALANCE', (g) => g.update(U, {scansRemaining: FieldValue.delete()}));
    await attempt('FIELDVALUE_DELETE_TOTAL', (g) => g.update(U, {scansTotal: FieldValue.delete()}));
    await attempt('FIELDVALUE_INCREMENT', (g) => g.update(U, {scansRemaining: FieldValue.increment(1)}));
    await attempt('FIELDVALUE_SERVER_TIMESTAMP', (g) => g.update(U, {expiresAt: FieldValue.serverTimestamp()}));
    await attempt('EXPIRES_DATE', (g) => g.update(U, {expiresAt: new Date(NOW)}));
    await attempt('EXPIRES_NUMBER', (g) => g.update(U, {expiresAt: NOW}));
    await attempt('EXPIRES_STRING', (g) => g.update(U, {expiresAt: '2026-10-20'}));
    await attempt('EXPIRES_NULL', (g) => g.update(U, {expiresAt: null}));
    await attempt('EXPIRES_UNDEFINED', (g) => g.update(U, {expiresAt: undefined}));
    await attempt('EXPIRES_TIMESTAMP_LIKE', (g) => g.update(U, {expiresAt: {seconds: 1, nanoseconds: 0, toMillis: () => 1}}));
    await attempt('BALANCE_NEGATIVE', (g) => g.update(U, {scansRemaining: -1}));
    await attempt('TOTAL_NEGATIVE', (g) => g.update(U, {scansTotal: -1}));
    await attempt('BALANCE_FRACTION', (g) => g.update(U, {scansRemaining: 1.5}));
    await attempt('BALANCE_STRING', (g) => g.update(U, {scansRemaining: '5'}));
    await attempt('BALANCE_NAN', (g) => g.update(U, {scansRemaining: NaN}));
    await attempt('BALANCE_INFINITY', (g) => g.update(U, {scansRemaining: Infinity}));
    await attempt('BALANCE_NULL', (g) => g.update(U, {scansRemaining: null}));
    await attempt('BALANCE_UNSAFE', (g) => g.update(U, {scansRemaining: 2 ** 60}));
    await attempt('BALANCE_BOOLEAN', (g) => g.update(U, {scansRemaining: true}));
    await attempt('EMPTY_UPDATE', (g) => g.update(U, {}));
    await attempt('DATA_NULL', (g) => g.update(U, null));
    await attempt('DATA_ARRAY', (g) => g.update(U, [1]));
    await attempt('DATA_STRING', (g) => g.update(U, 'scansRemaining'));
    await attempt('DATA_CLASS_INSTANCE', (g) => g.update(U, new (class X { constructor() { this.scansRemaining = 1; } })()));
    await attempt('DATA_NULL_PROTOTYPE', (g) => g.update(U, Object.assign(Object.create(null), {scansRemaining: 1})));
    await attempt('SYMBOL_KEY', (g) => g.update(U, {scansRemaining: 1, [Symbol('x')]: 1}));
    await attempt('NON_ENUMERABLE_KEY', (g) => g.update(U, Object.defineProperty({scansRemaining: 1}, 'plan', {value: 'free', enumerable: false})));
    await attempt('ACCESSOR_PROPERTY', (g) => g.update(U, Object.defineProperty({}, 'scansRemaining', {get: () => 1, enumerable: true})));
    await attempt('PRECONDITION_ARG', (g) => g.update(U, {scansRemaining: 1}, {exists: true}));
    await attempt('FIELD_PATH_FORM', (g) => g.update(U, 'scansRemaining', 1));
    await attempt('ONE_ARG', (g) => g.update({scansRemaining: 1}));
    await attempt('TARGET_IS_REF_OBJECT', (g) => g.update({path: `users/${U}`, id: U}, {scansRemaining: 1}));
    await attempt('TARGET_EMPTY', (g) => g.update('', {scansRemaining: 1}));
    await attempt('TARGET_WITH_SLASH', (g) => g.update(`other/${U}`, {scansRemaining: 1}));
    await attempt('TARGET_NESTED_PATH', (g) => g.update(`${U}/sub/x`, {scansRemaining: 1}));
    await attempt('TX_SET', (g) => g.set(U, {scansRemaining: 1}));
    await attempt('TX_CREATE', (g) => g.create(U, {scansRemaining: 1}));
    await attempt('TX_DELETE', (g) => g.delete(U));
    await attempt('WRITER_BATCH', (w) => w.batch(), {writer: true});
    await attempt('WRITER_BULKWRITER', (w) => w.bulkWriter(), {writer: true});
    await attempt('WRITER_RECURSIVE_DELETE', (w) => w.recursiveDelete(), {writer: true});
    // مشروع: القبول
    const okFx = await attempt('LEGIT_ALL_THREE', (g) => g.update(U, {expiresAt: T_NOW, scansRemaining: 0, scansTotal: 7}), {expectTrap: false});
    if (okFx.users.get(UID.A).scansTotal !== 7 || okFx.users.get(UID.A).scansRemaining !== 0) violations.push('LEGIT_ALL_THREE_NOT_APPLIED');
    await attempt('LEGIT_EXPIRES_ONLY', (g) => g.update(U, {expiresAt: T_NOW}), {expectTrap: false});
    await attempt('LEGIT_BALANCE_ONLY', (g) => g.update(U, {scansRemaining: 5}), {expectTrap: false});
    // النسخة المتحقَّق منها هي التي تُمرَّر (لا الكائن الأصلي)
    {
      const fx = makeTxDb({[UID.A]: {scansRemaining: 5}});
      const data = {scansRemaining: 9};
      await GM.createGuardedWriter(fx).runTransaction(async (gtx) => { await gtx.readUsers([UID.A]); gtx.update(UID.A, data); data.scansRemaining = 999; data.plan = 'free'; });
      if (fx.users.get(UID.A).scansRemaining !== 9 || 'plan' in fx.users.get(UID.A)) violations.push('PASSES_ORIGINAL_OBJECT_NOT_A_COPY');
    }
    // الرسالة تسمّي العملية ولا تنسخ مدخلاً
    {
      const fx = makeTxDb({[UID.A]: {scansRemaining: 5}});
      let msg = '';
      try { await GM.createGuardedWriter(fx).runTransaction(async (gtx) => { gtx.update(UID.A, {'secret-key-SECRET': 'secret-value-SECRET'}); }); } catch (e) { msg = e.message; }
      if (!/^TRAP:/.test(msg) || msg.includes('SECRET') || msg.includes(UID.A)) violations.push('TRAP_MESSAGE_ECHOES_INPUT');
    }
    return violations;
  }
  deq(await guardViolations(G), [], '[٥] الغلاف الحقيقي: كل الهجمات ممنوعة بـTRAP بلا أثر في المخزن، والحالات المشروعة الثلاث تُطبَّق، والنسخة تُمرَّر لا الأصل');
  {
    // الغلاف على قاعدة مغلَّفة بـwrapReadOnly: runTransaction نفسها TRAP (فالتشغيل الجافّ لا يملك كتابة حتى لو بُني كاتب بالخطأ)
    const fx = makeTxDb({[UID.A]: {scansRemaining: 5}});
    const w = G.createGuardedWriter(C.wrapReadOnly(fx));
    const e = await thrownAsync(() => w.runTransaction(async () => {}));
    ok(e && /TRAP: write operation "db.runTransaction"/.test(e.message) && fx.log.txCount === 0, '[٥] كاتب مبنيّ على db المغلَّف بـwrapReadOnly: runTransaction ترمي TRAP قبل أن تبدأ معاملة');
    ok(thrown(() => G.createGuardedWriter(null)), '[٥] بلا db ⟵ يرمي');
    deq([...G.ALLOWED_KEYS], ['expiresAt', 'scansRemaining', 'scansTotal'], '[٥] المفاتيح المسموحة ثلاثة بترتيبها');
    ok(Object.isFrozen(G.ALLOWED_KEYS) && Object.isFrozen(G.createGuardedWriter(fx)), '[٥] القائمة والكاتب مجمَّدان');
    eq(L.WRITABLE_FIELDS, G.ALLOWED_KEYS, '[٥] مكتبة السكربت تستعمل قائمة الغلاف نفسها (مصدر واحد، القاعدة 24)');
  }
  // الطفرات: كل طفرة تُكشَف بالسويت نفسه
  const guardMutants = [
    ['M1 يضيف plan إلى المفاتيح المسموحة', "Object.freeze(['expiresAt', 'scansRemaining', 'scansTotal'])", "Object.freeze(['expiresAt', 'scansRemaining', 'scansTotal', 'plan'])", ['KEY_PLAN_NUMERIC']],
    ['M2 يضيف isActive والأعلام', "Object.freeze(['expiresAt', 'scansRemaining', 'scansTotal'])", "Object.freeze(['expiresAt', 'scansRemaining', 'scansTotal', 'isActive', 'subExpiryFcmDate', 'subExpiredAt'])", ['KEY_IS_ACTIVE_NUMERIC', 'KEY_FLAG_NUMERIC']],
    ['M3 يسقط فحص نوع Timestamp', 'if (!(value instanceof Timestamp) || !Number.isFinite(value.toMillis()))', 'if (false)', ['EXPIRES_DATE', 'FIELDVALUE_DELETE_EXPIRES', 'EXPIRES_NULL']],
    ['M4 يسقط فحص العدد الصحيح الآمن غير السالب', '} else if (!(typeof value === \'number\' && Number.isSafeInteger(value) && value >= 0)) {', '} else if (false) {', ['BALANCE_NEGATIVE', 'FIELDVALUE_DELETE_BALANCE', 'BALANCE_STRING']],
    ['M5 set لا ترمي', "set: () => { throw trap('tx.set'); },", 'set: () => {},', ['TX_SET']],
    ['M6 create لا ترمي', "create: () => { throw trap('tx.create'); },", 'create: () => {},', ['TX_CREATE']],
    ['M7 delete لا ترمي', "delete: () => { throw trap('tx.delete'); },", 'delete: () => {},', ['TX_DELETE']],
    ['M8 يقبل وسيطاً ثالثاً (شرطاً مسبقاً)', 'if (argCount !== 2)', 'if (argCount < 2)', ['PRECONDITION_ARG']],
    ['M9 يمرّر الكائن الأصلي لا النسخة', 'tx.update(refOf(args[0]), clean);', 'tx.update(refOf(args[0]), args[1]);', ['PASSES_ORIGINAL_OBJECT_NOT_A_COPY']],
    ['M11 batch لا ترمي', "batch: () => { throw trap('db.batch'); },", 'batch: () => {},', ['WRITER_BATCH']],
    ['M12 يسقط فحص الهدف المجرَّد', 'if (!isBareUid(uid)) throw trap', 'if (false) throw trap', ['TARGET_EMPTY', 'TARGET_WITH_SLASH']],
    ['M13 يسقط فحص الكائن العاديّ', 'Object.getPrototypeOf(data) !== Object.prototype', 'false', ['DATA_CLASS_INSTANCE', 'DATA_NULL_PROTOTYPE']],
    ['M14 رسالة TRAP تنسخ المفتاح', "throw trap('tx.update', 'a key outside the allowed set')", "throw new Error(`TRAP: ${key}`)", ['TRAP_MESSAGE_ECHOES_INPUT']],
  ];
  for (const [name, from, to, expected] of guardMutants) {
    const v = await guardViolations(loadMutant('scripts/lib/subscriptionWriteGuard.js', from, to));
    ok(expected.every((x) => v.includes(x)), `[٥] طفرة ${name} ⟵ تُكشَف (${expected.join(', ')} ∈ ${v.length} مخالفة)`);
  }

  // ═══ ٦ — التشغيل الجافّ (main) ═══
  let DRY_TOKEN;
  {
    const db = makeTxDb(baseUsers());
    const snap0 = snapshotUsers(db);
    const authFx = makeAuth();
    const file = writeAccounts(THREE_LINES);
    const outPath = nextPath();
    const r = await run(['--dry-run', '--accounts', file, '--out', outPath], {db, auth: authFx});
    eq(r.code, 0, '[٦] الجافّ: 0');
    const j = JSON.parse(r.stdout);
    DRY_TOKEN = j.token;
    eq(Object.keys(j)[0], 'projectId', '[٦] projectId أوّل حقل');
    deq([j.projectId, j.mode, j.run, j.schema, j.nothingWritten], ['neuralchek-9b6d7', 'set-account-subscription', 'dry-run', 1, true], '[٦] الرأس');
    ok(/^[0-9a-f]{64}$/.test(j.token) && r.stderr.includes(`token=${j.token}`), '[٦] الرمز في JSON وعلى stderr');
    eq(j.input.accountLines, 3, '[٦] عدد أسطر الحسابات 3 (التعليق لا يُعدّ)');
    eq(j.input.fileSha256, require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'), '[٦] بصمة الملفّ');
    deq(j.allowedWriteFields, ['expiresAt', 'scansRemaining', 'scansTotal'], '[٦] الحقول المسموحة معلَنة');
    eq(snapshotUsers(db), snap0, '[٦][الأهمّ] الجافّ: المخزن كلّه كما هو بايتاً بايتاً (الأنواع والقيم)');
    deq(db.log.ops, [], '[٦][الأهمّ] الجافّ: لا كتابة في المخزن');
    deq(db.log.directWrites, [], '[٦] ولا كتابة مباشرة');
    eq(db.log.txCount, 0, '[٦] ولا معاملة (لا يُبنى كاتب في الجافّ)');
    deq(db.log.reads, [`doc:users/${UID.A}`, `doc:users/${UID.B}`, `doc:users/${UID.C}`], '[٦] قراءة واحدة لكل حساب مسمّى (users/{uid}) وبالترتيب، لا استعلام');
    eq(authFx.calls.length, 3, '[٦] ثلاث عمليات Auth: getUserByEmail لكل سطر');
    deq(j.accounts.map((a) => [a.line, a.account]), [[2, C.hashIdForLog(UID.A)], [3, C.hashIdForLog(UID.B)], [4, C.hashIdForLog(UID.C)]], '[٦] الحساب مُهشَّر بـhashIdForLog(uid)، والسطر برقمه الأصلي في الملفّ');
    const [a, b, c] = j.accounts;
    deq(a.writes, ['expiresAt', 'scansRemaining', 'scansTotal'], '[٦] A: add ⟵ ثلاثة حقول');
    deq(b.writes, ['expiresAt', 'scansRemaining'], '[٦] B: set ⟵ حقلان');
    deq(c.writes, ['expiresAt'], '[٦] C: بلا توجيه ⟵ expiresAt وحده');
    deq(Object.keys(a.before), [...L.PRINT_FIELDS], '[٦] الحقول المطبوعة هي القائمة البيضاء التسعة بترتيبها');
    deq(Object.keys(a.afterPlanned), [...L.PRINT_FIELDS], '[٦] وكذلك «بعد»');
    deq(a.before.expiresAt, {present: true, type: 'timestamp', plus03: SS.toPlus03(NOW - 2 * H), epochMs: NOW - 2 * H}, '[٦] A «قبل» expiresAt: النوع والقيمة بـ+03');
    deq(a.afterPlanned.expiresAt, {present: true, type: 'timestamp', plus03: '2026-10-20T23:59:59.999+03:00', epochMs: eod(2026, 10, 20)}, '[٦] A «بعد» expiresAt: Timestamp بقيمته المطلقة 23:59:59.999+03:00');
    deq([a.before.scansRemaining.value, a.afterPlanned.scansRemaining.value, a.before.scansTotal.value, a.afterPlanned.scansTotal.value], [12, 17, 100, 105], '[٦] A: الرصيد 12⟵17 والإجمالي 100⟵105');
    deq([b.before.scansRemaining.value, b.afterPlanned.scansRemaining.value, b.before.scansTotal.value, b.afterPlanned.scansTotal.value], [0, 30, 50, 50], '[٦] B: set:30 ⟵ الرصيد 0⟵30 والإجمالي لا يتغيّر 50');
    deq([c.before.scansRemaining.value, c.afterPlanned.scansRemaining.value], [3, 3], '[٦] C: الرصيد لا يتغيّر');
    eq(b.before.expiresAt.type, 'string', '[٦] B «قبل» expiresAt نصّ (نوعه يُطبَع)');
    eq(b.afterPlanned.expiresAt.type, 'timestamp', '[٦] B «بعد» expiresAt Timestamp');
    deq(b.changes.map((x) => x.field), ['expiresAt', 'scansRemaining'], '[٦] changes تسرد المكتوب وحده');
    ok(a.changes[0].before.includes('(timestamp)') && a.changes[0].after.startsWith('"') === false && a.changes[0].after.includes('2026-10-20T23:59:59.999+03:00'), '[٦] سطر التغيير يعرض القيمة المطلقة');
    ok(b.changes[0].before.includes('(string)') && b.changes[0].after.includes('(timestamp)'), '[٦] وتغيّر النوع ظاهر (string ⟵ timestamp)');
    // «بعد» للحقول غير المكتوبة = «قبل» حرفياً
    for (const f of L.PRINT_FIELDS.filter((x) => !a.writes.includes(x))) deq(a.afterPlanned[f], a.before[f], `[٦] A: الحقل غير المكتوب ${f} بعده = قبله`);
    // التحذيرات
    const wc = (x) => x.warnings.map((w) => `${w.code}${w.field ? `:${w.field}` : ''}`);
    deq(wc(a), ['FLAG_SET:subExpiredNotified', 'FLAG_SET:subExpiryEmailSent', 'FLAG_SET:subExpiryFcmDate', 'FLAG_SET:subExpiredAt'], '[٦] A: أربعة أعلام مضبوطة (يُحذَّر ولا تُمسّ)');
    deq(wc(b), ['IS_ACTIVE_FALSE:isActive', 'EXPIRES_AT_NOT_A_TIMESTAMP:expiresAt'], '[٦] B: isActive=false وexpiresAt نصّ');
    deq(wc(c), ['PLAN_NOT_SHOP:plan', 'NEW_EXPIRY_EARLIER_THAN_CURRENT:expiresAt'], '[٦] C: plan=free والتاريخ الجديد أقدم من الحالي');
    eq(j.warningsCount, 8, '[٦] مجموع التحذيرات 8');
    ok(leaksIn(r.stdout, r.stderr, fs.readFileSync(outPath, 'utf8')).length === 0, `[٦][الأهمّ] لا بريد ولا uid ولا حقل خارج القائمة في stdout ولا stderr ولا ملفّ --out: ${leaksIn(r.stdout, r.stderr, fs.readFileSync(outPath, 'utf8'))}`);
    for (const k of ['email', 'fcmToken', 'phone', 'name', 'shopSlug', 'freeTrialUsedDevices']) ok(!r.stdout.includes(`"${k}"`), `[٦] لا مفتاح خارج القائمة في المخرَج: ${k}`);
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٦] ملفّ --out بلا BOM');
    eq(bytes.toString('utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٦] الملفّ = المطبوع');
    const again = await run(['--dry-run', '--accounts', file, '--out', outPath], {db});
    eq(again.code, 2, '[٦] --out موجود ⟵ 2 (لا استبدال)');
    ok(/OUT_EXISTS/.test(again.stderr), '[٦] السبب OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٦] والملفّ القائم لم يُمسّ');
    eq(db.log.reads.length, 3, '[٦] وفشل --out قبل أيّ قراءة جديدة (فُحص مساره قبل الاتصال)');
    const noOut = await run(['--dry-run', '--accounts', file], {db});
    ok(/no file written/.test(noOut.stderr), '[٦] بلا --out: السطر على stderr يقول لا ملفّ');
    eq(JSON.parse(noOut.stdout).token, DRY_TOKEN, '[٦] الرمز نفسه لحالة المخزن والملفّ نفسيهما (حتمي بين تشغيلين)');
    eq(snapshotUsers(db), snap0, '[٦] وبعد التشغيلات الثلاثة (ومنها المرفوض بسبب --out) المخزن كما هو');
  }
  {
    // رفض قبل الشبكة
    const db = makeTxDb(baseUsers());
    const authFx = makeAuth();
    const reject = async (text, argvExtra = []) => {
      const f = writeAccounts(text);
      return run(['--dry-run', '--accounts', f, ...argvExtra], {db, auth: authFx});
    };
    let r = await reject(`${EMAIL.A},2026-10-13`);
    ok(r.code === 2 && /DATE_IN_PAST/.test(r.stderr) && authFx.calls.length === 0 && db.log.reads.length === 0, '[٦] تاريخ ماضٍ ⟵ 2 قبل أيّ نداء Auth أو Firestore');
    ok(leaksIn(r.stdout, r.stderr).length === 0, '[٦] ولا بريد في رسالة الرفض');
    r = await run(['--dry-run', '--accounts', path.join(tmp, 'absent.csv')], {db, auth: authFx});
    ok(r.code === 2 && /ACCOUNTS_FILE_MISSING/.test(r.stderr) && authFx.calls.length === 0, '[٦] ملفّ غائب ⟵ 2 (ACCOUNTS_FILE_MISSING)');
    r = await run(['--commit', '--accounts', writeAccounts(THREE_LINES)], {db, auth: authFx});
    ok(r.code === 2 && /TOKEN_REQUIRED/.test(r.stderr) && authFx.calls.length === 0 && db.log.txCount === 0, '[٦] --commit بلا --token ⟵ 2 قبل أيّ شيء');
    r = await run(['--accounts', writeAccounts(THREE_LINES)], {db, auth: authFx});
    ok(r.code === 2 && /MODE_NOT_EXPLICIT/.test(r.stderr), '[٦] بلا وضع صريح ⟵ 2');
    r = await run(['--dry-run', '--accounts', writeAccounts(`${EMAIL.A},2026-10-20\n${EMAIL.A.toUpperCase()},2026-10-21`)], {db, auth: authFx});
    ok(r.code === 2 && /line 2 DUPLICATE_ACCOUNT/.test(r.stderr) && authFx.calls.length === 0, '[٦] بريد مكرَّر ⟵ DUPLICATE_ACCOUNT');
    // بريد غير موجود: الرفض بعد Auth وقبل أيّ قراءة Firestore
    r = await run(['--dry-run', '--accounts', writeAccounts(`${EMAIL.A},2026-10-20\nnobody.SECRET@example.test,2026-10-20\n${EMAIL.B},2026-10-20`)], {db, auth: authFx});
    ok(r.code === 2 && /line 2 ACCOUNT_NOT_FOUND/.test(r.stderr), '[٦] بريد غير موجود ⟵ ACCOUNT_NOT_FOUND برقم السطر');
    ok(leaksIn(r.stdout, r.stderr).length === 0 && !r.stderr.includes('nobody'), '[٦] ونصّ خطأ المزوّد (يحمل البريد) لا يُطبَع (القاعدة 36)');
    eq(db.log.reads.length, 0, '[٦] ولا قراءة Firestore بعد الرفض');
    // مزوّد يفشل بغير user-not-found
    const failingAuth = {getUserByEmail: async (email) => { throw Object.assign(new Error(`internal failure for ${email} SECRET-PROVIDER-TEXT`), {code: 'auth/internal-error'}); }};
    r = await run(['--dry-run', '--accounts', writeAccounts(`${EMAIL.A},2026-10-20`)], {db, auth: failingAuth});
    ok(r.code === 2 && /AUTH_LOOKUP_FAILED\(auth\/internal-error\)/.test(r.stderr) && !r.stderr.includes('SECRET'), '[٦] إخفاق Auth آخر ⟵ AUTH_LOOKUP_FAILED برمز المزوّد فقط');
    // مستند مستخدم غائب
    r = await run(['--dry-run', '--accounts', writeAccounts(`${EMAIL.A},2026-10-20`)], {db: makeTxDb({}), auth: authFx});
    ok(r.code === 2 && /line 1 USER_DOC_MISSING/.test(r.stderr), '[٦] مستند users/{uid} غائب ⟵ USER_DOC_MISSING');
    // add على حساب بلا رصيد: يُجمَع مع غيره
    r = await run(['--dry-run', '--accounts', writeAccounts(`${EMAIL.A},2026-10-20,add:2\n${EMAIL.D},2026-10-20,add:3`)], {db, auth: authFx});
    ok(r.code === 2 && /line 2 CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER; line 2 CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER/.test(r.stderr) && r.stdout === '', '[٦] add على حساب بلا رصيد ⟵ رفض ولا JSON على stdout');
    ok(db.log.ops.length === 0 && db.log.txCount === 0, '[٦] لا أثر كتابة في أيّ رفض');
  }

  // ═══ ٧ — الكتابة (main) ═══
  const dryToken = async (db, file) => {
    const r = await run(['--dry-run', '--accounts', file], {db});
    eq(r.code, 0, '[٧] (تحضير) الجافّ يمرّ');
    return JSON.parse(r.stdout).token;
  };
  {
    // النجاح: كلّها في معاملة واحدة، الحقول المسمّاة وحدها، والباقي كما هو
    const db = makeTxDb(baseUsers());
    const file = writeAccounts(THREE_LINES);
    const token = await dryToken(db, file);
    const beforeAll = [...db.users.entries()].map(([k, v]) => [k, {...v}]); // نسخة سطحية: Timestamp لا يتغيّر في مكانه
    const outPath = nextPath();
    const r = await run(['--commit', '--accounts', file, '--token', token, '--out', outPath], {db});
    eq(r.code, 0, '[٧] الكتابة بالرمز الصحيح: 0');
    const j = JSON.parse(r.stdout);
    deq([j.run, j.committed, j.tokenVerifiedInsideTransaction, j.summary.allMatch, j.summary.readBack], ['commit', true, true, true, 'OK'], '[٧] الرأس: committed وتحقّق الرمز داخل المعاملة والقراءة اللاحقة مطابقة');
    deq(j.summary.written, {expiresAt: 3, scansRemaining: 2, scansTotal: 1}, '[٧] المكتوب: expiresAt×3 وscansRemaining×2 (A وB) وscansTotal×1 (A)');
    eq(db.log.txCount, 1, '[٧][الأهمّ] معاملة واحدة لكل الحسابات');
    deq(db.log.ops.map((o) => [o.op, o.path, o.keys, o.restLength]), [
      ['update', `users/${UID.A}`, ['expiresAt', 'scansRemaining', 'scansTotal'], 0],
      ['update', `users/${UID.B}`, ['expiresAt', 'scansRemaining'], 0],
      ['update', `users/${UID.C}`, ['expiresAt'], 0],
    ], '[٧][الأهمّ] ثلاثة update فقط، بمفاتيح الأمر وحدها، بلا شرط مسبق');
    deq(db.log.directWrites, [], '[٧] ولا كتابة مباشرة');
    // الحقول المكتوبة
    const A = db.users.get(UID.A);
    const B = db.users.get(UID.B);
    const Cc = db.users.get(UID.C);
    ok(A.expiresAt instanceof Timestamp && A.expiresAt.toMillis() === eod(2026, 10, 20), '[٧] A.expiresAt: Timestamp بنهاية 2026-10-20 +03');
    ok(B.expiresAt instanceof Timestamp && B.expiresAt.toMillis() === eod(2026, 10, 25), '[٧] B.expiresAt كان نصّاً وصار Timestamp');
    ok(Cc.expiresAt instanceof Timestamp && Cc.expiresAt.toMillis() === eod(2026, 10, 18), '[٧] C.expiresAt (وهو أقدم من الحالي: كُتب لأن المستخدم سمّاه، وحُذِّر)');
    deq([A.scansRemaining, A.scansTotal, B.scansRemaining, B.scansTotal, Cc.scansRemaining, Cc.scansTotal], [17, 105, 30, 50, 3, 3], '[٧] الأرصدة: A add:5 ⟵ 17/105 · B set:30 ⟵ 30/50 · C لم يُطلب ⟵ 3/3');
    // الباقي كما هو
    const same = (uid, written) => {
      const was = beforeAll.find(([k]) => k === uid)[1];
      const now = db.users.get(uid);
      const keysWas = Object.keys(was).filter((k) => !written.includes(k)).sort();
      const keysNow = Object.keys(now).filter((k) => !written.includes(k)).sort();
      deq(keysNow, keysWas, `[٧] ${uid.slice(0, 5)}: مفاتيح غير المكتوب كما هي`);
      for (const k of keysWas) {
        const a = was[k];
        const b = now[k];
        const norm = (v) => (v && typeof v.toMillis === 'function' ? `ts:${v.seconds}.${v.nanoseconds}` : JSON.stringify(v));
        eq(norm(b), norm(a), `[٧] ${uid.slice(0, 5)}.${k} لم يتغيّر`);
      }
    };
    same(UID.A, ['expiresAt', 'scansRemaining', 'scansTotal']);
    same(UID.B, ['expiresAt', 'scansRemaining']);
    same(UID.C, ['expiresAt']);
    eq(A.plan, 'shop_pro', '[٧] plan لم يُمسّ'); eq(B.isActive, false, '[٧] isActive=false لم يُمسّ'); eq(A.subExpiredNotified, true, '[٧] العلم subExpiredNotified لم يُمسّ'); eq(A.subExpiryFcmDate, '2026-10-13', '[٧] subExpiryFcmDate لم يُمسّ');
    // التحقّق من القراءة اللاحقة، حقلاً حقلاً
    const ja = j.accounts[0];
    deq(ja.verification.writtenFields.map((x) => [x.field, x.match]), [['expiresAt', true], ['scansRemaining', true], ['scansTotal', true]], '[٧] A: كل حقل مكتوب يطابق المخطَّط');
    deq(ja.verification.unchangedFields.mismatched, [], '[٧] A: الحقول غير المكتوبة لم تتغيّر');
    deq(ja.verification.unchangedFields.checked, ['plan', 'isActive', 'subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate', 'subExpiredAt'], '[٧] A: الحقول البيضاء غير المكتوبة سُتّة، وفُحصت');
    deq(ja.afterActual.expiresAt, {present: true, type: 'timestamp', plus03: '2026-10-20T23:59:59.999+03:00', epochMs: eod(2026, 10, 20)}, '[٧] «بعد» الفعلي لـexpiresAt: Timestamp بقيمته المطلقة');
    deq([ja.afterActual.scansRemaining.value, ja.afterActual.scansTotal.value], [17, 105], '[٧] «بعد» الفعلي للرصيد والإجمالي');
    deq(ja.afterActual, ja.afterPlanned, '[٧] «بعد» الفعلي = «بعد» المخطَّط حرفياً');
    ok(leaksIn(r.stdout, r.stderr, fs.readFileSync(outPath, 'utf8')).length === 0, '[٧][الأهمّ] لا بريد ولا uid ولا حقل خارج القائمة في stdout/stderr/--out بعد الكتابة');
    ok(/committed; every planned field was read back and matches/.test(r.stderr), '[٧] stderr يقول التطابق');
    // إعادة التشغيل بالرمز نفسه بعد الكتابة: قبل ≠ قبل
    const snap = snapshotUsers(db);
    const opsBefore = db.log.ops.length;
    const replay = await run(['--commit', '--accounts', file, '--token', token], {db});
    ok(replay.code === 2 && /TOKEN_MISMATCH/.test(replay.stderr), '[٧] إعادة تشغيل الرمز نفسه بعد الكتابة ⟵ TOKEN_MISMATCH (قيم «قبل» تغيّرت)');
    eq(db.log.ops.length, opsBefore, '[٧] ولا كتابة جديدة');
    eq(snapshotUsers(db), snap, '[٧] والمخزن لم يتغيّر بايتاً');
  }
  {
    // الرمز الخاطئ والبائت: لا كتابة
    const mk = () => makeTxDb(baseUsers());
    const file = writeAccounts(THREE_LINES);
    let db = mk();
    const good = await dryToken(db, file);
    let snap = snapshotUsers(db);
    let r = await run(['--commit', '--accounts', file, '--token', '0'.repeat(64)], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0 && snapshotUsers(db) === snap, '[٧] رمز خاطئ (صحيح الشكل) ⟵ 2 TOKEN_MISMATCH بلا كتابة');
    eq(db.log.txCount, 1, '[٧] والرفض حدث داخل المعاملة (القراءة والمقارنة فيها)');
    r = await run(['--commit', '--accounts', file, '--token', 'xyz'], {db});
    ok(r.code === 2 && /TOKEN_FORMAT_INVALID/.test(r.stderr) && db.log.txCount === 1, '[٧] رمز بصيغة خاطئة ⟵ 2 قبل أيّ معاملة جديدة');
    ok(leaksIn(r.stdout, r.stderr).length === 0, '[٧] ولا بريد في الرفض');
    // تعديل حساب بين الوضعين (الرصيد: حقل مكتوب)
    db = mk();
    let tk = await dryToken(db, file);
    db.users.get(UID.B).scansRemaining = 1;
    snap = snapshotUsers(db);
    r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0 && snapshotUsers(db) === snap, '[٧][الأهمّ] تعديل scansRemaining لحساب بين الوضعين ⟵ الرمز البائت يُرفض بلا كتابة (ولا حتى للحسابين الآخرين)');
    // تعديل expiresAt
    db = mk();
    tk = await dryToken(db, file);
    db.users.get(UID.A).expiresAt = ts(NOW + D);
    r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0, '[٧] تعديل expiresAt بين الوضعين ⟵ يُرفض');
    // تعديل scansTotal
    db = mk();
    tk = await dryToken(db, file);
    db.users.get(UID.A).scansTotal = 101;
    r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0, '[٧] تعديل scansTotal بين الوضعين ⟵ يُرفض');
    // تعديل ملفّ المدخل (ولو تعليقاً)
    db = mk();
    tk = await dryToken(db, file);
    const edited = writeAccounts(`${THREE_LINES}# edited after the dry run\n`);
    r = await run(['--commit', '--accounts', edited, '--token', tk], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0, '[٧] تعديل ملفّ المدخل (تعليق) بين الوضعين ⟵ يُرفض (البصمة بايتات)');
    // تعديل حقل غير مكتوب (plan): بحسب نصّ الأمر لا يُبطل الرمز، ويُقارَن بعد الكتابة (لا يتغيّر)
    db = mk();
    tk = await dryToken(db, file);
    db.users.get(UID.A).plan = 'shop_basic';
    r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 0 && db.users.get(UID.A).plan === 'shop_basic' && db.log.ops.length === 3, '[٧] تعديل plan (غير مكتوب) بين الوضعين لا يُبطل الرمز (نطاقه الحقول المكتوبة) — والـplan الجديد باقٍ كما هو');
    // رمز حساب آخر: الملفّ والحالة نفسها لكن ترتيب الأسطر مختلف
    db = mk();
    tk = await dryToken(db, file);
    const reordered = writeAccounts(`${EMAIL.B},2026-10-25,set:30\n${EMAIL.A},2026-10-20,add:5\n${EMAIL.C},2026-10-18\n`);
    r = await run(['--commit', '--accounts', reordered, '--token', tk], {db});
    ok(r.code === 2 && /TOKEN_MISMATCH/.test(r.stderr) && db.log.ops.length === 0, '[٧] ملفّ آخر ⟵ رمز آخر');
  }
  {
    // كلّها أو لا شيء: رفض داخل المعاملة لحساب واحد يمنع كتابة الباقي
    const db = makeTxDb(baseUsers());
    const file = writeAccounts(`${EMAIL.A},2026-10-20,add:5\n${EMAIL.D},2026-10-20,add:3\n`);
    // D بلا رصيد: الجافّ نفسه يرفض؛ فنُهيّئ حالة صالحة وقت الجافّ ثم نكسرها بين الوضعين
    db.users.get(UID.D).scansRemaining = 4; db.users.get(UID.D).scansTotal = 9;
    const tk = await dryToken(db, file);
    delete db.users.get(UID.D).scansRemaining;
    const snap = snapshotUsers(db);
    const r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 2 && /line 2 CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER/.test(r.stderr), '[٧] رفض داخل المعاملة: رصيد D صار غائباً مع add ⟵ CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER');
    ok(db.log.ops.length === 0 && snapshotUsers(db) === snap, '[٧][الأهمّ] كلّها أو لا شيء: A (السليم) لم يُكتب لأن D رُفض');
    // حساب حُذف مستنده بين الوضعين
    const db2 = makeTxDb(baseUsers());
    const f2 = writeAccounts(THREE_LINES);
    const tk2 = await dryToken(db2, f2);
    db2.users.delete(UID.C);
    const r2 = await run(['--commit', '--accounts', f2, '--token', tk2], {db: db2});
    ok(r2.code === 2 && /line 4 USER_DOC_MISSING/.test(r2.stderr) && db2.log.ops.length === 0, '[٧] مستند حساب غاب بين الوضعين ⟵ USER_DOC_MISSING بلا كتابة لأيّ حساب');
  }
  {
    // القراءة اللاحقة غير مطابقة: كتابة متزامنة من طرف آخر بعد التثبيت
    const db = makeTxDb(baseUsers(), {afterCommit: (users) => { users.get(UID.A).scansRemaining = 16; }}); // استُهلكت فحصة بعد الكتابة مباشرةً
    const file = writeAccounts(THREE_LINES);
    const tk = await dryToken(db, file);
    const r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    eq(r.code, 1, '[٧] قراءة لاحقة لا تطابق المخطَّط ⟵ 1');
    const j = JSON.parse(r.stdout);
    eq(j.summary.allMatch, false, '[٧] summary.allMatch=false');
    const w = j.accounts[0].verification.writtenFields.find((x) => x.field === 'scansRemaining');
    deq([w.match, w.planned.includes('17'), w.actual.includes('16')], [false, true, true], '[٧] الحقل المختلف يُسمّى بمخطَّطه وفعليّه');
    ok(j.accounts[1].verification.allMatch && j.accounts[2].verification.allMatch, '[٧] وبقية الحسابات تطابق');
    ok(/read-back not clean/.test(r.stderr), '[٧] stderr يقول إن القراءة غير نظيفة');
    // تغيّر حقل غير مكتوب بعد الكتابة
    const db2 = makeTxDb(baseUsers(), {afterCommit: (users) => { users.get(UID.C).isActive = false; }});
    const f2 = writeAccounts(THREE_LINES);
    const tk2 = await dryToken(db2, f2);
    const r2 = await run(['--commit', '--accounts', f2, '--token', tk2], {db: db2});
    const j2 = JSON.parse(r2.stdout);
    deq([r2.code, j2.accounts[2].verification.unchangedFields.mismatched], [1, ['isActive']], '[٧] تغيّر حقل غير مكتوب (isActive) بعد الكتابة ⟵ 1 ويُسمّى');
  }
  {
    // خطأ مزوّد أثناء الكتابة: النتيجة غير محسومة (3) ولا يُطبَع نصّه
    const err = Object.assign(new Error('provider said: SECRET-PROVIDER-TEXT for user'), {code: 14});
    const db = makeTxDb(baseUsers(), {txError: err});
    const file = writeAccounts(THREE_LINES);
    const tk = await dryToken(db, file);
    const r = await run(['--commit', '--accounts', file, '--token', tk], {db});
    ok(r.code === 3 && /COMMIT_OUTCOME_UNKNOWN \(code=14\)/.test(r.stderr) && r.stdout === '', '[٧] خطأ مزوّد من المعاملة ⟵ 3 COMMIT_OUTCOME_UNKNOWN برمز الخطأ فقط');
    ok(!r.stderr.includes('SECRET'), '[٧] نصّ المزوّد لا يُطبَع (القاعدة 36)');
    // قراءة لاحقة تفشل بعد التثبيت
    const db2 = makeTxDb(baseUsers(), {readFailsAfterCommit: true});
    const f2 = writeAccounts(THREE_LINES);
    const tk2 = await dryToken(db2, f2);
    const r2 = await run(['--commit', '--accounts', f2, '--token', tk2], {db: db2});
    const j2 = JSON.parse(r2.stdout);
    ok(r2.code === 3 && j2.committed === true && /^FAILED \(14\)/.test(j2.summary.readBack) && j2.accounts[0].verification === null, '[٧] فشل القراءة اللاحقة ⟵ 3: المخرَج يعلن committed=true وreadBack=FAILED ولا يدّعي تطابقاً');
    ok(!r2.stdout.includes('SECRET') && !r2.stderr.includes('SECRET'), '[٧] ولا نصّ مزوّد');
    eq(db2.log.ops.length, 3, '[٧] والكتابات الثلاث حدثت');
  }
  {
    // --out موجود في الكتابة: يُرفض قبل أيّ معاملة
    const db = makeTxDb(baseUsers());
    const file = writeAccounts(THREE_LINES);
    const tk = await dryToken(db, file);
    const existing = nextPath();
    fs.writeFileSync(existing, 'keep');
    const r = await run(['--commit', '--accounts', file, '--token', tk, '--out', existing], {db});
    ok(r.code === 2 && /OUT_EXISTS/.test(r.stderr) && db.log.txCount === 0 && db.log.ops.length === 0, '[٧][الأهمّ] --out موجود ⟵ 2 قبل أيّ معاملة (لا كتابة ثم فشل تسجيل)');
    eq(fs.readFileSync(existing, 'utf8'), 'keep', '[٧] والملفّ القائم لم يُمسّ');
    const r2 = await run(['--commit', '--accounts', file, '--token', tk, '--out', path.join(tmp, 'no-such-dir', 'x.json')], {db});
    ok(r2.code === 2 && /OUT_DIR_MISSING/.test(r2.stderr) && db.log.txCount === 0, '[٧] مجلّد --out غائب ⟵ 2 قبل أيّ معاملة');
  }

  // ═══ ٨ — طفرات المكتبة (في الذاكرة) ═══
  const LIB = 'scripts/lib/setAccountSubscription.js';
  /** ينفّذ الكتابة بالمكتبة (أو طفرتها) على رمز خاطئ، ثم بحالة تتغيّر: يرجع ما كُتب وما رُفض. */
  async function commitProbe(LM, {token, mutateBetween = null, text = THREE_LINES, dbOpts = {}}) {
    const db = makeTxDb(baseUsers(), dbOpts);
    const entries = LM.parseAccountsText(text, NOW);
    const input = {sha256: 'f'.repeat(64), accountLines: entries.length};
    const auth = makeAuth();
    const dry = await LM.runDryRun({readDb: C.wrapReadOnly(db), auth, entries, input, nowMs: NOW, env: {}});
    if (mutateBetween) mutateBetween(db);
    let err = null;
    let result = null;
    try {
      result = await LM.runCommit({readDb: C.wrapReadOnly(db), writer: LM.createGuardedWriter(db), auth, entries, input, token: token === 'dry' ? dry.token : token, nowMs: NOW, env: {}});
    } catch (e) { err = e; }
    return {db, err, result, dryToken: dry.token};
  }
  const probeViolations = async (LM) => {
    const v = [];
    const stale = await commitProbe(LM, {token: '0'.repeat(64)});
    if (stale.db.log.ops.length > 0) v.push('STALE_TOKEN_WRITES');
    const edited = await commitProbe(LM, {token: 'dry', mutateBetween: (db) => { db.users.get(UID.B).scansRemaining = 1; }});
    if (edited.db.log.ops.length > 0) v.push('CHANGED_STATE_WRITES');
    const good = await commitProbe(LM, {token: 'dry'});
    if (good.err !== null || good.db.log.ops.length !== 3) v.push('GOOD_TOKEN_DOES_NOT_WRITE');
    // الرمز يغطّي ملفّ المدخل: بصمتان مختلفتان ⟵ رمزان
    const ent = LM.parseAccountsText(THREE_LINES, NOW);
    const dbA = makeTxDb(baseUsers());
    const t1 = (await LM.runDryRun({readDb: C.wrapReadOnly(dbA), auth: makeAuth(), entries: ent, input: {sha256: '1'.repeat(64), accountLines: 3}, nowMs: NOW, env: {}})).token;
    const t2 = (await LM.runDryRun({readDb: C.wrapReadOnly(dbA), auth: makeAuth(), entries: ent, input: {sha256: '2'.repeat(64), accountLines: 3}, nowMs: NOW, env: {}})).token;
    if (t1 === t2) v.push('TOKEN_IGNORES_FILE');
    // الرمز يغطّي «قبل»
    const dbB = makeTxDb(baseUsers());
    dbB.users.get(UID.C).expiresAt = ts(NOW + 31 * D); // «قبل» وحده يتغيّر: C بلا توجيه رصيد، فالكتابة المخطَّطة لا تتغيّر
    const t3 = (await LM.runDryRun({readDb: C.wrapReadOnly(dbB), auth: makeAuth(), entries: ent, input: {sha256: '1'.repeat(64), accountLines: 3}, nowMs: NOW, env: {}})).token;
    if (t3 === t1) v.push('TOKEN_IGNORES_BEFORE_VALUES');
    // كلّها أو لا شيء: رفض حساب داخل المعاملة لا يُبقي كتابة
    const atomic = await commitProbe(LM, {token: 'dry', text: `${EMAIL.A},2026-10-20,add:5\n${EMAIL.D},2026-10-20,set:3\n`, mutateBetween: (db) => { db.users.delete(UID.D); }});
    if (atomic.db.log.ops.length > 0) v.push('NOT_ALL_OR_NOTHING');
    // القراءة اللاحقة ترى فرقاً (فحصة استُهلكت بعد التثبيت) ⟵ رمز خروج 1 لا 0
    const verify = await commitProbe(LM, {token: 'dry', dbOpts: {afterCommit: (users) => { users.get(UID.A).scansRemaining = 16; }}});
    if (!verify.result || verify.result.exitCode !== 1 || verify.result.doc.summary.allMatch !== false) v.push('VERIFICATION_BLIND');
    return v;
  };
  deq(await probeViolations(L), [], '[٨] المكتبة الحقيقية: الرمز البائت ⟵ لا كتابة · تغيّر حالة ⟵ لا كتابة · الرمز السليم ⟵ ثلاث كتابات · الرمز يغطّي الملفّ و«قبل» · كلّها أو لا شيء');
  const libMutants = [
    ['L1 يسقط مقارنة الرمز في المعاملة', 'if (again !== token) throw rejectOne(REASON.TOKEN_MISMATCH);', 'if (false) throw rejectOne(REASON.TOKEN_MISMATCH);', ['STALE_TOKEN_WRITES', 'CHANGED_STATE_WRITES']],
    ['L2 الرمز لا يغطّي بصمة الملفّ', 'tool: MODE, schema: SCHEMA, projectId, fileSha256,', 'tool: MODE, schema: SCHEMA, projectId,', ['TOKEN_IGNORES_FILE']],
    ['L3 الرمز لا يغطّي قيم «قبل»', "before: Object.fromEntries(WRITABLE_FIELDS.map((f) => [f, canonValue(a.userData[f])])),", 'before: {},', ['TOKEN_IGNORES_BEFORE_VALUES', 'CHANGED_STATE_WRITES']],
    ['L4 يكتب الحساب الأوّل وحده', 'resolved.forEach((r, i) => gtx.update(r.uid, plans[i].writes));', 'resolved.slice(0, 1).forEach((r, i) => gtx.update(r.uid, plans[i].writes));', ['GOOD_TOKEN_DOES_NOT_WRITE']],
    ['L5 القراءة اللاحقة تدّعي التطابق دائماً', 'match: after !== null && stableStringify(planned) === stableStringify(actual)', 'match: true', ['VERIFICATION_BLIND']],
    ['L6 رمز الخروج بعد عدم التطابق يبقى 0', 'exitCode: afters === null ? C.EXIT.UNDETERMINED : (allMatch ? C.EXIT.OK : C.EXIT.FAIL)', 'exitCode: C.EXIT.OK', ['VERIFICATION_BLIND']],
  ];
  for (const [name, from, to, expected] of libMutants) {
    let v;
    try {
      v = await probeViolations(loadMutant(LIB, from, to));
    } catch (e) {
      v = [`THREW:${e.constructor.name}`]; // طفرة تنهار بدل أن تُكشَف بمخالفة مسمّاة: تُحتسب كشفاً
    }
    ok(v.length > 0 && expected.every((x) => v.includes(x) || v[0].startsWith('THREW')), `[٨] طفرة ${name} ⟵ تُكشَف (${v.join(', ')})`);
  }
  {
    // خطأ مخطِّط: يضيف plan إلى الكتابات ورمزه مبنيّ بالمخطِّط الطافر نفسه (فيمرّ فحص الرمز) ⟵ الغلاف آخر خطّ دفاع: TRAP بلا أيّ كتابة
    const LM = loadMutant(LIB, 'const writes = {expiresAt: Timestamp.fromMillis(entry.endOfDayMs)};', "const writes = {expiresAt: Timestamp.fromMillis(entry.endOfDayMs), plan: 'free'};");
    const probe = await commitProbe(LM, {token: 'dry'});
    const keysOf = (users) => [...users.entries()].map(([k, v]) => [k, Object.keys(v)]);
    deq(keysOf(probe.db.users), keysOf(makeTxDb(baseUsers()).users), '[٨][الأهمّ] طفرة مخطِّط يكتب plan ورمزه صحيح: المخزن لم يُمسّ (لا مفتاح أُضيف ولا حُذف)');
    ok(probe.err !== null && G.isTrap(probe.err) && probe.db.log.ops.length === 0, '[٨][الأهمّ] والغلاف يرمي TRAP قبل أيّ كتابة');
    eq(probe.db.users.get(UID.A).plan, 'shop_pro', '[٨] plan لحساب A كما هو');
  }

  // ═══ ٩ — الحارس الساكن وطفراته ═══
  const FORBIDDEN = Object.freeze({
    FIRESTORE_WRITE: /\.(?:set|create|delete)\(|\bbatch\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(/,
    DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
    NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
    EMAIL_OUTPUT: /\$\{[^}]*\bemail\b[^}]*\}|\b(?:out|err|console\.\w+)\([^)]*\bemail\b|JSON\.stringify\([^)]*\bemail\b|\bowner_email\b/,
    AUTH_WRITE: /\b(?:createUser|updateUser|deleteUser|setCustomUserClaims|revokeRefreshTokens|generate\w*Link|importUsers|deleteUsers|createCustomToken)\b/,
    RAW_ADMIN_IMPORT: /require\(\s*['"]firebase-admin['"]\s*\)|require\(\s*['"][./]*(?:src\/)?utils\/admin['"]\s*\)/,
  });
  const strip = (raw) => stripComments(raw.replace(/\r\n/g, '\n'));
  /** kind: script | lib | guard */
  const staticViolations = (kind, raw) => {
    let src = strip(raw);
    const v = new Set();
    src = src.replace(/\.createHash\('sha256'\)\.update\(/g, '.createHashSha256Digest('); // hash.update ليس كتابة Firestore
    // الاستثناءات المسمّاة: المكتبة تنادي gtx.update مرّة واحدة؛ والغلاف يحوي tx.update وdb.runTransaction مرّة واحدة
    const count = (re) => (src.match(re) || []).length;
    if (kind === 'lib') {
      if (count(/\bgtx\.update\(/g) !== 1) v.add('STATIC:GTX_UPDATE_COUNT');
      src = src.replace(/\bgtx\.update\(/g, 'gtx_update(');
      if (count(/\bwriter\.runTransaction\(/g) !== 1) v.add('STATIC:WRITER_RUN_TRANSACTION_COUNT');
      src = src.replace(/\bwriter\.runTransaction\(/g, 'writer_runTransaction(');
      for (const m of src.matchAll(/\.email\b/g)) {
        const lineStart = src.lastIndexOf('\n', m.index) + 1;
        const line = src.slice(lineStart, src.indexOf('\n', m.index));
        if (!/getUserByEmail\(entry\.email\)/.test(line)) v.add('STATIC:EMAIL_PROPERTY_USED_OUTSIDE_LOOKUP');
      }
    }
    if (kind === 'guard') {
      if (count(/\btx\.update\(/g) !== 1) v.add('STATIC:TX_UPDATE_COUNT');
      src = src.replace(/\btx\.update\(/g, 'tx_update(');
      if (count(/\bdb\.runTransaction\(/g) !== 1) v.add('STATIC:DB_RUN_TRANSACTION_COUNT');
      src = src.replace(/\bdb\.runTransaction\(/g, 'db_runTransaction(');
    }
    for (const [name, re] of Object.entries(FORBIDDEN)) {
      if (re.test(src)) v.add(`STATIC:${name}`);
    }
    if (/\.update\(|\.runTransaction\(/.test(src)) v.add('STATIC:UNEXPECTED_UPDATE_OR_TRANSACTION');
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.add\(/g)) if (!['out', 'seenEmails', 'seenUids'].includes(m[1])) v.add('STATIC:FIRESTORE_WRITE'); // seenEmails وseenUids: Set في الذاكرة لكشف التكرار
    if (kind === 'script') {
      if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
      if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
      if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
      if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
      if ((src.match(/createGuardedWriter\(/g) || []).length !== 1) v.add('STATIC:WRITER_BUILT_OUTSIDE_THE_COMMIT_BRANCH');
      else {
        const dryBranch = src.slice(src.indexOf("args.mode === 'dry-run'"), src.indexOf('} else {', src.indexOf("args.mode === 'dry-run'")));
        if (/createGuardedWriter\(/.test(dryBranch)) v.add('STATIC:WRITER_BUILT_IN_DRY_RUN');
        if (src.indexOf('createGuardedWriter(') < src.indexOf('} else {', src.indexOf("args.mode === 'dry-run'"))) v.add('STATIC:WRITER_BUILT_BEFORE_THE_COMMIT_BRANCH');
      }
    }
    if (kind !== 'guard' && /require\(\s*['"]firebase-admin\/firestore['"]\s*\)/.test(src)) {
      const imports = [...src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]firebase-admin\/firestore['"]\s*\)/g)];
      if (imports.length === 0 || imports.some((m) => m[1].trim() !== 'Timestamp')) v.add('STATIC:FIRESTORE_IMPORT_BEYOND_TIMESTAMP');
    }
    return [...v].sort();
  };
  const scriptSrc = readSrc('scripts/set-account-subscription.js');
  const libSrc = readSrc('scripts/lib/setAccountSubscription.js');
  const guardSrc = readSrc('scripts/lib/subscriptionWriteGuard.js');
  deq(staticViolations('script', scriptSrc), [], '[٩] السكربت: لا كتابة Firestore ولا قرص خارج --out ولا شبكة ولا طباعة بريد، والكاتب يُبنى في فرع الكتابة وحده');
  deq(staticViolations('lib', libSrc), [], '[٩] المكتبة: بلا set/create/delete/batch/FieldValue، وgtx.update وwriter.runTransaction مرّة واحدة، والبريد لا يُستعمل إلا في getUserByEmail');
  deq(staticViolations('guard', guardSrc), [], '[٩] الغلاف: tx.update وdb.runTransaction مرّة واحدة، وبلا set/create/delete/batch/FieldValue');
  const mut = (kind, src, extra) => staticViolations(kind, `${src}\n${extra}\n`);
  ok(mut('lib', libSrc, "x.collection('users').doc('u').update({plan: 'free'});").includes('STATIC:UNEXPECTED_UPDATE_OR_TRANSACTION'), '[٩] طفرة: update مباشرة في المكتبة ⟵ تُكشَف');
  ok(mut('lib', libSrc, "x.collection('users').doc('u').set({});").includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: set في المكتبة ⟵ تُكشَف');
  ok(mut('lib', libSrc, "x.collection('users').doc('u').delete();").includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: delete في المكتبة ⟵ تُكشَف');
  ok(mut('script', scriptSrc, "const f = admin.firestore.FieldValue.delete();").includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: FieldValue.delete في السكربت ⟵ تُكشَف');
  ok(mut('lib', libSrc, 'const b = fx.batch();').includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: batch ⟵ تُكشَف');
  ok(mut('lib', libSrc, "fx.runTransaction(async () => {});").includes('STATIC:UNEXPECTED_UPDATE_OR_TRANSACTION'), '[٩] طفرة: runTransaction ثانية في المكتبة ⟵ تُكشَف');
  ok(mut('lib', libSrc, 'gtx.update(u, {});').includes('STATIC:GTX_UPDATE_COUNT'), '[٩] طفرة: gtx.update ثانية في المكتبة ⟵ تُكشَف');
  ok(mut('guard', guardSrc, 'tx.update(r, {});').includes('STATIC:TX_UPDATE_COUNT'), '[٩] طفرة: tx.update ثانية في الغلاف ⟵ تُكشَف');
  ok(mut('guard', guardSrc, `${'d'}${'b'}.runTransaction(() => {});`).includes('STATIC:DB_RUN_TRANSACTION_COUNT'), '[٩] طفرة: runTransaction ثانية في الغلاف ⟵ تُكشَف');
  ok(mut('lib', libSrc, "require('fs').writeFileSync('x', 'y');").includes('STATIC:DISK_WRITE'), '[٩] طفرة: كتابة ملفّ في المكتبة ⟵ تُكشَف');
  ok(mut('lib', libSrc, "require('https').request('x');").includes('STATIC:NETWORK'), '[٩] طفرة: شبكة ⟵ تُكشَف');
  ok(mut('script', scriptSrc, 'out(`owner ${entry.email}`);').includes('STATIC:EMAIL_OUTPUT'), '[٩] طفرة: طباعة البريد ⟵ تُكشَف');
  ok(mut('lib', libSrc, 'const leak = {account: r.email};').includes('STATIC:EMAIL_PROPERTY_USED_OUTSIDE_LOOKUP'), '[٩] طفرة: استعمال .email خارج getUserByEmail ⟵ تُكشَف');
  ok(mut('lib', libSrc, "const a = require('firebase-admin');").includes('STATIC:RAW_ADMIN_IMPORT'), '[٩] طفرة: استيراد firebase-admin الخام في المكتبة ⟵ تُكشَف');
  ok(mut('lib', libSrc, "const {Timestamp, FieldValue: F} = require('firebase-admin/firestore');").includes('STATIC:FIRESTORE_IMPORT_BEYOND_TIMESTAMP'), '[٩] طفرة: استيراد غير Timestamp من firebase-admin/firestore ⟵ تُكشَف');
  ok(mut('script', scriptSrc, "const x = require('../../src/utils/admin');").includes('STATIC:RAW_ADMIN_IMPORT'), '[٩] طفرة: استيراد src/utils/admin ⟵ تُكشَف');
  ok(mut('script', scriptSrc, 'const z = process.argv[2];').includes('STATIC:ARGV_READ_OUTSIDE_ENTRY'), '[٩] طفرة: قراءة process.argv ثانية ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.wrapReadOnly(', 'identity(')).includes('STATIC:NO_WRAP_READ_ONLY_DB'), '[٩] طفرة: إزالة wrapReadOnly ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.assertOutWritable(', 'identity(')).includes('STATIC:NO_OUT_PRECHECK'), '[٩] طفرة: إزالة فحص --out المسبق ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace("if (args.mode === 'dry-run') {", "if (args.mode === 'dry-run') {\n const w = L.createGuardedWriter(injected.db);")).includes('STATIC:WRITER_BUILT_OUTSIDE_THE_COMMIT_BRANCH'), '[٩] طفرة: بناء كاتب في فرع الجافّ ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace("const readDb = C.wrapReadOnly(injected.db);", "const readDb = C.wrapReadOnly(injected.db);\n    const early = L.createGuardedWriter(injected.db);")).length > 0, '[٩] طفرة: بناء الكاتب قبل الفرع ⟵ تُكشَف');
  // الغلاف لا يتسرّب إلى مخارج المكتبة
  ok(!Object.keys(L).some((k) => /^(?:update|set|create|delete|batch|runTransaction)$/.test(k)), '[٩] المكتبة لا تُصدِّر دالّة كتابة باسم عامّ');
  eq(typeof L.createGuardedWriter, 'function', '[٩] وتُصدِّر الكاتب المحروس وحده');

  // ═══ ١٠ — الفحص الذاتي ═══
  {
    const pf = L.preflightChecks();
    eq(pf.ok, true, '[١٠] preflight: كل الفحوص الذاتية تمرّ');
    ok(pf.checks.length >= 14 && pf.checks.every((c) => c.ok), `[١٠] ${pf.checks.length} فحصاً كلّها ok`);
    const r = await run(['--preflight'], {env: {}});
    eq(r.code, 0, '[١٠] --preflight: 0 بلا شبكة ولا ملفّ');
    const j = JSON.parse(r.stdout);
    deq([j.projectId, j.mode, j.network, j.writesOnlyWithCommit, j.ok], ['neuralchek-9b6d7', 'preflight', false, true, true], '[١٠] preflight يعلن network=false وprojectId المثبَّت');
    eq(Object.keys(j)[0], 'projectId', '[١٠] projectId أوّل حقل');
  }
  eq(L.SHOP_PLANS, SS.CRON.shopPlans, '[١٠] باقات المحلّ من المصدر الواحد في subscriptionState (مرآة المهمّة المجدولة)');
  ok(L.PRINT_FIELDS.every((f) => SS.FIELDS.includes(f)) && L.PRINT_FIELDS.length === 9, '[١٠] الحقول المطبوعة تسعة وكلّها ضمن القائمة البيضاء في subscriptionState');
  ok(L.FLAG_FIELDS.every((f) => L.PRINT_FIELDS.includes(f)), '[١٠] الأعلام ضمن الحقول المطبوعة');
  ok(L.WRITABLE_FIELDS.every((f) => L.PRINT_FIELDS.includes(f)), '[١٠] الحقول المكتوبة ضمن المطبوعة (فـ«قبل» و«بعد» يغطّيانها)');

  fs.rmSync(tmp, {recursive: true, force: true});
  console.log(`setAccountSubscription.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
