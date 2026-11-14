#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-callAIv7-live — بند ٣ من أمر المهمّة 2026-09-21 +03: "نداءان
// مأذونان — ثمّ التبديل". **الإذن ممنوح صراحةً في نصّ الأمر: نداءان فقط
// على الفحصين المخزونين (b45c8cf6 · 34dff2b8) عبر callAIv7. الكلفة ~٥
// سنتات." لا تشغيل بلا هذا الإذن الموثَّق، ولا تكرار بلا إذن جديد.
// ===================================================================
//
// نمط هذا السكربت طبق الأصل من functions/scripts/measure-deepseek-only-
// variance.js (بوّابة payloadBytes إلزامية · حفظ الاستجابة الخام فوراً
// قبل أي تحليل قد يفشل · قياس مُصلَح بـtotalMs/headerMs) — نفس الأسباب
// المذكورة في رأس ذلك الملفّ تنطبق هنا حرفياً، معدَّلة لمسار V7:
//
// ⚠️ **لماذا لا callAIv7() المُصدَّرة مباشرة رغم توفّرها** (callAI.js):
// تستدعي داخلياً callDeepSeekWithRetry → callDeepSeek (callDeepSeek.js)
// التي تُغلق على DEEPSEEK_TIMEOUT_MS=130000 (callDeepSeek.js:25) عبر
// AbortSignal.timeout في جسم الدالّة — غير قابل للتجاوز من خارج الملفّ.
// **دليل حقيقي على خطورة هذا هنا تحديداً**: نفس الجهاز/الفحص على V6
// استغرق فعلياً 142087ms (functions/scripts/out/run-2-2026-09-20T1012/
// b45c8cf6-e376-4765-8703-f68e9bc69844.json:durationMs) — **أطول من مهلة
// الإنتاج 130000ms بالفعل**. لو استُدعيت callAIv7() هنا وتكرّر زمن مماثل
// (برومبت V7 يحمل نفس reasoning_effort:"high" وحمولة أخفّ لكن مخطَّط
// إخراج مماثل التعقيد)، سيُقطَع الاستدعاء بمهلة الإنتاج وتُهدَر واحدة من
// النداءتين المأذونتين على TIMEOUT بلا أي بيانات مفيدة. لذلك — تماماً
// كما فعل measure-deepseek-only-variance.js لنفس السبب بالضبط — هذا
// السكربت يبني نداءه المستقلّ (fetch مباشر) بمهلته الخاصّة
// SCRIPT_DEEPSEEK_TIMEOUT_MS=240000. الحمولة والحارس نفساهما (buildV7Payload/
// guardV7Response) production code غير مُعدَّل ولا مُنسوخ — فقط طبقة النداء.
//
// ⚠️ **حظر المزوّد الاحتياطي المطلق** (نفس قيد measure-deepseek-only-
// variance.js): صفر استيراد وصفر نداء لأي وحدة تخصّ ذلك المزوّد هنا. إن
// فشل نداء DeepSeek — يفشل السكربت بأكمله ويتوقّف، بلا سقوط، بلا إعادة
// محاولة تلقائية.
//
// الحمولة تُبنى من **نفس golden fixtures المحلّية** المُستعمَلة في
// buildV7Payload.test.js/measure-v6-vs-v7-payload.js — لا فرق بين "الفحص
// المخزون" هنا وهناك؛ بوّابة payloadBytes أدناه تتحقّق من ذلك رقمياً قبل
// أي نداء (القيمتان المتوقَّعتان مأخوذتان من
// functions/scripts/out/v6-vs-v7-payload-*.json، هذه المهمّة بعينها).
//
// ⚠️ **مخرَج نداء حيّ حقيقي — لا يكتب فوق ملفّ متتبَّع (تحديث 2026-09-23
// +03، أمر مستخدم، البند ٧، القاعدة 34).** يكتب إلى اسم جديد مؤرَّخ
// (`v7-live-<scanId>-<ISO timestamp>.json`) — **لا** `v7-live-<scanId>.json`
// الحرفي (ذلك يتقاطع مع `v7-live-b45c8cf6-*.json`/`v7-live-34dff2b8-*.json`
// المُلتزَمين، commit d5069bd). قُرّاء الاسم الحرفي القديم (عدّدتهم قبل
// هذا التعديل — لم يتغيّر أيٌّ منهم، ما زالوا يقرؤون d5069bd):
//   - test/buildV7Payload.test.js (adjustments[0] الحقيقي على 34dff2b8)
//   - test/reportShapeV7.test.js (انحدار "charge"/"counter" على كلا الفِخّين)
//   - scripts/generate-v7-client-payload-sample.js (يبني عيّنة V7 مثالية)
//   - scripts/generate-v7-client-payload-sample-llm-adjusted.js (نظيرتها المُعدَّلة)
// تشغيل حيّ جديد لا يُغيّر ما يراه أيٌّ منهم — يحتاج تحديث مساراتهم صراحة
// لو أُريد استهلاك تشغيلة جديدة، قرار مستخدم منفصل لم يصدر بعد.
//
// Usage:
//   المفتاح يُقرأ من بيئة الطرفية فقط (process.env.DEEPSEEK_API_KEY) — لا
//   سطر هنا يضبطه، ولا gcloud secrets (محظور). اضبطه بنفسك بالوسيلة التي
//   تراها في طرفيّتك قبل التشغيل؛ غيابه يوقف السكربت بلا نداء (--dry-run
//   يعمل بلا مفتاح أصلاً).
//   node functions/scripts/measure-callAIv7-live.js --dry-run   # بلا كلفة
//   node functions/scripts/measure-callAIv7-live.js             # نداءان حقيقيّان، ~2.5¢ لكلّ منهما
//   node functions/scripts/measure-callAIv7-live.js --only b45c8cf6   # فحص واحد فقط

