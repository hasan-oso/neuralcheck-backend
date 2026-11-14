'use strict';

// verifyS10PostdeployReadonly.test.js — سكربت verify-s10-postdeploy-readonly.js ومكتبته scripts/lib/s10PostDeploy.js (قبل نشر الأمان، 2026-10-09 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي: verifyS10PostdeployReadonly.e2e.test.js.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «بعد نشر الدوالّ والقواعد مباشرة، أجري فحصاً واحداً من الـS10 وهو على 1.0.10، من الرئيسية. يُقبل إن صدر
// التقرير، وكُتب reportRaw بالكتابة الذرّية، وخُصم الرصيد مرّة واحدة، ولم يبقَ حجز معلّق. ويُقرأ ذلك بكتلة قراءة تأتيني. وإن فشل: تراجع إلى d5b6c29 قبل
// أيّ ترحيل.» ونطاق التراجع بنصّه (فشل الخادم ⇐ الدوالّ إلى d5b6c29 وتبقى القواعد؛ الخادم سليم والهاتف لا يعرض ⇐ القواعد إلى نسختها؛ تعذّر التمييز ⇐ الاثنان).
//   ١ — الوسائط.  ٢ — الحكم: كل حالة من الشروط الأربعة وتركيباتها.  ٣ — نصوص القرار.  ٤ — ملفّ المخرَج: UTF-8 بلا BOM وwx.  ٥ — ملفّ «قبل».
//   ٦ — لقطة «قبل» على db وAuth مزيَّفين: لا بريد ولا uid خامّ، وكل خطأ باسمه.  ٧ — جمع حقائق «بعد».  ٨ — main.  ٩ — بنية الشيفرة.
//
// الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة (test/lib/memFirestore.js) وAuth مزيَّف — في اختبار الوحدة وحدها؛ والطبقة الحقيقية في الـe2e.
//
// Run: node functions/test/verifyS10PostdeployReadonly.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Timestamp} = require('@google-cloud/firestore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const throwsReason = async (fn, re, m) => {
  let e = null;
  try { await fn(); } catch (x) { e = x; }
  ok(e && re.test(e.message), `${m} — ${e && e.message}`);
};

const L = require('../scripts/lib/s10PostDeploy');
const {main, safeErrorText} = require('../scripts/verify-s10-postdeploy-readonly');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {makeMemDb} = require('./lib/memFirestore');
const S = L.STATE;

const SECRET_EMAIL = 's10.secret.account@example.test';
const SECRET_UID = 'uid-S10-SECRET-123456';
const NOW = 1_800_000_000_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's10-unit-'));

