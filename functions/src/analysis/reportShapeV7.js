// ===================================================
// reportShapeV7 — الحارس على مخرَج النموذج V7 (P1.4، PLAN-01-ROADMAP.md
// "الحارس" تحت P1.4 + القرار ٩)
// ===================================================
//
// نصّ المهمّة حرفياً: "الحارس (reportShape.js) يصير: مخطَّط بالأنواع
// والمدى وحضور الفئات الـ15 + مطابقة أرقام (كل عدد في النصّ يُستخرَج
// ويُطابَق بقيمة في Findings ±التقريب، وغير المطابق يُرفض حقله ويُعاد
// توليده) + لغة."
//
// reportShape.js (V3/V5/V6) يبقى كما هو — يخدم مسار callAI الحيّ الحالي
// ولا علاقة له بعقد V7 (شكل مختلف كلّياً: narrative/crossChecks/
// adjustments/modelObservations بدل category_scores/issues مسطَّحة). هذا
// ملف مستقلّ موازٍ، لا استبدال — القرار ٥ ("كسر نظيف. لا شكل مزدوج")
// يخصّ الاستجابة **المعروضة للمستخدم** (P1.5)، لا الحرّاس الداخليين على
// مسارين لا يزالان مُتعايشَين حتى يُفعَّل V7 حيّاً (راجع تقرير المهمّة).
// ===================================================

'use strict';

const {CATEGORIES} = require('../utils/categories');
const {findEnglishLeaks} = require('./languageValidator');
const {ALLOWED_LATIN_TOKENS} = require('./allowedLatin');
// أمر مستخدم 2026-09-23 +03 (بعد القياس العشاري)، البند ٤ — مصدر واحد
// لأسماء جذر الحمولة (القاعدة 24)، لا نسخة هنا.
const {V7_PAYLOAD_ROOT_KEYS} = require('./buildV7Payload');

// ─── 1. المخطَّط: الأنواع والمدى وحضور المفاتيح ────────────────────────

// القرار ٢٥ (PLAN-01-ROADMAP.md §🔒 "٢٥ · predicted_problems تُسقَط من
// display"): إسقاط مقصود مُعلَّل، لا سهو — البوّابات المسمّاة
// (ROOT_DETECTED/PATCH_AGE) تُخبر المشتري بدليل لا بتوقّع، وتوقّع النموذج
// مكانه modelObservations[] في audit (للمراجع لا للمشتري). systemPromptV7.js
// لا يطلب هذا الحقل أصلاً (الشكل النهائي أربعة مفاتيح فقط) — الإضافة هنا
// فئة ٢، دفاع في العمق: لو كتبه النموذج رغم ذلك (سهواً أو من عادة V6)
// يُرفَض بنفس آلية grade/score/category_scores، لا يمرّ صامتاً إلى display.
const FORBIDDEN_TOP_LEVEL_KEYS = Object.freeze([
  'grade', 'score', 'category_scores', 'categoryScores',
  'predicted_problems', 'predictedProblems',
]);

// ─── مصدر واحد لتمييز "هل يبدو هذا الردّ V7 أصلاً" (أمر مستخدم 2026-09-23
// +03، القرار ١، القاعدة 24) ─────────────────────────────────────────────
//
// reportShape.js:resolveReport (V3/V5/V6) كان مغلقاً على REPORT_SHAPE_KEYS
// (grade/score/summary/category_scores...) — لا مفتاح منها يظهر في ردّ V7
// حقيقي أبداً (الشكل النهائي أربعة مفاتيح فقط، مؤكَّد ضدّ ردّ حيّ حقيقي
// فعلي)، فكل استدعاء حقيقي لـcallAIv7 كان يُرفَض shape_invalid على
// المحاولة الأولى دائماً — عطب حقيقي لم يظهر سابقاً لأن السكربت الوحيد
// الذي نادى حيّاً بنى fetch مباشراً يتجاوز هذه البوّابة عرضاً (لسبب آخر:
// تمديد المهلة، راجع measure-callAIv7-live.js:16-30).
//
// الحلّ ليس قائمة ثالثة مكتوبة من جديد — narrative هو نفسه الحقل الذي
// يفحصه validateV7Shape أدناه بعمق كنقطة الارتكاز الأولى (`parsed.narrative`)،
// فهو العلامة الأصدق على أن الردّ "يبدو V7". هذا الثابت **يُصدَّر** ليكون
// المصدر الوحيد الذي يستهلكه كلٌّ من guardV7Response هنا وreportShape.js
// عبر callAI.js — لا نسخة مكتوبة في callDeepSeek.js/callGemini.js.
const V7_SHAPE_KEYS = Object.freeze(['narrative']);

// أربعة المفاتيح العليا التي يتطلّبها شكل V7 الكامل — validateV7Shape
// أدناه يفحص كلّاً منها بعمق، وغياب أيٍّ منها فوق مستوى النقص الحقلي دليل
// بتر لا غياب مشروع (بخلاف V6's rootCause/changeAnalysis اللذين يُسمَح
// غيابهما صراحةً). يُستهلَك من ensureReportShape (callDeepSeek.js/
// callGemini.js) عبر callAI.js، بدل CORE_KEY_GROUPS الافتراضي (V6).
const V7_CORE_KEY_GROUPS = Object.freeze([
  ['narrative'], ['crossChecks'], ['adjustments'], ['modelObservations'],
]);

const MAX_MODEL_OBSERVATIONS = 2;
const VALID_DIRECTIONS = Object.freeze(['DOWN', 'UP']);

// القرار ٢٤ (PLAN-01-ROADMAP.md §🔒 "٢٤ · buyerAdvice يعود ثلاثة حقول"):
// العقد القديم (نصّ واحد) كان فقدان وظيفة لا إعادة تسمية — المشتري
// العادي والمهتمّ بالألعاب والمصوّر يحتاجون نصيحة مختلفة عن نفس الجهاز.
const BUYER_ADVICE_PROFILES = Object.freeze(['casual', 'gamer', 'photographer']);

/**
 * يفحص شكل مخرَج النموذج (أنواع/مدى/حضور) بلا أي معرفة بـFindings —
 * ذلك validateNumberGrounding أدناه. لا يرمي؛ يُعيد قائمة أخطاء مُسمّاة.
 * @param {*} parsed مخرَج النموذج كما وصل (غير موثوق بالكامل)
 * @return {{ok: boolean, errors: string[]}}
 */
