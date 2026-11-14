'use strict';

// fv71VolumeButtonReader.test.js — قارئ أحداث أزرار الصوت الخامّة M-09/M-10 في fv71، S-VOL، 2026-10-18 +03.
//
// المواصفة: docs/FV71_CONTRACT_SECTION.md ف-04 (E22) — «القسم المنسوخ». قرار المستخدم (2026-10-14، `NEURALCHECK-FINDINGS.md:9453` بنصّه عن أمر المنسّق): «Station 2, fv71, with raw (Recommended)».
// **أسماء المفاتيح:** [م] اعتُمدت بـE22 بقراءة المُنتِج (قسم f9e0571، «أسماء [م]»). وما يعلّقه القسم ولا يحدّده — أيّ الاختبارين رفع (عيّنات المُنتِج الثلاث: M-09 ⟵ 24 وM-10 ⟵ 25 دائماً، والقسم صامت)، نوع flags — لا يُفرض هنا:
// يُختبَر أنه **لا يُفرض** (القارئ لا يحكم بتخمين). **وما أجاب عنه القسم الجديد** (معنى العدّادين: «ضغطات down بـrepeat = 0»، والمفاتيح المسجَّلة «عائلة الصوت 24 · 25 · 164») صار يُفرض بالكتلة «ح».
//
// ما يثبّته:
//   أ) المفاتيح الأربعة عشر وأنواعها وحضورها مكتوبة باليد من القسم (القاعدة 30)، وكل اسم يظهر في نصّه.
//   ب) كتلة volumeButton بحالتها بحسب الختم: < 71 ⟵ NOT_IN_FIELDS_VERSION (وحضور مفاتيحها مبكّراً شذوذ)، بلا ختم ⟵ UNDETERMINED، ≥ 71 ⟵ READ.
//   جـ) القيم المعدَّدة كلّها (القاعدة 30): endReason الخمس · detectionSource الاثنتان · action الاثنتان · expectedKeyCode (24 · 25 · غيرهما).
//   د) الحضور والغياب (القاعدة 22): كل مفتاح ALWAYS غائبٌ ⟵ شذوذ؛ والمشروطة (timeToFirstExpectedDownMs · holdMs · detectionSource) بعلاقاتها بكل حالاتها؛ والاختيارية (flags · مستويات الصوت) حالة معلنة،
//      وغيابها شذوذ حين يقوم عليها قرار الكشف بتغيّر المستوى.
//   هـ) events[]: السقف 64 وeventsTotal (قُصَّت القائمة ⟵ يُعلنه القارئ) وكل مشكلة عنصر؛ و`[]` لا تُقرأ نجاحاً ولا فشلاً (pressEvidence).
//   و) جواب M-09/M-10 اليدوي: بلا measurements حالة صريحة لا خطأ.
//   ز) المسار الكامل بالقارئ الحقيقي على حمولات المُنتِج الثلاث (القاعدة 37).
//   ح) العدّادان مقابل events[] وعائلة مفاتيح الصوت (قسم f9e0571) — شذوذ حين لا يتطابقان والقائمة كاملة.
//
// **الحمولات هنا من المُنتِج (مزامنة 2026-10-18):** KEY = M-09 في عيّنة 11ch (auto_detected بحدث مفتاح) · LEVEL = M-10 في 11ch (auto_detected بتغيّر المستوى) · NOTTESTED = M-09 في 16ch (لم أختبر، بلا مستويات) — نسخ حرفية من
// NeuralChek@f9e0571. **CAPPED** (80 حدثاً قبل السقف والمحفوظ 64) **لا عيّنة مُنتِج لها**: تُبنى هنا بسطر مكتوب (أدناه) ولا تُدَّعى حمولة مُنتِج؛ وكذلك كل تعديل على الأساس يُسمّى في موضعه. (حلّت هذه محلّ
// عيّنتين بنيتُهما من العقد، scripts/lib/fv71VolumeSynthetic.js — حُذفت، القاعدة 23.)
//
// Run: node functions/test/fv71VolumeButtonReader.test.js

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
const VS = N.VOLUME_BUTTON_STATE;
const AS = N.VOLUME_BUTTON_ANSWER_STATE;
const PE = N.VOLUME_BUTTON_PRESS_EVIDENCE;

const fpOf = (fv, rows) => ({timeSeries: {footer: fv === null ? {} : {fieldsVersion: fv}}, functionalResults: [], manualResults: rows});
const row = (testId, status, meas) => ({testId, categoryName: 'audio', status, ...(meas === undefined ? {} : {measurements: meas})});
const read = (fv, meas, testId = 'M-09', status = 'pass') => R.readFv68(fpOf(fv, [row(testId, status, meas)]));
const vbOf = (o, testId = 'M-09') => o.measurements.items.find((i) => i.testId === testId).volumeButton;
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
const volOf = (k, id) => clone(PRODUCER[k].manualResults.find((m) => m.testId === id).measurements);
const ev = (tMs, keyCode, action, over = {}) => ({tMs, keyCode, action, repeat: 0, deviceId: 5, source: 257, ...over}); // deviceId 5 وsource 257 كما في عيّنات المُنتِج
const KEY = () => volOf('11ch', 'M-09');
const LEVEL = () => volOf('11ch', 'M-10');
const NOTTESTED = () => volOf('16ch', 'M-09');
// KEY لمفتاح آخر: يُبدَّل رمز المفتاح في expectedKeyCode وفي كل حدث معاً (24 رفع · 25 خفض)
const keyWith = (k) => {
  const m = KEY();
  m.expectedKeyCode = k;
  for (const e of m.events) e.keyCode = k;
  return m;
};
// ⚠️ لا عيّنة مُنتِج بسقف events: 64 محفوظة من 80 — تُبنى هنا (تُسمّى مبنيّة، لا حمولة مُنتِج). العدّادان من الأحداث المسرودة نفسها.
const CAPPED = () => {
  const events = [];
  for (let i = 0; i < 64; i++) {
    const t = 300 + i * 40;
    events.push(i % 2 === 0 ? ev(t, i % 8 === 0 ? 25 : 24, 'down') : ev(t, i % 8 === 1 ? 25 : 24, 'up'));
  }
  const downs = events.filter((e) => e.action === 'down');
  return {
    expectedKeyCode: 24, events, eventsTotal: 80, timeToFirstExpectedDownMs: events.find((e) => e.action === 'down' && e.keyCode === 24).tMs,
    expectedDownCount: downs.filter((e) => e.keyCode === 24).length, otherKeyDownCount: downs.filter((e) => e.keyCode !== 24).length, windowMs: 6000, endReason: 'user_marked_working',
    volumeStreamMax: 15, volumeLevelAtOpen: 7, volumeLevelAtEnd: 7,
  };
};
const BASE = 'manualResults[0].measurements';

