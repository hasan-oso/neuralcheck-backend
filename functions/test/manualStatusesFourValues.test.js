'use strict';

// manualStatusesFourValues.test.js — الدفعة ١٠ (قرار المستخدم 2026-10-10، بنصّه): «كل حقل قائم يتغيّر شكله أو مفرداته (أجوبة الاختبارات اليدوية بحالاتها الأربع
// خاصّةً) يُحدَّث قارئه في الخادم قبل المحطّة ١، مع اختبار. فلا يُقرأ «لم أختبر» أو «تعذّر» عطباً.» وقراره الثاني: «غير متوفر في هذا الجهاز» ⇒ HARDWARE_ABSENT: معتمد
// — «مع اختبار بعيّنة fv69 الحقيقية».
//
// الحالات: pass · fail · not_tested · **unavailable** (الجديدة — عقد §٧-ح (أ)، docs/FV68_CONTRACT.md:1452) + **warning** (خامسة معروفة في تقارير ≤ fv68: كان M-02 يرسلها من عتبة 80% — منقول
// من نصّ الأمر، غير متحقَّق من مستودع التطبيق؛ وفي العيّنات صفّ M-09 warning مصنوع باليد). فلا تُسقَط معرفة warning.
//
// القرّاء (جرد الدفعة ١٠، ق١–ق٤، القاعدة 30 — «كل قيمة مُعدَّدة تصل من الخادم يُختبَر تصنيفها بكل قيمها الممكنة، لا بواحدة»):
//   ق١ toTestResult (testKinds.js) — لكل قيمة، **ولكل مصدر** (يدوي ووظيفي): outcome وnotMeasuredReason.
//   ق٢ rebuildCategoryScores — العدّ والاستبعاد من «المنفَّذ» بكل قيمة ولكل مصدر.
//   ق٣ computeScanSignature — الوظيفي يستبعد not_tested وunavailable، واليدوي يُحفَظ خاماً بكل قيمه.
//   ق٤ reevaluationDecision — مصفوفة الانتقالات الكاملة 5×5 لليدوي: أربعة مُطلِقات لا غير (الرابع unavailable→fail، ق٣ في 2026-10-23).
//   + المسار الكامل (القاعدة 37): computeCategoryStates ← sanitizeTestResultsForModelPayload ← فهرس إعفاء التسرّب اللغوي: ما يراه النموذج وما يُعرَض.
//
// المُدخل: العيّنات الذهبية الثلاث fv69 (حمولة التطبيق كما تصل analyzeDevice — القاعدة 41) — تحمل الحالات الخمس لليدوي، والخمس لوظيفي (pass وfail وwarning وunavailable
// وnot_tested)؛ وما لا تحمله (not_tested وظيفي عام بلا إذن) يُبنى اصطناعياً ويُوسَم.
//
// Run: node functions/test/manualStatusesFourValues.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {toTestResult} = require('../src/analysis/testKinds');
const {rebuildCategoryScores} = require('../src/analysis/rebuildCategoryScores');
const {computeScanSignature} = require('../src/signatures/computeScanSignature');
const {reevaluationDecision} = require('../src/signatures/reevaluationDecision');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildLeakExemptionIndex} = require('../src/analysis/reportShapeV7');
const {sanitizeTestResultsForModelPayload} = require('../src/analysis/buildV7Payload')._internal;
const {CATEGORY_NAME_AR} = require('../src/utils/categories');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const SAMPLE = {};
for (const s of STEMS) SAMPLE[s] = readJson(`fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${s}.json`);
const clone = (o) => JSON.parse(JSON.stringify(o));
const FIVE = ['pass', 'fail', 'warning', 'not_tested', 'unavailable'];

