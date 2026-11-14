'use strict';

// countActiveSessionsReadonly.test.js — سكربت count-active-sessions-readonly.js ومكتبته scripts/lib/activeSessions.js (قبل نشر الأمان، 2026-10-09 +03).
// وحدة بلا شبكة ولا محاكٍ؛ والمسار الحقيقي على المحاكي: countActiveSessionsReadonly.e2e.test.js.
//
// قرار المستخدم (القاعدة 1 الجديدة في CLAUDE.md، بنصّها): «"جلسة جارية" تُثبَت بالأداة لا بالذاكرة: كتلة قراءة قبل كل نشر تعدّ جلسات pending/scanning
// المنشأة في آخر ساعتين، وأقفال scanClaims الحديثة، والنشر يتوقّف إن لم يكن الناتج صفراً.» «والجلستان العالقتان القديمتان خارج الحدّ.»
//   ٠ — الحالات (الدفعة ٩، 2026-10-10 +03): قرار المنسّق في الأمر، بنصّه: «`cancelled` و`expired` لا يُعدّان جاريين. وكل حالة لا تعرفها الأداة تُعلن صراحةً (القاعدة 22)،
//       ولا تُعدّ «لا تمنع» بصمت.» — جدول تصنيف الحالة، والحكم، والجرد على db مزيَّف بحالات نهائية وغير معروفة.
//   ١ — المعيار: جدول حالات الجلسة والقفل (على الحدّ، الأقدم، الغائب، غير المقروء، المستقبلي).
//   ٢ — الحكم: ما يمنع وما لا يمنع.   ٣ — الوسائط.   ٤ — الجرد على db مزيَّف: أعداد وحدها، ولا معرّف ولا رمز في المخرَج.
//   ٥ — main: رموز الخروج 0/3/2، وwrapReadOnly (لا كتابة)، و--preflight بلا شبكة.   ٦ — بنية الشيفرة: لا كتابة، projectId مثبَّت.
//
// Run: node functions/test/countActiveSessionsReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {Timestamp} = require('@google-cloud/firestore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const L = require('../scripts/lib/activeSessions');
const {main} = require('../scripts/count-active-sessions-readonly');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {makeMemDb} = require('./lib/memFirestore');

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const W = L.SESSIONS_WINDOW_MIN * MIN;
const ts = (agoMs) => Timestamp.fromMillis(NOW - agoMs);

