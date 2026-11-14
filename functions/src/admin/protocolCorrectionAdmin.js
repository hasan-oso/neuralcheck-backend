"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {admin, db, requireAdmin} = require("../utils/admin");
const {hashIdForLog} = require("../utils/logRedaction");
const {PROTOCOL_COLLECTION, CORRECTION_ACTION} = require("../protocol/protocolVocabulary");
const {
  SCAN_PROTOCOL_FIELD, CORRECTION_LINE_FIELD, CORRECTION_REFUSAL: R, OUTCOME,
  validateCorrectionInput, decideCorrection, buildCorrectionLine,
} = require("../protocol/protocolCorrection");
const MP = require("../protocol/maintenancePair");

// ===================================================
// correctProtocolRecord — التصحيح بالإلحاق من لوحة الإدارة (S-P6-18، 2026-10-21 +03)
// ===================================================
//
// المواصفة: PLAN-06-DATA-COLLECTION.md §٦-ب-٥ (:854-868) وdocs/PROTOCOL_CONTRACT.md §٢ A11 (إلحاق مؤرَّخ بكل شكل سلك وما بُني وما عُلِّق): «دالّة مشرف `correctProtocolRecord` بأفعال: `unlink`، و`relink(toScanId)`.
// و`exclude(reason ∈ {test, wrong, golden_reference})`، و`unexclude`. و`resolveIdentityConflict`. كل فعل: يكتب علامة على scanProtocol (`exclusion: {state, reasonCode, at}`، `linkState`).
// ويُلحق سطراً في protocolCorrections بالقيم قبل وبعد، ورمز سبب (القرار ١٢)، والمشرف مُهشَّراً. لا حذف بأيّ وسيلة (القاعدة 42).» (:856-864). **المشرف** بـrequireAdmin (بريد مؤكَّد).
// **الدالّة اسمها من التصميم؛ شكل المدخل والردّ ورموز الرفض اقتراحية** (التصميم يسمّي الأفعال ولا يسمّي حقولها) — يحاذيها وكيل الموقع (W-P6-18) إلى A11 في docs/PROTOCOL_CONTRACT.md لا إلى هذا الكود.
//
// ─── المدخل `{action, scanId | shortId, toScanId?, reason?}` ─────────────────────────────────────────────────────
//   action ∈ CORRECTION_ACTION؛ **الهدف** واحد من scanId (معرّف التقرير) أو shortId (رمز التقرير `NC-…`، يُحلّ بمساواة على `reports.shortId` بلا limit(1): أكثر من نتيجة ⟵ SHORT_ID_AMBIGUOUS)؛ «فالاستبعاد يقوم على رمز التقرير و`scanId`» (:867).
//   toScanId لـrelink وحده؛ reason لـexclude وحده (EXCLUSION_REASON). مفتاح مجهول أو لا ينطبق ⟵ رفض مسمّى. resolveIdentityConflict ⟵ CORRECTION_ACTION_NOT_SPECIFIED (لا مواصفة، ويتبع هويّة الجهاز S-P6-01: HMAC).
//
// ─── الكتابة (معاملة واحدة) ──────────────────────────────────────────────────────────────────────────────────────
//   تقرأ: scanProtocol/{scanId}، وreports/{scanId} (حين لا scanProtocol)، وسطور protocolCorrections لـscanId (مساواة على scanId وحدها بلا ترتيب ولا مدى ولا فهرس: القاعدة 43؛ والترتيب في الذاكرة بـseq)، وscanProtocol/{toScanId} (relink)،
//   **وscanProtocol للهدف الحاضر (ربط «بعد» الحالي) لـunlink وrelink (S6، 2026-10-22)** لاتّساق pair على «قبل».
//   ثم تكتب (القراءات كلّها قبل الكتابة): سطراً جديداً **بـ`tx.create`** (لا يُكتب فوق سطر: «بالإلحاق وحده») في protocolCorrections/{autoId}، وعلامة scanProtocol (`tx.update`: الحقول المعنيّة وحدها) إن وُجد scanProtocol.
//   **فحص أقدم من scanProtocol** (E16، معتمد 2026-10-15): السطر وحده، ولا يُنشأ scanProtocol شكلي؛ ويقبل exclude وunexclude فقط. **غير المتغيّر لا يُكتب** (changed:false).
//   **(ق36 أ، 2026-10-22، أقرّه حسن؛ A11):** وتقرأ للـrelink أيضاً reports/{scanId} وreports/{toScanId} (طرازَا الزوج) لإعادة حساب ملاحظة الطراز `linkModelCheck`؛ وunlink يُبطلها بـnull صريح في العلامة نفسها. قراءتان إضافيتان قبل أيّ كتابة ولا كتابة إضافية.
//   **(S6، 2026-10-22؛ docs/PROTOCOL_CONTRACT.md A11 إلحاق 2026-10-22):** unlink وrelink يُبقيان `pair` على «قبل» متّسقاً في المعاملة نفسها (MP.decidePairSync): unlink ⟵ «قبل» التي ربطها «بعد» الحيّ تُعاد OPEN؛ relink ⟵ القديمة كذلك والجديدة OPEN تصير COMPLETED؛
//   الجديدة COMPLETED بغير «بعد» هذا لا تُمسّ وتُعلَن (قواعد الأزواج في relink معلّقة: ق18). تحديث بحقلين منقَّطين لا حذف ولا كتابة فوق سطر. الردّ وسطر protocolCorrections لا يتغيّران (بتسعة حقول).
//   الردّ: `{scanId, action, changed, basis, exclusion: {state, reasonCode}|null, linkState: string|null, linkedScanId: string|null, correctionSeq: number|null}` — الحالة بعد الفعل؛ correctionSeq رقم السطر الملحَق (null بلا كتابة).
//
// ─── السجلّ ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   `[correctProtocolRecord] written action=<a> scan=<#> caller=<#> basis=<b> seq=<n>[ reason=<code>]` · `unchanged action=<a> scan=<#> caller=<#> basis=<b>` · `refused reason=<..> caller=<#>[ scan=<#>][ field=<..>][ extra]`
//   · (S6) `pair-sync <reopened|completed|skipped> role=<OLD|NEW> before=<#> scan=<#> caller=<#>[ reason=<..>]` لكل أثر فعليّ أو متخطّى (ما ليس «قبل» صيانة لا سطر له).
//   **لا scanId خامّ ولا رمز تقرير ولا uid** (المعرّفات عبر hashIdForLog: رمز التقرير مفتاح وصول علني). لا حذف في أيّ مسار (القاعدة 42).

