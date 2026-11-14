'use strict';

// evaluationRulesVersion.test.js — ختم قواعد التقييم (P6-26، الجزء الأوّل، 2026-10-13 +03، src/analysis/evaluationRulesVersion.js).
//
// جواب المستخدم، بنصّه (منقول من أمر المنسّق، غير متحقَّق من مصدره عندي): "Start P6-26's stamp now (Recommended)"، ووصف الخيار كما عُرض: "One exported constant, written to every new report as
// `evaluationRulesVersion` (not displayed, not in verifyReport). First value marks this change; named in the contract. The rest of P6-26 stays planned."
//
// ما يغطّيه (الأمر: «الختم: حاضر في مستند جديد، وغائب عن ردّ verifyReport»):
//   ١ الثابت وحقله: مُصدَّران من مصدر واحد (القاعدة 24)، والقيمة الحالية تسمّي ق٢ (رُفع الختم بقرار حسن 2026-10-23: «ق٢ (INV:112): يُرفع evaluationRulesVersion قبل النشر ليميّز التقارير قبل ق٢ وبعده.»)، والقيمة السابقة غيرها.
//   ٢ buildReportDocument الحقيقية: الختم في جذر مستند V7 وV6؛ ولا نسخة من الحقل بنصّه الحرفي في كود الخادم.
//   ٣ العيّنات الذهبية الستّ لمستند reports تحمله (القاعدة 39: الفخّ يتبع العقد)، والعيّنة V6 المؤرَّخة لا تحمله («كُتب قبل الختم»).
//   ٤ غير معروض: ليس في aiResponse المخزَّن، وليس في ردّ verifyReport (المُبنى من مستند يحمله — العيّنة الذهبية الحقيقية الشكل)، ولا في الإرجاع إلى العميل.
//   ٥ مسار التقرير المخبَّأ (pipeline='cached') عبر runAnalysisInternal الحقيقية: يحمل ختم التقرير الأصل إن حمله، وإلّا يغيب المفتاح — لا ختم هذا الإصدار على محتوى أنتجته قواعد أخرى (القاعدة 22).
//
// Run: node functions/test/evaluationRulesVersion.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// القيمة الأولى للختم (P6-26، 2026-10-13): تقارير كُتبت قبل رفع 2026-10-23 تحتفظ بها في مستنداتها المخزَّنة (لا يُعاد ملؤها ولا يُعاد تقييمها) — حرفية هنا بنصّ الاختبار وحده، لا في كود الخادم.
const PREVIOUS_RULES_STAMP = 'rules-2026-10-13-zero-cycles-unsupported';

// ─── الاستبدال: Firestore ذاكرة (profiles/reports/settings) وfetch فخّ — مسار التقرير المخبَّأ يعود قبل أيّ نداء نموذج ─────────────────────────────────────────────────────────
let fetchCallCount = 0;
global.fetch = async () => { fetchCallCount++; throw new Error('TRAP: no network call is expected on the cached path'); };
const memProfiles = new Map();
const memReports = new Map();
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {
      collection: (name) => {
        // settings/cache.reuseEnabled=true (إعادة الاستعمال مطفأة افتراضياً — resolveCacheConfig.js — فتُفعَّل هنا كما يفعل v7SwitchProductionPathCounters.test.js)؛ وبقيّة settings 404
        if (name === 'settings') return {doc: (d) => ({get: async () => (d === 'cache' ? {exists: true, data: () => ({reuseEnabled: true})} : {exists: false})})};
        if (name === 'deviceProfiles') return {doc: (id) => ({get: async () => ({exists: memProfiles.has(id), data: () => memProfiles.get(id)})})};
        throw new Error(`TRAP: unexpected collection "${name}"`);
      },
      doc: (docPath) => ({get: async () => ({exists: memReports.has(docPath), data: () => memReports.get(docPath)})}),
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require('../src/analysis/evaluationRulesVersion');
const {buildReportDocument} = require('../src/analysis/analyzeDevice');
const {V6_PIPELINE_TAG, V7_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {buildReportsDocumentSample} = require('../scripts/generate-v7-reports-document-sample');
const {buildVerifyReportResponseSample} = require('../scripts/generate-v7-verifyReport-response-sample');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');
const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const loadGolden = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));

