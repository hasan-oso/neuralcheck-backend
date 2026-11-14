// ===================================================
// reevaluationDecision — قرار إعادة التقييم موجَّه-للعيب + اتجاهي
// ===================================================
// مستقلّ عن signatureDifference التجميعي. يفرض تحليلاً جديداً عند ظهور عيب
// مفرد واضح تبتلعه عتبة النسبة (مثل criticalDefectDetected = 2/43 ≈ 4.7% < 20%).
//
// المدخلات: newSig, oldSig (مخرجات computeScanSignature، يشملان الآن
//   verification + functional + battery + manual).
// المخرج: { forceReevaluate: bool, reasons: string[], maintenanceSuspected: bool }
//
// ملاحظة على وقائع التحقّق: cpuPrimeSieveCorrect/memoryMarchPassed/
//   memoryWalkingOnesPassed/gpuComputeGemmCorrect حتمية (لا تذبذب) → فشلها بعد
//   نجاح = خلل عتاد حقيقي. stressPassed مُدرَج حسب القرار، لكنه الأقلّ حتميةً
//   (يعتمد على سلوك الـ governor/الحرارة وقت الفحص) → أوّل مرشَّح للإزالة لو
//   ظهرت إنذارات كاذبة.

// وقائع verification منطقية: true = ناجح. pass→fail = عيب جديد. (الأسماء من fv68Names — القاعدة 24؛ والتوقيع يُنتج null لما لم يُقَس
// فلا يُقرأ غيابٌ نجاحاً: pass→fail لا تُطلَق إلا من true صريحة إلى false صريحة.)
const N = require("../analysis/fv68Names");
const V = N.VERIFICATION;
const DETERMINISTIC_BOOLS = [
  V.CPU_PRIME_SIEVE_CORRECT_LEGACY,
  V.MEMORY_MARCH_PASSED_LEGACY,
  V.MEMORY_WALKING_ONES_PASSED_LEGACY,
  V.GPU_COMPUTE_GEMM_CORRECT,
  "stressPassed", // الأقلّ حتميةً — انظر الملاحظة أعلاه
];

// عدّادات أخطاء: ارتفاع (خاصةً 0 → موجب) = خطأ عتاد جديد. والغائب (null) لا يُقرأ صفراً: عدّاد جديد موجب بلا سابق يُبلَّغ
// «غائب→n» (عيب ظهر قياسه)، وعدّاد جديد غائب لا يُقارَن (لم يُقَس).
const ERROR_COUNTERS = [
  V.CPU_FMA_ERRORS_LEGACY,
  V.MEMORY_RANDOM_VERIFY_ERRORS,
  V.STORAGE_WRITE_VERIFY_ERRORS,
  V.STORAGE_READ_VERIFY_ERRORS,
  "cpuKnownAnswerMismatches", // fv68 (ت-20): فحوص النتيجة المعروفة مسبقاً غير المطابقة
];

// عتبات البطارية — مبدئية قابلة للضبط (PRELIMINARY — tune with production data).
// مبنية على سلوك تدهور الليثيوم + تجنّب الإنذارات الكاذبة على التذبذب الطبيعي.
const BATTERY_THRESHOLDS = {
  // designCapacityMah ثابت مصنعي (ليس تدهوراً): أي تغيّر ملموس = بطارية مستبدَلة.
  // نسبة 5% تتسامح مع ضوضاء الـ reflection فقط.
  designCapacityRelChange: 0.05,
  // cycleCount يرتفع مع الاستخدام (تقادم طبيعي، ليس عيباً). قفزة +150 بين فحصين
  // غير متناسبة زمنياً → الأرجح بطارية مستبدَلة بأخرى مستعملة. محافظة.
  cycleCountJump: 150,
  // voltageStabilityMv (انحراف الجهد تحت الحمل): الخلايا المتدهورة تتأرجح أكثر.
  // متذبذب حسب الحمل/الحرارة → نشترط ضعفاً مضاعفاً وزيادة مطلقة ≥80mV معاً.
  voltageStabilityRatio: 2.0,
  voltageStabilityAbsMv: 80,
  // dischargeRateUnderLoadMa يعتمد على شدّة الحمل (متذبذب) → عتبة عالية 60%.
  // أعلى خطر إنذار كاذب — قابل للتعطيل بعد الضبط.
  dischargeRateRelWorse: 0.60,
  // batteryTempRiseC مُستبعَد عمداً: شديد الاعتماد على البيئة/الحمل (ضوضاء).
};

