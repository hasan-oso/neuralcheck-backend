'use strict';

// v6VerifyReportResponseContractGuard.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٨٢ البند ١)، القاعدة 39 (نُقلت بنصّها): "الفخّ الذهبي يتبع
// العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في اللحظة نفسها."
//
// **مثل** v7VerifyReportResponseContractGuard.test.js حرفياً — على عيّنة
// استجابة verifyReport V6 (`v6-verifyReport-response-sample.json`)، مُشتقّة
// من `v6-reports-document-sample.json` المُلتزَمة (البند ب-١ من نفس
// المهمّة). **هذا الحارس قادر على إعادة بناء كاملة** (بخلاف حارس المستند
// نفسه، v6ReportsDocumentContractGuard.test.js) لأن مُدخله — مستند التقرير
// — مُلتزَم في هذا المستودع، لا خارجه.
//
// يحرس **الطرف الثاني وحده**: أن الثابت المُجمَّد المُلتزَم لا يزال يطابق
// ما يُنتجه buildVerifyReportResponseSampleV6() فعلياً من نفس مُدخله
// الثابت (v6-reports-document-sample.json) — أي تغيير في buildV6Response
// (verifyReport.js، عبر نفس تقنية new Function) أو في مستند V6 المُغذّي
// بلا إعادة توليد الثابت يُسقط هذا الاختبار فوراً.
//
// يستدعي المولّد **في الذاكرة فقط** — buildVerifyReportResponseSampleV6()
// لا تكتب أي ملفّ. **صفر تعديل على verifyReport.js**.
//
// Run: node functions/test/v6VerifyReportResponseContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildVerifyReportResponseSampleV6} = require('../scripts/generate-v6-verifyReport-response-sample');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v6-verifyReport-response-sample.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

// ─── بناء في الذاكرة وحدها — صفر كتابة. ─────────────────────────────────
const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {response: fresh, warns} = buildVerifyReportResponseSampleV6();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildVerifyReportResponseSampleV6 لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');
ok(warns.length === 0, `[بناء] صفر تحذير من buildV6Response — ${warns.length}: ${JSON.stringify(warns)}`);
ok(fresh.grade !== undefined && !('letter' in fresh), '[بناء] الاستجابة من شكل V6 (grade) لا V7 (letter) — الفرع الصحيح ركض فعلاً');

// ─── مقارنة مساراً بمسار — لا استثناء shortId هنا: aiResponse.shortId في
// مستند V6 مُصطنَع أصلاً بالبند ب-١ (fakeSecondaryShortId، ثابت بذاته لا
// عشوائي بين تشغيلتين لأنه يُقرأ من الملفّ المُلتزَم لا يُعاد توليده هنا)،
// وresponse.shortId يعكس rep.shortId الجذر ("[REDACTED]" ثابت). ─────────
function diffPaths(a, b, p, out) {
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
  console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً:`);
  for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
  if (diffs.length > 50) console.error(`  ... و${diffs.length - 50} فرقاً آخر`);
  console.error('\nالإصلاح: node scripts/generate-v6-verifyReport-response-sample.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف — ${diffs.length} فرقاً، راجع الطباعة أعلاه`);

console.log(`\nv6VerifyReportResponseContractGuard.test.js: ${n}/${n} assertions passed`);
