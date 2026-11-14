"use strict";

// ===================================================
// marketingNames — خريطة الاسم التجاري بالعربية والتركية والإنجليزية: التحقّق والدمج والقراءة والحلّ (S-P6-20، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٥-أ-١ (:1527-1536) وdocs/PROTOCOL_CONTRACT.md §٢ A12 (إلحاق مؤرَّخ بكل شكل سلك وما بُني وما عُلِّق):
//   «**مصدر واحد في الخادم** (القاعدة 24) بالعربية والتركية والإنجليزية، **من بيانات يحرّرها المشرف.** **وخريطة التطبيق تبقى للعرض دون شبكة،** ويُختبر تطابقها مع مصدر الخادم بعيّنة ذهبية.
//    **والطراز غير الموجود** يُعرض `Build.MODEL` كما هو، **موسوماً `name_unmapped`.**» (:1533-1535) و«✓ س٣٥: «مصدر واحد في الخادم يحرّره المشرف، والتطبيق نسخة مختبرة»» (:1536).
//   وE14 (معتمد 2026-10-15): `marketingNames/current` بـ`version` و`entries[] {model, ar, tr, en}` + `history/{version}`؛ «`Build.MODEL` قد يحمل `/` فلا يصلح معرّف مستند؛ ومستند واحد بنسخة يوافق protocolSettings. **لا يمسّ `reports.deviceMarketingName` القائم**».
// **دوالّ نقيّة بلا I/O** (القاعدة 41)؛ الكتابة (معاملة + history) في admin/marketingNamesAdmin.js.
//
// **لا مدخل في الكود**: الخطّة لا تذكر مدخلات الخريطة («خريطة ثابتة في التطبيق… 118 مدخلاً» في التطبيق، خارج هذا المستودع) ولا تسمح بإدخالها من الوكيل («من بيانات يحرّرها المشرف»)؛ فالخريطة تبدأ **غائبة** (MAP_ABSENT) ويملؤها المشرف.
//
// ما تقرّره هذه الوحدة (قراراتي، القاعدة 45؛ كلّها في A12 للمراجعة):
//   (١) **التعديل رقعة بالتحديث-أو-الإضافة** (`entries` المرسَلة تُدمج بـ`model`: يُستبدل ar/tr/en لمدخل موجود، ويُلحق الجديد في آخر القائمة) — **لا حذف مدخل** (القاعدة 42) ولا استبدال القائمة كلّها (فلا يمحو نداءٌ ناقص ما كُتب).
//   (٢) **المطابقة حرفيّة**: `model` يُقارَن بالمساواة النصّية كما يرسله `Build.MODEL` (حساسة لحالة الأحرف، بلا تشذيب ولا تقريب)؛ ويُرفض model بمسافات في طرفيه (يُخفي فرقاً لا يُرى). **لا مطابقة تقريبية** (القاعدة 22).
//   (٣) **المفاتيح الأربعة إلزامية** (`model` · `ar` · `tr` · `en`: الشكل المعتمد E14 بلا خيارية)؛ ar وtr وen نصّ مشذَّب غير فارغ ≤ 120، وmodel 1..64 بلا محارف تحكّم. **الحدود تقنية اخترتُها** (لا أرقام في التصميم): ≤ 1000 مدخل (مستند Firestore ≤ 1 MiB، وتحمل history نسخة كاملة من السابق).
//   (٤) **الحلّ** (resolveMarketingName): `mapped` بالأسماء الثلاثة، أو `name_unmapped` (من التصميم :1535) **بسببه** (MODEL_NOT_IN_MAP · MAP_ABSENT · MAP_UNREADABLE · MODEL_ABSENT): الغياب حالة صريحة لا اسم افتراضياً؛ والعرض بـ`Build.MODEL` كما هو عند name_unmapped.

const {MARKETING_NAME_STATE} = require("./protocolVocabulary");

/** حدود الخريطة — تُعاد في ردّ getMarketingNames كي لا تكرّرها الواجهة. */
const MARKETING_NAMES_LIMITS = Object.freeze({maxEntries: 1000, modelMaxLength: 64, nameMaxLength: 120});

/** مفاتيح المدخل الأربعة (E14) بترتيبها. */
const MARKETING_ENTRY_KEYS = Object.freeze(["model", "ar", "tr", "en"]);
const NAME_KEYS = Object.freeze(["ar", "tr", "en"]);

/** أسماء حقول مستند marketingNames/current (E36: حرفيّات في الوحدة المالكة، مصدر واحد مُصدَّر لكاتبه وقارئه). */
const MARKETING_NAMES_FIELD = Object.freeze({
  VERSION: "version",
  ENTRIES: "entries",
  UPDATED_AT: "updatedAt",
  UPDATED_BY: "updatedBy",
});

/** حالة قراءة مستند الخريطة. UNREADABLE: مستند موجود بشكل لا يُقرأ (version غير صحيح أو entries بشكل خاطئ). */
const MARKETING_NAMES_STATE = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  UNREADABLE: "UNREADABLE",
});

