'use strict';

// rebuildCategoryScores.test.js — fix/category-grading.
//
// Run: node functions/test/rebuildCategoryScores.test.js
//
// Pins the per-category grading contract after the rewrite:
//   1. No default "A": with no AI grade and no issues, grade follows passRate.
//   2. total_count = 0 → "?" / score 0 / "no tests" note — never a pass letter.
//   3. Coverage trail: not_tested/unavailable are counted and surfaced.
//   4. manualResults enter the counts (categoryName first, legacy testId map).
//   5. 15 categories incl. audio/input; languageValidator shares the list.
//   6. issues[].category normalization (Arabic/Turkish/case) still matches.
//   7. Consistency guard: letter never better than the score band.
//   8. Replay of the production scan 82bc48dc (Gemini truncated → no issues,
//      no categoryScores) — the exact shape that produced "A everywhere".

const assert = require('assert');
const {
  rebuildCategoryScores,
  letterFromScore,
  worseOf,
  enforceConsistency,
  NO_TESTS_NOTE,
} = require('../src/analysis/rebuildCategoryScores');
const {CATEGORIES, normalizeCategory, manualCategoryFor} =
    require('../src/utils/categories');
const {CATEGORY_KEYS, collectTextFields} =
    require('../src/analysis/languageValidator');

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
}

const F = (testId, categoryName, status) => ({testId, categoryName, status});
const M = (testId, status, categoryName) =>
  categoryName === undefined ? {testId, status} : {testId, status, categoryName};

// Every emitted entry must satisfy: letter band ≥ score band (never A with 70).
function assertAllConsistent(cs) {
  for (const [cat, e] of Object.entries(cs)) {
    if (!/^[ABCD]/.test(e.grade)) continue;
    const bandLetter = letterFromScore(e.score);
    const order = {A: 0, B: 1, C: 2, D: 3};
    assert.ok(order[bandLetter] <= order[e.grade[0]],
        `${cat}: grade ${e.grade} is better than its score ${e.score} allows`);
  }
}

// ─── Fixture: production scan 82bc48dc (Samsung Galaxy S10 5G) ──────────
// Reconstructed from the report table (pass/total per category + the named
// failing tests). aiResult mirrors what jsonrepair salvaged from the
// truncated Gemini response: grade/score/summary/details only — NO issues,
// NO categoryScores (Cloud Logging: "[v6][resp] keys=reasoning_trace,grade,
// score,shortId,deviceMarketingName,aiModel,isFreeTrial,summary,details").
const SAMSUNG_FUNCTIONAL = [
  // security 7/10 — SEC-04 root detected = fail, two more non-pass
  F('SEC-01', 'security', 'pass'), F('SEC-02', 'security', 'pass'),
  F('SEC-03', 'security', 'pass'), F('SEC-04', 'security', 'fail'),
  F('SEC-05', 'security', 'pass'), F('SEC-06', 'security', 'pass'),
  F('SEC-07', 'security', 'warning'), F('SEC-08', 'security', 'pass'),
  F('SEC-09', 'security', 'pass'), F('SEC-10', 'security', 'fail'),
  // thermal 0/1 — T-01..T-03 unavailable (cpuTemp missing), one executed fail
  F('T-01', 'thermal', 'unavailable'), F('T-02', 'thermal', 'unavailable'),
  F('T-03', 'thermal', 'unavailable'), F('T-04', 'thermal', 'fail'),
  // battery 6/7 — B-06 discharge rate fail
  F('B-01', 'battery', 'pass'), F('B-02', 'battery', 'pass'),
  F('B-03', 'battery', 'pass'), F('B-04', 'battery', 'pass'),
  F('B-05', 'battery', 'pass'), F('B-06', 'battery', 'fail'),
  F('B-07', 'battery', 'pass'),
  // cpu 6/7 — C-04 fail
  F('C-01', 'cpu', 'pass'), F('C-02', 'cpu', 'pass'), F('C-03', 'cpu', 'pass'),
  F('C-04', 'cpu', 'fail'), F('C-05', 'cpu', 'pass'), F('C-06', 'cpu', 'pass'),
  F('C-07', 'cpu', 'pass'),
  // wireless 5/6 — N-10 warning
  F('N-05', 'wireless', 'pass'), F('N-06', 'wireless', 'pass'),
  F('N-07', 'wireless', 'pass'), F('N-08', 'wireless', 'pass'),
  F('N-09', 'wireless', 'pass'), F('N-10', 'wireless', 'warning'),
  // gpu — G-03..G-05 always not_tested (app phase gate bug)
  F('G-01', 'gpu', 'pass'), F('G-02', 'gpu', 'pass'),
  F('G-03', 'gpu', 'not_tested'), F('G-04', 'gpu', 'not_tested'),
  F('G-05', 'gpu', 'not_tested'),
];
const SAMSUNG_MANUAL = [
  // camera manual tests skipped by the user
  M('M-17', 'not_tested', 'camera'), M('M-18', 'not_tested', 'camera'),
  M('M-19', 'not_tested', 'camera'),
];
const SAMSUNG_AI_TRUNCATED = {
  grade: 'D', score: 45,
  summary: 'ملخص', details: 'تفاصيل',
  issues: [], category_scores: null,
};