function validateV7Shape(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {ok: false, errors: ['ROOT_NOT_OBJECT']};
  }

  for (const forbidden of FORBIDDEN_TOP_LEVEL_KEYS) {
    if (forbidden in parsed) {
      errors.push(`FORBIDDEN_KEY_${forbidden}`); // "لا تكتبها إطلاقاً" — systemPromptV7.js
    }
  }

  const nar = parsed.narrative;
  if (!nar || typeof nar !== 'object' || Array.isArray(nar)) {
    errors.push('NARRATIVE_MISSING_OR_NOT_OBJECT');
  } else {
    for (const field of ['summary', 'details', 'verdict']) {
      if (typeof nar[field] !== 'string' || !nar[field].trim()) {
        errors.push(`NARRATIVE_${field.toUpperCase()}_MISSING_OR_EMPTY`);
      }
    }
    // القرار ٢٤ — buyerAdvice لم يعد نصّاً واحداً، بل كائن بثلاثة ملفّات
    // مشترٍ (casual/gamer/photographer)، كلٌّ نصّ غير فارغ مستقلّ.
    if (!nar.buyerAdvice || typeof nar.buyerAdvice !== 'object' || Array.isArray(nar.buyerAdvice)) {
      errors.push('NARRATIVE_BUYERADVICE_MISSING_OR_NOT_OBJECT');
    } else {
      for (const profile of BUYER_ADVICE_PROFILES) {
        if (typeof nar.buyerAdvice[profile] !== 'string' || !nar.buyerAdvice[profile].trim()) {
          errors.push(`NARRATIVE_BUYERADVICE_${profile.toUpperCase()}_MISSING_OR_EMPTY`);
        }
      }
    }
    if (nar.issueDescriptions === undefined) {
      errors.push('NARRATIVE_ISSUE_DESCRIPTIONS_MISSING');
    } else if (typeof nar.issueDescriptions !== 'object' || Array.isArray(nar.issueDescriptions)) {
      errors.push('NARRATIVE_ISSUE_DESCRIPTIONS_NOT_OBJECT');
    } else {
      for (const [k, v] of Object.entries(nar.issueDescriptions)) {
        if (typeof v !== 'string' || !v.trim()) errors.push(`ISSUE_DESCRIPTION_EMPTY[${k}]`);
      }
    }
  }

  if (!Array.isArray(parsed.crossChecks)) {
    errors.push('CROSS_CHECKS_NOT_ARRAY');
  } else {
    parsed.crossChecks.forEach((c, i) => {
      if (!c || typeof c !== 'object' || typeof c.description !== 'string' || !c.description.trim()) {
        errors.push(`CROSS_CHECK_${i}_INVALID`);
      }
      if (!Array.isArray(c && c.evidenceRefs)) errors.push(`CROSS_CHECK_${i}_EVIDENCE_NOT_ARRAY`);
    });
  }

  if (!Array.isArray(parsed.adjustments)) {
    errors.push('ADJUSTMENTS_NOT_ARRAY');
  } else {
    parsed.adjustments.forEach((a, i) => {
      if (!a || typeof a !== 'object') { errors.push(`ADJUSTMENT_${i}_NOT_OBJECT`); return; }
      if (typeof a.category !== 'string' || !CATEGORIES.includes(a.category)) {
        errors.push(`ADJUSTMENT_${i}_UNKNOWN_CATEGORY`);
      }
      if (!VALID_DIRECTIONS.includes(a.direction)) errors.push(`ADJUSTMENT_${i}_INVALID_DIRECTION`);
      if (!Array.isArray(a.evidenceRefs) || a.evidenceRefs.length < 1) {
        errors.push(`ADJUSTMENT_${i}_EVIDENCE_REFS_EMPTY`); // "evidenceRefs[≥1]" — نصّ P1.4 حرفياً
      }
    });
  }

  if (!Array.isArray(parsed.modelObservations)) {
    errors.push('MODEL_OBSERVATIONS_NOT_ARRAY');
  } else {
    if (parsed.modelObservations.length > MAX_MODEL_OBSERVATIONS) {
      errors.push(`MODEL_OBSERVATIONS_EXCEEDS_CAP_${MAX_MODEL_OBSERVATIONS}`); // قرار 8
    }
    parsed.modelObservations.forEach((o, i) => {
      if (!o || typeof o !== 'object' || typeof o.text !== 'string' || !o.text.trim()) {
        errors.push(`MODEL_OBSERVATION_${i}_INVALID`);
      }
      if (!Array.isArray(o && o.evidenceRefs)) errors.push(`MODEL_OBSERVATION_${i}_EVIDENCE_NOT_ARRAY`);
    });
  }

  return {ok: errors.length === 0, errors};
}

/**
 * narrative.issueDescriptions يجب ألّا يخترع معرّفاً غير موجود في
 * categoryStates.issues (النموذج "كاتب أوصاف لا مؤلّف قائمة" — تعديل
 * 2026-09-20 المذكور في P1.4).
 * @param {Object} parsed مخرَج النموذج (بعد اجتياز validateV7Shape)
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {{ok: boolean, inventedIds: string[]}}
 */
function validateIssueDescriptionKeys(parsed, categoryStates) {
  const nar = parsed && parsed.narrative;
  const desc = nar && nar.issueDescriptions;
  if (!desc || typeof desc !== 'object') return {ok: true, inventedIds: []};
  const realIds = new Set((categoryStates && Array.isArray(categoryStates.issues) ?
      categoryStates.issues : []).map((i) => i.id));
  const inventedIds = Object.keys(desc).filter((id) => !realIds.has(id));
  return {ok: inventedIds.length === 0, inventedIds};
}

// ─── 2. مطابقة الأرقام — كل عدد في النصّ من Findings/categoryStates ─────

// يستخرج أرقاماً عشرية أو صحيحة (بفاصلة عشرية اختيارية) من نصّ حرّ. يتجاهل
// أرقاماً ضمن معرّفات مثل "SEC-04" أو "S10" (تسبقها/تلحقها حرف) عبر حدود
// الكلمة \b — "SEC-04" يُطابَق كـ"04" لولا هذا الحرص؛ الشرط الإضافي أدناه
// (noAdjacentLetters) يستبعد ذلك صراحة.
//
// عطبان مُكتشَفان بنصوص نموذج حقيقية من القياس العشاري (أمر مستخدم
// 2026-09-23 +03، بعد القياس): «-8» مثال يبقى سليماً؛ العطبان فيما يلي:
//
//   ١. «-?» بلا قيد على ما قبلها كانت تلتهم مدى مكتوباً بلا مسافات
//      («المراحل 3-5») كرقمين: 3 ثم **-5 (سالب زوراً)** — الشرطة الفاصلة
//      بين طرفي مدى تُقرأ إشارة سالب. نصّ حقيقي: 02-18-59، المحاولة ١،
//      narrative.details ("المراحل 3-5")؛ ونظيره 02-27-21، المحاولة ١،
//      crossChecks[0].description ("الأطوار 3-5"). الإصلاح: lookbehind
//      سلبي (?<!\d) يمنع قراءة "-" إشارةً حين يسبقها رقم مباشرة — فـ"3-5"
//      تُستخرَج [3, 5] (طرفا المدى، كلاهما موجب) لا [3, -5].
//
//   ٢. الفواصل الفاصلة للألوف («1,929,913») لم تكن جزءاً من النمط
//      إطلاقاً، فتُقرَأ ثلاثة أرقام منفصلة (1، 929، 913) — أو خمسة مع
//      إشارة سالبة زائفة إضافية من العطب ١ («-1,929,913 مقابل -980,444»
//      ← [-1, 929, 913, -980, 444]، لا [-1929913, -980444]). نصّ حقيقي:
//      02-11-54، المحاولة ١، narrative.buyerAdvice.gamer وcrossChecks[0]
//      .description ("-1,929,913 µA مقابل -980,444 µA"). الإصلاح: بديل
//      أول يطابق مجموعات ثلاثية فاصلة صريحة (\d{1,3}(?:,\d{3})+) قبل
//      البديل العادي — القيمة تُنظَّف من الفواصل عند التحويل لرقم
//      (extractNumbers أدناه). حدّ الالتزام المقصود: «1,2,3» (مجموعات
//      أحادية الرقم لا ثلاثية) يبقى ثلاثة أرقام منفصلة — قائمة لا رقماً
//      واحداً — لأن `(?:,\d{3})+` لا يطابق فاصلة تتبعها رقم واحد.
//
// **تحقّق مباشر (لا افتراض)، القيمتان الحقيقيتان بعد الإصلاح**:
//   findings.channels.battery_current_ua.CPU_SUSTAINED.mean = -1929913.043478261
//   findings.channels.battery_current_ua.INIT.mean          = -980444.4444444445
// كلتاهما مطابقتان لِـ-1929913/-980444 (بعد الإصلاح) ضمن هامش numberMatches
// (١٪ أو 0.05 أيّهما أكبر) بفارق كسري لا يُذكَر (0.04 و0.44 وحدة) — الرفض
// القديم كان خطأ أداة، لا خطأ نموذج. لم تُوسَّع المطابقة نفسها (numberMatches
// بلا تغيير) — فقط الاستخراج (extractNumbers) أُصلح ليقرأ الرقم كما كُتب.
const NUMBER_PATTERN = /(?<!\d)-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<!\d)-?\d+(?:\.\d+)?/g;

/**
 * يوحّد الأرقام العربية الهندية (٠-٩) والفارسية (۰-۹) إلى 0-9، و«٫» إلى «.» و«٬» إلى «,» (فاصل الآلاف) قبل الاستخراج — أمر مستخدم
 * 2026-10-07 +03 البند ١. استبدال حرف بحرف (لا يتغيّر الطول ولا مواضع المطابقات).
 * @param {string} text النصّ
 * @return {string} النصّ بأرقام لاتينية
 */
