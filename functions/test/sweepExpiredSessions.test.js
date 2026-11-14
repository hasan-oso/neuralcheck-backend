'use strict';

// sweepExpiredSessions.test.js — الكنس الآمن لجلسات الفاعل المنقضية (S-SWEEP، 2026-10-15 +03). وحدة بلا شبكة ولا محاكٍ.
// الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/sessionFakeDb.js) في هذا الاختبار وحده؛ والطبقة الحقيقية على المحاكي في sweepOnCreateJoin.e2e.test.js.
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-ج. قرار المستخدم (2026-10-15، منقول): «Creating a session sweeps the owner's expired sessions (ownerId). Joining sweeps the joining device's expired
// sessions (joinedBy). Cancel does not sweep … A device that joined without an identity (joinedBy null) is reached only through its owner.» والشكل الآمن: «تُكتب «منتهية» للجلسات التي
// انقضى وقتها فقط، من جلسات الفاعل نفسه. ولا تُلغى جلسة صالحة أبداً.» وE34 بحدّيه: «الانضمام 3 ث، والإنشاء 10 ث» وسطر يُظهر «عدد ما كُنس وزمنه».
//
//   ١ المفردات والثوابت (E33: 20، E34: 10 ث و3 ث ≤ ثلث المهلة، والحالات الخمس بنصّها)
//   ٢ المرشَّحة: جارية معروفة + expiresAt مقروء ومنقضٍ فقط؛ لا صالحة ولا غائبة ولا تالفة ولا نهائية ولا مجهولة؛ استثناء المُشغِّلة؛ ودفاع الوحدة إن أخطأ الاستعلام
//   ٣ المفتاح: مالك مقابل منضمّ؛ joinerUid غائب/null/فارغ/غير نصّ ⟵ لا استعلام (E24)؛ جلستا joinedBy=null تُكنسان بمفتاح المالك (E27)
//   ٤ شكل الاستعلام (E33): مساواتان لكل مفتاح بلا ترتيب ولا حدّ ولا مدى (القاعدة 43)؛ والكتابة status وexpiredAt وحدهما
//   ٥ E32: القفل الحيّ والمجهول العمر يُتخطّيان، والقديم لا (حدّ TTL بالضبط)
//   ٦ E33: السقف 20 (ما كُتب وما رمت معاملته) والأقدم انقضاءً أوّلاً، والباقي لنداء لاحق
//   ٧ E34: ميزانية الزمن (الكتابة، والقراءة العالقة)
//   ٨ READ_FAILED: لا كتابة، والأعداد NOT_RUN، والسطر بالرمز واسم الصنف وحدهما (القاعدة 36)
//   ٩ فشل مرشَّحة: يُعدّ failed ولا يوقف الباقي
//   ١٠ السباق: تتغيّر الجلسة بين الاستعلام والمعاملة (completed تطمس expired — من جهة الكنس)
//   ١١ سطر E34 بنصّه في كل حالة من الخمس (القاعدة 30)، وNOT_RUN لا يُطبع صفراً (القاعدة 22)
//   ١٢ sweepAndLog: سطر واحد بالضبط، ولا يرمي أبداً
//   ١٣ حراس بنيوية: لا حذف ولا cancelled، والتوصيل في createScanSession وjoinScanSession (وغيابه عن الإلغاء وanalyzeDevice وsubmitEvaluation)
//
// Run: node functions/test/sweepExpiredSessions.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const S = require('../src/sessions/sweepExpiredSessions');
const N = require('../src/sessions/sessionNames');
const {SCAN_CLAIM_TTL_MS} = require('../src/analysis/scanReservation');
const {hashIdForLog: h} = require('../src/utils/logRedaction');
const {FieldValue, makeSessionFakeDb, captureConsole} = require('./lib/sessionFakeDb');

