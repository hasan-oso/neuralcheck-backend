// ===================================================
// findings.js — الحساب الحتمي من العيّنات (P1.1، PLAN-01-ROADMAP §المرحلة ١)
// ===================================================
// يُستدعى من runAnalysisInternal قبل callAI. يقرأ samples/variables/footer/
// functionalResults من fingerprint (بنفس منطق استخراج callAI.js:144-156:
// timeSeries أولاً، ثم مستوى الجذر للتوافق) ويُخرج كائن Findings حتمياً —
// بلا استدعاء نموذج، بلا شبكة، بلا حالة مشتركة.
//
// المرجع التنفيذي لكل معادلة رقمية هنا: REFERENCE-timeseries_stats.py
// (نسخة موقّعة من rebuld/scripts/timeseries_stats.py) في
// functions/test/fixtures/golden/ — الدوال بأسمائها (changes, pct/percentile,
// window_stats, coulomb_mah). راجع golden/README.md للفارقين الموثَّقين بين
// هذا الملف والمرجع (استثناء أول/آخر ثانيتين في الرسوميات، وفصل نطاقَي
// vsync-lock عن الحساب المشذَّب — كلاهما مطلوب في PLAN-01 P1.1 نصّاً ولا
// يوجد في المرجع الأصلي).
//
// ─── ما تغيّر عن الصيغة القديمة (محفوظة في PLAN-01-ROADMAP.md §المرحلة ١
//      تحت "ما كان مكتوباً هنا") ────────────────────────────────────────
// صيغة البطارية «levelDrop × design / تكامل التيار» أُبطلت — تفشل على جهاز
// لم يتغيّر (النسبة 1.22 عند 84%→80% لكن 1.53/1.57 عند 48%→38% لشحنة
// متساوية تقريباً). البديل هنا (§٤-أ من الخطّة) يقارن كولوم بكولوم فقط
// (Q_int مقابل Q_cc من fv68)، ولا يُصدر حرف بطارية على أي فحص fv≤67 —
// يُصدر معلومة موسومة بمستوى الشحن بدل ذلك.
//
// ─── ما هذا الملف لا يفعله (عمداً، حدود P1.1) ───────────────────────────
//   • لا يبني TestResult ولا يُصدر PASS/FAIL/WARNING — ذلك P1.2.
//   • لا يحسب حالة الفئات ولا الدرجة العامة — ذلك P1.3.
//   • لا يُستهلَك من callAI ولا يدخل البرومبت — ذلك P1.4. القيد صريح في
//     أمر P1.1: لا تعديل على callAI.js ولا على البرومبت.
//   • لا يحسب CV **قرار 7** حيّاً لأي اختبار (C‑04/S‑04/S‑05/C‑03) — ذلك
//     المعيار (CV > 15% على 5 تكرارات لنفس الاختبار الوظيفي عبر جلسة
//     كاملة) بروتوكول معايرة خارج نطاق فحص واحد أصلاً (انظر تعليق
//     channelStats للتفصيل)؛ هنا فقط يُلصَق الوسم الساكن بالقيمة كما وردت
//     في functionalResults، بلا حكم إحصائي جديد على تلك القيمة تحديداً.
//     **بالمقابل**: cvPct (داخل channels.*.*، الفجوة 5) CV حيّ فعلاً،
//     مُحسَب من samples — لكنه لقناة زمنية واحدة عبر مرحلة واحدة، بُعد
//     مختلف تماماً عن بُعد "التكرار عبر الجلسة" الذي يخصّ قرار 7.
// ===================================================

// ─── ثوابت مشتركة ─────────────────────────────────────────────────────

const N = require("./fv68Names");
const {
  readColumnsAndFailures, columnIndex, failedReads, parseState, EXCLUSION,
} = require("./fv68Reader");

const PHASE_NAMES = {
  0: "INIT", 1: "STORAGE", 2: "MEMORY", 3: "CPU_SUSTAINED",
  4: "GPU_SUSTAINED", 5: "COMBINED", 6: "BURST", 7: "COOLDOWN",
};

// P1.2 (PLAN-01 §تعديل 2026-09-20): "بوّابات المشتقّات: nSamples ≥ 40 و
// sourceCadenceUpdates ≥ 5 من P1.1" — البوّابة مصدرها نصّ P1.2 حرفياً،
// وتُطبَّق هنا في كل مكان يعتمد على قناة بطيئة الكادنس (حرارة، جهد،
// رسوميات) كي لا يُعرض رقم من كادنس شبه ثابت كأنه قياس موثوق.
const EVIDENCE_MIN_SAMPLES = 40;
const EVIDENCE_MIN_CADENCE_UPDATES = 5;

// أسماء الأعمدة الأساسية v[0..10] لم تعد جدولاً ثابتاً هنا: مصدرها الوحيد fv68Names.BASE_CHANNEL_ORDER (القاعدة 24). وتُقرأ الأعمدة
// **بأسمائها من variables[]** (الأمر البند ٢): الفهرس = index المعلن أو موضع العنصر. ولا يسدّ الترتيبُ الثابت اسماً ناقصاً من قائمة
// وصلت (القاعدة 22) — يُستعمَل وحده حين لا تصل variables[] أصلاً في ختم ≤ 67 (مسار الملفّات القديمة بلا قائمة) ويُعلَن مصدره
// (resolveBaseColumns.source). قبل هذا التغيير كان الجدول يُكمل أيّ فهرس ناقص صامتاً، والحمولة بلا index فكان يعمل وحده.

// قرار 7 (محسوم، PLAN-01 §القرارات العشرة): معيار UNSTABLE مبدئي غير
// مُعايَر — يُذكر بجوار كل قيمة كي لا يُقرأ كعتبة مُثبَتة.
const UNSTABLE_TEST_IDS = Object.freeze(["C-04", "S-04", "S-05", "C-03"]);
const ADVISORY_TEST_IDS = Object.freeze(["S-06"]);
const UNSTABLE_CV_THRESHOLD_PCT = 15;
const UNSTABLE_REFERENCE_CV_PCT = 5.7; // استدلال TFLite المستدام (§٤-ب)
const UNSTABLE_CRITERION_NOTE =
    `CV > ${UNSTABLE_CV_THRESHOLD_PCT}% على 5 تكرارات في جلسة واحدة ` +
    "(مبدئي — يحتاج معايرة)";
const UNSTABLE_REFERENCE_NOTE =
    `استدلال TFLite المستدام CV = ${UNSTABLE_REFERENCE_CV_PCT}% ` +
    "(المرجع لما «مستقرّ»)";

// حقول التحقّق الخمسة الغائبة عند fv67 (A76 — نمط `!== false` يقرأ
// الغياب نجاحاً). المصدر: functions/src/signatures/computeScanSignature.js
// :46-49 يحمل هذا النمط بالضبط على هذه الأسماء الخمسة، وتحقّقتُ عبر
// functions/test/fixtures/golden/*.ts.json → footer.verificationResults
// أن الخمسة غائبة فعلاً من المفاتيح (26 مفتاحاً في كل الفِخاخ الأربعة —
// راجع تقرير المهمّة لقائمة المفاتيح الكاملة).
const ABSENT_VERIFICATION_FIELDS_A76 = Object.freeze([
  N.VERIFICATION.CPU_FMA_ERRORS_LEGACY, N.VERIFICATION.CPU_PRIME_SIEVE_CORRECT_LEGACY,
  N.VERIFICATION.MEMORY_MARCH_PASSED_LEGACY, N.VERIFICATION.MEMORY_WALKING_ONES_PASSED_LEGACY,
  N.VERIFICATION.MEMORY_RANDOM_VERIFY_ERRORS,
]);

// الحقول التي فحصها الرسمي دلالتها الحالية "صفر بنية غير مأهولة" لا
// قياس (G7 — A44 وأخواتها).
const DATA_QUALITY_ZERO_COVERAGE_FIELDS =
    Object.freeze(["cpuTempCoveragePct", "gpuTempCoveragePct", "skinTempCoveragePct"]);

const RHO_NOTE =
    "ρ يعتمد على مستوى الشحن (1.22 عند 84%، 1.53–1.57 عند 48–38% على " +
    "الجهاز نفسه) ولا يُحكم به";
const VOLTAGE_STABILITY_NOTE =
    "انحراف الجهد يُعرض مع مستوى الشحن الذي قيس عنده ولا يُقارَن بعتبة";

// عتبة كشف vsync-lock على الرسوميات: افتراض هذا الملف (غير منصوص عليه
// رقمياً في الخطّة) — إن تجاوز مجموع كسرَي 60/90 نطاقاً نصف العيّنات
// غير الصفرية في المرحلتين 4+5 (غير مشذَّبة)، فالكادنس مقفل على vsync
// ولا يُعرض المقياس.
//
// **مبدئية — تحتاج معايرة.** القيمتان المرصودتان فعلياً (تحقّق عبر
// functions/test/fixtures/golden/EXPECTED-timeseries_stats.json):
//   Honor (e4b65a2f): fps_in_60_band_fraction=0.625 (٦٢٪ عند 60) +
//                     fps_in_90_band_fraction=0.316 (٣٢٪ عند 90) = 0.941
//   S10   (8909e850): fps_in_60_band_fraction=0 + fps_in_90_band_fraction=0
//                     (حرّ من القفل تماماً)
// الرقمان بعيدان جداً عن أي حدّ معقول، فاختيار 0.5 لا يغيّر التصنيف على
// الفحصين المعروفين — لكنه تخمين لعتبة وسط لم يُقَس على أي فحص بينهما.
// **افتراض بارز يُذكر في تقرير المهمّة.** لا يدخل حرفاً في المنطق أدناه؛
// تصنيف عرض فقط (انظر thresholdSet تحته — بذرة P1.3/PLAN-03).
const VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD = 0.5;
const VSYNC_LOCK_THRESHOLD_LABEL = "مبدئية — تحتاج معايرة";
const VSYNC_LOCK_THRESHOLD_SOURCE =
    "Honor 62% عند 60 + 32% عند 90 (مجموع 0.941) مقابل S10 حرّ (0.0) — " +
    "functions/test/fixtures/golden/EXPECTED-timeseries_stats.json " +
    "(honor.fps_in_60_band_fraction=0.625, honor.fps_in_90_band_fraction=0.316, " +
    "s10.fps_in_60_band_fraction=0, s10.fps_in_90_band_fraction=0)";

