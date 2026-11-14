'use strict';

// adminVerifiedEmail.test.js — إضافة أمر نقل الخامّ (2026-10-09)، البند ١. قرار المستخدم (بنصّه، منقول من أمر
// المنسّق): «يُضاف شرط email_verified إلى requireAdmin (utils/admin.js:23-30) وإلى generateReportPdf.js:114 … يُرفض:
// غير المؤكَّد، ومن بلا ادّعاء التحقّق. ويُقبل: المشرف المؤكَّد. ويُجرد بالأداة كل موضع آخر في functions/src يقارن
// البريد بقائمة مشرفين.»
//
// يثبّت: (١) requireAdmin وisVerifiedAdmin، (٢) evaluateReportAccess في generateReportPdf (دالّة نقيّة بلا Puppeteer)،
// (٣) ضابط سلبي على الشكل القديم (المقارنة التي كانت تقبل غير المؤكَّد)، (٤) حارس مصدر: لا مقارنة بقائمة المشرفين
// في functions/src خارج utils/admin.js.
//
// Run: node functions/test/adminVerifiedEmail.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code || e.message; } };

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy';
process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'dummy';

const {ADMIN_EMAILS, isVerifiedAdmin, requireAdmin} = require('../src/utils/admin');
const {evaluateReportAccess} = require('../src/reports/generateReportPdf');

const ADMIN = ADMIN_EMAILS[0];
const authWith = (token) => ({uid: 'u', token});

ok(Array.isArray(ADMIN_EMAILS) && ADMIN_EMAILS.length === 3, '[إعداد] ثلاثة عناوين مشرفين');

// ─── requireAdmin ───────────────────────────────────────────────────────────
eq(code(() => requireAdmin({auth: null})), 'unauthenticated', '[requireAdmin] بلا مصادقة ⇒ unauthenticated');
eq(code(() => requireAdmin({auth: authWith({email: ADMIN, email_verified: true})})), null, '[requireAdmin] مشرف مؤكَّد ⇒ يُقبل');
for (const e of ADMIN_EMAILS) {
  eq(code(() => requireAdmin({auth: authWith({email: e, email_verified: true})})), null, `[requireAdmin] كل عنوان من الثلاثة يُقبل مؤكَّداً (${e.length} محرفاً)`);
}
eq(code(() => requireAdmin({auth: authWith({email: ADMIN, email_verified: false})})), 'permission-denied',
    '[requireAdmin] بريد مشرف بـemail_verified:false ⇒ permission-denied');
eq(code(() => requireAdmin({auth: authWith({email: ADMIN})})), 'permission-denied',
    '[requireAdmin] بريد مشرف بلا ادّعاء email_verified أصلاً ⇒ permission-denied (الغياب = غير مؤكَّد، القاعدة 22)');
eq(code(() => requireAdmin({auth: authWith({email: ADMIN, email_verified: 'true'})})), 'permission-denied',
    '[requireAdmin] email_verified نصّاً "true" ⇒ مرفوض (لا يُقبل إلا المنطقي true)');
eq(code(() => requireAdmin({auth: authWith({email: ADMIN, email_verified: 1})})), 'permission-denied', '[requireAdmin] email_verified=1 ⇒ مرفوض');
eq(code(() => requireAdmin({auth: authWith({email: 'someone@example.com', email_verified: true})})), 'permission-denied',
    '[requireAdmin] مؤكَّد لكن البريد ليس من القائمة ⇒ مرفوض');
eq(code(() => requireAdmin({auth: authWith({email_verified: true})})), 'permission-denied', '[requireAdmin] مؤكَّد بلا بريد ⇒ مرفوض');
eq(code(() => requireAdmin({auth: authWith({firebase: {sign_in_provider: 'anonymous'}})})), 'permission-denied', '[requireAdmin] حساب مجهول ⇒ مرفوض');
eq(code(() => requireAdmin({auth: {uid: 'u'}})), 'permission-denied', '[requireAdmin] auth بلا token ⇒ مرفوض (لا رمي TypeError)');

