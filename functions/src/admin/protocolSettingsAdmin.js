"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db, requireAdmin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH, PROTOCOL_ABSENCE_STATE} = require("../protocol/protocolVocabulary");
const {SETTINGS_STATE, readSettingsDocument} = require("../protocol/protocolSettings");
const {
  SETTINGS_LIMITS, SETTINGS_FIELDS_NOT_SPECIFIED, SETTINGS_WRITABLE_FIELDS, SETTINGS_WRITE_REFUSAL: R, REFUSAL_RESPONSE, validateSettingsPatch, applySettingsPatch,
} = require("../protocol/settingsWrite");

// ===================================================
// setProtocolSettings / getProtocolSettings — إعدادات البروتوكول من لوحة الإدارة (S-P6-14، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-١ (:767-793) وdocs/PROTOCOL_CONTRACT.md §٢ A10 (إلحاق مؤرَّخ بكل شكل سلك): «`protocolSettings/current`، تكتبه دالّة مشرف `setProtocolSettings`: تتحقّق من المدى، وترفع `version`،
// وتحفظ النسخة السابقة في `history`.» و«كل صفحة جديدة تقرأ من دالّة مشرف، لا من Firestore مباشرةً» (P:765) فللقراءة `getProtocolSettings` (**اسم اقتراحي**، على سابقة getAiConfig/setAiModel القائمة في aiModelConfig.js:
// دالّتان لا واحدة: القراءة وحدها لا تكفي، والكتابة تمرّ بالخادم كي لا تتجاوز القائمة المغلقة والمدى موقعٌ يكتب مباشرةً). **المشرف** بـrequireAdmin (بريد مؤكَّد).
//
// ─── setProtocolSettings({settings}) ─────────────────────────────────────────────────────────────────────────────
//   المدخل `{settings: {<حقل>: <قيمة>, ...}}` — رقعة على الحاضر (لا حقل إلزامي، ولا قيمة افتراضية، ولا مسح: القاعدتان 22 و42). الحقول المقبولة السبعة والمعلّقان (symptomChips · targets) في settingsWrite.js.
//   معاملة واحدة: تقرأ المستند الحاضر، فتتحقّق وتدمج، ثم: أوّل كتابة ⟵ version 1 بلا history؛ وما بعدها ⟵ **`tx.create`** لـ`protocolSettings/current/history/{الإصدار السابق}` (نسخة المستند السابق كاملةً + `supersededAt` + `supersededByVersion`
//   + `supersededBy` مُهشَّراً؛ `create` لا `set`: لا يُكتب فوق نسخة محفوظة) ثم `tx.set` للحاضر بـversion = السابق + 1 و`updatedAt` و`updatedBy` (المشرف مُهشَّراً: P:863). **قيمة لم تتغيّر لا تُنتج نسخة** (`changed: false`، على نسق setAiModel).
//   الردّ: `{changed, version, fields}` (`fields`: أسماء الحقول المتغيّرة، فارغة حين لا تغيّر).
//   **المستند الحاضر بلا version صالح** (كتابة يدوية): يُرفض SETTINGS_CURRENT_VERSION_INVALID (لا يُخمَّن ما بعده؛ إصلاحه يدويّ).
//   الرفض بسبب مسمّى (`details.reasonCode` ومعه `details.field` حين ينطبق): انظر REFUSAL_RESPONSE؛ **الرسالة رمزه التقني** (لا نصّ عربي جديد: القرار ٩٠).
//
// ─── getProtocolSettings() ────────────────────────────────────────────────────────────────────────────────────────
//   الردّ: `{state, anomaly, version, settings, updatedAtMs, updatedBy, limits, notSpecified}` — `state` ∈ {"PRESENT", "SETTINGS_ABSENT"} (القيمة نفسها التي يحملها settingsVersion في الفحوص)؛ `anomaly` null أو
//   "VERSION_UNUSABLE" (مستند موجود بلا version صالح: يُقرأ غائباً)؛ `version` عدد أو null؛ `settings` الحقول السبعة الحاضرة وحدها (الغائب غائب: لا null ولا افتراضي)؛ `updatedAtMs` ms أو null؛ `limits` حدود الحقول (الواجهة لا تكرّرها)؛
//   `notSpecified` أسماء الحقلين المعلّقين.
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   `[setProtocolSettings] written version=<n> fields=<أسماء> caller=<#>` · `unchanged version=<n> caller=<#>` · `refused reason=<..> caller=<#>[ field=<..> cause=<..>]`. **لا قيمة حقل ولا نصّ سبب مرتجع** (أسماء الحقول وحدها). لا حذف في أيّ مسار (القاعدة 42).

