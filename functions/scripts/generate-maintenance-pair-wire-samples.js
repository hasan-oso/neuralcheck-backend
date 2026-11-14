#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-maintenance-pair-wire-samples — العيّنات الذهبية لـ**ردود** دالّتَي ربط «قبل/بعد صيانة» (listOpenMaintenanceBefores وconfirmMaintenanceAfterLink) ولرفوض نوع العطل في setSessionPurpose،
// كما يستقبلها التطبيق على السلك (أمر المستخدم 2026-10-22، المرحلة S7؛ القاعدة 41)
// ===================================================================
//
// أمر الباك اند (منقول، غير متحقَّق من هذا المستودع): «وعيّنات ذهبية جديدة لردّ الدالّتين الجديدتين تُولَّد من الدالّة الحقيقية (القاعدة 41)؛ عيّنات طلبات التطبيق لا تكتبها أنت (سيُنتجها كاتب التطبيق وتُنسخ لاحقاً).»
// **هذه ردود الخادم وحدها**: لا عيّنة طلب من التطبيق هنا؛ حقل `request` في كل عيّنة هو الطلب الذي بناه هذا المولّد ليُشغّل الدالّة، لا عيّنة مُنتَجة من التطبيق (الكاتب الآخر يُنتج عيّناته ثم تُنسخ).
//
// ─── ما هو «الجسم» هنا ───────────────────────────────────────────────────
// ما يستقبله التطبيق فعلاً: حالة HTTP وجسم الردّ كما يكتبهما غلاف onCall الحقيقي في firebase-functions (`{result: encode(<ردّ المعالج>)}` بحالة 200 للنجاح، و`{error: {status, message, details}}` للرفض) — لا HttpsError في الذاكرة.
// الاستدعاء يمرّ بالدالّة المُصدَّرة نفسها بطلب POST مبنيّ هنا وبتوكن غير موقَّع يُقبل لأن العملية تُشغَّل بـFIREBASE_DEBUG_MODE وskipTokenVerification (يُحمَّل هذا الملفّ قبل أيّ تحميل لـfirebase-functions).
//
// ─── ما هو حقيقي وما هو مستبدَل (القاعدة 37 — مُعلَن) ──────────────────────────────────
// **حقيقي:** غلاف onCall وفكّ التوكن وencode، والدالّتان المُصدَّرتان بمعالجَيهما الكاملين، وكل ما يحكم فيهما (decideSessionAccess · decideListPreconditions · decideConfirmSession · decideConfirmBefore · classifyOpenBefore · resolveMarketingName …)،
// وsetSessionPurpose المُصدَّرة لرفوض النوع (تقع قبل أيّ قراءة).
// **مستبدَل:** utils/admin ⟵ db في الذاكرة (test/lib/pairFakeDb.js: مساواة وحدها، لا حذف، معاملة تفاؤلية) بمستندات اصطناعية، والساعة (Date) مجمَّدة وقت كل نداء فلا تتغيّر scannedAtMs ولا النوافذ؛ فلا Firestore ولا محاكٍ ولا إنتاج ولا شبكة.
// **غير متحقَّق:** سلوك الدالّتين على Firestore الحقيقي (يغطّيه maintenancePair.e2e.test.js على المحاكي)، وسلوك التطبيق عند هذه الأجسام.
//
// ─── العقد الذي يتبعه (القاعدة 39) ─────────────────────────────────────────────
// docs/PROTOCOL_CONTRACT.md §٢ A2 وA3 (إلحاقات 2026-10-22). من يغيّر أيّاً منهما يُعيد التوليد في الالتزام نفسه، وtest/maintenancePairWireSamplesGuard.test.js يعيد البناء ويقارن بالملفّ المُلتزَم حرفاً بحرف (القيم لا النصّ الخام).
//
// Run: node functions/scripts/generate-maintenance-pair-wire-samples.js
// ===================================================================

// قبل أيّ require لـfirebase-functions (انظر الرأس).
process.env.FIREBASE_DEBUG_MODE = 'true';
process.env.FIREBASE_DEBUG_FEATURES = JSON.stringify({skipTokenVerification: true});
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const fs = require('fs');
const path = require('path');