// ═══ أ) المفاتيح بأنواعها وحضورها — باليد من القسم ═══════════════════════════════════════════════════════════════
{
  const HAND = {
    expectedKeyCode: ['int', 'ALWAYS'], events: ['array', 'ALWAYS'], eventsTotal: ['int', 'ALWAYS'], timeToFirstExpectedDownMs: ['int', 'WHEN_EXPECTED_DOWN'],
    expectedDownCount: ['int', 'ALWAYS'], otherKeyDownCount: ['int', 'ALWAYS'], holdMs: ['int', 'WHEN_UP_RECEIVED'], windowMs: ['int', 'ALWAYS'], endReason: ['string', 'ALWAYS'],
    flags: [null, 'OPTIONAL'], detectionSource: ['string', 'WHEN_AUTO_DETECTED'], volumeStreamMax: ['int', 'OPTIONAL'], volumeLevelAtOpen: ['int', 'OPTIONAL'], volumeLevelAtEnd: ['int', 'OPTIONAL'],
  };
  eq(Object.keys(HAND).length, 14, '[أ] أربعة عشر مفتاحاً (القسم ف-04: تسعة من VK وdetectionSource وثلاثة مستويات وflags)');
  eq(Object.keys(N.VOLUME_BUTTON_FIELD_SPEC).sort(), Object.keys(HAND).sort(), '[أ] مفاتيح VOLUME_BUTTON_FIELD_SPEC = المكتوبة باليد');
  eq(Object.fromEntries(Object.entries(N.VOLUME_BUTTON_FIELD_SPEC).map(([k, v]) => [k, [v.type, v.presence]])), HAND, '[أ] أنواعها وحضورها كما في القسم');
  const text = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'FV71_CONTRACT_SECTION.md'), 'utf8');
  // القسم يكتب events[] بقوسين مربّعين داخل علامتَي الاقتباس
  for (const key of Object.keys(HAND)) ok(text.includes(`\`${key}\``) || text.includes(`\`${key}[]\``), `[أ] «${key}» يظهر في نصّ القسم المنسوخ`);
  for (const v of ['auto_detected', 'user_marked_working', 'user_marked_not_working', 'user_marked_not_tested', 'dismissed', 'key_event', 'volume_level_change']) ok(text.includes(v), `[أ] «${v}» في نصّ القسم`);
  eq(Object.values(N.VOLUME_BUTTON_END_REASON), ['auto_detected', 'user_marked_working', 'user_marked_not_working', 'user_marked_not_tested', 'dismissed'], '[أ] endReason خمس قيم بنصّ القسم');
  eq(Object.values(N.VOLUME_BUTTON_DETECTION_SOURCE), ['key_event', 'volume_level_change'], '[أ] detectionSource قيمتان');
  eq(Object.values(N.VOLUME_BUTTON_EVENT_ACTION), ['down', 'up'], '[أ] action قيمتان');
  eq([N.VOLUME_BUTTON_KEY_CODE.VOLUME_UP, N.VOLUME_BUTTON_KEY_CODE.VOLUME_DOWN, N.VOLUME_BUTTON_EVENTS_CAP], [24, 25, 64], '[أ] 24 (KEYCODE_VOLUME_UP) و25 (KEYCODE_VOLUME_DOWN)، وسقف events 64 [م]');
  eq(N.VOLUME_BUTTON_TEST_IDS, ['M-09', 'M-10'], '[أ] الاختباران');
}

// ═══ ب) حالة الكتلة بحسب الختم ══════════════════════════════════════════════════════════════════════════════════
{
  for (const fv of [68, 69, 70]) {
    const o = read(fv, KEY());
    eq(vbOf(o), {state: VS.NOT_IN_FIELDS_VERSION, unexpectedKeys: Object.keys(KEY()).sort((a, b) => Object.keys(N.VOLUME_BUTTON_FIELD_SPEC).indexOf(a) - Object.keys(N.VOLUME_BUTTON_FIELD_SPEC).indexOf(b))},
        `[ب] ختم ${fv} مع مفاتيح fv71: NOT_IN_FIELDS_VERSION ومفاتيحها المبكّرة مسرودة (لا تُقرأ)`);
    ok(hasCode(o, 'VOLUME_KEYS_PRESENT_BEFORE_FV71', (a) => a.detail.keys.includes('events') && a.section === BASE), `[ب] ختم ${fv}: وحضورها مبكّراً شذوذ (القاعدة 25)`);
  }
  eq(vbOf(read(70, {})), {state: VS.NOT_IN_FIELDS_VERSION, unexpectedKeys: []}, '[ب] ختم 70 بخريطة فارغة: حالتها وحدها');
  eq(vbOf(read(null, KEY())).state, VS.UNDETERMINED_NO_FIELDS_VERSION, '[ب] بلا ختم: UNDETERMINED لا «لم توجد بعد»');
  for (const fv of [71, 72, 100]) eq([vbOf(read(fv, KEY())).state, codes(read(fv, KEY()))], [VS.READ, []], `[ب] ختم ${fv}: مقروءة بلا شذوذ`);
  const extra = KEY();
  extra.somethingNew = 1;
  const oE = read(71, extra);
  ok(hasCode(oE, 'VOLUME_UNKNOWN_KEY', (a) => a.detail.keys[0] === 'somethingNew'), '[ب] مفتاح خارج القسم في ≥ 71: شذوذ (القاعدة 25)');
  const unenc = KEY();
  unenc.measurementsUnencodable = 'x';
  ok(!hasCode(read(71, unenc), 'VOLUME_UNKNOWN_KEY'), '[ب] measurementsUnencodable معروف في العقد');
}

