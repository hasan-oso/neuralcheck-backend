'use strict';

// featureLibrary.test.js — مكتبة الخصائص واللحظات (V8 / PLAN-05 §٢-ب §٣ — الصفّ S-B5، 2026-10-21 +03)
//
// الكتل:
//   A. المفردات والسجلّ وبصمة المعادلات والعتبات (لا تتغيّر معادلة أو عتبة بلا رفع FEATURE_SET_VERSION — القاعدة 39).
//   B. Matrix Profile: جواب معروف، مرجع brute-force داخل الاختبار على سلاسل عشوائية مبذورة، والحالات الحدّية (القاعدة 22).
//   C. الفحوص الحقيقية الأربعة (golden/*.ts.json) مقابل مرجع **بايثون مستقلّ** (fixtures/feature-library/expected_feature_library.json)
//      ومقابل مراجع قائمة مستقلّة (golden/EXPECTED-timeseries_stats*.json) — يمرّ بالقارئ كاملاً من fingerprint الخام (القاعدتان 30 و41).
//   D. مُنتِجات fv71 الحقيقية (golden/fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-*): وحدة السرعة المعلنة، وL-5 من قائمة الحالة الحرارية، والمستمع الفاشل.
//   E. الغياب: كل خاصّية ولحظة تُعلن سبب غيابها بالاسم (القاعدة 22) — حمولة بلا عيّنات، ووحدة غير معلنة، وكادنس حرارة غير كافٍ، ومرحلة غائبة.
//   F. اللحظات الاصطناعية بجواب معروف (L-1 النافذة الجزئية، L-2 التعادل، L-3 الركبة، L-5 عند التسجيل) — اصطناعية موسومة صراحةً؛ ولا مُستبدِل لأيّ طبقة تُصدر الغياب.
//
// Run: node functions/test/featureLibrary.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {computeFeatureLibrary, classifyStability, FEATURE_REGISTRY} = require('../src/analysis/featureLibrary');
const {computeMoments} = require('../src/analysis/moments');
const {matrixProfileDiscord} = require('../src/analysis/matrixProfile');
const {computeFindings, UNSTABLE_CV_THRESHOLD_PCT, EVIDENCE_MIN_SAMPLES, SUSTAINED_WINDOW_MS} = require('../src/analysis/findings');
const {readFv68} = require('../src/analysis/fv68Reader');
const NAMES = require('../src/analysis/featureNames');
const N = require('../src/analysis/fv68Names');

const {FEATURE, REASON, STATUS, PARAMS} = NAMES;
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const REF_DIR = path.join(__dirname, 'fixtures', 'feature-library');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const near = (actual, expected, tol, m) => {
  assert.ok(typeof actual === 'number' && Number.isFinite(actual), `${m} — actual is not a finite number (got ${actual})`);
  assert.ok(Math.abs(actual - expected) <= tol, `${m} — |${actual} - ${expected}| = ${Math.abs(actual - expected)} > ${tol}`);
  n++;
};

const loadJson = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const REAL = ['8909e850-s10.ts.json', 'e4b65a2f-honor.ts.json', 'b45c8cf6.ts.json', '34dff2b8.ts.json'];
const FV71_11 = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json';
const FV71_16 = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json';
const asFingerprint = (ts) => ({timeSeries: ts, functionalResults: [], manualResults: []});

// المسار الإنتاجي بالضبط (runAnalysisInternal): findings وfv68 يُحسبان مرّة ويُمرَّران.
function runAll(fp) {
  const findings = computeFindings(fp);
  const fv68 = readFv68(fp);
  const lib = computeFeatureLibrary({fingerprint: fp, findings, fv68});
  const mom = computeMoments({fingerprint: fp, findings, fv68});
  return {findings, fv68, lib, mom};
}

// ═══════════════════════════════════════════════════════════════════════
// A. المفردات والسجلّ وبصمة السطح
// ═══════════════════════════════════════════════════════════════════════
{
  eq(NAMES.FEATURE_SET_VERSION, 1, 'FEATURE_SET_VERSION = 1 عند هذا الصفّ');
  eq(FEATURE_REGISTRY.length, 20, 'السجلّ: 19 خاصّية (F1..F19) + thermal_resistance المنقولة من المختبر');
  deq(FEATURE_REGISTRY.slice(0, 19).map((d) => d.id), Array.from({length: 19}, (_, i) => `F${i + 1}`), 'المعرّفات F1..F19 بترتيب جدول P5 §٢-ب');
  eq(new Set(FEATURE_REGISTRY.map((d) => d.name)).size, 20, 'الأسماء فريدة');
  deq(FEATURE_REGISTRY.map((d) => d.name), Object.values(FEATURE), 'كل اسم في FEATURE مسجَّل مرّة بالترتيب نفسه (مصدر واحد — القاعدة 24)');
  for (const [k, p] of Object.entries(PARAMS)) {
    ok(typeof p.source === 'string' && p.source.length > 10, `PARAMS.${k}: لكل عتبة مصدرها (P5 §١-د: «وكل حدّ بمصدره»)`);
    ok(typeof p.label === 'string' && p.label.length > 0, `PARAMS.${k}: لكل عتبة وسمها`);
  }
  eq(NAMES.MOMENT_IDS.length, 5, 'خمس لحظات L-1..L-5');
  deq(Object.keys(NAMES.MOMENT_TEMPLATE_KEY).sort(), [...NAMES.MOMENT_IDS].sort(), 'لكل لحظة templateKey');

  // بصمة السطح: تتغيّر إن تغيّرت معادلة أو عتبة أو اسم أو وحدة أو حكم مقترح أو نافذة أو قناة L-4. تغييرها المقصود ⟵ ارفع FEATURE_SET_VERSION وأعد توليد المرجع المستقلّ
  // (fixtures/feature-library/reference_feature_library.py) وحدّث السطر أدناه في الالتزام نفسه.
  const surface = JSON.stringify({
    version: NAMES.FEATURE_SET_VERSION, formula: NAMES.FORMULA_VERSION, params: PARAMS,
    registry: FEATURE_REGISTRY.map((d) => [d.id, d.name, d.unit, d.judgement, d.source]),
    moments: NAMES.MOMENT, templates: NAMES.MOMENT_TEMPLATE_KEY, thermalReach: NAMES.THERMAL_REACH_THRESHOLDS,
    anomalyChannels: NAMES.ANOMALY_CHANNEL_KEYS, sustainedWindowMs: SUSTAINED_WINDOW_MS,
  });
  const sha = crypto.createHash('sha256').update(surface).digest('hex');
  eq(sha, '076c51344c69d6def68168c4d081b6662a9b28dfdff0e62eb6ea7db5b1435d4f', 'بصمة سطح المكتبة (معادلات/عتبات/أسماء) — تغييرها بلا رفع FEATURE_SET_VERSION وإعادة توليد المرجع المستقلّ يُخفق هنا');

  // الاسم الحرفي المنقول من findings.js يُحرَس من الانجراف: الفحص الحقيقي المقفول على vsync يُخرج الاسم نفسه.
  const honor = loadJson(GOLDEN_DIR, 'e4b65a2f-honor.ts.json');
  eq(computeFindings(asFingerprint(honor)).graphics.notMeasuredReason, REASON.HARNESS_VSYNC_LOCKED, 'اسم HARNESS_VSYNC_LOCKED كما يُخرجه findings.js على Honor الحقيقي');
  eq(UNSTABLE_CV_THRESHOLD_PCT, 15, 'الحدّ المعتمد د-٤ مستورد من findings.js (القاعدة 24)');
}

// ═══════════════════════════════════════════════════════════════════════
// A2. شرط الثبات (CV) — الحدّ مستورد لا منسوخ
// ═══════════════════════════════════════════════════════════════════════
{
  eq(classifyStability(0), 'STABLE', 'CV = 0');
  eq(classifyStability(15), 'STABLE', 'CV = 15 على الحدّ (≤)');
  eq(classifyStability(15.0001), 'UNSTABLE', 'CV فوق الحدّ');
  eq(classifyStability(50.9), 'UNSTABLE', 'مثال القرار ٤: ركبة التخزين CV 50.9%');
  for (const bad of [null, undefined, NaN, Infinity, -1, '12', {}]) eq(classifyStability(bad), STATUS.NOT_MEASURED, `CV غير مقيس (${String(bad)}) ⟵ NOT_MEASURED لا ثبات مفترض`);
}

