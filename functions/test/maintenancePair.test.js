'use strict';

// maintenancePair.test.js — ربط «قبل الصيانة» بـ«بعد الصيانة»: نوع العطل، وحقول الزوج، وقرارات الدالّتين (أمر المستخدم 2026-10-22؛ S2 إلى S6). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في maintenancePair.e2e.test.js.
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A2 وA3 وA11 (إلحاقات 2026-10-22) ومصدرها WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md (منقول، غير متحقَّق). الدوالّ نقيّة (القاعدة 41).
// **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن protocolVocabulary.js وmaintenancePair.js: لو انجرف الثابت عن العقد فهذا الاختبار يُفشل لا يتبعه).
//   ١ (S2) نوع العطل مع الغرض: جدول كامل (الغرض × القيمة المُرسَلة) — REQUIRED وINVALID وNOT_APPLICABLE وما يُقبل؛ غائب ≠ null؛ القائمة مغلقة وبحالة الأحرف نفسها
//   ٢ (S2) pendingFieldsForPurposeChoice: نوع العطل أو null صريح، ومسح اختيار الربط، لا حذف؛ وشكل الأسماء
//   ٣ بنية الوحدة: لا I/O ولا حذف ولا نصّ حرفي لأسماء المجموعات
//
// Run: node functions/test/maintenancePair.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const M = require('../src/protocol/maintenancePair');

// ═══ ١ — validateDefectTypeForPurpose ═══
const TYPES = ['BATTERY', 'CHARGING_PORT', 'THERMAL', 'MOTHERBOARD', 'SOFTWARE'];
const v = (purpose, ...rest) => M.validateDefectTypeForPurpose(rest.length === 0 ? {purpose} : {purpose, defectType: rest[0]});
for (const purpose of ['maintenance_before', 'maintenance_after']) {
  for (const t of TYPES) deq(v(purpose, t), {ok: true, defectType: t}, `[١] ${purpose} + ${t}: يُقبل والنوع يعود كما هو`);
  deq(v(purpose), {ok: false, refusal: 'DEFECT_TYPE_REQUIRED', extra: ` purpose=${purpose}`}, `[١] ${purpose} بلا نوع (المفتاح غائب) ⟵ DEFECT_TYPE_REQUIRED`);
  deq(v(purpose, undefined), {ok: false, refusal: 'DEFECT_TYPE_REQUIRED', extra: ` purpose=${purpose}`}, `[١] ${purpose} والنوع undefined ⟵ DEFECT_TYPE_REQUIRED (الغياب)`);
  for (const [label, bad, kind] of [
    ['«OTHER»', 'OTHER', 'string'], ['«other»', 'other', 'string'], ['نصّ فارغ', '', 'string'], ['مسافات', '   ', 'string'], ['أحرف صغيرة', 'battery', 'string'], ['Battery', 'Battery', 'string'],
    ['«BATTERY » بمسافة', 'BATTERY ', 'string'], [' «BATTERY»', ' BATTERY', 'string'], ['«CHARGING-PORT»', 'CHARGING-PORT', 'string'], ['«SCREEN»', 'SCREEN', 'string'], ['«DISPLAY»', 'DISPLAY', 'string'],
    ['«MIXED»', 'MIXED', 'string'], ['«NONE»', 'NONE', 'string'], ['رقم', 5, 'number'], ['صفر', 0, 'number'], ['NaN', NaN, 'number'], ['null', null, 'null'], ['كائن', {a: 1}, 'object'],
    ['كائن فارغ', {}, 'object'], ['مصفوفة', ['BATTERY'], 'array'], ['مصفوفة فارغة', [], 'array'], ['منطقي true', true, 'boolean'], ['منطقي false', false, 'boolean'],
  ]) {
    deq(v(purpose, bad), {ok: false, refusal: 'DEFECT_TYPE_INVALID', extra: ` purpose=${purpose} given=${kind}`}, `[١] ${purpose} + ${label} ⟵ DEFECT_TYPE_INVALID (القائمة مغلقة، وبحالة الأحرف نفسها)`);
  }
}
// normal: ممنوع
deq(v('normal'), {ok: true, defectType: null}, '[١] normal بلا نوع ⟵ يُقبل والنوع null صريح (لغير الصيانة)');
deq(v('normal', undefined), {ok: true, defectType: null}, '[١] normal والنوع undefined ⟵ يُقبل (غائب)');
for (const [label, given, kind] of [['«BATTERY»', 'BATTERY', 'string'], ['null', null, 'null'], ['نصّ فارغ', '', 'string'], ['«OTHER»', 'OTHER', 'string'], ['رقم', 1, 'number'], ['كائن', {}, 'object']]) {
  deq(v('normal', given), {ok: false, refusal: 'DEFECT_TYPE_NOT_APPLICABLE', extra: ` purpose=normal given=${kind}`}, `[١] normal + نوع ${label} مُرسَل ⟵ DEFECT_TYPE_NOT_APPLICABLE (المفتاح الموجود يُعدّ مُرسَلاً ولو null)`);
}
// الغرض خارج الصيانة وغير normal (لا يصل هنا في الإنتاج: يُرفض قبلها): يُعامَل كغير صيانة — لا يقبل نوعاً
for (const other of ['battery_before', 'repeat_cold', 'zzz', undefined, null, 5]) {
  deq(v(other, 'BATTERY').refusal, 'DEFECT_TYPE_NOT_APPLICABLE', `[١] غرض ${String(other)} غير صيانة ومعه نوع ⟵ NOT_APPLICABLE (لا يُمرَّر نوع لغير maintenance_*)`);
}
// القائمة والتصدير
deq(M.MAINTENANCE_PURPOSES, ['maintenance_before', 'maintenance_after'], '[١] غرضا الصيانة');
ok(Object.isFrozen(M.MAINTENANCE_PURPOSES) && Object.isFrozen(M.PENDING_FIELD), '[١] MAINTENANCE_PURPOSES وPENDING_FIELD مجمَّدان');
for (const p of ['maintenance_before', 'maintenance_after']) ok(M.isMaintenancePurpose(p), `[١] isMaintenancePurpose(${p})`);
for (const p of ['normal', 'battery_before', 'battery_after', 'repeat_cold', 'MAINTENANCE_BEFORE', 'Maintenance_before', '', undefined, null, 5, {}]) ok(!M.isMaintenancePurpose(p), `[١] isMaintenancePurpose(${JSON.stringify(p)}) = false`);
for (const t of TYPES) ok(M.isDefectType(t), `[١] isDefectType(${t})`);
for (const t of ['battery', 'OTHER', '', undefined, null, 5, ['BATTERY']]) ok(!M.isDefectType(t), `[١] isDefectType(${JSON.stringify(t)}) = false`);
deq([M.kindOf(null), M.kindOf([]), M.kindOf({}), M.kindOf('x'), M.kindOf(1), M.kindOf(true), M.kindOf(undefined)], ['null', 'array', 'object', 'string', 'number', 'boolean', 'undefined'], '[١] kindOf: نوع القيمة لسطر السجلّ');
{
  const input = {purpose: 'maintenance_before', defectType: 'BATTERY'};
  M.validateDefectTypeForPurpose(input);
  deq(input, {purpose: 'maintenance_before', defectType: 'BATTERY'}, '[١] لا تعدّل مدخلاتها');
}

// ═══ ٢ — pendingFieldsForPurposeChoice ═══
deq(M.pendingFieldsForPurposeChoice({defectType: 'THERMAL'}), {defectType: 'THERMAL', linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null}, '[٢] نوع العطل ومسح اختيار الربط (كلّها null صريحة)');
deq(M.pendingFieldsForPurposeChoice({defectType: null}), {defectType: null, linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null}, '[٢] normal: النوع null صريح (لا حذف حقل: القاعدة 42) ومسح الربط');
deq(Object.keys(M.pendingFieldsForPurposeChoice({defectType: 'SOFTWARE'})).sort(), ['defectType', 'linkConfirmedAt', 'linkConfirmedByTechnicianId', 'linkMethod', 'linkedScanId'], '[٢] خمسة حقول بالضبط');
for (const bad of [undefined, 'OTHER', 'battery', 5, {}]) {
  assert.throws(() => M.pendingFieldsForPurposeChoice({defectType: bad}), /defectType ليس من DEFECT_TYPE ولا null/);
  n++;
}
ok(Object.values(M.pendingFieldsForPurposeChoice({defectType: 'BATTERY'})).filter((x) => x === undefined).length === 0, '[٢] لا قيمة undefined (Firestore يرفضها)');
deq(M.PENDING_FIELD, {DEFECT_TYPE: 'defectType', LINKED_SCAN_ID: 'linkedScanId', LINK_METHOD: 'linkMethod', LINK_CONFIRMED_AT: 'linkConfirmedAt', LINK_CONFIRMED_BY_TECHNICIAN_ID: 'linkConfirmedByTechnicianId'}, '[٢] أسماء حقول protocolPending (E7: linkConfirmedAt وlinkConfirmedByTechnicianId)');

