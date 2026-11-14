'use strict';

// fv71TouchGridReader.test.js — قارئ M-02 في fv71 (الشبكة الجديدة بالخامّ، الخيار «ب»)، S-M02، 2026-10-18 +03.
//
// ما يثبّته (الحاكم: docs/FV71_CONTRACT_SECTION.md ف-01 إلى ف-03؛ والتصميم §6.6 حيث يسكت):
//   أ) المفاتيح الاثنان والثلاثون وأنواعها وحضورها **مكتوبة باليد هنا من القسم** لا من fv68Names (القاعدة 30)، ويُثبَت أن كل اسم يظهر في نصّ القسم نفسه.
//   ب) gridBasis بكل قيمه الممكنة (القاعدة 30): من الختم وحده — 67..70 ⟵ FIXED_8X15، ≥ 71 ⟵ MM_TARGET، بلا ختم ⟵ UNDETERMINED — ولا يتبع gridCols/gridRows.
//   جـ) كتلة path: حالتها بحسب الختم، وحضور مفاتيحها تحت ختم < 71 شذوذ، ومفتاح غير معروف في ≥ 71 شذوذ.
//   د) كل مفتاح: غيابه (ALWAYS ⇒ شذوذ · REASONED ⇒ شذوذ بلا سبب، وبسببه حالة معلنة · اختياري بالتصميم ⇒ حالة)، وبنوع خاطئ WRONG_TYPE، وبقيمه المعدَّدة كلّها.
//   هـ) الخطوط والعلامات والسقف والعلاقات (totalCells وauto_complete والمجموع) وكل شذوذ منها.
//   و) جواب M-02 اليدوي (touchGridAnswer): pass بلا measurements وpass بخامّ سابق (بعد NeuralChek@5f90ce1، أمر المنسّق 2026-10-18) — حالة صريحة لا خطأ.
//   ز) ما يخصّ المسار الكامل (القاعدة 37): القارئ الحقيقي على الحمولة الكاملة المبنيّة من العقد، لا قارئ مستبدَل؛ وعزل ANALYSIS_ERROR (الوحيد المستبدَل: touchPath، لإثبات أنه لا يُسقط بقيّة القراءات).
//
// **الحمولات هنا من المُنتِج (مزامنة 2026-10-18؛ استُبدلت بتوليد NeuralChek@3810146 في 2026-10-22):** خطّ الأساس COMPLETE = M-02 في عيّنة 11ch (pass · auto_complete · 18×33 = 594 خليّة منها 188 مطلوبة · 858 نقطة؛ كانت 12×24 = 288 و624 على f9e0571/4c0102c) وDEAD = M-02 في عيّنة 13ch (fail · ثقب كاميرا بأربع خلايا [8, 9, 26, 27] · 18×35 · 194 مطلوبة · قفزتان · راحة يد ·
// علامتا edge_exit)، وCAPPED = 16ch (15,000 نقطة · reached) — نسخ حرفية من NeuralChek@3810146 (fv71-app-request-payload-derived-from-…). **الأرقام المكتوبة باليد في الكتلة «ز» حلّت (القاعدة 23) محلّ أرقام العيّنات السابقة بعدٍّ مستقلّ من الملفّ (594 و858 و188 و194 و432 و406).** وما لا تغطّيه (مفاتيح مفقودة، أسباب غياب، قيم معدَّدة أخرى) يُختبَر بحمولات **معدَّلة منها** تُسمّى هنا
// وتُعدَّل بسطر مكتوب (لا عيّنات مُنتِج): القاعدة 41 تُرضيها الكتلة «ي» والاختبار fv71ProducerSamples.test.js (القارئ الحقيقي على الثلاث كما هي).
// حلّت هذه محلّ عيّنتين بنيتُهما من العقد (scripts/lib/fv71M02Synthetic.js — حُذفت، القاعدة 23). ما اختلف: مفاتيح الكثافة الخمسة ALWAYS (لا REASONED) وعناصر densityCheck معدَّدة [ق] وresampledFlagState معدَّدة [ق] وpathCap.reached/pointsDropped.
//
// Run: node functions/test/fv71TouchGridReader.test.js

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
const PS = N.TOUCH_PATH_STATE;
const GB = N.TOUCH_GRID_GRID_BASIS;
const AS = N.TOUCH_GRID_ANSWER_STATE;
const REL = N.TOUCH_GRID_PASS_RAW_RELATION;