// ═══════════════════════════════════════════════════════════════════
// ٠) المُدخل: العيّنات الحقيقية تحمل الحالات الخمس
// ═══════════════════════════════════════════════════════════════════
for (const s of STEMS) {
  const man = new Set(SAMPLE[s].manualResults.map((m) => m.status));
  eq([...man].sort(), ['fail', 'not_tested', 'pass', 'unavailable', 'warning'], `[٠][${s}] manualResults: الحالات الخمس كلّها (pass وfail وnot_tested وunavailable وwarning) — من الحمولة لا من القارئ`);
  const fun = new Set(SAMPLE[s].functionalResults.map((f) => f.status));
  for (const st of FIVE) ok(fun.has(st), `[٠][${s}] functionalResults تحمل ${st}`);
}
// أمثلة حقيقية لكل حالة، لكل مصدر (من العيّنة 11ch؛ الحالات والمعرّفات نفسها في الثلاث ما عدا M-02)
const S11 = SAMPLE['11ch-nothing-admitted'];
const manualReal = (testId) => clone(S11.manualResults.find((m) => m.testId === testId));
const functionalReal = (testId) => clone(S11.functionalResults.find((f) => f.testId === testId));
const MANUAL_BY_STATUS = {pass: 'M-07', fail: 'M-19', warning: 'M-09', not_tested: 'M-11', unavailable: 'M-08'};
const FUNCTIONAL_BY_STATUS = {pass: 'C-05', fail: 'B-02', warning: 'SEC-03', not_tested: 'N-04', unavailable: 'T-03'};
for (const st of FIVE) {
  eq(manualReal(MANUAL_BY_STATUS[st]).status, st, `[٠] مثال يدوي حقيقي لـ${st}: ${MANUAL_BY_STATUS[st]}`);
  eq(functionalReal(FUNCTIONAL_BY_STATUS[st]).status, st, `[٠] مثال وظيفي حقيقي لـ${st}: ${FUNCTIONAL_BY_STATUS[st]}`);
}

// ═══════════════════════════════════════════════════════════════════
// ق١) toTestResult — لكل قيمة ولكل مصدر
// ═══════════════════════════════════════════════════════════════════
// اليدوي: pass/fail/warning ← نتيجة، not_tested ← OPERATOR_SKIPPED، **unavailable ← HARDWARE_ABSENT** (قرار المستخدم 2026-10-10)
const MANUAL_EXPECT = {
  pass: ['PASS', null], fail: ['FAIL', null], warning: ['WARNING', null],
  not_tested: ['NOT_MEASURED', 'OPERATOR_SKIPPED'], unavailable: ['NOT_MEASURED', 'HARDWARE_ABSENT'],
};
for (const st of FIVE) {
  const entry = manualReal(MANUAL_BY_STATUS[st]);
  const tr = toTestResult(entry, null, null, {isManual: true});
  eq([tr.outcome, tr.notMeasuredReason], MANUAL_EXPECT[st], `[ق١][يدوي][${st}] ${entry.testId} الحقيقي: outcome وnotMeasuredReason`);
  eq([tr.attested, tr.confidence, tr.attestedLabel], [true, 'HALF_WEIGHT_ATTESTED', 'بشهادة الفنّي'], `[ق١][يدوي][${st}] بشهادة الفنّي (لا توقيت في هذه العيّنة)`);
  eq(tr.kind, 'STATE', `[ق١][يدوي][${st}] kind=STATE`);
}
// كل صفوف اليدوي في العيّنات الثلاث (18 صفّاً بحالاتها) — كلّ صفّ بما تقوله حالته، لا بصفّ مختار
{
  let rows = 0;
  for (const s of STEMS) {
    for (const m of SAMPLE[s].manualResults) {
      const tr = toTestResult(clone(m), null, null, {isManual: true});
      eq([tr.outcome, tr.notMeasuredReason], MANUAL_EXPECT[m.status], `[ق١][يدوي][${s}] ${m.testId}=${m.status}`);
      rows++;
    }
  }
  eq(rows, 18, '[ق١][يدوي] ثمانية عشر صفّاً حقيقياً فُحصت (6 × 3 عيّنات)');
}
// الوظيفي: يبقى كما هو — unavailable ← CAPABILITY_BLOCKED (ما لم تشهد قاعدة طراز ← HARDWARE_ABSENT)، وnot_tested ← PERMISSION_DENIED لـN-04
const FUNCTIONAL_EXPECT = {
  pass: ['PASS', null], fail: ['FAIL', null], warning: ['WARNING', null],
  not_tested: ['NOT_MEASURED', 'PERMISSION_DENIED'], unavailable: ['NOT_MEASURED', 'CAPABILITY_BLOCKED'],
};
for (const st of FIVE) {
  const entry = functionalReal(FUNCTIONAL_BY_STATUS[st]);
  const tr = toTestResult(entry, null, null, {isManual: false});
  eq([tr.outcome, tr.notMeasuredReason], FUNCTIONAL_EXPECT[st], `[ق١][وظيفي][${st}] ${entry.testId} الحقيقي: outcome وnotMeasuredReason (الوظيفي لا يتغيّر)`);
  eq([tr.attested, tr.confidence], [false, 'AUTOMATIC'], `[ق١][وظيفي][${st}] غير مُشهَد به`);
}
eq(toTestResult(functionalReal('T-03'), {attestsHardwareAbsent: () => true}, null, {isManual: false}).notMeasuredReason, 'HARDWARE_ABSENT',
    '[ق١][وظيفي] unavailable مع قاعدة طراز شاهدة: HARDWARE_ABSENT (كما كان)');
