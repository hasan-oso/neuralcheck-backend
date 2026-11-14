'use strict';

// reportRawMigration.test.js — منطق ترحيل الخامّ (V8 نقل الخامّ، الجزء ٢، 2026-10-09 +03). وحدة بلا شبكة ولا محاكي:
// الترميز القابل للعكس، والتصنيف، والخطّة، وسطر الأوامر، ومسار النسخة، ونصّ الأخطاء. الإنفاذ على Firestore حقيقي
// (المحاكي) في migrateReportRaw.e2e.test.js.
//
// Run: node functions/test/reportRawMigration.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Timestamp, GeoPoint} = require('@google-cloud/firestore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const throwsWith = (fn, re, m) => {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  ok(err && re.test(err.message), `${m} — ${err && err.message}`);
};

const M = require('../scripts/lib/reportRawMigration');
const {REPORT_RAW_FIELDS, REPORT_RAW_SOURCE, RAW_STATE, readReportRaw} = require('../src/analysis/reportRawStore');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));

// db مزيَّف في الذاكرة — يكفي readReportRaw (collection().doc().get()).
function memDb({reports = {}, raws = {}} = {}) {
  return {
    collection: (c) => ({
      doc: (id) => ({
        get: async () => {
          const m = c === 'reportRaw' ? raws : reports;
          return {exists: Object.prototype.hasOwnProperty.call(m, id), id, data: () => m[id]};
        },
      }),
    }),
  };
}
const rawReadOf = (reportData, rawDoc) => readReportRaw({
  db: memDb({reports: {r1: reportData}, raws: rawDoc ? {r1: rawDoc} : {}}), scanId: 'r1', reportData,
});

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // ١ — ثوابت ومصدر واحد (القاعدة 24)
  // ═══════════════════════════════════════════════════════════════════
  deq([...M.EVALUATION_IDENTIFIER_FIELDS].sort(), ['deviceFingerprintSha', 'sessionId', 'timeSeriesStoragePath'], '[١] المعرّفات الثلاثة');
  ok(M.EVALUATION_IDENTIFIER_FIELDS.every((f) => REPORT_RAW_FIELDS.includes(f)), '[١] الثلاثة ⊂ REPORT_RAW_FIELDS (مصدر واحد)');
  eq(REPORT_RAW_FIELDS.length, 5, '[١] الحقول المنقولة خمسة (قرار المستخدم ٤: + aiAudit) لا أربعة كما في §٧-٢');
  deq([...M.EXPOSED_LISTING_STATUSES], ['for_sale', 'sold'], '[١] المعروض والمُباع (docs/FIRESTORE_INDEXES.md:52)');
  eq(PROJECT_ID, 'neuralchek-9b6d7', '[١] projectId مثبَّت في الكود');
  ok(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'FIRESTORE_INDEXES.md'), 'utf8').includes("['for_sale', 'sold']"),
      '[١] القيمتان مطابقتان لما تذكره docs/FIRESTORE_INDEXES.md حرفياً');
  console.log('تحقّق ١: الثوابت ومصدرها الواحد');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — الترميز قابل للعكس بلا فقد (القاعدة 20: التحويل القابل للعكس لا ضرر فيه)
  // ═══════════════════════════════════════════════════════════════════
  const ctx = {Timestamp, GeoPoint, doc: (p) => ({path: p, collection() {}})};
  const sample = {
    s: 'نصّ عربي ✓', t: true, f: false, nul: null, i: 7, d: 0.1 + 0.2, big: 2 ** 53,
    nan: NaN, inf: Infinity, ninf: -Infinity, nz: -0,
    ts: new Timestamp(1700000000, 123456789), geo: new GeoPoint(12.5, -45.25), bytes: Buffer.from([0, 1, 2, 254, 255]),
    arr: [1, 'a', null, [2, 3], {k: NaN}], map: {a: {b: {c: [true]}}},
    tagCollision: {$t: 'ts', s: 1, n: 2},
    empty: {}, emptyArr: [],
  };
  const roundTripped = M.decodeValue(JSON.parse(JSON.stringify(M.encodeValue(sample))), ctx);
  ok(M.valuesEqual(sample, roundTripped), '[٢] الذهاب والإياب عبر JSON يُعيد القيمة نفسها بأنواعها (Timestamp/GeoPoint/Bytes/NaN/Infinity/-0)');
  ok(Object.is(roundTripped.nz, -0), '[٢] -0 يبقى -0 (JSON وحده كان يُسقطه إلى 0)');
  ok(Number.isNaN(roundTripped.nan) && roundTripped.inf === Infinity && roundTripped.ninf === -Infinity, '[٢] NaN وInfinity يبقيان (JSON وحده كان يجعلها null)');
  ok(roundTripped.ts instanceof Timestamp && roundTripped.ts.seconds === 1700000000 && roundTripped.ts.nanoseconds === 123456789, '[٢] Timestamp نوعاً ونانوثانية');
  ok(roundTripped.geo instanceof GeoPoint && roundTripped.geo.latitude === 12.5, '[٢] GeoPoint');
  ok(Buffer.isBuffer(roundTripped.bytes) && roundTripped.bytes.equals(sample.bytes), '[٢] Bytes');
  deq(roundTripped.tagCollision, {$t: 'ts', s: 1, n: 2}, '[٢] خريطة مفتاحها $t تُهرَّب ولا تُفسَّر وسماً (تصادم)');
  ok(!(roundTripped.tagCollision instanceof Timestamp), '[٢] ولا تصير Timestamp');
  // مقارنة بنيوية دقيقة
  ok(M.valuesEqual({a: 1, b: [1, 2]}, {b: [1, 2], a: 1}), '[٢] ترتيب المفاتيح لا يهمّ');
  ok(!M.valuesEqual(new Timestamp(1, 0), '1970-01-01T00:00:01.000Z'), '[٢] Timestamp ≠ نصّ يشبهه');
  ok(!M.valuesEqual(0, -0), '[٢] 0 ≠ -0');
  ok(M.valuesEqual(NaN, NaN), '[٢] NaN = NaN');
  ok(!M.valuesEqual({a: 1}, {a: 1, b: null}), '[٢] مفتاح null إضافي ≠ غياب المفتاح (القاعدة 22)');
  ok(!M.valuesEqual([1, 2], [2, 1]), '[٢] ترتيب المصفوفة يهمّ');
  throwsWith(() => M.encodeValue(undefined), /undefined/, '[٢] undefined لا يُرمَّز بصمت');
  throwsWith(() => M.encodeValue(new Map()), /غير مدعوم/, '[٢] صنف مجهول يُرفض صراحة');
  throwsWith(() => M.decodeValue({$t: 'zzz'}, ctx), /وسم مجهول/, '[٢] وسم مجهول يُرفض');
  // الجولة الأخيرة: بصمة حقيقية من العيّنة الذهبية
  const goldenRaw = readJson('v7-report-raw-sample.json');
  ok(M.valuesEqual(goldenRaw, M.decodeValue(JSON.parse(JSON.stringify(M.encodeValue(goldenRaw))), ctx)), '[٢] مستند الخامّ الذهبي الحقيقي يذهب ويعود بلا فقد');
  console.log('تحقّق ٢: الترميز قابل للعكس بلا فقد، والمقارنة بنيوية بالنوع');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — التصنيف: الحالات الخمس (القاعدة 22)
  // ═══════════════════════════════════════════════════════════════════
  const legacy = loadLegacyEmbeddedV7Report();
  const readableOnly = readJson('v7-reports-document-sample.json');
  for (const f of REPORT_RAW_FIELDS) ok(!(f in readableOnly), `[٣] العيّنة المقروءة بلا ${f}`);
  const rawDocFromGolden = {...goldenRaw};

  let rr = await rawReadOf(legacy, null);
  eq(rr.state, RAW_STATE.EMBEDDED_LEGACY, '[٣] تقرير بالشكل القديم ولا مستند خامّ → EMBEDDED_LEGACY');
  let c = M.classifyReport({reportData: legacy, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.MIGRATE, '[٣] MIGRATE');
  deq(c.presentFields.sort(), [...REPORT_RAW_FIELDS].sort(), '[٣] الحقول الخمسة كلّها حاضرة في العيّنة القديمة');

  rr = await rawReadOf(readableOnly, null);
  c = M.classifyReport({reportData: readableOnly, rawRead: rr});
  eq(rr.state, RAW_STATE.ABSENT, '[٣] تقرير بلا حقول ولا مستند خامّ → ABSENT');
  eq(c.state, M.MIGRATION_STATE.NO_RAW, '[٣] NO_RAW (يُعدّ ولا يُكتب له شيء)');

  rr = await rawReadOf(readableOnly, rawDocFromGolden);
  c = M.classifyReport({reportData: readableOnly, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.DONE, '[٣] DONE: خامّ موجود ولا حقول في التقرير');

  rr = await rawReadOf(legacy, rawDocFromGolden);
  c = M.classifyReport({reportData: legacy, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.HALF, '[٣] HALF: خامّ موجود (مطابق) والحقول ما زالت في التقرير');

  const differing = {...rawDocFromGolden, deviceFingerprintSha: 'a-different-value'};
  rr = await rawReadOf(legacy, differing);
  c = M.classifyReport({reportData: legacy, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.CONFLICT, '[٣] CONFLICT: خامّ موجود بقيمة تخالف التقرير');
  deq(c.conflictFields, ['deviceFingerprintSha'], '[٣] يُسمّي الحقل المتعارض (اسماً لا قيمة)');

  const missingInRaw = {...rawDocFromGolden};
  delete missingInRaw.sessionId;
  rr = await rawReadOf(legacy, missingInRaw);
  c = M.classifyReport({reportData: legacy, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.CONFLICT, '[٣] CONFLICT أيضاً: حقل في التقرير غائب من الخامّ القائم (لا يُكمَّل فوقه)');

  // null صريح حاضر = حقل حاضر (§٧-٢: «ولو null كُتب صراحةً»)
  const nullsOnly = {...readableOnly, sessionId: null, deviceFingerprintSha: null, timeSeriesStoragePath: null};
  rr = await rawReadOf(nullsOnly, null);
  c = M.classifyReport({reportData: nullsOnly, rawRead: rr});
  eq(c.state, M.MIGRATION_STATE.MIGRATE, '[٣] ثلاثة مفاتيح null فقط → MIGRATE (null كُتب صراحةً ليس غياباً)');
  deq(c.presentFields.sort(), ['deviceFingerprintSha', 'sessionId', 'timeSeriesStoragePath'], '[٣] المفاتيح null الحاضرة');

  // aiAudit وحده يكفي ليكون MIGRATE (المفتاح الخامس)
  const auditOnly = {...readableOnly, aiAudit: {x: 1}};
  rr = await rawReadOf(auditOnly, null);
  eq(M.classifyReport({reportData: auditOnly, rawRead: rr}).state, M.MIGRATION_STATE.MIGRATE, '[٣] aiAudit وحده → MIGRATE');
  throwsWith(() => M.classifyReport({reportData: {}, rawRead: null}), /rawRead/, '[٣] بلا rawRead يُرفض (لا قراءة غياب)');
  console.log('تحقّق ٣: MIGRATE/HALF/DONE/NO_RAW/CONFLICT بالحالات الصريحة');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — مستند الخامّ الذي يكتبه الترحيل: حرفي، بلا تخفيف ثانٍ، ما غاب يبقى غائباً
  // ═══════════════════════════════════════════════════════════════════
  const MARK = {__marker: 'createdAt'};
  const built = M.buildMigrationRawDocument({scanId: 'r1', reportData: legacy, createdAt: MARK});
  deq(Object.keys(built).sort(), ['createdAt', 'scanId', 'source', ...REPORT_RAW_FIELDS].sort(), '[٤] مفاتيح مستند الخامّ المرحَّل');
  eq(built.source, REPORT_RAW_SOURCE.MIGRATION, '[٤] source=migration (مصدر واحد من reportRawStore)');
  ok(REPORT_RAW_FIELDS.every((f) => M.valuesEqual(built[f], legacy[f])), '[٤] الحقول الخمسة حرفية');
  const withSamples = {rawFingerprint: {timeSeries: {samples: [{a: 1}], header: {}}, device: {}}, sessionId: null};
  const builtWithSamples = M.buildMigrationRawDocument({scanId: 'r2', reportData: withSamples, createdAt: MARK});
  deq(builtWithSamples.rawFingerprint.timeSeries.samples, [{a: 1}], '[٤] لا تخفيف ثانٍ: samples الموجودة تبقى (القاعدة 20)');
  ok(!('deviceFingerprintSha' in builtWithSamples) && !('aiAudit' in builtWithSamples) && !('timeSeriesStoragePath' in builtWithSamples),
      '[٤] ما غاب من التقرير يبقى غائباً في الخامّ (لا null مختلَق)');
  eq(builtWithSamples.sessionId, null, '[٤] null الصريح يُنقل null');
  throwsWith(() => M.buildMigrationRawDocument({scanId: '', reportData: legacy, createdAt: MARK}), /scanId/, '[٤] بلا scanId يُرفض');
  throwsWith(() => M.buildMigrationRawDocument({scanId: 'r', reportData: legacy}), /createdAt/, '[٤] بلا createdAt يُرفض (لا قيمة افتراضية)');
  // قاعدة 30: القارئ يفهم ما كتبه الترحيل — raw من reportRaw بعد الترحيل = raw المضمَّن قبله
  const afterMigration = await readReportRaw({db: memDb({reports: {r1: readableOnly}, raws: {r1: built}}), scanId: 'r1', reportData: readableOnly});
  const beforeMigration = await readReportRaw({db: memDb({reports: {r1: legacy}}), scanId: 'r1', reportData: legacy});
  eq(afterMigration.state, RAW_STATE.PRIVATE, '[٤] بعد الترحيل: PRIVATE');
  eq(beforeMigration.state, RAW_STATE.EMBEDDED_LEGACY, '[٤] قبله: EMBEDDED_LEGACY');
  ok(M.valuesEqual(afterMigration.raw, beforeMigration.raw), '[٤] readReportRaw يُعيد الخامّ نفسه قبل الترحيل وبعده (دلالة لا وصول فقط — القاعدة 30)');
  console.log('تحقّق ٤: المستند المرحَّل حرفي، والقارئ يراه كما كان');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — الاستدلال على معرّفات خامّ قبل التجزئة (عدّ لا قطعي)
  // ═══════════════════════════════════════════════════════════════════
  const hex64 = 'a'.repeat(64);
  const fp = (key) => ({device: {deviceProfileKey: key}});
  ok(M.hasLegacyRawLayerIdentifier(fp({a: hex64, c: 'raw-firebase-installation-id', d: hex64})), '[٥] c نصّ غير تجزئة → استدلال إيجابي');
  ok(M.hasLegacyRawLayerIdentifier(fp({layerC_androidId: '9774d56d682e549c'})), '[٥] layerC_androidId الخام (16 خانة) → إيجابي');
  ok(!M.hasLegacyRawLayerIdentifier(fp({a: hex64, c: hex64, d: hex64})), '[٥] تجزئات 64 خانة → سلبي');
  ok(!M.hasLegacyRawLayerIdentifier(fp({c: 'no_fid', d: 'no_android_id'})), '[٥] علامات الغياب → سلبي');
  ok(!M.hasLegacyRawLayerIdentifier(fp({a: 'raw-looking-but-primary'})), '[٥] a (الأساسي) لا يُعدّ');
  ok(!M.hasLegacyRawLayerIdentifier({}) && !M.hasLegacyRawLayerIdentifier(null) && !M.hasLegacyRawLayerIdentifier(fp(null)), '[٥] غياب البنية → سلبي بلا رمي');
  console.log('تحقّق ٥: الاستدلال على المعرّفات الخامّ');

  // ═══════════════════════════════════════════════════════════════════
  // ٦ — تصنيف evaluations
  // ═══════════════════════════════════════════════════════════════════
  const privateRaw = {state: RAW_STATE.PRIVATE, raw: {sessionId: 'S', deviceFingerprintSha: 'D', timeSeriesStoragePath: 'P'}};
  const embeddedRaw = {state: RAW_STATE.EMBEDDED_LEGACY, raw: {sessionId: 'S', deviceFingerprintSha: 'D', timeSeriesStoragePath: 'P'}};
  const absentRaw = {state: RAW_STATE.ABSENT, raw: null};
  const E = (o) => ({ownerId: 'o', technicianGrade: 'A', ...o});
  eq(M.classifyEvaluation({evalData: E({}), reportExists: true, rawRead: privateRaw}).state, M.EVAL_STATE.CLEAN, '[٦] بلا مفاتيح → CLEAN');
  eq(M.classifyEvaluation({evalData: E({sessionId: null, deviceFingerprintSha: null, timeSeriesStoragePath: null}), reportExists: true, rawRead: privateRaw}).state,
      M.EVAL_STATE.NULL_ONLY, '[٦] كلّها null → NULL_ONLY');
  eq(M.classifyEvaluation({evalData: E({sessionId: 'S', deviceFingerprintSha: 'D', timeSeriesStoragePath: 'P'}), reportExists: true, rawRead: privateRaw}).state,
      M.EVAL_STATE.DUPLICATE, '[٦] مطابقة لـreportRaw → DUPLICATE');
  eq(M.classifyEvaluation({evalData: E({sessionId: 'S'}), reportExists: true, rawRead: embeddedRaw}).state,
      M.EVAL_STATE.DUPLICATE, '[٦] مطابقة للمضمَّن في التقرير → DUPLICATE أيضاً (القيمة محفوظة خادمياً)');
  eq(M.classifyEvaluation({evalData: E({sessionId: null, timeSeriesStoragePath: 'P'}), reportExists: true, rawRead: privateRaw}).state,
      M.EVAL_STATE.DUPLICATE, '[٦] null + مطابق → DUPLICATE');
  eq(M.classifyEvaluation({evalData: E({timeSeriesStoragePath: 'OTHER'}), reportExists: true, rawRead: privateRaw}).state,
      M.EVAL_STATE.CONFLICT, '[٦] قيمة تخالف الخامّ → CONFLICT');
  eq(M.classifyEvaluation({evalData: E({timeSeriesStoragePath: 'P'}), reportExists: true, rawRead: {state: RAW_STATE.PRIVATE, raw: {sessionId: 'S'}}}).state,
      M.EVAL_STATE.MOVE, '[٦] قيمة فريدة وللتقرير خامّ مرحَّل لا يحملها → MOVE');
  eq(M.classifyEvaluation({evalData: E({timeSeriesStoragePath: 'P'}), reportExists: true, rawRead: absentRaw}).state,
      M.EVAL_STATE.MOVE, '[٦] قيمة فريدة، تقرير موجود بلا خامّ → MOVE (يُنشأ مستند)');
  eq(M.classifyEvaluation({evalData: E({timeSeriesStoragePath: 'P'}), reportExists: true, rawRead: {state: RAW_STATE.EMBEDDED_LEGACY, raw: {sessionId: 'S'}}}).state,
      M.EVAL_STATE.DEFERRED, '[٦] قيمة فريدة والتقرير لم يُرحَّل بعد → DEFERRED (لا كتابة فوق تقرير لم يُرحَّل)');
  eq(M.classifyEvaluation({evalData: E({timeSeriesStoragePath: 'P'}), reportExists: false, rawRead: absentRaw}).state,
      M.EVAL_STATE.ORPHAN, '[٦] قيمة فريدة ولا تقرير → ORPHAN (لا reportRaw بلا تقرير)');
  console.log('تحقّق ٦: تصنيف evaluations');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ — الخطّة والانجراف وسطر الأوامر
  // ═══════════════════════════════════════════════════════════════════
  const mkCounts = (total, migrate, half, evAct, conflicts = 0) => ({
    reports: {total, byState: {MIGRATE: migrate, HALF: half, DONE: 0, NO_RAW: 0, CONFLICT: conflicts}},
    evaluations: {byState: {DUPLICATE: evAct, NULL_ONLY: 0, MOVE: 0, CONFLICT: 0}},
  });
  const plan = {mode: 'dry-run', schema: M.PLAN_SCHEMA, projectId: PROJECT_ID, ...mkCounts(1000, 900, 0, 50)};
  ok(M.checkPlanDrift(plan, mkCounts(1000, 900, 0, 50)).ok, '[٧] أعداد مطابقة → مسموح');
  ok(M.checkPlanDrift(plan, mkCounts(1040, 940, 0, 50)).ok, '[٧] انجراف داخل العتبة (5٪ من 900 = 45) → مسموح');
  ok(!M.checkPlanDrift(plan, mkCounts(1000, 1000, 0, 50)).ok, '[٧] انجراف فوق العتبة (100 > 45) → لا يبدأ');
  ok(!M.checkPlanDrift(plan, mkCounts(1000, 900, 0, 150)).ok, '[٧] انجراف evaluations فوق العتبة → لا يبدأ');
  ok(!M.checkPlanDrift(plan, mkCounts(1000, 899, 0, 50, 1)).ok, '[٧] تعارض الآن → لا يبدأ');
  ok(!M.checkPlanDrift({...plan, ...mkCounts(1000, 900, 0, 50, 1)}, mkCounts(1000, 900, 0, 50)).ok, '[٧] تعارض في الخطّة → لا يبدأ');
  ok(M.checkPlanDrift({...plan, ...mkCounts(3, 3, 0, 0)}, mkCounts(3, 0, 0, 0)).ok, '[٧] أعداد صغيرة: العتبة المطلقة (10) تسري');
  eq(M.PLAN_TOLERANCE.absolute, 10, '[٧] العتبة المعلنة: مطلق 10');
  eq(M.PLAN_TOLERANCE.ratio, 0.05, '[٧] العتبة المعلنة: نسبة 5٪');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrm-unit-'));
  const planFile = path.join(tmp, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  ok(M.loadPlan(planFile).reports.total === 1000, '[٧] خطّة صالحة تُقرأ');
  fs.writeFileSync(planFile, JSON.stringify({...plan, mode: 'verify'}));
  throwsWith(() => M.loadPlan(planFile), /PLAN_NOT_DRY_RUN_OUTPUT/, '[٧] ملفّ ليس مخرَج --dry-run يُرفض');
  fs.writeFileSync(planFile, JSON.stringify({...plan, projectId: 'other-project'}));
  throwsWith(() => M.loadPlan(planFile), /PLAN_PROJECT_MISMATCH/, '[٧] مشروع آخر يُرفض');
  fs.writeFileSync(planFile, JSON.stringify({...plan, schema: 99}));
  throwsWith(() => M.loadPlan(planFile), /PLAN_SCHEMA_MISMATCH/, '[٧] مخطّط آخر يُرفض');
  fs.writeFileSync(planFile, '{not json');
  throwsWith(() => M.loadPlan(planFile), /PLAN_UNREADABLE/, '[٧] ملفّ فاسد يُرفض');
  throwsWith(() => M.loadPlan(undefined), /PLAN_MISSING/, '[٧] بلا --plan يُرفض');

  const pa = M.parseArgs;
  eq(pa([]).mode, 'dry-run', '[٧] بلا وسائط → --dry-run (الافتراضي)');
  eq(pa(['--dry-run']).mode, 'dry-run', '[٧] --dry-run');
  eq(pa(['--verify']).mode, 'verify', '[٧] --verify');
  // (V8 قبل نشر الأمان، القاعدة 23) استُبدلت تأكيدات --apply الواحد (ينسخ ويحذف معاً) بتأكيدات المرحلتين: لا --apply بلا --phase.
  const ap = pa(['--apply', '--phase', 'copy', '--backup', 'b.jsonl', '--plan', 'p.json']);
  ok(ap.mode === 'apply' && ap.phase === 'copy' && ap.backup === 'b.jsonl' && ap.plan === 'p.json', '[٧] --apply --phase copy مع --backup و--plan');
  const apd = pa(['--apply', '--phase', 'delete', '--backup', 'b.jsonl', '--plan', 'p.json']);
  ok(apd.mode === 'apply' && apd.phase === 'delete', '[٧] --apply --phase delete');
  throwsWith(() => pa(['--apply']), /--phase/, '[٧] --apply بلا --phase يُرفض (لا مسار واحد ينسخ ويحذف معاً)');
  throwsWith(() => pa(['--apply', '--backup', 'b.jsonl', '--plan', 'p.json']), /--phase copy\|delete/, '[٧] --apply مع النسخة والخطّة لكن بلا --phase يُرفض أيضاً');
  throwsWith(() => pa(['--apply', '--phase', 'both', '--backup', 'b', '--plan', 'p']), /copy أو delete/, '[٧] --phase بقيمة مجهولة يُرفض');
  throwsWith(() => pa(['--apply', '--phase', 'copy']), /--backup/, '[٧] --apply --phase copy بلا --backup يُرفض');
  throwsWith(() => pa(['--apply', '--phase', 'copy', '--backup', 'b.jsonl']), /--dry-run/, '[٧] المرحلة ١ بلا --plan تطلب مخرَج --dry-run');
  throwsWith(() => pa(['--apply', '--phase', 'delete', '--backup', 'b.jsonl']), /--verify-copy/, '[٧] المرحلة ٢ بلا --plan تطلب مخرَج --verify-copy');
  throwsWith(() => pa(['--dry-run', '--apply', '--phase', 'copy', '--backup', 'b', '--plan', 'p']), /وضع واحد/, '[٧] وضعان معاً يُرفضان');
  eq(pa(['--verify-copy']).mode, 'verify-copy', '[٧] --verify-copy');
  eq(pa(['--verify-copy']).backup, null, '[٧] --verify-copy بلا --backup مسموح (يعدّ المطابق ويقول إن النسخة لم تُقدَّم)');
  eq(pa(['--verify-copy', '--backup', 'b.jsonl']).backup, 'b.jsonl', '[٧] --verify-copy مع --backup');
  throwsWith(() => pa(['--verify-copy', '--plan', 'p']), /--plan لا يخصّ/, '[٧] --plan مع --verify-copy يُرفض');
  throwsWith(() => pa(['--verify-copy', '--phase', 'copy']), /--phase لا يخصّ/, '[٧] --phase مع --verify-copy يُرفض');
  throwsWith(() => pa(['--verify', '--backup', 'b']), /لا يخصّ/, '[٧] --backup مع --verify يُرفض');
  throwsWith(() => pa(['--dry-run', '--phase', 'copy']), /لا يخصّ/, '[٧] --phase مع --dry-run يُرفض');
  throwsWith(() => pa(['--force']), /وسيط مجهول/, '[٧] وسيط مجهول يُرفض (لا تجاهل صامت)');
  throwsWith(() => pa(['somefile']), /وسيط مجهول/, '[٧] وسيط موضعي يُرفض');
  throwsWith(() => pa(['--backup']), /يحتاج قيمة/, '[٧] --backup بلا قيمة يُرفض');
  const rs = pa(['--restore', '--backup', 'b.jsonl']);
  ok(rs.mode === 'restore' && rs.restoreApply === false, '[٧] --restore معاينة افتراضاً');
  ok(pa(['--restore', '--apply', '--backup', 'b.jsonl']).restoreApply === true, '[٧] --restore --apply يكتب');
  throwsWith(() => pa(['--restore']), /--backup/, '[٧] --restore بلا --backup يُرفض');
  throwsWith(() => pa(['--restore', '--verify', '--backup', 'b']), /لا يجتمع/, '[٧] --restore مع --verify يُرفض');
  throwsWith(() => pa(['--restore', '--verify-copy', '--backup', 'b']), /لا يجتمع/, '[٧] --restore مع --verify-copy يُرفض');
  throwsWith(() => pa(['--restore', '--phase', 'delete', '--backup', 'b']), /--phase لا يخصّ/, '[٧] --phase مع --restore يُرفض');

  // خطّة المرحلة ٢ = مخرَج --verify-copy: ready=true ومع نسخة (loadPlan(path, "verify-copy"))
  const vcPlan = {mode: 'verify-copy', schema: M.PLAN_SCHEMA, projectId: PROJECT_ID, ready: true,
    backup: {provided: true, totalLines: 10, sha256: 'a'.repeat(64), reportRecords: 6, evaluationRecords: 3}, expected: {reportRecords: 6, evaluationRecords: 3}};
  fs.writeFileSync(planFile, JSON.stringify(vcPlan));
  ok(M.loadPlan(planFile, 'verify-copy').expected.reportRecords === 6, '[٧] خطّة المرحلة ٢ الصالحة (مخرَج --verify-copy) تُقرأ');
  throwsWith(() => M.loadPlan(planFile), /PLAN_NOT_DRY_RUN_OUTPUT/, '[٧] ومخرَج --verify-copy لا يُقبل خطّةً للمرحلة ١');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_NOT_VERIFY_COPY_OUTPUT/, '[٧] ومخرَج --dry-run لا يُقبل خطّةً للمرحلة ٢');
  fs.writeFileSync(planFile, JSON.stringify({...vcPlan, ready: false}));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_NOT_READY/, '[٧] --verify-copy بلا ready يُرفض');
  fs.writeFileSync(planFile, JSON.stringify({...vcPlan, backup: {provided: false}}));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_BACKUP_NOT_PROVIDED/, '[٧] --verify-copy بلا --backup يُرفض خطّةً للحذف');
  fs.writeFileSync(planFile, JSON.stringify({...vcPlan, projectId: 'other-project'}));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_PROJECT_MISMATCH/, '[٧] مشروع آخر يُرفض (المرحلة ٢)');
  fs.writeFileSync(planFile, JSON.stringify({...vcPlan, schema: 99}));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_SCHEMA_MISMATCH/, '[٧] مخطّط آخر يُرفض (المرحلة ٢)');
  fs.writeFileSync(planFile, JSON.stringify({...vcPlan, expected: {}}));
  throwsWith(() => M.loadPlan(planFile, 'verify-copy'), /PLAN_SHAPE_INVALID/, '[٧] expected غائب يُرفض');
  throwsWith(() => M.loadPlan(undefined, 'verify-copy'), /PLAN_MISSING: --plan <مخرَج --verify-copy/, '[٧] بلا --plan تطلب مخرَج --verify-copy');
  throwsWith(() => M.loadPlan(planFile, 'something'), /نوع خطّة مجهول/, '[٧] نوع خطّة مجهول يُرفض');
  console.log('تحقّق ٧: الخطّة والانجراف وسطر الأوامر');

  // ═══════════════════════════════════════════════════════════════════
  // ٨ — النسخة الاحتياطية: خارج أيّ مستودع، قبل أيّ كتابة، ولا قيمة على الشاشة
  // ═══════════════════════════════════════════════════════════════════
  const repoRoot = path.resolve(__dirname, '..', '..');
  throwsWith(() => M.assertBackupPathOutsideRepos(path.join(repoRoot, 'functions', 'backup.jsonl')), /BACKUP_INSIDE_REPOSITORY/, '[٨] داخل مستودع الباك اند يُرفض');
  throwsWith(() => M.assertBackupPathOutsideRepos(path.join(repoRoot, 'backup.jsonl')), /BACKUP_INSIDE_REPOSITORY/, '[٨] جذر المستودع يُرفض');
  const fakeRepo = path.join(tmp, 'some-other-repo');
  fs.mkdirSync(path.join(fakeRepo, '.git'), {recursive: true});
  fs.mkdirSync(path.join(fakeRepo, 'sub', 'deeper'), {recursive: true});
  throwsWith(() => M.assertBackupPathOutsideRepos(path.join(fakeRepo, 'sub', 'deeper', 'b.jsonl')), /BACKUP_INSIDE_REPOSITORY/, '[٨] داخل أيّ مستودع git آخر (مجلّد فيه .git في الأعلى) يُرفض');
  throwsWith(() => M.assertBackupPathOutsideRepos(path.join(tmp, 'no-such-dir', 'b.jsonl')), /BACKUP_DIR_MISSING/, '[٨] مجلّد غير موجود يُرفض (لا يُنشأ تلقائياً)');
  throwsWith(() => M.assertBackupPathOutsideRepos(tmp), /BACKUP_PATH_IS_DIRECTORY/, '[٨] مسار هو مجلّد يُرفض');
  throwsWith(() => M.assertBackupPathOutsideRepos(''), /BACKUP_PATH_MISSING/, '[٨] مسار فارغ يُرفض');
  const okPath = path.join(tmp, 'backup-ok.jsonl');
  eq(path.basename(M.assertBackupPathOutsideRepos(okPath)), 'backup-ok.jsonl', '[٨] مسار خارج المستودعات يُقبل');

  const t0 = new Date('2026-10-09T10:00:00Z');
  let bk = M.openBackup({backupPath: okPath, now: () => t0});
  eq(bk.resumed, false, '[٨] أوّل فتح: ليس استئنافاً');
  const fakeSnap = {updateTime: new Timestamp(1700000000, 5)};
  const line = M.reportBackupLine({scanId: 's1', snap: fakeSnap, data: {...legacy, listingStatus: 'for_sale'}});
  bk.writeLine(line);
  bk.flush();
  eq(bk.linesWritten, 2, '[٨] ترويسة + سطر تقرير');
  bk.close();
  const bkLines = M.readBackupLines(okPath);
  eq(bkLines[0].kind, 'header', '[٨] السطر الأوّل ترويسة');
  eq(bkLines[0].projectId, PROJECT_ID, '[٨] الترويسة تحمل projectId');
  eq(bkLines[1].listingStatus, 'for_sale', '[٨] سطر التقرير يحمل listingStatus (ليس معرّفاً)');
  eq(bkLines[1].fieldsSha256, require('crypto').createHash('sha256').update(M.stableStringify(bkLines[1].fields)).digest('hex'), '[٨] تجزئة السلامة مطابقة');
  const decodedFields = {};
  for (const f of Object.keys(bkLines[1].fields)) decodedFields[f] = M.decodeValue(bkLines[1].fields[f], ctx);
  ok(REPORT_RAW_FIELDS.every((f) => M.valuesEqual(decodedFields[f], legacy[f])), '[٨] النسخة تُفكّ إلى القيم الأصلية كلّها');
  bk = M.openBackup({backupPath: okPath, now: () => t0});
  eq(bk.resumed, true, '[٨] فتح ملفّ موجود = استئناف (يُلحَق ولا يُمحى)');
  bk.close();
  eq(M.readBackupLines(okPath).length, 3, '[٨] بعد الاستئناف: ترويسة + سطر + سطر استئناف');
  eq(M.readBackupLines(okPath)[2].kind, 'resume', '[٨] سطر الاستئناف موسوم');
  fs.writeFileSync(okPath, `${JSON.stringify({kind: 'header'})}\nthis line contains SECRET-VALUE-12345 and is not json\n`);
  let backupErr = null;
  try { M.readBackupLines(okPath); } catch (e) { backupErr = e; }
  ok(backupErr && /BACKUP_LINE_INVALID: line=2/.test(backupErr.message) && !backupErr.message.includes('SECRET-VALUE'),
      '[٨] سطر فاسد: الخطأ برقم السطر وحده، بلا اقتباس من محتواه (القاعدة 36)');

  const eline = M.evaluationBackupLine({evalId: 'e1', snap: fakeSnap, data: {sessionId: 'S', ownerId: 'x'}, heldFields: ['sessionId']});
  deq(Object.keys(eline.fields), ['sessionId'], '[٨] نسخة evaluation تحمل الحقول المحجوزة وحدها (لا ownerId)');
  console.log('تحقّق ٨: النسخة الاحتياطية');

  // ═══════════════════════════════════════════════════════════════════
  // ٩ — نصّ الأخطاء المنقّى (القاعدة 36) + لا طباعة قيم من المكتبة
  // ═══════════════════════════════════════════════════════════════════
  const dirty = new Error('9 FAILED_PRECONDITION: no entity to update: reports/9f8e7d6c-1234-4abc-8def-0123456789ab token=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  dirty.code = 9;
  const clean = M.sanitizeError(dirty);
  ok(!/9f8e7d6c/.test(clean.message) && !/ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(clean.message), '[٩] المعرّف والرمز الطويل يُخفيان من نصّ الخطأ');
  ok(/reports\/\[id\]/.test(clean.message), '[٩] المسار يبقى بلا معرّف');
  eq(clean.code, '9', '[٩] الرمز يبقى');
  const libSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'reportRawMigration.js'), 'utf8');
  ok(!/console\./.test(libSource), '[٩] المكتبة لا تستدعي console إطلاقاً — المخرَج عبر log() والخلاصة وحدهما (لا قيمة تتسرّب)');
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-report-raw.js'), 'utf8');
  ok(!/process\.argv\.slice\(2\)\.find|GOOGLE_APPLICATION_CREDENTIALS\s*=|apiKey|private_key/i.test(cliSource), '[٩] السكربت لا يقرأ ولا يكتب مفتاحاً');
  ok(/projectId: PROJECT_ID/.test(cliSource) && !/initializeApp\(\)/.test(cliSource), '[٩] projectId مثبَّت في initializeApp (لا استدلال من بيئة الطرفية)');
  eq(require('../scripts/migrate-report-raw').describeTarget({}), 'PRODUCTION', '[٩] بلا متغيّر المحاكي: الهدف الإنتاج (يُطبع أوّلاً)');
  eq(require('../scripts/migrate-report-raw').describeTarget({FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'}), 'EMULATOR 127.0.0.1:8080', '[٩] مع المتغيّر: المحاكي');
  console.log('تحقّق ٩: نصّ الأخطاء والمخرَج');

  // ═══════════════════════════════════════════════════════════════════
  // ١٠ — قيمة لا يعرف الترميز نسخها: التقرير يُتخطّى بحالة صريحة (لا حذف بلا نسخة، ولا انهيار التشغيل)
  // ═══════════════════════════════════════════════════════════════════
  const snapOf = (id, data) => ({id, data: () => data, updateTime: new Timestamp(1700000000, 0)});
  const okInspected = await M.inspectReport({db: memDb({}, {}), snap: snapOf('g1', {...legacy, listingStatus: 'sold'})});
  eq(okInspected.unencodable, null, '[١٠] تقرير عادي: قابل للترميز');
  eq(okInspected.exposed, true, '[١٠] والمعروض مقروء من listingStatus');
  const weird = await M.inspectReport({db: memDb({}, {}), snap: snapOf('g2', {sessionId: null, aiAudit: {unsupported: new Map([[1, 2]])}})});
  ok(typeof weird.unencodable === 'string' && /غير مدعوم/.test(weird.unencodable), '[١٠] صنف غير مدعوم داخل aiAudit: unencodable بسببه');
  eq(weird.state, M.MIGRATION_STATE.MIGRATE, '[١٠] وتصنيفه يبقى MIGRATE (الإنفاذ هو الذي يتخطّاه)');

  // ═══════════════════════════════════════════════════════════════════
  // ١١ — المرحلتان (V8 قبل نشر الأمان، 2026-10-09 +03): المقارنة بالبايت، حارسا الحمولة، موانع المرحلة ٢، فحص ملفّ النسخة، وبنية الشيفرة
  // قرارا المستخدم: «المرحلة الأولى تنسخ إلى reportRaw ولا تحذف، ثم تحقّق بالأداة، ثم المرحلة الثانية تحذف الحقول من التقرير، بكتلة منفصلة وأمر صريح منّي.»
  // و«... وتُثبت الكتلة أن ملفّ النسخة موجود وغير فارغ قبل خطوة الحذف، وإلا تتوقّف.»
  // ═══════════════════════════════════════════════════════════════════
  const {FieldValue} = require('@google-cloud/firestore');
  const crypto = require('crypto');
  const privRaw = (raw) => ({state: RAW_STATE.PRIVATE, raw});
  const repX = {...legacy, listingStatus: 'for_sale'};
  const movedX = M.pickMoved(repX);

  // المقارنة بالبايت: MATCH / DIFFER / ABSENT
  deq(M.compareReportToRaw({reportData: repX, rawRead: privRaw({scanId: 'x', ...movedX, source: 'migration'})}), {state: 'MATCH', fields: []}, '[١١] خامّ مطابق لكل حقل: MATCH');
  eq(M.compareReportToRaw({reportData: {listingStatus: 'x'}, rawRead: privRaw({})}), null, '[١١] تقرير بلا أيّ من الخمسة: لا شيء يُقارَن (null)');
  deq(M.compareReportToRaw({reportData: repX, rawRead: {state: RAW_STATE.ABSENT, raw: null}}), {state: 'ABSENT', fields: []}, '[١١] لا مستند خامّ: ABSENT');
  deq(M.compareReportToRaw({reportData: repX, rawRead: {state: RAW_STATE.EMBEDDED_LEGACY, raw: movedX}}), {state: 'ABSENT', fields: []}, '[١١] خامّ مضمَّن في التقرير فقط (لا مستند): ABSENT');
  deq(M.compareReportToRaw({reportData: repX, rawRead: privRaw({...movedX, deviceFingerprintSha: 'other'})}), {state: 'DIFFER', fields: ['deviceFingerprintSha']}, '[١١] حقل يختلف قيمةً: DIFFER ويُسمّى الحقل');
  const withoutSession = {...movedX};
  delete withoutSession.sessionId;
  deq(M.compareReportToRaw({reportData: repX, rawRead: privRaw(withoutSession)}), {state: 'DIFFER', fields: ['sessionId']}, '[١١] حقل مفقود من الخامّ: DIFFER');
  eq(M.compareReportToRaw({reportData: {sessionId: new Timestamp(1, 2)}, rawRead: privRaw({sessionId: '1970-01-01T00:00:01.000000002Z'})}).state, 'DIFFER', '[١١] Timestamp ≠ نصّ يشبهه (النوع جزء من المقارنة)');
  eq(M.compareReportToRaw({reportData: {sessionId: NaN}, rawRead: privRaw({sessionId: NaN})}).state, 'MATCH', '[١١] NaN = NaN');
  eq(M.compareReportToRaw({reportData: {sessionId: 0}, rawRead: privRaw({sessionId: -0})}).state, 'DIFFER', '[١١] 0 ≠ -0 (بالبايت)');
  eq(M.compareReportToRaw({reportData: {aiAudit: {x: new Map([[1, 2]])}}, rawRead: privRaw({aiAudit: {x: 1}})}).state, 'DIFFER', '[١١] قيمة لا يعرف الترميز مقارنتها: DIFFER لا استثناء (القاعدة 22)');
  eq(M.fieldDigest('1') === M.fieldDigest(1), false, '[١١] تجزئة الحقل تفرّق النوع');
  eq(M.fieldDigest({b: 1, a: 2}), M.fieldDigest({a: 2, b: 1}), '[١١] وترتيب المفاتيح لا يغيّرها');
  eq(M.fieldDigest('x'), crypto.createHash('sha256').update(M.stableStringify(M.encodeValue('x'))).digest('hex'), '[١١] وهي sha256 للترميز القانوني');

  // حارسا الحمولة
  ok(M.isFieldDelete(FieldValue.delete(), FieldValue) && !M.isFieldDelete(FieldValue.serverTimestamp(), FieldValue) && !M.isFieldDelete(null, FieldValue) && !M.isFieldDelete('x', FieldValue), '[١١] isFieldDelete يميّز علامة الحذف');
  M.assertCopyPayload('reportRaw', {sessionId: 'x', createdAt: FieldValue.serverTimestamp()}, FieldValue);
  n++;
  throwsWith(() => M.assertCopyPayload('reports', {a: 1}, FieldValue), /TRAP.*reportRaw/, '[١١] المرحلة copy لا تكتب في reports');
  throwsWith(() => M.assertCopyPayload('evaluations', {a: 1}, FieldValue), /TRAP.*reportRaw/, '[١١] ولا في evaluations');
  throwsWith(() => M.assertCopyPayload('reportRaw', {sessionId: FieldValue.delete()}, FieldValue), /TRAP.*لا تحذف/, '[١١] ولا حمولة copy بعلامة حذف');
  M.assertDeletePayload('reports', {sessionId: FieldValue.delete(), aiAudit: FieldValue.delete()}, REPORT_RAW_FIELDS, FieldValue);
  M.assertDeletePayload('evaluations', {deviceFingerprintSha: FieldValue.delete()}, M.EVALUATION_IDENTIFIER_FIELDS, FieldValue);
  n += 2;
  throwsWith(() => M.assertDeletePayload('reportRaw', {sessionId: FieldValue.delete()}, REPORT_RAW_FIELDS, FieldValue), /TRAP.*reportRaw/, '[١١] المرحلة delete لا تلمس reportRaw');
  throwsWith(() => M.assertDeletePayload('reports', {userId: FieldValue.delete()}, REPORT_RAW_FIELDS, FieldValue), /TRAP.*ليس من المنقول/, '[١١] ولا تحذف حقلاً ليس من الخمسة (userId)');
  throwsWith(() => M.assertDeletePayload('reports', {sessionId: null}, REPORT_RAW_FIELDS, FieldValue), /TRAP.*حقولاً فقط/, '[١١] ولا تكتب قيمة (null) بدل الحذف');
  throwsWith(() => M.assertDeletePayload('reports', {}, REPORT_RAW_FIELDS, FieldValue), /TRAP.*فارغة/, '[١١] ولا حمولة فارغة');
  throwsWith(() => M.assertDeletePayload('evaluations', {ownerId: FieldValue.delete()}, M.EVALUATION_IDENTIFIER_FIELDS, FieldValue), /TRAP.*ليس من المنقول/, '[١١] ولا تحذف ownerId من evaluations');

  // موانع المرحلة ٢: كل ما سوى «مطابق وله سطر» يُعدّ ويمنع؛ وORPHAN وDEFERRED تُترك ولا تمنع
  const mkStatus = (over = {}) => ({
    reports: {byteCompare: {MATCH: 5, DIFFER: 0, ABSENT: 0}, noBackupLine: 0, backupLineMismatch: 0, ...(over.reports || {})},
    evaluations: {blocking: {MOVE: 0, CONFLICT: 0}, leftAsIs: {ORPHAN: 2, DEFERRED: 1}, noBackupLine: 0, backupLineMismatch: 0, ...(over.evaluations || {})},
  });
  deq(M.copyStatusBlockers(mkStatus(), {backupProvided: true}), [], '[١١] كل شيء مطابق وله سطر (واليتيم والمؤجَّل متروكان): لا مانع');
  ok(M.copyStatusBlockers(mkStatus({reports: {byteCompare: {MATCH: 4, DIFFER: 1, ABSENT: 0}}}), {backupProvided: true}).some((b) => /DIFFER=1/.test(b)), '[١١] DIFFER يمنع');
  ok(M.copyStatusBlockers(mkStatus({reports: {byteCompare: {MATCH: 4, DIFFER: 0, ABSENT: 1}}}), {backupProvided: true}).some((b) => /ABSENT=1/.test(b)), '[١١] ABSENT يمنع');
  ok(M.copyStatusBlockers(mkStatus({evaluations: {blocking: {MOVE: 1, CONFLICT: 0}, leftAsIs: {ORPHAN: 0, DEFERRED: 0}}}), {backupProvided: true}).some((b) => /MOVE/.test(b)), '[١١] تقييم لم تُنسخ قيمته (MOVE) يمنع');
  ok(M.copyStatusBlockers(mkStatus({evaluations: {blocking: {MOVE: 0, CONFLICT: 2}, leftAsIs: {ORPHAN: 0, DEFERRED: 0}}}), {backupProvided: true}).some((b) => /CONFLICT=2/.test(b)), '[١١] تعارض تقييم يمنع');
  ok(M.copyStatusBlockers(mkStatus(), {backupProvided: false}).includes('BACKUP_NOT_PROVIDED'), '[١١] بلا ملفّ نسخة: يمنع');
  ok(M.copyStatusBlockers(mkStatus({reports: {byteCompare: {MATCH: 5, DIFFER: 0, ABSENT: 0}, noBackupLine: 3, backupLineMismatch: 0}}), {backupProvided: true}).some((b) => /بلا سطر نسخة=3/.test(b)), '[١١] تقرير بلا سطر نسخة يمنع');
  ok(M.copyStatusBlockers(mkStatus({reports: {byteCompare: {MATCH: 5, DIFFER: 0, ABSENT: 0}, noBackupLine: 0, backupLineMismatch: 2}}), {backupProvided: true}).some((b) => /بتجزئة مختلفة=2/.test(b)), '[١١] سطر نسخة بتجزئة مختلفة يمنع');
  ok(M.copyStatusBlockers(mkStatus({evaluations: {noBackupLine: 1}}), {backupProvided: true}).some((b) => /evaluations بلا سطر نسخة=1/.test(b)), '[١١] تقييم بلا سطر نسخة يمنع');
  ok(M.copyStatusBlockers(mkStatus({evaluations: {backupLineMismatch: 1}}), {backupProvided: true}).some((b) => /evaluations سطر نسخة بتجزئة مختلفة=1/.test(b)), '[١١] تقييم بسطر نسخة بتجزئة مختلفة يمنع');

  // ملفّ النسخة: فحص بلا تحميل كامل، ورسائل بلا محتوى، وتجزئة الملفّ
  const hdr = (over = {}) => JSON.stringify({v: 1, kind: 'header', projectId: PROJECT_ID, atIso: t0.toISOString(), tool: 'migrate-report-raw', ...over});
  const recR = (id, sha) => JSON.stringify({v: 1, kind: 'report', scanId: id, fieldsSha256: sha, fields: {}});
  const recE = (id, sha) => JSON.stringify({v: 1, kind: 'evaluation', evalId: id, fieldsSha256: sha, fields: {}});
  const bkp = path.join(tmp, 'inspect.jsonl');
  fs.writeFileSync(bkp, [hdr(), recR('r1', 'sha-a'), recR('r2', 'sha-b'), '', recE('e1', 'sha-c'), recR('r1', 'sha-a2')].join('\n') + '\n');
  const idx = M.inspectBackupFile(bkp);
  eq(idx.totalLines, 5, '[١١] عدد الأسطر غير الفارغة (السطر الفارغ لا يُعدّ)');
  eq(idx.reportRecords, 2, '[١١] تقريران بسجلّ');
  eq(idx.evaluationRecords, 1, '[١١] وتقييم');
  eq(idx.reports.get('r1').fieldsSha256, 'sha-a2', '[١١] آخر سجلّ لكل معرّف هو المعتمد (تتبّعه --restore)');
  eq(idx.sha256, crypto.createHash('sha256').update(fs.readFileSync(bkp)).digest('hex'), '[١١] تجزئة الملفّ = sha256 لبايتاته');
  eq(idx.bytes, fs.statSync(bkp).size, '[١١] وحجمه');
  throwsWith(() => M.inspectBackupFile(path.join(tmp, 'no-such.jsonl')), /BACKUP_MISSING/, '[١١] ملفّ غير موجود: BACKUP_MISSING');
  throwsWith(() => M.inspectBackupFile(tmp), /BACKUP_NOT_A_FILE/, '[١١] مجلّد لا ملفّ: BACKUP_NOT_A_FILE');
  const emptyBk = path.join(tmp, 'empty.jsonl');
  fs.writeFileSync(emptyBk, '');
  throwsWith(() => M.inspectBackupFile(emptyBk), /BACKUP_EMPTY/, '[١١] ملفّ فارغ: BACKUP_EMPTY');
  throwsWith(() => M.inspectBackupFile(''), /BACKUP_PATH_MISSING/, '[١١] مسار فارغ');
  const badBk = path.join(tmp, 'bad.jsonl');
  fs.writeFileSync(badBk, `${hdr()}\nthis has SECRET-VALUE-777 and is not json\n`);
  let badErr = null;
  try { M.inspectBackupFile(badBk); } catch (e) { badErr = e; }
  ok(badErr && /BACKUP_LINE_INVALID: line=2/.test(badErr.message) && !badErr.message.includes('SECRET-VALUE'), '[١١] سطر فاسد: رقم السطر وحده بلا اقتباس (القاعدة 36)');
  fs.writeFileSync(badBk, `${hdr({projectId: 'other'})}\n${recR('r1', 'x')}\n`);
  throwsWith(() => M.inspectBackupFile(badBk), /BACKUP_HEADER_INVALID/, '[١١] ترويسة لمشروع آخر مرفوضة');
  fs.writeFileSync(badBk, `${recR('r1', 'x')}\n`);
  throwsWith(() => M.inspectBackupFile(badBk), /BACKUP_HEADER_INVALID/, '[١١] بلا ترويسة مرفوضة');
  // دفعات 4 ميغابايت: بايت متعدّد يقع على حدّ الدفعة يبقى سليماً (يُقرأ بالبايتات لا بالحروف)
  const BOUNDARY = 4 * 1024 * 1024;
  const prefix = `${hdr()}\n`;
  const recPrefix = '{"v":1,"kind":"report","scanId":"';
  const padLen = BOUNDARY - 1 - (Buffer.byteLength(prefix) + Buffer.byteLength(recPrefix));
  const bigId = `${'a'.repeat(padLen)}ع`;
  const bigBk = path.join(tmp, 'big.jsonl');
  fs.writeFileSync(bigBk, `${prefix}${recR(bigId, 'sha-big')}\n${recR('after-boundary', 'sha-after')}\n${recE('e-after', 'sha-e')}`);
  const bigBuf = fs.readFileSync(bigBk);
  eq(bigBuf[BOUNDARY - 1], 0xd8, '[١١] البايت الأوّل من الحرف العربي يقع عند آخر بايت من الدفعة الأولى (حدّ الدفعة يشطر الحرف)');
  const bigIdx = M.inspectBackupFile(bigBk);
  eq(bigIdx.totalLines, 4, '[١١] ملفّ يتجاوز دفعة واحدة: كل الأسطر الأربعة (آخرها بلا سطر جديد)');
  ok(bigIdx.reports.has(bigId) && bigIdx.reports.has('after-boundary') && bigIdx.evaluations.has('e-after'), '[١١] والمعرّف الذي يشطره حدّ الدفعة قُرئ سليماً');
  eq(bigIdx.sha256, crypto.createHash('sha256').update(bigBuf).digest('hex'), '[١١] وتجزئة الملفّ الكبير صحيحة');

  // شرط المرحلة ٢ على ملفّ النسخة (بلا شبكة): موجود، غير فارغ، هو نفسه الذي جرى عليه --verify-copy
  const delPlan = (over = {}) => ({mode: 'verify-copy', schema: M.PLAN_SCHEMA, projectId: PROJECT_ID, ready: true,
    backup: {provided: true, totalLines: idx.totalLines, sha256: idx.sha256, reportRecords: idx.reportRecords, evaluationRecords: idx.evaluationRecords, ...(over.backup || {})},
    expected: {reportRecords: 2, evaluationRecords: 1}});
  eq(M.assertBackupReadyForDelete(bkp, delPlan()).totalLines, 5, '[١١] ملفّ النسخة المطابق للخطّة يُقبل');
  throwsWith(() => M.assertBackupReadyForDelete(path.join(tmp, 'no-such.jsonl'), delPlan()), /BACKUP_MISSING/, '[١١] المرحلة ٢ بلا ملفّ نسخة: تتوقّف');
  throwsWith(() => M.assertBackupReadyForDelete(emptyBk, delPlan()), /BACKUP_EMPTY/, '[١١] بملفّ فارغ: تتوقّف');
  throwsWith(() => M.assertBackupReadyForDelete(bkp, delPlan({backup: {totalLines: 6}})), /BACKUP_LINES_MISMATCH: الملفّ 5 سطراً والخطّة 6/, '[١١] عدد أسطر لا يساوي الخطّة: تتوقّف');
  throwsWith(() => M.assertBackupReadyForDelete(bkp, delPlan({backup: {reportRecords: 3}})), /BACKUP_RECORDS_MISMATCH/, '[١١] عدد سجلّات لا يساوي الخطّة: تتوقّف');
  throwsWith(() => M.assertBackupReadyForDelete(bkp, delPlan({backup: {sha256: 'f'.repeat(64)}})), /BACKUP_CHANGED_SINCE_VERIFY/, '[١١] تجزئة مختلفة (الملفّ تغيّر بعد --verify-copy): تتوقّف');
  throwsWith(() => M.assertBackupReadyForDelete(path.join(repoRoot, 'functions', 'backup.jsonl'), delPlan()), /BACKUP_INSIDE_REPOSITORY/, '[١١] ملفّ داخل المستودع: يُرفض');

  // openBackup.writeRecord: لا يكرّر سطراً لم يتغيّر، ويكتب ما تغيّر حتى يبقى آخر سطر لكل معرّف هو الحالة المحذوفة فعلاً
  const dedupPath = path.join(tmp, 'dedupe.jsonl');
  let db1 = M.openBackup({backupPath: dedupPath, now: () => t0});
  const l1 = M.reportBackupLine({scanId: 'd1', snap: fakeSnap, data: repX});
  const l1b = M.reportBackupLine({scanId: 'd1', snap: fakeSnap, data: {...repX, deviceFingerprintSha: 'changed'}});
  const le = M.evaluationBackupLine({evalId: 'de1', snap: fakeSnap, data: {sessionId: 'S'}, heldFields: ['sessionId']});
  eq(db1.writeRecord(l1), true, '[١١] أوّل سجلّ يُكتب');
  eq(db1.writeRecord(l1), false, '[١١] السجلّ نفسه ثانيةً لا يُكتب');
  eq(db1.writeRecord(l1b), true, '[١١] تقرير تغيّرت حقوله: سجلّ جديد');
  eq(db1.writeRecord(le), true, '[١١] وسجلّ تقييم');
  eq(db1.writeRecord(le), false, '[١١] ولا يتكرّر');
  eq(db1.linesWritten, 4, '[١١] ترويسة + ثلاثة سجلّات');
  db1.close();
  db1 = M.openBackup({backupPath: dedupPath, now: () => t0});
  eq(db1.writeRecord(l1b), false, '[١١] بعد الاستئناف: آخر سجلّ مكتوب لا يُكرَّر');
  eq(db1.writeRecord(l1), true, '[١١] والرجوع إلى حالة أقدم يُكتب (آخر سطر للمعرّف يجب أن يطابق ما سيُحذف)');
  eq(db1.writeRecord(le), false, '[١١] وتقييم لم يتغيّر: لا تكرار');
  db1.close();
  eq(M.inspectBackupFile(dedupPath).reports.get('d1').fieldsSha256, l1.fieldsSha256, '[١١] فهرس النسخة يأخذ آخر سجلّ');

  // بنية الشيفرة: لا حذف في المرحلة ١، ولا كتابة في reportRaw في المرحلة ٢ — وكل مواضع .delete( في المكتبة معدودة (جدار ضدّ حذف جديد صامت)
  const stripSrc = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
  const lib = stripSrc(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'lib', 'reportRawMigration.js'), 'utf8').replace(/\r\n/g, '\n'));
  const fnBody = (name) => {
    const a = lib.indexOf(`async function ${name}(`);
    const b = lib.indexOf(`function ${name}(`);
    const start = a >= 0 ? a : b;
    if (start < 0) throw new Error(`function ${name} not found`);
    const end = lib.indexOf('\n}\n', start);
    return lib.slice(start, end + 2);
  };
  const COPY_FNS = ['copyOneReport', 'copyReportPage', 'copyOneEvaluationMove', 'copyEvaluationPage', 'runApplyCopy'];
  const DELETE_FNS = ['deleteOneReport', 'deleteOneEvaluation', 'deleteReportPage', 'deleteEvaluationPage', 'runApplyDelete'];
  for (const name of COPY_FNS) {
    const body = fnBody(name);
    ok(!/\.delete\(|FieldValue\.delete|deleteMap|assertDeletePayload|\.batch\(|recursiveDelete|bulkWriter/.test(body), `[١١] ${name} (المرحلة ١) لا حذف فيها ولا دفعات`);
    for (const m of body.matchAll(/tx\.(create|update|set|delete)\(\s*(\w+)/g)) {
      ok(m[2] === 'rawRef' && (m[1] === 'create' || m[1] === 'update'), `[١١] ${name}: كل كتابة معاملة هي create/update على rawRef (reportRaw) — وجدتُ tx.${m[1]}(${m[2]}`);
    }
    ok(/assertCopyPayload\(/.test(body) || !/tx\.(create|update)\(/.test(body), `[١١] ${name}: كل كتابة تمرّ بحارس المرحلة ١`);
  }
  for (const name of DELETE_FNS) {
    const body = fnBody(name);
    ok(!/\.create\(|\.set\(|assertCopyPayload|buildMigrationRawDocument|\.batch\(|recursiveDelete|bulkWriter|\.delete\(\)/.test(body.replace(/FieldValue\.delete\b/g, '')), `[١١] ${name} (المرحلة ٢) لا إنشاء ولا set ولا دفعات`);
    for (const m of body.matchAll(/tx\.(create|update|set|delete)\(\s*(\w+)/g)) {
      ok(m[1] === 'update' && (m[2] === 'reportRef' || m[2] === 'evalRef'), `[١١] ${name}: الكتابة الوحيدة tx.update على reportRef/evalRef (لا reportRaw) — وجدتُ tx.${m[1]}(${m[2]}`);
    }
    ok(/assertDeletePayload\(/.test(body) || !/tx\.update\(/.test(body), `[١١] ${name}: كل كتابة تمرّ بحارس المرحلة ٢`);
  }
  const deleteSites = [...lib.matchAll(/\.delete\(/g)].map((m) => {
    const before = lib.slice(0, m.index);
    const fns = [...before.matchAll(/(?:async )?function (\w+)\(/g)];
    return fns.length ? fns[fns.length - 1][1] : '(top)';
  }).sort();
  deq(deleteSites, ['deleteMap', 'isFieldDelete', 'runRestore'], '[١١] مواضع .delete( في المكتبة: deleteMap (المرحلة ٢)، وisFieldDelete (مقارنة العلامة)، وrunRestore (--restore --apply) — موضع جديد يُفشل هنا ويُراجَع');
  ok(!/\bset\(|\.add\(|\.recursiveDelete\(|bulkWriter/.test(lib.replace(/new Set\(|Set\(/g, '').replace(/\.set\(/g, '.m_set(')), '[١١] ولا set ولا add ولا recursiveDelete ولا bulkWriter على Firestore في المكتبة (Map.set لا تُعدّ)');
  ok(!/runApply\b|applyReportPage|applyEvaluationPage|newApplyCounters/.test(lib), '[١١] لا بقيّة من --apply الواحد (ينسخ ويحذف معاً)');
  console.log('تحقّق ١١: المرحلتان');

  fs.rmSync(tmp, {recursive: true, force: true});
  console.log(`\nreportRawMigration.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
