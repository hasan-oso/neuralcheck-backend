'use strict';

// cancelScanSessionGuard.test.js — قرار الإلغاء النقيّ وحرّاس بنية cancelScanSession (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات
// الحقيقية على المحاكي في cancelScanSession.e2e.test.js.
//
// قرار المستخدم (2026-10-10، بنصّه، منقول من أمر المنسّق): «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى، بلا حذف (القاعدة 42)،
// ويُعاد الحجز المعلّق مرّة واحدة بالآلية القائمة. واختبار للإلغاء المزدوج، وللإلغاء بعد الاكتمال (يُرفض).»
//   ١ decideCancel: جدول (دور × سبب × حالة × وقت)   ٢ claimsBlockingCancel   ٣ ردود الرفض: لكلّ رمز ردّ، ولا نصّ عربي جديد   ٤ refuse
//   ٥ بنية الشيفرة: موضع رمي واحد، كل رمز مستعمَل، لا حذف، الحالات من المصدر الواحد، المعاملة تُرجِع قراراً
//
// Run: node functions/test/cancelScanSessionGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const C = require('../src/sessions/cancelScanSession');
const {CANCEL_REFUSAL: R, CANCEL_REASON: CR} = require('../src/sessions/sessionNames');
const {SCAN_CLAIM_TTL_MS} = require('../src/analysis/scanReservation');
const {hashIdForLog} = require('../src/utils/logRedaction');

const NOW = new Date('2026-10-10T12:00:00.000Z');
const FUTURE = new Date(NOW.getTime() + 30 * 60 * 1000);
const PAST = new Date(NOW.getTime() - 30 * 60 * 1000);
const O = C.OUTCOME;

const decide = (data, uid, reason) => C.decideCancel({data, uid, reason, now: NOW});
const base = {ownerId: 'owner-1', joinedBy: 'joiner-1', expiresAt: FUTURE};

