'use strict';

// v7VerifyReportResponseSecurityDowngradeContractGuard.test.js — القرار ٩٥
// البند ٣ (الشكل C، "وردّ verifyReport"). نفس نمط
// v7VerifyReportResponseContractGuard.test.js حرفياً: يستدعي
// buildVerifyReportResponseSampleSecurityDowngrade() (async) في الذاكرة
// فقط، يقارنها بالثابت المُلتزَم مساراً بمسار، باستثناء shortId
// وقياسات الزمن الحقيقية (durationMs/bodyBuildMs — نفس استثناء الحارس
// الشقيق B، السبب نفسه: resolveV7Report حقيقية داخل السلسلة).
//
// Run: node functions/test/v7VerifyReportResponseSecurityDowngradeContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {buildVerifyReportResponseSampleSecurityDowngrade} = require('../scripts/generate-v7-verifyReport-response-sample-security-downgrade');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-verifyReport-response-sample-security-downgrade.json');
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
  const {response: fresh} = await buildVerifyReportResponseSampleSecurityDowngrade();
  const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
  ok(beforeMtime === afterMtime, '[بناء] buildVerifyReportResponseSampleSecurityDowngrade لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

  // ⚠️ **توقّع مقلوب — القرار ٩٨ البند ١ (2026-09-25 +03)**: security أصلاً
  // D (أرضية STATE_FAIL_FLOOR) — letterSource=DETERMINISTIC الآن ("مقبول
  // بلا أثر" لا LLM_ADJUSTED)، **بقرار المستخدم صريح تبقى العيّنة على هذه
  // القاعدة**. راجع v7ReportsDocumentSecurityDowngradeContractGuard.test.js
  // للتفصيل الكامل (audit.adjustments.noEffectReason).
  eq(fresh.aiResponse.categories.security.letterSource, 'DETERMINISTIC',
      '[القرار ٩٨/١][كان LLM_ADJUSTED قبل هذا القرار] استجابة verifyReport: security.letterSource=DETERMINISTIC — لا اختلاف حرف (D→D)');
  eq(fresh.aiResponse.categories.security.adjustmentEvidence, null,
      '[القرار ٩٨/١][كان يحمل مرجعاً قبل هذا القرار] adjustmentEvidence على العرض null — buildDisplayShapeV7 تُصفِّرها حين !adjustmentApplied');
  eq(fresh.aiResponse.categories.security.adjustmentReason, null,
      '[القرار ٩٨/١] adjustmentReason على العرض null لنفس السبب');

  const diffs = [];
  diffPaths(fresh, committed, '', diffs);
  if (diffs.length > 0) {
    console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً:`);
    for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
    console.error('\nالإصلاح: node scripts/generate-v7-verifyReport-response-sample-security-downgrade.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
  }
  ok(diffs.length === 0,
      `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف — ${diffs.length} فرقاً`);

  console.log(`\nv7VerifyReportResponseSecurityDowngradeContractGuard.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
