'use strict';

// callAIv7.test.js — P1.4 (PLAN-01-ROADMAP.md "P1.4 البرومبت v7":
// "callAI.js:143-166 يبني الحمولة من Findings + الثلاثيات + الحالات
// (بلا samples)"). يختبر callAIv7 (دالّة جديدة، مضافة لا مُستبدِلة —
// راجع تعليق رأسها في callAI.js) بكعوب كاملة لـcallDeepSeek/
// callGeminiFallback/utils/admin — **صفر نداء نموذج حقيقي، صفر إنفاق**
// (القيد الصريح في أمر المهمّة).
//
// Run: node functions/test/callAIv7.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── كعب utils/admin: لا Firestore حقيقي (resolveAiConfig يسقط آمناً
// للافتراضي عند فشل db — راجع resolveAiConfig.js:105-109) ──────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب callDeepSeek/callGemini — لا شبكة، لا مفتاح API حقيقي ─────────
let deepseekCalls = [];
let deepseekBehavior = async (userMessage, systemPrompt) => {
  deepseekCalls.push({userMessage, systemPrompt});
  return validV7Response();
};
const deepseekPath = require.resolve('../src/analysis/callDeepSeek');
require.cache[deepseekPath] = {
  id: deepseekPath, filename: deepseekPath, loaded: true,
  exports: {
    callDeepSeek: (...args) => deepseekBehavior(...args),
    DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_TIMEOUT_MS: 130000,
  },
};

let geminiCalls = [];
let geminiBehavior = async () => { throw new Error('gemini not expected in this case'); };
const geminiPath = require.resolve('../src/analysis/callGemini');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    callGeminiFallback: (...args) => { geminiCalls.push(args); return geminiBehavior(...args); },
    GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_TIMEOUT_MS: 55000,
  },
};

// ─── كعب utils/resolveGeminiFallbackConfig — أمر مستخدم 2026-09-23 +03،
// القرار ٢: Gemini خلف راية مُعطَّلة افتراضياً (مطابقة للإنتاج). التحقّقان
// ٢/٣ أدناه يختبران "Gemini يُستدعى فعلياً" — يُفعِّلان الراية صراحةً كي
// يبقيا يختبران ما صُمِّما له (سلوك الاحتياطي نفسه)، لا سلوك التعطيل
// (ذاك في التحقّق ٢ب الجديد + test/geminiFallbackFlag.test.js المخصّص).
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

// require بعد كل الكعوب أعلاه — callAI.js يستوردها عند التحميل.
const {callAIv7} = require('../src/analysis/callAI');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

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

