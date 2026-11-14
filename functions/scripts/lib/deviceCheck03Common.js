'use strict';

// ===================================================================
// deviceCheck03Common — الجزء المشترك بين سكربتات قراءة فحص الجهاز ٠٣ الثلاثة (1.0.11 على الـS10 والـS21)، 2026-10-10 +03، قراءة بحتة:
//   device-check-03-before-readonly.js · device-check-03-after-readonly.js · golden-stage2-keypaths-readonly.js
//
// **يشغّلها المستخدم بيده** (بكتل يكتبها المنسّق) على الإنتاج قراءةً. الوكيل يكتبها ويختبرها على المحاكي ولا يشغّلها على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── النمط القائم المُتَّبع (verify-s10-postdeploy-readonly.js وlib/s10PostDeploy.js وaudit-device-profiles-readonly.js) ─────────────────────────────────────────
//   • db مغلَّف بـwrapReadOnly (المصدر الواحد في audit-device-profiles-readonly.js): أيّ كتابة Firestore ترمي TRAP.
//   • Auth: عملية واحدة معروضة للشيفرة، getUserByEmail (لا غيرها). والبريد من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL وحده (يضعه المستخدم بإدخال مخفيّ) — **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**.
//   • Storage (حيث يلزم): bucket مغلَّف بقائمة بيضاء — file(path).exists وdownload وgetMetadata وحدها؛ وdownload بخيار destination يرمي TRAP (الملفّ لا يُحفظ على القرص بأيّ شكل).
//   • PROJECT_ID مثبَّت في الكود. المعرّفات مُهشَّرة بـhashIdForLog (المصدر الواحد src/utils/logRedaction.js): لا بريد ولا uid ولا scanId ولا sessionId ولا مسار Storage خامّاً في المخرَج.
//   • المخرَج JSON بـUTF-8 بلا BOM إلى مسار يمرَّر بالوسيط --out، بالعلم wx (لا استبدال لملفّ موجود) — الكتابة الوحيدة في السكربت كلّه (مصدرها s10PostDeploy.writeOutputExclusive).
//   • --preflight: فحص ذاتي بلا شبكة.
//
// ما يخصّ القاعدة 36: نصّ خطأ المزوّد لا يُطبَع ولا يُكتب — الصنف والرمز وحدهما (أو السبب المسمّى).
// ===================================================================

const {wrapReadOnly, PROJECT_ID, STORAGE_BUCKET} = require('../audit-device-profiles-readonly');
const S10 = require('./s10PostDeploy');
const {hashIdForLog} = require('../../src/utils/logRedaction');

/** اسم متغيّر البيئة الذي يضبطه المستخدم بإدخال مخفيّ — لا يُقرأ من سطر الأمر. مصدر واحد (القاعدة 24). */
const OWNER_EMAIL_ENV = 'DEVICE_CHECK_03_OWNER_EMAIL';
const SCHEMA = 1;
const SHORT_ID_PATTERN = S10.SHORT_ID_PATTERN;
const EXIT = Object.freeze({OK: 0, FAIL: 1, ERROR: 2, UNDETERMINED: 3});

