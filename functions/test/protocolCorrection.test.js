'use strict';

// protocolCorrection.test.js — التصحيح بالإلحاق: تحقّق المدخل، قراءة علامة الاستبعاد، قرار كل فعل، وحرّاس بنية correctProtocolRecord (S-P6-18، 2026-10-21 +03).
// وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في protocolCorrection.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-٥ (:854-868) وdocs/PROTOCOL_CONTRACT.md §٢ A11: «دالّة مشرف `correctProtocolRecord` بأفعال: `unlink`، و`relink(toScanId)`. و`exclude(reason ∈ {test, wrong, golden_reference})`، و`unexclude`.
// و`resolveIdentityConflict`. كل فعل: يكتب علامة على `scanProtocol` (`exclusion: {state, reasonCode, at}`، `linkState`). ويُلحق سطراً في `protocolCorrections` بالقيم قبل وبعد، ورمز سبب، والمشرف مُهشَّراً. لا حذف بأيّ وسيلة (القاعدة 42).»
//   ١ validateCorrectionInput: كل قيمة معدَّدة تصل من العميل بكل قيمها (القاعدة 30): الأفعال الخمسة · الأسباب الثلاثة · الهدف (scanId أو shortId) · ما ينطبق على الفعل · المفاتيح المجهولة
//   ٢ readExclusionMarker وreadExclusionFromLines وreadExclusion: القارئ الواحد؛ الغياب والتلف حالتان صريحتان
//   ٣ decideCorrection: كل فعل على كل أساس (scanProtocol · تقرير وحده) وكل حالة ربط، وغير المتغيّر، والرفوض بترتيبها
//   ٤ سطر الملحَق: التسعة حقول بالضبط
//   ٥ ردود الرفض، وحرّاس البنية: موضع رمي واحد · tx.create للسطر · لا حذف · لا limit/orderBy · القراءات قبل الكتابات · أسماء الحقول مصدر واحد
//
// Run: node functions/test/protocolCorrection.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const P = require('../src/protocol/protocolCorrection');
const A = require('../src/admin/protocolCorrectionAdmin');
const V = require('../src/protocol/protocolVocabulary');
const {hashIdForLog} = require('../src/utils/logRedaction');
const R = P.CORRECTION_REFUSAL;
const O = P.OUTCOME;

const TS = (ms) => ({toMillis: () => ms});
const v = (input) => P.validateCorrectionInput(input);
const refusalOf = (input) => { const r = v(input); return r.ok ? null : [r.refusal, r.field]; };

