"use strict";

// ===================================================
// deviceProfileKey — قراءة مفتاح الجهاز بأيّ الشكلين (V8 قبل نشر الأمان، 2026-10-09 +03)
// ===================================================
//
// قرار المستخدم (بنصّه، منقول من أمر المنسّق): «القراءة المتوافقة للاسمين (deviceProfileKey.a وprimary معاً) تدخل نشر الأمان هذا، بنداً رابعاً
// لوكيل الخادم، مع اختبار على الحمولتين.» وسياقه: «أسماء R8 (a..f) في deviceProfiles: هو الخطوة الأولى في إصلاح مفتاح الجهاز. keep أو
// SerializedName في التطبيق، وقراءة متوافقة في الخادم، واختبار على حمولة الإصدار الحقيقية لا debug.»
//
// الحال قبل: الخادم يقرأ الأساسي باسم R8 (deviceProfileKey.a) والطبقات بأسماء المصدر (layerA_keystore …). فنسخة الإصدار (R8، 1.0.10) تُرسل
// {a,b,c,d,e,f} فتُقرأ طبقاتها غائبة (يُكتب قيَم حارس)، ونسخة تُرسل الأسماء الكاملة (1.0.11، أو debug) يغيب `.a` عندها فيتخطّى analyzeDevice كتابة
// ملفّ الجهاز كلّه. الآن: مُطبِّع واحد (القاعدة 24) يقبل الشكلين ويُرجع الأسماء الكاملة، ويُعلن ما لم يجده (القاعدتان 22 و25)، وتستعمله كل القرّاء
// الحيّة: findDeviceProfile · createDeviceProfile · analyzeDevice · runAnalysisInternal (سطر السجلّ). أيّ قراءة مباشرة لـ.a أو layerX_… خارج هذا
// الملفّ يُفشلها deviceProfileKey.test.js.
//
// ─── الأسماء (مصدر واحد) ───────────────────────────────────────────────────────────────────────────────────────
// primary→a · layerA_keystore→b · layerB_firebaseId→c · layerC_androidId→d · layerD_buildSig→e · layerE_sensorSig→f. المصدر: docs/V7_DISPLAY_SHAPE_CONTRACT.md §١١
// (منقول عن mapping.txt للتطبيق، غير متحقَّق من هذا المستودع — القاعدة 29)؛ ويثبّتها deviceProfileKey.test.js بنسخة مستقلّة وبجدول العقد.
//
// ─── الأشكال (كل مفتاح يُصنَّف بواحد، ويُكتب اسمه في السجلّ) ─────────────────────────────────────────────────────
//   FULL_NAMES           أسماء كاملة فقط (debug، أو التطبيق بعد keep/@SerializedName)
//   R8_SHORT_NAMES       a..f فقط (إصدار 1.0.10 المُصغَّر)
//   MIXED_FORMS          الشكلان معاً بلا حقل منطقي مذكور مرّتين (مثلاً a + layerA_keystore): لا غموض فيُقبل
//   BOTH_FORMS_AGREE     الشكلان معاً وحقل واحد على الأقلّ مذكور بالاسمين بالقيمة نفسها، بلا تعارض: يُقبل
//   BOTH_FORMS_CONFLICT  الشكلان معاً وحقل مذكور بالاسمين بقيمتين مختلفتين: **يُرفض المفتاح كلّه** (انظر القرار أدناه)
//   UNRECOGNIZED         كائن لا يحمل أيّاً من الأسماء الاثني عشر
//   NOT_AN_OBJECT        نصّ أو رقم أو مصفوفة أو منطقي (لا كائن)
//   ABSENT               لا مفتاح (null/undefined)
//
// ─── قرار الشكلين المتعارضين (BOTH_FORMS_CONFLICT) ──────────────────────────────────────────────────────────────
// لا يُستعمل أيّ منهما: key=null وusable=false، فلا بحث ولا كتابة لملفّ جهاز، ويمضي الفحص كأنه أوّل فحص (كاش فائت لا غير). السبب: الأساسي
// يحدّد ملفّ الجهاز وقرار إعادة التقرير المخبَّأ (runAnalysisInternal يُعيد تقرير الفحص السابق إن تطابقت البصمة)؛ فاختيار الاسم الخطأ يُلحق
// بجهاز تاريخَ جهاز آخر ويُعيد له تقريره. وتعارض كهذا لا يصدر من تطبيق سليم (R8 يُرسل a..f وحدها، وغيره الأسماء الكاملة وحدها)، فهو عطب أو
// عبث، والفشل المغلق (بلا ملفّ) أرخص من تخمين. ويُعلَن في السجلّ بالاسم FORMS_CONFLICT مع أسماء الحقول المتعارضة (بلا قيمها).
//
// ─── القيم الغائبة ─────────────────────────────────────────────────────────────────────────────────────────────
// حقل غائب في الشكلين = null في key (لا قيمة حارس) ويُسرد في missing؛ وحقل موجود بقيمة ليست نصّاً غير فارغ = null ويُسرد في invalid. والأساسي
// الغائب أو غير الصالح يجعل المفتاح غير قابل للاستعمال (PRIMARY_MISSING / PRIMARY_INVALID). أمّا الكتابة في deviceProfiles فتبقى كما هي:
// طبقة null تُكتب قيمة الحارس كالسابق (createDeviceProfile.js)، لكن الغياب مُعلَن في السطر لا صامت.