// عتبة بوّابة LOW_CATEGORY_COVERAGE (categoryStates.js، أمر المهمّة
// 2026-09-22 +03، البند ١) — "العتبة مبدئية موسومة «تحتاج معايرة»، ولا
// تُكتب في البرومبت... تُصدَّر من thresholdSet".
//
// **مبدئية — تحتاج معايرة**، بنفس تحفّظ VSYNC_LOCK أعلاه بالضبط. القيمة
// **افتراض هذه المهمّة، غير منصوصة رقمياً في أي مصدر متاح لي** — أُعيد
// استعمال رقم OVERALL_COVERAGE_GATE (categoryStates.js، 0.6) عمداً بدل
// اختراع رقم ثانٍ مختلف بلا سبب (نفس مفهوم "تغطية غير كافية" على مستويين
// مختلفين: عامّ هناك، فئة واحدة هنا) — **هذا اختيار مُوثَّق لا رقم مُثبَت
// بقياس مستقلّ**، مذكور بارزاً في تقرير المهمّة تحت "افتراضات" (القاعدة 13).
//
// تحقَّق حسابياً على الفحصين الحقيقيَّين المتاحين (b45c8cf6/34dff2b8،
// كلاهما نفس القيم): gpu coverage=0.4 (2/5)، gps coverage=0.333 (1/3) —
// كلاهما دون 0.6 فتُسقَف؛ battery/thermal/camera/audio/input UNMEASURED
// أصلاً (لا حرف بلا هذه البوّابة أساساً، البوّابة لا تُطلَق عليها — راجع
// categoryStates.js لشرط "executed.length > 0"). القيمة **لا تُغيِّر**
// تصنيف أيّ من الفحصين المعروفين عن نتيجة الشرط الثاني (كل الفئات
// المُنفَّذة على كلا الفحصين اليوم من صنف STATE حصراً عدا cpu — راجع
// تقرير المهمّة) — نفس منطق اختيار 0.5 لـVSYNC أعلاه: بعيدة عن أي حالة
// حديّة معروفة، لا تخمين على حدّ فاصل حسّاس.
const LOW_CATEGORY_COVERAGE_THRESHOLD = 0.6;
const LOW_CATEGORY_COVERAGE_THRESHOLD_LABEL = "مبدئية — تحتاج معايرة";
const LOW_CATEGORY_COVERAGE_THRESHOLD_SOURCE =
    "افتراض هذه المهمّة (2026-09-22 +03) — يطابق رقمياً OVERALL_COVERAGE_GATE " +
    "(categoryStates.js) عمداً، لا قياساً مستقلّاً. تحقَّق على gpu=0.4 وgps=0.333 " +
    "(b45c8cf6.ts.json/34dff2b8.ts.json عبر functionalResults-by-scanid.json) — " +
    "كلاهما دون العتبة بهامش واضح، لا حدّ فاصل حسّاس.";

// بذرة thresholdSet — لم يوجد هذا الشكل في المستودع قبل الآن (تحقّقتُ:
// لا مطابقة لـ"thresholdSet" في functions/ كلّها). هذا أصغر شكل يحمل
// (القيمة، مصدرها، وسمها) لعتبة واحدة فقط — لا يبني P1.3/PLAN-03، وهو
// بذرة يُبنى عليها لاحقاً لا واجهة مستقرّة.
const thresholdSet = Object.freeze({
  vsyncLockCombinedFraction: Object.freeze({
    value: VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD,
    label: VSYNC_LOCK_THRESHOLD_LABEL,
    source: VSYNC_LOCK_THRESHOLD_SOURCE,
  }),
  lowCategoryCoverageFraction: Object.freeze({
    value: LOW_CATEGORY_COVERAGE_THRESHOLD,
    label: LOW_CATEGORY_COVERAGE_THRESHOLD_LABEL,
    source: LOW_CATEGORY_COVERAGE_THRESHOLD_SOURCE,
  }),
});

// كائن NOT_MEASURED/HARNESS_ERROR ثابت — اختبار البتر (A76) يشترط ألا
// يُقرأ غياب samples كصفر ولا null، بل بهذا الوسم صراحةً في كل مشتقّ.
function harnessError() {
  return Object.freeze({status: "NOT_MEASURED", reason: "HARNESS_ERROR"});
}

// ─── إحصاءات أساسية (مطابقة لأسماء REFERENCE-timeseries_stats.py) ──────

function num(v) {
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return (n % 2 === 1) ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// الانحراف المعياري للمجتمع (population stdev) — مطابق لـ
// Python statistics.pstdev المستعملة في REFERENCE-timeseries_stats.py:pstd.
function pstdev(xs) {
  if (xs.length <= 1) return 0;
  const m = mean(xs);
  const variance = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(variance);
}

// مئوي بالاستيفاء الخطّي — مطابق حرفياً لدالة `pct` في المرجع.
function percentile(xs, q) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const k = (s.length - 1) * q;
  const f = Math.floor(k);
  const c = Math.ceil(k);
  return (f === c) ? s[f] : s[f] + (s[c] - s[f]) * (k - f);
}

// عدد المرّات التي تغيّرت فيها القيمة عن سابقتها = كادنس تحديث المصدر
// الفعلي — مطابق حرفياً لدالة `changes` في المرجع.
function changes(seq) {
  let c = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) c++;
  return c;
}

function passesEvidenceGate(nSamples, sourceCadenceUpdates) {
  return nSamples >= EVIDENCE_MIN_SAMPLES &&
      sourceCadenceUpdates >= EVIDENCE_MIN_CADENCE_UPDATES;
}

// شبه المنحرف على الشحنة — مطابق حرفياً لدالة `coulomb_mah` في المرجع.
// cur بوحدة µA (قد تحمل إشارة)، t بوحدة ms. النتيجة mAh.
function coulombMah(cur, t, iStart, iEnd) {
  let acc = 0;
  for (let i = iStart; i < iEnd; i++) {
    acc += (Math.abs(cur[i]) + Math.abs(cur[i + 1])) / 2 * (t[i + 1] - t[i]) / 1000;
  }
  return acc / 3600 / 1000;
}

// ─── القنوات لكل (قناة، مرحلة) — البند ١ من P1.1 ───────────────────────

// الأعمدة الأساسية بأسمائها → فهارسها. يرمي إن لم يُحَلّ اسم أساسي (computeFindings تلتقط الرمي وتُخرج HARNESS_ERROR المعلن) —
// فلا يُقرأ عمود بفهرس مخمَّن. المصدر: variables[] (DECLARED_VARIABLES)، أو الترتيب الثابت حين لا قائمة وختم ≤ 67 (FALLBACK_TABLE_NO_VARIABLES).
function resolveBaseColumns(layout, fieldsVersion) {
  const legacy = fieldsVersion === null || fieldsVersion < N.FIELDS_VERSION_68;
  const useTable = layout.columnCount === 0 && legacy;
  const byName = {};
  const missing = [];
  N.BASE_CHANNEL_ORDER.forEach((name, i) => {
    if (useTable) {
      byName[name] = i;
      return;
    }
    const idx = columnIndex(layout, name);
    if (idx === null) missing.push(name);
    else byName[name] = idx;
  });
  if (missing.length > 0) {
    throw new Error(`channel layout: base channels not resolvable by name from variables[]: ${missing.join(",")} ` +
        `(columns=${layout.columnCount}, fieldsVersion=${fieldsVersion})`);
  }
  return {byName, source: useTable ? "FALLBACK_TABLE_NO_VARIABLES" : "DECLARED_VARIABLES"};
}

// أسماء الأعمدة حسب الفهرس للإحصاء لكل (قناة، مرحلة): كل عمود مسمّى ما عدا الزمن (0) — كالسابق (v.index > 0 وله اسم).
function channelNamesByIndex(layout, baseSource) {
  const out = {};
  if (baseSource === "FALLBACK_TABLE_NO_VARIABLES") {
    N.BASE_CHANNEL_ORDER.forEach((name, i) => {
      if (i > 0) out[i] = name;
    });
    return out;
  }
  for (const c of layout.columns) {
    if (c.name !== null && c.index > 0) out[c.index] = c.name;
  }
  return out;
}

// S-27: قيمة كل عيّنة فاشلة في عمود قناة هي «آخر قيمة صالحة» (رقم صالح الشكل وكاذب القياس) — تُستثنى بجعلها null في نسخة
// العمود التي تقرؤها المشتقّات؛ والعمود الخام لا يُمسّ. القيمة غير الرقمية (عيّنة أقصر) تُقرأ null كذلك لا NaN.
function maskFailedReads(col, failedIndices) {
  return col.map((x, i) => ((failedIndices.has(i) || typeof x !== "number" || !isFinite(x)) ? null : x));
}

