'use strict';

// predeployUntrackedUploadGuard.test.js — أمر مستخدم 2026-09-24 +03 (القرار
// ٧٧ البند ١): "حارس النشر يرفض أي ملفّ سيُرفع مع الدوالّ وليس متتبَّعاً في
// git، بحسب ما يرفعه النشر فعلاً (functions.ignore)، لا بحسب .gitignore."
// و"يُثبَت أنه يرفض بملفّ غير متتبَّع داخل functions/، وأنه يمرّ بعد إزالته."
//
// هذا الملفّ يُثبت المنطق (computeUndeclaredUploadedFiles/isIgnoredByFunctionsIgnore)
// بمجلَّد مؤقّت مُعزول (لا يلمس functions/ الحقيقي) + `shFn` مُزيَّفة (لا
// نداء git حقيقي هنا — عزل كامل، تكرار مضمون). **الإثبات على functions/
// الحقيقي فعلاً** (نصّ الأمر: "ملفّ غير متتبَّع داخل functions/") وثّقته
// رسالة الالتزام حرفياً (تشغيل يدوي: أُنشئ functions/tmp-guard-proof-
// DELETE-ME.txt، رُفض النشر باسم الملفّ، حُذف، عاد الحارس لا يذكره).
//
// Run: node functions/test/predeployUntrackedUploadGuard.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {
  computeUndeclaredUploadedFiles, isIgnoredByFunctionsIgnore, walkAllFiles,
} = require('../scripts/predeploy-commit-log');

const IGNORE_PATTERNS = [
  'node_modules', '.git', 'firebase-debug.log', 'firebase-debug.*.log',
  'firestore-debug.log', '*.local', '.env', '.env.*', 'scripts/out', 'test/output',
];

// ═══════════════════════════════════════════════════════════════════════
// ١ — isIgnoredByFunctionsIgnore: أنماط functions.json الفعلية اليوم.
// ═══════════════════════════════════════════════════════════════════════
ok(isIgnoredByFunctionsIgnore('node_modules/pkg/index.js', IGNORE_PATTERNS), '[١] node_modules/* مُستبعَد (نمط بلا / يستبعد كل ما تحت المجلَّد)');
ok(isIgnoredByFunctionsIgnore('firebase-debug.log', IGNORE_PATTERNS), '[١] firebase-debug.log مُستبعَد');
ok(isIgnoredByFunctionsIgnore('firebase-debug.12345.log', IGNORE_PATTERNS), '[١] firebase-debug.*.log مُستبعَد');
ok(!isIgnoredByFunctionsIgnore('firestore-debug-old.log', IGNORE_PATTERNS), '[١] firestore-debug-old.log (اسم مختلف) غير مُستبعَد — دقّة النمط لا فضفضة');
ok(isIgnoredByFunctionsIgnore('firestore-debug.log', IGNORE_PATTERNS), '[١] firestore-debug.log مُستبعَد (الإضافة الجديدة، القرار ٧٧-١)');
ok(isIgnoredByFunctionsIgnore('scripts/out/measure-x.json', IGNORE_PATTERNS), '[١] scripts/out/* مُستبعَد (نمط بفاصل — بادئة مسار)');
ok(!isIgnoredByFunctionsIgnore('scripts/output-not-this-dir.js', IGNORE_PATTERNS), '[١] scripts/output-not-this-dir.js لا يطابق نمط "scripts/out" (بادئة مسار كاملة segment-بـsegment، لا نصّية)');
ok(isIgnoredByFunctionsIgnore('test/output/v5_e2e_x.json', IGNORE_PATTERNS), '[١] test/output/* مُستبعَد');
ok(!isIgnoredByFunctionsIgnore('src/analysis/buildDisplayShapeV7.js', IGNORE_PATTERNS), '[١] كود المصدر العادي غير مُستبعَد');
console.log('تحقّق ١: isIgnoredByFunctionsIgnore يطابق أنماط firebase.json الفعلية حقلاً حقلاً');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — computeUndeclaredUploadedFiles على مجلَّد مؤقّت مُعزول: يكتشف ملفّاً
//     غير متتبَّع سيُرفع، ويتوقّف عن اكتشافه بعد أن يصير متتبَّعاً — و
//     احترام UNTRACKED_UPLOAD_ALLOWLIST.
// ═══════════════════════════════════════════════════════════════════════
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-guard-test-'));
  const sourceDir = path.join(tmpRoot, 'functions');
  fs.mkdirSync(path.join(sourceDir, 'scripts', 'out'), {recursive: true});
  fs.mkdirSync(path.join(sourceDir, 'src'), {recursive: true});

  fs.writeFileSync(path.join(sourceDir, 'src', 'tracked.js'), '// tracked\n');
  fs.writeFileSync(path.join(sourceDir, 'scripts', 'out', 'scratch.json'), '{}');
  fs.writeFileSync(path.join(sourceDir, 'untracked-and-uploaded.js'), '// oops\n');
  fs.writeFileSync(path.join(sourceDir, 'allowlisted.js'), '// intentional exception\n');

  // shFn مُزيَّفة: "git ls-files -- functions" تُعيد قائمة ثابتة — عزل
  // كامل عن git الحقيقي (لا نداء فعلي هنا، لا اعتماد على حالة المستودع).
  function fakeShFn(cmd) {
    ok(cmd.includes('git ls-files'), '[إعداد٢] shFn استُدعيت بأمر git ls-files كما هو متوقَّع');
    return 'functions/src/tracked.js';
  }

  const violations1 = computeUndeclaredUploadedFiles({
    repoRoot: tmpRoot, sourceDir, ignorePatterns: IGNORE_PATTERNS,
    allowlist: [{path: 'allowlisted.js', reason: 'اختبار: استثناء صريح بسبب مكتوب'}],
    shFn: fakeShFn,
  });
  deepEq(violations1.sort(), ['untracked-and-uploaded.js'],
      '[٢][رفض] untracked-and-uploaded.js وحده يظهر مخالفاً — tracked.js متتبَّع، scratch.json مُستبعَد بـfunctions.ignore، allowlisted.js في القائمة الصريحة');
  console.log(`تحقّق ٢ [رفض]: ${JSON.stringify(violations1)} — إثبات السقوط الحقيقي على مجلَّد مؤقّت مُعزول`);

  // بعد "تتبّع" الملفّ (تعديل shFn لتُعيده أيضاً ضمن git ls-files) — يمرّ.
  function fakeShFnAfterTracking(cmd) {
    return 'functions/src/tracked.js\nfunctions/untracked-and-uploaded.js';
  }
  const violations2 = computeUndeclaredUploadedFiles({
    repoRoot: tmpRoot, sourceDir, ignorePatterns: IGNORE_PATTERNS,
    allowlist: [{path: 'allowlisted.js', reason: 'اختبار'}],
    shFn: fakeShFnAfterTracking,
  });
  deepEq(violations2, [], '[٢][يمرّ] بعد تتبّع الملفّ — صفر مخالفة');
  console.log('تحقّق ٢ [يمرّ]: بعد تتبّع untracked-and-uploaded.js — الحارس لا يذكره');

  fs.rmSync(tmpRoot, {recursive: true, force: true});
}

console.log(`\npredeployUntrackedUploadGuard.test.js: ${n}/${n} assertions passed`);
