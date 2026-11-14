const crypto = require("crypto");
const {failureTextOnce, markFailureTextSanitized} = require("../utils/failureText");
const {callDeepSeek, DEEPSEEK_MODEL, DEEPSEEK_TIMEOUT_MS} =
    require("./callDeepSeek");
const {callGeminiFallback, GEMINI_MODEL, GEMINI_TIMEOUT_MS} =
    require("./callGemini");
const {SYSTEM_PROMPT_V6} = require("../prompts/systemPromptV6");
const {getSystemPromptV7} = require("../prompts/systemPromptV7");
const {resolveAiConfig} = require("../utils/resolveAiConfig");
const {hashIdForLog} = require("../utils/logRedaction");
const {
  detectEnglishLeaks,
  applyOverrides,
} = require("./languageValidator");
const {fixLeaksLocally} = require("./fixLeaksLocally");
const {checkFooterIntegrity} = require("./footerIntegrity");
const {buildV7Payload} = require("./buildV7Payload");
const {guardV7Response, V7_SHAPE_KEYS, V7_CORE_KEY_GROUPS} = require("./reportShapeV7");
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require("./pipelineTags");
// أمر مستخدم 2026-09-23 +03، القرار ٢ — Gemini على مسار V7 خلف راية
// إعدادات مُطفأة افتراضياً (منقول من الخطّة، PLAN-01-ROADMAP.md §P1.8
// القرار 3: "Gemini لا يبقى حاكماً احتياطياً — ويبقى موصولاً معطَّلاً
// براية"). V6 (callAI أدناه) **لا يقرأ هذا الإعداد إطلاقاً** — يبقى
// يستدعي Gemini احتياطياً بلا شرط كما كان دائماً (الإنتاج الحيّ اليوم،
// "قل ما يلزم فيه ولا تغيّره").
const {resolveGeminiFallbackConfig} = require("../utils/resolveGeminiFallbackConfig");

// مواصفة شكل V7 الكاملة — مصدرها الوحيد reportShapeV7.js (القرار ١، القاعدة
// 24). تُمرَّر إلى callDeepSeekWithRetry/callGeminiFallback في مسار callAIv7
// وحده؛ مسار callAI (V6) لا يمرّرها إطلاقاً فيبقى على REPORT_SHAPE_KEYS/
// CORE_KEY_GROUPS الافتراضيين في reportShape.js بلا أي تغيير سلوكي.
const V7_SHAPE_SPEC = {shapeKeys: V7_SHAPE_KEYS, coreKeyGroups: V7_CORE_KEY_GROUPS};


// ─────────────────────────────────────────────────────────────
// الميزانية الزمنية لطبقة الذكاء الاصطناعي
// ─────────────────────────────────────────────────────────────
// مهلة الدالة 300 ثانية. نحجز 35 ثانية لما بعد الاستدعاء (بناء النتيجة،
// كتابة التقرير، ملف الجهاز، مدقّق اللغة) فتبقى 265 ثانية للمزوّدين.
//
// أسوأ حالة مسموحة: DeepSeek (130) + إعادة محاولة (130) + Gemini (55) = 315
// وهي تتجاوز الميزانية — ولهذا إعادة المحاولة مشروطة بالوقت المتبقّي لا
// بعدد المحاولات وحده. إن استغرقت المحاولة الأولى وقتاً طويلاً نتخطّى
// الإعادة ونذهب إلى Gemini مباشرةً، كي لا نخسر الاحتياطي أيضاً.
const AI_TOTAL_BUDGET_MS = 265000; // مُصدَّرة أدناه — أمر مستخدم 2026-09-23 +03 (بعد القياس العشاري)، البند ١: analyzeDevice.js يشتقّ RESERVED_FOR_DOCUMENT_WRITE_MS منها لا من نسخة (القاعدة 24).

// أمر مستخدم 2026-09-23 +03، القرار ١، القاعدة 24: «"يكفي" يُشتقّ من الصيغة
// القائمة needed = DEEPSEEK_TIMEOUT_MS + GEMINI_TIMEOUT_MS ... لا من رقم
// جديد». المعنى: أسوأ حال زمني لمحاولة callAIv7/callAI واحدة كاملة
// (DeepSeek واحدة + Gemini احتياطي واحد لو فشلت). يُستهلَك داخلياً أدناه
// (retry الداخلي لِـDeepSeek، كلا المسارين v6/v7) كسقف أقصى ثابت — القيد
// الصريح "V6 لا يقرأ راية Gemini إطلاقاً" يمنع ربط هذا الموضع بالراية.
const AI_ATTEMPT_NEEDED_MS_MAX = DEEPSEEK_TIMEOUT_MS + GEMINI_TIMEOUT_MS;

