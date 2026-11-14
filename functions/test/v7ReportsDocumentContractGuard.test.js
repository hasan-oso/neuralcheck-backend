'use strict';

// v7ReportsDocumentContractGuard.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٧٥، البند ٣)، القاعدة 39 (نُقلت بنصّها): "الفخّ الذهبي يتبع
// العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في اللحظة نفسها."
//
// **مثل** test/v7ClientPayloadContractGuard.test.js حرفياً (نفس الأسلوب،
// نفس القيد "لا يقارن بنسخ مستودعَي التطبيق/الموقع") — لكن على عيّنة مستند
// reports/{scanId} (البند أ من هذه المهمّة، `v7-reports-document-sample.json`)
// بدل عيّنة إرجاع analyzeDevice. يحرس **الطرف الثاني وحده**: أن الثابت
// المُجمَّد المُلتزَم لا يزال يطابق ما يُنتجه buildReportsDocumentSample()
// فعلياً من نفس مُدخلاته الثابتة — أي تغيير في buildReportDocument
// (analyzeDevice.js) أو في السلسلة التي تغذّيه (buildClientPayloadSample)
// بلا إعادة توليد الثابت يُسقط هذا الاختبار فوراً.
//
// يستدعي المولّد **في الذاكرة فقط** — buildReportsDocumentSample() لا تكتب
// أي ملفّ، ولا يكتب هذا الاختبار الملفّ المُلتزَم بأي حال.
//
// **إثبات السقوط الحقيقي** (مطلوب صراحة، القرار ٧٥ البند ٣: "أثبِت أنه
// يسقط حقاً: عدّل العيّنة المُلتزَمة مؤقّتاً، فيجب أن يُخفق، ثم أرجعها"):
// شُغِّل هذا الاختبار يدوياً بعد تعديل مؤقّت لحقل `deviceMarketingName` في
// الملفّ المُلتزَم (raw fixture) فأخفق فعلاً برسالة تسمّي المسار والفرق —
// راجع تقرير المهمّة تحت "قياس قبل/بعد" للنتيجة الحرفية. أُعيد الملفّ إلى
// حالته الصحيحة فوراً بعد الإثبات (raw fixture مرّة أخرى، لا نسخة يدوية).
//
// Run: node functions/test/v7ReportsDocumentContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildReportsDocumentSample} = require('../scripts/generate-v7-reports-document-sample');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-reports-document-sample.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const RAW_GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-report-raw-sample.json');
const committedRaw = JSON.parse(fs.readFileSync(RAW_GOLDEN_PATH, 'utf8'));

// ─── بناء في الذاكرة وحدها — صفر كتابة. ─────────────────────────────────
const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {reportDocument: fresh, rawDocument: freshRaw} = buildReportsDocumentSample();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildReportsDocumentSample لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

// ─── مقارنة مساراً بمسار، باستثناء shortId (عشوائي بتصميمه —
// generateShortId() تُستدعى مرّة لكل تشغيلة، نفس استثناء الحارس الشقيق). ──
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
  if (diffs.length > 50) console.error(`  ... و${diffs.length - 50} فرقاً آخر`);
  console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً، راجع الطباعة أعلاه`);

// ─── عيّنة الخامّ الشقيقة (V8 نقل الخامّ، 2026-10-09، القاعدة 39) ───────────────
// الخامّ (rawFingerprint، sessionId، deviceFingerprintSha، timeSeriesStoragePath، aiAudit) انتقل من
// مستند التقرير المقروء إلى reportRaw/{scanId}؛ عيّنته v7-report-raw-sample.json تُولَّد في الجولة نفسها
// من المُدخلات نفسها وتُقارَن بالطازج حرفاً بحرف. وما كان هذا الحارس يثبته على aiAudit داخل
// المستند صار يُثبَت على عيّنة الخامّ (القاعدة 23: يُستبدَل لا يُضاف).
const rawDiffs = [];
diffPaths(freshRaw, committedRaw, '', rawDiffs);
if (rawDiffs.length > 0) {
  console.error(`\n⚠️ عيّنة الخامّ المُلتزَمة (${RAW_GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${rawDiffs.length} فرقاً:`);
  for (const d of rawDiffs.slice(0, 50)) console.error(`  ${d}`);
  console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample.js ثم git add/commit للثوابت المُحدَّثة (القاعدة 39).\n');
}
ok(rawDiffs.length === 0, `عيّنة الخامّ المُلتزَمة = مخرَج المولّد الطازج حرفاً بحرف — ${rawDiffs.length} فرقاً`);
for (const f of REPORT_RAW_FIELDS) ok(!(f in committed), `[V8] المستند المقروء المُلتزَم لا يحمل "${f}" (انتقل إلى reportRaw)`);
for (const f of REPORT_RAW_FIELDS) ok(f in committedRaw, `[V8] عيّنة الخامّ تحمل "${f}"`);
ok(!('userId' in committedRaw), '[V8] عيّنة الخامّ بلا userId (الخادم وحده يقرؤها، قرار المستخدم)');
ok('userId' in committed, '[V8] المستند المقروء يحمل userId (يبقى، قرار 2026-10-09)');

console.log(`\nv7ReportsDocumentContractGuard.test.js: ${n}/${n} assertions passed`);
