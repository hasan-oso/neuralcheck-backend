#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-client-payload-sample — يبني عيّنة واحدة من كائن الإرجاع
// الفعلي لفرع V7 (ما يصل تطبيق NeuralChek حرفياً من analyzeDevice)، من
// مُدخلات المخزون وحدها — **صفر نداء نموذج**.
// ===================================================================
//
// الغرض (نصّ أمر المهمّة 2026-09-21 +03، الجلسة اللاحقة بعد A112):
// وكيل التطبيق بنى طبقة قراءة V7 من العقد المنقول نصّاً، غير مُتحقَّقة
// مقابل عيّنة JSON حيّة. حاجز المستخدم: "أرني أن التطبيق يقرأ تقرير V7
// كاملاً ولا يسقط حقلاً — قبل أن يُبنى عرض عليه." هذا السكربت يُنتج تلك
// العيّنة، ويحسم خمسة افتراضات صرّح بها وكيل التطبيق (overall.coverage
// Double?، overall.coveragePct Int?، category.confidence String?،
// issues[] بشكل V6، narrative.buyerAdvice بشكل V6) — الجدول الحقيقي في
// نص التقرير المرافق لهذه المهمّة، لا هنا.
//
// ─── المسار المُطبَّق هنا حرفياً (بلا اختصار، بلا كائن يدوي) ─────────────
//   1. computeFindings(fingerprint)                                  → findings
//   2. sampleInputsFromRaw(raw) + computeCategoryStates({...})       → categoryStatesRaw
//   3. applyV7Adjustments(categoryStatesRaw, aiAnalysis.adjustments, findings)
//                                                                    → categoryStatesAdjusted
//      (buildV7Payload.js — نفس الدالّة التي يستهلكها المسار الحيّ،
//      راجع docs/V7_DISPLAY_SHAPE_CONTRACT.md §٢ لترتيب التركيب المُلزِم)
//   4. buildDisplayShapeV7({categoryStates, findings, aiAnalysis, language})
//                                                                    → {display, audit}
//   5. aiResult = display؛ يُضاف aiResult.isFreeTrial (analyzeDevice.js:388)
//   6. buildV7ResponseForStorage(aiResult)                           → aiResponseToSave
//      (analyzeDevice.js:120-169 — نفس الدالّة التي تُكتب بها Firestore
//      وتُعاد للعميل، حرفياً، بلا نسخة موازية — راجع تعليق analyzeDevice.js:577)
//   7. {...aiResponseToSave, ...operationalExtras}                   → الإرجاع النهائي
//      (analyzeDevice.js:637-643، operationalExtras مُشتقّة من
//      V7_OPERATIONAL_FIELDS — v7OperationalFields.js — لا تعداد يدوي)
//
// لا استدعاء لـ resolveV7Report.js ولا لمس runAnalysisInternal.js:300 (قيد
// صريح في أمر المهمّة) — هذا السكربت يستهلك الدوال المُصدَّرة القائمة فقط،
// بلا تعديل ولا وصل جديد. أثر هذا القيد على narrativeIncomplete/
// narrativeIncompleteFields مُسجَّل تحت "حقول خرجت null/افتراضية ولماذا"
// في تقرير المهمّة (تلك الحقلان من resolveV7Report.js فقط — غائبان هنا
// بحكم القيد، لا بعطب).
//
// ─── المُدخلات (من المخزون وحده، لا نداء نموذج) ─────────────────────────
//   findings/categoryStates: functions/test/fixtures/golden/34dff2b8.ts.json
//     + functionalResults-by-scanid.json["34dff2b8-ce9e-4b40-86a9-1976c878e195"]
//     (85 عنصر حقيقي — نفس فِخّاخ buildDisplayShapeV7.test.js/
//     runAnalysisInternalV7Branch.test.js). بناء fingerprint هنا يُطابق
//     functions/scripts/measure-callAIv7-live.js:99-103 حرفياً (نفس
//     السكربت الذي بنى userMessage الذي أنتج aiAnalysis أدناه فعلياً) —
//     {timeSeries: raw, functionalResults, manualResults: []}، **بلا
//     مفتاح device** (ذلك السكربت لم يحمله؛ device.model لا يدخل
//     computeFindings/computeCategoryStates إطلاقاً — تحقّق: findings.js
//     يشتقّ findings.device.deviceModel من timeSeries.header.deviceModel
//     مباشرة، لا من fingerprint.device — حقلان منفصلان). الأثر الوحيد:
//     rawDeviceModel (analyzeDevice.js:515) يسقط إلى "Unknown" — مُسجَّل
//     صراحةً تحت "حقول خرجت null/افتراضية" في التقرير، لا مُخترَع بديل.
//   aiAnalysis (narrative/crossChecks/adjustments/modelObservations):
//     functions/scripts/out/v7-live-34dff2b8-ce9e-4b40-86a9-1976c878e195.json
//     → .parsedResponse — **مخرَج نموذج حقيقي فعلي** (نداء V7 مأذون سابقاً
//     بنصّ مهمّة أخرى — راجع رأس measure-callAIv7-live.js — لا نداء جديد
//     هنا). ⚠️ .guard.ok = false على هذا الالتقاط تحديداً (أرقام غير
//     مطابقة في narrative.details/buyerAdvice) — في الإنتاج الحقيقي هذا
//     كان سيُطلق دورة إعادة توليد عبر resolveV7Report.js (غير مُستدعاة هنا
//     بحكم القيد أعلاه). buildDisplayShapeV7 نفسها لا تفحص guard.ok
//     (تعليقها الخاص: "تنسيق عرض بحت، لا سياسة قبول/رفض") فالتنسيق أدناه
//     صحيح بصرف النظر — لكن هذا يُسجَّل بصراحة، لا يُخفى.
//   isFreeTrial=false: القيمة الحقيقية المُستعمَلة فعلياً لبناء userMessage
//     الذي أنتج aiAnalysis هذا (measure-callAIv7-live.js:115، حرفياً
//     `isFreeTrial: false`) — لا افتراض معزول، تطابق مصدر aiAnalysis نفسه.
//   aiModel: v7-live JSON نفسه، الحقل الجذر .model = "deepseek-flash" (نفس
//     القيمة حرفياً في requestBody.model لنفس الملفّ) — مطابق لـ
//     DEFAULT_DEEPSEEK_MODEL (functions/src/utils/resolveAiConfig.js:44)
//     الذي يُصبح aiCfg.deepseekModel ثم aiModel في callAI.js:464/472 حين
//     DeepSeek ينجح (نجح هنا فعلاً — usage/finishReason حاضران في الملفّ).
//   shortId: generateShortId() الحقيقية (functions/src/utils/generateShortId.js)
//     — aiResult.shortId (=display.shortId) دائماً undefined على V7
//     (buildDisplayShapeV7.js لا يبني هذا الحقل إطلاقاً)، فـ
//     analyzeDevice.js:393-395 يسقط دائماً إلى generateShortId() على هذا
//     الفرع — نفس ما سيحدث فعلياً، لا اختصار.
//
// Run: node functions/scripts/generate-v7-client-payload-sample.js
// ===================================================================