// هل استثناء الفشل لقناة غير تامّ فلا تُحسب منها مشتقّات تُقرأ حكماً؟ (مبتورة، أو بلا count، أو غير متتبَّعة)
function ccExclusionBlocks(exclusion) {
  return exclusion === EXCLUSION.TRUNCATED || exclusion === EXCLUSION.COUNT_ABSENT || exclusion === EXCLUSION.UNTRACKED;
}

// الفجوة 5: CV حيّ مُسجَّل في Findings — لكن **ليس** CV قرار 7. قرار 7
// (PLAN-01 §القرارات العشرة) يُعرَّف على 5 تكرارات لنفس الاختبار الوظيفي
// (C-04/S-04/S-05/C-03) عبر جلسة كاملة — ذلك غير قابل للحساب هنا إطلاقاً:
// فحص واحد ينتج قيمة functionalResults واحدة لكل testId (تحقّقتُ عبر
// functions/test/fixtures/golden/functionalResults-by-scanid.json — عنصر
// C-04 واحد لا خمسة لكل سكان)، فلا بُعد "تكرار" داخل فحص واحد لحساب CV
// قرار 7 عليه. يحتاج بروتوكولاً مختلفاً: نفس الاختبار الوظيفي مُكرَّراً
// خمس مرّات ضمن جلسة واحدة (شبيه بنمط consistencyTests/
// runConsistencyTest.js:421 القائم أصلاً لغرض آخر) مع رصد rawValue لكل
// تكرار — لا يوجد اليوم.
//
// ما يُحسب هنا مختلف تماماً ومُسمّى باسم مميَّز عمداً: cvPct هو معامل
// التغيّر (pstdev/|mean| × 100) **لقناة واحدة عبر عيّناتها ضمن مرحلة واحدة
// من نفس الفحص** — بُعد تباين حقيقي وموجود (زمن لا تكرار)، حيّ من samples،
// لكن غير مُستهلَك بعد (لا بوّابة ولا وسم يعتمد عليه اليوم؛ سُجِّل تلبيةً
// لمتطلّب "لا تباين ساكن" فقط). لا يُخلَط بـUNSTABLE_CV_THRESHOLD_PCT أعلاه
// (ذاك نصّي في UNSTABLE_CRITERION_NOTE، لا يُحسَب في هذا الملف على الإطلاق).
function channelStats(values) {
  if (!values.length) return null;
  const m = mean(values);
  const sd = pstdev(values);
  return {
    n: values.length,
    mean: m,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    p10: percentile(values, 0.10),
    p90: percentile(values, 0.90),
    sourceCadenceUpdates: changes(values),
    // انظر التعليق أعلاه — CV داخل الفحص الواحد لهذه القناة/المرحلة، ليس
    // CV قرار 7. null إن m=0 (تفادي قسمة على صفر) أو n<2 (pstdev=0 أصلاً
    // فcvPct=0 لا null في تلك الحالة، ما دام m≠0).
    cvPct: m !== 0 ? (sd / Math.abs(m)) * 100 : null,
  };
}

function buildChannels(n, ph, colByIndex, channelNamesByIndex, excludedIndicesFor) {
  const channels = {};
  for (const idxStr of Object.keys(channelNamesByIndex)) {
    const idx = Number(idxStr);
    const name = channelNamesByIndex[idx];
    const col = colByIndex(idx);
    // S-27: عيّنات القناة الفاشلة (channelReadFailures) لا تدخل إحصاءها.
    const excluded = excludedIndicesFor(name);
    const byPhase = {};
    for (let p = 0; p <= 7; p++) {
      const values = [];
      for (let i = 0; i < n; i++) if (ph[i] === p && !excluded.has(i)) values.push(col[i]);
      byPhase[PHASE_NAMES[p]] = channelStats(values);
    }
    channels[name] = byPhase;
  }
  return channels;
}

// perChannelUpdateCount — كادنس الفحص كلّه لقنوات v[1..4] تحديداً (بند ١:
// "يُحفَظ perChannelUpdateCount للقنوات v[1..4]").
function buildPerChannelUpdateCount(colByName) {
  const out = {};
  for (const name of [N.BASE_CHANNELS.BATTERY_TEMP_C, N.BASE_CHANNELS.BATTERY_VOLTAGE_MV,
    N.BASE_CHANNELS.BATTERY_CURRENT_UA, N.BASE_CHANNELS.BATTERY_LEVEL_PCT]) {
    out[name] = changes(colByName(name));
  }
  return out;
}

// ─── السقف المستدام والتعافي — البند ٢ (G3) ────────────────────────────

// نافذة السقف المستدام: 5 ث (P1.1 البند ٢)، مصدر واحد مُصدَّر (القاعدة 24) — يستورده moments.js (L-1) بدل نسخة حرفية ثانية.
const SUSTAINED_WINDOW_MS = 5000;

function windowStats(indices, t, freq, peak, winMs) {
  winMs = winMs || SUSTAINED_WINDOW_MS;
  if (!indices.length || !peak) return null;
  const t0 = t[indices[0]];
  const buckets = new Map();
  for (const i of indices) {
    const key = Math.floor((t[i] - t0) / winMs);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(freq[i]);
  }
  const maxes = [...buckets.values()].map((arr) => Math.max(...arr));
  return {
    windows: maxes.length,
    meanWindowMaxRatio: mean(maxes) / peak,
    minWindowMaxRatio: Math.min(...maxes) / peak,
    medianWindowMaxRatio: median(maxes) / peak,
  };
}

function computeSustainedCeiling(n, t, ph, freq, footer) {
  const idxOf = (ps) => {
    const out = [];
    for (let i = 0; i < n; i++) if (ps.has(ph[i])) out.push(i);
    return out;
  };
  // الذروة من footer.stressEffectiveness.peakBigFreqKhzAnywhere كما نصّت
  // P1.1 حرفياً ("÷ peakBigFreqKhzAnywhere")؛ سقوط إلى أقصى العيّنات إن
  // غاب الحقل. على الفحصين الأربعة المتاحين القيمتان متطابقتان (تحقَّق
  // من REFERENCE على s10=2730000/2730000 وhonor=2304000/2304000).
  const peakFooter = num(footer && footer.stressEffectiveness &&
      footer.stressEffectiveness.peakBigFreqKhzAnywhere);
  const peak = peakFooter !== null ? peakFooter : Math.max(...freq);

  const idx3 = idxOf(new Set([3]));
  const idx5 = idxOf(new Set([5]));
  const idx35 = idxOf(new Set([3, 5]));
  const idx7 = idxOf(new Set([7]));

  const phase3 = windowStats(idx3, t, freq, peak);
  const phase5 = windowStats(idx5, t, freq, peak);
  const combined = windowStats(idx35, t, freq, peak);
  const recoveryPhase7Ratio = idx7.length ?
      Math.max(...idx7.map((i) => freq[i])) / peak : null;

  const gate = passesEvidenceGate(idx35.length, changes(idx35.map((i) => freq[i])));

  return {
    status: gate ? "MEASURED" : "NOT_MEASURED",
    notMeasuredReason: gate ? null : "INSUFFICIENT_SAMPLES",
    peakFreqKhz: peak,
    peakFreqSource: peakFooter !== null ?
        "footer.stressEffectiveness.peakBigFreqKhzAnywhere" : "samples_max",
    phase3, phase5, combined, recoveryPhase7Ratio,
  };
}

// ─── الرسوميات — البند ٣ (G2). ممنوع (max−min)/max في كل هذا الملف. ────