function normalizeNumeralsForExtraction(text) {
  return text
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/٫/g, '.')
      .replace(/٬/g, ',');
}

/**
 * يستخرج كل الأرقام الحرّة من نصّ. أمر مستخدم 2026-10-07 +03 (البند ١، الواقعة: كان الحرف العربي المجاور يمنع الاستخراج فـ«و1968633»
 * و«3778.29،» و«بـ3778.29» تمرّ بلا مطابقة):
 *   • حدّ الرقم: بداية النصّ ونهايته والمسافة والحرف العربي وعلامات الترقيم العربية واللاتينية (، ؛ . : ( ) « » % وأمثالها)
 *     — فالرقم الملاصق لحرف عربي أو لعلامة ترقيم يُستخرَج.
 *   • الرقم الملاصق لحرف لاتيني جزء من معرّف ولا يُستخرَج («S10» و«5G» و«G76» و«Mali-G76» و«SEC-04» و«1080x2280») — سلوك الحارس
 *     اليوم، لا يتغيّر. والرقم المفصول بمسافة بعد كلمة لاتينية («Exynos 9820») يُستخرَج كما كان.
 *   • «-» جزء من الرقم (إشارة) حين لا يسبقه رقم — كما كان؛ و«/» حدّ لا جزء (5/5 ← 5 و5) — كما كان.
 * @param {string} text النصّ
 * @return {number[]} الأرقام المستخرَجة
 */
function extractNumbers(text) {
  if (typeof text !== 'string' || !text) return [];
  const s = normalizeNumeralsForExtraction(text);
  const out = [];
  let m;
  NUMBER_PATTERN.lastIndex = 0;
  while ((m = NUMBER_PATTERN.exec(s)) !== null) {
    const before = s[m.index - 1];
    const after = s[m.index + m[0].length];
    const latinLetter = (c) => !!c && /[A-Za-z]/.test(c);
    if (latinLetter(before) || latinLetter(after)) continue; // جزء من معرّف لاتيني: S10 وSEC-04 وMali-G76
    // فواصل الألوف (بديل ١ في NUMBER_PATTERN) تُنظَّف قبل التحويل — Number("1,929,913") تُعيد NaN لولا هذا.
    const v = Number(m[0].replace(/,/g, ''));
    if (isFinite(v)) out.push(v);
  }
  return out;
}

// معايرة v7.1 (2026-09-21 +03) — رقم يُخزَّن كنصّ بالضبط (مثلاً
// categoryStates.testResults[i].raw.rawValue أو .evidence، أو
// findings.unstableMeasurements[id].rawValue) هو نفسه رقم القياس، فقط
// بنوع JS مختلف (String لا Number) — راجع testKinds.js:131
// `evidence: (entry && (entry.rawValue ?? null))` وcategoryStates.js:294
// `raw: r`. قبل هذه المعايرة كان collectNumbers يتجاهل كل قيمة سلسلة نصّية
// بالكامل، فيُسقِط هذه الأرقام من المجموعة المرجعية ويرفضها الحارس رغم
// أنها **موجودة فعلاً** في Findings/categoryStates — تحقّق مباشر على
// b45c8cf6/34dff2b8 (functions/scripts/out/v7-live-*.json): 2.73 (C-02)،
// 9.1 (C-06)، 420 (D-02)، -63/-64 (N-10)، 7.1 (R-01)، 188 (S-03)، وكل
// أرقام MEASUREMENT الموسومة unstable (C-03/C-04/S-04/S-05/S-06) كانت كلّها
// مرفوضة زوراً لهذا السبب بالضبط، لا لأنها مُختلَقة. هذا إصلاح أداة
// (القاعدة 16) لا تخفيف سياسة: numberMatches/extractNumbers لم يُمسّا؛
// المجموعة المرجعية فقط أصبحت تعكس ما هو موجود فعلاً في Findings.
const PURE_NUMBER_STRING = /^-?\d+(?:\.\d+)?$/;

/**
 * يجمع كل الأرقام المنتهية (leaf) من كائن متداخل — لا يفرّق مصدرها
 * (findings أو categoryStates)، فكلاهما "أرقام حقيقية محسوبة على الخادم".
 * يشمل قيم leaf من نوع رقم JS، وأيضاً قيم leaf من نوع نصّ إن كان النصّ
 * بأكمله رقماً محضاً (PURE_NUMBER_STRING) — لا يستخرج أرقاماً من داخل
 * نصّ مركَّب (ذلك عمد؛ النصوص المركَّبة كـ"exynos9820" أو "1080x2280" هي
 * هوّية جهاز لا قياس، تُعالَج بمصدر device منفصل أدناه، لا هنا).
 * @param {*} obj الكائن (أو مصفوفة، أو رقم/نص)
 * @param {Set<number>} out مجموعة الجمع (تُمرَّر لتفادي إعادة تخصيص عميقة)
 * @param {number} depth حارس عمق (بيانات دائرية أو عميقة جداً)
 */
