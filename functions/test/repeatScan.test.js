'use strict';

// repeatScan.test.js — عقد التكرار البارد والساخن: القراءة والاختيار والتصنيف والإعفاء والتفويض (S-P6-07، 2026-10-21 +03). وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي في repeatScan.e2e.test.js.
//
// المواصفة: PLAN-06 §٤ (:596-681) وdocs/PROTOCOL_CONTRACT.md §٢ A4. الدوالّ نقيّة (القاعدة 41). **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن الوحدة).
//   ١ readStartTemp / readStoredStartTemp: حرارة البدء وحارس الصفر (`0.0 إن لم يصل بثّ`) — كل حالة بكل قيمها (القاعدة 30)
//   ٢ classifyRepeatScan: الحدّ ±1° (الحدّان داخلان) بدقّة عُشر الدرجة، وفخّ الفاصلة العائمة (33.8 − 32.8) وفخّ float32، وغياب الأولى/الثانية
//   ٣ isCreditExempt: التكرار البارد وحده مع collectionPhase true صريحة
//   ٤ buildRepeatRecord: سجلّ الاختيار بكل أسبابه وشكله؛ والبوّابات بترتيبها (الغرض ثم منضمّ الأمّ)
//   ٥ readRepeatChildContext وbuildChildSession وbuildChildPending وbuildChildProtocolFields
//   ٦ decidePairAccess وdecideRepeatStart: **كل قيمة من REPEAT_STATE (الإحدى عشرة)** × حكمها (القاعدة 30)، وتفويض الزوج، وE41
//   ٧ decideParentCompletion: تحديث الأمّ بشروطه
//   ٨ الرفوض: لكل رمز ردّ، لا نصّ عربي جديد (القرار ٩٠)، والمعتمَد منها E41
//   ٩ بنية الشيفرة: لا I/O، لا حذف، لا حرفية مفردة من المفردات
//
// Run: node functions/test/repeatScan.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
function throwsWith(fn, re, m) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  ok(e && re.test(e.message), `${m} (${e ? e.message : 'لم يرمِ'})`);
}

const R = require('../src/protocol/repeatScan');
const S = require('../src/protocol/protocolSettings');
const V = require('../src/protocol/protocolVocabulary');

const PRESENT = (v) => ({state: 'PRESENT', valueC: v});
const ABSENT = {state: 'ABSENT', valueC: null};

// ═══ ١ — حرارة البدء ═══
{
  deq(R.readStartTemp(undefined), {state: 'ABSENT', valueC: null}, '[١] غائبة ⟵ ABSENT');
  deq(R.readStartTemp(null), {state: 'ABSENT', valueC: null}, '[١] null ⟵ ABSENT');
  deq(R.readStartTemp(0), {state: 'SENTINEL_ZERO', valueC: 0}, '[١] 0.0 ⟵ SENTINEL_ZERO: حارس الغياب في الترويسة لا قياس (FV68_CONTRACT §١.٦)');
  deq(R.readStartTemp(-0), {state: 'SENTINEL_ZERO', valueC: 0}, '[١] -0 ⟵ SENTINEL_ZERO');
  for (const bad of ['32.8', '', NaN, Infinity, -Infinity, true, {}, [], [32.8]]) deq(R.readStartTemp(bad), {state: 'NOT_A_NUMBER', valueC: null}, `[١] ${JSON.stringify(bad)} ⟵ NOT_A_NUMBER`);
  deq(R.readStartTemp(32.8), {state: 'PRESENT', valueC: 32.8}, '[١] 32.8 ⟵ PRESENT بقيمتها الخام');
  deq(R.readStartTemp(32.79999923706055), {state: 'PRESENT', valueC: 32.79999923706055}, '[١] قيمة float32 الموسَّعة تُخزَّن خامّاً كما وصلت (القاعدة 20: لا تقريب في التخزين)');
  deq(R.readStartTemp(-5), {state: 'PRESENT', valueC: -5}, '[١] قيمة سالبة تُخزَّن كما وصلت (لا حكم عليها هنا)');
  // المخزَّن
  deq(R.readStoredStartTemp(undefined), {state: 'ABSENT', valueC: null}, '[١] مخزَّن غائب ⟵ ABSENT');
  deq(R.readStoredStartTemp(null), {state: 'ABSENT', valueC: null}, '[١] مخزَّن null ⟵ ABSENT');
  deq(R.readStoredStartTemp({state: 'PRESENT', valueC: 32.8}), {state: 'PRESENT', valueC: 32.8}, '[١] مخزَّن حاضر');
  deq(R.readStoredStartTemp({state: 'SENTINEL_ZERO', valueC: 0}), {state: 'SENTINEL_ZERO', valueC: 0}, '[١] مخزَّن بصفر الحارس');
  deq(R.readStoredStartTemp({state: 'ABSENT', valueC: null}), {state: 'ABSENT', valueC: null}, '[١] مخزَّن بحالة غياب');
  deq(R.readStoredStartTemp({state: 'NOT_A_NUMBER', valueC: null}), {state: 'NOT_A_NUMBER', valueC: null}, '[١] مخزَّن بحالة NOT_A_NUMBER');
  for (const bad of ['x', 5, [], {}, {state: 'PRESENT'}, {state: 'PRESENT', valueC: '32'}, {state: 'PRESENT', valueC: 0}, {state: 'PRESENT', valueC: NaN}, {state: 'WHATEVER', valueC: 1}, {state: 'STORED_MALFORMED', valueC: 1}, {valueC: 3}]) {
    eq(R.readStoredStartTemp(bad).state, 'STORED_MALFORMED', `[١] مخزَّن مشوَّه ${JSON.stringify(bad)} ⟵ STORED_MALFORMED (لا يُقرأ قياساً)`);
  }
}

