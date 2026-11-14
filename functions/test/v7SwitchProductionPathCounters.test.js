'use strict';

// v7SwitchProductionPathCounters.test.js — أمر مستخدم 2026-09-23 +03 (أمر
// التبديل، بعد A125)، البند (هـ) — الإثبات، بتشغيل لا بقراءة:
//
// "عدّادات النداء على كل مسار: فحص جديد، وتوقيع مختلف، وprofile قديم بلا
// توقيع، وإصابة الكاش. المطلوب callAI في V6 = 0، وresolveV7Report = 1،
// وapplyV7Adjustments = 1 بالضبط." و"القاعدة 37: اختبار واحد على الأقلّ
// يمرّ بمسار الإنتاج كاملاً، ولا يُستبدَل فيه إلا globalThis.fetch، بردود
// حقيقية مُجمَّدة. وFirestore بفخّ أو في الذاكرة."
//
// سيناريو ١ (فحص جديد) يستوفي القاعدة 37 كاملة: globalThis.fetch وحده
// مُستبدَل، بردّ DeepSeek حقيقي مُجمَّد (frozen-real-envelope-b45c8cf6-
// accepted-2026-09-23.json، نفس الثابت المُستهلَك في resolveV7ReportSimulateScenarios.test.js
// البند ٧) — resolveV7Report/callAIv7/callDeepSeek/applyV7Adjustments/
// buildDisplayShapeV7 كلّها حقيقية غير مُعدَّلة. السيناريوهات ٢-٤ تستهلك
// نفس فخّ fetch (لا Firestore حيّ في أيّ سيناريو — فخّ أو ذاكرة).
//
// Run: node functions/test/v7SwitchProductionPathCounters.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozenEnvelope(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')).rawEnvelope; }

// أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل» — الأصل
// frozen-real-envelope-b45c8cf6-accepted-2026-09-23.json صار مرفوضاً
// فعلاً من الحارس بعد أمر 2026-09-27 +03 «الإعدادات لا تُنزل الحرف»
// (issueKeys: ستّة معرّفات مخترَعة) — لم يعد يمرّ من المحاولة الأولى، وهذا
// السيناريو يحتاج ذلك تحديداً (fetch=1، applyV7Adjustments=1). الأصل بلا
// مساس؛ ملفّ مشتقّ منفصل موسوم صراحة يحلّ محله هنا (نفس الملفّ المُستهلَك
// في resolveV7ReportSimulateScenarios.test.js — راجع generate-derived-
// from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted.js للتعديل
// الوحيد وسببه).
const B45_ACCEPTED_ENVELOPE = loadFrozenEnvelope('derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v4-2026-10-07.json');

// ─── فخّ الشبكة — globalThis.fetch وحده (القاعدة 37) ────────────────────
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
  return {
    ok: true, status: 200,
    json: async () => B45_ACCEPTED_ENVELOPE,
    text: async () => JSON.stringify(B45_ACCEPTED_ENVELOPE),
  };
};

