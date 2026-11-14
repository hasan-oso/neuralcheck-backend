'use strict';

// auditDeviceProfilesReadonly.test.js — أمر مستخدم 2026-09-23 +03 (القرار 73،
// البند ٣): "أثبت ذلك باختبار بلا شبكة." يتحقّق أن wrapReadOnly (المُصدَّرة
// من scripts/audit-device-profiles-readonly.js) تمنع كل دالّة كتابة معروفة
// قبل أي تنفيذ، وتترك القراءة تعمل بلا تغيير — على db مُزيَّف بالكامل، لا
// Firestore حقيقي، لا شبكة.
//
// Run: node functions/test/auditDeviceProfilesReadonly.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {wrapReadOnly, hashId, DEFAULT_LAYER_VALUES, PROJECT_ID, readDeviceProfileKeyPrimary} = require('../scripts/audit-device-profiles-readonly');

// ─── db مُزيَّف بالكامل — لا Firestore، لا شبكة. يسجّل استدعاءات
// set/update/delete/add/batch/runTransaction إن نفذت فعلاً (يجب ألّا). ──
let realWriteCalls = 0;
function fakeDb() {
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => ({exists: true, id, data: () => ({foo: 'bar'})}),
        set: async () => { realWriteCalls++; },
        update: async () => { realWriteCalls++; },
        delete: async () => { realWriteCalls++; },
        create: async () => { realWriteCalls++; },
        collection: (sub) => fakeDb().collection(sub),
      }),
      add: async () => { realWriteCalls++; },
      get: async () => ({size: 2, docs: [
        {id: 'p1', data: () => ({layerA_keystore: 'no_keystore', scanHistory: []})},
        {id: 'p2', data: () => ({layerA_keystore: 'real-value', scanHistory: []})},
      ]}),
    }),
    doc: (path) => ({
      get: async () => ({exists: true, data: () => ({rawFingerprint: {device: {deviceProfileKey: {a: 'p1'}}}})}),
    }),
    batch: () => ({}),
    runTransaction: async () => {},
    bulkWriter: () => { realWriteCalls++; return {}; },
    recursiveDelete: async () => { realWriteCalls++; },
  };
}

