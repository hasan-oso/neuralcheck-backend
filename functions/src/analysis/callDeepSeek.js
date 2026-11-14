const {stripCodeFence} = require("./stripCodeFence");
const {sanitizeFailureText, markFailureTextSanitized} = require("../utils/failureText");
const {resolveReport, missingCoreKeys, describeShape,
  REPORT_SHAPE_KEYS, CORE_KEY_GROUPS} = require("./reportShape");

// ===================================================
// callDeepSeek — استدعاء واحد مع وضع التفكير
// ===================================================
//
// اسم النموذج القانوني. الاسم السابق "deepseek-v4-flash" غير مُدرَج في
// /models إطلاقاً، لكن المزوّد يقبله ويردّ صامتاً بـ deepseek-flash —
// تحقّقنا بإرسال الاسمين فعلياً فكان حقل model في الاستجابة deepseek-flash
// في الحالتين. نستخدم الاسم الحقيقي كي يعكس report.aiModel ما جرى فعلاً.
const DEEPSEEK_MODEL = "deepseek-flash";

// السقف مشترك بين التفكير والجواب — وهذا لبّ ما أُصلح هنا.
// كان 16384: يلتهمه التفكير عالي الجهد فيعود الجواب مبتوراً أو فارغاً.
// السجلّ الحاسم من الإنتاج: output=16384 finish=length — السقف بالضبط ثم بتر.
// 65536 هو الافتراض الرسمي لوضع التفكير عند DeepSeek (8K بلا تفكير،
// 128K عند reasoning_effort=max). الجواب الكامل يقيس 4000-6000 توكناً،
// فالمساحة الباقية للتفكير واسعة ولا يزاحمها الجواب.
const DEEPSEEK_MAX_TOKENS = 65536;

// مهلة الاستدعاء الواحد. مهلة الدالة 300 ثانية، وميزانية إعادة المحاولة
// في callAI.js محسوبة على أساس هذا الرقم.
const DEEPSEEK_TIMEOUT_MS = 130000;

/**
 * خطأ مُصنَّف من DeepSeek — يحمل السبب الحقيقي وقابلية إعادة المحاولة.
 * الرسالة العامة "returned empty content" كانت تخفي ثلاث حالات مختلفة
 * تماماً، فكنّا عمياناً عن سبب كل فشل.
 */
class DeepSeekError extends Error {
  /**
   * @param {string} message الرسالة
   * @param {string} kind النوع: http_error|provider_error|truncated|
   *   empty_content|parse_failed|shape_invalid|timeout|network_error
   * @param {boolean} retryable هل إعادة المحاولة بنفس المدخلات مجدية؟
   * @param {Object} [meta] بيانات تشخيصية
   */
  constructor(message, kind, retryable, meta = {}) {
    super(message);
    this.name = "DeepSeekError";
    this.kind = kind;
    this.retryable = retryable;
    this.meta = meta;
    // رسالته مبنيّة في هذا الملفّ ونصّ المزوّد فيها مُنقّى عند البناء (القاعدة 36): لا تُنقّى ثانيةً (failureTextOnce).
    markFailureTextSanitized(this);
  }
}

/**
 * يتحقّق أن الناتج تقرير قابل للاستهلاك، ويستخلصه من مصفوفة إن لزم.
 *
 * القرار نفسه في reportShape — مشترك مع Gemini كي لا يتفرّع السلوك بين
 * المزوّدين مرّةً أخرى. ما يخصّ DeepSeek هنا شيئان فقط: نوع الخطأ، وسابقة
 * السجلّ.
 *
 * الرفض مقصود أن يكون قابلاً لإعادة المحاولة (retryable=true) تماماً كنمط
 * truncated: الرمي يُطلق المحاولة الثانية في callDeepSeekWithRetry ثم
 * السقوط إلى Gemini، وكلاهما أفضل من تقرير C/50 فارغ يُحسب على المستخدم
 * ويُخزَّن كأنه تشخيص.
 *
 * الشكل مُعامِل، لا نسخة ثالثة (أمر مستخدم 2026-09-23 +03، القرار ١، القاعدة
 * 24): shapeSpec.shapeKeys/coreKeyGroups تُمرَّر من المستدعي (callAIv7 يمرّر
 * V7_SHAPE_KEYS/V7_CORE_KEY_GROUPS من reportShapeV7.js — نفس المصدر الذي
 * يفحص به guardV7Response الشكل، لا قائمة مكتوبة هنا من جديد). غيابه
 * (V3/V5/V6 كما هو الآن) يُبقي REPORT_SHAPE_KEYS/CORE_KEY_GROUPS الحاليين
 * بلا أي تغيير سلوكي.
 *
 * @param {*} parsed الناتج
 * @param {string} origin "parse" أو "repair" — من أيّ مسار جاء
 * @param {Object} meta بيانات تشخيصية تُرفق بالخطأ
 * @param {{shapeKeys: string[], coreKeyGroups: string[][]}} [shapeSpec]
 *   مواصفة شكل مُمرَّرة (V7 مثلاً) — افتراضياً V3/V5/V6
 * @return {Object} التقرير
 */