// ═══ ١ — validateCorrectionInput ═══
deq(v({action: 'exclude', scanId: 'scan-1', reason: 'test'}), {ok: true, action: 'exclude', scanId: 'scan-1', shortId: null, toScanId: null, reason: 'test'}, '[١] exclude بـscanId وسبب');
deq(v({action: 'exclude', shortId: 'NC-7BARX5', reason: 'wrong'}), {ok: true, action: 'exclude', scanId: null, shortId: 'NC-7BARX5', toScanId: null, reason: 'wrong'}, '[١] exclude برمز التقرير (NC-7BARX5 من قائمة القرار)');
deq(v({action: 'exclude', shortId: ' nc-7barx5 ', reason: 'golden_reference'}).shortId, 'NC-7BARX5', '[١] رمز التقرير يُشذَّب ويُرفَع (الصيغة المخزَّنة بأحرف كبيرة)');
deq(v({action: 'unexclude', scanId: 'scan-1'}), {ok: true, action: 'unexclude', scanId: 'scan-1', shortId: null, toScanId: null, reason: null}, '[١] unexclude بلا سبب');
deq(v({action: 'unlink', scanId: 'scan-1'}), {ok: true, action: 'unlink', scanId: 'scan-1', shortId: null, toScanId: null, reason: null}, '[١] unlink');
deq(v({action: 'relink', scanId: 'scan-1', toScanId: 'scan-2'}), {ok: true, action: 'relink', scanId: 'scan-1', shortId: null, toScanId: 'scan-2', reason: null}, '[١] relink بـtoScanId');
deq(Object.values(V.CORRECTION_ACTION).sort(), ['exclude', 'relink', 'resolveIdentityConflict', 'unexclude', 'unlink'], '[١] الأفعال الخمسة من التصميم (P:856-859)');
for (const reason of Object.values(V.EXCLUSION_REASON)) eq(v({action: 'exclude', scanId: 's', reason}).ok, true, `[١] السبب ${reason} مقبول (الأسباب الثلاثة بكل قيمها: القاعدة 30)`);
deq(Object.values(V.EXCLUSION_REASON).sort(), ['golden_reference', 'test', 'wrong'], '[١] والأسباب الثلاثة قائمة مغلقة');
deq(refusalOf({action: 'resolveIdentityConflict', scanId: 's'}), [R.ACTION_NOT_SPECIFIED, 'action'], '[١] resolveIdentityConflict مسمّى ومرفوض برفض مسمّى (لا مواصفة، ويتبع هويّة الجهاز)');
for (const bad of [undefined, null, 'x', 5, [], [1]]) deq(refusalOf(bad), [R.ACTION_REQUIRED, 'action'], `[١] data ${JSON.stringify(bad)} ليست كائناً ⟵ تُقرأ بلا حقول: الفعل غائب`);
for (const a of [undefined, null, '']) deq(refusalOf({action: a, scanId: 's'}), [R.ACTION_REQUIRED, 'action'], `[١] الفعل ${JSON.stringify(a)} ⟵ ACTION_REQUIRED`);
for (const a of ['delete', 'Exclude', 'unlink ', 5, {}, 'remove']) deq(refusalOf({action: a, scanId: 's', reason: 'test'}), [R.ACTION_INVALID, 'action'], `[١] الفعل ${JSON.stringify(a)} ⟵ ACTION_INVALID (لا فعل حذف، ولا تطبيع صامت)`);
deq(refusalOf({action: 'exclude', scanId: 's', reason: 'test', extra: 1}), [R.FIELD_UNKNOWN, 'extra'], '[١] مفتاح مجهول ⟵ FIELD_UNKNOWN باسمه');
deq(refusalOf({action: 'exclude', scanId: 's', reason: 'test', deviceId: 'x'}), [R.FIELD_UNKNOWN, 'deviceId'], '[١] ولا معرّف جهاز يُقبل مدخلاً');
deq(refusalOf({action: 'exclude', reason: 'test'}), [R.TARGET_REQUIRED, null], '[١] لا scanId ولا shortId ⟵ TARGET_REQUIRED');
deq(refusalOf({action: 'exclude', scanId: null, shortId: undefined, reason: 'test'}), [R.TARGET_REQUIRED, null], '[١] ومع null/undefined ⟵ TARGET_REQUIRED');
deq(refusalOf({action: 'exclude', scanId: 's', shortId: 'NC-ABC123', reason: 'test'}), [R.TARGET_AMBIGUOUS, null], '[١] الاثنان معاً ⟵ TARGET_AMBIGUOUS (لا يُختار أحدهما)');
for (const s of ['', ' s', 's ', 'a/b', '.', '..', 5, {}, 'x'.repeat(201)]) deq(refusalOf({action: 'exclude', scanId: s, reason: 'test'}), [R.SCAN_ID_INVALID, 'scanId'], `[١] scanId ${JSON.stringify(typeof s === 'string' ? s.slice(0, 12) : s)} ⟵ SCAN_ID_INVALID`);
for (const s of ['', 'ABC123', 'NC-', 'NC-AB', 'NC-ABCDEFGHIJKLM', 'NC-AB C12', 'XX-ABC123', 5, {}]) deq(refusalOf({action: 'exclude', shortId: s, reason: 'test'}), [R.SHORT_ID_INVALID, 'shortId'], `[١] shortId ${JSON.stringify(s)} ⟵ SHORT_ID_INVALID`);
for (const s of ['NC-7BARX5', 'NC-AB3D', 'NC-1A2B3C4D']) eq(v({action: 'exclude', shortId: s, reason: 'test'}).ok, true, `[١] ${s}: الصيغتان القائمتان (NC- + 6 · NC- + 8 سداسية) مقبولتان`);
for (const r of [undefined, null, '']) deq(refusalOf({action: 'exclude', scanId: 's', reason: r}), [R.REASON_REQUIRED, 'reason'], `[١] السبب ${JSON.stringify(r)} لـexclude ⟵ REASON_REQUIRED (لا سبب افتراضي)`);
for (const r of ['Test', 'other', 'golden', ' test', 5, {}]) deq(refusalOf({action: 'exclude', scanId: 's', reason: r}), [R.REASON_INVALID, 'reason'], `[١] السبب ${JSON.stringify(r)} ⟵ REASON_INVALID (القائمة مغلقة)`);
deq(refusalOf({action: 'exclude', scanId: 's', reason: 'test', toScanId: 'x'}), [R.FIELD_NOT_APPLICABLE, 'toScanId'], '[١] toScanId مع exclude ⟵ FIELD_NOT_APPLICABLE');
deq(refusalOf({action: 'unexclude', scanId: 's', reason: 'test'}), [R.FIELD_NOT_APPLICABLE, 'reason'], '[١] reason مع unexclude ⟵ FIELD_NOT_APPLICABLE (لا يُقبل ما سيُسقَط صامتاً)');
deq(refusalOf({action: 'unlink', scanId: 's', reason: 'test'}), [R.FIELD_NOT_APPLICABLE, 'reason'], '[١] reason مع unlink ⟵ FIELD_NOT_APPLICABLE');
deq(refusalOf({action: 'unlink', scanId: 's', toScanId: 'x'}), [R.FIELD_NOT_APPLICABLE, 'toScanId'], '[١] toScanId مع unlink ⟵ FIELD_NOT_APPLICABLE');
deq(refusalOf({action: 'unexclude', scanId: 's', toScanId: 'x'}), [R.FIELD_NOT_APPLICABLE, 'toScanId'], '[١] toScanId مع unexclude ⟵ FIELD_NOT_APPLICABLE');
deq(refusalOf({action: 'relink', scanId: 's', toScanId: 'x', reason: 'test'}), [R.FIELD_NOT_APPLICABLE, 'reason'], '[١] reason مع relink ⟵ FIELD_NOT_APPLICABLE');
for (const t of [undefined, null, '']) deq(refusalOf({action: 'relink', scanId: 's', toScanId: t}), [R.TO_SCAN_ID_REQUIRED, 'toScanId'], `[١] toScanId ${JSON.stringify(t)} لـrelink ⟵ TO_SCAN_ID_REQUIRED`);
for (const t of [' x', 'a/b', '..', 5, {}]) deq(refusalOf({action: 'relink', scanId: 's', toScanId: t}), [R.TO_SCAN_ID_INVALID, 'toScanId'], `[١] toScanId ${JSON.stringify(t)} ⟵ TO_SCAN_ID_INVALID`);
// الترتيب: مفتاح مجهول ← الفعل ← الهدف ← ما ينطبق
deq(refusalOf({action: 'delete', scanId: 's', zzz: 1}), [R.FIELD_UNKNOWN, 'zzz'], '[١] الترتيب: المجهول قبل الفعل');
deq(refusalOf({action: 'delete'}), [R.ACTION_INVALID, 'action'], '[١] والفعل قبل الهدف');
deq(refusalOf({action: 'exclude', reason: 'nope'}), [R.TARGET_REQUIRED, null], '[١] والهدف قبل السبب');

