'use strict';

// measureLiveScriptNetworkGuard.test.js — أمر مستخدم 2026-09-23 +03 (بعد
// A125)، البند ٤: "بعد الفصل يدخل المجموعةَ اختبارا السقف والتنقية، وهما
// يحرسان القاعدتين 35 و36... السقف: يُعَدّ عند نقطة الخروج، أي مُركِّب
// fetch الحقيقي، لا عند استدعاء داخلي. التنقية: جسم خطأ على شكل 401 يحمل
// ذيل مفتاح، بمفتاح وهمي لا الحقيقي... والاختباران لا يستبدلان الطبقة
// التي يفحصانها (القاعدة 37)."
//
// هذا الملفّ **لا يستبدل global.fetch بنفسه** — يستدعي
// scripts/measure-resolveV7Report-live.js (الآن وحدة قابلة للاستيراد،
// القاعدة 37 بعد فصلها في هذا الدور) فيُثبِّت هو مُركِّب fetch الحقيقي
// الخاصّ به (السقف + التنقية معاً، مُركَّبان في نفس الغلاف — راجع تعليق
// القاعدتين 35/36 داخل الملفّ نفسه)، ثم يستدعي global.fetch مباشرة —
// بالضبط كما يفعل السكربت في اختباريه الداخليين (السقف/التنقية) في
// --simulate، لا بنسخة مُعاد بناؤها هنا.
//
// process.argv يحمل --simulate **قبل** require() كي يُقرأ SIMULATE=true
// عند تحميل الوحدة (argv ثابت يُحسَب مرّة واحدة عند التحميل في الملفّ
// المطلوب) — بلا هذا، الفرع غير-المُحاكى (نداء حقيقي) كان سيُنفَّذ.
//
// Run: node functions/test/measureLiveScriptNetworkGuard.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── فخّ Firestore القياسي — احتياط (هذا الملفّ لا يستدعي resolveV7Report
// فلا يلزمه Firestore فعلياً، لكن require السلسلة الإنتاجية الكاملة قد
// يُنشئ عميل Firestore عند التحميل — نفس نمط بقيّة السويت) ───────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

if (!process.argv.includes('--simulate')) process.argv.push('--simulate');
const measureLive = require('../scripts/measure-resolveV7Report-live');
const {
  MAX_NETWORK_REQUESTS, ALLOWED_HOST, refreshKeyFragments,
  getNetworkRequestCount, getNetworkLog, resetNetworkGuardState, setSimulatedQueue,
} = measureLive;

eq(ALLOWED_HOST, 'api.deepseek.com', 'ALLOWED_HOST مُصدَّرة وصحيحة');