const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {getSystemPromptV7} = require('../src/prompts/systemPromptV7');
const {DEEPSEEK_MODEL, DEEPSEEK_MAX_TOKENS} = require('../src/analysis/callDeepSeek');
const {stripCodeFence} = require('../src/analysis/stripCodeFence');
const {guardV7Response} = require('../src/analysis/reportShapeV7');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, 'out');
const SCRIPT_DEEPSEEK_TIMEOUT_MS = 240000;

// ─── تحديث 2026-09-22 +03 (مهمّة «مخرَج عملية لا يُغذّى مدخلاً لها») ──────
// القيمتان القديمتان (64593/64635) ضُبطتا في commit 953ed9fd (2026-09-21
// 01:40) — **قبل** أربعة تغييرات لاحقة غير ذات صلة بهذه المهمّة زادت حجم
// الحمولة، وقبل استبعاد الثلاثة أدناه الذي أنقصه:
//   (أ) buildV7Payload.js يُسقط الآن finalLetter/adjustmentEvidence/
//       adjustmentReason من categoryStates.categories.<cat> عند بناء
//       userMessage فقط (تبقى في categoryStates/display/المستند —
//       stripModelPayloadExcludedCategoryFields أعلى هذا الملفّ) — **‑1025
//       بايت** لكلا الفِخّين (قياس مُتطابق).
//   (ب) findings.battery.charge_counter (snapshot/series) — حقل جديد كلّياً
//       أضافته مهمّة A100/تصدير charge_counter (commit يسبق هذه المهمّة،
//       غير ذي صلة بطبقة التعديل) — **+423 بايت**.
//   (ج) categoryStates.categories.<cat>.adjustmentApplied — حقل من **نفس
//       فصيلة** finalLetter/adjustmentEvidence/adjustmentReason (تُنتجه
//       applyV7Adjustments، buildV7Payload.js)، لكن **لم يرد اسمه في نصّ
//       قرار الاستبعاد** — بقي كما هو بانتظار إذن صريح (راجع تعليق
//       stripModelPayloadExcludedCategoryFields وتقرير هذه المهمّة) —
//       **+390 بايت** (×15 فئة).
//   (د) categoryStates.categories.battery.batteryIndicators.<ID>.
//       socAtWindowStart/End (×4 مؤشّرات ×2 حقلين) — **يبقى عمداً بنصّ
//       القرار** ("قياس حقيقي يحتاجه النموذج لقراءة مؤشّرات البطارية") —
//       **+168 بايت**.
//   (هـ) body.priorRejection — حقل مستوى أعلى جديد (دعم إعادة التوليد،
//       القرار ٢١) — **+22 بايت**.
// المجموع (ب+ج+د+هـ) = 1003 بايت — يطابق الفارق الفعلي المقيس (65596‑64593
// و65638‑64635) بلا أي باقٍ غير مُفسَّر (تحقّق حقلاً حقلاً عبر إعادة بناء
// الحمولة القديمة فعلياً من commit 953ed9fd على نفس مُدخلات الفِخّين
// الذهبيَّين حرفياً — لا تخمين، راجع تقرير هذه المهمّة تحت "قياس قبل/بعد").
//
// ─── تحديث ثانٍ 2026-09-22 +03 («استبعد الأربعة أيضاً» — إذن مستخدم صريح
// منفصل عن الإذن أعلاه) — 65596/65638 → 64782/64824 ────────────────────
// أربعة حقول إضافية أُسقطت الآن من بناء الحمولة (buildV7Payload.js:
// MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS/MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS)
// — نفس فصيلة (ج) أعلاه بالضبط، الإذن الذي كان معلَّقاً صدر الآن:
//   • categories.<cat>.adjustmentApplied  −390 بايت (×15 فئة، 26 بايت/فئة،
//     مقيس منفرداً)
//   • categories.<cat>.llmSuggestedLetter −390 بايت (×15 فئة، 26 بايت/فئة،
//     مقيس منفرداً — نفس الرقم بالصدفة العددية: "adjustmentApplied":false
//     و"llmSuggestedLetter":null متساويان طولاً حرفياً: 18+٢quotes+1:+5=26
//     و19+٢quotes+1:+4=26)
//   • overall.adjustments  −17 بايت (مقيس منفرداً: [] فارغة)
//   • overall.disputed     −17 بايت (مقيس منفرداً: false)
//   ————
//   المجموع = −814 بايت — طابق فعلياً الفارق الكامل (65596−64782 و
//   65638−64824) بلا أي باقٍ (مجموع الدلتات الأربع المنفردة = دلتا
//   الأربعة مجتمعة، على كلا الفِخّين — لا تفاعل بنيوي بين الحقول، قياس
//   بأداة مستقلّة عن هذا السكربت: JS delete+JSON.stringify مباشرة على
//   نفس golden fixtures، ثم تحقّق ثانٍ عبر buildV7Payload() الفعلية).
// ما مُسِح ولم يُسقَط (نفس الفصيلة بنيوياً لكن غير مُصرَّح به هنا — راجع
// تعليق رأس MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS في buildV7Payload.js
// لتفصيل كل واحد): categories.<cat>.score (السادس — تكتبه applyV7Adjustments
// فعلياً لكن لا مسار كود اليوم يُعيد تغذيته لبناء حمولة لاحقة)،
// overall.llmOverall (يجاور adjustments/disputed لكنه حقل ميّت دائماً null
// — لا كاتب له غير التهيئة).
// ⚠️ **تحديث 2026-09-23 +03 — الثابت انتقل إلى وحدة مُصدَّرة مشتركة**
// (أمر مستخدم، البند ٤: "هذا يُغلق العلّة لا الحالة: خمسة التزامات مرّت
// والاختبارات خضراء والحمولة كبرت 5490 بايتاً — لأن البوّابة كانت داخل
// سكربت النداء وحده"). القيمتان 64782/64824 أعلاه كانتا آخر ما رآه هذا
// السكربت — لكن `30ef54a` (بوّابة LOW_CATEGORY_COVERAGE) و`4b52c8f`
// (findings.storage.capacityDerived) كبَّرتا الحمولة 5490/5543 بايتاً
// بعدهما بلا أن يفشل شيء، لأن لا اختبار في السويت العادي (`node
// test/*.test.js`) كان يقرأ هذا الرقم — فقط هذا السكربت، ولا يُشغَّل إلا
// يدوياً بـ--dry-run. **الثابت الآن في
// `src/analysis/expectedV7PayloadBytes.js`** (مصدر واحد، القاعدة 24) —
// يستورده هذا السكربت وأيضاً `test/expectedV7PayloadBytes.test.js`
// الجديد (يُشغَّل مع كل تمرير للسويت). راجع ذلك الملفّ لتاريخ الرقم
// الحالي (70254/70349) حقلاً حقلاً — بما فيه الفارق +5490/+5543 الذي
// سبَّب هذه المهمّة كلّها، وحصّة هذه الجلسة نفسها منه (+1146 صافيه صفر —
// أُضيف ثم اسُتبعِد من الحمولة في نفس الجلسة — وllmOverall −18).
const {EXPECTED_V7_PAYLOAD_BYTES} = require('../src/analysis/expectedV7PayloadBytes');
const TARGETS = EXPECTED_V7_PAYLOAD_BYTES;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const ONLY = argValue('--only');

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