// ═══ ٢ — القراءة ═══
const MARK = (over = {}) => ({state: 'excluded', reasonCode: 'test', at: TS(1760000000000), ...over});
for (const [label, d] of [['null', null], ['undefined', undefined], ['{}', {}], ['exclusion: null', {exclusion: null}], ['exclusion: undefined', {exclusion: undefined}], ['ليس كائناً', 'x']]) {
  deq(P.readExclusionMarker(d), {state: 'ABSENT', exclusion: null}, `[٢] علامة ${label} ⟵ ABSENT`);
}
deq(P.readExclusionMarker({exclusion: MARK()}), {state: 'PRESENT', exclusion: {state: 'excluded', reasonCode: 'test'}}, '[٢] علامة مستبعَدة بسببها');
for (const reasonCode of Object.values(V.EXCLUSION_REASON)) deq(P.readExclusionMarker({exclusion: MARK({reasonCode})}).exclusion.reasonCode, reasonCode, `[٢] السبب ${reasonCode} مقروء`);
deq(P.readExclusionMarker({exclusion: MARK({state: 'not_excluded', reasonCode: null})}), {state: 'PRESENT', exclusion: {state: 'not_excluded', reasonCode: null}}, '[٢] علامة غير مستبعَد (بعد unexclude) بسبب null');
for (const [label, raw] of [
  ['excluded بلا سبب', MARK({reasonCode: null})], ['excluded بسبب مجهول', MARK({reasonCode: 'other'})], ['excluded بسبب غائب', MARK({reasonCode: undefined})],
  ['not_excluded بسبب', MARK({state: 'not_excluded', reasonCode: 'test'})], ['حالة مجهولة', MARK({state: 'EXCLUDED'})], ['حالة غائبة', MARK({state: undefined})],
  ['وقت غائب', MARK({at: undefined})], ['وقت نصّ', MARK({at: '2026-10-21'})], ['وقت غير منتهٍ', MARK({at: {toMillis: () => NaN}})], ['نصّ بدل الكائن', 'excluded'], ['مصفوفة', [MARK()]], ['true', true],
]) {
  deq(P.readExclusionMarker({exclusion: raw}), {state: 'UNREADABLE', exclusion: null}, `[٢] علامة ${label} ⟵ UNREADABLE (لا تُقرأ ولا تُخمَّن)`);
}
const LINE = (seq, exclusion, over = {}) => ({scanId: 's', action: 'exclude', reasonCode: null, basis: 'REPORT_ONLY', before: {exclusion: null, linkState: null, linkedScanId: null}, after: {exclusion, linkState: null, linkedScanId: null}, seq, at: TS(seq), by: '#abc', ...over});
const EX = (reasonCode) => ({state: 'excluded', reasonCode});
const NEX = {state: 'not_excluded', reasonCode: null};
deq(P.readExclusionFromLines([]), {state: 'ABSENT', exclusion: null, nextSeq: 1}, '[٢] لا سطور ⟵ ABSENT والتالي seq=1');
deq(P.readExclusionFromLines(undefined), {state: 'ABSENT', exclusion: null, nextSeq: 1}, '[٢] undefined ⟵ ABSENT');
deq(P.readExclusionFromLines([LINE(1, EX('test'))]), {state: 'PRESENT', exclusion: EX('test'), nextSeq: 2}, '[٢] سطر واحد ⟵ حالته، والتالي 2');
deq(P.readExclusionFromLines([LINE(2, NEX), LINE(1, EX('test'))]), {state: 'PRESENT', exclusion: NEX, nextSeq: 3}, '[٢] الترتيب بـseq لا بترتيب الوصول: الأعلى seq هو الراهن (وصل أوّلاً)');
deq(P.readExclusionFromLines([LINE(1, EX('test')), LINE(3, EX('wrong')), LINE(2, NEX)]).exclusion, EX('wrong'), '[٢] ثلاثة سطور بلا ترتيب ⟵ الثالث');
deq(P.readExclusionFromLines([LINE(1, null)]), {state: 'PRESENT', exclusion: null, nextSeq: 2}, '[٢] سطر بلا استبعاد (after.exclusion: null) يُقرأ كما هو');
for (const [label, lines] of [
  ['seq مكرَّر', [LINE(1, EX('test')), LINE(1, NEX)]], ['seq غائب', [LINE(undefined, EX('test'))]], ['seq كسر', [LINE(1.5, EX('test'))]], ['seq صفر', [LINE(0, EX('test'))]], ['seq نصّ', [LINE('1', EX('test'))]],
  ['after غائب', [{...LINE(1, EX('test')), after: undefined}]], ['after.exclusion بشكل خاطئ', [LINE(1, {state: 'excluded', reasonCode: null})]], ['سطر ليس كائناً', ['x']], ['سطر null', [null]],
]) {
  eq(P.readExclusionFromLines(lines).state, 'UNREADABLE', `[٢] سطور ${label} ⟵ UNREADABLE`);
}
// القارئ الواحد readExclusion
deq(P.readExclusion({protocolData: {exclusion: MARK()}, correctionLines: []}), {state: 'excluded', reasonCode: 'test'}, '[٢] readExclusion: scanProtocol بعلامة مستبعَدة');
deq(P.readExclusion({protocolData: {exclusion: MARK({state: 'not_excluded', reasonCode: null})}, correctionLines: []}), {state: 'not_excluded', reasonCode: null}, '[٢] وغير مستبعَد بعد التراجع');
deq(P.readExclusion({protocolData: {scanPurpose: 'normal'}, correctionLines: []}), {state: 'NOT_RECORDED', reasonCode: null}, '[٢] scanProtocol بلا علامة ⟵ NOT_RECORDED (حالة صريحة، لا «غير مستبعَد» صامتاً)');
deq(P.readExclusion({protocolData: {exclusion: MARK({reasonCode: 'x'})}, correctionLines: []}), {state: 'UNREADABLE', reasonCode: null}, '[٢] علامة تالفة ⟵ UNREADABLE');
deq(P.readExclusion({protocolData: null, correctionLines: [LINE(1, EX('golden_reference'))]}), {state: 'excluded', reasonCode: 'golden_reference'}, '[٢] **فحص أقدم من scanProtocol (E16)**: من آخر سطر في protocolCorrections');
deq(P.readExclusion({protocolData: null, correctionLines: [LINE(1, EX('test')), LINE(2, NEX)]}), {state: 'not_excluded', reasonCode: null}, '[٢] وبعد unexclude: غير مستبعَد');
deq(P.readExclusion({protocolData: null, correctionLines: []}), {state: 'NOT_RECORDED', reasonCode: null}, '[٢] بلا scanProtocol ولا سطور ⟵ NOT_RECORDED');
deq(P.readExclusion({protocolData: null, correctionLines: [LINE(1, null)]}), {state: 'NOT_RECORDED', reasonCode: null}, '[٢] وسطر بلا استبعاد ⟵ NOT_RECORDED');
deq(P.readExclusion({protocolData: null, correctionLines: [LINE(1, EX('test')), LINE(1, NEX)]}), {state: 'UNREADABLE', reasonCode: null}, '[٢] وسطور تالفة ⟵ UNREADABLE');
deq(P.readExclusion({protocolData: undefined, correctionLines: [LINE(1, EX('wrong'))]}).state, 'excluded', '[٢] protocolData undefined تعني بلا scanProtocol');
deq(Object.values(P.EXCLUSION_READ_STATE).sort(), ['NOT_RECORDED', 'UNREADABLE', 'excluded', 'not_excluded'], '[٢] حالات القارئ: القيمتان المعتمدتان (E45) وحالتا غياب صريحتان');

