'use strict';

// fv71ModelPayloadRaw.test.js — خامّ M-02 (fv71) لا يصل النموذج؛ والمفاتيح القديمة تصله كما كانت، S-M02، 2026-10-18 +03 (القاعدة 20 وقرار المستخدم 2026-10-06).
//
// السبب (وُجد بالأداة في e2e analyzeDeviceFv71M02، لا بالتخمين): testResults[].raw في حمولة النموذج = عنصر manualResults كلّه (categoryStates.buildAllTestResults: `raw: r`) ولا قائمة بيضاء لـtestResults
// (v7ModelPayloadWhitelist.js)، فكان M-02 fv71 يحمل strokes (آلاف النقاط، بإحداثيّاتها) إلى النموذج: كلفة رموز تُسقط الفحص، وقيمة لا يُبنى عليها حرف ولا عتبة معايَرة.
// الإصلاح: buildV7Payload.hideRawMeasurementKeysForModel بمفاتيح fv68Names.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS (مصدر واحد).
//
// **وأزرار الصوت M-09/M-10 (S-VOL، 2026-10-18):** كل مفاتيح measurements فيهما جديدة في fv71 فتُخفى كلّها (events[] حتى 64 عنصراً…) — الكتلة «د» أدناه.
//
// ما يثبّته:
//   أ) نقيّ: مفاتيح fv71 الاثنان والثلاثون تُحذف من raw.measurements لـM-02 والثمانية القديمة تبقى بقيمها وترتيبها؛ لا تعديل في المكان؛ اختبار آخر بالمفتاح نفسه لا يُمسّ (السياسة بمعرّف الاختبار).
//   ب) **لا تغيير لختم ≤ 70**: خامّ M-02 بثمانية مفاتيح (fv69 وfv70 الذهبيتان) يصل النموذج بايتاً ببايت كما كان.
//   جـ) المسار الحقيقي بلا استبدال (القاعدة 37): computeCategoryStates ثم sanitizeTestResultsForModelPayload على حمولات المُنتِج الثلاث (NeuralChek@f9e0571، مزامنة 2026-10-18): **المخزَّن** (categoryStates.testResults) يحتفظ بالخامّ كاملاً،
//       **ونسخة النموذج** بلا strokes ولا أيّ مفتاح fv71. والاختبار الأطول (e2e analyzeDeviceFv71M02) يمرّر الحمولة بـanalyzeDevice الحقيقية.
//
// Run: node functions/test/fv71ModelPayloadRaw.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {_internal: {sanitizeTestResultsForModelPayload}} = require('../src/analysis/buildV7Payload');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));

const LEGACY = Object.values(N.TOUCH_GRID_MEASUREMENT_KEYS);
// مفاتيح fv71 في M-02: الاثنان والثلاثون في TOUCH_PATH_FIELD_SPEC + مفتاحا «إطار + X» (2026-10-21) مكتوبان باليد من العقد — جديدان في fv71 فلا يصلان النموذج (القاعدة 20) — القاعدة 23: حُدِّث التوقّع في مكانه
const NEW_KEYS = [...Object.keys(N.TOUCH_PATH_FIELD_SPEC), 'gridPattern', 'notRequiredCells'];
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
// حمولات المُنتِج الثلاث (نسخ حرفية، sha256 في fv68AppPayloadGoldenCopy.test.js) — حلّت محلّ عيّنات بنيتُها من العقد (حُذفت، القاعدة 23)
const PRODUCER_FILES = {
  '11ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json',
  '13ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json',
  '16ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json',
};
const PRODUCER = Object.keys(PRODUCER_FILES).map((key) => ({key, payload: JSON.parse(fs.readFileSync(path.join(GOLDEN, PRODUCER_FILES[key]), 'utf8'))}));