// ─── أدوات ────────────────────────────────────────────────────────────────────────────────────
const manualFp = (fv, rows) => ({timeSeries: {footer: fv === null ? {} : {fieldsVersion: fv}}, functionalResults: [], manualResults: rows});
const m02Fp = (fv, meas, status = 'pass') => manualFp(fv, [{testId: 'M-02', categoryName: 'display', status, ...(meas === undefined ? {} : {measurements: meas})}]);
const read = (fv, meas, status) => R.readFv68(m02Fp(fv, meas, status));
const tgOf = (o) => o.measurements.items.find((i) => i.testId === 'M-02').touchGrid;
const own = (o) => o.anomalies.filter((a) => a.section.startsWith('manualResults'));
const codes = (o) => own(o).map((a) => a.code);
const hasCode = (o, code, pred) => own(o).some((a) => a.code === code && (pred === undefined || pred(a)));
// حمولات المُنتِج الثلاث (نسخ حرفية، sha256 في fv68AppPayloadGoldenCopy.test.js): تُقرأ مرّة واحدة وتُستنسخ عند كل استعمال
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const PRODUCER_FILES = {
  '11ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json',
  '13ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json',
  '16ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json',
};
const PRODUCER = Object.fromEntries(Object.entries(PRODUCER_FILES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'))]));
const m02Of = (k) => PRODUCER[k].manualResults.find((m) => m.testId === 'M-02').measurements;
const COMPLETE = () => clone(m02Of('11ch'));
const DEAD = () => clone(m02Of('13ch'));
const CAPPED = () => clone(m02Of('16ch'));
const BASE = 'manualResults[0].measurements';


// ═══ أ) المفاتيح بأنواعها وحضورها — مكتوبة باليد من القسم (القاعدة 30) ════════════════════════════════════════════
{
  const HAND = {
    // ف-02 السطح: عدد صحيح، «حاضرة دائماً» · الشاشة: عدد صحيح، غيابها بسببه · الكثافة: xdpi/ydpi/pxPerMm عشرية وdensityDpi عدد صحيح ونصّ densitySource وقائمة densityCheck «حاضرة دائماً»
    surfaceWidthPx: ['int', 'ALWAYS'], surfaceHeightPx: ['int', 'ALWAYS'], surfaceOriginXPx: ['int', 'ALWAYS'], surfaceOriginYPx: ['int', 'ALWAYS'],
    displayWidthPx: ['int', 'REASONED'], displayHeightPx: ['int', 'REASONED'], modePhysicalWidthPx: ['int', 'REASONED'], modePhysicalHeightPx: ['int', 'REASONED'],
    // **تغيّر في مزامنة fv71:** مفاتيح الكثافة الخمسة ALWAYS — قائمة absentFieldReasons في قسم f9e0571 لا تسمّيها، وعيّنات المُنتِج الثلاث تحملها
    xdpi: ['number', 'ALWAYS'], ydpi: ['number', 'ALWAYS'], densityDpi: ['int', 'ALWAYS'], pxPerMm: ['number', 'ALWAYS'], densitySource: ['string', 'ALWAYS'],
    densityCheck: ['array', 'ALWAYS'],
    // الخليّة: «حاضرة دائماً» · الحالة النهائية: «حاضرة دائماً» (untouchedCells [] عند الاكتمال، cutoutCells [] = لا مقصاة)
    cellTargetMm: ['number', 'ALWAYS'], cellWidthPx: ['number', 'ALWAYS'], cellHeightPx: ['number', 'ALWAYS'],
    untouchedCells: ['array', 'ALWAYS'], cutoutCells: ['array', 'ALWAYS'],
    // الحواف: API < 29 ⟵ غائب بسببه
    gestureInsetsPx: ['object', 'REASONED'], mandatoryGestureInsetsPx: ['object', 'REASONED'], exclusionRectsPx: ['array', 'REASONED'], systemBarsHidden: ['boolean', 'REASONED'],
    cutoutRectsPx: ['array', 'REASONED'], roundedCornerRadiiPx: ['object', 'ONE_OF_PAIR'], roundedCornersState: ['string', 'ONE_OF_PAIR'],
    // N71-01 وف-03
    absentFieldReasons: ['object', 'BY_DESIGN_OPTIONAL'], strokes: ['array', 'ALWAYS'], unbufferedDispatch: ['boolean', 'REASONED'], resampledFlagState: ['string', 'ALWAYS'],
    displayedSuspects: ['array', 'BY_DESIGN_OPTIONAL'], pathCap: ['object', 'ALWAYS'],
  };
  eq(Object.keys(HAND).length, 32, '[أ] اثنان وثلاثون مفتاحاً جديداً (ف-02: 26 مفتاحاً بزوج الزوايا · ف-03: strokes وunbufferedDispatch وresampledFlagState وdisplayedSuspects وpathCap · وabsentFieldReasons)');
  eq(Object.keys(N.TOUCH_PATH_FIELD_SPEC).sort(), Object.keys(HAND).sort(), '[أ] مفاتيح TOUCH_PATH_FIELD_SPEC = المكتوبة باليد من القسم (لا مفتاح زائد ولا ناقص)');
  eq(Object.fromEntries(Object.entries(N.TOUCH_PATH_FIELD_SPEC).map(([k, v]) => [k, [v.type, v.presence]])), HAND, '[أ] أنواعها وحضورها كما في القسم (REASONED حين يقول «غائب وسببه في absentFieldReasons» أو «فشل القراءة ⇒ غائب بسببه»)');
  const sectionText = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'FV71_CONTRACT_SECTION.md'), 'utf8');
  for (const key of Object.keys(HAND)) ok(sectionText.includes(`\`${key}\``), `[أ] «${key}» يظهر في نصّ القسم المنسوخ (لا اسم من خارج العقد)`);
  // الجزء الظاهر من العقد على الأربع قيم endReason وعلى القوائم المعدَّدة
  for (const v of ['up', 'cancel', 'cancel_flagged', 'open_at_end']) ok(sectionText.includes(v), `[أ] strokes[].end «${v}» في نصّ القسم`);
  for (const v of ['touch', 'stylus', 'mouse', 'eraser', 'unknown']) ok(sectionText.includes(v), `[أ] strokes[].toolType «${v}» في نصّ القسم`);
  for (const v of ['XDPI', 'XDPI_MODE_SCALED', 'DENSITY_DPI_FALLBACK', 'gap_jump', 'coord_jump', 'edge_exit', 'not_available_api', 'not_reported_by_device']) ok(sectionText.includes(v), `[أ] «${v}» في نصّ القسم`);
  eq(Object.values(N.TOUCH_PATH_TOOL_TYPE), ['touch', 'stylus', 'mouse', 'eraser', 'unknown'], '[أ] toolType: خمس قيم بنصّ القسم');
  eq(Object.values(N.TOUCH_PATH_STROKE_END), ['up', 'cancel', 'cancel_flagged', 'open_at_end'], '[أ] end: أربع قيم بنصّ القسم');
  eq(Object.values(N.TOUCH_PATH_DENSITY_SOURCE), ['XDPI', 'XDPI_MODE_SCALED', 'DENSITY_DPI_FALLBACK'], '[أ] densitySource: ثلاث قيم بنصّ القسم');
  eq(N.TOUCH_PATH_DISPLAYED_SUSPECT_KINDS, ['gap_jump', 'coord_jump', 'edge_exit'], '[أ] displayedSuspects.kind على السلك: ثلاث قيم (lift_break اسم خادم لا يُكتب على السلك)');
  eq(N.FIELDS_VERSION_71, 71, '[أ] FIELDS_VERSION_71 = 71 (القسم: «71 يوضع في أوّل التزام كود يغيّر الشكل»)');
  // أسماء absentFieldReasons في قسم f9e0571 (عشرة + strokes.touchMajorPx): المسمّاة REASONED = العشرة بالضبط (الكثافة خارجها)
  const NAMED_IN_REASONS = ['displayWidthPx', 'displayHeightPx', 'modePhysicalWidthPx', 'modePhysicalHeightPx', 'gestureInsetsPx', 'mandatoryGestureInsetsPx', 'exclusionRectsPx', 'systemBarsHidden', 'cutoutRectsPx', 'unbufferedDispatch'];
  eq(Object.keys(HAND).filter((k) => HAND[k][1] === 'REASONED').sort(), [...NAMED_IN_REASONS].sort(), '[أ] المفاتيح REASONED = العشرة المسمّاة في قائمة absentFieldReasons بقسم f9e0571 بالضبط');
  for (const key of NAMED_IN_REASONS) ok(sectionText.includes(key), `[أ] «${key}» في نصّ القسم`);
  // التعداد [ق] (القسم): خمسة أسماء لـdensityCheck وقيمتان لـresampledFlagState
  eq(Object.values(N.TOUCH_PATH_DENSITY_CHECK_CONDITIONS), ['xdpi_or_ydpi_not_positive', 'xdpi_ydpi_differ_over_5pct', 'phone_width_outside_55_85mm', 'both_candidates_plausible', 'display_width_unknown'], '[أ] عناصر densityCheck: خمسة بنصّ القسم [ق]');
  for (const v of Object.values(N.TOUCH_PATH_DENSITY_CHECK_CONDITIONS)) ok(sectionText.includes(v), `[أ] densityCheck «${v}» في نصّ القسم`);
  eq(Object.values(N.TOUCH_PATH_RESAMPLED_FLAG_STATE), ['not_available_api', 'not_read_by_app'], '[أ] resampledFlagState: قيمتان بنصّ القسم [ق، معلّق]');
  for (const v of Object.values(N.TOUCH_PATH_RESAMPLED_FLAG_STATE)) ok(sectionText.includes(v), `[أ] resampledFlagState «${v}» في نصّ القسم`);
}

// ═══ ب) gridBasis بكل قيمه — من الختم وحده، لا من الأبعاد (القاعدة 30) ═══════════════════════════════════════════
{
  const fixed = {gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: 120, elapsedMs: 4165, timeToFirstTouchMs: 1730, endReason: 'auto_complete', maxSimultaneousPointers: 3};
  for (const fv of [67, 68, 69, 70]) eq(tgOf(read(fv, fixed)).gridBasis, GB.FIXED_8X15, `[ب] ختم ${fv} ⟵ FIXED_8X15 (القسم: «لكل ختم < 71»، ومنه 70)`);
  for (const fv of [71, 72, 100]) eq(tgOf(read(fv, COMPLETE())).gridBasis, GB.MM_TARGET, `[ب] ختم ${fv} ⟵ MM_TARGET`);
  eq(tgOf(read(null, fixed)).gridBasis, GB.UNDETERMINED_NO_FIELDS_VERSION, '[ب] بلا ختم ⟵ UNDETERMINED_NO_FIELDS_VERSION: لا يُفترَض أيّ من الأساسين');
  eq(Object.values(GB), ['FIXED_8X15', 'MM_TARGET', 'UNDETERMINED_NO_FIELDS_VERSION'], '[ب] القيم الممكنة ثلاث بالضبط وكلّها جُرِّبت');
  // **من الختم وحده**: أبعاد غير 8×15 تحت ختم 70 لا تقلب الأساس إلى MM_TARGET (تُعلَن تناقضاً)، وأبعاد 8×15 تحت ختم 71 لا تجعله FIXED
  const wide = {...fixed, gridCols: 12, gridRows: 26, totalCells: 312, touchedCells: 312};
  const o70 = read(70, wide);
  eq(tgOf(o70).gridBasis, GB.FIXED_8X15, '[ب] ختم 70 وأبعاد 12×26: الأساس يبقى FIXED_8X15 (لا يُشتقّ من gridCols/gridRows)');
  ok(hasCode(o70, 'TOUCH_GRID_DIMENSIONS_DISAGREE_WITH_BASIS', (a) => a.detail.gridCols === 12 && a.detail.gridRows === 26), '[ب] والتناقض يُعلَن شذوذاً بالأبعاد المشحونة');
  eq(codes(read(70, fixed)), [], '[ب] ختم 70 وأبعاد 8×15: لا شذوذ');
  const at71 = clone(COMPLETE());
  at71.gridCols = 8; at71.gridRows = 15;
  const o71 = read(71, at71);
  eq(tgOf(o71).gridBasis, GB.MM_TARGET, '[ب] ختم 71 وأبعاد 8×15: الأساس MM_TARGET (من الختم)');
  ok(!hasCode(o71, 'TOUCH_GRID_DIMENSIONS_DISAGREE_WITH_BASIS'), '[ب] ولا تناقض أبعاد تحت MM_TARGET (القسم: gridCols/gridRows «لم يعودا 8 و15 دائماً»)');
  eq(tgOf(read(70, {...fixed, gridCols: 'x'})).gridBasis, GB.FIXED_8X15, '[ب] gridCols بنوع خاطئ: الأساس بالختم لا يتأثّر');
  const noDims = clone(fixed);
  delete noDims.gridCols; delete noDims.gridRows;
  eq([tgOf(read(70, noDims)).gridBasis, hasCode(read(70, noDims), 'TOUCH_GRID_DIMENSIONS_DISAGREE_WITH_BASIS')], [GB.FIXED_8X15, false], '[ب] الأبعاد غائبة: الأساس بالختم ولا شذوذ تناقض (الغياب يُقرأ في مكانه)');
}

