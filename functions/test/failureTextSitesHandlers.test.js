'use strict';

// failureTextSitesHandlers.test.js — سلوك مواضع التنقية في المعالجات (A-SUB الموجة الأولى، البند ١٣، 2026-10-17 +03). صفر شبكة وصفر محاكٍ وصفر Firestore حقيقي.
//
// القاعدة 36: نصّ خطأ FCM/SMTP/Firestore/Storage/puppeteer قد يحمل سرّاً (طرف مفتاح، مسار مستند بمعرّفه، رمز طويل). هنا المعالجات التي يمكن تشغيلها بلا محاكٍ:
// rejectPayment · confirmPayment · redeemPromoCode · registerUser · sendNotificationEmail · generateReportPdf (الثلاثة، والرسالة تصل **العميل**) · verifyReport · resolvePendingEvaluation ·
// findDeviceProfile (٣) · createDeviceProfile · appendScanToHistory · resolveAiConfig / resolveGeminiFallbackConfig / resolveCacheConfig · createScanSession.wrapUnexpectedCreateSessionError.
//
// **الاستبدال (القاعدة 37) معلَن:** utils/admin (db مزيَّف يقرأ من الذاكرة، وadmin.messaging/storage مزيَّفان) · getMailTransporter (sendMail يرمي) · puppeteer-core و@sparticuz/chromium.
// طبقات التنقية كلّها حقيقية. **لا يُغطّى هنا (يحتاج المحاكي، غير مأذون):** analyzeDevice (٤ مواضع) · joinScanSession (FCM) · checkExpiringSubscriptions (٦) · runConsistencyTest (١) — يحرسها
// failureTextSites.test.js بالنصّ (وعدّ المواضع بأداة)، لا بالسلوك. أشكال الأخطاء **مبنيّة** بيد هذا الاختبار بمعرّف ومفتاح مختلَقَين.
//
// Run: node functions/test/failureTextSitesHandlers.test.js

const assert = require('assert');
process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const SCAN = 'f3b2c1d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const LONG = `sk-${'A1b2C3d4'.repeat(5)}`;
const KEYPHRASE = 'sk-REALSECRET1234567890';
// البند ٤-د (2026-10-18، القاعدة 23: يستبدل الشكل السابق): ردّ SMTP الحقيقي الشكل يحمل عنوان المستلم، فالنصّ المعادي يحمله مبكّراً (قبل حدّ القصّ 200) كي لا يختفي بالقصّ فيمرّ الاختبار فارغاً.
const EMAIL = 'victim.person+tag@sub.example.co.uk';
const hostile = (tag) => `${tag}-DIAG 550 5.1.1 <${EMAIL}>: Recipient address rejected api_key: ${KEYPHRASE} at projects/p/databases/(default)/documents/reports/${SCAN} bearer ${LONG}`;
const isClean = (text) => !text.includes(KEYPHRASE) && !text.includes(SCAN) && !text.includes(LONG) && !text.includes(EMAIL) && !text.includes('victim.person');
const mkErr = (msg, extra = {}) => Object.assign(new Error(msg), extra);

