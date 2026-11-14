// ===================================================
// reportRawStore — موضع الخامّ المنقول من مستند التقرير المقروء
// (V8 نقل الخامّ، الجزء ١-ج، 2026-10-09 +03)
// ===================================================
//
// قرار المستخدم (BATCH3-CLOSE البند ١ و2026-10-09، بنصّه، منقول من أمر
// المنسّق): «ينتقل الخامّ إلى مستند لا يقرؤه إلا الخادم (القواعد تمنع
// العميل)، ومستند التقرير المقروء لا يحمل إلا ما يعرضه.» وجواب الأسئلة
// الأحد عشر: «١: الخادم وحده يقرأ الخامّ. ٢: reportRaw/{scanId}، في كتابة
// ذرّية واحدة مع التقرير. ٤: يخرج من المستند المقروء الخامّ والمعرّفات
// الثلاثة وaiAudit. ٦: لا نسخ للمعرّفات في evaluations، والربط في جانب
// الخادم. ١١: الاسم reportRaw.» التصميم: docs/RAW_FINGERPRINT_PLACEMENT_DESIGN.md
// §٣ و§٦-١.
//
// ─── ما في reportRaw/{scanId} ───────────────────────────────────────────
// scanId · rawFingerprint (بعد lightenFingerprintForStorage: بلا samples) ·
// sessionId · deviceFingerprintSha · timeSeriesStoragePath · aiAudit ·
// source · createdAt. **بلا userId**: الخادم وحده يقرؤه (القاعدة لا تُنشأ
// للعميل أصلاً، فلا حاجة لنسخة المالك التي كانت لازمة لخيار (أ) وحده).
// المعرّف = معرّف مستند التقرير نفسه (علاقة 1:1) — فلا مؤشّر على المستند المقروء.
//
// ─── لا قاعدة عميل ───────────────────────────────────────────────────────
// لا `match` لـreportRaw في firestore.rules عمداً (سابقة aiRawResponses):
// Firestore يرفض افتراضياً، ولا يقرؤها إلا القاعدة الشاملة (المشرف المؤكَّد)
// والخادم (Admin SDK). يُثبَت باختبار المحاكي (rules-test/reports.rules.test.js).
//
// ─── القاعدة 22 — القراءة بحالة صريحة ────────────────────────────────────
// readReportRaw تُعيد {state, raw} لا قيمة افتراضية:
//   PRIVATE          مستند reportRaw موجود (الجديد، والمُرحَّل لاحقاً).
//   EMBEDDED_LEGACY  لا مستند خامّ، وفي مستند التقرير حقل من الحقول المنقولة
//                    (تقرير كُتب قبل هذا التغيير ولم يُرحَّل بعد). **نافذة
//                    الترحيل وحدها** — يُحذف هذا الفرع بعد أن يقول التحقّق 0.
//   ABSENT           لا هذا ولا ذاك: raw=null. لا يُقرأ غيابٌ نجاحاً.
// وحقل غائب داخل raw يبقى غائباً (لا null مختلَق).

'use strict';

const {lightenFingerprintForStorage} = require('./lightenFingerprintForStorage');
const {PROTOCOL_COLLECTION} = require('../protocol/protocolVocabulary');
const {SCAN_PROTOCOL_FIELD} = require('../protocol/protocolCorrection');
const {decidePairCompletion} = require('../protocol/maintenancePair');

const REPORT_RAW_COLLECTION = 'reportRaw';
const REPORTS_COLLECTION = 'reports'; // (ق36 أ) يُقرأ تقرير «قبل» (طرازه) داخل معاملة الاكتمال

// الحقول التي تنتقل من مستند التقرير المقروء إلى reportRaw — مصدر واحد
// مُصدَّر (القاعدة 24). `userId` ليس منها بقرار 2026-10-09.
const REPORT_RAW_FIELDS = Object.freeze([
  'rawFingerprint', 'sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'aiAudit',
]);

// عتبة الحجم (وثيقة التصميم §٣-٤): فوقها خطأ صريح لا اقتطاع (القاعدة 20) ولا
// فشل Firestore بنصّ عامّ. الحدّ الصلب 1 MiB = 1,048,576. أعلى قياس في العيّنات
// الذهبية 40,983 بايتاً (JSON مضغوط).
const REPORT_RAW_MAX_BYTES = 900000;

const RAW_STATE = Object.freeze({
  PRIVATE: 'PRIVATE',
  EMBEDDED_LEGACY: 'EMBEDDED_LEGACY',
  ABSENT: 'ABSENT',
});

