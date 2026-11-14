'use strict';

// coverageHardwareAbsent.test.js — ق٢ (قرارات حسن، تفويض 2026-10-22، أمر المستخدم 2026-10-23): العتاد الغائب خارج مقام التغطية.
//
// النصّ المعتمَد (حرفياً من مقترح الوكيل في ورقة القرارات): «يُستثنى من المقام ما outcome=NOT_MEASURED وnotMeasuredReason=HARDWARE_ABSENT، فلا تنقص
// التغطية لمكوّن أعلن الفنّي غيابه؛ وفئة كلّها غائبة العتاد تصير declared=0 ⟵ UNMEASURED كما اليوم؛ والتغطية العامّة وLOW_CATEGORY_COVERAGE تقرآن المقام
// نفسه من الدالّة نفسها؛ وتُعاد الذهبيات المتأثّرة في الالتزام نفسه.»
//
// ما يُختبَر (القاعدتان 30 و37):
//   ١) computeHealthBearingStats مباشرةً: الاستثناء بشرطيه معاً (outcome وreason)، وكل سبب غير HARDWARE_ABSENT يبقى في المقام.
//   ٢) computeCategoryFromTests: التغطية والحالة وdeclaredCount لفئة فيها عتاد غائب؛ وفئة كلّها غائبة ⟵ declared=0 ⟵ UNMEASURED.
//   ٣) المسار الكامل بلا استبدال (computeCategoryStates على عيّنات fv69/fv71 الذهبية): التغطية وبوّابة LOW_CATEGORY_COVERAGE
//      (coveragePct وbelowThreshold) تقرآن المقام نفسه؛ والتغطية العامّة تساوي مجموعها المُعاد حسابه باليد من تغطيات الفئات.
//   ٤) ما لا يتغيّر: الحروف والحالات والدرجات في العيّنات الذهبية (القياس: scratchpad/backend-delegated/det-diff-P2.json).
//
// Run: node functions/test/coverageHardwareAbsent.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeCategoryStates, CATEGORY_WEIGHTS, _internal} = require('../src/analysis/categoryStates');
const {NOT_MEASURED_REASON} = require('../src/analysis/testKinds');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {computeHealthBearingStats, computeCategoryFromTests} = _internal;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ═══════════════════════════════════════════════════════════════════
// ١) computeHealthBearingStats — مباشرةً بصفوف مبنيّة باليد
// ═══════════════════════════════════════════════════════════════════
const row = (testId, outcome, reason, healthBearing = true, kind = 'STATE') => ({testId, outcome, notMeasuredReason: reason, healthBearing, kind, attested: false});
const stats = (rows) => { const s = computeHealthBearingStats(rows); return [s.declared, s.executed.length, s.coverage, s.declaredHb.length]; };

