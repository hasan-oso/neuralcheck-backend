// ===================================================
// resolveV7Report — سياسة رفض الحارس (القرار ٢١، PLAN-01-ROADMAP.md
// §🔒 "٢١ · تقرير رفضه الحارس — لا يُرفض كلّه أبداً")
// ===================================================
//
// نصّ القرار حرفياً:
//   ١. يُعاد توليده مرّة واحدة — النموذج يُعطى قائمة ما رُفض
//   ٢. إن رفض الحارس الثانية أيضاً:
//        • الجزء الحتمي يُعرض كاملاً (الحروف · التغطية · البوّابات · الأعطال)
//        • الحقول المرفوضة تُحذف من display ولا تُعرض
//        • يُوسَم narrativeIncomplete: true مع قائمة ما حُذف
//   ٣. لا يُرفض التقرير كلّه أبداً
//
// هذا الملف هو "طبقة الاستدعاء الأعلى" التي أشار إليها buildDisplayShapeV7.js
// صراحةً بأنها لا تفحص guard.ok بنفسها ("سياسة قبول/رفض تخصّ طبقة أعلى —
// راجع buildDisplayShapeV7.js وتقرير المهمّة") — هذا هو ذلك المكان.
//
// ⚠️ **غير مُوصَل بمسار الإنتاج الحيّ.** لا شيء هنا يستدعي هذا الملف من
// runAnalysisInternal.js — القيد الصريح في أمر هذه المهمّة: "لا تُبدّل
// runAnalysisInternal.js:292" (التبديل من callAI إلى callAIv7 يأتي لاحقاً،
// بعد معايرة الحارس وإعادة النداءين — القرار ١٧). و"إعادة التوليد نداء
// نموذج — ولا تُنفّذه الآن" — لذلك هذا الملف **مبنيّ ومُختبَر بمحاكاة كاملة
// (كعوب على callDeepSeek/callGemini، صفر نداء نموذج حقيقي)، غير مُختبَر
// بنداء حيّ بعد.**
//
// ─── حدود التصميم — افتراضات مُوثَّقة (القاعدة 13) ────────────────────────
//
// (أ) "الرموز" (tokens) في سجلّ كلفة الجولة: **غير متاح فعلياً اليوم.**
//     callDeepSeek.js/callGemini.js يحسبان completion_tokens/candidatesTokenCount
//     داخلياً (متغيّر `meta` محلّي) لكن **لا يُعيدانه للمستدعي** — الدالّتان
//     تُعيدان كائن التقرير المُحلَّل وحده (ensureReportShape يُعيد r.report).
//     تعديل ذلك يتطلّب تغيير شكل الإرجاع في ملفّين يخدمان مسار الإنتاج
//     الحيّ V6 أيضاً (callDeepSeekWithRetry، callAI الحيّة) — خارج نطاق
//     مهمّة "ابنِ ولا تُنفق" هذه. `tokensUsed` أدناه **null** دائماً مع
//     تعليق يشرح السبب، لا رقم مُختلَق (القاعدة 5). المدّة (`durationMs`)
//     مُقاسة فعلياً (Date.now() الحقيقي حتى في نداء مُحاكى) فتبقى.
//
// (ب) نطاق "الحقول المرفوضة تُحذف من display": crossChecks/adjustments/
//     modelObservations **لا تصل display أصلاً** في أي حال — buildDisplayShapeV7.js
//     يضعها في audit حصراً (القرار ٤/٦). فلا معنى لحذفها من display لأنها
//     لم تكن فيه. النطاق الفعلي لهذا الحذف: narrative.summary/details/
//     verdict/buyerAdvice/issueDescriptions[id] — الحقول الوحيدة من مخرَج
//     النموذج التي تصل display فعلاً (مباشرة أو عبر issues[].description).
//     رفض الحارس لحقل في crossChecks/adjustments/modelObservations لا يرفع
//     narrativeIncomplete — يُسجَّل في audit.regeneration كسبب رفض، ويبقى
//     محتوى تلك المصفوفات في audit كما وصل (القرار ٤: "تُحفَظ ولا تُعرض" —
//     حتى المرفوض منها دليل مفيد للمراجع).
//
// (ج) نداء إعادة التوليد الثاني الذي يفشل فشلاً صلباً (كلا المزوّدَين معاً)
//     لا يُسقط الدالّة — يُلتَقط، ويُبنى العرض من مخرَج المحاولة الأولى
//     مع حذف ما رفضه حارسها هي (القرار ٣: لا يُرفض التقرير كلّه أبداً).
//     فشل صلب في **المحاولة الأولى نفسها** (كلا المزوّدَين فشلا قبل أن
//     يُنتَج أي مخرَج على الإطلاق) يبقى خارج نطاق هذه السياسة — ذلك فشل
//     شبكة/مزوّد لا رفض حارس، وله مساره الحالي في runAnalysisInternal.js
//     (aiFailed:true → analyzeDevice يرفض الطلب بلا خصم ولا حفظ). هذه
//     الدالّة تُفشل بنفس الطريقة (ترمي) في تلك الحالة تحديداً — نفس تعاقد
//     callAIv7 (راجع callAIv7.test.js تحقّق 3).
// ===================================================

