// ===================================================
// buildDisplayShapeV7 — طبقة التحويل V7 → شكل العرض (P1.5 البند ١،
// PLAN-01-ROADMAP.md §🔒 قرارات شكل الاستجابة، القرارات ١-١٦؛ ونصّ
// P1.5 نفسه — النصوص الإلزامية لعرض البطارية)
// ===================================================
//
// العطب الذي يُصلحه هذا الملف (نصّ أمر المهمّة 2026-09-21 +03 حرفياً):
// "runAnalysisInternal.js:402-536 يبني aiResult من aiAnalysis.grade ·
// .overallScore · .score · .issues · .category_scores — حقول V6 حصراً،
// ومخطَّط V7 يمنعها صراحةً (FORBIDDEN_TOP_LEVEL_KEYS في reportShapeV7.js).
// فالتبديل بلا طبقة تحويل يُسقط كل فحص في grade="C" · score=50 ·
// issues=[]." هذا الملف هو تلك الطبقة — مُستقلّة، قابلة للاختبار بلا
// استدعاء نموذج، ولا تُستهلَك بعد من المسار الحيّ (راجع تقرير المهمّة
// تحت "الفرق بين ما أُمرت به وما فعلت" لسبب عدم الوصل الكامل في
// runAnalysisInternal.js اليوم).
//
// ─── ترتيب التركيب المُلزِم (الاستدعاء من طبقة أعلى) ─────────────────────
//   1. computeFindings(fingerprint)                          → findings
//   2. computeCategoryStates({...})                          → categoryStatesRaw
//   3. applyV7Adjustments(categoryStatesRaw, aiAnalysis.adjustments)
//                                                             → categoryStatesAdjusted
//   4. buildDisplayShapeV7({categoryStates: categoryStatesAdjusted,
//                           findings, aiAnalysis, language})  → {display, audit}
// هذا الملف يبدأ من الخطوة ٤ فقط — لا يستدعي applyV7Adjustments داخلياً
// (مسؤولية واحدة: تنسيق العرض النهائي، لا تطبيق تعديلات النموذج. ذلك
// buildV7Payload.js/applyV7Adjustments، مُختبَر ومُنجَز مسبقاً).
//
// ─── القرارات المُطبَّقة هنا حرفياً (PLAN-01-ROADMAP.md §🔒) ─────────────
//   ١  overall.letter حاضر دائماً؛ overall.partialAssessmentTag يحمل الرقم
//      حين التغطية < 0.6. لا حالة "بلا حرف" للدرجة العامة.
//   ٢  كل فئة تحمل .state و.reason (سبب الامتناع، لا حذف صامت).
//   ٣  البطارية: .letter هنا هو أحد الدرجات الوصفية الثلاث (سليمة/مؤشّرات
//      تقادم/تقادم واضح) — **ليس A-D** — بجوار .confidence. لا نسبة مئوية.
//   ٤  llmSuggestedLetter/adjustments/disputed تصل audit فقط، لا display.
//   ٥  كسر نظيف: صفر حقل من grade/score/issues (V6) في المخرَج — بناءً،
//      لا حذفاً بعد التوليد.
//   ٦  measuredCategoriesMean في audit فقط. المعروض: الحرف·التغطية·سبب
//      البوّابة (overall.governingGateReason، null إن لم تُطلَق بوّابة).
//   ٧  صفر فئة MEASURED → overall.letter=null + zeroMeasuredMessage +
//      abstentionReasons[] (سبب كل فئة لم تُنتج حرفاً).
//   ١٠ overall.coverage = نفس تعريف categoryStates.js القرار ١٠ حرفياً
//      (تمريرة مباشرة، لا إعادة حساب).
//   ١١ partialAssessmentTag لا يُلغى بـnoDataAtAll (تمريرة مباشرة من
//      categoryStates.js — القرار مُطبَّق هناك أصلاً).
//   ١٢ HARNESS_ERROR → overall.coverage=null (تمريرة مباشرة).
//   ١٦ overall.letterSource حاضر دائماً ("BAND"|"GATE:<name>"|"NO_DATA"|
//      "HARNESS_ERROR")؛ overall.governingGateReason يشرحها بلا استنتاج.
//
// ─── فرق موثَّق عن نصّ الخطّة الحرفي (قاعدة 15 — نفّذ الصحيح ثم أبلغ) ────
// P1.5 (§تعديل 2026-09-20) يقول "مؤشّرات البطارية تُعرض مع مستوى الشحن
// الذي قيست عنده" — و٤-ج يقول "كلّها تُسجَّل مع socAtStart" (لكل مؤشّر).
// **batteryLayer.js لا يُنتج socAtStart لكل مؤشّر فعلياً** — computeBatThermalEff/
// computeBatRApparent/computeBatFcc/computeBatCoulomb (batteryLayer.js) لا
// تحمل هذا الحقل في أي منها (تحقّق مباشر: لا "socAtStart" في الملف كله).
// البديل المُنفَّذ هنا: مستوى شحن واحد على مستوى الفحص كلّه (findings.
// battery.socAtStart/socAtEnd، موجودان فعلياً) يُرفَق بفئة البطارية —
// لا مستوى لكل مؤشّر على حدة. يُذكر بارزاً في تقرير المهمّة.
//
// ⚠️ تحديث 2026-09-22 +03 (مهمّة لاحقة) — الفقرة أعلاه لم تعد دقيقة، مُبقاة
// بلا حذف (القاعدة 8). batteryLayer.js يُنتج الآن socAtWindowStart/
// socAtWindowEnd **على كل مؤشّر من الأربعة** (خام من lvl[]، بلا تحويل —
// القاعدة 20) — لكن كنطاق (نافذة العيّنات المُستعملة فعلاً)، لا نقطة
// "socAtStart" مفردة كما ورد حرفياً في P1.5/٤-ج: تحقّق مباشر (راجع تعليق
// رأس batteryLayer.js وتقرير تلك المهمّة) أظهر أن **لا مؤشّر من الأربعة
// نقطة عيّنة واحدة** — BAT-THERMAL-EFF/BAT-COULOMB نافذتاهما الفحص كاملاً
// (0..n-1، مطابقتان لبعضهما حرفياً)، BAT-R-APPARENT/BAT-FCC نافذتاهما أضيق
// فعلياً ومختلفة عن بعضهما. نطاق (`socAtWindowStart`→`socAtWindowEnd`) هو
// ما يصف الواقع دون اختراع نقطة. هذا الملفّ (`buildDisplayShapeV7.js`)
// **لم يتغيّر** — `out.indicators = entry.batteryIndicators || null;`
// (buildCategoryDisplay أدناه) تمريرة كاملة بالمرجع أصلاً، فالحقلان
// الجديدان يصلان `display`/التخزين/التطبيق تلقائياً بلا أي تعديل هنا (نفس
// السبب الذي يُبقي `categories.battery.indicators` مُعلَناً OPAQUE في
// v7ContractFieldMap.js — راجع docs/V7_DISPLAY_SHAPE_CONTRACT.md §٣ للتفصيل
// الكامل حقلاً حقلاً بحسب المؤشّر).
// ===================================================

