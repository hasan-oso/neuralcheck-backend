// ===================================================================
// v7ModelPayloadWhitelist.js — قائمة بيضاء عند البناء لحمولة V7 المُرسَلة
// للنموذج (أمر مستخدم 2026-09-23 +03، البند ١؛ يُعمَّم لا يُخترَع —
// نفس نمط A104: functions/src/analysis/analyzeDevice.js:61
// buildCategoryEntryForStorage، حقلاً حقلاً لا تمريرة/`spread`).
// ===================================================================
//
// السبب (نصّ المستخدم حرفياً): "الشجرة التي تسرّبت منها ثلاث مرّات شكلها
// ثابت (12 مفتاحاً للفئة، 11 للبوّابة)، والشجرة التي لم يتسرّب منها شيء
// مفاتيحها ديناميكية بالكود." — القاعدة 33 وقعت ثلاث مرّات على
// categoryStates (الحقول السبعة، ثم الأربعة، ثم حقلا gate): كل حقل
// داخلي أُضيف لغرض صحيح تسرّب لأن `stripModelPayloadExcluded*` كانت
// تُسقط بالاسم من نسخة تحمل كل شيء أصلاً — قائمة استبعاد قصيرة تحرس شجرة
// **ثابتة الشكل**. البديل الدائم هنا: تُبنى الحمولة من حقول **مُسمّاة**
// (قائمة بيضاء)، لا من الشجرة كاملة ناقصةً ما يُستبعَد.
//
// **المبدأ — قرار المستخدم 2026-10-06 (يحلّ محلّ «findings وtestResults
// لا قائمة بيضاء لهما — يمرّان كما هما» الذي كان في هذين السطرين)**، بنصّه:
//   «- لا تصل إلى النموذج قيمة لا يُبنى عليها حرف ولا عتبة معايَرة لها. يصله
//   عنها «مقيس» أو «غير مقيس» وحده.
//   - وما يُحسب ويُخزَّن لا يتغيّر: المستند، والعيّنات، وcategoryStates.»
// **سببه:** الخرق الواضح ② في NC-TM7PDN (النموذج كتب أن المعالج «لا يبقى عند
// قمّته… ما يقارب ثلثي السقف») جاء من findings.channels — الرقم 1968633 kHz
// هو findings.channels.cpu_freq_max_khz.CPU_SUSTAINED.mean (قياس المنسّق على
// مدخلات r2، منقول هنا بلا تحقّق منفصل) — قيمة لا يقرؤها حرف ولا عتبة معايَرة،
// بقيت تصل النموذج بعد أن حُجب findings.sustainedCeiling المقابل لها.
// **التنفيذ:** `findings` تُبنى بجدول سياسة مُسمّى لكل مفتاح علوي
// (MODEL_FINDINGS_POLICY في buildV7Payload.js: KEEP/STATE/TESTS/REMOVE) مع اختبار
// ثنائي الاتّجاه — فاعتراض «قائمة بيضاء هشّة» الذي كان هنا (82% من مسارات
// findings تحت channels بمفاتيح ديناميكية) زال: channels تُحذف كلّها بمفتاحها
// العلوي مرّة واحدة، لا بسرد أسماء قنواتها. و`testResults`: الاختبارات «خارج
// الحرف» المُسمّاة (MODEL_HIDDEN_TEST_IDS) تصل بحالتها وحدها (hideTestResultForModel).
// (النصّ السابق موسوم لا محذوف — القاعدة 8: «`findings` و`testResults` لا قائمة
// بيضاء لهما — يمرّان كما هما (قرار المستخدم صراحة)… 810 من 985 مسار مفتاح داخل
// `findings` (82%) تحت `findings.channels.*` وحدها (10 قنوات × 8 أطوار × ~9
// حقول إحصاء)».)
//
// **الاشتراط الإلزامي (نصّ المستخدم):** "القائمة البيضاء تعطي عدد
// البايتات نفسه الذي يعطيه الاستبعاد — وأي فرق حقل لم يُسمَّ." التنفيذ
// هنا يحافظ على **ترتيب مفاتيح المصدر** (لا ترتيب القوائم أدناه) عبر
// `pickAllowed` (تكرار `Object.keys(source)` بالترتيب، إبقاء ما هو
// مسموح فقط) — هذا يجعل الناتج **مطابقاً حرفاً بحرف (===)** لأسلوب "نسخ
// سطحي ثم حذف المُستبعَد" ما دام: المسموح ∪ المُستبعَد المُسمّى = كل
// مفتاح حقيقي يظهر فعلاً. الحارس ثنائي الاتّجاه
// (v7ModelPayloadWhitelistGuard.test.js) يتحقّق من هذا الشرط آلياً على
// بيانات حقيقية متعدّدة (b45c8cf6 عادي، Honor HARNESS_ERROR، بطارية بلا
// samples) — حقل غير مُصنَّف في أيّهما يُسقط الاختبار (القاعدة 25).
'use strict';