// ═══ جـ) القيم المعدَّدة كلّها ═══════════════════════════════════════════════════════════════════════════════════
{
  // endReason: الخمس
  for (const v of Object.values(N.VOLUME_BUTTON_END_REASON)) {
    const m = KEY();
    m.endReason = v;
    if (v !== 'auto_detected') delete m.detectionSource;
    const o = read(71, m);
    eq([vbOf(o).endReasonState.recognized, vbOf(o).endReasonState.kind, vbOf(o).endReasonStatus], [true, v, KS.PRESENT], `[جـ] endReason=${v}: معروفة`);
    eq(codes(o), [], `[جـ] endReason=${v}: لا شذوذ (مع detectionSource ${v === 'auto_detected' ? 'حاضر' : 'غائب'})`);
  }
  for (const v of ['AUTO_DETECTED', 'detected', 'user_marked_unknown', '']) {
    const m = KEY();
    m.endReason = v;
    const o = read(71, m);
    eq(vbOf(o).endReasonState.recognized, false, `[جـ] endReason="${v}": غير معروفة`);
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === v), `[جـ] endReason="${v}": تُعلَن شذوذاً`);
  }
  // detectionSource: القيمتان وغيرهما
  for (const v of Object.values(N.VOLUME_BUTTON_DETECTION_SOURCE)) {
    const m = v === 'key_event' ? KEY() : LEVEL();
    const o = read(71, m);
    eq([vbOf(o).detectionSourceState.kind, vbOf(o).detectionSourceState.recognized, codes(o)], [v, true, []], `[جـ] detectionSource=${v}`);
  }
  {
    const m = KEY();
    m.detectionSource = 'poll';
    const o = read(71, m);
    eq(vbOf(o).detectionSourceState.recognized, false, '[جـ] detectionSource=poll: غير معروفة');
    ok(hasCode(o, 'UNRECOGNIZED_STATE', (a) => a.detail.raw === 'poll'), '[جـ] وتُعلَن');
  }
  // action: down · up وغيرهما
  for (const a of ['down', 'up']) {
    const m = KEY();
    m.events[0].action = a;
    const o = read(71, m);
    eq(vbOf(o).events.items[0].action, a, `[جـ] action=${a}`);
  }
  {
    const m = KEY();
    m.events[0].action = 'move';
    const o = read(71, m);
    ok(hasCode(o, 'VOLUME_EVENT_ACTION_UNRECOGNIZED', (a) => a.detail.examples.includes('move')), '[جـ] action=move: يُعلَن غير معروف ولا يُلحَق بـdown');
    eq(vbOf(o).events.items[0].actionRecognized, false, '[جـ] actionRecognized=false');
  }
  // expectedKeyCode: 24 · 25 · غيرهما (لا يُلحَق بأقربهما)
  for (const k of [24, 25]) eq(codes(read(71, keyWith(k))), [], `[جـ] expectedKeyCode=${k}: معروف`);
  for (const k of [0, 23, 26, 164]) {
    const m = KEY();
    m.expectedKeyCode = k;
    ok(hasCode(read(71, m), 'VOLUME_EXPECTED_KEY_CODE_UNRECOGNIZED', (a) => a.detail.value === k), `[جـ] expectedKeyCode=${k}: شذوذ`);
  }
  // أيّ الاختبارين رفع وأيّهما خفض: **لا يُفرَض** (القسم لا يقوله): M-09 بـ25 وM-10 بـ24 مقبولان
  for (const [id, k] of [['M-09', 24], ['M-09', 25], ['M-10', 24], ['M-10', 25]]) eq(codes(read(71, keyWith(k), id)), [], `[جـ] ${id} بـexpectedKeyCode=${k}: لا يُفرَض تطابق (معلّق: أيّ الاختبارين رفع — عيّنات المُنتِج: M-09 ⟵ 24 وM-10 ⟵ 25، والقسم صامت)`);
}

