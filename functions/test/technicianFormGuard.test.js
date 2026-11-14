'use strict';

// technicianFormGuard.test.js — الأحكام النقيّة وحرّاس بنية دوالّ استمارة الفنّي الثلاث (S-P6-08، 2026-10-18 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في technicianForm.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠ (:1179-1376) وdocs/PROTOCOL_CONTRACT.md §٢ A5. معرّفات الفنّيين وهمية موسومة (fake-tech-*).
//   ١ أسباب الرفض وردودها: الخمسة عشر المعتمدة (E5) كما هي، والأربعة الاقتراحية، ولا نصّ عربي جديد، وغير المالك وجلسة غير موجودة سواء عند العميل
//   ٢ decideSessionGate: جدول (مالك × حالة × وقت × وضع)   ٣ technicianState وdoubleEvalState   ٤ refuse: السطر المسمّى بمعرّفات مُهشَّرة
//   ٥ بنية الشيفرة: موضع رمي واحد، كل سبب مستعمَل، لا حذف، المعاملات تُرجِع قراراً، الإنشاء بـcreate لا set، الاستعلامات مساواة، السجلّ بلا ملاحظة ولا اسم
//
// Run: node functions/test/technicianFormGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const F = require('../src/evaluations/technicianForm');
const {TECHNICIAN_FORM_REFUSAL: R, REFUSAL_RESPONSE} = require('../src/evaluations/technicianFormRefusal');
const {hashIdForLog} = require('../src/utils/logRedaction');

