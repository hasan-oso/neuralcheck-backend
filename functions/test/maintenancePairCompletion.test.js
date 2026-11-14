'use strict';

// maintenancePairCompletion.test.js — اكتمال «بعد» في معاملة analyzeDevice الذرّية (S5، أمر المستخدم 2026-10-22). بلا شبكة ولا محاكٍ؛ المسار الحقيقي والسباق على المحاكي في maintenancePair.e2e.test.js.
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A3 البند ٤ (ومصدرها الحاكم WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md §٣-ج البند ٤: منقول، غير متحقَّق): «الاكتمال: في دفعة analyzeDevice الذرّية لفحص «بعد»: معاملة تعيد التحقّق أنّ «قبل» ما زال OPEN
// وبلا ربط حيّ ثم تكتب على «بعد» … وعلى «قبل» pair.state = COMPLETED · completedByScanId؛ إن ضاع الهدف يُكتب «بعد» بـlinkState = missing وملاحظة LINK_TARGET_LOST ويُكمل التقرير؛ والسباق محكوم بمعاملة واحدة.»
// الاستبدال معلَن (القاعدة 37): lib/pairFakeDb.js يستبدل طبقة Firestore هنا وحدها (معاملة تفاؤلية تعيد المحاولة عند التعارض، قراءة بعد كتابة ترمي، لا حذف)؛ الطبقة الحقيقية على المحاكي.
//   ١ writeReportAndRaw بـpairLink: المستندات الثلاثة وتحديث «قبل» في معاملة واحدة (لا دفعة)؛ الربط يُكتب على «بعد»؛ ما سواه من حقول سجلّ «بعد» محفوظ
//   ٢ ضياع الهدف بكل أسبابه: التقرير والخامّ وسجلّ «بعد» تُكتب، والربط missing، و«قبل» لا يُمسّ
//   ٣ السباق: معاملتان لـ«قبل» واحدة ⟵ تفوز واحدة وتخسر الأخرى (missing) وتكتمل تقاريرهما؛ وتعارض يُعيد المحاولة
//   ٤ الأشكال الخاطئة: pairLink بلا protocolDocument، مع parentProtocolUpdate، بمعرّف فارغ ⟵ خطأ بلا كتابة؛ وغياب pairLink = الدفعة كما كانت
//   ٥ بنية الشيفرة
//
// Run: node functions/test/maintenancePairCompletion.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const {writeReportAndRaw} = require('../src/analysis/reportRawStore');
const {makePairDb, ts, FieldValue} = require('./lib/pairFakeDb');

const HOUR = 3600 * 1000;
const NOW = 1_800_000_000_000;
const beforeDoc = (over = {}) => ({scanPurpose: 'maintenance_before', defectType: 'BATTERY', linkedScanId: null, linkState: 'none', linkMethod: null, repeat: {state: 'NOT_ELIGIBLE'}, pair: {state: 'OPEN', ownerId: 'owner-1', openedAt: ts(NOW - 2 * HOUR)}, ...over});
// سجلّ «بعد» كما يبنيه buildScanProtocolDocument (بلا ربط بعد): الحقول الأخرى يجب أن تبقى
const afterProtocol = (over = {}) => ({
  scanPurpose: 'maintenance_after', purposeSource: 'selected', linkedScanId: null, linkState: 'none', linkMethod: null, protocolVersion: 1, settingsVersion: 3,
  repeat: {state: 'NOT_ELIGIBLE'}, repeatOf: null, repeatClassification: null, creditExemption: null, consent: {state: 'not_collected'}, defectType: 'BATTERY', pair: null, linkModelCheck: null, createdAt: FieldValue.serverTimestamp(), ...over,
});
const write = (db, scanId, extra = {}) => writeReportAndRaw({
  db, reportRef: db.collection('reports').doc(scanId), scanId, reportDocument: {userId: 'owner-1', deviceModel: 'X', createdAt: FieldValue.serverTimestamp()},
  rawDocument: {scanId, payload: 'raw'}, protocolDocument: afterProtocol(), ...extra,
});
const PL = (over = {}) => ({beforeScanId: 'before-1', afterDefectType: 'BATTERY', ...over});
// (ق36 أ، 2026-10-22؛ القاعدة 23) الاكتمال يقرأ تقرير «قبل» (طرازه) داخل المعاملة: بذرة العالم تحمل تقريراً لـ«قبل» بالطراز نفسه الذي في تقرير «بعد» الافتراضي (X) فالنتيجة المتوقَّعة LINK_MODEL_MATCH؛ والتفصيل في linkModelCheck.test.js
const world = (before = beforeDoc(), extra = {}) => makePairDb({scanProtocol: {'before-1': before, ...extra}, reports: {'before-1': {userId: 'owner-1', deviceModel: 'X'}}}, {now: NOW});
const afterOf = (db, id) => db.store.scanProtocol[id];
const pathsWritten = (db) => db.writes.map((w) => `${w.op}:${w.path}`);

