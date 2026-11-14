"use strict";

// ===================================================
// technicianFormContract — عقد استمارة الفنّي v2: التحقّق والاشتقاق والعمى (S-P6-08، 2026-10-18 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٠ (:1179-1376) وdocs/PROTOCOL_CONTRACT.md §٢ A5. **دوالّ نقيّة بلا I/O** (القاعدة 41: تُختبَر بلا Firestore). المفردات من protocolVocabulary.js (مصدر واحد: القاعدة 24)؛
// وفئات التقييم الأربع هنا `TECHNICIAN_GRADE_CATEGORY` (battery · performance · thermal · overall) **ولا يُغيَّر `RATING_CATEGORIES` القائم** في evaluationContract.js (v1: battery · cpu_performance · memory · storage):
// «والعقد القديم يبقى مقبولاً للتطبيقات القديمة (...) موسوماً contractVersion: 1. لا يُرفض صامتاً، ولا يُخلط بالجديد» (PLAN-06:1237-1238)؛ تغييرها هناك يرفض ما يرسله تطبيق قديم عبر submitEvaluation.
//
// ما تقرّره هذه الوحدة:
//   (١) normalizeTechnicianForm: كل مُدخل بسبب رفض مسمّى واحد من FORM_REFUSAL (E5: «رفض مسمّى لكل خطأ مُدخل»)، **والغياب حالة صريحة لا قيمة** (القاعدة 22): غير المُجاب في الدرجات والقائمة الوظيفية والعيوب `null`
//       صريح (لا `not_tested`: P:1252)، وصحّة البطارية غير المملوءة `batteryHealth: null` بحالة `not_answered` (P:1293)، والأعراض غير المُجابة `null` («الفراغ «لم يُجب»، لا «لا أعراض»»: P:1284).
//   (٢) deriveFormFlags: المشتقّات خادمية ولا تُقبل من العميل: `allFourGradesEqual` (خامّ) · `fast` (< 8 ث من أوّل لمسة: P:1345) · `contradictionRules` (القاعدة الجديدة وحدها: P:1352؛ TL:64) · هل الملاحظة إلزامية.
//   (٣) computeBlindness: `blindness ∈ {blind, not_blind, unverifiable}` بأساس مسمّى وساعة مسمّاة (P:1318-1325).
//
// ما لا يُبنى هنا (معلّق، كلٌّ باقتباسه في docs/PROTOCOL_CONTRACT.md §٢ A5): سقف طول `observedNote` («سقف طول `observedNote` ... أمر P6-08» ثم «يبقى مؤجَّلاً»)؛ قواعد التناقض غير الجديدة (لم تُسمَّ مفاتيحها: A5)؛ نصّ تنبيه التناقض؛
// `weak_battery`؛ علم «خطّ مستقيم» الأسبوعي للفنّي (يحسبه الخادم من استمارات أسبوع: ملخّص، لا مسار الإرسال)؛ **أسماء الحقول أدناه اقتراحي** حيث لم يسمّها التصميم (القائمة في A5).
//
// أسماء الحقول حرفيّات هنا وحدها (E36: لا تُصدَّر)، والمفردات من protocolVocabulary.

const {
  FORM_CONTRACT_VERSION, TECHNICIAN_GRADE_CATEGORY, GRADE_OPTION, GRADE_LEVEL, FUNCTIONAL_CHECK, FUNCTIONAL_ANSWER, VISIBLE_DEFECT,
  SYMPTOM, SYMPTOM_NONE_NOTICED, BATTERY_HEALTH_KIND, BATTERY_HEALTH_STATE, FORM_ANSWER_STATE, BLINDNESS, BLINDNESS_BASIS,
  FORM_CONTRADICTION_RULE, FORM_REFUSAL,
} = require("../protocol/protocolVocabulary");

