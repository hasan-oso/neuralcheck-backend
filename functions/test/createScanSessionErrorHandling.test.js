'use strict';

// createScanSessionErrorHandling.test.js — أمر مستخدم 2026-09-30 +03
// («قرار — مهلة الجلسة ساعة»، بند إصلاح createScanSession.js:76). يختبر
// wrapUnexpectedCreateSessionError كوحدة خالصة — بلا Firestore/onCall.
// يغطّي: (أ) رسالة العميل ثابتة عربية جديدة + رمز سبب في details، (ب)
// النصّ الخام لا يصل العميل أبداً (القاعدة 36)، (ج) التنقية تُطبَّق على ما
// يُسجَّل في سجلّ الخادم أيضاً (سطر api key كامل، سيناريو رمز 36 الحقيقي).
//
// Run: node functions/test/createScanSessionErrorHandling.test.js

const assert = require('assert');
const {HttpsError} = require('firebase-functions/v2/https');
const {
  wrapUnexpectedCreateSessionError,
  CREATE_SESSION_INTERNAL_ERROR_MESSAGE,
  CREATE_SESSION_INTERNAL_ERROR_REASON_CODE,
  SESSION_VALIDITY_MINUTES,
} = require('../src/sessions/createScanSession');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// ١ — SESSION_VALIDITY_MINUTES = 60 (مصدر واحد — القاعدة 24).
// ═══════════════════════════════════════════════════════════════════════
eq(SESSION_VALIDITY_MINUTES, 60, '[١] SESSION_VALIDITY_MINUTES=60 — نفس الرقم يُستعمَل في expiresAt وexpiresInMinutes معاً');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — رسالة العميل ثابتة، لا خامّة — مهما كان نصّ الخطأ الأصلي.
// ═══════════════════════════════════════════════════════════════════════
{
  const rawError = new Error('FirebaseError: 7 PERMISSION_DENIED: Missing or insufficient permissions for project abc-123-internal.');
  const {httpsError} = wrapUnexpectedCreateSessionError(rawError);
  ok(httpsError instanceof HttpsError, '[٢] يُعيد HttpsError فعلاً');
  eq(httpsError.code, 'internal', '[٢] code=internal');
  eq(httpsError.message, CREATE_SESSION_INTERNAL_ERROR_MESSAGE, '[٢] الرسالة هي الثابت المُصدَّر، لا نصّ الخطأ الخام');
  ok(!httpsError.message.includes('abc-123-internal'), '[٢][الأهمّ] لا جزء من النصّ الخام (project id) يصل رسالة العميل');
  deepEq(httpsError.details, {reasonCode: CREATE_SESSION_INTERNAL_ERROR_REASON_CODE}, '[٢] details={reasonCode} — للتشخيص لا للعرض');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — الرسالة عربية ثابتة، مختلفة عن رسائل الرفض الأخرى في هذا الملفّ
//     (ليست "لا يوجد رصيد" ولا "انتهى اشتراكك" ولا "تعذّر توليد كود فريد").
// ═══════════════════════════════════════════════════════════════════════
eq(typeof CREATE_SESSION_INTERNAL_ERROR_MESSAGE, 'string', '[٣] الرسالة نصّية');
ok(/[؀-ۿ]/.test(CREATE_SESSION_INTERNAL_ERROR_MESSAGE), '[٣] الرسالة عربية فعلاً');
ok(!['لا يوجد رصيد فحوصات', 'انتهى اشتراكك، يرجى التجديد', 'تعذّر توليد كود فريد'].includes(CREATE_SESSION_INTERNAL_ERROR_MESSAGE),
    '[٣] رسالة جديدة مستقلّة — لا إعادة استعمال خاطئ لرسالة رفض محدَّدة أخرى');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — سجلّ الخادم (sanitizedForLog): مُنقّى فعلاً — القاعدة 36 — سيناريو
//     حقيقي (مفتاح API داخل رسالة خطأ شبكة).
// ═══════════════════════════════════════════════════════════════════════
{
  const rawError = new Error('DeepSeek request failed: api_key: sk-REALSECRETVALUE1234567890 was rejected');
  const {sanitizedForLog} = wrapUnexpectedCreateSessionError(rawError);
  ok(!sanitizedForLog.includes('sk-REALSECRETVALUE1234567890'),
      '[٤][الأهمّ] المفتاح الحقيقي لا يظهر في النصّ المُسجَّل حتى في سجلّ الخادم');
  ok(sanitizedForLog.includes('[KEY-REDACTED]'), '[٤] العلامة الثابتة لتنقية المفاتيح حاضرة بدلاً من القيمة (sanitizeRawText، مصدر واحد)');
}

// ═══════════════════════════════════════════════════════════════════════
// ٥ — أشكال خطأ غير Error عادية (نصّ خام، undefined.message) — لا رمي
//     داخل الدالّة نفسها (القاعدة 22 — لا انهيار عند معالجة خطأ آخر).
// ═══════════════════════════════════════════════════════════════════════
{
  const {httpsError, sanitizedForLog} = wrapUnexpectedCreateSessionError('a bare string thrown, not an Error instance');
  eq(httpsError.message, CREATE_SESSION_INTERNAL_ERROR_MESSAGE, '[٥] نصّ خام مرميّ مباشرة (لا Error) — لا يزال يُنتج الرسالة الثابتة');
  ok(sanitizedForLog.includes('a bare string thrown'), '[٥] String(error) يُستعمَل حين لا .message');

  const {httpsError: httpsError2} = wrapUnexpectedCreateSessionError(null);
  eq(httpsError2.message, CREATE_SESSION_INTERNAL_ERROR_MESSAGE, '[٥-ب] error=null — لا رمي، لا يزال يُنتج الرسالة الثابتة');
}

console.log(`createScanSessionErrorHandling.test.js: ${n}/${n} assertions passed`);