const FN = path.join(__dirname, '..');
const GOLDEN_DIR = path.join(FN, 'test', 'fixtures', 'golden');
const DEST = path.join(GOLDEN_DIR, 'maintenance-pair-wire-samples-2026-10-22.json');

const {makePairDb, ts, FieldValue} = require('../test/lib/pairFakeDb');

// ─── الساعة: ثابتة وقت كل نداء (Date.now وnew Date() بلا معاملات) ───
const RealDate = Date;
const FIXED_NOW_MS = RealDate.parse('2026-10-22T12:00:00.000Z');
const HOUR = 3600 * 1000;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(FIXED_NOW_MS); else super(...a); }
  static now() { return FIXED_NOW_MS; }
}

// ─── db في الذاكرة (الاستبدال المُعلَن): يُبذَر من كل عيّنة ثم تُستدعى الدالّة ───
const state = {db: null};
const dbProxy = new Proxy({}, {
  get: (_t, prop) => {
    if (state.db === null) throw new Error('generate-maintenance-pair-wire-samples: لا قاعدة مبذورة');
    const v = state.db[prop];
    return typeof v === 'function' ? v.bind(state.db) : v;
  },
});
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue}}, db: dbProxy, ADMIN_EMAILS: [], requireAdmin: () => {}},
};

// الدوالّ المُصدَّرة الحقيقية (بعد الاستبدال أعلاه)
const {listOpenMaintenanceBefores, confirmMaintenanceAfterLink} = require('../src/sessions/maintenancePairCalls');
const {setSessionPurpose} = require('../src/sessions/setSessionPurpose');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const unsignedJwt = (payload) => `${b64({alg: 'none', typ: 'JWT'})}.${b64(payload)}.unsigned`;

/** طلب POST حقيقي الشكل إلى الدالّة المُصدَّرة؛ يُعيد {httpStatus, body} كما يكتبهما الغلاف. */
async function callWire(fn, data, auth) {
  const headers = {'content-type': 'application/json'};
  if (auth) headers.authorization = `Bearer ${unsignedJwt({sub: auth.uid, firebase: {sign_in_provider: auth.provider}})}`;
  const req = {method: 'POST', headers, body: {data}, header(n) { return this.headers[String(n).toLowerCase()]; }, get(n) { return this.header(n); }};
  let httpStatus = null;
  let body = null;
  const listeners = {};
  const res = {
    statusCode: 200, headersSent: false,
    status(s) { httpStatus = s; return this; },
    send(b) { body = b; (listeners.finish || []).forEach((f) => f()); return this; },
    json(b) { body = b; return this; },
    setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, write() { return true; }, flushHeaders() {},
    end() { (listeners.finish || []).forEach((f) => f()); },
    on(e, f) { (listeners[e] = listeners[e] || []).push(f); return this; }, once(e, f) { return this.on(e, f); }, emit() {},
  };
  const real = {log: console.log, warn: console.warn, error: console.error};
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  global.Date = FixedDate;
  try { await fn(req, res); } finally { global.Date = RealDate; Object.assign(console, real); }
  if (httpStatus === 401 && body && body.error && body.error.message === 'Unauthenticated') {
    throw new Error('generate-maintenance-pair-wire-samples: التوكن غير الموقَّع رُفض — الملفّ حُمِّل بعد firebase-functions (انظر الرأس) أو تغيّر سلوك skipTokenVerification');
  }
  return {httpStatus, body};
}

// ─── البذور: وقتٌ بصيغة {$firestoreTimestamp: ISO} في الملفّ، وts() في القاعدة ───
const TS = (hoursBeforeNow) => ({$firestoreTimestamp: new RealDate(FIXED_NOW_MS - hoursBeforeNow * HOUR).toISOString()});
const fromSpec = (v) => {
  if (Array.isArray(v)) return v.map(fromSpec);
  if (v && typeof v === 'object') {
    if (typeof v.$firestoreTimestamp === 'string') return ts(RealDate.parse(v.$firestoreTimestamp));
    const o = {};
    for (const k of Object.keys(v)) o[k] = fromSpec(v[k]);
    return o;
  }
  return v;
};
const seedDb = (seed) => {
  const cols = {};
  for (const [p, doc] of Object.entries(seed)) {
    const [col, id] = p.split('/');
    cols[col] = cols[col] || {};
    cols[col][id] = fromSpec(doc);
  }
  return makePairDb(cols, {now: FIXED_NOW_MS});
};
const serialize = (v) => JSON.parse(JSON.stringify(v, (k, x) => (x && typeof x === 'object' && typeof x.toMillis === 'function' ? {$firestoreTimestamp: new RealDate(x.toMillis()).toISOString()} : x)));