'use strict';

const {callAIv7, resolveAiAttemptNeededMs} = require('./callAI');
const {failureTextOnce} = require("../utils/failureText");
const {buildDisplayShapeV7} = require('./buildDisplayShapeV7');
// A122 (أمر مستخدم 2026-09-23 +03، بعد القياس العشاري) — نفس المصدر الذي
// يستهلكه runAnalysisInternal.js:22 للفرع الآخر (القاعدة 24) — لا نسخة.
const {applyV7Adjustments} = require('./buildV7Payload');
const {BUYER_ADVICE_PROFILES} = require('./reportShapeV7');

// تحديث القرار ٢٤ (PLAN-01-ROADMAP.md §🔒 "٢٤ · buyerAdvice يعود ثلاثة
// حقول"، مهمّة verifyReport V7 2026-09-21 +03): narrative.buyerAdvice صار
// كائناً بثلاثة ملفّات (casual/gamer/photographer) لا نصّاً واحداً —
// reportShapeV7.js يُنتج الآن مسارات رفض مُفصَّلة narrative.buyerAdvice.<profile>
// (numbers.unmatchedFields[].field أو languageLeaks[].path) بدل المسار
// المفرد narrative.buyerAdvice القديم. القائمة أدناه تعكس هذا — سبعة
// مسارات ورقة (leaf) بدل خمسة؛ كانت ستُخالف النصّ لو بقيت كما هي (ملفّ
// مرفوض واحد ما كان سيُطابَق أي مسار في القائمة القديمة فيبقى "غير مُسقَط"
// خطأً — نفس نمط الصمت الذي تمنعه القاعدة 22).
const NARRATIVE_LEAF_FIELDS = Object.freeze([
  'narrative.summary', 'narrative.details', 'narrative.verdict',
  ...BUYER_ADVICE_PROFILES.map((p) => `narrative.buyerAdvice.${p}`),
  'narrative.issueDescriptions',
]);

/**
 * يبني قائمة نصّية مقروءة لما رفضه الحارس — تُستهلَك مرّتين: (أ) تُغذّى
 * لنداء إعادة التوليد عبر priorRejection (buildV7Payload.js) كي "يُعطى
 * النموذج قائمة ما رُفض" (نصّ القرار ٢١ حرفياً)، و(ب) تُسجَّل في
 * audit.regeneration.rounds[].rejectedReasons — كلاهما من نفس المصدر
 * الحقيقي (guard)، لا نصّ مختلَق.
 * @param {Object} guard مخرَج guardV7Response (reportShapeV7.js)
 * @return {string[]} أسباب مُسمّاة، فارغة إن guard.ok
 */
function describeGuardRejection(guard) {
  if (!guard || guard.ok) return [];
  const out = [];
  if (!guard.shape.ok) {
    for (const err of guard.shape.errors) out.push(`SHAPE:${err}`);
  }
  if (!guard.issueKeys.ok) {
    out.push(`ISSUE_KEYS:invented=[${guard.issueKeys.inventedIds.join(',')}]`);
  }
  if (!guard.numbers.ok) {
    for (const u of guard.numbers.unmatchedFields) {
      out.push(`NUMBERS:${u.field}=[${u.numbers.join(',')}]`);
    }
  }
  for (const l of (guard.languageLeaks || [])) {
    out.push(`LANGUAGE:${l.path}=[${l.tokens.join(',')}]`);
  }
  return out;
}