// أمر 2026-10-07 (البند ٤): قراءة عمر الرقعة من نصّ بوّابة PATCH_AGE بدالّة categoryStates نفسها (حساب واحد، القاعدة 24).
const {parsePatchAgeMonths, GATE_NOTE_CATEGORY_ALREADY_WORSE, GATE_NOTE_OVERALL_ALREADY_WORSE} = require('./categoryStates');

// ─── كائن gate (categoryStates.js: computeGates/applyCeilings/applyOverallCeilings) ─
// 11 حقلاً ممكناً إجمالاً (الاتّحاد عبر كل الأشكال: بوّابة مسمّاة NOT_WIRED/
// DISABLED بلا coveragePct، LOW_CATEGORY_COVERAGE بكل الحقول، على مستوى
// الفئة بـcappedThisLetter أو overall بـcappedOverall).
//
// ⚠️ **تصحيح مُقَرّ من المستخدم (2026-09-23 +03)** — ادّعاء سابق في هذه
// المهمّة أن نسخ categories.<cat>.gatesApplied "مكرَّرة حرفياً" في
// overall.gatesApplied كان **منفياً بالقياس**: نسخة الفئة تحمل
// `cappedThisLetter`، ونسخة overall تحمل `cappedOverall` — قيمتان
// مختلفتان فعلياً على نفس البوّابة أحياناً (مثال حقيقي، gpu على
// b45c8cf6: cappedThisLetter=true — الحرف سُقِّف فعلاً على مستوى
// الفئة — بينما cappedOverall=false مع note "الحرف العامّ أسوأ من
// السقف أصلاً" — البوّابة نفسها **لا أثر لها على الحرف العامّ** لأن
// بوّابة أخرى أسوأ سبقتها). حذف أحد النسختين كان سيُخفي هذا الفرق عن
// النموذج — **لا حذف لأيّ نسخة**، كلتاهما مُبقاتان بكل حقولهما (عدا
// belowThreshold/allNonMeasurement أدناه).
const GATE_ALLOWED_FIELDS = Object.freeze([
  'name', 'category', 'ceilingLetter', 'status', 'source', 'coveragePct',
  'cappedThisLetter', 'cappedOverall', 'note',
]);

