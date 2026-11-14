'use strict';

// ===================================================================
// setAccountSubscription — ضبط تاريخ انتهاء اشتراك (وأحياناً الرصيد) لحسابات يسمّيها المستخدم، 2026-10-14 +03. يستعمله set-account-subscription.js.
//
// قرار المستخدم (2026-10-14، منقول من أمر المنسّق بحروفه، غير متحقَّق من مصدره): «تاريخ انتهاء حسابات الشريك لا يُضبط بيدي في الكونسول. اكتب كتلة صغيرة مختبرة (تشغيل جافّ أوّلاً، ثم كتابة بأمري)
// تضبط expiresAt بنوع Timestamp لكل حساب أسمّيه، والرصيد إن طلبتُه، وتطبع القيم قبل وبعد. أشغّلها مرّة واحدة قبل التسليم.»
// وجوابه عن نطاق الكتابة (الخيار «Only what I name»، بحروفه): «Writes expiresAt, and scansRemaining only on lines that ask ("add N" also adds N to scansTotal, as every grant does; "set N" leaves scansTotal).
// Never touches plan, isActive or the reminder flags; the dry run prints them and warns if plan is not shop_basic/shop_pro (the 1.0.12 app hides the session button otherwise), if isActive is false (the panel
// shows «معطّل»), or if a flag is set.» وتاريخ الانتهاء: «expiresAt (Timestamp, end of the day you give, +03)».
//
// **يشغّله المستخدم وحده** على الإنتاج. الوكيل يكتبه ويختبره على المحاكي وبلا شبكة، ولا يشغّله على الإنتاج. وقرار المستخدم (2026-10-09، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا
// بأمر صريح منّي ونسخة احتياطية.» — فلا حذف هنا ولا set ولا create ولا batch (الغلاف subscriptionWriteGuard.js يمنعها، واختبار ساكن يحرس بقيّة الملفّات).
//
// ─── ملفّ المدخل (--accounts، UTF-8) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   كل سطر غير فارغ:  <email>,<YYYY-MM-DD>[,set:<N>|add:<N>]   وما يبدأ بـ# تعليق. حدّ أقصى 10 أسطر **حسابات** (التعليقات والأسطر الفارغة لا تُعدّ — افتراض مُعلَن). والبريد لا يُقبل من سطر الأمر، ولا يُطبَع ولا يُكتب في أيّ مخرَج:
//   الحساب يُعرض بـhashIdForLog(uid)، والسطر برقمه، وأيّ رفض برمز مسمّى + رقم السطر (لا نصّ السطر).
//
// ─── الوضعان ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   --dry-run                  getUserByEmail ← users/{uid} (قراءة بحتة بـwrapReadOnly: أيّ كتابة تُرمى بـTRAP)، ويطبع «قبل» و«بعد» (المخطَّط) لتسعة حقول بيضاء، والتحذيرات، ورمزاً. لا يُبنى فيه كاتب أصلاً.
//   --commit --token <T>       معاملة واحدة لكل الحسابات (كلّها أو لا شيء): تقرأ الكل، وتعيد حساب الرمز **داخل المعاملة** وترفض إن اختلف، ثم تكتب، ثم تعيد القراءة **خارجها**، وتقارن حقلاً حقلاً.
//   الرمز = sha256 لتمثيل قانوني (مفاتيح مرتَّبة) لـ: projectId + بصمة بايتات ملفّ المدخل + لكل حساب (بالترتيب): uid وقيم «قبل» للحقول الثلاثة المكتوبة (النوع والقيمة) والكتابات المخطَّطة. فأيّ تعديل في الملفّ أو في الحقول
//   الثلاثة بين الوضعين، أو إعادة تشغيل الرمز نفسه بعد الكتابة، يُرفض قبل أيّ كتابة. ولا يغطّي الحقول البيضاء الأخرى (plan وisActive والأعلام): تُعرض في التحذيرات وتُقارَن بعد الكتابة (لا تتغيّر).
//
// ─── ما يُكتب ولا شيء غيره ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   expiresAt     = Timestamp لنهاية اليوم المعطى بتوقيت +03 (23:59:59.999)، مطبوعة بقيمتها المطلقة.  scansRemaining: في set:N = N، وفي add:N = الحالي + N.  scansTotal: + N في add وحده.
//   القاعدة 22: الرصيد الحالي الغائب أو غير الرقمي أو غير الصحيح مع add يُرفض (لا يُقرأ صفراً) — وكذلك scansTotal الحالي (افتراض مُعلَن: النصّ سمّى الرصيد وحده، والقاعدة نفسها تسري على الحقل المجاور).
//
// ─── رموز الرفض (قبل أيّ كتابة) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   مسمّاة في REASON أدناه. تُجمَع كلّها بأرقام أسطرها وتُطبَع معاً. نصّ خطأ المزوّد لا يُطبَع (القاعدة 36): رمزه فقط.
// ===================================================================

