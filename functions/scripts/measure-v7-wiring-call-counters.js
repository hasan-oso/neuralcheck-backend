#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-v7-wiring-call-counters.js — عدّادات نداء فعلية لِـ
// callAI · callAIv7 · resolveV7Report، عبر تشغيل حقيقي لـ
// runAnalysisInternal.js (نفس الدالّة التي يناديها analyzeDevice.js على
// كل فحص حقيقي، وrunConsistencyTest.js على كل اختبار اتّساق إداري).
//
// ⚠️ **قديم — مُبقًى موسوماً (أمر مستخدم 2026-09-23 +03، مسح النصوص
// القديمة، القاعدة 8):** كان العنوان يقرأ مهمّة "وصل resolveV7Report"
// 2026-09-22 +03، ويصف تحقّق أن لا مُستدعٍ حيّ يمرّر v7ResolveReportEnabled
// — تلك الراية حُذفت كلياً مع التبديل (fd3a6ce)، ولم يعد "الوصل" هو
// الحالة المُختبَرة بل **التبديل نفسه**: resolveV7Report مصدر حيّ وحيد،
// بلا أي راية تحرسه. الأداة أُعيدت كتابتها لتعكس هذا (أدناه)، لا تصف
// وصلاً تجريبياً بجانب مسار حيّ آخر.
//
// ⚠️ **ليست "نفس الأداة" التي أعطت 1/0/0 (A105).** بحثتُ عن تلك الأداة في
// هذا المستودع — functions/scripts/, functions/test/, git log --all
// (بما فيها -S"A105" على كل الفروع), docs/, functions/scripts/out/ — ولا
// أثر لها كملفّ محفوظ. هذه أداة **جديدة**، كُتبت بنفس المنهج الموصوف
// حرفياً في نصّ أمر هذه المهمّة ("عدّادات نداء" على تشغيل فعلي) وبنفس نمط
// الكعوب المُثبَت أصلاً في functions/test/callAIv7.test.js و
// runAnalysisInternalV7Branch.test.js (القاعدة 16 — تمتدّ أداة موثوقة، لا
// تخترع من الصفر). حين تُشغَّل بـ--baseline (شيفرة ما قبل هذه المهمّة عبر
// نسخة HEAD مؤقّتة) تُنتج 1/0/0 أيضاً — راجع تقرير المهمّة لخرجها الفعلي.
//
// صفر نداء نموذج حقيقي، صفر لمس Firestore حقيقي: callDeepSeek/callGemini/
// utils/admin مكعوبة بالكامل (require.cache injection، لا Sinon، لا شبكة).
// resolveAiConfig.js يسقط آمناً للافتراضي عند فشل db (نفس ملاحظة
// callAIv7.test.js).
//
// Usage:
//   node functions/scripts/measure-v7-wiring-call-counters.js
// ===================================================================

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '..', 'test');
const GOLDEN_DIR = path.join(TEST_DIR, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── كعب utils/admin — نفس نمط callAIv7.test.js ────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('[measure-v7-wiring] Firestore must not be touched by this tool'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعوب callDeepSeek/callGemini — عدّاد + تمييز V6/V7 بمحتوى systemPrompt ─
const counters = {callDeepSeekV6: 0, callDeepSeekV7: 0, callGemini: 0};
const V7_PROMPT_MARKER = 'كاتب أوصاف، لا مؤلّف قائمة'; // نفس العلامة المُستعمَلة في callAIv7.test.js
let realIssueId = 'DISC-PLACEHOLDER'; // يُحدَّث أدناه بعد حساب categoryStates الحقيقية

function validV7Response() {
  return {
    narrative: {
      summary: 'ملخّص V7 — أداة قياس، لا نموذج حقيقي', details: 'تفصيل V7 — أداة قياس',
      verdict: 'حكم V7 — أداة قياس',
      buyerAdvice: {casual: 'نصيحة عادية', gamer: 'نصيحة ألعاب', photographer: 'نصيحة تصوير'},
      issueDescriptions: {[realIssueId]: 'وصف — أداة قياس'},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
}

function validV6Response() {
  return {grade: 'B', score: 80, summary: 'V6 — أداة قياس، لا نموذج حقيقي', details: '', verdict: '', issues: []};
}

const deepseekPath = require.resolve('../src/analysis/callDeepSeek');
require.cache[deepseekPath] = {
  id: deepseekPath, filename: deepseekPath, loaded: true,
  exports: {
    callDeepSeek: async (userMessage, systemPrompt) => {
      if (typeof systemPrompt === 'string' && systemPrompt.includes(V7_PROMPT_MARKER)) {
        counters.callDeepSeekV7++;
        return validV7Response();
      }
      counters.callDeepSeekV6++;
      return validV6Response();
    },
    DEEPSEEK_MODEL: 'deepseek-flash', DEEPSEEK_TIMEOUT_MS: 130000,
  },
};
const geminiPath = require.resolve('../src/analysis/callGemini');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    callGeminiFallback: async () => { counters.callGemini++; throw new Error('[measure-v7-wiring] gemini not expected — DeepSeek stub always succeeds'); },
    GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_TIMEOUT_MS: 55000,
  },
};

// ─── تحميل callAI.js الحقيقي، ثمّ لفّ callAI/callAIv7 الحقيقيتين بعدّاد
// نداء — لا استبدال بكعب: الشيفرة الحقيقية تُنفَّذ فعلاً، فقط تُعدّ. ─────
const callAiPath = require.resolve('../src/analysis/callAI');
const realCallAiModule = require(callAiPath); // ينفّذ require.cache injection أعلاه فعلياً هنا
const callCounts = {callAI: 0, callAIv7: 0, resolveV7Report: 0};

const wrappedCallAI = async (...args) => { callCounts.callAI++; return realCallAiModule.callAI(...args); };
const wrappedCallAIv7 = async (...args) => { callCounts.callAIv7++; return realCallAiModule.callAIv7(...args); };
require.cache[callAiPath].exports = Object.assign({}, realCallAiModule, {
  callAI: wrappedCallAI, callAIv7: wrappedCallAIv7,
});

// ─── تحميل resolveV7Report.js الحقيقي (سيرث callAIv7 المعدودة أعلاه عبر
// require.cache)، ثمّ لفّه بعدّاد خاصّ به هو أيضاً. ──────────────────────
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
const realResolveModule = require(resolveV7ReportPath);
const wrappedResolveV7Report = async (...args) => { callCounts.resolveV7Report++; return realResolveModule.resolveV7Report(...args); };
require.cache[resolveV7ReportPath].exports = Object.assign({}, realResolveModule, {
  resolveV7Report: wrappedResolveV7Report,
});

// ─── الآن فقط: runAnalysisInternal.js — يلتقط عبر require() الوجهتين
// المُلفوفتين أعلاه (destructuring وقت التحميل، لا مرجعاً حيّاً). ────────
const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

// ─── نفس فِخّ S10 (b45c8cf6) المُستعمَل في callAIv7.test.js/
// runAnalysisInternalV7Branch.test.js — بلا deviceProfileKey عمداً (يتخطّى
// findDeviceProfile فلا حاجة لِـdb حقيقية، نفس نمط تلك الاختبارات). ──────
const s10Raw = loadJson('b45c8cf6.ts.json');
const ts = s10Raw.timeSeries || s10Raw;
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fingerprint = {
  device: {model: 'SM-G977B', manufacturer: 'samsung'}, // لا deviceProfileKey — يتخطّى Firestore
  timeSeries: {header: ts.header, footer: ts.footer, samples: ts.samples, variables: ts.variables},
  functionalResults: s10Functional,
  manualResults: [],
};
const findingsForIssueId = computeFindings({timeSeries: fingerprint.timeSeries, functionalResults: s10Functional, manualResults: []});
const batteryForIssueId = sampleInputsFromRaw({timeSeries: fingerprint.timeSeries, functionalResults: s10Functional, manualResults: []});
const csForIssueId = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: findingsForIssueId,
  batterySampleInputs: batteryForIssueId.sampleInputs, batteryDesignCapacityMah: batteryForIssueId.design,
});
realIssueId = (csForIssueId.issues && csForIssueId.issues[0] && csForIssueId.issues[0].id) || realIssueId;