/**
 * يبني حمولة V7 كاملة (findings → categoryStates → buildV7Payload) من
 * golden fixture محليّة واحدة. production code غير مُعدَّل — نداء مباشر.
 * @param {string} scanId
 * @param {string} tsFile
 * @return {{userMessage: string, findings: Object, categoryStates: Object}}
 */
function buildPayload(scanId, tsFile) {
  const raw = loadJson(tsFile);
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  if (!Array.isArray(functional)) {
    throw new Error(`لا functionalResults لهذا المعرّف: ${scanId}`);
  }
  const fingerprint = {
    timeSeries: raw,
    functionalResults: functional,
    manualResults: [],
  };
  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(fingerprint);
  const categoryStates = computeCategoryStates({
    functionalResults: fingerprint.functionalResults,
    manualResults: fingerprint.manualResults,
    dev: null,
    findings,
    batterySampleInputs: battery.sampleInputs,
    batteryDesignCapacityMah: battery.design,
  });
  const {userMessage} = buildV7Payload({
    findings, categoryStates, language: 'ar', scanId, isFreeTrial: false, previousScan: null,
  });
  return {userMessage, findings, categoryStates};
}

/**
 * نداء DeepSeek مستقلّ — بمهلة SCRIPT_DEEPSEEK_TIMEOUT_MS، بلا سقوط لأي
 * بديل. طبق الأصل من callDeepSeek.js:111-134 (شكل الطلب) مع systemPrompt
 * مُستبدَل بـV7 بدل V6.
 * @param {string} userMessage
 * @param {string} systemPrompt
 * @param {string} deepseekKey
 * @param {string} scanId للسجلّ فقط
 * @return {Promise<{envelope:Object, ms:number, headerMs:number, requestBody:Object}>}
 */
