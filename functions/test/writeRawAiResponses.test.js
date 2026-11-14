'use strict';

// writeRawAiResponses.test.js — أمر مستخدم 2026-09-23 +03، القرار ٤: "الخام
// في مجموعة منفصلة يكتبها الخادم وحده... اختبار بكاتب Firestore محقون، لا
// بالمحاكي: الخام يُكتب في المجموعة المنفصلة وحدها، ومستند reports وaiAudit
// خاليان منه."
//
// كاتب Firestore محقون (require.cache على utils/admin) — لا محاكي
// (firebase emulators)، بلا شبكة، بلا Firestore حقيقي.
//
// Run: node functions/test/writeRawAiResponses.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── كاتب Firestore محقون — يسجّل كل استدعاء (collection/doc/set) ───────
let writeLog = []; // [{collection, docId, data}]
let shouldThrow = false;
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'SERVER_TIMESTAMP_SENTINEL'}}},
    db: {
      collection: (name) => ({
        doc: (docId) => ({
          set: async (data) => {
            if (shouldThrow) throw new Error('injected-write-failure');
            writeLog.push({collection: name, docId, data});
          },
        }),
      }),
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {writeRawAiResponses, sanitizeRawText, RAW_RESPONSES_COLLECTION} = require('../src/analysis/writeRawAiResponses');

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — كتابة ناجحة: تصل aiRawResponses/{scanId} وحدها، بالحقول المطلوبة.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = []; shouldThrow = false;
  const rawResponseLog = [
    {attempt: 1, rawResponseText: 'رد خام ١', rawResponseProvider: 'deepseek', durationMs: 1234},
    {attempt: 2, rawResponseText: 'رد خام ٢', rawResponseProvider: 'gemini', durationMs: 5678},
  ];
  const result1 = await writeRawAiResponses('scan-abc', rawResponseLog);
  eq(result1.written, true, '[١] الكتابة نجحت');
  eq(writeLog.length, 1, '[١] كتابة واحدة فقط (مستند واحد لكل الفحص)');
  eq(writeLog[0].collection, RAW_RESPONSES_COLLECTION, '[١] المجموعة aiRawResponses بالضبط');
  eq(writeLog[0].docId, 'scan-abc', '[١] معرِّف المستند = scanId');
  eq(writeLog[0].data.attempts.length, 2, '[١] محاولتان مُسجَّلتان');
  deepEq(writeLog[0].data.attempts[0], {attempt: 1, raw: 'رد خام ١', provider: 'deepseek', durationMs: 1234},
      '[١] المحاولة١: رقمها + الخام + المزوّد + الوقت (نصّ المستخدم حرفياً)');
  deepEq(writeLog[0].data.attempts[1], {attempt: 2, raw: 'رد خام ٢', provider: 'gemini', durationMs: 5678},
      '[١] المحاولة٢ كذلك');
  eq(writeLog[0].data.writtenAt, 'SERVER_TIMESTAMP_SENTINEL', '[١] وقت الكتابة serverTimestamp حقيقي');
  console.log('تحقّق ١: كتابة ناجحة — aiRawResponses/{scanId} وحدها، بكل الحقول المطلوبة');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — التنقية (القاعدة 36): لا طرف مفتاح في الخام المكتوب.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = [];
  const FAKE_KEY_TAIL = 'zQ9x';
  const dirtyLog = [{attempt: 1, rawResponseText: `نصّ عادي api key: ****${FAKE_KEY_TAIL} نصّ بعده`, rawResponseProvider: 'deepseek', durationMs: 100}];
  await writeRawAiResponses('scan-dirty', dirtyLog);
  ok(!writeLog[0].data.attempts[0].raw.includes(FAKE_KEY_TAIL), '[٢] الطرف لا يظهر في الخام المكتوب');
  ok(writeLog[0].data.attempts[0].raw.includes('[KEY-REDACTED]'), '[٢] عُلِّم بديلاً واضحاً بدل الطرف');
  eq(sanitizeRawText(null), null, '[٢-مباشر] sanitizeRawText(null)=null — لا رمي على مدخل غير نصّي');
  console.log('تحقّق ٢: التنقية — لا طرف مفتاح في الخام المكتوب فعلياً');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — فشل الكتابة لا يُسقط الفحص: written:false بسبب مُسمّى، لا رمي.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = []; shouldThrow = true;
  let threw3 = null; let result3 = null;
  try {
    result3 = await writeRawAiResponses('scan-fail', rawResponseLog);
  } catch (e) { threw3 = e; }
  shouldThrow = false;
  ok(!threw3, `[٣] writeRawAiResponses لا ترمي حتى عند فشل الكاتب المحقون (${threw3 && threw3.message})`);
  eq(result3.written, false, '[٣] written=false');
  ok(result3.reason && result3.reason.includes('injected-write-failure'), '[٣] سبب الفشل الحقيقي مُسجَّل، لا مبتلَع صامتاً');
  console.log('تحقّق ٣: فشل الكتابة لا يُسقط الفحص — written:false بسبب مُسمّى، لا رمي');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — لا بيانات (rawResponseLog فارغة/غائبة) → لا كتابة إطلاقاً.
  // ═══════════════════════════════════════════════════════════════════
  writeLog = [];
  const result4a = await writeRawAiResponses('scan-empty', []);
  const result4b = await writeRawAiResponses('scan-empty', undefined);
  eq(result4a.written, false, '[٤أ] rawResponseLog فارغة — لا كتابة');
  eq(result4b.written, false, '[٤ب] rawResponseLog غائبة — لا كتابة');
  eq(writeLog.length, 0, '[٤] صفر استدعاء كتابة فعلي في كلتا الحالتين');
  console.log('تحقّق ٤: لا بيانات ← لا كتابة إطلاقاً (لا مستند فارغ يُكتب)');

  console.log(`\nwriteRawAiResponses.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
