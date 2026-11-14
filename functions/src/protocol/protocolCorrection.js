"use strict";

// ===================================================
// protocolCorrection — التصحيح بالإلحاق: تحقّق المدخل، وقراءة علامة الاستبعاد، وقرار كل فعل (S-P6-18، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-٥ (:854-868) وdocs/PROTOCOL_CONTRACT.md §٢ A11 (إلحاق مؤرَّخ بكل شكل سلك وما بُني وما عُلِّق):
//   «**دالّة مشرف `correctProtocolRecord`** بأفعال: `unlink`، و`relink(toScanId)`. و`exclude(reason ∈ {test, wrong, golden_reference})`، و`unexclude`. و`resolveIdentityConflict`.
//    **كل فعل:** **يكتب علامة على scanProtocol** (`exclusion: {state, reasonCode, at}`، `linkState`). **ويُلحق سطراً في protocolCorrections** بالقيم قبل وبعد، و**رمز سبب** (القرار ١٢)، والمشرف مُهشَّراً.
//    **لا حذف بأيّ وسيلة** (القاعدة 42).» (:856-864) و«**وكل قارئ** (اللوحة، واللقطات، والتوصيات) **يحترم العلامة ويعدّ المستبعد منفصلاً.**» (:868)
//   و«**[اجتهاد] فحوص هذه القائمة أقدم من scanProtocol** (P6-03). **فالاستبعاد يقوم على رمز التقرير و`scanId`،** لا على سجلّ بروتوكول غير موجود لها.» (:867) — E16 (معتمد 2026-10-15): **تُسجَّل في protocolCorrections وحدها**،
//   ولا يُنشأ لها مستند scanProtocol شكلي؛ «والقرّاء الذين يعدّون فحوصاً أقدم يستعلمون protocolCorrections بمساواة على `scanId`».
// **دوالّ نقيّة بلا I/O** (القاعدة 41)؛ الكتابة (معاملة + سطر ملحَق + علامة) في admin/protocolCorrectionAdmin.js. أسماء الحقول (`exclusion` · `linkState` · `linkedScanId` · `scanId` …) حرفيّات هنا وحدها (E36)
// ومصدرها الواحد SCAN_PROTOCOL_FIELD وCORRECTION_LINE_FIELD: كاتب scanProtocol (scanProtocolDocument.js) وقارئ العلامة (readExclusion) يستوردانها (القاعدة 24).
//
// ما تقرّره هذه الوحدة (قراراتي، القاعدة 45؛ كلّها في A11 للمراجعة):
//   (١) **الأساس** (`basis`): scanProtocol موجود ⟵ SCAN_PROTOCOL (العلامة + السطر)؛ وغير موجود (فحص أقدم، E16) ⟵ REPORT_ONLY (السطر وحده)، ولا يقبل غير exclude/unexclude (لا ربط بلا سجلّ بروتوكول).
//   (٢) **الحالة الراهنة لفحص بلا scanProtocol** تُشتقّ من آخر سطر له في protocolCorrections بترتيب `seq` (عدّاد لكل scanId تحسبه المعاملة نفسها)؛ ولفحص له scanProtocol من العلامة.
//   (٣) **غير المتغيّر لا يُكتب** (على نسق setProtocolSettings): exclude بالسبب نفسه على مستبعَد، وunexclude على غير مستبعَد، وrelink إلى الهدف نفسه بالحالة نفسها ⟵ changed:false بلا سطر ولا علامة.
//   (٤) **unlink** لا يمسّ `linkedScanId` ولا `linkMethod` («تصحيح المشرف لا يغيّر `linkMethod`، بل `linkState` وسجلّ التصحيح [اجتهاد]»، :491): يغيّر `linkState` إلى unlink المشرف وحده، والقيمة القديمة في السطر؛ ومن حالات الربط الحيّة وحدها (active · relinked_by_admin).
//   (٥) **relink** يكتب `linkedScanId = toScanId` و`linkState = relinked_by_admin`، والهدف يجب أن يكون له scanProtocol وألّا يكون الفحص نفسه. **قواعد الأزواج** (غرض الطرفين، حالة الزوج، الملكية: P6-05 §٣) **غير مبنيّة** فلا تُفحَص هنا (معلّق، A11).
//   (٦) **resolveIdentityConflict** مسمّى في المفردات ومرفوض برفض مسمّى ACTION_NOT_SPECIFIED: لا مواصفة لمُدخلاته ولا لأثره (التصميم يسمّيه ولا يصفه) وهو يتبع هويّة الجهاز (S-P6-01، مفتاح HMAC).
//   (٧) **رمز السبب** إلزامي لـexclude (`test` · `wrong` · `golden_reference`) ويُرفض لغيره (FIELD_NOT_APPLICABLE)؛ ولا قائمة أسباب في التصميم لـunlink وrelink وunexclude فيُكتب `reasonCode: null` صريحاً (معلّق، A11).
//   (٨) **المدخل صارم**: مفتاح مجهول ⟵ FIELD_UNKNOWN، ومفتاح لا ينطبق على الفعل ⟵ FIELD_NOT_APPLICABLE؛ ولا يُقبل scanId وshortId معاً.
//   (٩) **ملاحظة الطراز `linkModelCheck`** (ق36 أ، أقرّه حسن 2026-10-22؛ القاعدتان 20 و33: مخرَج عملية لا يبقى قديماً بعد تغيّر مدخلها): الحقل مستخلَص من ربط (تقرير «بعد» ⟷ تقرير الهدف) فلا يبقى بعد تغيّر الربط.
//       **unlink يُبطله صراحةً** (null في العلامة نفسها مع linkState، لا حذف)؛ **relink يعيد حسابه للهدف الجديد** والمعامل `linkModelCheck` يحسبه المستدعي بقراءة التقريرين داخل المعاملة (maintenancePair.decideLinkModelCheck: مصدر واحد مع الاكتمال)،
//       ويُشترط حالةً صالحةً من LINK_MODEL_CHECK حين يكتب relink (غيابها خطأ برمجي لا قيمة افتراضية: القاعدة 22؛ والرفض وNOOP لا يحتاجانه). ويحمل `before`/`after` في سطر unlink وrelink `linkModelCheck` (القيمة المخزَّنة المعروفة أو null)؛ exclude/unexclude لا يمسّانه ولا يضيفانه إلى سطرهما.

