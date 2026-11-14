'use strict';

// resolveV7ReportSimulateScenarios.test.js — أمر مستخدم 2026-09-23 +03،
// البند ٧: "ملفّ اختبار في test/ يشغّل سيناريوهات --simulate كلّها...
// بفخّ شبكة يُسقط الاختبار لو خرج طلب حقيقي. ومصدر الأجسام ملفّات
// متتبَّعة، لا scripts/out غير المتتبَّع." و"تنتقل المحاكاة إلى مجموعة
// الاختبارات... ما ليس في المجموعة يمرّ مكسوراً والاختبارات خضراء."
//
// حدّ الاستبدال: globalThis.fetch وحده (يفحص المضيف صراحة، يرمي TRAP على
// أي مضيف أو نداء غير متوقَّع — لا احتمال لطلب حقيقي يهرب) + فخّ Firestore
// القياسي. resolveV7Report → callAIv7 → callDeepSeekWithRetry →
// callDeepSeek → guardV7Response كلّها حقيقية غير مُعدَّلة (القاعدة 37).
//
// **لا يستورد measure-resolveV7Report-live.js**: ذلك الملفّ سكربت CLI بلا
// module.exports وبلا حارس require.main — يُنفِّذ main() فوراً عند أي
// require (قد يكتب إلى scripts/out أو يحاول شبكة حقيقية بلا --simulate/
// --dry-run). السيناريوهات الستّة أدناه إعادة بناء مستقلّة، بنفس الأجسام
// الحقيقية المجمَّدة في test/fixtures/ (لا scripts/out)، تستهلك
// resolveV7Report الحقيقي مباشرة — لا فرق سلوكي عن نسخة السكربت.
//
// **خارج نطاق هذا الملفّ عمداً (موثَّق في تقرير المهمّة، لا سهو)**: سيناريوَا
// "بلوغ السقف" و"التنقية" في السكربت (المصدر: measure-resolveV7Report-live.js
// أسطر ~594-639) يختبران غلاف fetch الدفاعي الخاصّ بالسكربت نفسه
// (MAX_NETWORK_REQUESTS/sanitizeText/buildKeyFragments) — منطق حصري داخل
// السكربت (grep عبر src/test/scripts: صفر نسخة مُصدَّرة)، متشابك مع تركيب
// global.fetch عند تحميل الوحدة، لا مع resolveV7Report/callAIv7 الحقيقيين.
// استخراجه بأمان يحتاج فصل السكربت إلى وحدة قابلة للاستيراد + غلاف CLI رفيع
// — إعادة هيكلة لم تُطلَب صراحة، ولم أنفِّذها من تلقاء نفسي (القاعدة 13).
//
// Run: node functions/test/resolveV7ReportSimulateScenarios.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozenEnvelope(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')).rawEnvelope;
}

// ─── فخّ Firestore القياسي ──────────────────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── فخّ الشبكة — globalThis.fetch وحده، يرمي على أي مضيف غير DeepSeek أو
// أي نداء يتجاوز الطابور المُهيَّأ لهذا السيناريو تحديداً (صفر احتمال هروب
// طلب حقيقي — إن حاول أي كود نداء fetch حقيقياً فسيصطدم بهذا الفخّ لا
// بشبكة حقيقية، لأن global.fetch هذا هو الوحيد المُعرَّف في العملية) ────
let fetchQueue = [];
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) {
    throw new Error(`TRAP: real/unexpected network host reached — ${url} (Gemini أو أي مضيف آخر لا يجب أن يُستدعى هنا)`);
  }
  if (fetchQueue.length === 0) throw new Error('TRAP: fetch queue empty — نداء غير متوقَّع، أكثر من السيناريو المُهيَّأ');
  const envelope = fetchQueue.shift();
  return {ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope)};
};

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