// أمر مستخدم 2026-09-23 +03، البند ٦: "وقت المحاولة الثانية يُشتقّ من حالة
// راية Gemini: 130 ث حين يكون مطفأً، 185 حين يكون مشغّلاً... والراية تُقرأ
// من resolveGeminiFallbackConfig نفسها، لا بنسخة." يستهلكها resolveV7Report.js
// وحده (مسار V7، قرار المحاولة٢ الكاملة) — لا علاقة لها بمسار V6 (لا يقرأ
// هذا الإعداد إطلاقاً، ويبقى على AI_ATTEMPT_NEEDED_MS_MAX الثابت أعلاه في
// أي موضع داخلي يحتاجه).
/**
 * "يكفي" لمحاولة V7 واحدة كاملة، مشتقّة من حالة راية settings/geminiFallback
 * الحيّة وقت الاستدعاء — DeepSeek وحده إن كانت مطفأة (Gemini لن يُستدعى
 * أصلاً)، أو DeepSeek+Gemini إن كانت مشغَّلة.
 * @return {Promise<number>} المللي ثانية اللازمة لمحاولة واحدة كافية.
 */
async function resolveAiAttemptNeededMs() {
  const geminiCfg = await resolveGeminiFallbackConfig();
  return geminiCfg.enabled ? AI_ATTEMPT_NEEDED_MS_MAX : DEEPSEEK_TIMEOUT_MS;
}

/**
 * يستدعي DeepSeek مع إعادة محاولة واحدة مشروطة.
 *
 * الشرط مزدوج:
 *   1. نوع الفشل قابل للإصلاح — بتر أو محتوى فارغ أو فشل تحليل أو 5xx.
 *      مهلة أو خطأ مصادقة (4xx) لا يُعاد: الأولى تلتهم الوقت، والثانية
 *      ستفشل بالضبط كما فشلت.
 *   2. يتبقّى وقت يكفي المحاولة الثانية + Gemini بعدها.
 *
 * ملاحظة على البتر: مع temperature=0.1 الخرج شبه حتمي، فإعادة المحاولة على
 * بتر قد تعطي النتيجة نفسها. أُبقيت لأن السقف الجديد (65536) يجعل البتر
 * نادراً أصلاً، وحين يقع يكون الأرجح تذبذباً لا حداً بنيوياً.
 *
 * @param {string} userMessage رسالة المستخدم
 * @param {string} systemPrompt برومبت النظام
 * @param {string} key مفتاح DeepSeek
 * @param {number} layerStartMs بداية طبقة الذكاء الاصطناعي
 * @param {string} tag وسم السجل (v3 أو v6 أو v7)
 * @param {{shapeKeys: string[], coreKeyGroups: string[][]}} [shapeSpec]
 *   مواصفة شكل تُمرَّر إلى callDeepSeek — افتراضياً V3/V5/V6 (V7_SHAPE_SPEC
 *   من مسار callAIv7 وحده)
 * @param {{text: ?string}} [rawCapture] قناة جانبية اختيارية (القرار ٢) —
 *   تحمل نصّ آخر محاولة داخلية جُرِّبت (ناجحة أو لا)، لا الأولى بالضرورة.
 * @return {Promise<Object>} الاستجابة محلَّلة
 */
async function callDeepSeekWithRetry(userMessage, systemPrompt, key, model,
    layerStartMs, tag, shapeSpec, rawCapture) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed =
          await callDeepSeek(userMessage, systemPrompt, key, model, shapeSpec, rawCapture);
      if (attempt > 1) {
        console.log(`[${tag}][deepseek] attempt ${attempt} SUCCEEDED after a retry`);
      }
      return parsed;
    } catch (err) {
      lastErr = err;
      if (attempt === 2) break;

      const elapsed = Date.now() - layerStartMs;
      const needed = AI_ATTEMPT_NEEDED_MS_MAX;
      const timeOk = (elapsed + needed) <= AI_TOTAL_BUDGET_MS;
      const kindOk = err.retryable === true;

      if (!kindOk || !timeOk) {
        console.warn(`[${tag}][deepseek] NOT retrying — ` +
            `kind=${err.kind || "unknown"} retryable=${!!err.retryable} ` +
            `elapsed=${elapsed}ms budget_ok=${timeOk} ` +
            `(need ${needed}ms of ${AI_TOTAL_BUDGET_MS - elapsed}ms left)`);
        break;
      }

      console.warn(`[${tag}][deepseek] attempt 1 failed (kind=${err.kind}) — ` +
          `retrying once; elapsed=${elapsed}ms ` +
          `remaining=${AI_TOTAL_BUDGET_MS - elapsed}ms`);
    }
  }
  throw lastErr;
}