console.log('rebuildCategoryScores:');

// ─── 1. No default "A" ───────────────────────────────────────────────────
t('no AI grade + no issues → grade follows passRate, not "A"', () => {
  const cs = rebuildCategoryScores({}, [
    F('SEC-01', 'security', 'pass'), F('SEC-02', 'security', 'pass'),
    F('SEC-03', 'security', 'pass'), F('SEC-04', 'security', 'fail'),
    F('SEC-05', 'security', 'pass'), F('SEC-06', 'security', 'pass'),
    F('SEC-07', 'security', 'pass'), F('SEC-08', 'security', 'fail'),
    F('SEC-09', 'security', 'pass'), F('SEC-10', 'security', 'fail'),
  ], [], {language: 'ar'});
  assert.strictEqual(cs.security.score, 70);
  assert.strictEqual(cs.security.grade, 'B');
  assert.strictEqual(cs.security.grade_source, 'tests');
  assert.strictEqual(cs.security.fail_count, 3);
});

t('passRate → letter thresholds match applySeverityPenalty (85/70/55)', () => {
  assert.strictEqual(letterFromScore(100), 'A');
  assert.strictEqual(letterFromScore(85), 'A');
  assert.strictEqual(letterFromScore(84), 'B');
  assert.strictEqual(letterFromScore(70), 'B');
  assert.strictEqual(letterFromScore(69), 'C');
  assert.strictEqual(letterFromScore(55), 'C');
  assert.strictEqual(letterFromScore(54), 'D');
  assert.strictEqual(letterFromScore(0), 'D');
});

t('one executed failing test (0/1) → D with score 0, never A', () => {
  const cs = rebuildCategoryScores({}, [
    F('T-01', 'thermal', 'unavailable'), F('T-04', 'thermal', 'fail'),
  ], [], {});
  assert.strictEqual(cs.thermal.grade, 'D');
  assert.strictEqual(cs.thermal.score, 0);
  assert.strictEqual(cs.thermal.total_count, 1);
  assert.strictEqual(cs.thermal.unavailable_count, 1);
  assert.strictEqual(cs.thermal.measured, true);
});

// ─── 2. Unmeasured category → "?" ────────────────────────────────────────
t('category with no tests at all → "?", score 0, Arabic note, measured=false', () => {
  const cs = rebuildCategoryScores({}, [], [], {language: 'ar'});
  const c = cs.camera;
  assert.strictEqual(c.grade, '?');
  assert.strictEqual(c.score, 0);
  assert.strictEqual(c.pass_count, 0);
  assert.strictEqual(c.total_count, 0);
  assert.strictEqual(c.measured, false);
  assert.strictEqual(c.grade_source, 'unmeasured');
  assert.strictEqual(c.note, NO_TESTS_NOTE.ar);
});

