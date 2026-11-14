const {admin, db} = require("../utils/admin");
const {sanitizeFailureText} = require("../utils/failureText");
const {hashIdForLog} = require("../utils/logRedaction");
const {extractMajorIssues} = require("./extractMajorIssues");
const {computeScanSignature} = require("../signatures/computeScanSignature");
const {V7_PIPELINE_TAG} = require("../analysis/pipelineTags");

// أمر مستخدم 2026-09-23 +03 (أمر التبديل، بعد A125): "الحرف من
// overall.letter، والدرجة null صريحة لا 0. والقاعدة 22: unknown و0 غيابان
// يُكتبان قيمة." aiResult.grade/aiResult.score (V6) لا وجود لهما في شكل
// V7 (buildDisplayShapeV7.display) — القراءة القديمة كانت تسقط صامتة إلى
// "unknown"/0، وهما قيمتان صريحتان تُقرآن قياساً حقيقياً بالغلط.
//
// التفرّع على aiResult.pipeline نفسه (لا على متغيّر pipeline الخارجي في
// analyzeDevice.js/runAnalysisInternal.js) — لأن مسار الكاش (signature
// match) يمرّر aiResult تقريراً قديماً مُعاد استخدامه بعينه، وpipeline
// الخارجي هناك "cached" لا يعكس شكل المحتوى الفعلي. aiResult.pipeline
// (buildDisplayShapeV7.js: display.pipeline=V7_PIPELINE_TAG دائماً) حقل
// حقيقي **داخل** المحتوى نفسه، فيبقى صحيحاً سواء كان aiResult من فحص
// طازج أو من تقرير V7 قديم أُعيد عبر الكاش. تقرير V6 قديم (لا يحمل هذا
// الحقل إطلاقاً) يسقط إلى الفرع الافتراضي — سلوكه القديم بلا أي تغيير
// (القيد الصريح: "مسار الكاش قد يمرّر تقريراً مخزَّناً من V6، وهذا يبقى
// على سلوكه القديم").
function deriveScanHistorySummaryFields(aiResult) {
  if (aiResult && aiResult.pipeline === V7_PIPELINE_TAG) {
    return {
      overallGrade: (aiResult.overall && typeof aiResult.overall.letter === "string") ?
          aiResult.overall.letter : null,
      overallScore: null, // لا مكافئ رقمي لـ"جودة" في V7 — overall.coverage تغطية لا جودة
    };
  }
  return {
    overallGrade: aiResult?.grade || aiResult?.overallGrade || "unknown",
    overallScore: aiResult?.score || 0,
  };
}

// ===================================================
// appendScanToHistory — يُضيف فحصاً جديداً لـ profile موجود
// يحتفظ بآخر 5 فحوصات فقط (FIFO)، يزيد scanCount atomically، يحدّث lastSeen.
// يستخدم runTransaction لـ read-modify-write الآمن.
// ⚠️ يرمي خطأ إن لم يوجد الـ profile — caller يجب أن يستخدم createDeviceProfile بدلاً.
// ===================================================
async function appendScanToHistory(profileId, scanId, aiResult, fingerprint) {
  // القاعدة 36: نصّ الخطأ المنقّى يُحسب خارج نداء السجلّ (حارس PII يرفض scanId خامّاً داخله)، والمعرّف معروف فيُخفى حيث ورد.
  const failText = (err) => sanitizeFailureText(err, {knownIds: [scanId]});
  if (!profileId) {
    throw new Error("profileId is required for appendScanToHistory");
  }
  if (!scanId) {
    throw new Error("scanId is required for appendScanToHistory");
  }

  const newEntry = {
    scanId: scanId,
    scanDate: admin.firestore.Timestamp.now(),
    reportRef: `reports/${scanId}`,
    summary: {
      ...deriveScanHistorySummaryFields(aiResult),
      majorIssues: extractMajorIssues(aiResult),
    },
    // V2 fix #34: signature للمقارنة الذكية لاحقاً (anti-hallucination + cost-saving)
    signature: fingerprint ? computeScanSignature(fingerprint) : null,
  };

  try {
    await db.runTransaction(async (transaction) => {
      const profileRef = db.collection("deviceProfiles").doc(profileId);
      const profileDoc = await transaction.get(profileRef);

      if (!profileDoc.exists) {
        throw new Error(`Profile ${profileId} not found in deviceProfiles`);
      }

      const currentHistory = profileDoc.data().scanHistory || [];
      // الجديد في البداية، الأقدم في النهاية، احتفظ بأحدث 5 فقط
      const updatedHistory = [newEntry, ...currentHistory].slice(0, 5);

      transaction.update(profileRef, {
        scanHistory: updatedHistory,
        "metadata.lastSeen": admin.firestore.FieldValue.serverTimestamp(),
        "metadata.scanCount": admin.firestore.FieldValue.increment(1),
      });
    });

    console.log(`[ProfileAppend] Appended scan ${hashIdForLog(scanId)} to profile ${profileId}`);
  } catch (e) {
    console.error(`[ProfileAppend] Failed for profile ${profileId}: ${failText(e)}`);
    throw e;
  }
}

module.exports = {appendScanToHistory};
