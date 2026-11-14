'use strict';

// ===================================================================
// reportRawMigration — منطق ترحيل الخامّ من reports/{scanId} إلى reportRaw/{scanId}
// (V8 نقل الخامّ، الجزء ٢، 2026-10-09 +03). يستهلكه functions/scripts/migrate-report-raw.js
// وتختبره functions/test/reportRawMigration.test.js (وحدة، بلا شبكة) وmigrateReportRaw.e2e.test.js (محاكي).
//
// المرجع: docs/RAW_FINGERPRINT_PLACEMENT_DESIGN.md §٧ — وأمر المنسّق، بنصّ قرارات المستخدم:
//   «وللتقارير الموجودة: سكربت ترحيل بتشغيل جافّ أولاً، ونسخة احتياطية، وأعداد قبل وبعد، يأتيني ثم أشغّله.»
//   «٥: لا إصدار fv68 حتى يقول التحقّق 0 باقياً.»
//   «٦: لا نسخ للمعرّفات في evaluations، والربط في جانب الخادم.»
//   «٩: نسخة JSONL محلّية خارج المستودعات حتى فحص الجهاز القادم، ثم تُحذف بقراري.»
//   «١٠: المعروض والمُباع أوّلاً، ثم البقيّة. واليوم المعروض صفر.»
//
// ─── الفروق عن §٧ (تُذكر في تقرير المهمّة أيضاً) ───────────────────────────────────
//  ١. المفاتيح المنقولة **خمسة** (REPORT_RAW_FIELDS: + aiAudit)، لا أربعة كما في §٧-٢ — قرار المستخدم ٤ بعد كتابة الوثيقة.
//  ٢. الكتابة لكل تقرير **دفعة ذرّية واحدة** (create لمستند الخامّ + update بحذف المفاتيح بشرط lastUpdateTime) — بنصّ أمر
//     المنسّق — بدل «create ثم قراءة ومقارنة ثم update» في §٧-٢ (الخطوات ٣-٥). المقارنة صارت **قبل** الإرسال (في الذاكرة:
//     المكتوب مطابق لما قُرئ) وبعد الإيداع (قراءة المستند المكتوب ومقارنته بما قُرئ؛ المخالفة توقف التشغيل)، والنسخة
//     الاحتياطية تسبق أيّ حذف. الدفعة الذرّية تُلغي الحالة HALF من هذا السكربت نفسه؛ وتبقى HALF مُصنَّفة لما قد يصنعه غيره.
//  ٣. وضع رابع `--restore` من §٧-١ (لم يرد في أمر المنسّق) — معاينة بلا كتابة ما لم يُمرَّر معه `--apply`.
//  ٤. evaluations: تُعالَج هنا (قيد ٤ في الوثيقة، وأمر المنسّق) — انظر EVAL_STATE.
//  ٥. **(V8 قبل نشر الأمان، 2026-10-09 — قرار المستخدم)** --apply صار مرحلتين منفصلتين: `--apply --phase copy` (نسخ إلى reportRaw ولا حذف) ثم
//     `--verify-copy` (مقارنة بالبايت قراءةً) ثم `--apply --phase delete` (حذف الحقول بعد التحقّق، بكتلة وأمر صريحين). فالفقرة ٢ أعلاه (دفعة ذرّية
//     واحدة تنسخ وتحذف معاً) **استُبدلت**: النسخ معاملة لكل تقرير (تقرأ التقرير وتتحقّق أنه لم يتغيّر ثم تنشئ مستند الخامّ)، والحذف معاملة أخرى
//     تعيد التحقّق عند الحذف نفسه (مطابقة reportRaw بالبايت + سطر في النسخة بالتجزئة نفسها). وانتهى --apply الواحد: لا مسار واحد ينسخ ويحذف.
//
// ─── مبدأ واحد: الكتابة محصورة في `--apply` ─────────────────────────────────────────
// الأوضاع `--dry-run` و`--verify` ومعاينة `--restore` تعمل على db مغلَّف بـwrapReadOnly (مصدر واحد:
// audit-device-profiles-readonly.js — وقد أُضيفت إليه في هذه المهمّة create وbulkWriter وrecursiveDelete التي كانت تفلت منه):
// أيّ كتابة ترمي TRAP قبل أيّ تنفيذ.
//
// ─── القاعدة 36 ────────────────────────────────────────────────────────────────────
// لا قيمة خامّ تصل الشاشة ولا stdout: المعرّفات تُهشَّر (hashId: SHA-256، 12 حرفاً)، وقيم الحقول المنقولة لا تُطبع أبداً، ونصّ
// أيّ خطأ يُنقّى (sanitizeError). القيم الخامّ تُكتب في ملفّ النسخة الاحتياطية وحده (خارج المستودعات، بقرار المستخدم ٩).
// ===================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  REPORT_RAW_COLLECTION, REPORT_RAW_FIELDS, REPORT_RAW_MAX_BYTES, REPORT_RAW_SOURCE,
  RAW_STATE, measureReportRawBytes, readReportRaw,
} = require('../../src/analysis/reportRawStore');
const {PROJECT_ID, hashId, wrapReadOnly} = require('../audit-device-profiles-readonly');

// ───────────────────────── ثوابت ─────────────────────────

const REPORTS_COLLECTION = 'reports';
const EVALUATIONS_COLLECTION = 'evaluations';

// المعروض والمُباع (قرار المستخدم ١٠؛ docs/FIRESTORE_INDEXES.md:52). مصدر واحد في هذا الملفّ.
const EXPOSED_LISTING_STATUSES = Object.freeze(['for_sale', 'sold']);

// المعرّفات الثلاثة التي كانت تُنسخ إلى evaluations (evaluationContract.js: LINKAGE_FIELDS/RAW_LINKAGE_FIELDS؛
// submitEvaluation.js قبل f9be571: sessionId). مجموعة جزئية من REPORT_RAW_FIELDS — يُتحقَّق منها عند التحميل (القاعدة 24).
const EVALUATION_IDENTIFIER_FIELDS = Object.freeze(['sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath']);
for (const f of EVALUATION_IDENTIFIER_FIELDS) {
  if (!REPORT_RAW_FIELDS.includes(f)) {
    throw new Error(`reportRawMigration: ${f} ليس في REPORT_RAW_FIELDS — انجراف بين المصدرين`);
  }
}

const MIGRATION_STATE = Object.freeze({
  MIGRATE: 'MIGRATE', // في التقرير حقل أو أكثر من الخمسة ولا مستند خامّ
  HALF: 'HALF', // مستند الخامّ موجود وفي التقرير ما زالت الحقول، وقيمها مطابقة
  DONE: 'DONE', // مستند الخامّ موجود ولا حقول في التقرير
  NO_RAW: 'NO_RAW', // لا حقول في التقرير ولا مستند خامّ — يُعدّ ولا يُكتب له شيء
  CONFLICT: 'CONFLICT', // مستند الخامّ موجود بمحتوى يخالف التقرير — توقّف كامل
});

const EVAL_STATE = Object.freeze({
  CLEAN: 'CLEAN', // لا مفتاح من الثلاثة
  NULL_ONLY: 'NULL_ONLY', // المفاتيح الموجودة كلّها null — لا معرّف يُحفَظ؛ تُحذف
  DUPLICATE: 'DUPLICATE', // قيمة كلّ مفتاح مطابقة لما في الخامّ الفعّال (reportRaw أو المضمَّن) — تُحذف من evaluations
  MOVE: 'MOVE', // قيمة ليست في أيّ مكان خادمي غيرها — تُنقل إلى reportRaw ثم تُحذف
  DEFERRED: 'DEFERRED', // النقل مؤجَّل: التقرير ما زال يحمل خامّه مضمَّناً (لم يُرحَّل) — يُعاد التشغيل
  ORPHAN: 'ORPHAN', // قيمة فريدة ولا تقرير لهذا المعرّف — لا يُنشأ reportRaw بلا تقرير؛ تبقى وتُعدّ
  CONFLICT: 'CONFLICT', // قيمة تخالف ما في الخامّ الفعّال — توقّف كامل
});

const PAGE_SIZE = 50; // §٧-٢: دفعات ≤ 50 تقريراً
const CONCURRENCY = 10;
const PAUSE_BETWEEN_PAGES_MS = 250; // تهدئة لمجموعة جديدة (§٧-٢)
const MAX_FAILURES_BEFORE_STOP = 20;
const MAX_COMMIT_ATTEMPTS = 3;
const MAX_EXAMPLES = 20;

const PLAN_SCHEMA = 1;
// عتبة الانجراف بين التشغيل الجافّ ولحظة --apply (§٧-١): max(المطلق, النسبة × عدد الخطّة).
const PLAN_TOLERANCE = Object.freeze({absolute: 10, ratio: 0.05});

const BACKUP_FORMAT = 1;

// رموز الخروج (تُسمّى هنا ولا تُكتب أرقاماً في المتن).
const EXIT = Object.freeze({
  OK: 0,
  ERROR: 1, // استعمال خاطئ أو خطأ غير متوقَّع
  STOPPED: 2, // توقّف مقصود: تعارض/انجراف الخطّة/مخالفة مقارنة/فشل متكرّر/عناصر لم تُكتب
  RESIDUAL_REPORTS: 3, // --verify: ما زال في reports حقل من الخمسة (شرط القرار ٥ لم يتحقّق)
  RESIDUAL_EVALUATIONS: 4, // --verify: التقارير 0 باقياً، لكن في evaluations معرّفات باقية
});

const has = (o, k) => o !== null && o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

// ───────────────────────── ترميز القيم (نسخة احتياطية + مقارنة) ─────────────────────────
// Firestore يُعيد أنواعاً لا يحملها JSON بلا فقد (Timestamp وBytes وGeoPoint وReference وNaN وInfinity و-0).
// الترميز موسوم ($t) وقابل للعكس؛ مفتاح خريطة يحمل الاسم $t يُهرَّب بوسم map.

const isTimestamp = (v) => v !== null && typeof v === 'object' && typeof v.toDate === 'function' &&
  typeof v.seconds === 'number' && typeof v.nanoseconds === 'number';
const isGeoPoint = (v) => v !== null && typeof v === 'object' && typeof v.latitude === 'number' &&
  typeof v.longitude === 'number' && typeof v.isEqual === 'function';
const isDocRef = (v) => v !== null && typeof v === 'object' && typeof v.path === 'string' &&
  typeof v.collection === 'function';
const isBytes = (v) => Buffer.isBuffer(v) || v instanceof Uint8Array;

function encodeValue(v) {
  if (v === null) return null;
  if (v === undefined) {
    throw new Error('encodeValue: undefined — Firestore لا يُعيد undefined؛ قيمة كهذه عطب لا تُرمَّز بصمت (القاعدة 22)');
  }
  switch (typeof v) {
    case 'string':
    case 'boolean':
      return v;
    case 'number':
      if (Number.isNaN(v)) return {$t: 'nan'};
      if (v === Infinity) return {$t: 'inf'};
      if (v === -Infinity) return {$t: '-inf'};
      if (Object.is(v, -0)) return {$t: '-0'};
      return v;
    case 'bigint':
      return {$t: 'bigint', v: String(v)};
    case 'object':
      break;
    default:
      throw new Error(`encodeValue: نوع غير مدعوم (${typeof v})`);
  }
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isTimestamp(v)) return {$t: 'ts', s: v.seconds, n: v.nanoseconds};
  if (isBytes(v)) return {$t: 'bytes', b64: Buffer.from(v).toString('base64')};
  if (isGeoPoint(v)) return {$t: 'geo', lat: v.latitude, lng: v.longitude};
  if (isDocRef(v)) return {$t: 'ref', path: v.path};
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`encodeValue: كائن من صنف غير مدعوم (${(v.constructor && v.constructor.name) || 'unknown'})`);
  }
  const out = {};
  for (const k of Object.keys(v)) out[k] = encodeValue(v[k]);
  return has(v, '$t') ? {$t: 'map', v: out} : out;
}

/**
 * @param {*} e قيمة مرمَّزة (من JSON.parse).
 * @param {{Timestamp: Function, GeoPoint: Function, doc: function(string): *}} ctx أنواع Firestore الحقيقية
 */
