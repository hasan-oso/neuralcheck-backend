'use strict';

// fv71ScanConditionsReader.test.js — قارئ P6-13 (توحيد الظروف) في fv71: powerSaveState · brightnessLock · batteryWindowPct، S-P6-13، 2026-10-18 +03.
//
// المواصفة: docs/FV71_CONTRACT_SECTION.md ف-05 (N71-06/07/08) — القسم المنسوخ؛ والخطّة PLAN-06 §١٢ (في مساحة العمل؛ صفّ الجدول `:1054` والأمر يقول `:1052`: انجرف سطرين) ثانوية.
// **أسماء `batteryWindowPct` وحقول `brightnessLock` [م] لم تُقرّ بعد** (القسم: «مقترح، للاعتماد»).
//
// ما يثبّته:
//   أ) المفاتيح الجديدة الثلاثة وقيمها المعدَّدة مكتوبة باليد من القسم (القاعدة 30)، وكل قيمة تظهر في نصّه.
//   ب) حالة القسم العلوي بحسب الختم: < 71 ⟵ NOT_IN_FIELDS_VERSION (وأساس توفير الطاقة LEGACY_BOOLEAN_ONLY، ونافذة الشحن LEGACY_FIXED_MIN_NO_MAX: 25 ولا أعلى)، بلا ختم ⟵ UNDETERMINED، ≥ 71 ⟵ READ؛ وحضور مفتاح جديد مبكّراً شذوذ.
//   جـ) powerSaveState بقيمه الثلاث × الموضعين × المنطقيّ (true · false · غائب): مصفوفة كاملة (القاعدة 30): «on ⇒ true، off ⇒ false، read_failed ⇒ غائب (لا false)».
//   د) brightnessLock بكل حالاته وطرقه ومداه [0، 1] وغياب value/method بسبب not_attempted.
//   هـ) batteryWindowPct: **الخادم لا يحمل 30 ولا 85** (يقرأ ما أُعلِن)، والعلاقات (min ≤ max، المدى 0..100).
//   و) batteryLevelStart مقابل النافذة بالحدود بالمساواة (داخل/تحت/فوق/مجهول/غير صالح) — وصف بلا حكم.
//   ز) المسار الكامل بالقارئ الحقيقي على حمولات المُنتِج الثلاث (القاعدة 37 و41): off/off/read_failed وbrightnessLock الثلاث (not_attempted:value_not_decided · applied · apply_failed) والنافذة 30–85 في التذييل.
//
// **كتلة «ز» من المُنتِج (مزامنة 2026-10-18، NeuralChek@f9e0571)** — نسخ حرفية؛ والباقي حمولات مبنيّة هنا باليد (GOOD وتعديلاتها) لتغطية ما لا تغطّيه عيّنات المُنتِج: powerSaveState=on، وnot_attempted:no_scan_screen_reported، وBELOW_MIN/ABOVE_MAX،
// وطريقة system_setting، وغياب المفاتيح… (مُسمّاة مبنيّة هنا لا حمولة مُنتِج). حلّت محلّ عيّنتين بنيتُهما من العقد (scripts/lib/fv71ConditionsSynthetic.js — حُذفت، القاعدة 23).
// **معلّق:** وسم البداية الساخنة `hotStart` (PLAN-06 §١٢-ب): حساب يومي عبر فحوص لا مُدخل له في القسم — لا قارئ له هنا.
//
// Run: node functions/test/fv71ScanConditionsReader.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const R = require('../src/analysis/fv68Reader');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));

const KS = N.KEY_STATUS;
const SS = N.SCAN_CONDITIONS_STATE;
const SV = N.START_LEVEL_VS_WINDOW;
const BW = N.BATTERY_WINDOW_BASIS;

// حمولة اصطناعية بأجزائها: ترويسة وجذر وتذييل (التذييل يحمل fieldsVersion)
const fp = (fv, {header = {}, root = {}, footer = {}, tsState} = {}) => ({
  ...root,
  timeSeries: {header, footer: fv === null ? footer : {fieldsVersion: fv, ...footer}, ...(tsState === undefined ? {} : {timeSeriesState: tsState})},
  functionalResults: [], manualResults: [],
});
const read = (fv, parts) => R.readFv68(fp(fv, parts));
const sc = (o) => o.scanConditions;
const codes = (o) => o.anomalies.map((a) => a.code);
const hasCode = (o, code, pred) => o.anomalies.some((a) => a.code === code && (pred === undefined || pred(a)));
// حمولة fv71 سليمة بمفاتيحها الثلاثة (المنطقيّان false)
const GOOD = () => ({
  header: {isPowerSaveMode: false, powerSaveState: 'off', batteryLevelStart: 43},
  root: {powerSaveMode: false, powerSaveState: 'off'},
  footer: {brightnessLock: {state: 'applied', value: 0.5, method: 'window_attribute'}, batteryWindowPct: {minPct: 30, maxPct: 85}},
});
const scOnly = (o) => o.anomalies.filter((a) => a.section.startsWith('scanConditions') || a.section.startsWith('header.') || a.section.startsWith('root.') ||
  a.section.startsWith('brightnessLock') || a.section.startsWith('batteryWindowPct')).map((a) => a.code);

