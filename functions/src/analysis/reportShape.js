// ===================================================
// reportShape — الشكل المتوقَّع لمخرَج النموذج، لكل المزوّدين
// ===================================================
//
// هذه الوحدة وُلدت من ثغرة سبّبها التكرار نفسه.
//
// كان مسار التحليل/الإصلاح مكتوباً مرّتين: مرّة في callDeepSeek ومرّة في
// callGemini، متطابقين حرفاً بحرف. فلمّا حُرس أحدهما بقي الآخر مكشوفاً —
// والمكشوف هو الذي كان يُطلق أكثر: من ستّ حوادث إصلاح في ثلاثين يوماً،
// أربع مرّت عبر Gemini واثنتان عبر DeepSeek. أي أن الإصلاح في مكان واحد
// كان سيغطّي ثلث المشكلة ويترك ثلثيها.
//
// فالمنطق هنا وحده، ويستهلكه المزوّدان. كلٌّ يلفّه بنوع خطئه وسابقة سجلّه،
// أمّا القرار — ما التقرير؟ وما الناقص فيه؟ — فواحد لا يتفرّع.

// ─── الحدّ الأدنى: هل هذه القيمة تقرير أصلاً؟ ────────────────────────
//
// مفتاح واحد على الأقل ممّا يقرأه المستهلك فعلاً. الأسماء مزدوجة لأن
// V5/V6 تُصدر grade/score بينما V3 تُصدر overallGrade/overallScore، وقصر
// الفحص على صيغة واحدة يرفض تقريراً صالحاً من المسار الآخر.
const REPORT_SHAPE_KEYS = [
  "grade", "overallGrade",
  "score", "overallScore",
  "summary",
  "category_scores", "categoryScores",
];

// ─── المفاتيح الجوهرية: هل التقرير كامل؟ ─────────────────────────────
//
// مستخرَجة من الاستجابات السليمة المرصودة في الإنتاج، وكلّها تحمل المفاتيح
// السبعة عشر نفسها منتهيةً بـ performanceContext ثم changeAnalysis. أمّا
// الاستجابات المبتورة التي أنقذها jsonrepair فتتوقّف عند details أو verdict
// أو categoryScores — تصل بدرجة وملخّص سليمين فتبدو طبيعية تماماً، وقد
// فقدت الأعطال ودرجات الفئات ونصائح الشراء.
//
// ما استُبعد عمداً، ولماذا:
//   • reasoning_trace — داخلي لا يراه المستخدم.
//   • grade / score   — مغطّيان بـ aiGradeMissing و aiScoreMissing.
//   • shortId, deviceMarketingName, aiModel, isFreeTrial — الخادم يكتبها
//     فوق ما يُرسله النموذج، فغيابها لا يُنقص التقرير.
//   • rootCause و changeAnalysis — المخطّط يسمح لهما بـ null صراحةً، وهو
//     ما يُغري النموذج بإسقاطهما أصلاً. إدراجهما يرفع الراية على حالات
//     سليمة ويُفقدها قيمتها.
//
// كل مجموعة اسم واحد بصيغتيه؛ الأول هو الاسم القانوني الذي يُذكر في الراية.
const CORE_KEY_GROUPS = [
  ["summary"],
  ["details"],
  ["verdict"],
  ["issues"],
  ["predictedProblems", "predicted_problems"],
  ["categoryScores", "category_scores"],
  ["buyerAdvice", "buyer_advice"],
  ["performanceContext", "performance_context"],
];

// كم اسم مفتاح يُطبع في وصف الشكل. ستة تكفي للتعرّف دون إغراق السجلّ.
const SHAPE_KEY_SAMPLE = 6;

/**
 * هل يملك الكائن هذا المفتاح؟ الفحص بالوجود لا بالقيمة: وجود المفتاح هو
 * الدليل على أن النموذج أصدره، ولو كانت قيمته null.
 * @param {*} v الكائن
 * @param {string} k المفتاح
 * @return {boolean} النتيجة
 */
function has(v, k) {
  return Object.prototype.hasOwnProperty.call(v, k);
}

/**
 * هل تبدو القيمة تقريراً؟ كائن غير مصفوفة يحمل مفتاحاً متوقَّعاً واحداً على
 * الأقل.
 *
 * الشكل مُعامِل لا ثابت مُغلَق عليه (أمر مستخدم 2026-09-23 +03، القرار ١:
 * "إضافة narrative إلى القائمة القائمة تجعل مسار V6 يقبل ردّاً بشكل V7").
 * REPORT_SHAPE_KEYS الافتراضي يبقى شكل V3/V5/V6 بلا أي تغيير — استدعاء
 * قديم بلا الوسيط الثاني يسلك نفس السلوك حرفياً.
 *
 * @param {*} v القيمة
 * @param {string[]} [shapeKeys] مفاتيح القبول — افتراضياً REPORT_SHAPE_KEYS
 * @return {boolean} صحيح إن كانت تقريراً محتملاً
 */
function looksLikeReport(v, shapeKeys = REPORT_SHAPE_KEYS) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return shapeKeys.some((k) => has(v, k));
}

