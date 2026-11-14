'use strict';

// v7VerifyReportResponseHonorContractGuard.test.js — أمر مستخدم 2026-09-24
// +03 (القرار ٧٩ البند أ)، القاعدة 39. **مثل** test/v7VerifyReportResponseContractGuard.test.js
// حرفياً — على عيّنة Honor (harnessError، letter=null). يحرس الطرف الثاني
// وحده: أن الثابت المُلتزَم لا يزال يطابق buildVerifyReportResponseSampleHonor()
// فعلياً. في الذاكرة فقط، صفر تعديل على verifyReport.js، صفر نداء نموذج.
//
// Run: node functions/test/v7VerifyReportResponseHonorContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildVerifyReportResponseSampleHonor} = require('../scripts/generate-v7-verifyReport-response-sample-honor');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-verifyReport-response-sample-honor.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {response: fresh, warns} = buildVerifyReportResponseSampleHonor();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildVerifyReportResponseSampleHonor لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');
ok(warns.length === 0, `[بناء] صفر تحذير missingKeys من buildV7Response (القاعدة 22) — ${warns.length}: ${JSON.stringify(warns)}`);

function diffPaths(a, b, p, out) {
  if (p === 'shortId') return;
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

const diffs = [];
diffPaths(fresh, committed, '', diffs);

if (diffs.length > 0) {
  console.error(`\n⚠️ العقد المُلتزَم (${GOLDEN_PATH}) لا يطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً (باستثناء shortId):`);
  for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
  console.error('\nالإصلاح: node scripts/generate-v7-verifyReport-response-sample-honor.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً`);

ok(committed.aiResponse.letter === null, '[دلالة] Honor: aiResponse.letter=null');
ok(committed.aiResponse.harnessErrorReason === 'FUNCTIONAL_RESULTS_UNAVAILABLE',
    '[دلالة] Honor: aiResponse.harnessErrorReason=FUNCTIONAL_RESULTS_UNAVAILABLE');

console.log(`\nv7VerifyReportResponseHonorContractGuard.test.js: ${n}/${n} assertions passed`);
