"use strict";

// ===================================================
// protocolSettings — قراءة إعدادات البروتوكول `protocolSettings/current` بحالات صريحة (S-P6-07، 2026-10-21 +03؛ يكمله S-P6-14)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:767-793) وdocs/PROTOCOL_CONTRACT.md §٢ A10: «`protocolSettings/current`، تكتبه دالّة مشرف `setProtocolSettings`: تتحقّق من المدى، وترفع `version`، وتحفظ النسخة السابقة
// في `history`. فكل فحص يذكر `settingsVersion` الذي حُسب به.» و«الحقول المقترحة (القيم الافتراضية اقتراح للعرض، لا للكود)» — **فلا قيمة افتراضية في الكود** (القاعدة 22): كل ما غاب في المستند غائب بحالة مسمّاة.
// و«إعدادات غائبة (لم تُكتب بعد) ⇐ SETTINGS_ABSENT. والخادم لا يختار تكراراً ولا تقييماً مزدوجاً حينها، ويكتب السبب. لا يُفترض 10%.» (P:893).
//
// لماذا هذا الملفّ في أمر S-P6-07 لا S-P6-14: اختيار التكرار يقرأ نسبته وعلَم مرحلة الجمع من هذا المستند، فالقارئ يسبق الكاتب بحكم التبعية. هذا الملفّ **القراءة وحدها** (دوالّ نقيّة ما عدا readProtocolSettings)؛
// والكتابة المحروسة (setProtocolSettings) وفحص المدى لكل حقل وتاريخ النسخ في S-P6-14 (`settingsWrite.js`)، وتستعمل أسماء الحقول من هنا (مصدر واحد: القاعدة 24؛ أسماء الحقول لا تُصدَّر من protocolVocabulary.js: E36).
//
// ما تقرّره هذه الوحدة:
//   (١) المستند «حاضر» إن كان كائناً و`version` فيه عدداً صحيحاً موجباً (الكاتب يضعه دائماً: يبدأ بـ1 ويزيد 1). غائب أو بلا version صالح ⟵ ABSENT (حالة SETTINGS_ABSENT)؛ والمستند الموجود بلا version صالح
//       (لا يقع إلا بكتابة يدوية من وحدة التحكّم: القاعدة الشاملة تسمح للمشرف) يُقرأ غائباً ويُعلَن شذوذه `anomaly` ليطبعه المستدعي بسطر مسمّى — لا يُقرأ حاضراً بلا نسخة ولا يُسكَت عنه.
//   (٢) نسبة (repeatRate · doubleEvalRate): عدد منتهٍ في [0, 1] (احتمال). غير ذلك ⟵ INVALID، والغائب ⟵ ABSENT (حالتان مسمّاتان لا يُدمجان: القاعدة 21 تميّز بالحالة لا بنوع الاستثناء).
//       **المدى [0, 1] حدّ تقني اخترتُه أنا** (التصميم لا يسمّي مدى للتحقّق: «تتحقّق من المدى» P:770 بلا أرقام؛ ومدى القرار ٣ «25–30% ثم 5–10%» ليس حدّاً للكود: «القيم الافتراضية اقتراح للعرض، لا للكود» P:773)؛ النسبة احتمال فلا معنى لما خارجه.
//   (٣) collectionPhase: القيمة المنطقية `true`/`false` وحدها؛ غير ذلك INVALID، والغائب ABSENT (لا يُقرأ الغياب إعفاءً من الخصم: الإعفاء لا يقوم إلا على `true` صريحة).

const {PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH, PROTOCOL_ABSENCE_STATE} = require("./protocolVocabulary");

/** أسماء حقول مستند الإعدادات (A10، P:777-785) — حرفيّات هنا وحدها (E36)؛ يستوردها قارئ الاختيار وكاتب الإعدادات (S-P6-14). */
const SETTINGS_FIELD = Object.freeze({
  REPEAT_RATE: "repeatRate",
  DOUBLE_EVAL_RATE: "doubleEvalRate",
  OPEN_BEFORE_VALIDITY_HOURS: "openBeforeValidityHours",
  COLLECTION_PHASE: "collectionPhase",
  BLINDNESS_ALERT_BELOW_PCT: "blindnessAlertBelowPct",
  RETURN_REASONS: "returnReasons",
  SYMPTOM_CHIPS: "symptomChips",
  TARGETS: "targets",
  MIN_APP_VERSION: "minAppVersion",
});

