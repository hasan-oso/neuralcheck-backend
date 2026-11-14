'use strict';

// verifyReportLimits.test.js — حدّ المعدّل وكتم تفاصيل الخطأ
// (fix/verify-report-limits).
//
// verifyReport مسار عام بلا مصادقة ولا App Check، ويُرجع نصّ التقرير كاملاً
// لمن يعرف scanId أو shortId. المساحة 2^32 تجعل التخمين الأعمى عبثاً، لكن
// لا شيء كان يمنع سحباً آلياً لقائمة معرّفات معروفة، ولا يمنع الإغراق —
// والدالّة عامة، فالإغراق فاتورة مفتوحة.
//
// الحدّ في ذاكرة النسخة لا في Firestore: عدّاد في Firestore يضيف كتابةً لكل
// طلب، فيصير مسار الإساءة هو نفسه مسار الكلفة. الثمن أن الحدّ لكل نسخة —
// ولذلك maxInstances منخفض عمداً، فهو نصف الحماية لا سقف كلفة وحسب.
//
// Run: node functions/test/verifyReportLimits.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'reports', 'verifyReport.js');
const src = fs.readFileSync(SRC, 'utf8');

// نستخرج الدوالّ الخالصة من المصدر: الملفّ يُصدّر onRequest فقط، وتحميله
// يتطلّب بيئة Cloud Functions. ما يهمّنا هنا منطق خالص لا إطار.
const pure = src.slice(
    src.indexOf('function callerIp('),
    src.indexOf('exports.verifyReport'));
const {callerIp, rateLimited, RATE_LIMIT_PER_IP} = new Function(
    'const RATE_LIMIT_PER_IP = ' +
      /const RATE_LIMIT_PER_IP = (\d+);/.exec(src)[1] + ';' +
    'const RATE_WINDOW_MS = ' +
      /const RATE_WINDOW_MS = ([\d_]+);/.exec(src)[1].replace(/_/g, '') + ';' +
    'const hits = new Map();' +
    pure +
    'return {callerIp, rateLimited, RATE_LIMIT_PER_IP};')();

// ─── 1. الإعدادات مضبوطة على الدالّة نفسها ───────────────────────────
{
  const opts = src.slice(src.indexOf('exports.verifyReport = onRequest'),
      src.indexOf('async (req, res)'));
  assert.ok(/maxInstances:/.test(opts), 'maxInstances must be set');
  assert.ok(/concurrency:/.test(opts), 'concurrency must be set');

  const maxI = Number(/const MAX_INSTANCES = (\d+);/.exec(src)[1]);
  const conc = Number(/const CONCURRENCY = (\d+);/.exec(src)[1]);

  // السقف منخفض عمداً: العدّاد لكل نسخة، فكل نسخة إضافية تُضاعف ما يمرّ
  // لعنوان واحد. maxInstances هنا جزء من الحدّ لا سقف كلفة فقط.
  assert.ok(maxI > 0 && maxI <= 5,
      'maxInstances must stay small — it multiplies the per-instance limit');
  assert.ok(conc > 0 && conc <= 80, 'concurrency within the platform default');

  // السقف الفعلي لعنوان واحد، معلَناً لا مستنتَجاً.
  assert.strictEqual(maxI * RATE_LIMIT_PER_IP, 90,
      'the stated worst case for one IP is maxInstances × per-instance limit');
}

// ─── 2. العنوان يُقرأ من x-forwarded-for أولاً ───────────────────────
// خلف موازن جوجل، req.ip قد يكون عنوان الموازن. لو أخذناه لصار كل الزوّار
// عنواناً واحداً — فيُحدّ الجميع معاً، أو لا يُحدّ أحد.
{
  assert.strictEqual(
      callerIp({headers: {'x-forwarded-for': '203.0.113.7, 70.41.3.18'},
        ip: '10.0.0.1'}),
      '203.0.113.7', 'the first XFF entry is the caller');
  assert.strictEqual(callerIp({headers: {}, ip: '10.0.0.1'}), '10.0.0.1',
      'req.ip is the fallback');
  assert.strictEqual(callerIp({headers: {'x-forwarded-for': '  '}, ip: null}),
      'unknown', 'a blank header must not become a shared empty key');
}

// ─── 3. الحدّ يسمح بالاستعمال البشري ويقف عند الآلي ──────────────────
{
  const ip = '198.51.100.5';
  for (let i = 0; i < RATE_LIMIT_PER_IP; i++) {
    assert.strictEqual(rateLimited(ip).limited, false,
        `request ${i + 1} of the allowance must pass`);
  }
  const over = rateLimited(ip);
  assert.strictEqual(over.limited, true,
      'the request after the allowance must be refused');
  assert.ok(over.retryAfterSec >= 1 && over.retryAfterSec <= 60,
      'Retry-After must be a usable number of seconds');

  // عنوان آخر لا يتأثّر — وإلا صار طالبٌ واحد قادراً على حجب الجميع.
  assert.strictEqual(rateLimited('198.51.100.6').limited, false,
      'the limit is per caller, not global');
}

// ─── 4. الاستجابة عند التجاوز ────────────────────────────────────────
{
  const gate = src.slice(src.indexOf('const rl = rateLimited(ip)'),
      src.indexOf('const scanId'));
  assert.ok(/status\(429\)/.test(gate), '429 is the correct status');
  assert.ok(/Retry-After/.test(gate), 'Retry-After must be sent');
  assert.ok(/error: "rate_limited"/.test(gate),
      'the body must name the reason without leaking the limit internals');
  assert.ok(/console\.warn/.test(gate),
      'a refusal must be logged, or the limit is invisible in production');

  // الحدّ قبل أي قراءة من Firestore — وإلا دفعنا ثمن الطلب الذي نرفضه.
  assert.ok(src.indexOf('const rl = rateLimited(ip)') <
      src.indexOf('db.collection("reports")'),
  'the gate must precede the first Firestore read');
}

// ─── 5. تفاصيل الخطأ لا تغادر الخادم ─────────────────────────────────
{
  const block = src.slice(src.indexOf('} catch (error) {'));
  assert.ok(!/message: error\.message/.test(block),
      'error.message must no longer be returned to the caller');
  assert.ok(/errorId/.test(block), 'a correlation id must replace it');
  assert.ok(/error\.stack/.test(block),
      'the stack must go to the log, where it is useful');
  assert.ok(/res\.status\(500\)\.json\(\{error: "server_error", errorId\}\)/
      .test(block), 'the client gets a generic body plus the id only');
}

console.log('verifyReportLimits: 5/5 sections passed');
