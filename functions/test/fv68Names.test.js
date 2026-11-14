'use strict';

// fv68Names.test.js — الدفعة ٤ من V8 (PLAN-05)، القاعدة 24 والقاعدة 25.
//
// يحرس أن أسماء عقد fv68 وقيمه الحرفية **في موضع واحد** (src/analysis/fv68Names.js) وأن ما يقرؤه الخادم بالفهرس ثابت بالعقد:
//   ١) المصدر الواحد: الاسم الجديد الذي يقوم عليه تمييز لا يظهر نصّاً حرفياً في أيّ ملفّ كود آخر في functions/src (ما عدا
//      التعريف نفسه). ضابط سلبي: الفحص يلتقط نسخة حرفية موضوعة عمداً.
//   ٢) أسماء الأعمدة الأساسية v[0..10] بترتيبها = أسماء العيّنات الذهبية الحقيقية في كل فهرس (fv67 بملف السلاسل، وfv68 بالحمولة) —
//      فالقارئات التي تقرأ v[0..4] بالفهرس (sampleInputsFromRaw.js) محميّة باختبار لا بالاسم (عقد :398-402 «لا يتحرّك فهرس»).
//   ٣) كل المجموعات مجمَّدة (لا يُعدَّل مصدر الحقيقة في وقت التشغيل).
//
// Run: node functions/test/fv68Names.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const SRC = path.join(__dirname, '..', 'src');

// ─── ٣) التجميد ─────────────────────────────────────────────────────────
for (const [name, v] of Object.entries(N)) {
  if (v !== null && typeof v === 'object') ok(Object.isFrozen(v), `[٣] ${name} مجمَّدة`);
}
ok(Object.isFrozen(N.BATTERY_HEALTH.INDICATORS), '[٣] مؤشّرات batteryHealth مجمَّدة (تجميد عميق)');
ok(Object.isFrozen(N.STATE_VOCABULARY.memoryVerifyState.exact), '[٣] مفردات الحالات مجمَّدة تجميداً عميقاً');

// ─── ٢) الأعمدة الأساسية في مواضعها ──────────────────────────────────────
eq(N.BASE_CHANNEL_COUNT, 11, '[٢] أحد عشر عموداً أساسياً (V2_SAMPLE_VAR_COUNT في التطبيق)');
eq(N.BASE_CHANNEL_ORDER[0], 'timestamp_ms', '[٢] v[0] الزمن');
eq(N.BASE_CHANNEL_ORDER[10], 'gpu_fps', '[٢] v[10] gpu_fps');

