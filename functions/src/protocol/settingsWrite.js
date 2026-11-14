"use strict";

// ===================================================
// settingsWrite — التحقّق من تعديل إعدادات البروتوكول ودمجه (S-P6-14، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:767-793) وdocs/PROTOCOL_CONTRACT.md §٢ A10: «`protocolSettings/current`، تكتبه دالّة مشرف `setProtocolSettings`: تتحقّق من المدى، وترفع `version`،
// وتحفظ النسخة السابقة في `history`. فكل فحص يذكر `settingsVersion` الذي حُسب به.» **دوالّ نقيّة بلا I/O** (القاعدة 41)؛ الكتابة (معاملة + history) في admin/protocolSettingsAdmin.js.
//
// **لا قيمة افتراضية في الكود** (P:773: «القيم الافتراضية اقتراح للعرض، لا للكود»؛ القاعدة 22): التعديل **رقعة** (patch) على الحاضر، لا حقل إلزامي، وما لم يُكتب يبقى غائباً بحالته (قارئ الإعدادات يعلنه ABSENT).
// أسماء الحقول من protocolSettings.js (SETTINGS_FIELD: مصدر واحد: القاعدة 24).
//
// ─── مدى كل حقل (حدود تقنية **اخترتُها أنا**: «تتحقّق من المدى» P:770 بلا أرقام، والقيم المقترحة للعرض لا للكود) ──────────────────────────────────────────────────────────────────────
//   repeatRate · doubleEvalRate     عدد منتهٍ في [0, 1] (احتمال).
//   openBeforeValidityHours         عدد صحيح في [1, 8760] (ساعة إلى سنة). المقترح للعرض 168 (سبعة أيام ✓ س١٣) ليس حدّاً.
//   collectionPhase                 منطقي.
//   blindnessAlertBelowPct          عدد منتهٍ في [0, 100] (نسبة مئوية؛ المقترح 80 ✓ س٧).
//   returnReasons                   مصفوفة ≤ 50 عنصراً {key, ar, tr, active}: key نصّ ^[a-z][a-z0-9_]{0,39}$ فريد؛ ar وtr نصّان غير فارغَين ≤ 120 حرفاً؛ active منطقي؛ لا مفتاح آخر. **«المفتاح لا يُعدَّل بعد استعماله،
//                                   والإيقاف بدل الحذف» (P:782): يُفسَّر «بعد استعماله» بـ«بعد حفظه»** (لا مرتجعات بعد: P6-06 بعد التسليم) فكل مفتاح محفوظ يبقى في كل نسخة لاحقة (يُوقَف ولا يُحذف)، ونصّاه ar وtr يُعدَّلان.
//                                   النصّان يدخلهما المستخدم نفسه (ليسا نصّاً من الوكيل). غياب القائمة = الجزء `returns` غير مفعَّل (E17).
//   minAppVersion                   نصّ ≤ 32 حرفاً يطابق ^\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$ (صيغة الإصدارات القائمة: 1.0.14 · 1.0.8-v6beta).
//   **symptomChips وtargets: معلّقان — مواصفة غائبة:** «`symptomChips[]` | ≤ 12 | القرار ١» و«`targets` | أهداف القرار ١٤ | القرار ١٤» (P:783-784): لا يسمّي التصميم دلالة القائمة الأولى (ترتيب مفاتيح SYMPTOM؟ تفعيل؟ نصوص؟)
//                                   ولا أسماء مفاتيح الثانية (الأهداف الستّة: P:817 أعداد بلا أسماء حقول). **يُرفضان برفض مسمّى** (SETTINGS_FIELD_NOT_SPECIFIED) ولا يُخزَّنان بدلالة مختلَقة.
//
// لا مسح لحقل ولا حذف (القاعدة 42): قيمة null أو undefined في الرقعة **مرفوضة** (لا طريق لمسح حقل: يُغيَّر ولا يُمحى).

const {SETTINGS_FIELD} = require("./protocolSettings");

