'use strict';

// applyV7AdjustmentsWiring.test.js — A122 (أمر مستخدم 2026-09-23 +03، بعد
// القياس العشاري): "resolveV7Report.js:411 يمرّر categoryStates:
// p.categoryStates الخام إلى buildDisplayShapeV7... applyV7Adjustments
// لم تكن تُستدعى هنا إطلاقاً." أُصلح في resolveV7Report.js — هذا الملفّ
// يختبر الإصلاح **بالمسار كاملاً، لا يستبدل إلا fetch (القاعدة 37)،
// وبجسم ردّ حقيقي فيه اقتراحات** (نصّ الأمر حرفياً).
//
// المصدر: functions/scripts/out/resolve-v7-live-b45c8cf6-e376-4765-8703-
// f68e9bc69844-2026-09-23T02-11-54-297Z.json، attempts[1] (المحاولة
// الثانية، seq=2، المقبولة فعلياً — guardOk=true)، وفيها cpu DOWN وgpu
// DOWN (نصّ الأمر). مُجمَّد في test/fixtures/ (نفس طريقة ca39b3c): rawEnvelope
// مُعاد تجميعه من حقول حقيقية مُلتقَطة منفصلة لنفس المحاولة (سكربت القياس
// لا يخزّن envelope واحداً مُجمَّعاً) — لا نصّ مُختلَق، كل حقل حقيقي.
// الاختبار لا يقرأ من scripts/out — يقرأ الملفّ المُجمَّد فقط.
//
// Run: node functions/test/applyV7AdjustmentsWiring.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozen(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')); }

// ─── فخّ Firestore القياسي ──────────────────────────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── globalThis.fetch وحده (القاعدة 37) ─────────────────────────────────
let fetchQueue = [];
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) throw new Error(`TRAP: unexpected host ${url}`);
  if (fetchQueue.length === 0) throw new Error('TRAP: fetch queue empty');
  const envelope = fetchQueue.shift();
  return {ok: true, status: 200, json: async () => envelope, text: async () => JSON.stringify(envelope)};
};

const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {ADJUSTMENT_ACCEPTED_NO_EFFECT} = require('../src/analysis/buildV7Payload');
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

