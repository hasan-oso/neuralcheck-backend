const crypto = require("crypto");
const {sanitizeFailureText} = require("../utils/failureText");
const {onRequest} = require("firebase-functions/v2/https");
const {db} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
// مصدر الحقيقة الوحيد لعلامتَي pipeline (بلا أي require داخلها — راجع
// pipelineTags.js). هذا require هنا، خارج نطاق مقطع بناء الاستجابة أدناه
// (يبدأ بقراءة مستند التقرير، ينتهي بإرساله) — ذلك المقطع يُستخرَج نصّياً
// في verifyReportAuditExclusion.test.js وverifyReportV7Whitelist.test.js.
// الدالّة الحقيقية أدناه تُغلِق عليه بإغلاق JS عادي؛ new Function في
// الاختبارين لا تفعل (لا تُغلِق على نطاق الوحدة)، فالاختباران يُمرّرانه
// صراحةً كوسيطين إضافيين. ⚠️ لا تُقتبَس هنا حرفياً علامتا بداية/نهاية ذلك
// المقطع معاً — ظهورهما معاً في تعليق قبل موضعهما الحقيقي يُخرج
// indexOf() في الاختبارين هذا التعليق نفسه بدل السطرين الحقيقيين أسفل
// الملف (نفس العطب الذي وُثِّق سابقاً عند V7_PIPELINE_TAG، بصيغة جديدة).
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG} = require("../analysis/pipelineTags");

// ===================================================
// Cloud Function: verifyReport (HTTP — ?scanId=xxx)
// ===================================================
//
// مسار عام بلا مصادقة: يتحقّق من تقرير برمز QR. المستخدم يمسح رمزاً على
// جهاز واحد، فالطلب نادر لكل تقرير ومتكرّر عبر التقارير — محلٌّ يفحص عشرة
// أجهزة في ساعة يُصدر عشرة طلبات، ومشترٍ يتحقّق من جهاز واحد يُصدر واحداً.
//
// ─── لماذا حدّ في الذاكرة لا في Firestore ───────────────────────────
//
// firebase-functions لا يوفّر تحديد معدّل مدمجاً لـonRequest، فالخيار بين
// عدّاد في ذاكرة النسخة وعدّاد في Firestore. الثاني دقيق لكنه يضيف كتابةً
// لكل طلب — أي أن مسار الإساءة يصير هو نفسه مسار الكلفة، ويُمكن إغراق
// الفاتورة بما بُني لحمايتها.
//
// فالعدّاد هنا في الذاكرة، وحدّه معروف ومُعلَن: يُعاد ضبطه عند كل بداية
// باردة، ولا يُشارَك بين النسخ. لذلك maxInstances منخفض عمداً — هو نصف
// الحماية لا مجرّد سقف كلفة: بثلاث نسخ وثلاثين طلباً للدقيقة لكل نسخة،
// السقف الفعلي لعنوان واحد تسعون طلباً في الدقيقة حتى لو وزّع المهاجم
// طلباته على النسخ الثلاث.
//
// ما لا يحميه: مهاجم يوزّع على عناوين كثيرة. ذلك يحتاج App Check أو
// حاجزاً أمام الدالّة، وكلاهما خارج نطاق هذه الجولة.

// طلبات مسموحة لكل عنوان في النافذة. ثلاثون أضعافُ أي استعمال بشري
// معقول، ودون معدّل أي جمع آلي مفيد.
const RATE_LIMIT_PER_IP = 30;
const RATE_WINDOW_MS = 60_000;

// سقف النسخ. منخفض عمداً — انظر أعلاه. وهو أيضاً سقف كلفة: الدالّة عامة
// بلا مصادقة، فبلا سقف يصير الإغراق فاتورةً مفتوحة.
const MAX_INSTANCES = 3;

// طلبات متزامنة لكل نسخة. الافتراضي 80؛ خفضناه لأن كل طلب يقرأ Firestore
// مرّة إلى ثلاث، فالسقف الكلّي 3 × 40 = 120 طلباً في الطيران.
const CONCURRENCY = 40;