// ═══ ٢-ب — (S3) readDefectType وbuildPairField ═══
{
  const pend = (defectType) => ({purposeSource: 'selected', ...(defectType === undefined ? {} : {defectType})});
  for (const purpose of ['maintenance_before', 'maintenance_after']) {
    for (const t of TYPES) deq(M.readDefectType({scanPurpose: purpose, pendingData: pend(t)}), {value: t, note: null}, `[٢-ب] ${purpose} + ${t}: القيمة بلا ملاحظة`);
    for (const [label, pd] of [['pendingData null', null], ['pendingData undefined', undefined], ['بلا حقل', pend()], ['null', pend(null)], ['pending نصّ', 'x']]) {
      deq(M.readDefectType({scanPurpose: purpose, pendingData: pd}), {value: null, note: 'DEFECT_TYPE_ABSENT'}, `[٢-ب] ${purpose} و${label}: null وDEFECT_TYPE_ABSENT (لا نوع مختلَق)`);
    }
    for (const [label, bad] of [['OTHER', 'OTHER'], ['أحرف صغيرة', 'battery'], ['فارغ', ''], ['رقم', 4], ['كائن', {}], ['مصفوفة', ['BATTERY']], ['منطقي', true]]) {
      deq(M.readDefectType({scanPurpose: purpose, pendingData: pend(bad)}), {value: null, note: 'DEFECT_TYPE_NOT_RECOGNIZED'}, `[٢-ب] ${purpose} ونوع ${label}: null وDEFECT_TYPE_NOT_RECOGNIZED`);
    }
  }
  // غير الصيانة: null بلا ملاحظة مهما حمل pending (النوع يتبع الغرض الحاضر)
  for (const purpose of ['normal', 'battery_before', 'battery_after', 'repeat_cold', 'NO_SESSION', 'UNDECLARED', undefined, null, 'zzz']) {
    deq(M.readDefectType({scanPurpose: purpose, pendingData: pend('BATTERY')}), {value: null, note: null}, `[٢-ب] غرض ${String(purpose)}: null بلا ملاحظة ولو حمل pending نوعاً`);
  }
  deq(M.PAIR_NOTE, {DEFECT_TYPE_ABSENT: 'DEFECT_TYPE_ABSENT', DEFECT_TYPE_NOT_RECOGNIZED: 'DEFECT_TYPE_NOT_RECOGNIZED', PAIR_OWNER_ABSENT: 'PAIR_OWNER_ABSENT', PAIR_LINK_NOT_CHOSEN: 'PAIR_LINK_NOT_CHOSEN', PAIR_LINK_NOT_RECOGNIZED: 'PAIR_LINK_NOT_RECOGNIZED', LINK_TARGET_LOST: 'LINK_TARGET_LOST'}, '[٢-ب] PAIR_NOTE: ست ملاحظات (اثنتان في S3 وثلاث في S5 وPAIR_OWNER_ABSENT في S8: القاعدة 23)');
  ok(Object.isFrozen(M.PAIR_NOTE) && Object.isFrozen(M.PAIR_KEY), '[٢-ب] PAIR_NOTE وPAIR_KEY مجمَّدان');
  deq(M.PAIR_KEY, {STATE: 'state', OPENED_AT: 'openedAt', OWNER_ID: 'ownerId', COMPLETED_BY_SCAN_ID: 'completedByScanId'}, '[٢-ب] مفاتيح pair (A3 البند ١)');
  // buildPairField
  const STAMP = {__stamp: 'openedAt-test-marker'};
  deq(M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: 'owner-1'}), {state: 'OPEN', openedAt: STAMP, ownerId: 'owner-1'}, '[٢-ب] maintenance_before ⟵ {state: OPEN, openedAt, ownerId} (الوسم المُمرَّر نفسه؛ S8: ownerId)');
  eq(M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: 'owner-1'}).openedAt, STAMP, '[٢-ب] openedAt هو المُمرَّر لا وقت مختلَق');
  deq(Object.keys(M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: 'owner-1'})), ['state', 'openedAt', 'ownerId'], '[٢-ب] ثلاثة مفاتيح لا غير (S8: كانت مفتاحين: القاعدة 23)');
  eq(M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: 'shop-7'}).ownerId, 'shop-7', '[٢-ب] (S8) ownerId المُمرَّر يُكتب كما هو');
  deq(M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: null}), {state: 'OPEN', openedAt: STAMP, ownerId: null}, '[٢-ب] (S8) ownerId = null صريح (المالك مجهول) يُكتب null: لا يُخمَّن ولا يُحذف');
  for (const bad of ['', 5, {}, ['x'], true]) assert.throws(() => M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: bad}), /ownerId/);
  n += 5;
  assert.throws(() => M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP, ownerId: undefined}), /ownerId غائب/); n++;
  assert.throws(() => M.buildPairField({scanPurpose: 'maintenance_before', openedAt: STAMP}), /ownerId غائب/); n++;
  eq(M.buildPairField({scanPurpose: 'normal', openedAt: STAMP}), null, '[٢-ب] (S8) وغير «قبل»: لا يُشترط ownerId');
  for (const purpose of ['maintenance_after', 'normal', 'battery_before', 'battery_after', 'repeat_cold', 'NO_SESSION', 'UNDECLARED', undefined, null, 'Maintenance_Before', '']) {
    eq(M.buildPairField({scanPurpose: purpose, openedAt: STAMP}), null, `[٢-ب] غرض ${JSON.stringify(purpose)} ⟵ pair null صريح (الزوج يُفتح على maintenance_before وحده)`);
  }
  assert.throws(() => M.buildPairField({scanPurpose: 'maintenance_before', openedAt: undefined}), /openedAt غائب/); n++;
  assert.throws(() => M.buildPairField({scanPurpose: 'maintenance_before'}), /openedAt غائب/); n++;
  eq(M.buildPairField({scanPurpose: 'normal', openedAt: undefined}), null, '[٢-ب] وغير «قبل»: لا يُشترط openedAt');
}

