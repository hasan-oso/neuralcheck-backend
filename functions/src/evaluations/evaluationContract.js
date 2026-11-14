// ===================================================
// evaluationContract — مفردات عقد التقييم + المشتقّات الخادمية
// ===================================================
// مشترك بين submitEvaluation (الكتابة) و resolvePendingEvaluation (الحساب
// المتأخّر). وُضع في وحدة واحدة كي لا تتفرّع المفردات أو منطق الاشتقاق بين
// المسارين — أي تعديل على سلّم الدرجات يجب أن يراه الاثنان في اللحظة نفسها.

const {V7_PIPELINE_TAG} = require("../analysis/pipelineTags");

// ─── درجات الفنّي ───────────────────────────────────────────────────
// المسار القديم (لوحة /tech المنشورة) يرسل الحرف مباشرةً.
const VALID_TECHNICIAN_GRADES = ["A", "B", "C", "D"];
const GRADE_INDEX = {A: 0, B: 1, C: 2, D: 3};

// المسار الجديد (التطبيق) يرسل مقياساً لفظياً — الفنّي في المحل يحكم بالكلام
// لا بالحروف. يُخزَّن حرفياً ويُشتقّ منه الحرف للحساب فقط.
const VALID_GRADES_RAW = ["excellent", "good", "fair", "weak"];
const RAW_TO_GRADE = {
  excellent: "A",
  good: "B",
  fair: "C",
  weak: "D",
};

const VALID_AGREEMENTS = ["agree", "app_lenient", "app_harsh"];
const VALID_ERROR_MAGNITUDES = ["minor", "moderate", "severe"];

// فئات العمق لـ disputedCategories (المسار القديم). display/camera/wireless
// مستبعدة عمداً: المشتري يفحصها بنفسه فخلاف الفنّي عليها ضوضاء لا إشارة.
const DEPTH_CATEGORIES = [
  "battery", "thermal", "cpu", "gpu", "memory",
  "storage", "security", "sensors", "gps", "cellular",
];

// ─── تقييمات الفئات (المسار الجديد) ────────────────────────────────
// أربع فئات فقط — ما يستطيع الفنّي الحكم عليه فعلاً في دقيقة داخل المحل.
// ملاحظة على الأسماء: `cpu_performance` لا `cpu` لأن الفنّي يحكم على الأداء
// المحسوس لا على السيليكون، والتمييز يمنع خلطها بـ disputedCategories.cpu.
const RATING_CATEGORIES = ["battery", "cpu_performance", "memory", "storage"];

// `not_tested` قيمة صريحة تعني "أجاب: لم أفحصها" — وهي ليست غياب المفتاح.
// غياب المفتاح = "لم يُسأل / لم يُجب". الفرق جوهري لبيانات التدريب: الأولى
// شهادة سلبية، والثانية لا شهادة إطلاقاً.
const VALID_RATINGS = ["excellent", "good", "fair", "weak", "not_tested"];

// ─── العيوب الظاهرة ────────────────────────────────────────────────
// مفردات مغلقة. `none_noticed` شهادة إيجابية صريحة ("نظرت ولم أجد") وتختلف
// عن مصفوفة فارغة ("لم يُسأل") — نفس منطق not_tested أعلاه.
const VALID_VISIBLE_DEFECTS = [
  "weak_battery", "replaced_screen", "water_damage", "prior_repair",
  "none_noticed",
];

const MAX_TECHNICIAN_NAME_LEN = 120;

// ─── حقول الربط بالقراءات الخام ────────────────────────────────────
// هذه الأربعة وحدها تصل التسمية بملف السلسلة الزمنية في Cloud Storage.
// بدونها التقييم حكمٌ معلّق في الهواء: لا يمكن استرجاع القراءات التي بُني
// عليها، فلا قيمة له في التدريب مهما كان حكم الفنّي دقيقاً.
//
// أُضيفت إلى مستند التقرير في e45237e. أي تقرير كتبته نسخة أقدم من
// analyzeDevice لا يحملها — وهو ما وقع فعلاً: ظلّت الدالة غير منشورة بعد
// الالتزام، فجاء أول تقييم حقيقي بربط فارغ ولم يُكتشف إلا بالمصادفة. الراية
// أدناه تجعل هذه الحالة مرئيّة في أول تقييم بدل أن تمرّ صامتة.
const LINKAGE_FIELDS = [
  "timeSeriesStoragePath",
  "deviceFingerprintSha",
  "fieldsVersion",
  "appVersion",
];