eq(toTestResult({testId: 'R-01', categoryName: 'memory', status: 'not_tested'}, null, null, {isManual: false}).notMeasuredReason, 'NOT_TESTED',
    '[ق١][وظيفي][اصطناعي] not_tested عامّ بلا إذن: NOT_TESTED (كما كان)');
// الفرق المقصود بين المصدرين لقيمة واحدة: «غير متوفر» اليدوي إعلان فنّي بغياب العتاد، و«unavailable» الوظيفي «محجوب»
{
  const entry = {testId: 'M-08', categoryName: 'audio', status: 'unavailable'};
  eq([toTestResult(clone(entry), null, null, {isManual: true}).notMeasuredReason, toTestResult(clone(entry), null, null, {isManual: false}).notMeasuredReason],
      ['HARDWARE_ABSENT', 'CAPABILITY_BLOCKED'], '[ق١] الحالة نفسها لمعرّف واحد: يدوياً HARDWARE_ABSENT، ووظيفياً CAPABILITY_BLOCKED (قرار المستخدم: «والوظيفي يبقى كما هو»)');
}
// ولا قيمة يدوية «لم أختبر»/«غير متوفر» تُقرأ عطباً: لا FAIL ولا WARNING ولا PASS منهما
for (const st of ['not_tested', 'unavailable']) {
  const tr = toTestResult(manualReal(MANUAL_BY_STATUS[st]), null, null, {isManual: true});
  ok(!['FAIL', 'WARNING', 'PASS'].includes(tr.outcome), `[ق١] ${st} اليدوي لا يُقرأ عطباً ولا نجاحاً (${tr.outcome})`);
}

// ═══════════════════════════════════════════════════════════════════
// ق٢) rebuildCategoryScores — العدّ والاستبعاد
// ═══════════════════════════════════════════════════════════════════
{
  const cs = rebuildCategoryScores({}, [], clone(S11.manualResults), {});
  // display: M-02 pass · camera: M-07 pass + M-19 fail · audio: M-09 warning + M-08 unavailable · input (خريطة testId القديمة): M-11 not_tested
  const pick = (c) => ({pass: c.pass_count, fail: c.fail_count, warning: c.warning_count, not_tested: c.not_tested_count, unavailable: c.unavailable_count,
    total: c.total_count, excluded: c.excluded_count, declared: c.declared_count, measured: c.measured});
  eq(pick(cs.display), {pass: 1, fail: 0, warning: 0, not_tested: 0, unavailable: 0, total: 1, excluded: 0, declared: 1, measured: true}, '[ق٢][يدوي] display: M-02 pass');
  eq(pick(cs.camera), {pass: 1, fail: 1, warning: 0, not_tested: 0, unavailable: 0, total: 2, excluded: 0, declared: 2, measured: true}, '[ق٢][يدوي] camera: pass وfail ينفَّذان');
  eq(pick(cs.audio), {pass: 0, fail: 0, warning: 1, not_tested: 0, unavailable: 1, total: 1, excluded: 1, declared: 2, measured: true},
      '[ق٢][يدوي] audio: warning منفَّذ، وunavailable مستبعد من «المنفَّذ» ومعدود باسمه (لا يُحسب فشلاً)');
  eq(pick(cs.input), {pass: 0, fail: 0, warning: 0, not_tested: 1, unavailable: 0, total: 0, excluded: 1, declared: 1, measured: false}, '[ق٢][يدوي] input: not_tested مستبعد، لا فئة منفَّذة');
  eq([cs.input.grade, cs.input.score], ['?', 0], '[ق٢][يدوي] لا حرف لفئة كلّها «لم أختبر» (لا D)');
  // unavailable لا يُنزل نسبة النجاح: pass + unavailable = 100%، وpass + fail + unavailable = 50%
  const mk = (statuses) => rebuildCategoryScores({}, [], statuses.map((s, i) => ({testId: `M-0${i + 1}`, categoryName: 'display', status: s})), {}).display;
  eq([mk(['pass', 'unavailable']).score, mk(['pass', 'unavailable']).grade, mk(['pass', 'unavailable']).total_count], [100, 'A', 1], '[ق٢][يدوي] pass + unavailable ⟵ 100% (A) والمنفَّذ 1');
  eq([mk(['pass', 'fail', 'unavailable']).score, mk(['pass', 'fail', 'unavailable']).total_count], [50, 2], '[ق٢][يدوي] pass + fail + unavailable ⟵ 50% والمنفَّذ 2 (unavailable لا يدخل المقام)');
  eq([mk(['pass', 'not_tested']).score, mk(['pass', 'not_tested']).total_count], [100, 1], '[ق٢][يدوي] وnot_tested كذلك: لا يدخل المقام');
  eq([mk(['pass', 'warning']).warning_count, mk(['pass', 'warning']).total_count], [1, 2], '[ق٢][يدوي] warning (الخامسة المعروفة) تُعدّ منفَّذة');
}
{
  // وظيفي: الحالات الخمس الحقيقية (SN-02 «error» خارج المسألة — حالة سادسة وظيفية لا تخصّ اليدوي ولا هذا القرار)
  const fun = clone(S11.functionalResults.filter((f) => f.testId !== 'SN-02'));
  const cs = rebuildCategoryScores({}, fun, [], {});
  const c = (cat) => [cs[cat].pass_count, cs[cat].fail_count, cs[cat].warning_count, cs[cat].not_tested_count, cs[cat].unavailable_count, cs[cat].total_count];
  eq(c('cpu'), [1, 0, 0, 0, 0, 1], '[ق٢][وظيفي] cpu: C-05 pass');
  eq(c('battery'), [0, 1, 0, 0, 0, 1], '[ق٢][وظيفي] battery: B-02 fail');
  eq(c('security'), [0, 0, 1, 0, 0, 1], '[ق٢][وظيفي] security: SEC-03 warning');
  eq(c('thermal'), [0, 0, 0, 0, 1, 0], '[ق٢][وظيفي] thermal: T-03 unavailable مستبعد من المنفَّذ ومعدود باسمه');
  eq(c('cellular'), [0, 0, 0, 1, 0, 0], '[ق٢][وظيفي] cellular: N-04 not_tested مستبعد ومعدود باسمه');
  eq([cs.thermal.measured, cs.cellular.measured], [false, false], '[ق٢][وظيفي] فئتا unavailable وnot_tested وحدهما: لا قياس، لا حرف');
}

