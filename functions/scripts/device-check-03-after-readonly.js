#!/usr/bin/env node
'use strict';

// ===================================================================
// device-check-03-after-readonly — قراءة فقط. تقارير فحص الجهاز ٠٣ بعد الجلسات (1.0.11 على الـS10 والـS21)، الكتلتان ج٣ وج٤. 2026-10-10 +03.
//
// **يشغّله المستخدم بيده** (بكتلة يكتبها المنسّق) على الإنتاج قراءةً. هذا الوكيل يكتبه ويختبره على المحاكي ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── المدخل ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   --tokens B1=NC-…,B2=NC-…,S1=NC-…,S2=NC-…,WAIT=NC-…   رموز التقارير بوسومها
//   بريد حساب المالك من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**) ← getUserByEmail.
//   --round 1|2   (اختياري، الجزء السادس) الجولة التي يُحكَم بجدول توقّعاتها: الغائب = 1 (B1 · B2 · S1 · S2 · WAIT، 1.0.11 وختم 69)؛ 2 = (B8 · S1 · S2، وختم 70؛ والإصدار B8 على 1.0.12 وS1 وS2 على 1.0.14). غير 1 أو 2: USAGE
//   --cycle-expect S1=classified,B1=none   (اختياري، الجزء الخامس) توقّع تصنيف الدورات لكل وسم، وسيطٌ لا ثابت: classified = الوسم unsupported:zero_from_extra_api34 (الـS21 Ultra، API 34)، none = null (الـS10 5G، API 30). وسم بلا توقّع: INFO
//   --out <after.json>   المخرَج (UTF-8 بلا BOM، wx)      --no-storage   لا يُنزَّل ملفّ Storage (فتصير بنود العيّنات NOT_MEASURED)      --preflight   فحص ذاتي بلا شبكة
//
// ─── ما يُخرجه لكل تقرير (التفصيل والقواعد في scripts/lib/deviceCheck03After.js) ───────────────────────────────────────────────────────────────────
//   reports بالرمز ⟵ scanId ⟵ reportRaw/{scanId} ثم قرّاؤنا: readFv68 وtestKinds وfv68Names (لا نسخة منهم). الإصدارات (header.appVersion وfooter.fieldsVersion) · M-02 (endReason وelapsedMs وtimeToFirstTouchMs
//   وtouchedCells وtotalCells والحالة اليدوية) · SN-04 (عدد عناصر القائمتين ومتوسّط القيم في كلٍّ وwindowMs وcoverPromptAtMs) · اليدوي (كل status، وتصنيف unavailable، وhiddenByModel) ·
//   «D للمعالج» (مجموع زمنه في كل مرحلة ÷ زمن المرحلة، وحكم ≤ 1%) · سلوك الجهاز (getThermalHeadroom وبثّات البطارية وL-02 وذيل gpu_fps وحجم الحمولة وزمن العيّنة ونواة الذاكرة والتخزين والدورات ومطابقتها لـB-08) ·
//   للجلسات: مستند الجلسة (status وjoinedBy مُهشَّراً وjoinedAt) ومستند evaluations (حالته وغياب المعرّفات المنقولة) · وعدد تقارير حساب المالك (للمقارنة بالسكربت ١).
//   وجدول واحد بالبنود وحكم كلٍّ (PASS / FAIL / NOT_MEASURED / INFO) من قيم المخرَج نفسه.
//   وللجولة الثانية (الجزء الخامس، بعد النشر؛ إصدار التطبيق لكل وسم في TAG_EXPECTATIONS_R2): ختم قواعد التقييم من جذر مستند reports (EVALUATION_RULES_STAMP)، وتصنيف الدورات من القارئ نفسه مقابل توقّع وسيط لكل وسم (CYCLE_CLASSIFICATION)،
//   وما حُفظ في بصمة الجهاز INFO (CYCLE_CLASSIFICATION_SIGNATURE) — **وهذا يقرأ مستنداً إضافياً واحداً لكل تقرير: deviceProfiles/{primary}** (قراءة بحتة، المعرّف مُهشَّر في المخرَج). حمولة النموذج لا تُخزَّن فلا صفّ عن وصول B-08 إليه.
//
// ─── لا كتابة إلا ملفّ المخرَج ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly. Auth: عملية واحدة، getUserByEmail. Storage: bucket بقائمة بيضاء (file(path).exists/download/getMetadata؛ destination يرمي TRAP) — الملفّ يُنزَّل إلى الذاكرة ويُترك. المعرّفات مُهشَّرة
// (hashIdForLog): لا بريد ولا uid ولا scanId ولا sessionId ولا shortId ولا مسار Storage خامّاً. نصّ خطأ المزوّد لا يُكتب (القاعدة 36). projectId مثبَّت. الاعتماد من بيئة الطرفية وحدها (ADC).
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج ولا بند FAIL · 1 = كُتب المخرَج وفيه FAIL واحد على الأقلّ · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال). (NOT_MEASURED وINFO لا يغيّران الرمز: الجدول يقولهما.)
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/device-check-03-after-readonly.js --preflight
//   node functions/scripts/device-check-03-after-readonly.js --tokens "B1=NC-XXXXXX,B2=NC-XXXXXX,S1=NC-XXXXXX,S2=NC-XXXXXX,WAIT=NC-XXXXXX" --out <evidence>/device-check-03-after-<تاريخ+03>.json
//   الجولة ٢ (ختم 70؛ والإصدار B8 على 1.0.12 وS1 وS2 على 1.0.14 — الجزء السابع) — الوسوم B8 وS1 وS2 وجدول توقّعاتها (الغائب --round = الجولة ١ أعلاه):
//   node functions/scripts/device-check-03-after-readonly.js --tokens "B8=NC-XXXXXX,S1=NC-XXXXXX,S2=NC-XXXXXX" --round 2 --cycle-expect "B8=classified,S1=none,S2=none" --out <evidence>/device-check-03-after-r2-<تاريخ+03>.json
//   (إن لم تُجرَ الجلسة الثانية: --tokens "B8=NC-XXXXXX,S1=NC-XXXXXX" و--cycle-expect "B8=classified,S1=none" — --cycle-expect لا يقبل وسماً ليس في --tokens.)
//   ما لا يُحكم به من الخادم: ظهور البطاقة على شاشة الزبون (الوثيقة :193) — يُحكم به من ج٨ (سجلّ الهاتف)، ولا صفّ له هنا.
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const D = require('./lib/deviceCheck03After');

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, auth?: Object, bucket?: Object}} [io] db وauth وbucket تُحقَن للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = D.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = D.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: D.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد.
    C.assertOutWritable(args.out);
    const email = C.readOwnerEmail(env);
    err(`[device-check-03-after] project=${C.PROJECT_ID} target=${target} tokens=${args.tokens.length} storage=${args.useStorage ? 'in-memory read' : 'not read (--no-storage)'} (read-only; the only file written is --out)`);
    const injected = io.db ? {db: io.db, auth: io.auth, bucket: io.bucket} : C.initReadOnlyAdmin({appName: 'device-check-03-after-readonly', withAuth: true, withStorage: args.useStorage});
    const db = C.wrapReadOnly(injected.db);
    const bucket = args.useStorage ? C.wrapReadOnlyBucket(injected.bucket) : null;
    const nowMs = now();
    const {uid, accountHash} = await C.resolveOwner({auth: injected.auth, email});
    const accountReportsCount = await C.countAccountReports(db, uid);
    const evaluated = [];
    for (const {tag, shortId} of args.tokens) {
      const facts = await D.gatherReportFacts({db, bucket, tag, shortId, accountHash, useStorage: args.useStorage});
      evaluated.push(D.evaluateReport(facts, {accountHash, cycleExpect: args.cycleExpect, round: args.round}));
    }
    const assembled = D.assembleOutput(evaluated);
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: D.MODE,
      schema: C.SCHEMA,
      generatedAtPlus03: C.nowPlus03(nowMs),
      input: {tags: args.tokens.map((t) => ({tag: t.tag, shortIdHash: C.hashIdForLog(t.shortId)})), round: args.round, cycleExpect: args.cycleExpect, storageRead: args.useStorage ? 'in-memory (never saved)' : 'not read (--no-storage)', expectedAppVersion: D.EXPECTED_APP_VERSION},
      owner: {accountHash, accountReportsCount, countMethod: "reports.where('userId' == uid).count() — s10PostDeploy.countAccountReports (the same as device-check-03-before)"},
      criteria: {cpuDShare: {text: D.D_SHARE_CRITERION_TEXT, maxPercent: D.D_SHARE_MAX_PERCENT, source: 'user decision 2026-10-08, quoted in the order'}},
      expectations: D.expectationsOutput(args.tokens.map((t) => t.tag), args.round),
      rules: args.round === 2 ? D.ITEM_RULES_R2 : D.ITEM_RULES,
      reports: assembled.reports,
      table: assembled.table,
      summary: assembled.summary,
    };
    C.writeOutputExclusive(args.out, doc);
    const v = assembled.summary.verdicts;
    out(`device-check-03 after written: tags=${args.tokens.map((t) => t.tag).join(',')} rows=${assembled.summary.rows} PASS=${v.PASS} FAIL=${v.FAIL} NOT_MEASURED=${v.NOT_MEASURED} INFO=${v.INFO} accountReportsCount=${accountReportsCount}`);
    return assembled.summary.hasFail ? C.EXIT.FAIL : C.EXIT.OK;
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