// ═══ ١ — الأسباب وردودها ═══
ok(Object.isFrozen(R) && Object.isFrozen(REFUSAL_RESPONSE), '[١] TECHNICIAN_FORM_REFUSAL وREFUSAL_RESPONSE مجمَّدان');
const E5 = {
  CONTRACT_VERSION_INVALID: 'FORM_CONTRACT_VERSION_INVALID', SLOT_INVALID: 'FORM_SLOT_INVALID', SLOT_SAME_TECHNICIAN: 'FORM_SLOT_SAME_TECHNICIAN', TECHNICIAN_UNKNOWN: 'FORM_TECHNICIAN_UNKNOWN',
  GRADES_INVALID: 'FORM_GRADES_INVALID', FUNCTIONAL_INVALID: 'FORM_FUNCTIONAL_INVALID', DEFECTS_INVALID: 'FORM_DEFECTS_INVALID', SYMPTOMS_INVALID: 'FORM_SYMPTOMS_INVALID',
  SYMPTOM_ORDER_INVALID: 'FORM_SYMPTOM_ORDER_INVALID', BATTERY_HEALTH_INVALID: 'FORM_BATTERY_HEALTH_INVALID', KNOWN_FAULT_INVALID: 'FORM_KNOWN_FAULT_INVALID', GAME_TRIED_INVALID: 'FORM_GAME_TRIED_INVALID',
  NOTE_INVALID: 'FORM_NOTE_INVALID', TIMES_INVALID: 'FORM_TIMES_INVALID', EMPTY: 'FORM_EMPTY',
};
for (const [k, v] of Object.entries(E5)) eq(R[k], v, `[١] الرمز المعتمَد (E5) ${k} بنصّه الحرفي`);
deq(Object.keys(E5).length, 15, '[١] خمسة عشر رمزاً معتمداً (E5)');
const PROPOSED = {NOT_AUTHENTICATED: 'FORM_NOT_AUTHENTICATED', SESSION_ID_REQUIRED: 'FORM_SESSION_ID_REQUIRED', NOT_ENABLED: 'FORM_NOT_ENABLED', ALREADY_SUBMITTED: 'FORM_ALREADY_SUBMITTED'};
for (const [k, v] of Object.entries(PROPOSED)) eq(R[k], v, `[١] الرمز الاقتراحي ${k}`);
const SESSION_VALUES = {SESSION_NOT_FOUND: 'SESSION_NOT_FOUND', NOT_PARTICIPANT: 'SESSION_NOT_PARTICIPANT', NOT_OWNER: 'SESSION_NOT_OWNER', SESSION_NOT_STARTED: 'SESSION_NOT_STARTED', SESSION_CANCELLED: 'SESSION_CANCELLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED', SESSION_EXPIRES_AT_INVALID: 'SESSION_EXPIRES_AT_INVALID', SESSION_STATUS_UNKNOWN: 'SESSION_STATUS_UNKNOWN', REPORT_NOT_AVAILABLE: 'SESSION_REPORT_NOT_AVAILABLE'};
for (const [k, v] of Object.entries(SESSION_VALUES)) eq(R[k], v, `[١] ${k}: قيمة المصدر القائم`);
eq(Object.keys(R).length, 15 + 4 + 9, '[١] ثمانية وعشرون رمزاً بالضبط');
eq(new Set(Object.values(R)).size, Object.keys(R).length, '[١] لا قيمتان متطابقتان');
deq(Object.keys(REFUSAL_RESPONSE).sort(), Object.values(R).filter((v) => v !== R.NOT_PARTICIPANT).sort(), '[١] لكلّ رمز ردّ — عدا NOT_PARTICIPANT الذي هو ما يراه العميل لا سبباً داخلياً');
const EXISTING_TEXTS = new Set(['يجب تسجيل الدخول', 'sessionId مطلوب', 'جلسة الفحص غير صالحة', 'الجلسة منتهية']);
for (const [reason, spec] of Object.entries(REFUSAL_RESPONSE)) {
  ok(['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition', 'already-exists'].includes(spec.code), `[١] ${reason}: رمز HttpsError معروف (${spec.code})`);
  ok(EXISTING_TEXTS.has(spec.message) || spec.message === reason, `[١] ${reason}: النصّ قائم («${spec.message}») أو رمزه نفسه رسالةً تقنيّة — لا نصّ عربي جديد يصل مستخدماً`);
  ok(Object.values(R).includes(spec.clientReasonCode), `[١] ${reason}: رمز العميل من الأسباب (${spec.clientReasonCode})`);
}
for (const gone of [R.SESSION_NOT_FOUND, R.NOT_OWNER]) {
  deq(REFUSAL_RESPONSE[gone], {code: 'permission-denied', message: 'جلسة الفحص غير صالحة', clientReasonCode: 'SESSION_NOT_PARTICIPANT'}, `[١] ${gone} يصل العميل بالردّ نفسه: لا يُكشف وجود جلسة`);
}
deq(REFUSAL_RESPONSE[R.SESSION_EXPIRED], {code: 'failed-precondition', message: 'الجلسة منتهية', clientReasonCode: 'SESSION_EXPIRED'}, '[١] الانتهاء: النصّ والرمز القائمان (كما analyzeDevice)');
deq(REFUSAL_RESPONSE[R.SLOT_SAME_TECHNICIAN], {code: 'failed-precondition', message: 'FORM_SLOT_SAME_TECHNICIAN', clientReasonCode: 'FORM_SLOT_SAME_TECHNICIAN'}, '[١] الفنّي نفسه في الفتحتين: failed-precondition (معلّق: نصّ بانتظار الاعتماد)');
deq(REFUSAL_RESPONSE[R.ALREADY_SUBMITTED], {code: 'already-exists', message: 'FORM_ALREADY_SUBMITTED', clientReasonCode: 'FORM_ALREADY_SUBMITTED'}, '[١] قفل الإرسال الثاني: already-exists');
deq(REFUSAL_RESPONSE[R.NOT_ENABLED], {code: 'failed-precondition', message: 'FORM_NOT_ENABLED', clientReasonCode: 'FORM_NOT_ENABLED'}, '[١] المحلّ غير المفعَّل: failed-precondition');
eq(REFUSAL_RESPONSE[R.NOT_AUTHENTICATED].message, 'يجب تسجيل الدخول', '[١] غير مسجَّل: النصّ القائم');