// ===================================================
// callAI — يبني userMessage مرة واحدة + DeepSeek primary + Gemini fallback
// ===================================================
//
// مسار واحد: V6 raw-timeseries. كان هنا تفرّع على راية اختيارية
// يوجّه إلى V3 (الافتراضي) أو V5، وحُذف في chore/remove-v3-precompute:
// صفر فحص سلك أياً منهما في ثلاثين يوماً، وخريطة قنوات V3 كانت مكتوبة
// لصيغة V2 ذات 22 قناة بينما التطبيق يرسل 11 — فسبع قنوات موصوفة خطأً.
// إبقاء مسار ميت بخريطة خاطئة كان يعني أن أي عميل لا يرسل الراية يقع
// فيه صامتاً.
//
// Why positional 7th arg instead of destructured signature: the existing
// caller `runAnalysisInternal` (NOT modified in this stage; Stage 3 wires
// it) calls callAI with 6 positional args. A destructured signature would
// require updating that file in this stage, which the rules forbid.
/**
 * ينسخ العيّنات بلا حقل ts — لنسخة الحمولة المُرسَلة وحدها.
 *
 * ts و v[0] ليسا مكرَّرين حرفياً: ts توقيت الحقبة المطلق، و v[0] هو
 * SystemClock.elapsedRealtime() أي المللي ثانية منذ الإقلاع. لكن الفرق
 * بينهما ثابت عملياً — قياس على الفحص 629485e9: أربع قيم متمايزة بمدى
 * 11 ms عبر فحص من ثماني دقائق — فـ ts دالّة تآلفية في v[0]، ومرساته
 * المطلقة موجودة أصلاً في header.startTimestamp. إسقاطه من الحمولة لا
 * يُفقد معلومة، ويوفّر 30,533 بايت من 176,278 = 17.3%.
 *
 * الإسقاط هنا فقط: الكائن الأصلي يبقى كما هو، فما يُحفَظ في Firestore
 * وما يرفعه التطبيق إلى Storage لا يتأثّران، وكذلك مسار V5/precompute
 * و lab التي تقرأ s.ts.
 *
 * @param {Array} samples العيّنات كما وصلت
 * @return {Array} نسخة بلا ts
 */
function stripSampleTs(samples) {
  const out = new Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      out[i] = s;
      continue;
    }
    const copy = {};
    for (const k of Object.keys(s)) {
      if (k !== "ts") copy[k] = s[k];
    }
    out[i] = copy;
  }
  return out;
}