const OWNER = 'owner-sample';
const GOOGLE = (uid) => ({uid, provider: 'google.com'});
const PARTS_ON = {purposes: true, batteryBeforeAfter: true};
const baseSeed = (over = {}) => ({
  'scanSessions/sess-after': {ownerId: OWNER, status: 'pending', purpose: 'maintenance_after', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}, scanId: null, deviceModel: null},
  [`users/${OWNER}`]: {plan: 'shop_pro', protocolParts: PARTS_ON},
  'protocolSettings/current': {version: 2, openBeforeValidityHours: 72},
  'protocolPending/sess-after': {purposeSource: 'selected', defectType: 'BATTERY', linkedScanId: null, linkMethod: null, linkConfirmedAt: null, linkConfirmedByTechnicianId: null},
  ...over,
});
// (S8) pair.ownerId = مالك «قبل» (الثالث؛ الافتراضي OWNER): الاستعلام يقيّد بالمحلّ من هذا الحقل
const before = (ageHours, over = {}, owner = OWNER) => ({scanPurpose: 'maintenance_before', defectType: 'BATTERY', linkedScanId: null, linkState: 'none', linkMethod: null, pair: {state: 'OPEN', openedAt: TS(ageHours), ownerId: owner}, ...over});
const report = (model, userId = OWNER) => ({userId, deviceModel: model});
const MARKETING = {version: 3, entries: [{model: 'SM-A135F', ar: 'سامسونج A13', tr: 'Samsung A13', en: 'Samsung A13'}]};