// ═══ ١ — decideCancel ═══
// الإلغاء الناجح: pending وscanning، لكلّ دور سببه
for (const status of ['pending', 'scanning']) {
  deq(decide({...base, status}, 'owner-1', CR.CANCELLED_BY_OWNER), {outcome: O.CANCEL, role: 'owner'}, `[١] ${status}: المالك + cancelled_by_owner ⇒ يُكتب «ملغاة»`);
  deq(decide({...base, status}, 'joiner-1', CR.CONSENT_DECLINED), {outcome: O.CANCEL, role: 'joiner'}, `[١] ${status}: المنضمّ + consent_declined`);
  deq(decide({...base, status}, 'joiner-1', CR.LEFT_BY_CUSTOMER), {outcome: O.CANCEL, role: 'joiner'}, `[١] ${status}: المنضمّ + left_by_customer`);
}
// pending بلا joinedBy: المالك وحده
deq(decide({ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE}, 'owner-1', CR.CANCELLED_BY_OWNER).outcome, O.CANCEL, '[١] pending بلا منضمّ: المالك يُلغي');
{
  const r = decide({ownerId: 'owner-1', status: 'pending', expiresAt: FUTURE}, 'someone', CR.LEFT_BY_CUSTOMER);
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_PARTICIPANT, ' joinedBy=absent'], '[١] pending بلا منضمّ: غيره يُرفض (joinedBy=absent في السجلّ)');
}
{
  const r = decide({ownerId: 'owner-1', status: 'scanning', joinedBy: null, expiresAt: FUTURE}, 'someone', CR.LEFT_BY_CUSTOMER);
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.NOT_PARTICIPANT, ' joinedBy=null'], '[١] انضمّ بلا هوية (null): غيره يُرفض (لا null == null)');
  const r2 = decide({ownerId: 'owner-1', status: 'scanning', joinedBy: null, expiresAt: FUTURE}, null, CR.LEFT_BY_CUSTOMER);
  eq(r2.refusal, R.NOT_PARTICIPANT, '[١] وuid المستدعي null: يُرفض أيضاً');
}
// الصلاحية قبل كل شيء
deq(decide(null, 'owner-1', CR.CANCELLED_BY_OWNER), {outcome: O.REFUSED, refusal: R.SESSION_NOT_FOUND}, '[١] مستند غائب: SESSION_NOT_FOUND');
{
  const r = decide({...base, status: 'completed'}, 'stranger', CR.CANCELLED_BY_OWNER);
  eq(r.refusal, R.NOT_PARTICIPANT, '[١] غريب على completed: NOT_PARTICIPANT لا COMPLETED (لا يُكشف عنها شيء)');
}
// السبب لدور
for (const [uid, reason, role] of [['owner-1', CR.CONSENT_DECLINED, 'owner'], ['owner-1', CR.LEFT_BY_CUSTOMER, 'owner'], ['joiner-1', CR.CANCELLED_BY_OWNER, 'joiner']]) {
  const r = decide({...base, status: 'scanning'}, uid, reason);
  deq([r.outcome, r.refusal, r.role], [O.REFUSED, R.REASON_NOT_ALLOWED_FOR_ROLE, role], `[١] ${role} بسبب ${reason}: REASON_NOT_ALLOWED_FOR_ROLE`);
}
// الحالات النهائية والشاذّة
{
  const r = decide({...base, status: 'completed'}, 'owner-1', CR.CANCELLED_BY_OWNER);
  deq([r.outcome, r.refusal], [O.REFUSED, R.COMPLETED], '[١] completed: يُرفض COMPLETED');
  const r2 = decide({...base, status: 'completed', expiresAt: PAST}, 'joiner-1', CR.LEFT_BY_CUSTOMER);
  eq(r2.refusal, R.COMPLETED, '[١] completed منقضية: COMPLETED (لا تُكتب فوقها «منتهية»)');
  const r3 = decide({...base, status: 'expired'}, 'owner-1', CR.CANCELLED_BY_OWNER);
  deq([r3.outcome, r3.refusal], [O.REFUSED, R.EXPIRED], '[١] expired مسجَّلة: SESSION_EXPIRED');
  const r4 = decide({...base, status: 'cancelled'}, 'joiner-1', CR.LEFT_BY_CUSTOMER);
  deq([r4.outcome, r4.role], [O.ALREADY_CANCELLED, 'joiner'], '[١] cancelled: نداء متكافئ');
  const r5 = decide({...base, status: 'cancelled', expiresAt: PAST}, 'owner-1', CR.CANCELLED_BY_OWNER);
  eq(r5.outcome, O.ALREADY_CANCELLED, '[١] cancelled منقضية: تبقى ملغاة (النهائية لا تتحوّل)');
  const r6 = decide({...base, status: 'cancelled'}, 'owner-1', CR.CONSENT_DECLINED);
  eq(r6.refusal, R.REASON_NOT_ALLOWED_FOR_ROLE, '[١] cancelled: والسبب غير المناسب للدور يُرفض حتى هنا');
}
for (const [label, status, state] of [['غائبة', undefined, 'ABSENT'], ['null', null, 'ABSENT'], ['رقم', 5, 'NOT_A_STRING'], ['لا تعرفها الشيفرة', 'done', 'UNRECOGNIZED'], ['بأحرف مختلفة', 'Scanning', 'UNRECOGNIZED']]) {
  const r = decide({...base, status}, 'owner-1', CR.CANCELLED_BY_OWNER);
  deq([r.outcome, r.refusal, r.extra], [O.REFUSED, R.STATUS_UNKNOWN, ` statusState=${state}`], `[١] حالة ${label}: STATUS_UNKNOWN وسبب القراءة في السجلّ`);
}
// الانقضاء
{
  const r = decide({...base, status: 'scanning', expiresAt: PAST}, 'owner-1', CR.CANCELLED_BY_OWNER);
  deq([r.outcome, r.refusal], [O.EXPIRE, R.EXPIRED], '[١] scanning منقضية: تُكتب «منتهية» ثم يُرفض (EXPIRE)');
  const r2 = decide({...base, status: 'pending', expiresAt: PAST}, 'owner-1', CR.CANCELLED_BY_OWNER);
  eq(r2.outcome, O.EXPIRE, '[١] pending منقضية: EXPIRE');
  eq(decide({...base, status: 'scanning', expiresAt: new Date(NOW.getTime())}, 'owner-1', CR.CANCELLED_BY_OWNER).outcome, O.CANCEL, '[١] expiresAt == الآن تماماً: لم تنقضِ بعد');
  eq(decide({...base, status: 'scanning', expiresAt: new Date(NOW.getTime() - 1)}, 'owner-1', CR.CANCELLED_BY_OWNER).outcome, O.EXPIRE, '[١] وبعدها بمللي ثانية: انقضت');
  for (const bad of [undefined, null, 'garbage', {seconds: 1}]) {
    const r3 = decide({ownerId: 'owner-1', status: 'scanning', expiresAt: bad}, 'owner-1', CR.CANCELLED_BY_OWNER);
    deq([r3.outcome, r3.refusal], [O.REFUSED, R.EXPIRES_AT_INVALID], `[١] expiresAt ${JSON.stringify(bad)}: EXPIRES_AT_INVALID بلا كتابة (لا «صالحة» ولا «منتهية»)`);
  }
}

