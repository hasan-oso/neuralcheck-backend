'use strict';

// sessionCompletion.test.js — كتابة «اكتملت» على الجلسة: شرط الحالة، ومحاولات محدودة، وفشل مسمّى لا مبتلَع، وحارس الملكية E35 (S-SWEEP، 2026-10-15 +03). وحدة بلا شبكة ولا محاكٍ.
// الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/sessionFakeDb.js) وsleep مُحقَن في هذا الاختبار وحده؛ والطبقة الحقيقية على المحاكي في sessionCompletion.e2e.test.js.
//
// العقد: docs/PROTOCOL_CONTRACT.md §٦-د. قرار المستخدم (E26، 2026-10-15، منقول): «The completed write is retried a bounded number of times. A final failure is logged with a named line, never
// swallowed. The write happens only while the session is still scanning, so it cannot overwrite cancelled or expired. The cached-response path (analyzeDevice.js:431-439) marks the session
// completed the same way before returning. The caller's answer is unchanged».
//
//   ١ الثوابت (3 محاولات، وفاصل 200 ثم 400 مل ث)
//   ٢ حارس الملكية ownerCheckState وحقول المسار ب cachedCompletionFields (الغائب يبقى غائباً)
//   ٣ المسار أ: يُكتب completed بالحقول وترتيبها السابق؛ ولا يُكتب لغير scanning (كل حالة)؛ ولا يُحاوَل التخطّي
//   ٤ المحاولات: فشل ثم نجاح، وفشل نهائي مسمّى (الرمز واسم الصنف وعدد المحاولات وحدها)، وفاصل 200 ثم 400، ولا نوم بعد الأخيرة، ولا رمي
//   ٥ المسار ب: حارس E35 بحالاته الأربع، والمسار أ بلا حارس
//   ٦ السباق: «completed تطمس expired/cancelled» من جهة الاكتمال
//   ٧ حراس بنيوية: توصيل analyzeDevice في المسارين، وأنّ كاتب completed واحد في src
//
// Run: node functions/test/sessionCompletion.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const X = require('../src/sessions/sessionCompletion');
const N = require('../src/sessions/sessionNames');
const {hashIdForLog: h} = require('../src/utils/logRedaction');
const {FieldValue, makeSessionFakeDb, captureConsole} = require('./lib/sessionFakeDb');

const P = N.COMPLETION_PATH;
const FIELDS_A = {scanId: 'scan-1', shortId: 'AB12CD', deviceModel: 'TestPhone'};
const seedSession = (fields) => makeSessionFakeDb({scanSessions: {'sess-1': {ownerId: 'owner-1', code: 'NC-AAAAAA', status: 'scanning', joinedBy: 'dev-1', scanId: null, deviceModel: null, ...fields}}, scanClaims: {}});
const refOf = (db) => db.collection('scanSessions').doc('sess-1');
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };
const run = async (db, p = {}) => {
  sleeps.length = 0;
  const cap = captureConsole();
  let res;
  let threw = null;
  try {
    res = await X.completeSessionBestEffort({db, FieldValue, sessionRef: refOf(db), path: P.FRESH_SCAN, fields: FIELDS_A, sleep, ...p});
  } catch (e) {
    threw = e;
  } finally {
    cap.restore();
  }
  return {res, threw, lines: cap.texts(), levels: cap.lines};
};
const completionLines = (lines) => lines.filter((l) => l.startsWith('[sessionCompletion] '));
const sid = h('sess-1');

// مخرَج الكود المُختبَر (سطور السجلّ) يُكتم أثناء التشغيل كي يبقى مخرَج الاختبار سطراً واحداً؛ ما يفحصه الاختبار من سطور يلتقطه captureConsole بنصّه.
const REAL_CONSOLE = {log: console.log, warn: console.warn, error: console.error, info: console.info};
// وعدٌ عالق (لا يُحَلّ ولا يُرفَض) يُنهي Node بالرمز 0 بصمت قبل الأسطر التالية: فالعملية التي تنتهي دون بلوغ السطر الأخير تُفشَل صراحةً.
let FINISHED = false;
process.on('exit', (code) => { if (!FINISHED && code === 0) { process.stderr.write('UNFINISHED: العملية انتهت قبل بلوغ سطر النتيجة (وعد عالق؟)\n'); process.exitCode = 1; } });
const mute = () => { for (const k of Object.keys(REAL_CONSOLE)) console[k] = () => {}; };
const unmute = () => { for (const k of Object.keys(REAL_CONSOLE)) console[k] = REAL_CONSOLE[k]; };

