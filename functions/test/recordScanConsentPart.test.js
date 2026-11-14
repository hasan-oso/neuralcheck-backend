'use strict';

// recordScanConsentPart.test.js — ق40: رفض recordScanConsent لمحلّ بلا جزء `consent` (قرار حسن 2026-10-22: ق15 «جزء consent يتحكّم بظهور شاشة الموافقة، والخادم يرفض التسجيل لمحلّ بلا الجزء»،
// ومعه ق40؛ أمر المستخدم عبر المنسّق 2026-10-23). بلا شبكة ولا محاكٍ؛ والمسار الحقيقي على المحاكي في scanConsent.e2e.test.js (مشهد ٦ المُستبدَل).
//
// المصدر (منقول من أمر المنسّق، غير متحقَّق إلا بالقراءة): evidence/run-2026-10-18/DECISIONS-FOR-HASAN-2026-10-21.md ق40 (:368) وق15 (:183) — «رفض بجزء ناقص برمز مسمّى»؛ على نمط ق31 (setSessionPurposePart.test.js).
// نصّ أمر المنسّق: «رمز مسمّى مُصدَّر (مصدر واحد، القاعدة 24: اسم مثل CONSENT_PART_NOT_ENABLED)، HttpsError failed-precondition، رسالتها هي الرمز (لا نصّ جديد للمستخدم)؛ مستند المالك غائب ⟵ الرمز نفسه مع ` owner=absent`؛
// ولا قراءة لمستند المالك خارج المعاملة.»
//
// **الاختبار يُكتب قبل العلاج ويفشل عليه** (أمر المستخدم): كل تأكيد هنا يُسجَّل فشله بنصّه ولا يوقف التشغيل، وينتهي بتقرير كامل (الخروج 1 إن فشل أي منها). وما يجب أن ينجح قبل العلاج وبعده يحرس ما لا يتغيّر:
// ترتيب الرفوض (المدخل ثم الجلسة ثم الدور ثم الحالة ثم الانقضاء ثم المخزَّن ثم الجزء)، و«الأوّل يبقى»، وانقضاء الجلسة، وغياب أيّ قراءة لمستند المالك قبل أن يصل القرار إلى «اكتب».
//
// الاستبدال معلَن (القاعدة 37): utils/admin ⟵ db في الذاكرة (lib/pairFakeDb.js: معاملة تفاؤلية، **قراءة بعد كتابة ترمي**، لا حذف)؛ كل ما فوقه حقيقي: المعالج الكامل عبر `.run()`، وconsent.js، وsessionLifecycle.js.
//
// Run: node functions/test/recordScanConsentPart.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {makePairDb, ts, FieldValue, captureConsole} = require('./lib/pairFakeDb');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {CONSENT_TEXT_VERSION} = require('../src/protocol/protocolVocabulary');

let n = 0;
const failures = [];
const rec = (c, m) => { n++; if (!c) failures.push(m); };
const ok = (c, m) => rec(!!c, m);
const eq = (a, b, m) => rec(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const deq = (a, b, m) => {
  let same = true;
  try { assert.deepStrictEqual(a, b); } catch (e) { same = false; }
  rec(same, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};

// ─── utils/admin ⟵ db في الذاكرة (الاستبدال المُعلَن) ───
const state = {db: null};
const dbProxy = new Proxy({}, {
  get: (_t, prop) => {
    if (state.db === null) throw new Error('recordScanConsentPart: لا قاعدة مبذورة');
    const v = state.db[prop];
    return typeof v === 'function' ? v.bind(state.db) : v;
  },
});
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue}}, db: dbProxy, ADMIN_EMAILS: [], requireAdmin: () => {}},
};
const consentModule = require('../src/sessions/recordScanConsent');
const {recordScanConsent, decideConsentPart, REFUSAL_RESPONSE} = consentModule;
const {RECORD_CONSENT_REFUSAL: R} = require('../src/sessions/sessionNames');

const CODE = 'CONSENT_PART_NOT_ENABLED';
const HOUR = 3600 * 1000;
const OWNER = 'own-q40';
const JOINER = 'phone-q40';
const SESSION = 'sess-q40';
const sid = (id) => hashIdForLog(id);