// ═══ أ) القيم المعدَّدة — باليد من القسم ══════════════════════════════════════════════════════════════════════════
{
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'FV71_CONTRACT_SECTION.md'), 'utf8');
  eq(Object.values(N.POWER_SAVE_STATE), ['off', 'on', 'read_failed'], '[أ] powerSaveState: ثلاث قيم بنصّ القسم');
  eq(Object.values(N.BRIGHTNESS_LOCK_STATE), ['applied', 'apply_failed', 'not_attempted'], '[أ] brightnessLock.state: applied وapply_failed:<نصّ> وnot_attempted:<سبب>');
  eq(Object.values(N.BRIGHTNESS_LOCK_METHOD), ['window_attribute', 'system_setting'], '[أ] brightnessLock.method: قيمتان');
  eq(Object.values(N.BRIGHTNESS_LOCK_KEYS), ['state', 'value', 'method'], '[أ] brightnessLock: state وvalue وmethod');
  eq(Object.values(N.BATTERY_WINDOW_KEYS), ['minPct', 'maxPct'], '[أ] batteryWindowPct: minPct وmaxPct');
  eq([N.BATTERY_WINDOW_LEGACY_MIN_PCT, N.BATTERY_LEVEL_UNKNOWN_SENTINEL], [25, -1], '[أ] قبل 71: حدّ أدنى 25 ولا أعلى؛ وحارس batteryLevelStart المجهول -1');
  for (const v of ['powerSaveState', 'brightnessLock', 'batteryWindowPct', 'minPct', 'maxPct', 'window_attribute', 'system_setting', 'apply_failed', 'not_attempted', 'read_failed', 'batteryLevelStart', 'isPowerSaveMode', 'powerSaveMode']) {
    ok(text.includes(v), `[أ] «${v}» في نصّ القسم المنسوخ`);
  }
  ok(text.includes('`off` · `on` · `read_failed`') && text.includes('applied') , '[أ] القيم الثلاث لـpowerSaveState وapplied بنصّ القسم');
  // الخادم لا يحمل 30 ولا 85 (قرار N71-06): لا ثابت بأيّ منهما في fv68Names
  const exportsText = JSON.stringify(Object.values(N).filter((v) => v !== null && typeof v === 'object'));
  ok(!/\b(30|85)\b/.test(JSON.stringify(N.BATTERY_WINDOW_BASIS) + JSON.stringify(N.BATTERY_WINDOW_KEYS) + String(N.BATTERY_WINDOW_LEGACY_MIN_PCT)), '[أ] لا 30 ولا 85 في ثوابت النافذة (يعلنها التطبيق في الحمولة، القاعدة 24)');
  ok(exportsText.length > 100, '[أ] ضابط بنية');
}

