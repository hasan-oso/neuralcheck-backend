'use strict';

// ownerOpenSessions.test.js — السكربت owner-open-sessions-readonly.js ومكتبته scripts/lib/ownerOpenSessions.js (الجلسات المفتوحة لمالك واحد، 2026-10-15 +03).
// وحدة بلا شبكة ولا محاكٍ. الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في هذا الاختبار وحده؛ والطبقة الحقيقية (Firestore الحيّ) يُشغّلها المستخدم بيده.
// وما يعتمد عليه التصنيف من وقائع الخادم (ما تكتبه createScanSession وjoinScanSession وanalyzeDevice على الجلسة، وأن evaluationEnabled ليس حقلاً فيها) يحرسه §٦ بطفرات (القاعدة 39) —
// فمن يغيّر الخادم يُخفق هذا الاختبار ثم يُحدَّث السكربت. (لا مسّ بملفّ في functions/src.)
//
// ١ الوسائط · ٢ الأحكام النقيّة (الانقضاء الآن بحكم الخادم، العمر، المدّة، حارس النشر، الشكل) · ٣ الجمع على عالم اصطناعي (الصفوف والترتيب والارتباطات والملخّص)
// ٤ main: لا بريد ولا معرّف خامّ ولا رمز جلسة، القراءات مساواة وحدها، لا كتابة، --out بـwx، السقوف، الأخطاء، ولا اقتراح فهرس · ٥ الاستعلامات (مساواة على حقل واحد، أقنعة الحقول)
// ٦ حارس الوقائع المنسوخة من الخادم وطفراته · ٧ الحارس الساكن للقراءة فقط وطفراته · ٨ الحارس الديناميكي (db وAuth وfs والشبكة والمطبوع) بطفرات على الملفّين الحقيقيين
//
// Run: node functions/test/ownerOpenSessions.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const O = require('../scripts/lib/ownerOpenSessions');
const A = require('../scripts/lib/activeSessions');
const {main} = require('../scripts/owner-open-sessions-readonly');
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');

const FN = path.join(__dirname, '..');
const LIB_FILE = path.join(FN, 'scripts', 'lib', 'ownerOpenSessions.js');
const SCRIPT_FILE = path.join(FN, 'scripts', 'owner-open-sessions-readonly.js');
const readSource = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const read = (rel) => readSource(path.join(FN, rel));
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1').replace(/^#!.*$/m, '');

const MIN = 60 * 1000;
const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
// الأوقات بـ+03: 2026-10-<d> الساعة h:m
const at = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 3, m, 0);
const NOW = at(15, 11, 0);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-open-sessions-'));
let counter = 0;
const nextOut = () => path.join(tmp, `oos-${++counter}.json`);

const SECRET_EMAIL = 'owner.shop.secret@example.test';
const OWNER = 'uid-OWNER-SECRET-424242';
const OTHER = 'uid-OTHER-SECRET-999999';
const JOINER = 'uid-JOINER-SECRET-111111';
const JOINER2 = 'uid-JOINER2-SECRET-222222';
const SESS = {
  PEND_VALID: 'sess-PENDVALID-SECRET-01', PEND_OLD: 'sess-PENDOLD-SECRET-02', JOINED_OLD: 'sess-JOINEDOLD-SECRET-03', JOINED_P4: 'sess-JOINEDP4-SECRET-04',
  JOINED_VALID: 'sess-JOINEDVALID-SECRET-05', NOID: 'sess-NOID-SECRET-06', ANOM: 'sess-ANOM-SECRET-07', NOEXP: 'sess-NOEXP-SECRET-08', BADEXP: 'sess-BADEXP-SECRET-09',
  STREXP: 'sess-STREXP-SECRET-10', NOCREATED: 'sess-NOCREATED-SECRET-11', UNKNOWN: 'sess-UNKNOWN-SECRET-12', NOSTATUS: 'sess-NOSTATUS-SECRET-13', NUMSTATUS: 'sess-NUMSTATUS-SECRET-14',
  COMPLETED: 'sess-COMPLETED-SECRET-15', EXPIRED: 'sess-EXPIRED-SECRET-16', CANCELLED: 'sess-CANCELLED-SECRET-17', OTHERS: 'sess-OTHERS-SECRET-18',
};
const SCAN = {P4: 'scan-P4-SECRET-0001', X: 'scan-X-SECRET-0002', LEG: 'scan-LEG-SECRET-0003', INFL: 'scan-INFL-SECRET-0004', STALE: 'scan-STALE-SECRET-0005', AGEUNK: 'scan-AGEUNK-SECRET-0006', OTHER: 'scan-OTHER-SECRET-0007', PERSONAL: 'scan-PERSONAL-SECRET-0008'};
const CODE = {A: 'NC-SECRA2', B: 'NC-SECRB3'};
const PROVIDER_TEXT = 'deepseek 401 key ends in sk-SECRETKEY-WXYZ';
const authFor = (uid = OWNER) => ({getUserByEmail: async (email) => {
  if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  return {uid};
}});
const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};
const ALL_SECRETS = [SECRET_EMAIL, 'owner.shop', OWNER, OTHER, JOINER, JOINER2, ...Object.values(SESS), ...Object.values(SCAN), ...Object.values(CODE), 'SECRET', 'sk-SECRETKEY', PROVIDER_TEXT, 'SM-G973F'];

const reservation = {userId: OWNER, isFreeTrial: false, deviceFP: null, reservedAtMs: NOW - 60000};

/**
 * عالم الاختبار (الآن = 2026-10-15 11:00 +03): أربعة عشر صفّاً مدرجاً (أحد عشر مفتوحاً وثلاث بحالات غير مصنَّفة)، وثلاث نهائية لا تُدرَج، وجلسة مالك آخر.
 * الارتباطات: تقرير reportRaw تحت JOINED_P4، وتقرير قديم مضمَّن تحت JOINED_OLD، وثلاثة أقفال (جارٍ بحجز، قديم بحجز، بلا عمر وبلا حجز).
 */
function world(overrides = {}) {
  const sessions = {
    [SESS.PEND_VALID]: {ownerId: OWNER, code: CODE.A, status: 'pending', createdAt: ts(NOW - 10 * MIN), expiresAt: ts(NOW + 50 * MIN), scanId: null, deviceModel: null},
    [SESS.PEND_OLD]: {ownerId: OWNER, code: CODE.B, status: 'pending', createdAt: ts(at(10, 9)), expiresAt: ts(at(10, 10)), scanId: null, deviceModel: null},
    [SESS.JOINED_OLD]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(12, 15)), expiresAt: ts(at(12, 16)), joinedBy: JOINER, joinedAt: ts(at(12, 15, 2)), scanId: null, deviceModel: 'SM-G973F'},
    [SESS.JOINED_P4]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(13, 10)), expiresAt: ts(at(13, 11)), joinedBy: JOINER, joinedAt: ts(at(13, 10, 3)), scanId: null},
    [SESS.JOINED_VALID]: {ownerId: OWNER, status: 'scanning', createdAt: ts(NOW - 40 * MIN), expiresAt: ts(NOW + 20 * MIN), joinedBy: JOINER2, joinedAt: ts(NOW - 38 * MIN), scanId: null},
    [SESS.NOID]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(13, 18)), expiresAt: ts(at(13, 19)), joinedBy: null, joinedAt: ts(at(13, 18, 1)), scanId: null},
    [SESS.ANOM]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(14, 9)), expiresAt: ts(at(14, 10)), joinedBy: JOINER, joinedAt: ts(at(14, 9, 2)), scanId: SCAN.X, completedAt: ts(at(14, 9, 30))},
    [SESS.NOEXP]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(14, 11)), joinedBy: JOINER, joinedAt: ts(at(14, 11, 1)), scanId: null},
    [SESS.BADEXP]: {ownerId: OWNER, status: 'scanning', createdAt: ts(at(14, 12)), expiresAt: 'soon', joinedBy: JOINER, joinedAt: ts(at(14, 12, 1)), scanId: null, evaluationEnabled: false},
    [SESS.STREXP]: {ownerId: OWNER, status: 'scanning', createdAt: ts(NOW - 5 * MIN), expiresAt: new Date(NOW + 55 * MIN).toISOString(), joinedBy: JOINER2, joinedAt: ts(NOW - 4 * MIN), scanId: null},
    [SESS.NOCREATED]: {ownerId: OWNER, status: 'scanning', expiresAt: ts(at(9, 12)), joinedBy: JOINER, joinedAt: ts(at(9, 11, 1)), scanId: null},
    [SESS.UNKNOWN]: {ownerId: OWNER, status: 'done', createdAt: ts(at(11, 9)), expiresAt: ts(at(11, 10))},
    [SESS.NOSTATUS]: {ownerId: OWNER, createdAt: ts(at(11, 10)), expiresAt: ts(at(11, 11))},
    [SESS.NUMSTATUS]: {ownerId: OWNER, status: 5, createdAt: ts(at(11, 10, 30)), expiresAt: ts(at(11, 11, 30))},
    [SESS.COMPLETED]: {ownerId: OWNER, status: 'completed', createdAt: ts(at(12, 9)), expiresAt: ts(at(12, 10)), joinedBy: JOINER, scanId: SCAN.PERSONAL, completedAt: ts(at(12, 9, 20))},
    [SESS.EXPIRED]: {ownerId: OWNER, status: 'expired', createdAt: ts(at(12, 11)), expiresAt: ts(at(12, 12)), expiredAt: ts(at(12, 13))},
    [SESS.CANCELLED]: {ownerId: OWNER, status: 'cancelled', createdAt: ts(at(12, 13)), expiresAt: ts(at(12, 14)), cancelledAt: ts(at(12, 13, 5)), cancelReason: 'cancelled_by_owner'},
    [SESS.OTHERS]: {ownerId: OTHER, status: 'scanning', createdAt: ts(NOW - 20 * MIN), expiresAt: ts(NOW + 40 * MIN), joinedBy: JOINER, joinedAt: ts(NOW - 18 * MIN), scanId: null},
  };
  return {
    users: {[OWNER]: {evaluationEnabled: true, email: SECRET_EMAIL, plan: 'shop_basic', scansRemaining: 41}},
    scanSessions: sessions,
    reportRaw: {
      [SCAN.P4]: {scanId: SCAN.P4, sessionId: SESS.JOINED_P4},
      [SCAN.OTHER]: {scanId: SCAN.OTHER, sessionId: SESS.OTHERS},
      [SCAN.PERSONAL]: {scanId: SCAN.PERSONAL, sessionId: null},
    },
    reports: {[SCAN.LEG]: {userId: OWNER, sessionId: SESS.JOINED_OLD, createdAt: ts(at(12, 15, 5))}},
    scanClaims: {
      [SCAN.INFL]: {scanId: SCAN.INFL, userId: OWNER, sessionId: SESS.JOINED_VALID, claimedAtMs: NOW - 60000, reservation},
      [SCAN.STALE]: {scanId: SCAN.STALE, userId: OWNER, sessionId: SESS.NOID, claimedAtMs: NOW - 3600000, reservation},
      [SCAN.AGEUNK]: {scanId: SCAN.AGEUNK, userId: OWNER, sessionId: SESS.ANOM, reservation: null},
    },
    ...overrides,
  };
}