const FN = "correctProtocolRecord";

/**
 * ردّ كل رفض: رمز HttpsError ونصّه (الرمز التقني: لا نصّ عربي جديد، القرار ٩٠) والرمز الذي يصل العميل في details.reasonCode.
 * @type {Object<string, {code: string, message: string, clientReasonCode: string}>}
 */
const REFUSAL_RESPONSE = Object.freeze(Object.fromEntries([
  ...[R.ACTION_REQUIRED, R.ACTION_INVALID, R.FIELD_UNKNOWN, R.FIELD_NOT_APPLICABLE, R.TARGET_REQUIRED, R.TARGET_AMBIGUOUS, R.SCAN_ID_INVALID, R.SHORT_ID_INVALID,
    R.REASON_REQUIRED, R.REASON_INVALID, R.TO_SCAN_ID_REQUIRED, R.TO_SCAN_ID_INVALID, R.RELINK_SELF].map((r) => [r, {code: "invalid-argument", message: r, clientReasonCode: r}]),
  ...[R.ACTION_NOT_SPECIFIED, R.SHORT_ID_AMBIGUOUS, R.NO_PROTOCOL_RECORD, R.NOT_LINKED, R.LINK_STATE_UNKNOWN, R.EXCLUSION_UNREADABLE].map((r) => [r, {code: "failed-precondition", message: r, clientReasonCode: r}]),
  ...[R.SCAN_NOT_FOUND, R.SHORT_ID_NOT_FOUND, R.RELINK_TARGET_NOT_FOUND].map((r) => [r, {code: "not-found", message: r, clientReasonCode: r}]),
].map(([k, v]) => [k, Object.freeze(v)])));

/**
 * يسجّل سطر الرفض ثم يرمي — **الموضع الوحيد لـ`throw new HttpsError` الخاصّ بهذا الملفّ** (requireAdmin من utils/admin.js له رفضاه القائمان).
 * @param {string} reason من CORRECTION_REFUSAL
 * @param {{uid?: ?string, scanId?: ?string, field?: ?string, extra?: string}} [ctx]
 */