/** حدود الحقول — تُعاد في ردّ getProtocolSettings كي لا تكرّرها الواجهة (على نسق getAiConfig: «تبقى الأسماء والحدود تعريفاً واحداً في الخادم»). */
const SETTINGS_LIMITS = Object.freeze({
  rate: Object.freeze({min: 0, max: 1}),
  openBeforeValidityHours: Object.freeze({min: 1, max: 8760, integer: true}),
  blindnessAlertBelowPct: Object.freeze({min: 0, max: 100}),
  returnReasons: Object.freeze({maxEntries: 50, keyPattern: "^[a-z][a-z0-9_]{0,39}$", textMaxLength: 120}),
  minAppVersion: Object.freeze({maxLength: 32, pattern: "^\\d+(\\.\\d+){1,3}([-+][0-9A-Za-z.-]+)?$"}),
});
const RETURN_REASON_KEY_RE = new RegExp(SETTINGS_LIMITS.returnReasons.keyPattern);
const MIN_APP_VERSION_RE = new RegExp(SETTINGS_LIMITS.minAppVersion.pattern);

/** الحقول المعلّقة (مواصفة غائبة): تُرفض. */
const SETTINGS_FIELDS_NOT_SPECIFIED = Object.freeze([SETTINGS_FIELD.SYMPTOM_CHIPS, SETTINGS_FIELD.TARGETS]);
/** الحقول المقبولة للكتابة، بترتيب التحقّق. */
const SETTINGS_WRITABLE_FIELDS = Object.freeze([
  SETTINGS_FIELD.REPEAT_RATE, SETTINGS_FIELD.DOUBLE_EVAL_RATE, SETTINGS_FIELD.OPEN_BEFORE_VALIDITY_HOURS, SETTINGS_FIELD.COLLECTION_PHASE,
  SETTINGS_FIELD.BLINDNESS_ALERT_BELOW_PCT, SETTINGS_FIELD.RETURN_REASONS, SETTINGS_FIELD.MIN_APP_VERSION,
]);

/** رموز رفض setProtocolSettings (اقتراحي: لا رمز معتمداً لها؛ الاسم الوحيد من التصميم هو الدالّة). */
const SETTINGS_WRITE_REFUSAL = Object.freeze({
  PATCH_REQUIRED: "SETTINGS_PATCH_REQUIRED", // settings غائب أو ليس كائناً أو فارغاً
  FIELD_UNKNOWN: "SETTINGS_FIELD_UNKNOWN", // مفتاح لا يعرفه العقد
  FIELD_NOT_SPECIFIED: "SETTINGS_FIELD_NOT_SPECIFIED", // symptomChips وtargets: معلّقان
  FIELD_INVALID: "SETTINGS_FIELD_INVALID", // قيمة خارج المدى أو بنوع خاطئ (السبب في extra)
  RETURN_REASON_KEY_REMOVED: "SETTINGS_RETURN_REASON_KEY_REMOVED", // مفتاح محفوظ غاب من القائمة الجديدة (الإيقاف بدل الحذف)
  CURRENT_VERSION_INVALID: "SETTINGS_CURRENT_VERSION_INVALID", // المستند الحاضر بلا version صالح: لا يُخمَّن ما بعده (إصلاح يدوي)
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const invalid = (field, cause) => ({ok: false, refusal: SETTINGS_WRITE_REFUSAL.FIELD_INVALID, field, extra: ` field=${field} cause=${cause}`});

/** عدد منتهٍ ضمن مدى؟ @return {?string} سبب الرفض أو null */
function numberCause(v, {min, max, integer = false}) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "NOT_A_FINITE_NUMBER";
  if (integer && !Number.isInteger(v)) return "NOT_AN_INTEGER";
  if (v < min || v > max) return "OUT_OF_RANGE";
  return null;
}

/**
 * @param {*} list
 * @return {{ok: true, value: Array<{key: string, ar: string, tr: string, active: boolean}>}|{ok: false, cause: string}}
 */
function normalizeReturnReasons(list) {
  if (!Array.isArray(list)) return {ok: false, cause: "NOT_AN_ARRAY"};
  if (list.length > SETTINGS_LIMITS.returnReasons.maxEntries) return {ok: false, cause: "TOO_MANY_ENTRIES"};
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!isObj(item)) return {ok: false, cause: "ENTRY_NOT_AN_OBJECT"};
    for (const k of Object.keys(item)) if (!["key", "ar", "tr", "active"].includes(k)) return {ok: false, cause: "ENTRY_UNKNOWN_KEY"};
    if (typeof item.key !== "string" || !RETURN_REASON_KEY_RE.test(item.key)) return {ok: false, cause: "KEY_INVALID"};
    if (seen.has(item.key)) return {ok: false, cause: "KEY_DUPLICATE"};
    seen.add(item.key);
    const texts = {};
    for (const lang of ["ar", "tr"]) {
      const t = typeof item[lang] === "string" ? item[lang].trim() : null;
      if (t === null || t === "" || t.length > SETTINGS_LIMITS.returnReasons.textMaxLength) return {ok: false, cause: `${lang.toUpperCase()}_INVALID`};
      texts[lang] = t;
    }
    if (typeof item.active !== "boolean") return {ok: false, cause: "ACTIVE_NOT_BOOLEAN"};
    out.push({key: item.key, ar: texts.ar, tr: texts.tr, active: item.active});
  }
  return {ok: true, value: out};
}