function computeGraphics(n, t, ph, fps) {
  const rawPhaseIndices = (p) => {
    const idx = [];
    for (let i = 0; i < n; i++) if (ph[i] === p) idx.push(i);
    return idx;
  };
  // استثناء أول وآخر ثانيتين من كل مرحلة (نصّ P1.1) — يخصّ المقياس
  // (وسيط 5 ÷ وسيط 4) وحده. كاشف vsync-lock أدناه يستعمل النافذة الكاملة
  // عمداً: تسرّب الحدود ظاهرة توقيت (G2) لا خاصّية القفل نفسها، وتشذيبها
  // هنا كان سيغيّر كسور 60/90% المرصودة في الخطّة (0.625/0.316 على
  // Honor) عن قيمتها الموثَّقة بلا داعٍ.
  const trimmedNonzero = (p) => {
    const idx = rawPhaseIndices(p);
    if (!idx.length) return [];
    const t0 = t[idx[0]];
    const t1 = t[idx[idx.length - 1]];
    return idx.filter((i) => t[i] >= t0 + 2000 && t[i] <= t1 - 2000 && fps[i] > 0);
  };

  const idx4Trim = trimmedNonzero(4);
  const idx5Trim = trimmedNonzero(5);
  const idx45Raw = [...rawPhaseIndices(4), ...rawPhaseIndices(5)].filter((i) => fps[i] > 0);

  const n45 = idx45Raw.length;
  const fracInBand = (lo, hi) => n45 ?
      idx45Raw.filter((i) => fps[i] >= lo && fps[i] <= hi).length / n45 : 0;
  const frac60 = fracInBand(58, 62);
  const frac90 = fracInBand(85, 95);
  const frac120 = fracInBand(115, 125);

  const vsyncLocked = (frac60 + frac90) > VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD;
  const n4 = idx4Trim.length;
  const n5 = idx5Trim.length;

  let status;
  let notMeasuredReason = null;
  let ratioPhase5OverPhase4 = null;
  let phase4 = null;
  let phase5 = null;

  if (vsyncLocked) {
    status = "NOT_MEASURED";
    notMeasuredReason = "HARNESS_VSYNC_LOCKED";
  } else if (n4 < EVIDENCE_MIN_SAMPLES || n5 < EVIDENCE_MIN_SAMPLES) {
    status = "NOT_MEASURED";
    notMeasuredReason = "INSUFFICIENT_SAMPLES";
  } else {
    const m4 = median(idx4Trim.map((i) => fps[i]));
    const m5 = median(idx5Trim.map((i) => fps[i]));
    phase4 = {n: n4, median: m4};
    phase5 = {n: n5, median: m5};
    ratioPhase5OverPhase4 = m5 / m4;
    status = "MEASURED";
  }

  // اتّجاه داخلي في المرحلة 4 نفسها (وسيط آخر ثلث ÷ أوله) — معلوماتي، لا
  // بوّابة له غير امتلاء كل ثلث. **بلا مرجع** — غير مُطابَق ذهبياً (لا رقم
  // مرجعي منفصل له في PLAN-01 ولا في أي تقرير مهمّة سابق). الفجوة 4
  // (تُدوَّن ولا تُغلَق حتى يظهر رقم مرجعي حقيقي لمقارنتها به).
  let phase4DriftRatio = null;
  if (n4 >= 3) {
    const chunk = Math.floor(n4 / 3);
    if (chunk > 0) {
      const firstThird = idx4Trim.slice(0, chunk).map((i) => fps[i]);
      const lastThird = idx4Trim.slice(-chunk).map((i) => fps[i]);
      const mFirst = median(firstThird);
      const mLast = median(lastThird);
      phase4DriftRatio = mFirst ? mLast / mFirst : null;
    }
  }

  return {
    status, notMeasuredReason,
    phase4, phase5, phase4DriftRatio,
    ratioPhase5OverPhase4,
    vsyncLockFraction60: frac60,
    vsyncLockFraction90: frac90,
    vsyncLockFraction120: frac120,
    vsyncLockSampleCount: n45,
  };
}

// ─── البطارية — §٤-أ حرفياً ─────────────────────────────────────────────

// CC_DERIVED: العدّاد مشتقّ من النسبة لا العكس — شرطان بديلان (§٤-أ).
//
// S-27: ccSeq قد يحمل null في مواضع العيّنات الفاشلة — تُستثنى من كل مقارنة هنا (القيمتان المتتاليتان الصالحتان تُقارَنان
// ببعضهما). بلا null يطابق السلوك السابق حرفاً، وكلّه null يُعيد false (لا سلسلة تُحكم عليها).
function detectCcDerived(ccSeq, lvlSeq) {
  if (!ccSeq.length || ccSeq.length !== lvlSeq.length) return false;
  const valid = [];
  for (let i = 0; i < ccSeq.length; i++) if (ccSeq[i] !== null) valid.push(i);
  if (!valid.length) return false;
  // (i) CC لا يتغيّر إلا في عيّنات تغيّر L
  let onlyChangesWithLevel = true;
  for (let k = 1; k < valid.length; k++) {
    const i = valid[k];
    const p = valid[k - 1];
    if (ccSeq[i] !== ccSeq[p] && lvlSeq[i] === lvlSeq[p]) {
      onlyChangesWithLevel = false;
      break;
    }
  }
  if (onlyChangesWithLevel) return true;
  // (ii) median_i(CC_i/L_i) = FCC_est و|CC_i − FCC_est·L_i| ≤ 0.5%·FCC_est
  // في ≥ 95% من العيّنات (يستبعد L=0 لتفادي القسمة على صفر).
  const ratios = [];
  for (const i of valid) {
    if (lvlSeq[i] > 0) ratios.push(ccSeq[i] / lvlSeq[i]);
  }
  if (!ratios.length) return false;
  const fccEst = median(ratios);
  let within = 0;
  for (const i of valid) {
    if (Math.abs(ccSeq[i] - fccEst * lvlSeq[i]) <= 0.005 * fccEst) within++;
  }
  return (within / valid.length) >= 0.95;
}

// عدد التغيّرات بين قيمتين صالحتين متتاليتين (S-27: تتخطّى null). بلا null = changes() حرفاً.
function changesValid(seq) {
  let c = 0;
  let prev = null;
  for (const x of seq) {
    if (x === null) continue;
    if (prev !== null && x !== prev) c++;
    prev = x;
  }
  return c;
}

// ملاحظة BAT-CONSIST/BAT-CAP لـ fv68 (v[11] لكل عيّنة): **ينتظر fv68** —
// غير مُختبَر ذهبياً. لا فحص من الأربعة يحمل fv68 ولا قناة charge_counter
// لكل عيّنة (P2.1 لم تُنجَز بعد). المنطق مُنفَّذ مباشرة داخل computeBattery
// أدناه (فرع else)، ومُختبَر فقط بمُدخلات اصطناعية (findings.test.js)
// توضّح الميكانيكا، لا رقماً مرجعياً حقيقياً. الفجوة 3 (تُدوَّن ولا تُغلَق
// حتى يصل فحص fv68 حقيقي).

// A100 (2026-09-21 +03) — qCcMah كان يقسم على 1000 افتراضاً أن ccSeq
// بوحدة µAh دائماً، بصرف النظر عمّا أعلنته variables[].unit فعلياً. A38
// يُثبت أن نفس اسم الحقل (chargeCounterUah) يصل بمقياسين متباينين جداً
// بين الطرازين (s10=3,542,000 مقابل honor=5,596) — رقم كبير لا يعني µAh
// تلقائياً، ورقم صغير لا يعني mAh تلقائياً. استنتاج الوحدة من حجم الرقم
// هو A38 بعينه، والقاعدة 22 تمنعه صراحةً.
//
// نفس القاعدة المطبَّقة أعلاه على charge_counter.series (computeChargeCounter):
// التحويل يُشتقّ من variables[].unit المُعلَن حرفياً، لا من اسم الحقل ولا
// من حجم القيمة. وحدتان معروفتان اليوم على قناة الشحنة: µAh (تحويلها إلى
// mAh بالقسمة على 1000) وmAh (تحويل هويّة، بلا قسمة). أي غياب أو أي وحدة
// غير هاتين → NOT_MEASURED/UNIT_UNDECLARED — لا قسمة افتراضية على 1000.
function ccUnitMultiplierToMah(ccUnit) {
  if (typeof ccUnit !== "string") return null;
  const token = ccUnit.trim().toLowerCase().replace(/[μµ]/g, "u");
  if (token === "uah") return 1 / 1000; // µAh → mAh
  if (token === "mah") return 1; // mAh → mAh (تحويل هويّة)
  return null; // غير مُعلَنة، أو مُعلَنة بوحدة غير معروفة — لا تخمين لأيٍّ منهما
}

