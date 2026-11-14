// ===================================================
// resolveAiConfig — إعداد النموذج من Firestore، بقائمة مغلقة
// ===================================================
//
// لماذا قائمة مغلقة لا حقل حرّ:
//
// الاسم "deepseek-flash" لا يظهر في /models بوصفه الاسم الوحيد — بل يظهر
// معه "deepseek-v4-pro"، و"deepseek-v4-flash" الذي كان في كودنا سابقاً
// **غير مُدرَج إطلاقاً** ومع ذلك يقبله المزوّد ويردّ صامتاً بـdeepseek-flash
// (مقيس: أرسلنا الأسماء الثلاثة وقرأنا حقل model في الاستجابة).
//
// فحقل حرّ يعني أن خطأً إملائياً واحداً — أو اسماً مستعاراً صامتاً — لا
// يظهر إلا عند أول فحص حقيقي، بعد أن يكون المستخدم قد دفع ثمنه. القائمة
// المغلقة تنقل الفشل من الإنتاج إلى لحظة الحفظ.
//
// ما استُبعد عمداً: "deepseek-v4-flash". يعمل، لكنه مرادف صامت — من يختاره
// يجد في تقاريره aiModel = "deepseek-flash"، فينكسر أي عزل لاحق للتقارير
// بحسب النموذج. اسم لا يُرى في التقرير ليس خياراً صالحاً.

const {db} = require("./admin");
const {sanitizeFailureText} = require("./failureText");

// القيم المسموحة. كلٌّ منها مُتحقَّق منه باستدعاء فعلي: الاسم مُدرَج في
// /models، والاستجابة تردّ حقل model مطابقاً، ووضع التفكير الذي نرسله
// (thinking.reasoning_effort=high) يعمل — قياس reasoning_tokens > 0.
const ALLOWED_DEEPSEEK_MODELS = [
  {
    id: "deepseek-flash",
    label: "DeepSeek Flash",
    // مقيس على الإنتاج: 12 استدعاءً، و13 تشغيل قياس.
    verified: "production",
    thinkingSupported: true,
    note: "الحالي. أرخص، ومقيس على حمولتنا الفعلية.",
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    // مُتحقَّق بالاستدعاء لا بالوثائق، ولم يُقَس على حمولة كاملة بعد.
    verified: "probe-only",
    thinkingSupported: true,
    note: "أغلى بنحو 3.5× على حمولتنا. لم يُقَس على فحص كامل.",
  },
];

const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

// مستند الإعداد. settings/app سابقة قائمة (registerUser يقرأ منه)، فنُبقي
// المجموعة نفسها ونفصل المستند كي لا يختلط إعداد الذكاء بإعداد الحسابات.
const CONFIG_COLLECTION = "settings";
const CONFIG_DOC = "ai";

// كاش داخل نسخة الدالّة. ستّون ثانية تكفي لأن التبديل حدث نادر، وتمنع
// قراءة Firestore على كل فحص. وأثر التأخير محدود: تبديل يسري خلال دقيقة
// على النسخ الحيّة، وفوراً على أي نسخة تبدأ باردة.
const CACHE_TTL_MS = 60_000;

let cache = {value: null, at: 0};

/**
 * هل الاسم ضمن القائمة المسموحة؟
 * @param {*} id الاسم
 * @return {boolean} النتيجة
 */
function isAllowedModel(id) {
  return ALLOWED_DEEPSEEK_MODELS.some((m) => m.id === id);
}

/**
 * يُفرغ الكاش. للاختبار ولمسار الكتابة كي يسري التبديل فوراً في النسخة
 * التي كتبته.
 */
function clearAiConfigCache() {
  cache = {value: null, at: 0};
}

/**
 * يقرأ إعداد الذكاء من Firestore، بكاش وسقوط آمن.
 *
 * السقوط إلى الافتراضي يقع في أربع حالات — الغياب، والفشل، والقيمة غير
 * النصّية، والاسم خارج القائمة. آخرها هو المهمّ: لو تسرّبت قيمة فاسدة إلى
 * المستند بأي طريق (كتابة مباشرة تتجاوز الدالّة، أو ترحيل، أو خطأ يدوي)
 * فالخادم لا ينقل الفساد إلى المزوّد — يسجّله ويمضي بالافتراضي.
 *
 * @return {Promise<{deepseekModel: string, source: string}>} الإعداد
 */
async function resolveAiConfig() {
  const now = Date.now();
  if (cache.value && (now - cache.at) < CACHE_TTL_MS) return cache.value;

  let resolved = {deepseekModel: DEFAULT_DEEPSEEK_MODEL, source: "default"};

  try {
    const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
    const raw = snap.exists ? snap.data().deepseekModel : undefined;

    if (typeof raw === "string" && raw.trim() !== "") {
      const id = raw.trim();
      if (isAllowedModel(id)) {
        resolved = {deepseekModel: id, source: "firestore"};
      } else {
        console.error(`[aiConfig] settings/ai.deepseekModel="${id}" is not ` +
            `in the allowed list — falling back to ${DEFAULT_DEEPSEEK_MODEL}`);
        resolved.source = "default_rejected_value";
      }
    }
  } catch (e) {
    console.error(`[aiConfig] read failed (${sanitizeFailureText(e)}) — ` +
        `falling back to ${DEFAULT_DEEPSEEK_MODEL}`);
    resolved.source = "default_read_error";
  }

  cache = {value: resolved, at: now};
  return resolved;
}

module.exports = {
  resolveAiConfig,
  isAllowedModel,
  clearAiConfigCache,
  ALLOWED_DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  CONFIG_COLLECTION,
  CONFIG_DOC,
  CACHE_TTL_MS,
};