// ─── الاستبدالات المعلَنة ──────────────────────────────────────────────
const store = {};
const failures = {}; // 'op:collection/id' ⟵ خطأ يُرمى
let queryResult = {empty: true, docs: []};
const fail = (key) => { if (failures[key]) throw failures[key]; };
const snap = (c, id) => {
  const data = store[`${c}/${id}`];
  return {id, exists: data !== undefined, data: () => data, ref: refOf(c, id)};
};
function refOf(c, id) {
  return {
    id, path: `${c}/${id}`,
    get: async () => { fail(`get:${c}/${id}`); return snap(c, id); },
    update: async () => { fail(`update:${c}/${id}`); },
    set: async () => { fail(`set:${c}/${id}`); },
  };
}
const fakeDb = {
  collection: (c) => {
    fail(`collection:${c}`);
    const q = {where: () => q, limit: () => q, get: async () => { fail(`query:${c}`); return queryResult; }};
    return {doc: (id) => refOf(c, id), where: q.where, limit: q.limit, get: q.get};
  },
  runTransaction: async (cb) => {
    fail('runTransaction');
    return cb({get: async (ref) => ref.get(), update: () => {}, set: () => {}});
  },
};
let fcmThrow = null;
let storageBehavior = {};
const FieldValue = {serverTimestamp: () => 'TS', increment: (x) => ({inc: x}), delete: () => 'DEL', arrayUnion: (x) => ({union: x})};
const fakeAdmin = {
  firestore: {FieldValue, Timestamp: {now: () => 'NOW'}},
  messaging: () => ({send: async () => { throw fcmThrow; }}),
  storage: () => ({bucket: () => ({file: () => ({
    save: async () => { if (storageBehavior.save) throw storageBehavior.save; },
    getSignedUrl: async () => { if (storageBehavior.sign) throw storageBehavior.sign; return ['https://example.invalid/x']; },
  })})}),
};
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {admin: fakeAdmin, db: fakeDb, ADMIN_EMAILS: [], requireAdmin: () => {}, isVerifiedAdmin: () => false},
};
let mailThrow = null;
const emailsPath = require.resolve('../src/utils/emails');
const realEmails = require('../src/utils/emails');
require.cache[emailsPath].exports = {...realEmails, getMailTransporter: () => ({sendMail: async () => { if (mailThrow) throw mailThrow; return {}; }})};
let launchBehavior = null;
const puppeteerPath = require.resolve('puppeteer-core');
require.cache[puppeteerPath] = {id: puppeteerPath, filename: puppeteerPath, loaded: true, exports: {launch: async (...a) => launchBehavior(...a)}};
const chromiumPath = require.resolve('@sparticuz/chromium');
require.cache[chromiumPath] = {id: chromiumPath, filename: chromiumPath, loaded: true, exports: {args: [], defaultViewport: null, headless: true, executablePath: async () => '/nowhere'}};

const resetState = () => {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(failures)) delete failures[k];
  fcmThrow = null; mailThrow = null; storageBehavior = {}; queryResult = {empty: true, docs: []};
};

async function capture(fn) {
  const real = {log: console.log, warn: console.warn, error: console.error};
  const lines = [];
  for (const k of Object.keys(real)) console[k] = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let value; let thrown = null;
  try { value = await fn(); } catch (e) { thrown = e; } finally { Object.assign(console, real); }
  return {lines, value, thrown, text: lines.join('\n')};
}
/** يتحقّق أن سطراً واحداً على الأقلّ يحمل `marker` ويحمل التشخيص `diag`، وأن لا شيء مما التقط يحمل السرّ. */
function checkLine(cap, marker, diag, label) {
  const line = cap.lines.find((l) => l.includes(marker));
  ok(!!line, `[${label}] السطر المقصود طُبع فعلاً (الاختبار يمرّ بالموضع): ${marker}`);
  ok(line && line.includes(diag), `[${label}] التشخيص ${diag} باقٍ في السطر`);
  // كل نصّ معادٍ هنا يحمل العنوان قبل حدّ القصّ؛ فالقناع حاضر في السطر لا غياب العنوان وحده (القاعدة 22: الغياب لا يُقرأ نجاحاً).
  ok(line && line.includes('<email>'), `[${label}] القناع <email> حاضر في السطر (العنوان وُجد وأُخفي)`);
  ok(isClean(cap.text), `[${label}] لا سرّ ولا معرّف خامّ في أيّ سطر التُقط`);
}

