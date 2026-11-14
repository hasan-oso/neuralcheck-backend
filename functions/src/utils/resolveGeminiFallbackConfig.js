// ===================================================
// resolveGeminiFallbackConfig — راية إعدادات لتفعيل Gemini كاحتياطي على
// مسار V7 (أمر مستخدم 2026-09-23 +03، القرار ٢)
// ===================================================
//
// منقول من الخطّة، بنصّه (PLAN-01-ROADMAP.md §P1.8 القرار 3، خارج هذا
// المستودع — غير متحقَّق من هنا، القاعدة 29): "Gemini لا يبقى حاكماً
// احتياطياً — ويبقى موصولاً معطَّلاً براية. … الوصلة لا تُحذف — تبقى خلف
// راية إعدادات مُطفأة (بنمط settings/cache.reuseEnabled) كي تُشعَل بلا
// نشرة."
//
// نفس نمط resolveCacheConfig.js حرفياً: قراءة من Firestore، كاش بمهلة،
// وسقوط آمن إلى DEFAULT_GEMINI_FALLBACK_ENABLED (false) عند الغياب أو
// الفشل أو القيمة غير المنطقية.
//
// **الافتراضي FALSE مقصود، لا سهو (القاعدة 22)**: settings/geminiFallback
// (كما settings/ai وsettings/cache) غير موجود في الإنتاج اليوم (404) —
// منقول من المنسّق، NEURALCHECK-FINDINGS.md:214 في مساحة العمل، غير
// متحقَّق من هذا المستودع. فالغياب هو الحالة الفعلية اليوم، ويجب أن يعني
// "Gemini مطفأ" صراحةً — لا قيمة افتراضية تُخمَّن، ولا "معطَّل يعني مفعَّل
// عند الفشل" (ذلك بالضبط ما ورّط resolveCacheConfig.js لولا نفس الاحتراس
// هناك).
//
// ينطبق على مسار V7 (callAIv7) حصراً — V6 (callAI) لا يقرأ هذا الإعداد
// إطلاقاً؛ Gemini يبقى احتياطياً غير مشروط هناك كما كان دائماً (V6 هو
// الإنتاج الحيّ اليوم، والقيد الصريح: "قل ما يلزم فيه ولا تغيّره").

const {db} = require("./admin");
const {sanitizeFailureText} = require("./failureText");

const CONFIG_COLLECTION = "settings";
const CONFIG_DOC = "geminiFallback";
const CACHE_TTL_MS = 60_000;
const DEFAULT_GEMINI_FALLBACK_ENABLED = false;

let cache = {value: null, at: 0};

/**
 * يُفرغ الكاش الداخلي. للاختبار كي يسري التبديل فوراً.
 */
function clearGeminiFallbackConfigCache() {
  cache = {value: null, at: 0};
}

/**
 * يقرأ إعداد تفعيل Gemini كاحتياطي على مسار V7 من Firestore، بكاش وسقوط
 * آمن إلى DEFAULT_GEMINI_FALLBACK_ENABLED (معطّل) عند الغياب أو الفشل أو
 * القيمة غير المنطقية.
 * @return {Promise<{enabled: boolean, source: string}>} الإعداد
 */
async function resolveGeminiFallbackConfig() {
  const now = Date.now();
  if (cache.value && (now - cache.at) < CACHE_TTL_MS) return cache.value;

  let resolved = {enabled: DEFAULT_GEMINI_FALLBACK_ENABLED, source: "default"};

  try {
    const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
    const raw = snap.exists ? snap.data().enabled : undefined;

    if (typeof raw === "boolean") {
      resolved = {enabled: raw, source: "firestore"};
    } else if (raw !== undefined) {
      console.error(`[geminiFallbackConfig] settings/geminiFallback.enabled=${JSON.stringify(raw)} ` +
          `is not a boolean — falling back to ${DEFAULT_GEMINI_FALLBACK_ENABLED}`);
      resolved.source = "default_rejected_value";
    }
  } catch (e) {
    console.error(`[geminiFallbackConfig] read failed (${sanitizeFailureText(e)}) — ` +
        `falling back to ${DEFAULT_GEMINI_FALLBACK_ENABLED}`);
    resolved.source = "default_read_error";
  }

  cache = {value: resolved, at: now};
  return resolved;
}

module.exports = {
  resolveGeminiFallbackConfig,
  clearGeminiFallbackConfigCache,
  DEFAULT_GEMINI_FALLBACK_ENABLED,
  CONFIG_COLLECTION,
  CONFIG_DOC,
  CACHE_TTL_MS,
};
