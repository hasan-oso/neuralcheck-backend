'use strict';

// sessionTimeout.test.js — قرار مستخدم 2026-09-30 +03 («قرار — مهلة الجلسة
// ساعة»)، يحلّ محلّ نسخة fbcc74c بالكامل (القاعدة 23 — استُبدل الملفّ، لم
// يُضَف إليه: fbcc74c كانت تختبر joinedAt+60 دقيقة، وهذا القرار أبطلها
// وأعاد الفحص إلى expiresAt وحدها، 60 دقيقة من الإنشاء).
//
// يختبر src/sessions/sessionTimeout.js (assertSessionNotExpired) كوحدة
// خالصة — بلا Firestore، بلا محاكي. التغطية الحسابية الدقيقة لكل الحالات
// المذكورة حرفياً في نصّ الأمر. التغطية عبر المسارين الحقيقيّين
// (analyzeDevice.js/submitEvaluation.js، عبر المحاكي) في
// session_billing.e2e.test.js/session_evaluation.e2e.test.js، والانضمام
// (joinScanSession.js، لم يتغيّر) هناك أيضاً.
//
// Run: node functions/test/sessionTimeout.test.js

const assert = require('assert');
const {HttpsError} = require('firebase-functions/v2/https');
const {assertSessionNotExpired} = require('../src/sessions/sessionTimeout');

let n = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