function collectNumbers(obj, out, depth) {
  if (depth > 12 || obj === null || obj === undefined) return;
  if (typeof obj === 'number' && isFinite(obj)) { out.add(obj); return; }
  if (typeof obj === 'string') {
    if (PURE_NUMBER_STRING.test(obj)) {
      const v = Number(obj);
      if (isFinite(v)) out.add(v);
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectNumbers(v, out, depth + 1);
    return;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectNumbers(v, out, depth + 1);
  }
}

/**
 * يبني مجموعة الأرقام المرجعية الكاملة من findings + categoryStates.
 * @param {Object} findings مخرَج computeFindings
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {Set<number>} كل رقم منتهٍ ظهر في أيّ منهما
 */
function collectReferenceNumbers(findings, categoryStates) {
  const out = new Set();
  collectNumbers(findings, out, 0);
  collectNumbers(categoryStates, out, 0);
  return out;
}

// ─── 1.5 معايرة v7.1 — أربع فئات استثناء معدودة، مُشتقّة بالأداة ────────
// راجع أمر المهمّة 2026-09-21 +03 "معايرة حارس V7". المبدأ: الحارس يمنع
// اختراع رقم/رمز، لا يعاقب النموذج على اتّباع البرومبت. الفئات الأربع
// أدناه ليست نمطاً عامّاً — كل واحدة مُشتقّة من مصدر محدَّد في الكود
// (مُوثَّق في تعليق كل دالّة)، ومسجَّلة في مخرَج الحارس (guardV7Response
// .excluded) كي تُقرأ لا تُخمَّن.

// يطابق نفس محتوى s.match(/[A-Za-z][A-Za-z0-9]+/g) في
// languageValidator.js:49 (findEnglishLeaks) — غير مُصدَّرة من هناك
// (داخلية للدالّة)، فنسخة محلّية طبق الأصل هنا **لبناء فهرس استثناء بنفس
// حدود التوكِن**، لا لإعادة تنفيذ كشف التسرّب (ذلك يبقى في
// languageValidator.js وحده — لا قاموس ثانٍ).
const LEAK_TOKEN_RE = /[A-Za-z][A-Za-z0-9]+/g;
// نسخة "متساهلة" من NUMBER_PATTERN — بلا استبعاد الحرف المجاور
// (adjacentLetter في extractNumbers). هنا نبني مصدر device من نصوص
// categoryStates نفسها (لا نتحقّق من نصّ مُخرَج النموذج)، فاستخراج "9820"
// من "exynos9820" مطلوب عمداً — عكس extractNumbers الذي يستبعده حين يقرأ
// نصّ النموذج كي لا يُقرأ SEC-04 رقماً.
const FREE_NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/**
 * فئة ١ (مواصفات الجهاز) — من device لا من Findings. المصدر: testKinds.js
 * (KIND={SPEC,STATE,MEASUREMENT}، testKinds.js:42) يُصرِّح أن STATE/SPEC
 * "حقائق حالة/مواصفة لا قياس" (testKinds.js:89 "الافتراض العريض")، بعكس
 * MEASUREMENT (قياس فعلي، يبقى محكوماً بمرجع Findings وحده أعلاه). device
 * هنا = raw.rawValue/evidence لكل عنصر categoryStates.testResults بـ
 * kind ≠ MEASUREMENT، لهذا الفحص بعينه — لا جدول مواصفات مكتوب من الذاكرة
 * (كان سيُخالف "لا استشهاد برقم قياس إلا من ملف مقيس مُسمّى"؛ تحقّق: C-05
 * رقمه raw.rawValue="exynos9820 / exynos9820"، D-01="1080x2280"،
 * N-01="G977NKOU6FUH3" — راجع functions/scripts/out/v7-live-b45c8cf6-*.json
 * وb45c8cf6-findings.json المحسوبة لهذه المهمّة).
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {{numbers: Set<number>, tokens: Set<string>}}
 */
function collectDeviceReference(categoryStates) {
  const numbers = new Set();
  const tokens = new Set();
  const trs = (categoryStates && Array.isArray(categoryStates.testResults)) ?
      categoryStates.testResults : [];
  for (const tr of trs) {
    if (!tr || tr.kind === 'MEASUREMENT') continue; // القياس يبقى مرجع Findings وحده
    const strs = [];
    if (tr.raw && typeof tr.raw.rawValue === 'string') strs.push(tr.raw.rawValue);
    if (typeof tr.evidence === 'string') strs.push(tr.evidence);
    for (const s of strs) {
      let m;
      FREE_NUMBER_RE.lastIndex = 0;
      while ((m = FREE_NUMBER_RE.exec(s)) !== null) {
        const v = Number(m[0]);
        if (isFinite(v)) numbers.add(v);
      }
      LEAK_TOKEN_RE.lastIndex = 0;
      while ((m = LEAK_TOKEN_RE.exec(s)) !== null) tokens.add(m[0].toLowerCase());
    }
  }
  return {numbers, tokens};
}

/**
 * فئة ٢ (أسماء حقول Findings) — مُشتقّة من مفاتيح findings نفسها (بنيوياً،
 * بالمشي على الكائن، لا نسخة نصّية) + findings.notMeasuredFields[].field
 * (نصّ حرفي لاسم الحقل — مصدر thermalStatusMax/thermalHeadroomPeak
 * كمفاتيح بنيوية في findings.thermal، وmaxCpuTemp/tempRiseRateInProbe
 * كقيمة .field في findings.js:720-724). تُشتقّ من findings المُمرَّر
 * فعلياً لهذا الفحص — تلقائياً تتبع أي حقل يُضاف لاحقاً، لا قائمة تتخلّف.
 *
 * ⚠️ توسيع عن نصّ أمر المهمّة الحرفي (كان "مفاتيح Findings" فقط) —
 * categoryStates تُمشى بنفس الآلية أيضاً، لأن systemPromptV7.js يأمر
 * النموذج صراحة بالاستشهاد بحقول categoryStates.overall.gatesApplied
 * بنيوية (السطر الدقيق انحرف مرّتين موثَّقتين: كان :118 وقت كتابة هذا
 * التعليق، ثم مهمّة 2026-09-23 +03 — تصحيح جملة البوّابات لتشرح
 * status/cappedThisLetter/cappedOverall — نقلته إلى محيط :150-165؛ تحقّق
 * بالأداة لا بهذا الرقم، نفس تحذير هذا الملفّ نفسه في مواضع أخرى).
 * والنداءان الحيّان أثبتا استشهاداً حقيقياً بمفاتيح بنيوية من هناك تحديداً
 * (cappedOverall في crossChecks[1]، executedCount في crossChecks[4] —
 * كلاهما مفتاح حقيقي: categoryStates.js:210-236 (cappedOverall) و:117/320
 * (executedCount)؛ لا مكان لهما في Findings أصلاً). مُسجَّل هنا بارزاً
 * (القاعدة 13: "افتراض يُوثَّق لا يُخمَّن") — راجع تقرير المهمّة تحت
 * "افتراضات" لقرار المستخدم.
 *
 * قيمة leaf من نوع boolean (مثل cappedOverall=true) تضيف السلسلة الحرفية
 * "true"/"false" أيضاً — استشهاد بحقل بوليني حقيقي يستلزم كتابة قيمته.
 * @param {Object} findings مخرَج computeFindings
 * @param {Object} [categoryStates] مخرَج computeCategoryStates (توسيع، راجع أعلاه)
 * @return {Set<string>} توكِنز مسموحة (lowercase)
 */
// أمر مستخدم 2026-09-23 +03 — قرار المستخدم بعد A125 (نُقل حرفياً):
// "يُلغى تقسيم الأسماء المركّبة، ويبقى اسم الجذر findings... الخطر ليس في
// الكلمات الشائعة، بل في كل قيمة تشترك حروفها مع جزء من اسم حقل. وقائمة
// الاستثناء لا تلتقطها بحكم التعريف." splitCamelCaseParts (البند ٤ الأصلي،
// 695e862) كانت تُقسِّم "vsyncLockFraction60" إلى ["vsync","Lock",
// "Fraction60"] وتُضيف كل جزء منفصلاً — فأدخلت التوكِن "partial" (من
// categoryStates.overall.partialAssessment/partialAssessmentTag/
// partialBadLetterUngated) إلى فهرس الاستثناء، فصارت قيمة state حقيقية
// "PARTIAL" التي يكتبها النموذج تُقرأ استثناءً بالغلط (A125، مُكتشَف
// باختبار البند ٥ — statePromptTranslationHint.test.js تحقّق ٣). **أُزيل
// التقسيم وحده هنا** — V7_PAYLOAD_ROOT_KEYS وإضافة أسماء الجذر (أدناه)
// تبقيان كما هما، لم يُمسّا (ذلك النصف الآخر من 695e862 سليم، لا علاقة له
// بالعطب). addKeyTokensFrom تعود إلى إضافة المفتاح الكامل غير المُقسَّم
// فقط (السلوك قبل 695e862 تماماً، بالإضافة إلى أسماء الجذر الجديدة).
function collectFindingsFieldNameTokens(findings, categoryStates) {
  const tokens = new Set();
  // أمر مستخدم 2026-09-23 +03، البند ٤: "أضف أسماء الجذر الفعلية
  // للحمولة" — V7_PAYLOAD_ROOT_KEYS من buildV7Payload.js (مصدر واحد).
  // مثال حقيقي: "findings" ظهرت حرفياً في adjustments[0].reason حقيقي
  // (34dff2b8، 02-30-08، المحاولة ١) — النموذج يشير إلى جذر حمولته باسمه.
  for (const rootKey of V7_PAYLOAD_ROOT_KEYS) tokens.add(rootKey.toLowerCase());
  // لا LEAK_TOKEN_RE هنا عمداً — أسماء الجذر أعلاه سلاسل حرفية ثابتة
  // (مصدرها buildV7Payload.js، لا كائن حيّ) فلا حاجة لمطابقة نمط عليها.
  function addKeyTokensFrom(str) {
    LEAK_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = LEAK_TOKEN_RE.exec(str)) !== null) {
      tokens.add(m[0].toLowerCase());
    }
  }
  function walkKeys(obj, depth) {
    if (depth > 12 || !obj || typeof obj !== 'object' || obj === null) return;
    if (Array.isArray(obj)) { for (const v of obj) walkKeys(v, depth + 1); return; }
    for (const [k, v] of Object.entries(obj)) {
      addKeyTokensFrom(k);
      if (typeof v === 'boolean') tokens.add(String(v));
      walkKeys(v, depth + 1);
    }
  }
  walkKeys(findings, 0);
  walkKeys(categoryStates, 0);
  const nmf = (findings && Array.isArray(findings.notMeasuredFields)) ? findings.notMeasuredFields : [];
  for (const entry of nmf) {
    if (entry && typeof entry.field === 'string') addKeyTokensFrom(entry.field);
  }
  return tokens;
}

