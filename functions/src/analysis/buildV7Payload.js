// ===================================================
// buildV7Payload — يبني حمولة النموذج من Findings + الثلاثيات + الحالات،
// بلا samples (P1.4، PLAN-01-ROADMAP.md "P1.4 البرومبت v7")
// ===================================================
//
// نصّ المهمّة حرفياً: "callAI.js:143-166 يبني الحمولة من Findings +
// الثلاثيات + الحالات (بلا samples)". هذا الملف هو تلك الدالّة، معزولة
// وقابلة للاختبار بلا استدعاء نموذج (بنفس نمط findings.js/categoryStates.js:
// وحدة حتمية قائمة بذاتها، تُستهلَك من callAI.js).
//
// ─── الفرق الجوهري عن callAI.js:145-156 (V6) ────────────────────────────
// V6 كان يبني rawFingerprintForAi = {header, footer, samples, variables,
// functionalResults, manualResults, device, ...} — العيّنات الخام كاملة.
// V7 لا يحمل samples إطلاقاً بحكم البناء: findings/testResults/
// categoryStates مُشتقّة مسبقاً من samples في findings.js/categoryStates.js
// (تحقّق آلي أدناه: assertNoRawSamples ترمي إن تسرّبت مصفوفة عيّنات خام
// بالغلط في أي مكان في الحمولة الناتجة).
//
// ─── ما يدخل الحمولة، وما لا يدخل ───────────────────────────────────────
//   findings         — كما أنتجه computeFindings() حرفياً (P1.1). يحمل
//                       بالفعل thresholdSet وnotMeasuredFields — لا حاجة
//                       لتكرارهما.
//   testResults      — categoryStates.testResults (P1.4 إضافة): كل
//                       TestResult ثلاثي {outcome, notMeasuredReason,
//                       evidence, confidence} + {testId, kind, category}.
//   categoryStates   — {categories, overall, issues} فقط من مخرَج
//                       computeCategoryStates — **لا testResults مكرَّرة
//                       هنا** (أُرسلت أعلى مستوى فقط، بند "نصّ المهمّة:
//                       الثلاثيات" منفصل عن "الحالات").
//   scanId/language/isFreeTrial/previousScan — كما في V6، بلا تغيير.
// ===================================================

'use strict';

const {CATEGORIES} = require('../utils/categories');
const {deriveOverallFromCategories} = require('./categoryStates');
const {BAND_MAX} = require('./rebuildCategoryScores');
// القرار ٤٤ (القاعدة 24): مصدر الحقيقة الوحيد للرمز أدناه، مشترَك مع نصّ
// categoryStates.js (noLetterReason) — راجع categoryGradingLock.js.
const {CATEGORY_GRADING_LOCKED_CODE} = require('./categoryGradingLock');
// أمر مستخدم 2026-10-01 +03 ("الحمولة لا تحمل قيم ما ليس معايَراً") —
// مجموعتا معرّفات الاختبارات غير المعايَرة (مصدر واحد، القاعدة 24 — لا
// نسخة ثانية من 'T-01'/'T-02'/'C-07'/'S-06' هنا).
// S-M02 (2026-10-18): مفاتيح raw.measurements التي لا تصل النموذج (خامّ M-02 fv71) — مصدر واحد، القاعدة 24.
const {MODEL_HIDDEN_RAW_MEASUREMENT_KEYS} = require('./fv68Names');
const {
  THERMAL_UNCALIBRATED_IDS, UNCALIBRATED_THRESHOLD_IDS, UNSTABLE_IDS, USER_SETTING_IDS, USER_CONTENT_OR_RUNTIME_IDS,
  BATTERY_STATE_TEST_IDS, APP_CONSTANT_NOT_READ_IDS,
} = require('./testKinds');

// القرار ٩٤ البند ١ (2026-09-25 +03) — انظر أسفل الملفّ عند isProvenSupportiveEvidence
// للتفصيل الكامل: أُغلق باب الحرف/حالة الفئة/البوّابة دليلاً — الشقّ
// الوحيد الباقي outcome==='FAIL' لاختبار من نفس الفئة، أو finding مربوط
// بخريطة صريحة (لا خريطة اليوم).
//
// ═══════════════════════════════════════════════════════════════════════
// القرار — «مخرَج عملية لا يُغذّى مدخلاً لها» (قرار مستخدم 2026-09-22 +03).
// تاريخ القرار الكامل (لماذا كل حقل استُبعِد، جولة بجولة: الخمسة، ثم
// llmOverall، ثم حقلا gate) انتقل إلى `./v7ModelPayloadWhitelist.js` —
// **مصدر الحقيقة الآن لأي حقل داخل `categoryStates` يصل/لا يصل حمولة
// النموذج** (أمر مستخدم 2026-09-23 +03، البند ١: "قائمة بيضاء عند
// البناء... يُعمَّم لا يُخترَع"، نفس نمط A104 — `analyzeDevice.js:61`
// `buildCategoryEntryForStorage`). راجع ذلك الملفّ للتفصيل الكامل حقلاً
// حقلاً وسبب كل استبعاد (finalLetter/adjustmentEvidence/adjustmentReason/
// adjustmentApplied/llmSuggestedLetter/llmOverall/belowThreshold/
// allNonMeasurement) وسبب إبقاء كل حقل آخر (`score`/`source`/
// `coveragePct`/NOT_FIRED/إلخ) — بما فيها تصحيح مُقَرّ من المستخدم
// (2026-09-23 +03): ادّعاء سابق أن نسخ `categories.<cat>.gatesApplied`
// "مكرَّرة حرفياً" مع `overall.gatesApplied` كان **منفياً بالقياس**
// (`cappedThisLetter`/`cappedOverall`/`note` قد تختلف فعلياً على نفس
// البوّابة) — **لا حذف لأيّ نسخة**.
//
// **الآلية الآن قائمة بيضاء لا استبعاد**: `buildModelCategories`/
// `buildModelOverall`/`buildModelIssues` (من `v7ModelPayloadWhitelist.js`)
// تبني كل مستوى من حقول **مُسمّاة صراحة**، لا نسخة من كل شيء ناقصةً ما
// يُستبعَد — هذا ما يمنع تكرار القاعدة 33 (وقعت ثلاث مرّات على هذه
// الشجرة بالذات: الحقول السبعة، ثم llmOverall، ثم حقلا gate). `findings`
// و`testResults` **لا قائمة بيضاء لهما** — يمرّان كما هما (قرار مستخدم
// صريح: مفاتيحهما ديناميكية بالكود — راجع تعليق رأس
// `v7ModelPayloadWhitelist.js`).
//
// **مُتحقَّق بتشغيل فعلي أن القائمة البيضاء تُنتج نفس البايتات حرفاً بحرف
// (===) التي كان يُنتجها الاستبعاد** — راجع
// `functions/scripts/measure-whitelist-vs-exclusion-equality.js` ومخرَجه
// المحفوظ في `functions/scripts/out/`، وتقرير هذه المهمّة.
const {
  buildModelCategories, buildModelOverall, buildModelIssues,
  MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS, MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS,
  MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS,
  MODEL_STATE_TEXT,
} = require('./v7ModelPayloadWhitelist');

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-09-25 +03 (القرار ٨٨ البند ٢): "الاختبار الذي قُلبت
// نتيجته إلى ENVIRONMENT_UNSUITABLE يُحذف منه raw.status الخام في حمولة
// النموذج، ويبقى فيه outcome بعد القلب." التعليل: "النموذج يرى اليوم
// raw.status:'fail' بجوار outcome:'NOT_MEASURED'، فقد يكتب في السرد فشلاً
// لا يعدّه الخادم فشلاً."
//
// مصدر التمييز الوحيد (القاعدة 24): `r.notMeasuredReason ===
// 'ENVIRONMENT_UNSUITABLE'` — نفس الحقل الذي تكتبه toTestResult
// (testKinds.js) فعلياً على كل معرِّف في ENVIRONMENT_EFFECT_IDS، بلا
// استيراد تلك القائمة هنا ثانيةً (لا نسخة ثانية من "أيّها مقلوب" —
// notMeasuredReason هو الأثر المُلاحَظ لا السبب المُصنَّف، ويكفي وحده).
//
// **لا يمسّ سواه**: `raw` نفسها تبقى (rawValue/rawValueUnit/categoryName/
// componentName/testId) — الحذف يخصّ `status` وحدها (نصّ الأمر: "يُحذف
// منه raw.status"). `outcome` (بعد القلب — NOT_MEASURED) يبقى كما هو،
// وكذلك notMeasuredReason/displayValueDespiteNotMeasured — هذه كلّها
// الإعلان الصريح الذي يجب أن يراه النموذج، لا الحالة الخام المتناقضة معه.
//
// ─── من يقرأ testResults[i].raw.status اليوم (القاعدة 34 — كل قارئ) ───
//   • buildV7Payload (هنا) — القارئ الوحيد الذي يُخرجه إلى النموذج؛ بعد
//     هذا الإصلاح لا يُخرجه لعناصر ENVIRONMENT_UNSUITABLE.
//   • applyV7Adjustments (evaluateEvidenceRef، أسفل هذا الملفّ) — يقرأ
//     raw.status حين يُشار إليه صراحةً بمرجع دليل (evidenceRefs) — يقرأ
//     **categoryStates الأصلية غير المُعدَّلة** (الوسيط الأوّل الممرَّر
//     من resolveV7Report.js:442، لا body.testResults المُصفَّاة هنا) —
//     فلا يتأثّر بهذا الإصلاح إطلاقاً؛ لا يزال يرفض raw.status='fail'
//     بنفس السبب (lastKeyName='status' يتطلّب 'FIRED' حصراً) بصرف النظر
//     عمّا وصل النموذج — مُتحقَّق: buildV7AdjustmentsWiring.test.js §٤
//     وbuildV7Payload.test.js §3-ب يبقيان صحيحين بعد هذا التغيير (لم
//     يُعدَّلا لأجله).
//   • لا قارئ آخر لـ.raw.status في functions/src (تحقّق: grep "raw.status"
//     على src/ — صفر نتيجة خارج هذا الملفّ نفسه، القرار الحالي).
//
// @param {Array} testResults كما وصلت من categoryStates.testResults —
//   غير مُعدَّلة في المكان (نسخة جديدة تُعاد).
// @return {Array} نسخة جديدة — عناصر ENVIRONMENT_UNSUITABLE بلا raw.status.
// أمر مستخدم 2026-10-06 (المبدأ: «لا تصل إلى النموذج قيمة لا يُبنى عليها حرف
// ولا عتبة معايَرة لها. يصله عنها «مقيس» أو «غير مقيس» وحده») — الاختبارات «خارج
// الحرف» المُسمّاة تصل بحالتها وحدها. مجموعتان، مصدر كل منهما مُصدَّر من
// testKinds.js (القاعدة 24 — لا نسخة ثانية من المعرّفات هنا):
//   غير معايَر: THERMAL_UNCALIBRATED_IDS (T-01/T-02) + UNCALIBRATED_THRESHOLD_IDS (C-07/S-06)
//   غير مستقرّ: UNSTABLE_IDS (C-03/C-04/S-04/S-05 — «تدخل القائمة المحجوبة»، أمر 2026-10-06 ٣)
// أمر مستخدم 2026-10-07 +03 (قرار القوائم) — ثلاث معاملات لاختبارات خارج الحرف، مصدر كل مجموعة مُصدَّر من testKinds.js:
//   حجب كامل (الحالة «مقيس»/«غير مقيس» + القيمة): غير المعايَر + UNSTABLE + المحتوى والتشغيل (S-02/R-02/R-03، بالمبدأ)
//     + B-01..B-07 (قائمة الأعطال تُحسب في الخادم ولا تتغيّر).
//   حجب الحكم وحده، تبقى القيمة (الخيار أ): إعدادات الجهاز SEC-01/05/06/07 وL-01 وCM-08 — «القيمة حقيقة، والحالة حكم».
//   دائماً «غير مقيس» مهما وصل: SEC-08 (التطبيق 1.0.9 يرسل «مفعّل» ثابتة دون قراءة).
// تبقى كما هي: SPEC (T-04/CM-11/B-08 — «المواصفة ليست قياساً») وهويّة الجهاز.
// لو انتمى اختبار إلى مجموعتين: القائمة المُسمّاة بمعرّفاتها تغلب الصنف العامّ (راجع تقرير الجولة: B-02/B-07 هويّة داخل B-xx).
const UNCALIBRATED_TEST_IDS = Object.freeze([...THERMAL_UNCALIBRATED_IDS, ...UNCALIBRATED_THRESHOLD_IDS]);
const MODEL_HIDDEN_TEST_IDS = Object.freeze([
    ...UNCALIBRATED_TEST_IDS, ...UNSTABLE_IDS, ...USER_CONTENT_OR_RUNTIME_IDS, ...BATTERY_STATE_TEST_IDS]);
