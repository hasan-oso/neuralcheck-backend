'use strict';

// verifyReportV7Whitelist.test.js — القرار ٢٣ (PLAN-01-ROADMAP.md §🔒
// "٢٣ · verifyReport — قائمة بيضاء V7"، A101). يختبر السلوك الذي طلبته
// المهمّة صراحةً تحت "في تقريرك": ما يُرجعه verifyReport بالضبط على تقرير
// V7 وعلى تقرير V6 قديم، وعلى تقرير بقيمة pipeline غير معروفة — مفتاحاً
// مفتاحاً، مُثبَتاً هنا لا بالقراءة وحدها.
//
// نفس أسلوب verifyReportAuditExclusion.test.js: استخراج منطق بناء
// `response` من المصدر نصّياً (بلا تحميل firebase-functions/onRequest
// كاملة) عبر new Function('reportDoc', 'console', 'V7_PIPELINE_TAG',
// 'V6_PIPELINE_TAG', ...)، ثم تنفيذه على مُدخلات مُصطنَعة. verifyReport.js
// لا يحتاج Firestore حقيقياً لاختبار هذا المنطق.
//
// ⚠️ لا تعديل هنا على verifyReportLimits.test.js (يبقى كما هو).
// verifyReportAuditExclusion.test.js **عُدِّل** في مهمّة 2026-09-21 +03 —
// لكن فقط آلية new Function (إضافة المعرِّفين وسيطين)، لا تحقّقاته الـ25 —
// إذن صريح من المستخدم تلك المهمّة تحديداً، بعد أن تركته مهمّة سابقة بلا
// تعديل عمداً (نفس السبب: new Function لا تُغلِق على نطاق الوحدة، فلزم
// تمرير الثابتين وسيطين بدل تكرارهما حرفياً في الملفّين).
//
// Run: node functions/test/verifyReportV7Whitelist.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ثابت واحد مُصدَّر — مصدر الحقيقة الوحيد لعلامتَي pipeline (مهمّة
// 2026-09-21 +03، بعد مراجعتين). يستورده كل من verifyReport.js نفسه وهذا
// الاختبار — لا سلسلة حرفية منفصلة في أيّهما.
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} =
    require('../src/analysis/pipelineTags');
const {hashIdForLog} = require('../src/utils/logRedaction');

// ─── كعوب صفر-تكلفة لـcallAIv7 (تحقّق 0-أ أدناه) — نفس تقنية
// callAIv7.test.js حرفياً: لا Firestore حقيقي، لا نداء نموذج حقيقي، صفر
// إنفاق. يجب أن تُضبَط هذه القبل require('../src/analysis/callAI') كي
// يتحمّل الوحدة كعوبها لا النسخ الحقيقية.
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};
const deepseekPath = require.resolve('../src/analysis/callDeepSeek');
require.cache[deepseekPath] = {
  id: deepseekPath, filename: deepseekPath, loaded: true,
  exports: {
    callDeepSeek: async () => ({
      narrative: {
        summary: 's', details: 'd', verdict: 'v',
        buyerAdvice: {casual: 'a', gamer: 'b', photographer: 'c'},
        issueDescriptions: {},
      },
      crossChecks: [], adjustments: [], modelObservations: [],
    }),
    DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_TIMEOUT_MS: 130000,
  },
};
const geminiPath = require.resolve('../src/analysis/callGemini');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    callGeminiFallback: async () => { throw new Error('gemini not expected in this test'); },
    GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_TIMEOUT_MS: 55000,
  },
};

// require بعد الكعوب أعلاه — نفس ترتيب callAIv7.test.js.
const {callAIv7} = require('../src/analysis/callAI');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');

// ─── استخراج بناء `response` كدالّة خالصة — نفس تقنية
// verifyReportAuditExclusion.test.js حرفياً (العلامتان نفسهما).
const SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');
const src = fs.readFileSync(SRC, 'utf8');

const startMarker = 'const report = reportDoc.data();';
const endMarker = 'res.json(response);';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
ok(startIdx > -1 && endIdx > -1 && endIdx > startIdx,
    '[إعداد] العلامتان موجودتان في verifyReport.js بنفس الترتيب المتوقَّع');

