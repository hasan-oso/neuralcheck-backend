'use strict';

// countQrSessionTimeseriesStorageReadonly.test.js — V8 نقل الخامّ، الجزء ٢ (2026-10-09 +03): السكربت يعدّ تقارير جلسات QR
// (sessionId != null) ثم يفحص كائن Storage عند timeSeriesStoragePath. الحقلان صارا في reportRaw/{scanId} للتقارير الجديدة
// والمُرحَّلة، ويبقيان مضمَّنَين في تقارير لم تُرحَّل بعد. هذا الاختبار على collectQrSessionReports (القراءة من Firestore فقط؛
// فحص Storage نفسه لم يتغيّر): الشكلان معاً، بلا ازدواج، ومصدر كل تقرير معلَن. بلا شبكة، بلا Firestore حقيقي.
//
// Run: node functions/test/countQrSessionTimeseriesStorageReadonly.test.js

const assert = require('assert');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const {collectQrSessionReports} = require('../scripts/count-qr-session-timeseries-storage-readonly');
const {wrapReadOnly} = require('../scripts/audit-device-profiles-readonly');

// db مزيَّف يفهم: collection(c).where(f,'!=',null).select(...).get() وcollection(c).doc(id).get() — ما تستعمله الدالّة.
function fakeDb(store) {
  const snapOf = (id, data) => ({id, exists: true, data: () => data, get: (f) => data[f]});
  return {
    collection: (c) => ({
      where(field, op, val) {
        assert.strictEqual(op, '!=', 'العملية المتوقَّعة !=');
        assert.strictEqual(val, null, 'القيمة المتوقَّعة null');
        const matches = Object.entries(store[c] || {}).filter(([, d]) => d[field] !== undefined && d[field] !== null);
        const q = {
          select: () => q,
          get: async () => ({docs: matches.map(([id, d]) => snapOf(id, d))}),
        };
        return q;
      },
      doc: (id) => ({
        get: async () => {
          const d = (store[c] || {})[id];
          return d === undefined ? {id, exists: false, data: () => undefined} : snapOf(id, d);
        },
      }),
    }),
  };
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — كل شكل على حدة ثم مختلطاً، بلا ازدواج
  // ═══════════════════════════════════════════════════════════════════
  const store = {
    reports: {
      // s1: تقرير مُرحَّل (المقروء بلا الحقلين)
      a1: {userId: 'u'},
      // s2: تقرير لم يُرحَّل: الحقلان مضمَّنان
      a2: {userId: 'u', sessionId: 'sess-2', timeSeriesStoragePath: 'p2'},
      // s3: نصف مُرحَّل: ما زال مضمَّناً وله reportRaw مطابق
      a3: {userId: 'u', sessionId: 'sess-3', timeSeriesStoragePath: 'p3'},
      // s4: مضمَّن بجلسة، ولكنّ مستند reportRaw موجود وبلا sessionId (فحص مباشر) ⇒ المرجع reportRaw: ليس جلسة
      a4: {userId: 'u', sessionId: 'sess-4', timeSeriesStoragePath: 'p4'},
      // فحص مباشر مضمَّن: sessionId null
      a5: {userId: 'u', sessionId: null, timeSeriesStoragePath: 'p5'},
    },
    reportRaw: {
      a1: {scanId: 'a1', sessionId: 'sess-1', timeSeriesStoragePath: 'p1'},
      a3: {scanId: 'a3', sessionId: 'sess-3', timeSeriesStoragePath: 'p3'},
      a4: {scanId: 'a4', sessionId: null, timeSeriesStoragePath: 'p4'},
      a6: {scanId: 'a6', sessionId: null, timeSeriesStoragePath: 'p6'},
    },
  };
  const res = await collectQrSessionReports({db: fakeDb(store)});
  eq(res.entries.length, 3, '[١] ثلاثة تقارير جلسة QR بلا ازدواج: a1 (PRIVATE) وa3 (PRIVATE) وa2 (مضمَّن)');
  deq(res.entries.map((e) => `${e.source}:${e.path}`).sort(), ['EMBEDDED_LEGACY:p2', 'PRIVATE:p1', 'PRIVATE:p3'], '[١] المصدر والمسار لكلّ منها');
  eq(res.embeddedShadowedByReportRaw, 2, '[١] a3 وa4 مضمَّنان لكنّ reportRaw هو المرجع فلا يُعدّان مرّتين (ولا a4 جلسة)');
  ok(!res.entries.some((e) => e.path === 'p4' || e.path === 'p5' || e.path === 'p6'), '[١] لا فحوص مباشرة (sessionId null) ولا a4');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الدلالة (القاعدة 30): النتيجة واحدة قبل الترحيل وبعده
  // ═══════════════════════════════════════════════════════════════════
  const ids = ['x1', 'x2', 'x3', 'x4'];
  const legacyStore = {reports: {}, reportRaw: {}};
  const migratedStore = {reports: {}, reportRaw: {}};
  ids.forEach((id, i) => {
    const sess = i % 2 === 0 ? `sess-${id}` : null; // x1 وx3 جلسات QR
    legacyStore.reports[id] = {userId: 'u', sessionId: sess, timeSeriesStoragePath: `path-${id}`};
    migratedStore.reports[id] = {userId: 'u'};
    migratedStore.reportRaw[id] = {scanId: id, sessionId: sess, timeSeriesStoragePath: `path-${id}`, source: 'migration'};
  });
  const before = await collectQrSessionReports({db: fakeDb(legacyStore)});
  const after = await collectQrSessionReports({db: fakeDb(migratedStore)});
  deq(before.entries.map((e) => e.path).sort(), after.entries.map((e) => e.path).sort(), '[٢] المسارات نفسها قبل الترحيل وبعده');
  eq(before.entries.length, 2, '[٢] جلستان في المشهد');
  ok(before.entries.every((e) => e.source === 'EMBEDDED_LEGACY'), '[٢] قبل الترحيل: كلّها EMBEDDED_LEGACY');
  ok(after.entries.every((e) => e.source === 'PRIVATE'), '[٢] بعده: كلّها PRIVATE');
  eq(after.embeddedShadowedByReportRaw, 0, '[٢] بعد الترحيل لا مضمَّن يُحجَب');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — مشهد فارغ، وحارس القراءة فقط يمرّ (الاستعلامات قراءة بحتة)
  // ═══════════════════════════════════════════════════════════════════
  const empty = await collectQrSessionReports({db: fakeDb({reports: {}, reportRaw: {}})});
  eq(empty.entries.length, 0, '[٣] لا جلسات: صفر');
  const guarded = await collectQrSessionReports({db: wrapReadOnly(fakeDb(store))});
  eq(guarded.entries.length, 3, '[٣] عبر wrapReadOnly: النتيجة نفسها (لا كتابة في أيّ مسار)');

  console.log(`\ncountQrSessionTimeseriesStorageReadonly.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