function decodeValue(e, ctx) {
  if (e === null || typeof e !== 'object') return e;
  if (Array.isArray(e)) return e.map((x) => decodeValue(x, ctx));
  if (has(e, '$t')) {
    switch (e.$t) {
      case 'nan': return NaN;
      case 'inf': return Infinity;
      case '-inf': return -Infinity;
      case '-0': return -0;
      case 'bigint': return BigInt(e.v);
      case 'ts': return new ctx.Timestamp(e.s, e.n);
      case 'bytes': return Buffer.from(e.b64, 'base64');
      case 'geo': return new ctx.GeoPoint(e.lat, e.lng);
      case 'ref': return ctx.doc(e.path);
      case 'map': {
        const m = {};
        for (const k of Object.keys(e.v)) m[k] = decodeValue(e.v[k], ctx);
        return m;
      }
      default:
        throw new Error(`decodeValue: وسم مجهول ${String(e.$t)}`);
    }
  }
  const o = {};
  for (const k of Object.keys(e)) o[k] = decodeValue(e[k], ctx);
  return o;
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

/** تطابق بنيوي ومن النوع نفسه (Timestamp ≠ نصّ يشبهه، NaN = NaN، -0 ≠ 0). */
function valuesEqual(a, b) {
  return stableStringify(encodeValue(a)) === stableStringify(encodeValue(b));
}

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ───────────────────────── تصنيف التقرير ─────────────────────────

function pickMoved(source) {
  const out = {};
  for (const f of REPORT_RAW_FIELDS) {
    if (has(source, f)) out[f] = source[f];
  }
  return out;
}

/**
 * يصنّف تقريراً (القاعدة 22: حالة صريحة لكل تقرير، لا قراءة غياب نجاحاً).
 * @param {Object} p
 * @param {Object} p.reportData مستند التقرير كما قُرئ.
 * @param {{state: string, raw: ?Object}} p.rawRead ناتج readReportRaw (PRIVATE | EMBEDDED_LEGACY | ABSENT).
 * @return {{state: string, presentFields: string[], conflictFields: string[]}}
 */
function classifyReport({reportData, rawRead}) {
  if (!rawRead || typeof rawRead.state !== 'string') {
    throw new Error('classifyReport: rawRead (ناتج readReportRaw) مطلوب');
  }
  const presentFields = REPORT_RAW_FIELDS.filter((f) => has(reportData, f));
  if (rawRead.state === RAW_STATE.PRIVATE) {
    if (presentFields.length === 0) return {state: MIGRATION_STATE.DONE, presentFields, conflictFields: []};
    const conflictFields = presentFields.filter((f) => !has(rawRead.raw, f) || !valuesEqual(reportData[f], rawRead.raw[f]));
    return conflictFields.length > 0 ?
      {state: MIGRATION_STATE.CONFLICT, presentFields, conflictFields} :
      {state: MIGRATION_STATE.HALF, presentFields, conflictFields: []};
  }
  return presentFields.length === 0 ?
    {state: MIGRATION_STATE.NO_RAW, presentFields, conflictFields: []} :
    {state: MIGRATION_STATE.MIGRATE, presentFields, conflictFields: []};
}

/**
 * مستند الخامّ الذي يكتبه الترحيل: الحقول الخمسة **حرفياً** كما في التقرير (القاعدة 20: لا تعديل للخامّ، ولا تخفيف
 * ثانٍ لـrawFingerprint — فهو مخفَّف عند الكتابة الأصلية)، وما غاب يبقى غائباً (لا null مختلَق).
 * @param {{scanId: string, reportData: Object, createdAt: *}} p createdAt يُمرَّر صراحةً (لا افتراض).
 */
function buildMigrationRawDocument({scanId, reportData, createdAt}) {
  if (typeof scanId !== 'string' || scanId === '') throw new Error('buildMigrationRawDocument: scanId غائب');
  if (createdAt === undefined) throw new Error('buildMigrationRawDocument: createdAt غائب — يُمرَّر صراحةً');
  return {
    scanId,
    ...pickMoved(reportData),
    source: REPORT_RAW_SOURCE.MIGRATION,
    createdAt,
  };
}

/** أنماط معرّفات خامّ قبل التجزئة (3ab4efb) — **استدلال** منقول من نصّ الأمر/الوثيقة §٧-٤، غير متحقَّق (القاعدة 29). */
const LAYER_IDENTIFIER_KEYS = Object.freeze(['c', 'd', 'layerB_firebaseId', 'layerC_androidId']);
const LAYER_SENTINELS = Object.freeze(['no_fid', 'no_android_id']);
const HEX64 = /^[0-9a-f]{64}$/i;

function hasLegacyRawLayerIdentifier(rawFingerprint) {
  const key = rawFingerprint && rawFingerprint.device && rawFingerprint.device.deviceProfileKey;
  if (!key || typeof key !== 'object') return false;
  return LAYER_IDENTIFIER_KEYS.some((k) => {
    const v = key[k];
    return typeof v === 'string' && v !== '' && !HEX64.test(v) && !LAYER_SENTINELS.includes(v);
  });
}

// ───────────────────────── تصنيف evaluations ─────────────────────────

/**
 * @param {Object} p
 * @param {Object} p.evalData مستند evaluations/{scanId}.
 * @param {boolean} p.reportExists هل لهذا المعرّف تقرير.
 * @param {{state: string, raw: ?Object}} p.rawRead readReportRaw للمعرّف نفسه (reportData = التقرير إن وُجد).
 * @return {{state: string, heldFields: string[], perField: Object<string,string>}}
 */
function classifyEvaluation({evalData, reportExists, rawRead}) {
  if (!rawRead || typeof rawRead.state !== 'string') {
    throw new Error('classifyEvaluation: rawRead (ناتج readReportRaw) مطلوب');
  }
  const heldFields = EVALUATION_IDENTIFIER_FIELDS.filter((f) => has(evalData, f));
  if (heldFields.length === 0) return {state: EVAL_STATE.CLEAN, heldFields, perField: {}};

  const perField = {};
  for (const f of heldFields) {
    const v = evalData[f];
    if (v === null) perField[f] = 'NULL';
    else if (rawRead.raw && has(rawRead.raw, f)) perField[f] = valuesEqual(v, rawRead.raw[f]) ? 'DUPLICATE' : 'CONFLICT';
    else perField[f] = 'ONLY_COPY';
  }
  const kinds = new Set(Object.values(perField));
  if (kinds.has('CONFLICT')) return {state: EVAL_STATE.CONFLICT, heldFields, perField};
  if (kinds.has('ONLY_COPY')) {
    if (!reportExists) return {state: EVAL_STATE.ORPHAN, heldFields, perField};
    // التقرير ما زال يحمل خامّه مضمَّناً (لم يُرحَّل): الكتابة إلى reportRaw الآن تصنع HALF/CONFLICT له.
    if (rawRead.state === RAW_STATE.EMBEDDED_LEGACY) return {state: EVAL_STATE.DEFERRED, heldFields, perField};
    return {state: EVAL_STATE.MOVE, heldFields, perField};
  }
  return {state: kinds.has('DUPLICATE') ? EVAL_STATE.DUPLICATE : EVAL_STATE.NULL_ONLY, heldFields, perField};
}

// ───────────────────────── مسار النسخة الاحتياطية ─────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function isInside(child, parent) {
  const rel = path.relative(parent.toLowerCase(), child.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * يرفض أيّ مسار داخل أيّ مستودع git (قرار المستخدم ٩ وأمر المنسّق: «يُرفض داخل أيّ مستودع»).
 * @return {string} المسار المطلق المقبول.
 */
function assertBackupPathOutsideRepos(backupPath) {
  if (typeof backupPath !== 'string' || backupPath.trim() === '') {
    throw new Error('BACKUP_PATH_MISSING: --backup <ملفّ.jsonl> مطلوب مع --apply');
  }
  const abs = path.resolve(backupPath);
  let dir = path.dirname(abs);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error('BACKUP_DIR_MISSING: مجلّد النسخة الاحتياطية غير موجود — لا يُنشأ تلقائياً');
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    throw new Error('BACKUP_PATH_IS_DIRECTORY');
  }
  const realDir = fs.realpathSync(dir);
  const realAbs = path.join(realDir, path.basename(abs));
  if (isInside(realAbs, REPO_ROOT) || isInside(abs, REPO_ROOT)) {
    throw new Error('BACKUP_INSIDE_REPOSITORY: المسار داخل مستودع الباك اند');
  }
  for (let cur = realDir; ; cur = path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, '.git'))) {
      throw new Error('BACKUP_INSIDE_REPOSITORY: المسار داخل مستودع git');
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
  }
  return realAbs;
}

/**
 * يفتح ملفّ JSONL للإلحاق. يكتب سطر ترويسة عند البدء، وسطر استئناف إن كان الملفّ موجوداً.
 * الكتابة ثم flush() = fsync قبل أيّ حذف من التقرير (§٧-٣-١).
 */
function openBackup({backupPath, now = () => new Date(), projectId = PROJECT_ID}) {
  const abs = assertBackupPathOutsideRepos(backupPath);
  const existed = fs.existsSync(abs) && fs.statSync(abs).size > 0;
  // استئناف: آخر تجزئة مسجَّلة لكل معرّف — كي لا يُكرَّر سطر لم يتغيّر، وتبقى النسخة تتبع آخر حالة (فتعيدها --restore كما كانت قبل الحذف).
  const lastSha = new Map();
  if (existed) {
    scanBackupFile(abs, (text, lineNo) => {
      let rec;
      try {
        rec = JSON.parse(text);
      } catch (e) {
        throw new Error(`BACKUP_LINE_INVALID: line=${lineNo}`);
      }
      if (rec && rec.kind === 'report') lastSha.set(`report:${rec.scanId}`, rec.fieldsSha256);
      else if (rec && rec.kind === 'evaluation') lastSha.set(`evaluation:${rec.evalId}`, rec.fieldsSha256);
    });
  }
  const fd = fs.openSync(abs, 'a');
  let lines = 0;
  const writeLine = (obj) => {
    fs.writeSync(fd, `${JSON.stringify(obj)}\n`);
    lines++;
  };
  /** يكتب سجلّ تقرير/تقييم إن لم يكن آخر سجلّ له بالتجزئة نفسها. يُرجع هل كتب. */
  const writeRecord = (rec) => {
    const key = rec.kind === 'report' ? `report:${rec.scanId}` : `evaluation:${rec.evalId}`;
    if (lastSha.get(key) === rec.fieldsSha256) return false;
    writeLine(rec);
    lastSha.set(key, rec.fieldsSha256);
    return true;
  };
  writeLine({
    v: BACKUP_FORMAT, kind: existed ? 'resume' : 'header', projectId, atIso: now().toISOString(),
    tool: 'migrate-report-raw', movedFields: REPORT_RAW_FIELDS, evaluationIdentifierFields: EVALUATION_IDENTIFIER_FIELDS,
  });
  fs.fsyncSync(fd);
  return {
    path: abs,
    resumed: existed,
    writeLine,
    writeRecord,
    flush: () => fs.fsyncSync(fd),
    close: () => fs.closeSync(fd),
    get linesWritten() { return lines; },
  };
}

function reportBackupLine({scanId, snap, data}) {
  const moved = pickMoved(data);
  const fields = {};
  for (const f of Object.keys(moved)) fields[f] = encodeValue(moved[f]);
  return {
    v: BACKUP_FORMAT, kind: 'report', scanId,
    updateTime: snap.updateTime ? {s: snap.updateTime.seconds, n: snap.updateTime.nanoseconds} : null,
    listingStatus: typeof data.listingStatus === 'string' ? data.listingStatus : null,
    fields,
    fieldsSha256: sha256Hex(stableStringify(fields)),
  };
}

function evaluationBackupLine({evalId, snap, data, heldFields}) {
  const fields = {};
  for (const f of heldFields) fields[f] = encodeValue(data[f]);
  return {
    v: BACKUP_FORMAT, kind: 'evaluation', evalId,
    updateTime: snap.updateTime ? {s: snap.updateTime.seconds, n: snap.updateTime.nanoseconds} : null,
    fields,
    fieldsSha256: sha256Hex(stableStringify(fields)),
  };
}

// ───────────────────────── الخطّة والانجراف ─────────────────────────

/**
 * @param {string} planPath
 * @param {string} [kind] 'dry-run' (المرحلة ١: مخرَج --dry-run) أو 'verify-copy' (المرحلة ٢: مخرَج --verify-copy)
 */
