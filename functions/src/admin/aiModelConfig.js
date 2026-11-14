const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db, requireAdmin} = require("../utils/admin");
const {
  resolveAiConfig, isAllowedModel, clearAiConfigCache,
  ALLOWED_DEEPSEEK_MODELS, DEFAULT_DEEPSEEK_MODEL,
  CONFIG_COLLECTION, CONFIG_DOC, CACHE_TTL_MS,
} = require("../utils/resolveAiConfig");
const {hashIdForLog} = require("../utils/logRedaction");

// ===================================================
// getAiConfig / setAiModel — تبديل نموذج الذكاء من لوحة الإدارة
// ===================================================
//
// دالّتان لا واحدة. القراءة وحدها لا تكفي: البند الذي يرفض القيم خارج
// القائمة والبند الذي يسجّل «من غيّر ومتى» كلاهما يحتاج أن تمرّ الكتابة
// بالخادم. موقعٌ يكتب settings/ai مباشرةً يتجاوز التحقّق ولا يترك اسم
// فاعل — فتصير القائمة المغلقة زينةً، ويصير سجلّ التبديل ناقصاً بالضبط
// حين يلزم.
//
// لماذا لا تُسرد الأسعار والقدرات آلياً: نقطة /models عند DeepSeek تُعيد
// { id, object, owned_by } فقط — لا سعر ولا نافذة سياق ولا قدرات (مقيس
// باستدعاء فعلي، ومؤكَّد في وثائق النقطة). والأسعار في صفحة وثائق بشرية
// بلا نقطة نهاية. فما تُعيده getAiConfig هو ما نعرفه ونتحمّله: الأسماء
// المسموحة ووصفٌ ثابت لكلٍّ منها، ورابط التسعير كي تقرأه الواجهة للمستخدم
// بدل أن نزعم رقماً قد يتقادم بصمت.

const PRICING_DOC_URL = "https://api-docs.deepseek.com/quick_start/pricing";

// سجلّ التبديل. مجموعة فرعية تحت مستند الإعداد: تبقى مرتبطةً به ولا
// تُلوّث جذر قاعدة البيانات، وتُستعلَم زمنياً بلا فهرس مركّب.
const HISTORY_SUBCOLLECTION = "modelHistory";

/**
 * getAiConfig — القائمة المسموحة والقيمة الحالية.
 *
 * تُبنى الواجهة من هذا وحده: لا تكرّر أسماء النماذج ولا أوصافها في كود
 * الموقع، فيبقى تعريف واحد في الخادم.
 */
const getAiConfig = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      requireAdmin(request);

      const cfg = await resolveAiConfig();

      return {
        current: cfg.deepseekModel,
        // من أين جاءت القيمة الحالية: "firestore" أو "default" أو
        // "default_rejected_value" أو "default_read_error". الأخيران يعنيان
        // أن الواجهة يجب أن تُظهر تحذيراً لا أن تعرض الحالي كأنه اختيار.
        source: cfg.source,
        builtInDefault: DEFAULT_DEEPSEEK_MODEL,
        allowed: ALLOWED_DEEPSEEK_MODELS,
        pricingDocUrl: PRICING_DOC_URL,
        cacheTtlMs: CACHE_TTL_MS,
        // ما لا نوفّره، كي لا تنتظره الواجهة: /models لا تُعيد أسعاراً ولا
        // قدرات، فالأرقام المعروضة يجب أن تأتي من الرابط أعلاه لا منّا.
        pricingAvailableFromApi: false,
      };
    },
);

/**
 * setAiModel — يبدّل النموذج بعد التحقّق، ويسجّل التبديل.
 *
 * لا أثر رجعي: يُكتب الإعداد وحده. التقارير المحفوظة لا تُمسّ، وحقل
 * aiModel في كلٍّ منها يبقى شاهداً على النموذج الذي أنتجه فعلاً.
 */
const setAiModel = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      requireAdmin(request);

      const raw = (request.data || {}).deepseekModel;
      const next = (typeof raw === "string") ? raw.trim() : "";

      if (!next) {
        throw new HttpsError("invalid-argument",
            "deepseekModel مطلوب");
      }
      if (!isAllowedModel(next)) {
        // الرسالة تحمل القائمة كي يظهر سبب الرفض في الواجهة بلا مراجعة كود.
        throw new HttpsError("invalid-argument",
            `نموذج غير مسموح: "${next}". المسموح: ` +
            ALLOWED_DEEPSEEK_MODELS.map((m) => m.id).join(" | "));
      }

      const before = await resolveAiConfig();
      const ref = db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC);
      const at = admin.firestore.FieldValue.serverTimestamp();

      // القيمة نفسها ليست خطأً، لكنها ليست تبديلاً — لا تُسجَّل كي لا
      // يمتلئ السجلّ بأحداث لا تغيّر شيئاً.
      if (before.deepseekModel === next && before.source === "firestore") {
        return {changed: false, current: next, reason: "same_value"};
      }

      const actor = {
        uid: request.auth?.uid || null,
        email: request.auth?.token?.email || null,
      };

      await ref.set({
        deepseekModel: next,
        updatedAt: at,
        updatedBy: actor.email || actor.uid,
      }, {merge: true});

      // السجلّ منفصل عن الحالة: الحالة تُقرأ في كل فحص، والتاريخ يُقرأ عند
      // التحقيق. ولأن تبديل النموذج يغيّر المخرجات، هذا السطر هو ما يسمح
      // لاحقاً بقول "التقارير قبل هذا الوقت من نموذج آخر".
      await ref.collection(HISTORY_SUBCOLLECTION).add({
        from: before.deepseekModel,
        fromSource: before.source,
        to: next,
        at,
        byUid: actor.uid,
        byEmail: actor.email,
      });

      // النسخة التي كتبت تُفرغ كاشها فوراً؛ النسخ الأخرى تلحق خلال
      // CACHE_TTL_MS. لا وسيلة لإبطال كاش نسخة أخرى في Cloud Functions.
      clearAiConfigCache();

      // V8 الدفعة ١ (الخصوصية): كان `by ${actor.email || actor.uid}` — بريد المشرف
      // في السجلّ. الآن uid مُهشَّراً. (البريد يبقى في مستند السجلّ التاريخي أعلاه،
      // byEmail — تخزين لا سجلّ، لم يُمسّ.)
      console.log(`[aiConfig] model ${before.deepseekModel} → ${next} ` +
          `by ${hashIdForLog(actor.uid)}`);

      return {
        changed: true,
        from: before.deepseekModel,
        current: next,
        propagationMs: CACHE_TTL_MS,
      };
    },
);

module.exports = {getAiConfig, setAiModel, PRICING_DOC_URL,
  HISTORY_SUBCOLLECTION};