'use strict';

const {CATEGORIES} = require('../utils/categories');
const {BUYER_ADVICE_PROFILES} = require('./reportShapeV7');
const {V7_PIPELINE_TAG} = require('./pipelineTags');
// S-2 (أمر مستخدم 2026-10-01 +03، ملحق S-2) — عتبة PATCH_AGE مصدرها الوحيد
// categoryStates.js (القاعدة 24) — لا رقم 36 حرفي هنا، يقرأه نصّ العرض فقط.
const {PATCH_AGE_MAX_MONTHS} = require('./categoryStates');

// PIPELINE_TAG يبقى مُصدَّراً بهذا الاسم (buildDisplayShapeV7.test.js
// يستورده به) — لكن مشتقّاً من pipelineTags.js (مصدر الحقيقة الوحيد)، لا
// حرفياً منفصلاً قد ينجرف عنه. هذا الثابت يكتب aiResponse.pipeline (حقل
// متداخل داخل شكل العرض) — لا report.pipeline (الحقل الجذر الذي يقرؤه
// verifyReport.js، وسلسلته موثَّقة في pipelineTags.js).
const PIPELINE_TAG = V7_PIPELINE_TAG;

/**
 * القرار ٢٤ (PLAN-01-ROADMAP.md §🔒 "٢٤ · buyerAdvice يعود ثلاثة حقول") —
 * narrative.buyerAdvice لم يعد نصّاً واحداً بل {casual, gamer, photographer}،
 * كلّها من النموذج ومحكومة بالحارس (reportShapeV7.js) كغيرها. العقد القديم
 * (نصّ واحد) كان فقدان وظيفة لا إعادة تسمية — تُبنى هنا حقلاً حقلاً، لا
 * تمريرة كائن كاملة، كي لا يتسرّب مفتاح زائد كتبه النموذج بالخطأ.
 * @param {*} buyerAdvice aiAnalysis.narrative.buyerAdvice كما وصل (غير موثوق)
 * @return {{casual: (string|null), gamer: (string|null), photographer: (string|null)}}
 */
function buildBuyerAdviceDisplay(buyerAdvice) {
  const src = (buyerAdvice && typeof buyerAdvice === 'object' && !Array.isArray(buyerAdvice)) ? buyerAdvice : {};
  const out = {};
  for (const profile of BUYER_ADVICE_PROFILES) {
    out[profile] = typeof src[profile] === 'string' ? src[profile] : null;
  }
  return out;
}

/**
 * سبب امتناع فئة واحدة عن إنتاج حرف — مُشتقّ حصراً من حقول موجودة فعلاً في
 * categoryStates.js (declaredCount/executedCount/state/reason/noLetterReason)،
 * لا نصّ جديد يُخترَع. **افتراض تصميم غير منصوص حرفياً في PLAN-01** (رمز
 * التوكِن ذاته) — مذكور في تقرير المهمّة تحت "افتراضات" (القاعدة 13).
 * @param {Object} entry عنصر فئة واحدة من categoryStates.categories
 * @return {string|null} رمز السبب، أو null إن كانت الفئة أنتجت حرفاً فعلاً
 */
function categoryAbsenceReason(entry) {
  if (!entry) return null;
  if (entry.state === 'HARNESS_ERROR') return entry.reason || 'HARNESS_ERROR';
  if (entry.category === 'battery') {
    if (entry.deterministicLetter !== null) return null; // أنتجت درجة فعلاً
    return entry.noLetterReason || entry.reason || 'NO_BATTERY_INDICATORS_MEASURED';
  }
  if (entry.deterministicLetter !== null) return null; // MEASURED أو PARTIAL بحرف — لا امتناع
  if (entry.state === 'ATTESTED_ONLY') return 'MANUAL_ATTESTATION_ONLY';
  if (entry.state === 'UNMEASURED') {
    return entry.declaredCount === 0 ?
        'NO_HEALTH_BEARING_TESTS_DECLARED' : 'DECLARED_BUT_NONE_EXECUTED';
  }
  return null;
}

// ─── letterCeilingReason — أمر المهمّة 2026-09-22 +03 (البند الثاني)
// ─────────────────────────────────────────────────────────────────────────
// حقل جديد على شكل الفئة في display — **مُميَّز عمداً عن `reason` أعلاه**:
// `reason` (categoryAbsenceReason) سبب *امتناع* الفئة عن إنتاج حرف أصلاً
// (UNMEASURED/ATTESTED_ONLY/HARNESS_ERROR — لا letter). هذا الحقل سبب
// *تسقيف* حرف **أُنتِج فعلاً** (الفئة PARTIAL أو MEASURED، letter موجود،
// لكن بوّابة مسمّاة أنزلته). الحالتان لا تتداخلان أبداً على نفس الفئة —
// letter موجود فيُسقَّف (هذا الحقل)، أو غائب فيُذكر سبب غيابه (`reason`)،
// لا كلاهما معاً (مُختبَر بقيمتين حقيقيتين متعاكستين لا افتراضاً — راجع
// buildDisplayShapeV7.test.js).
//
// ⚠️ **نطاق هذه المهمّة صراحة — لا تعميم غير مطلوب (القاعدة 13):** يقتصر
// اليوم على بوّابة LOW_CATEGORY_COVERAGE وحدها — هي موضوع أمر المهمّة
// بالكامل ("الشرط الأوّل"). فئة أخرى قد يُسقِّف حرفها فعلياً بوّابة مختلفة
// (ROOT_DETECTED/PATCH_AGE على security مثلاً، لو لم تكن أصلاً D بقاعدة
// STATE_FAIL_FLOOR كما هي على كل فحص حقيقي متاح اليوم) — **لا تُنتج نصّ
// عرض هنا**، الحقل يبقى `null` حتى لو كانت هي الحاكمة فعلياً. هذا قيد
// نطاق موثَّق لا سهو: `audit.gatesApplied` (عبر `overall`، تمريرة كل
// البوّابات بلا استثناء) يحمل نصّها التقني (`source`) دائماً بصرف النظر
// عن هذا القيد — لا معلومة تُفقَد، فقط لا نصّ بشري لها بعد.

