"use strict";

// ===================================================
// repeatScan — عقد التكرار البارد والساخن: الاختيار والتصنيف والإعفاء والتفويض (S-P6-07، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٤ (:596-681) وdocs/PROTOCOL_CONTRACT.md §٢ A4 (الذي يحمل نصّها المقتبس وما بُني وما عُلِّق في إلحاق مؤرَّخ). **دوالّ نقيّة بلا I/O** (القاعدة 41: تُختبَر بلا Firestore)؛
// المفردات من protocolVocabulary.js (مصدر واحد: القاعدة 24)، **وأسماء الحقول حرفيّات هنا وحدها** (E36: لا تُصدَّر من الوحدة).
//
// ما تقرّره هذه الوحدة:
//   (١) سجلّ الاختيار `repeat` في scanProtocol/{scanId} (P:617-621، E8): {state, reason, draw, rate, settingsVersion, decidedAt} + `firstScanStartTemp` (E8) + `priorRepeatCheck` (اقتراحي). بنصّ P:619 الشروط: «الغرض `normal`،
//       والمحلّ مفعَّل له التكرار، والهاتف بلا تكرار سابق مكتمل [اجتهاد]» + E44 («يُخفى العرض بسبب «not eligible» جديد»: الأمّ بلا joinedBy).
//       **الشرط الثالث لا يُقيَّم اليوم** (معلّق: يحتاج هويّة الجهاز deviceId — S-P6-01، ومفتاح HMAC بيد المستخدم، A1): تُعلَن حالته في `priorRepeatCheck` (NOT_EVALUATED) ولا يُقرأ نجاحاً ولا فشلاً (القاعدة 22).
//   (٢) التصنيف (P:645-648، P:669): الخادم يصنّف الفحص الثاني `repeat_cold` إن كان |حرارة البدء الثانية − الأولى| ≤ 1° وإلّا `repeat_hot`؛ وغياب الأولى ⟵ `repeat_unclassified` بحالة COOLING_REFERENCE_ABSENT (التصميم)،
//       وغياب الثانية ⟵ `repeat_unclassified` بحالة SECOND_START_TEMP_ABSENT (اقتراحي: التصميم لا يذكر غياب الثانية). **الحدّ ±1° مصدره القرار ٣ بنصّه** (P:599: «إلا إذا عادت حرارة البطارية إلى ±1° من بداية الفحص الأول»).
//   (٣) إعفاء الخصم PROTOCOL_EXEMPT (P:657، س٢٠): «لا خصم للتكرار البارد ... في مرحلة الجمع» — **للتكرار البارد وحده** حرفياً؛ الساخن وغير المصنَّف يُخصمان (معلّق: قرار المستخدم، A4). **ق10 (2026-10-23): ويشمل الإعفاء فحص «بعد» (`maintenance_after`) بالآلية نفسها — isAfterScanCreditExempt أدناه؛ المرتجع لم يُبنَ.**
//   (٤) التفويض: «التفويض بالزوج (`sessionId`، `scanId`): جلسة `completed` بالفحص نفسه، ومختار للتكرار، ولم يبدأ. لا بـ`joinedBy`» (P:640-641)؛ ورفض E41 المعتمد: الأمّ بلا joinedBy ⟵ REPEAT_PARENT_JOINER_UNKNOWN.
//
// القاعدة 22 — الغياب حالة صريحة: حرارة البدء في الترويسة تأتي `0.0` حين لا بثّ (docs/FV68_CONTRACT.md §١.٦: «`batteryTempStart` | Float | `0.0` إن لم يصل بثّ») فالصفر **حارس غياب** لا قياس (SENTINEL_ZERO)، لا يدخل حساب فرق.
// الحرارة بالدرجة المئوية كما في الترويسة (Float، 32.8 في العيّنة الذهبية؛ E8: وحدة firstScanStartTemp «تُحسم في أمر P6-07 بمطابقة حقل البدء في reportRaw» ⟵ حُسمت: °C، `fingerprint.timeSeries.header.batteryTempStart`).

const {
  REPEAT_STATE, REPEAT_ABSENCE_STATE, REPEAT_NOT_ELIGIBLE_REASON, REPEAT_REFUSAL, SCAN_PURPOSE, PURPOSE_SOURCE, PROTOCOL_PART,
} = require("./protocolVocabulary");
const {decideSelection} = require("./protocolSelection");
const {SETTINGS_FIELD, FIELD_STATE} = require("./protocolSettings");
const {SESSION_STATUS, JOIN_REFUSAL} = require("../sessions/sessionNames");
const {STATUS_STATE, classifyStatus} = require("../sessions/sessionLifecycle");

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v !== "";

