'use strict';

// reportRawReaders.test.js — قراءة الخامّ لسكربتات functions/scripts بعد نقله إلى reportRaw (V8 نقل الخامّ، الجزء ٢،
// 2026-10-09 +03). scripts/lib/reportRawReaders.js: الدمج بحالاته الصريحة، وقراءة التقرير والخامّ معاً، وواجهة REST (للسكربتات
// التي تقرأ بـgcloud auth print-access-token لا Admin SDK) — على الشكلين (مضمَّن/reportRaw) وغياب الخامّ، وبلا شبكة
// (fetch مستبدَل بدالّة محلّية تُرجع ما تُرجعه خدمة Firestore REST: الاستبدال هنا للشبكة وحدها، وreadReportRaw الحقيقية خلفه).
// وفحص بنيوي للسكربتات الثلاثة التي تُشغَّل عند التحميل (لا تُستورَد فلا تُختبر وظيفياً): تقرأ بالمكتبة، لا بنسخها القديمة.
//
// Run: node functions/test/reportRawReaders.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const R = require('../scripts/lib/reportRawReaders');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');
const {RAW_STATE, REPORT_RAW_FIELDS, readReportRaw} = require('../src/analysis/reportRawStore');

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readable = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'v7-reports-document-sample.json'), 'utf8'));
const rawDoc = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'v7-report-raw-sample.json'), 'utf8'));
const legacy = loadLegacyEmbeddedV7Report();

const memDb = (reports, raws) => ({
  collection: (c) => ({doc: (id) => ({get: async () => {
    const m = c === 'reportRaw' ? raws : reports;
    return {exists: Object.prototype.hasOwnProperty.call(m, id), id, data: () => m[id]};
  }})}),
});

// JS → قيمة Firestore REST (ما تُرجعه الخدمة)
function toRest(v) {
  if (v === null) return {nullValue: null};
  if (typeof v === 'boolean') return {booleanValue: v};
  if (typeof v === 'number') return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (typeof v === 'string') return {stringValue: v};
  if (Array.isArray(v)) return {arrayValue: {values: v.map(toRest)}};
  return {mapValue: {fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toRest(x)]))}};
}
const restDoc = (data) => ({name: 'projects/p/databases/(default)/documents/x/y', fields: Object.fromEntries(Object.entries(data).map(([k, x]) => [k, toRest(x)]))});

