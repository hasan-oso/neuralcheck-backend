#!/usr/bin/env node
'use strict';

// ===================================================================
// migrate-report-raw — يرحّل الخامّ من reports/{scanId} إلى reportRaw/{scanId} للتقارير الموجودة
// (V8 نقل الخامّ، الجزء ٢، 2026-10-09 +03؛ والمرحلتان: V8 قبل نشر الأمان، 2026-10-09). المنطق كلّه في scripts/lib/reportRawMigration.js؛ هذا الملفّ
// يحلّل الوسائط، ويفتح Admin SDK بـprojectId مثبَّت، ويطبع الخلاصة JSON على stdout.
//
// ⚠️ **يشغّله المستخدم بيده وحده** («لا يُكتب شيء في الإنتاج إلا بيدي»، و«لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر
// صريح منّي ونسخة احتياطية»). هذا الوكيل يكتبه ولا يشغّله على الإنتاج. (جُرِّب على محاكي Firestore وحده: functions/test/migrateReportRaw.e2e.test.js.)
//
// ─── مراحله (قرار المستخدم بنصّه: «--apply بمرحلتين: نعم. المرحلة الأولى تنسخ إلى reportRaw ولا تحذف، ثم تحقّق بالأداة، ثم المرحلة الثانية تحذف
//     الحقول من التقرير، بكتلة منفصلة وأمر صريح منّي.») ──────────────────────────────────────────────────────────────────────────────
//   --dry-run  (الافتراضي) قراءة بحتة (wrapReadOnly): أعداد ما سيُفعل في كل مرحلة، بالمعروض والمُباع وحدهما أيضاً.
//   --apply --phase copy     المرحلة ١: تنسخ إلى reportRaw **ولا تحذف شيئاً** (يحرسها assertCopyPayload). تشترط:
//                --backup <ملفّ.jsonl>  خارج أيّ مستودع (يُرفض داخله). تُكتب فيه نسخة كل ما سيُحذف لاحقاً ويُفرَّغ (fsync) قبل أيّ نسخ.
//                --plan <مخرَج --dry-run>  فإن انجرفت الأعداد عنه فوق العتبة، أو ظهر تعارض: لا تبدأ.
//   --verify-copy [--backup <ملفّ>]  قراءة بحتة بين المرحلتين: يقارن كل تقرير يحمل حقلاً منقولاً بـreportRaw الخاصّ به **بالبايت** ويعدّ
//                المطابق والمختلف والغائب؛ وevaluations؛ ومع --backup يفحص أن لكل ما سيُحذف سطراً بتجزئته. مخرَجه هو «الخطّة» التي تشترطها المرحلة ٢.
//                رمز الخروج 0 إن ready، و2 إن منعه شيء (blockers).
//   --apply --phase delete   المرحلة ٢: تحذف الحقول المنقولة من reports والمعرّفات من evaluations (يحرسها assertDeletePayload: لا تلمس reportRaw).
//                تشترط:
//                --backup <ملفّ النسخة نفسه من المرحلة ١>  موجود وغير فارغ، وهو الذي جرى عليه --verify-copy (عدد أسطره وتجزئته كما في الخطّة)، وإلا تتوقّف قبل أيّ اتصال.
//                --plan <مخرَج --verify-copy>  بـready=true ومع --backup.
//                ولا تحذف حقلاً من تقرير إلا إذا تطابق reportRaw بالبايت وكان له سطر في النسخة بالتجزئة نفسها (يُعاد التحقّق في معاملة الحذف نفسها)؛
//                وكل ما سواه يُعدّ، وتتوقّف قبل أيّ حذف (المسح الأوّل) أو عند أوّل مخالفة (أثناء الحذف).
//   --verify   قراءة بحتة بعد الترحيل. «0 باقياً» (reports بلا أيّ من المفاتيح الخمسة) شرط القرار ٥؛
//              رمز الخروج 3 إن بقي شيء، و4 إن بقيت معرّفات في evaluations وحدها.
//   --restore --backup <ملفّ>  معاينة التراجع؛ ومعه --apply يكتب (يعيد الحقول ويحذف مستندات الخامّ التي أنشأها الترحيل).
//              صحيح بعد المرحلة ١ وحدها (الحقول ما زالت في التقرير: يُحذف الخامّ المنسوخ فقط) وبعد المرحلتين (تُعاد الحقول ثم يُحذف الخامّ).
//
// رموز الخروج: 0 تمّ · 1 استعمال/خطأ · 2 توقّف مقصود (تعارض/انجراف/مخالفة مقارنة/فشل/ما لم يُكتب/ما منع المرحلة ٢) · 3 و4 من --verify.
//
// ─── الاعتماد ──────────────────────────────────────────────────────────────────
// من بيئة الطرفية وحدها (ADC: gcloud auth application-default login، أو GOOGLE_APPLICATION_CREDENTIALS). لا مفتاح في سطر
// أمر ولا في ملفّ. projectId مثبَّت في الكود (neuralchek-9b6d7) كسكربتات *-readonly.js.
//
// ─── القاعدة 36 ────────────────────────────────────────────────────────────────
// stdout: أعداد ومعرّفات مهشَّرة (12 حرفاً) فقط — لا قيمة خامّ، ولا نصّ خطأ غير منقّى. القيم الخامّ في ملفّ النسخة وحده.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/migrate-report-raw.js --dry-run > <evidence>/report-raw-migration-dry-run-<تاريخ+03>.json
//   node functions/scripts/migrate-report-raw.js --apply --phase copy --backup <مسار خارج المستودعات>.jsonl --plan <ملفّ --dry-run>
//   node functions/scripts/migrate-report-raw.js --verify-copy --backup <ملفّ النسخة نفسه> > <evidence>/report-raw-migration-verify-copy-<تاريخ+03>.json
//   node functions/scripts/migrate-report-raw.js --apply --phase delete --backup <ملفّ النسخة نفسه> --plan <ملفّ --verify-copy>     (كتلة منفصلة وأمر صريح)
//   node functions/scripts/migrate-report-raw.js --verify > <evidence>/report-raw-migration-verify-<تاريخ+03>.json
// ===================================================================

