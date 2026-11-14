#!/usr/bin/env node
'use strict';

// ===================================================================
// cron-expiry-impact-readonly — قراءة فقط. عدّ ما ستفعله المهمّة المجدولة checkExpiringSubscriptions في أوّل تشغيل بعد وجود الفهرس المفقود: من ستُطفئ وتصفّر رصيده وتراسله، وأيّ جلسات ستغيّر، وأين حساب المالك وحسابات المحلّات.
// 2026-10-14 +03.
//
// **يشغّله المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبه ويختبره بلا شبكة ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── ما يقرؤه ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   users: where isActive == true (مساواة بحقل واحد) مع select لتسعة حقول، ثم تصفية في الذاكرة بشرط المهمّة نفسه. scanSessions: where status == 'pending' ثم 'scanning' (مساواة بحقل واحد) مع select لثلاثة حقول.
//   **لا استعلام يحتاج الفهرس المفقود.** بريد حساب المالك (اختياري) من DEVICE_CHECK_03_OWNER_EMAIL ← getUserByEmail ← uid في الذاكرة وحدها (لا يُطبَع ولا يُكتب).
//   المخرَج: أعداد ومجاميع وتوزيع بحسب الباقة وصفوف مُهشَّرة (حسابات المحلّات + الجلسات العالقة). لا بريد ولا uid ولا معرّف جلسة خامّ؛ ووجود email وfcmToken يُعدّ منطقياً ولا تُطبَع قيمته.
//   التفاصيل في scripts/lib/cronExpiryImpact.js.
//
// ─── لا كتابة إلا ملفّ المخرَج الاختياري ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Auth: عملية واحدة معروضة، getUserByEmail. المخرَج JSON على stdout، و--out <ملفّ> يكتبه أيضاً بالعلم wx (لا استبدال لملفّ موجود، UTF-8 بلا BOM).
// projectId مثبَّت في الكود. الاعتماد من بيئة الطرفية وحدها (ADC). نصّ خطأ المزوّد لا يُطبَع (القاعدة 36).
//
// رمز الخروج: 0 = كُتب المخرَج · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/cron-expiry-impact-readonly.js --preflight
//   node functions/scripts/cron-expiry-impact-readonly.js --out <evidence>/cron-expiry-impact-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const I = require('./lib/cronExpiryImpact');
const S = require('./lib/subscriptionState');

/** الوسائط: --preflight وحدها، أو (بلا وسائط | --out <path>). نفس محلّل subscriptionState (لا بريد ولا شيء آخر من سطر الأمر). */
const parseArgs = S.parseArgs;

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
    args = parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = S.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: I.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد (اختياري: غيابه يُعلَن في المخرَج، وتلفه خطأ).
    if (args.out !== null) C.assertOutWritable(args.out);
    let email = null;
    try {
      email = C.readOwnerEmail(env);
    } catch (e) {
      if (!(e && e.name === 'DeviceCheckError' && e.reason === 'OWNER_EMAIL_ENV_MISSING')) throw e;
    }
    err(`[cron-expiry-impact] project=${C.PROJECT_ID} target=${target} ownerAccountChecked=${email !== null} (read-only${args.out !== null ? '; the only file written is --out' : '; no file written'})`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: 'cron-expiry-impact-readonly', withAuth: true});
    const db = C.wrapReadOnly(injected.db);
    const nowMs = now();
    const impact = await I.collectImpact({db, auth: injected.auth, email, nowMs});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: I.MODE,
      schema: 1,
      generatedAtPlus03: S.toPlus03(nowMs),
      ...impact,
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