// ─── بذور ───
const sessionDoc = (over = {}) => ({ownerId: OWNER, joinedBy: JOINER, status: 'scanning', code: '123456', createdAt: ts(Date.now() - HOUR), expiresAt: ts(Date.now() + HOUR), ...over});
const pendingInit = () => ({purposeSource: 'default', doubleEvalDraw: {selected: false}});
const shop = (parts) => ({plan: 'shop_pro', scansRemaining: 5, isActive: true, ...(parts === undefined ? {} : {protocolParts: parts})});
function world({users, session = sessionDoc(), pending = pendingInit()} = {}) {
  return makePairDb({
    scanSessions: {[SESSION]: session},
    users: users === undefined ? {[OWNER]: shop({consent: true})} : users,
    protocolPending: {[SESSION]: pending},
  }, {now: Date.now()});
}
const withParts = (parts) => world({users: {[OWNER]: shop(parts)}});
const noOwnerDoc = () => world({users: {}});

async function run(db, {uid = JOINER, data = {sessionId: SESSION, textVersion: 1, locale: 'ar'}} = {}) {
  state.db = db;
  const cap = captureConsole();
  let ret = null;
  let threw = null;
  try {
    ret = await recordScanConsent.run({data, auth: {uid, token: {firebase: {sign_in_provider: 'anonymous'}}}, rawRequest: {headers: {}}});
  } catch (e) { threw = e; } finally { cap.restore(); }
  return {ret, threw, texts: cap.texts()};
}
const snapshot = (db) => JSON.stringify(db.store);
const refusedLines = (r) => r.texts.filter((t) => t.startsWith('[recordScanConsent] refused '));
const usersRead = (db) => db.reads.filter((x) => x.path.startsWith('users/'));
const reasonOf = (r) => (r.threw && r.threw.details ? r.threw.details.reasonCode : null);

/** رفض جزء المحلّ كما يجب: الرمز والرسالة وdetails وسطر السجلّ وبلا أيّ كتابة، ومستند المالك قُرئ داخل المعاملة. */
function expectPartRefusal(label, db, before, r, {ownerAbsent = false, ownerRead = true} = {}) {
  ok(r.threw !== null, `${label}: يُرفض`);
  if (r.threw) {
    deq([r.threw.code, r.threw.message, r.threw.details], ['failed-precondition', CODE, {reasonCode: CODE}], `${label}: failed-precondition ورسالته رمزه التقني وdetails.reasonCode`);
  }
  eq(db.writes.length, 0, `${label}: لا أيّ كتابة`);
  ok(snapshot(db) === before, `${label}: المخزن كما كان حرفاً (scanSessions وprotocolPending لم يُمسّا)`);
  deq(refusedLines(r), [`[recordScanConsent] refused reason=${CODE} session=${sid(SESSION)} caller=${sid(JOINER)}${ownerAbsent ? ' owner=absent' : ''} part=consent`], `${label}: سطر الرفض المسمّى الوحيد باسم الجزء`);
  ok(!r.texts.join('\n').includes(SESSION) && !r.texts.join('\n').includes(JOINER) && !r.texts.join('\n').includes(OWNER), `${label}: لا معرّف خامّ في أيّ سطر`);
  if (ownerRead) ok(db.reads.some((x) => x.path === `users/${OWNER}` && x.inTx), `${label}: مستند المالك قُرئ **داخل المعاملة**`);
  eq(db.reads.filter((x) => x.path.startsWith('users/') && !x.inTx).length, 0, `${label}: ولا قراءة لمستند المالك خارج المعاملة`);
  eq(db.queries.length, 0, `${label}: ولا استعلام (قراءة بمعرّف مستند وحده: القاعدة 43)`);
}

/** قبول: الردّ، والكتابة الواحدة (مفتاح consent بالدمج في protocolPending)، ومستند المالك قُرئ داخل المعاملة قبلها. */
function expectRecorded(label, db, r, locale = 'ar') {
  ok(r.threw === null, `${label}: يُسجَّل${r.threw ? ` (رُفض: ${r.threw.message})` : ''}`);
  deq(r.ret, {sessionId: SESSION, state: 'accepted', textVersion: 1, locale, alreadyRecorded: false}, `${label}: الردّ لم يتغيّر`);
  deq(db.writes.map((w) => `${w.op}:${w.path}`), [`set:protocolPending/${SESSION}`], `${label}: كتابة واحدة لا غير (consent في protocolPending)`);
  const p = db.store.protocolPending[SESSION];
  deq(Object.keys(p).sort(), ['consent', 'doubleEvalDraw', 'purposeSource'], `${label}: consent أُضيف بالدمج ولم يُمحَ شيء`);
  deq([p.consent.state, p.consent.textVersion, p.consent.locale], ['accepted', 1, locale], `${label}: المسجَّل`);
  const ownerReadIdx = db.reads.findIndex((x) => x.path === `users/${OWNER}` && x.inTx);
  ok(ownerReadIdx >= 0, `${label}: مستند المالك قُرئ داخل المعاملة`);
}

