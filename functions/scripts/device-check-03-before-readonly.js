#!/usr/bin/env node
'use strict';

// ===================================================================
// device-check-03-before-readonly — قراءة فقط. لقطة «قبل الجلسات» لفحص الجهاز ٠٣ (1.0.11 على الـS10 والـS21)، الكتلة أ٣. 2026-10-10 +03.
//
// **يشغّله المستخدم بيده** (بكتلة يكتبها المنسّق) على الإنتاج قراءةً. هذا الوكيل يكتبه ويختبره على المحاكي ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── ما يقرؤه ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   بريد حساب المالك (حساب الـS10) من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**) ← getUserByEmail ← uid (في الذاكرة وحدها):
//   • users/{uid}.evaluationEnabled بقيمته ونوعه، وسببه المسمّى من src/sessions/evaluationEnabledState.js (المصدر نفسه الذي تستعمله joinScanSession).
//   • عدد تقارير الحساب (scripts/lib/s10PostDeploy.js: countAccountReports — الطريقة نفسها التي يعدّ بها فحص S10).
//   • عدد الجلسات بحالاتها (scripts/lib/activeSessions.js: collectActive/summarize — القراءة نفسها).
//   التفاصيل في scripts/lib/deviceCheck03Before.js.
//
// ─── لا كتابة إلا ملفّ المخرَج ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Auth: عملية واحدة معروضة، getUserByEmail. الملفّ: UTF-8 بلا BOM بالعلم wx (لا استبدال لملفّ موجود). projectId مثبَّت في الكود.
// الاعتماد من بيئة الطرفية وحدها (ADC). المخرَج بلا بريد ولا uid: معرّف مُهشَّر (hashIdForLog) وأعداد وحالات وحدها.
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال). الشاشة: سطر ملخّص بلا معرّف.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/device-check-03-before-readonly.js --preflight
//   node functions/scripts/device-check-03-before-readonly.js --out <evidence>/device-check-03-before-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const B = require('./lib/deviceCheck03Before');

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, auth?: Object}} [io] db وauth يُحقَنان للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = B.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = B.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: B.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد.
    C.assertOutWritable(args.out);
    const email = C.readOwnerEmail(env);
    err(`[device-check-03-before] project=${C.PROJECT_ID} target=${target} (read-only; the only file written is --out)`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: 'device-check-03-before-readonly', withAuth: true});
    const db = C.wrapReadOnly(injected.db);
    const nowMs = now();
    const snapshot = await B.collectBefore({db, auth: injected.auth, email, nowMs});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: B.MODE,
      schema: C.SCHEMA,
      generatedAtPlus03: C.nowPlus03(nowMs),
      ...snapshot,
    };
    C.writeOutputExclusive(args.out, doc);
    const s = snapshot.activeSessions.sessions;
    const active = Object.entries(s.byStatus).map(([st, v]) => `${st}=${v.total}`).join(' ');
    out(`device-check-03 before written: accountHash=${snapshot.account.accountHash} evaluationEnabled=${snapshot.evaluationEnabled.decision.value}(${snapshot.evaluationEnabled.decision.reason}) ` +
        `accountReportsCount=${snapshot.reports.accountReportsCount} sessions[${active}]`);
    return C.EXIT.OK;
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
