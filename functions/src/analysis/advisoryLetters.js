'use strict';

// ===================================================================
// advisoryLetters.js — الحروف الإرشادية للفئات المقيسة والحرف العامّ (V8 / PLAN-05 §١-د، الدفعة ٥-أ، الصفّ S-B5a، 2026-10-21 +03)
// ===================================================================
// «حروف «إرشادية» للفئات المقيسة (المعالج، والحرارة، والتخزين، والرسوميات، والذاكرة، والأمان)، بحدود مبدئية، موسومة «إرشادي» للمشتري» (القرار د-٠،
// plan/PLAN-05-EVIDENCE-REPORT.md :129). «حرف الفئة في V8 من **خصائصها** (§٢)، لا من نسبة الاختبارات الناجحة كما في V7» (:137).
//
// دالّة خالصة: بلا شبكة ولا Firestore ولا حالة مشتركة، ولا تستدعي نموذجاً. **غير موصولة** بتقرير ولا بردّ دالّة ولا بحمولة النموذج ولا بمستند (حرف V8 المعروض = S-B7،
// P5 :637)؛ فلا شكل سلك جديد. ما يخرج منها شكل في الذاكرة موثَّق في docs/PROTOCOL_CONTRACT.md §٢-ب-٢.
//
// ─── ما تقوله الخطّة وأين يُنفَّذ هنا ───────────────────────────────────────────
//   • حروف الفئات الستّ (P5 :143-150): cpuLetter · thermalLetter · storageLetter · gpuLetter · memoryLetter · والأمان «كما V7» من categoryStates (بلا وسم «إرشادي»، د-٠-ب).
//   • شرط ثبات الخاصّية التي يُبنى عليها حرف (P5 :157-168، د-٠-ج): الخاصّية المتّصلة لا تدخل الحرف إلا ببيّنة ثبات: CV داخل الجهاز ≤ UNSTABLE_CV_THRESHOLD_PCT (15، مستورد)
//     **و**الحرف الذي تعطيه لا يتقلّب عبر فحوص الجهاز المكرّرة. ما يُخلّ بأحدهما «يخرج من الحرف ويُعرض ◐. والحرف ممّا بقي؛ فإن لم يبقَ شيء فلا حرف («لم يُقَس»)» (:163).
//     الواقعة (حالة حرارية، وعدّاد أخطاء، وتجزئة، ونتيجة معروفة) حقيقة لا خاصّية متّصلة: لا CV لها، ولا تُخرَج بتقلّب (مثال P5 :168: الحرارة على S21 «تقلّبت بواقعة مقيسة فيبقى حرفها»).
//     **بيّنة الثبات مُدخل صريح** (stability): تُحسب من فحوص الجهاز المكرّرة خارج هذا الملفّ (assessStability أدناه؛ ومخزنها S-B6)، وغيابها ⟵ الخاصّية المتّصلة لا تدخل الحرف
//     (STABILITY_NOT_ESTABLISHED) — الغياب لا يُقرأ ثباتاً (القاعدة 22). **هذا اختياري: الخطّة لا تقول ما يحدث حين لا بيّنة بعد** (اختيار S-B5a، في تقرير الأمر).
//   • الحرف العامّ (P5 :170-186): المتوسّط المرجَّح لرُتب الحروف (A=0 … D=3) على الفئات ذات الحرف بأوزان CATEGORY_WEIGHTS، **ونصف الرتبة يُقرَّب نحو الأسوأ**؛ والبطارية خارجه (د-٢)؛
//     ثم البوّابات الثابتة سقفاً بترتيب computeGates (ROOT_DETECTED ⟵ C، PATCH_AGE ⟵ B، STORAGE_VERIFY_ERRORS ⟵ D، GPU_HASH_MISMATCH ⟵ D، SUSTAINED_CEILING يبقى DISABLED)؛
//     LOW_CATEGORY_COVERAGE لا تنطبق (الحروف لم تعد من نسبة الاختبارات)؛ ولا فئة بحرف ⟵ لا حرف عامّ (noDataAtAll). وسمه «إرشادي» ما دامت فئة داخلة فيه إرشادية (advisory).
//   • وصل بوّابتي التخزين والرسوميات (P5 :177): تُوصلان **هنا** (في محرّك V8) بحقول fv68: STORAGE_VERIFY_ERRORS من storageWriteVerifyErrors/storageReadVerifyErrors وحالة storageVerifyState؛
//     وGPU_HASH_MISMATCH من تجزئة الشظايا وGEMM ومهلة السياج. **computeGates في categoryStates.js (مسار V7 المنشور) لم تُمسّ**: تُخرج NOT_WIRED للبوّابتين كما كانت، وهذا الملفّ يستبدلهما في قائمته.
//     (توصيلهما في مسار V7 نفسه يغيّر حروف تقارير منشورة وعيّنات ذهبية مجمَّدة — يُترك لحين يحلّ محرّك V8 محلّ مصدر الحرف في S-B7.)
//
// ما لا يُبنى هنا (معلَّق في تقرير الأمر، لا اختراع): جملة حرف المعالج المعروضة (§١-د-٥؛ نصّها معتمد لكن عرضها S-B7)، وتقييما الحرارة والرسوميات الرتبيّان (د-٠-أ، الدفعة ١١)،
// وكابا المطابقة ورفع «إرشادي» (§١-د-٤؛ أداة المنسّق)، وكل ما يحتاج بيّنة من مخزن الخصائص (S-B6).

const N = require('./fv68Names');
const {CATEGORY_WEIGHTS, LETTER_ORDER, LETTER_BY_RANK, _internal: CS} = require('./categoryStates');
const {classifyStability} = require('./featureLibrary');
const {FEATURE, STATUS} = require('./featureNames');
const {THRESHOLD_SET_VERSION, thresholds: T} = require('./thresholdSetVersioned');
const {pstdev, mean} = require('./findings')._internal;

const ADVISORY_LETTERS_VERSION = 1;