const MODEL_JUDGMENT_HIDDEN_TEST_IDS = USER_SETTING_IDS;
const MODEL_ALWAYS_NOT_MEASURED_TEST_IDS = APP_CONSTANT_NOT_READ_IDS;

// «توجد قيمة» = outcome منفَّذ فعلاً (نفس تعريف الكود لـexecuted، categoryStates.js
// computeHealthBearingStats:487) — مصدر الحقيقة للتمييز بين «مقيس» و«غير مقيس».
const MEASURED_OUTCOMES = Object.freeze(['PASS', 'FAIL', 'WARNING']);
function testResultHasMeasuredValue(r) {
  return !!r && MEASURED_OUTCOMES.includes(r.outcome);
}
// نظيره لعنصر findings.advisoryMeasurements (حقل testStatus
// الخام لا outcome): found===true ونتيجة pass/fail/warning.
function taggedMeasurementHasValue(e) {
  return !!e && e.found === true &&
      ['pass', 'fail', 'warning'].includes(String(e.testStatus || '').toLowerCase());
}

/**
 * اختبار «خارج الحرف» يصل النموذج بحالته وحدها: outcome وraw.status = «مقيس»/«غير
 * مقيس» (لا PASS/WARNING/FAIL — «warning» حكم من عتبة غير معايَرة)، وrawValue
 * وevidence (نسخة منه — D1) تُحجبان **حين توجد قيمة وحده** (D3): غير المُقاس يبقى
 * N/A كما وصل ولا يُكتب له «مقيس» (القاعدة 22). كل حقل آخر (unit، notes،
 * notMeasuredReason، kind، healthBearing…) كما هو. دالّة خالصة.
 * @param {Object} r عنصر testResults
 * @return {Object} نسخة جديدة
 */
function hideTestResultForModel(r) {
  if (!r || typeof r !== 'object') return r;
  const measured = testResultHasMeasuredValue(r);
  const stateText = measured ? MODEL_STATE_TEXT.measured : MODEL_STATE_TEXT.notMeasured;
  const out = {...r, outcome: stateText};
  if (r.raw && typeof r.raw === 'object') {
    const raw = {...r.raw};
    if ('status' in raw) raw.status = stateText;
    if (measured && 'rawValue' in raw) raw.rawValue = MODEL_STATE_TEXT.measured;
    // raw.notes قد تحمل قيمة وتصنيفاً (B-02: «known=4500 mAh, classify=full_capacity») — تُحجب حين توجد قيمة وحدها؛ نصّ سبب الغياب يبقى.
    if (measured && 'notes' in raw) raw.notes = MODEL_STATE_TEXT.measured;
    if (measured && typeof raw.rawValueUnit === 'string') raw.rawValueUnit = stripNumericUnitParens(raw.rawValueUnit);
    out.raw = raw;
  }
  if (measured && 'evidence' in out) out.evidence = MODEL_STATE_TEXT.measured;
  if (measured && typeof out.evidenceUnit === 'string') out.evidenceUnit = stripNumericUnitParens(out.evidenceUnit);
  return out;
}

// وحدة قد تحمل قيمة مضمَّنة بين قوسين (S-02: «% (71.5 GB)») — تُجرَّد القوسان الرقميّان وتبقى الوحدة («%»).
function stripNumericUnitParens(unit) {
  return unit.replace(/\s*\([^)]*\d[^)]*\)/g, '').trim();
}

/**
 * اختبار إعدادات جهاز (USER_SETTING_IDS): يُحجَب كلّ حقل يحمل حكماً — outcome وraw.status — فيصير «مقيس…»/«غير مقيس»، وتبقى
 * القيمة (raw.rawValue وevidence وraw.notes والوحدة) كما وصلت: «القيمة حقيقة، والحالة حكم» (أمر 2026-10-07، الخيار أ).
 * بحث بالأداة عن كل ناقل لحكم هذه الاختبارات في الحمولة: لا حقل غيرهما (لا قضية ISS لها لأن healthBearing=false، ولا بوّابة).
 * notMeasuredReason وpermission تصنيف سبب الغياب لا حكم على القيمة — تبقى. دالّة خالصة.
 * @param {Object} r عنصر testResults
 * @return {Object} نسخة جديدة
 */
function hideJudgmentForModel(r) {
  if (!r || typeof r !== 'object') return r;
  const stateText = testResultHasMeasuredValue(r) ? MODEL_STATE_TEXT.measured : MODEL_STATE_TEXT.notMeasured;
  const out = {...r, outcome: stateText};
  if (r.raw && typeof r.raw === 'object' && 'status' in r.raw) out.raw = {...r.raw, status: stateText};
  return out;
}

/**
 * اختبار «غير مقيس» دائماً (SEC-08): كل حقل حالة أو قيمة موجود فيه يُكتب «غير مقيس» **مهما وصل** (pass/fail/not_tested، أيّ قيمة).
 * لا حقل يُختلَق إن لم يكن موجوداً. notMeasuredReason يبقى كما وصل (لا سبب جديد يُختلَق). دالّة خالصة.
 * @param {Object} r عنصر testResults
 * @return {Object} نسخة جديدة
 */
function forceNotMeasuredForModel(r) {
  if (!r || typeof r !== 'object') return r;
  const text = MODEL_STATE_TEXT.notMeasured;
  const out = {...r, outcome: text};
  if ('evidence' in out) out.evidence = text;
  if (r.raw && typeof r.raw === 'object') {
    const raw = {...r.raw};
    for (const k of ['status', 'rawValue', 'notes']) if (k in raw) raw[k] = text;
    out.raw = raw;
  }
  return out;
}

/**
 * أمر مستخدم 2026-10-07 +03 (البند ٢): «قيمة العطل لاختبارات B-xx (مثل «48.5 °C») تُحجب في نسخة النموذج وحدها. وقائمة الأعطال
 * المخزّنة لا تتغيّر.» عنصر issues[] لاختبار من MODEL_HIDDEN_TEST_IDS (ISS-<testId>، عطب فعلي بحالة FAIL/WARNING) يحمل evidence = قيمة
 * الاختبار نفسها التي حُجبت من testResults — فتُحجب هنا أيضاً («مقيس…»)؛ evidenceUnit يبقى (رمز وحدة) بعد تجريد الأرقام المضمَّنة.
 * id وcategory وseverity وtitle بلا مساس (الخادم هو من قرّر العطل). DISC-* (غير مقيس) لا evidence له فيمرّ كما هو. دالّة خالصة.
 * @param {Array|null} issues مخرَج buildModelIssues (نسخة جديدة أصلاً)
 * @return {Array|null} نسخة جديدة
 */
function hideIssueValuesForModel(issues) {
  if (!Array.isArray(issues)) return issues;
  return issues.map((it) => {
    if (!it || typeof it !== 'object') return it;
    const m = /^ISS-(.+)$/.exec(String(it.id || ''));
    if (!m || !MODEL_HIDDEN_TEST_IDS.includes(m[1])) return it;
    const out = {...it};
    if ('evidence' in out && out.evidence !== null && out.evidence !== undefined) out.evidence = MODEL_STATE_TEXT.measured;
    if (typeof out.evidenceUnit === 'string') out.evidenceUnit = stripNumericUnitParens(out.evidenceUnit);
    return out;
  });
}

/**
 * يُسقط من raw.measurements لاختبار مسمّى (MODEL_HIDDEN_RAW_MEASUREMENT_KEYS) المفاتيح التي لا تصل النموذج، ويُبقي ما سواها كما وصل (ترتيبها وقيمها). لا يمسّ اختباراً غير مسمّى
 * ولا عنصراً بلا measurements كائناً. دالّة خالصة: نسخة جديدة فقط حين يُحذف شيء، وإلا يُعاد الكائن نفسه.
 * @param {Object} r عنصر testResults
 * @return {Object}
 */
function hideRawMeasurementKeysForModel(r) {
  if (!r || typeof r !== 'object' || !r.testId) return r;
  const hidden = MODEL_HIDDEN_RAW_MEASUREMENT_KEYS[r.testId];
  const m = r.raw && typeof r.raw === 'object' ? r.raw.measurements : undefined;
  if (!hidden || !m || typeof m !== 'object' || Array.isArray(m) || !hidden.some((k) => k in m)) return r;
  const kept = {};
  for (const [k, v] of Object.entries(m)) if (!hidden.includes(k)) kept[k] = v;
  return {...r, raw: {...r.raw, measurements: kept}};
}

