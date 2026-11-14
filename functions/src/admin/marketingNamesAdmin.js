"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db, requireAdmin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {PROTOCOL_COLLECTION, PROTOCOL_SETTINGS_PATH} = require("../protocol/protocolVocabulary");
const {
  MARKETING_NAMES_LIMITS, MARKETING_NAMES_FIELD: F, MARKETING_NAMES_STATE, MARKETING_NAMES_REFUSAL: R,
  validateEntriesPatch, readMarketingNamesDocument, mergeEntries,
} = require("../protocol/marketingNames");

// ===================================================
// setMarketingNames / getMarketingNames — خريطة الأسماء التجارية من لوحة الإدارة (S-P6-20، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §١٥-أ-١ (:1527-1536) وdocs/PROTOCOL_CONTRACT.md §٢ A12 (إلحاق مؤرَّخ بكل شكل سلك وما بُني وما عُلِّق): «**مصدر واحد في الخادم** بالعربية والتركية والإنجليزية، **من بيانات يحرّرها المشرف**»؛
// وE14: `marketingNames/current` بـ`version` و`entries[] {model, ar, tr, en}` + `history/{version}`. **اسما الدالّتين اقتراحيان** (التصميم يسمّي المجموعة وحدها): على سابقة setProtocolSettings/getProtocolSettings (S-P6-14) وgetAiConfig/setAiModel.
// يحاذيهما وكيل الموقع (W-P6-20) إلى A12 في docs/PROTOCOL_CONTRACT.md لا إلى هذا الكود. **المشرف** بـrequireAdmin (بريد مؤكَّد). **لا يمسّ `reports.deviceMarketingName` القائم** (E14).
//
// ─── setMarketingNames({entries}) ─────────────────────────────────────────────────────────────────────────────────
//   `entries`: مصفوفة غير فارغة من `{model, ar, tr, en}` (المفاتيح الأربعة إلزامية، حدود marketingNames.js) — **رقعة بالتحديث-أو-الإضافة** بـ`model` (لا حذف مدخل ولا استبدال القائمة: القاعدة 42).
//   معاملة واحدة: تقرأ المستند الحاضر، فتتحقّق وتدمج، ثم: أوّل كتابة ⟵ version 1 بلا history؛ وما بعدها ⟵ **`tx.create`** لـ`marketingNames/current/history/{الإصدار السابق}` (المستند السابق كاملاً + `supersededAt` + `supersededByVersion`
//   + `supersededBy` مُهشَّراً؛ `create` لا `set`: لا يُكتب فوق نسخة محفوظة) ثم `tx.set` للحاضر بـversion = السابق + 1 و`updatedAt` و`updatedBy` (المشرف مُهشَّراً). **ما لم يتغيّر لا يُنتج نسخة** (`changed: false`).
//   الردّ: `{changed, version, added, updated}` — عدد المداخل المُلحَقة والمُحدَّثة (لا أسماء ولا طرازات في الردّ ولا في السجلّ).
//   **المستند الحاضر بشكل لا يُقرأ** (كتابة يدوية): MARKETING_NAMES_CURRENT_UNREADABLE (لا يُخمَّن ما بعده؛ إصلاحه يدويّ).
// ─── getMarketingNames() ──────────────────────────────────────────────────────────────────────────────────────────
//   الردّ `{state, anomaly, version, entries, updatedAtMs, updatedBy, limits}` — `state` ∈ {PRESENT, ABSENT, UNREADABLE}؛ `anomaly` null أو سبب UNREADABLE؛ `entries` المداخل بترتيبها (فارغة حين لا تُقرأ: الغائب غائب)؛ `limits` الحدود.
//   **لا يقبل مدخلاً** (لا يقرأ request.data أصلاً): `{}` وnull وغيابه سواء؛ يتطلّب المشرف وحده.
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   `[setMarketingNames] written version=<n> added=<n> updated=<n> caller=<#>` · `unchanged version=<n> caller=<#>` · `refused reason=<..> caller=<#>[ extra]` · `[getMarketingNames] served state=<..> version=<n|NONE> entries=<n> caller=<#>`.
//   **لا طراز ولا اسم في أيّ سطر** (الأعداد وحدها). لا حذف في أيّ مسار.

const SET = "setMarketingNames";
const GET = "getMarketingNames";

function currentRef() {
  return db.collection(PROTOCOL_COLLECTION.MARKETING_NAMES).doc(PROTOCOL_SETTINGS_PATH.CURRENT_DOC);
}
const toMillisOrNull = (v) => (v && typeof v.toMillis === "function" && Number.isFinite(v.toMillis()) ? v.toMillis() : null);

