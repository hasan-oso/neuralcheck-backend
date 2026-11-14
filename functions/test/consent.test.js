'use strict';

// consent.test.js — سجلّ الموافقة على الهاتف المفحوص: تحقّق المدخل، قراءة المخزَّن، مستند scanProtocol.consent، قرار recordScanConsent النقيّ، وحرّاس البنية (S-P6-12، 2026-10-21 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في scanConsent.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١١ (:1377-1413) وdocs/PROTOCOL_CONTRACT.md §٢ A8: «**«أوافق»** ⇐ يُخزَّن في `protocolPending` ثم `scanProtocol`: `consent: {state: "accepted", textVersion, locale, acceptedAt (الخادم)}`» (:1393)،
// «**تطبيق قديم بلا الشاشة** ⇐ `not_collected`» (:1401)، «**فالموافقة غير المسجَّلة لا تُقرأ موافقة.**» (:1402).
//   ١ validateConsentInput: كل قيمة معدَّدة تصل من العميل بكل قيمها (القاعدة 30) — النسخة (مقبولة · مرفوضة بسببها) واللغة (ar · tr · غيرهما) والغياب
//   ٢ شكل السجلّين: المقبولة وغير المجموعة بالمفاتيح الأربعة نفسها
//   ٣ readStoredConsent: accepted وحدها تُقرأ موافقة؛ كل شكل آخر (declined · نسخة/لغة/وقت خارج المعتمد · غير كائن) UNREADABLE
//   ٤ consentForScanProtocol: المسجَّلة تُنسخ، وغيرها not_collected بأساسه، وفحص بلا جلسة لا يقرأ protocolPending أصلاً
//   ٥ decideRecordConsent: جدول (دور × حالة × وقت × مخزَّن): الوجود ثم الدور ثم الحالة ثم الانقضاء ثم المخزَّن
//   ٦ ردود الرفض: لكلّ رمز ردّ، ولا نصّ عربي جديد (معلّق: نصّ بانتظار الاعتماد)، والجلسة غير الموجودة وغير المنضمّ سواء عند العميل
//   ٧ حرّاس البنية: اسم الحقل مصدر واحد · موضع رمي واحد · المعاملة تُرجِع قراراً · الكتابة مفتاح واحد بالدمج · لا حذف · لا استعلام
//
// Run: node functions/test/consent.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const C = require('../src/protocol/consent');
const S = require('../src/sessions/recordScanConsent');
const V = require('../src/protocol/protocolVocabulary');
const {RECORD_CONSENT_REFUSAL: R} = require('../src/sessions/sessionNames');
const {hashIdForLog} = require('../src/utils/logRedaction');

const TS = (ms) => ({toMillis: () => ms});
const T0 = TS(1760000000000);
const ACCEPTED = (over = {}) => ({state: 'accepted', textVersion: 1, locale: 'ar', acceptedAt: T0, ...over});

