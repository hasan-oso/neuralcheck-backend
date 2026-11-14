"use strict";

// ===================================================
// maintenancePair — ربط «قبل الصيانة» بـ«بعد الصيانة»: نوع العطل، وحقول الزوج، وقرارات الدالّتين (أمر المستخدم 2026-10-22؛ المراحل S2 إلى S6)
// ===================================================
//
// المواصفة: docs/PROTOCOL_CONTRACT.md §٢ A2 (إلحاق 2026-10-22: الأغراض ونوع العطل) وA3 (أُعيدت كتابته: الربط اليدويّ بلا هويّة) وA11 (إلحاق 2026-10-22: اتّساق unlink/relink مع pair)،
// ومصدرها الحاكم WIRE-SPEC-MAINTENANCE-PAIRS-2026-10-22.md (منقول من أمر المستخدم، غير متحقَّق من هذا المستودع: القاعدة 29).
// **الحوارس:** كل ما هنا يعمل خلف جزأَي المحلّ القائمين `purposes` و`batteryBeforeAfter` (مُطفآن ما لم يُكتبا)، ولا حارس جديد. **استثناء بأمر المستخدم** (مكتوب في رأس protocolVocabulary.js): القيم الموسومة proposal
// (A2 وA3) تُستعمل هنا قبل اعتمادها. **دوالّ نقيّة بلا I/O** (القاعدة 41: تُختبر بلا Firestore)؛ القراءة والكتابة في الدوالّ المستدعية.
//
// أسماء الحقول حرفيّات هنا وحدها (E36: لا تُصدَّر من protocolVocabulary.js)، ومصدرها الواحد هذه الوحدة (القاعدة 24): كاتبا scanProtocol وprotocolPending وقارئاهما يستوردانها.
//
// ما تقرّره هذه الوحدة حتى الآن (S2 إلى S6):
//   (١) **نوع العطل مع الغرض** (validateDefectTypeForPurpose): مطلوب لـmaintenance_*، ممنوع لـnormal؛ القائمة DEFECT_TYPE مغلقة وبحالة الأحرف نفسها. الغائب (المفتاح غير موجود أو undefined) غير المُرسَل `null`:
//       `null` مُرسَل — فهو INVALID مع maintenance_* وNOT_APPLICABLE مع normal (القاعدة 22: لا يُقرأ الغياب من null).
//   (٢) **ما يُكتب في protocolPending عند كل اختيار** (pendingFieldsForPurposeChoice): نوع العطل (أو null صريحاً لـnormal: لا FieldValue.delete() على مستند إنتاج، القاعدة 42) **ويُمسح اختيار الربط السابق**
//       (linkedScanId · linkMethod · linkConfirmedAt · linkConfirmedByTechnicianId ⟵ null): الربط المؤكَّد كان لغرض ونوع محدَّدين فتغيّرهما يُبطله (قراري، القاعدة 45؛ A2).
//   (٣) **نوع العطل في scanProtocol** (readDefectType): لـmaintenance_* من protocolPending.defectType؛ الغائب أو غير المعروف ⟵ null مع ملاحظة مسمّاة (DEFECT_TYPE_ABSENT · DEFECT_TYPE_NOT_RECOGNIZED: تُطبَع ولا تُكتب)
//       — **لا نوع مختلَق** (القاعدة 22)؛ ولغير الصيانة null دائماً ولو حمل protocolPending نوعاً (النوع يتبع الغرض الحاضر).
//   (٤) **فتح الزوج** (buildPairField): فحص غرضه maintenance_before يكتب {state: OPEN, openedAt} في الدفعة الذرّية نفسها؛ وغيره null صريح (A3 البند ٤). لا expiresAt مخزَّن: المدّة تُقرأ من الإعداد عند القراءة.
//   (٥) **المدّة** (readValidityHours): openBeforeValidityHours من protocolSettings/current — **لا قيمة افتراضية** (P:773؛ القاعدة 22): مستند غائب ⟵ SETTINGS_ABSENT، وحقل غائب ⟵ ABSENT، وغير صالح (ليس عدداً صحيحاً في
//       [1، 8760]: حدّا الكاتب settingsWrite.SETTINGS_LIMITS) ⟵ INVALID؛ كلّها حالات مسمّاة يرفضها نداء القائمة برمز واحد (PAIR_VALIDITY_SETTING_ABSENT) ويفرّق بينها سطر السجلّ.
//   (٦) **الانقضاء يُحسب عند القراءة** (windowOf): الداخل إن `الآن − openedAt ≤ المدّة` (الحدّ نفسه داخل)؛ ولا يُخزَّن EXPIRED.
//   (٧) **المرشَّح** (classifyOpenBefore): غرض maintenance_before ونوع «قبل» = نوع «بعد» و`pair` مقروء بحالة OPEN بلا completedByScanId وداخل النافذة؛ وكل استبعاد له سبب مسمّى (PAIR_EXCLUDED) يُعدّ في السجلّ.
//       ثم المحلّ (تقرير «قبل» لمالك الجلسة) وغياب ربط حيّ من أيّ «بعد» (LIVE_LINK_STATES) في نداء القائمة.
//   (٨) **قرار التأكيد** (decideConfirmBefore): بترتيب الرفوض في A3 البند ٣ — غير موجودة ⟵ BEFORE_NOT_FOUND؛ ليست لمالك الجلسة (أو المالك مجهول) ⟵ BEFORE_NOT_OWNED؛ غرضها ≠ maintenance_before ⟵ BEFORE_WRONG_PURPOSE؛
//       نوعها ≠ نوع «بعد» ⟵ BEFORE_WRONG_DEFECT_TYPE؛ pair غير مقروء ⟵ PAIR_BEFORE_UNREADABLE؛ COMPLETED أو لها ربط حيّ ⟵ BEFORE_ALREADY_PAIRED؛ خارج النافذة ⟵ BEFORE_EXPIRED. **لا مطابقة تلقائية ولا auto_confirmed.**
//   (٩) **اختيار الربط** (readLinkChoice): من protocolPending.linkedScanId مع linkMethod = manual؛ الغائب ⟵ لا ربط مختار (PAIR_LINK_NOT_CHOSEN)؛ والمخزَّن بشكل لا يُقرأ ⟵ لا ربط (PAIR_LINK_NOT_RECOGNIZED) — ملاحظتان مسمّاتان تُطبعان ولا تُكتبان.
//   (١٠) **الاكتمال** (decidePairCompletion): معاملة analyzeDevice تعيد التحقّق قبل أيّ كتابة: «قبل» موجودة وغرضها maintenance_before ونوعها = نوع «بعد» وpair OPEN وبلا ربط حيّ من «بعد» آخر. صحّ كله ⟵ «بعد»: linkedScanId · linkState = active ·
//       linkMethod = manual، و«قبل»: pair.state = COMPLETED · pair.completedByScanId. **ضاع الهدف** ⟵ «بعد»: linkedScanId (المعرّف المختار) · linkState = missing · linkMethod = manual، ولا يُمسّ «قبل»، وملاحظة LINK_TARGET_LOST:<السبب>؛ ويكتمل التقرير.
//       لا إعادة تحقّق من انقضاء المدّة عند الاكتمال (التأكيد فحصها).
//   (١١) **اتّساق التصحيح** (decidePairSync؛ A11 إلحاق 2026-10-22): unlink/relink على «بعد» X يُبقيان pair على «قبل» متّسقاً في معاملة التصحيح نفسها. unlink ⟵ «قبل» التي ربطها X الحيّ تُعاد OPEN (completedByScanId = null)؛ relink ⟵ الهدف القديم يُعاد
//       مفتوحاً كذلك، والجديد OPEN يصير COMPLETED بـX؛ **الجديد COMPLETED بغير X لا يُمسّ** ويُعلَن (TARGET_ALREADY_COMPLETED: قواعد الأزواج في relink معلّقة، ق18، فلا رفض جديداً). الأثر تحديث بحقلين منقَّطين لا حذف ولا كتابة فوق سطر سابق.
//   (١٢) **مالك الزوج** (S8، 2026-10-22؛ طلب المنسّق بعد تقرير S7: السقف العامّ عيب لا قيد): يُكتب على «قبل» وحدها معرّف المحلّ داخل حقل الزوج: pair = {state, openedAt, ownerId} (ownerId = ownerId مستند الجلسة
//       وقت الفتح؛ **لا مفتاح علوي جديد في scanProtocol**: الخمسة عشر كما هي). فيصير استعلام القائمة مساواتين على حقلين (pair.ownerId == uid وpair.state == OPEN) تُخدَمان بدمج فهرسَين مفرَدَين تلقائيين بلا فهرس
//       مركّب، ويصير سقف OPEN_PAIR_SCAN_CAP **لكل محلّ** (رفض مسمّى لا اقتطاعاً). ownerId نصّ غير فارغ مطلوب للمقروء (readPair: غيابه أو شكله الخاطئ ⟵ UNREADABLE؛ لا ترحيل: لا «قبل» بالشكل القديم في الإنتاج).
//       «قبل» بلا مالك معروف في الجلسة وقت الفتح يُكتب pair بـownerId = null صريحاً مع ملاحظة PAIR_OWNER_ABSENT (غير مقروء فلا يُرشَّح ولا يُؤكَّد: القاعدة 22). تقرير «قبل» (userId) يبقى دفاعاً مزدوجاً؛ واختلافه عن
//       pair.ownerId شذوذ مسمّى PAIR_OWNER_MISMATCH: في القائمة يُستبعد ويُعلَن (سبب مسمّى وسطر تحذير)، وفي التأكيد يُرفض به. الاكتمال (decidePairCompletion) واتّساق التصحيح (decidePairSync) يكتبان حقلَي pair.state وpair.completedByScanId
//       بتحديث منقَّط فيبقى ownerId كما هو. (هذا البند يحلّ محلّ وصف شكل pair والمحلّ في (٤) و(٧) و(٨).)
//   (١٣) **ملاحظة الطراز** (ق36 أ، أقرّه حسن 2026-10-22؛ docs/PROTOCOL_CONTRACT.md A3 البند ٤): عند اكتمال «بعد» التي **حُلّ هدف ربطها** (LINKED وحدها) يُقارَن طراز تقريرَي الزوج (`reports/{id}.deviceModel`: ما يعتمده المستودع هويّةً للطراز،
//       ويقرؤه resolveMarketingName حرفياً) فتُكتب `linkModelCheck` على «بعد»: LINK_MODEL_MISMATCH إن اختلفا · LINK_MODEL_MATCH إن تطابقا · LINK_MODEL_ABSENT إن غاب الطراز عن أحدهما أو عنهما (decideLinkModelCheck). **لا رفض ولا تأخير ولا نصّ ولا حقل على السلك.**
//       **المقارنة حرفية `===`: لا مطبِّع طراز في المستودع** (deviceProfileKey يطبّع مفتاح الجهاز لا الطراز) فلا أختلق واحداً. **والغياب** (readModelIdentity): ليس نصّاً، أو فارغ/مسافات، أو احتياطيّا المستودع الحرفيّان
//       MODEL_FALLBACK_LITERALS ("Unknown"/"unknown": ما يكتبه analyzeDevice وrunAnalysisInternal حين لا طراز في البصمة) — فلا يتطابق «مجهول» مع «مجهول»؛ ويثبّت اختبارٌ أنّهما كلّ احتياطيّات `.model ||` في src. ضياع الهدف ⟵ لا مقارنة (null).
const {
  SCAN_PURPOSE, DEFECT_TYPE, PURPOSE_REFUSAL, PAIR_STATE, PAIR_LINK_REFUSAL, PAIR_CALL_REFUSAL, LINK_STATE, LINK_METHOD, CORRECTION_ACTION, LINK_MODEL_CHECK,
} = require("./protocolVocabulary");
const {SCAN_PROTOCOL_FIELD, LIVE_LINK_STATES} = require("./protocolCorrection");
const {SETTINGS_FIELD, SETTINGS_STATE} = require("./protocolSettings");
const {SETTINGS_LIMITS} = require("./settingsWrite");
const {resolveMarketingName} = require("./marketingNames");

