'use strict';

// shopProtocol.test.js — تفعيل أجزاء البروتوكول لكل محلّ وقائمة الفنّيين: التحقّق (S-P6-14، 2026-10-21 +03). وحدة بلا شبكة ولا محاكٍ؛ الكتابة الحقيقية في protocolAdmin.e2e.test.js.
//
// المواصفة: PLAN-06 §٦-ب-١ (:787-792) وdocs/PROTOCOL_CONTRACT.md §٢ A10 (E15: displayName · ownerId · active + createdAt · updatedAt؛ E42: batteryBeforeAfter). الدوالّ نقيّة (القاعدة 41).
// **لا أسماء فنّيين حقيقية في هذا الاختبار** («ولا تُدخل أيّ أسماء الآن»): نصوص وهمية موسومة (FAKE-TECH-*).
//   ١ validatePartsPatch: كل مفتاح من PROTOCOL_PART بكل قيمه، والاسم القديم batteryPairs مرفوض، وكل نوع خاطئ
//   ٢ changedParts: ما يتغيّر فعلاً بقاعدة القراءة «=== true وحدها»
//   ٣ validateTechnicianCall: كل فعل بكل مُدخلاته (الإضافة · التعديل · الإيقاف) وكل رفض بترتيبه؛ لا فعل حذف
//   ٤ buildTechnicianDocument وtechnicianUpdate وreadTechnicianForView
//   ٥ الردود: لكل رمز ردّ، لا نصّ عربي جديد
//   ٦ بنية الشيفرة: لا I/O ولا حذف
//
// Run: node functions/test/shopProtocol.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const P = require('../src/protocol/shopProtocol');
const V = require('../src/protocol/protocolVocabulary');
const {readProtocolParts} = require('../src/protocol/scanProtocolDocument');
const {MAX_TECHNICIAN_NAME_LEN} = require('../src/evaluations/evaluationContract');

const PARTS = ['purposes', 'batteryBeforeAfter', 'coldRepeat', 'returns', 'doubleEval', 'consent'];

// ═══ ١ — validatePartsPatch ═══
{
  deq([...Object.values(V.PROTOCOL_PART)].sort(), [...PARTS].sort(), '[١] أجزاء المحلّ الستّة (المفتاح الثاني batteryBeforeAfter: E42)');
  for (const bad of [undefined, null, 5, 'x', [], [true], {}]) deq(P.validatePartsPatch(bad), {ok: false, refusal: 'SHOP_PARTS_REQUIRED'}, `[١] parts ${JSON.stringify(bad)} ⟵ SHOP_PARTS_REQUIRED`);
  for (const k of PARTS) {
    for (const v of [true, false]) deq(P.validatePartsPatch({[k]: v}), {ok: true, patch: {[k]: v}}, `[١] ${k} = ${v}`);
    for (const v of ['true', 'false', 1, 0, null, undefined, {}, [], 'yes']) deq(P.validatePartsPatch({[k]: v}), {ok: false, refusal: 'SHOP_PARTS_VALUE_INVALID', extra: ` part=${k}`}, `[١] ${k} = ${JSON.stringify(v)} ليست منطقية ⟵ SHOP_PARTS_VALUE_INVALID`);
  }
  deq(P.validatePartsPatch({batteryPairs: true}), {ok: false, refusal: 'SHOP_PARTS_KEY_UNKNOWN', extra: ' part=UNKNOWN'}, '[١] الاسم القديم batteryPairs مرفوض (E42: تصادم مع حقل fv68)');
  for (const k of ['Purposes', 'return', 'evaluationEnabled', '', 'unknownPart']) eq(P.validatePartsPatch({[k]: true}).refusal, 'SHOP_PARTS_KEY_UNKNOWN', `[١] المفتاح ${JSON.stringify(k)} ⟵ SHOP_PARTS_KEY_UNKNOWN`);
  eq(P.validatePartsPatch({purposes: true, unknownPart: true}).refusal, 'SHOP_PARTS_KEY_UNKNOWN', '[١] مفتاح مجهول بين صالحة ⟵ يُرفض كلّه (لا كتابة جزئية)');
  eq(P.validatePartsPatch({purposes: true, consent: 'true'}).refusal, 'SHOP_PARTS_VALUE_INVALID', '[١] قيمة خاطئة بين صالحة ⟵ يُرفض كلّه');
  deq(P.validatePartsPatch({consent: true, purposes: false}), {ok: true, patch: {purposes: false, consent: true}}, '[١] رقعة بجزأين: بترتيب PROTOCOL_PART');
  const input = {coldRepeat: true};
  P.validatePartsPatch(input);
  deq(input, {coldRepeat: true}, '[١] لا تعدّل مدخلاتها');
}

