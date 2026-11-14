// ===================================================
// footerIntegrity — فحوص حتمية على تذييل الفحص
// ===================================================
// ما لا يصلح للبرومبت يُفحَص هنا.
//
// البرومبت يصف للنموذج كيف يقرأ الحقول، وهو المكان الصحيح لكل ما هو
// استدلالي. لكن "هل يتناقض حقلان يجب أن يتطابقا؟" سؤال حتمي لا رأي فيه،
// وتركه للنموذج يعني أن يُكتشف التناقض أحياناً ويُغفَل أحياناً — والأسوأ
// أن يُذكر في نصّ التقرير بدل أن يُرصَد كبيانات قابلة للاستعلام.
//
// النمط مأخوذ من linkageIncomplete: راية ثلاثية الحالة + سجلّ صريح +
// تخزين في مكان قابل للاستعلام (هنا v5Metrics، الذي يحفظه analyzeDevice
// كما هو دون تعديل).

// الإصدار الذي صار عنده maxBatteryTemp هو الأقصى الحقيقي.
const TRUE_MAX_BATTERY_TEMP_SINCE = 66;

// تسامح المقارنة بالدرجة المئوية.
//
// عند 66 فأعلى يُفترض أن يحمل الحقلان القيمة نفسها، فأي فرق حقيقي يعني
// أن أحدهما لم يُحدَّث. 0.5°C تبتلع اختلاف التقريب بين مسارَي حساب
// (الحرارة تُقاس بعُشر الدرجة) ولا تبتلع نمط الخلل الفعلي: دلالة ≤65
// المتسرّبة تعني حرارة نهاية بعد تبريد، وهي أدنى من الذروة بدرجات لا
// بأعشارها.
const MAX_BATTERY_TEMP_TOLERANCE_C = 0.5;

// أقصى نسبة ممكنة. ما فوقها ليس نسبة أصلاً.
const MAX_STORAGE_PERCENT = 100;

/**
 * @param {*} v القيمة
 * @return {number|null} عدد منتهٍ أو null
 */
function num(v) {
  return (typeof v === "number" && isFinite(v)) ? v : null;
}

/**
 * يفحص اتّساق التذييل ويستخرج إصدار الحقول.
 *
 * maxBatteryTempMismatch ثلاثية الحالة عمداً:
 *   true  — الحقلان يجب أن يتطابقا (66+) ولا يتطابقان → خلل حقيقي
 *   false — تطابقا ضمن التسامح
 *   null  — الفحص لا ينطبق: الإصدار أقل من 66 (التباعد متوقَّع لأن
 *           maxBatteryTemp كان حرارة النهاية)، أو الإصدار غائب، أو أحد
 *           الحقلين غير متاح. لا نُطلق إنذاراً على ما لا نستطيع الحكم فيه.
 *
 * ─── فحصا التخزين (fieldsVersion 67) ────────────────────────────────
 *
 * حقلان غيّرا دلالتهما عند 67 مع بقاء الاسم والنوع، فلا شيء يُخطئ في المسار:
 * سرعة كتابة 635 من بناء ≤66 تُقرأ ببساطة "635% مساحة حرّة".
 *
 * الفحصان هنا **حتميان ولا يشترطان الإصدار** — عمداً. الاشتراط يُفقدهما
 * قيمتهما بالضبط حيث نحتاجهما: صفٌّ بلا fieldsVersion هو الصفّ الذي لا نعرف
 * دلالته، فيجب أن يُفحَص لا أن يُعفى. وهما فحصا استحالة لا فحصا إصدار: نسبة
 * فوق 100 مستحيلة، ومساحة حرّة تتجاوز الإجمالي مستحيلة — أياً كان الإصدار.
 *
 * حدّ التغطية (مهمّ): الفحصان يكشفان المستحيل لا الخاطئ.
 *   • storagePercent: يكشف كل سرعة > 100 MB/s (والقيمتان المرصودتان 635 و166
 *     مكشوفتان). لكن سرعة 85 MB/s تمرّ كنسبة 85% صالحة ظاهرياً.
 *   • availableStorageGb: يكشف النسبة فقط حين تتجاوز سعة الجهاز — أي على
 *     أجهزة التخزين الصغير. القيمة المرصودة 67.5 على جهاز سعته 220.9 GB
 *     **لا تُكشَف**، لأن 67.5 ≤ 220.9 وهي قيمة ممكنة تماماً.
 * فرع الإصدار في البرومبت هو ما يغطّي هذه الفجوة، والرايتان حزام فوق حمّالة.
 *
 * @param {Object} footer تذييل السلسلة الزمنية
 * @param {Object} [device] كتلة rawFingerprint.device (لفحصي التخزين)
 * @return {{fieldsVersion: number|null, maxBatteryTempMismatch: boolean|null,
 *   maxBatteryTempDeltaC: number|null, storagePercentInvalid: boolean|null,
 *   availableStorageGbInvalid: boolean|null}}
 */
function checkFooterIntegrity(footer, device) {
  const f = footer || {};
  const d = device || {};
  const fieldsVersion = num(f.fieldsVersion);

  const maxBatteryTemp = num(f.maxBatteryTemp);
  const batteryTempMaxC = num((f.batteryHealth || {}).batteryTempMaxC);

  let maxBatteryTempMismatch = null;
  let maxBatteryTempDeltaC = null;

  if (fieldsVersion !== null && fieldsVersion >= TRUE_MAX_BATTERY_TEMP_SINCE &&
      maxBatteryTemp !== null && batteryTempMaxC !== null) {
    maxBatteryTempDeltaC =
        Math.round((maxBatteryTemp - batteryTempMaxC) * 100) / 100;
    maxBatteryTempMismatch =
        Math.abs(maxBatteryTempDeltaC) > MAX_BATTERY_TEMP_TOLERANCE_C;
  }

  // نسبة فوق 100 ليست نسبة. القيمة عندئذٍ سرعة كتابة من بناء ≤66.
  const storagePercent = num(d.storagePercent);
  const storagePercentInvalid = storagePercent === null ?
      null :
      storagePercent > MAX_STORAGE_PERCENT;

  // مساحة حرّة تتجاوز سعة الجهاز مستحيلة. القيمة عندئذٍ نسبة مئوية تحمل
  // تسمية جيجابايت. يلزم إجمالي موجب وإلا فلا مرجع للمقارنة.
  const availableStorageGb = num(d.availableStorageGb);
  const totalStorageGb = num(d.totalStorageGb);
  const availableStorageGbInvalid =
      (availableStorageGb === null || totalStorageGb === null ||
       totalStorageGb <= 0) ?
          null :
          availableStorageGb > totalStorageGb;

  return {
    fieldsVersion,
    maxBatteryTempMismatch,
    maxBatteryTempDeltaC,
    storagePercentInvalid,
    availableStorageGbInvalid,
  };
}

module.exports = {
  checkFooterIntegrity,
  TRUE_MAX_BATTERY_TEMP_SINCE,
  MAX_BATTERY_TEMP_TOLERANCE_C,
  MAX_STORAGE_PERCENT,
};
