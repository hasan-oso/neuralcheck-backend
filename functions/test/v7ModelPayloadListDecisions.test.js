'use strict';

// v7ModelPayloadListDecisions.test.js — أمر مستخدم 2026-10-07 +03 (قرار القوائم) على حمولة النموذج:
//   ١ إعدادات الجهاز: تبقى القيمة وتُحجب كلّ حقول الحكم (الخيار أ)؛ المحتوى والتشغيل وB-01..B-07: حجب كامل؛ SPEC تبقى؛
//     SEC-08 «غير مقيس» دائماً مهما وصل؛ ولا اختبار في مجموعتين.
//   ٣ تعديل أسطر التعليمات وسطر جديد بنصّ المستخدم حرفياً.
//   ٤ عمر الرقعة بالأشهر رقماً في بوّابة PATCH_AGE (نسختا البوّابة) على نسخة الحمولة وحدها، بالقيمة نفسها التي في نصّ source.
//   ٥ findings.meta بلا wallMs/sampleCount/expectedSamples، وnotMeasuredFields بلا value الافتراضية.
// كل فرع بكل قيمه الممكنة لا بواحدة (القاعدة 30)، وعلى بيانات حقيقية عبر المسار الكامل (القاعدة 37).
//
// Run: node functions/test/v7ModelPayloadListDecisions.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildV7Payload, _internal} = require('../src/analysis/buildV7Payload');
const {MODEL_STATE_TEXT, PATCH_AGE_MONTHS_FIELD, buildModelGateEntry} = require('../src/analysis/v7ModelPayloadWhitelist');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates, formatPatchAgeSource, parsePatchAgeMonths} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');
const {SYSTEM_PROMPT_V7} = require('../src/prompts/systemPromptV7');
const {
  USER_SETTING_IDS, USER_CONTENT_OR_RUNTIME_IDS, BATTERY_STATE_TEST_IDS, APP_CONSTANT_NOT_READ_IDS,
  THERMAL_UNCALIBRATED_IDS, UNCALIBRATED_THRESHOLD_IDS, UNSTABLE_IDS,
} = require('../src/analysis/testKinds');

const {
  MODEL_HIDDEN_TEST_IDS, hideTestResultForModel, hideJudgmentForModel, forceNotMeasuredForModel,
  sanitizeMetaForModel, sanitizeNotMeasuredFieldsForModel, stripNumericUnitParens, sanitizeFindingsForModelPayload,
} = _internal;
const M = MODEL_STATE_TEXT.measured;
const NM = MODEL_STATE_TEXT.notMeasured;

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
const SCANS = [
  ['b45c8cf6', 'b45c8cf6.ts.json', 'b45c8cf6-e376-4765-8703-f68e9bc69844'],
  ['34dff2b8', '34dff2b8.ts.json', '34dff2b8-ce9e-4b40-86a9-1976c878e195'],
  ['S10', '8909e850-s10.ts.json', '8909e850-b10c-466c-899a-ce97cb5c4fbe'],
];
const FR = loadJson('functionalResults-by-scanid.json').byScanId;

function build(scanTuple, opts) {
  const o = opts || {};
  const [, tsFile, scanId] = scanTuple;
  const raw = loadJson(tsFile);
  const functional = o.functional || FR[scanId];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
    analyzedAtMs: ('analyzedAtMs' in o) ? o.analyzedAtMs : GOLDEN_ANALYZED_AT_MS,
  });
  const before = JSON.stringify({findings, categoryStates});
  const built = buildV7Payload({findings, categoryStates, language: 'ar', scanId, isFreeTrial: false, previousScan: null});
  return {findings, categoryStates, body: built.body, userMessage: built.userMessage, unchangedByBuild: before === JSON.stringify({findings, categoryStates})};
}
const byId = (list, id) => list.find((t) => t.testId === id);