const REPORT_RAW_SOURCE = Object.freeze({
  ANALYZE_DEVICE: 'analyzeDevice',
  MIGRATION: 'migration',
});

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * يبني مستند reportRaw/{scanId}. دالّة نقيّة (بلا I/O) — قابلة للاستدعاء من
 * مولّدات العيّنات الذهبية كما buildReportDocument (القاعدة 39).
 * @param {Object} p
 * @param {string} p.scanId معرّف الفحص (= معرّف مستند التقرير).
 * @param {Object} p.fingerprint البصمة الكاملة كما وصلت (تُخفَّف هنا).
 * @param {boolean} p.isSessionScan هل هو فحص جلسة محل.
 * @param {?string} p.sessionId معرّف الجلسة (يُكتب فقط إن كان فحص جلسة).
 * @param {?string} p.deviceFingerprintSha تجزئة الجهاز من ترويسة السلسلة.
 * @param {?string} p.timeSeriesStoragePath مسار السلسلة في Storage.
 * @param {?Object} p.aiResultAudit audit السلسلة V7 (أو غير موجود).
 * @param {*} p.createdAt وقت الكتابة: FieldValue.serverTimestamp() حيّاً، أو
 *   العلامة المسمّاة في العيّنات الذهبية — يُمرَّر صراحةً (لا افتراض).
 * @return {Object} مستند reportRaw كما يُكتَب حرفياً.
 */
function buildReportRawDocument(p) {
  if (!p || typeof p.scanId !== 'string' || p.scanId === '') {
    throw new Error('buildReportRawDocument: scanId غائب أو ليس نصّاً — لا مستند خامّ بلا معرّف');
  }
  if (!has(p, 'createdAt')) {
    throw new Error('buildReportRawDocument: createdAt غائب — يُمرَّر صراحةً (لا قيمة افتراضية)');
  }
  return {
    scanId: p.scanId,
    rawFingerprint: lightenFingerprintForStorage(p.fingerprint),
    sessionId: p.isSessionScan ? p.sessionId : null,
    deviceFingerprintSha: p.deviceFingerprintSha,
    timeSeriesStoragePath: p.timeSeriesStoragePath,
    aiAudit: p.aiResultAudit || null,
    source: REPORT_RAW_SOURCE.ANALYZE_DEVICE,
    createdAt: p.createdAt,
  };
}

/**
 * حجم مستند الخامّ بالبايت (JSON مضغوط UTF-8) — **تقدير** لا حجم Firestore
 * المحسوب (أسماء الحقول + القيم + العبء). يُستثنى createdAt (قد يكون
 * FieldValue لا يُسلسَل بثبات).
 * @param {Object} rawDocument
 * @return {number}
 */
function measureReportRawBytes(rawDocument) {
  return Buffer.byteLength(JSON.stringify({...rawDocument, createdAt: null}), 'utf8');
}

/**
 * يرمي خطأً صريحاً (code=REPORT_RAW_TOO_LARGE) إن تجاوز مستند الخامّ العتبة.
 * @param {Object} rawDocument
 * @return {number} الحجم المقيس إن مرّ.
 */
function assertReportRawFits(rawDocument) {
  const bytes = measureReportRawBytes(rawDocument);
  if (bytes > REPORT_RAW_MAX_BYTES) {
    const err = new Error(`reportRaw: ${bytes} بايتاً > العتبة ${REPORT_RAW_MAX_BYTES} — لا اقتطاع للخامّ (القاعدة 20)`);
    err.code = 'REPORT_RAW_TOO_LARGE';
    err.bytes = bytes;
    throw err;
  }
  return bytes;
}

/**
 * حارس بنيوي قبل الكتابة: مستند التقرير المقروء **لا يحمل** أيّاً من الحقول
 * المنقولة (القاعدة 25 — أيّ تعديل مستقبلي على buildReportDocument يعيدها
 * يُرفض هنا لا يمرّ صامتاً).
 * @param {Object} reportDocument
 */
function assertReadableDocumentHasNoRawFields(reportDocument) {
  const present = REPORT_RAW_FIELDS.filter((f) => has(reportDocument, f));
  if (present.length > 0) {
    throw new Error(`reportRawStore: مستند التقرير المقروء يحمل حقولاً منقولة إلى reportRaw: [${present.join(', ')}]`);
  }
}