const crypto = require('crypto');
const fs = require('fs');
const {Timestamp} = require('firebase-admin/firestore');
const C = require('./deviceCheck03Common');
const SS = require('./subscriptionState');
const G = require('./subscriptionWriteGuard');
const {toDateOrNull} = require('../../src/utils/subscription');

const MODE = 'set-account-subscription';
const SCHEMA = 1;
const APP_NAME = 'set-account-subscription';
const MAX_ACCOUNT_LINES = 10;
const MAX_FILE_BYTES = 64 * 1024;
const OFFSET_MS = SS.OFFSET_MS; // +03 بلا توقيت صيفي (subscriptionState.js:56)

/** الحقول المطبوعة (قائمة بيضاء: تسعة من عشرة في subscriptionState.FIELDS — بلا freeTrialUsedDevices). */
const PRINT_FIELDS = Object.freeze(['plan', 'scansRemaining', 'scansTotal', 'isActive', 'expiresAt', 'subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate', 'subExpiredAt']);
/** أعلام التذكير والإشعار (تُحذَّر إن ضُبطت ولا تُلمَس أبداً). */
const FLAG_FIELDS = Object.freeze(['subExpiredNotified', 'subExpiryEmailSent', 'subExpiryFcmDate', 'subExpiredAt']);
/** الحقول التي يكتبها السكربت (= مفاتيح الغلاف). */
const WRITABLE_FIELDS = G.ALLOWED_KEYS;
/** باقات المحلّ: المصدر الواحد subscriptionState.CRON.shopPlans (مرآة checkExpiringSubscriptions.js:166) — يحرسها اختبار ذلك الملفّ. */
const SHOP_PLANS = SS.CRON.shopPlans;

const REASON = Object.freeze({
  USAGE_UNKNOWN_ARGUMENT: 'USAGE_UNKNOWN_ARGUMENT',
  USAGE_VALUE_MISSING: 'USAGE_VALUE_MISSING',
  USAGE_DUPLICATE_ARGUMENT: 'USAGE_DUPLICATE_ARGUMENT',
  USAGE_PREFLIGHT_ALONE: 'USAGE_PREFLIGHT_ALONE',
  MODE_NOT_EXPLICIT: 'MODE_NOT_EXPLICIT',
  MODE_CONFLICT: 'MODE_CONFLICT',
  ACCOUNTS_FILE_REQUIRED: 'ACCOUNTS_FILE_REQUIRED',
  TOKEN_REQUIRED: 'TOKEN_REQUIRED',
  TOKEN_FORMAT_INVALID: 'TOKEN_FORMAT_INVALID',
  TOKEN_NOT_ALLOWED_IN_DRY_RUN: 'TOKEN_NOT_ALLOWED_IN_DRY_RUN',
  ACCOUNTS_FILE_MISSING: 'ACCOUNTS_FILE_MISSING',
  ACCOUNTS_FILE_UNREADABLE: 'ACCOUNTS_FILE_UNREADABLE',
  ACCOUNTS_FILE_TOO_LARGE: 'ACCOUNTS_FILE_TOO_LARGE',
  ACCOUNTS_FILE_NOT_UTF8: 'ACCOUNTS_FILE_NOT_UTF8',
  NO_ACCOUNT_LINES: 'NO_ACCOUNT_LINES',
  TOO_MANY_LINES: 'TOO_MANY_LINES',
  LINE_FORMAT_INVALID: 'LINE_FORMAT_INVALID',
  EMAIL_INVALID: 'EMAIL_INVALID',
  DATE_UNREADABLE: 'DATE_UNREADABLE',
  DATE_IN_PAST: 'DATE_IN_PAST',
  BALANCE_DIRECTIVE_INVALID: 'BALANCE_DIRECTIVE_INVALID',
  N_NOT_AN_INTEGER: 'N_NOT_AN_INTEGER',
  N_OUT_OF_RANGE: 'N_OUT_OF_RANGE',
  DUPLICATE_ACCOUNT: 'DUPLICATE_ACCOUNT',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  AUTH_LOOKUP_FAILED: 'AUTH_LOOKUP_FAILED',
  USER_DOC_MISSING: 'USER_DOC_MISSING',
  CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER: 'CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER',
  CURRENT_BALANCE_NOT_AN_INTEGER: 'CURRENT_BALANCE_NOT_AN_INTEGER',
  CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER: 'CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER',
  CURRENT_TOTAL_NOT_AN_INTEGER: 'CURRENT_TOTAL_NOT_AN_INTEGER',
  NEGATIVE_BALANCE_RESULT: 'NEGATIVE_BALANCE_RESULT',
  RESULT_NOT_A_SAFE_INTEGER: 'RESULT_NOT_A_SAFE_INTEGER',
  TOKEN_MISMATCH: 'TOKEN_MISMATCH',
  COMMIT_OUTCOME_UNKNOWN: 'COMMIT_OUTCOME_UNKNOWN',
});

