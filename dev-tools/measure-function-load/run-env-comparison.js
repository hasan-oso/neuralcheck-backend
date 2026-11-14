'use strict';
// run-env-comparison.js — قياس للقراءة وحدها: يعزل أثر بيئة العملية عن
// أثر الالتزام. أمر المنسّق (متابعة 2026-09-27 +03): القياس الأصلي
// (run-measurement.js) استعمل نمط بيئة (buildMinimalEnv) يُبقي SystemRoot/
// TEMP/TMP/ComSpec/HOME — وهذه بالضبط المتغيّرات التي **غابت** عن العملية
// الفرعية الحقيقية في تشغيل النشر الجافّ الفاشل (PowerShell، $env:HOME
// فارغ)، بينما غابت عن قياسي متغيّرات **حضرت** فعلياً في تلك العملية
// الحقيقية (GCLOUD_PROJECT، GOOGLE_CLOUD_QUOTA_PROJECT، FIREBASE_CONFIG،
// CLOUD_RUNTIME_CONFIG) — أي أن النمط الأصلي معاكس تماماً لبيئة CLI
// الحقيقية على ويندوز، لا تقريب لها.
//
// يُشغِّل بوسيط واحد functionsDir: 5 تشغيلات بنمط buildMinimalEnv (القديم)
// ثم 5 بنمط buildCliLikeEnv (الجديد، الأقرب لِما رصده المنسّق من مصدر
// firebase-tools — منقول وغير متحقَّق في هذا المستودع)، بمهلة استعداد
// 60000ms لكل تشغيل (لا 10000) — فإن لم يصل 200 خلالها يُسجَّل ذلك نتيجةً
// صريحة (error + stderr مُنقًّى، لا استثناء أداة).
//
// PATH يبقى من بيئة العملية الحالية في كلا النمطين — فرق باقٍ غير قابل
// للمطابقة بين Git Bash وPowerShell، لا يُحاول هذا السكربت سدّه.
const path = require('path');
const {runOnce} = require(path.join(__dirname, 'measure-load.js'));

async function runPattern(functionsDir, bin, envPattern, n) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    const r = await runOnce({functionsDir, firebaseFunctionsBin: bin, envPattern, readyTimeoutMs: 60000});
    runs.push({
      i, ok: r.ok, ms: r.ms, startupMs: r.startupMs, loadMs: r.loadMs,
      error: r.error, exitedBySignal: r.exitedBySignal,
      // stderr مُنقًّى بالفعل داخل measure-load.js (sanitizeText) — يُدرَج
      // فقط حين لا نجاح، تفادياً لتضخيم المخرَج بلا حاجة.
      stderrIfFailed: r.ok ? null : r.stderr,
    });
  }
  const msValues = runs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const stats = msValues.length ? {min: msValues[0], median: msValues[Math.floor(msValues.length / 2)], max: msValues[msValues.length - 1]} : null;
  return {envPattern, runs, allMsValues: msValues, stats, failureCount: runs.filter((r) => !r.ok).length};
}

async function main() {
  const functionsDir = process.argv[2];
  if (!functionsDir) { console.error('usage: node run-env-comparison.js <functionsDir>'); process.exit(1); }
  const bin = path.join(functionsDir, 'node_modules', 'firebase-functions', 'lib', 'bin', 'firebase-functions.js');

  // الترتيب بأمر المستخدم بحرفه: «خمس مرّات بالنمط الجديد، وفي الجلسة نفسها
  // خمس مرّات بالنمط القديم» — cliLike أولاً، ثم minimal.
  const cliLike = await runPattern(functionsDir, bin, 'cliLike', 5);
  const minimal = await runPattern(functionsDir, bin, 'minimal', 5);

  const out = {
    functionsDir,
    generatedAtIso: new Date().toISOString(),
    readyTimeoutMs: 60000,
    order: ['cliLike', 'minimal'],
    cliLike,
    minimal,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