// ═══════════════════════════════════════════════════════════════════════
// ١ — الثابت وحقله
// ═══════════════════════════════════════════════════════════════════════
eq(EVALUATION_RULES_VERSION_FIELD, 'evaluationRulesVersion', '[١] اسم الحقل بحروفه (جذر مستند reports)');
eq(typeof EVALUATION_RULES_VERSION, 'string', '[١] الختم نصّ');
ok(EVALUATION_RULES_VERSION.trim() !== '' && EVALUATION_RULES_VERSION === EVALUATION_RULES_VERSION.trim(), '[١] الختم غير فارغ ولا مسافات حوله');
eq(EVALUATION_RULES_VERSION, 'rules-2026-10-23-hardware-absent-coverage', '[١] القيمة الحالية تسمّي ق٢ وتاريخه (العتاد الغائب خارج مقام التغطية؛ قرار حسن 2026-10-23)');
ok(EVALUATION_RULES_VERSION !== PREVIOUS_RULES_STAMP, '[١] الختم الحالي غير القيمة السابقة — يميّز تقرير ما قبل ق٢ من ما بعده');
{
  const {PIPELINE_VERSION} = require('../src/signatures/constants');
  ok(EVALUATION_RULES_VERSION !== PIPELINE_VERSION, '[١] ليس PIPELINE_VERSION ولا يساويه (ختم القواعد لا رفع بوّابة الكاش)');
  eq(computeScanSignature({}).pipelineVersion, PIPELINE_VERSION, '[١] ولا يدخل بصمة الجهاز (البصمة تحمل PIPELINE_VERSION وحده)');
  ok(!JSON.stringify(computeScanSignature({})).includes(EVALUATION_RULES_VERSION), '[١] الختم ليس في البصمة');
}
{ // المصدر الواحد: لا نصّ حرفي للحقل ولا للقيمة في كود الخادم خارج مصدرهما (التعليقات لا تُحتسب)
  const SRC = path.join(__dirname, '..', 'src');
  const listJs = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return (e.name === 'prompts' || e.name === 'lab') ? [] : listJs(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
  const isComment = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };
  const hits = (needle, exceptFile) => listJs(SRC).filter((f) => path.basename(f) !== exceptFile).flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/)
      .map((line, i) => ({line, i})).filter(({line}) => !isComment(line) && (line.includes(`'${needle}'`) || line.includes(`"${needle}"`) || line.includes(`\`${needle}\``)))
      .map(({i}) => `${path.relative(SRC, f)}:${i + 1}`));
  deq(hits(EVALUATION_RULES_VERSION_FIELD, 'evaluationRulesVersion.js'), [], '[١] اسم الحقل بنصّه الحرفي في evaluationRulesVersion.js وحده (القاعدة 24)');
  deq(hits(EVALUATION_RULES_VERSION, 'evaluationRulesVersion.js'), [], '[١] قيمة الختم بنصّها الحرفي في evaluationRulesVersion.js وحده');
  eq(hits(EVALUATION_RULES_VERSION, '__none__').length, 1, '[١] ضابط إيجابي: القيمة معرَّفة في موضع واحد بالضبط');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — buildReportDocument الحقيقية