// ═══ ٢ — claimsBlockingCancel ═══
const nowMs = NOW.getTime();
const claim = (ageMs) => ({claimedAtMs: nowMs - ageMs});
eq(C.claimsBlockingCancel([], nowMs), null, '[٢] لا أقفال: لا شيء يمنع');
eq(C.claimsBlockingCancel([claim(SCAN_CLAIM_TTL_MS + 1)], nowMs), null, '[٢] قفل عمره TTL+1: عالق لا يمنع');
eq(C.claimsBlockingCancel([claim(SCAN_CLAIM_TTL_MS)], nowMs), null, '[٢] قفل عمره TTL تماماً: عالق (كما تعدّه analyzeDevice: ageMs < TTL فقط مملوك)');
eq(C.claimsBlockingCancel([claim(SCAN_CLAIM_TTL_MS - 1)], nowMs), R.ANALYSIS_IN_FLIGHT, '[٢] قفل عمره TTL−1: تحليل يجري');
eq(C.claimsBlockingCancel([claim(0)], nowMs), R.ANALYSIS_IN_FLIGHT, '[٢] قفل عمره 0: يجري');
eq(C.claimsBlockingCancel([claim(-60000)], nowMs), R.ANALYSIS_IN_FLIGHT, '[٢] قفل بوقت مستقبلي: يجري');
eq(C.claimsBlockingCancel([claim(SCAN_CLAIM_TTL_MS + 5000), claim(1000)], nowMs), R.ANALYSIS_IN_FLIGHT, '[٢] عالق وجارٍ معاً: يمنع');
eq(C.claimsBlockingCancel([{}], nowMs), R.CLAIM_AGE_UNKNOWN, '[٢] قفل بلا claimedAtMs: عمر مجهول (لا يُدَّعى قديماً)');
eq(C.claimsBlockingCancel([{claimedAtMs: 'x'}], nowMs), R.CLAIM_AGE_UNKNOWN, '[٢] claimedAtMs نصّي: مجهول');
eq(C.claimsBlockingCancel([{}, claim(1000)], nowMs), R.ANALYSIS_IN_FLIGHT, '[٢] مجهول وجارٍ معاً: الجاري يسبق');
eq(C.claimsBlockingCancel([{}, claim(SCAN_CLAIM_TTL_MS + 1)], nowMs), R.CLAIM_AGE_UNKNOWN, '[٢] مجهول وعالق: المجهول يمنع');

