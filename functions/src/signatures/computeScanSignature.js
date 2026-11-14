const {PIPELINE_VERSION} = require("./constants");
const {readVerificationOnly, readBatteryHealthOnly} = require("../analysis/fv68Reader");
const {classifyCycleCount} = require("../analysis/cycleCountClassification");

// ===================================================
// computeScanSignature — fingerprint الصحة (V2 fix #44)
// ===================================================
// يحوي فقط قياسات صحة الجهاز الفعلية (verification + functional).
// لا يحوي قياسات تتأثّر بالـ scheduler أو الـ environment أو
// synthetic events.
//
// السبب: الـ signature السابقة كانت تختلف 15%+ بين فحصين متتاليين
// لنفس الجهاز السليم بسبب:
//   - cpuFmaIterations يختلف (CPU scheduler variance)
//   - throttlingEventsCount يختلف (synthetic events)
//   - memoryTestedBytes يختلف (free RAM)
//   - peak temps تختلف (بيئة الفحص)
//
// signature الجديدة تتغيّر فقط لو:
//   - فشل verification جديد (FMA errors، bad cells، storage errors)
//   - تغيّر pass/fail لـ functional test
//   - تغيّر warning count لـ category
function computeScanSignature(fingerprint) {
  const ts = fingerprint?.timeSeries || {};
  const footer = ts.footer || {};
  const func = fingerprint?.functionalResults || [];
  // نتائج التحقّق تُقرأ بحالة صريحة لكل حقل (fv68Reader.readVerification) — الدفعة ٤، القاعدة 22: الغائب يبقى غائباً (null)،
  // لا `|| 0` يقرأ غياب عدّاد صفر أخطاء، ولا `!== false` يقرأ غياب فحص نجاحاً، ولا `=== true` يقرأ غياب حكمٍ «لا عيب».
  // والعدد الخامّ الجديد في ≥ 68 (memoryMarchErrors…) تُشتقّ منه …Passed صراحةً (س-30 :1014-1018)، وfv68 لا يُرسل
  // cpuFmaErrors ولا cpuPrimeSieveCorrect (ت-20 :675-684) فيبقيان null إلا في حمولات أقدم تحملهما.
  const v = readVerificationOnly(fingerprint);
  const firstNonNull = (a, b) => (a !== null && a !== undefined ? a : b);
  // تغطية الحرارة مدوّرة لأقرب 10% لتجنّب الضجيج؛ والغائب null لا 0 (القاعدة 22).
  const roundTo10 = (x) => ((typeof x === "number" && isFinite(x)) ? Math.round(x / 10) * 10 : null);

  // V2 fix #55: stressEffectiveness (من footer) يدخل الـ signature
  // لأن أجهزة بـ governor capping مختلف لها تشخيص مختلف. تُخزَّن
  // ضمن block الـ verification (نفس فلسفة "device health booleans").
  const stressEff = footer.stressEffectiveness || {};
  // V2 fix #57: dataQuality + batteryHealth signals يدخلان الـ signature.
  // تغيّر coverage أو SoH = تغيّر في كيف يجب تفسير القياسات → AI re-eval.
  const dataQ = footer.dataQuality || {};
  const battH = footer.batteryHealth || {};

  const sig = {
    // V4 hardening: pipelineVersion is part of the signature. Compared as
    // a hard gate in signatureDifference (any mismatch returns 1.0 — full
    // miss — so cached aiResponse from a different pipeline never reused).
    pipelineVersion: PIPELINE_VERSION,

    // 1. Verification booleans + critical counters
    // أي تغيّر هنا = عيب جديد في الجهاز
    verification: {
      cpuFmaErrors: v.legacy.cpuFmaErrors.value,
      cpuPrimeSieveCorrect: v.legacy.cpuPrimeSieveCorrect.value,
      memoryMarchPassed: firstNonNull(v.legacy.memoryMarchPassed.value, v.memory.derived.marchPassed),
      memoryWalkingOnesPassed: firstNonNull(v.legacy.memoryWalkingOnesPassed.value, v.memory.derived.walkingOnesPassed),
      memoryRandomVerifyErrors: v.memory.errors.randomVerify,
      storageWriteVerifyErrors: v.storage.errors.write,
      storageReadVerifyErrors: v.storage.errors.read,
      gpuComputeGemmCorrect: v.gpuGemm.correct,
      criticalDefectDetected: v.criticalDefect.value,
      // fv68 (ت-20): عدد فحوص «النتيجة المعروفة مسبقاً» غير المطابقة (غربال/SHA)، null حين لم يجرِ الفحص. يدخل التوقيع في ختم ≥ 68
      // وحده: مفتاح لا وجود له قبل 68 لا يُضاف فارقاً صامتاً بين توقيعين يخلوان منه (ولا يُعدّ null «تغيّراً» عن توقيع قديم لا يحمله).
      // fv70 (§٧-ط): في `partial:time_budget` العدّاد يُحسب على الأنصاف المُبلَّغة وحدها (المتروك لا يدخله نجاحاً ولا فشلاً ولا صفراً) — كان `=== 'ran'` وحده يُسقطه إلى null فيضيع عدم تطابق حقيقي في فحص جزئي.
      ...(v.applicable ? {cpuKnownAnswerMismatches: v.cpuKnownAnswer.mismatches} : {}),
      // V2 fix #55: هل الـ stress test وصل لذروته؟
      stressPassed: stressEff.passedSaturationThreshold === true,
      stressFailureReason: stressEff.saturationFailureReason || "",
      // V2 fix #57: data quality coverage (مدوّر لأقرب 10% لتجنّب noise)
      cpuTempCoverage: roundTo10(dataQ.cpuTempCoveragePct),
      skinTempCoverage: roundTo10(dataQ.skinTempCoveragePct),
      batteryScalingLocked: dataQ.batteryScalingLocked === true,
      // V2 fix #57: BatteryHealth SoH signal (-1 sentinel لو غير متاح)
      sohPercent: typeof battH.sohOfficialPercent === "number" ?
          battH.sohOfficialPercent : -1,
    },

    // 2. Functional test outcomes per category
    // pass + warning + fail counts (not_tested/unavailable مستثنى)
    functional: {},
  };

  const SIG_CATEGORIES = ["battery", "thermal", "cpu", "gpu", "display", "memory",
    "storage", "camera", "gps", "security", "sensors", "cellular", "wireless"];
  for (const cat of SIG_CATEGORIES) {
    const tests = func.filter((r) =>
      r.categoryName === cat &&
      r.status !== "not_tested" &&
      r.status !== "unavailable",
    );
    const passCount = tests.filter((r) => r.status === "pass").length;
    const failCount = tests.filter((r) => r.status === "fail").length;
    const warnCount = tests.filter((r) => r.status === "warning").length;

    // Format: "P/F/W" e.g., "6/0/1" = 6 pass, 0 fail, 1 warning
    sig.functional[cat] = `${passCount}/${failCount}/${warnCount}`;
  }

  // V6 reevaluation — battery behavioral indicators (fieldsVersion 63+).
  // Compared by reevaluationDecision (defect-oriented), NOT by the aggregate
  // signatureDifference (which walks verification + functional only). Stored so
  // a later scan can detect battery replacement / sudden degradation.
  // قرار المستخدم 2026-10-13 +03 (cycleCountClassification.js): صفر الدورات من EXTRA_CYCLE_COUNT مصنَّف «غير مدعوم» — «بصمة الجهاز تحفظ الحالة لا الرقم». فـcycleCount هنا null (لا 0)
  // ومعه cycleCountClassification بالوسم؛ والمفتاح لا يُكتب إلا حين وقع التصنيف (سائر التواقيع بلا تغيير بايتاً). الحكم على مخرَج القارئ نفسه (readBatteryHealthOnly) لا على battH:
  // الشرط يقرأ الحالة والمصدر والقيمة معاً، وbattH.cycleCount وحده لا يحمل الحالتين.
  // أثره على المقارنة (مُختبَر في test/cycleCountUnsupportedZero.test.js): signatureDifference لا تمرّ على sig.battery إطلاقاً (verification وfunctional وحدهما)، فلا فرق ولا انجراف؛
  // وreevaluationDecision تقرأ cycleCount بـnum() فـnull لا يُقارَن (لا «battery:cycleCount +N» بين 0 قديم ورقم لاحق، ولا تلاعب كاذب).
  const cycleCountClassification = classifyCycleCount(readBatteryHealthOnly(fingerprint).cycleCount);
  sig.battery = {
    designCapacityMah: typeof battH.designCapacityMah === "number" ? battH.designCapacityMah : null,
    cycleCount: cycleCountClassification === null && typeof battH.cycleCount === "number" ? battH.cycleCount : null,
    ...(cycleCountClassification === null ? {} : {cycleCountClassification}),
    voltageStabilityMv: typeof battH.voltageStabilityMv === "number" ? battH.voltageStabilityMv : null,
    dischargeRateUnderLoadMa: typeof battH.dischargeRateUnderLoadMa === "number" ?
        battH.dischargeRateUnderLoadMa : null,
    batteryTempRiseC: typeof battH.batteryTempRiseC === "number" ? battH.batteryTempRiseC : null,
  };

  // V6 reevaluation — manual test outcomes per testId (pass/fail/not_tested).
  // Compared DIRECTIONALLY by reevaluationDecision. not_tested is preserved as
  // an explicit third state (never merged with fail).
  sig.manual = {};
  const manualResults = fingerprint?.manualResults || [];
  for (const r of manualResults) {
    if (r && typeof r.testId === "string" && typeof r.status === "string") {
      sig.manual[r.testId] = r.status;
    }
  }

  return sig;
}

module.exports = {computeScanSignature};