// belowThreshold/allNonMeasurement — تفصيل حساب داخلي (categoryStates.js:
// computeLowCategoryCoverageGate)، أُضيفا لغرض واحد: القاعدة 24 — "مصدر
// واحد" يبني منه buildDisplayShapeV7.js نصّ letterCeilingReason البشري
// (buildCategoryLetterCeilingReason). لا يحتاجهما النموذج: source يحمل
// نفس المعنى نصّاً ("coverage=40.0% < 60.0%؛...")، وcoveragePct الرقم
// وحده. **مُراجَعان صراحةً ومُبقيان — لم يُستبعَدا**: source (هو "السبب
// الموجز" نفسه، لا نصّاً تقنياً منفصلاً عنه — قرار مستخدم صريح)،
// coveragePct (يحتاجه الحارس — حذفه يُعيد انجراف "71.5" حرفياً)، وحالة
// NOT_FIRED نفسها (قد تمنع النموذج من تعميم حجّة فئة أخرى بلا دليل).
const GATE_EXCLUDED_REASONS = Object.freeze({
  belowThreshold: 'تفصيل حساب داخلي (categoryStates.js، القاعدة 24 — مصدر واحد لبناء letterCeilingReason في buildDisplayShapeV7.js) — لا يحتاجه النموذج، source يحمل نفس المعنى نصّاً',
  allNonMeasurement: 'نفس سبب belowThreshold أعلاه',
});
const MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS = Object.freeze(Object.keys(GATE_EXCLUDED_REASONS));