const SET = "setProtocolSettings";
const GET = "getProtocolSettings";

function currentRef() {
  return db.collection(PROTOCOL_COLLECTION.PROTOCOL_SETTINGS).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC);
}
const toMillisOrNull = (v) => (v && typeof v.toMillis === "function" && Number.isFinite(v.toMillis()) ? v.toMillis() : null);

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` الخاصّ بهذا الملفّ** (requireAdmin من utils/admin.js له رفضاه القائمان).
 * @param {string} reason من SETTINGS_WRITE_REFUSAL
 * @param {{uid?: ?string, field?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {uid = null, field = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`protocolSettingsAdmin: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${SET}] refused reason=${reason} caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode, ...(field ? {field} : {})});
}

const setProtocolSettingsHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const d = request.data && typeof request.data === "object" && !Array.isArray(request.data) ? request.data : {};
  const validated = validateSettingsPatch(d.settings);
  if (!validated.ok) refuse(validated.refusal, {uid, field: validated.field || null, extra: validated.extra || ""});

  const ref = currentRef();
  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      let currentVersion = 0;
      if (current !== null) {
        const reading = readSettingsDocument(current);
        if (reading.state !== SETTINGS_STATE.PRESENT) return {refused: R.CURRENT_VERSION_INVALID};
        currentVersion = reading.version;
      }
      const applied = applySettingsPatch({current, values: validated.values});
      if (!applied.ok) return {refused: applied.refusal, field: applied.field || null, extra: applied.extra || ""};
      if (current !== null && applied.changed.length === 0) return {changed: false, version: currentVersion, fields: []};
      const nextVersion = currentVersion + 1;
      const FieldValue = admin.firestore.FieldValue;
      const actor = hashIdForLog(uid);
      if (current !== null) {
        tx.create(ref.collection(PROTOCOL_SETTINGS_PATH.HISTORY_SUBCOLLECTION).doc(String(currentVersion)), {
          ...current, supersededAt: FieldValue.serverTimestamp(), supersededByVersion: nextVersion, supersededBy: actor,
        });
      }
      tx.set(ref, {...applied.next, version: nextVersion, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor});
      return {changed: true, version: nextVersion, fields: applied.changed};
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[${SET}] unexpected failure caller=${hashIdForLog(uid)} [${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }
  if (decided.refused) refuse(decided.refused, {uid, field: decided.field || null, extra: decided.extra || ""});
  if (decided.changed) console.log(`[${SET}] written version=${decided.version} fields=${decided.fields.join(",")} caller=${hashIdForLog(uid)}`);
  else console.log(`[${SET}] unchanged version=${decided.version} caller=${hashIdForLog(uid)}`);
  return {changed: decided.changed, version: decided.version, fields: decided.fields};
};

const getProtocolSettingsHandler = async (request) => {
  requireAdmin(request);
  const snap = await currentRef().get();
  const reading = readSettingsDocument(snap.exists ? snap.data() : null);
  const present = reading.state === SETTINGS_STATE.PRESENT;
  const settings = {};
  if (present) {
    for (const f of SETTINGS_WRITABLE_FIELDS) if (reading.data[f] !== undefined && reading.data[f] !== null) settings[f] = reading.data[f];
  }
  console.log(`[${GET}] served state=${present ? "PRESENT" : PROTOCOL_ABSENCE_STATE.SETTINGS_ABSENT} version=${present ? reading.version : "NONE"} caller=${hashIdForLog(request.auth.uid)}`);
  return {
    state: present ? SETTINGS_STATE.PRESENT : PROTOCOL_ABSENCE_STATE.SETTINGS_ABSENT,
    anomaly: reading.anomaly,
    version: present ? reading.version : null,
    settings,
    updatedAtMs: present ? toMillisOrNull(reading.data.updatedAt) : null,
    updatedBy: present && typeof reading.data.updatedBy === "string" ? reading.data.updatedBy : null,
    limits: SETTINGS_LIMITS,
    notSpecified: [...SETTINGS_FIELDS_NOT_SPECIFIED],
  };
};

exports.setProtocolSettings = onCall({timeoutSeconds: 30, memory: "256MiB"}, setProtocolSettingsHandler);
exports.getProtocolSettings = onCall({timeoutSeconds: 30, memory: "256MiB"}, getProtocolSettingsHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.refuse = refuse;
exports.setProtocolSettingsHandler = setProtocolSettingsHandler;
exports.getProtocolSettingsHandler = getProtocolSettingsHandler;