/** «±1°» — القرار ٣ بنصّه (PLAN-06:599). مصدر الرقم الوحيد هنا (القاعدة 5/24). */
const REPEAT_COLD_THRESHOLD_C = 1;

/** عُشر الدرجة: دقّة قراءة الحرارة (BatteryManager EXTRA_TEMPERATURE بعُشر درجة) — تُقرَّب القيم إلى عُشر قبل الفرق كي لا يقلب ضجيج الفاصلة العائمة الحدّ (32.2 − 31.2 = 1.0000000000000036 بالفاصلة العائمة). */
const TEMP_RESOLUTION_PER_C = 10;

/** حالات الجلسة الأمّ التي يجوز منها بدء التكرار: «مختار للتكرار، ولم يبدأ» (P:640). DECLINED («ليس الآن») وWAITING_COOLING وPROMPT_DELIVERED كلّها «مختار ولم يبدأ». */
const REPEAT_STARTABLE_STATES = Object.freeze([
  REPEAT_STATE.SELECTED, REPEAT_STATE.PROMPT_DELIVERED, REPEAT_STATE.WAITING_COOLING, REPEAT_STATE.DECLINED,
]);
/** حالات «بدأ أو انتهى». */
const REPEAT_STARTED_OR_DONE_STATES = Object.freeze([
  REPEAT_STATE.STARTED, REPEAT_STATE.COMPLETED_COLD, REPEAT_STATE.COMPLETED_HOT, REPEAT_STATE.COMPLETED_UNCLASSIFIED, REPEAT_STATE.EXPIRED,
]);

// ─── حرارة البدء ─────────────────────────────────────────────────────────────────────────────────────────────────

/** حالة قراءة حرارة البدء. اقتراحي (E8 يعتمد الاسم firstScanStartTemp وحده؛ حالاته لم تُسمَّ). */
const START_TEMP_STATE = Object.freeze({
  PRESENT: "PRESENT",
  ABSENT: "ABSENT", // الحقل غائب أو null
  SENTINEL_ZERO: "SENTINEL_ZERO", // 0.0: حارس الغياب في الترويسة
  NOT_A_NUMBER: "NOT_A_NUMBER", // نصّ أو منطقي أو غير منتهٍ
  STORED_MALFORMED: "STORED_MALFORMED", // المخزَّن في سجلّ الاختيار لا يحمل شكل {state, valueC}
});

/**
 * @param {*} raw القيمة كما وصلت في header.batteryTempStart
 * @return {{state: string, valueC: ?number}} valueC هي القيمة الخام كما أُرسلت حين تكون عدداً منتهياً (ولو حارس الصفر)، وإلا null
 */
function readStartTemp(raw) {
  if (raw === undefined || raw === null) return {state: START_TEMP_STATE.ABSENT, valueC: null};
  if (typeof raw !== "number" || !Number.isFinite(raw)) return {state: START_TEMP_STATE.NOT_A_NUMBER, valueC: null};
  if (raw === 0) return {state: START_TEMP_STATE.SENTINEL_ZERO, valueC: 0};
  return {state: START_TEMP_STATE.PRESENT, valueC: raw};
}

/**
 * قراءة ما خُزِّن بشكل {state, valueC} (في repeat.firstScanStartTemp أو protocolPending): الغائب أو المشوَّه حالة صريحة.
 * @param {*} stored
 * @return {{state: string, valueC: ?number}}
 */
function readStoredStartTemp(stored) {
  if (stored === undefined || stored === null) return {state: START_TEMP_STATE.ABSENT, valueC: null};
  if (!isObj(stored) || typeof stored.state !== "string" || !Object.values(START_TEMP_STATE).includes(stored.state) || stored.state === START_TEMP_STATE.STORED_MALFORMED) {
    return {state: START_TEMP_STATE.STORED_MALFORMED, valueC: null};
  }
  if (stored.state === START_TEMP_STATE.PRESENT) {
    if (typeof stored.valueC !== "number" || !Number.isFinite(stored.valueC) || stored.valueC === 0) return {state: START_TEMP_STATE.STORED_MALFORMED, valueC: null};
    return {state: START_TEMP_STATE.PRESENT, valueC: stored.valueC};
  }
  return {state: stored.state, valueC: typeof stored.valueC === "number" && Number.isFinite(stored.valueC) ? stored.valueC : null};
}