/**
 * يحوّل مخرَج الحارس إلى مجموعة "مسارات حقول مرفوضة" — نفس تسمية المسارات
 * التي يستعملها reportShapeV7.js نفسه في numbers.unmatchedFields[].field
 * وlanguageLeaks[].path (narrative.summary، narrative.issueDescriptions[id]،
 * crossChecks[i].description، adjustments[i].reason، modelObservations[i].text)
 * — لا قاموس مسارات ثانٍ. فشل بنيوي (shape) أعمّ من حقل مفرد فيُترجَم إلى
 * اسم القسم كلّه ('narrative' | 'crossChecks' | 'adjustments' |
 * 'modelObservations') — لا ثقة بأي حقل داخل قسم شكله غير صالح أصلاً.
 * ROOT_NOT_OBJECT أو أي مفتاح ممنوع (FORBIDDEN_KEY_*) يعني أن المخرَج
 * بأكمله غير موثوق فتُدرَج الأقسام الأربعة كلّها.
 * @param {Object} guard مخرَج guardV7Response
 * @return {Set<string>} مسارات/أقسام مرفوضة
 */
function collectRejectedPaths(guard) {
  const paths = new Set();
  if (!guard || guard.ok) return paths;

  if (!guard.numbers.ok) {
    for (const u of guard.numbers.unmatchedFields) paths.add(u.field);
  }
  for (const l of (guard.languageLeaks || [])) paths.add(l.path);
  if (!guard.issueKeys.ok) paths.add('narrative.issueDescriptions');

  if (!guard.shape.ok) {
    for (const err of guard.shape.errors) {
      if (err.startsWith('NARRATIVE_') || err.startsWith('ISSUE_DESCRIPTION')) {
        paths.add('narrative');
      } else if (err.startsWith('CROSS_CHECK')) {
        paths.add('crossChecks');
      } else if (err.startsWith('ADJUSTMENT')) {
        paths.add('adjustments');
      } else if (err.startsWith('MODEL_OBSERVATION')) {
        paths.add('modelObservations');
      } else {
        // ROOT_NOT_OBJECT / FORBIDDEN_KEY_* — لا ثقة بأي قسم
        paths.add('narrative'); paths.add('crossChecks');
        paths.add('adjustments'); paths.add('modelObservations');
      }
    }
  }
  return paths;
}

/**
 * يبني narrative نظيفاً لِـdisplay فقط — يُسقِط الحقول المرفوضة تحديداً
 * (أو narrative كلّها إن فشل شكلها بنيوياً)، ويُبقي كل ما لم يُرفض كما هو.
 * لا يمسّ crossChecks/adjustments/modelObservations — تلك لا تصل display
 * أصلاً (راجع تعليق رأس الملف، البند ب) فلا حاجة لتنقيتها هنا.
 * @param {Object} aiAnalysis مخرَج النموذج الخام (المحاولة الأخيرة)
 * @param {Set<string>} rejectedPaths مسارات مرفوضة (collectRejectedPaths)
 * @return {Object} narrative جاهز للتمرير إلى buildDisplayShapeV7
 */