// ═══════════════════════════════════════════════════════════════════
// ق٣) computeScanSignature — الوظيفي يستبعد، واليدوي خامّ
// ═══════════════════════════════════════════════════════════════════
{
  const sig = computeScanSignature(clone(S11));
  eq(sig.manual, {'M-02': 'pass', 'M-07': 'pass', 'M-11': 'not_tested', 'M-09': 'warning', 'M-08': 'unavailable', 'M-19': 'fail'},
      '[ق٣][يدوي] التوقيع يحفظ حالة كل اختبار يدوي خاماً بالقيم الخمس (unavailable لا تُدمج ولا تسقط)');
  eq([sig.functional.thermal, sig.functional.cellular], ['0/0/0', '0/0/0'], '[ق٣][وظيفي] unavailable (T-03) وnot_tested (N-04) مستبعدان من عدّ P/F/W');
  eq([sig.functional.cpu, sig.functional.battery, sig.functional.security], ['1/0/0', '0/1/0', '0/0/1'], '[ق٣][وظيفي] pass وfail وwarning تُعدّ');
}

// ═══════════════════════════════════════════════════════════════════
// ق٤) reevaluationDecision — مصفوفة الانتقالات 5×5 لليدوي (بمُطلِقات مكتوبة باليد)
// ═══════════════════════════════════════════════════════════════════
{
  const withM02 = (status) => { const f = clone(S11); f.manualResults.find((m) => m.testId === 'M-02').status = status; return f; };
  // المُطلِقات الوحيدة بنصّ الكود وتعليقه (ق٣ — قرار حسن، تفويض 2026-10-22، أمر المستخدم 2026-10-23): pass→fail، not_tested→fail، unavailable→fail، fail→pass.
  // **unavailable حالة رابعة: كل انتقال منها أو إليها صامت إلا unavailable→fail.** (كان هذا الانتقال صامتاً قبل ق٣؛ استُبدل الاختبار الذي يثبّت ذلك لا أُضيف إليه آخر — القاعدة 23.)
  const TRIGGERS = new Map([['pass>fail', 'manual:M-02 pass→fail'], ['not_tested>fail', 'manual:M-02 not_tested→fail'], ['unavailable>fail', 'manual:M-02 unavailable→fail'], ['fail>pass', 'manual:M-02 fail→pass (maintenance?)']]);
  let fired = 0;
  let silent = 0;
  for (const o of FIVE) {
    for (const nw of FIVE) {
      const d = reevaluationDecision(computeScanSignature(withM02(nw)), computeScanSignature(withM02(o)));
      const key = `${o}>${nw}`;
      if (TRIGGERS.has(key)) {
        eq([d.forceReevaluate, d.reasons], [true, [TRIGGERS.get(key)]], `[ق٤] ${o} ⟵ ${nw}: يُطلق إعادة تقييم بسببه`);
        eq(d.maintenanceSuspected, key === 'fail>pass', `[ق٤] ${o} ⟵ ${nw}: maintenanceSuspected=${key === 'fail>pass'}`);
        fired++;
      } else {
        eq([d.forceReevaluate, d.reasons, d.maintenanceSuspected], [false, [], false], `[ق٤] ${o} ⟵ ${nw}: لا إعادة تقييم`);
        silent++;
      }
    }
  }
  eq([fired, silent], [4, 21], '[ق٤] من 25 انتقالاً: أربعة تُطلق و21 صامتة');
  // الانتقالات من unavailable وإليه (ثمانية): سبعة صامتة (ومنها fail⟵unavailable وnot_tested⟵unavailable)، وواحد يُطلق: unavailable⟵fail (ق٣)
  let touchFired = 0;
  for (const other of FIVE.filter((s) => s !== 'unavailable')) {
    for (const [o, nw] of [[other, 'unavailable'], ['unavailable', other]]) {
      const d = reevaluationDecision(computeScanSignature(withM02(nw)), computeScanSignature(withM02(o)));
      const expected = o === 'unavailable' && nw === 'fail';
      eq(d.forceReevaluate, expected, `[ق٤] ${o} ⟵ ${nw}: انتقال يمسّ unavailable ${expected ? 'يُطلق (ق٣)' : 'لا يُطلق'}`);
      if (d.forceReevaluate) touchFired++;
    }
  }
  eq(touchFired, 1, '[ق٤] من ثمانية انتقالات تمسّ unavailable: واحد يُطلق');
  // صفّ المصدر الآخر: اختبار يدوي ثانٍ (M-08 unavailable الحقيقي) يمرّ بالمصفوفة نفسها — لا خصوصية لـM-02
  const withM08 = (status) => { const f = clone(S11); f.manualResults.find((m) => m.testId === 'M-08').status = status; return f; };
  {
    const d = reevaluationDecision(computeScanSignature(withM08('fail')), computeScanSignature(withM08('unavailable')));
    eq([d.forceReevaluate, d.reasons, d.maintenanceSuspected], [true, ['manual:M-08 unavailable→fail'], false],
        '[ق٤] M-08: unavailable ⟵ fail يُطلق بسببه (ق٣)، ولا يُشتبه بصيانة');
  }
  eq(reevaluationDecision(computeScanSignature(withM08('unavailable')), computeScanSignature(withM08('fail'))).forceReevaluate, false,
      '[ق٤] M-08: fail ⟵ unavailable صامت (الاتجاه المعاكس لا يُطلق)');
  eq(reevaluationDecision(computeScanSignature(withM08('fail')), computeScanSignature(withM08('not_tested'))).forceReevaluate, true,
      '[ق٤] M-08: not_tested ⟵ fail يُطلق كما كان (الفرق بين الحالتين الرابعة والثالثة)');
}