(async () => {
  const run = (fnExport, request) => fnExport.run(request);

  // ═══ rejectPayment / confirmPayment: بريد ثم FCM ═══
  {
    const {rejectPayment} = require('../src/payments/rejectPayment');
    const {confirmPayment} = require('../src/payments/confirmPayment');
    for (const [name, fn, extra] of [['rejectPayment', rejectPayment, {reason: 'r'}], ['confirmPayment', confirmPayment, {}]]) {
      resetState();
      store['payments/p1'] = {status: 'pending', userId: 'u1', plan: 'shop_basic', scansGranted: 3};
      store['users/u1'] = {email: 'u1@example.invalid', fcmToken: 'tok', language: 'ar', name: 'N'};
      mailThrow = mkErr(`Invalid login: ${hostile('MAIL')}`, {code: 'EAUTH'});
      fcmThrow = mkErr(hostile('FCM'), {code: 'messaging/invalid-argument'});
      const cap = await capture(() => run(fn, {auth: {uid: 'a', token: {}}, data: {paymentId: 'p1', ...extra}}));
      ok(!cap.thrown, `[${name}] فشل البريد وFCM لا يُفشلان العملية (السلوك لم يتغيّر): ${cap.thrown && cap.thrown.message}`);
      checkLine(cap, name === 'rejectPayment' ? 'Failed to send rejection email:' : 'Failed to send confirmation email:', 'MAIL-DIAG', `${name} بريد`);
      checkLine(cap, 'Failed to send FCM push:', 'FCM-DIAG', `${name} FCM`);
      ok(cap.lines.some((l) => l.includes('code=EAUTH')) && cap.lines.some((l) => l.includes('code=messaging/invalid-argument')), `[${name}] رمز الخطأ باقٍ (تشخيص) لا مُخفى`);
    }
  }

  // ═══ redeemPromoCode ═══
  {
    const {redeemPromoCode} = require('../src/users/redeemPromoCode');
    resetState();
    store['promoCodes/c1'] = {isActive: true, usedCount: 0, maxUses: 5, usedBy: [], durationDays: 30, plan: 'shop_basic', scans: 3, code: 'X'};
    store['users/u1'] = {email: 'u1@example.invalid', fcmToken: 'tok', language: 'ar', name: 'N'};
    queryResult = {empty: false, docs: [{ref: refOf('promoCodes', 'c1')}]};
    mailThrow = mkErr(`Invalid login: ${hostile('PMAIL')}`);
    fcmThrow = mkErr(hostile('PFCM'));
    const cap = await capture(() => run(redeemPromoCode, {auth: {uid: 'u1', token: {firebase: {sign_in_provider: 'google.com'}}}, data: {code: 'x'}}));
    ok(!cap.thrown, `[redeemPromoCode] لا يُفشَل الاسترداد بفشل البريد/FCM: ${cap.thrown && cap.thrown.message}`);
    checkLine(cap, 'Failed to send promo email:', 'PMAIL-DIAG', 'redeemPromoCode بريد');
    checkLine(cap, 'Failed to send FCM for promo:', 'PFCM-DIAG', 'redeemPromoCode FCM');
  }

  // ═══ registerUser: قراءة settings/app وبريد الترحيب ═══
  {
    const {registerUser} = require('../src/users/registerUser');
    resetState();
    failures['get:settings/app'] = mkErr(`7 PERMISSION_DENIED: ${hostile('SET')}`, {code: 7});
    mailThrow = mkErr(`Invalid login: ${hostile('WMAIL')}`);
    const cap = await capture(() => run(registerUser, {auth: {uid: 'u9', token: {email: 'u9@example.invalid', firebase: {sign_in_provider: 'google.com'}}}, data: {name: 'N', language: 'ar'}}));
    ok(!cap.thrown && cap.value && cap.value.success === true && cap.value.scansRemaining === 0, `[registerUser] فشل قراءة الإعداد يسقط إلى 0 كما كان: ${cap.thrown && cap.thrown.message}`);
    checkLine(cap, 'Failed to read settings/app, defaulting to 0:', 'SET-DIAG', 'registerUser الإعداد');
    checkLine(cap, 'Failed to send welcome email:', 'WMAIL-DIAG', 'registerUser الترحيب');
  }

  // ═══ sendNotificationEmail: FCM عند منح اشتراك ═══
  {
    const {sendNotificationEmail} = require('../src/notifications/sendNotificationEmail');
    resetState();
    store['users/u1'] = {email: 'u1@example.invalid', fcmToken: 'tok', language: 'ar', name: 'N', scansRemaining: 2, plan: 'shop_basic'};
    fcmThrow = mkErr(hostile('GFCM'));
    mailThrow = null;
    const cap = await capture(() => run(sendNotificationEmail, {auth: {uid: 'a', token: {}}, data: {userId: 'u1', templateName: 'grantSubscription', extraData: {scans: 3, plan: 'shop_basic'}}}));
    ok(!cap.thrown && cap.value && cap.value.success === true, `[sendNotificationEmail] فشل FCM لا يُفشل المنح: ${cap.thrown && cap.thrown.message}`);
    checkLine(cap, 'Failed to send FCM push for grant:', 'GFCM-DIAG', 'sendNotificationEmail FCM');

    // البند ٤-د (2026-10-18): فشل sendMail نفسه كان يصعد بلا التقاط، فتطبعه المنصّة (Unhandled error) بنصّ المزوّد كاملاً وفيه عنوان المستلم. صار يُلتقط ويُنقّى ويُرمى منه ما كان يصل العميل (internal/INTERNAL) لا غير.
    resetState();
    store['users/u1'] = {email: 'u1@example.invalid', fcmToken: 'tok', language: 'ar', name: 'N', scansRemaining: 2, plan: 'shop_basic'};
    mailThrow = mkErr(`Can't send mail - all recipients were rejected: ${hostile('SMAIL')}`, {code: 'EENVELOPE'});
    const capM = await capture(() => run(sendNotificationEmail, {auth: {uid: 'a', token: {}}, data: {userId: 'u1', templateName: 'grantSubscription', extraData: {scans: 3, plan: 'shop_basic'}}}));
    ok(capM.thrown && capM.thrown.code === 'internal' && capM.thrown.message === 'INTERNAL', `[sendNotificationEmail] فشل البريد يُرمى منه internal/INTERNAL — ما كانت المنصّة تُرجعه للعميل (السلوك لا يتغيّر): ${capM.thrown && capM.thrown.code}`);
    ok(capM.thrown && isClean(capM.thrown.message), '[sendNotificationEmail] وما يُرمى لا يحمل نصّ المزوّد');
    checkLine(capM, 'Failed to send notification email:', 'SMAIL-DIAG', 'sendNotificationEmail البريد');
    ok(capM.lines.some((l) => l.includes('code=EENVELOPE')), '[sendNotificationEmail] رمز الخطأ باقٍ في السطر (تشخيص)');  }

  // ═══ generateReportPdf: الثلاثة مواضع، والرسالة تصل العميل ═══
  {
    const {generateReportPdf} = require('../src/reports/generateReportPdf');
    const req = {auth: {uid: 'u1', token: {}}, data: {scanId: SCAN}};
    const seed = () => { resetState(); store[`reports/${SCAN}`] = {userId: 'u1', isFreeTrial: false, shortId: 'NC-AAAAAA', language: 'ar'}; };

    seed();
    launchBehavior = async () => { throw mkErr(`Failed to launch the browser: ${hostile('PDF')}`); };
    const cap = await capture(() => run(generateReportPdf, req));
    ok(cap.thrown && cap.thrown.code === 'internal' && cap.thrown.message.startsWith('فشل توليد PDF: '), '[generateReportPdf-توليد] يرمي internal بالصيغة نفسها (السلوك لم يتغيّر)');
    ok(isClean(cap.thrown.message) && cap.thrown.message.includes('PDF-DIAG'), '[generateReportPdf-توليد] **الرسالة التي تصل العميل** نظيفة وتحمل التشخيص');
    checkLine(cap, 'PDF generation failed:', 'PDF-DIAG', 'generateReportPdf توليد');
    // البند ٤-ج (2026-10-18): shortId في مسار رابط الطباعة مفتاح وصول علني — السطر يطبع الأساس واللغة وهاش shortId لا قيمته.
    const launchLine = cap.lines.find((l) => l.startsWith('[generateReportPdf] launching headless Chrome for '));
    ok(!!launchLine && !cap.text.includes('NC-AAAAAA') && /\/print\/#[0-9a-f]{12}\/\?lang=ar$/.test(launchLine), `[generateReportPdf] سطر الإطلاق يحمل هاش shortId لا قيمته: ${launchLine}`);

    seed();
    launchBehavior = async () => ({newPage: async () => ({setViewport: async () => {}, goto: async () => {}, waitForSelector: async () => {}, pdf: async () => Buffer.from('%PDF')}), close: async () => {}});
    storageBehavior = {save: mkErr(`Anonymous caller does not have storage.objects.create access to the Google Cloud Storage object reports/${SCAN}/report.pdf ${hostile('SAVE')}`, {code: 403})};
    const cap2 = await capture(() => run(generateReportPdf, req));
    ok(cap2.thrown && cap2.thrown.message.startsWith('فشل حفظ PDF: ') && isClean(cap2.thrown.message) && cap2.thrown.message.includes('SAVE-DIAG') && cap2.thrown.message.includes('code=403'), '[generateReportPdf-حفظ] الرسالة التي تصل العميل نظيفة وتحمل التشخيص والرمز 403');
    checkLine(cap2, 'Storage upload failed:', 'SAVE-DIAG', 'generateReportPdf حفظ');

    seed();
    storageBehavior = {sign: mkErr(`Permission iam.serviceAccounts.signBlob denied ${hostile('SIGN')}`)};
    const cap3 = await capture(() => run(generateReportPdf, req));
    ok(cap3.thrown && cap3.thrown.message.startsWith('فشل توليد الرابط: ') && cap3.thrown.message.includes('roles/iam.serviceAccountTokenCreator') && isClean(cap3.thrown.message) && cap3.thrown.message.includes('SIGN-DIAG'), '[generateReportPdf-رابط] الرسالة التي تصل العميل نظيفة، والإرشاد باقٍ، والتشخيص باقٍ');
    checkLine(cap3, 'Failed to sign URL:', 'SIGN-DIAG', 'generateReportPdf رابط');
  }

  // ═══ verifyReport (HTTP عام بلا مصادقة) ═══
  {
    const {verifyReport} = require('../src/reports/verifyReport');
    resetState();
    failures['collection:reports'] = mkErr(`14 UNAVAILABLE: ${hostile('VER')}`, {code: 14});
    let status = null; let body = null;
    const res = {
      status(s) { status = s; return this; }, json(b) { body = b; return this; }, send(b) { body = b; return this; },
      set() { return this; }, setHeader() {}, getHeader() { return undefined; }, removeHeader() {}, on() { return this; }, once() { return this; }, emit() {}, end() {}, headersSent: false,
    };
    const req = {method: 'GET', query: {scanId: SCAN}, headers: {}, ip: '203.0.113.9', get: () => ''};
    const cap = await capture(() => verifyReport(req, res));
    ok(!cap.thrown && status === 500 && body && body.error === 'server_error' && typeof body.errorId === 'string', `[verifyReport] يردّ 500 server_error بمعرّف ارتباط فقط (السلوك لم يتغيّر): status=${status} ${cap.thrown && cap.thrown.message}`);
    ok(!JSON.stringify(body).includes('VER-DIAG'), '[verifyReport] جسم الردّ العامّ لا يحمل نصّ الخطأ');
    // السطر `verifyReport — input:` كان يطبع scanId المُدخَل خامّاً (قيد معروف قبل 2026-10-18) فاستُثني هنا؛ هُشِّر في البند ٤-ب فصار الفحص على كل الأسطر بلا استثناء (حارسه المخصَّص test/verifyReportLogRedaction.test.js).
    checkLine(cap, 'verifyReport failed [', 'VER-DIAG', 'verifyReport');
    ok(cap.lines.some((l) => /\n\s+at /.test(l) || l.includes('    at ')), '[verifyReport] إطارات المكدّس باقية في السجلّ (تشخيص) بلا سطر الرسالة الخام');
  }

  // ═══ resolvePendingEvaluation ═══
  {
    const {resolvePendingEvaluation} = require('../src/evaluations/resolvePendingEvaluation');
    resetState();
    failures.runTransaction = mkErr(`6 ALREADY_EXISTS: entity already exists: EntityRef[partitionRef=dev~demo-nc, path=/evaluations/${SCAN}] ${hostile('EVAL')}`, {code: 6});
    const cap = await capture(() => resolvePendingEvaluation.run({params: {scanId: SCAN}, data: {data: () => ({userId: 'u1'})}}));
    ok(!cap.thrown, `[resolvePendingEvaluation] غير قاتل (السلوك لم يتغيّر): ${cap.thrown && cap.thrown.message}`);
    checkLine(cap, '[resolvePendingEvaluation] failed for', 'EVAL-DIAG', 'resolvePendingEvaluation');
  }

  // ═══ ملفّات الملفّ الشخصي للجهاز ═══
  {
    const {findDeviceProfile} = require('../src/profiles/findDeviceProfile');
    resetState();
    const key = {primary: 'p'.repeat(64), layerA_keystore: 'ka'.repeat(8), layerB_firebaseId: 'fb'.repeat(8), layerC_androidId: 'ac'.repeat(8), layerD_buildSig: 'bd', layerE_sensorSig: 'se'};
    // الأول: primary يفشل ثم A وB وC تفشل (استعلامات) ثم D+E
    failures['collection:deviceProfiles'] = mkErr(`14 UNAVAILABLE: ${hostile('FDP')}`, {code: 14});
    const cap = await capture(() => findDeviceProfile(key));
    ok(!cap.thrown && cap.value === null, `[findDeviceProfile] كل البحوث تفشل ⟵ null بلا رمي (السلوك لم يتغيّر): ${cap.thrown && cap.thrown.message}`);
    checkLine(cap, '[ProfileLookup] Primary lookup failed:', 'FDP-DIAG', 'findDeviceProfile primary');
    checkLine(cap, '[ProfileLookup] layerA_keystore lookup failed:', 'FDP-DIAG', 'findDeviceProfile مرحلة');
    ok(cap.lines.some((l) => l.includes('[ProfileLookup] layerD+E lookup failed:')), '[findDeviceProfile] سطر layerD+E طُبع (الموضع الثالث مُنفَّذ فعلاً)');
  }
  {
    const {createDeviceProfile} = require('../src/profiles/createDeviceProfile');
    resetState();
    failures['collection:deviceProfiles'] = mkErr(`3 INVALID_ARGUMENT: ${hostile('CDP')}`, {code: 3});
    const key = {primary: 'q'.repeat(64)};
    const cap = await capture(() => createDeviceProfile(key, SCAN, {pipeline: 'x'}, {deviceModel: 'M'}, null));
    ok(cap.thrown && cap.thrown.message.includes('CDP-DIAG') && cap.thrown.message.includes(SCAN), '[createDeviceProfile] الخطأ المُعاد رميه كما هو (السلوك لم يتغيّر: المستدعي يتلقّى الأصلي)');
    checkLine({...cap, text: cap.text}, '[ProfileCreate] Failed to create profile', 'CDP-DIAG', 'createDeviceProfile');
  }
  {
    const {appendScanToHistory} = require('../src/profiles/appendScanToHistory');
    resetState();
    failures.runTransaction = mkErr(`5 NOT_FOUND: no entity to update: app: "dev~demo-nc"\npath <\n  Element {\n    type: "deviceProfiles"\n    name: "${SCAN}"\n  }\n> ${hostile('APP')}`, {code: 5});
    const cap = await capture(() => appendScanToHistory('prof1', SCAN, {pipeline: 'x'}, null));
    ok(cap.thrown && cap.thrown.message.includes('APP-DIAG'), '[appendScanToHistory] الخطأ يُعاد رميه كما هو (السلوك لم يتغيّر)');
    const line = cap.lines.find((l) => l.includes('[ProfileAppend] Failed for profile'));
    ok(line && line.includes('APP-DIAG') && !line.includes(SCAN) && !line.includes(KEYPHRASE) && !line.includes(LONG), '[appendScanToHistory] السطر نظيف: scanId (معروف) والمفتاح والرمز مخفيّة، والتشخيص باقٍ');
  }

  // ═══ ثلاثة قارئات إعداد ═══
  {
    for (const [file, exportName, marker] of [
      ['../src/utils/resolveAiConfig', 'resolveAiConfig', '[aiConfig] read failed'],
      ['../src/utils/resolveGeminiFallbackConfig', 'resolveGeminiFallbackConfig', '[geminiFallbackConfig] read failed'],
      ['../src/utils/resolveCacheConfig', 'resolveCacheConfig', '[cacheConfig] read failed'],
    ]) {
      resetState();
      failures['collection:settings'] = mkErr(`7 PERMISSION_DENIED: ${hostile('CFG')}`, {code: 7});
      const mod = require(file);
      const cap = await capture(() => mod[exportName]());
      ok(!cap.thrown && cap.value && /default_read_error/.test(cap.value.source), `[${exportName}] فشل القراءة يسقط إلى الافتراضي بمصدر default_read_error (السلوك لم يتغيّر)`);
      checkLine(cap, marker, 'CFG-DIAG', exportName);
    }
  }

  // ═══ createScanSession.wrapUnexpectedCreateSessionError (دالّة خالصة) ═══
  {
    const {wrapUnexpectedCreateSessionError, CREATE_SESSION_INTERNAL_ERROR_MESSAGE} = require('../src/sessions/createScanSession');
    const {sanitizedForLog, httpsError} = wrapUnexpectedCreateSessionError(mkErr(`5 NOT_FOUND: ${hostile('CSS')}`, {code: 5}));
    ok(isClean(sanitizedForLog) && sanitizedForLog.includes('CSS-DIAG'), '[createScanSession] سجلّ الخطأ غير المتوقَّع نظيف من المسار والمعرّف والرمز الطويل (كان يُنقّي المفاتيح وحدها)');
    ok(!sanitizedForLog.includes('reports/' + SCAN), '[createScanSession] مسار المستند ومعرّفه لا يعودان إلى السجلّ');
    eq(httpsError.message, CREATE_SESSION_INTERNAL_ERROR_MESSAGE, '[createScanSession] ما يصل العميل ثابت كما كان');
  }

  console.log(`failureTextSitesHandlers.test.js: ${n}/${n} assertions passed (all stubbed, no network, no emulator)`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
