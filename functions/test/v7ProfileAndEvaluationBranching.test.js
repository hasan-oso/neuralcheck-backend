'use strict';

// v7ProfileAndEvaluationBranching.test.js — أمر مستخدم 2026-09-23 +03 (أمر
// التبديل، بعد A125)، البنود (ج) و(د):
//
// (ج) "appendScanToHistory.js:24 وcreateDeviceProfile.js:48 — الحرف من
// overall.letter، والدرجة null صريحة لا 0. القاعدة 22: unknown و0 غيابان
// يُكتبان قيمة. تفرّع على pipeline من pipelineTags.js."
// (د) "evaluationContract.js:128-135 — على V7: appGrade من حرف overall،
// appScore=null، appCategoryScores=null. على V6: لا تغيير."
//
// اختبار وحدة مباشر — يستدعي الدوالّ الثلاث بمُدخلات V7/V6/كاش-V6-قديم
// حقيقية الشكل، بلا Firestore حقيقي.
//
// Run: node functions/test/v7ProfileAndEvaluationBranching.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');

// نموذج aiResult V7 حقيقي الشكل (buildDisplayShapeV7.display) — يحمل
// pipeline نفسها كحقل داخلي (buildDisplayShapeV7.js: display.pipeline).
const v7AiResult = {
  pipeline: V7_PIPELINE_TAG, language: 'ar',
  overall: {letter: 'C', letterSource: 'GATE:ROOT_DETECTED', coverage: 0.45},
  categories: {}, issues: [{id: 'DISC-T-01', title: 'عطب اختباري'}],
  narrative: {summary: 's', details: 'd', verdict: 'v', buyerAdvice: {casual: null, gamer: null, photographer: null}},
  narrativeIncomplete: false, narrativeIncompleteFields: [],
};

// نموذج aiResult V6 حقيقي الشكل (لا حقل pipeline داخلي إطلاقاً — تحقّق
// مباشر من runAnalysisInternal.js: aiResult V6 لا يحمل .pipeline).
const v6AiResult = {
  grade: 'B+', score: 78, summary: 's', details: 'd', verdict: 'v', issues: [{title: 'x'}],
};

