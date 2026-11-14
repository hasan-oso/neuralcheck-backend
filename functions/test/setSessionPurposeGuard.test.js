'use strict';

// setSessionPurposeGuard.test.js — قرار اختيار غرض الجلسة النقيّ وحرّاس بنية setSessionPurpose (S-P6-03، 2026-10-18 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي في
// scanProtocolPurpose.e2e.test.js.
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٢-ب-٣ (:480-485) وdocs/PROTOCOL_CONTRACT.md §٢ A2: «ولمسة على غيرها تنادي `setSessionPurpose` (دالّة جديدة للمالك). ويُقبل التغيير ما دامت الجلسة `pending`.
// وبعد الانضمام تُقفل الرقائق بنصّ.» والرمز PURPOSE_SESSION_NOT_PENDING معتمد (E5، 2026-10-15).
//   ١ decideSetPurpose: جدول (مالك × حالة × وقت): الوجود ثم الملكية ثم الحالة ثم الانقضاء
//   ٢ ردود الرفض: لكلّ رمز ردّ، ولا نصّ عربي جديد (معلّق: نصّ بانتظار الاعتماد)، والجلسة غير الموجودة وغير المالك سواء عند العميل
//   ٣ refuse: السطر المسمّى بمعرّفات مُهشَّرة
//   ٤ بنية الشيفرة: موضع رمي واحد، كل رمز مستعمَل، لا حذف، المعاملة تُرجِع قراراً، الكتابة محصورة بثلاث
//   ٥ (2026-10-22، A2) نوع العطل: الرفض بأسبابه الثلاثة قبل أيّ قراءة للجلسة، وbattery_* لم تعد مما يُختار، وترتيب الفحوص
//
// Run: node functions/test/setSessionPurposeGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const P = require('../src/sessions/setSessionPurpose');
const {SET_PURPOSE_REFUSAL: R} = require('../src/sessions/sessionNames');
const {hashIdForLog} = require('../src/utils/logRedaction');

