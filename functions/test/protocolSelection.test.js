'use strict';

// protocolSelection.test.js — قراءة إعدادات البروتوكول وقرار «الاختيار بنسبة» (S-P6-07، 2026-10-21 +03). وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي في repeatScan.e2e.test.js.
//
// المواصفة: PLAN-06 §٤-ب-١/٢ (:617-626) و§٦-ب-١ (:767-793) و§٦-ج (:893) وdocs/PROTOCOL_CONTRACT.md §٢ A4 وA10. الدوالّ نقيّة (القاعدة 41).
// **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن الوحدات).
//   ١ readSettingsDocument: غائب · بلا version صالح (شذوذ مسمّى) · حاضر؛ settingsVersionOf
//   ٢ readRateField: غائب · خارج [0,1] · غير عدد · حدّان صالحان؛ readCollectionPhase: منطقي صريح وحده
//   ٣ decideSelection: ترتيب الأسباب (إعدادات ← جزء ← بوّابات ← نسبة) والقرعة والحدّ draw < rate؛ لا قيمة افتراضية لـrandom؛ draw خارج [0,1) خطأ
//   ٤ readProtocolSettings على قاعدة مُحاكاة بسيطة (get بمعرّف المستند وحده: القاعدة 43)
//   ٥ بنية الشيفرة: لا حذف، لا حرفية مفردة من المفردات
//
// Run: node functions/test/protocolSelection.test.js

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

const S = require('../src/protocol/protocolSettings');
const {decideSelection} = require('../src/protocol/protocolSelection');

// ═══ ١ — readSettingsDocument ═══
{
  deq(S.readSettingsDocument(null), {state: 'ABSENT', version: null, data: null, anomaly: null}, '[١] null ⟵ ABSENT بلا شذوذ');
  deq(S.readSettingsDocument(undefined), {state: 'ABSENT', version: null, data: null, anomaly: null}, '[١] undefined ⟵ ABSENT بلا شذوذ');
  for (const [label, d] of [['بلا version', {repeatRate: 0.25}], ['version صفر', {version: 0}], ['version سالب', {version: -1}], ['version كسر', {version: 1.5}], ['version نصّ', {version: '1'}], ['version null', {version: null}], ['مصفوفة', []], ['نصّ', 'x']]) {
    const r = S.readSettingsDocument(d);
    deq([r.state, r.version, r.data, r.anomaly], ['ABSENT', null, null, 'VERSION_UNUSABLE'], `[١] مستند موجود ${label} ⟵ يُقرأ غائباً ويُعلَن شذوذه (لا يُقرأ حاضراً بلا نسخة)`);
  }
  const doc = {version: 4, repeatRate: 0.25};
  const r = S.readSettingsDocument(doc);
  deq([r.state, r.version, r.data === doc, r.anomaly], ['PRESENT', 4, true, null], '[١] version عدد صحيح موجب ⟵ PRESENT');
  eq(S.settingsVersionOf(r), 4, '[١] settingsVersionOf(حاضر) = رقم النسخة');
  eq(S.settingsVersionOf(S.readSettingsDocument(null)), 'SETTINGS_ABSENT', '[١] settingsVersionOf(غائب) = SETTINGS_ABSENT');
  eq(S.readSettingsDocument({version: 1}).state, 'PRESENT', '[١] النسخة 1 (الأولى) حاضرة');
  eq(S.readSettingsDocument({version: Number.MAX_SAFE_INTEGER}).state, 'PRESENT', '[١] أيّ عدد صحيح موجب حاضر');
}