// فئة ٣ — أسماء الحقول المُشتقّة منها أسماء البوّابات/الأسباب (لا القيم —
// القيم تُقرأ ديناميكياً من categoryStates/findings الفعليَّين في كل نداء،
// هذه فقط "أين تُوجَد" في المخطَّط). مصدرها بالضبط:
//   .name       → categoryStates.js:210-236 gates.push({name: 'ROOT_DETECTED', ...})
//   .status     → نفس عناصر gatesApplied (FIRED/NOT_FIRED/INPUT_ABSENT/
//                 DISABLED/NOT_WIRED — الرابعة أُضيفت 2026-09-23 +03؛
//                 الآلية أدناه بنائية على اسم المفتاح لا على قيمة مُعدَّدة
//                 ثابتة، فلا تعديل كود لزم هنا لهذه الإضافة تحديداً)
//   .floorApplied  → categoryStates.js:338 entry.floorApplied = 'STATE_FAIL_FLOOR'
//   .noLetterReason → categoryStates.js:394 'NO_CALIBRATED_THRESHOLD (...)'
//   .class      → findings.unstableMeasurements/advisoryMeasurements (UNSTABLE/ADVISORY)
//   .title      → categoryStates.issues[].title (يحمل رموزاً مثل
//                 "(CAPABILITY_BLOCKED)"، "(NOT_TESTED)")
//   .reason / .notMeasuredReason / .harnessErrorReason / .letterSource / .source
//               → أسباب NOT_MEASURED/HARNESS_ERROR المُسمّاة في findings.js/categoryStates.js
//   .tag        → categoryStates.js:392 tag: 'ESTIMATED' (فئة البطارية،
//                 حين لا عتبة معايَرة)
const GATE_VOCAB_KEYS = new Set([
  'name', 'status', 'floorApplied', 'noLetterReason', 'notMeasuredReason',
  'harnessErrorReason', 'letterSource', 'class', 'title', 'reason', 'source',
  'kneeState', 'tag',
]);

/**
 * فئة ٣ (أسماء البوّابات) — تُشتقّ ديناميكياً من قيم الحقول المذكورة أعلاه
 * (GATE_VOCAB_KEYS) داخل findings/categoryStates الفعليَّين لهذا الفحص —
 * لا قائمة نصّية ثابتة بأسماء البوّابات الخمس؛ لو أُضيفت بوّابة سادسة
 * لاحقاً (مثلاً حين تُفعَّل STORAGE_VERIFY_ERRORS فعلياً)، اسمها يدخل
 * تلقائياً لأنه سيظهر في .name ضمن gatesApplied[] الحقيقي.
 * @param {Object} findings مخرَج computeFindings
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {Set<string>} توكِنز مسموحة (lowercase)
 */
function collectGateNameTokens(findings, categoryStates) {
  const tokens = new Set();
  function addTokensFrom(str) {
    LEAK_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = LEAK_TOKEN_RE.exec(str)) !== null) tokens.add(m[0].toLowerCase());
  }
  function walk(obj, depth) {
    if (depth > 14 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { for (const v of obj) walk(v, depth + 1); return; }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && GATE_VOCAB_KEYS.has(k)) {
        addTokensFrom(v);
      } else if (v && typeof v === 'object') {
        walk(v, depth + 1);
      }
    }
  }
  walk(findings, 0);
  walk(categoryStates, 0);
  return tokens;
}

// فئة ٤ (الوحدات والرموز) — قائمة صريحة معدودة، حرفياً كما وردت في أمر
// المهمّة. °C لا تُستثنى صراحة لأنها لا تُطابِق LEAK_TOKEN_RE أصلاً (الرمز
// ° ليس [A-Za-z]، وC وحدها حرف واحد لا يطابق [A-Za-z][A-Za-z0-9]+ الذي
// يتطلّب حرفين فأكثر) — لا حاجة لإدراجها. (Wi وFi وNFC وUSB خرجت من هذه القائمة بقرار 2026-10-07: صارت من اللاتيني المسموح — مصدرها allowedLatin.js.)
const UNIT_LEAK_TOKENS = new Set(
    ['GHz', 'MHz', 'MB', 'GB', 'mV', 'mA', 'mAh', 'eSIM', 'API']
        .map((t) => t.toLowerCase()),
);

// اللاتيني المسموح صراحةً (قرار مستخدم 2026-10-07 +03): NeuralCheck، A-D، QR، USB، Wi-Fi، Bluetooth، NFC، GPS، Vulkan، OpenGL — المصدر الواحد
// allowedLatin.js (القاعدة 24)، تقرؤه أيضاً التعليمات وسكربت فحص S5. التوكِنز مقسَّمة على غير الحرف والرقم (Wi-Fi ← wi وfi) كما يقسّمها
// findEnglishLeaks، والمقارنة بـtoLowerCase (لا اعتبار لحالة الأحرف). قبل القرار كان Vulkan وOpenGL يمرّان على الفِخّين الذهبيّين بحكم البيانات
// وحدها (platform_identifier من G-02 وdevice_spec من G-01) ويُرفضان بلا ctx وعلى Honor وS10؛ وكانت Bluetooth وQR وGPS وNeuralCheck تُرفض بلا ctx.
const ALLOWED_LATIN_LEAK_TOKENS = new Set(ALLOWED_LATIN_TOKENS);

/**
 * خامسة زائدة عن الفئات الأربع المطلوبة حرفياً في أمر معايرة v7.1 —
 * **قرار المستخدم النهائي 2026-09-21 +03: تبقى فئة خامسة منفصلة، لا
 * تُدمَج في فئة ٤.**
 *
 * ⚠️ **إعادة كتابة كاملة 2026-09-23 +03 (أمر مستخدم — البند ١، عطب حيّ
 * حقيقي)**: النسخة القديمة (مُبقاة موسومة أدناه لا محذوفة — القاعدة 8)
 * كانت تقرأ **موضعين مُسمّيين فقط** (`testResults[].evidenceUnit`/
 * `raw.rawValueUnit`، `issues[].evidenceUnit`) — قائمة مواضع، لا حقول.
 * فشلت فعلياً على نداء حيّ حقيقي: النموذج كتب "13.38 °C/Wh" (القيمة
 * الحرفية لـ`categoryStates.categories.battery.batteryIndicators.
 * BAT-THERMAL-EFF.unit` — موضع ثالث لم تقرأه النسخة القديمة إطلاقاً)،
 * فرُفض التقرير بعطب "Wh" مُتسرِّب — **نفس آلية عطب "71.5" بصورة مختلفة**:
 * الحارس يرفض ما في مُدخله لأنه لا يعرف أين يقرؤه (القاعدة 25 مخالَفة).
 *
 * ⚠️ **تصحيح 2026-09-23 +03 (أمر مستخدم لاحق، البند ٥) — قاعدة لاحقة لا
 * قائمة أسماء.** النسخة الأولى (`MEASUREMENT_UNIT_FIELD_NAMES` كمجموعة
 * ثابتة `{unit, rawValueUnit, evidenceUnit}`) كانت **هي نفسها** قائمة
 * تُصان يدوياً — أصغر من القائمة القديمة (موضعان) لكن من نفس الفصيلة:
 * حقل وحدة خامس مستقبلي باسم لم يُذكَر (`latencyUnit` مثلاً) لن يدخلها
 * إلا بتعديل كود. **التعريف الجديد بنيويّ فعلاً**: "حقل وحدة" = أي مفتاح
 * كائن اسمه **ينتهي** بـ"unit" (بلا حساسية لحالة الأحرف — `MEASUREMENT_UNIT_FIELD_SUFFIX_RE`
 * أدناه)، أينما ظهر في شجرة `findings`/`categoryStates` كاملةً (مشي
 * متكرّر، لا قائمة مواضع ولا قائمة أسماء). حقل جديد بأي اسم منتهٍ بـ"unit"
 * على أي عمق مستقبلاً يدخل تلقائياً بلا تعديل كود — لا حتى إضافة اسمه
 * إلى مجموعة.
 *
 * **لماذا لاحقة لا احتواء** (`/unit$/i` لا `/unit/i`): الاحتواء كان
 * سيلتقط `unitSource`/`unitCaveat` أيضاً (يبدآن بـ"unit" لكن لا ينتهيان
 * به) — وهما **ليسا وحدة فعلياً** (مُتحقَّق بمشي فعلي على شجرة
 * `{findings, categoryStates}` الحقيقية لكلا فِخّي b45c8cf6/34dff2b8،
 * راجع تقرير المهمّة لقائمة كل مفتاح تطابقه القاعدة):
 *   • `unit`/`rawValueUnit`/`evidenceUnit` (تنتهي بـ"unit") — رموز وحدة
 *     حقيقية دائماً ("°C/Wh"، "mΩ"، "mAh"، "GHz"، "IOPS"، "%/min"، إلخ).
 *   • `unitSource` (لا تنتهي بـ"unit" — تنتهي بـ"Source") — قيمها
 *     الفعليتان "MISSING"/"ABSENT" (حالة توفّر الوحدة، لا الوحدة نفسها).
 *     لو أُدرِجت كانت ستُضيف "missing"/"absent" (كلمتان إنجليزيتان
 *     شائعتان) إلى المسموح زوراً.
 *   • `unitCaveat` (لا تنتهي بـ"unit" — تنتهي بـ"Caveat") — قيمته جملة
 *     عربية كاملة (تحفّظ قياس)، لا رمز وحدة.
 * القاعدة اللاحقة تُميّز الثلاثة الأولى عن الأخيرين **بنيوياً بالاسم
 * وحده**، بلا قائمة صريحة لأيّ منهما.
 *
 * @param {Object} findings مخرَج computeFindings
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {Set<string>} توكِنز مسموحة (lowercase)
 */