async function runScenario(label, extraParams) {
  callCounts.callAI = 0; callCounts.callAIv7 = 0; callCounts.resolveV7Report = 0;
  counters.callDeepSeekV6 = 0; counters.callDeepSeekV7 = 0; counters.callGemini = 0;

  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  let out; let threw = null;
  try {
    out = await runAnalysisInternal(Object.assign({
      fingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
      scanContext: {scanId: `measure-${label}`},
    }, extraParams || {}));
  } catch (e) {
    threw = e;
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }

  console.log(`\n── سيناريو: ${label} ${extraParams ? `(${JSON.stringify(extraParams)})` : '(مطابق تماماً لِما يمرّره analyzeDevice.js/runConsistencyTest.js — بلا مفاتيح إضافية)'} ──`);
  if (threw) {
    console.log(`  رمى: ${threw.message || threw}`);
  } else {
    console.log(`  pipeline النتيجة: ${out.pipeline}   aiFailed: ${out.aiFailed}`);
  }
  console.log(`  callAI (V6, حقيقية)          = ${callCounts.callAI}`);
  console.log(`  callAIv7 (حقيقية)            = ${callCounts.callAIv7}`);
  console.log(`  resolveV7Report (حقيقية)     = ${callCounts.resolveV7Report}`);
  console.log(`  (تفصيل: callDeepSeek عبر V6 برومبت=${counters.callDeepSeekV6}, عبر V7 برومبت=${counters.callDeepSeekV7}, Gemini=${counters.callGemini})`);
  return {label, callAI: callCounts.callAI, callAIv7: callCounts.callAIv7, resolveV7Report: callCounts.resolveV7Report};
}