function loadPlan(planPath, kind = 'dry-run') {
  if (kind !== 'dry-run' && kind !== 'verify-copy') throw new Error(`loadPlan: نوع خطّة مجهول ${String(kind)}`);
  if (typeof planPath !== 'string' || planPath.trim() === '') {
    throw new Error(`PLAN_MISSING: --plan <مخرَج ${kind === 'dry-run' ? '--dry-run' : '--verify-copy'}.json> مطلوب مع --apply`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(planPath, 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`PLAN_UNREADABLE: ${(e && e.code) || (e && e.name) || 'error'}`);
  }
  if (kind === 'verify-copy') {
    if (!parsed || parsed.mode !== 'verify-copy') throw new Error('PLAN_NOT_VERIFY_COPY_OUTPUT: الملفّ ليس مخرَج --verify-copy');
    if (parsed.schema !== PLAN_SCHEMA) throw new Error(`PLAN_SCHEMA_MISMATCH: ${String(parsed.schema)} ≠ ${PLAN_SCHEMA}`);
    if (parsed.projectId !== PROJECT_ID) throw new Error('PLAN_PROJECT_MISMATCH');
    if (parsed.ready !== true) throw new Error('PLAN_NOT_READY: --verify-copy لم يقل ready (انظر blockers في ملفّه)');
    const b = parsed.backup;
    if (!b || b.provided !== true || typeof b.sha256 !== 'string' || ![b.totalLines, b.reportRecords, b.evaluationRecords].every((x) => typeof x === 'number')) {
      throw new Error('PLAN_BACKUP_NOT_PROVIDED: شغّل --verify-copy مع --backup <ملفّ النسخة>');
    }
    if (!parsed.expected || typeof parsed.expected.reportRecords !== 'number' || typeof parsed.expected.evaluationRecords !== 'number') {
      throw new Error('PLAN_SHAPE_INVALID: expected.reportRecords/expected.evaluationRecords غائبان');
    }
    return parsed;
  }
  if (!parsed || parsed.mode !== 'dry-run') throw new Error('PLAN_NOT_DRY_RUN_OUTPUT: الملفّ ليس مخرَج --dry-run');
  if (parsed.schema !== PLAN_SCHEMA) throw new Error(`PLAN_SCHEMA_MISMATCH: ${String(parsed.schema)} ≠ ${PLAN_SCHEMA}`);
  if (parsed.projectId !== PROJECT_ID) throw new Error('PLAN_PROJECT_MISMATCH');
  if (!parsed.reports || typeof parsed.reports.total !== 'number' || !parsed.reports.byState) {
    throw new Error('PLAN_SHAPE_INVALID: reports.total/reports.byState غائبان');
  }
  if (!parsed.evaluations || !parsed.evaluations.byState) throw new Error('PLAN_SHAPE_INVALID: evaluations.byState غائب');
  return parsed;
}

function withinTolerance(planValue, nowValue) {
  const allowed = Math.max(PLAN_TOLERANCE.absolute, Math.ceil(PLAN_TOLERANCE.ratio * planValue));
  return Math.abs(nowValue - planValue) <= allowed;
}

const sumStates = (byState, keys) => keys.reduce((n, k) => n + (byState[k] || 0), 0);

/** يقارن أعداد اللحظة بأعداد الخطّة. أيّ تعارض (في الخطّة أو الآن) يمنع البدء. */
function checkPlanDrift(plan, nowCounts) {
  const reasons = [];
  const planConflicts = (plan.reports.byState.CONFLICT || 0) + ((plan.evaluations.byState || {}).CONFLICT || 0);
  const nowConflicts = (nowCounts.reports.byState.CONFLICT || 0) + (nowCounts.evaluations.byState.CONFLICT || 0);
  if (planConflicts > 0) reasons.push(`plan has ${planConflicts} CONFLICT`);
  if (nowConflicts > 0) reasons.push(`now has ${nowConflicts} CONFLICT`);
  const pairs = [
    ['reports.total', plan.reports.total, nowCounts.reports.total],
    ['reports.migratable(MIGRATE+HALF)', sumStates(plan.reports.byState, ['MIGRATE', 'HALF']),
      sumStates(nowCounts.reports.byState, ['MIGRATE', 'HALF'])],
    ['evaluations.actionable', sumStates(plan.evaluations.byState, ['DUPLICATE', 'NULL_ONLY', 'MOVE']),
      sumStates(nowCounts.evaluations.byState, ['DUPLICATE', 'NULL_ONLY', 'MOVE'])],
  ];
  for (const [label, planV, nowV] of pairs) {
    if (!withinTolerance(planV, nowV)) reasons.push(`${label}: plan=${planV} now=${nowV} beyond tolerance`);
  }
  return {ok: reasons.length === 0, reasons};
}

// ───────────────────────── أدوات ─────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** نصّ خطأ منقّى (القاعدة 36): الرمز واسم الصنف + رسالة تُخفى فيها المعرّفات والمسارات والرموز الطويلة. */
function sanitizeError(e) {
  const code = (e && e.code !== undefined) ? String(e.code) : 'NO_CODE';
  const className = (e && e.constructor && e.constructor.name) || typeof e;
  let msg = (e && typeof e.message === 'string') ? e.message : String(e);
  msg = msg.replace(/\b(reports|reportRaw|evaluations)\/[^\s"'/)]+/g, '$1/[id]');
  msg = msg.replace(/[A-Za-z0-9_-]{32,}/g, '[token]'); // معرّف UUID = 36 خانة؛ رموز الأخطاء المسمّاة (BACKUP_INSIDE_REPOSITORY…) أقصر من 32
  return {code, className, message: msg.slice(0, 200)};
}

function nowPlus03(now = () => new Date()) {
  const plus3 = new Date(now().getTime() + 3 * 60 * 60 * 1000);
  return plus3.toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

const zeroStates = (states) => Object.fromEntries(Object.values(states).map((s) => [s, 0]));
const inc = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };

function firestoreApi() {
  // تحميل كسول: الاختبارات الوحدوية لا تحتاج حزمة Firestore.
  const fs2 = require('firebase-admin/firestore');
  return {FieldValue: fs2.FieldValue, FieldPath: fs2.FieldPath, Timestamp: fs2.Timestamp, GeoPoint: fs2.GeoPoint};
}

// ───────────────────────── مسح التقارير (ترتيب: المعروض أولاً) ─────────────────────────

/**
 * مولِّد صفحات: المرحلة 1 المعروض والمُباع (where in)، المرحلة 2 البقيّة بترتيب معرّف المستند.
 * الاستئناف: الحقيقة في Firestore (التصنيف يُشتقّ كل مرّة) — لا مؤشّر مخزَّن.
 */
async function* iterateReportPages({db, pageSize = PAGE_SIZE}) {
  const {FieldPath} = firestoreApi();
  const exposedSnap = await db.collection(REPORTS_COLLECTION)
      .where('listingStatus', 'in', [...EXPOSED_LISTING_STATUSES]).select('listingStatus').get();
  const exposedIds = exposedSnap.docs.map((d) => d.id).sort();
  const exposedSet = new Set(exposedIds);
  for (let i = 0; i < exposedIds.length; i += pageSize) {
    const chunk = exposedIds.slice(i, i + pageSize);
    const docs = (await mapPool(chunk, CONCURRENCY, (id) => db.collection(REPORTS_COLLECTION).doc(id).get())).filter((s) => s.exists);
    yield {phase: 'exposed', docs};
  }
  let last = null;
  for (;;) {
    let q = db.collection(REPORTS_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    last = snap.docs[snap.docs.length - 1];
    yield {phase: 'rest', docs: snap.docs.filter((d) => !exposedSet.has(d.id))};
    if (snap.size < pageSize) return;
  }
}

async function* iterateEvaluationPages({db, pageSize = PAGE_SIZE}) {
  const {FieldPath} = firestoreApi();
  let last = null;
  for (;;) {
    let q = db.collection(EVALUATIONS_COLLECTION).orderBy(FieldPath.documentId()).limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return;
    last = snap.docs[snap.docs.length - 1];
    yield {docs: snap.docs};
    if (snap.size < pageSize) return;
  }
}

async function inspectReport({db, snap}) {
  const reportData = snap.data() || {};
  const rawRead = await readReportRaw({db, scanId: snap.id, reportData});
  const cls = classifyReport({reportData, rawRead});
  const exposed = EXPOSED_LISTING_STATUSES.includes(reportData.listingStatus);
  const moved = pickMoved(reportData);
  const candidate = cls.state === MIGRATION_STATE.MIGRATE ?
    buildMigrationRawDocument({scanId: snap.id, reportData, createdAt: null}) : null;
  const bytes = candidate ? measureReportRawBytes(candidate) : null;
  // قيمة لا يعرف الترميز نسخها احتياطياً (صنف غير مدعوم): لا حذف بلا نسخة، فيُتخطّى التقرير بحالة صريحة ويُعدّ — لا يوقف الباقي.
  let unencodable = null;
  try {
    for (const f of Object.keys(moved)) encodeValue(moved[f]);
  } catch (e) {
    unencodable = sanitizeError(e).message;
  }
  return {
    id: snap.id, snap, reportData, rawRead, exposed, moved, ...cls, unencodable,
    candidateBytes: bytes,
    tooLarge: bytes !== null && bytes > REPORT_RAW_MAX_BYTES,
    legacyRawLayerIdentifier: !!(rawRead.raw && has(rawRead.raw, 'rawFingerprint') && hasLegacyRawLayerIdentifier(rawRead.raw.rawFingerprint)),
  };
}

async function inspectEvaluation({db, snap}) {
  const evalData = snap.data() || {};
  const heldFields = EVALUATION_IDENTIFIER_FIELDS.filter((f) => has(evalData, f));
  if (heldFields.length === 0) return {id: snap.id, snap, evalData, state: EVAL_STATE.CLEAN, heldFields, perField: {}};
  const reportSnap = await db.collection(REPORTS_COLLECTION).doc(snap.id).get();
  const reportData = reportSnap.exists ? (reportSnap.data() || {}) : null;
  const rawRead = await readReportRaw({db, scanId: snap.id, reportData});
  const cls = classifyEvaluation({evalData, reportExists: reportSnap.exists, rawRead});
  return {id: snap.id, snap, evalData, rawRead, reportExists: reportSnap.exists, ...cls};
}

// ───────────────────────── الأعداد (قبل/بعد/جافّ/تحقّق) ─────────────────────────

/**
 * مسح قراءة بحتة. يُستعمَل للتشغيل الجافّ والتحقّق وأعداد «قبل» و«بعد» في --apply.
 * لا يحمل المخرَج قيماً خامّاً: أعداد ومعرّفات مهشَّرة فقط.
 */
async function collectCounts({db, pageSize = PAGE_SIZE, concurrency = CONCURRENCY, onPage = null}) {
  const reports = {
    total: 0, exposed: 0, withMovedFields: 0, exposedWithMovedFields: 0,
    byState: zeroStates(MIGRATION_STATE), exposedByState: zeroStates(MIGRATION_STATE),
    perField: Object.fromEntries(REPORT_RAW_FIELDS.map((f) => [f, {present: 0, nonNull: 0, nullValue: 0, absent: 0}])),
    tooLargeForRaw: 0, unencodable: 0, skippedByApply: {migrate: 0, total: 0}, movedBytes: {sum: 0, max: 0, measuredFor: 0},
    legacyRawLayerIdentifiersHeuristic: {
      reports: 0, exposedReports: 0,
      note: 'عدّ استدلالي لا قطعي: قيمة نصّية في deviceProfileKey (c/d أو layerB_firebaseId/layerC_androidId) ليست تجزئة 64 خانة سداسية ولا علامة غياب — القاعدة منقولة من نصّ الأمر والوثيقة §٧-٤، غير متحقَّق منها (القاعدة 29)',
    },
    conflictExamplesHashed: [], tooLargeExamplesHashed: [], unencodableExamplesHashed: [],
  };
  const evaluations = {
    total: 0, withIdentifierFields: 0, byState: zeroStates(EVAL_STATE),
    perField: Object.fromEntries(EVALUATION_IDENTIFIER_FIELDS.map((f) => [f, {present: 0, nonNull: 0, nullValue: 0, absent: 0}])),
    conflictExamplesHashed: [], orphanExamplesHashed: [], deferredExamplesHashed: [],
  };

  for await (const page of iterateReportPages({db, pageSize})) {
    const inspected = await mapPool(page.docs, concurrency, (snap) => inspectReport({db, snap}));
    for (const r of inspected) {
      reports.total++;
      if (r.exposed) reports.exposed++;
      inc(reports.byState, r.state);
      if (r.exposed) inc(reports.exposedByState, r.state);
      if (r.presentFields.length > 0) {
        reports.withMovedFields++;
        if (r.exposed) reports.exposedWithMovedFields++;
      }
      for (const f of REPORT_RAW_FIELDS) {
        const c = reports.perField[f];
        if (!has(r.reportData, f)) c.absent++;
        else {
          c.present++;
          if (r.reportData[f] === null) c.nullValue++; else c.nonNull++;
        }
      }
      if (r.candidateBytes !== null) {
        reports.movedBytes.sum += r.candidateBytes;
        reports.movedBytes.max = Math.max(reports.movedBytes.max, r.candidateBytes);
        reports.movedBytes.measuredFor++;
      }
      if (r.tooLarge) {
        reports.tooLargeForRaw++;
        if (reports.tooLargeExamplesHashed.length < MAX_EXAMPLES) reports.tooLargeExamplesHashed.push(hashId(r.id));
      }
      if (r.unencodable) {
        reports.unencodable++;
        if (reports.unencodableExamplesHashed.length < MAX_EXAMPLES) reports.unencodableExamplesHashed.push(hashId(r.id));
      }
      if ((r.state === MIGRATION_STATE.MIGRATE || r.state === MIGRATION_STATE.HALF) && (r.tooLarge || r.unencodable)) {
        reports.skippedByApply.total++;
        if (r.state === MIGRATION_STATE.MIGRATE) reports.skippedByApply.migrate++;
      }
      if (r.legacyRawLayerIdentifier) {
        reports.legacyRawLayerIdentifiersHeuristic.reports++;
        if (r.exposed) reports.legacyRawLayerIdentifiersHeuristic.exposedReports++;
      }
      if (r.state === MIGRATION_STATE.CONFLICT && reports.conflictExamplesHashed.length < MAX_EXAMPLES) {
        reports.conflictExamplesHashed.push({id: hashId(r.id), fields: r.conflictFields});
      }
    }
    if (onPage) onPage({collection: 'reports', phase: page.phase, count: page.docs.length});
  }

  for await (const page of iterateEvaluationPages({db, pageSize})) {
    const inspected = await mapPool(page.docs, concurrency, (snap) => inspectEvaluation({db, snap}));
    for (const e of inspected) {
      evaluations.total++;
      inc(evaluations.byState, e.state);
      if (e.heldFields.length > 0) evaluations.withIdentifierFields++;
      for (const f of EVALUATION_IDENTIFIER_FIELDS) {
        const c = evaluations.perField[f];
        if (!has(e.evalData, f)) c.absent++;
        else {
          c.present++;
          if (e.evalData[f] === null) c.nullValue++; else c.nonNull++;
        }
      }
      const bucket = {[EVAL_STATE.CONFLICT]: 'conflictExamplesHashed', [EVAL_STATE.ORPHAN]: 'orphanExamplesHashed',
        [EVAL_STATE.DEFERRED]: 'deferredExamplesHashed'}[e.state];
      if (bucket && evaluations[bucket].length < MAX_EXAMPLES) evaluations[bucket].push(hashId(e.id));
    }
    if (onPage) onPage({collection: 'evaluations', count: page.docs.length});
  }

  const rawCountSnap = await db.collection(REPORT_RAW_COLLECTION).count().get();
  const reportRaw = {total: rawCountSnap.data().count, bySource: {}};
  for (const src of Object.values(REPORT_RAW_SOURCE)) {
    const s = await db.collection(REPORT_RAW_COLLECTION).where('source', '==', src).count().get();
    reportRaw.bySource[src] = s.data().count;
  }
  reportRaw.bySource.otherOrAbsent = reportRaw.total - Object.values(reportRaw.bySource).reduce((a, b) => a + b, 0);

  return {reports, reportRaw, evaluations};
}

// ───────────────────────── المرحلتان: --apply --phase copy ثم --verify-copy ثم --apply --phase delete ─────────────────────────
//
// قرارا المستخدم، بنصّهما:
//   «--apply بمرحلتين: نعم. المرحلة الأولى تنسخ إلى reportRaw ولا تحذف، ثم تحقّق بالأداة، ثم المرحلة الثانية تحذف الحقول من التقرير،
//    بكتلة منفصلة وأمر صريح منّي.»
//   «يكفي أمري الصريح بكتلة --apply منفصلة، مع النسخة الاحتياطية JSONL التي يثبّتها السكربت على القرص قبل أيّ حذف. وتُثبت الكتلة أن ملفّ
//    النسخة موجود وغير فارغ قبل خطوة الحذف، وإلا تتوقّف.»
// والتوفيق بينهما (اقتراح المنسّق، المأخوذ به): المرحلة ١ تكتب النسخة JSONL وتفرّغها (fsync) ثم تنسخ إلى reportRaw ولا تحذف شيئاً؛ وضع
// --verify-copy قراءةً يقارن كل تقرير بـreportRaw الخاصّ به بالبايت (يعدّ المطابق والمختلف والغائب)؛ والمرحلة ٢ تشترط ملفّ النسخة نفسه
// وخلاصة --verify-copy خطّةً، ولا تحذف حقلاً من تقرير إلا إذا تطابق reportRaw بالبايت وكان له سطر في النسخة بالتجزئة نفسها، وكل ما سواه يُعدّ
// ويتوقّف قبل أيّ حذف. وevaluations على النمط نفسه.
//
// حارسان آليان (لا وعد في تعليق): assertCopyPayload (المرحلة ١ لا تكتب إلا في reportRaw ولا ترسل FieldValue.delete) وassertDeletePayload
// (المرحلة ٢ لا تكتب إلا حذف حقول من reports/evaluations ولا تلمس reportRaw). ويثبت الاختبار بمسجِّل كتابات حول db حقيقي (المحاكي): المرحلة ١
// صفر حذف، والمرحلة ٢ صفر كتابة في reportRaw.

const isAlreadyExists = (e) => e && (e.code === 6 || e.code === 'already-exists' || e.code === 'ALREADY_EXISTS');
const isPrecondition = (e) => e && (e.code === 9 || e.code === 'failed-precondition' || e.code === 'FAILED_PRECONDITION');
const staleReadError = () => Object.assign(new Error('STALE_READ'), {code: 'failed-precondition'});
const rawExistsError = () => Object.assign(new Error('RAW_EXISTS'), {code: 'already-exists'});

/** علامة حذف حقل (FieldValue.delete()) — أيّ قيمة تحملها في حمولة كتابة. */
function isFieldDelete(v, FieldValue) {
  if (v === null || typeof v !== 'object') return false;
  try {
    const sentinel = FieldValue.delete();
    return v === sentinel || (typeof v.isEqual === 'function' && v.isEqual(sentinel));
  } catch (e) {
    return false;
  }
}

/** المرحلة ١: لا تكتب إلا في reportRaw، ولا تحمل حمولتها علامة حذف. */
function assertCopyPayload(collection, data, FieldValue) {
  if (collection !== REPORT_RAW_COLLECTION) {
    throw new Error(`TRAP: المرحلة copy لا تكتب إلا في ${REPORT_RAW_COLLECTION}، لا في ${collection}`);
  }
  for (const [k, v] of Object.entries(data)) {
    if (isFieldDelete(v, FieldValue)) throw new Error(`TRAP: المرحلة copy لا تحذف شيئاً (الحقل ${k})`);
  }
}

/** المرحلة ٢: لا تكتب إلا حذف حقول من reports/evaluations، ولا حقل خارج المسموح، ولا قيمة غير علامة الحذف. */
function assertDeletePayload(collection, data, allowedFields, FieldValue) {
  if (collection !== REPORTS_COLLECTION && collection !== EVALUATIONS_COLLECTION) {
    throw new Error(`TRAP: المرحلة delete لا تكتب في ${collection} (reports وevaluations وحدهما)`);
  }
  const keys = Object.keys(data);
  if (keys.length === 0) throw new Error('TRAP: حمولة حذف فارغة');
  for (const k of keys) {
    if (!allowedFields.includes(k)) throw new Error(`TRAP: الحقل ${k} ليس من المنقول`);
    if (!isFieldDelete(data[k], FieldValue)) throw new Error(`TRAP: المرحلة delete تحذف حقولاً فقط (الحقل ${k})`);
  }
}

function deleteMap(FieldValue, fields) {
  const o = {};
  for (const f of fields) o[f] = FieldValue.delete();
  return o;
}

/** تجزئة قيمة حقل من ترميزها القانوني (مطابقة بالبايت: نوعها وبنيتها، لا تقريب). */
const fieldDigest = (v) => sha256Hex(stableStringify(encodeValue(v)));

const COPY_STATE = Object.freeze({
  MATCH: 'MATCH', // مستند reportRaw موجود وكل حقل منقول في التقرير مطابق لما فيه بالبايت
  DIFFER: 'DIFFER', // مستند reportRaw موجود وحقل مفقود فيه أو مختلف
  ABSENT: 'ABSENT', // لا مستند reportRaw (لم يُنسخ بعد، أو تُخطّي لحجمه/ترميزه)
});

/**
 * مقارنة بالبايت بين الحقول الحاضرة في التقرير وما في مستند reportRaw.
 * @return {?{state: string, fields: string[]}} null إن لم يحمل التقرير أيّاً من الخمسة (لا شيء يُقارَن)
 */
function compareReportToRaw({reportData, rawRead}) {
  const present = REPORT_RAW_FIELDS.filter((f) => has(reportData, f));
  if (present.length === 0) return null;
  if (rawRead.state !== RAW_STATE.PRIVATE) return {state: COPY_STATE.ABSENT, fields: []};
  const differ = [];
  for (const f of present) {
    let same = false;
    try {
      same = has(rawRead.raw, f) && fieldDigest(reportData[f]) === fieldDigest(rawRead.raw[f]);
    } catch (e) {
      same = false; // قيمة لا يعرف الترميز مقارنتها: لا تُعدّ مطابقة (القاعدة 22)
    }
    if (!same) differ.push(f);
  }
  return differ.length > 0 ? {state: COPY_STATE.DIFFER, fields: differ} : {state: COPY_STATE.MATCH, fields: []};
}

// ───────────────────────── المرحلة ١ — النسخ ولا حذف ─────────────────────────

function newCopyCounters() {
  return {
    reportsCopied: 0, reportsAlreadyCopied: 0, reportsSkippedAlreadyDone: 0, reportsNoRaw: 0,
    reportsSkippedTooLarge: 0, reportsSkippedUnencodable: 0, reportsRetried: 0, reportsFailed: 0,
    evaluationsCopied: 0, evaluationsAlreadyCovered: 0, evaluationsDeferred: 0, evaluationsOrphan: 0,
    evaluationsRetried: 0, evaluationsFailed: 0,
    readbackMismatches: 0, backupLinesReports: 0, backupLinesEvaluations: 0,
    failedExamplesHashed: [],
  };
}

/** يعيد قراءة المستند الخامّ ويقارنه بما كان في التقرير (بعد الإيداع). */
async function readbackMatches({db, scanId, expected}) {
  const snap = await db.collection(REPORT_RAW_COLLECTION).doc(scanId).get();
  if (!snap.exists) return false;
  const got = snap.data() || {};
  return Object.keys(expected).every((f) => has(got, f) && valuesEqual(got[f], expected[f]));
}

/** ينسخ تقريراً واحداً إلى reportRaw في معاملة تتحقّق أن التقرير لم يتغيّر منذ قراءته وأن لا خامّ قائماً. لا حذف ولا تعديل للتقرير. */
async function copyOneReport({db, cur, FieldValue}) {
  const reportRef = db.collection(REPORTS_COLLECTION).doc(cur.id);
  const rawRef = db.collection(REPORT_RAW_COLLECTION).doc(cur.id);
  const rawDoc = buildMigrationRawDocument({scanId: cur.id, reportData: cur.reportData, createdAt: FieldValue.serverTimestamp()});
  const expected = pickMoved(rawDoc);
  // فحص ذاتي قبل الإرسال: المكتوب مطابق لما قُرئ (القاعدة 20 — لا تعديل للخامّ).
  if (!Object.keys(cur.moved).every((f) => has(expected, f) && valuesEqual(expected[f], cur.moved[f])) ||
      Object.keys(expected).length !== Object.keys(cur.moved).length) {
    throw Object.assign(new Error('SELF_CHECK_MISMATCH'), {code: 'SELF_CHECK_MISMATCH'});
  }
  await db.runTransaction(async (tx) => {
    const [reportSnap, rawSnap] = await Promise.all([tx.get(reportRef), tx.get(rawRef)]);
    if (!reportSnap.exists || !reportSnap.updateTime || !cur.snap.updateTime || !reportSnap.updateTime.isEqual(cur.snap.updateTime)) throw staleReadError();
    if (rawSnap.exists) throw rawExistsError();
    assertCopyPayload(REPORT_RAW_COLLECTION, rawDoc, FieldValue);
    tx.create(rawRef, rawDoc);
  });
  return expected;
}

/**
 * يعالج صفحة تقارير في المرحلة ١: تفتيش ← نسخة احتياطية لكل ما سيُحذف لاحقاً (المنسوخ الآن والمنسوخ سابقاً HALF) ثم fsync ← نسخ إلى reportRaw.
 * لا يحذف ولا يعدّل تقريراً.
 * @return {Promise<{stop: ?string}>}
 */
async function copyReportPage({db, docs, backup, counters, log, concurrency = CONCURRENCY}) {
  const {FieldValue} = firestoreApi();
  const inspected = await mapPool(docs, concurrency, (snap) => inspectReport({db, snap}));

  const conflict = inspected.find((r) => r.state === MIGRATION_STATE.CONFLICT);
  if (conflict) {
    // «يتوقّف ويعدّه» — لا يبدأ شيء من هذه الصفحة (التعارض قد يخصّ حالة لا نفهمها بعد).
    counters.conflictHashed = hashId(conflict.id);
    return {stop: 'CONFLICT'};
  }

  const toCopy = [];
  const covered = [];
  for (const r of inspected) {
    if (r.state === MIGRATION_STATE.DONE) counters.reportsSkippedAlreadyDone++;
    else if (r.state === MIGRATION_STATE.NO_RAW) counters.reportsNoRaw++;
    else if (r.unencodable) {
      counters.reportsSkippedUnencodable++;
      log(`[skip-unencodable] ${hashId(r.id)}`);
    } else if (r.tooLarge) {
      counters.reportsSkippedTooLarge++;
      log(`[skip-too-large] ${hashId(r.id)} bytes=${r.candidateBytes} > ${REPORT_RAW_MAX_BYTES}`);
    } else if (r.state === MIGRATION_STATE.HALF) {
      covered.push(r); // خامّه منسوخ سابقاً وحقوله ما زالت في التقرير: لا نسخ، لكن يلزمه سطر في النسخة قبل المرحلة ٢
    } else {
      toCopy.push(r);
    }
  }
  if (covered.length === 0 && toCopy.length === 0) return {stop: null};

  // نسخة احتياطية لكل ما سيُحذف في المرحلة ٢ — تُكتب كلّها ثم fsync واحد، قبل أيّ كتابة في reportRaw.
  for (const r of [...covered, ...toCopy]) {
    if (backup.writeRecord(reportBackupLine({scanId: r.id, snap: r.snap, data: r.reportData}))) counters.backupLinesReports++;
  }
  backup.flush();
  counters.reportsAlreadyCopied += covered.length;

  let stop = null;
  await mapPool(toCopy, concurrency, async (r) => {
    if (stop) return;
    let cur = r;
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      try {
        const expected = await copyOneReport({db, cur, FieldValue});
        if (!(await readbackMatches({db, scanId: cur.id, expected}))) {
          counters.readbackMismatches++;
          stop = 'READBACK_MISMATCH';
          counters.readbackMismatchHashed = hashId(cur.id);
          return;
        }
        counters.reportsCopied++;
        return;
      } catch (e) {
        if (e && e.code === 'SELF_CHECK_MISMATCH') {
          stop = 'SELF_CHECK_MISMATCH';
          return;
        }
        if ((isPrecondition(e) || isAlreadyExists(e)) && attempt < MAX_COMMIT_ATTEMPTS) {
          // المالك عدّل المستند في الأثناء (أو ظهر خامّ) — أعد القراءة والتصنيف؛ لا نسخ من قراءة قديمة.
          counters.reportsRetried++;
          const fresh = await db.collection(REPORTS_COLLECTION).doc(cur.id).get();
          if (!fresh.exists) return;
          cur = await inspectReport({db, snap: fresh});
          if (cur.state === MIGRATION_STATE.CONFLICT) { stop = 'CONFLICT'; counters.conflictHashed = hashId(cur.id); return; }
          if (cur.state === MIGRATION_STATE.DONE || cur.state === MIGRATION_STATE.NO_RAW) return;
          if (cur.state === MIGRATION_STATE.HALF) { counters.reportsAlreadyCopied++; }
          if (backup.writeRecord(reportBackupLine({scanId: cur.id, snap: cur.snap, data: cur.reportData}))) counters.backupLinesReports++;
          backup.flush();
          if (cur.state === MIGRATION_STATE.HALF) return;
          continue;
        }
        counters.reportsFailed++;
        if (counters.failedExamplesHashed.length < MAX_EXAMPLES) {
          counters.failedExamplesHashed.push({id: hashId(cur.id), ...sanitizeError(e)});
        }
        if (counters.reportsFailed >= MAX_FAILURES_BEFORE_STOP) stop = 'TOO_MANY_FAILURES';
        return;
      }
    }
  });
  return {stop};
}

/** ينسخ إلى reportRaw قيَم المعرّفات التي يحملها تقييم ولا نسخة لها في الخامّ (MOVE). لا يعدّل التقييم. */
async function copyOneEvaluationMove({db, cur, FieldValue}) {
  const toMove = {};
  for (const f of cur.heldFields) if (cur.perField[f] === 'ONLY_COPY') toMove[f] = cur.evalData[f];
  const evalRef = db.collection(EVALUATIONS_COLLECTION).doc(cur.id);
  const rawRef = db.collection(REPORT_RAW_COLLECTION).doc(cur.id);
  await db.runTransaction(async (tx) => {
    const [evalSnap, rawSnap] = await Promise.all([tx.get(evalRef), tx.get(rawRef)]);
    if (!evalSnap.exists || !evalSnap.updateTime || !cur.snap.updateTime || !evalSnap.updateTime.isEqual(cur.snap.updateTime)) throw staleReadError();
    if (cur.rawRead.state === RAW_STATE.PRIVATE) {
      if (!rawSnap.exists) throw staleReadError();
      const rawData = rawSnap.data() || {};
      if (Object.keys(toMove).some((f) => has(rawData, f))) throw staleReadError(); // ظهرت قيمة في الخامّ بعد القراءة: أعد التصنيف
      assertCopyPayload(REPORT_RAW_COLLECTION, toMove, FieldValue);
      tx.update(rawRef, toMove);
    } else {
      if (rawSnap.exists) throw rawExistsError();
      const doc = {scanId: cur.id, ...toMove, source: REPORT_RAW_SOURCE.MIGRATION, createdAt: FieldValue.serverTimestamp()};
      assertCopyPayload(REPORT_RAW_COLLECTION, doc, FieldValue);
      tx.create(rawRef, doc);
    }
  });
  return toMove;
}

/** يعالج صفحة evaluations في المرحلة ١: نسخة احتياطية لكل تقييم سيُنظَّف لاحقاً، ونسخ قيَم MOVE إلى reportRaw. لا يعدّل تقييماً. */
async function copyEvaluationPage({db, docs, backup, counters, log, concurrency = CONCURRENCY}) {
  const {FieldValue} = firestoreApi();
  const inspected = await mapPool(docs, concurrency, (snap) => inspectEvaluation({db, snap}));
  if (inspected.some((e) => e.state === EVAL_STATE.CONFLICT)) {
    counters.conflictHashed = hashId(inspected.find((e) => e.state === EVAL_STATE.CONFLICT).id);
    return {stop: 'CONFLICT'};
  }
  const actionable = [];
  for (const e of inspected) {
    if (e.state === EVAL_STATE.DEFERRED) counters.evaluationsDeferred++;
    else if (e.state === EVAL_STATE.ORPHAN) counters.evaluationsOrphan++;
    else if ([EVAL_STATE.DUPLICATE, EVAL_STATE.NULL_ONLY, EVAL_STATE.MOVE].includes(e.state)) actionable.push(e);
  }
  if (actionable.length === 0) return {stop: null};

  for (const e of actionable) {
    if (backup.writeRecord(evaluationBackupLine({evalId: e.id, snap: e.snap, data: e.evalData, heldFields: e.heldFields}))) counters.backupLinesEvaluations++;
  }
  backup.flush();
  counters.evaluationsAlreadyCovered += actionable.filter((e) => e.state !== EVAL_STATE.MOVE).length;

  let stop = null;
  await mapPool(actionable.filter((e) => e.state === EVAL_STATE.MOVE), concurrency, async (e) => {
    if (stop) return;
    let cur = e;
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      try {
        const moved = await copyOneEvaluationMove({db, cur, FieldValue});
        if (!(await readbackMatches({db, scanId: cur.id, expected: moved}))) {
          counters.readbackMismatches++;
          counters.readbackMismatchHashed = hashId(cur.id);
          stop = 'READBACK_MISMATCH';
          return;
        }
        counters.evaluationsCopied++;
        return;
      } catch (err) {
        if ((isPrecondition(err) || isAlreadyExists(err)) && attempt < MAX_COMMIT_ATTEMPTS) {
          counters.evaluationsRetried++;
          const fresh = await db.collection(EVALUATIONS_COLLECTION).doc(cur.id).get();
          if (!fresh.exists) return;
          cur = await inspectEvaluation({db, snap: fresh});
          if (cur.state === EVAL_STATE.CONFLICT) { stop = 'CONFLICT'; counters.conflictHashed = hashId(cur.id); return; }
          if (![EVAL_STATE.DUPLICATE, EVAL_STATE.NULL_ONLY, EVAL_STATE.MOVE].includes(cur.state)) return;
          if (backup.writeRecord(evaluationBackupLine({evalId: cur.id, snap: cur.snap, data: cur.evalData, heldFields: cur.heldFields}))) counters.backupLinesEvaluations++;
          backup.flush();
          if (cur.state !== EVAL_STATE.MOVE) return;
          continue;
        }
        counters.evaluationsFailed++;
        if (counters.failedExamplesHashed.length < MAX_EXAMPLES) {
          counters.failedExamplesHashed.push({id: hashId(cur.id), ...sanitizeError(err)});
        }
        if (counters.evaluationsFailed >= MAX_FAILURES_BEFORE_STOP) stop = 'TOO_MANY_FAILURES';
        return;
      }
    }
  });
  void log;
  return {stop};
}

// ───────────────────────── --verify-copy — مقارنة بالبايت، قراءة بحتة ─────────────────────────

/**
 * يمسح التقارير وevaluations ويقارن كل ما يحمل حقلاً منقولاً بـreportRaw الخاصّ به بالبايت. ومع فهرس نسخة: يفحص أن لكل ما سيُحذف سطراً
 * بالتجزئة نفسها. قراءة بحتة (db مغلَّف بـwrapReadOnly من المستدعي).
 * @param {Object} p
 * @param {?{reports: Map, evaluations: Map}} p.backupIndex فهرس ملفّ النسخة (inspectBackupFile) أو null
 */
async function collectCopyStatus({db, backupIndex = null, pageSize = PAGE_SIZE, concurrency = CONCURRENCY, onPage = null}) {
  const reports = {
    total: 0, withMovedFields: 0, withoutMovedFields: 0,
    byteCompare: {[COPY_STATE.MATCH]: 0, [COPY_STATE.DIFFER]: 0, [COPY_STATE.ABSENT]: 0},
    notCopiedTooLarge: 0, notCopiedUnencodable: 0,
    noBackupLine: 0, backupLineMismatch: 0,
    differExamplesHashed: [], absentExamplesHashed: [], noBackupLineExamplesHashed: [], backupLineMismatchExamplesHashed: [],
  };
  const evaluations = {
    total: 0, holdingIdentifiers: 0,
    ready: {[EVAL_STATE.DUPLICATE]: 0, [EVAL_STATE.NULL_ONLY]: 0},
    blocking: {[EVAL_STATE.MOVE]: 0, [EVAL_STATE.CONFLICT]: 0},
    leftAsIs: {[EVAL_STATE.ORPHAN]: 0, [EVAL_STATE.DEFERRED]: 0},
    noBackupLine: 0, backupLineMismatch: 0,
    blockingExamplesHashed: [], noBackupLineExamplesHashed: [], backupLineMismatchExamplesHashed: [],
  };
  const push = (arr, v) => { if (arr.length < MAX_EXAMPLES) arr.push(v); };

  for await (const page of iterateReportPages({db, pageSize})) {
    const inspected = await mapPool(page.docs, concurrency, (snap) => inspectReport({db, snap}));
    for (const r of inspected) {
      reports.total++;
      const cmp = compareReportToRaw({reportData: r.reportData, rawRead: r.rawRead});
      if (cmp === null) { reports.withoutMovedFields++; continue; }
      reports.withMovedFields++;
      reports.byteCompare[cmp.state]++;
      if (cmp.state === COPY_STATE.DIFFER) push(reports.differExamplesHashed, {id: hashId(r.id), fields: cmp.fields});
      if (cmp.state === COPY_STATE.ABSENT) {
        push(reports.absentExamplesHashed, hashId(r.id));
        if (r.tooLarge) reports.notCopiedTooLarge++;
        if (r.unencodable) reports.notCopiedUnencodable++;
      }
      if (backupIndex && cmp.state === COPY_STATE.MATCH) {
        const rec = backupIndex.reports.get(r.id);
        let sha = null;
        try { sha = reportBackupLine({scanId: r.id, snap: r.snap, data: r.reportData}).fieldsSha256; } catch (e) { sha = null; }
        if (!rec) { reports.noBackupLine++; push(reports.noBackupLineExamplesHashed, hashId(r.id)); }
        else if (sha === null || rec.fieldsSha256 !== sha) { reports.backupLineMismatch++; push(reports.backupLineMismatchExamplesHashed, hashId(r.id)); }
      }
    }
    if (onPage) onPage({collection: 'reports', phase: page.phase, count: page.docs.length});
  }

  for await (const page of iterateEvaluationPages({db, pageSize})) {
    const inspected = await mapPool(page.docs, concurrency, (snap) => inspectEvaluation({db, snap}));
    for (const e of inspected) {
      evaluations.total++;
      if (e.heldFields.length === 0) continue;
      evaluations.holdingIdentifiers++;
      if (e.state === EVAL_STATE.DUPLICATE || e.state === EVAL_STATE.NULL_ONLY) {
        evaluations.ready[e.state]++;
        if (backupIndex) {
          const rec = backupIndex.evaluations.get(e.id);
          const sha = evaluationBackupLine({evalId: e.id, snap: e.snap, data: e.evalData, heldFields: e.heldFields}).fieldsSha256;
          if (!rec) { evaluations.noBackupLine++; push(evaluations.noBackupLineExamplesHashed, hashId(e.id)); }
          else if (rec.fieldsSha256 !== sha) { evaluations.backupLineMismatch++; push(evaluations.backupLineMismatchExamplesHashed, hashId(e.id)); }
        }
      } else if (e.state === EVAL_STATE.MOVE || e.state === EVAL_STATE.CONFLICT) {
        evaluations.blocking[e.state]++;
        push(evaluations.blockingExamplesHashed, {id: hashId(e.id), state: e.state});
      } else if (e.state === EVAL_STATE.ORPHAN || e.state === EVAL_STATE.DEFERRED) {
        evaluations.leftAsIs[e.state]++;
      }
    }
    if (onPage) onPage({collection: 'evaluations', count: page.docs.length});
  }
  return {reports, evaluations};
}

/** ما يمنع المرحلة ٢ (وكل ما سواه يُعدّ ويتوقّف). ORPHAN وDEFERRED لا تمنع: تُترك وتُعدّ (كما كان في --apply الواحد). */
function copyStatusBlockers(status, {backupProvided}) {
  const blockers = [];
  const r = status.reports;
  const e = status.evaluations;
  if (r.byteCompare.DIFFER > 0) blockers.push(`reports DIFFER=${r.byteCompare.DIFFER}`);
  if (r.byteCompare.ABSENT > 0) blockers.push(`reports ABSENT=${r.byteCompare.ABSENT}`);
  if (e.blocking.MOVE > 0) blockers.push(`evaluations MOVE (لم تُنسخ قيمها)=${e.blocking.MOVE}`);
  if (e.blocking.CONFLICT > 0) blockers.push(`evaluations CONFLICT=${e.blocking.CONFLICT}`);
  if (!backupProvided) blockers.push('BACKUP_NOT_PROVIDED');
  if (r.noBackupLine > 0) blockers.push(`reports بلا سطر نسخة=${r.noBackupLine}`);
  if (r.backupLineMismatch > 0) blockers.push(`reports سطر نسخة بتجزئة مختلفة=${r.backupLineMismatch}`);
  if (e.noBackupLine > 0) blockers.push(`evaluations بلا سطر نسخة=${e.noBackupLine}`);
  if (e.backupLineMismatch > 0) blockers.push(`evaluations سطر نسخة بتجزئة مختلفة=${e.backupLineMismatch}`);
  return blockers;
}

// ───────────────────────── المرحلة ٢ — الحذف بعد التحقّق ─────────────────────────

function newDeleteCounters() {
  return {
    reportsDeleted: 0, reportsAlreadyClean: 0, reportsGone: 0,
    reportsBlockedAbsent: 0, reportsBlockedDiffer: 0, reportsBlockedNoBackupLine: 0, reportsBlockedBackupMismatch: 0, reportsBlockedUnencodable: 0,
    evaluationsDeleted: 0, evaluationsAlreadyClean: 0, evaluationsGone: 0, evaluationsLeftAsIs: 0,
    evaluationsBlocked: 0, evaluationsBlockedNoBackupLine: 0, evaluationsBlockedBackupMismatch: 0,
    failed: 0, retried: 0, blockedExamplesHashed: [], failedExamplesHashed: [],
  };
}

/** يحذف الحقول المنقولة من تقرير واحد في معاملة تعيد التحقّق عند الحذف نفسه: مطابقة reportRaw بالبايت + سطر نسخة بالتجزئة نفسها. */
async function deleteOneReport({db, id, backupIndex, FieldValue}) {
  const reportRef = db.collection(REPORTS_COLLECTION).doc(id);
  const rawRef = db.collection(REPORT_RAW_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const [reportSnap, rawSnap] = await Promise.all([tx.get(reportRef), tx.get(rawRef)]);
    if (!reportSnap.exists) return {outcome: 'GONE'};
    const reportData = reportSnap.data() || {};
    const present = REPORT_RAW_FIELDS.filter((f) => has(reportData, f));
    if (present.length === 0) return {outcome: 'ALREADY_CLEAN'};
    if (!rawSnap.exists) return {outcome: 'BLOCKED_ABSENT'};
    const cmp = compareReportToRaw({reportData, rawRead: {state: RAW_STATE.PRIVATE, raw: rawSnap.data() || {}}});
    if (cmp.state !== COPY_STATE.MATCH) return {outcome: 'BLOCKED_DIFFER', fields: cmp.fields};
    let sha;
    try {
      sha = reportBackupLine({scanId: id, snap: reportSnap, data: reportData}).fieldsSha256;
    } catch (e) {
      return {outcome: 'BLOCKED_UNENCODABLE'};
    }
    const rec = backupIndex.reports.get(id);
    if (!rec) return {outcome: 'BLOCKED_NO_BACKUP_LINE'};
    if (rec.fieldsSha256 !== sha) return {outcome: 'BLOCKED_BACKUP_MISMATCH'};
    const payload = deleteMap(FieldValue, present);
    assertDeletePayload(REPORTS_COLLECTION, payload, REPORT_RAW_FIELDS, FieldValue);
    tx.update(reportRef, payload);
    return {outcome: 'DELETED'};
  });
}

/** يحذف المعرّفات الثلاثة من تقييم واحد: كلّ قيمة مطابقة لما في reportRaw بالبايت (أو null)، وسطر نسخة بالتجزئة نفسها. */
async function deleteOneEvaluation({db, id, backupIndex, FieldValue}) {
  const evalRef = db.collection(EVALUATIONS_COLLECTION).doc(id);
  const rawRef = db.collection(REPORT_RAW_COLLECTION).doc(id);
  return db.runTransaction(async (tx) => {
    const [evalSnap, rawSnap] = await Promise.all([tx.get(evalRef), tx.get(rawRef)]);
    if (!evalSnap.exists) return {outcome: 'GONE'};
    const evalData = evalSnap.data() || {};
    const held = EVALUATION_IDENTIFIER_FIELDS.filter((f) => has(evalData, f));
    if (held.length === 0) return {outcome: 'ALREADY_CLEAN'};
    const rawRead = rawSnap.exists ? {state: RAW_STATE.PRIVATE, raw: rawSnap.data() || {}} : {state: RAW_STATE.ABSENT, raw: null};
    const cls = classifyEvaluation({evalData, reportExists: true, rawRead});
    if (cls.state !== EVAL_STATE.DUPLICATE && cls.state !== EVAL_STATE.NULL_ONLY) return {outcome: 'BLOCKED', state: cls.state};
    const sha = evaluationBackupLine({evalId: id, snap: evalSnap, data: evalData, heldFields: held}).fieldsSha256;
    const rec = backupIndex.evaluations.get(id);
    if (!rec) return {outcome: 'BLOCKED_NO_BACKUP_LINE'};
    if (rec.fieldsSha256 !== sha) return {outcome: 'BLOCKED_BACKUP_MISMATCH'};
    const payload = deleteMap(FieldValue, held);
    assertDeletePayload(EVALUATIONS_COLLECTION, payload, EVALUATION_IDENTIFIER_FIELDS, FieldValue);
    tx.update(evalRef, payload);
    return {outcome: 'DELETED'};
  });
}

/** يعالج صفحة تقارير في المرحلة ٢. أيّ حالة غير «محذوف/نظيف» تُعدّ وتوقف التشغيل. */
async function deleteReportPage({db, docs, backupIndex, counters, concurrency = CONCURRENCY}) {
  const {FieldValue} = firestoreApi();
  let stop = null;
  await mapPool(docs, concurrency, async (snap) => {
    if (stop) return;
    const id = snap.id;
    if (!REPORT_RAW_FIELDS.some((f) => has(snap.data() || {}, f))) { counters.reportsAlreadyClean++; return; }
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      try {
        const res = await deleteOneReport({db, id, backupIndex, FieldValue});
        const blocked = {
          BLOCKED_ABSENT: 'reportsBlockedAbsent', BLOCKED_DIFFER: 'reportsBlockedDiffer', BLOCKED_NO_BACKUP_LINE: 'reportsBlockedNoBackupLine',
          BLOCKED_BACKUP_MISMATCH: 'reportsBlockedBackupMismatch', BLOCKED_UNENCODABLE: 'reportsBlockedUnencodable',
        }[res.outcome];
        if (blocked) {
          counters[blocked]++;
          if (counters.blockedExamplesHashed.length < MAX_EXAMPLES) counters.blockedExamplesHashed.push({id: hashId(id), outcome: res.outcome, fields: res.fields || []});
          stop = res.outcome;
        } else if (res.outcome === 'DELETED') counters.reportsDeleted++;
        else if (res.outcome === 'ALREADY_CLEAN') counters.reportsAlreadyClean++;
        else counters.reportsGone++;
        return;
      } catch (e) {
        if (isPrecondition(e) && attempt < MAX_COMMIT_ATTEMPTS) { counters.retried++; continue; }
        counters.failed++;
        if (counters.failedExamplesHashed.length < MAX_EXAMPLES) counters.failedExamplesHashed.push({id: hashId(id), ...sanitizeError(e)});
        if (counters.failed >= MAX_FAILURES_BEFORE_STOP) stop = 'TOO_MANY_FAILURES';
        return;
      }
    }
  });
  return {stop};
}

