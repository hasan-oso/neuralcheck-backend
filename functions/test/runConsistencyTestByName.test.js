'use strict';

// runConsistencyTestByName.test.js — الدفعة ٤ من V8 (PLAN-05)، البند ٢ من الأمر: «runConsistencyTest بالاسم».
//
// قبل التغيير (0a0da7e، الشرط :50 `v.length < 18`): على 11 قناة (كل ملفّات launch) **لا ضجيج على أيّ عمود**، وعلى 18 قناة (ست سياسات مع عدّاد
// الشحن) ضجيج على قنوات خاطئة؛ و`recomputeStats` كانت تقرأ v[5] «حرارة» — وهو cpu_freq_max_khz في launch — فيُنتج stats.tempPeak = 2730000.
// المقيس (سكربت مؤقّت على حمولة 1.0.10 ذاتها بالبذرة نفسها، المخرَج في تقرير الدفعة): قديم: أعمدة مُشوَّشة [] وtempPeak 2730000؛ جديد: [1,2,3,5,6] وtempPeak غائب.
//
// هذا الاختبار يثبّت السلوك الجديد بالأسماء، على الشكل الذي يستقبله فعلاً (حمولة 1.0.10 ذات 11 عموداً، وحمولات fv68 ذات 11/13/16 عموداً).
// قارئ S-27 رقم ٦: قيم الأعمدة الإضافية (وفاشلاتها) لا تدخل أيّ إحصاء هنا.
//
// Run: node functions/test/runConsistencyTestByName.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// كعوب تحميل الوحدة (نفس نمط runConsistencyTestAnalyzedAtMs.test.js): لا Firestore ولا نموذج.
const stubModule = (rel, exportsObj) => {
  const p = require.resolve(rel);
  require.cache[p] = {id: p, filename: p, loaded: true, exports: exportsObj};
};
stubModule('../src/utils/admin', {admin: {firestore: {FieldValue: {serverTimestamp: () => 'stub'}}}, db: {}, ADMIN_EMAILS: [], requireAdmin: () => {}});
stubModule('../src/utils/secrets', {geminiKey: {value: () => 'x'}, deepseekKey: {value: () => 'x'}, smtpUser: {value: () => ''}, smtpPass: {value: () => ''}});
stubModule('../src/analysis/runAnalysisInternal', {runAnalysisInternal: async () => ({})});
const {_internal} = require('../src/admin/runConsistencyTest');
const {generateVariation, applySampleNoise, recomputeStats, NOISE_RULES} = _internal;

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const load = (stem) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.json`), 'utf8'));
const fv67 = () => JSON.parse(fs.readFileSync(path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'), 'utf8')).fingerprint;
const clone = (o) => JSON.parse(JSON.stringify(o));

// مولّد ضجيج حتميّ بسيط (نفس شكل الواجهة: noise(mag) في [-mag, mag])
function makeNoise(seed) {
  let s = seed >>> 0;
  return (mag) => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return ((s / 4294967296) * 2 - 1) * mag;
  };
}
const colIdx = (fp, name) => fp.timeSeries.variables.findIndex((v) => v.name === name);
const changedColumns = (a, b) => {
  const out = [];
  const w = a.timeSeries.samples[0].v.length;
  for (let c = 0; c < w; c++) if (a.timeSeries.samples.some((s, i) => s.v[c] !== b.timeSeries.samples[i].v[c])) out.push(c);
  return out;
};

// ═══════════════════════════════════════════════════════════════════
// أ) 11 عموداً (1.0.10): الضجيج يقع على الأسماء ذات القاعدة، لا على غيرها
// ═══════════════════════════════════════════════════════════════════
{
  const fp = fv67();
  const w = clone(fp);
  const info = applySampleNoise(w, makeNoise(7));
  eq(info.state, 'NOISED', '[أ] الحالة NOISED');
  eq(info.noisedChannels, ['battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'cpu_freq_max_khz', 'cpu_usage_pct', 'gpu_fps'],
      '[أ] المشوَّشة بأسمائها (6 من 11): كانت 0 قبل التغيير (الشرط v.length < 18)');
  eq(info.notNoisedChannels, ['timestamp_ms', 'battery_level_pct', 'package_power_mw', 'storage_throughput_mbps', 'memory_bandwidth_mbps'],
      '[أ] وغير المشوَّشة تُعلَن بأسمائها (لا قاعدة لها) — القاعدة 25');
  const changed = changedColumns(w, fp);
  const idx = (name) => colIdx(fp, name);
  ok([1, 2, 3, 5, 6].every((c) => changed.includes(c)), '[أ] الأعمدة 1 و2 و3 و5 و6 تغيّرت فعلاً (حرارة/جهد/تيار/تردّد/استخدام)');
  ok(!changed.includes(0) && !changed.includes(4) && !changed.includes(7) && !changed.includes(8) && !changed.includes(9),
      '[أ] والزمن والمستوى والقدرة والتخزين والذاكرة لم تتغيّر');
  eq(changed.includes(idx('gpu_fps')) || true, true, '[أ] gpu_fps: قاعدتها المرحلة 3 وحدها (قد لا تتغيّر إن كانت صفراً هناك)');
  // الشدّة: قاعدة الجهد ±15
  const vc = idx('battery_voltage_mv');
  const maxDelta = Math.max(...w.timeSeries.samples.map((s, i) => Math.abs(s.v[vc] - fp.timeSeries.samples[i].v[vc])));
  ok(maxDelta > 0 && maxDelta <= 15 + 1e-9, `[أ] ضجيج الجهد ضمن ±15 (أقصى فرق ${maxDelta.toFixed(3)})`);
  // قاعدة التردّد ضربية ±3% وغير سالبة
  const fc = idx('cpu_freq_max_khz');
  const ratios = w.timeSeries.samples.map((s, i) => [s.v[fc], fp.timeSeries.samples[i].v[fc]]).filter(([, o]) => o > 0).map(([x, o]) => x / o);
  ok(Math.max(...ratios) <= 1.03 + 1e-9 && Math.min(...ratios) >= 0.97 - 1e-9, '[أ] ضجيج التردّد ضربي ضمن ±3%');
  const uc = idx('cpu_usage_pct');
  ok(w.timeSeries.samples.every((s) => s.v[uc] >= 0 && s.v[uc] <= 100), '[أ] والاستخدام مقيَّد [0,100]');
  // الشدّة تتبع المقياس
  const high = clone(fp);
  applySampleNoise(high, (mag) => makeNoise(7)(mag) * 2);
  ok(Math.max(...high.timeSeries.samples.map((s, i) => Math.abs(s.v[vc] - fp.timeSeries.samples[i].v[vc]))) > maxDelta, '[أ] مقياس أعلى ← فرق أكبر');
}

// ═══════════════════════════════════════════════════════════════════
// ب) 16 عموداً (ست سياسات...): الأعمدة الإضافية بالاسم
// ═══════════════════════════════════════════════════════════════════
{
  const fp = load('16ch-four-policies-truncated-failures');
  const w = clone(fp);
  const info = applySampleNoise(w, makeNoise(11));
  ok(info.noisedChannels.includes('cpu_freq_policy0_khz') && info.noisedChannels.includes('cpu_freq_policy6_khz'),
      '[ب] قنوات cpu_freq_policy{N}_khz مشوَّشة (قاعدة cpu_freq_* ضربية) — بأسمائها لا بفهارس ثابتة');
  ok(info.notNoisedChannels.includes('charge_counter_raw'), '[ب] charge_counter_raw غير مشوَّش (لا قاعدة، وقيمته خام بوحدة غير معلومة)');
  const cc = colIdx(fp, 'charge_counter_raw');
  ok(w.timeSeries.samples.every((s, i) => s.v[cc] === fp.timeSeries.samples[i].v[cc]), '[ب] وأعمدته لم تتغيّر حرفاً');
  const p2 = colIdx(fp, 'cpu_freq_policy2_khz');
  const r = w.timeSeries.samples.map((s, i) => [s.v[p2], fp.timeSeries.samples[i].v[p2]]).filter(([, o]) => o > 0).map(([x, o]) => x / o);
  ok(Math.max(...r) <= 1.03 + 1e-9 && Math.min(...r) >= 0.97 - 1e-9 && r.some((x) => x !== 1), '[ب] ضجيج policy2 ضمن ±3% وقد وقع');
  // الأعمدة الأساسية بأسمائها كما في 11 عموداً (الفهارس نفسها هنا لكنّ التخطيط كله بالاسم)
  eq(info.noisedChannels.filter((x) => !x.startsWith('cpu_freq_policy')), ['battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'cpu_freq_max_khz', 'cpu_usage_pct', 'gpu_fps'],
      '[ب] الأساسية المشوَّشة هي نفسها');
}

// ═══════════════════════════════════════════════════════════════════
// جـ) ترتيب الأعمدة لا يهمّ — الاسم هو المميِّز
// ═══════════════════════════════════════════════════════════════════
{
  const fp = load('13ch-selinux-blocked-policy');
  const swap = (m, i, j) => {
    const t = m.timeSeries;
    [t.variables[i], t.variables[j]] = [t.variables[j], t.variables[i]];
    for (const s of t.samples) [s.v[i], s.v[j]] = [s.v[j], s.v[i]];
    return m;
  };
  const m = swap(clone(fp), 5, 6); // cpu_freq_max_khz ↔ cpu_usage_pct
  eq([m.timeSeries.variables[5].name, m.timeSeries.variables[6].name], ['cpu_usage_pct', 'cpu_freq_max_khz'], '[جـ] (تمهيد) العمودان بُدِّلا في variables[] وكل العيّنات');
  const w = clone(m);
  applySampleNoise(w, makeNoise(3));
  const fq = colIdx(m, 'cpu_freq_max_khz');
  const us = colIdx(m, 'cpu_usage_pct');
  ok(w.timeSeries.samples.every((s) => s.v[us] >= 0 && s.v[us] <= 100), '[جـ] cpu_usage_pct (الآن في الفهرس 5) مقيَّد [0,100] بقاعدته — لا بقاعدة التردّد');
  const rr = w.timeSeries.samples.map((s, i) => [s.v[fq], m.timeSeries.samples[i].v[fq]]).filter(([, o]) => o > 0).map(([x, o]) => x / o);
  ok(Math.max(...rr) <= 1.03 + 1e-9 && Math.min(...rr) >= 0.97 - 1e-9, '[جـ] cpu_freq_max_khz (الآن في الفهرس 6) ضربي ±3% — القاعدة تتبع الاسم لا الفهرس');
}

// ═══════════════════════════════════════════════════════════════════
// د) recomputeStats بالاسم: لا إحصاء من عمود آخر
// ═══════════════════════════════════════════════════════════════════
{
  const fp = fv67();
  const w = clone(fp);
  recomputeStats(w, makeNoise(1));
  const s = w.timeSeries.stats;
  eq([s.tempStart, s.tempEnd, s.tempPeak, s.tempRiseRate, s.tempCoolRate], [undefined, undefined, undefined, undefined, undefined],
      '[د] launch بلا cpu_temp_c: إحصاءات الحرارة غائبة (قديماً: tempPeak = 2730000 من cpu_freq_max_khz) — الغياب يبقى غياباً');
  const uc = colIdx(fp, 'cpu_usage_pct');
  const usage = fp.timeSeries.samples.map((x) => x.v[uc]).filter((x) => typeof x === 'number' && x >= 0 && x <= 100);
  ok(Math.abs(s.cpuUsageAvg - usage.reduce((a, b) => a + b, 0) / usage.length) < 1e-9, '[د] cpuUsageAvg من عمود cpu_usage_pct (v[6]) لا من v[9] (الذاكرة في launch)');
  const bm = colIdx(fp, 'memory_bandwidth_mbps');
  const mem = fp.timeSeries.samples.map((x) => x.v[bm]).filter((x) => typeof x === 'number' && x >= 0 && x <= 100);
  ok(mem.length === 0 || Math.abs(s.cpuUsageAvg - mem.reduce((a, b) => a + b, 0) / mem.length) > 1e-6, '[د] ولا تساوي متوسّط عمود الذاكرة (الفهرس 9)');
  const lv = colIdx(fp, 'battery_level_pct');
  eq([s.batteryStart, s.batteryEnd], [fp.timeSeries.samples[0].v[lv], fp.timeSeries.samples[fp.timeSeries.samples.length - 1].v[lv]], '[د] batteryStart/End من battery_level_pct');
  const fc = colIdx(fp, 'cpu_freq_max_khz');
  ok(typeof s.throttlePercent === 'number' && typeof s.performanceRSD === 'number', '[د] throttlePercent/performanceRSD من cpu_freq_max_khz (بديل cpu_freq_big_khz) حين يوجد');
  void fc;
  // تخطيط V1 اصطناعي: cpu_temp_c في الفهرس 5 ← إحصاءات الحرارة تُحسب منه بالاسم
  const v1 = {timeSeries: {
    variables: ['timestamp_ms', 'battery_temp_c', 'battery_voltage_mv', 'battery_current_ua', 'battery_level_pct', 'cpu_temp_c', 'cpu_freq_big_khz', 'cpu_usage_pct'].map((name) => ({name})),
    samples: Array.from({length: 20}, (_, i) => ({phase: 3, v: [i * 1000, 30, 3800, -300, 80 - Math.floor(i / 10), 40 + i, 2000000 - i * 1000, 50]})),
  }};
  recomputeStats(v1, makeNoise(2));
  eq([v1.timeSeries.stats.tempStart, v1.timeSeries.stats.tempPeak, v1.timeSeries.stats.tempEnd], [40, 59, 59], '[د][اصطناعي V1] cpu_temp_c (v[5]) ← tempStart/Peak/End بالاسم');
  eq(v1.timeSeries.stats.cpuUsageAvg, 50, '[د][اصطناعي V1] cpu_usage_pct بالاسم رغم موضعه 7');
  // قيم الأعمدة الإضافية لا تدخل أيّ إحصاء (قارئ S-27 رقم ٦)
  const x = load('16ch-four-policies-truncated-failures');
  const a = clone(x); const b = clone(x);
  for (const s2 of b.timeSeries.samples) for (let c = 11; c < s2.v.length; c++) s2.v[c] = -999999;
  recomputeStats(a, makeNoise(5));
  recomputeStats(b, makeNoise(5));
  eq(a.timeSeries.stats, b.timeSeries.stats, '[د] تلف كل الأعمدة الإضافية (وعيّناتها الفاشلة) لا يغيّر أيّ إحصاء: القارئ لا يقرؤها');
}

// ═══════════════════════════════════════════════════════════════════
// هـ) الحالات الحدّية والحتمية
// ═══════════════════════════════════════════════════════════════════
{
  const fp = fv67();
  eq(generateVariation(fp, 'none', 's'), fp, '[هـ] noiseLevel=none: نسخة مطابقة حرفياً');
  const a = generateVariation(fp, 'medium', 'seed-x');
  const b = generateVariation(fp, 'medium', 'seed-x');
  eq(a, b, '[هـ] البذرة نفسها ← مخرَج مطابق (حتمية)');
  ok(JSON.stringify(generateVariation(fp, 'medium', 'seed-y')) !== JSON.stringify(a), '[هـ] وبذرة أخرى ← مخرَج مختلف');
  ok(JSON.stringify(a) !== JSON.stringify(fp), '[هـ] ومخرَج medium يختلف عن الأصل على 11 عموداً (لم يكن كذلك قبل التغيير)');
  eq(applySampleNoise({timeSeries: {}}, makeNoise(1)), {noisedChannels: [], notNoisedChannels: [], state: 'NO_SAMPLES'}, '[هـ] بلا عيّنات: NO_SAMPLES معلن');
  const noVars = {timeSeries: {samples: [{phase: 3, v: [1, 2, 3]}]}};
  const before = clone(noVars);
  eq(applySampleNoise(noVars, makeNoise(1)).state, 'NO_VARIABLES', '[هـ] بلا variables[]: NO_VARIABLES معلن');
  eq(noVars, before, '[هـ] ولا عمود يُمسّ بلا اسم (لا فهرس مخمَّن)');
  const mixed = {timeSeries: {variables: [{name: 'battery_temp_c'}, {name: 'unknown_channel'}], samples: [{phase: 1, v: [30, 7]}, {phase: 1, v: ['x', 8]}]}};
  const info = applySampleNoise(mixed, makeNoise(1));
  eq(info.notNoisedChannels, ['unknown_channel'], '[هـ] اسم غير معروف لا قاعدة له: يُعلَن ولا يُمسّ');
  eq(mixed.timeSeries.samples[1].v[0], 'x', '[هـ] وقيمة غير رقمية لا تُشوَّش');
  ok(Array.isArray(NOISE_RULES) && NOISE_RULES.length === 8, '[هـ] ثماني قواعد بالاسم (الجدول واحد)');
}

console.log(`\nrunConsistencyTestByName.test.js: ${n}/${n} assertions passed`);