// ═══ ٣ — ردود الرفض ═══
ok(Object.isFrozen(C.REFUSAL_RESPONSE) && Object.isFrozen(C.OUTCOME), '[٣] REFUSAL_RESPONSE وOUTCOME مجمَّدان');
deq(Object.keys(C.REFUSAL_RESPONSE).sort(), Object.values(R).sort(), '[٣] لكلّ رمز في CANCEL_REFUSAL ردّ، ولا ردّ لغير رمز');
const EXISTING_TEXTS = new Set(['يجب تسجيل الدخول', 'جلسة الفحص غير صالحة', 'الجلسة منتهية', 'sessionId مطلوب']);
for (const [reason, spec] of Object.entries(C.REFUSAL_RESPONSE)) {
  ok(['unauthenticated', 'invalid-argument', 'permission-denied', 'failed-precondition'].includes(spec.code), `[٣] ${reason}: رمز HttpsError معروف (${spec.code})`);
  ok(EXISTING_TEXTS.has(spec.message) || spec.message === reason, `[٣] ${reason}: النصّ إمّا قائم («${spec.message}») وإمّا رمزه نفسه رسالةً تقنيّة — لا نصّ عربي جديد يصل مستخدماً`);
  ok(Object.values(R).includes(spec.clientReasonCode), `[٣] ${reason}: رمز العميل من CANCEL_REFUSAL (${spec.clientReasonCode})`);
}
eq(C.REFUSAL_RESPONSE[R.SESSION_NOT_FOUND].clientReasonCode, R.NOT_PARTICIPANT, '[٣] الجلسة غير الموجودة تصل العميل بـNOT_PARTICIPANT (لا يُكشف وجود جلسة)');
eq(C.REFUSAL_RESPONSE[R.SESSION_NOT_FOUND].message, C.REFUSAL_RESPONSE[R.NOT_PARTICIPANT].message, '[٣] وبالنصّ نفسه');
eq(C.REFUSAL_RESPONSE[R.SESSION_NOT_FOUND].code, C.REFUSAL_RESPONSE[R.NOT_PARTICIPANT].code, '[٣] وبالرمز نفسه');
eq(C.REFUSAL_RESPONSE[R.EXPIRED].message, 'الجلسة منتهية', '[٣] انتهاء الصلاحية: النصّ القائم لـsessionTimeout.js');
eq(C.REFUSAL_RESPONSE[R.EXPIRED].code, 'failed-precondition', '[٣] والرمز القائم');
eq(C.REFUSAL_RESPONSE[R.EXPIRES_AT_INVALID].message, 'جلسة الفحص غير صالحة', '[٣] غياب expiresAt: النصّ القائم');
eq(C.REFUSAL_RESPONSE[R.EXPIRES_AT_INVALID].code, 'permission-denied', '[٣] والرمز القائم');
for (const name of ['COMPLETED', 'ANALYSIS_IN_FLIGHT', 'CLAIM_AGE_UNKNOWN', 'STATUS_UNKNOWN', 'REASON_NOT_ALLOWED_FOR_ROLE', 'REASON_REQUIRED', 'REASON_INVALID']) {
  eq(C.REFUSAL_RESPONSE[R[name]].message, R[name], `[٣] ${name}: الرسالة هي الرمز نفسه (لا عربية جديدة؛ المقترح بالعربية والتركية في تقرير المهمّة)`);
}

// ═══ ٤ — refuse ═══
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  try {
    let thrown = null;
    try { C.refuse(R.NOT_PARTICIPANT, {sessionId: 'session-aaa-111', uid: 'uid-bbb-222', extra: ' joinedBy=null'}); } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'permission-denied' && thrown.message === 'جلسة الفحص غير صالحة', '[٤] refuse ترمي بردّ السبب');
    deq(thrown.details, {reasonCode: 'SESSION_NOT_PARTICIPANT'}, '[٤] details = {reasonCode}');
    eq(warns[0], `[cancelScanSession] refused reason=SESSION_NOT_PARTICIPANT session=${hashIdForLog('session-aaa-111')} caller=${hashIdForLog('uid-bbb-222')} joinedBy=null`, '[٤] السطر: السبب والمعرّفان مُهشَّران وحالة joinedBy');
    ok(!warns[0].includes('session-aaa-111') && !warns[0].includes('uid-bbb-222'), '[٤] لا معرّف خامّ');
    warns.length = 0;
    try { C.refuse(R.NOT_AUTHENTICATED); } catch (e) { thrown = e; }
    eq(warns[0], '[cancelScanSession] refused reason=CANCEL_NOT_AUTHENTICATED caller=missing', '[٤] بلا هوية ولا جلسة: caller=missing، بلا session=');
    warns.length = 0;
    try { C.refuse(R.SESSION_NOT_FOUND, {sessionId: 'x', uid: 'y'}); } catch (e) { thrown = e; }
    eq(thrown.details.reasonCode, 'SESSION_NOT_PARTICIPANT', '[٤] SESSION_NOT_FOUND يصل العميل NOT_PARTICIPANT');
    ok(/ reason=SESSION_NOT_FOUND /.test(warns[0]), '[٤] والسجلّ يقول SESSION_NOT_FOUND');
    let bad = null;
    warns.length = 0;
    try { C.refuse('NOT_A_REASON'); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message) && warns.length === 0, '[٤] سبب غير مُدرَج: خطأ برمجي بلا سطر');
  } finally {
    console.warn = realWarn;
  }
}

