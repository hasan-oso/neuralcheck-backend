'use strict';

// runAnalysisInternalV7Branch.test.js — P1.5 (تاريخي) ثم أمر التبديل
// 2026-09-23 +03 (بعد A125، القاعدة 23 — الاختبار الذي يُثبت فرعاً محلّياً
// محذوفاً يُستبدَل).
//
// كان هذا الملفّ يختبر فرع pipeline===V7_PIPELINE_TAG المحلّي القديم في
// runAnalysisInternal.js (applyV7Adjustments + buildDisplayShapeV7 يُعادان
// محلّياً هناك) — ذلك الفرع **حُذف بالكامل** مع التبديل (نصّ الأمر: "يُحذف
// الفرع المحلّي بما فيه التطبيق الثاني للتعديلات"). resolveV7Report تُطبِّق
// الاثنتين داخلياً بنفسها الآن (مرّة واحدة بالضبط)، وrunAnalysisInternal
// يكتب v7Result.display/.audit **كما هما، بلا أي معالجة ثانية**.
//
// هذا الاختبار الجديد يُثبت "بلا معالجة ثانية" مباشرة: يبني display/audit
// الحقيقيّين عبر نفس السلسلة الحقيقية (applyV7Adjustments ثم
// buildDisplayShapeV7 — تماماً كما تفعل resolveV7Report.js داخلياً)، يُعيدهما
// من كعب resolveV7Report، ثم يتحقّق أن out.aiResult/out.aiResultAudit
// **مطابقان حرفياً** لِما بناه الكعب — أي مسافة صفرية، لا إعادة اشتقاق.
//
// Run: node functions/test/runAnalysisInternalV7Branch.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── كعب utils/admin: لا Firestore ─────────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {applyV7Adjustments} = require('../src/analysis/buildV7Payload');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
const {FORBIDDEN_TOP_LEVEL_KEYS} = require('../src/analysis/reportShapeV7');

// نفس فِخّ S10 (b45c8cf6) — نفس evidenceRef المُثبَت (القرار ٤٢ البند ٢)
// المُستعمَل تاريخياً في هذا الملفّ.
const s10Raw = loadJson('b45c8cf6.ts.json');
const ts = s10Raw.timeSeries || s10Raw;
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fingerprint = {
  device: {model: 'SM-G977B', manufacturer: 'samsung'},
  timeSeries: {header: ts.header, footer: ts.footer, samples: ts.samples, variables: ts.variables},
  functionalResults: s10Functional,
  manualResults: [],
};

const stubAiAnalysis = {
  narrative: {
    summary: 'ملخّص V7 اختباري', details: 'تفصيل V7 اختباري',
    verdict: 'حكم V7 اختباري',
    buyerAdvice: {casual: 'نصيحة V7 عادية', gamer: 'نصيحة V7 ألعاب', photographer: 'نصيحة V7 تصوير'},
    // القاعدة 23 — DISC-T-01 ⇐ DISC-T-03 (أمر مستخدم 2026-09-27 +03
    // «الإعدادات لا تُنزل الحرف»): T-01/T-02 صارا healthBearing=false
    // (THERMAL_UNCALIBRATED_IDS، testKinds.js) فلم يعودا يُنتجان عنصراً في
    // categoryStates.issues (categoryStates.js:653) — DISC-T-01 صار معرّفاً
    // "مخترَعاً" لا يطابق أي issue حقيقي، فيفشل الدمج المُختبَر أدناه. T-03
    // خارج المجموعات الثلاث الجديدة (تبقى healthBearing=true)، فتُنتج
    // DISC-T-03 كما كانت — مُتحقَّق بتشغيل مباشر (display.issues تحمله).
    issueDescriptions: {'DISC-T-03': 'وصف اختباري للعطب T-03'},
  },
  crossChecks: [],
  adjustments: [{category: 'gpu', direction: 'DOWN', evidenceRefs: ['categoryStates.categories.security.deterministicLetter'], reason: 'اختبار DOWN'}],
  modelObservations: [],
};

// findings/categoryStates حقيقيّان (خارج الكعب، نفس ما يحسبه
// runAnalysisInternal.js قبل استدعاء resolveV7Report).
const findings = computeFindings(fingerprint);
const battery = sampleInputsFromRaw(fingerprint);
const categoryStates = computeCategoryStates({
  functionalResults: fingerprint.functionalResults, manualResults: fingerprint.manualResults,
  dev: null, findings, batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
});