// ═══ ١ — validateConsentInput ═══
deq(C.validateConsentInput({textVersion: 1, locale: 'ar'}), {ok: true, textVersion: 1, locale: 'ar'}, '[١] النسخة 1 والعربية ⟵ مقبول');
deq(C.validateConsentInput({textVersion: 1, locale: 'tr'}), {ok: true, textVersion: 1, locale: 'tr'}, '[١] والتركية ⟵ مقبول (القيمتان معدَّدتان بكل قيمهما: القاعدة 30)');
deq(C.validateConsentInput({textVersion: 1.0, locale: 'ar'}), {ok: true, textVersion: 1, locale: 'ar'}, '[١] 1.0 هو 1 في JSON ⟵ مقبول');
deq(C.validateConsentInput({textVersion: 1, locale: 'ar', extra: 'x', sessionId: 's'}), {ok: true, textVersion: 1, locale: 'ar'}, '[١] مفاتيح أخرى لا تؤثّر (sessionId وغيره يقرؤهما المنادي)');
deq(Object.values(V.CONSENT_LOCALE).sort(), ['ar', 'tr'], '[١] القائمة المغلقة للغة: ar وtr (النصّ معتمد بالعربية والتركية وحدهما)');
// (2026-10-23، القاعدة 23: كان «الحالية 1» فاستُبدل) نصّ شاشة الموافقة تغيّر في التطبيق (م٢ وم٣ مُعدَّلان وم٤ تُحذف) فارتفعت النسخة الحالية إلى 2؛ 1 صارت الأقدم المقبولة. كل «فوق الحالية» و«الأقدم» تُشتقّ من الثابت لا من رقم حرفي.
eq(V.CONSENT_TEXT_VERSION, 2, '[١] نسخة النصّ الحالية 2 (E11؛ رُفعت من 1 في 2026-10-23): الأحدث منها يُرفض والأقدم (1) مقبولة، فاختبارات «فوق الحالية» و«الأقدم» تتبع هذه القيمة');
deq(C.validateConsentInput({textVersion: V.CONSENT_TEXT_VERSION, locale: 'ar'}), {ok: true, textVersion: V.CONSENT_TEXT_VERSION, locale: 'ar'}, '[١] النسخة الحالية (حدّ الأعلى المقبول) ⟵ مقبولة');
deq(C.validateConsentInput({textVersion: 2, locale: 'tr'}), {ok: true, textVersion: 2, locale: 'tr'}, '[١] النسخة 2 (ما يرسله التطبيق بعد تغيير نصّ الموافقة: ScanConsent.kt:50 — منقول) ⟵ مقبولة');
deq(C.validateConsentInput({textVersion: V.CONSENT_TEXT_VERSION - 1, locale: 'tr'}), {ok: true, textVersion: V.CONSENT_TEXT_VERSION - 1, locale: 'tr'}, '[١] الأقدم بواحدة من الحالية ⟵ مقبولة (تطبيق ما زال يعرض نصّاً أقدم: الدليل أنّ المستخدم وافق على ما رآه)');
const BAD_VERSION = [
  ['صفر', 0, 'BELOW_FIRST_VERSION'], ['سالب', -1, 'BELOW_FIRST_VERSION'], ['كسر', 1.5, 'NOT_AN_INTEGER'],
  ['أحدث من الحالية', V.CONSENT_TEXT_VERSION + 1, 'ABOVE_CURRENT_VERSION'], ['نصّ «1»', '1', 'NOT_A_FINITE_NUMBER'], ['منطقي', true, 'NOT_A_FINITE_NUMBER'],
  ['NaN', NaN, 'NOT_A_FINITE_NUMBER'], ['Infinity', Infinity, 'NOT_A_FINITE_NUMBER'], ['كائن', {}, 'NOT_A_FINITE_NUMBER'], ['مصفوفة', [1], 'NOT_A_FINITE_NUMBER'],
];
for (const [label, textVersion, cause] of BAD_VERSION) {
  deq(C.validateConsentInput({textVersion, locale: 'ar'}), {ok: false, refusal: R.TEXT_VERSION_INVALID, extra: ` cause=${cause}`}, `[١] نسخة ${label} ⟵ CONSENT_TEXT_VERSION_INVALID بسبب القراءة ${cause} (لا القيمة الخام)`);
}
for (const [label, d] of [['غائبة', {locale: 'ar'}], ['undefined', {textVersion: undefined, locale: 'ar'}], ['null', {textVersion: null, locale: 'ar'}]]) {
  deq(C.validateConsentInput(d), {ok: false, refusal: R.TEXT_VERSION_REQUIRED, extra: ''}, `[١] نسخة ${label} ⟵ CONSENT_TEXT_VERSION_REQUIRED (لا قيمة افتراضية: القاعدة 22)`);
}
for (const [label, locale] of [['غائبة', undefined], ['null', null], ['فارغة', '']]) {
  deq(C.validateConsentInput({textVersion: 1, locale}), {ok: false, refusal: R.LOCALE_REQUIRED, extra: ''}, `[١] لغة ${label} ⟵ CONSENT_LOCALE_REQUIRED`);
}
for (const [label, locale] of [['إنجليزية', 'en'], ['بأحرف كبيرة', 'AR'], ['مع منطقة', 'ar-SA'], ['رقم', 1], ['كائن', {}], ['مسافة', ' ar']]) {
  deq(C.validateConsentInput({textVersion: 1, locale}), {ok: false, refusal: R.LOCALE_INVALID, extra: ''}, `[١] لغة ${label} ⟵ CONSENT_LOCALE_INVALID (قائمة مغلقة، لا تطبيع صامت)`);
}
for (const bad of [undefined, null, 'x', 5, [], [1]]) {
  eq(C.validateConsentInput(bad).refusal, R.TEXT_VERSION_REQUIRED, `[١] data ${JSON.stringify(bad)} ليست كائناً ⟵ تُقرأ بلا حقول: أوّل غياب النسخة`);
}
eq(C.validateConsentInput({locale: 'xx'}).refusal, R.TEXT_VERSION_REQUIRED, '[١] الترتيب: النسخة قبل اللغة');