const NOW = new Date('2026-10-18T12:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000);
const PAST = new Date(NOW.getTime() - 30 * 60 * 1000);
const O = P.OUTCOME;
const decide = (data, uid) => P.decideSetPurpose({data, uid, now: NOW});
const base = {ownerId: 'owner-1', joinedBy: 'joiner-1', expiresAt: FUTURE};

// ═══ ١ — decideSetPurpose ═══
deq(decide({...base, status: 'pending'}, 'owner-1'), {outcome: O.SET}, '[١] المالك على pending صالحة ⟵ SET');
deq(decide({ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE}, 'owner-1'), {outcome: O.SET}, '[١] pending بلا joinedBy (الحالة العادية) ⟵ SET');
deq(decide({...base, status: 'pending', purpose: 'battery_before'}, 'owner-1'), {outcome: O.SET}, '[١] ولها غرض سابق: يُغيَّر ما دامت pending (لا يُقفل قبل الانضمام)');
deq(decide({...base, status: 'pending', purpose: undefined}, 'owner-1'), {outcome: O.SET}, '[١] جلسة أُنشئت قبل النشر (بلا purpose) تقبل الاختيار');
// الوجود والملكية
deq(decide(null, 'owner-1'), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[١] مستند غائب ⟵ SESSION_NOT_FOUND');
deq(decide(undefined, 'owner-1'), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[١] مستند undefined ⟵ SESSION_NOT_FOUND');
{
  const r = decide({...base, status: 'pending'}, 'someone-else');
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_OWNER, ' ownerState=SET'], '[١] غريب ⟵ NOT_OWNER (ownerState=SET في السجلّ)');
  const j = decide({...base, status: 'pending'}, 'joiner-1');
  eq(j.refusal, R.NOT_OWNER, '[١] **المنضمّ ليس المالك**: الاختيار للمالك وحده ⟵ NOT_OWNER');
  for (const bad of [undefined, null, '']) {
    const x = decide({...base, ownerId: bad, status: 'pending'}, bad === undefined ? undefined : bad);
    deq([x.outcome, x.refusal, x.extra], [O.REFUSED, R.NOT_OWNER, ' ownerState=ABSENT'], `[١] ownerId ${JSON.stringify(bad)} والمستدعي نفسه القيمة: يُرفض (لا يتساوى الغياب بالغياب) وownerState=ABSENT`);
  }
  eq(decide({...base, ownerId: 5, status: 'pending'}, 5).refusal, R.NOT_OWNER, '[١] ownerId رقم: يُرفض');
  eq(decide({...base, status: 'pending'}, null).refusal, R.NOT_OWNER, '[١] ومستدعٍ بلا uid: يُرفض');
}
// الملكية قبل الحالة: غريب على completed يُرفض بالملكية (لا يُكشف شيء عن الجلسة)
eq(decide({...base, status: 'completed'}, 'stranger').refusal, R.NOT_OWNER, '[١] غريب على completed: NOT_OWNER لا NOT_PENDING (الملكية قبل الحالة)');
eq(decide({...base, status: 'scanning'}, 'stranger').refusal, R.NOT_OWNER, '[١] غريب على scanning: NOT_OWNER');
// الحالات غير pending: بعد الانضمام تُقفل الرقائق
for (const status of ['scanning', 'completed', 'cancelled', 'expired']) {
  const r = decide({...base, status}, 'owner-1');
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_PENDING, ` status=${status}`], `[١] المالك على ${status} ⟵ PURPOSE_SESSION_NOT_PENDING (الحالة في السجلّ)`);
}
{
  // الحالة قبل الانقضاء: scanning منقضية تُرفض بالحالة (لا تُكتب «منتهية» من هنا: الكاتب الوحيد لـexpired هنا يخصّ pending وحدها)
  const r = decide({...base, status: 'scanning', expiresAt: PAST}, 'owner-1');
  deq([r.outcome, r.refusal], [O.REFUSED, R.NOT_PENDING], '[١] scanning منقضية: NOT_PENDING بلا EXPIRE');
  const c = decide({...base, status: 'completed', expiresAt: PAST}, 'owner-1');
  eq(c.refusal, R.NOT_PENDING, '[١] completed منقضية: NOT_PENDING (النهائية لا تتحوّل)');
}
for (const [label, status, state] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['لا تعرفها الشيفرة', 'done', 'UNRECOGNIZED'], ['بأحرف مختلفة', 'Pending', 'UNRECOGNIZED']]) {
  const r = decide({...base, status}, 'owner-1');
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.STATUS_UNKNOWN, ` statusState=${state}`], `[١] حالة ${label} ⟵ STATUS_UNKNOWN وسبب القراءة في السجلّ (لا تُقرأ pending من الغياب)`);
}
// الانقضاء (pending فقط)
{
  const r = decide({...base, status: 'pending', expiresAt: PAST}, 'owner-1');
  deq([r.outcome, r.refusal], [O.EXPIRE, R.EXPIRED], '[١] pending منقضية ⟵ EXPIRE (تُكتب «منتهية» ثم يُرفض النداء)');
  eq(decide({...base, status: 'pending', expiresAt: new Date(NOW.getTime())}, 'owner-1').outcome, O.SET, '[١] expiresAt == الآن تماماً: لم تنقضِ بعد');
  eq(decide({...base, status: 'pending', expiresAt: new Date(NOW.getTime() - 1)}, 'owner-1').outcome, O.EXPIRE, '[١] وبعدها بمللي ثانية: انقضت');
  for (const bad of [undefined, null, 'garbage', {seconds: 1}]) {
    const x = decide({ownerId: 'owner-1', status: 'pending', expiresAt: bad}, 'owner-1');
    deq([x.outcome, x.refusal], [O.REFUSED, R.EXPIRES_AT_INVALID], `[١] expiresAt ${JSON.stringify(bad)} ⟵ EXPIRES_AT_INVALID بلا كتابة (لا «صالحة» ولا «منتهية»)`);
  }
}

