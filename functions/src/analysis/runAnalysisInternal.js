const {db} = require("../utils/admin");
const {sanitizeFailureText, failureTextOnce} = require("../utils/failureText");
const {hashIdForLog} = require("../utils/logRedaction");
const {findDeviceProfile} = require("../profiles/findDeviceProfile");
const {normalizeDeviceProfileKey} = require("../profiles/deviceProfileKey");
// createDeviceProfile/appendScanToHistory moved to analyzeDevice (profile is
// now written AFTER the report is saved — see the return shape below).
const {computeScanSignature} = require("../signatures/computeScanSignature");
const {signatureDifference} = require("../signatures/signatureDifference");
const {reevaluationDecision} = require("../signatures/reevaluationDecision");
const {resolveCacheConfig} = require("../utils/resolveCacheConfig");
const {stripVolatileFieldsFromReport} = require("./stripVolatileFieldsFromReport");
const {rebuildCategoryScores} = require("./rebuildCategoryScores");
const {callAI} = require("./callAI");
const {computeFindings} = require("./findings");
const {readFv68, summarizeForLog} = require("./fv68Reader");
const {classifyCycleCount} = require("./cycleCountClassification");
const {EVALUATION_RULES_VERSION_FIELD} = require("./evaluationRulesVersion");
const {computeCategoryStates} = require("./categoryStates");
const {sampleInputsFromRaw} = require("./sampleInputsFromRaw");
const {missingCoreKeys, CORE_KEY_GROUPS} =
    require("./reportShape");
const {V7_PIPELINE_TAG, V6_PIPELINE_TAG, CACHED_PIPELINE_TAG} = require("./pipelineTags");
// التبديل (أمر مستخدم 2026-09-23 +03، بعد A125/الاكتشافات الأربعة —
// "resolveV7Report مصدر واحد"): resolveV7Report هو مصدر الحيّ الوحيد من
// هنا فصاعداً (راجع القسم "2. تحليل AI" أدناه). applyV7Adjustments/
// buildDisplayShapeV7 لم تعودا مُستوردتين هنا — كانتا تُستهلَكان فقط من
// الفرع المحلّي القديم (pipeline===V7_PIPELINE_TAG، محذوف الآن) الذي كان
// يُطبِّق التعديلات **مرّة ثانية** فوق ما طبّقته resolveV7Report.js نفسها
// بالفعل داخلياً — ازدواج مرفوض صراحة بأمر التبديل. مصدرهما الآن
// resolveV7Report.js وحده (القاعدة 24) — لا نسخة هنا.
const {resolveV7Report} = require("./resolveV7Report");
// أمر مستخدم 2026-09-23 +03، القرار ٤ (a3bd5aa) — يُستهلَك من طبقة الكتابة
// هنا فقط، لا من resolveV7Report.js ولا callAI.js (القيد الصريح). كان
// محروساً بـv7ResolveReportEnabled (نداء ظلّي تجريبي) — الراية حُذفت مع
// التبديل، فصار غير مشروط (المسار الوحيد الحيّ الآن).
const {writeRawAiResponses} = require("./writeRawAiResponses");

// padCacheHitToTarget/CACHED_RESPONSE_TARGET_MS أُزيلا (P0.5، خارطة
// المرحلة ٠). كانا يُنيمان استجابة الكاش حتى 45,000ms لمحاكاة زمن استدعاء
// نموذج طازج — حشو زمني على تقرير مُعاد، لا تحليل جديد (S§2.7؛ ادّعاء
// كاذب مرصود A79). لا بديل بالراية هنا: التعطيل بالراية (أدناه) يخصّ قرار
// إعادة الاستخدام نفسه لا الحشو، والحشو لم يعد له مبرّر بعد أن صار
// reusedFromScanId ظاهراً — لا داعي لإخفاء زمن الاستجابة الحقيقي.