// ═══ ب) حالة القسم العلوي بحسب الختم ══════════════════════════════════════════════════════════════════════════════
{
  for (const fv of [67, 68, 69, 70]) {
    const o = read(fv, {header: {isPowerSaveMode: false, batteryLevelStart: 43}, root: {powerSaveMode: false}});
    eq([sc(o).state, sc(o).powerSaveBasis, sc(o).batteryWindowBasis, sc(o).unexpectedKeys], [SS.NOT_IN_FIELDS_VERSION, 'LEGACY_BOOLEAN_ONLY', BW.LEGACY_FIXED_MIN_NO_MAX, []],
        `[ب] ختم ${fv}: المفاتيح الجديدة «لم توجد بعد»؛ المنطقيّ وحده؛ نافذة قديمة 25 بلا أعلى`);
    eq([sc(o).header.powerSaveStateStatus, sc(o).root.powerSaveStateStatus, sc(o).brightnessLock.status, sc(o).batteryWindow.status],
        [KS.NOT_IN_FIELDS_VERSION, KS.NOT_IN_FIELDS_VERSION, KS.NOT_IN_FIELDS_VERSION, KS.NOT_IN_FIELDS_VERSION], `[ب] ختم ${fv}: حالات المفاتيح الأربعة NOT_IN_FIELDS_VERSION لا ABSENT`);
    eq([sc(o).header.isPowerSaveMode, sc(o).header.isPowerSaveModeStatus, sc(o).root.powerSaveMode, sc(o).root.powerSaveModeStatus], [false, KS.PRESENT, false, KS.PRESENT], `[ب] ختم ${fv}: المنطقيّان القديمان يُقرآن كما هما`);
    eq(scOnly(o), [], `[ب] ختم ${fv}: لا شذوذ`);
  }
  const early = read(70, GOOD());
  eq(sc(early).unexpectedKeys, ['header.powerSaveState', 'root.powerSaveState', 'footer.brightnessLock', 'footer.batteryWindowPct'], '[ب] ختم 70 والمفاتيح الأربعة حاضرة: تُسرد (لا تُقرأ)');
  ok(hasCode(early, 'SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71', (a) => a.detail.keys.length === 4), '[ب] وحضورها مبكّراً شذوذ (القاعدة 25)');
  eq([sc(early).brightnessLock.status, sc(early).header.powerSaveStateStatus], [KS.PRESENT, KS.PRESENT], '[ب] وحالة كل منها PRESENT (حاضر) رغم الشذوذ — لا يُخفى');
  const nul = read(null, GOOD());
  eq([sc(nul).state, sc(nul).powerSaveBasis, sc(nul).batteryWindowBasis], [SS.UNDETERMINED_NO_FIELDS_VERSION, 'UNDETERMINED_NO_FIELDS_VERSION', BW.DECLARED_IN_PAYLOAD], '[ب] بلا ختم: القسم UNDETERMINED وأساس توفير الطاقة UNDETERMINED؛ والنافذة المعلَنة في الحمولة تُقرأ كما أُعلِنت (البيانات المعلَنة لا تحتاج ختماً)');
  const nulBare = read(null, {header: {batteryLevelStart: 43}});
  eq([sc(nulBare).batteryWindowBasis, sc(nulBare).powerSaveBasis], [BW.NO_VALID_WINDOW, 'UNDETERMINED_NO_FIELDS_VERSION'], '[ب] بلا ختم وبلا نافذة معلَنة: لا نافذة صالحة (لا يُفترَض 25 ولا 30–85)');
  // مفاتيح جديدة حاضرة بقيمة null تحت < 71: ليست حضوراً مبكّراً (null = غائب في JSON) — لا شذوذ ولا إدراج في unexpectedKeys
  const nullKeys = read(70, {header: {isPowerSaveMode: false, batteryLevelStart: 43, powerSaveState: null}, root: {powerSaveMode: false, powerSaveState: null}, footer: {brightnessLock: null, batteryWindowPct: null}});
  eq([sc(nullKeys).unexpectedKeys, scOnly(nullKeys)], [[], []], '[ب] ختم 70 ومفاتيح P6-13 بقيمة null: لا تُحسب حضوراً مبكّراً (لا شذوذ SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71)');
  // حضور read_failed مبكّراً (ختم 70) بلا المنطقيّ: «read_failed ⇒ غائب» عقد ≥ 71 وحده؛ فالمنطقيّ هنا ABSENT لا ABSENT_DECLARED، والحضور المبكّر شذوذ
  const earlyRf = read(70, {header: {powerSaveState: 'read_failed', batteryLevelStart: 43}, root: {powerSaveState: 'read_failed'}});
  eq([sc(earlyRf).header.isPowerSaveModeStatus, sc(earlyRf).root.powerSaveModeStatus], [KS.ABSENT, KS.ABSENT], '[ب] ختم 70 مع read_failed مبكّر بلا المنطقيّ: ABSENT (السبب المُعلَن عقدُ ≥ 71 وحده)');
  ok(hasCode(earlyRf, 'SCAN_CONDITIONS_KEYS_PRESENT_BEFORE_FV71', (x) => x.detail.keys.length === 2), '[ب] ختم 70 مع read_failed مبكّر: شذوذ الحضور المبكّر بمفتاحيه');
  for (const fv of [71, 72, 100]) {
    const o = read(fv, GOOD());
    eq([sc(o).state, sc(o).powerSaveBasis, sc(o).batteryWindowBasis, scOnly(o)], [SS.READ, 'STATE_DECLARED', BW.DECLARED_IN_PAYLOAD, []], `[ب] ختم ${fv}: مقروء بلا شذوذ، والنافذة معلَنة في الحمولة`);
  }
}

