'use strict';

// ===================================================================
// goldenStage2Keypaths — مسارات المفاتيح وحدها (بلا قيمة) لتقرير حقيقي من فحص fv69 على الـS10، ومقارنتها بملفّات المفاتيح الذهبية (الكتلة ج٥)، 2026-10-10 +03. قراءة بحتة.
// يستعمله golden-stage2-keypaths-readonly.js.
//
// قرار المستخدم 2026-10-10، بنصّه (منقول من أمر المنسّق): «مسارات المفاتيح وحدها بلا قيم، من مستند التقرير ومن نسخة Storage، وتُقارن بملفّات المفاتيح. والملفّ لا يُحفظ على القرص: يُقرأ في
// الذاكرة، وتُستخرج المسارات، ويُترك.»
//
// ─── ما يقرؤه ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   ١) مستند `reports/{scanId}` (المقروء) — بالمعرّف shortId.
//   ٢) `reportRaw/{scanId}` (أو الخامّ المضمَّن في تقرير ما قبل الترحيل) بـreadReportWithRaw (scripts/lib/reportRawReaders.js، بحالاته الصريحة PRIVATE وEMBEDDED_LEGACY وABSENT).
//   ٣) نسخة Storage (`timeSeriesStoragePath` في reportRaw) — تُنزَّل **إلى الذاكرة** وتُفكّ فيها (fetchSamplesFromStorage من scripts/export-v7-replay-inputs-readonly.js: download({decompress:false}) ثم gunzip) ويُترك.
//   ⟵ مسارات المفاتيح وحدها (scripts/lib/keyPaths.js، الصيغة التي طابقت `.keys.txt`): لا قيمة ولا طول ولا نوع في المخرَج.
//
// ─── أيّ ملفّات مفاتيح؟ (قرار الوكيل من الملفّات، لا من الاسم وحده) ──────────────────────────────────────────────────────────────────────────────────────────────
// الأمر: «ويقارن بملفّات المفاتيح في functions/test/fixtures/golden/ التي تصف كلّاً منهما. أيّها؟ قرّرها من الملفّات، واذكرها بأسمائها.» فالقرار يجري عند كل تشغيل بقراءة المجلّد:
//   • مرشَّح = كل `*.keys.txt` له شقيق `.json` (الاسم نفسه) جذره **البصمة** (`timeSeries.footer.fieldsVersion` رقم في الشقيق) **ونصّه يطابق ما يبنيه keyPaths من شقيقه** (فالملفّ يصف شقيقه حقاً).
//     ملفّات المفاتيح ذات جذر الطلب (`fingerprint.` في أوّل كل مسار — fv67-app-request-payload-…keys.txt، خريطة الطلب كلّها) تُسرد في skipped بسببها: لا تصف البصمة وحدها.
//   • المختار = المرشَّحات التي **fieldsVersion شقيقها = fieldsVersion التقرير** (من تذييل الخامّ). فإن لم يوجد: حالة صريحة NO_KEYS_FILE_FOR_FIELDS_VERSION بالإصدارات المتاحة (لا مقارنة بما لا يطابق).
//   • ملفّات المفاتيح تصف **حمولة التطبيق** (جذرها البصمة، ومنها `timeSeries.samples`): فمقابلُها في الخادم هو `reportRaw/{scanId}.rawFingerprint` (البصمة بعد lightenFingerprintForStorage، بلا العيّنات)
//     ونسخة Storage (جذرها `timeSeries` نفسه: footer وheader وsamples وvariables). **ولا ملفّ `.keys.txt` يصف مستند `reports/{scanId}`** (V8 نقل الخامّ: rawFingerprint ليس فيه)؛ فمرجعه
//     مسارات تُحسَب في الذاكرة من `v7-reports-document-sample.json` (العيّنة الذهبية لمستند التقرير) — وسمٌ صريح `derived-in-memory`، لا ملفّ مفاتيح.
//   • الاختيار «الأقرب» (أقلّ مجموع زائد+ناقص) إعلام لا حكم: كل المختار يُقارَن ويُسرد.
//
// ─── مسارات الخامّ بعد التخفيف ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// reportRaw.rawFingerprint = lightenFingerprintForStorage(الحمولة): تُحذف timeSeries.samples (وما تحتها) وتُضاف timeSeries.samplesCount. فالمقارنة بملفّ المفاتيح بعد تطبيق هذه القاعدة (keyPaths.lightenedExpectedPaths،
// مُثبَتة بالدالّة الحقيقية في goldenStage2Keypaths.test.js) — والمحذوف والمضاف يُسردان في byDesign فلا يُخفى فرق.
//
// القاعدة 22: كل ما لا يُقرأ حالة مسمّاة في المخرَج (لا تقرير، لا خامّ، لا مسار Storage، الملفّ غائب/تالف، لا ملفّ مفاتيح بإصدار التقرير) — ولا قيمة افتراضية ولا مقارنة صامتة.
// القاعدة 36: خطأ Storage يُسجَّل برمزه وصنفه وحدهما (رسالة GCS قد تحمل مسار الكائن: معرّف الجهاز وscanId).
// ===================================================================