// ═══ جـ) كتلة path: حالتها بحسب الختم ═══════════════════════════════════════════════════════════════════════════
{
  // «إطار + X» (2026-10-21): عيّنة المُنتِج صارت تحمل gridPattern وnotRequiredCells أيضاً — مفتاحان جديدان في fv71 يُسردان بعد مفاتيح TOUCH_PATH_FIELD_SPEC (حُدِّث التوقّع في مكانه: القاعدة 23)
  for (const fv of [68, 69, 70]) eq(tgOf(read(fv, COMPLETE())).path, {state: PS.NOT_IN_FIELDS_VERSION, unexpectedKeys: [...Object.keys(N.TOUCH_PATH_FIELD_SPEC).filter((k) => k in COMPLETE()), 'gridPattern', 'notRequiredCells']},
      `[جـ] ختم ${fv} مع مفاتيح fv71 في الحمولة: الكتلة NOT_IN_FIELDS_VERSION ومفاتيحها المبكّرة مسرودة (لا تُقرأ)`);
  const o69 = read(69, COMPLETE());
  ok(hasCode(o69, 'TOUCH_PATH_KEYS_PRESENT_BEFORE_FV71', (a) => a.detail.keys.includes('strokes') && a.section === BASE), '[جـ] وحضورها تحت ختم < 71 شذوذ معلن (القاعدة 25)');
  const clean70 = tgOf(read(70, {gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: 0, endReason: 'user_marked_not_tested', maxSimultaneousPointers: 0}));
  eq(clean70.path, {state: PS.NOT_IN_FIELDS_VERSION, unexpectedKeys: []}, '[جـ] ختم 70 بخامّ fv70 الحقيقي: كتلة path بحالتها وحدها (غياب المفاتيح هو الحال)');
  eq(tgOf(read(null, COMPLETE())).path.state, PS.UNDETERMINED_NO_FIELDS_VERSION, '[جـ] بلا ختم: UNDETERMINED_NO_FIELDS_VERSION لا «لم توجد بعد»');
  const p71 = tgOf(read(71, COMPLETE())).path;
  eq([p71.state, p71.unknownKeys], [PS.READ, []], '[جـ] ختم 71: مقروءة، بلا مفتاح مجهول');
  const extra = clone(COMPLETE());
  extra.somethingNew = 1;
  const oExtra = read(71, extra);
  ok(hasCode(oExtra, 'TOUCH_GRID_UNKNOWN_KEY', (a) => a.detail.keys.length === 1 && a.detail.keys[0] === 'somethingNew'), '[جـ] مفتاح خارج العقد في ختم ≥ 71: شذوذ (لا يُقبل شكل جديد بلا قارئ، القاعدة 25)');
  eq(tgOf(oExtra).path.unknownKeys, ['somethingNew'], '[جـ] ويُسرد في الكتلة');
  const unenc = clone(COMPLETE());
  unenc.measurementsUnencodable = 'x';
  ok(!hasCode(read(71, unenc), 'TOUCH_GRID_UNKNOWN_KEY'), '[جـ] measurementsUnencodable مفتاح معروف في العقد (§٧ بند 5) لا مجهول');
}

// ═══ د) كل مفتاح: غيابه ونوعه الخاطئ ══════════════════════════════════════════════════════════════════════════════
{
  const SPEC = N.TOUCH_PATH_FIELD_SPEC;
  const base = COMPLETE();
  const present = Object.keys(SPEC).filter((k) => k in base);
  ok(present.length >= 28, `[د] الحمولة الكاملة تحمل ${present.length} من 32 مفتاحاً (الباقي اختياريّ بالتصميم)`);
  for (const key of present) {
    const m = clone(base);
    delete m[key];
    const o = read(71, m);
    const p = tgOf(o).path;
    const pres = SPEC[key].presence;
    if (pres === N.TOUCH_PATH_PRESENCE.ALWAYS) {
      eq(p[`${key}Status`], KS.ABSENT, `[د] ${key} (ALWAYS) غائب: ABSENT`);
      ok(hasCode(o, 'TOUCH_PATH_REQUIRED_KEY_ABSENT', (a) => a.detail.key === key), `[د] ${key}: شذوذ «مفتاح لازم غائب»`);
    } else if (pres === N.TOUCH_PATH_PRESENCE.REASONED) {
      eq(p[`${key}Status`], KS.ABSENT, `[د] ${key} (REASONED) غائب بلا سبب: ABSENT`);
      ok(hasCode(o, 'TOUCH_PATH_ABSENT_WITHOUT_REASON', (a) => a.detail.key === key), `[د] ${key}: شذوذ «غائب بلا مدخل في absentFieldReasons» (القسم N71-01)`);
      const withReason = clone(m);
      withReason.absentFieldReasons = {[key]: 'api_below_29'};
      const o2 = read(71, withReason);
      const p2 = tgOf(o2).path;
      eq([p2[`${key}Status`], p2[`${key}Reason`].kind, p2[`${key}Reason`].detail, hasCode(o2, 'TOUCH_PATH_ABSENT_WITHOUT_REASON')], [KS.ABSENT_DECLARED, 'api_below', '29', false], `[د] ${key} غائب بسببه api_below_29: ABSENT_DECLARED بسببه ولا شذوذ`);
      ok(o2.absences.ABSENT_DECLARED.some((q) => q.endsWith(`path.${key}Status`)), `[د] ${key}: الغياب المُعلَن يظهر في ملخّص الغياب في أعلى المخرَج (القاعدة 22)`);
      eq(o2.absences.ABSENT.filter((q) => q.endsWith(`path.${key}Status`)), [], `[د] ${key}: ولا يظهر في «غياب بلا سبب»`);
    } else if (pres === N.TOUCH_PATH_PRESENCE.ONE_OF_PAIR) {
      // الزوج: حذف المفتاح الحاضر وحده يُبقي الآخر غائباً أيضاً ⟵ شذوذ «أحدهما حاضر دائماً»
      ok(hasCode(o, 'TOUCH_PATH_ROUNDED_CORNERS_ABSENT'), `[د] ${key} هو الحاضر من زوج الزوايا وحُذف: شذوذ «أحدهما حاضر دائماً»`);
    }
  }
  // مفتاحان اختياريان بالتصميم
  const ds = tgOf(read(71, COMPLETE())).path;
  eq([ds.displayedSuspectsStatus, ds.displayedSuspects], [KS.ABSENT_DECLARED, {state: N.TOUCH_PATH_DISPLAYED_STATE.NOT_DISPLAYED}], '[د] displayedSuspects غائب ⟵ «لم تُعرض علامات»: ABSENT_DECLARED بحالته لا شذوذ (القسم ف-03)');
  eq([ds.absentFieldReasonsStatus, ds.absentFieldReasons], [KS.ABSENT_DECLARED, {}], '[د] absentFieldReasons غائبة ⟵ «حاضرة فقط حين غاب حقل»: ABSENT_DECLARED لا شذوذ');
  // زوج الزوايا: كلاهما حاضر ⟵ شذوذ؛ كلاهما غائب ⟵ شذوذ؛ أحدهما فقط ⟵ لا شذوذ
  {
    // COMPLETE (11ch، API < 31): roundedCornersState وحدها؛ DEAD (13ch): الأرقام وحدها — كلتاهما كما شحنهما المُنتِج
    const both = clone(COMPLETE());
    both.roundedCornerRadiiPx = {topLeft: 1, topRight: 1, bottomRight: 1, bottomLeft: 1};
    ok(hasCode(read(71, both), 'TOUCH_PATH_ROUNDED_CORNERS_BOTH_PRESENT'), '[د] الزاويتان معاً (أرقام وحالة): شذوذ تناقض');
    const oS = read(71, COMPLETE());
    eq([tgOf(oS).path.roundedCornersStateStatus, tgOf(oS).path.roundedCornerRadiiPxStatus, codes(oS)], [KS.PRESENT, KS.ABSENT, []], '[د] roundedCornersState وحدها (API < 31، عيّنة 11ch): حاضرة والأرقام غائبة ولا شذوذ');
    const radiiOnly = read(71, DEAD());
    eq([codes(radiiOnly), tgOf(radiiOnly).path.roundedCornerRadiiPx], [[], {topLeft: 120, topRight: 120, bottomRight: 120, bottomLeft: 120}], '[د] الأرقام وحدها (API ≥ 31، عيّنة 13ch): لا شذوذ');
    const zeroCorner = clone(DEAD());
    zeroCorner.roundedCornerRadiiPx.topLeft = 0;
    eq(codes(read(71, zeroCorner)), [], '[د] زاوية بلا استدارة = 0 جواب معرَّف لا غياب (القسم): لا شذوذ');
  }
  // نوع خاطئ لكل مفتاح موجود
  const WRONG = {int: 'x', number: 'x', string: 5, boolean: 'true', array: {}, object: []};
  for (const key of present) {
    const m = clone(base);
    m[key] = WRONG[SPEC[key].type];
    const o = read(71, m);
    eq(tgOf(o).path[`${key}Status`], KS.WRONG_TYPE, `[د] ${key} بنوع خاطئ (${SPEC[key].type}): WRONG_TYPE لا تحويل`);
    ok(own(o).some((a) => a.code === 'WRONG_TYPE' && a.section.endsWith(`.${key}`)), `[د] ${key}: شذوذ WRONG_TYPE في موضعه`);
  }
  // عدد صحيح بكسر: cellWidthPx عشرية مشروعة (القسم: «قد يختلفان بالتقريب»)، أمّا surfaceWidthPx فعدد صحيح
  const frac = clone(base);
  frac.surfaceWidthPx = 1080.5;
  eq(tgOf(read(71, frac)).path.surfaceWidthPxStatus, KS.WRONG_TYPE, '[د] surfaceWidthPx بكسر: WRONG_TYPE (عدد صحيح بالعقد)');
  const fracCell = clone(base);
  fracCell.cellHeightPx = 87.69;
  eq(tgOf(read(71, fracCell)).path.cellHeightPxStatus, KS.PRESENT, '[د] cellHeightPx عشرية: مقبولة');
}