// ─── سجلّ الاختيار (الفحص الأوّل) ────────────────────────────────────────────────────────────────────────────────

/** حالة فحص «الهاتف بلا تكرار سابق مكتمل» (P:619، الشرط الثالث): لا تُقيَّم قبل هويّة الجهاز. اقتراحي. */
const PRIOR_REPEAT_CHECK_STATE = Object.freeze({
  NOT_EVALUATED: "NOT_EVALUATED",
});
const PRIOR_REPEAT_CHECK_REASON = Object.freeze({
  DEVICE_IDENTITY_UNAVAILABLE: "DEVICE_IDENTITY_UNAVAILABLE", // deviceId لا يُكتب بعد (S-P6-01: مفتاح HMAC بيد المستخدم)
});

/**
 * سجلّ الاختيار `repeat` لفحص: كل فحص يحمل سجلّاً بحالة صريحة (القاعدة 22) — حتى حين لا أهلية (السبب في `reason`).
 * @param {Object} p
 * @param {boolean} p.isSessionScan فحص جلسة؟ (غير الجلسة: غرضه NO_SESSION فلا أهلية)
 * @param {string} p.scanPurpose غرض الفحص المحسوب (SCAN_PURPOSE)
 * @param {?Object} p.sessionData مستند الجلسة (joinedBy)
 * @param {Object<string, boolean>} p.parts أجزاء المحلّ
 * @param {{state: string, version: ?number, data: ?Object}} p.settings الإعدادات
 * @param {{state: string, valueC: ?number}} p.firstScanStartTemp حرارة بدء هذا الفحص (تُخزَّن لـSELECTED وحدها)
 * @param {function(): number} p.random
 * @param {*} p.decidedAt وقت القرار (FieldValue.serverTimestamp() حيّاً) — يُمرَّر صراحةً
 * @return {Object}
 */
function buildRepeatRecord({isSessionScan, scanPurpose, sessionData, parts, settings, firstScanStartTemp, random, decidedAt}) {
  if (typeof isSessionScan !== "boolean") throw new Error("buildRepeatRecord: isSessionScan غائب أو ليس منطقياً");
  const joinedByKnown = isSessionScan && isObj(sessionData) && isNonEmptyString(sessionData.joinedBy);
  const selection = decideSelection({
    settings, parts, partKey: PROTOCOL_PART.COLD_REPEAT, rateField: SETTINGS_FIELD.REPEAT_RATE, random,
    gates: [
      {reason: REPEAT_NOT_ELIGIBLE_REASON.PURPOSE_NOT_NORMAL, passes: scanPurpose === SCAN_PURPOSE.NORMAL},
      {reason: REPEAT_NOT_ELIGIBLE_REASON.PARENT_JOINER_UNKNOWN, passes: joinedByKnown},
    ],
  });
  return {
    state: selection.state,
    reason: selection.reason,
    draw: selection.draw,
    rate: selection.rate,
    settingsVersion: selection.settingsVersion,
    decidedAt,
    firstScanStartTemp: selection.state === REPEAT_STATE.SELECTED ? {state: firstScanStartTemp.state, valueC: firstScanStartTemp.valueC} : null,
    priorRepeatCheck: {state: PRIOR_REPEAT_CHECK_STATE.NOT_EVALUATED, reason: PRIOR_REPEAT_CHECK_REASON.DEVICE_IDENTITY_UNAVAILABLE},
  };
}

// ─── الفحص الثاني (الابن): السياق والتصنيف والإعفاء ──────────────────────────────────────────────────────────────

/**
 * سياق الابن من protocolPending/{childSessionId} (E8: repeatOfSessionId · repeatOfScanId · firstScanStartTemp). الابن = جلسة فيها repeatOfSessionId نصّ غير فارغ؛ والباقي غائبه حالة صريحة.
 * @param {*} pendingData
 * @return {{isChild: boolean, parentSessionId: ?string, parentScanId: ?string, reference: {state: string, valueC: ?number}, startedBeforeCooling: ?boolean}}
 */