const {CORRECTION_ACTION, EXCLUSION_REASON, EXCLUSION_STATE, LINK_STATE, LINK_MODEL_CHECK} = require("./protocolVocabulary");

/** أسماء حقول scanProtocol التي يكتبها أكثر من موضع (E36: حرفيّات في الوحدة المالكة، مصدر واحد مُصدَّر لها). */
const SCAN_PROTOCOL_FIELD = Object.freeze({
  LINKED_SCAN_ID: "linkedScanId",
  LINK_STATE: "linkState",
  EXCLUSION: "exclusion",
  // (2026-10-22، أمر ربط «قبل/بعد صيانة»: A2 وA3 وA11) حقول يكتبها أكثر من موضع: كاتب scanProtocol (scanProtocolDocument.js) وفتح الزوج واكتماله (maintenancePair.js وanalyzeDevice) واتّساق التصحيح (protocolCorrectionAdmin.js)؛
  // وprotocolPending يحمل linkedScanId وlinkMethod وdefectType بالأسماء نفسها (مصدر واحد: القاعدة 24).
  LINK_METHOD: "linkMethod",
  DEFECT_TYPE: "defectType",
  PAIR: "pair",
  SCAN_PURPOSE: "scanPurpose", // (S4) يقرؤه ترشيح «قبل» في maintenancePair.classifyOpenBefore؛ وكاتبه scanProtocolDocument يستورده (مصدر واحد)
  // (ق36 أ، 2026-10-22، أقرّه حسن) ملاحظة الطراز على سجلّ «بعد»: null صريحاً في المستند الجديد، وتكتب حالتها معاملة اكتمال analyzeDevice (maintenancePair.decidePairCompletion) وrelink التصحيح (decideCorrection)؛ ويُبطلها unlink. **خادمية: لا تصل السلك**.
  LINK_MODEL_CHECK: "linkModelCheck",
});

