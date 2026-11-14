#!/usr/bin/env node
'use strict';

// ===================================================================
// verify-s10-postdeploy-readonly — قراءة فقط. فحص الخادم بعد نشر الدوالّ والقواعد من فحص S10 واحد على 1.0.10. قبل نشر الأمان، 2026-10-09 +03.
//
// قرار المستخدم، بنصّه (منقول من أمر المنسّق): «بعد نشر الدوالّ والقواعد مباشرة، أجري فحصاً واحداً من الـS10 وهو على 1.0.10، من الرئيسية. يُقبل إن
// صدر التقرير، وكُتب reportRaw بالكتابة الذرّية، وخُصم الرصيد مرّة واحدة، ولم يبقَ حجز معلّق. ويُقرأ ذلك بكتلة قراءة تأتيني. وإن فشل: تراجع إلى
// d5b6c29 قبل أيّ ترحيل.» ونطاق التراجع بنصّه في scripts/lib/s10PostDeploy.js (وفيه الشروط الأربعة وكل حالة باسمها والحكم).
//
// **يشغّله المستخدم بيده** (بكتل يكتبها المنسّق). هذا الوكيل يكتبه ويختبره على المحاكي ولا يشغّله على الإنتاج.
//
// ─── الوضعان ──────────────────────────────────────────────────────────────────────────────────────────────────────
//   --before --out <before.json>
//       قبل الفحص. بريد حساب الـS10 من متغيّر البيئة S10_ACCOUNT_EMAIL (يضبطه المستخدم بإدخال مخفيّ؛ **لا من سطر الأمر، ولا يُطبَع ولا يُكتب**).
//       getUserByEmail ← users/{uid}.scansRemaining وعدد تقارير الحساب. يكتب: معرّفاً مُهشَّراً (hashIdForLog)، scansRemaining، العدد، الوقت.
//   --after --short-id NC-XXXXXX --before <before.json> --out <after.json>
//       بعد الفحص. يجد التقرير بـshortId ويتحقّق من الشروط الأربعة، كلٌّ بحالة مسمّاة؛ ثم الحكم: SERVER_OK | SERVER_FAIL | UNDETERMINED
//       ومعه نصّ قرار المستخدم المقابل. لا يحتاج البريد (يقارن المعرّف المُهشَّر بما في before.json).
//   --preflight  بلا شبكة: فحص ذاتي للأحكام والحالات والوسائط (ولا يقرأ البريد؛ يقول فقط هل المتغيّر مضبوط).
//
// ─── لا كتابة إلا ملفّ المخرَج ─────────────────────────────────────────────────────────────────────────────────────
// db مغلَّف بـwrapReadOnly (أيّ كتابة Firestore ترمي TRAP). وAuth: عملية واحدة فقط معروضة للشيفرة، getUserByEmail (لا غيرها). والملفّ: UTF-8 بلا BOM
// بالعلم wx (لا استبدال لملفّ موجود). projectId مثبَّت في الكود (نمط *-readonly.js). الاعتماد من بيئة الطرفية وحدها (ADC).
//
// ─── رمز الخروج ────────────────────────────────────────────────────────────────────────────────────────────────────
// 0 = SERVER_OK · 1 = SERVER_FAIL · 3 = UNDETERMINED · 2 = خطأ (وسيط/ملفّ/اتصال/حساب). المخرَج على الشاشة: الحكم وأسماء الحالات وحدها.
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/verify-s10-postdeploy-readonly.js --preflight
//   node functions/scripts/verify-s10-postdeploy-readonly.js --before --out <evidence>/s10-before-<تاريخ+03>.json
//   node functions/scripts/verify-s10-postdeploy-readonly.js --after --short-id NC-XXXXXX --before <evidence>/s10-before-<تاريخ+03>.json --out <evidence>/s10-after-<تاريخ+03>.json
// ===================================================================

const {wrapReadOnly, PROJECT_ID} = require('./audit-device-profiles-readonly');
const L = require('./lib/s10PostDeploy');
const {hashIdForLog} = require('../src/utils/logRedaction');

function initReadOnlyAdmin() {
  const admin = require('firebase-admin');
  const appName = 'verify-s10-postdeploy-readonly';
  const app = admin.apps.some((a) => a && a.name === appName) ?
      admin.app(appName) :
      admin.initializeApp({projectId: PROJECT_ID}, appName);
  // Auth: عملية القراءة الوحيدة المعروضة — لا غيرها يصل إليه باقي الشيفرة.
  const auth = Object.freeze({getUserByEmail: (email) => app.auth().getUserByEmail(email)});
  return {db: app.firestore(), auth};
}