// ===================================================
// INTERNAL: Shared analysis logic between analyzeDevice (production)
// and runConsistencyTest (admin testing).
// DO NOT add auth/credits/Firestore writes here — those belong in callers.
//
// Stage 3a (Phase 1.11): signature switched from positional to destructured
// مسار واحد بعد chore/remove-v3-precompute: V6 raw-timeseries.
// كانت هنا راية اختيارية توجّه بين V3 و V6؛ حُذفت مع المسار.
// ===================================================
//
// Return shape (normalized across V3 / V5 / cached paths):
//   {
//     aiResult,              // the rebuilt AI response object
//     rawDeviceModel,        // device.model fallback string
//     aiModel,               // "deepseek-v4-flash" | "gemini-2.5-flash" |
//                            //   "gemini_fallback" | "cached_signature_match"
//     duration,              // wall-clock ms (new)
//     aiDurationMs,          // alias of `duration` — kept for back-compat with
//                            //   existing callers that read aiDurationMs
//     aiFallbackReason,      // string | null
//     pipeline,              // "v6_raw_timeseries" | "cached"
//     v5Metrics,             // { bodyBuildMs, leaksBeforeFix, leaksAfterFix,
//                            //   fixCallMade, aiGradeMissing, aiScoreMissing,
//                            //   aiResponseIncomplete, aiResponseMissingKeys }
//                            //   | null  (also used by V6; bodyBuildMs is
//                            //   the body-build + JSON.stringify time —
//                            //   renamed from precomputeMs 2026-09-21,
//                            //   task A65. Docs written before that date
//                            //   still carry the field as `precomputeMs`.)
//   }
async function runAnalysisInternal({
  fingerprint,
  language,
  deepseekKey,
  geminiKey,
  scanContext,
  // أمر مستخدم 2026-09-23 +03، القرار ١ — الموعد النهائي المطلق (epoch ms)
  // لنداء resolveV7Report الثاني عند رفض الحارس. غير مُمرَّر = undefined،
  // وresolveV7Report.js يُعامله كـ"بلا سقف" (Infinity) — نفس سلوك اليوم
  // حرفياً لأي مستدعٍ لا يُمرّره (runConsistencyTest.js مثلاً، مهلته 540 ث
  // منفصلة عن analyzeDevice.js's 300، ولم يُطلَب تمديد هذا التعديل إليه).
  deadline,
  // أمر مستخدم 2026-09-24 +03، القرار ٧٥ البند ٤ — وقت الخادم عند بدء
  // الدالّة المستدعية (Date.now() الحقيقي، لا سِنتينل). غير مُمرَّر =
  // undefined → computeCategoryStates/computeGates يُعلنان PATCH_AGE=UNKNOWN،
  // لا Date.now() بديلاً (نصّ الأمر صراحة). **كلا المستدعيَين الحيّين
  // يُمرِّرانها اليوم** (تحديث الجولة الثالثة، بعد اكتشاف المدقّق بالأداة):
  // analyzeDevice.js → functionStartTime؛ runConsistencyTest.js → startedAt
  // (نفس القيمة لكل تكرارات الدفعة الواحدة، لا Date.now() منفصل لكل واحد
  // — راجع تعليق رأس exports.runConsistencyTest). أي مستدعٍ ثالث مستقبلي
  // لا يمرّرها يحصل على UNKNOWN صراحة، لا سقوطاً صامتاً على Date.now().
  analyzedAtMs,
  // S-P6-07 (2026-10-21 +03، PLAN-06 §١-ب-٧ «الكاش و previousScan»، P:404-407): «analyzeDevice يمنع إعادة الاستعمال صراحةً حين الغرض repeat_* أو battery_after أو return. ولا يمرّر previousScan في
  // الفحوص البروتوكولية [اجتهاد]. ✓ س١١: المنع في الفحوص البروتوكولية وحدها.» نصّ نصّي غير فارغ = فحص بروتوكولي (يُكتب سببه في cacheReason)؛ غير مُمرَّر/null = السلوك القائم بلا تغيير (فحوص عادية، runConsistencyTest).
  // فالفحص المكرّر يُنتج تقريراً جديداً لا ردّاً من الكاش (وإلا لما كان «تكراراً» يقيس ثبات النتائج): تُقرأ المطابقة كما هي لتعرف الدالّة existingProfile، ثم لا يُستعمل التقرير القديم ولا previousScan.
  reuseBlockedReason,
} = {}) {
  // Function-entry timestamp; used to report the real wall-clock duration
  // of a cache hit (no padding since P0.5 — see note above).
  const cacheCheckStartTime = Date.now();

  // 1. استخراج deviceProfileKey + المقارنة الذكية مع الفحص السابق (V2 fix #34)
  // المنطق:
  //   - لا profile سابق → فحص جديد، callAI بدون previousScan
  //   - profile سابق + signature match (diff < 15%) → أعد التقرير القديم بدون callAI
  //   - profile سابق + signature mismatch → callAI بدون previousScan (تقييم مستقل)
  //   - profile قديم بدون signature (legacy) → callAI مع previousScan كما السابق
  const deviceProfileKey = fingerprint.device?.deviceProfileKey || null;
  let previousScan = null;
  let existingProfile = null;
  let cachedReportToReuse = null;
  // ختم قواعد التقييم في مستند التقرير المُعاد (2026-10-13 +03، evaluationRulesVersion.js): يُحمَل إلى المستند الجديد (analyzeDevice.js: evaluationRulesStampFields) لأن محتوى
  // التقرير المخبَّأ أنتجته قواعد التقرير الأصل. null = الأصل بلا ختم («كُتب قبل الختم») ⟵ المفتاح يغيب من المستند الجديد، لا قيمة افتراضية.
  let reusedEvaluationRulesVersion = null;
  // Set when a manual test went fail→pass between scans (device likely
  // serviced). Annotated onto the fresh aiResult below.
  let maintenanceSuspected = false;

  // Cache observability (additive — does NOT change cache decisions).
  // cacheReason is set by the same branches that handle the cache logic.
  // The default "first_scan" covers: no deviceProfileKey, no profile in db,
  // no scanHistory, exception during lookup, or legacy scan without signature.
  let cacheHit = false;
  let cacheReason = "first_scan";
  // scanId الذي جاء منه التقرير المُعاد — يُكتب على aiResult.reusedFromScanId
  // (P0.5) كي تعرضه الواجهة، لا يبقى ضمناً في السجلّ فقط.
  let reusedFromScanId = null;
  // Profile-key prefix for log readability. The mobile sends deviceProfileKey
  // as an object {a, b, c, d, e, f} (release, R8) or with the full names, where the primary is the
  // SHA-256 primary hash — the most stable identifier. The previous String(obj).slice(0, 8) yielded
  // "[object " on object inputs; this reads the primary through the one normalizer
  // (profiles/deviceProfileKey.js — V8 pre-deploy, 2026-10-09) and gracefully falls
  // back to "none" when the key is absent, malformed or unusable.
  const profileKeyStr = (typeof deviceProfileKey === "string") ?
      deviceProfileKey.slice(0, 8) :
      (normalizeDeviceProfileKey(deviceProfileKey).key?.primary?.slice(0, 8) || "none");

  if (deviceProfileKey) {
    try {
      existingProfile = await findDeviceProfile(deviceProfileKey);
      if (existingProfile && existingProfile.data?.scanHistory?.length > 0) {
        const lastScan = existingProfile.data.scanHistory[0];
        const lastScanDate = lastScan.scanDate?.toDate ? lastScan.scanDate.toDate() :
            (lastScan.scanDate ? new Date(lastScan.scanDate) : new Date());

        const newSig = computeScanSignature(fingerprint);
        const oldSig = lastScan.signature;

        if (oldSig) {
          // Detect pipeline-version mismatch BEFORE diff calc so logs can
          // distinguish "pipeline_changed" from genuine drift. (Without this
          // early check, signatureDifference returns 1.0 for both cases and
          // we'd log them indistinguishably as drift_100.0%.)
          const oldPv = oldSig.pipelineVersion || null;
          const newPv = newSig.pipelineVersion || null;
          if (oldPv && newPv && oldPv !== newPv) {
            cacheReason = `pipeline_changed from=${oldPv} to=${newPv}`;
            console.log(`[cache] miss profile=${profileKeyStr} reason=${cacheReason}`);
            previousScan = null;
          } else {
            const diffRatio = signatureDifference(newSig, oldSig);
            const driftPct = (diffRatio * 100).toFixed(1);

            // Defect-oriented + directional decision, INDEPENDENT of the
            // aggregate %-threshold. Forces a fresh analysis when a single
            // material defect appears (verification pass→fail, criticalDefect
            // flip, error-counter rise, battery swap/degradation, or a manual
            // test transition pass→fail / not_tested→fail / fail→pass) that the
            // 20% aggregate would otherwise dilute and miss (the "healthy report
            // for a now-broken device" bug).
            const decision = reevaluationDecision(newSig, oldSig);
            console.log(`[ScanCompare] sig diff = ${driftPct}% (threshold = 20%) ` +
                `forceReeval=${decision.forceReevaluate}` +
                (decision.forceReevaluate ? ` reasons=[${decision.reasons.join("; ")}]` : ""));

            // P0.5: راية إعدادات مستقلّة عن نسبة الفرق وعن قرار العيب —
            // تُقرأ فقط هنا، حيث القرار الآخران يسمحان أصلاً بإعادة
            // الاستخدام. تعطيلها (DEFAULT_REUSE_ENABLED=false أثناء
            // التجربة الجارية) يجبر كل فحص على استدعاء النموذج بصرف
            // النظر عن diffRatio.
            const cacheConfig = await resolveCacheConfig();

            // Reuse ONLY when the settings flag allows it, there is NO
            // forced defect/transition, AND the aggregate drift is below
            // threshold. Otherwise re-evaluate.
            if (cacheConfig.reuseEnabled && !decision.forceReevaluate && diffRatio < 0.20 && !reuseBlockedReason) {
              // فرق طفيف ولا عيب جديد → استخدم التقرير القديم بدون استدعاء النموذج
              console.log("[ScanCompare] reusing previous report (below threshold, no new defect)");
              const oldReportRef = lastScan.reportRef;
              if (oldReportRef) {
                const oldReportSnap = await db.doc(oldReportRef).get();
                if (oldReportSnap.exists) {
                  const oldReportData = oldReportSnap.data();
                  cachedReportToReuse = oldReportData.aiResponse;
                  const oldStamp = oldReportData[EVALUATION_RULES_VERSION_FIELD];
                  reusedEvaluationRulesVersion = (typeof oldStamp === "string" && oldStamp !== "") ? oldStamp : null;
                  cacheHit = true;
                  cacheReason = "hit";
                  reusedFromScanId = lastScan.scanId ||
                      (typeof oldReportRef === "string" ?
                          oldReportRef.replace(/^reports\//, "") : null);
                  console.log(`[cache] hit  profile=${profileKeyStr} drift=${driftPct}%`);
                } else {
                  // البند ٤-ج (2026-10-18): reportRef = «reports/<scanId>» — معرّف الفحص السابق خامّاً؛ يُهشَّر بعد نزع البادئة ليُطابق هاش scanId في بقية السجلّات، وغير النصّ يُعلَن حالةً لا قيمة (القاعدة 22).
                  const staleScanId = typeof oldReportRef === "string" ? oldReportRef.replace(/^reports\//, "") : null;
                  console.warn(`[ScanCompare] reportRef ${hashIdForLog(staleScanId)} not found — falling through to AI`);
                  cacheReason = "stale_reportRef";
                  console.log(`[cache] miss profile=${profileKeyStr} reason=stale_reportRef`);
                }
              }
            } else {
              // عيب/انتقال جديد (آلي/يدوي/بطارية) أو drift ≥ 20% أو الراية
              // معطَّلة → تقييم مستقل.
              previousScan = null;
              if (decision.forceReevaluate) {
                maintenanceSuspected = decision.maintenanceSuspected;
                cacheReason = `reeval:${decision.reasons[0]}` +
                    (decision.reasons.length > 1 ? ` (+${decision.reasons.length - 1} more)` : "");
                console.log("[ScanCompare] forced reevaluation — new defect/transition detected");
              } else if (reuseBlockedReason) {
                // S-P6-07: فحص بروتوكولي (تكرار...) — لا إعادة استعمال حتى لو كان الفرق طفيفاً (P:405).
                cacheReason = `protocol_scan_reuse_blocked(${reuseBlockedReason}) drift_${driftPct}%`;
                console.log("[ScanCompare] protocol scan — cache reuse blocked, calling model without previousScan");
              } else if (!cacheConfig.reuseEnabled) {
                cacheReason = `reuse_disabled(${cacheConfig.source}) drift_${driftPct}%`;
                console.log("[ScanCompare] cache reuse disabled by settings flag — calling model without previousScan");
              } else {
                cacheReason = `drift_${driftPct}%`;
                console.log("[ScanCompare] significant aggregate change, calling model without previousScan");
              }
              console.log(`[cache] miss profile=${profileKeyStr} reason=${cacheReason}`);
            }
          }
        } else {
          // لا signature قديم — أول فحص بعد ترقية الـ backend
          // مرّر previousScan كما السابق (للتوافق)
          // S-P6-07: «ولا يمرّر previousScan في الفحوص البروتوكولية» (P:406).
          previousScan = reuseBlockedReason ? null : {
            scanDate: lastScanDate.toISOString(),
            daysAgo: Math.floor((Date.now() - lastScanDate.getTime()) / 86400000),
            summary: lastScan.summary || {},
          };
          console.log(reuseBlockedReason ?
              "[runAnalysisInternal] Legacy scan (no signature), protocol scan — previousScan withheld" :
              `[runAnalysisInternal] Legacy scan (no signature), passing previousScan summary, matched by ${existingProfile.matchedBy}`);
          // Treat legacy (no usable sig) as first_scan for cache observability.
          console.log(`[cache] miss profile=${profileKeyStr} reason=first_scan`);
        }
      } else {
        console.log("[runAnalysisInternal] No previous profile found, this is first scan");
        console.log(`[cache] miss profile=${profileKeyStr} reason=first_scan`);
      }
    } catch (e) {
      console.error(`[runAnalysisInternal] findDeviceProfile/comparison failed: ${sanitizeFailureText(e)}`);
      // لا نُفشل العملية — نكمل بدون previousScan
      // cache lookup failed silently — keep default first_scan reason
      console.log(`[cache] miss profile=${profileKeyStr} reason=first_scan`);
    }
  } else {
    // Mobile did not send deviceProfileKey — cache unavailable for this scan.
    console.log(`[cache] miss profile=none reason=first_scan`);
  }

  // إذا تطابق signature، أعد التقرير القديم بدون استدعاء النموذج
  if (cachedReportToReuse) {
    // P0.5: لا حشو زمني بعد الآن (padCacheHitToTarget أُزيل أعلاه) — زمن
    // الاستجابة الحقيقي (<1s) يُرفَع كما هو؛ cachePaddingMs لا يُكتب.
    // reusedFromScanId يظهر داخل aiResult نفسه (P1.5 يعرضه لاحقاً).
    const totalDurationMs = Date.now() - cacheCheckStartTime;
    return {
      aiResult: stripVolatileFieldsFromReport(cachedReportToReuse, reusedFromScanId),
      rawDeviceModel: fingerprint?.device?.model || "unknown",
      aiModel: "cached_signature_match",
      duration: totalDurationMs,
      aiDurationMs: totalDurationMs,
      aiFallbackReason: null,
      pipeline: CACHED_PIPELINE_TAG,
      reusedEvaluationRulesVersion: reusedEvaluationRulesVersion,
      // Cache observability: v5Metrics now carries cacheHit/cacheReason on
      // ALL paths (V3, V5, V6, cached). Other v5Metrics fields are null on
      // the cached path because no AI work was done. cachePaddingMs is
      // intentionally absent (P0.5) — there is no padding to report.
      v5Metrics: {
        cacheHit: true,
        cacheReason: "hit",
      },
    };
  }

  // 1.5 Findings — الحساب الحتمي من العيّنات (P1.1، PLAN-01-ROADMAP
  // §المرحلة ١). يُستدعى قبل callAI كما نصّت الخطّة: طبقة تفسير حتمية
  // مستقلّة عن النموذج. computeFindings موثَّق بأنه لا يرمي أبداً — لا
  // حاجة لـtry/catch هنا، لكن نتحقّق من شكل القيمة دفاعياً قبل إلحاقها
  // بالنتيجة النهائية كي لا يُسقط خطأ غير متوقَّع في هذا الملف مسار
  // التحليل كلّه.
  let findings = null;
  try {
    findings = computeFindings(fingerprint);
  } catch (e) {
    console.error(`[findings] computeFindings threw unexpectedly — omitting from result: ${e.message || e}`);
  }

  // 1.55 قراءات fv68 (الدفعة ٤ من V8): حالة صريحة لكل مفتاح وحالة جديدة من التطبيق (fv68Reader.js، عقد docs/FV68_CONTRACT.md).
  // لا تدخل النموذج ولا المستند اليوم: لا حرف ولا بوّابة تقرؤها بعد (حروف الفئات خارج العقد §٠ :12) — تُعاد مع النتيجة، وسطر سجلّ
  // واحد يقول ما وصل وما غاب وما شذّ كي يُرى في فحص الجهاز بعد 1.0.11. readFv68 لا ترمي (تُعيد readerError صريحاً).
  const fv68Readings = readFv68(fingerprint);
  console.log(summarizeForLog(fv68Readings));

  // 1.56 صفر الدورات من EXTRA_CYCLE_COUNT ⟵ «غير مدعوم» (قرار المستخدم 2026-10-13 +03، cycleCountClassification.js). الحكم على مخرَج القارئ نفسه (لا قراءة ثانية)؛ readerError أو غياب التذييل ⟵ null
  // (لا تصنيف، السلوك القائم). يغذّي computeCategoryStates أدناه فلا يدخل B-08 الثلاثيات ولا حمولة النموذج. الخامّ يبقى في بصمة reportRaw كما شُحن (القاعدة 20). سطر السجلّ لا يحمل قيمة ولا معرّفاً.
  const cycleCountClassification = classifyCycleCount(fv68Readings && fv68Readings.batteryHealth ? fv68Readings.batteryHealth.cycleCount : null);
  if (cycleCountClassification !== null) {
    console.log(`[cycleCount] classification=${cycleCountClassification} — B-08 omitted from categoryStates.testResults (not sent to the model)`);
  }

  // 1.6 حالات الفئات والدرجة العامة بالبوّابات (P1.2/P1.3، الوحدتان
  // testKinds.js وbatteryLayer.js، ثم categoryStates.js تُجمِّعهما) —
  // **الوصل** (P1.4، PLAN-01-ROADMAP.md §١٤/١٥ البند ١): أوّل استهلاك حيّ
  // لهذه الطبقات الثلاث في مسار تحليل فعلي، بعد أن كانت "قائمة بذاتها"
  // (P1.3 نصّت صراحةً: "لا يُستهلَك من callAI ولا من runAnalysisInternal
  // بعد — ذلك P1.4"). حساب حتمي بحت — لا استدعاء نموذج، لا كلفة، لا شبكة.
  //
  // batterySampleInputs يُستخرَج من fingerprint الحيّ مباشرةً (عيّناته
  // كاملة دائماً هنا — قبل lightenFingerprintForStorage التي تُطبَّق فقط
  // عند الكتابة إلى Firestore في analyzeDevice.js). لا حاجة لإعادة جلب من
  // Storage (rehydrateReportSamples.js) على هذا المسار — ذلك يخصّ قارئاً
  // لمستند *مخزون* لاحقاً، لا الفحص الحيّ نفسه.
  //
  // ⚠️ ما هذا لا يفعله بعد: لا يستبدل aiResult.grade/score/category_scores
  // القديمة (تلك القاعدة "كسر نظيف. لا شكل مزدوج" — القرار ٥ — تخصّ صراحةً
  // شكل الاستجابة **المعروض للمستخدم**، وذلك P1.5: "التطبيق والموقع
  // يُحدَّثان في P1.5" — لا يجوز البدء به هنا). النتيجة تُلحَق هنا كحقل
  // إضافي جديد (categoryStates) على مستند التقرير للتدقيق ولإعداد P1.5،
  // ولا تُستهلَك بعد في بناء aiResult أدناه.
  let categoryStates = null;
  try {
    const battery = sampleInputsFromRaw(fingerprint);
    categoryStates = computeCategoryStates({
      functionalResults: fingerprint.functionalResults,
      manualResults: fingerprint.manualResults,
      dev: null, // لا كائن "ملف جهاز بحارس attestsHardwareAbsent" مُوصَّل بعد — راجع categoryStates.js/testKinds.js
      findings,
      batterySampleInputs: battery.sampleInputs,
      batteryDesignCapacityMah: battery.design,
      analyzedAtMs, // القرار ٧٥ البند ٤ — راجع تعليق مُعطيات الدالّة أعلاه
      cycleCountClassification, // قرار 2026-10-13 +03 — راجع 1.56 أعلاه
    });
  } catch (e) {
    // A97 #1 (مفتاح غير معروف في params) يرمي عمداً — لو وقع هنا فهو عطب
    // برمجي حقيقي في هذا الملف (استدعاء خاطئ)، لا مُدخلاً فاسداً من
    // المستخدم. يُسجَّل ولا يُسقط مسار التحليل كلّه (نفس مبدأ findings أعلاه).
    console.error(`[categoryStates] computeCategoryStates threw unexpectedly — omitting from result: ${e.message || e}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. تحليل AI — التبديل (أمر مستخدم 2026-09-23 +03، بعد A125 والاكتشافات
  // الأربعة أثناء تحقيق التبديل). نصّ المستخدم حرفياً: "resolveV7Report
  // مصدر واحد — يُكتب ما يُعيده كما هو، ويُحذف الفرع المحلّي بما فيه
  // التطبيق الثاني للتعديلات." resolveV7Report تُطبِّق applyV7Adjustments
  // + buildDisplayShapeV7 داخلياً بنفسها (مرّة واحدة بالضبط، مشروطة بنجاح
  // الحارس — resolveV7Report.js:435-438) وتُعيد {display, audit} جاهزين.
  // لا تطبيق ثانٍ هنا، ولا إعادة بناء display — القسم القديم الذي كان
  // يفعل ذلك (isV7NestedShape + فرع pipeline===V7_PIPELINE_TAG) حُذف
  // بالكامل (أدناه، بعد نهاية V6 الميتة) لأنه صُمِّم أصلاً لاستهلاك مخرَج
  // callAIv7 المباشر ({aiAnalysis, guard})، لا resolveV7Report (تُعيد
  // {display, audit, guardFinal} بلا .aiAnalysis إطلاقاً) — تطبيقه بلا
  // تعديل كان سينتج بيانات فاسدة صامتة (تفصيل في تقرير المهمّة).
  //
  // الراية v7ResolveReportEnabled والنداء الظلّي الذي كانت تحرسه حُذفا
  // معاً (القيد الصريح: "لا راية تُعيد النداء المزدوج" — نمط c98f867
  // المرفوض بـ21a813b بالضبط، لو أُعيد تفعيلها يوماً بلا حذر).
  let v7Result = null;
  let v7Error = null;
  try {
    v7Result = await resolveV7Report({
      findings,
      categoryStates,
      language: language || "ar",
      scanContext,
      previousScan,
      deepseekApiKey: deepseekKey,
      geminiApiKey: geminiKey,
      deadline,
    });
  } catch (e) {
    v7Error = e;
  }

  if (v7Error || !v7Result) {
    // فشل صلب — نفس تعاقد callAI (V6) القديم بالضبط: كلا المزوّدَين فشلا
    // في المحاولة الأولى (resolveV7Report لا ترمي بعد ذلك مهما رفض
    // الحارس — resolveV7Report.js رأس الملفّ، البند ج). لا تقرير مُختلَق،
    // لا خصم، لا كتابة profile — analyzeDevice.js يرفض الطلب بـHttpsError
    // (aiFailed:true أدناه هو نفس الإشارة التي كان يبنيها المسار القديم
    // حين callAiRaw فارغ — راجع "3. بناء النتيجة" الميتة أدناه للمقارنة).
    console.error("AI analysis failed:", v7Error ? failureTextOnce(v7Error) : "resolveV7Report returned no result");
    return {
      aiResult: null,
      aiFailed: true,
      rawDeviceModel: fingerprint?.device?.model || "Unknown",
      aiModel: null,
      duration: 0,
      aiDurationMs: 0,
      aiFallbackReason: v7Error ? failureTextOnce(v7Error) : "resolveV7Report failed",
      pipeline: V7_PIPELINE_TAG,
      v5Metrics: {cacheHit: false, cacheReason: cacheReason},
      existingProfile: existingProfile,
      deviceProfileKey: deviceProfileKey,
      findings: findings,
      categoryStates: categoryStates,
      fv68Readings: fv68Readings,
      cycleCountClassification: cycleCountClassification,
    };
  }

  // القاعدة 20 ("لا نصّ ردّ خام في المستند... الخام يُخزَّن حيث لا يقرؤه
  // العميل") — rawResponseLog يُكتب هنا في aiRawResponses/{scanId} وحدها
  // (writeRawAiResponses، مجموعة منفصلة تماماً عن reports/{scanId})، ولا
  // يدخل أبداً aiResult/aiResultAudit أدناه (القرار ٢، مؤكَّد بـ
  // rawResponseCapture.test.js/rawAiResponsesWiring.test.js). كان هذا
  // محروساً بـv7ResolveReportEnabled — الآن غير مشروط، المسار الوحيد الحيّ.
  if (scanContext && scanContext.scanId && v7Result.rawResponseLog) {
    const writeResult = await writeRawAiResponses(scanContext.scanId, v7Result.rawResponseLog);
    if (!writeResult.written) {
      console.error(`[analysis][v7] aiRawResponses write skipped/failed — ${writeResult.reason}`);
    }
  }

  // "يُكتب ما يُعيده resolveV7Report كما هو": aiResult=display (شكل العرض
  // النهائي، يطابق حرفياً ما يقرؤه فرع V7 في verifyReport.js:buildV7Response
  // ومطابق لِما تكتبه analyzeDevice.js:buildV7ResponseForStorage — تحقّقت
  // حقلاً حقلاً، لا فرق). aiResultAudit=audit (القرار ٢٠: "يُكتب في مستند
  // التقرير تحت مفتاح aiAudit منفصل عن aiResponse" — analyzeDevice.js
  // تكتبه كذلك دون تغيير). audit يحمل: measuredCategoriesMean،
  // gatesApplied[]، partialBadLetterUngated[]، adjustments[]، disputed،
  // categoryLlmSuggestedLetters{}، crossChecks[]، modelObservations[]،
  // issueSetHash/lettersHash/numbersHash (buildDisplayShapeV7.js) +
  // regeneration{attempts, narrativeIncomplete, droppedFields, rounds}
  // (resolveV7Report.js فوقها) — صفر نصّ ردّ خام في أيّ منهما.
  return {
    aiResult: v7Result.display,
    aiResultAudit: v7Result.audit,
    aiFailed: false,
    rawDeviceModel: fingerprint?.device?.model || "Unknown",
    aiModel: v7Result.aiModel,
    duration: v7Result.duration,
    aiDurationMs: v7Result.duration,
    aiFallbackReason: null,
    pipeline: v7Result.pipeline,
    v5Metrics: {
      bodyBuildMs: v7Result.bodyBuildMs ?? null,
      cacheHit: false,
      cacheReason: cacheReason,
      v7GuardOk: v7Result.guardFinal ? !!v7Result.guardFinal.ok : null,
    },
    existingProfile: existingProfile,
    deviceProfileKey: deviceProfileKey,
    findings: findings,
    categoryStates: categoryStates,
    fv68Readings: fv68Readings,
    cycleCountClassification: cycleCountClassification,
  };

  // ═══════════════════════════════════════════════════════════════════
  // ما يلي — مسار V6 كاملاً (callAI + بناء aiResult القديم) — **غير قابل
  // للوصول أبداً** بعد الـreturn أعلاه. أمر مستخدم 2026-09-23 +03: "كود
  // V6 لا يُحذف. يتوقّف استدعاؤه فقط." يبقى هنا حرفياً بلا أي تعديل —
  // مرجع تاريخي ومَخرج طوارئ نظري لإعادة التفعيل، لا مسار حيّ (القاعدة
  // 17: لا يُحذف دليل عمل منجز). عدّادات نداء فعلية تُثبت callAI=0 على كل
  // سيناريو — راجع تقرير المهمّة/measure-v7-wiring-call-counters.js.
  // ═══════════════════════════════════════════════════════════════════
  let aiAnalysis = null;
  let aiFallbackReason = null;
  let callAiRaw = null;
  try {
    callAiRaw = await callAI(
        fingerprint,
        language || "ar",
        scanContext,
        previousScan,
        deepseekKey,
        geminiKey,
    );
  } catch (error) {
    console.error("AI analysis failed:", failureTextOnce(error));
    aiFallbackReason = failureTextOnce(error);
  }

  // Normalize the callAI return shapes:
  //   V3 spread:        { ...result, _provider, _durationMs, _failReason? }
  //   V5/V6 nested:     { aiAnalysis, aiModel, duration, pipeline,
  //                       bodyBuildMs, leaks*, fixCallMade, postProcessing? }
  //   V7 nested (P1.5): { aiAnalysis, aiModel, duration, pipeline,
  //                       bodyBuildMs, guard }  — callAIv7 (callAI.js).
  //                       **لا leaks*/fixCallMade/footerIntegrity** — تلك
  //                       حقول V6 حصراً (callAI.js:298-312 مقابل :486-493).
  //                       هذا الفرع بأكمله ميت منذ التبديل (fd3a6ce) —
  //                       الدالّة تُرجع من مسار V7 المباشر أعلى هذا
  //                       الملفّ قبل الوصول إلى أي سطر هنا. الوصف التالي
  //                       يخصّ سلوك هذا الكود الميت وحده وقت كتابته، لا
  //                       الحال الحيّة اليوم: كان callAiRaw.pipeline لا
  //                       يصير "v7_findings_based" أبداً طالما callAI
  //                       (V6) هو المُستدعى — راجع تقرير المهمّة الأصلي.
  // كان الفحص يقبل علامتين — "v5_precomputed" و"v6_raw_timeseries" —
  // تحسّباً لتراجع إلى V5. حُذف V5 في chore/remove-v3-precompute فلم تبقَ
  // إلا علامة واحدة؛ وإبقاء الثانية يُوهم بمسار لا وجود له.
  let provider = "deepseek-v4-flash";
  let durationMs = 0;
  let v5Metrics = null;
  // مسار واحد فعلياً اليوم. الحقل من pipelineTags.js (مصدر الحقيقة الوحيد)
  // لا حرفياً منفصلاً: التقارير تُميَّز به، فلا يجوز أن يصير undefined أو
  // يحمل اسم مسار محذوف.
  let pipeline = V6_PIPELINE_TAG;

  // ملاحظة 2026-09-23 +03 (أمر التبديل): isV7NestedShape حُذفت من هنا —
  // كانت تتعرّف على شكل مخرَج callAIv7 المباشر المتداخل ({aiAnalysis,
  // guard})، لا شكل resolveV7Report ({display, audit, guardFinal}، بلا
  // .aiAnalysis إطلاقاً). لا حاجة لها بعد الآن: مسار V7 الحيّ يعود مباشرة
  // (return أعلى هذا القسم) قبل الوصول إلى هذا الكود أصلاً — هذا الكود كلّه
  // (V6 + الاحتياطي V3) ميت، مرجع تاريخي فقط (راجع التعليق أعلى "2. تحليل AI").
  const isV6NestedShape = !!(callAiRaw && callAiRaw.aiAnalysis &&
      callAiRaw.pipeline === V6_PIPELINE_TAG);
  const isNestedShape = isV6NestedShape;

  if (isV6NestedShape) {
    // V5/V6 nested shape
    aiAnalysis = callAiRaw.aiAnalysis;
    provider = callAiRaw.aiModel || provider;
    durationMs = callAiRaw.duration || 0;
    pipeline = callAiRaw.pipeline;
    v5Metrics = {
      // bodyBuildMs: renamed from precomputeMs 2026-09-21 (task A65) to
      // match what callAI.js:170 actually measures — no migration of old
      // Firestore documents, which still read `precomputeMs` under this
      // same v5Metrics key. See callAI.js:167-174 for the full rationale.
      bodyBuildMs: callAiRaw.bodyBuildMs ?? null,
      leaksBeforeFix: callAiRaw.leaksBeforeFix ?? 0,
      leaksAfterFix: callAiRaw.leaksAfterFix ?? 0,
      fixCallMade: !!callAiRaw.fixCallMade,
      // إصدار حقول التطبيق + رايات نزاهة التذييل. تُحفظ هنا تحديداً لأن
      // analyzeDevice يكتب v5Metrics كما هو، فتصل Firestore قابلةً
      // للاستعلام بلا تعديل في مسار الحفظ.
      fieldsVersion: callAiRaw.footerIntegrity?.fieldsVersion ?? null,
      maxBatteryTempMismatch:
          callAiRaw.footerIntegrity?.maxBatteryTempMismatch ?? null,
      maxBatteryTempDeltaC:
          callAiRaw.footerIntegrity?.maxBatteryTempDeltaC ?? null,
      storagePercentInvalid:
          callAiRaw.footerIntegrity?.storagePercentInvalid ?? null,
      availableStorageGbInvalid:
          callAiRaw.footerIntegrity?.availableStorageGbInvalid ?? null,
    };
  } else if (callAiRaw) {
    // V3 spread shape
    aiAnalysis = callAiRaw;
    provider = callAiRaw._provider || provider;
    durationMs = callAiRaw._durationMs || 0;
    if (callAiRaw._failReason && !aiFallbackReason) {
      aiFallbackReason = callAiRaw._failReason;
    }
  }

  // Cache observability: extend v5Metrics with cacheHit/cacheReason so the
  // Firestore write captures decision data on every path (V3, V5, V6).
  // We reach this point only when the cache did NOT serve the request
  // (cached path returned early above), so cacheHit is always false here.
  if (v5Metrics) {
    v5Metrics.cacheHit = false;
    v5Metrics.cacheReason = cacheReason;
  } else {
    v5Metrics = {
      cacheHit: false,
      cacheReason: cacheReason,
    };
  }

  // Hard AI failure: callAI threw (callAiRaw is null) → DeepSeek AND Gemini
  // both failed. The active V6 path has no local fallback, so this is a
  // terminal failure. Do NOT fabricate a C/50 report and do NOT write a device
  // profile — return a clear failure signal so analyzeDevice rejects WITHOUT
  // charging a scan / saving a report / persisting a profile.
  // (A successful Gemini fallback sets aiFallbackReason but callAiRaw is
  //  non-null, so it is NOT treated as a hard failure here.)
  if (!callAiRaw) {
    return {
      aiResult: null,
      aiFailed: true,
      rawDeviceModel: fingerprint?.device?.model || "Unknown",
      aiModel: provider,
      duration: durationMs,
      aiDurationMs: durationMs,
      aiFallbackReason: aiFallbackReason || "both providers failed",
      pipeline: pipeline,
      v5Metrics: v5Metrics,
      existingProfile: existingProfile,
      deviceProfileKey: deviceProfileKey,
      // findings/categoryStates مُحسَبتان قبل استدعاء النموذج (أعلاه) بصرف
      // النظر عن نجاحه — فشل النموذج لا يُسقطهما (P1.4، §١٤/١٥ البند ١:
      // طبقة حتمية مستقلّة تماماً عن نجاح/فشل النموذج).
      findings: findings,
      categoryStates: categoryStates,
    };
  }

  // 3. بناء النتيجة — V6 فقط من هنا فصاعداً (ميت، راجع رأس هذا الملفّ في
  // "2. تحليل AI"). فرع V7 المحلّي القديم (applyV7Adjustments+
  // buildDisplayShapeV7 يُعادان هنا محلّياً، مشروطين بـpipeline===V7_PIPELINE_TAG)
  // حُذف بالكامل — أمر مستخدم 2026-09-23 +03: "يُحذف الفرع المحلّي بما
  // فيه التطبيق الثاني للتعديلات." resolveV7Report.js تفعل هذا داخلياً
  // مرّة واحدة بالضبط الآن (راجع return أعلى هذا الملفّ) — تطبيقه هنا
  // ثانيةً كان سيُطبِّق adjustments مرّتين على نتيجة مُعدَّلة بالفعل.
  const rawDeviceModel = fingerprint.device?.model || "Unknown";
  const marketingNameRaw = (aiAnalysis?.deviceMarketingName || "").trim();
  const deviceMarketingName = marketingNameRaw || rawDeviceModel;

  // قبول grade بصيغة A/B/C/D مع +/- اختياري (مثل B+, C-) — يطابق SYSTEM_PROMPT
  // V5 prompts emit `grade` directly; V3 emits `overallGrade`. Read both.
  const VALID_GRADE_PATTERN = /^[ABCD][+-]?$/;
  const gradeFromAi = aiAnalysis?.overallGrade ?? aiAnalysis?.grade ?? null;
  // الشرط مستخرَج في متغيّر لا مكرَّر: الراية أدناه يجب أن تُشتقّ من نفس
  // المحكّ الذي يختار الدرجة، وإلا انحرفت عنه بصمت عند أي تعديل لاحق.
  const aiGradeUsable = typeof gradeFromAi === "string" &&
      VALID_GRADE_PATTERN.test(gradeFromAi.trim());
  const finalGrade = aiGradeUsable ?
      gradeFromAi.trim() :
      "C"; // fallback محايد إن AI فشل تماماً
  const scoreFromAi = aiAnalysis?.overallScore ?? aiAnalysis?.score ?? null;
  const aiScoreUsable = typeof scoreFromAi === "number";
  const finalScore = aiScoreUsable ?
      Math.max(0, Math.min(100, scoreFromAi)) :
      50; // fallback محايد

  // ─── رؤية السقوط المحايد ────────────────────────────────────────────
  //
  // السلوك أعلاه لم يتغيّر — C/50 تبقى كما هي. المتغيّر أنها صارت مرئية.
  //
  // كان السقوط يقع بلا استثناء ولا سطر سجلّ، فيُخزَّن تقرير يبدو شرعياً
  // تماماً: درجة C ونتيجة 50 وملخّص فارغ. لا شيء في المستند يميّزه عن جهاز
  // متوسّط فعلاً. هكذا مرّت حادثة الفحص 629485e9 دون أن يلاحظها أحد حتى
  // قُرئ السجلّ يدوياً — ولو لم يُقرأ لبقي التقرير الفارغ تشخيصاً معتمَداً.
  //
  // الراية ثنائية لا ثلاثية عمداً، خلافاً لنمط maxBatteryTempMismatch: هناك
  // حالة "لا ينطبق" حقيقية (إصدار أقدم من 66)، أمّا هنا فكل مرور بهذا السطر
  // يشتقّ درجةً فعلاً، فالجواب معروف دائماً. وكتابة false عند النجاح ليست
  // حشواً — بدونها يستحيل حساب معدّل السقوط، إذ لا يميّز الاستعلام بين
  // "لم يسقط" و"لم يمرّ بهذا المسار أصلاً".
  //
  // v5Metrics مضمون ككائن هنا: الفرع أعلاه ينشئه إن كان null، والفشل
  // الصلب (callAiRaw فارغ) رجع قبل الوصول إلى هنا.
  //
  // الاستعلام: where('v5Metrics.aiGradeMissing', '==', true)
  v5Metrics.aiGradeMissing = !aiGradeUsable;
  v5Metrics.aiScoreMissing = !aiScoreUsable;

  if (!aiGradeUsable || !aiScoreUsable) {
    const aiKeys = (aiAnalysis && typeof aiAnalysis === "object") ?
        Object.keys(aiAnalysis) : [];
    console.error(`[analysis] NEUTRAL FALLBACK — ` +
        `grade=${aiGradeUsable ? finalGrade : "C(missing)"} ` +
        `score=${aiScoreUsable ? finalScore : "50(missing)"} ` +
        `aiAnalysis type=${Array.isArray(aiAnalysis) ?
            "array" : typeof aiAnalysis} ` +
        `keyCount=${aiKeys.length} ` +
        `keys=${aiKeys.slice(0, 8).join(",")}` +
        `${aiKeys.length > 8 ? ",…" : ""}`);
  }

  // ─── اكتمال الاستجابة ───────────────────────────────────────────────
  //
  // النمط الأخطر عملياً، لأنه لا يبدو خطأً.
  //
  // حين يُبتر نصّ النموذج في منتصفه ينقذه jsonrepair فعلاً — لكنه ينقذ ما
  // وصل فقط. النتيجة تقرير بدرجة صحيحة وملخّص سليم، وقد فقد الأعطال ودرجات
  // الفئات ونصائح الشراء. يمرّ كل حارس، ويبدو للمستخدم طبيعياً تماماً.
  // خمسة تقارير خرجت هكذا في ثلاثين يوماً قبل هذا السطر، بلا إنذار واحد.
  //
  // القبول لم يتغيّر — التقرير المبتور صالح للاستعمال ورفضه يحرم المستخدم
  // من تشخيص حقيقي. المتغيّر أن النقص صار مرئياً ومُسمّى: نُخزّن أي المفاتيح
  // غابت لا مجرّد أنها غابت، فيُعرف هل ضاع سطر واحد أم نصف التقرير.
  //
  // ثلاثية الحالة: null لمسار V3، وهو ليس تهرّباً. مخطّط V3 لا يحتوي
  // performanceContext أصلاً ويسمّي الباقي بصيغة أخرى، فتطبيق قائمة V6
  // عليه يرفع الراية على كل استجابة V3 سليمة — إنذار كاذب دائم يُدرّب
  // القارئ على تجاهل الراية. لا نحكم حيث لا نملك المرجع.
  //
  // الاستعلام: where('v5Metrics.aiResponseIncomplete', '==', true)
  //            where('v5Metrics.aiResponseMissingKeys','array-contains','issues')
  const coreMissing = isNestedShape ? missingCoreKeys(aiAnalysis) : null;
  v5Metrics.aiResponseIncomplete =
      coreMissing === null ? null : coreMissing.length > 0;
  v5Metrics.aiResponseMissingKeys = coreMissing;

  if (coreMissing !== null && coreMissing.length > 0) {
    console.error(`[analysis] INCOMPLETE AI RESPONSE — missing ` +
        `${coreMissing.length} of ${CORE_KEY_GROUPS.length} core keys: ` +
        `${coreMissing.join(",")} ` +
        `(pipeline=${pipeline} model=${provider})`);
  }

  const aiResult = {
    grade: finalGrade,
    score: finalScore,
    deviceMarketingName: deviceMarketingName,
    deviceTier: aiAnalysis?.deviceTier || null,
    estimatedReleaseYear: aiAnalysis?.estimatedReleaseYear || null,
    summary: aiAnalysis?.summary || "",
    details: aiAnalysis?.details || "",
    verdict: aiAnalysis?.verdict || "",
    root_cause: aiAnalysis?.root_cause ?? aiAnalysis?.rootCause ?? null,
    issues: aiAnalysis?.issues || [],
    predicted_problems: aiAnalysis?.predicted_problems ?? aiAnalysis?.predictedProblems ?? [],
    buyer_advice: aiAnalysis?.buyer_advice ?? aiAnalysis?.buyerAdvice ?? null,
    category_notes: aiAnalysis?.category_notes || null,
    comparison_with_previous: aiAnalysis?.comparison_with_previous || null,
    change_analysis: aiAnalysis?.change_analysis ?? aiAnalysis?.changeAnalysis ?? null,
    overall_score_label: aiAnalysis?.overall_score_label || null,
    confidence_level: aiAnalysis?.confidence_level || null,
    confidence_note: aiAnalysis?.confidence_note || null,
    // category_scores من AI يُحفَظ مؤقتاً ليُستخدَم في rebuildCategoryScores
    // ثم يُستبدَل بنتيجة rebuild (grade من AI + pass_count/total_count من Backend)
    // V5 emits `categoryScores`; V3 emits `category_scores`. Accept both.
    category_scores: aiAnalysis?.category_scores ?? aiAnalysis?.categoryScores ?? null,
  };

  // V5/V6-specific pass-through fields (kept for analyzeDevice to forward to mobile/Firestore)
  if (pipeline === V6_PIPELINE_TAG) {
    if (aiAnalysis?.shortId) aiResult.shortId = aiAnalysis.shortId;
    if (aiAnalysis?.aiModel) aiResult.aiModelFromV5 = aiAnalysis.aiModel;
    if (aiAnalysis?.performanceContext) aiResult.performanceContext = aiAnalysis.performanceContext;
    // V6 emits a `reasoning_trace` for debug introspection. The aiResult
    // builder above is a strict allow-list, so without this line the AI's
    // chain-of-thought is silently dropped before Firestore persistence.
    if (aiAnalysis?.reasoning_trace) aiResult.reasoning_trace = aiAnalysis.reasoning_trace;
  }

  // إعادة بناء category_scores: AI يعطي grade+expected_range+verdict،
  // Backend يعدّ من functionalResults + manualResults، يشتقّ score، ويمنع
  // أي حرف يتجاوز ما تدعمه الاختبارات المنفَّذة (fix/category-grading).
  // language مطلوبة لملاحظة "لا اختبارات متاحة" في الفئات غير المقيسة.
  aiResult.category_scores = rebuildCategoryScores(
      aiResult,
      fingerprint.functionalResults || [],
      fingerprint.manualResults || [],
      {language: language || "ar"},
  );

  // Annotate when a manual test went fail→pass between scans (device likely
  // serviced). The app reads this from INSIDE change_analysis
  // (change_analysis.maintenance_suspected — snake_case primary, camelCase
  // alternate), NOT at the top level. V6 emits change_analysis: null, so create
  // the object only when it is missing/non-object/array; never overwrite an
  // existing change_analysis (preserve hasSignificantChange, changeReasons, …).
  // Does not affect the diagnosis. maintenance_note is intentionally omitted —
  // the app shows a localized default when it is absent.
  if (maintenanceSuspected) {
    const ca = aiResult.change_analysis;
    if (ca == null || typeof ca !== "object" || Array.isArray(ca)) {
      aiResult.change_analysis = {};
    }
    aiResult.change_analysis.maintenance_suspected = true;
  }

  // 4. device-profile create/append is intentionally NOT done here anymore.
  // analyzeDevice writes the profile AFTER it saves the report doc, so a
  // profile can never reference an unsaved report (fixes "reportRef not
  // found"). We return existingProfile + deviceProfileKey so the caller writes
  // it in the correct order. (runConsistencyTest passes no scanContext.scanId
  // and never triggered the old write, so this is a no-op for it.)
  return {
    aiResult: aiResult,
    aiFailed: false,
    rawDeviceModel: rawDeviceModel,
    aiModel: provider,
    duration: durationMs,
    aiDurationMs: durationMs, // backward-compat alias
    aiFallbackReason: aiFallbackReason,
    pipeline: pipeline,
    v5Metrics: v5Metrics,
    existingProfile: existingProfile,
    deviceProfileKey: deviceProfileKey,
    // findings (P1.1): كائن حتمي محسوب من العيّنات قبل استدعاء النموذج.
    // categoryStates (P1.2/P1.3، مُوصَلة الآن في P1.4): جدول الفئات الـ15
    // + الدرجة العامة بالبوّابات، محسوب من findings/functionalResults/
    // manualResults/samples البطارية — **مستقلّ تماماً عن aiAnalysis**.
    // لا يدخل أيّ منهما aiResult أدناه بعد (ذلك P1.5 — عرض الاستجابة؛
    // القيد الصريح في أمر هذه المهمّة: "لا تبدأ P1.5"). يُحمَلان هنا على
    // مستوى المستند كي لا يضيع الحساب صامتاً ولتُتاح كمُدخل حمولة V7
    // (buildV7Payload.js) حين يُفعَّل مسار الاستدعاء الحيّ الجديد
    // (callAIv7 في callAI.js — غير مُفعَّل هنا بعد، راجع تقرير المهمّة).
    findings: findings,
    categoryStates: categoryStates,
  };
}

module.exports = {
  runAnalysisInternal,
};