// ─── أسماء اقتراحي لم يسمّها التصميم — **هنا لا في protocolVocabulary.js** ─────────────────────────────────────────────────────────────────────────────────
// وسم proposal في الوثيقة (§٨) يقول: «مقترح الوكيل `[م]` (لا يُستعمل في كود قبل اعتماده)». فهذه الأربعة تُعلَن هنا مرّة واحدة (مصدر واحد: القاعدة 24)، وتُذكر في docs/PROTOCOL_CONTRACT.md §٢ A5
// «ما بُني وما عُلِّق» بوسم «اقتراحي»، وتنتقل إلى الوحدة بوسمها حين يعتمدها المستخدم. **المعتمَد منها اسم واحد** هو `device` (P:1324: «وتوسم clock: device»).
/** الساعة التي حُكم بها العمى: `device` من التصميم (P:1324)، و`server` اقتراحي (ضدّه). */
const FORM_CLOCK = Object.freeze({SERVER: "server", DEVICE: "device"});
/** فعل الفنّي عند تنبيه التناقض (P:1340: الزرّان «نعم، أرسل» و«سأراجع») — القيمتان اقتراحيتان؛ والغياب (لا تنبيه) `null`. */
const PROMPT_ACTION = Object.freeze({CONFIRMED_SEND: "confirmed_send", WILL_REVIEW: "will_review"});
/** حالة صحّة البطارية حين أُجيب عنها (ضدّ FORM_ANSWER_STATE.NOT_ANSWERED المعتمَدة: P:1293). */
const BATTERY_HEALTH_ANSWERED = "answered";
/** أساس العمى حين لا تقرير بعد (لا مقارنة): اقتراحي — BLINDNESS_BASIS المعتمَدة قيمتان وكلتاهما تفترض تقريراً موجوداً. */
const BLINDNESS_BASIS_NO_REPORT = "report_not_yet_created";

/** فتحتا الاستمارة (P:1302: «والاستمارة الثانية `slot: 2`»): الأولى والثانية، عددان صحيحان. */
const FORM_SLOT = Object.freeze({FIRST: 1, SECOND: 2});

/** «`fast`: `submittedAt − firstTapAt < 8 ث`» (PLAN-06:1345؛ س٣١). مصدر الرقم الوحيد هنا. */
const FAST_SUBMIT_MS = 8000;

/**
 * سقف عدد عناصر `perAnswerAt[]` — **حدّ تقني اخترتُه أنا** (لم يسمّه التصميم): لا يُحمَّل مستند Firestore بقائمة بلا حدّ من عميل؛ أجوبة الاستمارة نحو ثلاثين (4 درجات + 6 وظيفية + 3 عيوب + أعراض ≤ 13 + لعبة + بطارية + عطب معروف)
 * وتعديل الجواب يكرّر اللمسة، فالسقف يتّسع لها مرّات. تجاوزه ⟵ FORM_TIMES_INVALID. **معلّق: قرار المستخدم إن أراد غيره.**
 */
const MAX_PER_ANSWER_ENTRIES = 200;