function ensureReportShape(parsed, origin, meta, shapeSpec) {
  const shapeKeys = (shapeSpec && shapeSpec.shapeKeys) || REPORT_SHAPE_KEYS;
  const coreKeyGroups = (shapeSpec && shapeSpec.coreKeyGroups) || CORE_KEY_GROUPS;
  const r = resolveReport(parsed, shapeKeys);

  if (!r.ok) {
    throw new DeepSeekError(
        `DeepSeek ${origin} produced no usable report (${r.shape}); ` +
        `need one of ${shapeKeys.join("/")}`,
        "shape_invalid", true, meta);
  }

  if (r.extractedFrom !== null) {
    console.warn(`[deepseek] ${origin} returned an array — extracting ` +
        `element [${r.extractedFrom}] (carries ${r.matched}); ` +
        `discarding ${r.discarded} sibling value(s)`);
  }

  // النقص لا يمنع القبول: تقرير بدرجة وملخّص صالح للاستعمال. لكنه لا يمرّ
  // صامتاً — خمسة تقارير مبتورة خرجت للمستخدمين بلا أي إنذار قبل هذا السطر.
  const missing = missingCoreKeys(r.report, coreKeyGroups);
  if (missing.length > 0) {
    console.warn(`[deepseek] ${origin} report INCOMPLETE — missing ` +
        `${missing.length} core key(s): ${missing.join(",")}`);
  }

  return r.report;
}

/**
 * يستدعي DeepSeek ويُعيد JSON محلَّلاً.
 *
 * اسم النموذج وسيط لا ثابت منذ feat/model-switch-admin: يأتي من
 * settings/ai عبر resolveAiConfig، ويسقط إلى DEEPSEEK_MODEL حين لا
 * يُمرَّر. القيمة المُمرَّرة مُتحقَّق منها ضد قائمة مغلقة قبل أن تصل هنا،
 * فلا يُعاد التحقّق — لكن السقوط يبقى كي لا يكسر مستدعياً قديماً.
 *
 * @param {string} userMessage رسالة المستخدم
 * @param {string} systemPrompt برومبت النظام
 * @param {string} deepseekKey المفتاح
 * @param {string} [model] اسم النموذج
 * @param {{shapeKeys: string[], coreKeyGroups: string[][]}} [shapeSpec]
 *   مواصفة شكل مُمرَّرة إلى ensureReportShape — افتراضياً V3/V5/V6
 * @param {{text: ?string}} [rawCapture] قناة جانبية اختيارية — تُملأ بنصّ
 *   المحتوى الخام (القرار ٢) قبل أي معالجة. لا تُمرَّر من مسار V6 — صفر
 *   أثر هناك.
 * @return {Promise<Object>} الاستجابة محلَّلة
 */