function computeBattery({n, t, ph, cur, volt, lvl, header, footer, ccSeq, ccUnit, ccExclusion}) {
  const fieldsVersion = num(footer && footer.fieldsVersion);
  const design = num(footer && footer.batteryHealth && footer.batteryHealth.designCapacityMah);
  const socAtStart = num(header && header.batteryLevelStart);
  const socAtEnd = num(footer && footer.batteryLevelEnd);

  const idx35 = [];
  for (let i = 0; i < n; i++) if (ph[i] === 3 || ph[i] === 4 || ph[i] === 5) idx35.push(i);
  const voltSeq35 = idx35.map((i) => volt[i]);
  const cadence35 = changes(voltSeq35);
  const voltageGate = passesEvidenceGate(idx35.length, cadence35);

  const qIntMah = n > 1 ? coulombMah(cur, t, 0, n - 1) : null;
  const dischargeRateUnderLoadMa = idx35.length ?
      mean(idx35.map((i) => Math.abs(cur[i]))) / 1000 : null;
  const voltageStabilityMv = idx35.length ? pstdev(voltSeq35) : null;

  const battery = {
    fieldsVersion, socAtStart, socAtEnd, designCapacityMah: design,
    qIntMah,
    qCcMah: null,
    ccUpdates: 0,
    ccDerived: null,
    consist: null,
    cap: null,
    info: {
      dischargeRateUnderLoadMa,
      voltageStabilityMv,
      voltageStabilityGate: {
        nSamples: idx35.length, sourceCadenceUpdates: cadence35, passes: voltageGate,
      },
      voltageStabilityNote: VOLTAGE_STABILITY_NOTE,
      voltageStabilitySocAtStart: socAtStart,
      rho: null,
      rhoNote: RHO_NOTE,
    },
  };

  // fv ≤ 67 (أو إصدار غير معروف — يُعامَل إرثاً احتياطاً): "كل ما جُمع
  // حتى الآن" — BAT-CONSIST/BAT-CAP = NOT_MEASURED/HARNESS_VERSION.
  // لا حرف بطارية على أي فحص fv67 (§٤-أ، "أثره على PLAN-02").
  const isLegacy = fieldsVersion === null || fieldsVersion <= 67;

  if (isLegacy) {
    battery.consist = {status: "NOT_MEASURED", reason: "HARNESS_VERSION"};
    battery.cap = {status: "NOT_MEASURED", reason: "HARNESS_VERSION"};
    if (design !== null && socAtStart !== null && socAtEnd !== null && qIntMah) {
      const drop = socAtStart - socAtEnd;
      battery.info.rho = (drop / 100 * design) / qIntMah;
    }
  } else {
    // fv ≥ 68 — v[11] charge_counter_uah لكل عيّنة. **ينتظر fv68** — غير
    // مُختبَر ذهبياً (انظر التعليق أعلى computeBattery، الفجوة 3).
    const ccValidIdx = [];
    if (Array.isArray(ccSeq)) {
      for (let i = 0; i < ccSeq.length; i++) if (ccSeq[i] !== null) ccValidIdx.push(i);
    }
    if (Array.isArray(ccSeq) && ccSeq.length === n && n > 0 &&
        (ccExclusionBlocks(ccExclusion) || ccValidIdx.length === 0)) {
      // S-27 (شرط المستخدم: كل قارئ يستثني الفاشلة): الاستثناء غير تامّ (قائمة مبتورة/بلا count/غير متتبَّعة) أو لا قراءة صالحة
      // واحدة ← لا مشتقّ من هذه السلسلة، بسببه صريحاً. والقيم الخام تبقى في charge_counter.series.rawValues.
      const reason = ccExclusionBlocks(ccExclusion) ? "READ_FAILURES_UNRESOLVED" : "NO_VALID_READS";
      battery.qCcMah = {status: "NOT_MEASURED", reason};
      battery.ccUpdates = null;
      battery.ccDerived = null;
      battery.consist = {status: "NOT_MEASURED", reason};
      battery.cap = {status: "NOT_MEASURED", reason};
    } else if (Array.isArray(ccSeq) && ccSeq.length === n && n > 0) {
      // A100: التحويل يُشتقّ من الوحدة المُعلَنة فقط — انظر تعليق
      // ccUnitMultiplierToMah أعلاه. mahMul هو null حين تكون الوحدة غائبة
      // أو غير معروفة، ولا قيمة عددية تُشتقّ منها حينها (لا قسمة افتراضية).
      const mahMul = ccUnitMultiplierToMah(ccUnit);
      const ccFirst = ccSeq[ccValidIdx[0]];
      const ccLast = ccSeq[ccValidIdx[ccValidIdx.length - 1]];
      const qCcMahValue = (mahMul === null) ?
          null : (ccFirst - ccLast) * mahMul;
      const ccUpdates = changesValid(ccSeq);
      const ccDerived = detectCcDerived(ccSeq, lvl);
      battery.qCcMah = (qCcMahValue === null) ?
          {status: "NOT_MEASURED", reason: "UNIT_UNDECLARED"} : qCcMahValue;
      battery.ccUpdates = ccUpdates;
      battery.ccDerived = ccDerived;

      if (ccDerived) {
        // CC_DERIVED فحص نسبي (CC_i مقابل level) لا يحتاج تحويل وحدة —
        // يبقى صحيحاً بصرف النظر عن unitDeclared، فيسبق بوّابة الوحدة.
        battery.consist = {
          status: "INFO_ONLY", reason: "CC_DERIVED",
          note: "العدّاد مشتقّ من نسبة الشحن لا من قياس مستقلّ — يُبلَّغ معلومةً لا حكماً",
        };
        battery.cap = {status: "NOT_MEASURED", reason: "CC_DERIVED"};
      } else if (qCcMahValue === null) {
        // A100: بلا وحدة مُعلَنة لا BAT-CONSIST ولا BAT-CAP رقمياً — كلاهما
        // يحتاج qCcMah بمقياس mAh حقيقي لحساب k أو سعة الفاصل.
        battery.consist = {status: "NOT_MEASURED", reason: "UNIT_UNDECLARED"};
        battery.cap = {status: "NOT_MEASURED", reason: "UNIT_UNDECLARED"};
      } else {
        const consistGateOk = qIntMah !== null && qIntMah >= 80 && ccUpdates >= 20;
        if (!consistGateOk) {
          battery.consist = {status: "NOT_MEASURED", reason: "INSUFFICIENT_SAMPLES"};
          battery.cap = {status: "NOT_MEASURED", reason: "INSUFFICIENT_SAMPLES"};
        } else {
          const k = qCcMahValue / qIntMah;
          const consistent = k >= 0.85 && k <= 1.15;
          battery.consist = consistent ?
              {status: "CONSISTENT", k} :
              {status: "NOT_MEASURED", reason: "INCONSISTENT_SOURCES", k};

          if (!consistent) {
            battery.cap = {status: "NOT_MEASURED", reason: "INCONSISTENT_SOURCES"};
          } else {
            // فواصل بين انتقالين متتاليين في L، استثناء لمس 0/7 و< 30 ث.
            const trans = [];
            for (let i = 1; i < n; i++) if (lvl[i] !== lvl[i - 1]) trans.push(i);
            const intervals = [];
            for (let j = 0; j < trans.length - 1; j++) {
              const a = trans[j]; const b = trans[j + 1];
              if (ph[a] === 0 || ph[a] === 7 || ph[b] === 0 || ph[b] === 7) continue;
              if ((t[b] - t[a]) / 1000 < 30) continue;
              if (ccSeq[a] === null || ccSeq[b] === null) continue; // S-27: عيّنة قراءتها فاشلة لا تُشكّل طرف فاصل
              // A100: نفس mahMul المُشتقّ من الوحدة المُعلَنة — لا /1000 ثابتة.
              const dCcMah = (ccSeq[a] - ccSeq[b]) * mahMul;
              const dL = lvl[a] - lvl[b];
              if (dL === 0) continue;
              intervals.push(100 * Math.abs(dCcMah) / Math.abs(dL));
            }
            if (intervals.length < 2) {
              battery.cap = {status: "NOT_MEASURED", reason: "INSUFFICIENT_SAMPLES"};
            } else if (design) {
              const cEst = median(intervals);
              battery.cap = {
                status: "ADVISORY", label: "إرشادي حتى المعايرة",
                capacityEstimateMah: cEst, ratioToDesign: cEst / design,
                intervalCount: intervals.length,
              };
            } else {
              battery.cap = {status: "NOT_MEASURED", reason: "INSUFFICIENT_SAMPLES"};
            }
          }
        }
      }
    } else {
      // fieldsVersion يعلن 68+ لكن v[11] غائب فعلياً من هذه الحمولة.
      battery.consist = {status: "NOT_MEASURED", reason: "HARNESS_VERSION"};
      battery.cap = {status: "NOT_MEASURED", reason: "HARNESS_VERSION"};
    }
  }

  return battery;
}