/** يعالج صفحة evaluations في المرحلة ٢: ما حالته DUPLICATE/NULL_ONLY يُنظَّف؛ ORPHAN/DEFERRED تُترك وتُعدّ؛ وما سواها يوقف. */
async function deleteEvaluationPage({db, docs, backupIndex, counters, concurrency = CONCURRENCY}) {
  const {FieldValue} = firestoreApi();
  const inspected = await mapPool(docs, concurrency, (snap) => inspectEvaluation({db, snap}));
  let stop = null;
  await mapPool(inspected, concurrency, async (e) => {
    if (stop) return;
    if (e.state === EVAL_STATE.CLEAN) { counters.evaluationsAlreadyClean++; return; }
    if (e.state === EVAL_STATE.ORPHAN || e.state === EVAL_STATE.DEFERRED) { counters.evaluationsLeftAsIs++; return; }
    if (e.state !== EVAL_STATE.DUPLICATE && e.state !== EVAL_STATE.NULL_ONLY) {
      counters.evaluationsBlocked++;
      if (counters.blockedExamplesHashed.length < MAX_EXAMPLES) counters.blockedExamplesHashed.push({id: hashId(e.id), outcome: `EVALUATION_${e.state}`});
      stop = `EVALUATION_${e.state}`;
      return;
    }
    for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
      try {
        const res = await deleteOneEvaluation({db, id: e.id, backupIndex, FieldValue});
        if (res.outcome === 'DELETED') counters.evaluationsDeleted++;
        else if (res.outcome === 'ALREADY_CLEAN') counters.evaluationsAlreadyClean++;
        else if (res.outcome === 'GONE') counters.evaluationsGone++;
        else {
          if (res.outcome === 'BLOCKED_NO_BACKUP_LINE') counters.evaluationsBlockedNoBackupLine++;
          else if (res.outcome === 'BLOCKED_BACKUP_MISMATCH') counters.evaluationsBlockedBackupMismatch++;
          else counters.evaluationsBlocked++;
          if (counters.blockedExamplesHashed.length < MAX_EXAMPLES) counters.blockedExamplesHashed.push({id: hashId(e.id), outcome: res.outcome, state: res.state || null});
          stop = res.outcome;
        }
        return;
      } catch (err) {
        if (isPrecondition(err) && attempt < MAX_COMMIT_ATTEMPTS) { counters.retried++; continue; }
        counters.failed++;
        if (counters.failedExamplesHashed.length < MAX_EXAMPLES) counters.failedExamplesHashed.push({id: hashId(e.id), ...sanitizeError(err)});
        if (counters.failed >= MAX_FAILURES_BEFORE_STOP) stop = 'TOO_MANY_FAILURES';
        return;
      }
    }
  });
  return {stop};
}