(async () => {
  // ═══ ١ — جزء consent مُطفأ/غائب/بشكل خاطئ ⟵ يُرفض بـCONSENT_PART_NOT_ENABLED ولو كانت الأجزاء الأخرى مفعَّلة ═══
  const OTHERS = {purposes: true, batteryBeforeAfter: true, coldRepeat: true, returns: true, doubleEval: true};
  const OFF = [
    ['protocolParts غائبة', undefined], ['protocolParts كائن فارغ', {}], ['consent false', {consent: false}], ['consent نصّ «true»', {consent: 'true'}], ['consent رقم 1', {consent: 1}],
    ['consent null', {consent: null}], ['مفتاح consent غائب (الأجزاء الأخرى مفعَّلة كلّها)', OTHERS], ['consent false والأخرى مفعَّلة', {...OTHERS, consent: false}],
    ['protocolParts نصّ تالف', 'garbage'], ['consent مصفوفة', {consent: [true]}], ['consent كائن', {consent: {enabled: true}}],
  ];
  for (const [label, parts] of OFF) {
    const db = withParts(parts);
    const before = snapshot(db);
    const r = await run(db);
    expectPartRefusal(`[١] ${label}`, db, before, r);
  }

  // ═══ ٢ — جزء consent مفعَّل (=== true وحدها) ⟵ يُسجَّل كما كان؛ وبقية الأجزاء لا تؤثّر ═══
  for (const [label, parts] of [['consent وحده', {consent: true}], ['consent مع الأجزاء الأخرى', {...OTHERS, consent: true}], ['consent مع أجزاء مُطفأة', {consent: true, purposes: false, coldRepeat: false}]]) {
    for (const locale of ['ar', 'tr']) {
      const db = withParts(parts);
      const r = await run(db, {data: {sessionId: SESSION, textVersion: 1, locale}});
      expectRecorded(`[٢] ${label} + ${locale}`, db, r, locale);
      const logs = r.texts.filter((t) => t.startsWith('[recordScanConsent] recorded '));
      deq(logs, [`[recordScanConsent] recorded session=${sid(SESSION)} caller=${sid(JOINER)} textVersion=1 locale=${locale} alreadyRecorded=false`], `[٢] ${label} + ${locale}: سطر النجاح كما كان`);
      eq(refusedLines(r).length, 0, `[٢] ${label} + ${locale}: لا سطر رفض`);
    }
  }

  // (2026-10-23: رُفعت CONSENT_TEXT_VERSION إلى 2) النسخة الحالية والأقدم (1) تُسجَّلان كلتاهما بنسختها
  for (const v of [1, 2]) { // 1 القديمة و2 الجديدة (ما يرسله التطبيق بعد تغيير النصّ)
    const db = withParts({consent: true});
    const r = await run(db, {data: {sessionId: SESSION, textVersion: v, locale: 'ar'}});
    ok(r.threw === null, `[٢] نسخة ${v} (من 1 إلى الحالية) تُسجَّل${r.threw ? ` (رُفضت: ${r.threw.message})` : ''}`);
    deq(r.ret && [r.ret.textVersion, r.ret.alreadyRecorded], [v, false], `[٢] نسخة ${v}: الردّ بالنسخة المخزَّنة`);
    eq(db.store.protocolPending[SESSION].consent && db.store.protocolPending[SESSION].consent.textVersion, v, `[٢] نسخة ${v}: المخزَّن بنسختها`);
  }

  // ═══ ٣ — مستند المالك غائب: حالة صريحة بالرمز نفسه (owner=absent)، لا نجاحاً ولا قيمة افتراضية ═══
  {
    const db = noOwnerDoc();
    const before = snapshot(db);
    expectPartRefusal('[٣] مستند المالك غائب', db, before, await run(db), {ownerAbsent: true});
  }

  // ═══ ٤ — ownerId في الجلسة لا يصلح معرّف مستند ⟵ owner=absent بلا أيّ قراءة لمستند مستخدم ═══
  for (const [label, ownerId] of [['غائب', undefined], ['فارغ', ''], ['يحمل /', 'a/b'], ['نقطة', '.'], ['نقطتان', '..'], ['رقم', 7], ['null', null], ['أطول من حدّ المعرّف', 'x'.repeat(1501)]]) {
    const db = world({session: sessionDoc({ownerId})});
    const before = snapshot(db);
    const r = await run(db);
    expectPartRefusal(`[٤] ownerId ${label}`, db, before, r, {ownerAbsent: true, ownerRead: false});
    eq(usersRead(db).length, 0, `[٤] ownerId ${label}: لا قراءة لأيّ مستند مستخدم`);
  }

  // ═══ ٥ — الترتيب مع بقية الرفوض: الجزء آخرها (بعد الدور والحالة والانقضاء والمخزَّن) ولا يُقرأ مستند المالك قبل أن يصل القرار إلى «اكتب» ═══
  const PARTS_OFF = {consent: false};
  {
    // مدخل ناقص: لا قراءة أصلاً
    for (const [label, d, want] of [
      ['sessionId غائب', {textVersion: 1, locale: 'ar'}, 'CONSENT_SESSION_ID_REQUIRED'],
      ['textVersion غائب', {sessionId: SESSION, locale: 'ar'}, 'CONSENT_TEXT_VERSION_REQUIRED'],
      ['textVersion غير صالح', {sessionId: SESSION, textVersion: 0, locale: 'ar'}, 'CONSENT_TEXT_VERSION_INVALID'],
      ['textVersion فوق الحالية (الحالية + 1)', {sessionId: SESSION, textVersion: CONSENT_TEXT_VERSION + 1, locale: 'ar'}, 'CONSENT_TEXT_VERSION_INVALID'],
      ['locale غائب', {sessionId: SESSION, textVersion: 1}, 'CONSENT_LOCALE_REQUIRED'],
      ['locale غير صالح', {sessionId: SESSION, textVersion: 1, locale: 'en'}, 'CONSENT_LOCALE_INVALID'],
    ]) {
      const db = withParts(PARTS_OFF);
      const r = await run(db, {data: d});
      eq(reasonOf(r), want, `[٥] ${label} والجزء مُطفأ ⟵ ${want} (رفض المدخل أوّلاً)`);
      eq(db.reads.length, 0, `[٥] ${label}: **لا أيّ قراءة** قبل رفض المدخل`);
    }
  }
  {
    // غير المنضمّ (المالك نفسه) قبل الجزء
    const db = withParts(PARTS_OFF);
    const before = snapshot(db);
    const r = await run(db, {uid: OWNER});
    eq(reasonOf(r), 'SESSION_NOT_PARTICIPANT', '[٥] المالك لا المنضمّ ⟵ SESSION_NOT_PARTICIPANT (قبل الجزء)');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك قبل رفض الدور');
    ok(snapshot(db) === before, '[٥] ولا كتابة');
  }
  {
    const db = withParts(PARTS_OFF);
    const r = await run(db, {data: {sessionId: 'no-such-session', textVersion: 1, locale: 'ar'}});
    eq(reasonOf(r), 'SESSION_NOT_PARTICIPANT', '[٥] جلسة غير موجودة ⟵ SESSION_NOT_PARTICIPANT (الردّ نفسه)');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك');
  }
  for (const status of ['pending', 'completed', 'cancelled', 'expired']) {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({status})});
    const before = snapshot(db);
    const r = await run(db);
    eq(reasonOf(r), 'CONSENT_SESSION_NOT_SCANNING', `[٥] الجلسة ${status} والجزء مُطفأ ⟵ CONSENT_SESSION_NOT_SCANNING (قبل الجزء)`);
    eq(usersRead(db).length, 0, `[٥] الجلسة ${status}: لا قراءة لمستند المالك`);
    ok(snapshot(db) === before, `[٥] الجلسة ${status}: لا كتابة`);
  }
  for (const [label, session] of [['حالة غائبة', sessionDoc({status: undefined})], ['حالة مجهولة', sessionDoc({status: 'weird'})]]) {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session});
    const r = await run(db);
    eq(reasonOf(r), 'SESSION_STATUS_UNKNOWN', `[٥] ${label} والجزء مُطفأ ⟵ SESSION_STATUS_UNKNOWN (قبل الجزء)`);
    eq(usersRead(db).length, 0, `[٥] ${label}: لا قراءة لمستند المالك`);
  }
  {
    // scanning منقضية: تُكتب «منتهية» في المعاملة نفسها ثم SESSION_EXPIRED، قبل الجزء ودون قراءته (قراءة بعد كتابة ترمي في Firestore)
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({expiresAt: ts(Date.now() - HOUR)})});
    const r = await run(db);
    eq(reasonOf(r), 'SESSION_EXPIRED', '[٥] scanning منقضية والجزء مُطفأ ⟵ SESSION_EXPIRED (قبل الجزء)');
    deq(db.writes.map((w) => `${w.op}:${w.path}`), [`update:scanSessions/${SESSION}`], '[٥] وكتابة «منتهية» الوحيدة في المعاملة نفسها');
    eq(db.store.scanSessions[SESSION].status, 'expired', '[٥] والجلسة صارت expired');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك بعد كتابة');
    ok(r.threw !== null && r.threw.code === 'failed-precondition', '[٥] والرفض failed-precondition (لا فشل معاملة)');
  }
  {
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, session: sessionDoc({expiresAt: undefined})});
    const r = await run(db);
    eq(reasonOf(r), 'SESSION_EXPIRES_AT_INVALID', '[٥] expiresAt غائب والجزء مُطفأ ⟵ SESSION_EXPIRES_AT_INVALID (قبل الجزء)');
    eq(db.writes.length, 0, '[٥] بلا كتابة');
  }
  {
    // مخزَّن غير مقروء: يسبق الجزء ولا يُقرأ المالك
    const db = world({users: {[OWNER]: shop(PARTS_OFF)}, pending: {...pendingInit(), consent: {state: 'accepted', textVersion: CONSENT_TEXT_VERSION + 1, locale: 'ar'}}});
    const before = snapshot(db);
    const r = await run(db);
    eq(reasonOf(r), 'CONSENT_STORED_UNREADABLE', '[٥] مخزَّن بنسخة لا يعرفها الخادم والجزء مُطفأ ⟵ CONSENT_STORED_UNREADABLE (قبل الجزء)');
    eq(usersRead(db).length, 0, '[٥] ولا قراءة لمستند المالك');
    ok(snapshot(db) === before, '[٥] ولا كتابة');
  }

  // ═══ ٦ — «الأوّل يبقى»: موافقة مسجَّلة مقروءة تُردّ كما هي ولو أُطفئ الجزء بعدها (لا كتابة، ولا قراءة للمالك) ═══
  {
    const db = withParts({consent: true});
    const first = await run(db);
    expectRecorded('[٦] التسجيل الأوّل', db, first);
    const readsBefore = usersRead(db).length;
    const writesBefore = db.writes.length;
    db.seed('users', OWNER, shop({consent: false}));
    const second = await run(db);
    ok(second.threw === null, `[٦] النداء الثاني بعد إطفاء الجزء لا يُرفض${second.threw ? ` (رُفض: ${second.threw.message})` : ''}`);
    deq(second.ret, {sessionId: SESSION, state: 'accepted', textVersion: 1, locale: 'ar', alreadyRecorded: true}, '[٦] ويردّ المخزَّن alreadyRecorded=true');
    eq(db.writes.length, writesBefore, '[٦] ولا كتابة جديدة');
    eq(usersRead(db).length, readsBefore, '[٦] ولا قراءة جديدة لمستند المالك (ALREADY_RECORDED لا يحتاجها)');
  }

  // ═══ ٧ — رفض ثم نجاح: الرفض لا يترك أثراً، ثم يُسجَّل حين يُفعَّل الجزء ═══
  {
    const db = withParts({consent: false});
    const before = snapshot(db);
    expectPartRefusal('[٧] الجزء مُطفأ', db, before, await run(db));
    db.seed('users', OWNER, shop({consent: true}));
    const r2 = await run(db);
    expectRecorded('[٧] بعد تفعيل الجزء', db, r2);
    eq(db.queries.length, 0, '[٧] ولا استعلام (قراءة بمعرّف مستند وحده: القاعدة 43)');
  }

  // ═══ ٨ — القرار النقيّ decideConsentPart مباشرةً ═══
  ok(typeof decideConsentPart === 'function', '[٨] decideConsentPart مُصدَّرة (للاختبار النقيّ، القاعدة 41)');
  if (typeof decideConsentPart === 'function') {
    const D = (ownerData) => decideConsentPart({ownerData});
    const REF = CODE;
    deq(D({protocolParts: {consent: true}}), {ok: true}, '[٨] consent=true ⟵ مقبول');
    deq(D({protocolParts: {consent: true, purposes: false}}), {ok: true}, '[٨] consent=true والأجزاء الأخرى مُطفأة ⟵ مقبول');
    deq(D(null), {ok: false, refusal: REF, extra: ' owner=absent part=consent'}, '[٨] مستند المالك غائب ⟵ مرفوض صراحةً: owner=absent part=consent');
    deq(D(undefined), {ok: false, refusal: REF, extra: ' owner=absent part=consent'}, '[٨] مستند المالك undefined ⟵ نفسه');
    deq(D([]), {ok: false, refusal: REF, extra: ' owner=absent part=consent'}, '[٨] مستند مصفوفة ⟵ غير كائن ⟵ owner=absent');
    deq(D({}), {ok: false, refusal: REF, extra: ' part=consent'}, '[٨] مستند بلا أجزاء ⟵ part=consent (والمستند حاضر فلا owner=absent)');
    deq(D({protocolParts: {consent: false}}), {ok: false, refusal: REF, extra: ' part=consent'}, '[٨] consent=false ⟵ مرفوض');
    deq(D({protocolParts: {consent: 'true'}}), {ok: false, refusal: REF, extra: ' part=consent'}, '[٨] «true» نصّاً ⟵ غير مفعَّل (=== true وحدها)');
    deq(D({protocolParts: {consent: 1}}), {ok: false, refusal: REF, extra: ' part=consent'}, '[٨] 1 رقماً ⟵ غير مفعَّل');
    deq(D({protocolParts: 'x'}), {ok: false, refusal: REF, extra: ' part=consent'}, '[٨] protocolParts نصّ ⟵ مرفوض');
    const frozen = Object.freeze({protocolParts: Object.freeze({consent: false})});
    deq(D(frozen).ok, false, '[٨] المُدخل المجمَّد لا يُعدَّل ولا يرمي');
  }

  // ═══ ٩ — الاسم: مُصدَّر من مصدر واحد، وردّه تقني بلا نصّ جديد، ولا قراءة للمالك خارج المعاملة في المصدر ═══
  eq(R.PART_NOT_ENABLED, CODE, '[٩] RECORD_CONSENT_REFUSAL.PART_NOT_ENABLED بنصّه الحرفي (يقرؤه التطبيق بـdetails.reasonCode)');
  deq(REFUSAL_RESPONSE[R.PART_NOT_ENABLED], {code: 'failed-precondition', message: CODE, clientReasonCode: CODE}, '[٩] ردّ الرفض: failed-precondition ورسالته رمزه (لا عربية جديدة)');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'recordScanConsent.js'), 'utf8').replace(/\r\n/g, '\n');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
    ok(!code.includes(CODE), '[٩] لا نسخة حرفية من الرمز في recordScanConsent.js (مصدره sessionNames.js وحده، القاعدة 24)');
    ok(/\bR\.PART_NOT_ENABLED\b/.test(code), '[٩] recordScanConsent.js يستعمل R.PART_NOT_ENABLED');
    const usersRefs = code.match(/collection\(["']users["']\)/g) || [];
    eq(usersRefs.length, 1, '[٩] مرجع مجموعة users واحد في المصدر');
    ok(/tx\.get\(ownerRef\)/.test(code), '[٩] ويُقرأ بـtx.get داخل المعاملة');
    ok(!/ownerRef\.get\(/.test(code) && !/db\.collection\(["']users["']\)[^;]*\.get\(/.test(code), '[٩] ولا `.get()` مباشرة على مرجع المالك خارج المعاملة');
    ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(code), '[٩] لا حذف (القاعدة 42)');
  }

  if (failures.length > 0) {
    console.error(`\nrecordScanConsentPart.test.js: ${failures.length} من ${n} تأكيداً فشلت:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`recordScanConsentPart.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(2); });