// fetch مزيَّف يخدم reports/{id} وreportRaw/{id}؛ يسجّل الطلبات.
function fakeFetch({reports = {}, raws = {}, status = null} = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({url, headers: opts && opts.headers});
    if (status !== null) return {ok: false, status, json: async () => ({}), text: async () => 'SECRET-BODY-should-not-leak'};
    const m = /documents\/(reports|reportRaw)\/([^/?]+)$/.exec(url);
    const store = m && (m[1] === 'reports' ? reports : raws);
    const id = m && decodeURIComponent(m[2]);
    if (!store || !Object.prototype.hasOwnProperty.call(store, id)) return {ok: false, status: 404, json: async () => ({}), text: async () => ''};
    return {ok: true, status: 200, json: async () => restDoc(store[id]), text: async () => ''};
  };
  impl.calls = calls;
  return impl;
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — mergeRawIntoReport بالحالات الثلاث
  // ═══════════════════════════════════════════════════════════════════
  const rLegacy = await readReportRaw({db: memDb({s: legacy}, {}), scanId: 's', reportData: legacy});
  const rPrivate = await readReportRaw({db: memDb({s: readable}, {s: rawDoc}), scanId: 's', reportData: readable});
  const rAbsent = await readReportRaw({db: memDb({s: readable}, {}), scanId: 's', reportData: readable});
  const mLegacy = R.mergeRawIntoReport(legacy, rLegacy);
  const mPrivate = R.mergeRawIntoReport(readable, rPrivate);
  const mAbsent = R.mergeRawIntoReport(readable, rAbsent);
  deq(mPrivate, mLegacy, '[١] المدموج من الشكل الجديد = المدموج من القديم بالضبط (الدلالة لا الوصول وحده — القاعدة 30)');
  ok(REPORT_RAW_FIELDS.every((f) => f in mPrivate), '[١] الحقول الخمسة كلّها في المدموج من reportRaw');
  ok(REPORT_RAW_FIELDS.every((f) => !(f in mAbsent)), '[١] ABSENT: لا حقل خامّ يُختلَق (يبقى غائباً)');
  deq(Object.keys(mPrivate).sort(), [...new Set([...Object.keys(readable), ...REPORT_RAW_FIELDS])].sort(),
      '[١] مفاتيح المدموج = المقروء + الحقول الخمسة بالضبط (source/createdAt/scanId الإدارية في مستند الخامّ لا تتسرّب)');
  const before = JSON.stringify(readable);
  R.mergeRawIntoReport(readable, rPrivate);
  eq(JSON.stringify(readable), before, '[١] الدمج لا يعدّل المُدخَل');
  let threw = null;
  try { R.mergeRawIntoReport(readable, null); } catch (e) { threw = e; }
  ok(threw && /rawRead/.test(threw.message), '[١] بلا rawRead يُرفض (القاعدة 22)');
  console.log('تحقّق ١: الدمج على الشكلين وABSENT');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — readReportWithRaw
  // ═══════════════════════════════════════════════════════════════════
  let r = await R.readReportWithRaw({db: memDb({s: legacy}, {}), scanId: 's'});
  eq(r.rawRead.state, RAW_STATE.EMBEDDED_LEGACY, '[٢] لم يُرحَّل → EMBEDDED_LEGACY');
  deq(r.merged, mLegacy, '[٢] والمدموج كما سبق');
  r = await R.readReportWithRaw({db: memDb({s: readable}, {s: rawDoc}), scanId: 's'});
  eq(r.rawRead.state, RAW_STATE.PRIVATE, '[٢] مُرحَّل → PRIVATE');
  r = await R.readReportWithRaw({db: memDb({s: readable}, {}), scanId: 's'});
  eq(r.rawRead.state, RAW_STATE.ABSENT, '[٢] بلا خامّ → ABSENT');
  r = await R.readReportWithRaw({db: memDb({}, {}), scanId: 'nope'});
  eq(r.exists, false, '[٢] تقرير غير موجود: exists=false (لا رمي ولا خامّ مختلَق)');
  eq(r.rawRead, null, '[٢] ولا حالة خامّ');
  let reportReads = 0;
  const countingDb = {collection: (c) => ({doc: (id) => ({get: async () => {
    if (c === 'reports') reportReads++;
    return {exists: false, id, data: () => undefined};
  }})})};
  await R.readReportWithRaw({db: countingDb, scanId: 's', reportData: readable});
  eq(reportReads, 0, '[٢] إن مُرِّر reportData (من استعلام shortId مثلاً) فلا قراءة ثانية للتقرير');
  console.log('تحقّق ٢: readReportWithRaw');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — واجهة REST
  // ═══════════════════════════════════════════════════════════════════
  deq(R.decodeRestValue(toRest({a: 1, b: 1.5, c: 'س', d: null, e: true, f: [1, {g: 2}]})), {a: 1, b: 1.5, c: 'س', d: null, e: true, f: [1, {g: 2}]}, '[٣] فكّ كل الأنواع المستعملة');
  eq(R.decodeRestValue({timestampValue: '2026-10-09T00:00:00Z'}), '2026-10-09T00:00:00Z', '[٣] نوع آخر (timestamp) يصل كما هو لا مفقوداً');
  const goldenAsRest = R.decodeRestValue({mapValue: restDoc(rawDoc).fields ? {fields: restDoc(rawDoc).fields} : {}});
  deq(goldenAsRest, rawDoc, '[٣] مستند الخامّ الذهبي يذهب إلى REST ويعود بلا فقد');

  let f = fakeFetch({reports: {'id/with slash': {a: 1}}});
  const db = R.createRestReadDb({project: 'proj-x', getToken: () => 'TOKEN-1', fetchImpl: f});
  const snap = await db.collection('reports').doc('id/with slash').get();
  ok(snap.exists && snap.data().a === 1, '[٣] get() يُرجع exists وdata()');
  eq(f.calls[0].url, 'https://firestore.googleapis.com/v1/projects/proj-x/databases/(default)/documents/reports/id%2Fwith%20slash', '[٣] الرابط: المشروع والمجموعة والمعرّف مُرمَّزاً');
  eq(f.calls[0].headers.Authorization, 'Bearer TOKEN-1', '[٣] الرمز من getToken');
  const missing = await db.collection('reports').doc('nope').get();
  eq(missing.exists, false, '[٣] 404 → exists=false (لا رمي)');
  eq(missing.data(), undefined, '[٣] data() غير معرَّفة لا كائناً مختلَقاً');
  let err = null;
  try { await R.createRestReadDb({project: 'p', getToken: () => 't', fetchImpl: fakeFetch({status: 500})}).collection('reports').doc('secret-scan-id-123').get(); } catch (e) { err = e; }
  ok(err && /status=500/.test(err.message), '[٣] غير 404 وغير 2xx → خطأ بالحالة');
  ok(err && !/SECRET-BODY/.test(err.message) && !/secret-scan-id-123/.test(err.message), '[٣] لا جسم ردّ ولا معرّف في نصّ الخطأ (القاعدة 36)');
  console.log('تحقّق ٣: واجهة REST');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — fetchReportWithRawRest على الشكلين عبر REST (readReportRaw الحقيقية خلف الواجهة)
  // ═══════════════════════════════════════════════════════════════════
  const opts = (fetchImpl) => ({project: 'proj-x', getToken: () => 't', fetchImpl, scanId: 'sx'});
  const viaLegacy = await R.fetchReportWithRawRest(opts(fakeFetch({reports: {sx: legacy}})));
  const viaPrivate = await R.fetchReportWithRawRest(opts(fakeFetch({reports: {sx: readable}, raws: {sx: rawDoc}})));
  const viaAbsent = await R.fetchReportWithRawRest(opts(fakeFetch({reports: {sx: readable}})));
  eq(viaLegacy.rawRead.state, 'EMBEDDED_LEGACY', '[٤] REST: لم يُرحَّل → EMBEDDED_LEGACY');
  eq(viaPrivate.rawRead.state, 'PRIVATE', '[٤] REST: مُرحَّل → PRIVATE (قراءة reportRaw/{id})');
  eq(viaAbsent.rawRead.state, 'ABSENT', '[٤] REST: بلا خامّ → ABSENT');
  deq(viaPrivate.merged, viaLegacy.merged, '[٤][الأهمّ] المدموج عبر REST من الشكل الجديد = من القديم بالضبط (ما تقرؤه السكربتات)');
  ok(viaPrivate.merged.rawFingerprint.functionalResults.length === 85 && typeof viaPrivate.merged.timeSeriesStoragePath === 'string',
      '[٤] rawFingerprint.functionalResults (85) وtimeSeriesStoragePath يصلان من reportRaw');
  ok(viaAbsent.merged.rawFingerprint === undefined, '[٤] ABSENT: rawFingerprint غير معرَّف — لا كائن مختلَق');
  let nf = null;
  try { await R.fetchReportWithRawRest(opts(fakeFetch({}))); } catch (e) { nf = e; }
  ok(nf && /REPORT_NOT_FOUND/.test(nf.message) && !/sx/.test(nf.message), '[٤] تقرير غير موجود: خطأ صريح بلا المعرّف');
  const f2 = fakeFetch({reports: {sx: readable}, raws: {sx: rawDoc}});
  await R.fetchReportWithRawRest(opts(f2));
  ok(f2.calls.some((c) => /\/reportRaw\/sx$/.test(c.url)) && f2.calls.some((c) => /\/reports\/sx$/.test(c.url)), '[٤] قُرئ المستندان: reports/{id} وreportRaw/{id}');
  console.log('تحقّق ٤: fetchReportWithRawRest على الشكلين وABSENT');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — فحص بنيوي للسكربتات الثلاثة التي تُشغَّل عند التحميل (لا تُستورَد، فلا اختبار وظيفي لها)
  // ═══════════════════════════════════════════════════════════════════
  const scripts = (name) => fs.readFileSync(path.join(__dirname, '..', 'scripts', name), 'utf8');
  const fetchGolden = scripts('fetch-functional-results-golden.js');
  const variance = scripts('measure-deepseek-only-variance.js');
  const regenerate = scripts('regenerate-report.js');
  ok(/fetchReportWithRawRest\(/.test(fetchGolden), '[٥] fetch-functional-results-golden يقرأ بـfetchReportWithRawRest');
  ok(/fetchReportWithRawRest\(/.test(variance), '[٥] measure-deepseek-only-variance يقرأ بـfetchReportWithRawRest');
  ok(/readReportRaw\(/.test(regenerate) && /createRestReadDb\(/.test(regenerate), '[٥] regenerate-report يقرأ بـreadReportRaw فوق createRestReadDb');
  ok(!/function decodeFirestoreValue/.test(fetchGolden) && !/function decodeFirestoreValue/.test(variance),
      '[٥] لا نسخة محلّية ثانية من decodeFirestoreValue (مصدر واحد: decodeRestValue — القاعدة 24)');
  ok(!/cur\.rawFingerprint|cur\.timeSeriesStoragePath/.test(regenerate), '[٥] regenerate-report لا يقرأ الخامّ من cur (مستند التقرير) بل من raw');
  ok(/ABSENT/.test(fetchGolden) && /ABSENT/.test(variance) && /ABSENT/.test(regenerate), '[٥] كلّ منها يعالج ABSENT صراحةً (لا يقرؤه نجاحاً)');
  console.log('تحقّق ٥: السكربتات الثلاثة تقرأ بالمكتبة وتعالج ABSENT');

  console.log(`\nreportRawReaders.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