// V8 نقل الخامّ (2026-10-09، قرار المستخدم ٦: «لا نسخ للمعرّفات في evaluations،
// والربط في جانب الخادم»): الأوّلان من LINKAGE_FIELDS (مسار السلسلة في Storage
// وبصمة الجهاز) صارا في reportRaw/{scanId} لا في مستند التقرير المقروء، **ولا
// يُنسخان إلى evaluations** (يقرؤها المالك من العميل). فاكتمال الربط يُحسَب هنا
// من حالة الخامّ (readReportRaw: PRIVATE | EMBEDDED_LEGACY | ABSENT) لا من لقطة
// تحملهما؛ والربط الفعلي بمعرّف الفحص نفسه: evaluations/{scanId} ↔ reportRaw/{scanId}
// (علاقة 1:1) — يجري في جانب الخادم وحده. الأخيران (fieldsVersion/appVersion)
// يبقيان على المستند المقروء وفي اللقطة (ليسا معرّفين).
const RAW_LINKAGE_FIELDS = ["timeSeriesStoragePath", "deviceFingerprintSha"];

/**
 * يحوّل درجة إلى رتبة عددية. يقبل +/- (B+ → B) ليعمل على درجات التطبيق.
 * @param {*} grade الدرجة الخام
 * @return {number|null} 0..3 أو null إن تعذّر التحويل
 */
function gradeToIndex(grade) {
  if (typeof grade !== "string") return null;
  const letter = grade.trim().charAt(0).toUpperCase();
  return Object.prototype.hasOwnProperty.call(GRADE_INDEX, letter) ?
      GRADE_INDEX[letter] :
      null;
}

/**
 * يبني لقطة التقرير — كل ما يصف حالة التقرير لحظة التقييم.
 * لقطات لا مراجع: لو أُعيد تحليل نفس scanId لاحقاً وتغيّر التقرير، تبقى
 * التسمية صحيحة كما كانت وقت حكم الفنّي.
 * V8 نقل الخامّ: **لا معرّفات في اللقطة** (لا timeSeriesStoragePath ولا deviceFingerprintSha) —
 * القرار ٦. androidVersion/apiLevel تُقرأ من الخامّ (rawRead) لأنها ليست معرّفات.
 * @param {Object|null} report وثيقة reports/{scanId} أو null إن لم توجد بعد
 * @param {{state: string, raw: ?Object}} [rawRead] ناتج readReportRaw للتقرير — **مطلوب** مع تقرير
 *   موجود (القاعدة 22: لا يُقرأ غياب الخامّ بصمت؛ ABSENT حالة تُمرَّر صراحةً).
 * @return {Object} حقول اللقطة، كلها null عند غياب التقرير
 */
function buildReportSnapshot(report, rawRead) {
  if (report && (!rawRead || typeof rawRead.state !== "string")) {
    throw new Error("buildReportSnapshot: rawRead (ناتج readReportRaw) مطلوب مع تقرير موجود");
  }
  if (!report) {
    return {
      deviceModel: null,
      androidVersion: null,
      apiLevel: null,
      fieldsVersion: null,
      appVersion: null,
      aiModel: null,
      pipeline: null,
      appGrade: null,
      appScore: null,
      appCategoryScores: null,
    };
  }

  const rawFp = (rawRead.raw && rawRead.raw.rawFingerprint) || {};
  const rawDevice = rawFp.device || {};
  const rawHeader = (rawFp.timeSeries && rawFp.timeSeries.header) || {};
  const ai = report.aiResponse || {};

  return {
    deviceModel: report.deviceModel ||
        (typeof rawDevice.model === "string" ? rawDevice.model : null) || null,
    androidVersion:
        (rawDevice.androidVersion !== undefined && rawDevice.androidVersion !== null) ?
            rawDevice.androidVersion : null,
    apiLevel: (typeof rawDevice.apiLevel === "number") ? rawDevice.apiLevel :
        ((typeof rawHeader.androidApiLevel === "number") ?
            rawHeader.androidApiLevel : null),
    fieldsVersion: report.fieldsVersion ?? null,
    appVersion: report.appVersion ?? null,
    aiModel: report.aiModel ?? null,
    pipeline: report.pipeline ?? null,
    // أمر مستخدم 2026-09-23 +03 (أمر التبديل، بعد A125): "الخادم مع
    // التبديل بتفرّع على pipeline... ودرجات الفئات على null مؤقّتاً —
    // ومقارنة حرف الفئة بند مستقلّ يُرفع ولا يُبنى الآن." على V7:
    // appGrade من overall.letter الحتمي (grade/report.grade V6 لا وجود
    // لهما)، appScore=null صريحة (لا مكافئ رقمي)، appCategoryScores=null
    // صريحة (لا category_scores في V7 — مقارنة حرف الفئة تحتاج تصميماً
    // منفصلاً، بند مستقلّ لم يُبنَ هنا عمداً). على V6: بلا أي تغيير.
    appGrade: (report.pipeline === V7_PIPELINE_TAG) ?
        ((ai.overall && typeof ai.overall.letter === "string") ? ai.overall.letter : null) :
        ((typeof report.grade === "string" && report.grade) ?
            report.grade :
            ((typeof ai.grade === "string" && ai.grade) ? ai.grade : null)),
    appScore: (report.pipeline === V7_PIPELINE_TAG) ?
        null :
        ((typeof report.score === "number") ?
            report.score :
            ((typeof ai.score === "number") ? ai.score : null)),
    appCategoryScores: (report.pipeline === V7_PIPELINE_TAG) ?
        null :
        (ai.category_scores ?? null),
  };
}

