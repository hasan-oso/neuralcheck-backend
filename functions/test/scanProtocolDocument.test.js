'use strict';

// scanProtocolDocument.test.js — غرض الفحص ومستند scanProtocol/{scanId} (S-P6-03، 2026-10-18 +03). وحدة بلا شبكة ولا محاكٍ؛ المسار الحقيقي على المحاكي في scanProtocolPurpose.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٢ (:449-517) وdocs/PROTOCOL_CONTRACT.md §٢ A2. الدوالّ نقيّة (القاعدة 41: تُختبر بلا Firestore).
// **القيم المتوقَّعة حرفيّات هنا عمداً** (مرجع مستقلّ عن protocolVocabulary.js: لو انجرف الثابت عن العقد فهذا الاختبار يُفشل لا يتبعه — والمفردات نفسها يثبّتها protocolVocabulary.test.js).
//   ١ readProtocolParts: «الغائب غير مفعَّل» — `=== true` وحدها تفعّل؛ مفتاح لكل جزء دائماً
//   ٢ decidePurposeAtCreation: normal دائماً، والمصدر default مع الجزء وfeature_disabled بدونه
//   ٣ buildScanProtocolDocument: جدول الحالات (بلا جلسة · جلسة بغرض ومصدر · غرض غائب/مجهول · مصدر غائب/مجهول) والقاعدة 22 (كل غياب حالة صريحة)
//   ٤ شكل المستند: ثلاثة عشر مفتاحاً بالضبط (S-P6-07 أضاف repeat وrepeatOf وrepeatClassification وcreditExemption، وS-P6-12 أضاف consent)، بلا هوية ولا ملاحظات، createdAt يُمرَّر صراحةً
//   ٤-ب (S-P6-07) settingsVersion من الإعدادات المقروءة (كان ثابتاً SETTINGS_ABSENT حتى P6-14: القاعدة 23، استُبدل)، وغياب أيّ مُدخل جديد خطأ لا افتراضي، وbuildScanProtocolDocument للابن والأمّ
//   ٤-ج (S3، 2026-10-22) نوع العطل وفتح الزوج: defectType من protocolPending لـmaintenance_* وحدها (والغائب/المجهول null بملاحظة مسمّاة)، وpair = {state: OPEN, openedAt} لـmaintenance_before وحدها وnull صريح لغيره، والمفتاحان حاضران دائماً
//   ٥ بنية الشيفرة: لا I/O، لا حذف، لا تصدير لأسماء الحقول (E36)
//
// Run: node functions/test/scanProtocolDocument.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const M = require('../src/protocol/scanProtocolDocument');

const STAMP = {__stamp: 'createdAt-test-marker'}; // علامة مسمّاة في العيّنات (لا FieldValue حيّة في اختبار نقيّ)
// S-P6-07: مُدخلات جديدة تُمرَّر صراحةً (لا افتراضي في الشيفرة)؛ هذا الاختبار يمرّرها هنا عمداً لأنه يفحص غرض الفحص ومصدره، والاختيار والتصنيف في repeatScan.test.js.
const ABSENT_SETTINGS = {state: 'ABSENT', version: null, data: null, anomaly: null};
const NOT_CHILD = {isChild: false, parentSessionId: null, parentScanId: null, reference: {state: 'ABSENT', valueC: null}, startedBeforeCooling: null};
const NEW_INPUTS = {settings: ABSENT_SETTINGS, parts: {purposes: false, batteryBeforeAfter: false, coldRepeat: false, returns: false, doubleEval: false, consent: false}, random: () => 0.5, startTemp: {state: 'ABSENT', valueC: null}, childContext: NOT_CHILD, creditExemption: null};
const build = (p) => M.buildScanProtocolDocument({createdAt: STAMP, ...NEW_INPUTS, ...p});

// ═══ ١ — readProtocolParts ═══
const PART_KEYS = ['purposes', 'batteryBeforeAfter', 'coldRepeat', 'returns', 'doubleEval', 'consent'];
{
  const none = M.readProtocolParts(undefined);
  deq(Object.keys(none).sort(), [...PART_KEYS].sort(), '[١] مفتاح لكل جزء من PROTOCOL_PART دائماً (ستّة)، ولو كان المستند غائباً');
  ok(Object.values(none).every((v) => v === false), '[١] مستند المالك غائب: كل الأجزاء false («الغائب غير مفعَّل»)');
  for (const bad of [null, 'x', 5, [], true]) {
    const r = M.readProtocolParts(bad);
    ok(Object.values(r).every((v) => v === false) && Object.keys(r).length === 6, `[١] مستند مالك بشكل ${JSON.stringify(bad)}: كلها false`);
  }
  deq(Object.values(M.readProtocolParts({})).filter(Boolean), [], '[١] مستند بلا protocolParts: كلها false');
  for (const bad of [null, 'purposes', ['purposes'], 1, true]) {
    ok(Object.values(M.readProtocolParts({protocolParts: bad})).every((v) => v === false), `[١] protocolParts بشكل ${JSON.stringify(bad)}: كلها false`);
  }
  eq(M.readProtocolParts({protocolParts: {purposes: true}}).purposes, true, '[١] purposes: true ⟵ مفعَّل');
  for (const notTrue of ['true', 'TRUE', 1, 'yes', {}, [], null, 0, false, undefined]) {
    eq(M.readProtocolParts({protocolParts: {purposes: notTrue}}).purposes, false, `[١] purposes بقيمة ${JSON.stringify(notTrue)} (ليست true بالضبط) ⟵ غير مفعَّل`);
  }
  const mixed = M.readProtocolParts({protocolParts: {purposes: true, consent: true, returns: 'true', unknownPart: true}});
  deq([mixed.purposes, mixed.consent, mixed.returns, mixed.batteryBeforeAfter, mixed.coldRepeat, mixed.doubleEval], [true, true, false, false, false, false], '[١] كل جزء مستقلّ');
  ok(!('unknownPart' in mixed), '[١] جزء لا تعرفه المفردات لا يمرّ إلى الناتج');
  const owner = {protocolParts: {purposes: true}};
  M.readProtocolParts(owner);
  deq(owner, {protocolParts: {purposes: true}}, '[١] لا تعدّل مدخلها');
}