// ─── charge_counter — لقطة تذييل (fv≤67) أو سلسلة لكل عيّنة (fv≥68) ─────
// أمر المهمّة 2026-09-21 +03 "تصدير charge_counter ضمن قناة البطارية":
// BAT-FCC (batteryLayer.js §٤-ج) مُدخَله المنصوص = CC ÷ المستوى، محاذى
// لانتقالات المستوى — يحتاج **سلسلة** لكل عيّنة، لا لقطة واحدة. لقطة
// fv≤67 (footer.batteryHealth.chargeCounterUah) لا تبني BAT-FCC مهما
// كانت، فتُصدَّر هنا معلومةً منفصلة موسومة، لا مُدخلاً — تمييزاً واضحاً
// بين المسارين كما نصّ الأمر.
//
// ⚠️ A38 — فخّ وحدة، لا فخّ حساب: القيمة نفسها (chargeCounterUah) تصل
// بمقياسين متباينين جداً بين الطرازين المتاحين هنا (تحقّق مباشر على
// functions/test/fixtures/golden/*.ts.json → footer.batteryHealth.
// chargeCounterUah): s10=3542000، honor=5596، b45c8cf6=1936000،
// 34dff2b8=1711600. اسم الحقل ذاته ("...Uah") **ليس إعلان وحدة** — لا
// variables[] ولا أي حقل شقيق داخل footer.batteryHealth يحمل مفتاح
// "unit" بجوار هذه القيمة في أيٍّ من الفِخاخ الأربعة (بخلاف
// variables[].unit الحقيقي لقنوات v[0..10]، مثل battery_current_ua:
// unit="µA"). فاستنتاج "رقم كبير = µAh، رقم صغير = mAh" هو A38 بعينه —
// القاعدة 22 تمنعه صراحةً. لذلك: rawValue يُصدَّر دائماً كما ورد (بلا
// قسمة ولا ضرب ولا توحيد)، وunit يبقى null بحالة NOT_MEASURED/
// UNIT_UNDECLARED ما لم يصل حقل وحدة صريح فعلاً (لم يحدث على أي فحص
// متاح اليوم).
//
// القناة v[11] لكل عيّنة (fv≥68، P2.1) تحمل نظرياً نفس آلية
// variables[].unit المستعملة أصلاً لكل قنوات v[0..10] — إن أعلن التطبيق
// وحدتها هناك، تُقرأ من مصدرها حرفياً (لا تخمين). لا فحص fv68 حقيقي
// متاح اليوم لتأكيد هذا المسار — غير مُختبَر إلا اصطناعياً
// (findings.test.js)، مطابقاً لبقيّة مسار fv68 في computeBattery أعلاه.
//
// ─── تحديث A100 (2026-09-21 +03) ────────────────────────────────────────
// التناقض الموصوف أعلاه (قبل هذا التحديث) بين qCcMah و A38 أُغلق: qCcMah
// (battery.qCcMah، فرع fv≥68 في computeBattery) لم يعد يقسم ccSeq على
// 1000 افتراضاً. التحويل الآن عبر ccUnitMultiplierToMah(ccUnit) — الوحدة
// المُعلَنة فعلياً في variables[].unit لفهرس charge_counter_uah، لا حجم
// الرقم. µAh → ÷1000، mAh → تحويل هويّة، وأي غياب/وحدة غير معروفة →
// battery.qCcMah = {status:"NOT_MEASURED", reason:"UNIT_UNDECLARED"}
// وBAT-CONSIST/BAT-CAP يتبعانه بنفس السبب — راجع computeBattery أعلاه
// واختبار ذهبي بثلاث حالات (µAh/mAh/بلا وحدة) في findings.test.js.
// لا يزال غير مُختبَر ذهبياً بمعنى "فحص fv68 حقيقي" (لا فحص كهذا موجود
// اليوم) — الاختبار الثلاثي اصطناعي، مثل بقية مسار fv68.
function computeChargeCounter({footer, fieldsVersion, ccSeq, ccUnit, ccExclusion}) {
  const snapshotRaw = num(footer && footer.batteryHealth && footer.batteryHealth.chargeCounterUah);
  const snapshot = snapshotRaw === null ?
      {
        status: "NOT_MEASURED", reason: "ABSENT",
        rawValue: null, unit: null, unitSource: "ABSENT",
        note: "لقطة تذييل واحدة — معلومة لا مُدخل BAT-FCC؛ BAT-FCC يحتاج سلسلة (§٤-ج)",
      } :
      {
        status: "NOT_MEASURED", reason: "UNIT_UNDECLARED",
        rawValue: snapshotRaw, unit: null, unitSource: "MISSING",
        note: "لقطة تذييل واحدة — معلومة لا مُدخل BAT-FCC؛ BAT-FCC يحتاج سلسلة (§٤-ج). " +
            "الوحدة غير مُعلَنة في الحمولة (اسم الحقل وحده ليس إعلاناً — A38)، فلا تُخمَّن من حجم الرقم.",
      };

  const isLegacy = fieldsVersion === null || fieldsVersion <= 67;
  let series;
  if (isLegacy) {
    series = {
      status: "NOT_MEASURED", reason: "HARNESS_VERSION",
      rawValues: null, unit: null, unitSource: "ABSENT",
    };
  } else if (Array.isArray(ccSeq) && ccSeq.length) {
    const unitText = typeof ccUnit === "string" ? ccUnit.trim() : "";
    // «as_declared_by_device» إعلان من التطبيق بأنه لا يعرف الوحدة (عقد :421 [ح س-09]) — ليس وحدة قياس، فلا يُقرأ تصريحاً بوحدة؛
    // يستنتجها الخادم لاحقاً من السعة التصميمية والمستوى (قرار لاحق لم يُنفَّذ هنا).
    const unitIsDeclaration = unitText !== "" && unitText !== N.CHARGE_COUNTER_UNIT_AS_DECLARED;
    // S-27: مواضع العيّنات الفاشلة null في rawValues (القيمة الخام الفعلية تبقى في الحمولة الأصلية).
    const readFailures = {
      exclusion: ccExclusion === undefined ? null : ccExclusion,
      excludedCount: ccSeq.filter((x) => x === null).length,
    };
    if (ccExclusionBlocks(ccExclusion)) {
      series = {status: "NOT_MEASURED", reason: "READ_FAILURES_UNRESOLVED", rawValues: ccSeq.slice(), unit: null,
        unitSource: "ABSENT", readFailures};
    } else if (unitIsDeclaration) {
      series = {status: "MEASURED", reason: null, rawValues: ccSeq.slice(), unit: ccUnit,
        unitSource: "DECLARED_IN_VARIABLES", readFailures};
    } else {
      series = {status: "NOT_MEASURED", reason: "UNIT_UNDECLARED", rawValues: ccSeq.slice(), unit: null,
        unitSource: unitText === N.CHARGE_COUNTER_UNIT_AS_DECLARED ? "AS_DECLARED_BY_DEVICE" : "MISSING", readFailures};
    }
  } else {
    series = {status: "NOT_MEASURED", reason: "ABSENT", rawValues: null, unit: null, unitSource: "ABSENT"};
  }

  return {snapshot, series};
}

// ─── التخزين — §٤-ب(١). حالة لا حكم؛ زمن 4GB لا يُعرض كسرعة. ───────────

function detectStorageKnee(segmentsMbps, cumulativeBytesArr) {
  for (let k = 2; k < segmentsMbps.length; k++) {
    const priorMedian = median(segmentsMbps.slice(0, k));
    if (segmentsMbps[k] <= 0.5 * priorMedian) {
      return {
        segmentIndex: k,
        cumulativeGb: cumulativeBytesArr[k] / Math.pow(2, 30),
        mbps: segmentsMbps[k],
      };
    }
  }
  return null;
}

function computeStorage(footer) {
  const segs = footer && footer.verificationResults &&
      footer.verificationResults.storageThroughputSegments;
  if (!Array.isArray(segs) || !segs.length) {
    return {
      status: "NOT_MEASURED", reason: "ABSENT",
      inCacheMbps: null, postCacheMbps: null, kneeGb: null, kneeState: null,
    };
  }
  const mbps = segs.map((s) => s.mbps);
  const cumulative = segs.map((s) => s.cumulativeBytes);
  const knee = detectStorageKnee(mbps, cumulative);

  // "يُبطل «كاشف الانهيار» ... كمصدر حكم — موضع الركبة 2.5 → 3.0 → لا
  // خروج على الجهاز نفسه" (§٤-ب) — لهذا الحالة تُعرض كما هي بلا وسم فشل،
  // ولا يدخل أي من الحقلين أدناه حرفاً أو عطباً في هذا الملف.
  return {
    status: "STATE_ONLY",
    note: "حالة لا حكم — موضع الركبة تذبذب على الجهاز نفسه عبر فحوص متتالية",
    inCacheMbps: knee ? median(mbps.slice(0, knee.segmentIndex)) : median(mbps),
    postCacheMbps: knee ? median(mbps.slice(knee.segmentIndex)) : null,
    kneeGb: knee ? knee.cumulativeGb : null,
    kneeState: knee ? "KNEE_DETECTED" : "IN_CACHE_THROUGHOUT",
  };
}

// ─── الحرارة — البند ٦. ارتفاع حرارة البطارية ببوّابة الكادنس. ─────────

function computeThermal(n, t, ph, temp, footer) {
  const cadenceWhole = changes(temp);
  const gate = passesEvidenceGate(n, cadenceWhole);

  const idx345 = [];
  for (let i = 0; i < n; i++) if (ph[i] === 3 || ph[i] === 4 || ph[i] === 5) idx345.push(i);
  let ratePerMinPhases345 = null;
  if (gate && idx345.length >= 2) {
    const first = idx345[0];
    const last = idx345[idx345.length - 1];
    const dtMin = (t[last] - t[first]) / 60000;
    ratePerMinPhases345 = dtMin > 0 ? (temp[last] - temp[first]) / dtMin : null;
  }

  return {
    batteryTempRise: {
      status: gate ? "MEASURED" : "NOT_MEASURED",
      reason: gate ? null : "INSUFFICIENT_CADENCE",
      // القيمة تُحجَب عند فشل البوّابة عمداً — لا نعرض رقماً "قد يكون
      // خاطئاً بصمت" (نفس فلسفة A76 في اختبار البتر أدناه).
      valueC: gate ? (Math.max(...temp) - temp[0]) : null,
      ratePerMinPhases345,
      nSamplesWholeScan: n,
      cadenceUpdatesWholeScan: cadenceWhole,
    },
    thermalHeadroomPeak: num(footer && footer.thermalHeadroomPeak),
    thermalStatusMax: num(footer && footer.thermalStatusMax),
  };
}

// ─── UNSTABLE / ADVISORY — §٤-ب(٢،٣). وسم ساكن، لا CV حيّ. ─────────────

function findFunctionalResult(functionalResults, testId) {
  return (Array.isArray(functionalResults) ? functionalResults : [])
      .find((r) => r && r.testId === testId) || null;
}

function buildTaggedMeasurements(functionalResults, testIds, tagClass, extra) {
  const out = {};
  for (const testId of testIds) {
    const entry = findFunctionalResult(functionalResults, testId);
    out[testId] = entry ? Object.assign({
      found: true,
      rawValue: entry.rawValue ?? null,
      rawValueUnit: entry.rawValueUnit || null,
      testStatus: entry.status || null,
      class: tagClass,
      entersGrade: false,
      entersFault: false,
    }, extra) : {
      found: false,
      class: tagClass,
      status: "NOT_MEASURED",
      reason: "ABSENT_FROM_FUNCTIONAL_RESULTS",
    };
  }
  return out;
}

function buildUnstableMeasurements(functionalResults) {
  return buildTaggedMeasurements(functionalResults, UNSTABLE_TEST_IDS, "UNSTABLE", {
    label: "مقياس غير مستقرّ",
    criterion: UNSTABLE_CRITERION_NOTE,
    referenceCvPct: UNSTABLE_REFERENCE_CV_PCT,
    referenceNote: UNSTABLE_REFERENCE_NOTE,
  });
}

function buildAdvisoryMeasurements(functionalResults) {
  return buildTaggedMeasurements(functionalResults, ADVISORY_TEST_IDS, "ADVISORY", {
    label: "إرشادي حتى بروتوكول الفجوات",
  });
}

