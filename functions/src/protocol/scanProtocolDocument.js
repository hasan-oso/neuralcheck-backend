"use strict";

// ===================================================
// scanProtocolDocument — غرض الفحص ومستند scanProtocol/{scanId} (S-P6-03، 2026-10-18 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٢ (:449-517) وdocs/PROTOCOL_CONTRACT.md §٢ A2 (المفردات من protocolVocabulary.js، مصدر واحد: القاعدة 24). **دوالّ نقيّة بلا I/O** (القاعدة 41: تُختبَر بلا Firestore).
//
// ما تقرّره هذه الوحدة:
//   (١) جزء الأغراض لمحلّ: `users/{uid}.protocolParts.purposes` — «الغائب «غير مفعَّل»» (PLAN-06:788، قرار التصميم؛ وA10 في docs/PROTOCOL_CONTRACT.md: «الغائب «غير مفعَّل»» P:787-788) فيُقرأ المفتاح بـ`=== true` وحده؛ وغيابه أو أيّ قيمة أخرى ⟵ false.
//   (٢) الغرض والمصدر عند الإنشاء: `normal` دائماً، والمصدر `default` إن فُعِّل الجزء وإلا `feature_disabled` («المحلّ بلا تفعيل الغرض»، PLAN-06:477). **فـ«عادي» الافتراضي يتميّز من «عادي» المختار** (:478).
//   (٣) مستند scanProtocol الذي يكتبه analyzeDevice في الدفعة الذرّية (A0 البند ٧): `scanPurpose` · `purposeSource` · `linkedScanId` · `linkState` · `linkMethod` · `protocolVersion` · `settingsVersion` · `createdAt`.
//       أسماء الحقول حرفيّات هنا وحدها (E36: لا تُصدَّر من الوحدة)، والمفردات من protocolVocabulary.
//
// القاعدة 22 — كل غياب حالة صريحة:
//   • فحص بلا جلسة ⟵ scanPurpose = NO_SESSION (A2: «خارج الجلسات»)، وpurposeSource = null: **لا ينطبق** (لا مصدر لغرض لا جلسة له).
//   • جلسة بلا `purpose` (أُنشئت قبل النشر) ⟵ UNDECLARED، «لا «عادي» صامتاً» (A2/PLAN-06:502)؛ ومصدر الغرض null (لا غرض).
//   • `purpose` قيمة لا تعرفها المفردات (أو NO_SESSION/UNDECLARED نفسهما مخزَّنتين في الجلسة) ⟵ UNDECLARED مع ملاحظة مسمّاة PURPOSE_NOT_RECOGNIZED (تُسجَّل في السجلّ)؛ لا تُلحَق بأقرب قيمة.
//   • غرض معروف ومصدره غائب/غير معروف في protocolPending ⟵ purposeSource = null مع ملاحظة PURPOSE_SOURCE_ABSENT أو PURPOSE_SOURCE_NOT_RECOGNIZED. لا يقع عند كتّاب هذا الملفّ (يكتبان الاثنين معاً)، فوقوعه شذوذ يُعلَن.
//   • `settingsVersion` = رقم نسخة `protocolSettings/current` وقت الفحص، أو SETTINGS_ABSENT (PROTOCOL_ABSENCE_STATE) حين لا مستند صالح (P:893: «إعدادات غائبة ⟵ SETTINGS_ABSENT»). **(S-P6-07، 2026-10-21):** كان
//     الثابت SETTINGS_ABSENT دائماً «حتى P6-14»؛ استُبدل بقراءة protocolSettings/current (protocolSettings.js) لأنّ اختيار التكرار يقرؤها ويكتب نسختها في `repeat.settingsVersion` — ولا يجوز أن يحمل المستند الواحد
//     نسختين (القاعدة 23: الاختبار الذي كان يثبّت الغياب الدائم استُبدل لا أُضيف إليه). تُمرَّر مقروءةً صراحةً (لا قيمة افتراضية).
//   • الربط: `linkedScanId = null` و`linkState = none` و`linkMethod = null` (A2: «null حين linkState = none»). الربط يبنيه P6-05 (أزواج البطارية): فكل فحص يُكتب اليوم بلا ربط، ومنه battery_after.
//   • **(S-P6-07)** `repeat`: سجلّ الاختيار للتكرار البارد (repeatScan.buildRepeatRecord) في كل فحص بحالة صريحة؛ و`repeatOf` و`repeatClassification` للفحص الثاني (الابن) وحده (null لغيره: «لا ينطبق»)؛
//     و`creditExemption` = PROTOCOL_EXEMPT أو null (P:657: «ويُكتب الإعفاء في scanProtocol»). والفحص الثاني **غرضه من التصنيف** (repeat_cold · repeat_hot · repeat_unclassified) ومصدره repeat_flow (P:476)، لا من الجلسة.
//
//   • **(S-P6-18، 2026-10-21)** `linkedScanId` و`linkState` يكتبهما أيضاً التصحيح بالإلحاق (admin/protocolCorrectionAdmin.js: unlink وrelink) فاسماهما من SCAN_PROTOCOL_FIELD (protocol/protocolCorrection.js: مصدر واحد، القاعدة 24)؛ و`exclusion` علامة تكتبها الدالّة وحدها ولا يكتبها هذا الملفّ.
//   • **(S-P6-12، 2026-10-21)** `consent`: سجلّ الموافقة بمفاتيحه الأربعة `{state, textVersion, locale, acceptedAt}` (E11): المسجَّل من الهاتف المفحوص في protocolPending (recordScanConsent) يُنسخ، وإلا `not_collected` (تطبيق قديم · فحص بلا جلسة · مخزَّن غير مقروء) —
//     «**فالموافقة غير المسجَّلة لا تُقرأ موافقة**» (PLAN-06:1402). اسم الحقل مصدر واحد CONSENT_FIELD (protocol/consent.js). المخزَّن غير المقروء يُعلَن بملاحظة CONSENT_NOT_RECOGNIZED (تُطبَع ولا تُكتب).
//
//   • **(أمر ربط «قبل/بعد صيانة»، S3، 2026-10-22)** `defectType` (نوع العطل من protocolPending، null صريحاً لغير الصيانة؛ الغائب أو غير المعروف لـmaintenance_* ⟵ null بملاحظة مسمّاة) و`pair`
//     ({state: OPEN, openedAt} لفحص maintenance_before وحده، وnull صريح لغيره): فصار المستند بخمسة عشر حقلاً (A2 وA3). فتح الزوج في الدفعة الذرّية نفسها مع التقرير والخامّ. لا زوج لفحص الابن ولا لغير الجلسة.
//
//   • **(ق36 أ، أقرّه حسن 2026-10-22)** `linkModelCheck`: ملاحظة الطراز على سجلّ «بعد» — **null صريحاً عند البناء لكل فحص** (لا مقارنة قبل أن يُحلّ هدف ربط)، وتكتب حالتها (LINK_MODEL_MATCH · LINK_MODEL_MISMATCH · LINK_MODEL_ABSENT) معاملةُ الاكتمال في analyzeDevice،
//     ويُبطلها/يعيد حسابها التصحيح بالإلحاق: فصار المستند بستّة عشر حقلاً. اسم الحقل SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK (مصدر واحد). **خادمية: لا تصل السلك ولا التقرير ولا verifyReport.**
//
// ما لا تفعله: لا تكتب الهويّة (deviceId · identityState · matchedBy: S-P6-01 معلّقة، انظر A1)، ولا تقرأ Firestore، ولا تُصدِّر أسماء الحقول.