/**
 * يتحقّق من رقعة الإعدادات ويعيد قيمها المطبَّعة.
 * @param {*} patch request.data.settings
 * @return {{ok: true, values: Object}|{ok: false, refusal: string, field?: string, extra?: string}}
 */
function validateSettingsPatch(patch) {
  if (!isObj(patch) || Object.keys(patch).length === 0) return {ok: false, refusal: SETTINGS_WRITE_REFUSAL.PATCH_REQUIRED, extra: ""};
  const known = Object.values(SETTINGS_FIELD);
  for (const k of Object.keys(patch)) {
    if (!known.includes(k)) return {ok: false, refusal: SETTINGS_WRITE_REFUSAL.FIELD_UNKNOWN, field: k, extra: ` field=${k}`};
  }
  for (const k of SETTINGS_FIELDS_NOT_SPECIFIED) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) return {ok: false, refusal: SETTINGS_WRITE_REFUSAL.FIELD_NOT_SPECIFIED, field: k, extra: ` field=${k}`};
  }
  const values = {};
  for (const field of SETTINGS_WRITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const v = patch[field];
    if (v === undefined || v === null) return invalid(field, "CANNOT_CLEAR");
    let cause = null;
    switch (field) {
      case SETTINGS_FIELD.REPEAT_RATE:
      case SETTINGS_FIELD.DOUBLE_EVAL_RATE:
        cause = numberCause(v, SETTINGS_LIMITS.rate);
        break;
      case SETTINGS_FIELD.OPEN_BEFORE_VALIDITY_HOURS:
        cause = numberCause(v, SETTINGS_LIMITS.openBeforeValidityHours);
        break;
      case SETTINGS_FIELD.BLINDNESS_ALERT_BELOW_PCT:
        cause = numberCause(v, SETTINGS_LIMITS.blindnessAlertBelowPct);
        break;
      case SETTINGS_FIELD.COLLECTION_PHASE:
        if (typeof v !== "boolean") cause = "NOT_A_BOOLEAN";
        break;
      case SETTINGS_FIELD.MIN_APP_VERSION:
        if (typeof v !== "string") cause = "NOT_A_STRING";
        else if (v.length === 0 || v.length > SETTINGS_LIMITS.minAppVersion.maxLength || !MIN_APP_VERSION_RE.test(v)) cause = "FORMAT_INVALID";
        break;
      case SETTINGS_FIELD.RETURN_REASONS: {
        const n = normalizeReturnReasons(v);
        if (!n.ok) cause = n.cause;
        else values[field] = n.value;
        break;
      }
      default:
        cause = "UNHANDLED_FIELD"; // لا يقع: كل حقل مقبول له فرع (يحرسه الاختبار)
    }
    if (cause !== null) return invalid(field, cause);
    if (field !== SETTINGS_FIELD.RETURN_REASONS) values[field] = v;
  }
  return {ok: true, values};
}