t('all tests unavailable → "?" (not "fully passed", not "A")', () => {
  const cs = rebuildCategoryScores({}, [
    F('T-01', 'thermal', 'unavailable'), F('T-02', 'thermal', 'unavailable'),
    F('T-03', 'thermal', 'unavailable'),
  ], [], {language: 'tr'});
  assert.strictEqual(cs.thermal.grade, '?');
  assert.strictEqual(cs.thermal.score, 0);
  assert.strictEqual(cs.thermal.total_count, 0);
  assert.strictEqual(cs.thermal.unavailable_count, 3);
  assert.strictEqual(cs.thermal.declared_count, 3);
  assert.strictEqual(cs.thermal.note, NO_TESTS_NOTE.tr);
});

t('AI says "A" for a 0/0 category → still "?", AI letter kept in ai_grade', () => {
  const cs = rebuildCategoryScores({
    category_scores: {camera: {grade: 'A', note: 'الكاميرا سليمة'}},
  }, [], [], {language: 'ar'});
  assert.strictEqual(cs.camera.grade, '?');
  assert.strictEqual(cs.camera.score, 0);
  assert.strictEqual(cs.camera.ai_grade, 'A');
  assert.ok(cs.camera.note.startsWith(NO_TESTS_NOTE.ar));
  assert.ok(cs.camera.note.includes('الكاميرا سليمة'));
});

t('AI "?" for a category with executed tests → grade from passRate', () => {
  const cs = rebuildCategoryScores({
    category_scores: {gps: {grade: '?', note: ''}},
  }, [
    F('L-01', 'gps', 'pass'), F('L-02', 'gps', 'not_tested'),
    F('L-03', 'gps', 'not_tested'),
  ], [], {});
  assert.strictEqual(cs.gps.grade, 'A');
  assert.strictEqual(cs.gps.score, 100);
  assert.strictEqual(cs.gps.total_count, 1);
  assert.strictEqual(cs.gps.not_tested_count, 2);
});

t('V3 sentinel INSUFFICIENT_STRESS_DATA preserved with score -1', () => {
  const cs = rebuildCategoryScores({
    category_scores: {thermal: {grade: 'INSUFFICIENT_STRESS_DATA', verdict: 'x'}},
  }, [F('T-04', 'thermal', 'pass')], [], {});
  assert.strictEqual(cs.thermal.grade, 'INSUFFICIENT_STRESS_DATA');
  assert.strictEqual(cs.thermal.score, -1);
  assert.strictEqual(cs.thermal.measured, false);
  assert.strictEqual(cs.thermal.grade_source, 'ai_sentinel');
});

// ─── 3. Coverage trail ───────────────────────────────────────────────────
t('gpu 2 pass + 3 not_tested → 2/2 but not_tested_count=3, declared_count=5', () => {
  const cs = rebuildCategoryScores({}, SAMSUNG_FUNCTIONAL, [], {});
  const g = cs.gpu;
  assert.strictEqual(g.pass_count, 2);
  assert.strictEqual(g.total_count, 2);
  assert.strictEqual(g.not_tested_count, 3);
  assert.strictEqual(g.excluded_count, 3);
  assert.strictEqual(g.declared_count, 5);
  assert.strictEqual(g.grade, 'A');
  assert.strictEqual(g.score, 100);
});

t('warning counts as executed-but-not-passed and is surfaced', () => {
  const cs = rebuildCategoryScores({}, SAMSUNG_FUNCTIONAL, [], {});
  assert.strictEqual(cs.wireless.pass_count, 5);
  assert.strictEqual(cs.wireless.total_count, 6);
  assert.strictEqual(cs.wireless.warning_count, 1);
  assert.strictEqual(cs.wireless.score, 83);
  assert.strictEqual(cs.wireless.grade, 'B');
});