// الفئات الستّ بترتيب P5 :143-150. البطارية خارجها (د-٢).
const ADVISORY_CATEGORIES = Object.freeze(['cpu', 'thermal', 'storage', 'gpu', 'memory', 'security']);
// الأمان وحده بلا وسم «إرشادي» (د-٠-ب: مدخلاته حقائق وسياسة معلنة).
const NON_ADVISORY_CATEGORIES = Object.freeze(['security']);

// نوع الخاصّية الداخلة في حرف: متّصلة (تحتاج بيّنة ثبات) أو واقعة/حقيقة (لا CV لها).
const PROPERTY_KIND = Object.freeze({CONTINUOUS: 'CONTINUOUS', EVENT: 'EVENT', FACT: 'FACT'});
// حالة الخاصّية في الحرف.
const PROPERTY_STATE = Object.freeze({ADMITTED: 'ADMITTED', EXCLUDED: 'EXCLUDED', ABSENT: 'ABSENT'});
// كيف تُعرض الخاصّية (يقرؤها عارض S-B7): دخلت الحرف، أو خرجت ◐، أو غير مقيسة.
const DISPLAY_AS = Object.freeze({LETTER_INPUT: 'LETTER_INPUT', ADVISORY_DOT: 'ADVISORY_DOT', NOT_MEASURED: 'NOT_MEASURED'});

// أسماء مفردة هذا المحرّك (اسم خادم؛ لا نصّ مستخدم). الأسماء المشتركة مع مكتبة الخصائص تُؤخذ من FEATURE.
const PROPERTY = Object.freeze({
  CPU_CEILING_COMBINED: 'cpu.sustained_combined', //  P5 :145 «sustainedCeiling.combined.meanWindowMaxRatio» — ليست من F1..F19 (P5 يسمّي المدخل نصّاً)
  CPU_RECOVERY: FEATURE.CPU_RECOVERY_P7,
  CPU_KNOWN_ANSWER: 'cpu.known_answer', //            حقيقة D
  THERMAL_STATUS_MAX: FEATURE.THERMAL_STATUS_MAX,
  THERMAL_HEADROOM_PEAK: FEATURE.THERMAL_HEADROOM_PEAK,
  STORAGE_POST_OVER_IN_CACHE: 'storage.post_over_in_cache', // F10 ÷ F9 (P5 :147)
  STORAGE_VERIFY_ERRORS: 'storage.verify_errors', //  حقيقة D
  GPU_COMPUTE_GEMM: 'gpu.compute_gemm', //            حقيقة D/A
  GPU_FRAGMENT_HASH: 'gpu.fragment_hash', //          حقيقة D/A
  GPU_FENCE_TIMEOUTS: 'gpu.fence_timeouts', //        حقيقة D/A
  MEMORY_VERIFY_ERRORS: 'memory.verify_errors', //    حقيقة D/A
});

const REASON = Object.freeze({
  HARNESS_ERROR: 'HARNESS_ERROR', //                             لا عيّنات صالحة (المكتبة NOT_MEASURED)
  INPUT_ABSENT: 'INPUT_ABSENT', //                               مُدخل الحرف غائب: reasonDetail يسمّي المُدخل وسبب غيابه
  STABILITY_NOT_ESTABLISHED: 'STABILITY_NOT_ESTABLISHED', //     لا بيّنة ثبات للخاصّية المتّصلة (لا فحوص مكرّرة بعد)
  CV_ABOVE_LIMIT: 'CV_ABOVE_LIMIT', //                           CV داخل الجهاز فوق UNSTABLE_CV_THRESHOLD_PCT
  LETTER_FLUCTUATES: 'LETTER_FLUCTUATES', //                     الحرف الذي تعطيه الخاصّية يتقلّب عبر الفحوص المكرّرة
  STORAGE_VERIFY_NOT_RUN: 'STORAGE_VERIFY_NOT_RUN', //           لا منتِج/لم تجرِ القراءة الراجعة (storageVerifyState ≠ ran) — د-٠-هـ
  MEMORY_VERIFY_NOT_COMPLETE: 'MEMORY_VERIFY_NOT_COMPLETE', //   عدّادات الذاكرة غائبة أو الاختبار لم يكتمل (memoryVerifyState ≠ ran)
  GPU_VERIFICATION_INCOMPLETE: 'GPU_VERIFICATION_INCOMPLETE', // GEMM/التجزئة/المهلة: بعضها غائب أو لم يُنفَّذ
  V7_NO_LETTER: 'V7_NO_LETTER', //                               الأمان: حالة الفئة في V7 لا تُنتج حرفاً
});

// ─── بيّنة الثبات ───────────────────────────────────────────────────────────

/**
 * يقدّر ثبات خاصّية متّصلة من قيمها على فحوص جهاز واحد مكرّرة (P5 §١-د-٢): CV داخل الجهاز بالصيغة نفسها في findings.js (الانحراف المعياري السكاني ÷ |المتوسّط| × 100)،
 * وهل يتقلّب الحرف الذي تعطيه قيمةٌ قيمةً. لا CV بأقلّ من THRESHOLD minRepeatedScans فحصاً (الغياب لا يُقرأ ثباتاً).
 * @param {number[]} values قيم الخاصّية على الفحوص المكرّرة (غير الرقمية تُهمَل وتُعدّ)
 * @param {function(number): string} letterOf الحرف الذي تعطيه القيمة وحدها (نفس قاعدة الفئة)
 * @return {Object} {nRepeats, cvPct: رقم|null, letterStable: بولي|null, letters: []}
 */