const fs = require('fs');
const path = require('path');
const K = require('./keyPaths');
const C = require('./deviceCheck03Common');
const {readReportWithRaw} = require('./reportRawReaders');
const {RAW_STATE, REPORT_RAW_FIELDS} = require('../../src/analysis/reportRawStore');
const {fetchSamplesFromStorage} = require('../export-v7-replay-inputs-readonly');

const MODE = 'golden-stage2-keypaths';
const REPORTS_COLLECTION = 'reports';
const DEFAULT_GOLDEN_DIR = path.join(__dirname, '..', '..', 'test', 'fixtures', 'golden');
/** العيّنة الذهبية لمستند التقرير: مرجع مستند reports/{scanId} (لا ملفّ `.keys.txt` له). */
const REPORTS_DOC_REFERENCE_FILE = 'v7-reports-document-sample.json';
const KEYS_FILE_SUFFIX = '.keys.txt';
const STORAGE_ROOT = 'timeSeries';

const SOURCE_STATE = Object.freeze({
  COMPARED: 'COMPARED',
  REPORT_ABSENT: 'REPORT_ABSENT',
  SHORT_ID_AMBIGUOUS: 'SHORT_ID_AMBIGUOUS',
  RAW_ABSENT: 'RAW_ABSENT',
  RAW_FINGERPRINT_ABSENT: 'RAW_FINGERPRINT_ABSENT',
  STORAGE_PATH_ABSENT: 'STORAGE_PATH_ABSENT',
  STORAGE_NOT_READ: 'STORAGE_NOT_READ',
  STORAGE_NOT_A_TIMESERIES_OBJECT: 'STORAGE_NOT_A_TIMESERIES_OBJECT',
  NO_KEYS_FILE_FOR_FIELDS_VERSION: 'NO_KEYS_FILE_FOR_FIELDS_VERSION',
  REFERENCE_FILE_ABSENT: 'REFERENCE_FILE_ABSENT',
});

const isObj = (v) => K.isPlainObject(v);

// ───────────────────────── الوسائط ─────────────────────────

/** الوسائط: --short-id NC-XXXXXX --out <file.json> | --preflight. */
function parseArgs(argv) {
  const usage = 'USAGE: --short-id NC-XXXXXX --out <keypaths.json> | --preflight';
  const p = C.parseFlags(argv, {values: ['--short-id', '--out'], flags: ['--preflight']});
  if (p.flags['--preflight']) {
    if (p.values['--short-id'] !== undefined || p.values['--out'] !== undefined) throw new Error('USAGE: --preflight وحدها');
    return {mode: 'preflight', shortId: null, out: null};
  }
  const shortId = p.values['--short-id'];
  const out = p.values['--out'];
  if (shortId === undefined || out === undefined) throw new Error(usage);
  if (!C.SHORT_ID_PATTERN.test(shortId)) throw new Error('USAGE: --short-id بصيغة NC-XXXXXX (ستّة أحرف كبيرة أو أرقام)');
  return {mode: 'run', shortId, out};
}

// ───────────────────────── ملفّات المفاتيح ─────────────────────────

