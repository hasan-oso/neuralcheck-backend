'use strict';

// v7ClientPayloadContractGuard.test.js — أمر مستخدم 2026-09-23 +03 (أمر
// التبديل، بعد A125)، القاعدة 39 (جديدة، نُقلت بنصّها): "الفخّ الذهبي يتبع
// العقد، لا يسبقه. كل تغيير في العقد يُعيد توليد الفخّ في اللحظة نفسها،
// وإلّا صار الحارس يحرس نسخة سابقة وينجح."
//
// **حدّ ما يحرسه هذا الاختبار** (نصّ المستخدم حرفياً): "الأداة تحرس
// الاتّساق بين النسخ، والاختبار يحرس تبعيتها للعقد. ولا تُغني إحداهما عن
// الأخرى." هذا الاختبار يحرس **الطرف الثاني وحده**: أن الثابت المُجمَّد
// المُلتزَم (test/fixtures/golden/v7-client-payload-sample.json) لا يزال
// يطابق ما يُنتجه المولّد فعلياً من نفس مُدخلاته الثابتة — أي تغيير في
// buildDisplayShapeV7.js/buildV7ResponseForStorage/applyV7Adjustments (أو
// أي حلقة في السلسلة) بلا إعادة توليد الثابت يُسقط هذا الاختبار فوراً.
// **لا يقارن بنسخ مستودعَي التطبيق/الموقع** — تلك أداة في مساحة العمل،
// عند المنسّق، لا في هذا المستودع (نصّ المستخدم: "فلا تُبنى في مستودعك").
//
// يستدعي المولّد (الآن وحدة قابلة للاستيراد بعد الفصل، بنفس نمط
// measure-resolveV7Report-live.js) **في الذاكرة فقط** — buildClientPayloadSample()
// لا تكتب أي ملفّ، ولا يكتب هذا الاختبار الملفّ المُلتزَم بأي حال.
//
// **إثبات السقوط الحقيقي (مطلوب صراحة، وإلا كان الاختبار يحرس لا شيء)**:
// شُغِّل هذا الاختبار يدوياً مقابل نسخة test/fixtures/golden/v7-client-
// payload-sample.json عند الالتزام 43dee66 (قبل إعادة التوليد اللاحقة
// للعقد — letterCeilingReason/socAtWindowStart-End وغيرها) فأخفق فعلاً —
// راجع رسالة التزام هذا الملفّ للنتيجة الحرفية (عدد الفروق ومساراتها).
// هذا الملفّ نفسه يختبر مقابل النسخة **الحالية المُلتزَمة** دائماً — لا
// نسخة تاريخية مُجمَّدة داخله (ذلك يُكرِّر مشكلة "الحارس يحرس نسخة سابقة"
// بنفسه لو جُمِّد هنا).
//
// Run: node functions/test/v7ClientPayloadContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildClientPayloadSample} = require('../scripts/generate-v7-client-payload-sample');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-client-payload-sample.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

// ─── بناء في الذاكرة وحدها — صفر كتابة، حتى للملفّ المؤقّت الذي يكتبه
// main() عادة (لم نستدعِ main، فقط buildClientPayloadSample). ───────────
const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {clientPayload: fresh} = buildClientPayloadSample();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildClientPayloadSample لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

// ─── مقارنة مساراً بمسار، باستثناء shortId (عشوائي بتصميمه في كلا
// الجانبين — generateShortId() تُستدعى مرّة لكل تشغيلة). ────────────────
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
  console.error('\nالإصلاح: node scripts/generate-v7-client-payload-sample.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً، راجع الطباعة أعلاه`);

console.log(`\nv7ClientPayloadContractGuard.test.js: ${n}/${n} assertions passed`);
