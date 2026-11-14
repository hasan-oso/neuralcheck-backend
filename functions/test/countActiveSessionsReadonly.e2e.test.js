// E2E test: count-active-sessions-readonly على محاكي Firestore (قبل نشر الأمان، 2026-10-09 +03). السكربت الحقيقي في عملية فرعية (فيُجرَّب فتح Admin SDK
// بـprojectId المثبَّت على المحاكي)، **لا يُستبدَل منه شيء** (القاعدة 37). الحارس المشترك في أوّل الملفّ: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار.
//
// قرار المستخدم (القاعدة 1 الجديدة في CLAUDE.md، بنصّها): «"جلسة جارية" تُثبَت بالأداة لا بالذاكرة: كتلة قراءة قبل كل نشر تعدّ جلسات pending/scanning
// المنشأة في آخر ساعتين، وأقفال scanClaims الحديثة، والنشر يتوقّف إن لم يكن الناتج صفراً.» «والجلستان العالقتان القديمتان خارج الحدّ.»
// المطلوب: كل حالة منع، وما خارج النافذة، والمخرَج أعداد وحدها، وجلسة بلا createdAt أو بقيمة غير مقروءة تُعدّ مستقلّة وتمنع، ورمز الخروج 0/3/2.
// الدفعة ٩ (2026-10-10 +03)، أمر المنسّق بنصّه: «`cancelled` و`expired` لا يُعدّان جاريين. وكل حالة لا تعرفها الأداة تُعلن صراحةً (القاعدة 22)، ولا تُعدّ «لا تمنع» بصمت.» — فالحالات النهائية الثلاث
// (حتى الحديثة) لا تمنع، وكل حالة غائبة أو غير نصّية أو لا تعرفها الأداة تُعلَن في الأعداد المانعة وتمنع (ولو كانت قديمة).
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/countActiveSessionsReadonly.e2e.test.js"

require('./lib/emulatorOnlyGuard'); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require('assert');
const path = require('path');
const {spawnSync} = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // مضمون محلّي بالحارس أعلاه
const admin = require('firebase-admin');
const {Timestamp} = require('firebase-admin/firestore');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {main} = require('../scripts/count-active-sessions-readonly');

const app = admin.initializeApp({projectId: PROJECT_ID}, 'e2e-count-active-sessions');
const db = app.firestore();

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const SCRIPT = path.join(__dirname, '..', 'scripts', 'count-active-sessions-readonly.js');
const MIN = 60_000;
const SECRET_CODE = 'NC-E2ESECRET';
const SECRET_OWNER = 'e2e-owner-uid-SECRET';

async function reset() {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}
async function dump() {
  const out = {};
  for (const col of ['scanSessions', 'scanClaims', 'reports', 'users']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) out[`${col}/${d.id}`] = JSON.stringify([d.data(), d.updateTime.toMillis()]);
  }
  return out;
}
const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);
const session = (id, status, createdAt, extra = {}) => db.collection('scanSessions').doc(id).set({status, code: SECRET_CODE, ownerId: SECRET_OWNER, ...(createdAt === undefined ? {} : {createdAt}), ...extra});
const claim = (id, data) => db.collection('scanClaims').doc(id).set(data);
const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {env: {...process.env, ...env}, encoding: 'utf8', cwd: path.join(__dirname, '..')});
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (e) { json = null; }
  return {code: r.status, stdout: r.stdout, stderr: r.stderr, json};
};

