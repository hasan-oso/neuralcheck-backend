'use strict';

// resolveV7Report.test.js — القرار ٢١ (PLAN-01-ROADMAP.md §🔒 "٢١ · تقرير
// رفضه الحارس — لا يُرفض كلّه أبداً"). يختبر src/analysis/resolveV7Report.js
// بكعوب كاملة لـcallDeepSeek/callGeminiFallback/utils/admin — **صفر نداء
// نموذج حقيقي، صفر إنفاق** (نفس قيد callAIv7.test.js — "إعادة التوليد نداء
// نموذج، ولا تُنفّذه الآن. ابنِ المسار واختبره بمحاكاة كاملة").
//
// غير مُختبَر بنداء حيّ — لا دليل هنا على سلوك النموذج الحقيقي عند تلقّي
// priorRejection، فقط أن الحمولة تحمله وأن سياسة القبول/الرفض صحيحة على
// مخرَجات مُحاكاة.
//
// Run: node functions/test/resolveV7Report.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── كعب utils/admin: لا Firestore حقيقي ───────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب callDeepSeek/callGemini — سلوك قابل للتغيير بين النداءات ──────
let deepseekCalls = [];
let deepseekBehavior = null; // (userMessage, systemPrompt) => Promise<report> | throws — يُضبَط لكل حالة
const deepseekPath = require.resolve('../src/analysis/callDeepSeek');
require.cache[deepseekPath] = {
  id: deepseekPath, filename: deepseekPath, loaded: true,
  exports: {
    callDeepSeek: (userMessage, systemPrompt, ...rest) => {
      deepseekCalls.push({userMessage, systemPrompt});
      return deepseekBehavior(userMessage, systemPrompt, ...rest);
    },
    DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_TIMEOUT_MS: 130000,
  },
};

let geminiCalls = [];
let geminiBehavior = async () => { throw new Error('gemini not expected in this test'); };
const geminiPath = require.resolve('../src/analysis/callGemini');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    callGeminiFallback: (...args) => { geminiCalls.push(args); return geminiBehavior(...args); },
    GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_TIMEOUT_MS: 55000,
  },
};

// ─── كعب utils/resolveGeminiFallbackConfig — أمر مستخدم 2026-09-23 +03،
// القرار ٢: Gemini خلف راية مُعطَّلة افتراضياً. هذا الملفّ اختبر أصلاً
// "فشل صلب لكلا المزوّدَين" (سيناريو ٥/٦) على افتراض قديم أن Gemini
// يُستدعى دائماً — لم يعد صحيحاً بعد هذا القرار. القيمة الافتراضية هنا
// false (مطابقة للإنتاج)؛ سيناريو ٥/٦ يُفعِّلانها صراحةً كي يبقيا يختبران
// "كلا المزوّدَين فشلا حقاً" لا "Gemini مُعطَّل" (مسألة مختلفة، لها اختبارها
// المخصّص المستقلّ test/geminiFallbackFlag.test.js). القاعدة 23: هذا
// تحديث للافتراض القديم الخاطئ ضمنياً، لا إضافة اختبار مواز.
let geminiFallbackEnabledForTest = false;
const geminiConfigPath = require.resolve('../src/utils/resolveGeminiFallbackConfig');
require.cache[geminiConfigPath] = {
  id: geminiConfigPath, filename: geminiConfigPath, loaded: true,
  exports: {
    resolveGeminiFallbackConfig: async () => ({enabled: geminiFallbackEnabledForTest, source: 'test-stub'}),
    clearGeminiFallbackConfigCache: () => {},
    DEFAULT_GEMINI_FALLBACK_ENABLED: false,
  },
};

// require بعد كل الكعوب أعلاه.
const {resolveV7Report, _internal} = require('../src/analysis/resolveV7Report');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {BUYER_ADVICE_PROFILES} = require('../src/analysis/reportShapeV7');