/** حالات ملاحظة الطراز المقروءة من مستند مخزَّن (ما خرج عن المفردات لا يُعدّ ملاحظة: يُسجَّل null في السطر ويُبطَل عند unlink). */
const LINK_MODEL_CHECK_STATES = Object.freeze(Object.values(LINK_MODEL_CHECK));

/** أسماء حقول سطر protocolCorrections (يقرؤها دوالّ المشرف). */
const CORRECTION_LINE_FIELD = Object.freeze({
  SCAN_ID: "scanId",
  ACTION: "action",
  REASON_CODE: "reasonCode",
  BASIS: "basis",
  BEFORE: "before",
  AFTER: "after",
  SEQ: "seq",
  AT: "at",
  BY: "by",
});

/** أساس التصحيح (اقتراحي): ما يحمل الحالة الراهنة. */
const CORRECTION_BASIS = Object.freeze({
  SCAN_PROTOCOL: "SCAN_PROTOCOL",
  REPORT_ONLY: "REPORT_ONLY",
});

/** ما تعيده readExclusion: القيمتان المعتمدتان (E45) وحالتا غياب صريحتان (القاعدة 22). */
const EXCLUSION_READ_STATE = Object.freeze({
  EXCLUDED: EXCLUSION_STATE.EXCLUDED,
  NOT_EXCLUDED: EXCLUSION_STATE.NOT_EXCLUDED,
  NOT_RECORDED: "NOT_RECORDED", // لا علامة ولا سطر: لم يُصحَّح فحصٌ قطّ
  UNREADABLE: "UNREADABLE", // علامة أو سطر بشكل لا يُقرأ: لا يُخمَّن
});

/** رموز رفض correctProtocolRecord (اقتراحي: لا رمز معتمداً لها؛ الاسم الوحيد من التصميم هو الدالّة وأفعالها). */
const CORRECTION_REFUSAL = Object.freeze({
  ACTION_REQUIRED: "CORRECTION_ACTION_REQUIRED",
  ACTION_INVALID: "CORRECTION_ACTION_INVALID",
  ACTION_NOT_SPECIFIED: "CORRECTION_ACTION_NOT_SPECIFIED", // resolveIdentityConflict: مواصفة غائبة
  FIELD_UNKNOWN: "CORRECTION_FIELD_UNKNOWN",
  FIELD_NOT_APPLICABLE: "CORRECTION_FIELD_NOT_APPLICABLE",
  TARGET_REQUIRED: "CORRECTION_TARGET_REQUIRED", // لا scanId ولا shortId
  TARGET_AMBIGUOUS: "CORRECTION_TARGET_AMBIGUOUS", // الاثنان معاً
  SCAN_ID_INVALID: "CORRECTION_SCAN_ID_INVALID",
  SHORT_ID_INVALID: "CORRECTION_SHORT_ID_INVALID",
  SCAN_NOT_FOUND: "CORRECTION_SCAN_NOT_FOUND", // لا scanProtocol ولا تقرير بهذا المعرّف
  SHORT_ID_NOT_FOUND: "CORRECTION_SHORT_ID_NOT_FOUND",
  SHORT_ID_AMBIGUOUS: "CORRECTION_SHORT_ID_AMBIGUOUS", // أكثر من تقرير بالرمز نفسه (كما A3: بلا limit(1))
  REASON_REQUIRED: "CORRECTION_REASON_REQUIRED",
  REASON_INVALID: "CORRECTION_REASON_INVALID",
  TO_SCAN_ID_REQUIRED: "CORRECTION_TO_SCAN_ID_REQUIRED",
  TO_SCAN_ID_INVALID: "CORRECTION_TO_SCAN_ID_INVALID",
  RELINK_SELF: "CORRECTION_RELINK_SELF",
  RELINK_TARGET_NOT_FOUND: "CORRECTION_RELINK_TARGET_NOT_FOUND",
  NO_PROTOCOL_RECORD: "CORRECTION_NO_PROTOCOL_RECORD", // ربط على فحص بلا scanProtocol
  NOT_LINKED: "CORRECTION_NOT_LINKED",
  LINK_STATE_UNKNOWN: "CORRECTION_LINK_STATE_UNKNOWN",
  EXCLUSION_UNREADABLE: "CORRECTION_EXCLUSION_UNREADABLE", // علامة أو سطر سابق لا يُقرأ: لا يُكتب فوقه ولا يُخمَّن ما بعده
});