// ═══ د) الحضور والغياب ════════════════════════════════════════════════════════════════════════════════════════════
{
  const SPEC = N.VOLUME_BUTTON_FIELD_SPEC;
  const P = N.VOLUME_BUTTON_PRESENCE;
  // ALWAYS: غيابه ⟵ ABSENT + شذوذ
  for (const key of Object.keys(SPEC).filter((k) => SPEC[k].presence === P.ALWAYS)) {
    const m = KEY();
    delete m[key];
    const o = read(71, m);
    eq(vbOf(o)[`${key}Status`], KS.ABSENT, `[د] ${key} (ALWAYS) غائب: ABSENT`);
    ok(hasCode(o, 'VOLUME_REQUIRED_KEY_ABSENT', (a) => a.detail.key === key), `[د] ${key}: شذوذ «لازم غائب»`);
    ok(o.absences.ABSENT.some((p) => p.endsWith(`volumeButton.${key}Status`)), `[د] ${key}: يظهر في «غياب بلا سبب» أعلى المخرَج`);
  }
  // نوع خاطئ لكل مفتاح موجود
  const WRONG = {int: 'x', string: 5, array: {}};
  for (const key of Object.keys(SPEC).filter((k) => SPEC[k].type !== null && k in KEY())) {
    const m = KEY();
    m[key] = WRONG[SPEC[key].type];
    const o = read(71, m);
    eq(vbOf(o)[`${key}Status`], KS.WRONG_TYPE, `[د] ${key} بنوع خاطئ: WRONG_TYPE لا تحويل`);
    ok(own(o).some((a) => a.code === 'WRONG_TYPE' && a.section.endsWith(`.${key}`)), `[د] ${key}: شذوذ WRONG_TYPE في موضعه`);
  }
  const frac = KEY();
  frac.windowMs = 1500.5;
  eq(vbOf(read(71, frac)).windowMsStatus, KS.WRONG_TYPE, '[د] windowMs بكسر: WRONG_TYPE (عدد صحيح)');
  // timeToFirstExpectedDownMs ⟷ expectedDownCount: الحالات الأربع
  {
    const gone = KEY();
    delete gone.timeToFirstExpectedDownMs;
    const o1 = read(71, gone);
    eq([vbOf(o1).timeToFirstExpectedDownMsStatus, hasCode(o1, 'VOLUME_TIME_TO_FIRST_DOWN_ABSENT_DESPITE_DOWN')], [KS.ABSENT, true], '[د] expectedDownCount=1 وtimeToFirst غائب: شذوذ (غائب رغم الضغط)');
    const withZero = LEVEL();
    withZero.timeToFirstExpectedDownMs = 100;
    ok(hasCode(read(71, withZero), 'VOLUME_TIME_TO_FIRST_DOWN_WITHOUT_EXPECTED_DOWN'), '[د] expectedDownCount=0 وtimeToFirst حاضر: تناقض معلن');
    const o3 = read(71, LEVEL());
    eq([vbOf(o3, 'M-09').timeToFirstExpectedDownMsStatus, vbOf(o3, 'M-09').timeToFirstExpectedDownMs, codes(o3)], [KS.ABSENT_DECLARED, null, []], '[د] expectedDownCount=0 وtimeToFirst غائب: ABSENT_DECLARED بلا صفر ولا شذوذ (قاعدة 22)');
    ok(o3.absences.ABSENT_DECLARED.some((p) => p.endsWith('volumeButton.timeToFirstExpectedDownMsStatus')), '[د] ويظهر في الغياب المُعلَن أعلى المخرَج');
    const noCount = KEY();
    delete noCount.expectedDownCount;
    delete noCount.timeToFirstExpectedDownMs;
    const o5 = read(71, noCount);
    ok(!hasCode(o5, 'VOLUME_TIME_TO_FIRST_DOWN_ABSENT_DESPITE_DOWN'), '[د] expectedDownCount نفسه غائب: لا حكم على timeToFirst (الغياب في مكانه)');
  }
  // holdMs ⟷ up
  {
    const m = KEY();
    delete m.holdMs;
    let o = read(71, m);
    ok(hasCode(o, 'VOLUME_HOLD_ABSENT_DESPITE_UP'), '[د] holdMs غائب والقائمة الكاملة فيها up بعد الضغط المطلوب: شذوذ');
    const noUp = KEY();
    noUp.events = [noUp.events[0]];
    noUp.eventsTotal = 1;
    delete noUp.holdMs;
    o = read(71, noUp);
    eq([vbOf(o).holdMsStatus, codes(o)], [KS.ABSENT_DECLARED, []], '[د] holdMs غائب وقائمة كاملة بلا up: ABSENT_DECLARED («غائب إن لم يصل up») بلا شذوذ');
    const zero = LEVEL();
    zero.holdMs = 5;
    ok(hasCode(read(71, zero), 'VOLUME_HOLD_WITHOUT_EXPECTED_DOWN'), '[د] holdMs حاضر وexpectedDownCount=0: تناقض');
    const trunc = CAPPED();
    delete trunc.holdMs;
    o = read(71, trunc);
    eq([vbOf(o).holdMsStatus, codes(o)], [KS.ABSENT, []], '[د] holdMs غائب وقائمة مبتورة: لا يُعرف أوصل up أم لا ⟵ ABSENT بلا حكم ولا شذوذ');
    // expectedDownCount=0 يكفي لإعلان غياب holdMs حتى لو تعذّرت قراءة events نفسها (لا يُشترط اكتمال القائمة)
    const noEvents = LEVEL();
    delete noEvents.events;
    delete noEvents.eventsTotal;
    delete noEvents.holdMs;
    eq(vbOf(read(71, noEvents)).holdMsStatus, KS.ABSENT_DECLARED, '[د] expectedDownCount=0 وevents غائبة: holdMs ABSENT_DECLARED بسبب العدّاد وحده');
    const upBefore = KEY();
    upBefore.events = [ev(100, 24, 'up'), ev(300, 24, 'down')];
    upBefore.eventsTotal = 2;
    delete upBefore.holdMs;
    eq(vbOf(read(71, upBefore)).holdMsStatus, KS.ABSENT_DECLARED, '[د] up قبل الضغط لا يُحتسب: ABSENT_DECLARED');
    const otherUp = KEY();
    otherUp.events = [ev(100, 24, 'down'), ev(300, 25, 'up')];
    otherUp.eventsTotal = 2;
    delete otherUp.holdMs;
    eq(vbOf(read(71, otherUp)).holdMsStatus, KS.ABSENT_DECLARED, '[د] up لمفتاح آخر لا يُحتسب: ABSENT_DECLARED');
  }
  // detectionSource ⟺ auto_detected
  {
    const noSrc = KEY();
    delete noSrc.detectionSource;
    ok(hasCode(read(71, noSrc), 'VOLUME_DETECTION_SOURCE_ABSENT_WHEN_AUTO_DETECTED'), '[د] auto_detected بلا detectionSource: شذوذ');
    const extraSrc = KEY();
    extraSrc.endReason = 'user_marked_working';
    ok(hasCode(read(71, extraSrc), 'VOLUME_DETECTION_SOURCE_WITHOUT_AUTO_DETECTED'), '[د] detectionSource مع endReason غير auto_detected: تناقض («لا قيمة افتراضية»)');
    const fine = NOTTESTED();
    const of = read(71, fine, 'M-10');
    eq([vbOf(of, 'M-10').detectionSourceStatus, vbOf(of, 'M-10').detectionSource, codes(of)], [KS.ABSENT_DECLARED, null, []], '[د] endReason ≠ auto_detected وdetectionSource غائب: ABSENT_DECLARED (هو التصميم) بلا شذوذ');
    const noEnd = KEY();
    delete noEnd.endReason;
    delete noEnd.detectionSource;
    const oN = read(71, noEnd);
    eq(vbOf(oN).detectionSourceStatus, KS.ABSENT, '[د] endReason نفسه غائب وdetectionSource غائب: ABSENT بلا إعلان سبب (لا يُختلَق)');
    const keyNoDown = KEY();
    keyNoDown.expectedDownCount = 0;
    delete keyNoDown.timeToFirstExpectedDownMs;
    delete keyNoDown.holdMs;
    ok(hasCode(read(71, keyNoDown), 'VOLUME_KEY_EVENT_SOURCE_WITHOUT_KEY_DOWN'), '[د] detectionSource=key_event وexpectedDownCount=0: تناقض');
  }
  // مستويات الصوت: اختيارية، ومُدخلات قرار حين الكشف بالمستوى
  for (const key of ['volumeStreamMax', 'volumeLevelAtOpen', 'volumeLevelAtEnd']) {
    const m = KEY();
    delete m[key];
    const o = read(71, m);
    eq([vbOf(o)[`${key}Status`], codes(o)], [KS.ABSENT, []], `[د] ${key} غائب مع الكشف بحدث مفتاح: ABSENT بلا شذوذ (فشل قراءة أو maxVol < 2)`);
    const lv = LEVEL();
    delete lv[key];
    ok(hasCode(read(71, lv), 'VOLUME_LEVEL_INPUT_ABSENT_FOR_LEVEL_DETECTION', (a) => a.detail.key === key), `[د] ${key} غائب مع الكشف بتغيّر المستوى: شذوذ (مُدخل قرار، القاعدة 20)`);
  }
  {
    const m = KEY();
    m.volumeStreamMax = 15; m.volumeLevelAtOpen = 16;
    ok(hasCode(read(71, m), 'VOLUME_LEVEL_ABOVE_STREAM_MAX', (a) => a.detail.value === 16), '[د] مستوى فوق المدى الأقصى: شذوذ');
    const low = KEY();
    low.volumeStreamMax = 1;
    ok(hasCode(read(71, low), 'VOLUME_LEVELS_PRESENT_BELOW_MIN_RANGE'), '[د] مستويات حاضرة وmaxVol=1 (< 2: الضبط لا يجري): شذوذ');
    const lowOnly = KEY();
    lowOnly.volumeStreamMax = 1;
    delete lowOnly.volumeLevelAtOpen;
    delete lowOnly.volumeLevelAtEnd;
    eq(codes(read(71, lowOnly)), [], '[د] maxVol=1 بلا مستويين: مشروع («لا صفر»)');
    const neg = KEY();
    neg.volumeLevelAtEnd = -1;
    ok(hasCode(read(71, neg), 'VOLUME_LEVEL_NEGATIVE'), '[د] مستوى سالب: شذوذ');
    const zeroOk = KEY();
    zeroOk.volumeLevelAtOpen = 0;
    eq(codes(read(71, zeroOk)), [], '[د] مستوى 0 صفر حقيقي ولا شذوذ');
    // الحدّان بالمساواة: مستوى = المدى الأقصى مشروع (ليس «فوقه»)، وmaxVol = 2 مشروع (الضبط يجري عند maxVol ≥ 2)
    const atMax = KEY();
    atMax.volumeStreamMax = 15; atMax.volumeLevelAtOpen = 15; atMax.volumeLevelAtEnd = 15;
    eq(codes(read(71, atMax)), [], '[د] مستوى = volumeStreamMax: مشروع (لا شذوذ «فوق المدى»)');
    const maxTwo = KEY();
    maxTwo.volumeStreamMax = 2; maxTwo.volumeLevelAtOpen = 1; maxTwo.volumeLevelAtEnd = 2;
    eq(codes(read(71, maxTwo)), [], '[د] maxVol = 2 (= الحدّ الأدنى لإجراء الضبط) مع المستويين: مشروع');
  }
  // flags: النوع غير محدَّد: يمرّ كما وصل
  for (const flags of ['FLAG_FROM_SYSTEM', 8, true, {a: 1}, ['x']]) {
    const m = KEY();
    m.flags = flags;
    const o = read(71, m);
    eq([vbOf(o).flags, vbOf(o).flagsStatus, codes(o)], [flags, KS.PRESENT, []], `[د] flags=${JSON.stringify(flags)}: يمرّ كما وصل بلا فحص نوع (معلّق: مواصفة غائبة)`);
  }
  eq([vbOf(read(71, KEY())).flags, vbOf(read(71, KEY())).flagsStatus], [null, KS.ABSENT], '[د] flags غائب: ABSENT («غائب إن لم يُقرأ») بلا شذوذ');
  // عدّادان سالبان
  const neg = KEY();
  neg.otherKeyDownCount = -1;
  ok(hasCode(read(71, neg), 'VOLUME_COUNT_NEGATIVE'), '[د] عدّاد سالب: شذوذ');
  const zeroCounts = LEVEL();
  eq([vbOf(read(71, zeroCounts)).expectedDownCount, vbOf(read(71, zeroCounts)).expectedDownCountStatus], [0, KS.PRESENT], '[د] expectedDownCount=0 صفر حقيقي يُقرأ كما هو (لا غياب)');
}

