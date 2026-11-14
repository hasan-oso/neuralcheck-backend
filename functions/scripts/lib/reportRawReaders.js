'use strict';

// ===================================================================
// reportRawReaders — قراءة الخامّ لسكربتات functions/scripts بعد نقله من reports/{scanId} إلى reportRaw/{scanId}
// (V8 نقل الخامّ، الجزء ٢، 2026-10-09 +03). أمر المنسّق: «كل سكربت يقرأ الخامّ مضمَّناً يقرؤه بـreadReportRaw، بحالاته
// الصريحة: PRIVATE وEMBEDDED_LEGACY وABSENT. واختباراتها على الشكلين.»
//
// ثلاثة أشياء، وكلّها تمرّ بـreadReportRaw (src/analysis/reportRawStore.js — مصدر واحد للحالات، القاعدة 24):
//   ١. mergeRawIntoReport(reportData, rawRead): نسخة من المستند بالشكل المضمَّن (الذي كانت سكربتات التصدير تقرؤه)
//      لمن يحتاج الشكل المسطَّح. الخامّ الغائب يبقى غائباً (لا null مختلَق)؛ والحالة تُحمَل بجانبه لا تُخفى.
//   ٢. readReportWithRaw({db, scanId}): تقرير + خامّ بحالة صريحة، على db من Admin SDK (أو مغلَّف wrapReadOnly).
//   ٣. createRestReadDb / fetchReportWithRawRest: للسكربتات التي تقرأ بـREST + gcloud auth print-access-token
//      (لا Admin SDK): واجهة collection().doc().get() فوق REST، فيمرّ بها readReportRaw نفسها لا نسخة منها.
//
// القاعدة 36: رسالة خطأ REST لا تحمل جسم الردّ ولا المعرّف (رمز الحالة واسم المجموعة فقط).
// ===================================================================

const {readReportRaw, REPORT_RAW_COLLECTION} = require('../../src/analysis/reportRawStore');

const REPORTS_COLLECTION = 'reports';

/**
 * مستند التقرير بالشكل المضمَّن: المقروء + حقول الخامّ الحاضرة. لا يعدّل المُدخَل.
 * @param {Object} reportData مستند reports/{scanId}.
 * @param {{state: string, raw: ?Object}} rawRead ناتج readReportRaw — **مطلوب** (القاعدة 22: لا تُقرأ حالة الخامّ بصمت).
 * @return {Object}
 */
function mergeRawIntoReport(reportData, rawRead) {
  if (!rawRead || typeof rawRead.state !== 'string') {
    throw new Error('mergeRawIntoReport: rawRead (ناتج readReportRaw) مطلوب — لا قراءة غياب الخامّ بصمت');
  }
  return {...reportData, ...(rawRead.raw || {})};
}

/**
 * يقرأ التقرير والخامّ معاً.
 * @param {Object} p
 * @param {Object} p.db Firestore (Admin SDK، أو مغلَّف بـwrapReadOnly).
 * @param {string} p.scanId
 * @param {?Object} [p.reportData] إن قُرئ التقرير سابقاً (مثلاً من استعلام shortId) فلا يُقرأ ثانيةً.
 * @return {Promise<{exists: boolean, reportData: ?Object, rawRead: ?Object, merged: ?Object}>}
 */
async function readReportWithRaw({db, scanId, reportData = null}) {
  let data = reportData;
  if (data === null || data === undefined) {
    const snap = await db.collection(REPORTS_COLLECTION).doc(scanId).get();
    if (!snap.exists) return {exists: false, reportData: null, rawRead: null, merged: null};
    data = snap.data() || {};
  }
  const rawRead = await readReportRaw({db, scanId, reportData: data});
  return {exists: true, reportData: data, rawRead, merged: mergeRawIntoReport(data, rawRead)};
}

// ───────────────────────── REST ─────────────────────────

/**
 * يفكّ قيمة Firestore REST إلى JS عادي (نفس سلوك النسخ الثلاث القديمة في السكربتات للأنواع التي تستعملها، وتزيد
 * الأنواع الأخرى بدل إعادة الكائن الخام).
 * @param {Object} v
 * @return {*}
 */
function decodeRestValue(v) {
  const [t, val] = Object.entries(v)[0];
  switch (t) {
    case 'nullValue': return null;
    case 'integerValue':
    case 'doubleValue': return Number(val);
    case 'booleanValue': return val;
    case 'stringValue': return val;
    case 'arrayValue': return (val.values || []).map(decodeRestValue);
    case 'mapValue': {
      const o = {};
      for (const [k, x] of Object.entries(val.fields || {})) o[k] = decodeRestValue(x);
      return o;
    }
    default: return val; // timestampValue/bytesValue/referenceValue/geoPointValue: كما وصلت (نصّ/كائن)
  }
}

/**
 * db مصغَّر فوق REST: collection(c).doc(id).get() ⇒ {exists, id, data()}. 404 ⇒ exists=false (لا رمي).
 * @param {Object} p
 * @param {string} p.project
 * @param {function(): string} p.getToken رمز وصول (gcloud auth print-access-token).
 * @param {function} [p.fetchImpl] fetch (يُستبدَل في الاختبار بلا شبكة).
 */
function createRestReadDb({project, getToken, fetchImpl = fetch}) {
  return {
    collection: (collection) => ({
      doc: (id) => ({
        get: async () => {
          const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/` +
              `${collection}/${encodeURIComponent(id)}`;
          const res = await fetchImpl(url, {headers: {Authorization: `Bearer ${getToken()}`}});
          if (res.status === 404) return {exists: false, id, data: () => undefined};
          if (!res.ok) throw new Error(`FIRESTORE_REST_GET_FAILED: ${collection}/[id] status=${res.status}`);
          const doc = await res.json();
          const data = {};
          for (const [k, v] of Object.entries(doc.fields || {})) data[k] = decodeRestValue(v);
          return {exists: true, id, data: () => data};
        },
      }),
    }),
  };
}

/**
 * يقرأ تقريراً وخامّه بـREST. التقرير الغائب خطأ صريح (كما كانت السكربتات ترمي عند 404).
 * @return {Promise<{reportData: Object, rawRead: Object, merged: Object}>}
 */
async function fetchReportWithRawRest({project, getToken, fetchImpl = fetch, scanId}) {
  const db = createRestReadDb({project, getToken, fetchImpl});
  const out = await readReportWithRaw({db, scanId});
  if (!out.exists) throw new Error(`REPORT_NOT_FOUND: ${REPORTS_COLLECTION}/[id]`);
  return {reportData: out.reportData, rawRead: out.rawRead, merged: out.merged};
}

module.exports = {
  REPORTS_COLLECTION, REPORT_RAW_COLLECTION,
  mergeRawIntoReport, readReportWithRaw, decodeRestValue, createRestReadDb, fetchReportWithRawRest,
};
