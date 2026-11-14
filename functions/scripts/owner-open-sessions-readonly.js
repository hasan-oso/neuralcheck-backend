#!/usr/bin/env node
'use strict';

// ===================================================================
// owner-open-sessions-readonly — قراءة فقط. الجلسات المفتوحة (pending وscanning) لحساب مالك واحد بكلّ تواريخها: صفّ لكلّ جلسة، وهل انقضى وقتها الآن، وما ارتبط بها. 2026-10-15 +03.
//
// **يشغّله المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبه ويختبره بلا شبكة (db مزيَّف في الذاكرة) ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── المدخل ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   بريد المالك من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**).
//   --out <ملفّ> اختياري: يكتب المخرَج أيضاً بالعلم wx (UTF-8 بلا BOM، لا استبدال لملفّ موجود). الكتابة الوحيدة في السكربت كلّه.
//   --preflight: فحص ذاتي بلا شبكة ولا قراءة.
//
// ─── ما يقرؤه ── التفصيل في scripts/lib/ownerOpenSessions.js وفي حقل selection من المخرَج نفسه ──────────────────────────────────────────────────────────────
//   scanSessions حيث ownerId == المالك (مساواة واحدة؛ الفهرس المفرد التلقائي)، والحالة تُصفّى في الذاكرة. **لا فهرس مركّب، ولا اقتراح فهرس** (القاعدة 43). ونصّ خطأ المزوّد لا يُطبَع (القاعدة 36): الصنف والرمز وحدهما.
//   لكلّ جلسة مفتوحة: الحالة وcreatedAt وexpiresAt وjoinedAt، وjoinedBy وscanId (حضور/غياب ومُهشَّرَين)، وevaluationEnabled (ما على الجلسة، وقيمة حساب المالك الآن)، وهل انقضى وقتها الآن بحكم الخادم نفسه، وهل
//   تمنع النشر بمعيار حارس النشر، وما ارتبط بها (تقارير reportRaw وreports، وأقفال scanClaims) أعداداً.
//
// ─── لا كتابة إلا ملفّ المخرَج الاختياري ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Auth: عملية واحدة معروضة، getUserByEmail. المخرَج JSON على stdout بلا بريد ولا uid ولا معرّف خامّ (hashIdForLog) ولا رمز جلسة.
// projectId مثبَّت في الكود. الاعتماد من بيئة الطرفية وحدها (ADC).
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج كاملاً · 3 = كُتب المخرَج لكنّه ناقص (بلغ سقفاً: انظر completeness) · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/owner-open-sessions-readonly.js --preflight
//   node functions/scripts/owner-open-sessions-readonly.js
//   node functions/scripts/owner-open-sessions-readonly.js --out <مجلّد قائم>/owner-open-sessions-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const O = require('./lib/ownerOpenSessions');

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, auth?: Object, caps?: Object}} [io] db وauth وcaps تُحقَن للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = O.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = O.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: O.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد.
    if (args.out !== null) C.assertOutWritable(args.out);
    const email = C.readOwnerEmail(env);
    err(`[owner-open-sessions] project=${C.PROJECT_ID} target=${target} (read-only${args.out !== null ? '; the only file written is --out' : '; no file written'})`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: 'owner-open-sessions-readonly', withAuth: true});
    const db = C.wrapReadOnly(injected.db);
    const nowMs = now();
    const report = await O.collectOwnerOpenSessions({db, auth: injected.auth, email, nowMs, caps: io.caps || O.DEFAULT_CAPS});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: O.MODE,
      schema: O.SCHEMA,
      generatedAtPlus03: report.now.plus03,
      ...report,
    };
    if (args.out !== null) C.writeOutputExclusive(args.out, doc);
    out(JSON.stringify(doc, null, 2));
    return report.completeness.complete ? C.EXIT.OK : C.EXIT.UNDETERMINED;
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