// ═══ هـ) events[]: السقف والعدّ والعناصر ═══════════════════════════════════════════════════════════════════════════
{
  const oK = read(71, KEY());
  eq([vbOf(oK).events.state, vbOf(oK).events.count, vbOf(oK).eventsTotal, vbOf(oK).eventsTruncated], ['HAS_EVENTS', 2, 2, false], '[هـ] قائمة بحدثين: HAS_EVENTS، وeventsTotal=2، وغير مبتورة');
  eq(vbOf(oK).events.items[0], {tMs: 2310, keyCode: 24, action: 'down', actionRecognized: true, repeat: 0, deviceId: 5, source: 257}, '[هـ] العنصر الأوّل بحقوله الستّة كما شحنها المُنتِج (11ch)');
  const oL = read(71, LEVEL());
  eq([vbOf(oL).events.state, vbOf(oL).events.count, vbOf(oL).eventsTruncated], ['EMPTY', 0, false], '[هـ] events=[] ⟵ EMPTY (لا تعني «لم يضغط»)');
  eq(vbOf(oL).pressEvidence, PE.LEVEL_CHANGE_ONLY, '[هـ] pressEvidence: الكشف بتغيّر المستوى وحده ⟵ LEVEL_CHANGE_ONLY');
  eq(vbOf(oK).pressEvidence, PE.KEY_EVENT_SEEN, '[هـ] pressEvidence: expectedDownCount>0 ⟵ KEY_EVENT_SEEN');
  const nt = read(71, NOTTESTED(), 'M-10', 'not_tested');
  eq(vbOf(nt, 'M-10').pressEvidence, PE.NOT_ESTABLISHED, '[هـ] pressEvidence: بلا حدث ولا كشف ⟵ NOT_ESTABLISHED (لا نجاح ولا فشل)');
  eq(Object.values(PE), ['KEY_EVENT_SEEN', 'LEVEL_CHANGE_ONLY', 'NOT_ESTABLISHED'], '[هـ] الأدلّة الثلاثة جُرِّبت كلّها');
  // السقف
  const oC = read(71, CAPPED());
  eq([vbOf(oC).eventsTotal, vbOf(oC).events.count, vbOf(oC).eventsTruncated, codes(oC)], [80, 64, true, []], '[هـ] 80 حدثاً قبل السقف و64 محفوظة: مبتورة بإعلان (eventsTruncated) ولا شذوذ');
  eq(vbOf(oC).events.items.length, 64, '[هـ] والعناصر الأربعة والستون كلّها في المخرَج');
  const full = CAPPED();
  full.eventsTotal = 64;
  eq([vbOf(read(71, full)).eventsTruncated, codes(read(71, full))], [false, ['VOLUME_HOLD_ABSENT_DESPITE_UP']],
      '[هـ] eventsTotal=64 (= السقف): غير مبتورة — والقائمة صارت كاملة فيها up بعد الضغط المطلوب، فغياب holdMs شذوذ (كان لا يُحكَم به حين كانت مبتورة)');
  full.holdMs = 40;
  eq(codes(read(71, full)), [], '[هـ] ومع holdMs حاضراً: لا شذوذ');
  const over = CAPPED();
  over.events.push(ev(9999, 24, 'down'));
  over.eventsTotal = 81;
  ok(hasCode(read(71, over), 'VOLUME_EVENTS_OVER_CAP', (a) => a.detail.listed === 65), '[هـ] 65 عنصراً (فوق السقف 64): شذوذ');
  const below = KEY();
  below.eventsTotal = 1;
  ok(hasCode(read(71, below), 'VOLUME_EVENTS_TOTAL_BELOW_LIST'), '[هـ] eventsTotal < عدد المسرود: شذوذ');
  const mismatch = KEY();
  mismatch.eventsTotal = 5;
  ok(hasCode(read(71, mismatch), 'VOLUME_EVENTS_TOTAL_MISMATCH', (a) => a.detail.listed === 2 && a.detail.eventsTotal === 5), '[هـ] eventsTotal=5 والمسرود 2 (تحت السقف): شذوذ — لا فقد بلا سقف');
  const shortTrunc = CAPPED();
  shortTrunc.events = shortTrunc.events.slice(0, 60);
  ok(hasCode(read(71, shortTrunc), 'VOLUME_EVENTS_TRUNCATION_INCONSISTENT'), '[هـ] eventsTotal=80 والمسرود 60 (لا 64): بتر غير متّسق مع السقف');
  // مشاكل العناصر (شذوذ واحد لكل رمز بعدده)
  const bad = KEY();
  bad.events = [5, {tMs: 'x', keyCode: 24, action: 'down', repeat: 0, deviceId: 3, source: 257}, {tMs: 1, keyCode: 24, action: 5, repeat: 0, deviceId: 3, source: 257},
    {tMs: 1, keyCode: 24, action: 'down', repeat: -1, deviceId: 3, source: 257}, {tMs: 1, keyCode: 24, action: 'up', repeat: 0, deviceId: 3.5, source: 257}];
  bad.eventsTotal = 5;
  const oB = read(71, bad);
  ok(hasCode(oB, 'VOLUME_EVENT_NOT_OBJECT'), '[هـ] عنصر ليس كائناً: شذوذ');
  ok(hasCode(oB, 'VOLUME_EVENT_FIELD_INVALID', (a) => a.detail.count === 3 && a.detail.examples.includes('tMs') && a.detail.examples.includes('repeat') && a.detail.examples.includes('deviceId')),
      '[هـ] tMs نصّ وrepeat سالب وdeviceId كسر: شذوذ واحد بالعدد 3 وأسماء الحقول');
  ok(hasCode(oB, 'VOLUME_EVENT_ACTION_INVALID'), '[هـ] action ليست نصّاً: شذوذ');
  eq(vbOf(oB).events.problemCodes.sort(), ['ACTION_INVALID', 'FIELD_INVALID', 'NOT_OBJECT'], '[هـ] ورموز المشاكل مسرودة في المخرَج');
  for (const missing of ['tMs', 'keyCode', 'action', 'repeat', 'deviceId', 'source']) {
    const m = KEY();
    delete m.events[0][missing];
    ok(codes(read(71, m)).some((c) => c.startsWith('VOLUME_EVENT_')), `[هـ] عنصر بلا ${missing}: شذوذ (لا قيمة مختلَقة)`);
  }
  // مبتورة بلا أن يُنتج مشكلةً: لا شذوذ
  eq(codes(read(71, CAPPED())), [], '[هـ] الحمولة المبتورة بالسقف سليمة');
}