// ═══ ٤ — (S4) المدّة والنافذة وقراءة pair وترشيح «قبل» والاسم والترتيب ═══
const {ts} = require('./lib/pairFakeDb');
const HOUR = 3600 * 1000;
{
  // readValidityHours: لا قيمة افتراضية، والحالات مسمّاة
  const present = (data) => ({state: 'PRESENT', version: 3, data});
  deq(M.readValidityHours({state: 'ABSENT', version: null, data: null}), {state: 'SETTINGS_ABSENT', hours: null}, '[٤] مستند الإعدادات غائب ⟵ SETTINGS_ABSENT (لا 168 ولا 72)');
  for (const bad of [undefined, null, 'x', 5]) deq(M.readValidityHours(bad), {state: 'SETTINGS_ABSENT', hours: null}, `[٤] قراءة إعدادات بشكل ${JSON.stringify(bad)} ⟵ SETTINGS_ABSENT`);
  deq(M.readValidityHours({state: 'PRESENT', version: 1, data: null}), {state: 'SETTINGS_ABSENT', hours: null}, '[٤] PRESENT بلا data ⟵ SETTINGS_ABSENT (لا يُقرأ حاضراً)');
  deq(M.readValidityHours({state: 'ABSENT', version: null, data: {openBeforeValidityHours: 72}}), {state: 'SETTINGS_ABSENT', hours: null}, '[٤] **حالة ABSENT مع data عالقة**: لا تُقرأ منها المدّة (الحالة هي الحكم لا وجود الحقل)');
  deq(M.readValidityHours(present({})), {state: 'ABSENT', hours: null}, '[٤] المستند حاضر والحقل غائب ⟵ ABSENT');
  deq(M.readValidityHours(present({repeatRate: 0.1})), {state: 'ABSENT', hours: null}, '[٤] حقول أخرى لا تسدّ غياب openBeforeValidityHours');
  deq(M.readValidityHours(present({openBeforeValidityHours: null})), {state: 'ABSENT', hours: null}, '[٤] null ⟵ ABSENT');
  for (const bad of [0, -1, 8761, 1.5, 0.5, '72', true, NaN, Infinity, {}, [72]]) {
    deq(M.readValidityHours(present({openBeforeValidityHours: bad})), {state: 'INVALID', hours: null}, `[٤] قيمة ${JSON.stringify(bad)} ⟵ INVALID (عدد صحيح في [1، 8760] وحده)`);
  }
  for (const good of [1, 24, 72, 168, 8760]) deq(M.readValidityHours(present({openBeforeValidityHours: good})), {state: 'SET', hours: good}, `[٤] ${good} ساعة ⟵ SET`);
  deq(M.VALIDITY_STATE, {SET: 'SET', ABSENT: 'ABSENT', INVALID: 'INVALID', SETTINGS_ABSENT: 'SETTINGS_ABSENT'}, '[٤] VALIDITY_STATE');

  // isWithinWindow: الحدّ نفسه داخل
  const NOW = 1_800_000_000_000;
  eq(M.isWithinWindow({openedAtMs: NOW - 72 * HOUR, nowMs: NOW, validityHours: 72}), true, '[٤] **على الحدّ تماماً (72 ساعة بالضبط): داخل النافذة**');
  eq(M.isWithinWindow({openedAtMs: NOW - 72 * HOUR - 1, nowMs: NOW, validityHours: 72}), false, '[٤] وبعد الحدّ بمللي ثانية: خارجها');
  eq(M.isWithinWindow({openedAtMs: NOW - 72 * HOUR + 1, nowMs: NOW, validityHours: 72}), true, '[٤] وقبل الحدّ بمللي ثانية: داخلها');
  eq(M.isWithinWindow({openedAtMs: NOW, nowMs: NOW, validityHours: 72}), true, '[٤] الآن تماماً: داخلها');
  eq(M.isWithinWindow({openedAtMs: NOW + 5000, nowMs: NOW, validityHours: 72}), true, '[٤] وقت في المستقبل القريب (انحراف ساعة): داخلها');
  eq(M.isWithinWindow({openedAtMs: NOW - 2 * HOUR, nowMs: NOW, validityHours: 1}), false, '[٤] ساعتان والمدّة ساعة: خارجها');
  eq(M.isWithinWindow({openedAtMs: NOW - 2 * HOUR, nowMs: NOW, validityHours: 3}), true, '[٤] **تغيير الإعداد يسري على المفتوح**: ساعتان والمدّة 3: داخلها');
  eq(M.isWithinWindow({openedAtMs: NOW - 100 * HOUR, nowMs: NOW, validityHours: 168}), true, '[٤] 100 ساعة والمدّة 168: داخلها');

  // readPair
  const P = (o) => ({pair: o});
  const OPENED = ts(1000);
  deq(M.readPair({}), {kind: 'ABSENT', state: null, openedAtMs: null, completedByScanId: null, ownerId: null}, '[٤] pair غائب ⟵ ABSENT');
  deq(M.readPair(P(null)).kind, 'ABSENT', '[٤] pair null ⟵ ABSENT (ليس «قبل» صيانة)');
  deq(M.readPair(null).kind, 'ABSENT', '[٤] مستند غائب ⟵ ABSENT');
  deq(M.readPair(P({state: 'OPEN', ownerId: 'owner-1', openedAt: OPENED})), {kind: 'PRESENT', state: 'OPEN', openedAtMs: 1000, completedByScanId: null, ownerId: 'owner-1'}, '[٤] OPEN مقروء (S8: ومعه ownerId)');
  deq(M.readPair(P({state: 'COMPLETED', ownerId: 'owner-1', openedAt: OPENED, completedByScanId: 'after-1'})), {kind: 'PRESENT', state: 'COMPLETED', openedAtMs: 1000, completedByScanId: 'after-1', ownerId: 'owner-1'}, '[٤] COMPLETED مع completedByScanId');
  deq(M.readPair(P({state: 'OPEN', ownerId: 'owner-1', openedAt: OPENED, completedByScanId: null})).kind, 'PRESENT', '[٤] OPEN مع completedByScanId null (بعد إعادة الفتح): مقروء');
  for (const [label, bad] of [
    ['حالة EXPIRED مخزَّنة', {state: 'EXPIRED', ownerId: 'owner-1', openedAt: OPENED}], ['حالة SUPERSEDED', {state: 'SUPERSEDED', ownerId: 'owner-1', openedAt: OPENED}], ['حالة مجهولة', {state: 'open', ownerId: 'owner-1', openedAt: OPENED}], ['بلا حالة', {openedAt: OPENED}],
    ['openedAt غائب', {state: 'OPEN'}], ['openedAt نصّ', {state: 'OPEN', ownerId: 'owner-1', openedAt: '2026-10-22'}], ['openedAt رقم', {state: 'OPEN', ownerId: 'owner-1', openedAt: 5}],
    ['completedByScanId فارغ', {state: 'COMPLETED', ownerId: 'owner-1', openedAt: OPENED, completedByScanId: ''}], ['completedByScanId رقم', {state: 'COMPLETED', ownerId: 'owner-1', openedAt: OPENED, completedByScanId: 7}],
    ['OPEN وcompletedByScanId نصّ (تناقض)', {state: 'OPEN', ownerId: 'owner-1', openedAt: OPENED, completedByScanId: 'x'}],
  ]) deq(M.readPair(P(bad)).kind, 'UNREADABLE', `[٤] pair ${label} ⟵ UNREADABLE (لا يُخمَّن)`);
  for (const bad of ['x', 5, true, ['OPEN']]) deq(M.readPair(P(bad)).kind, 'UNREADABLE', `[٤] pair بشكل ${JSON.stringify(bad)} ⟵ UNREADABLE`);
  // (S8) ownerId نصّ غير فارغ مطلوب للمقروء: «قبل» بلا مالك (أو بمالك بشكل خاطئ) غير مقروءة ولا تُخمَّن (لا ترحيل: لا «قبل» بالشكل القديم في الإنتاج)
  const UNREADABLE_PAIR = {kind: 'UNREADABLE', state: null, openedAtMs: null, completedByScanId: null, ownerId: null};
  for (const [label, bad] of [['ownerId غائب', undefined], ['ownerId null', null], ['ownerId فارغ', ''], ['ownerId رقم', 7], ['ownerId كائن', {}], ['ownerId مصفوفة', ['x']], ['ownerId منطقي', true]]) {
    const pairObj = {state: 'OPEN', openedAt: OPENED};
    if (bad !== undefined) pairObj.ownerId = bad;
    deq(M.readPair(P(pairObj)), UNREADABLE_PAIR, `[٤] (S8) pair ${label} ⟵ UNREADABLE`);
  }
  deq(M.readPair(P({state: 'COMPLETED', ownerId: 'shop-9', openedAt: OPENED, completedByScanId: 'a'})).ownerId, 'shop-9', '[٤] (S8) ownerId المقروء هو المخزَّن حرفاً (COMPLETED أيضاً)');
  deq(M.PAIR_READ, {ABSENT: 'ABSENT', PRESENT: 'PRESENT', UNREADABLE: 'UNREADABLE'}, '[٤] PAIR_READ');

  // hasLiveLink: active وrelinked_by_admin وحدهما
  for (const s of ['active', 'relinked_by_admin']) eq(M.hasLiveLink({linkState: s}), true, `[٤] linkState ${s}: ربط حيّ`);
  for (const s of ['none', 'missing', 'unlinked_by_admin', 'ACTIVE', '', undefined, null, 5]) eq(M.hasLiveLink({linkState: s}), false, `[٤] linkState ${JSON.stringify(s)}: ليس حيّاً`);
  eq(M.hasLiveLink(null), false, '[٤] مستند غائب: ليس حيّاً');
  eq(M.hasLiveLink({}), false, '[٤] بلا linkState: ليس حيّاً (الغياب لا يُقرأ ربطاً)');

  // classifyOpenBefore: ترتيب الفحوص وأسبابها
  const base = {scanPurpose: 'maintenance_before', defectType: 'BATTERY', pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts(NOW - 10 * HOUR)}};
  const cls = (over, extra = {}) => M.classifyOpenBefore({data: {...base, ...over}, afterDefectType: 'BATTERY', uid: 'owner-1', nowMs: NOW, validityHours: 72, ...extra});
  deq(cls({}), {include: true, openedAtMs: NOW - 10 * HOUR}, '[٤] «قبل» سليمة: مرشَّحة ومعها وقتها');
  deq(cls({scanPurpose: 'battery_before'}), {include: false, reason: 'WRONG_PURPOSE'}, '[٤] غرض battery_before ⟵ WRONG_PURPOSE');
  deq(cls({scanPurpose: 'maintenance_after'}), {include: false, reason: 'WRONG_PURPOSE'}, '[٤] غرض maintenance_after ⟵ WRONG_PURPOSE');
  deq(cls({scanPurpose: undefined}), {include: false, reason: 'WRONG_PURPOSE'}, '[٤] غرض غائب ⟵ WRONG_PURPOSE');
  deq(M.classifyOpenBefore({data: null, afterDefectType: 'BATTERY', uid: 'owner-1', nowMs: NOW, validityHours: 72}), {include: false, reason: 'WRONG_PURPOSE'}, '[٤] مستند غائب ⟵ WRONG_PURPOSE');
  for (const t of ['CHARGING_PORT', 'THERMAL', 'MOTHERBOARD', 'SOFTWARE', null, undefined, 'battery', 'OTHER', 5]) {
    deq(cls({defectType: t}), {include: false, reason: 'WRONG_TYPE'}, `[٤] نوع «قبل» ${JSON.stringify(t)} ≠ نوع «بعد» BATTERY ⟵ WRONG_TYPE (والغياب لا يطابق)`);
  }
  deq(cls({defectType: 'THERMAL'}, {afterDefectType: 'THERMAL'}), {include: true, openedAtMs: NOW - 10 * HOUR}, '[٤] النوع نفسه THERMAL ⟵ مرشَّحة');
  deq(cls({pair: null}), {include: false, reason: 'UNREADABLE'}, '[٤] pair null على «قبل» صيانة ⟵ UNREADABLE (شذوذ لا يُخمَّن)');
  deq(cls({pair: {state: 'OPEN'}}), {include: false, reason: 'UNREADABLE'}, '[٤] pair بلا openedAt ⟵ UNREADABLE');
  deq(cls({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - HOUR), completedByScanId: 'a'}}), {include: false, reason: 'NOT_OPEN'}, '[٤] COMPLETED ⟵ NOT_OPEN');
  deq(cls({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts(NOW - 73 * HOUR)}}), {include: false, reason: 'EXPIRED'}, '[٤] OPEN وخارج النافذة (73 ساعة) ⟵ EXPIRED');
  deq(cls({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts(NOW - 72 * HOUR)}}), {include: true, openedAtMs: NOW - 72 * HOUR}, '[٤] OPEN على حدّ النافذة ⟵ مرشَّحة');
  // (S8) المحلّ من pair.ownerId: pair لمحلّ آخر ⟵ OTHER_SHOP (دفاع؛ الاستعلام يقيّد بالمحلّ أصلاً)، بعد قراءة pair وقبل حالته ونافذته
  deq(cls({}, {uid: 'owner-2'}), {include: false, reason: 'OTHER_SHOP'}, '[٤] (S8) pair.ownerId ≠ المستدعي ⟵ OTHER_SHOP');
  deq(cls({pair: {state: 'COMPLETED', ownerId: 'owner-2', openedAt: ts(NOW - HOUR), completedByScanId: 'a'}}).reason, 'OTHER_SHOP', '[٤] (S8) محلّ آخر ومكتملة ⟵ OTHER_SHOP قبل NOT_OPEN');
  deq(cls({pair: {state: 'OPEN', ownerId: 'owner-2', openedAt: ts(NOW - 999 * HOUR)}}).reason, 'OTHER_SHOP', '[٤] (S8) محلّ آخر ومنقضية ⟵ OTHER_SHOP قبل EXPIRED');
  deq(cls({pair: {state: 'OPEN', ownerId: null, openedAt: ts(NOW - HOUR)}}), {include: false, reason: 'UNREADABLE'}, '[٤] (S8) «قبل» بلا مالك (null) ⟵ UNREADABLE لا OTHER_SHOP (الغياب لا يُقرأ محلّاً آخر)');
  deq(cls({pair: null}, {uid: 'owner-2'}).reason, 'UNREADABLE', '[٤] (S8) pair غير مقروء قبل المحلّ');
  deq(cls({defectType: 'THERMAL'}, {uid: 'owner-2'}).reason, 'WRONG_TYPE', '[٤] (S8) النوع قبل المحلّ');
  deq(cls({scanPurpose: 'normal'}, {uid: 'owner-2'}).reason, 'WRONG_PURPOSE', '[٤] (S8) الغرض قبل المحلّ');
  // الترتيب: الغرض قبل النوع قبل pair قبل النافذة
  deq(cls({scanPurpose: 'normal', defectType: 'THERMAL', pair: null}).reason, 'WRONG_PURPOSE', '[٤] الغرض أوّلاً');
  deq(cls({defectType: 'THERMAL', pair: null}).reason, 'WRONG_TYPE', '[٤] ثم النوع');
  deq(cls({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - 999 * HOUR), completedByScanId: 'a'}}).reason, 'NOT_OPEN', '[٤] ثم حالة pair (قبل النافذة)');
  deq(M.PAIR_EXCLUDED, {WRONG_PURPOSE: 'WRONG_PURPOSE', WRONG_TYPE: 'WRONG_TYPE', UNREADABLE: 'UNREADABLE', NOT_OPEN: 'NOT_OPEN', EXPIRED: 'EXPIRED', OTHER_SHOP: 'OTHER_SHOP', REPORT_ABSENT: 'REPORT_ABSENT', OWNER_UNKNOWN: 'OWNER_UNKNOWN', OWNER_MISMATCH: 'OWNER_MISMATCH', LIVE_LINK: 'LIVE_LINK'}, '[٤] أسباب الاستبعاد العشرة (S8: +OWNER_MISMATCH)');
  deq(M.REPORT_FIELD, {USER_ID: 'userId', DEVICE_MODEL: 'deviceModel'}, '[٤] حقلا تقرير «قبل» المقروءان');
  eq(M.OPEN_PAIR_SCAN_CAP, 500, '[٤] سقف المقروء من استعلام المفتوحات 500');

  // deviceNameFor: الاسم التجاري بحالة صريحة، ولا نسخة خريطة في الردّ
  const {readMarketingNamesDocument} = require('../src/protocol/marketingNames');
  const mapDoc = {version: 4, entries: [{model: 'SM-A135F', ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}]};
  const source = readMarketingNamesDocument(mapDoc);
  deq(M.deviceNameFor({model: 'SM-A135F', source}), {state: 'mapped', model: 'SM-A135F', names: {ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}, reason: null}, '[٤] طراز في الخريطة ⟵ mapped بالأسماء الثلاثة');
  deq(M.deviceNameFor({model: 'XT2201-2', source}), {state: 'name_unmapped', model: 'XT2201-2', names: null, reason: 'MODEL_NOT_IN_MAP'}, '[٤] طراز ليس فيها ⟵ name_unmapped ويُعاد Build.MODEL كما هو (لا اسم مختلَق)');
  deq(M.deviceNameFor({model: 'sm-a135f', source}), {state: 'name_unmapped', model: 'sm-a135f', names: null, reason: 'MODEL_NOT_IN_MAP'}, '[٤] المطابقة حرفيّة: حالة أحرف مختلفة ⟵ name_unmapped');
  deq(M.deviceNameFor({model: 'SM-A135F', source: readMarketingNamesDocument(null)}), {state: 'name_unmapped', model: 'SM-A135F', names: null, reason: 'MAP_ABSENT'}, '[٤] خريطة غائبة ⟵ name_unmapped: MAP_ABSENT');
  deq(M.deviceNameFor({model: 'SM-A135F', source: readMarketingNamesDocument({version: 0, entries: []})}), {state: 'name_unmapped', model: 'SM-A135F', names: null, reason: 'MAP_UNREADABLE'}, '[٤] خريطة بشكل لا يُقرأ ⟵ MAP_UNREADABLE');
  for (const noModel of [undefined, null, '', 5]) deq(M.deviceNameFor({model: noModel, source}), {state: 'name_unmapped', model: null, names: null, reason: 'MODEL_ABSENT'}, `[٤] طراز ${JSON.stringify(noModel)} ⟵ MODEL_ABSENT`);
  ok(!('version' in M.deviceNameFor({model: 'SM-A135F', source})), '[٤] لا نسخة خريطة في deviceName');

  // sortNewestFirst
  const unsorted = [{beforeScanId: 'b', openedAtMs: 100}, {beforeScanId: 'a', openedAtMs: 300}, {beforeScanId: 'd', openedAtMs: 200}, {beforeScanId: 'c', openedAtMs: 200}];
  deq(M.sortNewestFirst(unsorted).map((x) => x.beforeScanId), ['a', 'c', 'd', 'b'], '[٤] الأحدث أوّلاً، وعند التساوي بمعرّف «قبل» تصاعدياً');
  deq(unsorted.map((x) => x.beforeScanId), ['b', 'a', 'd', 'c'], '[٤] لا يعدّل مدخله');
  deq(M.sortNewestFirst([]), [], '[٤] قائمة فارغة');
}