// ───────────────────────── ملفّ النسخة: فحص بلا تحميل كامل في الذاكرة ─────────────────────────

/**
 * يقرأ ملفّ JSONL على دفعات بايتات ويستدعي onLine(نصّ السطر) لكل سطر غير فارغ، ويحسب تجزئة الملفّ كلّه. (نسخة قد تبلغ مئات الميغابايت.)
 * @return {{totalLines: number, sha256: string}}
 */
function scanBackupFile(abs, onLine) {
  const fd = fs.openSync(abs, 'r');
  const hash = crypto.createHash('sha256');
  const chunk = Buffer.alloc(4 * 1024 * 1024);
  let carry = Buffer.alloc(0);
  let totalLines = 0;
  const emit = (buf) => {
    const text = buf.toString('utf8');
    if (text.trim() === '') return;
    totalLines++;
    onLine(text, totalLines);
  };
  try {
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      hash.update(chunk.subarray(0, read));
      let buf = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, read)]) : Buffer.from(chunk.subarray(0, read));
      let nl = buf.indexOf(0x0a);
      while (nl !== -1) {
        emit(buf.subarray(0, nl));
        buf = buf.subarray(nl + 1);
        nl = buf.indexOf(0x0a);
      }
      carry = Buffer.from(buf);
    }
    if (carry.length > 0) emit(carry);
  } finally {
    fs.closeSync(fd);
  }
  return {totalLines, sha256: hash.digest('hex')};
}

