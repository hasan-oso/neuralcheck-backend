#!/usr/bin/env node
'use strict';

// ===================================================================
// golden-stage2-keypaths-readonly — قراءة فقط. مسارات المفاتيح وحدها (بلا قيمة) لتقرير حقيقي من فحص fv69 على الـS10: من مستند التقرير ومن نسخة Storage، مقارنةً بملفّات المفاتيح الذهبية. الكتلة ج٥. 2026-10-10 +03.
//
// **يشغّله المستخدم بيده** (بكتلة يكتبها المنسّق) على الإنتاج قراءةً. هذا الوكيل يكتبه ويختبره على المحاكي ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
// قرار المستخدم 2026-10-10، بنصّه (منقول من أمر المنسّق): «مسارات المفاتيح وحدها بلا قيم، من مستند التقرير ومن نسخة Storage، وتُقارن بملفّات المفاتيح. والملفّ لا يُحفظ على القرص: يُقرأ في الذاكرة،
// وتُستخرج المسارات، ويُترك.»
//
// ─── ما يقرؤه ويقارنه ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   المدخل: رمز تقرير واحد (--short-id NC-XXXXXX، فحص fv69 من الـS10). لا بريد ولا Auth.
//   • reports/{scanId} ← مساراته، مقارنةً بمسارات العيّنة الذهبية لمستند التقرير (مُحسَبة في الذاكرة — لا ملفّ `.keys.txt` يصف مستند reports).
//   • reportRaw/{scanId}.rawFingerprint ← مساراته (بعد التخفيف)، مقارنةً بملفّات المفاتيح التي تصف حمولة التطبيق.
//   • نسخة Storage (timeSeriesStoragePath في reportRaw) ← تُنزَّل **إلى الذاكرة** وتُفكّ فيها ← مساراتها، مقارنةً بجزء timeSeries من ملفّات المفاتيح. **ولا يُحفظ الملفّ على القرص بأيّ شكل.**
//   أيّ ملفّات مفاتيح؟ تُقرَّر من الملفّات عند كل تشغيل (fieldsVersion الشقيق = fieldsVersion التقرير)، وتُذكر بأسمائها في المخرَج. التفصيل والقيود في scripts/lib/goldenStage2Keypaths.js.
//   المخرَج: المسارات الزائدة والناقصة، **بلا قيمة واحدة**.
//
// ─── لا كتابة إلا ملفّ المخرَج ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Storage: bucket مغلَّف بقائمة بيضاء (file(path).exists/download/getMetadata؛ download بـdestination يرمي TRAP). ملفّ المخرَج: UTF-8 بلا BOM بالعلم wx.
// projectId مثبَّت في الكود. الاعتماد من بيئة الطرفية وحدها (ADC). المعرّفات مُهشَّرة (hashIdForLog): لا scanId ولا مسار Storage خامّاً. نصّ خطأ Storage لا يُكتب (الرمز والصنف وحدهما — القاعدة 36).
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = قُرئت المصادر الثلاثة وقورنت (والفروق في المخرَج، ليست فشلاً) · 3 = مصدر واحد على الأقلّ لم يُقرأ أو لم يُقارَن (حالته مسمّاة في المخرَج) · 2 = خطأ (وسيط/ملفّ/اتصال).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/golden-stage2-keypaths-readonly.js --preflight
//   node functions/scripts/golden-stage2-keypaths-readonly.js --short-id NC-XXXXXX --out <evidence>/golden-stage2-keypaths-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const G = require('./lib/goldenStage2Keypaths');

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, bucket?: Object, goldenDir?: string}} [io] db وbucket وgoldenDir تُحقَن للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = G.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = G.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: G.MODE, network: false, readOnly: true, ok: pf.ok, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج.
    C.assertOutWritable(args.out);
    err(`[golden-stage2-keypaths] project=${C.PROJECT_ID} target=${target} (read-only; paths only, no values; the Storage file is read in memory and never saved; the only file written is --out)`);
    const injected = io.db ? {db: io.db, bucket: io.bucket} : C.initReadOnlyAdmin({appName: 'golden-stage2-keypaths-readonly', withStorage: true});
    const db = C.wrapReadOnly(injected.db);
    const bucket = C.wrapReadOnlyBucket(injected.bucket);
    const nowMs = now();
    const gathered = await G.gatherFacts({db, bucket, shortId: args.shortId, goldenDir: io.goldenDir});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: G.MODE,
      schema: C.SCHEMA,
      generatedAtPlus03: C.nowPlus03(nowMs),
      rule: 'key paths only: no value, no length, no type; the Storage file was read in memory and not saved (user decision 2026-10-10)',
      input: {shortIdHash: C.hashIdForLog(args.shortId), ...gathered.ids},
      ...(gathered.early ?
        {early: gathered.early, summary: {allCompared: false, statesBySource: {report: gathered.early.state}}} :
        G.buildComparison(gathered.facts)),
    };
    C.writeOutputExclusive(args.out, doc);
    const states = doc.summary.statesBySource;
    out(`golden-stage2-keypaths written: allCompared=${doc.summary.allCompared} states=${JSON.stringify(states)}`);
    return doc.summary.allCompared ? C.EXIT.OK : C.EXIT.UNDETERMINED;
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