const {
  PROTOCOL_VERSION, SCAN_PURPOSE, PURPOSE_SOURCE, LINK_STATE, PROTOCOL_PART,
} = require("./protocolVocabulary");
const {settingsVersionOf} = require("./protocolSettings");
const {buildRepeatRecord, classifyRepeatScan, buildChildProtocolFields} = require("./repeatScan");
const {CONSENT_FIELD, CONSENT_BASIS, consentForScanProtocol} = require("./consent");
const {SCAN_PROTOCOL_FIELD} = require("./protocolCorrection");
const {PAIR_NOTE, PAIR_LINK_INTENT, readDefectType, buildPairField, readLinkChoice} = require("./maintenancePair");

/** ملاحظات مسمّاة تُرجَع مع المستند وتُطبَع في السجلّ (لا تُكتب في المستند): أسماء خادم داخلية. */
const PROTOCOL_NOTE = Object.freeze({
  ...PAIR_NOTE, // (2026-10-22) DEFECT_TYPE_ABSENT · DEFECT_TYPE_NOT_RECOGNIZED: مصدرها maintenancePair.js (مصدر واحد: القاعدة 24)
  PURPOSE_ABSENT: "PURPOSE_ABSENT", // جلسة بلا purpose
  PURPOSE_NOT_RECOGNIZED: "PURPOSE_NOT_RECOGNIZED", // قيمة خارج المفردات
  PURPOSE_SOURCE_ABSENT: "PURPOSE_SOURCE_ABSENT", // غرض معروف ولا مصدر له في protocolPending
  PURPOSE_SOURCE_NOT_RECOGNIZED: "PURPOSE_SOURCE_NOT_RECOGNIZED", // مصدر خارج المفردات
  REPEAT_UNCLASSIFIED: "REPEAT_UNCLASSIFIED", // (S-P6-07) الفحص الثاني بلا تصنيف: يُلحَق به `:<سبب الغياب>`
  CONSENT_NOT_RECOGNIZED: "CONSENT_NOT_RECOGNIZED", // (S-P6-12) في protocolPending سجلّ موافقة بشكل لا يُقرأ: يُكتب not_collected ويُعلَن
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const valuesOf = (o) => Object.values(o);

/** الأغراض التي تقبلها جلسة كغرض معلَن: كل SCAN_PURPOSE ما عدا القيمتين الحالتين (NO_SESSION وUNDECLARED تصفان غياب الغرض لا غرضاً). */
const SESSION_DECLARABLE_PURPOSES = Object.freeze(valuesOf(SCAN_PURPOSE).filter((p) => p !== SCAN_PURPOSE.NO_SESSION && p !== SCAN_PURPOSE.UNDECLARED));

/**
 * أجزاء البروتوكول المفعَّلة لمحلّ، من مستند مالكه. «الغائب «غير مفعَّل»» فكل مفتاح بـ`=== true` وحده.
 * @param {?Object} ownerData مستند users/{uid} (أو null)
 * @return {Object<string, boolean>} مفتاح لكل قيمة من PROTOCOL_PART
 */
function readProtocolParts(ownerData) {
  const raw = isObj(ownerData) && isObj(ownerData.protocolParts) ? ownerData.protocolParts : {};
  const out = {};
  for (const part of valuesOf(PROTOCOL_PART)) out[part] = raw[part] === true;
  return out;
}

/**
 * الغرض ومصدره عند إنشاء الجلسة.
 * @param {Object<string, boolean>} parts ناتج readProtocolParts
 * @return {{purpose: string, purposeSource: string}}
 */
function decidePurposeAtCreation(parts) {
  return {
    purpose: SCAN_PURPOSE.NORMAL,
    purposeSource: parts[PROTOCOL_PART.PURPOSES] === true ? PURPOSE_SOURCE.DEFAULT : PURPOSE_SOURCE.FEATURE_DISABLED,
  };
}

/**
 * مستند scanProtocol/{scanId}.
 * @param {Object} p
 * @param {boolean} p.isSessionScan فحص عبر جلسة محلّ؟
 * @param {?Object} p.sessionData مستند الجلسة وقت الفحص (فحص الجلسة وحده)
 * @param {?Object} p.pendingData مستند protocolPending/{sessionId} (أو null إن لم يوجد)
 * @param {*} p.createdAt وقت الكتابة: FieldValue.serverTimestamp() حيّاً، أو العلامة المسمّاة في العيّنات — يُمرَّر صراحةً (لا قيمة افتراضية)
 * @param {{state: string, version: ?number, data: ?Object}} p.settings الإعدادات مقروءةً (readSettingsDocument)
 * @param {Object<string, boolean>} p.parts أجزاء المحلّ (readProtocolParts)
 * @param {function(): number} p.random للقرعة (يُمرَّر صراحةً)
 * @param {{state: string, valueC: ?number}} p.startTemp حرارة بدء هذا الفحص (readStartTemp لـheader.batteryTempStart)
 * @param {{isChild: boolean}} p.childContext ناتج readRepeatChildContext(pendingData)
 * @param {?string} p.creditExemption PROTOCOL_EXEMPT أو null (يُمرَّر صراحةً؛ null = خُصمت الفحصة بالطريق العادي)
 * @param {?Object} [p.parentProtocolData] مستند scanProtocol للأمّ (ق14): **صريح للفحص الثاني وحده** (null = غائب)، ولا يُقرأ لغيره
 * @return {{document: Object, notes: string[], classification: ?Object, consent: {state: string, basis: string}, pairLink: {state: string, beforeScanId: ?string}}} classification لفحص الابن وحده (يحتاجه المستدعي لتحديث الأمّ)؛ consent حالة الموافقة المكتوبة وأساسها (CONSENT_BASIS) للسطر المسمّى في analyzeDevice؛ pairLink (S5) نيّة الربط لفحص «بعد» (CHOSEN ومعها معرّف «قبل» المؤكَّد، أو NONE)
 */
function buildScanProtocolDocument(p) {
  if (!p || typeof p.isSessionScan !== "boolean") throw new Error("buildScanProtocolDocument: isSessionScan غائب أو ليس منطقياً");
  if (!Object.prototype.hasOwnProperty.call(p, "createdAt")) throw new Error("buildScanProtocolDocument: createdAt غائب — يُمرَّر صراحةً (لا قيمة افتراضية)");
  for (const k of ["settings", "parts", "random", "startTemp", "childContext"]) {
    if (!Object.prototype.hasOwnProperty.call(p, k) || p[k] === undefined || p[k] === null) throw new Error(`buildScanProtocolDocument: ${k} غائب — يُمرَّر صراحةً (لا قيمة افتراضية: القاعدة 22)`);
  }
  if (!Object.prototype.hasOwnProperty.call(p, "creditExemption") || (p.creditExemption !== null && typeof p.creditExemption !== "string")) {
    throw new Error("buildScanProtocolDocument: creditExemption غائب أو ليس نصّاً/null — يُمرَّر صراحةً");
  }
  // (ق14) الفحص الثاني للتكرار يرث موافقة أمّه: مستند الأمّ يُمرَّر صراحةً له (null = مستند الأمّ غائب؛ لا قيمة افتراضية: القاعدة 22). لغير الابن لا يُشترط ولا يُقرأ.
  if (p.childContext.isChild && !Object.prototype.hasOwnProperty.call(p, "parentProtocolData")) {
    throw new Error("buildScanProtocolDocument: parentProtocolData غائب للفحص الثاني — يُمرَّر صراحةً (null = مستند الأمّ غائب؛ لا قيمة افتراضية: القاعدة 22)");
  }
  const notes = [];
  let scanPurpose;
  let purposeSource = null;
  let classification = null;
  let childFields = null;
  if (p.childContext.isChild) {
    // الابن (S-P6-07): غرضه من تصنيف الخادم لا من الجلسة (الجلسة الابنة بلا purpose)، ومصدره repeat_flow.
    classification = classifyRepeatScan({reference: p.childContext.reference, second: p.startTemp});
    childFields = buildChildProtocolFields({context: p.childContext, second: p.startTemp, classification});
    scanPurpose = childFields.scanPurpose;
    purposeSource = childFields.purposeSource;
    if (classification.absence !== null) notes.push(`${PROTOCOL_NOTE.REPEAT_UNCLASSIFIED}:${classification.absence}`);
  } else if (!p.isSessionScan) {
    scanPurpose = SCAN_PURPOSE.NO_SESSION;
  } else {
    const declared = isObj(p.sessionData) ? p.sessionData.purpose : undefined;
    if (declared === undefined || declared === null) {
      scanPurpose = SCAN_PURPOSE.UNDECLARED;
      notes.push(PROTOCOL_NOTE.PURPOSE_ABSENT);
    } else if (typeof declared !== "string" || !SESSION_DECLARABLE_PURPOSES.includes(declared)) {
      scanPurpose = SCAN_PURPOSE.UNDECLARED;
      notes.push(PROTOCOL_NOTE.PURPOSE_NOT_RECOGNIZED);
    } else {
      scanPurpose = declared;
      const source = isObj(p.pendingData) ? p.pendingData.purposeSource : undefined;
      if (source === undefined || source === null) {
        notes.push(PROTOCOL_NOTE.PURPOSE_SOURCE_ABSENT);
      } else if (typeof source !== "string" || !valuesOf(PURPOSE_SOURCE).includes(source)) {
        notes.push(PROTOCOL_NOTE.PURPOSE_SOURCE_NOT_RECOGNIZED);
      } else {
        purposeSource = source;
      }
    }
  }
  const consent = consentForScanProtocol({
    isSessionScan: p.isSessionScan, pendingData: p.pendingData,
    inheritFrom: p.childContext.isChild ? {parentProtocolData: p.parentProtocolData} : null, // ق14: الابن وحده يرث
  });
  if (consent.basis === CONSENT_BASIS.UNREADABLE) notes.push(PROTOCOL_NOTE.CONSENT_NOT_RECOGNIZED);
  // (S3، 2026-10-22) نوع العطل (لـmaintenance_* وحدها) وفتح الزوج (لـmaintenance_before وحدها): القرار من الغرض الذي حُسم أعلاه لا من الجلسة مباشرة.
  const defect = readDefectType({scanPurpose, pendingData: p.pendingData});
  if (defect.note !== null) notes.push(defect.note);
  // (S8) مالك الزوج = ownerId مستند الجلسة وقت الفتح (analyzeDevice يقرؤه أصلاً ويُمرّره في sessionData)؛ غير نصّ غير فارغ ⟵ null صريح وملاحظة PAIR_OWNER_ABSENT (pair غير مقروء، لا يُرشَّح ولا يُؤكَّد)
  const sessionOwnerId = isObj(p.sessionData) ? p.sessionData.ownerId : undefined;
  const pairOwnerId = typeof sessionOwnerId === "string" && sessionOwnerId !== "" ? sessionOwnerId : null;
  const pair = buildPairField({scanPurpose, openedAt: p.createdAt, ownerId: pairOwnerId});
  if (pair !== null && pairOwnerId === null) notes.push(PROTOCOL_NOTE.PAIR_OWNER_ABSENT);
  // (S5) نيّة الربط لفحص maintenance_after وحده (من protocolPending): الربط نفسه يُحسم في معاملة الكتابة (decidePairCompletion) فالمستند يُبنى هنا بلا ربط (none)؛ وبلا اختيار ⟵ ملاحظة مسمّاة.
  let pairLink = {state: PAIR_LINK_INTENT.NONE, beforeScanId: null};
  if (scanPurpose === SCAN_PURPOSE.MAINTENANCE_AFTER) {
    const choice = readLinkChoice(p.pendingData);
    if (choice.note !== null) notes.push(choice.note);
    if (choice.beforeScanId !== null) pairLink = {state: PAIR_LINK_INTENT.CHOSEN, beforeScanId: choice.beforeScanId};
  }
  const repeat = buildRepeatRecord({
    isSessionScan: p.isSessionScan, scanPurpose, sessionData: p.sessionData, parts: p.parts, settings: p.settings,
    firstScanStartTemp: p.startTemp, random: p.random, decidedAt: p.createdAt,
  });
  return {
    document: {
      [SCAN_PROTOCOL_FIELD.SCAN_PURPOSE]: scanPurpose,
      purposeSource,
      [SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID]: null,
      [SCAN_PROTOCOL_FIELD.LINK_STATE]: LINK_STATE.NONE,
      linkMethod: null,
      protocolVersion: PROTOCOL_VERSION,
      settingsVersion: settingsVersionOf(p.settings),
      repeat,
      repeatOf: childFields ? childFields.repeatOf : null,
      repeatClassification: childFields ? childFields.repeatClassification : null,
      creditExemption: p.creditExemption,
      [CONSENT_FIELD]: consent.record,
      [SCAN_PROTOCOL_FIELD.DEFECT_TYPE]: defect.value,
      [SCAN_PROTOCOL_FIELD.PAIR]: pair,
      // (ق36 أ، 2026-10-22) ملاحظة الطراز: null صريحاً عند البناء (لا مقارنة قبل أن يُحلّ هدف ربط)؛ تكتبها معاملة اكتمال «بعد» وحدها (decidePairCompletion) وتُصحَّح بالتصحيح بالإلحاق. خادمية: لا تصل السلك
      [SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK]: null,
      createdAt: p.createdAt,
    },
    notes,
    classification,
    consent: {state: consent.record.state, basis: consent.basis},
    pairLink,
  };
}

/**
 * هل الفحص «بروتوكولي» يُمنع فيه إعادة استعمال تقرير سابق وتمرير previousScan؟ (PLAN-06:404-407 «analyzeDevice يمنع إعادة الاستعمال صراحةً حين الغرض repeat_* أو battery_after أو return»؛ س١١: «المنع في الفحوص البروتوكولية وحدها»).
 * `return` أُسقط (قرار 2026-10-10). السبب المُعاد هو قيمة الغرض نفسها (SCAN_PURPOSE)، فلا حرفية ثانية (القاعدة 24)؛ وnull لغير البروتوكولي.
 * @param {{isChild: boolean}} p.childContext
 * @param {?{purpose: string}} p.classification تصنيف الابن (له وحده)
 * @param {?Object} p.sessionData مستند الجلسة
 * @return {?string}
 */
function protocolReuseBlockedReason({childContext, classification, sessionData}) {
  if (childContext.isChild) return classification.purpose;
  // (2026-10-22، A3 البند ٤): فحص «بعد الصيانة» قياس جديد كفحص «بعد البطارية»: لا إعادة استعمال تقرير مخزَّن ولا previousScan. maintenance_before لا يمنع (كما battery_before).
  if (isObj(sessionData) && (sessionData.purpose === SCAN_PURPOSE.BATTERY_AFTER || sessionData.purpose === SCAN_PURPOSE.MAINTENANCE_AFTER)) return sessionData.purpose;
  return null;
}

module.exports = {
  PROTOCOL_NOTE, SESSION_DECLARABLE_PURPOSES, readProtocolParts, decidePurposeAtCreation, buildScanProtocolDocument, protocolReuseBlockedReason,
};
