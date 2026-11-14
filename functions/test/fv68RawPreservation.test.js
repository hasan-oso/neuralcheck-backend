'use strict';

// fv68RawPreservation.test.js — الدفعة ٤ من V8 (PLAN-05)، البند ٨: «lighten/rehydrate/ensureReportShape تحفظ المفاتيح الجديدة».
//
// القاعدة 25 بنصّها: «لا يُقبل شكل جديد إلا بتحديث كل قارئ له». الطبقات التي تمرّ بها حمولة fv68 قبل أن تُخزَّن وبعد أن تُقرأ:
//   ١) lightenFingerprintForStorage (analysis/lightenFingerprintForStorage.js:7-15) — يحذف timeSeries.samples وحدها.
//   ٢) buildReportRawDocument / assertReportRawFits (analysis/reportRawStore.js) — يخزّن lighten(fingerprint) في reportRaw/{scanId}، والحدّ 900000 بايت.
//   ٣) rehydrateFingerprintSamples (analysis/rehydrateReportSamples.js:73-79) — يستبدل timeSeries.samples وحدها.
//   ٤) ensureReportShape (analysis/callDeepSeek.js:75، callGemini.js:76) — **ليست قارئاً لـfingerprint**: تتحقّق من شكل ردّ النموذج. فرق بين الأمر وكودي
//      يُبلَّغ؛ هذا الاختبار يثبّته بالنصّ والسلوك (لا مفتاح fv68 يمرّ بها).
// الشكل الذي يُختبر: حمولات التطبيق الذهبية الثلاث (fv69 منذ 2026-10-10؛ كانت fv68) وحمولة 1.0.10 (fv67) كما تصل إلى analyzeDevice. ⚠️ مشتقّة لا مسجَّلة من جهاز على fv68.
//
// Run: node functions/test/fv68RawPreservation.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {rehydrateFingerprintSamples} = require('../src/analysis/rehydrateReportSamples');
const {buildReportRawDocument, assertReportRawFits, measureReportRawBytes, REPORT_RAW_MAX_BYTES} = require('../src/analysis/reportRawStore');
const deepseek = require('../src/analysis/callDeepSeek');
const gemini = require('../src/analysis/callGemini');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const fileOf = (stem, ext) => path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.${ext}`);
const FV67 = path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8');

// مسارات المفاتيح بنفس قاعدة الملفّات الذهبية (fv68AppPayloadGoldenCopy.test.js): منقوط، و[] بعد المصفوفة، مجموعة بلا تكرار
function keyPaths(root) {
  const paths = new Set();
  const walk = (v, prefix) => {
    if (Array.isArray(v)) {
      for (const el of v) if (el !== null && typeof el === 'object') walk(el, `${prefix}[]`);
      return;
    }
    if (v !== null && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const p = prefix === '' ? k : `${prefix}.${k}`;
        paths.add(p);
        walk(v[k], p);
      }
    }
  };
  walk(root, '');
  return paths;
}

const cases = STEMS.map((s) => ({label: `fv69 ${s}`, fp: JSON.parse(fs.readFileSync(fileOf(s, 'json'), 'utf8')), keysFile: fileOf(s, 'keys.txt'), stem: s}));
cases.push({
  label: 'fv67 1.0.10', fp: JSON.parse(fs.readFileSync(`${FV67}.json`, 'utf8')).fingerprint,
  keysFile: `${FV67}.keys.txt`, stem: 'fv67', fv67: true,
});

for (const c of cases) {
  const {label, fp} = c;
  const before = clone(fp);
  const light = lightenFingerprintForStorage(fp);
  eq(fp, before, `[١][${label}] lighten لا يعدّل المُدخل`);
  ok(!('samples' in light.timeSeries), `[١][${label}] samples محذوفة`);
  eq(light.timeSeries.samplesCount, fp.timeSeries.samples.length, `[١][${label}] وsamplesCount = عدد العيّنات (${fp.timeSeries.samples.length})`);

  // كل مفتاح غير samples باقٍ حرفياً
  const stripSamples = (o) => { const m = clone(o); delete m.timeSeries.samples; delete m.timeSeries.samplesCount; return m; };
  eq(stripSamples(light), stripSamples(fp), `[١][${label}] كل ما عدا العيّنات (header/footer/variables/timeSeriesState/functionalResults/manualResults/device) باقٍ بلا مساس`);
  // مجموعة المسارات = مجموعة الحمولة ناقص مسارات العيّنات + samplesCount (جدول المفاتيح الذهبي هو المرجع، لا حساب هذا الاختبار وحده)
  const fileKeys = new Set(fs.readFileSync(c.keysFile, 'utf8').split('\n').filter(Boolean).map((l) => l.replace(/^fingerprint\./, '')));
  const lightKeys = keyPaths(light);
  // جدول fv67 يحمل مستوى الطلب كلّه (fingerprint/language/scanId/usePrecomputed) والحمولة المختبَرة هي fingerprint وحده؛ جداول fv68 على مستوى fingerprint
  const REQUEST_LEVEL_KEYS = new Set(['fingerprint', 'language', 'scanId', 'usePrecomputed']);
  const expectedKeys = new Set([...fileKeys].filter((p) => !p.startsWith('timeSeries.samples') && !(c.fv67 && REQUEST_LEVEL_KEYS.has(p))));
  expectedKeys.add('timeSeries.samplesCount');
  eq([...lightKeys].sort(), [...expectedKeys].sort(), `[١][${label}] مجموعة المسارات بعد lighten = جدول المفاتيح الذهبي ناقص timeSeries.samples* زائد samplesCount (${expectedKeys.size} مساراً)`);
  if (!c.fv67) {
    ok(lightKeys.has('timeSeries.footer.verificationResults.cpuKnownAnswerState') && lightKeys.has('timeSeries.footer.batteryPairs[].voltageRaw') &&
       lightKeys.has('timeSeries.footer.channelReadFailures') && lightKeys.has('timeSeries.timeSeriesState') && lightKeys.has('functionalResults[].measurements'),
    `[١][${label}] وبينها مفاتيح fv68 الجديدة (مثال: cpuKnownAnswerState، batteryPairs[].voltageRaw، channelReadFailures، timeSeriesState، measurements)`);
  }

  // reportRaw
  const doc = buildReportRawDocument({scanId: 's-1', fingerprint: fp, isSessionScan: false, sessionId: null, deviceFingerprintSha: 'a', timeSeriesStoragePath: 'p', aiResultAudit: null, createdAt: null});
  eq(doc.rawFingerprint, light, `[٢][${label}] reportRaw.rawFingerprint = lighten(fingerprint) بلا فرق`);
  const bytes = measureReportRawBytes(doc);
  ok(bytes > 0 && bytes < REPORT_RAW_MAX_BYTES, `[٢][${label}] الحجم ${bytes} بايتاً < ${REPORT_RAW_MAX_BYTES} (عدّ من measureReportRawBytes)`);
  eq(assertReportRawFits(doc), bytes, `[٢][${label}] assertReportRawFits تمرّره وتُعيد الحجم نفسه`);
  // جولة JSON كاملة (Firestore يخزّن JSON): لا مفتاح يضيع ولا يتغيّر نوعه
  eq(JSON.parse(JSON.stringify(doc.rawFingerprint)), light, `[٢][${label}] جولة JSON (التخزين) لا تغيّر شيئاً`);

  // rehydrate: الاستبدال للعيّنات وحدها
  const samples = clone(fp.timeSeries.samples);
  const back = rehydrateFingerprintSamples(light, samples);
  eq(back.timeSeries.samples, fp.timeSeries.samples, `[٣][${label}] rehydrate يعيد العيّنات`);
  const strip2 = (o) => { const m = clone(o); delete m.timeSeries.samples; return m; };
  eq(strip2(back), strip2(light), `[٣][${label}] وما عداها كما خُزِّن`);
  eq(back.timeSeries.variables, fp.timeSeries.variables, `[٣][${label}] variables[] المخزَّنة (بلا index) لا تُستبدل بنسخة Storage (التي تحمل index)`);
  eq(back.timeSeries.footer, fp.timeSeries.footer, `[٣][${label}] والتذييل المخزَّن لا يُستبدل (حتى لو حملت نسخة Storage تذييلاً أغنى)`);
  // نسخة Storage بـvariables[] بـindex وتذييل مختلف: rehydrate يأخذ العيّنات وحدها
  const storageFile = {header: {h: 1}, footer: {fieldsVersion: 1}, samples, variables: fp.timeSeries.variables.map((v, i) => ({index: i, ...v}))};
  const merged = rehydrateFingerprintSamples(light, storageFile.samples);
  eq([merged.timeSeries.footer, merged.timeSeries.variables], [fp.timeSeries.footer, fp.timeSeries.variables], `[٣][${label}] ملفّ Storage لا يطغى على التذييل ولا على variables[] المخزَّنة`);
}

// حجم الأكبر: أعلى قياس بين العيّنات الذهبية في reportRawStore.js يقول 40,983؛ عيّنة 16ch تتجاوزه — تُعلَن
{
  const sizes = cases.map((c) => measureReportRawBytes(buildReportRawDocument({scanId: 's', fingerprint: c.fp, isSessionScan: false, sessionId: null,
    deviceFingerprintSha: 'a', timeSeriesStoragePath: 'p', aiResultAudit: null, createdAt: null})));
  eq(sizes.map((s) => s < REPORT_RAW_MAX_BYTES), [true, true, true, true], '[٢] الحمولات الأربع تحت العتبة');
  ok(Math.max(...sizes) < REPORT_RAW_MAX_BYTES / 10, `[٢] وأكبرها (${Math.max(...sizes)}) دون عُشر العتبة: لا خطر على الحدّ الصلب 1 MiB من قوائم fv68 (batteryPairs حتى 200، channelReadFailures حتى 200 لكل قناة)`);
}

// ═══════════════════════════════════════════════════════════════════
// ٤) ensureReportShape: ليست قارئاً لـfingerprint
// ═══════════════════════════════════════════════════════════════════
for (const [label, mod] of [['callDeepSeek', deepseek], ['callGemini', gemini]]) {
  const fn = mod.ensureReportShape;
  ok(typeof fn === 'function', `[٤][${label}] ensureReportShape مُصدَّرة`);
  const src = fn.toString();
  ok(!/fingerprint|footer|variables|samples|verificationResults|timeSeries/i.test(src),
      `[٤][${label}] نصّ الدالّة لا يذكر fingerprint ولا footer ولا variables ولا samples ولا verificationResults: لا مفتاح fv68 يمرّ بها`);
  eq(fn.length, 4, `[٤][${label}] توقيعها (parsed, origin, meta, shapeSpec) — لا مُدخل fingerprint`);
  // سلوكاً: تُعيد تقرير النموذج نفسه (r.report) بلا مساس بما فيه من مفاتيح
  const report = {overall: {letter: 'B'}, categories: {}, narrative: {}, issues: [], fv68Probe: {anything: true}};
  const spec = {shapeKeys: ['overall', 'categories', 'narrative', 'issues'], coreKeyGroups: [['overall'], ['categories']]};
  const warn = console.warn;
  console.warn = () => {};
  let out;
  try { out = fn(report, 'parse', {}, spec); } finally { console.warn = warn; }
  eq(out, report, `[٤][${label}] المُعاد هو التقرير حرفياً بمفتاحه الغريب (لا تصفية للمفاتيح)`);
}

console.log(`\nfv68RawPreservation.test.js: ${n}/${n} assertions passed`);