/** الإصدار الذي يحمله شقيق `.json` (بجذر البصمة)، أو سبب الاستبعاد. */
function fieldsVersionOfSibling(json) {
  const fv = json && json.timeSeries && json.timeSeries.footer && json.timeSeries.footer.fieldsVersion;
  if (C.isFiniteNumber(fv)) return {root: 'fingerprint', fieldsVersion: fv};
  const req = json && json.fingerprint && json.fingerprint.timeSeries && json.fingerprint.timeSeries.footer && json.fingerprint.timeSeries.footer.fieldsVersion;
  if (C.isFiniteNumber(req)) return {root: 'request', fieldsVersion: req};
  return {root: null, fieldsVersion: null};
}

/**
 * يقرأ مجلّد الملفّات الذهبية (قراءة بحتة) ويُخرج المرشَّحات والمستبعَد منها بأسبابها.
 * @param {string} goldenDir
 * @return {{state: string, candidates: Array<{name: string, jsonName: string, fieldsVersion: number, lines: string[]}>, skipped: Array<{name: string, reason: string}>}}
 */
function loadKeyFiles(goldenDir) {
  let names;
  try {
    names = fs.readdirSync(goldenDir).filter((f) => f.endsWith(KEYS_FILE_SUFFIX)).sort();
  } catch (e) {
    return {state: 'GOLDEN_DIR_UNREADABLE', candidates: [], skipped: []};
  }
  const candidates = [];
  const skipped = [];
  for (const name of names) {
    const jsonName = `${name.slice(0, -KEYS_FILE_SUFFIX.length)}.json`;
    let lines;
    let json;
    try {
      lines = K.parseKeysText(fs.readFileSync(path.join(goldenDir, name), 'utf8'));
    } catch (e) {
      skipped.push({name, reason: 'KEYS_FILE_UNREADABLE'});
      continue;
    }
    try {
      json = JSON.parse(fs.readFileSync(path.join(goldenDir, jsonName), 'utf8'));
    } catch (e) {
      skipped.push({name, reason: 'SIBLING_JSON_ABSENT_OR_UNREADABLE'});
      continue;
    }
    const {root, fieldsVersion} = fieldsVersionOfSibling(json);
    if (root === 'request') {
      skipped.push({name, reason: 'REQUEST_ROOT: paths start with fingerprint. (the whole request map), not the fingerprint alone'});
      continue;
    }
    if (root === null) {
      skipped.push({name, reason: 'FIELDS_VERSION_ABSENT_IN_SIBLING_JSON'});
      continue;
    }
    if (K.keysText(lines) !== K.keysText(K.collectKeyPaths(json))) {
      skipped.push({name, reason: 'KEYS_FILE_DISAGREES_WITH_ITS_SIBLING_JSON'});
      continue;
    }
    candidates.push({name, jsonName, fieldsVersion, lines});
  }
  return {state: 'READ', candidates, skipped};
}

/** مسارات مرجع مستند التقرير (في الذاكرة من العيّنة الذهبية)، أو حالة غيابها. */
function loadReportsDocReference(goldenDir) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(goldenDir, REPORTS_DOC_REFERENCE_FILE), 'utf8'));
    return {state: 'READ', paths: K.collectKeyPaths(json)};
  } catch (e) {
    return {state: SOURCE_STATE.REFERENCE_FILE_ABSENT, paths: []};
  }
}

// ───────────────────────── المقارنة ─────────────────────────

const countsOf = (diff) => ({extraCount: diff.extra.length, missingCount: diff.missing.length});
const closestOf = (comparisons) => {
  if (comparisons.length === 0) return null;
  const score = (c) => c.extraCount + c.missingCount;
  return [...comparisons].sort((a, b) => score(a) - score(b) || a.keysFile.localeCompare(b.keysFile))[0].keysFile;
};

/**
 * مقارنة مسارات فعلية بكل ملفّ مختار.
 * @param {string[]} actual
 * @param {Array<{name: string, lines: string[]}>} chosen
 * @param {function(string[]): {paths: string[], removed?: string[], added?: string[]}} expectedOf يحوّل أسطر الملفّ إلى المتوقَّع في هذا المصدر
 */
