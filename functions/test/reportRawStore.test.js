'use strict';

// reportRawStore.test.js — V8 نقل الخامّ، الجزء ١-ج (2026-10-09). وحدة بلا Firestore ولا شبكة:
// يثبّت عقد reportRaw/{scanId} وقارئه وكاتبه الذرّي. (المسار الكامل analyzeDevice ← الدفعة ← المشغّل
// على المحاكي في test/reportRawPlacement.e2e.test.js — القاعدة 37.)
//
// Run: node functions/test/reportRawStore.test.js

const assert = require('assert');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const rejects = async (fn, pred, m) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err && pred(err), `${m} — لم يُرمَ الخطأ المتوقَّع: ${err && err.message}`);
  n++;
};
const throws = (fn, pred, m) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err && pred(err), `${m} — لم يُرمَ الخطأ المتوقَّع: ${err && err.message}`);
  n++;
};

const store = require('../src/analysis/reportRawStore');
const {buildReportDocument} = require('../src/analysis/analyzeDevice');

const {
  REPORT_RAW_COLLECTION, REPORT_RAW_FIELDS, REPORT_RAW_MAX_BYTES, RAW_STATE,
  buildReportRawDocument, measureReportRawBytes, assertReportRawFits,
  assertReadableDocumentHasNoRawFields, writeReportAndRaw, readReportRaw,
} = store;