eq(stats([row('A', 'PASS', null), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), [1, 1, 1, 1], '[١] PASS + HARDWARE_ABSENT: المقام 1، التغطية 1');
eq(stats([row('A', 'PASS', null), row('B', 'FAIL', null), row('C', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), [2, 2, 1, 2], '[١] PASS + FAIL + HARDWARE_ABSENT: المقام 2');
eq(stats([row('A', 'PASS', null), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('C', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('D', 'WARNING', null)]), [2, 2, 1, 2], '[١] عتادان غائبان: المقام 2');
eq(stats([row('A', 'PASS', null), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('C', 'NOT_MEASURED', 'OPERATOR_SKIPPED')]), [2, 1, 0.5, 2], '[١] HARDWARE_ABSENT خارج المقام وOPERATOR_SKIPPED داخله');
// كل غير HARDWARE_ABSENT يبقى في المقام (القاعدة 30: كل القيم الممكنة لا واحدة)
for (const reason of ['OPERATOR_SKIPPED', NOT_MEASURED_REASON.UNKNOWN_MANUAL_STATUS, 'CAPABILITY_BLOCKED', 'PERMISSION_DENIED', 'NOT_TESTED', 'ENVIRONMENT_UNSUITABLE', 'HARNESS_ERROR', null, undefined]) {
  eq(stats([row('A', 'PASS', null), row('B', 'NOT_MEASURED', reason)]), [2, 1, 0.5, 2], `[١] NOT_MEASURED/${reason}: يبقى في المقام`);
}
// الشرطان معاً: HARDWARE_ABSENT مع outcome غير NOT_MEASURED لا يُستثنى (لا قراءة بالسبب وحده)
for (const outcome of ['PASS', 'FAIL', 'WARNING']) {
  eq(stats([row('A', 'PASS', null), row('B', outcome, 'HARDWARE_ABSENT')]), [2, 2, 1, 2], `[١] ${outcome} مع reason=HARDWARE_ABSENT: يبقى في المقام وفي المنفَّذ`);
}
// الاستثناء لا يمسّ ما ليس حاملاً للصحّة أصلاً
eq(stats([row('A', 'PASS', null), row('S', 'NOT_MEASURED', 'HARDWARE_ABSENT', false)]), [1, 1, 1, 1], '[١] غير حامل للصحّة: خارج المقام قبل ق٢ وبعده');
// كلّها غائبة العتاد: المقام 0 والتغطية 0 (لا قسمة على صفر)
eq(stats([row('A', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), [0, 0, 0, 0], '[١] كلّها غائبة العتاد: declared=0، executed=0، coverage=0');
eq(stats([]), [0, 0, 0, 0], '[١] لا صفوف: كما كان');
// الدالّة لا تحوّر مدخلها
{
  const input = [row('A', 'PASS', null), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT')];
  const before = JSON.stringify(input);
  computeHealthBearingStats(input);
  eq(JSON.stringify(input), before, '[١] المدخل لا يُحوَّر');
}

// ═══════════════════════════════════════════════════════════════════
// ٢) computeCategoryFromTests — الحالة وdeclaredCount والتغطية
// ═══════════════════════════════════════════════════════════════════
{
  const cat = (rows) => { const e = computeCategoryFromTests(rows, [], 'audio'); return [e.state, e.coverage, e.declaredCount, e.executedCount]; };
  eq(cat([row('A', 'PASS', null), row('B', 'PASS', null), row('C', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), ['MEASURED', 1, 2, 2], '[٢] pass+pass+عتاد غائب ⟵ MEASURED بتغطية 1 (كانت PARTIAL بـ2/3)');
  eq(cat([row('A', 'PASS', null), row('B', 'NOT_MEASURED', 'OPERATOR_SKIPPED'), row('C', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), ['PARTIAL', 0.5, 2, 1], '[٢] pass+تخطٍّ+عتاد غائب ⟵ PARTIAL بتغطية 0.5');
  eq(cat([row('A', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('B', 'NOT_MEASURED', 'HARDWARE_ABSENT')]), ['UNMEASURED', 0, 0, 0], '[٢] فئة كلّها غائبة العتاد ⟵ declared=0 ⟵ UNMEASURED');
  eq(cat([row('A', 'NOT_MEASURED', 'HARDWARE_ABSENT'), row('B', 'NOT_MEASURED', 'OPERATOR_SKIPPED')]), ['UNMEASURED', 0, 1, 0], '[٢] عتاد غائب + تخطٍّ ⟵ UNMEASURED بمقام 1');
}

// ═══════════════════════════════════════════════════════════════════
// ٣) المسار الكامل بلا استبدال (القاعدة 37): computeCategoryStates على عيّنات fv69/fv71 الذهبية
// ═══════════════════════════════════════════════════════════════════
const rawTs = readJson('b45c8cf6.ts.json');
const battery = sampleInputsFromRaw(rawTs);
const run = (fp) => computeCategoryStates({
  functionalResults: clone(fp.functionalResults), manualResults: clone(fp.manualResults), dev: null,
  batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design, analyzedAtMs: Date.parse('2026-10-23T00:00:00.000Z'),
});
const S71 = readJson('fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json');
const S71_16 = readJson('fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json');
const S69 = readJson('fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json');
const gateOf = (cs, category) => cs.gates.find((g) => g.name === 'LOW_CATEGORY_COVERAGE' && g.category === category);
const audioOf = (cs) => { const a = cs.categories.audio; return [a.state, a.coverage, a.declaredCount, a.executedCount, a.deterministicLetter]; };
const audioHw = (cs) => cs.testResults.filter((t) => t.category === 'audio' && t.healthBearing).map((t) => [t.testId, t.outcome, t.notMeasuredReason]);

{
  // fv71 11ch: M-09 PASS · M-10 PASS · M-08 unavailable ⟵ HARDWARE_ABSENT
  const cs = run(S71);
  eq(audioHw(cs), [['M-09', 'PASS', null], ['M-10', 'PASS', null], ['M-08', 'NOT_MEASURED', 'HARDWARE_ABSENT']], '[٣][fv71 11ch] صفوف الصوت: M-08 عتاد غائب');
  eq(audioOf(cs), ['ATTESTED_ONLY', 1, 2, 2, null], '[٣][fv71 11ch] الصوت: تغطية 1 ومقام 2 (كانت 2/3 ومقام 3)؛ الحالة والحرف كما هما');
  const g = gateOf(cs, 'audio');
  eq([g.coveragePct, g.belowThreshold, g.allNonMeasurement, g.status], [100, false, true, 'FIRED'], '[٣][fv71 11ch] بوّابة LOW_CATEGORY_COVERAGE تقرأ المقام نفسه: 100% لا دون العتبة، وتبقى مُطلَقة بسبب STATE (لم يتغيّر)');
  eq(g.source, '2/2 اختبار منفَّذ من صنف STATE — صفر MEASUREMENT', '[٣][fv71 11ch] نصّ مصدر البوّابة');
}
{
  // fv69 11ch: M-09 warning · M-08 unavailable — كان 50% < 60% (دون العتبة)، صار 100%
  const cs = run(S69);
  eq(audioOf(cs), ['ATTESTED_ONLY', 1, 1, 1, null], '[٣][fv69 11ch] الصوت: تغطية 1 ومقام 1 (كانت 0.5 ومقام 2)');
  const g = gateOf(cs, 'audio');
  eq([g.coveragePct, g.belowThreshold, g.status], [100, false, 'FIRED'], '[٣][fv69 11ch] بوّابة الصوت: لم تعد دون العتبة (كانت 50% < 60%)');
  ok(!/coverage=/.test(g.source), '[٣][fv69 11ch] نصّ المصدر لا يذكر coverage< بعد الآن');
}
{
  // fv71 16ch: لا شيء منفَّذ في الصوت (تخطٍّ ×2 + عتاد غائب) ⟵ UNMEASURED، المقام 2 (كان 3)، والبوّابة INPUT_ABSENT كما كانت
  const cs = run(S71_16);
  eq(audioOf(cs), ['UNMEASURED', 0, 2, 0, null], '[٣][fv71 16ch] الصوت UNMEASURED بمقام 2 (كان 3)');
  const g = gateOf(cs, 'audio');
  eq([g.status, g.belowThreshold, g.coveragePct], ['INPUT_ABSENT', null, 0], '[٣][fv71 16ch] البوّابة INPUT_ABSENT كما كانت');
}
{
  // فئة كلّها غائبة العتاد (كل صفوف الصوت unavailable) ⟵ declared=0 ⟵ UNMEASURED (المقام صفر، لا قسمة على صفر)
  const f = clone(S71);
  for (const m of f.manualResults) if (['M-09', 'M-10', 'M-08'].includes(m.testId)) m.status = 'unavailable';
  const cs = run(f);
  eq(audioHw(cs).map((t) => t[2]), ['HARDWARE_ABSENT', 'HARDWARE_ABSENT', 'HARDWARE_ABSENT'], '[٣][كلّها غائبة] صفوف الصوت الثلاثة HARDWARE_ABSENT');
  eq(audioOf(cs), ['UNMEASURED', 0, 0, 0, null], '[٣][كلّها غائبة] الصوت UNMEASURED بمقام 0');
  eq(gateOf(cs, 'audio').status, 'INPUT_ABSENT', '[٣][كلّها غائبة] البوّابة INPUT_ABSENT');
}
{
  // غائبة العتاد تقلب البوّابة: pass واحد + عتادان غائبان ⟵ 1/1 (كان 1/3 دون العتبة)
  const f = clone(S71);
  for (const m of f.manualResults) { if (m.testId === 'M-09') m.status = 'pass'; if (m.testId === 'M-10') m.status = 'unavailable'; if (m.testId === 'M-08') m.status = 'unavailable'; }
  const cs = run(f);
  eq(audioOf(cs), ['ATTESTED_ONLY', 1, 1, 1, null], '[٣][قلب البوّابة] الصوت: pass واحد وعتادان غائبان ⟵ مقام 1 وتغطية 1');
  const g = gateOf(cs, 'audio');
  eq([g.coveragePct, g.belowThreshold], [100, false], '[٣][قلب البوّابة] 100% لا دون العتبة (كانت 33.3% < 60%)');
}
{
  // التغطية العامّة تقرأ المقام نفسه: نقل M-08 (عتاد غائب) إلى فئة موزونة حاملة لحرف (sensors) — الفئة تغطيتها 3/4 بدل 3/5
  const f = clone(S71);
  f.manualResults.find((m) => m.testId === 'M-08').categoryName = 'sensors';
  const cs = run(f);
  const s = cs.categories.sensors;
  eq([s.state, s.coverage, s.declaredCount, s.executedCount, s.deterministicLetter], ['PARTIAL', 0.75, 4, 3, 'B'], '[٣][عامّة] sensors: مقام 4 (لا 5) وتغطية 0.75 وحرف B كما كان');
  eq([gateOf(cs, 'sensors').coveragePct, gateOf(cs, 'sensors').belowThreshold], [75, false], '[٣][عامّة] بوّابة sensors تقرأ 75%');
  // إعادة حساب التغطية العامّة باليد من تغطيات الفئات (التعريف: وزن الفئات الحاملة لحرف × تغطيتها ÷ مجموع الأوزان)
  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  let sum = 0;
  for (const c of Object.keys(CATEGORY_WEIGHTS)) if (cs.categories[c].deterministicLetter !== null) sum += CATEGORY_WEIGHTS[c] * (cs.categories[c].coverage || 0);
  eq(cs.overall.coverage, sum / totalWeight, '[٣][عامّة] overall.coverage يساوي مجموعها المُعاد حسابه من تغطيات الفئات (المقام نفسه)');
  const base = run(S71);
  eq(cs.overall.coverage, base.overall.coverage, '[٣][عامّة] العتاد الغائب خارج المقام أينما وقع: نقله من الصوت (وزنه 0) إلى sensors لا يغيّر التغطية العامّة');
}

// ═══════════════════════════════════════════════════════════════════
// ٤) ما لا يتغيّر: الحروف والدرجات والحالات (من عدا التغطية) في العيّنات الثلاث
// ═══════════════════════════════════════════════════════════════════
{
  const cs = run(S71);
  eq(Object.fromEntries(Object.entries(cs.categories).map(([k, v]) => [k, v.deterministicLetter])), {
    battery: null, thermal: null, cpu: 'B', gpu: 'B', display: null, memory: 'B', storage: 'B', camera: null, gps: 'B', security: 'D',
    sensors: 'B', cellular: null, wireless: null, audio: null, input: null,
  }, '[٤][fv71 11ch] حروف الفئات كما كانت (لا حرف يتغيّر)');
  eq([cs.overall.letter, cs.overall.coverage], ['C', 0.41], '[٤][fv71 11ch] الدرجة العامة والتغطية العامّة كما كانتا (الصوت وزنه 0)');
}

console.log(`\ncoverageHardwareAbsent.test.js: ${n}/${n} assertions passed`);