// جدول أعداد عربية لاسم "اختبار" (مذكَّر) — صيغتان: withNoun (أوّل ذِكر،
// "اختباران"/"ثلاثة اختبارات") وbare (ذِكر ثانٍ بعد "من"، يطابق قطبية
// المذكَّر: "خمسة"/"ثلاثة عشر"). **افتراض تصميم غير منصوص حرفياً في أمر
// المهمّة** (القاعدة 13): 0-20 مبنيّة يدوياً (يغطّي أقصى declaredCount
// حقيقي مُتحقَّق منه في هذا المستودع — sensors=12، راجع تقرير المهمّة)،
// وما فوقها يسقط إلى رقم خام (`"21 اختباراً"`/`"21"`) بدل قواعد نحوية
// أعقد (جمع مؤنث سالم/تمييز منصوب لصيغ 21+) — دقّة كافية لعدد اختبارات لا
// يُتوقَّع أن يتجاوز هذا المدى فعلياً على أي فئة اليوم.
const ARABIC_TEST_COUNT_WORDS = [
  {withNoun: 'لا اختبار', bare: 'صفر'},
  {withNoun: 'اختبار واحد', bare: 'واحد'},
  {withNoun: 'اختباران', bare: 'اثنين'},
  {withNoun: 'ثلاثة اختبارات', bare: 'ثلاثة'},
  {withNoun: 'أربعة اختبارات', bare: 'أربعة'},
  {withNoun: 'خمسة اختبارات', bare: 'خمسة'},
  {withNoun: 'ستة اختبارات', bare: 'ستة'},
  {withNoun: 'سبعة اختبارات', bare: 'سبعة'},
  {withNoun: 'ثمانية اختبارات', bare: 'ثمانية'},
  {withNoun: 'تسعة اختبارات', bare: 'تسعة'},
  {withNoun: 'عشرة اختبارات', bare: 'عشرة'},
  {withNoun: 'أحد عشر اختباراً', bare: 'أحد عشر'},
  {withNoun: 'اثنا عشر اختباراً', bare: 'اثني عشر'},
  {withNoun: 'ثلاثة عشر اختباراً', bare: 'ثلاثة عشر'},
  {withNoun: 'أربعة عشر اختباراً', bare: 'أربعة عشر'},
  {withNoun: 'خمسة عشر اختباراً', bare: 'خمسة عشر'},
  {withNoun: 'ستة عشر اختباراً', bare: 'ستة عشر'},
  {withNoun: 'سبعة عشر اختباراً', bare: 'سبعة عشر'},
  {withNoun: 'ثمانية عشر اختباراً', bare: 'ثمانية عشر'},
  {withNoun: 'تسعة عشر اختباراً', bare: 'تسعة عشر'},
  {withNoun: 'عشرون اختباراً', bare: 'عشرين'},
];

function arabicTestCount(n) {
  if (Number.isInteger(n) && n >= 0 && n < ARABIC_TEST_COUNT_WORDS.length) return ARABIC_TEST_COUNT_WORDS[n];
  return {withNoun: `${n} اختباراً`, bare: `${n}`};
}

// ~~جملة "كلّها/كلاهما/وهو اختبار(ات) تعريف لا أداء" — مبنيّة من عدد
// المُنفَّذ الفعلي، لا نصّاً ثابتاً (نصّ أمر مهمّة سابقة: "لا قالباً ثابتاً
// يكذب على فئة أخرى"). `joined=true` تضيف واو العطف (تُستعمَل بعد فاصلة
// تكملةً لجملة "تغطية منخفضة —" السابقة)؛ `joined=false` جملة مستقلّة.~~
//
// **أُعيدت صياغتها 2026-09-24 +03 (القرار ٧٥، البند ١)** — النصّ أعلاه
// (مُبقًى موسوماً، القاعدة 8) كان صادقاً في عدده (يتغيّر بعدد المُنفَّذ)
// لكن كاذباً في *نوعه*: يدّعي أن كل اختبار غير مُصنَّف MEASUREMENT هو فعلاً
// "تعريف لا أداء" (SPEC/STATE بمعنى القياس الثابت). هذا ادّعاء نوع لم
// يعتمده الكود لكل معرّف على حدة — `kindOf()` (testKinds.js:83-90) يُسقِط
// ~73 من 85 معرّفاً إلى `KIND.STATE` بتعليقها الحرفي الخاصّ:
// "الافتراض العريض — انظر تعليق أعلى الملفّ" (testKinds.js:89)، والتعليق
// المُشار إليه (testKinds.js:34-37) يصفه صراحةً "افتراض عريض غير مُتحقَّق
// لكل معرّف على حدة". جدول تصنيف خارجي (test_kind_table.py، خارج هذا
// المستودع، مصدره في تقرير المهمّة) يُصنِّف `SN-01..05`/`S-03`/`S-06` —
// كلّها STATE هنا حالياً — MEASUREMENT فعلياً؛ S-03 حرارة الفخّ الذهبي
// نفسه تحمل 188 MB/s (قيمة أداء حقيقية، لا تعريفاً). فادّعاء "تعريف لا
// أداء" على فئة تشمل S-03 كاذب فعلياً، لا حافة نظرية.
//
// ~~النصّ الجديد لا يدّعي نوع الاختبار إطلاقاً — يصف حالة الكود اليوم فقط
// (لا واحد من اختبارات هذه الفئة مُعتمَد MEASUREMENT لحساب الحرف)~~ — **هذا
// خطأ صياغة، مُصحَّح 2026-09-24 +03 (القرار ٧٩ البند ب، الجولة الثانية،
// نصّ المستخدم حرفياً): "النصّ الحالي … يقول إن أيّاً من اختبارات الفئة لم
// يُعتمد قياساً. وهذا كاذب في gpu، لأن الكود يعتمد G-03..05 قياساً وهي لم
// تُقَس. وكاذب في storage، لأن الكود يعتمد S-04/S-05 قياساً وهي معطّلة."
//
// السبب دقيقاً: `computeLowCategoryCoverageGate` (categoryStates.js:488)
// يحسب `allNonMeasurement = executed.every(r => r.kind !== KIND.MEASUREMENT)`
// — على مجموعة **المُنفَّذ فعلياً** هذا الفحص وحده، لا على كل اختبارات
// الفئة المُعرَّفة. `kindOf()` (testKinds.js) يعتمد G-03..05 (gpu) و
// S-04/S-05 (storage) MEASUREMENT فعلاً (`CLAIM_TO_MEASUREMENT_PENDING_P2`/
// `UNSTABLE_IDS`) — لكنها هنا NOT_TESTED/معطّلة، فغابت عن `executed`، فبقي
// الشرط صحيحاً رغم اعتماد الكود لها نوعاً. فـ"لم يُعتمد" ادّعاء عن *النوع*
// (خاطئ)، والصحيح ادّعاء عن *القياس الفعلي* (صحيح دائماً بحكم تعريف
// الشرط نفسه) — النصّ الجديد ينقل شرط البوّابة حرفياً بلا زيادة: لا واحد
// من الاختبارات **المُعتمَدة قياساً** (MEASUREMENT) **قِيس فعلياً** في هذه
// الفئة هذا الفحص.
//
// الجزء العددي الصادق (execOfDecl، مبنيّ من arabicTestCount) لا يتغيّر —
// القيد الصريح: "لا يتغيّر أيّ حرف" (مُثبَت بالأداة، compare-v7-golden-letters.js).
// `joined=true` تضيف واو العطف (تُستعمَل بعد فاصلة تكملةً لجملة "تغطية
// منخفضة —" السابقة)؛ `joined=false` جملة مستقلّة.
// **أُعيدت صياغتها مجدَّداً 2026-10-01 +03 (S4، أمر مستخدم)** — النصّ أعلاه
// ("لم يُقَس... أيّ اختبار معتمد قياساً للحالة") مُبقًى موسوماً فوقه
// (القاعدة 8) لا محذوفاً. النصّ الجديد بنصّ الأمر حرفياً: "أعلى حرف لهذه
// الفئة B في هذا الإصدار: اختباراتها تتأكّد من وجود المكوّنات وعملها، ولا
// تقيس أداءها بعد." — بلا عبارة "معتمد قياساً للحالة" (طُلب حذفها صراحة).
// `letter` مُستقدَم من `hit.ceilingLetter` (LOW_CATEGORY_COVERAGE دائماً
// 'B' اليوم — categoryStates.js:497,515 — لا حرف حرفي ثانٍ هنا، القاعدة
// 24 بامتدادها) لا "B" مكتوبة يدوياً.
function nonMeasurementSubjectClause(joined, letter) {
  const wa = joined ? 'و' : '';
  return `${wa}أعلى حرف لهذه الفئة ${letter || '؟'} في هذا الإصدار: اختباراتها تتأكّد ` +
      'من وجود المكوّنات وعملها، ولا تقيس أداءها بعد.';
}