function sanitizeTestResultsForModelPayload(testResults) {
  if (!Array.isArray(testResults)) return [];
  return testResults.map((r) => {
    if (!r || typeof r !== 'object') return r;
    let out = r;
    if (r.notMeasuredReason === 'ENVIRONMENT_UNSUITABLE' && r.raw && typeof r.raw === 'object' && ('status' in r.raw)) {
      const rawWithoutStatus = {...r.raw};
      delete rawWithoutStatus.status;
      out = {...out, raw: rawWithoutStatus};
    }
    if (r.testId && MODEL_HIDDEN_TEST_IDS.includes(r.testId)) out = hideTestResultForModel(out);
    else if (r.testId && MODEL_JUDGMENT_HIDDEN_TEST_IDS.includes(r.testId)) out = hideJudgmentForModel(out);
    else if (r.testId && MODEL_ALWAYS_NOT_MEASURED_TEST_IDS.includes(r.testId)) out = forceNotMeasuredForModel(out);
    // S-M02 (2026-10-18): خامّ measurements بمفاتيح fv71 (strokes…) لا يصل النموذج؛ المفاتيح القديمة تمرّ كما هي (انظر fv68Names.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS). نسخة النموذج وحدها.
    out = hideRawMeasurementKeysForModel(out);
    // قرار مستخدم 2026-10-07 +03 (بنصّه): «يُحذف حقل unstable من كل اختبار.» الحقل وسم المعيار لا خاصية الجهاز (يحمله كل اختبار: true للأربعة،
    // false لغيرها) فلا يصل النموذج لأيّ اختبار. نسخة النموذج وحدها — المخزَّن (categoryStates.testResults) لا يتغيّر.
    if ('unstable' in out) { out = {...out}; delete out.unstable; }
    return out;
  });
}

/**
 * نظير hideTestResultForModel لعناصر خريطة findings.advisoryMeasurements (المفتاح = معرّف الاختبار؛
 * خريطة unstableMeasurements لا تصل النموذج أصلاً — REMOVE، قرار 2026-10-07): حالتها وحدها — rawValue يُحجَب حين
 * توجد قيمة (D2/D3)، وtestStatus (pass/warning…) يصير «مقيس»/«غير مقيس»، وتُسقَط
 * criterion/referenceCvPct/referenceNote (وصف معيار مبدئي «يحتاج معايرة» بأرقامه —
 * لا عتبة معايَرة). عنصر found=false أو معرّفه خارج MODEL_HIDDEN_TEST_IDS يمرّ كما هو.
 * @param {Object} map {testId: entry}
 * @return {Object} نسخة جديدة
 */
function hideTaggedMeasurementsForModel(map) {
  if (!map || typeof map !== 'object') return map;
  const out = {};
  for (const [id, e] of Object.entries(map)) {
    if (!MODEL_HIDDEN_TEST_IDS.includes(id) || !e || typeof e !== 'object' || e.found !== true) {
      out[id] = e;
      continue;
    }
    const measured = taggedMeasurementHasValue(e);
    const entry = {found: true};
    if ('rawValue' in e) entry.rawValue = measured ? MODEL_STATE_TEXT.measured : e.rawValue;
    if ('rawValueUnit' in e) entry.rawValueUnit = e.rawValueUnit;
    entry.testStatus = measured ? MODEL_STATE_TEXT.measured : MODEL_STATE_TEXT.notMeasured;
    for (const k of ['class', 'entersGrade', 'entersFault', 'label']) if (k in e) entry[k] = e[k];
    out[id] = entry;
  }
  return out;
}

/**
 * جدول سياسة findings للنموذج — لكل مفتاح علوي حكم مُسمّى (أمر 2026-10-06، المبدأ): لا حرف
 * ولا عتبة معايَرة يقرأ أيّاً من findings (categoryStates.js: findings «للتوقيع فقط، غير
 * مُستهلَك اليوم»، سطر 960)، فكل قيمة فيها تصل بحالتها وحدها أو لا تصل:
 *   KEEP   حالة لا قيمة قياس: status، notMeasuredReason.
 *   META   هويّة الفحص: تبقى fieldsVersion وscanId وdeviceModel وapi (api لم يُحسَم في أمر 2026-10-07 فتبقى كما كانت)؛
 *          وتُحذف wallMs وsampleCount وexpectedSamples (أمر 2026-10-07، البند ٥)؛ أيّ مفتاح غير مسمّى لا يصل (رفض افتراضي).
 *   FIELD_NAMES notMeasuredFields: تبقى field وscope وreason (أسماء الحقول وسبب الغياب)، وتُحذف value الافتراضية
 *          (0 و1 و−1 و«flagship_cooling» وnull — القاعدة 22) — أمر 2026-10-07، البند ٥.
 *   STATE  تصل {status[,notMeasuredReason][,note]} وحدها.
 *   TESTS  خريطة اختبارات موسومة — hideTaggedMeasurementsForModel.
 *   REMOVE تُحذف كلّها (channels، perChannelUpdateCount، unstableMeasurements) — مخزَّنة في المصدر كما هي.
 * مفتاح علوي غير مُصنَّف هنا لا يصل النموذج (رفض افتراضي، القاعدة 25) ويُسقِط
 * اختبار v7PayloadRedactionAndRounding حتى يُصنَّف.
 */
const MODEL_FINDINGS_POLICY = Object.freeze({
  meta: 'META', status: 'KEEP', notMeasuredReason: 'KEEP', notMeasuredFields: 'FIELD_NAMES',
  channels: 'REMOVE', perChannelUpdateCount: 'REMOVE',
  sustainedCeiling: 'STATE', graphics: 'STATE', battery: 'STATE', storage: 'STATE', thermal: 'STATE',
  // قرار مستخدم 2026-10-07 +03 (بنصّه): «تُحذف findings.unstableMeasurements كلّها.» — حالات الاختبارات الأربعة تصل في testResults (مقيس/غير مقيس) بلا وسم.
  unstableMeasurements: 'REMOVE', advisoryMeasurements: 'TESTS',
});

function unclassifiedFindingsKeys(findings) {
  if (!findings || typeof findings !== 'object') return [];
  return Object.keys(findings).filter((k) => !(k in MODEL_FINDINGS_POLICY));
}

// أمر 2026-10-07 (البند ٥): «يبقى fieldsVersion، وأسماء الحقول في notMeasuredFields. تُحذف القيم الافتراضية (0 و1 و−1)
// (القاعدة 22)، وwallMs وsampleCount وexpectedSamples». meta.api لم يُذكر في القرار فيبقى كما كان (تُبلَّغ كحقل لم يُحسَم).
const MODEL_META_KEPT_KEYS = Object.freeze(['fieldsVersion', 'scanId', 'deviceModel', 'api']);
const MODEL_NOT_MEASURED_FIELD_KEPT_KEYS = Object.freeze(['field', 'scope', 'reason']);
function pickKeysInSourceOrder(obj, kept) {
  const out = {};
  for (const k of Object.keys(obj)) if (kept.includes(k)) out[k] = obj[k];
  return out;
}
function sanitizeMetaForModel(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta;
  return pickKeysInSourceOrder(meta, MODEL_META_KEPT_KEYS);
}
// شكل العطل (findings.js: notMeasuredFields = {status,reason}) ليس مصفوفة — يمرّ كما هو.
function sanitizeNotMeasuredFieldsForModel(list) {
  if (!Array.isArray(list)) return list;
  return list.map((e) => ((e && typeof e === 'object' && !Array.isArray(e)) ? pickKeysInSourceOrder(e, MODEL_NOT_MEASURED_FIELD_KEPT_KEYS) : e));
}

// {status[,notMeasuredReason][,note]} — note «مقيس» حين status==='MEASURED' وحده (D3).
function findingsStateEntry(status, reason) {
  const entry = {status: status === undefined ? null : status};
  if (reason !== undefined) entry.notMeasuredReason = reason;
  if (status === 'MEASURED') entry.note = MODEL_STATE_TEXT.measured;
  return entry;
}
// قيمة رقمية مفردة → «مقيس» إن كانت رقماً فعلياً وإلّا «غير مقيس».
function numberStateEntry(v) {
  return Number.isFinite(v) ? findingsStateEntry('MEASURED') : findingsStateEntry('NOT_MEASURED');
}

function buildFindingsState(key, sec) {
  if (!sec || typeof sec !== 'object') return sec;
  if (key === 'sustainedCeiling' || key === 'graphics') {
    return findingsStateEntry(('status' in sec) ? sec.status : null,
        ('notMeasuredReason' in sec) ? sec.notMeasuredReason : null);
  }
  if (key === 'battery') {
    // بلا status علوي (findings.js computeBattery) — «توجد قيمة» = qIntMah رقم فعلي.
    return Number.isFinite(sec.qIntMah) ? findingsStateEntry('MEASURED') : findingsStateEntry('NOT_MEASURED');
  }
  if (key === 'storage') {
    // findings.js computeStorage ينتج حالتين فقط: 'STATE_ONLY' (قيس) و'NOT_MEASURED' (+ reason). القاعدة 22: حالة غير معروفة أو غائبة
    // **لا تُقرأ «مقيس»** — تصل كما هي (null إن غابت) فيُعلنها قارئها.
    let entry;
    if (sec.status === 'NOT_MEASURED') entry = findingsStateEntry('NOT_MEASURED', ('reason' in sec) ? sec.reason : null);
    else if (sec.status === 'STATE_ONLY' || sec.status === 'MEASURED') entry = findingsStateEntry('MEASURED');
    else entry = findingsStateEntry(sec.status === undefined ? null : sec.status);
    if (sec.capacityDerived && typeof sec.capacityDerived === 'object') {
      const cd = sec.capacityDerived;
      entry.capacityDerived = cd.status === 'MEASURED' ?
          findingsStateEntry('MEASURED') :
          findingsStateEntry(cd.status === undefined ? null : cd.status, ('reason' in cd) ? cd.reason : null);
    }
    return entry;
  }
  if (key === 'thermal') {
    const out = {};
    if (sec.batteryTempRise && typeof sec.batteryTempRise === 'object') {
      out.batteryTempRise = findingsStateEntry(sec.batteryTempRise.status,
          ('reason' in sec.batteryTempRise) ? sec.batteryTempRise.reason : null);
    }
    if ('thermalHeadroomPeak' in sec) out.thermalHeadroomPeak = numberStateEntry(sec.thermalHeadroomPeak);
    if ('thermalStatusMax' in sec) out.thermalStatusMax = numberStateEntry(sec.thermalStatusMax);
    return out;
  }
  return sec;
}

/**
 * findings للنموذج: كل مفتاح علوي بحكمه في MODEL_FINDINGS_POLICY (أمر 2026-10-06 — المبدأ
 * ينطبق على findings كلّها). لا تعديل على الأصل في مكانه — نسخة جديدة. الأصل (المحسوب
 * والمخزَّن) بلا مساس.
 * @param {Object|null} findings مخرَج computeFindings الأصلي
 * @return {Object|null} نسخة جديدة
 */
function sanitizeFindingsForModelPayload(findings) {
  if (!findings || typeof findings !== 'object') return findings;
  const out = {};
  for (const key of Object.keys(findings)) {
    const policy = MODEL_FINDINGS_POLICY[key];
    if (policy === 'KEEP') out[key] = findings[key];
    else if (policy === 'STATE') out[key] = buildFindingsState(key, findings[key]);
    else if (policy === 'TESTS') out[key] = hideTaggedMeasurementsForModel(findings[key]);
    else if (policy === 'META') out[key] = sanitizeMetaForModel(findings[key]);
    else if (policy === 'FIELD_NAMES') out[key] = sanitizeNotMeasuredFieldsForModel(findings[key]);
    // REMOVE أو غير مُصنَّف: لا يصل النموذج.
  }
  return out;
}

