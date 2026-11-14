'use strict';

// logIdInventory.test.js — جرد المعرّفات في سجلّات الخادم، وحارس دائم عليه (البند ٤-ج، 2026-10-18 +03).
//
// قرار المستخدم: «القاعدة 43 وتنقية السجلّات» (منقول عن أمر المنسّق، غير متحقَّق من هذا المستودع — القاعدة 29)؛ القاعدة 36. ملخّص المرحلة: «scanId وuid خامّان في سجلّات أخرى».
// الأداة: test/lib/logPiiScanner.js — inventorySource (الجرد: ملفّ:سطر · نوع المعرّف · خام/مُهشَّر) وscanSource (الحكم). يفشل هذا الاختبار عند أيّ موضع خامّ جديد لمعرّف من:
//   scanId · userId/uid/ownerId (وما يشتقّ منها) · sessionId · paymentId · reportId/reportRef · shortId · doc.id — أو لمتغيّر مشتقّ من أيّ منها (`const x = String(scanId).trim()` ثم طباعة x).
// ما يبقى خامّاً بقرار مكتوب: test/lib/rawLogIdExceptions.js — كل استثناء بملفّه وقاعدته ونصّ نداءه وسببه، ويفشل الاختبار إن لم يطابق نداءً فعلياً بعدده (استثناء قديم) أو خلا من سبب (القاعدة 22 ملحقها).
//
// القاعدة 37: لا يستبدل شيئاً — ملفّات functions/src الحقيقية؛ والطفرات تعدّل نصّ ملفّ حقيقي في الذاكرة وتمسحه باسمه الحقيقي (فلا يُخفيها استثناء إلا بنصّه). القاعدة 38: findDeclarators تُقاس
// بمرجع مستقلّ (acorn المضمَّن في Node، عملية فرعية، test/lib/logCallOracle.js). **حدود مُعلَنة:** المسندات بالأسماء (انظر ترويسة logPiiScanner.js)؛ المشتقّ بالاسم وعلى مستوى الملفّ؛ لا يرى مَعرّفاً يمرّ
// عبر معامِل دالّة بغير اسمه المعروف، ولا ما يحمله نصّ خطأ (القاعدة 36: failureText.test.js).
//
// Run: node functions/test/logIdInventory.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {spawnSync} = require('child_process');
const scanner = require('./lib/logPiiScanner');
const EXCEPTIONS = require('./lib/rawLogIdExceptions');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const FUNCTIONS_DIR = path.resolve(__dirname, '..');
function listJs(dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJs(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(FUNCTIONS_DIR, p).split(path.sep).join('/');
const files = [...listJs(path.join(FUNCTIONS_DIR, 'src')), path.join(FUNCTIONS_DIR, 'index.js')].sort();
const SRC = Object.fromEntries(files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));

const ID_RULES = ['id-field', 'session-id', 'scan-id', 'payment-id', 'report-id', 'short-id', 'doc-id', 'derived-id'];
const rows = Object.entries(SRC).flatMap(([f, s]) => scanner.inventorySource(f, s));
const scans = Object.entries(SRC).map(([f, s]) => scanner.scanSource(f, s));

// ═══ ١ — ليس جرداً فارغاً (القاعدة 22: غياب الصفوف لا يُقرأ نجاحاً) ═══
ok(files.length >= 50, `[١] ${files.length} ملفّاً ممسوحاً (≥50)`);
ok(rows.length >= 60, `[١] ${rows.length} ورود معرّف داخل نداءات log (≥60)`);
const kinds = new Set(rows.map((r) => r.kind));
for (const k of ['uid', 'sessionId', 'scanId', 'paymentId', 'shortId', 'docId', 'derived']) ok(kinds.has(k), `[١] الجرد يرى نوع ${k} فعلاً`);

// ═══ ٢ — لا موضع خامّ ═══
const raw = rows.filter((r) => r.state === 'raw');
eq(raw.length, 0, `[٢] معرّف خامّ في نداء log:\n${raw.map((r) => `  ${r.file}:${r.line}  ${r.kind}  ${r.name}  ${r.callee}`).join('\n')}\n`);
const violations = scans.flatMap((s) => s.violations).filter((v) => ID_RULES.includes(v.rule));
eq(violations.length, 0, `[٢] مخالفات قواعد المعرّفات:\n${violations.map((v) => `  ${v.rule} ${v.file}:${v.line} [${v.name}]`).join('\n')}\n`);
// المسارَان (الجرد والحكم) يتّفقان على ما بقي خامّاً بقرار: العدد نفسه.
const byDecision = rows.filter((r) => r.state === 'raw-by-decision');
const excepted = scans.flatMap((s) => s.excepted);
eq(byDecision.length, excepted.length, '[٢] ما يبقى خامّاً بقرار: الجرد والحكم يعدّانه بالعدد نفسه');

// ═══ ٣ — الاستثناءات: كلّها مطابقة وبسبب مكتوب ═══
for (const x of EXCEPTIONS) {
  ok(typeof x.reason === 'string' && x.reason.length >= 20, `[٣] سبب مكتوب لـ${x.file} «${x.snippet}»`);
  ok(ID_RULES.includes(x.rule), `[٣] قاعدة الاستثناء معروفة: ${x.rule}`);
  const hits = excepted.filter((v) => v.file === x.file && v.rule === x.rule && v.argText.includes(x.snippet));
  eq(hits.length, x.count, `[٣] الاستثناء ${x.file} «${x.snippet}» يطابق ${x.count} نداءً فعلياً (غير ذلك = استثناء قديم أو نداء جديد يختبئ تحته)`);
}
eq(excepted.length, EXCEPTIONS.reduce((a, x) => a + x.count, 0), '[٣] لا نداء مستثنى خارج القائمة المكتوبة');
// الاستثناء هو وحده ما يخفي: بدونه يظهر النداءان.
{
  const f = 'src/profiles/findDeviceProfile.js';
  eq(scanner.scanSource(f, SRC[f], {exceptions: []}).violations.filter((v) => v.rule === 'doc-id').length, 2, '[٣] بلا قائمة الاستثناءات: نداءا findDeviceProfile يُرفضان');
  eq(scanner.scanSource(f, SRC[f]).violations.filter((v) => v.rule === 'doc-id').length, 0, '[٣] وبها: لا مخالفة');
}

// ═══ ٤ — المواضع التي أُصلحت يراها الجرد مُهشَّرةً (القاعدة 37: اختبار لا يستبدل الطبقة التي يحرسها) ═══
const has = (file, kind, name, state) => rows.some((r) => r.file === file && r.kind === kind && r.name === name && r.state === state);
ok(has('src/reports/verifyReport.js', 'derived', 'inputId', 'hashed'), '[٤] verifyReport.js: المُدخل المشتقّ inputId مُهشَّر (البند ٤-ب)');
ok(has('src/reports/verifyReport.js', 'derived', 'upperId', 'hashed'), '[٤] verifyReport.js: upperId مُهشَّر');
ok(has('src/reports/verifyReport.js', 'derived', 'withPrefix', 'hashed'), '[٤] verifyReport.js: withPrefix مُهشَّر');
ok(has('src/reports/verifyReport.js', 'shortId', 'shortId', 'hashed'), '[٤] verifyReport.js: report.shortId مُهشَّر');
ok(has('src/reports/generateReportPdf.js', 'shortId', 'shortId', 'hashed'), '[٤] generateReportPdf.js: shortId مُهشَّر');
ok(has('src/analysis/runAnalysisInternal.js', 'scanId', 'staleScanId', 'hashed'), '[٤] runAnalysisInternal.js: معرّف التقرير السابق مُهشَّر');
ok(has('src/payments/confirmPayment.js', 'paymentId', 'paymentId', 'hashed'), '[٤] confirmPayment.js: paymentId مُهشَّر');
ok(rows.some((r) => r.file === 'src/notifications/checkExpiringSubscriptions.js' && r.kind === 'docId' && r.state === 'hashed'), '[٤] checkExpiringSubscriptions.js: doc.id مُهشَّر');
ok(rows.some((r) => r.file === 'src/sessions/sessionCompletion.js' && r.kind === 'derived' && r.name === 'sid' && r.state === 'hashed') === false,
    '[٤] وsid في sessionCompletion.js (مشتقّ من مُهشَّر) لا يُعدّ معرّفاً خامّاً ولا يظهر صفّاً');

// ═══ ٥ — طفرات: موضع خامّ يُنشأ في ملفّ حقيقي فيُفشله الماسح (القاعدة 37) ═══
const violationsOf = (file, mutated) => scanner.scanSource(file, mutated).violations.filter((v) => ID_RULES.includes(v.rule)).map((v) => v.rule);
// الطفرات على نسخة LF من الملفّ (نهايات الأسطر في شجرة العمل CRLF بـautocrlf)، أمّا الجرد والمرجع فعلى البايتات كما هي (الإزاحات تُقارَن بـacorn).
const lf = (s) => s.split('\r\n').join('\n');
function mutant(file, from, to, expectRule) {
  const count = lf(SRC[file]).split(from).length - 1;
  ok(count >= 1, `[٥] الطفرة: النصّ المستهدَف موجود في ${file} — ${from.slice(0, 50)}`);
  const m = lf(SRC[file]).replace(from, () => to);
  const rules = violationsOf(file, m);
  ok(rules.includes(expectRule), `[٥] طفرة ${expectRule} في ${file}: «${from.slice(0, 40)}» ⟵ «${to.slice(0, 40)}» (ظهر: ${rules.join(',') || 'لا شيء'})`);
}
mutant('src/reports/verifyReport.js', '"upper:", hashIdForLog(upperId)', '"upper:", upperId', 'derived-id');
mutant('src/reports/verifyReport.js', 'hashIdForLog(inputId));\n          res.status(404)', 'inputId);\n          res.status(404)', 'derived-id');
mutant('src/reports/verifyReport.js', '"shortId:", hashIdForLog(report.shortId)', '"shortId:", report.shortId', 'short-id');
mutant('src/reports/generateReportPdf.js', '"shortId:", hashIdForLog(shortId)', '"shortId:", shortId', 'short-id');
mutant('src/reports/generateReportPdf.js', 'launching headless Chrome for ${printUrlForLog}', 'launching headless Chrome for ${printUrl}', 'derived-id');
mutant('src/analysis/runAnalysisInternal.js', 'reportRef ${hashIdForLog(staleScanId)}', 'reportRef ${staleScanId}', 'scan-id');
mutant('src/analysis/runAnalysisInternal.js', 'const staleScanId = typeof oldReportRef === "string" ? oldReportRef.replace(/^reports\\//, "") : null;\n', 'const staleScanId = typeof oldReportRef === "string" ? oldReportRef.replace(/^reports\\//, "") : null;\n                  console.warn(`stale ${oldReportRef}`);\n', 'report-id');
mutant('src/payments/confirmPayment.js', 'paymentId=${hashIdForLog(paymentId)} userIdState', 'paymentId=${paymentId} userIdState', 'payment-id');
mutant('src/notifications/checkExpiringSubscriptions.js', 'hashIdForLog(doc.id), sanitizeFailureText(e)', 'doc.id, sanitizeFailureText(e)', 'doc-id');
mutant('src/sessions/sessionCompletion.js', 'const sid = hashIdForLog(sessionRef && sessionRef.id);', 'const sid = String(sessionRef && sessionRef.id);', 'derived-id');
// نداء مُلحَق بكل صنف جديد (ملفّ حقيقي، اسمه الحقيقي)
for (const [snippet, rule] of [
  ['console.log(`p ${paymentId}`);', 'payment-id'], ['console.log(`r ${reportId}`);', 'report-id'], ['console.log(`s ${shortId}`);', 'short-id'],
  ['console.log(`d ${doc.id}`);', 'doc-id'], ['const q = scanId.trim();\nconsole.log(q);', 'derived-id'], ['console.log(`u ${request.auth.uid}`);', 'id-field'],
]) {
  const f = 'src/payments/rejectPayment.js';
  ok(violationsOf(f, SRC[f] + '\n' + snippet + '\n').includes(rule), `[٥] نداء ${rule} مُلحَق بملفّ حقيقي يُرفَض`);
}

// ═══ ٦ — findDeclarators مقيسة بمرجع مستقلّ (acorn، عملية فرعية — القاعدة 38) ═══
const oracleRun = spawnSync(process.execPath, ['--expose-internals', path.join(__dirname, 'lib', 'logCallOracle.js')], {
  input: JSON.stringify(files), encoding: 'utf8', maxBuffer: 1 << 28,
});
eq(oracleRun.status, 0, `[٦] المرجع المستقلّ يعمل — ${(oracleRun.stderr || '').slice(0, 300)}`);
const oracle = JSON.parse(oracleRun.stdout);
let declTotal = 0;
for (const f of files) {
  const found = scanner.findLogCalls(SRC[rel(f)], rel(f));
  const mine = scanner.findDeclarators(found.tokens).map((d) => ({name: d.name, nameOffset: d.nameOffset})).sort((a, b) => a.nameOffset - b.nameOffset);
  declTotal += mine.length;
  eq(JSON.stringify(mine), JSON.stringify(oracle[f].declarators), `[٦] ${rel(f)}: التصريحات بقيمة ابتدائية مطابقة للمرجع`);
}
ok(declTotal >= 300, `[٦] ${declTotal} تصريحاً قيس (≥300 — ليس مقياساً فارغاً)`);

// ═══ طباعة الجرد (للقارئ: ملفّ:سطر · نوع · الحالة) ═══
const by = {};
for (const r of rows) by[`${r.kind}/${r.state}`] = (by[`${r.kind}/${r.state}`] || 0) + 1;
console.log(`inventory: ${rows.length} id occurrences in ${rows.map((r) => r.file).filter((f, i, a) => a.indexOf(f) === i).length} files — ${Object.keys(by).sort().map((k) => `${k}=${by[k]}`).join(' ')}`);
for (const r of byDecision) console.log(`  raw by decision: ${r.file}:${r.line}  ${r.kind}  — ${r.reason}`);
console.log(`logIdInventory.test.js: ${n}/${n} assertions passed (${files.length} files, ${rows.length} occurrences, ${raw.length} raw, ${byDecision.length} raw by written decision, ${declTotal} declarators vs acorn)`);
