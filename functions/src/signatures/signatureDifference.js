// ===================================================
// signatureDifference — مقارنة signatures (0..1)
// ===================================================
// V2 fix #44: signature أبسط، يحوي فقط verification + functional.
// لا حاجة لتقريب أو tolerance على peaks (لم تعد موجودة).
// 0 = متطابق تماماً (لا تغيّر)
// 1 = مختلف تماماً
function signatureDifference(sigA, sigB) {
  if (!sigA || !sigB) return 1.0;

  // V4 hardening: pipelineVersion is a hard gate. Any mismatch (e.g. cached
  // v3 sig vs new v4 sig) is treated as a fully different scan so the AI is
  // re-invoked on the next call instead of returning stale aiResponse.
  if (sigA.pipelineVersion !== sigB.pipelineVersion) return 1.0;

  let totalChecks = 0;
  let diffCount = 0;

  // Verification — وزن مضاعف (تغيّر = عيب جديد)
  const vKeys = Object.keys(sigA.verification || {});
  for (const k of vKeys) {
    totalChecks += 2;
    if (sigA.verification?.[k] !== sigB.verification?.[k]) {
      diffCount += 2;
    }
  }

  // Functional — وزن عادي
  const fKeys = Object.keys(sigA.functional || {});
  for (const k of fKeys) {
    totalChecks += 1;
    if (sigA.functional?.[k] !== sigB.functional?.[k]) {
      diffCount += 1;
    }
  }

  return totalChecks > 0 ? diffCount / totalChecks : 0;
}

module.exports = {signatureDifference};