// ─── الأجسام الحقيقية — نفس LIVE_FILES التي يستهلكها السكربت (القاعدة 24،
// راجع تعليق _provenance في كل ثابت مُجمَّد) ─────────────────────────────
// أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل» — بعد أمر
// 2026-09-27 +03 «الإعدادات لا تُنزل الحرف»، B45_ACCEPTED وD34_ACCEPTED
// الأصليّان صارا **مرفوضين** فعلياً من الحارس (issueKeys؛ وD34 أيضاً
// numbers) على categoryStates الجديدة — مُتحقَّق بتشغيل مباشر. الملفّان
// الأصليّان بلا مساس (tracked، نظيفان)؛ السيناريوهات التي تحتاج ردّاً
// *مقبولاً* لاختبار آلية إعادة التوليد نفسها (لا صحّة الحارس) تستعمل
// بدلاً منهما ملفّين مشتقّين موسومين صراحة (generate-derived-from-frozen-
// real-2026-09-23-envelope-{b45c8cf6,34dff2b8}-accepted.js يوثّقان
// التعديلين بالضبط وسببيهما). B45_REJECTED يبقى كما هو — لا يزال مرفوضاً
// فعلياً (سببه الأصلي "ot" لا يزال قائماً، بصرف النظر عن السبب الإضافي
// الجديد)، فلا حاجة لأي فِخّ مشتقّ له.
const B45_REJECTED = loadFrozenEnvelope('frozen-real-envelope-b45c8cf6-rejected-2026-09-23.json');
const B45_ACCEPTED = loadFrozenEnvelope('derived-from-frozen-real-2026-09-23-envelope-b45c8cf6-accepted-v4-2026-10-07.json');
const D34_ACCEPTED = loadFrozenEnvelope('derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted-v3-2026-10-07.json');

function envelopeResponse(rawEnvelope) { return rawEnvelope; }

function buildScanInputs(scanId, tsFile) {
  const raw = loadGolden(tsFile);
  const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  return {findings, categoryStates, scanId};
}

const b45 = buildScanInputs('b45c8cf6-e376-4765-8703-f68e9bc69844', 'b45c8cf6.ts.json');
const d34 = buildScanInputs('34dff2b8-ce9e-4b40-86a9-1976c878e195', '34dff2b8.ts.json');

