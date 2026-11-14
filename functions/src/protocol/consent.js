"use strict";

// ===================================================
// consent — سجلّ الموافقة على الهاتف المفحوص: تحقّق المدخل، وقراءة المخزَّن، ومستند scanProtocol.consent (S-P6-12، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١١ (:1377-1413) وdocs/PROTOCOL_CONTRACT.md §٢ A8 (إلحاق مؤرَّخ بكل شكل سلك وما بُني وما عُلِّق):
//   «**«أوافق»** ⇐ يُخزَّن في protocolPending ثم scanProtocol: `consent: {state: "accepted", textVersion, locale, acceptedAt (الخادم)}`.» (:1393)
//   «**«لا أوافق»** ⇐ `declined`، والجلسة تُلغى، **ولا يُرسل معرّف.**» (:1394)
//   «**تطبيق قديم بلا الشاشة** ⇐ `not_collected`» (:1401) و«**فشل تسجيل الموافقة** (شبكة) ⇐ الفحص لا يبدأ حتى تُسجَّل [اجتهاد]. **فالموافقة غير المسجَّلة لا تُقرأ موافقة.**» (:1402).
//   والشكل الواحد المعتمد `consent: {state, textVersion, locale, acceptedAt}` (E11، 2026-10-15) و`CONSENT_TEXT_VERSION = 2` (رُفعت من 1 في 2026-10-23: نصّ الشاشة تغيّر في التطبيق؛ والنسخة 1 تبقى مقبولة).
// **دوالّ نقيّة بلا I/O** (القاعدة 41: تُختبَر بلا Firestore). الكاتب recordScanConsent (sessions/recordScanConsent.js) والقارئ buildScanProtocolDocument (scanProtocolDocument.js) يستوردان **اسم الحقل** CONSENT_FIELD من هنا:
// مصدر واحد (القاعدة 24)، ويثبّت consent.test.js ألّا حرفيّة ثانية له في src.
//
// ما تقرّره هذه الوحدة (قراراتي، القاعدة 45؛ كلّها مكتوبة في A8 للمراجعة):
//   (١) **نسخة النصّ المقبولة**: عدد صحيح من 1 إلى CONSENT_TEXT_VERSION. الأقدم مقبول (تطبيق ما زال يعرض نصّاً أقدم يُسجَّل بنسخته الحقيقية: الدليل أنّ المستخدم وافق على ما رآه)، والأحدث مرفوض (الخادم لا يشهد على نصّ لا يعرفه).
//   (٢) **اللغة**: قائمة مغلقة CONSENT_LOCALE (ar · tr) — النصّ معتمد بالعربية والتركية وحدهما (consent-text-proposal-2026-10-09.md:44-54). **قيماها اقتراحيان** (التصميم يسمّي الحقل `locale` ولا قيمه).
//   (٣) **المخزَّن غير المقروء** (كتابة يدوية بشكل مخالف) لا يُكتب فوقه ولا يُقرأ موافقة: المسجِّل يرفض CONSENT_STORED_UNREADABLE، ومُنشئ scanProtocol يكتب not_collected ويُعلن CONSENT_NOT_RECOGNIZED في السجلّ.
//   (٤) **الأوّل يبقى**: موافقة مسجَّلة لا تُستبدل بنداء ثانٍ (الدليل لا يُعاد كتابته)؛ النداء الثاني يردّ المخزَّن.
//   (٥) **`declined` لا يُكتب في أيّ مستند خادمي**: الرفض نداء cancelScanSession بسبب consent_declined (sessionNames.CANCEL_REASON) فيُسجَّل سبب الإلغاء على الجلسة، ولا scanProtocol لجلسة ملغاة (لا تقرير). فالمخزَّن المقروء موافقة `accepted` وحدها.

const {CONSENT_STATE, CONSENT_TEXT_VERSION, CONSENT_LOCALE} = require("./protocolVocabulary");
const {RECORD_CONSENT_REFUSAL: R} = require("../sessions/sessionNames");

/** اسم حقل الموافقة في `protocolPending/{sessionId}` وفي `scanProtocol/{scanId}` — المصدر الواحد لكاتبه وقارئه (القاعدة 24). */
const CONSENT_FIELD = "consent";