// ═══ جـ) powerSaveState: مصفوفة القيم × الموضعان × المنطقيّ ═══════════════════════════════════════════════════════
{
  // الجدول: [الحالة، المنطقيّ، الشذوذ المتوقَّع على المنطقيّ]
  const MATRIX = [
    ['off', false, null], ['off', true, 'POWER_SAVE_BOOLEAN_DISAGREES_WITH_STATE'], ['off', undefined, 'POWER_SAVE_BOOLEAN_ABSENT_FOR_STATE'],
    ['on', true, null], ['on', false, 'POWER_SAVE_BOOLEAN_DISAGREES_WITH_STATE'], ['on', undefined, 'POWER_SAVE_BOOLEAN_ABSENT_FOR_STATE'],
    ['read_failed', undefined, null], ['read_failed', true, 'POWER_SAVE_BOOLEAN_PRESENT_FOR_READ_FAILED'], ['read_failed', false, 'POWER_SAVE_BOOLEAN_PRESENT_FOR_READ_FAILED'],
  ];
  eq(MATRIX.length, 9, '[جـ] القيم الثلاث × المنطقيّ الثلاث = تسع خلايا كلّها مُجرَّبة');
  for (const where of ['header', 'root']) {
    for (const [state, bool, expected] of MATRIX) {
      const g = GOOD();
      g.header.powerSaveState = state;
      g.root.powerSaveState = state;
      const boolHolder = where === 'header' ? g.header : g.root;
      const boolKey = where === 'header' ? 'isPowerSaveMode' : 'powerSaveMode';
      const other = where === 'header' ? g.root : g.header;
      const otherKey = where === 'header' ? 'powerSaveMode' : 'isPowerSaveMode';
      // الموضع الآخر يبقى متّسقاً مع الحالة كي لا يلوّث الحكم
      if (state === 'read_failed') delete other[otherKey]; else other[otherKey] = state === 'on';
      if (bool === undefined) delete boolHolder[boolKey]; else boolHolder[boolKey] = bool;
      const o = read(71, g);
      const got = scOnly(o);
      eq(got, expected === null ? [] : [expected], `[جـ] ${where}: ${state} مع المنطقيّ ${bool === undefined ? 'غائباً' : bool}: ${expected === null ? 'لا شذوذ' : expected}`);
      const loc = sc(o)[where];
      eq(loc.powerSaveState, state, `[جـ] ${where}: القيمة ${state} كما شُحنت`);
      eq([loc.powerSaveStateState.recognized, loc.powerSaveStateState.kind], [true, state], `[جـ] ${where}: ${state} معروفة`);
      eq([loc[boolKey], loc[`${boolKey}Status`] === KS.PRESENT], [bool === undefined ? null : bool, bool !== undefined], `[جـ] ${where}: المنطقيّ ${bool === undefined ? 'غائب (لا false مختلَق)' : bool}`);
      // حالة الغياب: مع read_failed يشرحه الإعلان ⟵ ABSENT_DECLARED؛ مع off/on غياب بلا سبب ⟵ ABSENT (وشذوذه أعلاه)
      if (bool === undefined) eq(loc[`${boolKey}Status`], state === 'read_failed' ? KS.ABSENT_DECLARED : KS.ABSENT, `[جـ] ${where}: حالة غياب المنطقيّ مع ${state}`);
    }
  }
  // قيم خارج المفردة تُعلَن ولا تُلحَق بأقربها، ولا حكم على المنطقيّ حينها
  for (const v of ['standby', 'OFF', 'On', '', 'read_failed:x']) {
    const g = GOOD();
    g.header.powerSaveState = v;
    const o = read(71, g);
    eq(sc(o).header.powerSaveStateState.recognized, false, `[جـ] powerSaveState="${v}": غير معروفة`);
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === v), `[جـ] "${v}": تُعلَن شذوذاً`);
    ok(!codes(o).some((c) => c.startsWith('POWER_SAVE_BOOLEAN')), `[جـ] "${v}": لا حكم على المنطقيّ`);
  }
  // الغياب
  for (const where of ['header', 'root']) {
    const g = GOOD();
    delete (where === 'header' ? g.header : g.root).powerSaveState;
    const o = read(71, g);
    eq([sc(o)[where].powerSaveStateStatus, sc(o)[where].powerSaveState], [KS.ABSENT, null], `[جـ] ${where}: powerSaveState غائب في ≥ 71: ABSENT بلا قيمة`);
    ok(hasCode(o, 'POWER_SAVE_STATE_ABSENT', (a) => a.detail.where === where), `[جـ] ${where}: شذوذ «غائب في ≥ 71»`);
    ok(o.absences.ABSENT.some((p) => p.endsWith(`scanConditions.${where}.powerSaveStateStatus`)), `[جـ] ${where}: يظهر في «غياب بلا سبب» أعلى المخرَج`);
  }
  // نوع خاطئ
  const wrong = GOOD();
  wrong.header.powerSaveState = 5;
  eq(sc(read(71, wrong)).header.powerSaveStateStatus, KS.WRONG_TYPE, '[جـ] powerSaveState رقم: WRONG_TYPE');
  const wrongBool = GOOD();
  wrongBool.header.isPowerSaveMode = 'false';
  const oWB = read(71, wrongBool);
  eq(sc(oWB).header.isPowerSaveModeStatus, KS.WRONG_TYPE, '[جـ] المنطقيّ نصّ: WRONG_TYPE (ولا حكم علاقة عليه)');
  ok(!codes(oWB).some((c) => c.startsWith('POWER_SAVE_BOOLEAN')), '[جـ] ولا شذوذ علاقة مع النوع الخاطئ');
  // الترويسة والجذر يختلفان
  const dis = GOOD();
  dis.root.powerSaveState = 'on';
  dis.root.powerSaveMode = true;
  ok(hasCode(read(71, dis), 'POWER_SAVE_STATE_HEADER_ROOT_DISAGREE', (a) => a.detail.header === 'off' && a.detail.root === 'on'), '[جـ] الترويسة off والجذر on: شذوذ اختلاف الموضعين');
  // ما يصل فعلاً (القسم): off وحدها في فحص مكتمل — on/read_failed تُقرآن إن وصلتا (لا شذوذ وحدهما)
  for (const st of ['on', 'read_failed']) {
    const g = GOOD();
    g.header.powerSaveState = st; g.root.powerSaveState = st;
    if (st === 'on') { g.header.isPowerSaveMode = true; g.root.powerSaveMode = true; } else { delete g.header.isPowerSaveMode; delete g.root.powerSaveMode; }
    eq(scOnly(read(71, g)), [], `[جـ] ${st} متّسقة الموضعين والمنطقيّين: لا شذوذ (تصل إن خُفّفت البوّابة، القسم «نقاط وجدتها» ٣)`);
  }
}