const bodySrc = src.slice(startIdx, endIdx);

// V7_PIPELINE_TAG/V6_PIPELINE_TAG (الثابتان المستوردان أعلى هذا الملف) هما
// المتغيّران الحرّان الوحيدان اللذان يستهلكهما bodySrc من خارج نطاقه
// (بجوار reportDoc/console) بعد أن انتقل تعريفهما في verifyReport.js إلى
// require أعلى ملفّه الحقيقي — new Function لا تُغلِق على نطاق تلك الوحدة،
// فبناء الدالّة هنا يقبلهما وسيطين صريحين (القاعدة 16: إصلاح الأداة، لا
// الالتفاف عليها بتكرار السلسلة الحرفية في هذا الملف).
function buildResponse(reportDoc, warnSink) {
  const warns = [];
  const cons = {
    log: () => {},
    warn: (...args) => { warns.push(args.join(' ')); },
    error: () => {},
  };
  const fn = new Function(
      'reportDoc', 'console', 'V7_PIPELINE_TAG', 'V6_PIPELINE_TAG', 'hashIdForLog', // hashIdForLog: S-SUB 2026-10-16 — سطر تحذير V7 يُهشِّر scanId؛ وسيط صريح (القاعدة 16: إصلاح الأداة)
      bodySrc + '\nreturn response;');
  const response = fn(reportDoc, cons, V7_PIPELINE_TAG, V6_PIPELINE_TAG, hashIdForLog);
  if (warnSink) warnSink.push(...warns);
  return response;
}