// ═══ ٣ — decideCorrection ═══
const PROTO = (over = {}) => ({scanPurpose: 'normal', linkedScanId: null, linkState: 'none', linkMethod: null, ...over});
const dec = (input, protocolData, over = {}) => P.decideCorrection({input: {toScanId: null, reason: null, ...input}, protocolData, reportExists: true, correctionLines: [], toProtocolExists: null, ...over});
const EXC = (scanId = 's', reason = 'test') => ({action: 'exclude', scanId, reason});
// (ق36 أ، 2026-10-22) ملاحظة الطراز linkModelCheck مع تصحيح المشرف: unlink يُبطلها (null صريح) وrelink يعيد حسابها (المُحتسَبة تُمرَّر إلى القرار النقيّ)، وتُسجَّل في before/after للربط وحده
const MC = 'LINK_MODEL_MATCH';
// exclude على scanProtocol
{
  const d1 = dec(EXC(), PROTO());
  eq(d1.outcome, O.WRITE, '[٣] exclude على scanProtocol بلا علامة ⟵ WRITE');
  deq([d1.basis, d1.reasonCode, d1.seq], ['SCAN_PROTOCOL', 'test', 1], '[٣] الأساس scanProtocol، والسبب في السطر، وseq=1');
  deq(d1.before, {exclusion: null, linkState: 'none', linkedScanId: null}, '[٣] قبل: بلا علامة والربط كما كان');
  deq(d1.after, {exclusion: EX('test'), linkState: 'none', linkedScanId: null}, '[٣] بعد: مستبعَد بسببه، والربط لم يُمَسّ');
  deq(d1.markerFields, {exclusion: EX('test')}, '[٣] العلامة: exclusion وحده (وقت الخادم يضيفه الكاتب)');
  const d2 = dec(EXC('s', 'wrong'), PROTO({exclusion: MARK()}));
  deq([d2.outcome, d2.before.exclusion, d2.after.exclusion], [O.WRITE, EX('test'), EX('wrong')], '[٣] exclude بسبب آخر على مستبعَد ⟵ WRITE (تغيير السبب يُسجَّل بقبل وبعد)');
  const d3 = dec(EXC('s', 'test'), PROTO({exclusion: MARK()}));
  deq([d3.outcome, d3.after], [O.NOOP, d3.before], '[٣] exclude بالسبب نفسه على مستبعَد ⟵ NOOP (لا سطر ولا علامة)');
  const d4 = dec(EXC(), PROTO({exclusion: MARK({state: 'not_excluded', reasonCode: null})}));
  deq([d4.outcome, d4.before.exclusion.state, d4.after.exclusion.state], [O.WRITE, 'not_excluded', 'excluded'], '[٣] exclude بعد unexclude ⟵ WRITE (يعود الاستبعاد)');
  const d5 = dec(EXC(), PROTO({exclusion: MARK({reasonCode: 'nope'})}));
  deq([d5.outcome, d5.refusal, d5.extra], [O.REFUSED, R.EXCLUSION_UNREADABLE, ' source=MARKER'], '[٣] علامة تالفة ⟵ EXCLUSION_UNREADABLE (لا يُكتب فوقها ولا يُخمَّن)');
  const d6 = dec(EXC(), PROTO(), {correctionLines: [LINE(1, EX('test')), LINE(1, NEX)]});
  deq([d6.outcome, d6.refusal, d6.extra], [O.REFUSED, R.EXCLUSION_UNREADABLE, ' source=LINES'], '[٣] وسطور تالفة ⟵ EXCLUSION_UNREADABLE (حتى مع وجود scanProtocol: لا يُلحَق على سجلّ فاسد)');
  const d7 = dec(EXC(), PROTO(), {correctionLines: [LINE(1, EX('test'), {basis: 'SCAN_PROTOCOL'}), LINE(2, NEX, {basis: 'SCAN_PROTOCOL'})]});
  eq(d7.seq, 3, '[٣] seq التالي = أعلى seq + 1 (السطور السابقة تُعدّ لا تُستبدل)');
}
// unexclude
{
  const u1 = dec({action: 'unexclude', scanId: 's'}, PROTO({exclusion: MARK({reasonCode: 'wrong'})}));
  deq([u1.outcome, u1.reasonCode, u1.before.exclusion, u1.after.exclusion, u1.markerFields], [O.WRITE, null, EX('wrong'), NEX, {exclusion: NEX}], '[٣] unexclude على مستبعَد ⟵ WRITE بقبل وبعد، وreasonCode: null صريح');
  eq(dec({action: 'unexclude', scanId: 's'}, PROTO()).outcome, O.NOOP, '[٣] unexclude بلا علامة ⟵ NOOP');
  eq(dec({action: 'unexclude', scanId: 's'}, PROTO({exclusion: MARK({state: 'not_excluded', reasonCode: null})})).outcome, O.NOOP, '[٣] وعلى غير مستبعَد ⟵ NOOP');
}
// فحص أقدم من scanProtocol (E16)
{
  const r1 = dec(EXC('old', 'test'), null);
  deq([r1.outcome, r1.basis, r1.markerFields, r1.seq], [O.WRITE, 'REPORT_ONLY', null, 1], '[٣] **E16**: exclude لفحص بلا scanProtocol ⟵ WRITE بأساس REPORT_ONLY، **بلا علامة** (لا scanProtocol شكلي) وseq=1');
  deq(r1.before, {exclusion: null, linkState: null, linkedScanId: null}, '[٣] وقبله: الربط null (لا ينطبق)');
  const r2 = dec(EXC('old', 'test'), null, {correctionLines: [LINE(1, EX('test'))]});
  eq(r2.outcome, O.NOOP, '[٣] ومرّتين بالسبب نفسه ⟵ NOOP (الحالة من آخر سطر)');
  const r3 = dec({action: 'unexclude', scanId: 'old'}, null, {correctionLines: [LINE(1, EX('test'))]});
  deq([r3.outcome, r3.seq, r3.after.exclusion], [O.WRITE, 2, NEX], '[٣] unexclude لفحص أقدم ⟵ سطر seq=2');
  eq(dec({action: 'unexclude', scanId: 'old'}, null).outcome, O.NOOP, '[٣] unexclude لفحص أقدم لم يُصحَّح ⟵ NOOP');
  for (const action of ['unlink', 'relink']) {
    const r = dec({action, scanId: 'old', toScanId: action === 'relink' ? 'other' : null}, null);
    deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NO_PROTOCOL_RECORD, ' basis=REPORT_ONLY'], `[٣] ${action} على فحص بلا scanProtocol ⟵ NO_PROTOCOL_RECORD (لا ربط بلا سجلّ بروتوكول)`);
  }
  const nf = dec(EXC('ghost'), null, {reportExists: false});
  deq([nf.outcome, nf.refusal], [O.REFUSED, R.SCAN_NOT_FOUND], '[٣] لا scanProtocol ولا تقرير ⟵ SCAN_NOT_FOUND (لا يُلحَق سطر لفحص غير موجود)');
  eq(dec(EXC('x'), PROTO(), {reportExists: false}).outcome, O.WRITE, '[٣] وscanProtocol موجود يكفي ولو لم يُقرأ التقرير');
}
// unlink
{
  const live = PROTO({linkedScanId: 'before-1', linkState: 'active', linkMethod: 'auto_confirmed'});
  const l1 = dec({action: 'unlink', scanId: 's'}, live);
  // (ق36 أ، القاعدة 23: كان «يكتب linkState وحده»؛ صار linkState وlinkModelCheck = null صريحاً: الملاحظة مستخلَصة من ربط لم يعد قائماً)
  deq([l1.outcome, l1.reasonCode, l1.markerFields], [O.WRITE, null, {linkState: 'unlinked_by_admin', linkModelCheck: null}], '[٣] unlink على ربط active ⟵ يكتب linkState ويُبطل linkModelCheck صراحةً (لا linkedScanId ولا linkMethod: «تصحيح المشرف لا يغيّر linkMethod»)');
  deq([l1.before, l1.after], [{exclusion: null, linkState: 'active', linkedScanId: 'before-1', linkModelCheck: null}, {exclusion: null, linkState: 'unlinked_by_admin', linkedScanId: 'before-1', linkModelCheck: null}], '[٣] قبل وبعد: الربط يبقى مسجَّلاً (linkedScanId) والحالة تتغيّر، وlinkModelCheck في السطرين (null حين لا قيمة مخزَّنة)');
  {
    const withNote = dec({action: 'unlink', scanId: 's'}, {...live, linkModelCheck: 'LINK_MODEL_MISMATCH'});
    deq([withNote.before.linkModelCheck, withNote.after.linkModelCheck, withNote.markerFields.linkModelCheck], ['LINK_MODEL_MISMATCH', null, null], '[٣] unlink على «بعد» مخزَّن فيها LINK_MODEL_MISMATCH: السطر يحفظ القديمة في before ويُبطلها في after وفي العلامة (القاعدتان 20 و33)');
    for (const garbage of ['x', 5, {}, ['LINK_MODEL_MATCH'], '']) {
      const g = dec({action: 'unlink', scanId: 's'}, {...live, linkModelCheck: garbage});
      deq([g.outcome, g.before.linkModelCheck, g.after.linkModelCheck], [O.WRITE, null, null], `[٣] unlink مع قيمة مخزَّنة غير معروفة ${JSON.stringify(garbage)}: يُبطلها ولا يرفض، وbefore يسجّل null (لا قيمة خارج المفردات في السطر)`);
    }
    const ignoresParam = dec({action: 'unlink', scanId: 's'}, live, {linkModelCheck: 'LINK_MODEL_MISMATCH'});
    deq(ignoresParam.markerFields, {linkState: 'unlinked_by_admin', linkModelCheck: null}, '[٣] unlink يتجاهل أيّ linkModelCheck مُمرَّر (يُبطل دائماً)');
  }
  eq(dec({action: 'unlink', scanId: 's'}, {...live, linkState: 'relinked_by_admin'}).outcome, O.WRITE, '[٣] وعلى relinked_by_admin ⟵ WRITE');
  for (const state of ['none', 'missing', 'unlinked_by_admin']) {
    const r = dec({action: 'unlink', scanId: 's'}, {...live, linkState: state});
    deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_LINKED, ` linkState=${state} linked=PRESENT`], `[٣] unlink على ${state} ⟵ NOT_LINKED (الحالات الحيّة active وrelinked_by_admin وحدها)`);
  }
  const nl = dec({action: 'unlink', scanId: 's'}, {...live, linkedScanId: null});
  deq([nl.refusal, nl.extra], [R.NOT_LINKED, ' linkState=active linked=ABSENT'], '[٣] active بلا linkedScanId ⟵ NOT_LINKED (لا ربط بلا هدف)');
  for (const [label, ls, extraWant] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'NULL'], ['نصّ مجهول', 'linked', 'UNRECOGNIZED'], ['رقم', 5, 'NOT_A_STRING']]) {
    const r = dec({action: 'unlink', scanId: 's'}, {...live, linkState: ls});
    deq([r.refusal, r.extra], [R.LINK_STATE_UNKNOWN, ` linkState=${extraWant}`], `[٣] linkState ${label} ⟵ LINK_STATE_UNKNOWN (القاعدة 22: لا تُخمَّن)`);
  }
  eq(Object.values(V.LINK_STATE).length, 5, '[٣] حالات الربط الخمس من التصميم، الحيّتان منها فقط تقبلان unlink');
  deq([...P.LIVE_LINK_STATES], ['active', 'relinked_by_admin'], '[٣] الحيّتان');
}
// relink
{
  const base = PROTO({linkedScanId: null, linkState: 'none'});
  const r1 = dec({action: 'relink', scanId: 's', toScanId: 'before-9'}, base, {linkModelCheck: MC, toProtocolExists: true});
  // (ق36 أ، القاعدة 23: كان «يكتب linkedScanId وlinkState»؛ صار معهما linkModelCheck المُحتسَب للهدف الجديد)
  deq([r1.outcome, r1.markerFields, r1.reasonCode], [O.WRITE, {linkedScanId: 'before-9', linkState: 'relinked_by_admin', linkModelCheck: MC}, null], '[٣] relink إلى هدف موجود ⟵ يكتب linkedScanId وlinkState (لا linkMethod) ومعهما linkModelCheck المُحتسَب');
  deq(r1.after, {exclusion: null, linkState: 'relinked_by_admin', linkedScanId: 'before-9', linkModelCheck: MC}, '[٣] بعد: الربط الجديد وملاحظة طرازه');
  deq(r1.before, {exclusion: null, linkState: 'none', linkedScanId: null, linkModelCheck: null}, '[٣] قبل: بلا ربط وlinkModelCheck null');
  for (const state of ['LINK_MODEL_MATCH', 'LINK_MODEL_MISMATCH', 'LINK_MODEL_ABSENT']) {
    const r = dec({action: 'relink', scanId: 's', toScanId: 'b9'}, base, {toProtocolExists: true, linkModelCheck: state});
    deq([r.markerFields.linkModelCheck, r.after.linkModelCheck], [state, state], `[٣] relink بحالة ${state} ⟵ تُكتب كما حُسبت في العلامة وفي after`);
  }
  for (const bad of [undefined, null, '', 'MATCH', 'LINK_MODEL_XYZ', 5, {}]) {
    let thrown = null;
    try { dec({action: 'relink', scanId: 's', toScanId: 'b9'}, base, {toProtocolExists: true, linkModelCheck: bad}); } catch (e) { thrown = e; }
    ok(thrown !== null && /linkModelCheck/.test(thrown.message), `[٣] relink بلا حالة صالحة (${JSON.stringify(bad)}) ⟵ خطأ برمجي صريح لا قيمة افتراضية (القاعدة 22)`);
  }
  {
    // الرفض والNOOP لا يحتاجان الحالة (لا كتابة)
    deq([dec({action: 'relink', scanId: 's', toScanId: 's'}, base, {toProtocolExists: true}).refusal], [R.RELINK_SELF], '[٣] RELINK_SELF بلا linkModelCheck ⟵ رفض لا خطأ برمجي');
    eq(dec({action: 'relink', scanId: 's', toScanId: 'b1'}, {...base, linkState: 'relinked_by_admin', linkedScanId: 'b1'}, {toProtocolExists: true}).outcome, O.NOOP, '[٣] NOOP بلا linkModelCheck ⟵ لا كتابة ولا خطأ');
    const stored = dec({action: 'relink', scanId: 's', toScanId: 'b2'}, {...base, linkState: 'active', linkedScanId: 'b1', linkModelCheck: 'LINK_MODEL_MISMATCH'}, {toProtocolExists: true, linkModelCheck: 'LINK_MODEL_MATCH'});
    deq([stored.before.linkModelCheck, stored.after.linkModelCheck], ['LINK_MODEL_MISMATCH', 'LINK_MODEL_MATCH'], '[٣] relink فوق ربط مخزَّن فيه MISMATCH: السطر يحفظ القديمة ويكتب المُحتسَبة الجديدة (لا تبقى قديمة)');
  }
  // exclude/unexclude لا يمسّان الحقل ولا يضيفانه إلى سطرهما (before/after بشكلهما القديم)
  for (const d of [dec(EXC(), {...PROTO(), linkModelCheck: 'LINK_MODEL_MISMATCH'}), dec({action: 'unexclude', scanId: 's'}, {...PROTO(), exclusion: MARK(), linkModelCheck: 'LINK_MODEL_MISMATCH'})]) {
    ok(d.outcome === O.WRITE && !('linkModelCheck' in d.before) && !('linkModelCheck' in d.after) && !('linkModelCheck' in (d.markerFields || {})), `[٣] ${d.after.exclusion && d.after.exclusion.state} لا يمسّ linkModelCheck ولا يضيفه إلى before/after/العلامة`);
  }
  for (const ls of ['none', 'active', 'missing', 'unlinked_by_admin', 'relinked_by_admin']) {
    const r = dec({action: 'relink', scanId: 's', toScanId: 'b2'}, {...base, linkState: ls, linkedScanId: ls === 'none' ? null : 'b1'}, {linkModelCheck: MC, toProtocolExists: true});
    eq(r.outcome, O.WRITE, `[٣] relink من حالة ${ls} ⟵ WRITE (الحالات الخمس كلّها تقبل ربطاً يدوياً)`);
  }
  const same = dec({action: 'relink', scanId: 's', toScanId: 'b1'}, {...base, linkState: 'relinked_by_admin', linkedScanId: 'b1'}, {linkModelCheck: MC, toProtocolExists: true});
  eq(same.outcome, O.NOOP, '[٣] relink إلى الهدف نفسه بالحالة نفسها ⟵ NOOP');
  const sameActive = dec({action: 'relink', scanId: 's', toScanId: 'b1'}, {...base, linkState: 'active', linkedScanId: 'b1'}, {linkModelCheck: MC, toProtocolExists: true});
  eq(sameActive.outcome, O.WRITE, '[٣] وإلى هدف الربط الآلي نفسه ⟵ WRITE (يتحوّل «بتأكيد المشرف»)');
  deq([dec({action: 'relink', scanId: 's', toScanId: 's'}, base, {linkModelCheck: MC, toProtocolExists: true}).refusal], [R.RELINK_SELF], '[٣] relink إلى الفحص نفسه ⟵ RELINK_SELF');
  deq([dec({action: 'relink', scanId: 's', toScanId: 'ghost'}, base, {linkModelCheck: MC, toProtocolExists: false}).refusal], [R.RELINK_TARGET_NOT_FOUND], '[٣] هدف بلا scanProtocol ⟵ RELINK_TARGET_NOT_FOUND');
  deq([dec({action: 'relink', scanId: 's', toScanId: 'x'}, base, {linkModelCheck: MC, toProtocolExists: null}).refusal], [R.RELINK_TARGET_NOT_FOUND], '[٣] وحالة الهدف غير مقروءة (null) ⟵ تُرفض (لا يُقرأ الغياب وجوداً)');
  deq([dec({action: 'relink', scanId: 's', toScanId: 'x'}, {...base, linkState: 'weird'}, {linkModelCheck: MC, toProtocolExists: true}).refusal], [R.LINK_STATE_UNKNOWN], '[٣] حالة ربط مجهولة ⟵ LINK_STATE_UNKNOWN');
  eq(dec({action: 'relink', scanId: 's', toScanId: 'x'}, base, {linkModelCheck: MC, toProtocolExists: true, correctionLines: [LINE(4, EX('test'), {basis: 'SCAN_PROTOCOL'})]}).seq, 5, '[٣] seq يتتابع عبر الأفعال (سطر الاستبعاد السابق يُعدّ)');
}
// أسبقية الرفض
deq([dec(EXC(), null, {reportExists: false, correctionLines: [LINE(1, EX('x'))]}).refusal], [R.SCAN_NOT_FOUND], '[٣] عدم وجود الفحص قبل قراءة السطور');