// أمر مستخدم 2026-10-01 +03، القرار ٣ — "كل عدد عشري في الحمولة يُقرَّب
// إلى منزلتين عشريتين، بموضع واحد في بناء الحمولة." لا يمسّ الأعداد
// الصحيحة إطلاقاً (مُتحقَّق: Number.isInteger أوّلاً) — القياس المُستشهَد
// به ("1968633 kHz" عدد صحيح) يختفي أصلاً مع القرار ٢ (findings
// .sustainedCeiling.peakFreqKhz)، لا بهذا التقريب. دالّة خالصة — تبني
// بنية جديدة كاملة، لا تُعدِّل المُدخل في مكانه (القيد الصريح: لا شيء
// محسوب/مخزَّن يتغيّر — هذا يُطبَّق على نسخة الحمولة فقط، بعد بناء body).
function roundPayloadNumbersDeep(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  }
  if (Array.isArray(value)) return value.map(roundPayloadNumbersDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = roundPayloadNumbersDeep(value[k]);
    return out;
  }
  return value;
}

/**
 * يتحقّق دفاعياً أن لا مصفوفة عيّنات خام تسرّبت إلى الحمولة — الضمان
 * البنيوي الذي نصّت عليه P1.4 ("بلا samples"). لا يفحص كل حقل ممكن (ذلك
 * اختبار الوحدة)، بل الحقول التي *يمكن* أن تحمل عيّنات لو استُدعيت هذه
 * الدالّة بمُدخلات findings/categoryStates خاطئة (مثلاً fingerprint خاماً
 * بالغلط بدل findings المُشتقّ).
 * @param {Object} payload الحمولة المبنيَّة
 * @throws {Error} إن وُجد حقل samples أو timeSeries.samples في أي مكان متوقَّع
 */
function assertNoRawSamples(payload) {
  const suspects = [
    payload && payload.findings && payload.findings.samples,
    payload && payload.findings && payload.findings.timeSeries && payload.findings.timeSeries.samples,
    payload && payload.rawFingerprint,
    payload && payload.samples,
  ];
  for (const s of suspects) {
    if (Array.isArray(s)) {
      throw new Error('buildV7Payload: تسرّبت مصفوفة عيّنات خام إلى حمولة V7 — ' +
          'ممنوع بنصّ P1.4 ("بلا samples"). تحقّق من المُدخل الممرَّر (findings/categoryStates).');
    }
  }
}

/**
 * يبني حمولة نداء النموذج V7.
 * @param {Object} params
 * @param {Object} params.findings مخرَج computeFindings (findings.js، P1.1)
 * @param {Object} params.categoryStates مخرَج computeCategoryStates
 *   (categoryStates.js، P1.2/P1.3) — يحمل .testResults أيضاً (إضافة P1.4)
 * @param {string} params.language "ar" | "tr"
 * @param {string|null} params.scanId
 * @param {boolean} params.isFreeTrial
 * @param {Object|null} params.previousScan
 * @param {Object|null} [params.priorRejection] القرار ٢١ (PLAN-01-ROADMAP.md
 *   §🔒 "٢١ · تقرير رفضه الحارس"): "يُعاد توليده مرّة واحدة — النموذج يُعطى
 *   قائمة ما رُفض". عند إعادة توليد بعد رفض الحارس الأول، المستدعي
 *   (resolveV7Report.js) يمرّر هنا ملخّصاً لِما رُفض في المحاولة السابقة
 *   (وصفياً — نصوص لا كائنات الحارس الخام) كي يتجنّب النموذج الخطأ نفسه.
 *   `null`/غائب في المحاولة الأولى (لا رفض سابق بعد).
 * @return {{body: Object, userMessage: string}}
 */
// أمر مستخدم 2026-09-23 +03 (بعد القياس العشاري)، البند ٤ — "أضف أسماء
// الجذر الفعلية للحمولة." مصدر واحد مُصدَّر (القاعدة 24) — لا نسخة يدوية
// في reportShapeV7.js. **يجب أن يطابق مفاتيح body أدناه حرفياً** — اختبار
// مخصَّص (test/fieldNameLeakFix.test.js) يقارنها فعلياً بـ
// Object.keys(buildV7Payload(...).body) على نداء حقيقي، فلا يبقى الانجراف
// صامتاً لو أُضيف حقل جديد هنا ونُسي هناك.
const V7_PAYLOAD_ROOT_KEYS = Object.freeze([
  'scanId', 'language', 'isFreeTrial', 'findings', 'testResults',
  'categoryStates', 'previousScan', 'priorRejection',
]);

function buildV7Payload(params) {
  const p = params || {};
  const cs = p.categoryStates || null;

  // أمر 2026-10-06: sanitizeFindingsForModelPayload رفض افتراضي لأي مفتاح علوي غير مُصنَّف
  // (يُسقط findings.samples بصمت) — فحص العيّنات الخام يجب أن يقع على **المُدخل** قبل التنقية
  // وإلّا لم يعد assertNoRawSamples(body) أدناه يرى شيئاً (انكشف بتشغيل buildV7Payload.test.js §٢).
  assertNoRawSamples({findings: p.findings || null});

  const body = {
    scanId: p.scanId || null,
    language: p.language || 'ar',
    isFreeTrial: !!p.isFreeTrial,
    // أمر مستخدم 2026-10-01 +03، القرار ٢ — sustainedCeiling/graphics/battery
    // تصل بحالتها وحدها (راجع sanitizeFindingsForModelPayload أعلى الملفّ).
    // assertNoRawSamples أدناه لا يتأثّر — samples/timeSeries لا تُلمَس هنا.
    findings: sanitizeFindingsForModelPayload(p.findings || null),
    // الثلاثيات — TestResult[] (نصّ المهمّة: "الثلاثيات تستهلك Findings").
    // القرار ٨٨ البند ٢ — raw.status محذوفة لعناصر ENVIRONMENT_UNSUITABLE؛
    // وأمر 2026-10-01 +03 القرار ٢ — raw.rawValue محذوفة لمجموعة "غير
    // معايَر" (T-01/T-02/C-07/S-06). لا تعديل على أي عنصر/حقل آخر — بقيّة
    // الحقول (outcome/notMeasuredReason إلخ) تصل كما هي.
    testResults: sanitizeTestResultsForModelPayload((cs && Array.isArray(cs.testResults)) ? cs.testResults : []),
    // الحالات — جدول الفئات الـ15 + الدرجة العامة، بلا testResults مكرَّرة.
    // الثلاثة أدناه قائمة بيضاء (v7ModelPayloadWhitelist.js، راجع تعليق
    // رأس هذا القسم) — لا cs.categories/cs.overall/cs.issues الأصلية
    // مُعدَّلة في مكانها. buildModelCategories تطبّق تنقية مؤشّرات البطارية
    // الأربعة غير المعايَرة (القرار ٢) داخلياً عبر buildModelCategoryEntry.
    categoryStates: cs ? {
      categories: buildModelCategories(cs.categories),
      overall: buildModelOverall(cs.overall),
      issues: hideIssueValuesForModel(buildModelIssues(cs.issues)),
    } : null,
    previousScan: p.previousScan || null,
    // القرار ٢١ — غائب (null) على المحاولة الأولى؛ حاضر فقط على نداء
    // إعادة التوليد الثاني. حقل إضافي بحت — لا يمسّ assertNoRawSamples
    // (نصّ حرّ، لا مصفوفة عيّنات).
    priorRejection: p.priorRejection || null,
  };

  assertNoRawSamples(body);

  // أمر مستخدم 2026-10-01 +03، القرار ٣ — تقريب كل عدد عشري في الحمولة
  // إلى منزلتين، بموضع واحد هنا (بعد بناء body كاملاً، قبل أي استهلاك
  // آخر له) — القيد الصريح: لا شيء محسوب/مخزَّن يتغيّر؛ roundedBody نسخة
  // جديدة كاملة (roundPayloadNumbersDeep لا تُعدِّل في المكان)، وcs/p
  // .findings الأصليّان بلا أي مساس. roundedBody هي ما يُعاد **وما تُبنى
  // منه userMessage معاً** — فمرجع حارس الأرقام (يستهلك body المُعاد،
  // راجع callAI.js) يطابق الحمولة الفعلية المُرسَلة رقماً برقم.
  const roundedBody = roundPayloadNumbersDeep(body);

  const userMessage = JSON.stringify(roundedBody) + '\n\nProduce the analysis JSON now.';
  return {body: roundedBody, userMessage};
}

// ═══════════════════════════════════════════════════════════════════════
// applyV7Adjustments — يطبّق adjustments[] الواردة من مخرَج النموذج على
// نسخة من categoryStates (لا يُعدِّل الأصل). قواعد ثابتة من نصّ P1.4 +
// systemPromptV7.js:
//   • direction:"DOWN" فقط يُطبَّق فعلياً، بسقف درجة واحدة (maxOneBand).
//   • direction:"UP" يُحفَظ بعلامة disputed:true ولا يُطبَّق أبداً.
//   • evidenceRefs فارغة → التعديل مرفوض كاملاً (لا يُطبَّق ولا يُحفَظ
//     مطبَّقاً — يُسجَّل في overall.adjustments بعلامة rejected بسبب مُسمّى).
//   • فئة UNMEASURED/ATTESTED_ONLY/HARNESS_ERROR أو PARTIAL بلا حرف أصلاً
//     (deterministicLetter=null) → لا تعديل ممكن (لا حرف بلا قياس).
//
// ⚠️ **عطب مُصلَح في هذه المهمّة** (رصد المستخدم، A63 بصيغة جديدة): كانت
// هذه الدالّة تُعدِّل categories[cat].deterministicLetter ثم تبني overall
// الجديدة بنسخ overall.القديمة حرفياً (...categoryStates.overall) مع
// استبدال adjustments/disputed فقط — فيبقى measuredCategoriesMean
// والتغطية وgatesApplied محسوبة على categories *قبل* التعديل. القرار ٦
// (measuredCategoriesMean لا يُعرض؛ المعروض الحرف والتغطية وسبب البوّابة)
// يقوم على أن الحرف قابل لإعادة الاشتقاق من الجدول المعروض معه — جدول
// مُعدَّل بحرف لم تُعِد عنه overall اشتقاقها ينقض هذا مباشرة.
//
// الإصلاح جزءان معاً (أحدهما وحده لا يكفي):
//   ١. إعادة اشتقاق overall كاملةً من categories بعد التعديل عبر
//      deriveOverallFromCategories (categoryStates.js) — الدالّة القابلة
//      لإعادة الدخول المُصدَّرة لهذا الغرض بالضبط (نصّ المهمّة: "أعِد
//      تصدير weightedScore/gates/التغطية كدالّة قابلة لإعادة الدخول").
//   ٢. قصّ entry.score إلى سقف نطاق الحرف الجديد (BAND_MAX من
//      rebuildCategoryScores.js، نفس نمط rebuildCategoryScores.js:210
//      حين حرف يتفوّق على نسبة نجاح خام). بلا هذا القصّ، deriveOverallFromCategories
//      تقرأ entry.score (نسبة النجاح الخام) لا entry.deterministicLetter —
//      فتخفيض الحرف وحده بلا قصّ الرقم المرافق يُبقي weightedScore/
//      measuredCategoriesMean كما كانا تماماً، ويُصبح استدعاء
//      deriveOverallFromCategories عديم الأثر عملياً رغم صحّته شكلياً.
//      Math.min يضمن أن القصّ لا يرفع الرقم أبداً (لا أثر إن كان أصلاً في
//      نطاق الحرف الجديد أو أسوأ منه — حالة floorApplied مثلاً).
// ═══════════════════════════════════════════════════════════════════════

