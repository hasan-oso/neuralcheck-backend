'use strict';

// ===================================================================
// s10PostDeploy — فحص الخادم بعد نشر الدوالّ والقواعد: هل صدر تقرير S10 وكُتب خامّه ذرّياً وخُصم الرصيد مرّة وحدها ولم يبقَ حجز؟
// يستعمله verify-s10-postdeploy-readonly.js (قراءة بحتة). قبل نشر الأمان، 2026-10-09 +03.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق):
//   «بعد نشر الدوالّ والقواعد مباشرة، أجري فحصاً واحداً من الـS10 وهو على 1.0.10، من الرئيسية. يُقبل إن صدر التقرير، وكُتب reportRaw بالكتابة
//    الذرّية، وخُصم الرصيد مرّة واحدة، ولم يبقَ حجز معلّق. ويُقرأ ذلك بكتلة قراءة تأتيني. وإن فشل: تراجع إلى d5b6c29 قبل أيّ ترحيل.»
//   «نطاق التراجع: … فشل في جانب الخادم (لا تقرير، أو لا reportRaw، أو خصم مضاعف، أو حجز معلّق): ترجع الدوالّ إلى d5b6c29 وتبقى القواعد.
//    الخادم سليم والهاتف لا يعرض التقرير: ترجع القواعد إلى نسختها الاحتياطية. إن تعذّر التمييز: يُرجَع الاثنان. وكتلة القراءة تميّز بين الحالات صراحةً.»
//
// ─── الوضعان ──────────────────────────────────────────────────────────────────────────────────────────────────────
// --before --out <before.json>: قبل الفحص. بريد حساب الـS10 من متغيّر البيئة S10_ACCOUNT_EMAIL (لا من سطر الأمر، ولا يُطبَع ولا يُكتب)، ثم
//   getUserByEmail، فـusers/{uid}.scansRemaining وعدد تقارير الحساب. يكتب: معرّفاً مُهشَّراً (hashIdForLog)، scansRemaining، العدد، والوقت. لا بريد ولا uid خامّ.
// --after --short-id NC-XXXXXX --before <before.json> --out <after.json>: بعد الفحص. يجد التقرير بـshortId ويتحقّق من الشروط الأربعة، كلٌّ بحالة مسمّاة.
//
// ─── الشروط ──────────────────────────────────────────────────────────────────────────────────────────────────────
// (أ) التقرير موجود (reports بـshortId). (ب) reportRaw/{scanId} موجود وcreateTime له يساوي createTime التقرير (الدفعة الذرّية؛ مثبَت في
//   reportRawPlacement.e2e: مستندان في دفعة واحدة = createTime واحد). (ج) الرصيد بعد = قبل − 1 ولحساب التقرير نفسه (المعرّف المُهشَّر يطابق)، وعدد
//   تقارير الحساب الجديدة منذ «قبل» = 1، وإلّا «لا يُحكم: فحص آخر بين اللقطتين». (د) لا حجز معلّق: scanClaims/{scanId} غائب أو reservation = null.
//
// ─── الحكم صريح (القاعدة 22) ────────────────────────────────────────────────────────────────────────────────────
// SERVER_OK · SERVER_FAIL بأسماء ما فشل · UNDETERMINED بسببه. ومع كلٍّ نصّ قرار المستخدم الذي يقابله. وعرض الهاتف يحكم فيه المستخدم بعينه لا هذا السكربت.
// رمز الخروج: 0 SERVER_OK · 1 SERVER_FAIL · 3 UNDETERMINED · 2 خطأ.
//
// قرار تصميم: عدد تقارير الحساب يُقارَن بعدد «قبل» (فرق عدّين)، لا بوقت لحظة «قبل» وحدها، كي لا يعتمد على ساعة جهاز المستخدم؛ والوقت يُستعمل
// فقط لاكتشاف تقرير أقدم من اللقطة (شبكة أمان بتسامح ساعة 5 دقائق).
// ===================================================================

const fs = require('fs');
const path = require('path');
const {hashIdForLog} = require('../../src/utils/logRedaction');