// ═══ ٥ — (S5) اختيار الربط وقرار التأكيد وقرار الاكتمال ═══
{
  const NOW5 = 1_800_000_000_000;
  const HOUR5 = 3600 * 1000;
  const {ts: ts5} = require('./lib/pairFakeDb');
  // readLinkChoice
  deq(M.readLinkChoice({linkedScanId: 'b-1', linkMethod: 'manual'}), {beforeScanId: 'b-1', note: null}, '[٥] ربط مؤكَّد (manual): المعرّف بلا ملاحظة');
  for (const [label, pd] of [['pending null', null], ['pending undefined', undefined], ['بلا linkedScanId', {purposeSource: 'selected'}], ['linkedScanId null (ممسوح)', {linkedScanId: null, linkMethod: null}], ['linkedScanId undefined', {linkedScanId: undefined}]]) {
    deq(M.readLinkChoice(pd), {beforeScanId: null, note: 'PAIR_LINK_NOT_CHOSEN'}, `[٥] ${label} ⟵ لا ربط مختار (PAIR_LINK_NOT_CHOSEN)`);
  }
  for (const [label, pd] of [['linkMethod غائب', {linkedScanId: 'b-1'}], ['linkMethod auto_confirmed (لا يُكتب أبداً)', {linkedScanId: 'b-1', linkMethod: 'auto_confirmed'}], ['linkMethod null', {linkedScanId: 'b-1', linkMethod: null}],
    ['linkMethod أحرف مختلفة', {linkedScanId: 'b-1', linkMethod: 'Manual'}], ['معرّف رقم', {linkedScanId: 5, linkMethod: 'manual'}], ['معرّف فارغ', {linkedScanId: '', linkMethod: 'manual'}], ['معرّف كائن', {linkedScanId: {}, linkMethod: 'manual'}]]) {
    deq(M.readLinkChoice(pd), {beforeScanId: null, note: 'PAIR_LINK_NOT_RECOGNIZED'}, `[٥] ${label} ⟵ لا ربط، ملاحظة PAIR_LINK_NOT_RECOGNIZED (لا يُخمَّن)`);
  }
  deq(M.PAIR_LINK_INTENT, {NONE: 'NONE', CHOSEN: 'CHOSEN'}, '[٥] PAIR_LINK_INTENT');
  deq(M.PAIR_COMPLETION, {LINKED: 'LINKED', TARGET_LOST: 'TARGET_LOST'}, '[٥] PAIR_COMPLETION');
  deq(M.PAIR_LOST_REASON, {TARGET_NOT_FOUND: 'TARGET_NOT_FOUND', TARGET_WRONG_PURPOSE: 'TARGET_WRONG_PURPOSE', TARGET_WRONG_TYPE: 'TARGET_WRONG_TYPE', TARGET_PAIR_UNREADABLE: 'TARGET_PAIR_UNREADABLE', TARGET_NOT_OPEN: 'TARGET_NOT_OPEN', TARGET_LIVE_LINK: 'TARGET_LIVE_LINK'}, '[٥] أسباب ضياع الهدف الستّة');

  // decidePairCompletion
  const openBefore = (over = {}) => ({scanPurpose: 'maintenance_before', defectType: 'BATTERY', linkedScanId: null, linkState: 'none', linkMethod: null, pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - HOUR5)}, ...over});
  // (ق36 أ، 2026-10-22؛ القاعدة 23) القرار يأخذ تقريرَي الزوج (طرازاهما) ويُرجع modelCheck: كانت المدخلات والمخرجات بلا الطراز
  const complete = (over = {}) => M.decidePairCompletion({afterScanId: 'after-1', afterDefectType: 'BATTERY', beforeScanId: 'before-1', beforeData: openBefore(), linkedDocs: [], beforeReportData: {deviceModel: 'SM-A135F'}, afterReportData: {deviceModel: 'SM-A135F'}, ...over});
  const LINKED_AFTER = {linkedScanId: 'before-1', linkState: 'active', linkMethod: 'manual', linkModelCheck: 'LINK_MODEL_MATCH'};
  const LOST = (reason) => ({outcome: 'TARGET_LOST', reason, afterFields: {linkedScanId: 'before-1', linkState: 'missing', linkMethod: 'manual'}, beforeUpdate: null, modelCheck: null});
  deq(complete(), {outcome: 'LINKED', reason: null, afterFields: LINKED_AFTER, beforeUpdate: {'pair.state': 'COMPLETED', 'pair.completedByScanId': 'after-1'}, modelCheck: 'LINK_MODEL_MATCH'}, '[٥] **الاكتمال السليم**: «بعد» active/manual/المعرّف ومعها linkModelCheck، و«قبل» pair.state = COMPLETED وcompletedByScanId = «بعد»');
  deq(complete({beforeData: null}), LOST('TARGET_NOT_FOUND'), '[٥] «قبل» غائبة ⟵ TARGET_LOST (missing) ولا تحديث لـ«قبل»');
  deq(complete({beforeData: undefined}), LOST('TARGET_NOT_FOUND'), '[٥] «قبل» undefined ⟵ TARGET_NOT_FOUND');
  deq(complete({beforeData: openBefore({scanPurpose: 'battery_before'})}), LOST('TARGET_WRONG_PURPOSE'), '[٥] غرض «قبل» battery_before ⟵ TARGET_WRONG_PURPOSE');
  deq(complete({beforeData: openBefore({scanPurpose: 'maintenance_after'})}), LOST('TARGET_WRONG_PURPOSE'), '[٥] غرضها maintenance_after ⟵ TARGET_WRONG_PURPOSE');
  deq(complete({beforeData: openBefore({defectType: 'THERMAL'})}), LOST('TARGET_WRONG_TYPE'), '[٥] نوعها THERMAL و«بعد» BATTERY ⟵ TARGET_WRONG_TYPE');
  deq(complete({beforeData: openBefore({defectType: null})}), LOST('TARGET_WRONG_TYPE'), '[٥] نوع «قبل» null ⟵ TARGET_WRONG_TYPE (الغياب لا يطابق)');
  deq(complete({afterDefectType: null, beforeData: openBefore({defectType: null})}), LOST('TARGET_WRONG_TYPE'), '[٥] **نوع «بعد» null ونوع «قبل» null: لا يتطابقان** (غياب النوعين لا يُربَط)');
  deq(complete({afterDefectType: 'OTHER', beforeData: openBefore({defectType: 'OTHER'})}), LOST('TARGET_WRONG_TYPE'), '[٥] نوع خارج القائمة في الطرفين ⟵ TARGET_WRONG_TYPE');
  deq(complete({afterDefectType: 'THERMAL', beforeData: openBefore({defectType: 'THERMAL'})}).outcome, 'LINKED', '[٥] THERMAL والنوع نفسه ⟵ LINKED');
  deq(complete({beforeData: openBefore({pair: null})}), LOST('TARGET_PAIR_UNREADABLE'), '[٥] pair null على «قبل» ⟵ TARGET_PAIR_UNREADABLE');
  deq(complete({beforeData: openBefore({pair: {state: 'OPEN'}})}), LOST('TARGET_PAIR_UNREADABLE'), '[٥] pair بلا openedAt ⟵ TARGET_PAIR_UNREADABLE');
  deq(complete({beforeData: openBefore({pair: {state: 'OPEN', openedAt: ts5(NOW5 - HOUR5)}})}), LOST('TARGET_PAIR_UNREADABLE'), '[٥] (S8) pair بلا ownerId ⟵ TARGET_PAIR_UNREADABLE (لا ترحيل: الشكل القديم غير مقروء)');
  ok(!('pair.ownerId' in complete().beforeUpdate) && !('pair' in complete().beforeUpdate), '[٥] (S8) اكتمال «قبل» لا يكتب ownerId ولا يستبدل pair كلّه (تحديثان منقَّطان فيبقى المالك)');
  deq(complete({beforeData: openBefore({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts5(NOW5), completedByScanId: 'other-after'}})}), LOST('TARGET_NOT_OPEN'), '[٥] **«قبل» COMPLETED بغيرها ⟵ TARGET_NOT_OPEN** (السباق: فاز غيرها)');
  deq(complete({linkedDocs: [{linkedScanId: 'before-1', linkState: 'active'}]}), LOST('TARGET_LIVE_LINK'), '[٥] «بعد» أخرى بربط active بها ⟵ TARGET_LIVE_LINK');
  deq(complete({linkedDocs: [{linkedScanId: 'before-1', linkState: 'relinked_by_admin'}]}), LOST('TARGET_LIVE_LINK'), '[٥] وبـrelinked_by_admin ⟵ TARGET_LIVE_LINK');
  deq(complete({linkedDocs: [{linkState: 'missing'}, {linkState: 'unlinked_by_admin'}, {linkState: 'none'}, {}]}).outcome, 'LINKED', '[٥] روابط ميّتة (missing · unlinked_by_admin · none · بلا حالة) لا تمنع');
  // الترتيب: الغياب ثم الغرض ثم النوع ثم pair ثم OPEN ثم الربط الحيّ
  deq(complete({beforeData: openBefore({scanPurpose: 'normal', defectType: 'THERMAL', pair: null}), linkedDocs: [{linkState: 'active'}]}).reason, 'TARGET_WRONG_PURPOSE', '[٥] الغرض أوّلاً');
  deq(complete({beforeData: openBefore({defectType: 'THERMAL', pair: null}), linkedDocs: [{linkState: 'active'}]}).reason, 'TARGET_WRONG_TYPE', '[٥] ثم النوع');
  deq(complete({beforeData: openBefore({pair: null}), linkedDocs: [{linkState: 'active'}]}).reason, 'TARGET_PAIR_UNREADABLE', '[٥] ثم pair');
  deq(complete({beforeData: openBefore({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts5(NOW5), completedByScanId: 'x'}}), linkedDocs: [{linkState: 'active'}]}).reason, 'TARGET_NOT_OPEN', '[٥] ثم OPEN');
  // **لا فحص انقضاء عند الاكتمال** (التأكيد فحصه): «قبل» عمرها 10 آلاف ساعة تُربط
  deq(complete({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - 10000 * HOUR5)}})}).outcome, 'LINKED', '[٥] لا إعادة تحقّق من انقضاء المدّة عند الاكتمال (A3 البند ٤)');
  // المخرجات لا تشير إلى مُدخلاتها
  { const b = openBefore(); const docs = [{linkState: 'none'}]; const snap = JSON.stringify([b, docs]); complete({beforeData: b, linkedDocs: docs}); eq(JSON.stringify([b, docs]), snap, '[٥] لا تعدّل مدخلاتها'); n += 0; }
  // (ق36 أ، القاعدة 23: كانت ثلاثة حقول؛ صارت أربعة عند LINKED، وتبقى ثلاثة عند ضياع الهدف: لا مقارنة بلا هدف)
  deq(Object.keys(complete().afterFields).sort(), ['linkMethod', 'linkModelCheck', 'linkState', 'linkedScanId'], '[٥] أربعة حقول على «بعد» عند LINKED (النوع والزوج يُبنيان في المستند لا هنا)');
  deq(Object.keys(complete({beforeData: null}).afterFields).sort(), ['linkMethod', 'linkState', 'linkedScanId'], '[٥] وثلاثة عند ضياع الهدف: linkModelCheck يبقى null من المستند لا يُكتب هنا');
  deq(Object.keys(complete().beforeUpdate), ['pair.state', 'pair.completedByScanId'], '[٥] وحقلان منقَّطان على «قبل» لا غير');

  // decideConfirmBefore
  const confirm = (over = {}) => M.decideConfirmBefore({
    uid: 'owner-1', beforeData: openBefore(), reportData: {userId: 'owner-1', deviceModel: 'X'}, afterDefectType: 'BATTERY', validityHours: 72, nowMs: NOW5, linkedDocs: [], ...over,
  });
  deq(confirm(), {ok: true}, '[٥] تأكيد سليم');
  deq(confirm({beforeData: null}), {ok: false, refusal: 'BEFORE_NOT_FOUND', extra: ''}, '[٥] «قبل» غائبة ⟵ BEFORE_NOT_FOUND');
  deq(confirm({beforeData: undefined}).refusal, 'BEFORE_NOT_FOUND', '[٥] undefined ⟵ BEFORE_NOT_FOUND');
  deq(confirm({reportData: null}), {ok: false, refusal: 'BEFORE_NOT_OWNED', extra: ' ownerState=ABSENT'}, '[٥] التقرير غائب: المالك مجهول ⟵ BEFORE_NOT_OWNED (لا يُقرأ ملكيةً)');
  deq(confirm({reportData: {deviceModel: 'X'}}).extra, ' ownerState=ABSENT', '[٥] تقرير بلا userId ⟵ NOT_OWNED/ABSENT');
  deq(confirm({reportData: {userId: '', deviceModel: 'X'}}).extra, ' ownerState=ABSENT', '[٥] userId فارغ ⟵ NOT_OWNED/ABSENT');
  deq(confirm({reportData: {userId: 5}}).extra, ' ownerState=ABSENT', '[٥] userId رقم ⟵ NOT_OWNED/ABSENT');
  // (S8، القاعدة 23: كان هذا السطر يثبّت «تقرير محلّ آخر ⟵ NOT_OWNED» بـpair بلا مالك؛ صار «قبل» محلّ آخر حقاً حين يطابق pair.ownerId تقريرها، واختلافهما شذوذ OWNER_MISMATCH)
  deq(confirm({reportData: {userId: 'owner-2'}, beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-2', openedAt: ts5(NOW5 - HOUR5)}})}), {ok: false, refusal: 'BEFORE_NOT_OWNED', extra: ' ownerState=OTHER'}, '[٥] «قبل» محلّ آخر (pair والتقرير معاً) ⟵ BEFORE_NOT_OWNED/OTHER');
  deq(confirm({reportData: {userId: 'owner-2'}}), {ok: false, refusal: 'PAIR_OWNER_MISMATCH', extra: ' ownerState=PAIR_DIFFERS_FROM_REPORT'}, '[٥] (S8) pair.ownerId = المستدعي والتقرير لمحلّ آخر ⟵ PAIR_OWNER_MISMATCH (شذوذ مسمّى لا NOT_OWNED ولا قبول)');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-2', openedAt: ts5(NOW5 - HOUR5)}})}), {ok: false, refusal: 'PAIR_OWNER_MISMATCH', extra: ' ownerState=PAIR_DIFFERS_FROM_REPORT'}, '[٥] (S8) التقرير للمستدعي وpair.ownerId لمحلّ آخر ⟵ PAIR_OWNER_MISMATCH أيضاً');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', openedAt: ts5(NOW5 - HOUR5)}})}), {ok: false, refusal: 'PAIR_BEFORE_UNREADABLE', extra: ' pair=UNREADABLE'}, '[٥] (S8) pair بلا ownerId ⟵ PAIR_BEFORE_UNREADABLE (لا يُقرأ تطابقاً ولا يُرفض شذوذاً)');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: null, openedAt: ts5(NOW5 - HOUR5)}})}).refusal, 'PAIR_BEFORE_UNREADABLE', '[٥] (S8) ownerId null ⟵ PAIR_BEFORE_UNREADABLE');
  deq(confirm({beforeData: openBefore({scanPurpose: 'battery_before'})}).refusal, 'BEFORE_WRONG_PURPOSE', '[٥] غرض «قبل» battery_before ⟵ BEFORE_WRONG_PURPOSE');
  deq(confirm({beforeData: openBefore({scanPurpose: 'maintenance_after'})}).refusal, 'BEFORE_WRONG_PURPOSE', '[٥] غرضها maintenance_after ⟵ BEFORE_WRONG_PURPOSE (لا «بعد» تُربط)');
  deq(confirm({beforeData: openBefore({scanPurpose: 'normal'})}).refusal, 'BEFORE_WRONG_PURPOSE', '[٥] غرضها normal ⟵ BEFORE_WRONG_PURPOSE');
  deq(confirm({beforeData: openBefore({scanPurpose: undefined})}).refusal, 'BEFORE_WRONG_PURPOSE', '[٥] غرضها غائب ⟵ BEFORE_WRONG_PURPOSE');
  deq(confirm({beforeData: openBefore({defectType: 'THERMAL'})}).refusal, 'BEFORE_WRONG_DEFECT_TYPE', '[٥] **نوع مختلف** ⟵ BEFORE_WRONG_DEFECT_TYPE');
  deq(confirm({beforeData: openBefore({defectType: null})}).refusal, 'BEFORE_WRONG_DEFECT_TYPE', '[٥] نوع «قبل» null ⟵ BEFORE_WRONG_DEFECT_TYPE');
  deq(confirm({beforeData: openBefore({defectType: undefined})}).refusal, 'BEFORE_WRONG_DEFECT_TYPE', '[٥] نوع «قبل» غائب ⟵ BEFORE_WRONG_DEFECT_TYPE');
  deq(confirm({beforeData: openBefore({pair: null})}), {ok: false, refusal: 'PAIR_BEFORE_UNREADABLE', extra: ' pair=ABSENT'}, '[٥] pair null على «قبل» صيانة ⟵ PAIR_BEFORE_UNREADABLE (pair=ABSENT في السجلّ)');
  deq(confirm({beforeData: openBefore({pair: {state: 'WEIRD', ownerId: 'owner-1', openedAt: ts5(NOW5)}})}), {ok: false, refusal: 'PAIR_BEFORE_UNREADABLE', extra: ' pair=UNREADABLE'}, '[٥] pair بحالة مجهولة ⟵ PAIR_BEFORE_UNREADABLE');
  deq(confirm({beforeData: openBefore({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts5(NOW5 - HOUR5), completedByScanId: 'a'}})}), {ok: false, refusal: 'BEFORE_ALREADY_PAIRED', extra: ' via=PAIR_STATE'}, '[٥] COMPLETED ⟵ BEFORE_ALREADY_PAIRED (via=PAIR_STATE)');
  deq(confirm({linkedDocs: [{linkState: 'active'}]}), {ok: false, refusal: 'BEFORE_ALREADY_PAIRED', extra: ' via=LIVE_LINK'}, '[٥] OPEN لكن لها ربط حيّ ⟵ BEFORE_ALREADY_PAIRED (via=LIVE_LINK)');
  deq(confirm({linkedDocs: [{linkState: 'missing'}, {linkState: 'unlinked_by_admin'}]}), {ok: true}, '[٥] روابط ميّتة لا تمنع التأكيد');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - 73 * HOUR5)}})}), {ok: false, refusal: 'BEFORE_EXPIRED', extra: ''}, '[٥] خارج النافذة (73 ساعة والمدّة 72) ⟵ BEFORE_EXPIRED');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - 72 * HOUR5)}})}), {ok: true}, '[٥] على حدّ النافذة (72 بالضبط) ⟵ يُقبل');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - 50 * HOUR5)}}), validityHours: 24}).refusal, 'BEFORE_EXPIRED', '[٥] المدّة 24 و«قبل» عمرها 50: BEFORE_EXPIRED (المدّة من الإعداد)');
  // الترتيب المعتمد (S8: OWNER_MISMATCH بعد التقرير المعروف المالك وقبل حكم ملكية المستدعي): NOT_FOUND ثم OWNER_MISMATCH ثم NOT_OWNED ثم WRONG_PURPOSE ثم WRONG_DEFECT_TYPE ثم UNREADABLE ثم ALREADY_PAIRED ثم EXPIRED
  const all = (over) => ({beforeData: openBefore({scanPurpose: 'normal', defectType: 'THERMAL', pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts5(NOW5 - 999 * HOUR5), completedByScanId: 'x'}}), reportData: {userId: 'owner-2'}, linkedDocs: [{linkState: 'active'}], ...over});
  deq(confirm(all({beforeData: null})).refusal, 'BEFORE_NOT_FOUND', '[٥] الترتيب: 1 NOT_FOUND');
  deq(confirm(all()).refusal, 'PAIR_OWNER_MISMATCH', '[٥] الترتيب: 2 OWNER_MISMATCH (S8: pair.ownerId owner-1 والتقرير owner-2)');
  deq(confirm(all({beforeData: openBefore({scanPurpose: 'normal', defectType: 'THERMAL', pair: {state: 'COMPLETED', ownerId: 'owner-2', openedAt: ts5(NOW5 - 999 * HOUR5), completedByScanId: 'x'}})})).refusal, 'BEFORE_NOT_OWNED', '[٥] الترتيب: 3 NOT_OWNED (pair والتقرير لمحلّ آخر معاً)');
  deq(confirm(all({reportData: {userId: 'owner-1'}})).refusal, 'BEFORE_WRONG_PURPOSE', '[٥] الترتيب: 4 WRONG_PURPOSE');
  deq(confirm(all({reportData: {userId: 'owner-1'}, beforeData: openBefore({defectType: 'THERMAL', pair: null})})).refusal, 'BEFORE_WRONG_DEFECT_TYPE', '[٥] الترتيب: 5 WRONG_DEFECT_TYPE');
  deq(confirm(all({reportData: {userId: 'owner-1'}, beforeData: openBefore({pair: null})})).refusal, 'PAIR_BEFORE_UNREADABLE', '[٥] الترتيب: 6 UNREADABLE');
  deq(confirm(all({reportData: {userId: 'owner-1'}, beforeData: openBefore({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts5(NOW5 - 999 * HOUR5), completedByScanId: 'x'}})})).refusal, 'BEFORE_ALREADY_PAIRED', '[٥] الترتيب: 7 ALREADY_PAIRED (قبل EXPIRED)');
  deq(confirm({beforeData: openBefore({pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts5(NOW5 - 999 * HOUR5)}})}).refusal, 'BEFORE_EXPIRED', '[٥] الترتيب: 8 EXPIRED');
}