const GRADE_CATEGORIES = Object.freeze(Object.values(TECHNICIAN_GRADE_CATEGORY));
const GRADE_OPTIONS = Object.freeze(Object.values(GRADE_OPTION));
const FUNCTIONAL_CHECKS = Object.freeze(Object.values(FUNCTIONAL_CHECK));
const FUNCTIONAL_ANSWERS = Object.freeze(Object.values(FUNCTIONAL_ANSWER));
const DEFECTS = Object.freeze(Object.values(VISIBLE_DEFECT));
const SYMPTOM_CHIPS = Object.freeze(Object.values(SYMPTOM).filter((s) => s !== SYMPTOM_NONE_NOTICED));
const PROMPT_ACTIONS = Object.freeze(Object.values(PROMPT_ACTION));
/** «أيّ درجة دون «جيّد» تفتح سطر «ما الذي لاحظته؟» إلزامياً» (PLAN-06:1193): المتوسط والضعيف. */
const BELOW_GOOD = Object.freeze([GRADE_LEVEL.FAIR, GRADE_LEVEL.WEAK]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isAbsent = (v) => v === undefined || v === null;
const refusal = (code, extra) => ({ok: false, refusal: code, extra: extra || ""});

/**
 * معرّف مستند صالح لنداء `.doc(id)`: نصّ بلا `/` وليس `.` ولا `..`، وطوله ≤ 128 (حدّ تقني). الاستعمال نفسه لمعرّف الجلسة ومعرّف الفنّي.
 * @param {*} v
 * @return {boolean}
 */
function isSafeDocId(v) {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > 0 && t.length <= 128 && !t.includes("/") && t !== "." && t !== "..";
}

/**
 * خريطة مفاتيح مغلقة بقيم مغلقة: المفتاح غائب أو null ⟵ null صريح؛ مفتاح غريب أو قيمة خارج القائمة ⟵ مرفوضة. يعيد كل المفاتيح المطلوبة دائماً.
 * @param {*} raw المُدخل (غائب/null يعني: لا جواب لأيّ بند)
 * @param {readonly string[]} keys المفاتيح المقبولة
 * @param {readonly string[]} values القيم المقبولة
 * @return {{ok: true, value: Object<string, ?string>}|{ok: false, extra: string}}
 */
function readClosedMap(raw, keys, values) {
  const out = {};
  for (const k of keys) out[k] = null;
  if (isAbsent(raw)) return {ok: true, value: out};
  if (!isObj(raw)) return {ok: false, extra: " shape=NOT_A_MAP"};
  for (const k of Object.keys(raw)) {
    if (!keys.includes(k)) return {ok: false, extra: " cause=UNKNOWN_KEY"};
    const v = raw[k];
    if (isAbsent(v)) continue;
    if (typeof v !== "string" || !values.includes(v)) return {ok: false, extra: ` cause=VALUE_NOT_ALLOWED key=${k}`};
    out[k] = v;
  }
  return {ok: true, value: out};
}

/**
 * قائمة مفاتيح مفردة: مصفوفة نصوص من القائمة، بلا تكرار.
 * @param {*} raw
 * @param {readonly string[]} allowed
 * @return {{ok: true, value: string[]}|{ok: false, extra: string}}
 */
function readDistinctKeys(raw, allowed) {
  if (!Array.isArray(raw)) return {ok: false, extra: " shape=NOT_AN_ARRAY"};
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== "string" || !allowed.includes(v)) return {ok: false, extra: " cause=VALUE_NOT_ALLOWED"};
    if (seen.has(v)) return {ok: false, extra: " cause=DUPLICATE"};
    seen.add(v);
  }
  return {ok: true, value: [...seen]};
}

/**
 * صحّة البطارية (P:1290-1293): `{kind: percent|state|not_shown, percent, stateKey}`. غير المملوء `null` بحالة `not_answered`؛ «لا تظهر» جواب، والفراغ ليس جواباً.
 * @param {*} raw
 * @return {{ok: true, value: ?Object, state: string}|{ok: false, extra: string}}
 */