/** @return {Promise<Object>} {samples: [...]} */
async function buildMaintenancePairWireSamples() {
  const samples = [];
  const add = async (id, fnName, fn, data, auth, seed, note, opts = {}) => {
    state.db = seedDb(seed);
    const {httpStatus, body} = await callWire(fn, data, auth);
    const sample = {
      id, function: fnName, note,
      request: {data, authenticatedAs: auth ? {sign_in_provider: auth.provider, uid: auth.uid} : null},
      seed: opts.seedSummary !== undefined ? {summary: opts.seedSummary} : seed,
      httpStatus, body,
    };
    const written = state.db.writes.map((w) => `${w.op}:${w.path}`);
    if (written.length > 0) sample.transactionWrites = written;
    if (opts.storeAfter) sample.storeAfter = Object.fromEntries(opts.storeAfter.map((p) => { const [c, i] = p.split('/'); return [p, serialize(state.db.store[c][i])]; }));
    samples.push(sample);
  };
  const LIST = (sessionId = 'sess-after') => ({sessionId});
  const CONFIRM = (beforeScanId, sessionId = 'sess-after') => ({sessionId, beforeScanId});

  // ═══ listOpenMaintenanceBefores ═══
  await add('list.success.two-candidates', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({
        'scanProtocol/before-1': before(3), 'reports/before-1': report('SM-A135F'),
        'scanProtocol/before-2': before(50), 'reports/before-2': report('XT2201-2'),
        'scanProtocol/before-thermal': before(2, {defectType: 'THERMAL'}), 'reports/before-thermal': report('SM-A135F'),
        'scanProtocol/before-other-shop': before(2, {}, 'owner-else'), 'reports/before-other-shop': report('SM-A135F', 'owner-else'),
        'scanProtocol/before-expired': before(80), 'reports/before-expired': report('SM-A135F'),
        'marketingNames/current': MARKETING,
      }),
      'جلسة «بعد» نوعها BATTERY، والإعداد 72 ساعة: مرشَّحان فقط بالأحدث أوّلاً — الأوّل بطراز في الخريطة (deviceName.state = mapped بالأسماء الثلاثة) والثاني بطراز غير مربوط (name_unmapped مع Build.MODEL كما هو). المستبعَدة (لا تظهر): نوع THERMAL، ومحلّ آخر (لا يُقرأ أصلاً: الاستعلام يقيّد pair.ownerId؛ S8)، ومنقضية (80 ساعة). scannedAtMs = pair.openedAt بالمللي ثانية.');
  await add('list.success.empty', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({'scanProtocol/before-thermal': before(2, {defectType: 'THERMAL'}), 'reports/before-thermal': report('SM-A135F')}),
      'لا «قبل» مفتوحة بالنوع نفسه للمحلّ نفسه: candidates مصفوفة فارغة (لا مفتاح غائب)، وvalidityHours حاضر.');
  await add('list.success.link-hides-before', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({
        'scanProtocol/before-linked': before(2), 'reports/before-linked': report('SM-A135F'),
        'scanProtocol/after-live': {scanPurpose: 'maintenance_after', defectType: 'BATTERY', linkedScanId: 'before-linked', linkState: 'active', linkMethod: 'manual', pair: null},
        'scanProtocol/before-free': before(4), 'reports/before-free': report('SM-A135F'),
      }),
      '«قبل» لها ربط حيّ من «بعد» (linkState = active) لا تظهر، والحرّة تظهر: لا يظهر جهاز له «قبل» و«بعد» معاً.');
  // (S8) المحلّ من pair.ownerId: شذوذ الاختلاف عن تقرير «قبل» يُستبعد ويُعلَن في السجلّ (لا في الردّ)، و«قبل» بلا pair.ownerId (شكل قديم) لا تظهر، والسقف لكل محلّ
  await add('list.success.owner-mismatch-excluded', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({
        'scanProtocol/before-mismatch': before(3), 'reports/before-mismatch': report('SM-A135F', 'owner-else'),
        'scanProtocol/before-good': before(4), 'reports/before-good': report('SM-A135F'),
      }),
      'شذوذ: pair.ownerId = المستدعي لكن userId في تقرير «قبل» لمحلّ آخر (before-mismatch): تُستبعد من المرشَّحين (OWNER_MISMATCH) ويُعلَن الشذوذ في سجلّ الخادم (anomaly reason=PAIR_OWNER_MISMATCH) لا في الردّ؛ والسليمة وحدها تظهر.');
  await add('list.success.pair-without-owner-not-listed', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({
        'scanProtocol/before-no-owner-pair': before(3, {pair: {state: 'OPEN', openedAt: TS(3)}}), 'reports/before-no-owner-pair': report('SM-A135F'),
        'scanProtocol/before-good': before(4), 'reports/before-good': report('SM-A135F'),
      }),
      '«قبل» بـpair بلا ownerId (شكل قديم أو مالك مجهول عند الفتح): لا تطابق استعلام أيّ محلّ فلا تُقرأ ولا تظهر (لا ترحيل؛ تُعلَن عند الكتابة بملاحظة PAIR_OWNER_ABSENT)؛ والسليمة وحدها تظهر.');
  {
    const otherShopMany = {};
    for (let i = 0; i < 501; i++) otherShopMany[`scanProtocol/other-${String(i).padStart(3, '0')}`] = before(1, {}, 'owner-else');
    await add('list.success.cap-is-per-shop', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
        baseSeed({...otherShopMany, 'scanProtocol/mine-1': before(2), 'reports/mine-1': report('SM-A135F')}),
        'السقف لكل محلّ: محلّ آخر عنده 501 «قبل» مفتوحة (فوق OPEN_PAIR_SCAN_CAP) ولهذا المحلّ واحدة: تُخدَم القائمة بمرشَّحها الوحيد (قبل S8 كان العدّ للمشروع كلّه فيُرفض كل المحلّات بـPAIR_SCAN_CAP_EXCEEDED).',
        {seedSummary: '501 مستند scanProtocol لمحلّ آخر بـpair.ownerId = owner-else وpair.state = OPEN (لا تُدرَج في الملفّ) + «قبل» واحدة لهذا المحلّ (before: mine-1 بتقريرها) + بذرة الجلسة والمالك والإعداد والنوع كما في baseSeed'});
  }
  await add('list.name-unmapped.map-absent', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER),
      baseSeed({'scanProtocol/before-1': before(3), 'reports/before-1': report('SM-A135F')}),
      'خريطة الأسماء غير مكتوبة: كل الأسماء name_unmapped بسبب MAP_ABSENT مع Build.MODEL كما هو (لا اسم مختلَق).');
  const refusals = [
    ['list.refused.not-authenticated', LIST(), null, baseSeed(), 'بلا مصادقة.'],
    ['list.refused.session-id-required', {}, GOOGLE(OWNER), baseSeed(), 'sessionId غائب.'],
    ['list.refused.not-owner', LIST(), GOOGLE('stranger'), baseSeed(), 'غير المالك: SESSION_NOT_PARTICIPANT (الردّ نفسه لجلسة غير موجودة؛ السجلّ يفرّق).'],
    ['list.refused.session-missing', LIST('no-such'), GOOGLE(OWNER), baseSeed(), 'جلسة غير موجودة: الردّ نفسه لغير المالك.'],
    ['list.refused.session-not-after', LIST(), GOOGLE(OWNER), baseSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'pending', purpose: 'maintenance_before', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}}}), 'غرض الجلسة ليس maintenance_after.'],
    ['list.refused.part-not-enabled', LIST(), GOOGLE(OWNER), baseSeed({[`users/${OWNER}`]: {plan: 'shop_pro', protocolParts: {purposes: true}}}), 'جزء batteryBeforeAfter غير مفعَّل للمحلّ.'],
    ['list.refused.validity-setting-absent', LIST(), GOOGLE(OWNER), baseSeed({'protocolSettings/current': {version: 2}}), 'openBeforeValidityHours غير مكتوب: لا قيمة افتراضية.'],
    ['list.refused.session-defect-type-absent', LIST(), GOOGLE(OWNER), baseSeed({'protocolPending/sess-after': {purposeSource: 'selected'}}), 'نوع «بعد» غائب في protocolPending (شذوذ).'],
  ];
  for (const [id, data, auth, seed, note] of refusals) await add(id, 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, data, auth, seed, note);
  {
    const many = {};
    for (let i = 0; i < 501; i++) many[`scanProtocol/many-${String(i).padStart(3, '0')}`] = before(1);
    await add('list.refused.scan-cap-exceeded', 'listOpenMaintenanceBefores', listOpenMaintenanceBefores, LIST(), GOOGLE(OWNER), baseSeed(many),
        'أكثر من 500 «قبل» مفتوحة **لهذا المحلّ** (السقف OPEN_PAIR_SCAN_CAP لكل محلّ؛ S8): رفض مسمّى لا اقتطاع صامت.', {seedSummary: '501 مستند scanProtocol بـpair.ownerId = المستدعي وpair.state = OPEN (لا تُدرَج في الملفّ) + بذرة الجلسة والمالك والإعداد والنوع كما في baseSeed'});
  }

  // ═══ confirmMaintenanceAfterLink ═══
  const confirmSeed = (over = {}) => baseSeed({'scanProtocol/before-1': before(3), 'reports/before-1': report('SM-A135F'), ...over});
  await add('confirm.success', 'confirmMaintenanceAfterLink', confirmMaintenanceAfterLink, CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed(),
      'تأكيد سليم: الردّ {sessionId, beforeScanId, linkMethod: "manual"}، والكتابة الوحيدة set (دمج) على protocolPending: linkedScanId · linkMethod · linkConfirmedAt · linkConfirmedByTechnicianId = null صريحاً (storeAfter). لا شيء يُكتب على «قبل».',
      {storeAfter: ['protocolPending/sess-after']});
  await add('confirm.success.scanning-session', 'confirmMaintenanceAfterLink', confirmMaintenanceAfterLink, CONFIRM('before-1'), GOOGLE(OWNER),
      confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'scanning', joinedBy: 'phone-1', purpose: 'maintenance_after', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}}}),
      'جلسة scanning (بعد انضمام الهاتف) تقبل التأكيد كذلك.', {storeAfter: ['protocolPending/sess-after']});
  await add('confirm.success.re-choice-replaces', 'confirmMaintenanceAfterLink', confirmMaintenanceAfterLink, CONFIRM('before-2'), GOOGLE(OWNER),
      confirmSeed({
        'scanProtocol/before-2': before(5), 'reports/before-2': report('SM-A135F'),
        'protocolPending/sess-after': {purposeSource: 'selected', defectType: 'BATTERY', linkedScanId: 'before-1', linkMethod: 'manual', linkConfirmedAt: TS(1), linkConfirmedByTechnicianId: null},
      }),
      'إعادة الاختيار تستبدل ما في pending (الأحدث يربح): من before-1 إلى before-2.', {storeAfter: ['protocolPending/sess-after']});
  const confirmRefusals = [
    ['confirm.refused.not-authenticated', CONFIRM('before-1'), null, confirmSeed(), 'بلا مصادقة.'],
    ['confirm.refused.session-id-required', {beforeScanId: 'before-1'}, GOOGLE(OWNER), confirmSeed(), 'sessionId غائب.'],
    ['confirm.refused.before-scan-id-required', {sessionId: 'sess-after'}, GOOGLE(OWNER), confirmSeed(), 'beforeScanId غائب.'],
    ['confirm.refused.before-id-invalid', CONFIRM('a/b'), GOOGLE(OWNER), confirmSeed(), 'معرّف «قبل» غير صالح كمعرّف مستند: BEFORE_NOT_FOUND بلا قراءة.'],
    ['confirm.refused.not-owner', CONFIRM('before-1'), GOOGLE('stranger'), confirmSeed(), 'غير المالك: SESSION_NOT_PARTICIPANT.'],
    ['confirm.refused.session-missing', CONFIRM('before-1', 'no-such'), GOOGLE(OWNER), confirmSeed(), 'جلسة غير موجودة: الردّ نفسه لغير المالك.'],
    ['confirm.refused.session-not-active', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'completed', purpose: 'maintenance_after', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}}}), 'الجلسة completed: ليست pending ولا scanning.'],
    ['confirm.refused.session-status-unknown', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'done', purpose: 'maintenance_after', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}}}), 'حالة لا تعرفها الشيفرة.'],
    ['confirm.refused.session-expired', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'pending', purpose: 'maintenance_after', expiresAt: TS(1)}}), 'pending وانقضى expiresAt: «الجلسة منتهية» وتُكتب «منتهية» في المعاملة نفسها (transactionWrites).'],
    ['confirm.refused.session-expires-at-invalid', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'pending', purpose: 'maintenance_after'}}), 'expiresAt غائب: بلا كتابة.'],
    ['confirm.refused.session-not-after', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanSessions/sess-after': {ownerId: OWNER, status: 'pending', purpose: 'normal', expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}}}), 'غرض الجلسة normal.'],
    ['confirm.refused.part-not-enabled', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({[`users/${OWNER}`]: {plan: 'shop_pro', protocolParts: {purposes: true}}}), 'الجزء غير مفعَّل.'],
    ['confirm.refused.validity-setting-absent', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'protocolSettings/current': {version: 2}}), 'المدّة غير مكتوبة.'],
    ['confirm.refused.session-defect-type-absent', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'protocolPending/sess-after': {purposeSource: 'selected'}}), 'نوع «بعد» غائب في pending.'],
    ['confirm.refused.before-not-found', CONFIRM('ghost'), GOOGLE(OWNER), confirmSeed(), '«قبل» غير موجودة.'],
    ['confirm.refused.before-not-owned', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {}, 'owner-else'), 'reports/before-1': report('SM-A135F', 'owner-else')}), '«قبل» لمحلّ آخر (pair.ownerId وتقريرها معاً: S8).'],
    ['confirm.refused.owner-mismatch.report-differs', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'reports/before-1': report('SM-A135F', 'owner-else')}), 'شذوذ (S8): pair.ownerId = المستدعي لكن userId في تقرير «قبل» لمحلّ آخر ⟵ PAIR_OWNER_MISMATCH (لا NOT_OWNED ولا قبول).'],
    ['confirm.refused.owner-mismatch.pair-differs', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {}, 'owner-else')}), 'شذوذ (S8): التقرير للمستدعي لكن pair.ownerId لمحلّ آخر ⟵ PAIR_OWNER_MISMATCH أيضاً.'],
    ['confirm.refused.before-pair-owner-absent', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {pair: {state: 'OPEN', openedAt: TS(3)}})}), 'pair بلا ownerId (شكل قديم أو مالك مجهول عند الفتح، S8) ⟵ PAIR_BEFORE_UNREADABLE: لا يُقرأ تطابقاً ولا يُرفض شذوذاً.'],
    ['confirm.refused.before-wrong-purpose', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {scanPurpose: 'maintenance_after', pair: null})}), 'غرض «قبل» ليس maintenance_before.'],
    ['confirm.refused.before-wrong-defect-type', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {defectType: 'THERMAL'})}), 'نوع «قبل» ≠ نوع «بعد».'],
    ['confirm.refused.before-unreadable', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {pair: {state: 'OPEN'}})}), 'pair على «قبل» بشكل لا يُقرأ (بلا openedAt).'],
    ['confirm.refused.before-already-paired.completed', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(3, {pair: {state: 'COMPLETED', openedAt: TS(3), ownerId: OWNER, completedByScanId: 'after-x'}})}), '«قبل» اكتملت بـ«بعد» أخرى (pair.state = COMPLETED).'],
    ['confirm.refused.before-already-paired.live-link', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/after-live': {scanPurpose: 'maintenance_after', linkedScanId: 'before-1', linkState: 'active', linkMethod: 'manual'}}), '«قبل» لها ربط حيّ من «بعد».'],
    ['confirm.refused.before-expired', CONFIRM('before-1'), GOOGLE(OWNER), confirmSeed({'scanProtocol/before-1': before(80)}), '«قبل» خارج نافذة المدّة (80 ساعة والمدّة 72).'],
  ];
  for (const [id, data, auth, seed, note] of confirmRefusals) await add(id, 'confirmMaintenanceAfterLink', confirmMaintenanceAfterLink, data, auth, seed, note);

  // ═══ setSessionPurpose: رفوض نوع العطل (تقع قبل أيّ قراءة) ═══
  const spSeed = {};
  const SP = (data, id, note) => add(id, 'setSessionPurpose', setSessionPurpose, data, GOOGLE(OWNER), spSeed, note);
  await SP({sessionId: 'sess-any', purpose: 'maintenance_before'}, 'setSessionPurpose.refused.defect-type-required', 'maintenance_* بلا defectType.');
  await SP({sessionId: 'sess-any', purpose: 'maintenance_after', defectType: 'OTHER'}, 'setSessionPurpose.refused.defect-type-invalid.other', 'defectType خارج القائمة المغلقة («OTHER»).');
  await SP({sessionId: 'sess-any', purpose: 'maintenance_before', defectType: 'battery'}, 'setSessionPurpose.refused.defect-type-invalid.lowercase', 'حروف صغيرة: خارج القائمة (بحالة الأحرف نفسها).');
  await SP({sessionId: 'sess-any', purpose: 'maintenance_before', defectType: null}, 'setSessionPurpose.refused.defect-type-invalid.null', 'null مُرسَل مع maintenance_*: DEFECT_TYPE_INVALID (المُرسَل ≠ الغائب).');
  await SP({sessionId: 'sess-any', purpose: 'normal', defectType: 'BATTERY'}, 'setSessionPurpose.refused.defect-type-not-applicable', 'نوع مُرسَل مع normal.');
  await SP({sessionId: 'sess-any', purpose: 'battery_before', defectType: 'BATTERY'}, 'setSessionPurpose.refused.purpose-invalid.battery-before', 'battery_before لم تعد مما يُختار (قيمة قراءة تاريخية): SET_PURPOSE_INVALID.');
  // (ق31، أقرّه حسن 2026-10-22) رفض جزء المحلّ في setSessionPurpose: يقع بعد فحوص الجلسة وقراءة مستند المالك داخل المعاملة، فبذرتها جلسة pending ومستند المالك (أو غيابه) وprotocolPending.
  const PICK = 'sess-pick';
  const pickSeed = (ownerDoc) => ({
    [`scanSessions/${PICK}`]: {ownerId: OWNER, status: 'pending', purpose: 'normal', code: '123456', createdAt: TS(1), expiresAt: {$firestoreTimestamp: new RealDate(FIXED_NOW_MS + HOUR).toISOString()}},
    ...(ownerDoc === null ? {} : {[`users/${OWNER}`]: ownerDoc}),
    [`protocolPending/${PICK}`]: {purposeSource: 'default', defectType: null, linkedScanId: null},
  });
  const PICK_MAINT = (purpose) => ({sessionId: PICK, purpose, defectType: 'BATTERY'});
  await add('setSessionPurpose.refused.part-not-enabled.purposes', 'setSessionPurpose', setSessionPurpose, PICK_MAINT('maintenance_before'), GOOGLE(OWNER), pickSeed({plan: 'shop_pro', protocolParts: {batteryBeforeAfter: true}}),
      'محلّ جزء purposes فيه غير مفعَّل (غائب ولو كان batteryBeforeAfter مفعَّلاً) ⟵ PURPOSE_PART_NOT_ENABLED (failed-precondition، الرسالة رمزه التقني) بلا أيّ كتابة؛ اسم الجزء الناقص (part=purposes) في سجلّ الخادم لا في الجسم.');
  await add('setSessionPurpose.refused.part-not-enabled.battery-before-after', 'setSessionPurpose', setSessionPurpose, PICK_MAINT('maintenance_after'), GOOGLE(OWNER), pickSeed({plan: 'shop_pro', protocolParts: {purposes: true}}),
      'purposes مفعَّل وbatteryBeforeAfter غائب، وغرض صيانة ⟵ PURPOSE_PART_NOT_ENABLED (part=batteryBeforeAfter في السجلّ) بلا أيّ كتابة؛ normal لهذا المحلّ مقبول.');
  await add('setSessionPurpose.refused.part-not-enabled.owner-absent', 'setSessionPurpose', setSessionPurpose, PICK_MAINT('maintenance_before'), GOOGLE(OWNER), pickSeed(null),
      'مستند المالك غائب: حالة صريحة بالرمز نفسه PURPOSE_PART_NOT_ENABLED (owner=absent part=purposes في السجلّ)، لا نجاحاً ولا قيمة افتراضية (القاعدة 22)، بلا أيّ كتابة.');
  await add('setSessionPurpose.success.normal-without-parts', 'setSessionPurpose', setSessionPurpose, {sessionId: PICK, purpose: 'normal'}, GOOGLE(OWNER), pickSeed({plan: 'shop_pro'}),
      'normal يبقى مقبولاً لمحلّ بلا الأجزاء كما كان قبل ق31 (لا قراءة لمستند المالك له): الردّ {sessionId, purpose, purposeSource: "selected"} وكتابتان: الغرض في الجلسة والمصدر في protocolPending.',
      {storeAfter: [`protocolPending/${PICK}`]});

  return {samples};
}

