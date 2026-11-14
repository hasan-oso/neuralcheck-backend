'use strict';

// v7ReportsDocumentSecurityDowngradeContractGuard.test.js — القرار ٩٥
// البند ٣ (نصّ المستخدم حرفياً): "تدخل العيّنة تحت الحارس، وتُطابَق في
// المستودعات — أي في goldenFixturesGuardCoverage.test.js بمولّد وحارس،
// وفي GENERATED_AND_GUARDED." نفس نمط v7ReportsDocumentContractGuard.test.js
// حرفياً: يستدعي buildReportsDocumentSampleSecurityDowngrade() المُصدَّرة
// (async — resolveV7Report حقيقية، global.fetch وحده مُستبدَل داخل المولّد
// نفسه) في الذاكرة فقط، يقارنها بالثابت المُلتزَم مساراً بمسار، باستثناء
// shortId (عشوائي بتصميم generateShortId).
//
// Run: node functions/test/v7ReportsDocumentSecurityDowngradeContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildReportsDocumentSampleSecurityDowngrade} = require('../scripts/generate-v7-reports-document-sample-security-downgrade');
const {ADJUSTMENT_ACCEPTED_NO_EFFECT} = require('../src/analysis/buildV7Payload');
const {REPORT_RAW_FIELDS} = require('../src/analysis/reportRawStore');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-reports-document-sample-security-downgrade.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
const RAW_GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-report-raw-sample-security-downgrade.json');
const committedRaw = JSON.parse(fs.readFileSync(RAW_GOLDEN_PATH, 'utf8'));