(async () => {
  // ═══ ١ — الوسائط ═══
  const pa = L.parseArgs;
  deq(pa(['--before', '--out', 'b.json']), {mode: 'before', preflight: false, out: 'b.json', beforeFile: null, shortId: null}, '[١] --before --out');
  deq(pa(['--after', '--short-id', 'NC-ABC123', '--before', 'b.json', '--out', 'a.json']), {mode: 'after', preflight: false, out: 'a.json', beforeFile: 'b.json', shortId: 'NC-ABC123'}, '[١] --after كامل');
  deq(pa(['--out', 'a.json', '--before', 'b.json', '--short-id', 'NC-ZZ9999', '--after']).mode, 'after', '[١] الترتيب لا يهمّ');
  eq(pa(['--preflight']).mode, 'preflight', '[١] --preflight');
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
  bad([], /USAGE: --before --out/, '[١] بلا وسائط');
  bad(['--before'], /--out/, '[١] --before بلا --out');
  bad(['--before', '--out'], /يحتاج قيمة/, '[١] --out بلا قيمة');
  bad(['--before', '--out', 'b.json', '--short-id', 'NC-ABC123'], /--short-id يخصّ --after/, '[١] --short-id مع --before');
  bad(['--before', 'b.json'], /يخصّ --after/, '[١] --before <ملفّ> بلا --after');
  bad(['--after', '--before', 'b.json', '--out', 'a.json'], /--short-id/, '[١] --after بلا --short-id');
  bad(['--after', '--short-id', 'NC-ABC123', '--out', 'a.json'], /--before <before.json>/, '[١] --after بلا --before');
  bad(['--after', '--short-id', 'NC-ABC123', '--before', 'b.json'], /--out/, '[١] --after بلا --out');
  bad(['--after', '--short-id', 'nc-abc123', '--before', 'b.json', '--out', 'a.json'], /NC-XXXXXX/, '[١] shortId بحروف صغيرة');
  bad(['--after', '--short-id', 'NC-ABC12', '--before', 'b.json', '--out', 'a.json'], /NC-XXXXXX/, '[١] shortId قصير');
  bad(['--after', '--short-id', 'NC-ABC12!', '--before', 'b.json', '--out', 'a.json'], /NC-XXXXXX/, '[١] shortId بحرف غير مسموح');
  bad(['--after', '--before', '--short-id', 'NC-ABC123', '--out', 'a.json'], /USAGE/, '[١] --after مع --before بلا قيمة (وضعان معاً)');
  bad(['--preflight', '--out', 'a.json'], /--preflight وحدها/, '[١] --preflight مع غيرها');
  bad(['--before', '--out', 'b.json', '--email', 'x@y.z'], /وسيط مجهول --email/, '[١] البريد لا يُقبل من سطر الأمر (وسيط مجهول)');
  bad(['--before', '--out', 'b.json', '--s10-email', 'x@y.z'], /وسيط مجهول/, '[١] ولا بأيّ اسم آخر');
  bad(['x'], /وسيط مجهول \(موضعي\)/, '[١] وسيط موضعي');
  eq(L.S10_EMAIL_ENV, 'S10_ACCOUNT_EMAIL', '[١] اسم متغيّر البيئة المعلَن');

  // ═══ ٢ — الحكم ═══
  const before = {accountHash: hashIdForLog('uid-s10'), scansRemaining: 10, takenAtMs: NOW, accountReportsCount: 7};
  const T = {s: 1_800_000_100, n: 500};
  const good = () => ({
    reports: {found: 1, accountHash: before.accountHash, scanIdHash: hashIdForLog('scan-1'), createdAtMs: NOW + 60_000, createTime: {...T}},
    raw: {exists: true, createTime: {...T}}, claim: {exists: false, reservationState: 'ABSENT'},
    user: {docExists: true, scansRemaining: 9}, account: {reportsNow: 8},
  });
  const ev = (mut) => { const f = good(); mut(f); return L.evaluateAfter(f, before); };
  const V = L.VERDICT;
  let r = ev(() => {});
  deq([r.verdict, r.failed, r.undetermined], [V.SERVER_OK, [], []], '[٢] الأربعة سليمة: SERVER_OK');
  deq([r.conditions.A.state, r.conditions.B.state, r.conditions.C.state, r.conditions.D.state], [S.A_REPORT_FOUND, S.B_RAW_ATOMIC_OK, S.C_DEDUCTED_ONCE_OK, S.D_NO_PENDING_RESERVATION_OK], '[٢] وكل شرط بحالته المسمّاة');
  eq(r.conditions.C.delta, 1, '[٢] ج: delta = 1');
  eq(r.conditions.C.newReports, 1, '[٢] ج: تقرير جديد واحد');
  for (const rs of ['NULL', 'FIELD_ABSENT', 'ABSENT']) {
    r = ev((f) => { f.claim = {exists: rs !== 'ABSENT', reservationState: rs}; });
    eq(r.verdict, V.SERVER_OK, `[٢] قفل (${rs}): لا حجز معلّق فمقبول`);
  }
  r = ev((f) => { f.claim = {exists: true, reservationState: 'PRESENT'}; });
  deq([r.verdict, r.failed], [V.SERVER_FAIL, [S.D_RESERVATION_PENDING]], '[٢] د: حجز معلّق: SERVER_FAIL D_RESERVATION_PENDING');
  r = ev((f) => { f.claim = {exists: true, reservationState: 'UNREADABLE'}; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.D_RESERVATION_UNREADABLE]], '[٢] د: reservation بنوع غير مقروء: لا يُحكم');
  r = ev((f) => { f.reports = {found: 0}; });
  deq([r.verdict, r.failed, r.conditions.B.state], [V.SERVER_FAIL, [S.A_REPORT_ABSENT], S.NOT_EVALUATED], '[٢] أ: لا تقرير: SERVER_FAIL A_REPORT_ABSENT وباقي الشروط NOT_EVALUATED');
  r = ev((f) => { f.reports = {found: 2}; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.A_SHORT_ID_AMBIGUOUS]], '[٢] أ: تقريران بالمعرّف نفسه: لا يُحكم');
  r = ev((f) => { f.raw = {exists: false, createTime: null}; });
  deq([r.verdict, r.failed], [V.SERVER_FAIL, [S.B_RAW_ABSENT]], '[٢] ب: بلا reportRaw: SERVER_FAIL B_RAW_ABSENT');
  r = ev((f) => { f.raw.createTime = {s: T.s, n: T.n + 1}; });
  deq([r.verdict, r.failed], [V.SERVER_FAIL, [S.B_RAW_CREATE_TIME_DIFFERS]], '[٢] ب: createTime مختلف بنانوثانية: SERVER_FAIL (ليس دفعة ذرّية)');
  r = ev((f) => { f.raw.createTime = {s: T.s + 1, n: T.n}; });
  eq(r.failed[0], S.B_RAW_CREATE_TIME_DIFFERS, '[٢] ب: وبثانية');
  r = ev((f) => { f.reports.createTime = null; });
  eq(r.failed[0], S.B_RAW_CREATE_TIME_DIFFERS, '[٢] ب: createTime التقرير غير مقروء: يُعدّ مختلفاً (لا يُقرأ مطابقة)');
  r = ev((f) => { f.user.scansRemaining = 8; });
  deq([r.verdict, r.failed], [V.SERVER_FAIL, [S.C_DOUBLE_DEDUCTION]], '[٢] ج: خصم مضاعف (−2): SERVER_FAIL');
  r = ev((f) => { f.user.scansRemaining = 5; });
  eq(r.failed[0], S.C_DOUBLE_DEDUCTION, '[٢] ج: −5 أيضاً مضاعف');
  r = ev((f) => { f.user.scansRemaining = 10; });
  deq([r.verdict, r.failed], [V.SERVER_FAIL, [S.C_NO_DEDUCTION]], '[٢] ج: لا خصم: SERVER_FAIL C_NO_DEDUCTION');
  r = ev((f) => { f.user.scansRemaining = 12; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.C_BALANCE_INCREASED]], '[٢] ج: الرصيد زاد (شراء/استرداد بين اللقطتين): لا يُحكم');
  r = ev((f) => { f.account.reportsNow = 9; });
  deq([r.verdict, r.undetermined, r.conditions.C.newReports], [V.UNDETERMINED, [S.C_OTHER_SCAN_BETWEEN_SNAPSHOTS], 2], '[٢] ج: تقريران جديدان: «فحص آخر بين اللقطتين» لا يُحكم');
  r = ev((f) => { f.account.reportsNow = 7; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.C_OTHER_SCAN_BETWEEN_SNAPSHOTS]], '[٢] ج: صفر تقارير جديدة (والتقرير موجود): لا يُحكم (تناقض لا يُقرأ نجاحاً)');
  r = ev((f) => { f.user.scansRemaining = 8; f.account.reportsNow = 10; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.C_OTHER_SCAN_BETWEEN_SNAPSHOTS]], '[٢] ج: الرصيد −2 مع تقريرين جديدين: لا يُعدّ خصماً مضاعفاً (فحصان)');
  r = ev((f) => { f.reports.createdAtMs = NOW - 3_600_000; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.C_REPORT_PREDATES_BEFORE_SNAPSHOT]], '[٢] ج: التقرير أقدم من اللقطة بساعة: لا يُحكم (shortId لتقرير آخر)');
  r = ev((f) => { f.reports.createdAtMs = NOW - L.CLOCK_SKEW_TOLERANCE_MS + 1000; });
  eq(r.verdict, V.SERVER_OK, '[٢] ج: داخل تسامح الساعة (5 دقائق): مقبول');
  r = ev((f) => { f.reports.createdAtMs = null; });
  eq(r.verdict, V.SERVER_OK, '[٢] ج: createdAt غير مقروء لا يُسقط الحكم (العدّ بفرق التقارير لا بالوقت)');
  r = ev((f) => { f.user = {docExists: false, scansRemaining: undefined}; });
  deq([r.verdict, r.undetermined], [V.UNDETERMINED, [S.C_USER_DOC_ABSENT]], '[٢] ج: مستند المستخدم غائب: لا يُحكم');
  for (const bad2 of ['9', null, undefined, NaN]) {
    r = ev((f) => { f.user.scansRemaining = bad2; });
    eq(r.undetermined[0], S.C_BALANCE_UNREADABLE, `[٢] ج: الرصيد بقيمة ${String(bad2)}: C_BALANCE_UNREADABLE (لا يُقرأ صفراً)`);
  }
  r = ev((f) => { f.account.reportsNow = null; });
  eq(r.undetermined[0], S.C_OTHER_SCAN_BETWEEN_SNAPSHOTS, '[٢] ج: عدد تقارير الحساب غير مقروء: لا يُحكم');
  r = ev((f) => { f.reports.accountHash = hashIdForLog('someone-else'); f.raw = {exists: false, createTime: null}; f.claim = {exists: true, reservationState: 'PRESENT'}; });
  deq([r.verdict, r.failed, r.undetermined], [V.UNDETERMINED, [], [S.C_ACCOUNT_HASH_MISMATCH]], '[٢] تقرير حساب آخر: لا يُحكم ولا يُنسب فشل (ب ود معلوماتيان)');
  ok(r.conditions.B.informationalOnly === true && r.conditions.D.informationalOnly === true, '[٢] وب ود موسومان informationalOnly');
  r = ev((f) => { f.reports.accountHash = null; });
  eq(r.undetermined[0], S.C_ACCOUNT_HASH_MISMATCH, '[٢] تقرير بلا userId نصّي: لا يُحكم');
  r = ev((f) => { f.raw = {exists: false, createTime: null}; f.claim = {exists: true, reservationState: 'PRESENT'}; f.user.scansRemaining = 10; });
  deq(r.failed, [S.B_RAW_ABSENT, S.D_RESERVATION_PENDING, S.C_NO_DEDUCTION], '[٢] كل ما فشل يُسمّى معاً (ب ود وج)');
  r = ev((f) => { f.raw = {exists: false, createTime: null}; f.account.reportsNow = 10; });
  deq([r.verdict, r.failed, r.undetermined], [V.SERVER_FAIL, [S.B_RAW_ABSENT], [S.C_OTHER_SCAN_BETWEEN_SNAPSHOTS]], '[٢] فشل صريح مع غموض: SERVER_FAIL ويُذكر الغموض أيضاً');
  eq(L.exitCodeOf(V.SERVER_OK), 0, '[٢] رمز SERVER_OK = 0');
  eq(L.exitCodeOf(V.SERVER_FAIL), 1, '[٢] رمز SERVER_FAIL = 1');
  eq(L.exitCodeOf(V.UNDETERMINED), 3, '[٢] رمز UNDETERMINED = 3');
  eq(L.EXIT.ERROR, 2, '[٢] رمز الخطأ = 2');
  for (const s of Object.values(S)) eq(S[s], s, `[٢] قيمة الحالة ${s} = اسمها`);

  // ═══ ٣ — نصوص القرار ═══
  eq(L.ROLLBACK_COMMIT, 'd5b6c29', '[٣] نقطة التراجع بنصّ القرار');
  eq(L.decisionFor(V.SERVER_FAIL).forThisVerdict, 'فشل في جانب الخادم (لا تقرير، أو لا reportRaw، أو خصم مضاعف، أو حجز معلّق): ترجع الدوالّ إلى d5b6c29 وتبقى القواعد.', '[٣] SERVER_FAIL ⇐ نصّ القرار حرفياً');
  eq(L.decisionFor(V.UNDETERMINED).forThisVerdict, 'إن تعذّر التمييز: يُرجَع الاثنان.', '[٣] UNDETERMINED ⇐ نصّ القرار حرفياً');
  eq(L.decisionFor(V.SERVER_OK).forThisVerdict, 'الخادم سليم من جهة هذا الفحص: لا تراجع للدوالّ.', '[٣] SERVER_OK ⇐ لا تراجع للدوالّ (والهاتف في النصّ التالي)');
  for (const v of Object.values(V)) ok(/الخادم سليم والهاتف لا يعرض التقرير: ترجع القواعد إلى نسختها الاحتياطية/.test(L.decisionFor(v).phoneNote) && /يحكم فيه المستخدم بعينه/.test(L.decisionFor(v).phoneNote), `[٣] ${v}: نصّ الهاتف حاضر ويذكّر أن عرض الهاتف يحكم فيه المستخدم`);

  // ═══ ٤ — ملفّ المخرَج ═══
  const outPath = path.join(tmp, 'out.json');
  L.assertOutWritable(outPath);
  n++;
  const written = L.writeOutputExclusive(outPath, {a: 'عربي', b: 1});
  const bytes = fs.readFileSync(written);
  ok(!(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf), '[٤] UTF-8 بلا BOM');
  deq(JSON.parse(bytes.toString('utf8')), {a: 'عربي', b: 1}, '[٤] المحتوى يُقرأ UTF-8');
  await throwsReason(async () => L.writeOutputExclusive(outPath, {x: 1}), /OUT_EXISTS/, '[٤] الكتابة على ملفّ موجود: OUT_EXISTS (wx — لا استبدال)');
  deq(JSON.parse(fs.readFileSync(outPath, 'utf8')), {a: 'عربي', b: 1}, '[٤] والملفّ الموجود لم يُمسّ');
  await throwsReason(async () => L.assertOutWritable(outPath), /OUT_EXISTS/, '[٤] والفحص المسبق يرفضه قبل أيّ اتصال');
  await throwsReason(async () => L.assertOutWritable(path.join(tmp, 'no-such-dir', 'o.json')), /OUT_DIR_MISSING/, '[٤] مجلّد غير موجود: OUT_DIR_MISSING (لا يُنشأ)');

  // ═══ ٥ — ملفّ «قبل» ═══
  const goodBefore = {mode: 's10-before', schema: 1, takenAtMs: NOW, takenAtIso: new Date(NOW).toISOString(), accountHash: before.accountHash, scansRemaining: 10, accountReportsCount: 7};
  const bf = path.join(tmp, 'before.json');
  fs.writeFileSync(bf, JSON.stringify(goodBefore));
  deq(L.readBeforeFile(bf).accountHash, before.accountHash, '[٥] ملفّ «قبل» صالح يُقرأ');
  fs.writeFileSync(bf, `﻿${JSON.stringify(goodBefore)}`);
  eq(L.readBeforeFile(bf).scansRemaining, 10, '[٥] ويُقرأ مع BOM (ملفّ حرّره PowerShell)');
  const invalid = (mut, re, m) => { fs.writeFileSync(bf, JSON.stringify(mut({...goodBefore}))); return throwsReason(async () => L.readBeforeFile(bf), re, m); };
  await invalid((b) => ({...b, mode: 's10-after'}), /BEFORE_FILE_INVALID: mode/, '[٥] وضع آخر');
  await invalid((b) => ({...b, schema: 2}), /BEFORE_FILE_INVALID: schema/, '[٥] مخطّط آخر');
  await invalid((b) => ({...b, accountHash: SECRET_UID}), /BEFORE_FILE_INVALID: accountHash/, '[٥] معرّف خامّ بدل المُهشَّر يُرفض (لا يُقبل ملفّ يحمل uid)');
  await invalid((b) => ({...b, scansRemaining: '10'}), /BEFORE_FILE_INVALID: scansRemaining/, '[٥] رصيد نصّي');
  await invalid((b) => ({...b, takenAtMs: null}), /BEFORE_FILE_INVALID: takenAtMs/, '[٥] وقت غائب');
  await invalid((b) => ({...b, accountReportsCount: -1}), /BEFORE_FILE_INVALID: accountReportsCount/, '[٥] عدد سالب');
  await invalid((b) => ({mode: 'x'}), /BEFORE_FILE_INVALID: mode,schema,accountHash,scansRemaining,takenAtMs,accountReportsCount/, '[٥] ويُسمّي كل حقل مرفوض (أسماء لا قيم)');
  fs.writeFileSync(bf, '{not json SECRET-IN-FILE');
  let badErr = null;
  try { L.readBeforeFile(bf); } catch (e) { badErr = e; }
  ok(badErr && /BEFORE_FILE_UNREADABLE/.test(badErr.message) && !badErr.message.includes('SECRET-IN-FILE'), '[٥] ملفّ فاسد: سبب مسمّى بلا اقتباس من محتواه');
  await throwsReason(async () => L.readBeforeFile(path.join(tmp, 'no-such-before.json')), /BEFORE_FILE_UNREADABLE/, '[٥] ملفّ غائب');

  // ═══ ٦ — لقطة «قبل» ═══
  const mkAuth = (uid = SECRET_UID, calls = []) => ({getUserByEmail: async (email) => {
    calls.push(email);
    if (email === SECRET_EMAIL) return {uid};
    throw Object.assign(new Error(`There is no user record corresponding to ${email}`), {code: 'auth/user-not-found'});
  }});
  const dbWith = (users, reports) => makeMemDb({users, reports});
  const snapDb = () => dbWith({[SECRET_UID]: {scansRemaining: 10}}, {r1: {userId: SECRET_UID}, r2: {userId: SECRET_UID}, r3: {userId: 'someone-else'}});
  const authCalls = [];
  const snap = await L.takeBeforeSnapshot({db: snapDb(), auth: mkAuth(SECRET_UID, authCalls), email: `  ${SECRET_EMAIL}  `, nowMs: NOW});
  deq(authCalls, [SECRET_EMAIL], '[٦] getUserByEmail يستلم البريد مقصوصاً');
  eq(snap.scansRemaining, 10, '[٦] الرصيد');
  eq(snap.accountReportsCount, 2, '[٦] عدد تقارير الحساب (لا تقارير الآخرين)');
  eq(snap.accountHash, hashIdForLog(SECRET_UID), '[٦] المعرّف مُهشَّر بـhashIdForLog');
  eq(snap.takenAtMs, NOW, '[٦] والوقت');
  const snapText = JSON.stringify(snap);
  ok(!snapText.includes(SECRET_EMAIL) && !snapText.includes(SECRET_UID) && !snapText.includes('SECRET'), '[٦] اللقطة بلا بريد ولا uid خامّ');
  deq(Object.keys(snap).sort(), ['accountHash', 'accountReportsCount', 'mode', 'scansRemaining', 'schema', 'takenAtIso', 'takenAtMs'], '[٦] وحقولها هذه وحدها');
  await throwsReason(() => L.takeBeforeSnapshot({db: snapDb(), auth: mkAuth(), email: undefined, nowMs: NOW}), /^S10_EMAIL_ENV_MISSING$/, '[٦] المتغيّر غائب: S10_EMAIL_ENV_MISSING');
  await throwsReason(() => L.takeBeforeSnapshot({db: snapDb(), auth: mkAuth(), email: '   ', nowMs: NOW}), /^S10_EMAIL_ENV_MISSING$/, '[٦] المتغيّر فراغ: نفسه');
  let emailErr = null;
  try { await L.takeBeforeSnapshot({db: snapDb(), auth: mkAuth(), email: 'not-an-email-SECRET', nowMs: NOW}); } catch (e) { emailErr = e; }
  ok(emailErr && emailErr.message === 'S10_EMAIL_INVALID' && !emailErr.message.includes('SECRET'), '[٦] بريد بلا @: S10_EMAIL_INVALID بلا اقتباس');
  let nf = null;
  try { await L.takeBeforeSnapshot({db: snapDb(), auth: mkAuth(), email: 'nobody@example.test', nowMs: NOW}); } catch (e) { nf = e; }
  ok(nf && nf.reason === 'S10_ACCOUNT_NOT_FOUND' && nf.code === 'auth/user-not-found' && !nf.message.includes('nobody'), '[٦] حساب غير موجود: S10_ACCOUNT_NOT_FOUND (رسالة المزوّد — وفيها البريد — لا تُنقل)');
  await throwsReason(() => L.takeBeforeSnapshot({db: snapDb(), auth: {getUserByEmail: async () => { throw Object.assign(new Error('boom'), {code: 'auth/internal-error'}); }}, email: SECRET_EMAIL, nowMs: NOW}), /^AUTH_LOOKUP_FAILED$/, '[٦] خطأ Auth آخر: AUTH_LOOKUP_FAILED');
  await throwsReason(() => L.takeBeforeSnapshot({db: snapDb(), auth: {getUserByEmail: async () => ({})}, email: SECRET_EMAIL, nowMs: NOW}), /^AUTH_LOOKUP_FAILED$/, '[٦] ردّ بلا uid: AUTH_LOOKUP_FAILED');
  await throwsReason(() => L.takeBeforeSnapshot({db: dbWith({}, {}), auth: mkAuth(), email: SECRET_EMAIL, nowMs: NOW}), /^USER_DOC_ABSENT$/, '[٦] مستند المستخدم غائب: USER_DOC_ABSENT');
  for (const v of [undefined, null, '10', NaN]) {
    await throwsReason(() => L.takeBeforeSnapshot({db: dbWith({[SECRET_UID]: {scansRemaining: v}}, {}), auth: mkAuth(), email: SECRET_EMAIL, nowMs: NOW}), /^SCANS_REMAINING_NOT_A_NUMBER$/, `[٦] scansRemaining = ${String(v)}: لا لقطة (لا يُقرأ صفراً)`);
  }

  // ═══ ٧ — جمع حقائق «بعد» على db مزيَّف ═══
  const uid1 = 'uid-after-1';
  const cols = {
    reports: {
      'scan-ok': {userId: uid1, shortId: 'NC-OK0001', createdAt: Timestamp.fromMillis(NOW + 60_000)},
      'scan-dup-a': {userId: uid1, shortId: 'NC-DUP001', createdAt: Timestamp.fromMillis(NOW)},
      'scan-dup-b': {userId: uid1, shortId: 'NC-DUP001', createdAt: Timestamp.fromMillis(NOW)},
      'scan-nouid': {shortId: 'NC-NOUID1'},
      'old-1': {userId: uid1, shortId: 'NC-OLD001', createdAt: Timestamp.fromMillis(NOW - 86_400_000)},
    },
    reportRaw: {'scan-ok': {scanId: 'scan-ok'}},
    scanClaims: {},
    users: {[uid1]: {scansRemaining: 9}},
  };
  const createTimes = {'reports/scan-ok': {seconds: 1_800_000_100, nanoseconds: 7}, 'reportRaw/scan-ok': {seconds: 1_800_000_100, nanoseconds: 7}};
  const memDb = makeMemDb(cols, {createTimes});
  let facts = await L.gatherAfterFacts({db: memDb, shortId: 'NC-OK0001'});
  eq(facts.reports.found, 1, '[٧] التقرير وُجد بـshortId');
  eq(facts.reports.accountHash, hashIdForLog(uid1), '[٧] والحساب مُهشَّر');
  eq(facts.reports.scanIdHash, hashIdForLog('scan-ok'), '[٧] ومعرّف الفحص مُهشَّر');
  deq(facts.reports.createTime, {s: 1_800_000_100, n: 7}, '[٧] createTime التقرير');
  deq(facts.raw, {exists: true, createTime: {s: 1_800_000_100, n: 7}}, '[٧] وreportRaw وcreateTime له');
  deq(facts.claim, {exists: false, reservationState: 'ABSENT'}, '[٧] ولا قفل');
  deq(facts.user, {docExists: true, scansRemaining: 9}, '[٧] والرصيد');
  eq(facts.account.reportsNow, 4, '[٧] وعدد تقارير الحساب كلّها (للفرق مع «قبل»)');
  ok(!JSON.stringify(facts).includes('scan-ok') && !JSON.stringify(facts).includes(uid1), '[٧] الحقائق بلا معرّف خامّ');
  facts = await L.gatherAfterFacts({db: memDb, shortId: 'NC-NOSUCH'});
  deq(facts.reports, {found: 0, accountHash: null, scanIdHash: null, createdAtMs: null, createTime: null}, '[٧] shortId غير موجود: found=0');
  facts = await L.gatherAfterFacts({db: memDb, shortId: 'NC-DUP001'});
  eq(facts.reports.found, 2, '[٧] مكرَّر: found=2 ولا يُكمل جمعاً');
  eq(facts.raw, undefined, '[٧] ولا يقرأ ما بعده');
  facts = await L.gatherAfterFacts({db: memDb, shortId: 'NC-NOUID1'});
  eq(facts.reports.accountHash, null, '[٧] تقرير بلا userId: الحساب null');
  eq(facts.account.reportsNow, null, '[٧] وعدد الحساب null (لا يُخمَّن)');
  const withClaims = (claim) => makeMemDb({...cols, scanClaims: {'scan-ok': claim}}, {createTimes});
  for (const [claim, exp] of [[{reservation: null}, 'NULL'], [{}, 'FIELD_ABSENT'], [{reservation: {userId: uid1}}, 'PRESENT'], [{reservation: 'x'}, 'UNREADABLE']]) {
    facts = await L.gatherAfterFacts({db: withClaims(claim), shortId: 'NC-OK0001'});
    eq(facts.claim.reservationState, exp, `[٧] قفل ${JSON.stringify(claim)}: ${exp}`);
  }
  eq(memDb.writeAttempts.length, 0, '[٧] الجمع لم يحاول كتابة');

  // ═══ ٨ — main (db وAuth مزيَّفان) ═══
  const run = async (argv, over = {}) => {
    const outs = [];
    const errs = [];
    const code = await main(argv, {now: () => NOW, out: (s) => outs.push(s), err: (s) => errs.push(s), env: over.env || {}, db: over.db, auth: over.auth || mkAuth()});
    return {code, outs, errs};
  };
  const bPath = path.join(tmp, 'main-before.json');
  let m = await run(['--before', '--out', bPath], {env: {S10_ACCOUNT_EMAIL: SECRET_EMAIL}, db: snapDb()});
  eq(m.code, 0, '[٨] --before: رمز 0');
  const wroteBefore = fs.readFileSync(bPath, 'utf8');
  const bj = JSON.parse(wroteBefore);
  eq(bj.projectId, PROJECT_ID, '[٨] ملفّ «قبل» يحمل projectId');
  eq(Object.keys(bj)[0], 'projectId', '[٨] وهو أوّل حقل');
  eq(bj.accountHash, hashIdForLog(SECRET_UID), '[٨] المعرّف مُهشَّر');
  ok(![wroteBefore, ...m.outs, ...m.errs].some((t) => t.includes(SECRET_EMAIL) || t.includes(SECRET_UID) || t.includes('SECRET')), '[٨] لا بريد ولا uid خامّ في الملفّ ولا في stdout ولا في stderr');
  m = await run(['--before', '--out', bPath], {env: {S10_ACCOUNT_EMAIL: SECRET_EMAIL}, db: snapDb()});
  eq(m.code, 2, '[٨] --before على ملفّ موجود: رمز 2');
  ok(m.errs.some((e) => /OUT_EXISTS/.test(e)) && m.outs.length === 0, '[٨] OUT_EXISTS بلا مخرَج');
  m = await run(['--before', '--out', path.join(tmp, 'b2.json')], {env: {}, db: snapDb()});
  eq(m.code, 2, '[٨] المتغيّر غير مضبوط: رمز 2');
  ok(m.errs.some((e) => /S10_EMAIL_ENV_MISSING/.test(e)) && !fs.existsSync(path.join(tmp, 'b2.json')), '[٨] S10_EMAIL_ENV_MISSING ولا ملفّ');
  m = await run(['--before', '--out', path.join(tmp, 'b3.json')], {env: {S10_ACCOUNT_EMAIL: 'nobody@example.test'}, db: snapDb()});
  eq(m.code, 2, '[٨] حساب غير موجود: رمز 2');
  ok(!m.errs.join('\n').includes('nobody') && /S10_ACCOUNT_NOT_FOUND/.test(m.errs.join('\n')), '[٨] باسم السبب وبلا بريد');
  // --after
  const afterDb = () => makeMemDb({
    reports: {'scan-ok': {userId: SECRET_UID, shortId: 'NC-OK0001', createdAt: Timestamp.fromMillis(NOW + 60_000)}, r1: {userId: SECRET_UID}, r2: {userId: SECRET_UID}},
    reportRaw: {'scan-ok': {scanId: 'scan-ok'}}, scanClaims: {}, users: {[SECRET_UID]: {scansRemaining: 9}},
  }, {createTimes: {'reports/scan-ok': {seconds: 5, nanoseconds: 5}, 'reportRaw/scan-ok': {seconds: 5, nanoseconds: 5}}});
  // before.json الذي كتبه --before: تقارير الحساب كانت 2 والرصيد 10؛ الآن 3 والرصيد 9
  const aPath = path.join(tmp, 'main-after.json');
  m = await run(['--after', '--short-id', 'NC-OK0001', '--before', bPath, '--out', aPath], {db: afterDb()});
  eq(m.code, 0, '[٨] --after سليم: رمز 0 (SERVER_OK)');
  const aj = JSON.parse(fs.readFileSync(aPath, 'utf8'));
  eq(aj.verdict, 'SERVER_OK', '[٨] الحكم في الملفّ');
  eq(Object.keys(aj)[0], 'projectId', '[٨] projectId أوّل حقل');
  ok(![fs.readFileSync(aPath, 'utf8'), ...m.outs, ...m.errs].some((t) => t.includes(SECRET_UID) || t.includes('scan-ok') || t.includes('NC-OK0001')), '[٨] لا uid ولا scanId ولا shortId خامّ في أيّ مخرَج (المهشَّر فقط)');
  eq(aj.input.shortIdHash, hashIdForLog('NC-OK0001'), '[٨] shortId مُهشَّر في الملفّ');
  ok(m.outs[0].startsWith('verdict=SERVER_OK'), '[٨] وstdout يبدأ بالحكم');
  ok(m.outs.some((o) => /يحكم فيه المستخدم بعينه/.test(o)), '[٨] ويذكّر أن عرض الهاتف يحكم فيه المستخدم');
  const failDb = makeMemDb({
    reports: {'scan-x': {userId: SECRET_UID, shortId: 'NC-NORAW1', createdAt: Timestamp.fromMillis(NOW + 1000)}, r1: {userId: SECRET_UID}, r2: {userId: SECRET_UID}},
    reportRaw: {}, scanClaims: {}, users: {[SECRET_UID]: {scansRemaining: 9}},
  });
  m = await run(['--after', '--short-id', 'NC-NORAW1', '--before', bPath, '--out', path.join(tmp, 'after-fail.json')], {db: failDb});
  eq(m.code, 1, '[٨] بلا reportRaw: رمز 1 (SERVER_FAIL)');
  ok(m.outs.join('\n').includes('الدوالّ إلى d5b6c29 وتبقى القواعد'), '[٨] ويطبع نصّ قرار التراجع المقابل');
  m = await run(['--after', '--short-id', 'NC-NOSUCH', '--before', bPath, '--out', path.join(tmp, 'after-nof.json')], {db: afterDb()});
  eq(m.code, 1, '[٨] لا تقرير: رمز 1');
  m = await run(['--after', '--short-id', 'NC-OK0001', '--before', path.join(tmp, 'no-before.json'), '--out', path.join(tmp, 'after-nb.json')], {db: afterDb()});
  eq(m.code, 2, '[٨] ملفّ «قبل» غائب: رمز 2');
  ok(m.errs.some((e) => /BEFORE_FILE_UNREADABLE/.test(e)) && !fs.existsSync(path.join(tmp, 'after-nb.json')), '[٨] باسم السبب ولا ملفّ');
  m = await run(['--after', '--short-id', 'NC-OK0001', '--before', bPath, '--out', aPath], {db: afterDb()});
  eq(m.code, 2, '[٨] ملفّ «بعد» موجود: رمز 2 (لا استبدال)');
  const mixedDb = afterDb();
  m = await run(['--bogus'], {db: mixedDb});
  eq(m.code, 2, '[٨] وسيط مجهول: رمز 2');
  eq(mixedDb.reads.length, 0, '[٨] ولا اتصال');
  m = await run(['--preflight'], {env: {S10_ACCOUNT_EMAIL: SECRET_EMAIL}});
  eq(m.code, 0, '[٨] --preflight: رمز 0');
  const pj = JSON.parse(m.outs[0]);
  ok(pj.network === false && pj.ok === true && pj.checks.length >= 20 && pj.checks.every((c) => c.ok) && pj.s10EmailEnvPresent === true, '[٨] --preflight بلا شبكة وكل فحوصه ناجحة ويقول إن المتغيّر مضبوط');
  ok(!m.outs[0].includes(SECRET_EMAIL), '[٨] ولا يطبع البريد');
  eq(safeErrorText(new L.S10Error('X_REASON', 'c1')), 'X_REASON (code=c1)', '[٨] safeErrorText لـS10Error: السبب والرمز');
  ok(!safeErrorText(Object.assign(new Error(`leak ${SECRET_EMAIL}`), {code: 7})).includes(SECRET_EMAIL), '[٨] safeErrorText لخطأ آخر: الصنف والرمز لا الرسالة (القاعدة 36)');

  // ═══ ٩ — بنية الشيفرة ═══
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const read = (rel) => strip(fs.readFileSync(path.join(__dirname, '..', 'scripts', rel), 'utf8').replace(/\r\n/g, '\n'));
  const cli = read('verify-s10-postdeploy-readonly.js');
  const lib = read('lib/s10PostDeploy.js');
  for (const [name, src] of [['السكربت', cli], ['المكتبة', lib]]) {
    ok(!/\.(set|update|delete|create|add)\(|\.batch\(|runTransaction|bulkWriter|recursiveDelete|appendFile|createWriteStream|unlink|createUser|deleteUser|updateUser|setCustomUserClaims/.test(src), `[٩] ${name}: لا كتابة في Firestore ولا Auth ولا ملفّات إضافية`);
  }
  eq((lib.match(/writeFileSync\(/g) || []).length, 1, '[٩] كتابة ملفّ واحدة في المكتبة (ملفّ المخرَج)');
  ok(/flag: 'wx'/.test(lib) && /encoding: 'utf8'/.test(lib), '[٩] بالعلم wx وUTF-8');
  ok(!/writeFileSync|writeFile\(/.test(cli), '[٩] والسكربت نفسه لا يكتب ملفّاً مباشرة (عبر المكتبة وحدها)');
  ok(/wrapReadOnly\(injected\.db\)/.test(cli), '[٩] db مغلَّف بـwrapReadOnly (حتى المحقون)');
  ok(/getUserByEmail: \(email\) => app\.auth\(\)\.getUserByEmail\(email\)/.test(cli) && /Object\.freeze\(\{getUserByEmail/.test(cli), '[٩] Auth: عملية getUserByEmail وحدها معروضة (مجمَّدة)');
  eq((cli.match(/\.auth\(\)/g) || []).length, 1, '[٩] ولا استعمال آخر لـAuth');
  ok(/initializeApp\(\{projectId: PROJECT_ID\}/.test(cli) && !/initializeApp\(\)/.test(cli), '[٩] projectId مثبَّت');
  ok(/env\[L\.S10_EMAIL_ENV\]/.test(cli), '[٩] البريد يُقرأ من متغيّر البيئة المسمّى وحده');
  const logsEmail = [...cli.matchAll(/(?:out|err|console\.(?:log|error))\(([^;]*)\)/g)].some((mm) => /\bemail\b/.test(mm[1]));
  eq(logsEmail, false, '[٩] لا نداء طباعة يمرّر المتغيّر email');

  fs.rmSync(tmp, {recursive: true, force: true});
  console.log(`\nverifyS10PostdeployReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
