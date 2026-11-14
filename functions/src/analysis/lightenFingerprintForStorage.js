// ===================================================
// lightenFingerprintForStorage — يزيل timeSeries.samples قبل الحفظ في Firestore
// (الحد الصلب لوثيقة Firestore = 1MB. السامبلز تُرفَع منفصلةً في
//  Storage عبر التطبيق إلى scans/{deviceFingerprint}/{scanId}.ts.json.gz.)
//  (سيُضاف timeSeriesStorageUrl في المرحلة 2 مع deviceProfileKey.)
// ===================================================
function lightenFingerprintForStorage(fingerprint) {
  if (!fingerprint?.timeSeries) return fingerprint;
  const ts = fingerprint.timeSeries;
  const samplesCount = Array.isArray(ts.samples) ? ts.samples.length : 0;
  const lightTimeSeries = {...ts};
  delete lightTimeSeries.samples;
  lightTimeSeries.samplesCount = samplesCount;
  return {...fingerprint, timeSeries: lightTimeSeries};
}

module.exports = {lightenFingerprintForStorage};