/**
 * نصّ العرض البشري لبوّابة LOW_CATEGORY_COVERAGE — مبنيّ من القيم الفعلية
 * (executedCount/declaredCount لهذه الفئة بالذات + belowThreshold/
 * allNonMeasurement من computeLowCategoryCoverageGate نفسها، القاعدة 24:
 * لا إعادة حساب مستقلّة هنا). ثلاث حالات ممكنة (OR صريح بنصّ categoryStates.js):
 *   (أ) تغطية دون العتبة فقط → "تغطية منخفضة — X من Y"
 *   (ب) allNonMeasurement فقط (تغطية كافية عددياً) → "X من Y — حرف مسقوف: ..."
 *   (ج) الاثنان معاً → "تغطية منخفضة — X من Y، وحرف مسقوف: ..."
 * الحالة (ب) **الأشيع فعلياً** على البيانات الحقيقية المتاحة (7 من 9 فئات
 * مُسقَّفة على b45c8cf6/34dff2b8 — راجع تقرير المهمّة)، لا حافة نادرة.
 * (تحديث 2026-09-24 +03، القرار ٧٥ البند ١: العبارة اللاحقة على "X من Y"
 * أُعيدت صياغتها — راجع تعليق nonMeasurementSubjectClause أعلاه — لا تغيير
 * على العدد نفسه ولا على أيّ letter، مُثبَت بالأداة compare-v7-golden-letters.js.)
 * @param {number} executedCount
 * @param {number} declaredCount
 * @param {boolean} belowThreshold
 * @param {boolean} allNonMeasurement
 * @param {string|null} ceilingLetter S4 (أمر مستخدم 2026-10-01 +03) — حرف
 *   السقف الفعلي (hit.ceilingLetter، 'B' دائماً اليوم) يُستشهَد به حرفياً
 *   في نصّ nonMeasurementSubjectClause الجديد — لا يتغيّر العدد
 *   (execOfDecl) ولا صيغة "تغطية منخفضة —" (نصّ الأمر: "كما هي اليوم").
 * @return {string}
 */
function buildLowCoverageCeilingDisplayText(executedCount, declaredCount, belowThreshold, allNonMeasurement, ceilingLetter) {
  const execOfDecl = `${arabicTestCount(executedCount).withNoun} من ${arabicTestCount(declaredCount).bare}`;
  if (belowThreshold && allNonMeasurement) {
    return `تغطية منخفضة — ${execOfDecl}، ${nonMeasurementSubjectClause(true, ceilingLetter)}`;
  }
  if (belowThreshold) {
    return `تغطية منخفضة — ${execOfDecl}`;
  }
  // allNonMeasurement فقط — التغطية عددياً كافية (≥ العتبة) لكن لا واحد من
  // اختبارات الفئة مُعتمَد MEASUREMENT بعد — لا بادئة "تغطية منخفضة" هنا
  // (ستكون غير صحيحة: التغطية ليست منخفضة).
  return `${execOfDecl} — ${nonMeasurementSubjectClause(false, ceilingLetter)}`;
}

/**
 * سبب تسقيف حرف الفئة — راجع تعليق الكتلة أعلاه لنطاق هذه الدالّة
 * (LOW_CATEGORY_COVERAGE فقط) وتمييزها عن categoryAbsenceReason.
 * يبحث عن بوّابة LOW_CATEGORY_COVERAGE **الفعلية التسقيف** لهذه الفئة —
 * `status==='FIRED'` وحدها لا تكفي (قد تُطلَق ولا تُسقِّف شيئاً، كما يقع
 * فعلياً على security في b45c8cf6: STATE_FAIL_FLOOR ينزلها D قبل أي
 * بوّابة، فالبوّابة تُطلَق لكن `cappedThisLetter=false` — لا أثر، فلا نصّ).
 * @param {Object} entry عنصر فئة من categoryStates.categories (بعد applyCeilings)
 * @return {{name: string, ceilingLetter: string, text: string}|null}
 */
function buildCategoryLetterCeilingReason(entry) {
  if (!entry) return null;
  const applied = Array.isArray(entry.gatesApplied) ? entry.gatesApplied : [];
  const hit = applied.find((g) => g && g.name === 'LOW_CATEGORY_COVERAGE' &&
      g.status === 'FIRED' && g.cappedThisLetter === true);
  if (!hit) return null;
  return {
    name: hit.name,
    ceilingLetter: hit.ceilingLetter,
    text: buildLowCoverageCeilingDisplayText(
        entry.executedCount, entry.declaredCount, hit.belowThreshold, hit.allNonMeasurement, hit.ceilingLetter),
  };
}

/**
 * شكل فئة واحدة في العرض — القرار ٢ (state+reason دائماً) والقرار ٣
 * (البطارية: ثلاث درجات + ثقة، لا نسبة).
 * @param {Object} entry عنصر فئة من categoryStates.categories
 * @return {Object}
 */