function readBatteryHealth(raw) {
  if (isAbsent(raw)) return {ok: true, value: null, state: FORM_ANSWER_STATE.NOT_ANSWERED};
  if (!isObj(raw)) return {ok: false, extra: " shape=NOT_A_MAP"};
  for (const k of Object.keys(raw)) if (!["kind", "percent", "stateKey"].includes(k)) return {ok: false, extra: " cause=UNKNOWN_KEY"};
  const kinds = Object.values(BATTERY_HEALTH_KIND);
  if (typeof raw.kind !== "string" || !kinds.includes(raw.kind)) return {ok: false, extra: " cause=KIND_NOT_ALLOWED"};
  const percent = isAbsent(raw.percent) ? null : raw.percent;
  const stateKey = isAbsent(raw.stateKey) ? null : raw.stateKey;
  if (raw.kind === BATTERY_HEALTH_KIND.PERCENT) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return {ok: false, extra: " cause=PERCENT_NOT_INTEGER_0_100"};
    if (stateKey !== null) return {ok: false, extra: " cause=STATE_KEY_WITH_PERCENT"};
  } else if (raw.kind === BATTERY_HEALTH_KIND.STATE) {
    if (typeof stateKey !== "string" || !Object.values(BATTERY_HEALTH_STATE).includes(stateKey)) return {ok: false, extra: " cause=STATE_KEY_NOT_ALLOWED"};
    if (percent !== null) return {ok: false, extra: " cause=PERCENT_WITH_STATE"};
  } else if (percent !== null || stateKey !== null) {
    return {ok: false, extra: " cause=VALUE_WITH_NOT_SHOWN"};
  }
  return {ok: true, value: {kind: raw.kind, percent, stateKey}, state: BATTERY_HEALTH_ANSWERED};
}

/**
 * أزمنة الجهاز (P:1315-1316): `openedAt` ≤ `firstTapAt` ≤ `submittedAt`، و`perAnswerAt[]` كلّها بينها؛ أعداد منتهية غير سالبة (مللي ثانية، ساعة الجهاز).
 * @param {Object} d
 * @return {{ok: true, value: Object}|{ok: false, extra: string}}
 */
function readTimes(d) {
  const num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  for (const k of ["openedAt", "firstTapAt", "submittedAt"]) {
    if (!num(d[k])) return {ok: false, extra: ` cause=${isAbsent(d[k]) ? "ABSENT" : "NOT_A_NONNEGATIVE_NUMBER"} field=${k}`};
  }
  if (d.firstTapAt < d.openedAt) return {ok: false, extra: " cause=FIRST_TAP_BEFORE_OPENED"};
  if (d.submittedAt < d.firstTapAt) return {ok: false, extra: " cause=SUBMITTED_BEFORE_FIRST_TAP"};
  if (!Array.isArray(d.perAnswerAt)) return {ok: false, extra: ` cause=${isAbsent(d.perAnswerAt) ? "ABSENT" : "NOT_AN_ARRAY"} field=perAnswerAt`};
  if (d.perAnswerAt.length > MAX_PER_ANSWER_ENTRIES) return {ok: false, extra: " cause=TOO_MANY_ENTRIES field=perAnswerAt"};
  for (const t of d.perAnswerAt) {
    if (!num(t) || t < d.openedAt || t > d.submittedAt) return {ok: false, extra: " cause=ENTRY_OUT_OF_RANGE field=perAnswerAt"};
  }
  return {ok: true, value: {openedAt: d.openedAt, firstTapAt: d.firstTapAt, perAnswerAt: [...d.perAnswerAt], submittedAt: d.submittedAt}};
}

/**
 * يتحقّق من حمولة الاستمارة ويعيد حقولها المطبَّعة، أو أوّل سبب رفض بالترتيب: النسخة ← الفتحة ← الفنّي ← الدرجات ← الوظيفي ← العيوب ← الأعراض وترتيبها ← عطب معروف ← صحّة البطارية ← اللعبة ← الملاحظة ← الأزمنة ← لقطات التنبيه ← الفراغ.
 * لا يتحقّق من وجود الفنّي ولا الجلسة (Firestore: submitTechnicianForm.js)، ولا يقبل مشتقّاً من العميل (مفتاح غريب في المستوى الأعلى لا يُقرأ ولا يُرفض: يُتجاهَل، كما submitEvaluation).
 * @param {*} data request.data
 * @return {{ok: true, form: Object}|{ok: false, refusal: string, extra: string}}
 */