// ═══ ٢ — الحقول ═══
{
  const absent = S.readSettingsDocument(null);
  deq(S.readRateField(absent, 'repeatRate'), {state: 'ABSENT', value: null}, '[٢] الإعدادات غائبة ⟵ حقل النسبة ABSENT');
  const mk = (v) => S.readSettingsDocument({version: 1, repeatRate: v});
  deq(S.readRateField(S.readSettingsDocument({version: 1}), 'repeatRate'), {state: 'ABSENT', value: null}, '[٢] مستند بلا الحقل ⟵ ABSENT');
  deq(S.readRateField(mk(null), 'repeatRate'), {state: 'ABSENT', value: null}, '[٢] الحقل null ⟵ ABSENT (لا يُقرأ صفراً)');
  for (const v of [0, 0.1, 0.25, 0.3, 1]) deq(S.readRateField(mk(v), 'repeatRate'), {state: 'SET', value: v}, `[٢] النسبة ${v} صالحة (الحدّان 0 و1 داخلان)`);
  for (const v of [-0.0001, 1.0001, 2, -1, 25, '0.25', '', NaN, Infinity, -Infinity, true, {}, [], [0.1]]) {
    deq(S.readRateField(mk(v), 'repeatRate'), {state: 'INVALID', value: null}, `[٢] النسبة ${JSON.stringify(v)} ⟵ INVALID`);
  }
  const both = S.readSettingsDocument({version: 2, repeatRate: 0.25, doubleEvalRate: 0.1});
  eq(S.readRateField(both, 'doubleEvalRate').value, 0.1, '[٢] حقلان مستقلّان: يُقرأ كلٌّ باسمه');
  const cp = (v) => S.readCollectionPhase(S.readSettingsDocument({version: 1, collectionPhase: v}));
  deq(cp(true), {state: 'SET', value: true}, '[٢] collectionPhase true');
  deq(cp(false), {state: 'SET', value: false}, '[٢] collectionPhase false');
  deq(S.readCollectionPhase(S.readSettingsDocument({version: 1})), {state: 'ABSENT', value: null}, '[٢] collectionPhase غائب ⟵ ABSENT');
  deq(S.readCollectionPhase(absent), {state: 'ABSENT', value: null}, '[٢] الإعدادات غائبة ⟵ ABSENT');
  deq(cp(null), {state: 'ABSENT', value: null}, '[٢] collectionPhase null ⟵ ABSENT');
  for (const v of ['true', 'false', 1, 0, {}, [], 'yes']) deq(cp(v), {state: 'INVALID', value: null}, `[٢] collectionPhase ${JSON.stringify(v)} ليست منطقية ⟵ INVALID (لا تُقرأ true)`);
  deq(Object.values(S.SETTINGS_FIELD).sort(), ['blindnessAlertBelowPct', 'collectionPhase', 'doubleEvalRate', 'minAppVersion', 'openBeforeValidityHours', 'repeatRate', 'returnReasons', 'symptomChips', 'targets'], '[٢] أسماء حقول الإعدادات التسعة كما في A10 (P:777-785)');
}