// ═══ ٢ — التصنيف ═══
const cls = (a, b) => R.classifyRepeatScan({reference: a, second: b});
{
  // الحدّ: ≤ 1° بارد، > 1° ساخن، بدقّة عُشر الدرجة
  const table = [
    [32.8, 32.8, 'repeat_cold', 0], [32.8, 33.8, 'repeat_cold', 1], [32.8, 31.8, 'repeat_cold', -1], [32.8, 33.9, 'repeat_hot', 1.1], [32.8, 31.7, 'repeat_hot', -1.1],
    [32.8, 33.0, 'repeat_cold', 0.2], [32.8, 32.0, 'repeat_cold', -0.8], [30, 31, 'repeat_cold', 1], [30, 31.1, 'repeat_hot', 1.1], [35, 28, 'repeat_hot', -7], [32.8, 39.5, 'repeat_hot', 6.7],
  ];
  for (const [a, b, purpose, delta] of table) {
    const r = cls(PRESENT(a), PRESENT(b));
    deq([r.purpose, r.absence, r.deltaC, r.thresholdC], [purpose, null, delta, 1], `[٢] ${a} ← ${b}: ${purpose}، الفرق ${delta}`);
  }
  // فخّ الفاصلة العائمة: 32.2 − 31.2 = 1.0000000000000036 فلو قورن مباشرةً بـ1 لصُنّف ساخناً خطأً (قيس بـnode)
  ok(32.2 - 31.2 > 1 && 31.7 - 32.7 < -1, '[٢] (تحقّق من الفخّ) 32.2 − 31.2 أكبر من 1 بالفاصلة العائمة، و31.7 − 32.7 أصغر من −1');
  eq(cls(PRESENT(31.2), PRESENT(32.2)).purpose, 'repeat_cold', '[٢] ومع ذلك فالفرق عُشراً صحيح = 1.0 ⟵ بارد (الحدّ داخل)');
  eq(cls(PRESENT(32.7), PRESENT(31.7)).purpose, 'repeat_cold', '[٢] والاتّجاه المعاكس (−1.0) ⟵ بارد أيضاً');
  // فخّ float32 (القيم كما تصل مُوسَّعة): قيمتان فرقهما العُشري 1.0 بالضبط وفرقهما الخام ×10 = 10.000019 (فوق العتبة لو لم تُقرَّبا) أو 9.99998 (تحتها) — قيس بـnode
  ok(Math.fround(32.4) * 10 - Math.fround(31.4) * 10 > 10 && Math.fround(32.1) * 10 - Math.fround(31.1) * 10 < 10, '[٢] (تحقّق من الفخّ) فرق float32 الخام ×10 يقع فوق 10 تارةً وتحتها تارةً');
  eq(cls(PRESENT(31.399999618530273), PRESENT(32.400001525878906)).purpose, 'repeat_cold', '[٢] float32 فرقها الخام ×10 = 10.000019 ⟵ بارد (الفرق عُشراً 1.0: الحدّ داخل)');
  eq(cls(PRESENT(31.100000381469727), PRESENT(32.099998474121094)).purpose, 'repeat_cold', '[٢] float32 فرقها الخام ×10 = 9.99998 ⟵ بارد');
  eq(cls(PRESENT(31.399999618530273), PRESENT(32.400001525878906)).deltaC, 1, '[٢] والفرق المخزَّن 1 لا 1.0000190734863281');
  eq(cls(PRESENT(32.79999923706055), PRESENT(33.79999923706055)).purpose, 'repeat_cold', '[٢] قيمتا float32 فرقهما عُشراً 1.0 ⟵ بارد');
  eq(cls(PRESENT(32.79999923706055), PRESENT(33.900001525878906)).purpose, 'repeat_hot', '[٢] فرق 1.1 بقيم float32 ⟵ ساخن');
  // الغياب: التصنيف لا يُخمَّن
  for (const state of ['ABSENT', 'SENTINEL_ZERO', 'NOT_A_NUMBER', 'STORED_MALFORMED']) {
    const r = cls({state, valueC: state === 'SENTINEL_ZERO' ? 0 : null}, PRESENT(33));
    deq([r.purpose, r.absence, r.deltaC], ['repeat_unclassified', 'COOLING_REFERENCE_ABSENT', null], `[٢] الأولى ${state} ⟵ repeat_unclassified بسبب COOLING_REFERENCE_ABSENT (لا بارد)`);
    const r2 = cls(PRESENT(32.8), {state, valueC: state === 'SENTINEL_ZERO' ? 0 : null});
    deq([r2.purpose, r2.absence, r2.deltaC], ['repeat_unclassified', 'SECOND_START_TEMP_ABSENT', null], `[٢] الثانية ${state} ⟵ repeat_unclassified بسبب SECOND_START_TEMP_ABSENT`);
  }
  deq(cls(ABSENT, ABSENT).absence, 'COOLING_REFERENCE_ABSENT', '[٢] الاثنتان غائبتان: السبب الأوّل (المرجع) يُسمّى');
  eq(R.REPEAT_COLD_THRESHOLD_C, 1, '[٢] العتبة 1° (القرار ٣: «±1°»)');
  eq(R.TEMP_RESOLUTION_PER_C, 10, '[٢] دقّة عُشر الدرجة');
  // لا يعدّل مدخلاته
  const a = PRESENT(32.8), b = PRESENT(33.1);
  cls(a, b);
  deq([a, b], [PRESENT(32.8), PRESENT(33.1)], '[٢] لا تعدّل مدخلاتها');
}