async function callDeepSeekDirectV7(userMessage, systemPrompt, deepseekKey, scanId) {
  const requestBody = {
    model: DEEPSEEK_MODEL,
    temperature: 0.1,
    max_tokens: DEEPSEEK_MAX_TOKENS,
    response_format: {type: 'json_object'},
    messages: [
      {role: 'system', content: systemPrompt},
      {role: 'user', content: userMessage},
    ],
    thinking: {type: 'enabled', reasoning_effort: 'high'},
  };

  const startMs = Date.now();
  let response;
  try {
    response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(SCRIPT_DEEPSEEK_TIMEOUT_MS),
    });
  } catch (err) {
    const ms = Date.now() - startMs;
    const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
    console.error(`[measure-v7][${scanId}] ${isTimeout ? 'TIMEOUT' : 'NETWORK'} ` +
        `after ${ms}ms (limit=${SCRIPT_DEEPSEEK_TIMEOUT_MS}ms): ${err.name}: ${err.message || 'no message'}`);
    throw new Error(`DeepSeek ${isTimeout ? 'timed out' : 'network error'} after ${ms}ms: ${err.message || err.name}`);
  }
  const headerMs = Date.now() - startMs;

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[measure-v7][${scanId}] HTTP ${response.status} after ${Date.now() - startMs}ms: ${errBody.slice(0, 300)}`);
    throw new Error(`DeepSeek HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const envelope = await response.json();
  const ms = Date.now() - startMs;
  console.log(`[measure-v7][${scanId}] headerMs=${headerMs} totalMs=${ms}`);
  return {envelope, ms, headerMs, requestBody};
}