/**
 * يفحص ملفّ النسخة: موجود، ملفّ عادي، غير فارغ، كل سطر JSON صالح، ترويسته من هذه الأداة ولهذا المشروع. يُرجع فهرساً: آخر سجلّ (تجزئة الحقول)
 * لكل تقرير وتقييم، وعدد الأسطر، وتجزئة الملفّ. رسائل الأخطاء لا تحمل محتوى سطر (القاعدة 36).
 */
function inspectBackupFile(backupPath) {
  if (typeof backupPath !== 'string' || backupPath.trim() === '') throw new Error('BACKUP_PATH_MISSING: --backup <ملفّ.jsonl> مطلوب');
  const abs = path.resolve(backupPath);
  let stat = null;
  try { stat = fs.statSync(abs); } catch (e) { stat = null; }
  if (!stat) throw new Error('BACKUP_MISSING: ملفّ النسخة غير موجود');
  if (!stat.isFile()) throw new Error('BACKUP_NOT_A_FILE');
  if (stat.size === 0) throw new Error('BACKUP_EMPTY: ملفّ النسخة فارغ');
  const reports = new Map();
  const evaluations = new Map();
  let header = null;
  const {totalLines, sha256} = scanBackupFile(abs, (text, lineNo) => {
    let rec;
    try {
      rec = JSON.parse(text);
    } catch (e) {
      throw new Error(`BACKUP_LINE_INVALID: line=${lineNo}`);
    }
    if (rec && rec.kind === 'header' && !header) header = rec;
    else if (rec && rec.kind === 'report' && typeof rec.scanId === 'string') reports.set(rec.scanId, {fieldsSha256: rec.fieldsSha256});
    else if (rec && rec.kind === 'evaluation' && typeof rec.evalId === 'string') evaluations.set(rec.evalId, {fieldsSha256: rec.fieldsSha256});
  });
  if (!header || header.v !== BACKUP_FORMAT || header.projectId !== PROJECT_ID) throw new Error('BACKUP_HEADER_INVALID');
  return {path: abs, bytes: stat.size, totalLines, sha256, reportRecords: reports.size, evaluationRecords: evaluations.size, reports, evaluations};
}

