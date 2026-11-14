'use strict';

// v7ResolveReportEnabledWiring.test.js — أمر مستخدم 2026-09-23 +03، القرار ٤
// (الوصل)، ثم أمر التبديل 2026-09-23 +03 بعد A125 (القاعدة 23 — الاختبار
// الذي يختبر الراية يُستبدَل، لا يُترَك يفشل).
//
// **الراية v7ResolveReportEnabled حُذفت بالكامل** (المعامل، الافتراض،
// والنداء الظلّي الذي كانت تحرسه — أمر التبديل، نصّه: "لا راية تُعيد
// النداء المزدوج"). لم يعد هناك "قبل/بعد الضبط" لاختباره — resolveV7Report
// هي المسار الوحيد دائماً، وcallAI (V6) لا يُستدعى أبداً، بصرف النظر عمّا
// يُمرَّر (حتى لو مُرِّر v7ResolveReportEnabled صراحة — أصبح مفتاحاً غير
// معروف، يُتجاهَل بلا أثر). هذا الملفّ يُثبت هذا الثبات مباشرة.
//
// اسم الملفّ أُبقي كما هو (لا نقل تاريخ الاختبار — القاعدة 8 بالمعنى،
// وإن لم يكن تقريراً) رغم أن موضوعه تغيّر: كان "هل الراية تعمل؟"، وصار
// "الراية غائبة إلى الأبد — أثبت ذلك".
//
// كعبان فقط: require.cache لِـ./resolveV7Report و./callAI (كلاهما
// تستوردهما runAnalysisInternal.js مباشرة) — صفر شبكة حقيقية، صفر
// Firestore.
//
// Run: node functions/test/v7ResolveReportEnabledWiring.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── كعوب — قبل أي require لـrunAnalysisInternal.js ────────────────────
const resolveV7ReportPath = require.resolve('../src/analysis/resolveV7Report');
const callAIPath = require.resolve('../src/analysis/callAI');
const adminPath = require.resolve('../src/utils/admin');

let resolveV7ReportCalls = 0;
let callAICalls = 0;

require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};
require.cache[resolveV7ReportPath] = {
  id: resolveV7ReportPath, filename: resolveV7ReportPath, loaded: true,
  exports: {
    resolveV7Report: async () => {
      resolveV7ReportCalls++;
      return {
        display: {overall: {letter: 'B'}, narrativeIncomplete: false, narrativeIncompleteFields: []},
        audit: {gatesApplied: [], adjustments: [], regeneration: {attempts: 1, rounds: []}},
        aiModel: 'stub', duration: 1, pipeline: 'v7_findings_based', bodyBuildMs: 1,
        guardFinal: {ok: true}, rawResponseLog: [],
      };
    },
  },
};
// callAI (V6) — إن استُدعيت فهذا عطب في التبديل نفسه (المسار الميت يجب
// ألّا يُنفَّذ إطلاقاً). لا تُرمى فوراً — تُعدّ فقط، كي تُظهر رسالة الفشل
// "1 لا 0" الحقيقية بدل TRAP مبهمة لو وقع خطأ ما.
require.cache[callAIPath] = {
  id: callAIPath, filename: callAIPath, loaded: true,
  exports: {
    callAI: async () => { callAICalls++; return {aiAnalysis: {grade: 'B', score: 80}, aiModel: 'stub', duration: 1, pipeline: 'v6_raw_timeseries', bodyBuildMs: 1}; },
    promoteCategoryGrades: () => 0, applySeverityPenalty: () => ({oldScore: 80, newScore: 80, penalty: 0, criticals: 0, dangers: 0}),
    callAIv7: async () => { throw new Error('TRAP: callAIv7 must not be called directly — only via stubbed resolveV7Report'); },
    AI_ATTEMPT_NEEDED_MS_MAX: 185000,
    resolveAiAttemptNeededMs: async () => 185000,
  },
};

const {runAnalysisInternal} = require('../src/analysis/runAnalysisInternal');