// ─── 4. manualResults enter the counts ──────────────────────────────────
t('manual audio/input results (with categoryName) are counted', () => {
  const cs = rebuildCategoryScores({}, [], [
    M('M-04', 'pass', 'audio'), M('M-05', 'pass', 'audio'),
    M('M-06', 'fail', 'audio'), M('M-08', 'not_tested', 'audio'),
    M('M-09', 'pass', 'input'), M('M-10', 'pass', 'input'),
    M('M-11', 'pass', 'input'),
  ], {});
  assert.strictEqual(cs.audio.pass_count, 2);
  assert.strictEqual(cs.audio.total_count, 3);
  assert.strictEqual(cs.audio.not_tested_count, 1);
  assert.strictEqual(cs.audio.declared_count, 4);
  assert.strictEqual(cs.audio.grade, 'C'); // 67%
  assert.strictEqual(cs.input.pass_count, 3);
  assert.strictEqual(cs.input.total_count, 3);
  assert.strictEqual(cs.input.grade, 'A');
});

t('legacy manual results without categoryName fall back to the testId map', () => {
  const cs = rebuildCategoryScores({}, [], [
    M('M-01', 'pass'), M('M-02', 'fail'),           // display
    M('M-20', 'pass'), M('M-21', 'not_tested'),     // security
    M('M-17', 'pass'),                              // camera
    M('M-99', 'pass'),                              // unknown → dropped
  ], {});
  assert.strictEqual(cs.display.total_count, 2);
  assert.strictEqual(cs.display.fail_count, 1);
  assert.strictEqual(cs.security.total_count, 1);
  assert.strictEqual(cs.security.not_tested_count, 1);
  assert.strictEqual(cs.camera.grade, 'A');
  assert.strictEqual(cs.camera.total_count, 1);
  assert.strictEqual(manualCategoryFor({testId: 'M-99', status: 'pass'}), null);
});

t('manual + functional merge into one bucket (security)', () => {
  const cs = rebuildCategoryScores({}, [
    F('SEC-01', 'security', 'pass'), F('SEC-04', 'security', 'fail'),
  ], [
    M('M-20', 'pass', 'security'), M('M-21', 'pass', 'security'),
  ], {});
  assert.strictEqual(cs.security.pass_count, 3);
  assert.strictEqual(cs.security.total_count, 4);
  assert.strictEqual(cs.security.score, 75);
  assert.strictEqual(cs.security.grade, 'B');
});

t('not_tested manual test does not certify and does not fail (skipped = neutral)', () => {
  const cs = rebuildCategoryScores({}, [], [
    M('M-09', 'not_tested', 'input'), M('M-10', 'not_tested', 'input'),
    M('M-11', 'not_tested', 'input'),
  ], {});
  assert.strictEqual(cs.input.grade, '?');
  assert.strictEqual(cs.input.total_count, 0);
  assert.strictEqual(cs.input.not_tested_count, 3);
});

// ─── 5. 15 categories, single source ────────────────────────────────────
t('output has exactly the 15 shared categories incl. audio + input', () => {
  const cs = rebuildCategoryScores({}, [], [], {});
  assert.deepStrictEqual(Object.keys(cs), CATEGORIES);
  assert.strictEqual(CATEGORIES.length, 15);
  assert.ok(CATEGORIES.includes('audio') && CATEGORIES.includes('input'));
});

t('languageValidator uses the same list and leak-checks audio/input notes', () => {
  assert.strictEqual(CATEGORY_KEYS, CATEGORIES);
  const fields = collectTextFields({
    categoryScores: {audio: {note: 'Speaker crackle'}, input: {note: 'زر سليم'}},
  });
  const paths = fields.map((f) => f.path);
  assert.ok(paths.includes('categoryScores.audio.note'));
  assert.ok(paths.includes('categoryScores.input.note'));
});