// ═══ و) جواب M-09/M-10 اليدوي — بلا measurements حالة صريحة ═══════════════════════════════════════════════════════
{
  const ans = (o) => o.volumeButtonAnswers;
  for (const fv of [69, 70, 71]) {
    eq(ans(R.readFv68(fpOf(fv, []))), {'M-09': {state: AS.NOT_IN_MANUAL_RESULTS, manualStatus: null}, 'M-10': {state: AS.NOT_IN_MANUAL_RESULTS, manualStatus: null}}, `[و] ختم ${fv}: لا صفّان`);
    for (const st of ['pass', 'fail', 'warning', 'not_tested', 'unavailable']) {
      eq(ans(R.readFv68(fpOf(fv, [row('M-09', st), row('M-10', st)]))), {'M-09': {state: AS.WITHOUT_RAW, manualStatus: st}, 'M-10': {state: AS.WITHOUT_RAW, manualStatus: st}},
          `[و] ختم ${fv}: ${st} بلا measurements ⟵ WITHOUT_RAW حالة صريحة لا خطأ (ولا شذوذ)`);
    }
    eq(ans(R.readFv68(fpOf(fv, [row('M-09', 'pass', 'x')])))['M-09'].state, AS.RAW_UNREADABLE, `[و] ختم ${fv}: measurements نصّ ⟵ RAW_UNREADABLE`);
    eq(ans(R.readFv68(fpOf(fv, [row('M-09', 'pass', KEY()), row('M-10', 'fail')]))), {'M-09': {state: AS.RAW_PRESENT, manualStatus: 'pass'}, 'M-10': {state: AS.WITHOUT_RAW, manualStatus: 'fail'}}, `[و] ختم ${fv}: صفّ بخامّ وصفّ بلا خامّ`);
    eq(own(R.readFv68(fpOf(fv, [row('M-09', 'pass'), row('M-10', 'pass')]))), [], `[و] ختم ${fv}: pass بلا measurements لا شذوذ`);
  }
  eq(ans(R.readFv68(fpOf(71, [{testId: 'M-09', categoryName: 'audio'}])))['M-09'], {state: AS.WITHOUT_RAW, manualStatus: null}, '[و] بلا status: manualStatus=null لا قيمة مخمَّنة');
  eq(Object.values(AS), ['NOT_IN_MANUAL_RESULTS', 'WITHOUT_RAW', 'RAW_UNREADABLE', 'RAW_PRESENT'], '[و] الحالات الأربع جُرِّبت كلّها');
  // المسار القديم لا يتأثّر: M-09 بلا measurements لا يظهر عنصراً ولا «غائباً متوقَّعاً»
  const o = R.readFv68(fpOf(71, [row('M-09', 'pass')]));
  eq([o.measurements.items, o.measurements.expectedButAbsent], [[], []], '[و] ولا عنصر ولا «غائب متوقَّع» (غيابه حالة في volumeButtonAnswers)');
}

