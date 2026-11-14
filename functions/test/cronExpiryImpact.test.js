'use strict';

// cronExpiryImpact.test.js — السكربت cron-expiry-impact-readonly.js ومكتبته scripts/lib/cronExpiryImpact.js (تشخيص ب٨، 2026-10-14 +03).
// وحدة بلا شبكة ولا محاكٍ. الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في هذا الاختبار وحده؛ شروط المهمّة المعروضة مرآة لـcheckExpiringSubscriptions.js،
// ويحرس اتّساقها معه اختبار المصادر في subscriptionState.test.js (٦).
//
// ١ التصنيف والتجميع بشروط المهمّة · ٢ المستخدمون: أعداد وتوزيع وإشعارات وصفوف المحلّات · ٣ الجلسات: القسم د والعالقة · ٤ حساب المالك · ٥ main: لا بريد ولا معرّف خامّ ولا حقل خارج القائمة ولا كتابة
// ٦ لا استعلام يحتاج فهرساً مركّباً (حارس مصدر) · ٧ الحارس الساكن للقراءة فقط وطفراته
//
// Run: node functions/test/cronExpiryImpact.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../scripts/lib/deviceCheck03Common');
const S = require('../scripts/lib/subscriptionState');
const I = require('../scripts/lib/cronExpiryImpact');
const {main} = require('../scripts/cron-expiry-impact-readonly');
const {makeMemDb} = require('./lib/memFirestore');

const FN = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(FN, rel), 'utf8').replace(/\r\n/g, '\n');

const SECRET_EMAIL = 'owner.s21.secret@example.test';
const OWNER_UID = 'uid-OWNER-SECRET-111';
const NOW = Date.UTC(2026, 9, 14, 7, 30, 0); // 2026-10-14T10:30:00+03:00
const MIN = 60 * 1000;
const H = 60 * MIN;
const D = 24 * H;
const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-impact-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `impact-${++counter}.json`);
const authFor = (uid = OWNER_UID) => ({getUserByEmail: async (email) => {
  if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  return {uid};
}});
const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};

const world = () => ({
  users: {
    [OWNER_UID]: {isActive: true, plan: 'shop_pro', scansRemaining: 136, expiresAt: ts(NOW - 90 * MIN), email: SECRET_EMAIL, fcmToken: 'SECRET-FCM-1', name: 'SECRET-NAME-1', phone: 'SECRET-PHONE-1'}, // u1
    'uid-u2-secret': {isActive: true, plan: 'free', scansRemaining: 3, expiresAt: ts(NOW - 40 * D), email: 'u2.secret@example.test', name: 'SECRET-NAME-2'},
    'uid-u3-secret': {isActive: true, plan: 'single', scansRemaining: 0, expiresAt: ts(NOW - 2 * D), subExpiredNotified: true, email: 'u3.secret@example.test', fcmToken: 'SECRET-FCM-3'},
    'uid-u4-secret': {isActive: true, plan: 'shop_basic', scansRemaining: 2, expiresAt: ts(NOW + 90 * MIN), email: 'u4.secret@example.test'},
    'uid-u5-secret': {isActive: true, plan: 'free', scansRemaining: 5, expiresAt: '2026-10-01T06:00:00.000Z', email: 'u5.secret@example.test'},
    'uid-u6-secret': {isActive: false, plan: 'free', scansRemaining: 9, expiresAt: ts(NOW - D)},
    'uid-u7-secret': {isActive: 'true', plan: 'free', scansRemaining: 9, expiresAt: ts(NOW - D)},
    'uid-u8-secret': {isActive: true, plan: 'free'},
    'uid-u9-secret': {isActive: true, plan: 'shop_pro', scansRemaining: 40, expiresAt: ts(NOW + 2 * D), email: 'u9.secret@example.test', fcmToken: 'SECRET-FCM-9'},
    'uid-u10-secret': {isActive: true, plan: 'free', scansRemaining: '7', expiresAt: ts(NOW - D), fcmToken: 'SECRET-FCM-10'},
  },
  scanSessions: {
    'sess-secret-s1': {status: 'pending', createdAt: ts(NOW - 3 * D), expiresAt: ts(NOW - 3 * D + 15 * MIN), ownerId: 'uid-OWNER-SECRET-111', code: 'NC-SECRET1'},
    'sess-secret-s2': {status: 'scanning', createdAt: ts(NOW - 2 * D), expiresAt: ts(NOW - 2 * D + 60 * MIN), ownerId: OWNER_UID},
    'sess-secret-s3': {status: 'scanning', createdAt: ts(NOW - 5 * D), expiresAt: ts(NOW - 5 * D + 60 * MIN)},
    'sess-secret-s4': {status: 'pending', createdAt: ts(NOW - 10 * MIN), expiresAt: ts(NOW + 50 * MIN)},
    'sess-secret-s5': {status: 'pending', createdAt: ts(NOW - 40 * D)},
    'sess-secret-s6': {status: 'completed', createdAt: ts(NOW - 6 * D), expiresAt: ts(NOW - 6 * D + 60 * MIN)},
  },
});
const SECRETS = ['SECRET', 'secret', 'owner.s21', 'uid-'];
const leaks = (text) => SECRETS.filter((s) => text.includes(s));