// ═══ ٣ — decideSelection ═══
const PRESENT = (extra = {}) => S.readSettingsDocument({version: 7, repeatRate: 0.25, doubleEvalRate: 0.1, ...extra});
const PARTS = (extra = {}) => ({purposes: false, batteryBeforeAfter: false, coldRepeat: true, returns: false, doubleEval: false, consent: false, ...extra});
const NEVER = () => { throw new Error('random لا يجوز استدعاؤها قبل اجتياز كل البوّابات'); };
const sel = (o) => decideSelection({settings: PRESENT(), parts: PARTS(), partKey: 'coldRepeat', rateField: 'repeatRate', gates: [], random: () => 0.5, ...o});
{
  // الترتيب: إعدادات ← جزء ← بوّابات ← نسبة
  deq(sel({settings: S.readSettingsDocument(null), parts: PARTS({coldRepeat: false}), random: NEVER}), {state: 'NOT_ELIGIBLE', reason: 'SETTINGS_ABSENT', draw: null, rate: null, settingsVersion: 'SETTINGS_ABSENT'}, '[٣] إعدادات غائبة تسبق الجزء: SETTINGS_ABSENT وsettingsVersion SETTINGS_ABSENT (P:893: لا يُفترض 10%)');
  deq(sel({parts: PARTS({coldRepeat: false}), random: NEVER}), {state: 'NOT_ELIGIBLE', reason: 'PART_NOT_ENABLED', draw: null, rate: null, settingsVersion: 7}, '[٣] الجزء غير مفعَّل: PART_NOT_ENABLED ونسخة الإعدادات تُذكر');
  for (const bad of [undefined, null, 'true', 1, {}, false]) {
    eq(sel({parts: PARTS({coldRepeat: bad}), random: NEVER}).reason, 'PART_NOT_ENABLED', `[٣] الجزء ${JSON.stringify(bad)} ليس true بالضبط ⟵ PART_NOT_ENABLED`);
  }
  eq(sel({parts: undefined, random: NEVER}).reason, 'PART_NOT_ENABLED', '[٣] parts غائبة ⟵ PART_NOT_ENABLED');
  eq(sel({parts: {}, random: NEVER}).reason, 'PART_NOT_ENABLED', '[٣] parts فارغة ⟵ PART_NOT_ENABLED');
  // البوّابات بترتيبها: أوّل ساقطة تُسمّى
  deq(sel({gates: [{reason: 'G1', passes: false}, {reason: 'G2', passes: false}], random: NEVER}).reason, 'G1', '[٣] أوّل بوّابة ساقطة تُسمّى ولا تُقرأ التي بعدها');
  deq(sel({gates: [{reason: 'G1', passes: true}, {reason: 'G2', passes: false}], random: NEVER}).reason, 'G2', '[٣] الثانية تُسمّى إن نجحت الأولى');
  for (const notTrue of [undefined, null, 1, 'true', 0]) {
    eq(sel({gates: [{reason: 'G1', passes: notTrue}], random: NEVER}).reason, 'G1', `[٣] passes = ${JSON.stringify(notTrue)} ليس true بالضبط ⟵ ساقطة`);
  }
  // النسبة
  deq(sel({settings: S.readSettingsDocument({version: 7}), random: NEVER}), {state: 'NOT_ELIGIBLE', reason: 'RATE_ABSENT', draw: null, rate: null, settingsVersion: 7}, '[٣] النسبة غائبة: RATE_ABSENT (حالة غير SETTINGS_ABSENT: الإعدادات حاضرة)');
  for (const bad of [1.2, -0.1, '0.25', NaN]) {
    eq(sel({settings: PRESENT({repeatRate: bad}), random: NEVER}).reason, 'RATE_INVALID', `[٣] النسبة ${JSON.stringify(bad)} ⟵ RATE_INVALID`);
  }
  // القرعة والحدّ
  deq(sel({random: () => 0.2499}), {state: 'SELECTED', reason: null, draw: 0.2499, rate: 0.25, settingsVersion: 7}, '[٣] draw 0.2499 < 0.25 ⟵ SELECTED، ويُخزَّن draw وrate (فالسحب يُعاد حسابه)');
  deq(sel({random: () => 0.25}), {state: 'NOT_SELECTED', reason: null, draw: 0.25, rate: 0.25, settingsVersion: 7}, '[٣] draw = rate بالضبط ⟵ NOT_SELECTED (الاختيار draw < rate)');
  eq(sel({random: () => 0}).state, 'SELECTED', '[٣] draw 0 ⟵ SELECTED');
  eq(sel({random: () => 0.9999999}).state, 'NOT_SELECTED', '[٣] draw قرب 1 ⟵ NOT_SELECTED');
  eq(sel({settings: PRESENT({repeatRate: 1}), random: () => 0.9999999999}).state, 'SELECTED', '[٣] نسبة 1 تختار دائماً');
  eq(sel({settings: PRESENT({repeatRate: 0}), random: () => 0}).state, 'NOT_SELECTED', '[٣] نسبة 0 لا تختار أبداً (ولو draw = 0)');
  eq(sel({settings: PRESENT({repeatRate: 0}), random: () => 0}).rate, 0, '[٣] ونسبة 0 تُخزَّن 0 (قرعة جرت بنسبة صفر) لا null');
  eq(sel({settings: PRESENT({doubleEvalRate: 0.5, repeatRate: 0}), partKey: 'doubleEval', parts: PARTS({doubleEval: true, coldRepeat: false}), rateField: 'doubleEvalRate', random: () => 0.4}).state, 'SELECTED', '[٣] حقل النسبة والجزء يُمرَّران: التقييم المزدوج بنسبته لا نسبة التكرار');
  // لا قيمة افتراضية
  for (const bad of [undefined, null, 0.5, 'x']) throwsWith(() => decideSelection({settings: PRESENT(), parts: PARTS(), partKey: 'coldRepeat', rateField: 'repeatRate', gates: [], random: bad}), /random مُعامل صريح/, `[٣] random = ${JSON.stringify(bad)} ⟵ خطأ (لا افتراضي: القاعدة 22)`);
  throwsWith(() => decideSelection({settings: PRESENT(), parts: PARTS(), partKey: 'coldRepeat', rateField: 'repeatRate', random: () => 0.1}), /gates مصفوفة صريحة/, '[٣] gates غائبة ⟵ خطأ');
  for (const bad of [-0.1, 1, 1.5, NaN, 'a', null, undefined]) throwsWith(() => sel({random: () => bad}), /خارج \[0, 1\)/, `[٣] random تعيد ${JSON.stringify(bad)} ⟵ خطأ (لا قرعة بقيمة خارج [0,1))`);
  // الإعدادات غير حاضرة بشذوذ: SETTINGS_ABSENT
  eq(sel({settings: S.readSettingsDocument({repeatRate: 0.9}), random: NEVER}).reason, 'SETTINGS_ABSENT', '[٣] مستند بلا version ⟵ SETTINGS_ABSENT (لا يُختار منه)');
  // الأسباب من مصدر واحد
  const V = require('../src/protocol/protocolVocabulary');
  for (const r of ['SETTINGS_ABSENT', 'PART_NOT_ENABLED', 'RATE_ABSENT', 'RATE_INVALID']) ok(Object.values(V.REPEAT_NOT_ELIGIBLE_REASON).includes(r), `[٣] السبب ${r} من REPEAT_NOT_ELIGIBLE_REASON (مصدر واحد)`);
}

