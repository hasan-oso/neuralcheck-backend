'use strict';

// scanRefusalGuard.test.js — أسباب رفض الفحص ونصوصها وسطرها والحكم الواحد (S-SUB، 2026-10-16 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية على المعالج في scanReservation.e2e.test.js
// (analyzeDevice الحقيقية) وscanVerdictParity.e2e.test.js (ردّ checkSubscription مقابل البوّابة).
//
// قرارات المستخدم (بنصّها، منقولة من أمر المنسّق، غير متحقَّقة من هذا المستودع — القاعدة 29): «سطر سجلّ بسبب مسمّى لرفض analyzeDevice المبكّر (NO_CREDIT / SUBSCRIPTION_EXPIRED /
// FREE_DEVICE_USED)» (2026-10-14)؛ «scanRefusal.js بسطر الرفض المسمّى» (2026-10-15).
//
//   ١ الأسباب مجمَّدة وقيمتها اسمها؛ **النصوص العربية الثلاثة مثبَّتة حرفياً هنا** (الحرفية الوحيدة المقصودة في الاختبارات: هي ما يراه 1.0.12–1.0.14 على السلك، ويفشل الاختبار إن تغيّر حرف)،
//   ٢ refuseScan: لكل (سبب × جلسة/شخصي × مرحلة): الرمز والنصّ وdetails والسطر المسمّى بـscanId مُهشَّراً؛ ومُدخل خاطئ خطأ برمجي بلا سطر،
//   ٣ scanGateVerdict وcheckSubscriptionVerdict: مصفوفة حالات (القاعدة 30: كل القيم لا واحدة)، والترتيب الرصيد فالانتهاء فالجهاز، وحكم checkSubscription = البوّابة بلا جهاز،
//   ٤ reserveScanCredit: isSessionScan صريح، والرفض داخل المعاملة يمرّ بـrefuseScan بمرحلة reservation،
//   ٥ حارس بنيوي على functions/src كلها (القاعدة 24): لا نسخة حرفية للنصوص ولا لأسماء الأسباب خارج scanRefusal.js، ولا رمي لها خارجه (موضع الرمي الوحيد refuseScan)، ولا شرط بوّابة مكرَّر في
//     analyzeDevice/scanReservation — مع طفرات في الذاكرة تُثبت أن الحارس يميّز (القاعدة 39).
//
// Run: node functions/test/scanRefusalGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const R = require('../src/analysis/scanRefusal');
const {reserveScanCredit} = require('../src/analysis/scanReservation');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {HttpsError} = require('firebase-functions/v2/https');

