#!/usr/bin/env node
'use strict';

// ===================================================================
// audit-device-profiles-readonly — قراءة فقط لـdeviceProfiles/reports/
// settings/cache. أمر مستخدم 2026-09-23 +03 (القرار 73، البند ٣). لا
// تُشغَّل من هذا الوكيل (القيد الصريح: "تكتبه ولا تشغّله") — المستخدم
// يشغّلها من طرفيّته بمفتاح حقيقي/بيانات اعتماد Admin SDK حقيقية.
// ===================================================================
//
// يعدّ:
//   - عدد مستندات deviceProfiles.
//   - لكل مرجع تقرير (scanHistory[].reportRef): هل التقرير موجود، وهل
//     rawFingerprint.device.deviceProfileKey.a يطابق معرِّف ملفّ deviceProfiles.
//     (V8 نقل الخامّ، الجزء ٢: rawFingerprint صار في reportRaw/{scanId} للتقارير
//     الجديدة والمُرحَّلة؛ يُقرأ بـreadReportRaw، وحالته الصريحة تُعدّ في
//     reportRefChecks.rawState: PRIVATE | EMBEDDED_LEGACY | ABSENT.)
//   - عدد الملفّات (مستندات deviceProfiles) التي تحمل قيماً افتراضية في
//     الطبقات (مثل layerA_keystore === "no_keystore"، إلخ — القيم
//     الاحتياطية المُسمّاة في createDeviceProfile.js).
//   - settings/cache.reuseEnabled — يُطبَع في أوّل سطر إن كانت true
//     (القيد الصريح: "إن كانت القيمة true: توقّف قبل النشر" — تحذير
//     للمستخدم يقرأ المخرَج، هذا السكربت لا ينشر شيئاً بنفسه).
//
// ─── لا كتابة أبداً (مُثبَت باختبار بلا شبكة، audit-device-profiles-
// readonly.test.js) — كل دالّة كتابة في db المُستعمَل هنا مكعوبة لترمي
// قبل أي قراءة، فلو استُدعيت خطأً (عطب برمجي مستقبلي) توقّف السكربت
// فوراً بخطأ صريح بدل كتابة صامتة. ──────────────────────────────────────
//
// القاعدة 36 — المخرَج JSON على stdout لا يحمل بريداً ولا اسماً ولا
// مفتاحاً: معرِّفات deviceProfiles/scanId تُهشَّر (SHA-256، 12 حرفاً
// أولى) لا تُطبَع خاماً؛ deviceModel/deviceMarketingName لا تُطبَعان.
//
// ─── projectId مثبَّت في الكود (أمر مستخدم 2026-09-24 +03، القرار ٧٦
// البند ٦-هـ) ─────────────────────────────────────────────────────────
// السبب: هذا السكربت (نسخة سابقة منه) شُغِّل فعلاً بـ`GOOGLE_CLOUD_PROJECT`
// مضبوطاً يدوياً في بيئة الطرفية، لأن مشروع gcloud الافتراضي لتلك الطرفية
// كان مشروعاً آخر تماماً (`isgozgu`) — `admin.initializeApp()` بلا
// `projectId` صريح يعتمد على استدلال Application Default Credentials
// (`GOOGLE_CLOUD_PROJECT` أو مشروع gcloud الافتراضي)، فلو نُسي الضبط
// اليدوي في تشغيلة قادمة، يتصل السكربت بمشروع خاطئ صامتاً — لا خطأ ظاهر،
// فقط بيانات من مشروع لا علاقة له بـneuralchek-9b6d7. التثبيت هنا في
// الكود (لا بيئة الطرفية) يزيل الاعتماد على ضبط خارجي يُنسى. يُطبَع
// `projectId` **أوّل حقل** في `summary` (نصّ الأمر) — كي يتحقّق قارئ
// المخرَج من مصدره أوّل ما يفتح الملفّ، بلا حاجة لقراءة بيئة التشغيل.
//
// ─── قاعدة جديدة (أمر مستخدم 2026-09-24 +03): "كل شرط توقّف من الآن
// يُكتب باسم الحقل الذي يُقرأ منه." ────────────────────────────────────
// شرط التوقّف الوحيد في هذا السكربت (لا شيء غيره يستدعي `console.error`
// تحذيرياً أو يُغيّر `process.exitCode`): **الحقل `settings/cache.reuseEnabled`**
// — إن كانت حالته `VALUE_PRESENT` وقيمته `true`، يُطبَع تحذير "توقّف قبل
// النشر" (نصّ الأمر الأصلي، القرار 73 البند ٣). راجع القسم "settings/cache.reuseEnabled"
// أدناه لتفصيل الحالات الأربع الممكنة لهذا الحقل بالذات (DOCUMENT_ABSENT/
// VALUE_INVALID/VALUE_PRESENT/READ_ERROR) — شرط التوقّف يفحص `VALUE_PRESENT`
// فقط، الحالات الثلاث الأخرى لا تُوقِف شيئاً (القاعدة 22: غياب/عطب القراءة
// لا يُقرأ "false آمنة" ولا "true خطرة" — يُعلَن صراحة ولا يُشغِّل شرط
// التوقّف بأي اتّجاه).
//
// Usage (يُشغِّله المستخدم من طرفيّته، بصلاحية Admin SDK حقيقية —
// GOOGLE_APPLICATION_CREDENTIALS أو بيئة gcloud مصادَق عليها بدور يقرأ
// Firestore على مشروع neuralchek-9b6d7 — قراءة فقط، لا حاجة لدور كتابة):
//   node functions/scripts/audit-device-profiles-readonly.js > evidence/device-profiles-audit-<تاريخ+03>.json
// ===================================================================