// ═══════════════════════════════════════════════════════════════════
// المسار الكامل (القاعدة 37): categoryStates ← حمولة النموذج ← فهرس الإعفاء — بالصفوف الحقيقية
// ═══════════════════════════════════════════════════════════════════
{
  const rawTs = readJson('b45c8cf6.ts.json');
  const battery = sampleInputsFromRaw(rawTs);
  const run = (fp) => computeCategoryStates({
    functionalResults: clone(fp.functionalResults), manualResults: clone(fp.manualResults), dev: null,
    batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design, analyzedAtMs: Date.parse('2026-10-10T00:00:00.000Z'),
  });
  const cs = run(S11);
  const tr = (id) => cs.testResults.find((t) => t.testId === id);
  const outcomes = Object.fromEntries(['M-02', 'M-07', 'M-11', 'M-09', 'M-08', 'M-19'].map((id) => [id, [tr(id).outcome, tr(id).notMeasuredReason]]));
  eq(outcomes, {
    'M-02': ['PASS', null], 'M-07': ['PASS', null], 'M-11': ['NOT_MEASURED', 'OPERATOR_SKIPPED'],
    'M-09': ['WARNING', null], 'M-08': ['NOT_MEASURED', 'HARDWARE_ABSENT'], 'M-19': ['FAIL', null],
  }, '[المسار] computeCategoryStates بالصفوف الستّة الحقيقية: كلّ outcome وسببه');
  ok(['M-02', 'M-07', 'M-11', 'M-09', 'M-08', 'M-19'].every((id) => tr(id).attested === true), '[المسار] كلّها بشهادة الفنّي');
  // ما يُعرَض: غير المقيس يصير ملاحظة DISC («غير مقيس — الفئة») لا عطباً، وwarning/fail عطب ISS
  const issue = (id) => (cs.issues || []).find((i) => i.id === id);
  eq(issue('DISC-M-08').severity, 'INFO', '[المسار] M-08 (unavailable): ملاحظة معلومة DISC لا عطب');
  eq(issue('DISC-M-08').title, `غير مقيس — ${CATEGORY_NAME_AR[issue('DISC-M-08').category] || issue('DISC-M-08').category}`, '[المسار] وعنوانها «غير مقيس — <الفئة>» (S2)');
  eq(issue('DISC-M-11').severity, 'INFO', '[المسار] M-11 (not_tested): ملاحظة معلومة كذلك');
  ok(issue('ISS-M-08') === undefined && issue('ISS-M-11') === undefined, '[المسار] ولا عطب ISS لـunavailable ولا لـnot_tested (لا تُقرأ عطباً)');
  eq([issue('ISS-M-19').severity, issue('ISS-M-09').severity], ['FAIL', 'WARNING'], '[المسار] وfail وwarning عطبان بشدّتيهما');
  ok(issue('ISS-M-07') === undefined && issue('ISS-M-02') === undefined, '[المسار] وpass لا عطب');
  // ما يراه النموذج: السبب كما صُنِّف (HARDWARE_ABSENT)، والحالة الخام unavailable تصل
  const model = sanitizeTestResultsForModelPayload(cs.testResults);
  const m08 = model.find((t) => t.testId === 'M-08');
  eq([m08.outcome, m08.notMeasuredReason, m08.raw.status], ['NOT_MEASURED', 'HARDWARE_ABSENT', 'unavailable'], '[المسار] حمولة النموذج: M-08 بسببه HARDWARE_ABSENT وحالته الخام unavailable');
  eq(model.find((t) => t.testId === 'M-11').notMeasuredReason, 'OPERATOR_SKIPPED', '[المسار] وM-11 (لم أختبر) يبقى OPERATOR_SKIPPED — السببان مختلفان للنموذج');
  // فهرس إعفاء التسرّب اللغوي: كلمات السبب الجديد تدخله (الآلية بنائية على اسم الحقل، لا قائمة أسباب)
  const index = buildLeakExemptionIndex({categoryStates: cs});
  ok(index.has('hardware') && index.has('absent'), '[المسار] كلمتا HARDWARE_ABSENT في فهرس إعفاء التسرّب (لا يُرفض سردٌ يذكر السبب)');
  // العيّنات الثلاث كلّها: لا عطب من unavailable/not_tested في أيّ منها، وM-08 دائماً HARDWARE_ABSENT
  for (const s of STEMS) {
    const c = run(SAMPLE[s]);
    const r = (id) => c.testResults.find((t) => t.testId === id);
    eq([r('M-08').outcome, r('M-08').notMeasuredReason], ['NOT_MEASURED', 'HARDWARE_ABSENT'], `[المسار][${s}] M-08 HARDWARE_ABSENT`);
    ok(!(c.issues || []).some((i) => /^ISS-M-(08|11)$/.test(i.id)), `[المسار][${s}] لا عطب لـM-08 وM-11`);
    const m02 = SAMPLE[s].manualResults.find((m) => m.testId === 'M-02').status;
    eq([r('M-02').outcome, r('M-02').notMeasuredReason], MANUAL_EXPECT[m02], `[المسار][${s}] M-02 (${m02}): ${MANUAL_EXPECT[m02].join('/')}`);
  }
}

console.log(`\nmanualStatusesFourValues.test.js: ${n}/${n} assertions passed`);