// ═══ ٣ — الإعفاء ═══
{
  const phase = (v) => S.readCollectionPhase(S.readSettingsDocument({version: 1, ...(v === undefined ? {} : {collectionPhase: v})}));
  for (const purpose of ['repeat_cold', 'repeat_hot', 'repeat_unclassified']) {
    for (const [label, p, expected] of [['true', phase(true), purpose === 'repeat_cold'], ['false', phase(false), false], ['غائب', phase(undefined), false], ['مشوَّه', phase('true'), false], ['الإعدادات غائبة', S.readCollectionPhase(S.readSettingsDocument(null)), false]]) {
      eq(R.isCreditExempt({purpose}, p), expected, `[٣] ${purpose} + collectionPhase ${label} ⟵ ${expected ? 'معفى' : 'يُخصم'} (التكرار البارد وحده، والعلَم true صريحة)`);
    }
  }
  for (const purpose of ['normal', 'battery_after', 'NO_SESSION']) eq(R.isCreditExempt({purpose}, phase(true)), false, `[٣] غرض ${purpose} لا يُعفى بهذا الحكم`);
}

// ═══ ٤ — سجلّ الاختيار ═══
const PARTS = (extra = {}) => ({purposes: false, batteryBeforeAfter: false, coldRepeat: true, returns: false, doubleEval: false, consent: false, ...extra});
const SETTINGS = (extra = {}) => S.readSettingsDocument({version: 5, repeatRate: 0.25, ...extra});
const STAMP = {__stamp: 'decidedAt-marker'};
const rec = (o) => R.buildRepeatRecord({
  isSessionScan: true, scanPurpose: 'normal', sessionData: {ownerId: 'o', joinedBy: 'j'}, parts: PARTS(), settings: SETTINGS(), firstScanStartTemp: PRESENT(32.8), random: () => 0.1, decidedAt: STAMP, ...o,
});
{
  const sel = rec({});
  deq(sel, {
    state: 'SELECTED', reason: null, draw: 0.1, rate: 0.25, settingsVersion: 5, decidedAt: STAMP,
    firstScanStartTemp: {state: 'PRESENT', valueC: 32.8},
    priorRepeatCheck: {state: 'NOT_EVALUATED', reason: 'DEVICE_IDENTITY_UNAVAILABLE'},
  }, '[٤] السجلّ المختار: الحالة والسحب والنسبة والنسخة ووقت القرار + حرارة البدء الأولى + حالة الفحص «لا سابق مكتمل» غير المقيَّمة');
  deq(Object.keys(sel), ['state', 'reason', 'draw', 'rate', 'settingsVersion', 'decidedAt', 'firstScanStartTemp', 'priorRepeatCheck'], '[٤] ثمانية مفاتيح بالضبط (E8: repeat: {state, draw, rate, settingsVersion, decidedAt} + reason + firstScanStartTemp + priorRepeatCheck)');
  const notSel = rec({random: () => 0.9});
  deq([notSel.state, notSel.reason, notSel.draw, notSel.rate, notSel.firstScanStartTemp], ['NOT_SELECTED', null, 0.9, 0.25, null], '[٤] غير مختار: السحب والنسبة مخزَّنان، وحرارة البدء null («لا ينطبق»)');
  // الأسباب بترتيبها
  const reasonOf = (o) => rec({random: () => { throw new Error('لا قرعة'); }, ...o});
  deq([reasonOf({settings: S.readSettingsDocument(null)}).reason, reasonOf({settings: S.readSettingsDocument(null)}).settingsVersion], ['SETTINGS_ABSENT', 'SETTINGS_ABSENT'], '[٤] لا إعدادات ⟵ SETTINGS_ABSENT');
  eq(reasonOf({parts: PARTS({coldRepeat: false})}).reason, 'PART_NOT_ENABLED', '[٤] الجزء غير مفعَّل ⟵ PART_NOT_ENABLED');
  eq(reasonOf({parts: PARTS({purposes: true, coldRepeat: false})}).reason, 'PART_NOT_ENABLED', '[٤] جزء آخر مفعَّل لا يكفي');
  // الغرض: كل قيمة من SCAN_PURPOSE (القاعدة 30)
  for (const purpose of Object.values(V.SCAN_PURPOSE)) {
    const r = rec({scanPurpose: purpose, random: () => 0.1});
    eq(r.state, purpose === 'normal' ? 'SELECTED' : 'NOT_ELIGIBLE', `[٤] الغرض ${purpose}: ${purpose === 'normal' ? 'يُختار' : 'غير مؤهَّل'}`);
    if (purpose !== 'normal') eq(r.reason, 'PURPOSE_NOT_NORMAL', `[٤] الغرض ${purpose} ⟵ PURPOSE_NOT_NORMAL`);
  }
  // فحص بلا جلسة: غرضه NO_SESSION فلا أهلية، وsessionData لا يُقرأ
  eq(rec({isSessionScan: false, scanPurpose: 'NO_SESSION', sessionData: {joinedBy: 'j'}}).reason, 'PURPOSE_NOT_NORMAL', '[٤] فحص بلا جلسة: غير مؤهَّل');
  // E44: منضمّ الأمّ — كل شكل
  for (const [label, sessionData] of [['غائب', {ownerId: 'o'}], ['null', {joinedBy: null}], ['فارغ', {joinedBy: ''}], ['رقم', {joinedBy: 7}], ['كائن', {joinedBy: {}}], ['sessionData null', null], ['sessionData نصّ', 'x']]) {
    eq(reasonOf({sessionData}).reason, 'PARENT_JOINER_UNKNOWN', `[٤] joinedBy ${label} ⟵ PARENT_JOINER_UNKNOWN (E44: يُخفى العرض، لا تُختار SELECTED)`);
  }
  eq(rec({sessionData: {joinedBy: 'x'}}).state, 'SELECTED', '[٤] joinedBy نصّ غير فارغ ⟵ يُختار');
  // ترتيب البوّابتين: الغرض قبل المنضمّ
  eq(reasonOf({scanPurpose: 'battery_before', sessionData: {}}).reason, 'PURPOSE_NOT_NORMAL', '[٤] الغرض يسبق المنضمّ في الأسباب');
  // النسبة
  eq(reasonOf({settings: S.readSettingsDocument({version: 5})}).reason, 'RATE_ABSENT', '[٤] النسبة غائبة ⟵ RATE_ABSENT');
  eq(reasonOf({settings: SETTINGS({repeatRate: 2})}).reason, 'RATE_INVALID', '[٤] النسبة خارج المدى ⟵ RATE_INVALID');
  // حرارة البدء تُنسخ كما هي لـSELECTED بحالتها (ولو غائبة)
  for (const t of [ABSENT, {state: 'SENTINEL_ZERO', valueC: 0}, {state: 'NOT_A_NUMBER', valueC: null}, PRESENT(40.1)]) {
    deq(rec({firstScanStartTemp: t}).firstScanStartTemp, t, `[٤] المرجع ${t.state} يُنسخ كما هو (لا يمنع الاختيار؛ غيابه يُعلَن عند التصنيف)`);
  }
  // الشرط الثالث لا يُقيَّم
  for (const r of [rec({}), reasonOf({settings: S.readSettingsDocument(null)}), rec({random: () => 0.9})]) {
    deq(r.priorRepeatCheck, {state: 'NOT_EVALUATED', reason: 'DEVICE_IDENTITY_UNAVAILABLE'}, '[٤] «الهاتف بلا تكرار سابق مكتمل» غير مقيَّم في كل سجلّ (هويّة الجهاز غائبة): معلَن لا مفترَض');
  }
  throwsWith(() => R.buildRepeatRecord({scanPurpose: 'normal', sessionData: {}, parts: PARTS(), settings: SETTINGS(), firstScanStartTemp: ABSENT, random: () => 0.1, decidedAt: STAMP}), /isSessionScan غائب/, '[٤] isSessionScan غير مُمرَّر ⟵ خطأ');
  const parts = PARTS(), settings = SETTINGS(), sd = {joinedBy: 'j'};
  rec({parts, settings, sessionData: sd});
  deq([parts, sd], [PARTS(), {joinedBy: 'j'}], '[٤] لا تعدّل مدخلاتها');
}