// ═══════════════════════════════════════════════════════════════════════
const baseP = (over) => ({
  userId: 'u', rawDeviceModel: 'M', deviceMarketingName: 'M', fieldsVersion: 69, appVersion: '1.0.11', aiResponseToSave: {pipeline: V7_PIPELINE_TAG}, aiModel: 'm', aiDurationMs: 1,
  aiFallbackReason: null, aiResult: {grade: 'B', score: 80}, language: 'ar', shortId: 'NC-AAAAAA', isFreeTrial: false, pipeline: V7_PIPELINE_TAG, v5Metrics: null, analyzedAtMs: 1,
  serverSamplesStoragePath: null, serverSamplesSaved: false, ...over,
});
for (const pipeline of [V7_PIPELINE_TAG, V6_PIPELINE_TAG]) {
  const doc = buildReportDocument(baseP({pipeline}));
  eq(doc[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, `[٢] pipeline=${pipeline}: الختم في جذر المستند`);
  ok(!has(doc.aiResponse, EVALUATION_RULES_VERSION_FIELD), `[٢] pipeline=${pipeline}: ليس داخل aiResponse`);
  ok(!JSON.stringify(doc.aiResponse).includes(EVALUATION_RULES_VERSION), `[٢] pipeline=${pipeline}: ولا قيمته في aiResponse المخزَّن`);
}
{ // مفاتيح الجذر الأخرى بلا تغيير وبالترتيب نفسه: الختم مفتاح واحد يُدرَج بعد appVersion (قائمة ما قبل التغيير من عيّنة HEAD المُلتزَمة قبله)
  const BEFORE = ['userId', 'deviceFingerprint', 'deviceModel', 'deviceMarketingName', 'fieldsVersion', 'appVersion', 'aiResponse', 'aiModel', 'aiDurationMs', 'aiFallbackReason', 'language',
    'shortId', 'scoringEngine', 'isFreeTrial', 'pipeline', 'v5Metrics', 'analyzedAt', 'serverSamplesStoragePath', 'serverSamplesSaved', 'createdAt'];
  const keys = Object.keys(buildReportDocument(baseP({})));
  deq(keys.filter((k) => k !== EVALUATION_RULES_VERSION_FIELD), BEFORE, '[٢] مستند V7: ما سوى الختم هو قائمة المفاتيح السابقة نفسها بالترتيب نفسه');
  eq(keys.indexOf(EVALUATION_RULES_VERSION_FIELD), keys.indexOf('appVersion') + 1, '[٢] الختم يلي appVersion مباشرةً (مرآة الإصدارات)');
}
// مسار التقرير المخبَّأ في buildReportDocument: يحمل ختم الأصل إن كان نصّاً غير فارغ، وإلّا يغيب المفتاح (لا ختم هذا الإصدار، لا null، لا نصّ فارغ)
for (const [label, reused, want] of [
  ['ختم الأصل نصّ', 'rules-test-older', 'rules-test-older'], ['الأصل بلا ختم (null)', null, undefined], ['غير مُمرَّر', undefined, undefined], ['نصّ فارغ', '', undefined],
  ['ليس نصّاً (رقم)', 7, undefined], ['ليس نصّاً (كائن)', {x: 1}, undefined]]) {
  const doc = buildReportDocument(baseP({pipeline: CACHED_PIPELINE_TAG, reusedEvaluationRulesVersion: reused}));
  if (want === undefined) ok(!has(doc, EVALUATION_RULES_VERSION_FIELD), `[٢] مخبَّأ — ${label}: المفتاح غائب (لا قيمة افتراضية)`);
  else eq(doc[EVALUATION_RULES_VERSION_FIELD], want, `[٢] مخبَّأ — ${label}: يحمل ختم التقرير الأصل`);
  ok(doc[EVALUATION_RULES_VERSION_FIELD] !== EVALUATION_RULES_VERSION, `[٢] مخبَّأ — ${label}: ليس ختم هذا الإصدار`);
}
{ // reusedEvaluationRulesVersion لا أثر له خارج مسار المخبَّأ
  const doc = buildReportDocument(baseP({pipeline: V7_PIPELINE_TAG, reusedEvaluationRulesVersion: 'rules-test-older'}));
  eq(doc[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, '[٢] فحص جديد: ختم هذا الإصدار ولو مُرِّر ختم قديم (لا يُورَّث إلا في المخبَّأ)');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — العيّنات الذهبية: الفخّ يتبع العقد (القاعدة 39)
// ═══════════════════════════════════════════════════════════════════════
for (const f of ['v7-reports-document-sample.json', 'v7-reports-document-sample-cpu-c06-downgrade.json', 'v7-reports-document-sample-honor.json',
  'v7-reports-document-sample-security-downgrade.json', 'v7-reports-document-sample-zero-measured.json', 'v7-reports-document-sample-zero-measured-battery-harness-error.json']) {
  const doc = loadGolden(f);
  eq(doc[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, `[٣] ${f}: يحمل ختم هذا الإصدار`);
  ok(!JSON.stringify(doc.aiResponse).includes(EVALUATION_RULES_VERSION_FIELD), `[٣] ${f}: وaiResponse فيه بلا الحقل`);
}
{
  const v6 = loadGolden('v6-reports-document-sample.json');
  ok(!has(v6, EVALUATION_RULES_VERSION_FIELD), '[٣] عيّنة V6 المؤرَّخة (مستند كُتب قبل الختم): بلا الحقل — الغياب يُقرأ «كُتب قبل الختم» لا قيمة افتراضية');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — غير معروض: ليس في ردّ verifyReport ولا في aiResponse (مستند يحمله فعلاً)
// ═══════════════════════════════════════════════════════════════════════
{
  const {reportDocument} = buildReportsDocumentSample();
  eq(reportDocument[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, '[٤] (ضابط) المستند المُغذّي لـverifyReport يحمل الختم');
  const {response, reportDocument: fed} = buildVerifyReportResponseSample();
  eq(fed[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, '[٤] (ضابط) والمستند الذي بُني منه ردّ verifyReport يحمله');
  const text = JSON.stringify(response);
  ok(!text.includes(EVALUATION_RULES_VERSION_FIELD), '[٤] ردّ verifyReport لا يحمل اسم الحقل في أيّ موضع');
  ok(!text.includes(EVALUATION_RULES_VERSION), '[٤] ولا قيمة الختم');
  ok(!has(response, EVALUATION_RULES_VERSION_FIELD) && !has(response.aiResponse, EVALUATION_RULES_VERSION_FIELD), '[٤] لا في غلاف الردّ ولا في aiResponse فيه');
  ok(!JSON.stringify(reportDocument.aiResponse).includes(EVALUATION_RULES_VERSION_FIELD), '[٤] ولا في aiResponse المخزَّن/المُعاد إلى العميل');
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — مسار التقرير المخبَّأ عبر runAnalysisInternal الحقيقية (Firestore ذاكرة، لا نداء نموذج)
// ═══════════════════════════════════════════════════════════════════════
async function quiet(params) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await runAnalysisInternal(params);
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }
}

(async () => {
  const raw = loadGolden('b45c8cf6.ts.json');
  const fr = loadGolden('functionalResults-by-scanid.json').byScanId['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const fingerprintBase = {device: {model: 'SM-G977B', manufacturer: 'samsung'}, timeSeries: raw.timeSeries || raw, functionalResults: fr, manualResults: []};
  const sig = computeScanSignature(fingerprintBase);

  let caseNo = 0;
  for (const [label, sourceDoc, wantStamp] of [
    ['الأصل يحمل ختماً', {aiResponse: {pipeline: V7_PIPELINE_TAG, overall: {letter: 'B'}}, [EVALUATION_RULES_VERSION_FIELD]: 'rules-test-older'}, 'rules-test-older'],
    ['الأصل يحمل القيمة السابقة الحقيقية (قبل ق٢)', {aiResponse: {pipeline: V7_PIPELINE_TAG, overall: {letter: 'B'}}, [EVALUATION_RULES_VERSION_FIELD]: PREVIOUS_RULES_STAMP}, PREVIOUS_RULES_STAMP],
    ['الأصل «كُتب قبل الختم» (بلا الحقل)', {aiResponse: {pipeline: V7_PIPELINE_TAG, overall: {letter: 'B'}}}, null],
    ['الأصل بحقل نصّ فارغ', {aiResponse: {pipeline: V7_PIPELINE_TAG, overall: {letter: 'B'}}, [EVALUATION_RULES_VERSION_FIELD]: ''}, null],
    ['الأصل بحقل ليس نصّاً', {aiResponse: {pipeline: V7_PIPELINE_TAG, overall: {letter: 'B'}}, [EVALUATION_RULES_VERSION_FIELD]: 42}, null],
  ]) {
    caseNo++;
    const key = `profile-cached-${caseNo}`; // معرّف ملفّ جهاز بحروف لاتينية (normalizeDeviceProfileKey)
    memProfiles.set(key, {scanHistory: [{scanId: `old-scan-${caseNo}`, reportRef: `reports/old-scan-${caseNo}`, scanDate: new Date(), signature: sig}]});
    memReports.set(`reports/old-scan-${caseNo}`, sourceDoc);
    fetchCallCount = 0;
    const out = await quiet({fingerprint: {...fingerprintBase, device: {...fingerprintBase.device, deviceProfileKey: {a: key}}}, language: 'ar', deepseekKey: 'k', geminiKey: undefined, scanContext: {scanId: `cached-${caseNo}`}});
    eq(out.pipeline, CACHED_PIPELINE_TAG, `[٥] ${label}: المسار المخبَّأ فعلاً`);
    eq(fetchCallCount, 0, `[٥] ${label}: صفر نداء نموذج`);
    eq(out.reusedEvaluationRulesVersion, wantStamp, `[٥] ${label}: runAnalysisInternal تُعيد ختم الأصل (أو null)`);
    const doc = buildReportDocument(baseP({pipeline: out.pipeline, reusedEvaluationRulesVersion: out.reusedEvaluationRulesVersion, aiResult: out.aiResult, aiResponseToSave: out.aiResult}));
    if (wantStamp === null) ok(!has(doc, EVALUATION_RULES_VERSION_FIELD), `[٥] ${label}: المستند الجديد بلا الحقل — لا ختم هذا الإصدار على محتوى قواعد أخرى`);
    else eq(doc[EVALUATION_RULES_VERSION_FIELD], wantStamp, `[٥] ${label}: المستند الجديد يحمل ختم الأصل`);
  }
  { // فحص جديد (بلا ملفّ جهاز): لا مفتاح reused في النتيجة، والمستند يحمل ختم هذا الإصدار
    const {installDeepSeekStub} = require('./lib/v7ProviderStub');
    const calls = installDeepSeekStub();
    const out = await quiet({fingerprint: fingerprintBase, language: 'ar', deepseekKey: 'k', geminiKey: undefined, scanContext: {scanId: 'fresh-scan'}});
    ok(calls.length >= 1, '[٥] فحص جديد: النداء نحو المزوّد (مستبدَل fetch وحده)');
    ok(out.pipeline === V7_PIPELINE_TAG && out.reusedEvaluationRulesVersion === undefined, '[٥] فحص جديد: V7، ولا reusedEvaluationRulesVersion');
    const doc = buildReportDocument(baseP({pipeline: out.pipeline, reusedEvaluationRulesVersion: out.reusedEvaluationRulesVersion}));
    eq(doc[EVALUATION_RULES_VERSION_FIELD], EVALUATION_RULES_VERSION, '[٥] فحص جديد: المستند يحمل ختم هذا الإصدار');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ٦ — توصيل المعالج: analyzeDevice.js يأخذ reusedEvaluationRulesVersion من نتيجة runAnalysisInternal ويمرّره إلى buildReportDocument
  // ═══════════════════════════════════════════════════════════════════════
  // نصّيّ (نمط ownerActivityWindow.test.js [٨]) لأن التشغيل الفعلي لا يبلغه: كتابة التقرير المخبَّأ تُرفض اليوم قبل الاكتمال — analyzeDevice.js: grade/score=undefined على pipeline≠V7
  // وAdmin SDK يرفض undefined (قيد معروف، والمسار مطفأ افتراضياً: resolveCacheConfig.js DEFAULT_REUSE_ENABLED=false).
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'analyzeDevice.js'), 'utf8');
    ok(/const \{[^}]*\breusedEvaluationRulesVersion\b[^}]*\} = await runAnalysisInternal\(/.test(src), '[٦] analyzeDevice.js يفكّ reusedEvaluationRulesVersion من نتيجة runAnalysisInternal');
    ok(/reportDocument = buildReportDocument\(\{[^}]*\breusedEvaluationRulesVersion\b/.test(src), '[٦] ويمرّره إلى buildReportDocument عند بناء مستند التقرير');
  }

  console.log(`\nevaluationRulesVersion.test.js: ${n} assertions passed`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exit(1);
});