// ═══ ٢ — شكل السجلّين ═══
{
  const a = C.buildAcceptedRecord({textVersion: 1, locale: 'tr', acceptedAt: 'SERVER-TS'});
  deq(a, {state: 'accepted', textVersion: 1, locale: 'tr', acceptedAt: 'SERVER-TS'}, '[٢] المقبولة: الحقول الأربعة المعتمدة (E11) بقيمها');
  deq(Object.keys(a), ['state', 'textVersion', 'locale', 'acceptedAt'], '[٢] ترتيب المفاتيح');
  const nc = C.buildNotCollectedRecord();
  deq(nc, {state: 'not_collected', textVersion: null, locale: null, acceptedAt: null}, '[٢] غير المجموعة: المفاتيح الأربعة نفسها، والغياب null صريح (لا مفتاح محذوف ولا قيمة تشبه موافقة)');
  deq(Object.keys(nc), Object.keys(a), '[٢] السجلّان بالمفاتيح نفسها (قارئ واحد لهما)');
  ok(nc !== C.buildNotCollectedRecord(), '[٢] كل نداء كائن جديد (لا مشاركة حالة بين مستندات)');
  eq(a.state, V.CONSENT_STATE.ACCEPTED, '[٢] القيمة من CONSENT_STATE (لا حرفيّة)');
}

// ═══ ٣ — readStoredConsent ═══
for (const [label, pending] of [['null', null], ['undefined', undefined], ['{}', {}], ['purposeSource وحده', {purposeSource: 'default'}], ['consent: undefined', {consent: undefined}], ['consent: null', {consent: null}], ['ليس كائناً', 'x']]) {
  deq(C.readStoredConsent(pending), {state: 'ABSENT', record: null}, `[٣] ${label} ⟵ ABSENT`);
}
{
  const r = C.readStoredConsent({consent: ACCEPTED(), purposeSource: 'default'});
  eq(r.state, 'PRESENT', '[٣] سجلّ مقبول ⟵ PRESENT');
  deq(r.record, ACCEPTED(), '[٣] والسجلّ المقروء بمفاتيحه الأربعة (وقت الخادم كما هو)');
  const t = TS(5);
  eq(C.readStoredConsent({consent: ACCEPTED({acceptedAt: t})}).record.acceptedAt, t, '[٣] acceptedAt يُنسخ كائناً لا تحويراً');
  deq(C.readStoredConsent({consent: {...ACCEPTED(), unknownExtra: 1}}).record, ACCEPTED(), '[٣] مفتاح زائد مجهول لا يمنع القراءة ولا يُنسخ (القراءة تأخذ المفاتيح الأربعة وحدها)');
  eq(C.readStoredConsent({consent: ACCEPTED({locale: 'tr'})}).state, 'PRESENT', '[٣] التركية مقروءة');
  // (2026-10-23) المخزَّن من 1 إلى الحالية مقروء بنسخته (السجلّات القديمة بنسخة 1 لا تتغيّر ولا تصير غير مقروءة برفع الحالية)
  for (const v of [1, 2]) { // 1 القديمة و2 الجديدة (ما يرسله التطبيق بعد تغيير النصّ)
    const r = C.readStoredConsent({consent: ACCEPTED({textVersion: v})});
    deq([r.state, r.record && r.record.textVersion], ['PRESENT', v], `[٣] مخزَّن بنسخة ${v} (من 1 إلى الحالية) ⟵ PRESENT بنسخته`);
  }
}
const UNREADABLE = [
  ['declined', ACCEPTED({state: 'declined'})], ['not_collected', ACCEPTED({state: 'not_collected'})], ['حالة نصّ آخر', ACCEPTED({state: 'ACCEPTED'})], ['حالة غائبة', {textVersion: 1, locale: 'ar', acceptedAt: TS(1)}],
  ['نسخة صفر', ACCEPTED({textVersion: 0})], ['نسخة أحدث من الحالية', ACCEPTED({textVersion: V.CONSENT_TEXT_VERSION + 1})], ['نسخة نصّ', ACCEPTED({textVersion: '1'})], ['نسخة كسر', ACCEPTED({textVersion: 1.5})], ['نسخة غائبة', ACCEPTED({textVersion: undefined})],
  ['لغة مجهولة', ACCEPTED({locale: 'en'})], ['لغة غائبة', ACCEPTED({locale: undefined})], ['لغة رقم', ACCEPTED({locale: 1})],
  ['وقت غائب', ACCEPTED({acceptedAt: undefined})], ['وقت null', ACCEPTED({acceptedAt: null})], ['وقت نصّ', ACCEPTED({acceptedAt: '2026-10-21'})], ['وقت Date خامّ', ACCEPTED({acceptedAt: new Date(1)})], ['وقت غير منتهٍ', ACCEPTED({acceptedAt: {toMillis: () => NaN}})],
  ['نصّ بدل الكائن', 'accepted'], ['مصفوفة', [ACCEPTED()]], ['رقم', 1], ['true', true],
];
for (const [label, raw] of UNREADABLE) {
  deq(C.readStoredConsent({consent: raw}), {state: 'UNREADABLE', record: null}, `[٣] ${label} ⟵ UNREADABLE (لا تُقرأ موافقةً ولا غياباً)`);
}