// ═══ ٥ — الابن ═══
{
  const none = {isChild: false, parentSessionId: null, parentScanId: null, reference: {state: 'ABSENT', valueC: null}, startedBeforeCooling: null};
  for (const [label, pending] of [['null', null], ['undefined', undefined], ['فارغ', {}], ['purposeSource وحده', {purposeSource: 'selected'}], ['repeatOfSessionId فارغ', {repeatOfSessionId: ''}], ['رقم', {repeatOfSessionId: 5}], ['null', {repeatOfSessionId: null}], ['نصّ', 'x']]) {
    deq(R.readRepeatChildContext(pending), none, `[٥] pending ${label} ⟵ ليس ابناً`);
  }
  const full = R.readRepeatChildContext({repeatOfSessionId: 'P', repeatOfScanId: 'C', firstScanStartTemp: {state: 'PRESENT', valueC: 32.8}, startedBeforeCooling: true, purposeSource: 'repeat_flow'});
  deq(full, {isChild: true, parentSessionId: 'P', parentScanId: 'C', reference: {state: 'PRESENT', valueC: 32.8}, startedBeforeCooling: true}, '[٥] ابن كامل');
  const partial = R.readRepeatChildContext({repeatOfSessionId: 'P'});
  deq(partial, {isChild: true, parentSessionId: 'P', parentScanId: null, reference: {state: 'ABSENT', valueC: null}, startedBeforeCooling: null}, '[٥] ابن ناقص: الباقي غائبه حالة صريحة (لا اسم أمّ مختلَق ولا false)');
  eq(R.readRepeatChildContext({repeatOfSessionId: 'P', startedBeforeCooling: 'yes'}).startedBeforeCooling, null, '[٥] startedBeforeCooling غير منطقي ⟵ null (لا يُقرأ true)');
  eq(R.readRepeatChildContext({repeatOfSessionId: 'P', startedBeforeCooling: false}).startedBeforeCooling, false, '[٥] false تبقى false (غير null)');
  eq(R.readRepeatChildContext({repeatOfSessionId: 'P', firstScanStartTemp: 'x'}).reference.state, 'STORED_MALFORMED', '[٥] مرجع مشوَّه ⟵ STORED_MALFORMED');
  // الجلسة الابنة
  const parent = {ownerId: 'owner-1', joinedBy: 'joiner-1', status: 'completed', scanId: 'scan-1', code: 'NC-AAAAAA', deviceModel: 'X'};
  const exp = new Date(1000);
  const child = R.buildChildSession({parent, createdAt: STAMP, expiresAt: exp});
  deq(child, {ownerId: 'owner-1', joinedBy: 'joiner-1', status: 'scanning', createdAt: STAMP, expiresAt: exp, scanId: null, deviceModel: null}, '[٥] الجلسة الابنة (E41): ownerId وjoinedBy من الأمّ وscanning وexpiresAt وبلا code');
  ok(!('code' in child) && !('joinedAt' in child) && !('purpose' in child), '[٥] بلا code ولا joinedAt ولا purpose');
  const pending = R.buildChildPending({parentSessionId: 'S', parentScanId: 'C', reference: PRESENT(32.8), startedBeforeCooling: null});
  deq(pending, {repeatOfSessionId: 'S', repeatOfScanId: 'C', firstScanStartTemp: {state: 'PRESENT', valueC: 32.8}, startedBeforeCooling: null, purposeSource: 'repeat_flow'}, '[٥] protocolPending للابن (E8): الربط والمرجع وإعلان الفنّي (null غائباً) ومصدر الغرض');
  deq(R.readRepeatChildContext(pending).reference, {state: 'PRESENT', valueC: 32.8}, '[٥] ما كُتب يُقرأ كما كُتب (ذهاب وإياب)');
  // حقول بروتوكول الابن
  const cf = R.buildChildProtocolFields({context: R.readRepeatChildContext(pending), second: PRESENT(33.0), classification: cls(PRESENT(32.8), PRESENT(33.0))});
  deq(cf, {
    scanPurpose: 'repeat_cold', purposeSource: 'repeat_flow', repeatOf: {sessionId: 'S', scanId: 'C'},
    repeatClassification: {absence: null, firstScanStartTemp: {state: 'PRESENT', valueC: 32.8}, secondScanStartTemp: {state: 'PRESENT', valueC: 33}, deltaC: 0.2, thresholdC: 1, startedBeforeCooling: null},
  }, '[٥] حقول scanProtocol للابن');
  // حالة الأمّ بعد الاكتمال: كل غرض
  eq(R.completedStateFor('repeat_cold'), 'COMPLETED_COLD', '[٥] بارد ⟵ COMPLETED_COLD');
  eq(R.completedStateFor('repeat_hot'), 'COMPLETED_HOT', '[٥] ساخن ⟵ COMPLETED_HOT');
  eq(R.completedStateFor('repeat_unclassified'), 'COMPLETED_UNCLASSIFIED', '[٥] غير مصنَّف ⟵ COMPLETED_UNCLASSIFIED (لا بارد ولا ساخن)');
}