function assessStability(values, letterOf) {
  const xs = (Array.isArray(values) ? values : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  const enough = xs.length >= T.minRepeatedScans.value;
  const m = enough ? mean(xs) : null;
  const letters = xs.map(letterOf);
  return {
    nRepeats: xs.length,
    cvPct: enough && m !== 0 ? (pstdev(xs) / Math.abs(m)) * 100 : null,
    letterStable: enough ? letters.every((l) => l === letters[0]) : null,
    letters,
  };
}

// هل تدخل الخاصّية المتّصلة الحرف؟ {admitted, reason}. noValueByDesign: لا قيمة متّصلة في هذا الفحص بتصميم الخاصّية (لا ركبة) فلا CV منطبق، ويبقى شرط عدم التقلّب.
function stabilityVerdict(evidence, noValueByDesign) {
  if (!evidence || typeof evidence !== 'object') return {admitted: false, reason: REASON.STABILITY_NOT_ESTABLISHED};
  if (evidence.letterStable === null || evidence.letterStable === undefined) return {admitted: false, reason: REASON.STABILITY_NOT_ESTABLISHED};
  if (!noValueByDesign) {
    const cv = classifyStability(evidence.cvPct);
    if (cv === STATUS.NOT_MEASURED) return {admitted: false, reason: REASON.STABILITY_NOT_ESTABLISHED};
    if (cv === 'UNSTABLE') return {admitted: false, reason: REASON.CV_ABOVE_LIMIT};
  }
  if (evidence.letterStable !== true) return {admitted: false, reason: REASON.LETTER_FLUCTUATES};
  return {admitted: true, reason: null};
}

// ─── سجلّ الخاصّية داخل حرف ────────────────────────────────────────────────

function absentProperty(name, kind, reason, reasonDetail) {
  return {name, kind, value: null, state: PROPERTY_STATE.ABSENT, reason, reasonDetail: reasonDetail === undefined ? null : reasonDetail, displayAs: DISPLAY_AS.NOT_MEASURED};
}
function admittedProperty(name, kind, value) {
  return {name, kind, value, state: PROPERTY_STATE.ADMITTED, reason: null, reasonDetail: null, displayAs: DISPLAY_AS.LETTER_INPUT};
}
function excludedProperty(name, kind, value, reason) {
  return {name, kind, value, state: PROPERTY_STATE.EXCLUDED, reason, reasonDetail: null, displayAs: DISPLAY_AS.ADVISORY_DOT};
}

// خاصّية من سجلّ مكتبة الخصائص (featureLibrary) بنوعها: المتّصلة تمرّ بشرط الثبات، والواقعة لا.
function propertyFromFeature(name, kind, featureRecord, stability, opts) {
  const noValueByDesign = !!(opts && opts.noValueByDesign);
  if (!featureRecord || featureRecord.status !== STATUS.MEASURED) {
    return absentProperty(name, kind, REASON.INPUT_ABSENT, featureRecord ? featureRecord.reason : 'FEATURE_NOT_IN_LIBRARY');
  }
  if (kind !== PROPERTY_KIND.CONTINUOUS) return admittedProperty(name, kind, featureRecord.value);
  const v = stabilityVerdict(stability && stability[name], noValueByDesign);
  return v.admitted ? admittedProperty(name, kind, featureRecord.value) : excludedProperty(name, kind, featureRecord.value, v.reason);
}

// المُدخل «السقف المستدام المجمَّع» (P5 :145): من findings.sustainedCeiling.combined لا من F1..F19؛ بوّابته بوّابة السقف المستدام نفسها.
function combinedCeilingRecord(findings) {
  const s = findings && findings.sustainedCeiling;
  if (!s || s.status !== STATUS.MEASURED) return {status: STATUS.NOT_MEASURED, reason: (s && s.notMeasuredReason) || 'HARNESS_ERROR', value: null};
  const v = s.combined && typeof s.combined.meanWindowMaxRatio === 'number' && Number.isFinite(s.combined.meanWindowMaxRatio) ? s.combined.meanWindowMaxRatio : null;
  return v === null ? {status: STATUS.NOT_MEASURED, reason: 'NO_SAMPLES_IN_PHASE', value: null} : {status: STATUS.MEASURED, reason: null, value: v};
}

// ─── حقائق التحقّق من قراءة fv68 (لا تحتاج CV) ───────────────────────────────

const kindOf = (stateCell) => (stateCell && stateCell.state && typeof stateCell.state.kind === 'string' ? stateCell.state.kind : null);
const intOrNull = (v) => (Number.isInteger(v) ? v : null);

/**
 * يستخرج من `readFv68(...)` حقائق التحقّق التي تقوم عليها حروف D وA. **يُعلن ما لم يجده** (القاعدة 25): كل مُدخل غائب = null بحالته لا صفراً.
 * @param {Object} fv68 ناتج readFv68 (أو {readerError})
 * @return {Object} {cpu, storage, memory, gpu}
 */
function extractVerificationFacts(fv68) {
  const v = fv68 && fv68.verification && typeof fv68.verification === 'object' ? fv68.verification : null;
  const absent = v === null;

  // المعالج: «خطأ في نتائج الحساب وحده: عدّ الأعداد الأولية ≠ المرجع، أو SHA-256 ≠ المرجع (قرار 2026-10-08 ✓). والعدد خامّ يُشحن، والخادم يحكم» (P5 :145).
  // ⟵ الخامّ يُقارَن بمرجع N نفسه حين يكون قابلاً للمقارنة (primeCountVsReference ∈ EQUAL|DIFFERENT) فيحكم الخادم منه؛ وإلا حالة التطبيق (match/mismatch). SHA حالته وحدها (لا خامّ لها).
  let cpu = {state: null, runs: 0, mismatch: null, mismatchRuns: 0, judgedFromRaw: 0, judgedFromStatus: 0};
  if (!absent && v.cpuKnownAnswer) {
    const ka = v.cpuKnownAnswer;
    const items = ka.runs && Array.isArray(ka.runs.items) ? ka.runs.items : [];
    let mismatchRuns = 0;
    let judgedFromRaw = 0;
    let judgedFromStatus = 0;
    let anyJudged = false;
    for (const r of items) {
      let bad = false;
      const cmp = r.sieve ? r.sieve.primeCountVsReference : null;
      if (cmp === 'EQUAL' || cmp === 'DIFFERENT') {
        anyJudged = true;
        judgedFromRaw++;
        if (cmp === 'DIFFERENT') bad = true;
      } else if (r.sieve && r.sieve.status && (r.sieve.status.kind === N.STATE_KIND.MATCH || r.sieve.status.kind === N.STATE_KIND.MISMATCH)) {
        anyJudged = true;
        judgedFromStatus++;
        if (r.sieve.status.kind === N.STATE_KIND.MISMATCH) bad = true;
      }
      const shaKind = r.sha256 && r.sha256.status ? r.sha256.status.kind : null;
      if (shaKind === N.STATE_KIND.MATCH || shaKind === N.STATE_KIND.MISMATCH) {
        anyJudged = true;
        if (shaKind === N.STATE_KIND.MISMATCH) bad = true;
      }
      if (bad) mismatchRuns++;
    }
    cpu = {state: kindOf(ka.state), runs: items.length, mismatch: anyJudged ? mismatchRuns > 0 : null, mismatchRuns, judgedFromRaw, judgedFromStatus};
  }

  // التخزين: الصفر مقيس حقيقي فقط مع storageVerifyState = ran (عقد :615).
  let storage = {stateKind: null, writeErrors: null, readErrors: null};
  if (!absent && v.storage) {
    storage = {stateKind: kindOf(v.storage.state), writeErrors: intOrNull(v.storage.errors && v.storage.errors.write), readErrors: intOrNull(v.storage.errors && v.storage.errors.read)};
  }

  // الذاكرة: العدّادات الثلاثة والحالة.
  let memory = {stateKind: null, march: null, walkingOnes: null, randomVerify: null};
  if (!absent && v.memory) {
    const e = v.memory.errors || {};
    memory = {stateKind: kindOf(v.memory.state), march: intOrNull(e.march), walkingOnes: intOrNull(e.walkingOnes), randomVerify: intOrNull(e.randomVerify)};
  }

  // الرسوميات: GEMM (حالة fv68 ثم القيمة المنطقية)، وتجزئة الشظايا، ومهلة السياج.
  // GEMM: ≥ 68 ⟵ حالة passed/failed/not_run:* هي الدليل. ختم < 68 (لا حالة) ⟵ القيمة المنطقية وحدها، **وعقد fv68 يقول إنها «صحيحة» افتراضاً حين لم تُنفَّذ المرحلة** (س-23، عقد :303):
  // تُقبل هنا كما قبلتها P5 :148 (A×6 على فحوص fv67) ويُوسَم أساسها LEGACY_DEFAULT_TRUE لتُرى (قيد معروف، يُذكر في تقرير الأمر).
  let gpu = {gemm: {verdict: GEMM_VERDICT.UNKNOWN, basis: null}, hashMatches: null, hashTotal: null, fenceTimeouts: null};
  if (!absent && v.gpuGemm) {
    const gk = kindOf(v.gpuGemm.state);
    const correct = typeof v.gpuGemm.correct === 'boolean' ? v.gpuGemm.correct : null;
    let verdict = GEMM_VERDICT.UNKNOWN;
    let basis = null;
    if (gk === N.STATE_KIND.PASSED) { verdict = GEMM_VERDICT.OK; basis = 'STATE'; }
    else if (gk === N.STATE_KIND.FAILED) { verdict = GEMM_VERDICT.FAIL; basis = 'STATE'; }
    else if (gk === N.STATE_KIND.NOT_RUN) { verdict = GEMM_VERDICT.NOT_EXECUTED; basis = 'STATE'; }
    else if (gk === null && correct === false) { verdict = GEMM_VERDICT.FAIL; basis = 'LEGACY_VALUE'; }
    else if (gk === null && correct === true) { verdict = GEMM_VERDICT.OK; basis = 'LEGACY_DEFAULT_TRUE'; }
    gpu.gemm = {verdict, basis};
  }
  if (!absent && v.gpuFragmentHash) {
    gpu.hashMatches = intOrNull(v.gpuFragmentHash.matches);
    gpu.hashTotal = intOrNull(v.gpuFragmentHash.total);
  }
  if (!absent && v.gpuFenceTimeout) gpu.fenceTimeouts = intOrNull(v.gpuFenceTimeout.count);

  return {cpu, storage, memory, gpu};
}

// ─── حروف الفئات ────────────────────────────────────────────────────────────

const noLetter = (category, reason, reasonDetail, properties, inputs) => ({
  category, letter: null, status: STATUS.NOT_MEASURED, reason, reasonDetail: reasonDetail === undefined ? null : reasonDetail,
  basis: null, advisory: !NON_ADVISORY_CATEGORIES.includes(category), properties: properties || [], inputs: inputs || {},
});
const withLetter = (category, letter, basis, properties, inputs) => ({
  category, letter, status: STATUS.MEASURED, reason: null, reasonDetail: null,
  basis, advisory: !NON_ADVISORY_CATEGORIES.includes(category), properties: properties || [], inputs: inputs || {},
});
const BASIS = Object.freeze({FACT: 'FACT', PROPERTIES: 'PROPERTIES', V7: 'V7'});
// حكم GEMM كما يقرؤه المحرّك (اسم خادم): OK سليم، FAIL خاطئ، NOT_EXECUTED لم تُنفَّذ المرحلة (gpuComputeGemmState = not_run:*)، UNKNOWN لا حالة ولا قيمة.
// (NOT_EXECUTED لا NOT_RUN: الاسم الأخير حرفي في sessionNames.js وحده — test/sessionNames.test.js، القاعدة 24.)
const GEMM_VERDICT = Object.freeze({OK: 'OK', FAIL: 'FAIL', NOT_EXECUTED: 'NOT_EXECUTED', UNKNOWN: 'UNKNOWN'});

// لا حرف لأن الخاصّية (الخاصّيات) الحاجبة غائبة أو خرجت: السبب سبب أوّل حاجب — خروجٌ بسببه (ثبات) أو غيابٌ مسمّى بتفصيله. props كلّها تُسجَّل في السجلّ.
function noLetterFromProperties(category, blockers, props, inputs) {
  const first = blockers.find((p) => p.state !== PROPERTY_STATE.ADMITTED);
  if (!first) return noLetter(category, REASON.INPUT_ABSENT, null, props, inputs);
  if (first.state === PROPERTY_STATE.EXCLUDED) return noLetter(category, first.reason, first.name, props, inputs);
  return noLetter(category, REASON.INPUT_ABSENT, `${first.name}:${first.reasonDetail}`, props, inputs);
}

// المعالج (P5 :145): D من خطأ نتيجة معروفة وحده؛ A: السقف ≥ 0.90 **و**التعافي ≥ 0.90؛ B: السقف ≥ 0.75؛ C ما دونه.
// **اختيار S-B5a:** A تتطلّب التعافي حاضراً وداخلاً الحرف (غيابه أو خروجه لعدم الثبات ⟵ لا A، فيبقى B)، فلا يُقرأ غياب التعافي نجاحاً (القاعدة 22).
function cpuLetter(features, findings, facts, stability) {
  const ceilRec = combinedCeilingRecord(findings);
  const ceil = propertyFromFeature(PROPERTY.CPU_CEILING_COMBINED, PROPERTY_KIND.CONTINUOUS, ceilRec, stability);
  const rec = propertyFromFeature(PROPERTY.CPU_RECOVERY, PROPERTY_KIND.CONTINUOUS, features && features[FEATURE.CPU_RECOVERY_P7], stability);
  const ka = facts.cpu;
  const kaProp = ka.mismatch === null ? absentProperty(PROPERTY.CPU_KNOWN_ANSWER, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, `cpuKnownAnswerState=${ka.state === null ? 'absent' : ka.state}`) :
    admittedProperty(PROPERTY.CPU_KNOWN_ANSWER, PROPERTY_KIND.FACT, ka.mismatchRuns);
  const props = [ceil, rec, kaProp];
  const inputs = {ceiling: ceil.value, recovery: rec.value, knownAnswerMismatchRuns: ka.mismatch === null ? null : ka.mismatchRuns};
  if (ka.mismatch === true) return withLetter('cpu', 'D', BASIS.FACT, props, inputs);
  if (ceil.state !== PROPERTY_STATE.ADMITTED) return noLetterFromProperties('cpu', [ceil], props, inputs);
  if (ceil.value >= T.cpuCeilingA.value && rec.state === PROPERTY_STATE.ADMITTED && rec.value >= T.cpuRecoveryA.value) return withLetter('cpu', 'A', BASIS.PROPERTIES, props, inputs);
  if (ceil.value >= T.cpuCeilingB.value) return withLetter('cpu', 'B', BASIS.PROPERTIES, props, inputs);
  return withLetter('cpu', 'C', BASIS.PROPERTIES, props, inputs);
}

// الحرارة (P5 :146): D: EMERGENCY أو SHUTDOWN (≥ 5)؛ C: CRITICAL (4)؛ B: SEVERE (3) أو headroom ≥ 1.0؛ A: دون SEVERE **و**headroom < 1.0.
// الحالة القصوى واقعة (لا CV)؛ وذروة headroom متّصلة. A تتطلّب الاثنتين؛ والأسوأ يُحكم بالحالة وحدها.
function thermalLetter(features, stability) {
  const st = propertyFromFeature(PROPERTY.THERMAL_STATUS_MAX, PROPERTY_KIND.EVENT, features && features[FEATURE.THERMAL_STATUS_MAX], stability);
  const hr = propertyFromFeature(PROPERTY.THERMAL_HEADROOM_PEAK, PROPERTY_KIND.CONTINUOUS, features && features[FEATURE.THERMAL_HEADROOM_PEAK], stability);
  const props = [st, hr];
  const inputs = {statusMax: st.value, headroomPeak: hr.value};
  const S = st.state === PROPERTY_STATE.ADMITTED ? st.value : null;
  const H = hr.state === PROPERTY_STATE.ADMITTED ? hr.value : null;
  if (S !== null && S >= T.thermalStatusEmergency.value) return withLetter('thermal', 'D', BASIS.PROPERTIES, props, inputs);
  if (S !== null && S >= T.thermalStatusCritical.value) return withLetter('thermal', 'C', BASIS.PROPERTIES, props, inputs);
  if ((S !== null && S >= T.thermalStatusSevere.value) || (H !== null && H >= T.thermalHeadroomSevere.value)) return withLetter('thermal', 'B', BASIS.PROPERTIES, props, inputs);
  if (S !== null && H !== null) return withLetter('thermal', 'A', BASIS.PROPERTIES, props, inputs);
  return noLetterFromProperties('thermal', [st, hr], props, inputs);
}

// التخزين (P5 :147، :157-168، د-٠-هـ): D: أخطاء التحقّق > 0 (حقيقة)؛ **ولا حرف بلا منتِج حقيقي للتحقّق** (storageVerifyState = ran)؛ A: 0 أخطاء ولا انهيار (النسبة F10÷F9 ≥ 0.5 أو لا ركبة)؛
// B: النسبة < 0.5. النسبة متّصلة: تُقبل ببيّنة ثبات، وحالة «لا ركبة» تُقبل بعدم تقلّب الحرف وحده (لا قيمة متّصلة). وما لا تثبت فيه النسبة (على بيانات اليوم: تتقلّب A/B/B) يخرج ⟵ لا حرف.
function storageLetter(features, facts, stability) {
  const s = facts.storage;
  const inCache = features && features[FEATURE.STORAGE_IN_CACHE_MBPS];
  const post = features && features[FEATURE.STORAGE_POST_CACHE_MBPS];
  const noKnee = !!(inCache && inCache.status === STATUS.MEASURED && post && post.status === STATUS.NOT_MEASURED && post.reason === 'NO_KNEE_IN_SCAN');
  const bothMeasured = !!(inCache && inCache.status === STATUS.MEASURED && post && post.status === STATUS.MEASURED);
  const ratioRecord = (bothMeasured && inCache.value > 0) ?
    {status: STATUS.MEASURED, reason: null, value: post.value / inCache.value} :
    (bothMeasured ? {status: STATUS.NOT_MEASURED, reason: 'ZERO_DENOMINATOR', value: null} : noKnee ? {status: STATUS.MEASURED, reason: null, value: null} : {status: STATUS.NOT_MEASURED, reason: (post && post.reason) || (inCache && inCache.reason) || 'FEATURE_NOT_IN_LIBRARY', value: null});
  const ratio = ratioRecord.status === STATUS.MEASURED ?
    (() => {
      const v = stabilityVerdict(stability && stability[PROPERTY.STORAGE_POST_OVER_IN_CACHE], noKnee);
      return v.admitted ? admittedProperty(PROPERTY.STORAGE_POST_OVER_IN_CACHE, PROPERTY_KIND.CONTINUOUS, ratioRecord.value) :
        excludedProperty(PROPERTY.STORAGE_POST_OVER_IN_CACHE, PROPERTY_KIND.CONTINUOUS, ratioRecord.value, v.reason);
    })() : absentProperty(PROPERTY.STORAGE_POST_OVER_IN_CACHE, PROPERTY_KIND.CONTINUOUS, REASON.INPUT_ABSENT, ratioRecord.reason);
  const errors = (s.writeErrors === null && s.readErrors === null) ?
    absentProperty(PROPERTY.STORAGE_VERIFY_ERRORS, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, `storageVerifyState=${s.stateKind === null ? 'absent' : s.stateKind}`) :
    admittedProperty(PROPERTY.STORAGE_VERIFY_ERRORS, PROPERTY_KIND.FACT, (s.writeErrors || 0) + (s.readErrors || 0));
  const props = [errors, ratio];
  const inputs = {writeErrors: s.writeErrors, readErrors: s.readErrors, verifyState: s.stateKind, ratioPostOverInCache: ratioRecord.value, noKnee};
  if ((s.writeErrors !== null && s.writeErrors > 0) || (s.readErrors !== null && s.readErrors > 0)) return withLetter('storage', 'D', BASIS.FACT, props, inputs);
  if (s.stateKind !== N.STATE_KIND.RAN || s.writeErrors === null || s.readErrors === null) {
    return noLetter('storage', REASON.STORAGE_VERIFY_NOT_RUN, `storageVerifyState=${s.stateKind === null ? 'absent' : s.stateKind}`, props, inputs);
  }
  if (ratio.state !== PROPERTY_STATE.ADMITTED) return noLetterFromProperties('storage', [ratio], props, inputs);
  if (noKnee || ratio.value >= T.storageCollapseRatio.value) return withLetter('storage', 'A', BASIS.PROPERTIES, props, inputs);
  return withLetter('storage', 'B', BASIS.PROPERTIES, props, inputs);
}

// الرسوميات (P5 :148): D: تجزئة لا تطابق، أو GEMM خاطئ، أو مهلة؛ A: كلّها سليمة. لا B ولا C حتى M5 (بعد التسليم). A تتطلّب الثلاثة حاضرة ومنفَّذة (الغياب لا يُقرأ سلامة).
// تنبيه (القاعدة 14): برومبت V6 (systemPromptV6.js:98 و:334) يعامل gpuFenceTimeoutCount > 0 «بوّابة ثقة على v[10] لا عطباً»؛ وP5 :148 تجعل «المهلة» D — يُتّبع نصّ P5 (المواصفة)، ويُذكر الفرق.
function gpuLetter(facts) {
  const g = facts.gpu;
  const hashBad = g.hashTotal !== null && g.hashTotal > 0 && g.hashMatches !== null && g.hashMatches < g.hashTotal;
  const timeoutBad = g.fenceTimeouts !== null && g.fenceTimeouts > 0;
  const props = [
    g.gemm.verdict === GEMM_VERDICT.UNKNOWN || g.gemm.verdict === GEMM_VERDICT.NOT_EXECUTED ? absentProperty(PROPERTY.GPU_COMPUTE_GEMM, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, `gemm=${g.gemm.verdict}`) :
      admittedProperty(PROPERTY.GPU_COMPUTE_GEMM, PROPERTY_KIND.FACT, g.gemm.verdict === GEMM_VERDICT.OK),
    g.hashTotal === null || g.hashMatches === null ? absentProperty(PROPERTY.GPU_FRAGMENT_HASH, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, 'gpuFragmentHash absent') :
      (g.hashTotal === 0 ? absentProperty(PROPERTY.GPU_FRAGMENT_HASH, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, 'gpuFragmentHashTotal=0 (0 من 0 لا يميّز «لم يُنفَّذ»)') :
        admittedProperty(PROPERTY.GPU_FRAGMENT_HASH, PROPERTY_KIND.FACT, g.hashMatches === g.hashTotal)),
    g.fenceTimeouts === null ? absentProperty(PROPERTY.GPU_FENCE_TIMEOUTS, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, 'gpuFenceTimeoutCount absent') :
      admittedProperty(PROPERTY.GPU_FENCE_TIMEOUTS, PROPERTY_KIND.FACT, g.fenceTimeouts),
  ];
  const inputs = {gemmVerdict: g.gemm.verdict, gemmBasis: g.gemm.basis, hashMatches: g.hashMatches, hashTotal: g.hashTotal, fenceTimeouts: g.fenceTimeouts};
  if (g.gemm.verdict === GEMM_VERDICT.FAIL || hashBad || timeoutBad) return withLetter('gpu', 'D', BASIS.FACT, props, inputs);
  if (g.gemm.verdict === GEMM_VERDICT.OK && g.hashTotal !== null && g.hashTotal > 0 && g.hashMatches === g.hashTotal && g.fenceTimeouts === 0) return withLetter('gpu', 'A', BASIS.FACT, props, inputs);
  const missing = props.filter((p) => p.state !== PROPERTY_STATE.ADMITTED).map((p) => `${p.name}:${p.reasonDetail}`).join(' | ');
  return noLetter('gpu', REASON.GPU_VERIFICATION_INCOMPLETE, missing, props, inputs);
}

// الذاكرة (P5 :149): D: أخطاء > 0؛ A: 0 أخطاء **والاختبار اكتمل** (memoryVerifyState = ran). غير ذلك «لم يُقَس» (لا عدّاد في fv67).
function memoryLetter(facts) {
  const m = facts.memory;
  const counters = [m.march, m.walkingOnes, m.randomVerify];
  const props = [counters.every((x) => x === null) ?
    absentProperty(PROPERTY.MEMORY_VERIFY_ERRORS, PROPERTY_KIND.FACT, REASON.INPUT_ABSENT, `memoryVerifyState=${m.stateKind === null ? 'absent' : m.stateKind}`) :
    admittedProperty(PROPERTY.MEMORY_VERIFY_ERRORS, PROPERTY_KIND.FACT, counters.reduce((a, x) => a + (x || 0), 0))];
  const inputs = {march: m.march, walkingOnes: m.walkingOnes, randomVerify: m.randomVerify, verifyState: m.stateKind};
  if (counters.some((x) => x !== null && x > 0)) return withLetter('memory', 'D', BASIS.FACT, props, inputs);
  if (counters.every((x) => x === 0) && m.stateKind === N.STATE_KIND.RAN) return withLetter('memory', 'A', BASIS.FACT, props, inputs);
  return noLetter('memory', REASON.MEMORY_VERIFY_NOT_COMPLETE, `memoryVerifyState=${m.stateKind === null ? 'absent' : m.stateKind}`, props, inputs);
}

// الأمان (P5 :150): الحرف القائم في V7 كما هو (SEC-01..11، STATE_FAIL_FLOOR للجذر ⟵ D) — يُقرأ من categoryStates ولا يُعاد اشتقاقه. بلا وسم «إرشادي».
function securityLetter(categoryStates) {
  const entry = categoryStates && categoryStates.categories ? categoryStates.categories.security : null;
  if (!entry) return noLetter('security', REASON.INPUT_ABSENT, 'categoryStates.categories.security absent', [], {});
  const inputs = {v7State: entry.state, v7Letter: entry.deterministicLetter};
  if (entry.deterministicLetter === null || entry.deterministicLetter === undefined) return noLetter('security', REASON.V7_NO_LETTER, `state=${entry.state}`, [], inputs);
  return withLetter('security', entry.deterministicLetter, BASIS.V7, [], inputs);
}

// ─── البوّابات: توصيل STORAGE_VERIFY_ERRORS وGPU_HASH_MISMATCH ─────────────────

// STORAGE_VERIFY_ERRORS ⟵ D: FIRED إن وُجد خطأ كتابة أو قراءة راجعة؛ NOT_FIRED إن قيس الصفر حقيقياً (storageVerifyState = ran والعدّادان حاضران)؛ وإلا INPUT_ABSENT (لا قياس، لا «لم يتحقّق»).
function storageVerifyGate(facts) {
  const s = facts.storage;
  const base = {name: 'STORAGE_VERIFY_ERRORS', category: 'storage', ceilingLetter: 'D'};
  if ((s.writeErrors !== null && s.writeErrors > 0) || (s.readErrors !== null && s.readErrors > 0)) {
    return Object.assign(base, {status: 'FIRED', source: `storageWriteVerifyErrors=${s.writeErrors}, storageReadVerifyErrors=${s.readErrors}`});
  }
  if (s.stateKind === N.STATE_KIND.RAN && s.writeErrors === 0 && s.readErrors === 0) {
    return Object.assign(base, {status: 'NOT_FIRED', source: 'storageVerifyState=ran, errors write=0 read=0'});
  }
  return Object.assign(base, {status: 'INPUT_ABSENT', source: `storageVerifyState=${s.stateKind === null ? 'absent' : s.stateKind} — لا قياس للقراءة الراجعة (الصفر مقيس حقيقي فقط مع ran)`});
}

// GPU_HASH_MISMATCH ⟵ D: FIRED إن لم تتطابق التجزئة أو فشل GEMM أو وقعت مهلة سياج؛ NOT_FIRED إن سلمت الثلاثة وأُنجزت؛ وإلا INPUT_ABSENT.
function gpuHashGate(facts) {
  const g = facts.gpu;
  const base = {name: 'GPU_HASH_MISMATCH', category: 'gpu', ceilingLetter: 'D'};
  const hashBad = g.hashTotal !== null && g.hashTotal > 0 && g.hashMatches !== null && g.hashMatches < g.hashTotal;
  const timeoutBad = g.fenceTimeouts !== null && g.fenceTimeouts > 0;
  if (g.gemm.verdict === GEMM_VERDICT.FAIL || hashBad || timeoutBad) {
    const parts = [];
    if (hashBad) parts.push(`gpuFragmentHash ${g.hashMatches}/${g.hashTotal}`);
    if (g.gemm.verdict === GEMM_VERDICT.FAIL) parts.push('gpuComputeGemm failed');
    if (timeoutBad) parts.push(`gpuFenceTimeoutCount=${g.fenceTimeouts}`);
    return Object.assign(base, {status: 'FIRED', source: parts.join('؛ ')});
  }
  if (g.gemm.verdict === GEMM_VERDICT.OK && g.hashTotal > 0 && g.hashMatches === g.hashTotal && g.fenceTimeouts === 0) {
    return Object.assign(base, {status: 'NOT_FIRED', source: `gpuFragmentHash ${g.hashMatches}/${g.hashTotal}, GEMM ok (${g.gemm.basis}), fence timeouts 0`});
  }
  return Object.assign(base, {status: 'INPUT_ABSENT', source: `GPU غير مكتمل التحقّق: gemm=${g.gemm.verdict}، hash=${g.hashMatches}/${g.hashTotal}، fenceTimeouts=${g.fenceTimeouts}`});
}

// قائمة بوّابات V8: بوّابات categoryStates كما هي بترتيبها، **مع حذف LOW_CATEGORY_COVERAGE** (لا تنطبق على الحروف من الخصائص، P5 :179)، واستبدال البوّابتين غير الموصولتين بالموصولتين.
function buildAdvisoryGates(categoryStates, facts) {
  const base = categoryStates && Array.isArray(categoryStates.gates) ? categoryStates.gates : [];
  const out = [];
  let storageDone = false;
  let gpuDone = false;
  for (const g of base) {
    if (g.name === 'LOW_CATEGORY_COVERAGE') continue;
    if (g.name === 'STORAGE_VERIFY_ERRORS') { out.push(storageVerifyGate(facts)); storageDone = true; } else if (g.name === 'GPU_HASH_MISMATCH') { out.push(gpuHashGate(facts)); gpuDone = true; } else out.push(g);
  }
  if (!storageDone) out.push(storageVerifyGate(facts));
  if (!gpuDone) out.push(gpuHashGate(facts));
  return out;
}

// ─── الحرف العامّ ──────────────────────────────────────────────────────────

/**
 * المتوسّط المرجَّح لرُتب الحروف على الفئات ذات الحرف (P5 :172-174): A=0 … D=3، بأوزان CATEGORY_WEIGHTS؛ **نصف الرتبة يُقرَّب نحو الأسوأ**؛ ثم البوّابات سقفاً (applyOverallCeilings نفسها).
 * @param {Object} categories {category: سجلّ حرف}
 * @param {Array} gates قائمة البوّابات (buildAdvisoryGates)
 * @return {Object} overall
 */
function deriveAdvisoryOverall(categories, gates) {
  let wSum = 0;
  let rSum = 0;
  const counted = [];
  for (const cat of ADVISORY_CATEGORIES) {
    const e = categories[cat];
    if (!e || e.letter === null) continue;
    const w = CATEGORY_WEIGHTS[cat];
    wSum += w;
    rSum += w * LETTER_ORDER[e.letter];
    counted.push({category: cat, letter: e.letter, weight: w, advisory: e.advisory});
  }
  const rankMean = wSum > 0 ? rSum / wSum : null;
  // «نصف الرتبة يُقرَّب نحو الأسوأ»: floor(mean + 0.5)؛ والإبسيلون يحمي التعادل الحقيقي (1.5) من ضجيج الفاصلة العائمة.
  const rank = rankMean === null ? null : Math.min(3, Math.floor(rankMean + 0.5 + 1e-9));
  const afterGates = CS.applyOverallCeilings(rank === null ? null : LETTER_BY_RANK[rank], gates);
  let lastEffective = null;
  for (const g of afterGates.gatesApplied) if (g.cappedOverall) lastEffective = g;
  const letter = afterGates.letter;
  return {
    letter,
    // BAND: المتوسّط وحده؛ GATE:<name>: آخر بوّابة أثّرت فعلاً (قاعدة V7 نفسها)؛ NO_DATA: لا فئة بحرف ولا بوّابة أنقذته.
    letterSource: letter === null ? 'NO_DATA' : (lastEffective ? `GATE:${lastEffective.name}` : 'BAND'),
    rankMean,
    bandLetter: rank === null ? null : LETTER_BY_RANK[rank],
    categoriesCounted: counted,
    // «إرشادي» ما دامت فئة داخلة فيه إرشادية (P5 :181). الحرف العامّ من البوّابة وحدها (بلا فئة) غير إرشادي.
    advisory: counted.some((c) => c.advisory),
    noDataAtAll: rankMean === null,
    governingGate: lastEffective ? {name: lastEffective.name, category: lastEffective.category, ceilingLetter: lastEffective.ceilingLetter, source: lastEffective.source} : null,
    gatesApplied: afterGates.gatesApplied,
  };
}

// ─── نقطة الدخول ────────────────────────────────────────────────────────────

/**
 * @param {Object} input
 * @param {Object} input.features ناتج computeFeatureLibrary
 * @param {Object} input.findings ناتج computeFindings (للسقف المستدام المجمَّع)
 * @param {Object} input.fv68 ناتج readFv68
 * @param {Object} input.categoryStates ناتج computeCategoryStates (الأمان والبوّابات الثابتة)
 * @param {Object} [input.stability] {[اسم الخاصّية]: {cvPct, letterStable}} من فحوص الجهاز المكرّرة؛ غيابها ⟵ الخاصّية المتّصلة لا تدخل الحرف
 * @return {Object} {lettersVersion, thresholdSetVersion, categories, overall, gates} — لا يرمي
 */
function computeAdvisoryLetters(input) {
  const i = input || {};
  const facts = extractVerificationFacts(i.fv68);
  const libOk = i.features && i.features.status === STATUS.MEASURED && i.features.features;
  const features = libOk ? i.features.features : null;
  const stability = i.stability && typeof i.stability === 'object' ? i.stability : null;

  const categories = {};
  categories.cpu = cpuLetter(features, i.findings, facts, stability);
  categories.thermal = thermalLetter(features, stability);
  categories.storage = storageLetter(features, facts, stability);
  categories.gpu = gpuLetter(facts);
  categories.memory = memoryLetter(facts);
  categories.security = securityLetter(i.categoryStates);
  // لا عيّنات صالحة (المكتبة NOT_MEASURED): فئات الخصائص تُعلن HARNESS_ERROR بدل «مُدخل غائب» عامّ؛ وحقائق التحقّق (D/A) من التذييل تبقى معتبرة كما هي.
  if (!libOk) {
    for (const cat of ['cpu', 'thermal']) {
      if (categories[cat].letter === null) {
        categories[cat].reason = REASON.HARNESS_ERROR;
        categories[cat].reasonDetail = 'features library NOT_MEASURED';
      }
    }
  }
  const gates = buildAdvisoryGates(i.categoryStates, facts);
  const overall = deriveAdvisoryOverall(categories, gates);
  return {lettersVersion: ADVISORY_LETTERS_VERSION, thresholdSetVersion: THRESHOLD_SET_VERSION, categories, overall, gates};
}

module.exports = {
  computeAdvisoryLetters, assessStability, stabilityVerdict, extractVerificationFacts, buildAdvisoryGates, deriveAdvisoryOverall,
  ADVISORY_LETTERS_VERSION, ADVISORY_CATEGORIES, NON_ADVISORY_CATEGORIES, PROPERTY, PROPERTY_KIND, PROPERTY_STATE, DISPLAY_AS, BASIS, GEMM_VERDICT,
  ADVISORY_REASON: REASON,
  _internal: {cpuLetter, thermalLetter, storageLetter, gpuLetter, memoryLetter, securityLetter, storageVerifyGate, gpuHashGate, combinedCeilingRecord},
};
