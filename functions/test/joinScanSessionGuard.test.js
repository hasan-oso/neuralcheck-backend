'use strict';

// joinScanSessionGuard.test.js — رموز رفض joinScanSession ونصوصها (الدفعة ٩ «مسار الجلسة»، 2026-10-10 +03). وحدة بلا شبكة ولا محاكٍ؛ المسارات الحقيقية في
// scanSessionJoinStates.e2e.test.js.
//
// أمر المنسّق (بنصّه): ««رمز غير صالح» و«انضُمّ إليها» و«ملغاة» و«منتهية»، كلٌّ برمز مسمّى من مصدر واحد (القاعدة 24) في `details`. ونصّ «انضُمّ إليها» بالعربية والتركية
// «مقترح للاعتماد» (القرار ٩٠)… ولا يصل إلى مستخدم قبل اعتماد المستخدم. فإن احتاج الكود نصّاً الآن، فالنصّ القائم «الكود غير صالح أو منتهي الصلاحية» يبقى معروضاً،
// والرمز المسمّى هو ما يميّز.»
//   ١ النصوص المعروضة هي القائمة قبل الدفعة حرفياً (فخّ: نصّ جديد يصل مستخدماً يُفشل هنا)، ٢ ردّ كل مرحلة، ٣ refuse تكتب سطرها وتحمل details،
//   ٤ بنية الشيفرة: موضعا رمي فقط، وكل رمز مستعمَل، ولا حذف، والحالات من المصدر الواحد،
//   ٥ إعادة انضمام الجهاز نفسه (2026-10-10): القرار من مصدر واحد في المرحلتين، وبلا كتابة ولا FCM في مسارها (السلوك الحيّ: joinScanSessionRejoin.e2e.test.js).
//   ٦ الرفض المبكّر لجلسة مالكها منتهٍ اشتراكه (S-SUB، 2026-10-16): الحكم isSubscriptionExpired نفسها، في المعاملة بعد فحص الجلسة وعودة إعادة الانضمام وقبل كتابة الانضمام، بلا فحص رصيد، والرمز والنصّ من
//     scanRefusal.js، وقراءة المالك مرّة واحدة قبل المعاملة (السلوك الحيّ: joinScanSessionOwnerExpired.e2e.test.js).
//
// Run: node functions/test/joinScanSessionGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const J = require('../src/sessions/joinScanSession');
const {JOIN_REFUSAL: R, SESSION_STATUS} = require('../src/sessions/sessionNames');
const {hashIdForLog} = require('../src/utils/logRedaction');
const {SCAN_REFUSAL, SCAN_REFUSAL_TEXT} = require('../src/analysis/scanRefusal');

// ═══ ١ — النصوص المعروضة: القائمة قبل الدفعة حرفياً (joinScanSession.js عند 83d7750:26 و:39 و:43 و:48) ═══
deq({...J.JOIN_TEXT}, {
  INVALID_OR_EXPIRED: 'الكود غير صالح أو منتهي الصلاحية',
  SESSION_MISSING: 'الجلسة غير موجودة',
  NOT_AVAILABLE: 'الجلسة ليست متاحة للانضمام',
  CODE_EXPIRED: 'انتهت صلاحية الكود',
}, '[١] النصوص الأربعة المعروضة كما كانت حرفياً — لا نصّ جديد (القرار ٩٠: النصّ المعروض يعتمده المستخدم)');
ok(Object.isFrozen(J.JOIN_TEXT) && Object.isFrozen(J.JOIN_STAGE), '[١] مجمَّدة');
deq({...J.JOIN_STAGE}, {LOOKUP: 'lookup', TRANSACTION: 'transaction'}, '[١] مرحلتا السجلّ');