// ═══ هـ) القيم المعدَّدة كلّها ═════════════════════════════════════════════════════════════════════════════════════
{
  const withStroke = (patch) => {
    const m = clone(COMPLETE());
    const s = m.strokes[0];
    s.dtMs = s.dtMs.slice(0, 6); s.x = s.x.slice(0, 6); s.y = s.y.slice(0, 6); s.touchMajorPx = s.touchMajorPx.slice(0, 6);
    Object.assign(s, patch);
    return m;
  };
  const strokeProblem = (o, code) => own(o).find((a) => a.code === `TOUCH_PATH_STROKE_${code}`);
  // toolType: القيم الخمس + unknown:<n>
  for (const v of ['touch', 'stylus', 'mouse', 'eraser', 'unknown', 'unknown:7']) {
    const o = read(71, withStroke({toolType: v}));
    const s = tgOf(o).path.strokes.summaries.items[0];
    eq([s.toolType.recognized, s.toolType.kind, strokeProblem(o, 'TOOL_TYPE_UNRECOGNIZED')], [true, v.startsWith('unknown') ? 'unknown' : v, undefined], `[هـ] toolType=${v}: معروفة`);
  }
  for (const v of ['pen', 'TOUCH', 'touch:1']) {
    const o = read(71, withStroke({toolType: v}));
    ok(strokeProblem(o, 'TOOL_TYPE_UNRECOGNIZED') && strokeProblem(o, 'TOOL_TYPE_UNRECOGNIZED').detail.examples.includes(v), `[هـ] toolType=${v}: غير معروفة ⟵ تُعلَن ولا تُلحَق بأقربها`);
    eq(tgOf(o).path.strokes.summaries.items[0].toolType.recognized, false, `[هـ] toolType=${v}: recognized=false`);
  }
  // end: القيم الأربع، وما عداها
  for (const v of ['up', 'cancel', 'cancel_flagged', 'open_at_end']) {
    const o = read(71, withStroke({end: v}));
    eq([tgOf(o).path.strokes.summaries.items[0].end.kind, strokeProblem(o, 'END_UNRECOGNIZED')], [v, undefined], `[هـ] end=${v}: معروفة`);
    eq(tgOf(o).path.strokes.endCounts, {[v]: 1}, `[هـ] end=${v}: يُحصى`);
  }
  for (const v of ['UP', 'lift', '']) {
    const o = read(71, withStroke({end: v}));
    ok(strokeProblem(o, 'END_UNRECOGNIZED') !== undefined, `[هـ] end="${v}": شذوذ غير معروف`);
    eq(tgOf(o).path.strokes.endCounts, {UNRECOGNIZED: 1}, `[هـ] end="${v}": يُحصى UNRECOGNIZED`);
  }
  // densitySource: الثلاث وما عداها
  for (const v of ['XDPI', 'XDPI_MODE_SCALED', 'DENSITY_DPI_FALLBACK']) {
    const m = clone(COMPLETE());
    m.densitySource = v;
    const o = read(71, m);
    eq([tgOf(o).path.densitySourceState.recognized, tgOf(o).path.densitySourceState.kind, codes(o)], [true, v, []], `[هـ] densitySource=${v}`);
  }
  {
    const m = clone(COMPLETE());
    m.densitySource = 'DPI';
    const o = read(71, m);
    eq(tgOf(o).path.densitySourceState.recognized, false, '[هـ] densitySource خارج الثلاث: غير معروفة');
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === 'DPI'), '[هـ] ويُعلَن شذوذاً');
  }
  // densityCheck: خمسة أسماء [ق] معدَّدة من نصّ القسم؛ اسم خارجها شذوذ؛ و«[] ما لم يُستعمل DENSITY_DPI_FALLBACK» (استُبدل به اختبار «تمرّ النصوص بلا تصنيف»: القاعدة 23)
  {
    const withCheck = (list, source) => {
      const m = clone(COMPLETE());
      m.densityCheck = list;
      if (source !== undefined) m.densitySource = source;
      return m;
    };
    const FIVE = ['xdpi_or_ydpi_not_positive', 'xdpi_ydpi_differ_over_5pct', 'phone_width_outside_55_85mm', 'both_candidates_plausible', 'display_width_unknown'];
    for (const name of FIVE) {
      const o = read(71, withCheck([name], 'DENSITY_DPI_FALLBACK'));
      eq([tgOf(o).path.densityCheck, tgOf(o).path.densityCheckUnrecognized.total, codes(o)], [[name], 0, []], `[هـ] densityCheck=[${name}] مع DENSITY_DPI_FALLBACK: معروف ولا شذوذ`);
    }
    const all = read(71, withCheck(FIVE, 'DENSITY_DPI_FALLBACK'));
    eq(codes(all), [], '[هـ] الخمسة معاً مع الاحتياط: لا شذوذ');
    const unk = read(71, withCheck(['anything_goes', FIVE[0], 'another'], 'DENSITY_DPI_FALLBACK'));
    ok(hasCode(unk, 'TOUCH_PATH_DENSITY_CHECK_UNRECOGNIZED', (a) => a.detail.count === 2 && a.detail.names.join() === 'anything_goes,another'), '[هـ] اسمان خارج الخمسة: شذوذ بالعدد والاسمين (لا تُلحَق بأقربها)');
    eq([tgOf(unk).path.densityCheckUnrecognized.items, tgOf(unk).path.densityCheckUnrecognized.total, tgOf(unk).path.densityCheck.length], [['anything_goes', 'another'], 2, 3], '[هـ] وتُسرد في المخرَج، والقائمة المشحونة كما هي');
    for (const src of ['XDPI', 'XDPI_MODE_SCALED']) {
      const o = read(71, withCheck([FIVE[1]], src));
      ok(hasCode(o, 'TOUCH_PATH_DENSITY_CHECK_WITHOUT_FALLBACK', (a) => a.detail.densitySource === src && a.detail.count === 1), `[هـ] densityCheck غير فارغة مع ${src}: شذوذ («[] ما لم يُستعمل DENSITY_DPI_FALLBACK»)`);
    }
    eq(codes(read(71, withCheck([], 'XDPI'))), [], '[هـ] [] مع XDPI: لا شذوذ');
    eq(codes(read(71, withCheck([], 'DENSITY_DPI_FALLBACK'))), [], '[هـ] [] مع الاحتياط: لا شذوذ (القسم لا يقول إن الاحتياط يستلزم شرطاً فاشلاً)');
    const unrecSrc = read(71, withCheck([FIVE[0]], 'DPI'));
    ok(!hasCode(unrecSrc, 'TOUCH_PATH_DENSITY_CHECK_WITHOUT_FALLBACK') && hasCode(unrecSrc, 'UNRECOGNIZED_STATE'), '[هـ] densitySource غير معروف: لا حكم علاقة (يُعلَن غير المعروف وحده)');
    const noSrc = clone(withCheck([FIVE[0]]));
    delete noSrc.densitySource;
    ok(!hasCode(read(71, noSrc), 'TOUCH_PATH_DENSITY_CHECK_WITHOUT_FALLBACK'), '[هـ] densitySource غائب (والغياب شذوذ ALWAYS في مكانه): لا حكم علاقة');
    const bad = read(71, withCheck(['ok', 5], 'DENSITY_DPI_FALLBACK'));
    ok(hasCode(bad, 'TOUCH_PATH_SHAPE_INVALID', (a) => a.detail.key === 'densityCheck') && !hasCode(bad, 'TOUCH_PATH_DENSITY_CHECK_UNRECOGNIZED'), '[هـ] عنصر غير نصّ في densityCheck: شذوذ شكل، ولا تعداد لقائمة غير نصّية');
  }
  // resampledFlagState: قيمتان [ق، معلّق]؛ غيرهما شذوذ غير معروف؛ ولا حكم على دلالته
  for (const v of ['not_available_api', 'not_read_by_app']) {
    const m = clone(COMPLETE());
    m.resampledFlagState = v;
    const o = read(71, m);
    eq([tgOf(o).path.resampledFlagStateState.recognized, tgOf(o).path.resampledFlagStateState.kind, codes(o)], [true, v, []], `[هـ] resampledFlagState=${v}: معروفة`);
  }
  for (const v of ['available', 'NOT_AVAILABLE_API', '', 'not_read_by_app:x']) {
    const m = clone(COMPLETE());
    m.resampledFlagState = v;
    const o = read(71, m);
    eq(tgOf(o).path.resampledFlagStateState.recognized, false, `[هـ] resampledFlagState="${v}": غير معروفة`);
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === v), `[هـ] "${v}": تُعلَن شذوذاً`);
  }
  {
    const m = clone(COMPLETE());
    delete m.resampledFlagState;
    const o = read(71, m);
    eq([tgOf(o).path.resampledFlagStateState, tgOf(o).path.resampledFlagStateStatus], [null, KS.ABSENT], '[هـ] resampledFlagState غائب: لا حالة (null) وABSENT (والشذوذ ALWAYS في مكانه)');
  }
  // unbufferedDispatch: «true إن نجح وإلا غائب بسببه» — false لا يُكتب أبداً
  {
    const m = clone(COMPLETE());
    m.unbufferedDispatch = false;
    const o = read(71, m);
    ok(hasCode(o, 'TOUCH_PATH_UNBUFFERED_DISPATCH_FALSE'), '[هـ] unbufferedDispatch=false: شذوذ (القسم: true أو غائب بسببه)');
    eq(tgOf(o).path.unbufferedDispatchStatus, KS.PRESENT, '[هـ] وحالته PRESENT بقيمته كما شُحنت (لا تُخفى)');
    eq(codes(read(71, COMPLETE())), [], '[هـ] unbufferedDispatch=true (كما شحنه المُنتِج): لا شذوذ');
  }
  // roundedCornersState: not_available_api · read_failed:<نصّ> · غيرها
  for (const [v, rec, kind] of [['not_available_api', true, 'not_available_api'], ['read_failed:boom', true, 'read_failed'], ['read_failed', false, 'UNRECOGNIZED'], ['unavailable', false, 'UNRECOGNIZED']]) {
    const m = clone(COMPLETE());
    delete m.roundedCornerRadiiPx;
    m.roundedCornersState = v;
    const o = read(71, m);
    const st = tgOf(o).path.roundedCornersStateState;
    eq([st.recognized, st.kind], [rec, kind], `[هـ] roundedCornersState=${v}`);
  }
  // أسباب الغياب: api_below_<n> · read_failed:<نصّ> · not_reported_by_device · غيرها
  for (const [v, rec, kind, detail] of [['api_below_29', true, 'api_below', '29'], ['api_below_31', true, 'api_below', '31'], ['read_failed:SecurityException', true, 'read_failed', 'SecurityException'],
    ['not_reported_by_device', true, 'not_reported_by_device', null], ['api_below_', false, 'UNRECOGNIZED', null], ['api_below_x', false, 'UNRECOGNIZED', null], ['not_found', false, 'UNRECOGNIZED', null]]) {
    const m = clone(COMPLETE());
    delete m.gestureInsetsPx;
    m.absentFieldReasons = {gestureInsetsPx: v};
    const o = read(71, m);
    const reason = tgOf(o).path.absentFieldReasons.gestureInsetsPx;
    eq([reason.recognized, reason.kind, reason.detail], [rec, kind, detail], `[هـ] سبب الغياب «${v}»`);
    eq(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.key === 'gestureInsetsPx'), !rec, `[هـ] «${v}»: شذوذ غير معروف ⟺ غير معروف`);
  }
  {
    const m = clone(COMPLETE());
    m.absentFieldReasons = {nonsenseKey: 'api_below_29', surfaceWidthPx: 'api_below_29', gestureInsetsPx: 'api_below_29', xdpi: 'read_failed:x'};
    const o = read(71, m);
    ok(hasCode(o, 'TOUCH_PATH_REASON_FOR_UNKNOWN_KEY', (a) => a.detail.key === 'xdpi'), '[هـ] وسبب لـxdpi (الكثافة خارج قائمة القسم، ALWAYS): شذوذ');
    ok(hasCode(o, 'TOUCH_PATH_REASON_FOR_UNKNOWN_KEY', (a) => a.detail.key === 'nonsenseKey'), '[هـ] سبب لاسم حقل لا يعرفه العقد: شذوذ');
    ok(hasCode(o, 'TOUCH_PATH_REASON_FOR_UNKNOWN_KEY', (a) => a.detail.key === 'surfaceWidthPx'), '[هـ] وسبب لحقل «حاضر دائماً» (لا يُعذَر غيابه): شذوذ');
    ok(hasCode(o, 'TOUCH_PATH_REASON_FOR_PRESENT_KEY', (a) => a.detail.key === 'gestureInsetsPx'), '[هـ] وسبب لحقل حاضر فعلاً: شذوذ تناقض');
    m.absentFieldReasons = {gestureInsetsPx: 5};
    ok(hasCode(read(71, m), 'REASON_NOT_STRING'), '[هـ] سبب غير نصّ: شذوذ');
  }
  // أشكال الحواف
  for (const [key, bad] of [['gestureInsetsPx', {left: 0, top: 0, right: 0}], ['mandatoryGestureInsetsPx', {left: 0, top: 0, right: 0, bottom: 1.5}],
    ['exclusionRectsPx', [{left: 0, top: 0, right: 0, bottom: 0}, {left: 'x'}]], ['cutoutRectsPx', [5]], ['roundedCornerRadiiPx', {topLeft: 1, topRight: 1, bottomRight: 1}]]) {
    const m = clone(COMPLETE());
    m[key] = bad;
    ok(hasCode(read(71, m), 'TOUCH_PATH_SHAPE_INVALID', (a) => a.detail.key === key), `[هـ] ${key} بشكل خاطئ: شذوذ شكل`);
  }
}

