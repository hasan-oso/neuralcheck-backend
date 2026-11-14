const {stripCodeFence} = require("./stripCodeFence");
const {sanitizeFailureText, markFailureTextSanitized} = require("../utils/failureText");
const {resolveReport, missingCoreKeys, describeShape,
  REPORT_SHAPE_KEYS, CORE_KEY_GROUPS} = require("./reportShape");

// ===================================================
// callGeminiFallback — المزوّد الاحتياطي
// ===================================================
const GEMINI_MODEL = "gemini-2.5-flash";

// maxOutputTokens في Gemini 2.5 يشمل توكنات التفكير — نفس فخّ DeepSeek.
// الجواب الكامل مقيس فعلياً عند 4000-4300 توكن، فنترك له ضعف حاجته.
const GEMINI_MAX_OUTPUT_TOKENS = 16384;

// ميزانية تفكير صريحة. بلا تحديد يقرّر النموذج بنفسه وقد يلتهم المخرجات كما
// وقع مع DeepSeek. 8192 تترك ~8000 توكن للجواب — أي ضعف الحاجة المقيسة.
// (المدى المقبول لـ2.5-flash هو 0..24576؛ الصفر يعطّل التفكير.)
//
// لم نعطّله: الاحتياطي يُستدعى حين يفشل DeepSeek، أي على الحمولات الأصعب
// تحديداً وهي أحوج ما تكون للاستدلال. الاقتصاد هنا من تحديد السقف لا من
// إلغاء القدرة.
const GEMINI_THINKING_BUDGET = 8192;

// لم تكن هناك مهلة إطلاقاً على generateContent — استدعاء معلّق كان يلتهم ما
// تبقّى من مهلة الدالة (300 ثانية) ثم يسقط كل شيء بلا سبب مسجَّل.
const GEMINI_TIMEOUT_MS = 55000;

/**
 * خطأ مُصنَّف من Gemini — بنفس شكل DeepSeekError كي يعامله callAI بمنطق واحد.
 */
class GeminiError extends Error {
  /**
   * @param {string} message الرسالة
   * @param {string} kind النوع
   * @param {Object} [meta] بيانات تشخيصية
   */
  constructor(message, kind, meta = {}) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.meta = meta;
    // رسالته مبنيّة في هذا الملفّ ونصّ المزوّد فيها مُنقّى عند البناء (القاعدة 36): لا تُنقّى ثانيةً (failureTextOnce).
    markFailureTextSanitized(this);
  }
}

