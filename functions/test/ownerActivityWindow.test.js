'use strict';

// ownerActivityWindow.test.js — السكربت owner-activity-window-readonly.js ومكتبته scripts/lib/ownerActivityWindow.js (جولة الفحص ٢ الجلسة ١، 2026-10-14 +03).
// وحدة بلا شبكة ولا محاكٍ. الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في هذا الاختبار وحده؛ والطبقة الحقيقية (select وlimit وcount والمساواة على المحاكي، والعملية الفرعية) في
// ownerActivityWindowReadonly.e2e.test.js. والوقائع التي تعتمد عليها المكتبة في الخادم (userId = صاحب الجلسة · sessionId في reportRaw · scanId على الجلسة عند الاكتمال) يحرسها §٨ بقراءة المصادر وطفراتها في الذاكرة
// (لا مسّ بملفّ في functions/src).
//
// ١ الوسائط والنافذة · ٢ قراءة القيم (الغائب ≠ null ≠ غير مقروء) · ٣ عنصر التقرير (النوع والختم وaiFallbackReason) · ٤ ربط التقرير بجلسته · ٥ عنصر الجلسة · ٦ تقسيم النافذة
// ٧ main: واقعة الجلسات الثلاث، لا بريد ولا معرّف خامّ ولا رمز جلسة، القراءات مساواة وحدها، السقوف، الأخطاء، ولا اقتراح فهرس · ٨ حارس الوقائع المنسوخة من الخادم وطفراته · ٩ الحارس الساكن للقراءة فقط وطفراته
//
// Run: node functions/test/ownerActivityWindow.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const W = require('../scripts/lib/ownerActivityWindow');
const {main} = require('../scripts/owner-activity-window-readonly');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');
const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../src/analysis/evaluationRulesVersion');
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {makeMemDb} = require('./lib/memFirestore');

const FN = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(FN, rel), 'utf8').replace(/\r\n/g, '\n');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1').replace(/^#!.*$/m, '');

const HOUR = 60 * 60 * 1000;
const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
// الأوقات بـ+03: 2026-10-14 الساعة h:m
const at = (h, m = 0, s = 0) => Date.UTC(2026, 9, 14, h - 3, m, s);
const NOW = at(18, 0);
const SINCE_ISO = '2026-10-14T17:00:00+03:00';
const UNTIL_ISO = '2026-10-14T18:00:00+03:00';
const WINDOW = ['--since', SINCE_ISO, '--until', UNTIL_ISO];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-activity-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `oa-${++counter}.json`);

const SECRET_EMAIL = 'owner.shop.secret@example.test';
const OWNER = 'uid-OWNER-SECRET-424242';
const OTHER = 'uid-OTHER-SECRET-999999';
const JOINER = 'uid-JOINER-SECRET-111111';
const JOINER2 = 'uid-JOINER2-SECRET-222222';
const SESS = {A: 'sess-A-SECRET-0001', B: 'sess-B-SECRET-0002', C: 'sess-C-SECRET-0003', OLD: 'sess-OLD-SECRET-0004', NOCREATED: 'sess-NOCREATED-SECRET-0005', OTHERS: 'sess-OTHERS-SECRET-0006'};
const SCAN = {X: 'scan-X-SECRET-0001', P: 'scan-P-SECRET-0002', L: 'scan-L-SECRET-0003', N: 'scan-N-SECRET-0004', OLD: 'scan-OLD-SECRET-0005', OTHERS: 'scan-OTHERS-SECRET-0006', BADTIME: 'scan-BADTIME-SECRET-0007'};
const CODE = {A: 'NC-SECRA2', B: 'NC-SECRB3', C: 'NC-SECRC4'};
const SHORT = {X: 'NC-XXXX22', P: 'NC-PPPP33', L: 'NC-LLLL44', N: 'NC-NNNN55', OLD: 'NC-OOOO66', OTHERS: 'NC-ZZZZ77'};
const PROVIDER_TEXT = 'deepseek 401 key ends in sk-SECRETKEY-WXYZ';
const authFor = (uid = OWNER) => ({getUserByEmail: async (email) => {
  if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  return {uid};
}});
const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};
const ALL_SECRETS = [SECRET_EMAIL, 'owner.shop', OWNER, OTHER, JOINER, JOINER2, ...Object.values(SESS), ...Object.values(SCAN), ...Object.values(CODE), 'SECRET', 'sk-SECRETKEY', PROVIDER_TEXT];