// ═══ ٢ — changedParts ═══
{
  const cur = readProtocolParts({protocolParts: {purposes: true, consent: 'true', returns: false}});
  deq(P.changedParts(cur, {purposes: true}), [], '[٢] true على true ⟵ لا تغيّر');
  deq(P.changedParts(cur, {purposes: false}), ['purposes'], '[٢] true ← false ⟵ تغيّر');
  deq(P.changedParts(cur, {consent: true}), ['consent'], '[٢] المخزَّن «true» نصّاً يُقرأ false ⟵ كتابة true منطقية تغيّر (يُصحَّح)');
  deq(P.changedParts(cur, {consent: false}), [], '[٢] والنصّ «true» يُقرأ false فكتابة false لا تغيّر مقروءاً');
  deq(P.changedParts(cur, {coldRepeat: false}), [], '[٢] الغائب يُقرأ false ⟵ false لا تغيّر');
  deq(P.changedParts(cur, {coldRepeat: true, doubleEval: true, purposes: true}), ['coldRepeat', 'doubleEval'], '[٢] أكثر من جزء');
}

// ═══ ٣ — validateTechnicianCall ═══
const call = (d) => P.validateTechnicianCall(d);
const fail = (d) => { const r = call(d); return r.ok ? null : r.refusal; };
{
  deq(P.TECHNICIAN_ACTION, {ADD: 'add', RENAME: 'rename', SET_ACTIVE: 'set_active'}, '[٣] ثلاثة أفعال: إضافة وتعديل وإيقاف (لا حذف)');
  ok(!Object.values(P.TECHNICIAN_ACTION).some((a) => /delet|remov|drop/i.test(a)), '[٣] لا فعل حذف (القاعدة 42؛ «إيقافه بلا حذف»)');
  deq(call({ownerId: 'shop-1', action: 'add', displayName: 'FAKE-TECH-A'}), {ok: true, action: 'add', ownerId: 'shop-1', technicianId: null, displayName: 'FAKE-TECH-A', active: null}, '[٣] إضافة صالحة');
  deq(call({ownerId: ' shop-1 ', action: 'add', displayName: '  FAKE-TECH-A  '}), {ok: true, action: 'add', ownerId: 'shop-1', technicianId: null, displayName: 'FAKE-TECH-A', active: null}, '[٣] المعرّف والاسم يُشذَّبان');
  deq(call({ownerId: 'shop-1', action: 'rename', technicianId: 't-1', displayName: 'FAKE-TECH-B'}), {ok: true, action: 'rename', ownerId: 'shop-1', technicianId: 't-1', displayName: 'FAKE-TECH-B', active: null}, '[٣] تعديل صالح');
  deq(call({ownerId: 'shop-1', action: 'set_active', technicianId: 't-1', active: false}), {ok: true, action: 'set_active', ownerId: 'shop-1', technicianId: 't-1', displayName: null, active: false}, '[٣] إيقاف صالح (active false)');
  deq(call({ownerId: 'shop-1', action: 'set_active', technicianId: 't-1', active: true}), {ok: true, action: 'set_active', ownerId: 'shop-1', technicianId: 't-1', displayName: null, active: true}, '[٣] إعادة تفعيل (active true)');
  // الحقول الزائدة لفعل لا يقرؤها تُتجاهل
  deq(call({ownerId: 'shop-1', action: 'set_active', technicianId: 't-1', active: true, displayName: 'ignored'}).displayName, null, '[٣] displayName في set_active يُتجاهل');
  deq(call({ownerId: 'shop-1', action: 'add', displayName: 'FAKE-TECH-A', technicianId: 'ignored', active: false}).technicianId, null, '[٣] technicianId وactive في add تُتجاهل');
  // المحلّ
  for (const bad of [undefined, null, '', '   ', 5, 'a/b', '.', '..', 'x'.repeat(129), {}]) eq(fail({ownerId: bad, action: 'add', displayName: 'x'}), 'SHOP_ID_REQUIRED', `[٣] ownerId ${JSON.stringify(bad)} ⟵ SHOP_ID_REQUIRED`);
  eq(fail(undefined), 'SHOP_ID_REQUIRED', '[٣] بلا مدخل ⟵ SHOP_ID_REQUIRED');
  eq(fail('x'), 'SHOP_ID_REQUIRED', '[٣] مدخل نصّ ⟵ SHOP_ID_REQUIRED');
  // الفعل
  for (const bad of [undefined, null, '']) eq(fail({ownerId: 's', action: bad}), 'TECHNICIAN_ACTION_REQUIRED', `[٣] action ${JSON.stringify(bad)} ⟵ TECHNICIAN_ACTION_REQUIRED`);
  for (const bad of ['delete', 'remove', 'ADD', 'Add', 'update', 5, {}, [], true]) eq(fail({ownerId: 's', action: bad}), 'TECHNICIAN_ACTION_INVALID', `[٣] action ${JSON.stringify(bad)} ⟵ TECHNICIAN_ACTION_INVALID (لا حذف ولا أحرف مختلفة)`);
  // معرّف الفنّي
  for (const action of ['rename', 'set_active']) {
    for (const bad of [undefined, null, '', '  ', 5, 'a/b', '.', '..', 'x'.repeat(129)]) eq(fail({ownerId: 's', action, technicianId: bad, displayName: 'x', active: true}), 'TECHNICIAN_ID_REQUIRED', `[٣] ${action}: technicianId ${JSON.stringify(bad)} ⟵ TECHNICIAN_ID_REQUIRED`);
  }
  // الاسم: add وrename
  for (const action of ['add', 'rename']) {
    const base = {ownerId: 's', action, technicianId: 't'};
    for (const bad of [undefined, null, '', '   ', 5, {}, [], true]) eq(fail({...base, displayName: bad}), 'TECHNICIAN_NAME_INVALID', `[٣] ${action}: displayName ${JSON.stringify(bad)} ⟵ TECHNICIAN_NAME_INVALID`);
    eq(fail({...base, displayName: 'x'.repeat(MAX_TECHNICIAN_NAME_LEN + 1)}), 'TECHNICIAN_NAME_INVALID', `[٣] ${action}: أطول من ${MAX_TECHNICIAN_NAME_LEN} ⟵ TECHNICIAN_NAME_INVALID (الحدّ من evaluationContract: مصدر واحد)`);
    eq(fail({...base, displayName: 'x'.repeat(MAX_TECHNICIAN_NAME_LEN)}), null, `[٣] ${action}: بطول ${MAX_TECHNICIAN_NAME_LEN} صالح (الحدّ داخل)`);
    eq(fail({...base, displayName: ' ' + 'x'.repeat(MAX_TECHNICIAN_NAME_LEN) + ' '}), null, `[٣] ${action}: الحدّ يُقاس بعد التشذيب`);
  }
  eq(MAX_TECHNICIAN_NAME_LEN, 120, '[٣] الحدّ 120 (سابقة اسم الفنّي في evaluationContract.js)');
  // active: set_active
  for (const bad of [undefined, null, 'true', 'false', 1, 0, {}, []]) eq(fail({ownerId: 's', action: 'set_active', technicianId: 't', active: bad}), 'TECHNICIAN_ACTIVE_INVALID', `[٣] set_active: active ${JSON.stringify(bad)} ليست منطقية ⟵ TECHNICIAN_ACTIVE_INVALID (الغياب لا يُقرأ false)`);
  // ترتيب الرفض: المحلّ ← الفعل ← المعرّف ← الاسم ← active
  eq(fail({ownerId: '', action: 'bogus'}), 'SHOP_ID_REQUIRED', '[٣] ترتيب الرفض: المحلّ أوّلاً');
  eq(fail({ownerId: 's', action: 'bogus', technicianId: ''}), 'TECHNICIAN_ACTION_INVALID', '[٣] ثم الفعل');
  eq(fail({ownerId: 's', action: 'rename', technicianId: '', displayName: ''}), 'TECHNICIAN_ID_REQUIRED', '[٣] ثم المعرّف');
  eq(fail({ownerId: 's', action: 'rename', technicianId: 't', displayName: ''}), 'TECHNICIAN_NAME_INVALID', '[٣] ثم الاسم');
}

