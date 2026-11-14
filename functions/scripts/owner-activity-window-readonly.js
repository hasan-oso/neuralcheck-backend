#!/usr/bin/env node
'use strict';

// ===================================================================
// owner-activity-window-readonly — قراءة فقط. ما كُتب لحساب مالك واحد في نافذة زمنية: تقاريره (ومعها ربط كلّ تقرير بجلسته، ونوعه، وختمه)، وجلساته (حالتها وأوقاتها ومنضمّها وفحصها)، ورصيده الآن. 2026-10-14 +03.
//
// **يشغّله المستخدم بيده** على الإنتاج قراءةً. الوكيل يكتبه ويختبره بلا شبكة وعلى المحاكي ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-09، بنصّه، القاعدة 42): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» ولا كتابة في الإنتاج بأيّ وسيلة.
//
// ─── المدخل ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   بريد المالك من متغيّر البيئة DEVICE_CHECK_03_OWNER_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**).
//   --since <ISO> و--until <ISO>: لحظتان بإزاحة صريحة (مثل 2026-10-14T17:00:00+03:00 أو ...Z)، والنافذة since ≤ createdAt < until ولا تتجاوز 24 ساعة. لا إزاحة = رفض.
//   --out <ملفّ> اختياري: يكتب المخرَج أيضاً بالعلم wx (UTF-8 بلا BOM، لا استبدال لملفّ موجود). الكتابة الوحيدة في السكربت كلّه.
//
// ─── ما يقرؤه وكيف يختار ── التفصيل في scripts/lib/ownerActivityWindow.js وفي حقل selection من المخرَج نفسه ──────────────────────────────────────────────────────
//   التقارير: reports حيث userId == المالك (فحص الجلسة يحمل صاحبَ الجلسة في userId)، والجلسة تُقرأ لكل تقرير من reportRaw/{scanId}.sessionId. الجلسات: scanSessions حيث ownerId == المالك.
//   الاستعلامان مساواة على حقل واحد (الفهرس المفرد التلقائي)؛ النافذة تُطبَّق في الذاكرة. **لا فهرس مركّب، ولا اقتراح فهرس** (القاعدة 43). ونصّ خطأ المزوّد لا يُطبَع (القاعدة 36): الصنف والرمز وحدهما.
//
// ─── لا كتابة إلا ملفّ المخرَج الاختياري ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). Auth: عملية واحدة معروضة، getUserByEmail. المخرَج JSON على stdout بلا بريد ولا uid ولا معرّف خامّ (hashIdForLog) ولا رمز جلسة.
// projectId مثبَّت في الكود. الاعتماد من بيئة الطرفية وحدها (ADC).
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = كُتب المخرَج والنافذة كاملة · 3 = كُتب المخرَج لكنّه ناقص (بلغ سقفاً: انظر completeness) · 2 = خطأ (وسيط/ملفّ/متغيّر بيئة/حساب/اتصال).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/owner-activity-window-readonly.js --preflight
//   node functions/scripts/owner-activity-window-readonly.js --since 2026-10-14T17:00:00+03:00 --until 2026-10-14T18:30:00+03:00
//   node functions/scripts/owner-activity-window-readonly.js --since <ISO+03> --until <ISO+03> --out <evidence>/owner-activity-<تاريخ+03>.json
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const W = require('./lib/ownerActivityWindow');

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
    args = W.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = W.preflightChecks(env);
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: W.MODE, network: false, readOnly: true, ok: pf.ok, ownerEmailEnvPresent: pf.ownerEmailEnvPresent, ownerEmailEnv: C.OWNER_EMAIL_ENV, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج والبريد.
    if (args.out !== null) C.assertOutWritable(args.out);
    const email = C.readOwnerEmail(env);
    err(`[owner-activity-window] project=${C.PROJECT_ID} target=${target} (read-only${args.out !== null ? '; the only file written is --out' : '; no file written'})`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: 'owner-activity-window-readonly', withAuth: true});
    const db = C.wrapReadOnly(injected.db);
    const nowMs = now();
    const activity = await W.collectOwnerActivity({db, auth: injected.auth, email, sinceMs: args.sinceMs, untilMs: args.untilMs, nowMs, caps: io.caps || W.DEFAULT_CAPS});
    const doc = {
      projectId: C.PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: W.MODE,
      schema: W.SCHEMA,
      generatedAtPlus03: W.toPlus03(nowMs),
      ...activity,
    };
    if (args.out !== null) C.writeOutputExclusive(args.out, doc);
    out(JSON.stringify(doc, null, 2));
    return activity.completeness.complete ? C.EXIT.OK : C.EXIT.UNDETERMINED;
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