async function callDeepSeek(userMessage, systemPrompt, deepseekKey, model, shapeSpec, rawCapture) {
  const modelId = (typeof model === "string" && model.trim() !== "") ?
      model.trim() :
      DEEPSEEK_MODEL;
  const requestBody = {
    model: modelId,
    temperature: 0.1,
    max_tokens: DEEPSEEK_MAX_TOKENS,
    response_format: {type: "json_object"},
    messages: [
      {role: "system", content: systemPrompt},
      {role: "user", content: userMessage},
    ],
    // أعلى مستوى الطلب — لا داخل extra_body.
    //
    // extra_body اصطلاح مكتبة OpenAI-Python: المكتبة تفكّه وتدمج محتواه في
    // أعلى المستوى قبل الإرسال. عبر fetch الخام يصل كمفتاح مجهول فيُتجاهَل
    // بصمت — أي أن إعداد التفكير لم يبلغ المزوّد قطّ منذ كُتب، وكان يعمل
    // بالافتراضي (enabled/high) لا بأمرنا.
    //
    // reasoning_effort يبقى "high" عمداً: تحليل ~1600 عيّنة خام عمل استدلالي
    // ثقيل، والهدف أن يجد التفكير مساحته لا أن يُقلَّص. سطر السجل أدناه يقيس
    // استهلاكه الحقيقي، فإن تبيّن أنه يهدر بلا فائدة نقرّر على رقم لا ظنّ.
    thinking: {
      type: "enabled",
      reasoning_effort: "high",
    },
  };

  const startMs = Date.now();
  let response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${deepseekKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
    });
  } catch (err) {
    const ms = Date.now() - startMs;
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    console.error(`[deepseek] ${isTimeout ? "TIMEOUT" : "NETWORK"} after ${ms}ms ` +
        `(limit=${DEEPSEEK_TIMEOUT_MS}ms): ${sanitizeFailureText(err)}`);
    // المهلة غير قابلة لإعادة المحاولة: محاولة ثانية بنفس المهلة تلتهم
    // الميزانية الزمنية وتترك Gemini بلا وقت.
    throw new DeepSeekError(
        `DeepSeek ${isTimeout ? "timed out" : "network error"} after ${ms}ms: ` +
        `${sanitizeFailureText(err)}`,
        isTimeout ? "timeout" : "network_error", false, {ms});
  }

  if (!response.ok) {
    const errBody = await response.text();
    // نصّ الجسم من المزوّد (القاعدة 36): يُنقّى مرّة واحدة للسطر وللخطأ المرمي.
    const errText = sanitizeFailureText(Object.assign(new Error(errBody), {code: response.status}));
    console.error(`[deepseek] HTTP ${response.status} after ${Date.now() - startMs}ms: ` +
        `${errText}`);
    // 4xx: مصادقة أو طلب فاسد — إعادة المحاولة بنفس المدخلات عبث.
    // 5xx: عطل عابر عند المزوّد → تستحق محاولة ثانية.
    throw new DeepSeekError(
        `DeepSeek HTTP ${response.status}: ${errText}`,
        "http_error", response.status >= 500, {status: response.status});
  }

  const envelope = await response.json();

  // ─── التشخيص أولاً، قبل أي رمي ──────────────────────────────────
  // كان سطر السجل يقع بعد فحص المحتوى الفارغ، فكل فشل يُرمى قبل أن يُسجَّل
  // شيء — ومن هنا جاء العمى: 0 تقارير كاملة في 30 يوماً بلا سطر واحد يقول
  // لماذا. الآن يُسجَّل كل شيء أولاً، ثم يُقرَّر الرمي.
  const usage = envelope.usage || {};
  const details = usage.completion_tokens_details || {};
  const reasoningTokens = details.reasoning_tokens ?? null;
  const rt = reasoningTokens === null ? "n/a" : reasoningTokens;
  const finishReason = envelope.choices?.[0]?.finish_reason || "unknown";
  const content = envelope.choices?.[0]?.message?.content;
  const contentLen = typeof content === "string" ? content.length : 0;
  const ms = Date.now() - startMs;

  console.log(`[deepseek] resp in ${ms}ms model=${envelope.model || "?"} ` +
      `finish=${finishReason} ` +
      `cache_hit=${usage.prompt_cache_hit_tokens || 0} ` +
      `cache_miss=${usage.prompt_cache_miss_tokens || 0} ` +
      `output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS} ` +
      `reasoning=${rt} content_len=${contentLen}`);

  const meta = {
    finishReason,
    completionTokens: usage.completion_tokens || 0,
    reasoningTokens,
    contentLen,
    maxTokens: DEEPSEEK_MAX_TOKENS,
    ms,
  };

  // ─── الحالة 1: خطأ من المزوّد داخل استجابة 200 ──────────────────
  if (envelope.error) {
    const em = sanitizeFailureText(new Error(envelope.error.message ||
        JSON.stringify(envelope.error)));
    console.error(`[deepseek] provider error inside HTTP 200: ${em}`);
    throw new DeepSeekError(`DeepSeek provider error: ${em}`,
        "provider_error", false, meta);
  }

  // ─── الحالتان 2 و3: لا محتوى — نميّز البتر عن الفراغ الفعلي ─────
  if (!content) {
    if (finishReason === "length") {
      // التفكير التهم كل الميزانية فلم يبقَ للجواب شيء. هذا بالضبط ما كان
      // يقع بسقف 16384، وكان يُرمى تحت اسم "returned empty content".
      console.error(`[deepseek] BUDGET EXHAUSTED: thinking consumed the whole ` +
          `allowance — output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS} ` +
          `reasoning=${rt} → no tokens left for the answer`);
      throw new DeepSeekError(
          `DeepSeek truncated before emitting content (finish_reason=length, ` +
          `output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS}, ` +
          `reasoning=${rt})`,
          "truncated", true, meta);
    }
    console.error(`[deepseek] EMPTY CONTENT with finish=${finishReason} — ` +
        `not a truncation; the model returned nothing`);
    throw new DeepSeekError(
        `DeepSeek returned empty content (finish_reason=${finishReason}, ` +
        `output=${usage.completion_tokens || 0})`,
        "empty_content", true, meta);
  }

  // محتوى موجود لكنه مبتور — قد ينقذه jsonrepair أدناه.
  if (finishReason === "length") {
    console.error(`[deepseek] response truncated (finish_reason=length, ` +
        `output=${usage.completion_tokens || 0}/${DEEPSEEK_MAX_TOKENS}, ` +
        `reasoning=${rt}) — attempting parse anyway`);
  }

  // أمر مستخدم 2026-09-23 +03، القرار ٢: "callDeepSeek وcallGemini تُعيدان
  // نصّ المحتوى الخام كما وصل، بجانب الناتج المحلَّل... قبل stripCodeFence
  // وقبل jsonrepair وقبل أي تحويل، وفي فرع النجاح وفرع الإصلاح كليهما."
  // `content` هنا هو تلك القيمة بالضبط — مباشرة من envelope.choices[0].
  // message.content، قبل أي معالجة. rawCapture قناة جانبية اختيارية (كائن
  // {text} يملؤه المستدعي) — **لا** جزء من القيمة المُعادة (لا يلمس شكل
  // التقرير نفسه)، فمسار V6 (لا يمرّره) صفر تغيير سلوكي أو شكلي.
  if (rawCapture) rawCapture.text = content;

  try {
    return ensureReportShape(
        JSON.parse(stripCodeFence(content)), "parse", meta, shapeSpec);
  } catch (parseErr) {
    // رفض الشكل ليس فشل تحليل: النصّ كان JSON صالحاً تماماً، وتمريره على
    // jsonrepair يُعيد الشيء نفسه. مرّره كما هو كي تُعاد المحاولة بنوعه.
    if (parseErr instanceof DeepSeekError) throw parseErr;

    console.error(`[deepseek] JSON.parse failed: ${parseErr.message}`);
    console.error(`[deepseek] raw_length=${contentLen} finish=${finishReason} ` +
        `output=${usage.completion_tokens || 0} reasoning=${rt}`);
    console.error(`[deepseek] raw_head: ${content.slice(0, 400)}`);
    console.error(`[deepseek] raw_tail: ${content.slice(-400)}`);

    let repaired;
    try {
      const {jsonrepair} = require("jsonrepair");
      repaired = JSON.parse(jsonrepair(stripCodeFence(content)));
    } catch (repairErr) {
      console.error(`[deepseek] JSON repair also failed: ${repairErr.message}`);
      throw new DeepSeekError(
          `DeepSeek output unparseable (${parseErr.message}; repair also failed)`,
          "parse_failed", true, meta);
    }

    // الشكل يُطبع دائماً بعد كل إصلاح ناجح — لا "succeeded" عمياء بعد اليوم.
    // ويسبق التحقّق عمداً: حتى المرفوض يترك أثراً يُقرأ منه سبب الرفض.
    console.warn(
        `[deepseek] JSON repair succeeded — ${describeShape(repaired)}`);
    return ensureReportShape(repaired, "repair", meta, shapeSpec);
  }
}

module.exports = {
  callDeepSeek,
  DeepSeekError,
  // مُصدَّر للاختبار: الحارس يجب أن يُختبر مباشرةً لا عبر الشبكة.
  // المشترك (describeShape وغيره) يُستورَد من reportShape.
  ensureReportShape,
  DEEPSEEK_MODEL,
  DEEPSEEK_MAX_TOKENS,
  DEEPSEEK_TIMEOUT_MS,
};