// ═══════════════════════════════════════════════════════════════════════
// ١ — الحجب الكامل: الحالة والقيمة وraw.notes والأرقام المضمَّنة في الوحدة
// ═══════════════════════════════════════════════════════════════════════
{
  const mk = (outcome, status, extra) => Object.assign({
    testId: 'B-02', kind: 'STATE', outcome, evidence: '4400', evidenceUnit: 'mAh',
    raw: {rawValue: '4400', rawValueUnit: 'mAh', status, testId: 'B-02', notes: 'source=powerprofile_reflection, known=4500 mAh, classify=full_capacity'},
  }, extra || {});
  for (const [outcome, status] of [['PASS', 'pass'], ['WARNING', 'warning'], ['FAIL', 'fail']]) {
    const o = hideTestResultForModel(mk(outcome, status));
    eq(o.outcome, M, `[١] ${outcome}: outcome «مقيس…»`);
    eq(o.raw.status, M, `[١] ${outcome}: raw.status «مقيس…»`);
    eq(o.raw.rawValue, M, `[١] ${outcome}: rawValue محجوب`);
    eq(o.evidence, M, `[١] ${outcome}: evidence محجوب`);
    eq(o.raw.notes, M, `[١] ${outcome}: raw.notes (تحمل «known=4500 mAh, classify=full_capacity») محجوبة حين توجد قيمة`);
    eq(o.evidenceUnit, 'mAh', `[١] ${outcome}: الوحدة بلا أرقام تبقى`);
  }
  const nm = hideTestResultForModel(mk('NOT_MEASURED', 'unavailable', {evidence: 'N/A', raw: {rawValue: 'N/A', rawValueUnit: 'mAh', status: 'unavailable', testId: 'B-02', notes: 'لا تتوفر قراءات'}}));
  eq(nm.outcome, NM, '[١] غير المنفَّذ: «غير مقيس»');
  eq(nm.raw.notes, 'لا تتوفر قراءات', '[١] غير المنفَّذ: نصّ سبب الغياب في notes يبقى (لا «مقيس» لما لم يُقَس)');
  eq(nm.raw.rawValue, 'N/A', '[١] غير المنفَّذ: rawValue يبقى N/A');
  eq(stripNumericUnitParens('% (71.5 GB)'), '%', '[١] وحدة S-02 «% (71.5 GB)» تُجرَّد من القوسين الرقميّين فتبقى «%»');
  eq(stripNumericUnitParens('mAh'), 'mAh', '[١] وحدة بلا أرقام بلا مساس');
  eq(stripNumericUnitParens('%/min'), '%/min', '[١] وحدة مركَّبة بلا قوسين بلا مساس');
  const s02 = hideTestResultForModel({testId: 'S-02', outcome: 'PASS', evidence: '31.3', evidenceUnit: '% (71.5 GB)', raw: {rawValue: '31.3', rawValueUnit: '% (71.5 GB)', status: 'pass', testId: 'S-02'}});
  ok(!/\d/.test(s02.raw.rawValueUnit) && !/\d/.test(s02.evidenceUnit), '[١] S-02: لا رقم في الوحدتين بعد الحجب (71.5 كان يتسرّب منها)');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — حجب الحكم وحده (إعدادات الجهاز): كلّ حقل يحمل حكماً يُحجَب، والقيمة تبقى
// ═══════════════════════════════════════════════════════════════════════
{
  const mk = (outcome, status, rawValue, extra) => Object.assign({
    testId: 'SEC-05', kind: 'STATE', category: 'security', healthBearing: false, entersGrade: false, entersFault: false, confidence: 'AUTOMATIC',
    outcome, evidence: rawValue, evidenceUnit: null, notMeasuredReason: null,
    raw: {rawValue, rawValueUnit: '', status, testId: 'SEC-05', componentName: 'Geliştirici Modu'},
  }, extra || {});
  for (const [outcome, status, value] of [['PASS', 'pass', 'معطّل'], ['WARNING', 'warning', 'مفعّل'], ['FAIL', 'fail', 'مفعّل']]) {
    const src = mk(outcome, status, value);
    const o = hideJudgmentForModel(src);
    eq(o.outcome, M, `[٢] ${outcome}: outcome (حكم) «مقيس…»`);
    eq(o.raw.status, M, `[٢] ${outcome}: raw.status (حكم) «مقيس…»`);
    eq(o.raw.rawValue, value, `[٢] ${outcome}: القيمة «${value}» تبقى`);
    eq(o.evidence, value, `[٢] ${outcome}: evidence (القيمة) تبقى`);
    // كلّ ما عدا حقلَي الحكم بلا مساس — لا حقل حكم ثالث مخفيّ
    const strip = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.outcome; delete c.raw.status; return c; };
    deepEq(strip(o), strip(src), `[٢] ${outcome}: لا فرق إلا في outcome وraw.status`);
  }
  const nm = hideJudgmentForModel(mk('NOT_MEASURED', 'unavailable', 'N/A', {notMeasuredReason: 'CAPABILITY_BLOCKED', permission: 'android.permission.X'}));
  eq(nm.outcome, NM, '[٢] غير المنفَّذ: «غير مقيس»');
  eq(nm.raw.status, NM, '[٢] غير المنفَّذ: raw.status «غير مقيس»');
  eq(nm.raw.rawValue, 'N/A', '[٢] غير المنفَّذ: القيمة N/A تبقى');
  eq(nm.notMeasuredReason, 'CAPABILITY_BLOCKED', '[٢] سبب الغياب تصنيف لا حكم — يبقى');
  eq(nm.permission, 'android.permission.X', '[٢] permission يبقى');
  eq(hideJudgmentForModel(null), null, '[٢] null بلا رمي');
  const noRaw = hideJudgmentForModel({testId: 'L-01', outcome: 'PASS'});
  ok(!('raw' in noRaw) && noRaw.outcome === M, '[٢] عنصر بلا raw: لا حقل يُختلَق');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — SEC-08 «غير مقيس» دائماً مهما وصل
// ═══════════════════════════════════════════════════════════════════════
{
  const variants = [
    ['pass', 'مفعّل', 'INFO_ONLY'], ['fail', 'معطّل', 'INFO_ONLY'], ['warning', 'مفعّل', 'WARNING'],
    ['not_tested', 'غير متوفرة', 'NOT_MEASURED'], ['unavailable', 'N/A', 'NOT_MEASURED'], ['pass', '', 'PASS'], ['pass', '1.0.9', 'INFO_ONLY'],
  ];
  for (const [status, value, outcome] of variants) {
    const src = {testId: 'SEC-08', kind: 'SPEC', outcome, evidence: value, notMeasuredReason: null,
      raw: {rawValue: value, rawValueUnit: '', status, testId: 'SEC-08', componentName: 'Play Protect', notes: 'مفعّل'}};
    const o = forceNotMeasuredForModel(src);
    for (const [label, v] of [['outcome', o.outcome], ['evidence', o.evidence], ['raw.status', o.raw.status], ['raw.rawValue', o.raw.rawValue], ['raw.notes', o.raw.notes]]) {
      eq(v, NM, `[٣] SEC-08 (${status}/«${value}»): ${label} = «غير مقيس» مهما وصل`);
    }
    eq(o.raw.componentName, 'Play Protect', `[٣] SEC-08 (${status}): اسم المكوّن بلا مساس`);
    eq(o.testId, 'SEC-08', `[٣] SEC-08 (${status}): المعرّف بلا مساس`);
  }
  const bare = forceNotMeasuredForModel({testId: 'SEC-08'});
  deepEq(bare, {testId: 'SEC-08', outcome: NM}, '[٣] عنصر بلا raw/evidence: لا حقل يُختلَق');
  eq(forceNotMeasuredForModel(null), null, '[٣] null بلا رمي');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — تكامل على ثلاثة فِخاخ حقيقية: لكل مجموعة نتيجتها، والمخزَّن لا يتغيّر
// ═══════════════════════════════════════════════════════════════════════
for (const sc of SCANS) {
  const label = sc[0];
  const r = build(sc);
  eq(r.unchangedByBuild, true, `[٤][${label}] findings وcategoryStates لم يتغيّرا بعد buildV7Payload — ما يُحسب ويُخزَّن لا يتغيّر`);
  const sent = r.body.testResults;
  const stored = r.categoryStates.testResults;
  // حجب كامل
  for (const id of [...USER_CONTENT_OR_RUNTIME_IDS, ...BATTERY_STATE_TEST_IDS]) {
    const t = byId(sent, id); const o = byId(stored, id);
    if (!t) continue;
    const expectedState = ['PASS', 'FAIL', 'WARNING'].includes(o.outcome) ? M : NM;
    eq(t.outcome, expectedState, `[٤][${label}] ${id}: outcome حالة وحدها`);
    if (expectedState === M) {
      eq(t.raw.rawValue, M, `[٤][${label}] ${id}: rawValue محجوب`);
      eq(t.evidence, M, `[٤][${label}] ${id}: evidence محجوب`);
      ok(!/\d/.test(String(t.raw.rawValueUnit || '')) && !/\d/.test(String(t.evidenceUnit || '')), `[٤][${label}] ${id}: لا رقم في الوحدة`);
      if ('notes' in t.raw) eq(t.raw.notes, M, `[٤][${label}] ${id}: raw.notes محجوبة`);
    }
  }
  // حجب الحكم وحده: لا فرق بين المُرسَل والمخزَّن إلا outcome وraw.status — وحقل unstable (قرار 2026-10-07: يُحذف من كل اختبار في نسخة النموذج؛ القاعدة 23: استُبدل
  // التوقّع «لا فرق إلا outcome وraw.status» بـ«إلا outcome وraw.status وunstable»).
  for (const id of USER_SETTING_IDS) {
    const t = byId(sent, id); const o = byId(stored, id);
    if (!t) continue;
    const strip = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.outcome; delete c.unstable; if (c.raw) delete c.raw.status; return c; };
    ok(!('unstable' in t), `[٤][${label}] ${id}: حقل unstable محذوف من نسخة النموذج`);
    deepEq(strip(t), strip(o), `[٤][${label}] ${id}: لا فرق عن المخزَّن إلا outcome وraw.status وunstable — القيمة والبقيّة تبقى`);
    const judged = ['PASS', 'FAIL', 'WARNING'].includes(o.outcome);
    eq(t.outcome, judged ? M : NM, `[٤][${label}] ${id}: outcome حالة وحدها`);
    eq(t.raw.status, judged ? M : NM, `[٤][${label}] ${id}: raw.status حالة وحدها`);
    ok(!/^(pass|fail|warning|PASS|FAIL|WARNING)$/.test(String(t.outcome) + String(t.raw.status)), `[٤][${label}] ${id}: لا pass/warning/fail`);
  }
  // SEC-08 غير مقيس دائماً
  const s08 = byId(sent, 'SEC-08');
  if (s08) {
    for (const [lab, v] of [['outcome', s08.outcome], ['evidence', s08.evidence], ['raw.status', s08.raw.status], ['raw.rawValue', s08.raw.rawValue]]) eq(v, NM, `[٤][${label}] SEC-08.${lab} = «غير مقيس»`);
    eq(byId(stored, 'SEC-08').raw.rawValue, 'مفعّل', `[٤][${label}] SEC-08 المخزَّن بلا مساس («مفعّل» كما وصل)`);
  }
  const withoutUnstable = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.unstable; return c; };
  // SPEC تبقى كما هي
  for (const id of ['T-04', 'CM-11', 'B-08']) {
    const t = byId(sent, id); const o = byId(stored, id);
    if (!t) continue;
    // قرار 2026-10-07 (القاعدة 23): «كما هو بلا أيّ مساس» صار «كما هو إلا حقل unstable» — يُحذف الحقل من كل اختبار في نسخة النموذج.
    deepEq(t, withoutUnstable(o), `[٤][${label}] ${id} (SPEC): كما هو بلا مساس إلا حذف حقل unstable`);
  }
  // هويّة الجهاز تبقى: C-05 (الشريحة) وD-01 (الدقّة)
  for (const id of ['C-05', 'D-01', 'SEC-09']) {
    const t = byId(sent, id); const o = byId(stored, id);
    if (t) deepEq(t, withoutUnstable(o), `[٤][${label}] ${id} (هويّة جهاز، داخل الحرف): كما هو بلا مساس إلا حذف حقل unstable`);
  }
  // قائمة الأعطال بلا تغيير (تُحسب في الخادم): issues المُرسَلة هي نفسها المخزَّنة بحقولها المسموحة
  deepEq(r.body.categoryStates.issues.map((i) => i.id), r.categoryStates.issues.map((i) => i.id), `[٤][${label}] قائمة الأعطال بمعرّفاتها كما حسبها الخادم`);
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — meta وnotMeasuredFields
// ═══════════════════════════════════════════════════════════════════════
{
  deepEq(sanitizeMetaForModel({fieldsVersion: 67, scanId: 'x', deviceModel: 'M', api: 30, sampleCount: 1604, expectedSamples: 1605, wallMs: 478397, future: 1}),
      {fieldsVersion: 67, scanId: 'x', deviceModel: 'M', api: 30},
      '[٥] meta: تبقى fieldsVersion/scanId/deviceModel/api فقط؛ wallMs/sampleCount/expectedSamples (وأيّ مفتاح غير مسمّى) تُحذف');
  eq(sanitizeMetaForModel(null), null, '[٥] meta=null بلا رمي');
  const list = [
    {field: 'deviceTierMeasured', scope: 'footer', reason: 'UNMEASURED_DEFAULT', value: 'flagship_cooling'},
    {field: 'intensityFactor', scope: 'footer', reason: 'UNMEASURED_DEFAULT', value: 1},
    {field: 'tempRiseRateInProbe', scope: 'footer', reason: 'NO_CPU_TEMP_SENSOR', value: 0},
    {field: 'maxCpuTemp', scope: 'footer', reason: 'NO_CPU_TEMP_SENSOR', value: -1},
    {field: 'cpuFmaErrors', scope: 'footer.verificationResults', reason: 'FIELD_ABSENT_A76', value: null},
  ];
  const out = sanitizeNotMeasuredFieldsForModel(list);
  deepEq(out.map((e) => Object.keys(e)), list.map(() => ['field', 'scope', 'reason']), '[٥] notMeasuredFields: field/scope/reason فقط — كل value (0 و1 و−1 والنصّ وnull) محذوفة');
  deepEq(out.map((e) => e.field), list.map((e) => e.field), '[٥] أسماء الحقول تبقى (يقرؤها reportShapeV7.js:436)');
  deepEq(sanitizeNotMeasuredFieldsForModel({status: 'NOT_MEASURED', reason: 'HARNESS_ERROR'}), {status: 'NOT_MEASURED', reason: 'HARNESS_ERROR'}, '[٥] شكل العطل (كائن لا مصفوفة) يمرّ كما هو');
  for (const sc of SCANS) {
    const r = build(sc);
    const stored = r.findings.notMeasuredFields;
    deepEq(r.body.findings.notMeasuredFields, stored.map((e) => ({field: e.field, scope: e.scope, reason: e.reason})), `[٥][${sc[0]}] الحمولة = المخزَّن بلا value`);
    ok(stored.some((e) => 'value' in e), `[٥][${sc[0]}][إعداد] المخزَّن يحمل value فعلاً — الحذف فعل البناء`);
    deepEq(Object.keys(r.body.findings.meta).sort(), ['api', 'deviceModel', 'fieldsVersion', 'scanId'], `[٥][${sc[0]}] مفاتيح meta المُرسَلة`);
  }
  // الحارس يقرأ أسماء الحقول من notMeasuredFields — بقاؤها يكفي لإعفاء tempRiseRateInProbe من تسرّب اللغة
  const r = build(SCANS[0]);
  ok(r.body.findings.notMeasuredFields.some((e) => e.field === 'tempRiseRateInProbe'), '[٥] tempRiseRateInProbe باسمها في الحمولة (التعليمات (3) تذكرها)');
}

// ═══════════════════════════════════════════════════════════════════════
// ٦ — عمر الرقعة بالأشهر رقماً في بوّابة PATCH_AGE (على الحمولة وحدها)
// ═══════════════════════════════════════════════════════════════════════
{
  eq(PATCH_AGE_MONTHS_FIELD, 'ageMonths', '[٦] اسم الحقل ageMonths (مصدر واحد مُصدَّر)');
  // الصيغة ومحلّلها زوج واحد
  eq(formatPatchAgeSource('2021-08-01', 61.84), 'SEC-03=2021-08-01 (61.8 شهراً)', '[٦] صيغة source كما كانت حرفاً (لا تغيير في المخزَّن)');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'FIRED', source: formatPatchAgeSource('2021-08-01', 61.84)}), 61.8, '[٦] FIRED: القيمة كما في النصّ (منزلة واحدة)');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'NOT_FIRED', source: formatPatchAgeSource('2025-01-01', 8)}), 8, '[٦] NOT_FIRED: 8.0 ← 8');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'FIRED', source: formatPatchAgeSource('2021-08-01', 62)}), 62, '[٦] 62.0 ← 62');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'UNKNOWN', source: 'SEC-03=2021-08-01 لكن analyzedAt غير معروف — لا وقت خادم متاح لحساب عمر الرقعة'}), null, '[٦] UNKNOWN: لا رقم');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'INPUT_ABSENT', source: 'SEC-03 absent/unparseable'}), null, '[٦] INPUT_ABSENT: لا رقم');
  eq(parsePatchAgeMonths({name: 'PATCH_AGE', status: 'FIRED', source: 'نصّ بلا عمر'}), null, '[٦] FIRED بنصّ لا يحمل عمراً: لا رقم (لا افتراض)');
  eq(parsePatchAgeMonths({name: 'ROOT_DETECTED', status: 'FIRED', source: 'SEC-04=fail (12.0 شهراً)'}), null, '[٦] بوّابة أخرى: لا رقم');
  eq(parsePatchAgeMonths(null), null, '[٦] null بلا رمي');

  const gateOf = (list) => list.filter((g) => g.name === 'PATCH_AGE');
  // الساعة الذهبية: FIRED
  const g = build(SCANS[0]);
  const storedGates = [...gateOf(g.categoryStates.overall.gatesApplied), ...gateOf(g.categoryStates.categories.security.gatesApplied)];
  eq(storedGates.length, 2, '[٦] نسختا البوّابة في المخزَّن');
  ok(storedGates.every((x) => !(PATCH_AGE_MONTHS_FIELD in x)), '[٦] المخزَّن لا يحمل ageMonths — categoryStates بلا مساس');
  eq(storedGates[0].source, 'SEC-03=2021-08-01 (61.8 شهراً)', '[٦] نصّ source المخزَّن كما كان (عند الساعة الذهبية)');
  const sentGates = [...gateOf(g.body.categoryStates.overall.gatesApplied), ...gateOf(g.body.categoryStates.categories.security.gatesApplied)];
  eq(sentGates.length, 2, '[٦] نسختا البوّابة في الحمولة');
  for (const x of sentGates) {
    eq(x.ageMonths, 61.8, '[٦] ageMonths في كلتا النسختين = القيمة نفسها التي في النصّ');
    eq(x.status, 'FIRED', '[٦] حالة البوّابة كما هي');
    eq(x.source, 'SEC-03=2021-08-01 (61.8 شهراً)', '[٦] source المُرسَل كما هو');
  }
  for (const gate of [...g.body.categoryStates.overall.gatesApplied, ...g.body.categoryStates.categories.security.gatesApplied]) {
    if (gate.name !== 'PATCH_AGE') ok(!(PATCH_AGE_MONTHS_FIELD in gate), `[٦] ${gate.name}: لا ageMonths لغير PATCH_AGE`);
  }
  // UNKNOWN (لا ساعة)
  const unk = build(SCANS[0], {analyzedAtMs: undefined});
  for (const x of [...gateOf(unk.body.categoryStates.overall.gatesApplied), ...gateOf(unk.body.categoryStates.categories.security.gatesApplied)]) {
    eq(x.status, 'UNKNOWN', '[٦] بلا ساعة: UNKNOWN'); ok(!(PATCH_AGE_MONTHS_FIELD in x), '[٦] UNKNOWN: لا ageMonths في أيّ نسخة (لا رقم حيث لا رقم)');
  }
  // INPUT_ABSENT (SEC-03 غير قابل للتحليل)
  const fr = FR[SCANS[0][2]].map((t) => (t.testId === 'SEC-03' ? Object.assign({}, t, {rawValue: 'N/A', status: 'unavailable'}) : t));
  const abs = build(SCANS[0], {functional: fr});
  for (const x of [...gateOf(abs.body.categoryStates.overall.gatesApplied), ...gateOf(abs.body.categoryStates.categories.security.gatesApplied)]) {
    eq(x.status, 'INPUT_ABSENT', '[٦] SEC-03 غير قابل للتحليل: INPUT_ABSENT'); ok(!(PATCH_AGE_MONTHS_FIELD in x), '[٦] INPUT_ABSENT: لا ageMonths في أيّ نسخة');
  }
  // NOT_FIRED (عمر ≤ 36 شهراً): الحقل يوجد أيضاً
  const young = build(SCANS[0], {analyzedAtMs: Date.parse('2024-02-01T00:00:00.000Z')});
  const ys = gateOf(young.body.categoryStates.overall.gatesApplied)[0];
  eq(ys.status, 'NOT_FIRED', '[٦] عمر أقلّ من 36 شهراً: NOT_FIRED');
  ok(typeof ys.ageMonths === 'number' && ys.ageMonths < 36, `[٦] NOT_FIRED: ageMonths رقم (${ys.ageMonths})`);
  eq(young.unchangedByBuild, true, '[٦] المخزَّن لم يتغيّر');
  // buildModelGateEntry مباشرة
  ok(!(PATCH_AGE_MONTHS_FIELD in buildModelGateEntry({name: 'PATCH_AGE', status: 'FIRED', source: 'x'})), '[٦] FIRED بمصدر بلا عمر: لا حقل');
  eq(buildModelGateEntry(null), null, '[٦] buildModelGateEntry(null) بلا رمي');

  // الحارس: ذكر العمر كما ورد يُقبَل، وعمر مختلف يُرفَض خارج details
  const AGE_MS = Date.parse('2021-08-01T00:00:00.000Z') + 62 * 30.4368 * 24 * 60 * 60 * 1000; // 62.0 شهراً بالضبط
  const at62 = build(SCANS[0], {analyzedAtMs: AGE_MS});
  eq(gateOf(at62.body.categoryStates.overall.gatesApplied)[0].ageMonths, 62, '[٦][إعداد] ساعة تعطي «62.0 شهراً»');
  eq(gateOf(at62.body.categoryStates.overall.gatesApplied)[0].source, 'SEC-03=2021-08-01 (62.0 شهراً)', '[٦][إعداد] النصّ «62.0 شهراً»');
  const ctxOf = (b) => ({findings: b.findings, categoryStates: Object.assign({}, b.categoryStates, {testResults: b.testResults})});
  const resp = (summary, details) => ({
    narrative: {summary, details, verdict: 'خلاصة بلا أرقام.', buyerAdvice: {casual: 'نصّ.', gamer: 'نصّ.', photographer: 'نصّ.'}, issueDescriptions: {}},
    crossChecks: [], adjustments: [], modelObservations: [],
  });
  const ctx62 = ctxOf(at62.body);
  const accepted = guardV7Response(resp('الرقعة الأمنية عمرها 62.0 شهراً.', 'تفاصيل بلا أرقام.'), ctx62);
  eq(accepted.numbers.ok, true, '[٦] «62.0 شهراً» كما وردت: يقبلها الحارس');
  eq(accepted.ok, true, '[٦] الردّ مقبول');
  const wrong = guardV7Response(resp('الرقعة الأمنية عمرها 50.0 شهراً.', 'تفاصيل بلا أرقام.'), ctx62);
  eq(wrong.numbers.ok, false, '[٦] عمر مختلف (50.0) في summary: يرفضه الحارس');
  deepEq(wrong.numbers.unmatchedFields, [{field: 'narrative.summary', numbers: [50]}], '[٦] المرفوض 50 في narrative.summary');
  eq(wrong.ok, false, '[٦] الردّ مرفوض خارج details');
  const wrongDetails = guardV7Response(resp('ملخّص بلا أرقام.', 'الرقعة عمرها 50.0 شهراً.'), ctx62);
  eq(wrongDetails.ok, true, '[٦] العمر المختلف داخل details وحدها معفًى ومُسجَّل (البند ٤ القائم)');
  ok(wrongDetails.detailsWaived && wrongDetails.detailsWaived.numbers.includes(50), '[٦] 50 مُسجَّل في detailsWaived');
  // شاهد سلبي: بلا الحقل يُرفَض الرقم نفسه — الحقل هو ما يسنده
  const stripped = ctxOf(at62.body);
  const strippedGates = (arr) => arr.map((x) => { const c = Object.assign({}, x); delete c[PATCH_AGE_MONTHS_FIELD]; return c; });
  stripped.categoryStates = Object.assign({}, stripped.categoryStates, {
    overall: Object.assign({}, stripped.categoryStates.overall, {gatesApplied: strippedGates(stripped.categoryStates.overall.gatesApplied)}),
    categories: Object.fromEntries(Object.entries(stripped.categoryStates.categories).map(([k, v]) => [k, Object.assign({}, v, {gatesApplied: strippedGates(v.gatesApplied || [])})])),
  });
  const without = guardV7Response(resp('الرقعة الأمنية عمرها 62.0 شهراً.', 'تفاصيل بلا أرقام.'), stripped);
  eq(without.numbers.ok, false, '[٦][شاهد سلبي] بلا حقل ageMonths يُرفَض «62.0» — الحقل هو سندها');
}