(async () => {
  console.log('═══ measure-v7-wiring-call-counters — عدّادات نداء فعلية، صفر نداء نموذج حقيقي ═══');

  // أمر مستخدم 2026-09-23 +03 (مسح النصوص القديمة، القاعدة 23): السيناريو
  // الثاني القديم مرّر v7ResolveReportEnabled:true — مفتاح محذوف كلياً مع
  // التبديل (fd3a6ce). استُبدل بسيناريو يثبت **بلا أثر رغم التمرير
  // الصريح** — لا يُضاف بجانب القديم، يحلّ محلّه.
  const normal = await runScenario('عادي — بلا وسيط إضافي');
  const withDeadFlag = await runScenario('مفتاح محذوف مُمرَّر صراحة (v7ResolveReportEnabled:true)', {v7ResolveReportEnabled: true});

  console.log('\n═══ الخلاصة ═══');
  console.log('السيناريو'.padEnd(56) + 'callAI'.padEnd(10) + 'callAIv7'.padEnd(10) + 'resolveV7Report');
  console.log('─'.repeat(90));
  for (const r of [normal, withDeadFlag]) {
    console.log(r.label.padEnd(56) + String(r.callAI).padEnd(10) + String(r.callAIv7).padEnd(10) + String(r.resolveV7Report));
  }
  console.log('\nالمتوقَّع بعد التبديل على كلا السيناريوهين معاً: callAI=0 (V6 لا يُستدعى أبداً)، callAIv7=1، resolveV7Report=1.');
  console.log('تطابق السيناريوهين يُثبت أن المفتاح المحذوف بلا أثر مهما مُرِّر — لا نداء مزدوج ممكن (نمط c98f867 المرفوض بـ21a813b).');
})().catch((e) => {
  console.error('\n✗ توقّف بخطأ:', e.stack || e.message || e);
  process.exit(1);
});