// ═══ ٢ — decidePurposeAtCreation ═══
deq(M.decidePurposeAtCreation(M.readProtocolParts({protocolParts: {purposes: true}})), {purpose: 'normal', purposeSource: 'default'}, '[٢] الجزء مفعَّل: normal والمصدر default');
deq(M.decidePurposeAtCreation(M.readProtocolParts({})), {purpose: 'normal', purposeSource: 'feature_disabled'}, '[٢] الجزء غائب: normal والمصدر feature_disabled («المحلّ بلا تفعيل الغرض»)');
deq(M.decidePurposeAtCreation(M.readProtocolParts({protocolParts: {consent: true, returns: true}})), {purpose: 'normal', purposeSource: 'feature_disabled'}, '[٢] أجزاء أخرى مفعَّلة والأغراض لا: feature_disabled');
deq(M.decidePurposeAtCreation({purposes: 'true'}), {purpose: 'normal', purposeSource: 'feature_disabled'}, '[٢] قيمة غير true بالضبط ولو وصلت الدالّة مباشرة: feature_disabled');

// ═══ ٣ — buildScanProtocolDocument ═══
const doc = (p) => build(p).document;
const notes = (p) => build(p).notes;
const SESSION = (purpose) => ({isSessionScan: true, sessionData: {purpose}, pendingData: {purposeSource: 'selected'}});

// ٣-أ: بلا جلسة
{
  const r = build({isSessionScan: false, sessionData: null, pendingData: null});
  eq(r.document.scanPurpose, 'NO_SESSION', '[٣] فحص بلا جلسة: scanPurpose = NO_SESSION («خارج الجلسات»)');
  eq(r.document.purposeSource, null, '[٣] ومصدر الغرض null (لا ينطبق: لا غرض لجلسة غير موجودة)');
  deq(r.notes, [], '[٣] ولا ملاحظة (الحالة عادية)');
  eq(build({isSessionScan: false, sessionData: {purpose: 'battery_before'}, pendingData: {purposeSource: 'selected'}}).document.scanPurpose, 'NO_SESSION', '[٣] بلا جلسة: ما يحمله sessionData العالق لا يُقرأ (isSessionScan وحده يحكم)');
  eq(build({isSessionScan: false, sessionData: {purpose: 'battery_before'}, pendingData: {purposeSource: 'selected'}}).document.purposeSource, null, '[٣] ولا مصدر');
}
// ٣-ب: جلسة بغرض معروف ومصدر معروف — كل قيمة من القيم المعلنة × كل مصدر
for (const purpose of ['normal', 'battery_before', 'battery_after', 'repeat_cold', 'repeat_hot', 'repeat_unclassified']) {
  for (const source of ['default', 'selected', 'repeat_flow', 'feature_disabled']) {
    const r = build({isSessionScan: true, sessionData: {purpose}, pendingData: {purposeSource: source}});
    deq([r.document.scanPurpose, r.document.purposeSource, r.notes], [purpose, source, []], `[٣] جلسة ${purpose} + مصدر ${source}: تمرّ كما هي بلا ملاحظة`);
  }
}
// (2026-10-22، القاعدة 23: كان «ستّة» يثبّت الأغراض قبل أمر ربط «قبل/بعد صيانة»؛ استُبدل بثمانية: أُضيف maintenance_before وmaintenance_after إلى SCAN_PURPOSE فصارا معلَنَين في الجلسة؛ وbattery_* باقيتان قيمتَي قراءة تاريخيتين)
eq(M.SESSION_DECLARABLE_PURPOSES.length, 8, '[٣] ثمانية أغراض تُقبل غرضاً معلَناً في الجلسة');
deq([...M.SESSION_DECLARABLE_PURPOSES].sort(), ['battery_after', 'battery_before', 'maintenance_after', 'maintenance_before', 'normal', 'repeat_cold', 'repeat_hot', 'repeat_unclassified'], '[٣] وهي كل ما في SCAN_PURPOSE عدا حالتَي الغياب (NO_SESSION وUNDECLARED)');
// ٣-ج: الغرض غائب أو مجهول ⟵ UNDECLARED (لا «عادي» صامتاً) — القاعدة 22
for (const [label, sessionData] of [['sessionData null', null], ['بلا حقل purpose', {}], ['purpose undefined', {purpose: undefined}], ['purpose null', {purpose: null}], ['sessionData نصّ', 'x']]) {
  const r = build({isSessionScan: true, sessionData, pendingData: {purposeSource: 'default'}});
  deq([r.document.scanPurpose, r.document.purposeSource, r.notes], ['UNDECLARED', null, ['PURPOSE_ABSENT']], `[٣] ${label}: UNDECLARED ومصدر null وملاحظة PURPOSE_ABSENT (لا «normal» صامتاً)`);
}
for (const [label, purpose] of [['نصّ لا تعرفه المفردات', 'technician_check'], ['فارغ', ''], ['أحرف مختلفة', 'Normal'], ['رقم', 5], ['كائن', {a: 1}], ['منطقي', true], ['NO_SESSION مخزَّنة في الجلسة', 'NO_SESSION'], ['UNDECLARED مخزَّنة في الجلسة', 'UNDECLARED']]) {
  const r = build({isSessionScan: true, sessionData: {purpose}, pendingData: {purposeSource: 'selected'}});
  deq([r.document.scanPurpose, r.document.purposeSource, r.notes], ['UNDECLARED', null, ['PURPOSE_NOT_RECOGNIZED']], `[٣] غرض ${label}: UNDECLARED بملاحظة PURPOSE_NOT_RECOGNIZED (لا يُلحَق بأقرب قيمة، ولا يُنسب له مصدر)`);
}
// ٣-د: المصدر غائب أو مجهول مع غرض معروف
for (const [label, pendingData] of [['pendingData null', null], ['بلا purposeSource', {}], ['purposeSource null', {purposeSource: null}], ['purposeSource undefined', {purposeSource: undefined}]]) {
  const r = build({isSessionScan: true, sessionData: {purpose: 'battery_before'}, pendingData});
  deq([r.document.scanPurpose, r.document.purposeSource, r.notes], ['battery_before', null, ['PURPOSE_SOURCE_ABSENT']], `[٣] ${label}: الغرض يبقى والمصدر null وملاحظة PURPOSE_SOURCE_ABSENT (لا مصدر مختلَق)`);
}
for (const [label, source] of [['نصّ مجهول', 'chosen'], ['فارغ', ''], ['رقم', 1], ['أحرف مختلفة', 'Selected']]) {
  const r = build({isSessionScan: true, sessionData: {purpose: 'normal'}, pendingData: {purposeSource: source}});
  deq([r.document.scanPurpose, r.document.purposeSource, r.notes], ['normal', null, ['PURPOSE_SOURCE_NOT_RECOGNIZED']], `[٣] مصدر ${label}: null وملاحظة PURPOSE_SOURCE_NOT_RECOGNIZED`);
}
{
  // الغرض المجهول لا يُفحص مصدره (لا غرض ينسب إليه)، فلا ملاحظة مصدر إضافية
  const r = build({isSessionScan: true, sessionData: {purpose: 'zzz'}, pendingData: null});
  deq(r.notes, ['PURPOSE_NOT_RECOGNIZED'], '[٣] غرض مجهول ومصدر غائب: ملاحظة الغرض وحدها');
}
// ٣-هـ: ما لا يتغيّر بحسب الحالة
for (const p of [{isSessionScan: false, sessionData: null, pendingData: null}, SESSION('normal'), SESSION(undefined), SESSION('zzz')]) {
  const d = doc(p);
  deq([d.linkedScanId, d.linkState, d.linkMethod], [null, 'none', null], '[٣] الربط: linkedScanId null وlinkState none وlinkMethod null في كل حالة (P6-05 يبنيه لاحقاً)');
  deq([d.protocolVersion, d.settingsVersion], [1, 'SETTINGS_ABSENT'], '[٣] protocolVersion = 1 وsettingsVersion = SETTINGS_ABSENT حين لا إعدادات (مستند protocolSettings غائب)');
}