// ═══ ٢ — ردّ كل مرحلة ═══
const lookupCases = [
  [R.CODE_INVALID, 'not-found', J.JOIN_TEXT.INVALID_OR_EXPIRED],
  [R.ALREADY_JOINED, 'not-found', J.JOIN_TEXT.INVALID_OR_EXPIRED],
  [R.COMPLETED, 'not-found', J.JOIN_TEXT.INVALID_OR_EXPIRED], // الجهاز نفسه بعد الاكتمال: الرمز والنصّ الظاهران القائمان (قرار المستخدم: «with the current visible text»)
  [R.CANCELLED, 'not-found', J.JOIN_TEXT.INVALID_OR_EXPIRED],
  [R.STATUS_UNKNOWN, 'not-found', J.JOIN_TEXT.INVALID_OR_EXPIRED],
  [R.EXPIRED, 'deadline-exceeded', J.JOIN_TEXT.CODE_EXPIRED],
];
for (const [reason, code, message] of lookupCases) {
  deq(J.lookupResponse(reason), {code, message}, `[٢] مرحلة البحث — ${reason}: ${code} والنصّ القائم`);
}
const txCases = [
  [R.ALREADY_JOINED, 'failed-precondition', J.JOIN_TEXT.NOT_AVAILABLE],
  [R.COMPLETED, 'failed-precondition', J.JOIN_TEXT.NOT_AVAILABLE],
  [R.CANCELLED, 'failed-precondition', J.JOIN_TEXT.NOT_AVAILABLE],
  [R.STATUS_UNKNOWN, 'failed-precondition', J.JOIN_TEXT.NOT_AVAILABLE],
  [R.EXPIRED, 'deadline-exceeded', J.JOIN_TEXT.CODE_EXPIRED],
];
for (const [reason, code, message] of txCases) {
  deq(J.transactionStatusResponse(reason), {code, message}, `[٢] مرحلة المعاملة — ${reason}: ${code} والنصّ القائم`);
}
eq(J.lookupResponse(R.EXPIRED).message, J.transactionStatusResponse(R.EXPIRED).message, '[٢] وللمنتهية النصّ نفسه في المرحلتين');
eq(J.lookupResponse(R.EXPIRED).code, J.transactionStatusResponse(R.EXPIRED).code, '[٢] والرمز نفسه');
// «الكود غير صالح» لأربع حالات مختلفة معنىً: التمييز في details وحده — فالنصّ المعروض لا يفرّق (قرار المستخدم: النصّ القائم يبقى)
eq(new Set([R.CODE_INVALID, R.ALREADY_JOINED, R.COMPLETED, R.CANCELLED].map((r) => J.lookupResponse(r).message)).size, 1, '[٢] «رمز غير صالح» و«انضُمّ إليها» و«اكتملت» و«ملغاة» بنصّ معروض واحد (القائم)، والرمز المسمّى هو ما يميّز');
// كل رمز في JOIN_REFUSAL له صفّ في جدولَي المرحلتين (رمز جديد بلا صفّ يُفشل — القاعدة 30: كل القيم، لا واحدة). يُستثنى رمزان يُردّان من المعاملة بنصّهما القائم لا من transactionStatusResponse.
for (const reason of Object.values(R)) {
  if (reason === R.CODE_INVALID || reason === R.EXPIRES_AT_INVALID) continue;
  ok(lookupCases.some((c) => c[0] === reason), `[٢] ${reason} له صفّ في جدول مرحلة البحث`);
  ok(txCases.some((c) => c[0] === reason), `[٢] ${reason} له صفّ في جدول مرحلة المعاملة`);
}