// ═══ ٤ — consentForScanProtocol ═══
{
  const rec = C.consentForScanProtocol({isSessionScan: true, pendingData: {consent: ACCEPTED(), doubleEvalDraw: {selected: false}}});
  deq([rec.basis, rec.record], ['RECORDED', ACCEPTED()], '[٤] جلسة بسجلّ مقبول ⟵ يُنسخ، وأساسه RECORDED');
  const none = C.consentForScanProtocol({isSessionScan: true, pendingData: {purposeSource: 'default'}});
  deq([none.basis, none.record], ['NOT_RECORDED', C.buildNotCollectedRecord()], '[٤] جلسة بلا سجلّ (تطبيق قديم) ⟵ not_collected، وأساسه NOT_RECORDED');
  const noPending = C.consentForScanProtocol({isSessionScan: true, pendingData: null});
  deq([noPending.basis, noPending.record.state], ['NOT_RECORDED', 'not_collected'], '[٤] جلسة بلا مستند protocolPending أصلاً (أُنشئت قبل النشر) ⟵ not_collected');
  const bad = C.consentForScanProtocol({isSessionScan: true, pendingData: {consent: ACCEPTED({state: 'declined'})}});
  deq([bad.basis, bad.record], ['UNREADABLE', C.buildNotCollectedRecord()], '[٤] مخزَّن غير مقروء ⟵ not_collected (لا يُقرأ موافقةً) وأساسه UNREADABLE — فيُعلَن بسطر');
  const ns = C.consentForScanProtocol({isSessionScan: false, pendingData: null});
  deq([ns.basis, ns.record], ['NO_SESSION', C.buildNotCollectedRecord()], '[٤] فحص بلا جلسة ⟵ not_collected، وأساسه NO_SESSION');
  const nsWith = C.consentForScanProtocol({isSessionScan: false, pendingData: {consent: ACCEPTED()}});
  eq(nsWith.basis, 'NO_SESSION', '[٤] فحص بلا جلسة لا يقرأ protocolPending ولو مُرِّر له سجلّ (الموافقة بالجلسة لا بالجهاز)');
  // (ق14، 2026-10-23، القاعدة 23: كانت أربعة؛ استُبدلت بخمسة: أُضيف INHERITED — تفصيل الوراثة في consentInheritance.test.js)
  deq(Object.values(C.CONSENT_BASIS).sort(), ['INHERITED', 'NOT_RECORDED', 'NO_SESSION', 'RECORDED', 'UNREADABLE'], '[٤] أسس الكتابة الخمسة قائمة مغلقة');
}