// ═══ ٢ — ردود الرفض ═══
ok(Object.isFrozen(P.REFUSAL_RESPONSE) && Object.isFrozen(P.OUTCOME), '[٢] REFUSAL_RESPONSE وOUTCOME مجمَّدان');
deq(Object.keys(P.REFUSAL_RESPONSE).sort(), Object.values(R).filter((v) => v !== R.NOT_PARTICIPANT).sort(), '[٢] لكلّ رمز في SET_PURPOSE_REFUSAL ردّ — عدا NOT_PARTICIPANT الذي هو ما يراه العميل لا سبب داخلياً');
const EXISTING_TEXTS = new Set(['يجب تسجيل الدخول', 'جلسة الفحص غير صالحة', 'الجلسة منتهية', 'sessionId مطلوب']);
for (const [reason, spec] of Object.entries(P.REFUSAL_RESPONSE)) {
  ok(['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition'].includes(spec.code), `[٢] ${reason}: رمز HttpsError معروف (${spec.code})`);
  ok(EXISTING_TEXTS.has(spec.message) || spec.message === reason, `[٢] ${reason}: النصّ إمّا قائم («${spec.message}») وإمّا رمزه نفسه رسالةً تقنيّة — لا نصّ عربي جديد يصل مستخدماً`);
  ok(Object.values(R).includes(spec.clientReasonCode), `[٢] ${reason}: رمز العميل من SET_PURPOSE_REFUSAL (${spec.clientReasonCode})`);
}
for (const gone of [R.SESSION_NOT_FOUND, R.NOT_OWNER]) {
  const spec = P.REFUSAL_RESPONSE[gone];
  deq([spec.code, spec.message, spec.clientReasonCode], ['permission-denied', 'جلسة الفحص غير صالحة', R.NOT_PARTICIPANT], `[٢] ${gone} يصل العميل بالردّ نفسه: لا يُكشف وجود جلسة (NOT_PARTICIPANT)`);
}
deq(P.REFUSAL_RESPONSE[R.NOT_PENDING], {code: 'failed-precondition', message: 'PURPOSE_SESSION_NOT_PENDING', clientReasonCode: 'PURPOSE_SESSION_NOT_PENDING'}, '[٢] PURPOSE_SESSION_NOT_PENDING: failed-precondition ورسالته رمزه (النصّ العربي الذي يراه الفنّي معلّق: نصّ بانتظار الاعتماد، PROTOCOL_CONTRACT §٥-أ B9)');
deq(P.REFUSAL_RESPONSE[R.EXPIRED], {code: 'failed-precondition', message: 'الجلسة منتهية', clientReasonCode: 'SESSION_EXPIRED'}, '[٢] انتهاء الصلاحية: النصّ والرمز القائمان لـsessionTimeout.js');
deq(P.REFUSAL_RESPONSE[R.EXPIRES_AT_INVALID], {code: 'permission-denied', message: 'جلسة الفحص غير صالحة', clientReasonCode: 'SESSION_EXPIRES_AT_INVALID'}, '[٢] غياب expiresAt: النصّ والرمز القائمان');
eq(P.REFUSAL_RESPONSE[R.NOT_AUTHENTICATED].message, 'يجب تسجيل الدخول', '[٢] غير مسجَّل: النصّ القائم نفسه في cancelScanSession');
for (const name of ['PURPOSE_REQUIRED', 'PURPOSE_INVALID', 'STATUS_UNKNOWN']) {
  eq(P.REFUSAL_RESPONSE[R[name]].message, R[name], `[٢] ${name}: الرسالة هي الرمز نفسه (لا عربية جديدة)`);
}
eq(P.REFUSAL_RESPONSE[R.PURPOSE_REQUIRED].code, 'invalid-argument', '[٢] غياب الغرض: invalid-argument (لا قيمة افتراضية تسدّ الغياب)');
eq(P.REFUSAL_RESPONSE[R.PURPOSE_INVALID].code, 'invalid-argument', '[٢] غرض خارج المفردات الثلاث: invalid-argument');