(async () => {
  // ═══ ١ — الاكتمال السليم ═══
  {
    const db = world();
    const r = await write(db, 'after-1', {pairLink: PL()});
    deq(r, {pair: {outcome: 'LINKED', reason: null, modelCheck: 'LINK_MODEL_MATCH'}}, '[١] النتيجة LINKED بلا سبب ومعها modelCheck (ق36 أ: التقريران بالطراز نفسه X)');
    eq(afterOf(db, 'after-1').linkModelCheck, 'LINK_MODEL_MATCH', '[١] (ق36 أ) وlinkModelCheck كُتب على «بعد» في المعاملة نفسها');
    deq(pathsWritten(db), ['set:reports/after-1', 'set:reportRaw/after-1', 'set:scanProtocol/after-1', 'update:scanProtocol/before-1'], '[١] أربع كتابات في معاملة واحدة: التقرير والخامّ وسجلّ «بعد» وتحديث «قبل»');
    deq(db.batches, [], '[١] **معاملة لا دفعة** (لا batch.commit)');
    const a = afterOf(db, 'after-1');
    deq([a.linkedScanId, a.linkState, a.linkMethod], ['before-1', 'active', 'manual'], '[١] «بعد»: linkedScanId · active · manual');
    deq([a.scanPurpose, a.purposeSource, a.defectType, a.pair, a.settingsVersion, a.protocolVersion], ['maintenance_after', 'selected', 'BATTERY', null, 3, 1], '[١] وباقي حقول سجلّ «بعد» محفوظة (الغرض والمصدر والنوع وpair null)');
    deq(Object.keys(a).sort(), Object.keys(afterProtocol()).sort(), '[١] لا حقل زائد ولا ناقص في سجلّ «بعد» (الربط يستبدل ثلاثة حقول قائمة)');
    ok(a.createdAt && a.createdAt.toMillis() === NOW, '[١] وcreatedAt وقت الخادم');
    const b = afterOf(db, 'before-1');
    deq([b.pair.state, b.pair.completedByScanId], ['COMPLETED', 'after-1'], '[١] «قبل»: pair.state = COMPLETED وcompletedByScanId = «بعد»');
    eq(b.pair.openedAt.toMillis(), NOW - 2 * HOUR, '[١] openedAt لم يُمسّ');
    eq(b.pair.ownerId, 'owner-1', '[١] (S8) ownerId لم يُمسّ (الاكتمال تحديثان منقَّطان لا استبدال pair: يبقى «قبل» ملكاً لمحلّها)');
    deq(Object.keys(b.pair).sort(), ['completedByScanId', 'openedAt', 'ownerId', 'state'], '[١] (S8) مفاتيح pair بعد الاكتمال: الأربعة (state وcompletedByScanId مكتوبان، وopenedAt وownerId كما كانا)');
    deq([b.scanPurpose, b.defectType, b.linkState, b.linkedScanId, b.repeat], ['maintenance_before', 'BATTERY', 'none', null, {state: 'NOT_ELIGIBLE'}], '[١] وباقي حقول «قبل» لم تُمسّ (تحديث منقَّط لحقلين)');
    ok(db.store.reports['after-1'] && db.store.reportRaw['after-1'], '[١] والتقرير والخامّ مكتوبان');
    // القراءات قبل الكتابة: الاستعلام داخل المعاملة مساواة على linkedScanId
    deq(db.queries.map((q) => [q.collection, q.filters, q.inTx]), [['scanProtocol', [['linkedScanId', '==', 'before-1']], true]], '[١] استعلام واحد داخل المعاملة: linkedScanId == «قبل» (مساواة على حقل واحد: القاعدة 43)');
    ok(!db.reads.some((x) => !x.inTx), '[١] كل القراءات داخل المعاملة');
  }
  // «بعد» أخرى ربطها ميّت لا تمنع
  {
    const db = world(beforeDoc(), {'old-after': {scanPurpose: 'maintenance_after', linkedScanId: 'before-1', linkState: 'unlinked_by_admin', linkMethod: 'manual'}, 'miss-after': {linkedScanId: 'before-1', linkState: 'missing'}});
    const r = await write(db, 'after-2', {pairLink: PL()});
    eq(r.pair.outcome, 'LINKED', '[١] روابط ميّتة (unlinked_by_admin وmissing) لا تمنع الاكتمال');
  }
  // مستند «بعد» نفسه لو كان موجوداً بربط عالق على «قبل» (إعادة كتابة مشروعة) لا يمنع نفسه
  {
    const db = world(beforeDoc(), {'after-3': {scanPurpose: 'maintenance_after', linkedScanId: 'before-1', linkState: 'active', linkMethod: 'manual'}});
    const r = await write(db, 'after-3', {pairLink: PL()});
    eq(r.pair.outcome, 'LINKED', '[١] مستند «بعد» نفسه لا يُعدّ ربطاً حيّاً مانعاً لنفسه (يُستبعد من الاستعلام)');
  }

  // ═══ ١-ب — فحص الطراز عند الاكتمال (ق36 أ، أقرّه حسن 2026-10-22): ملاحظة خادمية بلا رفض ولا تأخير ═══
  {
    // [التسمية، تقرير «قبل» (undefined = لا مستند)، تقرير «بعد» (undefined = بلا حقل طراز)، الحالة المتوقَّعة]
    const A = 'SM-A135F';
    const cases = [
      ['طرازان متطابقان', {deviceModel: A}, {deviceModel: A}, 'LINK_MODEL_MATCH'],
      ['طرازان مختلفان', {deviceModel: A}, {deviceModel: 'SM-S918B'}, 'LINK_MODEL_MISMATCH'],
      ['اختلاف بحالة الأحرف وحدها (المقارنة حرفية: لا مطبِّع طراز في المستودع)', {deviceModel: A}, {deviceModel: 'sm-a135f'}, 'LINK_MODEL_MISMATCH'],
      ['اختلاف بمسافة زائدة وحدها (حرفية بلا قصّ)', {deviceModel: A}, {deviceModel: `${A} `}, 'LINK_MODEL_MISMATCH'],
      ['تقرير «قبل» لا مستند له', undefined, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» بلا حقل طراز', {userId: 'owner-1'}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه نصّ فارغ', {deviceModel: ''}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه مسافات', {deviceModel: '   '}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه "Unknown" (احتياطي المستودع)', {deviceModel: 'Unknown'}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه "unknown" (احتياطي المستودع الآخر)', {deviceModel: 'unknown'}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه null', {deviceModel: null}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه رقم', {deviceModel: 5}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«قبل» طرازه كائن', {deviceModel: {model: A}}, {deviceModel: A}, 'LINK_MODEL_ABSENT'],
      ['«بعد» بلا حقل طراز', {deviceModel: A}, {}, 'LINK_MODEL_ABSENT'],
      ['«بعد» طرازه نصّ فارغ', {deviceModel: A}, {deviceModel: ''}, 'LINK_MODEL_ABSENT'],
      ['«بعد» طرازه "Unknown"', {deviceModel: A}, {deviceModel: 'Unknown'}, 'LINK_MODEL_ABSENT'],
      ['«بعد» طرازه "unknown"', {deviceModel: A}, {deviceModel: 'unknown'}, 'LINK_MODEL_ABSENT'],
      ['«بعد» طرازه null', {deviceModel: A}, {deviceModel: null}, 'LINK_MODEL_ABSENT'],
      ['الطرازان غائبان معاً: ليس «متطابق» أبداً (القاعدة 22)', {}, {}, 'LINK_MODEL_ABSENT'],
      ['الطرازان "Unknown" معاً: لا يتطابق «مجهول» مع «مجهول»', {deviceModel: 'Unknown'}, {deviceModel: 'Unknown'}, 'LINK_MODEL_ABSENT'],
      ['الطرازان "unknown" معاً', {deviceModel: 'unknown'}, {deviceModel: 'unknown'}, 'LINK_MODEL_ABSENT'],
      ['«قبل» "Unknown" و«بعد» "unknown"', {deviceModel: 'Unknown'}, {deviceModel: 'unknown'}, 'LINK_MODEL_ABSENT'],
    ];
    for (const [label, beforeReport, afterReport, expected] of cases) {
      const db = makePairDb({scanProtocol: {'before-1': beforeDoc()}, reports: beforeReport === undefined ? {} : {'before-1': beforeReport}}, {now: NOW});
      const r = await write(db, 'after-m', {pairLink: PL(), reportDocument: {userId: 'owner-1', ...afterReport, createdAt: FieldValue.serverTimestamp()}});
      deq(r, {pair: {outcome: 'LINKED', reason: null, modelCheck: expected}}, `[١-ب] ${label} ⟵ LINKED والحالة ${expected}`);
      const a = afterOf(db, 'after-m');
      eq(a.linkModelCheck, expected, `[١-ب] ${label}: الحالة نفسها مكتوبة على سجلّ «بعد»`);
      deq([a.linkedScanId, a.linkState, a.linkMethod], ['before-1', 'active', 'manual'], `[١-ب] ${label}: **لا رفض ولا تغيير في الربط**: active/manual/المعرّف (الملاحظة لا تمسّ الربط)`);
      ok(db.store.reports['after-m'] && db.store.reportRaw['after-m'], `[١-ب] ${label}: **التقرير والخامّ يكتملان في كل حالة**`);
      deq(pathsWritten(db), ['set:reports/after-m', 'set:reportRaw/after-m', 'set:scanProtocol/after-m', 'update:scanProtocol/before-1'], `[١-ب] ${label}: الكتابات الأربع نفسها (لا كتابة على تقرير «قبل» ولا مستند جديد)`);
      deq(Object.keys(db.writes[3].data).sort(), ['pair.completedByScanId', 'pair.state'], `[١-ب] ${label}: تحديث «قبل» حقلان منقَّطان لا غير (الملاحظة على «بعد» وحدها)`);
      deq(afterOf(db, 'before-1').linkModelCheck, undefined, `[١-ب] ${label}: «قبل» لا تحمل ملاحظة طراز`);
      deq(Object.keys(db.store.reports['after-m']).sort(), Object.keys({userId: 1, ...afterReport, createdAt: 1}).sort(), `[١-ب] ${label}: مستند التقرير لم يُضَف إليه أيّ حقل (لا ملاحظة طراز في reports)`);
    }
    // القراءات داخل المعاملة وقبل أول كتابة: تقرير «قبل» يُقرأ مع بقية القراءات (والفخّ في الفيك يرمي على قراءة بعد كتابة)
    {
      const db = world();
      await write(db, 'after-m', {pairLink: PL()});
      deq(db.reads.filter((x) => x.inTx).map((x) => x.path).sort(), ['reports/before-1', 'scanProtocol/before-1'], '[١-ب] **تقرير «قبل» يُقرأ داخل المعاملة** مع سجلّه (والاستعلام الثالث في db.queries)');
      ok(!db.reads.some((x) => !x.inTx), '[١-ب] ولا قراءة خارج المعاملة (القراءة خارجها تفوّت التعارض)');
    }
    // تغيّر طراز «قبل» بين القراءة والإتمام ⟵ تعارض ⟵ إعادة المحاولة ثم الحالة الجديدة (دليل أنّ القراءة داخل المعاملة)
    {
      const db = world();
      let attempts = 0;
      db.hooks.beforeCommit = ({attempt, db: d}) => { attempts = attempt; if (attempt === 1) d.seed('reports', 'before-1', {userId: 'owner-1', deviceModel: 'CHANGED'}); };
      const r = await write(db, 'after-m', {pairLink: PL()});
      eq(attempts, 2, '[١-ب] تغيّر تقرير «قبل» أثناء المعاملة ⟵ أُعيدت المحاولة');
      eq(r.pair.modelCheck, 'LINK_MODEL_MISMATCH', '[١-ب] وانتهت بالحالة المحسوبة من الطراز الجديد لا من القديم');
      eq(afterOf(db, 'after-m').linkModelCheck, 'LINK_MODEL_MISMATCH', '[١-ب] والمكتوب على «بعد» كذلك');
    }
    // الهدف الضائع: لا مقارنة ولو اختلف الطرازان (لا هدف حلّ)، والحقل يبقى null من المستند
    {
      const db = world(beforeDoc({scanPurpose: 'battery_before'}));
      db.seed('reports', 'before-1', {userId: 'owner-1', deviceModel: 'DIFFERENT'});
      const r = await write(db, 'after-m', {pairLink: PL()});
      deq(r, {pair: {outcome: 'TARGET_LOST', reason: 'TARGET_WRONG_PURPOSE', modelCheck: null}}, '[١-ب] هدف ضائع والطرازان مختلفان ⟵ لا مقارنة (modelCheck null)');
      eq(afterOf(db, 'after-m').linkModelCheck, null, '[١-ب] و«بعد» تحمل linkModelCheck = null صريحاً (لا MISMATCH على ربط لم يحلّ)');
      eq(afterOf(db, 'after-m').linkState, 'missing', '[١-ب] والربط missing كما كان');
    }
    // بلا pairLink: الحقل null من المستند ولا قراءة لتقرير آخر
    {
      const db = world();
      await write(db, 'after-m');
      eq(afterOf(db, 'after-m').linkModelCheck, null, '[١-ب] فحص «بعد» بلا ربط مختار ⟵ linkModelCheck = null');
      deq(db.reads, [], '[١-ب] ولا قراءة (الدفعة كما كانت)');
    }
  }

  // ═══ ٢ — ضياع الهدف: التقرير يكتمل والربط missing ═══
  for (const [label, db, plOver, reason] of [
    ['«قبل» غائبة', makePairDb({scanProtocol: {}}, {now: NOW}), {}, 'TARGET_NOT_FOUND'],
    ['غرض «قبل» battery_before', world(beforeDoc({scanPurpose: 'battery_before'})), {}, 'TARGET_WRONG_PURPOSE'],
    ['نوع «قبل» مختلف', world(beforeDoc({defectType: 'THERMAL'})), {}, 'TARGET_WRONG_TYPE'],
    ['نوع «بعد» null', world(beforeDoc({defectType: null})), {afterDefectType: null}, 'TARGET_WRONG_TYPE'],
    ['pair غير مقروء', world(beforeDoc({pair: {state: 'OPEN'}})), {}, 'TARGET_PAIR_UNREADABLE'],
    ['«قبل» COMPLETED بغيرها', world(beforeDoc({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - HOUR), completedByScanId: 'winner'}})), {}, 'TARGET_NOT_OPEN'],
    ['ربط حيّ من «بعد» أخرى', world(beforeDoc(), {'other-after': {linkedScanId: 'before-1', linkState: 'active'}}), {}, 'TARGET_LIVE_LINK'],
    ['ربط relinked_by_admin من «بعد» أخرى', world(beforeDoc(), {'other-after': {linkedScanId: 'before-1', linkState: 'relinked_by_admin'}}), {}, 'TARGET_LIVE_LINK'],
  ]) {
    const beforeSnapshot = JSON.stringify(db.store.scanProtocol['before-1'], (k, v) => (v && v.toMillis ? v.toMillis() : v));
    const r = await write(db, 'after-lost', {pairLink: PL(plOver)});
    deq(r, {pair: {outcome: 'TARGET_LOST', reason, modelCheck: null}}, `[٢] ${label} ⟵ TARGET_LOST (${reason}) بلا مقارنة طراز (modelCheck null)`);
    const a = afterOf(db, 'after-lost');
    deq([a.linkedScanId, a.linkState, a.linkMethod], ['before-1', 'missing', 'manual'], `[٢] ${label}: «بعد» missing/manual والمعرّف المختار محفوظ`);
    ok(db.store.reports['after-lost'] && db.store.reportRaw['after-lost'] && a, `[٢] ${label}: **التقرير والخامّ وسجلّ «بعد» كُتبت (لا يسقط تقرير الزبون)**`);
    eq(JSON.stringify(db.store.scanProtocol['before-1'], (k, v) => (v && v.toMillis ? v.toMillis() : v)), beforeSnapshot, `[٢] ${label}: «قبل» لم تُمسّ`);
    eq(pathsWritten(db).filter((p) => p.startsWith('update:')).length, 0, `[٢] ${label}: لا تحديث لأيّ مستند`);
    deq(a.pair, null, `[٢] ${label}: وpair «بعد» null`);
  }

  // ═══ ٣ — السباق ═══
  {
    // معاملتان متزامنتان لـ«قبل» واحدة: واحدة تفوز وأخرى تخسر
    const db = world();
    const [r1, r2] = await Promise.all([write(db, 'after-A', {pairLink: PL()}), write(db, 'after-B', {pairLink: PL()})]);
    const outcomes = [r1.pair.outcome, r2.pair.outcome].sort();
    deq(outcomes, ['LINKED', 'TARGET_LOST'], '[٣] **فحصا «بعد» يختاران «قبل» واحدة: واحد LINKED وواحد TARGET_LOST**');
    const winner = r1.pair.outcome === 'LINKED' ? 'after-A' : 'after-B';
    const loser = winner === 'after-A' ? 'after-B' : 'after-A';
    const lostResult = r1.pair.outcome === 'LINKED' ? r2 : r1;
    eq(lostResult.pair.reason, 'TARGET_NOT_OPEN', '[٣] والخاسر سببه TARGET_NOT_OPEN (رأى COMPLETED بعد إعادة المحاولة)');
    eq(afterOf(db, winner).linkState, 'active', '[٣] الفائز active');
    eq(afterOf(db, loser).linkState, 'missing', '[٣] والخاسر missing');
    eq(afterOf(db, winner).linkModelCheck, 'LINK_MODEL_MATCH', '[٣] (ق36 أ) الفائز يحمل ملاحظة الطراز');
    eq(afterOf(db, loser).linkModelCheck, null, '[٣] (ق36 أ) والخاسر (الهدف ضاع) بلا مقارنة: linkModelCheck null');
    eq(afterOf(db, 'before-1').pair.completedByScanId, winner, '[٣] و«قبل» مكتملة بالفائز وحده');
    ok(db.store.reports['after-A'] && db.store.reports['after-B'] && db.store.reportRaw['after-A'] && db.store.reportRaw['after-B'], '[٣] **وكلا التقريرين كُتبا** (الخاسر لا يسقط تقريره)');
    eq(pathsWritten(db).filter((p) => p === 'update:scanProtocol/before-1').length, 1, '[٣] «قبل» حُدِّثت مرّة واحدة بالضبط');
  }
  {
    // تعارض مُحقَن: كاتب آخر يكمل «قبل» بين قراءة المعاملة وإتمامها ⟵ إعادة المحاولة ثم TARGET_LOST
    const db = world();
    let attempts = 0;
    db.hooks.beforeCommit = ({attempt, db: d}) => {
      attempts = attempt;
      if (attempt === 1) d.seed('scanProtocol', 'before-1', beforeDoc({pair: {state: 'COMPLETED', ownerId: 'owner-1', openedAt: ts(NOW - 2 * HOUR), completedByScanId: 'interloper'}}));
    };
    const r = await write(db, 'after-C', {pairLink: PL()});
    eq(attempts, 2, '[٣] المعاملة أُعيدت مرّة عند التعارض');
    deq(r, {pair: {outcome: 'TARGET_LOST', reason: 'TARGET_NOT_OPEN', modelCheck: null}}, '[٣] وبعد إعادة المحاولة رأت COMPLETED ⟵ TARGET_LOST');
    eq(afterOf(db, 'before-1').pair.completedByScanId, 'interloper', '[٣] «قبل» بقيت للمتدخّل (لم يُكتب فوقه)');
    eq(afterOf(db, 'after-C').linkState, 'missing', '[٣] و«بعد» missing');
    ok(db.store.reports['after-C'], '[٣] والتقرير مكتوب');
  }
  {
    // تعارض لا يغيّر النتيجة: كاتب آخر يلمس مستنداً غير ذي صلة في scanProtocol ⟵ إعادة المحاولة ثم LINKED
    const db = world();
    let attempts = 0;
    db.hooks.beforeCommit = ({attempt, db: d}) => { attempts = attempt; if (attempt === 1) d.seed('scanProtocol', 'unrelated', {scanPurpose: 'normal', linkState: 'none', pair: null}); };
    const r = await write(db, 'after-D', {pairLink: PL()});
    eq(attempts, 2, '[٣] كتابة في المجموعة نفسها تُعيد المحاولة (استعلام الربط الحيّ داخل المعاملة)');
    eq(r.pair.outcome, 'LINKED', '[٣] وتنتهي LINKED');
  }
  {
    // ربط حيّ يظهر بين القراءة والإتمام (مستند جديد بربط active) ⟵ إعادة المحاولة ثم TARGET_LIVE_LINK
    const db = world();
    db.hooks.beforeCommit = ({attempt, db: d}) => { if (attempt === 1) d.seed('scanProtocol', 'sneaky-after', {scanPurpose: 'maintenance_after', linkedScanId: 'before-1', linkState: 'active', linkMethod: 'manual'}); };
    const r = await write(db, 'after-E', {pairLink: PL()});
    deq(r, {pair: {outcome: 'TARGET_LOST', reason: 'TARGET_LIVE_LINK', modelCheck: null}}, '[٣] **ربط حيّ ظهر بعد القراءة** ⟵ بعد إعادة المحاولة TARGET_LIVE_LINK');
  }

  // ═══ ٤ — الأشكال الخاطئة، وغياب pairLink ═══
  {
    const rejects = async (label, extra, re) => {
      const db = world();
      let err = null;
      try { await write(db, 'after-X', extra); } catch (e) { err = e; }
      ok(err !== null && re.test(err.message), `[٤] ${label}: خطأ صريح (${err && err.message})`);
      deq(db.writes, [], `[٤] ${label}: لا كتابة`);
    };
    await rejects('pairLink null', {pairLink: null}, /pairLink حاضر وشكله ليس/);
    await rejects('pairLink بلا beforeScanId', {pairLink: {afterDefectType: 'BATTERY'}}, /pairLink حاضر وشكله ليس/);
    await rejects('beforeScanId فارغ', {pairLink: PL({beforeScanId: ''})}, /pairLink حاضر وشكله ليس/);
    await rejects('beforeScanId رقم', {pairLink: PL({beforeScanId: 5})}, /pairLink حاضر وشكله ليس/);
    await rejects('afterDefectType رقم', {pairLink: PL({afterDefectType: 3})}, /pairLink حاضر وشكله ليس/);
    await rejects('afterDefectType غائب', {pairLink: {beforeScanId: 'before-1'}}, /pairLink حاضر وشكله ليس/);
    await rejects('pairLink مع parentProtocolUpdate', {pairLink: PL(), parentProtocolUpdate: {scanId: 'p', fields: {x: 1}}}, /pairLink مع parentProtocolUpdate/);
    const db = world();
    let err = null;
    try { await writeReportAndRaw({db, reportRef: db.collection('reports').doc('after-Y'), scanId: 'after-Y', reportDocument: {userId: 'o'}, rawDocument: {}, pairLink: PL()}); } catch (e) { err = e; }
    ok(err && /pairLink بلا protocolDocument/.test(err.message) && db.writes.length === 0, '[٤] pairLink بلا protocolDocument: خطأ بلا كتابة');
    // غياب pairLink: الدفعة كما كانت (لا معاملة، ولا قيمة مُعادة)
    const db2 = world();
    const r = await write(db2, 'after-Z');
    eq(r, undefined, '[٤] بلا pairLink: لا قيمة مُعادة (كما كان)');
    deq(db2.batches, [['set:reports/after-Z', 'set:reportRaw/after-Z', 'set:scanProtocol/after-Z']], '[٤] **بلا pairLink: دفعة واحدة بالمستندات الثلاثة (لا معاملة)**');
    deq(db2.queries, [], '[٤] ولا استعلام');
    deq(afterOf(db2, 'after-Z').linkState, 'none', '[٤] وسجلّ «بعد» بلا ربط كما بُني');
    deq(afterOf(db2, 'before-1').pair.state, 'OPEN', '[٤] و«قبل» لم تُمسّ');
  }

  // ═══ ٥ — بنية الشيفرة ═══
  {
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'reportRawStore.js'), 'utf8').replace(/\r\n/g, '\n'));
    const fn = source.slice(source.indexOf('async function writeWithPairCompletion'), source.indexOf('const pickRawFields'));
    const gets = [...fn.matchAll(/tx\.get\(/g)];
    const writes = [...fn.matchAll(/tx\.(set|update|create)\(/g)];
    // (ق36 أ، القاعدة 23: كانت قراءتين؛ صارت ثلاثاً: سجلّ «قبل» وتقريرها (طراز) والاستعلام عن الروابط الحيّة)
    eq(gets.length, 3, '[٥] ثلاث قراءات داخل المعاملة: سجلّ «قبل» وتقريرها (طرازها، ق36 أ) والاستعلام عن الروابط الحيّة');
    ok(!/deviceModel|LINK_MODEL_/.test(fn), '[٥] (ق36 أ) لا مقارنة ولا حقل طراز داخل المخزن: القرار في maintenancePair.decidePairCompletion (مصدر واحد)');
    eq(writes.length, 4, '[٥] أربع كتابات: التقرير والخامّ وسجلّ «بعد» وتحديث «قبل»');
    ok(Math.max(...gets.map((m) => m.index)) < Math.min(...writes.map((m) => m.index)), '[٥] **القراءات كلّها قبل أول كتابة** (شرط معاملات Firestore)');
    ok(!/throw\s/.test(fn), '[٥] لا throw داخل المعاملة (القرار يُرجَع)');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(source), '[٥] لا حذف في reportRawStore (القاعدة 42)');
    ok(/where\(SCAN_PROTOCOL_FIELD\.LINKED_SCAN_ID, '==', pairLink\.beforeScanId\)/.test(fn), '[٥] استعلام الربط الحيّ مساواة على حقل واحد');
    ok(!/["'](maintenance_before|maintenance_after|manual|OPEN|COMPLETED|linkedScanId|linkState)["']/.test(fn), '[٥] لا نصّ حرفي لغرض ولا حالة ولا اسم حقل (decidePairCompletion هي المصدر)');
  }

  console.log(`\nmaintenancePairCompletion.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