// ═══ ٥ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const source = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'cancelScanSession.js'), 'utf8').replace(/\r\n/g, '\n'));
const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
eq(throwSites.length, 1, '[٥] `throw new HttpsError` واحد فقط (الشيفرة بلا تعليقات)');
const refuseDef = source.indexOf('function refuse(');
const refuseEnd = source.indexOf('\n}\n', refuseDef);
ok(refuseDef >= 0 && throwSites[0].index > refuseDef && throwSites[0].index < refuseEnd, '[٥] وهو داخل refuse — فرمي رفض جديد بلا سبب مسمّى يُفشل هنا');
const throwKinds = [...source.matchAll(/\bthrow\s+(new HttpsError|new Error|e)\b/g)].map((m) => m[1]).sort();
deq(throwKinds, ['e', 'new Error', 'new HttpsError'], '[٥] ثلاثة throw: رمي refuse، وخطأ السبب غير المُدرَج داخلها، وإعادة رمي الفشل غير المتوقَّع كما هو (throw e)');
for (const name of Object.keys(R)) {
  ok(new RegExp(`\\bR\\.${name}\\b`).test(source), `[٥] الرمز ${name} مستعمَل في cancelScanSession.js`);
}
ok(!/refuse\(\s*["'`]/.test(source), '[٥] ولا نداء refuse بسبب نصّ حرفي');
ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source), '[٥] لا حذف في cancelScanSession.js (القاعدة 42)');
ok(!/["'`](pending|scanning|completed|expired|cancelled)["'`]/.test(source), '[٥] لا نصّ حرفي لحالة جلسة (SESSION_STATUS من sessionNames.js)');
ok(!/["'`](consent_declined|left_by_customer|cancelled_by_owner)["'`]/.test(source), '[٥] ولا نصّ حرفي لسبب إلغاء (CANCEL_REASON من sessionNames.js)');
// المعاملة: القراءات قبل الكتابات، ولا رمي داخلها (يُسقط كتابة «منتهية»)
const txStart = source.indexOf('db.runTransaction(');
const txEnd = source.indexOf('} catch (e) {', txStart);
ok(txStart > 0 && txEnd > txStart, '[٥] المعاملة موجودة');
const txBody = source.slice(txStart, txEnd);
ok(!/throw\s/.test(txBody), '[٥] **لا throw داخل دالّة المعاملة** — تُرجِع قراراً (الرمي يُسقط كتابة «منتهية»)');
const lastGet = Math.max(...[...txBody.matchAll(/tx\.get\(/g)].map((m) => m.index));
const firstUpdate = Math.min(...[...txBody.matchAll(/tx\.update\(/g)].map((m) => m.index));
ok(Number.isFinite(lastGet) && Number.isFinite(firstUpdate), '[٥] في المعاملة قراءات وكتابات');
const updates = [...txBody.matchAll(/tx\.update\(/g)];
eq(updates.length, 2, '[٥] كتابتان فقط داخل المعاملة: «منتهية» أو «ملغاة»');
const cancelUpdateAt = txBody.indexOf('cancelledWriteFields');
ok(cancelUpdateAt > lastGet, '[٥] كتابة «ملغاة» بعد آخر قراءة (قراءة الجلسة وأقفالها أوّلاً — شرط معاملات Firestore)');
ok(/tx\.get\(db\.collection\(CLAIMS_COLLECTION\)\.where\("sessionId", "==", sessionId\)\)/.test(txBody), '[٥] أقفال الجلسة تُقرأ داخل المعاملة نفسها (فتُسلسَل مع قفل analyzeDevice)');
// الإعادة بعد المعاملة وبالدالّة القائمة
ok(/releaseSessionReservations\(/.test(source) && source.indexOf('releaseSessionReservations(') > txEnd, '[٥] إعادة الحجز بعد إتمام المعاملة (releaseSessionReservations)');
const lifecycle = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'sessionLifecycle.js'), 'utf8').replace(/\r\n/g, '\n'));
ok(/releaseScanCredit\(\{db, FieldValue, claimRef: doc\.ref\}\)/.test(lifecycle) && /require\("\.\.\/analysis\/scanReservation"\)/.test(lifecycle), '[٥] والإعادة بـreleaseScanCredit نفسها من scanReservation.js (الآلية القائمة)، لا نسخة منها');
ok(!/scansRemaining/.test(lifecycle) && !/scansRemaining/.test(source), '[٥] ولا لمس مباشر لـscansRemaining خارج الدالّة القائمة');

console.log(`\ncancelScanSessionGuard.test.js: ${n}/${n} assertions passed`);