const crypto = require('crypto');
const {readReportRaw, RAW_STATE} = require('../src/analysis/reportRawStore');

// أمر مستخدم 2026-09-24 +03 (القرار ٧٦ البند ٦-هـ) — راجع رأس الملفّ.
const PROJECT_ID = 'neuralchek-9b6d7';

// تصحيح المنسّق 2026-10-01 +03 (بعد b4a08b4) — القاعدة 24: لا مصدر واحد
// مُصدَّر كان موجوداً لاسم الـbucket قبل هذا الالتزام — ثلاث نسخ حرفية
// قائمة مسبقاً، غير مُوحَّدة، **لا تُمسّ هنا** (خارج نطاق هذا التصحيح):
//   count-qr-session-timeseries-storage-readonly.js:81
//   measure-deepseek-only-variance.js:86 (باسم BUCKET)
//   regenerate-report.js:57 (باسم BUCKET)
// هذا الملفّ (audit-device-profiles-readonly.js) لا يحتاج Storage بنفسه
// (راجع تعليق initReadOnlyAdmin أدناه: "هذا السكربت لا يحتاج auth/storage")
// — الثابت هنا **تصديراً فقط**، ليستهلكه export-v7-replay-inputs-readonly.js
// (وحده في هذا الالتزام؛ توحيد الثلاث القائمة أعلاه مهمّة منفصلة لاحقة).
const STORAGE_BUCKET = 'neuralchek-9b6d7.firebasestorage.app';

/**
 * تطبيق Firebase Admin منفصل، مُسمّى، بـprojectId صريح — لا يلمس التطبيق
 * الافتراضي في src/utils/admin.js (ذلك المصدر مُستعمَل من الدوالّ الحيّة
 * في بيئة Cloud Functions حيث المشروع مضبوط أصلاً بسياق التشغيل؛ تعديله
 * هنا كان سيغيّر سلوك الإنتاج لهدف تشخيصي بحت). اسم مميَّز يمنع تصادم
 * "already initialized" مع أي تطبيق افتراضي آخر مُهيَّأ في نفس العملية.
 * @return {Object} {db} فقط — هذا السكربت لا يحتاج auth/storage.
 */
function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'audit-device-profiles-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

function hashId(id) {
  if (typeof id !== 'string' || !id) return null;
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 12);
}

const DEFAULT_LAYER_VALUES = {
  layerA_keystore: 'no_keystore',
  layerB_firebaseId: 'no_fid',
  layerC_androidId: 'no_android_id',
  layerD_buildSig: 'unknown',
  layerE_sensorSig: 'no_sensors',
};

/**
 * rawFingerprint.device.deviceProfileKey.a لتقرير، من حيث يقيم الخامّ الآن (reportRaw/{scanId} أو المضمَّن في تقرير لم يُرحَّل).
 * @param {{db: Object, scanId: string, reportData: Object}} p
 * @return {Promise<{keyInReport: ?string, rawState: string}>} keyInReport=null إن لم يكن مقروءاً (والسبب في rawState).
 */
async function readDeviceProfileKeyPrimary({db, scanId, reportData}) {
  const rawRead = await readReportRaw({db, scanId, reportData});
  const fp = rawRead.raw && rawRead.raw.rawFingerprint;
  const a = fp && fp.device && fp.device.deviceProfileKey && fp.device.deviceProfileKey.a;
  return {keyInReport: (typeof a === 'string' && a) ? a : null, rawState: rawRead.state};
}

