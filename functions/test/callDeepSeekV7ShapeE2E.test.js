'use strict';

// callDeepSeekV7ShapeE2E.test.js — أمر مستخدم 2026-09-23 +03، القرار ٣
// ("اختبار المسار كاملاً، وهو الأهمّ") والقاعدة 37 الجديدة (CLAUDE.md،
// مساحة العمل): "الاختبار الذي يستبدل الطبقة التي قد ترفض لا يفحصها. وكل
// مسار يمرّ به الإنتاج يحتاج اختباراً واحداً على الأقلّ لا يستبدل شيئاً
// منه."
//
// العلّة التي يُغلقها هذا الملفّ (نصّ المستخدم): ثلاث طبقات اختبار قائمة
// كلّها تستبدل الطبقة التي قد ترفض — سُمِّيت هنا بلا حذف (لا تزال تفحص
// أشياء أخرى صحيحة، فلا تُمَسّ):
//   • test/callAIv7.test.js            — يستبدل require.cache لِـ
//     src/analysis/callDeepSeek.js وsrc/analysis/callGemini.js بالكامل؛
//     deepseekBehavior يُعيد كائناً جاهزاً مباشرة — ensureReportShape/
//     resolveReport لا يُنفَّذان إطلاقاً.
//   • test/resolveV7Report.test.js     — نفس النمط بالضبط (تعليق رأسه
//     يقول حرفياً: "بكعوب كاملة لـcallDeepSeek/callGeminiFallback").
//   • test/runAnalysisInternalV7Branch.test.js — يستبدل src/analysis/
//     callAI.js نفسها (طبقة أعلى)، فيتجاوز حتى guardV7Response.
// وواحد قائم يفعل الصواب جزئياً: test/aiCallShape.test.js يستبدل حدود
// الشبكة فقط (global.fetch + مُنشئ SDK جيميناي الخارجي) ويُبقي
// ensureReportShape/resolveReport حقيقيّين — لكنه يفحص شكل V3/V6
// ({grade,score}) فقط، ولا يدخل من resolveV7Report/callAIv7 إطلاقاً.
//
// هذا الملفّ: **globalThis.fetch وحده** هو حدّ الاستبدال (+ فخّ Firestore
// القياسي في utils/admin.js — resolveAiConfig يسقط آمناً للافتراضي عند
// فشله، لا بديل حقيقي لمنطقه، ونفس النمط المستعمَل في كل ملفّات هذا
// المستودع التي تختبر مساراً يمرّ به). كل شيء آخر حقيقي غير مُعدَّل:
// resolveV7Report → callAIv7 → callDeepSeekWithRetry → callDeepSeek →
// ensureReportShape → guardV7Response.
//
// الحمولة: rawEnvelope الكامل كما وصل فعلياً من DeepSeek في نداءين
// مأذونين حقيقيّين سابقين (2026-09-22 23:39/23:40 +03،
// scripts/out/v7-live-*-2026-09-22T23-{39,40}-*.json) — صفر حقل مُضاف،
// صفر تعديل، وتبقى كذلك (أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي
// المسجَّل لا يُعدَّل» — كلا الملفّين tracked وبلا مساس). المتوقَّع قيمةً
// (القاعدة 30) عند كتابة هذا الملفّ أصلاً (2026-09-23 +03):
//   34dff2b8 (23:40) → guard.ok=true،  fetch مرّة واحدة.
//   b45c8cf6 (23:39) → guard.ok=false بسبب "ot" وحده (لا "Wh") — يُعاد
//     توليده مرّة (القرار ٢١)، والجسم الحقيقي نفسه يتكرّر بلا تعديل
//     (النموذج شبه حتمي عند temperature=0.1 — واقعي، لا تلفيق) فيُرفَض
//     ثانيةً بنفس السبب؛ fetch مرّتان، guardFinal.ok=false.
//
// ⚠️ **تحديث لاحق (2026-09-27 +03 → 2026-09-30 +03)** — أمر «الإعدادات لا
// تُنزل الحرف» (testKinds.js) غيّر categoryStates لكلا الفِخّين. 34dff2b8
// صار **مرفوضاً هو أيضاً** الآن (issueKeys: ستّة معرّفات مخترَعة، نفس
// آلية b45c8cf6 في applyV7AdjustmentsWiring.test.js؛ numbers: "45" غير
// مطابق في أربع حقول — على هذا الجهاز لا مصادفة رقمية تُنجيه، خلافاً
// لـb45c8cf6 نفسه). مُتحقَّق بتشغيل مباشر — راجع السيناريو ١ أدناه. الملفّ
// المسجَّل نفسه بلا مساس (القاعدة أعلاه) — النتيجة تغيّرت، لا الردّ.
//
// Run: node functions/test/callDeepSeekV7ShapeE2E.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, '..', 'scripts', 'out');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadLive(name) { return JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8')); }

