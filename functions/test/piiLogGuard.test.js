'use strict';

// piiLogGuard.test.js — V8 الدفعة ١ (الخصوصية)، 2026-10-08 +03.
//
// قرار المستخدم (بنصّه): «لا مستند مستخدم ولا بريد ولا هاتف ولا رمز FCM في أيّ
// سجلّ، والمعرّفات مُهشَّرة. ويُضاف اختبار يرفض ذلك في الكود.»
//
// يمرّ على **ملفّات functions/src الحقيقية** (و functions/index.js) ويفحص كل
// نداء console.* و*.logger.* بوسائطه كاملة (ولو امتدّ على أسطر، والتعليقات
// مُسقَطة)، ويفشل إن حمل: JSON.stringify لكائن مستخدم، أو .data() لمستند، أو
// email/phone/displayName/fullName/fcmToken، أو معرّف مستخدم (uid/userId/ownerId/
// technicianId/customerId) لم يمرّ عبر hashIdForLog، أو رمز عرض خاماً، أو (2026-10-16) رمز جلسة
// (كود الانضمام) خامّاً أو مُهشَّراً، أو معرّف مستند جلسة (sessionId، ref.id، sessionRef.id) لم يمرّ
// عبر hashIdForLog — وكان createScanSession.js:106 و:129 يطبعانهما خامّين ويمرّان (الماسح كان
// يرى النداءين ولا قاعدة لاسميهما).
//
// القاعدة 37: لا يستبدل شيئاً — الملفّات حقيقية، لا مكتبة محاكاة. والماسح نفسه
// يُثبَت تمييزه في test/piiLogGuardSeeded.test.js (عيّنة مزروعة)، وتُقاس تغطيته هنا
// (البند ٤) بمرجع مستقلّ: acorn المضمَّن في Node، في عملية فرعية (القاعدة 38).
//
// Run: node functions/test/piiLogGuard.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const scanner = require('./lib/logPiiScanner');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(FUNCTIONS_DIR, 'src');

function listJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(FUNCTIONS_DIR, p).split(path.sep).join('/');
const files = [...listJs(SRC_DIR), path.join(FUNCTIONS_DIR, 'index.js')].sort();
const scans = files.map((f) => scanner.scanSource(rel(f), fs.readFileSync(f, 'utf8')));

// ═══ ١ — ليس فحصاً فارغاً (القاعدة 22: غياب النداءات لا يُقرأ نجاحاً) ════════
// حدّان أدنيان بعيدان عن العدّ الحالي كي لا يكسرهما إضافة نداء مشروع؛ وملفّات
// القرار التسعة بأسمائها يجب أن يرى فيها الماسح نداءات فعلاً.
ok(files.length >= 50, `[١] ${files.length} ملفّاً ممسوحاً (≥50)`);
const totalCalls = scans.reduce((a, s) => a + s.calls.length, 0);
ok(totalCalls >= 100, `[١] ${totalCalls} نداء log مرئيّ للماسح (≥100)`);
const MUST_HAVE_CALLS = [
  'src/sessions/createScanSession.js', 'src/sessions/joinScanSession.js',
  'src/notifications/sendNotificationEmail.js', 'src/notifications/checkExpiringSubscriptions.js',
  'src/payments/confirmPayment.js', 'src/payments/rejectPayment.js',
  'src/admin/aiModelConfig.js', 'src/evaluations/submitEvaluation.js',
  'src/evaluations/resolvePendingEvaluation.js', 'src/users/redeemPromoCode.js',
];
for (const f of MUST_HAVE_CALLS) {
  const s = scans.find((x) => x.file === f);
  ok(s && s.calls.length > 0, `[١] الماسح يرى نداءات log في ${f}`);
}