// ═══ ٤ — المستند والتعديل والعرض ═══
{
  const NOW = {__stamp: 'now'};
  const doc = P.buildTechnicianDocument({ownerId: 'shop-1', displayName: 'FAKE-TECH-A', now: NOW});
  deq(doc, {displayName: 'FAKE-TECH-A', ownerId: 'shop-1', active: true, createdAt: NOW, updatedAt: NOW}, '[٤] مستند الفنّي الجديد: الحقول الخمسة (E15) وactive true عند الإضافة');
  deq(Object.keys(doc).sort(), ['active', 'createdAt', 'displayName', 'ownerId', 'updatedAt'], '[٤] خمسة مفاتيح بالضبط');
  const cur = {displayName: 'FAKE-TECH-A', ownerId: 'shop-1', active: true};
  deq(P.technicianUpdate({action: 'rename', displayName: 'FAKE-TECH-A'}, cur), {changed: false, fields: {}}, '[٤] الاسم نفسه ⟵ لا تغيّر');
  deq(P.technicianUpdate({action: 'rename', displayName: 'FAKE-TECH-B'}, cur), {changed: true, fields: {displayName: 'FAKE-TECH-B'}}, '[٤] اسم جديد ⟵ يكتب displayName وحده');
  deq(P.technicianUpdate({action: 'set_active', active: true}, cur), {changed: false, fields: {}}, '[٤] الحالة نفسها ⟵ لا تغيّر');
  deq(P.technicianUpdate({action: 'set_active', active: false}, cur), {changed: true, fields: {active: false}}, '[٤] إيقاف ⟵ يكتب active وحدها (لا حذف)');
  deq(P.technicianUpdate({action: 'set_active', active: true}, {...cur, active: undefined}), {changed: true, fields: {active: true}}, '[٤] active غائب في المخزَّن ثم true ⟵ تغيّر (الغائب لا يساوي true)');
  deq(P.technicianUpdate({action: 'set_active', active: false}, {...cur, active: 'false'}), {changed: true, fields: {active: false}}, '[٤] active نصّي ثم false منطقية ⟵ تغيّر (يُصحَّح)');
  // العرض
  deq(P.readTechnicianForView({displayName: 'x', active: true}), {displayName: 'x', active: true, activeState: 'ACTIVE'}, '[٤] عرض: فعّال');
  deq(P.readTechnicianForView({displayName: 'x', active: false}), {displayName: 'x', active: false, activeState: 'INACTIVE'}, '[٤] عرض: موقوف');
  for (const bad of [undefined, null, 'true', 1, {}]) deq(P.readTechnicianForView({displayName: 'x', active: bad}), {displayName: 'x', active: null, activeState: 'ACTIVE_FLAG_UNREADABLE'}, `[٤] عرض: active ${JSON.stringify(bad)} ⟵ ACTIVE_FLAG_UNREADABLE (لا يُقرأ فعّالاً)`);
  deq(P.readTechnicianForView({active: true}).displayName, null, '[٤] اسم غائب ⟵ null');
  deq(P.readTechnicianForView({displayName: 5, active: true}).displayName, null, '[٤] اسم ليس نصّاً ⟵ null');
  deq(P.readTechnicianForView(null), {displayName: null, active: null, activeState: 'ACTIVE_FLAG_UNREADABLE'}, '[٤] مستند غائب ⟵ حالات صريحة');
  // readShopId
  eq(P.readShopId(' s1 '), 's1', '[٤] readShopId يشذّب');
  for (const bad of [undefined, null, 5, '', ' ', 'a/b', '..']) eq(P.readShopId(bad), null, `[٤] readShopId(${JSON.stringify(bad)}) = null`);
}

