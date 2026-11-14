const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {sanitizeFailureText} = require("../utils/failureText");
const {admin, db} = require("../utils/admin");
const {geminiKey, deepseekKey} = require("../utils/secrets");
const {generateShortId} = require("../utils/generateShortId");
const {
  buildReportRawDocument, assertReportRawFits, writeReportAndRaw,
} = require("./reportRawStore");
const {SCAN_CLAIM_TTL_MS, reserveScanCredit, releaseScanCredit} = require("./scanReservation");
const {runAnalysisInternal} = require("./runAnalysisInternal");
const {AI_TOTAL_BUDGET_MS} = require("./callAI");
const {createDeviceProfile} = require("../profiles/createDeviceProfile");
const {appendScanToHistory} = require("../profiles/appendScanToHistory");
const {normalizeDeviceProfileKey, describeDeviceProfileKey, UNKNOWN_PRIMARY} = require("../profiles/deviceProfileKey");
const {scanGateVerdict, refuseScan, SCAN_REFUSAL_STAGE} = require("./scanRefusal");
const {hashIdForLog} = require("../utils/logRedaction");
const {buildScanProtocolDocument, readProtocolParts, protocolReuseBlockedReason} = require("../protocol/scanProtocolDocument");
const {PROTOCOL_COLLECTION, CREDIT_EXEMPTION, LINK_MODEL_CHECK} = require("../protocol/protocolVocabulary");
const {SCAN_PROTOCOL_FIELD} = require("../protocol/protocolCorrection");
const {PAIR_NOTE, PAIR_LINK_INTENT, PAIR_COMPLETION} = require("../protocol/maintenancePair");
const {readProtocolSettings, readCollectionPhase} = require("../protocol/protocolSettings");
const {
  readStartTemp, readRepeatChildContext, classifyRepeatScan, isCreditExempt, isAfterScanCreditExempt, completedStateFor, decideParentCompletion, PARENT_COMPLETION_SKIP,
} = require("../protocol/repeatScan");
const {sessionExpiryRefusal, SESSION_EXPIRY_REASON} = require("../sessions/sessionTimeout");
const {SESSION_STATUS, COMPLETION_PATH, ANALYZE_SESSION_REFUSAL, OWNER_CHECK_STATE} = require("../sessions/sessionNames");
const {
  recordSessionExpiredIfDueSafely, analyzeSessionRefusalReason, analyzeSessionReasonForCaller, isLegitCompletedSessionRetry,
} = require("../sessions/sessionLifecycle");
const {completeSessionBestEffort, cachedCompletionFields, ownerCheckState} = require("../sessions/sessionCompletion");
const {
  STORED_REPORT_REFUSAL, STORED_REPORT_REFUSAL_TEXT, STORED_REPORT_REFUSAL_CODE, STORED_REPORT_PATH,
  storedReportServeVerdict, logStoredReportRefusal,
} = require("./storedReportAccess");
const {V6_PIPELINE_TAG, V7_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require("./pipelineTags");
const {EVALUATION_RULES_VERSION, EVALUATION_RULES_VERSION_FIELD} = require("./evaluationRulesVersion");
const {V7_OPERATIONAL_FIELDS} = require("./v7OperationalFields");
const {CATEGORIES} = require("../utils/categories");
const {
  SERVER_SAMPLES_STORAGE_PATH_FIELD, SERVER_SAMPLES_SAVED_FIELD, saveServerRawSamples,
} = require("./serverRawSamplesStorage");

// أمر مستخدم 2026-09-23 +03، القرار ١، القاعدة 24: "المهلة تُشتقّ من مهلة
// الدالّة (300 ث)... صدِّرها ثابتاً واحداً يستورده خيار الدالّة والميزانية
// معاً." مصدر واحد يستهلكه onCall({timeoutSeconds}) أدناه ومُهلة resolveV7Report
// (عبر deadline يُحسَب من هذا الثابت + Date.now() عند بدء الدالّة، لا من
// بدء resolveV7Report — القيد الصريح: "الوقت المنقضي يُقاس من بدء الدالّة").
const ANALYZE_DEVICE_TIMEOUT_MS = 300_000; // = 300 ثانية (fix/ai-timeout-and-truncation)

// أمر مستخدم 2026-09-23 +03 (بعد القياس العشاري)، البند ١، القاعدة 24:
// "من ANALYZE_DEVICE_TIMEOUT_MS − AI_TOTAL_BUDGET_MS (300 − 265). وهو رقم
// قائم في الكود، لا جديد." AI_TOTAL_BUDGET_MS مُستوردة من callAI.js —
// مصدرها الوحيد (تعريفها هناك: "نحجز 35 ثانية لما بعد الاستدعاء... فتبقى
// 265 ثانية للمزوّدين") — لا نسخة هنا.
//
// مشتقّ من ثابتي المهلة، والقياس على قلّة عيّنته دونه بكثير (وسيط 4.7 ث).
// [منقول من المنسّق — 8 طلبات مربوطة من سجلّات الإنتاج، خارج هذا المستودع،
// غير متحقَّق من هنا، القاعدة 29]. يُراجَع حين تبلغ العيّنة عشرة.
const RESERVED_FOR_DOCUMENT_WRITE_MS = ANALYZE_DEVICE_TIMEOUT_MS - AI_TOTAL_BUDGET_MS; // = 35_000

// ===================================================
// A104 (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً): "categories و issues
// يُمرَّران بالمرجع، فالقائمة تحرس المستوى الأوّل وحده... الإصلاح في
// analyzeDevice: يبني display بحقول مُسمّاة كما يفعل buildDisplayShapeV7
// بالفعل — فلا يصل المستند مفتاح متداخل غير معروف."
//
// على المسار الحيّ اليوم (فرع V7 — حيّ منذ التبديل، fd3a6ce؛ الجملة
// التالية كانت صحيحة قبله ولم تعد كذلك) aiResult هو فعلياً
// buildDisplayShapeV7.display — مبنيّ بحقول مُسمّاة أصلاً (buildDisplayShapeV7.js).
// فهذه الدالّة دفاع في العمق لا إصلاح عطب قائم اليوم: لو حمل aiResult مفتاحاً
// زائداً (خلل مستقبلي في buildDisplayShapeV7.js/resolveV7Report.js، أو مسار
// آخر أنتجه بلا نفس الانضباط) فـ`aiResponse: aiResult` المباشرة (كما كانت)
// كانت ستكتبه إلى Firestore بلا حاجز — هذه الدالّة تعيد بناء الكائن حقلاً
// حقلاً فتُسقِط أي مفتاح لم تُسمِّه صراحةً، بصرف النظر عمّا حمله aiResult.
//
// القائمة مطابقة لِما يقرؤه verifyReport.js (buildV7Response، القاعدة 24 —
// نفس مبدأ pipelineTags.js لكن لأسماء الحقول لا لقيمة واحدة: لا مصدر مُصدَّر
// مشترك بين الكاتب (هنا) والقارئ (verifyReport.js) بعد — كلاهما يعدّد
// نفس الحقول يدوياً، وهذا انجراف مُحتمَل مُسمّى في تقرير المهمّة، لا مُصلَح
// في هذه المهمّة).
//
// A104 في العمق (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً): "buildV7ResponseForStorage
// يبني categories و issues حقلاً حقلاً كما يبني overall و narrative. طبقة
// واحدة لا تكفي، ووصف «دفاع في العمق» يجب أن يصدق." الفقرة أعلاه ("categories/
// issues تبقيان تمريرة بالمرجع... هذه الدالّة تحرس المستوى الأوّل فقط") لم
// تعد صحيحة — أُبقيت موسومة بالتصحيح بدل حذفها (القاعدة 8: لا حذف دليل؛
// نفس أسلوب aiAuditWiring.e2e.test.js:35-38 مع سابقة مشابهة). المرجع
// المُعمَّم لا المُخترَع: buildDisplayShapeV7.js:121-139 (buildCategoryDisplay،
// حقول state/letter/coverage/reason/testIds + confidence/tag/indicators
// الخاصّة بالبطارية) وbuildIssuesDisplay (buildDisplayShapeV7.js:189-195،
// id/category/severity/title/evidence/evidenceUnit + description). الحقلان
// socAtStart/socAtEnd على فئة البطارية يُلحَقان بعد buildCategoryDisplay في
// buildDisplayShapeV7.js:285-292 — يُنسخان هنا بنفس الاسم لأنهما يصلان فعلاً
// aiResult.categories.battery كجزء من display النهائي.
//
// buildCategoryEntryForStorage/buildIssueForStorage أدناه تعملان بمبدأ
// "دفاع في العمق على قيم مبنيّة سلفاً"، لا إعادة تنفيذ منطق categoryAbsenceReason
// أو buildIssuesDisplay — القيم تُنسَخ إن كانت من النوع المتوقَّع، لا تُشتقّ من
// جديد (هذه الدالّة لا ترى categoryStates/findings الخام أصلاً، فقط display
// المبنيّ). مصدر تمييز فئة البطارية هو اسم المفتاح (cat === "battery")، لا
// حقل .category داخل العنصر — buildCategoryDisplay's out لا يحمل .category
// إطلاقاً (تحقّق: buildDisplayShapeV7.js:121-139 لا "category:" في out)،
// ومطابقةً لكيف يميّزها buildDisplayShapeV7.js:285 نفسه (`if (display.categories.battery)`).
//
// @param {string} cat اسم الفئة (مفتاح CATEGORIES) — يحدّد إضافة حقول البطارية
// @param {Object} entry عنصر فئة واحد كما وصل في r.categories[cat] — غير موثوق بنيوياً
// @return {Object}
function buildCategoryEntryForStorage(cat, entry) {
  const e = (entry && typeof entry === "object" && !Array.isArray(entry)) ? entry : {};
  const out = {
    state: typeof e.state === "string" ? e.state : null,
    letter: (e.letter === null || typeof e.letter === "string") ? e.letter : null,
    // القرار ٤٢ البند ٣ — letterSource/adjustmentReason/adjustmentEvidence
    // حقول جديدة على buildCategoryDisplay (buildDisplayShapeV7.js، A62) —
    // القرار ٢٥ يمنع شكلاً جديداً بلا تحديث كل قارئ؛ هذه الدالّة (الكاتب
    // إلى Firestore، A104) هي أحد القرّاء الواجب تحديثها. verifyReport.js
    // لا يحتاج تعديلاً مقابلاً — categories تصله تمريرة كاملة بالمرجع
    // (verifyReport.js:294-295/330)، فأي حقل يكتبه buildCategoryEntryForStorage
    // هنا يصل /verify تلقائياً بلا قائمة ثانية (تحقّق: verifyReportV7Whitelist.test.js:299
    // deepEqual على categories كاملة).
    letterSource: (e.letterSource === "DETERMINISTIC" || e.letterSource === "LLM_ADJUSTED") ?
        e.letterSource : null,
    adjustmentReason: (e.adjustmentReason === null || typeof e.adjustmentReason === "string") ?
        e.adjustmentReason : null,
    adjustmentEvidence: Array.isArray(e.adjustmentEvidence) ? e.adjustmentEvidence : null,
    coverage: typeof e.coverage === "number" ? e.coverage : null,
    reason: (e.reason === null || typeof e.reason === "string") ? e.reason : null,
    // letterCeilingReason — أمر المهمّة 2026-09-22 +03 (البند الثاني)، شكل
    // جديد على buildCategoryDisplay (buildDisplayShapeV7.js) — القرار ٢٥
    // يمنع شكلاً جديداً بلا تحديث كل قارئ؛ هذه الدالّة أحد القرّاء. مبنيّة
    // حقلاً حقلاً (name/ceilingLetter/text) لا تمريرة `?? null` (كما
    // overall.governingGateReason في buildV7ResponseForStorage أدناه) —
    // قصداً: هذه الدالّة كلّها بهذا الانضباط (A104) على كل حقل آخر في
    // الفئة، فلا تُستثنى هذه الحقل الجديد وحده بتمريرة أخفّ. verifyReport.js
    // لا يحتاج تعديلاً مقابلاً (نفس سبب letterSource أعلاه — categories
    // تصله تمريرة كاملة).
    letterCeilingReason: (e.letterCeilingReason && typeof e.letterCeilingReason === "object" &&
        !Array.isArray(e.letterCeilingReason)) ? {
      name: typeof e.letterCeilingReason.name === "string" ? e.letterCeilingReason.name : null,
      ceilingLetter: typeof e.letterCeilingReason.ceilingLetter === "string" ?
          e.letterCeilingReason.ceilingLetter : null,
      text: typeof e.letterCeilingReason.text === "string" ? e.letterCeilingReason.text : null,
    } : null,
    testIds: Array.isArray(e.testIds) ? e.testIds : [],
  };
  if (cat === "battery") {
    out.confidence = (e.confidence === null || typeof e.confidence === "string") ? e.confidence : null;
    out.tag = (e.tag === null || typeof e.tag === "string") ? e.tag : null;
    out.indicators = (e.indicators && typeof e.indicators === "object" && !Array.isArray(e.indicators)) ?
        e.indicators : null;
    out.socAtStart = typeof e.socAtStart === "number" ? e.socAtStart : null;
    out.socAtEnd = typeof e.socAtEnd === "number" ? e.socAtEnd : null;
  }
  return out;
}

/**
 * A104 في العمق — راجع تعليق buildCategoryEntryForStorage أعلاه. تُعمِّم
 * buildDisplayShapeV7.js:189-195 (buildIssuesDisplay): id/category/severity/
 * title حقول ثابتة دائماً؛ evidence/evidenceUnit تصلان فقط لأعطاب
 * FAIL/WARNING (categoryStates.js:410-414) وتبقيان null لِـPOSITIVE/INFO —
 * غياب لا يُقرأ صفراً (القاعدة 22)؛ description من narrative.issueDescriptions
 * (buildIssuesDisplay) أو null.
 * @param {Object} issue عنصر واحد من r.issues كما وصل — غير موثوق بنيوياً
 * @return {Object}
 */
function buildIssueForStorage(issue) {
  const it = (issue && typeof issue === "object" && !Array.isArray(issue)) ? issue : {};
  return {
    id: typeof it.id === "string" ? it.id : null,
    category: typeof it.category === "string" ? it.category : null,
    severity: typeof it.severity === "string" ? it.severity : null,
    title: typeof it.title === "string" ? it.title : null,
    evidence: (typeof it.evidence === "string" || typeof it.evidence === "number") ? it.evidence : null,
    evidenceUnit: (it.evidenceUnit === null || typeof it.evidenceUnit === "string") ? it.evidenceUnit : null,
    description: (it.description === null || typeof it.description === "string") ? it.description : null,
  };
}

// @param {Object} aiResult buildDisplayShapeV7.display (أو ما يعادله) —
//   غير موثوق بنيوياً حتى لو كان المصدر معروفاً.
// @return {Object} نسخة بحقول مُسمّاة صراحةً فقط — لا مفتاح غير مُدرَج هنا.
function buildV7ResponseForStorage(aiResult) {
  const r = (aiResult && typeof aiResult === "object") ? aiResult : {};
  const overall = (r.overall && typeof r.overall === "object") ? r.overall : {};
  const narrative = (r.narrative && typeof r.narrative === "object" &&
      !Array.isArray(r.narrative)) ? r.narrative : {};
  const buyerAdvice = (narrative.buyerAdvice && typeof narrative.buyerAdvice === "object" &&
      !Array.isArray(narrative.buyerAdvice)) ? narrative.buyerAdvice : {};
  return {
    pipeline: r.pipeline || V7_PIPELINE_TAG,
    language: typeof r.language === "string" ? r.language : "ar",
    overall: {
      letter: overall.letter ?? null,
      letterSource: overall.letterSource ?? null,
      coverage: overall.coverage ?? null,
      coveragePct: overall.coveragePct ?? null,
      partialAssessment: !!overall.partialAssessment,
      partialAssessmentTag: overall.partialAssessmentTag ?? null,
      governingGateReason: overall.governingGateReason ?? null,
      noDataAtAll: !!overall.noDataAtAll,
      zeroMeasuredMessage: overall.zeroMeasuredMessage ?? null,
      abstentionReasons: overall.abstentionReasons ?? null,
      harnessError: !!overall.harnessError,
      harnessErrorReason: overall.harnessErrorReason ?? null,
      // S3 (أمر مستخدم 2026-10-01 +03) — حقل جديد، نفس نمط الحقول أعلاه
      // (تمريرة بلا اشتقاق — الجملة تُبنى في categoryStates.js).
      harnessErrorMessage: overall.harnessErrorMessage ?? null,
    },
    categories: (() => {
      const src = (r.categories && typeof r.categories === "object" && !Array.isArray(r.categories)) ?
          r.categories : {};
      const out = {};
      // نفس حلقة buildDisplayShapeV7.js:279-281 حرفياً (`for (const cat of
      // CATEGORIES) { if (categories[cat]) ... }`) — تُعمَّم لا تُخترَع.
      for (const cat of CATEGORIES) {
        if (src[cat]) out[cat] = buildCategoryEntryForStorage(cat, src[cat]);
      }
      return out;
    })(),
    issues: (Array.isArray(r.issues) ? r.issues : []).map(buildIssueForStorage),
    narrative: {
      summary: typeof narrative.summary === "string" ? narrative.summary : null,
      details: typeof narrative.details === "string" ? narrative.details : null,
      verdict: typeof narrative.verdict === "string" ? narrative.verdict : null,
      buyerAdvice: {
        casual: typeof buyerAdvice.casual === "string" ? buyerAdvice.casual : null,
        gamer: typeof buyerAdvice.gamer === "string" ? buyerAdvice.gamer : null,
        photographer: typeof buyerAdvice.photographer === "string" ? buyerAdvice.photographer : null,
      },
    },
    narrativeIncomplete: !!r.narrativeIncomplete,
    narrativeIncompleteFields: Array.isArray(r.narrativeIncompleteFields) ? r.narrativeIncompleteFields : [],
  };
}

// ─── S6 — الحذف عند الإرجاع وحده (أمر مستخدم 2026-10-01 +03) ────────────
// "narrative.details وnarrative.verdict تُحذفان من الردّ... ولا تُحذفان عند
// البناء." أي: aiResponseToSave (بُنيت أعلاه بـbuildV7ResponseForStorage)
// وreportDocument (مبنيّ منها) يبقيان بلا مساس — يُخزَّنان كاملين، ولوحة
// المشرف تقرأ منهما. الحذف يقع هنا فقط، على **نسخة** تصل العميل عبر
// exports.analyzeDevice (السطر ~771) وإعادة الإرجاع للتقرير المحفوظ سلفاً
// (السطر ~363) — كلاهما فرع V7 فقط.
//
// **V6 بلا أي مساس** — بنية مختلفة تماماً: details/verdict على جذر aiResult
// V6 مباشرة لا داخل narrative (runAnalysisInternal.js:667-668)، والإرجاع
// هناك (`{...aiResult, shortId}` أسفل هذا الملفّ) يبقى كما كان دائماً — لم
// يُطلَب مسّ V6، ولم أفعل.
//
// **لا تعديل على الكائن المُمرَّر** — نسخة جديدة (`{...narrative}` مع حذف
// المفتاحين عبر destructuring)، لا `delete` على narrative الأصلية: ذلك
// الكائن قد يكون aiResponseToSave نفسه (مُرجَع بالمرجع من buildV7ResponseForStorage)
// الذي كُتب بالفعل إلى Firestore أعلاه (`reportRef.set`) — التعديل بالمرجع
// بعد الكتابة لا يغيّر ما وصل القرص (الكتابة انتهت)، لكن تجنّب التحوّر
// المشترك انضباط أسلم، لا يعتمد على ترتيب استدعاء.
// @param {Object} aiResponseV7 ردّ V7 (aiResponseToSave أو ما يعادله من
//   مستند محفوظ) — يُفترَض أنه بشكل buildV7ResponseForStorage، لكن دفاعي
//   ضد narrative غائبة/غير كائن (القاعدة 22 — لا رمي هنا لخطأ تخزين قديم).
// @return {Object} نسخة جديدة — نفس كل الحقول، narrative بلا details/verdict
//   (المفتاحان غائبان تماماً، لا null — "تُحذفان" حرفياً).
function stripNarrativeDetailsVerdictFromV7Response(aiResponseV7) {
  const source = (aiResponseV7 && typeof aiResponseV7 === "object") ? aiResponseV7 : {};
  const narrative = (source.narrative && typeof source.narrative === "object" &&
      !Array.isArray(source.narrative)) ? source.narrative : {};
  const {details: _details, verdict: _verdict, ...narrativeForReturn} = narrative;
  return {...source, narrative: narrativeForReturn};
}

// أمر مستخدم 2026-09-24 +03 (القرار ٧٥، البند ٢-أ): دالّة نقيّة تبني كائن
// مستند reports/{scanId} حرفياً كما كان الكائن الحرفي المضمَّن سابقاً في
// exports.analyzeDevice (نفس المفاتيح، نفس الترتيب، نفس الشروط) — لا
// إعادة صياغة، فقط استخراج. serverTimestamp() لا يُستدعى هنا (SERVER_
// TIMESTAMP_MARKER علامة مُسمّاة بدلاً منه — الدالّة نقيّة، بلا admin/
// Firestore) — exports.analyzeDevice يستبدلها بالقيمة الحقيقية عند
// النداء الفعلي فقط.
// @param {Object} p مدخلات — نفس المتغيّرات التي كانت تُغلَق عليها الكتلة
//   الحرفية الأصلية (userId، rawDeviceModel، deviceMarketingName،
//   deviceFingerprintSha، timeSeriesStoragePath، fieldsVersion،
//   appVersion، fingerprint، aiResponseToSave، aiResultAudit، aiModel،
//   aiDurationMs، aiFallbackReason، pipeline، aiResult، language،
//   isSessionScan، sessionId، shortId، isFreeTrial، v5Metrics،
//   analyzedAtMs — أُضيف 2026-09-24 +03، القرار ٧٥ البند ٤، وreusedEvaluationRulesVersion — اختياري، 2026-10-13 +03: لمسار pipeline='cached' وحده، راجع evaluationRulesStampFields).
//   ملاحظة (V8 نقل الخامّ، 2026-10-09): fingerprint وaiResultAudit وsessionId
//   وisSessionScan وdeviceFingerprintSha وtimeSeriesStoragePath **لا يُقرأ منها
//   شيء هنا** — تذهب إلى reportRaw عبر buildReportRawDocument (reportRawStore.js)؛
//   تبقى في p كي يُمرَّر الكائن نفسه إلى البنّاءين دون تفرّع.
// @return {Object} كائن مستند reports/{scanId} (المقروء) كما يُكتَب حرفياً.
const SERVER_TIMESTAMP_MARKER = Object.freeze({__marker: 'FIRESTORE_SERVER_TIMESTAMP'});

// ختم قواعد التقييم (P6-26، الجزء الأوّل، 2026-10-13 +03 — evaluationRulesVersion.js): الحقل الذي يُكتب في جذر المستند، أو {} (مفتاح غائب لا null ولا افتراضي — القاعدة 22).
//   • مسار عادي (V7 أو V6): ثابت هذا الإصدار EVALUATION_RULES_VERSION.
//   • مسار التقرير المخبَّأ (pipeline === CACHED_PIPELINE_TAG، runAnalysisInternal يعيد تقريراً سابقاً بلا نداء نموذج): محتوى aiResponse أنتجته قواعد **التقرير الأصل** لا قواعد هذا الإصدار، فختم
//     هذا الإصدار عليه ادّعاء كاذب. فيحمل ختم التقرير الأصل إن حمله (reusedEvaluationRulesVersion، يقرؤه runAnalysisInternal من مستند التقرير المُعاد)، وإلّا يغيب المفتاح: الأصل «كُتب قبل الختم».
// دالّة نقيّة. لا تقرأ غير p.pipeline وp.reusedEvaluationRulesVersion.
function evaluationRulesStampFields(p) {
  if (p.pipeline === CACHED_PIPELINE_TAG) {
    const reused = p.reusedEvaluationRulesVersion;
    return (typeof reused === "string" && reused !== "") ? {[EVALUATION_RULES_VERSION_FIELD]: reused} : {};
  }
  return {[EVALUATION_RULES_VERSION_FIELD]: EVALUATION_RULES_VERSION};
}

function buildReportDocument(p) {
  return {
    userId: p.userId,
    deviceFingerprint: p.rawDeviceModel,
    deviceModel: p.rawDeviceModel,
    deviceMarketingName: p.deviceMarketingName,
    // V8 نقل الخامّ (2026-10-09): rawFingerprint وsessionId وdeviceFingerprintSha
    // وtimeSeriesStoragePath وaiAudit **لم تعد هنا** — تُكتب في reportRaw/{scanId}
    // (reportRawStore.js، buildReportRawDocument) في الدفعة الذرّية نفسها. المستند
    // المقروء لا يحمل إلا ما يعرضه؛ `userId` يبقى (قرار 2026-10-09). (القرار ٢٠
    // القديم: audit منفصل عن aiResponse — صار منفصلاً عن المستند المقروء كلّه؛
    // verifyReport لا يقرؤه، مُثبَت بـverifyReportAuditExclusion.test.js.)
    // fix/report-training-links: مرآة الإصدار (fieldsVersion/appVersion) تبقى هنا.
    fieldsVersion: p.fieldsVersion,
    appVersion: p.appVersion,
    // ختم قواعد التقييم — لا يُعرض ولا يدخل verifyReport (docs/V7_DISPLAY_SHAPE_CONTRACT.md §١٥).
    ...evaluationRulesStampFields(p),
    aiResponse: p.aiResponseToSave,
    aiModel: p.aiModel,
    aiDurationMs: p.aiDurationMs,
    aiFallbackReason: p.aiFallbackReason,
    // A103 (القرار ٥/القاعدة 22): grade/score حقلا V6 فقط — V7 لا يُنتجهما
    // (aiResult.grade/score=undefined هناك، وكتابة undefined تكسر Admin
    // SDK). لا تُكتَب المفاتيح أصلاً على V7 — لا undefined ولا null
    // (null يعني "قِيس فلم يوجد"، خاطئ هنا). المستند يُميَّز بـpipeline.
    ...(p.pipeline === V7_PIPELINE_TAG ?
        {} :
        {grade: p.aiResult.grade, score: p.aiResult.score}),
    language: p.language || "ar",
    shortId: p.shortId,
    scoringEngine: "v3-ai-graded",
    isFreeTrial: p.isFreeTrial,
    // Stage 3a: الحقل يميّز التقارير، يجب ألّا يكون undefined.
    pipeline: p.pipeline || V6_PIPELINE_TAG,
    v5Metrics: p.v5Metrics || null,
    // أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤): "حقل analyzedAt يحمل
    // وقت الخادم عند بدء الدالّة. يُكتب في المستند مرّة واحدة، ويُمرَّر إلى
    // categoryStates." — نفس القيمة العددية (epoch ms، Date.now() حقيقي عند
    // بدء exports.analyzeDevice، لا سِنتينل يُحسَم لاحقاً كـcreatedAt أسفله)
    // التي غذّت categoryStates.js (analyzeAtMs → PATCH_AGE) قبل هذا السطر —
    // مصدر واحد، لا نسخة موازية قد تنجرف (القاعدة 24). عدد صريح (لا null)
    // دائماً على المسار الحيّ — exports.analyzeDevice يُمرّرها دوماً؛ غيابها
    // هنا (p.analyzedAtMs=undefined) لا يقع إلا في استدعاء اختباري لم
    // يُمرِّرها، فتُكتب undefined — Admin SDK يرفض ذلك (نفس القيد الموثَّق
    // أعلاه لحقلَي grade/score) — **مقصود**: لا نكتب توقيتاً وهمياً بدل
    // الحقيقي، الاستدعاء الاختباري الذي يتجاهل هذا الحقل يجب أن يُصلَح لا
    // أن يُسكَت عنه.
    analyzedAt: p.analyzedAtMs,
    // القرار ٨٦ البند ٢ (2026-09-25 +03، نصّ الأمر): "يكتب في مستند التقرير
    // حقلين: المسار، وهل نجح الحفظ." — مسار Storage الذي حفظ فيه الخادم
    // ما استلمه من عيّنات (fingerprint.timeSeries.samples) كما استلمه، في
    // مسار منفصل عن رفع التطبيق (timeSeriesStoragePath أعلاه) — راجع
    // serverRawSamplesStorage.js لتفصيل السبب والمسار والقرار الصريح
    // "top-level لا aiAudit" (تقرير المهمّة). فشل الحفظ لا يُفشل التحليل:
    // exports.analyzeDevice يمرّر {path:null, saved:false} صراحة عند أي
    // عطب — لا رمي هنا، لا قيمة افتراضية مختلَقة (القاعدة 22). أسماء
    // الحقلين من مصدر واحد مُصدَّر (SERVER_SAMPLES_STORAGE_PATH_FIELD/
    // SERVER_SAMPLES_SAVED_FIELD، القاعدة 24) — لا نصّ حرفي هنا.
    [SERVER_SAMPLES_STORAGE_PATH_FIELD]: p.serverSamplesStoragePath ?? null,
    [SERVER_SAMPLES_SAVED_FIELD]: !!p.serverSamplesSaved,
    createdAt: SERVER_TIMESTAMP_MARKER,
  };
}

// ===================================================
// Cloud Function: analyzeDevice (callable)
// ===================================================
exports.analyzeDevice = onCall(
    {
      // fix/ai-timeout-and-truncation: raised 120 → 300. V5 budget is
      // precompute (~1s) + DeepSeek up to 150s + Gemini fallback ~60s +
      // validator/fix call (~15s) ≈ 226s worst case. 300s gives margin
      // without changing the Gen 2 max (540s).
      timeoutSeconds: ANALYZE_DEVICE_TIMEOUT_MS / 1000,
      memory: "512MiB",
      secrets: [geminiKey, deepseekKey],
    },
    async (request) => {
      // بدء الدالّة — قبل أي await. أمر مستخدم 2026-09-23 +03، القرار ١:
      // "الوقت المنقضي يُقاس من بدء الدالّة، لا من بدء resolveV7Report. العمل
      // الذي يسبق النموذج يستهلك من الميزانية." functionStartTime هنا، لا في
      // resolveV7Report.js، هو أصل كل حساب زمني لاحق لمحاولة٢/الميزانية.
      const functionStartTime = Date.now();
      const aiCallDeadline = functionStartTime + ANALYZE_DEVICE_TIMEOUT_MS - RESERVED_FOR_DOCUMENT_WRITE_MS;

      const {scanId, fingerprint, language, sessionId} = request.data || {};
      // القاعدة 36: نصّ الخطأ المنقّى يُحسب خارج نداء السجلّ (حارس PII يرفض scanId خامّاً داخله)، والمعرّف معروف فيُخفى حيث ورد.
      const failText = (err) => sanitizeFailureText(err, {knownIds: [scanId]});

      // 1. التحقق من المصادقة — جلسة محل صالحة لها الأولوية، ثم auth العادي.
      //
      // لماذا الجلسة أولاً (إصلاح فوترة جلسات المحل): تطبيق العميل يُسجّل دخولاً
      // مجهولاً (anonymous) على جهاز الزبون قبل استدعاء الدالة، لأن الـ callable
      // SDK يرفض الاستدعاء بلا مستخدم مصادَق. لو فُحِص request.auth أولاً لفاز
      // الـ uid المجهول دائماً وأُهمِل sessionId، فيُطلَب رصيد حساب مجهول لا وجود
      // له فتفشل العملية بـ"لا يوجد رصيد". لذا عند وجود sessionId لجلسة صالحة
      // (حالتها scanning ولم تنتهِ) نُفوتِر على صاحب المحل (ownerId) بصرف النظر
      // عن وجود auth مجهول. صاحب محل يفحص جهازه الشخصي لا يُرسل sessionId →
      // يقع على فرع request.auth العادي.
      let userId;
      let isSessionScan = false;
      // A-SUB الموجة الأولى (قرار المستخدم ١٢): جلسة completed وطلب إعادة محاولة مشروعة لنفس فحصها (ردّ ضاع) — لا فحص جديد أبداً: ردّ مخزَّن أو رفض مسمّى.
      let completedSessionRetry = false;
      const callerUid = request.auth ? request.auth.uid : null;
      // الرفض على الجلسة: الرمز والنصّ كما كانا حرفياً («جلسة الفحص غير صالحة» permission-denied) + details.reasonCode من ANALYZE_SESSION_REFUSAL (يُكشَف لطرفي الجلسة وحدهما).
      const sessionRefusal = (reason) => new HttpsError("permission-denied", "جلسة الفحص غير صالحة", {reasonCode: reason});
      let sessionDataForProtocol = null; // مستند الجلسة وقت الدخول (S-P6-03): غرضها لا يتغيّر بعد pending (setSessionPurpose يقبله وهي pending وحدها)، فهو نهائيّ هنا
      let sessionRef = null; // مرجع scanSessions/{sessionId} — يُحدَّد في فرع الجلسة، ويقرؤه قفل scanClaims داخل معاملته (الدفعة ٩، أدناه)

      if (sessionId) {
        // فحص عبر جلسة محل — يُفوتَر على صاحب المحل صاحب الكود (لا على الجهاز المفحوص).
        sessionRef = db.collection("scanSessions").doc(sessionId);
        const sessionDoc = await sessionRef.get();
        const sessionData = sessionDoc.exists ? sessionDoc.data() : null;
        // **جلسة completed وطلب إعادة محاولة لفحصها نفسه** (ردّ ضاع بعد اكتمال الفحص، القرار ١٢): لا يُرفض بل يُقدَّم ردّه المخزَّن — بشروط (isLegitCompletedSessionRetry: completed + المستدعي طرفها +
        // scanId الطلب = scanId الجلسة) وبحارس ملكية التقرير المخزَّن أدناه (1b). ما عدا ذلك يمرّ بالرفض القائم بسببه المسمّى. لا كتابة هنا ولا حجز ولا نداء نموذج في أيّ فرع من هذا الاستثناء.
        const retryOfCompletedScan = isLegitCompletedSessionRetry(sessionData, scanId, callerUid);
        if (!retryOfCompletedScan && (!sessionDoc.exists || sessionData.status !== SESSION_STATUS.SCANNING)) {
          throw sessionRefusal(analyzeSessionRefusalReason(sessionData, callerUid));
        }
        // الجلسة صالحة ساعة واحدة من إنشائها (createScanSession.js:58) —
        // للانضمام والتحليل والتقييم معاً (قرار مستخدم 2026-09-30 +03
        // «قرار — مهلة الجلسة ساعة»، يُبطل نافذة "60 من الانضمام" في
        // fbcc74c). مصدر واحد (sessionTimeout.js) — القاعدة 24، نفس
        // الفحص/النصّ في submitEvaluation.js بلا نسخة ثانية.
        //
        // الدفعة ٩ (2026-10-10 +03، قرار المستخدم بنصّه): «الانتهاء: بلا منظّف مجدوَل. تُكتب «منتهية» حين تمسّ الجلسةَ دالّةٌ بعد انقضاء وقتها.»
        // فالرفض بسبب انقضاء الوقت يُسجَّل معه «منتهية» في مستند الجلسة (معاملة تعيد فحص الحالة والوقت ولا تكتب إلا لجلسة جارية
        // منقضية). الرمز والنصّ كما كانا حرفياً («الجلسة منتهية» failed-precondition). غياب/تلف expiresAt يبقى رفضاً بلا كتابة (القاعدة 22).
        // فشل التسجيل لا يغيّر الرفض (recordSessionExpiredIfDueSafely لا ترمي).
        // (فرع إعادة المحاولة لجلسة completed لا يمرّ بفحص الانقضاء: الفحص انتهى واكتمل قبل انقضاء الجلسة، وانقضاؤها بعد ذلك لا يُلغي ردّه المخزَّن.)
        const expiry = retryOfCompletedScan ? null : sessionExpiryRefusal(sessionData);
        if (expiry !== null) {
          if (expiry.reason === SESSION_EXPIRY_REASON.EXPIRED) {
            await recordSessionExpiredIfDueSafely({db, FieldValue: admin.firestore.FieldValue, sessionRef, source: "analyzeDevice"});
          }
          // الرمز والنصّ كما كانا حرفياً (من sessionTimeout.js) + details.reasonCode = سبب الانقضاء (من المصدر نفسه) لطرفي الجلسة، وNOT_PARTICIPANT لغيرهما.
          throw new HttpsError(expiry.code, expiry.message, {reasonCode: analyzeSessionReasonForCaller(sessionData, callerUid, expiry.reason)});
        }
        completedSessionRetry = retryOfCompletedScan;
        sessionDataForProtocol = sessionData;
        userId = sessionDoc.data().ownerId; // (ownerActivityWindow.test.js [٨] يحرس هذا السطر حرفياً: فحص الجلسة يُنسَب لمالكها)
        isSessionScan = true;
      } else if (request.auth) {
        userId = request.auth.uid;
      } else {
        throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أو إدخال كود فحص");
      }

      if (!scanId) {
        throw new HttpsError("invalid-argument", "بيانات الفحص ناقصة");
      }

      // 1b. التكافؤ أولاً (idempotency-first): إن وُجد تقرير محفوظ لهذا scanId،
      // أعِده فوراً — بلا استدعاء AI، بلا خصم scansRemaining، ودون اشتراط
      // رصيد/صلاحية. هذا يضمن أن إعادة فتح تقرير (خاصةً جلسة QR من جهاز المالك)
      // أو أي إعادة استدعاء لنفس scanId تُعيد المحفوظ دائماً ولا تُخصَم مرّتين —
      // حتى لو نفد رصيد المالك أو انتهى اشتراكه. القراءة عبر Admin SDK تتجاوز
      // قواعد Firestore، فلا تعتمد على قراءة العميل المباشرة. يعمل لجهاز المالك (uid)
      // ولجهاز الزبون (sessionId، فيُفوتَر على المالك).
      //
      // **لمالكه وحده (البند ٢، 2026-10-17 — قرار المنسّق، منقول: «قبل تقديم أيّ تقرير مخزَّن يجب أن ownerCheckState(userId, existingReport.data().userId) === MATCH في كل المسارات»):**
      // userId أعلاه هو ownerId الجلسة في مسارات الجلسة وuid المستدعي في المسار الشخصي. كان التقرير يُردّ لأيّ مستدعٍ يعرف scanId (سرّ الوصول الوحيد UUID يولّده العميل)؛ الآن غير MATCH
      // (مالك آخر، أو userId غائب في التقرير، أو ownerId غائب في الجلسة) ⟵ رفض مسمّى بلا أيّ جزء من التقرير ولا كتابة ولا خصم، وسطر سجلّ مسمّى بحالته الدقيقة (القاعدة 22: الغياب حالة صريحة).
      // (التقرير القديم المنسوب لغير المالك يُرفض بالقاعدة نفسها: لا استثناء للقِدَم. مثال محتمل — استنتاج من رسالة الالتزام 39e5d14 لا من بيانات الإنتاج: جلسات المحل قبله كانت تُفوتَر على uid الزبون
      // المجهول حين وُجد auth، فقد يكون userId في تقاريرها ذلك الـuid.)
      const reportRef = db.collection("reports").doc(scanId);
      const existingReport = await reportRef.get();
      // جلسة completed (إعادة محاولة مشروعة): حارس ملكية التقرير المخزَّن قبل تقديمه — userId فيه = ownerId الجلسة (ownerCheckState، مصدره sessionCompletion.js: الغياب لا يطابق، القاعدة 22). غيابه أو عدم
      // تطابقه ⟵ رفض مسمّى SESSION_COMPLETED بلا تسريب (النصّ القائم نفسه). ولا فحص جديد من هذا الفرع إطلاقاً.
      if (completedSessionRetry &&
          (!existingReport.exists || ownerCheckState(userId, existingReport.data().userId) !== OWNER_CHECK_STATE.MATCH)) {
        throw sessionRefusal(ANALYZE_SESSION_REFUSAL.COMPLETED);
      }
      if (existingReport.exists && !completedSessionRetry) {
        // جلسة completed حُرست أعلاه بـownerCheckState (سببها SESSION_COMPLETED، كما كان)؛ كل ما عداها — جلسة scanning أو مسار شخصي — يمرّ هنا بالحكم نفسه، وغير MATCH رفض مسمّى.
        const ownerVerdict = storedReportServeVerdict({userId, reportUserId: existingReport.data().userId});
        if (!ownerVerdict.serve) {
          const reason = isSessionScan ? ANALYZE_SESSION_REFUSAL.REPORT_NOT_AVAILABLE : STORED_REPORT_REFUSAL.NOT_AVAILABLE;
          logStoredReportRefusal({
            reason, ownerState: ownerVerdict.ownerState, scanId, sessionId,
            path: isSessionScan ? STORED_REPORT_PATH.SESSION : STORED_REPORT_PATH.PERSONAL,
          });
          if (isSessionScan) throw sessionRefusal(reason);
          throw new HttpsError(STORED_REPORT_REFUSAL_CODE, STORED_REPORT_REFUSAL_TEXT, {reasonCode: reason});
        }
      }
      if (existingReport.exists) {
        // S6 (أمر مستخدم 2026-10-01 +03) — الحذف عند الإرجاع فقط، فرع V7
        // وحده (راجع تعليق stripNarrativeDetailsVerdictFromV7Response أعلاه
        // للتفصيل الكامل وسبب عدم مسّ V6). المستند نفسه (existingReport)
        // بلا أي تعديل — لا كتابة هنا أصلاً.
        const existingData = existingReport.data();
        // §٦-د المسار ب (S-SWEEP، 2026-10-15 +03، E26 وE35): ردّ مخزَّن لجلسة (isSessionScan: فُحصت scanning أعلاه) يُكتب لها «اكتملت» بالطريقة نفسها قبل الإرجاع —
        // معاملة تكتب فقط إن كانت الجلسة ما زالت scanning وإن كان userId في التقرير المخزَّن = ownerId الجلسة (scanId يأتي من العميل، فلا تُكتب اكتمالاً لجلسة بتقرير غيرها)،
        // بثلاث محاولات على فشل الكتابة وسطر مسمّى للفشل النهائي لا ابتلاع. الحقول من مستند التقرير المخزَّن (الغائب يبقى غائباً). الردّ للمستدعي لا يتغيّر: أفضل جهد، لا يرمي.
        if (completedSessionRetry) {
          // الجلسة completed من قبل: لا كتابة اكتمال ثانية (لا انتقال من نهائية إلى نهائية). سطر مسمّى للردّ المقدَّم (المعرّفان مُهشَّران).
          console.log(`[analyzeDevice] completed-session retry: the stored report is served session=${hashIdForLog(sessionId)} scanId=${hashIdForLog(scanId)}`);
        } else if (isSessionScan) {
          const {fields: completionFields, absentFields} = cachedCompletionFields({scanId, reportData: existingData});
          await completeSessionBestEffort({
            db, FieldValue: admin.firestore.FieldValue, sessionRef, path: COMPLETION_PATH.CACHED_RESPONSE,
            fields: completionFields, absentFields, ownerGuard: {reportUserId: existingData.userId},
          });
        }
        return existingData.pipeline === V7_PIPELINE_TAG ?
            stripNarrativeDetailsVerdictFromV7Response(existingData.aiResponse) :
            existingData.aiResponse;
      }

      // فحص جديد (لا تقرير محفوظ) يتطلّب fingerprint.
      if (!fingerprint) {
        throw new HttpsError("invalid-argument", "بيانات الفحص ناقصة");
      }

      // 2. التحقق من الاشتراك (رصيد صاحب المحل إذا كانت جلسة)
      //
      // إضافة 2026-10-09 (حجز الرصيد): هذا فحص **مبكّر بلا كتابة** — يردّ الحساب بلا رصيد قبل أيّ كتابة
      // (قفل أو غيره). الحجز الحقيقي معاملة بعد القفل وقبل نداء النموذج (scanReservation.js)، وهي التي
      // تحسم التزامن: هذا الفحص وحده لا يمنع فحصين متزامنين برصيد واحد.
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.exists ? userDoc.data() : null;

      // مفتاح الجهاز للفحص المجاني (يدخل الحكم أدناه ومعاملة الحجز).
      const deviceFP = (fingerprint.device?.model || "Unknown") + "_" +
                       (fingerprint.device?.androidVersion || "") + "_" +
                       (fingerprint.device?.totalRamGb || "");

      // ─── S-P6-07 (2026-10-21 +03): سياق البروتوكول — كلّه يُقرأ هنا قبل القفل والحجز ونداء النموذج، فأيّ فشل قراءة يفشل الفحص قبل أن يكلّف شيئاً (docs/PROTOCOL_CONTRACT.md §٢ A4):
      //   • أجزاء المحلّ (users/{ownerId}.protocolParts: «الغائب «غير مفعَّل»»)، والإعدادات protocolSettings/current (بمعرّف المستند: القاعدة 43)، ومستند protocolPending للجلسة (غرض ومصدر + سياق الابن).
      //   • **الفحص الثاني للتكرار (الابن):** جلسة فيها protocolPending.repeatOfSessionId. يُصنَّف هنا (P:645-648: |الثانية − الأولى| ≤ 1° ⟵ بارد، وإلّا ساخن، وغياب إحداهما ⟵ غير مصنَّف) لأنّ الإعفاء من الخصم
      //     (P:657، س٢٠) يتبع التصنيف ويسبق البوّابة والحجز. **الإعفاء للتكرار البارد وحده وبعلَم مرحلة الجمع `true` صريحةً.**
      //   • مستند الأمّ scanProtocol/{repeatOfScanId} يُقرأ مرّة (بمعرّف المستند) ليُحدَّث في الدفعة الذرّية نفسها إن كانت حالته STARTED لهذا الابن (decideParentCompletion).
      const protocolParts = readProtocolParts(userData);
      const protocolSettings = await readProtocolSettings({db});
      if (protocolSettings.anomaly !== null) {
        // مستند إعدادات موجود بلا version صالح (كتابة يدوية): يُقرأ غائباً ويُعلَن هنا (لا يُسكَت عنه)؛ لا معرّف ولا قيمة في السطر.
        console.warn(`[analyzeDevice] protocolSettings document present but unusable anomaly=${protocolSettings.anomaly} — read as SETTINGS_ABSENT`);
      }
      let protocolPendingData = null;
      if (isSessionScan) {
        const pendingSnap = await db.collection(PROTOCOL_COLLECTION.PROTOCOL_PENDING).doc(sessionId).get();
        protocolPendingData = pendingSnap.exists ? pendingSnap.data() : null;
      }
      const repeatChild = readRepeatChildContext(protocolPendingData);
      const scanStartTemp = readStartTemp(fingerprint.timeSeries && fingerprint.timeSeries.header ? fingerprint.timeSeries.header.batteryTempStart : undefined);
      let childClassification = null;
      let creditExemption = null;
      let parentProtocolData = null;
      if (repeatChild.isChild) {
        childClassification = classifyRepeatScan({reference: repeatChild.reference, second: scanStartTemp});
        if (isCreditExempt(childClassification, readCollectionPhase(protocolSettings))) creditExemption = CREDIT_EXEMPTION.PROTOCOL_EXEMPT;
        if (repeatChild.parentScanId !== null) {
          const parentSnap = await db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(repeatChild.parentScanId).get();
          parentProtocolData = parentSnap.exists ? parentSnap.data() : null;
        }
        console.log(`[analyzeDevice] repeat scan session=${hashIdForLog(sessionId)} purpose=${childClassification.purpose} absence=${childClassification.absence === null ? "none" : childClassification.absence} ` +
            `deltaC=${childClassification.deltaC === null ? "NOT_MEASURED" : childClassification.deltaC} exempt=${creditExemption !== null}`);
      }
      // ق10 (2026-10-23، قرار المستخدم عبر حسن: «نطاق الإعفاء يتبع س٢٠: البارد، فحص «بعد»، المرتجع»؛ المرتجع لا يُبنى): فحص «بعد» (غرض الجلسة المُعلَن maintenance_after) في مرحلة الجمع
      // (collectionPhase === true صريحة) معفى بالآلية القائمة نفسها: PROTOCOL_EXEMPT — لا بوّابة ولا حجز ولا خصم (الفروع أدناه تتبع creditExemption وحده)، ويُكتب في scanProtocol.
      // فحص جلسة وحدها، ولا يمرّ فوق إعفاء قائم (البارد: غرض الابن من التصنيف لا من الجلسة، فلا يلتقي الاثنان). normal وmaintenance_before والفحص الشخصي: creditExemption يبقى null فلا يتغيّر عليها شيء.
      if (creditExemption === null && isSessionScan && isAfterScanCreditExempt({sessionData: sessionDataForProtocol, collectionPhase: readCollectionPhase(protocolSettings)})) {
        creditExemption = CREDIT_EXEMPTION.PROTOCOL_EXEMPT;
      }

      // S-SUB (2026-10-16 +03، قرار المستخدم 2026-10-14: «سطر سجلّ بسبب مسمّى لرفض analyzeDevice المبكّر»): الحكم من scanGateVerdict (scanRefusal.js) — المصدر الواحد مع معاملة الحجز
      // وردّ checkSubscription — بالترتيب الذي كان: (١) الرصيد، (٢) انتهاء الاشتراك الشهري (30 يوماً: إن مرّ expiresAt يُرفض الفحص حتى لو بقي رصيد؛ غياب expiresAt = لا انتهاء، أمان
      // للمستخدمين القدامى — utils/subscription.js)، (٣) الفحص المجاني على الجهاز نفسه (باقة free وحدها). في فحص الجلسة userData = وثيقة صاحب المحل (ownerId)، فتُفحَص صلاحيته هو
      // لا الجهاز المجهول (إصلاح فوترة الجلسات) ويخرج الرمز بنسخة SHOP_. الرمي والسطر المسمّى (stage=early) من refuseScan، موضع الرمي الوحيد؛ رمز الخطأ ونصّه العربي كما كانا حرفياً،
      // ويُضاف details.reasonCode.
      // S-P6-07: الفحص المعفى (PROTOCOL_EXEMPT) لا يمرّ بهذه البوّابة ولا بالحجز: لا خصم، فلا معنى لرصيد ≥ 1 شرطاً له (محلّ استُنفد رصيده بفحصه الأوّل يُكمل تكراره). السطران (الحكم والرمي) كما كانا حرفياً
      // داخل كتلة الفحص غير المعفى — فالحكم الواحد وموضع الرمي الواحد كما حرسهما scanRefusalGuard.test.js وsubscriptionState.test.js.
      if (creditExemption === null) {
        const gateRefusal = scanGateVerdict(userData, {deviceFP});
        if (gateRefusal !== null) refuseScan(gateRefusal, {stage: SCAN_REFUSAL_STAGE.EARLY, isSessionScan, scanId});
      }
      // الباقة المجانية تُحسم من الحجز أدناه (reservation.isFreeTrial: من مستند المعاملة نفسها) — لا قيمة أوّلية تُقرأ قبله (كانت هنا قيمة تُكتب ثم تُمحى بالحجز).
      let isFreeTrial;

      // 3. منع تكرار الفحص المتزامن — claim. (الطبقة الأولى idempotency-first
      // أعلاه تكفّلت بالتقرير المكتمل الموجود؛ هنا نمنع طلبين متزامنين لنفس
      // scanId لم يُنتجا تقريراً بعد.)
      //
      // In-flight claim within the TTL → reject as already-in-progress.
      // Prevents the retry-storm pattern: the user taps retry on a slow scan
      // and each tap would otherwise trigger a fresh DeepSeek call (compound
      // cost). The transaction makes the claim race-free when retries arrive
      // milliseconds apart.
      //
      // TTL raised 90s → 300s. The old value was SHORTER THAN THE WORK IT
      // GUARDED, so the guard leaked. Observed on scan eba424aa:
      //   21:26:15.840  call A starts
      //   21:27:48.378  call B starts — 92.5s later, i.e. 2.5s past the old
      //                 TTL, so A's claim read as stale and B overwrote it
      //   21:27:48.497  …11 further taps correctly rejected over 5.5s
      //   21:29:17.477  A completes (181.6s)
      //   21:31:12.901  B completes (204.5s)
      // Two full model calls, two scans deducted, two uploads. The
      // idempotency-first layer could not catch B either: A had not saved its
      // report yet when B passed the gate.
      //
      // 300_000 = the function's own timeoutSeconds. A claim cannot usefully
      // outlive the invocation holding it: while that invocation runs, the
      // claim must hold; if it died without reaching the `finally` cleanup
      // below, the function timeout bounds how long that can last. On every
      // normal path — success or handled failure — the claim is deleted
      // immediately, so this TTL only governs hard crashes and timeouts.
      //
      // الدفعة ٩ (2026-10-10 +03، مسار الجلسة): قيمة TTL مصدر واحد مُصدَّر (scanReservation.js: SCAN_CLAIM_TTL_MS = 300_000، القيمة نفسها) —
      // يقرؤها cancelScanSession لتفرّق «تحليل يجري» (عمر القفل < TTL: يُرفض الإلغاء) عن «حجز عالق» (≥ TTL: يُعاد).
      // وفحص الجلسة التالي داخل هذه المعاملة نفسها (لا قبلها وحدها): cancelScanSession تكتب «ملغاة» في معاملة تقرأ أقفال الجلسة؛ فمعاملتان تقرآن
      // مستند الجلسة وتتعارضان على كتابته تُسلسَلان — إمّا يُكتب القفل أوّلاً فيُرفض الإلغاء «تحليل يجري»، أو تُكتب «ملغاة» أوّلاً فيُرفض هذا
      // التحليل هنا بـ«جلسة الفحص غير صالحة» ولا يُحجَز رصيد. وsessionId يُكتب على القفل ليربط الحجز المعلّق بجلسته (cancelScanSession تعيده).
      // الفحص الأوّل خارج المعاملة (أعلاه) يبقى لرفض مبكّر بلا كتابة.
      const claimRef = db.collection("scanClaims").doc(scanId);
      const CLAIM_TTL_MS = SCAN_CLAIM_TTL_MS;
      const isAlreadyClaimed = await db.runTransaction(async (tx) => {
        let carriedReservation = null;
        const claim = await tx.get(claimRef);
        if (isSessionScan) {
          const sessionSnap = await tx.get(sessionRef);
          if (!sessionSnap.exists || sessionSnap.data().status !== SESSION_STATUS.SCANNING) {
            throw sessionRefusal(analyzeSessionRefusalReason(sessionSnap.exists ? sessionSnap.data() : null, callerUid));
          }
        }
        if (claim.exists) {
          const ageMs = Date.now() - (claim.data().claimedAtMs || 0);
          if (ageMs < CLAIM_TTL_MS) {
            return true; // another invocation owns this scanId
          }
          // stale claim — older than TTL — overwrite and proceed
          // V8 (حجز الرصيد): قفل قديم قد يحمل حجزاً لم يُحرَّر (انهيار/مهلة) — يُحمَل إلى القفل الجديد كي
          // تتبنّاه reserveScanCredit بلا خصم ثانٍ (أو تُعيده لصاحبه)، لا أن يضيع بالكتابة فوقه.
          carriedReservation = claim.data().reservation || null;
        }
        tx.set(claimRef, {
          scanId: scanId,
          userId: userId,
          claimedAtMs: Date.now(),
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
          reservation: carriedReservation,
          // فحص جلسة فقط: الفحص الشخصي لا جلسة له فلا حقل (غائب لا null).
          ...(isSessionScan ? {sessionId: sessionId} : {}),
        });
        return false;
      });

      if (isAlreadyClaimed) {
        console.warn(`[analyzeDevice] duplicate request for scanId=${hashIdForLog(scanId)} ` +
            `(retry storm guard)`);
        throw new HttpsError(
            "already-exists",
            "هذا الفحص قيد المعالجة، يرجى الانتظار",
        );
      }

      // V8 (إضافة 2026-10-09): حجز الرصيد في معاملة **قبل** نداء النموذج، وإعادته إن فشل التحليل أو لم
      // يُحفَظ التقرير. التفصيل ومسارات الفشل كلّها: scanReservation.js (رأس الملفّ).
      let reservation = null;
      let reportSaved = false;
      let claimMustStay = false;

      try {
        if (creditExemption !== null) {
          // S-P6-07: فحص معفى (PROTOCOL_EXEMPT) — لا حجز ولا خصم. وإن حمل القفل حجزاً قديماً لهذا المعرّف نفسه (محاولة سابقة حُجزت قبل أن يصير الفحص معفىً: علَم مرحلة الجمع تغيّر بين المحاولتين)
          // فيُعاد لصاحبه الآن (releaseScanCredit متكافئة: لا شيء يُعاد إن لم يكن حجز) كي لا يضيع بمحو القفل في finally. الباقة المجانية بالتعريف نفسه في reserveScanCredit.
          const carried = await releaseScanCredit({db, FieldValue: admin.firestore.FieldValue, claimRef});
          isFreeTrial = (userData && userData.plan ? userData.plan : "free") === "free";
          console.log(`[analyzeDevice] credit exempt (${creditExemption}) scanId=${hashIdForLog(scanId)} — no reservation, no charge carriedReservationReleased=${carried.released}`);
        } else {
          reservation = await reserveScanCredit({
            db, FieldValue: admin.firestore.FieldValue, userId, deviceFP, claimRef, nowMs: Date.now(), isSessionScan,
          });
          isFreeTrial = reservation.isFreeTrial;
          if (reservation.adopted) {
            console.warn(`[analyzeDevice] adopted a stale reservation scanId=${hashIdForLog(scanId)} — no second charge`);
          }
        }

        // القرار ٨٦ البند ٢ (2026-09-25 +03): يبدأ حفظ العيّنات الخام إلى
        // Storage **الآن** — موازياً لنداء النموذج أدناه، لا بعده. نصّ
        // الأمر: "تصميم لا يزيد زمن الدالّة (كأن يبدأ الرفع موازياً
        // للنموذج ويُنتظر قبل كتابة المستند) أفضل إن صحّ." هذا هو ذلك
        // التصميم: الـ await الوحيد على هذا الوعد يقع بعد runAnalysisInternal
        // (~10-265 ثانية) لا هنا — فحلقة الأحداث تُنجز الضغط والرفع بينما
        // ننتظر النموذج أصلاً، لا وقتاً إضافياً فوق ذلك (ما لم يتجاوز الرفع
        // نفسه مدّة نداء النموذج، وهو ما تقيسه الأداة المذكورة في تقرير
        // المهمّة تحت "قياس قبل/بعد" — غير مقيس بشبكة حقيقية هنا).
        //
        // "في كل فحص" (نصّ الأمر) — بلا شرط على نجاح التحليل لاحقاً: هذا
        // المكان (بعد claim ناجح، قبل أي فشل AI محتمل) هو أقرب نقطة نتأكّد
        // فيها أن هذا الاستدعاء سيمضي فعلاً في تحليل حقيقي (لا استدعاء
        // مرفوض بمصادقة/اشتراك/جلسة عبر throw أعلاه قبل هذه النقطة) —
        // خلاف ذلك كنّا سنرفع عيّنات لفحوص رُفضت قبل أي محاولة تحليل.
        const serverSamplesSavePromise = saveServerRawSamples({
          bucket: admin.storage().bucket(),
          scanId,
          samples: fingerprint && fingerprint.timeSeries && fingerprint.timeSeries.samples,
        });
        // فشل هذا الوعد لا يجوز أن يُسقط analyzeDevice كلّها (Promise
        // rejection غير مُعالَجة إن لم يُستهلَك أحد لاحقاً) — لكن
        // saveServerRawSamples لا ترمي أصلاً (تُعيد {saved:false} دائماً،
        // راجع تعليقاتها) فهذا catch دفاع في العمق فقط، لا مسار متوقَّع.
        serverSamplesSavePromise.catch((e) => {
          console.error(`[analyzeDevice] serverSamplesSavePromise رمت رغم توثيقها ألّا ترمي — ${failText(e)}`);
        });

        // 4. تحليل AI (منطق مشترك مع runConsistencyTest)
        // scanContext يُمرَّر لـ runAnalysisInternal لاستخدامه في deviceProfiles + previousScan
        const scanContext = {
          scanId: scanId,
          scanDate: new Date().toISOString(),
        };
        const {
          aiResult, aiResultAudit, aiFailed, rawDeviceModel, aiModel, aiDurationMs,
          aiFallbackReason, pipeline, v5Metrics, existingProfile, deviceProfileKey,
          reusedEvaluationRulesVersion,
        } = await runAnalysisInternal({
          fingerprint,
          language,
          deepseekKey: deepseekKey.value(),
          geminiKey: geminiKey.value(),
          scanContext,
          // القرار ١ — الموعد النهائي المطلق (epoch ms) لأي نداء resolveV7Report
          // ثانٍ. مُشتقّ من بدء هذه الدالّة (أعلاه)، لا من بدء resolveV7Report.
          deadline: aiCallDeadline,
          // القرار ٧٥ البند ٤ (2026-09-24 +03) — نفس functionStartTime
          // المُلتقَط أعلاه ("بدء الدالّة — قبل أي await") لا قيمة Date.now()
          // ثانية منفصلة: مصدر واحد لمعنى "متى بدأ هذا الفحص" (القاعدة 24
          // بامتدادها)، يغذّي حساب المهلة (aiCallDeadline) وPATCH_AGE معاً.
          analyzedAtMs: functionStartTime,
          // S-P6-07 (P:404-407): لا إعادة استعمال من الكاش ولا previousScan في الفحوص البروتوكولية (التكرار وbattery_after)؛ null لغيرها فلا تغيّر في سلوكها.
          reuseBlockedReason: protocolReuseBlockedReason({childContext: repeatChild, classification: childClassification, sessionData: sessionDataForProtocol}),
        });

        // Hard AI failure (DeepSeek + Gemini both failed): reject with a clear
        // retryable error. We DO NOT save a report, DO NOT charge a scan, and
        // DO NOT write a device profile — no fabricated C/50 report. The
        // `finally` block below releases the scanClaim so the user (or the shop
        // owner, for a session scan — billing is on ownerId either way) can
        // retry cleanly. The shop session is left in "scanning" (not marked
        // completed), so the customer can re-scan within the 15-min window.
        if (aiFailed || !aiResult) {
          console.warn(`[analyzeDevice] hard AI failure scanId=${hashIdForLog(scanId)} ` +
              `reason=${aiFallbackReason || "unknown"} — not charging, not saving`);
          throw new HttpsError(
              "unavailable",
              language === "tr" ?
                "Sonuçlar analiz edilemedi, lütfen tekrar deneyin" :
                "تعذّر تحليل النتائج، يرجى إعادة المحاولة",
          );
        }

        // اكتُشِف أثناء A104 (مهمّة 2026-09-21 +03) بنفس منهج A103 — مُتحقَّق
        // بتشغيل فعلي عبر محاكي Firestore لا بالقراءة وحدها (راجع تقرير
        // المهمّة): aiResult.deviceMarketingName **غائب أيضاً** على فرع V7
        // (buildDisplayShapeV7.display لا يحمل هذا الحقل إطلاقاً — صفر
        // نتيجة "deviceMarketingName" في buildDisplayShapeV7.js كاملاً)،
        // فكان هذا السطر سيكتب deviceMarketingName: undefined إلى Firestore
        // ويُلقي نفس استثناء A103 حرفياً (أُعيد إنتاجه فعلياً بإزالة القيمة
        // المُصطنَعة من fixture اختبار aiAuditWiring.e2e.test.js مؤقّتاً).
        // الإصلاح هنا يُطابق احتياطي V6 الحقيقي حرفياً (runAnalysisInternal.js:512
        // `marketingNameRaw || rawDeviceModel`) — لا قيمة مُختلَقة جديدة، نفس
        // الاحتياطي المعتمَد أصلاً لحالة "AI لم يُعطِ اسماً تسويقياً".
        const deviceMarketingName = aiResult.deviceMarketingName || rawDeviceModel;
        aiResult.isFreeTrial = isFreeTrial; // التطبيق يستخدمها لإخفاء PDF/QR — على aiResult المُعاد للعميل، لا على ما يُكتب إلى Firestore (راجع buildV7ResponseForStorage أعلاه لفرع V7)

        // Stage 3a: prefer V5-emitted shortId when present (the V5 path generates
        // its own shortId via crypto.randomBytes inside callAI). Falls back to
        // the existing generateShortId for V3.
        const shortId = (typeof aiResult.shortId === "string" && aiResult.shortId) ?
            aiResult.shortId :
            generateShortId();

        // 6b. روابط بيانات التدريب (fix/report-training-links).
        //
        // مسار الخام: التطبيق يرفع السلسلة الزمنية إلى Cloud Storage على
        //   scans/{deviceFingerprint}/{scanId}.ts.json.gz
        // (FirebaseSyncService.kt: storage.reference.child("scans/${scan
        //  .deviceFingerprint}/${scan.scanId}.ts.json.gz")). نفس متغيّر
        // deviceFp يُختَم في ScanEntity.deviceFingerprint وفي
        // TimeSeriesHeader.deviceFingerprint، ويُنسَخ حرفياً إلى الحمولة
        // (BehaviorFingerprintBuilder: deviceFingerprint = h.deviceFingerprint)
        // → حقل الترويسة هو نفسه مقطع المسار.
        //
        // تنبيه: الحقل القائم `deviceFingerprint` في هذا المستند يحوي موديل
        // الجهاز (rawDeviceModel) لا البصمة — لذا تُكتب البصمة في حقل منفصل
        // ولا يُمَسّ الحقل القديم.
        //
        // التطبيق يرسل header.deviceFingerprint = "" على مساره المتدهور
        // (BehaviorFingerprintBuilder عندما timeSeries == null)، لذا السلسلة
        // الفارغة تُعامَل كغياب ويُكتب null — لا يُخمَّن مسار أبداً. القيمة
        // تُكتب حرفياً بلا trim كي يطابق المسار ما يرفعه التطبيق بالضبط.
        const tsHeader = fingerprint.timeSeries?.header || {};
        const tsFooter = fingerprint.timeSeries?.footer || {};

        const rawFpSha = tsHeader.deviceFingerprint;
        const deviceFingerprintSha =
            (typeof rawFpSha === "string" && rawFpSha.trim() !== "") ?
                rawFpSha :
                null;
        const timeSeriesStoragePath = deviceFingerprintSha ?
            `scans/${deviceFingerprintSha}/${scanId}.ts.json.gz` :
            null;

        // مرآة الإصدار: تُرفَع إلى أعلى المستند كي يمكن الاستعلام
        // "كل التقارير بإصدار حقول 65" دون حفر في
        // rawFingerprint.timeSeries.footer/header. footer.fieldsVersion
        // اختياري في حمولة التطبيق (Int? = null)، و header.appVersion قد
        // يصل "" على المسار المتدهور → كلاهما null عند الغياب.
        const fieldsVersion =
            (typeof tsFooter.fieldsVersion === "number" &&
             isFinite(tsFooter.fieldsVersion)) ?
                tsFooter.fieldsVersion :
                null;
        const rawAppVersion = tsHeader.appVersion;
        const appVersion =
            (typeof rawAppVersion === "string" && rawAppVersion.trim() !== "") ?
                rawAppVersion :
                null;

        // A104 (مهمّة 2026-09-21 +03): على فرع V7 فقط، يُعاد بناء ما يُكتب
        // تحت aiResponse بحقول مُسمّاة صراحةً (buildV7ResponseForStorage
        // أعلاه) بدل تمرير aiResult بالمرجع — دفاع في العمق ضد أي مفتاح
        // متداخل غير معروف (راجع تعليق الدالّة). فرع V6 بلا أي تغيير سلوكي
        // — aiResult يُكتب كما كان دائماً.
        const aiResponseToSave = (pipeline === V7_PIPELINE_TAG) ?
            buildV7ResponseForStorage(aiResult) :
            aiResult;

        // القرار ٨٦ البند ٢ — ننتظر هنا فقط (لا عند بدء الوعد أعلاه). في
        // المسار العادي الوعد منتهٍ فعلاً منذ زمن (runAnalysisInternal
        // استغرق ثوانٍ إلى دقائق أعلاه؛ ضغط ~1600 عيّنة ورفعها أقصر بكثير
        // — راجع measure-server-raw-samples-write.js لقياس الضغط وحده،
        // "غير مقيس" للرفع نفسه بلا شبكة، وتقرير المهمّة لكيفية قياسه في
        // الإنتاج) — فهذا الـawait لا يضيف زمناً فعلياً في الحالة الشائعة.
        const {path: serverSamplesStoragePath, saved: serverSamplesSaved} =
            await serverSamplesSavePromise;

        // 7. حفظ التقرير أولاً — قبل أي كتابة profile، كي لا يشير profile لتقرير
        // غير محفوظ (إصلاح reportRef not found).
        //
        // أمر مستخدم 2026-09-24 +03 (القرار ٧٥، البند ٢-أ): الكائن الحرفي
        // الذي كان هنا استُخرج إلى buildReportDocument (أعلى هذا الملفّ) —
        // دالّة نقيّة، نفس المفاتيح/الشروط/الترتيب حرفياً، فقط بديل
        // SERVER_TIMESTAMP_MARKER بدل admin.firestore.FieldValue.serverTimestamp()
        // (الدالّة لا تستورد admin). الاستبدال الحقيقي يقع هنا فقط، عند
        // النداء الفعلي — راجع تعليقات القرار ٢٠/A103/Stage 3a الكاملة
        // داخل buildReportDocument نفسها لتفصيل كل حقل (لم تُحذف، انتقلت).
        const reportDocument = buildReportDocument({
          userId, rawDeviceModel, deviceMarketingName, deviceFingerprintSha,
          timeSeriesStoragePath, fieldsVersion, appVersion, fingerprint,
          aiResponseToSave, aiResultAudit, aiModel, aiDurationMs, aiFallbackReason,
          pipeline, aiResult, language, isSessionScan, sessionId, shortId,
          isFreeTrial, v5Metrics,
          // ختم قواعد التقييم (evaluationRulesStampFields أعلاه): غير مُعرَّف إلا في مسار التقرير المخبَّأ (ختم التقرير الأصل إن حمله).
          reusedEvaluationRulesVersion,
          // القرار ٧٥ البند ٤ — نفس functionStartTime المُلتقَط أعلى الدالّة
          // (بدء الدالّة، قبل أي await)، نفس القيمة الممرَّرة إلى
          // runAnalysisInternal→computeCategoryStates لِـPATCH_AGE.
          analyzedAtMs: functionStartTime,
          // القرار ٨٦ البند ٢ — نتيجة الحفظ المبدوء أعلاه، مُنتظَرة الآن.
          serverSamplesStoragePath, serverSamplesSaved,
        });
        reportDocument.createdAt = admin.firestore.FieldValue.serverTimestamp();
        // V8 نقل الخامّ: الخامّ في reportRaw/{scanId} بدفعة واحدة ذرّية مع التقرير
        // (وثيقة التصميم §٣-٤). فوق العتبة: خطأ صريح قبل أيّ كتابة — لا اقتطاع
        // (القاعدة 20)، ولا تُخصَم فحصة (الخصم بعد الكتابة).
        const rawDocument = buildReportRawDocument({
          scanId, fingerprint, isSessionScan, sessionId, deviceFingerprintSha,
          timeSeriesStoragePath, aiResultAudit,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        try {
          assertReportRawFits(rawDocument);
        } catch (e) {
          if (e && e.code === "REPORT_RAW_TOO_LARGE") {
            console.error(`[analyzeDevice] ${e.message} scanId=${hashIdForLog(scanId)}`);
            throw new HttpsError("resource-exhausted", "بيانات الفحص أكبر من الحدّ المسموح للتخزين");
          }
          throw e;
        }
        // S-P6-03 (2026-10-18 +03): مستند scanProtocol في الدفعة الذرّية نفسها (A2: «فلا تقرير بلا سجلّ بروتوكوله»). الغرض من مستند الجلسة (purpose)، ومصدره من protocolPending/{sessionId} (قراءة بمعرّف المستند، بلا فهرس: القاعدة 43).
        // فحص بلا جلسة ⟵ NO_SESSION؛ جلسة بلا purpose ⟵ UNDECLARED (لا «عادي» صامتاً)؛ والملاحظات المسمّاة (غرض غير معروف، مصدر غائب) تُطبَع ولا تُكتب. فشل القراءة هنا يفشل التحليل كفشل الكتابة (الحجز يُعاد).
        // S-P6-07: مستند protocolPending والإعدادات وأجزاء المحلّ قُرئت أعلاه (قبل القفل)؛ والقرعة وسجلّ الاختيار `repeat` يُحسبان هنا لا هناك كي لا تُسحب قرعة لفحص فشل تحليله.
        const protocolBuilt = buildScanProtocolDocument({
          isSessionScan, sessionData: sessionDataForProtocol, pendingData: protocolPendingData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          settings: protocolSettings, parts: protocolParts, random: Math.random, startTemp: scanStartTemp, childContext: repeatChild, creditExemption, parentProtocolData,
        });
        if (protocolBuilt.notes.length > 0) {
          console.warn(`[analyzeDevice] scanProtocol notes=${protocolBuilt.notes.join(",")} purpose=${protocolBuilt.document.scanPurpose}`);
        }
        console.log(`[analyzeDevice] scanProtocol repeat state=${protocolBuilt.document.repeat.state} reason=${protocolBuilt.document.repeat.reason === null ? "none" : protocolBuilt.document.repeat.reason} ` +
            `settingsVersion=${protocolBuilt.document.settingsVersion}`);
        // S-P6-12 (2026-10-21): حالة الموافقة المكتوبة وأساسها (RECORDED · NO_SESSION · NOT_RECORDED · UNREADABLE) — بلا معرّف ولا قيمة شخصية.
        console.log(`[analyzeDevice] scanProtocol consent state=${protocolBuilt.consent.state} basis=${protocolBuilt.consent.basis}`);
        // الفحص الثاني للتكرار: تحديث حالة الأمّ في الدفعة نفسها (decideParentCompletion: STARTED لهذا الابن وحده؛ غير ذلك يُعلَن بسطر ولا يُكتب).
        let parentProtocolUpdate;
        if (repeatChild.isChild) {
          const completion = repeatChild.parentScanId === null ?
              {update: false, reason: PARENT_COMPLETION_SKIP.PARENT_SCAN_ID_ABSENT} :
              decideParentCompletion({parentData: parentProtocolData, childSessionId: sessionId});
          if (completion.update) {
            parentProtocolUpdate = {
              scanId: repeatChild.parentScanId,
              fields: {
                "repeat.state": completedStateFor(protocolBuilt.classification.purpose),
                "repeat.completedByScanId": scanId,
                "repeat.completedAt": admin.firestore.FieldValue.serverTimestamp(),
              },
            };
          } else {
            console.warn(`[analyzeDevice] repeat parent not updated reason=${completion.reason} session=${hashIdForLog(sessionId)}`);
          }
        }
        // (S5، 2026-10-22، A3 البند ٤) فحص «بعد» ذو ربط مؤكَّد: الكتابة معاملة واحدة تعيد التحقّق من «قبل»؛ ضياع الهدف لا يُسقط التقرير.
        const writeResult = await writeReportAndRaw({
          db, reportRef, scanId, reportDocument, rawDocument, protocolDocument: protocolBuilt.document,
          ...(parentProtocolUpdate !== undefined ? {parentProtocolUpdate} : {}),
          ...(protocolBuilt.pairLink.state === PAIR_LINK_INTENT.CHOSEN ?
              {pairLink: {beforeScanId: protocolBuilt.pairLink.beforeScanId, afterDefectType: protocolBuilt.document[SCAN_PROTOCOL_FIELD.DEFECT_TYPE]}} : {}),
        });
        reportSaved = true;
        if (writeResult && writeResult.pair) {
          const pairTarget = hashIdForLog(protocolBuilt.pairLink.beforeScanId);
          if (writeResult.pair.outcome === PAIR_COMPLETION.LINKED) {
            // (ق36 أ، 2026-10-22، أقرّه حسن) ملاحظة الطراز: تُكتب على «بعد» في المعاملة نفسها (linkModelCheck) وتُطبَع بأسلوب LINK_TARGET_LOST: سطر ملاحظة مسمّاة لغير المطابق (MISMATCH وABSENT)
            // ثم سطر الربط يحمل الحالة. **لا رفض ولا تأخير ولا نصّ للفنّي ولا حقل في الردّ ولا verifyReport ولا reports**.
            const modelCheck = writeResult.pair.modelCheck;
            if (modelCheck !== LINK_MODEL_CHECK.MATCH) {
              console.warn(`[analyzeDevice] scanProtocol notes=${modelCheck} purpose=${protocolBuilt.document[SCAN_PROTOCOL_FIELD.SCAN_PURPOSE]}`);
            }
            console.log(`[analyzeDevice] maintenance pair linked after=${hashIdForLog(scanId)} before=${pairTarget} modelCheck=${modelCheck}`);
          } else {
            console.warn(`[analyzeDevice] scanProtocol notes=${PAIR_NOTE.LINK_TARGET_LOST}:${writeResult.pair.reason} purpose=${protocolBuilt.document[SCAN_PROTOCOL_FIELD.SCAN_PURPOSE]}`);
            console.warn(`[analyzeDevice] maintenance pair target lost reason=${writeResult.pair.reason} after=${hashIdForLog(scanId)} before=${pairTarget}`);
          }
        }
        // (S3، 2026-10-22، A3 البند ٤) فتح الزوج على «قبل الصيانة»: كُتب pair في الدفعة الذرّية نفسها (بعد نجاحها). سطر مسمّى بالمعرّف المُهشَّر ونوع العطل (قائمة مغلقة: لا قيمة حرّة ولا اسم جهاز).
        if (protocolBuilt.document[SCAN_PROTOCOL_FIELD.PAIR] !== null) {
          const openedDefectType = protocolBuilt.document[SCAN_PROTOCOL_FIELD.DEFECT_TYPE];
          console.log(`[analyzeDevice] maintenance pair opened scan=${hashIdForLog(scanId)} defectType=${openedDefectType === null ? "NONE" : openedDefectType}`);
        }

        // 8. (V8، إضافة 2026-10-09) لا خصم هنا: الفحصة حُجزت في معاملة قبل نداء النموذج وتبقى مخصومة
        // بحفظ التقرير؛ والفحص المجاني لكل جهاز سُجّل في الحجز نفسه. يُمحى القفل في finally فيزول سجلّ الحجز.

        // 9. إن كانت جلسة محل — حدّث الجلسة إلى completed (§٦-د المسار أ، S-SWEEP 2026-10-15 +03، E26): معاملة تكتب فقط إن كانت الجلسة ما زالت scanning (فلا تُطمَس cancelled ولا expired)،
        // بثلاث محاولات على فشل الكتابة (200 ثم 400 مل ث) وسطر مسمّى للفشل النهائي برمز الخطأ واسم الصنف وعدد المحاولات — لا ابتلاع صامت. كان هنا `.update` مباشر بلا شرط حالة
        // وفشله يُطبَع بـsessionId ورسالة الخطأ خامَين ولا يُعاد. القفل (scanClaims) ما زال محجوزاً هنا (يُمحى في finally) فالكنس يتخطّى الجلسة (E32). لا يرمي: الردّ لا يتغيّر.
        // deviceModel هنا من بصمة الطلب (`fingerprint.device?.model || "Unknown"`)، ومن التقرير المخزَّن في المسار ب — انظر §٦-د.
        if (isSessionScan && sessionId) {
          await completeSessionBestEffort({
            db, FieldValue: admin.firestore.FieldValue, sessionRef, path: COMPLETION_PATH.FRESH_SCAN,
            fields: {scanId: scanId, shortId: shortId, deviceModel: fingerprint.device?.model || "Unknown"},
          });
        }

        // 10. تحديث deviceProfiles — بعد حفظ التقرير (إصلاح reportRef not found:
        // الـ profile لا يُكتب إلا والتقرير الذي يشير إليه محفوظ فعلاً). غير قاتل.
        //
        // V8 قبل نشر الأمان (2026-10-09، قرار المستخدم): المفتاح يُقرأ بأيّ الشكلين (a..f في إصدار R8، أو الأسماء الكاملة) عبر مُطبِّع واحد
        // (profiles/deviceProfileKey.js). قبله كان الشرط `deviceProfileKey?.a` وحده، فنسخة ترسل الأسماء الكاملة تتخطّى هذا الكتلة كلّها صامتةً؛
        // والآن التخطّي يُسمّى في السجلّ (الشكل والسبب)، لا صمت.
        const profileKey = normalizeDeviceProfileKey(deviceProfileKey);
        if (!profileKey.usable || profileKey.key.primary === UNKNOWN_PRIMARY) {
          console.log(`[analyzeDevice] profile write skipped: ${profileKey.usable ? `primary is ${UNKNOWN_PRIMARY}` : describeDeviceProfileKey(profileKey)}`);
        } else {
          try {
            if (existingProfile) {
              await appendScanToHistory(existingProfile.profileId, scanId, aiResult, fingerprint);
              console.log(`[analyzeDevice] appended scan to profile ${existingProfile.profileId}`);
            } else {
              await createDeviceProfile(
                  deviceProfileKey, scanId, aiResult,
                  {deviceModel: fingerprint.device?.model, socModel: fingerprint.device?.cpuModel},
                  fingerprint);
              console.log(`[analyzeDevice] created profile ${profileKey.key.primary} (${describeDeviceProfileKey(profileKey)})`);
            }
          } catch (e) {
            console.error(`[analyzeDevice] profile update failed: ${failText(e)}`);
          }
        }

        // A106 (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً): "ثلاثة أسطح
        // بثلاثة مرشِّحات لا يجوز أن تبقى: قيمة الإرجاع للتطبيق → spread
        // كامل بلا تصفية، مستند reports → حقلاً حقلاً، /verify → قائمة
        // بيضاء... الإصلاح: analyzeDevice.js:480 يُرجع المبنيّ بحقول
        // مُسمّاة، لا spread." — على فرع V7 فقط (حيّ منذ التبديل، fd3a6ce).
        // فرع V6 بلا أي تغيير سلوكي — أصبح غير قابل للوصول أصلاً بعد
        // التبديل، لا مجرّد "مسار حيّ آخر لم يُلمَس" كما كان — aiResult
        // الخام كما كان دائماً في ذلك الكود الميت.
        //
        // "المصدر نفسه لا نسخة ثانية منه" (نصّ الأمر): على V7 يُعاد
        // aiResponseToSave **نفسه** — نفس الكائن الذي كُتب أعلاه تحت
        // aiResponse (سطر ~378) — لا نداء ثانٍ لـbuildV7ResponseForStorage
        // يبني نسخة موازية قد تنجرف عنها (نفس مبدأ القاعدة 24، لكن للكائن
        // كلّه لا لحقل واحد). فما يُخزَّن وما يُعاد لِـV7 يخرجان من نفس
        // الاستدعاء حرفياً — سطحان لا ثلاثة.
        //
        // ⚠️ **استثناء وحيد على "سطحان لا ثلاثة" (S6، أمر مستخدم 2026-10-01
        // +03)**: narrative.details/verdict يُحذَفان من نسخة الإرجاع أدناه
        // (stripNarrativeDetailsVerdictFromV7Response) — المخزَّن يبقى
        // كاملاً بهما. هذا يعني أن ردّ الإرجاع صار **يفترق فعلاً** عن
        // aiResponseToSave/المستند في narrative تحديداً — الجملة أعلاه
        // ("من نفس الاستدعاء حرفياً") لم تعد صحيحة 100% لهذين الحقلين
        // بالذات؛ سطحان يتطابقان في كل شيء إلا narrative.details/verdict
        // (يُعلَن الفرق في العقد — docs/V7_DISPLAY_SHAPE_CONTRACT.md
        // وv7ContractFieldMap.js — لا يُفترَض).
        //
        // حقلان يُضافان صراحةً فوق aiResponseToSave على فرع V7 — كلاهما
        // ليسا من display (buildDisplayShapeV7.js) ولا من aiResponseToSave
        // (buildV7ResponseForStorage أعلاه)، سُمّيا هنا صراحةً بدل إسقاطهما
        // صامتاً (نصّ الأمر: "إن وجدتَ حقلاً يحتاجه التطبيق وليس في display
        // فسمِّه صراحةً في التقرير ولا تُسقطه بصمت"):
        //   shortId      — معرِّف التقرير القصير (رمز QR/رابط) — ليس من
        //                  display أصلاً (نصّ الأمر: "هو ليس من display بل
        //                  يُضاف إليه")؛ يبقى مُضافاً على الفرعين كما كان.
        //   isFreeTrial  — سطر ~299 أعلاه (`aiResult.isFreeTrial =
        //                  isFreeTrial`) يُعلّق صراحةً: "التطبيق يستخدمها
        //                  لإخفاء PDF/QR — على aiResult المُعاد للعميل، لا
        //                  على ما يُكتب إلى Firestore". buildV7ResponseForStorage
        //                  لا يحمل هذا الحقل في قائمته عمداً (لا يصل
        //                  aiResponseToSave/المستند) — لكن التبديل من
        //                  `{...aiResult}` الخام إلى `{...aiResponseToSave}`
        //                  المُصفّى كان سيُسقطه صامتاً من استجابة العميل
        //                  أيضاً لولا إضافته هنا صراحةً. على فرع V6 يبقى
        //                  حاضراً كما كان دائماً — aiResult نفسه يحمله
        //                  بالفعل (مُتَّاً عليه سطر ~299، بلا شرط الفرع).
        //   aiModel      — A108 (مهمّة 2026-09-21 +03، نصّ المستخدم حرفياً):
        //                  "التطبيق يقرؤه فعلاً (AiScoringEngine.kt:305)،
        //                  وإسقاطه يكسر قارئاً قائماً. وهو من فصيلة shortId
        //                  وisFreeTrial: حقل تشغيلي لا سردي، ومكانه الإرجاع
        //                  لا audit وحده." نفس المتغيّر المزوَّد أعلاه (سطر
        //                  ~259، مصدره runAnalysisInternal.js:671
        //                  `aiModel: provider`) — يُكتب بالفعل إلى مستند
        //                  Firestore تحت مفتاح aiModel (سطر ~400 أعلاه، حقل
        //                  مستقلّ عن aiResponseToSave/aiResponse) لكنه لم يكن
        //                  يصل استجابة العميل على فرع V7 قبل هذا الإصلاح —
        //                  buildV7ResponseForStorage لا يحمله (ليس من
        //                  display ولا يفترض أن يكون). على فرع V6 لا تغيير:
        //                  aiResult هناك لا يحمل هذا الاسم أصلاً (V5/V3 تكتب
        //                  aiModelFromV5 لا aiModel — runAnalysisInternal.js:626)
        //                  وهذا خارج نطاق A108 (القيد الصريح: "فرع V6 بلا
        //                  مساس").
        //   deviceMarketingName — A112 (القرار ٤٢ البند ٥، نصّ المستخدم
        //                  حرفياً): "رصدتَ أن deviceMarketingName لا يصل
        //                  استجابة العميل على V7" — نفس فصيلة shortId/
        //                  isFreeTrial/aiModel: حقل تشغيلي، محسوب أعلاه
        //                  (سطر ~373، احتياطي rawDeviceModel — نفس صيغة
        //                  احتياطي V6 الحقيقي) ومكتوب بالفعل إلى مستند
        //                  Firestore top-level (سطر ~445) لكنه لم يكن يصل
        //                  استجابة العميل على فرع V7 قبل هذا الإصلاح —
        //                  buildV7ResponseForStorage لا يحمله (ليس من
        //                  display). على فرع V6 لا تغيير: aiResult هناك لا
        //                  يحمل هذا الاسم أصلاً (V6 لا يميِّز "تسويقي" عن
        //                  "موديل" بنفس الطريقة) — خارج نطاق A112.
        //
        // القرار ٤٢ البند ٥ (v7OperationalFields.js) — الأربعة أعلاه صارت
        // قائمة مُعلَنة ومُصدَّرة، والإرجاع يُبنى منها فعلياً (لا يُعدَّد
        // حرفياً هنا بمعزل عنها) — إضافة خامسة للقائمة بلا تحديث
        // operationalFieldValues أدناه تكتب `undefined` صريحة (تُسقَط من
        // تسلسل JSON لا ترمي)، ويحرسها اختبار انحدار (aiAuditWiring.e2e.test.js).
        {
          const operationalFieldValues = {shortId, isFreeTrial, aiModel, deviceMarketingName};
          const operationalExtras = {};
          for (const f of V7_OPERATIONAL_FIELDS) operationalExtras[f] = operationalFieldValues[f];
          return (pipeline === V7_PIPELINE_TAG) ?
              {...stripNarrativeDetailsVerdictFromV7Response(aiResponseToSave), ...operationalExtras} :
              {...aiResult, shortId: shortId};
        }
      } catch (e) {
        // V8 (حجز الرصيد): أيّ فشل قبل حفظ التقرير يُعيد الفحصة المحجوزة (والجهاز المجاني) في معاملة. بعد
        // الحفظ لا إعادة — التقرير موجود والفحصة مستهلَكة بحقّ (انظر scanReservation.js، المسار ٥).
        if (reservation && !reportSaved) {
          try {
            await releaseScanCredit({db, FieldValue: admin.firestore.FieldValue, claimRef});
          } catch (releaseErr) {
            // الإعادة نفسها فشلت: يبقى القفل بحجزه كي يكون الأثر **ظاهراً** لا ضائعاً (يُتبنّى عند إعادة الطلب).
            claimMustStay = true;
            console.error(`[analyzeDevice] reservation release FAILED scanId=${hashIdForLog(scanId)} — the claim keeps ` +
                `the reservation: ${failText(releaseErr)}`);
          }
        }
        throw e;
      } finally {
        // Best-effort claim cleanup. If this fails (e.g. function
        // timed out before reaching here), the claim auto-expires
        // after CLAIM_TTL_MS so a future retry can still succeed.
        // V8: لا يُمحى القفل إن بقي عليه حجز لم يُحرَّر (فشلت الإعادة).
        if (!claimMustStay) {
          await claimRef.delete().catch((e) => {
            console.error(`[analyzeDevice] claim cleanup failed for ${hashIdForLog(scanId)}:`,
                failText(e));
          });
        }
      }
    },
);

// مُصدَّرة للاختبار المباشر بلا محاكي (A104) — دالّة خالصة، لا اعتماد على
// db/req/res. exports.analyzeDevice نفسها onCall لا تُستدعى مباشرةً في
// اختبار وحدة عادي، فهذا هو السبيل لاختبار منطق إعادة البناء وحده.
exports.buildV7ResponseForStorage = buildV7ResponseForStorage;
exports.stripNarrativeDetailsVerdictFromV7Response = stripNarrativeDetailsVerdictFromV7Response;
// أمر مستخدم 2026-09-24 +03 (القرار ٧٥، البند ٢-أ) — نفس السبب: دالّة
// خالصة، مُصدَّرة للتوليد/الاختبار المباشر بلا محاكي.
exports.buildReportDocument = buildReportDocument;
exports.SERVER_TIMESTAMP_MARKER = SERVER_TIMESTAMP_MARKER;
