const {db} = require("../utils/admin");
const {sanitizeFailureText} = require("../utils/failureText");
const {normalizeDeviceProfileKey, describeDeviceProfileKey, UNKNOWN_PRIMARY} = require("./deviceProfileKey");

// ===================================================
// findDeviceProfile — بحث ذكي متعدّد الطبقات في deviceProfiles
// يحاول primary أولاً، ثم Layer A → B → C → D+E عند الفشل.
// السبب: الطبقات قد تتغيّر بشكل مستقل (Factory Reset، uninstall،
// ترقية OS)، فإن تغيّرت طبقة، الباقي يطابق وما زلنا نتعرّف على الجهاز.
// المخرج: {profileId, data, matchedBy} أو null إن لم يُعثَر.
// ===================================================
async function findDeviceProfile(deviceProfileKey) {
  // Mobile sends deviceProfileKey as {a, b, c, d, e, f} (release, R8) or with the full names (debug / the app
  // after keep|@SerializedName): V8 pre-deploy (2026-10-09, user decision) — one normalizer reads both
  // (deviceProfileKey.js: names, mapping source, the conflict decision). The R8 names are R8's, not a rename:
  // أمر مستخدم 2026-09-23 +03 (تصحيح، مسألة deviceProfileKey — NEURALCHECK-FINDINGS.md 2026-09-23). Before this,
  // only .a was read here and the layers by their full names, so a release payload's layers were never read.
  const normalized = normalizeDeviceProfileKey(deviceProfileKey);
  console.log(`[ProfileLookup] deviceProfileKey ${describeDeviceProfileKey(normalized)}`);
  if (!normalized.usable) {
    console.log("[ProfileLookup] Skipping lookup: unusable deviceProfileKey");
    return null;
  }
  const key = normalized.key;
  const primary = key.primary;
  if (primary === UNKNOWN_PRIMARY) {
    console.log("[ProfileLookup] Skipping lookup: fallback primary");
    return null;
  }

  // Stage 1: Primary lookup (الأسرع، الأكثر دقة)
  try {
    const docByPrimary = await db.collection("deviceProfiles").doc(primary).get();
    if (docByPrimary.exists) {
      console.log(`[ProfileLookup] Found by primary: ${primary}`);
      return {
        profileId: primary,
        data: docByPrimary.data(),
        matchedBy: "primary",
      };
    }
  } catch (e) {
    console.error(`[ProfileLookup] Primary lookup failed: ${sanitizeFailureText(e)}`);
  }

  // Stages 2-4: Layer-by-layer fallback (A=KeyStore, B=FID, C=AndroidID)
  const stages = [
    {field: "layerA_keystore", value: key.layerA_keystore, sentinel: "no_keystore"},
    {field: "layerB_firebaseId", value: key.layerB_firebaseId, sentinel: "no_fid"},
    {field: "layerC_androidId", value: key.layerC_androidId, sentinel: "no_android_id"},
  ];

  for (const stage of stages) {
    if (!stage.value || stage.value === stage.sentinel) continue;
    try {
      const snap = await db.collection("deviceProfiles")
          .where(stage.field, "==", stage.value)
          .limit(1)
          .get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        console.log(`[ProfileLookup] Found by ${stage.field}: ${doc.id}`);
        return {
          profileId: doc.id,
          data: doc.data(),
          matchedBy: stage.field,
        };
      }
    } catch (e) {
      console.error(`[ProfileLookup] ${stage.field} lookup failed: ${sanitizeFailureText(e)}`);
    }
  }

  // Stage 5: Layer D + E composite (الأضعف، آخر محاولة)
  // Firestore لا يدعم composite where بدون index — نفلتر يدوياً على نتائج layerD
  const layerD = key.layerD_buildSig;
  const layerE = key.layerE_sensorSig;
  if (layerD && layerD !== "unknown" && layerE && layerE !== "no_sensors") {
    try {
      const snap = await db.collection("deviceProfiles")
          .where("layerD_buildSig", "==", layerD)
          .limit(10)
          .get();
      for (const doc of snap.docs) {
        if (doc.data().layerE_sensorSig === layerE) {
          console.log(`[ProfileLookup] Found by layerD+E: ${doc.id}`);
          return {
            profileId: doc.id,
            data: doc.data(),
            matchedBy: "layerD+E",
          };
        }
      }
    } catch (e) {
      console.error(`[ProfileLookup] layerD+E lookup failed: ${sanitizeFailureText(e)}`);
    }
  }

  console.log(`[ProfileLookup] No profile found for primary ${primary}`);
  return null;
}

module.exports = {findDeviceProfile};