// ─── فخّ Firestore — القياسي في كل ملفّات هذا المستودع التي تختبر مساراً
// يمرّ بـresolveAiConfig (admin.js حقيقي غير مُعدَّل بنيوياً، db.collection
// وحده يرمي فوراً كي لا يُحاوَل اتصال حقيقي) ───────────────────────────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

// ─── حدّ الاستبدال الوحيد لهذا الملفّ: globalThis.fetch — يُعيد rawEnvelope
// الحقيقي المسجَّل حرفياً، بلا أي تعديل على محتواه ──────────────────────
let fetchQueue = [];
let fetchCallCount = 0;
global.fetch = async (url) => {
  fetchCallCount++;
  if (!String(url).includes('api.deepseek.com')) {
    throw new Error(`TRAP: unexpected fetch host in this test: ${url}`);
  }
  if (fetchQueue.length === 0) throw new Error('TRAP: fetch queue empty — سيناريو لم يُهيَّأ بما يكفي');
  const envelope = fetchQueue.shift();
  return {
    ok: true, status: 200,
    json: async () => envelope,
    text: async () => JSON.stringify(envelope),
  };
};

// ─── الدوالّ الحقيقية بلا استبدال — بعد الفخّين أعلاه ──────────────────
const {resolveV7Report} = require('../src/analysis/resolveV7Report');
const {callDeepSeek} = require('../src/analysis/callDeepSeek');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {V7_SHAPE_KEYS, V7_CORE_KEY_GROUPS} = require('../src/analysis/reportShapeV7');

// ─── الأجسام الحقيقية — rawEnvelope الكامل كما التقطه نداء حيّ مأذون فعلي
// (2026-09-22 23:39/23:40 +03)، بلا أي حقل مُضاف ───────────────────────
const REAL_B45_REJECTED = loadLive('v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844-2026-09-22T23-39-25-313Z.json').rawEnvelope;
const REAL_34D_ACCEPTED = loadLive('v7-live-34dff2b8-ce9e-4b40-86a9-1976c878e195-2026-09-22T23-40-34-274Z.json').rawEnvelope;

function buildScanInputs(scanId, tsFile) {
  const raw = loadGolden(tsFile);
  const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
  const functional = frMap[scanId];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });
  return {findings, categoryStates};
}

const B45 = buildScanInputs('b45c8cf6-e376-4765-8703-f68e9bc69844', 'b45c8cf6.ts.json');
const D34 = buildScanInputs('34dff2b8-ce9e-4b40-86a9-1976c878e195', '34dff2b8.ts.json');

