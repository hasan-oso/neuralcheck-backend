#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-deepseek-only-variance — قياس تباين: نموذج واحد (DeepSeek)،
// نفس البرومبت (systemPromptV6 الحالي)، فحصان مخزونان بالتوازي.
// ===================================================================
//
// الهدف: عزل تباين النموذج عن كل ما عداه.
//
// الفحصان (rawFingerprint.header.deviceFingerprint متطابق بين الاثنين —
// جهاز واحد بعينه، فحصان متتاليان بفارق ~14 دقيقة):
//   b45c8cf6-e376-4765-8703-f68e9bc69844  — حُلِّل سابقاً بمزوّد A (deepseek-flash) → B/78
//   34dff2b8-ce9e-4b40-86a9-1976c878e195  — حُلِّل سابقاً بمزوّد آخر (aiModel المخزون
//                                            في مستنده) → D/50
//
// هذا السكربت يعيد تحليل كليهما بـ DeepSeek فقط، بالتوازي (Promise.all)،
// كي تُقارَن النتيجتان ببعضهما بعد إسقاط متغيّر "أيّ نموذج أجاب".
//
// ─── حظر المزوّد الاحتياطي المطلق (قيد إضافي من المستخدم) ──────────────
// صفر استيراد وصفر نداء لأي وحدة تخصّ ذلك المزوّد في هذا الملفّ. تحقّق
// بنفسك قبل أي تشغيل بحثاً عن اسمه حرفياً (لا يُكتَب هنا عمداً كي يبقى هذا
// التحقّق آلياً بلا نتائج موجبة كاذبة من نصّ التعليقات نفسها) — يجب أن
// تكون النتيجة صفراً.
//
// لذلك عمداً لا يُستدعى functions/src/analysis/callAI.js: ذلك الملفّ يحمل
// مساراً احتياطياً كاملاً إلى مزوّد آخر عند فشل DeepSeek (انظر
// callAI.js:235-252، الاستيراد في رأس الملفّ سطر 4-5) — استدعاؤه يُدخل ذلك
// المزوّد إلى مسار التنفيذ ولو لم يُستَدعَ فعلياً، وهذا محظور هنا حظراً
// مطلقاً.
//
// إن فشل نداء DeepSeek — مهلة، HTTP غير ok، أو `error` داخل استجابة 200 —
// يفشل السكربت بأكمله ويتوقّف. لا سقوط إلى بديل، ولا إعادة محاولة تلقائية.
// الاستثناء الوحيد: إن فشل أحد النداءين والآخر نجح، يُكتب ملفّ الناجح إلى
// القرص قبل رمي الخطأ — كي لا يضيع نداء دُفع ثمنه فعلاً.
//
// ─── لماذا لا يُستدعى callDeepSeek() المُصدَّرة رغم توفّرها ─────────────
// تلك الدالّة (functions/src/analysis/callDeepSeek.js) تُغلق داخلياً على
// DEEPSEEK_TIMEOUT_MS (=130000, callDeepSeek.js:25) عبر
// `AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS)` في جسم الدالّة (callDeepSeek.js:146).
// توقيعها `callDeepSeek(userMessage, systemPrompt, deepseekKey, model)` — أربعة
// وسائط فقط، لا خامس لتمرير مهلة. فالثابت **غير قابل للتجاوز من خارج الملفّ
// اليوم**، والقاعدة تمنع لمس الثابت نفسه. لذلك هذا السكربت يبني نداءه
// المستقلّ (fetch مباشر إلى DeepSeek) بمهلته الخاصّة SCRIPT_DEEPSEEK_TIMEOUT_MS
// (=240000) — نفس شكل الطلب المُرسَل في callDeepSeek.js:111-134 حرفياً، بمهلة
// مختلفة فقط.
//
// الاستيراد الوحيد من شيفرة قائمة — كلّها مرافق/ثوابت صرفة بلا أي أثر
// للمزوّد المحظور في شجرة استيرادها (تحقّقتُ من الملفّات الأربعة ومن كل ما
// تستورده هي بدورها):
//   systemPromptV6.js  → SYSTEM_PROMPT_V6            (نص ثابت، لا استيراد)
//   callDeepSeek.js    → DEEPSEEK_MODEL, DEEPSEEK_MAX_TOKENS
//                        (قيمتان فقط — لا الدالّة callDeepSeek نفسها؛
//                         يستورد هو نفسه ./stripCodeFence و./reportShape فقط)
//   stripCodeFence.js  → stripCodeFence                (تنظيف نصّي صرف)
//   reportShape.js     → resolveReport, missingCoreKeys (فحص شكل صرف،
//                         يستورد لا شيء)
//
// ─── القيود الأخرى ──────────────────────────────────────────────────────
//   • قراءة فقط من Firestore/Storage (GET). لا PATCH ولا POST ولا حذف.
//   • بوّابة payloadBytes إلزامية قبل أي نداء لـ DeepSeek — القيمتان
//     المتوقَّعتان (145266 و145027) مُتحقَّق منهما مسبقاً بسكربت مطابق
//     لهذا البناء تماماً؛ توقّف بلا نداء إن ابتعدتا.
//   • --dry-run: يبني الحمولة ويتحقّق من البوّابة فقط، بلا نداء DeepSeek
//     وبلا حاجة لـ DEEPSEEK_API_KEY. مفيد للتحقّق من السكربت نفسه بلا كلفة.
//
// Usage:
//   export DEEPSEEK_API_KEY=$(gcloud secrets versions access latest \
//       --secret=DEEPSEEK_API_KEY --project neuralchek-9b6d7)
//   node functions/scripts/measure-deepseek-only-variance.js --dry-run
//   node functions/scripts/measure-deepseek-only-variance.js   # نداءان حقيقيّان، ~2.5¢ لكلّ منهما

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {execFileSync} = require('child_process');