/**
 * شرط المرحلة ٢ على ملفّ النسخة (بلا شبكة): موجود، غير فارغ، سليم، وهو نفسه الذي جرى عليه --verify-copy (عدد أسطره وتجزئته وعدد سجلّاته كما في الخطّة).
 * @param {string} backupPath
 * @param {Object} plan خلاصة --verify-copy محمَّلة بـloadPlan(path, 'verify-copy')
 * @return {Object} فهرس النسخة
 */
function assertBackupReadyForDelete(backupPath, plan) {
  assertBackupPathOutsideRepos(backupPath);
  const idx = inspectBackupFile(backupPath);
  if (idx.totalLines !== plan.backup.totalLines) {
    throw new Error(`BACKUP_LINES_MISMATCH: الملفّ ${idx.totalLines} سطراً والخطّة ${plan.backup.totalLines}`);
  }
  if (idx.reportRecords !== plan.backup.reportRecords || idx.evaluationRecords !== plan.backup.evaluationRecords) {
    throw new Error(`BACKUP_RECORDS_MISMATCH: تقارير ${idx.reportRecords}/${plan.backup.reportRecords} وتقييمات ${idx.evaluationRecords}/${plan.backup.evaluationRecords}`);
  }
  if (idx.sha256 !== plan.backup.sha256) throw new Error('BACKUP_CHANGED_SINCE_VERIFY: تجزئة الملفّ تخالف التي جرى عليها --verify-copy');
  return idx;
}

// ───────────────────────── الأوضاع ─────────────────────────

function baseSummary({mode, target, now}) {
  return {
    projectId: PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
    target,
    mode,
    schema: PLAN_SCHEMA,
    generatedAtPlus03: nowPlus03(now),
    movedFields: REPORT_RAW_FIELDS,
    evaluationIdentifierFields: EVALUATION_IDENTIFIER_FIELDS,
    exposedListingStatuses: EXPOSED_LISTING_STATUSES,
  };
}