/** أساس ما كُتب في scanProtocol.consent (يُطبع في السجلّ ولا يُكتب في المستند): RECORDED مسجَّلة من الجهاز المفحوص · NO_SESSION فحص بلا جلسة (لا protocolPending) · NOT_RECORDED جلسة بلا سجلّ موافقة (تطبيق قديم) · UNREADABLE مخزَّن بشكل غير معروف. */
const CONSENT_BASIS = Object.freeze({
  INHERITED: "INHERITED", // (ق14) جلسة ابنة لتكرار بلا سجلّ ذاتي ومعها موافقة أمّ مقبولة: كُتبت موافقة الأمّ موروثةً
  RECORDED: "RECORDED",
  NO_SESSION: "NO_SESSION",
  NOT_RECORDED: "NOT_RECORDED",
  UNREADABLE: "UNREADABLE",
});

/** حالة قراءة المخزَّن في protocolPending. */
const STORED_CONSENT_STATE = Object.freeze({
  ABSENT: "ABSENT",
  PRESENT: "PRESENT",
  UNREADABLE: "UNREADABLE",
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isTimestampLike = (v) => v !== null && typeof v === "object" && typeof v.toMillis === "function" && Number.isFinite(v.toMillis());
const LOCALES = Object.values(CONSENT_LOCALE);

/**
 * مدخل recordScanConsent: نسخة النصّ واللغة. لا قيمة افتراضية لأيّ منهما (القاعدة 22): الغياب رفض بسببه.
 * @param {*} d request.data (قد لا يكون كائناً)
 * @return {{ok: true, textVersion: number, locale: string}|{ok: false, refusal: string, extra: string}} extra يُلحَق بسطر الرفض (سبب القراءة، بلا القيمة الخام)
 */
function validateConsentInput(d) {
  const data = isObj(d) ? d : {};
  if (data.textVersion === undefined || data.textVersion === null) return {ok: false, refusal: R.TEXT_VERSION_REQUIRED, extra: ""};
  const v = data.textVersion;
  if (typeof v !== "number" || !Number.isFinite(v)) return {ok: false, refusal: R.TEXT_VERSION_INVALID, extra: " cause=NOT_A_FINITE_NUMBER"};
  if (!Number.isInteger(v)) return {ok: false, refusal: R.TEXT_VERSION_INVALID, extra: " cause=NOT_AN_INTEGER"};
  if (v < 1) return {ok: false, refusal: R.TEXT_VERSION_INVALID, extra: " cause=BELOW_FIRST_VERSION"};
  if (v > CONSENT_TEXT_VERSION) return {ok: false, refusal: R.TEXT_VERSION_INVALID, extra: " cause=ABOVE_CURRENT_VERSION"};
  if (data.locale === undefined || data.locale === null || data.locale === "") return {ok: false, refusal: R.LOCALE_REQUIRED, extra: ""};
  if (typeof data.locale !== "string" || !LOCALES.includes(data.locale)) return {ok: false, refusal: R.LOCALE_INVALID, extra: ""};
  return {ok: true, textVersion: v, locale: data.locale};
}

/**
 * سجلّ الموافقة المقبولة كما يُخزَّن (المفاتيح الأربعة المعتمدة، E11).
 * @param {{textVersion: number, locale: string, acceptedAt: *}} p acceptedAt يُمرَّر صراحةً (FieldValue.serverTimestamp() حيّاً)
 * @return {{state: string, textVersion: number, locale: string, acceptedAt: *}}
 */
function buildAcceptedRecord({textVersion, locale, acceptedAt}) {
  return {state: CONSENT_STATE.ACCEPTED, textVersion, locale, acceptedAt};
}

/**
 * سجلّ الموافقة الموروثة (ق14): الجلسة الابنة للتكرار ترث موافقة أمّها المقبولة — المفاتيح الأربعة نفسها، بحالة inherited، ونسخة النصّ ولغته ووقت القبول من الأمّ (الدليل على ما قرأه المستخدم ومتى: لا وقت التحليل).
 * @param {{textVersion: number, locale: string, acceptedAt: *}} parentRecord سجلّ الأمّ المقروء (readStoredConsent.record)
 * @return {{state: string, textVersion: number, locale: string, acceptedAt: *}}
 */
function buildInheritedRecord(parentRecord) {
  return {state: CONSENT_STATE.INHERITED, textVersion: parentRecord.textVersion, locale: parentRecord.locale, acceptedAt: parentRecord.acceptedAt};
}

/** سجلّ «لم تُجمَع» بالمفاتيح الأربعة نفسها: الغياب صريح (القاعدة 22) لا مفتاحاً محذوفاً ولا قيمة تشبه موافقة. */
function buildNotCollectedRecord() {
  return {state: CONSENT_STATE.NOT_COLLECTED, textVersion: null, locale: null, acceptedAt: null};
}

/**
 * يقرأ ما خُزِّن في protocolPending. **المقروء موافقةً هو `accepted` وحدها** بنسخة صحيحة ولغة معروفة ووقت خادم؛ غير ذلك (بما فيه `declined` وأيّ شكل آخر) UNREADABLE.
 * @param {?Object} pendingData مستند protocolPending/{sessionId} (أو null)
 * @return {{state: string, record: ?{state: string, textVersion: number, locale: string, acceptedAt: *}}}
 */
function readStoredConsent(pendingData) {
  const raw = isObj(pendingData) ? pendingData[CONSENT_FIELD] : undefined;
  if (raw === undefined || raw === null) return {state: STORED_CONSENT_STATE.ABSENT, record: null};
  const valid = isObj(raw) && raw.state === CONSENT_STATE.ACCEPTED &&
      Number.isInteger(raw.textVersion) && raw.textVersion >= 1 && raw.textVersion <= CONSENT_TEXT_VERSION &&
      typeof raw.locale === "string" && LOCALES.includes(raw.locale) && isTimestampLike(raw.acceptedAt);
  if (!valid) return {state: STORED_CONSENT_STATE.UNREADABLE, record: null};
  return {state: STORED_CONSENT_STATE.PRESENT, record: buildAcceptedRecord({textVersion: raw.textVersion, locale: raw.locale, acceptedAt: raw.acceptedAt})};
}

/**
 * مستند `scanProtocol.consent` لفحص: المسجَّلة من protocolPending إن وُجدت، وإلا not_collected بأساسها. لا موافقة تُستنتج من الغياب (:1402).
 * **الوراثة (ق14، 2026-10-23):** الجلسة الابنة للتكرار (`inheritFrom` = {parentProtocolData}) بلا سجلّ ذاتي (ABSENT) وموافقة أمّها المسجَّلة في scanProtocol مقروءة مقبولة (accepted بنسخة ولغة ووقت صالحة) ⟵ inherited بأساس INHERITED.
 * وكل ما سواه كما كان: السجلّ الذاتي المقروء يفوز (RECORDED)؛ المخزَّن الذاتي غير المقروء لا تغطّيه الوراثة (UNREADABLE)؛ الأمّ غائبة أو بلا موافقة أو not_collected أو غير مقروءة (ومنها inherited: لا سلسلة وراثة) ⟵ not_collected/NOT_RECORDED؛
 * وغير الابن (inheritFrom null أو غائب) والفحص بلا جلسة لا يرثان.
 * @param {{isSessionScan: boolean, pendingData: ?Object, inheritFrom?: ?{parentProtocolData: ?Object}}} p
 * @return {{record: Object, basis: string}} basis من CONSENT_BASIS (للسجلّ)
 */
function consentForScanProtocol({isSessionScan, pendingData, inheritFrom}) {
  if (!isSessionScan) return {record: buildNotCollectedRecord(), basis: CONSENT_BASIS.NO_SESSION};
  const stored = readStoredConsent(pendingData);
  if (stored.state === STORED_CONSENT_STATE.PRESENT) return {record: stored.record, basis: CONSENT_BASIS.RECORDED};
  if (stored.state === STORED_CONSENT_STATE.UNREADABLE) return {record: buildNotCollectedRecord(), basis: CONSENT_BASIS.UNREADABLE};
  if (isObj(inheritFrom)) {
    const parent = readStoredConsent(inheritFrom.parentProtocolData);
    if (parent.state === STORED_CONSENT_STATE.PRESENT) return {record: buildInheritedRecord(parent.record), basis: CONSENT_BASIS.INHERITED};
  }
  return {record: buildNotCollectedRecord(), basis: CONSENT_BASIS.NOT_RECORDED};
}

module.exports = {
  CONSENT_FIELD, CONSENT_BASIS, STORED_CONSENT_STATE,
  validateConsentInput, buildAcceptedRecord, buildInheritedRecord, buildNotCollectedRecord, readStoredConsent, consentForScanProtocol,
};