function readRepeatChildContext(pendingData) {
  const none = {isChild: false, parentSessionId: null, parentScanId: null, reference: {state: START_TEMP_STATE.ABSENT, valueC: null}, startedBeforeCooling: null};
  if (!isObj(pendingData) || !isNonEmptyString(pendingData.repeatOfSessionId)) return none;
  return {
    isChild: true,
    parentSessionId: pendingData.repeatOfSessionId,
    parentScanId: isNonEmptyString(pendingData.repeatOfScanId) ? pendingData.repeatOfScanId : null,
    reference: readStoredStartTemp(pendingData.firstScanStartTemp),
    startedBeforeCooling: typeof pendingData.startedBeforeCooling === "boolean" ? pendingData.startedBeforeCooling : null,
  };
}

/** سبب عدم التصنيف الذي لا يسمّيه التصميم (P:669 يسمّي غياب الأولى وحده). اقتراحي. */
const REPEAT_CLASSIFICATION_ABSENCE = Object.freeze({
  COOLING_REFERENCE_ABSENT: REPEAT_ABSENCE_STATE.COOLING_REFERENCE_ABSENT, // التصميم P:669
  SECOND_START_TEMP_ABSENT: "SECOND_START_TEMP_ABSENT", // اقتراحي
});

const tenths = (c) => Math.round(c * TEMP_RESOLUTION_PER_C);

/**
 * تصنيف الفحص الثاني (القاعدة 20: الحكم في الخادم، والخام يبقى).
 * @param {{reference: {state: string, valueC: ?number}, second: {state: string, valueC: ?number}}} p
 * @return {{purpose: string, absence: ?string, deltaC: ?number, thresholdC: number}}
 */
function classifyRepeatScan({reference, second}) {
  const base = {thresholdC: REPEAT_COLD_THRESHOLD_C};
  if (reference.state !== START_TEMP_STATE.PRESENT) return {...base, purpose: SCAN_PURPOSE.REPEAT_UNCLASSIFIED, absence: REPEAT_CLASSIFICATION_ABSENCE.COOLING_REFERENCE_ABSENT, deltaC: null};
  if (second.state !== START_TEMP_STATE.PRESENT) return {...base, purpose: SCAN_PURPOSE.REPEAT_UNCLASSIFIED, absence: REPEAT_CLASSIFICATION_ABSENCE.SECOND_START_TEMP_ABSENT, deltaC: null};
  const delta10 = tenths(second.valueC) - tenths(reference.valueC);
  return {
    ...base,
    purpose: Math.abs(delta10) <= REPEAT_COLD_THRESHOLD_C * TEMP_RESOLUTION_PER_C ? SCAN_PURPOSE.REPEAT_COLD : SCAN_PURPOSE.REPEAT_HOT,
    absence: null,
    deltaC: delta10 / TEMP_RESOLUTION_PER_C,
  };
}

/**
 * إعفاء الخصم: «لا خصم للتكرار البارد ... في مرحلة الجمع» (س٢٠، P:657). **التكرار البارد وحده**، وعلَم مرحلة الجمع `true` صريحةً (غيابه أو فساده لا يُعفي).
 * @param {{purpose: string}} classification
 * @param {{state: string, value: ?boolean}} collectionPhase ناتج readCollectionPhase
 * @return {boolean}
 */
function isCreditExempt(classification, collectionPhase) {
  return classification.purpose === SCAN_PURPOSE.REPEAT_COLD && collectionPhase.state === FIELD_STATE.SET && collectionPhase.value === true;
}

/**
 * إعفاء الخصم لفحص «بعد» (ق10، قرار المستخدم عبر حسن 2026-10-22: «نطاق الإعفاء يتبع س٢٠: البارد، فحص «بعد»، المرتجع»، وأمر المنسّق 2026-10-23 ببناء فحص «بعد» وحده بتغيير صغير آمن؛ المرتجع لا يُبنى):
 * «لا خصم للتكرار البارد ولا لفحص «بعد» ولا للمرتجع في مرحلة الجمع» (س٢٠، P:657 — منقول، غير متحقَّق إلا بالقراءة). هو **الآلية القائمة نفسها** (PROTOCOL_EXEMPT: لا بوّابة رصيد/اشتراك ولا حجز ولا خصم، وتُكتب في scanProtocol)،
 * لا آلية ثانية: يقوم على شرطين معاً — غرض الجلسة المُعلَن `maintenance_after` بحروفه (مستند الجلسة، لا الفحص الشخصي)، وعلَم مرحلة الجمع `true` صريحةً (غيابه أو فساده لا يُعفي: القاعدة 22، كالبارد).
 * وأيّ غرض آخر (normal · maintenance_before · غائب · غير معروف) لا يُعفى أبداً. **القرار نقيّ على مستند الجلسة وعلَم المرحلة وحدهما**: لا يشترط نجاح الربط بفحص «قبل» (س٢٠ لا يشترطه، وفشل الربط لا يُسقط التقرير أصلاً: A3).
 * @param {{sessionData: ?Object, collectionPhase: {state: string, value: ?boolean}}} p collectionPhase ناتج readCollectionPhase
 * @return {boolean}
 */