// ─── مدخل فئة واحدة (categoryStates.categories.<cat>) ───────────────────
// 12 حقلاً "أساسياً" (حاضرة على كل فئة تقريباً بصرف النظر عن الفرع) +
// حقول شرطية (تظهر فقط في فروع معيّنة — المسموح لا يهتمّ بالحضور، فقط
// بالاسم؛ الغياب الطبيعي لا يحتاج قائمة منفصلة). القياس الكامل (كل
// الفروع الأربعة: عادي/بطارية/HARNESS_ERROR/بطارية-بلا-samples) في
// v7ModelPayloadWhitelistGuard.test.js.
const CATEGORY_ALLOWED_FIELDS = Object.freeze([
  // الاثنا عشر — حاضرة على كل فئة غير-بطارية دائماً (وعلى فروع HARNESS_ERROR أيضاً).
  'category', 'coverage', 'state', 'declaredCount', 'executedCount',
  'passCount', 'failCount', 'warningCount',
  'score', // قرار مستخدم 2026-09-23 +03 — راجع تعليق مُفصَّل في buildV7Payload.js
           // (المصدر التاريخي للتعليق قبل الانتقال هنا): مدخل الحرف
           // الحتمي (categoryStates.js:447-448 → letterFromScore)، لا
           // مخرَج applyV7Adjustments — لا صلة له بالقاعدة 33.
  'deterministicLetter', 'gatesApplied', 'testIds',
  // شرطية — غير-بطارية فقط، حين STATE_FAIL_FLOOR/STATE_WARNING_CEILING.
  'floorApplied',
  // شرطية — فرع HARNESS_ERROR (أي فئة) وفرع بطارية-بلا-samples.
  'reason', 'harnessErrorNote',
  // شرطية — فئة البطارية فقط (كل الفروع التي تصل computeBatteryCategory).
  'confidence', 'verdictLabel', 'tag', 'batteryIndicators', 'batteryAggregate', 'noLetterReason',
]);

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-10-01 +03 ("الحمولة لا تحمل قيم ما ليس معايَراً، بل
// حالته وحدها") — القرار ١: حارس بنيوي يمنع الحكم من قياس أُعطي للنموذج،
// بعد أن أظهرت قراءة يدوية خرقين واضحين وثمانية محتملة (العدّاد الآلي
// القديم أعطى صفراً — لا يفحص هذا بالذات). أخطرهما: "2781.39 mAh مقابل
// سعة تصميم 4400 mAh… واحمل شاحناً احتياطياً" (NC-83XL4C، تشغيل حيّ ثانٍ،
// مصدره الحقيقي المُتحقَّق منه: categoryStates.categories.battery
// .indicators.BAT-FCC.value/.designCapacityMah — batteryLayer.js:215/221/226).
//
// النصّ أدناه **نصّ تعليمة جديد بحرفه** (لم يكن موجوداً من قبل) — يحلّ
// محلّ كل حقل قيمة فعلية لكل مؤشّر من الأربعة التالية في **حمولة النموذج
// وحدها**: لا تغيير على categoryStates/الحالة المحفوظة في المستند/العيّنات
// في Storage (القيد الصريح). مصدر واحد مُصدَّر (القاعدة 24) — يستورده
// buildV7Payload.js (findings.sustainedCeiling/graphics/battery) أيضاً،
// نفس النصّ حرفياً في كل موضع.
const UNCALIBRATED_MEASUREMENT_NOTE = 'مقيس، ولا حكم عليه في هذا الإصدار';

// أمر مستخدم 2026-10-06 (المبدأ): الحالة التي تصل النموذج عن قيمة محجوبة — «مقيس» أو «غير مقيس»
// وحده. مصدر واحد (القاعدة 24) يستهلكه كل موضع حجب: القيمة المُقاسة تُكتب `measured` (الثابت
// أعلاه نفسه، لم يُقرَّر بعد إن كان الكلمة وحدها أم النصّ الحالي — يُغيَّر هنا في مكان واحد)،
// وما لم يُقَس يُكتب `notMeasured` ويبقى N/A حيث كان (القاعدة 22).
const MODEL_STATE_TEXT = Object.freeze({measured: UNCALIBRATED_MEASUREMENT_NOTE, notMeasured: 'غير مقيس'});

// أسماء مؤشّرات البطارية الأربعة — نفس المفاتيح حرفياً التي تبنيها
// computeBatteryLayer (batteryLayer.js:281-286) — مصدر واحد هنا، لا نسخة
// ثانية (القاعدة 24). كل مؤشّر منها بلا verdict مُعايَر اليوم (canGrade
// مُقفَل false حتى PLAN-03) — فكل قيمة/نسبة/وحدة فيه "حكم من قياس غير
// معايَر" بالضبط، لا استثناء لأيٍّ منها.
const UNCALIBRATED_BATTERY_INDICATOR_IDS = Object.freeze([
  'BAT-FCC', 'BAT-R-APPARENT', 'BAT-COULOMB', 'BAT-THERMAL-EFF',
]);

/**
 * يستبدل كل حقول القيمة الفعلية لمؤشّر بطارية غير معايَر بحالته وحدها —
 * `{id, status}` فقط، و`note` تُضاف **حين status==='MEASURED' وحده**
 * (أمر 2026-10-06، D3 — لا «مقيس» لمؤشّر لم يُقَس): `value`/`unit`/`designCapacityMah`/`ratioToDesign`/`gate`/الحقول الخام
 * الأخرى (vFirst10sMv/vUnderLoadMv/iUnderLoadUa/deltaTC/energyWh/qIntMah/
 * intervalCount/socAtWindowStart/socAtWindowEnd) كلّها تُسقَط من حمولة
 * النموذج — لا من `categories.battery.indicators` الأصلية المحفوظة/المعروضة
 * (هذه الدالّة تُستهلَك هنا فقط، على نسخة `buildModelCategoryEntry` المبنيّة
 * أصلاً للنموذج، لا تُستدعى من display/analyzeDevice.js).
 * @param {Object|null} batteryIndicators {indicatorId: {id, status, ...}}
 * @return {Object|null} نسخة جديدة — لا تُعدِّل المُدخل في مكانه
 */
function redactUncalibratedBatteryIndicatorsForModelPayload(batteryIndicators) {
  if (!batteryIndicators || typeof batteryIndicators !== 'object') return batteryIndicators;
  const out = {};
  for (const [id, indicator] of Object.entries(batteryIndicators)) {
    if (UNCALIBRATED_BATTERY_INDICATOR_IDS.includes(id) && indicator && typeof indicator === 'object') {
      // أمر مستخدم 2026-10-06 (D3): الحجب حين توجد قيمة وحده — «مقيس» لا
      // يُكتب لمؤشّر لم يُقَس (ABSTAINED)؛ يبقى {id, status} بلا note
      // (القاعدة 22: الغياب يبقى غائباً حتى يُعلنه قارئه).
      const entry = {id: indicator.id || id, status: indicator.status || null};
      if (indicator.status === 'MEASURED') entry.note = UNCALIBRATED_MEASUREMENT_NOTE;
      out[id] = entry;
    } else {
      out[id] = indicator; // مؤشّر مستقبلي غير مُسمّى هنا — يمرّ كما هو، لا حذف صامت (القاعدة 22)
    }
  }
  return out;
}

// الخمسة — مخرَج طبقة applyV7Adjustments (أو تهيئتها الابتدائية قبل أي
// نداء) — القاعدة 33: "مخرَج عملية لا يُغذّى مدخلاً لها". راجع تعليق رأس
// buildV7Payload.js للتفصيل الكامل (قرار 2026-09-22 +03 الأصلي).
const CATEGORY_EXCLUDED_REASONS = Object.freeze({
  finalLetter: 'مخرَج applyV7Adjustments (أو تهيئته الابتدائية) — القاعدة 33',
  adjustmentEvidence: 'نفس سبب finalLetter',
  adjustmentReason: 'نفس سبب finalLetter',
  adjustmentApplied: 'نفس سبب finalLetter',
  llmSuggestedLetter: 'نفس سبب finalLetter',
});
const MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS = Object.freeze(Object.keys(CATEGORY_EXCLUDED_REASONS));

// ─── overall (categoryStates.overall) ───────────────────────────────────
const OVERALL_ALLOWED_FIELDS = Object.freeze([
  'coverage', 'measuredCategoriesMean', 'letter', 'letterSource', 'noDataAtAll',
  'harnessError', 'harnessErrorReason', 'partialAssessment', 'partialAssessmentTag',
  'gatesApplied', 'partialBadLetterUngated',
]);

const OVERALL_EXCLUDED_REASONS = Object.freeze({
  llmOverall: 'حقل ميّت — قيمته null دائماً (لا كاتب فعلي غير التهيئة في categoryStates.js) — القرار ٦، أمر 2026-09-23 +03',
  adjustments: 'سجلّ كامل تعديلات النموذج — مخرَج applyV7Adjustments، القاعدة 33',
  disputed: 'نفس سبب adjustments',
  // S3 (أمر مستخدم 2026-10-01 +03) — حقل عرض بشري جديد (جملة عربية جاهزة
  // من harnessErrorReason الخامّ). النموذج يستلم harnessError/
  // harnessErrorReason أصلاً (مذكوران في systemPromptV7.js) ويكفيانه —
  // لا حاجة لجملة عرض جاهزة مُوجَّهة للعميل داخل حمولة النموذج.
  harnessErrorMessage: 'جملة عرض عربية للعميل (categoryStates.js:harnessErrorDisplayMessage) — ' +
      'النموذج يستلم harnessErrorReason الخامّ ويكفيه، S3 أمر مستخدم 2026-10-01 +03',
});
const MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS = Object.freeze(Object.keys(OVERALL_EXCLUDED_REASONS));

// overall.partialAssessmentTag — لا استبعاد، الثلاثة تبقى (بُنيت بالقائمة
// البيضاء لنفس الانضباط، لا لأن شيئاً يُسقَط منها).
const PARTIAL_ASSESSMENT_TAG_ALLOWED_FIELDS = Object.freeze(['label', 'coveragePct', 'text']);

// categoryStates.issues[] — لا استبعاد. evidence/evidenceUnit شرطيّان
// (ISS-* فقط — راجع categoryStates.js:buildDeterministicIssues).
const ISSUE_ALLOWED_FIELDS = Object.freeze(['id', 'category', 'severity', 'title', 'evidence', 'evidenceUnit']);

// ─── الآليّة — تكرار مفاتيح المصدر بترتيبها، إبقاء المسموح فقط ──────────
// هذا **يضمن** تطابقاً حرفياً (===) مع أسلوب "نسخ ثم حذف المُستبعَد"
// (JSON.stringify يُخرج مفاتيح الكائن بترتيب الإدراج — لا فرق بين
// "احتفظ بالمسموح من ترتيب المصدر" و"احذف المُستبعَد من نسخة من
// المصدر" ما دامت المجموعتان متكاملتين). لا يُرتَّب حسب ترتيب القوائم
// أعلاه — تلك للتوثيق/الحراسة فقط.
function pickAllowed(obj, allowedFields) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const allowed = new Set(allowedFields);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (allowed.has(k)) out[k] = obj[k];
  }
  return out;
}