// ═══ ٦ — التفويض بالزوج والحالة ═══
const STATES = Object.values(V.REPEAT_STATE);
const SESS = (extra = {}) => ({ownerId: 'o', joinedBy: 'j', status: 'completed', scanId: 'scan-1', ...extra});
const PROT = (state, extra = {}) => ({repeat: {state, reason: null, firstScanStartTemp: {state: 'PRESENT', valueC: 32.8}, ...extra}});
{
  eq(STATES.length, 11, '[٦] إحدى عشرة حالة في REPEAT_STATE (العشر من التصميم + COMPLETED_UNCLASSIFIED)');
  const access = (o) => R.decidePairAccess({sessionData: SESS(), scanId: 'scan-1', protocolData: PROT('SELECTED'), ...o});
  deq(access({}), {ok: true, repeat: PROT('SELECTED').repeat, state: 'SELECTED'}, '[٦] زوج صحيح ⟵ يمرّ بسجلّه');
  // الزوج
  deq([access({sessionData: null}).refusal, access({sessionData: null}).extra], ['REPEAT_PAIR_NOT_FOUND', ' cause=SESSION_ABSENT'], '[٦] لا جلسة ⟵ PAIR_NOT_FOUND');
  deq([access({scanId: 'other'}).refusal, access({scanId: 'other'}).extra], ['REPEAT_PAIR_NOT_FOUND', ' cause=SCAN_ID_MISMATCH'], '[٦] scanId لا يطابق ⟵ PAIR_NOT_FOUND نفسه (لا يُكشف وجود جلسة)');
  for (const bad of [undefined, null, '', 5]) {
    deq([access({sessionData: SESS({scanId: bad})}).refusal, access({sessionData: SESS({scanId: bad})}).extra], ['REPEAT_PAIR_NOT_FOUND', ' cause=SESSION_SCAN_ID_ABSENT'], `[٦] scanId الجلسة ${JSON.stringify(bad)} ⟵ PAIR_NOT_FOUND (الغائب لا يطابق: القاعدة 22)`);
  }
  // الحالة: كل قيمة من حالات الجلسة
  for (const status of ['pending', 'scanning', 'expired', 'cancelled']) eq(access({sessionData: SESS({status})}).refusal, 'REPEAT_SESSION_NOT_COMPLETED', `[٦] جلسة ${status} ⟵ SESSION_NOT_COMPLETED`);
  for (const [label, sessionData] of [['بلا status', {ownerId: 'o', scanId: 'scan-1'}], ['status رقم', SESS({status: 4})], ['status مجهول', SESS({status: 'archived'})]]) eq(access({sessionData}).refusal, 'SESSION_STATUS_UNKNOWN', `[٦] ${label} ⟵ SESSION_STATUS_UNKNOWN (من JOIN_REFUSAL: مصدر واحد)`);
  // السجلّ
  deq([access({protocolData: null}).refusal, access({protocolData: null}).extra], ['REPEAT_RECORD_ABSENT', ' cause=NO_PROTOCOL_DOCUMENT'], '[٦] لا مستند scanProtocol ⟵ RECORD_ABSENT');
  for (const bad of [{}, {repeat: null}, {repeat: 'x'}, {repeat: []}]) deq([access({protocolData: bad}).refusal, access({protocolData: bad}).extra], ['REPEAT_RECORD_ABSENT', ' cause=NO_REPEAT_FIELD'], `[٦] scanProtocol بلا سجلّ repeat صالح ${JSON.stringify(bad)} ⟵ RECORD_ABSENT`);
  for (const bad of [{repeat: {}}, {repeat: {state: 5}}, {repeat: {state: 'WHATEVER'}}, {repeat: {state: 'selected'}}]) eq(access({protocolData: bad}).refusal, 'REPEAT_STATE_UNKNOWN', `[٦] repeat.state ${JSON.stringify(bad.repeat.state)} ⟵ STATE_UNKNOWN`);
  // قرار البدء: كل قيمة من REPEAT_STATE
  const startable = ['SELECTED', 'PROMPT_DELIVERED', 'WAITING_COOLING', 'DECLINED'];
  const done = ['STARTED', 'COMPLETED_COLD', 'COMPLETED_HOT', 'COMPLETED_UNCLASSIFIED', 'EXPIRED'];
  const notChosen = ['NOT_ELIGIBLE', 'NOT_SELECTED'];
  deq([...startable, ...done, ...notChosen].sort(), [...STATES].sort(), '[٦] التصنيف الثلاثي يغطّي كل حالات REPEAT_STATE بلا نقص ولا زيادة');
  deq([...R.REPEAT_STARTABLE_STATES].sort(), [...startable].sort(), '[٦] القابلة للبدء: مختار ولم يبدأ (بما فيها DECLINED «ليس الآن»)');
  deq([...R.REPEAT_STARTED_OR_DONE_STATES].sort(), [...done].sort(), '[٦] بدأ أو اكتمل أو انقضى');
  for (const state of STATES) {
    const r = R.decideRepeatStart({state, sessionData: SESS()});
    if (startable.includes(state)) deq(r, {ok: true}, `[٦] ${state} ⟵ يبدأ`);
    else if (done.includes(state)) deq([r.ok, r.refusal, r.extra], [false, 'REPEAT_ALREADY_STARTED', ` repeatState=${state}`], `[٦] ${state} ⟵ ALREADY_STARTED («ولم يبدأ»)`);
    else deq([r.ok, r.refusal, r.extra], [false, 'REPEAT_NOT_SELECTED', ` repeatState=${state}`], `[٦] ${state} ⟵ NOT_SELECTED`);
  }
  // E41: منضمّ الأمّ — كل شكل (الاختبار نفسه الذي في isJoinedBy)
  for (const [jb, word] of [[undefined, 'absent'], [null, 'null'], ['', 'empty'], [5, 'invalid-type'], [{}, 'invalid-type'], [true, 'invalid-type']]) {
    const r = R.decideRepeatStart({state: 'SELECTED', sessionData: SESS({joinedBy: jb})});
    deq([r.ok, r.refusal, r.extra], [false, 'REPEAT_PARENT_JOINER_UNKNOWN', ` joinedByState=${word}`], `[٦] joinedBy ${JSON.stringify(jb)} ⟵ REPEAT_PARENT_JOINER_UNKNOWN بحالة ${word} (E41: الغائب والفارغ وغير النصّ لا يُقرأ هويةً)`);
  }
  for (const oid of [undefined, null, '', 3]) eq(R.decideRepeatStart({state: 'SELECTED', sessionData: SESS({ownerId: oid})}).refusal, 'REPEAT_PARENT_OWNER_UNKNOWN', `[٦] ownerId ${JSON.stringify(oid)} ⟵ PARENT_OWNER_UNKNOWN`);
  eq(R.decideRepeatStart({state: 'STARTED', sessionData: SESS({joinedBy: null})}).refusal, 'REPEAT_ALREADY_STARTED', '[٦] ترتيب الرفض: الحالة قبل المنضمّ');
}