/** خطأ بسبب مسمّى: الرسالة هي السبب وحده (لا بريد ولا معرّف ولا نصّ مزوّد) — فطباعتها آمنة (القاعدة 36). */
class DeviceCheckError extends Error {
  constructor(reason, code) {
    super(reason);
    this.name = 'DeviceCheckError';
    this.reason = reason;
    this.code = code === undefined ? null : code;
  }
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** نصّ خطأ آمن للشاشة: السبب المسمّى وحده إن كان من أخطاءنا (DeviceCheckError أو S10Error)، وإلا الصنف والرمز (لا رسالة المزوّد — القاعدة 36). */
function safeErrorText(e) {
  if (e && (e.name === 'DeviceCheckError' || e.name === 'S10Error')) return `${e.reason}${e.code ? ` (code=${e.code})` : ''}`;
  if (e && typeof e.message === 'string' && e.message.startsWith('TRAP:')) return e.message; // رسالة الحارس نفسه (اسم العملية الممنوعة، بلا معرّف)
  return `[${(e && e.constructor && e.constructor.name) || typeof e}] code=${(e && e.code !== undefined) ? e.code : 'NO_CODE'}`;
}

function describeTarget(env = process.env) {
  return env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
}

function nowPlus03(nowMs) {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

// ───────────────────────── الوسائط ─────────────────────────

/**
 * محلّل وسائط صارم: وسيط مجهول أو مكرَّر أو بلا قيمة = خطأ صريح (القاعدة 22). لا وسيط موضعي.
 * @param {string[]} argv
 * @param {{values: string[], flags: string[], usage: string}} spec values: وسائط بقيمة؛ flags: وسائط منطقية.
 * @return {{values: Object<string, string>, flags: Object<string, boolean>}}
 */
function parseFlags(argv, spec) {
  const out = {values: {}, flags: {}};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (spec.flags.includes(a)) {
      if (out.flags[a]) throw new Error(`USAGE: ${a} مكرَّر`);
      out.flags[a] = true;
    } else if (spec.values.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`USAGE: ${a} يحتاج قيمة`);
      if (has(out.values, a)) throw new Error(`USAGE: ${a} مكرَّر`);
      out.values[a] = v;
      i++;
    } else {
      // اسم الوسيط وحده: `--email=<قيمة>` كان يُطبَع كلّه بقيمته (كشفه ownerActivityWindowReadonly.e2e.test.js، 2026-10-14)، والقيمة قد تكون بريداً.
      throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a.split('=')[0] : '(موضعي)'}`);
    }
  }
  return out;
}
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ───────────────────────── Admin SDK ─────────────────────────

/**
 * تطبيق Firebase Admin منفصل ومسمّى، بـprojectId مثبَّت. الاعتماد من بيئة الطرفية وحدها (ADC). الـAuth معروضة منه عملية واحدة؛ والـStorage مغلَّف بقائمة بيضاء.
 * @param {{appName: string, withAuth?: boolean, withStorage?: boolean}} p
 * @return {{db: Object, auth?: Object, bucket?: Object}}
 */
function initReadOnlyAdmin({appName, withAuth = false, withStorage = false}) {
  const admin = require('firebase-admin');
  const existing = admin.apps.find((a) => a && a.name === appName);
  const app = existing || admin.initializeApp(withStorage ? {projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET} : {projectId: PROJECT_ID}, appName);
  const out = {db: app.firestore()};
  if (withAuth) out.auth = Object.freeze({getUserByEmail: (email) => app.auth().getUserByEmail(email)});
  if (withStorage) out.bucket = app.storage().bucket();
  return out;
}

/**
 * bucket بقائمة بيضاء: file(path) وحده، وللملفّ exists وdownload وgetMetadata وحدها. download بخيار destination (يكتب على القرص) يرمي TRAP.
 * كل ما سواها غير موجود على الكائن: استدعاؤه TypeError (وأيّ ما أُضيف إليها لاحقاً يُرمى به صراحةً لا صامتاً).
 * @param {Object} bucket
 * @return {{file: function(string): Object}}
 */
function wrapReadOnlyBucket(bucket) {
  const trap = (name) => { throw new Error(`TRAP: Storage operation "${name}" is forbidden in this read-only device-check script`); };
  const wrapFile = (file) => Object.freeze({
    exists: (...a) => file.exists(...a),
    download: (opts, ...rest) => {
      if (opts && typeof opts === 'object' && ('destination' in opts)) trap('file.download({destination})');
      return file.download(opts, ...rest);
    },
    getMetadata: (...a) => file.getMetadata(...a),
  });
  return Object.freeze({file: (p) => wrapFile(bucket.file(p))});
}

// ───────────────────────── الحساب ─────────────────────────

/** بريد المالك من متغيّر البيئة، أو سبب مسمّى. لا يُرجَع إلا للاستعمال المباشر في getUserByEmail. */
function readOwnerEmail(env) {
  const raw = env[OWNER_EMAIL_ENV];
  if (typeof raw !== 'string' || raw.trim() === '') throw new DeviceCheckError('OWNER_EMAIL_ENV_MISSING');
  const addr = raw.trim();
  if (!addr.includes('@')) throw new DeviceCheckError('OWNER_EMAIL_INVALID');
  return addr;
}

/**
 * getUserByEmail ← uid (في الذاكرة وحدها) ومعرّف مُهشَّر. لا بريد ولا uid في أيّ مخرَج.
 * @param {{auth: {getUserByEmail: function(string): Promise<{uid: string}>}, email: string}} p
 * @return {Promise<{uid: string, accountHash: string}>}
 */
async function resolveOwner({auth, email}) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    throw new DeviceCheckError(e && e.code === 'auth/user-not-found' ? 'OWNER_ACCOUNT_NOT_FOUND' : 'AUTH_LOOKUP_FAILED', e && e.code);
  }
  if (!user || typeof user.uid !== 'string' || user.uid === '') throw new DeviceCheckError('AUTH_LOOKUP_FAILED', 'NO_UID');
  return {uid: user.uid, accountHash: hashIdForLog(user.uid)};
}

module.exports = {
  PROJECT_ID, STORAGE_BUCKET, OWNER_EMAIL_ENV, SCHEMA, SHORT_ID_PATTERN, EXIT, DeviceCheckError,
  isFiniteNumber, safeErrorText, describeTarget, nowPlus03, parseFlags, initReadOnlyAdmin, wrapReadOnly, wrapReadOnlyBucket,
  readOwnerEmail, resolveOwner, hashIdForLog,
  assertOutWritable: S10.assertOutWritable, writeOutputExclusive: S10.writeOutputExclusive,
  countAccountReports: S10.countAccountReports,
};