const ALL_ACTIONS = Object.values(CORRECTION_ACTION);
const ALL_REASONS = Object.values(EXCLUSION_REASON);
const ALL_LINK_STATES = Object.values(LINK_STATE);
const LIVE_LINK_STATES = Object.freeze([LINK_STATE.ACTIVE, LINK_STATE.RELINKED_BY_ADMIN]);
const SHORT_ID_RE = /^NC-[A-Z0-9]{4,12}$/;
const MAX_ID_LENGTH = 200;
const KNOWN_KEYS = Object.freeze(["action", "scanId", "shortId", "toScanId", "reason"]);

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";
const isTimestampLike = (v) => v !== null && typeof v === "object" && typeof v.toMillis === "function" && Number.isFinite(v.toMillis());
const refusal = (reason, field = null, extra = "") => ({ok: false, refusal: reason, field, extra});
/** معرّف مستند صالح: نصّ مشذَّب غير فارغ بلا `/` ولا نقطتين وحدهما (معرّفات Firestore). */
const validDocId = (s) => typeof s === "string" && s.trim() === s && s !== "" && s.length <= MAX_ID_LENGTH && !s.includes("/") && s !== "." && s !== "..";

/**
 * مدخل correctProtocolRecord. الفحص بالترتيب: كائن ← مفاتيح مجهولة ← الفعل ← الهدف ← ما ينطبق على الفعل.
 * @param {*} d request.data
 * @return {{ok: true, action: string, scanId: ?string, shortId: ?string, toScanId: ?string, reason: ?string}|{ok: false, refusal: string, field: ?string, extra: string}}
 */
function validateCorrectionInput(d) {
  const R = CORRECTION_REFUSAL;
  const data = isObj(d) ? d : {};
  for (const k of Object.keys(data)) if (!KNOWN_KEYS.includes(k)) return refusal(R.FIELD_UNKNOWN, k);
  if (data.action === undefined || data.action === null || data.action === "") return refusal(R.ACTION_REQUIRED, "action");
  if (typeof data.action !== "string" || !ALL_ACTIONS.includes(data.action)) return refusal(R.ACTION_INVALID, "action");
  const action = data.action;
  if (action === CORRECTION_ACTION.RESOLVE_IDENTITY_CONFLICT) return refusal(R.ACTION_NOT_SPECIFIED, "action");
  const hasScan = data.scanId !== undefined && data.scanId !== null;
  const hasShort = data.shortId !== undefined && data.shortId !== null;
  if (hasScan && hasShort) return refusal(R.TARGET_AMBIGUOUS);
  if (!hasScan && !hasShort) return refusal(R.TARGET_REQUIRED);
  let scanId = null;
  let shortId = null;
  if (hasScan) {
    if (!validDocId(data.scanId)) return refusal(R.SCAN_ID_INVALID, "scanId");
    scanId = data.scanId;
  } else {
    if (typeof data.shortId !== "string") return refusal(R.SHORT_ID_INVALID, "shortId");
    const normalized = data.shortId.trim().toUpperCase();
    if (!SHORT_ID_RE.test(normalized)) return refusal(R.SHORT_ID_INVALID, "shortId");
    shortId = normalized;
  }
  const given = (k) => data[k] !== undefined && data[k] !== null;
  let reason = null;
  let toScanId = null;
  if (action === CORRECTION_ACTION.EXCLUDE) {
    if (given("toScanId")) return refusal(R.FIELD_NOT_APPLICABLE, "toScanId");
    if (data.reason === undefined || data.reason === null || data.reason === "") return refusal(R.REASON_REQUIRED, "reason");
    if (typeof data.reason !== "string" || !ALL_REASONS.includes(data.reason)) return refusal(R.REASON_INVALID, "reason");
    reason = data.reason;
  } else if (action === CORRECTION_ACTION.RELINK) {
    if (given("reason")) return refusal(R.FIELD_NOT_APPLICABLE, "reason");
    if (data.toScanId === undefined || data.toScanId === null || data.toScanId === "") return refusal(R.TO_SCAN_ID_REQUIRED, "toScanId");
    if (!validDocId(data.toScanId)) return refusal(R.TO_SCAN_ID_INVALID, "toScanId");
    toScanId = data.toScanId;
  } else {
    if (given("reason")) return refusal(R.FIELD_NOT_APPLICABLE, "reason");
    if (given("toScanId")) return refusal(R.FIELD_NOT_APPLICABLE, "toScanId");
  }
  return {ok: true, action, scanId, shortId, toScanId, reason};
}