function isAfterScanCreditExempt({sessionData, collectionPhase}) {
  const purpose = isObj(sessionData) ? sessionData.purpose : undefined;
  return purpose === SCAN_PURPOSE.MAINTENANCE_AFTER && collectionPhase.state === FIELD_STATE.SET && collectionPhase.value === true;
}

/**
 * حقول scanProtocol للابن: الغرض (من التصنيف) ومصدره repeat_flow، والربط بالأمّ، وتفاصيل التصنيف خامّةً (القاعدة 20).
 * @param {Object} p
 * @param {Object} p.context ناتج readRepeatChildContext
 * @param {{state: string, valueC: ?number}} p.second حرارة بدء هذا الفحص
 * @param {Object} p.classification ناتج classifyRepeatScan
 * @return {{scanPurpose: string, purposeSource: string, repeatOf: Object, repeatClassification: Object}}
 */
function buildChildProtocolFields({context, second, classification}) {
  return {
    scanPurpose: classification.purpose,
    purposeSource: PURPOSE_SOURCE.REPEAT_FLOW,
    repeatOf: {sessionId: context.parentSessionId, scanId: context.parentScanId},
    repeatClassification: {
      absence: classification.absence,
      firstScanStartTemp: {state: context.reference.state, valueC: context.reference.valueC},
      secondScanStartTemp: {state: second.state, valueC: second.valueC},
      deltaC: classification.deltaC,
      thresholdC: classification.thresholdC,
      startedBeforeCooling: context.startedBeforeCooling,
    },
  };
}

/** حالة الأمّ بعد اكتمال الابن. */
function completedStateFor(purpose) {
  if (purpose === SCAN_PURPOSE.REPEAT_COLD) return REPEAT_STATE.COMPLETED_COLD;
  if (purpose === SCAN_PURPOSE.REPEAT_HOT) return REPEAT_STATE.COMPLETED_HOT;
  return REPEAT_STATE.COMPLETED_UNCLASSIFIED;
}

/** أسباب عدم تحديث الأمّ عند اكتمال الابن (للسطر المسمّى: لا كتابة صامتة ولا فشل للفحص). */
const PARENT_COMPLETION_SKIP = Object.freeze({
  PARENT_SCAN_ID_ABSENT: "PARENT_SCAN_ID_ABSENT", // protocolPending للابن بلا repeatOfScanId نصّي
  PARENT_DOCUMENT_ABSENT: "PARENT_DOCUMENT_ABSENT",
  PARENT_RECORD_UNREADABLE: "PARENT_RECORD_UNREADABLE",
  PARENT_NOT_STARTED: "PARENT_NOT_STARTED",
  PARENT_CHILD_MISMATCH: "PARENT_CHILD_MISMATCH",
});

/**
 * هل تُحدَّث الأمّ بنتيجة الابن؟ فقط إن كان سجلّها مقروءاً وحالته STARTED وابنها هذا الابن (`repeat.childSessionId`). **ما عدا ذلك لا يُكتب ولا يُفشل الفحص**: الأمّ تُترك كما هي وسبب تركها يُعلَن.
 * @param {{parentData: ?Object, childSessionId: string}} p
 * @return {{update: boolean, reason: ?string}}
 */
