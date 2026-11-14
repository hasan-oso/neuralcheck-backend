'use strict';

// technicianFormContract.test.js — عقد استمارة الفنّي v2: التحقّق والاشتقاق والعمى (S-P6-08، 2026-10-18 +03). وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي في technicianForm.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠ (:1179-1376) وdocs/PROTOCOL_CONTRACT.md §٢ A5. الدوالّ نقيّة (القاعدة 41). **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن protocolVocabulary.js: انجراف الثابت يُفشل هذا الاختبار
// لا يتبعه). **معرّفات الفنّيين وهمية موسومة** (fake-tech-*): لا اسم فنّي ولا بيانات فنّي حقيقية في الكود ولا العيّنات.
//   ١ نسخة العقد والفتحة ومعرّف الفنّي      ٢ الدرجات الأربع (غير المُجاب null صريح، وفئات v1 تُرفض)   ٣ القائمة الوظيفية والعيوب الثلاثة (weak_battery مؤجَّل)
//   ٤ الأعراض وترتيبها المعروض وعطب معروف     ٥ صحّة البطارية  ٦ اللعبة والملاحظة (إلزامية دون «جيّد»، بلا سقف)   ٧ الأزمنة   ٨ لقطتا التنبيه وفعله
//   ٩ الفراغ والترتيب بين الأسباب وما لا يقبله الخادم من العميل   ١٠ deriveFormFlags   ١١ computeBlindness   ١٢ بنية الشيفرة
//
// Run: node functions/test/technicianFormContract.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const C = require('../src/evaluations/technicianFormContract');

const CHIPS = ['battery_dies_before_day_end', 'battery_jumps_or_shuts_down', 'battery_swollen', 'hot_while_charging', 'charging_slow', 'slow_or_freezes_daily',
  'restarts_under_load', 'heats_fast_in_use', 'system_heat_warning', 'game_stutter_after_minutes', 'game_screen_lines_or_flicker', 'games_freeze_or_close'];
const R = {
  VERSION: 'FORM_CONTRACT_VERSION_INVALID', SLOT: 'FORM_SLOT_INVALID', TECH: 'FORM_TECHNICIAN_UNKNOWN', GRADES: 'FORM_GRADES_INVALID', FUNC: 'FORM_FUNCTIONAL_INVALID',
  DEFECTS: 'FORM_DEFECTS_INVALID', SYMPTOMS: 'FORM_SYMPTOMS_INVALID', ORDER: 'FORM_SYMPTOM_ORDER_INVALID', BATTERY: 'FORM_BATTERY_HEALTH_INVALID',
  KNOWN: 'FORM_KNOWN_FAULT_INVALID', GAME: 'FORM_GAME_TRIED_INVALID', NOTE: 'FORM_NOTE_INVALID', TIMES: 'FORM_TIMES_INVALID', EMPTY: 'FORM_EMPTY',
};
const good = () => ({
  formContractVersion: 2, slot: 1, technicianId: 'fake-tech-A',
  grades: {battery: 'good', performance: 'excellent', thermal: 'good', overall: 'good'},
  functional: {screen_touch: 'works', camera: 'works', audio: 'works', buttons: 'works', charging: 'works', network: 'works'},
  defects: {replaced_screen: 'works', water_damage: 'works', prior_repair: 'works'},
  symptoms: ['none_noticed'], symptomOrderShown: [...CHIPS], known_fault_before_scan: false,
  batteryHealth: {kind: 'percent', percent: 92, stateKey: null}, gameTried: true, observedNote: null,
  openedAt: 1000, firstTapAt: 2000, perAnswerAt: [2000, 5000], submittedAt: 20000,
});
const run = (mut) => { const d = good(); mut(d); return C.normalizeTechnicianForm(d); };
const refused = (label, mut, code, cause) => {
  const r = run(mut);
  ok(r.ok === false && r.refusal === code, `${label}: يُرفض بـ${code} (${JSON.stringify(r.refusal || 'ok')})`);
  if (cause) ok(r.extra.includes(cause), `${label}: سبب القراءة في السجلّ يحمل «${cause}» (${r.extra})`);
};
const accepted = (label, mut) => { const r = run(mut); ok(r.ok === true, `${label}: يُقبل (${r.ok ? '' : r.refusal + r.extra})`); return r.form; };

// ═══ ٠ — الأساس الصحيح ═══
{
  const r = C.normalizeTechnicianForm(good());
  ok(r.ok === true, '[٠] الحمولة الأساسية مقبولة');
  deq(Object.keys(r.form).sort(), ['answersAfterPrompt', 'answersBeforePrompt', 'batteryHealth', 'batteryHealthState', 'defects', 'firstTapAt', 'functional', 'gameTried', 'grades', 'knownFaultBeforeScan',
    'observedNote', 'openedAt', 'perAnswerAt', 'promptAction', 'sentOffline', 'slot', 'submittedAt', 'symptomOrderShown', 'symptoms', 'technicianId'], '[٠] الحقول المطبَّعة بأسمائها (لا مشتقّات ولا ما يخصّ الخادم)');
  deq(r.form.batteryHealth, {kind: 'percent', percent: 92, stateKey: null}, '[٠] صحّة البطارية بنسبة');
  eq(r.form.batteryHealthState, 'answered', '[٠] وحالتها answered');
}

