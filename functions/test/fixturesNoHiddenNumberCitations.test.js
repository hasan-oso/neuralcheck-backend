'use strict';

// fixturesNoHiddenNumberCitations.test.js — أمر مستخدم 2026-10-06 (D6): "فلا يستشهد
// أيٌّ منها [من الملفّات المصنوعة/المشتقّة] برقم محجوب." حارس انحدار على الخمسة الحالية
// (القاعدة 39: الحارس يتبع العقد — إخفاء قيمة جديدة عن الحمولة يُسقط هذا الاختبار حتى
// تُحدَّث الملفّات). المنطق في scripts/audit-fixtures-hidden-number-citations.js
// (الأساس a2bde6f يُستخرَج بـgit archive إلى مجلّد مؤقّت).
//
// Run: node functions/test/fixturesNoHiddenNumberCitations.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const audit = require('../scripts/audit-fixtures-hidden-number-citations');
const {extractNumbers} = require('../src/analysis/reportShapeV7');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

ok(audit.DEFAULT_TARGETS.length === 5, 'إعداد: خمسة ملفّات مُدقَّقة (اثنان مصنوعان + ثلاث نسخ مشتقّة موسومة)');
for (const t of audit.DEFAULT_TARGETS) {
  ok(fs.existsSync(path.join(__dirname, 'fixtures', t.file)), `إعداد: ${t.file} موجود`);
  const cites = audit.auditFile(t, extractNumbers);
  eq(cites.length, 0, `${t.file}: صفر استشهاد برقم محجوب ${JSON.stringify(cites.slice(0, 3))}`);
}

// ضابط سلبي (القاعدة 30): الأداة تكشف فعلاً — النسخة السابقة المُلتزَمة من مشتقّ 34dff2b8 تحمل استشهادات.
const old = audit.auditFile({file: 'derived-from-frozen-real-2026-09-23-envelope-34dff2b8-accepted.json', scan: '34dff2b8', modifiedC06: false}, extractNumbers);
ok(old.length > 0, `ضابط سلبي: الأداة تكشف استشهادات في النسخة السابقة (${old.length})`);

console.log(`\nfixturesNoHiddenNumberCitations.test.js: ${n}/${n} assertions passed`);