// ═══ ٥ — decideRecordConsent ═══
const NOW = new Date('2026-10-21T12:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000);
const PAST = new Date(NOW.getTime() - 30 * 60 * 1000);
const O = S.OUTCOME;
const decide = (data, uid, pendingData = null) => S.decideRecordConsent({data, pendingData, uid, now: NOW});
const base = {ownerId: 'owner-1', joinedBy: 'joiner-1', expiresAt: FUTURE};
deq(decide({...base, status: 'scanning'}, 'joiner-1'), {outcome: O.RECORD}, '[٥] المنضمّ على scanning صالحة بلا مخزَّن ⟵ RECORD');
deq(decide({...base, status: 'scanning'}, 'joiner-1', {purposeSource: 'default'}), {outcome: O.RECORD}, '[٥] ومع protocolPending بلا consent ⟵ RECORD');
{
  const r = decide({...base, status: 'scanning'}, 'joiner-1', {consent: ACCEPTED({locale: 'tr'})});
  deq([r.outcome, r.stored], [O.ALREADY_RECORDED, ACCEPTED({locale: 'tr'})], '[٥] سجلّ مقروء ⟵ ALREADY_RECORDED بالمخزَّن (الأوّل يبقى)');
  const u = decide({...base, status: 'scanning'}, 'joiner-1', {consent: ACCEPTED({state: 'declined'})});
  deq([u.outcome, u.refusal], [O.REFUSED, R.STORED_UNREADABLE], '[٥] مخزَّن غير مقروء ⟵ CONSENT_STORED_UNREADABLE (لا يُكتب فوقه)');
}
// الوجود والدور
deq(decide(null, 'joiner-1'), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[٥] مستند غائب ⟵ SESSION_NOT_FOUND');
deq(decide(undefined, 'joiner-1'), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[٥] undefined ⟵ SESSION_NOT_FOUND');
{
  const own = decide({...base, status: 'scanning'}, 'owner-1');
  deq([own.outcome, own.refusal, own.extra], [O.REFUSED, R.NOT_JOINER, ' role=owner'], '[٥] **المالك لا يسجّل موافقة الهاتف المفحوص** ⟵ NOT_JOINER (role=owner في السجلّ)');
  const stranger = decide({...base, status: 'scanning'}, 'stranger');
  deq([stranger.refusal, stranger.extra], [R.NOT_JOINER, ' joinedBy=other-uid'], '[٥] غريب ⟵ NOT_JOINER مع حالة joinedBy في السجلّ');
  for (const [label, jb, state] of [['غائب', undefined, 'absent'], ['null', null, 'null'], ['فارغ', '', 'empty'], ['رقم', 5, 'invalid-type']]) {
    const x = decide({ownerId: 'owner-1', status: 'scanning', expiresAt: FUTURE, joinedBy: jb}, jb === undefined ? undefined : jb);
    deq([x.outcome, x.refusal, x.extra], [O.REFUSED, R.NOT_JOINER, ` joinedBy=${state}`], `[٥] joinedBy ${label} والمستدعي بالقيمة نفسها: يُرفض (لا يتساوى الغياب بالغياب) وحالته ${state} في السجلّ`);
  }
  eq(decide({...base, status: 'scanning'}, null).refusal, R.NOT_JOINER, '[٥] مستدعٍ بلا uid ⟵ NOT_JOINER');
  eq(decide({...base, status: 'completed'}, 'stranger').refusal, R.NOT_JOINER, '[٥] الدور قبل الحالة: غريب على completed ⟵ NOT_JOINER لا NOT_SCANNING (لا تُكشف حالة جلسة لغير طرفيها)');
  eq(decide({ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE}, 'joiner-1').refusal, R.NOT_JOINER, '[٥] pending (لم ينضمّ أحد بعد) ⟵ NOT_JOINER');
}
// الحالات
for (const status of ['pending', 'completed', 'cancelled', 'expired']) {
  const r = decide({...base, status}, 'joiner-1');
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_SCANNING, ` status=${status}`], `[٥] المنضمّ على ${status} ⟵ CONSENT_SESSION_NOT_SCANNING (الحالة في السجلّ)`);
}
for (const [label, status, state] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['لا تعرفها الشيفرة', 'done', 'UNRECOGNIZED'], ['بأحرف مختلفة', 'Scanning', 'UNRECOGNIZED']]) {
  const r = decide({...base, status}, 'joiner-1');
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.STATUS_UNKNOWN, ` statusState=${state}`], `[٥] حالة ${label} ⟵ STATUS_UNKNOWN وسبب القراءة في السجلّ (لا تُقرأ scanning من الغياب)`);
}
// الانقضاء (scanning فقط)
{
  const r = decide({...base, status: 'scanning', expiresAt: PAST}, 'joiner-1');
  deq([r.outcome, r.refusal], [O.EXPIRE, R.EXPIRED], '[٥] scanning منقضية ⟵ EXPIRE (تُكتب «منتهية» ثم يُرفض النداء)');
  eq(decide({...base, status: 'scanning', expiresAt: new Date(NOW.getTime())}, 'joiner-1').outcome, O.RECORD, '[٥] expiresAt == الآن تماماً: لم تنقضِ بعد');
  eq(decide({...base, status: 'scanning', expiresAt: new Date(NOW.getTime() - 1)}, 'joiner-1').outcome, O.EXPIRE, '[٥] وبعدها بمللي ثانية: انقضت');
  const cx = decide({...base, status: 'cancelled', expiresAt: PAST}, 'joiner-1');
  eq(cx.refusal, R.NOT_SCANNING, '[٥] cancelled منقضية: NOT_SCANNING (النهائية لا تتحوّل)');
  for (const bad of [undefined, null, 'garbage', {seconds: 1}]) {
    const x = decide({ownerId: 'owner-1', joinedBy: 'joiner-1', status: 'scanning', expiresAt: bad}, 'joiner-1');
    deq([x.outcome, x.refusal], [O.REFUSED, R.EXPIRES_AT_INVALID], `[٥] expiresAt ${JSON.stringify(bad)} ⟵ EXPIRES_AT_INVALID بلا كتابة (لا «صالحة» ولا «منتهية»)`);
  }
  const both = decide({...base, status: 'scanning', expiresAt: PAST}, 'joiner-1', {consent: ACCEPTED()});
  eq(both.outcome, O.EXPIRE, '[٥] الانقضاء قبل المخزَّن: منتهية تُسجَّل ولو وُجد سجلّ');
}