/** تمثيل قانوني للمقارنة (مفاتيح الخرائط مرتّبة) — فلا يغيّر ترتيب مفاتيح مخزَّنة حكم «لم يتغيّر». */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/**
 * يدمج الرقعة المطبَّعة في المستند الحاضر. «الإيقاف بدل الحذف»: كل مفتاح returnReasons محفوظ يبقى.
 * @param {{current: ?Object, values: Object}} p current بيانات المستند الحاضر (أو null: أوّل كتابة)
 * @return {{ok: true, next: Object, changed: string[]}|{ok: false, refusal: string, field?: string, extra?: string}}
 */
function applySettingsPatch({current, values}) {
  const base = isObj(current) ? current : {};
  const changed = [];
  for (const field of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(base, field) || canonical(base[field]) !== canonical(values[field])) changed.push(field);
  }
  const incoming = values[SETTINGS_FIELD.RETURN_REASONS];
  if (incoming !== undefined && Array.isArray(base[SETTINGS_FIELD.RETURN_REASONS])) {
    const keys = new Set(incoming.map((r) => r.key));
    for (const prev of base[SETTINGS_FIELD.RETURN_REASONS]) {
      if (isObj(prev) && typeof prev.key === "string" && !keys.has(prev.key)) {
        return {ok: false, refusal: SETTINGS_WRITE_REFUSAL.RETURN_REASON_KEY_REMOVED, field: SETTINGS_FIELD.RETURN_REASONS, extra: ` field=${SETTINGS_FIELD.RETURN_REASONS} cause=KEY_REMOVED`};
      }
    }
  }
  return {ok: true, next: {...base, ...values}, changed};
}

const REFUSAL_RESPONSE = Object.freeze({
  [SETTINGS_WRITE_REFUSAL.PATCH_REQUIRED]: {code: "invalid-argument", message: SETTINGS_WRITE_REFUSAL.PATCH_REQUIRED, clientReasonCode: SETTINGS_WRITE_REFUSAL.PATCH_REQUIRED},
  [SETTINGS_WRITE_REFUSAL.FIELD_UNKNOWN]: {code: "invalid-argument", message: SETTINGS_WRITE_REFUSAL.FIELD_UNKNOWN, clientReasonCode: SETTINGS_WRITE_REFUSAL.FIELD_UNKNOWN},
  [SETTINGS_WRITE_REFUSAL.FIELD_NOT_SPECIFIED]: {code: "failed-precondition", message: SETTINGS_WRITE_REFUSAL.FIELD_NOT_SPECIFIED, clientReasonCode: SETTINGS_WRITE_REFUSAL.FIELD_NOT_SPECIFIED},
  [SETTINGS_WRITE_REFUSAL.FIELD_INVALID]: {code: "invalid-argument", message: SETTINGS_WRITE_REFUSAL.FIELD_INVALID, clientReasonCode: SETTINGS_WRITE_REFUSAL.FIELD_INVALID},
  [SETTINGS_WRITE_REFUSAL.RETURN_REASON_KEY_REMOVED]: {code: "failed-precondition", message: SETTINGS_WRITE_REFUSAL.RETURN_REASON_KEY_REMOVED, clientReasonCode: SETTINGS_WRITE_REFUSAL.RETURN_REASON_KEY_REMOVED},
  [SETTINGS_WRITE_REFUSAL.CURRENT_VERSION_INVALID]: {code: "failed-precondition", message: SETTINGS_WRITE_REFUSAL.CURRENT_VERSION_INVALID, clientReasonCode: SETTINGS_WRITE_REFUSAL.CURRENT_VERSION_INVALID},
});

module.exports = {
  SETTINGS_LIMITS, SETTINGS_FIELDS_NOT_SPECIFIED, SETTINGS_WRITABLE_FIELDS, SETTINGS_WRITE_REFUSAL, REFUSAL_RESPONSE,
  validateSettingsPatch, applySettingsPatch, canonical,
};