// ═══ ز) المسار الكامل بالقارئ الحقيقي على حمولات المُنتِج الثلاث (القاعدة 37) ═══════════════════════════════════
{
  for (const k of Object.keys(PRODUCER)) {
    const r = R.readFv68(clone(PRODUCER[k]));
    eq(r.readerError, undefined, `[ز][${k}] القارئ لم يرمِ`);
    eq([r.fieldsVersion, r.applicable], [71, true], `[ز][${k}] الختم 71 مُنطبِق`);
    eq(own(r), [], `[ز][${k}] لا شذوذ في M-09/M-10 (حمولة المُنتِج كما شحنها)`);
    for (const id of ['M-09', 'M-10']) eq(vbOf(r, id).state, VS.READ, `[ز][${k}] ${id} مقروء`);
  }
  const press = (k) => { const r = R.readFv68(clone(PRODUCER[k])); return [vbOf(r, 'M-09').pressEvidence, vbOf(r, 'M-10').pressEvidence]; };
  eq(press('11ch'), [PE.KEY_EVENT_SEEN, PE.LEVEL_CHANGE_ONLY], '[ز][11ch] دليلا الضغط: حدث مفتاح وتغيّر مستوى');
  eq(press('13ch'), [PE.NOT_ESTABLISHED, PE.NOT_ESTABLISHED], '[ز][13ch] «يعمل» بيد الفنّي بلا ضغط مطلوب مرصود، و«لا يعمل» بلا أحداث: لا دليل في الاثنين');
  eq(press('16ch'), [PE.NOT_ESTABLISHED, PE.NOT_ESTABLISHED], '[ز][16ch] «لم أختبر»، ومغلَق بحدث المفتاح الآخر: لا دليل على الضغط المطلوب');
  const before = JSON.stringify(PRODUCER['13ch']);
  const copy = clone(PRODUCER['13ch']);
  R.readFv68(copy);
  eq(JSON.stringify(copy), before, '[ز] readFv68 لا تعدّل الحمولة');
}

