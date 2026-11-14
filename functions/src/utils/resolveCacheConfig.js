// ===================================================
// resolveCacheConfig — راية إعدادات لإعادة استخدام تقرير سابق (P0.5)
// ===================================================
//
// لماذا راية لا حذف كود: القرار في runAnalysisInternal.js (`diffRatio <
// 0.20`) لم يعد يقيس شيئاً موثوقاً في مقام التوقيع الحالي (43، منه 16
// ميّتاً — S§2.4-2.5)، وإعادة تقرير قديم بحشو نوم 45 ثانية كانت تُنتج
// ادّعاءً كاذباً بأن الفحص تحليل جديد. لكن إعادة الاستخدام مفيدة خارج
// فترة التجربة الميدانية (تختصر كلفة نموذج على أجهزة لم تتغيّر فعلياً)،
// فتعطيلها الدائم بحذف الكود يفقد تلك الفائدة عند انتهاء التجربة. راية
// Firestore تتيح التبديل بلا نشرة جديدة — يطابق نمط resolveAiConfig.js.
//
// الافتراضي الآن FALSE (معطّل): هذا الفرع نفسه — P0.5 — سبب وجوده تعطيل
// إعادة الاستخدام أثناء التجربة الجارية. القيمة الآمنة عند غياب المستند
// أو فساده أو فشل القراءة هي "عطّل" لا "فعّل": مسار عدم إعادة الاستخدام
// يستدعي النموذج دائماً (كلفة أعلى، لا ادّعاء كاذب)؛ العكس (فشل القراءة
// يُفعّل الكاش) قد يُعيد تقريراً قديماً بصمت أثناء التجربة تحديداً حين لا
// نريد ذلك. لا قياس ميداني هنا (القاعدة ١٩ الجديدة تُجمّده) — القيمة
// الافتراضية قرار سلامة لا رقم مُقاس.

const {db} = require("./admin");
const {sanitizeFailureText} = require("./failureText");

const CONFIG_COLLECTION = "settings";
const CONFIG_DOC = "cache";
const CACHE_TTL_MS = 60_000;
const DEFAULT_REUSE_ENABLED = false;

let cache = {value: null, at: 0};

/**
 * يُفرغ الكاش الداخلي. للاختبار ولمسار الكتابة كي يسري التبديل فوراً.
 */
function clearCacheConfigCache() {
  cache = {value: null, at: 0};
}

/**
 * يقرأ إعداد إعادة استخدام الكاش من Firestore، بكاش وسقوط آمن إلى
 * DEFAULT_REUSE_ENABLED (معطّل) عند الغياب أو الفشل أو القيمة غير
 * المنطقية.
 * @return {Promise<{reuseEnabled: boolean, source: string}>} الإعداد
 */
async function resolveCacheConfig() {
  const now = Date.now();
  if (cache.value && (now - cache.at) < CACHE_TTL_MS) return cache.value;

  let resolved = {reuseEnabled: DEFAULT_REUSE_ENABLED, source: "default"};

  try {
    const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
    const raw = snap.exists ? snap.data().reuseEnabled : undefined;

    if (typeof raw === "boolean") {
      resolved = {reuseEnabled: raw, source: "firestore"};
    } else if (raw !== undefined) {
      console.error(`[cacheConfig] settings/cache.reuseEnabled=${JSON.stringify(raw)} ` +
          `is not a boolean — falling back to ${DEFAULT_REUSE_ENABLED}`);
      resolved.source = "default_rejected_value";
    }
  } catch (e) {
    console.error(`[cacheConfig] read failed (${sanitizeFailureText(e)}) — ` +
        `falling back to ${DEFAULT_REUSE_ENABLED}`);
    resolved.source = "default_read_error";
  }

  cache = {value: resolved, at: now};
  return resolved;
}

module.exports = {
  resolveCacheConfig,
  clearCacheConfigCache,
  DEFAULT_REUSE_ENABLED,
  CONFIG_COLLECTION,
  CONFIG_DOC,
  CACHE_TTL_MS,
};
