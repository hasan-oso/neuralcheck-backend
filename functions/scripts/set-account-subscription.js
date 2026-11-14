#!/usr/bin/env node
'use strict';

// ===================================================================
// set-account-subscription — يضبط expiresAt (Timestamp) لكل حساب يسمّيه المستخدم، والرصيد إن طلبه سطرُه، ويطبع القيم قبل وبعد. 2026-10-14 +03.
//
// **يشغّله المستخدم وحده، مرّة واحدة قبل التسليم**، على الإنتاج. الوكيل يكتبه ويختبره (وحدة بلا شبكة + e2e على المحاكي) ولا يشغّله على الإنتاج.
// قرار المستخدم (2026-10-14، منقول من أمر المنسّق بحروفه): «تاريخ انتهاء حسابات الشريك لا يُضبط بيدي في الكونسول. اكتب كتلة صغيرة مختبرة (تشغيل جافّ أوّلاً، ثم كتابة بأمري) تضبط expiresAt بنوع Timestamp لكل
// حساب أسمّيه، والرصيد إن طلبتُه، وتطبع القيم قبل وبعد. أشغّلها مرّة واحدة قبل التسليم.»
// وقرار المستخدم (2026-10-09، القاعدة 42، بنصّه): «لا حذف من الإنتاج بأيّ وسيلة، ولا سكربت فيه delete على الإنتاج، إلا بأمر صريح منّي ونسخة احتياطية.» — لا حذف هنا (الغلاف: scripts/lib/subscriptionWriteGuard.js).
//
// ─── الوضعان (أحدهما صريح، ولا ثالث) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   --dry-run   قراءة بحتة. يطبع «قبل» و«بعد» (المخطَّط) لتسعة حقول، والتحذيرات، ورمزاً. لا يكتب شيئاً، ولا يُبنى فيه كاتب (db مغلَّف بـwrapReadOnly).
//   --commit --token <T>   معاملة واحدة لكل الحسابات (كلّها أو لا شيء)، ترفض إن اختلف الرمز عن حسابه داخلها، ثم تكتب، ثم تعيد القراءة خارجها وتقارن حقلاً حقلاً.
//
// ─── ما يُكتب ولا شيء غيره ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   users/{uid}.expiresAt (Timestamp: نهاية اليوم المعطى بـ+03) · scansRemaining (set:N أو add:N، على السطور التي تطلبه وحدها) · scansTotal (+N في add وحده). لا plan ولا isActive ولا الأعلام ولا حقل آخر.
//
// ─── ملفّ المدخل: --accounts <ملفّ UTF-8> ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   كل سطر غير فارغ:  <email>,<YYYY-MM-DD>[,set:<N>|add:<N>]   (# تعليق، وحدّ أقصى 10 أسطر حسابات). **البريد لا يُقبل من سطر الأمر، ولا يُطبَع ولا يُكتب**: الحساب يُعرض بـhashIdForLog(uid).
//
// ─── المخرَج ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   JSON على stdout (بلا بريد ولا uid خامّ)؛ و--out <ملفّ> يكتبه أيضاً بالعلم wx (UTF-8 بلا BOM، لا استبدال لملفّ موجود، ويُفحَص مساره **قبل** أيّ اتصال وقبل أيّ كتابة). projectId مثبَّت في الكود؛ الاعتماد من بيئة الطرفية
//   وحدها (ADC)؛ نصّ خطأ المزوّد لا يُطبَع (القاعدة 36): رمزه فقط. --preflight: فحص ذاتي بلا شبكة.
//
// ─── رمز الخروج ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   0 = نجح (الجافّ: طُبع الرمز؛ الكتابة: كُتبت وطابقت القراءةُ الخارجُ المعاملةَ حقلاً حقلاً) · 1 = كُتب وعدم تطابق في القراءة اللاحقة (راجع verification) · 2 = رُفض أو خطأ **قبل أيّ كتابة** (وسيط/ملفّ/سطر/حساب/رمز)
//   · 3 = غير محسوم: خطأ مزوّد أثناء الكتابة (قد تكون ثُبّتت — أعد --dry-run لترى الحال) أو تعذّرت القراءة اللاحقة أو كتابة --out بعدها (المخرَج على stdout هو السجلّ).
//
// Usage (يُشغِّله المستخدم من طرفيّته، من داخل المستودع):
//   node functions/scripts/set-account-subscription.js --preflight
//   node functions/scripts/set-account-subscription.js --dry-run --accounts <ملفّ>  [--out <ملفّ>]
//   node functions/scripts/set-account-subscription.js --commit --accounts <ملفّ> --token <الرمز من الجافّ>  [--out <ملفّ>]
// ===================================================================