function compareAgainst(actual, chosen, expectedOf) {
  const comparisons = chosen.map((c) => {
    const expected = expectedOf(c.lines);
    const diff = K.diffKeyPaths(actual, expected.paths);
    return {
      keysFile: c.name, expectedCount: expected.paths.length, ...countsOf(diff), extra: diff.extra, missing: diff.missing,
      ...(expected.removed ? {byDesign: {removedFromKeysFile: expected.removed.length, addedToExpected: expected.added}} : {}),
    };
  });
  return {actualCount: actual.length, comparisons, closestKeysFile: closestOf(comparisons)};
}

/**
 * يبني مخرَج المقارنة من حقائق مقروءة. دالّة نقيّة (بلا I/O): تُختبر على حقائق اصطناعية وعلى الملفّات الذهبية.
 * @param {Object} facts
 * @param {Object} facts.report {state, reportData, rawRead} — reportData مستند التقرير؛ rawRead ناتج readReportRaw
 * @param {Object} facts.storage {state, json, path?} — json المفكوك في الذاكرة
 * @param {{state: string, candidates: Array, skipped: Array}} facts.keyFiles
 * @param {{state: string, paths: string[]}} facts.reportsDocReference
 * @return {Object}
 */
function buildComparison(facts) {
  const {report, storage, keyFiles, reportsDocReference} = facts;
  const out = {sources: {}};
  const rawFingerprint = report.rawRead && report.rawRead.raw && isObj(report.rawRead.raw.rawFingerprint) ? report.rawRead.raw.rawFingerprint : null;
  const fv = rawFingerprint && rawFingerprint.timeSeries && rawFingerprint.timeSeries.footer && C.isFiniteNumber(rawFingerprint.timeSeries.footer.fieldsVersion) ?
    rawFingerprint.timeSeries.footer.fieldsVersion : null;
  const chosen = fv === null ? [] : keyFiles.candidates.filter((c) => c.fieldsVersion === fv);
  out.keyFiles = {
    goldenDirState: keyFiles.state,
    reportFieldsVersion: fv,
    available: keyFiles.candidates.map((c) => ({name: c.name, fieldsVersion: c.fieldsVersion, lines: c.lines.length})),
    skipped: keyFiles.skipped,
    chosen: chosen.map((c) => ({name: c.name, fieldsVersion: c.fieldsVersion, lines: c.lines.length})),
    decision: fv === null ?
      'report fieldsVersion unreadable (no rawFingerprint footer): no keys file can be chosen' :
      (chosen.length > 0 ? 'chosen = fingerprint-root keys files whose sibling .json carries the same fieldsVersion as the report; each compared, closest named (informational)' :
        'no fingerprint-root keys file carries the report fieldsVersion'),
  };

  // ١) مستند التقرير المقروء — لا ملفّ `.keys.txt` له؛ مرجعه مسارات العيّنة الذهبية لمستند التقرير في الذاكرة.
  {
    const data = report.reportData;
    const embedded = REPORT_RAW_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(data, f));
    const paths = K.collectKeyPaths(Object.fromEntries(Object.entries(data).filter(([k]) => !REPORT_RAW_FIELDS.includes(k))));
    if (reportsDocReference.state !== 'READ') {
      out.sources.reportsDoc = {state: SOURCE_STATE.REFERENCE_FILE_ABSENT, actualCount: paths.length, referenceFile: REPORTS_DOC_REFERENCE_FILE};
    } else {
      const diff = K.diffKeyPaths(paths, reportsDocReference.paths);
      out.sources.reportsDoc = {
        state: SOURCE_STATE.COMPARED, actualCount: paths.length,
        reference: {file: REPORTS_DOC_REFERENCE_FILE, kind: 'derived-in-memory (no .keys.txt file describes reports/{scanId})', expectedCount: reportsDocReference.paths.length},
        ...countsOf(diff), extra: diff.extra, missing: diff.missing,
        rawFieldsEmbeddedInReportsDoc: embedded, // غير فارغة = تقرير ما قبل الترحيل (EMBEDDED_LEGACY): استُبعدت من مسارات هذا المصدر لأنها مصدر reportRaw أدناه
      };
    }
  }

  // ٢) reportRaw.rawFingerprint
  {
    const state = report.rawRead ? report.rawRead.state : null;
    if (state === RAW_STATE.ABSENT || state === null) {
      out.sources.reportRawFingerprint = {state: SOURCE_STATE.RAW_ABSENT, rawState: state};
    } else if (rawFingerprint === null) {
      out.sources.reportRawFingerprint = {state: SOURCE_STATE.RAW_FINGERPRINT_ABSENT, rawState: state, fieldsPresent: Object.keys(report.rawRead.raw || {}).sort()};
    } else if (chosen.length === 0) {
      out.sources.reportRawFingerprint = {state: SOURCE_STATE.NO_KEYS_FILE_FOR_FIELDS_VERSION, rawState: state, actualCount: K.collectKeyPaths(rawFingerprint).length};
    } else {
      const actual = K.collectKeyPaths(rawFingerprint);
      out.sources.reportRawFingerprint = {
        state: SOURCE_STATE.COMPARED, rawState: state, fieldsPresent: Object.keys(report.rawRead.raw || {}).sort(),
        ...compareAgainst(actual, chosen, (lines) => K.lightenedExpectedPaths(lines)),
      };
    }
  }

  // ٣) نسخة Storage — جذرها timeSeries نفسه
  {
    if (storage.state !== 'DOWNLOADED') {
      out.sources.storageCopy = {state: storage.state, ...(storage.errorCode !== undefined ? {errorCode: storage.errorCode, errorClass: storage.errorClass} : {})};
    } else if (!isObj(storage.json)) {
      out.sources.storageCopy = {state: SOURCE_STATE.STORAGE_NOT_A_TIMESERIES_OBJECT, topLevelIsArray: Array.isArray(storage.json)};
    } else if (chosen.length === 0) {
      out.sources.storageCopy = {state: SOURCE_STATE.NO_KEYS_FILE_FOR_FIELDS_VERSION, actualCount: K.collectKeyPaths(storage.json, {prefix: STORAGE_ROOT}).length};
    } else {
      const actual = K.collectKeyPaths(storage.json, {prefix: STORAGE_ROOT});
      out.sources.storageCopy = {
        state: SOURCE_STATE.COMPARED,
        ...compareAgainst(actual, chosen, (lines) => ({paths: K.pathsUnder(lines, STORAGE_ROOT)})),
        rootNote: 'Storage file root is the timeSeries object: its paths are prefixed with timeSeries. and compared with the timeSeries subtree of each keys file',
      };
    }
  }
  out.summary = {
    allCompared: Object.values(out.sources).every((s) => s.state === SOURCE_STATE.COMPARED),
    statesBySource: Object.fromEntries(Object.entries(out.sources).map(([k, v]) => [k, v.state])),
  };
  return out;
}