const variablesOf = (fp) => (fp.timeSeries ? fp.timeSeries.variables : fp.variables);
const fixtures = [];
for (const stem of ['11ch-nothing-admitted', '13ch-selinux-blocked-policy', '16ch-four-policies-truncated-failures']) {
  const f = `fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-${stem}.json`;
  fixtures.push({label: `fv69 ${stem}`, vars: variablesOf(JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8')))});
}
fixtures.push({
  label: 'fv67 payload 1.0.10',
  vars: variablesOf(JSON.parse(fs.readFileSync(path.join(GOLDEN, 'fv67-app-request-payload-1.0.10-62507f4-from-golden-34dff2b8.json'), 'utf8')).fingerprint),
});
for (const f of ['8909e850-s10.ts.json', 'e4b65a2f-honor.ts.json', 'b45c8cf6.ts.json', '34dff2b8.ts.json']) {
  fixtures.push({label: `fv67 file ${f}`, vars: variablesOf(JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8')))});
}
for (const {label, vars} of fixtures) {
  ok(Array.isArray(vars) && vars.length >= 11, `[٢] ${label}: variables[] بطول ≥ 11`);
  N.BASE_CHANNEL_ORDER.forEach((name, i) => {
    eq(vars[i].name, name, `[٢] ${label}: اسم العمود ${i}`);
  });
}

// القارئات بالفهرس الثابت: sampleInputsFromRaw.js يقرأ v[0..4] (الزمن · الحرارة · الجهد · التيار · المستوى).
{
  const src = fs.readFileSync(path.join(SRC, 'analysis', 'sampleInputsFromRaw.js'), 'utf8');
  const reads = [...src.matchAll(/(?:s\.v\[(\d+)\]|col\((\d+)\))/g)].map((m) => Number(m[1] !== undefined ? m[1] : m[2]));
  ok(reads.length > 0, '[٢] sampleInputsFromRaw.js يقرأ فهارس ثابتة (وإلا فالحارس بلا موضوع)');
  eq([...new Set(reads)].sort((a, b) => a - b), [0, 1, 2, 3, 4], '[٢] sampleInputsFromRaw.js يقرأ v[0..4] وحدها — وكلّها أساسية مجمَّدة بالعقد');
}

// ─── ١) المصدر الواحد ───────────────────────────────────────────────────
// أسماء fv68 الجديدة (ليست قديمة الاستعمال في المستودع قبل الدفعة ٤). القديمة المنتشرة (fieldsVersion، batteryHealth، designCapacityMah…)
// خارج هذا الفحص — موجودة في عشرات المواضع قبل fv68، وتغيير ذلك ليس من هذه الدفعة.
const collectStrings = (obj, out) => {
  if (typeof obj === 'string') out.add(obj);
  else if (Array.isArray(obj)) obj.forEach((x) => collectStrings(x, out));
  else if (obj && typeof obj === 'object' && !(obj instanceof RegExp)) Object.values(obj).forEach((x) => collectStrings(x, out));
};
const exemptPreExisting = new Set([
  'fieldsVersion', 'batteryHealth', 'verificationResults', 'designCapacityMah', 'cycleCount', 'cycleCountSource', 'chargeCounterUah',
  'scanStillness', 'channelDiscovery', 'unmeasuredDefaults', 'storageThroughputSegments', 'gpuComputeGemmCorrect', 'criticalDefectDetected',
  'memoryTestedBytes', 'aiActiveDelegate', 'storageWriteVerifyErrors', 'storageReadVerifyErrors', 'memoryRandomVerifyErrors',
  'footer', 'header', 'samples', 'variables', 'appVersion', 'androidApiLevel', 'isStill', 'accelStdDev', 'sampleCount',
  'name', 'unit', 'source', 'phase', 'status', 'state', 'reasons', 'attempted', 'available', 'missing', 'blockedBySelinux', 'readings',
  'dischargeRateUnderLoadMa', 'voltageStabilityMv', 'batteryTempRiseC', 'levelDropPct', 'dischargeVsDesignRatioMah',
  // أسماء قديمة الاستعمال في الخادم قبل fv68 (أسماء بنية التقييم لا عقد الحمولة): تُقرأ في findings.js/التوقيع منذ الدفعات السابقة
  'cpuFmaErrors', 'cpuPrimeSieveCorrect', 'memoryMarchPassed', 'memoryWalkingOnesPassed', 'maxCpuTemp', 'storageSlcCacheSizeMb',
  't', 'tempRaw', 'headroom',
  // 2026-10-21: «WRONG_TYPE» قيمة قائمة في KEY_STATUS ورمز شذوذ قائم في القارئ (cell()) — وTOUCH_GRID_PATTERN_STATE.WRONG_TYPE يعيد استعمالها بالمعنى نفسه (نوع لا يطابق العقد) فلا تُعدّ «اسماً جديداً»
  'WRONG_TYPE',
]);
const newNames = new Set();
for (const group of ['FOOTER', 'SCAN_STILLNESS', 'BATTERY_PAIRS_STATE', 'BATTERY_PAIR_ELEMENT', 'THERMAL_HEADROOM_ELEMENT', 'THERMAL_STATUS_ELEMENT',
  'CPU_POLICY_ELEMENT', 'CHANNEL_DISCOVERY', 'BATTERY_HEALTH', 'VERIFICATION', 'MEMORY_PHASE_WINDOW_ELEMENT', 'CPU_KNOWN_ANSWER_RUN_ELEMENT',
  'TIME_SERIES', 'L02_MEASUREMENT_KEYS', 'STEP_SENSOR_MEASUREMENT_KEYS', 'TOUCH_GRID_MEASUREMENT_KEYS', 'THROUGHPUT_UNIT_BASIS',
  // fv69 (الدفعة ١٠، عقد §٧-ح (ب)): قيم endReason الأربع وحالة اللمس وأساس elapsedMs — لا نسخة حرفية منها خارج fv68Names.js
  'TOUCH_GRID_END_REASON', 'TOUCH_GRID_TOUCH_STATE', 'TOUCH_GRID_ELAPSED_BASIS',
  // fv71 (S-M02، 2026-10-18 +03): مفاتيح M-02 الجديدة وقيمها المعدَّدة وعتباتها وحالاتها — لا نسخة حرفية منها خارج fv68Names.js (touchPath.js وfv68Reader.js يستوردانها)
  'TOUCH_GRID_GRID_BASIS', 'TOUCH_PATH_STATE', 'TOUCH_PATH_MEASUREMENT_KEYS', 'TOUCH_PATH_PRESENCE', 'TOUCH_PATH_STROKE_KEYS', 'TOUCH_PATH_STROKE_END', 'TOUCH_PATH_TOOL_TYPE',
  'TOUCH_PATH_DENSITY_SOURCE', 'TOUCH_PATH_SUSPECT_KIND', 'TOUCH_PATH_SUSPECT_ELEMENT', 'TOUCH_PATH_PATH_CAP_KEYS', 'TOUCH_PATH_RECT_KEYS', 'TOUCH_PATH_ROUNDED_CORNER_KEYS',
  'TOUCH_PATH_ROUNDED_CORNERS_STATE', 'TOUCH_PATH_ABSENT_REASON', 'TOUCH_PATH_DETECTION_STATE', 'TOUCH_PATH_EXCLUSION', 'TOUCH_PATH_CELLS_CHECK', 'TOUCH_PATH_EDGES_STATE',
  'TOUCH_PATH_EDGE_BASIS', 'TOUCH_PATH_EDGE_SIDE', 'TOUCH_PATH_EDGE_EXIT_SOURCE', 'TOUCH_PATH_DISPLAYED_STATE', 'TOUCH_GRID_ANSWER_STATE', 'TOUCH_GRID_PASS_RAW_RELATION',
  // fv71 (M-02 «إطار + X»، 2026-10-21 +03): مفتاحا المجموعة المطلوبة وقيمتا النمط وحالاتها وأساس المطلوب وأسماء الشذوذ الجديدة — القاعدة 24: لا نسخة حرفية منها خارج fv68Names.js
  'TOUCH_GRID_PATTERN_KEYS', 'TOUCH_GRID_PATTERN', 'TOUCH_GRID_PATTERN_STATE', 'TOUCH_GRID_REQUIRED_CELLS_BASIS', 'TOUCH_GRID_PATTERN_ANOMALY',
  // fv71 (S-VOL، 2026-10-18 +03): مفاتيح أزرار الصوت M-09/M-10 وقيمها المعدَّدة وحالاتها — لا نسخة حرفية منها خارج fv68Names.js (أُضيفت في S-P6-13: غابت عن S-VOL)
  'VOLUME_BUTTON_MEASUREMENT_KEYS', 'VOLUME_BUTTON_PRESENCE', 'VOLUME_BUTTON_EVENT_KEYS', 'VOLUME_BUTTON_EVENT_ACTION', 'VOLUME_BUTTON_END_REASON', 'VOLUME_BUTTON_DETECTION_SOURCE',
  'VOLUME_BUTTON_STATE', 'VOLUME_BUTTON_PRESS_EVIDENCE', 'VOLUME_BUTTON_ANSWER_STATE',
  // fv71 (S-P6-13، 2026-10-18 +03): مفاتيح توحيد الظروف وقيمها المعدَّدة وحالاتها — لا نسخة حرفية منها خارج fv68Names.js
  'SCAN_CONDITIONS_KEYS', 'POWER_SAVE_STATE', 'BRIGHTNESS_LOCK_KEYS', 'BRIGHTNESS_LOCK_STATE', 'BRIGHTNESS_LOCK_METHOD', 'BATTERY_WINDOW_KEYS', 'SCAN_CONDITIONS_STATE',
  'POWER_SAVE_BASIS', 'BATTERY_WINDOW_BASIS', 'START_LEVEL_VS_WINDOW']) {
  collectStrings(N[group], newNames);
}
for (const s of [N.CHARGE_COUNTER_CHANNEL, N.CHARGE_COUNTER_UNIT_AS_DECLARED, N.MEASUREMENTS_KEY, N.MEASUREMENTS_UNENCODABLE_KEY,
  N.MEASUREMENTS_UNREADABLE_KEY]) newNames.add(s);
// الأسماء الطويلة المميِّزة فقط (≥ 8 أحرف أو فيها _): الكلمات القصيرة (t, name…) تتكرّر بلا دلالة اسم حقل
const distinctive = [...newNames].filter((s) => !exemptPreExisting.has(s) && (s.length >= 8 || s.includes('_')));
ok(distinctive.length >= 60, `[١] أسماء fv68 المميِّزة المفحوصة (${distinctive.length}) ≥ 60 — وإلا انهار الجمع`);

const listJs = (dir) => fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return (e.name === 'prompts' || e.name === 'lab') ? [] : listJs(p);
  return e.name.endsWith('.js') ? [p] : [];
});
const isCommentLine = (l) => { const t = l.trim(); return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'); };
function literalHits(file, names) {
  const hits = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (isCommentLine(line)) return;
    for (const name of names) {
      if (line.includes(`"${name}"`) || line.includes(`'${name}'`) || line.includes(`\`${name}\``)) hits.push(`${path.relative(SRC, file)}:${i + 1} "${name}"`);
    }
  });
  return hits;
}
const sourceFiles = listJs(SRC).filter((f) => path.basename(f) !== 'fv68Names.js');
const allHits = sourceFiles.flatMap((f) => literalHits(f, distinctive));
eq(allHits, [], '[١] لا اسم fv68 جديد بنصّ حرفي خارج fv68Names.js (القاعدة 24)');

// ضابط سلبي: الفحص يلتقط نسخة حرفية موضوعة عمداً (ملفّ مؤقّت يُنشأ ويُحذف في الاختبار نفسه، خارج الشجرة المتتبَّعة)
{
  const tmp = path.join(require('os').tmpdir(), `fv68names-negative-${process.pid}.js`);
  fs.writeFileSync(tmp, `const x = "${N.FOOTER.CPU_TEMP_FINAL_SOURCE}";\n// "${N.FOOTER.CPU_POLICIES}" في تعليق لا يُحتسب\n`);
  const hits = literalHits(tmp, distinctive);
  fs.unlinkSync(tmp);
  eq(hits.length, 1, '[١] ضابط سلبي: نسخة حرفية في كود تُلتقط، والتعليق لا يُحتسب');
}

// المصدر نفسه يعرّف كل اسم مرّة واحدة: لا قيمتان متطابقتان في مجموعتين (اسم واحد بمعنيين)
{
  const seen = new Map();
  const dups = [];
  for (const group of ['FOOTER', 'VERIFICATION', 'BATTERY_HEALTH']) {
    const vals = new Set();
    collectStrings(N[group], vals);
    for (const s of vals) {
      if (seen.has(s) && seen.get(s) !== group) dups.push(`${s} (${seen.get(s)} و${group})`);
      seen.set(s, group);
    }
  }
  eq(dups, [], '[١] لا اسم معرَّف في مجموعتين مختلفتين (FOOTER/VERIFICATION/BATTERY_HEALTH)');
}

console.log(`\nfv68Names.test.js: ${n}/${n} assertions passed`);