/**
 * أسماء حقول protocolPending/{sessionId} الخاصّة بنوع العطل والربط المؤكَّد (خادمي: لا match له في القواعد، A0 البند ١). **الأسماء الثلاثة المشتركة مع scanProtocol مصدرها SCAN_PROTOCOL_FIELD**
 * (القاعدة 24: حرفيّة واحدة لا نسختان)؛ والاسمان E7 (linkConfirmedAt · linkConfirmedByTechnicianId) لا يوجدان إلا في protocolPending فحرفيّتهما هنا.
 */
const PENDING_FIELD = Object.freeze({
  DEFECT_TYPE: SCAN_PROTOCOL_FIELD.DEFECT_TYPE,
  LINKED_SCAN_ID: SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID,
  LINK_METHOD: SCAN_PROTOCOL_FIELD.LINK_METHOD,
  LINK_CONFIRMED_AT: "linkConfirmedAt",
  LINK_CONFIRMED_BY_TECHNICIAN_ID: "linkConfirmedByTechnicianId",
});

/** الغرضان اللذان يحملان نوع عطل ويدخلان الزوج. */
/**
 * أسماء مفاتيح الكائن pair على «قبل» (A3 البند ١): الحالة ووقت الفتح، ويضيف الاكتمال completedByScanId. حرفيّات هنا وحدها (E36)؛ كاتبها وقارئاها يستوردانها.
 */