// ═══ ٣ — refuse ═══
{
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); };
  let thrown;
  try {
    J.refuse(R.ALREADY_JOINED, {stage: 'lookup', code: 'not-found', message: 'm', sessionId: 'session-abc-123', joinerUid: 'uid-xyz-999', extra: ' matches=2'});
  } catch (e) { thrown = e; }
  try {
    ok(thrown && thrown.code === 'not-found' && thrown.message === 'm', '[٣] refuse ترمي بالرمز والنصّ المُمرَّرين');
    deq(thrown.details, {reasonCode: 'SESSION_ALREADY_JOINED'}, '[٣] وdetails = {reasonCode}');
    eq(warns.length, 1, '[٣] وتكتب سطراً واحداً');
    eq(warns[0], `[joinScanSession] refused reason=SESSION_ALREADY_JOINED stage=lookup session=${hashIdForLog('session-abc-123')} joiner=${hashIdForLog('uid-xyz-999')} matches=2`, '[٣] السطر: السبب والمرحلة والمعرّفان مُهشَّران');
    ok(!warns[0].includes('session-abc-123') && !warns[0].includes('uid-xyz-999'), '[٣] لا معرّف خامّ');
    warns.length = 0;
    thrown = null;
    try { J.refuse(R.CODE_INVALID, {stage: 'lookup', code: 'not-found', message: 'm'}); } catch (e) { thrown = e; }
    eq(warns[0], '[joinScanSession] refused reason=SESSION_CODE_INVALID stage=lookup joiner=missing', '[٣] بلا جلسة وبلا منضمّ: لا session=، وjoiner=missing (الغياب حالة صريحة)');
    let bad = null;
    try { J.refuse('NOT_A_REASON', {stage: 'lookup', code: 'not-found', message: 'm'}); } catch (e) { bad = e; }
    ok(bad && !bad.code && /سبب رفض غير مُدرَج/.test(bad.message), '[٣] سبب غير مُدرَج يُرمى كخطأ برمجي لا يُكتب بصمت');
    eq(warns.length, 1, '[٣] ولا سطر له');
    // S-SUB: SHOP_SUBSCRIPTION_EXPIRED (من SCAN_REFUSAL) مقبول، وغيره من SCAN_REFUSAL غير مقبول («بلا رصيد» عند الانضمام لم يُقرَّر)
    warns.length = 0;
    thrown = null;
    try {
      J.refuse(SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED, {
        stage: 'transaction', code: 'permission-denied', message: SCAN_REFUSAL_TEXT[SCAN_REFUSAL.SHOP_SUBSCRIPTION_EXPIRED],
        sessionId: 'session-abc-123', joinerUid: 'uid-xyz-999', extra: ` owner=${hashIdForLog('owner-uid-555')}`,
      });
    } catch (e) { thrown = e; }
    ok(thrown && thrown.code === 'permission-denied' && thrown.message === 'انتهى اشتراكك، يرجى التجديد', '[٣] SHOP_SUBSCRIPTION_EXPIRED: permission-denied بنصّ الانتهاء القائم حرفياً');
    deq(thrown.details, {reasonCode: 'SHOP_SUBSCRIPTION_EXPIRED'}, '[٣] وdetails = {reasonCode: SHOP_SUBSCRIPTION_EXPIRED}');
    eq(warns[0], `[joinScanSession] refused reason=SHOP_SUBSCRIPTION_EXPIRED stage=transaction session=${hashIdForLog('session-abc-123')} joiner=${hashIdForLog('uid-xyz-999')} owner=${hashIdForLog('owner-uid-555')}`, '[٣] والسطر على النسق القائم + owner مُهشَّراً');
    ok(!warns[0].includes('session-abc-123') && !warns[0].includes('uid-xyz-999') && !warns[0].includes('owner-uid-555'), '[٣] لا معرّف خامّ');
    for (const other of ['NO_CREDIT', 'SUBSCRIPTION_EXPIRED', 'FREE_DEVICE_USED', 'SHOP_NO_CREDIT']) {
      let e2 = null;
      try { J.refuse(other, {stage: 'transaction', code: 'permission-denied', message: 'm'}); } catch (e) { e2 = e; }
      ok(e2 && !e2.code && /سبب رفض غير مُدرَج/.test(e2.message), `[٣] ${other} ليس سبب رفض انضمام (لا رفض بلا رصيد عند الانضمام، ولا نسخة غير المحلّ)`);
    }
    eq(warns.length, 1, '[٣] ولا سطر لغير المُدرَج');
  } finally {
    console.warn = realWarn;
  }
}