(async () => {
  // ═══ ١ — التصنيف والتجميع بشروط المهمّة ═══
  {
    const run = S.nextCronRun(NOW);
    const c = (data) => I.classifyUser(data, NOW, run.next.ms);
    const u = c({isActive: true, expiresAt: ts(NOW - 1), scansRemaining: 5, plan: 'shop_pro', email: 'x', fcmToken: 't'});
    ok(u.A_now && u.A_next && !u.B_now && !u.C, '[١] انقضى: القسم أ الآن وعند التالي، لا ب، لا ج (رصيد 5 > 3)');
    ok(u.hasEmail && u.hasPush && !u.alreadyNotified, '[١] وجود البريد والرمز منطقياً فقط');
    ok(!c({isActive: false, expiresAt: ts(NOW - 1)}).A_now, '[١] isActive=false: لا');
    ok(!c({isActive: 'true', expiresAt: ts(NOW - 1)}).A_now, '[١] isActive نصّاً: لا');
    ok(!c({isActive: true, expiresAt: NOW - 1}).A_now, '[١] expiresAt رقماً: لا (Timestamp وحده)');
    ok(!c({isActive: true, expiresAt: '2026-01-01T00:00:00Z'}).A_now, '[١] expiresAt نصّاً: لا');
    ok(!c({isActive: true}).A_now, '[١] expiresAt غائب: لا');
    ok(c({isActive: true, expiresAt: ts(NOW)}).A_now, '[١] expiresAt == الآن: نعم (<=)');
    ok(c({isActive: true, expiresAt: ts(NOW + 3 * D)}).B_now && !c({isActive: true, expiresAt: ts(NOW + 3 * D + 1)}).B_now, '[١] نافذة ب: حتى ثلاثة أيام تماماً (<=)');
    ok(!c({isActive: true, expiresAt: ts(NOW)}).B_now, '[١] ب: expiresAt == الآن خارج (> صارمة)');
    ok(c({isActive: true, scansRemaining: 3}).C && !c({isActive: true, scansRemaining: 0}).C && !c({isActive: true, scansRemaining: 4}).C && !c({isActive: true, scansRemaining: '2'}).C, '[١] ج: 0 < الرصيد <= 3 رقماً');
    eq(I.planKey(undefined), '(absent)', '[١] planKey: غائب');
    eq(I.planKey(5), '(number)', '[١] planKey: غير نصّ');
    eq(I.planKey('shop_pro'), 'shop_pro', '[١] planKey: اسم');
    eq(I.planKey('a b'), '(unprintable)', '[١] planKey: غير قابل للطباعة');
    eq(I.todayStrOf(Date.UTC(2026, 9, 14, 6, 0, 0)), '2026-10-14', '[١] todayStr بتاريخ UTC كما :35');
    eq(I.ageBucket(null), 'createdAt_unusable', '[١] شريحة العمر: createdAt غير صالح');
    eq(I.ageBucket(59), 'lt_1h', '[١] 59 دقيقة');
    eq(I.ageBucket(60), 'h1_to_d1', '[١] 60 دقيقة');
    eq(I.ageBucket(24 * 60), 'd1_to_d7', '[١] يوم');
    eq(I.ageBucket(7 * 24 * 60), 'd7_to_d30', '[١] سبعة أيام');
    eq(I.ageBucket(30 * 24 * 60), 'gte_d30', '[١] ثلاثون يوماً');
  }

  // ═══ ٢ — المستخدمون ═══
  const w = world();
  const toDocs = (col) => Object.entries(w[col]).map(([id, data]) => ({id, data}));
  const usersLoaded = toDocs('users').filter((d) => d.data.isActive === true); // ما يعيده where isActive == true
  const U = I.summarizeUsers(usersLoaded, NOW, {ownerUid: OWNER_UID});
  {
    const u = U.users;
    eq(u.isActiveTrueLoaded, 8, '[٢] المحمَّلون 8 (isActive=false ونصّ "true" لا يُجلَبان)');
    deq(u.expiresAtTypeAmongLoaded, {timestamp: 6, string: 1, absent: 1}, '[٢] أنواع expiresAt بين المحمَّلين');
    eq(u.expiresAtNotATimestamp, 1, '[٢] غير Timestamp (نصّ) = 1');
    const a = u.sectionA.atThisRunNow;
    eq(a.matched, 4, '[٢] القسم أ الآن: u1 u2 u3 u10');
    eq(a.withBalanceGt0, 2, '[٢] منهم برصيد > 0: u1 (136) وu2 (3)');
    eq(a.balanceSumGt0, 139, '[٢] ومجموع الأرصدة الموجبة 139');
    eq(a.balanceNotANumber, 1, '[٢] رصيد غير رقم (u10 نصّ "7") يُعدّ بنوعه');
    eq(a.balanceAbsent, 0, '[٢] لا رصيد غائب بين المطابقين');
    deq(a.byPlan, {shop_pro: {matched: 1, withBalanceGt0: 1, balanceSumGt0: 136}, free: {matched: 2, withBalanceGt0: 1, balanceSumGt0: 3}, single: {matched: 1, withBalanceGt0: 0, balanceSumGt0: 0}}, '[٢] التوزيع بحسب الباقة');
    deq(a.notification, {skippedBecauseAlreadyNotified: 1, wouldBeNotified: 3, wouldEmail: 2, wouldPush: 2}, '[٢] الإشعار: u3 مُتخطّى (subExpiredNotified)؛ بريد u1 وu2؛ إشعار u1 وu10');
    // A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال): كان {scansRemaining: 0, …}؛ المهمّة تطفئ ولا تصفّر (قرار المستخدم 2026-10-14)
    deq(u.sectionA.writesIfMatched, {isActive: false, subExpiredNotified: true, subExpiredAt: 'serverTimestamp'}, '[٢] ما يُكتب: تعطيل وعلم إشعار بلا تصفير');
    const next = u.sectionA.atNextScheduledRun;
    eq(next.runPlus03, '2026-10-15T09:00:00.000+03:00', '[٢] المشغَّل التالي');
    eq(next.matched, 5, '[٢] القسم أ عند التالي: يضاف u4 (ينقضي 12:00)');
    const b = u.sectionB;
    deq(b.atThisRunNow, {matched: 2, wouldEmail: 2, wouldPush: 1}, '[٢] القسم ب الآن: u4 وu9؛ إشعار u9 وحده (لا رمز عند u4)');
    eq(b.atNextScheduledRun.matched, 1, '[٢] القسم ب عند التالي: u9 وحده (u4 ينتقل إلى أ)');
    eq(u.sectionC.matchedQuery, 2, '[٢] القسم ج: u2 (3) وu4 (2)');
    eq(u.sectionC.wouldEmail, 1, '[٢] وبريد ج لباقة محلّ وببريد: u4 وحده (u2 باقة free)');
    const shop = u.shopAccountsInSectionAAtNextRun;
    eq(shop.total, 2, '[٢] حسابات المحلّ في القسم أ عند التالي: u1 وu4');
    deq(shop.rows.map((r) => r.plan), ['shop_pro', 'shop_basic'], '[٢] مرتّبة بتاريخ الانتهاء');
    deq(shop.rows.map((r) => r.matchesNow), [true, false], '[٢] u1 يطابق الآن؛ u4 عند التالي فقط');
    eq(shop.rows[0].scansRemaining, 136, '[٢] رصيد u1');
    ok(shop.rows.every((r) => /^#[0-9a-f]{12}$/.test(r.accountHash)), '[٢] المعرّفات مُهشَّرة');
    eq(shop.rowsTruncated, false, '[٢] لا اقتطاع');
  }
  {
    const o = U.ownerRow;
    eq(o.accountHash, C.hashIdForLog(OWNER_UID), '[٢] صفّ المالك مُهشَّر');
    eq(o.matchesSectionANow, true, '[٢] المالك يطابق أ الآن');
    eq(o.scansRemaining, 136, '[٢] رصيده');
    eq(o.plan, 'shop_pro', '[٢] باقته');
  }
  eq(I.summarizeUsers(usersLoaded, NOW, {ownerUid: 'nobody'}).ownerRow, null, '[٢] المالك خارج المجموعة: null (يُعلَن في collectImpact)');
  {
    // اقتطاع الصفوف: 60 حساب محلّ منتهٍ ⟵ 50 صفّاً والعدد كاملاً
    const many = [];
    for (let i = 0; i < 60; i++) many.push({id: `shop-${i}`, data: {isActive: true, plan: 'shop_basic', scansRemaining: i, expiresAt: ts(NOW - (i + 1) * MIN)}});
    const m = I.summarizeUsers(many, NOW, {}).users.shopAccountsInSectionAAtNextRun;
    eq(m.total, 60, '[٢] العدد كاملاً 60');
    eq(m.rows.length, I.MAX_ROWS, '[٢] الصفوف مقتطعة بـMAX_ROWS');
    eq(m.rowsTruncated, true, '[٢] والاقتطاع مُعلَن');
  }

  // ═══ ٣ — الجلسات ═══
  {
    const sessionDocs = toDocs('scanSessions').filter((d) => d.data.status === 'pending' || d.data.status === 'scanning');
    const s = I.summarizeSessions(sessionDocs, NOW);
    eq(s.sectionD.pendingLoaded, 3, '[٣] pending المحمَّلة: s1 s4 s5');
    eq(s.sectionD.wouldBeChanged, 1, '[٣] القسم د يغيّر واحدة: s1 (pending ومنقضية)');
    eq(s.sectionD.wouldBeChangedThisRun, 1, '[٣] ضمن حدّ 500');
    eq(s.sectionD.exceedsCronLimit, false, '[٣] لا يتجاوز الحدّ');
    eq(s.sectionD.cronLimit, 500, '[٣] الحدّ 500 (:196)');
    eq(s.sectionD.pendingWithoutTimestampExpiresAt, 1, '[٣] pending بلا expiresAt (s5): لا يطابقها القسم د');
    deq(s.sectionD.byAgeOfCreatedAt, {d1_to_d7: 1}, '[٣] عمر ما سيُغيَّر: 3 أيام');
    deq(s.sectionD.writesIfMatched, {status: 'expired'}, '[٣] ما يُكتب: status فقط');
    eq(s.scanningLoaded, 2, '[٣] scanning: s2 وs3');
    eq(s.scanningNotTouchedBySectionD, 2, '[٣] القسم د لا يمسّ scanning');
    eq(s.stuckActive.total, 4, '[٣] العالقة: s1 (pending منقضية) s2 s3 (scanning منقضيتان) s5 (بلا expiresAt)');
    eq(s.stuckActive.pending, 2, '[٣] منها pending: s1 وs5');
    eq(s.stuckActive.scanning, 2, '[٣] ومنها scanning: s2 وs3');
    eq(s.stuckActive.rows.length, 4, '[٣] أربعة صفوف');
    ok(s.stuckActive.rows.every((r) => /^#[0-9a-f]{12}$/.test(r.sessionHash)), '[٣] معرّفات مُهشَّرة');
    const r5 = s.stuckActive.rows.find((r) => r.createdAtPlus03 === S.toPlus03(NOW - 40 * D));
    eq(r5.expiresAtType, 'absent', '[٣] s5: expiresAt غائب مُعلَن');
    eq(r5.wouldBeChangedBySectionD, false, '[٣] وs5 لا يمسّها د');
    eq(s.stuckActive.rows[0].createdAtPlus03, S.toPlus03(NOW - 40 * D), '[٣] مرتّبة بالأقدم أوّلاً');
    ok(s.stuckActive.rows.some((r) => r.status === 'pending' && r.wouldBeChangedBySectionD === true && r.ageMinutesFromCreatedAt === 3 * 24 * 60), '[٣] s1: pending يمسّها د، عمرها 4320 دقيقة');
    ok(!s.stuckActive.rows.some((r) => r.ageMinutesFromCreatedAt === 10), '[٣] جلسة داخل النافذة (s4) ليست عالقة');
    // تجاوز الحدّ
    const big = [];
    for (let i = 0; i < 501; i++) big.push({id: `p-${i}`, data: {status: 'pending', createdAt: ts(NOW - D), expiresAt: ts(NOW - D + 15 * MIN)}});
    const sb = I.summarizeSessions(big, NOW);
    eq(sb.sectionD.wouldBeChanged, 501, '[٣] 501 منقضية');
    eq(sb.sectionD.exceedsCronLimit, true, '[٣] تتجاوز حدّ المهمّة');
    eq(sb.sectionD.wouldBeChangedThisRun, 500, '[٣] والمهمّة تغيّر 500 في التشغيل الواحد');
    eq(sb.stuckActive.rows.length, I.MAX_ROWS, '[٣] الصفوف مقتطعة');
  }

  // ═══ ٤ — collectImpact: حساب المالك والاستعلامات ═══
  {
    const db = makeMemDb(world());
    const r = await I.collectImpact({db, auth: authFor(), email: SECRET_EMAIL, nowMs: NOW});
    eq(r.ownerAccount.checked, true, '[٤] المالك فُحص');
    eq(r.ownerAccount.inIsActiveTrueSet, true, '[٤] وهو في المجموعة');
    eq(r.ownerAccount.details.matchesSectionANow, true, '[٤] ويطابق أ');
    eq(r.users.isActiveTrueLoaded, 8, '[٤] المحمَّلون 8 (القراءة من db المزيَّف بـwhere + select)');
    eq(r.sessions.sectionD.wouldBeChanged, 1, '[٤] جلسة واحدة يغيّرها د');
    eq(r.sessions.stuckActive.total, 4, '[٤] أربع عالقة');
    deq(db.reads, ['query:users', 'query:scanSessions', 'query:scanSessions'], '[٤][الأهمّ] ثلاث قراءات فقط: users وscanSessions pending وscanning (لا مجموعة أخرى)');
    deq(db.writeAttempts, [], '[٤] لا كتابة');
    ok(r.indexesRequiredByTheCronQueries.length === 3, '[٤] الفهارس الثلاثة التي تحتاجها المهمّة مُعلَنة');
    const other = await I.collectImpact({db: makeMemDb(world()), auth: authFor('uid-not-in-set'), email: SECRET_EMAIL, nowMs: NOW});
    eq(other.ownerAccount.inIsActiveTrueSet, false, '[٤] مالك خارج المجموعة: inIsActiveTrueSet=false');
    ok(/isActive is false, absent, or the user document does not exist/.test(other.ownerAccount.note), '[٤] والسبب المحتمل مُعلَن لا مُخمَّن');
    const noOwner = await I.collectImpact({db: makeMemDb(world()), auth: authFor(), email: null, nowMs: NOW});
    deq(noOwner.ownerAccount, {checked: false, reason: 'OWNER_EMAIL_ENV_MISSING'}, '[٤] بلا بريد: checked=false وسببه (لا صمت)');
  }

  // ═══ ٥ — main ═══
  const run = async (argv, {env = ENV, db, auth = authFor()} = {}) => {
    const outs = [];
    const errs = [];
    const code = await main(argv, {env, now: () => NOW, db, auth, out: (s) => outs.push(s), err: (s) => errs.push(s)});
    return {code, outs, errs};
  };
  {
    const outPath = nextOut();
    const db = makeMemDb(world());
    const r = await run(['--out', outPath], {db});
    eq(r.code, 0, '[٥] النجاح: 0');
    const text = r.outs.join('\n');
    const j = JSON.parse(text);
    eq(Object.keys(j)[0], 'projectId', '[٥] projectId أوّل حقل');
    eq(j.projectId, 'neuralchek-9b6d7', '[٥] projectId المثبَّت');
    eq(j.mode, 'cron-expiry-impact', '[٥] mode');
    deq(leaks(text), [], '[٥][الأهمّ] لا بريد ولا uid ولا معرّف جلسة ولا رمز FCM ولا اسم ولا هاتف ولا رمز جلسة في المخرَج');
    deq(leaks(r.errs.join('\n')), [], '[٥] ولا في stderr');
    for (const k of ['email', 'fcmToken', 'phone', 'name', 'ownerId', 'code']) ok(!text.includes(`"${k}":`), `[٥] لا مفتاح خارج المطلوب: ${k}`);
    eq(j.countingMethod.includes('none of the queries in this script needs a composite index'), true, '[٥] طريقة العدّ مُعلَنة');
    eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٥] الملفّ = المطبوع');
    deq(db.writeAttempts, [], '[٥] لا كتابة Firestore');
    const again = await run(['--out', outPath], {db});
    eq(again.code, 2, '[٥] ملفّ موجود: 2');
    ok(again.errs.some((e) => /OUT_EXISTS/.test(e)), '[٥] OUT_EXISTS');
  }
  {
    // بلا متغيّر البيئة: يعمل ويُعلن عدم فحص المالك (على stderr وفي المخرَج)
    const r = await run([], {env: {}, db: makeMemDb(world())});
    eq(r.code, 0, '[٥] بلا بريد: 0');
    ok(/ownerAccountChecked=false/.test(r.errs.join('\n')), '[٥] وstderr يقول ownerAccountChecked=false');
    eq(JSON.parse(r.outs.join('\n')).ownerAccount.checked, false, '[٥] والمخرَج checked=false');
    const invalid = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'not-an-email'}, db: makeMemDb(world())});
    eq(invalid.code, 2, '[٥] بريد تالف: خطأ لا تجاهل');
    ok(/OWNER_EMAIL_INVALID/.test(invalid.errs.join('\n')) && !invalid.errs.join('\n').includes('not-an-email'), '[٥] OWNER_EMAIL_INVALID ولا يُطبَع ما كُتب');
    const notFound = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: makeMemDb(world())});
    eq(notFound.code, 2, '[٥] حساب غير موجود: 2');
    ok(!notFound.errs.join('\n').includes('other@example.test'), '[٥] نصّ خطأ المزوّد لا يُطبَع (القاعدة 36)');
    const bad = await run(['--email', 'x@y.z']);
    eq(bad.code, 2, '[٥] البريد من سطر الأمر: مرفوض');
    const pf = await run(['--preflight'], {env: {}});
    eq(pf.code, 0, '[٥] --preflight: 0');
    const emptyDb = await run([], {env: {}, db: makeMemDb({users: {}, scanSessions: {}})});
    eq(emptyDb.code, 0, '[٥] مجموعات فارغة: 0 (أعداد صفر مقيسة لا غياب)');
    eq(JSON.parse(emptyDb.outs.join('\n')).users.sectionA.atThisRunNow.matched, 0, '[٥] وصفر مطابَق');
  }

  // ═══ ٦ — لا استعلام يحتاج فهرساً مركّباً ═══
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const libSrc = read('scripts/lib/cronExpiryImpact.js');
  const scriptSrc = read('scripts/cron-expiry-impact-readonly.js');
  /** انتهاكات «فهرس مركّب»: أكثر من where في الملفّ، أو where بغير مساواة، أو سلسلة where.where. */
  const indexViolations = (raw) => {
    const src = stripComments(raw).replace(/\s+/g, ' ');
    const v = new Set();
    const wheres = [...src.matchAll(/\.where\(([^)]*)\)/g)];
    if (wheres.length !== 1) v.add(`WHERE_COUNT_${wheres.length}`);
    for (const m of wheres) if (!/^[^,]+,\s*'=='\s*,/.test(m[1])) v.add('WHERE_NOT_EQUALITY');
    if (/\.where\([^)]*\)\s*\.where\(/.test(src)) v.add('CHAINED_WHERE');
    if (/\.orderBy\(/.test(src)) v.add('ORDER_BY');
    if (!/\.select\(\.\.\.fields\)/.test(src)) v.add('NO_SELECT_PROJECTION');
    return [...v].sort();
  };
  deq(indexViolations(libSrc), [], '[٦] المكتبة: where واحدة بمساواة وselect، بلا orderBy ولا سلسلة');
  eq(/\.where\(/.test(stripComments(scriptSrc)), false, '[٦] السكربت: لا استعلام');
  ok(indexViolations(libSrc.replace("where(field, '==', value)", "where(field, '==', value).where('expiresAt', '<=', new Date())")).length > 0, '[٦] طفرة: where ثانية بمدى ⟵ تُكشَف');
  ok(indexViolations(libSrc.replace("where(field, '==', value)", "where(field, '>=', value)")).includes('WHERE_NOT_EQUALITY'), '[٦] طفرة: مدى بدل المساواة ⟵ يُكشَف');
  ok(indexViolations(libSrc.replace('.select(...fields)', '.orderBy(\'x\')')).includes('NO_SELECT_PROJECTION'), '[٦] طفرة: إزالة select ⟵ يُكشَف');
  deq([...I.USER_FIELDS], ['isActive', 'expiresAt', 'scansRemaining', 'plan', 'subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate', 'email', 'fcmToken'], '[٦] الحقول المجلوبة من users تسعة بالترتيب المعلَن');
  deq([...I.SESSION_FIELDS], ['status', 'createdAt', 'expiresAt'], '[٦] والمجلوبة من scanSessions ثلاثة');
  eq(I.SESSION_CRON_LIMIT, 500, '[٦] حدّ القسم د');
  // A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال): كان «وهو الحدّ في المصدر (:196)»؛ القسم د حُذف من المهمّة (قرار 2026-10-10) فلا حدّ في المصدر. ثابت المكتبة يصف القسم المحذوف (عدّ تاريخي)، وغيابه من المصدر يحرسه subscriptionState.test.js (CRON_SECTION_D_PRESENT).
  ok(!/\.limit\(500\)/.test(read('src/notifications/checkExpiringSubscriptions.js')), '[٦] ولا حدّ 500 في مصدر المهمّة: القسم د محذوف');
  ok(/REMOVED from checkExpiringSubscriptions\.js/.test(I.summarizeSessions([], NOW).sectionD.mirrorOf), '[٦] والمكتبة تعلن أن القسم د محذوف من المهمّة (أعداده تاريخية لا كتابات قادمة)');

  // ═══ ٧ — الحارس الساكن للقراءة فقط وطفراته ═══
  const FORBIDDEN = Object.freeze({
    FIRESTORE_WRITE: /\.(?:set|update|create|delete)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(/,
    DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
    NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
    EMAIL_OUTPUT: /\$\{\s*email\s*\}|\b(?:out|err|console\.\w+)\(\s*email\b|JSON\.stringify\(\s*email\b|\bemail\s*:\s*email\b|\bowner_email\b/,
  });
  const staticViolations = (kind, raw) => {
    const src = stripComments(raw.replace(/\r\n/g, '\n'));
    const v = new Set();
    for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
    if (kind === 'script') {
      if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
      if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
      if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
      if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
    }
    return [...v].sort();
  };
  deq(staticViolations('script', scriptSrc), [], '[٧] السكربت: بلا كتابة ولا شبكة ولا بريد ولا معرّف خامّ');
  deq(staticViolations('lib', libSrc), [], '[٧] المكتبة: بلا كتابة ولا شبكة ولا بريد ولا معرّف خامّ');
  const mutateStatic = (kind, src, extra) => staticViolations(kind, `${src}\n${extra}\n`);
  ok(mutateStatic('lib', libSrc, "db.collection('users').doc('x').update({scansRemaining: 0});").includes('STATIC:FIRESTORE_WRITE'), '[٧] طفرة: كتابة Firestore ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('fs').writeFileSync('x', 'y');").includes('STATIC:DISK_WRITE'), '[٧] طفرة: كتابة ملفّ ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, 'out(`owner ${email}`);').includes('STATIC:EMAIL_OUTPUT'), '[٧] طفرة: طباعة البريد ⟵ تُكشَف');
  {
    // طفرة ديناميكية: تُحمَّل المكتبة المطفَّرة بدل الأصلية ويُشغَّل التلخيص نفسه على مستندات بمعرّفات سرّية؛ يجب أن يكشف فحص التسرّب المعرّف الخامّ.
    const Module = require('module');
    const libPath = path.join(FN, 'scripts', 'lib', 'cronExpiryImpact.js');
    const loadMutated = (transform) => {
      const m = new Module(libPath, module);
      m.filename = libPath;
      m.paths = Module._nodeModulePaths(path.dirname(libPath));
      m._compile(transform(fs.readFileSync(libPath, 'utf8')), libPath);
      return m.exports;
    };
    const docs = Object.entries(world().users).map(([id, data]) => ({id, data})).filter((d) => d.data.isActive === true);
    deq(leaks(JSON.stringify(I.summarizeUsers(docs, NOW, {ownerUid: OWNER_UID}))), [], '[٧] الأصل: لا تسرّب (خطّ أساس الطفرة)');
    const M1 = loadMutated((t) => {
      ok(t.includes('accountHash: C.hashIdForLog(u.id)'), '[٧] طفرة المستخدم: النصّ المستهدَف موجود في المصدر الحقيقي');
      return t.replace('accountHash: C.hashIdForLog(u.id)', 'accountHash: u.id');
    });
    ok(leaks(JSON.stringify(M1.summarizeUsers(docs, NOW, {}))).length > 0, '[٧] طفرة: معرّف مستخدم خامّ في صفوف المحلّات ⟵ يُكشَف بفحص التسرّب');
    const sess = Object.entries(world().scanSessions).filter(([, d]) => d.status === 'pending' || d.status === 'scanning').map(([id, data]) => ({id, data}));
    const M2 = loadMutated((t) => {
      ok(t.includes('sessionHash: C.hashIdForLog(r.id)'), '[٧] طفرة الجلسة: النصّ المستهدَف موجود في المصدر الحقيقي');
      return t.replace('sessionHash: C.hashIdForLog(r.id)', 'sessionHash: r.id');
    });
    ok(leaks(JSON.stringify(M2.summarizeSessions(sess, NOW))).length > 0, '[٧] طفرة: معرّف جلسة خامّ ⟵ يُكشَف');
    deq(leaks(JSON.stringify(I.summarizeSessions(sess, NOW))), [], '[٧] والأصل لا يسرّب معرّف جلسة');
  }
  ok(staticViolations('script', scriptSrc.replace('C.wrapReadOnly(', 'identity(')).includes('STATIC:NO_WRAP_READ_ONLY_DB'), '[٧] طفرة: إزالة wrapReadOnly ⟵ تُكشَف');

  console.log(`cronExpiryImpact.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