// ═══ ٢ — لا مخالفة في أيّ نداء ═════════════════════════════════════════════
const violations = scans.flatMap((s) => s.violations);
const report = violations.map((v) => `  ${v.rule}  ${v.file}:${v.line}  [${v.name}]  ${v.callee}(${v.snippet})`).join('\n');
eq(violations.length, 0, `[٢] نداء log يحمل بيانات شخصية أو معرّفاً خاماً:\n${report}\n`);

// ═══ ٣ — استعمال المنقّيَين = استيراد من المصدر الواحد (القاعدة 24) ═════════
const SELF = 'src/utils/logRedaction.js'; // الملفّ الذي يُعرِّف المنقّيَين — مُستثنى بالاسم
ok(scans.some((s) => s.file === SELF), '[٣] ملفّ التعريف موجود ومُستثنى بالاسم');
for (const s of scans) {
  if (s.file === SELF) continue;
  eq(s.helperImportProblems.join(' | '), '', `[٣] ${s.file}: استعمال المنقّيَين مستورد من utils/logRedaction`);
}
// وكل ملفّ من الملفّات العشرة يستعمل المنقّي فعلاً (يمنع «إصلاحاً» بحذف السطر ثم
// إعادته خاماً في موضع آخر بلا رقيب).
for (const f of MUST_HAVE_CALLS) {
  const src = fs.readFileSync(path.join(FUNCTIONS_DIR, f), 'utf8');
  ok(src.includes('utils/logRedaction'), `[٣] ${f} يستورد utils/logRedaction`);
}

// ═══ ٤ — تغطية الماسح مقابل مرجع مستقلّ (acorn، عملية فرعية) ════════════════
// يقارن لكل ملفّ: مواضع كل نداء console/logger المباشر، وأقواسه، ومواضع كل
// معرّف داخل وسائطه، وعدد معرّفَي console/logger. أيّ اختلاف = الماسح يخطئ في
// رؤية نداء أو معرّف، فلا يُبنى على نتيجته.
const oracleRun = spawnSync(process.execPath, ['--expose-internals', path.join(__dirname, 'lib', 'logCallOracle.js')], {
  input: JSON.stringify(files), encoding: 'utf8', maxBuffer: 1 << 28,
});
eq(oracleRun.status, 0, `[٤] المرجع المستقلّ (acorn عبر --expose-internals) يعمل — ${(oracleRun.stderr || '').slice(0, 300)}`);
const oracle = JSON.parse(oracleRun.stdout);
let directTotal = 0;
for (let k = 0; k < files.length; k++) {
  const f = files[k];
  const found = scanner.findLogCalls(fs.readFileSync(f, 'utf8'), rel(f));
  const mine = found.calls
      .filter((c) => c.callee.startsWith('console.') || c.callee.startsWith('logger.'))
      .map((c) => ({
        callee: c.callee, openOffset: c.openOffset, closeOffset: c.closeOffset,
        ids: c.argTokens.filter((t) => t.t === 'id' && !scanner.KEYWORDS.has(t.v)).map((t) => t.i),
      }))
      .sort((a, b) => a.openOffset - b.openOffset);
  directTotal += mine.length;
  const o = oracle[f];
  eq(JSON.stringify(mine), JSON.stringify(o.direct), `[٤] ${rel(f)}: نداءات console/logger المباشرة ومعرّفاتها مطابقة للمرجع`);
  eq(found.tokens.filter((t) => t.t === 'id' && t.v === 'console').length, o.consoleIds, `[٤] ${rel(f)}: عدد معرّف console مطابق`);
  eq(found.tokens.filter((t) => t.t === 'id' && t.v === 'logger').length, o.loggerIds, `[٤] ${rel(f)}: عدد معرّف logger مطابق`);
}
const aliasCalls = totalCalls - directTotal;
ok(aliasCalls >= 0, `[٤] نداءات عبر معامِل مُراقَب (${aliasCalls}) = الكل (${totalCalls}) − المباشرة (${directTotal})`);

console.log(`piiLogGuard.test.js: ${n}/${n} assertions passed (${files.length} files, ${totalCalls} log calls, ${aliasCalls} via watched parameter)`);