/** سبب name_unmapped (يُعاد مع الحالة؛ لا يُكتب في مستند). */
const NAME_UNMAPPED_REASON = Object.freeze({
  MODEL_NOT_IN_MAP: "MODEL_NOT_IN_MAP", // الخريطة حاضرة والطراز ليس فيها
  MAP_ABSENT: "MAP_ABSENT", // لا مستند خريطة بعد
  MAP_UNREADABLE: "MAP_UNREADABLE", // مستند بشكل لا يُقرأ
  MODEL_ABSENT: "MODEL_ABSENT", // الطراز المطلوب حلّه غائب أو ليس نصّاً غير فارغ
});

/** رموز رفض setMarketingNames (اقتراحي: لا رمز معتمداً لها؛ الاسمان من التصميم لا وجود لهما: التصميم يسمّي المجموعة وحدها). */
const MARKETING_NAMES_REFUSAL = Object.freeze({
  ENTRIES_REQUIRED: "MARKETING_NAMES_ENTRIES_REQUIRED", // غائبة أو ليست مصفوفة أو فارغة
  TOO_MANY_ENTRIES: "MARKETING_NAMES_TOO_MANY_ENTRIES", // المرسَل أو ما بعد الدمج فوق الحدّ
  ENTRY_INVALID: "MARKETING_NAMES_ENTRY_INVALID", // مدخل بشكل أو قيمة خاطئة (السبب في extra)
  DUPLICATE_MODEL: "MARKETING_NAMES_DUPLICATE_MODEL", // طراز مكرَّر في المرسَل
  CURRENT_UNREADABLE: "MARKETING_NAMES_CURRENT_UNREADABLE", // المستند الحاضر بشكل لا يُقرأ: لا يُخمَّن ما بعده (إصلاح يدوي)
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasControlChars = (s) => /[\u0000-\u001F\u007F]/.test(s);
const invalid = (index, cause) => ({ok: false, refusal: MARKETING_NAMES_REFUSAL.ENTRY_INVALID, extra: ` index=${index} cause=${cause}`});

/**
 * @param {*} entries المرسَل من setMarketingNames
 * @return {{ok: true, entries: Array<{model: string, ar: string, tr: string, en: string}>}|{ok: false, refusal: string, extra: string}}
 */
function validateEntriesPatch(entries) {
  const R = MARKETING_NAMES_REFUSAL;
  if (!Array.isArray(entries) || entries.length === 0) return {ok: false, refusal: R.ENTRIES_REQUIRED, extra: ""};
  if (entries.length > MARKETING_NAMES_LIMITS.maxEntries) return {ok: false, refusal: R.TOO_MANY_ENTRIES, extra: ` count=${entries.length}`};
  const seen = new Set();
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!isObj(e)) return invalid(i, "ENTRY_NOT_AN_OBJECT");
    for (const k of Object.keys(e)) if (!MARKETING_ENTRY_KEYS.includes(k)) return invalid(i, "ENTRY_UNKNOWN_KEY");
    for (const k of MARKETING_ENTRY_KEYS) if (e[k] === undefined || e[k] === null) return invalid(i, `${k.toUpperCase()}_MISSING`);
    if (typeof e.model !== "string" || e.model === "") return invalid(i, "MODEL_INVALID");
    if (e.model !== e.model.trim()) return invalid(i, "MODEL_NOT_TRIMMED");
    if (e.model.length > MARKETING_NAMES_LIMITS.modelMaxLength || hasControlChars(e.model)) return invalid(i, "MODEL_INVALID");
    const names = {};
    for (const k of NAME_KEYS) {
      if (typeof e[k] !== "string") return invalid(i, `${k.toUpperCase()}_INVALID`);
      const t = e[k].trim();
      if (t === "" || t.length > MARKETING_NAMES_LIMITS.nameMaxLength || hasControlChars(t)) return invalid(i, `${k.toUpperCase()}_INVALID`);
      names[k] = t;
    }
    if (seen.has(e.model)) return {ok: false, refusal: R.DUPLICATE_MODEL, extra: ` index=${i}`};
    seen.add(e.model);
    out.push({model: e.model, ar: names.ar, tr: names.tr, en: names.en});
  }
  return {ok: true, entries: out};
}

/**
 * قراءة مستند marketingNames/current. المقروء: version عدد صحيح ≥ 1 وentries مصفوفة بمداخل صحيحة الشكل (المفاتيح الأربعة نصوصاً غير فارغة) وطرازات غير مكرَّرة؛ غير ذلك UNREADABLE بسببه.
 * @param {?Object} docData
 * @return {{state: string, anomaly: ?string, version: ?number, entries: Array<{model: string, ar: string, tr: string, en: string}>}}
 */