async function processOne(target) {
  const {scanId, tsFile, expectedPayloadBytes} = target;
  console.log(`[measure-v7][${scanId}] بناء الحمولة من golden fixture محليّة...`);
  const {userMessage, findings, categoryStates} = buildPayload(scanId, tsFile);
  const payloadBytes = userMessage.length;

  console.log(`[measure-v7][${scanId}] payloadBytes=${payloadBytes} (متوقَّع ${expectedPayloadBytes})`);
  if (payloadBytes !== expectedPayloadBytes) {
    throw new Error(
        `[${scanId}] بوّابة payloadBytes فشلت: ${payloadBytes} ≠ ${expectedPayloadBytes} ` +
        `(فارق ${payloadBytes - expectedPayloadBytes}) — توقّف بلا نداء DeepSeek.`);
  }
  console.log(`[measure-v7][${scanId}] ✓ البوّابة اجتازت`);

  if (DRY_RUN) {
    console.log(`[measure-v7][${scanId}] --dry-run: لا نداء DeepSeek.`);
    return {scanId, dryRun: true, payloadBytes};
  }

  const systemPrompt = getSystemPromptV7('ar');
  console.log(`[measure-v7][${scanId}] استدعاء DeepSeek (${DEEPSEEK_MODEL}, مهلة السكربت ${SCRIPT_DEEPSEEK_TIMEOUT_MS}ms)...`);
  const {envelope, ms, headerMs, requestBody} =
      await callDeepSeekDirectV7(userMessage, systemPrompt, process.env.DEEPSEEK_API_KEY, scanId);

  const usage = envelope.usage || {};
  const details = usage.completion_tokens_details || {};
  const reasoningTokens = details.reasoning_tokens ?? null;
  const finishReason = envelope.choices?.[0]?.finish_reason || 'unknown';
  const content = envelope.choices?.[0]?.message?.content;
  const contentLen = typeof content === 'string' ? content.length : 0;
  const completionTokens = usage.completion_tokens || 0;

  console.log(`[measure-v7][${scanId}] resp in ${ms}ms model=${envelope.model || '?'} ` +
      `finish=${finishReason} output=${completionTokens}/${DEEPSEEK_MAX_TOKENS} ` +
      `reasoning=${reasoningTokens === null ? 'n/a' : reasoningTokens} content_len=${contentLen}`);

  fs.mkdirSync(OUT_DIR, {recursive: true});
  // ⚠️ **تحديث 2026-09-23 +03 (أمر مستخدم، البند ٧، القاعدة 34) — لا كتابة
  // فوق ملفّ متتبَّع.** كان الاسم `v7-live-${scanId}.json` حرفياً — يكتب
  // فوق `v7-live-b45c8cf6-*.json`/`v7-live-34dff2b8-*.json` المُلتزَمين
  // (commit d5069bd) في كل تشغيل حيّ لاحق. **وقع فعلاً قبل هذه الجلسة**:
  // إعادة تشغيل غيّرت adjustments[0] من cpu (8 مراجع) إلى gpu (4 مراجع)
  // على 34dff2b8، فكسرت test/buildV7Payload.test.js (أُصلح في مهمّة
  // منفصلة سابقة على هذا التعديل — راجع تقرير تلك المهمّة) وترك
  // test/reportShapeV7.test.js مكسوراً (لم يُصلَح — يحتاج قراراً في
  // محتوى النصّ لا إعادة توليد). **القرّاء الأربعة المعروفون لهذا الاسم**
  // (test/buildV7Payload.test.js، test/reportShapeV7.test.js،
  // scripts/generate-v7-client-payload-sample.js،
  // scripts/generate-v7-client-payload-sample-llm-adjusted.js) يبقون على
  // محتوى d5069bd حتى يُقرَّر غير ذلك — هذا السكربت يكتب الآن إلى اسم
  // جديد مؤرَّخ لا يتقاطع معه إطلاقاً.
  const runDate = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(OUT_DIR, `v7-live-${scanId}-${runDate}.json`);
  const record = {
    scanId,
    pipeline: 'v7_findings_based',
    requestedAt: new Date(Date.now() - ms).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: ms,
    headerMs,
    providerCreatedAt: envelope.created ? new Date(envelope.created * 1000).toISOString() : null,
    payloadBytes,
    model: DEEPSEEK_MODEL,
    timeoutMs: SCRIPT_DEEPSEEK_TIMEOUT_MS,
    requestBody: {...requestBody, messages: [
      {role: 'system', content: '(SYSTEM_PROMPT_V7 — محذوف طولاً؛ انظر functions/src/prompts/systemPromptV7.js)'},
      {role: 'user', content: `(محذوف طولاً — نفس userMessage المُرسَل، ${payloadBytes} بايت)`},
    ]},
    finishReason,
    completionTokens,
    reasoningTokens,
    contentLen,
    usage,
    rawEnvelope: envelope,
    parsedResponse: null,
    parseError: null,
    guard: null,
  };

  // يُكتب فوراً — قبل أي تحليل قد يفشل (نفس مبدأ measure-deepseek-only-variance.js).
  if (envelope.error) {
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
    console.error(`[measure-v7][${scanId}] provider error inside HTTP 200: ${envelope.error.message || JSON.stringify(envelope.error).slice(0, 200)}`);
    throw new Error(`[${scanId}] DeepSeek provider error: ${envelope.error.message || 'unknown'}`);
  }
  if (!content) {
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
    console.error(`[measure-v7][${scanId}] NO CONTENT (finish=${finishReason}, output=${completionTokens}/${DEEPSEEK_MAX_TOKENS})`);
    throw new Error(`[${scanId}] DeepSeek returned no content (finish_reason=${finishReason})`);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(stripCodeFence(content));
    record.parsedResponse = parsed;
  } catch (parseErr) {
    console.error(`[measure-v7][${scanId}] JSON.parse failed: ${parseErr.message}`);
    try {
      const {jsonrepair} = require('jsonrepair');
      parsed = JSON.parse(jsonrepair(stripCodeFence(content)));
      record.parsedResponse = parsed;
      record.parseError = `recovered via jsonrepair (original: ${parseErr.message})`;
    } catch (repairErr) {
      record.parseError = `JSON.parse failed (${parseErr.message}); jsonrepair also failed (${repairErr.message})`;
    }
  }

  // الحارس الكامل — reportShapeV7.js، production code غير مُعدَّل.
  if (parsed) {
    record.guard = guardV7Response(parsed, {findings, categoryStates});
  }

  fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`[measure-v7][${scanId}] ✓ كُتب ${outFile}` +
      (record.guard ? ` — guard.ok=${record.guard.ok}` : ` — ⚠ parseError=${record.parseError}`));

  return {
    scanId, dryRun: false, payloadBytes, durationMs: ms, headerMs, finishReason,
    completionTokens, reasoningTokens, outFile, guard: record.guard, parseError: record.parseError,
  };
}