// ═══ د) brightnessLock ═══════════════════════════════════════════════════════════════════════════════════════════
{
  const withLock = (lock) => { const g = GOOD(); if (lock === undefined) delete g.footer.brightnessLock; else g.footer.brightnessLock = lock; return g; };
  const bl = (o) => sc(o).brightnessLock;
  // applied: value وmethod لازمان
  let o = read(71, withLock({state: 'applied', value: 0.5, method: 'window_attribute'}));
  eq([scOnly(o), bl(o).stateState.kind, bl(o).value, bl(o).valueStatus, bl(o).method, bl(o).methodStatus], [[], 'applied', 0.5, KS.PRESENT, 'window_attribute', KS.PRESENT], '[د] applied + value + method: سليمة');
  o = read(71, withLock({state: 'applied', method: 'window_attribute'}));
  eq([scOnly(o), bl(o).valueStatus], [['BRIGHTNESS_VALUE_ABSENT_FOR_APPLIED'], KS.ABSENT], '[د] applied بلا value: شذوذ (النجاح بلا القيمة المطلوبة)');
  o = read(71, withLock({state: 'applied', value: 0.5}));
  eq([scOnly(o), bl(o).methodStatus], [['BRIGHTNESS_METHOD_ABSENT_FOR_APPLIED'], KS.ABSENT], '[د] applied بلا method: شذوذ');
  // apply_failed:<نصّ>: حضور value/method غير محدَّد في القسم ⟵ كلاهما مقبول
  for (const lock of [{state: 'apply_failed:SecurityException: x', value: 0.5, method: 'system_setting'}, {state: 'apply_failed:boom'}, {state: 'apply_failed:boom', value: 0.2}]) {
    o = read(71, withLock(lock));
    eq([scOnly(o), bl(o).stateState.kind, bl(o).stateState.detail], [[], 'apply_failed', lock.state.slice('apply_failed:'.length)], `[د] ${JSON.stringify(lock)}: apply_failed بنصّ الخطأ — لا يُفرَض حضور value/method (القسم لا يحدّده)`);
  }
  o = read(71, withLock({state: 'apply_failed:boom'}));
  eq([bl(o).valueStatus, bl(o).methodStatus], [KS.ABSENT, KS.ABSENT], '[د] apply_failed بلا value/method: ABSENT (لا صفر ولا ABSENT_DECLARED لأن القسم لا يعلن سبب غيابهما)');
  // not_attempted:<سبب>: value وmethod غائبان (لا صفر)
  o = read(71, withLock({state: 'not_attempted:user_disabled'}));
  eq([scOnly(o), bl(o).stateState.kind, bl(o).valueStatus, bl(o).methodStatus, bl(o).value, bl(o).method], [[], 'not_attempted', KS.ABSENT_DECLARED, KS.ABSENT_DECLARED, null, null], '[د] not_attempted بلا value/method: ABSENT_DECLARED بلا صفر ولا شذوذ');
  ok(o.absences.ABSENT_DECLARED.some((p) => p.endsWith('scanConditions.brightnessLock.valueStatus')) && o.absences.ABSENT_DECLARED.some((p) => p.endsWith('scanConditions.brightnessLock.methodStatus')), '[د] وتظهر في الغياب المُعلَن أعلى المخرَج');
  o = read(71, withLock({state: 'not_attempted:why', value: 0, method: 'window_attribute'}));
  eq(scOnly(o), ['BRIGHTNESS_VALUE_WITH_NOT_ATTEMPTED', 'BRIGHTNESS_METHOD_WITH_NOT_ATTEMPTED'], '[د] not_attempted مع value=0 وmethod: تناقض معلن («لا صفر»)');
  // state خارج المفردة: «applied» وحدها حرفية؛ وapply_failed/not_attempted بلا «:» غير معروفتين
  for (const st of ['apply_failed', 'not_attempted', 'APPLIED', 'ok', '', 'applied:x']) {
    o = read(71, withLock({state: st, value: 0.5, method: 'window_attribute'}));
    eq(bl(o).stateState.recognized, false, `[د] state="${st}": غير معروفة`);
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === st), `[د] state="${st}": تُعلَن شذوذاً`);
    ok(!codes(o).some((c) => c.startsWith('BRIGHTNESS_VALUE_') || c.startsWith('BRIGHTNESS_METHOD_')), `[د] state="${st}": لا حكم علاقة على value/method`);
  }
  // الطريقتان وغيرهما
  for (const m of ['window_attribute', 'system_setting']) {
    o = read(71, withLock({state: 'applied', value: 0.5, method: m}));
    eq([bl(o).methodState.recognized, bl(o).methodState.kind, scOnly(o)], [true, m, []], `[د] method=${m}: معروفة`);
  }
  o = read(71, withLock({state: 'applied', value: 0.5, method: 'adb'}));
  eq(bl(o).methodState.recognized, false, '[د] method=adb: غير معروفة');
  ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === 'adb'), '[د] وتُعلَن');
  // المدى [0، 1] بالحدود
  for (const v of [0, 1, 0.0001, 0.9999]) eq(scOnly(read(71, withLock({state: 'applied', value: v, method: 'window_attribute'}))), [], `[د] value=${v} ضمن [0، 1]: سليمة (0 صفر حقيقي لا غياب)`);
  for (const v of [-0.0001, 1.0001, 128, -1]) {
    o = read(71, withLock({state: 'applied', value: v, method: 'window_attribute'}));
    ok(hasCode(o, 'BRIGHTNESS_VALUE_OUT_OF_RANGE', (a) => a.detail.value === v), `[د] value=${v} خارج [0، 1]: شذوذ`);
  }
  // الأنواع والغياب والمفاتيح الغريبة
  o = read(71, withLock({state: 'applied', value: '0.5', method: 'window_attribute'}));
  eq(bl(o).valueStatus, KS.WRONG_TYPE, '[د] value نصّ: WRONG_TYPE');
  o = read(71, withLock({state: 5, value: 0.5, method: 'window_attribute'}));
  eq(bl(o).stateStatus, KS.WRONG_TYPE, '[د] state رقم: WRONG_TYPE');
  o = read(71, withLock({value: 0.5, method: 'window_attribute'}));
  ok(hasCode(o, 'BRIGHTNESS_LOCK_STATE_ABSENT') && bl(o).stateStatus === KS.ABSENT, '[د] state غائب: شذوذ');
  o = read(71, withLock(undefined));
  eq([bl(o).status, hasCode(o, 'BRIGHTNESS_LOCK_ABSENT')], [KS.ABSENT, true], '[د] brightnessLock كلّه غائب في ≥ 71: ABSENT وشذوذ (غائب في ≥ 71 ⇒ شذوذ)');
  o = read(71, withLock('applied'));
  eq(bl(o).status, KS.WRONG_TYPE, '[د] brightnessLock نصّ: WRONG_TYPE');
  o = read(71, withLock({state: 'applied', value: 0.5, method: 'window_attribute', extra: 1}));
  ok(hasCode(o, 'BRIGHTNESS_LOCK_UNKNOWN_KEY', (a) => a.detail.keys[0] === 'extra'), '[د] مفتاح غريب في brightnessLock: شذوذ (القاعدة 25)');
  // الاسم في fieldsNotInFile يُقرأ NOT_IN_FILE (القاعدة 22)
  const nif = GOOD();
  delete nif.footer.brightnessLock;
  nif.footer.fieldsNotInFile = ['brightnessLock'];
  eq(bl(read(71, nif)).status, KS.NOT_IN_FILE, '[د] مُسمّى في fieldsNotInFile: NOT_IN_FILE لا ABSENT');
}