async function main() {
  // ─── db حقيقي (Admin SDK)، projectId مثبَّت — لُفّ فقط لمنع أي كتابة،
  // لا لتغيير القراءة. راجع initReadOnlyAdmin أعلاه لسبب عدم استعمال
  // src/utils/admin.js المُشترَك هنا.
  const {db} = initReadOnlyAdmin();
  const readOnlyDb = wrapReadOnly(db);

  const summary = {
    projectId: PROJECT_ID, // أوّل حقل (نصّ الأمر) — راجع رأس الملفّ
    generatedAtPlus03: nowPlus03(),
    // أمر مستخدم 2026-09-24 +03 (القرار ٧٦ البند ٦-د، القاعدة 22): ثلاث
    // حالات مُعلَنة صراحة بدل سقوط الغياب/الفساد إلى false — راجع تعليق
    // "قاعدة جديدة" في رأس الملفّ لشرط التوقّف المبنيّ على هذا الحقل بالذات:
    //   DOCUMENT_ABSENT — settings/cache غير موجود إطلاقاً.
    //   VALUE_INVALID   — settings/cache موجود، لكن .reuseEnabled ليس boolean.
    //   VALUE_PRESENT   — settings/cache.reuseEnabled boolean فعلاً؛ القيمة في settingsCacheReuseEnabledValue.
    //   READ_ERROR      — فشل القراءة نفسها (صلاحية/شبكة) — حالة رابعة
    //                     كانت موجودة أصلاً في النسخة السابقة (catch)، لم
    //                     تُطلَب صراحة في نصّ الأمر (الذي عدَّد ثلاثاً) لكنها
    //                     حالة حقيقية منفصلة قائمة في الكود من قبل — أُبقيت
    //                     مُعلَنة لا مطويّة داخل واحدة من الثلاث الأخرى.
    settingsCacheReuseEnabledState: null,
    settingsCacheReuseEnabledValue: null, // boolean فقط حين الحالة VALUE_PRESENT، وإلا null دائماً
    deviceProfilesCount: 0,
    // rawState: حالة الخامّ لكل تقرير موجود (V8 نقل الخامّ، الجزء ٢): PRIVATE (reportRaw/{scanId}) | EMBEDDED_LEGACY
    // (تقرير لم يُرحَّل بعد) | ABSENT (لا هذا ولا ذاك — فـkeyUnreadable لتلك الحالات سببه الغياب لا شكل البصمة).
    reportRefChecks: {total: 0, reportExists: 0, reportMissing: 0, keyMatches: 0, keyMismatches: 0, keyUnreadable: 0,
      rawState: Object.fromEntries(Object.values(RAW_STATE).map((s) => [s, 0]))},
    defaultLayerValueCounts: Object.fromEntries(Object.keys(DEFAULT_LAYER_VALUES).map((k) => [k, 0])),
    profiles: [], // {profileIdHash, scanHistoryLength, defaultLayers: [...]}
  };

  // settings/cache.reuseEnabled — يُطبَع أولاً (بعد بنائه) في الخلاصة.
  try {
    const cacheDoc = await readOnlyDb.collection('settings').doc('cache').get();
    if (!cacheDoc.exists) {
      summary.settingsCacheReuseEnabledState = 'DOCUMENT_ABSENT';
    } else {
      const raw = cacheDoc.data().reuseEnabled;
      if (typeof raw === 'boolean') {
        summary.settingsCacheReuseEnabledState = 'VALUE_PRESENT';
        summary.settingsCacheReuseEnabledValue = raw;
      } else {
        summary.settingsCacheReuseEnabledState = 'VALUE_INVALID';
        summary.settingsCacheReuseEnabledInvalidType = typeof raw; // تشخيصي — ما نوع القيمة الفاسدة فعلاً
      }
    }
  } catch (e) {
    summary.settingsCacheReuseEnabledState = 'READ_ERROR';
    summary.settingsCacheReadError = String((e && e.message) || e);
  }

  const profilesSnap = await readOnlyDb.collection('deviceProfiles').get();
  summary.deviceProfilesCount = profilesSnap.size;

  for (const doc of profilesSnap.docs) {
    const data = doc.data() || {};
    const profileIdHash = hashId(doc.id);
    const defaultLayers = [];
    for (const [layerKey, defaultVal] of Object.entries(DEFAULT_LAYER_VALUES)) {
      if (data[layerKey] === defaultVal) {
        defaultLayers.push(layerKey);
        summary.defaultLayerValueCounts[layerKey]++;
      }
    }
    const scanHistory = Array.isArray(data.scanHistory) ? data.scanHistory : [];
    const refChecks = [];
    for (const entry of scanHistory) {
      summary.reportRefChecks.total++;
      const reportRef = entry && entry.reportRef;
      if (typeof reportRef !== 'string' || !reportRef) {
        summary.reportRefChecks.reportMissing++;
        refChecks.push({reportRefPresent: false});
        continue;
      }
      try {
        const reportDoc = await readOnlyDb.doc(reportRef).get();
        if (!reportDoc.exists) {
          summary.reportRefChecks.reportMissing++;
          refChecks.push({reportRefPresent: true, reportExists: false});
          continue;
        }
        summary.reportRefChecks.reportExists++;
        const reportData = reportDoc.data() || {};
        // الخامّ لم يعد في مستند التقرير بعد الترحيل: يُقرأ بـreadReportRaw بحالته الصريحة (القاعدة 22).
        const {keyInReport, rawState} = await readDeviceProfileKeyPrimary({db: readOnlyDb, scanId: reportDoc.id, reportData});
        summary.reportRefChecks.rawState[rawState]++;
        if (typeof keyInReport !== 'string' || !keyInReport) {
          summary.reportRefChecks.keyUnreadable++;
          refChecks.push({reportRefPresent: true, reportExists: true, keyReadable: false, rawState});
        } else if (keyInReport === doc.id) {
          summary.reportRefChecks.keyMatches++;
          refChecks.push({reportRefPresent: true, reportExists: true, keyReadable: true, keyMatches: true, rawState});
        } else {
          summary.reportRefChecks.keyMismatches++;
          refChecks.push({reportRefPresent: true, reportExists: true, keyReadable: true, keyMatches: false, rawState});
        }
      } catch (e) {
        summary.reportRefChecks.keyUnreadable++;
        refChecks.push({reportRefPresent: true, error: String((e && e.message) || e)});
      }
    }
    summary.profiles.push({
      profileIdHash,
      scanHistoryLength: scanHistory.length,
      defaultLayers,
      reportRefChecks: refChecks,
    });
  }

  // شرط التوقّف الوحيد في هذا السكربت — الحقل settings/cache.reuseEnabled
  // (راجع "قاعدة جديدة" في رأس الملفّ). يفحص الحالة VALUE_PRESENT تحديداً؛
  // DOCUMENT_ABSENT/VALUE_INVALID/READ_ERROR لا تُوقِف شيئاً (لا تُقرأ true
  // ولا false قياساً — القاعدة 22).
  if (summary.settingsCacheReuseEnabledState === 'VALUE_PRESENT' && summary.settingsCacheReuseEnabledValue === true) {
    console.error('⚠️ الحقل settings/cache.reuseEnabled=true — توقّف قبل النشر (نصّ الأمر). راجع الخلاصة أعلى JSON المطبوع أدناه.');
  }
  console.log(JSON.stringify(summary, null, 2));
}