const PAIR_KEY = Object.freeze({
  STATE: "state",
  OPENED_AT: "openedAt",
  OWNER_ID: "ownerId", // (S8) مالك الجلسة وقت فتح الزوج؛ يقيّد استعلام القائمة بالمحلّ
  COMPLETED_BY_SCAN_ID: "completedByScanId",
});

/**
 * ملاحظات مسمّاة (تُطبَع في السجلّ ولا تُكتب في مستند: كما PROTOCOL_NOTE) — يضمّها scanProtocolDocument.PROTOCOL_NOTE إلى ملاحظاته (مصدر واحد: القاعدة 24).
 *   DEFECT_TYPE_ABSENT          فحص maintenance_* بلا نوع عطل في protocolPending (شذوذ: setSessionPurpose يكتبه دائماً مع الغرض).
 *   DEFECT_TYPE_NOT_RECOGNIZED  نوع في protocolPending خارج DEFECT_TYPE.
 */
const PAIR_NOTE = Object.freeze({
  DEFECT_TYPE_ABSENT: "DEFECT_TYPE_ABSENT",
  DEFECT_TYPE_NOT_RECOGNIZED: "DEFECT_TYPE_NOT_RECOGNIZED",
  PAIR_OWNER_ABSENT: "PAIR_OWNER_ABSENT", // (S8) فحص maintenance_before بلا ownerId نصّاً في مستند الجلسة: يُكتب pair بـownerId = null (غير مقروء)
  // (S5) اختيار الربط عند الاكتمال:
  PAIR_LINK_NOT_CHOSEN: "PAIR_LINK_NOT_CHOSEN", // فحص maintenance_after بلا ربط مؤكَّد في protocolPending: يُكتب بلا ربط (none)
  PAIR_LINK_NOT_RECOGNIZED: "PAIR_LINK_NOT_RECOGNIZED", // ربط مخزَّن بشكل لا يُقرأ (معرّف ليس نصّاً، أو linkMethod ≠ manual): لا يُربط ولا يُخمَّن
  LINK_TARGET_LOST: "LINK_TARGET_LOST", // ضاع هدف الربط في المعاملة؛ يُلحَق به `:<السبب>` (PAIR_LOST_REASON)
});

/** أسباب ضياع الهدف عند الاكتمال (تُلحَق بـLINK_TARGET_LOST في السجلّ؛ أسماء خادم داخلية). */
const PAIR_LOST_REASON = Object.freeze({
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  TARGET_WRONG_PURPOSE: "TARGET_WRONG_PURPOSE",
  TARGET_WRONG_TYPE: "TARGET_WRONG_TYPE",
  TARGET_PAIR_UNREADABLE: "TARGET_PAIR_UNREADABLE",
  TARGET_NOT_OPEN: "TARGET_NOT_OPEN",
  TARGET_LIVE_LINK: "TARGET_LIVE_LINK",
});

/** نتيجة قرار الاكتمال. */
const PAIR_COMPLETION = Object.freeze({LINKED: "LINKED", TARGET_LOST: "TARGET_LOST"});

/** نيّة الربط لفحص «بعد» عند بناء مستنده: NONE لا ربط مختاراً، CHOSEN فيه معرّف «قبل» مؤكَّد. */
const PAIR_LINK_INTENT = Object.freeze({NONE: "NONE", CHOSEN: "CHOSEN"});

const MAINTENANCE_PURPOSES = Object.freeze([SCAN_PURPOSE.MAINTENANCE_BEFORE, SCAN_PURPOSE.MAINTENANCE_AFTER]);
const isMaintenancePurpose = (purpose) => typeof purpose === "string" && MAINTENANCE_PURPOSES.includes(purpose);

const ALL_DEFECT_TYPES = Object.freeze(Object.values(DEFECT_TYPE));
const isDefectType = (v) => typeof v === "string" && ALL_DEFECT_TYPES.includes(v);

/** نوع القيمة المُرسَلة لسطر السجلّ (لا القيمة نفسها: نصّ حرّ من العميل قد يحمل ما لا يُطبع). */
const kindOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * نوع العطل مع الغرض عند setSessionPurpose. الترتيب: الغرض معروف الصحّة هنا (فُحص قبلها).
 *   maintenance_*: غائب ⟵ DEFECT_TYPE_REQUIRED؛ مُرسَل وليس من DEFECT_TYPE بالضبط (OTHER · نصّ فارغ · رقم · أحرف صغيرة · null · كائن) ⟵ DEFECT_TYPE_INVALID.
 *   غير ذلك (normal): مُرسَل (ولو null) ⟵ DEFECT_TYPE_NOT_APPLICABLE.
 * @param {{purpose: string, defectType: *}} p defectType كما وصل (undefined = غائب)
 * @return {{ok: true, defectType: ?string}|{ok: false, refusal: string, extra: string}} defectType المقبول (نصّ أو null لغير الصيانة)
 */
function validateDefectTypeForPurpose({purpose, defectType}) {
  const R = PURPOSE_REFUSAL;
  const given = defectType !== undefined;
  if (isMaintenancePurpose(purpose)) {
    if (!given) return {ok: false, refusal: R.DEFECT_TYPE_REQUIRED, extra: ` purpose=${purpose}`};
    if (!isDefectType(defectType)) return {ok: false, refusal: R.DEFECT_TYPE_INVALID, extra: ` purpose=${purpose} given=${kindOf(defectType)}`};
    return {ok: true, defectType};
  }
  if (given) return {ok: false, refusal: R.DEFECT_TYPE_NOT_APPLICABLE, extra: ` purpose=${String(purpose)} given=${kindOf(defectType)}`};
  return {ok: true, defectType: null};
}