// ═══ ٦ — ردود الرفض ═══
ok(Object.isFrozen(S.REFUSAL_RESPONSE) && Object.isFrozen(S.OUTCOME) && Object.isFrozen(R), '[٦] REFUSAL_RESPONSE وOUTCOME وRECORD_CONSENT_REFUSAL مجمَّدة');
deq(Object.keys(S.REFUSAL_RESPONSE).sort(), Object.values(R).filter((v) => v !== R.NOT_PARTICIPANT).sort(), '[٦] لكلّ رمز في RECORD_CONSENT_REFUSAL ردّ — عدا NOT_PARTICIPANT الذي هو ما يراه العميل لا سبباً داخلياً');
const EXISTING_TEXTS = new Set(['يجب تسجيل الدخول', 'جلسة الفحص غير صالحة', 'الجلسة منتهية', 'sessionId مطلوب']);
for (const [reason, spec] of Object.entries(S.REFUSAL_RESPONSE)) {
  ok(['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition'].includes(spec.code), `[٦] ${reason}: رمز HttpsError معروف (${spec.code})`);
  ok(EXISTING_TEXTS.has(spec.message) || spec.message === reason, `[٦] ${reason}: النصّ إمّا قائم («${spec.message}») وإمّا رمزه نفسه رسالةً تقنيّة — لا نصّ عربي جديد يصل مستخدماً`);
  ok(Object.values(R).includes(spec.clientReasonCode), `[٦] ${reason}: رمز العميل من RECORD_CONSENT_REFUSAL (${spec.clientReasonCode})`);
}
for (const gone of [R.SESSION_NOT_FOUND, R.NOT_JOINER]) {
  deq([S.REFUSAL_RESPONSE[gone].code, S.REFUSAL_RESPONSE[gone].message, S.REFUSAL_RESPONSE[gone].clientReasonCode], ['permission-denied', 'جلسة الفحص غير صالحة', R.NOT_PARTICIPANT], `[٦] ${gone} يصل العميل بالردّ نفسه (NOT_PARTICIPANT): لا يُكشف وجود جلسة`);
}
deq(S.REFUSAL_RESPONSE[R.NOT_SCANNING], {code: 'failed-precondition', message: 'CONSENT_SESSION_NOT_SCANNING', clientReasonCode: 'CONSENT_SESSION_NOT_SCANNING'}, '[٦] CONSENT_SESSION_NOT_SCANNING: failed-precondition ورسالته رمزه (النصّ العربي معلّق: نصّ بانتظار الاعتماد، §٥-أ B9)');
deq(S.REFUSAL_RESPONSE[R.STORED_UNREADABLE], {code: 'failed-precondition', message: 'CONSENT_STORED_UNREADABLE', clientReasonCode: 'CONSENT_STORED_UNREADABLE'}, '[٦] CONSENT_STORED_UNREADABLE: failed-precondition ورسالته رمزه');
deq(S.REFUSAL_RESPONSE[R.EXPIRED], {code: 'failed-precondition', message: 'الجلسة منتهية', clientReasonCode: 'SESSION_EXPIRED'}, '[٦] انتهاء الصلاحية: النصّ والرمز القائمان لـsessionTimeout.js');
deq(S.REFUSAL_RESPONSE[R.EXPIRES_AT_INVALID], {code: 'permission-denied', message: 'جلسة الفحص غير صالحة', clientReasonCode: 'SESSION_EXPIRES_AT_INVALID'}, '[٦] غياب expiresAt: النصّ والرمز القائمان');
eq(S.REFUSAL_RESPONSE[R.NOT_AUTHENTICATED].message, 'يجب تسجيل الدخول', '[٦] غير مسجَّل: النصّ القائم نفسه');
eq(S.REFUSAL_RESPONSE[R.SESSION_ID_REQUIRED].message, 'sessionId مطلوب', '[٦] sessionId غائب: النصّ القائم نفسه');
for (const name of ['TEXT_VERSION_REQUIRED', 'TEXT_VERSION_INVALID', 'LOCALE_REQUIRED', 'LOCALE_INVALID', 'STATUS_UNKNOWN']) {
  eq(S.REFUSAL_RESPONSE[R[name]].message, R[name], `[٦] ${name}: الرسالة هي الرمز نفسه (لا عربية جديدة)`);
  eq(S.REFUSAL_RESPONSE[R[name]].code, name === 'STATUS_UNKNOWN' ? 'failed-precondition' : 'invalid-argument', `[٦] ${name}: رمز HttpsError`);
}
// (ق40، 2026-10-23، القاعدة 23: أُضيف إلى القائمة لا اختبار موازٍ) جزء الموافقة للمحلّ: failed-precondition ورسالته رمزه — تفصيله في recordScanConsentPart.test.js
deq(S.REFUSAL_RESPONSE[R.PART_NOT_ENABLED], {code: 'failed-precondition', message: 'CONSENT_PART_NOT_ENABLED', clientReasonCode: 'CONSENT_PART_NOT_ENABLED'}, '[٦] CONSENT_PART_NOT_ENABLED: failed-precondition ورسالته رمزه (لا عربية جديدة)');
ok(R.SESSION_NOT_FOUND === 'SESSION_NOT_FOUND' && R.NOT_PARTICIPANT === 'SESSION_NOT_PARTICIPANT' && R.EXPIRED === 'SESSION_EXPIRED' && R.STATUS_UNKNOWN === 'SESSION_STATUS_UNKNOWN', '[٦] ما له قيمة قائمة أخذها منها (مصدر واحد)');
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { S.refuse(R.NOT_JOINER, {sessionId: 'session-aaa-111', uid: 'uid-bbb-222', extra: ' role=owner'}); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'permission-denied' && thrown.message === 'جلسة الفحص غير صالحة', '[٦] refuse ترمي بردّ السبب');
    deq(thrown.details, {reasonCode: 'SESSION_NOT_PARTICIPANT'}, '[٦] details = {reasonCode: NOT_PARTICIPANT} للمالك والغريب');
    eq(warns[0], `[recordScanConsent] refused reason=SESSION_NOT_JOINER session=${hashIdForLog('session-aaa-111')} caller=${hashIdForLog('uid-bbb-222')} role=owner`, '[٦] والسجلّ يقول NOT_JOINER بمعرّفين مُهشَّرين ودور المستدعي');
    ok(!warns[0].includes('session-aaa-111') && !warns[0].includes('uid-bbb-222'), '[٦] لا معرّف خامّ');
    warns.length = 0;
    try { S.refuse(R.NOT_AUTHENTICATED); } catch (e) { thrown = e; }
    eq(warns[0], `[recordScanConsent] refused reason=CONSENT_NOT_AUTHENTICATED caller=${hashIdForLog(null)}`, '[٦] بلا هوية ولا جلسة: بلا session=');
    warns.length = 0;
    try { S.refuse(R.TEXT_VERSION_INVALID, {sessionId: 's', uid: 'u', extra: ' cause=ABOVE_CURRENT_VERSION'}); } catch (e) { thrown = e; }
    deq([thrown.code, thrown.message, thrown.details], ['invalid-argument', 'CONSENT_TEXT_VERSION_INVALID', {reasonCode: 'CONSENT_TEXT_VERSION_INVALID'}], '[٦] النسخة غير الصالحة: الرمز والرسالة والتفصيل');
    ok(/ cause=ABOVE_CURRENT_VERSION$/.test(warns[0]), '[٦] وسبب القراءة في السجلّ لا القيمة الخام');
    let bad = null;
    warns.length = 0;
    try { S.refuse('NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message) && warns.length === 0, '[٦] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}

// ═══ ٧ — حرّاس البنية ═══
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const source = strip(read('src', 'sessions', 'recordScanConsent.js'));
{
  const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
  eq(throwSites.length, 1, '[٧] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
  const refuseDef = source.indexOf('function refuse(');
  const refuseEnd = source.indexOf('\n}\n', refuseDef);
  ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٧] وهو داخل refuse — فرمي رفض جديد بلا سبب مسمّى يُفشل هنا');
  const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
  deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٧] ثلاثة throw: رمي refuse، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما هو (throw e)');
  for (const name of Object.keys(R)) ok(new RegExp(`\\bR\\.${name}\\b`).test(source), `[٧] الرمز ${name} مستعمَل في recordScanConsent.js`);
  ok(!/refuse\(\s*["'`]/.test(source), '[٧] ولا نداء refuse بسبب نصّ حرفي');
  ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source), '[٧] لا حذف في recordScanConsent.js (القاعدة 42)');
  ok(!/["'`](pending|scanning|completed|expired|cancelled)["'`]/.test(source), '[٧] لا نصّ حرفي لحالة جلسة (SESSION_STATUS من sessionNames.js)');
  ok(!/["'`](accepted|declined|not_collected|ar|tr)["'`]/.test(source), '[٧] ولا نصّ حرفي لحالة موافقة أو لغة (protocolVocabulary)');
  const txStart = source.indexOf('db.runTransaction(');
  const txEnd = source.indexOf('} catch (e) {', txStart);
  ok(txStart > 0 && txEnd > txStart, '[٧] المعاملة موجودة');
  const txBody = source.slice(txStart, txEnd);
  ok(!/throw\s/.test(txBody), '[٧] **لا throw داخل دالّة المعاملة** — تُرجِع قراراً (الرمي يُسقط كتابة «منتهية»)');
  const gets = [...txBody.matchAll(/tx\.get\(/g)];
  const writes = [...txBody.matchAll(/tx\.(update|set)\(/g)];
  // (ق40، القاعدة 23: كان قراءتين) ثلاث: الجلسة وprotocolPending ومستند المالك (الأخيرة في فرع «اكتب» وحده، بعد القرارات كلّها وقبل كتابة السجلّ)
  eq(gets.length, 3, '[٧] ثلاث قراءات داخل المعاملة: الجلسة وprotocolPending ومستند المالك');
  ok(/tx\.get\(sessionRef\)/.test(txBody) && /tx\.get\(pendingRef\)/.test(txBody) && /tx\.get\(ownerRef\)/.test(txBody), '[٧] والقراءات الثلاث بمراجعها: sessionRef وpendingRef وownerRef');
  ok(txBody.indexOf('tx.get(ownerRef)') < txBody.indexOf('tx.set(pendingRef'), '[٧] قراءة المالك قبل كتابة السجلّ (شرط معاملات Firestore) وبعد قرار الجلسة');
  ok(txBody.indexOf('tx.get(ownerRef)') > txBody.indexOf('decideRecordConsent('), '[٧] وبعد decideRecordConsent: فرفضٌ أسبق لا يقرأ المالك');
  eq(writes.length, 2, '[٧] كتابتان لا غير: «منتهية» (EXPIRE) · سجلّ الموافقة');
  // قراءتا الجلسة وprotocolPending قبل أول كتابة نصّاً؛ وقراءة المالك في فرع «اكتب» قبل كتابة السجلّ (أعلاه) — وفرع EXPIRE لا يقرؤها أصلاً (يحرسه recordScanConsentPart.test.js بقاعدة تُرمي فيها القراءة بعد الكتابة)
  ok(Math.max(txBody.indexOf('tx.get(sessionRef)'), txBody.indexOf('tx.get(pendingRef)')) < Math.min(...writes.map((m) => m.index)), '[٧] قراءتا الجلسة وprotocolPending قبل أول كتابة (شرط معاملات Firestore)');
  ok(/tx\.update\(sessionRef, expiredWriteFields\(admin\.firestore\.FieldValue\)\)/.test(txBody), '[٧] كتابة «منتهية» بالدالّة القائمة expiredWriteFields (لا حقول مكرَّرة)');
  ok(/tx\.set\(pendingRef, \{\[CONSENT_FIELD\]: record\}, \{merge: true\}\)/.test(txBody), '[٧] السجلّ يُدمَج في protocolPending بمفتاح واحد (لا استبدال المستند، لا حذف حقول: purposeSource وdoubleEvalDraw باقيان)');
  ok(/acceptedAt: admin\.firestore\.FieldValue\.serverTimestamp\(\)/.test(txBody), '[٧] وقت القبول وقت الخادم (لا وقت العميل)');
  ok(/db\.collection\(PROTOCOL_COLLECTION\.PROTOCOL_PENDING\)\.doc\(sessionId\)/.test(source), '[٧] مرجع protocolPending باسم المجموعة من protocolVocabulary وبمعرّف الجلسة');
  ok(!/\.where\(/.test(source), '[٧] لا استعلام (قراءة بمعرّف مستند وحده: لا فهرس، القاعدة 43)');
}
{
  // اسم الحقل مصدر واحد (القاعدة 24): `"consent"` حرفاً لا يظهر في src إلا في consent.js (CONSENT_FIELD) وفي protocolVocabulary.js (مفتاح الجزء PROTOCOL_PART.CONSENT: معنىً آخر).
  const roots = [path.join(__dirname, '..', 'src')];
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(p);
    }
  })(roots[0]);
  const hits = files.filter((f) => /["'`]consent["'`]/.test(strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')))).map((f) => path.basename(f)).sort();
  deq(hits, ['consent.js', 'protocolVocabulary.js'], '[٧] الحرفيّة "consent" في src موضعان لا ثالث: اسم الحقل (consent.js) ومفتاح الجزء (protocolVocabulary.js) — لا نسخة ثانية لاسم الحقل');
  eq(C.CONSENT_FIELD, 'consent', '[٧] اسم الحقل `consent` (E11: شكل واحد، يسقط الاسم المسطَّح consentState)');
  ok(!files.some((f) => /consentState/.test(strip(fs.readFileSync(f, 'utf8')))), '[٧] والاسم المسطَّح consentState لا يظهر في أيّ كود (سقط بقرار E11)');
  const doc = strip(read('src', 'protocol', 'scanProtocolDocument.js'));
  ok(/\[CONSENT_FIELD\]: /.test(doc) && /consentForScanProtocol\(/.test(doc), '[٧] scanProtocolDocument.js يكتب الحقل بالمصدر الواحد ويبنيه بـconsentForScanProtocol');
}
{
  const consentSrc = strip(read('src', 'protocol', 'consent.js'));
  ok(!/require\(["']firebase-admin["']\)|utils\/admin|\bdb\b\./.test(consentSrc), '[٧] consent.js نقيّ: لا Firestore ولا admin (القاعدة 41)');
  ok(!/Date\.now|new Date\(|Math\.random/.test(consentSrc), '[٧] ولا وقت ولا عشوائية داخله: acceptedAt يُمرَّر صراحةً');
}

console.log(`\nconsent.test.js: ${n}/${n} assertions passed`);
