'use strict';

// pipelineField.test.js — حقل pipeline يصل المستند بقيمته الصحيحة
// (chore/remove-v3-precompute؛ تحديث 2026-09-23 +03، أمر التبديل).
//
// الحقل يميّز التقارير، ويُستعمل في تصنيفها وفي أي تحليل لاحق.
//
// تحديث 2026-09-23 +03 (أمر التبديل بعد A125، القاعدة 23 — الاختبار الذي
// يُثبت أن V6 هو المسار الحيّ يُستبدَل): resolveV7Report هي المصدر الوحيد
// الآن — pipeline يصل من v7Result.pipeline مباشرة، لا من اشتقاق
// isV6NestedShape/isV7NestedShape (isV7NestedShape حُذفت كلياً — كانت
// تتعرّف على شكل callAIv7 المباشر، لا شكل resolveV7Report). الأقسام ١+٢+٥
// حُدِّثت لتعكس هذا؛ القسم ٣ (غياب v3_legacy/v5_precomputed/usePrecomputed)
// بلا تغيير — لا علاقة له بالتبديل. القسم ٤ (كان يثبت وجود isV7NestedShape)
// استُبدل بإثبات غيابها.
//
// هذا الاختبار يثبّت القيمة الحرفية على المسار الحقيقي، لا على القراءة.
//
// Run: node functions/test/pipelineField.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin: لا Firestore ───────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => {
      throw new Error('Firestore must not be touched by this test');
    }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب resolveV7Report: يردّ pipeline كما نُمليه ────────────────────
let cannedPipeline = 'v7_findings_based';
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => ({
      display: {overall: {letter: 'A'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
      audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
      aiModel: 'deepseek-flash',
      duration: 1000,
      pipeline: cannedPipeline,
      bodyBuildMs: 2,
      guardFinal: {ok: true},
      rawResponseLog: [],
    }),
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const fingerprint = {device: {model: 'SM-G977B', manufacturer: 'samsung'}};

/** @return {Promise<Object>} النتيجة */
async function run() {
  const realLog = console.log;
  console.log = () => {};
  try {
    return await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
      scanContext: {},
    });
  } finally {
    console.log = realLog;
  }
}

(async () => {
  // ─── 1. القيمة الحرفية على المسار الحقيقي ──────────────────────────
  {
    const out = await run();
    assert.strictEqual(out.pipeline, 'v7_findings_based',
        'runAnalysisInternal must return the literal pipeline label from resolveV7Report');
    assert.notStrictEqual(out.pipeline, undefined,
        'the field must never be undefined — it would vanish from the doc');
  }

  // ─── 2. لا اشتقاق من راية محذوفة (usePrecomputed) ──────────────────
  {
    const realLog = console.log;
    console.log = () => {};
    let out;
    try {
      out = await runAnalysisInternal({
        fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
        scanContext: {}, usePrecomputed: false,
      });
    } finally {
      console.log = realLog;
    }
    assert.strictEqual(out.pipeline, 'v7_findings_based',
        'a stale usePrecomputed:false must NOT change the label — it is not read anywhere on this path');
  }

  // ─── 3. المصدر: لا تسمية محذوفة باقية في الكود ─────────────────────
  {
    const src = (f) => fs.readFileSync(
        path.join(__dirname, '..', 'src', 'analysis', f), 'utf8');

    for (const f of ['runAnalysisInternal.js', 'analyzeDevice.js',
      'callAI.js']) {
      const s = src(f).split('\n')
          .filter((l) => !l.trim().startsWith('//'))
          .join('\n');
      assert.ok(!/["']v3_legacy["']/.test(s),
          `${f} must not still emit the v3_legacy label`);
      assert.ok(!/["']v5_precomputed["']/.test(s),
          `${f} must not still emit the v5_precomputed label`);
      assert.ok(!/\busePrecomputed\b/.test(s),
          `${f} must not still branch on the removed flag`);
    }

    const {V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
    assert.strictEqual(V6_PIPELINE_TAG, 'v6_raw_timeseries',
        '[إعداد] pipelineTags.V6_PIPELINE_TAG لم يتغيّر منذ كتابة هذا الاختبار');
    assert.ok(/require\(["']\.\/pipelineTags["']\)/.test(src('analyzeDevice.js')),
        'analyzeDevice.js must import the shared pipeline-tag constants from pipelineTags.js — not redeclare the label');
    assert.ok(/pipeline: p\.pipeline \|\| V6_PIPELINE_TAG/
        .test(src('analyzeDevice.js')),
    'analyzeDevice (buildReportDocument, extracted 2026-09-24) must fall back to the shared V6_PIPELINE_TAG constant, not a re-typed literal');
  }

  // ─── 4. isV7NestedShape حُذفت (أمر التبديل 2026-09-23 +03) ──────────
  //
  // كانت تتعرّف على شكل callAIv7 المباشر المتداخل ({aiAnalysis, guard})
  // — غير موجود بعد اليوم، لأن resolveV7Report (شكلها {display, audit,
  // guardFinal}، بلا .aiAnalysis إطلاقاً) هي المصدر الوحيد. إبقاؤها كان
  // سيُوهم بمسار قراءة ثانٍ لا وجود له فعلياً (القاعدة 24: مصدر واحد).
  // isV6NestedShape تبقى (V6 غير محذوف، فقط غير مُستدعى — راجع رأس
  // runAnalysisInternal.js "2. تحليل AI").
  {
    const s = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'analysis',
            'runAnalysisInternal.js'), 'utf8');
    const liveCode = s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    assert.ok(!/\bisV7NestedShape\b/.test(liveCode),
        'isV7NestedShape must be fully removed — resolveV7Report is written as-is, no local re-detection');
    assert.ok(/const isV6NestedShape/.test(liveCode),
        'isV6NestedShape must still exist — V6 code is not deleted (dead but present)');
    assert.ok(/await resolveV7Report\(/.test(liveCode),
        'runAnalysisInternal must call resolveV7Report directly as the primary path');
    assert.ok(/aiResult: v7Result\.display/.test(liveCode),
        'aiResult must be written as v7Result.display verbatim — no local re-shaping');
  }

  // ─── 5. pipeline يُكتب كما أعادته resolveV7Report حرفياً — لا قيمة
  // ثابتة مكتوبة يدوياً هنا (مثال: مسار PROVIDER_FAILED_NO_FALLBACK يبقي
  // pipeline=v7_findings_based أيضاً، من داخل resolveV7Report نفسها). ────
  {
    cannedPipeline = 'v7_findings_based';
    const out = await run();
    assert.strictEqual(out.pipeline, cannedPipeline,
        'pipeline يطابق ما أعادته resolveV7Report بالضبط، حرفاً بحرف');
  }

  console.log('pipelineField: 5/5 tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