// ═══ ٧ — تحديث الأمّ ═══
{
  const parent = (state, extra = {}) => ({repeat: {state, childSessionId: 'child-1', ...extra}});
  deq(R.decideParentCompletion({parentData: parent('STARTED'), childSessionId: 'child-1'}), {update: true, reason: null}, '[٧] STARTED لهذا الابن ⟵ تُحدَّث');
  eq(R.decideParentCompletion({parentData: null, childSessionId: 'child-1'}).reason, 'PARENT_DOCUMENT_ABSENT', '[٧] الأمّ غائبة ⟵ لا تحديث بسبب مسمّى');
  eq(R.decideParentCompletion({parentData: {}, childSessionId: 'child-1'}).reason, 'PARENT_RECORD_UNREADABLE:REPEAT_RECORD_ABSENT', '[٧] بلا سجلّ repeat ⟵ PARENT_RECORD_UNREADABLE');
  eq(R.decideParentCompletion({parentData: parent('NOPE'), childSessionId: 'child-1'}).reason, 'PARENT_RECORD_UNREADABLE:REPEAT_STATE_UNKNOWN', '[٧] حالة مجهولة ⟵ PARENT_RECORD_UNREADABLE');
  for (const state of STATES.filter((s) => s !== 'STARTED')) deq(R.decideParentCompletion({parentData: parent(state), childSessionId: 'child-1'}), {update: false, reason: `PARENT_NOT_STARTED:${state}`}, `[٧] الأمّ ${state} ⟵ لا تحديث (PARENT_NOT_STARTED)`);
  eq(R.decideParentCompletion({parentData: parent('STARTED'), childSessionId: 'child-2'}).reason, 'PARENT_CHILD_MISMATCH', '[٧] ابن آخر ⟵ لا تحديث');
  eq(R.decideParentCompletion({parentData: {repeat: {state: 'STARTED'}}, childSessionId: 'child-1'}).reason, 'PARENT_CHILD_MISMATCH', '[٧] الأمّ بلا childSessionId ⟵ لا تحديث (الغياب لا يطابق)');
  deq(Object.keys(R.PARENT_COMPLETION_SKIP).sort(), ['PARENT_CHILD_MISMATCH', 'PARENT_DOCUMENT_ABSENT', 'PARENT_NOT_STARTED', 'PARENT_RECORD_UNREADABLE', 'PARENT_SCAN_ID_ABSENT'], '[٧] خمسة أسباب لعدم التحديث');
}

