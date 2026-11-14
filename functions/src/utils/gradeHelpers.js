// Grade Helpers — أدوات حساب الدرجات
// (currently unused dead code from pre-V3 era — preserved here for now;
// flagged for cleanup in HARDENING_REPORT.md)

const GRADE_RANK = {"A": 4, "B": 3, "C": 2, "D": 1};

function isBetterThan(g1, g2) {
  return GRADE_RANK[g1] > GRADE_RANK[g2];
}

function isWorseThan(g1, g2) {
  return GRADE_RANK[g1] < GRADE_RANK[g2];
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getTestValue(funcResults, testId, expectedUnit) {
  const test = funcResults.find((t) => t.testId === testId);
  if (!test || test.status === "not_tested" || test.status === "unavailable") {
    return null;
  }
  const value = parseFloat(test.rawValue);
  if (isNaN(value)) return null;
  return value;
}

module.exports = {GRADE_RANK, isBetterThan, isWorseThan, clampScore, getTestValue};