// ─── 6. issues[].category normalization ──────────────────────────────────
t('normalizeCategory accepts Arabic / Turkish / case / spacing variants', () => {
  assert.strictEqual(normalizeCategory('security'), 'security');
  assert.strictEqual(normalizeCategory(' Security '), 'security');
  assert.strictEqual(normalizeCategory('الأمان'), 'security');
  assert.strictEqual(normalizeCategory('güvenlik'), 'security');
  assert.strictEqual(normalizeCategory('البطارية'), 'battery');
  assert.strictEqual(normalizeCategory('معالج الرسوميات'), 'gpu');
  assert.strictEqual(normalizeCategory('الشبكة الخلوية'), 'cellular');
  assert.strictEqual(normalizeCategory('Wi-Fi'), 'wireless');
  assert.strictEqual(normalizeCategory('الصوت'), 'audio');
  assert.strictEqual(normalizeCategory('الأزرار'), 'input');
  assert.strictEqual(normalizeCategory('verification'), null);
  assert.strictEqual(normalizeCategory(''), null);
  assert.strictEqual(normalizeCategory(null), null);
});

t('translated issue category still lowers the category (fallback path)', () => {
  const funcs = [
    F('SEC-01', 'security', 'pass'), F('SEC-02', 'security', 'pass'),
    F('SEC-03', 'security', 'pass'), F('SEC-04', 'security', 'fail'),
  ];
  const issues = [{severity: 'critical', category: 'الأمان', title: 'الجهاز مروَّت'}];
  const cs = rebuildCategoryScores({issues}, funcs, [], {});
  assert.strictEqual(cs.security.grade, 'D');
  assert.strictEqual(cs.security.score, 40);
  assert.strictEqual(cs.security.grade_source, 'issues');
  assert.strictEqual(cs.security.note, 'الجهاز مروَّت');
});

t('translated categoryScores keys from the AI are still matched', () => {
  const cs = rebuildCategoryScores({
    categoryScores: {'البطارية': {grade: 'C', note: 'تدهور'}},
  }, [
    F('B-01', 'battery', 'pass'), F('B-02', 'battery', 'pass'),
    F('B-03', 'battery', 'pass'), F('B-04', 'battery', 'pass'),
  ], [], {});
  assert.strictEqual(cs.battery.grade, 'C');
  assert.strictEqual(cs.battery.score, 69); // capped to the C band
  assert.strictEqual(cs.battery.grade_source, 'ai');
});

t('categoryScores emitted as an array is ignored (fallback path, no crash)', () => {
  const cs = rebuildCategoryScores({category_scores: [{grade: 'A'}]},
      [F('C-01', 'cpu', 'pass')], [], {});
  assert.strictEqual(cs.cpu.grade, 'A');
  assert.strictEqual(cs.cpu.grade_source, 'tests');
});

// ─── 7. Consistency guard ────────────────────────────────────────────────
t('AI "A" over 7/10 with a fail is capped to the tests band (B, ai_grade kept)', () => {
  const cs = rebuildCategoryScores({
    category_scores: {security: {grade: 'A', verdict: 'ممتاز'}},
  }, SAMSUNG_FUNCTIONAL, [], {});
  assert.strictEqual(cs.security.grade, 'B');
  assert.strictEqual(cs.security.score, 70);
  assert.strictEqual(cs.security.ai_grade, 'A');
  assert.strictEqual(cs.security.grade_source, 'tests');
  assert.strictEqual(cs.security.note, 'ممتاز');
});

t('AI can lower below the tests band (expert judgment) and score follows', () => {
  const cs = rebuildCategoryScores({
    category_scores: {battery: {grade: 'D', verdict: 'خلية متدهورة'}},
  }, SAMSUNG_FUNCTIONAL, [], {});
  assert.strictEqual(cs.battery.grade, 'D');
  assert.strictEqual(cs.battery.score, 54);
  assert.strictEqual(cs.battery.grade_source, 'ai');
  assert.strictEqual(cs.battery.ai_grade, undefined);
});