// ═══ ح) العدّادان مقابل events[] وعائلة المفاتيح — قسم f9e0571: «يعدّان ضغطات (down بـrepeat = 0)… وغيرها يُهمَل» ═══════════════════
{
  const kinds = (o) => codes(o).filter((c) => c === 'VOLUME_COUNT_DISAGREES_WITH_EVENTS');
  const countAnomalies = (o, key) => own(o).filter((a) => a.code === 'VOLUME_COUNT_DISAGREES_WITH_EVENTS' && a.detail.key === key);
  // حمولات المُنتِج كما هي: العدّادان = عدّ مستقلّ (حلقة هنا) في الصفوف الستّة
  for (const k of Object.keys(PRODUCER)) {
    for (const id of ['M-09', 'M-10']) {
      const raw = volOf(k, id);
      const downs = raw.events.filter((e) => e.action === 'down' && e.repeat === 0);
      eq([raw.expectedDownCount, raw.otherKeyDownCount], [downs.filter((e) => e.keyCode === raw.expectedKeyCode).length, downs.filter((e) => e.keyCode !== raw.expectedKeyCode).length], `[ح][${k}][${id}] العدّادان المشحونان = عدّ مستقلّ`);
      eq(kinds(read(71, raw, id)), [], `[ح][${k}][${id}] ولا شذوذ تطابق`);
    }
  }
  let m = KEY();
  m.expectedDownCount = 2;
  let o = read(71, m);
  eq(countAnomalies(o, 'expectedDownCount').map((a) => [a.detail.shipped, a.detail.derived]), [[2, 1]], '[ح] expectedDownCount=2 والأحداث تحمل ضغطة مطلوبة واحدة: شذوذ بالمشحون والمحسوب');
  eq(countAnomalies(o, 'otherKeyDownCount'), [], '[ح] ولا شذوذ على العدّاد الآخر (كلٌّ يُحكم وحده)');
  m = KEY();
  m.otherKeyDownCount = 1;
  o = read(71, m);
  eq(countAnomalies(o, 'otherKeyDownCount').map((a) => [a.detail.shipped, a.detail.derived]), [[1, 0]], '[ح] otherKeyDownCount=1 بلا ضغطة لمفتاح آخر: شذوذ');
  eq(countAnomalies(o, 'expectedDownCount'), [], '[ح] ولا شذوذ على expectedDownCount');
  // التكرار (repeat > 0) لا يُعدّ ضغطة
  m = KEY();
  m.events.splice(1, 0, ev(2360, 24, 'down', {repeat: 1}), ev(2380, 24, 'down', {repeat: 2}));
  m.eventsTotal = 4;
  eq(codes(read(71, m)), [], '[ح] تكرارا المفتاح المضغوط (repeat=1،2) في events[] لا يُعدّان: expectedDownCount يبقى 1 بلا شذوذ');
  m.expectedDownCount = 3;
  eq(countAnomalies(read(71, m), 'expectedDownCount').map((a) => a.detail.derived), [1], '[ح] ومن عدّهما (3) شذوذ: المحسوب 1');
  // مفتاح آخر من العائلة (25 ثمّ 164 كتم) يُعدّ في otherKeyDownCount
  m = KEY();
  m.events.push(ev(2500, 25, 'down'), ev(2550, 25, 'up'), ev(2600, 164, 'down'));
  m.eventsTotal = 5;
  m.otherKeyDownCount = 2;
  eq(codes(read(71, m)), [], '[ح] ضغطتان لمفتاحين آخرين من العائلة (25 و164 كتم): otherKeyDownCount=2 بلا شذوذ');
  m.otherKeyDownCount = 1;
  eq(countAnomalies(read(71, m), 'otherKeyDownCount').map((a) => [a.detail.shipped, a.detail.derived]), [[1, 2]], '[ح] وعدّاد 1 مع ضغطتين: شذوذ');
  // up وحده لا يُعدّ
  m = keyWith(25);
  m.events = [ev(100, 25, 'up')];
  m.eventsTotal = 1;
  m.expectedDownCount = 0;
  delete m.timeToFirstExpectedDownMs;
  delete m.holdMs;
  m.endReason = 'user_marked_working';
  delete m.detectionSource;
  eq(kinds(read(71, m)), [], '[ح] حدث up بلا down: لا يُعدّ ضغطة (expectedDownCount=0 مطابق)');
  // قائمة مبتورة (eventsTotal > 64): لا حكم بالتطابق ولو اختلف العدّاد
  m = CAPPED();
  m.expectedDownCount = 99;
  eq(kinds(read(71, m)), [], '[ح] قائمة مبتورة (80 قبل السقف، 64 محفوظة): لا حكم بالتطابق — المحفوظ جزء من الأحداث');
  const full = CAPPED();
  full.eventsTotal = 64;
  full.holdMs = 40;
  eq(kinds(read(71, full)), [], '[ح] القائمة الكاملة (eventsTotal=64) والعدّادان من الأحداث نفسها: لا شذوذ');
  full.expectedDownCount += 1;
  eq(countAnomalies(read(71, full), 'expectedDownCount').length, 1, '[ح] وبعدّاد زائد واحد: شذوذ');
  // مشكلة في عنصر ⟵ القائمة غير «كاملة» فلا حكم؛ وغياب أحد العدّادين أو expectedKeyCode ⟵ لا حكم (الغياب في مكانه)
  m = KEY();
  m.events.push({tMs: 'x', keyCode: 24, action: 'down', repeat: 0, deviceId: 5, source: 257});
  m.eventsTotal = 3;
  m.expectedDownCount = 7;
  eq(kinds(read(71, m)), [], '[ح] عنصر معطوب في القائمة: لا حكم بالتطابق (يُعلَن العطب وحده)');
  for (const gone of ['expectedDownCount', 'otherKeyDownCount', 'expectedKeyCode']) {
    m = KEY();
    delete m[gone];
    // العدّادان الباقيان يُختلَفان عمداً كي يظهر الحكم لو أُصدِر
    if (gone !== 'expectedDownCount') m.expectedDownCount = 9;
    if (gone !== 'otherKeyDownCount') m.otherKeyDownCount = 9;
    eq(kinds(read(71, m)), [], `[ح] ${gone} غائب: لا حكم بالتطابق (الغياب شذوذ في مكانه)`);
  }
  // عائلة المفاتيح: 24 · 25 · 164 وحدها
  for (const code of [24, 25, 164]) {
    m = KEY();
    m.events = [ev(2310, code, 'down'), ev(2410, code, 'up')];
    m.expectedDownCount = code === 24 ? 1 : 0;
    m.otherKeyDownCount = code === 24 ? 0 : 1;
    eq(codes(read(71, m)).filter((c) => c === 'VOLUME_EVENT_KEY_OUTSIDE_FAMILY'), [], `[ح] keyCode=${code} في events[]: من العائلة`);
  }
  for (const code of [4, 26, 0, 3, 165]) {
    m = KEY();
    m.events[0].keyCode = code;
    o = read(71, m);
    ok(hasCode(o, 'VOLUME_EVENT_KEY_OUTSIDE_FAMILY', (a) => a.detail.count === 1 && a.detail.examples.includes(code)), `[ح] keyCode=${code} في events[]: خارج العائلة ⟵ شذوذ (القسم: «وغيرها يُهمَل» فلا يكتبه التطبيق)`);
    eq(kinds(o), [], `[ح] keyCode=${code}: ولا حكم تطابق (القائمة غير كاملة بمشكلتها)`);
  }
  m = KEY();
  m.events[0].keyCode = '24';
  o = read(71, m);
  ok(hasCode(o, 'VOLUME_EVENT_FIELD_INVALID') && !hasCode(o, 'VOLUME_EVENT_KEY_OUTSIDE_FAMILY'), '[ح] keyCode نصّ: FIELD_INVALID لا «خارج العائلة» (النوع الخاطئ لا يُصنَّف)');
}

console.log(`\nfv71VolumeButtonReader.test.js: ${n}/${n} assertions passed`);
