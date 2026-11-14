'use strict';

// v7ClientPayloadLlmAdjustedContractGuard.test.js — القرار ٩٢ البند ٢
// (نصّ المستخدم حرفياً): "اختبار يعدّد كل ملفّ في مجلّد العيّنات الذهبية،
// ويفشل إن وُجد ملفّ لا يعيد الحارس توليده ولا يقارنه." هذا هو ذلك الحارس
// المفقود لِـv7-client-payload-sample-llm-adjusted.json تحديداً — الملفّ
// الذي عاش من 488c32f (2026-09-22) حتى القرار ٩٢ البند ١ (2026-09-25) بلا
// أي اختبار يحرسه (مُتحقَّق حينها بـgrep — صفر نتيجة خارج مولّده نفسه).
//
// نفس نمط v7ReportsDocumentContractGuard.test.js/v7ClientPayloadContractGuard.test.js
// حرفياً: يستدعي buildClientPayloadSampleLlmAdjusted() المُصدَّرة حديثاً
// (استُخرجت من main() في نفس التزام هذا الحارس — القاعدة 34: السكربت لم
// يكن قابلاً للاستيراد بأمان قبل ذلك، main() كانت تُستدعى غير مشروطة) في
// الذاكرة فقط، يقارنها بالثابت المُلتزَم مساراً بمسار، باستثناء shortId
// (عشوائي بتصميم generateShortId، نفس استثناء الحارسين الشقيقين).
//
// ⚠️ تحديث 2026-09-25 +03 (القرار ٩٤ البند ١): الملفّ المحروس هنا لم يعد
// يحمل أيّ letterSource="LLM_ADJUSTED" — تعديله المُصطنَع الوحيد (حرف
// storage) يُرفَض الآن EVIDENCE_NOT_PROVEN (الحرف لم يعد دليلاً مقبولاً،
// حتى من فئته هو). هذا الحارس يبقى صحيحاً بالمعنى الحرفي لالتزامه (يحرس
// أن العيّنة المُلتزَمة تطابق مخرَج مولّدها) — لا بالمعنى الذي أُنشئ لأجله
// أصلاً (توضيح شكل LLM_ADJUSTED). راجع القرار ٩٥ البند ٣ لعيّنة بديلة حقيقية.
//
// Run: node functions/test/v7ClientPayloadLlmAdjustedContractGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {buildClientPayloadSampleLlmAdjusted} = require('../scripts/generate-v7-client-payload-sample-llm-adjusted');

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'golden', 'v7-client-payload-sample-llm-adjusted.json');
const committed = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

// ─── بناء في الذاكرة وحدها — صفر كتابة (mtime بلا تغيير يُثبت ذلك). ──────
const beforeMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
const {clientPayload: fresh} = buildClientPayloadSampleLlmAdjusted();
const afterMtime = fs.statSync(GOLDEN_PATH).mtimeMs;
ok(beforeMtime === afterMtime, '[بناء] buildClientPayloadSampleLlmAdjusted لم يكتب/يلمس الملفّ المُلتزَم إطلاقاً (mtime بلا تغيير)');

// ─── مقارنة مساراً بمسار، باستثناء shortId — نفس ديال الحارسَين الشقيقين. ──
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
  console.error(`\n⚠️ العيّنة المُلتزَمة (${GOLDEN_PATH}) لا تطابق ما يُنتجه المولّد فعلياً — ${diffs.length} فرقاً (باستثناء shortId):`);
  for (const d of diffs.slice(0, 50)) console.error(`  ${d}`);
  if (diffs.length > 50) console.error(`  ... و${diffs.length - 50} فرقاً آخر`);
  console.error('\nالإصلاح: node scripts/generate-v7-client-payload-sample-llm-adjusted.js ثم git add/commit للثابت المُحدَّث (القاعدة 39).\n');
}
ok(diffs.length === 0,
    `العيّنة المُلتزَمة يجب أن تطابق مخرَج المولّد الطازج حرفاً بحرف (باستثناء shortId) — ${diffs.length} فرقاً، راجع الطباعة أعلاه`);

console.log(`\nv7ClientPayloadLlmAdjustedContractGuard.test.js: ${n}/${n} assertions passed`);