// ─── حارس عدم الكتابة — كل دالّة كتابة معروفة في Admin SDK Firestore
// ترمي قبل أي تنفيذ. لا تُلمَس set/update/delete/create/add/batch/
// runTransaction/bulkWriter/recursiveDelete على أي مستوى (collection وdoc
// وWriteBatch). (أُضيفت create وbulkWriter وrecursiveDelete في الجزء ٢ من
// نقل الخامّ، 2026-10-09: كانت تفلت من القائمة السابقة — وأوّل مستهلك
// يعتمد على الحارس لإثبات أن --dry-run لا يكتب: migrate-report-raw.js.)
// ──────────────────────────────────────────────────────────────────────
function wrapReadOnly(db) {
  function throwOnWrite(name) {
    return () => { throw new Error(`TRAP: write operation "${name}" is forbidden in this read-only audit script`); };
  }
  function wrapDocRef(docRef) {
    return new Proxy(docRef, {
      get(target, prop) {
        if (['set', 'update', 'delete', 'create'].includes(prop)) return throwOnWrite(`doc.${String(prop)}`);
        if (prop === 'collection') return (...args) => wrapCollectionRef(target.collection(...args));
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }
  function wrapCollectionRef(colRef) {
    return new Proxy(colRef, {
      get(target, prop) {
        if (['add'].includes(prop)) return throwOnWrite(`collection.${String(prop)}`);
        if (prop === 'doc') return (...args) => wrapDocRef(target.doc(...args));
        const val = target[prop];
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }
  return new Proxy(db, {
    get(target, prop) {
      if (['batch', 'runTransaction', 'bulkWriter', 'recursiveDelete'].includes(prop)) return throwOnWrite(`db.${String(prop)}`);
      if (prop === 'collection') return (...args) => wrapCollectionRef(target.collection(...args));
      if (prop === 'doc') return (...args) => wrapDocRef(target.doc(...args));
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function nowPlus03() {
  const plus3 = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return plus3.toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

module.exports = {wrapReadOnly, hashId, DEFAULT_LAYER_VALUES, PROJECT_ID, STORAGE_BUCKET, readDeviceProfileKeyPrimary};

if (require.main === module) {
  main().catch((e) => {
    console.error('✗ توقّف بخطأ:', e && e.stack || e);
    process.exit(1);
  });
}