function describeTarget(env = process.env) {
  return env.FIRESTORE_EMULATOR_HOST ? `EMULATOR ${env.FIRESTORE_EMULATOR_HOST}` : 'PRODUCTION';
}

function nowPlus03(nowMs) {
  return new Date(nowMs + 3 * 60 * 60 * 1000).toISOString().replace('Z', '+03:00 (تقريبي، من التشغيل)');
}

/** نصّ خطأ آمن للشاشة: السبب المسمّى وحده إن كان S10Error، وإلا الصنف والرمز (لا رسالة المزوّد — القاعدة 36). */
function safeErrorText(e) {
  if (e && e.name === 'S10Error') return `${e.reason}${e.code ? ` (code=${e.code})` : ''}`;
  return `[${(e && e.constructor && e.constructor.name) || typeof e}] code=${(e && e.code !== undefined) ? e.code : 'NO_CODE'}`;
}

/**
 * @param {string[]} argv
 * @param {{now?: function(): number, out?: function(string): void, err?: function(string): void, env?: Object, db?: Object, auth?: Object}} [io]
 *   db وauth يُحقَنان للاختبار فقط
 * @return {Promise<number>} رمز الخروج
 */
async function main(argv, io = {}) {
  const now = io.now || Date.now;
  const out = io.out || ((s) => console.log(s));
  const err = io.err || ((s) => console.error(s));
  const env = io.env || process.env;
  let args;
  try {
    args = L.parseArgs(argv);
  } catch (e) {
    err(`✗ ${e.message}`);
    return L.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = L.preflightChecks(env);
    out(JSON.stringify({projectId: PROJECT_ID, mode: 'preflight', network: false, readOnly: true, ok: pf.ok, s10EmailEnvPresent: pf.s10EmailEnvPresent, checks: pf.checks}, null, 2));
    return pf.ok ? 0 : L.EXIT.ERROR;
  }

  const target = describeTarget(env);
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال: ملفّ المخرَج، وملفّ «قبل»، والبريد.
    L.assertOutWritable(args.out);
    const beforeData = args.mode === 'after' ? L.readBeforeFile(args.beforeFile) : null;
    const email = args.mode === 'before' ? env[L.S10_EMAIL_ENV] : null;
    if (args.mode === 'before' && (typeof email !== 'string' || email.trim() === '')) throw new L.S10Error('S10_EMAIL_ENV_MISSING');

    err(`[verify-s10-postdeploy] project=${PROJECT_ID} target=${target} mode=${args.mode} (read-only; the only file written is --out)`);
    const injected = io.db ? {db: io.db, auth: io.auth} : initReadOnlyAdmin();
    const db = wrapReadOnly(injected.db);
    const nowMs = now();

    if (args.mode === 'before') {
      const snapshot = await L.takeBeforeSnapshot({db, auth: injected.auth, email, nowMs});
      const doc = {projectId: PROJECT_ID, target, ...snapshot, generatedAtPlus03: nowPlus03(nowMs)};
      L.writeOutputExclusive(args.out, doc);
      out(`s10 before snapshot written: accountHash=${doc.accountHash} scansRemaining=${doc.scansRemaining} accountReportsCount=${doc.accountReportsCount}`);
      return 0;
    }

    const facts = await L.gatherAfterFacts({db, shortId: args.shortId});
    const result = L.evaluateAfter(facts, beforeData);
    const decision = L.decisionFor(result.verdict);
    const doc = {
      projectId: PROJECT_ID, // أوّل حقل (اصطلاح *-readonly.js)
      target,
      mode: 's10-after',
      schema: L.SCHEMA,
      generatedAtPlus03: nowPlus03(nowMs),
      input: {shortIdHash: hashIdForLog(args.shortId), before: {takenAtIso: beforeData.takenAtIso || null, accountHash: beforeData.accountHash, scansRemaining: beforeData.scansRemaining, accountReportsCount: beforeData.accountReportsCount}},
      conditions: result.conditions,
      verdict: result.verdict,
      failed: result.failed,
      undetermined: result.undetermined,
      decision,
    };
    L.writeOutputExclusive(args.out, doc);
    out(`verdict=${result.verdict} failed=[${result.failed.join(',')}] undetermined=[${result.undetermined.join(',')}]`);
    out(decision.forThisVerdict);
    out(decision.phoneNote);
    return L.exitCodeOf(result.verdict);
  } catch (e) {
    err(`✗ ${safeErrorText(e)}`);
    return L.EXIT.ERROR;
  }
}

module.exports = {main, describeTarget, initReadOnlyAdmin, safeErrorText};

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(`✗ توقّف بخطأ: ${safeErrorText(e)}`);
    process.exitCode = L.EXIT.ERROR;
  });
}
