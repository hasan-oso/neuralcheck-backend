// ===================================================
// categoryStates.js — حالات الفئات والدرجة العامة بالبوّابات (P1.3،
// PLAN-01-ROADMAP.md §المرحلة ١، P1.3 + تعديل 2026-09-20)
// ===================================================
// يستهلك testKinds.toTestResult() + batteryLayer.computeBatteryLayer()
// لبناء، لكل فئة من الخمس عشرة: coverage(c)، score(c) (على المقيس فقط)،
// state ∈ {MEASURED, PARTIAL, ATTESTED_ONLY, UNMEASURED}، deterministicLetter،
// ثم overall على MEASURED فقط بأوزان معلَنة، وgatesApplied[].
//
// ⚠️ **تحديث P1.4**: مُستهلَكة الآن فعلياً من runAnalysisInternal.js
// (البند "الوصل" — راجع runAnalysisInternal.js حول Findings) ومن
// buildV7Payload.js (حمولة callAIv7). التعليق أعلاه كان يصف حالة P1.3
// المؤقّتة قبل الوصل — أُبقي مقتبَساً هناك للسياق التاريخي فقط، لا هنا.
//
// ─── قرارات تصميم غير منصوصة حرفياً في PLAN-01 — مذكورة هنا وفي تقرير
//     المهمّة تحت "افتراضات" (القاعدة 13) ────────────────────────────────
//
// (1) score(c) للفئات غير البطارية: نسبة النجاح على الاختبارات المنفَّذة
//     الحاملة للصحّة (pass_count/executed×100)، ثم قاعدة ثنائية إضافية:
//     أي FAIL على اختبار kind=STATE يفرض الحرف D مباشرة (حقيقة امتثال
//     ثنائية — لا "متوسّط" لجهاز نصفه مُخترَق)؛ أي WARNING على STATE يفرض
//     سقف C إن لم يوجد FAIL. هذا تفسيري لنصّ "الخصم من مخرجات FAIL/DEGRADED
//     لا من وسم شدّة يكتبه النموذج" — إذ لا معادلة رقمية بديلة منصوصة.
//     مطابقتُه العملية الوحيدة المتاحة للتحقّق: security على S10 الحقيقي
//     (SEC-04 fail) تُنتج D، مطابقةً لِما ورد في PLAN-01 (راجع
//     categoryStates.test.js وتقرير المهمّة).
// (2) البطارية فئة خاصّة: حرفها (إن وُجد) من طبقة ٤-ج (batteryLayer.js)
//     لا من B-01..B-08 (هذه الأخيرة حقائق حالة/مواصفة، لا قياس صحّة
//     تراكمي). طالما لا عتبة مُعايَرة (batteryLayer.js) فحالتها اليوم
//     UNMEASURED فعلياً على أي فحص حقيقي متاح — موثَّق لا مُخترَع.
// (3) coverage(c) = executed/declared على الاختبارات الحاملة للصحّة
//     (kind ≠ SPEC، unstable=false) فقط.
// (4) overallCoverage تُحسَب من كل الفئات الـ13 الموزونة (لا 15 — audio/
//     input وزنهما صفر فلا تُغيّر الناتج، لكنها مُدرَجة رياضياً بلا أثر)؛
//     overall.measuredCategoriesMean (اسمها حتى 2026-09-21: score — أُعيدت
//     التسمية بقرار مستخدم أثناء هذه المهمّة: "score يوحي بالدرجة العامة
//     وهو ليس كذلك — إنه متوسّط الفئات المقيسة وحدها") على الفئات MEASURED
//     فقط، بأوزانها الأصلية مُعاد تطبيعها على مجموع أوزان تلك الفئات وحدها.
// ===================================================

'use strict';

const crypto = require('crypto');
const {CATEGORIES, normalizeCategory, manualCategoryFor, CATEGORY_NAME_AR} = require('../utils/categories');
const {letterFromScore} = require('./rebuildCategoryScores');
const {toTestResult, isHealthBearing, kindOf, KIND, CYCLE_COUNT_TEST_ID, NOT_MEASURED_REASON} = require('./testKinds');
// الوسم الوحيد الذي يُسقِط B-08 (cycleCountClassification.js، قرار المستخدم 2026-10-13 +03) — مصدره fv68Names.js (القاعدة 24)، لا نسخة حرفية هنا.
const {CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34} = require('./fv68Names');
const {computeBatteryLayer} = require('./batteryLayer');
// بوّابة LOW_CATEGORY_COVERAGE (أمر المهمّة 2026-09-22 +03، البند ١) —
// العتبة تُصدَّر من findings.js (thresholdSet)، لا رقم عارٍ هنا. findings.js
// بلا أي require خاص به (تحقّقتُ) — لا خطر دائرية.
const {thresholdSet} = require('./findings');
// القرار ٤٤ (القاعدة 24 — انجراف A102 بصيغة رابعة): مصدر الحقيقة الوحيد
// لنصّ noLetterReason أدناه، مشترَك مع رمز buildV7Payload.js
// (CATEGORY_GRADING_LOCKED) — راجع categoryGradingLock.js لسبب الفصل بين
// الاثنين رغم كونهما حقيقة واحدة.
const {CATEGORY_GRADING_LOCKED_TEXT} = require('./categoryGradingLock');

const LETTER_ORDER = {A: 0, B: 1, C: 2, D: 3};
const LETTER_BY_RANK = ['A', 'B', 'C', 'D'];

// قائمة قيم category.state الخمس — مصدرها الحرفي فقط، لا وصف معانيها (ذلك
// أمر مستخدم 2026-09-23 +03، البند ٥: "من مصدرها في الكود أعني قائمة القيم
// نفسها... لا ترجمتها. النموذج يترجم بنفسه"). المواضع الحرفية الخمسة التي
// تُعيَّن منها هذه القيم في هذا الملف: :488 (UNMEASURED)، :489
// (ATTESTED_ONLY)، :490 (MEASURED)، :491 (PARTIAL)، :125 و:541 (UNMEASURED
// مكرّرة لفرع البطارية)، :559 (UNMEASURED)، :560 (PARTIAL)، :561
// (MEASURED)، و:125 (HARNESS_ERROR، فرع buildHarnessErrorCategoryStates).
// لا تُنسَخ هذه القائمة يدوياً في أي ملفّ آخر (القاعدة 24) — تُستورَد من
// هنا. systemPromptV7.js يستوردها لبناء جملة تنبيه النموذج (البند ٥).
const CATEGORY_STATE_VALUES = Object.freeze([
  'MEASURED', 'PARTIAL', 'UNMEASURED', 'ATTESTED_ONLY', 'HARNESS_ERROR',
]);

// محاور التطبيق §5.4–§5.5 مسطَّحة (PLAN-01 P1.3، حرفياً). الصوت والإدخال
// بلا وزن حتى يُقاسا.
const CATEGORY_WEIGHTS = Object.freeze({
  battery: 35, security: 15, cpu: 7.5, thermal: 7.5, storage: 6,
  gpu: 4.5, memory: 4.5, cellular: 5, camera: 5, wireless: 4,
  gps: 2, sensors: 2, display: 2, audio: 0, input: 0,
});

// ⚠️ تصحيح مُلزِم من المستخدم (رسالة أثناء التنفيذ، بعد صياغة PLAN-01
// الأصلية "overallCoverage < 0.6 → تقييم جزئي بلا حرف"): **تلك القاعدة
// مُلغاة**. الجديد: تغطية ≥ 0.6 → حرف عادي؛ تغطية < 0.6 → **حرف + وسم
// "تقييم جزئي — تغطية X%"** (الحرف يُحسب ويُعرض في الحالتين، لا حالة "بلا
// حرف" للدرجة العامة إطلاقاً؛ ملاحظة: هذا يخصّ الدرجة العامة فقط — حرف
// الفئة الواحدة يبقى ممنوعاً لحالتَي UNMEASURED/ATTESTED_ONLY كما هو).
// الوسم يحمل الرقم دائماً ويُحسَب من overallCoverage عند كل توليد — لا
// يُخزَّن رايةً ثابتة، فيختفي تلقائياً حين ترتفع التغطية بلا تغيير كود.
const OVERALL_COVERAGE_GATE = 0.6;
const BATTERY_MAX_BAND_DROP = 1; // P1.3: البطارية وحدها لا تُنزل أكثر من درجة واحدة
// S-2 (أمر مستخدم 2026-10-01 +03، ملحق S-2 بنصّه: "العتبة (categoryStates.js:357،
// months > 36) تصير ثابتاً مسمّى يقرؤه الشرط والنصّ معاً (القاعدة 24)") —
// يقرؤه شرط PATCH_AGE أدناه وbuildGoverningGateDisplayText (buildDisplayShapeV7.js)
// معاً — لا رقم حرفي 36 في أيّ منهما بعد الآن.
const PATCH_AGE_MAX_MONTHS = 36;

// أمر مستخدم 2026-10-07 +03 (البند ٤): عمر الرقعة بالأشهر يصل حمولة النموذج رقماً في حقل خاصّ ببوّابة PATCH_AGE «بالقيمة
// نفسها التي في نصّ مصدرها، من الحساب نفسه (القاعدة 24)» — «وما يُحسب ويُخزَّن لا يتغيّر: ... categoryStates».
// الحساب واحد (computeGates: months) وناتجه المخزَّن نصّ source فقط؛ فصيغة هذا النصّ وقراءته هنا في مكان واحد: computeGates
// تكتبه بـformatPatchAgeSource، وparsePatchAgeMonths تقرأ منه الرقم نفسه (منزلة عشرية واحدة كما في النصّ) — لا نسخة ثانية
// من معادلة العمر، ولا حقل جديد في categoryStates المخزَّنة (الناتج المخزَّن بايتاً ببايت كما كان: sha256 في تقرير الجولة).
function formatPatchAgeSource(rawValue, months) {
  return `SEC-03=${rawValue} (${months.toFixed(1)} شهراً)`;
}
const PATCH_AGE_SOURCE_MONTHS_RE = /\((-?\d+(?:\.\d+)?) شهراً\)$/;
/**
 * عمر الرقعة بالأشهر كما ورد في نصّ source لبوّابة PATCH_AGE — رقم فقط حين تحمله البوّابة فعلاً (FIRED/NOT_FIRED).
 * UNKNOWN (لا ساعة خادم) وINPUT_ABSENT (SEC-03 غائب/غير قابل للتحليل) وأيّ بوّابة أخرى: null — لا رقم حيث لا رقم (القاعدة 22).
 * @param {Object} gate عنصر gatesApplied
 * @return {number|null}
 */
