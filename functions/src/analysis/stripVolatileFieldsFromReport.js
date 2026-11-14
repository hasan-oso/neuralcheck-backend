// ===================================================
// stripVolatileFieldsFromReport — تنظيف التقرير القديم قبل إعادة التدوير
// ===================================================
// قبل عرض تقرير قديم على المستخدم بدون استدعاء النموذج،
// نُضيف flags للواجهة لتعرف أن التقرير "مُعاد تدويره".
//
// reusedFromScanId (P0.5): معرّف الفحص الذي جاء منه هذا التقرير المُعاد،
// بلا سطر تحتي — خلافاً لـ _wasReused/_reuseTimestamp الداخليين — لأن
// الواجهة (P1.5، خارج نطاق هذا المستودع) يجب أن تعرضه صراحةً بدل ادّعاء
// أن كل فحص تحليل جديد. يُترَك غائباً (لا null) حين لا مصدر معروف، كي لا
// يُخلَط "أُعيد من فحص مجهول" بـ"لم يُعَد إطلاقاً".
function stripVolatileFieldsFromReport(oldReport, reusedFromScanId = null) {
  if (!oldReport) return null;
  const cleaned = JSON.parse(JSON.stringify(oldReport));
  cleaned._wasReused = true;
  cleaned._reuseTimestamp = Date.now();
  if (typeof reusedFromScanId === "string" && reusedFromScanId.trim() !== "") {
    cleaned.reusedFromScanId = reusedFromScanId;
  }
  return cleaned;
}

module.exports = {stripVolatileFieldsFromReport};
