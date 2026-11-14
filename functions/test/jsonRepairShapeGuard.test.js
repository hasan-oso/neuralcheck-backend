'use strict';

// jsonRepairShapeGuard.test.js — حارس شكل مخرَج jsonrepair
// (fix/json-repair-shape-guard).
//
// الحادثة التي وُلد منها هذا الملف: الفحص 629485e9-1620-4059-9896-82ef4a6b0c97.
// أنهى DeepSeek توليده بإرادته (finish=stop، لا بتر)، لكنه أغلق الكائن الجذري
// قبل مفتاح واحد من نهايته. فصار النصّ:
//
//     {…التقرير الكامل…},"changeAnalysis":null}
//                       ^ آخر JSON صالح عند 10821، ثم 23 محرفاً زائدة
//
// JSON.parse رفض. jsonrepair لم يفشل — لفّ القيم العليا الثلاث في مصفوفة
// [التقرير, "changeAnalysis", ":null"]. الكود سجّل "repair succeeded" ومضى،
// فقرأ parsed.summary فوجد undefined، فكتب C/50 فوق تقرير كامل كان موجوداً
// سليماً في parsed[0].
//
// كل حالة هنا تُثبت ضلعاً من الإصلاح:
//   1-4  الحارس نفسه: الاستخلاص، والمرور، والرفض بنوعَيه
//   5-7  ما لا يجوز أن يُرفض (V3) وما لا يجوز أن يُقبل (غير الكائنات)
//   8    describeShape — السطر الذي كان سيكشف الحادثة لحظة وقوعها
//   9-10 المسار الكامل عبر callDeepSeek الحقيقي بالبايتات الحقيقية
//   11   الرفض يُطلق إعادة المحاولة لا تقريراً فارغاً
//
// Run: node functions/test/jsonRepairShapeGuard.test.js

const assert = require('assert');

const {
  callDeepSeek, DeepSeekError, ensureReportShape,
} = require('../src/analysis/callDeepSeek');

// المشترك بين المزوّدين — مصدره وحدة واحدة عمداً، وهو ما أُصلح في الجولة
// الثانية: كان المنطق مكرّراً في callDeepSeek و callGemini فحُرس أحدهما
// وبقي الآخر مكشوفاً.
const {
  describeShape, looksLikeReport, REPORT_SHAPE_KEYS,
} = require('../src/analysis/reportShape');

// ─── أدوات ────────────────────────────────────────────────────────────

// تقرير مصغَّر لكنه واقعي الشكل: يحمل ما يقرأه runAnalysisInternal فعلاً.
const REPORT = {
  reasoning_trace: 'Tier: 2019 flagship (Galaxy S10 5G, Exynos 9820).',
  grade: 'B+',
  score: 78,
  summary: 'جهاز سليم عموماً مع تآكل بطّاريّة طفيف.',
  issues: [{severity: 'info', title: 'بطّاريّة', category: 'battery'}],
  categoryScores: {battery: {grade: 'B', score: 80}},
  performanceContext: {battery_assessment: 'سليمة على Android 11.'},
};

// البايتات كما خرجت من النموذج: الكائن مُغلق، ثم فاصلة، ثم آخر زوج، ثم قوس.
// هذا توليد للنمط لا نسخ له — لو تغيّر REPORT بقي الشكل هو نفسه.
const INCIDENT_RAW = JSON.stringify(REPORT) + ',"changeAnalysis":null}';

const meta = {scanId: 'test'};

/** يلتقط ما يُرمى ويُعيده بدل أن يُفشل الاختبار.
 * @param {Function} fn الدالة
 * @return {*} الخطأ المرميّ أو null
 */
function caught(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}

/** كعب fetch يردّ محتوى خاماً كما يردّه DeepSeek.
 * @param {string} content المحتوى الخام
 * @param {string} [finish] سبب الإنهاء
 */
function stubFetch(content, finish = 'stop') {
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      model: 'deepseek-flash',
      choices: [{message: {content}, finish_reason: finish}],
      usage: {
        prompt_cache_hit_tokens: 384, prompt_cache_miss_tokens: 101164,
        completion_tokens: 26303,
        completion_tokens_details: {reasoning_tokens: 22126},
      },
    }),
    text: async () => '',
  });
}