function paramsFor(ctx, deadline) {
  return {
    findings: ctx.findings, categoryStates: ctx.categoryStates, language: 'ar',
    scanContext: {scanId: ctx.scanId, isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'SIMULATED-NOT-REAL', geminiApiKey: undefined,
    deadline,
  };
}

async function runScenario(name, ctx, queue, expectFn, deadline) {
  fetchQueue = queue;
  fetchCallCount = 0;
  let result = null; let threw = null;
  try {
    result = await resolveV7Report(paramsFor(ctx, deadline));
  } catch (e) {
    threw = String((e && e.message) || e);
  }
  const outcome = {threw, result: result ? {
    aiModel: result.aiModel, narrativeIncomplete: result.display.narrativeIncomplete,
    narrativeIncompleteFields: result.display.narrativeIncompleteFields,
    guardFinalOk: result.guardFinal.ok,
    regenerationRejectedReasons: result.audit && result.audit.regeneration ?
        result.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []) : [],
  } : null};
  const pass = expectFn(outcome, fetchCallCount);
  ok(pass, `[${name}] المخرَج: ${JSON.stringify(outcome)} (fetchCallCount=${fetchCallCount})`);
  return outcome;
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — نجاح من المحاولة الأولى.
  // ═══════════════════════════════════════════════════════════════════
  await runScenario(
      '١. نجاح من المحاولة الأولى', d34,
      [envelopeResponse(D34_ACCEPTED)],
      (o) => !o.threw && o.result && o.result.guardFinalOk === true && o.result.narrativeIncomplete === false,
  );
  console.log('تحقّق ١: نجاح من المحاولة الأولى — guardFinalOk=true، narrativeIncomplete=false');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — رفض ثم نجاح.
  // ═══════════════════════════════════════════════════════════════════
  await runScenario(
      '٢. رفض ثم نجاح', b45,
      [envelopeResponse(B45_REJECTED), envelopeResponse(B45_ACCEPTED)],
      (o, fc) => !o.threw && o.result && o.result.guardFinalOk === true &&
          o.result.narrativeIncomplete === false && fc === 2,
  );
  console.log('تحقّق ٢: رفض ثم نجاح — محاولتان (fetch=2)، guardFinalOk=true في النهاية');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — رفض مرّتين → عرض جزئي.
  // ═══════════════════════════════════════════════════════════════════
  await runScenario(
      '٣. رفض مرّتين → عرض جزئي', b45,
      [envelopeResponse(B45_REJECTED), envelopeResponse(B45_REJECTED)],
      (o) => !o.threw && o.result && o.result.guardFinalOk === false && o.result.narrativeIncomplete === true &&
          o.result.narrativeIncompleteFields.length > 0,
  );
  console.log('تحقّق ٣: رفض مرّتين — guardFinalOk=false، narrativeIncomplete=true، حقول ناقصة مُسمّاة');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — فشل DeepSeek الصلب (500 مرّتين) + Gemini محجوب. أمر مستخدم
  // 2026-09-23 +03، البند ٧ (القاعدة 23): التوقّع الصحيح عرض حتمي كامل
  // بسبب PROVIDER_FAILED_NO_FALLBACK — لا رمي. مطابق لتصحيح السكربت أعلاه
  // (measure-resolveV7Report-live.js، سيناريو ٤) بنفس المنطق بالضبط.
  // ═══════════════════════════════════════════════════════════════════
  {
    const errEnvelope = {error: {message: 'Internal server error (simulated)', type: 'server_error', code: 'internal_error'}};
    fetchQueue = [];
    fetchCallCount = 0;
    // نداء fetch هنا لا يُعيد envelope ناجحاً — نحتاج استجابة 500 صريحة،
    // فنستبدل fetch لسيناريو هذا وحده بنسخة تُعيد 500 دوماً بدل الطابور.
    const savedFetch = global.fetch;
    global.fetch = async (url) => {
      fetchCallCount++;
      if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
      if (fetchCallCount > 2) throw new Error('TRAP: more than 2 DeepSeek calls expected in scenario 4');
      return {ok: false, status: 500, json: async () => errEnvelope, text: async () => JSON.stringify(errEnvelope)};
    };
    let result = null; let threw = null;
    try {
      result = await resolveV7Report(paramsFor(b45));
    } catch (e) { threw = String((e && e.message) || e); }
    global.fetch = savedFetch;
    const rejectedReasons = result && result.audit && result.audit.regeneration ?
        result.audit.regeneration.rounds.flatMap((r) => r.rejectedReasons || []) : [];
    eq(threw, null, '[٤] لا رمي إطلاقاً — providerFailedNoFallback يبني عرضاً حتمياً، لا استثناء');
    ok(result, '[٤] نتيجة مُعادة (غير null)');
    if (result) {
      eq(result.guardFinal.ok, false, '[٤] guardFinal.ok=false (لا محتوى نموذج مقبول)');
      eq(result.display.narrativeIncomplete, true, '[٤] narrativeIncomplete=true');
      ok(rejectedReasons.some((r) => /PROVIDER_FAILED_NO_FALLBACK/.test(r)),
          `[٤] سبب مُسمّى PROVIDER_FAILED_NO_FALLBACK حاضر — ${JSON.stringify(rejectedReasons)}`);
      eq(fetchCallCount, 2, '[٤] محاولتا DeepSeek (retry داخلي) قبل الاستسلام — fetch=2، صفر Gemini');
    }
    console.log('تحقّق ٤: فشل DeepSeek الصلب + Gemini محجوب — لا رمي، عرض حتمي بسبب PROVIDER_FAILED_NO_FALLBACK (يطابق تصحيح السكربت، القاعدة 23)');
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — الميزانية الزمنية: موعد نهائي قريب جداً (500ms) على جسم مرفوض —
  // لا محاولة٢، fetch=1، TIME_BUDGET_EXHAUSTED.
  // ═══════════════════════════════════════════════════════════════════
  await runScenario(
      '٥. الميزانية الزمنية', b45,
      [envelopeResponse(B45_REJECTED)],
      (o, fc) => !o.threw && o.result && o.result.guardFinalOk === false &&
          o.result.regenerationRejectedReasons.some((r) => /TIME_BUDGET_EXHAUSTED/.test(r)) && fc === 1,
      Date.now() + 500,
  );
  console.log('تحقّق ٥: الميزانية الزمنية — fetch=1، TIME_BUDGET_EXHAUSTED مُسجَّل');

  // ═══════════════════════════════════════════════════════════════════
  // ٦ — دورات متعدّدة: 3 تشغيلات متتالية، صفر تلوّث حالة بينها.
  // ═══════════════════════════════════════════════════════════════════
  {
    const MULTI_RUN_COUNT = 3;
    const results = [];
    for (let i = 1; i <= MULTI_RUN_COUNT; i++) {
      fetchQueue = [envelopeResponse(D34_ACCEPTED)];
      fetchCallCount = 0;
      const r = await resolveV7Report(paramsFor(d34));
      results.push({run: i, guardFinalOk: r.guardFinal.ok, networkCalls: fetchCallCount});
    }
    const pass = results.every((r) => r.guardFinalOk === true && r.networkCalls === 1);
    ok(pass, `[٦] ${MULTI_RUN_COUNT} دورات متتالية متطابقة، صفر تلوّث — ${JSON.stringify(results)}`);
  }
  console.log('تحقّق ٦: دورات متعدّدة — 3 تشغيلات متطابقة النتيجة، صفر تلوّث حالة بينها');

  console.log(`\nresolveV7ReportSimulateScenarios.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