const LETTER_ORDER = {A: 0, B: 1, C: 2, D: 3};
const LETTER_BY_RANK = ['A', 'B', 'C', 'D'];

// القرار ٩٨ البند ١ (2026-09-25 +03، نصّ المستخدم حرفياً): "letterSource =
// LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن الحرف الحتمي. التخفيض
// المقبول الذي لا يغيّر الحرف... يُسجَّل في audit.adjustments بأنه «مقبول
// بلا أثر» مع سببه." القيمة الثابتة الوحيدة المُصدَّرة لهذه الحالة
// (القاعدة 24) — لا سلسلة حرفية منفصلة في أيّ قارئ آخر.
const ADJUSTMENT_ACCEPTED_NO_EFFECT = 'ACCEPTED_NO_EFFECT';

// ═══════════════════════════════════════════════════════════════════════
// القرار ٤٢ البند ١ — التحقّق من الدليل (الأهمّ، نصّ المستخدم حرفياً):
// "بلا أن يُثبَت أن المرجع يشير إلى حقل موجود وأن قيمته تسند الاتجاه، يبقى
// التخفيض مفتوحاً لأي نصّ — وهو ما يُعيد تباين النموذج من باب خلفي."
//
// شقّان منفصلان، سببا رفض مُسمّيان منفصلان (القاعدة 21 — "بلا دليل" و"بدليل
// لا يسنده" حالتان علاجهما مختلف):
//
//   ١. EVIDENCE_NOT_FOUND     — المرجع (سلسلة نصّية) لا يُحلّ إلى حقل موجود
//      فعلاً في findings/categoryStates. **قابل للتعريف بلا تخمين بالكامل**
//      — تحقّق حرفي على البيانات الحقيقية (functions/scripts/out/v7-live-*.json)
//      أن evidenceRefs الحقيقية دائماً بشكل "findings.a.b[0].c" أو
//      "categoryStates.a.b[0].c" (جذر صريح + مسار نقطي + فهارس []
//      اختيارية) — مثال حقيقي: "categoryStates.categories.cpu.gatesApplied[0].name"،
//      "findings.sustainedCeiling.phase3.meanWindowMaxRatio". القواعد هنا
//      مُشتقّة من هذا الشكل المُلاحَظ فعلياً، لا مُخترَعة.
//
//   ٢. EVIDENCE_NOT_MEASURED  — المرجع يُحلّ إلى حقل موجود، لكن قيمته علامة
//      غياب صريحة (القاعدة 22: الغياب لا يُقرأ قياساً) — لا يمكن أن "تسند"
//      أي اتّجاه. **قابل للتعريف بلا تخمين**: findings.js يستعمل اصطلاحاً
//      واحداً ثابتاً للغياب في كل مكان (تحقّق: grep على "NOT_MEASURED" في
//      findings.js — كل ظهور مقرون بـ`status: "NOT_MEASURED"` حرفياً، بلا
//      استثناء)، ونمصفوفة findings.notMeasuredFields[] اسمها ذاته يُعلن
//      الغرض (لا حاجة لتخمين أيّ حقل فرعي منها "يعني" غياباً — كلّها كذلك
//      بحكم الموضع).
//
// ✋ **قرار مستخدم صدر بعد الجولة الأولى — الباب يُغلق، لا يُفتح على معيار
// ضعيف** (رسالة منفصلة، تُقتبَس حرفياً): "إن قال إنه تعذّر على صنف حقول ما،
// فذلك الصنف يبقى بلا تخفيض — لا يُمرَّر بمعيار أضعف. بقاء باب مغلق خير من
// فتحه على معيار لا يُثبَت." — يُنفَّذ الآن كشقّ ٣:
//
//   ٣. EVIDENCE_NOT_PROVEN    — المرجع موجود وليس غياباً صريحاً، لكن **لا
//      معيار مُثبَت في الكود** يقول إن قيمته "تسند" اتّجاه التخفيض. سبب
//      مُسمّى منفصل عن الاثنين أعلاه (القاعدة 21 — "بلا دليل"، "بدليل لا
//      يُحلّ"، "بدليل لا يُثبَت" ثلاث حالات علاجها مختلف). هذا هو الافتراضي
//      لأي قيمة لم تُصنَّف صراحةً "مُثبَتة" أدناه — الباب مغلق افتراضياً.
//
// ⚠️ **القرار ٩٤ البند ١ (2026-09-25 +03) — الباب يضيق أكثر، نصّ المستخدم
// حرفياً**: "يُقبل دليل التخفيض في حالتين فقط: نتيجة FAIL لاختبار داخل
// الفئة المخفَّضة، أو ملاحظة (finding) مربوطة بها في خريطة صريحة. ولا يُقبل
// حرف من أيّ فئة، ولا حالة الفئة، ولا بوّابة من بوّاباتها."
//
// **التعليل (نصّ المستخدم حرفياً)**: "بعد ربط الدليل بالفئة (القرار ٨٨-٣)
// لم يبقَ من أدلّة الحروف إلا حرف الفئة نفسها، وهذا استدلال دائري." — فئة
// تُخفَّض لأن حرفها كذا، بدليل حرفها هي نفسها (أو ببوّابة أثّرت في ذلك
// الحرف أصلاً) — لا معلومة جديدة تدخل القرار، فقط إعادة صياغة لما أنتجه
// القياس الحتمي أصلاً. **وقع فعلاً في ردّ حقيقي مجمَّد**: عيّنة llm-adjusted
// (`v7-client-payload-sample-llm-adjusted.json` قبل هذا القرار) — تخفيض
// storage من C إلى D بدليل `categoryStates.categories.storage.deterministicLetter`
// (الحرف نفسه المخفَّض يُستشهَد به لإثبات تخفيضه) — دائريّ بالضبط، ومن
// الفئة الصحيحة (القرار ٨٨-٣ كان يقبله سابقاً لهذا بالذات).
//
// ما **يبقى مُثبَتاً** بعد اليوم — مفردة واحدة لا ثلاث (isProvenSupportiveEvidence
// أدناه أُعيدت كتابتها لتعكس هذا حصراً):
//   • قيمة عند مفتاح `outcome` تساوي حرفياً `'FAIL'` — نتيجة اختبار فاشلة
//     فعلياً (testKinds.js)، **من الفئة المخفَّضة نفسها** (isEvidenceLinkedToCategory
//     أدناه، بلا تغيير — القرار ٨٨-٣ في هذا الشقّ بقي كما هو). `'PASS'`/
//     `'WARNING'`/`'NOT_MEASURED'` لا تُثبَت (كما كان).
//
// ما **أُغلق اليوم بعد أن كان مفتوحاً**:
//   • `status === 'FIRED'` (بوّابة) — أيّ بوّابة، من أيّ فئة، مُطبَّقة في
//     حرفها أو لا. لم يعد isProvenSupportiveEvidence يفحص `status` إطلاقاً.
//     **أثر جانبي**: فحص ازدواج أثر البوّابة (`isDoubleCountingAppliedGate`/
//     `EVIDENCE_GATE_ALREADY_APPLIED`، القرار ٨٨-٣) صار بلا غاية — لا بوّابة
//     تصل إليه أصلاً بعد اليوم (كل بوّابة تُرفَض عند شقّ "الإثبات" قبله) —
//     حُذف في هذا الالتزام (تنظيف لا تغيير سلوك، راجع resolveEvidencePath).
//   • حرف مُحقَّق (`deterministicLetter`/`finalLetter`/`llmSuggestedLetter`)
//     يساوي `'C'` أو `'D'` — **حتى من الفئة المخفَّضة نفسها** (الفرق
//     الجوهري عن القرار ٨٨-٣: ذاك ربط الدليل بالفئة، هذا يمنع الحرف دليلاً
//     بصرف النظر عن فئته إطلاقاً). `PROVEN_LETTER_KEYS` حُذفت.
//   • حالة الفئة (`state`) — لم تكن مُثبَتة قبل اليوم أصلاً (لا فرع لها في
//     isProvenSupportiveEvidence سابقاً أيضاً) — تبقى مغلقة، ومُختبَرة الآن
//     صراحةً (buildV7Payload.test.js) بدل أن تكون مجرّد غياب فرع بلا اختبار
//     يُثبته.
//
// كل ما عداها — بما فيها **كل** MEASUREMENT الخام في findings.* (channels،
// thermal، battery، graphics، sustainedCeiling، storage) وأرقام
// categoryStates.* (coverage/score/measuredCategoriesMean/confidence) —
// **يبقى مغلقاً**: لا عتبة مُعرَّفة لأيّ منها في هذا المستودع. thresholdSet
// (findings.js:126) عتبة واحدة فقط (vsyncLockCombinedFraction)، موسومة
// صراحة "مبدئية — تحتاج معايرة" وغير مربوطة بأي بوّابة فعلية — لا مصدر
// للعتبة اليوم، فالباب يبقى مغلقاً حتى يوجد (نصّ القرار).
// ═══════════════════════════════════════════════════════════════════════

// جذور المسار المسموحة — الاثنان اللذان يصفهما systemPromptV7.js:166،174،181
// ("مسار داخل findings أو categoryStates") ويؤكّدهما الاستشهاد الحيّ الحقيقي
// أعلاه. أي جذر آخر (بما فيه محاولات __proto__/constructor/prototype) يُرفَض
// عند التحليل — لا اتّساع خارج الاثنين الموثَّقين.
const EVIDENCE_PATH_SEGMENT_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)((?:\[\d+\])*)$/;
const EVIDENCE_FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * يُحلِّل سلسلة مرجع دليل ("findings.a.b[0].c") إلى مقاطع آمنة — بلا أي
 * `eval`/`Function` ولا وصول لمفاتيح النموذج الأولي (`__proto__` إلخ).
 * @param {*} refPath كما وصل من مخرَج النموذج — غير موثوق بنيوياً
 * @return {Array<{type: 'key', name: string}|{type: 'index', index: number}>|null}
 *   null إن كان الشكل غير صالح (ليس نصّاً، أو مقطع لا يطابق القواعد)
 */
function parseEvidencePath(refPath) {
  if (typeof refPath !== 'string' || !refPath.trim()) return null;
  const segments = [];
  for (const rawPart of refPath.split('.')) {
    const m = EVIDENCE_PATH_SEGMENT_RE.exec(rawPart);
    if (!m) return null;
    const name = m[1];
    if (EVIDENCE_FORBIDDEN_KEYS.has(name)) return null;
    segments.push({type: 'key', name});
    const idxMatches = m[2].match(/\d+/g);
    if (idxMatches) for (const idx of idxMatches) segments.push({type: 'index', index: Number(idx)});
  }
  return segments.length ? segments : null;
}

