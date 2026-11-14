'use strict';

// v7VerifyReportResponseCpuC06DowngradeContractGuard.test.js — القرار ٩٨
// البند ٢ (الشكل C). نفس نمط
// v7VerifyReportResponseSecurityDowngradeContractGuard.test.js حرفياً:
// يستدعي buildVerifyReportResponseSampleCpuC06Downgrade() (async) في
// الذاكرة فقط، يقارنها بالثابت المُلتزَم مساراً بمسار، باستثناء shortId
// وقياسات الزمن الحقيقية.
//
// Run: node functions/test/v7VerifyReportResponseCpuC06DowngradeContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildVerifyReportResponseSampleCpuC06Downgrade} = require('../scripts/generate-v7-verifyReport-response-sample-cpu-c06-downgrade');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-verifyReport-response-sample-cpu-c06-downgrade.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

function diffPaths(a, b, p, out) {
  if (p === 'shortId' || p.endsWith('.shortId')) return;
  if (p === 'aiDurationMs' || p.endsWith('.durationMs')) return;
  if (p === 'v5Metrics.bodyBuildMs') return;
  if (typeof a !== typeof b) { out.push(`${p}: النوع ${typeof a} ≠ ${typeof b}`); return; }
  if (a === null || b === null) {
    if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${p}: طول المصفوفة ${a.length} ≠ ${b.length}`);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) diffPaths(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) diffPaths(a ? a[k] : undefined, b ? b[k] : undefined, p ? `${p}.${k}` : k, out);
    return;
  }
  if (a !== b) out.push(`${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

(async () => {
  const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
  const {response: fresh} = await buildVerifyReportResponseSampleCpuC06Downgrade();
  const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
  ok(beforeMtime === afterMtime, '[بناء] buildVerifyReportResponseSampleCpuC06Downgrade لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

  eq(fresh.aiResponse.categories.cpu.letterSource, 'LLM_ADJUSTED',
      '[القرار ٩٨-٢][جوهري] استجابة verifyReport: cpu.letterSource=LLM_ADJUSTED فعلياً');
  eq(fresh.aiResponse.categories.cpu.letter, 'C', '[القرار ٩٨-٢][جوهري] cpu.letter=C (تغيّر فعلياً من B)');
  ok(Array.isArray(fresh.aiResponse.categories.cpu.adjustmentEvidence) &&
      fresh.aiResponse.categories.cpu.adjustmentEvidence[0].startsWith('categoryStates.testResults['),
      '[القرار ٩٨-٢][جوهري] adjustmentEvidence يحمل مرجع outcome=FAIL الحقيقي (C-06)، لا حرفاً ولا بوّابة');

  const diffs = [];
  diffPaths(fresh, committed, '', diffs);
  if (diffs.length > 0) {
    console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً:`);
    for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-verifyReport-response-sample-cpu-c06-downgrade.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
  }
  ok(diffs.length === 0,
      `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف — ${diffs.length} فرقاً`);

  console.log(`\nv7VerifyReportResponseCpuC06DowngradeContractGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
