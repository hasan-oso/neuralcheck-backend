'use strict';

// measureLiveScriptReplayAndGeminiFlag.test.js — أمر مستخدم 2026-10-01
// +03 (البند ٦، "توسيع سكربت القياس"). يختبر التوسيعين الجديدين على
// scripts/measure-resolveV7Report-live.js:
//   ١) buildScanInputsFromReplayFile — دالّة خالصة، مُدخل مُصطنَع بشكل
//      مخرَج export-v7-replay-inputs-readonly.js بالضبط (لا Firestore/
//      Storage — قراءة ملفّ محلّي فقط، نفس ما تفعله الدالّة الحقيقية).
//   ٢) --allow-gemini — سقف Gemini منفصل (GEMINI_MAX_NETWORK_REQUESTS)،
//      يُطبَّق عند نقطة الخروج (fetch نفسها) تماماً كسقف DeepSeek — القاعدة
//      35، نفس أسلوب measureLiveScriptNetworkGuard.test.js (لا يستبدل
//      الطبقة التي يفحصها، القاعدة 37).
//
// process.argv يحمل --simulate و--allow-gemini **قبل** require() (نفس
// سبب measureLiveScriptNetworkGuard.test.js: argv يُحسَب مرّة واحدة عند
// تحميل الوحدة) — لهذا في ملفّ منفصل: --allow-gemini=false هو الحالة
// المختبَرة أصلاً في ذلك الملفّ، ولا يمكن اختبار الحالتين معاً في نفس
// عملية node واحدة (نفس القيد الموثَّق هناك).
//
// Run: node functions/test/measureLiveScriptReplayAndGeminiFlag.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

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
if (!process.argv.includes('--allow-gemini')) process.argv.push('--allow-gemini');
const measureLive = require('../scripts/measure-resolveV7Report-live');
const {
  GEMINI_HOST, GEMINI_MAX_NETWORK_REQUESTS, MAX_NETWORK_REQUESTS,
  buildScanInputsFromReplayFile, getNetworkLog, resetNetworkGuardState, setSimulatedQueue,
  ABSOLUTE_MAX_NETWORK_REQUESTS, MAX_REQUESTS_PER_CALL, computeNetworkCapForPlan, selectTargets,
  summarizeS5Breaches, extractPatchAgeGate,
} = measureLive;