// ─── فخّ/ذاكرة Firestore — settings (ai/geminiFallback/cache) 404 دائماً
// (يطابق واقع الإنتاج المنقول)، وscanSessions/deviceProfiles/reports في
// الذاكرة (Map) للتحكّم بسيناريوهات التوقيع/الكاش. ────────────────────
const memProfiles = new Map(); // profileId -> {scanHistory:[...]}
const memReports = new Map(); // reportPath -> {aiResponse}
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {
      collection: (name) => {
        if (name === 'settings') {
          return {doc: () => ({get: async () => ({exists: false})})};
        }
        if (name === 'deviceProfiles') {
          return {doc: (id) => ({
            get: async () => ({exists: memProfiles.has(id), data: () => memProfiles.get(id)}),
          })};
        }
        throw new Error(`TRAP: unexpected collection "${name}"`);
      },
      doc: (docPath) => ({
        get: async () => ({
          exists: memReports.has(docPath),
          data: () => memReports.get(docPath),
        }),
      }),
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── ترتيب اللفّ حاسم: buildV7Payload.js يُلفّ **أولاً** — قبل أي require
// لـcallAI.js أو resolveV7Report.js (كلاهما يستوردان applyV7Adjustments/
// buildV7Payload منه عبر destructuring وقت التحميل؛ لو لُفّ بعدهما، بقيت
// مراجعهما الداخلية مربوطة بالدالّة الأصلية غير المعدودة — فخّ require.cache
// كلاسيكي، مُكتشَف بتشغيل فعلي (0 بدل 1) لا بالقراءة). ────────────────────
const counts = {callAI: 0, resolveV7Report: 0, applyV7Adjustments: 0};

const buildV7PayloadPath = require.resolve('../src/analysis/buildV7Payload');
const realBuildV7PayloadModule = require(buildV7PayloadPath);
require.cache[buildV7PayloadPath].exports = Object.assign({}, realBuildV7PayloadModule, {
  applyV7Adjustments: (...args) => { counts.applyV7Adjustments++; return realBuildV7PayloadModule.applyV7Adjustments(...args); },
});

// ─── لفّ callAI/callAIv7 (V6/V7) بعدّاد — الدوالّ الحقيقية تُنفَّذ فعلاً،
// وتستورد buildV7Payload المُلفوفة أعلاه فعلاً (require.cache مُهيَّأ الآن). ─
const callAiPath = require.resolve('../src/analysis/callAI');
const realCallAiModule = require(callAiPath);
require.cache[callAiPath].exports = Object.assign({}, realCallAiModule, {
  callAI: async (...args) => { counts.callAI++; return realCallAiModule.callAI(...args); },
});

// ─── لفّ resolveV7Report بعدّاد — يستورد applyV7Adjustments المُلفوفة
// أعلاه أيضاً (نفس السبب). ───────────────────────────────────────────────
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
const realResolveModule = require(resolveV7ReportPath);
require.cache[resolveV7ReportPath].exports = Object.assign({}, realResolveModule, {
  resolveV7Report: async (...args) => { counts.resolveV7Report++; return realResolveModule.resolveV7Report(...args); },
});

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');

const raw = loadGolden('b45c8cf6.ts.json');
const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fingerprintBase = {
  device: {model: 'SM-G977B', manufacturer: 'samsung'},
  timeSeries: raw.timeSeries || raw,
  functionalResults: functional,
  manualResults: [],
};

function resetCounts() {
  fetchCallCount = 0;
  counts.callAI = 0; counts.resolveV7Report = 0; counts.applyV7Adjustments = 0;
}

async function runQuiet(params) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  try {
    return await runAnalysisInternal(params);
  } finally {
    console.log = real.log; console.warn = real.warn; console.error = real.error;
  }
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — فحص جديد (بلا deviceProfileKey) — القاعدة 37 كاملة: fetch وحده
  // مُستبدَل، مسار الإنتاج الحقيقي بأكمله (resolveV7Report→callAIv7→
  // callDeepSeek→guardV7Response→applyV7Adjustments→buildDisplayShapeV7).
  // ═══════════════════════════════════════════════════════════════════
  resetCounts();
  const out1 = await runQuiet({
    fingerprint: fingerprintBase, language: 'ar', deepseekKey: 'k', geminiKey: undefined,
    scanContext: {scanId: 'switch-proof-new-scan'},
  });
  eq(counts.callAI, 0, '[١ فحص جديد] callAI (V6) = 0 بالضبط');
  eq(counts.resolveV7Report, 1, '[١ فحص جديد] resolveV7Report = 1 بالضبط');
  eq(counts.applyV7Adjustments, 1, '[١ فحص جديد] applyV7Adjustments = 1 بالضبط (مسار الإنتاج الحقيقي كاملاً)');
  eq(fetchCallCount, 1, '[١ فحص جديد] fetch حقيقي واحد فقط (جسم مقبول من المحاولة الأولى، لا محاولة٢)');
  eq(out1.aiFailed, false, '[١ فحص جديد] aiFailed=false');
  eq(out1.pipeline, 'v7_findings_based', '[١ فحص جديد] pipeline=v7_findings_based');
  ok(out1.aiResult && out1.aiResult.overall && typeof out1.aiResult.overall.letter === 'string',
      '[١ فحص جديد] aiResult.overall.letter حرف حقيقي');
  console.log(`تحقّق ١ (فحص جديد): callAI=0، resolveV7Report=1، applyV7Adjustments=1، fetch=1 — letter=${out1.aiResult.overall.letter}`);

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — توقيع مختلف (profile موجود، لكن drift ≥20% يفرض تقييماً مستقلاً) —
  // نفس مسار الإنتاج، لكن مع profile سابق موجود في الذاكرة بتوقيع مختلف
  // جذرياً (بصمة زمنية مُصطنَعة مختلفة تماماً تُنتج drift كبيراً).
  // ═══════════════════════════════════════════════════════════════════
  {
    const profileKey = {a: 'profile-diff-sig'};
    const differentFp = {
      ...fingerprintBase,
      timeSeries: {...fingerprintBase.timeSeries, stats: {tempPeak: 999, throttlePercent: 99, drainRate: 99, gpuFpsAvg: 1}},
    };
    memProfiles.set('profile-diff-sig', {
      scanHistory: [{
        scanId: 'old-scan-diff-sig', reportRef: 'reports/old-scan-diff-sig', scanDate: new Date(),
        signature: {...computeScanSignature(fingerprintBase), pipelineVersion: 'other-version-forces-miss'},
      }],
    });
    resetCounts();
    const out2 = await runQuiet({
      fingerprint: {...differentFp, device: {...differentFp.device, deviceProfileKey: profileKey}},
      language: 'ar', deepseekKey: 'k', geminiKey: undefined,
      scanContext: {scanId: 'switch-proof-diff-sig'},
    });
    eq(counts.callAI, 0, '[٢ توقيع مختلف] callAI (V6) = 0 بالضبط');
    eq(counts.resolveV7Report, 1, '[٢ توقيع مختلف] resolveV7Report = 1 بالضبط (drift يفرض تقييماً مستقلاً، لا كاش)');
    eq(counts.applyV7Adjustments, 1, '[٢ توقيع مختلف] applyV7Adjustments = 1 بالضبط');
    console.log('تحقّق ٢ (توقيع مختلف/pipeline_changed): callAI=0، resolveV7Report=1، applyV7Adjustments=1');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — profile قديم بلا توقيع (legacy — lastScan.signature غائب) — يمرّر
  // previousScan للتوافق، ويستدعي resolveV7Report عادياً (لا كاش، لأن
  // الفرع legacy لا يقرأ cachedReportToReuse أصلاً).
  // ═══════════════════════════════════════════════════════════════════
  {
    const profileKey = {a: 'profile-legacy-no-sig'};
    memProfiles.set('profile-legacy-no-sig', {
      scanHistory: [{
        scanId: 'old-scan-legacy', reportRef: 'reports/old-scan-legacy', scanDate: new Date(),
        // لا .signature إطلاقاً — الفرع legacy في runAnalysisInternal.js
      }],
    });
    resetCounts();
    const out3 = await runQuiet({
      fingerprint: {...fingerprintBase, device: {...fingerprintBase.device, deviceProfileKey: profileKey}},
      language: 'ar', deepseekKey: 'k', geminiKey: undefined,
      scanContext: {scanId: 'switch-proof-legacy-no-sig'},
    });
    eq(counts.callAI, 0, '[٣ profile بلا توقيع] callAI (V6) = 0 بالضبط');
    eq(counts.resolveV7Report, 1, '[٣ profile بلا توقيع] resolveV7Report = 1 بالضبط');
    eq(counts.applyV7Adjustments, 1, '[٣ profile بلا توقيع] applyV7Adjustments = 1 بالضبط');
    console.log('تحقّق ٣ (profile قديم بلا توقيع): callAI=0، resolveV7Report=1، applyV7Adjustments=1');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — إصابة الكاش (signature match ضمن العتبة) — resolveV7Report **لا
  // تُستدعى إطلاقاً**: الكاش يعود قبل أي نداء نموذج (runAnalysisInternal.js:
  // "إذا تطابق signature، أعد التقرير القديم بدون استدعاء النموذج"،
  // يعود قبل قسم "2. تحليل AI" بأكمله). المطلوب هنا صفر/صفر/صفر — ذُكر
  // صراحةً لأن نصّ الأمر عدّد الكاش ضمن المسارات المُقاسة، لا لأنه يُنتج
  // نفس ١/١ — القياس هو الإثبات، لا الافتراض.
  //
  // القرار ٥ للكاش مُعطَّل افتراضياً (resolveCacheConfig.js) — نحتاج
  // تفعيله صراحةً هنا فقط لإثبات هذا المسار تحديداً.
  // ═══════════════════════════════════════════════════════════════════
  {
    const cachePath = adminPath; // نفس فخّ admin — نُضيف مستند cache مفعَّلاً
    const origCollection = require.cache[cachePath].exports.db.collection;
    require.cache[cachePath].exports.db.collection = (name) => {
      if (name === 'settings') {
        return {doc: (d) => ({get: async () => (d === 'cache' ? {exists: true, data: () => ({reuseEnabled: true})} : {exists: false})})};
      }
      return origCollection(name);
    };

    const profileKey = {a: 'profile-cache-hit'};
    const sigMatch = computeScanSignature(fingerprintBase);
    memProfiles.set('profile-cache-hit', {
      scanHistory: [{scanId: 'old-scan-cache-hit', reportRef: 'reports/old-scan-cache-hit', scanDate: new Date(), signature: sigMatch}],
    });
    memReports.set('reports/old-scan-cache-hit', {
      aiResponse: {pipeline: 'v7_findings_based', overall: {letter: 'B'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
    });

    resetCounts();
    const out4 = await runQuiet({
      fingerprint: {...fingerprintBase, device: {...fingerprintBase.device, deviceProfileKey: profileKey}},
      language: 'ar', deepseekKey: 'k', geminiKey: undefined,
      scanContext: {scanId: 'switch-proof-cache-hit'},
    });
    eq(counts.callAI, 0, '[٤ إصابة الكاش] callAI (V6) = 0');
    eq(counts.resolveV7Report, 0, '[٤ إصابة الكاش] resolveV7Report = 0 — الكاش يعود قبل أي نداء نموذج');
    eq(counts.applyV7Adjustments, 0, '[٤ إصابة الكاش] applyV7Adjustments = 0');
    eq(fetchCallCount, 0, '[٤ إصابة الكاش] fetch = 0 — صفر طلب شبكة إطلاقاً');
    eq(out4.pipeline, 'cached', '[٤ إصابة الكاش] pipeline="cached" (إشارة داخلية، لا تصل aiResponse.pipeline المخزون)');
    eq(out4.aiResult.overall.letter, 'B', '[٤ إصابة الكاش] الحرف من التقرير القديم المُعاد كما هو');
    console.log('تحقّق ٤ (إصابة الكاش): callAI=0، resolveV7Report=0، applyV7Adjustments=0، fetch=0 — مُقاس لا مُفترَض');
  }

  console.log(`\nv7SwitchProductionPathCounters.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
