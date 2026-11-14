'use strict';

// v7PayloadRedactionAndRounding.test.js — أمر مستخدم 2026-10-01 +03
// ("الحمولة لا تحمل قيم ما ليس معايَراً")، بنود ٢-٤: إخفاء مؤشّرات البطارية
// غير المعايَرة وfindings.sustainedCeiling/graphics/battery وrawValue
// لاختبارات THERMAL_UNCALIBRATED_IDS/UNCALIBRATED_THRESHOLD_IDS عن حمولة
// النموذج (البند ٢)، تقريب الأرقام العشرية إلى منزلتين (البند ٣)، وإعفاء
// narrative.details من رفض الحارس (البند ٤). اختبار وحدة مباشر على الدوالّ
// الثلاث الجديدة + تكامل على فِخّ حقيقي (b45c8cf6) + حارس guardV7Response.
//
// أمر مستخدم 2026-10-06 +03 (المبدأ: «لا تصل إلى النموذج قيمة لا يُبنى عليها حرف ولا عتبة معايَرة لها. يصله
// عنها «مقيس» أو «غير مقيس» وحده. وما يُحسب ويُخزَّن لا يتغيّر»): findings.channels محذوفة من الحمولة،
// findings بجدول سياسة مُسمّى (MODEL_FINDINGS_POLICY) باختبار ثنائي الاتّجاه على أربعة فِخاخ حقيقية، وUNSTABLE_IDS
// تدخل القائمة المحجوبة، وحالة الاختبار المحجوب «مقيس»/«غير مقيس» وحدها (القاعدة 23: استُبدلت التوقّعات
// التي كانت تثبّت channels بلا مساس والمجموعة الأربعة وحدها).
//
// Run: node functions/test/v7PayloadRedactionAndRounding.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildV7Payload, _internal} = require('../src/analysis/buildV7Payload');
const {
  sanitizeFindingsForModelPayload, roundPayloadNumbersDeep, MODEL_HIDDEN_TEST_IDS, UNCALIBRATED_TEST_IDS,
  MODEL_FINDINGS_POLICY, unclassifiedFindingsKeys, hideTestResultForModel, hideTaggedMeasurementsForModel,
  MODEL_JUDGMENT_HIDDEN_TEST_IDS, MODEL_ALWAYS_NOT_MEASURED_TEST_IDS, hideJudgmentForModel, forceNotMeasuredForModel,
  sanitizeMetaForModel, sanitizeNotMeasuredFieldsForModel, stripNumericUnitParens,
} = _internal;
const {
  UNCALIBRATED_MEASUREMENT_NOTE, MODEL_STATE_TEXT, UNCALIBRATED_BATTERY_INDICATOR_IDS,
  redactUncalibratedBatteryIndicatorsForModelPayload,
} = require('../src/analysis/v7ModelPayloadWhitelist');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {
  THERMAL_UNCALIBRATED_IDS, UNCALIBRATED_THRESHOLD_IDS, UNSTABLE_IDS, USER_SETTING_IDS, USER_CONTENT_OR_RUNTIME_IDS,
  BATTERY_STATE_TEST_IDS, APP_CONSTANT_NOT_READ_IDS,
} = require('../src/analysis/testKinds');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// ═══════════════════════════════════════════════════════════════════════
// ١ — redactUncalibratedBatteryIndicatorsForModelPayload — وحدة مباشرة
// ═══════════════════════════════════════════════════════════════════════
{
  deepEq(UNCALIBRATED_BATTERY_INDICATOR_IDS.slice().sort(),
      ['BAT-COULOMB', 'BAT-FCC', 'BAT-R-APPARENT', 'BAT-THERMAL-EFF'].sort(),
      '[١] UNCALIBRATED_BATTERY_INDICATOR_IDS = المؤشّرات الأربعة بعينها (نصّ الأمر)');

  const fakeIndicators = {
    'BAT-FCC': {id: 'BAT-FCC', status: 'MEASURED', verdict: 'THRESHOLD_NOT_CALIBRATED', value: 3778.29, unit: 'mAh', designCapacityMah: 4400, ratioToDesign: 0.8587},
    'BAT-R-APPARENT': {id: 'BAT-R-APPARENT', status: 'MEASURED', value: 132.79, unit: 'mΩ'},
    'BAT-COULOMB': {id: 'BAT-COULOMB', status: 'ABSTAINED', value: null},
    'BAT-THERMAL-EFF': {id: 'BAT-THERMAL-EFF', status: 'MEASURED', value: 1.57, unit: '°C/Wh'},
  };
  const out = redactUncalibratedBatteryIndicatorsForModelPayload(fakeIndicators);
  for (const id of UNCALIBRATED_BATTERY_INDICATOR_IDS) {
    const measured = fakeIndicators[id].status === 'MEASURED';
    // أمر 2026-10-06 (D3) — استُبدل هذا التوقّع (كان note دائماً لكل مؤشّر، القاعدة 23):
    // الحجب حين توجد قيمة وحده؛ مؤشّر ABSTAINED يبقى {id,status} بلا «مقيس».
    deepEq(Object.keys(out[id]).sort(), (measured ? ['id', 'note', 'status'] : ['id', 'status']).sort(),
        `[١] ${id} المُحجوب: مفاتيحه ${measured ? 'id/status/note' : 'id/status فقط (ABSTAINED — لا note)'} — لا value/unit/designCapacityMah/ratioToDesign`);
    eq(out[id].id, id, `[١] ${id}.id محفوظ`);
    eq(out[id].status, fakeIndicators[id].status, `[١] ${id}.status محفوظ (حالة لا قيمة)`);
    if (measured) eq(out[id].note, UNCALIBRATED_MEASUREMENT_NOTE, `[١] ${id}.note = النصّ الحرفي الموحَّد (مُقاس)`);
    else ok(!('note' in out[id]), `[١][D3] ${id} (ABSTAINED) بلا note — لا «مقيس» لما لم يُقَس (القاعدة 22)`);
  }

  // مؤشّر غير مُدرَج في القائمة — يمرّ بلا تغيير (لا حجب عشوائي).
  const withExtra = redactUncalibratedBatteryIndicatorsForModelPayload(
      Object.assign({}, fakeIndicators, {'BAT-SOMETHING-ELSE': {id: 'BAT-SOMETHING-ELSE', status: 'MEASURED', value: 42}}));
  deepEq(withExtra['BAT-SOMETHING-ELSE'], {id: 'BAT-SOMETHING-ELSE', status: 'MEASURED', value: 42},
      '[١] مؤشّر غير مُدرَج في UNCALIBRATED_BATTERY_INDICATOR_IDS يمرّ بلا تغيير — لا حجب زائد عن المُسمّى');

  // مدخلات غائبة/غير كائن — لا رمي (القاعدة 22: الغياب يبقى غائباً).
  eq(redactUncalibratedBatteryIndicatorsForModelPayload(null), null, '[١] مدخل null يمرّ كما هو بلا رمي');
  eq(redactUncalibratedBatteryIndicatorsForModelPayload(undefined), undefined, '[١] مدخل undefined يمرّ كما هو بلا رمي');
}
console.log('تحقّق ١: redactUncalibratedBatteryIndicatorsForModelPayload — الأربعة المُسمّاة إلى {id,status,note} فقط، البقيّة بلا مساس');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — sanitizeFindingsForModelPayload — وحدة مباشرة
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeFindings = {
    sustainedCeiling: {status: 'MEASURED', notMeasuredReason: null, peakFreqKhz: 2730000, phase3: {windows: 15, meanWindowMaxRatio: 0.848}},
    graphics: {status: 'MEASURED', notMeasuredReason: null, phase4: {n: 274, median: 1920.3}, vsyncLockSampleCount: 530},
    battery: {qIntMah: 139.91, designCapacityMah: 4400, info: {rho: 1.57}},
    channels: {battery_level_pct: {INIT: {mean: 45}}}, // أمر 2026-10-06: تُحذف من الحمولة كلّها (تبقى في المصدر)
    perChannelUpdateCount: {battery_level_pct: 11},
    meta: {fieldsVersion: 67, scanId: 'x', sampleCount: 1604},
    status: 'MEASURED', notMeasuredReason: null,
    mysteryFutureKey: {value: 123456}, // مفتاح علوي غير مُصنَّف — رفض افتراضي
  };
  const fakeFindingsBefore = JSON.stringify(fakeFindings);
  const out = sanitizeFindingsForModelPayload(fakeFindings);

  deepEq(Object.keys(out.sustainedCeiling).sort(), ['notMeasuredReason', 'note', 'status'].sort(),
      '[٢] sustainedCeiling المُحجوب: status/notMeasuredReason/note فقط — لا peakFreqKhz ولا phase3 الخام');
  eq(out.sustainedCeiling.status, 'MEASURED', '[٢] sustainedCeiling.status محفوظ');
  eq(out.sustainedCeiling.note, UNCALIBRATED_MEASUREMENT_NOTE, '[٢] sustainedCeiling.note = النصّ الموحَّد');

  deepEq(Object.keys(out.graphics).sort(), ['notMeasuredReason', 'note', 'status'].sort(),
      '[٢] graphics المُحجوب: status/notMeasuredReason/note فقط — لا phase4 ولا vsyncLockSampleCount الخام');

  // أمر 2026-10-06 (D3) — استُبدل توقّع {note} وحده (القاعدة 23): findings.battery بلا status علوي،
  // «توجد قيمة» = qIntMah رقم فعلي → {status:'MEASURED', note}؛ وإلا {status:'NOT_MEASURED'} بلا note.
  deepEq(out.battery, {status: 'MEASURED', note: UNCALIBRATED_MEASUREMENT_NOTE},
      '[٢][D3] findings.battery (qIntMah رقم) → {status:MEASURED, note} — لا qIntMah/designCapacityMah/info.rho');
  deepEq(sanitizeFindingsForModelPayload({battery: {qIntMah: null, designCapacityMah: 4400}}).battery, {status: 'NOT_MEASURED'},
      '[٢][D3] findings.battery بلا qIntMah رقمي → {status:NOT_MEASURED} بلا note — لا «مقيس» لما لم يُقَس');

  // أمر 2026-10-06 — استُبدل توقّع «channels بلا مساس» (القاعدة 23): تُحذف channels وperChannelUpdateCount كلّها من الحمولة.
  ok(!('channels' in out), '[٢][أمر 2026-10-06] findings.channels محذوفة من حمولة النموذج');
  ok(!('perChannelUpdateCount' in out), '[٢][أمر 2026-10-06] findings.perChannelUpdateCount محذوفة من الحمولة');
  ok(!('mysteryFutureKey' in out), '[٢][القاعدة 25] مفتاح علوي غير مُصنَّف لا يصل النموذج (رفض افتراضي)');
  deepEq(unclassifiedFindingsKeys(fakeFindings), ['mysteryFutureKey'], '[٢] unclassifiedFindingsKeys يسمّي المفتاح غير المُصنَّف');
  // أمر 2026-10-07 (البند ٥) — استُبدل توقّع «meta بلا مساس» (القاعدة 23): تبقى fieldsVersion وscanId (وdeviceModel وapi إن وُجدتا)،
  // وتُحذف wallMs وsampleCount وexpectedSamples.
  deepEq(out.meta, {fieldsVersion: 67, scanId: 'x'}, '[٢][٥] findings.meta: fieldsVersion/scanId تبقى، sampleCount محذوفة');
  eq(out.status, 'MEASURED', '[٢] findings.status (KEEP) بلا مساس');
  eq(JSON.stringify(fakeFindings), fakeFindingsBefore, '[٢] الأصل المُمرَّر لم يتغيّر في مكانه — ما يُحسب ويُخزَّن لا يتغيّر');

  // notMeasuredReason حقيقي — يبقى ظاهراً (الحالة لا تُخفى، القيمة وحدها).
  const notMeasured = sanitizeFindingsForModelPayload({
    sustainedCeiling: {status: 'NOT_MEASURED', notMeasuredReason: 'NO_STRESS_PHASES'},
  });
  eq(notMeasured.sustainedCeiling.notMeasuredReason, 'NO_STRESS_PHASES', '[٢] notMeasuredReason حقيقي يبقى ظاهراً — الحالة معلومة، لا تُحجَب');

  // D3 — sustainedCeiling/graphics غير مقيسة: بلا note (الحالة وسببها فقط).
  const notMeasuredBoth = sanitizeFindingsForModelPayload({
    sustainedCeiling: {status: 'NOT_MEASURED', notMeasuredReason: 'NO_STRESS_PHASES', peakFreqKhz: null},
    graphics: {status: 'NOT_MEASURED', notMeasuredReason: 'NO_GPU_PHASE'},
  });
  deepEq(Object.keys(notMeasuredBoth.sustainedCeiling).sort(), ['notMeasuredReason', 'status'],
      '[٢][D3] sustainedCeiling NOT_MEASURED: status/notMeasuredReason فقط — بلا note');
  deepEq(Object.keys(notMeasuredBoth.graphics).sort(), ['notMeasuredReason', 'status'],
      '[٢][D3] graphics NOT_MEASURED: status/notMeasuredReason فقط — بلا note');

  // D2 — findings.advisoryMeasurements.S-06.rawValue: يُحجَب حين توجد قيمة، ويبقى كما هو حين لا توجد.
  const advisory = (entry) => sanitizeFindingsForModelPayload({advisoryMeasurements: {'S-06': entry}}).advisoryMeasurements['S-06'];
  eq(advisory({found: true, rawValue: '3265', rawValueUnit: 'IOPS', testStatus: 'pass'}).rawValue, UNCALIBRATED_MEASUREMENT_NOTE,
      '[٢][D2] S-06 (found، pass) rawValue محجوب');
  eq(advisory({found: true, rawValue: 'N/A', rawValueUnit: 'IOPS', testStatus: 'unavailable'}).rawValue, 'N/A',
      '[٢][D2/D3] S-06 unavailable يبقى rawValue="N/A" — لا «مقيس»');
  deepEq(advisory({found: false, status: 'NOT_MEASURED', reason: 'ABSENT_FROM_FUNCTIONAL_RESULTS'}),
      {found: false, status: 'NOT_MEASURED', reason: 'ABSENT_FROM_FUNCTIONAL_RESULTS'}, '[٢][D2/D3] S-06 غائبة (found=false) بلا مساس');

  // مدخلات غائبة — لا رمي.
  eq(sanitizeFindingsForModelPayload(null), null, '[٢] findings=null يمرّ كما هو بلا رمي');
  deepEq(sanitizeFindingsForModelPayload({}), {}, '[٢] findings={} (بلا sustainedCeiling/graphics/battery) يمرّ بلا تغيير — لا افتراض وجودها');
}
console.log('تحقّق ٢: sanitizeFindingsForModelPayload — sustainedCeiling/graphics/battery محجوبة، channels وperChannelUpdateCount محذوفتان، المفتاح غير المُصنَّف مرفوض');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — roundPayloadNumbersDeep — وحدة مباشرة (أمثلة الأرقام القبيحة من نصّ
// الأمر حرفياً)
// ═══════════════════════════════════════════════════════════════════════
{
  eq(roundPayloadNumbersDeep(1093.8595500000001), 1093.86, '[٣] 1093.8595500000001 → 1093.86 (منزلتان بالضبط)');
  eq(roundPayloadNumbersDeep(0.7142857142857143), 0.71, '[٣] 0.7142857142857143 → 0.71');
  eq(roundPayloadNumbersDeep(1968633), 1968633, '[٣] عدد صحيح 1968633 kHz بلا تغيير — القيد: "لا يغيّر الأعداد الصحيحة"');
  eq(roundPayloadNumbersDeep(0), 0, '[٣] صفر يبقى صفراً (عدد صحيح)');
  eq(roundPayloadNumbersDeep(-0.567), -0.57, '[٣] سالب يُقرَّب بنفس القاعدة (Math.round على القيمة×100)');
  eq(roundPayloadNumbersDeep('نصّ 1093.8595500000001 بلا تغيير'), 'نصّ 1093.8595500000001 بلا تغيير',
      '[٣] نصّ يحتوي رقماً حرفياً لا يُمَسّ — التقريب على قيم number فقط، لا regex على نصوص');
  eq(roundPayloadNumbersDeep(null), null, '[٣] null يمرّ كما هو');
  eq(roundPayloadNumbersDeep(true), true, '[٣] boolean يمرّ كما هو');

  deepEq(roundPayloadNumbersDeep([1093.8595500000001, 1968633, 'x']), [1093.86, 1968633, 'x'],
      '[٣] مصفوفة — كل عنصر رقمي يُقرَّب، البقيّة بلا مساس');
  deepEq(roundPayloadNumbersDeep({a: 0.7142857142857143, b: {c: 1093.8595500000001, d: 1968633}}),
      {a: 0.71, b: {c: 1093.86, d: 1968633}},
      '[٣] كائن متداخل — يُقرِّب بالعمق كله (deep)، لا المستوى الأول وحده');
}
console.log('تحقّق ٣: roundPayloadNumbersDeep — تقريب منزلتين للعشري، صفر تغيير على الصحيح، بالعمق الكامل');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — guardV7Response: خرق details وحده لا يرفض (البند ٤)، خرق خارجه يرفض
// ═══════════════════════════════════════════════════════════════════════
{
  const s10Raw = loadJson('b45c8cf6.ts.json');
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const findings = computeFindings({device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(s10Raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: 'redaction-test', isFreeTrial: false, previousScan: null});
  const categoryStatesForGuard = Object.assign({}, body.categoryStates, {testResults: body.testResults});

  function baseValidResponse() {
    return {
      narrative: {
        summary: 'ملخّص بلا أرقام مُختلَقة.',
        details: 'نصّ تفاصيل بلا أرقام مُختلَقة.',
        verdict: 'خلاصة بلا أرقام مُختلَقة.',
        buyerAdvice: {casual: 'نصّ.', gamer: 'نصّ.', photographer: 'نصّ.'},
        issueDescriptions: {},
      },
      crossChecks: [], adjustments: [], modelObservations: [],
    };
  }

  // ٤-أ — رقم مُختلَق في details وحده → ok=true، detailsWaived يحمل الرقم.
  const detailsOnlyBad = baseValidResponse();
  detailsOnlyBad.narrative.details = 'رقم مُختلَق 999999 هنا فقط.';
  const guardDetailsOnly = guardV7Response(detailsOnlyBad, {findings: body.findings, categoryStates: categoryStatesForGuard});
  eq(guardDetailsOnly.shape.ok, true, '[٤-أ] shape.ok=true — شكل سليم');
  eq(guardDetailsOnly.numbers.ok, false, '[٤-أ] numbers.ok=false داخلياً — الرقم غير مطابق فعلاً');
  eq(guardDetailsOnly.ok, true, '[٤-أ][البند ٤، مطلوب صراحةً] guard.ok=true رغم خرق numbers — محصور في details وحده');
  ok(guardDetailsOnly.detailsWaived && Array.isArray(guardDetailsOnly.detailsWaived.numbers) &&
      guardDetailsOnly.detailsWaived.numbers.includes(999999),
      '[٤-أ] detailsWaived.numbers يحمل 999999 — مُسجَّل لا مُسقَط');

  // ٤-ب — نفس الرقم المُختلَق لكن في summary (غير مُعفًى) → ok=false.
  const summaryBad = baseValidResponse();
  summaryBad.narrative.summary = 'رقم مُختلَق 999999 في الملخّص.';
  const guardSummaryBad = guardV7Response(summaryBad, {findings: body.findings, categoryStates: categoryStatesForGuard});
  eq(guardSummaryBad.numbers.ok, false, '[٤-ب] numbers.ok=false');
  eq(guardSummaryBad.ok, false, '[٤-ب][البند ٤، مطلوب صراحةً] guard.ok=false — نفس الرقم خارج details يرفض الردّ');
  eq(guardSummaryBad.detailsWaived, null, '[٤-ب] detailsWaived=null — لا خرق في details على هذا الردّ');

  // ٤-ج — ردّ سليم تماماً → ok=true، detailsWaived=null.
  const guardClean = guardV7Response(baseValidResponse(), {findings: body.findings, categoryStates: categoryStatesForGuard});
  eq(guardClean.ok, true, '[٤-ج] ردّ سليم تماماً → ok=true');
  eq(guardClean.detailsWaived, null, '[٤-ج] detailsWaived=null — لا خرق إطلاقاً');
}
console.log('تحقّق ٤: guardV7Response — خرق details وحده لا يرفض (معفًى ومُسجَّل)، نفس الخرق خارج details يرفض — القرار نفسه القاعدة 30 (يُختبَر بكلتا الحالتين لا واحدة)');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — تكامل: buildV7Payload على فِخّ حقيقي (b45c8cf6) — rawValue لاختبار من
// المجموعة غير المعايَرة محجوب، رawValue لاختبار آخر خارجها بلا مساس.
// ═══════════════════════════════════════════════════════════════════════
{
  deepEq(UNCALIBRATED_TEST_IDS.slice().sort(),
      [...THERMAL_UNCALIBRATED_IDS, ...UNCALIBRATED_THRESHOLD_IDS].slice().sort(),
      '[٥] UNCALIBRATED_TEST_IDS = THERMAL_UNCALIBRATED_IDS ∪ UNCALIBRATED_THRESHOLD_IDS بالضبط (T-01/T-02/C-07/S-06)');
  // أمر 2026-10-07 — استُبدل توقّع «غير المعايَر ∪ UNSTABLE» (القاعدة 23): صار الحجب الكامل = غير المعايَر ∪ UNSTABLE ∪ المحتوى/التشغيل ∪ B-01..B-07.
  deepEq(MODEL_HIDDEN_TEST_IDS.slice().sort(),
      [...THERMAL_UNCALIBRATED_IDS, ...UNCALIBRATED_THRESHOLD_IDS, ...UNSTABLE_IDS, ...USER_CONTENT_OR_RUNTIME_IDS, ...BATTERY_STATE_TEST_IDS].slice().sort(),
      '[٥][أمر 2026-10-07] MODEL_HIDDEN_TEST_IDS = غير المعايَر ∪ UNSTABLE ∪ USER_CONTENT_OR_RUNTIME ∪ B-01..B-07 بالضبط — مصدرها testKinds.js');
  deepEq(MODEL_JUDGMENT_HIDDEN_TEST_IDS.slice().sort(), USER_SETTING_IDS.slice().sort(), '[٥][أمر 2026-10-07] حجب الحكم وحده = USER_SETTING_IDS بالضبط');
  deepEq(MODEL_ALWAYS_NOT_MEASURED_TEST_IDS.slice(), ['SEC-08'], '[٥][أمر 2026-10-07] «غير مقيس» دائماً = SEC-08 وحده');
  deepEq(APP_CONSTANT_NOT_READ_IDS.slice(), ['SEC-08'], '[٥] مصدر SEC-08 testKinds.js');
  // اختبار ينتمي إلى مجموعتين: لا يُسمَح بصمت — القائمة المُسمّاة بمعرّفاتها تغلب الصنف العامّ (B-02/B-07 هويّة داخل B-xx تُحجَب)، وأيّ تداخل
  // بين المجموعات الثلاث يُسقِط هذا الاختبار حتى يُحسَم صراحة.
  {
    const all = [...MODEL_HIDDEN_TEST_IDS, ...MODEL_JUDGMENT_HIDDEN_TEST_IDS, ...MODEL_ALWAYS_NOT_MEASURED_TEST_IDS];
    eq(new Set(all).size, all.length, '[٥] المجموعات الثلاث (حجب كامل / حجب الحكم / غير مقيس دائماً) منفصلة — لا معرّف في مجموعتين');
    ok(MODEL_HIDDEN_TEST_IDS.includes('B-02') && MODEL_HIDDEN_TEST_IDS.includes('B-07'), '[٥] B-02 (سعة التصميم) وB-07 (التقنية) — هويّة داخل B-xx — تُحجبان: القائمة المُسمّاة تغلب');
    ok(!MODEL_HIDDEN_TEST_IDS.includes('B-08') && !MODEL_HIDDEN_TEST_IDS.includes('T-04') && !MODEL_HIDDEN_TEST_IDS.includes('CM-11'), '[٥] SPEC (B-08/T-04/CM-11) خارج الحجب — «المواصفة ليست قياساً»');
  }

  const s10Raw = loadJson('b45c8cf6.ts.json');
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const findings = computeFindings({device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(s10Raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  // ضابط: قبل buildV7Payload، categoryStates.testResults الخام يحمل rawValue
  // حقيقياً (غير محجوب) لاختبار من المجموعة — إثبات أن الحجب فعل البناء لا
  // أن المصدر كان فارغاً أصلاً (القاعدة 22 — لا نجاح زائف بغياب مصادفة).
  const rawC07 = categoryStates.testResults.find((t) => t.testId === 'C-07');
  ok(rawC07 && rawC07.raw && typeof rawC07.raw.rawValue !== 'undefined' && rawC07.raw.rawValue !== UNCALIBRATED_MEASUREMENT_NOTE,
      '[٥][إعداد] C-07 الخام (قبل buildV7Payload) يحمل rawValue حقيقياً غير النصّ المُحجوب — إثبات أن الحجب يقع في البناء');

  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: 'redaction-integration', isFreeTrial: false, previousScan: null});

  const c07 = body.testResults.find((t) => t.testId === 'C-07');
  ok(c07, '[٥] C-07 موجودة في body.testResults (لم تُحذف، قيمتها وحدها تغيّرت)');
  eq(c07.raw.rawValue, UNCALIBRATED_MEASUREMENT_NOTE, '[٥] C-07.raw.rawValue محجوب (ضمن UNCALIBRATED_THRESHOLD_IDS)');
  // D1 (أمر 2026-10-06): evidence نسخة من rawValue — كانت تُسرّب القيمة.
  eq(c07.evidence, UNCALIBRATED_MEASUREMENT_NOTE, '[٥][D1] C-07.evidence محجوب أيضاً (لا في raw.rawValue وحده)');
  const s06 = body.testResults.find((t) => t.testId === 'S-06');
  eq(s06.evidence, UNCALIBRATED_MEASUREMENT_NOTE, '[٥][D1] S-06.evidence محجوب أيضاً');
  eq(body.findings.advisoryMeasurements['S-06'].rawValue, UNCALIBRATED_MEASUREMENT_NOTE, '[٥][D2] findings.advisoryMeasurements.S-06.rawValue محجوب');
  // D3 — الفرع الثاني: T-01/T-02 unavailable (N/A) تبقى بلا «مقيس».
  for (const id of ['T-01', 'T-02']) {
    const t = body.testResults.find((x) => x.testId === id);
    // أمر 2026-10-06 — استُبدل توقّع outcome='NOT_MEASURED' (القاعدة 23): حالة الاختبار المحجوب «مقيس»/«غير مقيس» وحدها.
    eq(t.outcome, MODEL_STATE_TEXT.notMeasured, `[٥][D3] ${id}.outcome='غير مقيس' (المحجوب غير المُقاس يصل بحالة «غير مقيس» وحدها)`);
    eq(t.raw.status, MODEL_STATE_TEXT.notMeasured, `[٥][D3] ${id}.raw.status='غير مقيس' — لا unavailable ولا حكم`);
    eq(t.raw.rawValue, 'N/A', `[٥][D3] ${id}.raw.rawValue يبقى "N/A" (unavailable) — لا «مقيس» (القاعدة 22)`);
    eq(t.evidence, 'N/A', `[٥][D3] ${id}.evidence يبقى "N/A"`);
  }

  // أمر 2026-10-06 (٣): UNSTABLE_IDS تدخل القائمة المحجوبة — حالتها «مقيس» وحدها، لا PASS/WARNING/FAIL ولا قيمة.
  for (const id of UNSTABLE_IDS) {
    const t = body.testResults.find((x) => x.testId === id);
    ok(t, `[٥][٣] ${id} موجود في body.testResults (لم يُحذف — حالته وحدها تغيّرت)`);
    const original = categoryStates.testResults.find((x) => x.testId === id);
    ok(['PASS', 'FAIL', 'WARNING'].includes(original.outcome), `[٥][إعداد] ${id} الخام منفَّذ فعلاً (outcome=${original.outcome}) — فالحجب فعل البناء`);
    eq(t.outcome, MODEL_STATE_TEXT.measured, `[٥][٣] ${id}.outcome = «مقيس…» لا ${original.outcome}`);
    eq(t.raw.status, MODEL_STATE_TEXT.measured, `[٥][٣] ${id}.raw.status = «مقيس…» لا الحالة الخام`);
    eq(t.raw.rawValue, MODEL_STATE_TEXT.measured, `[٥][٣] ${id}.raw.rawValue محجوب`);
    eq(t.evidence, MODEL_STATE_TEXT.measured, `[٥][٣][D1] ${id}.evidence محجوب`);
    eq(t.raw.rawValueUnit, original.raw.rawValueUnit, `[٥][٣] ${id}.raw.rawValueUnit بلا مساس (الوحدة ليست قيمة)`);
  }
  // ضابط سلبي: الاختبار الداخل في الحرف يحتفظ بقيمته وحالته (C-06: outcome الحقيقي، raw.status الحقيقي).
  const origC06 = categoryStates.testResults.find((x) => x.testId === 'C-06');
  const bodyC06 = body.testResults.find((x) => x.testId === 'C-06');
  eq(bodyC06.outcome, origC06.outcome, '[٥][٣][ضابط سلبي] C-06 (داخل الحرف) outcome كما هو — لا «مقيس»');
  eq(bodyC06.raw.status, origC06.raw.status, '[٥][٣][ضابط سلبي] C-06.raw.status كما هو');
  eq(bodyC06.raw.rawValue, origC06.raw.rawValue, '[٥][٣][ضابط سلبي] C-06.raw.rawValue كما هو');

  // أمر 2026-10-06 (٢): findings.channels وperChannelUpdateCount غائبتان عن الحمولة، حاضرتان في المصدر بلا تغيير.
  ok(!('channels' in body.findings) && !('perChannelUpdateCount' in body.findings),
      '[٥][٢] body.findings بلا channels ولا perChannelUpdateCount');
  ok(findings.channels && Object.keys(findings.channels).length > 0, '[٥][٢][إعداد] findings.channels الأصلية حاضرة وغير فارغة — الحذف فعل البناء');
  ok(!JSON.stringify(body).includes('cpu_freq_max_khz'), '[٥][٢] اسم قناة (cpu_freq_max_khz) غائب عن الحمولة كلّها');
  eq(JSON.stringify(sanitizeFindingsForModelPayload(findings) === findings), 'false', '[٥][٢] sanitize لا يُعيد الكائن نفسه');

  // ضابط سلبي: اختبار MEASUREMENT خارج المجموعتين (C-06) يحتفظ برقمه الحقيقي.
  const c06 = body.testResults.find((t) => t.testId === 'C-06');
  ok(c06 && c06.raw && typeof c06.raw.rawValue !== 'undefined' && c06.raw.rawValue !== UNCALIBRATED_MEASUREMENT_NOTE,
      '[٥][ضابط سلبي] C-06 (خارج القائمة) يحتفظ برقمه الحقيقي — الحجب مُسمّى لا عامّ');

  // مؤشّرات البطارية الأربعة محجوبة فعلياً في body.categoryStates.categories.battery.
  const batInd = body.categoryStates.categories.battery.batteryIndicators;
  for (const id of UNCALIBRATED_BATTERY_INDICATOR_IDS) {
    ok(batInd[id], `[٥] ${id} موجود في body (لم يُحذف)`);
    eq(batInd[id].note, UNCALIBRATED_MEASUREMENT_NOTE, `[٥] ${id}.note محجوب في الحمولة الفعلية فعلاً (buildV7Payload الحقيقية)`);
    ok(!('value' in batInd[id]) && !('ratioToDesign' in batInd[id]) && !('designCapacityMah' in batInd[id]),
        `[٥] ${id} لا يحمل value/ratioToDesign/designCapacityMah في الحمولة الفعلية`);
  }

  // findings.sustainedCeiling/graphics محجوبان فعلياً في body.findings.
  eq(body.findings.sustainedCeiling.note, UNCALIBRATED_MEASUREMENT_NOTE, '[٥] body.findings.sustainedCeiling محجوب فعلياً');
  ok(!('peakFreqKhz' in body.findings.sustainedCeiling), '[٥] body.findings.sustainedCeiling.peakFreqKhz غائب فعلياً');
  eq(body.findings.graphics.note, UNCALIBRATED_MEASUREMENT_NOTE, '[٥] body.findings.graphics محجوب فعلياً');

  // كل عدد عشري في الحمولة النهائية مُقرَّب فعلياً إلى منزلتين — فحص عميق
  // على userMessage بالكامل (لا عيّنة، كل رقم حقيقي في الحمولة المُرسَلة فعلاً).
  const bodyText = JSON.stringify(body);
  const uglyDecimals = (bodyText.match(/\d+\.\d{3,}/g) || []);
  deepEq(uglyDecimals, [], '[٥][البند ٣] صفر عدد عشري بأكثر من منزلتين في الحمولة الفعلية المُرسَلة — roundPayloadNumbersDeep طُبِّقت على الكل');
}
console.log('تحقّق ٥: تكامل buildV7Payload على فِخّ حقيقي (b45c8cf6) — C-07 محجوب/C-06 بلا مساس، مؤشّرات البطارية الأربعة محجوبة، sustainedCeiling/graphics محجوبان، صفر عدد عشري >٢ منزلة في الحمولة كلّها');

// ═══════════════════════════════════════════════════════════════════════
// ٦ — أمر 2026-10-06: جدول سياسة findings — اختبار ثنائي الاتّجاه على أربعة فِخاخ حقيقية
// (b45c8cf6، 34dff2b8، S10 8909e850، Honor e4b65a2f). مفتاح علوي جديد في computeFindings بلا حكم
// في MODEL_FINDINGS_POLICY يُسقِط هذا القسم (القاعدة 25 — الرفض الافتراضي لا يكفي وحده: يجب أن يُعلَن).
// ═══════════════════════════════════════════════════════════════════════
{
  const SCANS = [
    ['b45c8cf6', 'b45c8cf6.ts.json', 'b45c8cf6-e376-4765-8703-f68e9bc69844'],
    ['34dff2b8', '34dff2b8.ts.json', '34dff2b8-ce9e-4b40-86a9-1976c878e195'],
    ['S10', '8909e850-s10.ts.json', '8909e850-b10c-466c-899a-ce97cb5c4fbe'],
    ['Honor', 'e4b65a2f-honor.ts.json', 'e4b65a2f-3a0c-4f11-939d-17eab7d0912f'],
  ];
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const seenKeys = new Set();
  const lib = {
    numericLeafPaths(obj) {
      const out = [];
      const walk = (v, p) => {
        if (typeof v === 'number') out.push(p);
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
        else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], p ? `${p}.${k}` : k);
      };
      walk(obj, '');
      return out;
    },
  };
  const numericTopKeys = (obj) => {
    const tops = new Set();
    const walk = (v, top) => {
      if (typeof v === 'number') tops.add(top);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, top));
      else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], top);
    };
    for (const k of Object.keys(obj)) walk(obj[k], k);
    return [...tops].sort();
  };
  for (const [label, tsFile, scanId] of SCANS) {
    const raw = loadJson(tsFile);
    const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: frMap[scanId], manualResults: []});
    for (const k of Object.keys(findings)) seenKeys.add(k);
    deepEq(unclassifiedFindingsKeys(findings), [], `[٦][${label}] كل مفتاح علوي في findings له حكم في MODEL_FINDINGS_POLICY (لا غير مُصنَّف)`);
    const before = JSON.stringify(findings);
    const out = sanitizeFindingsForModelPayload(findings);
    eq(JSON.stringify(findings), before, `[٦][${label}] المصدر المحسوب لم يتغيّر في مكانه`);
    deepEq(Object.keys(out), Object.keys(findings).filter((k) => MODEL_FINDINGS_POLICY[k] !== 'REMOVE'),
        `[٦][${label}] مفاتيح الحمولة = مفاتيح المصدر ما عدا حكم REMOVE، بترتيب المصدر`);
    // أمر 2026-10-07 (٥): لا رقم يبقى في findings إلا meta.fieldsVersion وmeta.api (الثانية لم يحسمها القرار فبقيت). notMeasuredFields بلا قيم.
    deepEq(numericTopKeys(out), ['meta'], `[٦][${label}] الأرقام لا تبقى إلا تحت meta — كل قيمة قياس صارت «مقيس»/«غير مقيس»`);
    deepEq([...lib.numericLeafPaths(out)].sort(), ['meta.api', 'meta.fieldsVersion'], `[٦][${label}] الورقتان الرقميّتان الباقيتان بعينهما: meta.api وmeta.fieldsVersion`);
    ok(Array.isArray(out.notMeasuredFields) ? out.notMeasuredFields.every((e) => !('value' in e)) : true, `[٦][${label}] notMeasuredFields بلا value افتراضية`);
    // وحدة: المصدر نفسه يحمل أرقاماً تحت المفاتيح التي صارت حالة (إثبات أن الإخفاء فعل البناء لا خلوّ المصدر).
    ok(numericTopKeys(findings).includes('channels') && numericTopKeys(findings).includes('thermal'),
        `[٦][${label}][إعداد] المصدر يحمل أرقاماً تحت channels وthermal`);
  }
  // الاتّجاه الثاني: كل مفتاح في الجدول يظهر في findings حقيقية واحدة على الأقلّ (لا حكم على مفتاح ميّت).
  deepEq(Object.keys(MODEL_FINDINGS_POLICY).filter((k) => !seenKeys.has(k)), [],
      '[٦] كل مفتاح في MODEL_FINDINGS_POLICY موجود في findings أحد الفِخاخ الأربعة — لا حكم على مفتاح ميّت');
  ok(Object.values(MODEL_FINDINGS_POLICY).every((v) => ['KEEP', 'STATE', 'TESTS', 'REMOVE', 'META', 'FIELD_NAMES'].includes(v)),
      '[٦] قيم الجدول من الستّ المُسمّاة وحدها');

  // أشكال الحالة (STATE) — الفرعان معاً (القاعدة 30): مقيس وغير مقيس.
  const st = sanitizeFindingsForModelPayload({
    storage: {status: 'MEASURED', inCacheMbps: 1618, kneeGb: 5.1, capacityDerived: {status: 'NOT_MEASURED', reason: 'ABSENT_OR_UNPARSEABLE', x: 5}},
    thermal: {batteryTempRise: {status: 'NOT_MEASURED', reason: 'INSUFFICIENT_CADENCE', valueC: null}, thermalHeadroomPeak: 1.0066667, thermalStatusMax: null},
  });
  deepEq(st.storage, {status: 'MEASURED', note: MODEL_STATE_TEXT.measured, capacityDerived: {status: 'NOT_MEASURED', notMeasuredReason: 'ABSENT_OR_UNPARSEABLE'}},
      '[٦] storage: MEASURED → {status,note}؛ capacityDerived غير المقيس بسببه بلا note ولا قيمة');
  deepEq(st.thermal, {
    batteryTempRise: {status: 'NOT_MEASURED', notMeasuredReason: 'INSUFFICIENT_CADENCE'},
    thermalHeadroomPeak: {status: 'MEASURED', note: MODEL_STATE_TEXT.measured},
    thermalStatusMax: {status: 'NOT_MEASURED'},
  }, '[٦] thermal: بلا valueC/معدّل/قيمة؛ الحقل الرقمي الفارغ «غير مقيس» لا «مقيس» (القاعدة 22)');
  deepEq(sanitizeFindingsForModelPayload({storage: {status: 'NOT_MEASURED', reason: 'NO_STORAGE_PHASE'}}).storage,
      {status: 'NOT_MEASURED', notMeasuredReason: 'NO_STORAGE_PHASE'}, '[٦] storage غير المقيس يحمل سببه وحده');
  // القاعدة 22: findings.js ينتج للتخزين المقيس 'STATE_ONLY' (لا 'MEASURED') — يصل «مقيس»؛ والغائب/المجهول لا يُقرأ «مقيس».
  deepEq(sanitizeFindingsForModelPayload({storage: {status: 'STATE_ONLY', inCacheMbps: 1618}}).storage,
      {status: 'MEASURED', note: MODEL_STATE_TEXT.measured}, '[٦] storage.status=STATE_ONLY (حالة المُنتِج الحقيقية للمقيس) → «مقيس»');
  deepEq(sanitizeFindingsForModelPayload({storage: {inCacheMbps: 1618}}).storage, {status: null},
      '[٦][القاعدة 22] storage بلا status يصل status:null — لا «مقيس» افتراضي');
  deepEq(sanitizeFindingsForModelPayload({storage: {status: 'WEIRD', inCacheMbps: 1618}}).storage, {status: 'WEIRD'},
      '[٦][القاعدة 22] storage بحالة مجهولة تصل كما هي — لا «مقيس» افتراضي');
}
console.log('تحقّق ٦: MODEL_FINDINGS_POLICY — ثنائي الاتّجاه على أربعة فِخاخ حقيقية (كل مفتاح مُصنَّف، لا ورقة رقمية خارج meta/notMeasuredFields، المصدر لا يتغيّر)');

