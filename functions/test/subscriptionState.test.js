'use strict';

// subscriptionState.test.js — السكربت subscription-state-readonly.js ومكتبته scripts/lib/subscriptionState.js (تشخيص ب٨، 2026-10-14 +03).
// وحدة بلا شبكة ولا محاكٍ. الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في هذا الاختبار وحده؛ والمنطق المعروض مرآة لشيفرة الإنتاج
// (analyzeDevice.js:456-474 · scanReservation.js:94-99 · checkExpiringSubscriptions.js:59-62/111-115/163-167)، فيحرس الاتّساق معها اختبارُ مصادرها (٦) بطفرات في الذاكرة (لا مسّ بملفّ في functions/src).
//
// ١ الوسائط · ٢ وصف الحقول · ٣ بوّابة الفحص (الترتيب والرسائل) · ٤ المهمّة المجدولة · ٥ المشغَّل التالي · ٦ حارس المصادر وطفراته · ٧ main: بلا بريد ولا uid ولا حقل خارج القائمة، وقراءة واحدة · ٨ الحارس الساكن للقراءة فقط وطفراته
//
// Run: node functions/test/subscriptionState.test.js

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
const {main} = require('../scripts/subscription-state-readonly');
const {SCAN_REFUSAL_TEXT, SCAN_REFUSAL} = require('../src/analysis/scanRefusal');
const {makeMemDb} = require('./lib/memFirestore');

const FN = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(FN, rel), 'utf8').replace(/\r\n/g, '\n');

const SECRET_EMAIL = 'owner.s21.secret@example.test';
const SECRET_UID = 'uid-SUB-SECRET-424242';
const NOW = Date.UTC(2026, 9, 14, 7, 30, 0); // 2026-10-14T10:30:00+03:00
const H = 60 * 60 * 1000;
const D = 24 * H;
const ts = (ms) => ({toMillis: () => ms, toDate: () => new Date(ms)});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-state-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `sub-${++counter}.json`);
const authFor = (uid = SECRET_UID) => ({getUserByEmail: async (email) => {
  if (email !== SECRET_EMAIL) throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  return {uid};
}});
const ENV = {[C.OWNER_EMAIL_ENV]: SECRET_EMAIL};

// نصوص الرفض من مصدرها الواحد scanRefusal.js (S-SUB 2026-10-16)؛ حرفيّتها المثبَّتة للأجهزة القديمة في scanRefusalGuard.test.js §١ لا هنا (كانت هنا نسخة حرفية ثالثة).
const MSG = {
  NO_CREDIT: SCAN_REFUSAL_TEXT[SCAN_REFUSAL.NO_CREDIT],
  EXPIRED: SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SUBSCRIPTION_EXPIRED],
  FREE_USED: SCAN_REFUSAL_TEXT[SCAN_REFUSAL.FREE_DEVICE_USED],
};