/**
 * يتحقّق أن الناتج تقرير قابل للاستهلاك، ويستخلصه من مصفوفة إن لزم.
 *
 * ─── لماذا الرفض هنا فشلٌ صلب، وهو الصواب ───────────────────────────
 *
 * Gemini هو البديل الأخير: لا إعادة محاولة بعده ولا مزوّد ثالث. فرميُ خطأ
 * هنا يعني أن callAI يرمي "Both DeepSeek and Gemini failed"، فيعود
 * runAnalysisInternal بـ aiFailed، فيرفض analyzeDevice الطلب بـ
 * HttpsError("unavailable") — **دون احتساب فحص، ودون حفظ تقرير، ودون
 * كتابة ملفّ جهاز** — ويرى المستخدم رسالة بلغته تطلب إعادة المحاولة.
 *
 * البديل هو القبول مع راية: يُخزَّن تقرير C/50، ويُستهلك فحص من خطّة
 * مدفوعة، ويرى المستخدم تشخيصاً يبدو شرعياً تماماً وهو فارغ. وقد أثبتت
 * حادثة 629485e9 أن مثل هذا المستند لا يُكتشف إلا بقراءة السجلّ يدوياً.
 *
 * الكفّتان غير متكافئتين: كلفة الرفض خطأً = إعادة محاولة واحدة مجّانية.
 * وكلفة القبول خطأً = فحص مدفوع يُستهلك + تشخيص كاذب يُخزَّن + لا أثر.
 * ووصولنا إلى Gemini أصلاً يعني أن DeepSeek فشل؛ فناتج بلا شكل هنا معناه
 * أن المزوّدين لم يُنتجا شيئاً صالحاً — وهو حرفياً ما تصفه رسالة الفشل.
 *
 * لذلك نرفض صراحةً. النقص الجزئي شأن آخر: يُقبَل ويُرفع له علم.
 *
 * الشكل مُعامِل، لا نسخة ثالثة (أمر مستخدم 2026-09-23 +03، القرار ١، القاعدة
 * 24) — انظر التعليق المطابق في callDeepSeek.js:ensureReportShape.
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
    throw new GeminiError(
        `Gemini ${origin} produced no usable report (${r.shape}); ` +
        `need one of ${shapeKeys.join("/")}`,
        "shape_invalid", meta);
  }

  if (r.extractedFrom !== null) {
    console.warn(`[gemini] ${origin} returned an array — extracting ` +
        `element [${r.extractedFrom}] (carries ${r.matched}); ` +
        `discarding ${r.discarded} sibling value(s)`);
  }

  const missing = missingCoreKeys(r.report, coreKeyGroups);
  if (missing.length > 0) {
    console.warn(`[gemini] ${origin} report INCOMPLETE — missing ` +
        `${missing.length} core key(s): ${missing.join(",")}`);
  }

  return r.report;
}

/**
 * يستدعي Gemini كاحتياطي ويُعيد JSON محلَّلاً.
 * @param {string} userMessage رسالة المستخدم
 * @param {string} systemPrompt برومبت النظام
 * @param {string} geminiKey المفتاح
 * @param {{shapeKeys: string[], coreKeyGroups: string[][]}} [shapeSpec]
 *   مواصفة شكل مُمرَّرة إلى ensureReportShape — افتراضياً V3/V5/V6
 * @param {{text: ?string}} [rawCapture] قناة جانبية اختيارية — القرار ٢،
 *   انظر التعليق المطابق في callDeepSeek.js
 * @return {Promise<Object>} الاستجابة محلَّلة
 */