const REPORTS_COLLECTION = 'reports';
const REPORT_RAW_COLLECTION = 'reportRaw';
const USERS_COLLECTION = 'users';
const CLAIMS_COLLECTION = 'scanClaims';

/** اسم متغيّر البيئة الذي يضبطه المستخدم بإدخال مخفيّ — لا يُقرأ من سطر الأمر. */
const S10_EMAIL_ENV = 'S10_ACCOUNT_EMAIL';
const SCHEMA = 1;
const SHORT_ID_PATTERN = /^NC-[A-Z0-9]{6}$/;
const HASH_PATTERN = /^#[0-9a-f]{12}$/;
/** تسامح ساعة جهاز المستخدم عند مقارنة وقت التقرير بوقت اللقطة. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
/** نقطة التراجع بنصّ القرار — مصدر واحد للرقم (القاعدة 24). */
const ROLLBACK_COMMIT = 'd5b6c29';

const EXIT = Object.freeze({SERVER_OK: 0, SERVER_FAIL: 1, ERROR: 2, UNDETERMINED: 3});
const VERDICT = Object.freeze({SERVER_OK: 'SERVER_OK', SERVER_FAIL: 'SERVER_FAIL', UNDETERMINED: 'UNDETERMINED'});

/** حالات الشروط (كل حالة اسم). OK / FAIL / UNDETERMINED في سجلّ STATE_KIND. */
const STATE = Object.freeze({
  A_REPORT_FOUND: 'A_REPORT_FOUND',
  A_REPORT_ABSENT: 'A_REPORT_ABSENT',
  A_SHORT_ID_AMBIGUOUS: 'A_SHORT_ID_AMBIGUOUS',
  B_RAW_ATOMIC_OK: 'B_RAW_ATOMIC_OK',
  B_RAW_ABSENT: 'B_RAW_ABSENT',
  B_RAW_CREATE_TIME_DIFFERS: 'B_RAW_CREATE_TIME_DIFFERS',
  C_DEDUCTED_ONCE_OK: 'C_DEDUCTED_ONCE_OK',
  C_NO_DEDUCTION: 'C_NO_DEDUCTION',
  C_DOUBLE_DEDUCTION: 'C_DOUBLE_DEDUCTION',
  C_ACCOUNT_HASH_MISMATCH: 'C_ACCOUNT_HASH_MISMATCH',
  C_USER_DOC_ABSENT: 'C_USER_DOC_ABSENT',
  C_BALANCE_UNREADABLE: 'C_BALANCE_UNREADABLE',
  C_OTHER_SCAN_BETWEEN_SNAPSHOTS: 'C_OTHER_SCAN_BETWEEN_SNAPSHOTS',
  C_REPORT_PREDATES_BEFORE_SNAPSHOT: 'C_REPORT_PREDATES_BEFORE_SNAPSHOT',
  C_BALANCE_INCREASED: 'C_BALANCE_INCREASED',
  D_NO_PENDING_RESERVATION_OK: 'D_NO_PENDING_RESERVATION_OK',
  D_RESERVATION_PENDING: 'D_RESERVATION_PENDING',
  D_RESERVATION_UNREADABLE: 'D_RESERVATION_UNREADABLE',
  NOT_EVALUATED: 'NOT_EVALUATED',
});
const OK_STATES = new Set([STATE.A_REPORT_FOUND, STATE.B_RAW_ATOMIC_OK, STATE.C_DEDUCTED_ONCE_OK, STATE.D_NO_PENDING_RESERVATION_OK]);
const FAIL_STATES = new Set([STATE.A_REPORT_ABSENT, STATE.B_RAW_ABSENT, STATE.B_RAW_CREATE_TIME_DIFFERS, STATE.C_NO_DEDUCTION, STATE.C_DOUBLE_DEDUCTION, STATE.D_RESERVATION_PENDING]);
// ما سوى ذلك (ما عدا NOT_EVALUATED) = لا يُحكم.

