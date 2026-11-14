'use strict';

// geminiFallbackFlag.test.js — أمر مستخدم 2026-09-23 +03، القرار ٢:
// "Gemini: راية تطفئه، مطفأة افتراضياً... والاختبارات بالقيم (القاعدة 30):
//   - الراية غائبة ← صفر طلب Gemini، وعرض حتمي كامل بالسبب المُسمّى.
//   - الراية false ← النتيجة نفسها.
//   - الراية true ← Gemini يُستدعى، عبر fetch مُحاكى.
//   - ومسار V6 بلا تغيير."
//
// حدّ الاستبدال: globalThis.fetch وحده (+ فخّ Firestore القياسي لهذا
// المستودع لِـsettings/ai وsettings/geminiFallback، محاكياً 404 الإنتاج
// الفعلي حين "غائبة"). resolveV7Report → callAIv7 → resolveGeminiFallbackConfig
// → (عند true) callGeminiFallback → @google/generative-ai → fetch — كلّها
// حقيقية غير مُعدَّلة (نفس منهج callDeepSeekV7ShapeE2E.test.js، القرار ٣،
// القاعدة 37).
//
// Run: node functions/test/geminiFallbackFlag.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ─── فخّ Firestore — settings/ai وsettings/geminiFallback، بحالة قابلة
// للتغيير بين السيناريوهات (كلاهما 404 في الإنتاج الفعلي اليوم — منقول من
// المنسّق، NEURALCHECK-FINDINGS.md:214، غير متحقَّق من هنا) ─────────────
let geminiFallbackDocState = 'absent'; // 'absent' | false | true
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {
      collection: (name) => {
        if (name !== 'settings') throw new Error(`TRAP: unexpected collection "${name}"`);
        return {
          doc: (docId) => ({
            get: async () => {
              if (docId === 'ai') return {exists: false}; // settings/ai 404 — نفس واقع الإنتاج
              if (docId === 'geminiFallback') {
                if (geminiFallbackDocState === 'absent') return {exists: false};
                return {exists: true, data: () => ({enabled: geminiFallbackDocState})};
              }
              throw new Error(`TRAP: unexpected settings doc "${docId}"`);
            },
          }),
        };
      },
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── globalThis.fetch وحده — يُميَّز حسب المضيف (DeepSeek/Gemini) ───────
let fetchLog = []; // [{host, url}]
let deepseekQueue = [];
global.fetch = async (url) => {
  const host = new URL(String(url)).host;
  fetchLog.push({host, url: String(url)});
  if (host === 'api.deepseek.com') {
    if (deepseekQueue.length === 0) throw new Error('TRAP: deepseekQueue empty');
    return {ok: true, status: 200, json: async () => deepseekQueue.shift(), text: async () => 'x'};
  }
  if (host === 'generativelanguage.googleapis.com') {
    // نجاح مُحاكى — جسم Gemini حقيقي البنية (candidates[].content.parts[].text)
    const body = geminiResponseContent();
    return {
      ok: true, status: 200,
      json: async () => ({
        candidates: [{content: {parts: [{text: JSON.stringify(body)}]}, finishReason: 'STOP'}],
        usageMetadata: {promptTokenCount: 1000, candidatesTokenCount: 2000, totalTokenCount: 3000},
      }),
      text: async () => 'gemini-raw',
    };
  }
  throw new Error(`TRAP: unexpected fetch host "${host}"`);
};

// أيّ جسم يُعيده Gemini المُحاكى — قابل للتبديل بين V7 (سيناريو ٣) وV6
// (سيناريو ٤-ضابط، shapeSpec مختلفة كلياً عبر resolveGeminiFallback نفسها
// مقابل V6's callGeminiFallback بلا shapeSpec — REPORT_SHAPE_KEYS الافتراضية).
let geminiResponseContent = validV7ReportJson;

function validV7ReportJson() {
  // ⚠️ لا كلمة إنجليزية داخل أي نصّ هنا — الحارس الحقيقي (languageValidator.js)
  // يرفضها فعلياً (وقع هذا حرفياً أثناء بناء هذا الاختبار: "Gemini" داخل
  // النصّ العربي رفعت languageLeaks=3 وسبَّبت محاولة٢ غير مقصودة — عطب في
  // بيانات الاختبار لا في resolveV7Report، صُحِّح هنا).
  return {
    narrative: {
      summary: 'ملخّص نظيف من المزوّد الاحتياطي', details: 'تفصيل نظيف من المزوّد الاحتياطي', verdict: 'حكم نظيف من المزوّد الاحتياطي',
      buyerAdvice: {casual: 'ن', gamer: 'ن', photographer: 'ن'}, issueDescriptions: {},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
}

function validV6ReportJson() {
  return {
    summary: 'ملخّص V6 نظيف', grade: 'B', score: 80, details: 'تفصيل V6 نظيف', verdict: 'حكم V6 نظيف',
    issues: [], predictedProblems: [], categoryScores: {}, buyerAdvice: 'نصيحة V6 نظيفة', performanceContext: 'سياق V6 نظيف',
  };
}

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {clearGeminiFallbackConfigCache} = require('../src/utils/resolveGeminiFallbackConfig');

function deepseekHardFailEnvelope() {
  // envelope خطأ داخل HTTP 200 (provider_error) — retryable:false في
  // callDeepSeek.js فلا تُعاد المحاولة داخلياً؛ فشل صلب فوري كافٍ لهذا
  // الاختبار (يخصّ سلوك راية Gemini، لا سياسة إعادة محاولة DeepSeek —
  // تلك مُختبَرة في aiCallShape.test.js/resolveV7Report.test.js).
  return {error: {message: 'DeepSeek down (simulated)', type: 'server_error', code: 'internal_error'}};
}

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const raw = loadGolden('b45c8cf6.ts.json');
const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
const findings = computeFindings(fp);
const inputs = sampleInputsFromRaw(raw);
const categoryStates = computeCategoryStates({
  functionalResults: functional, manualResults: [], dev: null, findings,
  batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
});

function baseParams() {
  return {
    findings, categoryStates, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-stubbed', geminiApiKey: 'irrelevant-fetch-stubbed',
  };
}

// DeepSeek يفشل مرّتين (طلبان — retry الداخلي في callDeepSeekWithRetry
// يحتاج طلبَين HTTP فعليَّين قبل أن يستسلم وينتقل لمنطق Gemini/التعطيل).
function queueDeepSeekHardFailTwice() {
  deepseekQueue = [deepseekHardFailEnvelope(), deepseekHardFailEnvelope()];
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — الراية غائبة (404، واقع الإنتاج) ← صفر طلب Gemini، عرض حتمي كامل.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = 'absent'; clearGeminiFallbackConfigCache();
  fetchLog = []; queueDeepSeekHardFailTwice();
  const r1 = await resolveV7Report(baseParams());
  const geminiCalls1 = fetchLog.filter((f) => f.host === 'generativelanguage.googleapis.com');
  eq(geminiCalls1.length, 0, '[١] الراية غائبة — صفر طلب Gemini');
  eq(r1.guardFinal.ok, false, '[١] guardFinal.ok=false');
  ok(r1.audit.regeneration.rounds[0].rejectedReasons.some((rr) => rr.startsWith('PROVIDER_FAILED_NO_FALLBACK:')),
      '[١] PROVIDER_FAILED_NO_FALLBACK مُسجَّل');
  eq(r1.display.narrativeIncomplete, true, '[١] narrativeIncomplete=true — السرد غائب');
  ok(typeof r1.display.overall.letter !== 'undefined' && Array.isArray(r1.audit.gatesApplied),
      '[١] الحرف/البوّابات حاضران كاملَين — عرض حتمي كامل رغم غياب السرد');
  console.log(`تحقّق ١: الراية غائبة (404) ← صفر طلب Gemini (${fetchLog.length} طلب DeepSeek فقط)، عرض حتمي كامل`);

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الراية false صراحةً ← نفس نتيجة الغياب.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = false; clearGeminiFallbackConfigCache();
  fetchLog = []; queueDeepSeekHardFailTwice();
  const r2 = await resolveV7Report(baseParams());
  const geminiCalls2 = fetchLog.filter((f) => f.host === 'generativelanguage.googleapis.com');
  eq(geminiCalls2.length, 0, '[٢] الراية false — صفر طلب Gemini');
  eq(r2.guardFinal.ok, false, '[٢] نفس نتيجة الغياب — guardFinal.ok=false');
  ok(r2.audit.regeneration.rounds[0].rejectedReasons.some((rr) => rr.startsWith('PROVIDER_FAILED_NO_FALLBACK:')),
      '[٢] نفس السبب المُسمّى PROVIDER_FAILED_NO_FALLBACK');
  console.log('تحقّق ٢: الراية false صراحةً ← نفس نتيجة الغياب تماماً');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — الراية true ← Gemini يُستدعى فعلياً عبر fetch مُحاكى، وينجح.
  // ═══════════════════════════════════════════════════════════════════
  geminiFallbackDocState = true; clearGeminiFallbackConfigCache();
  fetchLog = []; queueDeepSeekHardFailTwice();
  const r3 = await resolveV7Report(baseParams());
  const geminiCalls3 = fetchLog.filter((f) => f.host === 'generativelanguage.googleapis.com');
  eq(geminiCalls3.length, 1, '[٣] الراية true — Gemini استُدعيت مرّة فعلياً عبر fetch مُحاكى');
  eq(r3.aiModel, 'gemini-2.5-flash', '[٣] aiModel=Gemini — سقط إليه فعلياً بعد فشل DeepSeek');
  eq(r3.guardFinal.ok, true, '[٣] رد Gemini النظيف يجتاز الحارس');
  eq(r3.display.narrativeIncomplete, false, '[٣] narrativeIncomplete=false — سرد كامل من Gemini');
  console.log('تحقّق ٣: الراية true ← Gemini استُدعيت فعلياً (fetch مُحاكى)، aiModel=gemini، guardFinal.ok=true');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — ضابط V6: callAI (الإنتاج الحيّ) لا يقرأ هذه الراية إطلاقاً — يستدعي
  // Gemini بلا شرط عند فشل DeepSeek، بصرف النظر عن geminiFallbackDocState.
  // ═══════════════════════════════════════════════════════════════════
  const {callAI} = require('../src/analysis/callAI');
  geminiFallbackDocState = 'absent'; clearGeminiFallbackConfigCache(); // لو كان V6 يقرأ الراية خطأً لَمَا استدعى Gemini هنا
  geminiResponseContent = validV6ReportJson; // V6 يفحص شكل V3/V5/V6 (REPORT_SHAPE_KEYS الافتراضية)، لا V7
  fetchLog = []; queueDeepSeekHardFailTwice();
  const v6Result = await callAI(
      {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []},
      'ar', {scanId: 'v6-control'}, null, 'k', 'g',
  );
  const geminiCallsV6 = fetchLog.filter((f) => f.host === 'generativelanguage.googleapis.com');
  eq(geminiCallsV6.length, 1, '[٤-ضابط] V6 يستدعي Gemini بلا شرط رغم أن الراية "absent" — لا يقرؤها إطلاقاً');
  eq(v6Result.aiModel, 'gemini-2.5-flash', '[٤-ضابط] aiModel=Gemini على V6 كما كان دائماً');
  console.log('تحقّق ٤: ضابط — V6 (callAI) يستدعي Gemini بلا شرط، لا يقرأ راية geminiFallback إطلاقاً');

  console.log(`\ngeminiFallbackFlag.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