// ═══════════════════════════════════════════════════════════════════════
// ٧ — التعليمات: النصوص المعتمَدة حرفاً (أمر 2026-10-07، البند ٣) والثابت موحَّد
// ═══════════════════════════════════════════════════════════════════════
{
  const norm = (x) => x.replace(/\s+/g, ' ').trim();
  const P = norm(SYSTEM_PROMPT_V7);
  const C = M;
  const approved = [
    '1. **findings** — حالة كل قياس حتمي: «' + C + '» أو «غير مقيس» (الأداء المستدام والتعافي، الرسوميات، البطارية، التخزين، الحرارة) دون قيمته، مع سبب «غير مقيس» حين يُعلَن، وقائمة الحقول التي تُقرأ "غير مقيس" بحسب إصدار حقول التطبيق (fieldsVersion). لا إحصاء قناة ولا قيمة مرحلة تصلك.',
    'مثال: جهاز بمعدّل تحديث شاشة منخفض يهمّ',
    '(3) لا تدّعِ أي قيمة صفرية (استخدام، تردّد، نسبة): لا قيمة قياس خام تصلك في findings للتحقّق منها — الصفر الاصطلاحي (مثل tempRiseRateInProbe لجهاز بلا حسّاس حرارة معالج) مُعلَّم في notMeasuredFields[]؛ اقرأه "غير مقيس" لا "صفر فعلي".',
    '(5) لا تصلك قيم القنوات الخام (استخدام المعالج وتردّده وغيرهما) — فلا تذكر قيمة قناة ولا تقارن بين قناتين.',
    '**(د)** قياس الرسوميات لا يصلك بقيمته — يصلك «' + C + '» أو «غير مقيس» وحده — فلا تذكر عنه رقماً، ولا تسمِّه "معدّل إطارات" (fps مقياس ألعاب مألوف بمعنى مختلف عمّا تقيسه قناة الرسوميات).',
    '"gamer": "<نصيحة لمن يريد الجهاز للألعاب — يهمّه ما قِيس من الأداء المستدام والحرارة والرسوميات، وأنه قيس ولم يُحكم عليه>"',
    '(7) انقل الأرقام كما وردت في البيانات، بلا حساب ولا تقريب مختلف.',
    // أمر 2026-10-07 (إضافة «سقف»): السطر حرفياً بعد وسم «(ز)» في قسم «ما لا يصل المشتري إطلاقاً»
    '**(ز)** لا تستعمل كلمة "سقف" في نصّ يراه المشتري، وقل "أعلى حرف".',
    'البطارية في هذا الإصدار تُقاس ولا يُعطى لها حرف. فلا تذكر عنها أرقاماً ولا حكماً، واكتفِ بأنها قيست ولم يُحكم عليها.',
  ];
  for (const a of approved) eq(P.split(norm(a)).length - 1, 1, `[٧] النصّ المعتمَد مرّة واحدة: «${a.slice(0, 40)}…»`);
  for (const gone of ['إحصاءات حتمية لكل قناة/مرحلة', 'جهاز بحرارة تُخفّض الأداء', 'تصلك بالاسم في findings.channels', 'findings.channels.gpu_fps', 'الأداء المستدام والحرارة والرسوميات يهمّه أكثر']) {
    eq(P.includes(norm(gone)), false, `[٧] النصّ القديم غائب: «${gone}»`);
  }
  eq(P.split('«مقيس').length - 1, P.split('«' + C + '»').length - 1, '[٧] كل ذكر لـ«مقيس…» في التعليمات هو الثابت المعتمَد كاملاً — لا «مقيس» وحدها');
  const lines = SYSTEM_PROMPT_V7.split('\n');
  const idx = lines.findIndex((l) => l.startsWith('(7) '));
  ok(idx > lines.findIndex((l) => l.startsWith('(6) ')), '[٧] السطر الجديد (7) بعد البند (6) في قسم منع الهلوسة');
  eq(lines[idx].slice(4), 'انقل الأرقام كما وردت في البيانات، بلا حساب ولا تقريب مختلف.', '[٧] نصّ السطر الجديد حرفاً بلا الوسم «(7) »');
}