(async () => {
  // ═══ ٠ — الحالات ═══
  const K = L.STATUS_KIND;
  const kindOf = (status) => L.classifySessionStatus({status});
  deq([...L.TERMINAL_STATUSES], ['completed', 'expired', 'cancelled'], '[٠] النهائية المعروفة: completed وexpired وcancelled (المصدر الواحد sessionNames.js)');
  for (const st of ['pending', 'scanning']) deq(kindOf(st), {kind: K.ACTIVE, status: st}, `[٠] ${st}: جارية`);
  for (const st of ['completed', 'expired', 'cancelled']) deq(kindOf(st), {kind: K.TERMINAL, status: st}, `[٠] ${st}: نهائية لا جارية`);
  deq(L.classifySessionStatus({}), {kind: K.STATUS_ABSENT}, '[٠] status غائب: STATUS_ABSENT');
  deq(kindOf(null), {kind: K.STATUS_ABSENT}, '[٠] status null: STATUS_ABSENT');
  deq(L.classifySessionStatus(null), {kind: K.STATUS_ABSENT}, '[٠] بيانات غائبة: STATUS_ABSENT');
  deq(kindOf(7), {kind: K.STATUS_UNREADABLE}, '[٠] status رقم: STATUS_UNREADABLE');
  deq(kindOf({a: 1}), {kind: K.STATUS_UNREADABLE}, '[٠] status خريطة: STATUS_UNREADABLE');
  deq(kindOf('done'), {kind: K.STATUS_UNKNOWN, name: 'done'}, '[٠] done: STATUS_UNKNOWN باسمه');
  deq(kindOf('Cancelled'), {kind: K.STATUS_UNKNOWN, name: L.UNPRINTABLE_STATUS_KEY}, '[٠] Cancelled بأحرف كبيرة: غير معروفة (لا تطبيع صامت) ولا يُطبَع اسمها (ليس snake_case)');
  deq(kindOf('weird_status'), {kind: K.STATUS_UNKNOWN, name: 'weird_status'}, '[٠] snake_case قصير: يُطبَع');
  deq(kindOf('NC-ABC123'), {kind: K.STATUS_UNKNOWN, name: L.UNPRINTABLE_STATUS_KEY}, '[٠] ما يشبه رمز جلسة: لا يُطبَع');
  deq(kindOf('x'.repeat(40)), {kind: K.STATUS_UNKNOWN, name: L.UNPRINTABLE_STATUS_KEY}, '[٠] اسم أطول من 32: لا يُطبَع');
  deq(kindOf(''), {kind: K.STATUS_UNKNOWN, name: L.UNPRINTABLE_STATUS_KEY}, '[٠] نصّ فارغ: غير معروفة');

  // ═══ ١ — المعيار ═══
  eq(L.SESSIONS_WINDOW_MIN, 120, '[١] نافذة الجلسات 120 دقيقة (رقم القرار: آخر ساعتين)');
  eq(L.CLAIMS_WINDOW_MIN_DEFAULT, 120, '[١] نافذة الأقفال الافتراضية 120 (مؤقّتة)');
  deq([...L.ACTIVE_STATUSES], ['pending', 'scanning'], '[١] الحالتان الجاريتان');
  const S = L.SESSION_STATE;
  const sess = (createdAt) => L.classifySession({data: {createdAt}, nowMs: NOW, windowMs: W}).state;
  eq(sess(ts(5 * MIN)), S.IN_WINDOW, '[١] قبل 5 دقائق: داخل');
  eq(sess(ts(W)), S.IN_WINDOW, '[١] على الحدّ تماماً: داخل (العمر ≤ النافذة)');
  eq(sess(ts(W + 1)), S.OLDER_THAN_WINDOW, '[١] بعد الحدّ بمللي ثانية: خارج');
  eq(sess(ts(3 * 3600 * 1000)), S.OLDER_THAN_WINDOW, '[١] قبل ثلاث ساعات (العالقة القديمة): خارج');
  eq(sess(Timestamp.fromMillis(NOW + 60_000)), S.IN_WINDOW, '[١] مستقبلي (عطب ساعة): داخل لا خارج');
  eq(sess(undefined), S.CREATED_AT_ABSENT, '[١] غائب: CREATED_AT_ABSENT');
  eq(sess(null), S.CREATED_AT_ABSENT, '[١] null: CREATED_AT_ABSENT');
  eq(sess('2026-10-09T10:00:00Z'), S.CREATED_AT_UNREADABLE, '[١] نصّ: CREATED_AT_UNREADABLE');
  eq(sess(NOW), S.CREATED_AT_UNREADABLE, '[١] رقم: CREATED_AT_UNREADABLE (لا تخمين وحدته)');
  eq(sess({seconds: 1}), S.CREATED_AT_UNREADABLE, '[١] كائن بلا toMillis: CREATED_AT_UNREADABLE');
  eq(sess(new Date(NOW - MIN)), S.IN_WINDOW, '[١] Date يُقرأ');
  eq(sess(new Date('invalid')), S.CREATED_AT_UNREADABLE, '[١] Date غير صالح: CREATED_AT_UNREADABLE');
  eq(L.classifySession({data: null, nowMs: NOW, windowMs: W}).state, S.CREATED_AT_ABSENT, '[١] بيانات غائبة: CREATED_AT_ABSENT');
  const C = L.CLAIM_STATE;
  const claim = (claimedAtMs, reservation, windowMin = 30) => L.classifyClaim({data: {claimedAtMs, reservation}, nowMs: NOW, windowMs: windowMin * MIN});
  deq(claim(NOW - 10 * MIN, {userId: 'u'}), {state: C.IN_WINDOW, hasReservation: true}, '[١] قفل حديث بحجز: داخل ومعه الحجز');
  deq(claim(NOW - 10 * MIN, null), {state: C.IN_WINDOW, hasReservation: false}, '[١] قفل حديث بلا حجز (null)');
  eq(claim(NOW - 10 * MIN, undefined).hasReservation, false, '[١] reservation غائب: بلا حجز');
  eq(claim(NOW - 30 * MIN, null).state, C.IN_WINDOW, '[١] قفل على حدّ النافذة تماماً: داخل');
  eq(claim(NOW - 30 * MIN - 1, null).state, C.OLDER_THAN_WINDOW, '[١] بعد الحدّ بمللي ثانية: خارج');
  eq(claim(NOW - 31 * MIN, {userId: 'u'}).state, C.OLDER_THAN_WINDOW, '[١] قفل قديم بحجز: خارج (العالق تعدّه سكربتات أخرى)');
  eq(claim(NOW - 31 * MIN, {userId: 'u'}, 45).state, C.IN_WINDOW, '[١] والنافذة 45 تُدخله');
  eq(claim(undefined, null).state, C.CLAIMED_AT_ABSENT, '[١] claimedAtMs غائب: CLAIMED_AT_ABSENT');
  eq(claim(null, null).state, C.CLAIMED_AT_ABSENT, '[١] claimedAtMs null: CLAIMED_AT_ABSENT');
  eq(claim('x', null).state, C.CLAIMED_AT_UNREADABLE, '[١] claimedAtMs نصّ: CLAIMED_AT_UNREADABLE');
  eq(claim(NaN, null).state, C.CLAIMED_AT_UNREADABLE, '[١] claimedAtMs NaN: CLAIMED_AT_UNREADABLE');
  eq(claim(Timestamp.fromMillis(NOW), null).state, C.CLAIMED_AT_UNREADABLE, '[١] claimedAtMs بصيغة Timestamp (ليس رقماً): CLAIMED_AT_UNREADABLE');
  eq(L.classifyClaim({data: null, nowMs: NOW, windowMs: W}).state, C.CLAIMED_AT_ABSENT, '[١] بيانات غائبة: CLAIMED_AT_ABSENT');

  // ═══ ٢ — الحكم ═══
  const zeroSessions = () => ({
    byStatus: Object.fromEntries(L.ACTIVE_STATUSES.map((s) => [s, Object.fromEntries([['total', 0], ...Object.values(S).map((x) => [x, 0])])])),
    terminal: Object.fromEntries(L.TERMINAL_STATUSES.map((s) => [s, 0])),
    unclassified: {statusAbsent: 0, statusUnreadable: 0, statusUnknown: 0, unknownNames: {}},
  });
  const zeroClaims = () => ({total: 0, inWindow: 0, inWindowWithReservation: 0, OLDER_THAN_WINDOW: 0, CLAIMED_AT_ABSENT: 0, CLAIMED_AT_UNREADABLE: 0});
  const verdictFor = (mut) => { const c = {sessions: zeroSessions(), claims: zeroClaims()}; mut(c); return L.verdictOf(c); };
  eq(verdictFor(() => {}).blocksDeploy, false, '[٢] كل شيء صفر: لا يمنع');
  eq(verdictFor((c) => { c.sessions.byStatus.pending.OLDER_THAN_WINDOW = 2; c.claims.OLDER_THAN_WINDOW = 5; c.claims.total = 5; }).blocksDeploy, false, '[٢] الأقدم من النافذة وحده لا يمنع (الجلستان العالقتان القديمتان)');
  deq(verdictFor((c) => { c.sessions.byStatus.pending.IN_WINDOW = 1; }).reasons, ['sessionsInWindow=1'], '[٢] جلسة pending في النافذة تمنع');
  deq(verdictFor((c) => { c.sessions.byStatus.scanning.IN_WINDOW = 2; c.sessions.byStatus.pending.IN_WINDOW = 1; }).blockingCounts.sessionsInWindow, 3, '[٢] والعدّ مجموع الحالتين');
  deq(verdictFor((c) => { c.sessions.byStatus.scanning.CREATED_AT_ABSENT = 1; }).reasons, ['sessionsCreatedAtAbsent=1'], '[٢] جلسة بلا createdAt تُعدّ مستقلّة وتمنع');
  deq(verdictFor((c) => { c.sessions.byStatus.pending.CREATED_AT_UNREADABLE = 1; }).reasons, ['sessionsCreatedAtUnreadable=1'], '[٢] وغير مقروءة كذلك');
  deq(verdictFor((c) => { c.claims.inWindow = 1; c.claims.inWindowWithReservation = 1; }).reasons, ['claimsInWindow=1'], '[٢] قفل حديث يمنع (والحجز جزء منه لا يُجمع مرّتين)');
  deq(verdictFor((c) => { c.claims.CLAIMED_AT_ABSENT = 1; }).reasons, ['claimsClaimedAtAbsent=1'], '[٢] قفل بلا claimedAtMs يمنع');
  deq(verdictFor((c) => { c.claims.CLAIMED_AT_UNREADABLE = 2; }).reasons, ['claimsClaimedAtUnreadable=2'], '[٢] وغير مقروء كذلك');
  eq(verdictFor((c) => { c.sessions.terminal.cancelled = 5; c.sessions.terminal.expired = 4; c.sessions.terminal.completed = 9; }).blocksDeploy, false, '[٢] cancelled وexpired وcompleted وحدها لا تمنع (ليست جارية)');
  deq(verdictFor((c) => { c.sessions.unclassified.statusAbsent = 1; }).reasons, ['sessionsStatusAbsent=1'], '[٢] جلسة بلا status تُعدّ مستقلّة وتمنع (لا «لا تمنع» بصمت)');
  deq(verdictFor((c) => { c.sessions.unclassified.statusUnreadable = 2; }).reasons, ['sessionsStatusUnreadable=2'], '[٢] وstatus غير نصّي يمنع');
  deq(verdictFor((c) => { c.sessions.unclassified.statusUnknown = 3; c.sessions.unclassified.unknownNames = {done: 3}; }).reasons, ['sessionsStatusUnknown=3'], '[٢] وحالة لا تعرفها الأداة تمنع');
  deq(Object.keys(verdictFor(() => {}).blockingCounts), ['sessionsInWindow', 'sessionsCreatedAtAbsent', 'sessionsCreatedAtUnreadable', 'sessionsStatusAbsent', 'sessionsStatusUnreadable', 'sessionsStatusUnknown', 'claimsInWindow', 'claimsClaimedAtAbsent', 'claimsClaimedAtUnreadable'], '[٢] الأعداد المانعة بأسمائها: الحالات الثلاث الجديدة معلَنة');
  let missing = null;
  try { L.verdictOf({sessions: {byStatus: zeroSessions().byStatus}, claims: zeroClaims()}); } catch (e) { missing = e; }
  ok(missing && /unclassified/.test(missing.message), '[٢] جرد بلا sessions.unclassified يُرمى (لا يُقرأ غير المصنَّف صفراً)');

  // ═══ ٣ — الوسائط ═══
  const pa = L.parseArgs;
  deq(pa([]), {preflight: false, claimsWindowMin: 120, claimsWindowIsDefault: true}, '[٣] بلا وسائط: الافتراضي (مؤقّت)');
  eq(pa(['--preflight']).preflight, true, '[٣] --preflight');
  deq(pa(['--claims-window-min', '45']), {preflight: false, claimsWindowMin: 45, claimsWindowIsDefault: false}, '[٣] --claims-window-min 45');
  eq(pa(['--claims-window-min', '2.5']).claimsWindowMin, 2.5, '[٣] رقم كسري مقبول');
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
  bad(['--claims-window-min'], /يحتاج قيمة/, '[٣] --claims-window-min بلا قيمة');
  bad(['--claims-window-min', '--preflight'], /يحتاج قيمة/, '[٣] وقيمته وسيط آخر');
  bad(['--claims-window-min', 'abc'], /رقماً موجباً/, '[٣] نصّ');
  bad(['--claims-window-min', '-5'], /رقماً موجباً/, '[٣] سالب');
  bad(['--claims-window-min', '0'], /خارج المدى/, '[٣] صفر');
  bad(['--claims-window-min', '100000'], /خارج المدى/, '[٣] فوق الأسبوع');
  bad(['--force'], /وسيط مجهول --force/, '[٣] وسيط مجهول');
  bad(['x'], /وسيط مجهول \(موضعي\)/, '[٣] وسيط موضعي');

  // ═══ ٤ — الجرد على db مزيَّف: أعداد وحدها ═══
  const SECRET_CODE = 'NC-SECRETCODE9';
  const SECRET_OWNER = 'owner-uid-SECRET-1';
  const collections = {
    scanSessions: {
      'sess-in-pending': {status: 'pending', createdAt: ts(10 * MIN), code: SECRET_CODE, ownerId: SECRET_OWNER},
      'sess-in-scanning': {status: 'scanning', createdAt: ts(60 * MIN), code: 'NC-AAAAAA', ownerId: SECRET_OWNER},
      'sess-old-1': {status: 'pending', createdAt: ts(5 * 3600_000), code: 'NC-OLD001', ownerId: SECRET_OWNER},
      'sess-old-2': {status: 'scanning', createdAt: ts(W + 1), code: 'NC-OLD002', ownerId: SECRET_OWNER},
      'sess-nocreated': {status: 'pending', code: 'NC-NOCR01', ownerId: SECRET_OWNER},
      'sess-badcreated': {status: 'scanning', createdAt: 'yesterday', code: 'NC-BADCR1', ownerId: SECRET_OWNER},
      'sess-completed': {status: 'completed', createdAt: ts(MIN), code: 'NC-DONE01', ownerId: SECRET_OWNER},
      'sess-expired': {status: 'expired', createdAt: ts(MIN), code: 'NC-EXP001', ownerId: SECRET_OWNER},
      // الدفعة ٩: «ملغاة» نهائية لا جارية، وحالات لا تعرفها الأداة تُعلَن ولا تُعدّ «لا تمنع» بصمت
      'sess-cancelled': {status: 'cancelled', createdAt: ts(MIN), code: 'NC-CAN001', ownerId: SECRET_OWNER, cancelReason: 'left_by_customer'},
      'sess-unknown-done': {status: 'done', createdAt: ts(MIN), code: 'NC-UNK001', ownerId: SECRET_OWNER},
      'sess-unknown-case': {status: 'Cancelled', createdAt: ts(MIN), code: 'NC-UNK002', ownerId: SECRET_OWNER},
      'sess-nostatus': {createdAt: ts(MIN), code: 'NC-NOS001', ownerId: SECRET_OWNER},
      'sess-numstatus': {status: 12, createdAt: ts(MIN), code: 'NC-NUM001', ownerId: SECRET_OWNER},
    },
    scanClaims: {
      'claim-recent-res': {claimedAtMs: NOW - 5 * MIN, reservation: {userId: SECRET_OWNER, reservedAtMs: NOW - 5 * MIN}},
      'claim-recent-nores': {claimedAtMs: NOW - 20 * MIN, reservation: null},
      'claim-old-res': {claimedAtMs: NOW - 3 * 3600_000, reservation: {userId: SECRET_OWNER, reservedAtMs: NOW - 3 * 3600_000}},
      'claim-noclaimed': {reservation: null},
      'claim-badclaimed': {claimedAtMs: 'x', reservation: null},
    },
  };
  const db = makeMemDb(collections);
  const collected = await L.collectActive({db, nowMs: NOW, claimsWindowMin: 30, pageSize: 2});
  deq(collected.sessions.byStatus.pending, {total: 3, IN_WINDOW: 1, OLDER_THAN_WINDOW: 1, CREATED_AT_ABSENT: 1, CREATED_AT_UNREADABLE: 0}, '[٤] pending: واحدة داخل، وقديمة، وبلا createdAt');
  deq(collected.sessions.byStatus.scanning, {total: 3, IN_WINDOW: 1, OLDER_THAN_WINDOW: 1, CREATED_AT_ABSENT: 0, CREATED_AT_UNREADABLE: 1}, '[٤] scanning: واحدة داخل، وقديمة، وغير مقروءة');
  eq(collected.sessions.byStatus.pending.total + collected.sessions.byStatus.scanning.total, 6, '[٤] completed وexpired وcancelled لا تدخل الجرد الجاري (ليست جارية)');
  deq(collected.sessions.terminal, {completed: 1, expired: 1, cancelled: 1}, '[٤] وتُعدّ في terminal وحدها: واحدة لكلّ حالة نهائية');
  deq(collected.sessions.unclassified, {statusAbsent: 1, statusUnreadable: 1, statusUnknown: 2, unknownNames: {done: 1, [L.UNPRINTABLE_STATUS_KEY]: 1}},
      '[٤] والحالات غير المصنَّفة معلَنة: غائبة واحدة، وغير نصّية واحدة، ومجهولتان (done باسمها، وCancelled بأحرف كبيرة غير مطبوعة الاسم)');
  deq(collected.claims, {total: 5, inWindow: 2, inWindowWithReservation: 1, OLDER_THAN_WINDOW: 1, CLAIMED_AT_ABSENT: 1, CLAIMED_AT_UNREADABLE: 1}, '[٤] الأقفال بنافذة 30: اثنان داخل (منهما واحد بحجز)، وقديم، وغائب، وغير مقروء');
  const wide = await L.collectActive({db, nowMs: NOW, claimsWindowMin: 600, pageSize: 2});
  eq(wide.claims.inWindow, 3, '[٤] والنافذة 600 تُدخل القفل القديم (3 ساعات)');
  eq(wide.claims.inWindowWithReservation, 2, '[٤] ويصير بحجز اثنين');
  const summary = L.summarize(collected, {claimsWindowMin: 30, claimsWindowIsDefault: false});
  eq(summary.verdict.blocksDeploy, true, '[٤] الحكم: يمنع');
  deq([summary.verdict.blockingCounts.sessionsStatusAbsent, summary.verdict.blockingCounts.sessionsStatusUnreadable, summary.verdict.blockingCounts.sessionsStatusUnknown], [1, 1, 2],
      '[٤] والحالات غير المصنَّفة في الأعداد المانعة (بأسمائها)');
  ok(summary.verdict.reasons.includes('sessionsStatusUnknown=2'), '[٤] وفي أسباب المنع');
  deq(summary.criteria.sessions.terminalStatuses, ['completed', 'expired', 'cancelled'], '[٤] والمعيار المطبوع يذكر النهائية');
  ok(/تمنع/.test(summary.criteria.sessions.statusRule) && /القاعدة 22/.test(summary.criteria.sessions.statusRule), '[٤] وقاعدة الحالات (لا «لا تمنع» بصمت) مكتوبة في المعيار');
  // جرد نهائيّ وحدها: لا يمنع (ملغاة ومنتهية ومكتملة فقط)
  const terminalOnlyDb = makeMemDb({scanSessions: {a: {status: 'cancelled', createdAt: ts(MIN)}, b: {status: 'expired', createdAt: ts(MIN)}, c: {status: 'completed', createdAt: ts(MIN)}, d: {status: 'cancelled', createdAt: ts(5 * W)}}, scanClaims: {}});
  const terminalOnly = await L.collectActive({db: terminalOnlyDb, nowMs: NOW, claimsWindowMin: 30});
  deq(terminalOnly.sessions.terminal, {completed: 1, expired: 1, cancelled: 2}, '[٤] جرد ملغاة ومنتهية ومكتملة فقط: تُعدّ في terminal');
  eq(L.verdictOf(terminalOnly).blocksDeploy, false, '[٤] ولا تمنع النشر ولو كانت حديثة (ليست جارية)');
  // القراءة بحقلين: الجرد يطلب status وcreatedAt وحدهما
  eq(terminalOnlyDb.reads.filter((r) => r === 'query:scanSessions').length >= 1, true, '[٤] والجرد قرأ الجلسات باستعلام واحد أو أكثر (كلّها لا pending وscanning بعينهما)');
  const text = JSON.stringify(summary);
  ok(![SECRET_CODE, SECRET_OWNER, 'sess-in-pending', 'claim-recent-res', 'NC-AAAAAA', 'NC-OLD001'].some((v) => text.includes(v)), '[٤] المخرَج لا يحمل معرّفاً ولا رمز جلسة ولا معرّف مستخدم (ولا مهشَّراً)');
  ok(!/#[0-9a-f]{12}/.test(text), '[٤] ولا قيمة مُهشَّرة أصلاً (أعداد وحدها)');
  eq(summary.criteria.claims.windowIsDefault, false, '[٤] والمعيار يقول إن النافذة مُمرَّرة');
  eq(L.summarize(collected, {claimsWindowMin: 120, claimsWindowIsDefault: true}).criteria.claims.note.includes('مؤقّت'), true, '[٤] والافتراضي موسوم مؤقّتاً');
  eq(db.writeAttempts.length, 0, '[٤] الجرد لم يحاول كتابة');

  // ═══ ٥ — main ═══
  const run = async (argv, over = {}) => {
    const outs = [];
    const errs = [];
    const mem = over.db || makeMemDb(over.collections || {scanSessions: {}, scanClaims: {}});
    const code = await main(argv, {now: () => NOW, out: (s) => outs.push(s), err: (s) => errs.push(s), db: mem});
    return {code, outs, errs, mem, json: outs.length === 1 && outs[0].startsWith('{') ? JSON.parse(outs[0]) : null};
  };
  let r = await run([]);
  eq(r.code, 0, '[٥] لا شيء جارٍ: رمز 0');
  eq(r.json.projectId, PROJECT_ID, '[٥] projectId مثبَّت');
  eq(Object.keys(r.json)[0], 'projectId', '[٥] وهو أوّل حقل');
  eq(r.json.verdict.blocksDeploy, false, '[٥] الحكم لا يمنع');
  ok(/target=PRODUCTION|target=EMULATOR/.test(r.errs[0]) && /read-only/.test(r.errs[0]), '[٥] أوّل سطر على stderr يذكر الهدف وأنه قراءة فقط');
  eq(r.mem.writeAttempts.length, 0, '[٥] بلا محاولة كتابة');
  r = await run([], {collections});
  eq(r.code, 3, '[٥] ثمّة ما يمنع: رمز 3');
  eq(r.json.claims.inWindow, 2, '[٥] النافذة الافتراضية 120: قفلان داخل (والقفل القديم ذو الـ3 ساعات خارج)');
  eq(r.json.criteria.claims.windowIsDefault, true, '[٥] والمعيار المطبوع يقول إنها الافتراضية المؤقّتة');
  r = await run(['--claims-window-min', '30'], {collections});
  eq(r.json.claims.inWindow, 2, '[٥] --claims-window-min 30: قفلان داخل');
  eq(r.json.criteria.claims.claimedAtMsWithinMinutes, 30, '[٥] والمعيار المطبوع 30');
  r = await run(['--claims-window-min', 'abc']);
  eq(r.code, 2, '[٥] وسيط غير مقروء: رمز 2');
  ok(r.outs.length === 0 && /USAGE/.test(r.errs[0]), '[٥] بلا مخرَج ورسالة استعمال');
  r = await run(['--bogus']);
  eq(r.code, 2, '[٥] وسيط مجهول: رمز 2');
  r = await run(['--preflight']);
  eq(r.code, 0, '[٥] --preflight: رمز 0');
  ok(r.json.network === false && r.json.ok === true && r.json.checks.length >= 20 && r.json.checks.every((c) => c.ok), '[٥] --preflight: بلا شبكة وكل فحوصه ناجحة');
  eq(r.mem.reads.length, 0, '[٥] --preflight لم يقرأ شيئاً من db');
  // wrapReadOnly: لو حاول المسار كتابةً لرمى TRAP — db مزيَّف يُسجِّل ما وصله
  const sneaky = makeMemDb({scanSessions: {}, scanClaims: {}});
  const wrapped = require('../scripts/audit-device-profiles-readonly').wrapReadOnly(sneaky);
  let trapped = null;
  try { wrapped.collection('scanSessions').doc('x').set({a: 1}); } catch (e) { trapped = e; }
  ok(trapped && /TRAP/.test(trapped.message) && sneaky.writeAttempts.length === 0, '[٥] wrapReadOnly يرمي TRAP قبل أيّ كتابة (ولا تصل إلى db)');

  // ═══ ٦ — بنية الشيفرة ═══
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const read = (rel) => strip(fs.readFileSync(path.join(__dirname, '..', 'scripts', rel), 'utf8').replace(/\r\n/g, '\n'));
  const cli = read('count-active-sessions-readonly.js');
  const lib = read('lib/activeSessions.js');
  for (const [name, src] of [['السكربت', cli], ['المكتبة', lib]]) {
    ok(!/\.(set|update|delete|create|add)\(|\.batch\(|runTransaction|bulkWriter|recursiveDelete|writeFile|appendFile|createWriteStream|unlink/.test(src), `[٦] ${name}: لا كتابة (لا set/update/delete/create/add ولا دفعات ولا ملفّات)`);
  }
  ok(/wrapReadOnly\(db\)/.test(cli) && /require\('\.\/audit-device-profiles-readonly'\)/.test(cli), '[٦] السكربت يغلّف db بـwrapReadOnly من المصدر الواحد');
  ok(/initializeApp\(\{projectId: PROJECT_ID\}/.test(cli) && !/initializeApp\(\)/.test(cli), '[٦] projectId مثبَّت في initializeApp');
  eq(PROJECT_ID, 'neuralchek-9b6d7', '[٦] والمثبَّت هو مشروع الإنتاج');
  ok(!/hashIdForLog/.test(lib), '[٦] المكتبة لا تُهشِّر معرّفاً (لا معرّف في مخرَجها أصلاً: أعداد وحدها)');
  ok(!/doc\.id|\.ownerId|\.code\b|reservation\.userId/.test(lib), '[٦] ولا تقرأ معرّف المستند ولا ownerId ولا code ولا userId الحجز');

  console.log(`\ncountActiveSessionsReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