function parsePatchAgeMonths(gate) {
  if (!gate || typeof gate !== 'object' || gate.name !== 'PATCH_AGE') return null;
  if (gate.status !== 'FIRED' && gate.status !== 'NOT_FIRED') return null;
  const m = (typeof gate.source === 'string') ? PATCH_AGE_SOURCE_MONTHS_RE.exec(gate.source) : null;
  return m ? Number(m[1]) : null;
}

// ملاحظتا البوّابة المخزَّنتان حين يكون الحرف أسوأ من حدّ البوّابة أصلاً — نصّان مخزَّنان **لا يتغيّران** (أمر 2026-10-07، البند ٣:
// «ولا يتغيّر نصّ الملاحظة المخزّن»)؛ ثابتان مُصدَّران كي تقرأهما نسخة النموذج (v7ModelPayloadWhitelist.js) بمصدر واحد.
const GATE_NOTE_CATEGORY_ALREADY_WORSE = 'الحرف الأساسي أسوأ من السقف أصلاً — لا أثر';
const GATE_NOTE_OVERALL_ALREADY_WORSE = 'الحرف العامّ أسوأ من السقف أصلاً — لا أثر';

function sha256(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

// ─── A97 — الغياب لا يُقرأ قياساً (القاعدة 22، PLAN-01-ROADMAP.md §١٣) ──
// ثلاثة مُلزِمة، مضافة في P1.4:
//   1. الدالّة ترفض أي مفتاح غير معروف بخطأ صريح.
//   2. غياب مُدخل حاكم → HARNESS_ERROR يظهر في overall — لا في
//      categories.<x>.reason وحده.
//   3. overall يميّز "لم يُقَس" (noDataAtAll — البيانات وصلت واكتمل الحساب
//      لكن صفر فئة MEASURED) عن "تعذّر التجهيز" (harnessError — المُدخل
//      الحاكم نفسه غاب قبل أن يبدأ أي حساب، كحالة e4b65a2f الحقيقية:
//      404 من Firestore، لا "Honor غير مقيس" — القرار ١٢).
//
// ─── كيف يُميَّز "تعذّر التجهيز" (بند 2/3) — قرار تصميم غير منصوص حرفياً،
//     يُذكر هنا وفي تقرير المهمّة تحت "افتراضات" (القاعدة 13) ────────────
// PLAN-01 لا يحدّد آلية تمييز. الاختيار هنا: `functionalResults === null`
// صراحةً (لا `undefined` ولا `[]`) هو إشارة "الجلب نفسه فشل" — يستعمل
// تمييز JS الطبيعي بين "لم يُطلَب/لم يُمرَّر" (undefined، السلوك الافتراضي
// القديم، يبقى كما كان: مصفوفة فارغة فعلية) و"طُلِب فعلاً وأعاد لا شيء
// لأن المستند غائب" (null، صريح من المستدعي). هذا يطابق حرفياً القرار ١٢:
// "functionalResults = null لأن المستند غير موجود (404)". لا راية منفصلة
// (مثل harnessError:true في params) لأن ذلك يفتح مفتاحاً جديداً يحتاج هو
// نفسه تبريراً في القائمة المسموحة أدناه بلا نصّ يُسنده.
const ALLOWED_PARAM_KEYS = Object.freeze([
  'functionalResults', 'manualResults', 'dev', 'findings',
  'batterySampleInputs', 'batteryDesignCapacityMah',
  // أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤): "حقل analyzedAt يحمل
  // وقت الخادم عند بدء الدالّة... ويُمرَّر إلى categoryStates." راجع
  // computeGates أدناه لاستهلاكه الفعلي الوحيد (بوّابة PATCH_AGE).
  'analyzedAtMs',
  // قرار المستخدم 2026-10-13 +03 (cycleCountClassification.js): تصنيف الخادم لدورات الشحن — الوسم الوحيد المقبول CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34، أو null/غائب = لا تصنيف
  // (السلوك القائم بلا تغيير). حين يحمل الوسم يُسقَط اختبار B-08 (CYCLE_COUNT_TEST_ID) من testResults، فلا يصل حمولة النموذج ولا مرجع حارس الأرقام ولا مرجع الأدلّة (فهارس testResults واحدة في كل
  // ما يقرؤها: لا فلتر على نسخة النموذج وحدها يُزيح فهارس الأصل). الخامّ يبقى في بصمة reportRaw كما شُحن. computeCategoryStates لا تشتقّ التصنيف بنفسها: يمرَّر من runAnalysisInternal.
  'cycleCountClassification',
]);

function validateParamKeys(p) {
  const unknown = Object.keys(p).filter((k) => !ALLOWED_PARAM_KEYS.includes(k));
  if (unknown.length) {
    throw new Error(
        `computeCategoryStates: مفتاح غير معروف [${unknown.join(', ')}] — ` +
        `القاعدة 22/A97 تمنع قراءة مُدخل لم يُوثَّق. المفاتيح المعروفة: ` +
        `${ALLOWED_PARAM_KEYS.join(', ')}`,
    );
  }
  // قيمة cycleCountClassification: الوسم المعروف أو null/undefined فقط — نصّ آخر يرمي صراحةً، لا يُقرأ «لا تصنيف» ولا «غير مدعوم» (القاعدة 22/25).
  const cc = p.cycleCountClassification;
  if (cc !== undefined && cc !== null && cc !== CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34) {
    throw new Error(
        `computeCategoryStates: cycleCountClassification قيمة غير معروفة (${typeof cc === 'string' ? JSON.stringify(cc.slice(0, 60)) : typeof cc}) — ` +
        `المقبول: الوسم المُصدَّر CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 أو null`,
    );
  }
}

// فئة واحدة في حالة HARNESS_ERROR — تُستعمَل للفئات الـ14 غير البطارية حين
// يتعذّر جلب functionalResults نفسه (البطارية مستقلّة عن functionalResults
// كلّياً — تُحسَب من العيّنات الخام دائماً، راجع computeBatteryCategory).
function harnessErrorCategoryEntry(category) {
  return {
    category, coverage: 0, state: 'HARNESS_ERROR',
    declaredCount: 0, executedCount: 0, passCount: 0, failCount: 0, warningCount: 0,
    score: null, deterministicLetter: null, gatesApplied: [],
    testIds: [], llmSuggestedLetter: null,
    // القرار ٤٢ البند ٢ (A62) — finalLetter حاضر دائماً منذ البناء (=
    // deterministicLetter هنا، أي null) كي لا يحتاج أي قارئ احتياط `??`.
    // applyV7Adjustments (buildV7Payload.js) لا تُعدِّله عملياً هنا أصلاً —
    // كل adjustments[] تُرفَض NO_BASE_LETTER قبل بلوغ هذه الفئة (state
    // HARNESS_ERROR لا UNMEASURED/ATTESTED_ONLY، deterministicLetter=null).
    finalLetter: null, adjustmentApplied: false, adjustmentEvidence: null, adjustmentReason: null,
    reason: 'HARNESS_ERROR',
    harnessErrorNote: 'functionalResults=null — تعذّر جلب نتائج الاختبارات ' +
        'الوظيفية لهذا الفحص (مثال حقيقي موثَّق: e4b65a2f، 404 من Firestore) — ' +
        'ليست حالة "غير مقيس"، بل "تعذّر التجهيز" (A97 #3).',
  };
}

// S3 (أمر مستخدم 2026-10-01 +03) — "الرموز الخامّة في حالة التعطّل
// (FUNCTIONAL_RESULTS_UNAVAILABLE و«(functionalResults=null)»): تُستبدل
// بجمل عربية." الرمز الأول overall.harnessErrorReason **يبقى** (تصنيف
// للّوحة/الأداة، القاعدة 24) — يُضاف بجواره حقل جديد harnessErrorMessage
// (جملة عربية). الرمز الثاني كان جزءاً من issues[0].title (أدناه) — يُحذف
// من العرض، لا بديل رمزي له (لا يوجد قارئ متحقَّق منه لذلك النصّ تحديداً
// خارج العرض البشري، بخلاف harnessErrorReason الذي V7ModelPayloadWhitelist
// وربما التطبيق يقرآنه مصنَّفاً).
//
// دالّة تعيينية لا سلسلة واحدة مباشرة: تحسّباً لقيمة مستقبلية غير
// FUNCTIONAL_RESULTS_UNAVAILABLE (القاعدة 22 — لا افتراض صامت لقيمة غير
// معروفة؛ اليوم قيمة واحدة فقط تصل هذا المسار فعلياً، مُتحقَّق بالقراءة).
//
// ⚠️ **تصحيح المنسّق 2026-10-01 +03 (ملحق S-13، بنصّه)**: نصّ W6 (الموقع)
// البديل حين يغيب harnessErrorMessage اعتُمد "تعذّر تجهيز نتائج الاختبارات
// لهذا الفحص، وهذا ليس حكماً على الجهاز." — وبقراءة المنسّق لكلمة
// "يطابق" في نصّ القرار، صار نصّ الخادم هنا **نفس النصّ حرفياً** (كان
// 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص.' بلا الجملة الثانية) ليطابق
// نصّ العميلين. هذه قراءة المنسّق للكلمة لا نصّ المستخدم الحرفي بعينها،
// مذكورة في تقرير المهمّة.
const HARNESS_ERROR_MESSAGE_AR = 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص، وهذا ليس حكماً على الجهاز.';
function harnessErrorDisplayMessage(reason) {
  if (reason === 'FUNCTIONAL_RESULTS_UNAVAILABLE') return HARNESS_ERROR_MESSAGE_AR;
  // قيمة غير معروفة — لا نصّاً مُخمَّناً (القاعدة 22)، رسالة عامّة صادقة
  // بدل تكرار نفس نصّ الحالة الوحيدة المعروفة لسبب مختلف قد لا ينطبق عليه.
  return reason ? 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص لسبب غير مُصنَّف.' : null;
}

// نقطة دخول منفصلة لحالة "تعذّر التجهيز" الكاملة (A97 #2: تظهر في overall
// لا في categories.<x>.reason وحده). البطارية استثناء وحيد — تُحسَب
// كالعادة من batterySampleInputs لأنها لا تعتمد على functionalResults.
function buildHarnessErrorCategoryStates(p) {
  const categories = {};
  for (const cat of CATEGORIES) {
    categories[cat] = cat === 'battery' ?
        computeBatteryCategory(p.batterySampleInputs, p.batteryDesignCapacityMah) :
        harnessErrorCategoryEntry(cat);
  }

  const issues = [{
    id: 'DISC-HARNESS_ERROR', category: null, severity: 'INFO',
    // S3: كانت "...لهذا الفحص (functionalResults=null)" — الرمز الخامّ بين
    // قوسين مُزال من العرض (لا بديل عربي للرمز نفسه؛ الجملة وحدها تكفي).
    title: 'تعذّر تجهيز نتائج الاختبارات الوظيفية لهذا الفحص.',
  }];

  const lettersHash = sha256(CATEGORIES.map((c) => `${c}:${categories[c].deterministicLetter || ''}`));
  const numbersHash = sha256(CATEGORIES.map((c) => `${c}:${categories[c].score === null ? '' : categories[c].score.toFixed(4)}`)
      .concat(['overall:']));
  const issueSetHash = sha256(issues.map((i) => i.id).sort());

  return {
    categories,
    overall: {
      // القرار ١٢: "لا يدخل أي إحصاء تغطية" — coverage هنا غائب دلالياً
      // (null)، لا 0% (0% يعني "قِيس ولم يُغطَّ شيء"؛ هذه حالة مختلفة:
      // لم يُقَس شيء لأن الجلب فشل قبل أن يبدأ القياس).
      coverage: null,
      measuredCategoriesMean: null,
      letter: null,
      // letterSource (قرار مستخدم إضافي أثناء هذه المهمّة): يجب أن يعكس
      // صراحةً لماذا letter=null هنا — "تعذّر تجهيز"، لا نطاق رقمي (BAND)
      // ولا "لا بيانات" (NO_DATA — ذلك مسار noDataAtAll المختلف تماماً،
      // حيث البيانات وصلت لكن صفر فئة MEASURED). لا يُترَك null صامتاً.
      letterSource: 'HARNESS_ERROR',
      noDataAtAll: false, // A97 #3: مسار "تعذّر تجهيز" منفصل عن "لم يُقَس"
      harnessError: true, // A97 #2: الغياب يظهر هنا، لا في categories.<x>.reason وحده
      harnessErrorReason: 'FUNCTIONAL_RESULTS_UNAVAILABLE',
      // S3 (أمر مستخدم 2026-10-01 +03) — حقل جديد، جملة عرض عربية جاهزة
      // بجوار الرمز الخامّ أعلاه (يبقى للّوحة/التصنيف). راجع تعليق
      // harnessErrorDisplayMessage أعلى هذه الدالّة.
      harnessErrorMessage: harnessErrorDisplayMessage('FUNCTIONAL_RESULTS_UNAVAILABLE'),
      partialAssessment: false,
      partialAssessmentTag: null,
      gatesApplied: [],
      partialBadLetterUngated: [],
      llmOverall: null,
      adjustments: [],
      disputed: false,
    },
    // functionalResults نفسها غائبة (null) — لا ثلاثيات آلية ممكنة (كل
    // الفئات غير البطارية HARNESS_ERROR أعلاه بصرف النظر عن manualResults).
    testResults: [],
    issues,
    issueSetHash, lettersHash, numbersHash,
    // gates: [] — حقل إضافي (additive، بنمط testResults في P1.4) يُتيح
    // applyV7Adjustments (buildV7Payload.js) إعادة اشتقاق overall بشكل
    // موحَّد بلا تفريع خاصّ. لا معنى لبوّابات هنا أصلاً (functionalResults
    // غائبة، computeGates لم تُستدعَ) — ومهما يكن فكل تعديل adjustments[]
    // سيُرفَض NO_BASE_LETTER في هذا الفرع (deterministicLetter=null في كل
    // فئة غير البطارية)، فلا أثر عملي لغياب بوّابات حقيقية هنا.
    gates: [],
  };
}

// ─── بوّابات مسمّاة (P1.3، PLAN-01 سطر "…ولِلعامّة gatesApplied[]…") ─────
// ⚠️ تصحيح المستخدم أثناء التنفيذ (عطب A63 بصيغة جديدة، فوق e599edf):
// البوّابات كانت مُطبَّقة على حرف الفئة فقط. لكن overall يُحسَب "على
// MEASURED فقط" — ففئة PARTIAL تحمل D وجذراً (security) تسقط من المتوسّط
// المرجَّح **بلا أثر**، وتبقى فئات A/100 وحدها في الحساب → درجة عامة A
// على جهاز مجذَّر. البوّابات المسمّاة هي **شبكة الأمان المنصوصة صراحة**
// لهذه الحالة بالذات ("ولِلعامّة gatesApplied[]") — تُطبَّق الآن على
// الحرف العامّ مباشرة، بصرف النظر عن حالة الفئة المصدر (MEASURED أو
// PARTIAL)، تماماً لأن الفئات الأخطر غالباً PARTIAL لا MEASURED.
//
// كل الأسماء الستّة المنصوصة تُعاد دائماً بحالة صريحة — لا حذف صامت
// (خمسة حتى 2026-09-23 +03 — أُضيفت INPUT_ABSENT، أمر مستخدم/القاعدة 22
// "وقعت في موضعها السادس هنا": "الغياب لا يُقرأ قياساً"، بند ب):
//   FIRED         الشرط تحقّق، السقف يُطبَّق.
//   NOT_FIRED     قُيِّمت ببيانات حاضرة، والشرط لم يتحقّق — لا غياب هنا.
//   INPUT_ABSENT  مُدخل البوّابة غائب أو غير قابل للقراءة — الفئة لم
//                 تُقَس، والبوّابة لم تُقيَّم أصلاً (لا "قِيست ولم
//                 تتحقّق"). راجع تعليق computeGates أدناه للتفصيل الكامل.
//   NOT_WIRED     لا اسم حقل مؤكَّد في هذا المستودع لهذا الاسم — لم تُخمَّن.
//   DISABLED      مُعطَّلة بنصّ الخطّة نفسها (SUSTAINED_CEILING قبل PLAN-03).
//
// ⚠️ **عطب مُصلَح هنا (أمر مستخدم 2026-09-23 +03)**: ROOT_DETECTED كانت
// تُعطي NOT_FIRED لكل حالة SEC-04 غير 'fail' — أي "قِست ولم يتحقّق
// الشرط" — بلا تمييز بين "قِست ونتيجتها سلبية فعلاً" (status='pass')
// و"لم تُقَس أصلاً/تعذّر قراءتها" (status غائبة/unavailable/not_tested/
// error/warning). البرومبت (systemPromptV7.js) كان يقول للنموذج حرفياً
// إن NOT_FIRED تعني "بيانات كافية" — فيصف أربع فئات لم يُنفَّذ فيها
// اختبار واحد بأنها "قِيست". **مُصلَح بتصنيف صريح للقيم الست الممكنة من
// TestStatus (تطبيق NeuralChek، منقول من تقرير — القاعدة 29، لم يُتحقَّق
// منه مباشرة من هذا المستودع): 'pass'|'fail'|'warning'|'unavailable'|
// 'not_tested'|'error'، بأحرف صغيرة (kotlin: status.name.lowercase()).**
//
// تصنيف SEC-04 (كشف الروت — اختبار ثنائي: SecurityTests.kt "if
// (rootDetected) FAIL else PASS"، منقول لا مُتحقَّق منه هنا):
//   'fail'                → FIRED (جذر مكتشَف فعلاً — القيمة الوحيدة المُثبِتة)
//   'pass'                → NOT_FIRED (قِيس، ولم يُكتشَف جذر)
//   'unavailable'/'not_tested'/'error' → INPUT_ABSENT (الاختبار وصل لكن
//     تعذّر تنفيذه/قراءته — القياس نفسه غائب، لا نتيجة سلبية)
//   'warning'  → ⚠️ **غير محسوم بدليل — قرار مُعلَن لا افتراض صامت**:
//     SecurityTests.kt (منقول) لا يُصدر WARNING لهذا الاختبار حالياً (لا
//     مسار كود يُنتجها) — فلا مثال حقيقي لمعناها هنا. اخترتُ INPUT_ABSENT
//     لا FIRED: القاعدة 22 تمنع قراءة قيمة غامضة كمقياس محدَّد الاتّجاه —
//     "warning" لا تُثبِت وجود جذر (FIRED) ولا غيابه (NOT_FIRED) بلا
//     تخمين معناها، فتبقى "لم تُقيَّم بثقة" أصدق وصف. راجع تقرير المهمّة.
//   نصّ آخر غير معروف كلّياً، أو `sec04` غائب من الأصل → INPUT_ABSENT.
function classifySec04RootDetected(sec04) {
  if (!sec04) return {status: 'INPUT_ABSENT', source: 'SEC-04 absent'};
  const raw = sec04.status;
  const s = String(raw == null ? '' : raw).toLowerCase();
  if (s === 'fail') return {status: 'FIRED', source: `SEC-04=${raw}`};
  if (s === 'pass') return {status: 'NOT_FIRED', source: `SEC-04=${raw}`};
  if (s === 'unavailable' || s === 'not_tested' || s === 'error') {
    return {status: 'INPUT_ABSENT', source: `SEC-04=${raw} (تعذّر التنفيذ/القراءة — لا قياس)`};
  }
  if (s === 'warning') {
    return {status: 'INPUT_ABSENT', source: `SEC-04=${raw} (قيمة غير مُصدَرة من هذا الاختبار حالياً — لا تُقرَأ اتّجاهاً، قرار مُعلَن)`};
  }
  return {status: 'INPUT_ABSENT', source: `SEC-04=${raw} (قيمة غير معروفة)`};
}

function computeGates({functionalByTestId, findings, byCategory, analyzedAtMs}) {
  const gates = [];

  const sec04 = functionalByTestId['SEC-04'];
  const sec04Classified = classifySec04RootDetected(sec04);
  gates.push({
    name: 'ROOT_DETECTED', category: 'security', ceilingLetter: 'C',
    status: sec04Classified.status, source: sec04Classified.source,
  });

  // ⚠️ PATCH_AGE لا تفحص .status إطلاقاً (لا اليوم ولا قبل هذا التعديل)
  // — منطقها مبنيّ كلّياً على قابلية rawValue للتحليل تاريخاً. **مُتحقَّق
  // بالقراءة والتشغيل (أمر مستخدم 2026-09-23 +03)**: rawValue="N/A" (كما
  // يصل فعلياً مع status="unavailable"، SecurityTests.kt، منقول) يفشل
  // `new Date("N/A").getTime()` (NaN) فيسقط في الفرع أدناه — يصل
  // INPUT_ABSENT فعلاً بصرف النظر عن status، لا حاجة لفحصه صراحةً هنا.
  // لم أُوسِّع هذه البوّابة لفحص status (لم يُطلَب، ونطاقها الحالي — تحليل
  // التاريخ وحده — يُغطّي حالة unavailable/N-A فعلاً كما هي).
  // ~~أمر مستخدم 2026-09-23 +03 (القرار 73، البند ٢) — طُلب تحويل Date.now()
  // أدناه إلى وقت خادم مخزون في المستند... توقّفت — لا حقل وقت خادم مخزون
  // معروف اللحظة يفي بالغرض~~ (القاعدة 8 — مُبقاة موسومة، لم تعد صحيحة).
  //
  // **حُلّت 2026-09-24 +03 (القرار ٧٥ البند ٤)**: `analyzedAt` حقل جديد
  // يحمل وقت الخادم عند بدء `analyzeDevice` (`Date.now()` داخل الدالّة
  // نفسها — قيمة خادم حقيقية معروفة فوراً، لا سِنتينل `serverTimestamp()`
  // يُحسَم لاحقاً)، يُمرَّر هنا صراحةً كـ`analyzedAtMs` (راجع
  // ALLOWED_PARAM_KEYS/computeCategoryStates أعلاه، وanalyzeDevice.js
  // لسلسلة النقل الكاملة من بداية الدالّة). **لا Date.now() هنا بعد
  // الآن** — ثلاث حالات صريحة، لا سقوط صامت لأيّ منها:
  //   • SEC-03 غير قابل للتحليل → INPUT_ABSENT (كما كانت، بلا تغيير).
  //   • SEC-03 صالح لكن analyzedAtMs غائب/غير رقمي (مُستدعٍ لم يُمرِّره
  //     بعد — معظم الاختبارات القائمة، أو مستند قديم بلا analyzedAt ولا
  //     وقت مخزون بديل صالح) → **UNKNOWN** — لا يُحسَب من Date.now() مهما
  //     كان الحال (نصّ الأمر: "فإن لم يوجد وقت مخزون، تُعلَن حالة PATCH_AGE
  //     «غير معروفة»"). `status !== 'FIRED'` فلا تأثير على أي سقف (نفس
  //     تصميم INPUT_ABSENT أعلاه، القاعدة السارية أصلاً — لا لمس applyCeilings).
  //   • كلاهما صالح → FIRED/NOT_FIRED من شهور فعلية محسوبة من analyzedAtMs.
  const sec03 = functionalByTestId['SEC-03'];
  const hasValidClock = typeof analyzedAtMs === 'number' && isFinite(analyzedAtMs);
  if (sec03 && sec03.rawValue && !isNaN(new Date(String(sec03.rawValue)).getTime())) {
    const patchDate = new Date(String(sec03.rawValue));
    if (!hasValidClock) {
      gates.push({
        name: 'PATCH_AGE', category: 'security', ceilingLetter: 'B',
        status: 'UNKNOWN',
        source: `SEC-03=${sec03.rawValue} لكن analyzedAt غير معروف — لا وقت خادم متاح لحساب عمر الرقعة`,
      });
    } else {
      const months = (analyzedAtMs - patchDate.getTime()) / (1000 * 60 * 60 * 24 * 30.4368);
      gates.push({
        name: 'PATCH_AGE', category: 'security', ceilingLetter: 'B',
        status: months > PATCH_AGE_MAX_MONTHS ? 'FIRED' : 'NOT_FIRED',
        source: formatPatchAgeSource(sec03.rawValue, months),
      });
    }
  } else {
    // كانت 'NOT_FIRED' — القاعدة 22 (أمر 2026-09-23 +03، البند ب): مُدخل
    // غائب/غير قابل للتحليل ليس "قِيس ولم يتحقّق الشرط"، بل "لم يُقيَّم".
    gates.push({name: 'PATCH_AGE', category: 'security', ceilingLetter: 'B', status: 'INPUT_ABSENT', source: 'SEC-03 absent/unparseable'});
  }

  // غير موصولتين — لا اسم حقل مؤكَّد لهما في هذا المستودع لهذين الاسمين
  // تحديداً. **مُعلَنتان صراحة هنا (لا حذف صامت)** بدل تخمين اسم حقل
  // (تصحيح المستخدم، بند 3: "لا تتركهما صامتتين").
  gates.push({name: 'STORAGE_VERIFY_ERRORS', category: 'storage', ceilingLetter: 'D', status: 'NOT_WIRED', source: 'لا اسم حقل مؤكَّد في هذا المستودع'});
  gates.push({name: 'GPU_HASH_MISMATCH', category: 'gpu', ceilingLetter: 'D', status: 'NOT_WIRED', source: 'لا اسم حقل مؤكَّد في هذا المستودع'});
  // مُعطَّلة بنصّ الخطّة نفسها — "عتبة مبدئية لا تُفعَّل قبل PLAN-03".
  gates.push({name: 'SUSTAINED_CEILING', category: 'cpu', ceilingLetter: 'C', status: 'DISABLED', source: 'ممنوعة قبل PLAN-03 بنصّ الخطّة'});

  // ─── LOW_CATEGORY_COVERAGE — بوّابة سادسة، أمر المهمّة 2026-09-22 +03
  // البند ١: "حجّة التغطية ليست صنفاً من الاستدلال يحتاج إذن النموذج — هي
  // حساب نملكه". واحدة لكل فئة غير البطارية (البطارية طبقة مختلفة كلّياً
  // — لا testIds/kind بنفس المعنى، راجع computeBatteryCategory). حساب
  // عددي بحت على coverage/kind من computeHealthBearingStats. ~~**لا
  // توسيع مفردات إثبات** (FIRED/NOT_FIRED تبقى كما هي، لا قيمة رابعة)~~ —
  // لم يعد دقيقاً: أمر مستخدم 2026-09-23 +03 أضاف INPUT_ABSENT (خامسة لا
  // رابعة) تحديداً لفرع `executed.length === 0` أدناه — راجع تعليق ذلك
  // الفرع في computeLowCategoryCoverageGate. مُبقاة موسومة لا محذوفة
  // (القاعدة 8).
  if (byCategory) {
    const coverageThreshold = thresholdSet.lowCategoryCoverageFraction.value;
    for (const cat of CATEGORIES) {
      if (cat === 'battery') continue;
      const stats = computeHealthBearingStats(byCategory[cat] || []);
      gates.push(computeLowCategoryCoverageGate(cat, stats.executed, stats.coverage, coverageThreshold));
    }
  }

  return gates;
}

// يُطبَّق على حرف فئة واحدة. يعرض **كل** بوّابة موسومة لهذه الفئة بحالتها
// (FIRED/NOT_FIRED/INPUT_ABSENT/NOT_WIRED/DISABLED — خمسة منذ 2026-09-23
// +03، كانت أربعة) — لا حذف صامت هنا أيضاً (بند 3، بالتناظر مع
// applyOverallCeilings) — لكن السقف الفعلي لا يتأثّر إلا بالـFIRED منها.
// ⚠️ **قائمة بيضاء لا سوداء بالفعل (تحقّق مباشر، أمر 2026-09-23 +03
// البند "القرّاء")**: الشرط أدناه `g.status !== 'FIRED'` — يفحص المساواة
// بقيمة واحدة معلومة، لا يعدّد القيم السيّئة. فأي قيمة جديدة (INPUT_ABSENT
// الآن، أو أي قيمة مستقبلية) تسقط تلقائياً في فرع "لا أثر" بلا تعديل
// كود هنا — هذا ما جعل إضافة INPUT_ABSENT لا تحتاج لمس applyCeilings/
// applyOverallCeilings إطلاقاً، فقط computeGates التي تُنتجها.
function applyCeilings(letter, category, gates) {
  const applicable = gates.filter((g) => g.category === category);
  let rank = LETTER_ORDER[letter];
  const applied = [];
  for (const g of applicable) {
    if (g.status !== 'FIRED') {
      applied.push(Object.assign({}, g, {cappedThisLetter: false}));
      continue;
    }
    const ceilingRank = LETTER_ORDER[g.ceilingLetter];
    if (ceilingRank > rank) {
      applied.push(Object.assign({}, g, {cappedThisLetter: true}));
      rank = ceilingRank;
    } else {
      applied.push(Object.assign({}, g, {cappedThisLetter: false, note: GATE_NOTE_CATEGORY_ALREADY_WORSE}));
    }
  }
  return {letter: LETTER_BY_RANK[rank], gatesApplied: applied};
}

// يُطبَّق على الحرف العامّ — **كل** بوّابة FIRED (أيّاً كانت فئتها
// المصدر)، بصرف النظر عن حالة تلك الفئة (MEASURED أو PARTIAL). هذا هو
// الإصلاح: شبكة الأمان تعمل تحديداً حين تكون الفئة الخطرة PARTIAL (فتسقط
// من overall لولا هذه الشبكة).
function applyOverallCeilings(letter, gates) {
  let rank = letter === null ? null : LETTER_ORDER[letter];
  const applied = [];
  for (const g of gates) {
    if (g.status !== 'FIRED') {
      applied.push(Object.assign({}, g, {cappedOverall: false}));
      continue;
    }
    const ceilingRank = LETTER_ORDER[g.ceilingLetter];
    if (rank === null || ceilingRank > rank) {
      applied.push(Object.assign({}, g, {cappedOverall: true}));
      rank = ceilingRank;
    } else {
      applied.push(Object.assign({}, g, {cappedOverall: false, note: GATE_NOTE_OVERALL_ALREADY_WORSE}));
    }
  }
  return {letter: rank === null ? letter : LETTER_BY_RANK[rank], gatesApplied: applied};
}

// ─── بناء TestResult لكل عنصر functionalResults/manualResults ──────────
function buildAllTestResults(functionalResults, manualResults, dev, findings) {
  const out = [];
  for (const r of (Array.isArray(functionalResults) ? functionalResults : [])) {
    const cat = normalizeCategory(r && r.categoryName);
    if (!cat) continue;
    out.push(Object.assign({category: cat, raw: r}, toTestResult(r, dev, findings, {isManual: false})));
  }
  for (const r of (Array.isArray(manualResults) ? manualResults : [])) {
    const cat = manualCategoryFor(r);
    if (!cat) continue;
    out.push(Object.assign({category: cat, raw: r}, toTestResult(r, dev, findings, {isManual: true})));
  }
  return out;
}

// ─── تغطية/تنفيذ فئة واحدة — مُشتقّة مرّة واحدة، تُستهلَك من مكانين
// (حرف الفئة في computeCategoryFromTests أدناه، وبوّابة
// LOW_CATEGORY_COVERAGE في computeGates أعلاه) — القاعدة 24 بامتدادها
// ("قيمة يقوم عليها تمييز مصدر واحد") تشمل هنا الحساب لا رقماً حرفياً
// فقط: لو اختلفت الصيغتان لاحقاً بلا قصد، تنجرف تغطية البوّابة عن تغطية
// العرض المعروضة معها — نفس نمط عطب A102.
//
// ق٢ (قرارات حسن، تفويض 2026-10-22، أمر المستخدم 2026-10-23): ما أعلن الفنّي غيابه (outcome=NOT_MEASURED وnotMeasuredReason=HARDWARE_ABSENT)
// خارج المقام — فلا تنقص التغطية لمكوّن لا يملكه الجهاز. وفئة كلّها غائبة العتاد ⟵ declared=0 ⟵ UNMEASURED (الشرط القائم أدناه).
// والتغطية العامّة (deriveOverallFromCategories) وبوّابة LOW_CATEGORY_COVERAGE (computeGates) تقرآن المقام من هذه الدالّة وحدها.
// الشرطان معاً: HARDWARE_ABSENT على outcome غير NOT_MEASURED لا يُستثنى؛ وكل سبب آخر لغير المقيس (تخطٍّ، حالة غير معروفة، محجوب، رفض إذن…) يبقى في المقام.
// القياس قبل التبنّي (الشرط الحاكم): أوراق متغيّرة 0 في 12 عيّنة ذهبية و0 في كل المدخلات المسجَّلة من جهاز؛ والمتغيّر 65 ورقة في 11 مدخلاً
// اصطناعياً مشتقّاً (fv69/fv70/fv71) وكلّها coverage/declaredCount وتفاصيل بوّابة الصوت — لا حرف ولا حالة ولا درجة (scratchpad/backend-delegated/det-diff-P2.json).
function computeHealthBearingStats(testResults) {
  const isHardwareAbsent = (r) => r.outcome === 'NOT_MEASURED' && r.notMeasuredReason === NOT_MEASURED_REASON.HARDWARE_ABSENT;
  const declaredHb = testResults.filter((r) => r.healthBearing && !isHardwareAbsent(r));
  const executed = declaredHb.filter((r) => r.outcome === 'PASS' || r.outcome === 'FAIL' || r.outcome === 'WARNING');
  const declared = declaredHb.length;
  const coverage = declared > 0 ? executed.length / declared : 0;
  return {declaredHb, executed, declared, coverage};
}

// ─── LOW_CATEGORY_COVERAGE — أمر المهمّة 2026-09-22 +03، البند ١. تُسقِف
// حرف الفئة حين (أ) تغطيتها دون العتبة، أو (ب) كل اختباراتها المُنفَّذة
// kind=STATE حصراً — صفر اختبار MEASUREMENT فعلي بينها. "أ" أو "ب" — OR
// صريح بنصّ المهمّة. STATE "حقائق حالة... لا قياس" (testKinds.js:89،
// reportShapeV7.js:268) — لا فئة تصنيف جديدة، القيمتان (STATE/MEASUREMENT)
// من testKinds.KIND القائم أصلاً (القاعدة الصريحة: "healthBearing وkind
// موجودان في testKinds — استعملهما، ولا تخترع تصنيفاً").
//
// لا تُطلَق (NOT_FIRED صراحةً، لا حذف صامت) حين executed.length=0 —
// الفئة غير مقيسة أصلاً (UNMEASURED)، لا حرف لتسقيفه؛ إطلاقها هنا كان
// سيُسقِف overall عبر applyOverallCeilings زوراً لفئة لم تُقَس شيئاً (تلك
// الدالّة تُطبَّق بصرف النظر عن حالة الفئة المصدر — تحديداً السبب الذي
// يُلزم هذا الاستثناء).
//
// ✅ **ceilingLetter='B' مُقَرّ من المستخدم (2026-09-22 +03)** — لم يعد
// افتراضاً معلَّقاً (كان كذلك حتى هذا التاريخ، راجع تعليق تاريخي كان هنا،
// مُستبدَل لا محذوف — القاعدة 8 تخصّ التقارير لا تعليقات الكود، لكن
// المبدأ نفسه: التأريخ يبقى). نصّ الإقرار حرفياً: "التغطية المنخفضة تحفّظ
// على الثقة لا عطب مؤكَّد. وسقف C يعني «هذه الفئة معيبة» وهو ادّعاء لا
// نملكه — نحن لم نقس، لا وجدنا خللاً. وB على PATCH_AGE سابقة قائمة من
// الفصيلة نفسها، فالاتّساق أولى من رقم جديد." اخترتُ B أصلاً قياساً على
// PATCH_AGE (سقف B أيضاً) — كلاهما "تحفّظ على ثقة لا عطب مؤكَّد"، بعكس
// ROOT_DETECTED/STORAGE_VERIFY_ERRORS/GPU_HASH_MISMATCH (سقف C/D، عطب
// مؤكَّد أو خطير).
function computeLowCategoryCoverageGate(category, executed, coverage, thresholdValue) {
  // coveragePct — حقل رقمي **حقيقي** (leaf number لا نصّاً مركَّباً)، بجانب
  // coverage (الكسر). دفاعي، غير منصوص حرفياً في أمر المهمّة: source أدناه
  // نصّ مركَّب ("coverage=40.0%...") لا يدخل مجموعة الأرقام المرجعية
  // (reportShapeV7.js:collectNumbers يقرأ leaf رقمياً/نصّاً رقمياً محضاً
  // فقط) — فلو استشهد النموذج بصيغة النسبة المئوية (كما فعل مع
  // partialAssessmentTag.coveragePct، السابقة الوحيدة لهذا النمط في
  // categoryStates.js) بلا هذا الحقل لرُفض رقمه زوراً رغم كونه نفس القياس
  // بصيغة مختلفة. **غير مُختبَر بنداء حيّ** (القيد الصريح: لا نداء نموذج) —
  // مذكور بارزاً في تقرير المهمّة.
  const coveragePct = Math.round(coverage * 1000) / 10;
  if (executed.length === 0) {
    return {
      // كانت 'NOT_FIRED' — أمر مستخدم 2026-09-23 +03 (البند ب، القاعدة
      // 22 في موضعها السادس هنا): صفر اختبار مُنفَّذ يعني الفئة لم
      // تُقَس، لا "قِيست والشرط لم يتحقّق". هذا بالضبط المثال الحيّ الذي
      // بنى عليه المستخدم قراره (thermal/camera/audio/input على
      // b45c8cf6: state=UNMEASURED فعلاً، والبرومبت كان يصفها "قِيست
      // ببيانات كافية").
      name: 'LOW_CATEGORY_COVERAGE', category, ceilingLetter: 'B', coveragePct,
      status: 'INPUT_ABSENT', source: 'لا اختبار مُنفَّذ — الفئة غير مقيسة أصلاً، البوّابة لا تنطبق',
      // أمر المهمّة 2026-09-22 +03 (البند الثاني — letterCeilingReason على
      // display.categories.<cat>): الفرعان أدناه غير محسوبين على هذا
      // المسار (ينتهي قبلهما) — null صراحةً لا undefined (القاعدة 22)،
      // كي لا يحتاج buildDisplayShapeV7.js تخمين "لماذا غائبان هنا".
      belowThreshold: null, allNonMeasurement: null,
    };
  }
  const belowThreshold = coverage < thresholdValue;
  const allNonMeasurement = executed.every((r) => r.kind !== KIND.MEASUREMENT);
  const fired = belowThreshold || allNonMeasurement;
  const pct = coveragePct.toFixed(1);
  const thPct = (thresholdValue * 100).toFixed(1);
  const parts = [];
  if (belowThreshold) parts.push(`coverage=${pct}% < ${thPct}%`);
  if (allNonMeasurement) parts.push(`${executed.length}/${executed.length} اختبار منفَّذ من صنف STATE — صفر MEASUREMENT`);
  return {
    name: 'LOW_CATEGORY_COVERAGE', category, ceilingLetter: 'B', coveragePct,
    status: fired ? 'FIRED' : 'NOT_FIRED',
    source: fired ? parts.join('؛ ') : `coverage=${pct}%، ${executed.length} اختبار منفَّذ يتضمّن MEASUREMENT`,
    // أمر المهمّة 2026-09-22 +03 (البند الثاني) — buildDisplayShapeV7.js
    // تحتاج التمييز بين سبب الإطلاق (تغطية منخفضة / كلّها STATE / كلاهما)
    // لبناء نصّ display البشري **بلا إعادة حساب** (القاعدة 24: نفس
    // المصدر الذي بنى `parts` أعلاه بالضبط — لا نسخة مستقلّة من هذا
    // المنطق في ملفّ آخر، تجنّباً لانجراف من طراز A102).
    belowThreshold, allNonMeasurement,
  };
}

// ─── حالة/حرف/تغطية فئة واحدة (غير البطارية) ────────────────────────────
function computeCategoryFromTests(testResults, gates, category) {
  const {declaredHb, executed, declared, coverage} = computeHealthBearingStats(testResults);
  const automaticExecuted = executed.filter((r) => !r.attested);

  let state;
  if (declared === 0 || executed.length === 0) state = 'UNMEASURED';
  else if (automaticExecuted.length === 0) state = 'ATTESTED_ONLY';
  else if (coverage >= 1) state = 'MEASURED';
  else state = 'PARTIAL';

  const entry = {
    category, coverage, state,
    declaredCount: declared, executedCount: executed.length,
    passCount: executed.filter((r) => r.outcome === 'PASS').length,
    failCount: executed.filter((r) => r.outcome === 'FAIL').length,
    warningCount: executed.filter((r) => r.outcome === 'WARNING').length,
    score: null, deterministicLetter: null, gatesApplied: [],
    testIds: testResults.map((r) => r.testId),
    // اقتراح نموذج مخالف — يُحفَظ ولا يُعرض إن وُجد لاحقاً (P1.4). لا قيمة
    // اليوم؛ الحقل محجوز بالشكل النهائي (تصحيح المستخدم أثناء التنفيذ).
    llmSuggestedLetter: null,
    // القرار ٤٢ البند ٢ (A62) — finalLetter/adjustmentApplied/
    // adjustmentEvidence/adjustmentReason حاضرة دائماً منذ البناء (خط
    // أساس "لا تعديل بعد") — applyV7Adjustments (buildV7Payload.js) تكتب
    // فوقها فقط حين DOWN مقبول فعلاً على هذه الفئة تحديداً. finalLetter
    // تُهيَّأ أدناه (بعد حساب deterministicLetter) لا هنا — تبدأ null مثله
    // ثم تُطابقه حرفياً في نهاية الحساب.
    adjustmentApplied: false, adjustmentEvidence: null, adjustmentReason: null,
  };

  if (state === 'MEASURED' || state === 'PARTIAL') {
    entry.score = 100 * entry.passCount / executed.length;
    let letter = letterFromScore(entry.score);
    const stateFail = executed.some((r) => r.kind === KIND.STATE && r.outcome === 'FAIL');
    const stateWarn = executed.some((r) => r.kind === KIND.STATE && r.outcome === 'WARNING');
    if (stateFail) {
      letter = 'D';
      entry.floorApplied = 'STATE_FAIL_FLOOR';
    } else if (stateWarn && LETTER_ORDER[letter] < LETTER_ORDER.C) {
      letter = 'C';
      entry.floorApplied = 'STATE_WARNING_CEILING';
    }
    const capped = applyCeilings(letter, category, gates);
    entry.deterministicLetter = capped.letter;
    entry.gatesApplied = capped.gatesApplied;
  }
  // finalLetter = deterministicLetter عند البناء (القياس وحده بعد، بلا أي
  // تعديل نموذج) — بعد الشرط أعلاه كي يلتقط null (لا حرف) أو الحرف الفعلي
  // معاً بنفس السطر، بدل تكراره في الفرعين.
  entry.finalLetter = entry.deterministicLetter;

  return entry;
}

// ─── البطارية — فئة خاصّة من طبقة ٤-ج ───────────────────────────────────
function computeBatteryCategory(sampleInputs, design) {
  if (!sampleInputs) {
    return {
      category: 'battery', coverage: 0, state: 'UNMEASURED',
      declaredCount: 4, executedCount: 0, passCount: 0, failCount: 0, warningCount: 0,
      score: null, deterministicLetter: null, gatesApplied: [], llmSuggestedLetter: null,
      // القرار ٤٢ البند ٢ — راجع تعليق computeCategoryFromTests أعلاه لنفس
      // الاصطلاح: finalLetter يبدأ مطابقاً لـdeterministicLetter (null هنا).
      finalLetter: null, adjustmentApplied: false, adjustmentEvidence: null, adjustmentReason: null,
      confidence: null, verdictLabel: null,
      batteryIndicators: null, batteryAggregate: null,
      reason: 'HARNESS_ERROR',
    };
  }
  const layer = computeBatteryLayer(Object.assign({design}, sampleInputs));
  const measuredCount = Object.values(layer.indicators).filter((x) => x.status === 'MEASURED').length;
  const coverage = measuredCount / 4;

  // لا حرف بلا verdict مُعايَر (انظر رأس batteryLayer.js). state تعكس ما
  // إن كانت *قيم* المؤشّرات متاحة للعرض المعلوماتي، لا حرفاً بعد.
  let state;
  if (measuredCount === 0) state = 'UNMEASURED';
  else if (layer.aggregate.judgment === 'غير كافية') state = 'PARTIAL'; // قيم معروضة، لا حرف
  else state = 'MEASURED';

  const canGrade = layer.aggregate.judgment !== 'غير كافية' &&
      layer.aggregate.judgment !== 'مؤشّرات متعارضة' &&
      // اليوم يستحيل الوصول لهذا الفرع فعلياً (verdict مقفل على
      // THRESHOLD_NOT_CALIBRATED) — جاهز لتفعيله عند معايرة PLAN-03.
      false;

  // ثلاث درجات وصفية فقط — لا رقم مئوي إطلاقاً (تصحيح المستخدم أثناء
  // التنفيذ، بند 3؛ ومصدره الأصلي §٤-ج). deterministicLetter هنا ليس
  // حرفاً A-D بل إحدى الدرجات الثلاث نفسها، أو null إن لم يتوفّر verdict
  // مُعايَر بعد (الحال اليوم على كل فحص متاح — راجع batteryLayer.js).
  const batteryDeterministicLetter = canGrade ? (layer.aggregate.displayGrade || layer.aggregate.judgment) : null;
  return {
    category: 'battery', coverage, state,
    declaredCount: 4, executedCount: measuredCount, passCount: null, failCount: null, warningCount: null,
    score: null, // ممنوع دائماً للبطارية
    deterministicLetter: batteryDeterministicLetter,
    llmSuggestedLetter: null,
    // القرار ٤٢ البند ٢ — finalLetter = deterministicLetter عند البناء
    // (نفس اصطلاح computeCategoryFromTests). ملاحظة مهمّة موثَّقة في
    // buildV7Payload.js (applyV7Adjustments، فرع NO_BASE_LETTER): البطارية
    // اليوم قد تحمل state="MEASURED"/"PARTIAL" مع deterministicLetter=null
    // معاً (canGrade مُقفَل false حتى PLAN-03) — فجوة مُسمّاة لا مُخمَّنة،
    // لا تُغلَق هنا.
    finalLetter: batteryDeterministicLetter, adjustmentApplied: false,
    adjustmentEvidence: null, adjustmentReason: null,
    confidence: canGrade ? layer.aggregate.confidence : null,
    verdictLabel: canGrade ? (layer.aggregate.displayGrade || layer.aggregate.judgment) : null,
    tag: 'ESTIMATED', gatesApplied: [],
    batteryIndicators: layer.indicators, batteryAggregate: layer.aggregate,
    // النصّ من categoryGradingLock.js (القرار ٤٤) — لا سلسلة حرفية منفصلة
    // هنا بعد اليوم؛ القيمة نفسها بلا تغيير حرف واحد.
    noLetterReason: canGrade ? null : CATEGORY_GRADING_LOCKED_TEXT,
  };
}

// ─── القائمة الحتمية للأعطال/الإفصاحات (P1.3 §تعديل 2026-09-20) ────────
function buildDeterministicIssues(categoryEntries, allTestResults) {
  const issues = [];
  const byCategory = {};
  for (const r of allTestResults) (byCategory[r.category] = byCategory[r.category] || []).push(r);

  for (const entry of categoryEntries) {
    const tests = byCategory[entry.category] || [];
    let anyIssue = false;
    for (const r of tests) {
      if (!r.healthBearing) continue;
      if (r.outcome === 'FAIL' || r.outcome === 'WARNING') {
        issues.push({
          id: `ISS-${r.testId}`, category: entry.category, severity: r.outcome,
          // S2 (أمر مستخدم 2026-10-01 +03): "<تنبيه|فشل|غير مقيس|لا أعطاب> —
          // <اسم الفئة بالعربية>، بلا رقم اختبار ولا مفتاح فئة لاتيني." كان
          // القالب "${verdict} في الاختبار ${testId}" — testId يبقى حقلاً
          // (id أعلاه يحمله، `ISS-${r.testId}`) لا في نصّ title. اسم الفئة
          // من CATEGORY_NAME_AR (utils/categories.js) — مصدر واحد، لا جدول
          // ثانٍ (القاعدة 24).
          title: `${r.outcome === 'FAIL' ? 'فشل' : 'تنبيه'} — ${CATEGORY_NAME_AR[entry.category] || entry.category}`,
          evidence: r.evidence, evidenceUnit: r.evidenceUnit,
        });
        anyIssue = true;
      } else if (r.outcome === 'NOT_MEASURED' && r.notMeasuredReason) {
        // القرار ٨٩ ثم القرار ٩٥ البند ١ (ج، 2026-09-25 +03، نصّ المستخدم
        // حرفياً): "قالب العنوان يصير «غير مقيس: <testId>»" — رمز السبب
        // (notMeasuredReason) لم يعد يظهر بين قوسين في العنوان المعروض.
        // **مُستبدَل مجدَّداً 2026-10-01 +03 (S2، أمر مستخدم)**: testId نفسه
        // لم يَعُد يظهر في title أصلاً (لا رقم اختبار في العرض) — العنوان
        // صار "غير مقيس — <اسم الفئة بالعربية>"، بنفس قالب الحالتين
        // الأخريين. ⚠️ **notMeasuredReason يبقى حقلاً منفصلاً على العنصر
        // نفسه أدناه** (لم يُحذَف، لم يُستبدَل بغيره) — القارئ الوحيد
        // المُتحقَّق منه الذي كان يستخرج كلماته من نصّ العنوان تحديداً
        // (collectGateNameTokens، reportShapeV7.js:476-497 — GATE_VOCAB_KEYS
        // تتضمّن 'notMeasuredReason' كحقل مستقلّ أصلاً، لا اعتماداً على
        // ظهوره داخل title) يقرأ الحقل مباشرة لا العنوان — فالفهرس المُشتقّ
        // منه لا يتأثّر. testId نفسه يبقى في id (`DISC-${r.testId}`).
        issues.push({
          id: `DISC-${r.testId}`, category: entry.category, severity: 'INFO',
          title: `غير مقيس — ${CATEGORY_NAME_AR[entry.category] || entry.category}`,
        });
      }
    }
    if (!anyIssue && entry.state === 'MEASURED') {
      // S2: كان "${entry.category}: لا أعطاب..." — مفتاح فئة لاتيني خامّ
      // (مثل "storage") في نصّ معروض. صار اسم الفئة بالعربية بفاصل "—".
      issues.push({id: `POS-${entry.category}`, category: entry.category, severity: 'POSITIVE', title: `لا أعطاب — ${CATEGORY_NAME_AR[entry.category] || entry.category}`});
    }
  }
  return issues;
}

// ─── overall — دالّة قابلة لإعادة الدخول (reentrant) ────────────────────
// عُزلت من computeCategoryStates في هذه المهمّة (عطب رُصِد في
// applyV7Adjustments — buildV7Payload.js: كانت تُعدِّل
// categories[cat].deterministicLetter ولا تُعيد اشتقاق overall، فينتج
// جدول لا يفسّر حرفه، بصيغة جديدة من A63. القرار ٦ — score/الآن
// measuredCategoriesMean لا يُعرض، المعروض الحرف والتغطية وسبب البوّابة —
// يقوم على أن الحرف قابل لإعادة الاشتقاق من الجدول المعروض معه). الإصلاح:
// "إعادة تصدير weightedScore/gates/التغطية كدالّة قابلة لإعادة الدخول" —
// نصّ المهمّة حرفياً. تُستدعى مرّتين في هذا المستودع اليوم بنفس التوقيع
// (categories, gates) ← نفس overall بالضبط: من computeCategoryStates عند
// البناء الأول أدناه، ومن applyV7Adjustments (buildV7Payload.js) بعد أي
// تعديل DOWN مقبول على حرف فئة — على categories المُعدَّلة، لا الأصلية.
//
// ⚠️ **لا تُستدعى على مسار HARNESS_ERROR**: buildHarnessErrorCategoryStates
// أعلاه لها شكل overall خاصّ (coverage:null دلالياً غائبة لا 0% — القرار
// ١٢) لا يُشتقّ من هذه الصيغة العامّة؛ لا حاجة أصلاً — كل الفئات غير
// البطارية هناك deterministicLetter=null فتُرفَض كل adjustments[] هناك
// NO_BASE_LETTER قبل أن تُغيَّر categories بشيء.
//
// letterSource (قرار مستخدم إضافي أثناء هذه المهمّة — يفسّر الفجوة بين
// measuredCategoriesMean والحرف المعروض بلا استنتاج من قارئ التقرير):
//   "BAND"        — الحرف = letterFromScore(measuredCategoriesMean) مباشرة؛
//                   لم يُغيّره سقف بطارية ولا بوّابة مسمّاة.
//   "GATE:<name>" — آخر آلية سقف أثّرت فعلياً في سلسلة التطبيق (سقف
//                   البطارية BATTERY_MAX_ONE_BAND أوّلاً، ثم البوّابات
//                   الخمس بترتيب computeGates) هي الحاكمة — لا كل بوّابة
//                   أُطلقت، بل التي غيّرت الرتبة النهائية فعلياً.
//   "NO_DATA"     — صفر فئة MEASURED (measuredCategoriesMean=null) ولم
//                   تُنقذه أي بوّابة (letter يبقى null رغم ذلك ممكن حين
//                   تُطلَق بوّابة على رتبة null ابتداءً — عندها letterSource
//                   تصير GATE:<name> لأن letter لم يعد null، لا NO_DATA).
// قاعدة التعادل (بوّابتان بنفس ceilingLetter أطلقتا معاً): الأسبق في ترتيب
// gates[] الثابت (ترتيب computeGates) هي الحاكمة — applyOverallCeilings
// تُحدِّث الرتبة فقط عند ceilingRank > الرتبة الحالية (صرامة لا مساواة)،
// فبوّابة لاحقة بنفس السقف تجد الرتبة الحالية مساوية له أصلاً فتُعلَّم
// cappedOverall:false بلا أثر. مثال حقيقي مُتحقَّق منه (b45c8cf6، S10
// المجذَّر): ROOT_DETECTED (سقف C) و PATCH_AGE (سقف B) تُطلقان معاً؛
// ROOT_DETECTED أسبق في computeGates فتضبط الرتبة أولاً (C)، فتجد
// PATCH_AGE أن C أسوأ من سقفها B أصلاً (ceilingRank(B)=1 ليس > 2) فلا أثر
// — letterSource=GATE:ROOT_DETECTED، لا PATCH_AGE.
// @param {Object} categories خارطة الفئات {category: entry} (بعد أي تعديل
//   adjustments[] إن وُجد — الدالّة لا تعرف مصدر categories، فقط تقرأها)
// @param {Array} gates مخرَج computeGates (البوّابات الخام بحالاتها —
//   FIRED/NOT_FIRED/INPUT_ABSENT/NOT_WIRED/DISABLED (خمسة منذ 2026-09-23
//   +03) — قبل أي تطبيق على أي حرف)
// @return {Object} overall بكل حقوله (بلا adjustments/disputed الفعليّين
//   — هذان حقلا افتراضي [] / false هنا؛ المستدعي الذي يطبّق adjustments[]
//   فعلياً (applyV7Adjustments) يستبدلهما بعد الاستدعاء)
function deriveOverallFromCategories(categories, gates) {
  // القرار ١٠ (محسوم 2026-09-21، PLAN-01-ROADMAP.md §🔒 قرارات شكل
  // الاستجابة، البند ١٠): "التغطية = وزن الفئات التي أنتجت حرفاً ÷ وزن
  // الفئات الحاملة للصحّة. فئة بـcoverage=100% وdeterministicLetter=null
  // لا تُحسب." يُلغي التعريف القديم (وزن×تغطية لكل الفئات بلا شرط) —
  // المثال الحيّ: البطارية اليوم دائماً coverage=1.0 (أربعة مؤشّرات
  // مُحسَبة فعلياً) لكن deterministicLetter=null (لا verdict مُعايَر بعد،
  // راجع batteryLayer.js) — القديم كان يحسبها كامل وزنها (35) رغم أنها لم
  // "تُنتج حرفاً". الجديد: يُستبعَد وزن الفئة كاملاً (لا يُقصّ عند حدّها
  // الداخلي) حين deterministicLetter=null؛ الفئات التي أنتجت حرفاً فعلاً
  // (بما فيها PARTIAL) تبقى تُسهم بحصّتها الداخلية (coverage(c)) كما كانت.
  // تحقَّق حسابياً على b45c8cf6 (S10 الحقيقي): 80.0% (تعريف قديم) → 45.0%
  // (تعريف جديد) — الفارق 35 نقطة بالضبط (وزن البطارية) — يطابق حرفياً
  // "الرقم النافذ للفحصين: 45%... الفارق 35 نقطة كلّها من البطارية بلا
  // حرف" في PLAN-01.
  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  let coverageSum = 0;
  for (const cat of CATEGORIES) {
    if (categories[cat].deterministicLetter === null) continue;
    coverageSum += CATEGORY_WEIGHTS[cat] * (categories[cat].coverage || 0);
  }
  const overallCoverage = coverageSum / totalWeight;

  function weightedScore(excludeCategory) {
    let wSum = 0; let sSum = 0;
    for (const cat of CATEGORIES) {
      if (cat === excludeCategory) continue;
      const entry = categories[cat];
      const w = CATEGORY_WEIGHTS[cat];
      if (entry.state === 'MEASURED' && typeof entry.score === 'number') {
        wSum += w; sSum += w * entry.score;
      }
    }
    return wSum > 0 ? sSum / wSum : null;
  }

  // measuredCategoriesMean — اسمها حتى 2026-09-21: overallScore/score. أُعيدت
  // التسمية بقرار مستخدم أثناء هذه المهمّة بالذات: "الاسم score يوحي
  // بالدرجة العامة وهو ليس كذلك — إنه متوسّط الفئات المقيسة وحدها. والاسم
  // المضلِّل هو ما جعل «C مع 100» يبدو تناقضاً بدل أن يُقرأ رقمين
  // مختلفين." القرار ٦ قائم كما هو: هذا الحقل **لا يُعرض للمستخدم** —
  // يُحفَظ للتدقيق فقط؛ letterSource أدناه هو ما يجعل "سبب البوّابة" قابلاً
  // للعرض بلا استنتاج.
  const measuredCategoriesMean = weightedScore(null);
  // تصحيح المستخدم أثناء التنفيذ: "الحرف يُحسب ويُعرض دائماً" يُلغي قاعدة
  // "تغطية<0.6 → بلا حرف". طُبِّق أدناه حرفياً لكل حالة فيها بيانات فعلية.
  // **حالة حدّية واحدة غير مشمولة بنصّ رسالة التصحيح صراحةً**: صفر فئات
  // MEASURED إطلاقاً (measuredCategoriesMean=null، أي لا رقم رياضي لاشتقاق
  // حرف منه بتاتاً — لا "تغطية منخفضة" بل "لا بيانات"). أُبقي letter=null
  // هنا مع noDataAtAll=true بدل اختلاق حرف من عدم (ما لم تُنقذه بوّابة —
  // letterSource يوثّق ذلك). لم يقع هذا إلا على فحص Honor في هذا المستودع
  // تحديداً (functionalResults غائبة كلياً من الفخّ الذهبي — 404 موثَّق) —
  // وذلك عبر المسار الآخر كلّياً (buildHarnessErrorCategoryStates)، لا
  // هنا؛ noDataAtAll هنا يعني بيانات وصلت لكن صفر فئة أنتجت حرفاً.
  const noDataAtAll = measuredCategoriesMean === null;
  const scoreRank = noDataAtAll ? null : LETTER_ORDER[letterFromScore(measuredCategoriesMean)];

  // سقف البطارية (35% كما هو، لا تُنزل الدرجة العامّة أكثر من درجة واحدة
  // وحدها) — على **رقم المتوسّط المرجَّح وحده**، قبل البوّابات المسمّاة.
  // لماذا هذا الترتيب تحديداً (إصلاح فوق e599edf، بند مطلوب 1): تطبيقه
  // بعد البوّابات كان سيستعمل Math.min ليُحسِّن حرفاً أفسدته بوّابة
  // ROOT_DETECTED/PATCH_AGE (لا علاقة لهما بالبطارية) — أي يُبطل بوّابة
  // الجذر بحجّة "سقف البطارية". طبّقتُه هنا على المتوسّط الخام فقط، ثم
  // البوّابات المسمّاة تُطبَّق بعده بلا شرط (لا تُحسَّن أبداً، تُسوَّأ فقط).
  //
  // ملاحظة letterSource: هذا السقف **يُحسِّن فقط** (Math.min يختار الأفضل
  // بين الرتبة الخام وسقف "درجة واحدة تحت الاستثناء")، عكس البوّابات
  // الخمس أدناه (تُسوِّئ فقط). كلاهما يُتتبَّع بنفس lastEffectiveName —
  // "آخر آلية غيّرت الرتبة فعلياً" بصرف النظر عن الاتّجاه.
  let batteryCapped = null;
  let rank = scoreRank;
  let lastEffectiveName = null;
  if (scoreRank !== null && categories.battery.state === 'MEASURED') {
    const scoreExclBattery = weightedScore('battery');
    if (scoreExclBattery !== null) {
      const letterExclRank = LETTER_ORDER[letterFromScore(scoreExclBattery)];
      const capped = Math.min(scoreRank, letterExclRank + BATTERY_MAX_BAND_DROP);
      if (capped !== rank) {
        batteryCapped = {name: 'BATTERY_MAX_ONE_BAND', from: LETTER_BY_RANK[rank], to: LETTER_BY_RANK[capped]};
        rank = capped;
        lastEffectiveName = 'BATTERY_MAX_ONE_BAND';
      }
    }
  }
  const batteryCappedRank = rank;

  // البوّابات المسمّاة — **الإصلاح المطلوب (A63)**: تُطبَّق على الحرف
  // العامّ مباشرة (applyOverallCeilings)، بصرف النظر عن حالة الفئة المصدر
  // (MEASURED أو PARTIAL) — هذه بالضبط شبكة الأمان التي تمنع سقوط فئة
  // PARTIAL خطرة (security/D/جذر) من الحساب بلا أثر.
  const afterNamedGates = applyOverallCeilings(
      batteryCappedRank === null ? null : LETTER_BY_RANK[batteryCappedRank], gates);
  const overallLetter = afterNamedGates.letter;
  // آخر بوّابة أثّرت فعلياً (cappedOverall:true) في ترتيب gates[] الثابت
  // هي الحاكمة — لا كل بوّابة أُطلقت. راجع تعليق letterSource أعلى الدالّة
  // لقاعدة التعادل وسبب صحّتها.
  for (const g of afterNamedGates.gatesApplied) {
    if (g.cappedOverall) lastEffectiveName = g.name;
  }
  const letterSource = overallLetter === null ?
      'NO_DATA' :
      (lastEffectiveName ? `GATE:${lastEffectiveName}` : 'BAND');

  const partialBadLetterUngated = []; // "المطلوب 5" — مراجعة العكس، تفصيل أسفل.

  // القرار ١١ (محسوم 2026-09-21، PLAN-01-ROADMAP.md §🔒 قرارات شكل
  // الاستجابة، البند ١١): "noDataAtAll لا يمنع وسم «تقييم جزئي». كل تغطية
  // دون 0.6 تحمل الوسم، ولو كان الحرف null. الوسم يرافق الامتناع ولا
  // يُلغى به." يُلغي حرفياً الشرط `!noDataAtAll &&` الذي كان هنا (كان
  // يمنع الوسم في حالة noDataAtAll تحديداً بحجّة "لا حرف يُرفَق به الوسم")
  // — القرار يفصل الوسمين: partialAssessment يخصّ رقم التغطية وحده، وهو
  // مستقلّ تماماً عن وجود overallLetter من عدمه.
  const partialAssessment = overallCoverage < OVERALL_COVERAGE_GATE;
  const partialAssessmentTag = partialAssessment ? {
    label: 'تقييم جزئي',
    coveragePct: Math.round(overallCoverage * 1000) / 10,
    text: `تقييم جزئي — تغطية ${Math.round(overallCoverage * 1000) / 10}%`,
  } : null;

  const overallGatesApplied = afterNamedGates.gatesApplied.slice();
  if (batteryCapped) overallGatesApplied.push(batteryCapped);

  // "المطلوب 5" — مراجعة العكس: هل فئة PARTIAL أخرى بحرف سيّئ (C/D) تسقط
  // من overall بلا أي بوّابة FIRED تمسكها؟ **كاشف دائم، لا إصلاح بتخمين**
  // — يُبلَّغ في المخرَج ليقرّر المستخدم إن احتاج بوّابة جديدة.
  const firedGateCategories = new Set(gates.filter((g) => g.status === 'FIRED').map((g) => g.category));
  for (const cat of CATEGORIES) {
    const entry = categories[cat];
    if (entry.state === 'PARTIAL' && (entry.deterministicLetter === 'C' || entry.deterministicLetter === 'D') &&
        !firedGateCategories.has(cat)) {
      partialBadLetterUngated.push({
        category: cat, letter: entry.deterministicLetter, coverage: entry.coverage,
        note: 'فئة PARTIAL بحرف سيّئ تسقط من overall (على MEASURED فقط) ولا بوّابة مسمّاة تمسكها — ' +
            'قرار المستخدم إن احتاج بوّابة جديدة (لا يُصلَح بتخمين هنا)',
      });
    }
  }

  return {
    coverage: overallCoverage,
    measuredCategoriesMean,
    letter: overallLetter,
    letterSource,
    noDataAtAll,
    // A97 #2/#3: حاضرتان دائماً بقيمة صريحة (false هنا) — لا غياب صامت.
    // المسار الوحيد الذي يرفعهما true هو buildHarnessErrorCategoryStates
    // (لا يستدعي هذه الدالّة إطلاقاً — راجع تعليق أعلى الدالّة).
    harnessError: false,
    harnessErrorReason: null,
    // S3 (أمر مستخدم 2026-10-01 +03) — نفس نمط الحقلين أعلاه: حاضر دائماً
    // بقيمة صريحة null هنا (المسار العادي) — المسار الوحيد الذي يرفعه غير
    // null هو buildHarnessErrorCategoryStates.
    harnessErrorMessage: null,
    partialAssessment,
    partialAssessmentTag,
    gatesApplied: overallGatesApplied,
    // كاشف "المطلوب 5" — مصفوفة فارغة = لا فئة PARTIAL خطرة غير ممسوكة
    // اليوم (تحقّقتُ على الفحصين الحقيقيين المتاحين). ليست ضمانة أن لا
    // تظهر حالة كهذه على فحص آخر — الكاشف يعمل في كل تشغيل، لا مرّة واحدة.
    partialBadLetterUngated,
    // اقتراحات نموذج مخالفة — تُحفَظ ولا تُعرض (تصحيح المستخدم أثناء
    // التنفيذ، بند 4؛ ثم القرار ٤). المستدعي (applyV7Adjustments،
    // buildV7Payload.js) يستبدل adjustments/disputed هذين بالسجلّ الفعلي
    // بعد الاستدعاء — القيمتان هنا افتراض "لا تعديل" فقط.
    llmOverall: null,
    adjustments: [],
    disputed: false,
  };
}

/**
 * نقطة الدخول — تبني جدول الفئات الخمس عشرة والدرجة العامة من فحص واحد.
 *
 * @param {Object} params
 * @param {Array} params.functionalResults
 * @param {Array} params.manualResults
 * @param {Object} params.dev
 * @param {Object} params.findings (اختياري — للتوقيع فقط، غير مُستهلَك اليوم)
 * @param {Object} params.batterySampleInputs {n,t,ph,temp,volt,cur,lvl} أو null
 * @param {number|null} params.batteryDesignCapacityMah
 * @param {?string} [params.cycleCountClassification] الوسم CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 أو null/غائب (لا تصنيف) — راجع ALLOWED_PARAM_KEYS
 */
function computeCategoryStates(params) {
  const p = params || {};
  validateParamKeys(p); // A97 #1: مفتاح غير معروف → خطأ صريح، لا تجاهل صامت

  // A97 #2/#3 + القرار ١٢: functionalResults === null صراحةً (لا undefined
  // ولا []) يعني "تعذّر التجهيز" — مسار مختلف كلّياً، يُعلَن في overall.
  if (p.functionalResults === null) {
    return buildHarnessErrorCategoryStates(p);
  }

  // دورات الشحن «غير مدعوم» (cycleCountClassification.js): B-08 لا يدخل الثلاثيات. B-08 SPEC (healthBearing=false) فلا حرف ولا عطب ولا تغطية يتغيّر بإسقاطه — يتغيّر ما يقرؤه من testResults وحدها.
  const allTestResultsBuilt = buildAllTestResults(p.functionalResults, p.manualResults, p.dev, p.findings);
  const allTestResults = p.cycleCountClassification === CYCLE_COUNT_UNSUPPORTED_ZERO_FROM_EXTRA_API34 ?
      allTestResultsBuilt.filter((r) => r.testId !== CYCLE_COUNT_TEST_ID) :
      allTestResultsBuilt;
  const byTestId = {};
  for (const r of (Array.isArray(p.functionalResults) ? p.functionalResults : [])) byTestId[r.testId] = r;

  // مُقدَّمة قبل computeGates الآن (كانت تُبنى بعدها) — بلا تغيير في
  // منطقها، فقط إعادة ترتيب: LOW_CATEGORY_COVERAGE (داخل computeGates)
  // تحتاج testResults كل فئة مُجمَّعة مسبقاً لحساب تغطيتها/أنواع اختباراتها
  // المُنفَّذة (نفس البيانات التي كانت تُبنى بعد computeGates سابقاً لغرض
  // آخر فقط — لا تكرار جديد هنا، فقط تبكير البناء).
  const byCategory = {};
  for (const cat of CATEGORIES) byCategory[cat] = [];
  for (const r of allTestResults) if (byCategory[r.category]) byCategory[r.category].push(r);

  const gates = computeGates({functionalByTestId: byTestId, findings: p.findings, byCategory, analyzedAtMs: p.analyzedAtMs});

  const categories = {};
  for (const cat of CATEGORIES) {
    if (cat === 'battery') {
      categories.battery = computeBatteryCategory(p.batterySampleInputs, p.batteryDesignCapacityMah);
    } else {
      categories[cat] = computeCategoryFromTests(byCategory[cat], gates, cat);
    }
  }

  const overall = deriveOverallFromCategories(categories, gates);

  const categoryEntries = CATEGORIES.map((c) => categories[c]);
  const issues = buildDeterministicIssues(categoryEntries, allTestResults);

  const lettersHash = sha256(CATEGORIES.map((c) => `${c}:${categories[c].deterministicLetter || ''}`));
  const numbersHash = sha256(CATEGORIES.map((c) => `${c}:${categories[c].score === null ? '' : categories[c].score.toFixed(4)}`)
      .concat([`overall:${overall.measuredCategoriesMean === null ? '' : overall.measuredCategoriesMean.toFixed(4)}`]));
  const issueSetHash = sha256(issues.map((i) => i.id).sort());

  return {
    categories,
    overall,
    // الثلاثيات (TestResult[]) — P1.4، تُستهلَك من buildV7Payload.js بدل
    // إعادة بناء allTestResults من الصفر عند تجميع حمولة النموذج. غير
    // مذكورة في وثيقة الشكل قبل P1.4 (إضافة إلزامية 5، حقل additive لا
    // يُبطل أي مستهلك سابق للشكل).
    testResults: allTestResults,
    issues,
    issueSetHash, lettersHash, numbersHash,
    // gates: خامّ computeGates أعلاه — حقل إضافي (additive) جديد بهذه
    // المهمّة، بنمط testResults في P1.4. الغرض: applyV7Adjustments
    // (buildV7Payload.js) تحتاج نفس gates لإعادة استدعاء
    // deriveOverallFromCategories من الصفر بعد تعديل categories[] —
    // بلا هذا الحقل تضطرّ لإعادة بناء gates بنفسها (استيراد computeGates
    // غير المُصدَّرة اليوم، ومكرِّرة functionalByTestId) أو لتخمين قيمتها.
    // مصدر العطب المُصلَح في هذه المهمّة أصلاً هو استهلاك overall القديم
    // بلا إعادة اشتقاق — تصدير gates هنا هو ما يجعل إعادة الاشتقاق ممكنة
    // فعلياً من طبقة أعلى، لا مجرّد وعد بها.
    gates,
  };
}

module.exports = {
  computeCategoryStates,
  // مُصدَّرة (لا _internal) — buildV7Payload.js (applyV7Adjustments)
  // تستهلكها مباشرة لإعادة اشتقاق overall بعد تعديل categories[]. راجع
  // تعليق الدالّة نفسها لسبب هذا التصدير (إصلاح عطب هذه المهمّة).
  deriveOverallFromCategories,
  CATEGORY_WEIGHTS,
  OVERALL_COVERAGE_GATE,
  BATTERY_MAX_BAND_DROP,
  PATCH_AGE_MAX_MONTHS,
  formatPatchAgeSource,
  parsePatchAgeMonths,
  GATE_NOTE_CATEGORY_ALREADY_WORSE,
  GATE_NOTE_OVERALL_ALREADY_WORSE,
  LETTER_ORDER,
  LETTER_BY_RANK,
  ALLOWED_PARAM_KEYS,
  CATEGORY_STATE_VALUES,
  // للاختبار فقط
  _internal: {
    computeCategoryFromTests, computeBatteryCategory, computeGates,
    computeHealthBearingStats, computeLowCategoryCoverageGate,
    applyCeilings, applyOverallCeilings, buildAllTestResults, buildDeterministicIssues,
    validateParamKeys, harnessErrorCategoryEntry, buildHarnessErrorCategoryStates,
    // أمر 2026-09-23 +03 (القرار ب — INPUT_ABSENT) — للاختبار المباشر
    // بالقيم الستّ كلّها (القاعدة 30)، بلا حاجة لبناء functionalResults كاملة.
    classifySec04RootDetected,
    // S3 (أمر مستخدم 2026-10-01 +03) — للاختبار المباشر بقيم غير معروفة
    // أيضاً (القاعدة 30).
    harnessErrorDisplayMessage, HARNESS_ERROR_MESSAGE_AR,
  },
};