// ═══ ٣ — refuse ═══
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { P.refuse(R.NOT_OWNER, {sessionId: 'session-aaa-111', uid: 'uid-bbb-222', extra: ' ownerState=SET'}); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'permission-denied' && thrown.message === 'جلسة الفحص غير صالحة', '[٣] refuse ترمي بردّ السبب');
    deq(thrown.details, {reasonCode: 'SESSION_NOT_PARTICIPANT'}, '[٣] details = {reasonCode: NOT_PARTICIPANT} للمالك المزعوم الخاطئ');
    eq(warns[0], `[setSessionPurpose] refused reason=SESSION_NOT_OWNER session=${hashIdForLog('session-aaa-111')} caller=${hashIdForLog('uid-bbb-222')} ownerState=SET`, '[٣] والسجلّ يقول NOT_OWNER بمعرّفين مُهشَّرين وحالة المالك');
    ok(!warns[0].includes('session-aaa-111') && !warns[0].includes('uid-bbb-222'), '[٣] لا معرّف خامّ');
    warns.length = 0;
    try { P.refuse(R.NOT_AUTHENTICATED); } catch (e) { thrown = e; }
    eq(warns[0], `[setSessionPurpose] refused reason=SET_PURPOSE_NOT_AUTHENTICATED caller=${hashIdForLog(null)}`, '[٣] بلا هوية ولا جلسة: بلا session=');
    ok(!/session=/.test(warns[0]), '[٣] ولا حقل session');
    warns.length = 0;
    try { P.refuse(R.SESSION_NOT_FOUND, {sessionId: 'x', uid: 'y'}); } catch (e) { thrown = e; }
    eq(thrown.details.reasonCode, 'SESSION_NOT_PARTICIPANT', '[٣] SESSION_NOT_FOUND يصل العميل NOT_PARTICIPANT');
    ok(/ reason=SESSION_NOT_FOUND /.test(warns[0]), '[٣] والسجلّ يقول SESSION_NOT_FOUND');
    warns.length = 0;
    try { P.refuse(R.NOT_PENDING, {sessionId: 's', uid: 'u', extra: ' status=scanning'}); } catch (e) { thrown = e; }
    deq([thrown.code, thrown.message, thrown.details], ['failed-precondition', 'PURPOSE_SESSION_NOT_PENDING', {reasonCode: 'PURPOSE_SESSION_NOT_PENDING'}], '[٣] NOT_PENDING: الرمز والرسالة والتفصيل');
    ok(/ status=scanning$/.test(warns[0]), '[٣] وحالة الجلسة في السجلّ');
    let bad = null;
    warns.length = 0;
    try { P.refuse('NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message) && warns.length === 0, '[٣] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}

// ═══ ٤ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'setSessionPurpose.js'), 'utf8').replace(/\r\n/g, '\n'));
const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
eq(throwSites.length, 1, '[٤] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
const refuseDef = source.indexOf('function refuse(');
const refuseEnd = source.indexOf('\n}\n', refuseDef);
ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٤] وهو داخل refuse — فرمي رفض جديد بلا سبب مسمّى يُفشل هنا');
const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٤] ثلاثة throw: رمي refuse، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما هو (throw e)');
for (const name of Object.keys(R)) {
  ok(new RegExp(`\\bR\\.${name}\\b`).test(source), `[٤] الرمز ${name} مستعمَل في setSessionPurpose.js`);
}
ok(!/refuse\(\s*["'`]/.test(source), '[٤] ولا نداء refuse بسبب نصّ حرفي');
ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source), '[٤] لا حذف في setSessionPurpose.js (القاعدة 42)');
ok(!/["'`](pending|scanning|completed|expired|cancelled)["'`]/.test(source), '[٤] لا نصّ حرفي لحالة جلسة (SESSION_STATUS من sessionNames.js)');
ok(!/["'`](normal|battery_before|battery_after|selected|default|feature_disabled)["'`]/.test(source), '[٤] ولا نصّ حرفي لغرض أو مصدر غرض (protocolVocabulary)');
// المعاملة: قراءة واحدة قبل كل كتابة، ولا رمي داخلها (يُسقط كتابة «منتهية»)
const txStart = source.indexOf('db.runTransaction(');
const txEnd = source.indexOf('} catch (e) {', txStart);
ok(txStart > 0 && txEnd > txStart, '[٤] المعاملة موجودة');
const txBody = source.slice(txStart, txEnd);
ok(!/throw\s/.test(txBody), '[٤] **لا throw داخل دالّة المعاملة** — تُرجِع قراراً (الرمي يُسقط كتابة «منتهية»)');
const gets = [...txBody.matchAll(/tx\.get\(/g)];
const writes = [...txBody.matchAll(/tx\.(update|set)\(/g)];
// (ق31، 2026-10-22، القاعدة 23: كان «قراءة واحدة (مستند الجلسة)»؛ صار قراءتين: الجلسة ثم مستند المالك لفحص جزء المحلّ)
eq(gets.length, 2, '[٤] قراءتان داخل المعاملة: مستند الجلسة ثم مستند المالك (ق31)');
eq(writes.length, 3, '[٤] ثلاث كتابات لا غير: «منتهية» (EXPIRE) · غرض الجلسة · مصدر الغرض (protocolPending)');
// (ق31، القاعدة 23: كان «كل القراءات قبل أوّل كتابة» نصّياً؛ فرع «منتهية» يكتب ثم يعود قبل قراءة المالك، فالشرط صار بالتنفيذ: قراءة الجلسة قبل كل كتابة، وقراءة المالك بعد قرار الجلسة وقبل كتابتَي الاختيار — ويثبّته pairFakeDb (قراءة بعد كتابة ترمي) في setSessionPurposePart.test.js)
const iSessionGet = txBody.indexOf('tx.get(sessionRef)');
const iOwnerGet = txBody.indexOf('tx.get(ownerRef)');
const iDecide = txBody.indexOf('decideSetPurpose(');
const iSetWrite = txBody.indexOf('tx.update(sessionRef, {purpose})');
ok(iSessionGet >= 0 && iSessionGet < Math.min(...writes.map((m) => m.index)), '[٤] قراءة الجلسة قبل أول كتابة (شرط معاملات Firestore)');
ok(iOwnerGet > iDecide && iDecide > iSessionGet && iOwnerGet < iSetWrite, '[٤] قراءة مستند المالك (tx.get(ownerRef)) بعد قرار الجلسة decideSetPurpose وقبل كتابتَي الاختيار (ق31)');
ok(/readProtocolParts\(/.test(txBody) || /decidePurposePart\(/.test(txBody), '[٤] فحص الجزء داخل المعاملة نفسها');
ok(/refuse\(decided\.refusal/.test(source) && /R\.PART_NOT_ENABLED/.test(source), '[٤] الرفض بالرمز المسمّى R.PART_NOT_ENABLED عبر refuse الوحيدة (ق31)');
ok(!/["'`](purposes|batteryBeforeAfter)["'`]/.test(source), '[٤] لا نصّ حرفي لاسم جزء (PROTOCOL_PART من protocolVocabulary: المصدر الواحد، القاعدة 24)');
ok(/PROTOCOL_PART\.PURPOSES/.test(source) && /PROTOCOL_PART\.BATTERY_BEFORE_AFTER/.test(source), '[٤] الجزءان من PROTOCOL_PART (purposes ثم batteryBeforeAfter)');
const rawSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'setSessionPurpose.js'), 'utf8');
ok(!/لا يتحقّق هذا النداء من تفعيل جزء الأغراض للمحلّ/.test(rawSource) && /ق31/.test(rawSource), '[٤] تعليق «لا يتحقّق» (:31-32) استُبدل بالحقيقة وبرقم القرار ق31');
ok(/tx\.update\(sessionRef, expiredWriteFields\(admin\.firestore\.FieldValue\)\)/.test(txBody), '[٤] كتابة «منتهية» بالدالّة القائمة expiredWriteFields (لا حقول مكرَّرة)');
ok(/tx\.update\(sessionRef, \{purpose\}\)/.test(txBody), '[٤] الغرض يُكتب في مستند الجلسة بحقل purpose وحده (لا شيء آخر من مستندها)');
// (2026-10-22، القاعدة 23: كان يثبّت كتابة المصدر وحدها؛ استُبدل: المصدر مع نوع العطل ومسح اختيار الربط، بالدمج)
ok(/tx\.set\(pendingRef, \{purposeSource: PURPOSE_SOURCE\.SELECTED, \.\.\.pendingFieldsForPurposeChoice\(\{defectType\}\)\}, \{merge: true\}\)/.test(txBody), '[٤] المصدر selected ونوع العطل ومسح اختيار الربط يُدمَجون في protocolPending (لا استبدال المستند، لا حذف حقول)');
{
  // ترتيب الشيفرة: فحص نوع العطل قبل أيّ لمسة للقاعدة (db.collection) — فرفضه لا يقرأ جلسة
  const iType = source.indexOf('validateDefectTypeForPurpose(');
  const iDb = source.indexOf('db.collection(');
  ok(iType > 0 && iDb > iType, '[٤] validateDefectTypeForPurpose قبل أوّل db.collection في الشيفرة (رفض النوع قبل أيّ قراءة)');
  ok(/refuse\(typeCheck\.refusal,/.test(source), '[٤] رفض النوع بسببه المسمّى من الفاحص نفسه (لا نصّ حرفي)');
  ok(!/["'`](BATTERY|CHARGING_PORT|THERMAL|MOTHERBOARD|SOFTWARE|maintenance_before|maintenance_after|defectType)["'`]/.test(source), '[٤] لا نصّ حرفي لنوع عطل ولا لغرض صيانة ولا لاسم حقل النوع في setSessionPurpose.js (المصدر: protocolVocabulary وmaintenancePair)');
}
ok(/db\.collection\(PROTOCOL_COLLECTION\.PROTOCOL_PENDING\)\.doc\(sessionId\)/.test(source), '[٤] مرجع protocolPending باسم المجموعة من protocolVocabulary وبمعرّف الجلسة');
ok(!/\.where\(/.test(source), '[٤] لا استعلام (قراءة بمعرّف مستند وحده: لا فهرس، القاعدة 43)');

(async () => {
  // ═══ ٥ — نوع العطل (2026-10-22، A2): الرفض **قبل أيّ قراءة للجلسة**؛ والغرضان الجديدان؛ وbattery_* لم تعد تُختار ═══
  // المعالج نفسه بلا Firestore: كل رفض هنا يقع قبل أوّل لمسة للقاعدة (يثبّته [٤] بترتيب الشيفرة)، فنداء بلا قاعدة يكفي لإثبات الرفض والسطر.
  {
    const H = P.setSessionPurposeHandler;
    const warns = [];
    const realWarn = console.warn;
    const drive = async (data, auth = {uid: 'owner-1'}) => {
      warns.length = 0;
      let thrown = null;
      console.warn = (...a) => { warns.push(a.join(' ')); };
      try { await H({data, auth}); } catch (e) { thrown = e; } finally { console.warn = realWarn; }
      return {thrown, line: warns[0] || null};
    };
    const expectType = async (label, data, reason, extraEnd) => {
      const {thrown, line} = await drive({sessionId: 'sess-1', ...data});
      ok(thrown !== null, `[٥] ${label}: يُرفض`);
      deq([thrown.code, thrown.message, thrown.details], ['invalid-argument', reason, {reasonCode: reason}], `[٥] ${label}: invalid-argument والرسالة رمزه التقني (لا نصّ عربي جديد) والتفصيل`);
      ok(line !== null && line.startsWith(`[setSessionPurpose] refused reason=${reason} session=${hashIdForLog('sess-1')} caller=${hashIdForLog('owner-1')}`), `[٥] ${label}: سطر رفض مسمّى بالسبب ${reason} ومعرّفين مُهشَّرين — ${line}`);
      if (extraEnd !== undefined) ok(line.endsWith(extraEnd), `[٥] ${label}: وتذييل السطر «${extraEnd}» (نوع القيمة المُرسَلة لا قيمتها) — ${line}`);
      ok(!line.includes('sess-1') && !line.includes('owner-1'), `[٥] ${label}: لا معرّف خامّ`);
      return line;
    };
    // REQUIRED: maintenance_* بلا نوع (غائب لا null)
    for (const purpose of ['maintenance_before', 'maintenance_after']) {
      await expectType(`${purpose} بلا defectType`, {purpose}, 'DEFECT_TYPE_REQUIRED', ` purpose=${purpose}`);
      await expectType(`${purpose} بـdefectType: undefined (المفتاح حاضر والقيمة غائبة)`, {purpose, defectType: undefined}, 'DEFECT_TYPE_REQUIRED', ` purpose=${purpose}`);
    }
    // INVALID: أيّ قيمة مُرسَلة خارج DEFECT_TYPE بالضبط
    for (const [label, bad, kind] of [
      ['«OTHER»', 'OTHER', 'string'], ['نصّ فارغ', '', 'string'], ['مسافات', '  ', 'string'], ['أحرف صغيرة «battery»', 'battery', 'string'], ['أحرف مختلطة «Battery»', 'Battery', 'string'],
      ['«BATTERY » بمسافة في الذيل', 'BATTERY ', 'string'], ['«SCREEN» (الشاشة ليست نوعاً)', 'SCREEN', 'string'], ['«MIXED»', 'MIXED', 'string'], ['رقم', 5, 'number'], ['صفر', 0, 'number'],
      ['null (مُرسَل ≠ غائب)', null, 'null'], ['كائن', {a: 1}, 'object'], ['مصفوفة بنوع صحيح', ['BATTERY'], 'array'], ['منطقي', true, 'boolean'],
    ]) {
      for (const purpose of ['maintenance_before', 'maintenance_after']) {
        const line = await expectType(`${purpose} ونوع ${label}`, {purpose, defectType: bad}, 'DEFECT_TYPE_INVALID', ` purpose=${purpose} given=${kind}`);
        if (typeof bad === 'string' && bad.trim() !== '') ok(!line.includes(bad), `[٥] نوع ${label}: القيمة المُرسَلة لا تُطبع في السجلّ`);
      }
    }
    // NOT_APPLICABLE: نوع مُرسَل مع normal (ولو null أو فارغاً)
    for (const [label, given, kind] of [['«BATTERY»', 'BATTERY', 'string'], ['null', null, 'null'], ['نصّ فارغ', '', 'string'], ['«OTHER»', 'OTHER', 'string'], ['رقم', 3, 'number']]) {
      await expectType(`normal ونوع ${label}`, {purpose: 'normal', defectType: given}, 'DEFECT_TYPE_NOT_APPLICABLE', ` purpose=normal given=${kind}`);
    }
    // الغرضان القديمان لم يعودا مما يُختار: SET_PURPOSE_INVALID **قبل** فحص النوع (حتى مع نوع صحيح)
    for (const purpose of ['battery_before', 'battery_after']) {
      for (const defectType of [undefined, 'BATTERY']) {
        const {thrown, line} = await drive({sessionId: 'sess-1', purpose, defectType});
        deq([thrown.code, thrown.message, thrown.details], ['invalid-argument', 'SET_PURPOSE_INVALID', {reasonCode: 'SET_PURPOSE_INVALID'}], `[٥] ${purpose}${defectType ? ' مع نوع صحيح' : ''}: لم يعد مما يُختار ⟵ SET_PURPOSE_INVALID (قيمة قراءة تاريخية)`);
        ok(line.startsWith('[setSessionPurpose] refused reason=SET_PURPOSE_INVALID '), `[٥] ${purpose}: والسطر المسمّى SET_PURPOSE_INVALID`);
      }
    }
    // الترتيب: الغرض الناقص قبل النوع، والغرض الخارج المفردات قبل النوع، وsessionId قبلهما
    {
      const a = await drive({sessionId: 'sess-1', defectType: 'OTHER'});
      eq(a.thrown.details.reasonCode, 'SET_PURPOSE_REQUIRED', '[٥] غرض غائب مع نوع فاسد ⟵ SET_PURPOSE_REQUIRED (الغرض قبل النوع)');
      const b = await drive({sessionId: 'sess-1', purpose: 'technician_check', defectType: 'OTHER'});
      eq(b.thrown.details.reasonCode, 'SET_PURPOSE_INVALID', '[٥] غرض مجهول مع نوع فاسد ⟵ SET_PURPOSE_INVALID');
      const c = await drive({purpose: 'maintenance_before', defectType: 'OTHER'});
      eq(c.thrown.details.reasonCode, 'SET_PURPOSE_SESSION_ID_REQUIRED', '[٥] sessionId غائب ⟵ SESSION_ID_REQUIRED قبل النوع');
      const d = await drive({sessionId: 'sess-1', purpose: 'maintenance_before', defectType: 'OTHER'}, null);
      eq(d.thrown.details.reasonCode, 'SET_PURPOSE_NOT_AUTHENTICATED', '[٥] بلا مصادقة ⟵ NOT_AUTHENTICATED قبل كل شيء');
    }
    ok(Object.isFrozen(P.REFUSAL_RESPONSE), '[٥] REFUSAL_RESPONSE مجمَّد بعد إضافة رموز النوع');
    for (const name of ['DEFECT_TYPE_REQUIRED', 'DEFECT_TYPE_INVALID', 'DEFECT_TYPE_NOT_APPLICABLE']) {
      ok(R[name] === name, `[٥] رمز ${name} في SET_PURPOSE_REFUSAL هو الاسم نفسه الذي يحمله العقد (مصدره protocolVocabulary.PURPOSE_REFUSAL)`);
    }
    // (ق31، 2026-10-22) رمز رفض جزء المحلّ: failed-precondition والرسالة رمزه التقني (لا نصّ عربي جديد)، وردّ العميل رمزه نفسه
    deq([P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED] && P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED].code, P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED] && P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED].message, P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED] && P.REFUSAL_RESPONSE[R.PART_NOT_ENABLED].clientReasonCode],
        ['failed-precondition', 'PURPOSE_PART_NOT_ENABLED', 'PURPOSE_PART_NOT_ENABLED'], '[٥] (ق31) ردّ PART_NOT_ENABLED: failed-precondition ورسالته ورمز العميل PURPOSE_PART_NOT_ENABLED');
  }

  console.log(`\nsetSessionPurposeGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