// السلسلة الحقيقية — applyV7Adjustments ثم buildDisplayShapeV7، تماماً
// كما تُنفِّذها resolveV7Report.js داخلياً (guard.ok=true مفترَض هنا).
const categoryStatesAdjusted = applyV7Adjustments(categoryStates, stubAiAnalysis.adjustments, findings);
const {display: realDisplay, audit: realAudit} = buildDisplayShapeV7({
  categoryStates: categoryStatesAdjusted, findings, aiAnalysis: stubAiAnalysis, language: 'ar',
});
realDisplay.narrativeIncomplete = false;
realDisplay.narrativeIncompleteFields = [];
realAudit.regeneration = {attempts: 1, narrativeIncomplete: false, droppedFields: [], rounds: []};

// ─── كعب resolveV7Report — يُعيد النتيجة الحقيقية المبنيّة أعلاه حرفياً ──
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => ({
      display: realDisplay,
      audit: realAudit,
      aiModel: 'stub-v7',
      duration: 2,
      pipeline: 'v7_findings_based',
      bodyBuildMs: 1,
      guardFinal: {ok: true, shape: {ok: true, errors: []}, issueKeys: {ok: true}, numbers: {ok: true, unmatchedFields: []}, languageLeaks: []},
      rawResponseLog: [],
    }),
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

(async () => {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let out;
  try {
    out = await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
      scanContext: {scanId: 'v7-branch-test'},
    });
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }

  // ─── تمييز المسار ────────────────────────────────────────────────────
  eq(out.pipeline, 'v7_findings_based', 'المسار V7 (resolveV7Report) هو ما يُنفَّذ');
  eq(out.aiFailed, false, 'aiFailed=false');

  // ─── "بلا معالجة ثانية" — مطابقة حرفية لِما بناه الكعب، لا فقط تشابه ──
  eq(out.aiResult, realDisplay, 'out.aiResult === v7Result.display بالمرجع (writes as-is)');
  eq(out.aiResultAudit, realAudit, 'out.aiResultAudit === v7Result.audit بالمرجع (writes as-is)');

  // ─── القرار ٥ — كسر نظيف: صفر حقل V6 في aiResult ────────────────────
  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    ok(!(forbidden in out.aiResult), `[القرار ٥] out.aiResult لا يحمل الحقل الممنوع V6 "${forbidden}"`);
  }
  ok(!('category_scores' in out.aiResult) && !('categoryScores' in out.aiResult),
      '[القرار ٥] لا category_scores/categoryScores (V6) في aiResult عبر مسار V7');

  // ─── شكل العرض نفسه (نفس أرقام buildDisplayShapeV7.test.js على b45c8cf6) ─
  eq(out.aiResult.overall.letterSource, 'GATE:ROOT_DETECTED', 'letterSource وصل عبر الوصل الحقيقي');
  // القاعدة 23 — القيمة المرجعية 0.4503809523809524 ⇐ 0.4587142857142857
  // (نفس سبب استبدال DISC-T-01 أعلاه): SEC-01/05/06/07 وCM-08 وT-01/T-02
  // خرجت من declaredHb/executed معاً (computeHealthBearingStats)، فتغيّرت
  // مقامات التغطية على مستوى overall أيضاً. قيمة مقيسة بتشغيل مباشر
  // (buildDisplayShapeV7 على نفس المُدخل)، لا مكتوبة يدوياً.
  ok(Math.abs(out.aiResult.overall.coverage - 0.4587142857142857) < 0.001, 'coverage وصل عبر الوصل الحقيقي');
  const t03 = out.aiResult.issues.find((i) => i.id === 'DISC-T-03');
  ok(t03 && t03.description === 'وصف اختباري للعطب T-03', 'narrative.issueDescriptions وصل ودُمج في issues[]');

  // ─── applyV7Adjustments طُبِّقت مرّة واحدة بالضبط (داخل بناء الكعب، لا
  // داخل runAnalysisInternal — لم يعد يستورد applyV7Adjustments إطلاقاً) ──
  eq(out.aiResultAudit.adjustments.length, 1, '[القرار ٤] out.aiResultAudit.adjustments يحمل السجلّ');
  eq(out.aiResultAudit.adjustments[0].category, 'gpu', 'audit.adjustments[0].category=gpu');
  ok(!('adjustments' in out.aiResult.overall), '[القرار ٤] out.aiResult.overall (المعروض) لا يحمل adjustments — audit فقط');

  eq(categoryStatesAdjusted.issueSetHash, categoryStates.issueSetHash,
      'issueSetHash (المُعدَّل) يطابق الأصل — لا adjustment غيّر مجموعة الأعطال، فقط حرف gpu');

  console.log(`runAnalysisInternalV7Branch.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('runAnalysisInternalV7Branch.test.js FAILED:', e);
  process.exit(1);
});