// نكتم سجلّ الحارس كي تبقى مخرجات الاختبار مقروءة، ونلتقطه للتحقّق منه.
const logged = [];
const realWarn = console.warn;
const realError = console.error;
const realLog = console.log;
/** يكتم السجلّ ويجمعه. */
function muteLogs() {
  console.warn = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  console.log = (...a) => logged.push(a.join(' '));
}
/** يُعيد السجلّ كما كان. */
function unmuteLogs() {
  console.warn = realWarn;
  console.error = realError;
  console.log = realLog;
}

// ─── 1. الشكل الحقيقي من الحادثة: مصفوفة ثلاثية أوّلها التقرير ─────────
{
  const {jsonrepair} = require('jsonrepair');
  const repaired = JSON.parse(jsonrepair(INCIDENT_RAW));

  // أوّلاً نُثبت أن المحاكاة تُنتج الشكل المرصود في الإنتاج نفسه، وإلا
  // فنحن نختبر شيئاً آخر.
  assert.ok(Array.isArray(repaired), 'jsonrepair must wrap into an array');
  assert.strictEqual(repaired.length, 3,
      'the incident produced exactly three top-level values');
  assert.deepStrictEqual(Object.keys(repaired), ['0', '1', '2'],
      'Object.keys must read 0,1,2 — the exact production log line');

  muteLogs();
  const out = ensureReportShape(repaired, 'repair', meta);
  unmuteLogs();

  assert.strictEqual(out.grade, 'B+', 'the real grade must survive');
  assert.strictEqual(out.score, 78, 'the real score must survive');
  assert.strictEqual(out.summary, REPORT.summary, 'the summary must survive');
  assert.deepStrictEqual(out.categoryScores, REPORT.categoryScores,
      'category scores must survive intact');

  // الاستخلاص حدث ويجب أن يُسجَّل سببه — البند الذي كان غائباً.
  const line = logged.find((l) => l.includes('extracting'));
  assert.ok(line, 'extraction must be logged');
  assert.ok(line.includes('[0]'), 'log must name which element was taken');
  assert.ok(line.includes('grade'), 'log must justify the choice by key');
  assert.ok(line.includes('discarding 2'),
      'log must say how many siblings were dropped');
  logged.length = 0;
}

// ─── 2. كائن صالح عادي يمرّ كما هو ────────────────────────────────────
{
  muteLogs();
  const out = ensureReportShape(REPORT, 'parse', meta);
  unmuteLogs();
  logged.length = 0;
  assert.strictEqual(out, REPORT,
      'a normal valid object must pass through by identity');
}

// ─── 3. كائن بلا أي مفتاح متوقَّع يُرفَض ───────────────────────────────
{
  const err = caught(() =>
    ensureReportShape({error: 'nope', detail: 'x'}, 'repair', meta));
  assert.ok(err instanceof DeepSeekError, 'must throw DeepSeekError');
  assert.strictEqual(err.kind, 'shape_invalid');
  assert.strictEqual(err.retryable, true,
      'rejection must be retryable — that is the whole point of rejecting');
  assert.ok(err.message.includes('keyCount=2'),
      'the error must carry the shape it rejected');
}

// ─── 4. مصفوفة بلا عنصر يشبه التقرير تُرفَض ───────────────────────────
{
  const err = caught(() =>
    ensureReportShape(['changeAnalysis', ':null', 7], 'repair', meta));
  assert.ok(err instanceof DeepSeekError, 'must throw DeepSeekError');
  assert.strictEqual(err.kind, 'shape_invalid');
  assert.strictEqual(err.retryable, true);
  assert.ok(err.message.includes('type=array len=3'),
      'the error must describe the array it rejected');
}

// ─── 5. شكل V3 (overallGrade فقط) يجب ألّا يُرفَض ─────────────────────
{
  // runAnalysisInternal يقرأ overallGrade ?? grade. لو حصر الحارس نفسه في
  // grade وحدها لرفض كل تقرير V3 صالح — عطب أسوأ من الذي يُصلحه.
  const v3 = {overallGrade: 'A', overallScore: 91, details: '…'};
  muteLogs();
  const v3out = ensureReportShape(v3, 'parse', meta);
  unmuteLogs();
  logged.length = 0;
  assert.strictEqual(v3out, v3, 'a V3-shaped report must be accepted');

  assert.ok(looksLikeReport({summary: 'x'}), 'summary alone suffices');
  assert.ok(looksLikeReport({category_scores: {}}),
      'snake_case category_scores must be recognised');
  assert.ok(looksLikeReport({grade: null}),
      'presence of the key is the test, not its value');
}