const C = N.SWEEP_CALLER;
const NOW = new Date('2026-10-15T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const MIN = 60 * 1000;
const PAST = (m = 30) => new Date(NOW_MS - m * MIN);
const FUTURE = (m = 30) => new Date(NOW_MS + m * MIN);
const tsLike = (d) => ({toDate: () => d, toMillis: () => d.getTime()});
const nowFn = () => NOW_MS;
const sweep = (db, p = {}) => S.sweepExpiredSessions({db, FieldValue, from: C.CREATE_SCAN_SESSION, uid: 'owner-1', excludeSessionId: 'trigger', nowFn, ...p});
// نسخة قابلة للمقارنة: التواريخ وأشباه Timestamp (toDate) نصوصاً ISO، فيُقارَن ما قبل وما بعد بلا اختلاف تمثيل
const deepCopy = (o) => JSON.parse(JSON.stringify(o, (k, v) => ((v && typeof v.toDate === 'function') ? v.toDate().toISOString() : v)));
const idsWritten = (db) => db.writes.map((w) => w.id).sort();
const only = (res) => ({state: res.state, returned: res.returned, candidates: res.candidates, written: res.written, skipped: res.skipped, failed: res.failed});

// مخرَج الكود المُختبَر (سطور السجلّ) يُكتم أثناء التشغيل كي يبقى مخرَج الاختبار سطراً واحداً؛ ما يفحصه الاختبار من سطور يلتقطه captureConsole بنصّه.
const REAL_CONSOLE = {log: console.log, warn: console.warn, error: console.error, info: console.info};
// وعدٌ عالق (لا يُحَلّ ولا يُرفَض) يُنهي Node بالرمز 0 بصمت قبل الأسطر التالية: فالعملية التي تنتهي دون بلوغ السطر الأخير تُفشَل صراحةً.
let FINISHED = false;
process.on('exit', (code) => { if (!FINISHED && code === 0) { process.stderr.write('UNFINISHED: العملية انتهت قبل بلوغ سطر النتيجة (وعد عالق؟)\n'); process.exitCode = 1; } });
const mute = () => { for (const k of Object.keys(REAL_CONSOLE)) console[k] = () => {}; };
const unmute = () => { for (const k of Object.keys(REAL_CONSOLE)) console[k] = REAL_CONSOLE[k]; };

(async () => {
  mute();
  // ═══ ١ — المفردات والثوابت ═══
  ok(Object.isFrozen(N.SWEEP_STATE) && Object.isFrozen(N.SWEEP_CALLER) && Object.isFrozen(N.SWEEP_KEY_FIELD) && Object.isFrozen(N.SWEEP_SKIP_REASON) && Object.isFrozen(S.SWEEP_PLAN), '[١] المفردات والخطة مجمَّدة');
  deq({...N.SWEEP_STATE}, {COMPLETED: 'COMPLETED', CAPPED: 'CAPPED', BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', READ_FAILED: 'READ_FAILED', NOT_RUN_NO_KEY: 'NOT_RUN_NO_KEY'}, '[١] الحالات الخمس بنصّها (قائمة مغلقة: E34)');
  deq({...N.SWEEP_CALLER}, {CREATE_SCAN_SESSION: 'createScanSession', JOIN_SCAN_SESSION: 'joinScanSession'}, '[١] النداءان بأسمي الدالّتين');
  deq({...N.SWEEP_KEY_FIELD}, {OWNER_ID: 'ownerId', JOINED_BY: 'joinedBy'}, '[١] مفتاحا الكنس: ownerId وjoinedBy (E24)');
  deq({...N.SWEEP_SKIP_REASON}, {CLAIM_IN_FLIGHT: 'claim_in_flight', CLAIM_AGE_UNKNOWN: 'claim_age_unknown', NO_LONGER_DUE: 'no_longer_due'}, '[١] أسباب التخطّي الثلاثة');
  eq(N.SWEEP_NOT_RUN, 'NOT_RUN', '[١] كلمة NOT_RUN');
  eq(S.SWEEP_WRITE_CAP, 20, '[١] السقف 20 (E33)');
  eq(S.SWEEP_PLAN[C.CREATE_SCAN_SESSION].budgetMs, 10000, '[١] ميزانية الإنشاء 10 ث (E34)');
  eq(S.SWEEP_PLAN[C.JOIN_SCAN_SESSION].budgetMs, 3000, '[١] ميزانية الانضمام 3 ث (E34)');
  eq(S.SWEEP_PLAN[C.CREATE_SCAN_SESSION].keyField, 'ownerId', '[١] الإنشاء بمفتاح ownerId');
  eq(S.SWEEP_PLAN[C.JOIN_SCAN_SESSION].keyField, 'joinedBy', '[١] الانضمام بمفتاح joinedBy');
  ok(S.SWEEP_WRITE_CAP >= 7, '[١] السقف ≥ المفتوحة المنقضية الملاحَظة في o2 (7): نداء واحد يكنسها (E27)');
  {
    const SRC = path.join(__dirname, '..', 'src', 'sessions');
    const timeoutOf = (file) => Number(fs.readFileSync(path.join(SRC, file), 'utf8').match(/timeoutSeconds:\s*(\d+)/)[1]);
    eq(timeoutOf('createScanSession.js'), 30, '[١] مهلة createScanSession 30 ث (من المصدر)');
    eq(timeoutOf('joinScanSession.js'), 10, '[١] مهلة joinScanSession 10 ث (من المصدر)');
    ok(S.SWEEP_PLAN[C.CREATE_SCAN_SESSION].budgetMs * 3 <= timeoutOf('createScanSession.js') * 1000, '[١] ميزانية الإنشاء ≤ ثلث مهلة الدالّة');
    ok(S.SWEEP_PLAN[C.JOIN_SCAN_SESSION].budgetMs * 3 <= timeoutOf('joinScanSession.js') * 1000, '[١] ميزانية الانضمام ≤ ثلث مهلة الدالّة');
  }

  // ═══ ٢ — المرشَّحة ═══
  const world = () => ({
    scanSessions: {
      'p-exp': {ownerId: 'owner-1', status: 'pending', expiresAt: PAST(90)},
      's-exp': {ownerId: 'owner-1', status: 'scanning', expiresAt: tsLike(PAST(60)), joinedBy: 'dev-1'},
      's-exp-null': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(120), joinedBy: null},
      'p-valid': {ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE(20)},
      's-valid': {ownerId: 'owner-1', status: 'scanning', expiresAt: FUTURE(5), joinedBy: 'dev-1'},
      'p-noexp': {ownerId: 'owner-1', status: 'pending'},
      'p-null-exp': {ownerId: 'owner-1', status: 'pending', expiresAt: null},
      'p-bad-str': {ownerId: 'owner-1', status: 'pending', expiresAt: 'not-a-date'},
      's-bad-obj': {ownerId: 'owner-1', status: 'scanning', expiresAt: {seconds: 1}},
      'done': {ownerId: 'owner-1', status: 'completed', expiresAt: PAST(300)},
      'old-expired': {ownerId: 'owner-1', status: 'expired', expiresAt: PAST(300)},
      'old-cancelled': {ownerId: 'owner-1', status: 'cancelled', expiresAt: PAST(300)},
      'weird': {ownerId: 'owner-1', status: 'weird', expiresAt: PAST(300)},
      'no-status': {ownerId: 'owner-1', expiresAt: PAST(300)},
      'trigger': {ownerId: 'owner-1', status: 'pending', expiresAt: PAST(10)}, // الجلسة المُشغِّلة: لو كانت مستحقّة فاستثناؤها بالمعرّف
      'other-owner': {ownerId: 'owner-2', status: 'pending', expiresAt: PAST(90)},
      'other-owner-joined': {ownerId: 'owner-2', status: 'scanning', expiresAt: PAST(90), joinedBy: 'dev-1'},
    },
    scanClaims: {},
  });

  {
    const w = world();
    const db = makeSessionFakeDb(w);
    const before = deepCopy(db.store.scanSessions);
    const r = await sweep(db);
    // returned = ما أعاده الاستعلامان لمفتاح owner-1: pending (p-exp, p-valid, p-noexp, p-null-exp, p-bad-str, trigger) + scanning (s-exp, s-exp-null, s-valid, s-bad-obj)
    eq(r.returned, 10, '[٢] returned = ما أعاده الاستعلامان (ست pending وأربع scanning للمالك)');
    eq(r.candidates, 3, '[٢] candidates = ما بقي بعد الحكم واستثناء المُشغِّلة (p-exp وs-exp وs-exp-null)');
    deq(idsWritten(db), ['p-exp', 's-exp', 's-exp-null'], '[٢] المكتوب: الجارية المعروفة التي expiresAt فيها مقروء ومنقضٍ فقط');
    eq(r.written, 3, '[٢] written = 3');
    eq(r.state, 'COMPLETED', '[٢] state=COMPLETED');
    for (const wr of db.writes) {
      deq(Object.keys(wr.fields).sort(), ['expiredAt', 'status'], '[٢] المكتوب status وexpiredAt وحدهما');
      eq(wr.fields.status, 'expired', '[٢] status=expired (لا cancelled)');
      deq(wr.fields.expiredAt, {__serverTimestamp: true}, '[٢] expiredAt = serverTimestamp');
    }
    const after = deepCopy(db.store.scanSessions);
    for (const id of Object.keys(before)) {
      if (['p-exp', 's-exp', 's-exp-null'].includes(id)) continue;
      deq(after[id], before[id], `[٢] ${id} لم تُمسّ`);
    }
    deq(Object.keys(after).sort(), Object.keys(before).sort(), '[٢] لا حذف ولا إضافة: المجموعة بمستنداتها كلّها');
    for (const id of ['p-exp', 's-exp', 's-exp-null']) {
      const {status, expiredAt, ...rest} = db.store.scanSessions[id];
      eq(status, 'expired', `[٢] ${id}: status`);
      deq(deepCopy(rest), (() => { const {status: _s, ...b} = before[id]; return b; })(), `[٢] ${id}: بقية الحقول (ownerId وexpiresAt وjoinedBy) كما كانت`);
      ok(expiredAt && expiredAt.__serverTimestamp, `[٢] ${id}: expiredAt`);
    }
    eq(db.store.scanSessions['s-exp-null'].joinedBy, null, '[٢] جلسة joinedBy=null تُكنس بمفتاح المالك (E27) وjoinedBy يبقى null');
  }

  // استثناء المُشغِّلة: بغير excludeSessionId تُكنس هي أيضاً (فالاستثناء بالمعرّف لا بالحالة)
  {
    const db = makeSessionFakeDb(world());
    const r = await sweep(db, {excludeSessionId: null});
    ok(idsWritten(db).includes('trigger') && r.written === 4, '[٢] بلا excludeSessionId تُكنس المنقضية «المُشغِّلة» أيضاً (فالاستثناء بالمعرّف)');
    const db2 = makeSessionFakeDb(world());
    await sweep(db2, {excludeSessionId: 'trigger'});
    ok(!idsWritten(db2).includes('trigger') && db2.store.scanSessions.trigger.status === 'pending', '[٢] excludeSessionId يحمي المُشغِّلة ولو كانت منقضية');
  }

  // دفاع الوحدة إن أخطأ الاستعلام (القاعدة 24 «لا تُمسّ أبداً»): نهائية/مجهولة/غائبة الحالة وجلسات فاعل آخر تُعاد من استعلام مهمل فلا تُكتب
  {
    const db = makeSessionFakeDb(world(), {ignoreStatusFilter: true, ignoreKeyFilter: true});
    const before = deepCopy(db.store.scanSessions);
    const r = await sweep(db);
    deq(idsWritten(db), ['p-exp', 's-exp', 's-exp-null'], '[٢] استعلام مهمل (بلا فلتر حالة ولا مفتاح): المكتوب نفسه — النهائية والمجهولة والغائبة وجلسات owner-2 لا تُمسّ');
    ok(r.returned > 10, `[٢] وأُعيدت له جلسات أكثر (${r.returned}) فرُدّت داخل الوحدة`);
    for (const id of ['done', 'old-expired', 'old-cancelled', 'weird', 'no-status', 'other-owner', 'other-owner-joined', 'trigger', 'p-valid', 's-valid', 'p-noexp', 'p-null-exp', 'p-bad-str', 's-bad-obj']) {
      deq(deepCopy(db.store.scanSessions[id]), before[id], `[٢] ${id} لم تُمسّ ولو أُعيدت`);
    }
  }

  // الحدّ الزمني: expiresAt == الآن ليست «في الماضي» (حكم sessionExpiryRefusal: expiresAt < now)
  {
    const db = makeSessionFakeDb({scanSessions: {
      'edge-eq': {ownerId: 'owner-1', status: 'pending', expiresAt: new Date(NOW_MS)},
      'edge-past': {ownerId: 'owner-1', status: 'pending', expiresAt: new Date(NOW_MS - 1)},
      'edge-ms-num': {ownerId: 'owner-1', status: 'scanning', expiresAt: NOW_MS - 1000},
    }, scanClaims: {}});
    await sweep(db);
    deq(idsWritten(db), ['edge-ms-num', 'edge-past'], '[٢] الحدّ: expiresAt = الآن لا تُكنس، وقبلها بمللي ثانية تُكنس (حكم sessionExpiryRefusal نفسه)');
  }

  // ═══ ٣ — المفتاح ═══
  {
    // الانضمام: مفتاح joinedBy. dev-1 انضمّ إلى s-exp (مالك 1) وother-owner-joined (مالك 2)؛ dev-2 لا شيء.
    const db = makeSessionFakeDb(world());
    const r = await S.sweepExpiredSessions({db, FieldValue, from: C.JOIN_SCAN_SESSION, uid: 'dev-1', excludeSessionId: 'trigger', nowFn});
    deq(idsWritten(db), ['other-owner-joined', 's-exp'], '[٣] الانضمام بمفتاح joinedBy=dev-1: جلساته المنقضية فقط، ولو كانت لمالكين مختلفين');
    eq(r.state, 'COMPLETED', '[٣] state=COMPLETED');
    const joinQueries = db.queries.filter((q) => q.collection === 'scanSessions');
    ok(joinQueries.length === 2 && joinQueries.every((q) => q.filters[0][0] === 'joinedBy' && q.filters[0][2] === 'dev-1'), '[٣] استعلاما الانضمام على joinedBy == dev-1');
    ok(!db.store.scanSessions['s-exp-null'].expiredAt && db.store.scanSessions['s-exp-null'].status === 'scanning', '[٣] جلسة joinedBy=null لا يبلغها مفتاح منضمّ');
    ok(db.store.scanSessions['p-exp'].status === 'pending', '[٣] ولا جلسة المالك التي لم يُنضَمّ إليها');
  }
  {
    // الإنشاء: مفتاح ownerId: owner-1 وحده، ولا يطال owner-2
    const db = makeSessionFakeDb(world());
    await sweep(db);
    const qs = db.queries.filter((q) => q.collection === 'scanSessions');
    ok(qs.length === 2 && qs.every((q) => q.filters[0][0] === 'ownerId' && q.filters[0][2] === 'owner-1'), '[٣] استعلاما الإنشاء على ownerId == owner-1');
    ok(db.store.scanSessions['other-owner'].status === 'pending' && db.store.scanSessions['other-owner-joined'].status === 'scanning', '[٣] جلسات حساب آخر لا تُمسّ');
  }
  // joinerUid غائب أو null أو فارغ أو غير نصّ ⟵ لا استعلام ولا معاملة (E24)
  for (const [label, uid] of [['null', null], ['undefined', undefined], ['نصّ فارغ', ''], ['رقم', 5], ['كائن', {}]]) {
    const db = makeSessionFakeDb(world());
    const r = await S.sweepExpiredSessions({db, FieldValue, from: C.JOIN_SCAN_SESSION, uid, excludeSessionId: 'x', nowFn});
    deq(r, {state: 'NOT_RUN_NO_KEY', returned: null, candidates: null, written: null, skipped: null, failed: null, sweepMs: null, readError: null}, `[٣] joinerUid ${label}: NOT_RUN_NO_KEY وكل الأعداد null (لا صفر)`);
    eq(db.queries.length, 0, `[٣] joinerUid ${label}: لا استعلام إطلاقاً (ولا joinedBy == null)`);
    eq(db.txs.length + db.writes.length, 0, `[٣] joinerUid ${label}: لا معاملة ولا كتابة`);
  }

  // ═══ ٤ — شكل الاستعلام (E33، القاعدة 43) ═══
  {
    const db = makeSessionFakeDb(world());
    await sweep(db, {excludeSessionId: 'trigger'});
    const sessionsQs = db.queries.filter((q) => q.collection === 'scanSessions');
    const claimsQs = db.queries.filter((q) => q.collection === 'scanClaims');
    eq(sessionsQs.length, 2, '[٤] استعلاما جلسات بالضبط');
    deq(sessionsQs.map((q) => q.filters[1][2]).sort(), ['pending', 'scanning'], '[٤] حالتاهما pending وscanning');
    ok(sessionsQs.every((q) => q.filters.length === 2 && q.filters.every((f) => f[1] === '==') && q.filters[1][0] === 'status'), '[٤] مرشِّحان بمساواة لا غير: المفتاح وstatus');
    ok(db.queries.every((q) => !q.orderBy && !q.limit && !q.startAfter), '[٤] لا orderBy ولا limit ولا startAfter في أيّ استعلام (لا فهرس مركّب، القاعدة 43)');
    ok(db.queries.every((q) => q.filters.every((f) => f[1] === '==')), '[٤] ولا مدى (> أو <) في أيّ استعلام');
    ok(claimsQs.length === 3 && claimsQs.every((q) => q.inTx && q.filters.length === 1 && q.filters[0][0] === 'sessionId' && q.filters[0][1] === '=='), '[٤] قفل كل مرشَّحة بمساواة على sessionId، داخل المعاملة (E32)');
    ok(db.queries.every((q) => ['scanSessions', 'scanClaims'].includes(q.collection)), '[٤] لا مجموعة غير الجلسات والأقفال');
    ok(db.writes.every((wr) => wr.collection === 'scanSessions'), '[٤] لا كتابة خارج scanSessions (ولا scanClaims ولا حجز: E29)');
  }

  // ═══ ٥ — E32: الأقفال ═══
  const claimWorld = (claimsById) => ({
    scanSessions: {
      'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10), joinedBy: 'dev-1'},
      'c-2': {ownerId: 'owner-1', status: 'pending', expiresAt: PAST(20)},
    },
    scanClaims: claimsById,
  });
  {
    // قفل حيّ لـc-1 (عمره ثانية): تُتخطّى؛ c-2 تُكنس
    const claims = {k1: {sessionId: 'c-1', claimedAtMs: NOW_MS - 1000, reservation: null}};
    const db = makeSessionFakeDb(claimWorld(claims));
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq(only(r), {state: 'COMPLETED', returned: 2, candidates: 2, written: 1, skipped: 1, failed: 0}, '[٥] قفل حيّ: متخطّاة (skipped=1) وتُحسب مرشَّحة، وc-2 تُكتب');
    deq(idsWritten(db), ['c-2'], '[٥] المكتوبة c-2 وحدها');
    eq(db.store.scanSessions['c-1'].status, 'scanning', '[٥] c-1 تبقى scanning (تُكنس في نداء لاحق)');
    ok(cap.texts().includes(`[sweepExpiredSessions] skipped from=createScanSession session=${h('c-1')} reason=claim_in_flight`), '[٥] سطر التخطّي بسببه المسمّى ومعرّفه مُهشَّراً');
    ok(!cap.texts().join('\n').includes('c-1'), '[٥] ولا معرّف جلسة خامّ في السجلّ');
    eq(r.candidates, r.written + r.skipped + r.failed, '[٥] candidates = written + skipped + failed');
  }
  {
    // عمر القفل: 299999 مل ث حيّ، و300000 (TTL) قديم، وبعده قديم
    for (const [age, expectWritten, label] of [[SCAN_CLAIM_TTL_MS - 1, 0, 'قبل TTL بمللي ثانية: حيّ'], [SCAN_CLAIM_TTL_MS, 1, 'عند TTL بالضبط: قديم'], [SCAN_CLAIM_TTL_MS + 60000, 1, 'بعد TTL: قديم']]) {
      const db = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {k: {sessionId: 'c-1', claimedAtMs: NOW_MS - age}}});
      const r = await sweep(db);
      eq(r.written, expectWritten, `[٥] ${label} (عمر ${age} مل ث)`);
      eq(r.skipped, 1 - expectWritten, `[٥] ${label}: skipped`);
    }
    // ساعة القفل متقدّمة (عمر سالب) = حيّ كما تعامله analyzeDevice وcancelScanSession
    const db = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {k: {sessionId: 'c-1', claimedAtMs: NOW_MS + 5000}}});
    eq((await sweep(db)).skipped, 1, '[٥] عمر القفل السالب (ساعة متقدّمة) حيّ فيُتخطّى');
  }
  for (const [label, claim] of [['claimedAtMs غائب', {sessionId: 'c-1'}], ['claimedAtMs نصّ', {sessionId: 'c-1', claimedAtMs: 'now'}], ['claimedAtMs NaN', {sessionId: 'c-1', claimedAtMs: NaN}]]) {
    const db = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {k: claim}});
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq([r.written, r.skipped], [0, 1], `[٥] ${label}: عمر مجهول لا يُدَّعى قديماً فتُتخطّى (القاعدة 22، كما cancelScanSession)`);
    ok(cap.texts().some((t) => t.endsWith('reason=claim_age_unknown')), `[٥] ${label}: السبب claim_age_unknown`);
  }
  {
    // قفلان: أحدهما قديم والآخر حيّ ⟵ تُتخطّى؛ وقفل لجلسة أخرى لا يمنع هذه
    const db = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {
      old: {sessionId: 'c-1', claimedAtMs: NOW_MS - 10 * MIN}, live: {sessionId: 'c-1', claimedAtMs: NOW_MS - 1000}}});
    eq((await sweep(db)).skipped, 1, '[٥] قفل قديم وآخر حيّ للجلسة نفسها ⟵ تُتخطّى (الجاري يسبق)');
    const db2 = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {other: {sessionId: 'c-OTHER', claimedAtMs: NOW_MS - 1000}}});
    eq((await sweep(db2)).written, 1, '[٥] قفل حيّ لجلسة أخرى لا يمنع هذه');
  }

  // ═══ ٦ — E33: السقف ═══
  const manyWorld = (count) => {
    const sessions = {};
    for (let i = 0; i < count; i++) {
      // الأقدم انقضاءً له الرقم الأصغر: expiresAt = قبل (1000 − i) دقيقة. المعرّفات zero-padded
      sessions[`m-${String(i).padStart(3, '0')}`] = {ownerId: 'owner-1', status: i % 2 === 0 ? 'pending' : 'scanning', expiresAt: PAST(1000 - i)};
    }
    return {scanSessions: sessions, scanClaims: {}};
  };
  {
    const db = makeSessionFakeDb(manyWorld(25));
    const r = await sweep(db);
    deq(only(r), {state: 'CAPPED', returned: 25, candidates: 25, written: 20, skipped: 0, failed: 0}, '[٦] 25 مرشَّحة: تُكتب 20 وCAPPED، والباقي لنداء لاحق');
    deq(idsWritten(db), Array.from({length: 20}, (_, i) => `m-${String(i).padStart(3, '0')}`), '[٦] المكتوب الأقدم انقضاءً أوّلاً (حتمي بلا orderBy في الاستعلام)');
    for (let i = 20; i < 25; i++) eq(db.store.scanSessions[`m-${String(i).padStart(3, '0')}`].status === 'expired', false, `[٦] m-${i} تبقى لنداء لاحق`);
    const r2 = await sweep(db);
    deq(only(r2), {state: 'COMPLETED', returned: 5, candidates: 5, written: 5, skipped: 0, failed: 0}, '[٦] النداء اللاحق يكنس الخمس الباقية: COMPLETED');
    eq(db.writes.length, 25, '[٦] 25 كتابة في النداءين، لا كتابة مكرَّرة');
  }
  {
    const db = makeSessionFakeDb(manyWorld(20));
    deq(only(await sweep(db)), {state: 'COMPLETED', returned: 20, candidates: 20, written: 20, skipped: 0, failed: 0}, '[٦] 20 بالضبط: COMPLETED لا CAPPED (لم يبقَ مرشَّح)');
    const db7 = makeSessionFakeDb(manyWorld(7));
    deq(only(await sweep(db7)), {state: 'COMPLETED', returned: 7, candidates: 7, written: 7, skipped: 0, failed: 0}, '[٦] سبع (ملاحَظة o2): نداء واحد يكنسها كلّها');
    const dbCap3 = makeSessionFakeDb(manyWorld(5));
    deq(only(await sweep(dbCap3, {capWrites: 3})), {state: 'CAPPED', returned: 5, candidates: 5, written: 3, skipped: 0, failed: 0}, '[٦] السقف قابل للحقن (3): CAPPED');
  }
  {
    // السقف يعدّ محاولات الكتابة (ما كُتب وما رمت معاملته) — القاعدة 35: يُفرض حيث تُرسَل المعاملة
    const db = makeSessionFakeDb(manyWorld(25));
    db.hooks.failCommit = () => Object.assign(new Error('boom'), {code: 14});
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq(only(r), {state: 'CAPPED', returned: 25, candidates: 25, written: 0, skipped: 0, failed: 20}, '[٦] معاملات كلّها ترمي: تتوقّف عند 20 محاولة (failed=20) وCAPPED، لا حلقة بلا سقف');
  }
  {
    // المتخطّاة بقفل حيّ لا تُعدّ كتابة: 22 مرشَّحة منها 4 بقفل حيّ ⟵ 18 تُكتب وCOMPLETED
    const w = manyWorld(22);
    for (const i of [0, 1, 2, 3]) w.scanClaims[`k${i}`] = {sessionId: `m-${String(i).padStart(3, '0')}`, claimedAtMs: NOW_MS - 1000};
    const db = makeSessionFakeDb(w);
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq(only(r), {state: 'COMPLETED', returned: 22, candidates: 22, written: 18, skipped: 4, failed: 0}, '[٦] المتخطّاة لا تُعدّ كتابة: 18 مكتوبة و4 متخطّاة وCOMPLETED');
  }

  // ═══ ٧ — E34: ميزانية الزمن ═══
  {
    // ساعة مزيَّفة تتقدّم 400 مل ث بعد كل معاملة ناجحة؛ ميزانية الانضمام 3000: تُجرى معاملة ما دام (الساعة − البدء) < 3000 قبلها
    const clock = {t: 0};
    const w = manyWorld(12);
    for (const s of Object.values(w.scanSessions)) s.joinedBy = 'dev-1';
    const db = makeSessionFakeDb(w);
    db.hooks.onTx = () => { clock.t += 400; };
    const r = await S.sweepExpiredSessions({db, FieldValue, from: C.JOIN_SCAN_SESSION, uid: 'dev-1', excludeSessionId: 'x', nowFn: () => NOW_MS + clock.t});
    // بعد 8 معاملات t=3200 ≥ 3000 ⟵ تتوقّف قبل التاسعة (بعد 7 معاملات t=2800 < 3000 فتجري الثامنة)
    deq(only(r), {state: 'BUDGET_EXHAUSTED', returned: 12, candidates: 12, written: 8, skipped: 0, failed: 0}, '[٧] نفدت ميزانية الانضمام (3 ث) والباقي أربع: BUDGET_EXHAUSTED بأعداد ما عولج');
    eq(r.sweepMs, 3200, '[٧] sweepMs = الزمن المنقضي من الكنس (3200)');
    eq(db.writes.length, 8, '[٧] ثماني كتابات لا أكثر');
    // ميزانية الإنشاء 10 ث: بالساعة نفسها (400 لكل معاملة) تكفي 12 مرشَّحة كلّها (4800 < 10000)
    const clock2 = {t: 0};
    const db2 = makeSessionFakeDb(manyWorld(12));
    db2.hooks.onTx = () => { clock2.t += 400; };
    deq(only(await sweep(db2, {nowFn: () => NOW_MS + clock2.t})), {state: 'COMPLETED', returned: 12, candidates: 12, written: 12, skipped: 0, failed: 0}, '[٧] الإنشاء (10 ث): نفس الحمل يُكنس كلّه');
  }
  {
    // ميزانية نفدت قبل أول كتابة والمرشَّحات باقية ⟵ BUDGET_EXHAUSTED بلا كتابة (لا COMPLETED كاذبة)؛ وبلا مرشَّحات لا يُقال إنها نفدت
    const db = makeSessionFakeDb(manyWorld(3));
    deq(only(await sweep(db, {budgetMs: 0})), {state: 'BUDGET_EXHAUSTED', returned: 3, candidates: 3, written: 0, skipped: 0, failed: 0}, '[٧] الميزانية نفدت قبل أول كتابة والمرشَّحات باقية: BUDGET_EXHAUSTED، written=0 صفر حقيقي (الكنس جرى)');
    eq(db.writes.length, 0, '[٧] ولا كتابة');
    const dbNone = makeSessionFakeDb({scanSessions: {'v': {ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE(5)}}, scanClaims: {}});
    deq(only(await sweep(dbNone, {budgetMs: 0})), {state: 'COMPLETED', returned: 1, candidates: 0, written: 0, skipped: 0, failed: 0}, '[٧] ميزانية 0 بلا مرشَّحات: COMPLETED (لم يبقَ ما يُترك)');
  }

  // القراءة العالقة تحت الميزانية: لا يؤخّر النداء فوقها (READ_FAILED برمز مسمّى)، ولا كتابة
  {
    const db = makeSessionFakeDb(manyWorld(3));
    db.hooks.queryHangs = (q) => q.collection === 'scanSessions' && q.filters[1][2] === 'scanning';
    const t0 = Date.now();
    const r = await S.sweepExpiredSessions({db, FieldValue, from: C.CREATE_SCAN_SESSION, uid: 'owner-1', excludeSessionId: 'x', budgetMs: 40});
    const took = Date.now() - t0;
    ok(took < 1500, `[٧] القراءة العالقة لا تعلّق النداء: عاد بعد ${took} مل ث (الميزانية 40)`);
    deq({state: r.state, returned: r.returned, candidates: r.candidates, written: r.written, skipped: r.skipped, failed: r.failed, readError: r.readError},
        {state: 'READ_FAILED', returned: null, candidates: null, written: null, skipped: null, failed: null, readError: {className: 'SweepReadBudgetExhaustedError', code: 'SWEEP_READ_BUDGET_EXHAUSTED'}},
        '[٧] READ_FAILED برمز SWEEP_READ_BUDGET_EXHAUSTED واسم الصنف، والأعداد null');
    ok(typeof r.sweepMs === 'number' && r.sweepMs >= 0, '[٧] sweepMs عدد (زمن المحاولة)');
    eq(db.writes.length, 0, '[٧] لا كتابة');
  }

  // ═══ ٨ — READ_FAILED ═══
  {
    const db = makeSessionFakeDb(manyWorld(5));
    const SECRET = 'SECRET-INDEX-URL https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=Xyz sk-SECRETKEY-WXYZ';
    db.hooks.queryError = (q) => (q.collection === 'scanSessions' && q.filters[1][2] === 'scanning' ? Object.assign(new Error(SECRET), {code: 9}) : null);
    const cap = captureConsole();
    const callStartMs = NOW_MS;
    let r;
    try { r = await S.sweepAndLog({db, FieldValue, from: C.CREATE_SCAN_SESSION, uid: 'owner-1', excludeSessionId: 'x', nowFn, callStartMs}); } finally { cap.restore(); }
    eq(r.state, 'READ_FAILED', '[٨] فشل أحد الاستعلامين ⟵ READ_FAILED');
    eq(db.writes.length, 0, '[٨] يتوقّف الكنس كلّه بلا كتابة ولو أعاد الاستعلام الآخر مرشَّحات (لا كنس جزئي)');
    eq(db.txs.length, 0, '[٨] ولا معاملة');
    deq([r.returned, r.candidates, r.written, r.skipped, r.failed], [null, null, null, null, null], '[٨] الأعداد كلّها null (NOT_RUN) لا صفر');
    const line = cap.lines.find((l) => l.text.startsWith('[sweepExpiredSessions] swept '));
    ok(line && line.level === 'error', '[٨] السطر بمستوى error');
    eq(line.text, `[sweepExpiredSessions] swept from=createScanSession key=ownerId keyId=${h('owner-1')} state=READ_FAILED returned=NOT_RUN candidates=NOT_RUN written=NOT_RUN skipped=NOT_RUN failed=NOT_RUN sweepMs=0 totalMs=0 [Error] code=9`,
        '[٨] نصّ سطر READ_FAILED: الأعداد NOT_RUN، وsweepMs عدد، ويُلحَق اسم الصنف والرمز');
    ok(!cap.texts().join('\n').includes('SECRET') && !cap.texts().join('\n').includes('sk-'), '[٨] ونصّ رسالة الخطأ لا يصل السجلّ (القاعدة 36: الرمز واسم الصنف وحدهما)');
    // الخطأ بلا code: NO_CODE
    const db2 = makeSessionFakeDb(manyWorld(2));
    db2.hooks.queryError = () => new TypeError('x');
    const r2 = await sweep(db2);
    deq(r2.readError, {className: 'TypeError', code: 'NO_CODE'}, '[٨] خطأ بلا رمز: NO_CODE واسم الصنف TypeError');
  }

  // ═══ ٩ — فشل مرشَّحة ═══
  {
    const db = makeSessionFakeDb(manyWorld(5));
    db.hooks.failCommit = (id) => (id === 'm-002' ? Object.assign(new Error('SECRET-WRITE-DETAIL projects/x/documents/scanSessions/m-002'), {code: 10}) : null);
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq(only(r), {state: 'COMPLETED', returned: 5, candidates: 5, written: 4, skipped: 0, failed: 1}, '[٩] معاملة واحدة ترمي: failed=1 ولا توقف الباقي (4 كُتبت) وCOMPLETED');
    eq(r.candidates, r.written + r.skipped + r.failed, '[٩] candidates = written + skipped + failed');
    eq(db.store.scanSessions['m-002'].status, 'pending', '[٩] الفاشلة تبقى كما كانت');
    ok(cap.texts().includes(`[sweepExpiredSessions] write FAILED from=createScanSession session=${h('m-002')} [Error] code=10`), '[٩] سطر الفشل بمعرّفها مُهشَّراً واسم الصنف والرمز وحدهما');
    ok(!cap.texts().join('\n').includes('SECRET') && !cap.texts().join('\n').includes('m-002'), '[٩] ولا نصّ الخطأ ولا معرّف خامّ');
  }
  {
    // فشل قراءة قفل داخل المعاملة يُحسب failed (لا تُكتب «منتهية» وهي لا تعرف أن تحليلاً يجري)
    const db = makeSessionFakeDb({scanSessions: {'c-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}, 'c-2': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(20)}}, scanClaims: {}});
    db.hooks.queryError = (q) => (q.collection === 'scanClaims' && q.filters[0][2] === 'c-1' ? Object.assign(new Error('x'), {code: 14}) : null);
    const r = await sweep(db);
    deq(only(r), {state: 'COMPLETED', returned: 2, candidates: 2, written: 1, skipped: 0, failed: 1}, '[٩] فشل قراءة قفل: failed=1 ولا كتابة لتلك الجلسة');
    eq(db.store.scanSessions['c-1'].status, 'scanning', '[٩] c-1 تبقى scanning');
  }

  // ═══ ١٠ — السباق بين الاستعلام والمعاملة ═══
  for (const [label, mutate] of [
    ['صارت completed', (db) => { db.store.scanSessions['r-1'].status = 'completed'; }],
    ['صارت cancelled', (db) => { db.store.scanSessions['r-1'].status = 'cancelled'; }],
    ['صارت expired', (db) => { db.store.scanSessions['r-1'].status = 'expired'; }],
    ['مُدِّد expiresAt إلى المستقبل', (db) => { db.store.scanSessions['r-1'].expiresAt = FUTURE(30); }],
    ['حُذف expiresAt', (db) => { delete db.store.scanSessions['r-1'].expiresAt; }],
  ]) {
    const db = makeSessionFakeDb({scanSessions: {'r-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {}});
    let fired = false;
    db.hooks.beforeTx = () => { if (!fired) { fired = true; mutate(db); } };
    const cap = captureConsole();
    let r;
    try { r = await sweep(db); } finally { cap.restore(); }
    deq([r.written, r.skipped, r.failed], [0, 1, 0], `[١٠] ${label} بين الاستعلام والمعاملة: لا كتابة، تُعدّ متخطّاة`);
    const st = db.store.scanSessions['r-1'];
    ok(!('expiredAt' in st), `[١٠] ${label}: لا expiredAt`);
    ok(cap.texts().includes(`[sweepExpiredSessions] skipped from=createScanSession session=${h('r-1')} reason=no_longer_due`), `[١٠] ${label}: سبب التخطّي no_longer_due`);
  }
  {
    // قفل يظهر بين الاستعلام والمعاملة: قراءته داخل المعاملة نفسها فتُتخطّى
    const db = makeSessionFakeDb({scanSessions: {'r-1': {ownerId: 'owner-1', status: 'scanning', expiresAt: PAST(10)}}, scanClaims: {}});
    let fired = false;
    db.hooks.beforeTx = () => { if (!fired) { fired = true; db.store.scanClaims.late = {sessionId: 'r-1', claimedAtMs: NOW_MS - 100}; } };
    const r = await sweep(db);
    deq([r.written, r.skipped], [0, 1], '[١٠] قفل يُكتب بين الاستعلام والمعاملة: يُرى داخل المعاملة فتُتخطّى (لا «منتهية» تحت تحليل بدأ للتوّ)');
    eq(db.store.scanSessions['r-1'].status, 'scanning', '[١٠] الجلسة تبقى scanning');
  }

  // ═══ ١١ — سطر E34 بنصّه في كل حالة ═══
  const lineOf = (res, uid, totalMs, from = C.CREATE_SCAN_SESSION) => S.formatSweepLine(res, {from, uid, totalMs});
  eq(lineOf({state: 'COMPLETED', returned: 12, candidates: 7, written: 7, skipped: 0, failed: 0, sweepMs: 413, readError: null}, 'owner-1', 640),
      `[sweepExpiredSessions] swept from=createScanSession key=ownerId keyId=${h('owner-1')} state=COMPLETED returned=12 candidates=7 written=7 skipped=0 failed=0 sweepMs=413 totalMs=640`,
      '[١١] COMPLETED (E27: written=7)');
  eq(lineOf({state: 'COMPLETED', returned: 1, candidates: 0, written: 0, skipped: 0, failed: 0, sweepMs: 55, readError: null}, 'owner-1', 300),
      `[sweepExpiredSessions] swept from=createScanSession key=ownerId keyId=${h('owner-1')} state=COMPLETED returned=1 candidates=0 written=0 skipped=0 failed=0 sweepMs=55 totalMs=300`,
      '[١١] COMPLETED بلا مرشَّحة (المعتاد «بدونه»: candidates=0): الأعداد أصفار حقيقية لأن الكنس جرى');
  eq(lineOf({state: 'CAPPED', returned: 25, candidates: 25, written: 20, skipped: 0, failed: 0, sweepMs: 2100, readError: null}, 'dev-1', 2400, C.JOIN_SCAN_SESSION),
      `[sweepExpiredSessions] swept from=joinScanSession key=joinedBy keyId=${h('dev-1')} state=CAPPED returned=25 candidates=25 written=20 skipped=0 failed=0 sweepMs=2100 totalMs=2400`,
      '[١١] CAPPED (الانضمام بمفتاح joinedBy)');
  eq(lineOf({state: 'BUDGET_EXHAUSTED', returned: 12, candidates: 12, written: 8, skipped: 1, failed: 0, sweepMs: 3200, readError: null}, 'dev-1', 3500, C.JOIN_SCAN_SESSION),
      `[sweepExpiredSessions] swept from=joinScanSession key=joinedBy keyId=${h('dev-1')} state=BUDGET_EXHAUSTED returned=12 candidates=12 written=8 skipped=1 failed=0 sweepMs=3200 totalMs=3500`,
      '[١١] BUDGET_EXHAUSTED');
  eq(lineOf({state: 'READ_FAILED', returned: null, candidates: null, written: null, skipped: null, failed: null, sweepMs: 120, readError: {className: 'Error', code: 9}}, 'owner-1', 200),
      `[sweepExpiredSessions] swept from=createScanSession key=ownerId keyId=${h('owner-1')} state=READ_FAILED returned=NOT_RUN candidates=NOT_RUN written=NOT_RUN skipped=NOT_RUN failed=NOT_RUN sweepMs=120 totalMs=200 [Error] code=9`,
      '[١١] READ_FAILED: الأعداد NOT_RUN وsweepMs عدد، ويُلحَق الصنف والرمز');
  eq(lineOf({state: 'NOT_RUN_NO_KEY', returned: null, candidates: null, written: null, skipped: null, failed: null, sweepMs: null, readError: null}, null, 150, C.JOIN_SCAN_SESSION),
      `[sweepExpiredSessions] swept from=joinScanSession key=joinedBy keyId=missing state=NOT_RUN_NO_KEY returned=NOT_RUN candidates=NOT_RUN written=NOT_RUN skipped=NOT_RUN failed=NOT_RUN sweepMs=NOT_RUN totalMs=150`,
      '[١١] NOT_RUN_NO_KEY: كل شيء NOT_RUN عدا totalMs، والمعرّف «missing» (لا تهشير للفراغ)');
  for (const st of Object.values(N.SWEEP_STATE)) {
    const t = lineOf({state: st, returned: null, candidates: null, written: null, skipped: null, failed: null, sweepMs: null, readError: {className: 'E', code: 1}}, 'u', 1);
    ok(t.includes('written=NOT_RUN') && !t.includes('written=0'), `[١١] ${st}: العدّاد null يُطبع NOT_RUN لا 0 (القاعدة 22)`);
  }
  ok(/keyId=#[0-9a-f]{12} /.test(lineOf({state: 'COMPLETED', returned: 0, candidates: 0, written: 0, skipped: 0, failed: 0, sweepMs: 0, readError: null}, 'abc', 1)), '[١١] المعرّف مُهشَّر (#<12 سداسياً>) لا خامّ');

  // ═══ ١٢ — sweepAndLog ═══
  {
    // سطر واحد بالضبط في كل نداء — حتى حين لا يجري كنس (لا مرشَّحة) — وtotalMs يشمل الكنس
    for (const [label, world0, expectState] of [['بلا مرشَّحة', {scanSessions: {'x': {ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE(10)}}, scanClaims: {}}, 'COMPLETED'], ['بمرشَّحة', manyWorld(2), 'COMPLETED']]) {
      const db = makeSessionFakeDb(world0);
      const cap = captureConsole();
      let r;
      try { r = await S.sweepAndLog({db, FieldValue, from: C.CREATE_SCAN_SESSION, uid: 'owner-1', excludeSessionId: 'zz', nowFn, callStartMs: NOW_MS - 777}); } finally { cap.restore(); }
      const swept = cap.texts().filter((t) => t.startsWith('[sweepExpiredSessions] swept '));
      eq(swept.length, 1, `[١٢] ${label}: سطر E34 واحد بالضبط`);
      ok(swept[0].endsWith('totalMs=777'), `[١٢] ${label}: totalMs = الآن − بدء النداء (777)`);
      eq(r.state, expectState, `[١٢] ${label}: يعيد ناتج الكنس`);
    }
    // انضمام بلا هوية: السطر يُكتب أيضاً (NOT_RUN_NO_KEY) — «حتى حين لا يجري كنس»
    const db = makeSessionFakeDb(world());
    const cap = captureConsole();
    try { await S.sweepAndLog({db, FieldValue, from: C.JOIN_SCAN_SESSION, uid: null, excludeSessionId: 'zz', nowFn, callStartMs: NOW_MS}); } finally { cap.restore(); }
    eq(cap.texts().filter((t) => t.startsWith('[sweepExpiredSessions] swept ')).length, 1, '[١٢] joinerUid=null: السطر يُكتب مرّة واحدة (NOT_RUN_NO_KEY)');
    // لا ترمي أبداً: db ترمي تزامنياً، نداء غير مُدرَج، وdb بلا collection
    for (const [label, p] of [['db ترمي تزامنياً', {db: {collection: () => { throw new Error('SECRET-SYNC'); }}, from: C.CREATE_SCAN_SESSION, uid: 'u'}],
      ['نداء غير مُدرَج', {db: makeSessionFakeDb({scanSessions: {}, scanClaims: {}}), from: 'ghostCall', uid: 'u'}],
      ['db غائبة', {db: undefined, from: C.CREATE_SCAN_SESSION, uid: 'u'}]]) {
      const cap2 = captureConsole();
      let out;
      let threw = null;
      try { out = await S.sweepAndLog({FieldValue, excludeSessionId: 'z', nowFn, callStartMs: NOW_MS, ...p}); } catch (e) { threw = e; } finally { cap2.restore(); }
      eq(threw, null, `[١٢] ${label}: لا ترمي أبداً (أفضل جهد)`);
      ok(out === null || out.state === 'READ_FAILED', `[١٢] ${label}: تعيد null أو READ_FAILED`);
      ok(!cap2.texts().join('\n').includes('SECRET'), `[١٢] ${label}: ولا نصّ خطأ خامّ في السجلّ`);
    }
    const cap3 = captureConsole();
    try { await S.sweepAndLog({db: makeSessionFakeDb({scanSessions: {}, scanClaims: {}}), FieldValue, from: 'ghostCall', uid: 'u', callStartMs: NOW_MS}); } finally { cap3.restore(); }
    ok(cap3.texts().some((t) => t.startsWith('[sweepExpiredSessions] FAILED unexpectedly from=ghostCall [Error] code=NO_CODE')), '[١٢] غير المتوقَّع (نداء غير مُدرَج): سطر FAILED مسمّى بالصنف والرمز');
  }

  // ═══ ١٣ — حراس بنيوية ═══
  const SRC_DIR = path.join(__dirname, '..', 'src');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const read = (rel) => strip(fs.readFileSync(path.join(SRC_DIR, rel), 'utf8').replace(/\r\n/g, '\n'));
  for (const rel of ['sessions/sweepExpiredSessions.js']) {
    const code = read(rel);
    ok(!/\.delete\s*\(|FieldValue\.delete|bulkWriter|recursiveDelete|\.set\s*\(|\.add\s*\(|\.create\s*\(|\.batch\s*\(/.test(code), `[١٣] ${rel}: لا حذف ولا set/add/create/batch (القاعدة 42: كتابة حالة وحقول فقط)`);
    ok(!/CANCELLED/.test(code), `[١٣] ${rel}: لا cancelled (لا يُلغى بالكنس ولا بالاكتمال)`);
  }
  {
    const create = read('sessions/createScanSession.js');
    const join = read('sessions/joinScanSession.js');
    ok(/sweepAndLog\s*\(/.test(create) && /SWEEP_CALLER\.CREATE_SCAN_SESSION/.test(create), '[١٣] createScanSession تستدعي sweepAndLog بنداء CREATE_SCAN_SESSION');
    ok(/uid:\s*userId/.test(create) && /excludeSessionId:\s*ref\.id/.test(create), '[١٣] createScanSession: المفتاح uid المالك، والمُشغِّلة ref.id');
    ok(create.indexOf('.add(session)') < create.indexOf('sweepAndLog(') && create.indexOf('sweepAndLog(') < create.indexOf('sessionId: ref.id'), '[١٣] createScanSession: الكنس بعد إنشاء الجلسة وقبل الإرجاع');
    ok(/sweepAndLog\s*\(/.test(join) && /SWEEP_CALLER\.JOIN_SCAN_SESSION/.test(join), '[١٣] joinScanSession تستدعي sweepAndLog بنداء JOIN_SCAN_SESSION');
    ok(/uid:\s*joinerUid/.test(join) && /excludeSessionId:\s*sessionId/.test(join), '[١٣] joinScanSession: المفتاح joinerUid، والمُشغِّلة sessionId');
    ok(join.indexOf('outcome.refusal') < join.indexOf('sweepAndLog('), '[١٣] joinScanSession: الكنس بعد رفض الجلسة (المرفوض لا سطر كنس له)');
    eq((create.match(/sweepAndLog\s*\(/g) || []).length, 1, '[١٣] نقطة كنس واحدة في createScanSession');
    eq((join.match(/sweepAndLog\s*\(/g) || []).length, 1, '[١٣] نقطة كنس واحدة في joinScanSession');
    for (const rel of ['sessions/cancelScanSession.js', 'analysis/analyzeDevice.js', 'evaluations/submitEvaluation.js']) {
      ok(!/sweepExpiredSessions|sweepAndLog/.test(read(rel)), `[١٣] ${rel} لا تكنس (E25: الإلغاء لا يكنس؛ وanalyzeDevice وsubmitEvaluation مسّ أصلي لجلسة واحدة)`);
    }
  }

  FINISHED = true;
  unmute();
  console.log(`\nsweepExpiredSessions.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { unmute(); console.error(e); process.exit(1); });