// ─── isVerifiedAdmin ────────────────────────────────────────────────────────
eq(isVerifiedAdmin(null), false, '[isVerifiedAdmin] null');
eq(isVerifiedAdmin(undefined), false, '[isVerifiedAdmin] undefined');
eq(isVerifiedAdmin(authWith({email: ADMIN, email_verified: true})), true, '[isVerifiedAdmin] مشرف مؤكَّد');
eq(isVerifiedAdmin(authWith({email: ADMIN, email_verified: false})), false, '[isVerifiedAdmin] غير مؤكَّد');

// ─── generateReportPdf: من يحقّ له PDF ───────────────────────────────────────
const report = {userId: 'owner-1'};
let a = evaluateReportAccess(report, {uid: 'owner-1', token: {}});
ok(a.isOwner === true && a.isAdminUser === false, '[PDF] المالك يُعرَف مالكاً');
a = evaluateReportAccess(report, authWith({email: ADMIN, email_verified: true}));
ok(a.isOwner === false && a.isAdminUser === true, '[PDF] المشرف المؤكَّد: isAdminUser=true (يجتاز بوّابة الصلاحية والفحص المجاني)');
a = evaluateReportAccess(report, authWith({email: ADMIN, email_verified: false}));
ok(a.isOwner === false && a.isAdminUser === false, '[PDF] بريد مشرف غير مؤكَّد: لا مالك ولا مشرف ⇒ يُرفض في الدالّة (`!isOwner && !isAdminUser`)');
a = evaluateReportAccess(report, authWith({email: ADMIN}));
ok(a.isOwner === false && a.isAdminUser === false, '[PDF] بريد مشرف بلا الادّعاء ⇒ لا مشرف');
a = evaluateReportAccess(report, authWith({email: 'someone@example.com', email_verified: true}));
ok(a.isOwner === false && a.isAdminUser === false, '[PDF] مؤكَّد غير مشرف ⇒ لا مشرف');

// ─── ضابط سلبي على الشكل القديم (e24fe80، utils/admin.js:23-30) ───────────────
// نسخة حرفية من المقارنة القديمة: تقبل غير المؤكَّد ومن بلا الادّعاء — فالحالات أعلاه تضرب الثغرة نفسها فعلاً.
const legacyRequireAdmin = (request) => {
  if (!request.auth) throw Object.assign(new Error('x'), {code: 'unauthenticated'});
  if (!ADMIN_EMAILS.includes(request.auth.token.email)) throw Object.assign(new Error('x'), {code: 'permission-denied'});
};
eq(code(() => legacyRequireAdmin({auth: authWith({email: ADMIN, email_verified: false})})), null,
    '[ضابط سلبي] الشكل القديم كان يقبل بريد مشرف غير مؤكَّد — فاختبار الرفض أعلاه يكشفه');
eq(code(() => legacyRequireAdmin({auth: authWith({email: ADMIN})})), null,
    '[ضابط سلبي] والشكل القديم كان يقبل بريد مشرف بلا الادّعاء أيضاً');

// ─── حارس مصدر: لا مقارنة بقائمة المشرفين في functions/src خارج utils/admin.js ───
const SRC = path.join(__dirname, '..', 'src');
const offenders = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { walk(full); continue; }
    if (!f.name.endsWith('.js')) continue;
    const rel = path.relative(SRC, full).replace(/\\/g, '/');
    if (rel === 'utils/admin.js') continue;
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (/ADMIN_EMAILS\.(includes|indexOf|some|find)\(/.test(l) || /\badminEmails\b|\bisAdminEmail\b/.test(l)) offenders.push(`${rel}:${i + 1}`);
    });
  }
}(SRC));
ok(offenders.length === 0, `[حارس مصدر] لا مقارنة مباشرة بقائمة المشرفين خارج utils/admin.js — وُجد: ${offenders.join(', ')}`);

console.log(`\nadminVerifiedEmail.test.js: ${n}/${n} assertions passed`);