// ═══ ٢ — decideSessionGate ═══
const NOW = new Date('2026-10-18T12:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000);
const PAST = new Date(NOW.getTime() - 30 * 60 * 1000);
const O = F.OUTCOME;
const M = F.GATE_MODE;
const gate = (data, uid, mode) => F.decideSessionGate({data, uid, now: NOW, mode});
const base = {ownerId: 'owner-1', joinedBy: 'joiner-1', expiresAt: FUTURE};
deq(gate({...base, status: 'scanning'}, 'owner-1', M.SUBMIT), {outcome: O.OK}, '[٢] المالك على scanning صالحة ⟵ OK');
deq(gate({...base, status: 'completed'}, 'owner-1', M.SUBMIT), {outcome: O.OK}, '[٢] المالك على completed ⟵ OK (إرسال متأخّر دون شبكة)');
deq(gate({...base, status: 'completed', expiresAt: PAST}, 'owner-1', M.SUBMIT), {outcome: O.OK}, '[٢] completed منقضية ⟵ OK (الانقضاء لا يخصّ الجلسة المكتملة)');
deq(gate({...base, status: 'completed', expiresAt: undefined}, 'owner-1', M.SUBMIT), {outcome: O.OK}, '[٢] completed بلا expiresAt ⟵ OK');
eq(gate({...base, status: 'pending'}, 'owner-1', M.SUBMIT).refusal, R.SESSION_NOT_STARTED, '[٢] الإرسال على pending ⟵ SESSION_NOT_STARTED');
deq(gate({...base, status: 'pending'}, 'owner-1', M.CONFIG), {outcome: O.OK}, '[٢] الإعداد على pending ⟵ OK (يُحضَّر قبل الانضمام)');
eq(gate({...base, status: 'cancelled'}, 'owner-1', M.SUBMIT).refusal, R.SESSION_CANCELLED, '[٢] cancelled ⟵ SESSION_CANCELLED');
eq(gate({...base, status: 'cancelled'}, 'owner-1', M.CONFIG).refusal, R.SESSION_CANCELLED, '[٢] والإعداد كذلك');
eq(gate({...base, status: 'expired'}, 'owner-1', M.SUBMIT).refusal, R.SESSION_EXPIRED, '[٢] expired مسجَّلة ⟵ SESSION_EXPIRED');
eq(gate({...base, status: 'expired'}, 'owner-1', M.CONFIG).refusal, R.SESSION_EXPIRED, '[٢] والإعداد كذلك');
deq(gate({...base, status: 'scanning', expiresAt: PAST}, 'owner-1', M.SUBMIT), {outcome: O.EXPIRE, refusal: R.SESSION_EXPIRED}, '[٢] scanning منقضية في الإرسال ⟵ EXPIRE (تُكتب «منتهية» ثم يُرفض)');
deq(gate({...base, status: 'scanning', expiresAt: PAST}, 'owner-1', M.CONFIG), {outcome: O.OK}, '[٢] الإعداد قراءة وحدها: لا EXPIRE ولا رفض لانقضاء الوقت');
eq(gate({...base, status: 'scanning', expiresAt: new Date(NOW.getTime())}, 'owner-1', M.SUBMIT).outcome, O.OK, '[٢] expiresAt == الآن تماماً: لم تنقضِ بعد');
eq(gate({...base, status: 'scanning', expiresAt: new Date(NOW.getTime() - 1)}, 'owner-1', M.SUBMIT).outcome, O.EXPIRE, '[٢] وبعدها بمللي ثانية: انقضت');
for (const bad of [undefined, null, 'garbage']) {
  deq(gate({ownerId: 'owner-1', status: 'scanning', expiresAt: bad}, 'owner-1', M.SUBMIT), {outcome: O.REFUSED, refusal: R.SESSION_EXPIRES_AT_INVALID}, `[٢] scanning بـexpiresAt ${JSON.stringify(bad)} ⟵ EXPIRES_AT_INVALID بلا كتابة`);
}
deq(gate(null, 'owner-1', M.SUBMIT), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[٢] مستند غائب ⟵ SESSION_NOT_FOUND');
{
  const j = gate({...base, status: 'scanning'}, 'joiner-1', M.SUBMIT);
  deq([j.outcome, j.refusal, j.extra], [O.REFUSED, R.NOT_OWNER, ' role=joiner'], '[٢] **الجهاز المنضمّ ليس المالك**: الاستمارة لجهاز الفنّي (المالك) ⟵ NOT_OWNER (role=joiner في السجلّ)');
  const s = gate({...base, status: 'scanning'}, 'stranger', M.SUBMIT);
  deq([s.outcome, s.refusal, s.extra], [O.REFUSED, R.NOT_OWNER, ' role=none joinedByState=other-uid'], '[٢] غريب ⟵ NOT_OWNER (joinedByState في السجلّ)');
  const noJoin = gate({ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE}, 'stranger', M.CONFIG);
  eq(noJoin.extra, ' role=none joinedByState=absent', '[٢] بلا joinedBy: joinedByState=absent');
  const nulled = gate({ownerId: 'owner-1', status: 'scanning', joinedBy: null, expiresAt: FUTURE}, 'someone', M.SUBMIT);
  eq(nulled.extra, ' role=none joinedByState=null', '[٢] joinedBy=null (انضمّ بلا هوية): لا يساوي null بـnull');
  for (const bad of [undefined, null, '', 5]) eq(gate({...base, ownerId: bad, status: 'scanning'}, bad === undefined ? undefined : bad, M.SUBMIT).refusal, R.NOT_OWNER, `[٢] ownerId ${JSON.stringify(bad)} والمستدعي نفسه: يُرفض (الغياب ليس هويّة)`);
  eq(gate({...base, status: 'completed'}, 'stranger', M.SUBMIT).refusal, R.NOT_OWNER, '[٢] الملكية قبل الحالة: غريب على completed ⟵ NOT_OWNER');
}
for (const [label, status, state] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['لا تعرفها الشيفرة', 'done', 'UNRECOGNIZED'], ['بأحرف مختلفة', 'Scanning', 'UNRECOGNIZED']]) {
  const r = gate({...base, status}, 'owner-1', M.SUBMIT);
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.SESSION_STATUS_UNKNOWN, ` statusState=${state}`], `[٢] حالة ${label} ⟵ SESSION_STATUS_UNKNOWN وسبب القراءة في السجلّ`);
}

