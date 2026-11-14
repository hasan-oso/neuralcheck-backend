#!/usr/bin/env node
'use strict';

// ===================================================================
// generate-v7-client-payload-sample-llm-adjusted — يبني عيّنة ثانية من
// كائن الإرجاع الفعلي لفرع V7، **بتعديل واحد مُصطنَع مُعلَن** — صفر نداء
// نموذج، صفر قيمة قياس مُختلَقة.
// ===================================================================
//
// ⚠️⚠️ **تحديث 2026-09-25 +03 (القرار ٩٤ البند ١) — هذا الملفّ لم يعد
// يُنتج LLM_ADJUSTED فعلياً** ⚠️⚠️: التعديل المُصطنَع أدناه يستشهد بحرف
// storage.deterministicLetter (كان "C"، صار "B" بعد أمر مستخدم 2026-10-01 +03
// — C-07/S-06 إلى آلية العتبة غير المعايَرة، testKinds.js) — وهذا بالضبط الاستدلال الدائري الذي
// أغلقه القرار ٩٤-١ ("لا يُقبل حرف من أيّ فئة، حتى من فئته هو" —
// isProvenSupportiveEvidence في buildV7Payload.js لم تعد تفحص حقول الحرف
// إطلاقاً). التعديل أدناه **يُرفَض الآن EVIDENCE_NOT_PROVEN** بدل أن
// يُطبَّق — العيّنة الناتجة **لا تحمل أي فئة بـletterSource="LLM_ADJUSTED"
// بعد اليوم** (تطابق `v7-client-payload-sample.json` في هذا الجانب:
// كل الفئات DETERMINISTIC). لم يُصلَح هذا بإضافة دليل FAIL مُصطنَع بدل
// الحرف — نصّ القرار صريح: "لا تصنع دليلاً FAIL اصطناعياً لتُبقي التعديل".
// **البديل الحقيقي (القرار ٩٥ البند ٣ — التزام منفصل لاحق)**: عيّنتان
// جديدتان (مستند `reports` وردّ `verifyReport`) عبر السلسلة الحقيقية
// كاملةً (`applyV7Adjustments`/`buildReportDocument`)، بدليل `outcome===
// 'FAIL'` حقيقي (SEC-04/security) لا حرف. هذا الملفّ أُبقي (لا حذف، القاعدة
// 17) ليوثّق كيف تبدو عيّنة "استشهاد بحرف مرفوض" الآن، ولإبقاء حارسه
// (v7ClientPayloadLlmAdjustedContractGuard.test.js) صحيحاً — لا لأنه لا
// يزال يخدم غرضه الأصلي (توضيح شكل LLM_ADJUSTED). راجع تقرير مهمّة القرار
// ٩٤-١ لتفصيل القرار.
//
// الغرض (نصّ أمر المهمّة 2026-09-22 +03 — سؤال من وكيل `wepsite`: "شكل
// adjustmentEvidence/adjustmentReason الحقيقي عند LLM_ADJUSTED" + بند
// لاحق صريح من المنسّق: "ولّد العيّنة من داخل المستودع... السكربت يبقى
// ولا يُعاد توليده — وحين يتغيّر العقد، لا أحد يعرف كيف أُنتج"،
// القاعدة 32): عيّنة `generate-v7-client-payload-sample.js` (`DEST_FILE`
// هناك) تحمل `letterSource: "DETERMINISTIC"`/`adjustmentEvidence: null`
// على الفئات الـ15 كلّها — لأن التعديل الحقيقي الوحيد المُلتقَط لسيناريو
// 34dff2b8 (`cpu`، DOWN) رُفض فعلياً (`rejectedReason: "EVIDENCE_NOT_PROVEN"`
// — مُتحقَّق بتشغيل فعلي في هذه المهمّة، `applyV7Adjustments` على المُدخلات
// الحقيقية أدناه). **صفر عيّنة حقيقية لحالة LLM_ADJUSTED في هذا المستودع.**
// هذا السكربت يسدّ تلك الفجوة بعيّنة **مُصطنَعة في جزء adjustments فقط**:
// نفس findings/categoryStates/aiAnalysis.narrative الحقيقيَّين + تعديل
// واحد يدوي (لا من نموذج) على فئة `storage`.
//
// ─── لماذا `storage` تحديداً — لا فئة أخرى (موثَّق، لا اعتباطي) ──────────
// شرط "الدليل المُثبَت" في `applyV7Adjustments`/`isProvenSupportiveEvidence`
// (`../src/analysis/buildV7Payload.js`) صارم: `status==="FIRED"` أو
// `outcome==="FAIL"` أو حرف مُحقَّق (`deterministicLetter`/`finalLetter`/
// `llmSuggestedLetter`) يساوي `"C"` أو `"D"` — لا غيرها. تحقّق شامل على
// الفئات الـ15 لهذا الفحص (سكربت فحص محلي منفصل، مُسجَّل في تقرير المهمّة،
// غير مُلتزَم — نتيجته مُعاد اشتقاقها هنا بالتحقّقات الدفاعية أدناه لا
// بالثقة بذاكرة تقرير سابق، القاعدة 16) أظهر **فئتين فقط** تحملان دليلاً
// كهذا حقيقياً بلا اختلاق قياس: `security` (بوّابة `ROOT_DETECTED` مُطلَقة،
// `SEC-04` فاشل فعلاً) و`storage` (`deterministicLetter === "C"` وقت كتابة
// هذا الملفّ — صار `"B"` بعد أمر مستخدم 2026-10-01 +03، راجع تعليق الرأس).
// `security` أصلاً `D` (أسوأ درجة) — تخفيضها لا يُغيّر `letter` ظاهرياً
// (فرع "الفئة أصلاً D"، `buildV7Payload.js:489-506`)، فلا يوضّح انخفاضاً
// مرئياً. `storage` هي الوحيدة التي تُنتج انخفاضاً مرئياً فعلياً (كان C→D،
// صار B→C بعد نفس الأمر — سقف درجة واحدة كحدّ أقصى، buildV7Payload.js:709).
// بقيّة الـ13 فئة لا يمكن توليد LLM_ADJUSTED عليها هنا إلا باختلاق قيمة
// قياس — **ممنوع بنصّ المهمّة، لم يُنفَّذ**.
//
// ─── ما هو مُصطنَع بالضبط، وما هو حقيقي ──────────────────────────────────
// **حقيقي**: findings/categoryStates (نفس مُدخل العيّنة الأولى) —
// categoryStates.categories.storage.deterministicLetter === "B" (كان "C"
// حتى أمر مستخدم 2026-10-01 +03 — C-07/S-06 إلى آلية العتبة غير المعايَرة) قياس
// حقيقي فعلي لهذا الفحص، لا رقم اخترعه هذا السكربت (تحقّق دفاعي أدناه
// يرمي إن تغيّر). aiAnalysis.narrative/crossChecks/modelObservations —
// نفس مخرَج النموذج الحقيقي (v7-live-34dff2b8-*.json.parsedResponse).
// أدجستمنت cpu المرفوض — حقيقي، من نفس المخرَج، يبقى في السجلّ كما وصل.
// **مُصطنَع**: عنصر واحد إضافي في adjustments[] — إقران
// {category:"storage", direction:"DOWN", evidenceRefs, reason} — لم يكتبه
// أي نموذج، بناه هذا السكربت يدوياً. نصّ reason يحمل وسماً صريحاً
// "[عيّنة مُصطنَعة محلياً]" في أوّله — يظهر في الملفّ الناتج نفسه، لا في
// اسمه فقط (طُلب صراحة: "وسمها في اسمها ومحتواها معاً").
//
// ─── المسار المُطبَّق هنا (مطابق لـ generate-v7-client-payload-sample.js
// حرفياً حتى إدخال التعديل المُصطنَع في الخطوة ٣) ─────────────────────────
//   1. computeFindings(fingerprint)                                  → findings
//   2. sampleInputsFromRaw(raw) + computeCategoryStates({...})       → categoryStatesRaw
//   3. applyV7Adjustments(categoryStatesRaw,
//        [...aiAnalysis.adjustments (حقيقية), SYNTHETIC_ADJUSTMENT], findings)
//                                                                    → categoryStatesAdjusted
//   4. buildDisplayShapeV7({categoryStates, findings, aiAnalysis, language}) → {display, audit}
//   5. aiResult = display؛ نفس تذييل analyzeDevice.js:376-644 حرفياً
//      (isFreeTrial/shortId/aiModel/deviceMarketingName/
//      buildV7ResponseForStorage/operationalExtras) — بلا Firestore.
//
// ⚠️ **`shortId` غير حتمي بين تشغيلتين** — `generateShortId()` (نفس الدالّة
// التي يستعملها `generate-v7-client-payload-sample.js` الأصلي، نفس
// السلوك هناك أيضاً) تستعمل `Math.random()` (`generateShortId.js`) —
// حقل واحد فقط (`shortId`) يختلف بين كل تشغيلتين لهذا السكربت (وللأصلي
// كذلك)، وهذا موروث من التصميم القائم لا عطب جديد أُدخِل هنا. كل حقل آخر
// حتمي بالكامل (نفس المُدخلات الحقيقية الثابتة + نفس التعديل المُصطنَع
// الثابت نصّاً). راجع تقرير المهمّة تحت "قياس قبل/بعد" لنتيجة المقارنة
// الفعلية بين هذا التشغيل وما كان على القرص قبله.
//
// Run: node functions/scripts/generate-v7-client-payload-sample-llm-adjusted.js
// ===================================================================