// أمر مستخدم 2026-10-07 +03 (البند ٤): بوّابة PATCH_AGE في الحمولة تحمل عمر الرقعة بالأشهر رقماً في حقل خاصّ بها، بالقيمة نفسها
// التي في نصّ source (categoryStates.js: formatPatchAgeSource/parsePatchAgeMonths — حساب واحد). الحقل يُضاف **على نسخة الحمولة
// وحدها** (categoryStates المخزَّنة بلا مساس). ينطبق في نسختَي البوّابة معاً (categories.security.gatesApplied وoverall.gatesApplied)
// لأنهما تمرّان بهذه الدالّة نفسها. UNKNOWN وINPUT_ABSENT وأي بوّابة أخرى: لا حقل (القاعدة 22 — لا رقم حيث لا رقم).
const PATCH_AGE_MONTHS_FIELD = 'ageMonths';

// أمر مستخدم 2026-10-07 +03 (البند ٣، وأُقرّ النصّان 2026-10-07): كلمة «سقف» لا تصل نصّاً يراه المشتري، فلا تصل النموذج في ملاحظات
// البوّابات: «… أسوأ من السقف أصلاً — لا أثر» ← «… أدنى من حدّ هذه البوّابة أصلاً — لا أثر». **في نسخة النموذج وحدها** — الملاحظة المخزَّنة
// في categoryStates لا تتغيّر. أيّ ملاحظة غير مُسمّاة هنا تمرّ كما هي (لا حذف صامت).
const MODEL_GATE_NOTE_TEXT = Object.freeze({
  [GATE_NOTE_CATEGORY_ALREADY_WORSE]: 'الحرف الأساسي أدنى من حدّ هذه البوّابة أصلاً — لا أثر',
  [GATE_NOTE_OVERALL_ALREADY_WORSE]: 'الحرف العامّ أدنى من حدّ هذه البوّابة أصلاً — لا أثر',
});

