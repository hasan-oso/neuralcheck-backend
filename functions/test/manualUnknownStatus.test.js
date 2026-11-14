'use strict';

// manualUnknownStatus.test.js — ق١ (قرارات حسن، تفويض 2026-10-22، نصّ المستخدم 2026-10-23): حالة اختبار يدوي غير معروفة أو غائبة
// ⟵ NOT_MEASURED/UNKNOWN_MANUAL_STATUS، لا OPERATOR_SKIPPED. `not_tested` وحدها تبقى OPERATOR_SKIPPED.
//
// القاعدة 22 (الملحق): لا قيمة افتراضية تسدّ غياباً في مسار الحرف أو العرض — فرع اليدوي في toTestResult كان يُسقط كل ما سوى
// pass/fail/warning/unavailable على OPERATOR_SKIPPED («تخطّاه الفنّي»)، فتُقرأ حالة غريبة أو غائبة تخطّياً مُعلَناً.
//
// القاعدة 30: كل قيمة مُعدَّدة يُختبَر تصنيفها بكل قيمها الممكنة — الخمس المعروفة (pass · fail · warning · not_tested · unavailable) + ما سواها
// (غائبة · فارغة · null · 0 · رقم · كائن · نصّ غريب · نصّ بمسافة لاحقة)، والمصدر الوظيفي (لا يتغيّر: HARNESS_ERROR لغير المعروف).
// القاعدة 37: مسار كامل لا يستبدل شيئاً — computeCategoryStates على عيّنة fv69 الذهبية بصفّ يدوي واحد بحالة غريبة؛ والتغطية والحروف والبوّابات
// لا تتغيّر (غير مقيس كـnot_tested)، ويتغيّر السبب وحده.
//
// Run: node functions/test/manualUnknownStatus.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const testKinds = require('../src/analysis/testKinds');
const {toTestResult, NOT_MEASURED_REASON} = testKinds;
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ═══════════════════════════════════════════════════════════════════
// ١) المصدر الواحد (القاعدة 24): الأسماء الثلاثة مُصدَّرة ومجمَّدة بقيمها الحرفية
// ═══════════════════════════════════════════════════════════════════
eq(NOT_MEASURED_REASON, {HARDWARE_ABSENT: 'HARDWARE_ABSENT', OPERATOR_SKIPPED: 'OPERATOR_SKIPPED', UNKNOWN_MANUAL_STATUS: 'UNKNOWN_MANUAL_STATUS'},
    '[١] NOT_MEASURED_REASON: الأسماء الثلاثة بقيمها الحرفية');
ok(Object.isFrozen(NOT_MEASURED_REASON), '[١] NOT_MEASURED_REASON مجمَّد');

// ═══════════════════════════════════════════════════════════════════
// ٢) toTestResult — اليدوي — الخمس المعروفة كما كانت، وما سواها UNKNOWN_MANUAL_STATUS
// ═══════════════════════════════════════════════════════════════════
const manual = (status, withStatusKey = true) => {
  const e = {testId: 'M-11', categoryName: 'touch', rawValue: null};
  if (withStatusKey) e.status = status;
  return e;
};
const KNOWN = {
  pass: ['PASS', null], fail: ['FAIL', null], warning: ['WARNING', null],
  not_tested: ['NOT_MEASURED', 'OPERATOR_SKIPPED'], unavailable: ['NOT_MEASURED', 'HARDWARE_ABSENT'],
};
for (const [st, want] of Object.entries(KNOWN)) {
  const tr = toTestResult(manual(st), null, null, {isManual: true});
  eq([tr.outcome, tr.notMeasuredReason], want, `[٢][معروفة] ${st}`);
}
// التحويل إلى أحرف صغيرة قائم قبل ق١ (status يُخفَّض): «PASS» نتيجة، لا غريبة
eq((({outcome, notMeasuredReason}) => [outcome, notMeasuredReason])(toTestResult(manual('PASS'), null, null, {isManual: true})), ['PASS', null], '[٢][معروفة] «PASS» بأحرف كبيرة ⟵ PASS (كما كان)');
eq((({outcome, notMeasuredReason}) => [outcome, notMeasuredReason])(toTestResult(manual('Not_Tested'), null, null, {isManual: true})), ['NOT_MEASURED', 'OPERATOR_SKIPPED'], '[٢][معروفة] «Not_Tested» ⟵ OPERATOR_SKIPPED (كما كان)');

