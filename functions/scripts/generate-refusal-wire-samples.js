#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-refusal-wire-samples — العيّنات الذهبية لأجسام الرفض الجديدة وردّ checkSubscription بشكله الحالي (A-SUB الموجة الأولى، البند ١٤، 2026-10-17 +03)
// ===================================================================
//
// قرار المستخدم ١٤ (بنصّه، منقول عن أمر المنسّق order-backend-engineer-asub-wave1-2026-10-17.md — غير متحقَّق من هذا المستودع): «بعد ٤ و١٢» — العيّنات الذهبية (القاعدتان 39 و41) لأجسام الرفض الجديدة
// (من probe-wire.js أو ما يعادله بالشيفرة الحقيقية، بلا محاكٍ)، ولـcheckSubscription بشكله الحالي (سيُعاد توليدها حين يُنفَّذ القرار ٨). والفخّ الذهبي يتبع العقد (39).
//
// ─── ما هو «الجسم» هنا ──────────────────────────────────────────────────────────────────────────────
// ما يستقبله التطبيق فعلاً على السلك: **حالة HTTP + جسم الردّ** كما يكتبهما غلاف onCall الحقيقي في firebase-functions (wrapOnCallHandler): `{error: HttpsError.toJSON()}` بحالة `httpErrorCode.status`
// للرفض، و`{result: encode(<ردّ المعالج>)}` بحالة 200 للنجاح — **لا HttpsError في الذاكرة**. الاستدعاء يمرّ بالدالّة المُصدَّرة نفسها `exports.<name>(req, res)` (الغلاف + cors + فكّ التوكن + المعالج الحقيقي)،
// بطلب POST مبنيّ بيد هذا المولّد وبتوكن **غير موقَّع** يُقبل لأن العملية تُشغَّل بـFIREBASE_DEBUG_MODE=true وskipTokenVerification (ميزة تنقيح قائمة في firebase-functions لهذا الغرض، تفكّ التوكن بلا شبكة ولا مفتاح).
// **يجب أن يُحمَّل هذا الملفّ قبل أيّ تحميل لـfirebase-functions في العملية** (المتغيّران يُقرآن عند التحميل)؛ وإلا يخرج الردّ unauthenticated فيتوقّف المولّد بخطأ مسمّى لا عيّنة خاطئة.
//
// ─── ما هو حقيقي وما هو مستبدَل (القاعدة 37 — مُعلَن) ───────────────────────────────────────────────────
// **حقيقي:** غلاف onCall وcors وفكّ التوكن وencode، وcreateScanSession وanalyzeDevice وrequestPayment وcheckSubscription، وكل ما يحكم فيها (scanGateVerdict · refuseScan · scanRefusalWire ·
// sessionRoleOf · isLegitCompletedSessionRetry · sessionExpiryRefusal · signInProviderStatus · checkSubscriptionVerdict)، وفئة Timestamp من firebase-admin.
// **مستبدَل:** utils/admin ⟵ db في الذاكرة (مستندات users وscanSessions وreports المبذورة أدناه)، فلا Firestore ولا محاكٍ ولا إنتاج ولا شبكة. **نتيجة معلَنة:** مستندات users هنا اصطناعية؛ أشكال expiresAt الموجودة
// فعلاً في الإنتاج (Timestamp أم نصّ ISO أم رقم ms) غير متحقَّق منها (لا قراءة من الإنتاج). العيّنة الكاملة من سلسلة محاكي Firestore (القاعدة 41 بصورتها الكاملة) لم تُولَّد: المحاكي غير مأذون في هذه الموجة.
//
// ─── العقد الذي يتبعه (القاعدة 39) ──────────────────────────────────────────────────────────────────
// docs/PROTOCOL_CONTRACT.md §٦-د-١ (رموز رفض analyzeDevice على الجلسة) و§١٠-ج (رفضا createScanSession وغيرهما) و§١٠-و (حقل scanVerdict). من يغيّر أيّاً منها يُعيد توليد هذين الملفَّين في الالتزام نفسه، ويحرس ذلك
// test/refusalWireGoldenGuard.test.js (يعيد البناء ويقارن حرفاً بحرف، ويقارن مجموعة الرموز المغلقة بالوحدات وبالعقد).
// **checkSubscription: عيّنتها بالشكل الحالي، وستُعاد عند تنفيذ القرار ٨ (بصمة الجهاز في checkSubscription، مؤجَّل — لم يُمسّ).**
//
// Run: node functions/scripts/generate-refusal-wire-samples.js
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
const REFUSAL_DEST = path.join(GOLDEN_DIR, 'refusal-wire-samples-asub-wave1.json');
const CHECK_SUBSCRIPTION_DEST = path.join(GOLDEN_DIR, 'check-subscription-wire-samples-current-shape.json');

