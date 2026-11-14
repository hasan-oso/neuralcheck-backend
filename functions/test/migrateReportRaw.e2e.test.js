// E2E test: migrate-report-raw على محاكي Firestore — المرحلتان (V8 نقل الخامّ، الجزء ٢، 2026-10-09 +03؛ ثم V8 قبل نشر الأمان، 2026-10-09).
// الشيفرة الحقيقية كلّها (functions/scripts/lib/reportRawMigration.js وmigrate-report-raw.js) على قاعدة بيانات المحاكي،
// **لا يُستبدَل منها شيء** (القاعدة 37). لا شبكة، ولا مزوّد نموذج، ولا نداء إنتاج: الحارس المشترك في أوّل الملفّ يرفض العمل إلا على محاكٍ محلّي ومشروع
// اختبار (السكربت مثبَّت على مشروع الإنتاج، فلا حماية لنا إلا ذلك الحارس).
//
// قرارا المستخدم، بنصّهما:
//   «--apply بمرحلتين: نعم. المرحلة الأولى تنسخ إلى reportRaw ولا تحذف، ثم تحقّق بالأداة، ثم المرحلة الثانية تحذف الحقول من التقرير، بكتلة منفصلة وأمر صريح منّي.»
//   «يكفي أمري الصريح بكتلة --apply منفصلة، مع النسخة الاحتياطية JSONL التي يثبّتها السكربت على القرص قبل أيّ حذف. وتُثبت الكتلة أن ملفّ النسخة موجود وغير فارغ قبل خطوة الحذف، وإلا تتوقّف.»
//
// ما يثبته (القاعدة 23: استُبدلت اختبارات --apply الواحد — ينسخ ويحذف في دفعة ذرّية — بما يلي، لا زيادة عليها):
//   ١. --dry-run: أعداد صحيحة بالمرحلتين، ولا يتغيّر في المحاكي شيء (الحالة قبل = بعد، حتى updateTime).
//   ٢. المرحلة ١ (--apply --phase copy): مستند الخامّ حرفي بأنواعه (Timestamp/NaN/-0/Bytes)، **والتقارير كما هي بكل حقولها** (لا حذف)؛ مسجِّل كتابات
//      على db الحقيقي يثبت: كل كتابة create على reportRaw وحدها وصفر حذف؛ والنسخة الاحتياطية تسبق كل نسخ لتقرير (سطره في الملفّ لحظة إنشاء خامّه).
//   ٣. إعادة المرحلة ١: بلا كتابة واحدة، ولا سطر نسخة مكرَّر.
//   ٤. --verify-copy: مقارنة بالبايت تعدّ المطابق والمختلف والغائب؛ ويلتقط المختلف والغائب وسطر النسخة المفقود/المختلف؛ بلا كتابة؛ ومخرَجه خطّة المرحلة ٢.
//   ٥. المرحلة ٢ (--apply --phase delete): تحذف الحقول بعد التحقّق وحدها؛ مسجِّل الكتابات: كل كتابة update بعلامات حذف على reports/evaluations، وصفر كتابة في reportRaw؛
//      reportRaw وملفّ النسخة لا يتغيّران؛ و--verify بعدها 0 باقياً.
//   ٦. المرحلة ٢ ترفض ولا تحذف: ملفّ نسخة غائب/فارغ/بأسطر لا تساوي الخطّة/بتجزئة مختلفة، وخامّ مختلف أو غائب بعد --verify-copy، وتقرير جديد، وسطر نسخة بتجزئة
//      مختلفة، وخامّ يتغيّر أثناء الحذف نفسه (المعاملة تعيد التحقّق وتتوقّف ولا تكتب فوقه).
//   ٧. HALF وتعارض reportRaw قائم والمالك يعدّل في الأثناء وعتبة الحجم وقيمة غير قابلة للترميز والاستئناف وفشل الإيداع — على المرحلة ١.
//   ٨. evaluations بالمرحلتين: النقل في ١ بلا مساس بالتقييم، والتنظيف في ٢.
//   ٩. --verify على الشكل الجديد: ٣ بعد المرحلة ١ (الحقول ما زالت في التقارير) و٠ بعد المرحلة ٢.
//  ١٠. --restore: بعد المرحلة ١ وحدها (يحذف الخامّ المنسوخ، التقارير كما هي)، وبعد المرحلتين (يعيد الحقول ثم يحذف الخامّ).
//  ١١. سطر الأوامر الحقيقي (عملية فرعية): المراحل ورموز الخروج وحجب ما يُحجَب قبل أيّ اتصال.
//
// Run:
//   JAVA_HOME="<jdk21>" firebase emulators:exec --only firestore --project demo-nc \
//     "node functions/test/migrateReportRaw.e2e.test.js"

require('./lib/emulatorOnlyGuard'); // أوّل require: لا يعمل إلا على محاكٍ محلّي ومشروع اختبار (يخرج برمز 2 قبل أيّ نداء)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const HOST = process.env.FIRESTORE_EMULATOR_HOST; // مضمون محلّي بالحارس أعلاه (السكربت مثبَّت على مشروع الإنتاج، فلا حماية إلا هذا)

const admin = require('firebase-admin');
const {Timestamp, FieldValue} = require('firebase-admin/firestore');
const {Transaction, WriteBatch, DocumentReference, CollectionReference} = require('@google-cloud/firestore');
const M = require('../scripts/lib/reportRawMigration');
const {PROJECT_ID} = require('../scripts/audit-device-profiles-readonly');
const {REPORT_RAW_FIELDS, REPORT_RAW_SOURCE, REPORT_RAW_MAX_BYTES, measureReportRawBytes, RAW_STATE, readReportRaw} = require('../src/analysis/reportRawStore');
const {loadLegacyEmbeddedV7Report} = require('./lib/legacyEmbeddedReport');

const app = admin.initializeApp({projectId: PROJECT_ID}, 'e2e-migrate-report-raw');
const db = app.firestore();

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const same = (a, b, m) => { assert.ok(M.valuesEqual(a, b), `${m} — القيمتان تختلفان`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const rejectsWith = async (promise, re, m) => {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err && re.test(err.message), `${m} — ${err && err.message}`);
  n++;
};

const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-report-raw.js');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const readable = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'v7-reports-document-sample.json'), 'utf8'));
const legacy = loadLegacyEmbeddedV7Report();
const TARGET = `EMULATOR ${HOST}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rrm-e2e-'));
const now = () => new Date('2026-10-09T12:00:00Z');

async function reset() {
  const res = await fetch(`http://${HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {method: 'DELETE'});
  assert.ok(res.ok, 'تعذّر تفريغ المحاكي');
}

async function dump() {
  const out = {};
  for (const col of ['reports', 'reportRaw', 'evaluations']) {
    const snap = await db.collection(col).get();
    for (const d of snap.docs) out[`${col}/${d.id}`] = {data: d.data(), updateTime: d.updateTime.toMillis()};
  }
  return out;
}
const sameDump = (a, b) => Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((k) => b[k] && a[k].updateTime === b[k].updateTime && M.valuesEqual(a[k].data, b[k].data));
const dumpOf = (d, col) => Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith(`${col}/`)));

// ─── مسجِّل الكتابات: يرقّع أصناف عميل Firestore نفسها (Transaction وWriteBatch وDocumentReference.set/update/delete/create وCollectionReference.add)
// فيرى كل كتابة أياً كان طريقها إلى الخادم؛ الاستدعاء المتداخل (DocumentReference.set ينشئ WriteBatch داخلياً) يُسجَّل مرّة واحدة.
function installWriteRecorder() {
  const log = [];
  const undo = [];
  const listeners = [];
  let on = false;
  let depth = 0;
  const record = (op, ref, data, via) => {
    const entry = {
      via, op,
      collection: via === 'collection' ? ref.id : (ref && ref.parent ? ref.parent.id : null),
      id: via === 'collection' ? null : (ref ? ref.id : null),
      fields: data && typeof data === 'object' ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, M.isFieldDelete(v, FieldValue) ? 'delete' : 'value'])) : null,
    };
    log.push(entry);
    for (const l of listeners) l(entry);
  };
  const wrap = (proto, name, via) => {
    const orig = proto[name];
    proto[name] = function (...args) {
      if (!on || depth > 0) return orig.apply(this, args);
      if (via === 'doc') record(name, this, name === 'delete' ? null : args[0], via);
      else if (via === 'collection') record(name, this, args[0], via);
      else record(name, args[0], name === 'delete' ? null : args[1], via);
      depth++;
      try { return orig.apply(this, args); } finally { depth--; }
    };
    undo.push(() => { proto[name] = orig; });
  };
  for (const name of ['create', 'set', 'update', 'delete']) {
    wrap(Transaction.prototype, name, 'tx');
    wrap(WriteBatch.prototype, name, 'batch');
    wrap(DocumentReference.prototype, name, 'doc');
  }
  wrap(CollectionReference.prototype, 'add', 'collection');
  return {
    start() { log.length = 0; on = true; },
    stop() { on = false; return log.slice(); },
    onWrite(fn) { listeners.push(fn); },
    clearListeners() { listeners.length = 0; },
    uninstall() { for (const u of undo) u(); },
  };
}
const recorder = installWriteRecorder();
async function recorded(fn) {
  recorder.start();
  try {
    const result = await fn();
    return {result, writes: recorder.stop()};
  } catch (e) {
    recorder.stop();
    throw e;
  } finally {
    recorder.clearListeners();
  }
}
const deletesAnything = (writes) => writes.some((w) => w.op === 'delete' || Object.values(w.fields || {}).includes('delete'));

// تقرير بالشكل القديم (خامّ مضمَّن). معرّفاته فريدة لكلّ تقرير كي يُكشف أيّ خلط.
function legacyReport(id, over = {}) {
  return {
    ...legacy,
    userId: `user-${id}`, price: 1000, currency: 'USD', sellerNote: `note-${id}`,
    sessionId: over.sessionId !== undefined ? over.sessionId : null,
    deviceFingerprintSha: `sha-${id}`,
    timeSeriesStoragePath: `timeSeries/${id}.json.gz`,
    ...over,
  };
}
const seedReport = (id, data) => db.collection('reports').doc(id).set(data);
const seedRaw = (id, data) => db.collection('reportRaw').doc(id).set(data);
const seedEval = (id, data) => db.collection('evaluations').doc(id).set(data);
const readReport = async (id) => (await db.collection('reports').doc(id).get()).data();
const readRaw = async (id) => { const s = await db.collection('reportRaw').doc(id).get(); return s.exists ? s.data() : null; };
const readEval = async (id) => (await db.collection('evaluations').doc(id).get()).data();
const movedOf = (d) => Object.fromEntries(REPORT_RAW_FIELDS.filter((f) => f in d).map((f) => [f, d[f]]));
const withoutMoved = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !REPORT_RAW_FIELDS.includes(k)));
const hasAnyMoved = (d) => REPORT_RAW_FIELDS.some((f) => f in d);
const identifierValues = (reports) => reports.flatMap((r) => [r.deviceFingerprintSha, r.timeSeriesStoragePath, r.sessionId].filter((v) => typeof v === 'string'));
const EVAL_IDS = ['sessionId', 'deviceFingerprintSha', 'timeSeriesStoragePath'];

const dryRun = (extra = {}) => M.runDryRun({db, target: TARGET, now, pageSize: 2, concurrency: 3, ...extra});
const verify = () => M.runVerify({db, target: TARGET, now, pageSize: 2, concurrency: 3});
const planFileFrom = (summary, name = 'plan.json') => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(summary));
  return p;
};
const copyPhase = async (backupName, plan, extra = {}) => {
  const backupPath = path.join(tmp, backupName);
  return {backupPath, ...(await M.runApplyCopy({
    db: extra.db || db, target: TARGET, now, backupPath, plan, pageSize: 2, concurrency: 3, pauseMs: 0, log: extra.log || (() => {}),
  }))};
};
const verifyCopy = (backupPath) => M.runVerifyCopy({db, target: TARGET, now, backupPath, pageSize: 2, concurrency: 3});
const deletePhase = (backupPath, vcSummary, planName, extra = {}) => M.runApplyDelete({
  db: extra.db || db, target: TARGET, now, backupPath, plan: M.loadPlan(planFileFrom(vcSummary, planName), 'verify-copy'),
  pageSize: 2, concurrency: 3, pauseMs: 0, log: extra.log || (() => {}),
});
const cli = (args, env = {}) => spawnSync(process.execPath, [SCRIPT, ...args], {
  env: {...process.env, ...env}, encoding: 'utf8', cwd: path.join(__dirname, '..'),
});