// عنوان → [طوابع زمنية داخل النافذة]. يُنظَّف كسولاً عند كل طلب.
const hits = new Map();

/**
 * عنوان الطالب. خلف موازن جوجل يصل العنوان الحقيقي في أول مدخلة من
 * x-forwarded-for؛ req.ip قد يكون عنوان الموازن نفسه.
 * @param {Object} req الطلب
 * @return {string} العنوان أو "unknown"
 */
function callerIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim() !== "") {
    return xff.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

/**
 * هل تجاوز هذا العنوان حدّه؟ يسجّل الطلب إن لم يتجاوز.
 * @param {string} ip العنوان
 * @return {{limited: boolean, retryAfterSec: number}} النتيجة
 */
function rateLimited(ip) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  const recent = (hits.get(ip) || []).filter((t) => t > cutoff);

  if (recent.length >= RATE_LIMIT_PER_IP) {
    hits.set(ip, recent);
    const oldest = recent[0];
    return {
      limited: true,
      retryAfterSec: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(ip, recent);

  // تنظيف كسول: الخريطة تنمو بعدد العناوين المميّزة داخل عمر النسخة.
  // ألف مدخلة سقف كافٍ ورخيص؛ تجاوزه يعني حذف ما خرج من النافذة.
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      const live = v.filter((t) => t > cutoff);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
  }

  return {limited: false, retryAfterSec: 0};
}

exports.verifyReport = onRequest(
    {
      timeoutSeconds: 10,
      memory: "256MiB",
      cors: true,
      maxInstances: MAX_INSTANCES,
      concurrency: CONCURRENCY,
    },
    async (req, res) => {
      if (req.method !== "GET") {
        res.status(405).json({error: "Method not allowed"});
        return;
      }

      const ip = callerIp(req);
      const rl = rateLimited(ip);
      if (rl.limited) {
        console.warn(`verifyReport — rate limited ip=${ip} ` +
            `limit=${RATE_LIMIT_PER_IP}/${RATE_WINDOW_MS / 1000}s`);
        res.set("Retry-After", String(rl.retryAfterSec));
        res.status(429).json({error: "rate_limited"});
        return;
      }

      const scanId = req.query.scanId;
      if (!scanId) {
        res.status(400).json({error: "scanId is required"});
        return;
      }

      try {
        const inputId = String(scanId).trim();
        const upperId = inputId.toUpperCase();
        // القاعدة 36 وقرار المستخدم (V8 الدفعة ١): المُدخل يكتبه زائر عامّ (shortId أو scanId) فلا يُطبع خامّاً (البند ٤-ب، 2026-10-18).
        console.log("verifyReport — input:", hashIdForLog(inputId), "upper:", hashIdForLog(upperId));

        // 1) حاول البحث المباشر بـ document ID
        let reportDoc = await db.collection("reports").doc(inputId).get();
        console.log("verifyReport — direct doc exists:", reportDoc.exists);

        // 2) لم يُوجد → ربما المُدخل shortId قابل للقراءة
        if (!reportDoc.exists) {
          const shortSnap = await db.collection("reports")
              .where("shortId", "==", upperId)
              .limit(1)
              .get();
          console.log(
              "verifyReport — shortId query size:", shortSnap.size,
              "for:", hashIdForLog(upperId),
          );
          if (!shortSnap.empty) {
            reportDoc = shortSnap.docs[0];
          }
        }

        // 3) محاولة أخيرة: لو المُدخل بدون "NC-" prefix
        if (!reportDoc.exists && !upperId.startsWith("NC-")) {
          const withPrefix = "NC-" + upperId;
          const fallbackSnap = await db.collection("reports")
              .where("shortId", "==", withPrefix)
              .limit(1)
              .get();
          console.log(
              "verifyReport — fallback with prefix:", hashIdForLog(withPrefix),
              "size:", fallbackSnap.size,
          );
          if (!fallbackSnap.empty) {
            reportDoc = fallbackSnap.docs[0];
          }
        }

        if (!reportDoc.exists) {
          console.warn("verifyReport — not found for:", hashIdForLog(inputId));
          res.status(404).json({error: "not_found"});
          return;
        }

        const report = reportDoc.data();

        // ═══════════════════════════════════════════════════════════════
        // القرار ٢٣ (PLAN-01-ROADMAP.md §🔒 "٢٣ · verifyReport — قائمة
        // بيضاء V7") — A101: القائمة القديمة كانت مبنيّة على مفاتيح V6
        // وتقرأ report.aiResponse بشكله المسطَّح القديم (overallGrade،
        // category_scores، buyer_advice نصّاً واحداً، إلخ). حين يصير
        // aiResponse بشكل V7 (buildDisplayShapeV7.js) — كائن {overall,
        // categories, issues, narrative} — القائمة القديمة كانت تُعيد
        // افتراضات فارغة لخمسة عشر من ستّة عشر مفتاحاً (issues وحدها
        // نجت لتطابق بنيوي: كلاهما مصفوفة باسم issues) **بلا أي خطأ
        // ظاهر** — /verify تصير فارغة وظيفياً بصمت. هذا هو ما يُصلحه هذا
        // القسم: قائمتان بيضاوان صريحتان، منفصلتان تماماً بحسب
        // report.pipeline — لا قائمة واحدة تحاول خدمة الشكلين.
        //
        // القيمة محسومة (مهمّة 2026-09-21 +03، بعد مراجعتين): V7_PIPELINE_TAG
        // مستورَدة أعلى الملف من pipelineTags.js — مصدر الحقيقة الوحيد،
        // يوثّق فيه سلسلة الكتابة/القراءة الكاملة (callAI.js →
        // runAnalysisInternal.js → analyzeDevice.js → هنا). "v7_deterministic"
        // لم تكن قيمة قائمة قطّ في هذا المستودع (grep صفر نتيجة) — ذُكرت في
        // نصّ أمر سابق اختراعاً لا نقلاً؛ لا سؤال مفتوح حولها بعد الآن.
        //
        // V6_PIPELINE_TAG (أيضاً من pipelineTags.js) → V6 صريحة. غياب الحقل
        // (undefined) → V6 أيضاً (كل المخزون من قبل التبديل، fd3a6ce —
        // منذ التبديل runAnalysisInternal.js يكتب pipeline=V7_PIPELINE_TAG
        // على كل فحص جديد، فتقارير V7 حقيقية موجودة الآن). أي قيمة ثالثة غير متوقَّعة
        // **لا تسقط صامتة** (القاعدة 22) — تُسجَّل بتحذير وتُعامَل V6
        // احتياطاً (القائمة V6 لا تقرأ حقول V7 غير موجودة أصلاً، فلا عطب
        // إضافي، فقط إخراج ربما غير مكتمل — والتسجيل وحده هو ما يمنع الصمت
        // هنا).
        //
        // لا تعريف محلّي للثابتين هنا بعد اليوم — الإغلاق (closure) العادي
        // لدالّة onRequest الحقيقية يصل require أعلى الملف مباشرةً. الاستثناء
        // الوحيد: هذا القسم (بناء `response` حتى res.json) يُستخرَج نصّياً في
        // verifyReportAuditExclusion.test.js وverifyReportV7Whitelist.test.js
        // عبر new Function('reportDoc','console', ...) — وnew Function لا
        // تُغلِق على نطاق الوحدة، فV7_PIPELINE_TAG/V6_PIPELINE_TAG يصلان
        // هناك كوسيطين إضافيين مُمرَّرين صراحةً من قيمة require في الاختبار
        // نفسه، لا كسلسلة حرفية مكرَّرة. راجع تقرير المهمّة.
        const pipelineValue = report.pipeline;
        const isV7Report = pipelineValue === V7_PIPELINE_TAG;
        const isKnownV6Report = pipelineValue === V6_PIPELINE_TAG ||
            pipelineValue === undefined || pipelineValue === null;
        if (!isV7Report && !isKnownV6Report) {
          console.warn(
              `verifyReport — قيمة pipeline غير معروفة "${pipelineValue}" ` +
              `لـ scanId=${hashIdForLog(reportDoc.id)} — تُعامَل V6 احتياطاً، لا صامتة (القاعدة 22)`,
          );
        }

        console.log(
            "verifyReport — found:", hashIdForLog(reportDoc.id),
            "shortId:", hashIdForLog(report.shortId),
            "pipeline:", pipelineValue === undefined ? "(missing→v6)" : pipelineValue,
        );

        // ─── بنّاء V7 — كائن حرفي بمفاتيح معدودة، لا spread ولا تمرير
        // للمستند (القيد الصريح).
        //
        // القاعدة الحاكمة (رسالة المنسّق أثناء هذه المهمّة، تُغلق سؤالاً كان
        // معروضاً على المستخدم في نسخة سابقة من هذا الملف): "القرار ٢٣ كان
        // يعدّد ما لا يُعرض (audit)، لا يحصر ما يُعرض. كل ما في display يخرج
        // — بُني لذلك. وما لا يخرج: audit وmeasuredCategoriesMean وحدهما."
        // فالقائمة أدناه = كل حقل حقيقي في buildDisplayShapeV7.display (+
        // narrativeIncomplete/narrativeIncompleteFields اللذين يُضيفهما
        // resolveV7Report.js فوق display قبل الحفظ — resolveV7Report.js:
        // 316-317) — لا حصراً انتقائياً.
        //
        // ⚠️ فرق موثَّق عن تعداد المنسّق الحرفي (القاعدة 15 — نفّذ الصحيح ثم
        // أبلغ): رسالة المنسّق عدّدت ستّة حقول جديدة صراحةً (partialAssessmentTag
        // · noDataAtAll · zeroMeasuredMessage · abstentionReasons ·
        // harnessError · harnessErrorReason) لكنها لم تذكر overall.coveragePct
        // — وهو حقل حقيقي في buildDisplayShapeV7.js:252 (`coveragePct`)، داخل
        // display.overall مثل البقيّة، ولا يظهر في قائمة audit المُستثناة.
        // القاعدة المذكورة نفسها ("كل ما في display يخرج") تحسمه: أُضيف هنا
        // رغم غيابه من التعداد — سهو في التعداد لا استثناء مقصود (راجع تقرير
        // المهمّة تحت "الفرق بين ما أُمرت به وما فعلت").
        //
        // ⚠️ حقل غير موجود في aiResponse V7 المخزون لا يمرّ صامتاً بل
        // يُسجَّل (اختبار الانحدار المطلوب صراحةً، القاعدة 22) — missingKeys
        // أدناه تُجمَّع وتُطبَع بتحذير واحد إن وُجدت، بدل أن تختفي كـnull
        // بلا أثر تماماً كما فعلت القائمة القديمة مع V7 (A101 نفسها).
        //
        // categories/issues: تمريرة مباشرة (بالمرجع) من المستند المخزون —
        // كما كانت. هذا يحرس المستوى الأوّل من aiResponse فقط، لا محتوى
        // متداخلاً داخل كل فئة/عطب — القاعدة 4 (A104، البند المنفصل في أمر
        // هذه المهمّة): الضمانة ضد مفتاح متداخل غير معروف تخصّ الكاتب
        // (analyzeDevice.js يبني display بحقول مُسمّاة قبل الحفظ، لا
        // verifyReport بعده) — راجع تقرير المهمّة.
        function buildV7Response(scanId, rep, cons) {
          const ai = (rep.aiResponse && typeof rep.aiResponse === "object") ? rep.aiResponse : {};
          const overall = (ai.overall && typeof ai.overall === "object") ? ai.overall : {};
          const narrative = (ai.narrative && typeof ai.narrative === "object" && !Array.isArray(ai.narrative)) ?
            ai.narrative : {};
          const buyerAdvice = (narrative.buyerAdvice && typeof narrative.buyerAdvice === "object" &&
              !Array.isArray(narrative.buyerAdvice)) ? narrative.buyerAdvice : {};
          const missingKeys = [];

          function pickOverall(key, fallback) {
            if (!(key in overall)) missingKeys.push(`overall.${key}`);
            return key in overall ? overall[key] : fallback;
          }
          function pickNarrative(key, fallback) {
            if (!(key in narrative)) missingKeys.push(`narrative.${key}`);
            return key in narrative ? narrative[key] : fallback;
          }
          function pickBuyerAdvice(profile) {
            if (!(profile in buyerAdvice)) missingKeys.push(`narrative.buyerAdvice.${profile}`);
            return (profile in buyerAdvice && typeof buyerAdvice[profile] === "string") ?
              buyerAdvice[profile] : null;
          }

          const categoriesOut = ("categories" in ai && ai.categories && typeof ai.categories === "object") ?
            ai.categories : (missingKeys.push("categories"), {});
          const issuesOut = Array.isArray(ai.issues) ? ai.issues :
            (missingKeys.push("issues"), []);
          const narrativeIncompleteOut = ("narrativeIncomplete" in ai) ? !!ai.narrativeIncomplete :
            (missingKeys.push("narrativeIncomplete"), false);
          const narrativeIncompleteFieldsOut = Array.isArray(ai.narrativeIncompleteFields) ?
            ai.narrativeIncompleteFields :
            (missingKeys.push("narrativeIncompleteFields"), []);
          const languageOut = (typeof ai.language === "string" && ai.language) ? ai.language :
            (missingKeys.push("language"), rep.language || "ar");

          const out = {
            scanId: scanId,
            shortId: rep.shortId || null,
            deviceModel: rep.deviceModel,
            deviceMarketingName: rep.deviceMarketingName || rep.deviceModel,
            date: rep.createdAt,
            language: rep.language || "ar",
            isFreeTrial: !!rep.isFreeTrial,
            verified: true,
            aiResponse: {
              pipeline: V7_PIPELINE_TAG,
              language: languageOut,
              letter: pickOverall("letter", null),
              letterSource: pickOverall("letterSource", null),
              coverage: pickOverall("coverage", null),
              coveragePct: pickOverall("coveragePct", null),
              partialAssessment: !!pickOverall("partialAssessment", false),
              partialAssessmentTag: pickOverall("partialAssessmentTag", null),
              governingGateReason: pickOverall("governingGateReason", null),
              noDataAtAll: !!pickOverall("noDataAtAll", false),
              zeroMeasuredMessage: pickOverall("zeroMeasuredMessage", null),
              abstentionReasons: pickOverall("abstentionReasons", null),
              harnessError: !!pickOverall("harnessError", false),
              harnessErrorReason: pickOverall("harnessErrorReason", null),
              // ملحق verifyReport (أمر مستخدم 2026-10-01 +03، القسم ٥) —
              // جملة العرض العربية الجاهزة (categoryStates.js:harnessErrorDisplayMessage،
              // S3) بجوار الرمز الخامّ أعلاه. حاضرة دائماً على overall
              // (null صراحةً في المسار العادي، categoryStates.js) فلا تدخل
              // missingKeys في التقرير المكتمل — راجع verifyReportV7Whitelist.test.js.
              harnessErrorMessage: pickOverall("harnessErrorMessage", null),
              categories: categoriesOut,
              issues: issuesOut,
              // S6 (أمر مستخدم 2026-10-01 +03) — details وverdict تُحذفان من
              // ردّ verifyReport هنا (لا قارئ لهما في الموقع ولا في
              // التطبيق، بنصّ الأمر) — المستند المخزَّن بلا أي مساس
              // (report.aiResponse.narrative.details/verdict يبقيان
              // كاملين؛ هذا الحقل قراءة فقط، لا كتابة هنا أصلاً). لا
              // pickNarrative لهما — فلا يدخلان missingKeys أبداً بصرف
              // النظر عن حضورهما الحقيقي في المستند (حاضران دائماً فعلياً،
              // لكن الحذف هنا مقصود لا عرَضي).
              narrative: {
                summary: pickNarrative("summary", null),
                buyerAdvice: {
                  casual: pickBuyerAdvice("casual"),
                  gamer: pickBuyerAdvice("gamer"),
                  photographer: pickBuyerAdvice("photographer"),
                },
              },
              narrativeIncomplete: narrativeIncompleteOut,
              narrativeIncompleteFields: narrativeIncompleteFieldsOut,
            },
          };

          if (missingKeys.length) {
            cons.warn(
                `verifyReport — تقرير V7 (scanId=${hashIdForLog(scanId)}) بلا حقول display متوقَّعة: ` +
                `[${missingKeys.join(", ")}] — عُوِّضت بقيمة افتراضية آمنة، لا صمت (القاعدة 22، A101)`,
            );
          }

          return out;
        }

        // ─── بنّاء V6 — بلا أي تغيير سلوكي عن ما كان قبل هذه المهمّة.
        function buildV6Response(scanId, rep) {
          const ai = rep.aiResponse || {};
          const resp = {
            // معلومات أساسية
            scanId: scanId,
            shortId: rep.shortId || null,
            deviceModel: rep.deviceModel,
            deviceMarketingName: rep.deviceMarketingName || rep.deviceModel,
            grade: rep.grade || ai.overallGrade || null,
            score: typeof rep.score === "number" ? rep.score : ai.score,
            date: rep.createdAt,
            language: rep.language || "ar",
            isFreeTrial: !!rep.isFreeTrial,
            verified: true,

            // Backwards compat — top-level summary/verdict/issueCount.
            // العملاء القدامى (مثل QR scanners) يقرؤونها مباشرة.
            summary: ai.summary || "",
            verdict: ai.verdict || "",
            issueCount: Array.isArray(ai.issues) ? ai.issues.length : 0,

            // aiResponse كاملاً (الإضافة الحاسمة لـ V2 #49)
            aiResponse: {
              overallGrade: ai.overallGrade || rep.grade || null,
              score: typeof ai.score === "number" ? ai.score : rep.score,
              summary: ai.summary || "",
              details: ai.details || "",
              verdict: ai.verdict || "",
              root_cause: ai.root_cause || null,
              issues: Array.isArray(ai.issues) ? ai.issues : [],
              predicted_problems: Array.isArray(ai.predicted_problems) ?
                ai.predicted_problems : [],
              category_scores: ai.category_scores || {},
              buyer_advice: ai.buyer_advice || {},
              category_notes: ai.category_notes || {},
              expected_performance: ai.expected_performance || {},
              change_analysis: ai.change_analysis || {},
              deviceTier: ai.deviceTier || null,
              estimatedReleaseYear: ai.estimatedReleaseYear || null,
            },
          };
          if (ai._wasReused === true) {
            resp.aiResponse._wasReused = true;
          }
          return resp;
        }

        const response = isV7Report ?
          buildV7Response(reportDoc.id, report, console) :
          buildV6Response(reportDoc.id, report);

        res.json(response);
      } catch (error) {
        // مُعرّف ارتباط: العميل يراه ويذكره عند الإبلاغ، والسجلّ وحده يحمل
        // التفصيل. إعادة error.message خاماً كانت تُسرّب بنية داخلية —
        // أسماء مجموعات، ومسارات، ونصوص أخطاء المكتبات — إلى مسار عام بلا
        // مصادقة.
        const errorId = crypto.randomBytes(6).toString("hex");
        console.error(`verifyReport failed [${errorId}]:`,
            sanitizeFailureText(error),
            // الإطارات وحدها: السطر الأول من stack هو الرسالة الخام نفسها (القاعدة 36).
            String(error.stack || "").split("\n").filter((l) => /^\s+at /.test(l)).join("\n"));
        res.status(500).json({error: "server_error", errorId});
      }
    },
);