/**
 * يقرأ علامة الاستبعاد من مستند scanProtocol. الغائب ABSENT؛ والعلامة المقروءة بحالة من EXCLUSION_STATE وسبب (نصّ من EXCLUSION_REASON حين excluded، وnull حين not_excluded) ووقت خادم؛ غير ذلك UNREADABLE.
 * @param {?Object} protocolData
 * @return {{state: string, exclusion: ?{state: string, reasonCode: ?string}}} state: ABSENT | PRESENT | UNREADABLE
 */
function readExclusionMarker(protocolData) {
  const raw = isObj(protocolData) ? protocolData[SCAN_PROTOCOL_FIELD.EXCLUSION] : undefined;
  if (raw === undefined || raw === null) return {state: "ABSENT", exclusion: null};
  if (!isObj(raw) || !isTimestampLike(raw.at)) return {state: "UNREADABLE", exclusion: null};
  if (raw.state === EXCLUSION_STATE.EXCLUDED && typeof raw.reasonCode === "string" && ALL_REASONS.includes(raw.reasonCode)) {
    return {state: "PRESENT", exclusion: {state: EXCLUSION_STATE.EXCLUDED, reasonCode: raw.reasonCode}};
  }
  if (raw.state === EXCLUSION_STATE.NOT_EXCLUDED && raw.reasonCode === null) {
    return {state: "PRESENT", exclusion: {state: EXCLUSION_STATE.NOT_EXCLUDED, reasonCode: null}};
  }
  return {state: "UNREADABLE", exclusion: null};
}

const isExclusionShape = (e) => isObj(e) && ((e.state === EXCLUSION_STATE.EXCLUDED && typeof e.reasonCode === "string" && ALL_REASONS.includes(e.reasonCode)) ||
    (e.state === EXCLUSION_STATE.NOT_EXCLUDED && e.reasonCode === null));

/**
 * الحالة الراهنة من سطور protocolCorrections لفحص (آخر سطر بترتيب seq). السطر المقروء: seq عدد صحيح ≥ 1 فريد، وafter.exclusion بشكل معروف أو null؛ غير ذلك UNREADABLE.
 * @param {Array<?Object>} lines بيانات السطور (بلا ترتيب مفترض)
 * @return {{state: string, exclusion: ?{state: string, reasonCode: ?string}, nextSeq: ?number}} state: ABSENT (لا سطور) | PRESENT | UNREADABLE
 */
function readExclusionFromLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return {state: "ABSENT", exclusion: null, nextSeq: 1};
  const seen = new Set();
  let last = null;
  for (const line of lines) {
    if (!isObj(line) || !Number.isInteger(line[CORRECTION_LINE_FIELD.SEQ]) || line[CORRECTION_LINE_FIELD.SEQ] < 1 || seen.has(line[CORRECTION_LINE_FIELD.SEQ])) {
      return {state: "UNREADABLE", exclusion: null, nextSeq: null};
    }
    const after = line[CORRECTION_LINE_FIELD.AFTER];
    if (!isObj(after) || !(after.exclusion === null || isExclusionShape(after.exclusion))) return {state: "UNREADABLE", exclusion: null, nextSeq: null};
    seen.add(line[CORRECTION_LINE_FIELD.SEQ]);
    if (last === null || line[CORRECTION_LINE_FIELD.SEQ] > last[CORRECTION_LINE_FIELD.SEQ]) last = line;
  }
  return {state: "PRESENT", exclusion: last[CORRECTION_LINE_FIELD.AFTER].exclusion, nextSeq: Math.max(...seen) + 1};
}

/**
 * **القارئ الواحد لحالة الاستبعاد** (القاعدة 24: كل قارئ — اللوحة واللقطات والتوصيات — يستورده ولا يقرأ `exclusion` بنفسه: «كل قارئ يحترم العلامة ويعدّ المستبعد منفصلاً»، :868).
 * لفحص له scanProtocol: العلامة؛ ولفحص أقدم منه (E16): آخر سطر في protocolCorrections لـscanId. الغياب حالة صريحة NOT_RECORDED لا «غير مستبعَد» صامتاً.
 * @param {{protocolData: ?Object, correctionLines: Array<?Object>}} p
 * @return {{state: string, reasonCode: ?string}} state من EXCLUSION_READ_STATE
 */
function readExclusion({protocolData, correctionLines}) {
  if (protocolData !== null && protocolData !== undefined) {
    const m = readExclusionMarker(protocolData);
    if (m.state === "UNREADABLE") return {state: EXCLUSION_READ_STATE.UNREADABLE, reasonCode: null};
    if (m.state === "PRESENT") return {state: m.exclusion.state, reasonCode: m.exclusion.reasonCode};
    return {state: EXCLUSION_READ_STATE.NOT_RECORDED, reasonCode: null};
  }
  const l = readExclusionFromLines(correctionLines);
  if (l.state === "UNREADABLE") return {state: EXCLUSION_READ_STATE.UNREADABLE, reasonCode: null};
  if (l.state === "ABSENT" || l.exclusion === null) return {state: EXCLUSION_READ_STATE.NOT_RECORDED, reasonCode: null};
  return {state: l.exclusion.state, reasonCode: l.exclusion.reasonCode};
}

const OUTCOME = Object.freeze({REFUSED: "REFUSED", NOOP: "NOOP", WRITE: "WRITE"});

/**
 * قرار فعل واحد على فحص (دالّة نقيّة): الأساس، ثم الحالة الراهنة، ثم الشروط، ثم القيم بعد.
 * @param {Object} p
 * @param {{action: string, scanId: string, toScanId: ?string, reason: ?string}} p.input مدخل مُتحقَّق منه (validateCorrectionInput) وقد حُلَّ scanId
 * @param {?Object} p.protocolData مستند scanProtocol/{scanId} (null إن لم يوجد)
 * @param {boolean} p.reportExists هل reports/{scanId} موجود (يُقرأ حين لا scanProtocol)
 * @param {Array<?Object>} p.correctionLines سطور protocolCorrections لـscanId
 * @param {?boolean} p.toProtocolExists هل scanProtocol/{toScanId} موجود (لـrelink)
 * @param {string} [p.linkModelCheck] (ق36 أ) حالة الطراز المحسوبة للهدف الجديد (إحدى LINK_MODEL_CHECK): **مطلوبة لـrelink الذي يكتب** (خطأ برمجي إن غابت أو خرجت عن المفردات)؛ غير مستعملة لغيره
 * @return {{outcome: string, refusal?: string, extra?: string, basis?: string, before?: Object, after?: Object, markerFields?: ?Object, reasonCode?: ?string, seq?: number}}
 */
