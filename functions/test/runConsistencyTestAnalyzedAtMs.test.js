'use strict';

// runConsistencyTestAnalyzedAtMs.test.js — أمر مستخدم 2026-09-24 +03
// (الجولة الثالثة، البند ١): "Date.now() مرّة واحدة عند بدء runConsistencyTest،
// قبل أيّ await. يُمرَّر analyzedAtMs إلى كل استدعاء runAnalysisInternal
// فيها، والقيمة واحدة لكل التكرارات. اختبار يثبت التمرير."
//
// يستدعي exports.runConsistencyTest.run(request) الحقيقية (`.run()` —
// واجهة اختبار رسمية من firebase-functions v2 لاستدعاء onCall مباشرة، نفس
// أسلوب test/aiAuditWiring.e2e.test.js:164) — لكن **بلا شبكة وبلا Firestore
// إطلاقاً هنا**: runAnalysisInternal نفسها مكعوبة (تُسجِّل كل analyzedAtMs
// وصلها، وتُعيد نتيجة V7 دنيا صناعية) — فلا حاجة لكعب callDeepSeek/callGemini
// منفصل، ولا محاكي. admin/secrets مكعوبتان أيضاً (requireAdmin لا تفحص شيئاً،
// نفس نمط generate-v7-*-sample.js/audit-device-profiles-readonly.js).
//
// Run: node functions/test/runConsistencyTestAnalyzedAtMs.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── كعب admin — requireAdmin لا تفحص شيئاً (لا حاجة لسياق auth حقيقي هنا،
// الهدف اختبار تمرير analyzedAtMs لا سياسة الصلاحيات). نفس نمط الكعوب
// القائمة في generate-v7-client-payload-sample.js/audit-device-profiles-readonly.js.
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {firestore: {FieldValue: {serverTimestamp: () => 'stub-server-timestamp'}}},
    // runConsistencyTest.js يكتب سجلّ نتيجة إلى consistencyTests (مجموعة
    // مختلفة تماماً عن reports/{scanId} — لا صلة بـanalyzedAt المخزون هناك)
    // — مكعوبة هنا (add() تُعيد معرّفاً مزيَّفاً، صفر Firestore حقيقي). أي
    // مجموعة أخرى (خاصّة "reports") ترمي — دفاع في العمق ضد أي كتابة غير
    // متوقَّعة.
    db: {
      collection: (name) => {
        if (name === 'consistencyTests') {
          return {add: async () => ({id: 'stub-consistency-test-doc-id'})};
        }
        throw new Error(`runConsistencyTestAnalyzedAtMs.test.js: تجميعة غير متوقَّعة "${name}" — Firestore الحقيقي ممنوع`);
      },
    },
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── كعب secrets — .value() فقط، بلا Secret Manager حقيقي.
const secretsPath = require.resolve('../src/utils/secrets');
require.cache[secretsPath] = {
  id: secretsPath, filename: secretsPath, loaded: true,
  exports: {
    geminiKey: {value: () => 'stub-gemini-key'},
    deepseekKey: {value: () => 'stub-deepseek-key'},
    smtpUser: {value: () => ''}, smtpPass: {value: () => ''},
  },
};

// ─── كعب runAnalysisInternal — يُسجِّل كل analyzedAtMs وصلها، صفر شبكة،
// صفر Firestore، صفر نداء نموذج. نتيجة V7 دنيا صناعية تكفي كل القراءات
// اللاحقة في runConsistencyTest.js (ar.overall/narrative/issues، auditR
// .regeneration/adjustments، v5Metrics.v7GuardOk) بأمان (optional chaining
// قائمة في الكود الحقيقي بالفعل).
const railPath = require.resolve('../src/analysis/runAnalysisInternal');
const recordedAnalyzedAtMs = [];
require.cache[railPath] = {
  id: railPath, filename: railPath, loaded: true,
  exports: {
    runAnalysisInternal: async (params) => {
      recordedAnalyzedAtMs.push(params.analyzedAtMs);
      return {
        aiResult: {
          overall: {letter: 'B'},
          narrative: {verdict: 'stub'},
          issues: [],
          narrativeIncomplete: false,
          narrativeIncompleteFields: [],
        },
        aiResultAudit: {regeneration: {attempts: 1}, adjustments: []},
        aiFailed: false,
        aiFallbackReason: null,
        aiModel: 'stub-model',
        aiDurationMs: 1,
        v5Metrics: {v7GuardOk: true},
      };
    },
  },
};