// ─── التواريخ ثابتة (لا Date.now): الماضي والمستقبل بعيدان فلا يتغيّر الحكم مع الزمن ───
const PAST = new Date('2025-01-01T00:00:00.000Z');
const FUTURE = new Date('2099-01-01T00:00:00.000Z');

// ─── db في الذاكرة (الاستبدال المُعلَن) ───
const store = {};
const txUpdates = [];
const key = (c, id) => `${c}/${id}`;
function refOf(c, id) {
  return {
    id, path: key(c, id),
    get: async () => ({id, exists: store[key(c, id)] !== undefined, data: () => store[key(c, id)], ref: refOf(c, id)}),
  };
}
const fakeDb = {
  collection: (c) => {
    // S-P6-07 (2026-10-21): analyzeDevice صارت تقرأ قبل البوّابة المبكّرة (وقبل القفل والحجز والنموذج) سياق البروتوكول بمعرّف المستند: protocolSettings/current وprotocolPending/{sessionId} (وscanProtocol للأمّ في فحص الابن وحده).
    // هذه العيّنات للرفض وكلّها بلا هذه المستندات (غير موجودة: refOf تُعيد exists=false لما لم يُبذَر)، فالردّ على السلك لا يتغيّر والعيّنات الذهبية بايتاً ببايت — فتُسمح المجموعات الثلاث قراءةً فارغة لا غير (الكتابة فيها تُرمى كما غيرها).
    if (!['users', 'scanSessions', 'reports', 'payments', 'protocolSettings', 'protocolPending', 'scanProtocol'].includes(c)) throw new Error(`generate-refusal-wire-samples: مجموعة غير متوقَّعة "${c}" — هذا المسار لا يمسّ غيرها`);
    return {
      doc: (id) => refOf(c, id),
      add: async () => { throw new Error('generate-refusal-wire-samples: كتابة payments غير متوقَّعة — هذه العيّنات للرفض فقط'); },
    };
  },
  runTransaction: async (cb) => cb({
    get: async (ref) => ref.get(),
    update: (ref, fields) => { txUpdates.push(ref.path); store[ref.path] = {...store[ref.path], ...fields}; },
    set: () => { throw new Error('generate-refusal-wire-samples: tx.set غير متوقَّعة'); },
  }),
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: {firestore: {FieldValue: {serverTimestamp: () => 'TS'}}}, db: fakeDb, ADMIN_EMAILS: [], requireAdmin: () => {}},
};

// الدوالّ المُصدَّرة الحقيقية (بعد الاستبدال أعلاه، وقبل أيّ تحميل آخر لـfirebase-functions خارج سلسلتها)
const {createScanSession} = require('../src/sessions/createScanSession');
const {analyzeDevice} = require('../src/analysis/analyzeDevice');
const {requestPayment} = require('../src/payments/requestPayment');
const {checkSubscription} = require('../src/users/checkSubscription');
const {Timestamp} = require('firebase-admin/firestore');

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
  try { await fn(req, res); } finally { Object.assign(console, real); }
  if (httpStatus === 401 && body && body.error && body.error.message === 'Unauthenticated') { // نصّ الغلاف الإنجليزي لتوكن مرفوض (نصوص دوالّنا عربية)
    throw new Error('generate-refusal-wire-samples: التوكن غير الموقَّع رُفض — الملفّ حُمِّل بعد firebase-functions (انظر الرأس) أو تغيّر سلوك skipTokenVerification');
  }
  return {httpStatus, body};
}