/**
 * المشتقّات الخادمية: المسافة بين درجة التطبيق ودرجة الفنّي، وراية التناقض.
 *
 * gradeDistance = رتبة الفنّي − رتبة التطبيق (A=0 … D=3):
 *   موجب → التطبيق أعطى درجة أفضل من الفنّي = التطبيق متسامح
 *   سالب → التطبيق أعطى درجة أسوأ = التطبيق قاسٍ
 *   صفر  → تطابق
 * تُحسب خادمياً دائماً ولا تُقبل من العميل. تبقى null إن غابت أي من
 * الدرجتين — لا يُختلق رقم.
 *
 * consistencyFlag ترصد تناقض تصريح الفنّي (agreement) مع المسافة المحسوبة.
 * رصد لا منع: الرفض يُفقدنا الحالة الأهم (فنّي مرتبك أو واجهة مضلّلة).
 * تبقى false إن غاب agreement — والتطبيق لا يرسله إطلاقاً.
 *
 * @param {string|null} appGrade درجة التطبيق (قد تحمل +/-)
 * @param {string|null} technicianGrade حرف درجة الفنّي
 * @param {string|null} agreement تصريح الفنّي أو null
 * @return {{gradeDistance: number|null, consistencyFlag: boolean}}
 */
function computeDerived(appGrade, technicianGrade, agreement) {
  const appIndex = gradeToIndex(appGrade);
  const techIndex = gradeToIndex(technicianGrade);

  const gradeDistance = (appIndex === null || techIndex === null) ?
      null :
      (techIndex - appIndex);

  let consistencyFlag = false;
  if (gradeDistance !== null && agreement) {
    const expected = gradeDistance === 0 ? "agree" :
        (gradeDistance > 0 ? "app_lenient" : "app_harsh");
    consistencyFlag = (expected !== agreement);
  }

  return {gradeDistance, consistencyFlag};
}

/**
 * يفحص اكتمال ربط التسمية بالقراءات الخام.
 *
 * تُستدعى من المسارين (submitEvaluation و resolvePendingEvaluation) بنفس
 * اللقطة، فلا يتفرّع تعريف "مكتمل" بينهما.
 *
 * ثلاثية الحالة مقصودة: ما دام التقييم معلّقاً (لا تقرير بعد) فاللقطة فارغة
 * بالتصميم لا بالخلل، فتكون الراية null = "لم يُحسم بعد". الحسم يقع عند
 * الاستكمال. هذا يمنع إنذاراً كاذباً على كل تقييم يصل من التطبيق.
 *
 * V8 نقل الخامّ: الحقلان المعرِّفان (RAW_LINKAGE_FIELDS) يُفحصان في الخامّ (rawRead.raw)، والآخران في
 * اللقطة. **حالة الخامّ تُعاد دائماً** (linkageRawState) فيراها السجلّ والمستند: ABSENT (لا reportRaw ولا حقول
 * مضمَّنة) ≠ PRIVATE بمسار فارغ (ترويسة بلا بصمة) ≠ EMBEDDED_LEGACY (تقرير ما قبل الترحيل).
 * @param {Object} snapshot مخرج buildReportSnapshot
 * @param {boolean} pending هل التقييم ما زال بانتظار تقريره؟
 * @param {{state: string, raw: ?Object}} [rawRead] ناتج readReportRaw — مطلوب حين pending=false
 * @return {{linkageIncomplete: boolean|null, missingLinkageFields: string[], linkageRawState: string|null}}
 */
function linkageStatus(snapshot, pending, rawRead) {
  if (pending) {
    return {linkageIncomplete: null, missingLinkageFields: [], linkageRawState: null};
  }
  if (!rawRead || typeof rawRead.state !== "string") {
    throw new Error("linkageStatus: rawRead (ناتج readReportRaw) مطلوب حين لا يكون التقييم معلّقاً");
  }
  const raw = rawRead.raw || {};
  const absent = (v) => v === null || v === undefined;
  const missing = LINKAGE_FIELDS.filter((f) =>
    (RAW_LINKAGE_FIELDS.includes(f) ? absent(raw[f]) : absent(snapshot[f])));
  return {
    linkageIncomplete: missing.length > 0,
    missingLinkageFields: missing,
    linkageRawState: rawRead.state,
  };
}

module.exports = {
  LINKAGE_FIELDS,
  RAW_LINKAGE_FIELDS,
  linkageStatus,
  VALID_TECHNICIAN_GRADES,
  GRADE_INDEX,
  VALID_GRADES_RAW,
  RAW_TO_GRADE,
  VALID_AGREEMENTS,
  VALID_ERROR_MAGNITUDES,
  DEPTH_CATEGORIES,
  RATING_CATEGORIES,
  VALID_RATINGS,
  VALID_VISIBLE_DEFECTS,
  MAX_TECHNICIAN_NAME_LEN,
  gradeToIndex,
  buildReportSnapshot,
  computeDerived,
};