const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const s10Fingerprint = {timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const s10Findings = computeFindings(s10Fingerprint);
const s10Battery = sampleInputsFromRaw(s10Fingerprint);
const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Battery.sampleInputs, batteryDesignCapacityMah: s10Battery.design,
});
const realIssueId = s10CategoryStates.issues[0].id;

// نفس الثابت المحلّي في resolveV7Report.js (NARRATIVE_LEAF_FIELDS) — غير
// مُصدَّر عمداً (تفصيل تنفيذ داخلي)، فيُكتب هنا حرفياً للمقارنة المباشرة.
// القرار ٢٤ (buyerAdvice ثلاثة حقول): سبعة مسارات ورقة لا خمسة —
// narrative.buyerAdvice انقسم إلى ثلاثة مسارات فرعية (BUYER_ADVICE_PROFILES).
const NARRATIVE_LEAF_FIELDS_FOR_TEST = [
  'narrative.summary', 'narrative.details', 'narrative.verdict',
  ...BUYER_ADVICE_PROFILES.map((p) => `narrative.buyerAdvice.${p}`),
  'narrative.issueDescriptions',
];

function cleanResponse() {
  return {
    narrative: {
      summary: 'ملخّص سليم', details: 'تفاصيل سليمة',
      verdict: 'حكم سليم',
      buyerAdvice: {casual: 'نصيحة سليمة عادية', gamer: 'نصيحة سليمة ألعاب', photographer: 'نصيحة سليمة تصوير'},
      issueDescriptions: {[realIssueId]: 'وصف سليم لعطب حقيقي'},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
}

function params(extra) {
  return Object.assign({
    findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
    scanContext: {scanId: 'test-resolve-v7'}, previousScan: null,
    deepseekApiKey: 'k', geminiApiKey: 'g',
  }, extra || null);
}

async function run(p) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await resolveV7Report(p);
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // 1. المسار السعيد — الحارس يقبل من أول محاولة، لا إعادة توليد
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    deepseekBehavior = async () => cleanResponse();

    const out = await run(params());

    eq(deepseekCalls.length, 1, 'محاولة واحدة فقط — الحارس قَبِل من أول مرّة');
    eq(out.audit.regeneration.attempts, 1, 'audit.regeneration.attempts = 1');
    eq(out.audit.regeneration.narrativeIncomplete, false, 'narrativeIncomplete = false على المسار السعيد');
    deepEq(out.audit.regeneration.droppedFields, [], 'droppedFields فارغة');
    eq(out.audit.regeneration.rounds.length, 1, 'جولة واحدة مُسجَّلة');
    eq(out.audit.regeneration.rounds[0].guardOk, true, 'الجولة الوحيدة guardOk=true');
    eq(out.audit.regeneration.rounds[0].tokensUsed, null,
        'tokensUsed=null صراحةً — غير متاح من callDeepSeek/callGemini اليوم (راجع تعليق رأس resolveV7Report.js)');
    ok(typeof out.audit.regeneration.rounds[0].durationMs === 'number', 'durationMs رقم حقيقي (مُقاس حتى في نداء مُحاكى)');

    eq(out.display.narrativeIncomplete, false, 'display.narrativeIncomplete = false');
    deepEq(out.display.narrativeIncompleteFields, [], 'display.narrativeIncompleteFields فارغة');
    eq(out.display.narrative.summary, 'ملخّص سليم', 'السرد كاملاً في display');
    ok(out.display.overall.letter !== undefined, 'الجزء الحتمي (overall.letter) حاضر كما هو دائماً');
  }
  console.log('تحقّق 1: المسار السعيد — لا إعادة توليد، narrativeIncomplete=false');

  // ═══════════════════════════════════════════════════════════════════
  // 2. رفض في المحاولة الأولى (رقم مُختلَق في summary)، نجاح في الثانية —
  //    تعافٍ كامل: narrativeIncomplete=false، وpriorRejection وصل النموذج
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    let callCount = 0;
    deepseekBehavior = async () => {
      callCount++;
      if (callCount === 1) {
        const bad = cleanResponse();
        bad.narrative.summary = 'رقم مُختلَق بلا مصدر 8675309 في الملخّص';
        return bad;
      }
      return cleanResponse();
    };

    const out = await run(params());

    eq(deepseekCalls.length, 2, 'محاولتان — الأولى رُفضت فأُعيد التوليد مرّة واحدة');
    eq(out.audit.regeneration.attempts, 2, 'attempts = 2');
    eq(out.audit.regeneration.rounds[0].guardOk, false, 'الجولة ١ رُفضت');
    ok(out.audit.regeneration.rounds[0].rejectedReasons.some((r) => r.startsWith('NUMBERS:narrative.summary')),
        'سبب الرفض مُسجَّل: رقم narrative.summary غير مطابق');
    eq(out.audit.regeneration.rounds[1].guardOk, true, 'الجولة ٢ (بعد إعادة التوليد) قُبِلت');
    eq(out.audit.regeneration.narrativeIncomplete, false, 'تعافٍ كامل بعد إعادة التوليد → narrativeIncomplete=false');
    deepEq(out.audit.regeneration.droppedFields, [], 'لا حقول محذوفة — التعافي كامل');
    eq(out.display.narrative.summary, 'ملخّص سليم', 'display يعرض نصّ المحاولة الثانية النظيف لا الأولى المرفوضة');

    // priorRejection وصل فعلياً في حمولة النداء الثاني — "النموذج يُعطى
    // قائمة ما رُفض" (نصّ القرار ٢١).
    const secondBody = JSON.parse(deepseekCalls[1].userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ''));
    ok(secondBody.priorRejection !== null, 'body.priorRejection موجود فعلياً في النداء الثاني');
    eq(secondBody.priorRejection.attempt, 1, 'priorRejection.attempt = 1 (يشير إلى المحاولة المرفوضة)');
    ok(Array.isArray(secondBody.priorRejection.rejectedReasons) &&
        secondBody.priorRejection.rejectedReasons.some((r) => r.startsWith('NUMBERS:narrative.summary')),
    'priorRejection.rejectedReasons يحمل سبب الرفض الحقيقي من الجولة ١');

    const firstBody = JSON.parse(deepseekCalls[0].userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ''));
    eq(firstBody.priorRejection, null, 'النداء الأول بلا priorRejection (لا رفض سابق بعد)');
  }
  console.log('تحقّق 2: رفض ثم تعافٍ بعد إعادة توليد واحدة — priorRejection وصل النموذج فعلياً');

  // ═══════════════════════════════════════════════════════════════════
  // 3. رفض في المحاولتين معاً — عرض جزئي: الجزء الحتمي كاملاً، الحقل
  //    المرفوض وحده يُحذف من display، narrativeIncomplete=true
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    deepseekBehavior = async () => {
      const bad = cleanResponse();
      bad.narrative.verdict = 'رقم مُختلَق آخر 424242 في الحكم';
      return bad;
    };

    const out = await run(params());

    eq(deepseekCalls.length, 2, 'محاولتان — كلتاهما رُفضتا');
    eq(out.audit.regeneration.attempts, 2, 'attempts = 2');
    eq(out.audit.regeneration.rounds[0].guardOk, false, 'الجولة ١ رُفضت');
    eq(out.audit.regeneration.rounds[1].guardOk, false, 'الجولة ٢ رُفضت أيضاً');
    eq(out.audit.regeneration.narrativeIncomplete, true, 'narrativeIncomplete=true بعد رفضين متتاليين');
    deepEq(out.audit.regeneration.droppedFields, ['narrative.verdict'],
        'الحقل المرفوض تحديداً (verdict) وحده في droppedFields — لا القسم كلّه');

    // القرار ٢١ البند ٢ — الحقل المرفوض يُحذف من display ولا يُعرض.
    eq(out.display.verdict, undefined, 'لا يوجد display.verdict مباشرة (البنية narrative.verdict)');
    eq(out.display.narrative.verdict, null, 'narrative.verdict محذوف فعلياً من display (null لا القيمة المرفوضة)');
    eq(out.display.narrative.summary, 'ملخّص سليم', 'الحقول غير المرفوضة (summary) تبقى معروضة كاملة');
    eq(out.display.narrativeIncomplete, true, 'display.narrativeIncomplete=true');
    deepEq(out.display.narrativeIncompleteFields, ['narrative.verdict'], 'display.narrativeIncompleteFields محدَّدة بدقّة');

    // القرار ٢١ البند ٢ — الجزء الحتمي (الحروف · التغطية · البوّابات ·
    // الأعطال) يُعرض كاملاً رغم رفض السرد مرّتين.
    eq(out.display.overall.letter, 'C', 'overall.letter الحتمي لم يتأثّر برفض السرد (C على فِخّ b45c8cf6)');
    ok(typeof out.display.overall.coverage === 'number', 'overall.coverage حتمي حاضر');
    ok(out.display.overall.governingGateReason && out.display.overall.governingGateReason.name === 'ROOT_DETECTED',
        'سبب البوّابة الحاكمة حاضر كما هو (GATE:ROOT_DETECTED على فِخّ b45c8cf6)');
    ok(Array.isArray(out.display.issues) && out.display.issues.length > 0,
        'قائمة الأعطال الحتمية حاضرة كاملة');

    // القرار ٣ — لا يُرفض التقرير كلّه أبداً.
    ok(out.display !== null && typeof out.display === 'object', 'display كائن حقيقي دائماً — لا null، لا رفض كامل');
  }
  console.log('تحقّق 3: رفضان متتاليان — الحقل المرفوض وحده يُحذف، الجزء الحتمي كامل، narrativeIncomplete=true');

  // ═══════════════════════════════════════════════════════════════════
  // 4. رفض على حقل لا يصل display أصلاً (crossChecks) — لا يرفع
  //    narrativeIncomplete رغم رفض الحارس مرّتين، ويبقى محفوظاً في audit
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    deepseekBehavior = async () => {
      const bad = cleanResponse();
      bad.crossChecks = [{description: 'رقم لا مصدر له 999888 في ملاحظة تقاطع', evidenceRefs: ['x']}];
      return bad;
    };

    const out = await run(params());

    eq(out.audit.regeneration.rounds[0].guardOk, false, 'الحارس رفض (crossChecks[0].description)');
    ok(out.audit.regeneration.rounds[0].rejectedReasons.some((r) => r.startsWith('NUMBERS:crossChecks[0].description')),
        'سبب الرفض مُسجَّل بدقّة');
    eq(out.audit.regeneration.narrativeIncomplete, false,
        'crossChecks لا تصل display أصلاً (audit فقط، القرار ٤/٦) — رفضها لا يعني نقصاً في السرد المعروض');
    deepEq(out.audit.regeneration.droppedFields, [], 'لا حقول display محذوفة');
    eq(out.display.narrativeIncomplete, false, 'display.narrativeIncomplete يبقى false');
    eq(out.display.narrative.summary, 'ملخّص سليم', 'السرد المعروض سليم كاملاً');

    // المحتوى المرفوض يبقى محفوظاً في audit (القرار ٤: "تُحفَظ ولا تُعرض" —
    // حتى المرفوض دليل مفيد للمراجع)، لا يُمحى.
    eq(out.audit.crossChecks.length, 1, 'audit.crossChecks يحمل المحتوى المرفوض كما وصل — للمراجعة لا للحذف');
  }
  console.log('تحقّق 4: رفض على حقل audit-only (crossChecks) لا يرفع narrativeIncomplete — يبقى مسجَّلاً في audit');

  // ═══════════════════════════════════════════════════════════════════
  // 5. فشل صلب في نداء إعادة التوليد (المحاولة الثانية) — لا يُسقط
  //    التقرير؛ عرض جزئي من مخرَج المحاولة الأولى المرفوضة
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    geminiCalls = [];
    geminiFallbackEnabledForTest = true; // يختبر "كلا المزوّدَين فشلا فعلاً" — لا تعطيل Gemini
    let callCount = 0;
    deepseekBehavior = async () => {
      callCount++;
      if (callCount === 1) {
        const bad = cleanResponse();
        // أمر مستخدم 2026-10-01 +03 ("حارس details") — تصحيح: كانت القيمة
        // المُختلَقة هنا في narrative.details تحديداً، وذلك الحقل صار الآن
        // لا يُسقط .ok (يُسجَّل في audit.detailsGuardWaived فقط) — فنقلتها
        // إلى summary (حقل يبقى يرفض كما كان) كي يبقى هذا الاختبار يفحص ما
        // يصفه عنوانه (فشل صلب في محاولة إعادة التوليد الثانية)، لا سلوك
        // details الذي تغيّر بأمر صريح (القاعدة 23 — استبدال لا إضافة).
        bad.narrative.summary = 'رقم مُختلَق 135791 في الملخّص';
        return bad;
      }
      const e = new Error('ds-down-on-retry'); e.retryable = false; throw e;
    };
    geminiBehavior = async () => { throw new Error('gemini-down-on-retry'); };

    const out = await run(params());
    geminiFallbackEnabledForTest = false; // إعادة الافتراضي — لا تسريب لسيناريوهات لاحقة

    eq(out.audit.regeneration.attempts, 2, 'محاولتان مُسجَّلتان رغم فشل الثانية صلباً');
    eq(out.audit.regeneration.rounds[1].guardOk, false, 'الجولة ٢ الفاشلة صلباً تُسجَّل guardOk=false');
    ok(out.audit.regeneration.rounds[1].rejectedReasons.some((r) => r.startsWith('HARD_FAILURE:')),
        'سبب الفشل الصلب مُسجَّل بوضوح — لا يُخلَط برفض حارس عادي');
    eq(out.audit.regeneration.narrativeIncomplete, true, 'narrativeIncomplete=true — العرض جزئي من مخرَج المحاولة ١');
    // أمر مستخدم 2026-10-01 +03 ("حارس details") — الحقل المرفوض هنا صار
    // summary لا details (راجع تعليق حقن الرقم المُختلَق أعلاه).
    deepEq(out.audit.regeneration.droppedFields, ['narrative.summary'], 'الحقل المرفوض في المحاولة ١ هو ما يُحذف');
    eq(out.display.narrative.summary, null, 'narrative.summary محذوف من display');
    ok(out.display.overall.letter === 'C', 'الجزء الحتمي سليم رغم فشل إعادة التوليد صلباً — لا رفض كامل (القرار ٣)');
  }
  console.log('تحقّق 5: فشل صلب في إعادة التوليد — لا رفض كامل، عرض جزئي من المحاولة الأولى');

  // ═══════════════════════════════════════════════════════════════════
  // 6. فشل صلب في المحاولة الأولى نفسها — يبقى خارج نطاق هذه السياسة،
  //    يرمي (نفس تعاقد callAIv7 الحالي — راجع تعليق رأس الملف، البند ج)
  // ═══════════════════════════════════════════════════════════════════
  {
    geminiFallbackEnabledForTest = true; // يختبر "كلا المزوّدَين فشلا فعلاً حتى مع تفعيل الاحتياطي"
    deepseekBehavior = async () => { const e = new Error('ds-down'); e.retryable = false; throw e; };
    geminiBehavior = async () => { throw new Error('gemini-down'); };
    let threw = false;
    try {
      await run(params());
    } catch (e) {
      threw = true;
      ok(/ds-down/.test(e.message) && /gemini-down/.test(e.message), 'رسالة الفشل الصلب في المحاولة الأولى تسمّي كلا السببين');
    }
    ok(threw, 'فشل المحاولة الأولى صلباً (كلا المزوّدَين، Gemini مُفعَّل وفشل أيضاً) يبقى رمياً صريحاً — خارج نطاق سياسة رفض الحارس');
    geminiFallbackEnabledForTest = false; // إعادة الافتراضي
  }
  console.log('تحقّق 6: فشل صلب في المحاولة الأولى نفسها (Gemini مُفعَّل وفشل أيضاً) — يرمي، لا علاقة له بسياسة رفض الحارس');

  // ═══════════════════════════════════════════════════════════════════
  // 6ب. فشل صلب في المحاولة الأولى، Gemini **مُعطَّل** (الافتراضي المطابق
  //    للإنتاج) — لا رمي؛ عرض حتمي كامل بلا سرد، سبب PROVIDER_FAILED_NO_FALLBACK
  //    (أمر مستخدم 2026-09-23 +03، القرار ٢ — يُستبدَل افتراض ٦ القديم هنا
  //    بحالة معطَّلة صريحة؛ الفحص الكامل بثلاث حالات الراية في
  //    test/geminiFallbackFlag.test.js المخصّص).
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekBehavior = async () => { const e = new Error('ds-down-no-fallback'); e.retryable = false; throw e; };
    geminiCalls = [];
    let threw6b = null; let out = null;
    try {
      out = await run(params());
    } catch (e) { threw6b = e; }
    eq(geminiCalls.length, 0, '[6ب] Gemini مُعطَّل — صفر نداء إطلاقاً');
    ok(!threw6b, `[6ب] resolveV7Report لا يرمي رغم فشل DeepSeek — Gemini مُعطَّل ليس "فشل كلا المزوّدَين" (${threw6b && threw6b.message})`);
    eq(out.guardFinal.ok, false, '[6ب] guardFinal.ok=false');
    ok(out.audit.regeneration.rounds[0].rejectedReasons.some((r) => r.startsWith('PROVIDER_FAILED_NO_FALLBACK:')),
        '[6ب] سبب مُسمّى PROVIDER_FAILED_NO_FALLBACK — مستقلّ عن رفض الحارس وTIME_BUDGET_EXHAUSTED');
    eq(out.display.narrativeIncomplete, true, '[6ب] narrativeIncomplete=true — السرد غائب بالكامل');
    deepEq(out.audit.regeneration.droppedFields.slice().sort(), NARRATIVE_LEAF_FIELDS_FOR_TEST.slice().sort(),
        '[6ب] كل حقول narrative السبعة محذوفة — لا رد وصل من أي مزوّد');
    ok(out.display.overall.letter !== undefined && out.audit.gatesApplied !== undefined,
        '[6ب] الحرف/البوّابات حاضران رغم غياب السرد الكامل — لا تمرّان بالنموذج أصلاً');
  }
  console.log('تحقّق 6ب: فشل صلب + Gemini مُعطَّل (الافتراضي) — لا رمي، عرض حتمي كامل بلا سرد، PROVIDER_FAILED_NO_FALLBACK');

  // ═══════════════════════════════════════════════════════════════════
  // 7. الدوالّ الداخلية — تغطية مباشرة بلا حاجة لمحاكاة نداء كامل
  // ═══════════════════════════════════════════════════════════════════
  {
    const {collectRejectedPaths, sanitizeNarrativeForDisplay, expandDroppedDisplayFields} = _internal;

    // شكل بنيوي فاسد (FORBIDDEN_KEY) → لا ثقة بأي قسم، الأربعة كلّها تُدرَج
    const shapeGuard = {
      ok: false,
      shape: {ok: false, errors: ['FORBIDDEN_KEY_grade']},
      issueKeys: {ok: true, inventedIds: []},
      numbers: {ok: true, unmatchedFields: []},
      languageLeaks: [],
    };
    const paths = collectRejectedPaths(shapeGuard);
    ok(paths.has('narrative') && paths.has('crossChecks') && paths.has('adjustments') && paths.has('modelObservations'),
        'FORBIDDEN_KEY يُسقط الثقة بالأقسام الأربعة كلّها');
    deepEq(expandDroppedDisplayFields(paths), NARRATIVE_LEAF_FIELDS_FOR_TEST,
        'narrative المفردة تتوسّع إلى الحقول السبعة الفعلية عند فشل بنيوي كامل (القرار ٢٤: buyerAdvice ثلاثة مسارات لا واحد)');

    // narrative جزئي الفشل (NARRATIVE_SUMMARY فقط) → القسم كلّه يُسقَط
    // (لا ثقة بأي حقل داخل narrative غير صالحة الشكل أصلاً) لكن الأقسام
    // الأخرى تبقى غير متأثّرة.
    const narShapeGuard = {
      ok: false,
      shape: {ok: false, errors: ['NARRATIVE_SUMMARY_MISSING_OR_EMPTY']},
      issueKeys: {ok: true, inventedIds: []},
      numbers: {ok: true, unmatchedFields: []},
      languageLeaks: [],
    };
    const narPaths = collectRejectedPaths(narShapeGuard);
    ok(narPaths.has('narrative') && !narPaths.has('crossChecks'),
        'فشل شكل narrative فقط لا يُسقط الثقة بالأقسام الأخرى');

    // sanitizeNarrativeForDisplay — حقل واحد مرفوض يُحذف، الباقي يبقى.
    const src = {narrative: {
      summary: 'س', details: 'د', verdict: 'ح',
      buyerAdvice: {casual: 'ع', gamer: 'ل', photographer: 'ت'},
    }};
    const onlySummaryRejected = new Set(['narrative.summary']);
    const cleaned = sanitizeNarrativeForDisplay(src, onlySummaryRejected);
    eq(cleaned.summary, undefined, 'summary محذوف (غير موجود كمفتاح) بعد الرفض');
    eq(cleaned.details, 'د', 'details سليم يبقى كما هو');
    eq(cleaned.verdict, 'ح', 'verdict سليم يبقى كما هو');
    deepEq(cleaned.buyerAdvice, {casual: 'ع', gamer: 'ل', photographer: 'ت'},
        '[القرار ٢٤] buyerAdvice كائن كامل يبقى حين لا ملفّ منه مرفوض');

    // [القرار ٢٤] ملفّ واحد من buyerAdvice مرفوض — الملفّان الآخران يبقيان،
    // لا الحقل كلّه يُحذف (نفس دقّة summary/details/verdict أعلاه).
    const onlyGamerRejected = new Set(['narrative.buyerAdvice.gamer']);
    const cleanedAdvice = sanitizeNarrativeForDisplay(src, onlyGamerRejected);
    deepEq(cleanedAdvice.buyerAdvice, {casual: 'ع', photographer: 'ت'},
        '[القرار ٢٤] ملفّ gamer المرفوض وحده غائب من buyerAdvice — casual/photographer سليمان يبقيان');

    // [القرار ٢٤] الثلاثة مرفوضة معاً — buyerAdvice لا يظهر كمفتاح إطلاقاً
    // (نفس نمط summary أعلاه: حذف بغياب المفتاح لا بقيمة null مصطنَعة).
    const allProfilesRejected = new Set(BUYER_ADVICE_PROFILES.map((p) => `narrative.buyerAdvice.${p}`));
    const cleanedAllRejected = sanitizeNarrativeForDisplay(src, allProfilesRejected);
    eq(cleanedAllRejected.buyerAdvice, undefined,
        '[القرار ٢٤] الملفّات الثلاثة مرفوضة معاً → buyerAdvice غائب كمفتاح كلّياً');
  }
  console.log('تحقّق 7: الدوالّ الداخلية — تغطية مباشرة (+ القرار ٢٤ buyerAdvice بدقّة الملفّ الواحد)');

  console.log(`\nresolveV7Report.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('resolveV7Report.test.js FAILED:', e);
  process.exit(1);
});