function buildCategoryDisplay(entry) {
  // القرار ٤٢ البند ٣ — letter يُعرض من finalLetter (الحرف المُستعمَل فعلاً
  // في الاشتقاق/العرض بعد أي تعديل نموذج مقبول)، لا deterministicLetter
  // (ذاك يبقى ما قاله القياس وحده — audit فقط عبر buildV7Payload.js/A62).
  // finalLetter حاضر دائماً منذ categoryStates.js (خط أساس = deterministicLetter
  // عند البناء) — لا احتياط `??` مطلوب، لكنه يبقى دفاعاً في العمق لقارئ لم
  // يمرّ بعد بمسار categoryStates.js المُحدَّث (مثلاً بيانات مصنَّعة يدوياً
  // في اختبار قديم).
  const finalLetter = (typeof entry.finalLetter !== 'undefined') ? entry.finalLetter : entry.deterministicLetter;
  const llmAdjusted = !!entry.adjustmentApplied;
  const out = {
    state: entry.state,
    letter: finalLetter,
    // letterSource/adjustmentReason/adjustmentEvidence — القرار ٤٢ البند ٣:
    // "letterSource للفئة... ومعه السبب ومرجع الدليل". شكل جديد على display
    // (القرار ٢٥) — القرّاء المُحدَّثون معه: buildCategoryEntryForStorage
    // (analyzeDevice.js) و verifyReportV7Whitelist (تمريرة categories، لا
    // تعديل مطلوب هناك — راجع تقرير المهمّة).
    letterSource: llmAdjusted ? 'LLM_ADJUSTED' : 'DETERMINISTIC',
    adjustmentReason: llmAdjusted ? (entry.adjustmentReason || null) : null,
    adjustmentEvidence: llmAdjusted && Array.isArray(entry.adjustmentEvidence) ? entry.adjustmentEvidence : null,
    coverage: typeof entry.coverage === 'number' ? entry.coverage : null,
    reason: categoryAbsenceReason(entry),
    // letterCeilingReason — أمر المهمّة 2026-09-22 +03 (البند الثاني)،
    // راجع تعليق buildCategoryLetterCeilingReason أعلاه للنطاق والتمييز
    // عن `reason`. حاضر دائماً كمفتاح (القاعدة 22) — القيمة null حين لا
    // بوّابة LOW_CATEGORY_COVERAGE أسقفت letter هذه الفئة فعلياً.
    letterCeilingReason: buildCategoryLetterCeilingReason(entry),
    testIds: Array.isArray(entry.testIds) ? entry.testIds : [],
  };
  if (entry.category === 'battery') {
    // القرار ٣: ثقة + درجة وصفية، لا رقم مئوي. indicators تحمل قيماً
    // حقيقية بوحداتها (°C/Wh، mΩ، mAh) — ليست "نسبة مئوية للصحّة"، فلا
    // تخالف "لا رقم مئوي إطلاقاً" (ذلك يخصّ الاختزال إلى درجة صحّة من 100،
    // لا القيم الفيزيائية الداعمة للحكم).
    out.confidence = entry.confidence || null;
    out.tag = entry.tag || null; // 'ESTIMATED' — P1.2 §تعديل 2026-09-20
    out.indicators = entry.batteryIndicators || null;
  }
  return out;
}

/**
 * قائمة أسباب الامتناع لكل فئة لم تُنتج حرفاً — القرار ٧ ("قائمة أسباب
 * الامتناع لكل فئة")، تُبنى فقط حين overall بأكمله بلا حرف (zeroMeasuredMessage).
 * @param {Object} categories خارطة الفئات {category: entry}
 * @return {Array<{category: string, reason: string}>}
 */
function buildAbstentionReasons(categories) {
  const out = [];
  for (const cat of CATEGORIES) {
    const entry = categories[cat];
    if (!entry || entry.deterministicLetter !== null) continue;
    out.push({category: cat, reason: categoryAbsenceReason(entry) || entry.state});
  }
  return out;
}

/**
 * القرار ١٦ — "letterSource هو ما يجعل سبب البوّابة قابلاً للعرض بلا
 * استنتاج". يبحث عن عنصر gatesApplied الذي اسمه يطابق الجزء بعد "GATE:"
 * في letterSource، ويكون هو الحاكم فعلاً (cappedOverall أو cappedThisLetter
 * — الأخيرة لسقف البطارية BATTERY_MAX_ONE_BAND الذي لا يحمل .name ضمن
 * gates[] العادية؛ راجع categoryStates.js:555 حيث batteryCapped يُدفَع
 * إلى overallGatesApplied بنفس البنية {name, from, to} بلا cappedOverall).
 *
 * ⚠️ **عطب مُصلَح هنا (أمر مستخدم 2026-09-30 +03، النقطة ١ — فحص NC-TM7PDN)**:
 * كان الكود يختار **أوّل** عنصر بالاسم نفسه (`applied.find((g) => g.name
 * === name)`) بصرف النظر عن `cappedOverall` — والاسم وحده لا يميّز، لأن
 * LOW_CATEGORY_COVERAGE تتكرّر مرّة واحدة **لكل فئة** بالاسم نفسه
 * (computeLowCategoryCoverageGate، categoryStates.js:497/515: `name:
 * 'LOW_CATEGORY_COVERAGE', category, ...` — category يميّز، لا name). على
 * NC-TM7PDN: gatesApplied[5] (thermal، INPUT_ABSENT، بلا أثر) يسبق
 * gatesApplied[7] (gpu، FIRED، cappedOverall=true فعلاً) — فكان `.find()`
 * يُرجع نصّ thermal ("لا اختبار مُنفَّذ...") بدل gpu الحاكم فعلاً. المعيار
 * الصحيح: البوّابة التي أسقفت الحرف العامّ فعلاً (`cappedOverall===true`)
 * — لا ترتيب الظهور في المصفوفة.
 *
 * **استثناء واحد موثَّق**: سقف البطارية BATTERY_MAX_ONE_BAND لا يحمل حقل
 * `cappedOverall` إطلاقاً (بنية `{name, from, to}` فقط، categoryStates.js
 * :812) — لكن `applyOverallCeilings` (التي تُنتج كل عنصر آخر) تكتب
 * `cappedOverall` بوليانياً صريحاً دائماً (categoryStates.js:410/415/418،
 * `Object.assign` في كل فرع) فلا عنصر "عادي" يفتقد الحقل فعلياً — وbatteryCapped
 * نفسه لا يُدفَع إلى القائمة (categoryStates.js:853-854) إلا حين أسقف فعلاً
 * (categoryStates.js:811 `if (capped !== rank)`)، فحضوره وحده إثبات كافٍ.
 *
 * **لماذا `.find()` (أوّل مطابقة) آمن هنا رغم عطب مشابه في الأصل**: أثبتُّ
 * (ولم أبنِ فرعاً افتراضياً بلا إثبات) أن أكثر من عنصر بالاسم نفسه لا يمكن
 * أن يحمل `cappedOverall===true` معاً بهذا الكود تحديداً — `applyOverallCeilings`
 * (categoryStates.js:408-419) تُعلِّم `cappedOverall:true` فقط حين
 * `ceilingRank(g) > rank` **الصارم**، ثم تُحدِّث `rank=ceilingRank(g)` فوراً.
 * الاسم الوحيد المتكرّر أصلاً هو LOW_CATEGORY_COVERAGE (مرّة لكل فئة)، وسقفه
 * ثابت 'B' لكل نسخة (categoryStates.js:497 و:515) — فأيّ نسخة ثانية منه تجد
 * `ceilingRank('B') > rank` **بعد أن صار `rank` مساوياً `ceilingRank('B')`
 * بالضبط** من النسخة الأولى الحاكمة، فتُعلَّم `false` حتماً. البوّابات
 * الأخرى (ROOT_DETECTED/PATCH_AGE/BATTERY_MAX_ONE_BAND) عنصر واحد لكلٍّ لا
 * يتكرّر أصلاً. فـ0 أو 1 مطابقة فقط ممكنان لأيّ اسم، أبداً أكثر من 1.
 *
 * **0 مطابقة رغم letterSource يسمّي بوّابة — حالة غير محسومة**: لا تُختار
 * بقيمة افتراضية (القاعدة 22). **مُتحقَّق أنها غير واقعة اليوم بحكم البناء
 * أيضاً**: `letterSource` لا يصير `GATE:<name>` إلا حين وجدت
 * `deriveOverallFromCategories` (categoryStates.js:830-832) عنصراً فعلياً
 * بـ`cappedOverall===true` وسمّته `lastEffectiveName` — فوجود مطابقة واحدة
 * على الأقلّ مضمون بالبناء أيضاً؛ هذا حارس دفاعي محض لعطب مستقبلي (تعارض
 * بين letterSource وgatesApplied)، لا مساراً حيّاً اليوم.
 *
 * **القرار (تصحيح المستخدم 2026-09-30 +03، البند ٦، فوق مسوَّدة سابقة كانت
 * تَرمي هنا)**: "لا يُرمى استثناء. تُكتب حالة صريحة، مثل status «UNMATCHED»
 * وsource null، ويبقى التقرير حيّاً، وتُسجَّل في السجلّ." التنفيذ: شكل
 * *إضافي* غير الشكل الطبيعي الثلاثي الحقول ({name,ceilingLetter,source}) —
 * أربعة حقول ({name,ceilingLetter:null,source:null,status:'UNMATCHED'}) — لا
 * يمسّ الشكل الطبيعي (المطابق دائماً، الحالة الوحيدة المُختبَرة بعيّنات
 * حقيقية/ذهبية اليوم). **مُعدَّد في العقد**: v7ContractFieldMap.js
 * `GOVERNING_GATE_REASON_UNMATCHED_FIELDS` (شكل توثيقي — لا فِخّ ذهبي
 * يُمارسه اليوم، الحالة غير واقعة بحكم البناء أعلاه؛ مُختبَر مباشرة أدناه
 * وفي buildDisplayShapeV7.test.js عبر كسر مُختلَق). **قرّاء `governingGateReason`
 * المُتحقَّق منهم في هذا المستودع**: `verifyReport.js:324` (`pickOverall`
 * تمريرة عمياء بلا فحص شكل داخلي — غير متأثّرة)، مولّدات `generate-v7-*
 * -sample*.js` (تمريرة أيضاً)، حارس `v7ContractFieldsGuard.test.js` (يفحص
 * عيّنة S10 الحقيقية فقط — GATE:ROOT_DETECTED، الشكل الطبيعي، لا يمارس
 * UNMATCHED فيتأثّر). **قرّاء التطبيق/الموقع خارج نطاقي — لم أتحقّق منهم
 * (راجع تقرير المهمّة).**
 * @param {Object} overall عنصر overall من categoryStates
 * @return {Object|null} {name, ceilingLetter, source} (طبيعي) أو
 *   {name, ceilingLetter: null, source: null, status: 'UNMATCHED'} (تعارض
 *   داخلي غير محسوم) أو null إن لم تُطلَق بوّابة أصلاً
 */
