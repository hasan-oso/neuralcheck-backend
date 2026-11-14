'use strict';

// reportShapeShared.test.js — الوحدة المشتركة وحارس Gemini
// (fix/json-repair-shape-guard).
//
// سبب وجود هذا الملف ثغرةٌ سبّبها التكرار: كان مسار التحليل/الإصلاح مكتوباً
// مرّتين — في callDeepSeek وفي callGemini — متطابقين حرفاً بحرف. فلمّا حُرس
// الأول بقي الثاني مكشوفاً، وهو الذي كان يُطلق أكثر: من ستّ حوادث إصلاح في
// ثلاثين يوماً مرّت أربعٌ عبر Gemini واثنتان عبر DeepSeek.
//
// لذلك أهمّ اختبار هنا ليس أن كلّ حارس يعمل، بل أن الحارسين **لا يختلفان**.
//
// مفاتيح النقص في القسم 2 ليست مخترعة: هي قوائم keys= الحقيقية من سجلّ
// الإنتاج، السليمة منها والمبتورة.
//
// Run: node functions/test/reportShapeShared.test.js

const assert = require('assert');

const {
  REPORT_SHAPE_KEYS, CORE_KEY_GROUPS,
  looksLikeReport, describeShape, resolveReport, missingCoreKeys,
} = require('../src/analysis/reportShape');

const dsGuard = require('../src/analysis/callDeepSeek').ensureReportShape;
const {DeepSeekError} = require('../src/analysis/callDeepSeek');
const gmGuard = require('../src/analysis/callGemini').ensureReportShape;
const {GeminiError} = require('../src/analysis/callGemini');

// ─── كتم السجلّ ───────────────────────────────────────────────────────
const logged = [];
const real = {warn: console.warn, error: console.error, log: console.log};
/** يكتم السجلّ ويجمعه. */
function mute() {
  console.warn = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  console.log = (...a) => logged.push(a.join(' '));
}
/** يُعيد السجلّ. */
function unmute() {
  console.warn = real.warn;
  console.error = real.error;
  console.log = real.log;
}
/** ينفّذ ويلتقط. @param {Function} fn الدالة @return {*} الخطأ أو null */
function caught(fn) {
  try {
    fn(); return null;
  } catch (e) {
    return e;
  }
}

// قوائم المفاتيح الحقيقية من سجلّ الإنتاج (30 يوماً).
const HEALTHY_KEYS = ['reasoning_trace', 'grade', 'score', 'shortId',
  'deviceMarketingName', 'aiModel', 'isFreeTrial', 'summary', 'details',
  'verdict', 'rootCause', 'issues', 'predictedProblems', 'categoryScores',
  'buyerAdvice', 'performanceContext', 'changeAnalysis'];

/** يبني كائناً من قائمة مفاتيح. @param {string[]} keys المفاتيح
 * @return {Object} الكائن */
function objOf(keys) {
  const o = {};
  for (const k of keys) o[k] = 'x';
  return o;
}

// ─── 1. الحدّ الأدنى ──────────────────────────────────────────────────
{
  assert.ok(looksLikeReport({grade: 'A'}));
  assert.ok(looksLikeReport({overallGrade: 'A'}), 'V3 naming');
  assert.ok(looksLikeReport({summary: 'x'}));
  assert.ok(looksLikeReport({category_scores: {}}), 'snake_case');
  assert.ok(looksLikeReport({grade: null}), 'presence, not value');
  assert.ok(!looksLikeReport({error: 'x'}));
  assert.ok(!looksLikeReport([{grade: 'A'}]), 'an array is not a report');
  assert.ok(!looksLikeReport(null));
  assert.ok(!looksLikeReport('str'));
  for (const k of ['grade', 'overallGrade', 'score', 'overallScore',
    'summary', 'category_scores', 'categoryScores']) {
    assert.ok(REPORT_SHAPE_KEYS.includes(k), `minimum must name ${k}`);
  }
}

// ─── 2. المفاتيح الناقصة — بقوائم الإنتاج الحقيقية ───────────────────
{
  // الاستجابة السليمة: لا نقص.
  assert.deepStrictEqual(missingCoreKeys(objOf(HEALTHY_KEYS)), [],
      'a healthy production response must show no missing core keys');

  // 2026-09-05 21:31 — انقطع بعد categoryScores.
  assert.deepStrictEqual(
      missingCoreKeys(objOf(HEALTHY_KEYS.slice(0, 14))),
      ['buyerAdvice', 'performanceContext']);

  // 2026-09-11 15:16 — انقطع بعد rootCause.
  assert.deepStrictEqual(
      missingCoreKeys(objOf(HEALTHY_KEYS.slice(0, 11))),
      ['issues', 'predictedProblems', 'categoryScores', 'buyerAdvice',
        'performanceContext']);

  // 2026-09-11 17:23 — انقطع بعد verdict.
  assert.deepStrictEqual(
      missingCoreKeys(objOf(HEALTHY_KEYS.slice(0, 10))),
      ['issues', 'predictedProblems', 'categoryScores', 'buyerAdvice',
        'performanceContext']);

  // 2026-09-11 17:53 و 2026-09-13 12:03 — انقطعا بعد details.
  assert.deepStrictEqual(
      missingCoreKeys(objOf(HEALTHY_KEYS.slice(0, 9))),
      ['verdict', 'issues', 'predictedProblems', 'categoryScores',
        'buyerAdvice', 'performanceContext']);

  // الصيغة الثانية مقبولة: V3 يسمّي بالشرطة السفلية.
  assert.deepStrictEqual(missingCoreKeys({
    summary: 'x', details: 'x', verdict: 'x', issues: [],
    predicted_problems: [], category_scores: {}, buyer_advice: {},
    performance_context: {},
  }), [], 'snake_case aliases must satisfy the core groups');

  // مصفوفة أعطال فارغة جواب مشروع، لا نقص.
  const full = objOf(HEALTHY_KEYS);
  full.issues = [];
  assert.deepStrictEqual(missingCoreKeys(full), [],
      'an empty issues array is an answer, not an absence');

  // ما استُبعد عمداً لا يرفع الراية.
  for (const k of ['rootCause', 'changeAnalysis', 'reasoning_trace',
    'shortId', 'aiModel', 'isFreeTrial', 'deviceMarketingName']) {
    assert.ok(!CORE_KEY_GROUPS.some((g) => g.includes(k)),
        `${k} must NOT be a core key (nullable or server-owned)`);
  }
  assert.strictEqual(CORE_KEY_GROUPS.length, 8);
}