/** رموز التحذير (لا ترفض: تُعرض في التشغيل الجافّ وفي الكتابة). */
const WARNING = Object.freeze({
  PLAN_NOT_SHOP: 'PLAN_NOT_SHOP',
  IS_ACTIVE_FALSE: 'IS_ACTIVE_FALSE',
  IS_ACTIVE_NOT_A_BOOLEAN: 'IS_ACTIVE_NOT_A_BOOLEAN',
  FLAG_SET: 'FLAG_SET',
  EXPIRES_AT_NOT_A_TIMESTAMP: 'EXPIRES_AT_NOT_A_TIMESTAMP',
  NEW_EXPIRY_EARLIER_THAN_CURRENT: 'NEW_EXPIRY_EARLIER_THAN_CURRENT',
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ───────────────────────── الرفض ─────────────────────────

/** رفض مسمّى: الرسالة رموز وأرقام أسطر فحسب (لا بريد ولا معرّف ولا نصّ مزوّد) — طباعتها آمنة (القاعدة 36). */
function reject(rejections) {
  const text = rejections.map((r) => `${r.line === null || r.line === undefined ? '' : `line ${r.line} `}${r.code}${r.detail ? `(${r.detail})` : ''}`).join('; ');
  const e = new C.DeviceCheckError(`REJECTED: ${text}`);
  e.rejections = rejections;
  return e;
}
const rejectOne = (code, detail) => reject([{line: null, code, ...(detail === undefined ? {} : {detail})}]);

// ───────────────────────── الوسائط ─────────────────────────

/**
 * محلّل وسائط صارم بلا صدى للقيم: لا يُنسخ أيّ وسيط إلى نصّ خطأ (قد يحمل بريداً). وضع صريح واحد: --dry-run أو --commit. --preflight وحدها.
 * @param {string[]} argv
 * @return {{mode: 'preflight'} | {mode: 'dry-run'|'commit', accounts: string, token: ?string, out: ?string}}
 */
function parseArgs(argv) {
  const FLAGS = ['--dry-run', '--commit', '--preflight'];
  const VALUES = ['--accounts', '--token', '--out'];
  const flags = {};
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (FLAGS.includes(a)) {
      if (flags[a]) throw new C.DeviceCheckError(REASON.USAGE_DUPLICATE_ARGUMENT, a);
      flags[a] = true;
    } else if (VALUES.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new C.DeviceCheckError(REASON.USAGE_VALUE_MISSING, a);
      if (has(values, a)) throw new C.DeviceCheckError(REASON.USAGE_DUPLICATE_ARGUMENT, a);
      values[a] = v;
      i++;
    } else {
      throw new C.DeviceCheckError(REASON.USAGE_UNKNOWN_ARGUMENT, `arg#${i + 1}`); // موضعه لا نصّه
    }
  }
  if (flags['--preflight']) {
    if (flags['--dry-run'] || flags['--commit'] || Object.keys(values).length > 0) throw new C.DeviceCheckError(REASON.USAGE_PREFLIGHT_ALONE);
    return {mode: 'preflight'};
  }
  if (flags['--dry-run'] && flags['--commit']) throw new C.DeviceCheckError(REASON.MODE_CONFLICT);
  if (!flags['--dry-run'] && !flags['--commit']) throw new C.DeviceCheckError(REASON.MODE_NOT_EXPLICIT);
  if (!has(values, '--accounts')) throw new C.DeviceCheckError(REASON.ACCOUNTS_FILE_REQUIRED);
  const mode = flags['--commit'] ? 'commit' : 'dry-run';
  if (mode === 'commit') {
    if (!has(values, '--token')) throw new C.DeviceCheckError(REASON.TOKEN_REQUIRED);
    if (!/^[0-9a-f]{64}$/.test(values['--token'])) throw new C.DeviceCheckError(REASON.TOKEN_FORMAT_INVALID);
  } else if (has(values, '--token')) {
    throw new C.DeviceCheckError(REASON.TOKEN_NOT_ALLOWED_IN_DRY_RUN);
  }
  return {mode, accounts: values['--accounts'], token: mode === 'commit' ? values['--token'] : null, out: has(values, '--out') ? values['--out'] : null};
}

// ───────────────────────── ملفّ المدخل ─────────────────────────

/**
 * يقرأ ملفّ الحسابات بايتات: بصمة sha256 للبايتات الخام، وفكّ UTF-8 صارم (BOM يُنزَع). لا مسار ولا محتوى في أيّ خطأ.
 * @param {string} filePath
 * @return {{text: string, bytes: number, sha256: string}}
 */
function readAccountsFile(filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (e) {
    throw new C.DeviceCheckError(e && e.code === 'ENOENT' ? REASON.ACCOUNTS_FILE_MISSING : REASON.ACCOUNTS_FILE_UNREADABLE, e && e.code);
  }
  if (!st.isFile()) throw new C.DeviceCheckError(REASON.ACCOUNTS_FILE_UNREADABLE, 'NOT_A_FILE');
  if (st.size > MAX_FILE_BYTES) throw new C.DeviceCheckError(REASON.ACCOUNTS_FILE_TOO_LARGE);
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    throw new C.DeviceCheckError(REASON.ACCOUNTS_FILE_UNREADABLE, e && e.code);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(buf); // يُنزع BOM افتراضياً
  } catch (e) {
    throw new C.DeviceCheckError(REASON.ACCOUNTS_FILE_NOT_UTF8);
  }
  return {text, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex')};
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * نهاية اليوم المعطى بتوقيت +03 (23:59:59.999) بالميلّي ثانية، أو null إن لم يكن تاريخاً تقويمياً صحيحاً بصيغة YYYY-MM-DD.
 * @param {string} dateStr
 * @return {?number}
 */
function endOfDayPlus03Ms(dateStr) {
  const m = DATE_RE.exec(String(dateStr));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null; // 2026-02-30 ينزلق إلى آذار فيُرفض
  return Date.UTC(y, mo - 1, d, 23, 59, 59, 999) - OFFSET_MS;
}

const EMAIL_RE = /^[^\s@,]+@[^\s@,]+$/;
const DIRECTIVE_RE = /^(set|add):(.*)$/;
const INTEGER_RE = /^(0|-?[1-9]\d*)$/;

/**
 * يحلّل نصّ الملفّ إلى مُدخلات أو يرفض بكل المشاكل معاً (رمز + رقم سطر، لا نصّ).
 * @param {string} text
 * @param {number} nowMs الآن (لرفض نهاية يوم ماضية)
 * @return {Array<{line: number, email: string, date: string, endOfDayMs: number, balance: ?{mode: 'set'|'add', n: number}}>}
 */
function parseAccountsText(text, nowMs) {
  const rows = [];
  String(text).split(/\r\n|\n|\r/).forEach((raw, idx) => {
    const t = raw.trim();
    if (t === '' || t.startsWith('#')) return;
    rows.push({line: idx + 1, text: t});
  });
  if (rows.length === 0) throw rejectOne(REASON.NO_ACCOUNT_LINES);
  if (rows.length > MAX_ACCOUNT_LINES) throw rejectOne(REASON.TOO_MANY_LINES, `${rows.length}>${MAX_ACCOUNT_LINES}`);
  const rejections = [];
  const entries = [];
  const seenEmails = new Set();
  for (const row of rows) {
    const bad = (code) => rejections.push({line: row.line, code});
    const parts = row.text.split(',').map((s) => s.trim());
    if (parts.length < 2 || parts.length > 3) {
      bad(REASON.LINE_FORMAT_INVALID);
      continue;
    }
    const [email, date, directive] = parts;
    let ok = true;
    if (!EMAIL_RE.test(email)) {
      bad(REASON.EMAIL_INVALID);
      ok = false;
    } else if (seenEmails.has(email.toLowerCase())) {
      bad(REASON.DUPLICATE_ACCOUNT);
      ok = false;
    } else {
      seenEmails.add(email.toLowerCase());
    }
    const endOfDayMs = endOfDayPlus03Ms(date);
    if (endOfDayMs === null) {
      bad(REASON.DATE_UNREADABLE);
      ok = false;
    } else if (endOfDayMs <= nowMs) {
      bad(REASON.DATE_IN_PAST);
      ok = false;
    }
    let balance = null;
    if (directive !== undefined) {
      const dm = DIRECTIVE_RE.exec(directive);
      if (!dm) {
        bad(REASON.BALANCE_DIRECTIVE_INVALID);
        ok = false;
      } else if (!INTEGER_RE.test(dm[2]) || !Number.isSafeInteger(Number(dm[2]))) {
        bad(REASON.N_NOT_AN_INTEGER);
        ok = false;
      } else {
        const n = Number(dm[2]);
        if ((dm[1] === 'set' && n < 0) || (dm[1] === 'add' && n < 1)) {
          bad(REASON.N_OUT_OF_RANGE);
          ok = false;
        } else {
          balance = {mode: dm[1], n};
        }
      }
    }
    if (ok) entries.push({line: row.line, email, date, endOfDayMs, balance});
  }
  if (rejections.length > 0) throw reject(rejections);
  return entries;
}

// ───────────────────────── الحسابات ─────────────────────────

/**
 * getUserByEmail لكل سطر ← uid (في الذاكرة وحدها). كل الإخفاقات تُجمَع ثم تُرفض معاً. لا بريد ولا نصّ مزوّد في الرفض: رمز الخطأ فحسب.
 * @param {{auth: {getUserByEmail: function(string): Promise<{uid: string}>}, entries: Array<Object>}} p
 * @return {Promise<Array<Object>>} المُدخلات + uid + accountHash
 */
async function resolveAccounts({auth, entries}) {
  const rejections = [];
  const resolved = [];
  const seenUids = new Set();
  for (const entry of entries) {
    let user;
    try {
      user = await auth.getUserByEmail(entry.email);
    } catch (e) {
      const code = e && typeof e.code === 'string' && /^[A-Za-z0-9/_.-]{1,64}$/.test(e.code) ? e.code : 'NO_CODE';
      rejections.push(code === 'auth/user-not-found' ? {line: entry.line, code: REASON.ACCOUNT_NOT_FOUND} : {line: entry.line, code: REASON.AUTH_LOOKUP_FAILED, detail: code});
      continue;
    }
    if (!user || typeof user.uid !== 'string' || user.uid === '') {
      rejections.push({line: entry.line, code: REASON.AUTH_LOOKUP_FAILED, detail: 'NO_UID'});
      continue;
    }
    if (seenUids.has(user.uid)) {
      rejections.push({line: entry.line, code: REASON.DUPLICATE_ACCOUNT});
      continue;
    }
    seenUids.add(user.uid);
    resolved.push({...entry, uid: user.uid, accountHash: C.hashIdForLog(user.uid)});
  }
  if (rejections.length > 0) throw reject(rejections);
  return resolved;
}

// ───────────────────────── التخطيط ─────────────────────────

/** عدّاد صالح للجمع: رقم منتهٍ صحيح — وإلا رمز الرفض (الغياب وغير الرقمي وغير الصحيح). */
function counterProblem(v, codes) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return codes.notNumber;
  if (!Number.isSafeInteger(v)) return codes.notInteger;
  return null;
}

/**
 * ما يُكتب لحساب واحد من مستنده الحالي، أو أسباب الرفض. خالصة (بلا قراءة ولا كتابة).
 * @param {{entry: Object, userData: Object}} p
 * @return {{writes: Object, rejections: string[]}}
 */
function planAccount({entry, userData}) {
  const rejections = [];
  const writes = {expiresAt: Timestamp.fromMillis(entry.endOfDayMs)};
  const b = entry.balance;
  if (b && b.mode === 'set') {
    writes.scansRemaining = b.n; // وscansTotal لا يُمسّ
  } else if (b && b.mode === 'add') {
    const cur = userData.scansRemaining;
    const total = userData.scansTotal;
    const curProblem = counterProblem(cur, {notNumber: REASON.CURRENT_BALANCE_ABSENT_OR_NOT_NUMBER, notInteger: REASON.CURRENT_BALANCE_NOT_AN_INTEGER});
    const totalProblem = counterProblem(total, {notNumber: REASON.CURRENT_TOTAL_ABSENT_OR_NOT_NUMBER, notInteger: REASON.CURRENT_TOTAL_NOT_AN_INTEGER});
    if (curProblem) rejections.push(curProblem);
    if (totalProblem) rejections.push(totalProblem);
    if (!curProblem && !totalProblem) {
      const newBalance = cur + b.n;
      const newTotal = total + b.n;
      if (!Number.isSafeInteger(newBalance) || !Number.isSafeInteger(newTotal)) rejections.push(REASON.RESULT_NOT_A_SAFE_INTEGER);
      else if (newBalance < 0 || newTotal < 0) rejections.push(REASON.NEGATIVE_BALANCE_RESULT);
      else {
        writes.scansRemaining = newBalance;
        writes.scansTotal = newTotal;
      }
    }
  }
  return {writes, rejections};
}

const describeState = (userData) => Object.fromEntries(PRINT_FIELDS.map((f) => [f, SS.describeField(userData, f)]));

/** نصّ قصير مقروء لوصف حقل (describeField) — للأسطر المقارِنة قبل ← بعد. */
function renderValue(d) {
  if (!d.present) return 'absent';
  switch (d.type) {
    case 'timestamp': return d.plus03 === null ? 'timestamp (unreadable)' : `${d.plus03} (timestamp)`;
    case 'null': return 'null';
    case 'array': return `array (length ${d.length})`;
    case 'number': case 'boolean': case 'string': return d.value === null ? `${d.type} (value not printed)` : `${JSON.stringify(d.value)} (${d.type})`;
    default: return d.type;
  }
}

/**
 * التحذيرات: لا ترفض، وتُطبَع قبل الكتابة وبعدها.
 * @param {Object} userData
 * @param {number} newExpiryMs
 * @return {Array<{code: string, field?: string, detail?: string}>}
 */
function warningsFor(userData, newExpiryMs) {
  const w = [];
  const d = (name) => SS.describeField(userData, name);
  const plan = d('plan');
  if (!(plan.present && plan.type === 'string' && SHOP_PLANS.includes(plan.value))) {
    w.push({code: WARNING.PLAN_NOT_SHOP, field: 'plan', detail: `now: ${renderValue(plan)}; shop plans: ${SHOP_PLANS.join('/')} (the 1.0.12 app hides the session button otherwise)`});
  }
  const active = d('isActive');
  if (active.present && active.type === 'boolean') {
    if (active.value === false) w.push({code: WARNING.IS_ACTIVE_FALSE, field: 'isActive', detail: 'the panel shows «معطّل»'});
  } else {
    w.push({code: WARNING.IS_ACTIVE_NOT_A_BOOLEAN, field: 'isActive', detail: `now: ${renderValue(active)}`});
  }
  for (const f of FLAG_FIELDS) {
    const fd = d(f);
    const isSet = fd.present && fd.type !== 'null' && !(fd.type === 'boolean' && fd.value === false);
    if (isSet) w.push({code: WARNING.FLAG_SET, field: f, detail: `now: ${renderValue(fd)}`});
  }
  const exp = d('expiresAt');
  if (exp.type !== 'timestamp') {
    w.push({code: WARNING.EXPIRES_AT_NOT_A_TIMESTAMP, field: 'expiresAt', detail: `now: ${renderValue(exp)}`});
  }
  const current = toDateOrNull(userData.expiresAt); // كما تفهمه البوّابة (Timestamp أو Date أو نصّ أو رقم)
  if (current !== null && newExpiryMs < current.getTime()) {
    w.push({code: WARNING.NEW_EXPIRY_EARLIER_THAN_CURRENT, field: 'expiresAt', detail: `current ${SS.toPlus03(current.getTime())} · new ${SS.toPlus03(newExpiryMs)}`});
  }
  return w;
}

/** يخطّط كل الحسابات من مستنداتها (أو null لغائب). @return {{plans: Array<Object>, rejections: Array<{line: number, code: string}>}} */
function planAll(resolved, datas) {
  const rejections = [];
  const plans = resolved.map((r, i) => {
    if (datas[i] === null) {
      rejections.push({line: r.line, code: REASON.USER_DOC_MISSING});
      return null;
    }
    const p = planAccount({entry: r, userData: datas[i]});
    for (const code of p.rejections) rejections.push({line: r.line, code});
    return p;
  });
  return {plans, rejections};
}

// ───────────────────────── الرمز ─────────────────────────

/** تمثيل نصّي قانوني: مفاتيح مرتَّبة، بلا مسافات. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** قيمة حقل بنوعها وقيمتها الدقيقة (للرمز والمقارنة): الغائب ≠ null ≠ 0، وTimestamp بثوانيه ونانوثانيه. لا تُطبَع (الرمز sha256). */
function canonValue(v) {
  const kind = SS.valueKind(v);
  switch (kind) {
    case 'absent': case 'null': return {t: kind};
    case 'boolean': return {t: kind, v};
    case 'number': return {t: kind, v: String(v)}; // NaN وInfinity وصفر سالب تبقى متمايزة
    case 'string': return {t: kind, v};
    case 'timestamp': return typeof v.seconds === 'number' && typeof v.nanoseconds === 'number' ? {t: kind, s: v.seconds, n: v.nanoseconds} : {t: kind, ms: SS.timestampMs(v)};
    case 'date': return {t: kind, ms: v.getTime()};
    default: return {t: kind, v: stableStringify(v)};
  }
}

/**
 * الرمز: sha256 لـ(المشروع + بصمة ملفّ المدخل + لكل حساب بالترتيب: uid وقيم «قبل» للحقول الثلاثة والكتابات المخطَّطة).
 * @param {{projectId: string, fileSha256: string, accounts: Array<{line: number, uid: string, userData: Object, writes: Object}>}} p
 * @return {string} 64 خانة سداسية
 */
function computeToken({projectId, fileSha256, accounts}) {
  const pre = {
    tool: MODE, schema: SCHEMA, projectId, fileSha256,
    accounts: accounts.map((a) => ({
      line: a.line,
      uid: a.uid,
      before: Object.fromEntries(WRITABLE_FIELDS.map((f) => [f, canonValue(a.userData[f])])),
      writes: Object.fromEntries(Object.keys(a.writes).sort().map((f) => [f, canonValue(a.writes[f])])),
    })),
  };
  return crypto.createHash('sha256').update(stableStringify(pre), 'utf8').digest('hex');
}

// ───────────────────────── المخرَج ─────────────────────────

function accountReport(resolved, userData, plan) {
  const before = describeState(userData);
  const afterPlanned = describeState({...userData, ...plan.writes});
  const fields = Object.keys(plan.writes);
  return {
    line: resolved.line,
    account: resolved.accountHash,
    request: {expiresAtDate: resolved.date, expiresAtEndOfDayPlus03: SS.toPlus03(resolved.endOfDayMs), balance: resolved.balance},
    writes: fields,
    changes: fields.map((field) => ({field, before: renderValue(before[field]), after: renderValue(afterPlanned[field])})),
    before,
    afterPlanned,
    warnings: warningsFor(userData, resolved.endOfDayMs),
  };
}

function header({run, env, nowMs, input}) {
  return {
    projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
    target: C.describeTarget(env),
    mode: MODE,
    run,
    schema: SCHEMA,
    generatedAtPlus03: SS.toPlus03(nowMs),
    input: {accountLines: input.accountLines, fileSha256: input.sha256},
    allowedWriteFields: [...WRITABLE_FIELDS],
  };
}

/**
 * التشغيل الجافّ: قراءة بحتة (readDb مغلَّف بـwrapReadOnly) — لا يُبنى فيه كاتب.
 * @param {{readDb: Object, auth: Object, entries: Array<Object>, input: {sha256: string, accountLines: number}, nowMs: number, env: Object}} p
 * @return {Promise<{doc: Object, token: string}>}
 */
async function runDryRun({readDb, auth, entries, input, nowMs, env}) {
  const resolved = await resolveAccounts({auth, entries});
  const datas = [];
  for (const r of resolved) {
    const snap = await readDb.collection(G.USERS_COLLECTION).doc(r.uid).get();
    datas.push(snap.exists ? (snap.data() || {}) : null);
  }
  const {plans, rejections} = planAll(resolved, datas);
  if (rejections.length > 0) throw reject(rejections);
  const token = computeToken({projectId: C.PROJECT_ID, fileSha256: input.sha256, accounts: resolved.map((r, i) => ({line: r.line, uid: r.uid, userData: datas[i], writes: plans[i].writes}))});
  const accounts = resolved.map((r, i) => accountReport(r, datas[i], plans[i]));
  return {
    token,
    doc: {
      ...header({run: 'dry-run', env, nowMs, input}),
      nothingWritten: true,
      accounts,
      warningsCount: accounts.reduce((n, a) => n + a.warnings.length, 0),
      token,
      tokenCovers: 'sha256 over: projectId, input file bytes, and per account (file order): uid, before-values of expiresAt/scansRemaining/scansTotal (type and exact value) and the planned writes',
    },
  };
}

/** مقارنة حقل مكتوب أو غير مكتوب بين المخطَّط/السابق والفعلي. */
function verifyAccount({before, writes, after}) {
  const afterData = after === null ? {} : after;
  const written = Object.keys(writes).map((field) => {
    const planned = canonValue(writes[field]);
    const actual = canonValue(afterData[field]);
    return {field, planned: renderValue(SS.describeField({[field]: writes[field]}, field)), actual: after === null ? 'users doc missing' : renderValue(SS.describeField(afterData, field)), match: after !== null && stableStringify(planned) === stableStringify(actual)};
  });
  const unchangedChecked = PRINT_FIELDS.filter((f) => !has(writes, f));
  const unchangedMismatched = unchangedChecked.filter((f) => after === null || stableStringify(canonValue(before[f])) !== stableStringify(canonValue(afterData[f])));
  return {writtenFields: written, unchangedFields: {checked: unchangedChecked, mismatched: unchangedMismatched}, allMatch: written.every((x) => x.match) && unchangedMismatched.length === 0};
}

/**
 * الكتابة: معاملة واحدة (كلّها أو لا شيء) تعيد التحقّق من الرمز داخلها، ثم قراءة خارجها ومقارنة.
 * @param {{readDb: Object, writer: {runTransaction: function}, auth: Object, entries: Array<Object>, input: Object, token: string, nowMs: number, env: Object}} p
 * @return {Promise<{doc: Object, exitCode: number}>}
 */
async function runCommit({readDb, writer, auth, entries, input, token, nowMs, env}) {
  const resolved = await resolveAccounts({auth, entries});
  const uids = resolved.map((r) => r.uid);
  let tx;
  try {
    tx = await writer.runTransaction(async (gtx) => {
      const snaps = await gtx.readUsers(uids);
      const datas = snaps.map((s) => (s.exists ? s.data : null));
      const {plans, rejections} = planAll(resolved, datas);
      if (rejections.length > 0) throw reject(rejections);
      const again = computeToken({projectId: C.PROJECT_ID, fileSha256: input.sha256, accounts: resolved.map((r, i) => ({line: r.line, uid: r.uid, userData: datas[i], writes: plans[i].writes}))});
      if (again !== token) throw rejectOne(REASON.TOKEN_MISMATCH); // الحالة أو الملفّ تغيّر منذ التشغيل الجافّ، أو رمز خاطئ، أو إعادة تشغيل بعد الكتابة
      resolved.forEach((r, i) => gtx.update(r.uid, plans[i].writes));
      return {datas, plans};
    });
  } catch (e) {
    if ((e && e.name === 'DeviceCheckError') || G.isTrap(e)) throw e; // رفض مسمّى أو حارس: لم تُكتب أيّ كتابة (المعاملة لم تُثبَّت)
    const out = new C.DeviceCheckError(REASON.COMMIT_OUTCOME_UNKNOWN, e && e.code !== undefined ? e.code : undefined); // خطأ مزوّد بلا نصّه: قد تكون الكتابة ثُبّتت — يُعاد التشغيل الجافّ ليُرى الحال
    out.exitCode = C.EXIT.UNDETERMINED;
    throw out;
  }
  let afters = null;
  let readbackError = null;
  try {
    afters = [];
    for (const r of resolved) {
      const snap = await readDb.collection(G.USERS_COLLECTION).doc(r.uid).get();
      afters.push(snap.exists ? (snap.data() || {}) : null);
    }
  } catch (e) {
    afters = null;
    readbackError = e && e.code !== undefined ? String(e.code) : 'NO_CODE';
  }
  const accounts = resolved.map((r, i) => {
    const base = accountReport(r, tx.datas[i], tx.plans[i]);
    if (afters === null) return {...base, afterActual: null, verification: null};
    const verification = verifyAccount({before: tx.datas[i], writes: tx.plans[i].writes, after: afters[i]}); // «قبل» الخام (لا الموصوف) كما قُرئ داخل المعاملة
    return {...base, afterActual: afters[i] === null ? null : describeState(afters[i]), verification};
  });
  const allMatch = afters !== null && accounts.every((a) => a.verification.allMatch);
  const counts = (field) => tx.plans.filter((p) => has(p.writes, field)).length;
  const doc = {
    ...header({run: 'commit', env, nowMs, input}),
    committed: true,
    tokenVerifiedInsideTransaction: true,
    accounts,
    warningsCount: accounts.reduce((n, a) => n + a.warnings.length, 0),
    summary: {accounts: accounts.length, written: {expiresAt: counts('expiresAt'), scansRemaining: counts('scansRemaining'), scansTotal: counts('scansTotal')}, readBack: afters === null ? `FAILED (${readbackError})` : 'OK', allMatch},
  };
  return {doc, exitCode: afters === null ? C.EXIT.UNDETERMINED : (allMatch ? C.EXIT.OK : C.EXIT.FAIL)};
}

// ───────────────────────── الفحص الذاتي (بلا شبكة) ─────────────────────────

/** فحص ذاتي بلا شبكة ولا قراءة ملفّ ولا بيئة: الوسائط والحدود والرمز والغلاف. */
function preflightChecks() {
  const bad = (argv, code) => { try { parseArgs(argv); return false; } catch (e) { return e.reason === code; } };
  const T64 = 'a'.repeat(64);
  const NOW = Date.UTC(2026, 9, 14, 7, 30, 0);
  const guardRejects = (data) => { try { G.sanitizeUpdate('u', data, 2); return false; } catch (e) { return G.isTrap(e); } };
  const sampleToken = (writes) => computeToken({projectId: C.PROJECT_ID, fileSha256: 'f'.repeat(64), accounts: [{line: 1, uid: 'u', userData: {scansRemaining: 1}, writes}]});
  const parsed = parseAccountsText('x@y.test,2026-10-20,add:5\n# note\n', NOW);
  const checks = [
    ['--dry-run مع ملفّ', (() => { const a = parseArgs(['--dry-run', '--accounts', 'f']); return a.mode === 'dry-run' && a.token === null; })()],
    ['--commit بلا --token مرفوض', bad(['--commit', '--accounts', 'f'], REASON.TOKEN_REQUIRED)],
    ['--commit مع رمز صالح', parseArgs(['--commit', '--accounts', 'f', '--token', T64]).mode === 'commit'],
    ['وضع غير صريح مرفوض', bad(['--accounts', 'f'], REASON.MODE_NOT_EXPLICIT) && bad(['--dry-run', '--commit', '--accounts', 'f', '--token', T64], REASON.MODE_CONFLICT)],
    ['البريد لا يُقبل من سطر الأمر', bad(['--email', 'x@y.z'], REASON.USAGE_UNKNOWN_ARGUMENT)],
    ['نهاية اليوم 2026-10-14 بـ+03 = 20:59:59.999 UTC', endOfDayPlus03Ms('2026-10-14') === Date.UTC(2026, 9, 14, 20, 59, 59, 999)],
    ['2026-02-30 مرفوض', endOfDayPlus03Ms('2026-02-30') === null],
    ['سطر add:5 يُحلَّل', parsed.length === 1 && parsed[0].balance.mode === 'add' && parsed[0].balance.n === 5 && parsed[0].line === 1],
    ['الغلاف يرفض مفتاحاً خارج الثلاثة', guardRejects({plan: 'x'})],
    ['الغلاف يرفض قيمة ليست Timestamp لـexpiresAt', guardRejects({expiresAt: new Date(NOW)})],
    ['الغلاف يرفض رصيداً سالباً', guardRejects({scansRemaining: -1})],
    ['الغلاف يقبل Timestamp وعددين صحيحين', (() => { try { G.sanitizeUpdate('u', {expiresAt: Timestamp.fromMillis(NOW), scansRemaining: 0, scansTotal: 3}, 2); return true; } catch (e) { return false; } })()],
    ['الرمز حتمي ويتغيّر بتغيّر الكتابة', sampleToken({scansRemaining: 5}) === sampleToken({scansRemaining: 5}) && sampleToken({scansRemaining: 5}) !== sampleToken({scansRemaining: 6})],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), checks: results};
}

module.exports = {
  MODE, SCHEMA, APP_NAME, MAX_ACCOUNT_LINES, MAX_FILE_BYTES, PRINT_FIELDS, FLAG_FIELDS, WRITABLE_FIELDS, SHOP_PLANS, REASON, WARNING,
  parseArgs, readAccountsFile, endOfDayPlus03Ms, parseAccountsText, resolveAccounts, planAccount, warningsFor, planAll, describeState, renderValue,
  stableStringify, canonValue, computeToken, verifyAccount, runDryRun, runCommit, preflightChecks, reject,
  createGuardedWriter: G.createGuardedWriter, isTrap: G.isTrap,
};