(async () => {
  mute();
  // ═══ ١ — الثوابت ═══
  eq(X.COMPLETION_MAX_ATTEMPTS, 3, '[١] ثلاث محاولات (معتمد 2026-10-15)');
  deq([...X.COMPLETION_RETRY_DELAYS_MS], [200, 400], '[١] فاصل 200 ثم 400 مل ث (معتمد)');
  eq(X.COMPLETION_RETRY_DELAYS_MS.length, X.COMPLETION_MAX_ATTEMPTS - 1, '[١] عدد الفواصل = المحاولات − 1');
  ok(Object.isFrozen(X.COMPLETION_RETRY_DELAYS_MS) && Object.isFrozen(X.COMPLETION_OUTCOME) && Object.isFrozen(N.COMPLETION_PATH) && Object.isFrozen(N.COMPLETION_SKIP) && Object.isFrozen(N.OWNER_CHECK_STATE), '[١] المفردات مجمَّدة');
  deq({...N.COMPLETION_PATH}, {FRESH_SCAN: 'fresh-scan', CACHED_RESPONSE: 'cached-response'}, '[١] المساران بنصّهما');
  deq({...N.COMPLETION_SKIP}, {NOT_SCANNING: 'not_scanning', SESSION_MISSING: 'session_missing', REPORT_OWNER_MISMATCH: 'report_owner_mismatch'}, '[١] أسباب التخطّي: قائمة مغلقة من ثلاثة');
  deq({...N.OWNER_CHECK_STATE}, {MATCH: 'MATCH', MISMATCH: 'MISMATCH', REPORT_USER_ABSENT: 'REPORT_USER_ABSENT', SESSION_OWNER_ABSENT: 'SESSION_OWNER_ABSENT'}, '[١] حالات حارس الملكية الأربع');
  deq({...X.COMPLETION_OUTCOME}, {WRITTEN: 'WRITTEN', SKIPPED: 'SKIPPED', FAILED: 'FAILED'}, '[١] نتائج الإتمام الثلاث');

  // القيمة الحرفية الفريدة تُكتب في sessionNames.js وحده من شيفرة src (القاعدة 24: لا نسخة في كل ملفّ)، والمستهلك يستوردها من الملفّ نفسه
  {
    const fsx = require('fs');
    const pathx = require('path');
    const SRCX = pathx.join(__dirname, '..', 'src');
    const stripx = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
    const walkx = (dir, out = []) => {
      for (const e of fsx.readdirSync(dir, {withFileTypes: true})) {
        const q = pathx.join(dir, e.name);
        if (e.isDirectory()) walkx(q, out);
        else if (e.name.endsWith('.js')) out.push(q);
      }
      return out;
    };
    const filesx = walkx(SRCX).map((f) => [pathx.relative(SRCX, f).split(pathx.sep).join('/'), stripx(fsx.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'))]);
    for (const v of ['report_owner_mismatch', 'session_missing', 'not_scanning', 'fresh-scan', 'cached-response', 'REPORT_USER_ABSENT', 'SESSION_OWNER_ABSENT']) {
      const re = new RegExp(`["'\`]${v}["'\`]`);
      deq(filesx.filter(([, text]) => re.test(text)).map(([rel]) => rel), ['sessions/sessionNames.js'], `[١] «${v}» حرفية في sessionNames.js وحده`);
    }
    const compText = filesx.find(([r]) => r === 'sessions/sessionCompletion.js')[1];
    ok(/require\(["']\.\/sessionNames["']\)/.test(compText), '[١] sessionCompletion.js يستورد sessionNames.js');
    deq([...compText.matchAll(/["'`](pending|scanning|completed|expired|cancelled)["'`]/g)].map((m) => m[1]), [], '[١] sessionCompletion.js: لا نصّ حرفي لحالة جلسة (المفردات من sessionNames.js)');
  }

  // ═══ ٢ — حارس الملكية وحقول المسار ب ═══
  const OC = N.OWNER_CHECK_STATE;
  eq(X.ownerCheckState('o1', 'o1'), OC.MATCH, '[٢] المالك = userId التقرير: MATCH');
  eq(X.ownerCheckState('o1', 'o2'), OC.MISMATCH, '[٢] مختلفان: MISMATCH');
  for (const [label, v] of [['غائب', undefined], ['null', null], ['فارغ', ''], ['رقم', 5], ['كائن', {}]]) {
    eq(X.ownerCheckState('o1', v), OC.REPORT_USER_ABSENT, `[٢] userId التقرير ${label}: REPORT_USER_ABSENT (الغياب لا يُقرأ هويةً)`);
    eq(X.ownerCheckState(v, 'o1'), OC.SESSION_OWNER_ABSENT, `[٢] ownerId الجلسة ${label}: SESSION_OWNER_ABSENT`);
  }
  eq(X.ownerCheckState(undefined, undefined), OC.REPORT_USER_ABSENT, '[٢] كلاهما غائب: لا يتطابقان (غائب ≠ غائب)');
  eq(X.ownerCheckState(null, null), OC.REPORT_USER_ABSENT, '[٢] كلاهما null: لا «null == null»');
  deq(X.cachedCompletionFields({scanId: 's1', reportData: {shortId: 'AB12CD', deviceModel: 'SM-G973F', userId: 'o1'}}), {fields: {scanId: 's1', shortId: 'AB12CD', deviceModel: 'SM-G973F'}, absentFields: []}, '[٢] تقرير كامل: الحقول الثلاثة من التقرير');
  deq(X.cachedCompletionFields({scanId: 's1', reportData: {deviceModel: 'M'}}), {fields: {scanId: 's1', deviceModel: 'M'}, absentFields: ['shortId']}, '[٢] shortId غائب: لا يُكتب مفتاحه ويُسمّى غائباً');
  deq(X.cachedCompletionFields({scanId: 's1', reportData: {shortId: 'S'}}), {fields: {scanId: 's1', shortId: 'S'}, absentFields: ['deviceModel']}, '[٢] deviceModel غائب: لا «Unknown» ولا null (الغائب يبقى غائباً)');
  deq(X.cachedCompletionFields({scanId: 's1', reportData: {shortId: '', deviceModel: 5}}), {fields: {scanId: 's1'}, absentFields: ['shortId', 'deviceModel']}, '[٢] فارغ أو غير نصّ: غائب');
  deq(X.cachedCompletionFields({scanId: 's1', reportData: null}), {fields: {scanId: 's1'}, absentFields: ['shortId', 'deviceModel']}, '[٢] بيانات التقرير غائبة: scanId وحده');
  ok(!('deviceModel' in X.cachedCompletionFields({scanId: 's1', reportData: {}}).fields) && !('shortId' in X.cachedCompletionFields({scanId: 's1', reportData: {}}).fields), '[٢] المفتاح الغائب غير موجود في الحقول (لا undefined تكسر Admin SDK)');

  // ═══ ٣ — المسار أ ═══
  {
    const db = seedSession({});
    const {res, threw, lines} = await run(db);
    eq(threw, null, '[٣] لا ترمي');
    deq(res, {outcome: 'WRITTEN', attempts: 1}, '[٣] scanning ⟵ WRITTEN من أول محاولة');
    const s = db.store.scanSessions['sess-1'];
    eq(s.status, 'completed', '[٣] status=completed');
    deq([s.scanId, s.shortId, s.deviceModel], ['scan-1', 'AB12CD', 'TestPhone'], '[٣] scanId وshortId وdeviceModel');
    deq(s.completedAt, {__serverTimestamp: true}, '[٣] completedAt = serverTimestamp');
    deq([s.ownerId, s.code, s.joinedBy], ['owner-1', 'NC-AAAAAA', 'dev-1'], '[٣] بقية الحقول لم تُمسّ');
    eq(db.writes.length, 1, '[٣] كتابة واحدة');
    deq(Object.keys(db.writes[0].fields), ['status', 'scanId', 'shortId', 'deviceModel', 'completedAt'], '[٣] المفاتيح بترتيب ما كتبته analyzeDevice قبل الملفّ: status ثم scanId وshortId وdeviceModel ثم completedAt');
    deq(completionLines(lines), [`[sessionCompletion] completed path=fresh-scan session=${sid} attempts=1`], '[٣] سطر النجاح بنصّه: المسار والمعرّف مُهشَّراً وعدد المحاولات');
    eq(sleeps.length, 0, '[٣] لا نوم عند النجاح الأوّل');
    ok(!lines.join('\n').includes('sess-1'), '[٣] ولا sessionId خامّ في السطر');
  }
  // كل حالة غير scanning: لا كتابة ولا محاولة ثانية، والسطر بنصّه
  const NOT_SCANNING = [
    ['cancelled', {status: 'cancelled'}, 'cancelled'], ['expired', {status: 'expired'}, 'expired'], ['completed', {status: 'completed'}, 'completed'], ['pending', {status: 'pending'}, 'pending'],
    ['غائبة', {status: undefined}, 'ABSENT'], ['null', {status: null}, 'ABSENT'], ['رقم', {status: 5}, 'NOT_A_STRING'], ['مجهولة', {status: 'weird'}, 'UNRECOGNIZED'], ['Scanning بحرف كبير', {status: 'Scanning'}, 'UNRECOGNIZED'],
  ];
  for (const [label, fields, token] of NOT_SCANNING) {
    const db = seedSession(fields);
    if (fields.status === undefined) delete db.store.scanSessions['sess-1'].status;
    const before = JSON.stringify(db.store.scanSessions['sess-1']);
    const {res, lines} = await run(db);
    deq(res, {outcome: 'SKIPPED', attempts: 1, skip: 'not_scanning'}, `[٣] حالة ${label}: SKIPPED بمحاولة واحدة (التخطّي ليس فشلاً فلا يُحاوَل ثانيةً)`);
    eq(JSON.stringify(db.store.scanSessions['sess-1']), before, `[٣] حالة ${label}: مستند الجلسة كما كان بالبايت (لا تُطمَس)`);
    eq(db.writes.length, 0, `[٣] حالة ${label}: لا كتابة`);
    deq(completionLines(lines), [`[sessionCompletion] completed-skipped status=${token} path=fresh-scan session=${sid}`], `[٣] حالة ${label}: سطر completed-skipped بنصّه (status=${token})`);
    eq(sleeps.length, 0, `[٣] حالة ${label}: لا نوم`);
  }
  {
    const db = makeSessionFakeDb({scanSessions: {}, scanClaims: {}});
    const {res, lines} = await run(db);
    deq(res, {outcome: 'SKIPPED', attempts: 1, skip: 'session_missing'}, '[٣] مستند الجلسة غير موجود: SKIPPED');
    deq(completionLines(lines), [`[sessionCompletion] completed-skipped reason=session_missing path=fresh-scan session=${sid}`], '[٣] سطر session_missing بنصّه');
    eq(db.writes.length, 0, '[٣] ولا كتابة (لا إنشاء مستند)');
  }

  // ═══ ٤ — المحاولات ═══
  const boom = (code = 14, msg = 'UNAVAILABLE SECRET-DETAIL projects/x/documents/scanSessions/sess-1 sk-SECRETKEY-WXYZ') => Object.assign(new Error(msg), {code});
  {
    // فشل ثم نجاح
    const db = seedSession({});
    db.hooks.failCommit = (id, nth) => (nth === 1 ? boom() : null);
    const {res, threw, lines, levels} = await run(db);
    eq(threw, null, '[٤] لا ترمي');
    deq(res, {outcome: 'WRITTEN', attempts: 2}, '[٤] فشل ثم نجاح: WRITTEN بمحاولتين');
    eq(db.store.scanSessions['sess-1'].status, 'completed', '[٤] الجلسة completed');
    deq(sleeps, [200], '[٤] فاصل 200 مل ث قبل المحاولة الثانية');
    deq(completionLines(lines), [
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid} attempt=1/3 [Error] code=14`,
      `[sessionCompletion] completed path=fresh-scan session=${sid} attempts=2`,
    ], '[٤] سطرا المحاولة الفاشلة (الصنف والرمز وحدهما) ثم النجاح بعدد المحاولات');
    ok(!lines.join('\n').includes('SECRET') && !lines.join('\n').includes('sk-'), '[٤] ونصّ رسالة الخطأ لا يصل السجلّ (القاعدة 36)');
    eq(levels.find((l) => l.text.includes('attempt failed')).level, 'warn', '[٤] المحاولة الفاشلة بمستوى warn');
  }
  {
    // فشلان ثم نجاح في الثالثة
    const db = seedSession({});
    db.hooks.failCommit = (id, nth) => (nth <= 2 ? boom(10) : null);
    const {res} = await run(db);
    deq(res, {outcome: 'WRITTEN', attempts: 3}, '[٤] فشلان ثم نجاح في الثالثة: WRITTEN بثلاث محاولات');
    deq(sleeps, [200, 400], '[٤] الفاصلان 200 ثم 400 بالترتيب');
  }
  {
    // فشل نهائي: ثلاث محاولات، سطر FAILED مسمّى، لا رمي، لا نوم بعد الأخيرة، الجلسة كما كانت
    const db = seedSession({});
    db.hooks.failCommit = () => boom(14);
    const before = JSON.stringify(db.store.scanSessions['sess-1']);
    const {res, threw, lines, levels} = await run(db);
    eq(threw, null, '[٤] الفشل النهائي لا يرمي (الردّ للمستدعي لا يتغيّر)');
    deq(res, {outcome: 'FAILED', attempts: 3}, '[٤] FAILED بثلاث محاولات');
    deq(sleeps, [200, 400], '[٤] نومان فقط: لا نوم بعد المحاولة الأخيرة');
    eq(JSON.stringify(db.store.scanSessions['sess-1']), before, '[٤] الجلسة كما كانت (scanning)');
    deq(completionLines(lines), [
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid} attempt=1/3 [Error] code=14`,
      `[sessionCompletion] completed-write attempt failed path=fresh-scan session=${sid} attempt=2/3 [Error] code=14`,
      `[sessionCompletion] completed-write FAILED path=fresh-scan session=${sid} attempts=3 [Error] code=14`,
    ], '[٤] سطر الفشل النهائي بنصّه: المسار والمعرّف وعدد المحاولات (3) والصنف والرمز وحدها');
    eq(levels.find((l) => l.text.includes('completed-write FAILED')).level, 'error', '[٤] الفشل النهائي بمستوى error (لا ابتلاع صامت)');
    ok(!lines.join('\n').includes('SECRET') && !lines.join('\n').includes('sess-1') && !lines.join('\n').includes('sk-'), '[٤] لا نصّ خطأ ولا معرّف خامّ');
    // خطأ بلا رمز واسم صنف آخر
    const db2 = seedSession({});
    db2.hooks.failCommit = () => new RangeError('x');
    const r2 = await run(db2);
    ok(completionLines(r2.lines).pop().endsWith('[RangeError] code=NO_CODE'), '[٤] خطأ بلا رمز: NO_CODE واسم الصنف');
  }
  {
    // فشل ثم تخطٍّ: المحاولة الثانية ترى cancelled فلا تطمسها
    const db = seedSession({});
    db.hooks.failCommit = () => boom();
    let calls = 0;
    db.hooks.beforeTx = () => { calls++; if (calls === 2) db.store.scanSessions['sess-1'].status = 'cancelled'; };
    const {res, lines} = await run(db);
    deq(res, {outcome: 'SKIPPED', attempts: 2, skip: 'not_scanning'}, '[٤] فشل ثم تخطٍّ: المحاولة الثانية ترى cancelled فتتخطّى (لا طمس)');
    eq(db.store.scanSessions['sess-1'].status, 'cancelled', '[٤] cancelled تبقى');
    ok(completionLines(lines).pop() === `[sessionCompletion] completed-skipped status=cancelled path=fresh-scan session=${sid}`, '[٤] سطر التخطّي بالحالة الفعلية');
  }
  {
    // الرمي من tx.get (قراءة) يُحاوَل أيضاً كفشل
    const db = seedSession({});
    let calls = 0;
    const real = db.runTransaction;
    db.runTransaction = async (cb) => { calls++; if (calls === 1) throw boom(4); return real(cb); };
    const {res} = await run(db);
    deq(res, {outcome: 'WRITTEN', attempts: 2}, '[٤] رمي المعاملة نفسها (لا الكتابة وحدها) يُحاوَل ثانيةً');
  }

  // ═══ ٥ — المسار ب وحارس E35 ═══
  const runB = (db, reportUserId, extra = {}) => run(db, {path: P.CACHED_RESPONSE, fields: {scanId: 'scan-1', shortId: 'RPT123', deviceModel: 'SM-REPORT'}, ownerGuard: {reportUserId}, ...extra});
  {
    const db = seedSession({});
    const {res, lines} = await runB(db, 'owner-1');
    deq(res, {outcome: 'WRITTEN', attempts: 1}, '[٥] userId التقرير = ownerId الجلسة: يُكتب');
    const s = db.store.scanSessions['sess-1'];
    deq([s.status, s.scanId, s.shortId, s.deviceModel], ['completed', 'scan-1', 'RPT123', 'SM-REPORT'], '[٥] الحقول من التقرير المخزَّن');
    deq(completionLines(lines), [`[sessionCompletion] completed path=cached-response session=${sid} attempts=1`], '[٥] سطر المسار ب');
  }
  for (const [label, sessionFields, reportUserId, state] of [
    ['مالك مختلف', {}, 'someone-else', 'MISMATCH'],
    ['userId التقرير غائب', {}, undefined, 'REPORT_USER_ABSENT'],
    ['userId التقرير null', {}, null, 'REPORT_USER_ABSENT'],
    ['ownerId الجلسة غائب', {ownerId: undefined}, 'owner-1', 'SESSION_OWNER_ABSENT'],
    ['كلاهما null', {ownerId: null}, null, 'REPORT_USER_ABSENT'],
  ]) {
    const db = seedSession(sessionFields);
    if (sessionFields.ownerId === undefined && 'ownerId' in sessionFields) delete db.store.scanSessions['sess-1'].ownerId;
    const before = JSON.stringify(db.store.scanSessions['sess-1']);
    const {res, lines} = await runB(db, reportUserId);
    deq(res, {outcome: 'SKIPPED', attempts: 1, skip: 'report_owner_mismatch'}, `[٥] ${label}: SKIPPED بسبب report_owner_mismatch`);
    eq(JSON.stringify(db.store.scanSessions['sess-1']), before, `[٥] ${label}: الجلسة كما كانت (تبقى scanning، لا اكتمال لجلسة بتقرير غيرها)`);
    deq(completionLines(lines), [`[sessionCompletion] completed-skipped reason=report_owner_mismatch path=cached-response session=${sid} ownerCheck=${state}`], `[٥] ${label}: السطر بنصّه مع ownerCheck=${state}`);
  }
  {
    // الحارس بعد شرط الحالة: cancelled تُسمَّى بحالتها لا بالملكية
    const db = seedSession({status: 'cancelled'});
    const {lines} = await runB(db, 'someone-else');
    deq(completionLines(lines), [`[sessionCompletion] completed-skipped status=cancelled path=cached-response session=${sid}`], '[٥] cancelled مع تقرير غريب: يُسمّى التخطّي بالحالة (الشرط الأوّل)');
  }
  {
    // المسار أ بلا ownerGuard: لا يفحص الملكية (ولو ownerId غائب في الجلسة) — الحارس للمسار ب وحده
    const db = seedSession({});
    delete db.store.scanSessions['sess-1'].ownerId;
    const {res} = await run(db);
    eq(res.outcome, 'WRITTEN', '[٥] المسار أ بلا حارس ملكية (الجدول: «—»)');
  }
  {
    // absentFields في سطر النجاح
    const db = seedSession({});
    const {lines} = await runB(db, 'owner-1', {fields: {scanId: 'scan-1'}, absentFields: ['shortId', 'deviceModel']});
    deq(completionLines(lines), [`[sessionCompletion] completed path=cached-response session=${sid} attempts=1 absentFields=shortId,deviceModel`], '[٥] الحقول الغائبة من التقرير تُسمّى في سطر النجاح');
    deq(Object.keys(db.writes[0].fields), ['status', 'scanId', 'completedAt'], '[٥] ولا تُكتب مفاتيحها (لا undefined ولا قيمة مختلَقة)');
    eq(db.store.scanSessions['sess-1'].deviceModel, null, '[٥] deviceModel يبقى ما كان على الجلسة (null من الإنشاء)');
  }

  // ═══ ٦ — السباق: completed تطمس expired/cancelled ═══
  for (const interleaved of ['expired', 'cancelled']) {
    const db = seedSession({});
    db.hooks.beforeTx = () => { db.store.scanSessions['sess-1'].status = interleaved; }; // الكنس/الإلغاء كتب الحالة قبل معاملة الاكتمال
    const {res, lines} = await run(db);
    eq(res.outcome, 'SKIPPED', `[٦] ${interleaved} كُتبت قبل الاكتمال: التخطّي`);
    eq(db.store.scanSessions['sess-1'].status, interleaved, `[٦] ${interleaved} لا تُطمَس بـcompleted`);
    ok(!('completedAt' in db.store.scanSessions['sess-1']) && !('shortId' in db.store.scanSessions['sess-1']), `[٦] ${interleaved}: ولا حقل اكتمال`);
    ok(completionLines(lines)[0].startsWith(`[sessionCompletion] completed-skipped status=${interleaved} `), `[٦] ${interleaved}: السطر بحالتها`);
  }

  // ═══ ٧ — حراس بنيوية ═══
  const SRC_DIR = path.join(__dirname, '..', 'src');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const read = (rel) => strip(fs.readFileSync(path.join(SRC_DIR, rel), 'utf8').replace(/\r\n/g, '\n'));
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const q = path.join(dir, e.name);
      if (e.isDirectory()) walk(q, out);
      else if (e.name.endsWith('.js')) out.push(q);
    }
    return out;
  };
  const rel = (f) => path.relative(SRC_DIR, f).split(path.sep).join('/');
  {
    const code = read('sessions/sessionCompletion.js');
    ok(!/\.delete\s*\(|FieldValue\.delete|bulkWriter|recursiveDelete|\.set\s*\(|\.add\s*\(|\.create\s*\(|\.batch\s*\(/.test(code), '[٧] sessions/sessionCompletion.js: لا حذف ولا set/add/create/batch (القاعدة 42: كتابة حالة وحقول فقط)');
    ok(!/CANCELLED/.test(code), '[٧] sessions/sessionCompletion.js: لا cancelled');
    ok((code.match(/\.update\s*\(/g) || []).length === 1, '[٧] sessions/sessionCompletion.js: كتابة واحدة بالضبط (tx.update داخل المعاملة)');
  }
  const analyze = read('analysis/analyzeDevice.js');
  eq((analyze.match(/completeSessionBestEffort\s*\(/g) || []).length, 2, '[٧] analyzeDevice: موضعان لكتابة الاكتمال بالضبط (المسار أ والمسار ب)');
  ok(/path:\s*COMPLETION_PATH\.FRESH_SCAN/.test(analyze) && /path:\s*COMPLETION_PATH\.CACHED_RESPONSE/.test(analyze), '[٧] analyzeDevice: المساران بمسارَيهما المسمّيين');
  ok(/ownerGuard:\s*\{\s*reportUserId:\s*existingData\.userId\s*\}/.test(analyze), '[٧] المسار ب بحارس E35: reportUserId من userId التقرير المخزَّن (الحقل حاضر دائماً: الغياب حالة صريحة)');
  ok(/cachedCompletionFields\s*\(/.test(analyze), '[٧] المسار ب: الحقول من cachedCompletionFields (الغائب يبقى غائباً)');
  ok(!/Failed to update session/.test(analyze), '[٧] analyzeDevice: لا ابتلاع صامت «Failed to update session» (كان يطبع معرّف الجلسة ورسالة الخطأ خامَين)');
  const writers = walk(SRC_DIR).filter((f) => /status:\s*SESSION_STATUS\.COMPLETED/.test(strip(fs.readFileSync(f, 'utf8')))).map(rel);
  deq(writers, ['sessions/sessionCompletion.js'], '[٧] كاتب completed واحد في src: sessionCompletion.js (لا `.update` مباشر بلا شرط حالة في مكان آخر)');
  ok(/if \(isSessionScan && sessionId\) \{\s*await completeSessionBestEffort\(\{/.test(analyze), '[٧] المسار أ: الاكتمال مشروط بجلسة (isSessionScan && sessionId) بلا غيره');
  const idxA = analyze.indexOf('writeReportAndRaw({');
  const idxCompleteA = analyze.indexOf('path: COMPLETION_PATH.FRESH_SCAN');
  ok(idxA > 0 && idxCompleteA > idxA, '[٧] المسار أ: الاكتمال بعد حفظ التقرير والخامّ (writeReportAndRaw)');
  const idxExisting = analyze.indexOf('existingReport.exists');
  const idxCompleteB = analyze.indexOf('path: COMPLETION_PATH.CACHED_RESPONSE');
  const idxReturnB = analyze.indexOf('return existingData.pipeline === V7_PIPELINE_TAG');
  ok(idxExisting > 0 && idxCompleteB > idxExisting && idxCompleteB < idxReturnB, '[٧] المسار ب: الاكتمال بعد وجود التقرير المخزَّن وقبل الإرجاع');
  ok(/if\s*\(isSessionScan\)/.test(analyze.slice(idxExisting, idxReturnB)), '[٧] المسار ب: لجلسة فقط (isSessionScan)');

  FINISHED = true;
  unmute();
  console.log(`\nsessionCompletion.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { unmute(); console.error(e); process.exit(1); });