// ═══ ٣ — technicianState وdoubleEvalState ═══
const T = F.TECHNICIAN_STATE;
deq({...T}, {ACTIVE: 'ACTIVE', NOT_FOUND: 'NOT_FOUND', OWNER_MISMATCH: 'OWNER_MISMATCH', INACTIVE: 'INACTIVE', ACTIVE_FLAG_UNREADABLE: 'ACTIVE_FLAG_UNREADABLE'}, '[٣] حالات الفنّي بأسمائها');
eq(F.technicianState({ownerId: 'o', active: true}, 'o'), T.ACTIVE, '[٣] موجود وفعّال وملكه ⟵ ACTIVE');
eq(F.technicianState(null, 'o'), T.NOT_FOUND, '[٣] مستند غائب ⟵ NOT_FOUND');
eq(F.technicianState(undefined, 'o'), T.NOT_FOUND, '[٣] undefined ⟵ NOT_FOUND');
eq(F.technicianState({ownerId: 'other', active: true}, 'o'), T.OWNER_MISMATCH, '[٣] لمالك آخر ⟵ OWNER_MISMATCH (والملكية قبل الفعّالية)');
eq(F.technicianState({active: true}, 'o'), T.OWNER_MISMATCH, '[٣] بلا ownerId ⟵ OWNER_MISMATCH (الغياب ليس ملكيّة)');
for (const bad of [null, '', 7]) eq(F.technicianState({ownerId: bad, active: true}, bad === null ? 'o' : bad), T.OWNER_MISMATCH, `[٣] ownerId ${JSON.stringify(bad)} ⟵ OWNER_MISMATCH`);
eq(F.technicianState({ownerId: 'o', active: false}, 'o'), T.INACTIVE, '[٣] موقوف ⟵ INACTIVE (الإيقاف بدل الحذف، P:790)');
for (const bad of [undefined, null, 'true', 1, {}]) eq(F.technicianState({ownerId: 'o', active: bad}, 'o'), T.ACTIVE_FLAG_UNREADABLE, `[٣] active ${JSON.stringify(bad)} ⟵ ACTIVE_FLAG_UNREADABLE (لا يُفترض فعّالاً)`);
const D = F.DOUBLE_EVAL_STATE;
deq({...D}, {SELECTED: 'SELECTED', NOT_SELECTED: 'NOT_SELECTED', DRAW_ABSENT: 'DRAW_ABSENT', DRAW_MALFORMED: 'DRAW_MALFORMED'}, '[٣] حالات السحب بأسمائها');
eq(F.doubleEvalState({doubleEvalDraw: {selected: true, draw: 0.05, rate: 0.1, settingsVersion: 'x', decidedAt: 1}}), D.SELECTED, '[٣] selected: true ⟵ SELECTED');
eq(F.doubleEvalState({doubleEvalDraw: {selected: false}}), D.NOT_SELECTED, '[٣] selected: false ⟵ NOT_SELECTED');
for (const [label, v] of [['مستند protocolPending غائب', null], ['بلا doubleEvalDraw', {}], ['doubleEvalDraw null', {doubleEvalDraw: null}]]) eq(F.doubleEvalState(v), D.DRAW_ABSENT, `[٣] ${label} ⟵ DRAW_ABSENT («لا يُفترض 10%»، P:893)`);
for (const bad of [{selected: 'true'}, {selected: 1}, {}, {selected: null}, 'x', [], 5]) eq(F.doubleEvalState({doubleEvalDraw: bad}), D.DRAW_MALFORMED, `[٣] doubleEvalDraw ${JSON.stringify(bad)} ⟵ DRAW_MALFORMED (لا يُقرأ سحباً)`);