// ═══════════════════════════════════════════════════════════════════════
// ٨ — لا اختبار في مجموعتين (القائمة المُسمّاة تغلب الصنف العامّ)
// ═══════════════════════════════════════════════════════════════════════
{
  const groups = {
    uncalibrated: [...THERMAL_UNCALIBRATED_IDS, ...UNCALIBRATED_THRESHOLD_IDS], unstable: UNSTABLE_IDS, content: USER_CONTENT_OR_RUNTIME_IDS,
    battery: BATTERY_STATE_TEST_IDS, settings: USER_SETTING_IDS, constant: APP_CONSTANT_NOT_READ_IDS,
  };
  const seen = new Map();
  for (const [g, ids] of Object.entries(groups)) for (const id of ids) { ok(!seen.has(id), `[٨] ${id} في مجموعة واحدة (${g}) — وجدته أيضاً في ${seen.get(id)}`); seen.set(id, g); }
  eq(MODEL_HIDDEN_TEST_IDS.length, 18, '[٨] الحجب الكامل 18 معرّفاً: غير معايَر 4 + UNSTABLE 4 + محتوى/تشغيل 3 + B-01..B-07');
  eq(sanitizeFindingsForModelPayload(null), null, '[٨] sanitize بلا رمي');
}

console.log(`\nv7ModelPayloadListDecisions.test.js: ${n}/${n} assertions passed`);