// ═══ ٤ — سطر الملحَق ═══
{
  const d = dec(EXC('s', 'golden_reference'), PROTO());
  const line = P.buildCorrectionLine({scanId: 's', decision: d, action: 'exclude', at: 'SERVER-TS', by: '#hash'});
  deq(Object.keys(line), ['scanId', 'action', 'reasonCode', 'basis', 'before', 'after', 'seq', 'at', 'by'], '[٤] السطر بتسعة حقول بالترتيب');
  deq(line, {scanId: 's', action: 'exclude', reasonCode: 'golden_reference', basis: 'SCAN_PROTOCOL', before: d.before, after: d.after, seq: 1, at: 'SERVER-TS', by: '#hash'}, '[٤] قيم السطر: القيم قبل وبعد، ورمز السبب، والمشرف مُهشَّراً، ووقت الخادم الممرَّر');
  deq(Object.values(P.CORRECTION_LINE_FIELD), Object.keys(line), '[٤] CORRECTION_LINE_FIELD يساوي مفاتيح السطر (مصدر واحد)');
}

// ═══ ٥ — ردود الرفض وحرّاس البنية ═══
ok(Object.isFrozen(A.REFUSAL_RESPONSE) && Object.isFrozen(R) && Object.isFrozen(P.CORRECTION_LINE_FIELD) && Object.isFrozen(P.SCAN_PROTOCOL_FIELD), '[٥] REFUSAL_RESPONSE وCORRECTION_REFUSAL وحقول الوحدة مجمَّدة');
deq(Object.keys(A.REFUSAL_RESPONSE).sort(), Object.values(R).sort(), '[٥] لكلّ رمز في CORRECTION_REFUSAL ردّ، ولا ردّ بلا رمز');
const KNOWN_CODES = ['invalid-argument', 'failed-precondition', 'not-found'];
for (const [reason, spec] of Object.entries(A.REFUSAL_RESPONSE)) {
  ok(KNOWN_CODES.includes(spec.code), `[٥] ${reason}: رمز HttpsError معروف (${spec.code})`);
  eq(spec.message, reason, `[٥] ${reason}: الرسالة هي الرمز نفسه (لا نصّ عربي جديد: القرار ٩٠)`);
  eq(spec.clientReasonCode, reason, `[٥] ${reason}: رمز العميل هو الرمز`);
  ok(Object.isFrozen(spec), `[٥] ${reason}: الردّ مجمَّد`);
}
for (const r of [R.SCAN_NOT_FOUND, R.SHORT_ID_NOT_FOUND, R.RELINK_TARGET_NOT_FOUND]) eq(A.REFUSAL_RESPONSE[r].code, 'not-found', `[٥] ${r}: not-found`);
for (const r of [R.ACTION_NOT_SPECIFIED, R.SHORT_ID_AMBIGUOUS, R.NO_PROTOCOL_RECORD, R.NOT_LINKED, R.LINK_STATE_UNKNOWN, R.EXCLUSION_UNREADABLE]) eq(A.REFUSAL_RESPONSE[r].code, 'failed-precondition', `[٥] ${r}: failed-precondition`);
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { A.refuse(R.REASON_INVALID, {uid: 'uid-admin-1', scanId: 'scan-secret-1', field: 'reason'}); } catch (e) { thrown = e; }
    deq([thrown.code, thrown.message, thrown.details], ['invalid-argument', 'CORRECTION_REASON_INVALID', {reasonCode: 'CORRECTION_REASON_INVALID', field: 'reason'}], '[٥] refuse: الرمز والرسالة والتفصيل (ومعه field)');
    eq(warns[0], `[correctProtocolRecord] refused reason=CORRECTION_REASON_INVALID caller=${hashIdForLog('uid-admin-1')} scan=${hashIdForLog('scan-secret-1')} field=reason`, '[٥] والسجلّ بمعرّفين مُهشَّرين واسم الحقل');
    ok(!warns[0].includes('uid-admin-1') && !warns[0].includes('scan-secret-1'), '[٥] لا معرّف خامّ');
    warns.length = 0;
    try { A.refuse(R.NOT_LINKED, {uid: 'u', scanId: 's', extra: ' linkState=none linked=ABSENT'}); } catch (e) { thrown = e; }
    ok(/ linkState=none linked=ABSENT$/.test(warns[0]) && thrown.details.field === undefined, '[٥] extra يُلحَق بالسطر، وlا field في التفصيل حين لا ينطبق');
    let bad = null;
    warns.length = 0;
    try { A.refuse('NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message) && warns.length === 0, '[٥] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
const source = strip(read('src', 'admin', 'protocolCorrectionAdmin.js'));
{
  const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
  eq(throwSites.length, 1, '[٥] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
  const refuseDef = source.indexOf('function refuse(');
  const refuseEnd = source.indexOf('\n}\n', refuseDef);
  ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٥] وهو داخل refuse');
  const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
  deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٥] ثلاثة throw: رمي refuse، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما هو');
  for (const name of Object.keys(R)) {
    const used = new RegExp(`\\bR\\.${name}\\b`).test(source) || new RegExp(`\\bR\\.${name}\\b`).test(strip(read('src', 'protocol', 'protocolCorrection.js')));
    ok(used, `[٥] الرمز ${name} مستعمَل`);
  }
  ok(!/refuse\(\s*["'`]/.test(source), '[٥] ولا نداء refuse بسبب نصّ حرفي');
  ok(/requireAdmin\(request\);/.test(source), '[٥] المشرف بـrequireAdmin');
  ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(|tx\.delete\(/.test(source), '[٥] **لا حذف في protocolCorrectionAdmin.js** (القاعدة 42): لا delete ولا FieldValue.delete ولا batch');
  ok(!/\.limit\(|\.orderBy\(|\.startAt\(|\.endAt\(|\.where\([^)]*["'`](<|<=|>|>=|!=|in|array-contains[a-z-]*|not-in)["'`]/.test(source), '[٥] لا limit ولا orderBy ولا مدى: مساواة وحدها (القاعدة 43)');
  const wheres = [...source.matchAll(/\.where\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' '));
  deq(wheres, ['"shortId", "==", input.shortId', 'CORRECTION_LINE_FIELD.SCAN_ID, "==", scanId'], '[٥] استعلامان لا غير، كلاهما مساواة على حقل واحد: رمز التقرير، وscanId في السطور');
  const txStart = source.indexOf('db.runTransaction(');
  const txEnd = source.indexOf('} catch (e) {', txStart);
  ok(txStart > 0 && txEnd > txStart, '[٥] المعاملة موجودة');
  const txBody = source.slice(txStart, txEnd);
  ok(!/throw\s/.test(txBody), '[٥] لا throw داخل دالّة المعاملة — تُرجِع قراراً');
  const gets = [...txBody.matchAll(/tx\.get\(/g)];
  const writes = [...txBody.matchAll(/tx\.(update|set|create)\(/g)];
  // (2026-10-22، القاعدة 23: كان يثبّت أربع قراءات وكتابتين؛ استُبدل بخمس وثلاث: أُضيفت قراءة الهدف الحاضر لـunlink/relink وكتابة pair على «قبل» بأمر اتّساق التصحيح مع pair — A11 إلحاق 2026-10-22)
  // (ق36 أ، 2026-10-22، القاعدة 23: كانت خمس قراءات؛ صارت ستّاً: أُضيفت قراءة تقرير هدف relink — طرازه — وقراءة تقرير الفحص نفسه تُشارك موضع قراءة التقرير القائم)
  eq(gets.length, 6, '[٥] ست قراءات: scanProtocol · التقرير (وجوداً لفحص بلا scanProtocol وطرازاً لـrelink) · السطور · هدف relink · تقرير هدف relink (طراز، ق36 أ) · الهدف الحاضر لربط «بعد» (اتّساق pair)');
  ok(/MP\.decideLinkModelCheck\(\{/.test(txBody) && /linkModelCheck,\n?\s*\}\);|toProtocolExists, linkModelCheck,/.test(txBody), '[٥] (ق36 أ) ملاحظة الطراز تُحسب بـMP.decideLinkModelCheck (مصدر واحد مع الاكتمال) وتُمرَّر إلى decideCorrection');
  ok(!/LINK_MODEL_(MATCH|MISMATCH|ABSENT)|["'`]linkModelCheck["'`]/.test(txBody), '[٥] (ق36 أ) ولا حرفية حالة ولا اسم حقل في الدالّة (المصدر: المفردات وSCAN_PROTOCOL_FIELD)');
  eq(writes.length, 3, '[٥] ثلاث كتابات لا غير: السطر الملحَق، وعلامة scanProtocol، وتحديث pair على «قبل» (حلقة واحدة بـtx.update منقَّط)');
  ok(/for \(const u of sync\.updates\) tx\.update\(db\.collection\(PROTOCOL_COLLECTION\.SCAN_PROTOCOL\)\.doc\(u\.scanId\), u\.fields\)/.test(txBody), '[٥] وتحديث pair بـtx.update منقَّط على «قبل» وحدها (لا set ولا حذف)');
  ok(Math.max(...gets.map((m) => m.index)) < Math.min(...writes.map((m) => m.index)), '[٥] القراءات كلّها قبل أول كتابة (شرط معاملات Firestore)');
  ok(/tx\.create\(lineRef, buildCorrectionLine\(/.test(txBody), '[٥] السطر يُلحَق بـtx.create (لا set: «بالإلحاق وحده»، لا يُكتب فوق سطر)');
  ok(/tx\.update\(protocolRef, fields\)/.test(txBody) && !/tx\.set\(protocolRef/.test(txBody), '[٥] والعلامة بـtx.update على الحقول المعنيّة وحدها (لا set يستبدل المستند)');
  ok(/lineRef = db\.collection\(PROTOCOL_COLLECTION\.PROTOCOL_CORRECTIONS\)\.doc\(\)/.test(source), '[٥] معرّف السطر يُولَّد قبل المعاملة (ثابت عبر إعادة المحاولة) ومجموعته من protocolVocabulary');
  ok(/at: FieldValue\.serverTimestamp\(\)/.test(txBody), '[٥] وقت السطر والعلامة وقت الخادم');
  ok(/hashIdForLog\(uid\)/.test(source) && /by: actor/.test(txBody), '[٥] المشرف مُهشَّراً في السطر');
  ok(!/\.update\(protocolRef, \{[^}]*scanPurpose/.test(txBody), '[٥] ولا تُمسّ حقول scanProtocol الأخرى');
}
{
  // أسماء الحقول مصدر واحد (القاعدة 24)
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) files.push(p);
    }
  })(path.join(__dirname, '..', 'src'));
  const ownersOfLink = files.filter((f) => /\b(linkState|linkedScanId)\b/.test(strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')))).map((f) => path.basename(f)).sort();
  deq(ownersOfLink, ['protocolCorrection.js', 'protocolCorrectionAdmin.js'], '[٥] linkState وlinkedScanId لا يظهران في src إلا في protocolCorrection.js (SCAN_PROTOCOL_FIELD: كاتب scanProtocol يستوردهما) وفي مفتاحَي ردّ الدالّة ومفتاحَي قرارها في protocolCorrectionAdmin.js (أدناه)');
  ok((source.match(/\blinkState\b/g) || []).length === 2 && (source.match(/\blinkedScanId\b/g) || []).length === 2 && /linkState: decided\.after\.linkState, linkedScanId: decided\.after\.linkedScanId/.test(source), '[٥] وهما في الدالّة مفتاحا الردّ وحدهما (linkState: decided.after.linkState …): لا كتابة لحقل scanProtocol بحرفيّته');
  const quotedExclusion = files.filter((f) => /["'`]exclusion["'`]/.test(strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')))).map((f) => path.basename(f)).sort();
  deq(quotedExclusion, ['protocolCorrection.js'], '[٥] "exclusion" حرفاً مفتاحَ علامة في موضع واحد');
  const doc = strip(read('src', 'protocol', 'scanProtocolDocument.js'));
  ok(/\[SCAN_PROTOCOL_FIELD\.LINKED_SCAN_ID\]: null/.test(doc) && /\[SCAN_PROTOCOL_FIELD\.LINK_STATE\]: LINK_STATE\.NONE/.test(doc), '[٥] scanProtocolDocument.js يكتب الحقلين بالمصدر الواحد');
  // (2026-10-22، القاعدة 23: كان يثبّت ثلاثة أسماء؛ استُبدل بسبعة: أُضيفت LINK_METHOD وDEFECT_TYPE وPAIR وSCAN_PURPOSE (S4) بأمر ربط «قبل/بعد صيانة» — حقول scanProtocol التي يكتبها أكثر من موضع، ومصدرها الواحد هنا: القاعدة 24)
  // (ق36 أ، القاعدة 23: كانت سبعة أسماء؛ صارت ثمانية بـLINK_MODEL_CHECK)
  deq(P.SCAN_PROTOCOL_FIELD, {LINKED_SCAN_ID: 'linkedScanId', LINK_STATE: 'linkState', EXCLUSION: 'exclusion', LINK_METHOD: 'linkMethod', DEFECT_TYPE: 'defectType', PAIR: 'pair', SCAN_PURPOSE: 'scanPurpose', LINK_MODEL_CHECK: 'linkModelCheck'}, '[٥] أسماء الحقول كما سمّاها التصميم (P:489 · P:862) ومعها الأربعة المشتركة من أمر الصيانة (LINK_METHOD · DEFECT_TYPE · PAIR · SCAN_PURPOSE) ثم LINK_MODEL_CHECK (ق36 أ)');
  const pcSrc = strip(read('src', 'protocol', 'protocolCorrection.js'));
  ok(!/require\(["']firebase-admin["']\)|utils\/admin|\bdb\b\./.test(pcSrc), '[٥] protocolCorrection.js نقيّ: لا Firestore ولا admin (القاعدة 41)');
  ok(!/Date\.now|new Date\(|Math\.random/.test(pcSrc), '[٥] ولا وقت ولا عشوائية داخله: الأوقات تُمرَّر');
}

console.log(`\nprotocolCorrection.test.js: ${n}/${n} assertions passed`);
