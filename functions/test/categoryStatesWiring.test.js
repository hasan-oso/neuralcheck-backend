'use strict';

// categoryStatesWiring.test.js — P1.4 (PLAN-01-ROADMAP.md §١٤/١٥، البند ١
// "الوصل"). categoryStates.test.js يختبر computeCategoryStates كوحدة
// قائمة بذاتها؛ هذا الملف يختبر أنها **مُوصَلة فعلياً** في
// runAnalysisInternal.js — أي أن فحصاً حقيقياً يمرّ عبر نقطة الدخول
// الحقيقية للتحليل (لا استدعاء المحرّك المباشر) ينتج categoryStates على
// المستوى الأعلى من النتيجة، بنفس القيم التي ينتجها الاستدعاء المباشر.
//
// callAI مكعوبة (بنفس نمط neutralFallbackFlag.test.js وcacheReuseFlag.
// test.js — كعب require.cache، لا Sinon) كي لا يمسّ هذا الاختبار أي شبكة
// أو مفتاح API حقيقي؛ هذا تحديداً هو "الوصل" الذي يُختبَر — لا صحّة
// categoryStates.js نفسها (تلك مُختبَرة ذهبياً في categoryStates.test.js).
//
// Run: node functions/test/categoryStatesWiring.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── كعب utils/admin: لا اتّصال بـ Firestore (نفس نمط neutralFallbackFlag) ─
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب resolveV7Report — تحديث 2026-09-23 +03 (أمر التبديل، القاعدة
// 23): callAI (V6) لم تعد تُستدعى؛ resolveV7Report هي المسار الحيّ. النتيجة
// القانونية للوصل هنا تبقى categoryStates لا aiResult (راجع رأس الملف). ──
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => ({
      display: {overall: {letter: 'B'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
      audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
      aiModel: 'stub',
      duration: 1,
      pipeline: 'v7_findings_based',
      bodyBuildMs: 1,
      guardFinal: {ok: true},
      rawResponseLog: [],
    }),
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

(async () => {
  // بصمة حقيقية كاملة — نفس شكل ما يُرسله التطبيق فعلياً (raw fingerprint
  // بعيّناته كاملة، لا مستنداً مخزوناً مُخفَّفاً): timeSeries.{header,
  // footer, samples, variables} + functionalResults على مستوى الجذر.
  const s10Raw = loadJson('b45c8cf6.ts.json');
  const ts = s10Raw.timeSeries || s10Raw;
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  ok(Array.isArray(s10Functional) && s10Functional.length === 85, 'S10: 85 عنصر functionalResults حقيقي (فِخّ مشترك مع categoryStates.test.js)');

  const fingerprint = {
    device: {model: 'SM-G977B', manufacturer: 'samsung'},
    timeSeries: {header: ts.header, footer: ts.footer, samples: ts.samples, variables: ts.variables},
    functionalResults: s10Functional,
    manualResults: [],
  };

  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let out;
  try {
    out = await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
      scanContext: {scanId: 'wiring-test'},
    });
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }

  ok(out.categoryStates !== null && out.categoryStates !== undefined,
      'runAnalysisInternal: categoryStates حاضر على مستوى النتيجة (الوصل — لا يضيع الحساب صامتاً)');
  eq(Object.keys(out.categoryStates.categories).length, 15,
      'runAnalysisInternal→categoryStates: كل الفئات الـ15 حاضرة');

  // مطابقة مباشرة: نفس المُدخلات، عبر الاستدعاء المباشر لـcomputeCategoryStates
  // (لا الوصل)، يجب أن تُنتج **نفس القيم بالضبط** — الوصل لا يُعيد صياغة
  // شيء، هو تمرير مباشر لنفس مُدخلات findings.js/sampleInputsFromRaw.
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(fingerprint);
  const direct = computeCategoryStates({
    functionalResults: fingerprint.functionalResults,
    manualResults: fingerprint.manualResults,
    dev: null,
    findings,
    batterySampleInputs: battery.sampleInputs,
    batteryDesignCapacityMah: battery.design,
  });

  eq(out.categoryStates.overall.letter, direct.overall.letter,
      'الوصل ينتج نفس overall.letter الذي ينتجه الاستدعاء المباشر (C متوقَّع، جهاز مجذَّر)');
  eq(out.categoryStates.overall.coverage, direct.overall.coverage,
      'الوصل ينتج نفس overall.coverage (45% بالتعريف الجديد، القرار ١٠)');
  ok(Math.abs(out.categoryStates.overall.coverage - 0.45) < 0.01,
      `overall.coverage ≈ 45% عبر الوصل الحقيقي (فعلياً ${(out.categoryStates.overall.coverage * 100).toFixed(1)}%)`);
  eq(out.categoryStates.categories.security.deterministicLetter, 'D',
      'الوصل: security=D (SEC-04=fail) يصل من نقطة الدخول الحقيقية لا فقط الاستدعاء المباشر');
  eq(out.categoryStates.issueSetHash, direct.issueSetHash, 'issueSetHash مطابق بين الوصل والاستدعاء المباشر');
  eq(out.categoryStates.lettersHash, direct.lettersHash, 'lettersHash مطابق بين الوصل والاستدعاء المباشر');
  eq(out.categoryStates.numbersHash, direct.numbersHash, 'numbersHash مطابق بين الوصل والاستدعاء المباشر');

  // aiResult (V7 الحيّ، عبر الكعب — تحديث 2026-09-23 +03 أمر التبديل):
  // يُكتب كما أعادته resolveV7Report، بلا grade/score (لا وجود لهما في V7).
  eq(out.aiResult.overall.letter, 'B', 'aiResult.overall.letter يبقى من display (الكعب) — يُكتب كما هو');
  ok(!Object.prototype.hasOwnProperty.call(out.aiResult, 'grade'),
      'aiResult V7 لا يحمل grade إطلاقاً (القرار ٥: صفر grade/score في V7)');

  console.log(`categoryStatesWiring.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('categoryStatesWiring.test.js FAILED:', e);
  process.exit(1);
});