const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin — لا Firestore (نفس نمط runAnalysisInternalV7Branch.test.js
// وaiAuditWiring.e2e.test.js). analyzeDevice.js يستورد admin عند require حتى
// لو لم يُستدعَ exports.analyzeDevice (onCall) أبداً هنا — لا نداء حقيقي على
// db في هذا السكربت، فالتوقيع الحارس (`db.collection` يرمي) لن يُلمَس أصلاً؛
// هو دفاع في العمق فقط، بنفس نمط الاختبارات القائمة.
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-client-payload-sample: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {applyV7Adjustments} = require('../src/analysis/buildV7Payload');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
// buildV7ResponseForStorage ليست exports.analyzeDevice (onCall) — دالّة
// مساعدة مُصدَّرة صراحةً من نفس الملفّ للاختبار المباشر بلا محاكي
// (analyzeDevice.js:657-660: "مُصدَّرة للاختبار المباشر بلا محاكي (A104)").
const {buildV7ResponseForStorage, stripNarrativeDetailsVerdictFromV7Response} =
    require('../src/analysis/analyzeDevice');
const {V7_OPERATIONAL_FIELDS} = require('../src/analysis/v7OperationalFields');
const {V7_PIPELINE_TAG} = require('../src/analysis/pipelineTags');
const {generateShortId} = require('../src/utils/generateShortId');

const GOLDEN_DIR = path.join(__dirname, '..', 'test', 'fixtures', 'golden');
const OUT_DIR = path.join(__dirname, 'out');
const SCAN_ID = '34dff2b8-ce9e-4b40-86a9-1976c878e195';
const TS_FILE = '34dff2b8.ts.json';
const LIVE_FILE = `v7-live-${SCAN_ID}.json`;
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-client-payload-sample.json');

// أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤) — analyzedAtMs صار مُدخَلاً
// لـcomputeCategoryStates (بوّابة PATCH_AGE). قيمة ثابتة موسومة (لا
// Date.now() — يكسر تكراريّة العيّنة الذهبية بمرور الوقت) تمثّل "وقت
// خادم حقيقي متاح" — السلوك الإنتاجي الفعلي (exports.analyzeDevice يمرّر
// functionStartTime دائماً)؛ عدم تمريرها هنا كان سيُنتج PATCH_AGE=UNKNOWN
// زوراً — عيّنة لا تمثّل الإنتاج الحقيقي. بلا أثر على أي letter (security
// أصلاً D بقاعدة STATE_FAIL_FLOOR، PATCH_AGE سقفها B لا يُغيّر شيئاً —
// مُتحقَّق بالأداة compare-v7-golden-letters.js).
const ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

// أمر مستخدم 2026-09-23 +03 (أمر التبديل، القاعدة 39 — "الفخّ الذهبي يتبع
// العقد"): وحدة قابلة للاستيراد + واجهة تشغيل رفيعة، بنفس نمط
// measure-resolveV7Report-live.js (154f3f2). buildClientPayloadSample لا
// تكتب أي ملفّ — تبني وتُعيد {clientPayload, audit, live} فقط؛ الكتابة
// والتقرير الطرفي في main() وحدها (خلف حارس require.main، أدناه).
function buildClientPayloadSample() {
  const raw = loadJson(path.join(GOLDEN_DIR, TS_FILE));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functionalResults = frMap[SCAN_ID];
  if (!Array.isArray(functionalResults)) {
    throw new Error(`generate-v7-client-payload-sample: لا functionalResults لِـ ${SCAN_ID} في functionalResults-by-scanid.json`);
  }

  const livePath = path.join(OUT_DIR, LIVE_FILE);
  const live = loadJson(livePath);
  if (live.pipeline !== V7_PIPELINE_TAG) {
    throw new Error(`generate-v7-client-payload-sample: ${LIVE_FILE}.pipeline="${live.pipeline}" ≠ "${V7_PIPELINE_TAG}" — توقّف، لا افتراض`);
  }
  const aiAnalysis = live.parsedResponse;
  if (!aiAnalysis || typeof aiAnalysis !== 'object') {
    throw new Error(`generate-v7-client-payload-sample: ${LIVE_FILE}.parsedResponse غائب/غير صالح`);
  }

  // fingerprint — مطابق حرفياً لـ measure-callAIv7-live.js:99-103 (السكربت
  // الذي بنى userMessage الذي أنتج aiAnalysis أعلاه فعلياً). بلا device —
  // راجع تعليق رأس الملفّ.
  const fingerprint = {
    timeSeries: raw,
    functionalResults,
    manualResults: [],
  };

  const findings = computeFindings(fingerprint);
  const battery = sampleInputsFromRaw(raw);
  const categoryStatesRaw = computeCategoryStates({
    functionalResults: fingerprint.functionalResults,
    manualResults: fingerprint.manualResults,
    dev: null,
    findings,
    batterySampleInputs: battery.sampleInputs,
    batteryDesignCapacityMah: battery.design,
    analyzedAtMs: ANALYZED_AT_MS,
  });

  // ترتيب التركيب المُلزِم (docs/V7_DISPLAY_SHAPE_CONTRACT.md §٢): applyV7Adjustments
  // *قبل* buildDisplayShapeV7 — لا بعده.
  const categoryStatesAdjusted = applyV7Adjustments(
      categoryStatesRaw,
      Array.isArray(aiAnalysis.adjustments) ? aiAnalysis.adjustments : [],
      findings,
  );

  const {display, audit} = buildDisplayShapeV7({
    categoryStates: categoryStatesAdjusted,
    findings,
    aiAnalysis,
    language: 'ar',
  });

  // ─── من هنا فصاعداً: نفس analyzeDevice.js:376-644 حرفياً (بلا Firestore) ──
  const aiResult = display; // "aiResult هنا هو displayShape.display على فرع V7" (analyzeDevice.js:20-22)

  const rawDeviceModel = fingerprint.device?.model || 'Unknown'; // analyzeDevice.js:515 نفسه
  const deviceMarketingName = aiResult.deviceMarketingName || rawDeviceModel; // analyzeDevice.js:387

  const isFreeTrial = false; // measure-callAIv7-live.js:115 — نفس القيمة التي بُني بها userMessage المصدر
  aiResult.isFreeTrial = isFreeTrial; // analyzeDevice.js:388

  const shortId = (typeof aiResult.shortId === 'string' && aiResult.shortId) ?
      aiResult.shortId :
      generateShortId(); // analyzeDevice.js:393-395 — يسقط دائماً هنا على V7 (aiResult.shortId غير مبنيّ من buildDisplayShapeV7)

  const aiModel = live.model; // مصدره الحقيقي وتحقّقه في تعليق رأس الملفّ

  const aiResponseToSave = buildV7ResponseForStorage(aiResult); // analyzeDevice.js:449-451 (فرع V7 فقط، وهذا فرع V7 دائماً هنا)

  // analyzeDevice.js:637-643 حرفياً (بعد S6، أمر مستخدم 2026-10-01 +03):
  // العائد الفعلي للعميل يمرّ بـstripNarrativeDetailsVerdictFromV7Response
  // أوّلاً — نفس الدالّة الحقيقية من analyzeDevice.js، لا نسخة منطق هنا
  // (القاعدة 16/24). aiResponseToSave نفسه **يبقى غير مُعدَّل** (الدالّة لا
  // تُحوِّر مصدرها — تُعيد كائناً جديداً) لأن generate-v7-reports-document-
  // sample.js يحتاجه كما هو (شكل المخزون، بلا حذف) عبر القيمة المُعادة
  // أدناه {aiResponseToSave} — راجع تعليق ذلك السكربت.
  const operationalFieldValues = {shortId, isFreeTrial, aiModel, deviceMarketingName};
  const operationalExtras = {};
  for (const f of V7_OPERATIONAL_FIELDS) operationalExtras[f] = operationalFieldValues[f];
  const clientPayload = {
    ...stripNarrativeDetailsVerdictFromV7Response(aiResponseToSave),
    ...operationalExtras,
  };

  // أمر مستخدم 2026-09-24 +03 (القرار ٧٥، البند ٢-أ) — إضافة إضافية فقط،
  // بلا تغيير على `clientPayload`/`audit`/`live` أو على DEST_FILE (يبقى
  // clientPayload وحده يُكتب أدناه): generate-v7-reports-document-sample.js
  // يحتاج نفس القيم الوسيطة (aiResponseToSave/aiResult/fingerprint) التي
  // كانت محلّية هنا فقط، كي يبني مستند reports/{scanId} الحقيقي عبر
  // buildReportDocument (analyzeDevice.js) بلا إعادة اشتقاقها بمعزل عن هذا
  // المولّد (القاعدة 24 — مصدر واحد). كلا المُستهلِكين الحاليّين
  // (main() أسفل هذا الملفّ، وtest/v7ClientPayloadContractGuard.test.js)
  // يُفكِّكان `{clientPayload}`/`{clientPayload: fresh}` فقط — إضافة
  // مفاتيح لا تُغيّر أيّاً منهما (تحقّق: grep قبل هذا التعديل).
  return {clientPayload, audit, live, aiResponseToSave, aiResult, fingerprint, analyzedAtMs: ANALYZED_AT_MS};
}

function main() {
  const {clientPayload, audit, live} = buildClientPayloadSample();

  fs.writeFileSync(DEST_FILE, JSON.stringify(clientPayload, null, 2) + '\n', 'utf8');

  // ─── تقرير طرفي — جدول حقل/نوع/مثال + قائمة null (يُستهلَك يدوياً في تقرير المهمّة) ──
  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`المُدخل: ${TS_FILE} + functionalResults-by-scanid.json[${SCAN_ID}] + ${LIVE_FILE}.parsedResponse`);
  console.log(`guard.ok المصدر: ${live.guard && live.guard.ok} (راجع تعليق رأس الملفّ)`);
  console.log('');
  console.log('=== جدول الحقول أعلى مستوى ===');
  for (const k of Object.keys(clientPayload)) {
    const v = clientPayload[k];
    const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
    const example = (t === 'object' && v !== null) ? '{…}' : JSON.stringify(v);
    console.log(`${k}\t${t}\t${example}`);
  }
  console.log('');
  console.log('=== overall — كل حقل ===');
  for (const k of Object.keys(clientPayload.overall)) {
    const v = clientPayload.overall[k];
    console.log(`overall.${k}\t${typeof v === 'object' && v !== null ? (Array.isArray(v) ? `array(${v.length})` : 'object') : typeof v}\t${JSON.stringify(v)}`);
  }
  console.log('');
  console.log('=== category نموذج (cpu، thermal، battery) ===');
  for (const cat of ['cpu', 'thermal', 'battery']) {
    const entry = clientPayload.categories[cat];
    console.log(`--- categories.${cat} ---`);
    for (const k of Object.keys(entry)) {
      const v = entry[k];
      const t = Array.isArray(v) ? `array(${v.length})` : typeof v;
      console.log(`  ${k}\t${t}\t${t === 'object' && v !== null ? '{…}' : JSON.stringify(v)}`);
    }
  }
  console.log('');
  console.log(`issues: array(${clientPayload.issues.length}) — عنصر أوّل:`);
  console.log(JSON.stringify(clientPayload.issues[0], null, 2));
  console.log('');
  console.log('=== narrative ===');
  for (const k of Object.keys(clientPayload.narrative)) {
    const v = clientPayload.narrative[k];
    if (k === 'buyerAdvice') {
      console.log(`narrative.buyerAdvice\tobject\t${JSON.stringify(v)}`);
    } else {
      console.log(`narrative.${k}\t${typeof v}\t${typeof v === 'string' ? JSON.stringify(v.slice(0, 60)) + '…' : JSON.stringify(v)}`);
    }
  }
  console.log('');
  console.log(`audit.adjustments (لا يصل العميل — لِلمرجع فقط): ${JSON.stringify(audit.adjustments)}`);
}

if (require.main === module) {
  main();
}

module.exports = {buildClientPayloadSample, DEST_FILE};