// ─── S1 — نصّ عرض عربي لكل بوّابة مسمّاة (أمر مستخدم 2026-10-01 +03) ──────
// «بطاقة السقف: لكل بوّابة جملة عربية للعرض في governingGateReason...
// ولا يُعرض الاسم... ولا المصدر... ويبقى الاسم والمصدر في البيانات
// للّوحة.» `name`/`source` الخامّان يبقيان حقلين كما هما بلا أي حذف —
// `text` حقل **إضافي** جديد على الشكل (قرار عقد، راجع v7ContractFieldMap.js
// GOVERNING_GATE_REASON_FIELDS وتقرير المهمّة). التطبيق/الموقع يعرضان
// `text` وحده لاحقاً (A1/W1) ولا يعرضان `name`/`source` — قرار عرض في
// طبقة العميل، لا حذف حقل هنا.
//
// أسماء البوّابات الست مصدرها الوحيد categoryStates.js:computeGates —
// لا قائمة ثانية هنا (القاعدة 24 بامتدادها على القيم الحرفية)؛ هذا الجدول
// *نصّ* لكل اسم، لا إعادة تعريف للاسم نفسه.
//
// ⚠️ STORAGE_VERIFY_ERRORS/GPU_HASH_MISMATCH (status='NOT_WIRED' دائماً
// اليوم) وSUSTAINED_CEILING (status='DISABLED' دائماً اليوم) — الثلاثة لا
// تصل status='FIRED' بالكود الحالي (categoryStates.js:344-347)، فلا تُطلق
// `hit` هنا فعلياً على أي عيّنة حقيقية أو ذهبية اليوم. نصوصها أدناه معدَّة
// مسبقاً "لليوم الذي تُوصَل فيه" (بنصّ أمر المهمّة: "عدّد كل بوّابة يمكن أن
// تصل") — **غير مُختبَرة بعيّنة فعلية**، مُسجَّل صراحةً في تقرير المهمّة.
//
// BATTERY_MAX_ONE_BAND شكل مختلف ({name, from, to} لا {name, ceilingLetter,
// status}) — يُحسِّن (يحدّ من انخفاض) لا يُسقِّف بالمعنى المعتاد؛ نصّه لا
// يستشهد بحرف بعينه لهذا السبب (راجع تعليق categoryStates.js:791-802).
// مصدر واحد مُصدَّر (القاعدة 24) لأسماء البوّابات الستّة المعروفة — نفس
// الأسماء حرفياً كأسماء `case` في التبديلة أدناه، لا نسخة مستقلّة. يستهلكه
// أداة فحص قواعد S5 (functions/scripts/check-s5-narrative-rules.js) للتحقّق
// الآلي من أن نثر النموذج لا يذكر اسم أي بوّابة (S5، أمر مستخدم 2026-10-01 +03).
const KNOWN_GATE_NAMES = Object.freeze([
  'ROOT_DETECTED', 'PATCH_AGE', 'LOW_CATEGORY_COVERAGE',
  'BATTERY_MAX_ONE_BAND', 'STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH', 'SUSTAINED_CEILING',
]);