// ═══ ٤ — readProtocolSettings (get بمعرّف المستند) ═══
(async () => {
  const calls = [];
  const fakeDb = (snap) => ({collection: (c) => ({doc: (id) => ({get: async () => { calls.push(`${c}/${id}`); return snap; }})})});
  const absent = await S.readProtocolSettings({db: fakeDb({exists: false})});
  eq(absent.state, 'ABSENT', '[٤] المستند غير موجود ⟵ ABSENT');
  const present = await S.readProtocolSettings({db: fakeDb({exists: true, data: () => ({version: 2, repeatRate: 0.3})})});
  deq([present.state, present.version], ['PRESENT', 2], '[٤] المستند موجود ⟵ PRESENT بنسخته');
  deq(calls, ['protocolSettings/current', 'protocolSettings/current'], '[٤] قراءة واحدة بمعرّف المستند protocolSettings/current (لا استعلام ولا فهرس: القاعدة 43)');

  // ═══ ٥ — بنية الشيفرة ═══
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  for (const f of ['protocolSettings.js', 'protocolSelection.js']) {
    const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', f), 'utf8'));
    ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|\.set\(|\.add\(|\.update\(|\.where\(/.test(code), `[٥] ${f}: لا كتابة ولا حذف ولا استعلام (القاعدة 42/43)`);
    ok(!/["'`](SETTINGS_ABSENT|PART_NOT_ENABLED|RATE_ABSENT|RATE_INVALID|NOT_ELIGIBLE|NOT_SELECTED|SELECTED)["'`]/.test(code), `[٥] ${f}: لا حرفيّة مفردة من المفردات (القاعدة 24)`);
    ok(!/Math\.random/.test(code), `[٥] ${f}: لا Math.random في الوحدة (العشوائية تُمرَّر صراحةً)`);
  }
  console.log(`\nprotocolSelection.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