// ═══════════════════════════════════════════════════════════════════════
// ٧ — hideTestResultForModel وhideTaggedMeasurementsForModel — الفرعان (مقيس/غير مقيس) بكل الحالات الممكنة (القاعدة 30)
// ═══════════════════════════════════════════════════════════════════════
{
  const mk = (outcome, rawValue, status) => ({
    testId: 'C-04', kind: 'MEASUREMENT', outcome, evidence: rawValue,
    raw: {rawValue, rawValueUnit: 'MFLOPS', status, testId: 'C-04'}, healthBearing: false, notMeasuredReason: null,
  });
  for (const [outcome, status] of [['PASS', 'pass'], ['WARNING', 'warning'], ['FAIL', 'fail']]) {
    const out = hideTestResultForModel(mk(outcome, '3271.5', status));
    eq(out.outcome, MODEL_STATE_TEXT.measured, `[٧] outcome=${outcome} → «مقيس…» (لا pass/warning/fail لاختبار خارج الحرف)`);
    eq(out.raw.status, MODEL_STATE_TEXT.measured, `[٧] raw.status=${status} → «مقيس…»`);
    eq(out.raw.rawValue, MODEL_STATE_TEXT.measured, `[٧] ${outcome}: rawValue محجوب`);
    eq(out.evidence, MODEL_STATE_TEXT.measured, `[٧] ${outcome}: evidence محجوب`);
    eq(out.raw.rawValueUnit, 'MFLOPS', `[٧] ${outcome}: الوحدة بلا مساس`);
  }
  for (const [outcome, status] of [['NOT_MEASURED', 'unavailable'], ['NOT_MEASURED', 'not_tested'], ['UNKNOWN', 'unknown']]) {
    const out = hideTestResultForModel(mk(outcome, 'N/A', status));
    eq(out.outcome, MODEL_STATE_TEXT.notMeasured, `[٧] outcome=${outcome}/${status} → «غير مقيس» (لا «مقيس» لما لم يُقَس، القاعدة 22)`);
    eq(out.raw.status, MODEL_STATE_TEXT.notMeasured, `[٧] raw.status=${status} → «غير مقيس»`);
    eq(out.raw.rawValue, 'N/A', `[٧] ${outcome}/${status}: rawValue يبقى N/A كما وصل`);
    eq(out.evidence, 'N/A', `[٧] ${outcome}/${status}: evidence يبقى N/A`);
  }
  eq(hideTestResultForModel(null), null, '[٧] null يمرّ بلا رمي');
  const nrw = hideTestResultForModel({testId: 'S-06', outcome: 'PASS'});
  ok(!('raw' in nrw) && !('evidence' in nrw) && nrw.outcome === MODEL_STATE_TEXT.measured, '[٧] عنصر بلا raw/evidence: لا حقل يُختلَق');

  // قرار 2026-10-07 (القاعدة 23): خريطة findings.unstableMeasurements صارت REMOVE فلا تُمرَّر إلى hideTaggedMeasurementsForModel؛ تُختبَر الدالّة بعنصر advisoryMeasurements
  // (S-06، class ADVISORY — الشكل الحقيقي لـfindings.advisoryMeasurements) وبقيت حقول class/label/entersGrade/entersFault كما وصلت.
  const entry = (testStatus, rawValue, found = true) => ({found, rawValue, rawValueUnit: 'IOPS', testStatus, class: 'ADVISORY', entersGrade: false, entersFault: false, label: 'إرشادي حتى بروتوكول الفجوات', criterion: 'CV<10%', referenceCvPct: 8, referenceNote: 'يحتاج معايرة'});
  for (const ts of ['pass', 'warning', 'fail']) {
    const o = hideTaggedMeasurementsForModel({'S-06': entry(ts, '98932')})['S-06'];
    eq(o.testStatus, MODEL_STATE_TEXT.measured, `[٧] tagged ${ts} → testStatus «مقيس…»`);
    eq(o.rawValue, MODEL_STATE_TEXT.measured, `[٧] tagged ${ts}: rawValue محجوب`);
    ok(!('criterion' in o) && !('referenceCvPct' in o) && !('referenceNote' in o), `[٧] tagged ${ts}: criterion/referenceCvPct/referenceNote مُسقَطة`);
    eq(o.class, 'ADVISORY', `[٧] tagged ${ts}: class محفوظ (S-06 إرشادي — ليس من UNSTABLE_IDS)`);
    ok(o.entersGrade === false && o.entersFault === false, `[٧] tagged ${ts}: entersGrade/entersFault يبقيان false`);
  }
  const un = hideTaggedMeasurementsForModel({'S-06': entry('unavailable', 'N/A')})['S-06'];
  eq(un.testStatus, MODEL_STATE_TEXT.notMeasured, '[٧] tagged unavailable → «غير مقيس»');
  eq(un.rawValue, 'N/A', '[٧] tagged unavailable: rawValue يبقى N/A');
  const absent = {found: false, class: 'ADVISORY', status: 'NOT_MEASURED', reason: 'ABSENT_FROM_FUNCTIONAL_RESULTS'};
  deepEq(hideTaggedMeasurementsForModel({'S-06': absent})['S-06'], absent, '[٧] tagged found=false بلا مساس');
  deepEq(hideTaggedMeasurementsForModel({'X-99': entry('pass', '1')})['X-99'], entry('pass', '1'), '[٧] معرّف خارج MODEL_HIDDEN_TEST_IDS بلا مساس');
}
console.log('تحقّق ٧: hideTestResultForModel وhideTaggedMeasurementsForModel — كل حالات المقيس (pass/warning/fail) وغير المقيس بلا تسرّب');