/**
 * يحلّ مسار دليل مُحلَّلاً مقابل {findings, categoryStates} — القسم ١
 * ("موجود فعلاً"). لا يفترض شكلاً غير مذكور صراحة في القيمة المُعادة —
 * `found:false` يشمل كلّاً من "المسار غير صالح" و"المفتاح غير موجود".
 * `lastKeyName` (المقطع الأخير إن كان مفتاحاً لا فهرساً) — يُستعمَل في
 * القسم ٢ (isProvenSupportiveEvidence) للتمييز حسب *اسم الحقل*، لا قيمته
 * وحدها (نفس نمط GATE_VOCAB_KEYS في reportShapeV7.js — تجنّباً لمطابقة
 * نصّ عرضي بالصدفة، مثل نصّ حرّ يساوي "FIRED" في حقل غير ذي علاقة).
 *
 * القرار ٨٨ البند ٣ (نصّ المستخدم حرفياً): "الحكم بالفئة الفعلية للعنصر
 * المُشار إليه، لا باسم في النصّ." — أثناء المشي على المسار، كل مرّة يكون
 * فيها الكائن الحالي يحمل حقل `.category` نصّياً (عنصر فئة كامل —
 * categoryStates.categories.<cat> — أو بوّابة — gatesApplied[i]، في أيّ
 * قائمة وُجدت، categories.<cat>.gatesApplied أو overall.gatesApplied
 * سواء — أو TestResult — categoryStates.testResults[i]) تُسجَّل فئته
 * `evidenceCategory` (تُستبدَل بآخر ظهور، لا أوّله — أقرب غلاف فعلي
 * للقيمة النهائية). **لا حكم من نصّ المسار نفسه** (لا نبحث عن السلسلة
 * "categories.wireless" في refPath) — الحكم من حقل `.category` الفعلي
 * على الكائن المُحلَّل فقط، فيعمل بلا تمييز سواء وصل الدليل عبر
 * `categories.<cat>...` أو عبر `overall.gatesApplied[i]` لبوّابة تخصّ
 * فئة أخرى (نفس الكائن منطقياً، مصدرَين مختلفين).
 *
 * ⚠️ **القرار ٩٤ البند ١ (2026-09-25 +03)** حذف تتبّع `firedAndCappedGate`
 * (كان يرصد أقرب بوّابة "مُطلَقة ومطبَّقة" لفحص ازدواج الأثر،
 * `isDoubleCountingAppliedGate`، القرار ٨٨-٣) — صار بلا غاية: لا بوّابة
 * تصل أصلاً إلى ذلك الفحص بعد اليوم، لأن **لا بوّابة تُعامَل دليلاً مُثبَتاً
 * إطلاقاً** بعد الآن (isProvenSupportiveEvidence لم تعد تفحص `status`
 * بتاتاً — راجع تعليق رأس ذلك القسم). حذفه هنا تنظيف لا تغيير سلوك.
 * @param {string} refPath
 * @param {{findings: (Object|null), categoryStates: (Object|null)}} roots
 * @return {{found: boolean, value: *, mentionsNotMeasuredFields: boolean,
 *   lastKeyName: (string|null), evidenceCategory: (string|null),
 *   rootName: (string|null)}}
 */
function resolveEvidencePath(refPath, roots) {
  const NOT_FOUND = {
    found: false, value: undefined, mentionsNotMeasuredFields: false, lastKeyName: null,
    evidenceCategory: null, rootName: null, lastKeyParent: null,
  };
  const segments = parseEvidencePath(refPath);
  if (!segments) return NOT_FOUND;
  const rootSeg = segments[0];
  if (rootSeg.type !== 'key' || !Object.prototype.hasOwnProperty.call(roots, rootSeg.name)) {
    return NOT_FOUND;
  }
  const rootName = rootSeg.name; // 'findings' أو 'categoryStates' — مصدر وحيد لهذا الاستخراج (لا تكرار في evaluateEvidenceRef)
  let cur = roots[rootSeg.name];
  let mentionsNotMeasuredFields = false;
  let lastKeyName = segments.length === 1 ? rootSeg.name : null;
  let evidenceCategory = (cur && typeof cur === 'object' && typeof cur.category === 'string') ? cur.category : null;
  // القرار ٩٩ البند ١ — الكائن الذي حمل آخر مفتاح (الأب المباشر لِـ.outcome
  // حين lastKeyName='outcome') — يُستعمَل لقراءة .healthBearing عليه (لا
  // قائمة IDs يدوية، راجع isExcludedFromGrade أدناه).
  let lastKeyParent = null;
  for (let i = 1; i < segments.length; i++) {
    if (cur === null || cur === undefined) {
      return {found: false, value: undefined, mentionsNotMeasuredFields, lastKeyName: null, evidenceCategory, rootName, lastKeyParent: null};
    }
    const seg = segments[i];
    const parentBeforeStep = cur;
    if (seg.type === 'index') {
      if (!Array.isArray(cur) || seg.index >= cur.length) {
        return {found: false, value: undefined, mentionsNotMeasuredFields, lastKeyName: null, evidenceCategory, rootName, lastKeyParent: null};
      }
      cur = cur[seg.index];
      lastKeyName = null; // آخر مقطع كان فهرساً — لا اسم حقل له
      lastKeyParent = null;
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur) || EVIDENCE_FORBIDDEN_KEYS.has(seg.name) ||
          !Object.prototype.hasOwnProperty.call(cur, seg.name)) {
        return {found: false, value: undefined, mentionsNotMeasuredFields, lastKeyName: null, evidenceCategory, rootName, lastKeyParent: null};
      }
      if (seg.name === 'notMeasuredFields') mentionsNotMeasuredFields = true;
      cur = cur[seg.name];
      lastKeyName = seg.name;
      lastKeyParent = parentBeforeStep;
    }
    // بعد كل خطوة — إن كان الكائن الجديد يحمل .category فعلياً، يستبدل ما
    // سبقه (أقرب غلاف فعلي، لا أوّله — القرار ٨٨-٣).
    if (cur && typeof cur === 'object' && !Array.isArray(cur) && typeof cur.category === 'string') {
      evidenceCategory = cur.category;
    }
  }
  return {found: cur !== undefined, value: cur, mentionsNotMeasuredFields, lastKeyName, evidenceCategory, rootName, lastKeyParent};
}

/**
 * علامة غياب صريحة (القاعدة 22) — راجع التعليق أعلى هذا القسم لمصدر
 * الاصطلاح ("status: NOT_MEASURED" حرفياً في كل مكان بـfindings.js). قيمة
 * `null` نفسها تُحسَب غياباً أيضاً — لا يمكن لعدد/نصّ فارغ أن "يسند" حكماً.
 * @param {*} value القيمة المُحلَّلة من resolveEvidencePath
 * @return {boolean}
 */
function isAbsenceEvidenceValue(value) {
  if (value === null) return true;
  if (value && typeof value === 'object' && !Array.isArray(value) && value.status === 'NOT_MEASURED') return true;
  return false;
}

/**
 * القسم ٢ — هل قيمة مرجع (مُحلَّل، موجود، غير غائب) **مُثبَتة** أنها تسند
 * اتّجاه التخفيض؟ بعد القرار ٩٤ البند ١ (2026-09-25 +03، راجع تعليق رأس
 * هذا القسم): مفردة واحدة فقط — `outcome === 'FAIL'`. كل ما عداها (بما
 * فيها `status === 'FIRED'` [بوّابة، أيّ فئة]، وحرف مُحقَّق `'C'`/`'D'`
 * [حتى من الفئة المخفَّضة نفسها]، وحالة الفئة `state`) **غير مُثبَتة** —
 * الباب مغلق افتراضياً (نصّ القرار: "لا يُقبل حرف من أيّ فئة، ولا حالة
 * الفئة، ولا بوّابة من بوّاباتها").
 * @param {string|null} lastKeyName اسم المفتاح الأخير في المسار (null إن
 *   كان المقطع الأخير فهرس مصفوفة، أو المرجع بلا مقطع مفتاح صالح)
 * @param {*} value القيمة المُحلَّلة
 * @return {boolean}
 */
function isProvenSupportiveEvidence(lastKeyName, value) {
  return typeof value === 'string' && lastKeyName === 'outcome' && value === 'FAIL';
}

/**
 * القرار ٨٨ البند ٣ (نصّ المستخدم حرفياً) — الشرط (أ): "أن يكون [الدليل]
 * من الفئة المخفَّضة نفسها: مسار تحت categoryStates.<الفئة>، أو finding
 * مربوط بها في خريطة صريحة. فإن لم توجد خريطة صريحة، لا يُقبل finding
 * دليلاً للتخفيض الآن، ويُعلَن ذلك."
 *
 * لا خريطة finding→فئة مبنيّة بعد (القرار ٨٨-٣ نفسه، مؤجَّل بنصّه: "الربط
 * السببي بين فئتين... يُضاف أزواجاً صريحة... فلا تبنِه") — فكل دليل
 * بجذر `findings` يُرفَض هنا حصراً بسبب غياب الخريطة، بصرف النظر عن قيمته
 * (حتى لو كانت "مُثبَتة" شكلاً — لن يقع ذلك عملياً: findings.* لا يحمل
 * حقلَي outcome/status بمفردات categoryStates، لكن الحكم هنا بنيويّ لا
 * اتّكالاً على تلك الملاحظة). دليل بجذر `categoryStates` يُقبَل بهذا
 * الشرط فقط إن كانت `evidenceCategory` المرصودة (resolveEvidencePath)
 * تُساوي `targetCategory` حرفياً — لا تخمين من نصّ المسار (القاعدة نفسها،
 * راجع تعليق resolveEvidencePath).
 * @param {string} refRoot 'findings' أو 'categoryStates' (segments[0].name)
 * @param {?string} evidenceCategory من resolveEvidencePath
 * @param {string} targetCategory فئة التعديل قيد التقييم
 * @return {boolean}
 */
function isEvidenceLinkedToCategory(refRoot, evidenceCategory, targetCategory) {
  if (refRoot === 'findings') return false; // لا خريطة صريحة بعد — رفض بنيويّ
  return evidenceCategory === targetCategory;
}