function assertThrowsHttps(fn, expectedCode, expectedMessagePattern, label) {
  let threw = null;
  try {
    fn();
  } catch (e) {
    threw = e;
  }
  ok(threw instanceof HttpsError, `${label} — يرمي HttpsError فعلاً`);
  if (threw) {
    eq(threw.code, expectedCode, `${label} — code=${expectedCode}`);
    ok(expectedMessagePattern.test(threw.message), `${label} — الرسالة تطابق ${expectedMessagePattern} (فعلياً: "${threw.message}")`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ١ — نصّ الأمر حرفياً: "تحليل في الدقيقة 50 يُقبل" (داخل الساعة، بعيداً
//     كافياً عن أي حافّة).
// ═══════════════════════════════════════════════════════════════════════
{
  const createdAt = new Date('2026-09-30T12:00:00.000Z');
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000); // 60 دقيقة من الإنشاء
  const now = new Date('2026-09-30T12:50:00.000Z'); // الدقيقة 50
  let threw = null;
  try {
    assertSessionNotExpired({expiresAt: {toDate: () => expiresAt}}, now);
  } catch (e) { threw = e; }
  eq(threw, null, '[١][نصّ الأمر حرفياً] تحليل في الدقيقة 50 → مقبول، لا رمي');
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — نصّ الأمر حرفياً: "وفي 61 يُرفض" — failed-precondition/"الجلسة
//     منتهية" (نفس الرمز/النصّ القائمين، لا تغيير عليهما).
// ═══════════════════════════════════════════════════════════════════════
{
  const createdAt = new Date('2026-09-30T12:00:00.000Z');
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
  const now = new Date('2026-09-30T13:01:00.000Z'); // الدقيقة 61
  assertThrowsHttps(
      () => assertSessionNotExpired({expiresAt: {toDate: () => expiresAt}}, now),
      'failed-precondition', /منتهية/,
      '[٢][نصّ الأمر حرفياً] تحليل في الدقيقة 61');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — نصّ الأمر حرفياً: "وانضمام في 30 يُقبل" — هذا الفحص نفسه (expiresAt)
//     هو ما يفحصه joinScanSession.js أيضاً (لم يتغيّر) — الدالّة هنا مصدر
//     الحقيقة المشترك، فتُختبَر هنا مباشرة؛ التغطية عبر joinScanSession.js
//     الحقيقية نفسها في session_billing.e2e.test.js.
// ═══════════════════════════════════════════════════════════════════════
{
  const createdAt = new Date('2026-09-30T12:00:00.000Z');
  const expiresAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
  const now = new Date('2026-09-30T12:30:00.000Z'); // الدقيقة 30
  let threw = null;
  try {
    assertSessionNotExpired({expiresAt: {toDate: () => expiresAt}}, now);
  } catch (e) { threw = e; }
  eq(threw, null, '[٣][نصّ الأمر حرفياً] انضمام (أو أيّ فحص) في الدقيقة 30 → مقبول');
}

// ═══════════════════════════════════════════════════════════════════════
// ٤ — إضافة مطلوبة بنصّ الأمر: "جلسة بلا expiresAt تُرفض في التحليل
//     والتقييم" — permission-denied/"جلسة الفحص غير صالحة" (نصّ قائم
//     مُعاد استعماله، لا نصّ جديد). لا Invalid Date يمرّ صامتاً (القاعدة 22).
// ═══════════════════════════════════════════════════════════════════════
assertThrowsHttps(
    () => assertSessionNotExpired({}),
    'permission-denied', /غير صالحة/,
    '[٤][نصّ الأمر حرفياً] جلسة بلا expiresAt إطلاقاً (مفتاح غائب)');
assertThrowsHttps(
    () => assertSessionNotExpired(null),
    'permission-denied', /غير صالحة/,
    '[٤-ب] sessionData=null كاملاً — نفس الرفض');
assertThrowsHttps(
    () => assertSessionNotExpired({expiresAt: null}),
    'permission-denied', /غير صالحة/,
    '[٤-ج] expiresAt=null صراحة — يُعامَل كغائب (toDateOrNull(null)=null)، لا "صالحة بلا حدّ"');
assertThrowsHttps(
    () => assertSessionNotExpired({expiresAt: 'not-a-real-date'}),
    'permission-denied', /غير صالحة/,
    '[٤-د] expiresAt نصّ غير قابل للتحويل — تلف يُعامَل كغياب، لا Invalid Date تمرّ صامتة');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — حدود دقيقة حول الساعة بالضبط.
// ═══════════════════════════════════════════════════════════════════════
{
  const expiresAt = new Date('2026-09-30T13:00:00.000Z');
  const justBefore = new Date(expiresAt.getTime() - 1000);
  const justAfter = new Date(expiresAt.getTime() + 1000);
  let threw1 = null;
  try {
    assertSessionNotExpired({expiresAt: {toDate: () => expiresAt}}, justBefore);
  } catch (e) { threw1 = e; }
  eq(threw1, null, '[٥] ثانية واحدة قبل انتهاء expiresAt — مقبول');
  assertThrowsHttps(
      () => assertSessionNotExpired({expiresAt: {toDate: () => expiresAt}}, justAfter),
      'failed-precondition', /منتهية/,
      '[٥] ثانية واحدة بعد انتهاء expiresAt — مرفوض');
}

// ═══════════════════════════════════════════════════════════════════════
// ٦ — أشكال expiresAt الثلاثة التي قد تصل فعلياً (Firestore Timestamp
//     حقيقي، JS Date مباشرة، نصّ ISO) — عبر toDateOrNull (مصدر واحد،
//     القاعدة 24).
// ═══════════════════════════════════════════════════════════════════════
{
  const now = new Date('2026-09-30T12:30:00.000Z');
  const inTenMinIso = '2026-09-30T12:40:00.000Z';
  let threw = null;
  try {
    assertSessionNotExpired({expiresAt: inTenMinIso}, now);
  } catch (e) { threw = e; }
  eq(threw, null, '[٦] expiresAt نصّ ISO (شكل غير Firestore، للاختبار) — يُقرأ بأمان، مقبول قبل الانتهاء');

  let threw2 = null;
  try {
    assertSessionNotExpired({expiresAt: new Date(inTenMinIso)}, now);
  } catch (e) { threw2 = e; }
  eq(threw2, null, '[٦] expiresAt كائن Date مباشر (لا Timestamp) — يُقرأ بأمان أيضاً');
}

console.log(`sessionTimeout.test.js: ${n}/${n} assertions passed`);