// ───────────────────────── الجمع ─────────────────────────

/**
 * يجمع الحقائق بقراءة بحتة. لا حكم هنا. الملفّ المنزَّل يبقى في الذاكرة ويُترك (لا حفظ).
 * @param {Object} p
 * @param {Object} p.db مغلَّف بـwrapReadOnly
 * @param {Object} p.bucket مغلَّف بـwrapReadOnlyBucket
 * @param {string} p.shortId
 * @param {string} [p.goldenDir]
 * @return {Promise<{early: ?Object, facts: ?Object, ids: Object}>}
 */
async function gatherFacts({db, bucket, shortId, goldenDir = DEFAULT_GOLDEN_DIR}) {
  const found = await db.collection(REPORTS_COLLECTION).where('shortId', '==', shortId).select('userId').limit(3).get();
  if (found.size !== 1) {
    return {early: {state: found.size === 0 ? SOURCE_STATE.REPORT_ABSENT : SOURCE_STATE.SHORT_ID_AMBIGUOUS, reportsFoundByShortId: found.size}, facts: null, ids: {}};
  }
  const scanId = found.docs[0].id;
  const read = await readReportWithRaw({db, scanId});
  if (!read.exists) return {early: {state: SOURCE_STATE.REPORT_ABSENT, reportsFoundByShortId: 1}, facts: null, ids: {}}; // وُجد بالاستعلام وغاب عند القراءة: لا يُحكم
  const report = {state: 'FOUND', reportData: read.reportData, rawRead: read.rawRead};
  let storage;
  const storagePath = read.rawRead && read.rawRead.raw ? read.rawRead.raw.timeSeriesStoragePath : undefined;
  if (typeof storagePath !== 'string' || storagePath.trim() === '') {
    storage = {state: SOURCE_STATE.STORAGE_PATH_ABSENT};
  } else {
    const r = await fetchSamplesFromStorage(bucket, storagePath);
    storage = r.state === 'DOWNLOADED' ?
      {state: 'DOWNLOADED', json: r.samples} :
      {state: r.state, ...(r.errorCode !== undefined ? {errorCode: String(r.errorCode), errorClass: String(r.errorClass)} : {})};
  }
  return {
    early: null,
    facts: {report, storage, keyFiles: loadKeyFiles(goldenDir), reportsDocReference: loadReportsDocReference(goldenDir)},
    ids: {scanIdHash: C.hashIdForLog(scanId)},
  };
}