async function callGeminiFallback(userMessage, systemPrompt, geminiKey, shapeSpec, rawCapture) {
  const {GoogleGenerativeAI} = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(geminiKey);

  const model = genAI.getGenerativeModel(
      {
        model: GEMINI_MODEL,
        systemInstruction: systemPrompt,
        generationConfig: {
          temperature: 0.4,
          responseMimeType: "application/json",
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          // تمرير حرفي: المكتبة 0.24.1 لا تعرف thinkingConfig في تعريفات
          // أنواعها، لكنها تمرّر generationConfig كما هو إلى الطلب
          // (dist/index.js:1377 — Object.assign({generationConfig: …})) وتستهدف
          // v1beta افتراضياً (dist/index.js:308) وهي النسخة التي تدعم الحقل.
          // JavaScript لا TypeScript، فلا شيء يُسقِط المفتاح قبل الإرسال.
          thinkingConfig: {
            thinkingBudget: GEMINI_THINKING_BUDGET,
          },
        },
      },
      // المهلة عبر RequestOptions (dist/generative-ai.d.ts:1179).
      {timeout: GEMINI_TIMEOUT_MS},
  );

  const startMs = Date.now();
  let result;
  try {
    result = await model.generateContent(userMessage);
  } catch (err) {
    const ms = Date.now() - startMs;
    console.error(`[gemini] FAILED after ${ms}ms (limit=${GEMINI_TIMEOUT_MS}ms): ` +
        `${sanitizeFailureText(err)}`);
    throw new GeminiError(
        `Gemini call failed after ${ms}ms: ${sanitizeFailureText(err)}`,
        "request_failed", {ms});
  }

  const rawText = result.response.text();
  const finishReason = result.response.candidates?.[0]?.finishReason || "unknown";
  const usage = result.response.usageMetadata || {};
  // thoughtsTokenCount يكشف كم التهم التفكير من maxOutputTokens.
  const thoughts = usage.thoughtsTokenCount ?? null;
  const th = thoughts === null ? "n/a" : thoughts;
  const ms = Date.now() - startMs;

  console.log(`[gemini] resp in ${ms}ms finish=${finishReason} ` +
      `prompt=${usage.promptTokenCount || 0} ` +
      `output=${usage.candidatesTokenCount || 0}/${GEMINI_MAX_OUTPUT_TOKENS} ` +
      `thoughts=${th}/${GEMINI_THINKING_BUDGET} ` +
      `total=${usage.totalTokenCount || 0} raw_length=${rawText.length}`);

  const meta = {
    finishReason,
    outputTokens: usage.candidatesTokenCount || 0,
    thoughtsTokens: thoughts,
    rawLength: rawText.length,
    ms,
  };

  if (finishReason === "MAX_TOKENS") {
    console.error(`[gemini] response truncated (finishReason=MAX_TOKENS, ` +
        `output=${usage.candidatesTokenCount || 0}/${GEMINI_MAX_OUTPUT_TOKENS}, ` +
        `thoughts=${th}/${GEMINI_THINKING_BUDGET})`);
  }

  if (!rawText) {
    console.error(`[gemini] EMPTY CONTENT with finish=${finishReason} thoughts=${th}`);
    throw new GeminiError(
        `Gemini returned empty content (finishReason=${finishReason}, thoughts=${th})`,
        finishReason === "MAX_TOKENS" ? "truncated" : "empty_content", meta);
  }

  // أمر مستخدم 2026-09-23 +03، القرار ٢ — نفس التعليق المطابق في
  // callDeepSeek.js: rawText هنا هو result.response.text() مباشرة، قبل
  // stripCodeFence/JSON.parse/jsonrepair. rawCapture قناة جانبية اختيارية،
  // لا جزء من القيمة المُعادة.
  if (rawCapture) rawCapture.text = rawText;

  try {
    return ensureReportShape(
        JSON.parse(stripCodeFence(rawText)), "parse", meta, shapeSpec);
  } catch (parseErr) {
    // رفض الشكل ليس فشل تحليل: النصّ كان JSON صالحاً تماماً، وتمريره
    // على jsonrepair يُعيد الشيء نفسه.
    if (parseErr instanceof GeminiError) throw parseErr;

    console.error(`[gemini] JSON.parse failed: ${parseErr.message}`);
    console.error(`[gemini] raw_length=${rawText.length} finish=${finishReason} ` +
        `thoughts=${th}`);
    console.error(`[gemini] raw_head: ${rawText.slice(0, 400)}`);
    console.error(`[gemini] raw_tail: ${rawText.slice(-400)}`);

    let repaired;
    try {
      const {jsonrepair} = require("jsonrepair");
      repaired = JSON.parse(jsonrepair(stripCodeFence(rawText)));
    } catch (repairErr) {
      console.error(`[gemini] JSON repair also failed: ${repairErr.message}`);
      throw new GeminiError(
          `Gemini output unparseable (${parseErr.message}; repair also failed)`,
          "parse_failed", meta);
    }

    // الشكل يُطبع دائماً بعد كل إصلاح ناجح — لا "succeeded" عمياء.
    console.warn(
        `[gemini] JSON repair succeeded — ${describeShape(repaired)}`);
    return ensureReportShape(repaired, "repair", meta, shapeSpec);
  }
}

module.exports = {
  callGeminiFallback,
  GeminiError,
  // مُصدَّر للاختبار — الحارس نفسه في المزوّدين.
  ensureReportShape,
  GEMINI_MODEL,
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_THINKING_BUDGET,
  GEMINI_TIMEOUT_MS,
};