const minimalFingerprint = {device: {}, timeSeries: {}, functionalResults: {}, manualResults: []};

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — استدعاء عادي (بلا أي مفتاح إضافي) → resolveV7Report وحدها تُستدعى.
  // ═══════════════════════════════════════════════════════════════════
  resolveV7ReportCalls = 0; callAICalls = 0;
  await runAnalysisInternal({
    fingerprint: minimalFingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
    scanContext: {scanId: 'wiring-test-1'},
  });
  eq(resolveV7ReportCalls, 1, '[١] resolveV7Report استُدعيت مرّة واحدة بالضبط');
  eq(callAICalls, 0, '[١] callAI (V6) = 0 — لا تُستدعى أبداً بعد التبديل');
  console.log('تحقّق ١: استدعاء عادي ← resolveV7Report=1، callAI(V6)=0');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — تمرير v7ResolveReportEnabled=true صراحة (مفتاح محذوف — يُتجاهَل
  // بلا أثر، لا يُضاعف النداء) → نفس نتيجة ١ بالضبط. يُثبت غياب أي مسار
  // يُعيد النداء المزدوج المرفوض بـ21a813b.
  // ═══════════════════════════════════════════════════════════════════
  resolveV7ReportCalls = 0; callAICalls = 0;
  await runAnalysisInternal({
    fingerprint: minimalFingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
    scanContext: {scanId: 'wiring-test-2'},
    v7ResolveReportEnabled: true, // مفتاح محذوف — يجب ألّا يُغيّر شيئاً
  });
  eq(resolveV7ReportCalls, 1, '[٢] مفتاح محذوف مُمرَّر ← لا أثر، resolveV7Report=1 كالمعتاد (لا نداء مزدوج)');
  eq(callAICalls, 0, '[٢] callAI (V6) = 0 — يبقى صفراً حتى مع تمرير المفتاح القديم');
  console.log('تحقّق ٢: v7ResolveReportEnabled=true (مفتاح محذوف) ← بلا أثر، صفر نداء مزدوج');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — v7ResolveReportEnabled=false صراحة — نفس النتيجة أيضاً (المفتاح
  // ميت بكلا قيمتيه).
  // ═══════════════════════════════════════════════════════════════════
  resolveV7ReportCalls = 0; callAICalls = 0;
  await runAnalysisInternal({
    fingerprint: minimalFingerprint, language: 'ar', deepseekKey: 'k', geminiKey: 'g',
    scanContext: {scanId: 'wiring-test-3'},
    v7ResolveReportEnabled: false,
  });
  eq(resolveV7ReportCalls, 1, '[٣] v7ResolveReportEnabled=false (مفتاح محذوف) ← لا فرق، resolveV7Report=1');
  eq(callAICalls, 0, '[٣] callAI (V6) = 0');
  console.log('تحقّق ٣: v7ResolveReportEnabled=false (مفتاح محذوف) ← نفس نتيجة ١ و٢ بالضبط');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — المعامل نفسه غير موجود في توقيع الدالّة (فحص مصدر مباشر، لا
  // افتراض). الفحص على كود حيّ فقط — تعليقات تُوثِّق الحذف تاريخياً مقصودة
  // وتبقى (نفس نمط bodyBuildMsField.test.js لـprecomputeMs).
  // ═══════════════════════════════════════════════════════════════════
  {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'analysis', 'runAnalysisInternal.js'), 'utf8');
    const liveCode = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    ok(!/\bv7ResolveReportEnabled\b/.test(liveCode),
        '[٤] v7ResolveReportEnabled غائبة عن الكود الحيّ في runAnalysisInternal.js — لا معامل، لا افتراضي (التعليقات التاريخية مستثناة عمداً)');
  }
  console.log('تحقّق ٤: v7ResolveReportEnabled غائبة عن الكود الحيّ');

  console.log(`\nv7ResolveReportEnabledWiring.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
