'use strict';

// emulatorGuardCoverage.test.js — حارس بنيوي: يُفشل أيّ ملفّ اختبار من الجرد لا يستورد حارس المحاكي أوّلاً (V8 قبل النشر، 2026-10-09 +03).
// بلا محاكٍ وبلا شبكة. الجرد بالأداة (functions/test/lib/emulatorGuardInventory.js) من القرص لا من قائمة يدوية: ملفّ جديد يكتب في Firestore
// ولم يستورد الحارس يُفشل هذا الاختبار قبل أن يُلتزم. سلوك الحارس نفسه: emulatorOnlyGuard.test.js.
//
// قرار المستخدم (بنصّه): «لا يعمل أيّ اختبار يحذف إلا إذا كان FIRESTORE_EMULATOR_HOST مضبوطاً، والمشروع مشروع اختبار لا neuralchek-9b6d7،
// وإلا يتوقّف قبل أيّ نداء.» ومطلوب المنسّق: «حارس بنيوي: يُفشل أيّ ملفّ اختبار من الجرد لا يستورد الحارس.»
//
// Run: node functions/test/emulatorGuardCoverage.test.js

const assert = require('assert');
const {inventory, classify, guardImportedFirst, SCAN_DIRS} = require('./lib/emulatorGuardInventory');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// عيّنات اصطناعية: «@R@» بدل require كي لا يرى مصنِّف الجرد هذا الملفّ نفسه عميلاً حقيقياً (وإلا صار «يكتب» فاحتاج الحارس وهو يعمل بلا محاكٍ)
const S = (text) => text.replace(/@R@/g, 'require');

// ═══════════════════════════════════════════════════════════════════
// ١ — الجرد الحقيقي: كل ملفّ يكتب في Firestore يستورد الحارس أوّلاً
// ═══════════════════════════════════════════════════════════════════
const inv = inventory();
console.log(`الجرد بالأداة: ملفّات مفحوصة=${inv.scanned} (${SCAN_DIRS.join(', ')}) · WRITERS=${inv.writers.length} · DELETERS=${inv.deleters.length} · STORAGE_ONLY=${inv.storageOnly.length}`);
ok(inv.scanned > 100 && inv.writers.length >= 25 && inv.deleters.length >= 14, `[١] الجرد غير فارغ: scanned=${inv.scanned} writers=${inv.writers.length} deleters=${inv.deleters.length}`);
const offenders = inv.rows.filter((r) => r.writer && !(r.guard.imported && r.guard.first));
deq(offenders.map((r) => `${r.file} (${r.guard.imported ? `الحارس بعد ${r.guard.firstOffender}` : 'لا يستورد الحارس'})`), [], '[١] لا ملفّ من WRITERS بلا الحارس أوّلاً — أضف استيراد ./lib/emulatorOnlyGuard أوّل شيفرة الملفّ (وللمجلّد rules-test: ../functions/test/lib/emulatorOnlyGuard)');
for (const r of inv.rows.filter((x) => x.writer)) ok(r.guard.imported && r.guard.first, `[١] ${r.file}: الحارس أوّل require غير مدمج`);
ok(inv.deleters.every((f) => inv.writers.includes(f)), '[١] DELETERS (القاعدة الدنيا بنصّ القرار) ⊂ WRITERS (اقتراح المنسّق، المطبَّق)');

// ═══════════════════════════════════════════════════════════════════
// ٢ — العُرف والحدود: لا e2e يفلت بالتسمية، ولا اختبار وحدة عادي يُحمَّل بالحارس (فيتوقّف السويت بلا محاكٍ)
// ═══════════════════════════════════════════════════════════════════
const e2eFiles = inv.rows.filter((r) => r.e2e);
ok(e2eFiles.length >= 21, `[٢] ملفّات *.e2e.test.js المفحوصة: ${e2eFiles.length}`);
deq(e2eFiles.filter((r) => !r.writer).map((r) => r.file), [], '[٢] كل *.e2e.test.js ضمن WRITERS (عُرف المستودع: كل e2e يكتب) — فلا يفلت ملفّ بأن مصنِّفاً ساكناً لم يرَ كتابته');
for (const f of ['rules-test/firestore.rules.test.js', 'rules-test/firestore_users_create.test.js', 'rules-test/reports.rules.test.js', 'rules-test/scanSessions.rules.test.js']) {
  ok(inv.writers.includes(f), `[٢] ${f} ضمن WRITERS (يكتب في المحاكي عبر rules-unit-testing)`);
}
ok(inv.deleters.includes('rules-test/scanSessions.rules.test.js'), '[٢] rules-test/scanSessions.rules.test.js ضمن DELETERS');
ok(inv.storageOnly.includes('rules-test/storage.rules.test.js') && !inv.writers.includes('rules-test/storage.rules.test.js'),
    '[٢] rules-test/storage.rules.test.js: محاكي Storage وحده (لا Firestore، ولا FIRESTORE_EMULATOR_HOST في --only storage — قيس) فهو خارج هذا الحارس ويُذكر في الجرد');
for (const f of ['functions/test/reportRawMigration.test.js', 'functions/test/adminVerifiedEmail.test.js']) {
  const row = inv.rows.find((r) => r.file === f);
  ok(row && row.clients.length > 0 && !row.writer && !row.guard.imported, `[٢] ${f}: يستورد عميلاً لكنه لا يستعمل Firestore ولا يستورد الحارس (يعمل في السويت العادي بلا محاكٍ)`);
}