function normalizeTechnicianForm(data) {
  const d = isObj(data) ? data : {};
  if (d.formContractVersion !== FORM_CONTRACT_VERSION) {
    return refusal(FORM_REFUSAL.CONTRACT_VERSION_INVALID, ` cause=${isAbsent(d.formContractVersion) ? "ABSENT" : "NOT_THE_CURRENT_VERSION"}`);
  }
  if (d.slot !== FORM_SLOT.FIRST && d.slot !== FORM_SLOT.SECOND) return refusal(FORM_REFUSAL.SLOT_INVALID, ` cause=${isAbsent(d.slot) ? "ABSENT" : "NOT_1_OR_2"}`);
  if (!isSafeDocId(d.technicianId)) return refusal(FORM_REFUSAL.TECHNICIAN_UNKNOWN, ` cause=${isAbsent(d.technicianId) ? "ABSENT" : "NOT_A_SAFE_ID"}`);

  const grades = readClosedMap(d.grades, GRADE_CATEGORIES, GRADE_OPTIONS);
  if (!grades.ok) return refusal(FORM_REFUSAL.GRADES_INVALID, grades.extra);
  const functional = readClosedMap(d.functional, FUNCTIONAL_CHECKS, FUNCTIONAL_ANSWERS);
  if (!functional.ok) return refusal(FORM_REFUSAL.FUNCTIONAL_INVALID, functional.extra);
  const defects = readClosedMap(d.defects, DEFECTS, FUNCTIONAL_ANSWERS);
  if (!defects.ok) return refusal(FORM_REFUSAL.DEFECTS_INVALID, defects.extra);

  // الأعراض: غير المُجاب null («الفراغ «لم يُجب»، لا «لا أعراض»»، P:1284). مصفوفة فارغة = لم يُجب أيضاً. none_noticed جواب صريح لا يجتمع بغيره.
  let symptoms = null;
  if (!isAbsent(d.symptoms)) {
    const s = readDistinctKeys(d.symptoms, Object.values(SYMPTOM));
    if (!s.ok) return refusal(FORM_REFUSAL.SYMPTOMS_INVALID, s.extra);
    if (s.value.includes(SYMPTOM_NONE_NOTICED) && s.value.length > 1) return refusal(FORM_REFUSAL.SYMPTOMS_INVALID, " cause=NONE_NOTICED_WITH_OTHERS");
    symptoms = s.value.length === 0 ? null : s.value;
  }
  // الترتيب المعروض يُخزَّن لكل استمارة (P:1283): حاضر دائماً — مصفوفة غير فارغة من الاثنتي عشرة بلا تكرار (والشرط على المعروض ≤ 12: P:783).
  const order = readDistinctKeys(d.symptomOrderShown, SYMPTOM_CHIPS);
  if (!order.ok) return refusal(FORM_REFUSAL.SYMPTOM_ORDER_INVALID, isAbsent(d.symptomOrderShown) ? " cause=ABSENT" : order.extra);
  if (order.value.length === 0) return refusal(FORM_REFUSAL.SYMPTOM_ORDER_INVALID, " cause=EMPTY");
  if (symptoms !== null && symptoms.some((s) => s !== SYMPTOM_NONE_NOTICED && !order.value.includes(s))) {
    return refusal(FORM_REFUSAL.SYMPTOMS_INVALID, " cause=SELECTED_NOT_SHOWN");
  }

  let knownFault = null;
  if (!isAbsent(d.known_fault_before_scan)) {
    if (typeof d.known_fault_before_scan !== "boolean") return refusal(FORM_REFUSAL.KNOWN_FAULT_INVALID, " cause=NOT_A_BOOLEAN");
    knownFault = d.known_fault_before_scan;
  }
  const battery = readBatteryHealth(d.batteryHealth);
  if (!battery.ok) return refusal(FORM_REFUSAL.BATTERY_HEALTH_INVALID, battery.extra);
  let gameTried = null;
  if (!isAbsent(d.gameTried)) {
    if (typeof d.gameTried !== "boolean") return refusal(FORM_REFUSAL.GAME_TRIED_INVALID, " cause=NOT_A_BOOLEAN");
    gameTried = d.gameTried;
  }

  // «ما الذي لاحظته؟»: نصّ؛ أيّ درجة دون «جيّد» تجعله إلزامياً (P:1193). **بلا سقف طول** (معلّق: «سقف طول observedNote ... يبقى مؤجَّلاً»).
  let observedNote = null;
  if (!isAbsent(d.observedNote)) {
    if (typeof d.observedNote !== "string") return refusal(FORM_REFUSAL.NOTE_INVALID, " cause=NOT_A_STRING");
    const t = d.observedNote.trim();
    observedNote = t === "" ? null : t;
  }
  const noteRequired = Object.values(grades.value).some((g) => BELOW_GOOD.includes(g));
  if (noteRequired && observedNote === null) return refusal(FORM_REFUSAL.NOTE_INVALID, " cause=REQUIRED_BELOW_GOOD");

  const times = readTimes(d);
  if (!times.ok) return refusal(FORM_REFUSAL.TIMES_INVALID, times.extra);

  // لقطتا تنبيه التناقض (مرّة واحدة، قبله وبعده: P:1353): كلاهما خريطة درجات أو لا شيء؛ والفعل من المفردات؛ ولا لقطة بلا فعل ولا فعل بلا لقطتين.
  let before = null;
  let after = null;
  let promptAction = null;
  if (!isAbsent(d.answersBeforePrompt) || !isAbsent(d.answersAfterPrompt) || !isAbsent(d.promptAction)) {
    if (isAbsent(d.answersBeforePrompt) || isAbsent(d.answersAfterPrompt) || isAbsent(d.promptAction)) return refusal(FORM_REFUSAL.GRADES_INVALID, " cause=PROMPT_RECORD_INCOMPLETE");
    if (typeof d.promptAction !== "string" || !PROMPT_ACTIONS.includes(d.promptAction)) return refusal(FORM_REFUSAL.GRADES_INVALID, " cause=PROMPT_ACTION_NOT_ALLOWED");
    const b = readClosedMap(d.answersBeforePrompt, GRADE_CATEGORIES, GRADE_OPTIONS);
    const a = readClosedMap(d.answersAfterPrompt, GRADE_CATEGORIES, GRADE_OPTIONS);
    if (!b.ok || !a.ok) return refusal(FORM_REFUSAL.GRADES_INVALID, ` cause=PROMPT_SNAPSHOT_${b.ok ? "AFTER" : "BEFORE"}_INVALID`);
    before = b.value;
    after = a.value;
    promptAction = d.promptAction;
  }

  const empty = Object.values(grades.value).every((v) => v === null) && Object.values(functional.value).every((v) => v === null) &&
      Object.values(defects.value).every((v) => v === null) && symptoms === null && battery.state === FORM_ANSWER_STATE.NOT_ANSWERED &&
      gameTried === null && knownFault === null && observedNote === null;
  if (empty) return refusal(FORM_REFUSAL.EMPTY, "");

  return {
    ok: true,
    form: {
      slot: d.slot,
      technicianId: d.technicianId.trim(),
      grades: grades.value,
      functional: functional.value,
      defects: defects.value,
      symptoms,
      symptomOrderShown: order.value,
      knownFaultBeforeScan: knownFault,
      batteryHealth: battery.value,
      batteryHealthState: battery.state,
      gameTried,
      observedNote,
      ...times.value,
      answersBeforePrompt: before,
      answersAfterPrompt: after,
      promptAction,
      sentOffline: d.sentOffline === true,
    },
  };
}