// ─── 6. غير الكائنات تُرفَض ───────────────────────────────────────────
{
  for (const bad of [null, 'a string', 42, true]) {
    const err = caught(() => ensureReportShape(bad, 'repair', meta));
    assert.ok(err instanceof DeepSeekError,
        `${JSON.stringify(bad)} must be rejected`);
    assert.strictEqual(err.kind, 'shape_invalid');
  }
  assert.ok(!looksLikeReport([REPORT]),
      'an array is never itself a report');
}

// ─── 7. الحدّ الأدنى معرَّف صراحةً ────────────────────────────────────
{
  for (const k of ['grade', 'overallGrade', 'score', 'overallScore',
    'summary', 'category_scores', 'categoryScores']) {
    assert.ok(REPORT_SHAPE_KEYS.includes(k),
        `the minimum shape must name ${k}`);
  }
}

// ─── 8. describeShape يروي القصّة في سطر واحد ─────────────────────────
{
  const arr = describeShape(JSON.parse(require('jsonrepair')
      .jsonrepair(INCIDENT_RAW)));
  assert.ok(arr.includes('type=array'), 'must name the type');
  assert.ok(arr.includes('len=3'), 'must give the length');
  assert.ok(arr.includes('[0]=object{'), 'must describe element 0 as object');
  assert.ok(arr.includes('reasoning_trace'),
      'must sample the first keys of the report element');
  assert.ok(arr.includes('[1]=string'), 'must type the stray siblings');

  const obj = describeShape(REPORT);
  assert.ok(obj.includes('type=object'), 'object type');
  assert.ok(obj.includes('keyCount=7'), 'object key count');
  assert.ok(obj.includes('keys=reasoning_trace,grade,score'),
      'object first key names');
  assert.strictEqual(describeShape(null), 'type=null');
  assert.ok(describeShape('x').includes('type=string'));
}

// ─── 9-11. المسار الكامل عبر callDeepSeek الحقيقي ─────────────────────
(async () => {
  // 9. البايتات الحقيقية للحادثة تُنتج الآن تقريراً كاملاً بدل C/50.
  {
    stubFetch(INCIDENT_RAW);
    muteLogs();
    const out = await callDeepSeek('u', 's', 'k');
    unmuteLogs();

    assert.strictEqual(out.grade, 'B+',
        'the incident payload must now yield the real grade');
    assert.strictEqual(out.summary, REPORT.summary);

    // البند 2: الشكل يُطبع مع كل إصلاح ناجح — لا "succeeded" عمياء.
    const rep = logged.find((l) => l.includes('repair succeeded'));
    assert.ok(rep, 'repair success must be logged');
    assert.ok(rep.includes('type=array') && rep.includes('len=3'),
        'the success line must now carry the shape, not just the word');
    logged.length = 0;
  }

  // 10. JSON سليم عادي يمرّ دون المساس بالمسار السعيد.
  {
    stubFetch(JSON.stringify(REPORT));
    muteLogs();
    const out = await callDeepSeek('u', 's', 'k');
    unmuteLogs();
    assert.deepStrictEqual(out, REPORT, 'clean JSON must pass untouched');
    assert.ok(!logged.some((l) => l.includes('repair')),
        'the repair path must not run on valid JSON');
    logged.length = 0;
  }

  // 11. ناتج بلا تقرير يُرفَض بنوع قابل لإعادة المحاولة — لا يُمرَّر.
  //     هذا هو البند 4: الرفض يُطلق إعادة المحاولة القائمة في
  //     callDeepSeekWithRetry (شرطها err.retryable === true) ثم Gemini.
  {
    stubFetch('{"error":"model refused","detail":"x"}');
    muteLogs();
    let err = null;
    try {
      await callDeepSeek('u', 's', 'k');
    } catch (e) {
      err = e;
    }
    unmuteLogs();
    assert.ok(err instanceof DeepSeekError,
        'a shapeless object must be rejected, not returned');
    assert.strictEqual(err.kind, 'shape_invalid');
    assert.strictEqual(err.retryable, true,
        'must be retryable so the existing retry fires');
    logged.length = 0;
  }

  console.log('jsonRepairShapeGuard: 11/11 tests passed');
})().catch((e) => {
  unmuteLogs();
  console.error(e);
  process.exit(1);
});