const reset = () => { for (const k of Object.keys(store)) delete store[k]; txUpdates.length = 0; };
const FP = {device: {model: 'M-SAMPLE', androidVersion: '14', totalRamGb: 8}};
const GOOGLE = (uid) => ({uid, provider: 'google.com'});
const ANON = (uid) => ({uid, provider: 'anonymous'});

/** @return {Promise<Object>} {samples: [...]} للرفض الجديد */
async function buildRefusalWireSamples() {
  const samples = [];
  const add = async (id, fnName, fn, data, auth, seed, note) => {
    reset();
    for (const [k, v] of Object.entries(seed)) store[k] = v;
    const {httpStatus, body} = await callWire(fn, data, auth);
    samples.push({
      id, function: fnName, note,
      request: {data, authenticatedAs: auth ? {sign_in_provider: auth.provider, uid: auth.uid} : null},
      seed: JSON.parse(JSON.stringify(seed, (k, v) => ((v instanceof Timestamp) ? {$firestoreTimestamp: v.toDate().toISOString()} : v))),
      httpStatus, body,
    });
    if (txUpdates.length > 0) samples[samples.length - 1].transactionWrites = [...txUpdates];
  };

  // ═══ ١ — createScanSession: رفضان جديدان (البند ٤) ═══
  await add('createScanSession.SHOP_NO_CREDIT', 'createScanSession', createScanSession, {}, GOOGLE('owner-nocredit'),
      {'users/owner-nocredit': {scansRemaining: 0, plan: 'shop_basic', expiresAt: Timestamp.fromDate(FUTURE)}},
      'المالك بلا رصيد. النصّ هو النصّ الخاصّ القائم بلا الجملة الثانية (لا يُوحَّد مع نصّ البوّابة بقرار المستخدم ٤).');
  await add('createScanSession.SHOP_SUBSCRIPTION_EXPIRED', 'createScanSession', createScanSession, {}, GOOGLE('owner-expired'),
      {'users/owner-expired': {scansRemaining: 5, plan: 'shop_basic', expiresAt: Timestamp.fromDate(PAST)}},
      'المالك منتهٍ اشتراكه (برصيد). النصّ من scanRefusalWire.');
  // البند ١ (A-SUB، 2026-10-17): باقة المالك لا تسمح بإنشاء جلسة — رصيد وغير منتهٍ، فيأتي الرفض من فحص الباقة (بعد الرصيد والانتهاء). النصّ العربي الجديد المحايد.
  await add('createScanSession.SHOP_PLAN_REQUIRED.free', 'createScanSession', createScanSession, {}, GOOGLE('owner-free'),
      {'users/owner-free': {scansRemaining: 3, plan: 'free', expiresAt: Timestamp.fromDate(FUTURE)}},
      'المالك باقته free برصيد وغير منتهٍ: يُرفض بـSHOP_PLAN_REQUIRED (كان ينشئ جلسة ويُفوتَر فحصها على رصيده). النصّ جديد محايد (CREATE_SESSION_PLAN_REQUIRED_TEXT).');
  await add('createScanSession.SHOP_PLAN_REQUIRED.plan-absent', 'createScanSession', createScanSession, {}, GOOGLE('owner-noplan'),
      {'users/owner-noplan': {scansRemaining: 3, expiresAt: Timestamp.fromDate(FUTURE)}},
      'المستند بلا حقل plan: الغياب لا يُقرأ إذناً (القاعدة 22) فيُرفض بالرمز نفسه والجسم نفسه.');

  // ═══ ٢ — analyzeDevice على الجلسة: رموز الرفض الجديدة (البند ١٢) ═══
  const SESSION = (fields) => ({ownerId: 'owner-s', status: 'scanning', joinedBy: 'joiner-s', scanId: null, expiresAt: Timestamp.fromDate(FUTURE), ...fields});
  const reqS = (sessionId, scanId) => ({scanId, sessionId, fingerprint: FP});
  await add('analyzeDevice.session.NOT_PARTICIPANT.stranger', 'analyzeDevice', analyzeDevice, reqS('sess-1', 'scan-1'), ANON('stranger-s'),
      {'scanSessions/sess-1': SESSION({status: 'cancelled'})},
      'مستدعٍ ليس مالكاً ولا منضمّاً: لا تُكشَف حالة الجلسة (cancelled هنا) — الرمز نفسه لغياب الجلسة.');
  await add('analyzeDevice.session.NOT_PARTICIPANT.missing', 'analyzeDevice', analyzeDevice, reqS('sess-missing', 'scan-1'), ANON('joiner-s'),
      {}, 'جلسة غير موجودة: الرمز نفسه لغير الطرف (لا وسيط وجود).');
  await add('analyzeDevice.session.NOT_STARTED', 'analyzeDevice', analyzeDevice, reqS('sess-2', 'scan-1'), GOOGLE('owner-s'),
      {'scanSessions/sess-2': SESSION({status: 'pending', joinedBy: null})}, 'الجلسة pending: لم ينضمّ جهاز (الرمز الجديد الوحيد). المالك طرف فيراه.');
  await add('analyzeDevice.session.COMPLETED.no-stored-report', 'analyzeDevice', analyzeDevice, reqS('sess-3', 'scan-A'), ANON('joiner-s'),
      {'scanSessions/sess-3': SESSION({status: 'completed', scanId: 'scan-A'})}, 'completed بلا تقرير مخزَّن: لا ردّ يُقدَّم فيُرفض بالرمز المسمّى.');
  await add('analyzeDevice.session.COMPLETED.report-not-owners', 'analyzeDevice', analyzeDevice, reqS('sess-4', 'scan-A'), ANON('joiner-s'),
      {'scanSessions/sess-4': SESSION({status: 'completed', scanId: 'scan-A'}), 'reports/scan-A': {userId: 'someone-else', pipeline: 'sample', aiResponse: {marker: 'MUST-NOT-LEAK'}}},
      'completed وتقرير مخزَّن ملكيته لغير مالك الجلسة: يُرفض ولا يُسرَّب (جسم الخطأ بلا أيّ شيء من التقرير).');
  await add('analyzeDevice.session.COMPLETED.other-scan', 'analyzeDevice', analyzeDevice, reqS('sess-5', 'scan-OTHER'), ANON('joiner-s'),
      {'scanSessions/sess-5': SESSION({status: 'completed', scanId: 'scan-A'})}, 'طرف مشروع يطلب scanId غير scanId جلسته: يُرفض بالرمز نفسه.');
  await add('analyzeDevice.session.CANCELLED', 'analyzeDevice', analyzeDevice, reqS('sess-6', 'scan-1'), ANON('joiner-s'),
      {'scanSessions/sess-6': SESSION({status: 'cancelled'})}, 'الجلسة ملغاة (المنضمّ طرف فيراها).');
  await add('analyzeDevice.session.EXPIRED.recorded', 'analyzeDevice', analyzeDevice, reqS('sess-7', 'scan-1'), ANON('joiner-s'),
      {'scanSessions/sess-7': SESSION({status: 'expired'})}, 'مسجَّلة «منتهية» من قبل: permission-denied «جلسة الفحص غير صالحة» + SESSION_EXPIRED (لأن الحالة لا الانقضاء).');
  await add('analyzeDevice.session.EXPIRED.by-time', 'analyzeDevice', analyzeDevice, reqS('sess-8', 'scan-1'), ANON('joiner-s'),
      {'scanSessions/sess-8': SESSION({expiresAt: Timestamp.fromDate(PAST)})}, 'scanning وانقضى expiresAt: failed-precondition «الجلسة منتهية» + SESSION_EXPIRED، وتُكتب «منتهية» (transactionWrites).');
  await add('analyzeDevice.session.EXPIRES_AT_INVALID', 'analyzeDevice', analyzeDevice, reqS('sess-9', 'scan-1'), ANON('joiner-s'),
      {'scanSessions/sess-9': (() => { const s = SESSION({}); delete s.expiresAt; return s; })()}, 'scanning بلا expiresAt: permission-denied + SESSION_EXPIRES_AT_INVALID (بلا كتابة).');
  await add('analyzeDevice.session.EXPIRED.by-time.stranger', 'analyzeDevice', analyzeDevice, reqS('sess-10', 'scan-1'), ANON('stranger-s'),
      {'scanSessions/sess-10': SESSION({expiresAt: Timestamp.fromDate(PAST)})}, 'انقضاء الوقت لغير الطرف: failed-precondition «الجلسة منتهية» لكن السبب NOT_PARTICIPANT.');
  await add('analyzeDevice.session.STATUS_UNKNOWN', 'analyzeDevice', analyzeDevice, reqS('sess-11', 'scan-1'), ANON('joiner-s'),
      {'scanSessions/sess-11': SESSION({status: 'done'})}, 'حالة لا تعرفها الشيفرة (القاعدة 22: تُعلَن لا تُقرأ صالحة).');

  // ═══ ٢-ب — التقرير المخزَّن لا يُردّ إلا لمالكه (البند ٢، 2026-10-17): جلسة scanning ومسار شخصي ═══
  await add('analyzeDevice.session.REPORT_NOT_AVAILABLE.not-owners', 'analyzeDevice', analyzeDevice, reqS('sess-12', 'scan-B'), ANON('joiner-s'),
      {'scanSessions/sess-12': SESSION({}), 'reports/scan-B': {userId: 'someone-else', pipeline: 'sample', aiResponse: {marker: 'MUST-NOT-LEAK'}}},
      'جلسة scanning صالحة والتقرير المخزَّن لـscanId الطلب ملكيته لغير مالك الجلسة: يُرفض بالرمز SESSION_REPORT_NOT_AVAILABLE ولا يُسرَّب (الحالة MISMATCH في السجلّ وحده)، والجلسة تبقى scanning بلا كتابة.');
  await add('analyzeDevice.session.REPORT_NOT_AVAILABLE.report-user-absent', 'analyzeDevice', analyzeDevice, reqS('sess-13', 'scan-B'), ANON('joiner-s'),
      {'scanSessions/sess-13': SESSION({}), 'reports/scan-B': {pipeline: 'sample', aiResponse: {marker: 'MUST-NOT-LEAK'}}},
      'التقرير المخزَّن بلا userId: الغياب حالة صريحة تُرفض بالرمز نفسه (الجسم لا يفرّق بينها وبين «ملكية غيرك»؛ REPORT_USER_ABSENT في السجلّ وحده).');
  await add('analyzeDevice.storedReport.personal.NOT_AVAILABLE.not-owner', 'analyzeDevice', analyzeDevice, {scanId: 'scan-P', fingerprint: FP}, GOOGLE('stranger-p'),
      {'reports/scan-P': {userId: 'personal-owner', pipeline: 'sample', aiResponse: {marker: 'MUST-NOT-LEAK'}}},
      'مسار شخصي (بلا sessionId): uid آخر يعرف scanId يُرفض permission-denied بنصّ محايد والرمز SCAN_REPORT_NOT_AVAILABLE، ولا شيء من التقرير.');
  await add('analyzeDevice.storedReport.personal.NOT_AVAILABLE.report-user-absent', 'analyzeDevice', analyzeDevice, {scanId: 'scan-P', fingerprint: FP}, GOOGLE('personal-owner'),
      {'reports/scan-P': {pipeline: 'sample', aiResponse: {marker: 'MUST-NOT-LEAK'}}},
      'مسار شخصي، التقرير بلا userId: يُرفض بالرمز نفسه (القاعدة 22).');

  // ═══ ٣ — بوّابة analyzeDevice المبكّرة (S-SUB): أجسامها لم تُسجَّل ذهبياً من قبل، فتُضمّ هنا لتكتمل أسرة الرفض ═══
  const reqP = {scanId: 'scan-P', fingerprint: FP};
  const DEVICE_KEY = 'M-SAMPLE_14_8';
  await add('analyzeDevice.gate.NO_CREDIT', 'analyzeDevice', analyzeDevice, reqP, GOOGLE('personal-nocredit'),
      {'users/personal-nocredit': {scansRemaining: 0, plan: 'shop_basic'}}, 'فحص شخصي بلا رصيد (S-SUB، قائم).');
  await add('analyzeDevice.gate.SUBSCRIPTION_EXPIRED', 'analyzeDevice', analyzeDevice, reqP, GOOGLE('personal-expired'),
      {'users/personal-expired': {scansRemaining: 4, plan: 'shop_basic', expiresAt: Timestamp.fromDate(PAST)}}, 'فحص شخصي منتهٍ اشتراكه (S-SUB، قائم).');
  await add('analyzeDevice.gate.FREE_DEVICE_USED', 'analyzeDevice', analyzeDevice, reqP, GOOGLE('personal-free'),
      {'users/personal-free': {scansRemaining: 3, plan: 'free', freeTrialUsedDevices: [DEVICE_KEY]}}, 'باقة free والجهاز مسجَّل مستعمَلاً (S-SUB، قائم).');
  await add('analyzeDevice.gate.SHOP_NO_CREDIT', 'analyzeDevice', analyzeDevice, reqS('sess-g1', 'scan-G1'), ANON('joiner-s'),
      {'scanSessions/sess-g1': SESSION({}), 'users/owner-s': {scansRemaining: 0, plan: 'shop_pro'}}, 'فحص جلسة، رصيد المالك 0 (S-SUB، قائم).');
  await add('analyzeDevice.gate.SHOP_SUBSCRIPTION_EXPIRED', 'analyzeDevice', analyzeDevice, reqS('sess-g2', 'scan-G2'), ANON('joiner-s'),
      {'scanSessions/sess-g2': SESSION({}), 'users/owner-s': {scansRemaining: 5, plan: 'shop_pro', expiresAt: Timestamp.fromDate(PAST)}}, 'فحص جلسة، المالك منتهٍ اشتراكه (S-SUB، قائم).');

  // ═══ ٤ — requestPayment: رفض المجهول (البند ١١) ═══
  await add('requestPayment.anonymous', 'requestPayment', requestPayment, {plan: 'single', reference: 'ref-sample'}, ANON('anon-payer'),
      {}, 'الدافع المجهول يُرفض قبل أيّ كتابة، بنصّ الدالّة القائم «غير مصادق».');

  return {samples};
}