const MEASUREMENT_UNIT_FIELD_SUFFIX_RE = /unit$/i;

function collectMeasurementUnitTokens(findings, categoryStates) {
  const tokens = new Set();
  function addTokensFrom(str) {
    LEAK_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = LEAK_TOKEN_RE.exec(str)) !== null) tokens.add(m[0].toLowerCase());
  }
  function walk(node) {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (MEASUREMENT_UNIT_FIELD_SUFFIX_RE.test(k) && typeof v === 'string') {
        addTokensFrom(v);
      } else if (v && typeof v === 'object') {
        walk(v);
      }
    }
  }
  walk(findings);
  walk(categoryStates);
  return tokens;
}

// ~~النسخة القديمة (قبل 2026-09-23 +03) — قائمة مواضع مُسمّاة، لا حقول.
// مُبقاة موسومة لا محذوفة (القاعدة 8) — راجع تعليق collectMeasurementUnitTokens
// أعلاه لسبب استبدالها كاملاً:~~
// ~~function collectMeasurementUnitTokens(categoryStates) {~~
// ~~  const trs = (categoryStates && Array.isArray(categoryStates.testResults)) ? categoryStates.testResults : [];~~
// ~~  for (const tr of trs) {~~
// ~~    if (tr && typeof tr.evidenceUnit === 'string') addTokensFrom(tr.evidenceUnit);~~
// ~~    if (tr && tr.raw && typeof tr.raw.rawValueUnit === 'string') addTokensFrom(tr.raw.rawValueUnit);~~
// ~~  }~~
// ~~  const issues = (categoryStates && Array.isArray(categoryStates.issues)) ? categoryStates.issues : [];~~
// ~~  for (const it of issues) {~~
// ~~    if (it && typeof it.evidenceUnit === 'string') addTokensFrom(it.evidenceUnit);~~
// ~~  }~~
// ~~}~~

// ─── فئة سادسة (خامسة زائدة عن الأربع الأصليّة، بعد measurement_unit) ───
// أمر المهمّة 2026-09-22 +03، البند ٢: "معرّفات منصّة حرفية، مشتقّاً من
// مصدر في الكود لا من قائمة نصّية إن أمكن. وإن تعذّر، قائمة صريحة موسومة."
// التسرّبات الثلاثة المرصودة فعلياً (نداءا 2026-09-22، guard.languageLeaks
// على b45c8cf6): REQUEST/INSTALL/PACKAGES (narrative.issueDescriptions[
// DISC-SEC-07]) · READ/PHONE (narrative.issueDescriptions[DISC-N-04]) ·
// Bluetooth (narrative.issueDescriptions[POS-wireless]).
//
// ثلاثة مصادر معاً، **كلّها من الكود/بيانات الفحص الفعلي — لا سرد يدوي
// لأيّ من الأسماء الثلاثة نفسها**:
//   ١. tr.permission — الحقل البنيوي الذي تكتبه testKinds.js
//      (permissionForNotTested عبر PERMISSION_DENIED_PREFIXES، قيمته أحد
//      ثلاثة ثوابت android.permission.* مكتوبة في الكود هناك فعلاً، لا
//      هنا) — يغطّي READ_PHONE_STATE (ويُغطّي CAMERA/ACCESS_FINE_LOCATION
//      معه) تلقائياً؛ إذن رابع يُضاف لتلك القائمة مستقبلاً يدخل هنا بلا
//      تعديل كود إضافي.
//   ٢. نمط android.permission.<CONST> **عام** (لا قيمة بعينها) مُستخرَج من
//      tr.raw.notes — يغطّي REQUEST_INSTALL_PACKAGES (SEC-07، notes="Need
//      to declare android.permission.REQUEST_INSTALL_PACKAGES to call this
//      api"، تحقّق: functions/test/fixtures/golden/
//      functionalResults-by-scanid.json) بلا قائمة أذونات إضافية — أي
//      معرّف إذن آخر بنفس نمط الرسالة (استثناء أمان قياسي من نظام
//      التشغيل) يدخل تلقائياً.
//   ٣. tr.raw.componentName لاختبارات kind≠MEASUREMENT — **لا مصدر كود
//      أضيق متاح** لهذه الحالة تحديداً (Bluetooth، N-11.componentName —
//      اسم مزايا لاسلكية يبقى إنجليزياً حتى في التسمية التركية، ليس معرّف
//      إذن). هذا أقرب "مصدر في الكود" متاح فعلياً — حقل بنيوي قائم أصلاً
//      في raw لكل اختبار، لا سلسلة أُضيفت هنا خصّيصاً لهذا الاسم.
const ANDROID_PERMISSION_CONST_RE = /android\.permission\.[A-Z_]+/g;

/**
 * فئة ٦ (معرّفات منصّة حرفية) — راجع تعليق رأس هذا القسم للمصادر الثلاثة.
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {Set<string>} توكِنز مسموحة (lowercase)
 */
function collectPlatformIdentifierTokens(categoryStates) {
  const tokens = new Set();
  function addTokensFrom(str) {
    LEAK_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = LEAK_TOKEN_RE.exec(str)) !== null) tokens.add(m[0].toLowerCase());
  }
  const trs = (categoryStates && Array.isArray(categoryStates.testResults)) ? categoryStates.testResults : [];
  for (const tr of trs) {
    if (!tr) continue;
    if (typeof tr.permission === 'string') addTokensFrom(tr.permission); // مصدر ١
    const notes = (tr.raw && typeof tr.raw.notes === 'string') ? tr.raw.notes : '';
    if (notes) {
      ANDROID_PERMISSION_CONST_RE.lastIndex = 0;
      let pm;
      while ((pm = ANDROID_PERMISSION_CONST_RE.exec(notes)) !== null) addTokensFrom(pm[0]); // مصدر ٢
    }
    if (tr.kind !== 'MEASUREMENT' && tr.raw && typeof tr.raw.componentName === 'string') {
      addTokensFrom(tr.raw.componentName); // مصدر ٣
    }
  }
  return tokens;
}

/**
 * يبني فهرس استثناء توكِنز اللغة الكامل (الفئات ٢‏-٤ + توكِنز فئة ١ +
 * measurement_unit وplatform_identifier الزائدتين) — توكِن → اسم الفئة،
 * للتسجيل في مخرَج الحارس (القاعدة: "القوائم تُسجَّل في المخرَج"). لا
 * يستثني شيئاً بلا مصدر مُسمّى.
 * @param {Object} ctx {findings, categoryStates} — كلاهما اختياري
 * @return {Map<string, string>} توكِن (lowercase) → فئة الاستثناء
 */