// ═══════════════════════════════════════════════════════════════════════
// ١ — buildScanInputsFromReplayFile: مُدخل بشكل مخرَج الأداة الأولى
//     بالضبط، يُعيد fingerprint قابلاً لإعادة التشغيل فعلياً (يُمرَّر عبر
//     computeFindings/computeCategoryStates الحقيقيَّتين بلا استثناء).
// ═══════════════════════════════════════════════════════════════════════
{
  const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
  const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'), 'utf8'));
  const frMap = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
  const scanId = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
  const functionalResults = frMap[scanId];

  // نفس شكل مخرَج export-v7-replay-inputs-readonly.js بالضبط (راجع ذلك
  // الملفّ: {scanId, fingerprint: {device, timeSeries, functionalResults,
  // manualResults}, language, isFreeTrial, ...}).
  const replayLike = {
    projectId: 'neuralchek-9b6d7', shortId: 'NC-TESTONLY', scanId,
    serverSamplesSaved: true,
    fingerprint: {
      device: {model: 'SM-TEST', manufacturer: 'test'},
      timeSeries: {...(raw.timeSeries || raw)}, // يحمل samples فعلياً هنا (عكس مستند مُخفَّف حقيقي)
      functionalResults, manualResults: [],
    },
    language: 'ar', isFreeTrial: false,
  };
  const tmpFile = path.join(os.tmpdir(), `replay-input-test-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(replayLike), 'utf8');

  try {
    const built = buildScanInputsFromReplayFile(tmpFile);
    eq(built.scanId, scanId, '[١] scanId يُستخرَج من الملفّ حرفياً');
    eq(built.language, 'ar', '[١] language يُستخرَج من الملفّ');
    eq(built.isFreeTrial, false, '[١] isFreeTrial يُستخرَج من الملفّ');
    eq(built.samplesAvailable, true, '[١] samplesAvailable=true حين timeSeries.samples مصفوفة فعلية');
    ok(built.categoryStates && built.categoryStates.categories && Object.keys(built.categoryStates.categories).length === 15,
        '[١] computeCategoryStates الحقيقية أُنتجت فعلاً (15 فئة) من مُدخل الملفّ — لا محاكاة');
    ok(built.findings && typeof built.findings === 'object', '[١] computeFindings الحقيقية أُنتجت فعلاً');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}
console.log('تحقّق ١: buildScanInputsFromReplayFile يبني fingerprint حقيقياً قابلاً لإعادة التشغيل من ملفّ بشكل الأداة الأولى');

// ═══════════════════════════════════════════════════════════════════════
// ١-ب — تصحيح المنسّق 2026-10-01 +03 ("fix قبل النداءات الحيّة"): قبل هذا
// التصحيح كانت buildScanInputsFromReplayFile تستدعي computeCategoryStates
// بلا analyzedAtMs إطلاقاً، فتصل بوّابة PATCH_AGE دائماً UNKNOWN — حالة لا
// تقع في الإنتاج الحيّ أبداً (functionStartTime حقيقي دائماً هناك،
// analyzeDevice.js:346/562/688)، فكانت الحمولة المقيسة/المُرسَلة من هذا
// السكربت تحمل بوّابة بحالة مختلفة عن الإنتاج (القاعدة 37). **هذا المسار
// الحقيقي** (buildScanInputsFromReplayFile نفسها، لا نسخة مبسَّطة) يُختبَر
// هنا بقيمتَي analyzedAtMs حقيقيتين حسابياً — لا Date.now() (يكسر
// تكراريّة الاختبار) — مبنيَّتين من SEC-03=2021-08-01 (القيمة الحقيقية
// نفسها الموجودة في b45c8cf6.ts.json، نفس العيّنة في كلٍّ من التقريرين
// الحقيقيَّين NC-5DYV7N/NC-83XL4C بالمصادفة) لتعطي 62.0 شهراً بالضبط
// (FIRED) و20.9 شهراً بالضبط (NOT_FIRED) — الرقمان اللذان نقلهما المنسّق
// من aiAudit.gatesApplied الحقيقي على الثلاثة تقارير.
{
  const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
  const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'), 'utf8'));
  const frMap = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
  const scanId = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
  const functionalResults = frMap[scanId];
  const sec03 = functionalResults.find((r) => r.testId === 'SEC-03');
  eq(sec03.rawValue, '2021-08-01', '[١-ب][إعداد] SEC-03 الحقيقي في b45c8cf6.ts.json فعلاً 2021-08-01 — نفس قيمة الإنتاج');

  const patchDateMs = Date.parse('2021-08-01');
  const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4368; // نفس الثابت حرفياً المستعمَل في categoryStates.js (لا نسخة منفصلة بقيمة مختلفة)
  const analyzedAtMsFired = Math.round(patchDateMs + 62.0 * MS_PER_MONTH);
  const analyzedAtMsNotFired = Math.round(patchDateMs + 20.9 * MS_PER_MONTH);

  function buildReplayFile(suffix) {
    const replayLike = {
      scanId: `${scanId}-${suffix}`,
      fingerprint: {
        device: {}, timeSeries: {...(raw.timeSeries || raw)},
        functionalResults, manualResults: [],
      },
      language: 'ar', isFreeTrial: false,
    };
    const tmpFile = path.join(os.tmpdir(), `replay-input-patchage-${suffix}-${Date.now()}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(replayLike), 'utf8');
    return tmpFile;
  }

  // FIRED — 62.0 شهراً (NC-5DYV7N/NC-83XL4C الحقيقيّان).
  {
    const tmpFile = buildReplayFile('fired');
    try {
      const built = buildScanInputsFromReplayFile(tmpFile, analyzedAtMsFired);
      const gate = extractPatchAgeGate(built.categoryStates);
      ok(gate, '[١-ب][FIRED] بوّابة PATCH_AGE حاضرة في gatesApplied');
      eq(gate.status, 'FIRED', '[١-ب][FIRED][المسار الحقيقي] PATCH_AGE=FIRED عند 62.0 شهراً — لا UNKNOWN كما كانت قبل هذا التصحيح');
      ok(gate.source.includes('62.0'), `[١-ب][FIRED] نصّ المصدر يحمل "62.0" فعلاً — ${gate.source}`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  // NOT_FIRED — 20.9 شهراً (NC-TM7PDN الحقيقي).
  {
    const tmpFile = buildReplayFile('notfired');
    try {
      const built = buildScanInputsFromReplayFile(tmpFile, analyzedAtMsNotFired);
      const gate = extractPatchAgeGate(built.categoryStates);
      ok(gate, '[١-ب][NOT_FIRED] بوّابة PATCH_AGE حاضرة في gatesApplied');
      eq(gate.status, 'NOT_FIRED', '[١-ب][NOT_FIRED][المسار الحقيقي] PATCH_AGE=NOT_FIRED عند 20.9 شهراً — لا UNKNOWN');
      ok(gate.source.includes('20.9'), `[١-ب][NOT_FIRED] نصّ المصدر يحمل "20.9" فعلاً — ${gate.source}`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  // بلا analyzedAtMs إطلاقاً (مُدخَل قديم أو استدعاء مباشر ناقص) — UNKNOWN
  // تبقى ممكنة (القاعدة 22: لا Date.now() احتياطي صامت يُخفي غياب الساعة)،
  // لكنها الآن **اختيار صريح لا عطب افتراضي** — الفرق أن main() دائماً
  // تمرّر analyzedAtMs فعلياً من الآن (راجع تحقّق main أدناه إن وُجد).
  {
    const tmpFile = buildReplayFile('noclock');
    try {
      const built = buildScanInputsFromReplayFile(tmpFile, undefined);
      const gate = extractPatchAgeGate(built.categoryStates);
      eq(gate.status, 'UNKNOWN', '[١-ب][بلا analyzedAtMs] PATCH_AGE=UNKNOWN تبقى ممكنة إن لم يُمرَّر الوسيط — سلوك categoryStates.js نفسه، لا تغيير هنا');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }
}
console.log('تحقّق ١-ب: buildScanInputsFromReplayFile (المسار الحقيقي) تُنتج PATCH_AGE=FIRED عند 62.0 شهراً وNOT_FIRED عند 20.9 — لا UNKNOWN — حين يُمرَّر analyzedAtMs فعلياً');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — samplesAvailable=false حين تعذّرت استعادة العيّنات (samplesSource.
//     state='UNAVAILABLE' من الأداة الأولى) — القاعدة 22، لا [] مُختلَقة.
// ═══════════════════════════════════════════════════════════════════════
{
  const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
  const raw = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'b45c8cf6.ts.json'), 'utf8'));
  const frMap = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json'), 'utf8')).byScanId;
  const scanId = 'b45c8cf6-e376-4765-8703-f68e9bc69844';
  const {samples, ...tsWithoutSamples} = (raw.timeSeries || raw);
  const replayLike = {
    scanId, serverSamplesSaved: false,
    fingerprint: {device: null, timeSeries: tsWithoutSamples, functionalResults: frMap[scanId], manualResults: []},
    language: 'ar', isFreeTrial: false,
  };
  const tmpFile = path.join(os.tmpdir(), `replay-input-test-nosamples-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(replayLike), 'utf8');
  try {
    const built = buildScanInputsFromReplayFile(tmpFile);
    eq(built.samplesAvailable, false, '[٢] samplesAvailable=false حين timeSeries.samples غائبة');
    ok(built.categoryStates, '[٢] القياس يتابع رغم غياب العيّنات (لا رمي) — قنوات تعتمد عليها تخرج "غير مقيس" بدلاً من فشل كامل');
  } finally {
    fs.unlinkSync(tmpFile);
  }
}
console.log('تحقّق ٢: غياب العيّنات الفعلية (samplesAvailable=false) لا يُسقِط القياس — يُبلَّغ صراحة (القاعدة 22)');

// ═══════════════════════════════════════════════════════════════════════
// ٢-ب — تصحيح المنسّق 2026-10-01 +03 (بعد f7d6201، البند ١): selectTargets
//     — --replay-input يستبعد الذهبيتين تلقائياً إلا بـ--include-golden.
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeGolden = [{scanId: 'GOLD-1'}, {scanId: 'GOLD-2'}];

  // بلا --replay-input إطلاقاً — الذهبيتان فقط، كما كان قبل هذا التصحيح.
  const r1 = selectTargets({goldenAll: fakeGolden, replayPaths: [], includeGolden: false, only: null});
  eq(r1.hasReplayTargets, false, '[٢-ب] hasReplayTargets=false بلا --replay-input');
  eq(r1.TARGETS.length, 2, '[٢-ب] بلا --replay-input: الذهبيتان فقط (لا تغيير سلوكي)');

  // نصّ المستخدم: "النداء على مُدخلات التقارير الحقيقية الثلاثة... مرّتين
  // لكلٍّ منها" = 6 نداءات — لا 10 (لا إضافة الذهبيتين صامتاً).
  const r2 = selectTargets({
    goldenAll: fakeGolden, replayPaths: ['/a.json', '/b.json', '/c.json'],
    includeGolden: false, only: null,
  });
  eq(r2.hasReplayTargets, true, '[٢-ب] hasReplayTargets=true مع --replay-input');
  eq(r2.goldenTargets.length, 0, '[٢-ب][تصحيح المنسّق] الذهبيتان مُستبعَدتان تلقائياً — --replay-input بلا --include-golden');
  eq(r2.TARGETS.length, 3, '[٢-ب][تصحيح المنسّق] 3 أهداف فقط (الحقيقية الثلاثة) — لا 5، تطابق "6 نداءات" بعد --runs 2');

  // --include-golden صريح يُعيدهما.
  const r3 = selectTargets({
    goldenAll: fakeGolden, replayPaths: ['/a.json', '/b.json', '/c.json'],
    includeGolden: true, only: null,
  });
  eq(r3.goldenTargets.length, 2, '[٢-ب] --include-golden صريح يُعيد الذهبيتين');
  eq(r3.TARGETS.length, 5, '[٢-ب] --include-golden صريح: 2 ذهبي + 3 حقيقي = 5');
}
console.log('تحقّق ٢-ب: selectTargets — --replay-input يستبعد الذهبيتين تلقائياً (تصحيح المنسّق)، --include-golden يُعيدهما صراحة');

// ═══════════════════════════════════════════════════════════════════════
// ٢-ج — **استُبدلت (القاعدة 23) 2026-10-01 +03** — قرار مستخدم لاحق صريح
// غيّر MAX_REQUESTS_PER_CALL من 4 إلى 2: "الحدّ 12 طلباً للنموذج: ثلاثة
// تقارير، ونداءان لكلٍّ منها، ومحاولتان على الأكثر لكل نداء." تبسيط
// صريح من المستخدم (لا 2×2=4 كالحساب الفنّي الأدقّ السابق) — الأمر
// المقترح فعلياً: 3 أهداف حقيقية × --runs 2 × 2 = **12** لا 24.
// ═══════════════════════════════════════════════════════════════════════
{
  eq(MAX_REQUESTS_PER_CALL, 2,
      '[٢-ج][قرار مستخدم 2026-10-01 +03] أقصى محاولات DeepSeek لكل نداء = 2 (تبسيط صريح، لا 2×2 الحساب الفنّي)');
  eq(computeNetworkCapForPlan(3, 2, MAX_REQUESTS_PER_CALL), 12,
      '[٢-ج][الأمر المقترح] 3 تقارير × 2 نداء لكلٍّ منها × 2 محاولة = 12 — لا 24 ولا 40');
  eq(computeNetworkCapForPlan(100, 100, MAX_REQUESTS_PER_CALL), ABSOLUTE_MAX_NETWORK_REQUESTS,
      `[٢-ج] خطّة ضخمة (100×100×2=20000) تُقصَّ عند السقف المطلَق ${ABSOLUTE_MAX_NETWORK_REQUESTS} — لا تتجاوزه أبداً`);
  eq(computeNetworkCapForPlan(10, 2, MAX_REQUESTS_PER_CALL), 40,
      '[٢-ج][حافة] 10 أهداف × 2 دورة × 2 = 40 — يطابق السقف المطلَق تماماً (حافة لا تجاوز)');
  eq(computeNetworkCapForPlan(11, 2, MAX_REQUESTS_PER_CALL), 40,
      '[٢-ج][حافة] 11 أهداف × 2 دورة × 2 = 44 غير مُقصَّاة — تُقصّ فعلياً عند 40');
}
console.log(`تحقّق ٢-ج: computeNetworkCapForPlan(3, 2, ${MAX_REQUESTS_PER_CALL})=12 للأمر المقترح (قرار مستخدم 2026-10-01 +03) — لا يتجاوز أبداً السقف المطلَق ${ABSOLUTE_MAX_NETWORK_REQUESTS}`);

// ═══════════════════════════════════════════════════════════════════════
// ٢-د — تصحيح المنسّق 2026-10-01 +03 (البند ٣): summarizeS5Breaches —
//     **كل** قواعد S5 (لا "الصنف (د)"/gpu_fps وحده) تُجمَّع وتُسرَد، مع
//     جمل "عدّ يدوي" الدلالية مُعدودة ومُسرَدة أيضاً — لا رقماً ملخَّصاً فقط.
// ═══════════════════════════════════════════════════════════════════════
{
  const fakeRecords = [
    {
      scanId: 'REC-1',
      s5Check: {
        violations: [
          {rule: 'TEST_ID_MENTION', field: 'narrative.details', match: 'SEC-04'},
          {rule: 'FRAME_RATE_MISNOMER', field: 'narrative.summary', match: 'معدّل الإطارات'},
        ],
        manualReviewCandidates: [
          {rule: 'HEALTH_JUDGMENT_NO_LETTER', field: 'narrative.summary', sentence: 'البطارية سليمة.'},
        ],
      },
    },
    {
      scanId: 'REC-2',
      s5Check: {violations: [], manualReviewCandidates: []},
    },
    {
      scanId: 'REC-3',
      s5Check: {error: 'تعذّر الفحص — يُتجاهَل بأمان، لا يُسقِط الإجمالي'},
    },
  ];
  const summary = summarizeS5Breaches(fakeRecords);
  eq(summary.totalAutoViolations, 2, '[٢-د] مجموع المخالفات الآلية = 2 (TEST_ID_MENTION + FRAME_RATE_MISNOMER معاً) — لا صنف واحد فقط');
  eq(summary.totalManualCandidates, 1, '[٢-د] مجموع المُرشَّحات الدلالية = 1');
  eq(summary.perScanBreaches.length, 1, '[٢-د] REC-2 (نظيف) وREC-3 (خطأ فحص) لا يدخلان perScanBreaches');
  eq(summary.perScanBreaches[0].scanId, 'REC-1', '[٢-د] REC-1 وحده يحمل الخرق');
  ok(summary.perScanBreaches[0].violations.some((v) => v.rule === 'TEST_ID_MENTION'),
      '[٢-د][تصحيح المنسّق] TEST_ID_MENTION يظهر — لا الصنف (د)/gpu_fps وحده كما في النقل السابق الخاطئ');
  ok(summary.perScanBreaches[0].violations.some((v) => v.rule === 'FRAME_RATE_MISNOMER'),
      '[٢-د] FRAME_RATE_MISNOMER أيضاً يظهر (كان يُفحَص وحده سابقاً — يبقى ضمن المجموع الآن لا مُفرَداً)');
  eq(summary.perScanBreaches[0].manualReviewCandidates.length, 1,
      '[٢-د] الجملة الدلالية "عدّ يدوي" مُسرَدة كاملة (النصّ نفسه)، لا رقماً وحده');
}
console.log('تحقّق ٢-د: summarizeS5Breaches يجمع كل قواعد S5 الآلية + المُرشَّحات الدلالية معاً تحت عنوان واحد — لا الصنف (د) وحده');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — --allow-gemini: سقف Gemini منفصل (GEMINI_MAX_NETWORK_REQUESTS)،
//     مُطبَّق عند fetch نفسها — نقطة الخروج (القاعدة 35)، لا مُختلَط مع
//     سقف DeepSeek (MAX_NETWORK_REQUESTS، أكبر بكثير).
// ═══════════════════════════════════════════════════════════════════════
(async () => {
  resetNetworkGuardState();
  ok(GEMINI_MAX_NETWORK_REQUESTS < MAX_NETWORK_REQUESTS,
      `[٣] سقف Gemini (${GEMINI_MAX_NETWORK_REQUESTS}) أصغر من سقف DeepSeek (${MAX_NETWORK_REQUESTS}) عمداً — Gemini ليست الوجهة الافتراضية`);

  const okEnvelope = {model: 'gemini-test', choices: [{finish_reason: 'stop'}], usage: {}};
  const queue = [];
  for (let i = 0; i < GEMINI_MAX_NETWORK_REQUESTS; i++) {
    queue.push(new Response(JSON.stringify(okEnvelope), {status: 200, headers: {'content-type': 'application/json'}}));
  }
  setSimulatedQueue(queue);

  const results = [];
  for (let i = 1; i <= GEMINI_MAX_NETWORK_REQUESTS + 1; i++) {
    try {
      await global.fetch(`https://${GEMINI_HOST}/v1/models/gemini-test:generateContent`, {method: 'POST', body: '{}'});
      results.push({seq: i, blocked: false});
    } catch (e) {
      results.push({seq: i, blocked: true, reason: String(e.message || e)});
    }
  }
  for (let i = 0; i < GEMINI_MAX_NETWORK_REQUESTS; i++) {
    ok(!results[i].blocked, `[٣] الطلب رقم ${i + 1} إلى Gemini مرّ (ضمن السقف ${GEMINI_MAX_NETWORK_REQUESTS}) — --allow-gemini فعّال`);
  }
  ok(results[GEMINI_MAX_NETWORK_REQUESTS].blocked, `[٣] الطلب رقم ${GEMINI_MAX_NETWORK_REQUESTS + 1} إلى Gemini حُجب (تجاوز السقف)`);
  ok(/CAP_REACHED\(gemini\)/.test(results[GEMINI_MAX_NETWORK_REQUESTS].reason),
      `[٣] سبب الحجب CAP_REACHED(gemini) صراحة — ${results[GEMINI_MAX_NETWORK_REQUESTS].reason}`);

  console.log(`تحقّق ٣: --allow-gemini يفتح ${GEMINI_MAX_NETWORK_REQUESTS} طلبات فقط لـGemini، بسقف منفصل عن DeepSeek، مُطبَّق عند نقطة الخروج`);
  console.log(`\nmeasureLiveScriptReplayAndGeminiFlag.test.js: ${n}/${n} assertions passed`);
})();
