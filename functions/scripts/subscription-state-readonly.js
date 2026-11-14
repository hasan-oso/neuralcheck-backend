#!/usr/bin/env node
'use strict';

// ===================================================================
// subscription-state-readonly — قراءة فقط. حقول الاشتراك والرصيد لحساب واحد بأسمائها وقيمها، وما تحكم به بوابة analyzeDevice وما ستفعله المهمّة المجدولة checkExpiringSubscriptions عليه. 2026-10-14 +03.
//
// **يشغّله المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبه ويختبره بلا شبكة ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── ما يقرؤه ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   بريد الحساب من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**) ← getUserByEmail ← uid (في الذاكرة وحدها) ← users/{uid}.
//   الحقول المطبوعة قائمة بيضاء من عشرة، ولا حقل آخر من المستند: plan · scansRemaining · scansTotal · isActive · expiresAt · subExpiredNotified · subExpiredAt · subExpiryEmailSent · subExpiryFcmDate · freeTrialUsedDevices (عدده فقط).
//   لحساب آخر (مثلاً حساب المحلّ): يغيّر المستخدم قيمة المتغيّر في طرفيّته ويعيد التشغيل. التفاصيل في scripts/lib/subscriptionState.js.
//
// ─── لا كتابة إلا ملفّ المخرَج الاختياري ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Auth: عملية واحدة معروضة، getUserByEmail. المخرَج JSON على stdout (بلا بريد ولا uid: معرّف مُهشَّر)؛ و--out <ملفّ> يكتبه أيضاً
// بالعلم wx (UTF-8 بلا BOM، لا استبدال لملفّ موجود). projectId مثبَّت في الكود. الاعتماد من بيئة الطرفية وحدها (ADC). نصّ خطأ المزوّد لا يُطبَع (القاعدة 36).
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/subscription-state-readonly.js --preflight
//   node functions/scripts/subscription-state-readonly.js
//   node functions/scripts/subscription-state-readonly.js --out <evidence>/subscription-state-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const S = require('./lib/subscriptionState');

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
    args = S.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = S.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: S.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد.
    if (args.out !== null) C.assertOutWritable(args.out);
    const email = C.readOwnerEmail(env);
    err(`[subscription-state] project=${C.PROJECT_ID} target=${target} (read-only${args.out !== null ? '; the only file written is --out' : '; no file written'})`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: 'subscription-state-readonly', withAuth: true});
    const db = C.wrapReadOnly(injected.db);
    const nowMs = now();
    const state = await S.collectSubscriptionState({db, auth: injected.auth, email, nowMs});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: S.MODE,
      schema: 1,
      generatedAtPlus03: S.toPlus03(nowMs),
      ...state,
    };
    if (args.out !== null) C.writeOutputExclusive(args.out, doc);
    out(JSON.stringify(doc, null, 2));
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
