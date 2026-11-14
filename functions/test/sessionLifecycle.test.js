'use strict';

// sessionLifecycle.test.js — منطق دورة الجلسة النقيّ (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المحاكي:
// cancelScanSession.e2e.test.js وscanSessionJoinStates.e2e.test.js وsessionExpiryOnTouch.e2e.test.js.
//
// قرارات المستخدم (2026-10-10، بنصّها، منقولة من أمر المنسّق):
//   «الإلغاء: المالك والجهاز المنضمّ، قبل اكتمال الفحص. الحالة «ملغاة» مع سبب مسمّى، بلا حذف (القاعدة 42)، ويُعاد الحجز المعلّق مرّة واحدة بالآلية القائمة.»
//   «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
// القاعدة 22: «جلسة بلا expiresAt لا تُقرأ «صالحة»» (أمر المنسّق) — فالغائب والتالف حالة صريحة لا تُكتب لها «منتهية» ولا تُقبل.
//   ١ الحالة   ٢ الدور (joinedBy الغائب لا يساوي غائباً)   ٣ متى تُكتب «منتهية»   ٤ حقول الكتابة   ٥ حيوية القفل وحدّ TTL   ٦ القفل القديم والإعادة
//   ٧ decideJoinForNonPending (الجهاز نفسه وجهاز آخر × الحالات كلّها) وpickLatestSession   ٨ recordSessionExpiredIfDue على معاملة مزيَّفة   ٩ لا حذف في الملفّ
//
// Run: node functions/test/sessionLifecycle.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const L = require('../src/sessions/sessionLifecycle');
const N = require('../src/sessions/sessionNames');
const {SCAN_CLAIM_TTL_MS} = require('../src/analysis/scanReservation');