// ═══ ٤ — شكل المستند ═══
{
  const d = doc(SESSION('battery_before'));
  // (2026-10-22، القاعدة 23: كان يثبّت ثلاثة عشر مفتاحاً؛ استُبدل بخمسة عشر: أُضيف defectType وpair بأمر ربط «قبل/بعد صيانة»، A2 وA3)
  deq(Object.keys(d), ['scanPurpose', 'purposeSource', 'linkedScanId', 'linkState', 'linkMethod', 'protocolVersion', 'settingsVersion', 'repeat', 'repeatOf', 'repeatClassification', 'creditExemption', 'consent', 'defectType', 'pair', 'linkModelCheck', 'createdAt'], '[٤] ستّة عشر مفتاحاً بالضبط وبهذا الترتيب (الخمسة عشر القائمة + linkModelCheck من ق36 أ، 2026-10-22؛ القاعدة 23: كانت خمسة عشر) بلا هوية ولا ملاحظات');
  eq(d.createdAt, STAMP, '[٤] createdAt هو ما مُرِّر (لا وقت يُختلق في الدالّة النقيّة)');
  for (const forbidden of ['deviceId', 'identityState', 'matchedBy', 'notes', 'identityRuleVersion']) ok(!(forbidden in d), `[٤] لا ${forbidden} في المستند (S-P6-01 معلّقة)`);
  ok(Object.values(d).every((v) => v !== undefined), '[٤] لا قيمة undefined في المستند (Firestore يرفضها، والغياب حالة صريحة)');
  throwsWith(() => M.buildScanProtocolDocument({isSessionScan: true, sessionData: {purpose: 'normal'}, pendingData: {purposeSource: 'default'}}), /createdAt غائب/, '[٤] createdAt غير مُمرَّر ⟵ خطأ (لا قيمة افتراضية)');
  eq(M.buildScanProtocolDocument({isSessionScan: false, createdAt: undefined, ...NEW_INPUTS}).document.createdAt, undefined, '[٤] وحضور المفتاح (ولو undefined) يعبر: غياب المفتاح وحده هو الخطأ');
  for (const bad of [undefined, null, 'true', 1, 0]) {
    throwsWith(() => M.buildScanProtocolDocument({isSessionScan: bad, createdAt: STAMP}), /isSessionScan غائب أو ليس منطقياً/, `[٤] isSessionScan = ${JSON.stringify(bad)} ⟵ خطأ (لا تُقرأ حالة «بلا جلسة» من غياب)`);
  }
  throwsWith(() => M.buildScanProtocolDocument(undefined), /isSessionScan/, '[٤] بلا معطيات ⟵ خطأ');
  // الدالّة لا تعدّل مدخلاتها
  const sd = {purpose: 'battery_after', other: 1};
  const pd = {purposeSource: 'selected'};
  build({isSessionScan: true, sessionData: sd, pendingData: pd});
  deq([sd, pd], [{purpose: 'battery_after', other: 1}, {purposeSource: 'selected'}], '[٤] لا تعدّل مدخلاتها');
  ok(Object.isFrozen(M.PROTOCOL_NOTE) && Object.isFrozen(M.SESSION_DECLARABLE_PURPOSES), '[٤] PROTOCOL_NOTE وSESSION_DECLARABLE_PURPOSES مجمَّدان');
  // (2026-10-22، القاعدة 23: كان يثبّت ستّ ملاحظات؛ استُبدل بإحدى عشرة: أُضيفت من maintenancePair.PAIR_NOTE خمس (DEFECT_TYPE_ABSENT · DEFECT_TYPE_NOT_RECOGNIZED في S3، وPAIR_LINK_NOT_CHOSEN · PAIR_LINK_NOT_RECOGNIZED · LINK_TARGET_LOST في S5))
  deq(Object.values(M.PROTOCOL_NOTE).sort(), ['CONSENT_NOT_RECOGNIZED', 'DEFECT_TYPE_ABSENT', 'DEFECT_TYPE_NOT_RECOGNIZED', 'LINK_TARGET_LOST', 'PAIR_LINK_NOT_CHOSEN', 'PAIR_LINK_NOT_RECOGNIZED', 'PAIR_OWNER_ABSENT', 'PURPOSE_ABSENT', 'PURPOSE_NOT_RECOGNIZED', 'PURPOSE_SOURCE_ABSENT', 'PURPOSE_SOURCE_NOT_RECOGNIZED', 'REPEAT_UNCLASSIFIED'], '[٤] اثنتا عشرة ملاحظة مسمّاة (تُطبَع ولا تُكتب؛ S8: +PAIR_OWNER_ABSENT: القاعدة 23)');
}
// ═══ ٤-ج — (S3، أمر ربط «قبل/بعد صيانة» 2026-10-22): نوع العطل وفتح الزوج في مستند scanProtocol ═══
{
  const MAINT = (purpose, type) => ({isSessionScan: true, sessionData: {purpose, ownerId: 'owner-1'}, pendingData: {purposeSource: 'selected', ...(type === undefined ? {} : {defectType: type})}});
  const TYPES = ['BATTERY', 'CHARGING_PORT', 'THERMAL', 'MOTHERBOARD', 'SOFTWARE'];
  // maintenance_before: نوع العطل من protocolPending، وpair مفتوح بالوسم نفسه الذي في createdAt
  for (const t of TYPES) {
    const r = build(MAINT('maintenance_before', t));
    deq([r.document.scanPurpose, r.document.purposeSource, r.document.defectType, r.notes], ['maintenance_before', 'selected', t, []], `[٤-ج] maintenance_before + ${t}: الغرض والنوع بلا ملاحظة`);
    deq(r.document.pair, {state: 'OPEN', ownerId: 'owner-1', openedAt: STAMP}, `[٤-ج] maintenance_before + ${t}: pair = {state: OPEN, openedAt, ownerId} (كائن بثلاثة مفاتيح لا غير؛ S8: ownerId = ownerId مستند الجلسة)`);
    eq(r.document.pair.openedAt, r.document.createdAt, '[٤-ج] openedAt هو الوسم نفسه الذي في createdAt (وقت خادم واحد)');
    deq(Object.keys(r.document.pair), ['state', 'openedAt', 'ownerId'], '[٤-ج] لا expiresAt مخزَّن (المدّة تُقرأ من الإعداد عند القراءة) ولا completedByScanId عند الفتح');
  }
  // maintenance_after: نوع العطل، وpair null صريح (الزوج يُفتح على «قبل» وحده)
  for (const t of TYPES) {
    const r = build(MAINT('maintenance_after', t));
    deq([r.document.scanPurpose, r.document.defectType, r.document.pair, r.notes], ['maintenance_after', t, null, ['PAIR_LINK_NOT_CHOSEN']], `[٤-ج] maintenance_after + ${t}: النوع ثابت وpair null صريح، وبلا ربط مؤكَّد ملاحظة PAIR_LINK_NOT_CHOSEN (S5)`);
    deq([r.document.linkedScanId, r.document.linkState, r.document.linkMethod], [null, 'none', null], '[٤-ج] والربط none حتى يحسمه الاكتمال (S5)');
  }
  // غير الصيانة: defectType null وpair null صريحان (ولو حمل protocolPending نوعاً: النوع يتبع الغرض الحاضر)
  for (const p of [SESSION('normal'), {isSessionScan: true, sessionData: {purpose: 'normal'}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY'}},
    {isSessionScan: true, sessionData: {purpose: 'battery_before'}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY'}}, SESSION('battery_after'), SESSION('repeat_cold'),
    {isSessionScan: false, sessionData: null, pendingData: null}, SESSION(undefined), SESSION('zzz')]) {
    const r = build(p);
    deq([r.document.defectType, r.document.pair], [null, null], `[٤-ج] غرض ${r.document.scanPurpose}: defectType وpair null صريحان (حقلان حاضران دائماً)`);
    ok('defectType' in r.document && 'pair' in r.document, '[٤-ج] والمفتاحان حاضران في المستند (لا غياب)');
  }
  // الغياب حالة صريحة: نوع غائب أو مجهول لفحص صيانة ⟵ null بملاحظة مسمّاة، ولا نوع مختلَق
  for (const [label, pendingData] of [['pendingData null', null], ['بلا defectType', {purposeSource: 'selected'}], ['defectType null', {purposeSource: 'selected', defectType: null}], ['defectType undefined', {purposeSource: 'selected', defectType: undefined}]]) {
    for (const purpose of ['maintenance_before', 'maintenance_after']) {
      const r = build({isSessionScan: true, sessionData: {purpose, ownerId: 'owner-1'}, pendingData});
      const wantNotes = [...(pendingData === null ? ['PURPOSE_SOURCE_ABSENT'] : []), 'DEFECT_TYPE_ABSENT', ...(purpose === 'maintenance_after' ? ['PAIR_LINK_NOT_CHOSEN'] : [])];
      deq([r.document.defectType, r.notes], [null, wantNotes], `[٤-ج] ${purpose} و${label}: النوع null وملاحظة DEFECT_TYPE_ABSENT (لا نوع مختلَق)`);
    }
  }
  for (const [label, bad] of [['نصّ خارج القائمة', 'OTHER'], ['أحرف صغيرة', 'battery'], ['فارغ', ''], ['رقم', 3], ['كائن', {a: 1}], ['مصفوفة', ['BATTERY']]]) {
    const r = build({isSessionScan: true, sessionData: {purpose: 'maintenance_before', ownerId: 'owner-1'}, pendingData: {purposeSource: 'selected', defectType: bad}});
    deq([r.document.defectType, r.notes], [null, ['DEFECT_TYPE_NOT_RECOGNIZED']], `[٤-ج] نوع ${label}: null وملاحظة DEFECT_TYPE_NOT_RECOGNIZED (لا يُلحَق بأقرب قيمة)`);
    ok(!JSON.stringify(r.notes).includes(String(bad)) || bad === '', '[٤-ج] والقيمة الخام لا تدخل الملاحظة');
    deq(r.document.pair, {state: 'OPEN', ownerId: 'owner-1', openedAt: STAMP}, '[٤-ج] والزوج يُفتح رغم النوع المجهول (الشذوذ يُعلَن ولا يُسقط الفحص)');
  }
  // فحص بغرض صيانة وغرض مجهول المصدر: لا يمنع النوع
  {
    const r = build({isSessionScan: true, sessionData: {purpose: 'maintenance_after'}, pendingData: {defectType: 'THERMAL'}});
    deq([r.document.purposeSource, r.document.defectType, r.notes], [null, 'THERMAL', ['PURPOSE_SOURCE_ABSENT', 'PAIR_LINK_NOT_CHOSEN']], '[٤-ج] مصدر الغرض غائب: يبقى النوع والملاحظة مسمّاة');
  }
  // الابن (التكرار) لا زوج له ولا نوع
  {
    const child = {isChild: true, parentSessionId: 'p', parentScanId: 's', reference: {state: 'SET', valueC: 30}, startedBeforeCooling: null};
    // (ق14، القاعدة 23) الابن يُمرَّر له parentProtocolData صراحةً (null = مستند الأمّ غائب)
    const r = build({isSessionScan: true, sessionData: {}, pendingData: {purposeSource: 'repeat_flow', defectType: 'BATTERY'}, childContext: child, parentProtocolData: null, startTemp: {state: 'SET', valueC: 30}});
    deq([r.document.defectType, r.document.pair], [null, null], '[٤-ج] فحص الابن: لا نوع ولا زوج (ولو حمل pending نوعاً)');
  }
  // (S8) مالك الزوج: ownerId مستند الجلسة وقت الفتح، يُكتب داخل pair وحده (لا مفتاح علوي جديد)؛ غير النصّ غير الفارغ ⟵ null صريح وملاحظة PAIR_OWNER_ABSENT (pair غير مقروء، لا يُرشَّح ولا يُؤكَّد: القاعدة 22)
  {
    const withOwner = (ownerId) => ({isSessionScan: true, sessionData: {purpose: 'maintenance_before', ownerId}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY'}});
    const r = build(withOwner('shop-5'));
    deq([r.document.pair, r.notes], [{state: 'OPEN', openedAt: STAMP, ownerId: 'shop-5'}, []], '[٤-ج] (S8) ownerId الجلسة يُكتب في pair كما هو (لا مالك مختلَق ولا ثابت)');
    deq(Object.keys(r.document), ['scanPurpose', 'purposeSource', 'linkedScanId', 'linkState', 'linkMethod', 'protocolVersion', 'settingsVersion', 'repeat', 'repeatOf', 'repeatClassification', 'creditExemption', 'consent', 'defectType', 'pair', 'linkModelCheck', 'createdAt'], '[٤-ج] (S8) والمستند ستّة عشر مفتاحاً كما هو (ق36 أ، القاعدة 23: كان خمسة عشر): ownerId داخل pair لا مفتاح علوي');
    for (const [label, bad] of [['غائب', undefined], ['null', null], ['فارغ', ''], ['رقم', 7], ['كائن', {}], ['مصفوفة', ['a']]]) {
      const x = build(withOwner(bad));
      deq([x.document.pair, x.notes], [{state: 'OPEN', openedAt: STAMP, ownerId: null}, ['PAIR_OWNER_ABSENT']], `[٤-ج] (S8) ownerId الجلسة ${label} ⟵ pair بـownerId = null صريح وملاحظة PAIR_OWNER_ABSENT (الزوج يُفتح ولا يُخمَّن المالك)`);
    }
    const noSession = build({isSessionScan: true, sessionData: null, pendingData: null});
    ok(noSession.document.pair === null && !noSession.notes.includes('PAIR_OWNER_ABSENT'), '[٤-ج] (S8) جلسة بلا مستند ⟵ لا زوج ولا ملاحظة مالك');
    const after = build({isSessionScan: true, sessionData: {purpose: 'maintenance_after'}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY'}});
    ok(after.document.pair === null && !after.notes.includes('PAIR_OWNER_ABSENT'), '[٤-ج] (S8) maintenance_after بلا ownerId ⟵ لا ملاحظة مالك (المالك يخصّ «قبل» وحدها)');
    const normal = build({isSessionScan: true, sessionData: {purpose: 'normal'}, pendingData: {purposeSource: 'selected'}});
    ok(normal.document.pair === null && !normal.notes.includes('PAIR_OWNER_ABSENT'), '[٤-ج] (S8) normal بلا ownerId ⟵ لا ملاحظة مالك');
  }
  // (ق36 أ، 2026-10-22؛ القاعدة 23: كان المستند خمسة عشر مفتاحاً) linkModelCheck: **null صريح** عند البناء لكل فحص بكل غرض (لا مقارنة طراز قبل أن يُحلّ هدف الربط؛ والمعاملة وحدها تكتب الحالة)، والمفتاح حاضر دائماً (القاعدة 22)
  for (const [label, input] of [
    ['normal', SESSION('normal')], ['maintenance_before', MAINT('maintenance_before', 'BATTERY')], ['maintenance_after بلا ربط', MAINT('maintenance_after', 'BATTERY')],
    ['maintenance_after بربط مؤكَّد', {isSessionScan: true, sessionData: {purpose: 'maintenance_after', ownerId: 'owner-1'}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY', linkedScanId: 'before-9', linkMethod: 'manual'}}],
    ['فحص بلا جلسة', {isSessionScan: false, sessionData: null, pendingData: null}],
  ]) {
    const r = build(input);
    ok(Object.prototype.hasOwnProperty.call(r.document, 'linkModelCheck') && r.document.linkModelCheck === null, `[٤-ج] (ق36 أ) ${label}: linkModelCheck مفتاح حاضر وقيمته null صريحة عند البناء`);
    eq(Object.keys(r.document).length, 16, `[٤-ج] (ق36 أ) ${label}: ستّة عشر مفتاحاً`);
  }
  // createdAt المُمرَّر وحده يغذّي openedAt (لا وقت يُختلق)
  {
    const OTHER_STAMP = {__stamp: 'other'};
    const r = M.buildScanProtocolDocument({createdAt: OTHER_STAMP, ...NEW_INPUTS, ...MAINT('maintenance_before', 'THERMAL')});
    eq(r.document.pair.openedAt, OTHER_STAMP, '[٤-ج] openedAt = createdAt المُمرَّر نفسه');
  }
  // الدالّة لا تعدّل مدخلاتها
  {
    const pd = {purposeSource: 'selected', defectType: 'BATTERY'};
    const sd = {purpose: 'maintenance_before'};
    build({isSessionScan: true, sessionData: sd, pendingData: pd});
    deq([sd, pd], [{purpose: 'maintenance_before'}, {purposeSource: 'selected', defectType: 'BATTERY'}], '[٤-ج] لا تعدّل مدخلاتها');
  }
}
// ═══ ٤-د — (S5، 2026-10-22) نيّة الربط pairLink لفحص «بعد»: الربط نفسه يُحسم في معاملة الكتابة، فالمستند يُبنى بلا ربط ═══
{
  const AFTER = (pendingData) => ({isSessionScan: true, sessionData: {purpose: 'maintenance_after'}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY', ...pendingData}});
  // مختار: المعرّف يصل الكاتب، والمستند لا يحمل ربطاً بعد
  {
    const r = build(AFTER({linkedScanId: 'before-9', linkMethod: 'manual'}));
    deq(r.pairLink, {state: 'CHOSEN', beforeScanId: 'before-9'}, '[٤-د] maintenance_after وفي pending ربط manual ⟵ pairLink = CHOSEN ومعه معرّف «قبل»');
    deq([r.document.linkedScanId, r.document.linkState, r.document.linkMethod], [null, 'none', null], '[٤-د] **والمستند يُبنى بلا ربط** (الربط يكتبه قرار الاكتمال داخل المعاملة)');
    deq(r.notes, [], '[٤-د] ولا ملاحظة مع ربط مؤكَّد');
  }
  // لا اختيار ⟵ NONE بملاحظة
  for (const [label, pd] of [['بلا linkedScanId', {}], ['linkedScanId null', {linkedScanId: null, linkMethod: null}]]) {
    const r = build(AFTER(pd));
    deq([r.pairLink, r.notes], [{state: 'NONE', beforeScanId: null}, ['PAIR_LINK_NOT_CHOSEN']], `[٤-د] ${label} ⟵ لا ربط مختار وملاحظة PAIR_LINK_NOT_CHOSEN`);
  }
  // شكل لا يُقرأ ⟵ NONE بملاحظة PAIR_LINK_NOT_RECOGNIZED
  for (const [label, pd] of [['linkMethod غائب', {linkedScanId: 'b'}], ['auto_confirmed', {linkedScanId: 'b', linkMethod: 'auto_confirmed'}], ['معرّف رقم', {linkedScanId: 4, linkMethod: 'manual'}], ['معرّف فارغ', {linkedScanId: '', linkMethod: 'manual'}]]) {
    const r = build(AFTER(pd));
    deq([r.pairLink, r.notes], [{state: 'NONE', beforeScanId: null}, ['PAIR_LINK_NOT_RECOGNIZED']], `[٤-د] ${label} ⟵ لا ربط وملاحظة PAIR_LINK_NOT_RECOGNIZED (لا يُخمَّن)`);
  }
  // الملاحظات بترتيبها: نوع «بعد» ثم الربط
  deq(build({isSessionScan: true, sessionData: {purpose: 'maintenance_after'}, pendingData: {purposeSource: 'selected'}}).notes, ['DEFECT_TYPE_ABSENT', 'PAIR_LINK_NOT_CHOSEN'], '[٤-د] ترتيب الملاحظات: DEFECT_TYPE_ABSENT قبل PAIR_LINK_NOT_CHOSEN');
  // غير «بعد»: NONE بلا ملاحظة ولو حمل pending ربطاً عالقاً (الربط يتبع الغرض الحاضر)
  for (const purpose of ['maintenance_before', 'normal', 'battery_after', 'battery_before', 'repeat_cold']) {
    const r = build({isSessionScan: true, sessionData: {purpose}, pendingData: {purposeSource: 'selected', defectType: 'BATTERY', linkedScanId: 'stale-before', linkMethod: 'manual'}});
    deq(r.pairLink, {state: 'NONE', beforeScanId: null}, `[٤-د] غرض ${purpose} وفي pending ربط عالق ⟵ NONE (الربط لـmaintenance_after وحده)`);
    ok(!r.notes.includes('PAIR_LINK_NOT_CHOSEN') && !r.notes.includes('PAIR_LINK_NOT_RECOGNIZED'), `[٤-د] ${purpose}: ولا ملاحظة ربط`);
  }
  deq(build({isSessionScan: false, sessionData: null, pendingData: null}).pairLink, {state: 'NONE', beforeScanId: null}, '[٤-د] بلا جلسة ⟵ NONE');
  deq(build(SESSION(undefined)).pairLink, {state: 'NONE', beforeScanId: null}, '[٤-د] جلسة بلا غرض ⟵ NONE');
  deq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose: 'maintenance_after'}}), 'maintenance_after', '[٤-د] وفحص «بعد» ممنوع من إعادة الاستعمال');
}
// ═══ ٤-ب — S-P6-07: settingsVersion من الإعدادات، والمُدخلات الجديدة صريحة، والابن والأمّ ═══
{
  const present = {state: 'PRESENT', version: 3, data: {version: 3}, anomaly: null};
  eq(doc({...SESSION('normal'), settings: present}).settingsVersion, 3, '[٤-ب] settingsVersion = رقم نسخة الإعدادات الحاضرة (استُبدل الثابت SETTINGS_ABSENT الدائم: القاعدة 23)');
  eq(doc({...SESSION('normal'), settings: ABSENT_SETTINGS}).settingsVersion, 'SETTINGS_ABSENT', '[٤-ب] والإعدادات الغائبة ⟵ SETTINGS_ABSENT');
  // كل مُدخل جديد غيابه خطأ صريح لا افتراضي (القاعدة 22)
  for (const k of ['settings', 'parts', 'random', 'startTemp', 'childContext']) {
    const p = {...NEW_INPUTS};
    delete p[k];
    throwsWith(() => M.buildScanProtocolDocument({createdAt: STAMP, isSessionScan: false, ...p}), new RegExp(k + ' غائب'), `[٤-ب] ${k} غير مُمرَّر ⟵ خطأ (لا قيمة افتراضية)`);
  }
  {
    const p = {...NEW_INPUTS};
    delete p.creditExemption;
    throwsWith(() => M.buildScanProtocolDocument({createdAt: STAMP, isSessionScan: false, ...p}), /creditExemption غائب/, '[٤-ب] creditExemption غير مُمرَّر ⟵ خطأ');
    throwsWith(() => M.buildScanProtocolDocument({createdAt: STAMP, isSessionScan: false, ...NEW_INPUTS, creditExemption: 5}), /creditExemption غائب أو ليس نصّاً/, '[٤-ب] creditExemption رقم ⟵ خطأ');
  }
  // الفحص العادي: لا ابن
  {
    const d = doc(SESSION('normal'));
    deq([d.repeatOf, d.repeatClassification, d.creditExemption], [null, null, null], '[٤-ب] فحص غير ابن: repeatOf وrepeatClassification null («لا ينطبق»)، وcreditExemption null (خُصمت الفحصة عادياً)');
    eq(d.repeat.state, 'NOT_ELIGIBLE', '[٤-ب] سجلّ repeat حاضر دائماً بحالة صريحة (هنا: إعدادات غائبة)');
  }
  // الابن: غرضه من التصنيف ومصدره repeat_flow، والربط بالأمّ، والملاحظة عند عدم التصنيف
  {
    const child = (reference, second, extra = {}) => build({
      isSessionScan: true, sessionData: {ownerId: 'o', joinedBy: 'j'}, pendingData: {purposeSource: 'repeat_flow'},
      childContext: {isChild: true, parentSessionId: 'P-S', parentScanId: 'P-C', reference, startedBeforeCooling: false}, parentProtocolData: null, startTemp: second, ...extra, // (ق14) parentProtocolData صريح للابن
    });
    const cold = child({state: 'PRESENT', valueC: 32.8}, {state: 'PRESENT', valueC: 33.5});
    deq([cold.document.scanPurpose, cold.document.purposeSource, cold.notes], ['repeat_cold', 'repeat_flow', []], '[٤-ب] الابن بارد: الغرض من التصنيف ومصدره repeat_flow بلا ملاحظة');
    deq(cold.document.repeatOf, {sessionId: 'P-S', scanId: 'P-C'}, '[٤-ب] repeatOf: الأمّ');
    deq(cold.document.repeatClassification, {absence: null, firstScanStartTemp: {state: 'PRESENT', valueC: 32.8}, secondScanStartTemp: {state: 'PRESENT', valueC: 33.5}, deltaC: 0.7, thresholdC: 1, startedBeforeCooling: false}, '[٤-ب] repeatClassification: الخام والفرق والعتبة وإعلان الفنّي');
    eq(cold.classification.purpose, 'repeat_cold', '[٤-ب] ويعيد التصنيف للمستدعي (تحديث الأمّ)');
    const hot = child({state: 'PRESENT', valueC: 32.8}, {state: 'PRESENT', valueC: 34.0});
    eq(hot.document.scanPurpose, 'repeat_hot', '[٤-ب] الابن ساخن');
    const noRef = child({state: 'ABSENT', valueC: null}, {state: 'PRESENT', valueC: 33});
    deq([noRef.document.scanPurpose, noRef.notes, noRef.document.repeatClassification.absence], ['repeat_unclassified', ['REPEAT_UNCLASSIFIED:COOLING_REFERENCE_ABSENT'], 'COOLING_REFERENCE_ABSENT'], '[٤-ب] الأولى غائبة ⟵ repeat_unclassified بسبب COOLING_REFERENCE_ABSENT (لا بارد)');
    const noSecond = child({state: 'PRESENT', valueC: 32.8}, {state: 'SENTINEL_ZERO', valueC: 0});
    deq([noSecond.document.scanPurpose, noSecond.document.repeatClassification.absence], ['repeat_unclassified', 'SECOND_START_TEMP_ABSENT'], '[٤-ب] الثانية صفر الحارس ⟵ repeat_unclassified بسبب SECOND_START_TEMP_ABSENT');
    eq(cold.document.repeat.state, 'NOT_ELIGIBLE', '[٤-ب] والابن نفسه لا يُختار لتكرار آخر (سجلّ repeat حاضر بحالة صريحة)');
    eq(child({state: 'PRESENT', valueC: 32.8}, {state: 'PRESENT', valueC: 33}, {creditExemption: 'PROTOCOL_EXEMPT'}).document.creditExemption, 'PROTOCOL_EXEMPT', '[٤-ب] creditExemption كما مُرِّر');
  }
  // protocolReuseBlockedReason
  eq(M.protocolReuseBlockedReason({childContext: {isChild: true}, classification: {purpose: 'repeat_cold'}, sessionData: null}), 'repeat_cold', '[٤-ب] الابن: سبب المنع هو غرضه المصنَّف');
  eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose: 'battery_after'}}), 'battery_after', '[٤-ب] جلسة battery_after: ممنوعة (P:405)');
  eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose: 'maintenance_after'}}), 'maintenance_after', '[٤-ب] (2026-10-22، A3 البند ٤) جلسة maintenance_after: ممنوعة (فحص «بعد الصيانة» قياس جديد) والسبب قيمة الغرض نفسها');
  eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose: 'maintenance_before'}}), null, '[٤-ب] جلسة maintenance_before: لا منع (كما battery_before)');
  eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose: 'Maintenance_After'}}), null, '[٤-ب] أحرف مختلفة: ليست الغرض (لا تُلحَق بأقرب قيمة)');
  for (const purpose of ['normal', 'battery_before', undefined, 'repeat_cold']) {
    eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: {purpose}}), null, `[٤-ب] جلسة غير ابن بغرض ${purpose}: لا منع (س١١: الفحوص البروتوكولية وحدها؛ والابن يُعرَف بسياقه لا بغرض الجلسة)`);
  }
  eq(M.protocolReuseBlockedReason({childContext: NOT_CHILD, classification: null, sessionData: null}), null, '[٤-ب] بلا جلسة: لا منع');
}
function throwsWith(fn, re, m) {
  let e = null;
  try { fn(); } catch (x) { e = x; }
  ok(e && re.test(e.message), `${m} (${e ? e.message : 'لم يرمِ'})`);
}