// ═══ ٤ — بنية الشيفرة ═══
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const rawSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'joinScanSession.js'), 'utf8').replace(/\r\n/g, '\n');
const source = strip(rawSource);
const throwSites = [...source.matchAll(/throw new HttpsError\(/g)];
eq(throwSites.length, 2, '[٤] موضعا `throw new HttpsError` فقط: «الكود مطلوب» قبل البحث، وrefuse (الشيفرة بلا تعليقات)');
const refuseDef = source.indexOf('function refuse(');
const refuseEnd = source.indexOf('\n}\n', refuseDef);
ok(refuseDef >= 0 && throwSites.some((m) => m.index > refuseDef && m.index < refuseEnd), '[٤] أحدهما داخل refuse — فرمي رفض جلسة جديد خارجها يُفشل هنا');
const outside = throwSites.filter((m) => !(m.index > refuseDef && m.index < refuseEnd));
eq(outside.length, 1, '[٤] والآخر واحد خارجها');
ok(/invalid-argument["'],\s*["']الكود مطلوب["']/.test(source.slice(outside[0].index, outside[0].index + 120)), '[٤] وهو «الكود مطلوب» (invalid-argument) كما كان');
ok(!/\.delete\(|FieldValue\.delete|recursiveDelete|bulkWriter|\.batch\(/.test(source), '[٤] لا حذف في الملفّ (القاعدة 42)');
// كل رمز JOIN_REFUSAL مستعمَل: ما يُسمّى هنا بالاسم، والباقي يصل من decideJoinForNonPending (مصدره sessionLifecycle.js)
for (const name of ['CODE_INVALID', 'EXPIRED', 'EXPIRES_AT_INVALID']) ok(new RegExp(`\\bJ\\.${name}\\b`).test(source), `[٤] الرمز ${name} مستعمَل في joinScanSession.js`);
const lifecycle = strip(fs.readFileSync(path.join(__dirname, '..', 'src', 'sessions', 'sessionLifecycle.js'), 'utf8').replace(/\r\n/g, '\n'));
for (const name of ['ALREADY_JOINED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'STATUS_UNKNOWN']) ok(new RegExp(`JOIN_REFUSAL\\.${name}\\b`).test(lifecycle), `[٤] ${name} يُعاد من decideJoinForNonPending في sessionLifecycle.js`);
ok(!/refuse\(\s*["'`]/.test(source), '[٤] ولا نداء refuse بسبب نصّ حرفي (الأسباب من المصدر الواحد)');
// الحالات من المصدر الواحد: لا نصّ حرفي لحالة في الملفّ
ok(!/["'`](pending|scanning|completed|expired|cancelled)["'`]/.test(source), '[٤] لا نصّ حرفي لحالة جلسة في joinScanSession.js (SESSION_STATUS من sessionNames.js)');
ok(/SESSION_STATUS\.PENDING/.test(source) && /SESSION_STATUS\.SCANNING/.test(source), '[٤] والحالتان المستعملتان من SESSION_STATUS');
ok(SESSION_STATUS.PENDING === 'pending' && SESSION_STATUS.SCANNING === 'scanning', '[٤] وقيمتاهما بنصّهما في Firestore');
// الاستعلام بالرمز وحده (ثم تصفية الحالة في الذاكرة): لا where على status في الملفّ
ok(!/\.where\(\s*["']status["']/.test(source), '[٤] ولا where("status") في الاستعلام (يُصفّى في الذاكرة ليُعرَف حال غير الـpending)');
// المعاملة لا ترمي HttpsError (الرمي يُسقط كتابة «منتهية»)
const txStart = source.indexOf('db.runTransaction(');
const txEnd = source.indexOf('if (outcome.refusal)');
ok(txStart > 0 && txEnd > txStart, '[٤] المعاملة موجودة وتتبعها معالجة outcome.refusal');
ok(!/throw\s/.test(source.slice(txStart, txEnd)), '[٤] **لا throw داخل دالّة المعاملة** — تُرجِع قراراً (الرمي يُسقط كتابة «منتهية»: العطب الذي كان في الملفّ)');

// ═══ ٥ — إعادة انضمام الجهاز نفسه (2026-10-10): قرار واحد في المرحلتين، وبلا كتابة ولا FCM في مساره ═══
// قرار المستخدم (بنصّه): «والجهاز المنضمّ نفسه إن أعاد الانضمام … يُقبل بلا رسالة ولا أثر جانبي.» والسلوك الحيّ على المحاكي في joinScanSessionRejoin.e2e.test.js؛ هنا الشكل فقط.
ok(!/joinRefusalForNonPending/.test(source) && !/joinRefusalForNonPending/.test(lifecycle), '[٥] الدالّة القديمة joinRefusalForNonPending (رفض لكلّ مستدعٍ) اختفت — لا نسختان للقرار');
eq([...source.matchAll(/decideJoinForNonPending\(/g)].length, 2, '[٥] القرار من decideJoinForNonPending في موضعين فقط: البحث والمعاملة (مصدر واحد)');
ok(!/joinedBy\s*(===|==|!==|!=)/.test(source) && !/(===|==|!==|!=)\s*[\w.]*joinedBy/.test(source), '[٥] لا مقارنة بـjoinedBy في joinScanSession.js نفسه — المقارنة في isJoinedBy (sessionLifecycle.js، مصدرها الواحد مع الإلغاء)');
ok(/function decideJoinForNonPending[\s\S]*?isJoinedBy\(data, joinerUid\)/.test(lifecycle), '[٥] وdecideJoinForNonPending تقارن عبر isJoinedBy');
{
  const tx = source.slice(source.indexOf('db.runTransaction('), source.indexOf('if (outcome.refusal)'));
  const rejoinReturn = tx.indexOf('if (rejoin) return {session: data, rejoined: true};');
  const joinWrite = tx.indexOf('status: SESSION_STATUS.SCANNING');
  ok(rejoinReturn > 0 && joinWrite > rejoinReturn, '[٥] في المعاملة: عودة إعادة الانضمام (بلا كتابة) **قبل** كتابة الانضمام (status/joinedAt/joinedBy)');
  eq([...tx.matchAll(/tx\.update\(/g)].length, 2, '[٥] وفي المعاملة كتابتان فقط: «منتهية» (الانقضاء) والانضمام الأوّل — ولا ثالثة لإعادة الانضمام');
}
{
  const afterTx = source.slice(source.indexOf('const session = outcome.session;'));
  const iRejoin = afterTx.indexOf('if (outcome.rejoined) {');
  const iElse = afterTx.indexOf('} else if (owner?.fcmToken) {');
  const iFcm = afterTx.indexOf('admin.messaging()');
  ok(iRejoin >= 0 && iElse > iRejoin && iFcm > iElse, '[٥] إرسال FCM في فرع else لـ«if (outcome.rejoined)»: لا إشعار ثانٍ في إعادة الانضمام');
  eq([...afterTx.matchAll(/admin\.messaging\(\)\.send\(/g)].length, 1, '[٥] ونداء إرسال واحد في الملفّ');
  // سطر إعادة الانضمام: معرّفات مُهشَّرة ولا رمز جلسة
  const lines = [...afterTx.matchAll(/console\.log\((`\[joinScanSession\] rejoined[\s\S]*?)\);\n/g)];
  eq(lines.length, 1, '[٥] سطر سجلّ rejoined واحد');
  const exprs = [...lines[0][1].matchAll(/\$\{([^}]+)\}/g)].map((x) => x[1].trim());
  deq(exprs, ['rejoinSeenAt', 'hashIdForLog(sessionId)', 'hashIdForLog(session.ownerId)', 'hashIdForLog(joinerUid)'], '[٥] سطر rejoined: موضع الرؤية والمعرّفات الثلاثة مُهشَّرة وحدها');
  ok(!/\bcode\b/.test(lines[0][1]), '[٥] ولا رمز الجلسة (code) في السطر');
}
// إعادة الانضمام لا تكنس (قرار المستخدم 2026-10-16، منقول عن أمر المنسّق: «الكنس عند إعادة الانضمام: (ب) لا كنس. السطر الواحد مع اختباره.»). السلوك الحيّ على المحاكي في
// sweepOnCreateJoin.e2e.test.js المشهد ٥ (كان يثبّت أنها تكنس — القاعدة 23: استُبدل بما يثبّت عدمه)؛ وهنا الشكل: نداء الكنس الوحيد داخل فرع «ليست إعادة انضمام» وحده.
{
  const afterTx = source.slice(source.indexOf('const session = outcome.session;'));
  eq([...afterTx.matchAll(/sweepAndLog\(/g)].length, 1, '[٥] نقطة كنس واحدة بعد المعاملة');
  ok(/if \(!outcome\.rejoined\) \{\s*await sweepAndLog\(\{[\s\S]*?\}\);\s*\}/.test(afterTx), '[٥] نداء الكنس داخل «if (!outcome.rejoined) { … }» وحده: إعادة الانضمام لا تكنس ولا تكتب سطر E34');
  eq((afterTx.slice(0, afterTx.indexOf('if (!outcome.rejoined)')).match(/sweepAndLog\(/g) || []).length, 0, '[٥] ولا نداء كنس قبل ذلك الشرط');
  ok(afterTx.indexOf('evaluationEnabled=') >= 0 && afterTx.indexOf('evaluationEnabled=') < afterTx.indexOf('if (!outcome.rejoined)'), '[٥] الكنس بعد سطر evaluationEnabled (ترتيبه القائم: لا يتأخّر إشعار المالك بالكنس)');
}

// ═══ ٦ — الرفض المبكّر لجلسة مالكها منتهٍ اشتراكه (S-SUB، 2026-10-16): الشكل. السلوك الحيّ على المحاكي في joinScanSessionOwnerExpired.e2e.test.js ═══
{
  const tx = source.slice(source.indexOf('db.runTransaction('), source.indexOf('if (outcome.refusal)'));
  const iRejoin = tx.indexOf('if (rejoin) return {session: data, rejoined: true};');
  const iCheck = tx.indexOf('if (isSubscriptionExpired(owner)) {');
  const iJoinWrite = tx.indexOf('status: SESSION_STATUS.SCANNING');
  const iExpiryWrite = tx.indexOf('tx.update(sessionRef, expiredWriteFields(');
  ok(iExpiryWrite > 0 && iRejoin > iExpiryWrite && iCheck > iRejoin && iJoinWrite > iCheck,
      '[٦] ترتيب المعاملة: فحص الجلسة (انقضاء الوقت يكتب «منتهية») ثم عودة إعادة الانضمام ثم حكم المالك ثم كتابة الانضمام — فحكم المالك لا يسبق ما يخصّ الجلسة ولا يرفض إعادة الانضمام ولا يأتي بعد الكتابة');
  ok(/isSubscriptionExpired\(owner\)/.test(source) && !/scanGateVerdict|checkSubscriptionVerdict|scansRemaining/.test(source),
      '[٦] الحكم isSubscriptionExpired(owner) نفسها (مصدر «منتهٍ» الواحد)، ولا فحص رصيد في الملفّ (لم يُقرَّر)');
  ok(/scanRefusalWire\(SCAN_REFUSAL\.SHOP_SUBSCRIPTION_EXPIRED\)/.test(tx) && !/["'`]SHOP_SUBSCRIPTION_EXPIRED["'`]/.test(source) && !source.includes('انتهى اشتراكك'),
      '[٦] الرمز والنصّ من scanRefusal.js (scanRefusalWire)، بلا نسخة حرفية للسبب ولا للنصّ (القاعدة 24)');
  ok(!/throw\s/.test(tx), '[٦] ولا throw داخل المعاملة (تُرجِع قراراً)');
  eq([...tx.matchAll(/tx\.update\(/g)].length, 2, '[٦] وكتابتا المعاملة هما نفسهما: «منتهية» والانضمام الأوّل — لا كتابة في فرع الرفض');
  // وثيقة المالك: قراءة واحدة، قبل المعاملة، لا بعدها
  const usersReads = [...source.matchAll(/db\.collection\("users"\)/g)];
  eq(usersReads.length, 1, '[٦] قراءة واحدة لمجموعة users في الملفّ كلّه');
  ok(usersReads[0].index < source.indexOf('db.runTransaction('), '[٦] وهي قبل المعاملة (لا بعدها)');
  ok(/candidate\.data\.ownerId/.test(source.slice(usersReads[0].index, usersReads[0].index + 80)), '[٦] بمعرّف المالك من لقطة البحث (ثابت في الجلسة)');
  // الرفض يمرّ بـrefuse وحدها (موضع الرمي الوحيد) ومرحلته transaction
  ok(/refuse\(reason, \{stage: JOIN_STAGE\.TRANSACTION, sessionId, joinerUid, code: refusalCode, message, extra\}\)/.test(source), '[٦] الرفض بعد المعاملة بـrefuse(stage: transaction) كسائر رفض مرحلة المعاملة');
  // التماثل مع البوّابة: الحكم نفسه
  const subscription = require('../src/utils/subscription');
  const refusalSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'scanRefusal.js'), 'utf8');
  ok(/isSubscriptionExpired\(userData, now\)/.test(refusalSource) && typeof subscription.isSubscriptionExpired === 'function',
      '[٦] scanGateVerdict (البوّابة وردّ checkSubscription) تستعمل isSubscriptionExpired نفسها التي يستعملها الانضمام');
}

console.log(`\njoinScanSessionGuard.test.js: ${n}/${n} assertions passed`);