// ═══ و) الخطوط: كل مشكلة ═══════════════════════════════════════════════════════════════════════════════════════════
{
  // الخطّ المقصوص إلى 8 نقاط لا يطابق touchedCells المشحون (312): مقارنة الخلايا بالمسار تُعلن اختلافها بحقّ، وليست موضوع هذه الكتلة فتُستثنى من العدّ
  const codesNC = (o) => own(o).filter((x) => x.code !== 'TOUCH_GRID_CELLS_DISAGREE_WITH_PATH').map((x) => x.code);
  const small = () => {
    const m = clone(COMPLETE());
    const s = m.strokes[0];
    for (const k of ['dtMs', 'x', 'y', 'touchMajorPx']) s[k] = s[k].slice(0, 8);
    return m;
  };
  const sums = (o) => tgOf(o).path.strokes;
  const problem = (o, code) => own(o).find((a) => a.code === `TOUCH_PATH_STROKE_${code}`);
  const base = read(71, small());
  eq([codesNC(base), sums(base).count, sums(base).usableCount, sums(base).pointsTotal], [[], 1, 1, 8], '[و] خطّ سليم: لا مشكلة، وثماني نقاط');
  let m = small(); m.strokes[0].dtMs = m.strokes[0].dtMs.slice(0, 7);
  let o = read(71, m);
  eq([problem(o, 'LENGTH_MISMATCH').detail.examples, sums(o).usableCount, sums(o).unusableCount, o.measurements.items[0].touchGrid.path.analysis.detector.unusableStrokeIndexes.items], [['7/8/8'], 0, 1, [0]],
      '[و] طول dtMs ≠ x = y: شذوذ (القسم ف-03: «خلافه ⇒ شذوذ») والخطّ غير صالح ويُعدّ ولا يُلمَس');
  eq(tgOf(o).path.analysis.detector.state, N.TOUCH_PATH_DETECTION_STATE.UNDETERMINED_NO_USABLE_STROKES, '[و] ولا خطّ صالح ⟵ حالة الكاشف معلنة');
  m = small(); m.strokes[0].y = m.strokes[0].y.slice(0, 7);
  ok(problem(read(71, m), 'LENGTH_MISMATCH'), '[و] طول y مختلف: شذوذ');
  m = small(); m.strokes[0].x[3] = null;
  eq([problem(read(71, m), 'COORD_NOT_FINITE').detail.count, sums(read(71, m)).usableCount], [1, 0], '[و] x فيها null: «أعداد منتهية فقط» ⟵ شذوذ والخطّ غير صالح');
  m = small(); m.strokes[0].y[3] = 'a';
  ok(problem(read(71, m), 'COORD_NOT_FINITE'), '[و] y فيها نصّ: شذوذ');
  m = small(); m.strokes[0].dtMs[4] = -1;
  ok(problem(read(71, m), 'DT_INVALID') && sums(read(71, m)).usableCount === 0, '[و] dtMs سالب: شذوذ والخطّ غير صالح');
  m = small(); m.strokes[0].dtMs[4] = 1.5;
  ok(problem(read(71, m), 'DT_INVALID'), '[و] dtMs بكسر: شذوذ (أعداد صحيحة)');
  m = small(); m.strokes[0].dtMs[0] = 5;
  o = read(71, m);
  eq([problem(o, 'DT_FIRST_NONZERO').detail.examples, sums(o).usableCount], [[5], 1], '[و] dtMs[0] ≠ 0: يُعلَن (القسم [م]: «dtMs[0] = 0») ويبقى الخطّ صالحاً (الزمن المطلق downAtMs)');
  m = small(); delete m.strokes[0].downAtMs;
  o = read(71, m);
  ok(problem(o, 'DOWN_AT_INVALID') && sums(o).usableCount === 0, '[و] downAtMs غائب: شذوذ والخطّ غير صالح (لا زمن مطلق)');
  m = small(); m.strokes[0].pointerId = '0';
  o = read(71, m);
  ok(problem(o, 'POINTER_ID_INVALID') && sums(o).usableCount === 1, '[و] pointerId نصّ: شذوذ ولا يُسقط الخطّ (لا يُستعمل في الحكم)');
  m = small(); delete m.strokes[0].toolType;
  ok(problem(read(71, m), 'TOOL_TYPE_INVALID'), '[و] toolType غائب: شذوذ');
  m = small(); delete m.strokes[0].end;
  o = read(71, m);
  ok(problem(o, 'END_INVALID') && tgOf(o).path.strokes.endCounts.UNRECOGNIZED === 1, '[و] end غائب: شذوذ ويُحصى غير معروف');
  eq(tgOf(o).path.analysis.detector.excludedStrokes.items[0].reasons, ['UNRECOGNIZED_END'], '[و] ويُستبعد من الكشف بسببه');
  m = small(); m.strokes[0].dtMs = 'x';
  ok(problem(read(71, m), 'ARRAYS_INVALID'), '[و] dtMs ليست مصفوفة: شذوذ');
  m = small(); m.strokes.push(5);
  o = read(71, m);
  ok(problem(o, 'NOT_OBJECT') && sums(o).count === 2 && sums(o).usableCount === 1, '[و] عنصر في strokes ليس كائناً: شذوذ، ويُعدّ ويُسرد ولا يُسقط');
  // touchMajorPx: غائبة بلا سبب / بسبب / حاضرة مع سبب / بطول خاطئ
  m = small(); delete m.strokes[0].touchMajorPx;
  o = read(71, m);
  ok(hasCode(o, 'TOUCH_PATH_ABSENT_WITHOUT_REASON', (a) => a.detail.key === 'strokes.touchMajorPx' && a.detail.strokesWithout === 1), '[و] touchMajorPx غائبة بلا سبب: شذوذ');
  m.absentFieldReasons = {'strokes.touchMajorPx': 'not_reported_by_device'};
  o = read(71, m);
  eq([codesNC(o), tgOf(o).path.strokes.touchMajor], [[], {withPoints: 0, withoutPoints: 1, reasonDeclared: true}], '[و] touchMajorPx غائبة بسببها not_reported_by_device: لا شذوذ، وحالتها معلنة (لا أصفار)');
  m = small(); m.absentFieldReasons = {'strokes.touchMajorPx': 'not_reported_by_device'};
  ok(hasCode(read(71, m), 'TOUCH_PATH_REASON_FOR_PRESENT_KEY', (a) => a.detail.key === 'strokes.touchMajorPx'), '[و] touchMajorPx حاضرة في كل الخطوط ومعها سبب غياب: تناقض');
  m = small(); m.strokes[0].touchMajorPx = m.strokes[0].touchMajorPx.slice(0, 5);
  o = read(71, m);
  ok(problem(o, 'TOUCH_MAJOR_INVALID') && sums(o).usableCount === 1, '[و] touchMajorPx بطول خاطئ: شذوذ، ويبقى الخطّ صالحاً بلا touchMajor');
  // مشاكل كثيرة ⟵ شذوذ واحد بالعدد (لا ألف شذوذ لقائمة معطوبة)
  m = small();
  m.strokes = [];
  for (let i = 0; i < 30; i++) m.strokes.push({pointerId: 0, toolType: 'touch', downAtMs: i, end: 'up', dtMs: [0, 1], x: [1], y: [1, 2]});
  o = read(71, m);
  eq([own(o).filter((a) => a.code === 'TOUCH_PATH_STROKE_LENGTH_MISMATCH').length, problem(o, 'LENGTH_MISMATCH').detail.count, problem(o, 'LENGTH_MISMATCH').detail.firstIndexes.length], [1, 30, 10],
      '[و] ثلاثون خطّاً معطوباً: شذوذ واحد بالعدد 30 وأوّل عشرة فهارس');
  eq([sums(o).summaries.items.length, sums(o).summaries.total, sums(o).summaries.truncated], [30, 30, false], '[و] والملخّصات كلّها (دون السقف)');
  m.strokes = [];
  for (let i = 0; i < 70; i++) m.strokes.push({pointerId: 0, toolType: 'touch', downAtMs: i * 10, end: 'up', dtMs: [0], x: [1], y: [1]});
  o = read(71, m);
  eq([sums(o).summaries.items.length, sums(o).summaries.total, sums(o).summaries.truncated, sums(o).count], [64, 70, true, 70], '[و] سبعون خطّاً: العدّ 70 والملخّصات 64 ومبتورة بإعلان (لا صامتة)');
  // strokes فارغة: حالة معلنة لا شذوذ (القسم: قد تكون [])
  m = small(); m.strokes = [];
  o = read(71, m);
  eq([tgOf(o).path.strokesStatus, tgOf(o).path.strokes.count, tgOf(o).path.analysis.detector.state], [KS.PRESENT, 0, N.TOUCH_PATH_DETECTION_STATE.UNDETERMINED_NO_USABLE_STROKES], '[و] strokes = []: حاضرة وفارغة والكاشف يعلن ألّا خطّ صالحاً');
}