// ═══ هـ) batteryWindowPct: يعلنها التطبيق، والخادم لا يحمل 30 ولا 85 ═════════════════════════════════════════════
{
  const withWin = (w, extra = {}) => { const g = GOOD(); if (w === undefined) delete g.footer.batteryWindowPct; else g.footer.batteryWindowPct = w; Object.assign(g.header, extra); return g; };
  const bw = (o) => sc(o).batteryWindow;
  let o = read(71, withWin({minPct: 40, maxPct: 70}));
  eq([bw(o).minPct, bw(o).maxPct, sc(o).batteryWindowBasis, scOnly(o)], [40, 70, BW.DECLARED_IN_PAYLOAD, []], '[هـ] نافذة 40–70 (لا 30–85): تُقرأ كما أُعلِنت — الخادم لا يحمل نسخة من الرقمين');
  eq(sc(o).startLevelVsWindow, SV.WITHIN, '[هـ] وبداية 43 داخل 40–70');
  o = read(71, withWin({minPct: 44, maxPct: 70}));
  eq(sc(o).startLevelVsWindow, SV.BELOW_MIN, '[هـ] النافذة 44–70 والبداية 43: BELOW_MIN (الحكم بما أُعلِن، لا بـ30)');
  o = read(71, withWin({minPct: 0, maxPct: 100}));
  eq([scOnly(o), sc(o).batteryWindowBasis], [[], BW.DECLARED_IN_PAYLOAD], '[هـ] 0–100: حدّان مشروعان');
  o = read(71, withWin({minPct: 50, maxPct: 50}));
  eq([scOnly(o), sc(o).batteryWindowBasis], [[], BW.DECLARED_IN_PAYLOAD], '[هـ] min = max: مشروع');
  o = read(71, withWin({minPct: 60, maxPct: 59}));
  eq([scOnly(o), sc(o).batteryWindowBasis, sc(o).startLevelVsWindow], [['BATTERY_WINDOW_MIN_ABOVE_MAX'], BW.NO_VALID_WINDOW, SV.NO_WINDOW], '[هـ] min > max: شذوذ، ولا نافذة صالحة (لا حكم)');
  for (const [k, v] of [['minPct', -1], ['minPct', 101], ['maxPct', -1], ['maxPct', 101]]) {
    o = read(71, withWin({minPct: 30, maxPct: 85, [k]: v}));
    ok(hasCode(o, 'BATTERY_WINDOW_OUT_OF_RANGE', (a) => a.detail.key === k && a.detail.value === v), `[هـ] ${k}=${v} خارج [0، 100]: شذوذ`);
    eq(sc(o).batteryWindowBasis, BW.NO_VALID_WINDOW, `[هـ] ${k}=${v}: لا نافذة صالحة`);
  }
  for (const missing of ['minPct', 'maxPct']) {
    const w = {minPct: 30, maxPct: 85};
    delete w[missing];
    o = read(71, withWin(w));
    ok(hasCode(o, 'BATTERY_WINDOW_KEY_ABSENT', (a) => a.detail.key === missing), `[هـ] ${missing} غائب: شذوذ`);
    eq([bw(o)[`${missing}Status`], bw(o)[missing], sc(o).batteryWindowBasis], [KS.ABSENT, null, BW.NO_VALID_WINDOW], `[هـ] ${missing}: ABSENT بلا قيمة، ولا نافذة صالحة`);
  }
  o = read(71, withWin({minPct: '30', maxPct: 85.5}));
  eq([bw(o).minPctStatus, bw(o).maxPctStatus], [KS.WRONG_TYPE, KS.WRONG_TYPE], '[هـ] نصّ أو كسر: WRONG_TYPE (أعداد صحيحة)');
  o = read(71, withWin(undefined));
  eq([bw(o).status, hasCode(o, 'BATTERY_WINDOW_ABSENT'), sc(o).batteryWindowBasis, sc(o).startLevelVsWindow], [KS.ABSENT, true, BW.NO_VALID_WINDOW, SV.NO_WINDOW], '[هـ] النافذة غائبة في ≥ 71: ABSENT وشذوذ — لا يُفترَض 25 ولا 30–85');
  o = read(71, withWin('x'));
  eq(bw(o).status, KS.WRONG_TYPE, '[هـ] batteryWindowPct نصّ: WRONG_TYPE');
  o = read(71, withWin({minPct: 30, maxPct: 85, extra: 1}));
  ok(hasCode(o, 'BATTERY_WINDOW_UNKNOWN_KEY', (a) => a.detail.keys[0] === 'extra'), '[هـ] مفتاح غريب: شذوذ');
}