const {SYSTEM_PROMPT_V6} = require('../src/prompts/systemPromptV6');
const {DEEPSEEK_MODEL, DEEPSEEK_MAX_TOKENS} =
    require('../src/analysis/callDeepSeek');
const {stripCodeFence} = require('../src/analysis/stripCodeFence');
const {resolveReport, missingCoreKeys} = require('../src/analysis/reportShape');
const {fetchReportWithRawRest} = require('./lib/reportRawReaders');

// ─── ثوابت الحالة ────────────────────────────────────────────────────
const PROJECT = 'neuralchek-9b6d7';
const BUCKET = 'neuralchek-9b6d7.firebasestorage.app';
const OUT_DIR = path.join(__dirname, 'out');

// هذا الثابت يخصّ هذا السكربت فقط. لا يمسّ ولا يستبدل
// DEEPSEEK_TIMEOUT_MS في callDeepSeek.js:25 (يبقى 130000 هناك كما هو).
const SCRIPT_DEEPSEEK_TIMEOUT_MS = 240000;

// storedGrade/storedScore/storedAiModel غير مُدرَجة هنا عمداً: تُقرأ ديناميكياً
// من المستند نفسه (cur.grade/cur.score/cur.aiModel) وتُطبع في السجلّ أدناه —
// لا حاجة لتكرارها ثابتة هنا، ويُبقي هذا الملفّ خالياً من أي اسم مزوّد مكتوب.
const TARGETS = [
  {
    scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844',
    expectedPayloadBytes: 145266,
  },
  {
    scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195',
    expectedPayloadBytes: 145027,
  },
];

// على ويندوز الأمر gcloud.cmd — نفس منطق regenerate-report.js.
const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');

