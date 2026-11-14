#!/usr/bin/env node
'use strict';

// ===================================================================
// cluster-freq-windows-readonly — قراءة فقط. يطابق نوافذ تشغيلات «D للمعالج» بتردّدات عناقيد المعالج في ملفّ السلسلة الزمنية للفحص نفسه. 2026-10-13 +03.
//
// **يشغّله المستخدم بيده** (بكتلة يكتبها المنسّق) على الإنتاج قراءةً. هذا الوكيل يكتبه ويختبره دون شبكة ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
// قرار المستخدم للسكربت (منقول من أمر المنسّق): «الـS21 أبطأ: (أ) أوّلاً، سكربت قراءة يطابق نوافذ التشغيلات بتردّدات العناقيد.»
//
// ─── المدخل ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   --tokens S21=NC-…,S10=NC-…   رموز التقارير (shortId) بوسومها — نفس صيغة device-check-03-after-readonly.js
//   --out <cluster-freq-windows.json>   المخرَج (UTF-8 بلا BOM، wx: لا استبدال لملفّ موجود)
//   --preflight   فحص ذاتي بلا شبكة
//   لا متغيّر بيئة ولا بريد: لا تحقّق مالك هنا (الرمز وحده يحدّد التقرير). الاعتماد من بيئة الطرفية وحدها (ADC).
//
// ─── ما يُخرجه (التفصيل والقواعد في scripts/lib/clusterFreqWindows.js) ────────────────────────────────────────────────────────────────────────────
//   لكل تقرير: إصدار التطبيق وختم الحقول وعدد العيّنات؛ العناقيد (قناة لكل سياسة cpu_freq_policy{N}_khz مع relatedCpus وcpuinfoMaxFreqKhz من التذييل، واكتمال استثناء القراءات الفاشلة)؛
//   ولكل تشغيل D (cpuKnownAnswerRuns[]، المرحلتان 3 و5): نافذته [t, tEnd] ثم لكل عنقود في النافذة: عدد العيّنات والأدنى والوسيط والأعلى (kHz)، وأقرب عيّنة قبل النافذة وبعدها (قيمتها وبُعدها بالـms)،
//   وإن لم تقع عيّنة في النافذة فحالة NO_SAMPLE_IN_WINDOW صريحة مع بُعد ما بين أقرب عيّنتين (لا صفر). وصفّ مرجعي لقناة cpu_freq_max_khz (إضافة معلَنة).
//   حالة عليا لكل تقرير: ANALYZED أو UNDETERMINED:<السبب> (تقرير/خامّ/ملفّ غائب، رموز مكرَّرة، بلا تشغيلات).
//
// ─── لا كتابة إلا ملفّ المخرَج ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly. لا Auth أصلاً. Storage: bucket بقائمة بيضاء (file(path).exists/download/getMetadata؛ destination يرمي TRAP) — الملفّ يُنزَّل إلى الذاكرة ويُترك. المعرّفات مُهشَّرة (hashIdForLog):
// لا scanId ولا shortId ولا مسار Storage خامّاً في المخرَج. نصّ خطأ المزوّد لا يُكتب (القاعدة 36). projectId مثبَّت.
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج وكل التقارير ANALYZED · 3 = كُتب المخرَج وفيه تقرير UNDETERMINED على الأقلّ · 2 = خطأ (وسيط/ملفّ/اتصال).
//
// ─── الأذونات التي يحتاجها (قراءة وحدها) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Firestore (مشروع neuralchek-9b6d7): قراءة reports (استعلام shortId) وreportRaw — دور Cloud Datastore Viewer (roles/datastore.viewer) يكفي.
//   Storage (الحاوية في audit-device-profiles-readonly.STORAGE_BUCKET): قراءة كائن ملفّ السلسلة الزمنية — roles/storage.objectViewer يكفي.
//   لا Auth. اعتماد gcloud الافتراضي للتطبيقات (gcloud auth application-default login) أو GOOGLE_APPLICATION_CREDENTIALS من بيئة الطرفية — يضبطه المستخدم بطريقته.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/cluster-freq-windows-readonly.js --preflight
//   node functions/scripts/cluster-freq-windows-readonly.js --tokens "S21=NC-XXXXXX,S10=NC-XXXXXX" --out <evidence>/cluster-freq-windows-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const L = require('./lib/clusterFreqWindows');

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, bucket?: Object}} [io] db وbucket يُحقنان للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = L.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = L.preflightChecks();
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: L.MODE, network: false, readOnly: true, ok: pf.ok, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج.
    C.assertOutWritable(args.out);
    err(`[cluster-freq-windows] project=${C.PROJECT_ID} target=${target} tokens=${args.tokens.length} storage=in-memory read (read-only; the only file written is --out)`);
    const injected = io.db ? {db: io.db, bucket: io.bucket} : C.initReadOnlyAdmin({appName: 'cluster-freq-windows-readonly', withStorage: true});
    const db = C.wrapReadOnly(injected.db);
    const bucket = C.wrapReadOnlyBucket(injected.bucket);
    const nowMs = now();
    const blocks = [];
    for (const {tag, shortId} of args.tokens) {
      const facts = await L.gatherReportFacts({db, bucket, tag, shortId});
      blocks.push(L.analyzeFacts(facts));
    }
    const summary = L.summarize(blocks);
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: L.MODE,
      schema: C.SCHEMA,
      generatedAtPlus03: C.nowPlus03(nowMs),
      input: {tags: args.tokens.map((t) => ({tag: t.tag, shortIdHash: C.hashIdForLog(t.shortId)})), storageRead: 'in-memory (never saved)', dPhases: L.D_PHASES},
      reports: blocks,
      summary,
    };
    C.writeOutputExclusive(args.out, doc);
    for (const line of L.textLines(blocks)) out(line);
    out(`cluster-freq-windows written: reports=${summary.reports} analyzed=${summary.analyzed} undetermined=${summary.undetermined} runsWithWindow=${summary.runsWithWindow} ` +
        `runChannelWindows=${summary.runChannelWindows} withSamples=${summary.runChannelWindowsWithSamples} withoutSamples=${summary.runChannelWindowsWithoutSamples}`);
    return summary.undetermined > 0 ? C.EXIT.UNDETERMINED : C.EXIT.OK;
  } catch (e) {
    err(`✗ ${C.safeErrorText(e)}`);
    return C.EXIT.ERROR;
  }
}

module.exports = {main};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(`✗ توقّف بخطأ: ${C.safeErrorText(e)}`);
    process.exitCode = C.EXIT.ERROR;
  });
}