// ─── سعة التخزين المُشتقّة (S-01/S-02) — بند (6) البرومبت + انجراف 71.5 ──
// راجع systemPromptV7.js:47-64 ("منع الهلوسة — رقم مشتقّ بالضرب/القسمة":
// النداء الحيّ على 34dff2b8 رفضه الحارس بسبب 71.5 = 228.6×0.313، والتعليق
// هناك نصّ على أن **تكرار** الرفض رغم بند (6) حلّه "تصدير ذلك المشتقّ من
// findings.js — لا توسيع الحارس". هذا هو ذلك التصدير (تحقّق: تكرّر فعلاً —
// راجع تقرير المهمّة، guard.numbers.unmatchedFields على نداءي 2026-09-22).
//
// ⚠️ **تصحيح جوهري على تشخيص التعليق الأصلي (يقلب طريقة الحساب هنا تحديداً)**:
// 71.5 **ليس** ناتج 228.6×31.3٪ فعلياً — ذلك يُنتج 71.5518 (يُقرَّب 71.6 لا
// 71.5، تحقّق حسابي مباشر). 71.5 رقم **جاهز مُضمَّن حرفياً** في
// S-02.rawValueUnit نفسه: "% (71.5 GB)" (كلا الفحصين، functions/test/
// fixtures/golden/functionalResults-by-scanid.json) — التطبيق يحسبه
// ويُضمّنه في نصّ الوحدة، لا نموذج يشتقّه بالضرب. **فالدالّة أدناه تستخرج
// الرقم المُضمَّن حرفياً من النصّ (مطابقة تامّة لما أنتجه التطبيق) — لا
// تُعيد اشتقاقه بالضرب** (ذلك كان سيُصدِّر 71.6 فيُبقي 71.5 مرفوضاً كما هو،
// يزيد العطب سوءاً لا يُصلحه).
// num() أعلاه يقبل نوع number فقط (JS typeof) — rawValue من functionalResults
// يصل نصّاً دائماً ("228.6" لا 228.6، تحقّق: functionalResults-by-scanid.json
// كلّها rawValue: string). حارس رقمي منفصل هنا يقبل النصّ الرقمي المحض فقط
// (لا NaN صامتة من نصّ غير رقمي — يرمي إلى null صراحةً، لا 0).
function numFromString(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function computeStorageCapacityDerived(functionalResults) {
  const s01 = findFunctionalResult(functionalResults, "S-01");
  const s02 = findFunctionalResult(functionalResults, "S-02");
  const totalGb = s01 ? numFromString(s01.rawValue) : null;
  const availablePct = s02 ? numFromString(s02.rawValue) : null;
  const unitText = (s02 && typeof s02.rawValueUnit === "string") ? s02.rawValueUnit : "";
  const embeddedMatch = /\(([\d.]+)\s*GB\)/.exec(unitText);
  const availableGb = embeddedMatch ? numFromString(embeddedMatch[1]) : null;

  if (totalGb === null || availablePct === null || availableGb === null) {
    // A97/القاعدة 22 — غياب صريح، لا صفر ولا تخمين قيمة.
    return {
      status: "NOT_MEASURED", reason: "ABSENT_OR_UNPARSEABLE",
      totalGb, availablePct, availableGb,
      source: "S-01/S-02 غائبان أو rawValueUnit بلا نمط \"(X GB)\" مُضمَّن",
    };
  }
  return {
    status: "MEASURED",
    totalGb, availablePct, availableGb,
    source: "استخراج حرفي من S-02.rawValueUnit (الرقم المُضمَّن من التطبيق نفسه) — " +
        "لا إعادة اشتقاق بضرب S-01×S-02 (ذاك يُنتج رقماً مختلفاً فعلياً)",
  };
}

// ─── G7 — قائمة الحقول‑بحسب‑الإصدار التي تُقرأ NOT_MEASURED ────────────

function buildNotMeasuredFields(footer) {
  const list = [];
  const f = footer || {};
  const fieldsVersion = num(f.fieldsVersion);
  const isLegacyOrUnknown = fieldsVersion === null || fieldsVersion <= 67;
  if (!isLegacyOrUnknown) {
    // G7 يخصّ fv ≤ 67 نصّاً. وفي ≥ 68 يُعلن التطبيق الغياب بنفسه: cpuTempFinalSource = absent:<سبب> بدل maxCpuTemp = -1
    // (عقد ت-10 :517-526؛ أمر الدفعة ٤ بند 3: «cpuTempFinalC بدل maxCpuTemp و-1»)، فيدخل الحقل الجديد القائمة بسبب الغياب نفسه
    // لا بقيمة حارسة. وما سوى ذلك من ثوابت ≥ 68 المعلنة (unmeasuredDefaults) لا يدخلها هنا — لم يُطلب (راجع تقرير الدفعة).
    const src = parseState(f[N.FOOTER.CPU_TEMP_FINAL_SOURCE], N.VOCAB.CPU_TEMP_FINAL_SOURCE);
    if (src !== null && src.kind === "absent") {
      list.push({field: N.FOOTER.CPU_TEMP_FINAL_C, scope: "footer", reason: "NO_CPU_TEMP_SENSOR", value: null});
    }
    return list;
  }

  const unmeasuredDefaults = Array.isArray(f.unmeasuredDefaults) ? f.unmeasuredDefaults : [];
  for (const field of unmeasuredDefaults) {
    list.push({field, scope: "footer", reason: "UNMEASURED_DEFAULT", value: f[field] ?? null});
  }

  const vr = f.verificationResults || {};
  if (num(vr[N.VERIFICATION.STORAGE_SLC_CACHE_SIZE_MB_REMOVED]) === 0) {
    list.push({
      field: N.VERIFICATION.STORAGE_SLC_CACHE_SIZE_MB_REMOVED, scope: "footer.verificationResults",
      reason: "STRUCTURAL_DEFAULT_ZERO", value: 0,
    });
  }

  const tempRiseProbe = num(f.tempRiseRateInProbe);
  const maxCpuTemp = num(f[N.FOOTER.MAX_CPU_TEMP_LEGACY]);
  if (tempRiseProbe === 0 && maxCpuTemp === -1) {
    list.push({field: "tempRiseRateInProbe", scope: "footer", reason: "NO_CPU_TEMP_SENSOR", value: 0});
    list.push({field: N.FOOTER.MAX_CPU_TEMP_LEGACY, scope: "footer", reason: "NO_CPU_TEMP_SENSOR", value: -1});
  }

  const dq = f.dataQuality || {};
  for (const field of DATA_QUALITY_ZERO_COVERAGE_FIELDS) {
    if (num(dq[field]) === 0) {
      list.push({field, scope: "footer.dataQuality", reason: "NO_SENSOR_COVERAGE", value: 0});
    }
  }

  for (const field of ABSENT_VERIFICATION_FIELDS_A76) {
    if (!(field in vr)) {
      list.push({field, scope: "footer.verificationResults", reason: "FIELD_ABSENT_A76", value: null});
    }
  }

  return list;
}

// ─── مسار البتر — اختبار انحدار على A76 ─────────────────────────────────
// حمولة بلا samples (غائبة أو فارغة أو ليست مصفوفة): كل مشتقّ من السلسلة
// الزمنية يعود NOT_MEASURED/HARNESS_ERROR صراحةً — لا صفر ولا null. نطاق
// الحجب هنا شامل عمداً (يضمّ حتى الحقول القادرة نظرياً على القراءة من
// footer وحده مثل storage وG7) لأن غياب samples بهذا الشكل عرَض عطب في
// أداة الجمع نفسها، لا نقصاً في قناة واحدة — تفسير أضيق كان سيُبقي
// أجزاءً "تعمل" من حمولة نعرف أنها معطوبة، وهو بالضبط نمط A76 (قراءة
// غياب الشرط الحقيقي كنجاح جزئي).
function buildHarnessErrorFindings(header, footer) {
  const h = header || {};
  const f = footer || {};
  const err = harnessError();
  return {
    meta: {
      fieldsVersion: num(f.fieldsVersion),
      scanId: h.scanId || null,
      deviceModel: h.deviceModel || null,
      api: (typeof h.androidApiLevel === "number") ? h.androidApiLevel : null,
      sampleCount: 0,
      expectedSamples: num(f.expectedSamples),
      wallMs: null,
    },
    status: "NOT_MEASURED",
    notMeasuredReason: "HARNESS_ERROR",
    channels: err,
    perChannelUpdateCount: err,
    sustainedCeiling: {
      status: "NOT_MEASURED", notMeasuredReason: "HARNESS_ERROR",
      phase3: null, phase5: null, combined: null, recoveryPhase7Ratio: null,
    },
    graphics: {
      status: "NOT_MEASURED", notMeasuredReason: "HARNESS_ERROR",
      phase4: null, phase5: null, phase4DriftRatio: null, ratioPhase5OverPhase4: null,
      vsyncLockFraction60: null, vsyncLockFraction90: null, vsyncLockFraction120: null,
    },
    battery: {
      fieldsVersion: num(f.fieldsVersion),
      socAtStart: num(h.batteryLevelStart),
      socAtEnd: num(f.batteryLevelEnd),
      designCapacityMah: num(f.batteryHealth && f.batteryHealth.designCapacityMah),
      qIntMah: err, qCcMah: err, ccUpdates: err, ccDerived: null,
      charge_counter: {snapshot: err, series: err},
      consist: {status: "NOT_MEASURED", reason: "HARNESS_ERROR"},
      cap: {status: "NOT_MEASURED", reason: "HARNESS_ERROR"},
      info: {
        dischargeRateUnderLoadMa: err,
        voltageStabilityMv: err,
        voltageStabilityNote: VOLTAGE_STABILITY_NOTE,
        voltageStabilitySocAtStart: num(h.batteryLevelStart),
        rho: err,
        rhoNote: RHO_NOTE,
      },
    },
    storage: {status: "NOT_MEASURED", reason: "HARNESS_ERROR",
      inCacheMbps: null, postCacheMbps: null, kneeGb: null, kneeState: null},
    thermal: {
      batteryTempRise: {status: "NOT_MEASURED", reason: "HARNESS_ERROR", valueC: null,
        ratePerMinPhases345: null, nSamplesWholeScan: 0, cadenceUpdatesWholeScan: null},
      thermalHeadroomPeak: null, thermalStatusMax: null,
    },
    unstableMeasurements: err,
    advisoryMeasurements: err,
    notMeasuredFields: err,
  };
}

// ─── نقطة الدخول ────────────────────────────────────────────────────────

/**
 * يحسب Findings حتمياً من fingerprint فحص واحد. لا يرمي أبداً: أي حقل
 * غائب أو مشوَّه يُترجَم إلى NOT_MEASURED بسبب مُسمّى، لا استثناء غير
 * مُلتقَط يُسقط التحليل كلّه.
 *
 * ترتيب استخراج samples/footer/header/variables مطابق لـ callAI.js:144-156
 * (fingerprint.timeSeries أولاً، ثم مستوى الجذر للتوافق الخلفي).
 *
 * الضمان "لا يرمي أبداً" مُنفَّذ بطبقتين: (١) samples فارغة/غائبة تُلتقَط
 * صراحةً أدناه قبل أي وصول لعناصرها، و(٢) samples غير فارغة لكن عناصرها
 * مشوَّهة (مثلاً عنصر بلا حقل v، أو v أقصر من المتوقَّع) يمكن أن ترمي
 * داخل computeFindingsFromSamples — تُلتقَط هنا وتُعامَل بنفس وسم
 * الحمولة الفارغة (HARNESS_ERROR)، لأن السبب من فئة واحدة: البيانات
 * الواردة لا تصلح للحساب، سواء غابت أم شُوِّهت.
 *
 * @param {Object} fingerprint كما يصل من التطبيق (fv ≤ 67 اليوم)
 * @return {Object} Findings
 */
function computeFindings(fingerprint) {
  const ts = (fingerprint && fingerprint.timeSeries) || {};
  const header = ts.header || (fingerprint && fingerprint.header) || {};
  const footer = ts.footer || (fingerprint && fingerprint.footer) || {};
  const samples = ts.samples || (fingerprint && fingerprint.samples) || [];
  const variables = ts.variables || (fingerprint && fingerprint.variables) || [];
  const functionalResults = (fingerprint && fingerprint.functionalResults) || [];

  if (!Array.isArray(samples) || samples.length === 0) {
    return buildHarnessErrorFindings(header, footer);
  }

  try {
    return computeFindingsFromSamples(samples, variables, functionalResults, header, footer);
  } catch (err) {
    console.error(`[findings] malformed samples — falling back to HARNESS_ERROR: ${err.message || err}`);
    return buildHarnessErrorFindings(header, footer);
  }
}

function computeFindingsFromSamples(samples, variables, functionalResults, header, footer) {
  const n = samples.length;
  // القراءة بالاسم (الأمر البند ٢، القاعدة 24): تخطيط variables[] لهذا الفحص — الفهرس = index المعلن أو موضع العنصر.
  // طول v[] يختلف بين الأجهزة (11 + ما اجتاز الاكتشاف)، والاسم هو المميِّز لا الفهرس (عقد :409).
  const {layout, failures} = readColumnsAndFailures({footer, samples, variables});
  // يرمي إن لم يُحَلّ اسم أساسي ← computeFindings تلتقط وتُخرج HARNESS_ERROR المعلن (لا قراءة بفهرس مخمَّن).
  const base = resolveBaseColumns(layout, num(footer.fieldsVersion));
  const colAt = (idx) => samples.map((s) => s.v[idx]);
  const colByName = (name) => colAt(base.byName[name]);
  const t = colByName(N.BASE_CHANNELS.TIMESTAMP_MS);
  const ph = samples.map((s) => s.phase);

  const temp = colByName(N.BASE_CHANNELS.BATTERY_TEMP_C);
  const volt = colByName(N.BASE_CHANNELS.BATTERY_VOLTAGE_MV);
  const cur = colByName(N.BASE_CHANNELS.BATTERY_CURRENT_UA);
  const lvl = colByName(N.BASE_CHANNELS.BATTERY_LEVEL_PCT);
  const freq = colByName(N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ);
  const fps = colByName(N.BASE_CHANNELS.GPU_FPS);
  // عدّاد الشحن الخام (charge_counter_raw): قناة مشروطة بالاكتشاف تُلحَق بعد v[10] (عقد :403-409) — يُقرأ فقط إن أُعلن اسمها في
  // variables[] (لا وجود له في ≤ 67). الاسم القديم charge_counter_uah لا وجود له في أيّ حمولة (عقد :429) فلا يُبحث عنه.
  // S-27: عيّنات القناة الفاشلة تُستثنى (null) — ونتيجة الاستثناء (تامّ/مبتور/غير متتبَّع) تحكم المشتقّات في computeBattery.
  const ccIdx = columnIndex(layout, N.CHARGE_COUNTER_CHANNEL);
  const ccFailed = failedReads(failures, N.CHARGE_COUNTER_CHANNEL);
  const ccSeq = ccIdx === null ? null : maskFailedReads(colAt(ccIdx), ccFailed.indices);
  const ccExclusion = ccIdx === null ? null : ccFailed.exclusion;

  // وحدة charge_counter المُعلَنة فعلياً — من variables[] كما وصل (A38: لا تخمين من حجم الرقم ولا من الاسم). قيمتها اليوم
  // «as_declared_by_device» وهي إعلان بعدم المعرفة لا وحدة (computeChargeCounter تعامله كذلك).
  const ccUnit = (layout.chargeCounter && typeof layout.chargeCounter.unit === "string" && layout.chargeCounter.unit.trim()) ?
      layout.chargeCounter.unit : null;

  const wallMs = (typeof footer.endTimestamp === "number" &&
      typeof header.startTimestamp === "number") ?
      (footer.endTimestamp - header.startTimestamp) : null;

  const battery = computeBattery({n, t, ph, cur, volt, lvl, header, footer, ccSeq, ccUnit, ccExclusion});
  // charge_counter (اسم المفتاح snake_case عمداً — راجع تقرير المهمّة:
  // يجعل الحارس (reportShapeV7.js/collectFindingsFieldNameTokens) يستثني
  // توكِني "charge"/"counter" تلقائياً من كشف تسرّب اللغة عبر تجزئة
  // LEAK_TOKEN_RE على اسم المفتاح نفسه — بلا استثناء يدوي).
  battery.charge_counter = computeChargeCounter({footer, fieldsVersion: battery.fieldsVersion, ccSeq, ccUnit, ccExclusion});

  // نفس نمط battery.charge_counter أعلاه: مُلحَقة بعد البناء بدل تمريرها
  // كخيار داخل computeStorage(footer) — مصدرها functionalResults (S-01/S-02)
  // لا footer، فدمجها داخل توقيع computeStorage كان سيخلط مصدرين مختلفين
  // في دالّة واحدة بلا داعٍ.
  const storage = computeStorage(footer);
  storage.capacityDerived = computeStorageCapacityDerived(functionalResults);

  return {
    meta: {
      fieldsVersion: num(footer.fieldsVersion),
      scanId: header.scanId || null,
      deviceModel: header.deviceModel || null,
      api: (typeof header.androidApiLevel === "number") ? header.androidApiLevel : null,
      sampleCount: n,
      expectedSamples: num(footer.expectedSamples),
      wallMs,
    },
    status: "MEASURED",
    notMeasuredReason: null,
    channels: buildChannels(n, ph, colAt, channelNamesByIndex(layout, base.source),
        (name) => failedReads(failures, name).indices),
    perChannelUpdateCount: buildPerChannelUpdateCount(colByName),
    sustainedCeiling: computeSustainedCeiling(n, t, ph, freq, footer),
    graphics: computeGraphics(n, t, ph, fps),
    battery,
    storage,
    thermal: computeThermal(n, t, ph, temp, footer),
    unstableMeasurements: buildUnstableMeasurements(functionalResults),
    advisoryMeasurements: buildAdvisoryMeasurements(functionalResults),
    notMeasuredFields: buildNotMeasuredFields(footer),
  };
}

module.exports = {
  computeFindings,
  PHASE_NAMES,
  UNSTABLE_TEST_IDS,
  ADVISORY_TEST_IDS,
  UNSTABLE_CV_THRESHOLD_PCT,
  UNSTABLE_REFERENCE_CV_PCT,
  ABSENT_VERIFICATION_FIELDS_A76,
  EVIDENCE_MIN_SAMPLES,
  EVIDENCE_MIN_CADENCE_UPDATES,
  VSYNC_LOCK_COMBINED_FRACTION_THRESHOLD,
  VSYNC_LOCK_THRESHOLD_LABEL,
  LOW_CATEGORY_COVERAGE_THRESHOLD,
  LOW_CATEGORY_COVERAGE_THRESHOLD_LABEL,
  thresholdSet,
  passesEvidenceGate,
  SUSTAINED_WINDOW_MS,
  // مُصدَّرة للاختبار الذهبي وحده — ليست واجهة عامّة مستقرّة.
  _internal: {
    SUSTAINED_WINDOW_MS, mean, median, pstdev, percentile, changes, coulombMah, windowStats,
    detectCcDerived, detectStorageKnee, computeChargeCounter,
    changesValid, resolveBaseColumns, channelNamesByIndex, maskFailedReads, ccExclusionBlocks,
  },
};