(async () => {
  // ═══ ١ — الأسباب والنصوص ═══
  ok(Object.isFrozen(R.SCAN_REFUSAL) && Object.isFrozen(R.SCAN_REFUSAL_TEXT) && Object.isFrozen(R.SCAN_REFUSAL_STAGE) && Object.isFrozen(R.CHECK_SUBSCRIPTION_VERDICT), '[١] المجموعات مجمَّدة');
  for (const [k, v] of Object.entries(R.SCAN_REFUSAL)) eq(v, k, `[١] قيمة ${k} = اسمها (ما يُكتب في السجلّ وdetails هو ما يُبحث به)`);
  deq(Object.keys(R.SCAN_REFUSAL).sort(), ['FREE_DEVICE_USED', 'NO_CREDIT', 'SHOP_NO_CREDIT', 'SHOP_SUBSCRIPTION_EXPIRED', 'SUBSCRIPTION_EXPIRED'], '[١] خمسة أسباب: الثلاثة وSHOP_NO_CREDIT وSHOP_SUBSCRIPTION_EXPIRED (بلا SHOP_FREE_DEVICE_USED عمداً)');
  deq({...R.SCAN_REFUSAL_STAGE}, {EARLY: 'early', RESERVATION: 'reservation'}, '[١] مرحلتا السجلّ');
  // الحرفية المثبَّتة لأجهزة 1.0.12–1.0.14: النصوص كما كانت في analyzeDevice.js وscanReservation.js عند c17a053 (تغيير حرف = كسر لما يعرضه الهاتف)
  const WIRE = {
    NO_CREDIT: 'لا يوجد رصيد فحوصات. يرجى شراء اشتراك.',
    SUBSCRIPTION_EXPIRED: 'انتهى اشتراكك، يرجى التجديد',
    FREE_DEVICE_USED: 'تم استخدام الفحص المجاني لهذا الجهاز سابقاً',
  };
  deq({...R.SCAN_REFUSAL_TEXT}, {
    NO_CREDIT: WIRE.NO_CREDIT, SUBSCRIPTION_EXPIRED: WIRE.SUBSCRIPTION_EXPIRED, FREE_DEVICE_USED: WIRE.FREE_DEVICE_USED,
    SHOP_NO_CREDIT: WIRE.NO_CREDIT, SHOP_SUBSCRIPTION_EXPIRED: WIRE.SUBSCRIPTION_EXPIRED,
  }, '[١] النصوص العربية على السلك حرفياً كما كانت — ولا نصّ جديد: نسختا SHOP_* هما النصّ القائم نفسه');
  ok(WIRE.SUBSCRIPTION_EXPIRED.includes('،') && !WIRE.SUBSCRIPTION_EXPIRED.includes(','), '[١] وفاصلة «انتهى اشتراكك، يرجى التجديد» هي العربية U+060C');
  eq(R.SCAN_REFUSAL_CODE, 'permission-denied', '[١] الرمز الظاهر permission-denied (غيره يصير «خطأ غير متوقع» عند التطبيق)');
  eq(new Set(Object.values(R.SCAN_REFUSAL_TEXT)).size, 3, '[١] ثلاثة نصوص مختلفة فقط (لا نصّ خامس)');
  ok(!/[a-zA-Z]/.test(Object.values(R.SCAN_REFUSAL_TEXT).join('')), '[١] ولا حرف لاتيني: لا نصّ تركي ولا إنجليزي على الخادم (نصوص المحلّ تأتي مع أمر التطبيق)');
  eq(R.CHECK_SUBSCRIPTION_VERDICT_FIELD, 'scanVerdict', '[١] اسم حقل الحكم في ردّ checkSubscription (مقترح الوكيل [م]، مسجَّل في docs/PROTOCOL_CONTRACT.md §١٠)');
  deq({...R.CHECK_SUBSCRIPTION_VERDICT}, {ALLOWED: 'ALLOWED', NO_CREDIT: 'NO_CREDIT', SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED'}, '[١] القائمة المغلقة لقيم الحكم: يُسمح، أو NO_CREDIT، أو SUBSCRIPTION_EXPIRED (FREE_DEVICE_USED غائب عمداً: لا جهاز في النداء)');
  for (const reason of ['NO_CREDIT', 'SUBSCRIPTION_EXPIRED']) eq(R.CHECK_SUBSCRIPTION_VERDICT[reason], R.SCAN_REFUSAL[reason], `[١] قيمة الحكم ${reason} هي سبب SCAN_REFUSAL نفسه (مصدر واحد)`);

  // ═══ ٢ — refuseScan ═══
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  const attempt = (fn) => { try { fn(); } catch (e) { return e; } return null; };
  const SCAN = 'scan-secret-raw-id-0001';
  try {
    for (const reason of ['NO_CREDIT', 'SUBSCRIPTION_EXPIRED', 'FREE_DEVICE_USED']) {
      for (const isSessionScan of [false, true]) {
        for (const stage of ['early', 'reservation']) {
          warns.length = 0;
          const err = attempt(() => R.refuseScan(reason, {stage, isSessionScan, scanId: SCAN}));
          const wire = (isSessionScan && reason === 'NO_CREDIT') ? 'SHOP_NO_CREDIT' : (isSessionScan && reason === 'SUBSCRIPTION_EXPIRED') ? 'SHOP_SUBSCRIPTION_EXPIRED' : reason;
          const label = `${reason} session=${isSessionScan} stage=${stage}`;
          ok(err instanceof HttpsError, `[٢] ${label}: يرمي HttpsError`);
          eq(err.code, 'permission-denied', `[٢] ${label}: الرمز`);
          eq(err.message, WIRE[reason], `[٢] ${label}: النصّ العربي القائم حرفياً (حتى في نسخة SHOP_)`);
          deq(err.details, {reasonCode: wire}, `[٢] ${label}: details = {reasonCode: ${wire}} وحده`);
          eq(warns.length, 1, `[٢] ${label}: سطر واحد`);
          eq(warns[0], `[analyzeDevice] refused reason=${wire} stage=${stage} scanId=${hashIdForLog(SCAN)} session=${isSessionScan ? 'yes' : 'no'}`, `[٢] ${label}: السطر المسمّى كاملاً`);
          ok(!warns[0].includes(SCAN) && /scanId=#[0-9a-f]{12} /.test(warns[0]), `[٢] ${label}: scanId مُهشَّر (# + 12 سداسياً) لا خامّ`);
        }
      }
    }
    // غياب scanId حالة صريحة لا قيمة افتراضية (القاعدة 22)
    warns.length = 0;
    attempt(() => R.refuseScan('NO_CREDIT', {stage: 'early', isSessionScan: false, scanId: null}));
    attempt(() => R.refuseScan('NO_CREDIT', {stage: 'early', isSessionScan: false, scanId: ''}));
    attempt(() => R.refuseScan('NO_CREDIT', {stage: 'early', isSessionScan: false, scanId: 12345}));
    deq(warns.map((w) => w.match(/scanId=(\S+)/)[1]), ['missing', 'missing', 'invalid-type'], '[٢] scanId غائب ⟵ missing، وغير نصّي ⟵ invalid-type (لا تهشير للفراغ)');

    // مُدخل خاطئ: خطأ برمجي صريح (بلا code) ولا سطر يُكتب بقيمة مختلَقة
    warns.length = 0;
    const base = {stage: 'early', isSessionScan: false, scanId: SCAN};
    const bads = [
      ['سبب مختلَق', () => R.refuseScan('MADE_UP', base), /غير مُدرَج/],
      ['سبب غائب', () => R.refuseScan(undefined, base), /غير مُدرَج/],
      ['SHOP_NO_CREDIT يُمرَّر مباشرةً (النسخة تُختار داخلاً)', () => R.refuseScan('SHOP_NO_CREDIT', base), /ليس أساسياً/],
      ['SHOP_SUBSCRIPTION_EXPIRED يُمرَّر مباشرةً', () => R.refuseScan('SHOP_SUBSCRIPTION_EXPIRED', base), /ليس أساسياً/],
      ['مرحلة مختلَقة', () => R.refuseScan('NO_CREDIT', {...base, stage: 'late'}), /مرحلة رفض/],
      ['مرحلة غائبة', () => R.refuseScan('NO_CREDIT', {isSessionScan: false, scanId: SCAN}), /مرحلة رفض/],
      ['isSessionScan غائب', () => R.refuseScan('NO_CREDIT', {stage: 'early', scanId: SCAN}), /isSessionScan/],
      ['isSessionScan نصّ', () => R.refuseScan('NO_CREDIT', {...base, isSessionScan: 'yes'}), /isSessionScan/],
      ['isSessionScan رقم', () => R.refuseScan('NO_CREDIT', {...base, isSessionScan: 1}), /isSessionScan/],
      ['isSessionScan null', () => R.refuseScan('NO_CREDIT', {...base, isSessionScan: null}), /isSessionScan/],
      ['بلا وسيط ثانٍ', () => R.refuseScan('NO_CREDIT'), /مرحلة رفض/],
    ];
    for (const [label, fn, re] of bads) {
      const err = attempt(fn);
      ok(err instanceof Error && !(err instanceof HttpsError) && !err.code && re.test(err.message), `[٢] ${label}: خطأ برمجي صريح (لا HttpsError) — ${err && err.message}`);
    }
    eq(warns.length, 0, '[٢] ولا سطر سجلّ لأيّ مُدخل خاطئ');

    // scanRefusalWire: الأسباب الخمسة، وغير المُدرَج يُرمى
    for (const reason of Object.keys(R.SCAN_REFUSAL)) deq(R.scanRefusalWire(reason), {code: 'permission-denied', message: R.SCAN_REFUSAL_TEXT[reason], reasonCode: reason}, `[٢] scanRefusalWire(${reason})`);
    ok(attempt(() => R.scanRefusalWire('MADE_UP')) instanceof Error && /غير مُدرَج/.test(attempt(() => R.scanRefusalWire('MADE_UP')).message), '[٢] scanRefusalWire ترفض سبباً غير مُدرَج');
    eq(warns.length, 0, '[٢] وscanRefusalWire لا تكتب سطراً (السطر لصاحب الرمي)');
  } finally {
    console.warn = realWarn;
  }

  // ═══ ٣ — الحكم: scanGateVerdict وcheckSubscriptionVerdict ═══
  const NOW = new Date('2026-10-16T09:00:00Z');
  const nowMs = NOW.getTime();
  const tsOf = (ms) => ({toDate: () => new Date(ms), toMillis: () => ms});
  const PAST = nowMs - 24 * 3600 * 1000;
  const FUTURE = nowMs + 24 * 3600 * 1000;
  const USED = 'USEDDEV_14_8';
  const FRESH = 'FRESHDEV_14_8';
  const SHOP = (extra) => ({scansRemaining: 5, plan: 'shop_pro', ...extra});
  // [وصف، مستند المستخدم، جهاز الحكم الكامل، المتوقَّع من البوّابة الكاملة]
  const MATRIX = [
    ['مستند غائب (null) ⟵ رصيد 0', null, FRESH, 'NO_CREDIT'],
    ['مستند فارغ', {}, FRESH, 'NO_CREDIT'],
    ['رصيد 0', {scansRemaining: 0}, FRESH, 'NO_CREDIT'],
    ['رصيد سالب', {scansRemaining: -2}, FRESH, 'NO_CREDIT'],
    ['رصيد كسري 0.5 (الأشدّ: >= 1)', {scansRemaining: 0.5}, FRESH, 'NO_CREDIT'],
    ['رصيد NaN', {scansRemaining: NaN}, FRESH, 'NO_CREDIT'],
    ['رصيد نصّ "0"', {scansRemaining: '0'}, FRESH, 'NO_CREDIT'],
    ['رصيد 1 بلا expiresAt ولا plan', {scansRemaining: 1}, FRESH, null],
    ['رصيد 5 وexpiresAt مستقبلي (Timestamp)', SHOP({expiresAt: tsOf(FUTURE)}), FRESH, null],
    ['رصيد 5 وexpiresAt ماضٍ (Timestamp)', SHOP({expiresAt: tsOf(PAST)}), FRESH, 'SUBSCRIPTION_EXPIRED'],
    ['expiresAt ماضٍ (Date)', SHOP({expiresAt: new Date(PAST)}), FRESH, 'SUBSCRIPTION_EXPIRED'],
    ['expiresAt ماضٍ (نصّ ISO)', SHOP({expiresAt: new Date(PAST).toISOString()}), FRESH, 'SUBSCRIPTION_EXPIRED'],
    ['expiresAt ماضٍ (رقم ms)', SHOP({expiresAt: PAST}), FRESH, 'SUBSCRIPTION_EXPIRED'],
    ['expiresAt == الآن تماماً ⟵ لا انتهاء (المقارنة صارمة <)', SHOP({expiresAt: tsOf(nowMs)}), FRESH, null],
    ['expiresAt بعد الآن بميلّي ثانية ⟵ لا انتهاء', SHOP({expiresAt: tsOf(nowMs + 1)}), FRESH, null],
    ['expiresAt قبل الآن بميلّي ثانية ⟵ منتهٍ', SHOP({expiresAt: tsOf(nowMs - 1)}), FRESH, 'SUBSCRIPTION_EXPIRED'],
    ['expiresAt غائب ⟵ لا انتهاء (أمان للقدامى)', SHOP({}), FRESH, null],
    ['expiresAt null ⟵ لا انتهاء', SHOP({expiresAt: null}), FRESH, null],
    ['expiresAt نصّ غير قابل للتحويل ⟵ لا انتهاء', SHOP({expiresAt: 'not-a-date'}), FRESH, null],
    ['الرصيد قبل التاريخ: رصيد 0 ومنتهٍ ⟵ NO_CREDIT', {scansRemaining: 0, expiresAt: tsOf(PAST)}, FRESH, 'NO_CREDIT'],
    ['التاريخ قبل الجهاز: free بجهاز مستعمَل ومنتهٍ ⟵ SUBSCRIPTION_EXPIRED', {scansRemaining: 3, plan: 'free', expiresAt: tsOf(PAST), freeTrialUsedDevices: [USED]}, USED, 'SUBSCRIPTION_EXPIRED'],
    ['الرصيد قبل الجهاز: free بجهاز مستعمَل ورصيد 0 ⟵ NO_CREDIT', {scansRemaining: 0, plan: 'free', freeTrialUsedDevices: [USED]}, USED, 'NO_CREDIT'],
    ['free (صريحة) وجهاز مستعمَل ⟵ FREE_DEVICE_USED', {scansRemaining: 3, plan: 'free', freeTrialUsedDevices: [USED]}, USED, 'FREE_DEVICE_USED'],
    ['plan غائبة (= free) وجهاز مستعمَل ⟵ FREE_DEVICE_USED', {scansRemaining: 3, freeTrialUsedDevices: [USED]}, USED, 'FREE_DEVICE_USED'],
    ['free وجهاز آخر في القائمة ⟵ يُسمح', {scansRemaining: 3, plan: 'free', freeTrialUsedDevices: [USED]}, FRESH, null],
    ['free وfreeTrialUsedDevices غائبة ⟵ يُسمح', {scansRemaining: 3, plan: 'free'}, USED, null],
    ['shop_basic وجهازه في القائمة ⟵ يُسمح (الفحص المجاني لباقة free وحدها)', {scansRemaining: 3, plan: 'shop_basic', freeTrialUsedDevices: [USED]}, USED, null],
    ['shop_pro وجهازه في القائمة ⟵ يُسمح', SHOP({freeTrialUsedDevices: [USED]}), USED, null],
    ['isActive=false لا يغيّر الحكم (البوّابة لا تقرؤه)', SHOP({isActive: false}), FRESH, null],
  ];
  const seenVerdicts = new Set();
  for (const [label, user, device, want] of MATRIX) {
    eq(R.scanGateVerdict(user, {deviceFP: device, now: NOW}), want, `[٣] scanGateVerdict — ${label}`);
    // حكم checkSubscription = البوّابة بلا جهاز: جهاز لا تعرفه القائمة أبداً، فيبقى الرصيد والانتهاء وحدهما
    const withoutDevice = R.scanGateVerdict(user, {deviceFP: 'NEVER_LISTED_DEVICE_0_0', now: NOW});
    const wantCheck = withoutDevice === null ? 'ALLOWED' : withoutDevice;
    const got = R.checkSubscriptionVerdict(user, NOW);
    eq(got, wantCheck, `[٣] checkSubscriptionVerdict = البوّابة بلا جهاز — ${label}`);
    ok(Object.values(R.CHECK_SUBSCRIPTION_VERDICT).includes(got), `[٣] قيمة الحكم من القائمة المغلقة — ${label}`);
    seenVerdicts.add(got);
  }
  deq([...seenVerdicts].sort(), ['ALLOWED', 'NO_CREDIT', 'SUBSCRIPTION_EXPIRED'], '[٣] المصفوفة تمرّ بكل قيم الحكم الثلاث (القاعدة 30: لا قيمة بلا اختبار)');
  const gateRefusals = new Set(MATRIX.map((r) => r[3]).filter((v) => v !== null));
  deq([...gateRefusals].sort(), ['FREE_DEVICE_USED', 'NO_CREDIT', 'SUBSCRIPTION_EXPIRED'], '[٣] والبوّابة الكاملة تمرّ بأسبابها الثلاثة كلّها');
  // الفجوة المُعلَنة: free بجهاز مستعمَل — البوّابة FREE_DEVICE_USED وردّ checkSubscription ALLOWED (لا جهاز في النداء)
  eq(R.checkSubscriptionVerdict({scansRemaining: 3, plan: 'free', freeTrialUsedDevices: [USED]}, NOW), 'ALLOWED', '[٣] الفجوة المُعلَنة: ALLOWED في ردّ checkSubscription لا يعني ألّا ترفض analyzeDevice بـFREE_DEVICE_USED (موثَّقة في §١٠)');
  // deviceFP غائب خطأ برمجي لا «لا فحص جهاز» صامتاً
  for (const bad of [undefined, null, 5, {}]) {
    const err = attempt(() => R.scanGateVerdict({scansRemaining: 3}, {deviceFP: bad, now: NOW}));
    ok(err instanceof Error && /deviceFP/.test(err.message), `[٣] scanGateVerdict بلا deviceFP نصّ (${JSON.stringify(bad)}) ⟵ خطأ برمجي`);
  }
  ok(attempt(() => R.scanGateVerdict({scansRemaining: 3})) instanceof Error, '[٣] وبلا وسيط ثانٍ كذلك');
  // now الافتراضي هو الآن الحقيقي (Date.now): انتهاء بعد ساعة من الآن لا يُرفض
  eq(R.scanGateVerdict({scansRemaining: 3, plan: 'shop_pro', expiresAt: new Date(Date.now() + 3600 * 1000)}, {deviceFP: FRESH}), null, '[٣] now الافتراضي = الآن الحقيقي (expiresAt بعد ساعة ⟵ يُسمح)');
  eq(R.scanGateVerdict({scansRemaining: 3, plan: 'shop_pro', expiresAt: new Date(Date.now() - 3600 * 1000)}, {deviceFP: FRESH}), 'SUBSCRIPTION_EXPIRED', '[٣] وقبل ساعة ⟵ منتهٍ');
  eq(R.checkSubscriptionVerdict({scansRemaining: 3, expiresAt: new Date(Date.now() - 3600 * 1000)}), 'SUBSCRIPTION_EXPIRED', '[٣] وcheckSubscriptionVerdict بلا now: الآن الحقيقي');

  // ═══ ٤ — reserveScanCredit: isSessionScan صريح، والرفض داخل المعاملة يمرّ بـrefuseScan ═══
  {
    const missing = await reserveScanCredit({db: null, FieldValue: null, userId: 'u', deviceFP: 'D', claimRef: null, nowMs: 1}).then(() => null, (e) => e);
    ok(missing instanceof Error && !(missing instanceof HttpsError) && /isSessionScan/.test(missing.message), '[٤] reserveScanCredit بلا isSessionScan ⟵ خطأ برمجي قبل أيّ نداء قاعدة بيانات');
    for (const bad of ['yes', 1, null]) {
      const e = await reserveScanCredit({db: null, FieldValue: null, userId: 'u', deviceFP: 'D', claimRef: null, nowMs: 1, isSessionScan: bad}).then(() => null, (x) => x);
      ok(e instanceof Error && /isSessionScan/.test(e.message), `[٤] isSessionScan = ${JSON.stringify(bad)} ⟵ خطأ برمجي (لا يُستنتَج)`);
    }
    // معاملة مزيَّفة: db يقرأ المستند ومستند القفل من لقطات في الذاكرة، ولا يكتب شيئاً (الرفض يسبق أيّ كتابة)
    const mkDb = (userData) => {
      const userRef = {kind: 'user', snap: {exists: userData !== null, data: () => userData}};
      const claimRef = {kind: 'claim', id: 'claim-scan-id-77', snap: {exists: false, data: () => ({})}};
      const writes = [];
      const db = {
        collection: () => ({doc: () => userRef}),
        runTransaction: async (fn) => fn({get: async (ref) => ref.snap, update: (r, d) => writes.push(['update', d]), set: (r, d) => writes.push(['set', d])}),
      };
      return {db, claimRef, writes};
    };
    const FV = {increment: (x) => ({inc: x}), arrayUnion: (x) => ({union: x}), arrayRemove: (x) => ({remove: x})};
    const cases = [
      ['NO_CREDIT', {scansRemaining: 0, plan: 'shop_pro'}, 'NO_CREDIT', 'SHOP_NO_CREDIT'],
      ['SUBSCRIPTION_EXPIRED', {scansRemaining: 2, plan: 'shop_pro', expiresAt: new Date(Date.now() - 1000)}, 'SUBSCRIPTION_EXPIRED', 'SHOP_SUBSCRIPTION_EXPIRED'],
      ['FREE_DEVICE_USED', {scansRemaining: 2, plan: 'free', freeTrialUsedDevices: ['DEV_1']}, 'FREE_DEVICE_USED', 'FREE_DEVICE_USED'],
    ];
    for (const [label, user, personalWire, sessionWire] of cases) {
      for (const isSessionScan of [false, true]) {
        const {db, claimRef, writes} = mkDb(user);
        const seen = [];
        console.warn = (...a) => { seen.push(a.join(' ')); };
        let err;
        try { await reserveScanCredit({db, FieldValue: FV, userId: 'user-9', deviceFP: 'DEV_1', claimRef, nowMs: 5, isSessionScan}); } catch (e) { err = e; } finally { console.warn = realWarn; }
        const wire = isSessionScan ? sessionWire : personalWire;
        ok(err instanceof HttpsError && err.code === 'permission-denied' && err.message === WIRE[label], `[٤] ${label} session=${isSessionScan}: HttpsError والنصّ القائم`);
        deq(err.details, {reasonCode: wire}, `[٤] ${label} session=${isSessionScan}: details.reasonCode = ${wire}`);
        deq(seen, [`[analyzeDevice] refused reason=${wire} stage=reservation scanId=${hashIdForLog('claim-scan-id-77')} session=${isSessionScan ? 'yes' : 'no'}`], `[٤] ${label} session=${isSessionScan}: سطر stage=reservation وscanId (claimRef.id) مُهشَّراً`);
        eq(writes.length, 0, `[٤] ${label} session=${isSessionScan}: لا كتابة قبل الرفض`);
      }
    }
    // وحين يُسمح: يكتب الخصم والحجز
    const {db, claimRef, writes} = mkDb({scansRemaining: 2, plan: 'shop_pro'});
    const out = await reserveScanCredit({db, FieldValue: FV, userId: 'user-9', deviceFP: 'DEV_1', claimRef, nowMs: 5, isSessionScan: false});
    ok(out.adopted === false && out.isFreeTrial === false && writes.length === 2, '[٤] عند السماح: خصم وحجز (كتابتان) كما كان');
  }

  // ═══ ٥ — الحارس البنيوي على functions/src كلّها ═══
  const FN = path.join(__dirname, '..');
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
    }
    return out;
  };
  const rel = (p) => path.relative(FN, p).split(path.sep).join('/');
  const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
  const SOURCES = {};
  for (const f of [...walk(path.join(FN, 'src')), path.join(FN, 'index.js')]) SOURCES[rel(f)] = strip(fs.readFileSync(f, 'utf8'));
  const SELF = 'src/analysis/scanRefusal.js';
  const ANALYZE = 'src/analysis/analyzeDevice.js';
  const RESERVE = 'src/analysis/scanReservation.js';
  ok(Object.keys(SOURCES).length >= 50 && SOURCES[SELF] && SOURCES[ANALYZE] && SOURCES[RESERVE], `[٥] الحارس يرى ${Object.keys(SOURCES).length} ملفّاً ويرى الملفّات الثلاثة (فحص غير فارغ — القاعدة 22)`);

  /** الانتهاكات المسمّاة لمصادر (ملفّ ⟵ نصّ بلا تعليقات). دالّة نقيّة: الطفرات في الذاكرة تمرّ بها. */
  function violations(src) {
    const v = new Set();
    const texts = Object.values({...WIRE});
    const reasonLiteral = /["'`](NO_CREDIT|SUBSCRIPTION_EXPIRED|FREE_DEVICE_USED|SHOP_NO_CREDIT|SHOP_SUBSCRIPTION_EXPIRED)["'`]/;
    const refs = (re) => Object.keys(src).filter((f) => f !== SELF && re.test(src[f])).sort();
    for (const [f, text] of Object.entries(src)) {
      if (f === SELF) continue;
      for (const t of texts) if (text.includes(t)) v.add(`TEXT_COPY:${f}`);
      if (reasonLiteral.test(text)) v.add(`REASON_LITERAL:${f}`);
    }
    // موضع الرمي الوحيد: `throw new HttpsError(` واحد في scanRefusal.js، داخل refuseScan
    const self = src[SELF] || '';
    const throws = [...self.matchAll(/throw new HttpsError\(/g)];
    const fnStart = self.indexOf('function refuseScan(');
    const fnEnd = self.indexOf('\n}\n', fnStart);
    if (throws.length !== 1 || fnStart < 0 || !(throws[0].index > fnStart && throws[0].index < fnEnd)) v.add('THROW_SITE_NOT_SINGLE_INSIDE_refuseScan');
    if (/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter/.test(self)) v.add('DELETE_IN_scanRefusal');
    // من يستعمل refuseScan: analyzeDevice وscanReservation وحدهما
    const refusers = refs(/\brefuseScan\b/);
    if (JSON.stringify(refusers) !== JSON.stringify([ANALYZE, RESERVE].sort())) v.add(`REFUSE_SCAN_REFERRERS:${refusers.join(',')}`);
    // خريطة النصوص: createScanSession وحده (مرجع واحد لنصّ الانتهاء، كما كان حرفياً قبل S-SUB) — المالك نفسه هو المستدعي هناك
    const textRefs = refs(/\bSCAN_REFUSAL_TEXT\b/);
    if (textRefs.length !== 0) v.add(`TEXT_MAP_REFERRERS:${textRefs.join(',')}`); // A-SUB الموجة الأولى (القاعدة 23): createScanSession صارت تأخذ نصّ الانتهاء عبر scanRefusalWire فلم يبقَ قارئ لخريطة النصوص خارج scanRefusal.js
    // سلك الرفض (الرمز والنصّ والسبب) لمن يملك سطره ورميه — رفض الانضمام المبكّر لاشتراك المالك: joinScanSession وحدها (refuse الخاصّة بها: سطرها [joinScanSession] refused)
    const wireRefs = refs(/\bscanRefusalWire\(/); // نداء الدالّة لا ذكر اسمها في الاستيراد
    if (JSON.stringify(wireRefs) !== JSON.stringify(['src/sessions/createScanSession.js', 'src/sessions/joinScanSession.js'])) v.add(`WIRE_REFERRERS:${wireRefs.join(',')}`);
    // createScanSession (A-SUB الموجة الأولى، قرار المستخدم ٤): رفضاها يحملان details.reasonCode — الانتهاء عبر scanRefusalWire، والرصيد برمز SHOP_NO_CREDIT من المصدر الواحد ونصّه القائم؛ ولا HttpsError بنصّ بلا reasonCode
    const CREATE = src['src/sessions/createScanSession.js'] || '';
    if ((CREATE.match(/scanRefusalWire\(SCAN_REFUSAL\.SHOP_SUBSCRIPTION_EXPIRED\)/g) || []).length !== 1) v.add('CREATE_EXPIRED_NOT_VIA_WIRE');
    if ((CREATE.match(/\{reasonCode:\s*SCAN_REFUSAL\.SHOP_NO_CREDIT\}/g) || []).length !== 1) v.add('CREATE_NO_CREDIT_WITHOUT_REASONCODE');
    if (/new HttpsError\("permission-denied"/.test(CREATE)) v.add('CREATE_REFUSAL_WITHOUT_REASONCODE');
    // ردّ checkSubscription: الحكم من الدالّة الواحدة في موضعَي الردّ (غير المسجَّل والمسجَّل)، واسم الحقل من المصدر الواحد لا نصّاً حرفياً، وبلا شرط رصيد/انتهاء مكتوب فيه
    const CHECK = 'src/users/checkSubscription.js';
    const cs = src[CHECK] || '';
    if ((cs.match(/\bcheckSubscriptionVerdict\(/g) || []).length !== 2) v.add('CHECK_SUBSCRIPTION_VERDICT_NOT_IN_BOTH_RETURNS');
    if (!/\[CHECK_SUBSCRIPTION_VERDICT_FIELD\]\s*:/.test(cs)) v.add('CHECK_SUBSCRIPTION_FIELD_NOT_FROM_SOURCE');
    if (/\bisSubscriptionExpired\b|scansRemaining\s*(<=|>=|<|>)/.test(cs)) v.add('GATE_DUPLICATED:checkSubscription');
    for (const [f, text] of Object.entries(src)) if (f !== SELF && /["'`]scanVerdict["'`]|\bscanVerdict\s*:/.test(text)) v.add(`FIELD_NAME_LITERAL:${f}`);
    // لا شرط بوّابة مكرَّر في المبكّر ولا في المعاملة
    for (const f of [ANALYZE, RESERVE]) {
      const t = src[f] || '';
      if (/\bisSubscriptionExpired\b/.test(t)) v.add(`GATE_DUPLICATED:isSubscriptionExpired:${f}`);
      if (/scansRemaining\s*(<=|>=|<|>)/.test(t)) v.add(`GATE_DUPLICATED:balance:${f}`);
      if ((t.match(/\bscanGateVerdict\(/g) || []).length !== 1) v.add(`GATE_NOT_CALLED_ONCE:${f}`);
      if ((t.match(/\brefuseScan\(/g) || []).length !== 1) v.add(`REFUSE_NOT_CALLED_ONCE:${f}`);
      if (!/\{[^{}]*\bisSessionScan\b[^{}]*\}/.test((t.match(/\brefuseScan\([^;]*;/) || [''])[0])) v.add(`ISSESSIONSCAN_NOT_PASSED:${f}`);
    }
    if (/freeTrialUsedDevices\.includes|usedDevices\.includes/.test(src[ANALYZE] || '')) v.add('GATE_DUPLICATED:freeDevice:analyzeDevice');
    if (!/stage:\s*SCAN_REFUSAL_STAGE\.EARLY/.test(src[ANALYZE] || '')) v.add('STAGE_NOT_EARLY_IN_analyzeDevice');
    if (!/stage:\s*SCAN_REFUSAL_STAGE\.RESERVATION/.test(src[RESERVE] || '')) v.add('STAGE_NOT_RESERVATION_IN_scanReservation');
    // البوّابة المبكّرة قبل كتابة القفل: الحكم قبل scanClaims
    const a = src[ANALYZE] || '';
    const gateAt = a.indexOf('scanGateVerdict(');
    const claimAt = a.indexOf('db.collection("scanClaims")');
    if (gateAt < 0 || claimAt < 0 || !(gateAt < claimAt)) v.add('EARLY_GATE_NOT_BEFORE_CLAIM_WRITE');
    return [...v].sort();
  }
  deq(violations(SOURCES), [], '[٥] المصادر الحقيقية: لا انتهاك — النصوص وأسماء الأسباب وموضع الرمي ومصدر الحكم واحدة');

  // طفرات في الذاكرة (القاعدة 39): كل خلل مصطنع يُفشل الحارس بسببه المسمّى
  const mutant = (file, from, to) => {
    ok(SOURCES[file].includes(from), `[٥] الطفرة: النصّ المستهدَف موجود في ${file} — ${from.slice(0, 48)}`);
    return violations({...SOURCES, [file]: SOURCES[file].replace(from, to)});
  };
  const withAppended = (file, extra) => violations({...SOURCES, [file]: SOURCES[file] + '\n' + extra + '\n'});
  ok(withAppended(ANALYZE, `throw new HttpsError("permission-denied", "${WIRE.NO_CREDIT}");`).includes(`TEXT_COPY:${ANALYZE}`), '[٥] طفرة: نسخة حرفية لنصّ NO_CREDIT في analyzeDevice ⟵ يُكشَف');
  ok(withAppended(RESERVE, `const t = "${WIRE.SUBSCRIPTION_EXPIRED}";`).includes(`TEXT_COPY:${RESERVE}`), '[٥] طفرة: نسخة حرفية لنصّ الانتهاء في scanReservation ⟵ يُكشَف');
  ok(withAppended('src/sessions/joinScanSession.js', `const t = "${WIRE.FREE_DEVICE_USED}";`).includes('TEXT_COPY:src/sessions/joinScanSession.js'), '[٥] طفرة: نسخة حرفية لنصّ الجهاز المجاني في ملفّ ثالث ⟵ يُكشَف');
  ok(withAppended('src/sessions/joinScanSession.js', 'const r = "SHOP_SUBSCRIPTION_EXPIRED";').includes('REASON_LITERAL:src/sessions/joinScanSession.js'), '[٥] طفرة: اسم سبب حرفي خارج scanRefusal.js ⟵ يُكشَف (القاعدة 24)');
  ok(withAppended(ANALYZE, "const r = 'NO_CREDIT';").includes(`REASON_LITERAL:${ANALYZE}`), '[٥] طفرة: السبب بعلامة اقتباس مفردة ⟵ يُكشَف');
  ok(withAppended(SELF, 'function again() { throw new HttpsError("permission-denied", "x"); }').includes('THROW_SITE_NOT_SINGLE_INSIDE_refuseScan'), '[٥] طفرة: موضع رمي ثانٍ في scanRefusal.js ⟵ يُكشَف');
  ok(withAppended('src/sessions/cancelScanSession.js', 'refuseScan("NO_CREDIT", {});').some((x) => x.startsWith('REFUSE_SCAN_REFERRERS:')), '[٥] طفرة: ملفّ ثالث يستدعي refuseScan ⟵ يُكشَف');
  ok(withAppended('src/sessions/joinScanSession.js', 'const t = SCAN_REFUSAL_TEXT;').some((x) => x.startsWith('TEXT_MAP_REFERRERS:')), '[٥] طفرة: ملفّ ثالث يقرأ خريطة النصوص ⟵ يُكشَف');
  ok(withAppended('src/sessions/cancelScanSession.js', 'scanRefusalWire("SHOP_NO_CREDIT");').some((x) => x.startsWith('WIRE_REFERRERS:')), '[٥] طفرة: ملفّ ثالث يستدعي scanRefusalWire ⟵ يُكشَف');
  ok(mutant('src/sessions/joinScanSession.js', 'scanRefusalWire(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED)', 'null').some((x) => x.startsWith('WIRE_REFERRERS:')), '[٥] طفرة: joinScanSession تترك سلك الرفض المشترك ⟵ يُكشَف');
  ok(mutant('src/sessions/createScanSession.js', 'scanRefusalWire(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED)', 'null').includes('CREATE_EXPIRED_NOT_VIA_WIRE'), '[٥] طفرة: createScanSession تترك سلك رفض الانتهاء المشترك ⟵ يُكشَف (A-SUB)');
  ok(mutant('src/sessions/createScanSession.js', '{reasonCode: SCAN_REFUSAL.SHOP_NO_CREDIT}', '{}').includes('CREATE_NO_CREDIT_WITHOUT_REASONCODE'), '[٥] طفرة: رفض الرصيد في createScanSession بلا reasonCode ⟵ يُكشَف');
  ok(withAppended('src/sessions/createScanSession.js', 'const x = new HttpsError("permission-denied", "y");').includes('CREATE_REFUSAL_WITHOUT_REASONCODE'), '[٥] طفرة: رفض ثالث في createScanSession بنصّ بلا reasonCode ⟵ يُكشَف');
  ok(withAppended('src/sessions/createScanSession.js', 'const t = SCAN_REFUSAL_TEXT;').some((x) => x.startsWith('TEXT_MAP_REFERRERS:')), '[٥] طفرة: createScanSession تعود إلى قراءة خريطة النصوص ⟵ يُكشَف');
  ok(mutant(ANALYZE, 'const gateRefusal = scanGateVerdict(userData, {deviceFP});', 'if (isSubscriptionExpired(userData)) { throw 1; }\n      const gateRefusal = scanGateVerdict(userData, {deviceFP});').includes(`GATE_DUPLICATED:isSubscriptionExpired:${ANALYZE}`), '[٥] طفرة: شرط الانتهاء يُكتب ثانيةً في analyzeDevice ⟵ يُكشَف');
  ok(withAppended(RESERVE, 'if (userData.scansRemaining <= 0) { x(); }').includes(`GATE_DUPLICATED:balance:${RESERVE}`), '[٥] طفرة: شرط رصيد مكتوب ثانيةً في scanReservation ⟵ يُكشَف');
  ok(withAppended(ANALYZE, 'if (usedDevices.includes(deviceFP)) { x(); }').includes('GATE_DUPLICATED:freeDevice:analyzeDevice'), '[٥] طفرة: فحص الجهاز المجاني مكتوب ثانيةً في analyzeDevice ⟵ يُكشَف');
  ok(mutant(RESERVE, 'const verdict = scanGateVerdict(userData, {deviceFP});', 'const verdict = null;').includes(`GATE_NOT_CALLED_ONCE:${RESERVE}`), '[٥] طفرة: معاملة الحجز تترك الحكم الواحد ⟵ يُكشَف');
  ok(mutant(ANALYZE, 'refuseScan(gateRefusal, {stage: SCAN_REFUSAL_STAGE.EARLY, isSessionScan, scanId});', 'refuseScan(gateRefusal, {stage: SCAN_REFUSAL_STAGE.EARLY, scanId});').includes(`ISSESSIONSCAN_NOT_PASSED:${ANALYZE}`), '[٥] طفرة: analyzeDevice لا تمرّر isSessionScan ⟵ يُكشَف');
  ok(mutant(RESERVE, 'stage: SCAN_REFUSAL_STAGE.RESERVATION', 'stage: SCAN_REFUSAL_STAGE.EARLY').includes('STAGE_NOT_RESERVATION_IN_scanReservation'), '[٥] طفرة: معاملة الحجز تكتب مرحلة early ⟵ يُكشَف');
  ok(mutant(ANALYZE, 'stage: SCAN_REFUSAL_STAGE.EARLY', 'stage: SCAN_REFUSAL_STAGE.RESERVATION').includes('STAGE_NOT_EARLY_IN_analyzeDevice'), '[٥] طفرة: الفحص المبكّر يكتب مرحلة reservation ⟵ يُكشَف');
  ok(withAppended(SELF, 'x.delete();').includes('DELETE_IN_scanRefusal'), '[٥] طفرة: حذف في scanRefusal.js ⟵ يُكشَف (القاعدة 42)');
  {
    const CHECK = 'src/users/checkSubscription.js';
    ok(mutant(CHECK, '[CHECK_SUBSCRIPTION_VERDICT_FIELD]: checkSubscriptionVerdict(user),', '').includes('CHECK_SUBSCRIPTION_VERDICT_NOT_IN_BOTH_RETURNS'), '[٥] طفرة: ردّ المسجَّل بلا حكم ⟵ يُكشَف');
    ok(mutant(CHECK, '[CHECK_SUBSCRIPTION_VERDICT_FIELD]: checkSubscriptionVerdict(null),', '').includes('CHECK_SUBSCRIPTION_VERDICT_NOT_IN_BOTH_RETURNS'), '[٥] طفرة: ردّ غير المسجَّل بلا حكم ⟵ يُكشَف');
    ok(mutant(CHECK, '[CHECK_SUBSCRIPTION_VERDICT_FIELD]: checkSubscriptionVerdict(user),', 'scanVerdict: checkSubscriptionVerdict(user),').includes(`FIELD_NAME_LITERAL:${CHECK}`), '[٥] طفرة: اسم الحقل نصّاً حرفياً بدل المصدر ⟵ يُكشَف (القاعدة 24)');    ok(withAppended(CHECK, 'const e = isSubscriptionExpired(user);').includes('GATE_DUPLICATED:checkSubscription'), '[٥] طفرة: شرط الانتهاء يُكتب ثانيةً في checkSubscription ⟵ يُكشَف');
    ok(withAppended(CHECK, 'const low = user.scansRemaining <= 0;').includes('GATE_DUPLICATED:checkSubscription'), '[٥] طفرة: شرط الرصيد يُكتب ثانيةً في checkSubscription ⟵ يُكشَف');
    ok(withAppended('src/users/registerUser.js', 'const r = {"scanVerdict": 1};').includes('FIELD_NAME_LITERAL:src/users/registerUser.js'), '[٥] طفرة: اسم حقل الحكم حرفياً في ملفّ آخر ⟵ يُكشَف');
  }
  {
    // الفحص المبكّر بعد كتابة القفل: نقل نداء الحكم إلى ما بعد db.collection("scanClaims")
    const a = SOURCES[ANALYZE];
    const gateLine = 'const gateRefusal = scanGateVerdict(userData, {deviceFP});';
    const moved = a.replace(gateLine, '').replace('db.collection("scanClaims")', `db.collection("scanClaims"); ${gateLine}`);
    ok(violations({...SOURCES, [ANALYZE]: moved}).includes('EARLY_GATE_NOT_BEFORE_CLAIM_WRITE'), '[٥] طفرة: الحكم المبكّر بعد كتابة القفل ⟵ يُكشَف (الفحص المبكّر بلا كتابة)');
  }

  // ═══ ٦ — العقد (docs/PROTOCOL_CONTRACT.md §١٠) يطابق الوحدة: الفخّ يتبع العقد (القاعدة 39) ═══
  // كل سبب في جدول §١٠-ب = مفتاح من SCAN_REFUSAL في الاتجاهين، واسم حقل الحكم وقيمه المغلقة مذكوران في §١٠-و بأسمائها من المصدر الواحد (لا نسخة تنجرف).
  const DOC_TEXT = fs.readFileSync(path.join(FN, '..', 'docs', 'PROTOCOL_CONTRACT.md'), 'utf8').replace(/\r\n/g, '\n');
  const docSection = (doc) => {
    const at = doc.indexOf('\n## ١٠ — ');
    return at < 0 ? null : doc.slice(at);
  };
  const subsection = (sec, title) => {
    const a = sec.indexOf(`### ${title}`);
    if (a < 0) return null;
    const b = sec.indexOf('\n### ', a + 1);
    return b < 0 ? sec.slice(a) : sec.slice(a, b);
  };
  function docViolations(doc) {
    const v = [];
    const sec = docSection(doc);
    if (sec === null) return ['SECTION_10_MISSING'];
    const reasons = subsection(sec, '١٠-ب');
    if (reasons === null) v.push('SECTION_10B_MISSING');
    else {
      const rows = [...reasons.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]).sort();
      if (JSON.stringify(rows) !== JSON.stringify(Object.keys(R.SCAN_REFUSAL).sort())) v.push(`REASONS_TABLE_DIFFERS:${rows.join(',')}`);
    }
    const verdict = subsection(sec, '١٠-و');
    if (verdict === null) v.push('SECTION_10F_MISSING');
    else {
      if (!verdict.includes(`\`${R.CHECK_SUBSCRIPTION_VERDICT_FIELD}\``)) v.push('VERDICT_FIELD_NAME_NOT_IN_DOC');
      for (const value of Object.values(R.CHECK_SUBSCRIPTION_VERDICT)) if (!verdict.includes(`\`${value}\``)) v.push(`VERDICT_VALUE_NOT_IN_DOC:${value}`);
    }
    if (!/`details\.reasonCode`|`\{reasonCode\}`/.test(sec)) v.push('REASON_CODE_WIRE_NOT_IN_DOC');
    return v;
  }
  deq(docViolations(DOC_TEXT), [], '[٦] §١٠ من العقد: جدول الأسباب = SCAN_REFUSAL، واسم حقل الحكم وقيمه المغلقة مذكوران بأسمائها من المصدر الواحد');
  const docMutant = (from, to) => {
    ok(DOC_TEXT.includes(from), `[٦] الطفرة: النصّ المستهدَف موجود في العقد — ${from.slice(0, 40)}`);
    return docViolations(DOC_TEXT.replace(from, to));
  };
  ok(docMutant('| `SHOP_NO_CREDIT` |', '| `SHOP_NO_CREDIT_X` |').some((x) => x.startsWith('REASONS_TABLE_DIFFERS')), '[٦] طفرة: اسم سبب في العقد يختلف عن الوحدة ⟵ يُكشَف');
  ok(docMutant('| `FREE_DEVICE_USED` | باقة free', '| `FREE_DEVICE_USED_` | باقة free').some((x) => x.startsWith('REASONS_TABLE_DIFFERS')), '[٦] طفرة: صفّ سبب يُغيَّر ⟵ يُكشَف');
  ok(DOC_TEXT.includes('`scanVerdict`') && docViolations(DOC_TEXT.split('`scanVerdict`').join('`verdict`')).includes('VERDICT_FIELD_NAME_NOT_IN_DOC'), '[٦] طفرة: اسم حقل الحكم في العقد (كلّ ذكر) يختلف عن الوحدة ⟵ يُكشَف');
  ok(docMutant('`ALLOWED` · `NO_CREDIT` · `SUBSCRIPTION_EXPIRED`', '`ALLOWED` · `NO_CREDIT`').includes('VERDICT_VALUE_NOT_IN_DOC:SUBSCRIPTION_EXPIRED'), '[٦] طفرة: قيمة من القائمة المغلقة تسقط من العقد ⟵ يُكشَف');
  ok(docViolations(DOC_TEXT.replace('\n## ١٠ — ', '\n## ١١ — ')).includes('SECTION_10_MISSING'), '[٦] طفرة: القسم يُعاد ترقيمه ⟵ يُكشَف (فحص غير فارغ)');

  console.log(`\nscanRefusalGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