// ═══════════════════════════════════════════════════════════════════
// ٣ — المصنِّف والفاحص على عيّنات اصطناعية: ما يُرفض وما يُقبل
// ═══════════════════════════════════════════════════════════════════
// (أ) ملفّ e2e بلا الحارس: كاتب، ولا يستورد
const unguardedE2e = S("const {db} = @R@('../src/utils/admin');\ndb.collection('a').doc('b').set({});\n");
ok(classify('x.e2e.test.js', unguardedE2e).writer && !guardImportedFirst(unguardedE2e).imported, '[٣-أ] e2e بلا الحارس: يُصنَّف كاتباً ولا يستورد الحارس → يُفشله الفحص ١');
// (ب) الحارس بعد عميل: مستورد لكنه ليس أوّلاً، والمخالف يُسمّى
const lateGuard = S("const {db} = @R@('../src/utils/admin');\n@R@('./lib/emulatorOnlyGuard');\n");
deq(guardImportedFirst(lateGuard), {imported: true, first: false, firstOffender: '../src/utils/admin'}, '[٣-ب] الحارس بعد استيراد admin: مستورد وليس أوّلاً، ويُسمّى المخالف');
// (ج) الحارس بعد require بـpath.join (أسلوب بعض e2e)
const lateGuardPath = S("@R@(path.join(SRC, 'utils', 'admin'));\n@R@('./lib/emulatorOnlyGuard');\n");
ok(guardImportedFirst(lateGuardPath).first === false, '[٣-ج] الحارس بعد استيراد بـpath.join(...) (أسلوب بعض ملفّات e2e): ليس أوّلاً');
// (د) الحارس أوّلاً بعد تعليقات و'use strict' ووحدات Node المدمجة: مقبول
const goodOrder = S("// header\n'use strict';\nconst fs = @R@('fs');\nconst assert = @R@('node:assert');\n@R@('./lib/emulatorOnlyGuard');\nconst {db} = @R@('../src/utils/admin');\n");
deq(guardImportedFirst(goodOrder), {imported: true, first: true, firstOffender: null}, '[٣-د] الحارس أوّل require غير مدمج بعد التعليقات و\'use strict\' و fs/assert: مقبول');
// (هـ) ذكر الحارس في تعليق لا يكفي
ok(guardImportedFirst(S("// @R@('./lib/emulatorOnlyGuard')\nconst {db} = @R@('../src/utils/admin');\n")).imported === false, '[٣-هـ] ذكر الحارس في تعليق ليس استيراداً');
// (و) مسار rules-test
ok(guardImportedFirst(S("@R@('../functions/test/lib/emulatorOnlyGuard');\nconst {initializeTestEnvironment} = @R@('@firebase/rules-unit-testing');\n")).first === true, '[٣-و] مسار rules-test إلى الحارس مقبول');
// (ز) ملفّ غير e2e الاسم لكنه يتّصل ويكتب: يُصنَّف كاتباً (ملفّ جديد بأيّ اسم)
const oddName = S("const {db} = @R@('../src/utils/admin');\nasync function go() { await db.collection('a').doc('b').update({x: 1}); }\n");
ok(classify('someNewCheck.test.js', oddName).writer, '[٣-ز] ملفّ باسم عادي يستورد admin ويكتب على db: كاتب (يلزمه الحارس)');
// (ح) يستورد Timestamp وحده ويبني بيانات وهمية: ليس اتصالاً
const fakeOnly = S("const {Timestamp} = @R@('@google-cloud/firestore');\nconst fake = {set() {}, update() {}};\nfake.set(1); fake.update(2);\n");
ok(!classify('fake.test.js', fakeOnly).writer, '[٣-ح] استيراد Timestamp وحده مع قاعدة بيانات وهمية: ليس كاتباً ولا يُطلب منه الحارس');
// (ط) يحذف: DELETER
const deleter = S("const {db} = @R@('../src/utils/admin');\nawait db.collection('a').doc('b').delete();\n");
ok(classify('d.test.js', deleter).deleter && classify('d.test.js', deleter).writer, '[٣-ط] ملفّ يحذف: ضمن DELETERS وWRITERS معاً');
// (ي) rules-unit-testing لـFirestore يُصنَّف كاتباً؛ ولـStorage وحده لا
const rulesFs = S("const {initializeTestEnvironment} = @R@('@firebase/rules-unit-testing');\nconst {setDoc, doc} = @R@('firebase/firestore');\nawait testEnv.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), 'users/a'), {}); });\n");
ok(classify('r.rules.test.js', rulesFs).writer, '[٣-ي] قواعد Firestore عبر rules-unit-testing: كاتب');
const rulesStorage = S("const {initializeTestEnvironment} = @R@('@firebase/rules-unit-testing');\nconst {ref, uploadBytes} = @R@('firebase/storage');\nconst env = await initializeTestEnvironment({projectId: 'demo-nc', storage: {rules: ''}});\nawait uploadBytes(ref(x, 'a'), b);\n");
const cs = classify('s.rules.test.js', rulesStorage);
ok(!cs.writer && cs.storageOnly, '[٣-ي] قواعد Storage وحدها: ليست Firestore (STORAGE_ONLY)، ولا يُطلب منها حارس Firestore');
// (ك) تعليق يذكر admin و.set( لا يصنّف الملفّ
ok(!classify('c.test.js', S("// const {db} = @R@('../src/utils/admin'); db.collection('a').doc('b').set({});\nconst x = 1;\n")).writer, '[٣-ك] ما في التعليقات لا يُحسب');
// (ل) نهايات الأسطر CRLF لا تكسر الفاحص
ok(guardImportedFirst(goodOrder.replace(/\n/g, '\r\n')).first === true, '[٣-ل] CRLF لا يكسر الفاحص');

console.log(`\nemulatorGuardCoverage.test.js: ${n}/${n} assertions passed`);