/**
 * حقول protocolPending التي يكتبها كل اختيار غرض (تُدمج مع purposeSource): نوع العطل ومسح اختيار الربط. null صريح لا حذف (القاعدة 42).
 * @param {{defectType: ?string}} p defectType من validateDefectTypeForPurpose (نصّ أو null)
 * @return {Object}
 */
function pendingFieldsForPurposeChoice({defectType}) {
  if (defectType !== null && !isDefectType(defectType)) throw new Error("pendingFieldsForPurposeChoice: defectType ليس من DEFECT_TYPE ولا null");
  return {
    [PENDING_FIELD.DEFECT_TYPE]: defectType,
    [PENDING_FIELD.LINKED_SCAN_ID]: null,
    [PENDING_FIELD.LINK_METHOD]: null,
    [PENDING_FIELD.LINK_CONFIRMED_AT]: null,
    [PENDING_FIELD.LINK_CONFIRMED_BY_TECHNICIAN_ID]: null,
  };
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * نوع العطل لسجلّ scanProtocol من مستند protocolPending. لغير الصيانة: null بلا ملاحظة. لـmaintenance_*: القيمة إن كانت من DEFECT_TYPE، وإلا null بملاحظة مسمّاة (الغياب حالة صريحة لا نوع مختلَق).
 * @param {{scanPurpose: string, pendingData: ?Object}} p
 * @return {{value: ?string, note: ?string}}
 */
function readDefectType({scanPurpose, pendingData}) {
  if (!isMaintenancePurpose(scanPurpose)) return {value: null, note: null};
  const raw = isObj(pendingData) ? pendingData[PENDING_FIELD.DEFECT_TYPE] : undefined;
  if (raw === undefined || raw === null) return {value: null, note: PAIR_NOTE.DEFECT_TYPE_ABSENT};
  if (!isDefectType(raw)) return {value: null, note: PAIR_NOTE.DEFECT_TYPE_NOT_RECOGNIZED};
  return {value: raw, note: null};
}

/**
 * حقل pair لمستند scanProtocol: {state: OPEN, openedAt, ownerId} لفحص maintenance_before، وnull صريح لغيره (A3 البند ٤؛ S8: ownerId).
 * @param {{scanPurpose: string, openedAt: *, ownerId: ?string}} p openedAt يُمرَّر صراحةً (وقت الخادم نفسه الذي في createdAt؛ لا قيمة افتراضية)؛ ownerId نصّ غير فارغ (مالك الجلسة) أو null صريح (المالك مجهول: يُكتب غير مقروء) — غيابه خطأ برمجة
 * @return {?{state: string, openedAt: *, ownerId: ?string}}
 */
function buildPairField({scanPurpose, openedAt, ownerId}) {
  if (scanPurpose !== SCAN_PURPOSE.MAINTENANCE_BEFORE) return null;
  if (openedAt === undefined) throw new Error("buildPairField: openedAt غائب — يُمرَّر صراحةً (لا قيمة افتراضية: القاعدة 22)");
  if (ownerId === undefined || (ownerId !== null && (typeof ownerId !== "string" || ownerId === ""))) {
    throw new Error("buildPairField: ownerId غائب أو ليس نصّاً غير فارغ ولا null — يُمرَّر صراحةً (null = المالك مجهول فيُكتب غير مقروء: القاعدة 22)");
  }
  return {[PAIR_KEY.STATE]: PAIR_STATE.OPEN, [PAIR_KEY.OPENED_AT]: openedAt, [PAIR_KEY.OWNER_ID]: ownerId};
}

const HOUR_MS = 3600 * 1000;
const isTimestampLike = (v) => v !== null && typeof v === "object" && typeof v.toMillis === "function" && Number.isFinite(v.toMillis());

/** (S8: لكل محلّ — الاستعلام pair.ownerId == uid وpair.state == OPEN) سقف المستندات المقروءة من استعلام «قبل» المفتوحة قبل الترشيح في الذاكرة: فوقه ⟵ رفض مسمّى لا اقتطاع صامت (A3 البند ٢). */
const OPEN_PAIR_SCAN_CAP = 500;

/** حالة إعداد المدّة. SETTINGS_ABSENT: لا مستند إعدادات صالح؛ ABSENT: المستند بلا الحقل؛ INVALID: الحقل بقيمة غير صالحة؛ SET: صالح. */
const VALIDITY_STATE = Object.freeze({
  SET: "SET",
  ABSENT: "ABSENT",
  INVALID: "INVALID",
  SETTINGS_ABSENT: "SETTINGS_ABSENT",
});

/**
 * openBeforeValidityHours من الإعدادات المقروءة (readSettingsDocument): بلا قيمة افتراضية. الصالح: عدد صحيح في [min, max] من SETTINGS_LIMITS (حدّا الكاتب نفسهما).
 * @param {{state: string, data: ?Object}} settings
 * @return {{state: string, hours: ?number}}
 */
function readValidityHours(settings) {
  if (!isObj(settings) || settings.state !== SETTINGS_STATE.PRESENT || !isObj(settings.data)) return {state: VALIDITY_STATE.SETTINGS_ABSENT, hours: null};
  const v = settings.data[SETTINGS_FIELD.OPEN_BEFORE_VALIDITY_HOURS];
  if (v === undefined || v === null) return {state: VALIDITY_STATE.ABSENT, hours: null};
  const {min, max} = SETTINGS_LIMITS.openBeforeValidityHours;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return {state: VALIDITY_STATE.INVALID, hours: null};
  return {state: VALIDITY_STATE.SET, hours: v};
}

/** هل openedAt داخل نافذة المدّة؟ الحدّ نفسه داخل (الآن − openedAt ≤ المدّة). تُحسب عند القراءة ولا تُخزَّن. */
function isWithinWindow({openedAtMs, nowMs, validityHours}) {
  return nowMs - openedAtMs <= validityHours * HOUR_MS;
}

/** حالة قراءة حقل pair من مستند scanProtocol. */
const PAIR_READ = Object.freeze({
  ABSENT: "ABSENT", // pair غائب أو null: ليس «قبل» صيانة (أو سجلّ قبل الفتح)
  PRESENT: "PRESENT",
  UNREADABLE: "UNREADABLE", // كائن بشكل لا يُقرأ: لا يُخمَّن
});

/**
 * يقرأ pair من مستند scanProtocol بحالة صريحة. المقروء: كائن، state من {OPEN, COMPLETED}، وopenedAt وقت، وcompletedByScanId نصّ غير فارغ أو null/غائب؛ مع OPEN لا completedByScanId (تناقض ⟵ UNREADABLE).
 * @param {?Object} protocolData
 * @return {{kind: string, state: ?string, openedAtMs: ?number, completedByScanId: ?string, ownerId: ?string}} (S8) ownerId نصّ غير فارغ مطلوب للمقروء: غيابه أو شكله الخاطئ ⟵ UNREADABLE
 */
function readPair(protocolData) {
  const none = (kind) => ({kind, state: null, openedAtMs: null, completedByScanId: null, ownerId: null});
  const raw = isObj(protocolData) ? protocolData[SCAN_PROTOCOL_FIELD.PAIR] : undefined;
  if (raw === undefined || raw === null) return none(PAIR_READ.ABSENT);
  if (!isObj(raw)) return none(PAIR_READ.UNREADABLE);
  const state = raw[PAIR_KEY.STATE];
  if (state !== PAIR_STATE.OPEN && state !== PAIR_STATE.COMPLETED) return none(PAIR_READ.UNREADABLE);
  const openedAt = raw[PAIR_KEY.OPENED_AT];
  if (!isTimestampLike(openedAt)) return none(PAIR_READ.UNREADABLE);
  const by = raw[PAIR_KEY.COMPLETED_BY_SCAN_ID];
  if (by !== undefined && by !== null && (typeof by !== "string" || by === "")) return none(PAIR_READ.UNREADABLE);
  if (state === PAIR_STATE.OPEN && typeof by === "string") return none(PAIR_READ.UNREADABLE);
  const ownerId = raw[PAIR_KEY.OWNER_ID];
  if (typeof ownerId !== "string" || ownerId === "") return none(PAIR_READ.UNREADABLE);
  return {kind: PAIR_READ.PRESENT, state, openedAtMs: openedAt.toMillis(), completedByScanId: typeof by === "string" ? by : null, ownerId};
}

/** هل لمستند scanProtocol («بعد») ربط حيّ؟ (linkState ∈ LIVE_LINK_STATES: active وrelinked_by_admin.) */
function hasLiveLink(protocolData) {
  return isObj(protocolData) && LIVE_LINK_STATES.includes(protocolData[SCAN_PROTOCOL_FIELD.LINK_STATE]);
}

/** أسباب استبعاد «قبل» من القائمة، تُعدّ في سطر السجلّ (أسماء خادم داخلية). */
const PAIR_EXCLUDED = Object.freeze({
  WRONG_PURPOSE: "WRONG_PURPOSE",
  WRONG_TYPE: "WRONG_TYPE",
  UNREADABLE: "UNREADABLE",
  NOT_OPEN: "NOT_OPEN",
  EXPIRED: "EXPIRED",
  OTHER_SHOP: "OTHER_SHOP",
  REPORT_ABSENT: "REPORT_ABSENT",
  OWNER_UNKNOWN: "OWNER_UNKNOWN", // تقرير «قبل» موجود بلا userId نصّاً: المالك مجهول فلا يُقرأ تطابقاً (القاعدة 22)
  OWNER_MISMATCH: "OWNER_MISMATCH", // (S8) userId في تقرير «قبل» ≠ pair.ownerId (وهو يساوي المستدعي بحكم الاستعلام): شذوذ مسمّى يُعلَن (PAIR_OWNER_MISMATCH) لا يُصمَت
  LIVE_LINK: "LIVE_LINK",
});

/**
 * حقلا تقرير «قبل» المقروءان لتحديد المحلّ والطراز. **كاتبهما analyzeDevice** (`buildReportDocument`: `userId: p.userId` و`deviceModel: p.rawDeviceModel`، analyzeDevice.js:303-305 `[كود]`) — الحرفيّتان هنا للقراءة وحدها،
 * ويحرس اتّفاقهما اختبار المحاكي (maintenancePair.e2e.test.js: القائمة تقرأ تقريراً كتبه analyzeDevice الحقيقي، القاعدة 41).
 */
const REPORT_FIELD = Object.freeze({
  USER_ID: "userId",
  DEVICE_MODEL: "deviceModel",
});

/**
 * الترشيح الأوّل لـ«قبل» من مستند scanProtocol وحده (بلا قراءة تقرير ولا استعلام ثانٍ): الغرض، ثم النوع، ثم pair (مقروء، OPEN)، ثم النافذة.
 * @param {{data: ?Object, afterDefectType: string, uid: string, nowMs: number, validityHours: number}} p (S8) uid: المحلّ المستدعي؛ pair.ownerId ≠ uid ⟵ OTHER_SHOP (دفاع؛ الاستعلام يقيّد بالمحلّ أصلاً)
 * @return {{include: true, openedAtMs: number}|{include: false, reason: string}}
 */
function classifyOpenBefore({data, afterDefectType, uid, nowMs, validityHours}) {
  const E = PAIR_EXCLUDED;
  if (!isObj(data) || data[SCAN_PROTOCOL_FIELD.SCAN_PURPOSE] !== SCAN_PURPOSE.MAINTENANCE_BEFORE) return {include: false, reason: E.WRONG_PURPOSE};
  if (data[SCAN_PROTOCOL_FIELD.DEFECT_TYPE] !== afterDefectType) return {include: false, reason: E.WRONG_TYPE};
  const pair = readPair(data);
  if (pair.kind !== PAIR_READ.PRESENT) return {include: false, reason: E.UNREADABLE};
  if (pair.ownerId !== uid) return {include: false, reason: E.OTHER_SHOP};
  if (pair.state !== PAIR_STATE.OPEN) return {include: false, reason: E.NOT_OPEN};
  if (!isWithinWindow({openedAtMs: pair.openedAtMs, nowMs, validityHours})) return {include: false, reason: E.EXPIRED};
  return {include: true, openedAtMs: pair.openedAtMs};
}

/**
 * اسم الجهاز المعروض في القائمة: نتيجة resolveMarketingName نفسها (المصدر الواحد لكل قارئ: A12) بلا نسخة الخريطة؛ name_unmapped بسببه حين يغيب الاسم (لا اسم مختلَق).
 * @param {{model: *, source: {state: string, version: ?number, entries: Array<Object>}}} p source ناتج readMarketingNamesDocument
 * @return {{state: string, model: ?string, names: ?{ar: string, tr: string, en: string}, reason: ?string}}
 */
function deviceNameFor({model, source}) {
  const r = resolveMarketingName({model, source});
  return {state: r.state, model: r.model, names: r.names, reason: r.reason};
}

/**
 * ترتيب المرشَّحين: الأحدث أوّلاً بـopenedAt، وعند التساوي بمعرّف «قبل» تصاعدياً (ثابت). لا يعدّل مدخله.
 * @param {Array<{beforeScanId: string, openedAtMs: number}>} list
 * @return {Array<{beforeScanId: string, openedAtMs: number}>}
 */
function sortNewestFirst(list) {
  return [...list].sort((a, b) => (b.openedAtMs - a.openedAtMs) || (a.beforeScanId < b.beforeScanId ? -1 : a.beforeScanId > b.beforeScanId ? 1 : 0));
}

/**
 * اختيار الربط المؤكَّد من protocolPending لفحص «بعد»: linkedScanId نصّ غير فارغ مع linkMethod = manual ⟵ مختار؛ الغائب (null أو غير موجود) ⟵ لا ربط (PAIR_LINK_NOT_CHOSEN)؛ أيّ شكل آخر ⟵ لا ربط بملاحظة PAIR_LINK_NOT_RECOGNIZED.
 * @param {?Object} pendingData
 * @return {{beforeScanId: ?string, note: ?string}}
 */
function readLinkChoice(pendingData) {
  const id = isObj(pendingData) ? pendingData[PENDING_FIELD.LINKED_SCAN_ID] : undefined;
  if (id === undefined || id === null) return {beforeScanId: null, note: PAIR_NOTE.PAIR_LINK_NOT_CHOSEN};
  if (typeof id !== "string" || id === "" || pendingData[PENDING_FIELD.LINK_METHOD] !== LINK_METHOD.MANUAL) return {beforeScanId: null, note: PAIR_NOTE.PAIR_LINK_NOT_RECOGNIZED};
  return {beforeScanId: id, note: null};
}

/**
 * احتياطيّا المستودع الحرفيّان للطراز المفقود (ما يكتبه `fingerprint.device?.model || "Unknown"` في analyzeDevice وrunConsistencyTest وrunAnalysisInternal، و"unknown" في runAnalysisInternal): **يُعدّان غياباً لا طرازاً**.
 * مصدر واحد (القاعدة 24)؛ ويثبّت linkModelCheck.test.js بمسح src أنّهما كلّ احتياطيّات `device?.model ||` فيه (طراز الجهاز من البصمة): احتياطي جديد يُفشل الاختبار حتى يُدرَج هنا (القاعدة 22).
 */
const MODEL_FALLBACK_LITERALS = Object.freeze(["Unknown", "unknown"]);

/**
 * هويّة الطراز المقروءة من مستند تقرير (reports/{id}): `deviceModel` نصّاً حقيقياً كما كُتب (بلا قصّ ولا تطبيع: المقارنة حرفية)، أو null حين يغيب: لا مستند، أو لا حقل، أو ليس نصّاً، أو فارغ/مسافات،
 * أو أحد MODEL_FALLBACK_LITERALS (قيمة المستودع حين لا طراز في البصمة).
 * @param {*} reportData بيانات مستند reports (أو أيّ قيمة)
 * @return {?string}
 */
function readModelIdentity(reportData) {
  if (!isObj(reportData)) return null;
  const model = reportData[REPORT_FIELD.DEVICE_MODEL];
  if (typeof model !== "string" || model.trim() === "" || MODEL_FALLBACK_LITERALS.includes(model)) return null;
  return model;
}

/**
 * ملاحظة الطراز لزوج (ق36 أ؛ دالّة نقيّة): MODEL_ABSENT إن غاب الطراز عن أيٍّ من التقريرين (فلا «متطابق» ولا «مختلف» ولا قيمة افتراضية: القاعدة 22)، وإلا MATCH إن تطابقا حرفياً وإلا MISMATCH. متماثلة في الوسيطين.
 * @param {{afterReportData: *, beforeReportData: *}} [p] مستندا reports لـ«بعد» والهدف (غياب أيٍّ منهما = غياب الطراز)
 * @return {string} إحدى LINK_MODEL_CHECK
 */
function decideLinkModelCheck({afterReportData, beforeReportData} = {}) {
  const after = readModelIdentity(afterReportData);
  const before = readModelIdentity(beforeReportData);
  if (after === null || before === null) return LINK_MODEL_CHECK.MODEL_ABSENT;
  return after === before ? LINK_MODEL_CHECK.MATCH : LINK_MODEL_CHECK.MISMATCH;
}

const lostOf = (reason, beforeScanId) => ({
  outcome: PAIR_COMPLETION.TARGET_LOST,
  reason,
  afterFields: {
    [SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID]: beforeScanId,
    [SCAN_PROTOCOL_FIELD.LINK_STATE]: LINK_STATE.MISSING,
    [SCAN_PROTOCOL_FIELD.LINK_METHOD]: LINK_METHOD.MANUAL,
  },
  beforeUpdate: null,
  modelCheck: null, // (ق36 أ) لا هدف محلول ⟵ لا مقارنة: linkModelCheck يبقى null من مستند «بعد»
});

/**
 * قرار الاكتمال داخل معاملة analyzeDevice (دالّة نقيّة؛ A3 البند ٤): يعيد التحقّق مما قرأته المعاملة قبل أيّ كتابة. لا يفحص انقضاء المدّة (التأكيد فحصها).
 * @param {Object} p
 * @param {string} p.afterScanId معرّف فحص «بعد» (الذي يُكتب الآن)
 * @param {?string} p.afterDefectType نوع «بعد» (null ⟵ لا يطابق أيّ «قبل»)
 * @param {string} p.beforeScanId «قبل» المختار
 * @param {?Object} p.beforeData مستند scanProtocol/{beforeScanId} كما قرأته المعاملة (null إن غاب)
 * @param {Array<?Object>} p.linkedDocs بيانات مستندات scanProtocol التي linkedScanId فيها = beforeScanId (من الاستعلام داخل المعاملة؛ دون مستند «بعد» نفسه)
 * @param {*} [p.beforeReportData] (ق36 أ) مستند reports/{beforeScanId} كما قرأته المعاملة (undefined إن غاب: غياب الطراز لا رمي)
 * @param {*} [p.afterReportData] (ق36 أ) مستند التقرير الذي يُكتب الآن لـ«بعد» (يحمل deviceModel)
 * @return {{outcome: string, reason: ?string, afterFields: Object, beforeUpdate: ?Object, modelCheck: ?string}} modelCheck: حالة الطراز عند LINKED وحدها، وnull عند ضياع الهدف
 */
function decidePairCompletion({afterScanId, afterDefectType, beforeScanId, beforeData, linkedDocs, beforeReportData, afterReportData}) {
  const L = PAIR_LOST_REASON;
  if (!isObj(beforeData)) return lostOf(L.TARGET_NOT_FOUND, beforeScanId);
  if (beforeData[SCAN_PROTOCOL_FIELD.SCAN_PURPOSE] !== SCAN_PURPOSE.MAINTENANCE_BEFORE) return lostOf(L.TARGET_WRONG_PURPOSE, beforeScanId);
  if (!isDefectType(afterDefectType) || beforeData[SCAN_PROTOCOL_FIELD.DEFECT_TYPE] !== afterDefectType) return lostOf(L.TARGET_WRONG_TYPE, beforeScanId);
  const pair = readPair(beforeData);
  if (pair.kind !== PAIR_READ.PRESENT) return lostOf(L.TARGET_PAIR_UNREADABLE, beforeScanId);
  if (pair.state !== PAIR_STATE.OPEN) return lostOf(L.TARGET_NOT_OPEN, beforeScanId);
  if (linkedDocs.some((d) => hasLiveLink(d))) return lostOf(L.TARGET_LIVE_LINK, beforeScanId);
  // (ق36 أ) الهدف حُلّ ⟵ تُقارَن طرازا التقريرين وتُكتب الحالة مع الربط في المعاملة نفسها (لا رفض ولا تأخير ولا نصّ)
  const modelCheck = decideLinkModelCheck({afterReportData, beforeReportData});
  return {
    outcome: PAIR_COMPLETION.LINKED,
    reason: null,
    afterFields: {
      [SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID]: beforeScanId,
      [SCAN_PROTOCOL_FIELD.LINK_STATE]: LINK_STATE.ACTIVE,
      [SCAN_PROTOCOL_FIELD.LINK_METHOD]: LINK_METHOD.MANUAL,
      [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: modelCheck,
    },
    beforeUpdate: {
      [`${SCAN_PROTOCOL_FIELD.PAIR}.${PAIR_KEY.STATE}`]: PAIR_STATE.COMPLETED,
      [`${SCAN_PROTOCOL_FIELD.PAIR}.${PAIR_KEY.COMPLETED_BY_SCAN_ID}`]: afterScanId,
    },
    modelCheck,
  };
}

/**
 * قرار تأكيد «قبل» لجلسة «بعد» (دالّة نقيّة؛ A3 البند ٣): بعد اجتياز شروط الجلسة والجزء والمدّة ونوع «بعد»، يُفحص «قبل» بترتيب الرفوض المعتمد. لا مطابقة تلقائية.
 * @param {Object} p
 * @param {string} p.uid مالك الجلسة (المستدعي)
 * @param {?Object} p.beforeData مستند scanProtocol/{beforeScanId} (null إن غاب)
 * @param {?Object} p.reportData تقرير «قبل» (null إن غاب)
 * @param {string} p.afterDefectType نوع «بعد»
 * @param {number} p.validityHours المدّة من الإعداد
 * @param {number} p.nowMs
 * @param {Array<?Object>} p.linkedDocs مستندات scanProtocol التي linkedScanId فيها = «قبل»
 * @return {{ok: true}|{ok: false, refusal: string, extra: string}}
 */
function decideConfirmBefore({uid, beforeData, reportData, afterDefectType, validityHours, nowMs, linkedDocs}) {
  const L = PAIR_LINK_REFUSAL;
  const no = (refusal, extra = "") => ({ok: false, refusal, extra});
  if (!isObj(beforeData)) return no(L.BEFORE_NOT_FOUND);
  const owner = isObj(reportData) ? reportData[REPORT_FIELD.USER_ID] : undefined;
  if (typeof owner !== "string" || owner === "") return no(L.BEFORE_NOT_OWNED, " ownerState=ABSENT");
  // (S8) مالك الزوج (pair.ownerId) يجب أن يطابق مالك التقرير؛ اختلافهما شذوذ مسمّى يُرفض به ويُعلَن (لا يُصمَت ولا يُقرأ تطابقاً)، قبل حكم الملكية للمستدعي
  const pair = readPair(beforeData);
  if (pair.kind === PAIR_READ.PRESENT && pair.ownerId !== owner) return no(PAIR_CALL_REFUSAL.OWNER_MISMATCH, " ownerState=PAIR_DIFFERS_FROM_REPORT");
  if (owner !== uid) return no(L.BEFORE_NOT_OWNED, " ownerState=OTHER");
  if (beforeData[SCAN_PROTOCOL_FIELD.SCAN_PURPOSE] !== SCAN_PURPOSE.MAINTENANCE_BEFORE) return no(L.BEFORE_WRONG_PURPOSE);
  if (beforeData[SCAN_PROTOCOL_FIELD.DEFECT_TYPE] !== afterDefectType) return no(L.BEFORE_WRONG_DEFECT_TYPE);
  if (pair.kind !== PAIR_READ.PRESENT) return no(PAIR_CALL_REFUSAL.BEFORE_UNREADABLE, ` pair=${pair.kind}`);
  if (pair.state === PAIR_STATE.COMPLETED) return no(L.BEFORE_ALREADY_PAIRED, " via=PAIR_STATE");
  if (linkedDocs.some((d) => hasLiveLink(d))) return no(L.BEFORE_ALREADY_PAIRED, " via=LIVE_LINK");
  if (!isWithinWindow({openedAtMs: pair.openedAtMs, nowMs, validityHours})) return no(L.BEFORE_EXPIRED);
  return {ok: true};
}

/** أثر اتّساق التصحيح على «قبل» وأسباب تخطّيه (للسجلّ). NONE: ليست «قبل» صيانة (لا pair) أو لا شيء يُغيَّر. */
const PAIR_SYNC_EFFECT = Object.freeze({NONE: "NONE", REOPENED: "REOPENED", COMPLETED: "COMPLETED", SKIPPED: "SKIPPED"});
const PAIR_SYNC_SKIP = Object.freeze({
  TARGET_NOT_FOUND: "TARGET_NOT_FOUND",
  TARGET_PAIR_UNREADABLE: "TARGET_PAIR_UNREADABLE",
  TARGET_NOT_COMPLETED_BY_THIS: "TARGET_NOT_COMPLETED_BY_THIS", // «قبل» قديمة اكتملت بغير هذا «بعد»: لا تُعاد فتحها من تصحيح لا يخصّها
  TARGET_ALREADY_COMPLETED: "TARGET_ALREADY_COMPLETED", // «قبل» جديدة اكتملت بغير هذا «بعد»: لا تُمسّ (قواعد relink معلّقة: ق18)
});

/** معرّف الهدف الحاضر في مستند scanProtocol (linkedScanId) إن كان نصّاً غير فارغ، وإلا null. */
function currentLinkedId(protocolData) {
  const v = isObj(protocolData) ? protocolData[SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID] : undefined;
  return typeof v === "string" && v !== "" ? v : null;
}

const pairFields = (state, completedBy) => ({
  [`${SCAN_PROTOCOL_FIELD.PAIR}.${PAIR_KEY.STATE}`]: state,
  [`${SCAN_PROTOCOL_FIELD.PAIR}.${PAIR_KEY.COMPLETED_BY_SCAN_ID}`]: completedBy,
});

/**
 * اتّساق pair على «قبل» حين يصحّح المشرف ربط «بعد» X (دالّة نقيّة؛ تُستدعى بعد قرار الكتابة وبما قرأته المعاملة قبل أيّ كتابة). **لا تحذف ولا تكتب فوق سطر سابق**: تعيد تحديثات منقَّطة لحقلَي pair وحدهما.
 *   unlink: «قبل» القديمة (ربط X الحاضر) تُعاد OPEN إن كانت COMPLETED بـX. relink: القديمة كذلك، والجديدة OPEN تصير COMPLETED بـX؛ الجديدة COMPLETED بغير X لا تُمسّ (SKIPPED: TARGET_ALREADY_COMPLETED).
 *   relink إلى الهدف الحاضر نفسه: يُعالَج «جديداً» وحده: COMPLETED بـX ⟵ لا شيء (يبقى)؛ OPEN (بعد unlink سابق) ⟵ يُكتمل بـX؛ COMPLETED بغير X ⟵ يُتخطّى.
 * @param {{action: string, scanId: string, oldTargetId: ?string, oldTargetData: ?Object, newTargetId: ?string, newTargetData: ?Object}} p
 * @return {{updates: Array<{scanId: string, fields: Object}>, entries: Array<{role: string, targetId: string, effect: string, reason: ?string}>}}
 */
function decidePairSync({action, scanId, oldTargetId, oldTargetData, newTargetId, newTargetData}) {
  const updates = [];
  const entries = [];
  const isRelink = action === CORRECTION_ACTION.RELINK;
  const isUnlink = action === CORRECTION_ACTION.UNLINK;
  if (!isRelink && !isUnlink) return {updates, entries};
  const E = PAIR_SYNC_EFFECT;
  const S = PAIR_SYNC_SKIP;
  const note = (role, targetId, effect, reason = null) => entries.push({role, targetId, effect, reason});
  // relink إلى الهدف الحاضر نفسه: لا يُعالَج «قديماً» (لا يُعاد فتحه ثم يُكتمل)؛ يُعالَج «جديداً» وحده فيكون النتيجة الصحيحة في كل حالة (مكتمل بـX: لا شيء؛ مفتوح بعد unlink: يُكتمل؛ مكتمل بغيره: يُتخطّى).
  const sameTarget = isRelink && oldTargetId !== null && oldTargetId === newTargetId;
  if (!sameTarget && oldTargetId !== null) {
    if (!isObj(oldTargetData)) {
      note("OLD", oldTargetId, E.SKIPPED, S.TARGET_NOT_FOUND);
    } else {
      const pair = readPair(oldTargetData);
      if (pair.kind === PAIR_READ.ABSENT) note("OLD", oldTargetId, E.NONE);
      else if (pair.kind === PAIR_READ.UNREADABLE) note("OLD", oldTargetId, E.SKIPPED, S.TARGET_PAIR_UNREADABLE);
      else if (pair.state === PAIR_STATE.COMPLETED && pair.completedByScanId === scanId) {
        updates.push({scanId: oldTargetId, fields: pairFields(PAIR_STATE.OPEN, null)});
        note("OLD", oldTargetId, E.REOPENED);
      } else if (pair.state === PAIR_STATE.COMPLETED) note("OLD", oldTargetId, E.SKIPPED, S.TARGET_NOT_COMPLETED_BY_THIS);
      else note("OLD", oldTargetId, E.NONE);
    }
  }
  if (isRelink && newTargetId !== null) {
    if (!isObj(newTargetData)) {
      note("NEW", newTargetId, E.SKIPPED, S.TARGET_NOT_FOUND);
    } else {
      const pair = readPair(newTargetData);
      if (pair.kind === PAIR_READ.ABSENT) note("NEW", newTargetId, E.NONE);
      else if (pair.kind === PAIR_READ.UNREADABLE) note("NEW", newTargetId, E.SKIPPED, S.TARGET_PAIR_UNREADABLE);
      else if (pair.state === PAIR_STATE.OPEN) {
        updates.push({scanId: newTargetId, fields: pairFields(PAIR_STATE.COMPLETED, scanId)});
        note("NEW", newTargetId, E.COMPLETED);
      } else if (pair.completedByScanId === scanId) note("NEW", newTargetId, E.NONE);
      else note("NEW", newTargetId, E.SKIPPED, S.TARGET_ALREADY_COMPLETED);
    }
  }
  return {updates, entries};
}

module.exports = {
  PAIR_SYNC_EFFECT, PAIR_SYNC_SKIP, currentLinkedId, decidePairSync,
  PENDING_FIELD, PAIR_KEY, PAIR_NOTE, PAIR_LOST_REASON, PAIR_COMPLETION, PAIR_LINK_INTENT, MAINTENANCE_PURPOSES, isMaintenancePurpose, isDefectType, kindOf,
  validateDefectTypeForPurpose, pendingFieldsForPurposeChoice, readDefectType, buildPairField,
  OPEN_PAIR_SCAN_CAP, VALIDITY_STATE, PAIR_READ, PAIR_EXCLUDED, REPORT_FIELD, readValidityHours, isWithinWindow, readPair, hasLiveLink, classifyOpenBefore, deviceNameFor, sortNewestFirst,
  readLinkChoice, decidePairCompletion, decideConfirmBefore,
  MODEL_FALLBACK_LITERALS, readModelIdentity, decideLinkModelCheck,
};