function decideParentCompletion({parentData, childSessionId}) {
  if (!isObj(parentData)) return {update: false, reason: PARENT_COMPLETION_SKIP.PARENT_DOCUMENT_ABSENT};
  const stored = readStoredRepeat(parentData);
  if (!stored.ok) return {update: false, reason: `${PARENT_COMPLETION_SKIP.PARENT_RECORD_UNREADABLE}:${stored.refusal}`};
  if (stored.state !== REPEAT_STATE.STARTED) return {update: false, reason: `${PARENT_COMPLETION_SKIP.PARENT_NOT_STARTED}:${stored.state}`};
  if (stored.repeat.childSessionId !== childSessionId) return {update: false, reason: PARENT_COMPLETION_SKIP.PARENT_CHILD_MISMATCH};
  return {update: true, reason: null};
}

// ─── رفوض الدوالّ (startRepeatScan وgetRepeatScanOffer) ─────────────────────────────────────────────────────────

/**
 * رموز الرفض. **المعتمَد اسماً واحد** (E41): PARENT_JOINER_UNKNOWN من REPEAT_REFUSAL؛ **الباقي أسماء اقترحتُها** (لا رمز معتمداً لها)، على نسق FORM_* وSET_PURPOSE_*، وتُراجَع مع عقد التطبيق.
 * ما له قيمة قائمة أخذها منها (مصدر واحد: القاعدة 24): STATUS_UNKNOWN من JOIN_REFUSAL.
 */
const REPEAT_CALL_REFUSAL = Object.freeze({
  PARENT_JOINER_UNKNOWN: REPEAT_REFUSAL.PARENT_JOINER_UNKNOWN, // معتمد E41
  NOT_AUTHENTICATED: "REPEAT_NOT_AUTHENTICATED",
  SESSION_ID_REQUIRED: "REPEAT_SESSION_ID_REQUIRED",
  SCAN_ID_REQUIRED: "REPEAT_SCAN_ID_REQUIRED",
  STARTED_BEFORE_COOLING_INVALID: "REPEAT_STARTED_BEFORE_COOLING_INVALID", // startedBeforeCooling حاضر وليس منطقياً
  PAIR_NOT_FOUND: "REPEAT_PAIR_NOT_FOUND", // لا جلسة، أو scanId الطلب ≠ scanId الجلسة: ردّ واحد (لا يُكشف وجود جلسة)
  SESSION_NOT_COMPLETED: "REPEAT_SESSION_NOT_COMPLETED", // «جلسة completed بالفحص نفسه» (P:640)
  RECORD_ABSENT: "REPEAT_RECORD_ABSENT", // لا scanProtocol للفحص، أو لا سجلّ repeat فيه
  STATE_UNKNOWN: "REPEAT_STATE_UNKNOWN", // repeat.state خارج المفردات
  NOT_SELECTED: "REPEAT_NOT_SELECTED", // NOT_ELIGIBLE أو NOT_SELECTED: لم يُختَر الهاتف
  ALREADY_STARTED: "REPEAT_ALREADY_STARTED", // «ولم يبدأ» (P:640): بدأ أو اكتمل أو انقضى
  PARENT_OWNER_UNKNOWN: "REPEAT_PARENT_OWNER_UNKNOWN", // ownerId الأمّ ليس نصّاً غير فارغ
  SESSION_STATUS_UNKNOWN: JOIN_REFUSAL.STATUS_UNKNOWN, // حالة الأمّ غائبة أو لا تعرفها الشيفرة
});

const SESSION_INVALID_TEXT = "جلسة الفحص غير صالحة";
const INPUT = (code, reason) => ({code, message: reason, clientReasonCode: reason});

/**
 * ردّ كل سبب: رمز HttpsError ونصّه والرمز الذي يصل العميل في details.reasonCode. **لا نصّ عربي جديد** (القرار ٩٠): النصوص القائمة («يجب تسجيل الدخول» · «sessionId مطلوب» · «جلسة الفحص غير صالحة»)،
 * وما لا نصّ قائم له يحمل رمزه نفسه رسالةً تقنية. **معلّق: نصّ بانتظار الاعتماد** لكل رفض يراه الفنّي أو الزبون (§٥-أ B9، E41: «نصوص الرفض (E5، E41) غير مكتوبة»).
 */