const {PROJECT_ID} = require('./audit-device-profiles-readonly');
const M = require('./lib/reportRawMigration');

function initAdmin() {
  const admin = require('firebase-admin');
  const appName = 'migrate-report-raw';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

/** المحاكي أم الإنتاج — يُطبع أوّل شيء كي لا يُظنّ أحدهما الآخر. */
function describeTarget(env = process.env) {
  return env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
}

async function main(argv) {
  let args;
  try {
    args = M.parseArgs(argv);
  } catch (e) {
    console.error(`✗ ${e.message}`);
    return M.EXIT.ERROR;
  }

  // كلّ ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: مسار النسخة، والخطّة، وملفّ النسخة (موجود، غير فارغ، هو الذي جرى عليه --verify-copy).
  let plan = null;
  try {
    if (args.mode === M.MODES.APPLY && args.phase === M.APPLY_PHASES.COPY) {
      M.assertBackupPathOutsideRepos(args.backup);
      plan = M.loadPlan(args.plan, 'dry-run');
    } else if (args.mode === M.MODES.APPLY && args.phase === M.APPLY_PHASES.DELETE) {
      plan = M.loadPlan(args.plan, 'verify-copy');
      M.assertBackupReadyForDelete(args.backup, plan);
    } else if (args.mode === M.MODES.VERIFY_COPY && args.backup) {
      M.inspectBackupFile(args.backup);
    } else if (args.mode === M.MODES.RESTORE) {
      M.readBackupLines(args.backup);
    }
  } catch (e) {
    console.error(`✗ ${M.sanitizeError(e).message}`);
    return M.EXIT.ERROR;
  }

  const target = describeTarget();
  const log = (m) => console.error(m);
  const modeLabel = `${args.mode}${args.phase ? ` phase=${args.phase}` : ''}${args.mode === M.MODES.RESTORE && args.restoreApply ? ' (apply)' : ''}`;
  log(`[migrate-report-raw] project=${PROJECT_ID} target=${target} mode=${modeLabel}`);

  const {db} = initAdmin();
  let result;
  if (args.mode === M.MODES.DRY_RUN) result = await M.runDryRun({db, target, log});
  else if (args.mode === M.MODES.VERIFY) result = await M.runVerify({db, target, log});
  else if (args.mode === M.MODES.VERIFY_COPY) result = await M.runVerifyCopy({db, target, backupPath: args.backup, log});
  else if (args.mode === M.MODES.APPLY && args.phase === M.APPLY_PHASES.COPY) result = await M.runApplyCopy({db, target, backupPath: args.backup, plan, log});
  else if (args.mode === M.MODES.APPLY) result = await M.runApplyDelete({db, target, backupPath: args.backup, plan, log});
  else result = await M.runRestore({db, target, backupPath: args.backup, apply: args.restoreApply, log});

  console.log(JSON.stringify(result.summary, null, 2));
  return result.exitCode;
}

module.exports = {main, describeTarget, initAdmin};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    // القاعدة 36 — نصّ منقّى: الرمز واسم الصنف ورسالة تُخفى فيها المعرّفات.
    const s = M.sanitizeError(e);
    console.error(`✗ توقّف بخطأ: [${s.className}] code=${s.code} ${s.message}`);
    process.exitCode = M.EXIT.ERROR;
  });
}