function buildLeakExemptionIndex(ctx) {
  const c = ctx || {};
  const index = new Map();
  for (const t of UNIT_LEAK_TOKENS) index.set(t, 'unit_symbol'); // فئة ٤
  for (const t of ALLOWED_LATIN_LEAK_TOKENS) if (!index.has(t)) index.set(t, 'allowed_latin'); // قرار 2026-10-07 — صريحة قبل فئات البيانات
  if (c.findings || c.categoryStates) {
    for (const t of collectFindingsFieldNameTokens(c.findings, c.categoryStates)) {
      if (!index.has(t)) index.set(t, 'findings_field_name'); // فئة ٢
    }
  }
  if (c.findings || c.categoryStates) {
    for (const t of collectGateNameTokens(c.findings, c.categoryStates)) {
      if (!index.has(t)) index.set(t, 'gate_name'); // فئة ٣
    }
  }
  if (c.findings || c.categoryStates) {
    // تحديث 2026-09-23 +03 — تمشي findings وcategoryStates معاً الآن
    // (كانت categoryStates وحدها) — راجع تعليق collectMeasurementUnitTokens.
    for (const t of collectMeasurementUnitTokens(c.findings, c.categoryStates)) {
      if (!index.has(t)) index.set(t, 'measurement_unit'); // خامسة زائدة
    }
  }
  if (c.categoryStates) {
    const dev = collectDeviceReference(c.categoryStates);
    for (const t of dev.tokens) {
      if (!index.has(t)) index.set(t, 'device_spec'); // فئة ١
    }
    for (const t of collectPlatformIdentifierTokens(c.categoryStates)) {
      if (!index.has(t)) index.set(t, 'platform_identifier'); // سادسة زائدة (هذه المهمّة)
    }
  }
  return index;
}

/**
 * هل رقم مُستخرَج من النصّ يطابق (±تقريب) رقماً مرجعياً؟ التقريب: فرق
 * مطلق ≤ 0.05 (يستوعب toFixed(1)/(2) القياسية) أو فرق نسبي ≤ 1% أيّهما
 * أكبر تساهلاً — كلاهما "تقريب معقول" لا نطاق حكم (لا عتبة قرار هنا، هذا
 * تسامح مطابقة رقمية بحتة، مختلف عن عتبات categoryStates/thresholdSet).
 * @param {number} n الرقم من النصّ
 * @param {Set<number>} refSet المجموعة المرجعية
 * @return {boolean}
 */
function numberMatches(n, refSet) {
  if (refSet.has(n)) return true;
  for (const ref of refSet) {
    const absTol = Math.max(0.05, Math.abs(ref) * 0.01);
    if (Math.abs(n - ref) <= absTol) return true;
  }
  return false;
}

/**
 * يفحص كل حقول نصّ حرّة في مخرَج النموذج مقابل الأرقام المرجعية. حقل فيه
 * رقم واحد غير مطابق → اسمه في unmatchedFields (نصّ P1.4: "غير المطابق
 * يُرفض حقله ويُعاد توليده" — الرفض والتوليد فعل المستدعي، هذه الدالّة
 * تُحدِّد فقط ماذا يُرفَض).
 *
 * معايرة v7.1: رقم لا يطابق refSet (Findings/categoryStates، القياس وحده)
 * يُمنَح فرصة ثانية مقابل device (STATE/SPEC وحدها — فئة ١، هوّية جهاز لا
 * قياس). لم يُمسّ numberMatches ولا extractNumbers ولا refSet نفسها — هذا
 * مصدر مرجعي **إضافي منفصل**، لا تخفيف على المصدر الأصلي (القاعدة: "أي
 * رقم قياس يبقى مطلوب المطابقة بقيمة في Findings ±التقريب... لا يُمَسّ").
 * رقم لا يطابق أيّاً منهما يبقى مرفوضاً — "لا استثناء أعمى".
 * @param {Object} parsed مخرَج النموذج (بعد اجتياز validateV7Shape شكلياً)
 * @param {Object} findings مخرَج computeFindings
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @return {{ok: boolean, unmatchedFields: Array<{field: string, numbers: number[]}>,
 *   excludedDevice: Array<{field: string, number: number}>}}
 */
function validateNumberGrounding(parsed, findings, categoryStates) {
  const refSet = collectReferenceNumbers(findings, categoryStates);
  const deviceRef = collectDeviceReference(categoryStates).numbers; // فئة ١
  const unmatchedFields = [];
  const excludedDevice = [];

  function check(field, text) {
    const nums = extractNumbers(text);
    const bad = [];
    for (const n of nums) {
      if (numberMatches(n, refSet)) continue; // مقبول — قياس حقيقي
      if (numberMatches(n, deviceRef)) { excludedDevice.push({field, number: n}); continue; } // فئة ١
      bad.push(n); // لا مصدر له في أيّ منهما — يبقى مرفوضاً
    }
    if (bad.length) unmatchedFields.push({field, numbers: bad});
  }

  const nar = parsed && parsed.narrative;
  if (nar && typeof nar === 'object') {
    check('narrative.summary', nar.summary);
    check('narrative.details', nar.details);
    check('narrative.verdict', nar.verdict);
    // القرار ٢٤ — buyerAdvice كائن بثلاثة ملفّات، كلّ واحد يُفحَص على حدة
    // (اسم الحقل المرفوض يُسجَّل بدقّة: أيّ ملفّ تحديداً حمل رقماً مُختلَقاً).
    if (nar.buyerAdvice && typeof nar.buyerAdvice === 'object' && !Array.isArray(nar.buyerAdvice)) {
      for (const profile of BUYER_ADVICE_PROFILES) {
        check(`narrative.buyerAdvice.${profile}`, nar.buyerAdvice[profile]);
      }
    }
    if (nar.issueDescriptions && typeof nar.issueDescriptions === 'object') {
      for (const [id, text] of Object.entries(nar.issueDescriptions)) {
        check(`narrative.issueDescriptions[${id}]`, text);
      }
    }
  }
  (Array.isArray(parsed && parsed.crossChecks) ? parsed.crossChecks : []).forEach((c, i) => {
    check(`crossChecks[${i}].description`, c && c.description);
  });
  (Array.isArray(parsed && parsed.adjustments) ? parsed.adjustments : []).forEach((a, i) => {
    check(`adjustments[${i}].reason`, a && a.reason);
  });
  (Array.isArray(parsed && parsed.modelObservations) ? parsed.modelObservations : []).forEach((o, i) => {
    check(`modelObservations[${i}].text`, o && o.text);
  });

  return {ok: unmatchedFields.length === 0, unmatchedFields, excludedDevice};
}

// ─── 3. اللغة — إعادة استعمال findEnglishLeaks (لا نسخة جديدة من القاموس) ─

/**
 * يجمع كل الحقول النصّية الحرّة من مخرَج V7 لفحص تسرّب الإنجليزية —
 * يستعمل findEnglishLeaks من languageValidator.js (مصدر واحد للقاموس؛
 * راجع رأس reportShape.js عن كلفة تكرار هذا المنطق سابقاً).
 *
 * معايرة v7.1: توكِن يرِد من findEnglishLeaks (أي ليس معفوّاً أصلاً بـ
 * isAllowedToken هناك) يُمنَح فحصاً إضافياً مقابل buildLeakExemptionIndex
 * (الفئات ١-٤ أعلاه، مُشتقّة من ctx.findings/ctx.categoryStates الفعليَّين
 * لهذا الفحص). ctx اختياري — بغيابه (كما في اختبارات الوحدة الاصطناعية
 * القديمة) لا استثناء إضافي إلا فئة ٤ الثابتة (الوحدات، لا تحتاج ctx).
 * languageValidator.js/findEnglishLeaks لم يُمسّا — هذه طبقة استثناء إضافية
 * فوقهما، لا قاموس ثانٍ ولا تعديل على القاموس الأصلي.
 * @param {Object} parsed مخرَج النموذج
 * @param {Object} [ctx] {findings, categoryStates} — لفئات ١-٣
 * @return {{leaks: Array<{path: string, tokens: string[]}>,
 *   excluded: Array<{path: string, token: string, category: string}>}}
 */