/**
 * المشتقّات الخادمية من الدرجات والأزمنة (القاعدة 20: تُحسب ولا تُقبل من العميل).
 * @param {{grades: Object, firstTapAt: number, submittedAt: number}} form ناتج normalizeTechnicianForm
 * @return {{allFourGradesEqual: boolean, fast: ?boolean, contradictionRules: string[]}}
 */
function deriveFormFlags(form) {
  const g = form.grades;
  const values = GRADE_CATEGORIES.map((c) => g[c]);
  const allFourGradesEqual = values.every((v) => v !== null) && values.every((v) => v === values[0]);
  const fast = Number.isFinite(form.firstTapAt) && Number.isFinite(form.submittedAt) ? (form.submittedAt - form.firstTapAt) < FAST_SUBMIT_MS : null;
  const contradictionRules = [];
  const high = g[TECHNICIAN_GRADE_CATEGORY.OVERALL] === GRADE_LEVEL.EXCELLENT || g[TECHNICIAN_GRADE_CATEGORY.OVERALL] === GRADE_LEVEL.GOOD;
  const weakCategory = [TECHNICIAN_GRADE_CATEGORY.BATTERY, TECHNICIAN_GRADE_CATEGORY.PERFORMANCE, TECHNICIAN_GRADE_CATEGORY.THERMAL].some((c) => g[c] === GRADE_LEVEL.WEAK);
  if (high && weakCategory) contradictionRules.push(FORM_CONTRADICTION_RULE.OVERALL_HIGH_WITH_WEAK_CATEGORY);
  return {allFourGradesEqual, fast, contradictionRules};
}