/**
 * القرار ٩٩ البند ١ (نصّ المستخدم حرفياً): "لا تُقبل نتيجة FAIL دليلاً إذا
 * كان الاختبار موسوماً UNSTABLE... أو MEASUREMENT معطّلاً حتى P2... أو
 * أيّ اختبار يستبعده الحساب من الحرف." **المصدر: نفس الحقل الذي يستهلكه
 * الحساب فعلياً** — `healthBearing` (لا قائمة IDs يدوية هنا، القاعدة 24):
 * `computeHealthBearingStats` (categoryStates.js:446-452) —
 * `declaredHb = testResults.filter(r => r.healthBearing)`، و`executed`
 * المُشتقّة منها وحدها تُغذّي `score`/`passCount`/`failCount`/
 * `STATE_FAIL_FLOOR` (computeCategoryFromTests). أيّ TestResult
 * `healthBearing !== true` **لا يدخل الحرف بتاتاً** — بصرف النظر عن
 * `outcome`/`kind`. `healthBearing` نفسها تُكتَب في `testKinds.js`
 * (`isHealthBearing`) من `kindOf(testId)===SPEC` أو `isUnstable(testId)`
 * (`UNSTABLE_IDS`) — القيمة الجاهزة على كل TestResult، لا يُعاد اشتقاقها
 * هنا بقائمة IDs موازية.
 *
 * **الباب مغلق افتراضياً هنا أيضاً** (نفس نهج القرار ٩٤-١): كائن بلا
 * `healthBearing===true` صريحاً — بما فيه غيابها كلّياً عن الكائن — يُعامَل
 * مستبعَداً. لا "نجاح صامت" لعنصر لم يُثبَت أنه يدخل الحرف.
 * @param {?Object} testResultObject الكائن الذي يحمل `.outcome` (أب المسار
 *   المباشر، من `resolveEvidencePath.lastKeyParent`)
 * @return {boolean} true إن وجب الرفض (الاختبار مستبعَد من الحرف فعلياً)
 */
function isExcludedFromGrade(testResultObject) {
  return !(testResultObject && typeof testResultObject === 'object' && testResultObject.healthBearing === true);
}

/**
 * يُقيِّم مرجع دليل واحد مقابل فئة تعديل مُحدَّدة — خمسة شقوق بالترتيب
 * (وجود ← غياب صريح ← إثبات سند مُعلَن ← استبعاد من الحرف ← ربط بالفئة).
 * كل شقّ سبب رفض مُسمّى منفصل (القاعدة 21).
 *
 * ⚠️ **القرار ٩٤ البند ١ (2026-09-25 +03)** حذف الشقّ الخامس السابق (ازدواج
 * أثر بوّابة، `isDoubleCountingAppliedGate`، القرار ٨٨-٣): صار بلا غاية،
 * لأن أيّ مرجع كان سيصله (بوّابة FIRED من الفئة نفسها، أثرها مطبَّق) يُرفَض
 * الآن أصلاً في شقّ "الإثبات" (status لم يعد يُفحَص إطلاقاً) — تنظيف لا
 * تغيير سلوك.
 *
 * ⚠️ **القرار ٩٩ البند ١** أضاف شقّاً جديداً (استبعاد من الحرف) بعد شقّ
 * الإثبات مباشرة، قبل شقّ الفئة — ترتيب مقصود: هل outcome=FAIL هذا *يدخل
 * الحرف أصلاً* (بصرف النظر عن فئته)؟ إن لم يدخل، السبب EVIDENCE_EXCLUDED_FROM_GRADE
 * بصرف النظر عمّا كانت ستحكم به فئته لاحقاً.
 *
 * القيمة أوّلاً (هل تسند شيئاً أصلاً؟)، ثم الفئة (القرار ٨٨-٣) — ترتيب
 * مقصود: دليل غير مُثبَت أصلاً يبقى EVIDENCE_NOT_PROVEN بصرف النظر عن
 * فئته — لا يتحوّل فجأة إلى "خطأ فئة" لمجرّد أن فحص الفئة مضاف. فحص الفئة
 * يحكم فقط الحالة التي كانت *ستُقبَل لولاه* (قيمة مُثبَتة فعلاً وتدخل
 * الحرف فعلاً) — أدقّ توصيفاً: "دليل حقيقي القيمة، من الفئة الخطأ" لا
 * "دليل ضعيف بسبب فئته".
 * @param {string} refPath
 * @param {{findings: (Object|null), categoryStates: (Object|null)}} roots
 * @param {string} targetCategory فئة التعديل قيد التقييم — إلزامي (القرار ٨٨-٣)
 * @return {{ok: boolean, reason: (string|null)}}
 */
function evaluateEvidenceRef(refPath, roots, targetCategory) {
  const resolved = resolveEvidencePath(refPath, roots);
  if (!resolved.found) return {ok: false, reason: 'EVIDENCE_NOT_FOUND'};
  if (resolved.mentionsNotMeasuredFields || isAbsenceEvidenceValue(resolved.value)) {
    return {ok: false, reason: 'EVIDENCE_NOT_MEASURED'};
  }
  if (!isProvenSupportiveEvidence(resolved.lastKeyName, resolved.value)) {
    return {ok: false, reason: 'EVIDENCE_NOT_PROVEN'};
  }
  if (resolved.lastKeyName === 'outcome' && isExcludedFromGrade(resolved.lastKeyParent)) {
    return {ok: false, reason: 'EVIDENCE_EXCLUDED_FROM_GRADE'};
  }
  if (!isEvidenceLinkedToCategory(resolved.rootName, resolved.evidenceCategory, targetCategory)) {
    return {ok: false, reason: 'EVIDENCE_WRONG_CATEGORY'};
  }
  return {ok: true, reason: null};
}

/**
 * يطبّق مصفوفة adjustments واحدة على categoryStates، ويُعيد **نسخة جديدة**
 * (لا تعديل في المكان — categoryStates.js يبقى مصدر الحقيقة الحتمي، وهذه
 * دالّة طبقة أعلى تستهلكه).
 * @param {Object} categoryStates مخرَج computeCategoryStates
 * @param {Array} adjustments كما وصلت من مخرَج النموذج (غير موثوقة —
 *   تُفحَص حقلاً حقلاً، لا افتراض شكل صحيح)
 * @param {Object|null} [findings] مخرَج computeFindings لنفس الفحص — القرار
 *   ٤٢ البند ١: بلا هذا المُدخل، كل evidenceRefs التي تشير لجذر "findings"
 *   تُرفَض EVIDENCE_NOT_FOUND (فشل مغلَق لا نجاح صامت — لا "دليل" بلا
 *   findings حقيقية للتحقّق منه). `categoryStates` (الوسيط الأول، قبل أي
 *   تعديل) هو الجذر المُستعمَل لمراجع "categoryStates.*" — لا وسيط إضافي.
 * @return {Object} categoryStates مُعدَّلة + overall.adjustments/disputed مُحدَّثتين
 */