// ═══ و) بداية الشحن مقابل النافذة — بالحدود بالمساواة، وصف بلا حكم ═══════════════════════════════════════════════
{
  const lvl = (fv, level, window, tsState) => {
    const g = GOOD();
    if (level === undefined) delete g.header.batteryLevelStart; else g.header.batteryLevelStart = level;
    if (window === undefined) delete g.footer.batteryWindowPct; else g.footer.batteryWindowPct = window;
    if (fv < 71) { delete g.header.powerSaveState; delete g.root.powerSaveState; delete g.footer.brightnessLock; delete g.footer.batteryWindowPct; }
    return read(fv, {...g, tsState});
  };
  const W = {minPct: 30, maxPct: 85};
  for (const [level, expected] of [[30, SV.WITHIN], [29, SV.BELOW_MIN], [85, SV.WITHIN], [86, SV.ABOVE_MAX], [0, SV.BELOW_MIN], [100, SV.ABOVE_MAX], [57, SV.WITHIN]]) {
    eq(sc(lvl(71, level, W)).startLevelVsWindow, expected, `[و] ختم 71، نافذة 30–85، بداية ${level}: ${expected}`);
  }
  eq(sc(lvl(71, -1, W)).startLevelVsWindow, SV.START_LEVEL_UNKNOWN, '[و] بداية -1 (حارس المجهول): START_LEVEL_UNKNOWN لا BELOW_MIN');
  eq([sc(lvl(71, -1, W)).batteryLevelStart, sc(lvl(71, -1, W)).batteryLevelStartStatus], [-1, KS.PRESENT], '[و] والقيمة -1 تُقرأ كما شُحنت (الخامّ كما اليوم) لا تُمحى');
  eq(sc(lvl(71, undefined, W)).startLevelVsWindow, SV.START_LEVEL_UNKNOWN, '[و] بداية غائبة: START_LEVEL_UNKNOWN');
  eq(sc(lvl(71, undefined, W)).batteryLevelStartStatus, KS.ABSENT, '[و] حالتها ABSENT (لا سبب معلَن)');
  eq(sc(lvl(71, undefined, W, 'footer_backup')).batteryLevelStartStatus, KS.ABSENT_DECLARED, '[و] ومع timeSeriesState=footer_backup (ملفّ مستردّ من التذييل): ABSENT_DECLARED بسببه');
  eq(sc(lvl(71, undefined, W, 'file')).batteryLevelStartStatus, KS.ABSENT, '[و] ومع timeSeriesState=file: ABSENT (الملفّ سليم والبداية غائبة)');
  for (const level of [101, -2, 255]) {
    const o = lvl(71, level, W);
    eq(sc(o).startLevelVsWindow, SV.START_LEVEL_INVALID, `[و] بداية ${level} خارج [-1، 100]: START_LEVEL_INVALID`);
    ok(hasCode(o, 'BATTERY_LEVEL_START_OUT_OF_RANGE', (a) => a.detail.value === level), `[و] بداية ${level}: شذوذ`);
  }
  eq(sc(lvl(71, '43', W)).startLevelVsWindow, SV.START_LEVEL_INVALID, '[و] بداية نصّ: START_LEVEL_INVALID (WRONG_TYPE)');
  eq(sc(lvl(71, 43, undefined)).startLevelVsWindow, SV.NO_WINDOW, '[و] نافذة غائبة: NO_WINDOW');
  // القديم: حدّ أدنى 25 ولا أعلى
  for (const [level, expected] of [[25, SV.WITHIN], [24, SV.BELOW_MIN], [100, SV.WITHIN], [99, SV.WITHIN]]) {
    const o = lvl(70, level, undefined);
    eq([sc(o).batteryWindowBasis, sc(o).startLevelVsWindow], [BW.LEGACY_FIXED_MIN_NO_MAX, expected], `[و] ختم 70، بداية ${level}: ${expected} (25 ولا أعلى)`);
  }
  eq(sc(lvl(70, -1, undefined)).startLevelVsWindow, SV.START_LEVEL_UNKNOWN, '[و] ختم 70 وبداية -1: مجهول');
  const noStamp = read(null, {header: {batteryLevelStart: 43}});
  eq(sc(noStamp).startLevelVsWindow, SV.NO_WINDOW, '[و] بلا ختم: NO_WINDOW (لا يُفترَض 25 ولا غيره)');
}