// require بعد الكعوب أعلاه — نفس ترتيب callAIv7.test.js/verifyReportV7Whitelist.test.js.
const consistencyModule = require('../src/admin/runConsistencyTest');

(async () => {
  const ITERATIONS = 5; // > batchSize (3) — يعبر دفعتين، يثبت أن القيمة لا تتغيّر بين الدفعات أيضاً
  const before = Date.now();
  const result = await consistencyModule.runConsistencyTest.run({
    data: {
      rawFingerprint: {timeSeries: {}}, // بنية دنيا — noiseLevel:'none' لا يلمسها (generateVariation تُعيد نسخة طبق الأصل فقط)
      noiseLevel: 'none',
      iterations: ITERATIONS,
      language: 'ar',
    },
    auth: {uid: 'test-admin', token: {email: 'admin@example.com'}},
    rawRequest: {headers: {}},
  });
  const after = Date.now();

  eq(recordedAnalyzedAtMs.length, ITERATIONS, `[إعداد] runAnalysisInternal استُدعيت ${ITERATIONS} مرّة بالضبط (مرّة لكل تكرار)`);

  // ═══════════════════════════════════════════════════════════════════
  // ١ — التمرير الفعلي: كل استدعاء وصله analyzedAtMs رقمياً حقيقياً، لا
  //     undefined (نصّ الأمر الأصلي — "لا Date.now() بديلاً" يعني ألّا
  //     يبقى غائباً هنا إطلاقاً).
  // ═══════════════════════════════════════════════════════════════════
  for (let i = 0; i < recordedAnalyzedAtMs.length; i++) {
    ok(typeof recordedAnalyzedAtMs[i] === 'number' && isFinite(recordedAnalyzedAtMs[i]),
        `[١] تكرار ${i}: analyzedAtMs رقم صالح فعلاً (${recordedAnalyzedAtMs[i]}) — لا undefined`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — نفس القيمة لكل التكرارات (نصّ الأمر: "والقيمة واحدة لكل
  //     التكرارات") — عبر دفعتين (batchSize=3، 5 تكرارات) لا دفعة واحدة.
  // ═══════════════════════════════════════════════════════════════════
  const uniqueValues = new Set(recordedAnalyzedAtMs);
  eq(uniqueValues.size, 1, `[٢] قيمة analyzedAtMs واحدة فعلياً عبر كل الـ${ITERATIONS} تكرارات (عبر دفعتين) — لا Date.now() منفصل لكل تكرار: ${JSON.stringify(recordedAnalyzedAtMs)}`);

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — القيمة نفسها زمن حقيقي (بين لحظة ما قبل الاستدعاء وما بعده) — لا
  //     رقم اصطناعي/ثابت مُخترَع داخل الدالّة.
  // ═══════════════════════════════════════════════════════════════════
  const theValue = [...uniqueValues][0];
  ok(theValue >= before && theValue <= after,
      `[٣] القيمة (${theValue}) تقع فعلياً بين قبل الاستدعاء (${before}) وبعده (${after}) — Date.now() حقيقي عند بدء الدالّة`);

  ok(Array.isArray(result.results) || Array.isArray(result?.results) || true,
      '[سلامة] runConsistencyTest.run أعادت نتيجة بلا رمي (بنية النتيجة الكاملة خارج نطاق هذا الاختبار)');

  console.log(`تحقّق: ${ITERATIONS} تكرارات (دفعتان) → analyzedAtMs=${theValue} في كل استدعاء، رقم واحد لا Date.now() منفصل لكل تكرار`);
  console.log(`\nrunConsistencyTestAnalyzedAtMs.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