// db يُنفّذ خطّافاً قبل كلّ معاملة (محاكاة: المالك يعدّل، أو الخامّ يتغيّر، أو العملية تُقتل) — الشيفرة الحقيقية خلفه كما هي.
function withTxHook(realDb, hook) {
  let calls = 0;
  return new Proxy(realDb, {
    get(target, prop) {
      if (prop === 'runTransaction') {
        return async (fn, opts) => { calls++; await hook(calls); return target.runTransaction(fn, opts); };
      }
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

// المرحلة ١ ← --verify-copy على مشهد مزروع: يُرجع ما يلزم المراحل اللاحقة
async function copyAndVerify(label) {
  const d = await dryRun();
  const plan = M.loadPlan(planFileFrom(d.summary, `plan-${label}.json`));
  const c = await copyPhase(`backup-${label}.jsonl`, plan);
  const vc = await verifyCopy(c.backupPath);
  return {d, plan, c, vc, backupPath: c.backupPath};
}

(async () => {
  // ═══════════════════════════════════════════════════════════════════
  // بذور المشهد الأساسي (٧ تقارير)
  // ═══════════════════════════════════════════════════════════════════
  async function seedBase() {
    await reset();
    // R1 معروض · R2 مُباع · R3 غير معروض · R4 V6 (grade/score، بلا pipeline/aiAudit) · R5 بلا أيّ من الخمسة (NO_RAW)
    // R6 معروض بمعرّفات خامّ قبل التجزئة · R7 بنوع Timestamp/NaN/-0/Bytes داخل الخامّ.
    await seedReport('r1', legacyReport('r1', {listingStatus: 'for_sale', sessionId: 'sess-r1'}));
    await seedReport('r2', legacyReport('r2', {listingStatus: 'sold'}));
    await seedReport('r3', legacyReport('r3', {listingStatus: 'draft'}));
    const v6 = legacyReport('r4', {grade: 'B', score: 71});
    delete v6.pipeline; delete v6.aiAudit;
    await seedReport('r4', v6);
    await seedReport('r5', {...readable, userId: 'user-r5'});
    const raw = legacyReport('r6', {listingStatus: 'for_sale'});
    raw.rawFingerprint = JSON.parse(JSON.stringify(raw.rawFingerprint));
    raw.rawFingerprint.device = {model: 'Test Phone', deviceProfileKey: {a: 'a'.repeat(64), c: 'firebase-installation-id-raw', d: '9774d56d682e549c'}};
    await seedReport('r6', raw);
    const typed = legacyReport('r7');
    typed.rawFingerprint = JSON.parse(JSON.stringify(typed.rawFingerprint));
    typed.rawFingerprint.typed = {ts: new Timestamp(1700000000, 123456000), nan: NaN, negZero: -0, bytes: Buffer.from([0, 1, 254, 255]), nested: [{a: [1, 2]}]};
    await seedReport('r7', typed);
  }
  const BASE_IDS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
  const MIGRATING = ['r1', 'r2', 'r3', 'r4', 'r6', 'r7'];

  // ═══════════════════════════════════════════════════════════════════
  // ١ — --dry-run: أعداد صحيحة، ولا يتغيّر في المحاكي شيء
  // ═══════════════════════════════════════════════════════════════════
  await seedBase();
  const before1 = await dump();
  const {result: d1, writes: w1} = await recorded(() => dryRun());
  const after1 = await dump();
  ok(sameDump(before1, after1), '[١] --dry-run لا يغيّر في المحاكي شيئاً (محتوى وupdateTime لكلّ مستند)');
  eq(w1.length, 0, '[١] والمسجِّل لم يرَ أيّ كتابة');
  const s1 = d1.summary;
  eq(s1.projectId, PROJECT_ID, '[١] projectId أوّل حقل ومثبَّت');
  eq(Object.keys(s1)[0], 'projectId', '[١] projectId أوّل مفتاح في الخلاصة');
  eq(s1.target, TARGET, '[١] الهدف مطبوع (المحاكي)');
  eq(s1.mode, 'dry-run', '[١] الوضع');
  eq(s1.reports.total, 7, '[١] عدد التقارير');
  eq(s1.reports.exposed, 3, '[١] المعروض والمُباع (r1 وr2 وr6)');
  eq(s1.reports.byState.MIGRATE, 6, '[١] MIGRATE = 6');
  eq(s1.reports.byState.NO_RAW, 1, '[١] NO_RAW = 1 (r5: يُعدّ ولا يُكتب له شيء)');
  eq(s1.reports.byState.DONE + s1.reports.byState.HALF + s1.reports.byState.CONFLICT, 0, '[١] لا DONE ولا HALF ولا CONFLICT');
  eq(s1.reports.exposedByState.MIGRATE, 3, '[١] المعروض كلّه MIGRATE');
  eq(s1.reports.withMovedFields, 6, '[١] الحاملة لحقل من الخمسة = 6');
  eq(s1.reports.exposedWithMovedFields, 3, '[١] المعروض الحامل = 3');
  eq(s1.reports.perField.rawFingerprint.present, 6, '[١] rawFingerprint حاضر في 6');
  eq(s1.reports.perField.rawFingerprint.absent, 1, '[١] وغائب في 1');
  eq(s1.reports.perField.sessionId.nonNull, 1, '[١] sessionId غير null في 1 (r1)');
  eq(s1.reports.perField.sessionId.nullValue, 5, '[١] sessionId null في 5 (null صريح حاضر)');
  eq(s1.reports.perField.aiAudit.absent, 2, '[١] aiAudit غائب في r4 (V6) وr5');
  eq(s1.reports.legacyRawLayerIdentifiersHeuristic.reports, 1, '[١] معرّفات خامّ قبل التجزئة (استدلال): r6');
  eq(s1.reports.legacyRawLayerIdentifiersHeuristic.exposedReports, 1, '[١] منها معروض: 1');
  eq(s1.reports.tooLargeForRaw, 0, '[١] لا شيء فوق عتبة الحجم');
  ok(s1.reports.movedBytes.max > 0 && s1.reports.movedBytes.measuredFor === 6, '[١] حجم الخامّ مقيس لـ6 تقارير');
  eq(s1.reportRaw.total, 0, '[١] reportRaw فارغ قبل الترحيل');
  eq(s1.wouldWrite.reportRawDocumentsToCreate, 6, '[١] سيُنشأ 6 مستندات خامّ');
  eq(s1.wouldWrite.reportsNoRawNothingWritten, 1, '[١] وواحد بلا خامّ لا يُكتب له شيء');
  eq(s1.wouldWrite.phases.copy.reportRawDocumentsToCreate, 6, '[١] المرحلة ١: 6 مستندات خامّ');
  eq(s1.wouldWrite.phases.copy.deletes, 0, '[١] والمرحلة ١ صفر حذف');
  eq(s1.wouldWrite.phases.copy.backupRecords.reports, 6, '[١] ونسخة لـ6 تقارير');
  eq(s1.wouldWrite.phases.delete.reportsToCleanFromMovedFields, 6, '[١] والمرحلة ٢: تنظيف 6 تقارير');
  eq(d1.exitCode, M.EXIT.OK, '[١] رمز الخروج 0');
  const out1 = JSON.stringify(s1);
  const seededIdentifiers = identifierValues([await readReport('r1'), await readReport('r2'), await readReport('r3'), await readReport('r4'), await readReport('r6'), await readReport('r7')]);
  ok(seededIdentifiers.length >= 10 && seededIdentifiers.every((v) => !out1.includes(v)), '[١] الخلاصة لا تحمل أيّ قيمة معرّف خامّ (القاعدة 36)');
  ok(!out1.includes('firebase-installation-id-raw') && !out1.includes('9774d56d682e549c'), '[١] ولا المعرّفات الخامّ قبل التجزئة');
  ok(!/"r[1-7]"/.test(out1.replace(/"(total|exposed)"/g, '')), '[١] معرّفات المستندات لا تظهر خاماً (مهشَّرة فقط)');
  console.log('تحقّق ١: --dry-run');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — المرحلة ١: النسخ ولا حذف
  // ═══════════════════════════════════════════════════════════════════
  const originals = {};
  for (const id of BASE_IDS) originals[id] = await readReport(id);
  const planPath = planFileFrom(s1);
  const plan = M.loadPlan(planPath);
  const copyLog = [];
  const backupMainPath = path.join(tmp, 'backup-main.jsonl');
  const backupBeforeCopy = [];
  recorder.onWrite((w) => {
    if (w.collection === 'reportRaw' && w.op === 'create') backupBeforeCopy.push({id: w.id, covered: M.inspectBackupFile(backupMainPath).reports.has(w.id)});
  });
  const {result: a2, writes: w2} = await recorded(() => copyPhase('backup-main.jsonl', plan, {log: (m) => copyLog.push(m)}));
  const s2 = a2.summary;
  eq(a2.exitCode, M.EXIT.OK, '[٢] المرحلة ١: رمز الخروج 0');
  eq(s2.mode, 'apply-copy', '[٢] الوضع apply-copy');
  ok(s2.planCheck.ok, '[٢] الخطّة مطابقة');
  eq(s2.copied.reportsCopied, 6, '[٢] نُسخ 6 تقارير');
  eq(s2.copied.reportsNoRaw, 1, '[٢] r5 عُدّ ولم يُكتب له شيء');
  eq(s2.copied.reportsFailed + s2.copied.readbackMismatches, 0, '[٢] لا فشل ولا مخالفة مقارنة');
  eq(s2.before.reports.byState.MIGRATE, 6, '[٢] أعداد قبل: MIGRATE 6');
  eq(s2.after.reports.byState.MIGRATE, 0, '[٢] أعداد بعد: MIGRATE 0');
  eq(s2.after.reports.byState.HALF, 6, '[٢] بعد: HALF 6 (الخامّ منسوخ والحقول ما زالت في التقارير — لم يُحذف شيء)');
  eq(s2.after.reports.withMovedFields, 6, '[٢] بعد: الحقول ما زالت في 6 تقارير (المرحلة ١ لا تحذف)');
  eq(s2.after.reportRaw.total, 6, '[٢] بعد: 6 مستندات في reportRaw');
  eq(s2.after.reportRaw.bySource.migration, 6, '[٢] كلّها source=migration');
  const phases = copyLog.filter((l) => /^\[copy\] reports /.test(l)).map((l) => l.split(' ')[2]);
  eq(phases[0], 'exposed', '[٢] المعروض والمُباع أوّلاً (قرار المستخدم ١٠)');
  ok(phases.indexOf('rest') > phases.lastIndexOf('exposed'), '[٢] ثم البقيّة بعد انتهاء المعروض كلّه');
  // المسجِّل: المرحلة ١ لا تحذف ولا تكتب إلا في reportRaw
  eq(w2.filter((w) => w.op === 'create' && w.collection === 'reportRaw').length, 6, '[٢] المسجِّل: ست كتابات create على reportRaw');
  ok(w2.every((w) => w.collection === 'reportRaw' && w.op === 'create'), '[٢] المسجِّل: كل كتابة في المرحلة ١ هي create على reportRaw وحده (لا reports ولا evaluations ولا update)');
  ok(!deletesAnything(w2), '[٢] المسجِّل: صفر حذف (لا delete ولا FieldValue.delete) في المرحلة ١');
  eq(backupBeforeCopy.length, 6, '[٢] رأى المسجِّل ست عمليات إنشاء خامّ');
  ok(backupBeforeCopy.every((b) => b.covered), '[٢] النسخة تسبق كل نسخ: سطر كل تقرير في ملفّ النسخة لحظة إنشاء خامّه');
  // التقارير كما كانت بكل حقولها
  for (const id of BASE_IDS) same(await readReport(id), originals[id], `[٢] ${id}: التقرير لم يتغيّر بعد المرحلة ١ (بحقوله الخمسة)`);
  for (const id of MIGRATING) {
    const orig = originals[id];
    const raw = await readRaw(id);
    ok(raw !== null, `[٢] ${id}: مستند الخامّ موجود`);
    eq(raw.source, REPORT_RAW_SOURCE.MIGRATION, `[٢] ${id}: source=migration`);
    eq(raw.scanId, id, `[٢] ${id}: scanId = معرّف التقرير`);
    ok(raw.createdAt instanceof Timestamp, `[٢] ${id}: createdAt وقت الخادم`);
    ok(!('userId' in raw), `[٢] ${id}: بلا userId (الخادم وحده يقرؤه)`);
    for (const f of REPORT_RAW_FIELDS) {
      eq(f in raw, f in orig, `[٢] ${id}.${f}: الحضور في الخامّ = حضوره في الأصل (لا حقل مختلَق ولا مفقود)`);
      if (f in orig) same(raw[f], orig[f], `[٢] ${id}.${f}: القيمة حرفية بنوعها`);
    }
  }
  eq(await readRaw('r5'), null, '[٢] r5: لم يُنشأ له مستند خامّ فارغ');
  const r7raw = await readRaw('r7');
  ok(r7raw.rawFingerprint.typed.ts instanceof Timestamp && r7raw.rawFingerprint.typed.ts.nanoseconds === 123456000, '[٢] Timestamp بقي Timestamp بنانوثانيته داخل الخامّ');
  ok(Number.isNaN(r7raw.rawFingerprint.typed.nan) && Object.is(r7raw.rawFingerprint.typed.negZero, -0) && Buffer.from(r7raw.rawFingerprint.typed.bytes).equals(Buffer.from([0, 1, 254, 255])),
      '[٢] NaN و-0 وBytes بقيت');
  eq((await readRaw('r6')).rawFingerprint.device.deviceProfileKey.c, 'firebase-installation-id-raw', '[٢] المعرّف الخامّ قبل التجزئة يُنقل حرفياً (القاعدة 20: لا تعديل للخامّ في الترحيل)');
  eq('aiAudit' in (await readRaw('r4')), false, '[٢] r4 (V6): لا aiAudit مختلَق');

  // النسخة الاحتياطية
  const backupLines = M.readBackupLines(a2.backupPath);
  eq(backupLines[0].kind, 'header', '[٢] النسخة: ترويسة');
  const reportLines = backupLines.filter((l) => l.kind === 'report');
  eq(reportLines.length, 6, '[٢] النسخة: سطر لكلّ تقرير نُسخ');
  eq(new Set(reportLines.map((l) => l.scanId)).size, 6, '[٢] بلا تكرار');
  ok(!reportLines.some((l) => l.scanId === 'r5'), '[٢] r5 (NO_RAW) ليس في النسخة');
  const ctx = {Timestamp, GeoPoint: require('firebase-admin/firestore').GeoPoint, doc: (p) => db.doc(p)};
  for (const l of reportLines) {
    for (const f of Object.keys(l.fields)) same(M.decodeValue(l.fields[f], ctx), originals[l.scanId][f], `[٢] النسخة ${l.scanId}.${f}: تُفكّ إلى القيمة الأصلية`);
    eq(Object.keys(l.fields).sort().join(','), REPORT_RAW_FIELDS.filter((f) => f in originals[l.scanId]).sort().join(','), `[٢] النسخة ${l.scanId}: الحقول المنسوخة = الحاضرة في الأصل`);
  }
  eq(reportLines.find((l) => l.scanId === 'r1').listingStatus, 'for_sale', '[٢] النسخة تحمل listingStatus');
  eq(s2.backup.resumed, false, '[٢] نسخة جديدة');
  eq(s2.backup.totalLines, 7, '[٢] ملخّص النسخة: 7 أسطر (ترويسة + 6) في الملفّ');
  eq(s2.backup.reportRecords, 6, '[٢] وستّ سجلّات تقارير');
  eq(s2.backup.sha256, M.inspectBackupFile(a2.backupPath).sha256, '[٢] وتجزئة الملفّ');
  const out2 = JSON.stringify(s2);
  ok(seededIdentifiers.every((v) => !out2.includes(v)), '[٢] خلاصة المرحلة ١ لا تحمل قيمة معرّف خامّ');
  ok(!out2.includes('firebase-installation-id-raw'), '[٢] ولا المعرّف الخامّ قبل التجزئة');
  console.log('تحقّق ٢: المرحلة ١');

  // ═══════════════════════════════════════════════════════════════════
  // ٣ — إعادة المرحلة ١: لا أثر مضاعف، ولا كتابة
  // ═══════════════════════════════════════════════════════════════════
  const beforeRerun = await dump();
  const {result: a3, writes: w3} = await recorded(() => copyPhase('backup-main.jsonl', plan));
  const afterRerun = await dump();
  eq(a3.exitCode, M.EXIT.OK, '[٣] الإعادة: رمز الخروج 0');
  ok(sameDump(beforeRerun, afterRerun), '[٣] الإعادة لا تغيّر مستنداً واحداً (محتوى وupdateTime) — لا أثر مضاعف');
  eq(w3.length, 0, '[٣] والمسجِّل: صفر كتابة في الإعادة');
  eq(a3.summary.copied.reportsCopied, 0, '[٣] لا شيء نُسخ ثانيةً');
  eq(a3.summary.copied.reportsAlreadyCopied, 6, '[٣] 6 تقارير منسوخة سابقاً تُعدّ ولا تُكتب');
  eq(a3.summary.copied.backupLinesReports, 0, '[٣] ولا سطر نسخة مكرَّر (آخر سجلّ لكل معرّف بتجزئته نفسها)');
  eq(a3.summary.backup.resumed, true, '[٣] وفُتح الملفّ نفسه استئنافاً');
  console.log('تحقّق ٣: إعادة المرحلة ١');

  // ═══════════════════════════════════════════════════════════════════
  // ٤ — --verify-copy: مقارنة بالبايت، قراءة بحتة
  // ═══════════════════════════════════════════════════════════════════
  const stateBeforeVc = await dump();
  const {result: vc4, writes: wv4} = await recorded(() => verifyCopy(a2.backupPath));
  ok(sameDump(stateBeforeVc, await dump()) && wv4.length === 0, '[٤] --verify-copy لا يكتب شيئاً (المحاكي كما هو، والمسجِّل صفر)');
  const sv = vc4.summary;
  eq(sv.mode, 'verify-copy', '[٤] الوضع');
  eq(sv.reports.byteCompare.MATCH, 6, '[٤] 6 تقارير مطابقة بالبايت');
  eq(sv.reports.byteCompare.DIFFER + sv.reports.byteCompare.ABSENT, 0, '[٤] لا مختلف ولا غائب');
  eq(sv.reports.withoutMovedFields, 1, '[٤] وr5 بلا حقل منقول (لا يُقارَن)');
  eq(sv.reports.noBackupLine + sv.reports.backupLineMismatch, 0, '[٤] وكل تقرير مطابق له سطر نسخة بتجزئته');
  eq(sv.backup.provided, true, '[٤] ملفّ النسخة مُقدَّم');
  eq(sv.backup.totalLines, 8, '[٤] وعدد أسطره في الخلاصة (ترويسة + 6 + سطر استئناف كتبته إعادة المرحلة ١ في ٣)');
  eq(sv.expected.reportRecords, 6, '[٤] expected.reportRecords = 6');
  deepEq(sv.blockers, [], '[٤] بلا موانع');
  eq(sv.ready, true, '[٤] ready');
  eq(vc4.exitCode, M.EXIT.OK, '[٤] رمز الخروج 0');
  ok(M.loadPlan(planFileFrom(sv, 'plan-vc-ok.json'), 'verify-copy').ready === true, '[٤] والمخرَج يُقبل خطّةً للمرحلة ٢');
  ok(seededIdentifiers.every((v) => !JSON.stringify(sv).includes(v)), '[٤] والخلاصة بلا معرّف خامّ');
  const vcNoBackup = await M.runVerifyCopy({db, target: TARGET, now, pageSize: 2, concurrency: 3});
  eq(vcNoBackup.summary.ready, false, '[٤] بلا --backup: ليس ready (النسخة شرط)');
  ok(vcNoBackup.summary.blockers.includes('BACKUP_NOT_PROVIDED'), '[٤] والمانع مسمّى BACKUP_NOT_PROVIDED');
  eq(vcNoBackup.exitCode, M.EXIT.STOPPED, '[٤] ورمز الخروج 2');
  throwsLoad(() => M.loadPlan(planFileFrom(vcNoBackup.summary, 'plan-vc-nobackup.json'), 'verify-copy'), /PLAN_NOT_READY/, '[٤] ولا يُقبل خطّةً للمرحلة ٢');
  function throwsLoad(fn, re, m) { let e = null; try { fn(); } catch (x) { e = x; } assert.ok(e && re.test(e.message), `${m} — ${e && e.message}`); n++; }

  // التقاط المختلف والغائب وسطر النسخة المفقود/المختلف (كل حالة على نسخة طازجة من المشهد)
  async function freshCopied(label) {
    await seedBase();
    return copyAndVerify(label);
  }
  {
    const f = await freshCopied('vc-differ');
    await db.collection('reportRaw').doc('r1').update({deviceFingerprintSha: 'tampered-in-raw'});
    const v = (await verifyCopy(f.backupPath)).summary;
    eq(v.reports.byteCompare.DIFFER, 1, '[٤] خامّ عُدّل: DIFFER = 1');
    deepEq(v.reports.differExamplesHashed[0].fields, ['deviceFingerprintSha'], '[٤] ويُسمّى الحقل المختلف');
    eq(v.reports.byteCompare.MATCH, 5, '[٤] والباقي 5 مطابق');
    eq(v.ready, false, '[٤] ليس ready');
    ok(v.blockers.some((b) => /DIFFER=1/.test(b)), '[٤] والمانع DIFFER');
    ok(!JSON.stringify(v).includes('tampered-in-raw'), '[٤] ولا قيمة في الخلاصة');
  }
  {
    const f = await freshCopied('vc-absent');
    await db.collection('reportRaw').doc('r3').delete();
    const v = (await verifyCopy(f.backupPath)).summary;
    eq(v.reports.byteCompare.ABSENT, 1, '[٤] خامّ محذوف: ABSENT = 1');
    eq(v.ready, false, '[٤] ليس ready');
  }
  {
    const f = await freshCopied('vc-reportchanged');
    // التقرير والخامّ يتغيّران معاً بعد النسخة الاحتياطية: يتطابقان بالبايت لكن النسخة تحمل القديم — لا حذف بلا نسخة تطابق ما يُحذف
    await db.collection('reports').doc('r2').update({deviceFingerprintSha: 'changed-after-backup'});
    await db.collection('reportRaw').doc('r2').update({deviceFingerprintSha: 'changed-after-backup'});
    const v = (await verifyCopy(f.backupPath)).summary;
    eq(v.reports.byteCompare.MATCH, 6, '[٤] مطابق بالبايت');
    eq(v.reports.backupLineMismatch, 1, '[٤] لكن سطر النسخة بتجزئة مختلفة = 1');
    eq(v.ready, false, '[٤] ليس ready');
  }
  {
    const f = await freshCopied('vc-nobackupline');
    const lines = fs.readFileSync(f.backupPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const kept = lines.filter((l) => !(l.includes('"scanId":"r4"')));
    ok(kept.length === lines.length - 1, '[٤] حُذف سطر r4 من نسخة الاختبار (ملفّ اختباري في مجلّد مؤقّت)');
    fs.writeFileSync(f.backupPath, `${kept.join('\n')}\n`);
    const v = (await verifyCopy(f.backupPath)).summary;
    eq(v.reports.noBackupLine, 1, '[٤] تقرير بلا سطر نسخة = 1');
    eq(v.ready, false, '[٤] ليس ready');
  }
  {
    await seedBase();
    const vBefore = (await verifyCopy(null)).summary;
    eq(vBefore.reports.byteCompare.ABSENT, 6, '[٤] قبل المرحلة ١: كل الحاملة ABSENT (6)');
    eq(vBefore.ready, false, '[٤] ليس ready');
  }
  console.log('تحقّق ٤: --verify-copy');

  // ═══════════════════════════════════════════════════════════════════
  // ٥ — المرحلة ٢: الحذف بعد التحقّق
  // ═══════════════════════════════════════════════════════════════════
  await seedBase();
  const f5 = await copyAndVerify('phase2');
  eq(f5.vc.summary.ready, true, '[٥] تمهيد: المرحلة ١ ثم --verify-copy: ready');
  const rawDumpBefore2 = dumpOf(await dump(), 'reportRaw');
  const backupShaBefore = M.inspectBackupFile(f5.backupPath).sha256;
  const delLog = [];
  const {result: p2, writes: wp2} = await recorded(() => deletePhase(f5.backupPath, f5.vc.summary, 'plan-p2.json', {log: (m) => delLog.push(m)}));
  eq(p2.exitCode, M.EXIT.OK, '[٥] المرحلة ٢: رمز الخروج 0');
  eq(p2.summary.mode, 'apply-delete', '[٥] الوضع apply-delete');
  eq(p2.summary.deleted.reportsDeleted, 6, '[٥] حُذفت حقول 6 تقارير');
  eq(p2.summary.deleted.reportsBlockedAbsent + p2.summary.deleted.reportsBlockedDiffer + p2.summary.deleted.reportsBlockedNoBackupLine + p2.summary.deleted.reportsBlockedBackupMismatch, 0, '[٥] لا مانع أثناء الحذف');
  eq(p2.summary.after.reports.withMovedFields, 0, '[٥] بعد: 0 باقياً في reports');
  eq(p2.summary.after.reports.exposedWithMovedFields, 0, '[٥] بعد: 0 باقياً في المعروض');
  eq(p2.summary.after.reportRaw.total, 6, '[٥] وreportRaw ما زال 6');
  eq(p2.summary.backup.unchanged, true, '[٥] ملفّ النسخة لم يتغيّر (تجزئته بعد = قبل)');
  eq(p2.summary.backup.sha256Before, backupShaBefore, '[٥] وتجزئته قبل هي تجزئة الملفّ الذي جرى عليه --verify-copy');
  const delPhases = delLog.filter((l) => /^\[delete\] reports /.test(l)).map((l) => l.split(' ')[2]);
  eq(delPhases[0], 'exposed', '[٥] المعروض أوّلاً في الحذف أيضاً');
  for (const id of MIGRATING) {
    const rep = await readReport(id);
    same(rep, withoutMoved(originals[id]), `[٥] ${id}: خرجت الخمسة وبقي كل ما عداها (price/userId/listingStatus/aiResponse...)`);
    ok(!hasAnyMoved(rep), `[٥] ${id}: لا مفتاح من الخمسة في التقرير`);
  }
  same(await readReport('r5'), originals.r5, '[٥] r5 (NO_RAW) لم يُلمَس');
  ok(sameDump(rawDumpBefore2, dumpOf(await dump(), 'reportRaw')), '[٥] reportRaw كما هو بعد المرحلة ٢ (محتوى وupdateTime لكل مستند)');
  // المسجِّل: المرحلة ٢ تحذف حقولاً من reports/evaluations فقط ولا تلمس reportRaw
  ok(wp2.length > 0 && wp2.every((w) => w.op === 'update' && w.collection === 'reports'), '[٥] المسجِّل: كل كتابة update على reports (لا reportRaw ولا create ولا set)');
  ok(wp2.every((w) => Object.values(w.fields).length > 0 && Object.values(w.fields).every((k) => k === 'delete')), '[٥] المسجِّل: كل حقل في كل كتابة علامة حذف (لا قيمة تُكتب)');
  ok(wp2.every((w) => Object.keys(w.fields).every((k) => REPORT_RAW_FIELDS.includes(k))), '[٥] المسجِّل: ولا حقل خارج الخمسة (لا userId ولا price)');
  eq(wp2.length, 6, '[٥] المسجِّل: ست كتابات (تقرير لكل واحدة)');
  const v5 = await verify();
  eq(v5.exitCode, M.EXIT.OK, '[٥] --verify بعد المرحلتين: رمز الخروج 0');
  eq(v5.summary.verdict.decision5Satisfied, true, '[٥] القرار ٥ محقَّق (0 باقياً)');
  eq(v5.summary.verdict.reportRawDocuments, 6, '[٥] و6 مستندات خامّ');
  // إعادة المرحلة ٢ بالخطّة القديمة: لا شيء ليُحذف، فتتوقّف بانجراف الأعداد معلَناً ولا تكتب
  const stateAfter2 = await dump();
  const {result: p2b, writes: wp2b} = await recorded(() => deletePhase(f5.backupPath, f5.vc.summary, 'plan-p2-stale.json'));
  eq(p2b.exitCode, M.EXIT.STOPPED, '[٥] إعادة المرحلة ٢ بالخطّة القديمة: رمز 2');
  eq(p2b.summary.stoppedBecause, 'PLAN_COUNTS_DRIFT_NOTHING_DELETED', '[٥] السبب مسمّى: انجراف أعداد الخطّة');
  ok(p2b.summary.drift.some((d) => /reports MATCH plan=6 now=0/.test(d)), '[٥] والانجراف يُسمّى بأرقامه');
  ok(sameDump(stateAfter2, await dump()) && wp2b.length === 0, '[٥] ولا كتابة');
  // وبخطّة جديدة (--verify-copy بعد الحذف): تعمل بلا شيء تفعله
  const vcAfter = await verifyCopy(f5.backupPath);
  eq(vcAfter.summary.ready, true, '[٥] --verify-copy بعد المرحلة ٢: ready (لا حامل ولا مانع)');
  eq(vcAfter.summary.expected.reportRecords, 0, '[٥] expected.reportRecords = 0');
  const p2c = await deletePhase(f5.backupPath, vcAfter.summary, 'plan-p2-empty.json');
  eq(p2c.exitCode, M.EXIT.OK, '[٥] المرحلة ٢ بخطّة جديدة: 0 ولا شيء يُحذف');
  eq(p2c.summary.deleted.reportsDeleted, 0, '[٥] صفر محذوف');
  console.log('تحقّق ٥: المرحلة ٢');

  // ═══════════════════════════════════════════════════════════════════
  // ٦ — المرحلة ٢ ترفض ولا تحذف
  // ═══════════════════════════════════════════════════════════════════
  async function assertNothingDeleted(label, stateBefore) {
    ok(sameDump(stateBefore, await dump()), `[٦] ${label}: لم يتغيّر مستند واحد (محتوى وupdateTime) — لا حذف`);
  }
  {
    // (أ) ملفّ النسخة غائب
    const f = await freshCopied('r-missing');
    const state = await dump();
    fs.rmSync(f.backupPath);
    const plan2 = M.loadPlan(planFileFrom(f.vc.summary, 'plan-r-missing.json'), 'verify-copy');
    const {writes} = await recorded(async () => rejectsWith(M.runApplyDelete({db, target: TARGET, now, backupPath: f.backupPath, plan: plan2, pageSize: 2, concurrency: 3, pauseMs: 0}), /BACKUP_MISSING/, '[٦] ملفّ النسخة غائب: تتوقّف بـBACKUP_MISSING'));
    eq(writes.length, 0, '[٦] ملفّ غائب: المسجِّل صفر كتابة');
    await assertNothingDeleted('ملفّ غائب', state);
  }
  {
    // (ب) ملفّ فارغ
    const f = await freshCopied('r-empty');
    const state = await dump();
    fs.writeFileSync(f.backupPath, '');
    const plan2 = M.loadPlan(planFileFrom(f.vc.summary, 'plan-r-empty.json'), 'verify-copy');
    await rejectsWith(M.runApplyDelete({db, target: TARGET, now, backupPath: f.backupPath, plan: plan2, pageSize: 2, concurrency: 3, pauseMs: 0}), /BACKUP_EMPTY/, '[٦] ملفّ النسخة فارغ: تتوقّف بـBACKUP_EMPTY');
    await assertNothingDeleted('ملفّ فارغ', state);
  }
  {
    // (ج) عدد الأسطر لا يساوي الخطّة (سطر أُلحق بعد --verify-copy)
    const f = await freshCopied('r-lines');
    const state = await dump();
    fs.appendFileSync(f.backupPath, `${JSON.stringify({v: 1, kind: 'report', scanId: 'extra', fieldsSha256: 'x', fields: {}})}\n`);
    const plan2 = M.loadPlan(planFileFrom(f.vc.summary, 'plan-r-lines.json'), 'verify-copy');
    await rejectsWith(M.runApplyDelete({db, target: TARGET, now, backupPath: f.backupPath, plan: plan2, pageSize: 2, concurrency: 3, pauseMs: 0}), /BACKUP_LINES_MISMATCH/, '[٦] أسطر النسخة لا تساوي الخطّة: تتوقّف');
    await assertNothingDeleted('أسطر لا تساوي الخطّة', state);
  }
  {
    // (د) نسخة مغايرة بالعدد نفسه (تجزئة الملفّ تفضح)
    const f = await freshCopied('r-sha');
    const state = await dump();
    const lines = fs.readFileSync(f.backupPath, 'utf8').split('\n');
    lines[2] = lines[2].replace('"v":1', '"v": 1');
    fs.writeFileSync(f.backupPath, lines.join('\n'));
    const plan2 = M.loadPlan(planFileFrom(f.vc.summary, 'plan-r-sha.json'), 'verify-copy');
    await rejectsWith(M.runApplyDelete({db, target: TARGET, now, backupPath: f.backupPath, plan: plan2, pageSize: 2, concurrency: 3, pauseMs: 0}), /BACKUP_CHANGED_SINCE_VERIFY/, '[٦] الملفّ تغيّر بعد --verify-copy بالعدد نفسه: تتوقّف');
    await assertNothingDeleted('ملفّ تغيّر', state);
  }
  {
    // (هـ) خامّ يختلف بعد --verify-copy
    const f = await freshCopied('r-differ');
    await db.collection('reportRaw').doc('r1').update({deviceFingerprintSha: 'tampered-after-verify'});
    const state = await dump();
    const {result: r, writes} = await recorded(() => deletePhase(f.backupPath, f.vc.summary, 'plan-r-differ.json'));
    eq(r.exitCode, M.EXIT.STOPPED, '[٦] خامّ اختلف بعد التحقّق: رمز 2');
    eq(r.summary.stoppedBecause, 'NOT_READY_NOTHING_DELETED', '[٦] السبب مسمّى: لا حذف');
    ok(r.summary.blockers.some((b) => /DIFFER=1/.test(b)), '[٦] والمانع DIFFER');
    eq(writes.length, 0, '[٦] والمسجِّل صفر كتابة (حتى للتقارير السليمة الخمسة)');
    await assertNothingDeleted('خامّ مختلف', state);
    eq((await readRaw('r1')).deviceFingerprintSha, 'tampered-after-verify', '[٦] وreportRaw المعدَّل لم يُكتب فوقه');
  }
  {
    // (و) خامّ محذوف بعد --verify-copy
    const f = await freshCopied('r-absent');
    await db.collection('reportRaw').doc('r4').delete();
    const state = await dump();
    const r = await deletePhase(f.backupPath, f.vc.summary, 'plan-r-absent.json');
    eq(r.summary.stoppedBecause, 'NOT_READY_NOTHING_DELETED', '[٦] خامّ غائب: لا حذف');
    ok(r.summary.blockers.some((b) => /ABSENT=1/.test(b)), '[٦] والمانع ABSENT');
    await assertNothingDeleted('خامّ غائب', state);
  }
  {
    // (ز) تقرير جديد بالشكل القديم بعد --verify-copy (لا سطر له في النسخة، ولا خامّ)
    const f = await freshCopied('r-new');
    await seedReport('late', legacyReport('late', {listingStatus: 'for_sale'}));
    const state = await dump();
    const r = await deletePhase(f.backupPath, f.vc.summary, 'plan-r-new.json');
    eq(r.exitCode, M.EXIT.STOPPED, '[٦] تقرير جديد بحقول منقولة: رمز 2');
    ok(r.summary.blockers.some((b) => /ABSENT=1/.test(b)), '[٦] يُعدّ ABSENT (لم يُنسخ)');
    await assertNothingDeleted('تقرير جديد', state);
  }
  {
    // (ح) تقرير تغيّر هو وخامّه بعد النسخة (يتطابقان بالبايت لكن النسخة تحمل القديم)
    const f = await freshCopied('r-backupmismatch');
    await db.collection('reports').doc('r2').update({deviceFingerprintSha: 'changed-after-backup'});
    await db.collection('reportRaw').doc('r2').update({deviceFingerprintSha: 'changed-after-backup'});
    const state = await dump();
    const r = await deletePhase(f.backupPath, f.vc.summary, 'plan-r-backupmismatch.json');
    eq(r.summary.stoppedBecause, 'NOT_READY_NOTHING_DELETED', '[٦] سطر النسخة بتجزئة مختلفة: لا حذف');
    ok(r.summary.blockers.some((b) => /بتجزئة مختلفة=1/.test(b)), '[٦] والمانع مسمّى');
    await assertNothingDeleted('سطر نسخة مختلف', state);
  }
  {
    // (ط) الخامّ يتغيّر أثناء الحذف نفسه (بعد المسح الأوّل): معاملة الحذف تعيد التحقّق وتتوقّف ولا تكتب فوقه
    const f = await freshCopied('r-race');
    let tampered = false;
    const racyDb = withTxHook(db, async (call) => {
      if (call === 2 && !tampered) {
        tampered = true;
        await db.collection('reportRaw').doc('r2').update({deviceFingerprintSha: 'tampered-mid-delete'});
      }
    });
    const {result: r, writes} = await recorded(() => deletePhase(f.backupPath, f.vc.summary, 'plan-r-race.json', {db: racyDb}));
    ok(tampered, '[٦] التدخّل وقع في منتصف الحذف');
    eq(r.exitCode, M.EXIT.STOPPED, '[٦] تغيّر أثناء الحذف: رمز 2');
    eq(r.summary.deleted.reportsBlockedDiffer, 1, '[٦] مانع DIFFER واحد أثناء المعاملة');
    ok(r.summary.stoppedBecause === 'BLOCKED_DIFFER', '[٦] السبب BLOCKED_DIFFER');
    const r2rep = await readReport('r2');
    ok(hasAnyMoved(r2rep), '[٦] تقرير r2 لم تُحذف حقوله (المعاملة رفضت)');
    eq((await readRaw('r2')).deviceFingerprintSha, 'tampered-mid-delete', '[٦] وreportRaw المعدَّل لم يُكتب فوقه');
    // كتابة الاختبار نفسه (التدخّل) تمرّ بالمسجِّل عبر DocumentReference مباشرةً؛ كتابات السكربت كلّها عبر المعاملات
    const scriptWrites = writes.filter((w) => w.via !== 'doc');
    eq(writes.filter((w) => w.via === 'doc').length, 1, '[٦] كتابة مباشرة واحدة فقط في النافذة: تدخّل الاختبار نفسه');
    ok(scriptWrites.every((w) => w.collection === 'reports' && w.op === 'update'), '[٦] وكل ما كتبه السكربت update على reports (لا reportRaw حتى في الحالة الشاذّة)');
    eq(scriptWrites.some((w) => w.id === 'r2'), false, '[٦] ولم يكتب السكربت على r2');
  }
  {
    // (ي) خطّة مزوَّرة تطابق ملفّ نسخة نُزع منه سطر: المرحلة ٢ نفسها تعدّ التقرير بلا سطر وتتوقّف (فحصها مستقلّ عن --verify-copy)
    const f = await freshCopied('r-forged');
    const lines = fs.readFileSync(f.backupPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const kept = lines.filter((l) => !l.includes('"scanId":"r4"'));
    ok(kept.length === lines.length - 1, '[٦] حُذف سطر r4 من نسخة الاختبار');
    fs.writeFileSync(f.backupPath, `${kept.join('\n')}\n`);
    const idxF = M.inspectBackupFile(f.backupPath);
    const forged = JSON.parse(JSON.stringify(f.vc.summary));
    forged.backup.totalLines = idxF.totalLines;
    forged.backup.sha256 = idxF.sha256;
    forged.backup.reportRecords = idxF.reportRecords;
    const state = await dump();
    const {result: r, writes} = await recorded(() => deletePhase(f.backupPath, forged, 'plan-r-forged.json'));
    eq(r.summary.stoppedBecause, 'NOT_READY_NOTHING_DELETED', '[٦] خطّة تطابق الملفّ المنقوص: المرحلة ٢ نفسها تتوقّف');
    ok(r.summary.blockers.some((b) => /reports بلا سطر نسخة=1/.test(b)), '[٦] وتعدّ التقرير بلا سطر نسخة');
    eq(writes.length, 0, '[٦] بلا أيّ كتابة');
    await assertNothingDeleted('خطّة مزوَّرة', state);
  }
  console.log('تحقّق ٦: المرحلة ٢ ترفض ولا تحذف');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ — HALF وتعارض reportRaw قائم (المرحلة ١)
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  const halfReport = legacyReport('h1', {listingStatus: 'for_sale'});
  await seedReport('h1', halfReport);
  await seedRaw('h1', {scanId: 'h1', ...movedOf(halfReport), source: REPORT_RAW_SOURCE.MIGRATION, createdAt: Timestamp.now()});
  const rawBeforeHalf = (await db.collection('reportRaw').doc('h1').get()).updateTime.toMillis();
  await seedReport('h2', legacyReport('h2'));
  const dHalf = await dryRun();
  eq(dHalf.summary.reports.byState.HALF, 1, '[٧] HALF مُصنَّف (خامّ موجود مطابق والحقول ما زالت في التقرير)');
  eq(dHalf.summary.reports.byState.MIGRATE, 1, '[٧] وMIGRATE للآخر');
  const {result: aHalf, writes: wHalf} = await recorded(() => copyPhase('backup-half.jsonl', M.loadPlan(planFileFrom(dHalf.summary, 'plan-half.json'))));
  eq(aHalf.exitCode, M.EXIT.OK, '[٧] المرحلة ١ مع HALF تنجح');
  eq(aHalf.summary.copied.reportsAlreadyCopied, 1, '[٧] HALF يُعدّ منسوخاً سابقاً');
  eq(aHalf.summary.copied.reportsCopied, 1, '[٧] والآخر يُنسخ');
  eq((await db.collection('reportRaw').doc('h1').get()).updateTime.toMillis(), rawBeforeHalf, '[٧] مستند الخامّ القائم لم يُلمَس (لا كتابة فوقه)');
  ok(hasAnyMoved(await readReport('h1')), '[٧] وحقول h1 ما زالت في التقرير (المرحلة ١ لا تحذف)');
  ok(M.readBackupLines(aHalf.backupPath).some((l) => l.kind === 'report' && l.scanId === 'h1'), '[٧] وسطر h1 في النسخة (يلزمه قبل المرحلة ٢)');
  ok(wHalf.every((w) => w.collection === 'reportRaw' && w.op === 'create' && w.id === 'h2'), '[٧] والمكتوب خامّ h2 وحده');
  // السلسلة كاملة: HALF يُحذف في المرحلة ٢ بعد --verify-copy
  const vcHalf = await verifyCopy(aHalf.backupPath);
  eq(vcHalf.summary.reports.byteCompare.MATCH, 2, '[٧] --verify-copy: h1 وh2 مطابقان');
  const pHalf = await deletePhase(aHalf.backupPath, vcHalf.summary, 'plan-half2.json');
  eq(pHalf.exitCode, M.EXIT.OK, '[٧] المرحلة ٢ تُكمل HALF');
  ok(!hasAnyMoved(await readReport('h1')) && !hasAnyMoved(await readReport('h2')), '[٧] وخرجت الحقول من التقريرين');
  eq((await db.collection('reportRaw').doc('h1').get()).updateTime.toMillis(), rawBeforeHalf, '[٧] وreportRaw القائم ما زال لم يُلمَس');

  // CONFLICT
  await reset();
  const cReport = legacyReport('c1', {listingStatus: 'for_sale'});
  await seedReport('c1', cReport);
  await seedReport('c2', legacyReport('c2'));
  await seedRaw('c1', {scanId: 'c1', ...movedOf(cReport), deviceFingerprintSha: 'a-DIFFERENT-value', source: REPORT_RAW_SOURCE.ANALYZE_DEVICE, createdAt: Timestamp.now()});
  const conflictBefore = await dump();
  const dC = await dryRun();
  eq(dC.summary.reports.byState.CONFLICT, 1, '[٧] التعارض يُعدّ في الجافّ');
  eq(dC.exitCode, M.EXIT.STOPPED, '[٧] الجافّ يُخرج 2 (لا يمكن البدء)');
  deepEq(dC.summary.reports.conflictExamplesHashed[0].fields, ['deviceFingerprintSha'], '[٧] يُسمّي الحقل المتعارض اسماً');
  ok(!JSON.stringify(dC.summary).includes('a-DIFFERENT-value'), '[٧] ولا يطبع القيمة');
  ok(sameDump(conflictBefore, await dump()), '[٧] الجافّ لم يغيّر شيئاً');
  const vcC = await verifyCopy(null);
  eq(vcC.summary.reports.byteCompare.DIFFER, 1, '[٧] --verify-copy يعدّ التعارض DIFFER');
  // الخطّة المأخوذة قبل التعارض (مشهد نظيف) ثم يظهر التعارض: المرحلة ١ لا تبدأ
  await reset();
  await seedReport('c1', cReport);
  await seedReport('c2', legacyReport('c2'));
  const cleanPlan = M.loadPlan(planFileFrom((await dryRun()).summary, 'plan-clean.json'));
  await seedRaw('c1', {scanId: 'c1', ...movedOf(cReport), deviceFingerprintSha: 'a-DIFFERENT-value', source: REPORT_RAW_SOURCE.ANALYZE_DEVICE, createdAt: Timestamp.now()});
  const stateWithConflict = await dump();
  const {result: aC, writes: wC} = await recorded(() => copyPhase('backup-conflict.jsonl', cleanPlan));
  eq(aC.exitCode, M.EXIT.STOPPED, '[٧] المرحلة ١ مع تعارض: تتوقّف (2)');
  eq(aC.summary.stoppedBecause, 'PLAN_DRIFT_OR_CONFLICT', '[٧] سبب التوقّف مسمّى');
  ok(aC.summary.planCheck.reasons.some((r) => /CONFLICT/.test(r)), '[٧] ويقول إنه التعارض');
  ok(sameDump(stateWithConflict, await dump()) && wC.length === 0, '[٧] لم يُكتب شيء ولا في تقرير آخر سليم (c2 لم يُنسخ) — وreportRaw القائم لم يُكتب فوقه');
  eq((await readRaw('c1')).deviceFingerprintSha, 'a-DIFFERENT-value', '[٧] قيمة reportRaw القائم لم تُستبدَل');
  // تعارض يظهر أثناء التشغيل (بعد فحص الخطّة): copyReportPage يتوقّف ولا يكتب في صفحته
  const pageDocs = (await db.collection('reports').orderBy(admin.firestore.FieldPath.documentId()).get()).docs;
  const counters = M.newCopyCounters();
  const bk = M.openBackup({backupPath: path.join(tmp, 'backup-midrun.jsonl'), now});
  const pageResult = await M.copyReportPage({db, docs: pageDocs, backup: bk, counters, log: () => {}});
  bk.close();
  eq(pageResult.stop, 'CONFLICT', '[٧] تعارض أثناء الصفحة → توقّف');
  ok(sameDump(stateWithConflict, await dump()), '[٧] ولا كتابة من تلك الصفحة (c2 السليم لم يُنسخ — التعارض يوقف قبل أيّ كتابة)');
  eq(counters.reportsCopied, 0, '[٧] صفر نسخ');
  console.log('تحقّق ٧: HALF والتعارض');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ب — المالك يعدّل في الأثناء: المعاملة تتحقّق أن التقرير لم يتغيّر منذ قراءته
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  await seedReport('o1', legacyReport('o1', {listingStatus: 'for_sale', price: 500}));
  await seedReport('o2', legacyReport('o2', {price: 700}));
  const planO = M.loadPlan(planFileFrom((await dryRun()).summary, 'plan-owner.json'));
  let interfered = false;
  const ownerDb = withTxHook(db, async () => {
    if (interfered) return;
    interfered = true;
    // المالك يغيّر السعر وحالة العرض بين قراءة الترحيل وإيداعه (الحقول الأربعة المسموحة له في القواعد)
    await db.collection('reports').doc('o1').update({price: 123, listingStatus: 'sold', sellerNote: 'changed-by-owner'});
    // وفي الأثناء نفسها يُكتب لـo2 خامّ أحدث (إعادة تحليل): لو نُسخت القراءة القديمة لبقيت القيمة القديمة في reportRaw
    await db.collection('reports').doc('o2').update({deviceFingerprintSha: 'sha-o2-REWRITTEN'});
  });
  const aO = await copyPhase('backup-owner.jsonl', planO, {db: ownerDb});
  eq(aO.exitCode, M.EXIT.OK, '[٧ب] انتهت بنجاح');
  ok(interfered, '[٧ب] التدخّل وقع فعلاً قبل أوّل معاملة');
  ok(aO.summary.copied.reportsRetried >= 1, '[٧ب] التحقّق فشل فأُعيدت القراءة (محاولة ثانية)');
  const o1 = await readReport('o1');
  eq(o1.price, 123, '[٧ب] سعر المالك الجديد بقي (لا دوس)');
  eq(o1.listingStatus, 'sold', '[٧ب] وحالة العرض');
  eq(o1.sellerNote, 'changed-by-owner', '[٧ب] وملاحظة البائع');
  ok(await readRaw('o1') !== null && await readRaw('o2') !== null, '[٧ب] مستندا الخامّ موجودان');
  eq((await readRaw('o2')).deviceFingerprintSha, 'sha-o2-REWRITTEN', '[٧ب] o2: القيمة الأحدث (لا القديمة) هي التي في reportRaw');
  const o2Lines = M.readBackupLines(aO.backupPath).filter((l) => l.kind === 'report' && l.scanId === 'o2');
  eq(M.decodeValue(o2Lines[o2Lines.length - 1].fields.deviceFingerprintSha, {}), 'sha-o2-REWRITTEN', '[٧ب] وآخر سطر نسخة لـo2 يحمل القيمة الأحدث (النسخة تتبع إعادة القراءة)');
  const vcO = await verifyCopy(aO.backupPath);
  eq(vcO.summary.ready, true, '[٧ب] و--verify-copy بعدها ready (المطابقة والنسخة على الأحدث)');
  console.log('تحقّق ٧ب: تعديل المالك أثناء التشغيل');

  // ═══════════════════════════════════════════════════════════════════
  // ٧ج — الحجم: قريب من العتبة يمرّ، وفوقها يُتخطّى بحالة صريحة ويمنع المرحلة ٢
  // ═══════════════════════════════════════════════════════════════════
  await reset();
  const sized = (id, targetBytes) => {
    const r = legacyReport(id, {listingStatus: 'for_sale'});
    r.rawFingerprint = JSON.parse(JSON.stringify(r.rawFingerprint));
    r.rawFingerprint.padding = '';
    const base = measureReportRawBytes(M.buildMigrationRawDocument({scanId: id, reportData: r, createdAt: null}));
    r.rawFingerprint.padding = 'x'.repeat(targetBytes - base);
    return r;
  };
  const nearOk = sized('big-ok', REPORT_RAW_MAX_BYTES - 5000);
  const tooBig = sized('big-over', REPORT_RAW_MAX_BYTES + 20000);
  await seedReport('big-ok', nearOk);
  await seedReport('big-over', tooBig);
  const bytesOk = measureReportRawBytes(M.buildMigrationRawDocument({scanId: 'big-ok', reportData: nearOk, createdAt: null}));
  const bytesOver = measureReportRawBytes(M.buildMigrationRawDocument({scanId: 'big-over', reportData: tooBig, createdAt: null}));
  ok(bytesOk > REPORT_RAW_MAX_BYTES - 6000 && bytesOk <= REPORT_RAW_MAX_BYTES, `[٧ج] البذرة القريبة من العتبة (${bytesOk})`);
  ok(bytesOver > REPORT_RAW_MAX_BYTES, `[٧ج] البذرة فوق العتبة (${bytesOver})`);
  const dSize = await dryRun();
  eq(dSize.summary.reports.tooLargeForRaw, 1, '[٧ج] الجافّ يعدّ ما فوق العتبة');
  eq(dSize.summary.wouldWrite.reportsSkippedTooLarge, 1, '[٧ج] وسيتخطّاه');
  ok(dSize.summary.reports.movedBytes.max >= bytesOver - 100, '[٧ج] أكبر حجم مقيس مطبوع');
  const aSize = await copyPhase('backup-size.jsonl', M.loadPlan(planFileFrom(dSize.summary, 'plan-size.json')));
  eq(aSize.summary.copied.reportsCopied, 1, '[٧ج] القريب من العتبة نُسخ');
  eq(aSize.summary.copied.reportsSkippedTooLarge, 1, '[٧ج] وما فوقها تُخطّي بحالة صريحة');
  eq(await readRaw('big-over'), null, '[٧ج] ولم يُكتب له مستند خامّ مقتطَع (القاعدة 20)');
  same(await readReport('big-over'), tooBig, '[٧ج] ولم يُغيَّر التقرير (الخامّ ما زال فيه كاملاً)');
  same((await readRaw('big-ok')).rawFingerprint, nearOk.rawFingerprint, '[٧ج] القريب من العتبة نُقل كاملاً');
  eq(aSize.exitCode, M.EXIT.STOPPED, '[٧ج] رمز الخروج 2: ثمّة ما لم يُنسخ');
  const vSize = await verify();
  eq(vSize.exitCode, M.EXIT.RESIDUAL_REPORTS, '[٧ج] --verify يرفض (3): الباقي يمنع القرار ٥');
  eq(vSize.summary.verdict.residualReportsWithMovedFields, 2, '[٧ج] والباقي 2 (الحقول ما زالت في التقريرين: المنسوخ لم يُحذف، وما فوق العتبة لم يُنسخ)');
  const vcSize = await verifyCopy(aSize.backupPath);
  eq(vcSize.summary.reports.byteCompare.ABSENT, 1, '[٧ج] --verify-copy: ما فوق العتبة ABSENT');
  eq(vcSize.summary.reports.notCopiedTooLarge, 1, '[٧ج] ويُسمّى «لم يُنسخ لحجمه»');
  eq(vcSize.summary.ready, false, '[٧ج] ليس ready — المرحلة ٢ ممنوعة حتى يُحسم');
  console.log('تحقّق ٧ج: عتبة الحجم');

  // ٧د — قيمة لا يعرف الترميز نسخها (لقطة مصنوعة: لا يمكن زرع صنف كهذا في المحاكي): يُتخطّى بلا نسخة ولا كتابة، والباقي يمضي
  {
    const unsupportedSnap = {id: 'weird-1', data: () => ({sessionId: null, aiAudit: {x: new Map([[1, 2]])}}), updateTime: Timestamp.now()};
    const goodSnap = await db.collection('reports').doc('big-ok').get();
    const stateBefore = await dump();
    const cnt = M.newCopyCounters();
    const bk2 = M.openBackup({backupPath: path.join(tmp, 'backup-unencodable.jsonl'), now});
    const res = await M.copyReportPage({db, docs: [unsupportedSnap, goodSnap], backup: bk2, counters: cnt, log: () => {}});
    bk2.close();
    eq(res.stop, null, '[٧د] لا توقّف');
    eq(cnt.reportsSkippedUnencodable, 1, '[٧د] التقرير غير القابل للترميز يُتخطّى ويُعدّ');
    eq(cnt.backupLinesReports, 1, '[٧د] ولا سطر نسخة له (سطر big-ok المنسوخ سابقاً وحده)');
    ok(!M.readBackupLines(path.join(tmp, 'backup-unencodable.jsonl')).some((l) => l.scanId === 'weird-1'), '[٧د] ولا سطر باسم التقرير غير القابل للترميز');
    ok(sameDump(stateBefore, await dump()), '[٧د] ولا كتابة في المحاكي (big-ok كان منسوخاً أصلاً فلم يُلمَس)');
    eq(cnt.reportsAlreadyCopied, 1, '[٧د] والمنسوخ سابقاً يُعدّ كالمعتاد');
  }
  console.log('تحقّق ٧د: قيمة غير قابلة للترميز');

  // ═══════════════════════════════════════════════════════════════════
  // ٧هـ — الاستئناف: انقطاع بين الصفحات، وفشل معاملة (المرحلة ١)
  // ═══════════════════════════════════════════════════════════════════
  async function seedMany() {
    await reset();
    for (let i = 1; i <= 7; i++) await seedReport(`m${i}`, legacyReport(`m${i}`, {listingStatus: i <= 2 ? 'for_sale' : 'draft'}));
  }
  await seedMany();
  const planM = M.loadPlan(planFileFrom((await dryRun()).summary, 'plan-many.json'));
  // (أ) انقطاع بين صفحتين: يرمي الـlog بعد أوّل صفحة تقارير (العملية تُقتل)
  let pagesSeen = 0;
  let killed = null;
  try {
    await copyPhase('backup-resume.jsonl', planM, {log: (m) => { if (/^\[copy\] reports/.test(m) && ++pagesSeen === 2) throw new Error('KILLED'); }});
  } catch (e) { killed = e; }
  ok(killed && killed.message === 'KILLED', '[٧هـ] العملية قُتلت في منتصف النسخ');
  const midRaw = (await db.collection('reportRaw').get()).size;
  ok(midRaw > 0 && midRaw < 7, `[٧هـ] نسخ جزئي (${midRaw} من 7)`);
  const midBackup = path.join(tmp, 'backup-resume.jsonl');
  ok(M.readBackupLines(midBackup).filter((l) => l.kind === 'report').length >= midRaw, '[٧هـ] والنسخة تسبق ما نُسخ (أسطرها ≥ ما نُسخ)');
  const aResume = await copyPhase('backup-resume.jsonl', planM);
  eq(aResume.exitCode, M.EXIT.OK, '[٧هـ] إعادة التشغيل تستأنف وتنجح');
  eq(aResume.summary.backup.resumed, true, '[٧هـ] الملفّ نفسه يُلحَق (سطر استئناف)');
  eq((await db.collection('reportRaw').get()).size, 7, '[٧هـ] 7 مستندات خامّ بالضبط (لا مكرَّر ولا مفقود)');
  eq(aResume.summary.copied.reportsAlreadyCopied, midRaw, '[٧هـ] ما نُسخ قبل القتل يُعدّ منسوخاً');
  eq(new Set(M.readBackupLines(midBackup).filter((l) => l.kind === 'report').map((l) => l.scanId)).size, 7, '[٧هـ] وفي النسخة سجلّ لكل التقارير السبعة');
  for (let i = 1; i <= 7; i++) same((await readRaw(`m${i}`)).rawFingerprint, legacy.rawFingerprint, `[٧هـ] m${i}: الخامّ سليم`);
  const vcResume = await verifyCopy(midBackup);
  eq(vcResume.summary.ready, true, '[٧هـ] و--verify-copy بعد الاستئناف ready (النسخة تغطّي ما سيُحذف)');
  // (ب) فشل معاملة واحدة (محاكاة انقطاع) ثم إعادة
  await seedMany();
  const planM2 = M.loadPlan(planFileFrom((await dryRun()).summary, 'plan-many2.json'));
  let failOnce = true;
  const flakyDb = withTxHook(db, async () => { if (failOnce) { failOnce = false; throw Object.assign(new Error('UNAVAILABLE: simulated'), {code: 14}); } });
  const aFlaky = await copyPhase('backup-flaky.jsonl', planM2, {db: flakyDb});
  eq(aFlaky.summary.copied.reportsFailed, 1, '[٧هـ] معاملة واحدة فشلت وعُدّت');
  eq(aFlaky.exitCode, M.EXIT.STOPPED, '[٧هـ] ورمز الخروج 2 (لم يكتمل)');
  eq(aFlaky.summary.copied.reportsCopied, 6, '[٧هـ] والبقيّة نُسخت');
  eq(aFlaky.summary.after.reports.byState.MIGRATE, 1, '[٧هـ] يبقى 1 لم يُنسخ');
  ok(aFlaky.summary.copied.failedExamplesHashed[0] && aFlaky.summary.copied.failedExamplesHashed[0].code === '14', '[٧هـ] الفشل بسببه (رمز) ومعرّف مهشَّر');
  const aAfterFlaky = await copyPhase('backup-flaky.jsonl', planM2);
  eq(aAfterFlaky.exitCode, M.EXIT.OK, '[٧هـ] الإعادة تُكمل');
  eq((await db.collection('reportRaw').get()).size, 7, '[٧هـ] 7 خامّ بالضبط');
  console.log('تحقّق ٧هـ: الاستئناف');

  // ═══════════════════════════════════════════════════════════════════
  // ٨ — evaluations بالمرحلتين
  // ═══════════════════════════════════════════════════════════════════
  async function seedEvals() {
    await reset();
    const rA = legacyReport('ea', {sessionId: 'sess-ea', listingStatus: 'for_sale'});
    await seedReport('ea', rA); // سيُنسخ: DUPLICATE
    await seedReport('eb', legacyReport('eb')); // NULL_ONLY
    const onlyRaw = legacyReport('ec');
    delete onlyRaw.timeSeriesStoragePath; // التقرير بلا مسار؛ التقييم يحمله وحده → MOVE إلى مستند خامّ قائم
    await seedReport('ec', onlyRaw);
    await seedReport('ed', {...readable, userId: 'u-ed'}); // NO_RAW: التقييم يحمل المسار وحده → MOVE ينشئ مستنداً
    // ee: تقييم بلا تقرير (ORPHAN)
    await seedReport('ef', legacyReport('ef')); // CLEAN: تقييم بلا مفاتيح
    const base = {ownerId: 'owner-1', technicianGrade: 'B', agreement: 'agree', pending: false, linkageIncomplete: false};
    await seedEval('ea', {...base, sessionId: 'sess-ea', deviceFingerprintSha: 'sha-ea', timeSeriesStoragePath: 'timeSeries/ea.json.gz'});
    await seedEval('eb', {...base, sessionId: null, deviceFingerprintSha: null, timeSeriesStoragePath: null});
    await seedEval('ec', {...base, sessionId: null, deviceFingerprintSha: 'sha-ec', timeSeriesStoragePath: 'timeSeries/only-in-evaluation-ec.json.gz'});
    await seedEval('ed', {...base, timeSeriesStoragePath: 'timeSeries/only-in-evaluation-ed.json.gz'});
    await seedEval('ee', {...base, timeSeriesStoragePath: 'timeSeries/orphan-ee.json.gz'});
    await seedEval('ef', {...base});
  }
  await seedEvals();
  const evalOriginals = {};
  for (const id of ['ea', 'eb', 'ec', 'ed', 'ee', 'ef']) evalOriginals[id] = await readEval(id);
  const reportOriginalsE = {};
  for (const id of ['ea', 'eb', 'ec', 'ed', 'ef']) reportOriginalsE[id] = await readReport(id);
  const stateBeforeEvalDry = await dump();
  const dE = await dryRun();
  ok(sameDump(stateBeforeEvalDry, await dump()), '[٨] الجافّ لا يغيّر evaluations أيضاً');
  const ev = dE.summary.evaluations.byState;
  eq(ev.DUPLICATE, 1, '[٨] ea: DUPLICATE');
  eq(ev.NULL_ONLY, 1, '[٨] eb: NULL_ONLY');
  eq(ev.DEFERRED, 1, '[٨] ec: DEFERRED في الجافّ (تقريره لم يُنسخ بعد — المضمَّن لا يحمل المسار)');
  eq(ev.MOVE, 1, '[٨] ed: MOVE (تقريره NO_RAW، المسار في التقييم وحده)');
  eq(ev.ORPHAN, 1, '[٨] ee: ORPHAN');
  eq(ev.CLEAN, 1, '[٨] ef: CLEAN');
  eq(dE.summary.evaluations.withIdentifierFields, 5, '[٨] 5 تقييمات تحمل مفاتيح معرّفات');
  ok(!JSON.stringify(dE.summary).includes('only-in-evaluation'), '[٨] لا قيمة معرّف في الخلاصة');
  const vcEBefore = await verifyCopy(null);
  eq(vcEBefore.summary.ready, false, '[٨] --verify-copy قبل المرحلة ١: ليس ready');
  const planE = M.loadPlan(planFileFrom(dE.summary, 'plan-evals.json'));
  const {result: aE, writes: wE} = await recorded(() => copyPhase('backup-evals.jsonl', planE));
  eq(aE.exitCode, M.EXIT.OK, '[٨] المرحلة ١ تكتمل');
  const ap = aE.summary.copied;
  eq(ap.evaluationsCopied, 2, '[٨] ec وed: نُقلت قيمتاهما إلى reportRaw (MOVE)');
  eq(ap.evaluationsAlreadyCovered, 2, '[٨] ea وeb: لا شيء يُنسخ (مطابق / null) لكن لهما سطر نسخة');
  eq(ap.evaluationsOrphan, 1, '[٨] ee: ORPHAN يبقى ويُعدّ');
  ok(!deletesAnything(wE), '[٨] المسجِّل: المرحلة ١ بلا حذف حتى مع evaluations');
  ok(wE.every((w) => w.collection === 'reportRaw'), '[٨] والمسجِّل: كل كتابة في reportRaw (لا evaluations ولا reports)');
  for (const id of ['ea', 'eb', 'ec', 'ed', 'ee', 'ef']) same(await readEval(id), evalOriginals[id], `[٨] ${id}: التقييم لم يتغيّر بعد المرحلة ١ (معرّفاته ما زالت فيه)`);
  const rawEc = await readRaw('ec');
  eq(rawEc.timeSeriesStoragePath, 'timeSeries/only-in-evaluation-ec.json.gz', '[٨] ec: المسار صار في reportRaw (أُضيف إلى المستند المنسوخ، لا كتابة فوق قيمة)');
  same(rawEc.rawFingerprint, legacy.rawFingerprint, '[٨] ec: ولم يُمسّ باقي الخامّ');
  const rawEd = await readRaw('ed');
  eq(rawEd.source, REPORT_RAW_SOURCE.MIGRATION, '[٨] ed: مستند جديد source=migration');
  eq(rawEd.timeSeriesStoragePath, 'timeSeries/only-in-evaluation-ed.json.gz', '[٨] ed: المسار في المستند الجديد');
  deepEq(Object.keys(rawEd).sort(), ['createdAt', 'scanId', 'source', 'timeSeriesStoragePath'], '[٨] ed: المستند يحمل ما نُقل وحده (لا حقل مختلَق)');
  eq((await readRaw('ea')).sessionId, 'sess-ea', '[٨] ea: reportRaw يحمل المعرّف الذي كان في التقييم أيضاً');
  eq(await readRaw('ee'), null, '[٨] ولم يُنشأ reportRaw للمعرّف اليتيم');
  const evBackup = M.readBackupLines(aE.backupPath).filter((l) => l.kind === 'evaluation');
  eq(evBackup.length, 4, '[٨] نسخة لكلّ تقييم سيُنظَّف (4)');
  ok(evBackup.every((l) => l.evalId !== 'ee' && l.evalId !== 'ef'), '[٨] ولا نسخة لما لن يُمسّ');
  const v9a = await verify();
  eq(v9a.exitCode, M.EXIT.RESIDUAL_REPORTS, '[٩] --verify بعد المرحلة ١: 3 (الحقول ما زالت في التقارير — القرار ٥ لم يتحقّق)');
  eq(v9a.summary.verdict.decision5Satisfied, false, '[٩] decision5Satisfied=false بعد المرحلة ١');
  eq(v9a.summary.verdict.residualReportsWithMovedFields, 4, '[٩] والباقي 4 تقارير (ea وeb وec وef)');
  const vcE = await verifyCopy(aE.backupPath);
  eq(vcE.summary.reports.byteCompare.MATCH, 4, '[٨] --verify-copy: 4 تقارير مطابقة بالبايت');
  eq(vcE.summary.evaluations.ready.DUPLICATE, 3, '[٨] تقييمات جاهزة DUPLICATE: ea وec وed (بعد نسخ قيمتَي ec وed)');
  eq(vcE.summary.evaluations.ready.NULL_ONLY, 1, '[٨] وNULL_ONLY: eb');
  eq(vcE.summary.evaluations.leftAsIs.ORPHAN, 1, '[٨] واليتيم متروك لا يمنع');
  eq(vcE.summary.expected.evaluationRecords, 4, '[٨] expected.evaluationRecords = 4');
  eq(vcE.summary.ready, true, '[٨] ready');
  const {result: pE, writes: wpE} = await recorded(() => deletePhase(aE.backupPath, vcE.summary, 'plan-evals2.json'));
  eq(pE.exitCode, M.EXIT.OK, '[٨] المرحلة ٢ تكتمل');
  eq(pE.summary.deleted.reportsDeleted, 4, '[٨] حُذفت حقول 4 تقارير');
  eq(pE.summary.deleted.evaluationsDeleted, 4, '[٨] ونُظِّفت 4 تقييمات (ea وeb وec وed)');
  eq(pE.summary.deleted.evaluationsLeftAsIs, 1, '[٨] ee (ORPHAN) متروك ومعدود');
  ok(wpE.every((w) => w.op === 'update' && (w.collection === 'reports' || w.collection === 'evaluations')), '[٨] المسجِّل: المرحلة ٢ update على reports وevaluations وحدهما (لا reportRaw)');
  ok(wpE.every((w) => Object.values(w.fields).every((k) => k === 'delete')), '[٨] المسجِّل: كلها علامات حذف حقول');
  ok(wpE.filter((w) => w.collection === 'evaluations').every((w) => Object.keys(w.fields).every((k) => EVAL_IDS.includes(k))), '[٨] المسجِّل: وفي evaluations المعرّفات الثلاثة وحدها (لا ownerId ولا technicianGrade)');
  const evAfter = {};
  for (const id of ['ea', 'eb', 'ec', 'ed', 'ee', 'ef']) evAfter[id] = await readEval(id);
  for (const id of ['ea', 'eb', 'ec', 'ed']) {
    eq(EVAL_IDS.some((f) => f in evAfter[id]), false, `[٨] ${id}: لا معرّف في evaluations بعد الآن`);
    const kept = Object.fromEntries(Object.entries(evalOriginals[id]).filter(([k]) => !EVAL_IDS.includes(k)));
    same(evAfter[id], kept, `[٨] ${id}: سائر الحقول (ownerId/technicianGrade/...) كما هي`);
  }
  same(evAfter.ee, evalOriginals.ee, '[٨] ee (ORPHAN) لم يُلمَس — لا reportRaw بلا تقرير');
  same(evAfter.ef, evalOriginals.ef, '[٨] ef (CLEAN) لم يُلمَس');
  eq(pE.summary.after.evaluations.withIdentifierFields, 1, '[٨] بعد: يبقى تقييم واحد بمعرّف (اليتيم)');
  const vE = await verify();
  eq(vE.summary.verdict.residualReportsWithMovedFields, 0, '[٨] --verify: التقارير 0 باقياً');
  eq(vE.summary.verdict.residualEvaluationsWithIdentifierFields, 1, '[٨] --verify: التقييمات الباقية 1 (اليتيم، مُعلَن)');
  eq(vE.exitCode, M.EXIT.RESIDUAL_EVALUATIONS, '[٨] رمز الخروج 4 (التقارير 0 لكن التقييمات فيها باقٍ)');
  eq((await verify()).summary.verdict.decision5Satisfied, true, '[٩] decision5Satisfied=true بعد المرحلتين');
  // القارئ يفهم ما كُتب (القاعدة 30): الخامّ الفعّال لـec وed بعد الترحيل
  const effEc = await readReportRaw({db, scanId: 'ec', reportData: await readReport('ec')});
  eq(effEc.state, RAW_STATE.PRIVATE, '[٨] ec: القارئ يراه PRIVATE');
  eq(effEc.raw.timeSeriesStoragePath, 'timeSeries/only-in-evaluation-ec.json.gz', '[٨] ec: والمسار يصل القارئ');
  console.log('تحقّق ٨ و٩: evaluations و--verify بالمرحلتين');

  // قيمة تقييم تختلف عن الخامّ بعد --verify-copy: المرحلة ٢ ترفض ولا تحذف شيئاً
  await seedEvals();
  const fE = await copyAndVerify('evals-r');
  eq(fE.vc.summary.ready, true, '[٨] تمهيد: ready');
  await db.collection('reportRaw').doc('ec').update({timeSeriesStoragePath: 'timeSeries/changed-after-verify.json.gz'});
  const stateEvalRace = await dump();
  const rEv = await deletePhase(fE.backupPath, fE.vc.summary, 'plan-evals-r.json');
  eq(rEv.summary.stoppedBecause, 'NOT_READY_NOTHING_DELETED', '[٨] قيمة تقييم تخالف reportRaw بعد التحقّق: لا حذف');
  ok(rEv.summary.blockers.some((b) => /evaluations CONFLICT=1/.test(b)), '[٨] والمانع تعارض تقييم');
  ok(sameDump(stateEvalRace, await dump()), '[٨] ولم يتغيّر مستند واحد');

  // تعارض في evaluations يوقف (على مشهد طازج: التعارض الوحيد ez)
  await seedEvals();
  await seedEval('ez', {ownerId: 'o', timeSeriesStoragePath: 'timeSeries/DIFFERENT-from-raw.json.gz'});
  await seedReport('ez', legacyReport('ez'));
  await seedRaw('ez', {scanId: 'ez', ...movedOf(legacyReport('ez')), source: REPORT_RAW_SOURCE.ANALYZE_DEVICE, createdAt: Timestamp.now()});
  await db.collection('reports').doc('ez').update(Object.fromEntries(REPORT_RAW_FIELDS.map((f) => [f, FieldValue.delete()])));
  const dEC = await dryRun();
  eq(dEC.summary.evaluations.byState.CONFLICT, 1, '[٨] تقييم قيمته تخالف reportRaw: CONFLICT');
  eq(dEC.exitCode, M.EXIT.STOPPED, '[٨] والجافّ يُخرج 2');
  console.log('تحقّق ٨ب: تعارض evaluations');

  // ═══════════════════════════════════════════════════════════════════
  // ١٠ — --restore: بعد المرحلة ١ وحدها، وبعد المرحلتين
  // ═══════════════════════════════════════════════════════════════════
  // (أ) بعد المرحلة ١ وحدها: الحقول ما زالت في التقارير؛ التراجع يحذف الخامّ المنسوخ فقط
  await seedBase();
  const seedDumpBase = await dump();
  const fR1 = await copyAndVerify('restore-1');
  const copiedState = await dump();
  const prA = await M.runRestore({db, target: TARGET, now, backupPath: fR1.backupPath, apply: false});
  ok(sameDump(copiedState, await dump()), '[١٠] معاينة --restore بلا --apply لا تكتب شيئاً (بعد المرحلة ١)');
  eq(prA.summary.reports.restored, 6, '[١٠] المعاينة تعدّ ما سيُراجَع (6 خامّ منسوخ)');
  const rrA = await M.runRestore({db, target: TARGET, now, backupPath: fR1.backupPath, apply: true});
  eq(rrA.exitCode, M.EXIT.OK, '[١٠] --restore --apply بعد المرحلة ١ ينجح');
  eq(rrA.summary.reports.rawDeleted, 6, '[١٠] حُذفت مستندات الخامّ الستّة التي أنشأها الترحيل');
  ok(sameDump(dumpOf(seedDumpBase, 'reports'), dumpOf(await dump(), 'reports')), '[١٠] والتقارير كما كانت بالضبط (محتوى وupdateTime — لم يُكتب فيها شيء)');
  eq((await db.collection('reportRaw').get()).size, 0, '[١٠] وreportRaw فارغ كما قبل المرحلة ١');
  // (ب) بعد المرحلتين: تُعاد الحقول ثم يُحذف الخامّ (على مشهد evaluations)
  await seedEvals();
  const fR2 = await copyAndVerify('restore-2');
  const pR2 = await deletePhase(fR2.backupPath, fR2.vc.summary, 'plan-restore2.json');
  eq(pR2.exitCode, M.EXIT.OK, '[١٠] تمهيد: المرحلتان');
  const migratedState = await dump();
  const pr = await M.runRestore({db, target: TARGET, now, backupPath: fR2.backupPath, apply: false});
  ok(sameDump(migratedState, await dump()), '[١٠] معاينة --restore بلا --apply لا تكتب شيئاً (بعد المرحلتين)');
  eq(pr.summary.mode, 'restore-preview', '[١٠] وضع المعاينة مسمّى');
  ok(pr.summary.reports.restored >= 3, `[١٠] المعاينة تعدّ ما سيُستعاد (${pr.summary.reports.restored})`);
  const rr = await M.runRestore({db, target: TARGET, now, backupPath: fR2.backupPath, apply: true});
  eq(rr.exitCode, M.EXIT.OK, '[١٠] --restore --apply بعد المرحلتين ينجح');
  for (const id of ['ea', 'eb', 'ec', 'ed', 'ef']) {
    same(await readReport(id), reportOriginalsE[id], `[١٠] ${id}: التقرير عاد كما كان (الخامّ المضمَّن بأنواعه)`);
    same(await readEval(id), evalOriginals[id], `[١٠] ${id}: التقييم عاد كما كان`);
  }
  eq(rr.summary.reports.rawKeptHasExtraFields, 1, '[١٠] ec: مستند الخامّ يحمل قيمة جاءت من evaluation — يبقى ويُعدّ (لا حذف لقيمة بلا نسخة تقرير)');
  eq(await readRaw('ea'), null, '[١٠] ea: حُذف مستند الخامّ الذي أنشأه الترحيل');
  eq(await readRaw('eb'), null, '[١٠] eb: كذلك');
  const rawEdLeft = await readRaw('ed');
  ok(rawEdLeft !== null && rawEdLeft.source === REPORT_RAW_SOURCE.MIGRATION, '[١٠] ed: مستند أنشأه نقلُ evaluation لا نسخةُ تقرير — يبقى (لا حذف بلا سجلّ تقرير) ويُعلَن');
  const rr2 = await M.runRestore({db, target: TARGET, now, backupPath: fR2.backupPath, apply: true});
  eq(rr2.summary.reports.restored, 0, '[١٠] إعادة --restore: لا أثر مضاعف');
  console.log('تحقّق ١٠: --restore');

  // ═══════════════════════════════════════════════════════════════════
  // ١١ — سطر الأوامر الحقيقي (عملية فرعية على المحاكي)
  // ═══════════════════════════════════════════════════════════════════
  await seedMany();
  const cliBefore = await dump();
  let r = cli(['--dry-run']);
  eq(r.status, 0, '[١١] --dry-run: رمز الخروج 0');
  const cliSummary = JSON.parse(r.stdout);
  eq(cliSummary.target, TARGET, '[١١] المخرَج يقول إنه المحاكي');
  eq(cliSummary.reports.byState.MIGRATE, 7, '[١١] 7 للنسخ');
  ok(/target=EMULATOR/.test(r.stderr.split('\n')[0]), '[١١] أوّل سطر على stderr يذكر الهدف');
  ok(sameDump(cliBefore, await dump()), '[١١] والمحاكي لم يتغيّر');
  r = cli([]);
  eq(r.status, 0, '[١١] بلا وسائط = --dry-run');
  eq(JSON.parse(r.stdout).mode, 'dry-run', '[١١] والوضع dry-run');
  r = cli(['--apply']);
  eq(r.status, 1, '[١١] --apply وحدها: رمز 1');
  ok(/USAGE/.test(r.stderr) && /--phase/.test(r.stderr) && r.stdout === '', '[١١] برسالة استعمال تطلب --phase وبلا مخرَج (لا --apply واحد ينسخ ويحذف)');
  r = cli(['--apply', '--phase', 'copy']);
  eq(r.status, 1, '[١١] --apply --phase copy بلا --backup/--plan: رمز 1');
  r = cli(['--bogus']);
  eq(r.status, 1, '[١١] وسيط مجهول: رمز 1');
  const cliPlan = planFileFrom(cliSummary, 'plan-cli.json');
  r = cli(['--apply', '--phase', 'copy', '--backup', path.join(__dirname, '..', '..', 'inside-repo-backup.jsonl'), '--plan', cliPlan]);
  eq(r.status, 1, '[١١] --backup داخل المستودع: رمز 1');
  ok(/BACKUP_INSIDE_REPOSITORY/.test(r.stderr), '[١١] بسبب مسمّى');
  ok(!fs.existsSync(path.join(__dirname, '..', '..', 'inside-repo-backup.jsonl')), '[١١] ولم يُنشأ الملفّ داخل المستودع');
  r = cli(['--apply', '--phase', 'copy', '--backup', path.join(tmp, 'no-such-dir', 'b.jsonl'), '--plan', cliPlan]);
  eq(r.status, 1, '[١١] مجلّد النسخة غير موجود: رمز 1');
  // المرحلة ٢: كل ما يُحجَب قبل أيّ اتصال (المضيف المحلّي هنا غير مسموع، فلو اتّصلت لتأخّرت أو اختلف الخطأ)
  const deadHost = {FIRESTORE_EMULATOR_HOST: '127.0.0.1:1'};
  r = cli(['--apply', '--phase', 'delete', '--backup', path.join(tmp, 'b.jsonl')], deadHost);
  eq(r.status, 1, '[١١] --apply --phase delete بلا --plan: رمز 1');
  ok(/--verify-copy/.test(r.stderr), '[١١] وتطلب مخرَج --verify-copy');
  r = cli(['--apply', '--phase', 'delete', '--backup', path.join(tmp, 'b.jsonl'), '--plan', cliPlan], deadHost);
  eq(r.status, 1, '[١١] المرحلة ٢ بخطّة --dry-run بدل --verify-copy: رمز 1');
  ok(/PLAN_NOT_VERIFY_COPY_OUTPUT/.test(r.stderr), '[١١] بسبب مسمّى');
  ok(sameDump(cliBefore, await dump()), '[١١] ولم يُكتب شيء في أيّ من الحالات');
  const v0 = cli(['--verify']);
  eq(v0.status, M.EXIT.RESIDUAL_REPORTS, '[١١] --verify قبل الترحيل: رمز 3');
  const vc0 = cli(['--verify-copy']);
  eq(vc0.status, M.EXIT.STOPPED, '[١١] --verify-copy قبل المرحلة ١: رمز 2 (ليس ready)');
  ok(JSON.parse(vc0.stdout).blockers.includes('BACKUP_NOT_PROVIDED'), '[١١] ويسمّي المانع');
  // السلسلة الحقيقية: المرحلة ١ ← --verify-copy ← المرحلة ٢ ← --verify
  const cliBackup = path.join(tmp, 'backup-cli.jsonl');
  r = cli(['--apply', '--phase', 'copy', '--backup', cliBackup, '--plan', cliPlan]);
  eq(r.status, 0, '[١١] --apply --phase copy الحقيقي: رمز 0');
  ok(/phase=copy/.test(r.stderr.split('\n')[0]), '[١١] وأوّل سطر على stderr يذكر المرحلة');
  const cliCopy = JSON.parse(r.stdout);
  eq(cliCopy.mode, 'apply-copy', '[١١] الوضع apply-copy');
  eq(cliCopy.copied.reportsCopied, 7, '[١١] نُسخ 7');
  eq(cliCopy.after.reports.withMovedFields, 7, '[١١] والحقول ما زالت في 7 تقارير (لا حذف)');
  ok(fs.statSync(cliBackup).size > 0, '[١١] ملفّ النسخة كُتب');
  const vcRun = cli(['--verify-copy', '--backup', cliBackup]);
  eq(vcRun.status, 0, '[١١] --verify-copy بعد المرحلة ١: رمز 0');
  const cliVc = JSON.parse(vcRun.stdout);
  eq(cliVc.ready, true, '[١١] ready');
  const cliVcPlan = planFileFrom(cliVc, 'plan-cli-vc.json');
  r = cli(['--apply', '--phase', 'delete', '--backup', path.join(tmp, 'no-such-backup.jsonl'), '--plan', cliVcPlan], deadHost);
  eq(r.status, 1, '[١١] المرحلة ٢ بلا ملفّ النسخة: رمز 1');
  ok(/BACKUP_MISSING/.test(r.stderr) && r.stdout === '', '[١١] BACKUP_MISSING قبل أيّ اتصال (المضيف ميّت ولم يُحاوَل)');
  const stateBeforeCliDelete = await dump();
  r = cli(['--apply', '--phase', 'delete', '--backup', cliBackup, '--plan', cliVcPlan]);
  eq(r.status, 0, '[١١] --apply --phase delete الحقيقي: رمز 0');
  ok(/phase=delete/.test(r.stderr.split('\n')[0]), '[١١] وأوّل سطر على stderr يذكر المرحلة');
  const cliDel = JSON.parse(r.stdout);
  eq(cliDel.mode, 'apply-delete', '[١١] الوضع apply-delete');
  eq(cliDel.deleted.reportsDeleted, 7, '[١١] حُذفت حقول 7 تقارير');
  eq(cliDel.after.reports.withMovedFields, 0, '[١١] 0 باقياً');
  eq(cliDel.backup.unchanged, true, '[١١] والنسخة لم تتغيّر');
  ok(!sameDump(stateBeforeCliDelete, await dump()), '[١١] وتغيّرت التقارير (حذف الحقول)');
  const v1 = cli(['--verify']);
  eq(v1.status, 0, '[١١] --verify بعد المرحلتين: رمز 0');
  eq(JSON.parse(v1.stdout).verdict.decision5Satisfied, true, '[١١] القرار ٥ محقَّق');
  r = cli(['--restore', '--backup', cliBackup]);
  eq(r.status, 0, '[١١] --restore معاينة: رمز 0');
  eq(JSON.parse(r.stdout).mode, 'restore-preview', '[١١] وهي معاينة');
  console.log('تحقّق ١١: سطر الأوامر');

  recorder.uninstall();
  fs.rmSync(tmp, {recursive: true, force: true});
  await app.delete();
  console.log(`\nALL PASS (${n} assertions)`);
})().catch((e) => {
  console.error('FAIL:', e && e.stack || e);
  process.exitCode = 1;
});