// --only <scanIdPrefix>  : يقصر التشغيل على فحص واحد.
// --repeat <n>           : يكرّر النداء n مرّة على الحمولة نفسها، بالتوازي.
// كلاهما اختياري؛ بدونهما السلوك الافتراضي (الفحصان، مرّة لكل منهما) بلا تغيير.
// عند --repeat > 1 يُكتب كل نداء في ملفّ مستقلّ فلا يدهس أحدهما الآخر.
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const ONLY = argValue('--only');
const REPEAT = Math.max(1, parseInt(argValue('--repeat') || '1', 10) || 1);

/** @return {string} رمز وصول من gcloud (لا يُطبع أبداً) */
function gcloudToken() {
  return execFileSync(GCLOUD, ['auth', 'print-access-token'],
      {shell: process.platform === 'win32'}).toString().trim();
}

/**
 * طلب GET بمصادقة gcloud. لا يُستعمل إلا لـ Firestore/Storage القراءة.
 * @param {string} url العنوان
 * @return {Promise<Response>} الاستجابة الخام
 */
async function authedGet(url) {
  const res = await fetch(url, {
    headers: {'Authorization': 'Bearer ' + gcloudToken()},
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} → ${res.status}\n${text.slice(0, 400)}`);
  }
  return res;
}

/**
 * نسخة طبق الأصل من callAI.js:116-131 (stripSampleTs). غير مُصدَّرة من
 * هناك فيستحيل استيرادها؛ أُعيد كتابتها هنا حرفياً كي تُطابق الحمولة
 * المُرسَلة فعلياً بايتاً ببايت. أي تعديل لاحق على الأصل يجب أن يُنسخ هنا
 * يدوياً — ولهذا وحده لا يُعتمَد رقم البوّابة أدناه إلا بعد التحقّق الفعلي
 * (وقد تحقّق: 145266 و145027 تطابقا تماماً مع القيمتين المُعطاتين).
 * @param {Array} samples العيّنات كما وصلت من Storage
 * @return {Array} نسخة بلا حقل ts
 */
function stripSampleTs(samples) {
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      out[i] = s;
      continue;
    }
    const copy = {};
    for (const k of Object.keys(s)) {
      if (k !== 'ts') copy[k] = s[k];
    }
    out[i] = copy;
  }
  return out;
}

/**
 * يجلب مستند reports/{scanId} **وخامّه** ويفكّهما إلى JS عادي. قراءة فقط.
 * V8 نقل الخامّ (الجزء ٢، 2026-10-09): rawFingerprint وtimeSeriesStoragePath
 * صارا في reportRaw/{scanId} للتقارير الجديدة والمُرحَّلة (ومضمَّنَين في تقرير
 * لم يُرحَّل بعد) — تُقرآن بـreadReportRaw عبر fetchReportWithRawRest، وتُدمجان
 * في الكائن المُعاد (الشكل المضمَّن الذي تقرؤه الدوالّ أدناه). ABSENT (لا خامّ
 * إطلاقاً) خطأ صريح بسببه: لا حمولة تُبنى من بصمة غائبة.
 * @param {string} scanId مُعرّف الفحص
 * @return {Promise<Object>} حقول المستند + الخامّ مفكوكة
 */
async function fetchReportDoc(scanId) {
  const {merged, rawRead} = await fetchReportWithRawRest({project: PROJECT, getToken: gcloudToken, scanId});
  console.log(`[measure][${scanId}] rawState=${rawRead.state}`);
  if (rawRead.state === 'ABSENT') {
    throw new Error(`[${scanId}] الخامّ ABSENT (لا reportRaw ولا rawFingerprint مضمَّن) — توقّف`);
  }
  return merged;
}

/**
 * يجلب السلسلة الزمنية المضغوطة من Storage ويفكّها. قراءة فقط.
 * @param {string} storagePath timeSeriesStoragePath كما في المستند
 * @return {Promise<Object>} السلسلة الزمنية {samples, ...}
 */
async function fetchTimeSeries(storagePath) {
  const objectPath = encodeURIComponent(storagePath);
  const url = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/` +
      `${objectPath}?alt=media`;
  const res = await authedGet(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
}

/**
 * يبني userMessage طبق الأصل من callAI.js:133-166 — نفس ترتيب الحقول،
 * نفس إسقاط ts من العيّنات، نفس النصّ الملحق. previousScan: null دائماً
 * هنا (لا نمرّر سياق فحص سابق — قياس مستقلّ لكل فحص، كما فعل
 * regenerate-report.js:307-324 بالضبط لنفس الغرض).
 * @param {Object} cur حقول مستند Firestore مفكوكة
 * @param {Object} ts السلسلة الزمنية من Storage (تحمل samples الكاملة)
 * @param {string} scanId مُعرّف الفحص
 * @return {{userMessage: string, sampleCount: number}} الحمولة وعدد العيّنات
 */
function buildUserMessage(cur, ts, scanId) {
  const docTs = (cur.rawFingerprint || {}).timeSeries || {};
  const fingerprint = {
    ...cur.rawFingerprint,
    timeSeries: {...docTs, samples: ts.samples},
  };
  const tsField = fingerprint.timeSeries || {};
  const rawFingerprintForAi = {
    header: tsField.header || fingerprint.header || {},
    footer: tsField.footer || fingerprint.footer || {},
    samples: stripSampleTs(tsField.samples || fingerprint.samples || []),
    variables: tsField.variables || fingerprint.variables || [],
    functionalResults: fingerprint.functionalResults || [],
    manualResults: fingerprint.manualResults || [],
    device: fingerprint.device || {},
    antiTamperFlags: fingerprint.antiTamperFlags || [],
    powerSaveMode: !!fingerprint.powerSaveMode,
  };
  const body = {
    scanId,
    language: cur.language || 'ar',
    isFreeTrial: cur.isFreeTrial === true,
    rawFingerprint: rawFingerprintForAi,
    previousScan: null,
  };
  const userMessage = JSON.stringify(body) + '\n\nProduce the analysis JSON now.';
  return {userMessage, sampleCount: (tsField.samples || []).length};
}

/**
 * نداء DeepSeek مستقلّ — لا يمرّ عبر callDeepSeek() المُصدَّرة (انظر تعليق
 * الرأس لسبب ذلك). نفس شكل الطلب في callDeepSeek.js:111-134 حرفياً، بمهلة
 * SCRIPT_DEEPSEEK_TIMEOUT_MS بدل DEEPSEEK_TIMEOUT_MS. لا إعادة محاولة، ولا
 * سقوط إلى أي بديل: فشل هنا = رمي، والمستدعي لا يلتقطه بمحاولة ثانية.
 * @param {string} userMessage رسالة المستخدم (الحمولة المبنيّة)
 * @param {string} deepseekKey مفتاح DeepSeek من البيئة (لا يُطبع أبداً)
 * @param {string} scanId للسجلّ فقط
 * @return {Promise<Object>} {envelope, ms, requestBody}
 */
async function callDeepSeekDirect(userMessage, deepseekKey, scanId) {
  const requestBody = {
    model: DEEPSEEK_MODEL,
    temperature: 0.1,
    max_tokens: DEEPSEEK_MAX_TOKENS,
    response_format: {type: 'json_object'},
    messages: [
      {role: 'system', content: SYSTEM_PROMPT_V6},
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
    console.error(`[measure][${scanId}] ${isTimeout ? 'TIMEOUT' : 'NETWORK'} ` +
        `after ${ms}ms (limit=${SCRIPT_DEEPSEEK_TIMEOUT_MS}ms): ` +
        `${err.name}: ${err.message || 'no message'}`);
    throw new Error(`DeepSeek ${isTimeout ? 'timed out' : 'network error'} ` +
        `after ${ms}ms: ${err.message || err.name}`);
  }
  // A85: `await fetch` resolves on RESPONSE HEADERS, not on a finished body.
  // Timing the call here measured ~2s for 30k generated tokens — impossible,
  // and contradicted by the provider's own `created` field (~124s apart from
  // completion). Keep the header time, but the number that means "how long
  // did the model take" is measured after the body is fully read, below.
  const headerMs = Date.now() - startMs;

  if (!response.ok) {
    const errBody = await response.text();
    console.error(`[measure][${scanId}] HTTP ${response.status} after ` +
        `${Date.now() - startMs}ms: ${errBody.slice(0, 300)}`);
    throw new Error(`DeepSeek HTTP ${response.status}: ${errBody.slice(0, 300)}`);
  }

  const envelope = await response.json();
  const ms = Date.now() - startMs;
  console.log(`[measure][${scanId}] headerMs=${headerMs} totalMs=${ms}`);
  return {envelope, ms, headerMs, requestBody};
}

/**
 * يعالج فحصاً واحداً كاملاً: يجلب، يبني، يبوّب، ثم (إن لم يكن --dry-run)
 * يستدعي DeepSeek ويكتب المخرَج. يكتب المخرَج الجزئي فور استلام الاستجابة
 * الخام — قبل أي محاولة تحليل قد تفشل — كي لا يضيع نداء دُفع ثمنه.
 * @param {Object} target أحد عناصر TARGETS
 * @return {Promise<Object>} ملخّص النتيجة
 */
async function processOne(target) {
  const {scanId, expectedPayloadBytes, callTag} = target;
  console.log(`[measure][${scanId}] جلب المستند من Firestore...`);
  const cur = await fetchReportDoc(scanId);

  if (!cur.timeSeriesStoragePath) {
    throw new Error(`[${scanId}] لا timeSeriesStoragePath في المستند — توقّف`);
  }
  console.log(`[measure][${scanId}] جلب السلسلة الزمنية من Storage: ` +
      `${cur.timeSeriesStoragePath}`);
  const ts = await fetchTimeSeries(cur.timeSeriesStoragePath);

  const {userMessage, sampleCount} = buildUserMessage(cur, ts, scanId);
  const payloadBytes = userMessage.length;

  console.log(`[measure][${scanId}] payloadBytes=${payloadBytes} ` +
      `(متوقَّع ${expectedPayloadBytes}) sampleCount=${sampleCount} ` +
      `storedGrade=${cur.grade}/${cur.score} storedAiModel=${cur.aiModel}`);

  // ─── البوّابة الإلزامية ─────────────────────────────────────────────
  if (payloadBytes !== expectedPayloadBytes) {
    throw new Error(
        `[${scanId}] بوّابة payloadBytes فشلت: ${payloadBytes} ≠ ` +
        `${expectedPayloadBytes} (فارق ${payloadBytes - expectedPayloadBytes}) ` +
        '— حمولة مختلفة عمّا أُرسل وقتها؛ توقّف بلا نداء DeepSeek.');
  }
  console.log(`[measure][${scanId}] ✓ البوّابة اجتازت — الحمولة مطابقة تماماً`);

  if (DRY_RUN) {
    console.log(`[measure][${scanId}] --dry-run: لا نداء DeepSeek.`);
    return {scanId, dryRun: true, payloadBytes, sampleCount};
  }

  console.log(`[measure][${scanId}] استدعاء DeepSeek (${DEEPSEEK_MODEL}, ` +
      `مهلة السكربت ${SCRIPT_DEEPSEEK_TIMEOUT_MS}ms)...`);
  const {envelope, ms, headerMs, requestBody} =
      await callDeepSeekDirect(userMessage, process.env.DEEPSEEK_API_KEY, scanId);

  // تشخيص أوّلاً، قبل أي رمي — نفس ترتيب callDeepSeek.js:174-201.
  const usage = envelope.usage || {};
  const details = usage.completion_tokens_details || {};
  const reasoningTokens = details.reasoning_tokens ?? null;
  const finishReason = envelope.choices?.[0]?.finish_reason || 'unknown';
  const content = envelope.choices?.[0]?.message?.content;
  const contentLen = typeof content === 'string' ? content.length : 0;
  const completionTokens = usage.completion_tokens || 0;

  console.log(`[measure][${scanId}] resp in ${ms}ms model=${envelope.model || '?'} ` +
      `finish=${finishReason} output=${completionTokens}/${DEEPSEEK_MAX_TOKENS} ` +
      `reasoning=${reasoningTokens === null ? 'n/a' : reasoningTokens} ` +
      `content_len=${contentLen}`);

  // يُكتب فوراً — قبل أي محاولة تحليل قد تفشل. هذا هو "الاستجابة كاملة"
  // المطلوبة، بصرف النظر عمّا يحدث لاحقاً في التحليل.
  fs.mkdirSync(OUT_DIR, {recursive: true});
  // callTag يمنع نداءات --repeat من الدهس فوق بعضها.
  const outFile = path.join(OUT_DIR,
      callTag ? `${scanId}--${callTag}.json` : `${scanId}.json`);
  const record = {
    scanId,
    callTag: callTag || null,
    requestedAt: new Date(Date.now() - ms).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: ms,
    // A85: زمن الترويسة وحده — ليس زمن التوليد. يُحفَظ للمقارنة لا للاستشهاد.
    headerMs,
    // ختم المزوّد نفسه، شاهد مستقلّ على زمن النداء.
    providerCreatedAt: envelope.created ?
        new Date(envelope.created * 1000).toISOString() : null,
    payloadBytes,
    sampleCount,
    model: DEEPSEEK_MODEL,
    timeoutMs: SCRIPT_DEEPSEEK_TIMEOUT_MS,
    requestBody: {...requestBody, messages: [
      {role: 'system', content: '(SYSTEM_PROMPT_V6 — محذوف من هذا الملفّ طولاً؛ انظر functions/src/prompts/systemPromptV6.js)'},
      {role: 'user', content: '(محذوف من هذا الملفّ طولاً — نفس userMessage المُرسَل، ' + payloadBytes + ' بايت)'},
    ]},
    finishReason,
    completionTokens,
    reasoningTokens,
    contentLen,
    usage,
    rawEnvelope: envelope,
    parsedReport: null,
    parseError: null,
    missingCoreKeys: null,
  };

  // ─── التحقّق من وجود خطأ من المزوّد داخل استجابة 200 ──────────────────
  if (envelope.error) {
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
    console.error(`[measure][${scanId}] provider error inside HTTP 200: ` +
        `${envelope.error.message || JSON.stringify(envelope.error).slice(0, 200)}`);
    throw new Error(`[${scanId}] DeepSeek provider error: ` +
        `${envelope.error.message || 'unknown'}`);
  }

  // ─── لا محتوى إطلاقاً ────────────────────────────────────────────────
  if (!content) {
    fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
    console.error(`[measure][${scanId}] NO CONTENT (finish=${finishReason}, ` +
        `output=${completionTokens}/${DEEPSEEK_MAX_TOKENS})`);
    throw new Error(`[${scanId}] DeepSeek returned no content ` +
        `(finish_reason=${finishReason})`);
  }

  // ─── تحليل المحتوى — لا يُفشل السكربت؛ يُسجَّل ويُكتب كما هو ──────────
  try {
    const parsed = JSON.parse(stripCodeFence(content));
    const resolved = resolveReport(parsed);
    if (resolved.ok) {
      record.parsedReport = resolved.report;
      record.missingCoreKeys = missingCoreKeys(resolved.report);
    } else {
      record.parseError = `resolveReport rejected shape: ${resolved.shape}`;
    }
  } catch (parseErr) {
    console.error(`[measure][${scanId}] JSON.parse failed: ${parseErr.message}`);
    try {
      const {jsonrepair} = require('jsonrepair');
      const repaired = JSON.parse(jsonrepair(stripCodeFence(content)));
      const resolved = resolveReport(repaired);
      if (resolved.ok) {
        record.parsedReport = resolved.report;
        record.missingCoreKeys = missingCoreKeys(resolved.report);
        record.parseError = `recovered via jsonrepair (original: ${parseErr.message})`;
      } else {
        record.parseError = `jsonrepair recovered but shape rejected: ${resolved.shape}`;
      }
    } catch (repairErr) {
      record.parseError = `JSON.parse failed (${parseErr.message}); ` +
          `jsonrepair also failed (${repairErr.message})`;
    }
  }

  fs.writeFileSync(outFile, JSON.stringify(record, null, 2), 'utf-8');
  console.log(`[measure][${scanId}] ✓ كُتب ${outFile}` +
      (record.parsedReport ?
          ` — grade=${record.parsedReport.grade} score=${record.parsedReport.score}` :
          ` — ⚠ parseError=${record.parseError}`));

  return {
    scanId,
    dryRun: false,
    payloadBytes,
    sampleCount,
    durationMs: ms,
    finishReason,
    completionTokens,
    reasoningTokens,
    outFile,
    grade: record.parsedReport ? record.parsedReport.grade : null,
    score: record.parsedReport ? record.parsedReport.score : null,
  };
}

(async () => {
  console.log(`═══ measure-deepseek-only-variance ${DRY_RUN ? '(--dry-run)' : ''} ═══`);
  console.log(`model=${DEEPSEEK_MODEL} scriptTimeoutMs=${SCRIPT_DEEPSEEK_TIMEOUT_MS} ` +
      `productionTimeoutMs(unchanged)=callDeepSeek.js:25`);

  if (!DRY_RUN && !process.env.DEEPSEEK_API_KEY) {
    console.error('\n✗ توقّف بلا نداء: DEEPSEEK_API_KEY غير مضبوط في البيئة.');
    console.error('  export DEEPSEEK_API_KEY=$(gcloud secrets versions access latest ' +
        '--secret=DEEPSEEK_API_KEY --project neuralchek-9b6d7)');
    process.exit(1);
  }

  // بناء قائمة التشغيل: --only يقصرها على فحص، و--repeat يكرّرها بوسم لكل نداء.
  let selected = TARGETS;
  if (ONLY) {
    selected = TARGETS.filter((t) => t.scanId.startsWith(ONLY));
    if (selected.length === 0) {
      console.error(`\n✗ توقّف: --only ${ONLY} لا يطابق أي فحص في TARGETS.`);
      process.exit(1);
    }
  }
  const runList = [];
  for (const t of selected) {
    for (let i = 1; i <= REPEAT; i++) {
      runList.push(REPEAT > 1 ? {...t, callTag: `call${i}`} : t);
    }
  }
  console.log(`عدد النداءات: ${runList.length}` +
      (ONLY ? ` · only=${ONLY}` : '') + (REPEAT > 1 ? ` · repeat=${REPEAT}` : ''));

  // Promise.all — بالتوازي، كما طُلب. فشل أيّ فحص يرمي فوراً؛ processOne
  // يكتب ملفّ أيّ استجابة خام وصلت قبل أن يرمي، فلا يضيع نداء دُفع ثمنه.
  const results = await Promise.all(runList.map(processOne));

  console.log('\n═══ الخلاصة ═══');
  for (const r of results) {
    if (r.dryRun) {
      console.log(`  ${r.scanId}: dry-run — payloadBytes=${r.payloadBytes} ` +
          `sampleCount=${r.sampleCount}`);
    } else {
      console.log(`  ${r.scanId}: ${r.grade}/${r.score} في ${r.durationMs}ms ` +
          `finish=${r.finishReason} output=${r.completionTokens} ` +
          `reasoning=${r.reasoningTokens} → ${r.outFile}`);
    }
  }
})().catch((e) => {
  console.error('\n✗ توقّف بخطأ:', e.message || e);
  process.exit(1);
});