/** --dry-run: قراءة بحتة. يطبع أعداد ما سيُفعل في كل مرحلة. */
async function runDryRun({db, target, now, log = () => {}, pageSize, concurrency}) {
  const readDb = wrapReadOnly(db);
  const counts = await collectCounts({db: readDb, pageSize, concurrency, onPage: (p) => log(`[scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
  const summary = {...baseSummary({mode: 'dry-run', target, now}), ...counts};
  summary.wouldWrite = {
    reportRawDocumentsToCreate: counts.reports.byState.MIGRATE - counts.reports.skippedByApply.migrate,
    reportsToCleanFromMovedFields: counts.reports.byState.MIGRATE + counts.reports.byState.HALF - counts.reports.skippedByApply.total,
    reportsSkippedTooLarge: counts.reports.tooLargeForRaw,
    reportsSkippedUnencodable: counts.reports.unencodable,
    reportsNoRawNothingWritten: counts.reports.byState.NO_RAW,
    evaluationsToClean: counts.evaluations.byState.DUPLICATE + counts.evaluations.byState.NULL_ONLY + counts.evaluations.byState.MOVE,
    evaluationsToMoveToReportRaw: counts.evaluations.byState.MOVE,
    evaluationsLeftAsIs: counts.evaluations.byState.DEFERRED + counts.evaluations.byState.ORPHAN,
    stopsBecauseOfConflicts: counts.reports.byState.CONFLICT + counts.evaluations.byState.CONFLICT,
  };
  // المرحلتان (قرار المستخدم): ١ نسخ بلا حذف، ٢ حذف بعد --verify-copy. الأعداد المسطَّحة أعلاه مجموع المرحلتين كما كانت.
  summary.wouldWrite.phases = {
    copy: {
      reportRawDocumentsToCreate: summary.wouldWrite.reportRawDocumentsToCreate,
      evaluationValuesToCopyToReportRaw: counts.evaluations.byState.MOVE,
      backupRecords: {
        reports: counts.reports.byState.MIGRATE + counts.reports.byState.HALF - counts.reports.skippedByApply.total,
        evaluations: summary.wouldWrite.evaluationsToClean,
      },
      deletes: 0,
    },
    delete: {
      reportsToCleanFromMovedFields: summary.wouldWrite.reportsToCleanFromMovedFields,
      evaluationsToClean: summary.wouldWrite.evaluationsToClean,
    },
  };
  const blocked = summary.wouldWrite.stopsBecauseOfConflicts > 0;
  return {summary, exitCode: blocked ? EXIT.STOPPED : EXIT.OK};
}

/** --verify: قراءة بحتة. «0 باقياً» شرط القرار ٥. */
async function runVerify({db, target, now, log = () => {}, pageSize, concurrency}) {
  const readDb = wrapReadOnly(db);
  const counts = await collectCounts({db: readDb, pageSize, concurrency, onPage: (p) => log(`[scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
  const residualReports = counts.reports.withMovedFields;
  const residualExposed = counts.reports.exposedWithMovedFields;
  const residualEvaluations = counts.evaluations.withIdentifierFields;
  const summary = {
    ...baseSummary({mode: 'verify', target, now}),
    ...counts,
    verdict: {
      residualReportsWithMovedFields: residualReports,
      residualExposedReportsWithMovedFields: residualExposed,
      residualEvaluationsWithIdentifierFields: residualEvaluations,
      comparisonViolations: counts.reports.byState.CONFLICT + counts.evaluations.byState.CONFLICT,
      reportsNoRaw: counts.reports.byState.NO_RAW,
      reportRawDocuments: counts.reportRaw.total,
      decision5Satisfied: residualReports === 0,
    },
  };
  let exitCode = EXIT.OK;
  if (residualReports > 0 || summary.verdict.comparisonViolations > 0) exitCode = EXIT.RESIDUAL_REPORTS;
  else if (residualEvaluations > 0) exitCode = EXIT.RESIDUAL_EVALUATIONS;
  return {summary, exitCode};
}

/**
 * --verify-copy [--backup <ملفّ>]: قراءة بحتة بين المرحلتين. يقارن كل تقرير يحمل حقلاً منقولاً بـreportRaw الخاصّ به بالبايت (يعدّ المطابق
 * والمختلف والغائب)، وevaluations، ومع --backup يفحص أن لكل ما سيُحذف سطراً بتجزئته. مخرَجه هو «الخطّة» التي تشترطها المرحلة ٢.
 */
async function runVerifyCopy({db, target, now, backupPath = null, log = () => {}, pageSize, concurrency}) {
  const readDb = wrapReadOnly(db);
  const backupIndex = backupPath ? inspectBackupFile(backupPath) : null;
  const status = await collectCopyStatus({db: readDb, backupIndex, pageSize, concurrency, onPage: (p) => log(`[verify-copy] ${p.collection} ${p.phase || ''} +${p.count}`)});
  const blockers = copyStatusBlockers(status, {backupProvided: backupIndex !== null});
  const readyEvaluations = status.evaluations.ready.DUPLICATE + status.evaluations.ready.NULL_ONLY;
  const summary = {
    ...baseSummary({mode: 'verify-copy', target, now}),
    ...status,
    backup: backupIndex ?
      {provided: true, path: backupIndex.path, bytes: backupIndex.bytes, totalLines: backupIndex.totalLines, sha256: backupIndex.sha256,
        reportRecords: backupIndex.reportRecords, evaluationRecords: backupIndex.evaluationRecords} :
      {provided: false},
    expected: {reportRecords: status.reports.byteCompare.MATCH, evaluationRecords: readyEvaluations},
    blockers,
    ready: blockers.length === 0,
  };
  return {summary, exitCode: summary.ready ? EXIT.OK : EXIT.STOPPED};
}

/** يكتب أعداد المرحلة في آخر الخلاصة بعد إغلاق النسخة: عدد الأسطر الكلّي وتجزئة الملفّ. */
function finishBackupSummary(summary, backup) {
  summary.backup.linesWritten = backup.linesWritten;
  backup.close();
  try {
    const idx = inspectBackupFile(backup.path);
    Object.assign(summary.backup, {bytes: idx.bytes, totalLines: idx.totalLines, sha256: idx.sha256, reportRecords: idx.reportRecords, evaluationRecords: idx.evaluationRecords});
  } catch (e) {
    summary.backup.inspectError = sanitizeError(e).message;
  }
}

/** --apply --phase copy: ينسخ إلى reportRaw ولا يحذف شيئاً. النسخة الاحتياطية تُكتب وتُفرَّغ قبل أيّ نسخ. الشروط المسبقة كلّها قبل أوّل كتابة. */
async function runApplyCopy({db, target, now, backupPath, plan, log = () => {}, pageSize, concurrency, pauseMs = PAUSE_BETWEEN_PAGES_MS}) {
  // ١. النسخة الاحتياطية تُفتح (وتُرفض داخل أيّ مستودع) قبل أيّ شيء.
  const backup = openBackup({backupPath, now});
  const summary = {...baseSummary({mode: 'apply-copy', target, now}), backup: {path: backup.path, resumed: backup.resumed}};
  try {
    // ٢. أعداد «قبل» (قراءة بحتة) ومقارنة الخطّة.
    const before = await collectCounts({db: wrapReadOnly(db), pageSize, concurrency, onPage: (p) => log(`[pre-scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
    summary.before = before;
    const drift = checkPlanDrift(plan, before);
    summary.planCheck = {ok: drift.ok, reasons: drift.reasons, tolerance: PLAN_TOLERANCE};
    if (!drift.ok) {
      summary.stoppedBecause = 'PLAN_DRIFT_OR_CONFLICT';
      return {summary, exitCode: EXIT.STOPPED};
    }

    // ٣. التقارير: المعروض أوّلاً ثم البقيّة. ثم evaluations (بعد التقارير كي يكون الخامّ الفعّال قد نُسخ).
    const counters = newCopyCounters();
    let stop = null;
    for await (const page of iterateReportPages({db, pageSize})) {
      const r = await copyReportPage({db, docs: page.docs, backup, counters, log, concurrency});
      log(`[copy] reports ${page.phase} +${page.docs.length} copied=${counters.reportsCopied} alreadyCopied=${counters.reportsAlreadyCopied} failed=${counters.reportsFailed}`);
      if (r.stop) { stop = r.stop; break; }
      if (pauseMs) await sleep(pauseMs);
    }
    if (!stop) {
      for await (const page of iterateEvaluationPages({db, pageSize})) {
        const r = await copyEvaluationPage({db, docs: page.docs, backup, counters, log, concurrency});
        log(`[copy] evaluations +${page.docs.length} copied=${counters.evaluationsCopied} covered=${counters.evaluationsAlreadyCovered}`);
        if (r.stop) { stop = r.stop; break; }
        if (pauseMs) await sleep(pauseMs);
      }
    }
    summary.copied = counters;
    if (stop) summary.stoppedBecause = stop;

    // ٤. أعداد «بعد».
    summary.after = await collectCounts({db: wrapReadOnly(db), pageSize, concurrency, onPage: (p) => log(`[post-scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
    const incomplete = stop || counters.reportsFailed > 0 || counters.evaluationsFailed > 0 || counters.reportsSkippedTooLarge > 0 || counters.reportsSkippedUnencodable > 0;
    return {summary, exitCode: incomplete ? EXIT.STOPPED : EXIT.OK};
  } finally {
    finishBackupSummary(summary, backup);
  }
}

/**
 * --apply --phase delete: يحذف الحقول المنقولة من reports والمعرّفات من evaluations، بعد التحقّق. شروطه (بلا شبكة): ملفّ النسخة موجود وغير فارغ وهو نفسه الذي
 * جرى عليه --verify-copy (الخطّة). ثم مسح قراءةً: لا يبدأ حذف ما لم يكن كل شيء مطابقاً وله سطر. ثم حذف بمعاملة لكل مستند تعيد التحقّق.
 */
async function runApplyDelete({db, target, now, backupPath, plan, log = () => {}, pageSize, concurrency, pauseMs = PAUSE_BETWEEN_PAGES_MS}) {
  const backupIndex = assertBackupReadyForDelete(backupPath, plan);
  const summary = {
    ...baseSummary({mode: 'apply-delete', target, now}),
    backup: {path: backupIndex.path, bytes: backupIndex.bytes, totalLines: backupIndex.totalLines, sha256Before: backupIndex.sha256,
      reportRecords: backupIndex.reportRecords, evaluationRecords: backupIndex.evaluationRecords},
  };
  const status = await collectCopyStatus({db: wrapReadOnly(db), backupIndex, pageSize, concurrency, onPage: (p) => log(`[pre-delete-scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
  summary.before = status;
  const blockers = copyStatusBlockers(status, {backupProvided: true});
  const readyEvaluations = status.evaluations.ready.DUPLICATE + status.evaluations.ready.NULL_ONLY;
  const drift = [];
  if (status.reports.byteCompare.MATCH !== plan.expected.reportRecords) drift.push(`reports MATCH plan=${plan.expected.reportRecords} now=${status.reports.byteCompare.MATCH}`);
  if (readyEvaluations !== plan.expected.evaluationRecords) drift.push(`evaluations ready plan=${plan.expected.evaluationRecords} now=${readyEvaluations}`);
  if (blockers.length > 0 || drift.length > 0) {
    summary.stoppedBecause = blockers.length > 0 ? 'NOT_READY_NOTHING_DELETED' : 'PLAN_COUNTS_DRIFT_NOTHING_DELETED';
    summary.blockers = blockers;
    summary.drift = drift;
    return {summary, exitCode: EXIT.STOPPED};
  }

  const counters = newDeleteCounters();
  let stop = null;
  for await (const page of iterateReportPages({db, pageSize})) {
    const r = await deleteReportPage({db, docs: page.docs, backupIndex, counters, concurrency});
    log(`[delete] reports ${page.phase} +${page.docs.length} deleted=${counters.reportsDeleted} blocked=${counters.reportsBlockedAbsent + counters.reportsBlockedDiffer + counters.reportsBlockedNoBackupLine + counters.reportsBlockedBackupMismatch + counters.reportsBlockedUnencodable} failed=${counters.failed}`);
    if (r.stop) { stop = r.stop; break; }
    if (pauseMs) await sleep(pauseMs);
  }
  if (!stop) {
    for await (const page of iterateEvaluationPages({db, pageSize})) {
      const r = await deleteEvaluationPage({db, docs: page.docs, backupIndex, counters, concurrency});
      log(`[delete] evaluations +${page.docs.length} deleted=${counters.evaluationsDeleted} failed=${counters.failed}`);
      if (r.stop) { stop = r.stop; break; }
      if (pauseMs) await sleep(pauseMs);
    }
  }
  summary.deleted = counters;
  if (stop) summary.stoppedBecause = stop;
  summary.after = await collectCounts({db: wrapReadOnly(db), pageSize, concurrency, onPage: (p) => log(`[post-scan] ${p.collection} ${p.phase || ''} +${p.count}`)});
  // ملفّ النسخة لا يُمسّ في هذه المرحلة: تجزئته بعد = قبل.
  const idxAfter = inspectBackupFile(backupPath);
  summary.backup.sha256After = idxAfter.sha256;
  summary.backup.unchanged = idxAfter.sha256 === backupIndex.sha256;
  const incomplete = stop || counters.failed > 0 || summary.after.reports.withMovedFields > 0 || !summary.backup.unchanged;
  return {summary, exitCode: incomplete ? EXIT.STOPPED : EXIT.OK};
}

// ───────────────────────── --restore ─────────────────────────

function readBackupLines(backupPath) {
  const text = fs.readFileSync(backupPath, 'utf8');
  const out = [];
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].trim() === '') continue;
    try {
      out.push(JSON.parse(rows[i]));
    } catch (e) {
      // القاعدة 36: رسالة JSON.parse تقتبس مقطعاً من السطر (وفيه قيم خامّ) — لا تُنقل؛ رقم السطر وحده.
      throw new Error(`BACKUP_LINE_INVALID: line=${i + 1}`);
    }
  }
  return out;
}

/**
 * --restore <نسخة>: يكتب الحقول من النسخة إلى reports/evaluations (بشرط lastUpdateTime) ثم يحذف مستند الخامّ الذي أنشأه
 * الترحيل وحده (source=migration) إن كانت قيمه كلّها من النسخة. بلا --apply: معاينة بلا كتابة.
 */
async function runRestore({db, target, now, backupPath, apply = false, log = () => {}}) {
  if (typeof backupPath !== 'string' || backupPath.trim() === '') throw new Error('BACKUP_PATH_MISSING: --restore يحتاج --backup <ملفّ>');
  const abs = path.resolve(backupPath);
  const lines = readBackupLines(abs);
  const header = lines.find((l) => l.kind === 'header');
  if (!header || header.v !== BACKUP_FORMAT || header.projectId !== PROJECT_ID) throw new Error('BACKUP_HEADER_INVALID');

  // آخر سطر لكل معرّف يسبق آخر حذف ناجح له.
  const lastReport = new Map();
  const lastEval = new Map();
  for (const l of lines) {
    if (l.kind === 'report') lastReport.set(l.scanId, l);
    else if (l.kind === 'evaluation') lastEval.set(l.evalId, l);
  }
  const {FieldValue, Timestamp, GeoPoint} = firestoreApi();
  const ctx = {Timestamp, GeoPoint, doc: (p) => db.doc(p)};
  const w = apply ? db : wrapReadOnly(db);
  const out = {
    ...baseSummary({mode: apply ? 'restore-apply' : 'restore-preview', target, now}),
    backupRecords: {reports: lastReport.size, evaluations: lastEval.size},
    reports: {restored: 0, alreadyRestored: 0, reportMissing: 0, fieldConflicts: 0, rawKeptHasExtraFields: 0, rawNotMigrationSource: 0, rawDeleted: 0, failed: 0},
    evaluations: {restored: 0, alreadyRestored: 0, evaluationMissing: 0, fieldConflicts: 0, failed: 0},
  };

  for (const [scanId, rec] of lastReport) {
    try {
      const reportRef = w.collection(REPORTS_COLLECTION).doc(scanId);
      const rawRef = w.collection(REPORT_RAW_COLLECTION).doc(scanId);
      const [reportSnap, rawSnap] = await Promise.all([reportRef.get(), rawRef.get()]);
      if (!reportSnap.exists) { out.reports.reportMissing++; continue; }
      const reportData = reportSnap.data() || {};
      const fields = {};
      for (const f of Object.keys(rec.fields)) fields[f] = decodeValue(rec.fields[f], ctx);
      const conflicts = Object.keys(fields).filter((f) => has(reportData, f) && !valuesEqual(reportData[f], fields[f]));
      if (conflicts.length > 0) { out.reports.fieldConflicts++; continue; }
      const toRestore = Object.keys(fields).filter((f) => !has(reportData, f));
      let deleteRaw = false;
      if (rawSnap.exists) {
        const rawData = rawSnap.data() || {};
        if (rawData.source !== REPORT_RAW_SOURCE.MIGRATION) { out.reports.rawNotMigrationSource++; }
        else if (REPORT_RAW_FIELDS.some((f) => has(rawData, f) && !has(fields, f))) { out.reports.rawKeptHasExtraFields++; }
        else deleteRaw = true;
      }
      if (toRestore.length === 0 && !deleteRaw) { out.reports.alreadyRestored++; continue; }
      if (apply) {
        const batch = db.batch();
        if (toRestore.length > 0) {
          const upd = {};
          for (const f of toRestore) upd[f] = fields[f];
          batch.update(db.collection(REPORTS_COLLECTION).doc(scanId), upd, {lastUpdateTime: reportSnap.updateTime});
        }
        if (deleteRaw) batch.delete(db.collection(REPORT_RAW_COLLECTION).doc(scanId), {lastUpdateTime: rawSnap.updateTime});
        await batch.commit();
      }
      out.reports.restored++;
      if (deleteRaw) out.reports.rawDeleted++;
    } catch (e) {
      out.reports.failed++;
      log(`[restore] report ${hashId(scanId)} failed: ${JSON.stringify(sanitizeError(e))}`);
    }
  }

  for (const [evalId, rec] of lastEval) {
    try {
      const evalSnap = await w.collection(EVALUATIONS_COLLECTION).doc(evalId).get();
      if (!evalSnap.exists) { out.evaluations.evaluationMissing++; continue; }
      const evalData = evalSnap.data() || {};
      const fields = {};
      for (const f of Object.keys(rec.fields)) fields[f] = decodeValue(rec.fields[f], ctx);
      const conflicts = Object.keys(fields).filter((f) => has(evalData, f) && !valuesEqual(evalData[f], fields[f]));
      if (conflicts.length > 0) { out.evaluations.fieldConflicts++; continue; }
      const toRestore = Object.keys(fields).filter((f) => !has(evalData, f));
      if (toRestore.length === 0) { out.evaluations.alreadyRestored++; continue; }
      if (apply) {
        const upd = {};
        for (const f of toRestore) upd[f] = fields[f];
        await db.collection(EVALUATIONS_COLLECTION).doc(evalId).update(upd, {lastUpdateTime: evalSnap.updateTime});
      }
      out.evaluations.restored++;
    } catch (e) {
      out.evaluations.failed++;
      log(`[restore] evaluation ${hashId(evalId)} failed: ${JSON.stringify(sanitizeError(e))}`);
    }
  }
  void FieldValue;
  const failed = out.reports.failed + out.evaluations.failed;
  return {summary: out, exitCode: failed > 0 ? EXIT.STOPPED : EXIT.OK};
}

// ───────────────────────── سطر الأوامر ─────────────────────────

const MODES = Object.freeze({DRY_RUN: 'dry-run', APPLY: 'apply', VERIFY: 'verify', VERIFY_COPY: 'verify-copy', RESTORE: 'restore'});
const APPLY_PHASES = Object.freeze({COPY: 'copy', DELETE: 'delete'});

/**
 * يحلّل وسائط سطر الأوامر. وسيط مجهول = خطأ صريح (القاعدة 22). لا يمسّ الشبكة.
 * --apply يشترط --phase copy|delete (قرار المستخدم: مرحلتان منفصلتان) — فلا مسار واحد ينسخ ويحذف معاً.
 * @return {{mode: string, backup: ?string, plan: ?string, phase: ?string, restoreApply: boolean}}
 */
function parseArgs(argv) {
  const out = {mode: null, backup: null, plan: null, phase: null, restoreApply: false};
  const modeFlags = {'--dry-run': MODES.DRY_RUN, '--apply': MODES.APPLY, '--verify': MODES.VERIFY, '--verify-copy': MODES.VERIFY_COPY, '--restore': MODES.RESTORE};
  const chosen = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (has(modeFlags, a)) { chosen.push(a); continue; }
    if (a === '--backup' || a === '--plan' || a === '--phase') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`USAGE: ${a} يحتاج قيمة`);
      out[a.slice(2)] = v;
      i++;
      continue;
    }
    throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a : '(موضعي)'}`);
  }
  const uniq = [...new Set(chosen)];
  const hasApply = uniq.includes('--apply');
  const hasRestore = uniq.includes('--restore');
  if (hasRestore) {
    // --restore [--apply]: المعاينة افتراضية، والكتابة بـ--apply وحده.
    const others = uniq.filter((f) => f !== '--restore' && f !== '--apply');
    if (others.length > 0) throw new Error('USAGE: --restore لا يجتمع مع --dry-run/--verify/--verify-copy');
    out.mode = MODES.RESTORE;
    out.restoreApply = hasApply;
    if (!out.backup) throw new Error('USAGE: --restore يحتاج --backup <ملفّ>');
    if (out.plan) throw new Error('USAGE: --plan لا يخصّ --restore');
    if (out.phase) throw new Error('USAGE: --phase لا يخصّ --restore');
    return out;
  }
  if (uniq.length > 1) throw new Error('USAGE: وضع واحد فقط (--dry-run | --apply --phase copy|delete | --verify-copy | --verify | --restore)');
  out.mode = uniq.length === 0 ? MODES.DRY_RUN : modeFlags[uniq[0]];
  if (out.mode === MODES.APPLY) {
    if (!out.phase) throw new Error('USAGE: --apply يحتاج --phase copy|delete (مرحلتان منفصلتان: --apply --phase copy، ثم --verify-copy، ثم --apply --phase delete)');
    if (!Object.values(APPLY_PHASES).includes(out.phase)) throw new Error('USAGE: --phase يقبل copy أو delete فقط');
    if (!out.backup) throw new Error('USAGE: --apply يحتاج --backup <ملفّ.jsonl> (خارج أيّ مستودع)');
    if (!out.plan) throw new Error(`USAGE: --apply --phase ${out.phase} يحتاج --plan <مخرَج ${out.phase === APPLY_PHASES.COPY ? '--dry-run' : '--verify-copy'}.json>`);
  } else if (out.mode === MODES.VERIFY_COPY) {
    if (out.plan) throw new Error('USAGE: --plan لا يخصّ --verify-copy');
    if (out.phase) throw new Error('USAGE: --phase لا يخصّ --verify-copy');
  } else if (out.backup || out.plan || out.phase) {
    throw new Error(`USAGE: --backup/--plan/--phase لا يخصّ ${out.mode}`);
  }
  return out;
}

module.exports = {
  // ثوابت
  REPORTS_COLLECTION, EVALUATIONS_COLLECTION, EXPOSED_LISTING_STATUSES, EVALUATION_IDENTIFIER_FIELDS,
  MIGRATION_STATE, EVAL_STATE, COPY_STATE, PAGE_SIZE, CONCURRENCY, PLAN_SCHEMA, PLAN_TOLERANCE, BACKUP_FORMAT, EXIT, MODES, APPLY_PHASES,
  MAX_COMMIT_ATTEMPTS, MAX_FAILURES_BEFORE_STOP,
  // نقيّة
  encodeValue, decodeValue, stableStringify, valuesEqual, fieldDigest, pickMoved, classifyReport, classifyEvaluation, compareReportToRaw,
  buildMigrationRawDocument, hasLegacyRawLayerIdentifier, checkPlanDrift, withinTolerance, parseArgs, sanitizeError,
  assertBackupPathOutsideRepos, reportBackupLine, evaluationBackupLine, loadPlan, readBackupLines, nowPlus03,
  assertCopyPayload, assertDeletePayload, isFieldDelete, copyStatusBlockers,
  // مع I/O
  openBackup, inspectBackupFile, assertBackupReadyForDelete, scanBackupFile,
  collectCounts, collectCopyStatus, runDryRun, runVerify, runVerifyCopy, runApplyCopy, runApplyDelete, runRestore,
  inspectReport, inspectEvaluation,
  copyReportPage, copyEvaluationPage, deleteReportPage, deleteEvaluationPage, newCopyCounters, newDeleteCounters,
};
