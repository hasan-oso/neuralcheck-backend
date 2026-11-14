'use strict';

// registerUserFreeScans.test.js — إضافة أمر نقل الخامّ (2026-10-09)، البند ٣: «registerUser لا يمنح freeScansForNewUser
// لحساب مجهول (sign_in_provider = anonymous). اختبار للحالتين، مجهول وغير مجهول.» وحدة: دالّة القرار وحدها
// (المعالج الكامل على المحاكي: test/registerUserAnonymous.e2e.test.js).
//
// Run: node functions/test/registerUserFreeScans.test.js

const assert = require('assert');

let n = 0;
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const {freeScansGrantDecision} = require('../src/users/registerUser');
const tok = (provider) => ({firebase: {sign_in_provider: provider}});

// مجهول ⇒ لا منح
deepEq(freeScansGrantDecision(tok('anonymous')), {grant: false, reason: 'ANONYMOUS'}, '[مجهول] sign_in_provider=anonymous ⇒ لا منح');
// غير مجهول ⇒ منح
for (const p of ['google.com', 'password', 'phone', 'apple.com', 'custom']) {
  deepEq(freeScansGrantDecision(tok(p)), {grant: true, reason: null}, `[غير مجهول] ${p} ⇒ منح`);
}
// الغياب ليس «غير مجهول» (القاعدة 22)
const unknown = {grant: false, reason: 'SIGN_IN_PROVIDER_UNKNOWN'};
deepEq(freeScansGrantDecision({}), unknown, '[غياب] token بلا firebase ⇒ لا منح');
deepEq(freeScansGrantDecision({firebase: {}}), unknown, '[غياب] firebase بلا sign_in_provider ⇒ لا منح');
deepEq(freeScansGrantDecision(tok('')), unknown, '[غياب] مزوّد نصّ فارغ ⇒ لا منح');
deepEq(freeScansGrantDecision(tok(null)), unknown, '[غياب] مزوّد null ⇒ لا منح');
deepEq(freeScansGrantDecision(tok(1)), unknown, '[غياب] مزوّد غير نصّي ⇒ لا منح');
deepEq(freeScansGrantDecision(null), unknown, '[غياب] token=null ⇒ لا منح');
deepEq(freeScansGrantDecision(undefined), unknown, '[غياب] token=undefined ⇒ لا منح');
// لا يخلط الحالة بحقل آخر: بريد مؤكَّد لا يجعل المجهول مسجَّلاً
deepEq(freeScansGrantDecision({email: 'a@b.c', email_verified: true, firebase: {sign_in_provider: 'anonymous'}}), {grant: false, reason: 'ANONYMOUS'},
    '[مجهول] حتى مع ادّعاءات بريد في الرمز ⇒ لا منح (المعيار المزوّد وحده)');

console.log(`\nregisterUserFreeScans.test.js: ${n}/${n} assertions passed`);
