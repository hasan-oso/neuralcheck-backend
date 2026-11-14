'use strict';

// goldenStage2Keypaths.test.js — السكربت golden-stage2-keypaths-readonly.js ومكتبتاه scripts/lib/goldenStage2Keypaths.js وscripts/lib/keyPaths.js (فحص الجهاز ٠٣، الكتلة ج٥، 2026-10-10 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسار على المحاكي: deviceCheck03.e2e.test.js؛ وحارس «لا كتابة» وطفراته: deviceCheck03ReadOnlyGuard.test.js.
//
// قرار المستخدم 2026-10-10، بنصّه (منقول من أمر المنسّق): «مسارات المفاتيح وحدها بلا قيم، من مستند التقرير ومن نسخة Storage، وتُقارن بملفّات المفاتيح. والملفّ لا يُحفظ على القرص: يُقرأ في الذاكرة،
// وتُستخرج المسارات، ويُترك.»  وأمر المنسّق: «ويقارن بملفّات المفاتيح في functions/test/fixtures/golden/ التي تصف كلّاً منهما. أيّها؟ قرّرها من الملفّات، واذكرها بأسمائها.»
//   ١ — الوسائط.  ٢ — باني المسارات يطابق `.keys.txt` الذهبية حرفاً بحرف (الأربعة)، وأوراق Firestore أوراق.  ٣ — قاعدة التخفيف = lightenFingerprintForStorage الحقيقية على الملفّات الثلاثة.
//   ٤ — اختيار ملفّات المفاتيح من الملفّات (المرشَّحات والمستبعَد وأسبابه، والمجلّد الفاسد).  ٥ — المقارنة على العيّنات الذهبية الثلاث: صفر فرق على الخامّ بعد التخفيف، وفرق الختم وحده على Storage.
//   ٦ — لا قيمة في المخرَج (علامات قيم في كل حقل).  ٧ — الحالات الصريحة لكل مصدر لا يُقرأ (وكل خطأ Storage برمزه وصنفه وحدهما).  ٨ — main: رمز الخروج والملفّ wx، ولا شيء يُكتب على القرص غيره.
//
// الاستبدال معلَن (القاعدة 37): db مزيَّف في الذاكرة وbucket مزيَّف (يُعيد بايتات gzip كما في fetchSamplesFromStorage الحقيقية) — في اختبار الوحدة وحدها؛ والطبقة الحقيقية في الـe2e.
//
// Run: node functions/test/goldenStage2Keypaths.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const {Timestamp, GeoPoint} = require('@google-cloud/firestore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const K = require('../scripts/lib/keyPaths');
const C = require('../scripts/lib/deviceCheck03Common');
const G = require('../scripts/lib/goldenStage2Keypaths');
const {main} = require('../scripts/golden-stage2-keypaths-readonly');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {RAW_STATE, REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');
const {makeMemDb} = require('./lib/memFirestore');
const H = require('./lib/deviceCheck03Harness');

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEM = 'fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FILES = {
  c11: `${STEM}11ch-nothing-admitted`,
  c13: `${STEM}13ch-selinux-blocked-policy`,
  c16: `${STEM}16ch-four-policies-truncated-failures`,
};
const FV67_STEM = 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8';
// 2026-10-13 +03 (قرّاء D في fv70): ملفّات المفاتيح الثلاثة لحمولات fv70 (نسخ حرفية من NeuralChek@80ca8c3) تُلتقَط تلقائياً من المجلّد بجانب fv69 — الأداة تختار بحسب fieldsVersion التقرير.
const FV70_STEM = 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV70_FILES = {c11: `${FV70_STEM}11ch-nothing-admitted`, c13: `${FV70_STEM}13ch-selinux-blocked-policy`, c16: `${FV70_STEM}16ch-four-policies-truncated-failures`};
// 2026-10-18 +03 (مزامنة fv71): ملفّات المفاتيح الثلاثة لحمولات fv71 (نسخ حرفية من NeuralChek@f9e0571، من المُنتِج) تُلتقَط تلقائياً من المجلّد بجانب fv69 وfv70.
const FV71_STEM = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const FV71_FILES = {c11: `${FV71_STEM}11ch-nothing-admitted`, c13: `${FV71_STEM}13ch-selinux-blocked-policy`, c16: `${FV71_STEM}16ch-four-policies-truncated-failures`};
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const readText = (f) => fs.readFileSync(path.join(GOLDEN, f), 'utf8');
const payloadOf = (k) => readJson(`${FILES[k]}.json`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc03-g3-unit-'));
let counter = 0;
const nextOut = () => path.join(tmp, `kp-${++counter}.json`);

const SHORT = 'NC-KEY001';
const SCAN = 'scan-KEYPATHS-secret-0001';
const SHA = 'devicefingerprintsha-secret-abcdef';
const STORAGE_PATH = `scans/${SHA}/${SCAN}.ts.json.gz`;
const NOW = 1_800_000_000_000;

/** ملفّ Storage كما يرفعه التطبيق: نسخة من timeSeries الحمولة بلا timeSeriesState (يُشتقّ من الحمولة؛ لا ملفّ Storage حقيقي مُلتزَم لـfv69 — استبدال معلَن). */
const storageFileOf = (payload) => { const {timeSeriesState, ...file} = payload.timeSeries; void timeSeriesState; return file; };
const gzOf = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'));
const reportDocSample = () => ({...readJson('v7-reports-document-sample.json'), shortId: SHORT, userId: 'owner-uid-secret', fieldsVersion: 69, appVersion: '1.0.11'});

const worldOf = ({payload, extraReports = {}, raw = 'private', report = reportDocSample()}) => {
  const lightened = JSON.parse(JSON.stringify(lightenFingerprintForStorage(payload)));
  const rawDoc = {scanId: SCAN, rawFingerprint: lightened, sessionId: null, deviceFingerprintSha: SHA, timeSeriesStoragePath: STORAGE_PATH, aiAudit: null, source: 'analyzeDevice', createdAt: Timestamp.fromMillis(NOW)};
  const collections = {reports: {[SCAN]: raw === 'embedded' ? {...report, ...Object.fromEntries(REPORT_RAW_FIELDS.map((f) => [f, rawDoc[f]]))} : report, ...extraReports}, reportRaw: {}};
  if (raw === 'private') collections.reportRaw[SCAN] = rawDoc;
  if (raw === 'no-fingerprint') { const {rawFingerprint, ...rest} = rawDoc; void rawFingerprint; collections.reportRaw[SCAN] = rest; }
  return collections;
};
(async () => {
  // ═══ ١ — الوسائط ═══
  const pa = G.parseArgs;
  deq(pa(['--short-id', 'NC-ABC123', '--out', 'k.json']), {mode: 'run', shortId: 'NC-ABC123', out: 'k.json'}, '[١] --short-id --out');
  deq(pa(['--out', 'k.json', '--short-id', 'NC-ZZ9999']), {mode: 'run', shortId: 'NC-ZZ9999', out: 'k.json'}, '[١] الترتيب لا يهمّ');
  deq(pa(['--preflight']), {mode: 'preflight', shortId: null, out: null}, '[١] --preflight');
  const bad = (argv, re, m) => { let e = null; try { pa(argv); } catch (x) { e = x; } ok(e && re.test(e.message), `${m} — ${e && e.message}`); };
  bad([], /USAGE: --short-id/, '[١] بلا وسائط');
  bad(['--short-id', 'NC-ABC123'], /USAGE/, '[١] بلا --out');
  bad(['--out', 'k.json'], /USAGE/, '[١] بلا --short-id');
  bad(['--short-id', 'nc-abc123', '--out', 'k.json'], /NC-XXXXXX/, '[١] shortId بحروف صغيرة');
  bad(['--short-id', 'NC-ABC12', '--out', 'k.json'], /NC-XXXXXX/, '[١] shortId قصير');
  bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--short-id', 'NC-ABC124'], /مكرَّر/, '[١] shortId مكرَّر');
  bad(['--preflight', '--out', 'k.json'], /--preflight وحدها/, '[١] --preflight مع --out');
  bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--download-to', 'x.gz'], /وسيط مجهول --download-to/, '[١] لا وسيط لحفظ الملفّ المنزَّل (لا حفظ بأيّ شكل)');
  bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--email', 'x@y.z'], /وسيط مجهول --email/, '[١] ولا بريد (السكربت لا يحتاجه)');
  bad(['--short-id', 'NC-ABC123', '--out', 'k.json', '--golden-dir', 'x'], /وسيط مجهول --golden-dir/, '[١] ولا مجلّد ملفّات ذهبية من سطر الأمر');
  bad(['x'], /\(موضعي\)/, '[١] وسيط موضعي');

  // ═══ ٢ — باني المسارات يطابق `.keys.txt` الذهبية حرفاً بحرف ═══
  for (const k of Object.keys(FILES)) {
    eq(K.keysText(K.collectKeyPaths(payloadOf(k))), readText(`${FILES[k]}.keys.txt`), `[٢] ${k}: الباني = .keys.txt (نصّاً كاملاً، بالأسطر والترتيب)`);
  }
  eq(K.keysText(K.collectKeyPaths(readJson(`${FV67_STEM}.json`))), readText(`${FV67_STEM}.keys.txt`), '[٢] وطلب fv67 (جذره الطلب كلّه، fingerprint. في أوّل كل مسار)');
  eq(K.parseKeysText(readText(`${FILES.c11}.keys.txt`)).length, 288, '[٢] 11ch: 288 سطراً');
  eq(K.parseKeysText(readText(`${FILES.c13}.keys.txt`)).length, 305, '[٢] 13ch: 305 أسطر');
  eq(K.parseKeysText(readText(`${FILES.c16}.keys.txt`)).length, 302, '[٢] 16ch: 302 سطراً');
  deq(K.collectKeyPaths({t: Timestamp.fromMillis(1), g: new GeoPoint(1, 2), b: Buffer.from('x'), ts: [{x: 1}], d: new Date(0)}), ['b', 'd', 'g', 't', 'ts', 'ts[].x'], '[٢] Timestamp وGeoPoint وBuffer وDate أوراق (لا createdAt._seconds)');
  deq(K.collectKeyPaths({a: null, b: [], c: [1, 'x', null], d: {}}), ['a', 'b', 'c', 'd'], '[٢] null ومصفوفة غير كائنات وكائن فارغ: مفتاح بلا نزول');
  deq(K.collectKeyPaths({a: {b: 1}}, {prefix: 'timeSeries'}), ['timeSeries', 'timeSeries.a', 'timeSeries.a.b'], '[٢] prefix: الجذر نفسه مسار');
  deq(K.collectKeyPaths(null), [], '[٢] null: لا مسار');
  let crlf = null;
  try { K.parseKeysText('a\r\nb\r\n'); } catch (e) { crlf = e; }
  ok(crlf && /CR/.test(crlf.message), '[٢] ملفّ مفاتيح بـCRLF يُرفض صراحةً (لا يُقبل صامتاً)');
  deq(K.diffKeyPaths(['a', 'b', 'x'], ['a', 'b', 'y', 'z']), {extra: ['x'], missing: ['y', 'z']}, '[٢] الفرق: extra في الفعلي، missing في المتوقَّع');

  // ═══ ٣ — قاعدة التخفيف = lightenFingerprintForStorage الحقيقية ═══
  for (const k of Object.keys(FILES)) {
    const payload = payloadOf(k);
    const real = K.collectKeyPaths(JSON.parse(JSON.stringify(lightenFingerprintForStorage(payload))));
    const rule = K.lightenedExpectedPaths(K.collectKeyPaths(payload));
    deq(rule.paths, real, `[٣] ${k}: lightenedExpectedPaths(مسارات الحمولة) = مسارات lightenFingerprintForStorage(الحمولة) الحقيقية`);
    deq(rule.removed, ['timeSeries.samples', 'timeSeries.samples[].phase', 'timeSeries.samples[].ts', 'timeSeries.samples[].v'], `[٣] ${k}: المحذوف: samples وما تحتها`);
    deq(rule.added, ['timeSeries.samplesCount'], `[٣] ${k}: والمضاف: samplesCount`);
  }
  deq(K.lightenedExpectedPaths(['device']).added, [], '[٣] بلا timeSeries: لا شيء يُضاف');

  // ═══ ٤ — اختيار ملفّات المفاتيح من الملفّات ═══
  {
    const kf = G.loadKeyFiles(GOLDEN);
    eq(kf.state, 'READ', '[٤] المجلّد مقروء');
    // القاعدة 23: كان هنا ثلاثة مرشَّحات fv69 وحدها، ثم ستّة (fv69 ثم fv70)؛ صارت تسعة (fv69 ثم fv70 ثم fv71) بعد نسخ ملفّات المُنتِج لـfv71 (2026-10-18).
    deq(kf.candidates.map((c) => c.name), [...Object.values(FILES), ...Object.values(FV70_FILES), ...Object.values(FV71_FILES)].map((f) => `${f}.keys.txt`), '[٤] المرشَّحات: ملفّات المفاتيح التسعة لحمولات fv69 ثم fv70 ثم fv71 (جذر البصمة)');
    deq(kf.candidates.map((c) => c.fieldsVersion), [69, 69, 69, 70, 70, 70, 71, 71, 71], '[٤] fieldsVersion 69 للثلاثة الأولى و70 للوسطى و71 للأخيرة (من شقيقها .json)');
    // 2026-10-21 (M-02 «إطار + X»): ملفّات مفاتيح fv71 الثلاثة صارت 376 و405 و399 سطراً (كانت 374 و403 و397: مساران جديدان gridPattern وnotRequiredCells في M-02) — القاعدة 23: حُدِّث التوقّع في مكانه. العدّ مقيس بـwc -l على الملفّات نفسها
    deq(kf.candidates.map((c) => c.lines.length), [288, 305, 302, 297, 314, 311, 376, 405, 399], '[٤] أسطرها 288 و305 و302 (fv69) و297 و314 و311 (fv70) و376 و405 و399 (fv71، من G.loadKeyFiles؛ بعد مسارَي «إطار + X»)');
    deq(kf.skipped.map((s) => s.name), [`${FV67_STEM}.keys.txt`], '[٤] المستبعَد: ملفّ مفاتيح طلب fv67');
    ok(/^REQUEST_ROOT/.test(kf.skipped[0].reason), `[٤] وسببه: جذره الطلب لا البصمة — ${kf.skipped[0].reason}`);
    // مجلّد مصنوع: كل حالة استبعاد باسمها
    const dir = fs.mkdtempSync(path.join(tmp, 'gd-'));
    const base = payloadOf('c13');
    const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
    put('good.json', JSON.stringify(base)); put('good.keys.txt', readText(`${FILES.c13}.keys.txt`));
    put('lonely.keys.txt', 'a\n'); // بلا شقيق .json
    put('stale.json', JSON.stringify(base)); put('stale.keys.txt', readText(`${FILES.c13}.keys.txt`).replace('device\n', '')); // الملفّ لا يطابق شقيقه
    put('crlf.json', JSON.stringify(base)); put('crlf.keys.txt', 'device\r\n');
    put('nofv.json', JSON.stringify({a: 1})); put('nofv.keys.txt', 'a\n');
    const kf2 = G.loadKeyFiles(dir);
    deq(kf2.candidates.map((c) => c.name), ['good.keys.txt'], '[٤] مجلّد مصنوع: مرشَّح واحد');
    deq(Object.fromEntries(kf2.skipped.map((s) => [s.name, s.reason.split(':')[0]])), {
      'crlf.keys.txt': 'KEYS_FILE_UNREADABLE', 'lonely.keys.txt': 'SIBLING_JSON_ABSENT_OR_UNREADABLE', 'nofv.keys.txt': 'FIELDS_VERSION_ABSENT_IN_SIBLING_JSON',
      'stale.keys.txt': 'KEYS_FILE_DISAGREES_WITH_ITS_SIBLING_JSON',
    }, '[٤] كل استبعاد بسببه المسمّى: CRLF، بلا شقيق، بلا ختم، لا يطابق شقيقه');
    eq(G.loadKeyFiles(path.join(tmp, 'no-such-dir')).state, 'GOLDEN_DIR_UNREADABLE', '[٤] المجلّد غير المقروء حالة صريحة');
    eq(G.loadReportsDocReference(GOLDEN).state, 'READ', '[٤] مرجع مستند التقرير مقروء');
    ok(G.loadReportsDocReference(GOLDEN).paths.length > 50, '[٤] ومساره أكثر من خمسين');
    eq(G.loadReportsDocReference(dir).state, G.SOURCE_STATE.REFERENCE_FILE_ABSENT, '[٤] وغيابه حالة صريحة');
  }

  // ═══ ٥ — المقارنة على العيّنات الذهبية الثلاث ═══
    for (const k of Object.keys(FILES)) {
    const payload = payloadOf(k);
    const keyFiles = G.loadKeyFiles(GOLDEN);
    const lightened = JSON.parse(JSON.stringify(lightenFingerprintForStorage(payload)));
    const facts = {
      report: {state: 'FOUND', reportData: reportDocSample(), rawRead: {state: RAW_STATE.PRIVATE, raw: {rawFingerprint: lightened, sessionId: null, deviceFingerprintSha: SHA, timeSeriesStoragePath: STORAGE_PATH, aiAudit: null}}},
      storage: {state: 'DOWNLOADED', json: storageFileOf(payload)},
      keyFiles, reportsDocReference: G.loadReportsDocReference(GOLDEN),
    };
    const r = G.buildComparison(facts);
    eq(r.keyFiles.reportFieldsVersion, 69, `[٥] ${k}: إصدار التقرير 69 من تذييل الخامّ`);
    // القاعدة 23: كان المختار = كل المرشَّحين (ثلاثة)؛ بعد إضافة fv70 المرشَّحون ستّة، والمختار منهم ما إصداره إصدار التقرير (69) وحدها — لا يُخلَط ختمان.
    deq(r.keyFiles.chosen.map((c) => c.name), keyFiles.candidates.filter((c) => c.fieldsVersion === 69).map((c) => c.name), `[٥] ${k}: المختار = ملفّات fv69 الثلاثة (إصدارها = إصدار التقرير) بأسمائها، ولا يدخل fv70`);
    deq(r.summary, {allCompared: true, statesBySource: {reportsDoc: 'COMPARED', reportRawFingerprint: 'COMPARED', storageCopy: 'COMPARED'}}, `[٥] ${k}: المصادر الثلاثة قورنت`);
    const raw = r.sources.reportRawFingerprint;
    const own = raw.comparisons.find((c) => c.keysFile === `${FILES[k]}.keys.txt`);
    deq([own.extraCount, own.missingCount, own.extra, own.missing], [0, 0, [], []], `[٥] ${k}: الخامّ المخفَّف يطابق ملفّ مفاتيحه بعد قاعدة التخفيف: لا زائد ولا ناقص`);
    deq(own.byDesign, {removedFromKeysFile: 4, addedToExpected: ['timeSeries.samplesCount']}, `[٥] ${k}: وفرق التصميم معلَن: أربعة مسارات samples محذوفة، وsamplesCount مضاف`);
    eq(raw.closestKeysFile, `${FILES[k]}.keys.txt`, `[٥] ${k}: الأقرب = ملفّ المفاتيح نفسه`);
    for (const c of raw.comparisons.filter((x) => x !== own)) ok(c.extraCount + c.missingCount > 0, `[٥] ${k}: ملفّ مفاتيح آخر (${c.keysFile.slice(-30)}) يُظهر فرقاً (الضابط السلبي: المقارنة حسّاسة)`);
    const st = r.sources.storageCopy;
    const sOwn = st.comparisons.find((c) => c.keysFile === `${FILES[k]}.keys.txt`);
    deq([sOwn.extra, sOwn.missing], [[], ['timeSeries.timeSeriesState']], `[٥] ${k}: Storage: الناقص timeSeriesState وحده (حقل حمولة الطلب لا ملفّ السلسلة) ولا زائد`);
    eq(st.closestKeysFile, `${FILES[k]}.keys.txt`, `[٥] ${k}: وأقرب ملفّ لـStorage هو نفسه`);
    ok(sOwn.expectedCount > 100, `[٥] ${k}: المتوقَّع من جزء timeSeries أكثر من مئة مسار`);
    ok(Object.keys(r.sources.reportsDoc).includes('extra') && Array.isArray(r.sources.reportsDoc.missing), `[٥] ${k}: مستند التقرير قورن بمرجعه (مسارات العيّنة الذهبية في الذاكرة)`);
    ok(/derived-in-memory/.test(r.sources.reportsDoc.reference.kind), `[٥] ${k}: ووُسم «مُحسَب في الذاكرة» (لا ملفّ .keys.txt لمستند التقرير)`);
  }
  // فرق حقيقي في الخامّ يظهر: مفتاح زائد ومفتاح ناقص
  {
    const payload = payloadOf('c11');
    const lightened = JSON.parse(JSON.stringify(lightenFingerprintForStorage(payload)));
    lightened.device.zzNewKey = 1;
    delete lightened.device.model;
    const storageFile = storageFileOf(payload);
    storageFile.footer.zzNewFooterKey = {a: 1};
    delete storageFile.header.appVersion;
    const r = G.buildComparison({
      report: {state: 'FOUND', reportData: reportDocSample(), rawRead: {state: RAW_STATE.PRIVATE, raw: {rawFingerprint: lightened}}},
      storage: {state: 'DOWNLOADED', json: storageFile}, keyFiles: G.loadKeyFiles(GOLDEN), reportsDocReference: G.loadReportsDocReference(GOLDEN),
    });
    const own = r.sources.reportRawFingerprint.comparisons.find((c) => c.keysFile === `${FILES.c11}.keys.txt`);
    deq([own.extra, own.missing], [['device.zzNewKey'], ['device.model']], '[٥] الخامّ: المفتاح الزائد والمفتاح الناقص يظهران بمسارَيهما');
    const sOwn = r.sources.storageCopy.comparisons.find((c) => c.keysFile === `${FILES.c11}.keys.txt`);
    deq([sOwn.extra, sOwn.missing], [['timeSeries.footer.zzNewFooterKey', 'timeSeries.footer.zzNewFooterKey.a'], ['timeSeries.header.appVersion', 'timeSeries.timeSeriesState']], '[٥] Storage: الزائد والناقص بمسارَيهما (ومنها مسار تحت الزائد)');
  }

  // ═══ ٦ — لا قيمة في المخرَج ═══
  {
    const payload = payloadOf('c13');
    const marker = (s) => `VALUE-MARKER-${s}`;
    payload.device.model = marker('MODEL'); payload.device.cpuModel = marker('CPU'); payload.timeSeries.header.deviceModel = marker('HEADERMODEL');
    payload.timeSeries.header.appVersion = marker('APPVER'); payload.functionalResults[0].rawValue = marker('RAW'); payload.manualResults[0].notes = marker('NOTE');
    payload.timeSeries.footer.channelDiscovery.reasons.cpu_temp_c = marker('REASON');
    payload.timeSeries.samples[0].v[1] = 777777.123;
    const storageFile = storageFileOf(payload);
    const report = reportDocSample();
    report.shortId = SHORT; report.deviceModel = marker('REPORTMODEL'); report.userId = marker('USERID');
    const db = makeMemDb(worldOf({payload, report}));
    const {bucket} = H.makeStubBucket({[STORAGE_PATH]: gzOf(storageFile)});
    const outPath = nextOut();
    const r = await H.runMain(main, ['--short-id', SHORT, '--out', outPath], {db, bucket, now: () => NOW});
    eq(r.code, 0, '[٦] النجاح: 0');
    const text = fs.readFileSync(outPath, 'utf8');
    ok(!text.includes('VALUE-MARKER'), '[٦] لا قيمة في الملفّ (علامات في device.model وcpuModel وrawValue وnotes وreasons وheader وuserId…)');
    ok(!text.includes('777777'), '[٦] ولا رقم عيّنة');
    ok(!text.includes(SCAN) && !text.includes(SHA) && !text.includes(STORAGE_PATH) && !text.includes('owner-uid-secret'), '[٦] ولا scanId ولا بصمة جهاز ولا مسار Storage ولا uid خامّاً');
    ok(!text.includes(SHORT), '[٦] ولا shortId خامّاً (مُهشَّر)');
    ok(!r.outs.join('\n').includes('VALUE-MARKER') && !r.errs.join('\n').includes(SCAN), '[٦] ولا في stdout ولا stderr');
    const j = JSON.parse(text);
    eq(j.input.shortIdHash, C.hashIdForLog(SHORT), '[٦] shortId مُهشَّر');
    eq(j.input.scanIdHash, C.hashIdForLog(SCAN), '[٦] scanId مُهشَّر');
    eq(Object.keys(j)[0], 'projectId', '[٦] projectId أوّل حقل');
    // المسارات وحدها: كل سطر في extra/missing نصّ مسار (أحرف مفتاح ونقاط و[] فقط)
    const allPaths = [];
    for (const s of Object.values(j.sources)) for (const c of (s.comparisons || [s])) for (const p of [...(c.extra || []), ...(c.missing || [])]) allPaths.push(p);
    ok(allPaths.every((p) => /^[A-Za-z0-9_.[\]-]+$/.test(p)), '[٦] كل ما في extra/missing مسار مفتاح (أحرف وأرقام ونقاط و[])');
  }

  // ═══ ٧ — الحالات الصريحة لكل مصدر لا يُقرأ ═══
  {
    const payload = payloadOf('c11');
    const goodStorage = () => ({[STORAGE_PATH]: gzOf(storageFileOf(payload))});
    const states = async (collections, objects, opts = {}) => {
      const out = nextOut();
      const {bucket, calls, writeAttempts} = H.makeStubBucket(objects);
      const db = makeMemDb(collections);
      const r = await H.runMain(main, ['--short-id', SHORT, '--out', out], {db, bucket, goldenDir: opts.goldenDir, now: () => NOW});
      deq([db.writeAttempts, writeAttempts], [[], []], '[٧] (لا كتابة Firestore ولا Storage)');
      return {...r, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null, calls, outPath: out};
    };
    // لا تقرير
    let r = await states({reports: {}, reportRaw: {}}, {});
    eq(r.code, 3, '[٧] لا تقرير: 3 (لا يُحكم)');
    deq([r.json.early.state, r.json.early.reportsFoundByShortId, r.json.summary.allCompared], ['REPORT_ABSENT', 0, false], '[٧] REPORT_ABSENT');
    // تقريران بالرمز نفسه
    r = await states({reports: {a: {shortId: SHORT, userId: 'u'}, b: {shortId: SHORT, userId: 'u'}}, reportRaw: {}}, {});
    deq([r.code, r.json.early.state, r.json.early.reportsFoundByShortId], [3, 'SHORT_ID_AMBIGUOUS', 2], '[٧] SHORT_ID_AMBIGUOUS');
    // لا خامّ (لا reportRaw ولا حقول مضمَّنة)
    r = await states(worldOf({payload, raw: 'none'}), goodStorage());
    eq(r.code, 3, '[٧] لا خامّ: 3');
    deq([r.json.sources.reportRawFingerprint.state, r.json.sources.reportRawFingerprint.rawState], ['RAW_ABSENT', 'ABSENT'], '[٧] RAW_ABSENT وحالة readReportRaw ABSENT');
    eq(r.json.sources.storageCopy.state, 'STORAGE_PATH_ABSENT', '[٧] ولا مسار Storage');
    eq(r.json.sources.reportsDoc.state, 'COMPARED', '[٧] ومستند التقرير يُقارَن رغم ذلك');
    eq(r.calls.length, 0, '[٧] ولا نداء Storage بلا مسار');
    // خامّ بلا rawFingerprint: لا إصدار فلا ملفّ مفاتيح يُختار — حالة صريحة لا مقارنة بملفّ تخميناً
    r = await states(worldOf({payload, raw: 'no-fingerprint'}), goodStorage());
    eq(r.code, 3, '[٧] خامّ بلا البصمة: 3');
    eq(r.json.sources.reportRawFingerprint.state, 'RAW_FINGERPRINT_ABSENT', '[٧] RAW_FINGERPRINT_ABSENT');
    deq(r.json.sources.reportRawFingerprint.fieldsPresent, ['aiAudit', 'deviceFingerprintSha', 'sessionId', 'timeSeriesStoragePath'], '[٧] وتُسرد الحقول الحاضرة بأسمائها');
    eq(r.json.keyFiles.reportFieldsVersion, null, '[٧] إصدار التقرير غير مقروء (null لا 0)');
    deq(r.json.keyFiles.chosen, [], '[٧] فلا ملفّ مفاتيح مختار');
    eq(r.json.sources.storageCopy.state, 'NO_KEYS_FILE_FOR_FIELDS_VERSION', '[٧] وStorage: NO_KEYS_FILE_FOR_FIELDS_VERSION (لا مقارنة تخميناً)');
    ok(r.json.sources.storageCopy.actualCount > 100, '[٧] ومعه عدد مساراته الفعلية');
    // أخطاء Storage — كلٌّ بحالته، ولا مسار ولا رسالة في المخرَج
    const storageCases = [
      ['FILE_NOT_FOUND', {}, undefined],
      ['DOWNLOADED_NOT_GZIP', {[STORAGE_PATH]: Buffer.from('{"plain":"json"}')}, undefined],
      ['GUNZIP_ERROR', {[STORAGE_PATH]: Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08, 0x00]), Buffer.from('not-a-real-gzip-stream-VALUE-MARKER')])}, undefined],
      ['DOWNLOAD_ERROR', {[STORAGE_PATH]: Object.assign(new Error(`AccessDenied: ${STORAGE_PATH} for owner owner@example.test token=SECRETTOKEN`), {code: 403})}, '403'],
    ];
    for (const [expected, objects, expectedCode] of storageCases) {
      r = await states(worldOf({payload}), objects);
      eq(r.code, 3, `[٧] Storage ${expected}: 3`);
      eq(r.json.sources.storageCopy.state, expected, `[٧] Storage: ${expected}`);
      eq(r.json.sources.reportRawFingerprint.state, 'COMPARED', `[٧] Storage ${expected}: والخامّ يُقارَن رغم ذلك`);
      const text = fs.readFileSync(r.outPath, 'utf8');
      ok(!text.includes(STORAGE_PATH) && !text.includes(SHA) && !text.includes('SECRETTOKEN') && !text.includes('owner@example.test') && !text.includes('VALUE-MARKER') && !text.includes('AccessDenied'), `[٧] Storage ${expected}: لا مسار ولا رسالة خطأ ولا قيمة في المخرَج (القاعدة 36)`);
      if (expectedCode !== undefined) deq([r.json.sources.storageCopy.errorCode, r.json.sources.storageCopy.errorClass], [expectedCode, 'Error'], `[٧] Storage ${expected}: الرمز والصنف وحدهما`);
    }
    // ملفّ Storage مصفوفة (لا كائن timeSeries)
    r = await states(worldOf({payload}), {[STORAGE_PATH]: gzOf([1, 2, 3])});
    deq([r.code, r.json.sources.storageCopy.state, r.json.sources.storageCopy.topLevelIsArray], [3, 'STORAGE_NOT_A_TIMESERIES_OBJECT', true], '[٧] ملفّ Storage مصفوفة: STORAGE_NOT_A_TIMESERIES_OBJECT');
    // إصدار تقرير بلا ملفّ مفاتيح. القاعدة 23: كان هنا الإصدار 70 (لا ملفّ له يومها)؛ منذ 2026-10-13 +03 له ملفّات (نسخ fv70 من التطبيق)، فصار المثال 71؛ ومنذ 2026-10-18 +03 لـ71 ملفّات (عيّنات المُنتِج) فصار المثال 72.
    // السلوك المحروس نفسه: لا مقارنة بملفّ إصدار آخر، وحالة صريحة.
    {
      const p72 = payloadOf('c11');
      p72.timeSeries.footer.fieldsVersion = 72;
      r = await states(worldOf({payload: p72}), {[STORAGE_PATH]: gzOf(storageFileOf(p72))});
      eq(r.code, 3, '[٧] إصدار 72 بلا ملفّ مفاتيح: 3');
      eq(r.json.keyFiles.reportFieldsVersion, 72, '[٧] إصدار التقرير 72');
      deq([r.json.keyFiles.available.map((a) => a.fieldsVersion), r.json.keyFiles.chosen], [[69, 69, 69, 70, 70, 70, 71, 71, 71], []], '[٧] المتاحة 69 و70 و71 والمختار فارغ');
      deq([r.json.sources.reportRawFingerprint.state, r.json.sources.storageCopy.state], ['NO_KEYS_FILE_FOR_FIELDS_VERSION', 'NO_KEYS_FILE_FOR_FIELDS_VERSION'], '[٧] NO_KEYS_FILE_FOR_FIELDS_VERSION للخامّ وStorage (لا مقارنة بملفّ إصدار آخر)');
    }
    // الإصدار 70 له الآن ملفّاته الثلاثة (عيّنات التطبيق): تُختار هي لا ملفّات fv69.
    {
      const p70 = readJson(`${FV70_FILES.c11}.json`);
      r = await states(worldOf({payload: p70}), {[STORAGE_PATH]: gzOf(storageFileOf(p70))});
      eq(r.json.keyFiles.reportFieldsVersion, 70, '[٧] إصدار التقرير 70 (حمولة fv70 الحقيقية من التطبيق)');
      deq(r.json.keyFiles.chosen.map((c) => c.name), Object.values(FV70_FILES).map((f) => `${f}.keys.txt`), '[٧] المختار ملفّات fv70 الثلاثة وحدها (لا fv69)');
    }
    // الإصدار 71 له ملفّاته الثلاثة (عيّنات المُنتِج، 2026-10-18): تُختار هي لا ملفّات fv70.
    {
      const p71 = readJson(`${FV71_FILES.c11}.json`);
      r = await states(worldOf({payload: p71}), {[STORAGE_PATH]: gzOf(storageFileOf(p71))});
      eq(r.json.keyFiles.reportFieldsVersion, 71, '[٧] إصدار التقرير 71 (حمولة fv71 الحقيقية من المُنتِج)');
      deq(r.json.keyFiles.chosen.map((c) => c.name), Object.values(FV71_FILES).map((f) => `${f}.keys.txt`), '[٧] المختار ملفّات fv71 الثلاثة وحدها (لا fv70)');
    }
    // مجلّد الملفّات الذهبية غير مقروء
    r = await states(worldOf({payload}), goodStorage(), {goldenDir: path.join(tmp, 'no-such-golden-dir')});
    deq([r.json.keyFiles.goldenDirState, r.json.keyFiles.chosen, r.json.sources.reportsDoc.state, r.json.sources.reportRawFingerprint.state], ['GOLDEN_DIR_UNREADABLE', [], 'REFERENCE_FILE_ABSENT', 'NO_KEYS_FILE_FOR_FIELDS_VERSION'], '[٧] مجلّد ذهبي غير مقروء: حالات صريحة لا مقارنة صامتة');
    // خامّ مضمَّن في تقرير ما قبل الترحيل
    r = await states(worldOf({payload, raw: 'embedded'}), goodStorage());
    eq(r.code, 0, '[٧] EMBEDDED_LEGACY: يُقارَن (0)');
    eq(r.json.sources.reportRawFingerprint.rawState, 'EMBEDDED_LEGACY', '[٧] حالة الخامّ EMBEDDED_LEGACY');
    deq(r.json.sources.reportsDoc.rawFieldsEmbeddedInReportsDoc, ['rawFingerprint', 'sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'aiAudit'], '[٧] والحقول المضمَّنة في مستند التقرير تُسرد بأسمائها');
    ok(![...r.json.sources.reportsDoc.extra].some((p) => /^(rawFingerprint|sessionId|deviceFingerprintSha|timeSeriesStoragePath|aiAudit)/.test(p)), '[٧] ولا تدخل مسارات مستند التقرير (مصدرها reportRaw أدناه)');
    const own = r.json.sources.reportRawFingerprint.comparisons.find((c) => c.keysFile === `${FILES.c11}.keys.txt`);
    deq([own.extraCount, own.missingCount], [0, 0], '[٧] وخامّ EMBEDDED_LEGACY يطابق ملفّ مفاتيحه');
  }

  // ═══ ٨ — main: رمز الخروج والملفّ wx ولا شيء يُكتب على القرص غيره ═══
  {
    const payload = payloadOf('c16');
    const objects = {[STORAGE_PATH]: gzOf(storageFileOf(payload))};
    const fsSpy = H.spyFsWrites();
    const netGuard = H.blockNonLocalNetwork();
    const db = makeMemDb(worldOf({payload}));
    const {bucket, calls, writeAttempts} = H.makeStubBucket(objects);
    const outPath = nextOut();
    let r;
    try {
      r = await H.runMain(main, ['--short-id', SHORT, '--out', outPath], {db, bucket, now: () => NOW});
    } finally {
      fsSpy.restore(); netGuard.restore();
    }
    eq(r.code, 0, '[٨] النجاح: 0 (المصادر الثلاثة قورنت)');
    deq(fsSpy.writes.map((w) => w.path), [path.resolve(outPath)], '[٨] الكتابة الوحيدة على القرص: ملفّ المخرَج (لا نسخة من ملفّ Storage ولا شيء آخر)');
    deq(fsSpy.writes.map((w) => w.fn), ['fs.writeFileSync'], '[٨] بنداء واحد: writeFileSync');
    deq(netGuard.blocked, [], '[٨] لا اتصال بغير المضيف المحلّي');
    deq(writeAttempts, [], '[٨] لا كتابة على Storage');
    deq(db.writeAttempts, [], '[٨] ولا على Firestore');
    deq(calls.map((c) => c.op), ['exists', 'download'], '[٨] نداءان لـStorage: exists ثم download');
    deq(calls[1].opts, {decompress: false}, '[٨] وdownload بـ{decompress:false} وحده (لا destination)');
    const bytes = fs.readFileSync(outPath);
    ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), '[٨] UTF-8 بلا BOM');
    const j = JSON.parse(bytes.toString('utf8'));
    deq([j.projectId, j.mode, j.schema], ['neuralchek-9b6d7', 'golden-stage2-keypaths', 1], '[٨] projectId وmode وschema');
    ok(/^golden-stage2-keypaths written: allCompared=true states=\{/.test(r.outs[0]), `[٨] سطر الملخّص — ${r.outs[0]}`);
    const r2 = await H.runMain(main, ['--short-id', SHORT, '--out', outPath], {db, bucket, now: () => NOW});
    eq(r2.code, 2, '[٨] ملفّ موجود: لا استبدال (2)');
    ok(r2.errs.some((e) => /OUT_EXISTS/.test(e)), '[٨] OUT_EXISTS');
    eq(fs.readFileSync(outPath, 'utf8'), bytes.toString('utf8'), '[٨] والملفّ القائم لم يُمسّ');
    const dbNoRead = makeMemDb(worldOf({payload}));
    const r3 = await H.runMain(main, ['--short-id', SHORT, '--out', path.join(tmp, 'no-such-dir', 'x.json')], {db: dbNoRead, bucket, now: () => NOW});
    eq(r3.code, 2, '[٨] مجلّد المخرَج غائب: 2');
    ok(r3.errs.some((e) => /OUT_DIR_MISSING/.test(e)), '[٨] OUT_DIR_MISSING');
    deq(dbNoRead.reads, [], '[٨] وقبل أيّ قراءة (الفحص بلا شبكة أوّلاً)');
    const r4 = await H.runMain(main, ['--short-id', 'bad', '--out', nextOut()], {db, bucket});
    eq(r4.code, 2, '[٨] وسيط خاطئ: 2');
    const pf = await H.runMain(main, ['--preflight'], {});
    eq(pf.code, 0, '[٨] --preflight: 0 بلا db ولا bucket');
    const pfj = JSON.parse(pf.outs.join('\n'));
    deq([pfj.mode, pfj.network, pfj.readOnly, pfj.ok], ['preflight', false, true, true], '[٨] preflight: بلا شبكة، قراءة فقط، سليم');
    ok(pfj.checks.length >= 10 && pfj.checks.every((c) => c.ok), '[٨] وفحوصه كلّها مرّت');
  }

  fs.rmSync(tmp, {recursive: true, force: true}); // ملفّات الاختبار المؤقّتة وحدها
  console.log(`\ngoldenStage2Keypaths.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});