function decideCorrection({input, protocolData, reportExists, correctionLines, toProtocolExists, linkModelCheck}) {
  const R = CORRECTION_REFUSAL;
  const {action} = input;
  const hasProtocol = protocolData !== null && protocolData !== undefined;
  if (!hasProtocol && !reportExists) return {outcome: OUTCOME.REFUSED, refusal: R.SCAN_NOT_FOUND};
  const basis = hasProtocol ? CORRECTION_BASIS.SCAN_PROTOCOL : CORRECTION_BASIS.REPORT_ONLY;
  const isLinkAction = action === CORRECTION_ACTION.UNLINK || action === CORRECTION_ACTION.RELINK;
  if (isLinkAction && !hasProtocol) return {outcome: OUTCOME.REFUSED, refusal: R.NO_PROTOCOL_RECORD, extra: ` basis=${basis}`};

  const lines = readExclusionFromLines(correctionLines);
  if (lines.state === "UNREADABLE") return {outcome: OUTCOME.REFUSED, refusal: R.EXCLUSION_UNREADABLE, extra: " source=LINES"};
  let current = null; // الاستبعاد الراهن: null (لا علامة) أو {state, reasonCode}
  if (hasProtocol) {
    const m = readExclusionMarker(protocolData);
    if (m.state === "UNREADABLE") return {outcome: OUTCOME.REFUSED, refusal: R.EXCLUSION_UNREADABLE, extra: " source=MARKER"};
    current = m.exclusion;
  } else {
    current = lines.exclusion;
  }
  const currentLinkState = hasProtocol ? protocolData[SCAN_PROTOCOL_FIELD.LINK_STATE] : null;
  const currentLinked = hasProtocol && isNonEmptyString(protocolData[SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID]) ? protocolData[SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID] : null;
  const before = {exclusion: current, linkState: hasProtocol && typeof currentLinkState === "string" ? currentLinkState : null, linkedScanId: currentLinked};
  const seq = lines.nextSeq;
  const write = (after, markerFields, reasonCode, beforeOf = before) => ({outcome: OUTCOME.WRITE, basis, before: beforeOf, after, markerFields, reasonCode, seq});
  const noop = () => ({outcome: OUTCOME.NOOP, basis, before, after: before, reasonCode: null});

  if (action === CORRECTION_ACTION.EXCLUDE) {
    if (current !== null && current.state === EXCLUSION_STATE.EXCLUDED && current.reasonCode === input.reason) return noop();
    const next = {state: EXCLUSION_STATE.EXCLUDED, reasonCode: input.reason};
    return write({...before, exclusion: next}, hasProtocol ? {[SCAN_PROTOCOL_FIELD.EXCLUSION]: next} : null, input.reason);
  }
  if (action === CORRECTION_ACTION.UNEXCLUDE) {
    if (current === null || current.state !== EXCLUSION_STATE.EXCLUDED) return noop();
    const next = {state: EXCLUSION_STATE.NOT_EXCLUDED, reasonCode: null};
    return write({...before, exclusion: next}, hasProtocol ? {[SCAN_PROTOCOL_FIELD.EXCLUSION]: next} : null, null);
  }
  // الربط: يحتاج scanProtocol (حُسم أعلاه) وحالة ربط معروفة (القاعدة 22: لا تُخمَّن)
  if (typeof currentLinkState !== "string" || !ALL_LINK_STATES.includes(currentLinkState)) {
    return {outcome: OUTCOME.REFUSED, refusal: R.LINK_STATE_UNKNOWN, extra: ` linkState=${currentLinkState === undefined ? "ABSENT" : currentLinkState === null ? "NULL" : typeof currentLinkState === "string" ? "UNRECOGNIZED" : "NOT_A_STRING"}`};
  }
  // (ق36 أ) سطرا unlink وrelink يحملان linkModelCheck (المخزَّن المعروف أو null) في before/after؛ exclude/unexclude بشكلهما القديم
  const storedModelCheck = LINK_MODEL_CHECK_STATES.includes(protocolData[SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]) ? protocolData[SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK] : null;
  const beforeLink = {...before, [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: storedModelCheck};
  if (action === CORRECTION_ACTION.UNLINK) {
    if (!LIVE_LINK_STATES.includes(currentLinkState) || currentLinked === null) return {outcome: OUTCOME.REFUSED, refusal: R.NOT_LINKED, extra: ` linkState=${currentLinkState} linked=${currentLinked === null ? "ABSENT" : "PRESENT"}`};
    // unlink يُبطل ملاحظة الطراز بـnull صريح (لا حذف: القاعدة 42) في المعاملة نفسها مع linkState؛ والقيمة القديمة تبقى في before من السطر الملحَق
    return write(
        {...beforeLink, linkState: LINK_STATE.UNLINKED_BY_ADMIN, [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: null},
        {[SCAN_PROTOCOL_FIELD.LINK_STATE]: LINK_STATE.UNLINKED_BY_ADMIN, [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: null}, null, beforeLink);
  }
  // RELINK
  if (input.toScanId === input.scanId) return {outcome: OUTCOME.REFUSED, refusal: R.RELINK_SELF};
  if (toProtocolExists !== true) return {outcome: OUTCOME.REFUSED, refusal: R.RELINK_TARGET_NOT_FOUND};
  if (currentLinkState === LINK_STATE.RELINKED_BY_ADMIN && currentLinked === input.toScanId) return noop();
  // relink يعيد حساب ملاحظة الطراز للهدف الجديد: الحالة يحسبها المستدعي (قرأ التقريرين في المعاملة)؛ وغيابها أو خروجها عن المفردات خطأ برمجي لا قيمة افتراضية (القاعدة 22)
  if (!LINK_MODEL_CHECK_STATES.includes(linkModelCheck)) throw new Error(`decideCorrection: relink يلزمه linkModelCheck حالةً من LINK_MODEL_CHECK (${LINK_MODEL_CHECK_STATES.join(" · ")}) — الواصل ${linkModelCheck === undefined ? "undefined" : JSON.stringify(linkModelCheck)}`);
  return write(
      {...beforeLink, linkState: LINK_STATE.RELINKED_BY_ADMIN, linkedScanId: input.toScanId, [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: linkModelCheck},
      {[SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID]: input.toScanId, [SCAN_PROTOCOL_FIELD.LINK_STATE]: LINK_STATE.RELINKED_BY_ADMIN, [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: linkModelCheck}, null, beforeLink);
}

/**
 * سطر protocolCorrections الذي يُلحَق (بالمفاتيح CORRECTION_LINE_FIELD). **الحقول التسعة بالضبط**؛ `at` وقت الخادم يُمرَّر صراحةً، و`by` المشرف مُهشَّراً يُمرَّر.
 * @param {{scanId: string, decision: Object, action: string, at: *, by: string}} p
 * @return {Object}
 */
function buildCorrectionLine({scanId, decision, action, at, by}) {
  const F = CORRECTION_LINE_FIELD;
  return {
    [F.SCAN_ID]: scanId, [F.ACTION]: action, [F.REASON_CODE]: decision.reasonCode, [F.BASIS]: decision.basis,
    [F.BEFORE]: decision.before, [F.AFTER]: decision.after, [F.SEQ]: decision.seq, [F.AT]: at, [F.BY]: by,
  };
}

module.exports = {
  SCAN_PROTOCOL_FIELD, CORRECTION_LINE_FIELD, CORRECTION_BASIS, EXCLUSION_READ_STATE, CORRECTION_REFUSAL, OUTCOME, LIVE_LINK_STATES,
  validateCorrectionInput, readExclusionMarker, readExclusionFromLines, readExclusion, decideCorrection, buildCorrectionLine,
};