(async () => {
  console.log(`═══ measure-callAIv7-live ${DRY_RUN ? '(--dry-run)' : ''} ═══`);
  console.log(`model=${DEEPSEEK_MODEL} scriptTimeoutMs=${SCRIPT_DEEPSEEK_TIMEOUT_MS} productionTimeoutMs(unchanged)=callDeepSeek.js:25`);

  if (!DRY_RUN && !process.env.DEEPSEEK_API_KEY) {
    console.error('\n✗ توقّف بلا نداء: DEEPSEEK_API_KEY غير مضبوط في البيئة.');
    process.exit(1);
  }

  let selected = TARGETS;
  if (ONLY) {
    selected = TARGETS.filter((t) => t.scanId.startsWith(ONLY));
    if (selected.length === 0) {
      console.error(`\n✗ توقّف: --only ${ONLY} لا يطابق أي فحص في TARGETS.`);
      process.exit(1);
    }
  }
  console.log(`عدد النداءات: ${selected.length}${ONLY ? ` · only=${ONLY}` : ''} — نداءان مأذونان بالضبط لهذه المهمّة، لا تكرار بلا إذن جديد.`);

  // تسلسلي عمداً لا Promise.all: كلّ نداء يُكلِّف فعلياً، والتسلسل يتيح
  // التوقّف فوراً إن فشل الأوّل بدل إنفاق الثاني أيضاً بلا داعٍ.
  const results = [];
  for (const t of selected) {
    results.push(await processOne(t));
  }

  console.log('\n═══ الخلاصة ═══');
  for (const r of results) {
    if (r.dryRun) {
      console.log(`  ${r.scanId}: dry-run — payloadBytes=${r.payloadBytes}`);
    } else {
      console.log(`  ${r.scanId}: ${r.durationMs}ms (header ${r.headerMs}ms) finish=${r.finishReason} ` +
          `output=${r.completionTokens} reasoning=${r.reasoningTokens} guard.ok=${r.guard ? r.guard.ok : 'n/a'} → ${r.outFile}`);
    }
  }
})().catch((e) => {
  console.error('\n✗ توقّف بخطأ:', e.message || e);
  process.exit(1);
});