/** عالم الاختبار: الجلسات الثلاث A وB وC (الواقعة)، وجلسة خارج النافذة، وجلسة بلا createdAt، وجلسة مالك آخر؛ وتقارير بأشكال الربط كلّها. */
function world(overrides = {}) {
  const sessions = {
    [SESS.A]: {ownerId: OWNER, code: CODE.A, status: 'scanning', createdAt: ts(at(17, 10)), expiresAt: ts(at(18, 10)), joinedBy: JOINER, joinedAt: ts(at(17, 12)), scanId: null, deviceModel: 'SM-G973F'},
    [SESS.B]: {ownerId: OWNER, code: CODE.B, status: 'completed', createdAt: ts(at(17, 30)), expiresAt: ts(at(18, 30)), joinedBy: JOINER, joinedAt: ts(at(17, 33)), scanId: SCAN.X, completedAt: ts(at(17, 35, 44)), shortId: SHORT.X, deviceModel: 'SM-G973F'},
    [SESS.C]: {ownerId: OWNER, code: CODE.C, status: 'scanning', createdAt: ts(at(17, 45)), expiresAt: ts(at(18, 45)), joinedBy: JOINER2, joinedAt: ts(at(17, 47)), scanId: null},
    [SESS.OLD]: {ownerId: OWNER, status: 'expired', createdAt: ts(at(9, 0)), expiresAt: ts(at(10, 0)), expiredAt: ts(at(10, 30)), scanId: null},
    [SESS.NOCREATED]: {ownerId: OWNER, status: 'scanning', expiresAt: ts(at(12, 0)), joinedBy: null},
    [SESS.OTHERS]: {ownerId: OTHER, status: 'scanning', createdAt: ts(at(17, 20)), expiresAt: ts(at(18, 20))},
  };
  const reports = {
    // الفحص X: ردّ مخبَّأ سريع كُتب تحت الجلسة B (وسم cached، ومدّة ضئيلة، وختم القواعد محمول من الأصل)
    [SCAN.X]: {userId: OWNER, createdAt: ts(at(17, 35, 44)), shortId: SHORT.X, pipeline: CACHED_PIPELINE_TAG, fieldsVersion: 70, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, appVersion: '1.0.12', aiModel: 'cached_signature_match', aiDurationMs: 812, aiFallbackReason: null, isFreeTrial: false},
    // فحص شخصي للمالك بلا جلسة
    [SCAN.P]: {userId: OWNER, createdAt: ts(at(17, 50)), shortId: SHORT.P, pipeline: V7_PIPELINE_TAG, fieldsVersion: 70, [EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION, appVersion: '1.0.12', aiModel: 'deepseek-chat', aiDurationMs: 41234, aiFallbackReason: PROVIDER_TEXT, isFreeTrial: false},
    // تقرير قديم مضمَّن: sessionId في مستند التقرير نفسه (قبل الترحيل)، بلا ختم
    [SCAN.L]: {userId: OWNER, createdAt: ts(at(17, 20)), shortId: SHORT.L, pipeline: V6_PIPELINE_TAG, sessionId: SESS.A, rawFingerprint: {big: 'SECRET raw'}},
    // بلا reportRaw ولا حقل قديم: الربط غير معروف
    [SCAN.N]: {userId: OWNER, createdAt: ts(at(17, 55)), shortId: SHORT.N},
    [SCAN.OLD]: {userId: OWNER, createdAt: ts(at(9, 0)), shortId: SHORT.OLD, pipeline: V7_PIPELINE_TAG},
    [SCAN.BADTIME]: {userId: OWNER, createdAt: '2026-10-14T17:30:00+03:00', pipeline: V7_PIPELINE_TAG},
    [SCAN.OTHERS]: {userId: OTHER, createdAt: ts(at(17, 40)), shortId: SHORT.OTHERS, pipeline: V7_PIPELINE_TAG},
  };
  const reportRaw = {
    [SCAN.X]: {scanId: SCAN.X, sessionId: SESS.B, rawFingerprint: {big: 'SECRET raw'}, source: 'analyzeDevice'},
    [SCAN.P]: {scanId: SCAN.P, sessionId: null, rawFingerprint: {big: 'SECRET raw'}, source: 'analyzeDevice'},
    [SCAN.OLD]: {scanId: SCAN.OLD, sessionId: SESS.OLD},
  };
  return {
    users: {[OWNER]: {scansRemaining: 41, plan: 'shop_pro', email: SECRET_EMAIL, fcmToken: 'SECRET-FCM', expiresAt: ts(at(23, 0))}},
    scanSessions: sessions, reports, reportRaw, ...overrides,
  };
}

(async () => {
  // ═══ ١ — الوسائط والنافذة ═══
  const pa = W.parseArgs;
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); return e; };
  {
    const a = pa(WINDOW);
    eq(a.mode, 'run', '[١] الوضع run');
    eq(a.sinceMs, at(17, 0), '[١] since بـ+03');
    eq(a.untilMs, at(18, 0), '[١] until بـ+03');
    eq(a.out, null, '[١] بلا --out');
    eq(pa([...WINDOW, '--out', 'x.json']).out, 'x.json', '[١] --out');
  }
  deq(pa(['--preflight']), {mode: 'preflight', sinceMs: null, untilMs: null, out: null}, '[١] --preflight');
  bad(['--preflight', '--since', SINCE_ISO], /--preflight وحدها/, '[١] --preflight مع since');
  bad([], /--since و--until مطلوبان/, '[١] بلا نافذة');
  bad(['--since', SINCE_ISO], /--since و--until مطلوبان/, '[١] since وحدها');
  bad(['--until', UNTIL_ISO], /--since و--until مطلوبان/, '[١] until وحدها');
  bad(['--since', SINCE_ISO, '--until'], /يحتاج قيمة/, '[١] until بلا قيمة');
  bad(['--since', SINCE_ISO, '--since', SINCE_ISO, '--until', UNTIL_ISO], /مكرَّر/, '[١] since مكرَّر');
  bad([...WINDOW, '--email', 'x@y.z'], /وسيط مجهول --email/, '[١] البريد لا يُقبل من سطر الأمر');
  bad([...WINDOW, 'positional'], /وسيط مجهول \(موضعي\)/, '[١] وسيط موضعي');
  {
    // الشكل `--name=<قيمة>`: كان الوسيط يُطبَع كلّه بقيمته (كشفه e2e، 2026-10-14) — يُطبَع اسمه وحده، والقيمة قد تكون بريداً
    const e = bad([...WINDOW, `--email=${SECRET_EMAIL}`], /^USAGE: وسيط مجهول --email$/, '[١] --email=<بريد>: الاسم وحده في الرسالة');
    ok(!e.message.includes(SECRET_EMAIL) && !e.message.includes('owner.shop'), '[١] ولا أثر للبريد في الرسالة');
  }
  const pi = (s) => W.parseInstant(s, '--since');
  eq(pi('2026-10-14T14:00:00Z'), pi('2026-10-14T17:00:00+03:00'), '[١] Z و+03 للحظة نفسها');
  eq(pi('2026-10-14T17:00:00+03:00'), pi('2026-10-14T17:00+03:00'), '[١] الثواني اختيارية');
  eq(pi('2026-10-14T17:00:00.5+03:00') - pi('2026-10-14T17:00:00+03:00'), 500, '[١] الكسر العشري .5 = 500ms');
  eq(pi('2026-10-14T17:00:00-02:30') - pi('2026-10-14T17:00:00+03:00'), 5.5 * HOUR, '[١] إزاحة سالبة بنصف ساعة');
  for (const [label, s] of [
    ['بلا إزاحة', '2026-10-14T17:00:00'], ['تاريخ بلا وقت', '2026-10-14'], ['نصّ عشوائي', 'yesterday'], ['فاصل مسافة', '2026-10-14 17:00:00+03:00'], ['شهر 13', '2026-13-14T17:00:00+03:00'],
    ['30 شباط', '2026-02-30T17:00:00+03:00'], ['ساعة 24', '2026-10-14T24:00:00+03:00'], ['دقيقة 60', '2026-10-14T17:60:00+03:00'], ['ثانية 60', '2026-10-14T17:00:60+03:00'], ['إزاحة 25:00', '2026-10-14T17:00:00+25:00'], ['فارغ', ''],
  ]) {
    const e = bad(['--since', s, '--until', UNTIL_ISO], /لحظة ISO بإزاحة صريحة/, `[١] مرفوض: ${label}`);
    eq(e.message, 'USAGE: --since لحظة ISO بإزاحة صريحة، مثل 2026-10-14T17:00:00+03:00', `[١] الرسالة ثابتة لا تُكرِّر المُدخَل: ${label}`);
  }
  bad(['--since', UNTIL_ISO, '--until', SINCE_ISO], /--until يجب أن يلي --since/, '[١] until قبل since');
  bad(['--since', SINCE_ISO, '--until', SINCE_ISO], /--until يجب أن يلي --since/, '[١] until = since');
  ok(pa(['--since', '2026-10-14T00:00:00+03:00', '--until', '2026-10-15T00:00:00+03:00']).mode === 'run', '[١] 24 ساعة بالضبط مقبولة');
  bad(['--since', '2026-10-14T00:00:00+03:00', '--until', '2026-10-15T00:00:00.001+03:00'], /النافذة تتجاوز 24 ساعة/, '[١] 24 ساعة ومللي ثانية مرفوضة');
  eq(W.MAX_WINDOW_MS, 24 * HOUR, '[١] السقف 24 ساعة');
  ok(W.preflightChecks({}).ok === true, '[١] preflightChecks كلّها تمرّ');

  // ═══ ٢ — قراءة القيم: الغائب ≠ null ≠ غير مقروء ═══
  deq(W.readInstant(undefined), {state: 'ABSENT', ms: null, type: null}, '[٢] وقت غائب');
  eq(W.readInstant(ts(5)).state, 'OK', '[٢] Timestamp');
  eq(W.readInstant(new Date(5)).state, 'OK', '[٢] Date');
  deq([W.readInstant(null).state, W.readInstant('2026-10-14T17:30:00+03:00').state, W.readInstant(1760452200000).state, W.readInstant(new Date(NaN)).state, W.readInstant({toMillis: () => NaN, toDate: () => new Date(NaN)}).state],
      ['UNREADABLE', 'UNREADABLE', 'UNREADABLE', 'UNREADABLE', 'UNREADABLE'], '[٢] null ونصّ ورقم وتاريخ تالف وTimestamp تالف: غير مقروءة (لا تحويل بالتخمين)');
  deq(W.describeScalar({}, 'x'), {present: false, type: 'absent'}, '[٢] حقل غائب');
  deq(W.describeScalar({x: null}, 'x'), {present: true, type: 'null', value: null}, '[٢] null ≠ غائب');
  deq(W.describeScalar({x: false}, 'x'), {present: true, type: 'boolean', value: false}, '[٢] false قيمة');
  deq(W.describeScalar({x: 0}, 'x'), {present: true, type: 'number', value: 0}, '[٢] 0 قيمة');
  deq(W.describeScalar({x: NaN}, 'x'), {present: true, type: 'number', value: null, valuePrinted: false}, '[٢] NaN لا يُطبَع');
  deq(W.describeScalar({x: 'v7_findings_based'}, 'x'), {present: true, type: 'string', value: 'v7_findings_based'}, '[٢] وسم قابل للطباعة');
  deq(W.describeScalar({x: 'has a space and SECRET'}, 'x'), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 'has a space and SECRET'.length}, '[٢] نصّ حرّ: حضور وطول');
  deq(W.describeScalar({x: 'abc'}, 'x', {printString: false}), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 3}, '[٢] printString=false: لا نصّ أبداً');
  deq(W.describeScalar({x: {a: 1}}, 'x'), {present: true, type: 'object', value: null, valuePrinted: false}, '[٢] كائن لا يُطبَع');

  // ═══ ٣ — عنصر التقرير ═══
  const itemOf = (id, data, link = {state: 'NOT_A_SESSION_SCAN', source: 'reportRaw.sessionId', sessionIdHash: null}) => W.buildReportItem({id, data, sessionLink: link});
  {
    const x = itemOf(SCAN.X, world().reports[SCAN.X]);
    eq(x.scanIdHash, C.hashIdForLog(SCAN.X), '[٣] scanIdHash = hashIdForLog');
    eq(x.shortId.value, SHORT.X, '[٣] shortId يُطبَع (بطلب المنسّق)');
    eq(x.kind, 'CACHED', '[٣] pipeline=cached ⟵ CACHED');
    eq(x.pipeline.value, CACHED_PIPELINE_TAG, '[٣] والوسم الخامّ مطبوع');
    eq(x.createdAtPlus03, '2026-10-14T17:35:44.000+03:00', '[٣] createdAt بـ+03');
    eq(x.seal.fieldsVersion.value, 70, '[٣] fieldsVersion');
    eq(x.seal[EVALUATION_RULES_VERSION_FIELD].value, EVALUATION_RULES_VERSION, '[٣] evaluationRulesVersion (الاسم من المصدر المصدَّر، والقيمة 40 حرفاً تُطبَع)');
    eq(x.ai.aiModel.value, 'cached_signature_match', '[٣] aiModel');
    eq(x.ai.aiDurationMs.value, 812, '[٣] aiDurationMs');
    deq(x.ai.aiFallbackReason, {present: true, type: 'null', value: null}, '[٣] aiFallbackReason=null ≠ غائب');
  }
  {
    const p = itemOf(SCAN.P, world().reports[SCAN.P]);
    eq(p.kind, 'V7', '[٣] V7');
    deq(p.ai.aiFallbackReason, {present: true, type: 'string', value: null, valuePrinted: false, stringLength: PROVIDER_TEXT.length}, '[٣][القاعدة 36] نصّ aiFallbackReason لا يُطبَع: حضور وطول');
    ok(!JSON.stringify(p).includes('SECRETKEY') && !JSON.stringify(p).includes('deepseek 401'), '[٣] ولا أثر لنصّ المزوّد في العنصر');
    eq(itemOf(SCAN.L, world().reports[SCAN.L]).kind, 'V6', '[٣] V6');
    const n0 = itemOf(SCAN.N, world().reports[SCAN.N]);
    eq(n0.kind, 'ABSENT', '[٣] pipeline غائب ⟵ ABSENT (لا افتراض V6)');
    deq(n0.seal.fieldsVersion, {present: false, type: 'absent'}, '[٣] fieldsVersion غائب ⟵ غائب صريح');
    deq(n0.seal[EVALUATION_RULES_VERSION_FIELD], {present: false, type: 'absent'}, '[٣] ختم القواعد غائب ⟵ غائب (تقرير «كُتب قبل الختم»)');
    eq(W.reportKind({present: true, type: 'string', value: 'something_else'}), 'OTHER_OR_UNPRINTED', '[٣] وسم لا تعرفه الشيفرة ⟵ OTHER_OR_UNPRINTED');
    eq(W.reportKind({present: true, type: 'string', value: null, valuePrinted: false, stringLength: 99}), 'OTHER_OR_UNPRINTED', '[٣] وسم غير مطبوع ⟵ OTHER_OR_UNPRINTED');
    const badShort = itemOf('s', {shortId: 'secret session code NC-ABCDEF!'});
    eq(badShort.shortId.value, null, '[٣] shortId بشكل غير NC-XXXXXX لا يُطبَع');
    eq(badShort.shortId.valuePrinted, false, '[٣] ويُعلَن أنه لم يُطبَع');
  }
  ok(!Object.keys(itemOf(SCAN.L, world().reports[SCAN.L])).includes('rawFingerprint'), '[٣] لا حقل خامّ في العنصر');
  deq(W.REPORT_SELECT.filter((f) => !['createdAt', 'shortId', 'pipeline', 'fieldsVersion', EVALUATION_RULES_VERSION_FIELD, 'appVersion', 'aiModel', 'aiDurationMs', 'aiFallbackReason', 'isFreeTrial', 'sessionId'].includes(f)), [], '[٣] REPORT_SELECT = القائمة البيضاء المعلَنة وحدها');

  // ═══ ٤ — ربط التقرير بجلسته ═══
  {
    const db = makeMemDb(world());
    const w = world();
    const link = (id) => W.readSessionLink({db, scanId: id, reportData: w.reports[id]});
    deq(await link(SCAN.X), {state: 'SESSION', source: 'reportRaw.sessionId', sessionIdHash: C.hashIdForLog(SESS.B)}, '[٤] reportRaw.sessionId نصّ ⟵ SESSION بمعرّف مُهشَّر');
    deq(await link(SCAN.P), {state: 'NOT_A_SESSION_SCAN', source: 'reportRaw.sessionId', sessionIdHash: null}, '[٤] reportRaw.sessionId=null ⟵ فحص شخصي');
    deq(await link(SCAN.L), {state: 'SESSION', source: 'reports.sessionId (legacy embedded)', sessionIdHash: C.hashIdForLog(SESS.A)}, '[٤] لا reportRaw وفي مستند التقرير sessionId ⟵ SESSION من المضمَّن القديم');
    deq(await link(SCAN.N), {state: 'NO_RAW_DOC_AND_NO_LEGACY_FIELD', source: 'ABSENT', sessionIdHash: null}, '[٤] لا هذا ولا ذاك ⟵ الربط غير معروف (لا يُقرأ «فحص شخصي»)');
    const db2 = makeMemDb({reportRaw: {r1: {scanId: 'r1'}, r2: {scanId: 'r2', sessionId: ''}, r3: {scanId: 'r3', sessionId: 12345}}});
    eq((await W.readSessionLink({db: db2, scanId: 'r1', reportData: {}})).state, 'SESSION_FIELD_ABSENT', '[٤] reportRaw بلا الحقل ⟵ SESSION_FIELD_ABSENT');
    eq((await W.readSessionLink({db: db2, scanId: 'r2', reportData: {}})).state, 'SESSION_FIELD_UNREADABLE', '[٤] sessionId فارغ ⟵ غير مقروء');
    eq((await W.readSessionLink({db: db2, scanId: 'r3', reportData: {}})).state, 'SESSION_FIELD_UNREADABLE', '[٤] sessionId رقم ⟵ غير مقروء');
    deq(db.writeAttempts, [], '[٤] لا كتابة');
  }
  ok(REPORT_RAW_FIELDS.includes('sessionId'), '[٤] sessionId من الحقول المنقولة إلى reportRaw (المصدر المصدَّر)');

  // ═══ ٥ — عنصر الجلسة ═══
  {
    const w = world().scanSessions;
    const si = (id) => W.buildSessionItem({id, data: w[id], nowMs: NOW});
    const a = si(SESS.A);
    eq(a.sessionHash, C.hashIdForLog(SESS.A), '[٥] sessionHash');
    deq(a.status, {state: 'KNOWN', value: 'scanning'}, '[٥] الحالة scanning');
    eq(a.createdAtPlus03, '2026-10-14T17:10:00.000+03:00', '[٥] createdAt بـ+03');
    eq(a.expiresAt.plus03, '2026-10-14T18:10:00.000+03:00', '[٥] expiresAt بـ+03');
    eq(a.activeButPastExpiry, false, '[٥] لم ينقضِ بعد');
    deq(a.joiner, {state: 'PRESENT', hash: C.hashIdForLog(JOINER)}, '[٥] المنضمّ مُهشَّر');
    deq(a.scanLink, {state: 'SCAN_ID_NULL', scanIdHash: null}, '[٥] scanId=null (لم يكتبه الخادم) ≠ غائب');
    deq(a.completedAt, {present: false}, '[٥] completedAt غائب');
    const b = si(SESS.B);
    deq(b.status, {state: 'KNOWN', value: 'completed'}, '[٥] completed');
    deq(b.scanLink, {state: 'SCAN_ID_SET', scanIdHash: C.hashIdForLog(SCAN.X)}, '[٥] scanId كتبه الخادم عند الاكتمال');
    eq(b.completedAt.plus03, '2026-10-14T17:35:44.000+03:00', '[٥] completedAt بـ+03');
    const nc = si(SESS.NOCREATED);
    deq(nc.joiner, {state: 'NULL', hash: null}, '[٥] joinedBy=null ⟵ NULL (انضمّ بلا هوية)');
    deq(nc.scanLink, {state: 'SCAN_ID_ABSENT', scanIdHash: null}, '[٥] scanId غائب ≠ null');
    eq(nc.activeButPastExpiry, true, '[٥] scanning وانقضى expiresAt ولم تُكتب «منتهية» ⟵ activeButPastExpiry');
    eq(nc.createdAtPlus03, undefined, '[٥] createdAt الغائب ⟵ لا وقت مختلَق');
    deq(si(SESS.OLD).status, {state: 'KNOWN', value: 'expired'}, '[٥] expired');
    eq(si(SESS.OLD).activeButPastExpiry, false, '[٥] منتهية مسجَّلة: ليست «جارية منقضية»');
    const D = W.describeJoiner;
    deq([D({}).state, D({joinedBy: null}).state, D({joinedBy: ''}).state, D({joinedBy: 7}).state, D({joinedBy: 'u'}).state], ['ABSENT', 'NULL', 'EMPTY', 'INVALID_TYPE', 'PRESENT'], '[٥] حالات المنضمّ الخمس صريحة');
    deq([W.describeSessionStatus({}).state, W.describeSessionStatus({status: 5}).state, W.describeSessionStatus({status: 'weird'}).state, W.describeSessionStatus({status: 'weird'}).value], ['ABSENT', 'NOT_A_STRING', 'UNRECOGNIZED', null], '[٥] حالة غائبة/ليست نصّاً/مجهولة: صريحة، والمجهولة لا تُطبَع');
    deq(W.describeSessionScanId({scanId: ''}), {state: 'SCAN_ID_UNREADABLE', scanIdHash: null}, '[٥] scanId فارغ ⟵ غير مقروء');
    const cr = (v) => W.buildSessionItem({id: 'x', data: {status: 'cancelled', createdAt: ts(at(17)), expiresAt: ts(at(18)), cancelReason: v}, nowMs: NOW}).cancelReason;
    eq(cr('left_by_customer').value, 'left_by_customer', '[٥] سبب إلغاء من المفردات يُطبَع');
    deq(cr('free text with SECRET'), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 'free text with SECRET'.length, outsideKnownVocabulary: true}, '[٥] سبب خارج المفردات لا يُطبَع ويُعلَن');
    deq(W.SESSION_SELECT.filter((f) => !['status', 'createdAt', 'expiresAt', 'joinedBy', 'joinedAt', 'scanId', 'completedAt', 'expiredAt', 'cancelledAt', 'cancelReason'].includes(f)), [], '[٥] SESSION_SELECT = القائمة البيضاء المعلَنة وحدها (لا code ولا ownerId ولا deviceModel)');
    ok(!W.SESSION_SELECT.includes('code'), '[٥] رمز الجلسة (code) لا يُختار أصلاً');
  }

  // ═══ ٦ — تقسيم النافذة ═══
  {
    const docs = [
      {id: 'at-since', data: {createdAt: ts(at(17, 0))}},
      {id: 'before-since', data: {createdAt: ts(at(16, 59, 59))}},
      {id: 'just-before-until', data: {createdAt: ts(at(17, 59, 59))}},
      {id: 'at-until', data: {createdAt: ts(at(18, 0))}},
      {id: 'absent', data: {}},
      {id: 'string', data: {createdAt: '2026-10-14T17:30:00+03:00'}},
    ];
    const p = W.partitionByWindow(docs, at(17, 0), at(18, 0));
    deq(p.inWindow.map((d) => d.id), ['at-since', 'just-before-until'], '[٦] since مشمول، until مستثنى');
    eq(p.outside, 2, '[٦] الخارجان');
    deq(p.unreadable.map((u) => u.state).sort(), ['ABSENT', 'UNREADABLE'], '[٦] غير المقروء يُعدّ ولا يُسقَط (غائب وغير مقروء حالتان)');
    deq(p.unreadable.map((u) => u.hash).sort(), [C.hashIdForLog('absent'), C.hashIdForLog('string')].sort(), '[٦] ويُسمّى بمعرّفه المُهشَّر');
    eq(p.inWindow.length + p.outside + p.unreadable.length, docs.length, '[٦] لا مستند يضيع: مجموع الثلاثة = الكلّ');
  }

  // ═══ ٧ — main ═══
  const run = async (argv, {env = ENV, db, auth = authFor(), caps, now = NOW} = {}) => {
    const outs = [];
    const errs = [];
    const code = await main(argv, {env, now: () => now, db, auth, caps, out: (s) => outs.push(s), err: (s) => errs.push(s)});
    return {code, outs, errs};
  };
  const secretIn = (...texts) => texts.some((t) => t && ALL_SECRETS.some((s) => t.includes(s)));
  {
    const outPath = nextOut();
    const db = makeMemDb(world());
    const r = await run([...WINDOW, '--out', outPath], {db});
    eq(r.code, 0, '[٧] النجاح: 0');
    const text = r.outs.join('\n');
    const j = JSON.parse(text);
    eq(Object.keys(j)[0], 'projectId', '[٧] projectId أوّل حقل');
    eq(j.projectId, 'neuralchek-9b6d7', '[٧] projectId المثبَّت');
    eq(j.mode, 'owner-activity-window', '[٧] mode');
    ok(/^EMULATOR |^PRODUCTION$/.test(j.target), '[٧] الهدف مطبوع');
    eq(j.generatedAtPlus03, '2026-10-14T18:00:00.000+03:00', '[٧] وقت التوليد بـ+03');
    eq(j.window.sincePlus03, '2026-10-14T17:00:00.000+03:00', '[٧] النافذة: since');
    eq(j.window.untilPlus03, '2026-10-14T18:00:00.000+03:00', '[٧] النافذة: until');
    eq(j.window.spanMinutes, 60, '[٧] النافذة: 60 دقيقة');
    // الحساب
    eq(j.account.accountHash, C.hashIdForLog(OWNER), '[٧] المعرّف مُهشَّر');
    eq(j.account.scansRemaining.value, 41, '[٧] الرصيد الآن');
    eq(j.account.reportsTotal, 6, '[٧] عدد تقارير المالك الكلّي (X وP وL وN وOLD وBADTIME؛ ليس تقرير الآخر)');
    eq(j.account.sessionsTotal, 5, '[٧] عدد جلسات المالك الكلّي (A وB وC وOLD وNOCREATED؛ ليس جلسة الآخر)');
    // التقارير في النافذة: X وP وL وN (وBADTIME غير مقروء الوقت، وOLD خارج، والآخر ليس للمالك)
    deq(j.reports.items.map((i) => i.scanIdHash), [SCAN.L, SCAN.X, SCAN.P, SCAN.N].map(C.hashIdForLog), '[٧] تقارير النافذة مرتَّبة بالوقت: L 17:20 · X 17:35 · P 17:50 · N 17:55');
    eq(j.reports.inWindow, 4, '[٧] عدد تقارير النافذة');
    eq(j.reports.outsideWindow, 1, '[٧] تقرير خارج النافذة (OLD)');
    deq(j.reports.unreadableCreatedAt, {count: 1, items: [{hash: C.hashIdForLog(SCAN.BADTIME), state: 'UNREADABLE', type: 'string'}]}, '[٧] تقرير بـcreatedAt نصّاً: مُعلَن غير مقروء (لا يُسقَط)');
    ok(!j.reports.items.some((i) => i.scanIdHash === C.hashIdForLog(SCAN.OTHERS)), '[٧] تقرير مالك آخر لا يظهر');
    const rx = j.reports.items.find((i) => i.scanIdHash === C.hashIdForLog(SCAN.X));
    eq(rx.sessionLink.sessionIdHash, C.hashIdForLog(SESS.B), '[٧] X: مرتبط بالجلسة B');
    eq(rx.kind, 'CACHED', '[٧] X: ردّ مخبَّأ');
    eq(rx.shortId.value, SHORT.X, '[٧] X: shortId');
    // الجلسات في النافذة: A وB وC (OLD خارج، وNOCREATED غير مقروء الوقت، والآخر ليس للمالك)
    deq(j.sessions.items.map((i) => i.sessionHash), [SESS.A, SESS.B, SESS.C].map(C.hashIdForLog), '[٧] جلسات النافذة مرتَّبة بالوقت: A 17:10 · B 17:30 · C 17:45');
    eq(j.sessions.outsideWindow, 1, '[٧] جلسة خارج النافذة (OLD)');
    deq(j.sessions.unreadableCreatedAt, {count: 1, items: [{hash: C.hashIdForLog(SESS.NOCREATED), state: 'ABSENT', type: null}]}, '[٧] جلسة بلا createdAt: مُعلَنة (غائب) لا تُسقَط');
    // الربط
    const lx = j.links.find((l) => l.scanIdHash === C.hashIdForLog(SCAN.X));
    deq(lx.reportLinkedSession, [C.hashIdForLog(SESS.B)], '[٧] X: ربطه التقرير بـB');
    deq(lx.sessionsPointingAtScan, [C.hashIdForLog(SESS.B)], '[٧] X: وB تشير إليه');
    eq(lx.multipleSessions, false, '[٧] X: جلسة واحدة');
    const ll = j.links.find((l) => l.scanIdHash === C.hashIdForLog(SCAN.L));
    eq(ll.distinctSessions, 1, '[٧] L: ربط قديم مضمَّن بـA');
    eq(j.completeness.complete, true, '[٧] النافذة كاملة');
    eq(j.selection.indexes.includes('No composite index'), true, '[٧] selection يعلن: لا فهرس مركّب');
    ok(j.selection.reports.includes('analyzeDevice.js:411') && j.selection.reports.includes('reportRaw/{scanId}.sessionId'), '[٧] selection يذكر كيف اختيرت التقارير (والمصدر)');
    // لا أسرار
    ok(!secretIn(text, r.errs.join('\n')), '[٧][الأهمّ] لا بريد ولا uid ولا scanId ولا sessionId ولا رمز جلسة ولا نصّ مزوّد في stdout ولا stderr');
    for (const code of Object.values(CODE)) ok(!text.includes(code), `[٧] رمز الجلسة ${code.slice(0, 6)}… لا يظهر (يشبه shortId لكنه حقل آخر)`);
    ok(!text.includes('SM-G973F') && !text.includes('"ownerId"') && !text.includes('"rawFingerprint"') && !text.includes('fcmToken'), '[٧] ولا حقل خارج القائمتين (موديل الجهاز، ownerId، الخامّ، fcmToken)');
    // القراءات: مساواة وحدها، لا استعلام مجموعة غير هاتين، ولا قراءة جلسة بمعرّفها
    const rawDocs = db.reads.filter((x) => x.startsWith('doc:reportRaw/')).sort();
    deq(rawDocs, [SCAN.L, SCAN.X, SCAN.P, SCAN.N].map((id) => `doc:reportRaw/${id}`).sort(), '[٧] reportRaw يُقرأ بمعرّفه لتقارير النافذة وحدها (4)');
    deq(db.reads.filter((x) => !x.startsWith('doc:reportRaw/')).sort(),
        [`doc:users/${OWNER}`, 'count:reports', 'query:reports', 'count:scanSessions', 'query:scanSessions'].sort(), '[٧][الأهمّ] ما سوى reportRaw: مستند المستخدم + عدّ واستعلام لتقارير المالك + عدّ واستعلام لجلساته، لا شيء غيرها');
    deq(db.writeAttempts, [], '[٧] لا كتابة Firestore');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٧] الملفّ UTF-8 بلا BOM');
    eq(bytes.toString('utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٧] الملفّ = المطبوع');
    const again = await run([...WINDOW, '--out', outPath], {db});
    eq(again.code, 2, '[٧] ملفّ موجود: لا استبدال (2)');
    ok(again.errs.some((e) => /OUT_EXISTS/.test(e)), '[٧] السبب OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٧] والملفّ القائم لم يُمسّ');
    const missingDir = await run([...WINDOW, '--out', path.join(tmp, 'nodir', 'x.json')], {db: makeMemDb(world())});
    ok(missingDir.code === 2 && missingDir.errs.some((e) => /OUT_DIR_MISSING/.test(e)), '[٧] مجلّد مخرَج غائب: 2 قبل أيّ قراءة');
  }
  {
    // فحص واحد تحت جلستين: A وB كلتاهما تشيران إليه (واقعة الكتابة المزدوجة)، والتقرير مربوط بالأخيرة
    const w = world();
    w.scanSessions[SESS.A] = {...w.scanSessions[SESS.A], status: 'completed', scanId: SCAN.X, completedAt: ts(at(17, 34, 40))};
    const r = await run(WINDOW, {db: makeMemDb(w)});
    eq(r.code, 0, '[٧] نجاح');
    const j = JSON.parse(r.outs.join('\n'));
    const lx = j.links.find((l) => l.scanIdHash === C.hashIdForLog(SCAN.X));
    eq(lx.multipleSessions, true, '[٧][الأهمّ] فحص واحد تحت جلستين ⟵ multipleSessions=true');
    deq(lx.sessionsPointingAtScan, [SESS.A, SESS.B].map(C.hashIdForLog).sort(), '[٧] والجلستان A وB تشيران إليه');
    deq(lx.reportLinkedSession, [C.hashIdForLog(SESS.B)], '[٧] والتقرير مربوط بـB وحدها');
    // تقرير مربوط بجلسة خارج النافذة
    const w2 = world();
    w2.reportRaw[SCAN.X] = {...w2.reportRaw[SCAN.X], sessionId: SESS.OLD};
    const r2 = await run(WINDOW, {db: makeMemDb(w2)});
    const lx2 = JSON.parse(r2.outs.join('\n')).links.find((l) => l.scanIdHash === C.hashIdForLog(SCAN.X));
    deq(lx2.reportLinkedSessionOutsideWindow, [C.hashIdForLog(SESS.OLD)], '[٧] تقرير مربوط بجلسة خارج النافذة: يُسمّى معرّفها المُهشَّر');
  }
  {
    // قاعدة بلا شيء للمالك: أصفار وحالات صريحة
    const r = await run(WINDOW, {db: makeMemDb({users: {}})});
    eq(r.code, 0, '[٧] لا مستند مستخدم ولا تقارير: 0 (حالة لا خطأ)');
    const j = JSON.parse(r.outs.join('\n'));
    eq(j.account.userDocExists, false, '[٧] userDocExists=false صريحة');
    deq(j.account.scansRemaining, {present: false, type: 'absent'}, '[٧] الرصيد غائب لا صفر');
    deq([j.reports.inWindow, j.sessions.inWindow, j.links.length, j.account.reportsTotal, j.account.sessionsTotal], [0, 0, 0, 0, 0], '[٧] أصفار');
  }
  {
    // السقوف: بلوغها مُعلَن والرمز 3، والمخرَج يُكتب
    const outPath = nextOut();
    const r = await run([...WINDOW, '--out', outPath], {db: makeMemDb(world()), caps: {reports: 3, sessions: 5000, rawReads: 200}});
    eq(r.code, 3, '[٧] بلوغ سقف التقارير: 3 (لا نجاح صامت)');
    const j = JSON.parse(r.outs.join('\n'));
    deq([j.completeness.complete, j.completeness.reports.capReached, j.completeness.reports.docsRead, j.completeness.sessions.capReached], [false, true, 3, false], '[٧] completeness يقول أيّ سقف');
    ok(fs.existsSync(outPath), '[٧] والمخرَج الناقص يُكتب (مُعلَناً ناقصاً)');
    const r2 = await run(WINDOW, {db: makeMemDb(world()), caps: {reports: 5000, sessions: 2, rawReads: 200}});
    eq(r2.code, 3, '[٧] بلوغ سقف الجلسات: 3');
    const r3 = await run(WINDOW, {db: makeMemDb(world()), caps: {reports: 5000, sessions: 5000, rawReads: 2}});
    eq(r3.code, 3, '[٧] بلوغ سقف قراءات reportRaw: 3');
    const j3 = JSON.parse(r3.outs.join('\n'));
    eq(j3.reports.items.filter((i) => i.sessionLink.state === 'NOT_READ_RAW_CAP_REACHED').length, 2, '[٧] ما فوق السقف: حالة صريحة NOT_READ_RAW_CAP_REACHED لا «فحص شخصي»');
    const exact = await run(WINDOW, {db: makeMemDb(world()), caps: {reports: 6, sessions: 5, rawReads: 4}});
    eq(exact.code, 0, '[٧] العدد = السقف بالضبط: ليس بلوغاً (يُقرأ مستند إضافي ليُعرَف ذلك)');
  }
  {
    const noEnv = await run(WINDOW, {env: {}, db: makeMemDb({})});
    eq(noEnv.code, 2, '[٧] بلا متغيّر البيئة: 2');
    ok(noEnv.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)), '[٧] OWNER_EMAIL_ENV_MISSING');
    const invalid = await run(WINDOW, {env: {[C.OWNER_EMAIL_ENV]: 'not-an-email'}, db: makeMemDb({})});
    ok(invalid.errs.some((e) => /OWNER_EMAIL_INVALID/.test(e)) && !invalid.errs.join('\n').includes('not-an-email'), '[٧] OWNER_EMAIL_INVALID ولا يُطبَع ما كُتب');
    const notFound = await run(WINDOW, {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: makeMemDb({})});
    eq(notFound.code, 2, '[٧] حساب غير موجود: 2');
    ok(notFound.errs.some((e) => /OWNER_ACCOUNT_NOT_FOUND \(code=auth\/user-not-found\)/.test(e)) && !notFound.errs.join('\n').includes('other@example.test'), '[٧] نصّ خطأ المزوّد (يحمل البريد) لا يُطبَع (القاعدة 36)');
    const badArgs = await run(['--since', 'x', '--until', UNTIL_ISO], {db: makeMemDb({})});
    eq(badArgs.code, 2, '[٧] وسيط سيّئ: 2');
    const pf = await run(['--preflight'], {env: {}});
    eq(pf.code, 0, '[٧] --preflight: 0 بلا شبكة');
    const pfj = JSON.parse(pf.outs.join('\n'));
    deq([pfj.network, pfj.readOnly, pfj.ok], [false, true, true], '[٧] --preflight يعلن network=false وreadOnly وok');
    // خطأ مزوّد يحمل رابط إنشاء فهرس وجزءاً من مفتاح: لا يُطبَع ولا يُقترَح فهرس (القاعدتان 36 و43)
    const providerError = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/neuralchek-9b6d7/firestore/indexes?create_composite=SECRET-LINK key=sk-SECRETKEY-WXYZ'), {code: 9});
    const base = makeMemDb(world());
    const failingDb = {...base, collection: (c) => (c === 'reports' ? {...base.collection(c), where: () => ({count: () => ({get: async () => ({data: () => ({count: 0})})}), select: () => ({limit: () => ({get: async () => { throw providerError; }})})})} : base.collection(c))};
    const failing = await run(WINDOW, {db: failingDb});
    eq(failing.code, 2, '[٧] فشل استعلام: 2');
    const errText = failing.errs.join('\n');
    ok(/\[Error\] code=9/.test(errText), '[٧] الصنف والرمز وحدهما');
    ok(!/index|https?:|console\.firebase|create_composite|SECRET|sk-/i.test(errText), '[٧][القاعدتان 36 و43] لا رابط ولا مفتاح ولا كلمة «فهرس» في نصّ الخطأ المطبوع');
    ok(!/index|https?:|console\.firebase|create_composite|SECRET|sk-/i.test(failing.outs.join('\n')), '[٧] ولا شيء منها على stdout');
    // الغلاف: أيّ كتابة عبر db المغلَّف ترمي TRAP
    let trap = null;
    try { C.wrapReadOnly(makeMemDb({users: {x: {}}})).collection('users').doc('x').update({a: 1}); } catch (e) { trap = e; }
    ok(trap && /TRAP: write operation "doc.update"/.test(trap.message), '[٧] wrapReadOnly يرمي TRAP عند كتابة');
  }
  {
    // الاستعلامات مساواة على حقل واحد: لا مرشّح نطاق ولا orderBy (يقرؤه الاختبار من سجلّ الاستعلام الحقيقي للمزيَّف)
    const seen = [];
    const base = makeMemDb(world());
    const spyDb = {...base, collection: (c) => {
      const col = base.collection(c);
      const wrapQ = (q) => new Proxy(q, {get(t, p) {
        if (p === 'where') return (f, op, v) => { seen.push(`${c}:where:${f}:${op}`); return wrapQ(t.where(f, op, v)); };
        if (p === 'orderBy') return (...a) => { seen.push(`${c}:orderBy`); return wrapQ(t.orderBy(...a)); };
        if (p === 'select') return (...a) => { seen.push(`${c}:select:${a.join(',')}`); return wrapQ(t.select(...a)); };
        return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
      }});
      return wrapQ(col);
    }};
    const r = await run(WINDOW, {db: spyDb});
    eq(r.code, 0, '[٧] نجاح بالمراقب');
    const wheres = seen.filter((s) => s.includes(':where:'));
    ok(wheres.length > 0 && wheres.every((s) => /:where:(userId|ownerId):==$/.test(s)), `[٧][الأهمّ] كل مرشّح مساواة على userId أو ownerId وحده: ${wheres.join(' | ')}`);
    ok(!seen.some((s) => s.endsWith(':orderBy')), '[٧] بلا orderBy (ولا فهرس مركّب)');
    deq(seen.filter((s) => s.startsWith('reports:select')).map((s) => s.split(':')[2].split(',').sort()).at(0), [...W.REPORT_SELECT].sort(), '[٧] قناع حقول التقارير = REPORT_SELECT');
    deq(seen.filter((s) => s.startsWith('scanSessions:select')).map((s) => s.split(':')[2].split(',').sort()).at(0), [...W.SESSION_SELECT].sort(), '[٧] قناع حقول الجلسات = SESSION_SELECT');
  }

  // ═══ ٨ — حارس الوقائع المنسوخة من الخادم وطفراته ═══
  // المكتبة تفترض: (أ) فحص الجلسة يكتب في reports.userId صاحبَ الجلسة (ب) sessionId خرج من مستند التقرير إلى reportRaw (ج) الخادم يكتب scanId على الجلسة عند الاكتمال وحده (sessionCompletion.js بنداء analyzeDevice، S-SWEEP 2026-10-15؛ كانت analyzeDevice.js تكتبه مباشرة)، وcreateScanSession تكتبه null
  // (د) أسماء حقول الختم. من يغيّر أيّاً منها يُخفق هذا الحارس ثم يُحدَّث السكربت (القاعدة 39).
  const analyzeSrc = read('src/analysis/analyzeDevice.js');
  const createSrc = read('src/sessions/createScanSession.js');
  const completionSrc = read('src/sessions/sessionCompletion.js');
  const guardViolations = (analyze, create, completion) => {
    const v = [];
    if (!analyze.includes('userId = sessionDoc.data().ownerId;')) v.push('USERID_IS_SESSION_OWNER');
    if (!/function buildReportDocument\(p\) \{\n  return \{\n    userId: p\.userId,/.test(analyze)) v.push('REPORT_DOCUMENT_USERID');
    // الاكتمال: كتابة واحدة في sessionCompletion.js (status وحقول المسار وcompletedAt)، وscanId يصلها من analyzeDevice (المسار أ: scanId الطلب) أو من cachedCompletionFields (المسار ب).
    if (!/tx\.update\(sessionRef, \{status: SESSION_STATUS\.COMPLETED, \.\.\.fields,/.test(completion) || !/path: COMPLETION_PATH\.FRESH_SCAN,\n\s+fields: \{scanId: scanId,/.test(analyze) ||
        !/const fields = \{scanId\};/.test(completion)) v.push('SESSION_SCANID_WRITTEN_AT_COMPLETION');
    if (!analyze.includes('fieldsVersion: p.fieldsVersion,')) v.push('FIELDS_VERSION_FIELD');
    if (!analyze.includes('...evaluationRulesStampFields(p),')) v.push('RULES_STAMP_FIELD');
    if (!analyze.includes('sessionId: p.isSessionScan ? p.sessionId : null,') && !read('src/analysis/reportRawStore.js').includes('sessionId: p.isSessionScan ? p.sessionId : null,')) v.push('RAW_SESSIONID');
    if (!/scanId: null,/.test(create)) v.push('CREATE_WRITES_SCANID_NULL');
    return v;
  };
  deq(guardViolations(analyzeSrc, createSrc, completionSrc), [], '[٨] الوقائع الخمس قائمة في المصادر الحالية');
  ok(REPORT_RAW_FIELDS.includes('sessionId'), '[٨] sessionId ضمن REPORT_RAW_FIELDS (الحقول المنقولة)');
  ok(guardViolations(analyzeSrc.replace('userId = sessionDoc.data().ownerId;', 'userId = request.auth.uid;'), createSrc).includes('USERID_IS_SESSION_OWNER'), '[٨] طفرة: فحص الجلسة يُنسَب لـuid الجهاز ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc.replace('    userId: p.userId,', '    ownerUid: p.userId,'), createSrc, completionSrc).includes('REPORT_DOCUMENT_USERID'), '[٨] طفرة: مفتاح userId يُغيَّر في مستند التقرير ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc.replace('fields: {scanId: scanId, shortId: shortId,', 'fields: {shortId: shortId,'), createSrc, completionSrc).includes('SESSION_SCANID_WRITTEN_AT_COMPLETION'), '[٨] طفرة: الخادم لا يمرّر scanId للاكتمال (المسار أ) ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc, createSrc, completionSrc.replace('const fields = {scanId};', 'const fields = {};')).includes('SESSION_SCANID_WRITTEN_AT_COMPLETION'), '[٨] طفرة: الاكتمال بالمسار ب لا يكتب scanId ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc, createSrc, completionSrc.replace('{status: SESSION_STATUS.COMPLETED, ...fields,', '{status: SESSION_STATUS.COMPLETED,')).includes('SESSION_SCANID_WRITTEN_AT_COMPLETION'), '[٨] طفرة: كتابة الاكتمال لا تنشر حقول المسار (scanId) ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc.replace('fieldsVersion: p.fieldsVersion,', 'fv: p.fieldsVersion,'), createSrc, completionSrc).includes('FIELDS_VERSION_FIELD'), '[٨] طفرة: اسم حقل fieldsVersion ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc.replace('...evaluationRulesStampFields(p),', ''), createSrc, completionSrc).includes('RULES_STAMP_FIELD'), '[٨] طفرة: ختم قواعد التقييم يُزال ⟵ تُكشَف');
  ok(guardViolations(analyzeSrc, createSrc.replace('scanId: null,', ''), completionSrc).includes('CREATE_WRITES_SCANID_NULL'), '[٨] طفرة: createScanSession لا تكتب scanId ⟵ تُكشَف');
  ok(W.REPORT_SELECT.includes('fieldsVersion') && W.REPORT_SELECT.includes(EVALUATION_RULES_VERSION_FIELD) && W.REPORT_SELECT.includes('sessionId'), '[٨] REPORT_SELECT يحمل حقول الختم وsessionId القديم');

  // ═══ ٩ — الحارس الساكن للقراءة فقط وطفراته ═══
  const FORBIDDEN = Object.freeze({
    FIRESTORE_WRITE: /\.(?:set|update|create|delete)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(/,
    DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
    NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
    EMAIL_OUTPUT: /\$\{\s*email\s*\}|\b(?:out|err|console\.\w+)\(\s*email\b|JSON\.stringify\(\s*email\b|\bemail\s*:\s*email\b|\bowner_email\b/,
    AUTH_WRITE: /\b(?:createUser|updateUser|deleteUser|setCustomUserClaims|revokeRefreshTokens|generate\w*Link|importUsers|deleteUsers|createCustomToken)\b/,
    INDEX_SUGGESTION: /create[_\s-]*(?:composite|index)|firestore:indexes|indexes\s+create|console\.firebase|firestore\.indexes\.json|\.createIndex\(/i,
    RAW_SESSION_CODE_SELECTED: /['"]code['"]/,
    RANGE_FILTER_OR_ORDER: /\.orderBy\(|\.where\([^)]*['"](?:<|<=|>|>=|in|array-contains|!=)['"]/,
  });
  const ADD_RECEIVERS_ALLOWED = new Set(['out', 'reportLinkedSessions', 'sessionsPointingAtScan', 'all']);
  const staticViolations = (kind, raw) => {
    const src = stripComments(raw.replace(/\r\n/g, '\n'));
    const v = new Set();
    for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
    // `.add(` على Set مسمّاة مشروعة (مستقبلها في القائمة)؛ وعلى ناتج نداء (collection(...).add) كتابة Firestore
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.add\(/g)) if (!ADD_RECEIVERS_ALLOWED.has(m[1])) v.add('STATIC:FIRESTORE_WRITE');
    if (/\)\s*\.add\(/.test(src)) v.add('STATIC:FIRESTORE_WRITE');
    if (kind === 'script') {
      if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
      if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
      if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
      if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
    }
    return [...v].sort();
  };
  const scriptSrc = read('scripts/owner-activity-window-readonly.js');
  const libSrc = read('scripts/lib/ownerActivityWindow.js');
  deq(staticViolations('script', scriptSrc), [], '[٩] السكربت: بلا كتابة ولا شبكة ولا طباعة بريد ولا اقتراح فهرس');
  deq(staticViolations('lib', libSrc), [], '[٩] المكتبة: بلا كتابة ولا شبكة ولا طباعة بريد ولا اقتراح فهرس ولا نطاق/ترتيب ولا اختيار code');
  const mutateStatic = (kind, src, extra) => staticViolations(kind, `${src}\n${extra}\n`);
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').doc('x').update({status: 'expired'});").includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: كتابة Firestore ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').add({status: 'pending'});").includes('STATIC:FIRESTORE_WRITE'), '[٩] طفرة: collection().add ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('fs').writeFileSync('x', 'y');").includes('STATIC:DISK_WRITE'), '[٩] طفرة: كتابة ملفّ ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, 'out(`owner ${email}`);').includes('STATIC:EMAIL_OUTPUT'), '[٩] طفرة: طباعة البريد ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('https').request('x');").includes('STATIC:NETWORK'), '[٩] طفرة: شبكة ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, "const z = process.argv[2];").includes('STATIC:ARGV_READ_OUTSIDE_ENTRY'), '[٩] طفرة: قراءة process.argv ثانية ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "const hint = 'create the composite index at https://console.firebase.google.com';").includes('STATIC:INDEX_SUGGESTION'), '[٩] طفرة: نصّ يقترح إنشاء فهرس ⟵ يُكشَف (القاعدة 43)');
  ok(mutateStatic('lib', libSrc, "db.collection('reports').where('createdAt', '>=', 1).orderBy('createdAt');").includes('STATIC:RANGE_FILTER_OR_ORDER'), '[٩] طفرة: مرشّح نطاق/ترتيب (يحتاج فهرساً مركّباً) ⟵ يُكشَف');
  ok(mutateStatic('lib', libSrc, "const f = ['status', 'code'];").includes('STATIC:RAW_SESSION_CODE_SELECTED'), '[٩] طفرة: اختيار حقل code (رمز الجلسة) ⟵ يُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.wrapReadOnly(', 'identity(')).includes('STATIC:NO_WRAP_READ_ONLY_DB'), '[٩] طفرة: إزالة wrapReadOnly ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.writeOutputExclusive(', 'identity(')).includes('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER'), '[٩] طفرة: إزالة كاتب المخرَج الحصري ⟵ تُكشَف');

  console.log(`ownerActivityWindow.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
