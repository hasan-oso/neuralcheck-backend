const {admin, db} = require("../utils/admin");
const {sanitizeFailureText} = require("../utils/failureText");
const {hashIdForLog} = require("../utils/logRedaction");
const {extractMajorIssues} = require("./extractMajorIssues");
const {computeScanSignature} = require("../signatures/computeScanSignature");
const {V7_PIPELINE_TAG} = require("../analysis/pipelineTags");
const {normalizeDeviceProfileKey, describeDeviceProfileKey, UNKNOWN_PRIMARY} = require("./deviceProfileKey");

// أمر مستخدم 2026-09-23 +03 (أمر التبديل) — راجع نفس الدالّة والتعليق
// الكامل في appendScanToHistory.js (مصدر واحد لمبدأ الاشتقاق، القاعدة 24
// من حيث المبدأ — الدالّتان منفصلتان لأن الملفّين كانا منفصلين أصلاً ولا
// وحدة مشتركة بينهما بعد).
function deriveScanHistorySummaryFields(aiResult) {
  if (aiResult && aiResult.pipeline === V7_PIPELINE_TAG) {
    return {
      overallGrade: (aiResult.overall && typeof aiResult.overall.letter === "string") ?
          aiResult.overall.letter : null,
      overallScore: null,
    };
  }
  return {
    overallGrade: aiResult?.grade || aiResult?.overallGrade || "unknown",
    overallScore: aiResult?.score || 0,
  };
}

// ===================================================
// createDeviceProfile — ينشئ profile جديد لجهاز يُفحَص للمرّة الأولى
// يُستدعى من analyzeDevice (في المرحلة 4) عندما findDeviceProfile يُرجع null.
// document ID = the primary (SHA-256 primary hash; لـ lookup سريع لاحقاً) — يُقرأ من الشكلين (a أو primary).
// المخرج: profileId (string).
// ===================================================
// Note: mobile sends deviceProfileKey as {a, b, c, d, e, f} (release, R8) or with the full names (debug / after the
// app pins them) — V8 pre-deploy (2026-10-09, user decision): deviceProfileKey.js reads both (names, mapping source,
// the conflict decision). أمر مستخدم 2026-09-23 +03 (تصحيح، مسألة deviceProfileKey — NEURALCHECK-FINDINGS.md
// 2026-09-23): `.a` ليس إعادة تسمية ترحيلية لحقل `.primary` قديم — هو اسم وضعه R8 عند البناء. The doc-side field
// `primaryFingerprint` keeps its stable name regardless of the input key names. What changes in the written
// document: the five layers are the REAL values when the payload carries them (before: a release payload's layers
// were never read, so all five were the guard values). A layer the payload does not carry still gets the guard
// value as before — but the absence is named in the log line (describeDeviceProfileKey), not silent.
async function createDeviceProfile(deviceProfileKey, scanId, aiResult, deviceMetadata, fingerprint) {
  const normalized = normalizeDeviceProfileKey(deviceProfileKey);
  if (!normalized.usable || normalized.key.primary === UNKNOWN_PRIMARY) {
    const why = normalized.usable ? `primary is ${UNKNOWN_PRIMARY}` : describeDeviceProfileKey(normalized);
    console.error(`[ProfileCreate] Cannot create profile: ${why}`);
    throw new Error(`Invalid deviceProfileKey: ${why}`);
  }
  if (!scanId) {
    throw new Error("scanId is required for createDeviceProfile");
  }
  const key = normalized.key;
  if (normalized.missing.length > 0 || normalized.invalid.length > 0) {
    console.warn(`[ProfileCreate] deviceProfileKey ${describeDeviceProfileKey(normalized)} — guard values written for those layers`);
  }

  const profileId = key.primary;

  const profileDoc = {
    primaryFingerprint: profileId,
    layerA_keystore: key.layerA_keystore || "no_keystore",
    layerB_firebaseId: key.layerB_firebaseId || "no_fid",
    layerC_androidId: key.layerC_androidId || "no_android_id",
    layerD_buildSig: key.layerD_buildSig || "unknown",
    layerE_sensorSig: key.layerE_sensorSig || "no_sensors",

    metadata: {
      firstSeen: admin.firestore.FieldValue.serverTimestamp(),
      lastSeen: admin.firestore.FieldValue.serverTimestamp(),
      scanCount: 1,
      deviceModel: deviceMetadata?.deviceModel || "unknown",
      socModel: deviceMetadata?.socModel || "unknown",
    },

    // scanHistory: لا rawFingerprint كاملاً — مرجع + ملخص + signature (التفاصيل في reports/)
    // ملاحظة: serverTimestamp() لا يعمل داخل arrays، لذا Timestamp.now() هنا
    scanHistory: [{
      scanId: scanId,
      scanDate: admin.firestore.Timestamp.now(),
      reportRef: `reports/${scanId}`,
      summary: {
        ...deriveScanHistorySummaryFields(aiResult),
        majorIssues: extractMajorIssues(aiResult),
      },
      // V2 fix #34: signature للمقارنة الذكية لاحقاً (anti-hallucination + cost-saving)
      signature: fingerprint ? computeScanSignature(fingerprint) : null,
    }],

    // flags: للاستخدام المستقبلي (المرحلة 6 — كشف الاحتيال)
    flags: {
      multipleVendorsScanned: false,
      suspiciousPatterns: [],
      lastSignificantChange: null,
    },
  };

  try {
    await db.collection("deviceProfiles").doc(profileId).set(profileDoc);
    console.log(`[ProfileCreate] Created profile ${profileId} for scan ${hashIdForLog(scanId)}`);
    return profileId;
  } catch (e) {
    console.error(`[ProfileCreate] Failed to create profile ${profileId}: ${sanitizeFailureText(e)}`);
    throw e;
  }
}

module.exports = {createDeviceProfile};