function refuse(reason, {uid = null, scanId = null, field = null, extra = ""} = {}) {
  const spec = REFUSAL_RESPONSE[reason];
  if (!spec) throw new Error(`protocolCorrectionAdmin: سبب رفض غير مُدرَج: ${String(reason)}`);
  console.warn(`[${FN}] refused reason=${reason} caller=${hashIdForLog(uid)}` + (scanId ? ` scan=${hashIdForLog(scanId)}` : "") + (field ? ` field=${field}` : "") + extra);
  // تفكيك لا `spec.message`: حارس failureTextSites.test.js يعدّ كل `.message` موضعاً خامّاً محتملاً لنصّ خطأ، وهذا نصّ ثابت كتبناه نحن، لا نصّ مزوّد.
  const {code, message, clientReasonCode} = spec;
  throw new HttpsError(code, message, {reasonCode: clientReasonCode, ...(field ? {field} : {})});
}

const correctProtocolRecordHandler = async (request) => {
  requireAdmin(request);
  const uid = request.auth.uid;
  const input = validateCorrectionInput(request.data);
  if (!input.ok) refuse(input.refusal, {uid, field: input.field, extra: input.extra});

  // الهدف: scanId مباشرة، أو رمز التقرير يُحلّ بمساواة على reports.shortId (بلا limit(1): الغموض يُعلَن).
  let scanId = input.scanId;
  if (scanId === null) {
    const found = await db.collection("reports").where("shortId", "==", input.shortId).get();
    if (found.empty) refuse(R.SHORT_ID_NOT_FOUND, {uid, extra: ` shortId=${hashIdForLog(input.shortId)}`});
    if (found.size > 1) refuse(R.SHORT_ID_AMBIGUOUS, {uid, extra: ` shortId=${hashIdForLog(input.shortId)} matches=${found.size}`});
    scanId = found.docs[0].id;
  }

  const protocolRef = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(scanId);
  const reportRef = db.collection("reports").doc(scanId);
  const toRef = input.toScanId !== null ? db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(input.toScanId) : null;
  const toReportRef = input.toScanId !== null ? db.collection("reports").doc(input.toScanId) : null; // (ق36 أ) تقرير هدف relink: طرازه يدخل ملاحظة الطراز
  const linesQuery = db.collection(PROTOCOL_COLLECTION.PROTOCOL_CORRECTIONS).where(CORRECTION_LINE_FIELD.SCAN_ID, "==", scanId);
  const lineRef = db.collection(PROTOCOL_COLLECTION.PROTOCOL_CORRECTIONS).doc();
  const actor = hashIdForLog(uid);
  const FieldValue = admin.firestore.FieldValue;
  let decided;
  try {
    // معاملة واحدة: القراءات كلّها ثم الكتابة. تُرجِع قراراً لا ترمي.
    decided = await db.runTransaction(async (tx) => {
      const protocolSnap = await tx.get(protocolRef);
      const protocolData = protocolSnap.exists ? protocolSnap.data() : null;
      const isRelink = input.action === CORRECTION_ACTION.RELINK;
      // (ق36 أ) تقرير الفحص يُقرأ لـrelink أيضاً (طرازه): قراءة واحدة تخدم الحالتين (الوجود لفحص بلا scanProtocol، والطراز لـrelink)
      const reportSnap = (protocolData === null || isRelink) ? await tx.get(reportRef) : null;
      const reportExists = protocolData !== null ? true : reportSnap.exists;
      const linesSnap = await tx.get(linesQuery);
      const toSnap = toRef !== null ? await tx.get(toRef) : null;
      const toProtocolExists = toSnap !== null ? toSnap.exists : null;
      const toReportSnap = (isRelink && toReportRef !== null) ? await tx.get(toReportRef) : null;
      // (ق36 أ) ملاحظة الطراز لـrelink: بالدالّة نفسها التي في اكتمال «بعد» (مصدر واحد) من تقريرَي الفحص والهدف الجديد؛ وغياب أيٍّ منهما ⟵ LINK_MODEL_ABSENT صريحة (لا رمي). لغير relink لا يُحسب (unlink يُبطل بلا حساب).
      const linkModelCheck = isRelink ? MP.decideLinkModelCheck({
        afterReportData: reportSnap !== null && reportSnap.exists ? reportSnap.data() : undefined,
        beforeReportData: toReportSnap !== null && toReportSnap.exists ? toReportSnap.data() : undefined,
      }) : undefined;
      // (S6) الهدف الحاضر لربط «بعد» (للتحقّق من pair عليه): يُقرأ مع بقية القراءات قبل أيّ كتابة؛ والمقروء نفسه هو الهدف الجديد حين يتطابقان.
      const isLinkAction = input.action === CORRECTION_ACTION.UNLINK || isRelink;
      const oldTargetId = isLinkAction ? MP.currentLinkedId(protocolData) : null;
      let oldTargetSnap = null;
      if (oldTargetId !== null) oldTargetSnap = oldTargetId === input.toScanId ? toSnap : await tx.get(db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(oldTargetId));
      const decision = decideCorrection({
        input: {action: input.action, scanId, toScanId: input.toScanId, reason: input.reason},
        protocolData, reportExists, correctionLines: linesSnap.docs.map((d) => d.data()), toProtocolExists, linkModelCheck,
      });
      if (decision.outcome === OUTCOME.REFUSED) return decision;
      if (decision.outcome === OUTCOME.WRITE) {
        tx.create(lineRef, buildCorrectionLine({scanId, decision, action: input.action, at: FieldValue.serverTimestamp(), by: actor}));
        if (decision.markerFields !== null) {
          const fields = {...decision.markerFields};
          if (fields[SCAN_PROTOCOL_FIELD.EXCLUSION] !== undefined) fields[SCAN_PROTOCOL_FIELD.EXCLUSION] = {...fields[SCAN_PROTOCOL_FIELD.EXCLUSION], at: FieldValue.serverTimestamp()};
          tx.update(protocolRef, fields);
        }
        if (isLinkAction) {
          const sync = MP.decidePairSync({
            action: input.action, scanId, oldTargetId, oldTargetData: oldTargetSnap !== null && oldTargetSnap.exists ? oldTargetSnap.data() : null,
            newTargetId: input.toScanId, newTargetData: toSnap !== null && toSnap.exists ? toSnap.data() : null,
          });
          for (const u of sync.updates) tx.update(db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(u.scanId), u.fields);
          decision.pairSyncEntries = sync.entries;
        }
      }
      return decision;
    });
  } catch (e) {
    const className = (e && e.constructor && e.constructor.name) || typeof e;
    console.error(`[${FN}] unexpected failure caller=${hashIdForLog(uid)} [${className}] code=${(e && e.code !== undefined) ? e.code : "NO_CODE"}`);
    throw e;
  }
  if (decided.outcome === OUTCOME.REFUSED) refuse(decided.refusal, {uid, scanId, extra: decided.extra || ""});
  const changed = decided.outcome === OUTCOME.WRITE;
  if (changed) {
    console.log(`[${FN}] written action=${input.action} scan=${hashIdForLog(scanId)} caller=${hashIdForLog(uid)} basis=${decided.basis} seq=${decided.seq}` +
        (input.action === CORRECTION_ACTION.EXCLUDE ? ` reason=${input.reason}` : ""));
    // (ق36 أ) أثر ملاحظة الطراز: unlink يُبطلها (cleared) وrelink يعيد حسابها (حالتها)؛ ما سواهما لا سطر له. المعرّفات مُهشَّرة.
    if (input.action === CORRECTION_ACTION.UNLINK || input.action === CORRECTION_ACTION.RELINK) {
      const modelCheckState = input.action === CORRECTION_ACTION.UNLINK ? "cleared" : decided.after[SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK];
      console.log(`[${FN}] link-model-check ${modelCheckState} scan=${hashIdForLog(scanId)} caller=${hashIdForLog(uid)}`);
    }
    // (S6) أثر pair على «قبل»: سطر لكل أثر فعليّ (reopened/completed) أو متخطّى (skipped بسببه)؛ ما ليس «قبل» صيانة (NONE) بلا سطر.
    for (const e of decided.pairSyncEntries || []) {
      if (e.effect === MP.PAIR_SYNC_EFFECT.NONE) continue;
      console.log(`[${FN}] pair-sync ${e.effect.toLowerCase()} role=${e.role} before=${hashIdForLog(e.targetId)} scan=${hashIdForLog(scanId)} caller=${hashIdForLog(uid)}` + (e.reason ? ` reason=${e.reason}` : ""));
    }
  } else {
    console.log(`[${FN}] unchanged action=${input.action} scan=${hashIdForLog(scanId)} caller=${hashIdForLog(uid)} basis=${decided.basis}`);
  }
  return {
    scanId, action: input.action, changed, basis: decided.basis, exclusion: decided.after.exclusion,
    linkState: decided.after.linkState, linkedScanId: decided.after.linkedScanId, correctionSeq: changed ? decided.seq : null,
  };
};

exports.correctProtocolRecord = onCall({timeoutSeconds: 30, memory: "256MiB"}, correctProtocolRecordHandler);

// مُصدَّرة للاختبار الخالص (بلا Firestore/onCall) — القاعدة 41.
exports.REFUSAL_RESPONSE = REFUSAL_RESPONSE;
exports.refuse = refuse;
exports.correctProtocolRecordHandler = correctProtocolRecordHandler;