const REPEAT_REFUSAL_RESPONSE = Object.freeze({
  [REPEAT_CALL_REFUSAL.NOT_AUTHENTICATED]: {code: "unauthenticated", message: "يجب تسجيل الدخول", clientReasonCode: REPEAT_CALL_REFUSAL.NOT_AUTHENTICATED},
  [REPEAT_CALL_REFUSAL.SESSION_ID_REQUIRED]: {code: "invalid-argument", message: "sessionId مطلوب", clientReasonCode: REPEAT_CALL_REFUSAL.SESSION_ID_REQUIRED},
  [REPEAT_CALL_REFUSAL.SCAN_ID_REQUIRED]: INPUT("invalid-argument", REPEAT_CALL_REFUSAL.SCAN_ID_REQUIRED),
  [REPEAT_CALL_REFUSAL.STARTED_BEFORE_COOLING_INVALID]: INPUT("invalid-argument", REPEAT_CALL_REFUSAL.STARTED_BEFORE_COOLING_INVALID),
  [REPEAT_CALL_REFUSAL.PAIR_NOT_FOUND]: {code: "permission-denied", message: SESSION_INVALID_TEXT, clientReasonCode: REPEAT_CALL_REFUSAL.PAIR_NOT_FOUND},
  [REPEAT_CALL_REFUSAL.SESSION_NOT_COMPLETED]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.SESSION_NOT_COMPLETED),
  [REPEAT_CALL_REFUSAL.RECORD_ABSENT]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.RECORD_ABSENT),
  [REPEAT_CALL_REFUSAL.STATE_UNKNOWN]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.STATE_UNKNOWN),
  [REPEAT_CALL_REFUSAL.NOT_SELECTED]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.NOT_SELECTED),
  [REPEAT_CALL_REFUSAL.ALREADY_STARTED]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.ALREADY_STARTED),
  [REPEAT_CALL_REFUSAL.PARENT_OWNER_UNKNOWN]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.PARENT_OWNER_UNKNOWN),
  [REPEAT_CALL_REFUSAL.PARENT_JOINER_UNKNOWN]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.PARENT_JOINER_UNKNOWN),
  [REPEAT_CALL_REFUSAL.SESSION_STATUS_UNKNOWN]: INPUT("failed-precondition", REPEAT_CALL_REFUSAL.SESSION_STATUS_UNKNOWN),
});

/**
 * قراءة سجلّ repeat المخزَّن (من scanProtocol): خريطة وحالتها نصّ من المفردات.
 * @param {*} protocolData scanProtocol/{scanId}.data() أو null
 * @return {{ok: true, repeat: Object, state: string}|{ok: false, refusal: string}}
 */
function readStoredRepeat(protocolData) {
  if (!isObj(protocolData) || !isObj(protocolData.repeat)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.RECORD_ABSENT};
  const state = protocolData.repeat.state;
  if (typeof state !== "string" || !Object.values(REPEAT_STATE).includes(state)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.STATE_UNKNOWN};
  return {ok: true, repeat: protocolData.repeat, state};
}

/**
 * حكم التفويض بالزوج (sessionId، scanId) لكلتا الدالّتين (البدء والعرض): الجلسة موجودة وscanId الطلب = scanId الجلسة ثم completed ثم سجلّ repeat. لا يفحص من المستدعي (لا بـjoinedBy: P:641).
 * @param {Object} p
 * @param {?Object} p.sessionData scanSessions/{id}.data() أو null
 * @param {string} p.scanId
 * @param {?Object} p.protocolData scanProtocol/{scanId}.data() أو null
 * @return {{ok: true, repeat: Object, state: string}|{ok: false, refusal: string, extra?: string}}
 */
function decidePairAccess({sessionData, scanId, protocolData}) {
  if (!isObj(sessionData)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.PAIR_NOT_FOUND, extra: " cause=SESSION_ABSENT"};
  if (!isNonEmptyString(sessionData.scanId) || sessionData.scanId !== scanId) {
    return {ok: false, refusal: REPEAT_CALL_REFUSAL.PAIR_NOT_FOUND, extra: ` cause=${isNonEmptyString(sessionData.scanId) ? "SCAN_ID_MISMATCH" : "SESSION_SCAN_ID_ABSENT"}`};
  }
  // الحالة: معروفة وcompleted وحدها (P:640). حالة غائبة أو لا تعرفها الشيفرة ⟵ رفضها المسمّى (لا تُقرأ completed بالغياب: القاعدة 22).
  const classified = classifyStatus(sessionData);
  if (classified.state !== STATUS_STATE.KNOWN) return {ok: false, refusal: REPEAT_CALL_REFUSAL.SESSION_STATUS_UNKNOWN, extra: ` statusState=${classified.state}`};
  if (classified.status !== SESSION_STATUS.COMPLETED) return {ok: false, refusal: REPEAT_CALL_REFUSAL.SESSION_NOT_COMPLETED, extra: ` status=${classified.status}`};
  const stored = readStoredRepeat(protocolData);
  if (!stored.ok) return {ok: false, refusal: stored.refusal, extra: protocolData ? " cause=NO_REPEAT_FIELD" : " cause=NO_PROTOCOL_DOCUMENT"};
  return {ok: true, repeat: stored.repeat, state: stored.state};
}

