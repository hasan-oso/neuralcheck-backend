'use strict';

// v7ReportsDocumentHonorContractGuard.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٧٩ البند أ)، القاعدة 39. **مثل** test/v7ReportsDocumentContractGuard.test.js
// حرفياً (نفس الأسلوب) — لكن على عيّنة Honor (harnessError، letter=null)
// بدل 34dff2b8 (letter حقيقي). يحرس **الطرف الثاني وحده**: أن الثابت
// المُجمَّد المُلتزَم لا يزال يطابق ما يُنتجه buildReportsDocumentSampleHonor()
// فعلياً.
//
// يستدعي المولّد **في الذاكرة فقط**، بلا كتابة، بلا نداء نموذج.
//
// Run: node functions/test/v7ReportsDocumentHonorContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildReportsDocumentSampleHonor} = require('../scripts/generate-v7-reports-document-sample-honor');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-reports-document-sample-honor.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const RAW_GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-report-raw-sample-honor.json');
const committedRaw = JSON.parse(fs.readFileSync(RAW_GOLDEN_PATH, 'utf8'));

const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {reportDocument: fresh, rawDocument: freshRaw} = buildReportsDocumentSampleHonor();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildReportsDocumentSampleHonor لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

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
  console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-honor.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً`);

ok(committed.aiResponse.overall.letter === null, '[دلالة] Honor: aiResponse.overall.letter=null');
ok(committed.aiResponse.overall.harnessErrorReason === 'FUNCTIONAL_RESULTS_UNAVAILABLE',
    '[دلالة] Honor: aiResponse.overall.harnessErrorReason=FUNCTIONAL_RESULTS_UNAVAILABLE');

// ─── عيّنة الخامّ الشقيقة (V8 نقل الخامّ، 2026-10-09، القاعدة 39) ───────────────
// الخامّ (rawFingerprint، sessionId، deviceFingerprintSha، timeSeriesStoragePath، aiAudit) انتقل من
// مستند التقرير المقروء إلى reportRaw/{scanId}؛ عيّنته v7-report-raw-sample-honor.json تُولَّد في الجولة نفسها
// من المُدخلات نفسها وتُقارَن بالطازج حرفاً بحرف. وما كان هذا الحارس يثبته على aiAudit داخل
// المستند صار يُثبَت على عيّنة الخامّ (القاعدة 23: يُستبدَل لا يُضاف).
const rawDiffs = [];
diffPaths(freshRaw, committedRaw, '', rawDiffs);
if (rawDiffs.length > 0) {
  console.error(`\n⚠️ عيّنة الخامّ المُلتزَمة (${RAW_GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${rawDiffs.length} فرقاً:`);
  for (const d of rawDiffs.slice(0, 50)) console.error(`  ${d}`);
  console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-honor.js ثم git add/commit للثوابت المُحدَّثة (القاعدة 39).\n');
}
ok(rawDiffs.length === 0, `عيّنة الخامّ المُلتزَمة = مخرَج المولّد الطازج حرفاً بحرف — ${rawDiffs.length} فرقاً`);
for (const f of REPORT_RAW_FIELDS) ok(!(f in committed), `[V8] المستند المقروء المُلتزَم لا يحمل "${f}" (انتقل إلى reportRaw)`);
for (const f of REPORT_RAW_FIELDS) ok(f in committedRaw, `[V8] عيّنة الخامّ تحمل "${f}"`);
ok(!('userId' in committedRaw), '[V8] عيّنة الخامّ بلا userId (الخادم وحده يقرؤها، قرار المستخدم)');
ok('userId' in committed, '[V8] المستند المقروء يحمل userId (يبقى، قرار 2026-10-09)');

console.log(`\nv7ReportsDocumentHonorContractGuard.test.js: ${n}/${n} assertions passed`);