// ─── نصوص S-1 إلى S-7 (قرار المستخدم، القسم ٥ من أمر «قرارات الملفّ
// PENDING-FOR-PLANNING»، 2026-10-01 +03، بنصّه حرفياً لكل بند) ────────────
// S-1 (ROOT_DETECTED): بلا "في هذا الإصدار" — ليست قيداً مؤقّتاً.
// S-2 (PATCH_AGE): الرقم من PATCH_AGE_MAX_MONTHS (categoryStates.js)، لا
//     حرفياً هنا (القاعدة 24). letter=${letter} لا "B" حرفياً — ceilingLetter
//     لهذه البوّابة ثابت 'B' في categoryStates.js:362/369/376 فعلاً، فالقيمتان
//     متطابقتان دائماً؛ الإبقاء على ${letter} يحافظ على مصدر واحد للحرف
//     (قرار تنفيذ، لا نصّ الأمر بالحرف).
// S-3 (LOW_CATEGORY_COVERAGE): **بلا تغيير** — "في هذا الإصدار" صادقة هنا
//     بنصّ القرار (حدّ إصدار حقيقي، لا قيد مؤقّت كالثلاثة الأخرى).
// S-4 (BATTERY_MAX_ONE_BAND): نصّ جديد يحلّ محلّ القديم بالكامل.
// S-5/S-6/S-7 (STORAGE_VERIFY_ERRORS/GPU_HASH_MISMATCH/SUSTAINED_CEILING،
//     خاملة — NOT_WIRED/DISABLED دائماً اليوم، categoryStates.js:370-376):
//     بلا "في هذا الإصدار".
// ⚠️ **تصحيح المستخدم 2026-10-01 +03 (بعد الالتزام الأصلي لهذه الجولة)**:
// S-6 كان "معالج الرسوميات" (نصّ الأمر الأوّل حرفياً) — صحّحه المستخدم إلى
// "معالج الرسومات" كاسم الفئة المعتمَد (CATEGORY_NAME_AR.gpu،
// utils/categories.js) — الاثنان متطابقان الآن، لا فرق مقصود. التزام
// تصحيحي منفصل بمسار صريح (لا تعديل على الالتزام الأصلي) — راجع تقرير
// المهمّة.
function buildGoverningGateDisplayText(name, ceilingLetter) {
  const letter = ceilingLetter || '؟';
  switch (name) {
    case 'ROOT_DETECTED':
      return `أعلى حرف ${letter}: صلاحيات الجذر (الروت) مكتشَفة على الجهاز.`;
    case 'PATCH_AGE':
      return `أعلى حرف ${letter}: آخر رقعة أمان على الجهاز أقدم من ${PATCH_AGE_MAX_MONTHS} شهراً.`;
    case 'LOW_CATEGORY_COVERAGE':
      // نصّ المستخدم حرفياً (S1 الأصلي/S-3 الآن) — بوّابة التغطية على الحرف
      // العامّ. بلا تغيير (S-3: "كما هو، في هذا الإصدار فيه صادقة").
      return `أعلى حرف في هذا الإصدار ${letter}: لا توجد لكل الفئات قياسات أداء معتمدة بعد.`;
    case 'BATTERY_MAX_ONE_BAND':
      return 'أثر البطارية على الحرف العامّ لا يتجاوز حرفاً واحداً.';
    case 'STORAGE_VERIFY_ERRORS':
      return `أعلى حرف ${letter}: أخطاء تحقّق في التخزين الداخلي.`;
    case 'GPU_HASH_MISMATCH':
      // S-6 (مُصحَّح 2026-10-01 +03) — "معالج الرسومات" يطابق اسم الفئة
      // المعتمَد (CATEGORY_NAME_AR.gpu) الآن — راجع التعليق أعلى الدالّة.
      return `أعلى حرف ${letter}: عدم تطابق في التحقّق من معالج الرسومات.`;
    case 'SUSTAINED_CEILING':
      return `أعلى حرف ${letter}: أداء المعالج لم يحافظ على مستواه تحت الحمل المستمرّ.`;
    default:
      return null;
  }
}

function buildGoverningGateReason(overall) {
  if (!overall || typeof overall.letterSource !== 'string') return null;
  if (!overall.letterSource.startsWith('GATE:')) return null;
  const name = overall.letterSource.slice('GATE:'.length);
  const applied = Array.isArray(overall.gatesApplied) ? overall.gatesApplied : [];
  const hit = applied.find((g) => g && g.name === name && (
    g.cappedOverall === true ||
    // استثناء BATTERY_MAX_ONE_BAND — راجع تعليق الدالّة أعلاه.
    (typeof g.cappedOverall === 'undefined' && typeof g.from === 'string' && typeof g.to === 'string')
  ));
  if (!hit) {
    // letterSource يدّعي بوّابة حاكمة ولا عنصر في gatesApplied يثبتها بمعيار
    // الحاكمية (cappedOverall=true) — تعارض داخلي. لا رمي يُسقط التقرير كلّه
    // (تصحيح المستخدم 2026-09-30 +03، البند ٦) ولا افتراض صامت (القاعدة 22):
    // حالة صريحة status='UNMATCHED'. سجلّ بلا بيانات تعريفية — هذه الدالّة
    // لا تملك سياق scanId/جهاز أصلاً (مُدخلها overall فقط)، فلا حاجة لحرص
    // إضافي على الحذف: لا شيء تعريفي هنا لتسريبه أصلاً.
    console.warn(`[buildDisplayShapeV7][governingGateReason] letterSource=GATE:${name} ` +
        'بلا عنصر gatesApplied بالاسم نفسه يحمل cappedOverall=true (أو بنية سقف ' +
        'البطارية بلا الحقل) — تعارض داخلي، governingGateReason.status=UNMATCHED');
    // text=null صراحةً (القاعدة 22) — تعارض داخلي لا جملة عربية هادئة له.
    return {name, ceilingLetter: null, source: null, status: 'UNMATCHED', text: null};
  }
  const ceilingLetter = hit.ceilingLetter || hit.to || null;
  const text = buildGoverningGateDisplayText(hit.name, ceilingLetter);
  if (text === null) {
    // بوّابة حقيقية أطلقت فعلاً (hit موجود) لكن بلا حالة في الجدول أعلاه —
    // فجوة نصّ يجب سدّها، لا سكوت (القاعدة 22 + S1). لم تقع هذه الحالة على
    // أي عيّنة حقيقية/ذهبية اليوم (الأسماء الستّة كلّها معدودة أعلاه).
    console.warn(`[buildDisplayShapeV7][governingGateReason] بوّابة أطلقت (${hit.name}) بلا نصّ ` +
        'عرض عربي في buildGoverningGateDisplayText — أضِف حالة جديدة هناك (S1).');
  }
  return {
    name: hit.name,
    ceilingLetter,
    source: hit.source || (hit.from ? `سقف البطارية: ${hit.from} → ${hit.to}` : null),
    text,
  };
}

/**
 * يدمج وصف النموذج (narrative.issueDescriptions[id]) في كل عطب حتمي —
 * "النموذج كاتب أوصاف لا مؤلّف قائمة" (تعديل 2026-09-20، P1.4). عطب
 * حتمي بلا وصف من النموذج → description=null، لا نص مُختلَق هنا.
 * @param {Array} issues categoryStates.issues (حتمية، معرّفات ثابتة)
 * @param {Object} issueDescriptions aiAnalysis.narrative.issueDescriptions
 * @return {Array}
 */
function buildIssuesDisplay(issues, issueDescriptions) {
  const desc = (issueDescriptions && typeof issueDescriptions === 'object' &&
      !Array.isArray(issueDescriptions)) ? issueDescriptions : {};
  return (Array.isArray(issues) ? issues : []).map((it) => Object.assign({}, it, {
    description: (it && typeof desc[it.id] === 'string') ? desc[it.id] : null,
  }));
}

/**
 * نقطة الدخول — يبني {display, audit} من categoryStates (بعد أي
 * applyV7Adjustments — راجع تعليق رأس الملف لترتيب التركيب) + findings +
 * aiAnalysis الخام من callAIv7 (narrative/crossChecks/adjustments/
 * modelObservations — شكل reportShapeV7.js).
 *
 * لا يفحص guard.ok — تنسيق عرض بحت، لا سياسة قبول/رفض (ذلك قرار طبقة
 * الاستدعاء الأعلى؛ راجع تقرير المهمّة تحت "ما لم أفعله ولماذا").
 *
 * @param {Object} params
 * @param {Object} params.categoryStates مخرَج computeCategoryStates (بعد
 *   applyV7Adjustments إن وُجدت تعديلات — هذه الدالّة لا تطبّقها بنفسها)
 * @param {Object} params.findings مخرَج computeFindings
 * @param {Object} params.aiAnalysis مخرَج النموذج الخام (narrative/
 *   crossChecks/adjustments/modelObservations) — قبل أو بعد الحارس، سيّان
 *   هنا (لا فحص guard.ok)
 * @param {string} [params.language]
 * @return {{display: Object, audit: Object}}
 */