// ═══ ٥ — الردود ═══
{
  const codes = Object.values(P.SHOP_PROTOCOL_REFUSAL);
  deq(Object.keys(P.REFUSAL_RESPONSE).sort(), [...codes].sort(), '[٥] لكل رمز رفض ردّ، ولا ردّ بلا رمز');
  for (const [reason, spec] of Object.entries(P.REFUSAL_RESPONSE)) {
    deq(Object.keys(spec).sort(), ['clientReasonCode', 'code', 'message'], `[٥] ${reason}: ردّ بثلاثة مفاتيح`);
    eq(spec.message, reason, `[٥] ${reason}: الرسالة رمزه التقني (لا نصّ عربي جديد: القرار ٩٠)`);
    eq(spec.clientReasonCode, reason, `[٥] ${reason}: يصل العميل بالرمز نفسه`);
    ok(['invalid-argument', 'not-found', 'failed-precondition'].includes(spec.code), `[٥] ${reason}: رمز HttpsError معروف (${spec.code})`);
  }
  eq(codes.length, 12, '[٥] اثنا عشر رمزاً');
  ok(Object.isFrozen(P.SHOP_PROTOCOL_REFUSAL) && Object.isFrozen(P.REFUSAL_RESPONSE) && Object.isFrozen(P.TECHNICIAN_ACTION), '[٥] مجمَّدة');
}

// ═══ ٦ — بنية الشيفرة ═══
{
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const code = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'protocol', 'shopProtocol.js'), 'utf8'));
  deq([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]).sort(), ['../evaluations/evaluationContract', '../evaluations/technicianFormContract', './protocolVocabulary'], '[٦] ثلاثة مستورَدات نقيّة (لا Firestore ولا admin)');
  ok(!/\.delete\(|FieldValue|recursiveDelete|bulkWriter|\.batch\(|collection\(|\.doc\(|runTransaction|\.where\(|Math\.random/.test(code), '[٦] لا قراءة Firestore ولا كتابة ولا حذف ولا استعلام (القاعدة 42/43؛ الدالّة نقيّة)');
  ok(!/["'`](purposes|batteryBeforeAfter|coldRepeat|returns|doubleEval|consent)["'`]/.test(code), '[٦] لا اسم جزء حرفياً: كلّها من PROTOCOL_PART (القاعدة 24)');
  ok(!/FAKE|displayName\s*[:=]\s*["'`]/.test(code), '[٦] لا اسم فنّي في الكود («ولا تُدخل أيّ أسماء الآن»)');
}

console.log(`\nshopProtocol.test.js: ${n}/${n} assertions passed`);
