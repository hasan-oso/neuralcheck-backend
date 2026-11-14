'use strict';

// rawLogIdExceptions.js — معرّفات تبقى خامّة في سجلّات الخادم **بقرار مكتوب** (البند ٤-ج، 2026-10-18 +03).
// القاعدة 22 (ملحقها): «ما لا سبب مكتوباً له يُزال». كل استثناء: الملفّ، القاعدة التي يُعفى منها، نصّ من وسائط النداء يحدّده (لا رقم سطر — يتحرّك السطر بكل تعديل، ويُعرض في الجرد)، والسبب.
// يقرؤه test/lib/logPiiScanner.js (scanSource وinventorySource)، ويحرسه test/logIdInventory.test.js: استثناء لا يطابق نداءً فعلياً (قديم) أو يطابق أكثر من العدد المكتوب يُفشل الاختبار.
//
// ليس فيه معرّف مستخدم ولا جلسة ولا فحص ولا دفعة: هذه كلّها تُهشَّر بلا استثناء.

module.exports = Object.freeze([
  Object.freeze({
    file: 'src/profiles/findDeviceProfile.js',
    rule: 'doc-id',
    snippet: 'Found by ${stage.field}: ${doc.id}',
    count: 1,
    reason: 'معرّف مستند deviceProfiles (مفتاح الجهاز المشتقّ من بصمات الجهاز) لا معرّف شخص ولا جلسة ولا فحص؛ خارج أسماء أمر التنقية؛ يلزم لتشخيص مرحلة البحث التي طابقت. قرار بقاء/تهشير مرفوع للمستخدم (انظر التقرير).',
  }),
  Object.freeze({
    file: 'src/profiles/findDeviceProfile.js',
    rule: 'doc-id',
    snippet: 'Found by layerD+E: ${doc.id}',
    count: 1,
    reason: 'كالسابق: معرّف مستند deviceProfiles في مرحلة layerD+E.',
  }),
]);
