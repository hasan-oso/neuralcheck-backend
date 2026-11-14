'use strict';

// rawResponseCapture.test.js — أمر مستخدم 2026-09-23 +03، القرار ٢، مُصحَّح
// بأمر لاحق: "لا تكتب الخام في مستند التقرير... تأكّد باختبار أن ما يُبنى
// لـaiAudit لا يحمل الخام."
//
// السبب: NeuralChek (FirebaseAnalysisService.kt) يقرأ مستند التقرير كاملاً
// من Firestore مباشرة (لا عبر verifyReport)، وwepsite يعرض المستند خاماً في
// <pre>. firestore.rules: reports/{scanId} يسمح بالقراءة الكاملة لصاحب
// الفحص (userId==auth.uid) ولأي مستخدم مسجَّل حين listingStatus معروض/مباع.
// فأي حقل يصل مستند Firestore يصل جهاز المشتري فعلياً، بصرف النظر عمّا
// يعرضه التطبيق. لذا: النصّ الخام يُلتقَط لكنه **لا يلمس audit إطلاقاً**
// (لا rounds[]، لا audit.regeneration) — حقل شقيق مستقلّ rawResponseLog في
// resolveV7Report فقط، لا يقرؤه runAnalysisInternal.js ولا analyzeDevice.js.
//
// Run: node functions/test/rawResponseCapture.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// ١ — callDeepSeek مباشرة: جسم JSON معطوب حقيقي البنية (يُعيد إنتاج
// الحادثة الفعلية 2026-09-23 01:16 +03 حرفياً — jsonrepair ينتج كائناً
// بمفتاح واحد narrative من نصّ مبتور بعد إغلاق narrative مباشرة، قبل أن
// يبدأ crossChecks). الخام المُلتقَط يطابق ما أعاده fetch حرفاً بحرف؛
// الناتج المُصلَح (كائن بمفتاح واحد) مستقلّ عنه تماماً.
// ═══════════════════════════════════════════════════════════════════════
{
  // نفس نمط aiCallShape.test.js — كعب fetch فقط، callDeepSeek حقيقية.
  const CORRUPTED_CONTENT = '{"narrative":{"summary":"ملخّص فحص حقيقي البنية","details":"تفصيل حقيقي","verdict":"حكم","buyerAdvice":{"casual":"ن","gamer":"ن","photographer":"ن"},"issueDescriptions":{}}},';
  // ملاحظة: فاصلة زائدة في النهاية بعد الحاصرة الأخيرة — بالضبط نمط التلف
  // الحقيقي (بتر منتصف بناء الجملة، لا محاولة تعسّفية) المؤكَّد بتجربة
  // مباشرة: jsonrepair يُنتج {narrative:{...}} بمفتاح واحد فقط من هذا النصّ.
  const envelope = {
    model: 'deepseek-flash',
    choices: [{message: {content: CORRUPTED_CONTENT}, finish_reason: 'stop'}],
    usage: {completion_tokens: 100, completion_tokens_details: {reasoning_tokens: 50}},
  };
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => envelope,
    text: async () => JSON.stringify(envelope),
  });
  delete require.cache[require.resolve('../src/analysis/callDeepSeek')];
  const {callDeepSeek} = require('../src/analysis/callDeepSeek');
  const {V7_SHAPE_KEYS, V7_CORE_KEY_GROUPS} = require('../src/analysis/reportShapeV7');
  // V7_SHAPE_SPEC — نفس ما يمرّره callAIv7 فعلياً (البند السابق، القرار ١).
  // بلا هذا، {narrative} وحدها تُرفَض بـshape_invalid تحت مفاتيح V3/V5/V6
  // الافتراضية (لا "narrative" بينها) — وهذا صحيح لمسار V6، لكن غير ما
  // يختبره هذا القسم (استقلالية الخام عن الناتج المُصلَح، لا سياسة الرفض).
  const shapeSpec = {shapeKeys: V7_SHAPE_KEYS, coreKeyGroups: V7_CORE_KEY_GROUPS};

  const rawCapture = {text: null};
  (async () => {
    const repaired = await callDeepSeek('u', 's', 'k', undefined, shapeSpec, rawCapture);

    eq(rawCapture.text, CORRUPTED_CONTENT,
        '[١] rawCapture.text يطابق content كما أعاده fetch حرفاً بحرف — قبل jsonrepair وقبل أي تحويل');
    ok(!('crossChecks' in repaired) || repaired.crossChecks === undefined,
        '[١] الناتج المُصلَح لا يحمل crossChecks — إعادة إنتاج دقيقة للحادثة (كائن بمفتاح narrative وحده)');
    eq(Object.keys(repaired).join(','), 'narrative',
        '[١] الناتج المُصلَح: مفتاح واحد narrative بالضبط — مطابق للحادثة الحقيقية 2026-09-23 01:16 +03');
    ok(repaired.narrative && repaired.narrative.summary === 'ملخّص فحص حقيقي البنية',
        '[١] الناتج المُصلَح مستقلّ عن rawCapture.text (كائن مُحلَّل، لا نصّ) — القيمتان منفصلتان في الذاكرة');
    // استقلالية فعلية: تعديل أحدهما لا يمسّ الآخر (لا مرجع مشترك).
    repaired.narrative.summary = 'MUTATED';
    ok(rawCapture.text === CORRUPTED_CONTENT, '[١] تعديل الناتج المُصلَح لم يُغيّر rawCapture.text — لا مرجع مشترك');
    console.log('تحقّق ١: جسم JSON معطوب حقيقي البنية — الخام يطابق fetch حرفياً، والناتج المُصلَح مستقلّ عنه');

    await runTest2And3();
  })().catch((e) => { console.error('FATAL في تحقّق ١:', e.stack || e); process.exitCode = 1; });
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — عزل audit الكامل: تشغيل resolveV7Report فعلياً على جسم حقيقي مرفوض
// (b45c8cf6 23:39، "ot") مع علامة فريدة (canary) داخل المحتوى الخام، ثمّ
// التحقّق أن audit (تماماً ما سيُكتَب أيّاً كان تحت aiAudit لو اتّصل فرع V7
// يوماً بـ aiResultAudit) لا يحمل العلامة إطلاقاً — بينما rawResponseLog
// (الحقل الشقيق المنفصل) يحملها.
// ٣ — ضابط V6: callAI (ميت منذ التبديل، fd3a6ce — يُختبَر هنا مباشرة لا
// عبر runAnalysisInternal) بلا rawCapture — الشكل المُعاد لا يتغيّر، صفر
// حقل جديد.
// ═══════════════════════════════════════════════════════════════════════
async function runTest2And3() {
  const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
  const OUT_DIR = path.join(__dirname, '..', 'scripts', 'out');
  function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
  function loadLive(name) { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8')); }

  const adminPath = require.resolve('../src/utils/admin');
  require.cache[adminPath] = {
    id: adminPath, filename: adminPath, loaded: true,
    exports: {
      admin: {},
      db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
      ADMIN_EMAILS: [], requireAdmin: () => {},
    },
  };

  const CANARY = 'RAW_TEXT_CANARY_9f3c7a';
  const realBody = loadLive('v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844-2026-09-22T23-39-25-313Z.json').rawEnvelope;
  // نُلحق العلامة بنهاية content الحقيقي — لا تعديل على البنية، فقط علامة
  // يسهل تتبّعها كي لا نعتمد افتراضاً بلا دليل أن النصّ الحقيقي لن يظهر
  // صدفةً داخل audit.
  const markedBody = JSON.parse(JSON.stringify(realBody));
  markedBody.choices[0].message.content += ` /*${CANARY}*/`; // يبقى JSON صالحاً؟ لا — سيفشل التحليل، فيسقط لمسار jsonrepair (سيناريو تلف مقصود إضافي، لا سلبي)

  let fetchCallCount = 0;
  global.fetch = async () => {
    fetchCallCount++;
    return {ok: true, status: 200, json: async () => markedBody, text: async () => JSON.stringify(markedBody)};
  };
  for (const modPath of ['../src/analysis/callDeepSeek', '../src/analysis/callAI', '../src/analysis/resolveV7Report', '../src/analysis/callGemini']) {
    delete require.cache[require.resolve(modPath)];
  }
  const {resolveV7Report} = require('../src/analysis/resolveV7Report');
  const {callAI} = require('../src/analysis/callAI');
  const {computeFindings} = require('../src/analysis/findings');
  const {computeCategoryStates} = require('../src/analysis/categoryStates');
  const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

  const raw = loadGolden('b45c8cf6.ts.json');
  const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
  const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  const result = await resolveV7Report({
    findings, categoryStates, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant', geminiApiKey: undefined,
  });

  const rawLogHasCanary = result.rawResponseLog.some((r) => r.rawResponseText && r.rawResponseText.includes(CANARY));
  ok(rawLogHasCanary, '[٢] rawResponseLog يحمل العلامة — الالتقاط يعمل فعلياً (لا اختبار صامت النجاح)');

  const auditSerialized = JSON.stringify(result.audit);
  ok(!auditSerialized.includes(CANARY),
      '[٢] audit (ما سيُكتَب أياً كان تحت aiAudit) لا يحمل العلامة إطلاقاً — عزل كامل، مؤكَّد لا مُفترَض');
  const displaySerialized = JSON.stringify(result.display);
  ok(!displaySerialized.includes(CANARY), '[٢] display أيضاً لا يحمل العلامة — دفاع في العمق');
  console.log(`تحقّق ٢: audit وdisplay خاليان من العلامة (${CANARY}) رغم وجودها في rawResponseLog فعلياً — العزل مؤكَّد بتشغيل حقيقي`);

  // ─── ٣ — ضابط V6 ─────────────────────────────────────────────────────
  fetchCallCount = 0;
  const v6Envelope = {
    model: 'deepseek-flash',
    choices: [{message: {content: JSON.stringify({summary: 'خ', grade: 'B', score: 80, details: 'د', verdict: 'ح', issues: [], predictedProblems: [], categoryScores: {}, buyerAdvice: 'ن', performanceContext: 'س'})}, finish_reason: 'stop'}],
    usage: {completion_tokens: 10},
  };
  global.fetch = async () => ({ok: true, status: 200, json: async () => v6Envelope, text: async () => JSON.stringify(v6Envelope)});
  const {V6_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
  const v6Result = await callAI({device: {}, timeSeries: {}}, 'ar', {scanId: 'x'}, null, 'k', 'g');
  ok(!('rawResponseText' in v6Result), '[٣-ضابط] callAI (V6) لا يحمل rawResponseText — لم يُطلَب منه rawCapture، صفر أثر');
  eq(v6Result.pipeline, V6_PIPELINE_TAG, '[٣-ضابط] pipeline=v6_raw_timeseries كما كان دائماً — البند ٢ لم يمسّ شكل مسار V6');
  eq(v6Result.aiAnalysis.grade, 'B', '[٣-ضابط] المحتوى المقبول سليم — لا تغيير سلوكي على V6');
  console.log('تحقّق ٣: ضابط — callAI (V6) بلا rawCapture، صفر حقل جديد في الناتج، pipeline/محتوى كما كانا');

  console.log(`\nrawResponseCapture.test.js: ${n}/${n} assertions passed`);
}
