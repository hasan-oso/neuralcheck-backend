'use strict';

// findingsFv68Readers.test.js — الدفعة ٤ من V8 (PLAN-05): findings.js يقرأ حمولة fv68.
//
// البنود (أمر الدفعة ٤، بنصّها في docs/FV68_READERS_INVENTORY.md والخطّة PLAN-05-EVIDENCE-REPORT.md:646-666):
//   ٢) القراءة بالأسماء: charge_counter_raw بدل charge_counter_uah، وvariables[] بطول متغيّر بدل الفهارس الثابتة.
//   ٣) cpuTempFinalC بدل maxCpuTemp و-1.
//   ١) س-27: كل قارئ يستثني العيّنات الفاشلة (channelReadFailures) — **اختبار لكل قارئ**:
//        قارئ ١ findings.channels (إحصاء قناة لكل مرحلة)     ← قسم ز
//        قارئ ٢ findings.battery (qCcMah/ccUpdates/BAT-CONSIST/BAT-CAP) ← قسم ج
//        قارئ ٣ findings.battery.charge_counter.series         ← قسم ج
//        قارئ ٤ detectCcDerived وchangesValid (الدالّتان)      ← قسم ح
//        قارئ ٥ sampleInputsFromRaw (لا يقرأ أعمدة القنوات الإضافية أصلاً) ← قسم ط
//        قارئ ٦ admin/runConsistencyTest (مستقلّ عن قيم الأعمدة الإضافية) ← runConsistencyTestByName.test.js
// الشكل الذي يستقبله القارئ فعلاً (القاعدة 41): العيّنات الذهبية الثلاث لحمولة التطبيق وحمولة 1.0.10 (fv67).
// (مُحدَّث 2026-10-10 +03: العيّنات الثلاث الآن على fv69 — NeuralChek@a04b4f0 — وfv68 لم يُشحن في أيّ APK؛ findings.js يقرأ بعتبة ≥ 68 فتُقرأ fv69 كما fv68.)
// ⚠️ مشتقّة لا مسجَّلة من جهاز على fv69؛ ما لا تحمله (فهارس فشل مخصَّصة، تخطيطات مرتّبة بغير الأساسي) يُبنى بتعديل نسخة منها ويُوسَم اصطناعياً.
//
// Run: node functions/test/findingsFv68Readers.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeFindings, _internal} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {unclassifiedFindingsKeys, sanitizeFindingsForModelPayload} = require('../src/analysis/buildV7Payload')._internal;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const STEMS = ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures'];
const load = (stem) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.json`), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const fv67 = () => JSON.parse(fs.readFileSync(path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'), 'utf8')).fingerprint;

// يلتقط console.error (findings تسجّل سقوطها إلى HARNESS_ERROR فيه) دون تلويث المخرَج
function captureErrors(fn) {
  const saved = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(' '));
  try {
    return {result: fn(), lines};
  } finally {
    console.error = saved;
  }
}

const BASE = ['battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct', 'cpu_freq_max_khz', 'cpu_usage_pct',
  'package_power_mw', 'storage_throughput_mbps', 'memory_bandwidth_mbps', 'gpu_fps'];

// ═══════════════════════════════════════════════════════════════════
// أ) القراءة بالأسماء على الحمولات الثلاث
// ═══════════════════════════════════════════════════════════════════
const F = {};
for (const s of STEMS) F[s] = computeFindings(load(s));
const F67 = computeFindings(fv67());

for (const [s, cols] of [['11ch-nothing-admitted', 0], ['13ch-selinux-blocked-policy', 2], ['16ch-four-policies-truncated-failures', 5]]) {
  const f = F[s];
  eq(f.status, 'MEASURED', `[أ][${s}] findings محسوبة (لا HARNESS_ERROR) من حمولة fv69 (تُقرأ بعتبة ≥ 68)`);
  eq(f.meta.fieldsVersion, 69, `[أ][${s}] fieldsVersion=69`);
  const expected = BASE.concat(
      s === '11ch-nothing-admitted' ? [] :
        s === '13ch-selinux-blocked-policy' ? ['charge_counter_raw', 'cpu_freq_policy0_khz'] :
          ['charge_counter_raw', 'cpu_freq_policy0_khz', 'cpu_freq_policy2_khz', 'cpu_freq_policy4_khz', 'cpu_freq_policy6_khz']);
  eq(Object.keys(f.channels), expected, `[أ][${s}] قنوات findings.channels = الأساسية العشر + ما أُدرج بأسمائها (الطول ${10 + cols} من variables[] لا من ثابت)`);
  eq(Object.keys(f.perChannelUpdateCount), ['battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct'], `[أ][${s}] perChannelUpdateCount بالأسماء`);
}
// عمود جديد يصل الحمولة ويُقرأ باسمه: إحصاء السياسة 0 في 13ch يطابق حساباً مستقلّاً من العيّنات الخام
{
  const fp = load('13ch-selinux-blocked-policy');
  const col = fp.timeSeries.variables.findIndex((v) => v.name === 'cpu_freq_policy0_khz');
  eq(col, 12, '[أ] cpu_freq_policy0_khz في الموضع 12');
  const vals = fp.timeSeries.samples.filter((s) => s.phase === 3).map((s) => s.v[col]);
  const stat = F['13ch-selinux-blocked-policy'].channels.cpu_freq_policy0_khz.CPU_SUSTAINED;
  eq([stat.n, stat.min, stat.max], [vals.length, Math.min(...vals), Math.max(...vals)], '[أ] إحصاء قناة جديدة (n/min/max) = حسابها المستقلّ من العيّنات الخام بالاسم');
}

// حمولة بلا index ≡ نفسها بـindex (القراءة بالموضع = القراءة بالفهرس المعلن) — fv67
{
  const withIndex = fv67();
  withIndex.timeSeries.variables = withIndex.timeSeries.variables.map((v, i) => ({index: i, ...v}));
  eq(computeFindings(withIndex), F67, '[أ] حمولة 1.0.10: findings بـvariables[] بلا index مطابقة لها بـindex معلن');
}

// ثبات findings تحت إعادة ترتيب الأعمدة (إثبات أن القراءة بالاسم لا بالفهرس)
{
  const swap = (fp, i, j) => {
    const m = clone(fp);
    const t = m.timeSeries;
    [t.variables[i], t.variables[j]] = [t.variables[j], t.variables[i]];
    for (const s of t.samples) [s.v[i], s.v[j]] = [s.v[j], s.v[i]];
    return m;
  };
  const orig = load('13ch-selinux-blocked-policy');
  // الأعمدة الإضافية (11 و12) في بعضها: لا أثر على الأساسية
  eq(computeFindings(swap(orig, 11, 12)).battery.qIntMah, F['13ch-selinux-blocked-policy'].battery.qIntMah, '[أ] تبديل عمودين إضافيين: qIntMah كما هي');
  // الأساسيان 5 و6 (cpu_freq_max_khz وcpu_usage_pct) بعد تبديلهما في variables[] وكل العيّنات: findings نفسها حرفياً
  const swapped = captureErrors(() => computeFindings(swap(orig, 5, 6)));
  const base = F['13ch-selinux-blocked-policy'];
  eq(swapped.result.channels, base.channels, '[أ] تبديل عمودين أساسيين (5↔6) في variables[] والعيّنات: findings.channels نفسها بأسمائها');
  eq(swapped.result.sustainedCeiling, base.sustainedCeiling, '[أ] والسقف المستدام (يقرأ cpu_freq_max_khz) نفسه');
  eq(swapped.result.battery, base.battery, '[أ] والبطارية نفسها');
  eq(swapped.result.graphics, base.graphics, '[أ] والرسوميات نفسها');
  eq(swapped.result.thermal, base.thermal, '[أ] والحرارة نفسها');
  ok(swapped.lines.length === 0, '[أ] ولا HARNESS_ERROR: القراءة بالاسم لا تفرّق بين تخطيطين');
}
// مقابل ذلك: لو قُرئ بالفهرس لتغيّر الناتج — الضابط السلبي: نبدّل في العيّنات وحدها (variables[] تبقى) فتتغيّر النتيجة
{
  const m = clone(load('13ch-selinux-blocked-policy'));
  for (const s of m.timeSeries.samples) [s.v[5], s.v[6]] = [s.v[6], s.v[5]];
  const f = computeFindings(m);
  ok(JSON.stringify(f.sustainedCeiling) !== JSON.stringify(F['13ch-selinux-blocked-policy'].sustainedCeiling),
      '[أ] ضابط سلبي: تبديل العيّنات وحدها (variables[] تقول غير ذلك) يُغيّر السقف المستدام — فالاختبار أعلاه يفرّق فعلاً بين الاسم والفهرس');
}

// عمود أساسي غائب ← HARNESS_ERROR معلن، لا قراءة بفهرس مخمَّن
{
  const m = clone(load('13ch-selinux-blocked-policy'));
  const i = m.timeSeries.variables.findIndex((v) => v.name === 'gpu_fps');
  m.timeSeries.variables.splice(i, 1);
  for (const s of m.timeSeries.samples) s.v.splice(i, 1);
  const {result, lines} = captureErrors(() => computeFindings(m));
  eq([result.status, result.notMeasuredReason], ['NOT_MEASURED', 'HARNESS_ERROR'], '[أ] gpu_fps غائب من variables[]: HARNESS_ERROR صريح');
  ok(lines.some((l) => l.includes('gpu_fps') && l.includes('not resolvable by name')), '[أ] والسجلّ يسمّي العمود الناقص');
  eq(result.battery.qIntMah.status, 'NOT_MEASURED', '[أ] ولا مشتقّ يُحسب بقيمة عمود آخر');
}
// بلا variables: ختم ≤ 67 يقرأ بالترتيب الثابت المُعلَن، وختم ≥ 68 لا يخمّن
{
  const m = fv67();
  delete m.timeSeries.variables;
  const lay = require('../src/analysis/fv68Reader').resolveLayout([], m.timeSeries.samples);
  const r67 = _internal.resolveBaseColumns(lay, 67);
  eq([r67.source, r67.byName.gpu_fps], ['FALLBACK_TABLE_NO_VARIABLES', 10], '[أ] ختم 67 بلا variables: الترتيب الثابت، ومصدره مُعلَن');
  eq(computeFindings(m).channels, F67.channels, '[أ] وfindings مطابقة لما تُنتجه variables[] الصريحة');
  eq(computeFindings(m).battery, F67.battery, '[أ] والبطارية كذلك');
  let threw = null;
  try { _internal.resolveBaseColumns(lay, 68); } catch (e) { threw = e.message; }
  ok(threw && threw.includes('not resolvable by name') && threw.includes('fieldsVersion=68'), '[أ] ختم 68 بلا variables: يرمي (فيُترجَم HARNESS_ERROR) ولا يخمّن');
  const m68 = clone(load('11ch-nothing-admitted'));
  delete m68.timeSeries.variables;
  const r68 = captureErrors(() => computeFindings(m68)).result;
  eq([r68.status, r68.notMeasuredReason], ['NOT_MEASURED', 'HARNESS_ERROR'], '[أ] وfv68 بلا variables عبر computeFindings: HARNESS_ERROR');
  const noFv = clone(m); delete noFv.timeSeries.footer.fieldsVersion;
  eq(_internal.resolveBaseColumns(lay, null).source, 'FALLBACK_TABLE_NO_VARIABLES', '[أ] بلا ختم أصلاً: كالقديم (معلَن)');
}
// لا مفتاح علوي جديد في findings: لا يمسّ سياسة النموذج ولا فهرس التوكنز (reportShapeV7.collectFindingsFieldNameTokens)
{
  const keys67 = Object.keys(F67).sort();
  for (const s of STEMS) eq(Object.keys(F[s]).sort(), keys67, `[أ][${s}] المفاتيح العلوية في findings هي نفسها لحمولة fv67 (لا مفتاح جديد يتسرّب إلى فهرس التوكنز)`);
  eq(unclassifiedFindingsKeys(F['13ch-selinux-blocked-policy']), [], '[أ] وكل مفتاح علوي مُصنَّف في MODEL_FINDINGS_POLICY');
  const forModel = sanitizeFindingsForModelPayload(F['13ch-selinux-blocked-policy']);
  eq(Object.keys(forModel.battery).sort(), ['note', 'status'], '[أ] والنموذج لا يرى قيم البطارية (لا qCcMah ولا سلسلة): حالتها وحدها {status, note}');
  eq(forModel.battery.status, 'MEASURED', '[أ] qIntMah عدد فعلي في المصدر ← «مقيس» (سياسة STATE: لا قيمة تصل النموذج)');
}

// ═══════════════════════════════════════════════════════════════════
// ب) charge_counter_raw: الاسم والوحدة المعلنة
// ═══════════════════════════════════════════════════════════════════
{
  const f = F['13ch-selinux-blocked-policy'];
  const series = f.battery.charge_counter.series;
  eq([series.status, series.reason], ['NOT_MEASURED', 'UNIT_UNDECLARED'], '[ب] السلسلة الخام موجودة بالاسم الجديد، ووحدتها «as_declared_by_device» ليست وحدة: UNIT_UNDECLARED');
  eq([series.unit, series.unitSource], [null, 'AS_DECLARED_BY_DEVICE'], '[ب] لا وحدة، والمصدر يقول لماذا');
  eq(series.rawValues.length, 1606, '[ب] وقيمها الخام لكل عيّنة');
  eq(f.battery.qCcMah, {status: 'NOT_MEASURED', reason: 'UNIT_UNDECLARED'}, '[ب] qCcMah: لا قسمة افتراضية على 1000 (A100/A38)');
  eq(F['11ch-nothing-admitted'].battery.charge_counter.series,
      {status: 'NOT_MEASURED', reason: 'ABSENT', rawValues: null, unit: null, unitSource: 'ABSENT'}, '[ب] 11ch: القناة غير مُدرجة ← ABSENT (لا سلسلة)');
  // الاسم القديم لا يُقرأ: لو أُعيدت تسمية العمود charge_counter_uah ما وُجدت السلسلة
  const old = clone(load('13ch-selinux-blocked-policy'));
  old.timeSeries.variables[11].name = 'charge_counter_uah';
  eq(computeFindings(old).battery.charge_counter.series.status, 'NOT_MEASURED', '[ب] charge_counter_uah (الاسم القديم) لم يعد يُقرأ قناةً');
  eq(computeFindings(old).battery.charge_counter.series.reason, 'ABSENT', '[ب] بل ABSENT');
}

// ═══════════════════════════════════════════════════════════════════
// ج) قارئا البطارية والسلسلة: S-27 (اصطناعي فوق 13ch: عيّنات فاشلة بقيم تالفة صريحة)
// ═══════════════════════════════════════════════════════════════════
// نبني حمولة 13ch بـ800 عيّنة، وحدة µAh معلنة (ليُحسب qCcMah عدداً)، وقائمة فشل بقيم تالفة في مواضعها.
function ccPayload({failed, junk, listed, count, unit = 'µAh', untracked = false, samplesCount = 800}) {
  const m = clone(load('13ch-selinux-blocked-policy'));
  m.timeSeries.samples = m.timeSeries.samples.slice(0, samplesCount);
  const col = 11;
  m.timeSeries.variables[col].unit = unit;
  const real = m.timeSeries.samples.map((s) => s.v[col]);
  failed.forEach((i) => { m.timeSeries.samples[i].v[col] = junk; });
  m.timeSeries.footer.channelReadFailures = {charge_counter_raw: listed === undefined ? failed.slice() : listed, cpu_freq_policy0_khz: []};
  m.timeSeries.footer.channelReadFailureCounts = {charge_counter_raw: count === undefined ? failed.length : count, cpu_freq_policy0_khz: 0};
  if (untracked) {
    delete m.timeSeries.footer.channelReadFailures.charge_counter_raw;
    delete m.timeSeries.footer.channelReadFailureCounts.charge_counter_raw;
  }
  return {payload: m, real};
}
{
  const FAILED = [0, 1, 2, 400, 799]; // العيّنة الأولى والأخيرة منها: تتحكّمان في qCcMah
  const a = ccPayload({failed: FAILED, junk: 123456789});
  const b = ccPayload({failed: FAILED, junk: -5});
  const fa = computeFindings(a.payload);
  const fb = computeFindings(b.payload);
  eq(fa.battery, fb.battery, '[ج] قارئ findings.battery: قيمة تالفة مختلفة في مواضع الفشل لا تُغيّر شيئاً (الفاشلة تُستثنى)');
  eq(fa.battery.charge_counter.series, fb.battery.charge_counter.series, '[ج] وكذلك السلسلة الخام');
  const series = fa.battery.charge_counter.series;
  eq([series.status, series.readFailures.exclusion, series.readFailures.excludedCount], ['MEASURED', 'COMPLETE', 5], '[ج] السلسلة MEASURED بوحدة حقيقية معلنة، واستثناء تامّ لخمس عيّنات');
  eq(FAILED.map((i) => series.rawValues[i]), [null, null, null, null, null], '[ج] ومواضع الفاشلة null في rawValues');
  ok(series.rawValues[3] === a.real[3] && series.rawValues[798] === a.real[798], '[ج] وغيرها خام كما هو');
  // qCcMah من أوّل وآخر قراءة **صالحة** لا من العيّنتين الفاشلتين
  const firstValid = a.real[3];
  const lastValid = a.real[798];
  ok(typeof fa.battery.qCcMah === 'number' && Math.abs(fa.battery.qCcMah - (firstValid - lastValid) / 1000) < 1e-9,
      '[ج] qCcMah = (أوّل صالحة − آخر صالحة) ÷ 1000 (µAh المعلنة) — العيّنتان 0 و799 الفاشلتان لا تدخلان');
  // وبلا الاستثناء (لو لم تُذكر الفاشلة) لتغيّر الرقم — ضابط سلبي
  const noList = ccPayload({failed: FAILED, junk: 123456789, listed: [], count: 0});
  ok(computeFindings(noList.payload).battery.qCcMah !== fa.battery.qCcMah, '[ج] ضابط سلبي: لو لم تُسمَّ الفاشلة (count=0) لدخلت التالفة في qCcMah فتغيّر');
  const ccUp = fa.battery.ccUpdates;
  const expectedUpdates = (() => { let c = 0; let p = null; a.real.forEach((x, i) => { if (FAILED.includes(i)) return; if (p !== null && x !== p) c++; p = x; }); return c; })();
  eq(ccUp, expectedUpdates, '[ج] ccUpdates = التغيّرات بين القيم الصالحة المتتالية (حساب مستقلّ هنا)');

  // اكتمال الاستثناء يحكم المشتقّات
  for (const [label, opts, reason] of [
    ['قائمة مبتورة (count=9 > 5)', {failed: FAILED, junk: 7, count: 9}, 'TRUNCATED'],
    ['قائمة بلا count', {failed: FAILED, junk: 7, count: null}, 'COUNT_ABSENT'],
    ['القناة غير متتبَّعة (لا مفتاح)', {failed: FAILED, junk: 7, untracked: true}, 'UNTRACKED'],
  ]) {
    const p = ccPayload(opts).payload;
    if (opts.count === null) delete p.timeSeries.footer.channelReadFailureCounts.charge_counter_raw;
    const f = computeFindings(p);
    eq(f.battery.qCcMah, {status: 'NOT_MEASURED', reason: 'READ_FAILURES_UNRESOLVED'}, `[ج] ${label}: qCcMah غير مقيس بسببه`);
    eq([f.battery.consist.reason, f.battery.cap.reason], ['READ_FAILURES_UNRESOLVED', 'READ_FAILURES_UNRESOLVED'], `[ج] ${label}: BAT-CONSIST وBAT-CAP كذلك`);
    eq([f.battery.ccUpdates, f.battery.ccDerived], [null, null], `[ج] ${label}: ccUpdates وccDerived null لا أرقام مختلَقة`);
    eq([f.battery.charge_counter.series.status, f.battery.charge_counter.series.reason], ['NOT_MEASURED', 'READ_FAILURES_UNRESOLVED'], `[ج] ${label}: السلسلة غير مقيسة بسببها`);
    eq(f.battery.charge_counter.series.readFailures.exclusion, reason, `[ج] ${label}: والاستثناء يُسمَّى ${reason}`);
    ok(Array.isArray(f.battery.charge_counter.series.rawValues) && f.battery.charge_counter.series.rawValues.length === 800, `[ج] ${label}: والخام يبقى مُصدَّراً`);
  }
  // كل القراءات فاشلة: لا قراءة صالحة
  const all = ccPayload({failed: Array.from({length: 60}, (_, i) => i), junk: 1, samplesCount: 60});
  const fAll = computeFindings(all.payload);
  eq(fAll.battery.qCcMah, {status: 'NOT_MEASURED', reason: 'NO_VALID_READS'}, '[ج] كل عيّنات القناة فاشلة: NO_VALID_READS');
  eq(fAll.battery.consist, {status: 'NOT_MEASURED', reason: 'NO_VALID_READS'}, '[ج] BAT-CONSIST كذلك');
  // الفاصل بين انتقالين في مستوى الشحن: الطرف الفاشل يُتخطّى (BAT-CAP يحتاج فاصلين صالحين)
  // ‏(مقارنة الاستقلال عن القيمة التالفة كافية هنا: fa.battery == fb.battery أعلاه يشمل cap وconsist)
}

// ═══════════════════════════════════════════════════════════════════
// ح) الدالّتان: detectCcDerived وchangesValid بـnull
// ═══════════════════════════════════════════════════════════════════
{
  const lvl = [90, 90, 89, 89, 88, 88, 87, 87];
  const cc = [900, 900, 890, 890, 880, 880, 870, 870]; // مشتقّ من المستوى تماماً
  const withNulls = cc.map((x, i) => ([1, 4].includes(i) ? null : x));
  eq(_internal.detectCcDerived(cc, lvl), true, '[ح] بلا null: مشتقّ من المستوى ← true');
  eq(_internal.detectCcDerived(withNulls, lvl), true, '[ح] مع null في مواضع فاشلة: النتيجة نفسها (الفاشلة تُستثنى)');
  const indep = [900, 897, 890, 881, 880, 879, 870, 860];
  eq(_internal.detectCcDerived(indep, lvl), false, '[ح] مستقلّ عن المستوى ← false');
  eq(_internal.detectCcDerived(indep.map((x, i) => ([1, 3].includes(i) ? null : x)), lvl), false, '[ح] ومع null يبقى false');
  eq(_internal.detectCcDerived([null, null, null], [1, 2, 3]), false, '[ح] كلّه null ← false (لا سلسلة تُحكم عليها)');
  eq(_internal.detectCcDerived([5], [90]), true, '[ح] عيّنة واحدة صالحة كالسابق (true)');
  eq(_internal.changesValid([1, 1, 2, 2, 3]), _internal.changes([1, 1, 2, 2, 3]), '[ح] changesValid بلا null = changes حرفاً');
  eq(_internal.changesValid([1, null, 1, null, 2]), 1, '[ح] changesValid تتخطّى null: 1→1→2 تغيّر واحد');
  eq(_internal.changesValid([null, null]), 0, '[ح] كلّه null ← 0 تغيّر (والمشتقّ المحجوب يُعلَن في computeBattery لا هنا)');
  eq(_internal.maskFailedReads([1, 2, 3, undefined, NaN, 'x'], new Set([0])), [null, 2, 3, null, null, null], '[ح] maskFailedReads: الفاشل وغير الرقمي null');
  eq(_internal.ccExclusionBlocks('COMPLETE'), false, '[ح] COMPLETE لا يحجب');
  eq(_internal.ccExclusionBlocks('NOT_TRACKED_BY_DESIGN'), false, '[ح] NOT_TRACKED_BY_DESIGN لا يحجب (قيد معروف بنصّ الحسم)');
  eq(['TRUNCATED', 'COUNT_ABSENT', 'UNTRACKED'].map(_internal.ccExclusionBlocks), [true, true, true], '[ح] المبتور وبلا count وغير المتتبَّع يحجب');
}

// ═══════════════════════════════════════════════════════════════════
// ز) قارئ findings.channels: إحصاء كل قناة يستثني فاشلاتها (S-27)
// ═══════════════════════════════════════════════════════════════════
{
  const fp = load('16ch-four-policies-truncated-failures');
  const t = fp.timeSeries;
  const idx = (name) => t.variables.findIndex((v) => v.name === name);
  const failures = t.footer.channelReadFailures;
  const meanOf = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const name of ['cpu_freq_policy2_khz', 'cpu_freq_policy6_khz']) {
    const col = idx(name);
    const failedSet = new Set(failures[name]);
    // تلف القيم الفاشلة بقيمة صريحة بعيدة، ثم المقارنة بحساب مستقلّ من القيم الصالحة وحدها
    const m = clone(fp);
    for (const i of failedSet) m.timeSeries.samples[i].v[col] = 9e9;
    const f = computeFindings(m);
    for (const [phaseName, phase] of [['CPU_SUSTAINED', 3], ['COMBINED', 5], ['STORAGE', 1], ['INIT', 0]]) {
      const valid = m.timeSeries.samples.map((s, i) => [s, i]).filter(([s, i]) => s.phase === phase && !failedSet.has(i)).map(([s]) => s.v[col]);
      const st = f.channels[name][phaseName];
      if (!valid.length) { eq(st, null, `[ز] ${name}/${phaseName}: كل عيّناتها فاشلة أو غائبة ← null (لا إحصاء)`); continue; }
      eq([st.n, st.min, st.max], [valid.length, Math.min(...valid), Math.max(...valid)], `[ز] ${name}/${phaseName}: n/min/max من الصالحة وحدها (الفاشلة 9e9 لا تدخل)`);
      ok(Math.abs(st.mean - meanOf(valid)) < 1e-6, `[ز] ${name}/${phaseName}: المتوسّط من الصالحة وحدها`);
    }
    // ضابط سلبي: لو أُسقطت قائمة الفشل لدخلت الـ9e9
    const noList = clone(m);
    noList.timeSeries.footer.channelReadFailures[name] = [];
    noList.timeSeries.footer.channelReadFailureCounts[name] = 0;
    const g = computeFindings(noList);
    ok(Object.values(g.channels[name]).some((st) => st && st.max === 9e9), `[ز] ضابط سلبي ${name}: بلا قائمة فشل تدخل القيمة التالفة في الإحصاء`);
  }
  // القناة المبتورة (policy2: 230 فشلاً سُمّي 200): الإحصاء يستثني المسمّاة، والاستثناء ناقص مُعلَن في المخرَج الأعلى لا في findings
  eq(computeFindings(fp).channels.cpu_freq_policy2_khz.CPU_SUSTAINED.n,
      fp.timeSeries.samples.filter((s, i) => s.phase === 3 && !new Set(failures.cpu_freq_policy2_khz).has(i)).length, '[ز] مبتورة: المسمّاة وحدها تُستثنى (والنقص يُعلَن في readFv68.channelReadFailures: TRUNCATED)');
  // الأعمدة الأساسية لا تُستثنى منها عيّنات (حرّاسها قيد معروف بنصّ الحسم)
  const base = computeFindings(fp).channels.battery_temp_c.CPU_SUSTAINED;
  eq(base.n, fp.timeSeries.samples.filter((s) => s.phase === 3).length, '[ز] battery_temp_c: كل عيّنات المرحلة (لا استثناء لأساسية)');
}

// ═══════════════════════════════════════════════════════════════════
// ط) sampleInputsFromRaw: لا يقرأ الأعمدة الإضافية — ثابت تحت أيّ تلف فيها
// ═══════════════════════════════════════════════════════════════════
{
  const fp = load('16ch-four-policies-truncated-failures');
  const before = sampleInputsFromRaw(fp);
  const m = clone(fp);
  for (const s of m.timeSeries.samples) for (let i = 11; i < s.v.length; i++) s.v[i] = -1;
  eq(sampleInputsFromRaw(m), before, '[ط] تلف كل الأعمدة الإضافية (≥ 11) لا يغيّر مُدخلات البطارية: القارئ يقرأ v[0..4] الأساسية وحدها');
  eq(Object.keys(before.sampleInputs), ['n', 't', 'ph', 'temp', 'volt', 'cur', 'lvl'], '[ط] وشكله كما هو');
}

// ═══════════════════════════════════════════════════════════════════
// د) حرارة المعالج النهائية في قائمة الحقول غير المقيسة (G7)
// ═══════════════════════════════════════════════════════════════════
{
  const nmf = (s) => F[s].notMeasuredFields;
  eq(nmf('11ch-nothing-admitted'), [{field: 'cpuTempFinalC', scope: 'footer', reason: 'NO_CPU_TEMP_SENSOR', value: null}],
      '[د] fv68 بلا حرارة معالج (cpuTempFinalSource=absent:…): الحقل الجديد يدخل القائمة بسبب الغياب نفسه، بلا -1 ولا maxCpuTemp');
  eq(nmf('13ch-selinux-blocked-policy'), [], '[د] قراءة حيّة عند الإنهاء ← لا إدخال');
  eq(nmf('16ch-four-policies-truncated-failures'), [], '[د] أقصى المجمِّع ← لا إدخال');
  const m = clone(load('13ch-selinux-blocked-policy'));
  m.timeSeries.footer.cpuTempFinalSource = 'absent:zz';
  delete m.timeSeries.footer.cpuTempFinalC;
  eq(computeFindings(m).notMeasuredFields.map((x) => x.field), ['cpuTempFinalC'], '[د] الشرط هو البادئة absent: لا نصّ السبب');
  const m2 = clone(load('13ch-selinux-blocked-policy'));
  m2.timeSeries.footer.cpuTempFinalSource = 'something_else';
  eq(computeFindings(m2).notMeasuredFields, [], '[د] مصدر غير معروف لا يُقرأ «غياباً» ولا يُخترع إدخال (يُعلَنه fv68Reader: UNRECOGNIZED)');
  // ختم 67: الفرع القديم كما هو
  ok(F67.notMeasuredFields.map((x) => x.field).includes('maxCpuTemp'), '[د] ختم 67: maxCpuTemp = -1 يبقى يُقرأ NO_CPU_TEMP_SENSOR (الفرع القديم لم يُمسّ)');
  ok(!F67.notMeasuredFields.map((x) => x.field).includes('cpuTempFinalC'), '[د] ولا يدخل cpuTempFinalC في 67');
  // ختم 68 بحقل maxCpuTemp قديم (ملفّ أقدم عبر بانٍ fv68): لا يُقرأ -1 غياباً
  const m3 = clone(load('13ch-selinux-blocked-policy'));
  m3.timeSeries.footer.maxCpuTemp = -1;
  m3.timeSeries.footer.tempRiseRateInProbe = 0;
  eq(computeFindings(m3).notMeasuredFields, [], '[د] ختم 68: maxCpuTemp=-1 لا يُقرأ NO_CPU_TEMP_SENSOR (الفرع القديم خاصّ بـ ≤ 67؛ الحقل المحذوف يُعلَن شذوذاً في fv68Reader)');
}

console.log(`\nfindingsFv68Readers.test.js: ${n}/${n} assertions passed`);