// ═══════════════════════════════════════════════════════════════════════
// ١ — التنقية (القاعدة 36): 401 بذيل مفتاح **وهمي**، لا الحقيقي — يُبنى
// من process.env مؤقّتاً (نفس آلية اختبار التنقية الداخلي في السكربت).
// ═══════════════════════════════════════════════════════════════════════
(async () => {
  resetNetworkGuardState();
  const FAKE_KEY_TAIL = 'qX7z';
  const realKeyEnv = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = `sk-simulated-not-real-0000000000${FAKE_KEY_TAIL}`;
  refreshKeyFragments();

  const errEnvelope = {error: {
    message: `Authentication Fails, Your api key: ****${FAKE_KEY_TAIL} is invalid`,
    type: 'authentication_error', code: 'invalid_request_error',
  }};
  setSimulatedQueue([new Response(JSON.stringify(errEnvelope), {status: 401, headers: {'content-type': 'application/json'}})]);

  let capturedLog = '';
  const realConsoleError = console.error;
  const realConsoleLog = console.log;
  const realConsoleWarn = console.warn;
  console.error = (...args) => { capturedLog += args.join(' ') + '\n'; realConsoleError.apply(console, args); };
  console.log = (...args) => { capturedLog += args.join(' ') + '\n'; realConsoleLog.apply(console, args); };
  console.warn = (...args) => { capturedLog += args.join(' ') + '\n'; realConsoleWarn.apply(console, args); };

  try {
    // نقطة الخروج الحقيقية — نداء fetch مباشر، لا عبر غلاف اختبارنا.
    await global.fetch('https://api.deepseek.com/chat/completions', {method: 'POST', body: '{}'});
  } catch (e) { /* لا رمي متوقَّع على 401 — fetch لا يرمي على 4xx/5xx */ }

  console.error = realConsoleError;
  console.log = realConsoleLog;
  console.warn = realConsoleWarn;
  process.env.DEEPSEEK_API_KEY = realKeyEnv;
  refreshKeyFragments();

  const lastEntry = getNetworkLog()[getNetworkLog().length - 1];
  ok(lastEntry, '[١] نقطة الخروج سجَّلت الطلب (networkLog غير فارغ)');
  ok(lastEntry && lastEntry.errorMessageSanitized, '[١] errorMessageSanitized حاضر');
  ok(lastEntry && lastEntry.errorMessageSanitized && !lastEntry.errorMessageSanitized.includes(FAKE_KEY_TAIL),
      `[١] ذيل المفتاح الوهمي "${FAKE_KEY_TAIL}" لا يظهر في errorMessageSanitized المكتوب — ${lastEntry && lastEntry.errorMessageSanitized}`);
  ok(!capturedLog.includes(FAKE_KEY_TAIL),
      `[١] ذيل المفتاح الوهمي لا يظهر في أي console.log/error/warn مُلتقَط أثناء النداء`);
  console.log(`تحقّق ١: التنقية — ذيل مفتاح وهمي "${FAKE_KEY_TAIL}" لا يظهر لا في errorMessageSanitized المكتوب ولا في المطبوع (القاعدة 36، عبر مُركِّب fetch الحقيقي لا نسخة الاختبار)`);

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — السقف (القاعدة 35): يُعَدّ عند نداء fetch نفسه (نقطة الخروج)، لا
  // عند أي استدعاء داخلي أعلى في السلسلة. MAX_NETWORK_REQUESTS طلباً
  // تمرّ، والطلب التالي يُرفض قبل أي استهلاك من الطابور.
  // ═══════════════════════════════════════════════════════════════════
  resetNetworkGuardState();
  const okEnvelope = {model: 'deepseek-flash', choices: [{finish_reason: 'stop'}], usage: {}};
  setSimulatedQueue(Array.from({length: MAX_NETWORK_REQUESTS},
      () => new Response(JSON.stringify(okEnvelope), {status: 200, headers: {'content-type': 'application/json'}})));

  const results = [];
  for (let i = 1; i <= MAX_NETWORK_REQUESTS + 1; i++) {
    try {
      await global.fetch('https://api.deepseek.com/chat/completions', {method: 'POST', body: '{}'});
      results.push({seq: i, blocked: false});
    } catch (e) {
      results.push({seq: i, blocked: true, reason: String(e.message || e)});
    }
  }
  eq(results.slice(0, MAX_NETWORK_REQUESTS).filter((r) => r.blocked).length, 0,
      `[٢] أوّل ${MAX_NETWORK_REQUESTS} طلباً مرّت فعلياً بلا حجب`);
  eq(results[MAX_NETWORK_REQUESTS].blocked, true, `[٢] الطلب رقم ${MAX_NETWORK_REQUESTS + 1} حُجب قبل الإرسال`);
  ok(/CAP_REACHED/.test(results[MAX_NETWORK_REQUESTS].reason), '[٢] سبب الحجب CAP_REACHED صراحة');
  eq(getNetworkRequestCount(), MAX_NETWORK_REQUESTS, `[٢] العدّاد عند نقطة الخروج توقّف عند ${MAX_NETWORK_REQUESTS} بالضبط — الطلب المحجوب لم يُحتسَب`);
  console.log(`تحقّق ٢: السقف — ${MAX_NETWORK_REQUESTS} طلباً مرّت، رقم ${MAX_NETWORK_REQUESTS + 1} حُجب بـCAP_REACHED عند نقطة الخروج (fetch نفسه)`);

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — ضابط: مضيف غير مسموح يُحجب أيضاً عند نقطة الخروج (نفس المُركِّب).
  // ═══════════════════════════════════════════════════════════════════
  resetNetworkGuardState();
  let blockedHost = null;
  try {
    await global.fetch('https://generativelanguage.googleapis.com/v1/models', {method: 'POST'});
  } catch (e) { blockedHost = String(e.message || e); }
  ok(blockedHost && /محجوب|HOST_NOT_ALLOWED/.test(blockedHost), `[٣-ضابط] مضيف غير DeepSeek يُحجب عند نقطة الخروج — ${blockedHost}`);
  console.log('تحقّق ٣: ضابط — مضيف غير مسموح (Gemini) يُحجب عند نداء fetch نفسه، لا فرق عن الحقيقي');

  console.log(`\nmeasureLiveScriptNetworkGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