// ═══ ٨ — الرفوض ═══
{
  const codes = Object.values(R.REPEAT_CALL_REFUSAL);
  deq(Object.keys(R.REPEAT_REFUSAL_RESPONSE).sort(), [...codes].sort(), '[٨] لكل رمز رفض ردّ، ولا ردّ بلا رمز');
  eq(R.REPEAT_CALL_REFUSAL.PARENT_JOINER_UNKNOWN, 'REPEAT_PARENT_JOINER_UNKNOWN', '[٨] الرمز المعتمَد E41 حرفياً');
  eq(R.REPEAT_CALL_REFUSAL.PARENT_JOINER_UNKNOWN, V.REPEAT_REFUSAL.PARENT_JOINER_UNKNOWN, '[٨] ومصدره protocolVocabulary (مصدر واحد)');
  eq(R.REPEAT_CALL_REFUSAL.SESSION_STATUS_UNKNOWN, require('../src/sessions/sessionNames').JOIN_REFUSAL.STATUS_UNKNOWN, '[٨] SESSION_STATUS_UNKNOWN من JOIN_REFUSAL (مصدر واحد)');
  const arabic = new Set();
  for (const [reason, spec] of Object.entries(R.REPEAT_REFUSAL_RESPONSE)) {
    deq(Object.keys(spec).sort(), ['clientReasonCode', 'code', 'message'], `[٨] ${reason}: ردّ بثلاثة مفاتيح`);
    ok(['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition'].includes(spec.code), `[٨] ${reason}: رمز HttpsError معروف (${spec.code})`);
    eq(spec.clientReasonCode, reason, `[٨] ${reason}: يصل العميل بالرمز نفسه`);
    if (/[؀-ۿ]/.test(spec.message)) arabic.add(spec.message); else eq(spec.message, reason, `[٨] ${reason}: بلا نصّ قائم فرسالته رمزه (لا نصّ عربي جديد: القرار ٩٠)`);
  }
  deq([...arabic].sort(), ['sessionId مطلوب', 'جلسة الفحص غير صالحة', 'يجب تسجيل الدخول'].sort(), '[٨] النصوص العربية ثلاثة قائمة فقط (لا نصّ جديد يصل مستخدماً)');
  ok(Object.isFrozen(R.REPEAT_CALL_REFUSAL) && Object.isFrozen(R.REPEAT_REFUSAL_RESPONSE), '[٨] مجمَّدان');
}

