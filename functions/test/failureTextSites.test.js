'use strict';

// failureTextSites.test.js — حارس جرد مواضع تنقية نصّ الخطأ (A-SUB الموجة الأولى، البند ١٣، 2026-10-17 +03). وحدة بلا شبكة ولا محاكٍ.
//
// قرار المستخدم ١٣ (بنصّه، منقول عن أمر المنسّق order-backend-engineer-asub-wave1-2026-10-17.md — غير متحقَّق من هذا المستودع): «تنقية في أول التزام للخادم» — تنقية أقرب نداءات e.message.
// القاعدة 36: كل نصّ خطأ من مزوّد يُنقّى قبل طباعته أو كتابته أو إعادته. القاعدة 24: المنقّي واحد (utils/failureText.js) والقوائم هنا مصدرها test/lib/failureTextSites.js.
//
//   ١ كل موضع في SANITIZED_SITES يرد بنصّه الحرفي وبعدده، وملفّه يستورد المنقّي من utils/failureText،
//   ٢ كل سطر في functions/src ما زال يحمل `.message` أو `.stack` أو `String(err)` مذكور في RESIDUAL بسبب مكتوب — والعكس (لا سطر مذكور مفقود: قائمة لا تشيخ)،
//   ٣ طفرات في الذاكرة (القاعدة 39): إعادة موضع إلى النصّ الخامّ، أو موضع جديد خامّ، أو حذف الاستيراد ⟵ يُكشَف.
//
// السلوك الفعلي لكل موضع (أخطاء مبنيّة تحمل سرّاً ومسار مستند، بلا شبكة ولا Firestore): failureTextSitesAI.test.js وfailureTextSitesHandlers.test.js.
//
// Run: node functions/test/failureTextSites.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {SANITIZED_SITES, RESIDUAL, WHY, IMPORTERS} = require('./lib/failureTextSites');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const FN = path.join(__dirname, '..');
const walk = (dir, o = []) => {
  for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, o); else if (e.name.endsWith('.js')) o.push(p);
  }
  return o;
};
const rel = (p) => path.relative(FN, p).split(path.sep).join('/');
const strip = (s) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`\\])\/\/ .*$/gm, '$1');
const SRC = {};
for (const f of walk(path.join(FN, 'src'))) SRC[rel(f)] = strip(fs.readFileSync(f, 'utf8'));
SRC['index.js'] = strip(fs.readFileSync(path.join(FN, 'index.js'), 'utf8'));
const SELF = 'src/utils/failureText.js';
// .message و.stack وString(err)، **وطباعة كائن الخطأ نفسه** (`console.error("…", e)`: يطبع الرسالة والمكدّس وحقولاً مثل response في أخطاء SMTP) — كلّها تحمل نصّ الخطأ.
const RESIDUAL_RE = /\.message\b|\.stack\b|String\((?:e|err|error|\w*Err|\w*Error)\)|console\.\w+\(.*,\s*(?:e|err|error|\w*Err|\w*Error)\s*\)\s*;?\s*$/;
const countOf = (text, needle) => text.split(needle).length - 1;

/** كل سطر خارج المنقّي نفسه يحمل .message/.stack/String(err): [ملفّ، سطر مقصوص]. */
function residualLines(src) {
  const rows = [];
  for (const [f, t] of Object.entries(src)) {
    if (f === SELF || typeof t !== 'string') continue;
    for (const l of t.split('\n')) if (RESIDUAL_RE.test(l)) rows.push(`${f} | ${l.trim()}`);
  }
  return rows.sort();
}
const ALLOWED = RESIDUAL.map(([f, l]) => `${f} | ${l}`).sort();

/** الانتهاكات المسمّاة. دالّة نقيّة: الطفرات في الذاكرة تمرّ بها. */
function violations(src) {
  const v = new Set();
  // ١ المواضع المنقّاة
  for (const [f, needle, want] of SANITIZED_SITES) {
    const t = src[f];
    if (t === undefined) { v.add(`MISSING_FILE:${f}`); continue; }
    const got = countOf(t, needle);
    if (got !== want) v.add(`SITE_COUNT:${f}:${needle.slice(0, 50)}:got${got}want${want}`);
    if (!/require\(\s*["']\.{1,2}\/(?:\.\.\/)?(?:utils\/)?failureText["']\s*\)/.test(t)) v.add(`NO_IMPORT:${f}`);
  }
  // ٢ ما تبقّى خامّاً: كل سطر مسمّى، والعكس
  const found = residualLines(src);
  const remaining = [...ALLOWED];
  for (const row of found) {
    const i = remaining.indexOf(row);
    if (i < 0) v.add(`UNLISTED_RAW:${row.slice(0, 140)}`); else remaining.splice(i, 1);
  }
  for (const row of remaining) v.add(`LISTED_BUT_GONE:${row.slice(0, 140)}`);
  return [...v].sort();
}

// ═══ ١ و٢ — المصدر الحقيقي ═══
ok(Object.keys(SRC).length >= 100 && SRC[SELF], `الحارس يرى ${Object.keys(SRC).length} ملفّاً (فحص غير فارغ)`);
ok(SANITIZED_SITES.length >= 50, `عدد مواضع التنقية المسمّاة ${SANITIZED_SITES.length}`);
ok(RESIDUAL.every(([, , why]) => typeof why === 'string' && why.length > 10 && Object.values(WHY).includes(why)), 'لكل سطر مستبعَد سبب مكتوب من القائمة المسمّاة');
deq(violations(SRC), [], 'المصدر الحقيقي: كل موضع منقّى بنصّه، وكل سطر خامّ مسمّى بسببه، وفي كل ملفّ استيراد');
ok(IMPORTERS.length >= 20, `المستوردون المباشرون للمنقّي ${IMPORTERS.length}`);
for (const f of IMPORTERS) ok(SRC[f] && /require\(\s*["']\.{1,2}\/(?:\.\.\/)?(?:utils\/)?failureText["']\s*\)/.test(SRC[f]), `يستورد المنقّي: ${f}`);

// ═══ ٣ — طفرات القاعدة 39 ═══
const mutate = (file, from, to) => {
  ok(SRC[file] && SRC[file].includes(from), `الطفرة: النصّ المستهدَف موجود في ${file} — ${from.slice(0, 50)}`);
  return violations({...SRC, [file]: SRC[file].split(from).join(to)});
};
const appended = (file, extra) => violations({...SRC, [file]: SRC[file] + '\n' + extra + '\n'});
const kinds = (vs) => vs.map((x) => x.split(':')[0]);

ok(kinds(mutate('src/analysis/callAI.js', 'primaryError = failureTextOnce(err);', 'primaryError = err.message || "unknown";')).includes('UNLISTED_RAW'), 'طفرة: callAI يعيد primaryError خامّاً ⟵ يُكشَف (سطر غير مسمّى)');
ok(kinds(mutate('src/analysis/callAI.js', '`${failureTextOnce(geminiErr)}`,', '`${geminiErr.message || geminiErr}`,')).includes('UNLISTED_RAW'), 'طفرة: «Both failed» يحمل رسالة Gemini خامّة ⟵ يُكشَف');
ok(kinds(mutate('src/analysis/callDeepSeek.js', 'const errText = sanitizeFailureText(Object.assign(new Error(errBody), {code: response.status}));', 'const errText = errBody.slice(0, 300);')).includes('SITE_COUNT'), 'طفرة: جسم خطأ DeepSeek خامّ ⟵ يُكشَف (الموضع المسمّى غاب)');
ok(kinds(mutate('src/analysis/callGemini.js', '`Gemini call failed after ${ms}ms: ${sanitizeFailureText(err)}`,', '`Gemini call failed after ${ms}ms: ${err.message || err.name}`,')).includes('UNLISTED_RAW'), 'طفرة: Gemini يرمي برسالة المزوّد خامّة ⟵ يُكشَف');
ok(kinds(mutate('src/reports/generateReportPdf.js', '"فشل حفظ PDF: " + failText(e)', '"فشل حفظ PDF: " + (e.message || e)')).includes('UNLISTED_RAW'), 'طفرة: generateReportPdf يعيد رسالة التخزين للعميل خامّة ⟵ يُكشَف');
ok(kinds(mutate('src/payments/confirmPayment.js', 'console.error("Failed to send FCM push:", sanitizeFailureText(e));', 'console.error("Failed to send FCM push:", e.code || "", e.message || e);')).includes('UNLISTED_RAW'), 'طفرة: FCM يطبع الرسالة خامّةً ⟵ يُكشَف');
ok(kinds(mutate('src/reports/verifyReport.js', 'sanitizeFailureText(error),', 'error.message || error,')).includes('UNLISTED_RAW'), 'طفرة: verifyReport يطبع الرسالة خامّةً ⟵ يُكشَف');
ok(kinds(appended('src/utils/resolveAiConfig.js', 'console.error(`x ${e.message}`);')).includes('UNLISTED_RAW'), 'طفرة: سطر جديد يطبع .message في ملفّ لم يكن فيه ⟵ يُكشَف');
ok(kinds(appended('src/sessions/cancelScanSession.js', 'console.error(String(err));')).includes('UNLISTED_RAW'), 'طفرة: String(err) جديدة ⟵ يُكشَف');
ok(kinds(appended('src/sessions/cancelScanSession.js', 'console.error("Failed to send mail:", e);')).includes('UNLISTED_RAW'), 'طفرة: طباعة كائن الخطأ نفسه (console.error("…", e)) ⟵ يُكشَف');
ok(kinds(mutate('src/payments/rejectPayment.js', 'console.error("Failed to send rejection email:", sanitizeFailureText(e));', 'console.error("Failed to send rejection email:", e);')).includes('UNLISTED_RAW'), 'طفرة: بريد الرفض يطبع كائن الخطأ خامّاً (كما كان قبل البند ١٣) ⟵ يُكشَف');
ok(kinds(mutate('src/profiles/createDeviceProfile.js', 'Failed to create profile ${profileId}: ${sanitizeFailureText(e)}`);', 'Failed to create profile ${profileId}:`, e);')).includes('UNLISTED_RAW'), 'طفرة: تمرير e وسيطاً ثانياً في قالب نصّي ⟵ يُكشَف');
ok(kinds(appended('src/analysis/resolveV7Report.js', 'console.error(`${error.stack}`);')).includes('UNLISTED_RAW'), 'طفرة: طباعة .stack جديدة ⟵ يُكشَف');
ok(kinds(mutate('src/profiles/findDeviceProfile.js', 'const {sanitizeFailureText} = require("../utils/failureText");', '')).includes('NO_IMPORT'), 'طفرة: حُذف الاستيراد ⟵ يُكشَف');
ok(kinds(mutate('src/sessions/createScanSession.js', 'const sanitizedForLog = sanitizeFailureText(error);', 'const sanitizedForLog = String(error.message);')).includes('SITE_COUNT'), 'طفرة: createScanSession يرجع إلى رسالة خامّة ⟵ يُكشَف');
ok(kinds(violations({...SRC, 'src/analysis/callAI.js': undefined})).includes('MISSING_FILE'), 'طفرة: ملفّ موضع مفقود ⟵ يُكشَف');
ok(kinds(mutate('src/analysis/callDeepSeek.js', 'markFailureTextSanitized(this);', '')).includes('SITE_COUNT'), 'طفرة: DeepSeekError لا يُوسَم ⟵ يُكشَف (تنقية متداخلة تقصّ التشخيص)');
ok(kinds(mutate('src/analysis/callAI.js', 'throw markFailureTextSanitized(new Error(', 'throw (new Error(')).includes('SITE_COUNT'), 'طفرة: خطأ «Both failed» لا يُوسَم ⟵ يُكشَف');
// قائمة تشيخ: سطر مسمّى يزول من المصدر ⟵ يُكشَف (لا استثناء ميّت)
ok(kinds(mutate('src/analysis/runLabPipeline.js', 'errors.push({stage: "layer1", error: e.message});', 'errors.push({stage: "layer1"});')).includes('LISTED_BUT_GONE'), 'طفرة: سطر مستبعَد زال من المصدر ⟵ يُكشَف (لا استثناء ميّت)');

console.log(`failureTextSites.test.js: ${n}/${n} assertions passed (${SANITIZED_SITES.length} sanitized sites, ${RESIDUAL.length} residual lines, ${IMPORTERS.length} importers)`);