// ═══ ١ — النسخة والفتحة والفنّي ═══
for (const [label, v] of [['غائبة', undefined], ['null', null], ['1 (القديم يمرّ بـsubmitEvaluation لا هنا)', 1], ['نصّ «2»', '2'], ['3', 3], ['2.0000001', 2.0000001]]) {
  refused(`[١] formContractVersion ${label}`, (d) => { d.formContractVersion = v; }, R.VERSION);
}
for (const [label, v] of [['غائبة', undefined], ['null', null], ['0', 0], ['3', 3], ['نصّ «1»', '1'], ['1.5', 1.5], ['true', true]]) refused(`[١] slot ${label}`, (d) => { d.slot = v; }, R.SLOT);
eq(accepted('[١] slot 2', (d) => { d.slot = 2; }).slot, 2, '[١] الفتحة الثانية مقبولة شكلاً (بوابتها السحب في الخادم: submitTechnicianForm)');
for (const [label, v] of [['غائب', undefined], ['null', null], ['فارغ', ''], ['مسافات', '   '], ['رقم', 5], ['كائن', {}], ['فيه /', 'a/b'], ['.', '.'], ['..', '..'], ['129 محرفاً', 'x'.repeat(129)]]) {
  refused(`[١] technicianId ${label}`, (d) => { d.technicianId = v; }, R.TECH);
}
eq(accepted('[١] technicianId بطول 128', (d) => { d.technicianId = 'x'.repeat(128); }).technicianId.length, 128, '[١] ١٢٨ محرفاً مقبولة');
eq(accepted('[١] technicianId بمسافات حول', (d) => { d.technicianId = '  fake-tech-A  '; }).technicianId, 'fake-tech-A', '[١] يُخزَّن مقصوصاً');
ok(C.isSafeDocId('fake-tech-A') && !C.isSafeDocId('a/b') && !C.isSafeDocId('') && !C.isSafeDocId(null), '[١] isSafeDocId');

// ═══ ٢ — الدرجات الأربع ═══
deq(C.GRADE_CATEGORIES, ['battery', 'performance', 'thermal', 'overall'], '[٢] الفئات الأربع بترتيبها');
for (const [label, v] of [['مصفوفة', []], ['نصّ', 'good'], ['رقم', 5]]) refused(`[٢] grades ${label}`, (d) => { d.grades = v; }, R.GRADES, 'NOT_A_MAP');
for (const key of ['cpu_performance', 'memory', 'storage', 'display']) refused(`[٢] فئة غريبة «${key}» (v1 لا تُخلط بـv2)`, (d) => { d.grades = {[key]: 'good'}; }, R.GRADES, 'UNKNOWN_KEY');
for (const bad of ['A', '', 'Excellent', 'ok', 5, true, {}, []]) refused(`[٢] قيمة درجة ${JSON.stringify(bad)}`, (d) => { d.grades.battery = bad; d.observedNote = 'x'; }, R.GRADES, 'VALUE_NOT_ALLOWED');
{
  const f = accepted('[٢] grades غائبة وبقيّة الإجابات موجودة', (d) => { delete d.grades; });
  deq(f.grades, {battery: null, performance: null, thermal: null, overall: null}, '[٢] الدرجات الغائبة: أربعة مفاتيح null صريحة (القاعدة 22) — لا مفتاح غائب ولا not_tested');
  const g = accepted('[٢] جزئية', (d) => { d.grades = {overall: 'good', thermal: null}; });
  deq(g.grades, {battery: null, performance: null, thermal: null, overall: 'good'}, '[٢] جزئية: الباقي null');
  const nt = accepted('[٢] not_tested', (d) => { d.grades = {battery: 'not_tested', performance: 'good', thermal: 'good', overall: 'good'}; });
  eq(nt.grades.battery, 'not_tested', '[٢] not_tested خيار خامس صريح يتميّز من null');
}

// ═══ ٣ — القائمة الوظيفية والعيوب ═══
refused('[٣] functional بمفتاح غريب', (d) => { d.functional = {wifi: 'works'}; }, R.FUNC, 'UNKNOWN_KEY');
refused('[٣] functional بقيمة غريبة', (d) => { d.functional.camera = 'ok'; }, R.FUNC, 'VALUE_NOT_ALLOWED');
refused('[٣] functional مصفوفة', (d) => { d.functional = ['camera']; }, R.FUNC, 'NOT_A_MAP');
for (const bad of ['', 'WORKS', true, 1]) refused(`[٣] functional قيمة ${JSON.stringify(bad)}`, (d) => { d.functional.audio = bad; }, R.FUNC);
{
  const f = accepted('[٣] functional غائبة', (d) => { delete d.functional; });
  deq(Object.keys(f.functional), ['screen_touch', 'camera', 'audio', 'buttons', 'charging', 'network'], '[٣] ستّة مفاتيح بترتيبها');
  ok(Object.values(f.functional).every((v) => v === null), '[٣] غير المُجاب null صريح (لا not_tested: P:1252)');
  const h = accepted('[٣] functional بعضها', (d) => { d.functional = {camera: 'faulty', network: 'not_tested'}; });
  deq([h.functional.camera, h.functional.network, h.functional.audio], ['faulty', 'not_tested', null], '[٣] الثلاث تعبر، والغائب null');
}
refused('[٣] defects بمفتاح weak_battery (مؤجَّل بقرار، لا يُقبل في v2)', (d) => { d.defects = {weak_battery: 'faulty'}; }, R.DEFECTS, 'UNKNOWN_KEY');
refused('[٣] defects بمفتاح none_noticed', (d) => { d.defects = {none_noticed: 'works'}; }, R.DEFECTS, 'UNKNOWN_KEY');
refused('[٣] defects بقيمة غريبة (صفوف بالحالات الثلاث نفسها)', (d) => { d.defects.water_damage = 'present'; }, R.DEFECTS, 'VALUE_NOT_ALLOWED');
refused('[٣] defects مصفوفة (شكل v1)', (d) => { d.defects = ['water_damage']; }, R.DEFECTS, 'NOT_A_MAP');
{
  const f = accepted('[٣] defects غائبة', (d) => { delete d.defects; });
  deq(f.defects, {replaced_screen: null, water_damage: null, prior_repair: null}, '[٣] العيوب الثلاثة null صريحة');
}