// ═══ أ) نقيّ ═══════════════════════════════════════════════════════════════════════════════════════════════════
eq([...NEW_KEYS].sort(), [...N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-02']].sort(), '[أ] المخفيّ عن النموذج لـM-02 = مفاتيح fv71 الأربعة والثلاثون كلّها (الاثنان والثلاثون ومفتاحا «إطار + X»، من مصدرها الواحد)');
eq(LEGACY.filter((k) => N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-02'].includes(k)), [], '[أ] ولا واحد من المفاتيح الثمانية القديمة مخفيّ');
{
  const sample = PRODUCER[1]; // 13ch: M-02 fail بقفزتين وراحة يد وعلامتي edge_exit
  const m = sample.payload.manualResults.find((x) => x.testId === 'M-02');
  const tr = {testId: 'M-02', kind: 'MANUAL', category: 'display', outcome: 'FAIL', notMeasuredReason: null, raw: clone(m)};
  const before = JSON.stringify([tr]);
  const [out] = sanitizeTestResultsForModelPayload([tr]);
  eq(JSON.stringify([tr]), before, '[أ] لا تعديل في المكان');
  eq(Object.keys(out.raw.measurements), Object.keys(m.measurements).filter((k) => LEGACY.includes(k)), '[أ] تبقى المفاتيح الثمانية القديمة بترتيبها');
  eq(LEGACY.map((k) => out.raw.measurements[k]), LEGACY.map((k) => m.measurements[k]), '[أ] وبقيمها حرفاً');
  eq(NEW_KEYS.filter((k) => k in out.raw.measurements), [], '[أ] ولا مفتاح fv71 واحد (strokes وpathCap وكلّ ما سواهما)');
  eq([out.raw.status, out.raw.testId, out.raw.categoryName, out.outcome, out.kind], [m.status, 'M-02', m.categoryName, 'FAIL', 'MANUAL'], '[أ] وبقيّة raw وعنصر النتيجة بلا مساس');
  ok(Buffer.byteLength(JSON.stringify(out)) < 1500, `[أ] ونسخة النموذج صغيرة (${Buffer.byteLength(JSON.stringify(out))} بايتاً) رغم ${m.measurements.strokes.reduce((a, s) => a + s.x.length, 0)} نقطة`);
  // اختبار آخر بمفتاح باسم fv71: لا يُمسّ (السياسة بمعرّف الاختبار، لا بالاسم وحده)
  const other = {testId: 'L-02', outcome: 'PASS', raw: {testId: 'L-02', status: 'pass', measurements: {strokes: [1, 2, 3], visibleSatellites: 4}}};
  eq(sanitizeTestResultsForModelPayload([other])[0].raw.measurements, {strokes: [1, 2, 3], visibleSatellites: 4}, '[أ] L-02 بمفتاح اسمه strokes: لا يُمسّ (السياسة لـM-02 وحده)');
  // لا measurements أو بنوع خاطئ: يمرّ كما هو
  for (const meas of [undefined, null, 'x', [1, 2], 5]) {
    const t = {testId: 'M-02', outcome: 'PASS', raw: {testId: 'M-02', status: 'pass', ...(meas === undefined ? {} : {measurements: meas})}};
    eq(JSON.stringify(sanitizeTestResultsForModelPayload([t])[0].raw), JSON.stringify(t.raw), `[أ] M-02 بـmeasurements=${JSON.stringify(meas)}: بلا مساس`);
  }
  // raw غائب
  eq(sanitizeTestResultsForModelPayload([{testId: 'M-02', outcome: 'PASS'}])[0], {testId: 'M-02', outcome: 'PASS'}, '[أ] بلا raw: بلا مساس');
}

// ═══ ب) ختم ≤ 70: بايتاً ببايت ═══════════════════════════════════════════════════════════════════════════════════
for (const f of ['fv69-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json', 'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json',
  'fv70-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json']) {
  const fp = JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
  const m = fp.manualResults.find((x) => x.testId === 'M-02');
  const tr = {testId: 'M-02', outcome: 'PASS', raw: clone(m)};
  const [out] = sanitizeTestResultsForModelPayload([tr]);
  eq(JSON.stringify(out.raw), JSON.stringify(m), `[ب] ${f.slice(0, 5)}…${f.slice(-30)}: خامّ M-02 القديم يصل النموذج بايتاً ببايت (لا تغيير لختم ≤ 70)`);
  eq(Object.keys(out.raw.measurements).sort(), Object.keys(m.measurements).sort(), '[ب] بمفاتيحه كلّها');
}

// ═══ جـ) المسار الحقيقي بلا استبدال ═══════════════════════════════════════════════════════════════════════════════
for (const s of PRODUCER) {
  const fp = s.payload;
  const cs = computeCategoryStates({functionalResults: fp.functionalResults, manualResults: fp.manualResults, dev: fp.device || null, findings: null, batterySampleInputs: null, batteryDesignCapacityMah: null});
  const stored = cs.testResults.find((t) => t.testId === 'M-02');
  ok(stored !== undefined, `[جـ][${s.key}] M-02 في categoryStates.testResults`);
  ok('strokes' in stored.raw.measurements && stored.raw.measurements.strokes.length > 0, `[جـ][${s.key}] **المخزَّن** يحتفظ بالخامّ كاملاً (ما يُحسب ويُخزَّن لا يتغيّر — القرار 2026-10-06)`);
  const sanitized = sanitizeTestResultsForModelPayload(cs.testResults);
  const sent = sanitized.find((t) => t.testId === 'M-02');
  eq(NEW_KEYS.filter((k) => k in sent.raw.measurements), [], `[جـ][${s.key}] **نسخة النموذج** بلا أيّ مفتاح fv71`);
  eq(Object.keys(sent.raw.measurements), Object.keys(stored.raw.measurements).filter((k) => LEGACY.includes(k)), `[جـ][${s.key}] وبالمفاتيح الثمانية القديمة وحدها`);
  const text = JSON.stringify(sanitized);
  for (const probe of ['strokes', 'pathCap', 'surfaceWidthPx', 'touchMajorPx', 'untouchedCells', 'displayedSuspects']) ok(!text.includes(probe), `[جـ][${s.key}] «${probe}» ليست في testResults المُرسَلة للنموذج`);
  ok(JSON.stringify(cs.testResults).includes('strokes'), `[جـ][${s.key}] (ضابط سلبي) وهي في المخزَّن: الاختبار يرى الفرق فعلاً`);
}

// ═══ د) أزرار الصوت M-09/M-10: لا measurements تصل النموذج (S-VOL) ═══════════════════════════════════════════════════
{
  const VOL_KEYS = Object.keys(N.VOLUME_BUTTON_FIELD_SPEC);
  eq([...VOL_KEYS].sort(), [...N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-09']].sort(), '[د] المخفيّ عن النموذج لـM-09 = مفاتيح ف-04 الأربعة عشر (من مصدرها الواحد)');
  eq(N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-10'], N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-09'], '[د] وكذلك M-10');
  const sample = PRODUCER[1]; // 13ch: M-09 «يعمل» بيد الفنّي وM-10 «لا يعمل»
  for (const id of ['M-09', 'M-10']) {
    const m = sample.payload.manualResults.find((x) => x.testId === id);
    const tr = {testId: id, outcome: 'PASS', raw: clone(m)};
    const before = JSON.stringify(tr);
    const [out] = sanitizeTestResultsForModelPayload([tr]);
    eq(JSON.stringify(tr), before, `[د][${id}] لا تعديل في المكان`);
    eq(out.raw.measurements, {}, `[د][${id}] raw.measurements تبقى كائناً فارغاً (كل مفاتيحها مخفيّة)`);
    eq([out.raw.status, out.raw.testId], [m.status, id], `[د][${id}] وحالة الفنّي ومعرّف الاختبار بلا مساس`);
  }
  for (const s of PRODUCER) {
    const fp = s.payload;
    const cs = computeCategoryStates({functionalResults: fp.functionalResults, manualResults: fp.manualResults, dev: fp.device || null, findings: null, batterySampleInputs: null, batteryDesignCapacityMah: null});
    const stored = cs.testResults.find((t) => t.testId === 'M-09');
    ok(stored && stored.raw.measurements && Array.isArray(stored.raw.measurements.events), `[د][${s.key}] **المخزَّن** يحتفظ بخامّ M-09 (events) كاملاً`);
    const sent = sanitizeTestResultsForModelPayload(cs.testResults);
    const text = JSON.stringify(sent);
    for (const probe of ['expectedKeyCode', 'eventsTotal', 'detectionSource', 'volumeStreamMax', 'volumeLevelAtOpen', 'timeToFirstExpectedDownMs', 'expectedDownCount']) {
      ok(!text.includes(probe), `[د][${s.key}] «${probe}» ليست في testResults المُرسَلة للنموذج`);
      ok(JSON.stringify(cs.testResults).includes(probe) || !JSON.stringify(fp.manualResults).includes(probe), `[د][${s.key}] (ضابط سلبي) «${probe}» في المخزَّن إن كانت في الحمولة`);
    }
  }
}

console.log(`\nfv71ModelPayloadRaw.test.js: ${n}/${n} assertions passed`);