// shortId — عشوائي بتصميم generateShortId (نفس استثناء الحرّاس الشقيقة).
// aiDurationMs/rounds[].durationMs — هذا المولّد وحده (بخلاف الشقيقين) يمرّ
// عبر resolveV7Report الحقيقية (القرار ٩٥-٣: "لا يُستبدل فيه إلا
// global.fetch")، فمدّة الجولة قياس زمن حائط فعلي (Date.now() delta حول
// نداء async حقيقي) لا قيمة مُجمَّدة من فخّ سابق كالشقيقين — تتغيّر بضع
// مللي ثانية بين تشغيلتين حتماً، بلا علاقة بأي تغيير في المنطق.
function diffPaths(a, b, p, out) {
  if (p === 'shortId' || p.endsWith('.shortId')) return;
  if (p === 'aiDurationMs' || p.endsWith('.durationMs')) return;
  if (p === 'v5Metrics.bodyBuildMs') return; // نفس السبب — قياس زمن حائط فعلي لبناء الحمولة
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
  const {reportDocument: fresh, rawDocument: freshRaw} = await buildReportsDocumentSampleSecurityDowngrade();
  const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
  ok(beforeMtime === afterMtime, '[بناء] buildReportsDocumentSampleSecurityDowngrade لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

  // ضابط جوهري — لا يكفي أن يتطابق الملفّان شكلاً؛ يجب أن يحملا فعلياً
  // تعديلاً مقبولاً (applied=true) على security بدليل outcome=FAIL — هذا هو
  // بالضبط الغرض من هذه العيّنة (القرار ٩٥-٣، السبب المباشر: صفر عيّنة
  // ذهبية أخرى تحمل هذا بعد القرار ٩٤-١).
  //
  // ⚠️ **توقّع مقلوب — القرار ٩٨ البند ١ (2026-09-25 +03)**: كان يُثبت
  // letterSource=LLM_ADJUSTED؛ security أصلاً D (أرضية STATE_FAIL_FLOOR)
  // فالتعديل "مقبول بلا أثر" (noEffectReason) لا LLM_ADJUSTED بعد اليوم
  // (نصّ القرار: "letterSource=LLM_ADJUSTED فقط إذا اختلف الحرف النهائي عن
  // الحرف الحتمي") — **العيّنة تبقى على هذه القاعدة بقرار المستخدم صريح**
  // ("وتبقى عيّنةً على هذه القاعدة").
  const secAdj = freshRaw.aiAudit.adjustments.find((a) => a.category === 'security');
  ok(secAdj && secAdj.applied === true, '[القرار ٩٥-٣][جوهري] audit.adjustments.security.applied===true فعلاً في المخرَج الطازج');
  ok(Array.isArray(secAdj.evidenceRefs) && secAdj.evidenceRefs[0].startsWith('categoryStates.testResults[') && secAdj.evidenceRefs[0].endsWith('].outcome'),
      '[القرار ٩٥-٣][جوهري] الدليل بشكل categoryStates.testResults[N].outcome — نتيجة اختبار حقيقية لا حرف/بوّابة');
  eq(secAdj.noEffectReason, ADJUSTMENT_ACCEPTED_NO_EFFECT,
      '[القرار ٩٨/١][كان يُثبت LLM_ADJUSTED قبل هذا القرار] audit.adjustments.security.noEffectReason = ACCEPTED_NO_EFFECT — fromLetter=toLetter=D');
  eq(fresh.aiResponse.categories.security.letterSource, 'DETERMINISTIC',
      '[القرار ٩٨/١][كان LLM_ADJUSTED قبل هذا القرار] aiResponse.categories.security.letterSource=DETERMINISTIC — لا اختلاف حرف');
  eq(fresh.aiResponse.categories.security.adjustmentReason, null,
      '[القرار ٩٨/١] adjustmentReason على العرض null — buildDisplayShapeV7 تُصفِّرها حين !adjustmentApplied');
  eq(fresh.aiResponse.categories.security.adjustmentEvidence, null,
      '[القرار ٩٨/١] adjustmentEvidence على العرض null لنفس السبب');

  const diffs = [];
  diffPaths(fresh, committed, '', diffs);
  if (diffs.length > 0) {
    console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً (باستثناء shortId):`);
    for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-security-downgrade.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
  }
  ok(diffs.length === 0,
      `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً`);

  // ─── عيّنة الخامّ الشقيقة (V8 نقل الخامّ، 2026-10-09، القاعدة 39) ───────────────
  // الخامّ (rawFingerprint، sessionId، deviceFingerprintSha، timeSeriesStoragePath، aiAudit) انتقل من
  // مستند التقرير المقروء إلى reportRaw/{scanId}؛ عيّنته v7-report-raw-sample-security-downgrade.json تُولَّد في الجولة نفسها
  // من المُدخلات نفسها وتُقارَن بالطازج حرفاً بحرف. وما كان هذا الحارس يثبته على aiAudit داخل
  // المستند صار يُثبَت على عيّنة الخامّ (القاعدة 23: يُستبدَل لا يُضاف).
  const rawDiffs = [];
  diffPaths(freshRaw, committedRaw, '', rawDiffs);
  if (rawDiffs.length > 0) {
    console.error(`\n⚠️ عيّنة الخامّ المُلتزَمة (${RAW_GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${rawDiffs.length} فرقاً:`);
    for (const d of rawDiffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-reports-document-sample-security-downgrade.js ثم git add/commit للثوابت المُحدَّثة (القاعدة 39).\n');
  }
  ok(rawDiffs.length === 0, `عيّنة الخامّ المُلتزَمة = مخرَج المولّد الطازج حرفاً بحرف — ${rawDiffs.length} فرقاً`);
  for (const f of REPORT_RAW_FIELDS) ok(!(f in committed), `[V8] المستند المقروء المُلتزَم لا يحمل "${f}" (انتقل إلى reportRaw)`);
  for (const f of REPORT_RAW_FIELDS) ok(f in committedRaw, `[V8] عيّنة الخامّ تحمل "${f}"`);
  ok(!('userId' in committedRaw), '[V8] عيّنة الخامّ بلا userId (الخادم وحده يقرؤها، قرار المستخدم)');
  ok('userId' in committed, '[V8] المستند المقروء يحمل userId (يبقى، قرار 2026-10-09)');

  console.log(`\nv7ReportsDocumentSecurityDowngradeContractGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