// ═══ ٦ — (S6) اتّساق التصحيح: decidePairSync وcurrentLinkedId ═══
{
  const {ts: ts6} = require('./lib/pairFakeDb');
  const OPEN6 = (over = {}) => ({scanPurpose: 'maintenance_before', pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts6(1000)}, ...over});
  const DONE6 = (by) => ({scanPurpose: 'maintenance_before', pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts6(1000), completedByScanId: by}});
  const REOPEN = {'pair.state': 'OPEN', 'pair.completedByScanId': null};
  const COMPLETE_BY = (by) => ({'pair.state': 'COMPLETED', 'pair.completedByScanId': by});
  const sync = (over) => M.decidePairSync({action: 'unlink', scanId: 'x', oldTargetId: null, oldTargetData: null, newTargetId: null, newTargetData: null, ...over});
  // currentLinkedId
  eq(M.currentLinkedId({linkedScanId: 'b-1'}), 'b-1', '[٦] currentLinkedId: المعرّف النصّي');
  for (const bad of [undefined, null, '', 5, {}, ['b']]) eq(M.currentLinkedId({linkedScanId: bad}), null, `[٦] currentLinkedId: ${JSON.stringify(bad)} ⟵ null`);
  eq(M.currentLinkedId(null), null, '[٦] مستند غائب ⟵ null');
  eq(M.currentLinkedId({}), null, '[٦] بلا حقل ⟵ null');
  deq(M.PAIR_SYNC_EFFECT, {NONE: 'NONE', REOPENED: 'REOPENED', COMPLETED: 'COMPLETED', SKIPPED: 'SKIPPED'}, '[٦] PAIR_SYNC_EFFECT');
  deq(M.PAIR_SYNC_SKIP, {TARGET_NOT_FOUND: 'TARGET_NOT_FOUND', TARGET_PAIR_UNREADABLE: 'TARGET_PAIR_UNREADABLE', TARGET_NOT_COMPLETED_BY_THIS: 'TARGET_NOT_COMPLETED_BY_THIS', TARGET_ALREADY_COMPLETED: 'TARGET_ALREADY_COMPLETED'}, '[٦] PAIR_SYNC_SKIP');
  // أفعال أخرى: لا أثر
  for (const action of ['exclude', 'unexclude', 'resolveIdentityConflict', 'zzz', undefined]) {
    deq(sync({action, scanId: 'x', oldTargetId: 'b', oldTargetData: DONE6('x')}), {updates: [], entries: []}, `[٦] الفعل ${String(action)} لا أثر له على pair`);
  }
  // unlink
  deq(sync({oldTargetId: 'b', oldTargetData: DONE6('x')}), {updates: [{scanId: 'b', fields: REOPEN}], entries: [{role: 'OLD', targetId: 'b', effect: 'REOPENED', reason: null}]}, '[٦] **unlink: «قبل» التي اكتملت بـX تُعاد OPEN وcompletedByScanId = null**');
  deq(sync({oldTargetId: 'b', oldTargetData: DONE6('someone-else')}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'SKIPPED', reason: 'TARGET_NOT_COMPLETED_BY_THIS'}]}, '[٦] unlink: «قبل» اكتملت بغير X لا تُعاد فتحها (SKIPPED)');
  deq(sync({oldTargetId: 'b', oldTargetData: OPEN6()}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'NONE', reason: null}]}, '[٦] unlink: «قبل» مفتوحة أصلاً: لا شيء');
  deq(sync({oldTargetId: 'b', oldTargetData: {scanPurpose: 'normal', pair: null}}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'NONE', reason: null}]}, '[٦] unlink: هدف ليس «قبل» صيانة (بلا pair): NONE بلا سطر');
  deq(sync({oldTargetId: 'b', oldTargetData: {scanPurpose: 'normal'}}).entries[0].effect, 'NONE', '[٦] unlink: هدف بلا حقل pair أصلاً: NONE');
  deq(sync({oldTargetId: 'b', oldTargetData: OPEN6({pair: {state: 'OPEN', openedAt: ts6(1000)}})}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'SKIPPED', reason: 'TARGET_PAIR_UNREADABLE'}]}, '[٦] (S8) unlink: pair بلا ownerId ⟵ TARGET_PAIR_UNREADABLE (لا ترحيل)');
  deq(sync({oldTargetId: 'b', oldTargetData: OPEN6({pair: {state: 'OPEN'}})}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'SKIPPED', reason: 'TARGET_PAIR_UNREADABLE'}]}, '[٦] unlink: pair غير مقروء ⟵ SKIPPED (لا يُخمَّن)');
  deq(sync({oldTargetId: 'b', oldTargetData: null}), {updates: [], entries: [{role: 'OLD', targetId: 'b', effect: 'SKIPPED', reason: 'TARGET_NOT_FOUND'}]}, '[٦] unlink: الهدف الحاضر غير موجود ⟵ SKIPPED: TARGET_NOT_FOUND');
  deq(sync({oldTargetId: null}), {updates: [], entries: []}, '[٦] unlink بلا هدف حاضر: لا أثر');
  deq(sync({oldTargetId: 'b', oldTargetData: DONE6('x'), newTargetId: 'n', newTargetData: OPEN6()}).updates, [{scanId: 'b', fields: REOPEN}], '[٦] **unlink لا يعالج هدفاً جديداً** (لا هدف له): ولو مُرِّر واحد لا يُكتمل');
  deq(sync({oldTargetId: null, newTargetId: 'n', newTargetData: OPEN6()}), {updates: [], entries: []}, '[٦] unlink بهدف جديد مُمرَّر ولا قديم: لا أثر');
  // relink
  const rl = (over) => sync({action: 'relink', ...over});
  deq(rl({oldTargetId: 'old', oldTargetData: DONE6('x'), newTargetId: 'new', newTargetData: OPEN6()}), {
    updates: [{scanId: 'old', fields: REOPEN}, {scanId: 'new', fields: COMPLETE_BY('x')}],
    entries: [{role: 'OLD', targetId: 'old', effect: 'REOPENED', reason: null}, {role: 'NEW', targetId: 'new', effect: 'COMPLETED', reason: null}],
  }, '[٦] **relink: القديمة تُعاد OPEN والجديدة OPEN تصير COMPLETED بـX**');
  deq(rl({oldTargetId: null, newTargetId: 'new', newTargetData: OPEN6()}).updates, [{scanId: 'new', fields: COMPLETE_BY('x')}], '[٦] relink بلا هدف قديم (كانت غير مربوطة): الجديدة تُكتمل وحدها');
  deq(rl({oldTargetId: 'old', oldTargetData: DONE6('x'), newTargetId: 'new', newTargetData: DONE6('y')}), {
    updates: [{scanId: 'old', fields: REOPEN}],
    entries: [{role: 'OLD', targetId: 'old', effect: 'REOPENED', reason: null}, {role: 'NEW', targetId: 'new', effect: 'SKIPPED', reason: 'TARGET_ALREADY_COMPLETED'}],
  }, '[٦] **relink إلى «قبل» اكتملت بغير X: لا تُمسّ وتُعلَن TARGET_ALREADY_COMPLETED** (لا رفض: قواعد الأزواج معلّقة، ق18)');
  deq(rl({newTargetId: 'new', newTargetData: DONE6('x')}), {updates: [], entries: [{role: 'NEW', targetId: 'new', effect: 'NONE', reason: null}]}, '[٦] relink إلى «قبل» مكتملة بـX نفسها: لا شيء (idempotent)');
  deq(rl({newTargetId: 'new', newTargetData: {scanPurpose: 'normal', pair: null}}).entries, [{role: 'NEW', targetId: 'new', effect: 'NONE', reason: null}], '[٦] relink إلى فحص ليس «قبل» صيانة: NONE (لا أثر)');
  deq(rl({newTargetId: 'new', newTargetData: OPEN6({pair: {state: 'OPEN'}})}).entries, [{role: 'NEW', targetId: 'new', effect: 'SKIPPED', reason: 'TARGET_PAIR_UNREADABLE'}], '[٦] relink: pair الجديدة غير مقروء ⟵ SKIPPED');
  deq(rl({newTargetId: 'new', newTargetData: null}).entries, [{role: 'NEW', targetId: 'new', effect: 'SKIPPED', reason: 'TARGET_NOT_FOUND'}], '[٦] relink: الجديدة غائبة ⟵ SKIPPED: TARGET_NOT_FOUND (دفاعي: القرار يرفضها قبل ذلك)');
  deq(rl({oldTargetId: 'old', oldTargetData: DONE6('y'), newTargetId: 'new', newTargetData: OPEN6()}), {
    updates: [{scanId: 'new', fields: COMPLETE_BY('x')}],
    entries: [{role: 'OLD', targetId: 'old', effect: 'SKIPPED', reason: 'TARGET_NOT_COMPLETED_BY_THIS'}, {role: 'NEW', targetId: 'new', effect: 'COMPLETED', reason: null}],
  }, '[٦] relink: القديمة اكتملت بغير X لا تُعاد فتحها، والجديدة تُكتمل');
  deq(rl({oldTargetId: 'same', oldTargetData: DONE6('x'), newTargetId: 'same', newTargetData: DONE6('x')}), {updates: [], entries: [{role: 'NEW', targetId: 'same', effect: 'NONE', reason: null}]}, '[٦] **relink إلى الهدف الحاضر نفسه وهو مكتمل بـX: لا تغيير** (لا يُعاد فتحه ثم يُكتمل)');
  deq(rl({oldTargetId: 'same', oldTargetData: OPEN6(), newTargetId: 'same', newTargetData: OPEN6()}), {updates: [{scanId: 'same', fields: COMPLETE_BY('x')}], entries: [{role: 'NEW', targetId: 'same', effect: 'COMPLETED', reason: null}]}, '[٦] relink إلى الهدف الحاضر نفسه وهو مفتوح (بعد unlink سابق): يُكتمل بـX');
  deq(rl({oldTargetId: 'same', oldTargetData: DONE6('y'), newTargetId: 'same', newTargetData: DONE6('y')}), {updates: [], entries: [{role: 'NEW', targetId: 'same', effect: 'SKIPPED', reason: 'TARGET_ALREADY_COMPLETED'}]}, '[٦] وهو مكتمل بغير X: يُتخطّى TARGET_ALREADY_COMPLETED (ولا يُعاد فتحه «قديماً»)');
  // الأثر حقلان منقَّطان لا غير
  for (const u of rl({oldTargetId: 'old', oldTargetData: DONE6('x'), newTargetId: 'new', newTargetData: OPEN6()}).updates) {
    deq(Object.keys(u.fields), ['pair.state', 'pair.completedByScanId'], '[٦] التحديث حقلان منقَّطان لا غير (لا حذف ولا مساس بـopenedAt)');
    ok(!Object.values(u.fields).some((v) => v && v.__delete), '[٦] ولا FieldValue.delete');
  }
  { const od = DONE6('x'); const nd = OPEN6(); const snap = JSON.stringify([od, nd]); rl({oldTargetId: 'o', oldTargetData: od, newTargetId: 'n', newTargetData: nd}); eq(JSON.stringify([od, nd]), snap, '[٦] لا تعدّل مدخلاتها'); }
}

// ═══ ٣ — بنية الوحدة ═══
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'maintenancePair.js'), 'utf8').replace(/\r\n/g, '\n'));
ok(!/require\(["'][^"']*(utils\/admin|firebase-admin|firebase-functions)[^"']*["']\)/.test(source), '[٣] لا require لـFirestore ولا firebase-functions: الوحدة نقيّة (القاعدة 41)');
ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(|runTransaction|\.set\(|\.update\(|\.create\(/.test(source), '[٣] لا كتابة ولا حذف في الوحدة (القاعدة 42؛ الكتابة في الدوالّ المستدعية)');
ok(!/["'`](scanProtocol|protocolPending|scanSessions|reports|reportRaw)["'`]/.test(source), '[٣] لا نصّ حرفي لاسم مجموعة (القاعدة 24: protocolVocabulary.PROTOCOL_COLLECTION)');
ok(!/["'`](BATTERY|CHARGING_PORT|THERMAL|MOTHERBOARD|SOFTWARE|maintenance_before|maintenance_after)["'`]/.test(source), '[٣] لا نصّ حرفي لنوع عطل ولا لغرض صيانة (المصدر: protocolVocabulary)');

console.log(`\nmaintenancePair.test.js: ${n}/${n} assertions passed`);