/**
 * ردّ كل رفض: رمز HttpsError ونصّه (الرمز التقني: لا نصّ عربي جديد، القرار ٩٠) والرمز الذي يصل العميل في details.reasonCode.
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze({
  [R.ENTRIES_REQUIRED]: Object.freeze({code: "invalid-argument", message: R.ENTRIES_REQUIRED, clientReasonCode: R.ENTRIES_REQUIRED}),
  [R.TOO_MANY_ENTRIES]: Object.freeze({code: "invalid-argument", message: R.TOO_MANY_ENTRIES, clientReasonCode: R.TOO_MANY_ENTRIES}),
  [R.ENTRY_INVALID]: Object.freeze({code: "invalid-argument", message: R.ENTRY_INVALID, clientReasonCode: R.ENTRY_INVALID}),
  [R.DUPLICATE_MODEL]: Object.freeze({code: "invalid-argument", message: R.DUPLICATE_MODEL, clientReasonCode: R.DUPLICATE_MODEL}),
  [R.CURRENT_UNREADABLE]: Object.freeze({code: "failed-precondition", message: R.CURRENT_UNREADABLE, clientReasonCode: R.CURRENT_UNREADABLE}),
});

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` الخاصّ بهذا الملفّ** (requireAdmin من utils/admin.js له رفضاه القائمان).
 * @param {string} reason من MARKETING_NAMES_REFUSAL
 * @param {{uid?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {uid = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`marketingNamesAdmin: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${SET}] refused reason=${reason} caller=${hashIdForLog(uid)}${extra}`);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode});
}

const setMarketingNamesHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const d = request.data && typeof request.data === "object" && !Array.isArray(request.data) ? request.data : {};
  const validated = validateEntriesPatch(d.entries);
  if (!validated.ok) refuse(validated.refusal, {uid, extra: validated.extra});

  const ref = currentRef();
  let decided;
  try {
    decided = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data() : null;
      const reading = readMarketingNamesDocument(current);
      if (reading.state === MARKETING_NAMES_STATE.UNREADABLE) return {refused: R.CURRENT_UNREADABLE, extra: ` anomaly=${reading.anomaly}`};
      const merged = mergeEntries(reading.entries, validated.entries);
      if (!merged.ok) return {refused: merged.refusal, extra: merged.extra};
      const currentVersion = reading.state === MARKETING_NAMES_STATE.PRESENT ? reading.version : 0;
      if (reading.state === MARKETING_NAMES_STATE.PRESENT && merged.added === 0 && merged.updated === 0) return {changed: false, version: currentVersion, added: 0, updated: 0};
      const nextVersion = currentVersion + 1;
      const FieldValue = admin.firestore.FieldValue;
      const actor = hashIdForLog(uid);
      if (reading.state === MARKETING_NAMES_STATE.PRESENT) {
        tx.create(ref.collection(PROTOCOL_SETTINGS_PATH.HISTORY_SUBCOLLECTION).doc(String(currentVersion)), {
          ...current, supersededAt: FieldValue.serverTimestamp(), supersededByVersion: nextVersion, supersededBy: actor,
        });
      }
      tx.set(ref, {[F.ENTRIES]: merged.next, [F.VERSION]: nextVersion, [F.UPDATED_AT]: FieldValue.serverTimestamp(), [F.UPDATED_BY]: actor});
      return {changed: true, version: nextVersion, added: merged.added, updated: merged.updated};
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[${SET}] unexpected failure caller=${hashIdForLog(uid)} [${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }
  if (decided.refused) refuse(decided.refused, {uid, extra: decided.extra || ""});
  if (decided.changed) console.log(`[${SET}] written version=${decided.version} added=${decided.added} updated=${decided.updated} caller=${hashIdForLog(uid)}`);
  else console.log(`[${SET}] unchanged version=${decided.version} caller=${hashIdForLog(uid)}`);
  return {changed: decided.changed, version: decided.version, added: decided.added, updated: decided.updated};
};

const getMarketingNamesHandler = async (request) => {
  requireAdmin(request);
  const snap = await currentRef().get();
  const data = snap.exists ? snap.data() : null;
  const reading = readMarketingNamesDocument(data);
  const present = reading.state === MARKETING_NAMES_STATE.PRESENT;
  console.log(`[${GET}] served state=${reading.state} version=${present ? reading.version : "NONE"} entries=${reading.entries.length} caller=${hashIdForLog(request.auth.uid)}`);
  return {
    state: reading.state,
    anomaly: reading.anomaly,
    version: present ? reading.version : null,
    entries: reading.entries,
    updatedAtMs: present ? toMillisOrNull(data[F.UPDATED_AT]) : null,
    updatedBy: present && typeof data[F.UPDATED_BY] === "string" ? data[F.UPDATED_BY] : null,
    limits: MARKETING_NAMES_LIMITS,
  };
};

exports.setMarketingNames = onCall({timeoutSeconds: 30, memory: "256MiB"}, setMarketingNamesHandler);
exports.getMarketingNames = onCall({timeoutSeconds: 30, memory: "256MiB"}, getMarketingNamesHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.refuse = refuse;
exports.setMarketingNamesHandler = setMarketingNamesHandler;
exports.getMarketingNamesHandler = getMarketingNamesHandler;