function buildModelGateEntry(gate) {
  const entry = pickAllowed(gate, GATE_ALLOWED_FIELDS);
  const ageMonths = parsePatchAgeMonths(gate);
  if (ageMonths !== null && entry && typeof entry === 'object') entry[PATCH_AGE_MONTHS_FIELD] = ageMonths;
  if (entry && typeof entry === 'object' && typeof entry.note === 'string' && Object.prototype.hasOwnProperty.call(MODEL_GATE_NOTE_TEXT, entry.note)) {
    entry.note = MODEL_GATE_NOTE_TEXT[entry.note];
  }
  return entry;
}

function buildModelGatesArray(gatesApplied) {
  return Array.isArray(gatesApplied) ? gatesApplied.map(buildModelGateEntry) : gatesApplied;
}

function buildModelCategoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const picked = pickAllowed(entry, CATEGORY_ALLOWED_FIELDS);
  // gatesApplied حقل مُتداخِل يحتاج تنقيته هو نفسه — يبقى في مكانه
  // (ترتيب المفتاح لا يتغيّر بإعادة الإسناد، فقط قيمته).
  if ('gatesApplied' in picked) picked.gatesApplied = buildModelGatesArray(picked.gatesApplied);
  // أمر مستخدم 2026-10-01 +03 — القرار ١/٢: مؤشّرات البطارية الأربعة غير
  // المعايَرة تصل بحالتها وحدها، لا بقيمها (راجع تعليق الدالّة).
  if ('batteryIndicators' in picked) {
    picked.batteryIndicators = redactUncalibratedBatteryIndicatorsForModelPayload(picked.batteryIndicators);
  }
  return picked;
}