function baseParams() {
  return {
    findings, categoryStates, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-stubbed', geminiApiKey: undefined,
  };
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — الجسم الحقيقي كما وصل: محاولتان EVIDENCE_NOT_PROVEN — الحروف بلا
  // تغيير، letterSource ليس LLM_ADJUSTED (المتوقَّع قيمةً، القاعدة 30).
  // ═══════════════════════════════════════════════════════════════════
  // أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل» — الملفّ
  // frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json عاد إلى
  // بصمته الأصلية بالضبط (git restore، مُتحقَّق: git hash-object يطابق
  // git rev-parse HEAD:<path> — راجع تقرير هذه المهمّة). ذلك الردّ الأصلي
  // صار **مرفوضاً فعلاً** من الحارس على categoryStates الجديدة (اختبار
  // ١ب أدناه يثبت هذا بالتشغيل المباشر) بعد أمر 2026-09-27 +03 «الإعدادات
  // لا تُنزل الحرف» — فهذا الاختبار (الذي يحتاج ردّاً *يقبله* الحارس
  // ليختبر رفض adjustments تحديداً، لا رفض الشكل) يستعمل بدلاً منه ملفّاً
  // **مشتقّاً** منفصلاً، موسوماً صراحة أنه ليس ردّاً حقيقياً:
  // derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix-v3-2026-10-07.json
  // (مُولَّد بـfunctions/scripts/generate-derived-from-frozen-real-2026-09-23-
  // adjustments-usersettings-fix.js — راجعه للتعديلين بالضبط وسببيهما،
  // ولتصحيح مهمّ: السبب الثاني لرفض الأصل ليس "45% خارج تسامح 45.9%" كما
  // نُقل في تقرير سابق، بل رقم "10" في narrative.details — مُتحقَّق
  // بالتشغيل، راجع رأس ذلك السكربت). محتوى narrative/crossChecks/
  // modelObservations/adjustments غير هذين التعديلين مطابق حرفياً للأصل.
  const derivedFixture = loadFrozen('derived-from-frozen-real-2026-09-23-adjustments-usersettings-fix-v3-2026-10-07.json');
  fetchQueue = [derivedFixture.rawEnvelope];
  fetchCallCount = 0;
  const r1 = await resolveV7Report(baseParams());

  eq(fetchCallCount, 1, '[١] مقبول من المحاولة الأولى (الجسم الحقيقي نفسه اجتاز الحارس فعلاً) — fetch=1');
  eq(r1.guardFinal.ok, true, '[١] guardFinal.ok=true');
  eq(r1.audit.adjustments.length, 2, '[١] audit.adjustments يحمل سجلّين (cpu، gpu)');
  const cpuAdj = r1.audit.adjustments.find((a) => a.category === 'cpu');
  const gpuAdj = r1.audit.adjustments.find((a) => a.category === 'gpu');
  ok(cpuAdj && cpuAdj.rejectedReason === 'EVIDENCE_NOT_PROVEN', '[١] cpu مرفوض EVIDENCE_NOT_PROVEN');
  ok(gpuAdj && gpuAdj.rejectedReason === 'EVIDENCE_NOT_PROVEN', '[١] gpu مرفوض EVIDENCE_NOT_PROVEN');
  eq(cpuAdj.applied, false, '[١] cpu applied=false');
  eq(gpuAdj.applied, false, '[١] gpu applied=false');

  eq(r1.display.categories.cpu.letter, 'A', '[١] حرف cpu بلا تغيير (A — نفس deterministicLetter)');
  eq(r1.display.categories.gpu.letter, 'B', '[١] حرف gpu بلا تغيير (B — نفس deterministicLetter)');
  eq(r1.display.categories.cpu.letterSource, 'DETERMINISTIC', '[١] letterSource(cpu) ليس LLM_ADJUSTED');
  eq(r1.display.categories.gpu.letterSource, 'DETERMINISTIC', '[١] letterSource(gpu) ليس LLM_ADJUSTED');
  eq(r1.audit.disputed, false, '[١] disputed=false — كلا الاقتراحين DOWN لا UP');
  console.log('تحقّق ١: الجسم الحقيقي (cpu+gpu DOWN) — كلاهما EVIDENCE_NOT_PROVEN، الحروف بلا تغيير، letterSource=DETERMINISTIC');

  // ═══════════════════════════════════════════════════════════════════
  // ١ب — أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا يُعدَّل»،
  // البند ٢: "اختبار: الردّ الحقيقي القديم على الحمولة الجديدة يرفضه
  // الحارس، بالأسباب نفسها." الأصل غير المُعدَّل (loadFrozen مباشرة، لا
  // derivedFixture) عبر المسار الكامل (محاولتان، القاعدة 37).
  //
  // ⚠️ unmatchedFields أُعيد قياسه مرّتين — مهمّة 2026-10-01 (بنود ٢-٥ من
  // أمر المستخدم، إخفاء القيم غير المعايَرة عن حمولة النموذج):
  //
  // (أ) البند ٢ غيّر ما يصل النموذج (findings.sustainedCeiling/graphics/
  // battery، ومؤشّرات البطارية BAT-FCC/BAT-R-APPARENT/BAT-COULOMB/
  // BAT-THERMAL-EFF، وrawValue لاختبارات THERMAL_UNCALIBRATED_IDS/
  // UNCALIBRATED_THRESHOLD_IDS — راجع buildV7Payload.js). وcallAI.js كان
  // يمرّر p.findings/p.categoryStates الخام (غير المحجوب) مرجعاً لحارس
  // الأرقام validateNumberGrounding — ثغرة أمنية حقيقية (مُوثَّقة في تقرير
  // هذه المهمّة): رقم هلوسه النموذج من مسار محجوب كان سيُقبل بوصفه
  // "مُسنَداً" لمجرّد وجوده في البيانات الأصلية. أُصلحت بتمرير
  // body.findings/body.categoryStates (المحجوبين فعلاً، كما غادرا إلى
  // النموذج).
  //
  // (ب) هذا التصحيح نفسه كشف ثغرة ثانية بالتشغيل المباشر (لا تخمين، القاعدة
  // 40): body.categoryStates = {categories, overall, issues} فقط (بناء
  // buildV7Payload.js) — بلا testResults (مفصولة إلى body.testResults).
  // وcollectDeviceReference/collectReferenceNumbers (reportShapeV7.js)
  // يقرآن categoryStates.testResults مباشرة لأرقام هوية الجهاز (عناصر
  // STATE/SPEC كـC-05 chip model) وللمشي العميق على القياسات. غيابها كان
  // سيرفض أرقاماً حقيقية بريئة حاضرة فعلاً في الحمولة لا علاقة لها بالإخفاء.
  // أُصلح في callAI.js بدمج body.testResults (المُنقّاة فعلاً بالبند ٢) تحت
  // categoryStates.testResults لمرجع الحارس وحده (لا تغيير على body
  // المُرسَلة للنموذج).
  //
  // والنتيجة النهائية (مُتحقَّقة بتشغيل مباشر بعد كلا التصحيحين):
  //   narrative.details: [10] فقط — 9.1/7.1/188/4400 التي ظهرت في قياس
  //     وسيط (قبل تصحيح ب) عادت مطابَقة لأنها حاضرة فعلاً في body.testResults
  //     (C-06 MEASUREMENT="9.1" كبح حراري حقيقي، S-03 STATE="188" سرعة
  //     تخزين، B-02 STATE="4400" سعة البطارية التصميمية — مواصفة لا قياس،
  //     البند ٢ لم يطلب إخفاءها، ذاكرة 7.1GB STATE). "10" وحده قديم غير
  //     متعلّق بهذه المهمّة، معفًى من الرفض بالبند ٤ (details).
  //   crossChecks[3].description: [143.84] فقط — كمّية شحن مقيسة (مشتقّة من
  //     مؤشّر بطارية محجوب بالبند ٢، BAT-COULOMB أو ما يصنَّف تحته)، لا مصدر
  //     لها في الحمولة بعد الإخفاء.
  // الرقم الباقي في crossChecks[3] ليس في narrative.details فلا يُعفى — فالردّ
  // يبقى مرفوضاً (guardFinal.ok=false) كما كان، بنفس issueKeys أيضاً
  // (لا علاقة لها بالحجب). ولم يتغيّر أي شيء آخر في هذا الاختبار: fetchCallCount،
  // adjustments.length، narrativeIncomplete، الحروف.
  // ═══════════════════════════════════════════════════════════════════
  const originalRealFixture = loadFrozen('frozen-real-model-output-b45c8cf6-adjustments-2026-09-23.json');
  fetchQueue = [originalRealFixture.rawEnvelope, originalRealFixture.rawEnvelope];
  fetchCallCount = 0;
  const r1b = await resolveV7Report(baseParams());

  eq(fetchCallCount, 2, '[١ب] محاولتان فعليتان — الأولى رُفضت فأُعيد التوليد');
  eq(r1b.guardFinal.ok, false, '[١ب] guardFinal.ok=false — الردّ الحقيقي الأصلي مرفوض على categoryStates الجديدة');
  eq(r1b.guardFinal.shape.ok, true, '[١ب] shape.ok=true — لا عطب بنيوي، الرفض دلالي فقط');
  eq(r1b.guardFinal.issueKeys.ok, false, '[١ب] issueKeys.ok=false');
  eq(JSON.stringify(r1b.guardFinal.issueKeys.inventedIds.slice().sort()),
      JSON.stringify(['DISC-CM-08', 'DISC-SEC-07', 'DISC-T-01', 'DISC-T-02', 'ISS-SEC-05', 'ISS-SEC-06'].slice().sort()),
      '[١ب] inventedIds = المعرّفات الستّة بعينها (ISSUE_KEYS)');
  eq(r1b.guardFinal.numbers.ok, false, '[١ب] numbers.ok=false');
  eq(JSON.stringify(r1b.guardFinal.numbers.unmatchedFields),
      JSON.stringify([
        {field: 'narrative.summary', numbers: [45]},
        {field: 'narrative.details', numbers: [45, 10, 61.7, 8.1, 0.85, 0.575, 31.3, 1618, 33.3, 3778.29, 4400, 0.8587, 6.9, 1.85, 39.3, 48, 43]},
        {field: 'narrative.verdict', numbers: [45]},
        {field: 'narrative.buyerAdvice.casual', numbers: [45]},
        {field: 'narrative.buyerAdvice.gamer', numbers: [0.575, 39.3]},
        {field: 'narrative.buyerAdvice.photographer', numbers: [31.3]},
        {field: 'crossChecks[0].description', numbers: [61.7]},
        {field: 'crossChecks[1].description', numbers: [45, 33.3]},
        {field: 'crossChecks[2].description', numbers: [39.3, 6.9, 1.85]},
        {field: 'crossChecks[3].description', numbers: [48, 43, 3778.29, 4400, 0.8587, 143.84]},
        {field: 'adjustments[0].reason', numbers: [0.85]},
        {field: 'adjustments[1].reason', numbers: [0.575]},
        {field: 'modelObservations[0].text', numbers: [1618, 182.93]},
      ]),
      '[١ب][مهمّة 2026-10-01 + أمر 2026-10-06 المبدأ + أمر 2026-10-07 قرار القوائم وحدود الرقم (0.8587 صار مرئياً: «بنسبة 0.8587،» ملاصق لعلامة عربية)] unmatchedFields بعد حذف findings.channels وحجب findings.thermal/storage وUNSTABLE وS-02/B-01..B-07 (31.3 و1618 و3778.29 و4400 صارت بلا سند): أرقام كانت تُقبَل بمصادفة التسامح مع قيم القنوات (45 و61.7 و33.3 و48 و43 و0.85…) لم تعد مقبولة، + أرقام محجوبة (143.84 و182.93 و6.9 و1.85 و39.3…)');
  ok(r1b.guardFinal.detailsWaived && JSON.stringify(r1b.guardFinal.detailsWaived.numbers) === JSON.stringify([45, 10, 61.7, 8.1, 0.85, 0.575, 31.3, 1618, 33.3, 3778.29, 4400, 0.8587, 6.9, 1.85, 39.3, 48, 43]),
      '[١ب][البند ٤] detailsWaived.numbers = أرقام details غير المطابقة كلّها — معفاة من الرفض لأنها في details وحده');
  eq(r1b.audit.adjustments.length, 0, '[١ب] audit.adjustments فارغة — رفض شكلي كامل، لا وصول لتقييم adjustments (القرار ٢١)');
  eq(r1b.display.narrativeIncomplete, true, '[١ب] narrativeIncomplete=true');
  eq(r1b.display.categories.cpu.letter, 'A', '[١ب] letter(cpu) الحتمي بلا تغيير (لا عرض جزئي يمسّ الحروف)');
  eq(r1b.display.categories.security.letter, 'D', '[١ب] letter(security) الحتمي بلا تغيير');
  console.log('تحقّق ١ب [مهمّة 2026-10-01]: الردّ الحقيقي الأصلي (بلا تعديل) على الحمولة الجديدة — مرفوض فعلاً؛ unmatchedFields=details:[10]+crossChecks[3]:[143.84] بعد تصحيح مرجع الحارس (body.* المحجوب + testResults المُعاد دمجه)');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — حالة قبول واحدة، مُصطنَعة بتعديل واحد مُسمّى (لا دليل حقيقي مقبول
  // في كامل عيّنة القياس العشاري — 0/9 قُبل، شهادة المنسّق المباشرة).
  //
  // ⚠️ **أُعيدت كتابته — القرار ٩٤ البند ١**: كان يستهدف gpu بمرجع بوّابة
  // (categoryStates.gates[7].status=FIRED) — البوّابة لم تعد "مُثبَتة"
  // بتاتاً بعد اليوم (لا بوّابة من أيّ فئة). **لا دليل بوّابة/حرف يبقى
  // مقبولاً على أي فئة بعد اليوم** — الشقّ الوحيد الباقي outcome=FAIL
  // لاختبار من نفس الفئة. gpu لا تحمل FAIL حقيقياً على هذا الفِخّ (تحقّق
  // مباشر أدناه)؛ security تحمل الوحيد الحقيقي (SEC-04) — فاستُهدفت هي
  // بدلاً من gpu (تغيير الفئة **و**evidenceRefs معاً، لا evidenceRefs
  // وحدها كالمرّة السابقة — لا فئة أخرى على هذا الفِخّ تحمل FAIL حقيقياً
  // ليبقى الاستهداف gpu). بقيّة الجسم (narrative/crossChecks/
  // modelObservations/adjustment.reason/cpu) بلا أي تعديل آخر.
  // ═══════════════════════════════════════════════════════════════════
  ok(!categoryStates.testResults.some((t) => t.category === 'gpu' && t.outcome === 'FAIL'),
      '[إعداد ٢] لا اختبار gpu حقيقي بـoutcome=FAIL على هذا الفِخّ — لذا اُستُبدلت الفئة المستهدَفة بدل اختلاق دليل');
  const sec04IndexForWiring2 = categoryStates.testResults.findIndex((t) => t.testId === 'SEC-04');
  ok(sec04IndexForWiring2 >= 0, '[إعداد ٢] SEC-04 موجودة في testResults الحقيقية');
  eq(categoryStates.testResults[sec04IndexForWiring2].outcome, 'FAIL', '[إعداد ٢] SEC-04.outcome=FAIL فعلياً — الدليل الحقيقي الوحيد على هذا الفِخّ');
  eq(categoryStates.categories.security.deterministicLetter, 'D', '[إعداد ٢] security.deterministicLetter=D فعلياً (أسوأ درجة أصلاً)');

  const acceptedContent = JSON.parse(derivedFixture.rawEnvelope.choices[0].message.content);
  const gpuIdx = acceptedContent.adjustments.findIndex((a) => a.category === 'gpu');
  ok(gpuIdx >= 0, '[إعداد ٢] عثر على اقتراح gpu في الجسم الحقيقي (سيُستبدَل بأكمله لا evidenceRefs وحدها)');
  acceptedContent.adjustments[gpuIdx] = Object.assign({}, acceptedContent.adjustments[gpuIdx], {
    // ⚠️ التعديلان المُسمّيان معاً: category وevidenceRefs — بديل حقيقي
    // (نتيجة FAIL حقيقية فعلاً من نفس الفئة المستهدَفة، مُتحقَّق أعلاه
    // بتشغيل مباشر) لا نصّ مُختلَق ولا قياس مُصطنَع.
    category: 'security',
    evidenceRefs: [`categoryStates.testResults[${sec04IndexForWiring2}].outcome`],
  });
  const acceptedEnvelope = Object.assign({}, derivedFixture.rawEnvelope, {
    choices: [{message: {content: JSON.stringify(acceptedContent)}, finish_reason: 'stop'}],
  });

  fetchQueue = [acceptedEnvelope];
  fetchCallCount = 0;
  const r2 = await resolveV7Report(baseParams());

  eq(r2.guardFinal.ok, true, '[٢] guardFinal.ok=true — التعديل لم يمسّ narrative/crossChecks');
  const securityAdj2 = r2.audit.adjustments.find((a) => a.category === 'security');
  ok(securityAdj2 && securityAdj2.applied === true, '[٢] security applied=true فعلياً — دليل FAIL حقيقي من نفس الفئة');
  eq(securityAdj2.fromLetter, 'D', '[٢] fromLetter=D (deterministicLetter الحقيقي — أسوأ درجة أصلاً)');
  eq(securityAdj2.toLetter, 'D', '[٢] toLetter=D — لا مزيد تحت D (نفس آلية "فئة أصلاً D"، buildV7Payload.test.js)');
  eq(r2.display.categories.security.letter, 'D', '[٢] display.categories.security.letter=D — بلا تغيير ظاهري (كانت D أصلاً)');
  // ⚠️ **توقّع مقلوب — القرار ٩٨ البند ١ (2026-09-25 +03)، نصّ المستخدم
  // حرفياً**: "letterSource = LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن
  // الحرف الحتمي." هنا fromLetter===toLetter===D — فلا اختلاف، ويُسجَّل
  // "مقبولاً بلا أثر" (noEffectReason=ADJUSTMENT_ACCEPTED_NO_EFFECT) لا
  // LLM_ADJUSTED (كان صحيحاً قبل هذا القرار، القاعدة 23/34).
  eq(securityAdj2.noEffectReason, ADJUSTMENT_ACCEPTED_NO_EFFECT,
      '[القرار ٩٨/١][مطلوب صراحةً] audit.adjustments.security.noEffectReason = ACCEPTED_NO_EFFECT — مسجَّل "مقبولاً بلا أثر"');
  eq(r2.display.categories.security.letterSource, 'DETERMINISTIC',
      '[القرار ٩٨/١][كان LLM_ADJUSTED قبل هذا القرار] letterSource(security)=DETERMINISTIC — لا اختلاف حرف، فلا LLM_ADJUSTED رغم القبول');
  eq(r2.display.categories.security.adjustmentReason, null,
      '[القرار ٩٨/١][كان نصّاً قبل هذا القرار] adjustmentReason على العرض null — buildDisplayShapeV7 تُصفِّرها حين !adjustmentApplied');
  eq(r2.display.categories.security.adjustmentEvidence, null,
      '[القرار ٩٨/١][كان مصفوفة قبل هذا القرار] adjustmentEvidence على العرض null لنفس السبب');
  // cpu وgpu لم يُمَسّا في هذا التعديل — يبقيان مرفوضين كما في تحقّق ١.
  const cpuAdj2 = r2.audit.adjustments.find((a) => a.category === 'cpu');
  const gpuAdj2 = r2.audit.adjustments.find((a) => a.category === 'gpu');
  eq(cpuAdj2.rejectedReason, 'EVIDENCE_NOT_PROVEN', '[٢] cpu (غير المُعدَّل) يبقى مرفوضاً كما كان');
  ok(!gpuAdj2, '[٢] لا سجلّ gpu في audit.adjustments — استُبدل اقتراحه بالكامل بـsecurity، لم يعد يصل النموذج المصنوع أصلاً');
  eq(r2.display.categories.cpu.letter, 'A', '[٢] cpu letter بلا تغيير');
  eq(r2.display.categories.gpu.letterSource, 'DETERMINISTIC', '[٢] gpu letterSource يبقى DETERMINISTIC — لا اقتراح له في هذا الردّ المصنوع أصلاً');
  console.log('تحقّق ٢ [أُعيدت كتابته — القرار ٩٨/١]: تعديل واحد مُسمّى (category+evidenceRefs لـsecurity، دليل FAIL حقيقي) ← applied=true، noEffectReason=ACCEPTED_NO_EFFECT، letterSource=DETERMINISTIC — لا اختلاف حرف (D→D، security كانت D أصلاً)');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — رفضان متتاليان (القرار ٢١): الاقتراحات تسقط تماماً، غير مُسجَّلة.
  // نصّ الأمر: "أعلن ما يحدث في الكود في هذه الحالة."
  //
  // ⚠️ **الحقن نُقل من details إلى summary — مهمّة 2026-10-01 (البند ٤)**:
  // خرق لغوي في narrative.details صار معفًى من الرفض (يُسجَّل في aiAudit
  // فقط، لا يرفض الردّ — راجع reportShapeV7.js:guardV7Response وdecision
  // في commit systemPromptV7.js/resolveV7Report.js لهذه المهمّة). هذا
  // الاختبار يحتاج رفضاً فعلياً ليفحص سقوط adjustments عند رفضين متتاليين
  // (موضوعه لا علاقة له بـdetails تحديداً) — فنُقل الحقن إلى summary، حقل
  // غير مُعفًى، ليبقى الرفض قائماً. نفس التصحيح الذي وقع في
  // resolveV7Report.test.js سيناريو ٥ لنفس السبب.
  const leakyContent = JSON.parse(JSON.stringify(acceptedContent));
  leakyContent.narrative.summary += ' leak-english-word';
  const leakyEnvelope = Object.assign({}, derivedFixture.rawEnvelope, {
    choices: [{message: {content: JSON.stringify(leakyContent)}, finish_reason: 'stop'}],
  });
  fetchQueue = [leakyEnvelope, leakyEnvelope];
  fetchCallCount = 0;
  const r3 = await resolveV7Report(baseParams());
  eq(r3.guardFinal.ok, false, '[٣] رفضان متتاليان — guardFinal.ok=false');
  eq(r3.audit.adjustments.length, 0, '[٣] audit.adjustments فارغة — الاقتراحات سقطت تماماً (القرار ٢١)، لا سجلّ حتى للمرفوضة');
  eq(r3.display.categories.gpu.letter, 'B', '[٣] gpu letter = deterministicLetter الخام (categoryStates الأصلية بلا applyV7Adjustments)');
  eq(r3.display.categories.gpu.letterSource, 'DETERMINISTIC', '[٣] letterSource(gpu)=DETERMINISTIC — لا اقتراح مطبَّق');
  console.log('تحقّق ٣: رفضان متتاليان ← audit.adjustments فارغة تماماً، categoryStates الخام بلا applyV7Adjustments (موثَّق في الكود)');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — القرار ٨٧/٨٨ البند ٣ (نصّ المستخدم حرفياً): "اختبار بردّ نموذج
  // مصنوع يطلب تخفيض wireless بدليل «N-10 fail»، ويجب أن يرفضه الحارس.
  // فإن قبله: توقّف." اختبار المسار كاملاً (القاعدة 37) — لا يُستبدل هنا
  // إلا global.fetch، تماماً كبقية هذا الملفّ.
  //
  // categoryStates/findings لهذا القسم **مُعادان الحساب محلّياً** (لا
  // categoryStates العلوية المبنيّة من functional الحقيقي بلا تعديل) —
  // نسخة من نفس functional الحقيقي، N-10 محوَّلة إلى status:'fail'/
  // rawValue:'-95' (نفس مُدخل اختبار الوحدة في buildV7Payload.test.js،
  // القرار ٨٧-٣) — يمثّل الحالة بعد القرار ٨٦-١ (N-10 fail يصير NOT_MEASURED
  // على الخادم) التي يحاول ردّ النموذج فيها انتزاع تخفيض wireless مستشهداً
  // بالحالة الخام السابقة (raw.status='fail').
  //
  // ⚠️ **حالة انكشفت بالتشغيل، مذكورة لا مخفيّة (نصّ الأمر: "وإن رفض فحصُ
  // الأرقام السرد المجمَّد... فاذكر ذلك ولا تُضعف الفحص")**: تبديل N-10 إلى
  // fail يُغيّر categoryStates.categories.wireless من MEASURED (6/6 pass)
  // إلى PARTIAL (5/6) — فتختفي القضية `POS-wireless` ("لا أعطاب...") من
  // issues[] الحقيقية، بينما narrative.issueDescriptions المُجمَّدة (من
  // رحلة نموذج حقيقية على categoryStates *الأصلية* غير المُعدَّلة) لا تزال
  // تحمل مفتاح `POS-wireless` — فيرفضه حارس issueKeys (validateIssueDescriptionKeys،
  // reportShapeV7.js) بصفته "مُخترَعاً" (inventedIds)، **قبل** أن يصل
  // التقييم إلى adjustments إطلاقاً — لا علاقة لهذا الرفض بموضوع هذا
  // الاختبار (دليل adjustments)، بل بعدم اتّساق نصّ مُجمَّد مع بيانات
  // مُعدَّلة عمداً بعده. الإصلاح: حذف هذا المفتاح الوحيد من
  // issueDescriptions (لا تعديل آخر على narrative، ولا لمس لحارس issueKeys
  // نفسه) — نفس أسلوب تحقّق ٢ أعلاه (استبدال حقل واحد مُسمّى بدل إخماد
  // الحارس). مُتحقَّق بالتشغيل المباشر قبل كتابة هذا الاختبار: بدون هذا
  // الحذف guardFinal.ok=false (issueKeys.ok=false، inventedIds=["POS-wireless"])
  // ورفضان متتاليان تماماً كتحقّق ٣ أعلاه، فتسقط adjustments فارغة قبل أن
  // تُقيَّم — لا مرجع "دليل" يصل applyV7Adjustments أصلاً في تلك الحالة.
  const functionalN10Fail = functional.map((r) =>
    (r.testId === 'N-10' ? Object.assign({}, r, {status: 'fail', rawValue: '-95'}) : r));
  const findingsN10Fail = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functionalN10Fail, manualResults: []});
  const categoryStatesN10Fail = computeCategoryStates({
    functionalResults: functionalN10Fail, manualResults: [], dev: null, findings: findingsN10Fail,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const n10IndexForWiring = categoryStatesN10Fail.testResults.findIndex((t) => t.testId === 'N-10');
  ok(n10IndexForWiring >= 0, '[إعداد ٤] N-10 موجودة في testResults');
  eq(categoryStatesN10Fail.testResults[n10IndexForWiring].raw.status, 'fail', '[إعداد ٤] raw.status=\'fail\' كما وصل (لم يتغيّر)');
  eq(categoryStatesN10Fail.testResults[n10IndexForWiring].outcome, 'NOT_MEASURED', '[إعداد ٤] outcome بعد القلب = NOT_MEASURED');
  const L0Wireless = categoryStatesN10Fail.categories.wireless.deterministicLetter;
  ok(!categoryStatesN10Fail.issues.some((x) => x.id === 'POS-wireless'), '[إعداد ٤] POS-wireless غائب فعلاً من categoryStates المُعدَّلة (تحقّق الحاجة الفعلية للحذف أدناه)');

  const fakeAdjustmentContent = JSON.parse(derivedFixture.rawEnvelope.choices[0].message.content);
  // الإصلاح الوحيد المذكور أعلاه — لا تعديل آخر على narrative/crossChecks/modelObservations.
  delete fakeAdjustmentContent.narrative.issueDescriptions['POS-wireless'];
  // أمر 2026-10-06 (المبدأ: حذف findings.channels): النسخة المشتقّة تقول «46%» وهي تغطية
  // الفحص الحقيقي لـb45c8cf6 (45.9%). هذا القسم يقلب N-10 إلى fail فتصير التغطية 45.2%
  // (مقيس: scratchpad/dbg-s4b.js) — و46 خارج تسامح 1% عن 45.2. كان الرقم 45 يُقبَل هنا بتسامحه
  // مع 45.2، لا بقيمة قناة. فيُستبدَل رقم التغطية وحده بقيمة هذا المُدخل المعدَّل عمداً؛ لا حارس يُضعَف.
  {
    const before = JSON.stringify(fakeAdjustmentContent);
    const after = before.split('46%').join('45%');
    eq(before.split('46%').length - 1, 5, '[إعداد ٤] «46%» في خمسة مواضع (summary, details, verdict, buyerAdvice.casual, crossChecks[1])');
    Object.assign(fakeAdjustmentContent, JSON.parse(after));
  }
  // الاستبدال الوحيد المقصود فعلاً — adjustments كاملة، بطلب wireless مصنوع
  // يستشهد بالحالة الخام (raw.status) لـN-10 — أضعف مرجع مُثبَت من الستّة
  // المدروسة في القرار ٨٧-٣ (lastKeyName='status' لكن قيمته 'fail' لا 'FIRED').
  fakeAdjustmentContent.adjustments = [
    {category: 'wireless', direction: 'DOWN', maxOneBand: true,
      evidenceRefs: [`categoryStates.testResults[${n10IndexForWiring}].raw.status`], reason: 'N-10 fail'},
  ];
  const fakeAdjustmentEnvelope = Object.assign({}, derivedFixture.rawEnvelope, {
    choices: [{message: {content: JSON.stringify(fakeAdjustmentContent)}, finish_reason: 'stop'}],
  });

  fetchQueue = [fakeAdjustmentEnvelope];
  fetchCallCount = 0;
  const r4 = await resolveV7Report({
    findings: findingsN10Fail, categoryStates: categoryStatesN10Fail, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-stubbed', geminiApiKey: undefined,
  });

  // شروط مسبقة (نصّ الأمر: "يُفحص fetchCallCount===1 وguardFinal.ok===true
  // شرطين مسبقين، لا guard.ok===false"): إن أخفق أحدهما فالاختبار كلّه بلا
  // معنى (يعني رفضاً بسبب آخر غير موضوع الاختبار، أو استهلاك محاولة ثانية).
  eq(fetchCallCount, 1, '[٤][شرط مسبق] مقبول من المحاولة الأولى — fetch=1 (لا رفض شكلي/اتّساق يستهلك محاولة ثانية)');
  eq(r4.guardFinal.ok, true, '[٤][شرط مسبق] guardFinal.ok=true — الردّ المصنوع اجتاز الحارس الشكلي (shape/issueKeys/numbers/languageLeaks) فوصل adjustments فعلاً');

  const wirelessAdj = r4.audit.adjustments.find((a) => a.category === 'wireless');
  ok(!!wirelessAdj, '[٤] سجلّ wireless موجود في audit.adjustments (وصل التقييم فعلاً، لم يُسقَط قبله)');
  eq(wirelessAdj.applied, false, '[٤][الأهمّ] applied=false — التخفيض المصنوع بدليل "N-10 fail" مرفوض. لو كان applied=true هنا: توقّف وأبلغ (نصّ الأمر) — لم يقع.');
  eq(wirelessAdj.rejectedReason, 'EVIDENCE_NOT_PROVEN',
      '[٤] rejectedReason=EVIDENCE_NOT_PROVEN (raw.status=\'fail\' لا يُقبل أبداً — lastKeyName=\'status\' يتطلّب \'FIRED\' حصراً)');
  eq(r4.display.categories.wireless.letterSource, 'DETERMINISTIC', '[٤] letterSource(wireless)=DETERMINISTIC — لا LLM_ADJUSTED');
  eq(r4.display.categories.wireless.letter, L0Wireless, `[٤] letter(wireless) بلا تغيير (يبقى ${L0Wireless})`);
  console.log(`تحقّق ٤ [القرار ٨٧/٨٨-٣]: ردّ نموذج مصنوع يطلب تخفيض wireless بدليل "N-10 fail" (raw.status) — مرفوض فعلاً (EVIDENCE_NOT_PROVEN)، letterSource=DETERMINISTIC، letter=${L0Wireless} بلا تغيير`);

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — «الإعدادات لا تُنزل الحرف» (أمر مستخدم 2026-09-27 +03، البند ٢):
  // اختبار الحارس المطلوب صراحة — ردّ نموذج مصنوع يطلب تخفيض security
  // بدليل SEC-05، يُرفض بـEVIDENCE_EXCLUDED_FROM_GRADE (buildV7Payload.js:
  // 543-545، isExcludedFromGrade — يقرأ healthBearing مباشرة، لا قائمة IDs
  // موازية). بالمسار كاملاً (القاعدة 37، نفس نمط تحقّق ٤ أعلاه).
  //
  // SEC-05 في الفخّ الحقيقي warning لا fail — وisProvenSupportiveEvidence
  // (القرار ٩٤-١) يقبل outcome==='FAIL' حصراً، فبقاؤها warning كان سيُرفَض
  // EVIDENCE_NOT_PROVEN قبل الوصول لشقّ الاستبعاد من الحرف أصلاً (لا يثبت
  // ما يُختبَر هنا). لذا SEC-05 مُحوَّلة إلى status:'fail' — مُدخل مشتقّ من
  // الفخّ الحقيقي (القاعدة 30)، لا نصّ مُختلَق: تجاوز عمداً شقّ "الإثبات"
  // كي يصل التقييم إلى شقّ "الاستبعاد من الحرف" تحديداً، موضوع هذا الاختبار.
  const functionalSec05Fail = functional.map((r) =>
    (r.testId === 'SEC-05' ? Object.assign({}, r, {status: 'fail'}) : r));
  const findingsSec05Fail = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functionalSec05Fail, manualResults: []});
  const categoryStatesSec05Fail = computeCategoryStates({
    functionalResults: functionalSec05Fail, manualResults: [], dev: null, findings: findingsSec05Fail,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  const sec05IndexForWiring = categoryStatesSec05Fail.testResults.findIndex((t) => t.testId === 'SEC-05');
  ok(sec05IndexForWiring >= 0, '[إعداد ٥] SEC-05 موجودة في testResults');
  eq(categoryStatesSec05Fail.testResults[sec05IndexForWiring].outcome, 'FAIL', '[إعداد ٥] outcome بعد القلب = FAIL (يتجاوز شقّ الإثبات)');
  eq(categoryStatesSec05Fail.testResults[sec05IndexForWiring].healthBearing, false, '[إعداد ٥] SEC-05.healthBearing=false (المجموعة الأولى، أمر 2026-09-27)');
  const L0Security = categoryStatesSec05Fail.categories.security.deterministicLetter;
  eq(L0Security, 'D', '[إعداد ٥] security تبقى D (SEC-04 لا يزال الجذر — بلا تغيير)');

  const fakeAdjustmentContent5 = JSON.parse(derivedFixture.rawEnvelope.choices[0].message.content);
  fakeAdjustmentContent5.adjustments = [
    {category: 'security', direction: 'DOWN', maxOneBand: true,
      evidenceRefs: [`categoryStates.testResults[${sec05IndexForWiring}].outcome`], reason: 'SEC-05 fail'},
  ];
  const fakeAdjustmentEnvelope5 = Object.assign({}, derivedFixture.rawEnvelope, {
    choices: [{message: {content: JSON.stringify(fakeAdjustmentContent5)}, finish_reason: 'stop'}],
  });

  fetchQueue = [fakeAdjustmentEnvelope5];
  fetchCallCount = 0;
  const r5 = await resolveV7Report({
    findings: findingsSec05Fail, categoryStates: categoryStatesSec05Fail, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-stubbed', geminiApiKey: undefined,
  });

  eq(fetchCallCount, 1, '[٥][شرط مسبق] مقبول من المحاولة الأولى — fetch=1');
  eq(r5.guardFinal.ok, true, '[٥][شرط مسبق] guardFinal.ok=true — الردّ المصنوع اجتاز الحارس الشكلي فوصل adjustments فعلاً');

  const securityAdj5 = r5.audit.adjustments.find((a) => a.category === 'security');
  ok(!!securityAdj5, '[٥] سجلّ security موجود في audit.adjustments');
  eq(securityAdj5.applied, false, '[٥][الأهمّ] applied=false — التخفيض المصنوع بدليل SEC-05 مرفوض. لو applied=true: توقّف وأبلغ — لم يقع.');
  eq(securityAdj5.rejectedReason, 'EVIDENCE_EXCLUDED_FROM_GRADE',
      '[٥][الأهمّ] rejectedReason=EVIDENCE_EXCLUDED_FROM_GRADE — isExcludedFromGrade (buildV7Payload.js:543-545) يرفض SEC-05 لأن healthBearing!==true');
  eq(r5.display.categories.security.letterSource, 'DETERMINISTIC', '[٥] letterSource(security)=DETERMINISTIC — لا LLM_ADJUSTED');
  eq(r5.display.categories.security.letter, L0Security, `[٥] letter(security) بلا تغيير (يبقى ${L0Security})`);
  console.log(`تحقّق ٥ [أمر 2026-09-27]: ردّ نموذج مصنوع يطلب تخفيض security بدليل SEC-05 (fail، مشتقّ) — مرفوض فعلاً (EVIDENCE_EXCLUDED_FROM_GRADE)، letterSource=DETERMINISTIC، letter=${L0Security} بلا تغيير`);

  console.log(`\napplyV7AdjustmentsWiring.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