function readMarketingNamesDocument(docData) {
  const empty = (state, anomaly) => ({state, anomaly, version: null, entries: []});
  if (docData === null || docData === undefined) return empty(MARKETING_NAMES_STATE.ABSENT, null);
  if (!isObj(docData)) return empty(MARKETING_NAMES_STATE.UNREADABLE, "DOCUMENT_NOT_AN_OBJECT");
  const F = MARKETING_NAMES_FIELD;
  const version = docData[F.VERSION];
  if (!Number.isInteger(version) || version < 1) return empty(MARKETING_NAMES_STATE.UNREADABLE, "VERSION_UNUSABLE");
  const raw = docData[F.ENTRIES];
  if (!Array.isArray(raw)) return empty(MARKETING_NAMES_STATE.UNREADABLE, "ENTRIES_NOT_AN_ARRAY");
  const seen = new Set();
  const entries = [];
  for (const e of raw) {
    if (!isObj(e) || !MARKETING_ENTRY_KEYS.every((k) => typeof e[k] === "string" && e[k] !== "")) return empty(MARKETING_NAMES_STATE.UNREADABLE, "ENTRY_UNUSABLE");
    if (seen.has(e.model)) return empty(MARKETING_NAMES_STATE.UNREADABLE, "DUPLICATE_MODEL");
    seen.add(e.model);
    entries.push({model: e.model, ar: e.ar, tr: e.tr, en: e.en});
  }
  return {state: MARKETING_NAMES_STATE.PRESENT, anomaly: null, version, entries};
}

/**
 * دمج المرسَل في الحاضر: تحديث بـmodel (يُستبدل ar/tr/en) وإلحاق الجديد في الآخر؛ **لا حذف** ولا إعادة ترتيب لما سبق.
 * @param {Array<{model: string, ar: string, tr: string, en: string}>} current الحاضر (مقروءاً)
 * @param {Array<{model: string, ar: string, tr: string, en: string}>} incoming المرسَل (مُتحقَّقاً منه)
 * @return {{ok: true, next: Array<Object>, added: number, updated: number}|{ok: false, refusal: string, extra: string}}
 */
function mergeEntries(current, incoming) {
  const next = current.map((e) => ({...e}));
  const index = new Map(next.map((e, i) => [e.model, i]));
  let added = 0;
  let updated = 0;
  for (const e of incoming) {
    if (index.has(e.model)) {
      const i = index.get(e.model);
      if (next[i].ar !== e.ar || next[i].tr !== e.tr || next[i].en !== e.en) {
        next[i] = {model: e.model, ar: e.ar, tr: e.tr, en: e.en};
        updated++;
      }
    } else {
      index.set(e.model, next.length);
      next.push({model: e.model, ar: e.ar, tr: e.tr, en: e.en});
      added++;
    }
  }
  if (next.length > MARKETING_NAMES_LIMITS.maxEntries) return {ok: false, refusal: MARKETING_NAMES_REFUSAL.TOO_MANY_ENTRIES, extra: ` total=${next.length}`};
  return {ok: true, next, added, updated};
}

/**
 * **الحلّ الواحد** من Build.MODEL إلى الأسماء الثلاثة (القاعدة 24: كل قارئ — لوحة التقدّم P6-16 وغيرها — يستورده): `mapped`، أو `name_unmapped` بسببه فيُعرض Build.MODEL كما هو.
 * @param {{model: *, source: {state: string, version: ?number, entries: Array<Object>}}} p source ناتج readMarketingNamesDocument
 * @return {{state: string, model: ?string, names: ?{ar: string, tr: string, en: string}, reason: ?string, version: ?number}}
 */
function resolveMarketingName({model, source}) {
  const version = source.state === MARKETING_NAMES_STATE.PRESENT ? source.version : null;
  const unmapped = (reason) => ({state: MARKETING_NAME_STATE.NAME_UNMAPPED, model: typeof model === "string" && model !== "" ? model : null, names: null, reason, version});
  if (typeof model !== "string" || model === "") return unmapped(NAME_UNMAPPED_REASON.MODEL_ABSENT);
  if (source.state === MARKETING_NAMES_STATE.ABSENT) return unmapped(NAME_UNMAPPED_REASON.MAP_ABSENT);
  if (source.state === MARKETING_NAMES_STATE.UNREADABLE) return unmapped(NAME_UNMAPPED_REASON.MAP_UNREADABLE);
  const hit = source.entries.find((e) => e.model === model);
  if (hit === undefined) return unmapped(NAME_UNMAPPED_REASON.MODEL_NOT_IN_MAP);
  return {state: MARKETING_NAME_STATE.MAPPED, model, names: {ar: hit.ar, tr: hit.tr, en: hit.en}, reason: null, version};
}

module.exports = {
  MARKETING_NAMES_LIMITS, MARKETING_ENTRY_KEYS, MARKETING_NAMES_FIELD, MARKETING_NAMES_STATE, NAME_UNMAPPED_REASON, MARKETING_NAMES_REFUSAL,
  validateEntriesPatch, readMarketingNamesDocument, mergeEntries, resolveMarketingName,
};