// ═══ ٩ — بنية الشيفرة ═══
{
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'repeatScan.js'), 'utf8'));
  deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).sort(), ['../sessions/sessionLifecycle', '../sessions/sessionNames', './protocolSelection', './protocolSettings', './protocolVocabulary'], '[٩] مستورَدات نقيّة فقط (لا Firestore ولا admin)');
  ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|\.get\(|\.set\(|\.add\(|\.update\(|\.where\(|Math\.random/.test(code), '[٩] لا قراءة ولا كتابة ولا حذف ولا استعلام ولا Math.random (القاعدة 42/43؛ الدالّة نقيّة)');
  ok(!/["'`](repeat_cold|repeat_hot|repeat_unclassified|repeat_flow|normal|COOLING_REFERENCE_ABSENT|PURPOSE_NOT_NORMAL|PARENT_JOINER_UNKNOWN|SELECTED|STARTED|COMPLETED_COLD|COMPLETED_HOT|PROTOCOL_EXEMPT|scanning|completed)["'`]/.test(code), '[٩] لا حرفيّة مفردة من المفردات في الشيفرة: كلّها من protocolVocabulary وsessionNames (القاعدة 24)');
  ok(!/deviceId|identityState|matchedBy|HMAC/.test(code), '[٩] لا حقول هوية ولا HMAC (S-P6-01 معلّقة)');
}

console.log(`\nrepeatScan.test.js: ${n}/${n} assertions passed`);