/**
 * يكتب مستند التقرير ومستند الخامّ **في دفعة واحدة ذرّية** (الدفعة إمّا تُودَع
 * كلّها أو لا شيء). مشغّل onDocumentCreated على reports/{scanId} يُطلَق بعد
 * الإيداع فيجد الخامّ جاهزاً.
 * @param {Object} p
 * @param {Object} p.db Firestore (admin.firestore()).
 * @param {Object} p.reportRef مرجع reports/{scanId}.
 * @param {string} p.scanId
 * @param {Object} p.reportDocument المقروء (بلا حقول منقولة).
 * @param {Object} p.rawDocument الخامّ.
 * @param {Object} [p.protocolDocument] مستند scanProtocol/{scanId} (S-P6-03، 2026-10-18): **المستند الثالث في الدفعة الذرّية نفسها** — «فلا تقرير بلا سجلّ بروتوكوله ولا العكس» (PLAN-06:495،
 *   PROTOCOL_CONTRACT A0 البند ٧). غائب (undefined) = لا يُكتب ثالث (مُستدعو ما قبل P6-03 وسكربتاته)؛ **وحضوره بغير كائن (null أو نصّ…) خطأ صريح** (لا يُكتب شيء، القاعدة 22).
 * @param {{scanId: string, fields: Object}} [p.parentProtocolUpdate] تحديث سجلّ الأمّ في scanProtocol/{scanId الأمّ} في **الدفعة نفسها** (S-P6-07، 2026-10-21): حين يكون الفحص ابناً لتكرار، تنتقل `repeat.state` للأمّ إلى
 *   COMPLETED_* معه ذرّياً (لا تقرير للابن بلا أمّ محدَّثة ولا العكس). `fields` مسارات منقَّطة (update لا set: لا يُنشأ مستند أمّ ناقص). غائب (undefined) = لا تحديث. **على المستدعي أن يتأكّد أن مستند الأمّ موجود** (update على غائب يُفشل الدفعة كلّها).
 * @param {{beforeScanId: string, afterDefectType: ?string}} [p.pairLink] (S5، 2026-10-22) فحص «بعد» ذو ربط مؤكَّد في protocolPending: **تُنفَّذ الكتابة كلّها في معاملة واحدة** (بدل الدفعة) تعيد التحقّق من «قبل» ثم تكتب الثلاثة وتحدّث «قبل» (pair.state = COMPLETED
 *   · pair.completedByScanId) ذرّياً؛ وتُعيد {pair: {outcome, reason, modelCheck}} (LINKED أو TARGET_LOST بسببه؛ modelCheck حالة الطراز عند LINKED وحدها، وnull عند ضياع الهدف: ق36 أ). **ضياع الهدف لا يُسقط التقرير.** غائب (undefined) = الدفعة كما كانت. يستلزم protocolDocument، ولا يجتمع مع parentProtocolUpdate.
 * @return {Promise<void|{pair: {outcome: string, reason: ?string, modelCheck: ?string}}>} لا شيء إلا مع pairLink
 */
async function writeReportAndRaw({db, reportRef, scanId, reportDocument, rawDocument, protocolDocument, parentProtocolUpdate, pairLink}) {
  assertReadableDocumentHasNoRawFields(reportDocument);
  if (protocolDocument !== undefined && (protocolDocument === null || typeof protocolDocument !== 'object' || Array.isArray(protocolDocument))) {
    throw new Error('writeReportAndRaw: protocolDocument حاضر وليس كائناً — لا كتابة (غيابه وحده يعني «بلا ثالث»)');
  }
  if (pairLink !== undefined) {
    // (S5، 2026-10-22، A3 البند ٤) فحص «بعد» ذو ربط مختار: **الدفعة تصير معاملة واحدة** تعيد التحقّق من «قبل» ثم تكتب المستندات الثلاثة وتحدّث «قبل» ذرّياً.
    if (pairLink === null || typeof pairLink !== 'object' || typeof pairLink.beforeScanId !== 'string' || pairLink.beforeScanId === '' ||
        (pairLink.afterDefectType !== null && typeof pairLink.afterDefectType !== 'string')) {
      throw new Error('writeReportAndRaw: pairLink حاضر وشكله ليس {beforeScanId (نصّ غير فارغ), afterDefectType (نصّ أو null)} — لا كتابة');
    }
    if (protocolDocument === undefined) throw new Error('writeReportAndRaw: pairLink بلا protocolDocument — لا كتابة (الربط يُكتب على سجلّ «بعد»)');
    if (parentProtocolUpdate !== undefined) throw new Error('writeReportAndRaw: pairLink مع parentProtocolUpdate معاً — فحص «بعد» ليس ابن تكرار');
    return writeWithPairCompletion({db, reportRef, scanId, reportDocument, rawDocument, protocolDocument, pairLink});
  }
  const batch = db.batch();
  batch.set(reportRef, reportDocument);
  batch.set(db.collection(REPORT_RAW_COLLECTION).doc(scanId), rawDocument);
  if (protocolDocument !== undefined) batch.set(db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(scanId), protocolDocument);
  if (parentProtocolUpdate !== undefined) {
    const u = parentProtocolUpdate;
    if (u === null || typeof u !== 'object' || typeof u.scanId !== 'string' || u.scanId === '' || u.scanId === scanId || u.fields === null || typeof u.fields !== 'object' || Array.isArray(u.fields)) {
      throw new Error('writeReportAndRaw: parentProtocolUpdate حاضر وشكله ليس {scanId (غير scanId الفحص نفسه), fields} — لا كتابة');
    }
    batch.update(db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(u.scanId), u.fields);
  }
  await batch.commit();
}