// ─── 3. resolveReport يصف قراره ──────────────────────────────────────
{
  const report = {grade: 'B+', summary: 's'};
  const r1 = resolveReport([report, 'changeAnalysis', ':null']);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.report, report);
  assert.strictEqual(r1.extractedFrom, 0);
  assert.strictEqual(r1.discarded, 2);
  assert.ok(r1.matched.includes('grade'));

  const r2 = resolveReport(report);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.extractedFrom, null, 'no extraction for a plain object');

  const r3 = resolveReport(['a', 'b']);
  assert.strictEqual(r3.ok, false);
  assert.ok(r3.shape.includes('type=array len=2'));

  // التقرير قد لا يكون العنصر الأول.
  const r4 = resolveReport(['junk', report]);
  assert.strictEqual(r4.extractedFrom, 1);
  assert.strictEqual(r4.report, report);

  assert.ok(describeShape(report).includes('keyCount=2'));
}

// ─── 4. حارس Gemini: يرفض بنوعه هو ───────────────────────────────────
{
  const err = caught(() => gmGuard({error: 'refused'}, 'repair', {}));
  assert.ok(err instanceof GeminiError, 'Gemini must throw GeminiError');
  assert.strictEqual(err.kind, 'shape_invalid');
  assert.ok(err.message.startsWith('Gemini '), 'message must name the provider');

  // الاستخلاص يعمل هنا أيضاً — بنفس النتيجة.
  mute();
  const out = gmGuard([{grade: 'A', summary: 's'}, 'x'], 'repair', {});
  unmute();
  assert.strictEqual(out.grade, 'A');
  assert.ok(logged.some((l) => l.includes('[gemini]') &&
      l.includes('extracting')), 'Gemini must log its extraction');
  logged.length = 0;
}

// ─── 5. الحارسان لا يختلفان — هذا هو جوهر الإصلاح ────────────────────
{
  // نفس المدخلات على المزوّدين. القرار يجب أن يتطابق دائماً؛ الاختلاف
  // الوحيد المسموح هو نوع الخطأ وسابقة السجلّ.
  const cases = [
    ['incident array', [{grade: 'B+', summary: 's'}, 'changeAnalysis', ':null']],
    ['plain report', {grade: 'A', score: 90, summary: 's'}],
    ['V3 report', {overallGrade: 'B', overallScore: 70}],
    ['truncated but usable', objOf(HEALTHY_KEYS.slice(0, 9))],
    ['shapeless object', {error: 'x', detail: 'y'}],
    ['array with no report', ['changeAnalysis', ':null', 7]],
    ['null', null],
    ['string', 'nope'],
    ['empty object', {}],
  ];

  for (const [name, input] of cases) {
    mute();
    const dsErr = caught(() => dsGuard(input, 'repair', {}));
    const gmErr = caught(() => gmGuard(input, 'repair', {}));
    unmute();
    logged.length = 0;

    assert.strictEqual(dsErr === null, gmErr === null,
        `providers disagree on accept/reject for: ${name}`);

    if (dsErr === null) {
      mute();
      const a = dsGuard(input, 'repair', {});
      const b = gmGuard(input, 'repair', {});
      unmute();
      logged.length = 0;
      assert.strictEqual(a, b,
          `providers extracted different objects for: ${name}`);
    } else {
      assert.strictEqual(dsErr.kind, gmErr.kind,
          `providers disagree on error kind for: ${name}`);
      assert.strictEqual(dsErr.kind, 'shape_invalid');
      // الفارق المسموح الوحيد: DeepSeek يُعيد المحاولة، Gemini هو الأخير.
      assert.strictEqual(dsErr.retryable, true,
          'DeepSeek rejection must feed the existing retry');
      assert.strictEqual(gmErr.retryable, undefined,
          'Gemini has no retry tier — rejection is terminal by design');
    }
  }
}

// ─── 6. النقص يُسجَّل عند المزوّدين، ولا يمنع القبول ──────────────────
{
  const truncated = objOf(HEALTHY_KEYS.slice(0, 9));
  for (const [tag, guard] of [['deepseek', dsGuard], ['gemini', gmGuard]]) {
    mute();
    const out = guard(truncated, 'repair', {});
    unmute();
    assert.strictEqual(out, truncated, `${tag} must still accept it`);
    const line = logged.find((l) => l.includes('INCOMPLETE'));
    assert.ok(line, `${tag} must log the incompleteness`);
    assert.ok(line.includes(`[${tag}]`), 'log must carry the provider prefix');
    assert.ok(line.includes('categoryScores') && line.includes('issues'),
        'the log must NAME the missing keys, not just count them');
    logged.length = 0;
  }
}

console.log('reportShapeShared: 6/6 sections passed');