function computeLeaksV7(parsed, ctx) {
  const exemptIndex = buildLeakExemptionIndex(ctx);
  const leaks = [];
  const excluded = [];
  function push(path, text) {
    const rawTokens = findEnglishLeaks(text);
    const kept = [];
    for (const t of rawTokens) {
      const category = exemptIndex.get(t.toLowerCase());
      if (category) {
        excluded.push({path, token: t, category});
      } else {
        kept.push(t);
      }
    }
    const uniqKept = Array.from(new Set(kept));
    if (uniqKept.length) leaks.push({path, tokens: uniqKept});
  }
  const nar = parsed && parsed.narrative;
  if (nar && typeof nar === 'object') {
    push('narrative.summary', nar.summary);
    push('narrative.details', nar.details);
    push('narrative.verdict', nar.verdict);
    // القرار ٢٤ — ثلاثة حقول نصّية مستقلّة بدل حقل واحد.
    if (nar.buyerAdvice && typeof nar.buyerAdvice === 'object' && !Array.isArray(nar.buyerAdvice)) {
      for (const profile of BUYER_ADVICE_PROFILES) push(`narrative.buyerAdvice.${profile}`, nar.buyerAdvice[profile]);
    }
    if (nar.issueDescriptions && typeof nar.issueDescriptions === 'object') {
      for (const [id, text] of Object.entries(nar.issueDescriptions)) push(`narrative.issueDescriptions[${id}]`, text);
    }
  }
  (Array.isArray(parsed && parsed.crossChecks) ? parsed.crossChecks : []).forEach((c, i) => push(`crossChecks[${i}].description`, c && c.description));
  (Array.isArray(parsed && parsed.adjustments) ? parsed.adjustments : []).forEach((a, i) => push(`adjustments[${i}].reason`, a && a.reason));
  (Array.isArray(parsed && parsed.modelObservations) ? parsed.modelObservations : []).forEach((o, i) => push(`modelObservations[${i}].text`, o && o.text));
  return {leaks, excluded};
}

/**
 * غلاف يبقي التوقيع/الشكل القديمَين (مصفوفة leaks فقط) لتوافق خلفي مع
 * reportShapeV7.test.js القائم — راجع computeLeaksV7 للمنطق واستثناءات
 * الفئات ١-٤. ctx اختياري بقصد (الاختبارات الاصطناعية القديمة تستدعيه
 * بوسيط واحد).
 * @param {Object} parsed مخرَج النموذج
 * @param {Object} [ctx] {findings, categoryStates}
 * @return {Array<{path: string, tokens: string[]}>} الحقول المتسرّبة
 */
function detectEnglishLeaksV7(parsed, ctx) {
  return computeLeaksV7(parsed, ctx).leaks;
}

// ─── 4. نقطة تجميع — حارس واحد يستهلكه callAIv7 ─────────────────────────

// أمر مستخدم 2026-10-01 +03، القرار ٤ "حارس details" (بنصّه): "الخرق في
// narrative.details (أرقام أو لاتيني) يُسجَّل في aiAudit ولا يُرفض الردّ
// بسببه. وسائر الحقول على حالها." التعليل: أربعة رفضات حقيقية أولى كلّها
// وقعت في details (90، و21 مرّتين، و"attery") — وdetails محجوب عن
// المشتري أصلاً (القرار S6) — فكل رفض كان يكلّف محاولة كاملة (77-85
// ثانية) لنصّ لا يُعرض أبداً. مصدر واحد للاسم الحرفي (القاعدة 24).
const DETAILS_WAIVED_FIELD_PATH = 'narrative.details';

/**
 * الحارس الكامل: شكل + حضور معرّفات الأعطال الحقيقية + مطابقة أرقام +
 * لغة. لا يرمي — يُعيد تقريراً مُفصَّلاً، والمستدعي يقرّر (رفض الحقل/إعادة
 * التوليد/القبول).
 *
 * .excluded (معايرة v7.1): ما استُثني ولأي سبب — الفئات الأربع مُسجَّلة
 * صراحة (لا تُخمَّن من الكود): deviceSpecNumbers (فئة ١، أرقام) +
 * languageTokens (فئات ١-٤ مجتمعة، كل عنصر يحمل .category).
 *
 * .detailsWaived (أمر مستخدم 2026-10-01 +03، القرار ٤) — خرق أرقام أو
 * لغة وقع في narrative.details تحديداً وحده: لا يُسقط .ok (محجوب عن
 * المشتير، القرار S6) — لكنه **لا يُحذَف من .numbers/.languageLeaks**
 * (تلك تبقيان الصورة الكاملة الحقيقية لكل ما وقع، للتدقيق) — `.detailsWaived`
 * حقل إضافي منفصل يسرد *ما أُسقِط تحديداً من حساب .ok* صراحة، ليكتبه
 * المستدعي في aiAudit (القاعدة 25 — حقل جديد، كل قارئ يُحدَّث).
 * @param {Object} parsed مخرَج النموذج الخام
 * @param {Object} ctx {findings, categoryStates}
 * @return {Object} تقرير الحارس الكامل
 */
function guardV7Response(parsed, ctx) {
  const shape = validateV7Shape(parsed);
  const issueKeys = validateIssueDescriptionKeys(parsed, ctx && ctx.categoryStates);
  const numbers = shape.ok ? validateNumberGrounding(parsed, ctx && ctx.findings, ctx && ctx.categoryStates) :
      {ok: false, unmatchedFields: [], excludedDevice: []};
  const leaksResult = shape.ok ? computeLeaksV7(parsed, ctx) : {leaks: [], excluded: []};

  const detailsNumberViolation = numbers.unmatchedFields.find((f) => f.field === DETAILS_WAIVED_FIELD_PATH) || null;
  const detailsLeakViolation = leaksResult.leaks.find((l) => l.path === DETAILS_WAIVED_FIELD_PATH) || null;
  const nonDetailsNumbersOk = numbers.unmatchedFields.every((f) => f.field === DETAILS_WAIVED_FIELD_PATH);
  const nonDetailsLeaksOk = leaksResult.leaks.every((l) => l.path === DETAILS_WAIVED_FIELD_PATH);

  return {
    // numbers.ok/leaksResult الأصليّان (قبل الإعفاء) لا يكفيان وحدهما —
    // nonDetailsNumbersOk/nonDetailsLeaksOk يُعيدان حساب "هل تبقّى خرق
    // خارج details" صراحة (لا نقص .ok الأصليّين في المكان، فيبقيان مرجعاً
    // كاملاً دقيقاً في .numbers/.languageLeaks أدناه).
    ok: shape.ok && issueKeys.ok && nonDetailsNumbersOk && nonDetailsLeaksOk,
    shape,
    issueKeys,
    numbers,
    languageLeaks: leaksResult.leaks,
    detailsWaived: (detailsNumberViolation || detailsLeakViolation) ? {
      numbers: detailsNumberViolation ? detailsNumberViolation.numbers : [],
      languageTokens: detailsLeakViolation ? detailsLeakViolation.tokens : [],
    } : null,
    excluded: {
      deviceSpecNumbers: numbers.excludedDevice || [], // فئة ١ (أرقام)
      languageTokens: leaksResult.excluded, // فئات ١-٤ (لغة) — كل عنصر .category
    },
  };
}

module.exports = {
  validateV7Shape,
  validateIssueDescriptionKeys,
  extractNumbers,
  collectReferenceNumbers,
  collectDeviceReference,
  collectFindingsFieldNameTokens,
  collectGateNameTokens,
  collectMeasurementUnitTokens,
  buildLeakExemptionIndex,
  numberMatches,
  validateNumberGrounding,
  detectEnglishLeaksV7,
  computeLeaksV7,
  guardV7Response,
  DETAILS_WAIVED_FIELD_PATH,
  FORBIDDEN_TOP_LEVEL_KEYS,
  V7_SHAPE_KEYS,
  V7_CORE_KEY_GROUPS,
  MAX_MODEL_OBSERVATIONS,
  UNIT_LEAK_TOKENS,
  BUYER_ADVICE_PROFILES,
};