/** @return {Promise<Object>} {samples: [...]} ردّ checkSubscription بشكله الحالي (قبل القرار ٨) */
async function buildCheckSubscriptionWireSamples() {
  const samples = [];
  const add = async (id, seed, note) => {
    reset();
    for (const [k, v] of Object.entries(seed)) store[k] = v;
    const {httpStatus, body} = await callWire(checkSubscription, {}, GOOGLE('sub-user'));
    samples.push({
      id, note,
      // شكل expiresAt المخزَّن في المستند المبذور (لا القيمة الخام للـTimestamp): النوع فقط، فالقيمة على السلك في body
      seedExpiresAtKind: seed['users/sub-user'] === undefined ? 'no-users-document' : describeKind(seed['users/sub-user'].expiresAt),
      httpStatus, body,
    });
  };
  const describeKind = (v) => {
    if (v === undefined) return 'absent';
    if (v === null) return 'null';
    if (v instanceof Timestamp) return 'firestore-timestamp';
    return typeof v === 'string' ? 'iso-string' : typeof v;
  };
  const active = {plan: 'shop_basic', scansRemaining: 4, scansTotal: 10, isActive: true};
  await add('active', {'users/sub-user': {...active, expiresAt: Timestamp.fromDate(FUTURE)}}, 'اشتراك ساري برصيد: scanVerdict=ALLOWED. expiresAt Timestamp حقيقية الفئة (على السلك: _seconds و_nanoseconds).');
  await add('expired.timestamp', {'users/sub-user': {...active, expiresAt: Timestamp.fromDate(PAST)}}, 'منتهٍ، expiresAt Timestamp: SUBSCRIPTION_EXPIRED.');
  await add('no-credit', {'users/sub-user': {...active, scansRemaining: 0, expiresAt: Timestamp.fromDate(FUTURE)}}, 'رصيد 0: NO_CREDIT (الرصيد قبل التاريخ).');
  await add('expired.iso-string', {'users/sub-user': {...active, expiresAt: PAST.toISOString()}}, 'expiresAt نصّ ISO قديم: SUBSCRIPTION_EXPIRED، ويخرج النصّ كما خُزِّن. شكل الإنتاج الفعلي غير متحقَّق.');
  await add('expired.ms-number', {'users/sub-user': {...active, expiresAt: PAST.getTime()}}, 'expiresAt رقم ms قديم: SUBSCRIPTION_EXPIRED، ويخرج الرقم كما خُزِّن. شكل الإنتاج الفعلي غير متحقَّق.');
  await add('free.no-expiresAt', {'users/sub-user': {plan: 'free', scansRemaining: 3, scansTotal: 3, isActive: true}}, 'باقة free بلا expiresAt: ALLOWED وفيه "expiresAt": null (غياب لا انتهاء، utils/subscription.js).');
  await add('no-users-document', {}, 'مستخدم بلا مستند users: scanVerdict=NO_CREDIT (لا حالة «غير مسجَّل»، القاعدة 22 — القرار ٨ المؤجَّل يتناولها).');
  return {samples};
}

