'use strict';

// v7VerifyReportResponseContractGuard.test.js — أمر مستخدم 2026-09-24 +03
// (القرار ٧٥، البند ٣)، القاعدة 39 (نُقلت بنصّها): "الفخّ الذهبي يتبع
// العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في اللحظة نفسها."
//
// **مثل** test/v7ClientPayloadContractGuard.test.js/v7ReportsDocumentContractGuard.test.js
// حرفياً — على عيّنة استجابة verifyReport V7 (البند ب من هذه المهمّة،
// `v7-verifyReport-response-sample.json`). يحرس **الطرف الثاني وحده**: أن
// الثابت المُجمَّد المُلتزَم لا يزال يطابق ما يُنتجه buildVerifyReportResponseSample()
// فعلياً — أي تغيير في `buildV7Response` (verifyReport.js، عبر نفس تقنية
// new Function المُستعمَلة في generate-v7-verifyReport-response-sample.js)
// أو في مستند reports المُغذّي (البند أ) بلا إعادة توليد الثابت يُسقط هذا
// الاختبار فوراً.
//
// يستدعي المولّد **في الذاكرة فقط** — buildVerifyReportResponseSample() لا
// تكتب أي ملفّ، ولا يكتب هذا الاختبار الملفّ المُلتزَم بأي حال. **صفر
// تعديل على verifyReport.js** (نفس قيد generate-v7-verifyReport-response-sample.js
// — الاستخراج يقرأ مصدره وقت التشغيل فقط).
//
// **إثبات السقوط الحقيقي** (مطلوب صراحة، القرار ٧٥ البند ٣: "أثبِت أنه
// يسقط حقاً: عدّل العيّنة المُلتزَمة مؤقّتاً، فيجب أن يُخفق، ثم أرجعها"):
// شُغِّل هذا الاختبار يدوياً بعد تعديل مؤقّت لحقل `aiResponse.letter` في
// الملفّ المُلتزَم فأخفق فعلاً برسالة تسمّي المسار والفرق — راجع تقرير
// المهمّة تحت "قياس قبل/بعد" للنتيجة الحرفية. أُعيد الملفّ إلى حالته
// الصحيحة فوراً بعد الإثبات.
//
// Run: node functions/test/v7VerifyReportResponseContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildVerifyReportResponseSample} = require('../scripts/generate-v7-verifyReport-response-sample');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-verifyReport-response-sample.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

// ─── بناء في الذاكرة وحدها — صفر كتابة. ─────────────────────────────────
const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {response: fresh, warns} = buildVerifyReportResponseSample();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildVerifyReportResponseSample لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');
ok(warns.length === 0, `[بناء] صفر تحذير missingKeys من buildV7Response (القاعدة 22) — ${warns.length}: ${JSON.stringify(warns)}`);

// ─── مقارنة مساراً بمسار، باستثناء shortId (عشوائي بتصميمه —
// generateShortId() تُستدعى مرّة لكل تشغيلة داخل بناء reportDocument
// المُغذّي، نفس استثناء الحارسين الشقيقين). ──────────────────────────────
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
  console.error('\nالإصلاح: node scripts/generate-v7-verifyReport-response-sample.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً، راجع الطباعة أعلاه`);

console.log(`\nv7VerifyReportResponseContractGuard.test.js: ${n}/${n} assertions passed`);