/**
 * يبني `categoryStates.categories` المُرسَل للنموذج — قائمة بيضاء حقلاً
 * حقلاً (لا تمريرة/نسخ-ثم-حذف). لا يُعدِّل `categories` الأصلية.
 * @param {Object|null} categories `categoryStates.categories` الأصلية
 * @return {Object|null}
 */
function buildModelCategories(categories) {
  if (!categories || typeof categories !== 'object') return categories;
  const out = {};
  for (const cat of Object.keys(categories)) out[cat] = buildModelCategoryEntry(categories[cat]);
  return out;
}

/**
 * يبني `categoryStates.overall` المُرسَل للنموذج — قائمة بيضاء حقلاً
 * حقلاً. لا يُعدِّل `overall` الأصلية.
 * @param {Object|null} overall `categoryStates.overall` الأصلية
 * @return {Object|null}
 */
function buildModelOverall(overall) {
  if (!overall || typeof overall !== 'object') return overall;
  const picked = pickAllowed(overall, OVERALL_ALLOWED_FIELDS);
  if ('gatesApplied' in picked) picked.gatesApplied = buildModelGatesArray(picked.gatesApplied);
  if ('partialAssessmentTag' in picked && picked.partialAssessmentTag && typeof picked.partialAssessmentTag === 'object') {
    picked.partialAssessmentTag = pickAllowed(picked.partialAssessmentTag, PARTIAL_ASSESSMENT_TAG_ALLOWED_FIELDS);
  }
  return picked;
}

/**
 * يبني `categoryStates.issues[]` المُرسَل للنموذج — قائمة بيضاء لكل
 * عنصر. لا استبعاد فعلي اليوم؛ مبنيّة حقلاً حقلاً لنفس الانضباط (دفاع في
 * العمق — لو أضاف كود لاحق حقلاً غير مُصرَّح به هنا، الحارس يُسقطه لا
 * يُسرِّبه صامتاً).
 * @param {Array|null} issues `categoryStates.issues` الأصلية
 * @return {Array|null}
 */
function buildModelIssues(issues) {
  return Array.isArray(issues) ? issues.map((it) => pickAllowed(it, ISSUE_ALLOWED_FIELDS)) : issues;
}

module.exports = {
  pickAllowed,
  GATE_ALLOWED_FIELDS, MODEL_PAYLOAD_EXCLUDED_GATE_FIELDS, GATE_EXCLUDED_REASONS,
  CATEGORY_ALLOWED_FIELDS, MODEL_PAYLOAD_EXCLUDED_CATEGORY_FIELDS, CATEGORY_EXCLUDED_REASONS,
  OVERALL_ALLOWED_FIELDS, MODEL_PAYLOAD_EXCLUDED_OVERALL_FIELDS, OVERALL_EXCLUDED_REASONS,
  PARTIAL_ASSESSMENT_TAG_ALLOWED_FIELDS, ISSUE_ALLOWED_FIELDS,
  PATCH_AGE_MONTHS_FIELD, MODEL_GATE_NOTE_TEXT,
  buildModelGateEntry, buildModelGatesArray, buildModelCategoryEntry, buildModelCategories,
  buildModelOverall, buildModelIssues,
  // أمر مستخدم 2026-10-01 +03 — مصدر واحد مُصدَّر (القاعدة 24)، يستورده
  // buildV7Payload.js أيضاً لنفس النصّ حرفياً على findings.sustainedCeiling/
  // graphics/battery وrawValue الاختبارات غير المعايَرة.
  UNCALIBRATED_MEASUREMENT_NOTE, MODEL_STATE_TEXT, UNCALIBRATED_BATTERY_INDICATOR_IDS,
  redactUncalibratedBatteryIndicatorsForModelPayload,
};
