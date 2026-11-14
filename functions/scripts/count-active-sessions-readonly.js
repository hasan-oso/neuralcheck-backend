#!/usr/bin/env node
'use strict';

// ===================================================================
// count-active-sessions-readonly — قراءة فقط. يعدّ الجلسات الجارية والأقفال الحديثة قبل كل نشر. قبل نشر الأمان، 2026-10-09 +03.
//
// قرار المستخدم (القاعدة 1 الجديدة في CLAUDE.md، بنصّها، منقول من أمر المنسّق):
//   «"جلسة جارية" تُثبَت بالأداة لا بالذاكرة: كتلة قراءة قبل كل نشر تعدّ جلسات pending/scanning المنشأة في آخر ساعتين، وأقفال scanClaims
//    الحديثة، والنشر يتوقّف إن لم يكن الناتج صفراً.»  «والجلستان العالقتان القديمتان خارج الحدّ.»
// المعيار والجرد والحالات في scripts/lib/activeSessions.js (مصدر واحد؛ وفيه سبب كل قرار).
// الدفعة ٩ (2026-10-10 +03): cancelled وexpired وcompleted لا تُعدّ جارية ولا تمنع (تُعدّ في sessions.terminal)؛ وكل حالة غائبة أو غير نصّية أو لا تعرفها الأداة
// تُعلَن في sessions.unclassified وفي الأعداد المانعة وتمنع (القاعدة 22). والجرد يمرّ على scanSessions كلّها ويقرأ status وcreatedAt وحدهما.
//
// **يشغّله المستخدم بيده** (بكتلة يكتبها المنسّق). هذا الوكيل يكتبه ويختبره على المحاكي ولا يشغّله على الإنتاج.
//
// ─── لا كتابة أبداً ────────────────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (المصدر الواحد، audit-device-profiles-readonly.js: أيّ كتابة ترمي TRAP قبل أيّ تنفيذ). لا ملفّ يُكتب.
// ─── projectId مثبَّت في الكود (نمط *-readonly.js) ─ يُطبَع أوّل حقل. الاعتماد من بيئة الطرفية وحدها (ADC).
// ─── --preflight: بلا شبكة. لا يفتح Admin SDK؛ يشغّل فحصاً ذاتياً للمعيار على حالات اصطناعية ويطبع projectId. 0 إن مرّ الكلّ وإلا 2.
// ─── المخرَج: أعداد وحدها. لا معرّف جلسة ولا رمزها ولا معرّف مستخدم (ولا مهشَّر).
//
// الوسيط --claims-window-min <دقائق>: نافذة «الأقفال الحديثة» (claimedAtMs). الافتراضي 120 **مؤقّت** («الحديثة» بلا رقم في القرار؛ المستخدم يحدّده).
//
// رمز الخروج: 0 = كل عدد مانع صفر · 3 = شيء يمنع النشر · 2 = خطأ أو مدخل غير مقروء.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/count-active-sessions-readonly.js --preflight
//   node functions/scripts/count-active-sessions-readonly.js [--claims-window-min <دقائق>] > <evidence>/active-sessions-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const L = require('./lib/activeSessions');

function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'count-active-sessions-readonly';
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

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, db?: Object}} [io] db يُحقَن للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  let args;
  try {
    args = L.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return L.EXIT.ERROR;
  }

  if (args.preflight) {
    const pf = L.preflightChecks();
    out(JSON.stringify({
      projectId: PROJECT_ID, mode: 'preflight', network: false, readOnly: true,
      sessionsWindowMinutes: L.SESSIONS_WINDOW_MIN, claimsWindowMinutesDefault: L.CLAIMS_WINDOW_MIN_DEFAULT,
      ok: pf.ok, checks: pf.checks,
    }, null, 2));
    return pf.ok ? L.EXIT.OK : L.EXIT.ERROR;
  }

  const target = describeTarget();
  err(`[count-active-sessions] project=${PROJECT_ID} target=${target} mode=count (read-only) claimsWindowMin=${args.claimsWindowMin}${args.claimsWindowIsDefault ? ' (default, provisional)' : ''}`);
  const db = io.db || initReadOnlyAdmin().db;
  const nowMs = now();
  const collected = await L.collectActive({db: wrapReadOnly(db), nowMs, claimsWindowMin: args.claimsWindowMin});
  const summary = L.summarize(collected, {claimsWindowMin: args.claimsWindowMin, claimsWindowIsDefault: args.claimsWindowIsDefault});
  out(JSON.stringify({
    projectId: PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
    target,
    mode: 'count-active-sessions',
    generatedAtPlus03: nowPlus03(nowMs),
    ...summary,
  }, null, 2));
  return summary.verdict.blocksDeploy ? L.EXIT.BLOCKS_DEPLOY : L.EXIT.OK;
}

module.exports = {main, describeTarget, initReadOnlyAdmin};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    // القاعدة 36: الرمز واسم الصنف وحدهما، لا e.message ولا e.stack (قد تحمل معرّفاً أو مسار مستند).
    console.error(`✗ توقّف بخطأ: [${(e && e.constructor && e.constructor.name) || typeof e}] code=${(e && e.code !== undefined) ? e.code : 'NO_CODE'}`);
    process.exitCode = L.EXIT.ERROR;
  });
}