async function callAI(fingerprint, language, scanContext, previousScan,
    deepseekApiKey, geminiApiKey) {
  const startTime = Date.now();
  // ────────────────────────────────────────────────────────────────
  // V6 raw-timeseries path — feat/v6-raw-timeseries.
  // Replaces V5 precompute pipeline. The model receives the full
  // fingerprint (~1500-2000 samples × 11 channels, ~150-250 KB JSON)
  // and computes all per-phase aggregates itself. No precompute,
  // no field stripping, no downsampling.
  // ────────────────────────────────────────────────────────────────
  const buildStart = Date.now();
  const ts = (fingerprint && fingerprint.timeSeries) || {};
  const rawFingerprintForAi = {
    header: ts.header || (fingerprint && fingerprint.header) || {},
    footer: ts.footer || (fingerprint && fingerprint.footer) || {},
    samples: stripSampleTs(
        ts.samples || (fingerprint && fingerprint.samples) || []),
    variables: ts.variables || (fingerprint && fingerprint.variables) || [],
    functionalResults: (fingerprint && fingerprint.functionalResults) || [],
    manualResults: (fingerprint && fingerprint.manualResults) || [],
    device: (fingerprint && fingerprint.device) || {},
    antiTamperFlags: (fingerprint && fingerprint.antiTamperFlags) || [],
    powerSaveMode: !!(fingerprint && fingerprint.powerSaveMode),
  };
  const body = {
    scanId: (scanContext && scanContext.scanId) || null,
    language: language || "ar",
    isFreeTrial: scanContext && scanContext.isFreeTrial != null ?
        scanContext.isFreeTrial : false,
    rawFingerprint: rawFingerprintForAi,
    previousScan: previousScan || null,
  };
  const userMessage = JSON.stringify(body) +
      "\n\nProduce the analysis JSON now.";
  // Renamed from `precomputeMs` to `bodyBuildMs` on 2026-09-21 (task A65,
  // base HEAD daaf006): V6 has no precompute step, and the old name misled
  // readers into thinking one still ran. This measures exactly what the
  // name says — building `body` (incl. rawFingerprintForAi) and
  // JSON.stringify(body) above, nothing else.
  // Firestore documents written BEFORE this change still carry
  // `v5Metrics.precomputeMs`; only new writes carry `v5Metrics.bodyBuildMs`.
  // Old documents were not migrated — see runAnalysisInternal.js:287.
  const bodyBuildMs = Date.now() - buildStart;

  // إصدار حقول التطبيق + فحوص التذييل الحتمية.
  //
  // fieldsVersion في السجل لأنه السؤال الذي سنحتاجه لاحقاً ولا نملك جوابه
  // اليوم: ما نسبة المسح القادم من الإصدار القديم؟ بدونها لا نعرف متى
  // يصبح حذف فروع ≤65 من البرومبت آمناً — سنحذفها بالتخمين أو لا نحذفها
  // أبداً. سطر واحد يحوّل القرار إلى رقم.
  const integrity = checkFooterIntegrity(
      rawFingerprintForAi.footer, rawFingerprintForAi.device);

  console.log(`[v6][deepseek] calling: scanId=${hashIdForLog(scanContext?.scanId)} ` +
      `fieldsVersion=${integrity.fieldsVersion === null ? "n/a" : integrity.fieldsVersion} ` +
      `payloadBytes=${userMessage.length} sampleCount=${rawFingerprintForAi.samples.length} ` +
      `buildMs=${bodyBuildMs}`);

  // بوّابة نزاهة: عند 66 فأعلى يحمل maxBatteryTemp الأقصى الحقيقي ويجب أن
  // يطابق batteryHealth.batteryTempMaxC. تباعدهما هناك يعني أن أحدهما لم
  // يُحدَّث — خلل بيانات حقيقي. وتحت 66 التباعد متوقَّع (كان حرارة النهاية)
  // فلا راية ولا ضجيج.
  if (integrity.maxBatteryTempMismatch === true) {
    console.error(`[v6][integrity] maxBatteryTemp MISMATCH scanId=${hashIdForLog(scanContext?.scanId)} ` +
        `fieldsVersion=${integrity.fieldsVersion} ` +
        `delta=${integrity.maxBatteryTempDeltaC}°C — at ${integrity.fieldsVersion} ` +
        `maxBatteryTemp must equal batteryHealth.batteryTempMaxC; one of them is stale`);
  }

  // فحصا التخزين: استحالة لا إصدار. نسبة فوق 100 ليست نسبة، ومساحة حرّة
  // تتجاوز الإجمالي مستحيلة — أياً كان fieldsVersion، وحتى لو غاب.
  if (integrity.storagePercentInvalid === true) {
    console.error(`[v6][integrity] storagePercent INVALID scanId=${hashIdForLog(scanContext?.scanId)} ` +
        `value=${rawFingerprintForAi.device?.storagePercent} ` +
        `fieldsVersion=${integrity.fieldsVersion === null ? "n/a" : integrity.fieldsVersion} ` +
        `— above 100, so it is a ≤66 write speed in MB/s, not a percentage`);
  }
  if (integrity.availableStorageGbInvalid === true) {
    console.error(`[v6][integrity] availableStorageGb INVALID ` +
        `scanId=${hashIdForLog(scanContext?.scanId)} ` +
        `free=${rawFingerprintForAi.device?.availableStorageGb} > ` +
        `total=${rawFingerprintForAi.device?.totalStorageGb} ` +
        `fieldsVersion=${integrity.fieldsVersion === null ? "n/a" : integrity.fieldsVersion} ` +
        `— free space cannot exceed capacity; the value is a ≤66 percentage`);
  }

  let parsed;
  let aiModel;
  let fixAiClient;
  let fixKey;
  let primaryError = null;

  try {
    // اسم النموذج من settings/ai، بسقوط إلى DEEPSEEK_MODEL. يُقرأ هنا
    // لا داخل callDeepSeek كي يُقرأ مرّة واحدة لكل فحص، ويُنسب إلى
    // التقرير بالقيمة نفسها التي أُرسلت حتى لو أُعيدت المحاولة.
    const aiCfg = await resolveAiConfig();
    if (aiCfg.deepseekModel !== DEEPSEEK_MODEL) {
      console.log(`[v6][aiConfig] model=${aiCfg.deepseekModel} ` +
          `source=${aiCfg.source} built_in_default=${DEEPSEEK_MODEL}`);
    }
    parsed = await callDeepSeekWithRetry(
        userMessage, SYSTEM_PROMPT_V6, deepseekApiKey,
        aiCfg.deepseekModel, startTime, "v6");
    aiModel = aiCfg.deepseekModel;
    fixAiClient = callDeepSeek;
    fixKey = deepseekApiKey;
  } catch (err) {
    // fix/ai-timeout-and-truncation: see V3 catch above for rationale.
    primaryError = failureTextOnce(err);
    // أمر مستخدم 2026-09-23 +03، القرار ٢: راية settings/geminiFallback
    // (أعلاه، مسار callAIv7 فقط) **لا تُقرأ هنا إطلاقاً** — V6 هو الإنتاج
    // الحيّ اليوم على كل فحص حقيقي، والقيد الصريح "قل ما يلزم فيه ولا
    // تغيّره": Gemini يبقى احتياطياً غير مشروط كما كان دائماً.
    console.warn(`[v6][gemini-fallback] DeepSeek failed (${primaryError}), calling Gemini`);
    try {
      parsed = await callGeminiFallback(userMessage, SYSTEM_PROMPT_V6, geminiApiKey);
      aiModel = GEMINI_MODEL;
      fixAiClient = callGeminiFallback;
      fixKey = geminiApiKey;
    } catch (geminiErr) {
      throw markFailureTextSanitized(new Error(
          `V6: Both DeepSeek and Gemini failed: ${primaryError} / ` +
          `${failureTextOnce(geminiErr)}`,
      ));
    }
  }

  // Diagnostic: log raw response shape on success path. Confirms whether
  // the AI emits reasoning_trace (V6 prompt requires it) before any
  // downstream allow-list filtering. Remove once the persistence pipe is
  // verified end-to-end on a few real scans.
  console.log(`[v6][resp] keys=${Object.keys(parsed).join(",")} ` +
      `reasoning_trace_len=${(parsed.reasoning_trace || "").length}`);

  // Language validation + targeted fix (uses same provider that succeeded).
  const leaksBefore = detectEnglishLeaks(parsed);
  const leaksBeforeFix = leaksBefore.length;
  let leaksAfterFix = leaksBeforeFix;
  let fixCallMade = false;

  if (leaksBeforeFix > 0) {
    console.log(`[v6][validator] ${leaksBeforeFix} field(s) with English leaks; applying local dictionary`);
    const fixResult = await fixLeaksLocally(null, leaksBefore, language, null);
    fixCallMade = false; // local fix never calls a model
    if (!fixResult.error && fixResult.fixes && typeof fixResult.fixes === "object") {
      applyOverrides(parsed, fixResult.fixes);
    } else if (fixResult.error) {
      console.warn(`[v6][validator] local fix issue (${fixResult.error}); leaving leaks in place`);
    }
    leaksAfterFix = detectEnglishLeaks(parsed).length;
  }

  // Runner overrides (replace prompt-placeholder values with real ones).
  parsed.shortId = "NC-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  parsed.aiModel = aiModel;

  // Phase 1.11 post-processing: fix "?" grades + critical/danger penalty.
  // Both run after AI inference and after language fix, so they operate on
  // the final user-visible payload. Deterministic; never touches diagnosis.
  const promotedCount = promoteCategoryGrades(parsed);
  const severityResult = applySeverityPenalty(parsed);

  const duration = Date.now() - startTime;
  return {
    aiAnalysis: parsed,
    aiModel,
    duration,
    pipeline: V6_PIPELINE_TAG,
    bodyBuildMs,
    footerIntegrity: integrity,
    leaksBeforeFix,
    leaksAfterFix,
    fixCallMade,
    postProcessing: {
      gradesPromoted: promotedCount,
      severityPenalty: severityResult,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Post-process: preserve AI's "?" grade (diagnostic logging only)
// ─────────────────────────────────────────────────────────────
// Historical context (V5 era): AI sometimes returned
// categoryScores.cellular.grade = "?" with pass_count=5/5, which the UI
// rendered as a fully-red bar — so this function used to promote "?" to
// A/B/C/D by pass_ratio (≥0.90 → A, … <0.55 → D).
//
// Why the promotion was wrong: when only some tests in a category run
// (e.g. GPS with location permission denied → L-02 / L-03 marked
// `not_tested`), the AI would report something like
// pass_count=1, total_count=3, grade="?" — and the old rule mapped
// 1/3 = 33% → D, punishing the user for denying a permission. That
// violates ISO 25010 / OWASP testing methodology: not_tested ≠ failed.
//
// New behavior: trust the AI's "?" verdict. The V6 system prompt is
// explicit ("Use '?' only when no test data exists"), and
// rebuildCategoryScores already excludes not_tested/unavailable from
// pass_count/total_count before the user-visible payload is built — so
// the partial-coverage signal is preserved without a guess from us.
// Kept as a diagnostic-only pass so production logs still surface
// every "?" verdict; returned count is always 0.
function promoteCategoryGrades(parsed) {
  const cs = parsed && parsed.categoryScores;
  if (!cs || typeof cs !== "object") return 0;
  for (const key of Object.keys(cs)) {
    const c = cs[key];
    if (!c || typeof c !== "object") continue;
    if (c.grade !== "?") continue;
    const pass = Number(c.pass_count) || 0;
    const total = Number(c.total_count) || 0;
    console.log(`[v6][post] preserving AI's "?" grade for ${key} ` +
        `(pass=${pass}, total=${total}) — not_tested ≠ failed`);
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────
// Post-process: penalty for critical/danger issues
//   score -= 15 * count(critical)
//   score -= 5  * count(danger)
// Floor at 0. Recompute grade from new score using systemPromptV5's
// documented thresholds (A≥85, B≥70, C≥55, else D).
// ─────────────────────────────────────────────────────────────
// Rationale: cumulative per-issue penalty (CVSS-like). One critical
// issue ≠ two critical issues. Preserves distinguishability between
// reports of different severity composition. The diagnosis is left
// intact — only the headline score/grade is adjusted to reflect the
// number and weight of red-flag findings.
function applySeverityPenalty(parsed) {
  const issues = Array.isArray(parsed && parsed.issues) ? parsed.issues : [];
  const oldScore = Number(parsed && parsed.score) || 0;
  if (issues.length === 0) {
    return {oldScore, newScore: oldScore, penalty: 0, criticals: 0, dangers: 0};
  }
  let criticals = 0;
  let dangers = 0;
  for (const issue of issues) {
    const sev = String((issue && issue.severity) || "").toLowerCase();
    if (sev === "critical") criticals++;
    else if (sev === "danger") dangers++;
  }
  const penalty = criticals * 15 + dangers * 5;
  if (penalty === 0) {
    return {oldScore, newScore: oldScore, penalty: 0, criticals, dangers};
  }
  const newScore = Math.max(0, oldScore - penalty);
  parsed.score = newScore;
  let newGrade;
  if (newScore >= 85) newGrade = "A";
  else if (newScore >= 70) newGrade = "B";
  else if (newScore >= 55) newGrade = "C";
  else newGrade = "D";
  parsed.grade = newGrade;
  console.log(`[v6][post] severity penalty: ${oldScore} -> ${newScore} ` +
      `(-${penalty}: ${criticals}c, ${dangers}d), grade -> ${newGrade}`);
  return {oldScore, newScore, penalty, criticals, dangers, newGrade};
}

// ===================================================
// callAIv7 — V7: يستدعي النموذج بحمولة Findings/الثلاثيات/الحالات (بلا
// samples) وبرومبت v7 (P1.4، PLAN-01-ROADMAP.md "P1.4 البرومبت v7")
// ===================================================
//
// ⚠️ **غير مُوصَل بمسار الإنتاج الحيّ في هذه المهمّة.** runAnalysisInternal
// ما زال يستدعي callAI (V6) — هذه الدالّة جاهزة وقابلة للاستدعاء ومُختبَرة
// (بمحاكاة callDeepSeek/callGeminiFallback، بلا نداء نموذج حقيقي فعلي)،
// لكن استبدال المسار الحيّ نفسه (analyzeDevice → كل فحص مستخدم حقيقي)
// يعني إنفاقاً فعلياً على كل فحص إنتاجي بمسار غير مُتحقَّق منه بنداء واحد
// حقيقي بعد. القيد الصريح في أمر هذه المهمّة: "نداءات النموذج تكلّف. إن
// احتجتَ نداءً حقيقياً للتحقّق — توقّف واطلب الإذن، ولا تُنفق." — لم يُطلب
// إذن، فلم يُنفَق، ولم يُبدَّل المسار الحيّ. راجع تقرير المهمّة تحت "الفرق
// بين ما أُمرت به وما فعلت".
//
// يُعيد نفس شكل callAI (V6) النَّتائجي التقريبي (aiAnalysis/aiModel/
// duration/pipeline/...) كي يبقى runAnalysisInternal قادراً على استهلاكه
// بأقلّ تعديل يوم يُقرَّر التبديل — لكن aiAnalysis هنا هو مخرَج V7 الخام
// (narrative/crossChecks/adjustments/modelObservations)، لا V6's grade/
// score/issues. pipeline المُعاد V7_PIPELINE_TAG ("v7_findings_based") —
// علامة مختلفة عمداً عن V6_PIPELINE_TAG ("v6_raw_timeseries") — كلاهما
// من pipelineTags.js الآن، لا يجوز أن يُقرأ V7 بمنطق V6 بالغلط).
//
// @param {Object} params
// @param {Object} params.findings مخرَج computeFindings (findings.js)
// @param {Object} params.categoryStates مخرَج computeCategoryStates
//   (categoryStates.js، ويحمل .testResults — راجع buildV7Payload.js)
// @param {string} params.language "ar" | "tr"
// @param {Object} params.scanContext {scanId, isFreeTrial}
// @param {Object|null} params.previousScan
// @param {string} params.deepseekApiKey
// @param {string} params.geminiApiKey
// @param {Object|null} [params.priorRejection] القرار ٢١ (PLAN-01-ROADMAP.md
//   §🔒 "٢١ · تقرير رفضه الحارس") — يُمرَّر فقط من resolveV7Report.js على
//   نداء إعادة التوليد الثاني (راجع buildV7Payload.js لتوثيق الحقل). غائب/
//   null على المحاولة الأولى العادية.
// @return {Promise<Object>} {aiAnalysis, aiModel, duration, pipeline,
//   bodyBuildMs, guard, leaksBeforeFix, leaksAfterFix}
async function callAIv7(params) {
  const p = params || {};
  const startTime = Date.now();
  const buildStart = Date.now();

  const {body, userMessage} = buildV7Payload({
    findings: p.findings,
    categoryStates: p.categoryStates,
    language: p.language || "ar",
    scanId: (p.scanContext && p.scanContext.scanId) || null,
    isFreeTrial: p.scanContext && p.scanContext.isFreeTrial != null ?
        p.scanContext.isFreeTrial : false,
    previousScan: p.previousScan || null,
    priorRejection: p.priorRejection || null,
  });
  const bodyBuildMs = Date.now() - buildStart;
  const systemPrompt = getSystemPromptV7(p.language);

  console.log(`[v7][deepseek] calling: scanId=${hashIdForLog(body.scanId)} ` +
      `payloadBytes=${userMessage.length} testResultCount=${body.testResults.length} ` +
      `buildMs=${bodyBuildMs}`);

  let parsed;
  let aiModel;
  let primaryError = null;
  // أمر مستخدم 2026-09-23 +03، القرار ٢ — قناتان جانبيتان، واحدة لكل
  // مزوّد محتمَل. ⚠️ **لا تُدمَج في aiAnalysis/guard ولا تُلمَس بعد ذلك من
  // أي كائن يصل audit/aiResultAudit — القيد الصريح: "لا تكتب الخام في أيّ
  // مستند Firestore".** rawResponseText أدناه حقل شقيق مستقلّ في القيمة
  // المُعادة، لا يقرؤه resolveV7Report إلا لبناء rawResponseLog الخاصّ به
  // (حقل شقيق آخر هناك أيضاً، خارج audit تماماً — راجع resolveV7Report.js).
  const deepseekRawCapture = {text: null};
  const geminiRawCapture = {text: null};

  try {
    const aiCfg = await resolveAiConfig();
    parsed = await callDeepSeekWithRetry(
        userMessage, systemPrompt, p.deepseekApiKey,
        aiCfg.deepseekModel, startTime, "v7", V7_SHAPE_SPEC, deepseekRawCapture);
    aiModel = aiCfg.deepseekModel;
  } catch (err) {
    primaryError = failureTextOnce(err);

    // أمر مستخدم 2026-09-23 +03، القرار ٢ — Gemini خلف راية settings/
    // geminiFallback.enabled، مطفأة افتراضياً (الغياب/404 في الإنتاج
    // اليوم = مطفأة صراحةً، لا تخمين — القاعدة 22). مسار V6 لا يمرّ من هنا
    // إطلاقاً (دالّة منفصلة تماماً، callAI أدناه).
    const geminiCfg = await resolveGeminiFallbackConfig();
    if (!geminiCfg.enabled) {
      console.warn(`[v7][gemini-fallback] DeepSeek failed (${primaryError}) — ` +
          `Gemini fallback DISABLED (settings/geminiFallback.enabled source=${geminiCfg.source}) — ` +
          `لا نداء Gemini، لا رمي (القرار ٢١: لا يُرفض التقرير كلّه أبداً)`);
      const duration = Date.now() - startTime;
      // حالة طرفية مستقلّة — resolveV7Report.js يقرأها قبل لمس guard (لا
      // guard حقيقياً هنا، لا رد وصل من أي مزوّد إطلاقاً).
      return {
        aiAnalysis: null, aiModel: null, duration, pipeline: V7_PIPELINE_TAG,
        bodyBuildMs, guard: null, rawResponseText: deepseekRawCapture.text,
        // أمر مستخدم 2026-09-23 +03، القرار ٤ — "لكل محاولة: ... والمزوّد."
        // deepseekRawCapture.text قد يكون null (DeepSeek لم يُعِد شيئاً
        // إطلاقاً، مهلة/خطأ شبكة) — عندها لا مزوّد أنتج نصّاً أصلاً.
        rawResponseProvider: deepseekRawCapture.text !== null ? 'deepseek' : null,
        providerFailedNoFallback: true, primaryError,
      };
    }

    console.warn(`[v7][gemini-fallback] DeepSeek failed (${primaryError}), Gemini fallback ENABLED (source=${geminiCfg.source}) — calling Gemini`);
    try {
      parsed = await callGeminiFallback(userMessage, systemPrompt, p.geminiApiKey, V7_SHAPE_SPEC, geminiRawCapture);
      aiModel = GEMINI_MODEL;
    } catch (geminiErr) {
      throw markFailureTextSanitized(new Error(
          `V7: Both DeepSeek and Gemini failed: ${primaryError} / ` +
          `${failureTextOnce(geminiErr)}`,
      ));
    }
  }
  // آخر ما وصل فعلياً وحدَّد parsed — Gemini إن سقط إليه، وإلا DeepSeek.
  const rawResponseText = geminiRawCapture.text !== null ? geminiRawCapture.text : deepseekRawCapture.text;
  // أمر مستخدم 2026-09-23 +03، القرار ٤ — "والمزوّد" لكل محاولة.
  const rawResponseProvider = geminiRawCapture.text !== null ? 'gemini' : (deepseekRawCapture.text !== null ? 'deepseek' : null);

  // الحارس الكامل — شكل + معرّفات أعطال حقيقية + مطابقة أرقام + لغة
  // (reportShapeV7.js). لا إصلاح آلي هنا بعد (لا حلقة "أعد توليد الحقل
  // المرفوض فقط" — ذلك امتداد مستقبلي؛ راجع تقرير المهمّة). المستدعي
  // يقرّر مصير guard.ok=false (رفض كامل، تسجيل، أو نداء تصحيح لاحق).
  // أمر مستخدم 2026-10-01 +03 ("الحمولة لا تحمل قيم ما ليس معايَراً") —
  // **تصحيح حرج**: كانت هذه السطر تمرّر p.findings/p.categoryStates
  // الأصليَّين (غير المُنقَّيين) لا body.findings/body.categoryStates
  // (المُرسَلين فعلاً للنموذج، من buildV7Payload أعلاه) — فحارس الأرقام
  // كان سيقبل رقماً هلوسه النموذج (مثل سعة بطارية خام لم تصله) بوصفه
  // "مُسنَداً"، لمجرّد وجوده في البيانات الأصلية، رغم أنه **غاب عن الحمولة
  // فعلياً** بعد هذا التصحيح. النصّ الصريح: "فإن ظهر [رقم من مسار مُحذوف]،
  // فمصدره ليس الحمولة" — أي يجب أن يُرفَض. body.findings/body.categoryStates
  // (بعد sanitizeFindingsForModelPayload/redactUncalibratedBatteryIndicators
  // ForModelPayload) هما المرجع الصحيح الآن — يطابقان ما رآه النموذج حرفياً.
  //
  // ⚠️ **انكشف بالتشغيل أثناء هذا التصحيح نفسه (القاعدة 40، لا تخمين)**:
  // body.categoryStates = {categories, overall, issues} فقط (بناء
  // buildV7Payload.js) — بلا testResults. وcollectDeviceReference/
  // collectReferenceNumbers (reportShapeV7.js) يقرآن categoryStates.testResults
  // مباشرة: الأولى لأرقام هوية الجهاز من عناصر STATE/SPEC غير المقيسة
  // (مثل C-05 raw.rawValue="exynos9820 / exynos9820")، والثانية بالمشي
  // العميق على testResults كلّه. تمرير body.categoryStates وحده كان
  // سيُسقط هذا المرجع بالكامل — فيُرفض رقم هوية جهاز حقيقي بريء (9820)
  // لا علاقة له بالإخفاء، لا رقماً مخفياً عمداً. مُتحقَّق بتشغيل مباشر:
  // callDeepSeekV7ShapeE2E.test.js سيناريو ١ (34dff2b8) كشفه (9820 صار
  // "غير مطابق" في unmatchedFields). الإصلاح: دمج testResults **المُنقّاة
  // فعلاً** (body.testResults — بعد sanitizeTestResultsForModelPayload،
  // فتبقى قيم THERMAL_UNCALIBRATED_IDS/UNCALIBRATED_THRESHOLD_IDS مخفيّة)
  // تحت مفتاح categoryStates.testResults لهذا المرجع وحده — لا تغيير على
  // body نفسها (الحمولة المُرسَلة فعلاً للنموذج بلا تعديل، هذا الكائن محلّي
  // لحساب المرجع فقط).
  const categoryStatesForGuard = body.categoryStates ?
      Object.assign({}, body.categoryStates, {testResults: body.testResults}) : body.categoryStates;
  const guard = guardV7Response(parsed, {findings: body.findings, categoryStates: categoryStatesForGuard});
  if (!guard.ok) {
    console.error(`[v7][guard] REJECTED — shape=${guard.shape.ok} issueKeys=${guard.issueKeys.ok} ` +
        `numbers=${guard.numbers.ok} languageLeaks=${guard.languageLeaks.length} ` +
        `errors=${JSON.stringify(guard.shape.errors)}`);
  }

  const duration = Date.now() - startTime;
  return {
    aiAnalysis: parsed,
    aiModel,
    duration,
    pipeline: V7_PIPELINE_TAG,
    bodyBuildMs,
    guard,
    // القرار ٢ — حقل شقيق مستقلّ عن aiAnalysis/guard عمداً. **ممنوع** أن
    // يُدمَج هذا الحقل داخل aiAnalysis أو أن يقرأه أي شيء يبني aiResultAudit/
    // aiAudit المكتوب إلى Firestore (analyzeDevice.js) — راجع تقرير المهمّة
    // قسم "لا تكتب الخام في مستند".
    rawResponseText,
    rawResponseProvider,
  };
}

module.exports = {
  callAI, promoteCategoryGrades, applySeverityPenalty,
  callAIv7,
  resolveAiAttemptNeededMs,
  AI_ATTEMPT_NEEDED_MS_MAX,
  AI_TOTAL_BUDGET_MS,
};