function provenance(kind) {
  return {
    _provenance: {
      generator: 'functions/scripts/generate-refusal-wire-samples.js',
      decision: 'القرار ١٤ (A-SUB الموجة الأولى، 2026-10-17): منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع',
      kind,
      whatIsReal: 'غلاف onCall الحقيقي (firebase-functions wrapOnCallHandler) يكتب الحالة والجسم؛ الدالّة المُصدَّرة الحقيقية؛ الحرّاس الحقيقيون؛ فئة Timestamp من firebase-admin.',
      whatIsStubbed: 'utils/admin ⟵ db في الذاكرة بمستندات اصطناعية (users/scanSessions/reports). بلا Firestore ولا محاكٍ ولا إنتاج ولا شبكة ولا نموذج. التوكن غير موقَّع بميزة skipTokenVerification.',
      notVerified: 'أشكال expiresAt الموجودة فعلاً في الإنتاج؛ وسلوك التطبيق (1.0.12-1.0.14) عند هذه الأجسام. لم تُولَّد عيّنة من محاكي Firestore (غير مأذون).',
      followsContract: 'docs/PROTOCOL_CONTRACT.md §٦-د-١ و§١٠-ج و§١٠-و (القاعدة 39: من يغيّر العقد يُعيد التوليد في الالتزام نفسه).',
    },
  };
}

async function main() {
  const refusal = await buildRefusalWireSamples();
  fs.writeFileSync(REFUSAL_DEST, JSON.stringify({...provenance('refusal bodies'), ...refusal}, null, 2) + '\n', 'utf8');
  const check = await buildCheckSubscriptionWireSamples();
  fs.writeFileSync(CHECK_SUBSCRIPTION_DEST, JSON.stringify({...provenance('checkSubscription reply, current shape (before decision 8)'), ...check}, null, 2) + '\n', 'utf8');
  console.log(`كُتبت: ${REFUSAL_DEST} (${refusal.samples.length} عيّنة)`);
  console.log(`كُتبت: ${CHECK_SUBSCRIPTION_DEST} (${check.samples.length} عيّنة)`);
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
}

module.exports = {buildRefusalWireSamples, buildCheckSubscriptionWireSamples, provenance, REFUSAL_DEST, CHECK_SUBSCRIPTION_DEST};