// ───────────────────────── الفحص الذاتي ─────────────────────────

function preflightChecks(env = process.env) {
  void env;
  const bad = (argv, re) => { try { parseArgs(argv); return false; } catch (e) { return re.test(e.message); } };
  const lighten = K.lightenedExpectedPaths(['device', 'timeSeries', 'timeSeries.footer', 'timeSeries.samples', 'timeSeries.samples[].v']);
  const diff = K.diffKeyPaths(['a', 'b.c', 'x'], ['a', 'b.c', 'y']);
  const checks = [
    ['--short-id --out: وضع التشغيل', (() => { const a = parseArgs(['--short-id', 'NC-ABC123', '--out', 'k.json']); return a.mode === 'run' && a.shortId === 'NC-ABC123' && a.out === 'k.json'; })()],
    ['--preflight وحدها', parseArgs(['--preflight']).mode === 'preflight' && bad(['--preflight', '--out', 'k.json'], /--preflight وحدها/)],
    ['بلا وسائط: USAGE', bad([], /USAGE: --short-id/)],
    ['shortId بصيغة خاطئة يُرفض', bad(['--short-id', 'nc-abc', '--out', 'k.json'], /NC-XXXXXX/)],
    ['البريد لا يُقبل من سطر الأمر (السكربت لا يحتاجه)', bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--email', 'x@y.z'], /وسيط مجهول --email/)],
    ['مسار الملفّ المنزَّل لا يُقبل من سطر الأمر (لا حفظ)', bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--download-to', 'x'], /وسيط مجهول --download-to/)],
    ['collectKeyPaths: كائن/مصفوفة كائنات/ورقة', JSON.stringify(K.collectKeyPaths({a: {b: 1}, l: [{x: 1}, 2], n: [1, 2]})) === JSON.stringify(['a', 'a.b', 'l', 'l[].x', 'n'])],
    ['collectKeyPaths: Timestamp (غير عاديّ) ورقة', (() => { class Ts { constructor() { this._seconds = 1; } } return JSON.stringify(K.collectKeyPaths({t: new Ts()})) === JSON.stringify(['t']); })()],
    ['التخفيف: تُحذف samples وتُضاف samplesCount', JSON.stringify(lighten.paths) === JSON.stringify(['device', 'timeSeries', 'timeSeries.footer', 'timeSeries.samplesCount'])],
    ['الفرق: extra وmissing', JSON.stringify(diff) === JSON.stringify({extra: ['x'], missing: ['y']})],
    ['hashIdForLog: # + 12 خانة', /^#[0-9a-f]{12}$/.test(C.hashIdForLog('x'))],
  ];
  const results = checks.map(([name, okv]) => ({name, ok: okv === true}));
  return {ok: results.every((x) => x.ok), checks: results};
}

module.exports = {
  MODE, REPORTS_COLLECTION, DEFAULT_GOLDEN_DIR, REPORTS_DOC_REFERENCE_FILE, KEYS_FILE_SUFFIX, STORAGE_ROOT, SOURCE_STATE,
  parseArgs, loadKeyFiles, loadReportsDocReference, buildComparison, gatherFacts, preflightChecks,
};