(async () => {
  const ro = wrapReadOnly(fakeDb());

  // ═══════════════════════════════════════════════════════════════════
  // ١ — كل دالّة كتابة معروفة ترمي TRAP قبل أي تنفيذ حقيقي.
  // ═══════════════════════════════════════════════════════════════════
  realWriteCalls = 0;
  const writeAttempts = [
    ['doc.set', async () => ro.collection('deviceProfiles').doc('x').set({})],
    ['doc.update', async () => ro.collection('deviceProfiles').doc('x').update({})],
    ['doc.delete', async () => ro.collection('deviceProfiles').doc('x').delete()],
    ['collection.add', async () => ro.collection('deviceProfiles').add({})],
    ['db.batch', () => ro.batch()],
    ['db.runTransaction', () => ro.runTransaction(async () => {})],
    // الجزء ٢ من نقل الخامّ (2026-10-09): ثلاث دوالّ كتابة كانت تفلت من الحارس.
    ['doc.create', async () => ro.collection('deviceProfiles').doc('x').create({})],
    ['db.bulkWriter', () => ro.bulkWriter()],
    ['db.recursiveDelete', () => ro.recursiveDelete({})],
  ];
  for (const [label, attempt] of writeAttempts) {
    let threw = null;
    try {
      await attempt();
    } catch (e) {
      threw = e;
    }
    ok(threw && /TRAP: write operation/.test(threw.message), `[١] ${label} يرمي TRAP قبل أي تنفيذ — ${threw && threw.message}`);
  }
  eq(realWriteCalls, 0, '[١] صفر استدعاء كتابة حقيقي وصل db المُزيَّف — كلّها اعتُرضت قبل التنفيذ');
  console.log('تحقّق ١: كل دوالّ الكتابة التسع (set/update/delete/create/add/batch/runTransaction/bulkWriter/recursiveDelete) تُحجَب قبل أي تنفيذ');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — القراءة تعمل بلا تغيير عبر نفس الغلاف.
  // ═══════════════════════════════════════════════════════════════════
  const snap = await ro.collection('deviceProfiles').get();
  eq(snap.size, 2, '[٢] collection.get() يعمل عبر الغلاف — نفس النتيجة');
  const docSnap = await ro.collection('deviceProfiles').doc('p1').get();
  eq(docSnap.exists, true, '[٢] doc.get() يعمل عبر الغلاف');
  const reportSnap = await ro.doc('reports/x').get();
  ok(reportSnap.exists, '[٢] db.doc(path).get() (تقرير) يعمل عبر الغلاف');
  console.log('تحقّق ٢: كل مسارات القراءة تعمل بلا تغيير عبر الغلاف — لا حجب على get()');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — hashId/DEFAULT_LAYER_VALUES مُصدَّرتان وتعملان (لا بريد/اسم/مفتاح
  // خام في مخرَج السكربت — القاعدة 36).
  // ═══════════════════════════════════════════════════════════════════
  const h = hashId('some-real-profile-id-that-looks-like-a-hash');
  eq(typeof h, 'string', '[٣] hashId تُعيد سلسلة');
  eq(h.length, 12, '[٣] hashId مقصوصة إلى 12 حرفاً (SHA-256 مُختصَر، لا معرِّف خام)');
  ok(!h.includes('some-real-profile-id'), '[٣] الناتج لا يحمل المعرِّف الخام');
  assert.deepStrictEqual(Object.keys(DEFAULT_LAYER_VALUES).sort(),
      ['layerA_keystore', 'layerB_firebaseId', 'layerC_androidId', 'layerD_buildSig', 'layerE_sensorSig'].sort(),
      '[٣] DEFAULT_LAYER_VALUES تطابق createDeviceProfile.js حرفياً (خمس طبقات)');
  console.log('تحقّق ٣: hashId تُهشِّر لا تطبع خاماً، DEFAULT_LAYER_VALUES مطابقة');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — أمر مستخدم 2026-09-24 +03 (القرار ٧٦ البند ٦-هـ): projectId مثبَّت
  //     في الكود، لا مُستمَدّاً من بيئة الطرفية (GOOGLE_CLOUD_PROJECT/
  //     مشروع gcloud الافتراضي).
  // ═══════════════════════════════════════════════════════════════════
  eq(PROJECT_ID, 'neuralchek-9b6d7', '[٤] PROJECT_ID مثبَّت حرفياً — لا اعتماد على بيئة التشغيل');
  console.log('تحقّق ٤: PROJECT_ID مثبَّت في الكود = neuralchek-9b6d7');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — V8 نقل الخامّ (الجزء ٢): rawFingerprint.device.deviceProfileKey.a يُقرأ بـreadReportRaw على الشكلين
  //     (القاعدة 30: يُختبر ما يُنتجه القارئ من القيمة، لا وصولها وحدها).
  // ═══════════════════════════════════════════════════════════════════
  const rawDb = (reports, raws) => ({
    collection: (c) => ({doc: (id) => ({get: async () => {
      const m = c === 'reportRaw' ? raws : reports;
      return {exists: Object.prototype.hasOwnProperty.call(m, id), id, data: () => m[id]};
    }})}),
  });
  const fpWithKey = (a) => ({device: {deviceProfileKey: {a}}, timeSeries: {header: {}}});
  const embedded = {userId: 'u', sessionId: null, rawFingerprint: fpWithKey('p1')};
  const readableOnly = {userId: 'u'};
  let kr = await readDeviceProfileKeyPrimary({db: rawDb({r: embedded}, {}), scanId: 'r', reportData: embedded});
  eq(kr.keyInReport, 'p1', '[٥] تقرير لم يُرحَّل (EMBEDDED_LEGACY): المفتاح يُقرأ من المستند');
  eq(kr.rawState, 'EMBEDDED_LEGACY', '[٥] والحالة صريحة');
  kr = await readDeviceProfileKeyPrimary({db: rawDb({r: readableOnly}, {r: {scanId: 'r', rawFingerprint: fpWithKey('p1')}}), scanId: 'r', reportData: readableOnly});
  eq(kr.keyInReport, 'p1', '[٥] تقرير جديد/مُرحَّل (PRIVATE): المفتاح يُقرأ من reportRaw — الشكل الذي كانت القراءة القديمة تُخفق عليه');
  eq(kr.rawState, 'PRIVATE', '[٥] والحالة PRIVATE');
  kr = await readDeviceProfileKeyPrimary({db: rawDb({r: readableOnly}, {}), scanId: 'r', reportData: readableOnly});
  eq(kr.keyInReport, null, '[٥] لا خامّ إطلاقاً: المفتاح غير مقروء');
  eq(kr.rawState, 'ABSENT', '[٥] وسببه معلَن: ABSENT (لا يُخلط بـ«بصمة بلا device»)');
  kr = await readDeviceProfileKeyPrimary({db: rawDb({r: readableOnly}, {r: {scanId: 'r', rawFingerprint: {timeSeries: {}}}}), scanId: 'r', reportData: readableOnly});
  eq(kr.keyInReport, null, '[٥] خامّ موجود بلا device: غير مقروء');
  eq(kr.rawState, 'PRIVATE', '[٥] لكنّ الحالة PRIVATE — الفرق عن ABSENT ظاهر');
  kr = await readDeviceProfileKeyPrimary({db: rawDb({r: embedded}, {r: {scanId: 'r', rawFingerprint: fpWithKey('p2')}}), scanId: 'r', reportData: embedded});
  eq(kr.keyInReport, 'p2', '[٥] إن وُجد الاثنان فمستند reportRaw هو المرجع (كما في readReportRaw)');
  console.log('تحقّق ٥: مفتاح الملفّ يُقرأ بـreadReportRaw على الشكلين (EMBEDDED_LEGACY وPRIVATE) وABSENT معلَن');

  console.log(`\nauditDeviceProfilesReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
