"use strict";

// ===================================================
// consentPartState — هل جزء الموافقة (`protocolParts.consent`) مفعَّل لمحلّ مالك الجلسة؟ قرار واحد وسببه المسمّى (ق15 وق40، 2026-10-23)
// ===================================================
//
// قرار حسن 2026-10-22 (ق15، منقول من ورقة القرارات DECISIONS-FOR-HASAN-2026-10-21.md، غير متحقَّق من مصدره عندي إلا بالقراءة): «جزء `consent` للمحلّ يتحكّم بظهور شاشة الموافقة، والخادم يرفض التسجيل لمحلّ بلا الجزء».
// فللجهاز المفحوص (المنضمّ) حاجة لم تكن مغطّاة: أن يعرف **قبل** عرض الشاشة هل الجزء مفعَّل، والمعلومة كانت عند تطبيق المالك وحده (`protocolParts` من createScanSession). فتُضاف إلى ردّ joinScanSession
// قيمة `consentEnabled` على نمط `evaluationEnabled` (evaluationEnabledState.js): مستند المالك مقروء أصلاً هناك فلا قراءة إضافية، والقيمة منطقية دائماً على السلك، والغياب يُعلَن بسببه المسمّى في سطر السجلّ (القاعدة 22).
//
// **مصدر واحد للحكم (القاعدة 24):** هذا الملفّ يحكم لـ(١) ردّ الانضمام `consentEnabled` و(٢) رفض recordScanConsent لمحلّ بلا الجزء (CONSENT_PART_NOT_ENABLED، ق40) — فالحقل الذي يراه الجهاز هو بالضبط ما سيحكم به الخادم.
// القيمة = `readProtocolParts(owner).consent === true` (`=== true` وحدها تفعّل: الغائب و`false` و`"true"` نصّاً و`1` رقماً و`null` ومصفوفة وكائن ⟵ غير مفعَّل)؛ ما تضيفه الدالّة هو **السبب** (حالات مسمّاة)، لا قيمة جديدة.
//
// الردّ إلى التطبيق: القيمة وحدها (consentEnabled: boolean) — السبب للسجلّ لا للردّ.

const {PROTOCOL_PART} = require("../protocol/protocolVocabulary");
const {readProtocolParts} = require("../protocol/scanProtocolDocument");
const {valueTypeForLog} = require("./evaluationEnabledState");

const CONSENT_PART_REASON = Object.freeze({
  OWNER_DOC_MISSING: "OWNER_DOC_MISSING", // لا مستند users/{ownerId} (أو ليس كائناً)
  PARTS_ABSENT: "PARTS_ABSENT", // المستند موجود بلا مفتاح protocolParts
  PARTS_NOT_OBJECT: "PARTS_NOT_OBJECT", // protocolParts موجود وليس كائناً (null، نصّ، مصفوفة، رقم)
  PART_ABSENT: "PART_ABSENT", // protocolParts كائن بلا مفتاح consent
  PART_TRUE: "PART_TRUE", // consent القيمة المنطقية true (الحالة الوحيدة المفعَّلة)
  PART_FALSE: "PART_FALSE", // consent القيمة المنطقية false
  PART_NOT_BOOLEAN: "PART_NOT_BOOLEAN", // consent موجود بقيمة ليست منطقية (نصّ "true"، رقم 1، null، خريطة، مصفوفة)
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @param {?Object} owner مستند المالك (data()) أو null حين لا مستند له
 * @return {{value: boolean, reason: string, valueType: ?string}} value هي ما يُعاد إلى التطبيق وما يحكم به recordScanConsent؛ valueType لا يُملأ إلا مع PART_NOT_BOOLEAN
 */
function consentPartDecision(owner) {
  const value = readProtocolParts(owner)[PROTOCOL_PART.CONSENT] === true;
  if (!isObj(owner)) return {value, reason: CONSENT_PART_REASON.OWNER_DOC_MISSING, valueType: null};
  if (owner.protocolParts === undefined) return {value, reason: CONSENT_PART_REASON.PARTS_ABSENT, valueType: null};
  if (!isObj(owner.protocolParts)) return {value, reason: CONSENT_PART_REASON.PARTS_NOT_OBJECT, valueType: null};
  const flag = owner.protocolParts[PROTOCOL_PART.CONSENT];
  if (flag === undefined) return {value, reason: CONSENT_PART_REASON.PART_ABSENT, valueType: null};
  if (flag === true) return {value, reason: CONSENT_PART_REASON.PART_TRUE, valueType: null};
  if (flag === false) return {value, reason: CONSENT_PART_REASON.PART_FALSE, valueType: null};
  return {value, reason: CONSENT_PART_REASON.PART_NOT_BOOLEAN, valueType: valueTypeForLog(flag)};
}

module.exports = {CONSENT_PART_REASON, consentPartDecision};