function buildDisplayShapeV7(params) {
  const p = params || {};
  const categoryStates = p.categoryStates;
  const findings = p.findings || null;
  const aiAnalysis = p.aiAnalysis || {};
  const language = p.language || 'ar';

  if (!categoryStates || typeof categoryStates !== 'object') {
    throw new Error('buildDisplayShapeV7: categoryStates غائب — لا شيء لتنسيقه');
  }

  const overall = categoryStates.overall || {};
  const categories = categoryStates.categories || {};
  const nar = (aiAnalysis && typeof aiAnalysis.narrative === 'object' &&
      aiAnalysis.narrative && !Array.isArray(aiAnalysis.narrative)) ? aiAnalysis.narrative : {};

  // القرار ٧: صفر فئة MEASURED (noDataAtAll) وبلا بوّابة أنقذت letter —
  // overall.letter يبقى null فقط في هذه الحالة أو HARNESS_ERROR (مُتحقَّق
  // من الصيغة الحسابية في categoryStates.js — راجع تعليق رأس هذا الملف
  // وcategoryStates.js:deriveOverallFromCategories). نميّزهما هنا: رسالة
  // "لم يُقَس شيء قابل للحكم" تخصّ noDataAtAll فقط، لا HARNESS_ERROR (لتلك
  // حقولها الخاصّة harnessError/harnessErrorReason — القرار ١٢/١٣).
  const noDataAtAll = !!overall.noDataAtAll;
  const zeroMeasuredMessage = (overall.letter === null && noDataAtAll) ?
      'لم يُقَس شيء قابل للحكم' : null;

  const coverage = typeof overall.coverage === 'number' ? overall.coverage : null;
  const coveragePct = coverage === null ? null : Math.round(coverage * 1000) / 10;

  const display = {
    pipeline: PIPELINE_TAG,
    language,
    overall: {
      letter: overall.letter,
      letterSource: overall.letterSource || null,
      coverage,
      coveragePct,
      partialAssessment: !!overall.partialAssessment,
      partialAssessmentTag: overall.partialAssessmentTag || null,
      governingGateReason: buildGoverningGateReason(overall),
      noDataAtAll,
      zeroMeasuredMessage,
      abstentionReasons: zeroMeasuredMessage ? buildAbstentionReasons(categories) : null,
      harnessError: !!overall.harnessError,
      harnessErrorReason: overall.harnessErrorReason || null,
      // S3 (أمر مستخدم 2026-10-01 +03) — حقل جديد، جملة عرض عربية جاهزة
      // (categoryStates.js:harnessErrorDisplayMessage) — بجوار الرمز الخامّ
      // أعلاه، لا بديلاً عنه (القاعدة 24: harnessErrorReason يبقى للّوحة).
      harnessErrorMessage: overall.harnessErrorMessage || null,
    },
    categories: {},
    issues: buildIssuesDisplay(categoryStates.issues, nar.issueDescriptions),
    // القرار ٢٥ — لا predicted_problems هنا ولا في أي مكان آخر من display:
    // إسقاط مقصود مُعلَّل (لا سهو). البوّابات المسمّاة (ROOT_DETECTED/
    // PATCH_AGE ضمن overall.gatesApplied عبر audit) تقول للمشتري ما يهمّه
    // فعلاً بدليل قياسي، لا بتوقّع نموذج. توقّع النموذج (إن كتب واحداً)
    // مكانه audit.modelObservations أعلاه — للمراجع الداخلي لا المشتري.
    // reportShapeV7.FORBIDDEN_TOP_LEVEL_KEYS يرفض predicted_problems/
    // predictedProblems دفاعاً في العمق لو كتبه النموذج رغم البرومبت.
    narrative: {
      summary: typeof nar.summary === 'string' ? nar.summary : null,
      details: typeof nar.details === 'string' ? nar.details : null,
      verdict: typeof nar.verdict === 'string' ? nar.verdict : null,
      buyerAdvice: buildBuyerAdviceDisplay(nar.buyerAdvice),
    },
  };

  for (const cat of CATEGORIES) {
    if (categories[cat]) display.categories[cat] = buildCategoryDisplay(categories[cat]);
  }

  // فرق موثَّق عن نصّ الخطّة — راجع تعليق رأس الملف. مستوى شحن واحد لكامل
  // الفحص، لا لكل مؤشّر (batteryLayer.js لا يُنتج ذلك اليوم).
  if (display.categories.battery) {
    display.categories.battery.socAtStart =
        (findings && findings.battery && typeof findings.battery.socAtStart === 'number') ?
            findings.battery.socAtStart : null;
    display.categories.battery.socAtEnd =
        (findings && findings.battery && typeof findings.battery.socAtEnd === 'number') ?
            findings.battery.socAtEnd : null;
  }

  // القرار ٤ + ٦ — تُحفَظ ولا تُعرض. تصل audit فقط، لا display. تفصيل
  // القسمة بين display/audit في وثيقة العقد (docs/V7_DISPLAY_SHAPE_CONTRACT.md).
  const audit = {
    measuredCategoriesMean: typeof overall.measuredCategoriesMean === 'number' ?
        overall.measuredCategoriesMean : null,
    gatesApplied: Array.isArray(overall.gatesApplied) ? overall.gatesApplied : [],
    partialBadLetterUngated: Array.isArray(overall.partialBadLetterUngated) ?
        overall.partialBadLetterUngated : [],
    adjustments: Array.isArray(overall.adjustments) ? overall.adjustments : [],
    disputed: !!overall.disputed,
    categoryLlmSuggestedLetters: CATEGORIES.filter((c) => categories[c]).reduce((acc, c) => {
      acc[c] = categories[c].llmSuggestedLetter || null;
      return acc;
    }, {}),
    crossChecks: Array.isArray(aiAnalysis.crossChecks) ? aiAnalysis.crossChecks : [],
    modelObservations: Array.isArray(aiAnalysis.modelObservations) ? aiAnalysis.modelObservations : [],
    issueSetHash: categoryStates.issueSetHash || null,
    lettersHash: categoryStates.lettersHash || null,
    numbersHash: categoryStates.numbersHash || null,
  };

  return {display, audit};
}

module.exports = {
  buildDisplayShapeV7,
  PIPELINE_TAG,
  _internal: {
    categoryAbsenceReason, buildCategoryDisplay, buildAbstentionReasons,
    buildGoverningGateReason, buildIssuesDisplay, buildBuyerAdviceDisplay,
    // أمر المهمّة 2026-09-22 +03 (البند الثاني) — للاختبار المباشر بلا
    // بناء categoryStates كامل (نفس نمط تصدير الدوال الأخرى في هذه القائمة).
    buildCategoryLetterCeilingReason, buildLowCoverageCeilingDisplayText, arabicTestCount,
  },
};