/**
 * أسماء المفاتيح المتوقَّعة الموجودة فعلاً — لتبرير الاستخلاص في السجلّ.
 * @param {Object} v الكائن
 * @param {string[]} [shapeKeys] مفاتيح القبول — افتراضياً REPORT_SHAPE_KEYS
 * @return {string} الأسماء مفصولة بفواصل
 */
function matchedKeys(v, shapeKeys = REPORT_SHAPE_KEYS) {
  return shapeKeys.filter((k) => has(v, k)).join(",");
}

/**
 * وصف مختصر لعنصر داخل مصفوفة.
 * @param {*} el العنصر
 * @return {string} الوصف
 */
function briefKind(el) {
  if (el === null) return "null";
  if (Array.isArray(el)) return `array(${el.length})`;
  if (typeof el !== "object") return typeof el;
  const keys = Object.keys(el);
  return `object{${keys.slice(0, 3).join(",")}` +
      `${keys.length > 3 ? ",…" : ""}}`;
}

/**
 * وصف شكل القيمة للسجلّ: النوع، وعدد المفاتيح، وأوائل أسمائها.
 *
 * هذا هو ما أنهى العمى: "repair succeeded" وحدها أخفت الحادثة تماماً.
 * الشكل الحقيقي لو طُبع لقرأ:
 *   type=array len=3 [0]=object{reasoning_trace,grade,score,…}
 *   [1]=string [2]=string
 * وهو يروي القصّة كاملةً في سطر واحد.
 *
 * @param {*} v القيمة
 * @return {string} الوصف
 */
function describeShape(v) {
  if (v === null) return "type=null";
  if (Array.isArray(v)) {
    return `type=array len=${v.length} ` +
        v.map((el, i) => `[${i}]=${briefKind(el)}`).join(" ");
  }
  if (typeof v !== "object") return `type=${typeof v}`;
  const keys = Object.keys(v);
  return `type=object keyCount=${keys.length} ` +
      `keys=${keys.slice(0, SHAPE_KEY_SAMPLE).join(",")}` +
      `${keys.length > SHAPE_KEY_SAMPLE ? ",…" : ""}`;
}

/**
 * يستخرج التقرير من ناتج التحليل أو الإصلاح.
 *
 * jsonrepair لا يفشل حين يجد بنية غير صالحة — يخمّن. وحين تصله قيم عليا
 * متعدّدة مفصولة بفاصلة يلفّها في مصفوفة، فيعود التقرير كاملاً سليماً لكن
 * تحت parsed[0] بدل parsed، فتصير كل قراءة لاحقة undefined.
 *
 * يُعيد نتيجة موصوفة لا يرمي: نوع الخطأ وسابقة السجلّ يخصّان المزوّد،
 * فيقرّرهما المستدعي. القرار وحده هو المشترك.
 *
 * الشكل مُعامِل — انظر تعليق looksLikeReport أعلاه لخلفية القرار.
 *
 * @param {*} parsed الناتج
 * @param {string[]} [shapeKeys] مفاتيح القبول — افتراضياً REPORT_SHAPE_KEYS
 * @return {{ok: boolean, report: ?Object, extractedFrom: ?number,
 *   discarded: number, matched: string, shape: string}} النتيجة
 */
function resolveReport(parsed, shapeKeys = REPORT_SHAPE_KEYS) {
  const shape = describeShape(parsed);

  if (Array.isArray(parsed)) {
    const idx = parsed.findIndex((el) => looksLikeReport(el, shapeKeys));
    if (idx < 0) {
      return {ok: false, report: null, extractedFrom: null,
        discarded: 0, matched: "", shape};
    }
    return {ok: true, report: parsed[idx], extractedFrom: idx,
      discarded: parsed.length - 1, matched: matchedKeys(parsed[idx], shapeKeys),
      shape};
  }

  if (!looksLikeReport(parsed, shapeKeys)) {
    return {ok: false, report: null, extractedFrom: null,
      discarded: 0, matched: "", shape};
  }

  return {ok: true, report: parsed, extractedFrom: null,
    discarded: 0, matched: matchedKeys(parsed, shapeKeys), shape};
}

/**
 * أي المفاتيح الجوهرية غابت عن التقرير.
 *
 * الغياب هنا غياب المفتاح نفسه لا خلوّ قيمته: مصفوفة أعطال فارغة جواب
 * مشروع ("لا أعطال")، أمّا اختفاء issues فيعني أن النصّ انقطع قبلها.
 *
 * الشكل مُعامِل — انظر تعليق looksLikeReport أعلاه لخلفية القرار.
 *
 * @param {Object} report التقرير
 * @param {string[][]} [coreKeyGroups] مجموعات المفاتيح الجوهرية —
 *   افتراضياً CORE_KEY_GROUPS
 * @return {string[]} الأسماء القانونية للمفاتيح الغائبة
 */
function missingCoreKeys(report, coreKeyGroups = CORE_KEY_GROUPS) {
  if (!report || typeof report !== "object") {
    return coreKeyGroups.map((g) => g[0]);
  }
  return coreKeyGroups
      .filter((group) => !group.some((k) => has(report, k)))
      .map((group) => group[0]);
}

module.exports = {
  REPORT_SHAPE_KEYS,
  CORE_KEY_GROUPS,
  looksLikeReport,
  matchedKeys,
  describeShape,
  resolveReport,
  missingCoreKeys,
};