function provenance(kind) {
  return {
    _provenance: {
      generator: 'functions/scripts/generate-maintenance-pair-wire-samples.js',
      decision: 'أمر المستخدم 2026-10-22 (ربط «قبل الصيانة» بـ«بعد الصيانة»، المرحلة S7): منقول عن أمر الباك اند، غير متحقَّق من هذا المستودع',
      kind,
      whatIsReal: 'غلاف onCall الحقيقي (firebase-functions) يكتب الحالة والجسم؛ الدالّتان المُصدَّرتان بمعالجَيهما الكاملين وكل ما يحكم فيهما؛ وsetSessionPurpose المُصدَّرة لرفوض النوع.',
      whatIsStubbed: 'utils/admin ⟵ db في الذاكرة (test/lib/pairFakeDb.js) بمستندات اصطناعية؛ والساعة مجمَّدة وقت كل نداء (2026-10-22T12:00:00Z). بلا Firestore ولا محاكٍ ولا إنتاج ولا شبكة.',
      notVerified: 'سلوك الدالّتين على Firestore الحقيقي (يغطّيه maintenancePair.e2e.test.js على المحاكي)، وسلوك التطبيق عند هذه الأجسام. لا عيّنة طلب من التطبيق هنا (يُنتجها كاتب التطبيق ثم تُنسخ).',
      followsContract: 'docs/PROTOCOL_CONTRACT.md §٢ A2 وA3 (إلحاقات 2026-10-22) (القاعدة 39: من يغيّر العقد يُعيد التوليد في الالتزام نفسه).',
    },
  };
}

async function main() {
  const out = await buildMaintenancePairWireSamples();
  fs.writeFileSync(DEST, JSON.stringify({...provenance('maintenance pair wire replies'), ...out}, null, 2) + '\n', 'utf8');
  console.log(`كُتبت العيّنات (${out.samples.length}) إلى: ${DEST}`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
}

module.exports = {buildMaintenancePairWireSamples, provenance, DEST, FIXED_NOW_MS};