// ═══ ٤ — refuse ═══
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { F.refuse('submitTechnicianForm', R.NOT_OWNER, {sessionId: 'session-aaa-111', uid: 'uid-bbb-222', extra: ' role=joiner'}); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'permission-denied' && thrown.message === 'جلسة الفحص غير صالحة', '[٤] refuse ترمي بردّ السبب');
    deq(thrown.details, {reasonCode: 'SESSION_NOT_PARTICIPANT'}, '[٤] details = {reasonCode: NOT_PARTICIPANT}');
    eq(warns[0], `[submitTechnicianForm] refused reason=SESSION_NOT_OWNER session=${hashIdForLog('session-aaa-111')} caller=${hashIdForLog('uid-bbb-222')} role=joiner`, '[٤] السطر: السبب والمعرّفان مُهشَّران وحالة الدور');
    ok(!warns[0].includes('session-aaa-111') && !warns[0].includes('uid-bbb-222'), '[٤] لا معرّف خامّ');
    warns.length = 0;
    try { F.refuse('getTechnicianFormConfig', R.NOT_AUTHENTICATED); } catch (e) { thrown = e; }
    eq(warns[0], `[getTechnicianFormConfig] refused reason=FORM_NOT_AUTHENTICATED caller=${hashIdForLog(null)}`, '[٤] اسم الدالّة في السطر؛ بلا هوية ولا جلسة: بلا session=');
    ok(!/session=/.test(warns[0]), '[٤] ولا حقل session');
    warns.length = 0;
    try { F.refuse('recordReportFirstOpened', R.REPORT_NOT_AVAILABLE, {sessionId: 's', uid: 'u', extra: ' status=scanning'}); } catch (e) { thrown = e; }
    deq([thrown.code, thrown.message, thrown.details], ['permission-denied', 'جلسة الفحص غير صالحة', {reasonCode: 'SESSION_REPORT_NOT_AVAILABLE'}], '[٤] REPORT_NOT_AVAILABLE: كما analyzeDevice');
    let bad = null;
    warns.length = 0;
    try { F.refuse('submitTechnicianForm', 'NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message) && warns.length === 0, '[٤] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}

// ═══ ٥ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const read = (f) => strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'evaluations', f), 'utf8'));
const source = read('technicianForm.js');
const contract = read('technicianFormContract.js');
const refusalSrc = read('technicianFormRefusal.js');
const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
eq(throwSites.length, 1, '[٥] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
const refuseDef = source.indexOf('function refuse(');
const refuseEnd = source.indexOf('\n}\n', refuseDef);
ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٥] وهو داخل refuse — فرمي رفض جديد بلا سبب مسمّى يُفشل هنا');
deq([...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort(), ['e', 'e', 'e', 'new Error', 'new HttpsError'], '[٥] خمسة throw: رمي refuse، وخطأ السبب غير المُدرَج، وثلاث إعادات رمي للفشل غير المتوقَّع كما هو (throw e)');
for (const name of Object.keys(R)) {
  const used = new RegExp(`\\bR\\.${name}\\b`).test(source + refusalSrc) || new RegExp(`\\bFORM_REFUSAL\\.${name}\\b`).test(contract);
  ok(used, `[٥] الرمز ${name} مستعمَل (في الدوالّ أو العقد أو جدول الردود)`);
}
ok(!/refuse\(\s*[A-Z_]+\s*,\s*["'`]/.test(source), '[٥] ولا نداء refuse بسبب نصّ حرفي');
ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source + contract + refusalSrc), '[٥] لا حذف في أيّ من ملفّات الاستمارة الثلاثة (القاعدة 42)');
ok(!/["'`](pending|scanning|completed|expired|cancelled)["'`]/.test(source), '[٥] لا نصّ حرفي لحالة جلسة (SESSION_STATUS من sessionNames.js)');
ok(!/["'`](technicianForms|protocolPending|technicians|scanProtocol)["'`]/.test(source), '[٥] أسماء المجموعات الجديدة من PROTOCOL_COLLECTION لا حرفيّة');
ok(!/weak_battery|cpu_performance|submitEvaluation/.test(source + contract), '[٥] لا weak_battery (مؤجَّل) ولا فئات v1 ولا اتّصال بمسار v1');
// المعاملات: submit
{
  const txStart = source.indexOf('decided = await db.runTransaction(', source.indexOf('const submitTechnicianFormHandler'));
  const txEnd = source.indexOf('} catch (e) {', txStart);
  const tx = source.slice(txStart, txEnd);
  ok(txStart > 0 && txEnd > txStart, '[٥] معاملة الإرسال موجودة');
  ok(!/throw\s/.test(tx), '[٥] **لا throw داخل دالّة معاملة الإرسال** — تُرجِع قراراً (الرمي يُسقط كتابة «منتهية»)');
  const writes = [...tx.matchAll(/tx\.(update|create|set|delete)\(/g)].map((m) => m[1]);
  deq(writes, ['update', 'create'], '[٥] كتابتان لا غير: «منتهية» (EXPIRE) ثم إنشاء المستند — بـcreate لا set ولا delete («ولا tx.set فوقه»: P:1312)');
  ok(Math.max(...[...tx.matchAll(/tx\.get\(/g)].map((m) => m.index)) < tx.indexOf('tx.create('), '[٥] كل القراءات قبل الإنشاء (شرط معاملات Firestore)');
  ok(/tx\.create\(formRef,/.test(tx), '[٥] الإنشاء على formRef: `${sessionId}_${slot}` وحده');
  ok(/const formRef = db\.collection\(PROTOCOL_COLLECTION\.TECHNICIAN_FORMS\)\.doc\(`\$\{sessionId\}_\$\{form\.slot\}`\)/.test(source), '[٥] معرّف المستند {sessionId}_{slot} (E: A0)');
  // الترتيب: الجلسة ← evaluationEnabled ← الإرسال السابق ← الفنّي ← السحب ← الفنّي نفسه
  const order = ['decideSessionGate(', 'evaluationEnabledDecision(', 'R.ALREADY_SUBMITTED', 'technicianState(', 'doubleEvalState(', 'R.SLOT_SAME_TECHNICIAN'].map((s) => tx.indexOf(s));
  ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `[٥] ترتيب الأحكام: الجلسة ثم التفعيل ثم القفل ثم الفنّي ثم السحب ثم الفنّي نفسه (${order.join(',')})`);
}
// المعاملة: recordReportFirstOpened
{
  const start = source.indexOf('decided = await db.runTransaction(', source.indexOf('const recordReportFirstOpenedHandler'));
  const end = source.indexOf('} catch (e) {', start);
  const tx = source.slice(start, end);
  ok(start > 0 && end > start && !/throw\s/.test(tx), '[٥] معاملة التسجيل: لا throw داخلها');
  deq([...tx.matchAll(/tx\.(update|create|set|delete)\(/g)].map((m) => m[1]), ['set'], '[٥] كتابة واحدة: set بالدمج لـreportFirstOpenedAt');
  ok(/tx\.set\(pendingRef, \{reportFirstOpenedAt: admin\.firestore\.FieldValue\.serverTimestamp\(\)\}, \{merge: true\}\)/.test(tx), '[٥] والدمج لا الاستبدال (لا يمسّ بقيّة protocolPending)');
  ok(Math.max(...[...tx.matchAll(/tx\.get\(/g)].map((m) => m.index)) < tx.indexOf('tx.set('), '[٥] القراءات قبل الكتابة');
  ok(tx.indexOf('already') > 0 && tx.indexOf('already') < tx.indexOf('tx.set('), '[٥] «أوّل فتح يربح»: يُفحص ما سُجّل قبل الكتابة');
}
// الاستعلامات: مساواة بلا ترتيب ولا مدى (A0 البند ٩، القاعدة 43)
{
  const wheres = [...source.matchAll(/\.where\(([^)]*)\)/g)].map((m) => m[1]);
  deq(wheres, ['"ownerId", "==", uid', '"active", "==", true'], '[٥] استعلام واحد بمساواتين: ownerId وactive (فنّيو المالك الفعّالون)');
  ok(!/orderBy|\.limit\(|startAt|startAfter|endAt|"<"|">"|"<="|">="|"in"|"array-contains/.test(source), '[٥] لا ترتيب ولا حدّ ولا مدى ولا in (لا فهرس جديد: القاعدة 43)');
}
// السجلّ: لا ملاحظة ولا اسم فنّي ولا قيمة خام
{
  const logLines = source.split('\n').filter((l) => /console\.(log|warn|error)\(/.test(l) || /^\s+[`'"].*\$\{/.test(l));
  const blob = logLines.join('\n');
  ok(logLines.length >= 8, `[٥] سطور السجلّ (${logLines.length})`);
  ok(!/observedNote|displayName|\.note\b|grades|symptoms|batteryHealth|technicianId[^)]*\)\}(?!\))/.test(blob.replace(/hashIdForLog\([^)]*\)/g, '')), '[٥] لا ملاحظة ولا اسم عرض ولا درجات ولا أعراض في أيّ سطر سجلّ');
  ok(/hashIdForLog\(sessionId\)/.test(blob) && /hashIdForLog\(form\.technicianId\)/.test(blob) && /hashIdForLog\(uid\)/.test(blob), '[٥] المعرّفات الثلاثة (الجلسة والفنّي والمستدعي) عبر hashIdForLog');
}
ok(/evaluationEnabledDecision/.test(source) && /require\("\.\.\/sessions\/evaluationEnabledState"\)/.test(source), '[٥] التفعيل بالحكم القائم evaluationEnabledDecision (مصدر واحد)');
ok(/sessionRoleOf/.test(source), '[٥] الدور بـsessionRoleOf القائمة (مصدر المقارنة الواحد)');
deq(Object.keys(F).sort(), ['DOUBLE_EVAL_STATE', 'GATE_MODE', 'OUTCOME', 'TECHNICIAN_STATE', 'decideSessionGate', 'doubleEvalState', 'getTechnicianFormConfig', 'getTechnicianFormConfigHandler', 'recordReportFirstOpened',
  'recordReportFirstOpenedHandler', 'refuse', 'submitTechnicianForm', 'submitTechnicianFormHandler', 'technicianState'], '[٥] التصدير: الدوالّ الثلاث ومعالجاتها وأحكامها (لا أسماء حقول)');

console.log(`\ntechnicianFormGuard.test.js: ${n}/${n} assertions passed`);