/** حالة المستند كلّه. */
const SETTINGS_STATE = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
});

/** شذوذ مسمّى لمستند موجود لا يصلح (يُطبَع ولا يُكتب). */
const SETTINGS_ANOMALY = Object.freeze({
  VERSION_UNUSABLE: "VERSION_UNUSABLE", // كائن بلا version عدد صحيح موجب
});

/** حالة قراءة حقل واحد. */
const FIELD_STATE = Object.freeze({
  SET: "SET",
  ABSENT: "ABSENT",
  INVALID: "INVALID",
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * يحوّل بيانات المستند إلى قراءة بحالة صريحة.
 * @param {*} data بيانات protocolSettings/current أو null/undefined إن لم يوجد المستند
 * @return {{state: string, version: ?number, data: ?Object, anomaly: ?string}}
 */
function readSettingsDocument(data) {
  if (data === null || data === undefined) return {state: SETTINGS_STATE.ABSENT, version: null, data: null, anomaly: null};
  if (!isObj(data) || !Number.isInteger(data.version) || data.version < 1) {
    return {state: SETTINGS_STATE.ABSENT, version: null, data: null, anomaly: SETTINGS_ANOMALY.VERSION_UNUSABLE};
  }
  return {state: SETTINGS_STATE.PRESENT, version: data.version, data, anomaly: null};
}

/**
 * نسبة (احتمال) من الإعدادات.
 * @param {{state: string, data: ?Object}} settings ناتج readSettingsDocument (حاضر)
 * @param {string} field من SETTINGS_FIELD
 * @return {{state: string, value: ?number}}
 */
function readRateField(settings, field) {
  const v = settings.state === SETTINGS_STATE.PRESENT ? settings.data[field] : undefined;
  if (v === undefined || v === null) return {state: FIELD_STATE.ABSENT, value: null};
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) return {state: FIELD_STATE.INVALID, value: null};
  return {state: FIELD_STATE.SET, value: v};
}

/**
 * علَم مرحلة الجمع (P:780، «ينتهي بقرار المستخدم»): منطقي صريح وحده.
 * @param {{state: string, data: ?Object}} settings
 * @return {{state: string, value: ?boolean}}
 */
function readCollectionPhase(settings) {
  const v = settings.state === SETTINGS_STATE.PRESENT ? settings.data[SETTINGS_FIELD.COLLECTION_PHASE] : undefined;
  if (v === undefined || v === null) return {state: FIELD_STATE.ABSENT, value: null};
  if (typeof v !== "boolean") return {state: FIELD_STATE.INVALID, value: null};
  return {state: FIELD_STATE.SET, value: v};
}

/**
 * ما يُكتب في `settingsVersion` (scanProtocol وrepeat وdoubleEvalDraw): رقم النسخة، أو SETTINGS_ABSENT حين لا مستند صالح.
 * @param {{state: string, version: ?number}} settings
 * @return {number|string}
 */
function settingsVersionOf(settings) {
  return settings.state === SETTINGS_STATE.PRESENT ? settings.version : PROTOCOL_ABSENCE_STATE.SETTINGS_ABSENT;
}

/**
 * يقرأ protocolSettings/current بمعرّف المستند (بلا استعلام ولا فهرس: القاعدة 43).
 * @param {{db: Object}} p
 * @return {Promise<{state: string, version: ?number, data: ?Object, anomaly: ?string}>}
 */
async function readProtocolSettings({db}) {
  const snap = await db.collection(PROTOCOL_COLLECTION.PROTOCOL_SETTINGS).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC).get();
  return readSettingsDocument(snap.exists ? snap.data() : null);
}

module.exports = {
  SETTINGS_FIELD, SETTINGS_STATE, SETTINGS_ANOMALY, FIELD_STATE,
  readSettingsDocument, readRateField, readCollectionPhase, settingsVersionOf, readProtocolSettings,
};
