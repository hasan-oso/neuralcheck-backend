'use strict';

// neutralFallbackFlag.test.js — رؤية السقوط المحايد C/50 (fix/json-repair-
// shape-guard، V6).
//
// تحديث 2026-09-23 +03 (أمر التبديل، القاعدة 23 — الاختبار الذي يُثبت أن
// V6 هو المسار الحيّ يُستبدَل، لا يُضاف إليه): هذا الملفّ كان يختبر مجموعة
// أعطال V6-حصرية — النموذج يُصدر grade/score بصيغة غير صالحة فيسقط الحرف
// إلى "C" محايد صامت ("مستند يبدو شرعياً تماماً... لا شيء يميّزه عن جهاز
// متوسّط فعلاً" — التعليق الأصلي)، أو استجابة مبتورة (jsonrepair) فتغيب
// أعطال/درجات فئات/نصائح شراء بلا إنذار.
//
// **هذا الفشل غير ممكن بنيوياً على V7**: aiResult.overall.letter لا
// يُشتقّ من نصّ النموذج إطلاقاً — categoryStates.js يحسبه حتمياً من
// functionalResults/manualResults قبل أي نداء نموذج (راجع
// runAnalysisInternal.js، حساب categoryStates يسبق قسم "2. تحليل AI").
// فلا "grade غير صالح يسقط إلى C" ولا "نموذج يبتر جوابه فيختفي حرف فئة" —
// الحرف حاضر دائماً بصرف النظر عن جودة استجابة النموذج. ما تبقّى متغيّراً
// (السرد/التعديلات) يُصرَّح به صراحة عبر narrativeIncomplete/
// narrativeIncompleteFields — لا سقوط صامت شبيه بتقرير سليم.
//
// الاختبار أدناه يُثبت هذا مباشرة عبر runAnalysisInternal الحقيقي (كعب
// resolveV7Report وحده — القاعدة 37).
//
// Run: node functions/test/neutralFallbackFlag.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── كعب utils/admin: لا اتّصال بـ Firestore ─────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب resolveV7Report: يردّ ما نُمليه ───────────────────────────────
let cannedResult = null;
let cannedThrow = null;
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => {
      if (cannedThrow) throw cannedThrow;
      return cannedResult;
    },
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const fingerprint = {device: {model: 'SM-G977B', manufacturer: 'samsung'}};

async function run(result, throwErr) {
  cannedResult = result;
  cannedThrow = throwErr || null;
  const realError = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const out = await runAnalysisInternal({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g', scanContext: {},
    });
    return {out, lines};
  } finally {
    console.error = realError;
  }
}

(async () => {
  // ─── 1. الحالة الصحيحة: سرد كامل، narrativeIncomplete=false ─────────
  {
    const {out} = await run({
      display: {overall: {letter: 'B'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
      audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
      aiModel: 'deepseek-flash', duration: 1000, pipeline: 'v7_findings_based',
      bodyBuildMs: 4, guardFinal: {ok: true}, rawResponseLog: [],
    });
    eq(out.aiResult.overall.letter, 'B', 'الحرف الحتمي يصل كما هو');
    eq(out.aiResult.narrativeIncomplete, false, 'سرد كامل — لا نقص');
    eq(out.aiFailed, false);
  }

  // ─── 2. رفض الحارس مرّتين → narrativeIncomplete=true بأسباب مُسمّاة،
  // **والحرف الحتمي يبقى حاضراً** — هذا بالضبط ما كان يستحيل رؤيته على
  // V6 (السقوط كان يبدو تقريراً سليماً). هنا الشيء المتبقّي غير مقيس (لا
  // AI) مصرَّح به، لا مخفياً خلف حرف مُختلَق. ───────────────────────────
  {
    const {out} = await run({
      display: {
        overall: {letter: 'D'}, // الحرف حتمي — لا علاقة له بحالة السرد
        narrativeIncomplete: true,
        narrativeIncompleteFields: ['narrative.summary', 'narrative.details', 'narrative.verdict'],
      },
      audit: {
        gatesApplied: [],
        adjustments: [],
        regeneration: {
          attempts: 2,
          narrativeIncomplete: true,
          droppedFields: ['narrative.summary', 'narrative.details', 'narrative.verdict'],
          rounds: [
            {attempt: 1, guardOk: false, rejectedReasons: ['numbers.unmatchedFields: 71.5']},
            {attempt: 2, guardOk: false, rejectedReasons: ['languageLeaks: vsync']},
          ],
        },
      },
      aiModel: 'deepseek-flash', duration: 2000, pipeline: 'v7_findings_based',
      bodyBuildMs: 4, guardFinal: {ok: false}, rawResponseLog: [],
    });
    eq(out.aiResult.overall.letter, 'D',
        'الحرف الحتمي حاضر رغم رفض الحارس مرّتين — لا سقوط صامت شبيه بتقرير سليم (خلاف V6)');
    eq(out.aiResult.narrativeIncomplete, true, 'النقص صريح، لا مخفيّ');
    assert.deepStrictEqual(out.aiResult.narrativeIncompleteFields,
        ['narrative.summary', 'narrative.details', 'narrative.verdict'],
        'الحقول الناقصة مُسمّاة بالضبط — لا "غير مكتمل" مبهمة');
    eq(out.aiResultAudit.regeneration.attempts, 2, 'عدد المحاولات مُسجَّل في audit');
    eq(out.aiFailed, false,
        'aiFailed=false — عرض حتمي جزئي متاح، ليس فشلاً صلباً (القرار ٢١)');
  }

  // ─── 3. فشل صلب (resolveV7Report ترمي) → aiFailed=true، لا تقرير مُختلَق ─
  {
    const {out, lines} = await run(null, new Error('DeepSeek HTTP 500 (both providers failed)'));
    eq(out.aiFailed, true, 'فشل صلب حقيقي — لا حرف مُختلَق، لا تقرير');
    eq(out.aiResult, null, 'aiResult=null — analyzeDevice.js يرفض الطلب، لا يحفظ تقريراً فارغاً');
    ok(lines.some((l) => l.includes('AI analysis failed')), 'الفشل يُسجَّل صراحة');
  }

  console.log(`neutralFallbackFlag: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