/**
 * معاملة اكتمال «بعد» (S5): تقرأ «قبل» **وتقريرها (طرازها: ق36 أ)** والاستعلام عن الروابط الحيّة عليه **قبل أيّ كتابة**، ثم تقرّر (decidePairCompletion: الربط وملاحظة الطراز) وتكتب التقرير والخامّ وسجلّ «بعد» (معه الربط وملاحظة الطراز) وتحدّث «قبل» ذرّياً.
 * ضياع الهدف (ربطه فحصٌ آخر في الأثناء وما شابه) **لا يُسقط التقرير**: يُكتب «بعد» بـlinkState = missing ويُعاد السبب. السباق: المعاملتان تقرآن مستند «قبل» نفسه فتتسلسلان (يفوز الأوّل التزاماً).
 * @param {Object} p
 * @return {Promise<{pair: {outcome: string, reason: ?string, modelCheck: ?string}}>}
 */
async function writeWithPairCompletion({db, reportRef, scanId, reportDocument, rawDocument, protocolDocument, pairLink}) {
  const protocolRef = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(scanId);
  const beforeRef = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).doc(pairLink.beforeScanId);
  const beforeReportRef = db.collection(REPORTS_COLLECTION).doc(pairLink.beforeScanId);
  const linksQuery = db.collection(PROTOCOL_COLLECTION.SCAN_PROTOCOL).where(SCAN_PROTOCOL_FIELD.LINKED_SCAN_ID, '==', pairLink.beforeScanId);
  const decision = await db.runTransaction(async (tx) => {
    // (ق36 أ) تقرير «قبل» يُقرأ مع القراءتين الأخريين داخل المعاملة وقبل أيّ كتابة؛ وطراز «بعد» من مستند التقرير الذي يُكتب الآن
    const [beforeSnap, beforeReportSnap, linksSnap] = await Promise.all([tx.get(beforeRef), tx.get(beforeReportRef), tx.get(linksQuery)]);
    const d = decidePairCompletion({
      afterScanId: scanId, afterDefectType: pairLink.afterDefectType, beforeScanId: pairLink.beforeScanId,
      beforeData: beforeSnap.exists ? beforeSnap.data() : null,
      linkedDocs: linksSnap.docs.filter((x) => x.id !== scanId).map((x) => x.data()),
      beforeReportData: beforeReportSnap.exists ? beforeReportSnap.data() : undefined,
      afterReportData: reportDocument,
    });
    tx.set(reportRef, reportDocument);
    tx.set(db.collection(REPORT_RAW_COLLECTION).doc(scanId), rawDocument);
    tx.set(protocolRef, {...protocolDocument, ...d.afterFields});
    if (d.beforeUpdate !== null) tx.update(beforeRef, d.beforeUpdate);
    return d;
  });
  return {pair: {outcome: decision.outcome, reason: decision.reason, modelCheck: decision.modelCheck}};
}

const pickRawFields = (source) => {
  const out = {};
  for (const f of REPORT_RAW_FIELDS) {
    if (source && has(source, f)) out[f] = source[f];
  }
  return out;
};

/**
 * يقرأ الخامّ المنقول لتقرير، بحالة صريحة (انظر رأس الملفّ).
 * @param {Object} p
 * @param {Object} p.db Firestore.
 * @param {?Object} p.tx معاملة (اختياري) — القراءة داخلها بـtx.get.
 * @param {string} p.scanId
 * @param {?Object} p.reportData بيانات مستند التقرير (لفرع EMBEDDED_LEGACY).
 * @return {Promise<{state: string, raw: ?Object}>}
 */
async function readReportRaw({db, tx = null, scanId, reportData = null}) {
  if (typeof scanId !== 'string' || scanId === '') {
    throw new Error('readReportRaw: scanId غائب أو ليس نصّاً');
  }
  const ref = db.collection(REPORT_RAW_COLLECTION).doc(scanId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (snap.exists) {
    return {state: RAW_STATE.PRIVATE, raw: pickRawFields(snap.data() || {})};
  }
  if (reportData && REPORT_RAW_FIELDS.some((f) => has(reportData, f))) {
    return {state: RAW_STATE.EMBEDDED_LEGACY, raw: pickRawFields(reportData)};
  }
  return {state: RAW_STATE.ABSENT, raw: null};
}

module.exports = {
  writeWithPairCompletion,
  REPORT_RAW_COLLECTION,
  REPORT_RAW_FIELDS,
  REPORT_RAW_MAX_BYTES,
  REPORT_RAW_SOURCE,
  RAW_STATE,
  buildReportRawDocument,
  measureReportRawBytes,
  assertReportRawFits,
  assertReadableDocumentHasNoRawFields,
  writeReportAndRaw,
  readReportRaw,
};