function sanitizeNarrativeForDisplay(aiAnalysis, rejectedPaths) {
  const src = (aiAnalysis && typeof aiAnalysis === 'object' && !Array.isArray(aiAnalysis)) ?
      aiAnalysis : {};
  const srcNar = (src.narrative && typeof src.narrative === 'object' && !Array.isArray(src.narrative)) ?
      src.narrative : {};

  if (rejectedPaths.has('narrative')) return {}; // buildDisplayShapeV7 يتعامل مع الغياب بأمان (مُختبَر)

  const narrative = {};
  for (const f of ['summary', 'details', 'verdict']) {
    if (!rejectedPaths.has(`narrative.${f}`) && typeof srcNar[f] === 'string') {
      narrative[f] = srcNar[f];
    }
  }
  // القرار ٢٤ — buyerAdvice كائن؛ كلّ ملفّ (casual/gamer/photographer)
  // يُحذَف على حدة إن رُفض مساره تحديداً، لا الحقل كلّه دفعة واحدة. ملفّ
  // مرفوض واحد لا يُسقط الملفّين الآخرين السليمين (نفس مبدأ summary/details/
  // verdict أعلاه — الحذف بدقّة الحقل المرفوض فقط).
  if (srcNar.buyerAdvice && typeof srcNar.buyerAdvice === 'object' && !Array.isArray(srcNar.buyerAdvice)) {
    const keptAdvice = {};
    let anyProfileKept = false;
    for (const profile of BUYER_ADVICE_PROFILES) {
      if (!rejectedPaths.has(`narrative.buyerAdvice.${profile}`) &&
          typeof srcNar.buyerAdvice[profile] === 'string') {
        keptAdvice[profile] = srcNar.buyerAdvice[profile];
        anyProfileKept = true;
      }
    }
    if (anyProfileKept) narrative.buyerAdvice = keptAdvice;
  }
  if (!rejectedPaths.has('narrative.issueDescriptions') &&
      srcNar.issueDescriptions && typeof srcNar.issueDescriptions === 'object' &&
      !Array.isArray(srcNar.issueDescriptions)) {
    const kept = {};
    for (const [id, text] of Object.entries(srcNar.issueDescriptions)) {
      if (!rejectedPaths.has(`narrative.issueDescriptions[${id}]`) && typeof text === 'string') {
        kept[id] = text;
      }
    }
    narrative.issueDescriptions = kept;
  }
  return narrative;
}

/**
 * القرار ١١/§ب أعلاه: قائمة "ما حُذف" المعروضة للمستهلك تقتصر على حقول
 * display الفعلية (narrative.* فقط) — لا تذكر crossChecks/adjustments/
 * modelObservations (لم تكن في display أصلاً، راجع تعليق الرأس البند ب).
 * 'narrative' المفردة (قسم كامل سقط بنيوياً) تُوسَّع إلى الحقول الخمسة
 * الفعلية كي تبقى القائمة قابلة للقراءة والفعل من طرف المستهلك.
 * @param {Set<string>} rejectedPaths مخرَج collectRejectedPaths (المحاولة الأخيرة)
 * @return {string[]} أسماء حقول display المحذوفة فعلياً، مُرتَّبة
 */
function expandDroppedDisplayFields(rejectedPaths) {
  if (rejectedPaths.has('narrative')) return NARRATIVE_LEAF_FIELDS.slice();
  return Array.from(rejectedPaths)
      .filter((p) => p === 'narrative' || p.startsWith('narrative.'))
      .sort();
}

/**
 * سجلّ جولة واحدة لِـaudit.regeneration.rounds — القرار ٢١: "تُسجَّل محاولة
 * إعادة التوليد وكلفتها في audit — الرموز والمدّة وما رُفض في كل جولة".
 * @param {number} attempt رقم المحاولة (١ أو ٢)
 * @param {Object} callResult مخرَج callAIv7 لهذه المحاولة
 * @return {Object} سجلّ الجولة
 */
function buildRoundLog(attempt, callResult) {
  return {
    attempt,
    aiModel: callResult.aiModel || null,
    guardOk: !!(callResult.guard && callResult.guard.ok),
    durationMs: typeof callResult.duration === 'number' ? callResult.duration : null,
    // غير متاح — راجع تعليق رأس الملف، البند (أ). لا رقم مُختلَق (القاعدة 5).
    tokensUsed: null,
    rejectedReasons: describeGuardRejection(callResult.guard),
  };
}

// أمر مستخدم 2026-09-23 +03، القرار ٢ — لا رد وصل من أي مزوّد إطلاقاً (لا
// شكل جزئي كما في رفض الحارس)، فالأقسام الأربعة كلّها غير موثوقة دفعة
// واحدة — نفس معاملة ROOT_NOT_OBJECT في collectRejectedPaths أعلاه، لكن
// هنا لا guard حقيقياً لنشتقّها منه (guard=null).
const PROVIDER_FAILED_REJECTED_PATHS = Object.freeze(['narrative', 'crossChecks', 'adjustments', 'modelObservations']);