function validV7Response() {
  return {
    narrative: {
      summary: 'ملخّص كعب سليم', details: 'تفاصيل كعب سليمة',
      verdict: 'حكم كعب', buyerAdvice: {casual: 'نصيحة كعب عادية', gamer: 'نصيحة كعب ألعاب', photographer: 'نصيحة كعب تصوير'},
      issueDescriptions: {[realIssueId]: 'وصف كعب لعطب حقيقي'},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
}

async function run(params) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await callAIv7(params);
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // 1. المسار السعيد — DeepSeek ينجح من أول محاولة، الحارس يقبل
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    const out = await run({
      findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
      scanContext: {scanId: 'test-v7', isFreeTrial: false}, previousScan: null,
      deepseekApiKey: 'k', geminiApiKey: 'g',
    });

    eq(out.pipeline, 'v7_findings_based', 'pipeline علامة V7 مختلفة عمداً عن v6_raw_timeseries');
    eq(out.aiModel, 'deepseek-flash', 'aiModel من الكعب');
    eq(out.guard.ok, true, 'الحارس يقبل مخرَجاً سليماً');
    ok(typeof out.duration === 'number', 'duration رقم');
    ok(typeof out.bodyBuildMs === 'number', 'bodyBuildMs رقم');

    eq(deepseekCalls.length, 1, 'نداء واحد فقط لـcallDeepSeek — لا تكرار');
    ok(deepseekCalls[0].systemPrompt.includes('كاتب أوصاف، لا مؤلّف قائمة'),
        'callAIv7 يستعمل SYSTEM_PROMPT_V7 فعلياً — لا V6');
    ok(!deepseekCalls[0].systemPrompt.includes('compute every mean'),
        'البرومبت المُرسَل فعلياً ليس V6 (لا "compute every mean")');
    ok(!deepseekCalls[0].userMessage.includes('"samples"'),
        'userMessage الفعلي المُرسَل للنموذج بلا samples إطلاقاً');
    const sentBody = JSON.parse(deepseekCalls[0].userMessage.replace(/\n\nProduce the analysis JSON now\.$/, ''));
    eq(sentBody.scanId, 'test-v7', 'scanId وصل النموذج فعلياً كما مُرِّر');
    ok(Array.isArray(sentBody.testResults) && sentBody.testResults.length > 0, 'testResults (الثلاثيات) وصلت النموذج فعلياً');
    ok(sentBody.categoryStates && Object.keys(sentBody.categoryStates.categories).length === 15,
        'categoryStates (الحالات، 15 فئة) وصلت النموذج فعلياً');
  }
  console.log('تحقّق 1: callAIv7 المسار السعيد — V7 payload/prompt/guard متّصلة فعلياً');

  // ═══════════════════════════════════════════════════════════════════
  // 2. فشل DeepSeek → Gemini fallback (نفس آلية V6، مُعاد استعمالها)
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = [];
    geminiCalls = [];
    geminiFallbackEnabledForTest = true; // يختبر سلوك الاحتياطي نفسه، لا التعطيل
    deepseekBehavior = async () => { const e = new Error('boom'); e.retryable = false; throw e; };
    geminiBehavior = async () => validV7Response();

    const out = await run({
      findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
      scanContext: {scanId: 'test-v7-fallback'}, deepseekApiKey: 'k', geminiApiKey: 'g',
    });
    eq(out.aiModel, 'gemini-2.5-flash', 'فشل DeepSeek → aiModel=Gemini (الراية مُفعَّلة)');
    eq(geminiCalls.length, 1, 'Gemini استُدعيت مرّة واحدة بعد فشل DeepSeek');
    eq(out.guard.ok, true, 'الحارس يقبل مخرَج Gemini السليم أيضاً');

    deepseekBehavior = async () => validV7Response(); // إعادة الحال الافتراضي للأقسام اللاحقة
    geminiFallbackEnabledForTest = false; // إعادة الافتراضي المطابق للإنتاج
  }
  console.log('تحقّق 2: callAIv7 fallback إلى Gemini عند فشل DeepSeek، والراية مُفعَّلة — نفس آلية V6');

  // ═══════════════════════════════════════════════════════════════════
  // 2ب. فشل DeepSeek، والراية **مُعطَّلة** (الافتراضي المطابق للإنتاج) —
  //    أمر مستخدم 2026-09-23 +03، القرار ٢: لا نداء Gemini إطلاقاً، لا رمي
  //    — providerFailedNoFallback:true، aiAnalysis:null، guard:null.
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekCalls = []; geminiCalls = [];
    deepseekBehavior = async () => { const e = new Error('boom-no-fallback'); e.retryable = false; throw e; };

    const out = await run({
      findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
      scanContext: {scanId: 'test-v7-nofallback'}, deepseekApiKey: 'k', geminiApiKey: 'g',
    });
    eq(geminiCalls.length, 0, '[2ب] الراية مُعطَّلة (افتراضي) — صفر نداء Gemini');
    eq(out.providerFailedNoFallback, true, '[2ب] providerFailedNoFallback=true');
    eq(out.aiAnalysis, null, '[2ب] aiAnalysis=null — لا ردّ وصل من أي مزوّد');
    eq(out.guard, null, '[2ب] guard=null — لا شكل ليُفحَص أصلاً');
    ok(/boom-no-fallback/.test(out.primaryError), '[2ب] primaryError يحمل سبب فشل DeepSeek الحقيقي');
    ok(typeof out.duration === 'number', '[2ب] duration مقاسة رغم عدم وجود ردّ');

    deepseekBehavior = async () => validV7Response(); // إعادة الحال الافتراضي
  }
  console.log('تحقّق 2ب: فشل DeepSeek والراية مُعطَّلة (الافتراضي) — صفر نداء Gemini، providerFailedNoFallback:true، لا رمي');

  // ═══════════════════════════════════════════════════════════════════
  // 3. فشل الاثنين معاً، والراية مُفعَّلة → رمي واضح (لا يتغيّر سلوك هذه
  //    الحالة — Gemini حقيقياً حاول وفشل، لا مجرّد تعطيل)
  // ═══════════════════════════════════════════════════════════════════
  {
    geminiFallbackEnabledForTest = true;
    deepseekBehavior = async () => { const e = new Error('ds-down'); e.retryable = false; throw e; };
    geminiBehavior = async () => { throw new Error('gemini-down'); };
    let threw = false;
    try {
      await run({
        findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
        scanContext: {scanId: 'test-v7-hardfail'}, deepseekApiKey: 'k', geminiApiKey: 'g',
      });
    } catch (e) {
      threw = true;
      ok(/ds-down/.test(e.message) && /gemini-down/.test(e.message), 'رسالة الفشل الصلب تسمّي كلا السببين');
    }
    ok(threw, 'فشل DeepSeek وGemini معاً (الراية مُفعَّلة) → رمي صريح (لا سقوط صامت)');
    deepseekBehavior = async (userMessage, systemPrompt) => { deepseekCalls.push({userMessage, systemPrompt}); return validV7Response(); };
    geminiFallbackEnabledForTest = false; // إعادة الافتراضي
  }
  console.log('تحقّق 3: فشل المزوّدَين معاً (الراية مُفعَّلة) يرمي صراحةً');

  // ═══════════════════════════════════════════════════════════════════
  // 4. مخرَج فاسد من النموذج → الحارس يرفض (guard.ok=false)، لا رمي
  // ═══════════════════════════════════════════════════════════════════
  {
    deepseekBehavior = async () => ({grade: 'A', score: 90}); // مخرَج V6-مثل، ممنوع في V7
    const out = await run({
      findings: s10Findings, categoryStates: s10CategoryStates, language: 'ar',
      scanContext: {scanId: 'test-v7-badshape'}, deepseekApiKey: 'k', geminiApiKey: 'g',
    });
    eq(out.guard.ok, false, 'مخرَج بشكل V6 (grade/score) → الحارس يرفضه صراحةً');
    ok(out.guard.shape.errors.some((e) => e.startsWith('FORBIDDEN_KEY_')), 'سبب الرفض: FORBIDDEN_KEY (grade/score)');
  }
  console.log('تحقّق 4: مخرَج فاسد → guard.ok=false مع سبب مُسمّى — لا رمي، لا قبول صامت');

  console.log(`\ncallAIv7.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('callAIv7.test.js FAILED:', e);
  process.exit(1);
});
