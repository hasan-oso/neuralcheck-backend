"use strict";

// ===================================================
// evaluationEnabledState — قيمة evaluationEnabled التي تُعيدها joinScanSession وسببها المسمّى (V8 قبل النشر، 2026-10-09 +03)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «سطر evaluationEnabled في joinScanSession: نعم، قبل النشر. القيمة المُرجَعة، ومصدرها
// (مالك الجلسة موجود أم لا، والعلم true أم غيره)، بمعرّفات مُهشَّرة. فالقائمة تُبنى بعد التزامه.»
//
// القيمة نفسها كما كانت حرفياً: owner?.evaluationEnabled === true — أي true حين يكون العلم القيمة المنطقية true بالضبط، وfalse فيما عداه.
// ما تغيّر أن «فيما عداه» لم يعد صامتاً (القاعدة 22): مستند المالك غائب، العلم غائب، العلم false، العلم بقيمة غير منطقية — أربع حالات
// كانت كلها تُرى عند المتجر «لا شاشة تقييم» بلا أثر يفرّق بينها. وهي الآن حالات مسمّاة من هذا الملفّ وحده (القاعدة 24)، تُكتب في سطر سجلّ
// واحد لكل انضمام ناجح.
//
// الردّ إلى التطبيق لا يتغيّر: القيمة وحدها (evaluationEnabled: boolean) — السبب للسجلّ لا للردّ.

const EVALUATION_ENABLED_REASON = Object.freeze({
  OWNER_DOC_MISSING: "OWNER_DOC_MISSING", // لا مستند users/{ownerId}
  FLAG_TRUE: "FLAG_TRUE", // العلم القيمة المنطقية true (الحالة الوحيدة التي تُظهر شاشة التقييم)
  FLAG_FALSE: "FLAG_FALSE", // العلم القيمة المنطقية false
  FLAG_ABSENT: "FLAG_ABSENT", // المستند موجود بلا الحقل
  FLAG_NOT_BOOLEAN: "FLAG_NOT_BOOLEAN", // الحقل موجود بقيمة ليست منطقية (نصّ "true"، رقم 1، null، خريطة، مصفوفة)
});

/**
 * نوع القيمة بكلمة واحدة للسجلّ (لا القيمة نفسها): null وarray تُفصَلان عن object.
 * @param {*} v
 * @return {string}
 */
function valueTypeForLog(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * @param {?Object} owner وثيقة المالك (data()) أو null حين لا مستند له
 * @return {{value: boolean, reason: string, valueType: ?string}} value هي ما يُعاد إلى التطبيق؛ valueType لا يُملأ إلا مع FLAG_NOT_BOOLEAN
 */
function evaluationEnabledDecision(owner) {
  if (owner === null || owner === undefined) {
    return {value: false, reason: EVALUATION_ENABLED_REASON.OWNER_DOC_MISSING, valueType: null};
  }
  const flag = owner.evaluationEnabled;
  if (flag === undefined) {
    return {value: false, reason: EVALUATION_ENABLED_REASON.FLAG_ABSENT, valueType: null};
  }
  if (flag === true) {
    return {value: true, reason: EVALUATION_ENABLED_REASON.FLAG_TRUE, valueType: null};
  }
  if (flag === false) {
    return {value: false, reason: EVALUATION_ENABLED_REASON.FLAG_FALSE, valueType: null};
  }
  return {value: false, reason: EVALUATION_ENABLED_REASON.FLAG_NOT_BOOLEAN, valueType: valueTypeForLog(flag)};
}

module.exports = {EVALUATION_ENABLED_REASON, evaluationEnabledDecision, valueTypeForLog};