// ═══════════════════════════════════════════════════════════════════════
// B. Matrix Profile
// ═══════════════════════════════════════════════════════════════════════
function naiveDiscord(series, m, ez) {
  const subs = series.length - m + 1;
  const z = [];
  for (let i = 0; i < subs; i++) {
    const w = series.slice(i, i + m);
    const flat = Math.min(...w) === Math.max(...w);
    const mean = w.reduce((a, b) => a + b, 0) / m;
    const sd = Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / m);
    z.push(flat ? w.map(() => 0) : w.map((x) => (x - mean) / sd));
  }
  let best = null;
  for (let i = 0; i < subs; i++) {
    let dmin = null;
    for (let j = 0; j < subs; j++) {
      if (Math.abs(i - j) < ez) continue;
      const d = Math.sqrt(z[i].reduce((a, b, k) => a + (b - z[j][k]) ** 2, 0));
      if (dmin === null || d < dmin) dmin = d;
    }
    if (dmin === null) continue;
    if (best === null || dmin > best.distance) best = {index: i, distance: dmin};
  }
  return best;
}
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
{
  // جواب معروف: جيب متكرّر وفي منتصفه نبضة شاذّة — الـdiscord عند النبضة.
  const m = 20;
  const sine = Array.from({length: 400}, (_, i) => Math.sin(i * 2 * Math.PI / 25));
  const clean = matrixProfileDiscord(sine, m, 10);
  ok(clean.ok && clean.discord !== null, 'سلسلة جيبية نظيفة: يُحسب discord');
  const spiked = sine.slice();
  for (let i = 200; i < 210; i++) spiked[i] = 3 + (i - 200) * 0.1;
  const r = matrixProfileDiscord(spiked, m, 10);
  ok(r.discord.index >= 200 - m && r.discord.index <= 209, `الـdiscord يقع على النبضة المحقونة (وجدتُه عند ${r.discord.index})`);
  ok(r.discord.distance > 2 * clean.discord.distance, 'مسافة الشاذّ أكبر بوضوح من مسافة سلسلة نظيفة');

  // مرجع brute-force على سلاسل عشوائية مبذورة.
  for (const seed of [1, 7, 42]) {
    const rnd = lcg(seed);
    const s = Array.from({length: 130}, () => Math.round(rnd() * 20));
    const a = matrixProfileDiscord(s, 12, 6);
    const b = naiveDiscord(s, 12, 6);
    eq(a.discord.index, b.index, `seed ${seed}: فهرس الـdiscord = brute-force`);
    near(a.discord.distance, b.distance, 1e-9, `seed ${seed}: مسافة الـdiscord = brute-force`);
  }

  // نوافذ ثابتة: ثابتة↔ثابتة 0، وثابتة↔متغيّرة √m (تعريف stumpy)، بلا NaN.
  const withFlat = [...Array(30).fill(5), ...Array.from({length: 30}, (_, i) => (i % 2) * 4)];
  const rf = matrixProfileDiscord(withFlat, 6, 3);
  ok(rf.ok && rf.flatSubsequences > 0, 'سلسلة بنوافذ ثابتة تُحسب');
  ok(rf.profile.every((x) => x === null || Number.isFinite(x)), 'لا NaN في الـprofile مع النوافذ الثابتة');
  const allFlat = matrixProfileDiscord(Array(40).fill(3), 8, 4);
  eq(allFlat.discord.distance, 0, 'كل النوافذ ثابتة: مسافة 0 (لا قسمة على صفر)');
  eq(allFlat.discord.index, 0, 'التعادل يحسمه أصغر فهرس');
  const sq = matrixProfileDiscord([...Array(10).fill(1), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 4, 1);
  near(sq.profile[0], 0, 1e-12, 'نافذة ثابتة لها جار ثابت: 0');
  near(matrixProfileDiscord([1, 1, 1, 1, 5, 6, 7, 8], 4, 4).profile[0], Math.sqrt(4), 1e-12, 'ثابتة مقابل متغيّرة: √m');

  // الغياب والمُدخل الرديء: حالة مسمّاة لا استثناء ولا صفر.
  eq(matrixProfileDiscord('x', 4, 2).reason, 'SERIES_NOT_AN_ARRAY', 'ليست مصفوفة');
  eq(matrixProfileDiscord([1, 2, 3], 1, 2).reason, 'WINDOW_INVALID', 'نافذة غير صالحة');
  eq(matrixProfileDiscord([1, 2, 3], 2, 0).reason, 'EXCLUSION_ZONE_INVALID', 'منطقة استثناء غير صالحة');
  const nan = matrixProfileDiscord([1, 2, NaN, 4, 5, 6], 2, 1);
  eq(nan.reason, 'NON_NUMERIC_SAMPLE', 'عيّنة NaN لا تُهمَل صامتةً');
  eq(nan.index, 2, 'موضع العيّنة المعيبة معلن');
  eq(matrixProfileDiscord([1, 2, 3], 5, 2).reason, 'SERIES_SHORTER_THAN_WINDOW', 'أقصر من النافذة');
  const noNb = matrixProfileDiscord([1, 3, 2, 5, 4, 6, 3], 4, 4); // 4 نوافذ فقط، وأقصى فرق فهرس 3 < منطقة الاستثناء 4
  ok(noNb.ok, 'نوافذ بلا جار خارج المنطقة: ok');
  eq(noNb.discord, null, 'لا جار لأيّ نافذة ⟵ discord = null (لا مسافة صفر مفترضة)');
  eq(noNb.nWithNeighbor, 0, 'ولا نافذة لها جار');
}

// ═══════════════════════════════════════════════════════════════════════
// C. الفحوص الحقيقية الأربعة مقابل المرجع المستقلّ
// ═══════════════════════════════════════════════════════════════════════
const expected = loadJson(REF_DIR, 'expected_feature_library.json');
const stats = loadJson(GOLDEN_DIR, 'EXPECTED-timeseries_stats.json');
const variance = loadJson(GOLDEN_DIR, 'EXPECTED-timeseries_stats-variance.json');
const statsFor = {
  '8909e850-s10.ts.json': stats.s10,
  'e4b65a2f-honor.ts.json': stats.honor,
  'b45c8cf6.ts.json': variance['b45c8cf6-e376-4765-8703-f68e9bc69844'],
  '34dff2b8.ts.json': variance['34dff2b8-ce9e-4b40-86a9-1976c878e195'],
};
const PHASE_BY_NAME = {INIT: 0, STORAGE: 1, MEMORY: 2, CPU_SUSTAINED: 3, GPU_SUSTAINED: 4, COMBINED: 5, BURST: 6, COOLDOWN: 7};

for (const name of REAL) {
  const exp = expected.scans[name];
  const ind = statsFor[name];
  const fp = asFingerprint(loadJson(GOLDEN_DIR, name));
  const {findings, lib, mom} = runAll(fp);
  const f = lib.features;
  eq(lib.status, STATUS.MEASURED, `${name}: المكتبة MEASURED`);
  eq(lib.featureSetVersion, 1, `${name}: featureSetVersion`);
  deq(Object.keys(f), FEATURE_REGISTRY.map((d) => d.name), `${name}: كل خاصّية مسجَّلة حاضرة بالترتيب (لا حذف صامت)`);

  // F1–F4: الخصائص القائمة = ناتج findings نفسه = المرجع القائم المستقلّ (±0.001، مقرَّب إلى 3 خانات في المرجع).
  near(f[FEATURE.CPU_SUSTAINED_P3].value, ind.sustained_ceiling_phase3.mean_window_max_ratio, 0.0006, `${name}: F1 = المرجع المستقلّ`);
  near(f[FEATURE.CPU_SUSTAINED_P5].value, ind.sustained_ceiling_phase5.mean_window_max_ratio, 0.0006, `${name}: F2 = المرجع المستقلّ`);
  near(f[FEATURE.CPU_MIN_WINDOW_P5].value, ind.sustained_ceiling_phase5.min_window_max_ratio, 0.0006, `${name}: F3 = المرجع المستقلّ`);
  near(f[FEATURE.CPU_RECOVERY_P7].value, ind.recovery_phase7_max_ratio, 0.0006, `${name}: F4 = المرجع المستقلّ`);
  eq(f[FEATURE.CPU_SUSTAINED_P3].value, findings.sustainedCeiling.phase3.meanWindowMaxRatio, `${name}: F1 هو قيمة findings نفسها (معادلة واحدة)`);

  // F5: القراءة الحرفية على الفحص كلّه = بايثون المستقلّ = المرجع القائم last_time_freq_ge_2600MHz_s حيث الذروة 2.73 GHz.
  near(f[FEATURE.CPU_PEAK_HOLD_S].value, exp.F5_peak_hold.value, 1e-9, `${name}: F5 = بايثون المستقلّ`);
  eq(f[FEATURE.CPU_PEAK_HOLD_S].unit, 's', `${name}: F5 وحدة الثواني`);
  if (ind.peak_freq_footer === 2730000) near(f[FEATURE.CPU_PEAK_HOLD_S].value, ind.last_time_freq_ge_2600MHz_s, 1, `${name}: F5 = last_time_freq_ge_2600MHz_s القائم (مقرَّب إلى ثانية)`);

  // بوّابة الحرارة (كادنس): Honor 4 قيم حرارة مميّزة فقط ⟵ لا خاصّية حرارية تُعرض.
  if (exp.riseGate) {
    near(f[FEATURE.BATTERY_TEMP_RISE_C].value, ind.temp_rise, 0.05, `${name}: F12 = المرجع المستقلّ`);
    near(f[FEATURE.BATTERY_TEMP_RATE_P345].value, ind.temp_rise_rate_c_per_min_phases_3_5, 0.001, `${name}: F13 = المرجع المستقلّ`);
    near(f[FEATURE.BATTERY_Q_INT_MAH].value, ind.coulomb_whole_scan_mah, 0.06, `${name}: F17 = المرجع المستقلّ (coulomb_whole_scan_mah)`);
    near(f[FEATURE.THERMAL_TEMP_PER_WH].value, exp.F14_temp_per_wh, Math.abs(exp.F14_temp_per_wh) * 1e-9, `${name}: F14 = بايثون المستقلّ`);
    eq(f[FEATURE.THERMAL_TEMP_PER_WH].unit, '°C/Wh', `${name}: F14 وحدة °C/Wh`);
    if (exp.LAB_thermal_resistance !== null) {
      near(f[FEATURE.THERMAL_RESISTANCE].value, exp.LAB_thermal_resistance, 1e-9, `${name}: thermal_resistance = بايثون المستقلّ`);
    } else {
      eq(f[FEATURE.THERMAL_RESISTANCE].status, STATUS.NOT_MEASURED, `${name}: thermal_resistance غائبة كما في بايثون`);
    }
    // F14 من v2×v3 نصّاً = من v7 (package_power_mw) على العيّنات الحقيقية: الفرق ≤ 1 mW في كل عيّنة (تنبيه القاعدة 14 في الكود).
    ok(exp.maxAbsDiffVIvsPowerMw <= 1.0, `${name}: |V·I| = package_power_mw بفرق ≤ 1 mW في كل عيّنة (مرجع بايثون: ${exp.maxAbsDiffVIvsPowerMw.toFixed(3)})`);
  } else {
    for (const k of [FEATURE.BATTERY_TEMP_RISE_C, FEATURE.BATTERY_TEMP_RATE_P345, FEATURE.THERMAL_TEMP_PER_WH, FEATURE.THERMAL_RESISTANCE]) {
      eq(f[k].status, STATUS.NOT_MEASURED, `${name}: ${k} بلا كادنس حرارة كافٍ`);
      eq(f[k].reason, REASON.INSUFFICIENT_CADENCE, `${name}: ${k} سببها كادنس الحرارة، لا صفر ولا «طبيعي»`);
      eq(f[k].value, null, `${name}: ${k} بلا قيمة`);
    }
  }

  // F18 مرفوضة بصيغتها دائماً.
  eq(f[FEATURE.BATTERY_APPARENT_R].reason, REASON.FORMULA_REJECTED_AWAITING_M3_PAIRS, `${name}: F18 مرفوضة بصيغتها (P5 :285)`);
  // وحدة السرعة على الفحوص الحقيقية الأربعة: appVersion 1.0.8-v6beta ⟵ «الوحدة غير محدَّدة» (عقد :840) ⟵ F9/F10/F19 غير مقيسة بسبب مسمّى لا بوحدة مخمَّنة.
  eq(f[FEATURE.STORAGE_IN_CACHE_MBPS].reason, REASON.UNIT_UNDETERMINED, `${name}: F9 وحدتها غير محسومة (A100: لا تُخمَّن)`);
  eq(f[FEATURE.MEMORY_BW_MEDIAN].reason, REASON.UNIT_UNDETERMINED, `${name}: F19 وحدتها غير محسومة`);

  // اللحظات
  const states = mom.momentStates;
  eq(states.length, 2 + 1 + 1 + 32 + 2, `${name}: حالات اللحظات: L-1×2 + L-2 + L-3 + L-4×(4 قنوات × 8 مراحل) + L-5×2`);
  for (const s of states) ok(s.status === STATUS.MEASURED || (typeof s.reason === 'string' && s.reason.length > 0), `${name}: ${s.id} غير المقيسة تحمل سببها`);
  const l1 = mom.moments.filter((x) => x.id === 'L-1');
  for (const p of ['3', '5']) {
    const e = exp.L1[p];
    const st = states.find((s) => s.id === 'L-1' && s.phase === Number(p));
    eq(st.status, e.measured ? STATUS.MEASURED : STATUS.NOT_MEASURED, `${name}: L-1 مرحلة ${p} حالتها`);
    if (e.measured) {
      eq(st.occurred, e.occurred, `${name}: L-1 مرحلة ${p} وقعت؟`);
      const got = l1.find((x) => x.phase === Number(p));
      if (e.occurred) {
        near(got.t_s, e.t_s, 1e-9, `${name}: L-1 مرحلة ${p} t_s`);
        near(got.value, e.value, 1e-9, `${name}: L-1 مرحلة ${p} قيمة النافذة`);
        eq(got.detail.windowsBelowToEnd, e.windowsBelowToEnd, `${name}: L-1 مرحلة ${p} نوافذ الذيل الهابط`);
        eq(got.detail.lastWindowExcluded, e.lastWindowExcluded, `${name}: L-1 مرحلة ${p} استثناء النافذة الجزئية`);
      } else {
        eq(got, undefined, `${name}: L-1 مرحلة ${p} لا لحظة حين لم يقع هبوط مستدام`);
      }
    }
  }
  const l2 = mom.moments.find((x) => x.id === 'L-2');
  if (exp.L2) {
    near(l2.t_s, exp.L2.t_s, 1e-9, `${name}: L-2 t_s`);
    eq(l2.phase, exp.L2.phase, `${name}: L-2 المرحلة`);
    eq(l2.value, exp.L2.value, `${name}: L-2 القيمة`);
    near(l2.t_s, ind.temp_max_time_s, 1, `${name}: L-2 t_s = temp_max_time_s القائم (مقرَّب إلى ثانية)`);
    eq(l2.phase, PHASE_BY_NAME[ind.temp_max_phase], `${name}: L-2 المرحلة = temp_max_phase القائم`);
    eq(l2.precisionS, 30, `${name}: L-2 تُعلن دقّتها ±30 ث (P5 :334)`);
  } else {
    eq(l2, undefined, `${name}: L-2 بلا كادنس حرارة ⟵ لا لحظة`);
    const st = states.find((s) => s.id === 'L-2');
    eq(st.reason, REASON.INSUFFICIENT_CADENCE, `${name}: L-2 سبب غيابها مسمّى`);
  }
  const l3 = mom.moments.find((x) => x.id === 'L-3');
  if (exp.L3) {
    eq(l3.detail.segmentIndex, exp.L3.segmentIndex, `${name}: L-3 المقطع`);
    near(l3.value, exp.L3.cumulativeGb, 1e-12, `${name}: L-3 الموضع GB`);
    eq(l3.detail.segmentMbps, exp.L3.mbps, `${name}: L-3 قيمة المقطع`);
    eq(l3.detail.previousSegmentMbps, exp.L3.previous, `${name}: L-3 المقطع قبله`);
    eq(l3.detail.nextSegmentMbps, exp.L3.next, `${name}: L-3 المقطع بعده`);
    near(l3.detail.inCacheMedianMbps, exp.L3.inCacheMedian, 1e-9, `${name}: L-3 وسيط ما قبل الركبة`);
    near(l3.detail.postCacheMedianMbps, exp.L3.postCacheMedian, 1e-9, `${name}: L-3 وسيط ما بعدها`);
    eq(l3.t_s, null, `${name}: L-3 بلا طابع زمني صريحاً (مقاطع التذييل)`);
    eq(l3.tBasis, 'NONE', `${name}: L-3 أساس الزمن NONE`);
    if (ind.storage_collapse_detector) {
      eq(l3.detail.segmentIndex, ind.storage_collapse_detector.segment_index, `${name}: L-3 المقطع = storage_collapse_detector القائم`);
      near(l3.value, ind.storage_collapse_detector.cumulative_gb, 0.06, `${name}: L-3 الموضع = storage_collapse_detector القائم`);
    }
  } else {
    eq(l3, undefined, `${name}: لا ركبة ⟵ لا لحظة L-3`);
    const st = states.find((s) => s.id === 'L-3');
    eq(st.status, STATUS.MEASURED, `${name}: لا ركبة واقعة مقيسة لا غياب بيانات`);
    eq(st.occurred, false, `${name}: occurred=false`);
  }
  // L-4 مقابل بايثون المستقلّ: لكل (قناة، مرحلة).
  for (const [key, e] of Object.entries(exp.L4)) {
    const [channel, phaseStr] = key.split('|');
    const phase = Number(phaseStr);
    const st = states.find((s) => s.id === 'L-4' && s.channel === channel && s.phase === phase);
    ok(st, `${name}: حالة L-4 ${key}`);
    if (e.gate === false) {
      eq(st.status, STATUS.NOT_MEASURED, `${name}: L-4 ${key} بوّابة الأدلّة فشلت`);
      ok(st.reason === REASON.INSUFFICIENT_SAMPLES || st.reason === REASON.INSUFFICIENT_CADENCE, `${name}: L-4 ${key} سبب البوّابة مسمّى (${st.reason})`);
      continue;
    }
    if (e.noNeighbor) {
      eq(st.reason, REASON.NO_NON_TRIVIAL_NEIGHBOR, `${name}: L-4 ${key} لا جار`);
      continue;
    }
    eq(st.status, STATUS.MEASURED, `${name}: L-4 ${key} مقيسة`);
    const got = mom.moments.find((x) => x.id === 'L-4' && x.channel === channel && x.phase === phase);
    near(got.value, e.distance, 1e-6, `${name}: L-4 ${key} المسافة = بايثون`);
    eq(got.detail.discordStartIndexInPhase, e.index, `${name}: L-4 ${key} فهرس النافذة`);
    eq(got.detail.neighborStartIndexInPhase, e.neighbor, `${name}: L-4 ${key} فهرس الجار`);
    near(got.t_s, e.t_s, 1e-9, `${name}: L-4 ${key} الزمن`);
    eq(got.detail.nSubsequences, e.subs, `${name}: L-4 ${key} عدد النوافذ`);
    eq(got.detail.nSubsequencesWithNeighbor, e.withNeighbor, `${name}: L-4 ${key} نوافذ لها جار`);
    eq(got.detail.flatSubsequences, e.flat, `${name}: L-4 ${key} النوافذ الثابتة`);
    eq(got.kind, 'CANDIDATE', `${name}: L-4 ${key} مرشَّح بلا حكم (P5 :340)`);
    eq(got.detail.acceptance, 'PENDING_REPEATABILITY', `${name}: L-4 ${key} قبوله معلَّق على ثبات الموضع (P5 :341)`);
  }
  // topOfPhase: واحد بالضبط في كل مرحلة فيها مرشَّحون، وهو الأعلى مسافة.
  for (let p = 0; p <= 7; p++) {
    const inPhase = mom.moments.filter((x) => x.id === 'L-4' && x.phase === p);
    if (!inPhase.length) continue;
    const tops = inPhase.filter((x) => x.detail.topOfPhase);
    eq(tops.length, 1, `${name}: مرحلة ${p}: مرشَّح واحد «الأعلى»`);
    eq(tops[0].value, Math.max(...inPhase.map((x) => x.value)), `${name}: مرحلة ${p}: «الأعلى» هو أكبر مسافة`);
  }
  // L-5: ختم 67 بلا قوائم الحرارة ⟵ غياب مسمّى لا «لم يبلغ».
  for (const s of states.filter((x) => x.id === 'L-5')) {
    eq(s.status, STATUS.NOT_MEASURED, `${name}: L-5 ختم 67`);
    eq(s.reason, REASON.NO_THERMAL_STATUS_EVENTS, `${name}: L-5 سبب الغياب مسمّى`);
    eq(s.occurred, null, `${name}: L-5 occurred=null (لا «لم تقع»)`);
  }
  // الترتيب حتمي وقابل للتسلسل.
  const times = mom.moments.map((x) => (x.t_s === null ? Infinity : x.t_s));
  deq(times, times.slice().sort((a, b) => a - b), `${name}: اللحظات مرتّبة بالزمن (والبلا-زمن آخراً)`);
  deq(JSON.parse(JSON.stringify(lib)), lib, `${name}: ناتج المكتبة قابل للتسلسل بلا فقد (لا undefined/NaN/Map)`);
  deq(JSON.parse(JSON.stringify(mom)), mom, `${name}: ناتج اللحظات قابل للتسلسل بلا فقد`);
  deq(runAll(fp).lib, lib, `${name}: حتمي: تشغيلان بالنتيجة نفسها`);
}

// كل قيم الغياب في الفحوص الأربعة داخل المفردة المعلنة (لا سبب يخرج عن REASON).
{
  const allowed = new Set(Object.values(REASON));
  for (const name of REAL) {
    const {lib, mom} = runAll(asFingerprint(loadJson(GOLDEN_DIR, name)));
    for (const r of Object.values(lib.features)) {
      ok(r.status === STATUS.MEASURED ? r.reason === null && Number.isFinite(r.value) : allowed.has(r.reason), `${name}: ${r.name} سببها ضمن المفردة (${r.reason})`);
      eq(r.gate.passed, r.status === STATUS.MEASURED, `${name}: ${r.name} gate.passed يوافق الحالة`);
      eq(r.gate.reason, r.reason, `${name}: ${r.name} gate.reason يوافق السبب`);
      eq(r.formulaVersion, NAMES.FORMULA_VERSION, `${name}: ${r.name} formulaVersion`);
    }
    for (const s of mom.momentStates) ok(s.status === STATUS.MEASURED || allowed.has(s.reason), `${name}: ${s.id} سببها ضمن المفردة (${s.reason})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// D. مُنتِجات fv71 الحقيقية (مولَّدة من AppRequestPayload الحقيقي — NeuralChek 4c0102c)
// ═══════════════════════════════════════════════════════════════════════
{
  const fp11 = loadJson(GOLDEN_DIR, FV71_11);
  const {findings, lib, mom, fv68} = runAll(fp11);
  const f = lib.features;
  // الوحدة معلنة (MiB/s) ⟵ F9/F10/F19 مقيسة بها.
  eq(fv68.throughputUnit.unit, 'MiB/s', 'fv71: وحدة السرعة معلنة في الحمولة');
  eq(f[FEATURE.STORAGE_IN_CACHE_MBPS].status, STATUS.MEASURED, 'fv71: F9 مقيسة');
  eq(f[FEATURE.STORAGE_IN_CACHE_MBPS].unit, 'MiB/s', 'fv71: F9 بوحدتها المعلنة لا بوحدة مخمَّنة');
  eq(f[FEATURE.STORAGE_IN_CACHE_MBPS].value, findings.storage.inCacheMbps, 'fv71: F9 = findings.storage.inCacheMbps');
  eq(f[FEATURE.STORAGE_POST_CACHE_MBPS].value, findings.storage.postCacheMbps, 'fv71: F10');
  eq(f[FEATURE.MEMORY_BW_MEDIAN].status, STATUS.MEASURED, 'fv71: F19 مقيسة');
  eq(f[FEATURE.MEMORY_BW_MEDIAN].unit, 'MiB/s', 'fv71: F19 بوحدتها المعلنة');
  eq(f[FEATURE.MEMORY_BW_MEDIAN].value, findings.channels[N.BASE_CHANNELS.MEMORY_BANDWIDTH_MBPS].MEMORY.median, 'fv71: F19 = وسيط عرض النطاق في المرحلة 2');
  eq(f[FEATURE.GPU_P4_MEDIAN_FPS].unit, 'fps', 'fv71: F6 وحدة fps المعلنة في variables[]');

  // L-5 من قائمة الحالة الحرارية: مرجع بايثون المستقلّ.
  const e5 = expected.l5_producer_goldens[FV71_11];
  eq(e5.state, 'ok', 'fv71: حالة المستمع ok في المرجع');
  for (const thr of ['MODERATE', 'SEVERE']) {
    const exp = e5.thresholds[thr];
    const st = mom.momentStates.find((s) => s.id === 'L-5' && s.threshold === thr);
    eq(st.status, STATUS.MEASURED, `fv71: L-5 ${thr} مقيسة`);
    eq(st.occurred, exp.occurred, `fv71: L-5 ${thr} وقعت`);
    const got = mom.moments.find((x) => x.id === 'L-5' && x.detail.threshold === thr);
    near(got.t_s, exp.t_s, 1e-9, `fv71: L-5 ${thr} الزمن`);
    eq(got.phase, exp.phase, `fv71: L-5 ${thr} المرحلة`);
    eq(got.value, exp.status, `fv71: L-5 ${thr} القيمة (الحالة المبلوغة)`);
    eq(got.detail.atRegistration, exp.atRegistration, `fv71: L-5 ${thr} atRegistration`);
    eq(got.detail.eventIndex, exp.eventIndex, `fv71: L-5 ${thr} فهرس الحدث`);
    eq(got.unit, 'thermal_status_0_6', `fv71: L-5 ${thr} الوحدة`);
  }
  eq(mom.moments.find((x) => x.id === 'L-5' && x.detail.threshold === 'MODERATE').t_s, 190, 'fv71: MODERATE عند 190 ث (الحدث {status:2, t:190000})');
  eq(mom.moments.find((x) => x.id === 'L-5' && x.detail.threshold === 'SEVERE').t_s, 285, 'fv71: SEVERE عند 285 ث');

  // المستمع الفاشل: الحالة ≠ ok ⟵ لا «لم يبلغ» رغم أنّ القائمة فيها عنصر.
  const fp16 = loadJson(GOLDEN_DIR, FV71_16);
  const r16 = runAll(fp16);
  for (const thr of ['MODERATE', 'SEVERE']) {
    const st = r16.mom.momentStates.find((s) => s.id === 'L-5' && s.threshold === thr);
    eq(st.status, STATUS.NOT_MEASURED, `fv71-16ch: L-5 ${thr} غير مقيسة`);
    eq(st.reason, REASON.THERMAL_STATUS_NOT_OK, `fv71-16ch: L-5 ${thr} سببها مسمّى`);
    eq(st.reasonDetail, 'listener_registration_failed', `fv71-16ch: L-5 ${thr} نوع الحالة كما أخرجه القارئ (القاعدة 21)`);
    eq(st.occurred, null, `fv71-16ch: L-5 ${thr} occurred=null`);
  }
  eq(r16.mom.moments.filter((x) => x.id === 'L-5').length, 0, 'fv71-16ch: لا لحظة L-5');
  eq(r16.lib.status, STATUS.MEASURED, 'fv71-16ch: المكتبة تعمل على حمولة 16 عموداً (أعمدة سياسات إضافية لا تكسر القراءة بالاسم)');
}

// ═══════════════════════════════════════════════════════════════════════
// E/F. اصطناعي — موسوم صراحةً: جواب معروف لكل حالة، وكل غياب بسببه
// ═══════════════════════════════════════════════════════════════════════
const VARS = [
  ['timestamp_ms', 'ms'], ['battery_temp_c', '°C'], ['battery_voltage_mv', 'mV'], ['battery_current_ua', 'µA'], ['battery_level_pct', '%'],
  ['cpu_freq_max_khz', 'kHz'], ['cpu_usage_pct', '%'], ['package_power_mw', 'mW'], ['storage_throughput_mbps', 'MiB/s'], ['memory_bandwidth_mbps', 'MiB/s'], ['gpu_fps', 'fps'],
];
const PHASE_LEN = [60, 60, 60, 300, 300, 240, 100, 120];
// فحص اصطناعي بـ250 ms بين العيّنات؛ التردّد/الحرارة/... دوال يمرّرها الاختبار: (phase, i داخل المرحلة, tMs) ⟵ قيمة.
function synth(opts) {
  const o = Object.assign({
    phaseLen: PHASE_LEN, freq: (p, i) => 2000000 - (i % 2) * 1000, temp: (p, i, t) => 30 + Math.floor(t / 30000) * 0.5, volt: () => 3800, cur: (p, i) => -(1000000 + (i % 7) * 10000),
    usage: (p, i) => 50 + (i % 9), power: (p, i, t, v, c) => Math.abs(v * c) / 1e6, fps: (p, i) => 100 + (i % 7), footer: {}, units: true, fieldsVersion: 71, dt: 250,
    variables: true,
  }, opts || {});
  const samples = [];
  let t = 100;
  for (let p = 0; p < o.phaseLen.length; p++) {
    for (let i = 0; i < o.phaseLen[p]; i++) {
      const volt = o.volt(p, i, t);
      const cur = o.cur(p, i, t);
      samples.push({phase: p, v: [t, o.temp(p, i, t), volt, cur, 80, o.freq(p, i, t), o.usage(p, i, t), o.power(p, i, t, volt, cur), 150 + (i % 5), 8000 + (i % 3), o.fps(p, i, t)]});
      t += o.dt;
    }
  }
  const variables = VARS.map(([name, unit]) => (o.units ? {name, source: 's', unit} : {name, source: 's'}));
  const footer = Object.assign({fieldsVersion: o.fieldsVersion, stressEffectiveness: {peakBigFreqKhzAnywhere: 2000000}}, o.footer);
  const ts = {header: {appVersion: '1.0.11', androidApiLevel: 34}, footer, samples};
  if (o.variables) ts.variables = variables;
  return asFingerprint(ts);
}
const featOf = (fp) => runAll(fp).lib.features;
const momOf = (fp) => runAll(fp).mom;

{
  // E1. حمولة بلا عيّنات: كل خاصّية ولحظة HARNESS_ERROR صراحةً، وF18 تبقى مرفوضة بصيغتها.
  const none = runAll(asFingerprint({header: {}, footer: {fieldsVersion: 71}, samples: [], variables: []}));
  eq(none.lib.status, STATUS.NOT_MEASURED, 'بلا عيّنات: المكتبة NOT_MEASURED');
  eq(none.lib.reason, REASON.HARNESS_ERROR, 'بلا عيّنات: السبب HARNESS_ERROR');
  for (const d of FEATURE_REGISTRY) {
    const r = none.lib.features[d.name];
    eq(r.value, null, `بلا عيّنات: ${d.name} بلا قيمة (لا صفر)`);
    eq(r.reason, d.id === 'F18' ? REASON.FORMULA_REJECTED_AWAITING_M3_PAIRS : REASON.HARNESS_ERROR, `بلا عيّنات: ${d.name} سببها`);
  }
  eq(none.mom.moments.length, 0, 'بلا عيّنات: لا لحظات');
  eq(none.mom.momentStates.length, 7, 'بلا عيّنات: سبع حالات (L-1×2، L-2، L-3، L-4، L-5×2)');
  for (const s of none.mom.momentStates) {
    eq(s.reason, REASON.HARNESS_ERROR, `بلا عيّنات: ${s.id} HARNESS_ERROR`);
    eq(s.occurred, null, `بلا عيّنات: ${s.id} occurred=null`);
  }
  // عمود أساسي لا يُحَلّ ⟵ HARNESS_ERROR (لا قراءة بفهرس مخمَّن).
  const broken = synth();
  broken.timeSeries.variables.splice(1, 1);
  eq(runAll(broken).lib.status, STATUS.NOT_MEASURED, 'عمود أساسي ناقص من variables[]: NOT_MEASURED/HARNESS_ERROR');
  // عيّنة مشوَّهة (بلا v) ⟵ HARNESS_ERROR لا استثناء.
  const malformed = synth();
  malformed.timeSeries.samples[5] = {phase: 3};
  eq(runAll(malformed).lib.reason, REASON.HARNESS_ERROR, 'عيّنة مشوَّهة: HARNESS_ERROR دون رمي');

  // E2. الوحدة غير المعلنة (A100): بلا variables[] أو بلا unit ⟵ لا خاصّية تعتمد الوحدة.
  const noVars = featOf(synth({variables: false, fieldsVersion: 67}));
  for (const k of [FEATURE.CPU_PEAK_HOLD_S, FEATURE.THERMAL_TEMP_PER_WH, FEATURE.BATTERY_Q_INT_MAH, FEATURE.GPU_P4_MEDIAN_FPS]) {
    eq(noVars[k].reason, REASON.UNIT_UNDECLARED, `بلا variables[]: ${k} UNIT_UNDECLARED (لا افتراض µA/ms)`);
  }
  const noUnits = featOf(synth({units: false}));
  for (const k of [FEATURE.CPU_PEAK_HOLD_S, FEATURE.THERMAL_TEMP_PER_WH, FEATURE.BATTERY_Q_INT_MAH, FEATURE.GPU_P4_MEDIAN_FPS, FEATURE.THERMAL_RESISTANCE]) {
    eq(noUnits[k].reason, REASON.UNIT_UNDECLARED, `variables[] بلا unit: ${k} UNIT_UNDECLARED`);
  }
  const wrongUnit = synth();
  wrongUnit.timeSeries.variables.find((v) => v.name === 'battery_voltage_mv').unit = 'kV';
  eq(featOf(wrongUnit)[FEATURE.THERMAL_TEMP_PER_WH].reason, REASON.UNIT_UNDECLARED, 'وحدة جهد غير معروفة (kV): UNIT_UNDECLARED لا قسمة افتراضية');

  // E3. اكتمال المرحلة: بلا مرحلة 5 ⟵ F2 وthermal_resistance وL-1(5) بسبب مسمّى؛ وبلا مرحلة 7 ⟵ F4.
  const noP5 = synth({phaseLen: [60, 60, 60, 300, 300, 0, 100, 120]});
  const fNoP5 = featOf(noP5);
  eq(fNoP5[FEATURE.CPU_SUSTAINED_P5].reason, REASON.NO_SAMPLES_IN_PHASE, 'بلا مرحلة 5: F2 NO_SAMPLES_IN_PHASE');
  eq(fNoP5[FEATURE.CPU_MIN_WINDOW_P5].reason, REASON.NO_SAMPLES_IN_PHASE, 'بلا مرحلة 5: F3');
  eq(fNoP5[FEATURE.THERMAL_RESISTANCE].reason, REASON.NO_SAMPLES_IN_PHASE, 'بلا مرحلة 5: thermal_resistance');
  const mNoP5 = momOf(noP5);
  eq(mNoP5.momentStates.find((s) => s.id === 'L-1' && s.phase === 5).reason, REASON.NO_SAMPLES_IN_PHASE, 'بلا مرحلة 5: L-1(5) NO_SAMPLES_IN_PHASE');
  const noP7 = featOf(synth({phaseLen: [60, 60, 60, 300, 300, 240, 100, 0]}));
  eq(noP7[FEATURE.CPU_RECOVERY_P7].reason, REASON.NO_SAMPLES_IN_PHASE, 'بلا مرحلة 7: F4');

  // E4. بوّابة الأدلّة: مرحلة 5 بـ30 عيّنة (< 40) ⟵ thermal_resistance INSUFFICIENT_SAMPLES؛ والذروة المعلنة فوق كل ما قيس ⟵ F5 PEAK_NOT_REACHED.
  eq(featOf(synth({phaseLen: [60, 60, 60, 300, 300, 30, 100, 120]}))[FEATURE.THERMAL_RESISTANCE].reason, REASON.INSUFFICIENT_SAMPLES, 'المرحلة 5 دون EVIDENCE_MIN_SAMPLES');
  eq(EVIDENCE_MIN_SAMPLES, 40, 'EVIDENCE_MIN_SAMPLES = 40 (مصدر findings.js)');
  const peakAbove = synth({footer: {stressEffectiveness: {peakBigFreqKhzAnywhere: 9000000}}}); // التردّد الافتراضي يتذبذب (كادنس كافٍ) فلا يحجبها إلا الذروة
  eq(featOf(peakAbove)[FEATURE.CPU_PEAK_HOLD_S].reason, REASON.PEAK_NOT_REACHED, 'ذروة معلنة 9 GHz لا يبلغها شيء: F5 PEAK_NOT_REACHED لا صفر');
  // تردّد ثابت كلّه ⟵ كادنس v5 = 0 ⟵ F5 INSUFFICIENT_CADENCE (بوّابة الأدلّة على القناة نفسها).
  eq(featOf(synth({freq: () => 2000000}))[FEATURE.CPU_PEAK_HOLD_S].reason, REASON.INSUFFICIENT_CADENCE, 'تردّد ثابت: لا كادنس ⟵ F5 INSUFFICIENT_CADENCE');
  // قناة حرارة ثابتة ⟵ INSUFFICIENT_CADENCE في F12/F13/F14/thermal_resistance/L-2.
  const flatTemp = synth({temp: () => 31});
  const fFlat = featOf(flatTemp);
  for (const k of [FEATURE.BATTERY_TEMP_RISE_C, FEATURE.BATTERY_TEMP_RATE_P345, FEATURE.THERMAL_TEMP_PER_WH, FEATURE.THERMAL_RESISTANCE]) eq(fFlat[k].reason, REASON.INSUFFICIENT_CADENCE, `حرارة ثابتة: ${k}`);
  eq(momOf(flatTemp).momentStates.find((s) => s.id === 'L-2').reason, REASON.INSUFFICIENT_CADENCE, 'حرارة ثابتة: L-2');
  // طاقة صفرية (تيّار صفر) ⟵ F14 ZERO_ENERGY؛ قدرة دون الأرضية ⟵ MEAN_POWER_BELOW_FLOOR؛ قدرة غائبة (≤0) ⟵ POWER_ABSENT.
  eq(featOf(synth({cur: () => 0}))[FEATURE.THERMAL_TEMP_PER_WH].reason, REASON.ZERO_ENERGY, 'تيّار صفر: F14 ZERO_ENERGY لا قسمة على صفر');
  eq(featOf(synth({power: () => 1500}))[FEATURE.THERMAL_RESISTANCE].reason, REASON.MEAN_POWER_BELOW_FLOOR, 'قدرة 1.5 W < الأرضية 2 W');
  eq(featOf(synth({power: () => 0}))[FEATURE.THERMAL_RESISTANCE].reason, REASON.POWER_ABSENT, 'قدرة غائبة: POWER_ABSENT لا قيمة');
  // حرارة بداية صالحة غائبة (كل حرارة المرحلة 0 ≤ 0) ⟵ NO_VALID_BASELINE_TEMP.
  const noBase = featOf(synth({temp: (p, i, t) => (p === 0 ? 0 : 30 + Math.floor(t / 30000) * 0.5)}));
  eq(noBase[FEATURE.THERMAL_RESISTANCE].reason, REASON.NO_VALID_BASELINE_TEMP, 'حرارة بداية غير صالحة: NO_VALID_BASELINE_TEMP');
  // قيمة معروفة: R = (أقصى حرارة في المرحلة 5 − متوسّط حرارة أول 5 ث من المرحلة 0) ÷ متوسّط القدرة بالواط.
  const known = synth({power: () => 4000, temp: (p, i, t) => (p === 5 ? 40 : 30 + Math.floor(t / 30000) * 0.5)});
  const rk = featOf(known)[FEATURE.THERMAL_RESISTANCE];
  eq(rk.status, STATUS.MEASURED, 'thermal_resistance بقيم معروفة مقيسة');
  near(rk.value, (40 - 30) / 4, 1e-12, 'thermal_resistance = (40 − 30) ÷ 4 W = 2.5 °C/W');
  eq(rk.unit, '°C/W', 'وحدتها °C/W');

  // E5. F14 وF17 بقيم معروفة: جهد 4 V وتيّار 1 A ثابتان ⟵ الطاقة = 4 W × الزمن، والشحنة = 1000 mA × الزمن.
  const e14 = synth({volt: () => 4000, cur: () => -1000000, phaseLen: [40, 40, 40, 40, 40, 40, 40, 40], temp: (p, i, t) => 30 + Math.floor(t / 10000) * 1});
  const fe = featOf(e14);
  const totalS = (e14.timeSeries.samples[e14.timeSeries.samples.length - 1].v[0] - e14.timeSeries.samples[0].v[0]) / 1000;
  const rise = Math.max(...e14.timeSeries.samples.map((s) => s.v[1])) - e14.timeSeries.samples[0].v[1];
  eq(fe[FEATURE.THERMAL_TEMP_PER_WH].status, STATUS.MEASURED, 'F14 بقيم معروفة مقيسة');
  near(fe[FEATURE.THERMAL_TEMP_PER_WH].value, rise / (4 * totalS / 3600), 1e-9, 'F14 = ارتفاع الحرارة ÷ (4 W × الزمن/3600)');
  near(fe[FEATURE.BATTERY_Q_INT_MAH].value, 1000 * totalS / 3600, 1e-9, 'F17 = 1000 mA × الزمن/3600');

  // F. اللحظات الاصطناعية بجواب معروف.
  const peak = 2000000;
  // تذبذب 1 kHz بين عيّنتين متجاورتين يمنح بوّابة الكادنس (≥ 5 تغيّرات في المرحلة) بلا تغيير أقصى النافذة.
  const dropAt40 = (p, i) => (p === 3 ? (i < 160 ? peak : peak * 0.8) - (i % 2) : (i % 3 === 0 ? peak : peak - 1000));
  const m1 = momOf(synth({freq: dropAt40}));
  const L1 = m1.moments.find((x) => x.id === 'L-1' && x.phase === 3);
  ok(L1, 'L-1: هبوط عند 40 ث من بداية المرحلة 3');
  near(L1.value, 0.8, 1e-12, 'L-1: قيمة نافذة الهبوط 0.8');
  eq(L1.detail.windowsBelowToEnd, 7, 'L-1: النوافذ الهابطة حتى النهاية: 15 − 8 = 7');
  const startT = synth({freq: dropAt40}).timeSeries.samples.find((s) => s.phase === 3).v[0];
  near(L1.t_s, (startT + 8 * SUSTAINED_WINDOW_MS) / 1000, 1e-9, 'L-1: t_s = بداية النافذة الثامنة');
  eq(L1.detail.windowMs, 5000, 'L-1: النافذة 5 ث');
  // يعود فلا «ولا يعود حتى نهاية المرحلة» ⟵ لا لحظة، والحالة «لم تقع» مقيسة.
  const returns = momOf(synth({freq: (p, i) => (p === 3 ? ((i >= 160 && i < 240) ? peak * 0.8 : peak - (i % 2)) : peak - (i % 2))}));
  eq(returns.moments.find((x) => x.id === 'L-1' && x.phase === 3), undefined, 'L-1: يعود إلى ≥ 0.9 قبل النهاية ⟵ لا لحظة');
  const sReturn = returns.momentStates.find((s) => s.id === 'L-1' && s.phase === 3);
  eq(sReturn.status, STATUS.MEASURED, 'L-1: «لم تقع» حالة مقيسة');
  eq(sReturn.occurred, false, 'L-1: occurred=false');
  // النافذة الأخيرة الجزئية بعيّنة واحدة منخفضة لا تُنتج «هبوطاً» (اختيار S-B5).
  const partial = momOf(synth({phaseLen: [60, 60, 60, 301, 300, 240, 100, 120], freq: (p, i) => (p === 3 ? (i === 300 ? peak * 0.5 : peak - (i % 2)) : peak - (i % 2))}));
  const sPartial = partial.momentStates.find((s) => s.id === 'L-1' && s.phase === 3);
  eq(sPartial.occurred, false, 'L-1: عيّنة منخفضة وحيدة في نافذة جزئية أخيرة ليست هبوطاً مستداماً');
  // وبنافذة كاملة تنتهي منخفضة ⟵ هبوط.
  const fullLow = momOf(synth({freq: (p, i) => (p === 3 ? (i >= 280 ? peak * 0.5 : peak - (i % 2)) : peak - (i % 2))}));
  const LF = fullLow.moments.find((x) => x.id === 'L-1' && x.phase === 3);
  ok(LF && LF.detail.windowsBelowToEnd >= 1, 'L-1: نافذة كاملة منخفضة في ذيل المرحلة ⟵ هبوط');

  // L-2: التعادل ⟵ أول عيّنة تبلغ الأقصى.
  const tempFn = (p, i, t) => (t >= 60000 ? 40 : 30 + Math.floor(t / 5000) * 0.2);
  const L2 = momOf(synth({temp: tempFn})).moments.find((x) => x.id === 'L-2');
  ok(L2, 'L-2 موجودة');
  eq(L2.value, 40, 'L-2 قيمة الأقصى');
  const firstAt40 = synth({temp: tempFn}).timeSeries.samples.find((s) => s.v[1] === 40);
  eq(L2.t_s, firstAt40.v[0] / 1000, 'L-2: أول عيّنة تبلغ الأقصى عند التعادل');

  // L-3: ركبة اصطناعية عند المقطع 6: مقاطع 100 ثم 40 (≤ 0.5 × وسيط ما قبلها).
  const segs = (mbps) => mbps.map((v, k) => ({cumulativeBytes: (k + 1) * 268435456, mbps: v}));
  const withKnee = synth({footer: {verificationResults: {storageThroughputSegments: segs([100, 102, 98, 101, 99, 100, 40, 95, 96, 97])}}});
  const k3 = momOf(withKnee).moments.find((x) => x.id === 'L-3');
  ok(k3, 'L-3: ركبة عند المقطع 6');
  eq(k3.detail.segmentIndex, 6, 'L-3: فهرس المقطع');
  near(k3.value, 7 * 268435456 / 2 ** 30, 1e-12, 'L-3: الموضع = البايتات المتراكمة ÷ 2^30');
  eq(k3.detail.previousSegmentMbps, 100, 'L-3: المقطع قبله');
  eq(k3.detail.nextSegmentMbps, 95, 'L-3: المقطع بعده');
  const noKnee = momOf(synth({footer: {verificationResults: {storageThroughputSegments: segs([100, 102, 98, 101, 99, 100, 97, 95, 96, 97])}}}));
  eq(noKnee.moments.find((x) => x.id === 'L-3'), undefined, 'L-3: لا ركبة ⟵ لا لحظة');
  eq(noKnee.momentStates.find((s) => s.id === 'L-3').occurred, false, 'L-3: لم تقع (مقيس) لا غياب');
  eq(momOf(synth()).momentStates.find((s) => s.id === 'L-3').reason, REASON.STORAGE_SEGMENTS_ABSENT, 'L-3: بلا مقاطع ⟵ STORAGE_SEGMENTS_ABSENT');
  const fSeg = featOf(synth({footer: {verificationResults: {storageThroughputSegments: segs([100, 102, 98, 101, 99, 100, 97, 95, 96, 97])}}}));
  eq(fSeg[FEATURE.STORAGE_KNEE_GB].reason, REASON.NO_KNEE_IN_SCAN, 'F11 بلا ركبة: NO_KNEE_IN_SCAN (واقعة مسمّاة)');
  eq(fSeg[FEATURE.STORAGE_POST_CACHE_MBPS].reason, REASON.NO_KNEE_IN_SCAN, 'F10 بلا ركبة');
  eq(fSeg[FEATURE.STORAGE_IN_CACHE_MBPS].status, STATUS.MEASURED, 'F9 بلا ركبة مقيسة (كل المقاطع في المخبأ)');
  eq(featOf(synth())[FEATURE.STORAGE_IN_CACHE_MBPS].reason, REASON.STORAGE_SEGMENTS_ABSENT, 'F9 بلا مقاطع: STORAGE_SEGMENTS_ABSENT');

  // L-5 اصطناعية: عند التسجيل، وحالة المستمع غير ok، وقائمة غائبة، ولا بلوغ.
  const ev = (arr, state) => synth({footer: {thermalStatusEvents: arr, thermalStatusState: state}});
  const atReg = momOf(ev([{t: 0, status: 2}, {t: 60000, status: 3}], 'ok'));
  const reg = atReg.moments.find((x) => x.id === 'L-5' && x.detail.threshold === 'MODERATE');
  eq(reg.detail.atRegistration, true, 'L-5: أوّل عنصر قراءة عند التسجيل (عقد ت-04)');
  eq(reg.t_s, 0, 'L-5: t_s = 0');
  eq(reg.phase, null, 'L-5: حدث قبل أوّل عيّنة (t=0 < أوّل طابع 100) ⟵ بلا مرحلة لا تخمين');
  eq(reg.detail.phaseBasis, 'EVENT_BEFORE_FIRST_SAMPLE', 'L-5: أساس المرحلة معلن');
  const sev = atReg.moments.find((x) => x.id === 'L-5' && x.detail.threshold === 'SEVERE');
  eq(sev.t_s, 60, 'L-5: SEVERE عند 60 ث');
  ok(sev.phase !== null, 'L-5: SEVERE لها مرحلة (عيّنات قبلها)');
  const none5 = momOf(ev([{t: 0, status: 0}, {t: 90000, status: 1}], 'ok'));
  for (const s of none5.momentStates.filter((x) => x.id === 'L-5')) {
    eq(s.status, STATUS.MEASURED, 'L-5: لم تبلغ العتبة (مقيس)');
    eq(s.occurred, false, 'L-5: occurred=false');
  }
  for (const kind of ['api_below_29', 'listener_registration_failed:boom', 'initial_read_failed:x']) {
    const bad = momOf(ev([{t: 0, status: 3}], kind));
    const s = bad.momentStates.find((x) => x.id === 'L-5' && x.threshold === 'SEVERE');
    eq(s.reason, REASON.THERMAL_STATUS_NOT_OK, `L-5: حالة ${kind} ⟵ THERMAL_STATUS_NOT_OK`);
    eq(s.reasonDetail, kind.split(':')[0], `L-5: نوع الحالة ${kind.split(':')[0]} معلن`);
  }
  const noList = momOf(synth());
  eq(noList.momentStates.find((x) => x.id === 'L-5' && x.threshold === 'MODERATE').reason, REASON.NO_THERMAL_STATUS_EVENTS, 'L-5: قائمة غائبة (ختم 71) ⟵ NO_THERMAL_STATUS_EVENTS');
  // حالة خارج المفردة تُعلَن غير ok ولا تُقرأ ok (القاعدة 25).
  const unk = momOf(ev([{t: 0, status: 3}], 'weird_state'));
  eq(unk.momentStates.find((x) => x.id === 'L-5' && x.threshold === 'SEVERE').reasonDetail, 'UNRECOGNIZED', 'L-5: حالة غير معروفة ⟵ UNRECOGNIZED لا ok');
  // عنصر بحالة خارج 0..6 يُسقطه القارئ (status=null) فلا يُحسب بلوغاً.
  const outOfRange = momOf(ev([{t: 0, status: 9}, {t: 1000, status: 1}], 'ok'));
  eq(outOfRange.momentStates.find((x) => x.id === 'L-5' && x.threshold === 'MODERATE').occurred, false, 'L-5: حالة 9 (خارج 0..6) لا تُقرأ بلوغاً');
}

// ═══════════════════════════════════════════════════════════════════════
// G. لا شبكة ولا حالة مشتركة: الوحدات لا تستورد شبكة/Firestore ولا تكتب.
// ═══════════════════════════════════════════════════════════════════════
{
  for (const f of ['featureNames.js', 'featureLibrary.js', 'moments.js', 'matrixProfile.js', 'scanColumns.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', f), 'utf8');
    ok(!/require\(['"](firebase-admin|https?|net|child_process|node-fetch|axios)['"]\)/.test(src), `${f}: لا استيراد لشبكة/Firestore/عمليات`);
    ok(!/\bfetch\(|\bfs\.(write|append|unlink|rm)/.test(src), `${f}: لا طلب شبكة ولا كتابة ملفّ`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// H. الوثيقة تعدّد كل اسم (القاعدتان 7 و25): كل قيمة مفردة مُصدَّرة مذكورة في docs/PROTOCOL_CONTRACT.md §٢-ب بين علامتَي اقتباس مائل،
//    فمن يضيف سبباً أو وحدة أو حكماً أو مفتاح قالب بلا تحديث الوثيقة يُخفق هنا.
// ═══════════════════════════════════════════════════════════════════════
{
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8');
  const start = doc.indexOf('## ٢-ب — مكتبة الخصائص واللحظات');
  const end = doc.indexOf('## ٣ — أرقام الإصدارات');
  ok(start !== -1 && end > start, 'قسم §٢-ب موجود في العقد');
  const section = doc.slice(start, end);
  const documented = (v) => section.includes('`' + v + '`');
  for (const v of Object.values(REASON)) ok(documented(v), 'REASON.' + v + ' مذكور في العقد §٢-ب');
  for (const v of Object.values(NAMES.JUDGEMENT)) ok(documented(v), 'JUDGEMENT.' + v + ' مذكور في العقد §٢-ب');
  for (const v of Object.values(NAMES.UNIT)) ok(documented(v), 'UNIT ' + v + ' مذكورة في العقد §٢-ب');
  for (const v of Object.values(NAMES.MOMENT_TEMPLATE_KEY)) ok(documented(v), 'templateKey ' + v + ' مذكور في العقد §٢-ب');
  for (const d of FEATURE_REGISTRY) ok(section.includes(d.id + ' `' + d.name + '`'), 'الخاصّية ' + d.id + ' ' + d.name + ' مذكورة باسمها ومعرّفها في العقد §٢-ب');
  // كل حقل في سجلّ الخاصّية وفي عنصر اللحظة وفي حالتها مذكور.
  const lib = runAll(asFingerprint(loadJson(GOLDEN_DIR, REAL[0]))).lib;
  for (const k of Object.keys(Object.values(lib.features)[0])) ok(documented(k), 'مفتاح سجلّ الخاصّية ' + k + ' مذكور');
  const mom = runAll(asFingerprint(loadJson(GOLDEN_DIR, REAL[0]))).mom;
  for (const k of Object.keys(mom.moments[0])) ok(documented(k), 'مفتاح عنصر اللحظة ' + k + ' مذكور');
  const sigAt = section.indexOf('{id, phase:');
  ok(sigAt !== -1, 'شكل حالة اللحظة مكتوب في العقد');
  const sig = section.slice(sigAt, section.indexOf('}', sigAt) + 1);
  for (const k of Object.keys(mom.momentStates[0])) ok(new RegExp('[{ ,]' + k + '[:,}]').test(sig), 'مفتاح حالة اللحظة ' + k + ' في الشكل المكتوب');
  // وكل مفتاح detail لكل لحظة ظهرت على الفحص الحقيقي مذكور.
  const seen = new Set();
  for (const m of mom.moments) for (const k of Object.keys(m.detail)) seen.add(k);
  for (const k of seen) ok(documented(k), 'مفتاح detail ' + k + ' مذكور');
  const fp71 = runAll(loadJson(GOLDEN_DIR, FV71_11)).mom;
  for (const m of fp71.moments) for (const k of Object.keys(m.detail)) ok(documented(k), 'مفتاح detail (fv71) ' + k + ' مذكور');
}

console.log(`featureLibrary.test.js: ALL PASS (${n} assertions)`);