function applyV7Adjustments(categoryStates, adjustments, findings) {
  if (!categoryStates || typeof categoryStates !== 'object') {
    throw new Error('applyV7Adjustments: categoryStates غائب — لا شيء لتطبيق التعديلات عليه');
  }
  const list = Array.isArray(adjustments) ? adjustments : [];
  const evidenceRoots = {findings: findings || null, categoryStates};

  // نسخ سطحي كافٍ: نستبدل categories[cat] وoverall ببدائل جديدة، لا نُعدِّل
  // كائنات categoryStates الأصلية في مكانها.
  const categories = {...categoryStates.categories};
  const appliedLog = [];
  let disputed = false;

  for (const raw of list) {
    const a = raw && typeof raw === 'object' ? raw : {};
    const category = typeof a.category === 'string' ? a.category : null;
    const direction = a.direction;
    const evidenceRefs = Array.isArray(a.evidenceRefs) ? a.evidenceRefs : [];

    const record = {
      category, direction, evidenceRefs, reason: a.reason || null,
      applied: false, displayed: false, // القرار ٤: تُكتب وتُوسَم غير معروضة
    };

    if (!category || !CATEGORIES.includes(category)) {
      record.rejectedReason = 'UNKNOWN_CATEGORY';
      appliedLog.push(record);
      continue;
    }
    if (evidenceRefs.length < 1) {
      record.rejectedReason = 'NO_EVIDENCE'; // "تعديل بلا دليل يُرفض كاملاً" (systemPromptV7)
      appliedLog.push(record);
      continue;
    }
    // القرار ٤٢ البند ١ — كل مرجع في evidenceRefs يجب أن يحلّ فعلياً (لا
    // يكفي أن تكون المصفوفة غير فارغة). أوّل مرجع يفشل يُسقِط التعديل كلّه —
    // لا يكفي أن يكون *بعض* الدليل حقيقياً (نصّ المهمّة: "يبقى التخفيض
    // مفتوحاً لأي نصّ" لو مُرِّر مرجع واحد مُختلَق بجوار مراجع حقيقية).
    let evidenceFailure = null;
    for (const ref of evidenceRefs) {
      const verdict = evaluateEvidenceRef(ref, evidenceRoots, category);
      if (!verdict.ok) { evidenceFailure = verdict.reason; break; }
    }
    if (evidenceFailure) {
      record.rejectedReason = evidenceFailure; // EVIDENCE_NOT_FOUND | EVIDENCE_NOT_MEASURED | EVIDENCE_NOT_PROVEN | EVIDENCE_EXCLUDED_FROM_GRADE | EVIDENCE_WRONG_CATEGORY
      appliedLog.push(record);
      continue;
    }
    const entry = categories[category];
    if (!entry || entry.deterministicLetter === null) {
      // القرار ٤٢ البند ٤ ("وحدّ التطبيق") — NO_BASE_LETTER وحدها وكيل عن
      // الحالة لا الحالة نفسها. حين تكون الحالة اسماً مُعلَناً بالفعل
      // (UNMEASURED/ATTESTED_ONLY — الحالتان الوحيدتان اللتان تُنتجان
      // deterministicLetter=null لأي فئة غير البطارية، بنيوياً في
      // computeCategoryFromTests: categoryStates.js:305-329)، يُستعمَل اسم
      // الحالة صراحةً بدل الوكيل (القاعدة 21).
      //
      // ⚠️ فجوة كانت موثَّقة (تحقّق فعلي على b45c8cf6 —
      // categoryStates.categories.battery: state="PARTIAL"، deterministicLetter=null)
      // أُغلقت جزئياً هنا (نصّ مهمّة 2026-09-21 +03) — سببان مُسمّيان
      // إضافيان، كلاهما بالحالة المُعلَنة لا بحرف مُستنتَج (القاعدة 21):
      //   • CATEGORY_GRADING_LOCKED — فئة البطارية حين canGrade=false
      //     **بقرار لا بغياب قياس** (اليوم قفل ثابت حتى معايرة PLAN-03 —
      //     categoryStates.js:394-398). canGrade نفسه محلّي داخل
      //     computeBatteryCategory، لا يصل entry كحقل باسمه — القراءة هنا
      //     على entry.noLetterReason، الحقل المُعلَن الذي يُبنى من نفس
      //     canGrade في نفس الموضع (categoryStates.js:423)، لا من
      //     deterministicLetter (ذاك يُبنى من canGrade أيضاً لكن بشكل
      //     منفصل — categoryStates.js:404 — وليس مصدر هذا الفحص).
      //     noLetterReason حقل بطارية فقط (computeCategoryFromTests
      //     وharnessErrorCategoryEntry لا يضيفانه) — entry.category
      //     === 'battery' هنا دفاع في العمق لا شرط فعلي إضافي.
      //   • HARNESS_ERROR — entry.state === 'HARNESS_ERROR' صراحةً
      //     (harnessErrorCategoryEntry، categoryStates.js:114-126؛
      //     تُبنى من buildHarnessErrorCategoryStates حين
      //     functionalResults===null — categoryStates.js:136-142/689-691).
      // NO_BASE_LETTER يبقى الوكيل لِما لا يندرج تحت الأربعة المُسمّاة
      // أعلاه — لا يُوسَّع ليبتلعها.
      record.rejectedReason =
          (entry && (entry.state === 'UNMEASURED' || entry.state === 'ATTESTED_ONLY')) ? entry.state :
          // الرمز من categoryGradingLock.js (القرار ٤٤) — لا سلسلة حرفية
          // منفصلة هنا بعد اليوم؛ القيمة نفسها بلا تغيير حرف واحد.
          (entry && entry.category === 'battery' && entry.noLetterReason) ? CATEGORY_GRADING_LOCKED_CODE :
          (entry && entry.state === 'HARNESS_ERROR') ? 'HARNESS_ERROR' :
          'NO_BASE_LETTER';
      appliedLog.push(record);
      continue;
    }

    if (direction === 'UP') {
      // صعوداً: يُحفَظ ولا يُطبَّق (نصّ P1.4 حرفياً).
      record.disputed = true;
      disputed = true;
      appliedLog.push(record);
      continue;
    }

    if (direction !== 'DOWN') {
      record.rejectedReason = 'UNKNOWN_DIRECTION';
      appliedLog.push(record);
      continue;
    }

    // DOWN — يُطبَّق بسقف درجة واحدة كحدّ أقصى، بصرف النظر عمّا يطلبه
    // النموذج (maxOneBand مفروض هنا لا مُستقبَل من الحمولة).
    const currentRank = LETTER_ORDER[entry.deterministicLetter];
    const newRank = Math.min(currentRank + 1, LETTER_ORDER.D);
    const newLetter = LETTER_BY_RANK[newRank];

    // القرار ٤٢ البند ٢ (A62) — الفئة تحمل الطرفين معاً من الآن: **لا
    // تُكتَب فوق `deterministicLetter` أبداً في هذا الفرع بعد اليوم** — ذاك
    // يبقى حرفياً ما قاله القياس الحتمي (لم يتغيّر، تمريرة بالمرجع عبر
    // `...entry` أدناه). المُستعمَل فعلياً في الاشتقاق/العرض من الآن هو
    // `finalLetter` — راجع categoryStates.js (computeCategoryFromTests/
    // computeBatteryCategory/harnessErrorCategoryEntry) حيث `finalLetter`
    // يُهيَّأ بنفس قيمة `deterministicLetter` عند البناء (قبل أي تعديل)، كي
    // يبقى حاضراً دائماً بلا حاجة لاحتياط `??` عند كل قارئ.
    if (newRank === currentRank) {
      // ⚠️ **القرار ٩٨ البند ١ (2026-09-25 +03) — الفئة أصلاً D: "مقبول بلا
      // أثر"، لا LLM_ADJUSTED.** نصّ المستخدم حرفياً: "letterSource =
      // LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن الحرف الحتمي." هنا
      // finalLetter === deterministicLetter (نفس الرتبة، لا مزيد تحت D) —
      // فلا اختلاف. **`adjustmentApplied` لا يُكتَب `true` هنا بعد اليوم**
      // (يبقى entry.adjustmentApplied الأصلي، false افتراضياً — عبر
      // `...entry` أدناه، بلا override) — هذا وحده يكفي: buildDisplayShapeV7.js:309
      // (`llmAdjusted = !!entry.adjustmentApplied`) يشتقّ letterSource
      // DETERMINISTIC تلقائياً، وadjustmentReason/adjustmentEvidence على
      // *display* يُصفَّران تلقائياً معه (buildDisplayShapeV7.js:319-320) —
      // بلا حاجة لتعديل تلك الدالّة (قارئ واحد فقط لـadjustmentApplied
      // خارج هذا الملفّ، مُتحقَّق بـgrep قبل هذا الالتزام).
      //
      // **score لا يُقصّ هنا بعد اليوم أيضاً** (كان يُقصّ لسقف BAND_MAX.D —
      // التعليق القديم: "حالة D-أصلاً قد تحمل score أعلى من سقف D فعلياً").
      // ذلك القصّ كان يُغيّر overall.measuredCategoriesMean فعلياً — أثر
      // رقمي حقيقي على overall رغم أن الحرف/letterSource لا يتغيّران الآن؛
      // هذا يناقض "بلا أثر" (نصّ القرار) مباشرة: لا يجوز أن يترك تعديل
      // "بلا أثر" أثراً صامتاً على overall. **ملاحظة منفصلة، خارج نطاق هذا
      // القرار**: التناقض بين score الخام وحرف D عبر STATE_FAIL_FLOOR
      // (categoryStates.js:559-563) قائم أصلاً في categoryStates الخام —
      // قبل أي adjustments، بصرف النظر عن هذا الفرع — ولا يُعالَج هنا (لا
      // يُطلَب، ويحتاج قراراً على categoryStates.js نفسها لا على
      // applyV7Adjustments).
      //
      // **adjustmentEvidence/adjustmentReason على categoryStates.categories.<cat>
      // تبقيان مكتوبتين** (لا تُصفَّران هنا) — سجلّ تدقيقي داخلي لما اقترحه
      // النموذج وقُبِل دليله فعلياً (evidence مُثبَت وموصول بالفئة)، حتى
      // بلا أثر مرئي؛ **لا تصلان العميل مطلقاً** بصرف النظر عن قيمتهما هنا
      // — buildDisplayShapeV7.js تُصفِّرهما دوماً حين `!llmAdjusted`
      // (مُتحقَّق: القارئ الوحيد الآخر، buildCategoryEntryForStorage في
      // analyzeDevice.js، يقرأ `display` المبنيّ لا categoryStates الخام).
      categories[category] = {
        ...entry,
        llmSuggestedLetter: newLetter,
        finalLetter: newLetter, // = entry.deterministicLetter هنا (نفس الرتبة) — صراحةً لا ضمناً
        adjustmentEvidence: evidenceRefs,
        adjustmentReason: a.reason || null,
      };
      record.applied = true;
      record.fromLetter = entry.deterministicLetter;
      record.toLetter = entry.deterministicLetter;
      record.noEffectReason = ADJUSTMENT_ACCEPTED_NO_EFFECT;
      appliedLog.push(record);
      continue;
    }

    // قصّ score إلى سقف نطاق الحرف الجديد — راجع تعليق رأس الدالّة "الإصلاح
    // جزءان معاً" (البند ٢) — هنا فقط (الرتبة تغيّرت فعلياً)، لا في الفرع
    // أعلاه بعد اليوم (القرار ٩٨-١).
    const clampedScore = (typeof entry.score === 'number' && typeof BAND_MAX[newLetter] === 'number') ?
        Math.min(entry.score, BAND_MAX[newLetter]) : entry.score;

    categories[category] = {
      ...entry,
      // deterministicLetter: **غير مُعدَّل هنا عمداً** — يبقى entry.deterministicLetter
      // عبر ...entry أعلاه (A62، راجع التعليق فوق هذا الفرع).
      llmSuggestedLetter: newLetter,
      finalLetter: newLetter,
      adjustmentApplied: true,
      adjustmentEvidence: evidenceRefs,
      adjustmentReason: a.reason || null,
      score: clampedScore,
    };
    record.applied = true;
    record.fromLetter = entry.deterministicLetter;
    record.toLetter = newLetter;
    appliedLog.push(record);
  }

  // إعادة الاشتقاق — البند ١ من "الإصلاح جزءان معاً" أعلاه. استثناء وحيد:
  // فرع HARNESS_ERROR (buildHarnessErrorCategoryStates، categoryStates.js)
  // له شكل overall خاصّ (coverage:null دلالياً غائبة لا 0% — القرار ١٢) لا
  // يُشتقّ من deriveOverallFromCategories؛ ولا حاجة أصلاً — كل الفئات غير
  // البطارية هناك deterministicLetter=null فتُرفَض كل adjustments[] أعلاه
  // NO_BASE_LETTER قبل الوصول لهذا السطر (categories لم تتغيّر بتاتاً).
  const overall = (categoryStates.overall && categoryStates.overall.harnessError === true) ?
      {...categoryStates.overall} :
      deriveOverallFromCategories(categories, Array.isArray(categoryStates.gates) ? categoryStates.gates : []);

  overall.adjustments = appliedLog;
  overall.disputed = disputed;

  return {
    ...categoryStates,
    categories,
    overall,
  };
}

module.exports = {
  buildV7Payload, applyV7Adjustments, assertNoRawSamples,
  V7_PAYLOAD_ROOT_KEYS,
  // القرار ٩٨ البند ١ — قيمة ثابتة مُصدَّرة (القاعدة 24)، يستوردها كل
  // قارئ يحتاج التمييز (اختبارات، أدوات قياس) — لا نسخة حرفية ثانية.
  ADJUSTMENT_ACCEPTED_NO_EFFECT,
  // للاختبار المباشر (القرار ٤٢ البند ١) — بنفس نمط _internal في
  // categoryStates.js/buildDisplayShapeV7.js. ليست واجهة عامّة مستقرّة.
  _internal: {
    parseEvidencePath, resolveEvidencePath, isAbsenceEvidenceValue,
    isProvenSupportiveEvidence, evaluateEvidenceRef,
    // إعادة تصدير من v7ModelPayloadWhitelist.js (مصدر الحقيقة الآن —
    // القاعدة 24) — الأسماء نفسها (buildV7Payload.test.js تستوردها من
    // هنا، لا تغيير مطلوب في المستهلك عند انتقال المصدر الداخلي).
    MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS, MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS,
    MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS,
    buildModelCategories, buildModelOverall, buildModelIssues,
    // القرار ٨٨ البند ٢ — للاختبار المباشر.
    sanitizeTestResultsForModelPayload,
    // أمر مستخدم 2026-10-01 +03 — للاختبار المباشر.
    sanitizeFindingsForModelPayload, roundPayloadNumbersDeep,
    MODEL_HIDDEN_TEST_IDS, UNCALIBRATED_TEST_IDS, MODEL_FINDINGS_POLICY, unclassifiedFindingsKeys,
    hideTestResultForModel, hideTaggedMeasurementsForModel,
    // أمر 2026-10-07 — للاختبار المباشر.
    MODEL_JUDGMENT_HIDDEN_TEST_IDS, MODEL_ALWAYS_NOT_MEASURED_TEST_IDS, hideJudgmentForModel, forceNotMeasuredForModel,
    sanitizeMetaForModel, sanitizeNotMeasuredFieldsForModel, stripNumericUnitParens, MODEL_META_KEPT_KEYS, hideIssueValuesForModel,
    // القرار ٨٨ البند ٣ — للاختبار المباشر. (isDoubleCountingAppliedGate
    // حُذفت — القرار ٩٤ البند ١، صارت بلا غاية بعد إغلاق باب البوّابات.)
    isEvidenceLinkedToCategory,
    // القرار ٩٩ البند ١ — للاختبار المباشر.
    isExcludedFromGrade,
  },
};