(async () => {
  // ═══ ١ — لا شيء جارٍ: صفر ═══
  await reset();
  let r = cli([]);
  eq(r.code, 0, '[١] قاعدة فارغة: رمز 0');
  eq(r.json.projectId, PROJECT_ID, '[١] projectId أوّل حقل ومثبَّت');
  eq(Object.keys(r.json)[0], 'projectId', '[١] وهو أوّل مفتاح');
  ok(/^EMULATOR /.test(r.json.target), '[١] والهدف مطبوع (المحاكي)');
  eq(r.json.verdict.blocksDeploy, false, '[١] لا يمنع');
  eq(r.json.sessions.byStatus.pending.total + r.json.sessions.byStatus.scanning.total + r.json.claims.total, 0, '[١] صفر');
  ok(/read-only/.test(r.stderr) && /project=neuralchek-9b6d7/.test(r.stderr), '[١] stderr يقول: قراءة فقط ومشروع مثبَّت');

  // ═══ ٢ — ما خارج الحدّ وما ليس جارياً لا يمنع (الجلستان العالقتان القديمتان) ═══
  await reset();
  await session('old-pending', 'pending', ago(3 * 3600_000));
  await session('old-scanning', 'scanning', ago(121 * MIN));
  await session('done-recent', 'completed', ago(MIN));
  await session('expired-recent', 'expired', ago(MIN));
  await session('cancelled-recent', 'cancelled', ago(MIN), {cancelReason: 'left_by_customer'});
  await claim('old-claim-res', {claimedAtMs: Date.now() - 5 * 3600_000, reservation: {userId: SECRET_OWNER, reservedAtMs: Date.now() - 5 * 3600_000}});
  await claim('old-claim-nores', {claimedAtMs: Date.now() - 3 * 3600_000, reservation: null});
  let before = await dump();
  r = cli([]);
  eq(r.code, 0, '[٢] الأقدم من النافذة وما ليس pending/scanning: رمز 0');
  eq(r.json.sessions.byStatus.pending.OLDER_THAN_WINDOW, 1, '[٢] جلسة pending عالقة قديمة تُعدّ خارج الحدّ');
  eq(r.json.sessions.byStatus.scanning.OLDER_THAN_WINDOW, 1, '[٢] وscanning قديمة كذلك');
  eq(r.json.sessions.byStatus.pending.total + r.json.sessions.byStatus.scanning.total, 2, '[٢] completed وexpired وcancelled لا تدخل الجرد الجاري');
  deq(r.json.sessions.terminal, {completed: 1, expired: 1, cancelled: 1}, '[٢] وتُعدّ في terminal: واحدة لكلّ حالة نهائية (cancelled وexpired الحديثتان لا تمنعان)');
  deq(r.json.sessions.unclassified, {statusAbsent: 0, statusUnreadable: 0, statusUnknown: 0, unknownNames: {}}, '[٢] ولا حالة غير مصنَّفة');
  eq(r.json.claims.OLDER_THAN_WINDOW, 2, '[٢] والأقفال القديمة خارج الحدّ');
  eq(r.json.claims.inWindow, 0, '[٢] ولا قفل داخل');
  const sameAfter = JSON.stringify(await dump()) === JSON.stringify(before);
  ok(sameAfter, '[٢] المحاكي لم يتغيّر (قراءة فقط: محتوى وupdateTime لكل مستند)');

  // ═══ ٣ — كل حالة منع على حدة ═══
  const BLOCK_CASES = [
    ['جلسة pending في النافذة', async () => session('b1', 'pending', ago(5 * MIN)), (j) => j.verdict.blockingCounts.sessionsInWindow === 1 && j.sessions.byStatus.pending.IN_WINDOW === 1],
    ['جلسة scanning في النافذة', async () => session('b2', 'scanning', ago(100 * MIN)), (j) => j.verdict.blockingCounts.sessionsInWindow === 1 && j.sessions.byStatus.scanning.IN_WINDOW === 1],
    ['جلسة بلا createdAt (تُعدّ مستقلّة وتمنع)', async () => session('b3', 'pending', undefined), (j) => j.verdict.blockingCounts.sessionsCreatedAtAbsent === 1 && j.sessions.byStatus.pending.CREATED_AT_ABSENT === 1 && j.verdict.blockingCounts.sessionsInWindow === 0],
    ['جلسة بـcreatedAt = null', async () => session('b4', 'scanning', null), (j) => j.verdict.blockingCounts.sessionsCreatedAtAbsent === 1],
    ['جلسة بـcreatedAt نصّي (غير مقروء)', async () => session('b5', 'pending', '2026-10-09T10:00:00Z'), (j) => j.verdict.blockingCounts.sessionsCreatedAtUnreadable === 1 && j.sessions.byStatus.pending.CREATED_AT_UNREADABLE === 1],
    ['جلسة بـcreatedAt رقمي (غير مقروء، لا تخمين وحدته)', async () => session('b6', 'scanning', Date.now()), (j) => j.verdict.blockingCounts.sessionsCreatedAtUnreadable === 1],
    ['جلسة بلا status (حالة غير مصنَّفة تمنع)', async () => db.collection('scanSessions').doc('s1').set({code: SECRET_CODE, ownerId: SECRET_OWNER, createdAt: ago(MIN)}), (j) => j.verdict.blockingCounts.sessionsStatusAbsent === 1 && j.sessions.unclassified.statusAbsent === 1 && j.verdict.blockingCounts.sessionsInWindow === 0],
    ['جلسة بـstatus null', async () => session('s2', null, ago(MIN)), (j) => j.verdict.blockingCounts.sessionsStatusAbsent === 1],
    ['جلسة بـstatus رقمي (غير مقروء)', async () => session('s3', 7, ago(MIN)), (j) => j.verdict.blockingCounts.sessionsStatusUnreadable === 1 && j.sessions.unclassified.statusUnreadable === 1],
    ['جلسة بحالة لا تعرفها الأداة (done) — باسمها', async () => session('s4', 'done', ago(MIN)), (j) => j.verdict.blockingCounts.sessionsStatusUnknown === 1 && j.sessions.unclassified.unknownNames.done === 1],
    ['حالة Cancelled بأحرف كبيرة: لا تطبيع صامت، وغير مطبوعة الاسم', async () => session('s5', 'Cancelled', ago(MIN)), (j) => j.verdict.blockingCounts.sessionsStatusUnknown === 1 && j.sessions.unclassified.unknownNames['(unprintable)'] === 1],
    ['حالة غير معروفة وقديمة (5 ساعات): تمنع أيضاً (لا يُعرَف أنها ليست جارية)', async () => session('s6', 'archived', ago(5 * 3600_000)), (j) => j.verdict.blockingCounts.sessionsStatusUnknown === 1 && j.sessions.byStatus.pending.OLDER_THAN_WINDOW === 0],
    ['قفل حديث بلا حجز', async () => claim('c1', {claimedAtMs: Date.now() - 10 * MIN, reservation: null}), (j) => j.verdict.blockingCounts.claimsInWindow === 1 && j.claims.inWindowWithReservation === 0],
    ['قفل حديث بحجز', async () => claim('c2', {claimedAtMs: Date.now() - 2 * MIN, reservation: {userId: SECRET_OWNER, reservedAtMs: Date.now() - 2 * MIN}}), (j) => j.verdict.blockingCounts.claimsInWindow === 1 && j.claims.inWindowWithReservation === 1],
    ['قفل بلا claimedAtMs', async () => claim('c3', {reservation: null}), (j) => j.verdict.blockingCounts.claimsClaimedAtAbsent === 1 && j.claims.inWindow === 0],
    ['قفل بـclaimedAtMs نصّي', async () => claim('c4', {claimedAtMs: 'now', reservation: null}), (j) => j.verdict.blockingCounts.claimsClaimedAtUnreadable === 1],
  ];
  for (const [label, seed, check] of BLOCK_CASES) {
    await reset();
    await seed();
    before = await dump();
    r = cli([]);
    eq(r.code, 3, `[٣] ${label}: رمز 3 (يمنع النشر)`);
    ok(check(r.json), `[٣] ${label}: العدّ المنتظر (${JSON.stringify(r.json && r.json.verdict.blockingCounts)})`);
    eq(r.json.verdict.blocksDeploy, true, `[٣] ${label}: blocksDeploy`);
    ok(r.json.verdict.reasons.length >= 1, `[٣] ${label}: السبب مسمّى`);
    ok(JSON.stringify(await dump()) === JSON.stringify(before), `[٣] ${label}: لا كتابة`);
  }

  // ═══ ٤ — نافذة الأقفال: وسيط --claims-window-min ═══
  await reset();
  await claim('w1', {claimedAtMs: Date.now() - 30 * MIN, reservation: {userId: SECRET_OWNER, reservedAtMs: Date.now() - 30 * MIN}});
  r = cli([]);
  eq(r.code, 3, '[٤] بالافتراضي 120: قفل عمره 30 دقيقة داخل');
  eq(r.json.criteria.claims.windowIsDefault, true, '[٤] والمعيار يقول إنها الافتراضية المؤقّتة');
  eq(r.json.criteria.claims.claimedAtMsWithinMinutes, 120, '[٤] 120');
  r = cli(['--claims-window-min', '10']);
  eq(r.code, 0, '[٤] --claims-window-min 10: القفل خارج النافذة: رمز 0');
  eq(r.json.claims.OLDER_THAN_WINDOW, 1, '[٤] ويُعدّ خارجها');
  eq(r.json.criteria.claims.windowIsDefault, false, '[٤] والمعيار يقول إنها مُمرَّرة');
  eq(r.json.criteria.claims.claimedAtMsWithinMinutes, 10, '[٤] والرقم المطبوع 10');
  r = cli(['--claims-window-min', '45']);
  eq(r.code, 3, '[٤] --claims-window-min 45: داخل: رمز 3');
  eq(r.json.claims.inWindowWithReservation, 1, '[٤] وحجزه مُعلَن');
  // حدّ النافذة بالضبط: في العملية نفسها بساعة محقونة (والـdb حقيقي على المحاكي)
  await reset();
  const T0 = Date.now();
  await session('edge-session', 'pending', Timestamp.fromMillis(T0));
  await claim('edge-claim', {claimedAtMs: T0, reservation: null});
  const inproc = async (nowMs, argv = ['--claims-window-min', '30']) => {
    const outs = [];
    const code = await main(argv, {now: () => nowMs, out: (s) => outs.push(s), err: () => {}, db});
    return {code, json: JSON.parse(outs[0])};
  };
  r = await inproc(T0 + 30 * MIN);
  eq(r.json.claims.inWindow, 1, '[٤] قفل عمره 30 دقيقة بنافذة 30: داخل (العمر ≤ النافذة)');
  eq(r.json.sessions.byStatus.pending.OLDER_THAN_WINDOW, 0, '[٤] وجلسة عمرها 30 دقيقة داخل');
  r = await inproc(T0 + 30 * MIN + 1);
  eq(r.json.claims.OLDER_THAN_WINDOW, 1, '[٤] بعدها بمللي ثانية: القفل خارج');
  r = await inproc(T0 + 120 * MIN);
  eq(r.json.sessions.byStatus.pending.IN_WINDOW, 1, '[٤] جلسة على 120 دقيقة تماماً: داخل');
  eq(r.code, 3, '[٤] فيمنع');
  r = await inproc(T0 + 120 * MIN + 1);
  eq(r.json.sessions.byStatus.pending.OLDER_THAN_WINDOW, 1, '[٤] بعدها بمللي ثانية: خارج');
  eq(r.code, 0, '[٤] فلا يمنع');

  // ═══ ٥ — المخرَج أعداد وحدها ═══
  await reset();
  await session('SESSION-ID-SECRET-1', 'pending', ago(5 * MIN));
  await session('SESSION-ID-SECRET-2', 'scanning', undefined);
  await claim('SCAN-ID-SECRET-1', {claimedAtMs: Date.now() - MIN, reservation: {userId: SECRET_OWNER, reservedAtMs: Date.now() - MIN, isFreeTrial: false}});
  r = cli([]);
  eq(r.code, 3, '[٥] مشهد فيه جلسات وأقفال: رمز 3');
  ok(!/SECRET/.test(r.stdout) && !r.stdout.includes(SECRET_CODE) && !r.stdout.includes(SECRET_OWNER), '[٥] stdout بلا معرّف جلسة ولا رمزها ولا معرّف مستخدم ولا scanId');
  ok(!/SECRET/.test(r.stderr), '[٥] ولا stderr');
  ok(!/#[0-9a-f]{12}/.test(r.stdout), '[٥] ولا قيمة مُهشَّرة (أعداد وحدها)');

  // ═══ ٦ — قراءة بحتة داخل العملية: لا كتابة (على db الحقيقي) ═══
  const {Transaction, WriteBatch, DocumentReference, CollectionReference} = require('@google-cloud/firestore');
  const writes = [];
  const undo = [];
  for (const [proto, names] of [[Transaction.prototype, ['create', 'set', 'update', 'delete']], [WriteBatch.prototype, ['create', 'set', 'update', 'delete', 'commit']],
    [DocumentReference.prototype, ['create', 'set', 'update', 'delete']], [CollectionReference.prototype, ['add']]]) {
    for (const name of names) {
      const orig = proto[name];
      proto[name] = function (...a) { writes.push(name); return orig.apply(this, a); };
      undo.push(() => { proto[name] = orig; });
    }
  }
  const noWrite = await inproc(Date.now());
  for (const u of undo) u();
  eq(noWrite.code, 3, '[٦] في العملية نفسها: الحكم كما في السطر');
  eq(writes.length, 0, '[٦] صفر محاولة كتابة على عميل Firestore (set/update/delete/create/add/batch/transaction)');

  // ═══ ٧ — صفحات: أكثر من صفحة (200) ═══
  await reset();
  for (let chunk = 0; chunk < 3; chunk++) {
    const batch = db.batch();
    for (let i = 0; i < 150; i++) batch.set(db.collection('scanSessions').doc(`page-${chunk}-${i}`), {status: i % 2 === 0 ? 'pending' : 'scanning', createdAt: ago(MIN), code: 'x', ownerId: 'o'});
    await batch.commit();
  }
  r = cli([]);
  eq(r.json.verdict.blockingCounts.sessionsInWindow, 450, '[٧] 450 جلسة (ثلاث دفعات؛ أكثر من صفحة 200): كلها معدودة');
  eq(r.json.sessions.byStatus.pending.total, 225, '[٧] pending 225');
  eq(r.json.sessions.byStatus.scanning.total, 225, '[٧] وscanning 225');

  // ═══ ٨ — أخطاء: رمز 2 ═══
  for (const [argv, label] of [[['--claims-window-min', 'abc'], 'نصّ'], [['--claims-window-min', '0'], 'صفر'], [['--claims-window-min'], 'بلا قيمة'], [['--claims-window-min', '-3'], 'سالب'], [['--bogus'], 'وسيط مجهول']]) {
    r = cli(argv);
    eq(r.code, 2, `[٨] ${label}: رمز 2`);
    ok(r.stdout === '' && /USAGE/.test(r.stderr), `[٨] ${label}: رسالة استعمال بلا مخرَج`);
  }
  // --preflight بلا شبكة: مضيف ميّت لا يضرّ
  r = cli(['--preflight'], {FIRESTORE_EMULATOR_HOST: '127.0.0.1:1'});
  eq(r.code, 0, '[٨] --preflight بمضيف محاكٍ ميّت: رمز 0 (لا اتصال)');
  ok(r.json.network === false && r.json.checks.every((c) => c.ok), '[٨] وفحوصه ناجحة');
  // فشل القراءة: مضيف ميّت بلا preflight ⇒ رمز 2 لا 0 ولا 3
  r = cli([], {FIRESTORE_EMULATOR_HOST: '127.0.0.1:1'});
  eq(r.code, 2, '[٨] تعذّر الاتصال: رمز 2 (لا يُقرأ صفراً)');
  ok(r.stdout === '' && /توقّف بخطأ/.test(r.stderr), '[٨] برسالة خطأ وبلا مخرَج');
  ok(!/127\.0\.0\.1/.test(r.stderr.split('\n').slice(1).join('\n')), '[٨] ورسالة الخطأ بلا نصّ المزوّد (الصنف والرمز وحدهما)');

  await reset();
  await app.delete();
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error('FAIL:', (e && e.stack) || e);
  process.exitCode = 1;
});