// ═══ ٤-ج — الموافقة (S-P6-12) ═══
{
  const T0 = {toMillis: () => 1760000000000};
  const REC = {state: 'accepted', textVersion: 1, locale: 'tr', acceptedAt: T0};
  const NC = {state: 'not_collected', textVersion: null, locale: null, acceptedAt: null};
  const withPending = (pendingData) => build({...SESSION('normal'), pendingData: {purposeSource: 'default', ...pendingData}});
  const r1 = withPending({consent: REC});
  deq([r1.document.consent, r1.consent, r1.notes], [REC, {state: 'accepted', basis: 'RECORDED'}, []], '[٤-ج] جلسة بسجلّ موافقة مقروء ⟵ يُنسخ إلى scanProtocol.consent بمفاتيحه الأربعة، وأساسه RECORDED، بلا ملاحظة');
  const r2 = withPending({});
  deq([r2.document.consent, r2.consent, r2.notes], [NC, {state: 'not_collected', basis: 'NOT_RECORDED'}, []], '[٤-ج] جلسة بلا سجلّ (تطبيق قديم) ⟵ not_collected بالمفاتيح الأربعة (الغياب null صريح)، وأساسه NOT_RECORDED، **بلا ملاحظة** (حالة متوقَّعة)');
  const r3 = build({isSessionScan: false, sessionData: null, pendingData: null});
  deq([r3.document.consent, r3.consent], [NC, {state: 'not_collected', basis: 'NO_SESSION'}], '[٤-ج] فحص بلا جلسة ⟵ not_collected، وأساسه NO_SESSION');
  const r3b = build({isSessionScan: false, sessionData: null, pendingData: {consent: REC}});
  eq(r3b.consent.basis, 'NO_SESSION', '[٤-ج] وما يحمله pendingData العالق لا يُقرأ لفحص بلا جلسة');
  for (const [label, bad] of [['declined', {...REC, state: 'declined'}], ['نسخة لا يعرفها الخادم (الحالية + 1، مشتقّة من الثابت لا رقم حرفي: كان 2 حين كانت الحالية 1 — القاعدة 23)', {...REC, textVersion: require('../src/protocol/protocolVocabulary').CONSENT_TEXT_VERSION + 1}], ['لغة مجهولة', {...REC, locale: 'en'}], ['وقت غائب', {...REC, acceptedAt: undefined}], ['ليس كائناً', 'accepted']]) {
    const r = withPending({consent: bad});
    deq([r.document.consent, r.consent, r.notes], [NC, {state: 'not_collected', basis: 'UNREADABLE'}, ['CONSENT_NOT_RECOGNIZED']], `[٤-ج] مخزَّن ${label} ⟵ not_collected وأساسه UNREADABLE وملاحظة CONSENT_NOT_RECOGNIZED (لا يُقرأ موافقةً، ويُعلَن)`);
  }
  const r4 = build({...SESSION('normal'), pendingData: {consent: REC, doubleEvalDraw: {selected: true}, purposeSource: 'selected'}});
  deq([r4.document.consent, r4.document.purposeSource], [REC, 'selected'], '[٤-ج] ومعه حقول protocolPending الأخرى: كلٌّ يُقرأ لحقله');
  ok(r1.document.consent !== REC && r1.document.consent.acceptedAt === T0, '[٤-ج] السجلّ المنسوخ كائن جديد بالوقت نفسه (لا مشاركة مرجع مع protocolPending)');
  deq(Object.keys(r1.document.consent), ['state', 'textVersion', 'locale', 'acceptedAt'], '[٤-ج] مفاتيح السجلّ الأربعة بالترتيب');
  deq(Object.keys(r2.document.consent), Object.keys(r1.document.consent), '[٤-ج] وغير المجموعة بالمفاتيح نفسها (قارئ واحد)');
}