const UNKNOWN_VALUES = [
  ['نصّ غريب', 'skipped'], ['نصّ غريب آخر', 'maybe'], ['مسافة لاحقة', 'pass '], ['فارغ', ''], ['null', null], ['صفر', 0], ['رقم', 3], ['كائن', {a: 1}], ['false', false], ['مصفوفة', ['pass']],
];
for (const [label, v] of UNKNOWN_VALUES) {
  const tr = toTestResult(manual(v), null, null, {isManual: true});
  eq([tr.outcome, tr.notMeasuredReason], ['NOT_MEASURED', 'UNKNOWN_MANUAL_STATUS'], `[٢][غريبة] ${label}`);
  eq([tr.attested, tr.attestedLabel, tr.confidence, tr.kind], [true, 'بشهادة الفنّي', 'HALF_WEIGHT_ATTESTED', 'STATE'], `[٢][غريبة] ${label}: الوسوم الأخرى كما لغيرها من اليدوي`);
}
// الحالة الغائبة (لا مفتاح status) والإدخال الغائب كلّه
{
  const tr = toTestResult(manual(undefined, false), null, null, {isManual: true});
  eq([tr.outcome, tr.notMeasuredReason], ['NOT_MEASURED', 'UNKNOWN_MANUAL_STATUS'], '[٢][غائبة] لا مفتاح status');
  const tr2 = toTestResult(undefined, null, null, {isManual: true});
  eq([tr2.outcome, tr2.notMeasuredReason], ['NOT_MEASURED', 'UNKNOWN_MANUAL_STATUS'], '[٢][غائبة] الإدخال نفسه غائب');
}
// not_tested لم تتأثّر بنوع الغريب: السبب يتبع الحالة لا ترتيب الفحص (بقيمتين متجاورتين)
{
  const a = toTestResult(manual('not_tested'), null, null, {isManual: true}).notMeasuredReason;
  const b = toTestResult(manual('not_testedX'), null, null, {isManual: true}).notMeasuredReason;
  eq([a, b], ['OPERATOR_SKIPPED', 'UNKNOWN_MANUAL_STATUS'], '[٢] not_tested ثمّ not_testedX: السببان مختلفان');
}

// ═══════════════════════════════════════════════════════════════════
// ٣) الوظيفي لا يتغيّر (ق١ يخصّ اليدوي): غير المعروف ⟵ HARNESS_ERROR، وunavailable ⟵ CAPABILITY_BLOCKED
// ═══════════════════════════════════════════════════════════════════
{
  const f = (status) => toTestResult({testId: 'C-05', categoryName: 'cpu', status}, null, null, {isManual: false});
  eq([f('skipped').outcome, f('skipped').notMeasuredReason], ['NOT_MEASURED', 'HARNESS_ERROR'], '[٣][وظيفي] غير المعروف ⟵ HARNESS_ERROR (لم يتغيّر)');
  eq([f('unavailable').notMeasuredReason], ['CAPABILITY_BLOCKED'], '[٣][وظيفي] unavailable بلا قاعدة طراز ⟵ CAPABILITY_BLOCKED (لم يتغيّر)');
  eq(toTestResult({testId: 'T-03', categoryName: 'thermal', status: 'unavailable'}, {attestsHardwareAbsent: () => true}, null, {isManual: false}).notMeasuredReason,
      'HARDWARE_ABSENT', '[٣][وظيفي] unavailable مع قاعدة طراز شاهدة ⟵ HARDWARE_ABSENT (لم يتغيّر)');
}