(async () => {
  // ═══ ١ — الوسائط ═══
  const pa = S.parseArgs;
  deq(pa([]), {mode: 'run', out: null}, '[١] بلا وسائط: تشغيل بلا ملفّ');
  deq(pa(['--out', 's.json']), {mode: 'run', out: 's.json'}, '[١] --out');
  deq(pa(['--preflight']), {mode: 'preflight', out: null}, '[١] --preflight');
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
  bad(['--preflight', '--out', 's.json'], /--preflight وحدها/, '[١] --preflight مع --out');
  bad(['--out'], /يحتاج قيمة/, '[١] --out بلا قيمة');
  bad(['--out', 'a', '--out', 'b'], /مكرَّر/, '[١] --out مكرَّر');
  bad(['--email', 'x@y.z'], /وسيط مجهول --email/, '[١] البريد لا يُقبل من سطر الأمر');
  bad(['x'], /\(موضعي\)/, '[١] وسيط موضعي');
  eq(S.preflightChecks({}).ok, true, '[١] preflight: كل الفحوص الذاتية تمرّ');

  // ═══ ٢ — وصف الحقول: الغائب ≠ null ≠ false، والأنواع، وما لا يُطبَع ═══
  const d = S.describeField;
  deq(d(null, 'plan'), {present: false, type: 'absent'}, '[٢] المستند غائب: الحقل غائب');
  deq(d({}, 'scansRemaining'), {present: false, type: 'absent'}, '[٢] الحقل غائب');
  deq(d({isActive: undefined}, 'isActive'), {present: false, type: 'absent'}, '[٢] undefined = غائب');
  deq(d({isActive: null}, 'isActive'), {present: true, type: 'null', value: null}, '[٢] null حاضر ≠ غائب');
  deq(d({isActive: false}, 'isActive'), {present: true, type: 'boolean', value: false}, '[٢] false');
  deq(d({scansRemaining: 136}, 'scansRemaining'), {present: true, type: 'number', value: 136}, '[٢] رقم');
  deq(d({scansRemaining: NaN}, 'scansRemaining'), {present: true, type: 'number', value: null, valuePrinted: false}, '[٢] NaN لا يُطبَع');
  deq(d({plan: 'shop_pro'}, 'plan'), {present: true, type: 'string', value: 'shop_pro'}, '[٢] اسم باقة يُطبَع');
  deq(d({plan: 'a b'}, 'plan'), {present: true, type: 'string', value: null, valuePrinted: false, stringLength: 3}, '[٢] نصّ بمسافة لا يُطبَع (طوله فقط)');
  deq(d({subExpiryFcmDate: '2026-10-14'}, 'subExpiryFcmDate'), {present: true, type: 'string', value: '2026-10-14'}, '[٢] تاريخ يوم يُطبَع');
  deq(d({expiresAt: ts(Date.UTC(2026, 9, 14, 6, 0, 0))}, 'expiresAt'), {present: true, type: 'timestamp', plus03: '2026-10-14T09:00:00.000+03:00', epochMs: Date.UTC(2026, 9, 14, 6, 0, 0)}, '[٢] Timestamp بـ+03');
  deq(d({expiresAt: '2026-10-14T06:00:00.000Z'}, 'expiresAt'), {present: true, type: 'string', value: '2026-10-14T06:00:00.000Z'}, '[٢] expiresAt نصّاً: نوعه string (≠ timestamp)');
  deq(d({expiresAt: 1_800_000_000_000}, 'expiresAt'), {present: true, type: 'number', value: 1_800_000_000_000}, '[٢] expiresAt رقماً: نوعه number');
  deq(d({freeTrialUsedDevices: ['a', 'b', 'c']}, 'freeTrialUsedDevices'), {present: true, type: 'array', length: 3}, '[٢] قائمة الأجهزة: عددها فقط');
  let thrown = null;
  try { d({email: 'x'}, 'email'); } catch (e) { thrown = e; }
  ok(thrown && /FIELD_NOT_WHITELISTED: email/.test(thrown.message), '[٢] حقل خارج القائمة البيضاء يُرمى');
  deq([...S.FIELDS], ['plan', 'scansRemaining', 'scansTotal', 'isActive', 'expiresAt', 'subExpiredNotified', 'subExpiredAt', 'subExpiryEmailSent', 'subExpiryFcmDate', 'freeTrialUsedDevices'], '[٢] القائمة البيضاء عشرة حقول بالترتيب المعلَن');

  // ═══ ٣ — بوّابة الفحص: الترتيب والرسائل ═══
  const gate = (u) => S.evaluateGate(u, NOW);
  {
    const g = gate(null);
    eq(g.verdict, 'NO_CREDIT (users doc missing)', '[٣] المستند غائب ⟵ NO_CREDIT');
    eq(g.refusal.message, MSG.NO_CREDIT, '[٣] نصّ الرفض');
    eq(g.userDocExists, false, '[٣] userDocExists=false');
  }
  {
    const g = gate({scansRemaining: 0, expiresAt: ts(NOW - D)});
    eq(g.verdict, 'NO_CREDIT', '[٣][الأهمّ] رصيد 0 ومنتهٍ ⟵ NO_CREDIT لا SUBSCRIPTION_EXPIRED (الرصيد قبل الانتهاء: ترتيب scanGateVerdict في scanRefusal.js)');
    eq(g.refusal.message, MSG.NO_CREDIT, '[٣] الرسالة «لا يوجد رصيد فحوصات. يرجى شراء اشتراك.»');
    ok(/scanGateVerdict/.test(g.refusedAt), '[٣] موضع الرفض: الدالّة الواحدة scanGateVerdict (لا مرحلتان منسوختان)');
  }
  {
    const g = gate({scansRemaining: 136, plan: 'shop_pro', isActive: true, expiresAt: ts(NOW - 1000)});
    eq(g.verdict, 'SUBSCRIPTION_EXPIRED', '[٣][الأهمّ] رصيد 136 وانتهاء مضى ⟵ SUBSCRIPTION_EXPIRED');
    eq(g.refusal.message, MSG.EXPIRED, '[٣] الرسالة «انتهى اشتراكك، يرجى التجديد» بالفاصلة U+060C');
    eq(g.refusal.code, 'permission-denied', '[٣] رمز الخطأ permission-denied');
    ok(/scanGateVerdict/.test(g.refusedAt), '[٣] موضع الرفض: scanGateVerdict');
    eq(g.scansRemainingEffective, 136, '[٣] الرصيد الفعلي 136 (لم يُصفَّر)');
    eq(g.isActiveIsReadByTheGate, false, '[٣] البوّابة لا تقرأ isActive');
  }
  eq(gate({scansRemaining: 136, isActive: false, expiresAt: ts(NOW - 1000)}).verdict, 'SUBSCRIPTION_EXPIRED', '[٣] isActive=false لا يغيّر حكم البوّابة (لا تقرؤه)');
  eq(gate({scansRemaining: 136, isActive: true, expiresAt: ts(NOW + 1000)}).verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٣] expiresAt مستقبلي ⟵ يمرّ');
  eq(gate({scansRemaining: 136, expiresAt: ts(NOW)}).verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٣] expiresAt == الآن تماماً ⟵ لا انتهاء (المقارنة صارمة <)');
  eq(gate({scansRemaining: 136}).verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٣] expiresAt غائب ⟵ لا انتهاء');
  eq(gate({scansRemaining: 136, expiresAt: null}).verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٣] expiresAt=null ⟵ لا انتهاء');
  {
    const g = gate({scansRemaining: 136, expiresAt: 'not-a-date'});
    eq(g.verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٣] expiresAt نصّ غير قابل للتحويل ⟵ لا انتهاء (utils/subscription.js:9-10)');
    ok(g.anomalies.some((a) => /EXPIRES_AT_UNPARSEABLE/.test(a)), '[٣] ويُعلَن شذوذاً صريحاً');
  }
  eq(gate({scansRemaining: 136, expiresAt: '2026-10-13T06:00:00.000Z'}).verdict, 'SUBSCRIPTION_EXPIRED', '[٣] expiresAt نصّ ISO ماضٍ ⟵ منتهٍ عند البوّابة');
  eq(gate({scansRemaining: 136, expiresAt: NOW - 1000}).verdict, 'SUBSCRIPTION_EXPIRED', '[٣] expiresAt رقماً (ms) ماضٍ ⟵ منتهٍ عند البوّابة');
  {
    // القاعدة 23: كان هنا «يمرّ المبكّر (> 0) ويرفضه الحجز (>= 1)» — يُثبِت مرآةً بشرطين مكتوبين مرّتين. صار شرط الرصيد واحداً (scanGateVerdict: `>= 1`) للمبكّر والحجز وردّ checkSubscription،
    // فالرصيد الكسري يُرفض NO_CREDIT من البوّابة الواحدة (لا يقع في الإنتاج: الرصيد يُغيَّر بـincrement(±1)). الحالة الحيّة على المعالج الحقيقي: scanRefusalGuard.test.js §٣.
    const g = gate({scansRemaining: 0.5});
    eq(g.verdict, 'NO_CREDIT', '[٣] رصيد كسري 0.5: NO_CREDIT من البوّابة الواحدة (>= 1)');
    ok(/scanGateVerdict/.test(g.refusedAt), '[٣] ومن الدالّة الواحدة لا من مرحلة الحجز وحدها');
  }
  {
    const g = gate({scansRemaining: '5'});
    ok(g.anomalies.some((a) => /SCANS_REMAINING_NOT_A_NUMBER \(type=string\)/.test(a)), '[٣] رصيد نصّي: شذوذ مُعلَن');
    eq(g.scansRemainingEffective, 'non-number (string)', '[٣] ولا يُطبَع كرقم');
  }
  {
    const g = gate({scansRemaining: 5});
    eq(g.planEffective, 'free', '[٣] plan غائب ⟵ free (scanRefusal.js: `(userData.plan || "free")`)');
    ok(g.stages.some((s) => /free-trial device check/.test(s.stage) && /NOT_EVALUATED/.test(s.note)), '[٣] فحص الجهاز المجاني لباقة free: غير مُقيَّم ومُعلَن');
    ok(gate({scansRemaining: 5, plan: 'shop_basic'}).stages.some((s) => /not applicable/.test(s.note || '')), '[٣] باقة shop: الفحص لا ينطبق');
  }
  eq(gate({scansRemaining: -2}).verdict, 'NO_CREDIT', '[٣] رصيد سالب ⟵ NO_CREDIT');
  // الحكم من الدالّة الحقيقية: لكل حالة، حكم evaluateGate = حكم checkSubscriptionVerdict المستوردة (القاعدة 30: كل القيم لا واحدة)
  {
    const {checkSubscriptionVerdict} = require('../src/analysis/scanRefusal');
    const states = [null, {}, {scansRemaining: 0}, {scansRemaining: -2}, {scansRemaining: 0.5}, {scansRemaining: 1}, {scansRemaining: 136, expiresAt: ts(NOW - 1000)},
      {scansRemaining: 136, expiresAt: ts(NOW + 1000)}, {scansRemaining: 0, expiresAt: ts(NOW - 1000)}, {scansRemaining: 5, expiresAt: 'not-a-date'}, {scansRemaining: '5'}];
    for (const u of states) {
      const v = checkSubscriptionVerdict(u, new Date(NOW));
      const want = v === 'ALLOWED' ? 'PASSES_BALANCE_AND_EXPIRY' : (u === null ? 'NO_CREDIT (users doc missing)' : v);
      eq(gate(u).verdict, want, `[٣] حكم evaluateGate = حكم الدالّة الحقيقية لـ${JSON.stringify(u === null ? null : Object.keys(u))}`);
    }
  }

  // ═══ ٤ — المهمّة المجدولة ═══
  const cron = (u) => S.evaluateCron(u, NOW);
  {
    const c = cron({isActive: true, scansRemaining: 136, expiresAt: ts(NOW - 1000)});
    eq(c.zeroing.matchesNow, true, '[٤] isActive=true وTimestamp ماضٍ ⟵ يطابق القسم أ');
    eq(c.zeroing.matchesAtPreviousRun, false, '[٤] انقضى بعد المشغَّل السابق (09:00) فلم يكن ليطابقه');
    // A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال): كان {scansRemaining: 0, …}؛ قرار المستخدم 2026-10-14: يطفئ ولا يصفّر
    deq(c.zeroing.writesIfMatched, {isActive: false, subExpiredNotified: true, subExpiredAt: 'serverTimestamp'}, '[٤] ما تكتبه المهمّة: تعطيل وعلم إشعار بلا تصفير (A-SUB 4a)');
  }
  {
    const c = cron({isActive: true, expiresAt: ts(Date.UTC(2026, 9, 14, 5, 0, 0))}); // 08:00+03: قبل 09:00
    eq(c.zeroing.matchesAtPreviousRun, true, '[٤] انقضى قبل المشغَّل السابق ⟵ كان سيُطابَق (رصيد سليم الآن = المهمّة لم تصفّره)');
  }
  {
    const c = cron({isActive: true, expiresAt: ts(NOW + 90 * 60 * 1000)}); // 12:00+03
    eq(c.zeroing.matchesNow, false, '[٤] مستقبلي: لا يطابق الآن');
    eq(c.zeroing.matchesAtNextRun, true, '[٤][الأهمّ] ينقضي قبل المشغَّل التالي ⟵ يُصفَّر في 2026-10-15 09:00');
    eq(c.reminder.matchesNow, true, '[٤] وهو داخل نافذة التذكير (≤ 3 أيام)');
  }
  eq(cron({isActive: true, expiresAt: ts(NOW + 4 * D)}).zeroing.matchesAtNextRun, false, '[٤] بعد أربعة أيام: لا يطابق عند التالي');
  eq(cron({isActive: true, expiresAt: ts(NOW + 4 * D)}).reminder.matchesAtNextRun, false, '[٤] ولا داخل نافذة الثلاثة عند التالي');
  eq(cron({isActive: true, expiresAt: ts(NOW + 3 * D)}).reminder.matchesNow, true, '[٤] بعد ثلاثة أيام تماماً: داخل النافذة (<=)');
  eq(cron({isActive: false, expiresAt: ts(NOW - D)}).zeroing.matchesNow, false, '[٤] isActive=false: لا يطابق');
  eq(cron({expiresAt: ts(NOW - D)}).zeroing.matchesNow, false, '[٤] isActive غائب: لا يطابق');
  eq(cron({isActive: 'true', expiresAt: ts(NOW - D)}).zeroing.matchesNow, false, '[٤] isActive نصّاً "true": مساواة Firestore بـtrue المنطقية لا تطابقه');
  {
    const c = cron({isActive: true, expiresAt: '2026-10-13T06:00:00.000Z'});
    eq(c.zeroing.matchesNow, false, '[٤] expiresAt نصّاً: لا يطابق استعلام Timestamp');
    ok(c.anomalies.some((a) => /EXPIRES_AT_NOT_A_TIMESTAMP \(type=string\)/.test(a)), '[٤] والشذوذ مُعلَن');
  }
  eq(cron({isActive: true}).zeroing.matchesNow, false, '[٤] expiresAt غائب: لا يطابق (ولا ينتهي عند البوّابة)');
  eq(cron(null).zeroing.matchesNow, false, '[٤] المستند غائب: لا يطابق');
  eq(cron({isActive: true, scansRemaining: 2}).lowScans.matchesNow, true, '[٤] رصيد 2: يطابق القسم ج');
  eq(cron({isActive: true, scansRemaining: 0}).lowScans.matchesNow, false, '[٤] رصيد 0: لا (> 0)');
  eq(cron({isActive: true, scansRemaining: 4}).lowScans.matchesNow, false, '[٤] رصيد 4: لا (<= 3)');
  eq(cron({isActive: true, plan: 'shop_pro'}).lowScans.planIsShop, true, '[٤] shop_pro باقة محلّ');
  eq(cron({isActive: true, plan: 'single'}).lowScans.planIsShop, false, '[٤] single ليست باقة محلّ');
  eq(cron({subExpiredNotified: true, isActive: true}).zeroing.emailAndPushWouldBeSkipped, true, '[٤] subExpiredNotified=true ⟵ البريد والإشعار يُتخطّيان (:76)');
  ok(cron({}).indexNote.includes('manual (composite) index'), '[٤] تنبيه الفهرس موجود');

  // ═══ ٥ — المشغَّل التالي ═══
  {
    const r = S.nextCronRun(NOW);
    eq(r.next.plus03, '2026-10-15T09:00:00.000+03:00', '[٥] 10:30+03 ⟵ التالي غداً 09:00');
    eq(r.previous.plus03, '2026-10-14T09:00:00.000+03:00', '[٥] والسابق اليوم 09:00');
    eq(r.damascusWallClockVerified, true, '[٥] الساعة الجدارية بدمشق 09:00 (Intl)');
    const early = S.nextCronRun(Date.UTC(2026, 9, 14, 5, 59, 59)); // 08:59:59+03
    eq(early.next.plus03, '2026-10-14T09:00:00.000+03:00', '[٥] 08:59:59 ⟵ التالي اليوم 09:00');
    const exact = S.nextCronRun(Date.UTC(2026, 9, 14, 6, 0, 0)); // 09:00:00+03 تماماً
    eq(exact.next.plus03, '2026-10-15T09:00:00.000+03:00', '[٥] 09:00:00 تماماً ⟵ التالي غداً (ما مضى لا يُعدّ قادماً)');
    eq(S.toPlus03(Date.UTC(2026, 9, 14, 6, 0, 0)), '2026-10-14T09:00:00.000+03:00', '[٥] toPlus03');
  }

  // ═══ ٦ — حارس المصادر وطفراته (القاعدة 39: المرآة تتبع المصدر) ═══
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const norm = (s) => stripComments(s).replace(/\s+/g, ' ');
  const idx = (s, needle) => s.indexOf(needle);
  /** انتهاكات مسمّاة لتطابق مرآة السكربت مع المصادر الأربعة. */
  function sourceViolations({analyzeDevice, scanReservation, scanRefusal, createScanSession, cronSrc}) {
    const v = new Set();
    // البوّابة دالّة واحدة (S-SUB 2026-10-16): analyzeDevice (المبكّر) وscanReservation (المعاملة) يحكمان بـscanGateVerdict ويرميان بـrefuseScan، بلا شرط رصيد/انتهاء/جهاز مجاني مكتوب فيهما؛
    // وترتيب الرصيد فالانتهاء فالجهاز في مصدرها scanRefusal.js. (كان هنا حارس مرآة بنصوص المصدرين ونصوص الرسائل — القاعدة 23؛ ونصوص الرفض وبنية الرمي في scanRefusalGuard.test.js.)
    const a = norm(analyzeDevice);
    const gateAt = idx(a, 'const gateRefusal = scanGateVerdict(userData, {deviceFP}); if (gateRefusal !== null) refuseScan(gateRefusal,');
    const claimAt = idx(a, 'const claimRef = db.collection("scanClaims")');
    if (gateAt < 0) v.add('GATE_ANALYZE_DEVICE_NOT_THE_SINGLE_VERDICT');
    if (gateAt >= 0 && claimAt >= 0 && !(gateAt < claimAt)) v.add('GATE_EARLY_CHECK_AFTER_CLAIM_WRITE');
    for (const [name, src] of Object.entries({analyzeDevice, scanReservation})) {
      if (/\bisSubscriptionExpired\b/.test(norm(src)) || /freeTrialUsedDevices/.test(norm(src)) && name === 'analyzeDevice') v.add(`GATE_DUPLICATED_IN_${name}`);
    }
    for (const [name, src] of Object.entries({analyzeDevice, scanReservation, scanRefusal, createScanSession})) if (/\bisActive\b/.test(norm(src))) v.add(`GATE_READS_IS_ACTIVE_${name}`);
    const r = norm(scanReservation);
    if (!r.includes('const verdict = scanGateVerdict(userData, {deviceFP}); if (verdict !== null) refuseScan(verdict,')) v.add('RESERVATION_NOT_THE_SINGLE_VERDICT');
    const sr = norm(scanRefusal);
    const nc = idx(sr, 'return SCAN_REFUSAL.NO_CREDIT;');
    const ex = idx(sr, 'return SCAN_REFUSAL.SUBSCRIPTION_EXPIRED;', nc);
    const fd = idx(sr, 'return SCAN_REFUSAL.FREE_DEVICE_USED;', ex);
    if (nc < 0 || ex < 0 || fd < 0 || !(nc < ex && ex < fd)) v.add('GATE_ORDER_BALANCE_EXPIRY_DEVICE');
    if (!sr.includes('if (!(balance >= 1)) return SCAN_REFUSAL.NO_CREDIT;')) v.add('GATE_BALANCE_CONDITION_DRIFT');
    const c = norm(createScanSession);
    const cb = idx(c, '(userData.scansRemaining || 0) <= 0');
    const ce = idx(c, 'isSubscriptionExpired(userData)', cb);
    if (cb < 0 || ce < 0) v.add('CREATE_SESSION_GATE_DRIFT');
    const k = norm(cronSrc);
    const has = (t) => k.includes(t);
    if (!has('schedule: "every day 09:00"') || !has('timeZone: "Asia/Damascus"')) v.add('CRON_SCHEDULE_DRIFT');
    if (!has('.where("isActive", "==", true) .where("expiresAt", "<=", now)')) v.add('CRON_SECTION_A_QUERY_DRIFT');
    // A-SUB البند ٤-أ (2026-10-17، القاعدة 23 — استبدال): القسم أ يكتب isActive وعلم الإشعار وsubExpiredAt **ولا يكتب scansRemaining** (قرار 2026-10-14)
    if (!has('isActive: false, subExpiredNotified: true, subExpiredAt: admin.firestore.FieldValue.serverTimestamp(),')) v.add('CRON_SECTION_A_WRITES_DRIFT');
    if (/scansRemaining\s*:/.test(k)) v.add('CRON_SECTION_A_ZEROES_BALANCE');
    if (!has('.where("isActive", "==", true) .where("expiresAt", "<=", threeDaysLater) .where("expiresAt", ">", now)') || !has('3 * 24 * 60 * 60 * 1000')) v.add('CRON_SECTION_B_QUERY_DRIFT');
    if (!has('.where("isActive", "==", true) .where("scansRemaining", "<=", 3) .where("scansRemaining", ">", 0)') || !has('user.plan !== "shop_basic" && user.plan !== "shop_pro"')) v.add('CRON_SECTION_C_QUERY_DRIFT');
    // القسم د حُذف (A-SUB البند ٤-أ؛ قرار 2026-10-10: لا منظّف مجدوَل): المهمّة لا تلمس scanSessions ولا تكتب «expired»
    if (/scanSessions|batch\.update|status:\s*"expired"|\.limit\(500\)/.test(k)) v.add('CRON_SECTION_D_PRESENT');
    // كل قسم في try/catch مستقلّ: الأقسام الثلاثة تمرّ بـrunSection (يلفّ العمل بـtry/catch ويسجّل السطر المسمّى)
    if ((k.match(/await runSection\(/g) || []).length !== 3 || !has('const runSection = async (section, work) => { try {') || !has('} catch (e) { results[section] = SECTION_FAILED;')) v.add('CRON_SECTIONS_NOT_INDEPENDENT');
    if (!has('if (user.subExpiredNotified) continue;')) v.add('CRON_NOTIFIED_SKIP_DRIFT');
    if (!has('const todayStr = now.toISOString().slice(0, 10);')) v.add('CRON_TODAY_STR_DRIFT');
    return [...v].sort();
  }
  const SRC = {
    analyzeDevice: read('src/analysis/analyzeDevice.js'),
    scanReservation: read('src/analysis/scanReservation.js'),
    scanRefusal: read('src/analysis/scanRefusal.js'),
    createScanSession: read('src/sessions/createScanSession.js'),
    cronSrc: read('src/notifications/checkExpiringSubscriptions.js'),
  };
  deq(sourceViolations(SRC), [], '[٦] المصادر الحقيقية: لا انحراف عن مرآة السكربت');
  eq(S.CRON.schedule, 'every day 09:00', '[٦] CRON.schedule');
  eq(S.CRON.timeZone, 'Asia/Damascus', '[٦] CRON.timeZone');
  const mutate = (key, from, to) => {
    ok(SRC[key].includes(from), `[٦] طفرة ${key}: النصّ المستهدَف موجود في المصدر الحقيقي — ${from.slice(0, 50)}`);
    return sourceViolations({...SRC, [key]: SRC[key].replace(from, to)});
  };
  {
    // طفرة ١: ترتيب الحكم (الانتهاء قبل الرصيد) في مصدر الدالّة الواحدة
    {
      const sr = SRC.scanRefusal;
      const iNc = sr.indexOf('if (!(balance >= 1)) return SCAN_REFUSAL.NO_CREDIT;');
      const iEx = sr.indexOf('if (isSubscriptionExpired(userData, now)) return SCAN_REFUSAL.SUBSCRIPTION_EXPIRED;');
      ok(iNc >= 0 && iEx > iNc, '[٦] طفرة ١: السطران المستهدفان موجودان في المصدر الحقيقي');
      const swapped = sr.slice(0, iNc) + 'if (isSubscriptionExpired(userData, now)) return SCAN_REFUSAL.SUBSCRIPTION_EXPIRED;\n  ' +
          sr.slice(iNc, iEx) + sr.slice(iEx + 'if (isSubscriptionExpired(userData, now)) return SCAN_REFUSAL.SUBSCRIPTION_EXPIRED;'.length);
      ok(sourceViolations({...SRC, scanRefusal: swapped}).includes('GATE_ORDER_BALANCE_EXPIRY_DEVICE'), '[٦] طفرة: فحص الانتهاء قبل الرصيد في scanGateVerdict يُكشَف');
    }
    ok(mutate('scanRefusal', 'if (!(balance >= 1)) return SCAN_REFUSAL.NO_CREDIT;', 'if (!(balance >= 2)) return SCAN_REFUSAL.NO_CREDIT;').includes('GATE_BALANCE_CONDITION_DRIFT'), '[٦] طفرة: شرط الرصيد يتغيّر ⟵ يُكشَف');
    ok(mutate('analyzeDevice', 'const gateRefusal = scanGateVerdict(userData, {deviceFP});', 'const gateRefusal = null;').includes('GATE_ANALYZE_DEVICE_NOT_THE_SINGLE_VERDICT'), '[٦] طفرة: analyzeDevice تترك الحكم الواحد ⟵ يُكشَف');
    ok(mutate('analyzeDevice', 'const gateRefusal = scanGateVerdict(userData, {deviceFP});', 'const gateRefusal = scanGateVerdict(userData, {deviceFP}) || userData.isActive;').includes('GATE_READS_IS_ACTIVE_analyzeDevice'), '[٦] طفرة: البوّابة تبدأ بقراءة isActive ⟵ يُكشَف');
    ok(mutate('analyzeDevice', 'const gateRefusal = scanGateVerdict(userData, {deviceFP});', 'if (isSubscriptionExpired(userData)) { throw 1; }\n      const gateRefusal = scanGateVerdict(userData, {deviceFP});').includes('GATE_DUPLICATED_IN_analyzeDevice'), '[٦] طفرة: شرط الانتهاء يُكتب ثانيةً في analyzeDevice ⟵ يُكشَف');
    ok(mutate('scanReservation', 'const verdict = scanGateVerdict(userData, {deviceFP});', 'const verdict = null;').includes('RESERVATION_NOT_THE_SINGLE_VERDICT'), '[٦] طفرة: معاملة الحجز تترك الحكم الواحد ⟵ يُكشَف');
    ok(mutate('cronSrc', '.where("expiresAt", "<=", now)', '.where("expiresAt", "<", now)').includes('CRON_SECTION_A_QUERY_DRIFT'), '[٦] طفرة: شرط القسم أ يتغيّر ⟵ يُكشَف');
    ok(mutate('cronSrc', 'isActive: false,\n            subExpiredNotified: true,', 'isActive: false,\n            subExpiredNotified: false,').includes('CRON_SECTION_A_WRITES_DRIFT'), '[٦] طفرة: ما تكتبه المهمّة يتغيّر ⟵ يُكشَف');
    ok(mutate('cronSrc', 'isActive: false,\n            subExpiredNotified: true,', 'scansRemaining: 0,\n            isActive: false,\n            subExpiredNotified: true,').includes('CRON_SECTION_A_ZEROES_BALANCE'), '[٦] طفرة: عودة تصفير الرصيد في القسم أ ⟵ تُكشَف (A-SUB 4a)');
    ok(mutate('cronSrc', 'every day 09:00', 'every day 10:00').includes('CRON_SCHEDULE_DRIFT'), '[٦] طفرة: موعد المهمّة يتغيّر ⟵ يُكشَف');
    ok(mutate('cronSrc', 'return remindedCount;', 'await db.collection("scanSessions").where("status", "==", "pending").limit(500).get(); return remindedCount;').includes('CRON_SECTION_D_PRESENT'), '[٦] طفرة: عودة منظّف الجلسات (القسم د) ⟵ تُكشَف');
    ok(mutate('cronSrc', 'await runSection(EXPIRY_SECTION.LOW_BALANCE, async () => {', 'await (async () => {').includes('CRON_SECTIONS_NOT_INDEPENDENT'), '[٦] طفرة: قسم يخرج من runSection (بلا try/catch مستقلّ) ⟵ يُكشَف');
  }

  // ═══ ٧ — main ═══
  const run = async (argv, {env = ENV, db, auth = authFor()} = {}) => {
    const outs = [];
    const errs = [];
    const code = await main(argv, {env, now: () => NOW, db, auth, out: (s) => outs.push(s), err: (s) => errs.push(s)});
    return {code, outs, errs};
  };
  const secretIn = (...texts) => texts.some((t) => t && (t.includes(SECRET_EMAIL) || t.includes(SECRET_UID) || t.includes('owner.s21') || t.includes('SECRET-FCM') || t.includes('SECRET-NAME') || t.includes('SECRET-PHONE')));
  const userDocFull = {
    // الحقول العشرة
    plan: 'shop_pro', scansRemaining: 136, scansTotal: 200, isActive: true, expiresAt: ts(NOW - 90 * 60 * 1000),
    subExpiredNotified: false, subExpiryEmailSent: true, subExpiryFcmDate: '2026-10-12', freeTrialUsedDevices: ['m1_14_8', 'm2_13_6'],
    // وما ليس منها: يجب ألّا يظهر اسمه ولا قيمته
    email: SECRET_EMAIL, fcmToken: 'SECRET-FCM-TOKEN-123', name: 'SECRET-NAME', phone: 'SECRET-PHONE', evaluationEnabled: true, displayName: 'SECRET-NAME', shopSlug: 'secret-shop',
  };
  {
    const outPath = nextOut();
    const db = makeMemDb({users: {[SECRET_UID]: userDocFull}});
    const r = await run(['--out', outPath], {db});
    eq(r.code, 0, '[٧] النجاح: 0');
    const text = r.outs.join('\n');
    const j = JSON.parse(text);
    eq(Object.keys(j)[0], 'projectId', '[٧] projectId أوّل حقل');
    eq(j.projectId, 'neuralchek-9b6d7', '[٧] projectId المثبَّت');
    eq(j.mode, 'subscription-state', '[٧] mode');
    eq(j.account.accountHash, C.hashIdForLog(SECRET_UID), '[٧] المعرّف مُهشَّر = hashIdForLog(uid)');
    deq(Object.keys(j.fields), [...S.FIELDS], '[٧][الأهمّ] الحقول المطبوعة هي القائمة البيضاء وحدها وبترتيبها');
    eq(j.fields.scansRemaining.value, 136, '[٧] scansRemaining=136');
    eq(j.fields.expiresAt.plus03, S.toPlus03(NOW - 90 * 60 * 1000), '[٧] expiresAt بـ+03');
    eq(j.fields.freeTrialUsedDevices.length, 2, '[٧] عدد الأجهزة لا أسماؤها');
    eq(j.gate.verdict, 'SUBSCRIPTION_EXPIRED', '[٧] حكم البوّابة');
    eq(j.cron.zeroing.matchesNow, true, '[٧] مطابقة المهمّة');
    ok(!secretIn(text, r.errs.join('\n')), '[٧] لا بريد ولا uid ولا رمز FCM ولا اسم ولا هاتف في stdout ولا stderr');
    for (const k of ['email', 'fcmToken', 'phone', 'displayName', 'evaluationEnabled', 'shopSlug', 'name']) ok(!text.includes(`"${k}":`), `[٧] لا مفتاح JSON خارج القائمة في المخرَج: ${k}`);
    ok(!text.includes('secret-shop'), '[٧] ولا قيمة حقل خارج القائمة');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٧] الملفّ UTF-8 بلا BOM');
    eq(bytes.toString('utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٧] الملفّ = المطبوع');
    deq(db.writeAttempts, [], '[٧] لا كتابة Firestore');
    deq(db.reads, [`doc:users/${SECRET_UID}`], '[٧][الأهمّ] قراءة واحدة: مستند المستخدم نفسه (لا استعلام ولا مجموعة أخرى)');
    const again = await run(['--out', outPath], {db});
    eq(again.code, 2, '[٧] ملفّ موجود: لا استبدال (2)');
    ok(again.errs.some((e) => /OUT_EXISTS/.test(e)), '[٧] السبب OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), `${JSON.stringify(j, null, 2)}\n`, '[٧] والملفّ القائم لم يُمسّ');
  }
  {
    // بلا --out: يُطبَع فقط، ولا ملفّ
    const db = makeMemDb({users: {[SECRET_UID]: {scansRemaining: 5, plan: 'single', isActive: true}}});
    const r = await run([], {db});
    eq(r.code, 0, '[٧] بلا --out: 0');
    ok(/no file written/.test(r.errs.join('\n')), '[٧] والسطر على stderr يقول لا ملفّ');
    eq(JSON.parse(r.outs.join('\n')).gate.verdict, 'PASSES_BALANCE_AND_EXPIRY', '[٧] expiresAt غائب ⟵ يمرّ');
  }
  {
    const db = makeMemDb({users: {}});
    const r = await run([], {db});
    eq(r.code, 0, '[٧] مستند مستخدم غائب: 0 (حالة لا خطأ)');
    const j = JSON.parse(r.outs.join('\n'));
    eq(j.account.userDocExists, false, '[٧] userDocExists=false صريحة');
    eq(j.fields.scansRemaining.type, 'absent', '[٧] وكل الحقول غائبة (لا قيمة افتراضية)');
    eq(j.gate.verdict, 'NO_CREDIT (users doc missing)', '[٧] والحكم NO_CREDIT');
  }
  {
    const noEnv = await run([], {env: {}, db: makeMemDb({users: {}})});
    eq(noEnv.code, 2, '[٧] بلا متغيّر البيئة: 2');
    ok(noEnv.errs.some((e) => /OWNER_EMAIL_ENV_MISSING/.test(e)), '[٧] OWNER_EMAIL_ENV_MISSING');
    const invalid = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'not-an-email'}, db: makeMemDb({users: {}})});
    ok(invalid.errs.some((e) => /OWNER_EMAIL_INVALID/.test(e)) && !invalid.errs.join('\n').includes('not-an-email'), '[٧] OWNER_EMAIL_INVALID ولا يُطبَع ما كُتب');
    const notFound = await run([], {env: {[C.OWNER_EMAIL_ENV]: 'other@example.test'}, db: makeMemDb({users: {}})});
    eq(notFound.code, 2, '[٧] حساب غير موجود: 2');
    ok(notFound.errs.some((e) => /OWNER_ACCOUNT_NOT_FOUND \(code=auth\/user-not-found\)/.test(e)), '[٧] OWNER_ACCOUNT_NOT_FOUND');
    ok(!notFound.errs.join('\n').includes('other@example.test'), '[٧] نصّ خطأ المزوّد (يحمل البريد) لا يُطبَع (القاعدة 36)');
    const pf = await run(['--preflight'], {env: {}});
    eq(pf.code, 0, '[٧] --preflight: 0 بلا شبكة');
    eq(JSON.parse(pf.outs.join('\n')).network, false, '[٧] --preflight يعلن network=false');
    const writeDb = makeMemDb({users: {[SECRET_UID]: {}}});
    // الغلاف: أيّ كتابة عبر db المغلَّف ترمي TRAP
    let trap = null;
    try { C.wrapReadOnly(writeDb).collection('users').doc(SECRET_UID).update({a: 1}); } catch (e) { trap = e; }
    ok(trap && /TRAP: write operation "doc.update"/.test(trap.message), '[٧] wrapReadOnly يرمي TRAP عند كتابة');
  }

  // ═══ ٨ — الحارس الساكن للقراءة فقط وطفراته ═══
  const FORBIDDEN = Object.freeze({
    FIRESTORE_WRITE: /\.(?:set|update|create|delete)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\.recursiveDelete\(|FieldValue|\.commit\(/,
    DISK_WRITE: /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|copyFile(?:Sync)?|renameSync|unlink(?:Sync)?|rmSync|rmdir(?:Sync)?|mkdir(?:Sync)?|mkdtemp(?:Sync)?|truncate(?:Sync)?|symlink(?:Sync)?|cpSync|openSync|writeSync)\b/,
    NETWORK: /\b(?:fetch|XMLHttpRequest|axios|WebSocket)\s*\(|\b(?:https?|http2|net|tls|dns|dgram)\.(?:request|get|connect|createConnection|lookup|resolve)\b|require\(\s*['"](?:https?|http2|net|tls|dns|dgram|node-fetch|axios)['"]\s*\)/,
    EMAIL_OUTPUT: /\$\{\s*email\s*\}|\b(?:out|err|console\.\w+)\(\s*email\b|JSON\.stringify\(\s*email\b|\bemail\s*:\s*email\b|\bowner_email\b/,
    AUTH_WRITE: /\b(?:createUser|updateUser|deleteUser|setCustomUserClaims|revokeRefreshTokens|generate\w*Link|importUsers|deleteUsers|createCustomToken)\b/,
  });
  const staticViolations = (kind, raw) => {
    const src = stripComments(raw.replace(/\r\n/g, '\n'));
    const v = new Set();
    for (const [name, re] of Object.entries(FORBIDDEN)) if (re.test(src)) v.add(`STATIC:${name}`);
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\.add\(/g)) if (m[1] !== 'out') v.add('STATIC:FIRESTORE_WRITE');
    if (kind === 'script') {
      if (!/C\.wrapReadOnly\(/.test(src)) v.add('STATIC:NO_WRAP_READ_ONLY_DB');
      if (!/C\.assertOutWritable\(/.test(src)) v.add('STATIC:NO_OUT_PRECHECK');
      if (!/C\.writeOutputExclusive\(/.test(src)) v.add('STATIC:NO_EXCLUSIVE_OUTPUT_WRITER');
      if ((src.match(/process\.argv/g) || []).length !== 1) v.add('STATIC:ARGV_READ_OUTSIDE_ENTRY');
    }
    return [...v].sort();
  };
  const scriptSrc = read('scripts/subscription-state-readonly.js');
  const libSrc = read('scripts/lib/subscriptionState.js');
  deq(staticViolations('script', scriptSrc), [], '[٨] السكربت: بلا كتابة ولا شبكة ولا طباعة بريد');
  deq(staticViolations('lib', libSrc), [], '[٨] المكتبة: بلا كتابة ولا شبكة ولا طباعة بريد');
  const mutateStatic = (kind, src, extra) => staticViolations(kind, `${src}\n${extra}\n`);
  ok(mutateStatic('lib', libSrc, "db.collection('users').doc('x').update({scansRemaining: 0});").includes('STATIC:FIRESTORE_WRITE'), '[٨] طفرة: كتابة Firestore ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('fs').writeFileSync('x', 'y');").includes('STATIC:DISK_WRITE'), '[٨] طفرة: كتابة ملفّ ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, 'out(`owner ${email}`);').includes('STATIC:EMAIL_OUTPUT'), '[٨] طفرة: طباعة البريد ⟵ تُكشَف');
  ok(mutateStatic('lib', libSrc, "require('https').request('x');").includes('STATIC:NETWORK'), '[٨] طفرة: شبكة ⟵ تُكشَف');
  ok(mutateStatic('script', scriptSrc, "const z = process.argv[2];").includes('STATIC:ARGV_READ_OUTSIDE_ENTRY'), '[٨] طفرة: قراءة process.argv ثانية ⟵ تُكشَف');
  ok(staticViolations('script', scriptSrc.replace('C.wrapReadOnly(', 'identity(')).includes('STATIC:NO_WRAP_READ_ONLY_DB'), '[٨] طفرة: إزالة wrapReadOnly ⟵ تُكشَف');

  console.log(`subscriptionState.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