const NOW = new Date('2026-10-10T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const FUTURE = new Date(NOW_MS + 30 * 60 * 1000);
const PAST = new Date(NOW_MS - 30 * 60 * 1000);

(async () => {
  // ═══ ١ — الحالة ═══
  const S = L.STATUS_STATE;
  deq(L.classifyStatus({status: 'pending'}), {state: S.KNOWN, status: 'pending'}, '[١] pending معروفة');
  for (const st of ['pending', 'scanning', 'completed', 'expired', 'cancelled']) {
    deq(L.classifyStatus({status: st}), {state: S.KNOWN, status: st}, `[١] ${st} معروفة`);
  }
  deq(L.classifyStatus({}), {state: S.ABSENT, status: null}, '[١] status غائب: ABSENT');
  deq(L.classifyStatus({status: null}), {state: S.ABSENT, status: null}, '[١] status null: ABSENT');
  deq(L.classifyStatus(null), {state: S.ABSENT, status: null}, '[١] بيانات غائبة: ABSENT');
  deq(L.classifyStatus({status: 5}), {state: S.NOT_A_STRING, status: null}, '[١] رقم: NOT_A_STRING');
  deq(L.classifyStatus({status: {a: 1}}), {state: S.NOT_A_STRING, status: null}, '[١] خريطة: NOT_A_STRING');
  deq(L.classifyStatus({status: 'done'}), {state: S.UNRECOGNIZED, status: null}, '[١] نصّ لا تعرفه الشيفرة: UNRECOGNIZED ولا يُعاد نصّه');
  deq(L.classifyStatus({status: 'Cancelled'}), {state: S.UNRECOGNIZED, status: null}, '[١] حالة الأحرف تُميَّز: Cancelled ≠ cancelled (لا تطبيع صامت)');
  deq(L.classifyStatus({status: ''}), {state: S.UNRECOGNIZED, status: null}, '[١] نصّ فارغ: UNRECOGNIZED');

  // ═══ ٢ — الدور ═══
  const J = L.JOINED_BY_STATE;
  const role = (data, uid) => L.sessionRoleOf(data, uid);
  deq(role({ownerId: 'o1', joinedBy: 'j1'}, 'o1'), {role: 'owner', joinedByState: null}, '[٢] المالك');
  deq(role({ownerId: 'o1', joinedBy: 'j1'}, 'j1'), {role: 'joiner', joinedByState: null}, '[٢] المنضمّ');
  deq(role({ownerId: 'o1', joinedBy: 'o1'}, 'o1').role, 'owner', '[٢] المالك المنضمّ جهازه بنفسه: المالك أوّلاً');
  deq(role({ownerId: 'o1', joinedBy: 'j1'}, 'x1'), {role: null, joinedByState: J.OTHER_UID}, '[٢] غريب: لا دور، وjoinedBy لغيره');
  deq(role({ownerId: 'o1'}, 'x1'), {role: null, joinedByState: J.ABSENT}, '[٢] جلسة لم يُنضَمّ إليها: joinedBy غائب');
  deq(role({ownerId: 'o1', joinedBy: null}, 'x1'), {role: null, joinedByState: J.NULL}, '[٢] انضمّ بلا هوية (null): غريب لا يطابقه');
  deq(role({ownerId: 'o1', joinedBy: ''}, 'x1'), {role: null, joinedByState: J.EMPTY}, '[٢] joinedBy فارغ');
  deq(role({ownerId: 'o1', joinedBy: 7}, 'x1'), {role: null, joinedByState: J.INVALID_TYPE}, '[٢] joinedBy ليس نصّاً');
  // الغائب لا يساوي غائباً (لا null == null ولا undefined == undefined ولا '' == '')
  eq(role({ownerId: 'o1', joinedBy: null}, null).role, null, '[٢] uid المستدعي null وjoinedBy null: لا منضمّ');
  eq(role({ownerId: 'o1'}, undefined).role, null, '[٢] uid غائب وjoinedBy غائب: لا منضمّ');
  eq(role({ownerId: 'o1', joinedBy: ''}, '').role, null, '[٢] uid فارغ وjoinedBy فارغ: لا منضمّ');
  eq(role({ownerId: '', joinedBy: 'j1'}, '').role, null, '[٢] ownerId فارغ وuid فارغ: لا مالك');
  eq(role({joinedBy: 'j1'}, 'o1').role, null, '[٢] ownerId غائب: لا مالك');
  eq(role({ownerId: 'o1', joinedBy: 'j1'}, 123).role, null, '[٢] uid رقم: لا دور');
  eq(role(null, 'o1').role, null, '[٢] بيانات غائبة: لا دور');
  eq(role({ownerId: 'o1', joinedBy: 'j1'}, 'J1').role, null, '[٢] المطابقة حرفية: J1 ≠ j1');

  // isJoinedBy — مصدر المقارنة الواحد للإلغاء وإعادة الانضمام (2026-10-10): الغياب لا يُقرأ هويةً
  eq(L.isJoinedBy({joinedBy: 'j1'}, 'j1'), true, '[٢] isJoinedBy: المنضمّ نفسه');
  eq(L.isJoinedBy({joinedBy: 'j1'}, 'j2'), false, '[٢] isJoinedBy: uid آخر');
  eq(L.isJoinedBy({joinedBy: 'j1'}, 'J1'), false, '[٢] isJoinedBy: المطابقة حرفية');
  eq(L.isJoinedBy({joinedBy: null}, null), false, '[٢] isJoinedBy: null وnull لا يتطابقان (انضمّ بلا هوية ولا يُعرَف)');
  eq(L.isJoinedBy({joinedBy: null}, 'j1'), false, '[٢] isJoinedBy: joinedBy null وuid موجود');
  eq(L.isJoinedBy({}, undefined), false, '[٢] isJoinedBy: غائب وغائب');
  eq(L.isJoinedBy({}, 'j1'), false, '[٢] isJoinedBy: joinedBy غائب');
  eq(L.isJoinedBy({joinedBy: ''}, ''), false, '[٢] isJoinedBy: فارغ وفارغ');
  eq(L.isJoinedBy({joinedBy: 7}, 7), false, '[٢] isJoinedBy: رقم ورقم');
  eq(L.isJoinedBy({joinedBy: 'j1'}, undefined), false, '[٢] isJoinedBy: uid غائب');
  eq(L.isJoinedBy(null, 'j1'), false, '[٢] isJoinedBy: بيانات غائبة');
  eq(L.isJoinedBy(undefined, undefined), false, '[٢] isJoinedBy: لا شيء ولا شيء');
  eq(L.isJoinedBy({ownerId: 'o1'}, 'o1'), false, '[٢] isJoinedBy: المالك ليس منضمّاً بمجرّد أنه المالك (joinedBy وحده)');

  // ═══ ٣ — متى تُكتب «منتهية» ═══
  const due = (data, now = NOW) => L.isDueForExpiredRecord(data, now);
  eq(due({status: 'pending', expiresAt: PAST}), true, '[٣] pending بعد expiresAt: تُكتب');
  eq(due({status: 'scanning', expiresAt: PAST}), true, '[٣] scanning بعد expiresAt: تُكتب (هذه كانت تبقى scanning في الإنتاج)');
  eq(due({status: 'scanning', expiresAt: FUTURE}), false, '[٣] scanning قبل expiresAt: لا');
  eq(due({status: 'scanning', expiresAt: new Date(NOW_MS)}), false, '[٣] expiresAt == الآن تماماً: لا (انقضى = أقدم من الآن)');
  eq(due({status: 'scanning', expiresAt: new Date(NOW_MS - 1)}), true, '[٣] وبعد الآن بمللي ثانية: نعم');
  eq(due({status: 'scanning', expiresAt: {toDate: () => PAST}}), true, '[٣] Timestamp (toDate) يُقرأ');
  eq(due({status: 'scanning'}), false, '[٣] expiresAt غائب: لا تُكتب «منتهية» (لا يُعرَف أنه انقضى — القاعدة 22)');
  eq(due({status: 'scanning', expiresAt: null}), false, '[٣] expiresAt null: لا');
  eq(due({status: 'scanning', expiresAt: 'not-a-date'}), false, '[٣] expiresAt تالف: لا');
  eq(due({status: 'completed', expiresAt: PAST}), false, '[٣] completed لا تُمسّ');
  eq(due({status: 'cancelled', expiresAt: PAST}), false, '[٣] cancelled لا تُمسّ');
  eq(due({status: 'expired', expiresAt: PAST}), false, '[٣] expired لا تُكتب ثانية');
  eq(due({status: 'weird', expiresAt: PAST}), false, '[٣] حالة لا تعرفها الشيفرة: لا تُكتب فوقها');
  eq(due({expiresAt: PAST}), false, '[٣] حالة غائبة: لا');
  eq(due(null), false, '[٣] بيانات غائبة: لا');

  // ═══ ٤ — حقول الكتابة ═══
  const FV = {serverTimestamp: () => '<SERVER_TS>', increment: () => '<INC>'};
  deq(L.expiredWriteFields(FV), {status: 'expired', expiredAt: '<SERVER_TS>'}, '[٤] «منتهية»: status وexpiredAt وحدهما');
  deq(L.cancelledWriteFields(FV, 'left_by_customer'), {status: 'cancelled', cancelledAt: '<SERVER_TS>', cancelReason: 'left_by_customer'}, '[٤] «ملغاة»: status وcancelledAt وcancelReason وحدها');
  eq(L.cancelledWriteFields(FV, N.CANCEL_REASON.CONSENT_DECLINED).cancelReason, 'consent_declined', '[٤] السبب يمرّ كما هو');
  ok(!('scanId' in L.cancelledWriteFields(FV, 'x')) && !('completedAt' in L.cancelledWriteFields(FV, 'x')), '[٤] «ملغاة» لا تكتب scanId ولا completedAt');

  // ═══ ٥ — حيوية القفل وحدّ TTL ═══
  const LV = L.CLAIM_LIVENESS;
  const live = (claimedAtMs) => L.claimLiveness({claimedAtMs}, NOW_MS);
  eq(SCAN_CLAIM_TTL_MS, 300000, '[٥] TTL القفل 300000 ms (لم يتغيّر: قيمة analyzeDevice الأصلية)');
  eq(live(NOW_MS - 1000), LV.IN_FLIGHT, '[٥] قفل عمره ثانية: يجري');
  eq(live(NOW_MS - (SCAN_CLAIM_TTL_MS - 1)), LV.IN_FLIGHT, '[٥] عمره TTL−1: يجري');
  eq(live(NOW_MS - SCAN_CLAIM_TTL_MS), LV.STALE, '[٥] عمره TTL تماماً: قديم (analyzeDevice: ageMs < TTL فقط تعدّه مملوكاً)');
  eq(live(NOW_MS - SCAN_CLAIM_TTL_MS - 1), LV.STALE, '[٥] عمره TTL+1: قديم');
  eq(live(NOW_MS + 60000), LV.IN_FLIGHT, '[٥] قفل بوقت مستقبلي (ساعة متقدّمة): يجري لا قديم');
  eq(L.claimLiveness({}, NOW_MS), LV.AGE_UNKNOWN, '[٥] claimedAtMs غائب: عمر مجهول');
  eq(L.claimLiveness({claimedAtMs: null}, NOW_MS), LV.AGE_UNKNOWN, '[٥] claimedAtMs null: مجهول');
  eq(live(NaN), LV.AGE_UNKNOWN, '[٥] NaN: مجهول');
  eq(live(Infinity), LV.AGE_UNKNOWN, '[٥] Infinity: مجهول');
  eq(live('1790000000000'), LV.AGE_UNKNOWN, '[٥] نصّ: مجهول (لا تخمين)');
  eq(live({toMillis: () => NOW_MS}), LV.AGE_UNKNOWN, '[٥] Timestamp (ليس رقماً): مجهول');
  eq(L.claimLiveness(null, NOW_MS), LV.AGE_UNKNOWN, '[٥] بيانات غائبة: مجهول');

  // ═══ ٦ — القفل القديم والإعادة ═══
  const ST = L.STALE_CLAIM_STATE;
  const goodRes = {userId: 'owner-1', isFreeTrial: false, deviceFP: null, reservedAtMs: NOW_MS - 600000};
  const stale = (claimData, reportExists = false) => L.classifyStaleClaim({claimData, reportExists});
  eq(stale({reservation: goodRes}), ST.RELEASABLE, '[٦] حجز سليم بلا تقرير: يُعاد');
  eq(stale({reservation: goodRes}, true), ST.HAS_REPORT, '[٦] وبتقرير: الفحصة مستهلَكة بحقّ، لا إعادة');
  eq(stale({reservation: null}), ST.NO_RESERVATION, '[٦] reservation null: لا شيء يُعاد');
  eq(stale({}), ST.NO_RESERVATION, '[٦] reservation غائب: لا شيء يُعاد');
  eq(stale({reservation: null}, true), ST.NO_RESERVATION, '[٦] بلا حجز وبتقرير: لا حجز');
  eq(stale({reservation: {isFreeTrial: false}}), ST.MALFORMED_RESERVATION, '[٦] حجز بلا userId: مشوَّه، لا يُخمَّن صاحبه');
  eq(stale({reservation: {userId: ''}}), ST.MALFORMED_RESERVATION, '[٦] userId فارغ: مشوَّه');
  eq(stale({reservation: {userId: 7}}), ST.MALFORMED_RESERVATION, '[٦] userId رقم: مشوَّه');
  eq(stale({reservation: 'x'}), ST.MALFORMED_RESERVATION, '[٦] حجز نصّ: مشوَّه');
  eq(stale({reservation: {userId: ''}}, true), ST.MALFORMED_RESERVATION, '[٦] المشوَّه يسبق فحص التقرير (لا يُدَّعى مستهلَكاً)');
  eq(stale(null), ST.NO_RESERVATION, '[٦] بيانات غائبة: لا حجز');

  // ═══ ٧ — decideJoinForNonPending وpickLatestSession ═══
  // قرار المستخدم (2026-10-10، بنصّه): ««سبق الانضمام إلى هذه الجلسة»: يُعرض على جهاز آخر فقط. والجهاز المنضمّ نفسه إن أعاد الانضمام (عودة من الإعدادات، أو إعادة مسح) يُقبل بلا رسالة ولا
  // أثر جانبي.» وجوابه: «Accepted silently only while the session is «scanning» … After completion: a separate reason code SESSION_COMPLETED … Cancelled and expired keep their current refusals.»
  // (القاعدة 23: استبدال لا إضافة — حلّ هذا القسم محلّ تأكيدات joinRefusalForNonPending التي كانت تُثبت «scanning/completed ⟵ انضُمّ إليها» لكلّ مستدعٍ.)
  const JR = N.JOIN_REFUSAL;
  const JD = L.JOIN_DECISION;
  deq({...JD}, {REFUSE: 'REFUSE', REJOIN: 'REJOIN'}, '[٧] قراران: رفض، أو إعادة انضمام');
  const SAME = 'dev-A'; // الجهاز المنضمّ (joinedBy)
  const sess = (status, joinedBy = SAME) => ({status, joinedBy});
  const REFUSE = (reason) => ({decision: JD.REFUSE, reason});
  const REJOIN = {decision: JD.REJOIN, reason: null};
  const decide = (data, uid) => L.decideJoinForNonPending(data, uid);
  // الجدول: كل حالة معروفة × (الجهاز نفسه | جهاز آخر | بلا هوية). المفتاح = الحالة، فحالة جديدة في SESSION_STATUS بلا صفّ هنا تُفشل (القاعدة 30: كل القيم، لا واحدة).
  const MATRIX = {
    pending: {same: REFUSE(JR.STATUS_UNKNOWN), other: REFUSE(JR.STATUS_UNKNOWN), noauth: REFUSE(JR.STATUS_UNKNOWN)}, // pending لا يصل هنا: تُعلَن لا تُسقَط إلى «انضُمّ إليها»
    scanning: {same: REJOIN, other: REFUSE(JR.ALREADY_JOINED), noauth: REFUSE(JR.ALREADY_JOINED)},
    completed: {same: REFUSE(JR.COMPLETED), other: REFUSE(JR.ALREADY_JOINED), noauth: REFUSE(JR.ALREADY_JOINED)},
    cancelled: {same: REFUSE(JR.CANCELLED), other: REFUSE(JR.CANCELLED), noauth: REFUSE(JR.CANCELLED)}, // رفضها القائم: للجهاز نفسه ولغيره
    expired: {same: REFUSE(JR.EXPIRED), other: REFUSE(JR.EXPIRED), noauth: REFUSE(JR.EXPIRED)},
  };
  deq(Object.keys(MATRIX).sort(), [...N.KNOWN_SESSION_STATUSES].sort(), '[٧] الجدول يغطّي كل حالة معروفة (حالة جديدة بلا صفّ تُفشل)');
  for (const [status, row] of Object.entries(MATRIX)) {
    deq(decide(sess(status), SAME), row.same, `[٧] ${status} / الجهاز نفسه`);
    deq(decide(sess(status), 'dev-B'), row.other, `[٧] ${status} / جهاز آخر`);
    deq(decide(sess(status), null), row.noauth, `[٧] ${status} / المستدعي بلا هوية (null)`);
    deq(decide(sess(status), undefined), row.noauth, `[٧] ${status} / المستدعي غائب (undefined)`);
    deq(decide(sess(status), ''), row.noauth, `[٧] ${status} / uid فارغ`);
    deq(decide(sess(status, null), null), row.noauth, `[٧] ${status} / انضمّ بلا هوية (joinedBy=null) والمستدعي بلا هوية: لا «null == null»`);
    deq(decide(sess(status, null), SAME), row.other, `[٧] ${status} / joinedBy=null والمستدعي له uid: لا يطابق`);
    deq(decide({status}, SAME), row.other, `[٧] ${status} / joinedBy غائب: لا يطابق`);
  }
  deq(decide({status: 'scanning', joinedBy: 'dev-A'}, 'DEV-A'), REFUSE(JR.ALREADY_JOINED), '[٧] المطابقة حرفية: DEV-A ≠ dev-A ⟵ جهاز آخر');
  deq(decide({status: 'scanning', ownerId: 'own-1', joinedBy: 'dev-A'}, 'own-1'), REFUSE(JR.ALREADY_JOINED), '[٧] المالك نفسه ليس «الجهاز نفسه» (joinedBy وحده) ⟵ ALREADY_JOINED');
  // الحالة غير المقروءة: غير معروفة لكلّ مستدعٍ، حتى لو طابق joinedBy
  for (const bad of [{}, {status: null}, {status: 'done'}, {status: 'Scanning'}, {status: ''}, {status: 5}, null, undefined]) {
    deq(decide(bad && {...bad, joinedBy: SAME}, SAME), REFUSE(JR.STATUS_UNKNOWN), `[٧] حالة غائبة/مجهولة ${JSON.stringify(bad)}: غير معروفة (لا تسقط إلى قبول ولا إلى «انضُمّ إليها»)`);
  }
  eq(JR.COMPLETED, 'SESSION_COMPLETED', '[٧] رمز «الجهاز نفسه بعد الاكتمال» من المصدر الواحد');
  eq(N.CANCEL_REFUSAL.COMPLETED, JR.COMPLETED, '[٧] وهو نفسه رمز الإلغاء بعد الاكتمال (مصدر واحد لا نسخة)');

  const at = (iso) => new Date(iso);
  const pick = (entries) => { const r = L.pickLatestSession(entries); return r && r.id; };
  eq(pick([]), null, '[٧] لا جلسات: null');
  eq(pick([{id: 'a', data: {createdAt: at('2026-10-01T00:00:00Z')}}, {id: 'b', data: {createdAt: at('2026-10-09T00:00:00Z')}}]), 'b', '[٧] الأحدث إنشاءً');
  eq(pick([{id: 'b', data: {createdAt: at('2026-10-09T00:00:00Z')}}, {id: 'a', data: {createdAt: at('2026-10-01T00:00:00Z')}}]), 'b', '[٧] والترتيب في المدخل لا يهمّ');
  eq(pick([{id: 'a', data: {}}, {id: 'b', data: {createdAt: at('2026-10-09T00:00:00Z')}}]), 'b', '[٧] createdAt غائب يُرتَّب أخيراً');
  eq(pick([{id: 'a', data: {createdAt: 'garbage'}}, {id: 'b', data: {createdAt: at('2020-01-01T00:00:00Z')}}]), 'b', '[٧] وغير المقروء كذلك');
  eq(pick([{id: 'a', data: {createdAt: {toDate: () => at('2026-10-09T00:00:00Z')}}}, {id: 'b', data: {createdAt: at('2026-10-01T00:00:00Z')}}]), 'a', '[٧] Timestamp يُقرأ');
  eq(pick([{id: 'a', data: {}}, {id: 'b', data: {}}]), 'b', '[٧] كلّها بلا createdAt: التعادل بترتيب المعرّف (حتمي)');
  eq(pick([{id: 'z', data: {createdAt: at('2026-10-09T00:00:00Z')}}, {id: 'y', data: {createdAt: at('2026-10-09T00:00:00Z')}}]), 'z', '[٧] تعادل createdAt: ترتيب المعرّف');

  // ═══ ٨ — recordSessionExpiredIfDue على معاملة مزيَّفة ═══
  function fakeDb(data) {
    const writes = [];
    const logs = [];
    const sessionRef = {id: 'session-xyz-unit'};
    return {
      db: {
        runTransaction: async (cb) => cb({
          get: async () => ({exists: data !== undefined, data: () => data}),
          update: (ref, fields) => writes.push({ref, fields}),
        }),
      },
      writes, logs, sessionRef,
    };
  }
  const realLog = console.log;
  const logged = [];
  console.log = (...a) => { logged.push(a.join(' ')); };
  try {
    let f = fakeDb({status: 'scanning', expiresAt: PAST, ownerId: 'o1'});
    let r = await L.recordSessionExpiredIfDue({db: f.db, FieldValue: FV, sessionRef: f.sessionRef, now: NOW, source: 'unitTest'});
    deq(r, {written: true, previousStatus: 'scanning'}, '[٨] جلسة scanning منقضية: كُتبت');
    eq(f.writes.length, 1, '[٨] كتابة واحدة');
    deq(f.writes[0].fields, {status: 'expired', expiredAt: '<SERVER_TS>'}, '[٨] حقولها status وexpiredAt');
    eq(f.writes[0].ref, f.sessionRef, '[٨] على مرجع الجلسة');
    ok(logged.some((l) => /^\[sessionLifecycle\] recorded expired from=unitTest previous=scanning session=#[0-9a-f]{12}$/.test(l)), '[٨] وسطر السجلّ بالمصدر والحالة السابقة والمعرّف مُهشَّراً');
    ok(!logged.join('\n').includes('session-xyz-unit'), '[٨] ولا sessionId خامّ في السجلّ');

    logged.length = 0;
    f = fakeDb({status: 'scanning', expiresAt: FUTURE});
    r = await L.recordSessionExpiredIfDue({db: f.db, FieldValue: FV, sessionRef: f.sessionRef, now: NOW, source: 'unitTest'});
    deq(r, {written: false, previousStatus: 'scanning'}, '[٨] قبل expiresAt: لا كتابة');
    eq(f.writes.length + logged.length, 0, '[٨] ولا سطر سجلّ');

    f = fakeDb({status: 'scanning'});
    r = await L.recordSessionExpiredIfDue({db: f.db, FieldValue: FV, sessionRef: f.sessionRef, now: NOW, source: 'unitTest'});
    deq(r, {written: false, previousStatus: 'scanning'}, '[٨] expiresAt غائب: لا كتابة (الغياب ليس انقضاءً)');
    eq(f.writes.length, 0, '[٨] لا كتابة');

    for (const st of ['completed', 'cancelled', 'expired']) {
      f = fakeDb({status: st, expiresAt: PAST});
      r = await L.recordSessionExpiredIfDue({db: f.db, FieldValue: FV, sessionRef: f.sessionRef, now: NOW, source: 'unitTest'});
      eq(r.written, false, `[٨] ${st} منقضية: لا تُكتب فوقها «منتهية»`);
      eq(f.writes.length, 0, `[٨] ${st}: لا كتابة`);
    }
    f = fakeDb(undefined);
    r = await L.recordSessionExpiredIfDue({db: f.db, FieldValue: FV, sessionRef: f.sessionRef, now: NOW, source: 'unitTest'});
    deq(r, {written: false, previousStatus: null}, '[٨] جلسة غير موجودة: لا كتابة ولا استثناء');

    // النسخة التي لا ترمي
    const errs = [];
    const realErr = console.error;
    console.error = (...a) => { errs.push(a.join(' ')); };
    try {
      const boom = {runTransaction: async () => { const e = new Error('SECRET-DETAIL projects/x/documents/scanSessions/real-session-id'); e.code = 14; throw e; }};
      const rs = await L.recordSessionExpiredIfDueSafely({db: boom, FieldValue: FV, sessionRef: {id: 'real-session-id'}, now: NOW, source: 'unitTest'});
      eq(rs, null, '[٨] الفشل يُعاد null لا استثناء');
      eq(errs.length, 1, '[٨] وسطر خطأ واحد');
      ok(/recording expired FAILED from=unitTest session=#[0-9a-f]{12} \[Error\] code=14$/.test(errs[0]), '[٨] بالمصدر ومعرّف مُهشَّر واسم الصنف والرمز');
      ok(!errs[0].includes('SECRET-DETAIL') && !errs[0].includes('real-session-id'), '[٨] ولا نصّ رسالة الخطأ ولا معرّف خامّ (القاعدة 36)');
    } finally {
      console.error = realErr;
    }
  } finally {
    console.log = realLog;
  }

  // ═══ ٨-ب — حارس القفل للكنس (E32، S-SWEEP 2026-10-15) ═══
  // claimsBlockingExpiry: نفس تصنيف claimLiveness الذي تحكم به cancelScanSession (مصدر واحد للحيوية): الحيّ يمنع، ومجهول العمر يمنع (لا يُدَّعى قديماً)، والقديم لا يمنع.
  {
    const SKIP = N.SWEEP_SKIP_REASON;
    const blocking = (claims) => L.claimsBlockingExpiry(claims, NOW_MS);
    eq(blocking([]), null, '[٨-ب] لا قفل: لا يمنع');
    eq(blocking([{claimedAtMs: NOW_MS - 1000}]), SKIP.CLAIM_IN_FLIGHT, '[٨-ب] قفل عمره ثانية: CLAIM_IN_FLIGHT');
    eq(blocking([{claimedAtMs: NOW_MS - (SCAN_CLAIM_TTL_MS - 1)}]), SKIP.CLAIM_IN_FLIGHT, '[٨-ب] قبل TTL بمللي ثانية: حيّ');
    eq(blocking([{claimedAtMs: NOW_MS - SCAN_CLAIM_TTL_MS}]), null, '[٨-ب] عند TTL بالضبط: قديم لا يمنع');
    eq(blocking([{claimedAtMs: NOW_MS - 3600000}]), null, '[٨-ب] قفل قديم: لا يمنع');
    eq(blocking([{claimedAtMs: NOW_MS + 5000}]), SKIP.CLAIM_IN_FLIGHT, '[٨-ب] عمر سالب (ساعة متقدّمة): حيّ كما تعامله analyzeDevice');
    eq(blocking([{}]), SKIP.CLAIM_AGE_UNKNOWN, '[٨-ب] claimedAtMs غائب: CLAIM_AGE_UNKNOWN (القاعدة 22)');
    eq(blocking([{claimedAtMs: 'x'}]), SKIP.CLAIM_AGE_UNKNOWN, '[٨-ب] claimedAtMs نصّ: مجهول العمر');
    eq(blocking([{claimedAtMs: NaN}]), SKIP.CLAIM_AGE_UNKNOWN, '[٨-ب] NaN: مجهول العمر');
    eq(blocking([null]), SKIP.CLAIM_AGE_UNKNOWN, '[٨-ب] بيانات قفل غائبة: مجهولة العمر');
    eq(blocking([{claimedAtMs: NOW_MS - 3600000}, {}]), SKIP.CLAIM_AGE_UNKNOWN, '[٨-ب] قديم ومجهول: يمنع المجهول');
    eq(blocking([{}, {claimedAtMs: NOW_MS - 1000}]), SKIP.CLAIM_IN_FLIGHT, '[٨-ب] مجهول وحيّ: الجاري يسبق (كما claimsBlockingCancel)');
    eq(blocking([{claimedAtMs: NOW_MS - 3600000}, {claimedAtMs: NOW_MS - 1000}]), SKIP.CLAIM_IN_FLIGHT, '[٨-ب] قديم وحيّ: يمنع الحيّ');
  }

  // معامل guard في recordSessionExpiredIfDue: داخل المعاملة، بعد ثبوت الاستحقاق، وقبل الكتابة
  {
    const makeDb = (data) => {
      const events = [];
      const sessionRef = {id: 'guard-unit-session'};
      return {
        events, sessionRef,
        db: {
          runTransaction: async (cb) => cb({
            get: async (r) => { events.push('tx.get'); return {exists: data !== undefined, data: () => data, ref: r}; },
            update: (ref, fields) => { events.push('tx.update'); events.push(fields); },
          }),
        },
      };
    };
    const base = (m, guard) => ({db: m.db, FieldValue: FV, sessionRef: m.sessionRef, now: NOW, source: 'unitTest', ...(guard === undefined ? {} : {guard})});
    const realLog = console.log;
    console.log = () => {};
    try {
      // guard يعيد سبباً ⟵ لا كتابة، وskipReason في النتيجة
      let m = makeDb({status: 'scanning', expiresAt: PAST, ownerId: 'o1'});
      let calls = [];
      let r = await L.recordSessionExpiredIfDue(base(m, async (arg) => { calls.push(arg); m.events.push('guard'); return N.SWEEP_SKIP_REASON.CLAIM_IN_FLIGHT; }));
      deq(r, {written: false, previousStatus: 'scanning', skipReason: 'claim_in_flight'}, '[٨-ب] guard يعيد سبباً: لا كتابة، والسبب في النتيجة');
      ok(!m.events.includes('tx.update'), '[٨-ب] ولا tx.update');
      eq(calls.length, 1, '[٨-ب] guard استُدعي مرّة واحدة');
      deq(Object.keys(calls[0]).sort(), ['data', 'now', 'sessionRef', 'tx'], '[٨-ب] وبـ{tx، data، sessionRef، now}');
      eq(calls[0].sessionRef, m.sessionRef, '[٨-ب] sessionRef هو مرجع الجلسة');
      deq(m.events.slice(0, 2), ['tx.get', 'guard'], '[٨-ب] guard بعد قراءة الجلسة داخل المعاملة (القراءات قبل الكتابات)');
      // guard يعيد null ⟵ تُكتب
      m = makeDb({status: 'scanning', expiresAt: PAST});
      r = await L.recordSessionExpiredIfDue(base(m, async () => null));
      deq(r, {written: true, previousStatus: 'scanning'}, '[٨-ب] guard يعيد null: تُكتب، والنتيجة بلا skipReason');
      ok(m.events.includes('tx.update'), '[٨-ب] وtx.update جرى');
      // guard لا يُستدعى لما لا يستحقّ (قبل الاستحقاق: لا قراءة أقفال بلا داعٍ)
      for (const [label, data] of [['صالحة', {status: 'scanning', expiresAt: FUTURE}], ['بلا expiresAt', {status: 'scanning'}], ['نهائية', {status: 'completed', expiresAt: PAST}], ['حالة مجهولة', {status: 'weird', expiresAt: PAST}], ['غائبة', undefined]]) {
        m = makeDb(data);
        let called = 0;
        r = await L.recordSessionExpiredIfDue(base(m, async () => { called++; return null; }));
        eq(called, 0, `[٨-ب] ${label}: guard لا يُستدعى (غير مستحقّة)`);
        eq(r.written, false, `[٨-ب] ${label}: لا كتابة`);
      }
      // غياب guard: السلوك القائم (analyzeDevice وsubmitEvaluation) بلا تغيير
      m = makeDb({status: 'pending', expiresAt: PAST});
      r = await L.recordSessionExpiredIfDue(base(m));
      deq(r, {written: true, previousStatus: 'pending'}, '[٨-ب] بلا guard: السلوك القائم كما كان');
      // رمي guard يُسقط المعاملة (يُعاد للمستدعي، فالكنس يعدّها failed)
      m = makeDb({status: 'scanning', expiresAt: PAST});
      let threw = null;
      try { await L.recordSessionExpiredIfDue(base(m, async () => { throw Object.assign(new Error('claims read failed'), {code: 14}); })); } catch (e) { threw = e; }
      ok(threw && threw.code === 14 && !m.events.includes('tx.update'), '[٨-ب] guard يرمي: تُرمى للمستدعي ولا كتابة');
    } finally {
      console.log = realLog;
    }
  }

  // ═══ ٩ — لا حذف في الملفّ (القاعدة 42) ═══
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const src = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'sessionLifecycle.js'), 'utf8').replace(/\r\n/g, '\n'));
  ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(src), '[٩] sessionLifecycle.js: لا delete() ولا FieldValue.delete ولا recursiveDelete ولا bulkWriter ولا دفعات');

  console.log(`\nsessionLifecycle.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
