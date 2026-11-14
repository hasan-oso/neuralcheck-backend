#!/usr/bin/env node
'use strict';

// ===================================================================
// audit-stuck-scan-reservations-readonly — قراءة فقط. يعدّ الحجوزات العالقة: مستندات scanClaims بحقل reservation غير null،
// وreservedAtMs أقدم من 10 دقائق، وبلا reports/{scanId}. V8 قبل أوّل نشر، 2026-10-09 +03.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «الحجوزات العالقة: سكربت قراءة يعدّ الحجوزات الأقدم من 10 دقائق بلا تقرير، وسكربت إعادة
// منفصل يستدعي releaseScanCredit نفسها، جافّ افتراضياً و--apply بيدي. ولا منظّف مجدوَل الآن. معتمد.»
// هذا سكربت القراءة. سكربت الإعادة المنفصل: release-stuck-scan-reservations.js. المعيار والجرد مصدر واحد للاثنين:
// scripts/lib/stuckReservations.js (وفيه الفرق عن تعليق scanReservation.js:30-33: 10 دقائق لا TTL=5).
//
// **يشغّله المستخدم بيده** («لا يُكتب شيء في الإنتاج إلا بيدي»؛ وهذا لا يكتب شيئاً أصلاً). لا تُشغَّل من الوكيل على الإنتاج.
//
// ─── لا كتابة أبداً ────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (المصدر الواحد، audit-device-profiles-readonly.js: أيّ كتابة ترمي TRAP قبل أيّ تنفيذ). والاستعلامات:
// مسح scanClaims بترتيب معرّف المستند، وقراءة reports/{scanId} للأقفال ذات الحجز وحدها.
//
// ─── projectId مثبَّت في الكود (نمط *-readonly.js) ─────────────────────────────────────────────────────────────────
// يُطبَع أوّل حقل. والاعتماد من بيئة الطرفية وحدها (ADC: gcloud auth application-default login).
//
// ─── --preflight: بلا شبكة ────────────────────────────────────────────────────────────────────────────────────────
// لا يفتح Admin SDK ولا يتّصل بشيء. يشغّل فحصاً ذاتياً للمعيار (حالات اصطناعية: عالق/على العتبة تماماً/له تقرير/بلا حجز/مشوَّه)
// وصيغة التهشير والعتبة، ويطبع projectId. رمز الخروج 0 إن مرّ الكلّ وإلا 1.
//
// ─── المخرَج: أعداد ومعرّفات مهشَّرة (القاعدة 36) ──────────────────────────────────────────────────────────────────
// scanId ومعرّف المستخدم بـhashIdForLog (سياسة السجلّات). لا معرّف مستخدم صريح. الأعداد كاملة؛ المسرود من المعرّفات سقفه 50.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/audit-stuck-scan-reservations-readonly.js --preflight
//   node functions/scripts/audit-stuck-scan-reservations-readonly.js > <evidence>/stuck-scan-reservations-audit-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const L = require('./lib/stuckReservations');

function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'audit-stuck-scan-reservations-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  return {db: app.firestore()};
}

function describeTarget(env = process.env) {
  return env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
}

function nowPlus03(nowMs) {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

/** وسيط مجهول = خطأ صريح (القاعدة 22). */
function parseArgs(argv) {
  const out = {preflight: false};
  for (const a of argv) {
    if (a === '--preflight') out.preflight = true;
    else throw new Error(`USAGE: وسيط مجهول ${a.startsWith('--') ? a : '(موضعي)'} — المتاح: --preflight`);
  }
  return out;
}

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void}} [io]
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
      readOnly: true, ok: pf.ok, checks: pf.checks,
    }, null, 2));
    return pf.ok ? 0 : 1;
  }

  const target = describeTarget();
  err(`[audit-stuck-scan-reservations] project=${PROJECT_ID} target=${target} mode=audit (read-only)`);
  const {db} = initReadOnlyAdmin();
  const nowMs = now();
  const collected = await L.collectClaims({db: wrapReadOnly(db), nowMs});
  out(JSON.stringify({
    projectId: PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
    target,
    mode: 'audit',
    generatedAtPlus03: nowPlus03(nowMs),
    criterion: {
      collection: L.CLAIMS_COLLECTION,
      reservation: 'not null',
      reservedAtOlderThanMinutes: L.STUCK_AFTER_MS / 60000,
      reportAbsent: `${L.REPORTS_COLLECTION}/{scanId} does not exist`,
    },
    ...L.summarizeCollected(collected),
  }, null, 2));
  return 0;
}

module.exports = {main, parseArgs, describeTarget, initReadOnlyAdmin};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    // القاعدة 36: الرمز واسم الصنف وحدهما، لا e.message ولا e.stack (قد تحمل معرّفاً أو مسار مستند).
    console.error(`✗ توقّف بخطأ: [${(e && e.constructor && e.constructor.name) || typeof e}] code=${(e && e.code !== undefined) ? e.code : 'NO_CODE'}`);
    process.exitCode = 1;
  });
}