/**
 * العمى (P:1317-1325): هل أُرسل الحكم قبل أن يُعرض التقرير؟
 *   لا تقرير بعد ⟵ blind (أساسه REPORT_NOT_YET_CREATED، بلا مقارنة ولا ساعة).
 *   التقرير موجود: المرجع أوّل فتح (REPORT_FIRST_OPENED) وإن غاب فـreports.createdAt (CREATED_AT_FALLBACK، «القاعدة 22»)؛ وغياب المرجعين ⟵ unverifiable بلا أساس ولا ساعة.
 *   وقت الإرسال: ساعة الخادم `receivedAt`، **وساعة الجهاز `submittedAt` إن أُرسلت دون شبكة (`sentOffline`) وتُوسم clock: device** (P:1324). blind إن كان وقت الإرسال < المرجع، وإلا not_blind.
 * @param {{reportExists: boolean, reportFirstOpenedMs: ?number, reportCreatedMs: ?number, submittedMs: number, receivedMs: number, sentOffline: boolean}} p
 * @return {{blindness: string, blindnessBasis: ?string, clock: ?string}}
 */
function computeBlindness(p) {
  if (!p.reportExists) return {blindness: BLINDNESS.BLIND, blindnessBasis: BLINDNESS_BASIS_NO_REPORT, clock: null};
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  let refMs = null;
  let basis = null;
  if (num(p.reportFirstOpenedMs)) {
    refMs = p.reportFirstOpenedMs;
    basis = BLINDNESS_BASIS.REPORT_FIRST_OPENED;
  } else if (num(p.reportCreatedMs)) {
    refMs = p.reportCreatedMs;
    basis = BLINDNESS_BASIS.CREATED_AT_FALLBACK;
  }
  if (refMs === null) return {blindness: BLINDNESS.UNVERIFIABLE, blindnessBasis: null, clock: null};
  const clock = p.sentOffline ? FORM_CLOCK.DEVICE : FORM_CLOCK.SERVER;
  const sentMs = p.sentOffline ? p.submittedMs : p.receivedMs;
  return {blindness: sentMs < refMs ? BLINDNESS.BLIND : BLINDNESS.NOT_BLIND, blindnessBasis: basis, clock};
}

module.exports = {
  FORM_SLOT, FAST_SUBMIT_MS, MAX_PER_ANSWER_ENTRIES, GRADE_CATEGORIES, SYMPTOM_CHIPS, FORM_CLOCK, PROMPT_ACTION, BATTERY_HEALTH_ANSWERED, BLINDNESS_BASIS_NO_REPORT,
  isSafeDocId, normalizeTechnicianForm, deriveFormFlags, computeBlindness,
};