/** نصوص قرار المستخدم (بنصّها) التي تقابل كل حكم. */
const DECISION_TEXT = Object.freeze({
  SERVER_FAIL: `فشل في جانب الخادم (لا تقرير، أو لا reportRaw، أو خصم مضاعف، أو حجز معلّق): ترجع الدوالّ إلى ${ROLLBACK_COMMIT} وتبقى القواعد.`,
  UNDETERMINED: 'إن تعذّر التمييز: يُرجَع الاثنان.',
  PHONE_NOTE: 'الخادم سليم والهاتف لا يعرض التقرير: ترجع القواعد إلى نسختها الاحتياطية. — عرض الهاتف يحكم فيه المستخدم بعينه (من تطبيق 1.0.10 على الهاتف)، لا هذا السكربت.',
});

/** خطأ بسبب مسمّى: الرسالة هي السبب وحده (لا بريد ولا معرّف ولا نصّ مزوّد) — فطباعتها آمنة (القاعدة 36). */
class S10Error extends Error {
  constructor(reason, code) {
    super(reason);
    this.name = 'S10Error';
    this.reason = reason;
    this.code = code === undefined ? null : code;
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// ───────────────────────── الوسائط ─────────────────────────

/**
 * وسيط مجهول = خطأ صريح (القاعدة 22). `--before` بلا قيمة = وضع «قبل»؛ ومعه ملفّ = مُدخَل وضع «بعد».
 * @param {string[]} argv
 * @return {{mode: ?string, preflight: boolean, out: ?string, beforeFile: ?string, shortId: ?string}}
 */
function parseArgs(argv) {
  const out = {mode: null, preflight: false, out: null, beforeFile: null, shortId: null};
  let afterFlag = false;
  let beforeFlag = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preflight') {
      out.preflight = true;
    } else if (a === '--after') {
      afterFlag = true;
    } else if (a === '--before') {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--')) { out.beforeFile = v; i++; } else beforeFlag = true;
    } else if (a === '--out' || a === '--short-id') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`USAGE: ${a} يحتاج قيمة`);
      out[a === '--out' ? 'out' : 'shortId'] = v;
      i++;
    } else {
      throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a : '(موضعي)'}`);
    }
  }
  const usage = 'USAGE: --before --out <before.json> | --after --short-id NC-XXXXXX --before <before.json> --out <after.json> | --preflight';
  if (out.preflight) {
    if (afterFlag || beforeFlag || out.beforeFile || out.out || out.shortId) throw new Error('USAGE: --preflight وحدها');
    out.mode = 'preflight';
    return out;
  }
  if (afterFlag && beforeFlag) throw new Error(usage);
  if (afterFlag) {
    if (!out.shortId) throw new Error('USAGE: --after يحتاج --short-id NC-XXXXXX');
    if (!SHORT_ID_PATTERN.test(out.shortId)) throw new Error('USAGE: --short-id بصيغة NC-XXXXXX (ستّة أحرف كبيرة أو أرقام)');
    if (!out.beforeFile) throw new Error('USAGE: --after يحتاج --before <before.json>');
    if (!out.out) throw new Error('USAGE: --after يحتاج --out <after.json>');
    out.mode = 'after';
    return out;
  }
  if (beforeFlag) {
    if (out.shortId) throw new Error('USAGE: --short-id يخصّ --after');
    if (!out.out) throw new Error('USAGE: --before يحتاج --out <before.json>');
    out.mode = 'before';
    return out;
  }
  if (out.beforeFile) throw new Error('USAGE: --before <ملفّ> يخصّ --after');
  throw new Error(usage);
}

// ───────────────────────── ملفّ المخرَج ─────────────────────────

/** يتحقّق قبل أيّ اتصال أن مجلّد المخرَج موجود وأن الملفّ غير موجود. */
function assertOutWritable(outPath) {
  const abs = path.resolve(outPath);
  const dir = path.dirname(abs);
  let st = null;
  try { st = fs.statSync(dir); } catch (e) { st = null; }
  if (!st || !st.isDirectory()) throw new S10Error('OUT_DIR_MISSING');
  if (fs.existsSync(abs)) throw new S10Error('OUT_EXISTS');
  return abs;
}

/** الكتابة الوحيدة: ملفّ المخرَج، UTF-8 بلا BOM، بالعلم wx (يفشل إن وُجد الملفّ — لا استبدال). */
function writeOutputExclusive(outPath, obj) {
  const abs = path.resolve(outPath);
  try {
    fs.writeFileSync(abs, `${JSON.stringify(obj, null, 2)}\n`, {flag: 'wx', encoding: 'utf8'});
  } catch (e) {
    throw new S10Error(e && e.code === 'EEXIST' ? 'OUT_EXISTS' : 'OUT_WRITE_FAILED', e && e.code);
  }
  return abs;
}

/**
 * عدد تقارير حساب (reports بـuserId == uid) — **الطريقة الوحيدة** التي يعدّ بها هذا الملفّ وسكربتات فحص الجهاز ٠٣ (القاعدة 24: مصدر واحد لا نسخة في كل ملفّ). قراءة بحتة (count()).
 * @param {Object} db Firestore (مغلَّف بـwrapReadOnly في الاستعمال).
 * @param {string} uid
 * @return {Promise<number>}
 */
async function countAccountReports(db, uid) {
  return (await db.collection(REPORTS_COLLECTION).where('userId', '==', uid).count().get()).data().count;
}

// ───────────────────────── وضع «قبل» ─────────────────────────

/**
 * @param {Object} p
 * @param {Object} p.db Firestore (مغلَّف بـwrapReadOnly)
 * @param {{getUserByEmail: function(string): Promise<{uid: string}>}} p.auth عمليّة Auth الوحيدة المتاحة
 * @param {?string} p.email من متغيّر البيئة (لا يُطبَع ولا يُكتب)
 * @param {number} p.nowMs
 * @return {Promise<Object>} لقطة «قبل» — بلا بريد ولا uid خامّ
 */
async function takeBeforeSnapshot({db, auth, email, nowMs}) {
  if (typeof email !== 'string' || email.trim() === '') throw new S10Error('S10_EMAIL_ENV_MISSING');
  const addr = email.trim();
  if (!addr.includes('@')) throw new S10Error('S10_EMAIL_INVALID');
  let user;
  try {
    user = await auth.getUserByEmail(addr);
  } catch (e) {
    throw new S10Error(e && e.code === 'auth/user-not-found' ? 'S10_ACCOUNT_NOT_FOUND' : 'AUTH_LOOKUP_FAILED', e && e.code);
  }
  if (!user || typeof user.uid !== 'string' || user.uid === '') throw new S10Error('AUTH_LOOKUP_FAILED', 'NO_UID');
  const uid = user.uid;
  const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
  if (!userSnap.exists) throw new S10Error('USER_DOC_ABSENT');
  const scansRemaining = (userSnap.data() || {}).scansRemaining;
  if (!isFiniteNumber(scansRemaining)) throw new S10Error('SCANS_REMAINING_NOT_A_NUMBER');
  const reportsCount = await countAccountReports(db, uid);
  return {
    mode: 's10-before', schema: SCHEMA,
    takenAtMs: nowMs, takenAtIso: new Date(nowMs).toISOString(),
    accountHash: hashIdForLog(uid), scansRemaining, accountReportsCount: reportsCount,
  };
}

/** يقرأ ملفّ «قبل» ويتحقّق من شكله (الأسماء وحدها في رسائل الخطأ). */
function readBeforeFile(beforePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(beforePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new S10Error('BEFORE_FILE_UNREADABLE', e && e.code);
  }
  const bad = [];
  if (!parsed || parsed.mode !== 's10-before') bad.push('mode');
  if (!parsed || parsed.schema !== SCHEMA) bad.push('schema');
  if (!parsed || typeof parsed.accountHash !== 'string' || !HASH_PATTERN.test(parsed.accountHash)) bad.push('accountHash');
  if (!parsed || !isFiniteNumber(parsed.scansRemaining)) bad.push('scansRemaining');
  if (!parsed || !isFiniteNumber(parsed.takenAtMs)) bad.push('takenAtMs');
  if (!parsed || !Number.isInteger(parsed.accountReportsCount) || parsed.accountReportsCount < 0) bad.push('accountReportsCount');
  if (bad.length > 0) throw new S10Error(`BEFORE_FILE_INVALID: ${bad.join(',')}`);
  return parsed;
}

// ───────────────────────── وضع «بعد» ─────────────────────────

const timeParts = (t) => (t && isFiniteNumber(t.seconds) && isFiniteNumber(t.nanoseconds)) ? {s: t.seconds, n: t.nanoseconds} : null;
const sameTime = (a, b) => a !== null && b !== null && a.s === b.s && a.n === b.n;

function readCreatedAtMs(v) {
  if (v && typeof v.toMillis === 'function') { const ms = v.toMillis(); return isFiniteNumber(ms) ? ms : null; }
  if (v instanceof Date) { const ms = v.getTime(); return isFiniteNumber(ms) ? ms : null; }
  return null;
}

/**
 * يجمع حقائق «بعد» بقراءة بحتة. لا حكم هنا.
 * @param {Object} p
 * @param {Object} p.db مغلَّف بـwrapReadOnly
 * @param {string} p.shortId
 * @return {Promise<Object>} facts لـevaluateAfter (لا معرّف خامّ: المعرّفات تُهشَّر هنا)
 */
async function gatherAfterFacts({db, shortId}) {
  const repSnap = await db.collection(REPORTS_COLLECTION).where('shortId', '==', shortId).select('userId', 'createdAt').limit(3).get();
  const facts = {reports: {found: repSnap.size, accountHash: null, scanIdHash: null, createdAtMs: null, createTime: null}};
  if (repSnap.size !== 1) return facts;
  const doc = repSnap.docs[0];
  const data = doc.data() || {};
  const scanId = doc.id;
  const userId = typeof data.userId === 'string' && data.userId !== '' ? data.userId : null;
  facts.reports = {
    found: 1, accountHash: userId === null ? null : hashIdForLog(userId), scanIdHash: hashIdForLog(scanId),
    createdAtMs: readCreatedAtMs(data.createdAt), createTime: timeParts(doc.createTime),
  };
  const rawSnap = await db.collection(REPORT_RAW_COLLECTION).doc(scanId).get();
  facts.raw = {exists: rawSnap.exists, createTime: rawSnap.exists ? timeParts(rawSnap.createTime) : null};
  const claimSnap = await db.collection(CLAIMS_COLLECTION).doc(scanId).get();
  let reservationState = 'ABSENT';
  if (claimSnap.exists) {
    const r = (claimSnap.data() || {}).reservation;
    if (r === undefined) reservationState = 'FIELD_ABSENT';
    else if (r === null) reservationState = 'NULL';
    else if (typeof r === 'object') reservationState = 'PRESENT';
    else reservationState = 'UNREADABLE';
  }
  facts.claim = {exists: claimSnap.exists, reservationState};
  if (userId !== null) {
    const userSnap = await db.collection(USERS_COLLECTION).doc(userId).get();
    facts.user = {docExists: userSnap.exists, scansRemaining: userSnap.exists ? (userSnap.data() || {}).scansRemaining : undefined};
    facts.account = {reportsNow: await countAccountReports(db, userId)};
  } else {
    facts.user = {docExists: false, scansRemaining: undefined};
    facts.account = {reportsNow: null};
  }
  return facts;
}

/**
 * الحكم. دالّة نقيّة على الحقائق ولقطة «قبل».
 * @param {Object} facts ناتج gatherAfterFacts
 * @param {{accountHash: string, scansRemaining: number, takenAtMs: number, accountReportsCount: number}} before
 * @return {{verdict: string, failed: string[], undetermined: string[], conditions: Object}}
 */
function evaluateAfter(facts, before) {
  const NE = {state: STATE.NOT_EVALUATED};
  const conditions = {A: {...NE}, B: {...NE}, C: {...NE}, D: {...NE}};
  const failed = [];
  const undetermined = [];
  const finish = () => ({
    verdict: failed.length > 0 ? VERDICT.SERVER_FAIL : (undetermined.length > 0 ? VERDICT.UNDETERMINED : VERDICT.SERVER_OK),
    failed, undetermined, conditions,
  });
  const note = (state) => { if (FAIL_STATES.has(state)) failed.push(state); else if (!OK_STATES.has(state) && state !== STATE.NOT_EVALUATED) undetermined.push(state); return state; };

  const found = facts.reports.found;
  if (found === 0) {
    conditions.A = {state: note(STATE.A_REPORT_ABSENT), reportsFoundByShortId: 0};
    return finish();
  }
  if (found > 1) {
    conditions.A = {state: note(STATE.A_SHORT_ID_AMBIGUOUS), reportsFoundByShortId: found};
    return finish();
  }
  conditions.A = {state: STATE.A_REPORT_FOUND, scanIdHash: facts.reports.scanIdHash, accountHash: facts.reports.accountHash};

  // ب — الخامّ بالكتابة الذرّية
  let bState;
  if (!facts.raw.exists) bState = STATE.B_RAW_ABSENT;
  else if (!sameTime(facts.reports.createTime, facts.raw.createTime)) bState = STATE.B_RAW_CREATE_TIME_DIFFERS;
  else bState = STATE.B_RAW_ATOMIC_OK;
  const bCond = {state: bState, reportCreateTime: facts.reports.createTime, rawCreateTime: facts.raw.createTime};

  // د — لا حجز معلّق
  const rs = facts.claim.reservationState;
  let dState;
  if (rs === 'PRESENT') dState = STATE.D_RESERVATION_PENDING;
  else if (rs === 'UNREADABLE') dState = STATE.D_RESERVATION_UNREADABLE;
  else dState = STATE.D_NO_PENDING_RESERVATION_OK;
  const dCond = {state: dState, claimDocExists: facts.claim.exists, reservation: rs};

  // الحساب: التقرير الذي وُجد ليس تقرير حساب «قبل» ⇒ لا يُحكم على شيء (قد يكون shortId خاطئاً)
  if (facts.reports.accountHash !== before.accountHash) {
    conditions.B = {...bCond, informationalOnly: true};
    conditions.D = {...dCond, informationalOnly: true};
    conditions.C = {state: note(STATE.C_ACCOUNT_HASH_MISMATCH), reportAccountHash: facts.reports.accountHash, beforeAccountHash: before.accountHash};
    return finish();
  }
  conditions.B = {...bCond, state: note(bState)};
  conditions.D = {...dCond, state: note(dState)};

  // ج — الرصيد
  const newReports = facts.account.reportsNow === null ? null : facts.account.reportsNow - before.accountReportsCount;
  const c = {scansRemainingBefore: before.scansRemaining, scansRemainingAfter: null, delta: null, accountReportsBefore: before.accountReportsCount, accountReportsNow: facts.account.reportsNow, newReports};
  let cState;
  const after = facts.user.scansRemaining;
  if (!facts.user.docExists) cState = STATE.C_USER_DOC_ABSENT;
  else if (!isFiniteNumber(after)) cState = STATE.C_BALANCE_UNREADABLE;
  else {
    c.scansRemainingAfter = after;
    c.delta = before.scansRemaining - after;
    if (newReports !== 1) cState = STATE.C_OTHER_SCAN_BETWEEN_SNAPSHOTS;
    else if (facts.reports.createdAtMs !== null && facts.reports.createdAtMs < before.takenAtMs - CLOCK_SKEW_TOLERANCE_MS) cState = STATE.C_REPORT_PREDATES_BEFORE_SNAPSHOT;
    else if (c.delta === 1) cState = STATE.C_DEDUCTED_ONCE_OK;
    else if (c.delta === 0) cState = STATE.C_NO_DEDUCTION;
    else if (c.delta >= 2) cState = STATE.C_DOUBLE_DEDUCTION;
    else cState = STATE.C_BALANCE_INCREASED;
  }
  conditions.C = {...c, state: note(cState)};
  return finish();
}

/** نصّ القرار المقابل للحكم (بنصّ قرار المستخدم)، ونصّ الهاتف دائماً. */
function decisionFor(verdict) {
  return {
    forThisVerdict: verdict === VERDICT.SERVER_FAIL ? DECISION_TEXT.SERVER_FAIL :
      (verdict === VERDICT.UNDETERMINED ? DECISION_TEXT.UNDETERMINED : 'الخادم سليم من جهة هذا الفحص: لا تراجع للدوالّ.'),
    phoneNote: DECISION_TEXT.PHONE_NOTE,
  };
}

const exitCodeOf = (verdict) => (verdict === VERDICT.SERVER_OK ? EXIT.SERVER_OK : (verdict === VERDICT.SERVER_FAIL ? EXIT.SERVER_FAIL : EXIT.UNDETERMINED));

/** فحص ذاتي بلا شبكة: كل الأحكام والحالات على حقائق اصطناعية. حالة فاشلة = لا يُشغَّل على الإنتاج. */
function preflightChecks(env = process.env) {
  const before = {accountHash: hashIdForLog('uid-s10'), scansRemaining: 10, takenAtMs: 1_800_000_000_000, accountReportsCount: 7};
  const T = {s: 1_800_000_100, n: 500};
  const good = () => ({
    reports: {found: 1, accountHash: before.accountHash, scanIdHash: hashIdForLog('scan'), createdAtMs: before.takenAtMs + 60_000, createTime: T},
    raw: {exists: true, createTime: {...T}}, claim: {exists: false, reservationState: 'ABSENT'},
    user: {docExists: true, scansRemaining: 9}, account: {reportsNow: 8},
  });
  const ev = (mut) => { const f = good(); mut(f); return evaluateAfter(f, before); };
  const is = (r, verdict, state) => r.verdict === verdict && (state === undefined || r.failed.includes(state) || r.undetermined.includes(state));
  const throwsUsage = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const checks = [
    ['SERVER_OK: الأربعة سليمة', is(ev(() => {}), VERDICT.SERVER_OK)],
    ['حجز scanClaims بقيمة null يُقبل (د)', is(ev((f) => { f.claim = {exists: true, reservationState: 'NULL'}; }), VERDICT.SERVER_OK)],
    ['لا تقرير: SERVER_FAIL A_REPORT_ABSENT', is(ev((f) => { f.reports = {found: 0}; }), VERDICT.SERVER_FAIL, STATE.A_REPORT_ABSENT)],
    ['تقريران بالمعرّف نفسه: UNDETERMINED A_SHORT_ID_AMBIGUOUS', is(ev((f) => { f.reports = {found: 2}; }), VERDICT.UNDETERMINED, STATE.A_SHORT_ID_AMBIGUOUS)],
    ['لا reportRaw: SERVER_FAIL B_RAW_ABSENT', is(ev((f) => { f.raw = {exists: false, createTime: null}; }), VERDICT.SERVER_FAIL, STATE.B_RAW_ABSENT)],
    ['createTime مختلف: SERVER_FAIL B_RAW_CREATE_TIME_DIFFERS', is(ev((f) => { f.raw.createTime = {s: T.s, n: T.n + 1}; }), VERDICT.SERVER_FAIL, STATE.B_RAW_CREATE_TIME_DIFFERS)],
    ['خصم مضاعف: SERVER_FAIL C_DOUBLE_DEDUCTION', is(ev((f) => { f.user.scansRemaining = 8; }), VERDICT.SERVER_FAIL, STATE.C_DOUBLE_DEDUCTION)],
    ['لا خصم: SERVER_FAIL C_NO_DEDUCTION', is(ev((f) => { f.user.scansRemaining = 10; }), VERDICT.SERVER_FAIL, STATE.C_NO_DEDUCTION)],
    ['رصيد زاد: UNDETERMINED C_BALANCE_INCREASED', is(ev((f) => { f.user.scansRemaining = 12; }), VERDICT.UNDETERMINED, STATE.C_BALANCE_INCREASED)],
    ['حجز معلّق: SERVER_FAIL D_RESERVATION_PENDING', is(ev((f) => { f.claim = {exists: true, reservationState: 'PRESENT'}; }), VERDICT.SERVER_FAIL, STATE.D_RESERVATION_PENDING)],
    ['فحص آخر بين اللقطتين: UNDETERMINED C_OTHER_SCAN_BETWEEN_SNAPSHOTS', is(ev((f) => { f.account.reportsNow = 9; }), VERDICT.UNDETERMINED, STATE.C_OTHER_SCAN_BETWEEN_SNAPSHOTS)],
    ['تقرير أقدم من اللقطة: UNDETERMINED C_REPORT_PREDATES_BEFORE_SNAPSHOT', is(ev((f) => { f.reports.createdAtMs = before.takenAtMs - 3_600_000; }), VERDICT.UNDETERMINED, STATE.C_REPORT_PREDATES_BEFORE_SNAPSHOT)],
    ['تقرير حساب آخر: UNDETERMINED C_ACCOUNT_HASH_MISMATCH ولا فشل مهما كانت حالة ب ود', is(ev((f) => { f.reports.accountHash = hashIdForLog('other'); f.raw = {exists: false, createTime: null}; }), VERDICT.UNDETERMINED, STATE.C_ACCOUNT_HASH_MISMATCH)],
    ['خصم مضاعف مع فحص آخر: لا يُحكم على الرصيد (UNDETERMINED)', is(ev((f) => { f.user.scansRemaining = 8; f.account.reportsNow = 10; }), VERDICT.UNDETERMINED, STATE.C_OTHER_SCAN_BETWEEN_SNAPSHOTS)],
    ['فشل ب مع غموض الرصيد: SERVER_FAIL (الفشل الصريح يغلب)', is(ev((f) => { f.raw = {exists: false, createTime: null}; f.account.reportsNow = 10; }), VERDICT.SERVER_FAIL, STATE.B_RAW_ABSENT)],
    ['رمز الخروج لكل حكم', exitCodeOf(VERDICT.SERVER_OK) === 0 && exitCodeOf(VERDICT.SERVER_FAIL) === 1 && exitCodeOf(VERDICT.UNDETERMINED) === 3 && EXIT.ERROR === 2],
    ['نصّ فشل الخادم يذكر الدوالّ والقواعد وd5b6c29', /الدوالّ إلى d5b6c29 وتبقى القواعد/.test(DECISION_TEXT.SERVER_FAIL)],
    ['نصّ الهاتف يذكر القواعد إلى نسختها الاحتياطية', /القواعد إلى نسختها الاحتياطية/.test(DECISION_TEXT.PHONE_NOTE)],
    ['--before --out: وضع قبل', (() => { const a = parseArgs(['--before', '--out', 'b.json']); return a.mode === 'before' && a.out === 'b.json' && a.beforeFile === null; })()],
    ['--after كامل: وضع بعد', (() => { const a = parseArgs(['--after', '--short-id', 'NC-ABC123', '--before', 'b.json', '--out', 'a.json']); return a.mode === 'after' && a.shortId === 'NC-ABC123' && a.beforeFile === 'b.json'; })()],
    ['البريد لا يُقبل من سطر الأمر', throwsUsage(['--before', '--out', 'b.json', '--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['shortId بصيغة خاطئة يُرفض', throwsUsage(['--after', '--short-id', 'nc-abc', '--before', 'b.json', '--out', 'a.json'], /NC-XXXXXX/)],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), s10EmailEnvPresent: typeof env[S10_EMAIL_ENV] === 'string' && env[S10_EMAIL_ENV].trim() !== '', checks: results};
}

module.exports = {
  REPORTS_COLLECTION, REPORT_RAW_COLLECTION, USERS_COLLECTION, CLAIMS_COLLECTION, S10_EMAIL_ENV, SCHEMA, SHORT_ID_PATTERN, HASH_PATTERN,
  CLOCK_SKEW_TOLERANCE_MS, ROLLBACK_COMMIT, EXIT, VERDICT, STATE, DECISION_TEXT, S10Error,
  parseArgs, assertOutWritable, writeOutputExclusive, countAccountReports, takeBeforeSnapshot, readBeforeFile, gatherAfterFacts, evaluateAfter, decisionFor, exitCodeOf,
  preflightChecks,
};