/**
 * يبني {round, rejectedPaths, finalAttempt} لحالة callAIv7 التي أعادت
 * providerFailedNoFallback:true (DeepSeek فشل، Gemini مُعطَّل — لا رمي، لا
 * guard حقيقي). مُستخرَجة دالّةً مستقلّة لأنها تُستهلَك من موضعين (محاولة١
 * ومحاولة٢) بنفس المنطق بالضبط — نسخة واحدة لا نسختان قد تنجرفان (نفس
 * العطب الذي وقع فعلياً أثناء بناء هذا: collectRejectedPaths(null) تُعيد
 * مجموعة فارغة صامتة [`if (!guard) return paths;`]، فلو اعتُمد ذلك
 * الطريق هنا لظهر narrativeIncomplete=false خطأً رغم غياب السرد بالكامل).
 * @param {number} attemptNum رقم المحاولة (١ أو ٢)
 * @param {Object} attemptResult مخرَج callAIv7 (providerFailedNoFallback:true)
 * @return {{round: Object, rejectedPaths: Set<string>, finalAttempt: Object}}
 */
function buildProviderFailedOutcome(attemptNum, attemptResult) {
  const round = {
    attempt: attemptNum, aiModel: null, guardOk: false,
    durationMs: typeof attemptResult.duration === 'number' ? attemptResult.duration : null,
    tokensUsed: null,
    // سبب مُسمّى مستقلّ عن رفض الحارس وعن TIME_BUDGET_EXHAUSTED (القاعدة ٢١).
    rejectedReasons: [`PROVIDER_FAILED_NO_FALLBACK: ${attemptResult.primaryError}`],
  };
  const finalAttempt = {
    aiAnalysis: null, aiModel: null, duration: attemptResult.duration, pipeline: attemptResult.pipeline,
    bodyBuildMs: attemptResult.bodyBuildMs,
    // guard فارغ آمن بنفس شكل guardV7Response الحقيقي — لا null يكسر أي
    // قارئ لاحق (finalAttempt.guard تصل guardFinal في القيمة المُعادة).
    guard: {
      ok: false, shape: {ok: false, errors: ['PROVIDER_FAILED_NO_FALLBACK']},
      issueKeys: {ok: true, inventedIds: []}, numbers: {ok: true, unmatchedFields: [], excludedDevice: []},
      languageLeaks: [], excluded: {deviceSpecNumbers: [], languageTokens: []},
    },
  };
  return {round, rejectedPaths: new Set(PROVIDER_FAILED_REJECTED_PATHS), finalAttempt};
}

/**
 * نقطة الدخول — تُنفّذ القرار ٢١ كاملاً: محاولة أولى، فإعادة توليد واحدة
 * عند الرفض (بقائمة ما رُفض)، فبناء عرض جزئي عند الرفض الثاني — لا رفض
 * كامل للتقرير أبداً.
 *
 * @param {Object} params نفس مُدخلات callAIv7 (findings/categoryStates/
 *   language/scanContext/previousScan/deepseekApiKey/geminiApiKey)
 * @return {Promise<Object>} {display, audit, aiModel, duration, pipeline,
 *   bodyBuildMs, guardFinal}
 *   duration = مجموع مدد كل الجولات الفعلية (لا مدّة جولة واحدة فقط —
 *   القرار ٢١ يعتبر إعادة التوليد جزءاً من كلفة الفحص الحقيقية).
 * @throws {Error} فقط إن فشلت المحاولة الأولى فشلاً صلباً (كلا المزوّدَين) —
 *   راجع تعليق رأس الملف، البند (ج). لا رمي بعد ذلك مهما رفض الحارس.
 */