// ═══════════════════════════════════════════════════════════════════
// ٤) المسار الكامل بلا استبدال (القاعدة 37): computeCategoryStates على عيّنة fv69 الذهبية
// ═══════════════════════════════════════════════════════════════════
{
  const SAMPLE = readJson('fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json');
  const rawTs = readJson('b45c8cf6.ts.json');
  const battery = sampleInputsFromRaw(rawTs);
  const run = (fp) => computeCategoryStates({
    functionalResults: clone(fp.functionalResults), manualResults: clone(fp.manualResults), dev: null,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design, analyzedAtMs: Date.parse('2026-10-23T00:00:00.000Z'),
  });
  const withM11 = (mutate) => { const f = clone(SAMPLE); mutate(f.manualResults.find((m) => m.testId === 'M-11')); return f; };
  const base = run(SAMPLE);
  const tr = (cs, id) => cs.testResults.find((t) => t.testId === id);
  eq([tr(base, 'M-11').outcome, tr(base, 'M-11').notMeasuredReason, SAMPLE.manualResults.find((m) => m.testId === 'M-11').status], ['NOT_MEASURED', 'OPERATOR_SKIPPED', 'not_tested'],
      '[٤] الأساس: M-11 في العيّنة not_tested ⟵ OPERATOR_SKIPPED');
  const cat = tr(base, 'M-11').category;
  ok(typeof cat === 'string' && cat.length > 0, '[٤] M-11 يحمل فئته');
  const strip = (cs) => { const c = clone(cs); delete c.testResults; return c; };
  for (const [label, mutate] of [
    ['نصّ غريب', (m) => { m.status = 'skipped'; }],
    ['حالة محذوفة', (m) => { delete m.status; }],
    ['null', (m) => { m.status = null; }],
  ]) {
    const cs = run(withM11(mutate));
    eq([tr(cs, 'M-11').outcome, tr(cs, 'M-11').notMeasuredReason], ['NOT_MEASURED', 'UNKNOWN_MANUAL_STATUS'], `[٤][${label}] M-11 ⟵ NOT_MEASURED/UNKNOWN_MANUAL_STATUS`);
    // غير مقيس كـnot_tested: لا تغطية ولا درجة ولا حرف ولا بوّابة ولا قائمة أعطال تتغيّر — السبب وحده
    eq(strip(cs), strip(base), `[٤][${label}] الفئات والدرجة العامة والبوّابات والقوائم كما هي (غير المعروف لا يُنفَّذ ولا يُعاقَب)`);
    const others = (c) => c.testResults.filter((t) => t.testId !== 'M-11').map((t) => [t.testId, t.outcome, t.notMeasuredReason]);
    eq(others(cs), others(base), `[٤][${label}] بقيّة الاختبارات كما هي`);
    // الإفصاح الحتمي يبقى لغير المقيس بسببه (DISC)، ولا عطب (ISS) لغير المعروف
    ok((cs.issues || []).some((i) => i.id === 'DISC-M-11'), `[٤][${label}] DISC-M-11 حاضر`);
    ok(!(cs.issues || []).some((i) => i.id === 'ISS-M-11'), `[٤][${label}] لا ISS-M-11`);
  }
  // صفّ آخر بالحالات الخمس حاضر في العيّنة وسببه لم يتغيّر (not_tested ⟵ OPERATOR_SKIPPED، unavailable ⟵ HARDWARE_ABSENT)
  eq([tr(base, 'M-08').notMeasuredReason, tr(base, 'M-11').notMeasuredReason], ['HARDWARE_ABSENT', 'OPERATOR_SKIPPED'], '[٤] M-08 وM-11 كما كانا');
}

console.log(`\nmanualUnknownStatus.test.js: ${n}/${n} assertions passed`);