const FIELDS = Object.freeze([
  Object.freeze({full: "primary", short: "a"}),
  Object.freeze({full: "layerA_keystore", short: "b"}),
  Object.freeze({full: "layerB_firebaseId", short: "c"}),
  Object.freeze({full: "layerC_androidId", short: "d"}),
  Object.freeze({full: "layerD_buildSig", short: "e"}),
  Object.freeze({full: "layerE_sensorSig", short: "f"}),
]);
const FULL_FIELD_NAMES = Object.freeze(FIELDS.map((f) => f.full));
const SHORT_FIELD_NAMES = Object.freeze(FIELDS.map((f) => f.short));
/** القيمة التي يرسلها التطبيق للأساسي حين يعجز عن حسابه — لا ملفّ جهاز لها (كانت حرفية في ثلاثة مواضع). */
const UNKNOWN_PRIMARY = "unknown_fp";

const SHAPE = Object.freeze({
  FULL_NAMES: "FULL_NAMES",
  R8_SHORT_NAMES: "R8_SHORT_NAMES",
  MIXED_FORMS: "MIXED_FORMS",
  BOTH_FORMS_AGREE: "BOTH_FORMS_AGREE",
  BOTH_FORMS_CONFLICT: "BOTH_FORMS_CONFLICT",
  UNRECOGNIZED: "UNRECOGNIZED",
  NOT_AN_OBJECT: "NOT_AN_OBJECT",
  ABSENT: "ABSENT",
});

const UNUSABLE_REASON = Object.freeze({
  KEY_ABSENT: "KEY_ABSENT",
  KEY_NOT_AN_OBJECT: "KEY_NOT_AN_OBJECT",
  NO_RECOGNIZED_FIELD: "NO_RECOGNIZED_FIELD",
  FORMS_CONFLICT: "FORMS_CONFLICT",
  PRIMARY_MISSING: "PRIMARY_MISSING",
  PRIMARY_INVALID: "PRIMARY_INVALID",
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined;
const isValue = (v) => typeof v === "string" && v.trim() !== "";

function unusable(shape, reason, extra = {}) {
  return {shape, key: null, usable: false, unusableReason: reason, missing: [], invalid: [], conflicts: [], ...extra};
}

/**
 * @param {*} raw ما أرسله التطبيق في fingerprint.device.deviceProfileKey
 * @return {{shape: string, key: ?Object<string, ?string>, usable: boolean, unusableReason: ?string,
 *   missing: string[], invalid: string[], conflicts: string[]}}
 *   key (حين usable) = الأسماء الكاملة الستّة، كل منها نصّ غير فارغ أو null (غائب/غير صالح). missing/invalid/conflicts بأسماء كاملة.
 */
function normalizeDeviceProfileKey(raw) {
  if (raw === null || raw === undefined) return unusable(SHAPE.ABSENT, UNUSABLE_REASON.KEY_ABSENT);
  if (typeof raw !== "object" || Array.isArray(raw)) return unusable(SHAPE.NOT_AN_OBJECT, UNUSABLE_REASON.KEY_NOT_AN_OBJECT);

  let fullAny = false;
  let shortAny = false;
  let bothAny = false;
  const key = {};
  const missing = [];
  const invalid = [];
  const conflicts = [];
  for (const f of FIELDS) {
    const inFull = has(raw, f.full);
    const inShort = has(raw, f.short);
    fullAny = fullAny || inFull;
    shortAny = shortAny || inShort;
    if (!inFull && !inShort) {
      key[f.full] = null;
      missing.push(f.full);
      continue;
    }
    let value;
    if (inFull && inShort) {
      bothAny = true;
      if (raw[f.full] !== raw[f.short]) {
        conflicts.push(f.full);
        key[f.full] = null;
        continue;
      }
      value = raw[f.full];
    } else {
      value = inFull ? raw[f.full] : raw[f.short];
    }
    if (isValue(value)) {
      key[f.full] = value;
    } else {
      key[f.full] = null;
      invalid.push(f.full);
    }
  }

  if (!fullAny && !shortAny) {
    return unusable(SHAPE.UNRECOGNIZED, UNUSABLE_REASON.NO_RECOGNIZED_FIELD, {missing: [...FULL_FIELD_NAMES]});
  }
  let shape;
  if (fullAny && shortAny) {
    if (conflicts.length > 0) shape = SHAPE.BOTH_FORMS_CONFLICT;
    else shape = bothAny ? SHAPE.BOTH_FORMS_AGREE : SHAPE.MIXED_FORMS;
  } else {
    shape = fullAny ? SHAPE.FULL_NAMES : SHAPE.R8_SHORT_NAMES;
  }
  if (shape === SHAPE.BOTH_FORMS_CONFLICT) {
    return unusable(shape, UNUSABLE_REASON.FORMS_CONFLICT, {missing, invalid, conflicts});
  }
  if (key.primary === null) {
    return unusable(shape, invalid.includes("primary") ? UNUSABLE_REASON.PRIMARY_INVALID : UNUSABLE_REASON.PRIMARY_MISSING, {missing, invalid, conflicts});
  }
  return {shape, key, usable: true, unusableReason: null, missing, invalid, conflicts};
}

/**
 * سطر وصف للسجلّ: أسماء لا قيم (الأساسي والطبقات معرّفات جهاز).
 * @param {Object} normalized ناتج normalizeDeviceProfileKey
 * @return {string}
 */
function describeDeviceProfileKey(normalized) {
  const list = (name, arr) => (arr.length > 0 ? ` ${name}=[${arr.join(",")}]` : "");
  return `shape=${normalized.shape} usable=${normalized.usable}` +
      (normalized.unusableReason ? ` reason=${normalized.unusableReason}` : "") +
      list("missing", normalized.missing) + list("invalid", normalized.invalid) + list("conflicts", normalized.conflicts);
}

module.exports = {
  FIELDS, FULL_FIELD_NAMES, SHORT_FIELD_NAMES, UNKNOWN_PRIMARY, SHAPE, UNUSABLE_REASON,
  normalizeDeviceProfileKey, describeDeviceProfileKey,
};