async function resolveV7Report(params) {
  const p = params || {};
  const rounds = [];
  // أمر مستخدم 2026-09-23 +03، القرار ٢ — سجلّ خام مستقلّ تماماً عن audit
  // (لا rounds[] أعلاه، لا audit.regeneration). **لا يُقرأ من runAnalysisInternal.js
  // ولا من analyzeDevice.js اليوم — يبقى في الذاكرة، يقرؤه فقط من يستدعي
  // resolveV7Report مباشرة (سكربت القياس)،** وهذا عمداً: القيد الصريح
  // "لا تكتب الخام في أيّ مستند Firestore" يعني ألّا يمرّ هذا الحقل بأي
  // طريق نحو aiResultAudit/aiAudit. راجع test/rawResponseCapture.test.js
  // للإثبات أن audit المُعاد لا يحمل هذا النصّ إطلاقاً بأي شكل.
  const rawResponseLog = [];

  // محاولة ١ — قد ترمي (فشل صلب لكلا المزوّدَين، Gemini مُفعَّل وفشل أيضاً).
  // لا نلتقطها هنا: تلك حالة خارج نطاق "رفض الحارس" (راجع تعليق الرأس،
  // البند ج) ويجب أن تصل المستدعي كما يتوقّع (نفس تعاقد callAIv7 الحالي).
  //
  // أمر مستخدم 2026-09-23 +03، القرار ٢: حين Gemini مُعطَّل (الحالة
  // الافتراضية) وفشل DeepSeek، callAIv7 **لا ترمي** — تُعيد
  // providerFailedNoFallback:true بلا guard إطلاقاً (لا ردّ وصل من أي
  // مزوّد). يُفحَص هذا **قبل** لمس attempt1.guard (كان سيرمي على null.ok).
  const attempt1 = await callAIv7(p);
  rawResponseLog.push({attempt: 1, rawResponseText: attempt1.rawResponseText || null, rawResponseProvider: attempt1.rawResponseProvider || null, durationMs: attempt1.duration});

  let finalAttempt = attempt1;
  let rejectedPaths = new Set();

  if (attempt1.providerFailedNoFallback) {
    console.warn(`[v7][provider-failed] DeepSeek failed, Gemini fallback disabled — ` +
        `building deterministic-only display (narrative absent), no throw: ${attempt1.primaryError}`);
    const outcome = buildProviderFailedOutcome(1, attempt1);
    rounds.push(outcome.round);
    rejectedPaths = outcome.rejectedPaths;
    finalAttempt = outcome.finalAttempt;
  } else if (!attempt1.guard.ok) {
    rounds.push(buildRoundLog(1, attempt1));
    const rejection1 = collectRejectedPaths(attempt1.guard);
    let attempt2 = null;

    // أمر مستخدم 2026-09-23 +03، القرار ١: "resolveV7Report يفحص الوقت
    // المتبقّي قبل المحاولة الثانية، وإن لم يكفِ يعرض النتيجة جزئية...
    // العرض الجزئي أفضل من لا شيء — وهو القرار ٢١ نفسه." p.deadline موعد
    // نهائي مطلق (epoch ms) من المستدعي (analyzeDevice.js، بدءاً من بدء
    // الدالّة لا بدء هذه الدالّة). غيابه (مستدعٍ لا يمرّره، كـ
    // runConsistencyTest.js أو استدعاء مباشر في اختبار) يعني "بلا سقف" —
    // نفس سلوك ما قبل هذا القرار حرفياً، لا تغيير افتراضي.
    const remainingMs = typeof p.deadline === 'number' ? (p.deadline - Date.now()) : Infinity;
    // أمر مستخدم 2026-09-23 +03، البند ٦: الحاجة تُشتقّ من حالة راية Gemini
    // الحيّة وقت القرار (resolveGeminiFallbackConfig نفسها عبر callAI.js —
    // لا نسخة)، لا من مجموع ثابت مسبَق.
    const aiAttemptNeededMs = await resolveAiAttemptNeededMs();
    const timeBudgetOk = remainingMs >= aiAttemptNeededMs;

    if (!timeBudgetOk) {
      console.warn(`[v7][time-budget] SKIPPING regeneration (attempt 2) — ` +
          `remaining=${remainingMs}ms needed=${aiAttemptNeededMs}ms — عرض جزئي بدل الانتظار`);
      rounds.push({
        attempt: 2, aiModel: null, guardOk: false, durationMs: null, tokensUsed: null,
        // سبب مُسمّى مستقلّ عن رفض الحارس (القاعدة 21 — لا يُخلَط بـ"الحارس
        // رفض المحتوى"؛ هذا "لم نحاول أصلاً لضيق الوقت").
        rejectedReasons: [`TIME_BUDGET_EXHAUSTED: تبقّى ${remainingMs}ms، يلزم ${aiAttemptNeededMs}ms على الأقلّ`],
      });
      rejectedPaths = rejection1;
      // finalAttempt يبقى attempt1 — لا نداء ثانٍ يُصدَر إطلاقاً (fetch=0
      // إضافي). السقوط إلى الذيل المشترك أدناه (بلا try/catch محاولة٢) هو
      // "العرض الجزئي" نفسه — الحرف/التغطية/البوّابات لا تُبنى من
      // aiAnalysisForDisplay إطلاقاً (راجع buildDisplayShapeV7.js) فتبقى كاملة.
    } else {
      try {
        attempt2 = await callAIv7(Object.assign({}, p, {
          priorRejection: {
            attempt: 1,
            rejectedReasons: describeGuardRejection(attempt1.guard),
          },
        }));
      } catch (e) {
        // القرار ٣ — فشل صلب في نداء إعادة التوليد لا يُسقط التقرير. نُبقي
        // مخرَج المحاولة الأولى ونحذف عنه ما رفضه حارسها هي فقط. الجولة
        // تُسجَّل رغم فشلها الصلب — "تُسجَّل محاولة إعادة التوليد" لا تعني
        // "فقط إن نجحت"، وإلا اختفت الكلفة الحقيقية (نداء مزوّدَين كاملَين)
        // من audit بصمت.
        console.error(`[v7][guard-policy] regeneration call (attempt 2) threw — ` +
            `falling back to attempt 1's guard-rejected content, partial display: ${failureTextOnce(e)}`);
        rounds.push({
          attempt: 2, aiModel: null, guardOk: false, durationMs: null, tokensUsed: null,
          rejectedReasons: [`HARD_FAILURE:${failureTextOnce(e)}`],
        });
      }

      if (attempt2) {
        rawResponseLog.push({attempt: 2, rawResponseText: attempt2.rawResponseText || null, rawResponseProvider: attempt2.rawResponseProvider || null, durationMs: attempt2.duration});
        if (attempt2.providerFailedNoFallback) {
          // نفس حالة المحاولة١ — DeepSeek فشل مرّة أخرى، Gemini مُعطَّل، لا
          // guard حقيقي. collectRejectedPaths(null) كانت ستُعيد مجموعة
          // فارغة صامتة هنا (عطب حقيقي وقع أثناء البناء — راجع تعليق
          // buildProviderFailedOutcome)، فتُستهلَك نفس الدالّة الموحَّدة بدلها.
          console.warn(`[v7][provider-failed] regeneration (attempt 2) — DeepSeek failed again, ` +
              `Gemini fallback disabled — building deterministic-only display, no throw: ${attempt2.primaryError}`);
          const outcome = buildProviderFailedOutcome(2, attempt2);
          rounds.push(outcome.round);
          rejectedPaths = outcome.rejectedPaths;
          finalAttempt = outcome.finalAttempt;
        } else {
          rounds.push(buildRoundLog(2, attempt2));
          finalAttempt = attempt2;
          rejectedPaths = attempt2.guard.ok ? new Set() : collectRejectedPaths(attempt2.guard);
        }
      } else {
        rejectedPaths = rejection1;
      }
    }
  } else {
    // guard.ok === true من المحاولة الأولى — النجاح المباشر. جولة١ لم
    // تُسجَّل بعد في أيّ من الفرعين أعلاه (كلاهما فرع رفض/فشل)، فتُسجَّل هنا.
    rounds.push(buildRoundLog(1, attempt1));
  }

  const aiAnalysisForDisplay = Object.assign({}, finalAttempt.aiAnalysis, {
    narrative: sanitizeNarrativeForDisplay(finalAttempt.aiAnalysis, rejectedPaths),
  });

  // أمر مستخدم 2026-09-23 +03 (A122، بعد القياس العشاري) — العطب المكتشَف:
  // "resolveV7Report.js:411 يمرّر categoryStates: p.categoryStates الخام
  // إلى buildDisplayShapeV7" — applyV7Adjustments لم تكن تُستدعى هنا
  // إطلاقاً، فـfinalLetter يبقى دائماً = deterministicLetter (اقتراحات
  // النموذج بلا أي أثر)، وaudit.adjustments فارغة دوماً (لا سجلّ حتى
  // للمرفوضة EVIDENCE_NOT_PROVEN)، وletterSource لا يصير LLM_ADJUSTED
  // أبداً. ترتيب التركيب المُلزِم موثَّق أصلاً في buildDisplayShapeV7.js:
  // 17-26 ("applyV7Adjustments(categoryStatesRaw, aiAnalysis.adjustments)
  // → categoryStatesAdjusted" قبل buildDisplayShapeV7) — ونفس النمط
  // مُطبَّق فعلاً (بلا فحص guard.ok، لأن تلك الدالّة القديمة سابقة لسياسة
  // الحارس هنا) — كان مُطبَّقاً أيضاً في فرع V7 محلّي أقدم ومنفصل تماماً
  // في runAnalysisInternal.js (:535-586 وقت كتابة هذا التعليق)، حُذف مع
  // التبديل (fd3a6ce، القاعدة 23: كان يُطبِّق التعديلات مرّة ثانية فوق ما
  // تطبِّقه resolveV7Report هنا بالفعل — ازدواج، لا مرجعاً حيّاً).
  //
  // **تُطبَّق هنا فقط على ردّ المحاولة المقبولة** — أي حين نجح حارس
  // finalAttempt (نصّ الأمر). القرار ٢١: إن رُفضت المحاولتان (أو فشل
  // المزوّد بلا احتياطي، أو استُنفد الوقت) فلا اقتراحات موثوقة أصلاً —
  // finalAttempt.guard.ok=false في كل تلك الحالات الثلاث (buildProviderFailedOutcome/
  // مسار TIME_BUDGET_EXHAUSTED كلاهما يبنيان guard.ok=false صراحة)، فـ
  // categoryStatesForDisplay تبقى p.categoryStates الخام بلا أي تعديل —
  // الاقتراحات تسقط تماماً، غير مُسجَّلة حتى (لا رد وصل يستحقّ التسجيل،
  // أو الرد المرفوض غير موثوق بشكل عام لا في الاقتراحات فقط).
  const categoryStatesForDisplay = (finalAttempt.guard && finalAttempt.guard.ok) ?
      applyV7Adjustments(p.categoryStates, finalAttempt.aiAnalysis && finalAttempt.aiAnalysis.adjustments, p.findings) :
      p.categoryStates;

  const {display, audit} = buildDisplayShapeV7({
    categoryStates: categoryStatesForDisplay,
    findings: p.findings,
    aiAnalysis: aiAnalysisForDisplay,
    language: p.language || 'ar',
  });

  const droppedDisplayFields = expandDroppedDisplayFields(rejectedPaths);
  const narrativeIncomplete = droppedDisplayFields.length > 0;

  // القرار ٢١ البند ٢ — الوسم مع قائمة ما حُذف، على display (يُعرض).
  display.narrativeIncomplete = narrativeIncomplete;
  display.narrativeIncompleteFields = droppedDisplayFields;

  // "تُسجَّل محاولة إعادة التوليد وكلفتها في audit" — على audit (لا يُعرض).
  audit.regeneration = {
    attempts: rounds.length,
    narrativeIncomplete,
    droppedFields: droppedDisplayFields,
    rounds,
  };

  // أمر مستخدم 2026-10-01 +03، القرار ٤ "حارس details" — حقل جديد (القاعدة
  // 25): خرق أرقام/لغة وقع في narrative.details وحده (guardV7Response
  // .detailsWaived، reportShapeV7.js) لا يُرفض الردّ بسببه — لكنه يُسجَّل
  // هنا، لا يُعرض (details نفسها محجوبة عن المشتري، القرار S6). null صراحةً
  // إن لم يقع خرق كهذا على المحاولة النهائية المقبولة.
  audit.detailsGuardWaived = (finalAttempt.guard && finalAttempt.guard.detailsWaived) || null;

  return {
    display,
    audit,
    aiModel: finalAttempt.aiModel,
    // مجموع مدد كل الجولات — إعادة التوليد كلفة زمنية حقيقية على الفحص.
    duration: rounds.reduce((sum, r) => sum + (r.durationMs || 0), 0),
    pipeline: finalAttempt.pipeline,
    bodyBuildMs: finalAttempt.bodyBuildMs,
    guardFinal: finalAttempt.guard,
    // القرار ٢ — حقل شقيق مستقلّ عن audit تماماً (راجع تعريف rawResponseLog
    // أعلى الدالّة). المستهلك الوحيد اليوم: من يستدعي resolveV7Report
    // مباشرة (سكربت القياس). runAnalysisInternal.js لا يقرأ هذا الحقل.
    rawResponseLog,
  };
}

module.exports = {
  resolveV7Report,
  // مُصدَّرة للاختبار المباشر — لا حاجة لمحاكاة callAIv7 كاملة لاختبار كل دالّة.
  _internal: {
    describeGuardRejection, collectRejectedPaths,
    sanitizeNarrativeForDisplay, expandDroppedDisplayFields, buildRoundLog,
  },
};