// ─── التقاط console.warn/error/log أثناء كل تشغيلة — يُثبت "صفر
// shape_invalid" بلا تخمين: shape_invalid يُطبَع حرفياً في سطر "attempt N
// failed (kind=shape_invalid)" (callAI.js:80) أو في رسالة الرمي نفسها لو
// فشلت المحاولتان. لا اعتماد على قراءة الكود المصدر وقت الاختبار — رصد
// فعلي لكل ما يُطبَع أثناء التشغيلة.
(async () => {
  async function runCaptured(fn) {
    const lines = [];
    const realWarn = console.warn; const realError = console.error; const realLog = console.log;
    console.warn = (...a) => lines.push(String(a.join(' ')));
    console.error = (...a) => lines.push(String(a.join(' ')));
    console.log = (...a) => lines.push(String(a.join(' ')));
    try {
      const result = await fn();
      return {result, lines, threw: null};
    } catch (e) {
      return {result: null, lines, threw: e};
    } finally {
      console.warn = realWarn; console.error = realError; console.log = realLog;
    }
  }

  // ── السيناريو ١ — أمر مستخدم 2026-09-30 +03 «الردّ الحقيقي المسجَّل لا
  // يُعدَّل»: REAL_34D_ACCEPTED ملفّ مسجَّل فعلياً (v7-live-34dff2b8-...json،
  // tracked وبلا مساس — git status نظيف، مُتحقَّق) فلا يُعدَّل هنا مهما
  // تغيّرت النتيجة. وقد تغيّرت فعلاً: بعد أمر 2026-09-27 +03 «الإعدادات لا
  // تُنزل الحرف» صار هذا الردّ نفسه **مرفوضاً** على categoryStates الجديدة
  // (D34 أعلاه، مبنيّة بـtestKinds.js الحالي) — لم يعد "مقبولاً من الأولى".
  // هذا الملفّ غرضه تحديداً اختبار ما يفعله المسار الحقيقي بردّ حقيقي غير
  // مُعدَّل (رأس الملفّ، القاعدة 37) — فلا فِخّ "مشتقّ" هنا (ذلك يخصّ ملفّات
  // أخرى تحتاج ردّاً *مقبولاً* لاختبار شيء غير الحارس نفسه)؛ الاختبار
  // الصحيح الآن هو تسجيل الرفض الحقيقي بسببَيه الحقيقيَّين (مُتحقَّق
  // بتشغيل مباشر — راجع تقرير هذه المهمّة):
  //   issueKeys: نفس الستّة المخترَعة كما في b45c8cf6 (DISC-T-01/T-02/
  //     CM-08، ISS-SEC-05/06، DISC-SEC-07) — نفس الآلية، جهاز مختلف. **+ISS-S-06
  //     (أمر مستخدم 2026-10-01 +03، البند ١ — C-07/S-06 إلى آلية العتبة غير
  //     المعايَرة، testKinds.js): S-06 لم تعد healthBearing، فلم يعد
  //     buildDeterministicIssues يُنتج ISS-S-06 حتمياً — والردّ الحقيقي
  //     المسجَّل (REAL_34D_ACCEPTED، لم يُعدَّل، القاعدة 37/12) لا يزال
  //     يستشهد به، فصار "مخترَعاً" (سبعة الآن لا ستّة) — مُتحقَّق بتشغيل
  //     مباشر، لا افتراضاً.**
  //   numbers: "45" غير مطابق في أربعة حقول (summary/details/verdict/
  //     crossChecks[1]) — على هذا الجهاز تحديداً لا مصادفة تُنجيها (خلافاً
  //     لـb45c8cf6 حيث طابقت رقماً حقيقياً آخر بالصدفة — راجع
  //     applyV7AdjustmentsWiring.test.js تحقّق ١ب).
  //
  // ⚠️ **unmatchedFields أُعيد قياسه — مهمّة 2026-10-01 (بنود ٢-٥، إخفاء القيم
  // غير المعايَرة عن حمولة النموذج)**: البند ٢ حجب findings.sustainedCeiling/
  // graphics ومؤشّرات البطارية BAT-* (راجع buildV7Payload.js/
  // v7ModelPayloadWhitelist.js)، وcallAI.js صار يمرّر body.findings/
  // body.categoryStates (المحجوبين، كما غادرا فعلاً إلى النموذج) لا
  // p.findings/p.categoryStates الخام — تصحيح أمني (راجع تعليق callAI.js
  // وتقرير هذه المهمّة). فالأرقام التي يستشهد بها REAL_34D_ACCEPTED من هذه
  // المسارات (نِسَب السقف المستدام وطوري الرسوميات ومؤشّرات البطارية) لم
  // تعد مطابَقة — مُتحقَّق بتشغيل مباشر (لا تخمين، القاعدة 40)، ومصدر كل رقم
  // مُتحقَّق في findings الخام لهذا الجهاز قبل الحجب (sustainedCeiling:
  // phase3.meanWindowMaxRatio=0.84825…→0.8483، recoveryPhase7Ratio=0.71428…
  // (الكثير من القيم القريبة من 0.70-0.78 طابقت بالصدفة رقماً آخر في الحمولة
  // ضمن تسامح numberMatches ±0.05 المطلَق للأرقام الصغيرة — لم تُمَسّ هذه
  // الدالّة، القاعدة 16)؛ graphics: phase4DriftRatio=0.85360…→0.8536،
  // vsyncLockSampleCount=530 بلا تسامح قريب فيُرفض دوماً؛ مؤشّرات البطارية:
  // "تكامل شحنة 139.91 mAh" و"تيار 1647.85 mA" و"معامل 1.57" في narrative.details
  // النصّي — كلّها الآن محجوبة فعلاً، لا مصدر لها في body). "45" (التغطية
  // العامة) يبقى كما كان — لا علاقة له بهذه المهمّة. القيمة 4400/188/9.1
  // ونحوها (مواصفات جهاز STATE/SPEC حقيقية حاضرة في body.testResults، مثل
  // B-02/S-03/C-06) **تبقى مطابَقة** ولا تظهر هنا — راجع تصحيح callAI.js
  // (دمج body.testResults تحت categoryStates.testResults لمرجع الحارس،
  // بعد أن كشفه هذا الاختبار بالذات بتشغيل مباشر: 9820 — رقم هوية الشريحة
  // Exynos 9820 من C-05 — ظهر مرفوضاً خطأً قبل هذا التصحيح الثاني).
  fetchQueue = [REAL_34D_ACCEPTED, REAL_34D_ACCEPTED]; // نفس الجسم الحقيقي مرّتين — لا تعديل، تكرار واقعي عند temperature=0.1 (نفس أسلوب تحقّق ٢ أدناه)
  fetchCallCount = 0;
  const r1 = await runCaptured(() => resolveV7Report({
    findings: D34.findings, categoryStates: D34.categoryStates, language: 'ar',
    scanContext: {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-is-stubbed', geminiApiKey: undefined,
  }));
  ok(!r1.threw, `[١] resolveV7Report لا يرمي — رفض الحارس ليس فشلاً صلباً (القرار ٢١) (${r1.threw && r1.threw.message})`);
  eq(r1.result && r1.result.guardFinal.ok, false, '[١][أمر 2026-09-30] guardFinal.ok=false — الردّ الحقيقي الأصلي مرفوض على categoryStates الجديدة (كان true قبل أمر 2026-09-27)');
  eq(r1.result.guardFinal.issueKeys.ok, false, '[١] issueKeys.ok=false');
  eq(JSON.stringify(r1.result.guardFinal.issueKeys.inventedIds.slice().sort()),
      JSON.stringify(['DISC-CM-08', 'DISC-SEC-07', 'DISC-T-01', 'DISC-T-02', 'ISS-S-06', 'ISS-SEC-05', 'ISS-SEC-06'].slice().sort()),
      '[١] inventedIds = المعرّفات السبعة بعينها (كانت ستّة قبل أمر 2026-10-01 +03 — +ISS-S-06)');
  eq(r1.result.guardFinal.numbers.ok, false, '[١] numbers.ok=false');
  eq(JSON.stringify(r1.result.guardFinal.numbers.unmatchedFields),
      JSON.stringify([
        {field: 'narrative.summary', numbers: [45]},
        {field: 'narrative.details', numbers: [45, 61.7, 0.8483, 1920.3, 0.5642, 0.8536, 90, 120, 530, 2597, 31.3, 2359, 98932, 2.6, 33.3, 38, 4400, 3782.75, 0.8597, 139.91, 1647.85, 46.46, 1.57, 32.8, 1.73]},
        {field: 'narrative.verdict', numbers: [45]},
        {field: 'narrative.buyerAdvice.casual', numbers: [31.3]},
        {field: 'narrative.buyerAdvice.gamer', numbers: [1.73, 1920.3, 0.5642, 0.8483, 530]},
        {field: 'narrative.buyerAdvice.photographer', numbers: [31.3, 2597]},
        {field: 'narrative.issueDescriptions[ISS-S-06]', numbers: [2597]},
        {field: 'crossChecks[0].description', numbers: [61.7]},
        {field: 'crossChecks[1].description', numbers: [45, 33.3]},
        {field: 'crossChecks[2].description', numbers: [1920.3, 0.5642, 530]},
        {field: 'crossChecks[3].description', numbers: [32.8, 1.73]},
        {field: 'crossChecks[4].description', numbers: [31.3, 2597, 2359, 98932]},
        {field: 'modelObservations[0].text', numbers: [0.8483]},
        {field: 'modelObservations[1].text', numbers: [3782.75, 0.8597, 4400]},
      ]),
      '[١][مهمّة 2026-10-01 + أمر 2026-10-06 المبدأ + أمر 2026-10-07 قرار القوائم وحدود الرقم (90 و120 و2.6 و33.3 و0.5642 صارت مرئية — ملاصقة لحرف أو علامة عربية)] unmatchedFields بعينها (بعد حجب S-02/B-xx: 31.3 و4400 و32.8 و3782.75 صارت بلا سند) — "45" كما كان + أرقام محجوبة (سقف مستدام/رسوميات/بطارية/S-06/UNSTABLE/حرارة) + أرقام كانت تُقبَل بمصادفة تسامح القنوات (61.7 و33.3 و38 و1.73…) بعد حذف findings.channels');
  ok(r1.result.guardFinal.detailsWaived &&
      JSON.stringify(r1.result.guardFinal.detailsWaived.numbers) === JSON.stringify([45, 61.7, 0.8483, 1920.3, 0.5642, 0.8536, 90, 120, 530, 2597, 31.3, 2359, 98932, 2.6, 33.3, 38, 4400, 3782.75, 0.8597, 139.91, 1647.85, 46.46, 1.57, 32.8, 1.73]),
      '[١][البند ٤] detailsWaived.numbers يطابق أرقام details بعينها — معفاة من الرفض لأنها في details وحده');
  eq(fetchCallCount, 2, '[١] طلبا fetch — محاولة أولى مرفوضة + إعادة توليد واحدة (القرار ٢١)، نفس السبب مرّتين');
  ok(!r1.lines.some((l) => /shape_invalid/.test(l)), '[١] صفر ذكر لـshape_invalid — الرفض دلالي (issueKeys/numbers) لا بنيوي');
  console.log('تحقّق ١ [مهمّة 2026-10-01]: 34dff2b8 — الردّ الحقيقي الأصلي صار مرفوضاً مرّتين (issueKeys+numbers في أحد عشر حقلاً بعد حجب البند ٢ وأمر 2026-10-06)، fetch=2، صفر shape_invalid');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — b45c8cf6: يُرفَض مرّتين بنفس السبب الحقيقي ("ot")، fetch مرّتان،
  // guardFinal.ok=false، narrativeIncomplete=true، صفر shape_invalid.
  //
  // ⚠️ **"Wh" عاد للظهور — مهمّة 2026-10-01 (البند ٢)، بتشغيل مباشر لا
  // تخمين**: إعفاء "Wh" (الفئة الخامسة البنيوية، reportShapeV7.js:499-554 —
  // أي مفتاح ينتهي اسمه بـ"unit" في findings/categoryStates يُعفي قيمته)
  // مصدره الحقيقي الموثَّق هناك: categoryStates.categories.battery.
  // batteryIndicators.BAT-THERMAL-EFF.unit="°C/Wh". والبند ٢ يستبدل كائن
  // BAT-THERMAL-EFF كاملاً بـ{id,status,note} (redactUncalibratedBattery
  // IndicatorsForModelPayload) — فحقل .unit نفسه يختفي من الحمولة، ومعه
  // مصدر إعفاء "Wh" البنيوي. فالردّ الحقيقي المسجَّل هذا (REAL_B45_REJECTED،
  // لم يُعدَّل، القاعدة 37/12) الذي يستشهد بـ"Wh" في narrative.details
  // يُرفَض توكِنه الآن فعلاً — ولا سبب لاستثنائه: الوحدة التي كانت تبرّره
  // لم تعد في الحمولة. مُتحقَّق بتشغيل مباشر: "Wh" يظهر في narrative.details
  // فقط (مع "ot" نفسه)، وهو حقل مُعفًى من الرفض بالبند ٤ (تفاصيل لا تصل
  // المشتري) — فلا يُغيّر هذا guardFinal.ok (يبقى false بسبب "ot" في خمسة
  // حقول أخرى غير details: summary/verdict/buyerAdvice.casual/
  // issueDescriptions[ISS-SEC-04]/crossChecks[0]).
  // ═══════════════════════════════════════════════════════════════════
  fetchQueue = [REAL_B45_REJECTED, REAL_B45_REJECTED]; // نفس الجسم الحقيقي مرّتين — لا تعديل، تكرار واقعي عند temperature=0.1
  fetchCallCount = 0;
  const r2 = await runCaptured(() => resolveV7Report({
    findings: B45.findings, categoryStates: B45.categoryStates, language: 'ar',
    scanContext: {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false},
    previousScan: null, deepseekApiKey: 'irrelevant-fetch-is-stubbed', geminiApiKey: undefined,
  }));
  ok(!r2.threw, `[٢] resolveV7Report لا يرمي — رفض الحارس ليس فشلاً صلباً (القرار ٢١) (${r2.threw && r2.threw.message})`);
  eq(r2.result && r2.result.guardFinal.ok, false, '[٢] guardFinal.ok=false — بعد إعادة التوليد، السبب الحقيقي "ot" (خارج details)');
  const finalLeaksByPath = r2.result.guardFinal.languageLeaks || [];
  const finalLeakTokens = finalLeaksByPath.map((l) => l.tokens).flat();
  const nonDetailsLeakTokens = finalLeaksByPath.filter((l) => l.path !== 'narrative.details').map((l) => l.tokens).flat();
  ok(finalLeakTokens.includes('ot'), '[٢] "ot" حاضر في guardFinal.languageLeaks — نفس العطب الحقيقي، لا تلفيق');
  ok(!nonDetailsLeakTokens.some((t) => /^wh$/i.test(t)),
      '[٢][مهمّة 2026-10-01] "Wh" غائب عن كل حقل غير details — لا يُسقط guardFinal.ok (البند ٤)');
  const detailsLeak = finalLeaksByPath.find((l) => l.path === 'narrative.details');
  ok(detailsLeak && detailsLeak.tokens.includes('Wh'),
      '[٢][مهمّة 2026-10-01] "Wh" ظاهر في narrative.details تحديداً — إعفاؤه البنيوي زال بحجب BAT-THERMAL-EFF.unit (البند ٢)، معفًى من الرفض لا من التسجيل (البند ٤)');
  eq(fetchCallCount, 2, '[٢] طلبا fetch بالضبط — محاولة أولى مرفوضة + إعادة توليد واحدة (القرار ٢١)، بلا محاولة ثالثة');
  eq(r2.result.display.narrativeIncomplete, true, '[٢] narrativeIncomplete=true على display — الحقول المرفوضة حُذفت لا عُرضت خطأً');
  ok(!r2.lines.some((l) => /shape_invalid/.test(l)), '[٢] صفر ذكر لـshape_invalid — الرفض بسبب لغة لا شكل');
  console.log('تحقّق ٢ [مهمّة 2026-10-01]: b45c8cf6 — يُرفَض مرّتين بسبب "ot" خارج details (و"Wh" داخل details وحده، معفًى)، fetch=2، guardFinal.ok=false، narrativeIncomplete=true، صفر shape_invalid');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — ضابط: مسار V6 (بلا shapeSpec) ما زال يرفض ردّاً بشكل V7 حقيقياً
  // (نفس REAL_34D_ACCEPTED، بلا أي تعديل) بـshape_invalid، وما زال يقبل
  // ردّاً بشكل V6.
  // ═══════════════════════════════════════════════════════════════════
  fetchQueue = [REAL_34D_ACCEPTED];
  fetchCallCount = 0;
  let v6RejectsV7 = null;
  try {
    await callDeepSeek('u', 's', 'k'); // بلا shapeSpec — الافتراضي V3/V5/V6
  } catch (e) {
    v6RejectsV7 = e;
  }
  ok(v6RejectsV7 && v6RejectsV7.kind === 'shape_invalid',
      `[٣-أ] مسار V6 (بلا shapeSpec) يرفض ردّ V7 حقيقياً غير مُعدَّل بـshape_invalid (كان: ${v6RejectsV7 && v6RejectsV7.kind})`);

  const v6Envelope = {
    model: 'deepseek-flash',
    choices: [{message: {content: JSON.stringify({
      summary: 'ملخّص V6 دنيا', grade: 'B', score: 80, details: 'د', verdict: 'ح',
      issues: [], predictedProblems: [], categoryScores: {}, buyerAdvice: 'ن', performanceContext: 'س',
    })}, finish_reason: 'stop'}],
    usage: {completion_tokens: 10},
  };
  fetchQueue = [v6Envelope];
  fetchCallCount = 0;
  let v6AcceptsV6 = null; let v6Err = null;
  try {
    v6AcceptsV6 = await callDeepSeek('u', 's', 'k');
  } catch (e) { v6Err = e; }
  ok(v6AcceptsV6 && !v6Err, `[٣-ب] مسار V6 (بلا shapeSpec) يقبل ردّ V6 الشكل كما كان دائماً (خطأ: ${v6Err && v6Err.message})`);
  eq(v6AcceptsV6 && v6AcceptsV6.grade, 'B', '[٣-ب] المحتوى المقبول سليم (grade=B) — لا تغيير سلوكي على V6');
  console.log('تحقّق ٣: ضابط — V6 ما زال يرفض شكل V7 الحقيقي، وما زال يقبل شكل V6 كما كان — البند ١ لم يُغيّر سلوك V6');

  console.log(`\ncallDeepSeekV7ShapeE2E.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