// ═══════════════════════════════════════════════════════════════════════
// ٨ — تكامل على 34dff2b8: S-06 كانت warning (حكم من عتبة غير معايَرة) — يصل «مقيس» لا warning، في الثلاثة مواضع
// (testResults، findings.advisoryMeasurements، وlevel الحمولة كلّها)
// ═══════════════════════════════════════════════════════════════════════
{
  const raw = loadJson('34dff2b8.ts.json');
  const scanId = '34dff2b8-ce9e-4b40-86a9-1976c878e195';
  const functional = loadJson('functionalResults-by-scanid.json').byScanId[scanId];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const origS06 = categoryStates.testResults.find((t) => t.testId === 'S-06');
  eq(origS06.outcome, 'WARNING', '[٨][إعداد] S-06 على 34dff2b8 خام = WARNING (الحكم الذي لا يجب أن يصل)');
  const {body, userMessage} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: 'warning-test', isFreeTrial: false, previousScan: null});
  const s06 = body.testResults.find((t) => t.testId === 'S-06');
  eq(s06.outcome, MODEL_STATE_TEXT.measured, '[٨] S-06.outcome في الحمولة = «مقيس…» لا WARNING');
  eq(s06.raw.status, MODEL_STATE_TEXT.measured, '[٨] S-06.raw.status = «مقيس…» لا warning');
  eq(body.findings.advisoryMeasurements['S-06'].testStatus, MODEL_STATE_TEXT.measured, '[٨] findings.advisoryMeasurements.S-06.testStatus = «مقيس…» لا warning');
  // قرار 2026-10-07 (القاعدة 23): استُبدل توقّع «findings.unstableMeasurements.<id>.testStatus = مقيس» — الخريطة كلّها لا تصل النموذج (REMOVE)،
  // وحالات الأربعة تصل في testResults وحدها.
  ok(!('unstableMeasurements' in body.findings), '[٨] findings.unstableMeasurements محذوفة من نسخة النموذج (قرار 2026-10-07)');
  ok('unstableMeasurements' in findings, '[٨][إعداد] والمخزَّن ما زال يحملها');
  for (const id of UNSTABLE_IDS) {
    const t = body.testResults.find((x) => x.testId === id);
    eq(t.outcome, MODEL_STATE_TEXT.measured, `[٨] ${id}: حالته في testResults = «مقيس…»`);
    ok(!('unstable' in t), `[٨] ${id}: لا حقل unstable`);
  }
  ok(!/"(outcome|status|testStatus)":"(WARNING|warning)"/.test(JSON.stringify(body.testResults.filter((t) => MODEL_HIDDEN_TEST_IDS.includes(t.testId)))),
      '[٨] لا warning في أيّ اختبار محجوب في testResults');
  ok(userMessage.length > 0, '[٨] userMessage مبنيّ');
}
console.log('تحقّق ٨: تكامل 34dff2b8 — S-06 (كانت warning) وUNSTABLE تصل «مقيس» لا حكماً في testResults وfindings');

console.log(`\nv7PayloadRedactionAndRounding.test.js: ${n}/${n} assertions passed`);