const EXPECTED_ORDER = ['PEND_OLD', 'UNKNOWN', 'NOSTATUS', 'NUMSTATUS', 'JOINED_OLD', 'JOINED_P4', 'NOID', 'ANOM', 'NOEXP', 'BADEXP', 'JOINED_VALID', 'PEND_VALID', 'STREXP', 'NOCREATED'];
const hs = (key) => C.hashIdForLog(SESS[key]);

(async () => {
  // ═══ ١ — الوسائط ═══
  {
    deq(O.parseArgs([]), {mode: 'run', out: null}, '[١] بلا وسائط: تشغيل عادي');
    deq(O.parseArgs(['--out', 'x.json']), {mode: 'run', out: 'x.json'}, '[١] --out');
    deq(O.parseArgs(['--preflight']), {mode: 'preflight', out: null}, '[١] --preflight');
    const bad = (argv, re) => { try { O.parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
    ok(bad(['--preflight', '--out', 'x.json'], /--preflight وحدها/), '[١] --preflight مع --out مرفوض');
    ok(bad(['--email', 'a@b.c'], /وسيط مجهول --email/) && !bad(['--email', 'a@b.c'], /a@b\.c/), '[١] البريد لا يُقبل من سطر الأمر، ولا تُطبَع قيمته');
    ok(bad(['--email=a@b.c'], /وسيط مجهول --email$/), '[١] --email=قيمة: اسم الوسيط وحده يُطبَع');
    ok(bad(['x.json'], /وسيط مجهول \(موضعي\)/), '[١] وسيط موضعي مرفوض');
    ok(bad(['--out'], /--out يحتاج قيمة/), '[١] --out بلا قيمة مرفوض');
    ok(bad(['--out', 'a', '--out', 'b'], /مكرَّر/), '[١] --out مكرَّر مرفوض');
    ok(bad(['--since', '2026-10-14T17:00:00+03:00'], /وسيط مجهول --since/), '[١] --since/--until لا وجود لهما (لا نافذة زمنية في هذه الأداة)');
    const pf = O.preflightChecks({});
    ok(pf.ok && pf.checks.length >= 15 && pf.ownerEmailEnvPresent === false, '[١] preflight: كل الفحوص تمرّ');
    eq(O.preflightChecks(ENV).ownerEmailEnvPresent, true, '[١] preflight يعلن حضور المتغيّر (لا قيمته)');
  }

  // ═══ ٢ — الأحكام النقيّة ═══
  {
    const E = O.EXPIRY_NOW;
    const exp = (d) => O.expiryNowOf(d, NOW);
    deq(exp({expiresAt: ts(NOW + 20 * MIN)}), {state: E.STILL_VALID, minutesLeft: 20, expiredMinutesAgo: null}, '[٢] صالحة: تبقّى 20 دقيقة');
    deq(exp({expiresAt: ts(NOW - 90 * MIN)}), {state: E.EXPIRED_BY_TIME, minutesLeft: null, expiredMinutesAgo: 90}, '[٢] منتهية بالوقت منذ 90 دقيقة');
    eq(exp({expiresAt: ts(NOW)}).state, E.STILL_VALID, '[٢] expiresAt == الآن تماماً: ليست منتهية (الخادم: expiresAt < now)');
    eq(exp({expiresAt: ts(NOW - 1)}).state, E.EXPIRED_BY_TIME, '[٢] بعد مللي ثانية: منتهية');
    eq(exp({}).state, E.EXPIRES_AT_ABSENT, '[٢][القاعدة 22] expiresAt غائب: حالة صريحة لا صالحة ولا منتهية');
    eq(exp(null).state, E.EXPIRES_AT_ABSENT, '[٢] مستند null: غائب');
    eq(exp({expiresAt: null}).state, E.EXPIRES_AT_UNREADABLE, '[٢] expiresAt null (≠ غائب): غير مقروء');
    eq(exp({expiresAt: 'soon'}).state, E.EXPIRES_AT_UNREADABLE, '[٢] نصّ غير تاريخ: غير مقروء');
    eq(exp({expiresAt: new Date(NOW + 5 * MIN).toISOString()}).state, E.STILL_VALID, '[٢] نصّ ISO مقروء بحكم الخادم (toDateOrNull): الحكم حكم الخادم نفسه');
    eq(exp({expiresAt: NOW - MIN}).state, E.EXPIRED_BY_TIME, '[٢] رقم ms مقروء بحكم الخادم نفسه (يُعلَن نوعه في expiresAt.unreadableType)');
    // العمر والمدّة
    deq(O.ageOf({createdAt: ts(NOW - 90 * MIN)}, NOW), {state: 'OK', minutes: 90}, '[٢] العمر 90 دقيقة');
    deq(O.ageOf({}, NOW), {state: 'CREATED_AT_ABSENT', minutes: null}, '[٢] createdAt غائب: حالة صريحة');
    deq(O.ageOf({createdAt: 'x'}, NOW), {state: 'CREATED_AT_UNREADABLE', minutes: null}, '[٢] createdAt نصّ: غير مقروء');
    deq(O.lifetimeOf({createdAt: ts(NOW), expiresAt: ts(NOW + 60 * MIN)}), {state: 'OK', minutes: 60}, '[٢] المدّة 60 دقيقة (SESSION_VALIDITY_MINUTES)');
    deq(O.lifetimeOf({expiresAt: ts(NOW)}), {state: 'CREATED_AT_ABSENT', minutes: null}, '[٢] المدّة: createdAt غائب');
    deq(O.lifetimeOf({createdAt: ts(NOW)}), {state: 'EXPIRES_AT_ABSENT', minutes: null}, '[٢] المدّة: expiresAt غائب');
    // حارس النشر
    const dg = (data, unclassified = false) => O.deployGuardOf(data, NOW, unclassified);
    deq(dg({createdAt: ts(NOW - 119 * MIN)}), {windowMinutes: 120, createdAtState: 'IN_WINDOW', blocksDeploy: true, basis: 'CREATED_AT_WINDOW'}, '[٢] قبل 119 دقيقة: داخل النافذة، تمنع');
    eq(dg({createdAt: ts(NOW - 120 * MIN)}).blocksDeploy, true, '[٢] 120 بالضبط: داخل (العمر ≤ النافذة، كما activeSessions)');
    eq(dg({createdAt: ts(NOW - 121 * MIN)}).blocksDeploy, false, '[٢] 121: خارج النافذة، لا تمنع');
    eq(dg({createdAt: ts(NOW - 121 * MIN), expiresAt: ts(NOW + 99 * MIN)}).blocksDeploy, false, '[٢] الانتهاء بالوقت ليس جزءاً من المعيار: تقرير createdAt وحده');
    eq(dg({createdAt: ts(NOW - 20 * MIN), expiresAt: ts(NOW - 10 * MIN)}).blocksDeploy, true, '[٢] منتهية بالوقت لكنها داخل النافذة: تمنع (كما يحكم الحارس القائم)');
    eq(dg({}).createdAtState, 'CREATED_AT_ABSENT', '[٢] createdAt غائب: CREATED_AT_ABSENT');
    eq(dg({}).blocksDeploy, true, '[٢] createdAt غائب يمنع (القاعدة 22)');
    deq(dg({createdAt: ts(NOW - 999 * MIN)}, true), {windowMinutes: 120, createdAtState: 'OLDER_THAN_WINDOW', blocksDeploy: true, basis: 'STATUS_UNCLASSIFIED_BLOCKS'}, '[٢] حالة غير مصنَّفة تمنع ولو كانت قديمة');
    // الشكل
    const item = (o) => ({status: {state: 'KNOWN', value: 'scanning'}, joiner: {state: 'PRESENT'}, scanLink: {state: 'SCAN_ID_NULL'}, joinedAt: {present: true}, completedAt: {present: false}, ...o});
    const S = O.SHAPE;
    eq(O.classifyShape(item({status: {state: 'KNOWN', value: 'pending'}, joiner: {state: 'ABSENT'}, joinedAt: {present: false}})), S.PENDING_NOT_JOINED, '[٢] pending بلا انضمام');
    eq(O.classifyShape(item({status: {state: 'KNOWN', value: 'pending'}, joiner: {state: 'PRESENT'}})), S.PENDING_WITH_JOIN_FIELDS, '[٢] pending وعليها joinedBy: شاذّة');
    eq(O.classifyShape(item({status: {state: 'KNOWN', value: 'pending'}, joiner: {state: 'ABSENT'}, joinedAt: {present: true}})), S.PENDING_WITH_JOIN_FIELDS, '[٢] pending وعليها joinedAt: شاذّة');
    eq(O.classifyShape(item({status: {state: 'KNOWN', value: 'pending'}, joiner: {state: 'NULL'}, joinedAt: {present: false}})), S.PENDING_WITH_JOIN_FIELDS, '[٢] pending وjoinedBy=null: شاذّة');
    eq(O.classifyShape(item({})), S.SCANNING_JOINED_NO_RESULT, '[٢] scanning منضمّ بهوية بلا نتيجة');
    eq(O.classifyShape(item({scanLink: {state: 'SCAN_ID_ABSENT'}})), S.SCANNING_JOINED_NO_RESULT, '[٢] scanId غائب (لا null) يُقرأ كـ null هنا: لا نتيجة');
    eq(O.classifyShape(item({joiner: {state: 'NULL'}})), S.SCANNING_JOINED_WITHOUT_IDENTITY, '[٢] scanning وjoinedBy=null');
    eq(O.classifyShape(item({joiner: {state: 'ABSENT'}})), S.SCANNING_WITHOUT_JOINED_BY, '[٢] scanning بلا joinedBy: شاذّة');
    eq(O.classifyShape(item({joiner: {state: 'EMPTY'}})), S.SCANNING_JOINED_BY_UNREADABLE, '[٢] joinedBy فارغ');
    eq(O.classifyShape(item({joiner: {state: 'INVALID_TYPE'}})), S.SCANNING_JOINED_BY_UNREADABLE, '[٢] joinedBy بنوع غير نصّ');
    eq(O.classifyShape(item({scanLink: {state: 'SCAN_ID_SET'}})), S.SCANNING_WITH_RESULT_FIELDS, '[٢] scanning وعليها scanId: شاذّة');
    eq(O.classifyShape(item({scanLink: {state: 'SCAN_ID_UNREADABLE'}})), S.SCANNING_WITH_RESULT_FIELDS, '[٢] scanId بنوع غير نصّ: شاذّة (تُعلَن لا تُسقَط)');
    eq(O.classifyShape(item({completedAt: {present: true}})), S.SCANNING_WITH_RESULT_FIELDS, '[٢] scanning وعليها completedAt: شاذّة');
    eq(O.classifyShape(item({status: {state: 'UNRECOGNIZED', value: null}})), S.STATUS_UNCLASSIFIED, '[٢] حالة لا تعرفها الشيفرة');
    eq(O.classifyShape(item({status: {state: 'ABSENT', value: null}})), S.STATUS_UNCLASSIFIED, '[٢] حالة غائبة');
    eq(O.classifyShape(item({status: {state: 'KNOWN', value: 'completed'}})), S.STATUS_UNCLASSIFIED, '[٢] نهائية لا تُصنَّف شكلاً مفتوحاً (لا تُدرَج أصلاً؛ إن بلغت هنا تُعلَن)');
  }

  // ═══ ٣ — الجمع على العالم الاصطناعي ═══
  const collect = (db = makeMemDb(world()), extra = {}) => O.collectOwnerOpenSessions({db: C.wrapReadOnly(db), auth: authFor(), email: SECRET_EMAIL, nowMs: NOW, ...extra});
  {
    const r = await collect();
    eq(r.account.accountHash, C.hashIdForLog(OWNER), '[٣] المعرّف مُهشَّر');
    eq(r.account.userDocExists, true, '[٣] مستند المالك موجود');
    deq([r.account.evaluationEnabledNow.value, r.account.evaluationEnabledNow.reason, r.account.evaluationEnabledNow.valueType], [true, 'FLAG_TRUE', null], '[٣] evaluationEnabled لحساب المالك الآن (من المصدر نفسه الذي تستعمله joinScanSession)');
    ok(r.account.evaluationEnabledNow.source.includes('Not stored on the session document'), '[٣] والمخرَج يعلن أنه ليس حقلاً في مستند الجلسة');
    eq(r.account.sessionsTotal, 17, '[٣] عدد جلسات المالك الكلّي (ليس جلسة الآخر)');
    deq(r.totals.byStatus, {pending: 2, scanning: 9, completed: 1, expired: 1, cancelled: 1}, '[٣] توزيع الحالات المعروفة لكلّ جلسات المالك');
    deq(r.totals.unclassified, {statusAbsent: 1, statusUnreadable: 1, statusUnknown: 1, unknownNames: {done: 1}}, '[٣][القاعدة 22] الحالات غير المصنَّفة معدودة ومسمّاة (done بنصّ يبدو اسم حالة)');
    eq(r.totals.docsRead, 17, '[٣] المستندات المقروءة');
    deq(r.sessions.map((s) => s.sessionHash), EXPECTED_ORDER.map(hs), '[٣] الصفوف مرتَّبة بـcreatedAt تصاعدياً، وغير المقروء آخراً: الأقدم أوّلاً');
    eq(r.sessions.length, 14, '[٣] أربعة عشر صفّاً: 11 مفتوحة + 3 غير مصنَّفة الحالة (لا تُسقَط)');
    ok(!r.sessions.some((s) => [SESS.COMPLETED, SESS.EXPIRED, SESS.CANCELLED, SESS.OTHERS].map(C.hashIdForLog).includes(s.sessionHash)), '[٣] النهائية وجلسة المالك الآخر لا تُدرَج');
    const row = (key) => r.sessions.find((s) => s.sessionHash === hs(key));

    // الحالة والتواريخ والانضمام وscanId
    deq(row('JOINED_OLD').status, {state: 'KNOWN', value: 'scanning'}, '[٣] JOINED_OLD: الحالة');
    eq(row('JOINED_OLD').createdAtPlus03, '2026-10-12T15:00:00.000+03:00', '[٣] JOINED_OLD: createdAt بـ+03');
    eq(row('JOINED_OLD').expiresAt.plus03, '2026-10-12T16:00:00.000+03:00', '[٣] JOINED_OLD: expiresAt بـ+03');
    eq(row('JOINED_OLD').joinedAt.plus03, '2026-10-12T15:02:00.000+03:00', '[٣] JOINED_OLD: joinedAt بـ+03');
    deq(row('JOINED_OLD').joiner, {state: 'PRESENT', hash: C.hashIdForLog(JOINER)}, '[٣] joinedBy: حاضر ومُهشَّر');
    deq(row('NOID').joiner, {state: 'NULL', hash: null}, '[٣] joinedBy=null: حالة صريحة (انضمّ بلا هوية)');
    deq(row('PEND_VALID').joiner, {state: 'ABSENT', hash: null}, '[٣] joinedBy غائب: حالة صريحة');
    deq(row('JOINED_OLD').scanLink, {state: 'SCAN_ID_NULL', scanIdHash: null}, '[٣] scanId=null: حالة صريحة');
    deq(row('ANOM').scanLink, {state: 'SCAN_ID_SET', scanIdHash: C.hashIdForLog(SCAN.X)}, '[٣] scanId حاضر ومُهشَّر');
    deq(row('NOEXP').expiresAt, {present: false}, '[٣] expiresAt غائب: present=false');
    deq(row('BADEXP').expiresAt, {present: true, plus03: null, unreadableType: 'string'}, '[٣] expiresAt نصّ: حاضر بنوعه، لا وقت');
    deq(row('STREXP').expiresAt, {present: true, plus03: null, unreadableType: 'string'}, '[٣] expiresAt نصّ ISO: يظهر نوعه (والخادم يقرؤه تاريخاً: expiryNow أدناه)');
    eq(row('NOCREATED').createdAtPlus03, null, '[٣] createdAt غائب: لا وقت');
    deq(row('NOCREATED').age, {state: 'CREATED_AT_ABSENT', minutes: null}, '[٣] وعمره حالة صريحة');
    eq(row('JOINED_OLD').age.minutes, (NOW - at(12, 15)) / MIN, '[٣] JOINED_OLD: العمر بالدقائق');
    deq(row('JOINED_OLD').lifetime, {state: 'OK', minutes: 60}, '[٣] JOINED_OLD: المدّة 60');
    deq(row('NOEXP').lifetime, {state: 'EXPIRES_AT_ABSENT', minutes: null}, '[٣] NOEXP: المدّة حالة صريحة');

    // انقضى وقتها الآن؟
    const E = O.EXPIRY_NOW;
    const expiry = (key) => row(key).expiryNow.state;
    deq(['PEND_VALID', 'PEND_OLD', 'JOINED_OLD', 'JOINED_P4', 'JOINED_VALID', 'NOID', 'ANOM', 'NOEXP', 'BADEXP', 'STREXP', 'NOCREATED'].map(expiry),
        [E.STILL_VALID, E.EXPIRED_BY_TIME, E.EXPIRED_BY_TIME, E.EXPIRED_BY_TIME, E.STILL_VALID, E.EXPIRED_BY_TIME, E.EXPIRED_BY_TIME, E.EXPIRES_AT_ABSENT, E.EXPIRES_AT_UNREADABLE, E.STILL_VALID, E.EXPIRED_BY_TIME],
        '[٣][الأهمّ] الانقضاء الآن لكلّ مفتوحة: صالحة/منتهية بالوقت/غائب/غير مقروء — بحكم الخادم');
    deq(r.summary.expiryNow, {[E.EXPIRED_BY_TIME]: 6, [E.STILL_VALID]: 3, [E.EXPIRES_AT_ABSENT]: 1, [E.EXPIRES_AT_UNREADABLE]: 1}, '[٣] ملخّص الانقضاء (المفتوحة وحدها)');
    eq(row('JOINED_VALID').expiryNow.minutesLeft, 20, '[٣] JOINED_VALID: تبقّى 20 دقيقة');
    eq(row('PEND_OLD').expiryNow.expiredMinutesAgo, (NOW - at(10, 10)) / MIN, '[٣] PEND_OLD: منتهية منذ كذا دقيقة');
    eq(row('BADEXP').activeButPastExpiry, false, '[٣] الحقل القائم activeButPastExpiry (isDueForExpiredRecord) false لغير المقروء — وexpiryNow يقول السبب');
    eq(row('JOINED_OLD').activeButPastExpiry, true, '[٣] والحقل القائم true للمنتهية بالوقت');

    // الشكل
    const S = O.SHAPE;
    deq(r.summary.byShape, {[S.PENDING_NOT_JOINED]: 2, [S.SCANNING_JOINED_NO_RESULT]: 7, [S.SCANNING_JOINED_WITHOUT_IDENTITY]: 1, [S.SCANNING_WITH_RESULT_FIELDS]: 1, [S.STATUS_UNCLASSIFIED]: 3}, '[٣] ملخّص الأشكال (مجموعها 14)');
    eq(row('NOID').shape, S.SCANNING_JOINED_WITHOUT_IDENTITY, '[٣] NOID: انضمّ بلا هوية');
    eq(row('ANOM').shape, S.SCANNING_WITH_RESULT_FIELDS, '[٣] ANOM: شاذّة');
    eq(row('UNKNOWN').shape, S.STATUS_UNCLASSIFIED, '[٣] UNKNOWN: غير مصنَّفة');
    deq(row('UNKNOWN').status, {state: 'UNRECOGNIZED', value: null}, '[٣] حالة لا تعرفها الشيفرة لا تُطبَع قيمتها هنا (classifyStatus)');
    eq(row('UNKNOWN').listedBecause, 'STATUS_UNCLASSIFIED', '[٣] سبب الإدراج');
    eq(row('JOINED_OLD').listedBecause, 'OPEN', '[٣] سبب الإدراج للمفتوحة');

    // حارس النشر
    const blocking = r.sessions.filter((s) => s.deployGuard.blocksDeploy).map((s) => s.sessionHash).sort();
    deq(blocking, ['JOINED_VALID', 'PEND_VALID', 'STREXP', 'NOCREATED', 'UNKNOWN', 'NOSTATUS', 'NUMSTATUS'].map(hs).sort(), '[٣][الأهمّ] ما يمنع النشر: الثلاث داخل نافذة 120 دقيقة + createdAt غائب + الحالات الثلاث غير المصنَّفة');
    eq(r.summary.deployGuard.blocksNow, 7, '[٣] ملخّص: 7 تمنع');
    deq(r.summary.deployGuard.byCreatedAtState, {IN_WINDOW: 3, OLDER_THAN_WINDOW: 10, CREATED_AT_ABSENT: 1}, '[٣] ملخّص حالات createdAt لحارس النشر (14 صفّاً)');
    eq(row('JOINED_OLD').deployGuard.blocksDeploy, false, '[٣] JOINED_OLD (منتهية وقديمة): لا تمنع');
    eq(row('STREXP').deployGuard.createdAtState, 'IN_WINDOW', '[٣] STREXP داخل النافذة');

    // evaluationEnabled
    deq(row('JOINED_OLD').evaluationEnabled.onSessionDocument, {present: false, type: 'absent'}, '[٣][القاعدة 22] evaluationEnabled على مستند الجلسة: غائب صراحةً');
    deq(row('JOINED_OLD').evaluationEnabled.ownerAccountNow, {value: true, reason: 'FLAG_TRUE'}, '[٣] وقيمة حساب المالك الآن في كلّ صفّ');
    deq(row('BADEXP').evaluationEnabled.onSessionDocument, {present: true, type: 'boolean', value: false}, '[٣] لو وُجد الحقل على الجلسة لظهر بقيمته');

    // الارتباطات
    deq(row('JOINED_P4').linked, {state: 'READ', reportsInReportRaw: 1, reportsLegacyEmbedded: 0, claims: {count: 0, withReservation: 0, inFlight: 0, stale: 0, ageUnknown: 0}}, '[٣] JOINED_P4: تقرير reportRaw مرتبط بجلسة ما زالت scanning');
    deq(row('JOINED_OLD').linked, {state: 'READ', reportsInReportRaw: 0, reportsLegacyEmbedded: 1, claims: {count: 0, withReservation: 0, inFlight: 0, stale: 0, ageUnknown: 0}}, '[٣] JOINED_OLD: تقرير قديم مضمَّن');
    deq(row('JOINED_VALID').linked.claims, {count: 1, withReservation: 1, inFlight: 1, stale: 0, ageUnknown: 0}, '[٣] JOINED_VALID: قفل جارٍ بحجز');
    deq(row('NOID').linked.claims, {count: 1, withReservation: 1, inFlight: 0, stale: 1, ageUnknown: 0}, '[٣] NOID: قفل قديم بحجز');
    deq(row('ANOM').linked.claims, {count: 1, withReservation: 0, inFlight: 0, stale: 0, ageUnknown: 1}, '[٣][القاعدة 22] ANOM: قفل بلا claimedAtMs: عمره مجهول لا قديم ولا جارٍ');
    deq(row('PEND_VALID').linked, {state: 'READ', reportsInReportRaw: 0, reportsLegacyEmbedded: 0, claims: {count: 0, withReservation: 0, inFlight: 0, stale: 0, ageUnknown: 0}}, '[٣] جلسة بلا ارتباط: أصفار مقروءة (حالة READ لا غياب)');
    deq(r.summary.linked, {rowsRead: 14, rowsNotRead: 0, rowsWithReportInReportRaw: 1, rowsWithLegacyEmbeddedReport: 1, rowsWithClaims: 3, rowsWithReservedClaim: 2}, '[٣] ملخّص الارتباطات');
    eq(r.summary.createdAt.oldestPlus03, '2026-10-10T09:00:00.000+03:00', '[٣] أقدم createdAt');
    eq(r.summary.createdAt.newestPlus03, '2026-10-15T10:55:00.000+03:00', '[٣] أحدث createdAt');
    deq([r.summary.createdAt.readable, r.summary.createdAt.notReadable], [13, 1], '[٣] createdAt المقروء وغير المقروء (جلسة واحدة بلا createdAt)');
    deq([r.summary.listed, r.summary.open, r.summary.openByStatus, r.summary.statusUnclassifiedListed], [14, 11, {pending: 2, scanning: 9}, 3], '[٣] ملخّص العدّ');
    deq([r.completeness.complete, r.completeness.sessions.capReached, r.completeness.perSessionReads.capReached, r.completeness.perSessionReads.done], [true, false, false, 14], '[٣] الاكتمال');

    // الجدول المضغوط: سطر لكلّ صفّ، بالترتيب نفسه، وكلّ غياب خلية صريحة بين قوسين
    const colCount = O.TABLE_COLUMNS.split(' | ').length;
    eq(colCount, 14, '[٣] أربعة عشر عموداً');
    eq(r.table.columns, O.TABLE_COLUMNS, '[٣] رؤوس الأعمدة في المخرَج');
    eq(r.table.rows.length, r.sessions.length, '[٣] سطر لكلّ صفّ');
    ok(r.table.rows.every((line) => line.split(' | ').length === colCount), '[٣] كلّ سطر بعدد الأعمدة نفسه');
    deq(r.table.rows.map((line) => line.split(' | ')[0]), EXPECTED_ORDER.map(hs), '[٣] ترتيب الأسطر = ترتيب الصفوف');
    const line = (key) => r.table.rows.find((l) => l.startsWith(`${hs(key)} | `));
    eq(line('JOINED_P4'), [hs('JOINED_P4'), 'scanning', '2026-10-13 10:00', '2940', '2026-10-13 11:00', 'EXPIRED(2880m ago)', '2026-10-13 10:03', C.hashIdForLog(JOINER), '(null)', 'absent/true', 'no', 'SCANNING_JOINED_NO_RESULT', '1/0', '0/0/0'].join(' | '), '[٣] سطر JOINED_P4 كاملاً (جلسة scanning وتقرير مرتبط بها في reportRaw: 1/0)');
    ok(line('NOCREATED').includes('| (CREATED_AT_ABSENT) | (CREATED_AT_ABSENT) |'), '[٣] createdAt غائب: خليّتا الوقت والعمر حالة صريحة');
    ok(line('NOEXP').includes('| (absent) | EXPIRES_AT_ABSENT |'), '[٣] expiresAt غائب: خليّة صريحة وحكم صريح');
    ok(line('BADEXP').includes('| (unreadable:string) | EXPIRES_AT_UNREADABLE |') && line('BADEXP').includes('| false/true |'), '[٣] expiresAt نصّ: (unreadable:string)؛ وevaluationEnabled على الجلسة false وحساب المالك true');
    ok(line('NOID').includes('| (null) | (null) |'), '[٣] NOID: joinedBy=null وscanId=null خليّتان صريحتان');
    ok(line('PEND_VALID').includes('| (absent) | (absent) | (null) |') && line('PEND_VALID').includes('VALID(50m left)'), '[٣] PEND_VALID: joinedAt وjoinedBy غائبان، وVALID(50m left)');
    ok(line('UNKNOWN').split(' | ')[1] === '(UNRECOGNIZED)' && line('NOSTATUS').split(' | ')[1] === '(ABSENT)' && line('NUMSTATUS').split(' | ')[1] === '(NOT_A_STRING)', '[٣] الحالات غير المصنَّفة: حالة صريحة في خليّة status');
    ok(line('JOINED_VALID').endsWith('| 0/0 | 1/1/1'), '[٣] JOINED_VALID: قفل واحد بحجز وجارٍ');
    ok(line('ANOM').includes('| SCANNING_WITH_RESULT_FIELDS |') && line('ANOM').split(' | ')[8] === C.hashIdForLog(SCAN.X), '[٣] ANOM: scanId مُهشَّر في الخليّة، والشكل شاذّ');
  }
  {
    // مستند مالك غائب: حالة صريحة، وأصفار
    const r = await collect(makeMemDb({users: {}}));
    eq(r.account.userDocExists, false, '[٣] userDocExists=false صريحة');
    deq([r.account.evaluationEnabledNow.value, r.account.evaluationEnabledNow.reason], [false, 'OWNER_DOC_MISSING'], '[٣] evaluationEnabled: OWNER_DOC_MISSING لا false صامتة');
    deq([r.sessions.length, r.account.sessionsTotal, r.summary.open, r.summary.createdAt.oldestPlus03], [0, 0, 0, null], '[٣] لا جلسات: أصفار وnull صريحة');
    const w = world();
    delete w.users[OWNER].evaluationEnabled;
    const r2 = await collect(makeMemDb(w));
    eq(r2.account.evaluationEnabledNow.reason, 'FLAG_ABSENT', '[٣] العلم غائب: FLAG_ABSENT');
  }

  // ═══ ٤ — main ═══
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
    const r = await run(['--out', outPath], {db});
    eq(r.code, 0, '[٤] النجاح: 0');
    const text = r.outs.join('\n');
    const j = JSON.parse(text);
    eq(Object.keys(j)[0], 'projectId', '[٤] projectId أوّل حقل');
    eq(j.projectId, 'neuralchek-9b6d7', '[٤] projectId المثبَّت');
    eq(j.mode, 'owner-open-sessions', '[٤] mode');
    eq(j.schema, 1, '[٤] schema');
    ok(/^EMULATOR |^PRODUCTION$/.test(j.target), '[٤] الهدف مطبوع');
    eq(j.generatedAtPlus03, '2026-10-15T11:00:00.000+03:00', '[٤] وقت التوليد بـ+03');
    eq(j.sessions.length, 14, '[٤] الصفوف');
    ok(j.selection.indexes.includes('no composite index'), '[٤] selection يعلن: لا فهرس مركّب');
    ok(j.selection.deployGuard.includes('Expiry by time is NOT part'), '[٤] selection يعلن أن الانتهاء بالوقت ليس من معيار حارس النشر');
    deq(j.selection.printedSessionFields, [...O.SESSION_SELECT], '[٤] الحقول المطبوعة = SESSION_SELECT');
    ok(!j.selection.printedSessionFields.includes('code') && !j.selection.printedSessionFields.includes('ownerId'), '[٤] لا code ولا ownerId في القائمة البيضاء');
    // لا أسرار
    ok(!secretIn(text, r.errs.join('\n')), '[٤][الأهمّ] لا بريد ولا uid ولا sessionId ولا scanId ولا joinedBy ولا رمز جلسة ولا موديل جهاز ولا نصّ مزوّد في stdout ولا stderr');
    for (const code of Object.values(CODE)) ok(!text.includes(code), `[٤] رمز الجلسة ${code.slice(0, 6)}… لا يظهر`);
    ok(!/"(?:ownerId|code|deviceModel|shortId|fcmToken)":/.test(text), '[٤] ولا مفتاح خارج القائمة البيضاء في المخرَج (ownerId، code، deviceModel، shortId، fcmToken)');
    ok(!text.includes('scansRemaining') && !text.includes('shop_basic'), '[٤] ولا شيء من مستند المالك سوى evaluationEnabled (لا رصيد ولا باقة)');
    // القراءات: بالضبط ما ينبغي
    const expectedReads = [`doc:users/${OWNER}`, 'count:scanSessions', 'query:scanSessions'];
    for (let i = 0; i < 14; i++) expectedReads.push('count:reportRaw', 'count:reports', 'query:scanClaims');
    deq([...db.reads].sort(), expectedReads.sort(), '[٤][الأهمّ] القراءات: مستند المالك + عدّ واستعلام جلساته + ثلاث قراءات لكلّ صفّ (14) — لا شيء غيرها');
    deq(db.writeAttempts, [], '[٤] لا كتابة Firestore');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٤] الملفّ UTF-8 بلا BOM');
    eq(bytes.toString('utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٤] الملفّ = المطبوع');
    const again = await run(['--out', outPath], {db});
    eq(again.code, 2, '[٤] ملفّ موجود: لا استبدال (2)');
    ok(again.errs.some((e) => /OUT_EXISTS/.test(e)), '[٤] السبب OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٤] والملفّ القائم لم يُمسّ');
    const dbBefore = makeMemDb(world());
    const missingDir = await run(['--out', path.join(tmp, 'nodir', 'x.json')], {db: dbBefore});
    ok(missingDir.code === 2 && missingDir.errs.some((e) => /OUT_DIR_MISSING/.test(e)), '[٤] مجلّد مخرَج غائب: 2');
    deq(dbBefore.reads, [], '[٤] وبلا أيّ قراءة قبل ذلك (الملفّ يُفحَص قبل فتح اتصال)');
    const noOut = await run([], {db: makeMemDb(world())});
    eq(noOut.code, 0, '[٤] بلا --out: 0');
    ok(noOut.errs.some((e) => /no file written/.test(e)), '[٤] stderr يعلن: لا ملفّ يُكتب');
  }
  {
    // السقوف: بلوغها مُعلَن والرمز 3، والمخرَج يُكتب
    const outPath = nextOut();
    const r = await run(['--out', outPath], {db: makeMemDb(world()), caps: {sessions: 5, openRows: 300}});
    eq(r.code, 3, '[٤] بلوغ سقف الجلسات: 3 (لا نجاح صامت)');
    const j = JSON.parse(r.outs.join('\n'));
    deq([j.completeness.complete, j.completeness.sessions.capReached, j.completeness.sessions.docsRead, j.completeness.perSessionReads.capReached], [false, true, 5, false], '[٤] completeness يقول أيّ سقف');
    ok(fs.existsSync(outPath), '[٤] والمخرَج الناقص يُكتب (مُعلَناً ناقصاً)');
    const r2 = await run([], {db: makeMemDb(world()), caps: {sessions: 5000, openRows: 4}});
    eq(r2.code, 3, '[٤] بلوغ سقف قراءات الارتباط: 3');
    const j2 = JSON.parse(r2.outs.join('\n'));
    eq(j2.sessions.filter((s) => s.linked.state === 'NOT_READ_CAP_REACHED').length, 10, '[٤] ما فوق السقف: حالة صريحة NOT_READ_CAP_REACHED لا أصفار');
    eq(j2.sessions.filter((s) => s.linked.state === 'READ').length, 4, '[٤] والمقروء 4');
    eq(j2.table.rows.filter((l) => l.endsWith('| (NOT_READ_CAP_REACHED) | (NOT_READ_CAP_REACHED)')).length, 10, '[٤] وفي الجدول: خليّتا الارتباط حالة صريحة للعشرة');
    deq([j2.summary.linked.rowsRead, j2.summary.linked.rowsNotRead], [4, 10], '[٤] الملخّص يفرّق المقروء من غير المقروء');
    const exact = await run([], {db: makeMemDb(world()), caps: {sessions: 17, openRows: 14}});
    eq(exact.code, 0, '[٤] العدد = السقف بالضبط: ليس بلوغاً (يُقرأ مستند إضافي ليُعرَف ذلك)');
  }
  {
    const noEnv = await run([], {env: {}, db: makeMemDb({})});
    eq(noEnv.code, 2, '[٤] بلا متغيّر البيئة: 2');
    ok(noEnv.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)), '[٤] OWNER_EMAIL_ENV_MISSING');
    const invalid = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'not-an-email'}, db: makeMemDb({})});
    ok(invalid.errs.some((e) => /OWNER_EMAIL_INVALID/.test(e)) && !invalid.errs.join('\n').includes('not-an-email'), '[٤] OWNER_EMAIL_INVALID ولا يُطبَع ما كُتب');
    const notFound = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: makeMemDb({})});
    eq(notFound.code, 2, '[٤] حساب غير موجود: 2');
    ok(notFound.errs.some((e) => /OWNER_ACCOUNT_NOT_FOUND \(code=auth\/user-not-found\)/.test(e)) && !notFound.errs.join('\n').includes('other@example.test'), '[٤] نصّ خطأ المزوّد (يحمل البريد) لا يُطبَع (القاعدة 36)');
    const badArgs = await run(['--since', 'x'], {db: makeMemDb({})});
    eq(badArgs.code, 2, '[٤] وسيط سيّئ: 2');
    const pf = await run(['--preflight'], {env: {}});
    eq(pf.code, 0, '[٤] --preflight: 0 بلا شبكة');
    const pfj = JSON.parse(pf.outs.join('\n'));
    deq([pfj.network, pfj.readOnly, pfj.ok, pfj.script], [false, true, true, 'owner-open-sessions'], '[٤] --preflight يعلن network=false وreadOnly وok');
    // خطأ مزوّد يحمل رابط إنشاء فهرس وجزءاً من مفتاح: لا يُطبَع ولا يُقترَح فهرس (القاعدتان 36 و43)
    const providerError = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/neuralchek-9b6d7/firestore/indexes?create_composite=SECRET-LINK key=sk-SECRETKEY-WXYZ'), {code: 9});
    const base = makeMemDb(world());
    const failingDb = {...base, collection: (c) => (c === 'scanSessions' ? {...base.collection(c), where: () => ({count: () => ({get: async () => ({data: () => ({count: 0})})}), select: () => ({limit: () => ({get: async () => { throw providerError; }})})})} : base.collection(c))};
    const failing = await run([], {db: failingDb});
    eq(failing.code, 2, '[٤] فشل استعلام: 2');
    const errText = failing.errs.join('\n');
    ok(/\[Error\] code=9/.test(errText), '[٤] الصنف والرمز وحدهما');
    ok(!/index|https?:|console\.firebase|create_composite|SECRET|sk-/i.test(errText), '[٤][القاعدتان 36 و43] لا رابط ولا مفتاح ولا كلمة «فهرس» في نصّ الخطأ المطبوع');
    ok(!/index|https?:|console\.firebase|create_composite|SECRET|sk-/i.test(failing.outs.join('\n')), '[٤] ولا شيء منها على stdout');
    // فشل قراءة ارتباط داخل صفّ: الخطأ نفسه، لا صفّ ناقص صامت
    const failingLinkDb = {...base, collection: (c) => (c === 'scanClaims' ? {...base.collection(c), where: () => ({select: () => ({get: async () => { throw providerError; }})})} : base.collection(c))};
    const failingLink = await run([], {db: failingLinkDb});
    eq(failingLink.code, 2, '[٤] فشل قراءة الأقفال: 2 (لا يُكتب صفّ ناقص كأنّه كامل)');
    ok(!/index|https?:|SECRET|sk-/i.test(failingLink.errs.join('\n') + failingLink.outs.join('\n')), '[٤] ونصّ المزوّد لا يُطبَع');
    // الغلاف: أيّ كتابة عبر db المغلَّف ترمي TRAP
    let trap = null;
    try { C.wrapReadOnly(makeMemDb({users: {x: {}}})).collection('users').doc('x').update({a: 1}); } catch (e) { trap = e; }
    ok(trap && /TRAP: write operation "doc.update"/.test(trap.message), '[٤] wrapReadOnly يرمي TRAP عند كتابة');
  }

  // ═══ ٥ — الاستعلامات: مساواة على حقل واحد، وأقنعة الحقول ═══
  {
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
    const r = await run([], {db: spyDb});
    eq(r.code, 0, '[٥] نجاح بالمراقب');
    const wheres = seen.filter((s) => s.includes(':where:'));
    ok(wheres.length > 0 && wheres.every((s) => /^(?:scanSessions:where:ownerId|(?:reportRaw|reports|scanClaims):where:sessionId):==$/.test(s)), `[٥][الأهمّ] كل مرشّح مساواة على حقل واحد (ownerId للجلسات، sessionId للارتباطات): ${[...new Set(wheres)].join(' | ')}`);
    ok(!seen.some((s) => s.endsWith(':orderBy')), '[٥] بلا orderBy (ولا فهرس مركّب)');
    ok(!seen.some((s) => /:where:status/.test(s)), '[٥] الحالة لا تُرشَّح في الاستعلام (تُصفّى في الذاكرة)');
    deq(seen.filter((s) => s.startsWith('scanSessions:select')).map((s) => s.split(':')[2].split(',').sort()).at(0), [...O.SESSION_SELECT].sort(), '[٥] قناع حقول الجلسات = SESSION_SELECT');
    deq(seen.filter((s) => s.startsWith('scanClaims:select')).map((s) => s.split(':')[2].split(',').sort()).at(0), ['claimedAtMs', 'reservation'], '[٥] قناع الأقفال: claimedAtMs وreservation وحدهما');
    ok(!O.SESSION_SELECT.includes('code') && !O.SESSION_SELECT.includes('ownerId') && !O.SESSION_SELECT.includes('deviceModel') && !O.SESSION_SELECT.includes('shortId'), '[٥] القائمة البيضاء بلا code وownerId وdeviceModel وshortId');
    ok(O.SESSION_SELECT.includes('evaluationEnabled'), '[٥] وتحوي evaluationEnabled ليُعلَن غيابه');
  }

  // ═══ ٦ — حارس الوقائع المنسوخة من الخادم وطفراته ═══
  // التصنيف يفترض: (أ) createScanSession تكتب status=pending وscanId=null وexpiresAt، ولا joinedBy ولا joinedAt (ب) joinScanSession تكتب status=scanning وjoinedAt وjoinedBy في كتابة واحدة، ولو joinedBy=null
  // (ج) الاكتمال يكتب status=completed وscanId وcompletedAt في كتابة واحدة (sessionCompletion.js بنداء analyzeDevice، S-SWEEP 2026-10-15؛ كانت analyzeDevice.js تكتبها مباشرة) (د) evaluationEnabled لا يُكتب على الجلسة (يُحسب عند الانضمام ويُعاد) (هـ) حكم الانقضاء الوحيد sessionExpiryRefusal.
  // من يغيّر أيّاً منها يُخفق هذا الحارس ثم يُحدَّث السكربت (القاعدة 39).
  const createSrc = read('src/sessions/createScanSession.js');
  const joinSrc = read('src/sessions/joinScanSession.js');
  const analyzeSrc = read('src/analysis/analyzeDevice.js');
  const timeoutSrc = read('src/sessions/sessionTimeout.js');
  const completionSrc = read('src/sessions/sessionCompletion.js');
  const factViolations = (create, join, analyze, timeout, completion) => {
    const v = [];
    const c = stripComments(create);
    if (!/status: SESSION_STATUS\.PENDING,/.test(c) || !/scanId: null,/.test(c) || !/expiresAt: new Date\(/.test(c)) v.push('CREATE_WRITES_PENDING_SCANID_NULL_EXPIRES');
    if (/joinedBy|joinedAt/.test(c)) v.push('CREATE_WRITES_JOIN_FIELDS');
    if (!/tx\.update\(sessionRef, \{\n\s+status: SESSION_STATUS\.SCANNING,\n\s+joinedAt: admin\.firestore\.FieldValue\.serverTimestamp\(\),\n\s+joinedBy: joinerUid,\n\s+\}\);/.test(join)) v.push('JOIN_WRITES_SCANNING_JOINEDAT_JOINEDBY');
    // الاكتمال: كتابة واحدة في sessionCompletion.js (status وحقول المسار وcompletedAt)، وanalyzeDevice تمرّر لها scanId مع المسارين (المسار أ: scanId الطلب؛ المسار ب: cachedCompletionFields).
    if (!/tx\.update\(sessionRef, \{status: SESSION_STATUS\.COMPLETED, \.\.\.fields, completedAt: FieldValue\.serverTimestamp\(\)\}\);/.test(completion) ||
        !/path: COMPLETION_PATH\.FRESH_SCAN,\n\s+fields: \{scanId: scanId, shortId: shortId,/.test(analyze) || !/cachedCompletionFields\(\{scanId, reportData: existingData\}\)/.test(analyze) ||
        !/const fields = \{scanId\};/.test(completion)) v.push('ANALYZE_WRITES_COMPLETED_SCANID_COMPLETEDAT');
    if (/evaluationEnabled/.test(stripComments(create)) || /tx\.update\(sessionRef, \{[^}]*evaluationEnabled/.test(join) || /scanSessions"\)\.doc\(sessionId\)\.update\(\{[^}]*evaluationEnabled/.test(analyze)) v.push('EVALUATION_ENABLED_WRITTEN_ON_SESSION');
    if (!/function sessionExpiryRefusal\(/.test(timeout) || !/module\.exports = \{[^}]*sessionExpiryRefusal/.test(timeout)) v.push('SESSION_EXPIRY_REFUSAL_EXPORTED');
    return v;
  };
  deq(factViolations(createSrc, joinSrc, analyzeSrc, timeoutSrc, completionSrc), [], '[٦] وقائع الخادم الخمس قائمة في المصادر الحالية');
  ok(factViolations(createSrc.replace('scanId: null,', ''), joinSrc, analyzeSrc, timeoutSrc, completionSrc).includes('CREATE_WRITES_PENDING_SCANID_NULL_EXPIRES'), '[٦] طفرة: createScanSession لا تكتب scanId ⟵ تُكشَف');
  ok(factViolations(createSrc.replace('status: SESSION_STATUS.PENDING,', 'status: "open",'), joinSrc, analyzeSrc, timeoutSrc, completionSrc).includes('CREATE_WRITES_PENDING_SCANID_NULL_EXPIRES'), '[٦] طفرة: حالة الإنشاء تتغيّر ⟵ تُكشَف');
  ok(factViolations(createSrc.replace('scanId: null,', 'scanId: null,\n          joinedBy: null,'), joinSrc, analyzeSrc, timeoutSrc, completionSrc).includes('CREATE_WRITES_JOIN_FIELDS'), '[٦] طفرة: الإنشاء يكتب joinedBy ⟵ تُكشَف (pending لم ينضمّ إليها أحد)');
  ok(factViolations(createSrc, joinSrc.replace('joinedBy: joinerUid,', 'joiner: joinerUid,'), analyzeSrc, timeoutSrc, completionSrc).includes('JOIN_WRITES_SCANNING_JOINEDAT_JOINEDBY'), '[٦] طفرة: الانضمام لا يكتب joinedBy ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc.replace('joinedAt: admin.firestore.FieldValue.serverTimestamp(),\n          joinedBy: joinerUid,', 'joinedBy: joinerUid,'), analyzeSrc, timeoutSrc, completionSrc).includes('JOIN_WRITES_SCANNING_JOINEDAT_JOINEDBY'), '[٦] طفرة: الانضمام لا يكتب joinedAt ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc, analyzeSrc, timeoutSrc, completionSrc.replace(', completedAt: FieldValue.serverTimestamp()}', '}')).includes('ANALYZE_WRITES_COMPLETED_SCANID_COMPLETEDAT'), '[٦] طفرة: الاكتمال لا يكتب completedAt ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc, analyzeSrc.replace('fields: {scanId: scanId, shortId: shortId,', 'fields: {shortId: shortId,'), timeoutSrc, completionSrc).includes('ANALYZE_WRITES_COMPLETED_SCANID_COMPLETEDAT'), '[٦] طفرة: المسار أ لا يمرّر scanId للاكتمال ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc, analyzeSrc, timeoutSrc, completionSrc.replace('const fields = {scanId};', 'const fields = {};')).includes('ANALYZE_WRITES_COMPLETED_SCANID_COMPLETEDAT'), '[٦] طفرة: المسار ب لا يكتب scanId ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc, analyzeSrc.replace('cachedCompletionFields({scanId, reportData: existingData})', 'cachedCompletionFields({reportData: existingData})'), timeoutSrc, completionSrc).includes('ANALYZE_WRITES_COMPLETED_SCANID_COMPLETEDAT'), '[٦] طفرة: المسار ب لا يمرّر scanId ⟵ تُكشَف');
  ok(factViolations(createSrc.replace('scanId: null,', 'scanId: null,\n          evaluationEnabled: false,'), joinSrc, analyzeSrc, timeoutSrc, completionSrc).includes('EVALUATION_ENABLED_WRITTEN_ON_SESSION'), '[٦] طفرة: الإنشاء يكتب evaluationEnabled على الجلسة ⟵ تُكشَف (فيجب أن يقرأه السكربت لا يعلن غيابه)');
  ok(factViolations(createSrc, joinSrc.replace('joinedBy: joinerUid,\n        });', 'joinedBy: joinerUid,\n          evaluationEnabled: true,\n        });'), analyzeSrc, timeoutSrc, completionSrc).includes('EVALUATION_ENABLED_WRITTEN_ON_SESSION'), '[٦] طفرة: الانضمام يكتب evaluationEnabled على الجلسة ⟵ تُكشَف');
  ok(factViolations(createSrc, joinSrc, analyzeSrc, timeoutSrc.replace('function sessionExpiryRefusal(', 'function sessionExpiryVerdict('), completionSrc).includes('SESSION_EXPIRY_REFUSAL_EXPORTED'), '[٦] طفرة: حكم الانقضاء يُعاد تسميته ⟵ يُكشَف');
  eq(A.SESSIONS_WINDOW_MIN, 120, '[٦] نافذة حارس النشر 120 دقيقة (قرار المستخدم، من activeSessions.js)');

  // ═══ ٧ — الحارس الساكن للقراءة فقط وطفراته ═══
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
  const ADD_RECEIVERS_ALLOWED = new Set([]);
  const staticViolations = (kind, raw) => {
    const src = stripComments(raw.replace(/\r\n/g, '\n'));
    const v = new Set();
    for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
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
  const scriptSrc = readSource(SCRIPT_FILE);
  const libSrc = readSource(LIB_FILE);
  deq(staticViolations('script', scriptSrc), [], '[٧] السكربت: بلا كتابة ولا شبكة ولا طباعة بريد ولا اقتراح فهرس');
  deq(staticViolations('lib', libSrc), [], '[٧] المكتبة: بلا كتابة ولا شبكة ولا طباعة بريد ولا اقتراح فهرس ولا نطاق/ترتيب ولا اختيار code');
  const mutateStatic = (kind, src, extra) => staticViolations(kind, `${src}\n${extra}\n`);
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').doc('x').update({status: 'expired'});").includes('STATIC:FIRESTORE_WRITE'), '[٧] طفرة: كتابة Firestore ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').doc('x').delete();").includes('STATIC:FIRESTORE_WRITE'), '[٧] طفرة: delete (القاعدة 42) ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').add({status: 'pending'});").includes('STATIC:FIRESTORE_WRITE'), '[٧] طفرة: collection().add ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('fs').writeFileSync('x', 'y');").includes('STATIC:DISK_WRITE'), '[٧] طفرة: كتابة ملفّ ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, 'out(`owner ${email}`);').includes('STATIC:EMAIL_OUTPUT'), '[٧] طفرة: طباعة البريد ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('https').request('x');").includes('STATIC:NETWORK'), '[٧] طفرة: شبكة ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, "const z = process.argv[2];").includes('STATIC:ARGV_READ_OUTSIDE_ENTRY'), '[٧] طفرة: قراءة process.argv ثانية ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "const hint = 'create the composite index at https://console.firebase.google.com';").includes('STATIC:INDEX_SUGGESTION'), '[٧] طفرة: نصّ يقترح إنشاء فهرس ⟵ يُكشَف (القاعدة 43)');
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').where('status', '==', 'scanning').where('expiresAt', '<', 1);").includes('STATIC:RANGE_FILTER_OR_ORDER'), '[٧] طفرة: مرشّح نطاق على expiresAt (يحتاج فهرس scanSessions(status, expiresAt) المحظور، القاعدة 43) ⟵ يُكشَف');
  ok(mutateStatic('lib', libSrc, "db.collection('scanSessions').orderBy('createdAt');").includes('STATIC:RANGE_FILTER_OR_ORDER'), '[٧] طفرة: orderBy ⟵ يُكشَف');
  ok(mutateStatic('lib', libSrc, "const f = ['status', 'code'];").includes('STATIC:RAW_SESSION_CODE_SELECTED'), '[٧] طفرة: اختيار حقل code (رمز الجلسة) ⟵ يُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.wrapReadOnly(', 'identity(')).includes('STATIC:NO_WRAP_READ_ONLY_DB'), '[٧] طفرة: إزالة wrapReadOnly ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.writeOutputExclusive(', 'identity(')).includes('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER'), '[٧] طفرة: إزالة كاتب المخرَج الحصري ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.assertOutWritable(', 'identity(')).includes('STATIC:NO_OUT_PRECHECK'), '[٧] طفرة: إزالة فحص ملفّ المخرَج المسبق ⟵ تُكشَف');

  // ═══ ٨ — الحارس الديناميكي: الملفّان الحقيقيان تحت مراقبة db وAuth وfs والشبكة والمطبوع، وطفرات تُحمَّل بدل الأصل ═══
  function compileMutated(file, mutate) {
    const original = readSource(file);
    const mutated = mutate(original);
    if (mutated === original) throw new Error(`mutation did not change ${path.basename(file)}`);
    const m = new Module(file, module);
    m.filename = file;
    m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(mutated.replace(/^#!.*\n/, '\n'), file);
    m.loaded = true;
    return m;
  }
  const replaceOnce = (anchor, replacement) => (src) => {
    const count = src.split(anchor).length - 1;
    if (count !== 1) throw new Error(`anchor must occur exactly once (found ${count}): ${anchor.slice(0, 60)}`);
    return src.replace(anchor, replacement);
  };
  const insertAfter = (anchor, text) => replaceOnce(anchor, `${anchor}${text}`);
  const LEAK = JSON.stringify(path.join(tmp, 'leaked-file.json'));

  async function runGuarded(mutations = []) {
    const touched = [SCRIPT_FILE, LIB_FILE];
    const saved = new Map(touched.map((f) => [f, require.cache[f]]));
    for (const f of touched) delete require.cache[f];
    try {
      for (const mut of mutations) require.cache[mut.file] = compileMutated(mut.file, mut.mutate);
      const scriptExports = require(SCRIPT_FILE);
      const db = makeMemDb(world());
      const {auth, violations: authViolations} = H.makeRecordingAuth(async (email) => {
        if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
        return {uid: OWNER};
      });
      const outPath = nextOut();
      const spy = H.spyFsWrites();
      const netGuard = H.blockNonLocalNetwork();
      const cap = H.captureConsole();
      const outs = [];
      let code = null;
      let thrown = null;
      try {
        code = await scriptExports.main(['--out', outPath], {env: ENV, now: () => NOW, db, auth, out: (s) => outs.push(String(s)), err: (s) => outs.push(String(s))});
      } catch (e) {
        thrown = e;
      } finally {
        cap.restore(); netGuard.restore(); spy.restore();
      }
      const fileText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
      const text = `${outs.join('\n')}\n${cap.chunks.join('\n')}\n${fileText}${thrown ? `\n${String(thrown && thrown.message)}` : ''}`;
      const v = new Set();
      if (thrown || code !== 0) v.add('EXIT_CODE');
      if (db.writeAttempts.length > 0) v.add('FIRESTORE_WRITE');
      if (spy.writes.some((w) => path.resolve(w.path) !== path.resolve(outPath))) v.add('DISK_WRITE');
      if (spy.writes.filter((w) => path.resolve(w.path) === path.resolve(outPath)).length !== 1) v.add('OUTPUT_NOT_WRITTEN_ONCE');
      if (authViolations.length > 0) v.add('AUTH_OPERATION');
      if (netGuard.blocked.length > 0) v.add('NETWORK');
      if (ALL_SECRETS.some((s) => text.includes(s))) v.add('SECRET_IN_OUTPUT');
      for (const [fk, fp] of [['script', SCRIPT_FILE], ['lib', LIB_FILE]]) {
        const mut = mutations.find((m) => m.file === fp);
        for (const sv of staticViolations(fk, mut ? mut.mutate(readSource(fp)) : readSource(fp))) v.add(sv);
      }
      return {violations: [...v].sort(), code, text};
    } finally {
      for (const f of touched) {
        delete require.cache[f];
        if (saved.get(f)) require.cache[f] = saved.get(f);
      }
    }
  }

  deq((await runGuarded()).violations, [], '[٨] الملفّان الحقيقيان: لا انتهاك (لا كتابة Firestore ولا قرص غير --out ولا Auth غير getUserByEmail ولا شبكة ولا سرّ في المطبوع)');
  const MUTANTS = [
    {id: 'M1 كتابة Firestore بتجاوز الغلاف', file: SCRIPT_FILE, mutate: insertAfter('    const nowMs = now();\n', "    await injected.db.collection('users').doc('mutant').set({hacked: true});\n"), expect: ['FIRESTORE_WRITE', 'EXIT_CODE', 'STATIC:FIRESTORE_WRITE']},
    {id: 'M2 طباعة البريد', file: SCRIPT_FILE, mutate: replaceOnce('err(`[owner-open-sessions] project=', 'err(`[${email}] [owner-open-sessions] project='), expect: ['SECRET_IN_OUTPUT', 'STATIC:EMAIL_OUTPUT']},
    {id: 'M3 كتابة ملفّ غير المخرَج', file: LIB_FILE, mutate: insertAfter("  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();\n", `  require('fs').writeFileSync(${LEAK}, 'x');\n`), expect: ['DISK_WRITE', 'STATIC:DISK_WRITE']},
    {id: 'M4 نداء شبكة', file: LIB_FILE, mutate: insertAfter("  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();\n", "  await fetch('https://example.invalid/x');\n"), expect: ['NETWORK', 'EXIT_CODE', 'STATIC:NETWORK']},
    {id: 'M5 معرّف جلسة خامّ في الصفّ', file: LIB_FILE, mutate: replaceOnce('      listedBecause: d.listedBecause,\n', '      listedBecause: d.listedBecause,\n      rawSessionId: d.id,\n'), expect: ['SECRET_IN_OUTPUT']},
    {id: 'M6 عملية Auth غير getUserByEmail', file: LIB_FILE, mutate: insertAfter("  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();\n", "  await auth.deleteUser(uid);\n"), expect: ['AUTH_OPERATION', 'EXIT_CODE', 'STATIC:AUTH_WRITE']},
    {id: 'M7 رمز الجلسة يُجلَب ويُطبَع', file: LIB_FILE, mutate: replaceOnce("const SESSION_SELECT = Object.freeze([...W.SESSION_SELECT, 'evaluationEnabled']);", "const SESSION_SELECT = Object.freeze([...W.SESSION_SELECT, 'evaluationEnabled', 'code']);"), expect: ['STATIC:RAW_SESSION_CODE_SELECTED']},
  ];
  for (const m of MUTANTS) {
    const res = await runGuarded([{file: m.file, mutate: m.mutate}]);
    for (const e of m.expect) ok(res.violations.includes(e), `[٨] ${m.id}: يُكشَف ${e} — الفعلي: ${res.violations.join(',') || '(لا شيء)'}`);
  }

  console.log(`ownerOpenSessions.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
