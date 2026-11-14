'use strict';

// postProcessing.test.js — verifies the V5 post-processing helpers exported
// from callAI.js: promoteCategoryGrades + applySeverityPenalty.
//
// Both helpers mutate the parsed object in place and return a summary.
// These tests pass synthetic parsed objects so we exercise the rules
// without hitting the AI providers.

const assert = require('assert');
const {
  promoteCategoryGrades,
  applySeverityPenalty,
} = require('../src/analysis/callAI');

// ─── 1. cellular grade "?" with pass=5/5 → stays "?" (trust AI) ──────────
// Was: promotion mapped 5/5 → "A". V6 reason for backing off: the AI is
// now explicitly instructed to use "?" only when no test data exists, so
// a "?" verdict is meaningful and should not be rewritten in the backend.
{
  const parsed = {
    categoryScores: {
      cellular: {grade: '?', pass_count: 5, total_count: 5, score: 100, note: ''},
    },
  };
  const promoted = promoteCategoryGrades(parsed);
  assert.strictEqual(promoted, 0, 'expected 0 promotions — "?" is preserved');
  assert.strictEqual(parsed.categoryScores.cellular.grade, '?',
      `expected "?" preserved, got "${parsed.categoryScores.cellular.grade}"`);
}

// ─── 2. cellular grade "?" with pass=4/5 → stays "?" ─────────────────────
{
  const parsed = {
    categoryScores: {
      cellular: {grade: '?', pass_count: 4, total_count: 5, score: 80, note: ''},
    },
  };
  const promoted = promoteCategoryGrades(parsed);
  assert.strictEqual(promoted, 0, 'expected 0 promotions — "?" is preserved');
  assert.strictEqual(parsed.categoryScores.cellular.grade, '?',
      `expected "?" preserved for 4/5, got "${parsed.categoryScores.cellular.grade}"`);
}

// ─── 3. cellular grade "?" with pass=0/5 → stays "?" ─────────────────────
{
  const parsed = {
    categoryScores: {
      cellular: {grade: '?', pass_count: 0, total_count: 5, score: 0, note: ''},
    },
  };
  const promoted = promoteCategoryGrades(parsed);
  assert.strictEqual(promoted, 0, 'expected 0 promotions for pass=0');
  assert.strictEqual(parsed.categoryScores.cellular.grade, '?',
      'pass=0 should remain "?" (legit)');
}

// ─── 4. GPS permission-denied regression: 1/3 testable → stays "?" ───────
// Mirror of the production bug: AI returned grade "?" because location
// permission was denied (L-01 passed, L-02 + L-03 marked not_tested).
// Old logic mapped 1/3 = 33% → D, punishing the user for permission denial.
// New logic must preserve "?" since not_tested ≠ failed (ISO 25010 / OWASP).
{
  const parsed = {
    categoryScores: {
      gps: {grade: '?', pass_count: 1, total_count: 3, score: 33,
        note: 'permission denied; only L-01 tested'},
    },
  };
  const promoted = promoteCategoryGrades(parsed);
  assert.strictEqual(promoted, 0, 'expected 0 promotions for permission-denied');
  assert.strictEqual(parsed.categoryScores.gps.grade, '?',
      'permission-denied "?" must be preserved (not_tested ≠ failed)');
}

// ─── 5. GPS variant with already-filtered counts: 1/1 + "?" → stays "?" ──
// When the AI honestly reports only testable tests (pass=1, total=1) but
// is still unsure enough to emit "?", we honor that. The old rule would
// have promoted to A (100%) — overruling the AI silently.
{
  const parsed = {
    categoryScores: {
      gps: {grade: '?', pass_count: 1, total_count: 1, score: 100,
        note: 'L-02/L-03 not_tested due to permission'},
    },
  };
  const promoted = promoteCategoryGrades(parsed);
  assert.strictEqual(promoted, 0, 'expected 0 promotions — "?" is preserved');
  assert.strictEqual(parsed.categoryScores.gps.grade, '?',
      '"?" preserved even at 100% ratio (AI judgment trusted)');
}

// ─── 4. score 67 with 1 critical + 1 danger → 47, grade "D" ──────────────
{
  const parsed = {
    score: 67,
    grade: 'C',
    issues: [
      {severity: 'critical', title: 'root detected'},
      {severity: 'danger', title: 'thermal cooling failure'},
      {severity: 'high', title: 'CPU throttling'},
    ],
  };
  const result = applySeverityPenalty(parsed);
  assert.strictEqual(result.oldScore, 67);
  assert.strictEqual(result.criticals, 1);
  assert.strictEqual(result.dangers, 1);
  assert.strictEqual(result.penalty, 20, '1*15 + 1*5 = 20');
  assert.strictEqual(result.newScore, 47);
  assert.strictEqual(parsed.score, 47, 'score mutated in place');
  assert.strictEqual(parsed.grade, 'D', '47 < 55 → D');
  assert.strictEqual(result.newGrade, 'D');
}

// ─── 5. score 85 with 0 critical/danger → unchanged ──────────────────────
{
  const parsed = {
    score: 85,
    grade: 'A',
    issues: [
      {severity: 'info', title: 'all good'},
      {severity: 'warning', title: 'minor wear'},
    ],
  };
  const result = applySeverityPenalty(parsed);
  assert.strictEqual(result.penalty, 0, 'no critical/danger → no penalty');
  assert.strictEqual(result.newScore, 85, 'score unchanged');
  assert.strictEqual(parsed.score, 85, 'parsed.score unchanged');
  assert.strictEqual(parsed.grade, 'A', 'grade unchanged');
}

// ─── cache padding tests (formerly 8, 9, 10) — REMOVED (P0.5) ────────────
// padCacheHitToTarget/CACHED_RESPONSE_TARGET_MS were deleted from
// runAnalysisInternal.js: a cache hit no longer sleeps to fake a 45s
// analysis duration (S§2.7; the padding made a reused old report look
// like a fresh one — A79). Cache-hit behavior (reuse gated by the
// settings/cache.reuseEnabled flag, cachePaddingMs now permanently
// absent, reusedFromScanId now present) is covered end-to-end in
// functions/test/cacheReuseFlag.test.js, not here — this file is scoped
// to promoteCategoryGrades/applySeverityPenalty per its header above.

console.log('postProcessing: 7/7 tests passed');