// ═══ ز) pathCap والعلاقات (totalCells · auto_complete · المجموع · فهارس الخلايا) ═══════════════════════════════
{
  let m = clone(COMPLETE());
  const POINTS = 858; // نقاط عيّنة 11ch المسجَّلة (عدّ من الحمولة: 1 خطّ؛ كانت 624 على 4c0102c)
  eq(m.strokes.reduce((a, s) => a + s.x.length, 0), POINTS, '[ز] ضابط: 858 نقطة في خامّ 11ch');
  m.pathCap = {maxPoints: 500, reached: false, pointsDropped: 0};
  let o = read(71, m);
  ok(hasCode(o, 'TOUCH_PATH_POINTS_EXCEED_CAP', (a) => a.detail.maxPoints === 500 && a.detail.pointsTotal === POINTS), '[ز] نقاط أكثر من السقف المعلَن بلا reached: شذوذ');
  m.pathCap = {maxPoints: POINTS, reached: false, pointsDropped: 0};
  ok(hasCode(read(71, m), 'TOUCH_PATH_POINTS_EXCEED_CAP'), '[ز] المسجَّلة = maxPoints تماماً وreached=false: شذوذ («reached = بلغت العيّنات المسجَّلة maxPoints»)');
  m.pathCap = {maxPoints: POINTS + 1, reached: false, pointsDropped: 0};
  ok(!hasCode(read(71, m), 'TOUCH_PATH_POINTS_EXCEED_CAP'), '[ز] المسجَّلة أقلّ من maxPoints بنقطة وreached=false: لا شذوذ');
  m.pathCap = {maxPoints: POINTS, reached: true, pointsDropped: 10};
  o = read(71, m);
  eq(codes(o), [], '[ز] السقف بُلغ بدقّة (reached=true والمسجَّلة = maxPoints) مع نقاط مسقطة: لا شذوذ');
  m.pathCap = {maxPoints: 1000, reached: true, pointsDropped: 0};
  ok(hasCode(read(71, m), 'TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH', (a) => a.detail.maxPoints === 1000 && a.detail.pointsTotal === POINTS), '[ز] reached=true والمسجَّلة 858 ≠ maxPoints=1000: تناقض');
  m.pathCap = {maxPoints: 100, reached: true, pointsDropped: 0};
  ok(hasCode(read(71, m), 'TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH'), '[ز] reached=true والمسجَّلة أكثر من maxPoints: تناقض أيضاً (≠ لا <)');
  {
    // خطّ غير صالح (طول dtMs ≠ x): العدّ ناقص فلا يُحكم بـreached (المسجَّلة غير معروفة بدقّة)
    const partial = clone(COMPLETE());
    partial.strokes.push({pointerId: 1, toolType: 'touch', downAtMs: 9000, end: 'up', dtMs: [0, 8], x: [1], y: [1], touchMajorPx: [70]});
    partial.pathCap = {maxPoints: 1000, reached: true, pointsDropped: 0};
    ok(!hasCode(read(71, partial), 'TOUCH_PATH_CAP_REACHED_POINTS_MISMATCH'), '[ز] خطّ غير صالح بين الخطوط: لا حكم بـreached (العدّ غير كامل)');
  }
  // الاختبار القديم «reached=false مع pointsDropped>0: تناقض» استُبدل (القاعدة 23): القسم يقول «عيّنة غير منتهية لا تُكتب وتُعدّ في pathCap.pointsDropped» فتجتمع مع reached=false
  m = clone(COMPLETE());
  m.pathCap = {maxPoints: 15000, reached: false, pointsDropped: 3};
  eq(codes(read(71, m)), [], '[ز] reached=false مع pointsDropped=3 (عيّنات غير منتهية أُسقطت): لا شذوذ — قسم f9e0571');
  eq(codes(read(71, CAPPED(), 'not_tested')), [], '[ز] عيّنة 16ch كما شحنها المُنتِج: reached=true، 15000 مسجَّلة و300 مُسقَطة، maxPoints=15000: لا شذوذ');
  eq([CAPPED().pathCap, CAPPED().strokes[0].x.length], [{maxPoints: 15000, reached: true, pointsDropped: 300}, 15000], '[ز] ضابط: pathCap والعدّ في حمولة المُنتِج كما قُرئا');
  m = clone(COMPLETE());
  for (const drop of ['maxPoints', 'reached', 'pointsDropped']) {
    const x = clone(COMPLETE());
    delete x.pathCap[drop];
    const od = read(71, x);
    ok(hasCode(od, 'TOUCH_PATH_REQUIRED_KEY_ABSENT', (a) => a.detail.key === `pathCap.${drop}`), `[ز] pathCap.${drop} غائب: شذوذ`);
    eq(tgOf(od).path.pathCap[`${drop}Status`], KS.ABSENT, `[ز] pathCap.${drop}: ABSENT`);
  }
  // العلاقة الملزمة (بعد «إطار + X»، 2026-10-21 — القاعدة 23: حلّت محلّ «totalCells = 286 = 12×24−2» و«[ز] totalCells=288 يخالف 286»): totalCells = gridCols × gridRows − عدد cutoutCells − عدد notRequiredCells
  m = clone(DEAD());
  o = read(71, m);
  eq(codes(o), [], '[ز] حمولة المُنتِج بثقب (13ch): totalCells=194 = 18×35−4−432 ⟵ لا شذوذ');
  m.totalCells = 195;
  ok(hasCode(read(71, m), 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN', (a) => a.detail.expected === 194 && a.detail.totalCells === 195 && a.detail.cutoutCells === 4 && a.detail.notRequiredCells === 432), '[ز] totalCells لا يطابق العلاقة: شذوذ بالمتوقَّع والمشحون وعدد القائمتين');
  // touchedCells + untouchedCells = totalCells
  m = clone(DEAD());
  m.touchedCells += 1;
  ok(hasCode(read(71, m), 'TOUCH_GRID_TOUCHED_UNTOUCHED_SUM_MISMATCH', (a) => a.detail.totalCells === 194), '[ز] المجموع لا يطابق totalCells: شذوذ');
  // auto_complete ⟹ اكتمال المطلوبة (دلالتها تغيّرت مرّتين: كل الخلايا عدا المقصاة ثم، في «إطار + X»، كل الخلايا المطلوبة)
  m = clone(COMPLETE());
  m.untouchedCells = [3];
  m.touchedCells = 187;
  o = read(71, m);
  ok(hasCode(o, 'TOUCH_GRID_AUTO_COMPLETE_NOT_COMPLETE', (a) => a.detail.untouchedCells === 1 && a.detail.touchedCells === 187 && a.detail.totalCells === 188), '[ز] auto_complete مع خلية مطلوبة غير ممسوحة: شذوذ (دلالة الاكتمال)');
  m = clone(DEAD());
  m.endReason = 'auto_complete';
  ok(hasCode(read(71, m), 'TOUCH_GRID_AUTO_COMPLETE_NOT_COMPLETE'), '[ز] auto_complete على تشغيل غير مكتمل (حمولة 13ch بثقب): شذوذ');
  eq(hasCode(read(71, DEAD()), 'TOUCH_GRID_AUTO_COMPLETE_NOT_COMPLETE'), false, '[ز] user_marked_not_working غير مكتمل: لا شذوذ (غير المكتمل مشروع حين الفنّي أنهاه)');
  // فهارس الخلايا
  for (const [label, list, expectedInvalid] of [['سالب', [-1, 2], 1], ['كسر', [1.5], 1], ['نصّ', ['1'], 1], ['خارج الشبكة', [594], 1], ['كلّها صالحة', [0, 593], 0]]) {
    m = clone(COMPLETE());
    m.cutoutCells = list;
    m.totalCells = 594 - 406 - list.filter((v) => Number.isInteger(v) && v >= 0 && v < 594).length; // 594 خلية (18×33) − 406 غير مطلوبة (عيّنة 11ch) − المقصاة الصالحة
    m.untouchedCells = [];
    o = read(71, m);
    const a = own(o).find((x) => x.code === 'TOUCH_GRID_CELL_INDEX_INVALID' && x.detail.key === 'cutoutCells');
    eq(a === undefined ? 0 : a.detail.invalid, expectedInvalid, `[ز] فهرس خليّة ${label} في cutoutCells`);
  }
}

// ═══ ح) علامات العرض ═══════════════════════════════════════════════════════════════════════════════════════════════
{
  const DS = N.TOUCH_PATH_DISPLAYED_STATE;
  const pathOf = (o) => tgOf(o).path;
  let m = clone(DEAD());
  let o = read(71, m);
  eq([pathOf(o).displayedSuspects.state, pathOf(o).displayedSuspects.count, pathOf(o).displayedSuspectsStatus], [DS.DISPLAYED, 4, KS.PRESENT], '[ح] أربع علامات معروضة (عيّنة 13ch): DISPLAYED');
  eq([pathOf(o).analysis.displayedVsDetected.matchedCount, pathOf(o).analysis.displayedVsDetected.kindAgreeCount, pathOf(o).analysis.displayedVsDetected.displayedNotDetected.items.map((x) => x.kind)], [2, 2, ['edge_exit', 'edge_exit']],
      '[ح] علامتان (gap_jump وcoord_jump) يؤيّدهما ما كشفه الخادم بالنوع نفسه، وعلامتا edge_exit يعرضهما المُنتِج ولا يكشفهما الخادم — فرق يُرى لا شذوذ (معلّق: قاعدة المُنتِج لـedge_exit غير محدَّدة في القسم)');
  m.displayedSuspects = [];
  o = read(71, m);
  eq([pathOf(o).displayedSuspects.state, pathOf(o).displayedSuspectsStatus, pathOf(o).analysis.displayedVsDetected.state], [DS.DISPLAYED_NONE, KS.PRESENT, DS.DISPLAYED_NONE], '[ح] [] ⟵ عُرضت ولم تُرَ مواضع (غير غياب المفتاح)');
  delete m.displayedSuspects;
  o = read(71, m);
  eq([pathOf(o).displayedSuspects.state, pathOf(o).displayedSuspectsStatus, pathOf(o).analysis.displayedVsDetected.state, codes(o)], [DS.NOT_DISPLAYED, KS.ABSENT_DECLARED, DS.NOT_DISPLAYED, []], '[ح] غائب ⟵ لم تُعرض علامات: حالة معلنة بلا شذوذ');
  for (const kind of ['gap_jump', 'coord_jump', 'edge_exit']) {
    m = clone(DEAD());
    m.displayedSuspects = [{kind, strokeIndex: 0, fromPointIndex: 5, toPointIndex: 6}];
    o = read(71, m);
    eq([pathOf(o).displayedSuspects.items.items[0].kind, pathOf(o).displayedSuspects.items.items[0].kindRecognized, pathOf(o).displayedSuspects.problemCodes], [kind, true, []], `[ح] kind=${kind}: معروفة`);
  }
  for (const [label, el, code] of [['kind مجهولة', {kind: 'lift_break', strokeIndex: 0, fromPointIndex: 1, toPointIndex: 2}, 'KIND_UNRECOGNIZED'], ['kind غائبة', {strokeIndex: 0, fromPointIndex: 1, toPointIndex: 2}, 'KIND_INVALID'],
    ['فهرس غائب', {kind: 'gap_jump', strokeIndex: 0, fromPointIndex: 1}, 'INDEX_INVALID'], ['فهرس سالب', {kind: 'gap_jump', strokeIndex: -1, fromPointIndex: 1, toPointIndex: 2}, 'INDEX_INVALID'],
    ['خطّ غير موجود', {kind: 'gap_jump', strokeIndex: 9, fromPointIndex: 1, toPointIndex: 2}, 'INDEX_OUT_OF_RANGE'], ['نقطة خارج الخطّ', {kind: 'gap_jump', strokeIndex: 2, fromPointIndex: 1, toPointIndex: 99}, 'INDEX_OUT_OF_RANGE'],
    ['ليس كائناً', 5, 'NOT_OBJECT']]) {
    m = clone(DEAD());
    m.displayedSuspects = [el];
    o = read(71, m);
    ok(hasCode(o, `TOUCH_PATH_DISPLAYED_SUSPECT_${code}`), `[ح] علامة ${label}: شذوذ ${code}`);
  }
}

// ═══ ط) جواب M-02 اليدوي وعلاقته بالخامّ — pass بلا measurements حالة مشروعة بعد NeuralChek@5f90ce1 ═══════════════
{
  const ans = (o) => o.touchGridAnswer;
  const RAW = (endReason) => ({gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: endReason === 'auto_complete' ? 120 : 30, elapsedMs: 4165, timeToFirstTouchMs: 1730, endReason, maxSimultaneousPointers: 1});
  for (const fv of [69, 70, 71]) {
    // لا صفّ M-02
    eq(ans(R.readFv68(manualFp(fv, [{testId: 'M-07', status: 'pass'}]))), {state: AS.NOT_IN_MANUAL_RESULTS, manualStatus: null, passRawRelation: REL.NOT_APPLICABLE_NO_RAW, rawEndReason: null}, `[ط] ختم ${fv}: لا صفّ M-02`);
    // pass بلا measurements: المشروع
    const noRaw = read(fv, undefined, 'pass');
    eq(ans(noRaw), {state: AS.PASS_WITHOUT_RAW, manualStatus: 'pass', passRawRelation: REL.NOT_APPLICABLE_NO_RAW, rawEndReason: null}, `[ط] ختم ${fv}: pass بلا measurements ⟵ PASS_WITHOUT_RAW حالة صريحة`);
    eq([own(noRaw), noRaw.measurements.items, noRaw.measurements.expectedButAbsent], [[], [], []], `[ط] ختم ${fv}: ولا شذوذ ولا عنصر ولا «غائب متوقَّع» (مشروع: لا يُقرأ عطباً ولا نجاحاً مفترَضاً)`);
    // حالات أخرى بلا measurements
    for (const st of ['fail', 'not_tested', 'unavailable', 'warning']) eq(ans(read(fv, undefined, st)).state, AS.OTHER_STATUS_WITHOUT_RAW, `[ط] ختم ${fv}: ${st} بلا measurements ⟵ OTHER_STATUS_WITHOUT_RAW`);
    eq(ans(R.readFv68(manualFp(fv, [{testId: 'M-02', categoryName: 'display'}]))).state, AS.OTHER_STATUS_WITHOUT_RAW, `[ط] ختم ${fv}: بلا status أصلاً: OTHER_STATUS_WITHOUT_RAW ومنطوق الحالة null`);
    eq(ans(R.readFv68(manualFp(fv, [{testId: 'M-02', status: 5}]))).manualStatus, null, `[ط] ختم ${fv}: status بنوع خاطئ ⟵ manualStatus=null لا قيمة مخمَّنة`);
    // pass مع خامّ: يسنده auto_complete، وما عداه (خامّ سابق) لا يسنده
    for (const [endReason, rel] of [['auto_complete', REL.BACKS_PASS], ['user_marked_not_working', REL.DOES_NOT_BACK_PASS], ['user_marked_not_tested', REL.DOES_NOT_BACK_PASS], ['dismissed', REL.DOES_NOT_BACK_PASS]]) {
      const o = read(fv, RAW(endReason), 'pass');
      eq(ans(o), {state: AS.RAW_PRESENT, manualStatus: 'pass', passRawRelation: rel, rawEndReason: endReason}, `[ط] ختم ${fv}: pass + خامّ ${endReason} ⟵ ${rel}`);
    }
    eq(ans(read(fv, RAW('closed_by_system'), 'pass')).passRawRelation, REL.UNDETERMINED_NO_END_REASON, `[ط] ختم ${fv}: pass + endReason غير معروف ⟵ لا حكم`);
    const noEnd = RAW('auto_complete');
    delete noEnd.endReason;
    eq(ans(read(fv, noEnd, 'pass')).passRawRelation, REL.UNDETERMINED_NO_END_REASON, `[ط] ختم ${fv}: pass + endReason غائب ⟵ لا حكم`);
    // الحالة ليست pass: لا مقارنة (الحالة جواب الفنّي ولا تُستنتج من endReason)
    for (const st of ['fail', 'not_tested', 'unavailable', 'warning']) {
      eq(ans(read(fv, RAW('auto_complete'), st)).passRawRelation, REL.NOT_APPLICABLE_STATUS_NOT_PASS, `[ط] ختم ${fv}: ${st} + خامّ ⟵ لا مقارنة`);
    }
    // measurements بنوع خاطئ
    eq(ans(read(fv, 'x', 'pass')).state, AS.RAW_UNREADABLE, `[ط] ختم ${fv}: measurements نصّ ⟵ RAW_UNREADABLE (والشذوذ WRONG_TYPE في مكانه)`);
  }
  eq(Object.values(AS), ['NOT_IN_MANUAL_RESULTS', 'PASS_WITHOUT_RAW', 'OTHER_STATUS_WITHOUT_RAW', 'RAW_UNREADABLE', 'RAW_PRESENT'], '[ط] حالات الجواب الخمس جُرِّبت كلّها');
  eq(Object.values(REL), ['BACKS_PASS', 'DOES_NOT_BACK_PASS', 'UNDETERMINED_NO_END_REASON', 'NOT_APPLICABLE_STATUS_NOT_PASS', 'NOT_APPLICABLE_NO_RAW'], '[ط] علاقات pass بالخامّ الخمس جُرِّبت كلّها');
  // حمولة fv71 كاملة بحالة pass تسندها auto_complete
  eq(ans(read(71, COMPLETE(), 'pass')).passRawRelation, REL.BACKS_PASS, '[ط] fv71 الكاملة بـpass: BACKS_PASS');
}

// ═══ ي) المسار الكامل بالقارئ الحقيقي على الحمولة المبنيّة من العقد (القاعدة 37) ═════════════════════════════
{
  for (const s of Object.keys(PRODUCER).map((k) => ({key: k, payload: PRODUCER[k]}))) {
    const r = R.readFv68(clone(s.payload));
    eq(r.readerError, undefined, `[ي][${s.key}] القارئ لم يرمِ`);
    eq([r.fieldsVersion, r.applicable], [71, true], `[ي][${s.key}] الختم 71 مُنطبِق`);
    eq(own(r), [], `[ي][${s.key}] لا شذوذ في M-02 (حمولة المُنتِج كما شحنها)`);
    eq(r.anomalies.filter((a) => !a.section.startsWith('manualResults')).map((a) => a.code).length, r.anomalies.filter((a) => !a.section.startsWith('manualResults')).length, '[ي] ضابط بنية');
    const tg = tgOf(r);
    eq([tg.gridBasis, tg.path.state], [GB.MM_TARGET, PS.READ], `[ي][${s.key}] MM_TARGET ومقروءة`);
    // لا خامّ في المخرَج (القاعدة 20): لا مصفوفة x/y/dtMs/touchMajorPx في أيّ موضع
    const bad = [];
    const walk = (node, p) => {
      if (Array.isArray(node)) {
        node.forEach((x, i) => walk(x, `${p}[${i}]`));
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (['x', 'y', 'dtMs', 'touchMajorPx'].includes(k) && Array.isArray(v)) bad.push(`${p}.${k}`);
          walk(v, `${p}.${k}`);
        }
      }
    };
    walk(tg, 'touchGrid');
    eq(bad, [], `[ي][${s.key}] مخرَج القارئ بلا إحداثيات خامّ (القاعدة 20: الخامّ يبقى في reportRaw)`);
    ok(Buffer.byteLength(JSON.stringify(tg)) < 40000, `[ي][${s.key}] ومخرَج M-02 صغير (${Buffer.byteLength(JSON.stringify(tg))} بايتاً) رغم ${s.payload.manualResults.find((x) => x.testId === 'M-02').measurements.strokes.reduce((a, x) => a + x.x.length, 0)} نقطة`);
  }
  // لا مساس بالمُدخل
  const s = {payload: clone(PRODUCER['13ch'])};
  const before = JSON.stringify(s.payload);
  R.readFv68(s.payload);
  eq(JSON.stringify(s.payload), before, '[ي] readFv68 لا تعدّل الحمولة');
}

// ═══ ك) عزل ANALYSIS_ERROR: استثناء داخل touchPath لا يُسقط بقيّة قراءات الحمولة ═══════════════════════════════
{
  const tpPath = require.resolve('../src/analysis/touchPath');
  const rdPath = require.resolve('../src/analysis/fv68Reader');
  const savedTp = require.cache[tpPath];
  const savedRd = require.cache[rdPath];
  try {
    delete require.cache[rdPath];
    require.cache[tpPath] = {id: tpPath, filename: tpPath, loaded: true, exports: {analyzeTouchPath: () => { throw new Error('boom from stub'); }}};
    const R2 = require('../src/analysis/fv68Reader');
    const o = R2.readFv68(m02Fp(71, COMPLETE()));
    eq(o.readerError, undefined, '[ك] الاستثناء داخل التحليل لا يجعل readFv68 تُعيد readerError (لا تُسقط بقيّة الأقسام)');
    ok(o.layout !== undefined && o.measurements.items.length === 1, '[ك] بقيّة الأقسام مقروءة');
    const t = o.measurements.items[0].touchGrid;
    eq([t.path.analysis.detector.state, t.path.analysis.detector.error], [N.TOUCH_PATH_DETECTION_STATE.ANALYSIS_ERROR, '[Error] code=NO_CODE boom from stub'], '[ك] والحالة ANALYSIS_ERROR بنصّ الخطأ **منقّىً** (القاعدة 36: sanitizeFailureText: الصنف والرمز والنصّ)');
    ok(o.anomalies.some((a) => a.code === 'TOUCH_PATH_ANALYSIS_ERROR' && a.detail.message === '[Error] code=NO_CODE boom from stub'), '[ك] وتُعلَن شذوذاً بالنصّ المنقّى نفسه');
    eq([t.path.surfaceWidthPx, t.path.strokes.count], [1080, 1], '[ك] ومفاتيح الكتلة وملخّص الخطوط تبقى مقروءة');
  } finally {
    delete require.cache[rdPath];
    if (savedRd) require.cache[rdPath] = savedRd;
    if (savedTp) require.cache[tpPath] = savedTp;
    else delete require.cache[tpPath];
  }
}

console.log(`\nfv71TouchGridReader.test.js: ${n}/${n} assertions passed`);