/**
 * قرار البدء بعد ثبوت الزوج: الحالة مختارة ولم تبدأ، ثم منضمّ الأمّ معروف (E41)، ثم مالكها.
 * @param {Object} p
 * @param {string} p.state repeat.state
 * @param {Object} p.sessionData مستند الأمّ
 * @return {{ok: true}|{ok: false, refusal: string, extra?: string}}
 */
function decideRepeatStart({state, sessionData}) {
  if (REPEAT_STARTED_OR_DONE_STATES.includes(state)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.ALREADY_STARTED, extra: ` repeatState=${state}`};
  if (!REPEAT_STARTABLE_STATES.includes(state)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.NOT_SELECTED, extra: ` repeatState=${state}`};
  if (!isNonEmptyString(sessionData.ownerId)) return {ok: false, refusal: REPEAT_CALL_REFUSAL.PARENT_OWNER_UNKNOWN};
  if (!isNonEmptyString(sessionData.joinedBy)) {
    const jb = sessionData.joinedBy;
    const joinedByState = jb === undefined ? "absent" : jb === null ? "null" : typeof jb !== "string" ? "invalid-type" : "empty";
    return {ok: false, refusal: REPEAT_CALL_REFUSAL.PARENT_JOINER_UNKNOWN, extra: ` joinedByState=${joinedByState}`};
  }
  return {ok: true};
}

/**
 * مستند الجلسة الابنة (E41): `ownerId` و`expiresAt` وحالة `scanning` وبلا `code`، و`joinedBy` منسوخاً من الأمّ. ومعها الحقول التي يكتبها createScanSession لكل جلسة (createdAt وscanId وdeviceModel).
 * @param {Object} p
 * @param {Object} p.parent مستند الأمّ
 * @param {*} p.createdAt وقت الإنشاء (FieldValue.serverTimestamp() حيّاً)
 * @param {Date} p.expiresAt
 * @return {Object}
 */
function buildChildSession({parent, createdAt, expiresAt}) {
  return {
    ownerId: parent.ownerId,
    joinedBy: parent.joinedBy,
    status: SESSION_STATUS.SCANNING,
    createdAt,
    expiresAt,
    scanId: null,
    deviceModel: null,
  };
}

/**
 * مستند protocolPending للابن: الربط بالأمّ (E8) وحرارة البدء الأولى المنسوخة من سجلّ الاختيار ومصدر الغرض repeat_flow، وإعلان المستخدم «بدأ قبل التبريد» كما أُرسل (أو null غائباً).
 * @param {Object} p
 * @return {Object}
 */
function buildChildPending({parentSessionId, parentScanId, reference, startedBeforeCooling}) {
  return {
    repeatOfSessionId: parentSessionId,
    repeatOfScanId: parentScanId,
    firstScanStartTemp: {state: reference.state, valueC: reference.valueC},
    startedBeforeCooling,
    purposeSource: PURPOSE_SOURCE.REPEAT_FLOW,
  };
}

module.exports = {
  REPEAT_COLD_THRESHOLD_C, TEMP_RESOLUTION_PER_C, REPEAT_STARTABLE_STATES, REPEAT_STARTED_OR_DONE_STATES,
  START_TEMP_STATE, PRIOR_REPEAT_CHECK_STATE, PRIOR_REPEAT_CHECK_REASON, REPEAT_CLASSIFICATION_ABSENCE,
  REPEAT_CALL_REFUSAL, REPEAT_REFUSAL_RESPONSE,
  readStartTemp, readStoredStartTemp, buildRepeatRecord, readRepeatChildContext, classifyRepeatScan, isCreditExempt, isAfterScanCreditExempt,
  buildChildProtocolFields, completedStateFor, PARENT_COMPLETION_SKIP, decideParentCompletion,
  readStoredRepeat, decidePairAccess, decideRepeatStart, buildChildSession, buildChildPending,
};