// ═══ ز) المسار الكامل بالقارئ الحقيقي على حمولات المُنتِج الثلاث (القاعدة 37) ═══════════════════════════════════════
{
  const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
  const FILES = {
    '11ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json',
    '13ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json',
    '16ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json',
  };
  const P = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'))]));
  const RD = Object.fromEntries(Object.keys(P).map((k) => [k, R.readFv68(clone(P[k]))]));
  for (const k of Object.keys(P)) {
    eq(RD[k].readerError, undefined, `[ز][${k}] القارئ لم يرمِ`);
    eq([RD[k].fieldsVersion, RD[k].applicable, scOnly(RD[k])], [71, true, []], `[ز][${k}] الختم 71 مُنطبِق، ولا شذوذ في الظروف`);
    eq(sc(RD[k]).state, SS.READ, `[ز][${k}] مقروء`);
    eq([sc(RD[k]).batteryWindow.minPct, sc(RD[k]).batteryWindow.maxPct, sc(RD[k]).startLevelVsWindow], [30, 85, SV.WITHIN], `[ز][${k}] النافذة 30–85 في التذييل كما أُعلِنت، وبداية الشحن 43 داخلها`);
  }
  for (const k of ['11ch', '13ch']) {
    eq([sc(RD[k]).header.powerSaveState, sc(RD[k]).root.powerSaveState, sc(RD[k]).header.isPowerSaveMode, sc(RD[k]).root.powerSaveMode], ['off', 'off', false, false], `[ز][${k}] off في الموضعين والمنطقيّان false`);
  }
  eq([sc(RD['16ch']).header.powerSaveState, sc(RD['16ch']).header.isPowerSaveModeStatus, sc(RD['16ch']).root.powerSaveModeStatus, sc(RD['16ch']).header.isPowerSaveMode, sc(RD['16ch']).root.powerSaveMode],
      ['read_failed', KS.ABSENT_DECLARED, KS.ABSENT_DECLARED, null, null], '[ز][16ch] read_failed والمنطقيّان غائبان بسببه (ABSENT_DECLARED لا false ولا ABSENT) — كما شحنهما المُنتِج');
  const bl = (k) => sc(RD[k]).brightnessLock;
  eq([bl('11ch').stateState.kind, bl('11ch').stateState.detail, bl('11ch').valueStatus, bl('11ch').methodStatus], ['not_attempted', 'value_not_decided', KS.ABSENT_DECLARED, KS.ABSENT_DECLARED], '[ز][11ch] حالة الإنتاج اليوم not_attempted:value_not_decided بلا value ولا method: غائبان بسببه');
  eq([bl('13ch').stateState.kind, bl('13ch').value, bl('13ch').methodState.kind], ['applied', 0.5, 'window_attribute'], '[ز][13ch] السطوع مُثبَّت: applied بـ0.5 وwindow_attribute');
  eq([bl('16ch').stateState.kind, bl('16ch').stateState.detail, bl('16ch').value, bl('16ch').methodState.kind], ['apply_failed', 'the window refused the brightness attribute', 0.4, 'window_attribute'], '[ز][16ch] فشل تثبيت السطوع بنصّه، ومعه value وmethod (القارئ يقبل الحالتين)');
  // المفاتيح الثلاثة تحضر معاً في كل حمولة ≥ 71 (القسم): عدّ مستقلّ من الحمولة نفسها
  for (const k of Object.keys(P)) {
    const ts = P[k].timeSeries;
    eq([ts.header.powerSaveState !== undefined, P[k].powerSaveState !== undefined, ts.footer.brightnessLock !== undefined, ts.footer.batteryWindowPct !== undefined], [true, true, true, true], `[ز][${k}] المفاتيح الثلاثة حاضرة معاً (الترويسة والجذر والتذييل)`);
    eq('batteryWindowPct' in P[k], false, `[ز][${k}] وbatteryWindowPct في التذييل لا في جذر الحمولة (موضع ملتبس في جدول القسم، حسمته عيّنات المُنتِج)`);
  }
  const before = JSON.stringify(P['11ch']);
  R.readFv68(P['11ch']);
  eq(JSON.stringify(P['11ch']), before, '[ز] readFv68 لا تعدّل الحمولة');
}

console.log(`\nfv71ScanConditionsReader.test.js: ${n}/${n} assertions passed`);