function fakeDoc(id, data) {
  return {id, data: () => data};
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 0. يستبدل "حارس تحقّق 0" القديم (القاعدة 23 — لا يُضاف بجواره). الحارس
  //    القديم قارن زوجاً خطأ: الثابت المحلّي V7_PIPELINE_TAG في
  //    verifyReport.js مقابل buildDisplayShapeV7.PIPELINE_TAG — والأخير
  //    يكتب aiResponse.pipeline (حقل متداخل داخل شكل العرض)، لا
  //    report.pipeline (الحقل الجذر الذي يقرؤه verifyReport فعلياً ليقرّر
  //    V7 مقابل V6). زوج الكاتب↔القارئ الحقيقي: callAIv7 (callAI.js) →
  //    runAnalysisInternal.js (pipeline = callAiRaw.pipeline) →
  //    analyzeDevice.js:323 (report.pipeline = pipeline || V6_PIPELINE_TAG)
  //    → verifyReport.js. لو انجرف callAI.js وحده عن الثابت المشترك، يبقى
  //    الحارس القديم أخضر بينما تسقط كل تقارير V7 إلى قائمة V6 صامتةً —
  //    A101 نفسها بصيغة ثالثة. هذا القسم يثبت الزوج الصحيح، لا زوجاً معزولاً.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── 0-أ. سلسلة الكاتب→القارئ من تشغيل فعلي: نداء حقيقي لـcallAIv7
  // (بكعوب DeepSeek/Gemini/admin — صفر نداء نموذج حقيقي، صفر إنفاق)، ثم
  // تمرير الوسم الذي *أعادته فعلياً* (لا اقتباس نصّي للسطر) كأنه
  // report.pipeline كما تكتبه analyzeDevice.js حرفياً (تمريرة مباشرة بلا
  // تحويل)، والتحقّق من أن منطق verifyReport.js المُستخرَج يقرأه V7 فعلاً.
  {
    // بصمة حقيقية من fixture قائم (نفس ما يستعمله callAIv7.test.js) — لا
    // بصمة مُصطنَعة قد تُخالف افتراضات computeFindings/computeCategoryStates
    // الداخلية بلا داعٍ.
    const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
    const s10Raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'), 'utf8'));
    const frMap = JSON.parse(fs.readFileSync(
        path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
    const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
    const s10Fingerprint = {timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
    const findings = computeFindings(s10Fingerprint);
    const categoryStates = computeCategoryStates({
      functionalResults: s10Functional, manualResults: [], dev: null, findings,
      batterySampleInputs: null, batteryDesignCapacityMah: null,
    });

    const real = {log: console.log, warn: console.warn, error: console.error};
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    let callAIv7Out;
    try {
      callAIv7Out = await callAIv7({
        findings, categoryStates, language: 'ar',
        scanContext: {scanId: 'chain-proof-v7', isFreeTrial: false},
        previousScan: null, deepseekApiKey: 'k', geminiApiKey: 'g',
      });
    } finally {
      console.log = real.log; console.warn = real.warn; console.error = real.error;
    }

    const writerTag = callAIv7Out.pipeline; // القيمة الفعلية المُعادة — تشغيل حقيقي لا نصّ مقتبَس
    ok(typeof writerTag === 'string' && writerTag.length > 0,
        '[سلسلة الكاتب][تشغيل فعلي] callAIv7 أعادت pipeline فعلياً (كعوب DeepSeek/Gemini/admin، صفر إنفاق)');
    eq(writerTag, V7_PIPELINE_TAG,
        '[سلسلة الكاتب][تشغيل فعلي] الوسم الفعلي المُعاد من callAIv7 يطابق pipelineTags.V7_PIPELINE_TAG — مصدر الحقيقة نفسه الذي يستورده verifyReport.js');

    // القارئ: نفس منطق verifyReport.js المُستخرَج، يستهلك writerTag تماماً
    // كما لو وصل عبر analyzeDevice.js:323 (تمريرة مباشرة، بلا تحويل).
    const doc = fakeDoc('chain-proof-scan', {
      deviceModel: 'M', shortId: 'NC-CHAIN01', createdAt: 'x', language: 'ar', isFreeTrial: false,
      pipeline: writerTag,
      aiResponse: {
        pipeline: writerTag, language: 'ar',
        overall: {letter: 'C', letterSource: 'BAND', coverage: 1, partialAssessment: false},
        categories: {}, issues: [], narrativeIncomplete: false,
      },
    });
    const response = buildResponse(doc);
    ok('letter' in response.aiResponse && !('grade' in response),
        '[سلسلة الكاتب→القارئ][تشغيل فعلي] الوسم الذي أعادته callAIv7 فعلياً، مكتوباً في report.pipeline، ' +
        'يُقرأ V7 فعلاً عبر منطق verifyReport.js المُستخرَج — لا ينزلق إلى V6 صامتاً (A101 بصيغة ثالثة)');
  }
  console.log('تحقّق 0-أ: سلسلة callAIv7 → report.pipeline → verifyReport مُثبَتة بتشغيل فعلي (كعوب صفر-تكلفة) — لا مقارنة ثابتين معزولة عن الكاتب الحقيقي');

  // ─── 0-ب. لا نصّ مكرّر: يمسح functions/src/** ويفشل إن ظهرت
  // "v7_findings_based" أو "v6_raw_timeseries" حرفياً في سطر غير تعليقي
  // خارج pipelineTags.js — هذا ما يجعل "ثابت واحد مُصدَّر" قابلاً للإنفاذ
  // آلياً، لا عُرفاً يعتمد على انتباه المراجع القادم.
  {
    const SRC_DIR = path.join(__dirname, '..', 'src');
    const TAGS_FILE = path.resolve(path.join(SRC_DIR, 'analysis', 'pipelineTags.js'));
    const FORBIDDEN = ['v7_findings_based', 'v6_raw_timeseries'];
    const offenders = [];

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        if (path.resolve(full) === TAGS_FILE) continue; // مصدر الحقيقة نفسه — مُستثنى بالتصميم

        const text = fs.readFileSync(full, 'utf8');
        // إزالة تعليقات الكتلة /* ... */ أوّلاً (احتياط عام — لا وجود لها
        // حول هاتين السلسلتين اليوم فعلياً، تحقّق: كل المواضع الموجودة قبل
        // هذه المهمّة كانت تعليقات سطر //).
        const noBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
        const lines = noBlockComments.split('\n');
        lines.forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//')) return; // سطر تعليق كامل — توثيق مقصود، مُستثنى
          const codePart = line.split('//')[0]; // الجزء قبل أوّل تعليق سطري لاحق إن وُجد
          for (const tag of FORBIDDEN) {
            if (codePart.includes(`"${tag}"`) || codePart.includes(`'${tag}'`)) {
              offenders.push(`${path.relative(SRC_DIR, full).replace(/\\/g, '/')}:${i + 1} — "${tag}"`);
            }
          }
        });
      }
    }
    walk(SRC_DIR);

    eq(offenders.length, 0,
        `[القاعدة 23][إنفاذ آلي] لا سلسلة حرفية مكرَّرة لعلامتَي pipeline خارج pipelineTags.js في functions/src — ` +
        `المخالفات: ${JSON.stringify(offenders)}`);
  }
  console.log('تحقّق 0-ب: لا نصّ مكرّر لعلامتَي pipeline في functions/src خارج pipelineTags.js — مُنفَّذ آلياً لا عُرفاً');

  // ═══════════════════════════════════════════════════════════════════════
  // 1. تقرير V7 كامل — كل الحقول المتوقَّعة حاضرة (مهمّة 2026-09-21 +03،
  //    البند ٣: القائمة تُوسَّع — "كل ما في display يخرج"، لا القرار ٢٣
  //    الأصلي وحده. القائمة الآن تُطابق buildDisplayShapeV7.display حقلاً
  //    حقلاً + narrativeIncomplete/narrativeIncompleteFields من
  //    resolveV7Report.js — راجع تعليق buildV7Response في verifyReport.js.)
  // ═══════════════════════════════════════════════════════════════════════
  {
    const warns = [];
    const doc = fakeDoc('scan-v7-full', {
      deviceModel: 'SM-G973F', deviceMarketingName: 'Galaxy S10',
      shortId: 'NC-V7FULL1', createdAt: '2026-09-21T00:00:00Z', language: 'ar',
      isFreeTrial: false,
      pipeline: V7_PIPELINE_TAG,
      aiResponse: {
        pipeline: V7_PIPELINE_TAG, language: 'ar',
        overall: {
          letter: 'C', letterSource: 'GATE:ROOT_DETECTED', coverage: 0.45, coveragePct: 45,
          partialAssessment: true,
          partialAssessmentTag: {label: 'تقييم جزئي', coveragePct: 45, text: 'تقييم جزئي — تغطية 45%'},
          governingGateReason: {name: 'ROOT_DETECTED', ceilingLetter: 'C', source: 'SEC-04=fail'},
          noDataAtAll: false, zeroMeasuredMessage: null, abstentionReasons: null,
          harnessError: false, harnessErrorReason: null,
          // ملحق verifyReport (أمر مستخدم 2026-10-01 +03، القسم ٥) — حاضر
          // دائماً على overall الحقيقي (null هنا، ليست HARNESS_ERROR).
          harnessErrorMessage: null,
        },
        categories: {cpu: {state: 'MEASURED', letter: 'A', coverage: 1, reason: null, testIds: ['C-01']}},
        issues: [{id: 'ISS-SEC-04', category: 'security', severity: 'high', title: 'x', description: 'y'}],
        narrative: {
          summary: 's', details: 'd', verdict: 'v',
          buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة لاعب', photographer: 'نصيحة مصوّر'},
        },
        narrativeIncomplete: false,
        narrativeIncompleteFields: [],
      },
      aiAudit: {measuredCategoriesMean: 100, gatesApplied: [], SECRET: 'leak-canary'},
    });

    const response = buildResponse(doc, warns);

    eq(warns.length, 0, '[V7 كامل] لا تحذيرات — كل الحقول المتوقَّعة حاضرة فعلاً');
    eq(response.scanId, 'scan-v7-full', '[V7] scanId من reportDoc.id');
    eq(response.shortId, 'NC-V7FULL1', '[V7] shortId من report.shortId');
    ok(!('grade' in response) && !('score' in response), '[القرار ٦/٥][V7] لا grade ولا score على المستوى الأعلى — كسر نظيف، لا V6 بجوار V7');
    ok(!('summary' in response) && !('verdict' in response) && !('issueCount' in response),
        '[V7] لا حقول توافق V6 (summary/verdict/issueCount) على المستوى الأعلى — تلك خاصّة بشكل V6');

    const ar = response.aiResponse;
    ok(ar && typeof ar === 'object', '[V7] response.aiResponse موجود');
    eq(ar.pipeline, V7_PIPELINE_TAG, '[V7] aiResponse.pipeline يعكس الفرع المُستعمَل');
    eq(ar.language, 'ar', '[البند ٣][V7] aiResponse.language مأخوذ من aiResponse.language المخزون');
    eq(ar.letter, 'C', '[القرار ٢٣][V7] letter مأخوذ من overall.letter');
    eq(ar.letterSource, 'GATE:ROOT_DETECTED', '[القرار ٢٣][V7] letterSource مأخوذ من overall.letterSource');
    eq(ar.coverage, 0.45, '[القرار ٢٣][V7] coverage مأخوذ من overall.coverage');
    eq(ar.coveragePct, 45, '[البند ٣][V7] coveragePct مأخوذ من overall.coveragePct (سهو في تعداد المنسّق، محسوم بالمبدأ العام — راجع تقرير المهمّة)');
    eq(ar.partialAssessment, true, '[القرار ٢٣][V7] partialAssessment مأخوذ من overall.partialAssessment');
    deepEq(ar.partialAssessmentTag, {label: 'تقييم جزئي', coveragePct: 45, text: 'تقييم جزئي — تغطية 45%'},
        '[البند ٣][V7] partialAssessmentTag مأخوذ من overall.partialAssessmentTag حرفياً');
    deepEq(ar.governingGateReason, {name: 'ROOT_DETECTED', ceilingLetter: 'C', source: 'SEC-04=fail'},
        '[القرار ٢٣][V7] governingGateReason مأخوذ من overall.governingGateReason حرفياً');
    eq(ar.noDataAtAll, false, '[البند ٣][V7] noDataAtAll مأخوذ من overall.noDataAtAll');
    eq(ar.zeroMeasuredMessage, null, '[البند ٣][V7] zeroMeasuredMessage مأخوذ من overall.zeroMeasuredMessage');
    eq(ar.abstentionReasons, null, '[البند ٣][V7] abstentionReasons مأخوذ من overall.abstentionReasons');
    eq(ar.harnessError, false, '[البند ٣][V7] harnessError مأخوذ من overall.harnessError');
    eq(ar.harnessErrorReason, null, '[البند ٣][V7] harnessErrorReason مأخوذ من overall.harnessErrorReason');
    eq(ar.harnessErrorMessage, null, '[ملحق verifyReport][V7] harnessErrorMessage مأخوذ من overall.harnessErrorMessage');
    deepEq(ar.categories, {cpu: {state: 'MEASURED', letter: 'A', coverage: 1, reason: null, testIds: ['C-01']}},
        '[القرار ٢٣][V7] categories تمريرة مباشرة من aiResponse.categories');
    eq(ar.issues.length, 1, '[V7] issues نجت من القائمة القديمة — نفس الاسم، شكل V7 الغنيّ');
    eq(ar.issues[0].id, 'ISS-SEC-04', '[V7] عنصر issues محفوظ حرفياً');
    // S6 (أمر مستخدم 2026-10-01 +03) — details/verdict تُحذَفان من الردّ هنا
    // عمداً (راجع تعليق buildV7Response في verifyReport.js) رغم حضورهما في
    // aiResponse المخزون أعلاه (summary: 's', details: 'd', verdict: 'v') —
    // المُدخَل يبقى كاملاً بهما (يُحاكي المستند المخزون)، والمُخرَج بلا الاثنين.
    deepEq(ar.narrative, {
      summary: 's',
      buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة لاعب', photographer: 'نصيحة مصوّر'},
    }, '[S6][V7] narrative.* بلا details/verdict في الردّ — محذوفان عند الإرجاع لا عند البناء');
    eq(ar.narrativeIncomplete, false, '[القرار ٢٣][V7] narrativeIncomplete مأخوذ من aiResponse.narrativeIncomplete');
    deepEq(ar.narrativeIncompleteFields, [], '[البند ٣][V7] narrativeIncompleteFields مأخوذ من aiResponse.narrativeIncompleteFields (resolveV7Report.js:317)');

    // aiAudit يبقى مستبعَداً على فرع V7 أيضاً — دفاع في العمق بجوار
    // verifyReportAuditExclusion.test.js (الذي لا يغطّي هذا الفرع تحديداً).
    const serialized = JSON.stringify(response);
    ok(!('aiAudit' in response), '[القرار ٢٠][V7] aiAudit غائب من response على المستوى الأعلى');
    ok(!serialized.includes('leak-canary'), '[القرار ٢٠][V7] محتوى aiAudit لا يتسرّب عبر أي مسار في فرع V7');
    ok(!serialized.includes('measuredCategoriesMean'), '[القرار ٦][V7] measuredCategoriesMean (audit) لا يصل الاستجابة');
  }
  console.log('تحقّق 1: تقرير V7 كامل — كل حقول display (overall الاثنا عشر + narrative + narrativeIncomplete*) مُستخرَجة بدقّة، لا حصر السبعة القديم');

  // ═══════════════════════════════════════════════════════════════════════
  // 2. تقرير V7 ناقص — حقول display متوقَّعة غائبة → تُسجَّل لا تُصمَت
  //    (اختبار الانحدار الذي طلبته المهمّة صراحةً تحت "في تقريرك")
  // ═══════════════════════════════════════════════════════════════════════
  {
    const warns = [];
    const doc = fakeDoc('scan-v7-partial', {
      deviceModel: 'M', shortId: 'NC-PARTIAL', createdAt: 'x', language: 'ar', isFreeTrial: false,
      pipeline: V7_PIPELINE_TAG,
      aiResponse: {
        // overall غائب كلّياً، categories/narrativeIncomplete/issues غائبة أيضاً —
        // يُحاكي تقرير V7 مشوَّهاً أو مبنيّاً جزئياً (resolveV7Report غير مُوصَل بعد).
      },
    });

    const response = buildResponse(doc, warns);

    ok(warns.length >= 1, '[انحدار A101][V7 ناقص] تحذير واحد على الأقلّ سُجِّل — لا صمت');
    const warnText = warns.join(' | ');
    // S-SUB (2026-10-16، البند ٤): scanId في سطر التحذير مُهشَّر بـhashIdForLog لا خامّ (قرار المستخدم: «scanId: (أ) يُهشَّر في كل سجلّات الخادم»).
    ok(warnText.includes(`(scanId=${hashIdForLog('scan-v7-partial')})`) && !warnText.includes('scan-v7-partial'),
        '[S-SUB][V7 ناقص] سطر التحذير يحمل scanId مُهشَّراً (# + 12 سداسياً) ولا معرّف التقرير الخامّ');
    // البند ٣ (مهمّة 2026-09-21 +03): القائمة الموسَّعة كاملة — كل حقل من
    // الاثني عشر داخل overall + categories/issues + narrative.* الأربعة +
    // narrativeIncomplete* + language، لا الثمانية القديمة وحدها.
    // ملحق verifyReport (أمر مستخدم 2026-10-01 +03) — صار ثلاثة عشر حقلاً
    // داخل overall (harnessErrorMessage انضمّ)، فالمجموع 22 لا 21.
    // S6 (أمر مستخدم 2026-10-01 +03) — narrative.details/narrative.verdict
    // أُزيلا من هذه القائمة عمداً: pickNarrative لم تَعُد تُستدعى لهما في
    // verifyReport.js (راجع تعليق buildV7Response) فلا يدخلان missingKeys
    // أبداً بصرف النظر عن غيابهما الحقيقي هنا — تحقّق سلبي بعد الحلقة.
    for (const key of ['overall.letter', 'overall.letterSource', 'overall.coverage',
      'overall.coveragePct', 'overall.partialAssessment', 'overall.partialAssessmentTag',
      'overall.governingGateReason', 'overall.noDataAtAll', 'overall.zeroMeasuredMessage',
      'overall.abstentionReasons', 'overall.harnessError', 'overall.harnessErrorReason', 'overall.harnessErrorMessage',
      'categories', 'issues', 'narrative.summary',
      'narrative.buyerAdvice.casual', 'narrative.buyerAdvice.gamer', 'narrative.buyerAdvice.photographer',
      'narrativeIncomplete', 'narrativeIncompleteFields', 'language']) {
      ok(warnText.includes(key), `[انحدار A101][V7 ناقص] "${key}" مذكور بالاسم في التحذير — لا "حقل ما" غامض`);
    }
    ok(!warnText.includes('narrative.details') && !warnText.includes('narrative.verdict'),
        '[S6][V7 ناقص] narrative.details/narrative.verdict لا تدخلان missingKeys أبداً — لم تَعُودا تُطلَبان');

    // القيم بالرغم من ذلك آمنة (افتراضية مُعلَنة) — لا رمي، لا undefined يتسرّب إلى JSON.
    const ar2 = response.aiResponse;
    eq(ar2.letter, null, '[V7 ناقص] letter=null الافتراضي الآمن');
    eq(ar2.letterSource, null, '[V7 ناقص] letterSource=null الافتراضي الآمن');
    eq(ar2.coverage, null, '[V7 ناقص] coverage=null الافتراضي الآمن');
    eq(ar2.coveragePct, null, '[البند ٣][V7 ناقص] coveragePct=null الافتراضي الآمن');
    eq(ar2.partialAssessment, false, '[V7 ناقص] partialAssessment=false الافتراضي الآمن');
    eq(ar2.partialAssessmentTag, null, '[البند ٣][V7 ناقص] partialAssessmentTag=null الافتراضي الآمن');
    eq(ar2.governingGateReason, null, '[V7 ناقص] governingGateReason=null الافتراضي الآمن');
    eq(ar2.noDataAtAll, false, '[البند ٣][V7 ناقص] noDataAtAll=false الافتراضي الآمن');
    eq(ar2.zeroMeasuredMessage, null, '[البند ٣][V7 ناقص] zeroMeasuredMessage=null الافتراضي الآمن');
    eq(ar2.abstentionReasons, null, '[البند ٣][V7 ناقص] abstentionReasons=null الافتراضي الآمن');
    eq(ar2.harnessError, false, '[البند ٣][V7 ناقص] harnessError=false الافتراضي الآمن');
    eq(ar2.harnessErrorReason, null, '[البند ٣][V7 ناقص] harnessErrorReason=null الافتراضي الآمن');
    eq(ar2.harnessErrorMessage, null, '[ملحق verifyReport][V7 ناقص] harnessErrorMessage=null الافتراضي الآمن');
    deepEq(ar2.categories, {}, '[V7 ناقص] categories={} الافتراضي الآمن');
    deepEq(ar2.issues, [], '[V7 ناقص] issues=[] الافتراضي الآمن (لا [] بلا أثر — التحذير أعلاه هو الأثر)');
    // S6: details/verdict لم تَعُودا ضمن الشكل المُعاد إطلاقاً (لا حتى null) —
    // الشكل نفسه تغيّر، لا قيمتهما فقط.
    deepEq(ar2.narrative, {summary: null,
      buyerAdvice: {casual: null, gamer: null, photographer: null}},
    '[S6][V7 ناقص] narrative بلا details/verdict إطلاقاً — الافتراضي الآمن لما تبقّى فقط');
    eq(ar2.narrativeIncomplete, false, '[V7 ناقص] narrativeIncomplete=false الافتراضي الآمن');
    deepEq(ar2.narrativeIncompleteFields, [], '[البند ٣][V7 ناقص] narrativeIncompleteFields=[] الافتراضي الآمن');
    eq(ar2.language, 'ar', '[البند ٣][V7 ناقص] language يسقط إلى report.language ("ar") لا يبقى undefined');
    ok(JSON.stringify(response).indexOf('undefined') === -1, '[V7 ناقص] لا "undefined" متسرّبة إلى JSON');
  }
  console.log('تحقّق 2: تقرير V7 ناقص — كل حقل غائب (٢٢ حقلاً) مُسجَّل بالاسم، والقيم الافتراضية آمنة');

  // ═══════════════════════════════════════════════════════════════════════
  // 3. تقرير V6 صريح (pipeline=V6_PIPELINE_TAG) — سلوك V6 كما هو
  // ═══════════════════════════════════════════════════════════════════════
  {
    const doc = fakeDoc('scan-v6-explicit', {
      deviceModel: 'M', shortId: 'NC-V6EXPL', grade: 'B', score: 80,
      createdAt: 'x', language: 'ar', isFreeTrial: false,
      pipeline: V6_PIPELINE_TAG,
      aiResponse: {
        overallGrade: 'B', score: 80, summary: 'ملخّص', verdict: 'حكم', issues: [{id: 1}],
        predicted_problems: [], category_scores: {}, buyer_advice: {}, category_notes: {},
        expected_performance: {}, change_analysis: {},
      },
    });
    const response = buildResponse(doc);
    eq(response.grade, 'B', '[V6 صريح] شكل V6 كما هو — grade على المستوى الأعلى');
    eq(response.aiResponse.overallGrade, 'B', '[V6 صريح] aiResponse.overallGrade كما هو');
    ok(!('letter' in response.aiResponse), '[V6 صريح] لا حقول V7 (letter) تظهر في شكل V6');
  }
  console.log('تحقّق 3: pipeline=V6_PIPELINE_TAG صريحة → شكل V6 دون تغيير');

  // ═══════════════════════════════════════════════════════════════════════
  // 4. تقرير بلا حقل pipeline إطلاقاً — كل المخزون قبل اليوم (الحالة الأهمّ)
  // ═══════════════════════════════════════════════════════════════════════
  {
    const doc = fakeDoc('scan-legacy-no-pipeline', {
      deviceModel: 'M', shortId: 'NC-LEGACY1', grade: 'C', score: 60,
      createdAt: 'x', language: 'ar', isFreeTrial: false,
      // لا pipeline — كل تقرير مخزون اليوم (قبل هذه المهمّة) بهذا الشكل.
      aiResponse: {overallGrade: 'C', score: 60, summary: 's', verdict: 'v', issues: []},
    });
    const response = buildResponse(doc);
    eq(response.grade, 'C', '[الحالة الأهمّ][pipeline غائب] شكل V6 — كل المخزون قبل اليوم');
    ok(!('letter' in response.aiResponse), '[الحالة الأهمّ][pipeline غائب] لا حقول V7 مُختلَقة لتقرير V6 قديم');
  }
  console.log('تحقّق 4: pipeline غائب تماماً (كل المخزون) → شكل V6 — لا محاولة قراءته كـV7');

  // ═══════════════════════════════════════════════════════════════════════
  // 5. قيمة pipeline غير معروفة — تُسجَّل ولا تسقط صامتة، وتُعامَل V6 احتياطاً
  // ═══════════════════════════════════════════════════════════════════════
  {
    const warns = [];
    const doc = fakeDoc('scan-unknown-pipeline', {
      deviceModel: 'M', shortId: 'NC-UNKNOWN', grade: 'A', score: 95,
      createdAt: 'x', language: 'ar', isFreeTrial: false,
      pipeline: 'v8_hypothetical_future',
      aiResponse: {overallGrade: 'A', score: 95, summary: 's', verdict: 'v', issues: []},
    });
    const response = buildResponse(doc, warns);
    ok(warns.length >= 1, '[القاعدة 22][pipeline غير معروفة] تحذير واحد على الأقلّ — لا صمت');
    ok(warns.join(' ').includes('v8_hypothetical_future'),
        '[القاعدة 22][pipeline غير معروفة] القيمة غير المعروفة نفسها مذكورة في التحذير');
    eq(response.grade, 'A', '[pipeline غير معروفة] تُعامَل V6 احتياطاً (الأكثر أماناً — لا حقول V7 من مستند لا يحمل شكلها)');
  }
  console.log('تحقّق 5: قيمة pipeline غير معروفة — تُسجَّل بالاسم، والمعاملة V6 احتياطاً لا عطب');

  console.log(`\nverifyReportV7Whitelist.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('verifyReportV7Whitelist.test.js FAILED:', e);
  process.exit(1);
});
