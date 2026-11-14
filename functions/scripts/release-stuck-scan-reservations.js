#!/usr/bin/env node
'use strict';

// ===================================================================
// release-stuck-scan-reservations — يعيد الفحصات المحجوزة العالقة (V8 قبل أوّل نشر، 2026-10-09 +03). **جافّ افتراضياً، و--apply للكتابة.**
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «الحجوزات العالقة: سكربت قراءة يعدّ الحجوزات الأقدم من 10 دقائق بلا تقرير، وسكربت إعادة
// منفصل يستدعي releaseScanCredit نفسها، جافّ افتراضياً و--apply بيدي. ولا منظّف مجدوَل الآن. معتمد.»
// سكربت القراءة (يُشغَّل أوّلاً): audit-stuck-scan-reservations-readonly.js. المعيار والجرد مصدر واحد: scripts/lib/stuckReservations.js.
//
// **يشغّله المستخدم بيده وحده.** لا تُشغَّل من الوكيل على الإنتاج. لا منظّف مجدوَل: هذا سكربت يدويّ، لا دالّة ولا مجدوِل.
//
// ─── ما يفعل ───────────────────────────────────────────────────────────────────────────────────────────────────────
//   بلا --apply (الافتراضي): جافّ — db مغلَّف بـwrapReadOnly؛ يعدّ الحجوزات العالقة ويطبع ما سيُعاد، ولا يستدعي releaseScanCredit.
//   --apply: لكل حجز عالق، **بعد إعادة فحص المعيار على الحالة الحيّة** (قراءة جديدة للقفل وreports/{scanId})، يستدعي
//            releaseScanCredit من src/analysis/scanReservation.js — **الدالّة نفسها** التي تستدعيها analyzeDevice عند الفشل، لا نسخة منها
//            (القاعدة 24). هي معاملة تقرأ القفل وتُعيد الفحصة (وتُزيل الجهاز من قائمة الفحص المجاني) وتمحو الحجز: إعادة واحدة مهما تكرّر.
//   لا يحذف مستند القفل (يبقى بحجز null؛ analyzeDevice تعدّ القفل القديم قابلاً للكتابة فوقه — لا أثر).
//
// ─── إعادة فحص المعيار قبل كل إعادة، وما يُتخطّى ───────────────────────────────────────────────────────────────────
//   SKIPPED_CLAIM_GONE · SKIPPED_NOT_STUCK_NOW · SKIPPED_HAS_REPORT_NOW (ظهر تقرير: الفحصة مستهلَكة بحقّ)
//   SKIPPED_RETRY_IN_FLIGHT — **حارس إضافي عن نصّ الأمر**: القفل نفسه حديث (claimedAtMs ≤ 10 دقائق) يعني أن إعادة طلب كتبت القفل للتوّ
//   وتحمل الحجز القديم وتتبنّاه (analyzeDevice.js:491-512)؛ إعادة الفحصة حينها تمنح فحصة مجانية.
//   **قيد مُعلَن:** بين إعادة الفحص وإتمام معاملة releaseScanCredit نافذة ميلّيثانوية؛ لو بدأت إعادة طلب فيها فالمعاملة تقرأ القفل وقد
//   حمل الحجز ويُعيده. لا يمكن إغلاقها من الخارج دون نسخ releaseScanCredit (ممنوع).
//
// ─── projectId مثبَّت، والاعتماد من بيئة الطرفية وحدها ─────────────────────────────────────────────────────────────
// ─── --preflight: بلا شبكة ─────────────────────────────────────────────────────────────────────────────────────────
//   يطبع projectId والمعيار ونتيجة الفحص الذاتي (بلا Admin SDK ولا اتصال). رمز الخروج 0 أو 1.
//
// رموز الخروج: 0 تمّ (الجافّ دائماً 0) · 1 استعمال/خطأ · 2 --apply: فشلت إعادة واحدة على الأقلّ (يبقى حجزها ظاهراً في الجرد).
// المخرَج: أعداد ومعرّفات مهشَّرة (hashIdForLog)، لا معرّف مستخدم صريح (القاعدة 36).
//
// Usage (يُشغِّله المستخدم بيده من طرفيّته، من داخل المستودع):
//   node functions/scripts/release-stuck-scan-reservations.js --preflight
//   node functions/scripts/release-stuck-scan-reservations.js                 # جافّ
//   node functions/scripts/release-stuck-scan-reservations.js --apply         # يكتب
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const L = require('./lib/stuckReservations');

function initAdmin() {
  const admin = require('firebase-admin');
  const appName = 'release-stuck-scan-reservations';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore(), FieldValue: require('firebase-admin/firestore').FieldValue};
}

function describeTarget(env = process.env) {
  return env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
}

function nowPlus03(nowMs) {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

/** وسيط مجهول = خطأ صريح؛ --preflight لا يجتمع مع --apply. */
function parseArgs(argv) {
  const out = {preflight: false, apply: false};
  for (const a of argv) {
    if (a === '--preflight') out.preflight = true;
    else if (a === '--apply') out.apply = true;
    else throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a : '(موضعي)'} — المتاح: --preflight | --apply`);
  }
  if (out.preflight && out.apply) throw new Error('USAGE: --preflight لا يجتمع مع --apply');
  return out;
}

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, initAdmin?: function}} [io]
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return 1;
  }

  if (args.preflight) {
    const pf = L.preflightChecks();
    out(JSON.stringify({
      projectId: PROJECT_ID, mode: 'preflight', network: false, stuckAfterMinutes: L.STUCK_AFTER_MS / 60000,
      writesOnlyWith: '--apply', ok: pf.ok, checks: pf.checks,
    }, null, 2));
    return pf.ok ? 0 : 1;
  }

  const target = describeTarget();
  const mode = args.apply ? 'apply' : 'dry-run';
  err(`[release-stuck-scan-reservations] project=${PROJECT_ID} target=${target} mode=${mode}`);
  const {db, FieldValue} = (io.initAdmin || initAdmin)();
  const nowMs = now();
  const res = await L.releaseStuck({
    db: args.apply ? db : wrapReadOnly(db), FieldValue, apply: args.apply, now,
    log: (m) => err(m),
  });
  const summary = {
    projectId: PROJECT_ID, // أوّل حقل
    target,
    mode,
    generatedAtPlus03: nowPlus03(nowMs),
    criterion: {reservedAtOlderThanMinutes: L.STUCK_AFTER_MS / 60000, reportAbsent: true, recheckedBeforeEachRelease: true},
    before: res.before,
  };
  if (args.apply) {
    Object.assign(summary, {results: res.results, listed: res.listed, failedExamples: res.failedExamples, after: res.after});
  } else {
    summary.wouldRelease = res.wouldRelease;
    summary.note = 'dry run: nothing was written; pass --apply to release';
  }
  out(JSON.stringify(summary, null, 2));
  return args.apply && res.results.FAILED > 0 ? 2 : 0;
}

module.exports = {main, parseArgs, describeTarget, initAdmin};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(`✗ توقّف بخطأ: [${(e && e.constructor && e.constructor.name) || typeof e}] code=${(e && e.code !== undefined) ? e.code : 'NO_CODE'}`);
    process.exitCode = 1;
  });
}
