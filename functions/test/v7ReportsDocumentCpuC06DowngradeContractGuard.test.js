'use strict';

// v7ReportsDocumentCpuC06DowngradeContractGuard.test.js — القرار ٩٨ البند
// ٢ (نصّ المستخدم حرفياً): "تدخل العيّنتان تحت الحارس، وتُطابَقان في
// المستودعات." نفس نمط v7ReportsDocumentSecurityDowngradeContractGuard.test.js
// حرفياً: يستدعي buildReportsDocumentSampleCpuC06Downgrade() المُصدَّرة
// (async — resolveV7Report حقيقية، global.fetch وحده مُستبدَل داخل المولّد
// نفسه) في الذاكرة فقط، يقارنها بالثابت المُلتزَم مساراً بمسار، باستثناء
// shortId وقياسات الزمن الحقيقية (durationMs/bodyBuildMs).
//
// Run: node functions/test/v7ReportsDocumentCpuC06DowngradeContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildReportsDocumentSampleCpuC06Downgrade} = require('../scripts/generate-v7-reports-document-sample-cpu-c06-downgrade');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-reports-document-sample-cpu-c06-downgrade.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const RAW_GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-report-raw-sample-cpu-c06-downgrade.json');
const committedRaw = JSON.parse(fs.readFileSync(RAW_GOLDEN_PATH, 'utf8'));

// نفس استثناءات الحارس الشقيق (v7ReportsDocumentSecurityDowngradeContractGuard.test.js):
// shortId عشوائي، والزمن قياس حائط فعلي عبر resolveV7Report الحقيقية.
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
  const {reportDocument: fresh, rawDocument: freshRaw} = await buildReportsDocumentSampleCpuC06Downgrade();
  const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
  ok(beforeMtime === afterMtime, '[بناء] buildReportsDocumentSampleCpuC06Downgrade لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

  // ضابط جوهري — القرار ٩٨-٢: حرف يتغيّر فعلياً (B→C)، letterSource=LLM_ADJUSTED
  // حقيقي بمعنى القرار ٩٨-١ (اختلاف فعلي finalLetter≠deterministicLetter).
  const cpuAdj = freshRaw.aiAudit.adjustments.find((a) => a.category === 'cpu');
  ok(cpuAdj && cpuAdj.applied === true, '[القرار ٩٨-٢][جوهري] audit.adjustments.cpu.applied===true فعلاً');
  eq(cpuAdj.fromLetter, 'B', '[القرار ٩٨-٢][جوهري] fromLetter=B (deterministicLetter بعد تعديل المدخل وحده، قبل أي نموذج)');
  eq(cpuAdj.toLetter, 'C', '[القرار ٩٨-٢][جوهري] toLetter=C (خفض درجة واحدة مقبول فعلاً)');
  ok(!cpuAdj.noEffectReason, '[القرار ٩٨-١][ضابط] لا noEffectReason هنا — الحرف اختلف فعلاً، هذا ليس "مقبولاً بلا أثر"');
  ok(Array.isArray(cpuAdj.evidenceRefs) && cpuAdj.evidenceRefs[0].startsWith('categoryStates.testResults[') && cpuAdj.evidenceRefs[0].endsWith('].outcome'),
      '[القرار ٩٨-٢][جوهري] الدليل بشكل categoryStates.testResults[N].outcome — نتيجة اختبار قياس (C-06) حقيقية لا حرف/بوّابة');
  eq(fresh.aiResponse.categories.cpu.letterSource, 'LLM_ADJUSTED',
      '[القرار ٩٨-٢][جوهري] aiResponse.categories.cpu.letterSource=LLM_ADJUSTED فعلياً — أوّل عيّنة ذهبية بحرف متغيّر فعلاً بعد القرار ٩٨-١');
  eq(fresh.aiResponse.categories.cpu.letter, 'C', '[القرار ٩٨-٢][جوهري] aiResponse.categories.cpu.letter=C');
  ok(typeof fresh.aiResponse.categories.cpu.adjustmentReason === 'string' && fresh.aiResponse.categories.cpu.adjustmentReason.length > 0,
      '[القرار ٩٨-٢] adjustmentReason وصل العرض فعلاً (الحرف اختلف، فلا تصفير)');

  const diffs = [];
  diffPaths(fresh, committed, '', diffs);
  if (diffs.length > 0) {
    console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً (باستثناء shortId/الزمن):`);
    for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
  }
  ok(diffs.length === 0,
      `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId/الزمن) — ${diffs.length} فرقاً`);

  // ─── عيّنة الخامّ الشقيقة (V8 نقل الخامّ، 2026-10-09، القاعدة 39) ───────────────
  // الخامّ (rawFingerprint، sessionId، deviceFingerprintSha، timeSeriesStoragePath، aiAudit) انتقل من
  // مستند التقرير المقروء إلى reportRaw/{scanId}؛ عيّنته v7-report-raw-sample-cpu-c06-downgrade.json تُولَّد في الجولة نفسها
  // من المُدخلات نفسها وتُقارَن بالطازج حرفاً بحرف. وما كان هذا الحارس يثبته على aiAudit داخل
  // المستند صار يُثبَت على عيّنة الخامّ (القاعدة 23: يُستبدَل لا يُضاف).
  const rawDiffs = [];
  diffPaths(freshRaw, committedRaw, '', rawDiffs);
  if (rawDiffs.length > 0) {
    console.error(`\n⚠️ عيّنة الخامّ المُلتزَمة (${RAW_GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${rawDiffs.length} فرقاً:`);
    for (const d of rawDiffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-cpu-c06-downgrade.js ثم git add/commit للثوابت المُحدَّثة (القاعدة 39).\n');
  }
  ok(rawDiffs.length === 0, `عيّنة الخامّ المُلتزَمة = مخرَج المولّد الطازج حرفاً بحرف — ${rawDiffs.length} فرقاً`);
  for (const f of REPORT_RAW_FIELDS) ok(!(f in committed), `[V8] المستند المقروء المُلتزَم لا يحمل "${f}" (انتقل إلى reportRaw)`);
  for (const f of REPORT_RAW_FIELDS) ok(f in committedRaw, `[V8] عيّنة الخامّ تحمل "${f}"`);
  ok(!('userId' in committedRaw), '[V8] عيّنة الخامّ بلا userId (الخادم وحده يقرؤها، قرار المستخدم)');
  ok('userId' in committed, '[V8] المستند المقروء يحمل userId (يبقى، قرار 2026-10-09)');

  console.log(`\nv7ReportsDocumentCpuC06DowngradeContractGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