// ─── ثوابت العقد (قرارات المستخدم، 2026-10-09) ─────────────────────────────
eq(REPORT_RAW_COLLECTION, 'reportRaw', '[عقد] اسم المجموعة reportRaw (القرار ١١)');
deepEq([...REPORT_RAW_FIELDS], ['rawFingerprint', 'sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'aiAudit'],
    '[عقد] الحقول المنقولة: الخامّ والمعرّفات الثلاثة وaiAudit (القرار ٤)');
ok(!REPORT_RAW_FIELDS.includes('userId'), '[عقد] userId ليس منقولاً (يبقى في المستند المقروء، قرار 2026-10-09)');
ok(Object.isFrozen(REPORT_RAW_FIELDS), '[عقد] قائمة الحقول المنقولة مجمَّدة (مصدر واحد، القاعدة 24)');
ok(REPORT_RAW_MAX_BYTES < 1048576, '[عقد] العتبة تحت الحدّ الصلب 1 MiB');

// ─── buildReportRawDocument ─────────────────────────────────────────────────
const SAMPLES = [{ts: 1, v: [1, 2]}, {ts: 2, v: [3, 4]}];
const fingerprint = {
  device: {model: 'SM-X', androidVersion: '14', apiLevel: 34},
  timeSeries: {header: {deviceFingerprint: 'a'.repeat(64), androidApiLevel: 34}, footer: {fieldsVersion: 68}, samples: SAMPLES, variables: []},
  functionalResults: [{testId: 'C-05', status: 'pass'}],
};
const baseInputs = {
  scanId: 'scan-1', fingerprint, isSessionScan: false, sessionId: 'ignored-when-not-a-session',
  deviceFingerprintSha: 'a'.repeat(64), timeSeriesStoragePath: `scans/${'a'.repeat(64)}/scan-1.ts.json.gz`,
  aiResultAudit: {gatesApplied: [], measuredCategoriesMean: 70}, createdAt: 'CREATED_AT_SENTINEL',
};
const raw = buildReportRawDocument(baseInputs);
deepEq(Object.keys(raw), ['scanId', 'rawFingerprint', 'sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath', 'aiAudit', 'source', 'createdAt'],
    '[بنّاء] مفاتيح مستند الخامّ بالترتيب: بلا userId');
eq(raw.scanId, 'scan-1', '[بنّاء] scanId');
ok(!('samples' in raw.rawFingerprint.timeSeries) && raw.rawFingerprint.timeSeries.samplesCount === 2,
    '[بنّاء] rawFingerprint مخفَّف: بلا samples ومعه samplesCount (الحدّ الصلب 1 MiB، lightenFingerprintForStorage)');
deepEq(raw.rawFingerprint.functionalResults, fingerprint.functionalResults, '[بنّاء] functionalResults كما وصلت حرفياً (لا تحويل، القاعدة 20)');
eq(raw.sessionId, null, '[بنّاء] sessionId = null حين ليس فحص جلسة (حتى لو مُرِّر معرّف)');
eq(buildReportRawDocument({...baseInputs, isSessionScan: true, sessionId: 'sess-9'}).sessionId, 'sess-9', '[بنّاء] sessionId يُكتب لفحص الجلسة');
deepEq(raw.aiAudit, baseInputs.aiResultAudit, '[بنّاء] aiAudit كما أعادته السلسلة');
eq(buildReportRawDocument({...baseInputs, aiResultAudit: undefined}).aiAudit, null, '[بنّاء] aiAudit غائب ⇒ null (كما كان في المستند، لا undefined يكسر Admin SDK)');
eq(buildReportRawDocument({...baseInputs, deviceFingerprintSha: null, timeSeriesStoragePath: null}).deviceFingerprintSha, null,
    '[بنّاء] غياب البصمة يبقى null كما كُتب قديماً (القاعدة 22)');
eq(raw.source, 'analyzeDevice', '[بنّاء] source = analyzeDevice');
eq(raw.createdAt, 'CREATED_AT_SENTINEL', '[بنّاء] createdAt كما مُرِّر (serverTimestamp حيّاً، علامة في العيّنات)');
ok(SAMPLES.length === 2 && 'samples' in fingerprint.timeSeries, '[بنّاء] لا تعديل على البصمة المُمرَّرة (التخفيف نسخة)');
throws(() => buildReportRawDocument({...baseInputs, scanId: ''}), (e) => /scanId/.test(e.message), '[بنّاء] scanId غائب ⇒ خطأ صريح');
throws(() => { const p = {...baseInputs}; delete p.createdAt; buildReportRawDocument(p); }, (e) => /createdAt/.test(e.message),
    '[بنّاء] createdAt غائب ⇒ خطأ صريح (لا قيمة افتراضية، القاعدة 22)');

// ─── مستند التقرير المقروء لا يحمل الحقول المنقولة ─────────────────────────
const readable = buildReportDocument({
  userId: 'owner-1', rawDeviceModel: 'SM-X', deviceMarketingName: 'Galaxy X',
  deviceFingerprintSha: baseInputs.deviceFingerprintSha, timeSeriesStoragePath: baseInputs.timeSeriesStoragePath,
  fieldsVersion: 68, appVersion: '1.0.11', fingerprint, aiResponseToSave: {overall: {letter: 'B'}},
  aiResultAudit: baseInputs.aiResultAudit, aiModel: 'm', aiDurationMs: 5, aiFallbackReason: null,
  pipeline: 'v7_findings_based', aiResult: {}, language: 'ar', isSessionScan: true, sessionId: 'sess-9',
  shortId: 'NC-ABCDEF', isFreeTrial: false, v5Metrics: null, analyzedAtMs: 1,
  serverSamplesStoragePath: 'serverSamples/scan-1.json.gz', serverSamplesSaved: true,
});
for (const f of REPORT_RAW_FIELDS) ok(!(f in readable), `[مقروء] buildReportDocument لا يحمل "${f}" حتى حين يُمرَّر كل مُدخله`);
eq(readable.userId, 'owner-1', '[مقروء] userId يبقى');
for (const k of ['aiResponse', 'shortId', 'createdAt', 'deviceModel', 'deviceMarketingName', 'pipeline', 'language', 'isFreeTrial', 'fieldsVersion', 'appVersion']) {
  ok(k in readable, `[مقروء] "${k}" باقٍ في المستند المقروء`);
}
assertReadableDocumentHasNoRawFields(readable);
n++;
for (const f of REPORT_RAW_FIELDS) {
  throws(() => assertReadableDocumentHasNoRawFields({...readable, [f]: null}), (e) => e.message.includes(f),
      `[حارس] مستند مقروء يحمل "${f}" (ولو null) ⇒ خطأ يسمّيه`);
}

// ─── حارس الحجم ─────────────────────────────────────────────────────────────
const bytes = assertReportRawFits(raw);
ok(bytes > 0 && bytes === measureReportRawBytes(raw) && bytes < REPORT_RAW_MAX_BYTES, '[حجم] مستند عاديّ يمرّ ويُرجع حجمه');
const huge = {...raw, rawFingerprint: {blob: 'x'.repeat(REPORT_RAW_MAX_BYTES + 1)}};
throws(() => assertReportRawFits(huge), (e) => e.code === 'REPORT_RAW_TOO_LARGE' && e.bytes > REPORT_RAW_MAX_BYTES,
    '[حجم] فوق العتبة ⇒ خطأ صريح code=REPORT_RAW_TOO_LARGE (لا اقتطاع، القاعدة 20)');
eq(measureReportRawBytes({...raw, createdAt: {opaque: 'x'.repeat(10000)}}), measureReportRawBytes(raw),
    '[حجم] createdAt لا يدخل القياس (قد يكون FieldValue)');

// ─── كاتب ذرّي: دفعة واحدة، التزام واحد، لا كتابة قبله ─────────────────────
function fakeDb() {
  const log = [];
  const db = {
    log,
    collection: (c) => ({doc: (id) => ({path: `${c}/${id}`})}),
    batch: () => {
      const ops = [];
      log.push({type: 'batch'});
      return {
        set: (ref, data) => { ops.push({ref, data}); log.push({type: 'set', path: ref.path}); },
        commit: async () => { log.push({type: 'commit', ops: ops.map((o) => o.ref.path)}); },
      };
    },
  };
  return db;
}
(async () => {
  const db = fakeDb();
  const reportRef = {path: 'reports/scan-1'};
  await writeReportAndRaw({db, reportRef, scanId: 'scan-1', reportDocument: readable, rawDocument: raw});
  deepEq(db.log.map((l) => l.type), ['batch', 'set', 'set', 'commit'], '[كاتب] دفعة واحدة: setان ثم commit واحد');
  deepEq(db.log.filter((l) => l.type === 'set').map((l) => l.path), ['reports/scan-1', 'reportRaw/scan-1'], '[كاتب] المستندان: التقرير والخامّ بالمعرّف نفسه');
  deepEq(db.log[3].ops, ['reports/scan-1', 'reportRaw/scan-1'], '[كاتب] الالتزام يضمّ المستندين معاً (ذرّية)');

  const db2 = fakeDb();
  await rejects(() => writeReportAndRaw({db: db2, reportRef, scanId: 'scan-1', reportDocument: {...readable, rawFingerprint: {}}, rawDocument: raw}),
      (e) => /rawFingerprint/.test(e.message), '[كاتب] مستند مقروء يحمل حقلاً منقولاً ⇒ يُرفض');
  eq(db2.log.length, 0, '[كاتب] والرفض قبل إنشاء أيّ دفعة (لا كتابة جزئية)');

  // ─── S-P6-03 (2026-10-18): المستند الثالث scanProtocol/{scanId} في الدفعة الذرّية نفسها ───
  // «فلا تقرير بلا سجلّ بروتوكوله ولا العكس» (PLAN-06:495، docs/PROTOCOL_CONTRACT.md §٢ A0 البند ٧ وA2). غائب = لا ثالث (ما سبق أعلاه لم يتغيّر)؛ حاضر بغير كائن = خطأ صريح بلا أيّ دفعة.
  const capDb = () => {
    const ops = [];
    const log = [];
    return {ops, log, collection: (c) => ({doc: (id) => ({path: `${c}/${id}`})}), batch: () => {
      log.push('batch');
      return {set: (ref, data) => { ops.push({path: ref.path, data}); log.push('set'); }, commit: async () => { log.push('commit'); }};
    }};
  };
  const db3 = capDb();
  const protocolDocument = {scanPurpose: 'normal', purposeSource: 'default', marker: 'third'};
  await writeReportAndRaw({db: db3, reportRef, scanId: 'scan-1', reportDocument: readable, rawDocument: raw, protocolDocument});
  deepEq(db3.log, ['batch', 'set', 'set', 'set', 'commit'], '[ثالث] دفعة واحدة: ثلاث setات ثم commit واحد (ذرّية)');
  deepEq(db3.ops.map((o) => o.path), ['reports/scan-1', 'reportRaw/scan-1', 'scanProtocol/scan-1'], '[ثالث] المستندات الثلاثة بالمعرّف نفسه، والثالث في scanProtocol');
  eq(db3.ops[2].data, protocolDocument, '[ثالث] ويُكتب المستند الممرَّر بعينه (لا نسخة معدَّلة)');
  const db4 = capDb();
  await writeReportAndRaw({db: db4, reportRef, scanId: 'scan-1', reportDocument: readable, rawDocument: raw});
  deepEq(db4.ops.map((o) => o.path), ['reports/scan-1', 'reportRaw/scan-1'], '[ثالث] protocolDocument غائب: مستندان فقط (مُستدعو ما قبل P6-03 وسكربتاته لا يتغيّرون)');
  for (const bad of [null, 'x', 5, [], true]) {
    const dbBad = capDb();
    await rejects(() => writeReportAndRaw({db: dbBad, reportRef, scanId: 'scan-1', reportDocument: readable, rawDocument: raw, protocolDocument: bad}),
        (e) => /protocolDocument/.test(e.message), `[ثالث] protocolDocument = ${JSON.stringify(bad)} (حاضر وليس كائناً) ⇒ يُرفض (الغياب وحده يعني «بلا ثالث»)`);
    eq(dbBad.log.length, 0, `[ثالث] والرفض قبل أيّ دفعة (${JSON.stringify(bad)}): لا تقرير ولا خامّ ولا ثالث`);
  }
  const dbBadReport = capDb();
  await rejects(() => writeReportAndRaw({db: dbBadReport, reportRef, scanId: 'scan-1', reportDocument: {...readable, rawFingerprint: {}}, rawDocument: raw, protocolDocument}),
      (e) => /rawFingerprint/.test(e.message), '[ثالث] حارس المقروء يسبق: مستند مقروء يحمل حقلاً منقولاً ⇒ يُرفض ولو حضر الثالث');
  eq(dbBadReport.log.length, 0, '[ثالث] بلا دفعة');

  // ─── readReportRaw: حالات صريحة ───────────────────────────────────────────
  const rawStore = {};
  const readerDb = {
    collection: (c) => ({doc: (id) => ({path: `${c}/${id}`, get: async () => {
      const d = rawStore[`${c}/${id}`];
      return {exists: d !== undefined, data: () => d};
    }})}),
  };
  const absent = await readReportRaw({db: readerDb, scanId: 'x', reportData: {userId: 'o', aiResponse: {}}});
  deepEq(absent, {state: RAW_STATE.ABSENT, raw: null}, '[قارئ] لا مستند خامّ ولا حقل مضمَّن ⇒ ABSENT وraw=null (لا قيمة افتراضية)');
  const absentNoReport = await readReportRaw({db: readerDb, scanId: 'x'});
  eq(absentNoReport.state, RAW_STATE.ABSENT, '[قارئ] بلا بيانات تقرير أيضاً ⇒ ABSENT');

  const legacy = await readReportRaw({db: readerDb, scanId: 'x',
    reportData: {userId: 'o', rawFingerprint: {device: {model: 'M'}}, deviceFingerprintSha: 'abc'}});
  eq(legacy.state, RAW_STATE.EMBEDDED_LEGACY, '[قارئ] حقل منقول في التقرير ولا مستند خامّ ⇒ EMBEDDED_LEGACY (نافذة الترحيل)');
  deepEq(Object.keys(legacy.raw).sort(), ['deviceFingerprintSha', 'rawFingerprint'], '[قارئ] raw المضمَّن يحمل ما وُجد فقط — الغائب يبقى غائباً (لا null مختلَق)');
  ok(!('userId' in legacy.raw), '[قارئ] raw لا يحمل userId ولا غير الحقول المنقولة');
  const legacyNull = await readReportRaw({db: readerDb, scanId: 'x', reportData: {sessionId: null}});
  eq(legacyNull.state, RAW_STATE.EMBEDDED_LEGACY, '[قارئ] حقل منقول بقيمة null كُتبت صراحةً (sessionId) يكفي لـEMBEDDED_LEGACY');
  ok('sessionId' in legacyNull.raw && legacyNull.raw.sessionId === null, '[قارئ] والقيمة null تُنقَل كما كُتبت');

  rawStore['reportRaw/x'] = {scanId: 'x', rawFingerprint: {device: {model: 'P'}}, timeSeriesStoragePath: 'scans/p/x.gz', source: 'analyzeDevice'};
  const priv = await readReportRaw({db: readerDb, scanId: 'x', reportData: {rawFingerprint: {device: {model: 'EMBEDDED'}}}});
  eq(priv.state, RAW_STATE.PRIVATE, '[قارئ] مستند الخامّ موجود ⇒ PRIVATE (ويسبق المضمَّن عند النقل نصف المنجَز)');
  eq(priv.raw.rawFingerprint.device.model, 'P', '[قارئ] والقيمة من مستند الخامّ لا من المضمَّن');
  deepEq(Object.keys(priv.raw).sort(), ['rawFingerprint', 'timeSeriesStoragePath'], '[قارئ] PRIVATE: الحقول المنقولة الموجودة فقط (لا scanId ولا source، ولا حقل غائب مختلَق)');

  const txDb = {collection: readerDb.collection};
  let txGetCalls = 0;
  const tx = {get: async (ref) => { txGetCalls++; return {exists: ref.path === 'reportRaw/x', data: () => rawStore[ref.path]}; }};
  const viaTx = await readReportRaw({db: txDb, tx, scanId: 'x'});
  ok(viaTx.state === RAW_STATE.PRIVATE && txGetCalls === 1, '[قارئ] داخل معاملة: القراءة بـtx.get (مرّة واحدة)');

  await rejects(() => readReportRaw({db: readerDb, scanId: ''}), (e) => /scanId/.test(e.message), '[قارئ] scanId غائب ⇒ خطأ صريح');

  console.log(`\nreportRawStore.test.js: ${n}/${n} assertions passed`);
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