function num(v) {
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

function reevaluationDecision(newSig, oldSig) {
  const reasons = [];
  let maintenanceSuspected = false;
  if (!newSig || !oldSig) {
    return {forceReevaluate: false, reasons, maintenanceSuspected};
  }

  const nv = newSig.verification || {};
  const ov = oldSig.verification || {};

  // 1) verification: pass→fail لأي اختبار حتمي.
  for (const k of DETERMINISTIC_BOOLS) {
    if (ov[k] === true && nv[k] === false) reasons.push(`verification:${k} pass→fail`);
  }
  // criticalDefectDetected انقلب إلى true.
  if (ov.criticalDefectDetected !== true && nv.criticalDefectDetected === true) {
    reasons.push("verification:criticalDefectDetected →true");
  }
  // عدّادات الأخطاء ارتفعت (0→موجب أو أي زيادة).
  for (const k of ERROR_COUNTERS) {
    const o = num(ov[k]);
    const n = num(nv[k]);
    if (n === null) continue; // لم يُقَس الآن: لا مقارنة ولا صفر مختلَق
    if (o === null) {
      if (n > 0) reasons.push(`verification:${k} absent→${n}`);
      continue;
    }
    if (n > o) reasons.push(`verification:${k} ${o}→${n}`);
  }

  // 2) البطارية (عتبات مبدئية).
  const nb = newSig.battery || {};
  const obat = oldSig.battery || {};
  const odc = num(obat.designCapacityMah);
  const ndc = num(nb.designCapacityMah);
  if (odc && ndc && Math.abs(ndc - odc) / odc > BATTERY_THRESHOLDS.designCapacityRelChange) {
    reasons.push(`battery:designCapacityMah ${odc}→${ndc} (swap?)`);
  }
  const occ = num(obat.cycleCount);
  const ncc = num(nb.cycleCount);
  if (occ !== null && ncc !== null && (ncc - occ) > BATTERY_THRESHOLDS.cycleCountJump) {
    reasons.push(`battery:cycleCount +${ncc - occ}`);
  }
  const ovs = num(obat.voltageStabilityMv);
  const nvs = num(nb.voltageStabilityMv);
  if (ovs && nvs && nvs >= ovs * BATTERY_THRESHOLDS.voltageStabilityRatio &&
      (nvs - ovs) >= BATTERY_THRESHOLDS.voltageStabilityAbsMv) {
    reasons.push(`battery:voltageStabilityMv ${ovs}→${nvs}`);
  }
  const odr = num(obat.dischargeRateUnderLoadMa);
  const ndr = num(nb.dischargeRateUnderLoadMa);
  if (odr && ndr && (ndr - odr) / odr > BATTERY_THRESHOLDS.dischargeRateRelWorse) {
    reasons.push(`battery:dischargeRateUnderLoadMa ${odr}→${ndr}`);
  }

  // 3) الاختبارات اليدوية — اتجاهي (pass/fail/not_tested/unavailable: أربع حالات صريحة؛ و warning خامسة معروفة في تقارير ≤ fv68).
  // not_tested ليست fail: pass→not_tested و *→not_tested و not_tested→pass
  // كلها لا تُطلق إعادة تقييم.
  // **unavailable (الدفعة ١٠، 2026-10-10) حالة رابعة: الفنّي يعلن أن الطراز لا يملك المكوّن** (عقد §٧-ح (أ) :1452) — ليست fail ولا not_tested:
  // كل انتقال منها أو إليها (fail→unavailable، pass→unavailable، unavailable→pass، not_tested↔unavailable) لا يُطلق إعادة تقييم.
  // **إلا unavailable→fail (ق٣، قرار حسن بتفويض 2026-10-22، أمر المستخدم 2026-10-23): مُطلِق رابع** — كان صامتاً منذ الدفعة ١٠ (قبلها كان زرّ «غير متوفر» يكتب
  // not_tested فكان ذلك الانتقال not_tested→fail ويُطلق — عقد §٧-ح :1444، منقول عن التطبيق وغير متحقَّق من مستودعه)؛ فعاد يُطلق: اختبار أعلن الفنّي غياب مكوّنه
  // ثم فشل في الفحص التالي تغيّرٌ يستحقّ إعادة التقييم. والمُطلِقات الأربعة أدناه هي الوحيدة. وإعادة الاستعمال مطفأة افتراضياً:
  // utils/resolveCacheConfig.js DEFAULT_REUSE_ENABLED=false، فلا أثر عملي اليوم.
  const nm = newSig.manual || {};
  const om = oldSig.manual || {};
  for (const testId of Object.keys(nm)) {
    const o = om[testId];
    const n = nm[testId];
    if (o === undefined) continue; // لا حالة سابقة → ليس انتقالاً
    if (o === "pass" && n === "fail") {
      reasons.push(`manual:${testId} pass→fail`);
    } else if (o === "not_tested" && n === "fail") {
      reasons.push(`manual:${testId} not_tested→fail`);
    } else if (o === "unavailable" && n === "fail") {
      reasons.push(`manual:${testId} unavailable→fail`);
    } else if (o === "fail" && n === "pass") {
      reasons.push(`manual:${testId} fail→pass (maintenance?)`);
      maintenanceSuspected = true;
    }
    // غير ذلك (أي انتقال إلى not_tested أو إلى/من unavailable عدا unavailable→fail، أو not_tested→pass): لا إعادة تقييم.
  }

  return {forceReevaluate: reasons.length > 0, reasons, maintenanceSuspected};
}

module.exports = {
  reevaluationDecision,
  DETERMINISTIC_BOOLS,
  ERROR_COUNTERS,
  BATTERY_THRESHOLDS,
};
