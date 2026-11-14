'use strict';

// logRedaction.test.js — V8 الدفعة ١ (الخصوصية)، 2026-10-08 +03.
// يختبر المُهشِّر المصدَّر hashIdForLog ومُسجِّل الحضور presenceForLog
// (functions/src/utils/logRedaction.js) — وحدةً خالصة، بلا Firestore.
//
// المتجّهات الثلاثة محسوبة بأداة مستقلّة عن crypto في Node (القاعدة 38):
//   printf '%s' 'abc' | sha256sum
//   printf '%s' 'a1B2c3D4e5F6g7H8i9J0kLmNoPqR' | sha256sum
//   «مستخدم» بترميز UTF-8 (d985d8b3d8aad8aed8afd985) | xxd -r -p | sha256sum
// والمقارنة بالمخرَج الكامل (64 سداسياً) ثم أوّل 12 منه، لا بإعادة الحساب نفسه.
//
// Run: node functions/test/logRedaction.test.js

const assert = require('assert');
const {
  hashIdForLog,
  presenceForLog,
  LOG_ID_PREFIX,
  LOG_ID_HEX_LENGTH,
  LOG_STATE_MISSING,
  LOG_STATE_PRESENT,
  LOG_STATE_INVALID_TYPE,
} = require('../src/utils/logRedaction');

let n = 0;
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ═══ ١ — الصيغة: # + أوّل 12 سداسياً من sha256(UTF-8) ═══════════════════
const VECTORS = [
  {input: 'abc', fullSha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
  {input: 'a1B2c3D4e5F6g7H8i9J0kLmNoPqR', fullSha256: '29699099fc9e10a1edfd62f761d81fa18fcd541703b80dd72cc01d1bb42c918e'},
  {input: 'مستخدم', fullSha256: '846e9d63a0a5a4fbaebcb6e52a802c92992c8092e415fae85a22df52c614d36b'},
];
for (const v of VECTORS) {
  eq(hashIdForLog(v.input), '#' + v.fullSha256.slice(0, 12), `[١] متجّه ${JSON.stringify(v.input)} مطابق لـsha256sum`);
}
eq(LOG_ID_PREFIX, '#', '[١] البادئة #');
eq(LOG_ID_HEX_LENGTH, 12, '[١] 12 محرفاً سداسياً');
ok(/^#[0-9a-f]{12}$/.test(hashIdForLog('anything')), '[١] الشكل ^#[0-9a-f]{12}$');
eq(hashIdForLog('abc'), hashIdForLog('abc'), '[١] حتمي: المعرّف نفسه → المخرَج نفسه (يُطابَق في السجلّ)');
ok(hashIdForLog('abc') !== hashIdForLog('abd'), '[١] معرّفان مختلفان → مخرَجان مختلفان');
ok(!hashIdForLog('abc').includes('abc'), '[١] المخرَج لا يحمل المعرّف');
// الحالة الحدّية: المسافات حول المعرّف جزء منه — لا تُقصّ (المطابقة بالأدوات تعتمد النصّ كما هو).
ok(hashIdForLog(' abc') !== hashIdForLog('abc'), '[١] لا قصّ للمسافات داخل معرّف غير فارغ');

// ═══ ٢ — الغياب حالة صريحة (القاعدة 22) — لا تهشير للفراغ ═════════════
for (const [label, v] of [['undefined', undefined], ['null', null], ['نصّ فارغ', ''], ['مسافات فقط', '   ']]) {
  eq(hashIdForLog(v), LOG_STATE_MISSING, `[٢] hashIdForLog(${label}) → حالة missing لا هاش`);
  eq(presenceForLog(v), LOG_STATE_MISSING, `[٢] presenceForLog(${label}) → missing`);
}
ok(hashIdForLog('') !== hashIdForLog(' x'), '[٢] تهشير الفراغ لا يحدث (لا يُنتج هاشاً)');
ok(!LOG_STATE_MISSING.startsWith('#') && !LOG_STATE_PRESENT.startsWith('#') && !LOG_STATE_INVALID_TYPE.startsWith('#'),
    '[٢] كلمات الحالة لا تبدأ بـ# فلا تلتبس بمعرّف مُهشَّر');
eq(new Set([LOG_STATE_MISSING, LOG_STATE_PRESENT, LOG_STATE_INVALID_TYPE]).size, 3, '[٢] كلمات الحالة الثلاث متمايزة');

// ═══ ٣ — غير النصّ: حالة صريحة لا تحويل صامت ═════════════════════════════
for (const [label, v] of [['رقم', 12345], ['كائن', {uid: 'x'}], ['مصفوفة', ['x']], ['منطقي', true]]) {
  eq(hashIdForLog(v), LOG_STATE_INVALID_TYPE, `[٣] hashIdForLog(${label}) → invalid-type`);
  eq(presenceForLog(v), LOG_STATE_INVALID_TYPE, `[٣] presenceForLog(${label}) → invalid-type`);
}

// ═══ ٤ — presenceForLog: حالة لا قيمة، لا جزء، لا طول ═══════════════════
const TOKEN = 'dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx';
eq(presenceForLog(TOKEN), LOG_STATE_PRESENT, '[٤] رمز موجود → present');
ok(!presenceForLog(TOKEN).includes(TOKEN.slice(0, 6)) && !presenceForLog(TOKEN).includes(TOKEN.slice(-6)),
    '[٤] لا بداية ولا نهاية الرمز في المخرَج');
eq(presenceForLog('x'), presenceForLog(TOKEN), '[٤] المخرَج لا يتغيّر بطول القيمة (لا تسريب للطول)');

console.log(`logRedaction.test.js: ${n}/${n} assertions passed`);