const C = require('./lib/deviceCheck03Common');
const L = require('./lib/setAccountSubscription');

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
    args = L.parseArgs(argv);
  } catch (e) {
    err(`✗ ${C.safeErrorText(e)}`);
    return C.EXIT.ERROR;
  }

  if (args.mode === 'preflight') {
    const pf = L.preflightChecks();
    out(JSON.stringify({projectId: C.PROJECT_ID, mode: 'preflight', script: L.MODE, network: false, writesOnlyWithCommit: true, ok: pf.ok, checks: pf.checks}, null, 2));
    return pf.ok ? C.EXIT.OK : C.EXIT.ERROR;
  }

  const target = C.describeTarget(env);
  let doc;
  let exitCode;
  try {
    // كل ما لا يحتاج الشبكة يُفحَص قبل فتح أيّ اتصال وقبل أيّ كتابة: الملفّ والأسطر والتواريخ ومسار --out.
    const input = L.readAccountsFile(args.accounts);
    if (args.out !== null) C.assertOutWritable(args.out);
    const nowMs = now();
    const entries = L.parseAccountsText(input.text, nowMs);
    const inputInfo = {sha256: input.sha256, accountLines: entries.length};
    err(`[${L.MODE}] project=${C.PROJECT_ID} target=${target} mode=${args.mode} ${args.mode === 'commit' ? '(WRITES users/{uid}.expiresAt|scansRemaining|scansTotal only, one transaction for all accounts)' : '(read-only; nothing is written)'}${args.out !== null ? '; the only file written is --out' : '; no file written'}`);
    const injected = io.db ? {db: io.db, auth: io.auth} : C.initReadOnlyAdmin({appName: L.APP_NAME, withAuth: true});
    const readDb = C.wrapReadOnly(injected.db);
    if (args.mode === 'dry-run') {
      const r = await L.runDryRun({readDb, auth: injected.auth, entries, input: inputInfo, nowMs, env});
      doc = r.doc;
      exitCode = C.EXIT.OK;
      err(`[${L.MODE}] token=${r.token}  (covers ${entries.length} account line(s) and the input file; pass it to --commit --token)`);
    } else {
      const writer = L.createGuardedWriter(injected.db); // الكاتب لا يُبنى إلا هنا
      const r = await L.runCommit({readDb, writer, auth: injected.auth, entries, input: inputInfo, token: args.token, nowMs, env});
      doc = r.doc;
      exitCode = r.exitCode;
      err(`[${L.MODE}] ${exitCode === C.EXIT.OK ? '✓ committed; every planned field was read back and matches' : `✗ committed; read-back not clean — see summary and verification in the output (exit ${exitCode})`}`);
    }
  } catch (e) {
    err(`✗ ${C.safeErrorText(e)}`);
    return e && e.exitCode !== undefined ? e.exitCode : C.EXIT.ERROR;
  }
  out(JSON.stringify(doc, null, 2)); // المخرَج أوّلاً: بعد الكتابة هو السجلّ الأهمّ
  if (args.out !== null) {
    try {
      C.writeOutputExclusive(args.out, doc);
    } catch (e) {
      err(`✗ ${C.safeErrorText(e)} — the stdout JSON above is the record`);
      return args.mode === 'commit' ? C.EXIT.UNDETERMINED : C.EXIT.ERROR;
    }
  }
  return exitCode;
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
