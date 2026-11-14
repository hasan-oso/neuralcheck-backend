'use strict';
// run-measurement.js — يُشغَّل بوسيط واحد: مسار functionsDir. يقوم بـ:
//  - 5 تشغيلات باردة/متتالية بلا مُؤقِّت (قياس زمن نظيف بلا تكلفة القناة
//    الجانبية)، يسجّل كل قيمة خامّاً + الأولى منفصلة (باردة) + min/median/max.
//  - تشغيل سادس واحد بمُؤقِّت require-timer فعّال، لاستخراج أعلى 10 وحدات
//    بزمن self (تحميلها هي، لا فروعها) — تحديد فقط لا أكثر من هذا العدد.
// المخرَج: JSON على stdout (يُعاد توجيهه لملفّ مسمّى من المستدعي).
const path = require('path');
const {runOnce} = require(path.join(__dirname, 'measure-load.js'));

async function main() {
  const functionsDir = process.argv[2];
  if (!functionsDir) { console.error('usage: node run-measurement.js <functionsDir>'); process.exit(1); }
  const bin = path.join(functionsDir, 'node_modules', 'firebase-functions', 'lib', 'bin', 'firebase-functions.js');
  const timerPath = path.join(__dirname, 'require-timer.js');

  const plainRuns = [];
  for (let i = 0; i < 5; i++) {
    const r = await runOnce({functionsDir, firebaseFunctionsBin: bin});
    plainRuns.push({i, ok: r.ok, ms: r.ms, startupMs: r.startupMs, loadMs: r.loadMs, error: r.error, exitedBySignal: r.exitedBySignal});
  }

  const msValues = plainRuns.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const stats = (arr) => arr.length ? {min: arr[0], median: arr[Math.floor(arr.length / 2)], max: arr[arr.length - 1]} : null;

  const timedRun = await runOnce({functionsDir, firebaseFunctionsBin: bin, requireTimerPath: timerPath});
  // نُقسِّم بحسب servingAtMs (طابع العملية الأمّ) مقابل startedAtEpochMs
  // (طابع العملية الفرعية، نفس ساعة الحائط) — قبل الاستماع = إقلاع
  // firebase-functions/express نفسه، بعده = loadStack الفعلي (تحميل
  // functions/index.js وكل ما يتبعه، بند ١ من رسالة المنسّق 2026-09-27).
  const topModulesOf = (arr) => arr
    .slice()
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 10)
    .map((t) => ({request: t.request, parent: t.parent, selfMs: Number(t.selfMs.toFixed(3)), totalMs: Number(t.totalMs.toFixed(3))}));

  let topModulesAll = null;
  let topModulesPreServing = null;
  let topModulesPostServing = null;
  let indexJsDirectChildrenByTotalMs = null; // أعلى تكلفة subtree لكل require
  // مباشر من functions/index.js — أوضح تحديد لِـ«ما يستغرق الوقت»: عمل في
  // المستوى الأعلى لوحدة بعينها ظاهر هنا كإجمالي (totalMs) شبه كامل تفرّعها.
  if (timedRun.timings) {
    topModulesAll = topModulesOf(timedRun.timings);
    if (timedRun.servingAtMs !== null) {
      const pre = timedRun.timings.filter((t) => t.startedAtEpochMs < timedRun.servingAtMs);
      const post = timedRun.timings.filter((t) => t.startedAtEpochMs >= timedRun.servingAtMs);
      topModulesPreServing = topModulesOf(pre);
      topModulesPostServing = topModulesOf(post);
    }
    const indexJsAbs = path.join(functionsDir, 'index.js');
    const directChildren = timedRun.timings.filter((t) => t.parent === indexJsAbs);
    indexJsDirectChildrenByTotalMs = directChildren
      .slice()
      .sort((a, b) => b.totalMs - a.totalMs)
      .map((t) => ({request: t.request, totalMs: Number(t.totalMs.toFixed(2))}));
  }

  const out = {
    functionsDir,
    generatedAtIso: new Date().toISOString(),
    plainRuns,
    coldRun: plainRuns[0],
    stats: {
      ms: stats(msValues),
      allMsValues: msValues,
    },
    timedRun: {
      ok: timedRun.ok,
      ms: timedRun.ms,
      startupMs: timedRun.startupMs,
      loadMs: timedRun.loadMs,
      error: timedRun.error,
      timingsError: timedRun.timingsError,
      timingsCount: timedRun.timings ? timedRun.timings.length : null,
    },
    topModulesBySelfMs_all: topModulesAll,
    topModulesBySelfMs_preServing_bootstrap: topModulesPreServing,
    topModulesBySelfMs_postServing_userCodeLoad: topModulesPostServing,
    indexJsDirectChildrenByTotalMs,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