// ═══ ٤ — الأعراض ═══
refused('[٤] symptoms نصّ', (d) => { d.symptoms = 'none_noticed'; }, R.SYMPTOMS, 'NOT_AN_ARRAY');
refused('[٤] symptoms بمفتاح غريب', (d) => { d.symptoms = ['headache']; }, R.SYMPTOMS, 'VALUE_NOT_ALLOWED');
refused('[٤] symptoms برقم', (d) => { d.symptoms = [1]; }, R.SYMPTOMS);
refused('[٤] symptoms بتكرار', (d) => { d.symptoms = ['charging_slow', 'charging_slow']; }, R.SYMPTOMS, 'DUPLICATE');
refused('[٤] none_noticed مع غيره', (d) => { d.symptoms = ['none_noticed', 'charging_slow']; }, R.SYMPTOMS, 'NONE_NOTICED_WITH_OTHERS');
refused('[٤] عرَض مختار لم يُعرض', (d) => { d.symptomOrderShown = ['charging_slow']; d.symptoms = ['battery_swollen']; }, R.SYMPTOMS, 'SELECTED_NOT_SHOWN');
refused('[٤] عطب معروف ليس عرَضاً (حقل لا قيمة)', (d) => { d.symptoms = ['known_fault_before_scan']; }, R.SYMPTOMS);
eq(accepted('[٤] مختار ضمن المعروض', (d) => { d.symptomOrderShown = ['charging_slow', 'battery_swollen']; d.symptoms = ['battery_swollen']; }).symptoms[0], 'battery_swollen', '[٤] مختار ضمن المعروض يُقبل');
eq(accepted('[٤] none_noticed وحدها ولو غاب من المعروض', (d) => { d.symptomOrderShown = ['charging_slow']; d.symptoms = ['none_noticed']; }).symptoms[0], 'none_noticed', '[٤] none_noticed جواب صريح خارج الاثنتي عشرة');
eq(accepted('[٤] symptoms غائبة', (d) => { delete d.symptoms; }).symptoms, null, '[٤] غير المُجاب: null («الفراغ «لم يُجب»، لا «لا أعراض»»)');
eq(accepted('[٤] symptoms مصفوفة فارغة', (d) => { d.symptoms = []; }).symptoms, null, '[٤] المصفوفة الفارغة = لم يُجب أيضاً (null)');
for (const [label, v, cause] of [['غائب', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['نصّ', 'x', 'NOT_AN_ARRAY'], ['فارغ', [], 'EMPTY'], ['بتكرار', ['charging_slow', 'charging_slow'], 'DUPLICATE'],
  ['يحوي none_noticed (ليس رقاقة)', ['none_noticed'], 'VALUE_NOT_ALLOWED'], ['مفتاح غريب', ['x'], 'VALUE_NOT_ALLOWED']]) {
  refused(`[٤] symptomOrderShown ${label}`, (d) => { d.symptomOrderShown = v; d.symptoms = null; }, R.ORDER, cause);
}
eq(accepted('[٤] ثلاث رقائق معروضة (≤ 12)', (d) => { d.symptomOrderShown = ['charging_slow', 'battery_swollen', 'heats_fast_in_use']; d.symptoms = null; }).symptomOrderShown.length, 3, '[٤] المعروض أقلّ من اثنتي عشرة مقبول (P:783 ≤ 12)');
deq(C.SYMPTOM_CHIPS, CHIPS, '[٤] الرقائق الاثنتا عشرة بترتيب الجدول، بلا none_noticed');
for (const bad of ['true', 1, 0, {}, []]) refused(`[٤] known_fault_before_scan = ${JSON.stringify(bad)}`, (d) => { d.known_fault_before_scan = bad; }, R.KNOWN, 'NOT_A_BOOLEAN');
eq(accepted('[٤] عطب معروف true', (d) => { d.known_fault_before_scan = true; }).knownFaultBeforeScan, true, '[٤] true');
eq(accepted('[٤] عطب معروف غائب', (d) => { delete d.known_fault_before_scan; }).knownFaultBeforeScan, null, '[٤] غائب: null (لا false)');

// ═══ ٥ — صحّة البطارية ═══
{
  const f = accepted('[٥] غائبة', (d) => { delete d.batteryHealth; });
  deq([f.batteryHealth, f.batteryHealthState], [null, 'not_answered'], '[٥] غير المملوء: null بحالة not_answered (P:1293)');
  deq([accepted('[٥] null', (d) => { d.batteryHealth = null; }).batteryHealthState], ['not_answered'], '[٥] null أيضاً');
  for (const p of [0, 100, 50]) deq(accepted(`[٥] نسبة ${p}`, (d) => { d.batteryHealth = {kind: 'percent', percent: p}; }).batteryHealth, {kind: 'percent', percent: p, stateKey: null}, `[٥] نسبة ${p} مقبولة (stateKey null صريح)`);
  for (const s of ['normal', 'weak', 'bad']) deq(accepted(`[٥] حالة ${s}`, (d) => { d.batteryHealth = {kind: 'state', stateKey: s}; }).batteryHealth, {kind: 'state', percent: null, stateKey: s}, `[٥] حالة ${s}`);
  const ns = accepted('[٥] لا تظهر', (d) => { d.batteryHealth = {kind: 'not_shown'}; });
  deq([ns.batteryHealth, ns.batteryHealthState], [{kind: 'not_shown', percent: null, stateKey: null}, 'answered'], '[٥] «لا تظهر» جواب (answered) لا فراغ');
}
for (const [label, v, cause] of [['نصّ', 'x', 'NOT_A_MAP'], ['مصفوفة', [], 'NOT_A_MAP'], ['بلا kind', {percent: 5}, 'KIND_NOT_ALLOWED'], ['kind غريب', {kind: 'level'}, 'KIND_NOT_ALLOWED'],
  ['مفتاح غريب', {kind: 'percent', percent: 5, note: 'x'}, 'UNKNOWN_KEY'], ['نسبة 101', {kind: 'percent', percent: 101}, 'PERCENT_NOT_INTEGER_0_100'], ['نسبة -1', {kind: 'percent', percent: -1}, 'PERCENT_NOT_INTEGER_0_100'],
  ['نسبة كسرية', {kind: 'percent', percent: 50.5}, 'PERCENT_NOT_INTEGER_0_100'], ['نسبة نصّية', {kind: 'percent', percent: '50'}, 'PERCENT_NOT_INTEGER_0_100'], ['نسبة غائبة', {kind: 'percent'}, 'PERCENT_NOT_INTEGER_0_100'],
  ['نسبة معها حالة', {kind: 'percent', percent: 50, stateKey: 'normal'}, 'STATE_KEY_WITH_PERCENT'], ['حالة غريبة', {kind: 'state', stateKey: 'ok'}, 'STATE_KEY_NOT_ALLOWED'],
  ['حالة غائبة', {kind: 'state'}, 'STATE_KEY_NOT_ALLOWED'], ['حالة معها نسبة', {kind: 'state', stateKey: 'weak', percent: 70}, 'PERCENT_WITH_STATE'],
  ['not_shown بنسبة', {kind: 'not_shown', percent: 5}, 'VALUE_WITH_NOT_SHOWN'], ['not_shown بحالة', {kind: 'not_shown', stateKey: 'bad'}, 'VALUE_WITH_NOT_SHOWN']]) {
  refused(`[٥] batteryHealth ${label}`, (d) => { d.batteryHealth = v; }, R.BATTERY, cause);
}

// ═══ ٦ — اللعبة والملاحظة ═══
for (const bad of ['true', 1, 'نعم', {}]) refused(`[٦] gameTried = ${JSON.stringify(bad)}`, (d) => { d.gameTried = bad; }, R.GAME, 'NOT_A_BOOLEAN');
eq(accepted('[٦] gameTried false', (d) => { d.gameTried = false; }).gameTried, false, '[٦] false جواب صريح');
eq(accepted('[٦] gameTried غائب', (d) => { delete d.gameTried; }).gameTried, null, '[٦] غائب: null');
for (const bad of [5, true, {}, []]) refused(`[٦] observedNote ${JSON.stringify(bad)}`, (d) => { d.observedNote = bad; }, R.NOTE, 'NOT_A_STRING');
eq(accepted('[٦] ملاحظة بمسافات', (d) => { d.observedNote = '  شيء ما  '; }).observedNote, 'شيء ما', '[٦] تُقصّ');
eq(accepted('[٦] ملاحظة مسافات وحدها (والدرجات جيّدة)', (d) => { d.observedNote = '   '; }).observedNote, null, '[٦] مسافات وحدها = لا ملاحظة (null)');
eq(accepted('[٦] ملاحظة طويلة جداً — لا سقف (معلّق)', (d) => { d.observedNote = 'ي'.repeat(50000); }).observedNote.length, 50000, '[٦] لا سقف على طول observedNote (مؤجَّل بقرار)');
for (const level of ['fair', 'weak']) {
  for (const cat of ['battery', 'performance', 'thermal', 'overall']) {
    refused(`[٦] ${cat} = ${level} بلا ملاحظة`, (d) => { d.grades[cat] = level; d.observedNote = null; }, R.NOTE, 'REQUIRED_BELOW_GOOD');
    eq(accepted(`[٦] ${cat} = ${level} مع ملاحظة`, (d) => { d.grades[cat] = level; d.observedNote = 'ملاحظة'; }).observedNote, 'ملاحظة', `[٦] ${cat} = ${level} مع ملاحظة يُقبل`);
  }
}
refused('[٦] درجة ضعيفة وملاحظة مسافات وحدها', (d) => { d.grades.thermal = 'weak'; d.observedNote = '   '; }, R.NOTE, 'REQUIRED_BELOW_GOOD');
accepted('[٦] not_tested وغير المُجاب لا يطلبان ملاحظة', (d) => { d.grades = {battery: 'not_tested', thermal: null, performance: 'good', overall: 'excellent'}; d.observedNote = null; });

// ═══ ٧ — الأزمنة ═══
for (const field of ['openedAt', 'firstTapAt', 'submittedAt']) {
  refused(`[٧] ${field} غائب`, (d) => { delete d[field]; }, R.TIMES, 'ABSENT');
  for (const [label, bad] of [['null', null], ['نصّ', '2000'], ['NaN', NaN], ['Infinity', Infinity], ['سالب', -1], ['كائن', {}], ['منطقي', true]]) {
    refused(`[٧] ${field} = ${label}`, (d) => { d[field] = bad; }, R.TIMES, field);
  }
}
refused('[٧] أوّل لمسة قبل الفتح', (d) => { d.openedAt = 3000; }, R.TIMES, 'FIRST_TAP_BEFORE_OPENED');
refused('[٧] الإرسال قبل أوّل لمسة', (d) => { d.submittedAt = 1500; d.perAnswerAt = []; }, R.TIMES, 'SUBMITTED_BEFORE_FIRST_TAP');
accepted('[٧] أزمنة متساوية (حدّ المساواة)', (d) => { d.openedAt = 5; d.firstTapAt = 5; d.submittedAt = 5; d.perAnswerAt = [5]; });
refused('[٧] perAnswerAt غائبة', (d) => { delete d.perAnswerAt; }, R.TIMES, 'field=perAnswerAt');
refused('[٧] perAnswerAt نصّ', (d) => { d.perAnswerAt = '2000'; }, R.TIMES, 'NOT_AN_ARRAY');
refused('[٧] perAnswerAt بعنصر نصّي', (d) => { d.perAnswerAt = [2000, '3000']; }, R.TIMES, 'ENTRY_OUT_OF_RANGE');
refused('[٧] perAnswerAt قبل الفتح', (d) => { d.perAnswerAt = [999]; }, R.TIMES, 'ENTRY_OUT_OF_RANGE');
refused('[٧] perAnswerAt بعد الإرسال', (d) => { d.perAnswerAt = [20001]; }, R.TIMES, 'ENTRY_OUT_OF_RANGE');
accepted('[٧] perAnswerAt فارغة', (d) => { d.perAnswerAt = []; });
eq(accepted('[٧] perAnswerAt بحدّها 200', (d) => { d.perAnswerAt = Array.from({length: 200}, (_, i) => 2000 + i); }).perAnswerAt.length, 200, '[٧] ٢٠٠ عنصر مقبولة (الحدّ التقني)');
refused('[٧] perAnswerAt بـ201', (d) => { d.perAnswerAt = Array.from({length: 201}, (_, i) => 2000 + i); }, R.TIMES, 'TOO_MANY_ENTRIES');
eq(C.MAX_PER_ANSWER_ENTRIES, 200, '[٧] سقف perAnswerAt 200 (حدّ تقني اختارته الشيفرة، معلَن)');
{
  const src = good().perAnswerAt;
  const r = C.normalizeTechnicianForm({...good(), perAnswerAt: src});
  ok(r.form.perAnswerAt !== src && r.form.perAnswerAt.join() === src.join(), '[٧] perAnswerAt تُنسخ (لا مرجع إلى مصفوفة العميل)');
}

// ═══ ٨ — لقطتا التنبيه وفعله ═══
{
  const f = accepted('[٨] بلا تنبيه', () => {});
  deq([f.answersBeforePrompt, f.answersAfterPrompt, f.promptAction], [null, null, null], '[٨] بلا تنبيه: الثلاثة null');
  const snap = {battery: 'weak', performance: 'good', thermal: 'good', overall: 'good'};
  const g = accepted('[٨] بتنبيه', (d) => { d.answersBeforePrompt = snap; d.answersAfterPrompt = {...snap, overall: 'fair'}; d.promptAction = 'will_review'; d.grades = {...snap, overall: 'fair'}; d.observedNote = 'x'; });
  deq([g.answersBeforePrompt.overall, g.answersAfterPrompt.overall, g.promptAction], ['good', 'fair', 'will_review'], '[٨] اللقطتان والفعل تُخزَّن');
  eq(accepted('[٨] فعل الإرسال المؤكَّد', (d) => { d.answersBeforePrompt = snap; d.answersAfterPrompt = snap; d.promptAction = 'confirmed_send'; d.grades = snap; d.observedNote = 'x'; }).promptAction, 'confirmed_send', '[٨] confirmed_send');
  refused('[٨] فعل بلا لقطتين', (d) => { d.promptAction = 'will_review'; }, R.GRADES, 'PROMPT_RECORD_INCOMPLETE');
  refused('[٨] لقطة قبل بلا بعد', (d) => { d.answersBeforePrompt = snap; d.promptAction = 'will_review'; }, R.GRADES, 'PROMPT_RECORD_INCOMPLETE');
  refused('[٨] لقطتان بلا فعل', (d) => { d.answersBeforePrompt = snap; d.answersAfterPrompt = snap; }, R.GRADES, 'PROMPT_RECORD_INCOMPLETE');
  for (const bad of ['sent', '', 'CONFIRMED_SEND', 5]) refused(`[٨] فعل ${JSON.stringify(bad)}`, (d) => { d.answersBeforePrompt = snap; d.answersAfterPrompt = snap; d.promptAction = bad; }, R.GRADES, 'PROMPT_ACTION_NOT_ALLOWED');
  refused('[٨] لقطة قبل بقيمة غريبة', (d) => { d.answersBeforePrompt = {battery: 'A'}; d.answersAfterPrompt = snap; d.promptAction = 'will_review'; }, R.GRADES, 'PROMPT_SNAPSHOT_BEFORE_INVALID');
  refused('[٨] لقطة بعد بمفتاح غريب', (d) => { d.answersBeforePrompt = snap; d.answersAfterPrompt = {memory: 'good'}; d.promptAction = 'will_review'; }, R.GRADES, 'PROMPT_SNAPSHOT_AFTER_INVALID');
}

// ═══ ٩ — الفراغ والترتيب وما يُهمَل من العميل ═══
{
  const empty = (d) => {
    delete d.grades; delete d.functional; delete d.defects; delete d.symptoms; delete d.known_fault_before_scan; delete d.batteryHealth; delete d.gameTried; delete d.observedNote;
  };
  refused('[٩] استمارة بلا أيّ جواب', empty, R.EMPTY);
  for (const [label, add] of [['درجة', (d) => { d.grades = {overall: 'good'}; }], ['وظيفي', (d) => { d.functional = {audio: 'works'}; }], ['عيب', (d) => { d.defects = {prior_repair: 'works'}; }],
    ['أعراض', (d) => { d.symptoms = ['none_noticed']; }], ['عطب معروف false', (d) => { d.known_fault_before_scan = false; }], ['صحّة بطارية «لا تظهر»', (d) => { d.batteryHealth = {kind: 'not_shown'}; }],
    ['لعبة false', (d) => { d.gameTried = false; }], ['ملاحظة', (d) => { d.observedNote = 'x'; }]]) {
    accepted(`[٩] جواب واحد وحده (${label}) يكفي لئلّا تكون فارغة`, (d) => { empty(d); add(d); });
  }
  // الترتيب بين الأسباب: النسخة ← الفتحة ← الفنّي ← الدرجات ← … ← الأزمنة ← الفراغ
  const allBad = (d) => { d.formContractVersion = 9; d.slot = 9; d.technicianId = ''; d.grades = 'x'; d.functional = 'x'; d.defects = 'x'; d.symptoms = 'x'; d.symptomOrderShown = 'x'; d.known_fault_before_scan = 'x'; d.batteryHealth = 'x'; d.gameTried = 'x'; d.observedNote = 5; d.openedAt = 'x'; };
  const steps = [['formContractVersion', 'VERSION'], ['slot', 'SLOT'], ['technicianId', 'TECH'], ['grades', 'GRADES'], ['functional', 'FUNC'], ['defects', 'DEFECTS'], ['symptoms', 'SYMPTOMS'], ['symptomOrderShown', 'ORDER'],
    ['known_fault_before_scan', 'KNOWN'], ['batteryHealth', 'BATTERY'], ['gameTried', 'GAME'], ['observedNote', 'NOTE'], ['openedAt', 'TIMES']];
  for (const [i, [, code]] of steps.entries()) {
    const r = run((d) => { allBad(d); for (const [fixed] of steps.slice(0, i)) { const g = good(); d[fixed] = g[fixed]; } });
    eq(r.refusal, R[code], `[٩] الخطوة ${i + 1}: أوّل سبب بالترتيب ${code}`);
  }
  // ما يخصّ الخادم لا يُقبل من العميل ولا يصل المطبَّع
  const f = accepted('[٩] مشتقّات من العميل تُهمَل', (d) => {
    Object.assign(d, {fast: true, allFourGradesEqual: true, blindness: 'blind', blindnessBasis: 'report_first_opened', clock: 'device', receivedAt: 1, ownerId: 'someone', sessionId: 's', formState: 'abandoned', contradictionRules: ['x'], reportFirstOpenedAt: 5});
  });
  for (const k of ['fast', 'allFourGradesEqual', 'blindness', 'blindnessBasis', 'clock', 'receivedAt', 'ownerId', 'sessionId', 'formState', 'contradictionRules', 'reportFirstOpenedAt']) ok(!(k in f), `[٩] «${k}» من العميل لا يصل الناتج (يحسبه الخادم)`);
  eq(accepted('[٩] sentOffline = true', (d) => { d.sentOffline = true; }).sentOffline, true, '[٩] sentOffline true');
  for (const bad of ['true', 1, undefined, null]) eq(accepted(`[٩] sentOffline = ${JSON.stringify(bad)}`, (d) => { d.sentOffline = bad; }).sentOffline, false, '[٩] غير true بالضبط = false');
  eq(C.normalizeTechnicianForm(undefined).refusal, R.VERSION, '[٩] بلا حمولة: رفض النسخة');
  eq(C.normalizeTechnicianForm('x').refusal, R.VERSION, '[٩] حمولة نصّ: رفض النسخة');
  const d0 = good();
  C.normalizeTechnicianForm(d0);
  deq(d0, good(), '[٩] لا تعدّل مدخلها');
}

// ═══ ١٠ — deriveFormFlags ═══
{
  const flags = (grades, first = 2000, sub = 20000) => C.deriveFormFlags({grades: {battery: null, performance: null, thermal: null, overall: null, ...grades}, firstTapAt: first, submittedAt: sub});
  const four = (v) => ({battery: v, performance: v, thermal: v, overall: v});
  for (const v of ['excellent', 'good', 'fair', 'weak', 'not_tested']) eq(flags(four(v)).allFourGradesEqual, true, `[١٠] الأربع «${v}» متساوية`);
  eq(flags({...four('good'), overall: 'excellent'}).allFourGradesEqual, false, '[١٠] واحدة تخالف ⟵ false');
  eq(flags({battery: 'good', performance: 'good', thermal: 'good'}).allFourGradesEqual, false, '[١٠] واحدة غائبة (null) ⟵ false (لا تُعدّ «متساوية»)');
  eq(flags({}).allFourGradesEqual, false, '[١٠] كلّها غائبة ⟵ false');
  eq(flags({}, 0, 7999).fast, true, '[١٠] 7999 مل ث ⟵ fast');
  eq(flags({}, 0, 8000).fast, false, '[١٠] 8000 مل ث بالضبط ⟵ ليس fast (< 8 ث)');
  eq(flags({}, 1000, 1000).fast, true, '[١٠] صفر ⟵ fast');
  eq(C.FAST_SUBMIT_MS, 8000, '[١٠] FAST_SUBMIT_MS = 8000 (PLAN-06:1345)');
  eq(C.deriveFormFlags({grades: four('good'), firstTapAt: NaN, submittedAt: 5}).fast, null, '[١٠] زمن غير منتهٍ ⟵ null (الغياب صريح)');
  const rule = 'overall_high_with_weak_category';
  for (const overall of ['excellent', 'good']) {
    for (const cat of ['battery', 'performance', 'thermal']) {
      deq(flags({battery: 'good', performance: 'good', thermal: 'good', overall, [cat]: 'weak'}).contradictionRules, [rule], `[١٠] عامّ ${overall} مع ${cat} ضعيف ⟵ تناقض`);
    }
  }
  deq(flags({battery: 'weak', performance: 'weak', thermal: 'weak', overall: 'good'}).contradictionRules, [rule], '[١٠] ثلاث ضعيفة: قاعدة واحدة (بلا تكرار)');
  for (const overall of ['fair', 'weak', 'not_tested', null]) deq(flags({battery: 'weak', overall}).contradictionRules, [], `[١٠] عامّ ${JSON.stringify(overall)} مع فئة ضعيفة ⟵ لا تناقض`);
  deq(flags({battery: 'good', performance: 'good', thermal: 'good', overall: 'weak'}).contradictionRules, [], '[١٠] العامّ وحده ضعيف ⟵ لا تناقض');
  deq(flags({battery: 'fair', performance: 'fair', thermal: 'fair', overall: 'excellent'}).contradictionRules, [], '[١٠] متوسطة لا ضعيفة ⟵ لا تناقض');
  deq(flags({battery: 'not_tested', performance: 'good', thermal: 'good', overall: 'good'}).contradictionRules, [], '[١٠] not_tested لا يُعدّ ضعيفاً');
}

// ═══ ١١ — computeBlindness ═══
{
  const T = 1_000_000;
  const b = (o) => C.computeBlindness({reportExists: true, reportFirstOpenedMs: null, reportCreatedMs: null, submittedMs: T, receivedMs: T, sentOffline: false, ...o});
  deq(b({reportExists: false}), {blindness: 'blind', blindnessBasis: 'report_not_yet_created', clock: null}, '[١١] لا تقرير بعد ⟵ blind بأساس مسمّى وبلا ساعة');
  deq(b({reportExists: false, sentOffline: true, receivedMs: T + 9e9}), {blindness: 'blind', blindnessBasis: 'report_not_yet_created', clock: null}, '[١١] لا تقرير: الإرسال دون شبكة لا يغيّر شيئاً (لا مقارنة)');
  deq(b({reportFirstOpenedMs: T + 1}), {blindness: 'blind', blindnessBasis: 'report_first_opened', clock: 'server'}, '[١١] أُرسلت قبل أوّل فتح ⟵ blind (ساعة الخادم)');
  deq(b({reportFirstOpenedMs: T}), {blindness: 'not_blind', blindnessBasis: 'report_first_opened', clock: 'server'}, '[١١] عند اللحظة نفسها ⟵ not_blind (قبل الفتح بالضبط وحده blind)');
  deq(b({reportFirstOpenedMs: T - 1}), {blindness: 'not_blind', blindnessBasis: 'report_first_opened', clock: 'server'}, '[١١] بعد الفتح ⟵ not_blind');
  deq(b({reportCreatedMs: T + 1}), {blindness: 'blind', blindnessBasis: 'created_at_fallback', clock: 'server'}, '[١١] لا فتح مسجَّل: المرجع إنشاء التقرير، بأساس created_at_fallback');
  deq(b({reportCreatedMs: T - 5}), {blindness: 'not_blind', blindnessBasis: 'created_at_fallback', clock: 'server'}, '[١١] أُرسلت بعد إنشاء التقرير ولا فتح مسجَّل ⟵ not_blind بالمرجع الاحتياطي');
  deq(b({reportFirstOpenedMs: T - 10, reportCreatedMs: T + 10}), {blindness: 'not_blind', blindnessBasis: 'report_first_opened', clock: 'server'}, '[١١] الفتح يسبق الإنشاء في الاستعمال (المرجع الفتح حين يوجد)');
  deq(b({}), {blindness: 'unverifiable', blindnessBasis: null, clock: null}, '[١١] تقرير بلا مرجعين ⟵ unverifiable بلا أساس ولا ساعة');
  deq(b({reportFirstOpenedMs: NaN, reportCreatedMs: 'x'}), {blindness: 'unverifiable', blindnessBasis: null, clock: null}, '[١١] مرجعان غير صالحَين ⟵ unverifiable');
  // دون شبكة: ساعة الجهاز submittedAt، وتُوسم clock: device
  deq(b({sentOffline: true, submittedMs: T - 100, receivedMs: T + 9e6, reportFirstOpenedMs: T}), {blindness: 'blind', blindnessBasis: 'report_first_opened', clock: 'device'}, '[١١] أُرسلت دون شبكة: يُحكم بساعة الجهاز (قبل الفتح) ولو وصلت متأخّرة');
  deq(b({sentOffline: false, submittedMs: T - 100, receivedMs: T + 9e6, reportFirstOpenedMs: T}), {blindness: 'not_blind', blindnessBasis: 'report_first_opened', clock: 'server'}, '[١١] وبلا علم الإرسال دون شبكة: ساعة الخادم (وصلت بعد الفتح)');
  deq(b({sentOffline: true, submittedMs: T + 100, receivedMs: T - 9e6, reportCreatedMs: T}), {blindness: 'not_blind', blindnessBasis: 'created_at_fallback', clock: 'device'}, '[١١] ساعة الجهاز بعد المرجع ⟵ not_blind');
}

// ═══ ١٢ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'evaluations', 'technicianFormContract.js'), 'utf8'));
deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]), ['../protocol/protocolVocabulary'], '[١٢] مستورد واحد: protocolVocabulary (لا Firestore ولا admin ولا I/O)');
ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|collection\(|\.doc\(|runTransaction|admin|console\./.test(code), '[١٢] لا Firestore ولا حذف ولا سجلّ (القاعدة 42؛ الدوالّ نقيّة)');
ok(!/weak_battery/.test(code), '[١٢] weak_battery لا يظهر (مؤجَّل بقرار)');
{
  // المفردات المعتمَدة (protocolVocabulary) لا حرفيّة لها هنا؛ والأربعة الاقتراحية تُعلَن حرفاً مرّة واحدة في الكتلة المسمّاة أعلى الملفّ (وتُصدَّر)، لا في أيّ مكان آخر.
  // («percent» خارج القائمة عمداً: هو اسم حقل في batteryHealth لا قيمة فقط — E36: أسماء الحقول حرفيّة هنا وحدها.)
  const approved = /["'`](excellent|good|fair|weak|not_tested|works|faulty|battery|performance|thermal|overall|state|not_shown|normal|bad|blind|not_blind|unverifiable|report_first_opened|created_at_fallback|not_answered)["'`]/;
  ok(!approved.test(code), '[١٢] لا حرفيّة مفردة معتمَدة في الشيفرة: كلّها من protocolVocabulary (القاعدة 24)');
  const proposed = ['report_not_yet_created', 'server', 'device', 'answered', 'confirmed_send', 'will_review'];
  for (const lit of proposed) eq(code.split('"' + lit + '"').length - 1, 1, `[١٢] الحرفية الاقتراحية «${lit}» تُعلَن مرّة واحدة بالضبط`);
}
deq({...C.FORM_CLOCK}, {SERVER: 'server', DEVICE: 'device'}, '[١٢] FORM_CLOCK: device من التصميم (P:1324)، server اقتراحي');
deq({...C.PROMPT_ACTION}, {CONFIRMED_SEND: 'confirmed_send', WILL_REVIEW: 'will_review'}, '[١٢] PROMPT_ACTION اقتراحي');
eq(C.BATTERY_HEALTH_ANSWERED, 'answered', '[١٢] BATTERY_HEALTH_ANSWERED اقتراحي');
eq(C.BLINDNESS_BASIS_NO_REPORT, 'report_not_yet_created', '[١٢] BLINDNESS_BASIS_NO_REPORT اقتراحي');
ok(!/cpu_performance|memory|storage/.test(code), '[١٢] لا فئات v1 (RATING_CATEGORIES القائم لا يُمسّ)');
deq(Object.keys(C).sort(), ['BATTERY_HEALTH_ANSWERED', 'BLINDNESS_BASIS_NO_REPORT', 'FAST_SUBMIT_MS', 'FORM_CLOCK', 'FORM_SLOT', 'GRADE_CATEGORIES', 'MAX_PER_ANSWER_ENTRIES', 'PROMPT_ACTION', 'SYMPTOM_CHIPS', 'computeBlindness', 'deriveFormFlags', 'isSafeDocId', 'normalizeTechnicianForm'], '[١٢] التصدير: ثوابت وقيم وقوائم ودوالّ، لا أسماء حقول (E36)');
deq({...C.FORM_SLOT}, {FIRST: 1, SECOND: 2}, '[١٢] FORM_SLOT');
ok(Object.isFrozen(C.FORM_SLOT) && Object.isFrozen(C.GRADE_CATEGORIES) && Object.isFrozen(C.SYMPTOM_CHIPS), '[١٢] المجمَّدات');

console.log(`\ntechnicianFormContract.test.js: ${n}/${n} assertions passed`);