t('AI +/- suffix preserved when its band agrees with the tests', () => {
  const cs = rebuildCategoryScores({
    category_scores: {cpu: {grade: 'A-', verdict: ''}},
  }, [F('C-01', 'cpu', 'pass'), F('C-02', 'cpu', 'pass')], [], {});
  assert.strictEqual(cs.cpu.grade, 'A-');
  assert.strictEqual(cs.cpu.score, 100);
});

t('worseOf / enforceConsistency helpers', () => {
  assert.strictEqual(worseOf('A', 'B'), 'B');
  assert.strictEqual(worseOf('D', 'B+'), 'D');
  assert.strictEqual(worseOf('A-', 'A'), 'A-');
  assert.strictEqual(worseOf('F', 'D'), 'F');
  const e = enforceConsistency({grade: 'A', score: 70});
  assert.strictEqual(e.grade, 'B');
  assert.strictEqual(e.reconciled, true);
  const ok = enforceConsistency({grade: 'C', score: 90});
  assert.strictEqual(ok.grade, 'C'); // harsher letter allowed
  assert.strictEqual(ok.reconciled, undefined);
  const q = enforceConsistency({grade: '?', score: 0});
  assert.strictEqual(q.grade, '?');
});

// ─── 8. Production replay: scan 82bc48dc, truncated Gemini response ──────
t('replay 82bc48dc: no category is "A" with a score under 85 anymore', () => {
  const cs = rebuildCategoryScores(SAMSUNG_AI_TRUNCATED, SAMSUNG_FUNCTIONAL,
      SAMSUNG_MANUAL, {language: 'ar'});
  assertAllConsistent(cs);

  assert.deepStrictEqual(
      [cs.security.grade, cs.security.score, cs.security.pass_count, cs.security.total_count],
      ['B', 70, 7, 10]);
  assert.deepStrictEqual(
      [cs.thermal.grade, cs.thermal.score, cs.thermal.total_count, cs.thermal.unavailable_count],
      ['D', 0, 1, 3]);
  assert.deepStrictEqual(
      [cs.camera.grade, cs.camera.score, cs.camera.total_count, cs.camera.not_tested_count],
      ['?', 0, 0, 3]);
  assert.strictEqual(cs.camera.note, NO_TESTS_NOTE.ar);
  assert.deepStrictEqual([cs.battery.grade, cs.battery.score], ['A', 86]);
  assert.deepStrictEqual([cs.cpu.grade, cs.cpu.score], ['A', 86]);
  assert.deepStrictEqual([cs.wireless.grade, cs.wireless.score], ['B', 83]);
  assert.deepStrictEqual(
      [cs.gpu.grade, cs.gpu.score, cs.gpu.total_count, cs.gpu.not_tested_count, cs.gpu.declared_count],
      ['A', 100, 2, 3, 5]);
  // Categories with nothing at all in this scan are "?" not "A".
  for (const cat of ['display', 'memory', 'storage', 'gps', 'sensors', 'cellular', 'audio', 'input']) {
    assert.strictEqual(cs[cat].grade, '?', `${cat} should be "?"`);
    assert.strictEqual(cs[cat].score, 0);
  }
  // The overall grade is NOT touched by this module.
  assert.strictEqual(SAMSUNG_AI_TRUNCATED.grade, 'D');
  assert.strictEqual(SAMSUNG_AI_TRUNCATED.score, 45);
});

t('legacy 2-arg call signature still works (manualResults/options optional)', () => {
  const cs = rebuildCategoryScores({}, [F('C-01', 'cpu', 'pass')]);
  assert.strictEqual(cs.cpu.grade, 'A');
  assert.strictEqual(cs.camera.note, NO_TESTS_NOTE.ar);
});

console.log(`rebuildCategoryScores: ${passed}/${passed} tests passed`);