// ═══ ٥ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const SRC = path.join(__dirname, '..', 'src', 'protocol', 'scanProtocolDocument.js');
const code = strip(fs.readFileSync(SRC, 'utf8'));
// (2026-10-22، القاعدة 23: كان يثبّت خمسة مستورَدات؛ استُبدل بستّة: أُضيف ./maintenancePair — وحدة نقيّة كذلك)
deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]), ['./protocolVocabulary', './protocolSettings', './repeatScan', './consent', './protocolCorrection', './maintenancePair'], '[٥] ستّة مستورَدات نقيّة: protocolVocabulary وprotocolSettings وrepeatScan وconsent وprotocolCorrection وmaintenancePair (لا Firestore ولا admin ولا I/O)');
ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|\.get\(|\.set\(|\.add\(|\.update\(/.test(code), '[٥] لا قراءة ولا كتابة ولا حذف (القاعدة 42؛ الدالّة نقيّة)');
deq(Object.keys(M).sort(), ['PROTOCOL_NOTE', 'SESSION_DECLARABLE_PURPOSES', 'buildScanProtocolDocument', 'decidePurposeAtCreation', 'protocolReuseBlockedReason', 'readProtocolParts'], '[٥] التصدير: لا أسماء حقول (E36: تُكتب حرفيّةً في هذا الملفّ وحده)');
ok(!/["'`](normal|battery_before|battery_after|repeat_cold|repeat_hot|default|selected|feature_disabled|none|NO_SESSION|UNDECLARED|SETTINGS_ABSENT)["'`]/.test(code), '[٥] لا حرفيّة مفردة (غرض/مصدر/حالة) في الشيفرة: كلّها من protocolVocabulary (القاعدة 24)');
ok(!/deviceId|identityState|matchedBy/.test(code), '[٥] لا حقول هوية (S-P6-01 معلّقة)');

console.log(`\nscanProtocolDocument.test.js: ${n}/${n} assertions passed`);