const fs = require('fs');
const path = require('path');

// ─── كعب utils/admin — نفس نمط generate-v7-client-payload-sample.js ─────
const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('generate-v7-client-payload-sample-llm-adjusted: Firestore must not be touched'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {applyV7Adjustments} = require('../src/analysis/buildV7Payload');
const {buildDisplayShapeV7} = require('../src/analysis/buildDisplayShapeV7');
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
const DEST_FILE = path.join(GOLDEN_DIR, 'v7-client-payload-sample-llm-adjusted.json');

const SYNTHETIC_CATEGORY = 'storage';
const SYNTHETIC_MARK = '[عيّنة مُصطنَعة محلياً — لا نداء نموذج، وُلِّدت بسكربت محلي بلا اتّصال بأي مزوّد ذكاء اصطناعي، لتوضيح شكل LLM_ADJUSTED فقط]';

function loadJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

// القرار ٩٢ البند ٢ (2026-09-25 +03): استُخرجت من main() إلى دالّة قابلة
// للاستيراد — بنفس نمط buildClientPayloadSample()/buildReportsDocumentSample()
// في السكربتات الشقيقة — كي يستطيع حارس مخصَّص (test/
// v7ClientPayloadLlmAdjustedContractGuard.test.js) استدعاءها في الذاكرة
// وحدها، بلا كتابة، للمقارنة بالثابت المُلتزَم. **صفر تغيير سلوكي**: نفس
// المنطق حرفياً، فقط معزول عن fs.writeFileSync/console.log (بقيا في
// main() أدناه).
// @return {{clientPayload: Object, categoryStatesAdjusted: Object,
//   stoStored: Object, live: Object, aiResult: Object}}
function buildClientPayloadSampleLlmAdjusted() {
  const raw = loadJson(path.join(GOLDEN_DIR, TS_FILE));
  const frMap = loadJson(path.join(GOLDEN_DIR, 'functionalResults-by-scanid.json')).byScanId;
  const functionalResults = frMap[SCAN_ID];
  if (!Array.isArray(functionalResults)) {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: لا functionalResults لِـ ${SCAN_ID}`);
  }

  const livePath = path.join(OUT_DIR, LIVE_FILE);
  const live = loadJson(livePath);
  if (live.pipeline !== V7_PIPELINE_TAG) {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: ${LIVE_FILE}.pipeline="${live.pipeline}" ≠ "${V7_PIPELINE_TAG}" — توقّف، لا افتراض`);
  }
  const aiAnalysis = live.parsedResponse;
  if (!aiAnalysis || typeof aiAnalysis !== 'object') {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: ${LIVE_FILE}.parsedResponse غائب/غير صالح`);
  }

  // fingerprint — مطابق حرفياً لـ generate-v7-client-payload-sample.js
  // (وبالتبعية لـ measure-callAIv7-live.js:99-103).
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
  });

  // ─── تحقّق دفاعي قبل بناء التعديل المُصطنَع — لا افتراض أن الدليل لا يزال
  // حقيقياً؛ إن انحرف الكود (تغيّر معيار الدرجة الحتمية لِـstorage) هذا
  // السكربت يتوقّف بدل أن يُخرج عيّنة مُضلِّلة بصمت (القاعدة 22/16).
  // ⚠️ كانت "C" حتى أمر مستخدم 2026-10-01 +03 («البند ١ — C-07 وS-06»،
  // الخيار (أ)): C-07/S-06 إلى آلية العتبة غير المعايَرة (testKinds.js)
  // غيّرت storage.deterministicLetter الحقيقي على هذا الفحص (34dff2b8) من
  // C إلى B — تحديث الفحص الدفاعي إلى القيمة الجديدة، لا حذفه (غرضه الوحيد
  // يبقى قائماً: إثبات أن الاستشهاد بحرف دليلاً يُرفَض).
  const storageEntry = categoryStatesRaw.categories[SYNTHETIC_CATEGORY];
  if (!storageEntry || storageEntry.deterministicLetter !== 'B') {
    throw new Error(
        `generate-v7-client-payload-sample-llm-adjusted: توقّف — الدليل الحقيقي المتوقَّع ` +
        `(categories.${SYNTHETIC_CATEGORY}.deterministicLetter === "B") لم يعد كما هو. ` +
        `الفعلي: ${JSON.stringify(storageEntry && storageEntry.deterministicLetter)}. لا افتراض — ` +
        `يلزم تحديث هذا السكربت يدوياً إن تغيّر المُدخل الحقيقي عمداً.`);
  }

  // ─── التعديل المُصطنَع الوحيد — يُضاف بجوار adjustments[] الحقيقية (لا
  // يستبدلها) كي يبقى audit.adjustments يعرض الاثنين معاً: **رفضان
  // حقيقيان معاً** — cpu (EVIDENCE_NOT_PROVEN، دليل حقيقي غير مُثبَت) وstorage
  // (دليل حقيقي **لكن حرف**، مرفوض بنيوياً منذ القرار ٩٤-١) — جنباً إلى
  // جنب، لا مطموساً.
  //
  // ⚠️ **تصحيح 2026-10-01 +03 (تصحيح المستخدم — نصّ `reason` أدناه كان
  // خاطئاً)**: كان يقول "يُستعمَل هنا كدليل 'مُثبَت' بنصّ الكود (letter
  // C/D) لتوليد انخفاض مرئي فعلي (B→C)" — **B ليست C ولا D** (تصحيح C→B
  // اللاحق، راجع رأس هذا الملفّ)، والعيّنة **ترفض** هذا التعديل على كل
  // حال (لا تُنتج أي انخفاض مرئي فعلي — راجع التحقّق العكسي أسفل هذا
  // الملفّ: `stoLog.applied === false`). النصّ الصحيح، بنصّ التصحيح: هذا
  // التعديل يستشهد بالحرف الحتمي B نفسه دليلاً على طلب خفضه — والاستشهاد
  // بحرف دليلاً مرفوض بنيوياً منذ القرار ٩٤-١ (`isProvenSupportiveEvidence`
  // لا تفحص حروفاً إطلاقاً). الغرض الحقيقي للعيّنة إذن: **إثبات أن
  // الاستشهاد بحرف دليلاً يُرفَض**، لا توليد انخفاض مرئي.
  const syntheticAdjustment = {
    category: SYNTHETIC_CATEGORY,
    direction: 'DOWN',
    evidenceRefs: [`categoryStates.categories.${SYNTHETIC_CATEGORY}.deterministicLetter`],
    reason: `${SYNTHETIC_MARK} حرف التخزين الحتمي المقيس فعلياً على هذا الفحص هو B ` +
        `(deterministicLetter) — يستشهد هذا التعديل بالحرف B نفسه دليلاً على طلب خفضه، ` +
        `والاستشهاد بحرف دليلاً مرفوض بنيوياً منذ القرار ٩٤-١ (isProvenSupportiveEvidence ` +
        `لا تفحص حروفاً إطلاقاً) — فيُرفَض هذا التعديل هنا، ويوضّح شكل الرفض ` +
        `(letterSource يبقى DETERMINISTIC، adjustmentEvidence/adjustmentReason يعودان null) ` +
        `حين يستشهد تعديل مُقترَح بحرف. لا تخفيضاً اقترحه نموذج فعلي على هذا الفحص ` +
        `— ولا قيمة قياس جديدة اختُلقت، الحرف B حقيقي.`,
  };
  const realAdjustments = Array.isArray(aiAnalysis.adjustments) ? aiAnalysis.adjustments : [];
  const adjustmentsWithSynthetic = [...realAdjustments, syntheticAdjustment];

  // ترتيب التركيب المُلزِم (docs/V7_DISPLAY_SHAPE_CONTRACT.md §٢): applyV7Adjustments
  // *قبل* buildDisplayShapeV7 — لا بعده.
  const categoryStatesAdjusted = applyV7Adjustments(categoryStatesRaw, adjustmentsWithSynthetic, findings);

  // تحقّق دفاعي — **مقلوب 2026-09-25 +03 (القرار ٩٤ البند ١)**: كان يتحقّق
  // أن التعديل "طُبِّق" (applied=true، C→D)؛ بعد إغلاق باب الحرف دليلاً
  // (isProvenSupportiveEvidence لم تعد تفحص حروفاً إطلاقاً) هذا التعديل
  // **يُرفَض** بنيوياً الآن — التحقّق أدناه يثبت الرفض المتوقَّع نفسه، لا
  // يفترضه، فلا يُكتَب الملفّ إن انحرف السلوك عن هذا التوقّع الجديد أيضاً
  // (القاعدة 16 تسري في الاتّجاهين).
  const stoLog = categoryStatesAdjusted.overall.adjustments.find((a) => a.category === SYNTHETIC_CATEGORY);
  if (!stoLog || stoLog.applied !== false || stoLog.rejectedReason !== 'EVIDENCE_NOT_PROVEN') {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: توقّف — التعديل المُصطنَع لم يُرفَض كما هو متوقَّع بعد القرار ٩٤-١: ${JSON.stringify(stoLog)}`);
  }

  const {display} = buildDisplayShapeV7({
    categoryStates: categoryStatesAdjusted,
    findings,
    aiAnalysis,
    language: 'ar',
  });

  // مقلوب أيضاً — الرفض يعني بقاء storage على حالتها الحتمية بلا مساس.
  // (letter="B" منذ أمر مستخدم 2026-10-01 +03 — راجع تعليق storageEntry أعلاه)
  if (display.categories[SYNTHETIC_CATEGORY].letterSource !== 'DETERMINISTIC' ||
      display.categories[SYNTHETIC_CATEGORY].letter !== 'B') {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: توقّف — display.categories.${SYNTHETIC_CATEGORY} غير كما هو متوقَّع بعد القرار ٩٤-١: ${JSON.stringify(display.categories[SYNTHETIC_CATEGORY])}`);
  }

  // ─── من هنا فصاعداً: نفس analyzeDevice.js:376-644 حرفياً (بلا Firestore) ──
  // مطابق لـ generate-v7-client-payload-sample.js حرفياً.
  const aiResult = display;

  const rawDeviceModel = fingerprint.device?.model || 'Unknown';
  const deviceMarketingName = aiResult.deviceMarketingName || rawDeviceModel;

  const isFreeTrial = false; // نفس القيمة الحقيقية المُستعمَلة لبناء userMessage المصدر
  aiResult.isFreeTrial = isFreeTrial;

  // ⚠️ غير حتمي بين تشغيلتين — راجع تعليق رأس الملفّ.
  const shortId = (typeof aiResult.shortId === 'string' && aiResult.shortId) ?
      aiResult.shortId :
      generateShortId();

  const aiModel = live.model;

  const aiResponseToSave = buildV7ResponseForStorage(aiResult);

  // تحقّق أخير على شكل التخزين النهائي (ما يصل العميل فعلياً) — مقلوب
  // أيضاً (القرار ٩٤-١): لا LLM_ADJUSTED، لا adjustmentEvidence/adjustmentReason.
  const stoStored = aiResponseToSave.categories[SYNTHETIC_CATEGORY];
  if (stoStored.letterSource !== 'DETERMINISTIC' || stoStored.letter !== 'B' ||
      stoStored.adjustmentEvidence !== null || stoStored.adjustmentReason !== null) {
    throw new Error(`generate-v7-client-payload-sample-llm-adjusted: توقّف — الشكل النهائي المخزَّن لـ${SYNTHETIC_CATEGORY} غير كما هو متوقَّع بعد القرار ٩٤-١: ${JSON.stringify(stoStored)}`);
  }

  const operationalFieldValues = {shortId, isFreeTrial, aiModel, deviceMarketingName};
  const operationalExtras = {};
  for (const f of V7_OPERATIONAL_FIELDS) operationalExtras[f] = operationalFieldValues[f];
  // S6 (أمر مستخدم 2026-10-01 +03) — نفس تعديل generate-v7-client-payload-
  // sample.js: العائد الفعلي يمرّ بـstripNarrativeDetailsVerdictFromV7Response
  // (الدالّة الحقيقية، لا نسخة). aiResponseToSave (شكل المخزون، مُتحقَّق
  // أعلاه) يبقى بلا مساس.
  const clientPayload = {
    ...stripNarrativeDetailsVerdictFromV7Response(aiResponseToSave),
    ...operationalExtras,
  };

  return {clientPayload, categoryStatesAdjusted, stoStored, live, aiResult};
}

function main() {
  const {clientPayload, categoryStatesAdjusted, stoStored, live} = buildClientPayloadSampleLlmAdjusted();

  fs.writeFileSync(DEST_FILE, JSON.stringify(clientPayload, null, 2) + '\n', 'utf8');

  console.log(`كُتبت العيّنة إلى: ${DEST_FILE}`);
  console.log(`المُدخل: ${TS_FILE} + functionalResults-by-scanid.json[${SCAN_ID}] + ${LIVE_FILE}.parsedResponse + تعديل مُصطنَع واحد على ${SYNTHETIC_CATEGORY}`);
  console.log(`guard.ok المصدر (aiAnalysis الحقيقي، بصرف النظر عن التعديل المُصطنَع): ${live.guard && live.guard.ok}`);
  console.log('');
  console.log(`=== categories.${SYNTHETIC_CATEGORY} (الشكل النهائي) ===`);
  console.log(JSON.stringify(stoStored, null, 2));
  console.log('');
  console.log('=== audit.adjustments (لا يصل العميل — للمرجع فقط) ===');
  console.log(JSON.stringify(categoryStatesAdjusted.overall.adjustments, null, 2));
  console.log('');
  console.log(`⚠️ shortId في هذا التشغيل: ${clientPayload.shortId} — عشوائي (generateShortId)، يختلف عن أي تشغيلة سابقة. كل حقل آخر حتمي.`);
}

// القرار ٩٢ البند ٢ — حارس صار يستورد buildClientPayloadSampleLlmAdjusted
// (أعلاه) بلا استدعاء main()؛ هذا الحارس مفقود سابقاً (main() كانت تُستدعى
// شرطاً غير مقيَّد، فأيّ require() لهذا الملفّ كان سيكتب الملفّ فوراً —
// لا يقع ذلك اليوم لأن لا شيء يستورده كوحدة قبل هذا الإصلاح، مُتحقَّق
// بـgrep، لكنه كان فخّاً كامناً).
if (require.main === module) {
  main();
}

module.exports = {buildClientPayloadSampleLlmAdjusted, DEST_FILE};