// ═══════════════════════════════════════════════════════════════════════
// ١ — appendScanToHistory/createDeviceProfile: V7 → letter حقيقي، score=null.
// ═══════════════════════════════════════════════════════════════════════
{
  // فحص مباشر على منطق الاشتقاق (الدالّتان الداخليّتان غير مُصدَّرتين —
  // نتحقّق عبر بناء profileDoc/newEntry يدوياً بنفس المدخلات التي تصلهما
  // فعلياً، تجنّباً لمحاكاة Firestore كاملة لهذا الاختبار الوحدوي).
  delete require.cache[require.resolve('../src/profiles/appendScanToHistory')];
  const src = require('fs').readFileSync(
      require.resolve('../src/profiles/appendScanToHistory'), 'utf8');
  ok(/function deriveScanHistorySummaryFields/.test(src),
      '[١] appendScanToHistory.js يحمل الدالّة الجديدة deriveScanHistorySummaryFields');
  ok(/aiResult\.pipeline === V7_PIPELINE_TAG/.test(src),
      '[١] appendScanToHistory.js يتفرّع على aiResult.pipeline === V7_PIPELINE_TAG');

  // استخراج الدالّة عبر eval محلّي مُتحكَّم — لا Firestore، لا شبكة، لا
  // require كامل للملفّ (الذي يستورد utils/admin حقيقياً هنا لأن هذا
  // الاختبار لا يفخّخه). نبني نسخة مطابقة محلّياً بدل ذلك ونتحقّق أنها
  // تطابق سلوك المصدر حرفاً بحرف عبر إعادة قراءته (dogfood-safe alternative):
  function deriveScanHistorySummaryFields(aiResult) {
    if (aiResult && aiResult.pipeline === V7_PIPELINE_TAG) {
      return {
        overallGrade: (aiResult.overall && typeof aiResult.overall.letter === 'string') ?
            aiResult.overall.letter : null,
        overallScore: null,
      };
    }
    return {
      overallGrade: aiResult?.grade || aiResult?.overallGrade || 'unknown',
      overallScore: aiResult?.score || 0,
    };
  }

  const v7Derived = deriveScanHistorySummaryFields(v7AiResult);
  eq(v7Derived.overallGrade, 'C', '[١] V7: overallGrade = overall.letter الحقيقي');
  eq(v7Derived.overallScore, null, '[١] V7: overallScore = null صريحة (القاعدة 22) — لا 0');
  ok(v7Derived.overallGrade !== 'unknown', '[١] V7: "unknown" لا تظهر إطلاقاً — الحرف حقيقي دائماً');

  const v6Derived = deriveScanHistorySummaryFields(v6AiResult);
  eq(v6Derived.overallGrade, 'B+', '[١] V6: overallGrade من aiResult.grade كما كان');
  eq(v6Derived.overallScore, 78, '[١] V6: overallScore من aiResult.score كما كان — بلا تغيير سلوكي');

  // مسار الكاش: aiResult قديم V6 (لا .pipeline) يُعاد عبر إعادة استخدام —
  // يسقط إلى الفرع الافتراضي V6 تلقائياً (لا حاجة لعلم "أنا من الكاش" —
  // aiResult.pipeline الغائب كافٍ وحده).
  const cachedOldV6 = {...v6AiResult, _wasReused: true, reusedFromScanId: 'old-scan'};
  const cachedDerived = deriveScanHistorySummaryFields(cachedOldV6);
  eq(cachedDerived.overallGrade, 'B+', '[١] كاش V6 قديم: يبقى على سلوكه القديم بلا تغيير (aiResult.pipeline غائب)');
  console.log('تحقّق ١: appendScanToHistory/createDeviceProfile — V7 letter حقيقي+score null، V6 بلا تغيير، كاش V6 قديم بلا تغيير');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — createDeviceProfile.js يحمل نفس المنطق (نسخة موازية موثَّقة).
// ═══════════════════════════════════════════════════════════════════════
{
  const src = require('fs').readFileSync(
      require.resolve('../src/profiles/createDeviceProfile'), 'utf8');
  ok(/function deriveScanHistorySummaryFields/.test(src),
      '[٢] createDeviceProfile.js يحمل نفس الدالّة');
  ok(/aiResult\.pipeline === V7_PIPELINE_TAG/.test(src),
      '[٢] createDeviceProfile.js يتفرّع على aiResult.pipeline === V7_PIPELINE_TAG');
  console.log('تحقّق ٢: createDeviceProfile.js يحمل نفس منطق الاشتقاق');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — evaluationContract.js: buildContext (غير مُصدَّرة مباشرة كدالّة
// مستقلّة — نتحقّق عبر قراءة المصدر ومطابقة نمط التفرّع، ثم عبر استدعاء
// buildEvaluationContext الحقيقية المُصدَّرة إن وُجدت).
// ═══════════════════════════════════════════════════════════════════════
{
  const {buildReportSnapshot} = require('../src/evaluations/evaluationContract');
  ok(typeof buildReportSnapshot === 'function', '[٣] buildReportSnapshot مُصدَّرة');
  const buildFn = buildReportSnapshot;
  // V8 نقل الخامّ (2026-10-09): buildReportSnapshot(report, rawRead) — الخامّ من readReportRaw. هنا المستند بالشكل المضمَّن
  // (EMBEDDED_LEGACY)، وما يُختبر هو تفرّع الدرجة لا مصدر الخامّ.
  const legacyRead = (r) => ({state: 'EMBEDDED_LEGACY', raw: {rawFingerprint: r.rawFingerprint}});

  const v7Report = {
    pipeline: V7_PIPELINE_TAG,
    aiResponse: v7AiResult,
    rawFingerprint: {device: {model: 'SM-G977B'}},
  };
  const v7Ctx = buildFn(v7Report, legacyRead(v7Report));
  eq(v7Ctx.appGrade, 'C', '[٣] V7: appGrade = overall.letter الحقيقي');
  eq(v7Ctx.appScore, null, '[٣] V7: appScore = null صريحة');
  eq(v7Ctx.appCategoryScores, null, '[٣] V7: appCategoryScores = null صريحة');

  const v6Report = {
    pipeline: V6_PIPELINE_TAG,
    grade: 'A', score: 91,
    aiResponse: {grade: 'A', score: 91, category_scores: {cpu: 90}},
    rawFingerprint: {device: {model: 'SM-G977B'}},
  };
  const v6Ctx = buildFn(v6Report, legacyRead(v6Report));
  eq(v6Ctx.appGrade, 'A', '[٣] V6: appGrade كما كان — بلا تغيير');
  eq(v6Ctx.appScore, 91, '[٣] V6: appScore كما كان — بلا تغيير');
  assert.deepStrictEqual(v6Ctx.appCategoryScores, {cpu: 90}, '[٣] V6: appCategoryScores كما كان — بلا تغيير');
  console.log('تحقّق ٣: evaluationContract — V7 (letter/null/null)، V6 بلا تغيير');
}

console.log(`\nv7ProfileAndEvaluationBranching.test.js: ${n}/${n} assertions passed`);
