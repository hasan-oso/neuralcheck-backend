#!/usr/bin/env node
'use strict';

// ===================================================================
// predeploy-commit-log — خطّاف predeploy في firebase.json (أمر مستخدم
// 2026-09-23 +03، بعد التبديل): "سجلّ النشر يحفظ رقم الالتزام مع كل نشر
// من الآن — وإلّا تكرّر الاستنتاج في كل نشرة." و"يُلتقط الرقم آلياً وقت
// النشر، لا يدوياً (A81)."
// ===================================================================
//
// يعمل هذا السكربت لكل نشرة فعلية (firebase deploy يستدعيه تلقائياً قبل
// الرفع الفعلي، عبر firebase.json:functions[0].predeploy):
//
//   ١. **جديد 2026-09-24 +03 (القرار ٧٧ البند ١)** — يرفض النشر إن وُجد
//      ملفّ سيُرفع فعلياً مع الدوالّ (بحسب functions.ignore في firebase.json،
//      لا .gitignore — نصّ الأمر صراحة) وليس متتبَّعاً في git، إلا أن يكون
//      في UNTRACKED_UPLOAD_ALLOWLIST أدناه (كل بند بسبب مكتوب). راجع
//      computeUndeclaredUploadedFiles أسفل هذا الملفّ للتفصيل الكامل.
//   ٢. يرفض النشر إن كانت الشجرة تحمل ملفّاً متتبَّعاً معدَّلاً غير مُلتزَم
//      (git status --porcelain --untracked-files=no) — يطبّق نصّ المستخدم
//      "لا نشر قبل التزام كل ما في الشجرة" آلياً، لا اعتماداً على تذكّر
//      الوكيل.
//   ٣. يكتب docs/deploy-log/commit-<الوقت +03>.json يحمل رقم الالتزام
//      (git rev-parse HEAD)، الفرع، والوقت — قبل أن ترفع firebase أي شيء
//      فعلياً، فالملفّ موجود دائماً حتى لو فشل النشر بعد هذه النقطة
//      (رفع فعلي فاشل أفضل توثيقاً من نشرة ناجحة بلا سجلّ).
//
// **لماذا predeploy لا سكربت يدوي بعد النشر**: سكربت يدوي يُنسى (بالضبط
// ما وصف نصّ المستخدم — "الاستنتاج يتكرّر"). predeploy يُنفَّذه firebase
// CLI نفسه تلقائياً، فلا يعتمد على أن يتذكّر أحد تشغيله.
//
// **لا نشر من هذا السكربت نفسه** — فقط فحص + كتابة سجلّ. الرفض (كود خروج
// ≠ 0) يُوقف firebase deploy قبل أي اتّصال بالشبكة (سلوك firebase CLI
// القياسي لـpredeploy فاشل).
//
// **جديد 2026-09-24 +03 (الجولة الثالثة، القرار ٧٧ البند ٥ — إجراء
// التراجع)**: يقبل وسيطين اختياريين `--check-root=<مسار>` و`--log-root=<مسار>`
// — بلا أيّهما، السلوك مطابق حرفياً لما قبل هذا التحديث (استدعاء
// firebase deploy العادي، صفر تغيير سلوكي). الحاجة: نشر تراجع من التزام
// قديم (`git worktree add` عند ذلك الالتزام — الالتزامات القديمة لا تحمل
// هذا الخطّاف في `firebase.json` إطلاقاً، فلا طريقة لجعله يسري تلقائياً
// إلا بتشغيل **نسخة HEAD** من هذا الملفّ يدوياً، موجَّهة إلى شجرة
// الـworktree: `--check-root=<worktree>` (يفحص تتبّع/نظافة تلك الشجرة
// بالضبط، لا شجرة هذا الملفّ) مع `--log-root=<المستودع الرئيسي>` (السجلّ
// يبقى في `docs/deploy-log` بمكانه المعتاد، لا يختفي مع حذف الـworktree
// لاحقاً). راجع القسم "إجراء التراجع" في تقرير هذه الجولة للاستعمال الكامل.
//
// Usage (يُستدعى تلقائياً من firebase deploy بلا وسائط، أو يدوياً):
//   node functions/scripts/predeploy-commit-log.js
//   node functions/scripts/predeploy-commit-log.js --check-root=<worktree> --log-root=<repo>
// ===================================================================

const {execSync} = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'functions'); // firebase.json:functions[0].source
const DEPLOY_LOG_DIR = path.join(REPO_ROOT, 'docs', 'deploy-log');

function sh(cmd, cwd) {
  return execSync(cmd, {cwd: cwd || REPO_ROOT, encoding: 'utf8'}).trim();
}

/**
 * يحلّل `--name=value` من argv — بسيط، بلا مكتبة خارجية (وسيطان اثنان فقط).
 * @param {string[]} argv
 * @return {Object<string,string>}
 */
function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const m = arg.match(/^--([a-zA-Z-]+)=(.*)$/);
    if (m) opts[m[1]] = m[2];
  }
  return opts;
}

// ═══════════════════════════════════════════════════════════════════════
// حارس الملفّات غير المتتبَّعة (القرار ٧٧ البند ١، 2026-09-24 +03)
// ═══════════════════════════════════════════════════════════════════════
//
// أمر مستخدم حرفياً: "حارس النشر يرفض أي ملفّ سيُرفع مع الدوالّ وليس
// متتبَّعاً في git، بحسب ما يرفعه النشر فعلاً (functions.ignore في
// firebase.json)، لا بحسب .gitignore. يُستثنى ما في قائمة صريحة داخل
// الحارس، ولكل بند فيها سبب مكتوب."
//
// **قرار الوكيل — functions.ignore بدل قائمة استثناء متضخّمة**: عند كتابة
// هذا الحارس، ثلاث فئات ملفّات غير متتبَّعة كانت ستُرفع فعلياً:
//   (أ) functions/scripts/out/*.json (16 ملفّاً على الأقلّ وقت الكتابة،
//       عدد متزايد — كل تشغيلة قياس/تشخيص تضيف ملفّاً جديداً) — مخرَجات
//       تشخيص محلّية، صفر دور تشغيلي في أي دالّة مُصدَّرة (لا يستوردها
//       index.js ولا أي ملفّ يستورده).
//   (ب) functions/test/output/v5_e2e_*.json (3 ملفّات) — مخرَج اختبار
//       قديم، **مُستبعَد من git عمداً أصلاً** (.gitignore:28 "functions/test/output/")
//       — لكن .gitignore لا يمنع الرفع الفعلي (نصّ الأمر)، فهذا الاستبعاد
//       المقصود في git كان بلا أثر على النشر قبل هذا الإصلاح.
//   (ج) functions/firestore-debug.log — سجلّ محاكي محلّي متروك، بلا نمط
//       في functions.ignore يطابقه (`firebase-debug.*.log` يطابق البادئة
//       "firebase-debug" لا "firestore-debug" — نمط مختلف بحرف واحد).
// **إضافة الثلاثة إلى functions.ignore (firebase.json) بدل قائمة استثناء
// هنا — تغيير فعلي فيما يُرفع فعلياً مع كل نشرة قادمة (ذُكر بارزاً في
// تقرير المهمّة، نصّ الأمر: "إضافة scripts/out إلى functions.ignore تغيير
// في ما يُرفع، فاذكره بارزاً")**: هذه ملفّات تشخيص/اختبار محلّية بلا أي
// دور تشغيلي، وقائمة استثناء هنا كانت ستحتاج تحديثاً يدوياً متكرّراً مع
// كل ملفّ scripts/out جديد (عدد غير محدود بتصميمه) — عكس هدف الحارس
// (منع نسيان الاستثناء، لا فرض تذكّره باستمرار). functions/scripts/regenerate-report.js
// (مذكور في نصّ المهمّة كمثال ملفّ غير متتبَّع) **صار متتبَّعاً فعلاً** —
// الالتزام 2cbb5c6 ("chore: track functions/scripts/regenerate-report.js")
// سبق هذه الجلسة، فالمثال في نصّ الأمر انجرف عن حالة المستودع الحالية
// (القاعدة 14 — أُبلغ به هنا، لا يُفترض ضمناً).
//
// **UNTRACKED_UPLOAD_ALLOWLIST تبقى آلية حيّة** (فارغة اليوم بعد إصلاح
// functions.ignore أعلاه) لأي استثناء مستقبلي حقيقي — كل بند بمساره
// النسبي من جذر functions/ وسبب مكتوب، لا نمط عامّ.
const UNTRACKED_UPLOAD_ALLOWLIST = Object.freeze([
  // {path: 'example/path.json', reason: 'سبب مكتوب هنا'},
]);

/**
 * يحوّل نمط functions.ignore واحداً إلى RegExp — دعم `*` (أي محارف غير
 * `/`) فقط، بلا `**`/تنفية/تجميع أقواس (أنماط firebase.json الفعلية
 * اليوم كلّها أسماء بسيطة أو `name.*.ext` — لا حاجة لمحرّك gitignore
 * كامل هنا؛ إن أُضيف نمط أعقد لاحقاً فهذه الدالّة تحتاج توسيعاً موازياً،
 * لا افتراض صمت أنها تدعمه).
 * @param {string} pattern
 * @return {RegExp}
 */
function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

/**
 * هل يطابق مسار نسبي (بفواصل `/`، من جذر functions/) أحد أنماط
 * functions.ignore؟ نمط بلا `/` يطابق أيّ segment في المسار (سلوك
 * .gitignore لنمط بلا فاصل — استبعاد مجلَّد يستبعد كل ما تحته)؛ نمط فيه
 * `/` يُطابَق بادئة مسار كاملة (segment بـsegment من الجذر).
 * @param {string} relPosixPath
 * @param {string[]} ignorePatterns
 * @return {boolean}
 */
function isIgnoredByFunctionsIgnore(relPosixPath, ignorePatterns) {
  const segments = relPosixPath.split('/');
  for (const pattern of ignorePatterns) {
    if (pattern.includes('/')) {
      const patSegments = pattern.split('/');
      const prefix = segments.slice(0, patSegments.length).join('/');
      if (patternToRegex(pattern).test(prefix) || prefix === pattern) return true;
    } else {
      const re = patternToRegex(pattern);
      if (segments.some((seg) => re.test(seg))) return true;
    }
  }
  return false;
}

/**
 * يمشي شجرة `sourceDir` كاملة (باستثناء `.git`)، ويُعيد كل الملفّات
 * (لا المجلّدات) بمسار نسبي بفواصل `/` من `sourceDir`.
 * @param {string} sourceDir
 * @return {string[]}
 */
function walkAllFiles(sourceDir) {
  const out = [];
  function walk(dir, relPrefix) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === '.git') continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  walk(sourceDir, '');
  return out;
}

/**
 * القائمة الكاملة للفحص: ملفّات ستُرفع فعلياً (غير مُستبعَدة بـfunctions.ignore)
 * وليست متتبَّعة في git ولا في UNTRACKED_UPLOAD_ALLOWLIST.
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.sourceDir مجلَّد functions.source (مطلق)
 * @param {string[]} opts.ignorePatterns
 * @param {Array<{path:string,reason:string}>} opts.allowlist
 * @param {function(string):string} opts.shFn لتنفيذ `git ls-files` — قابل للاستبدال في الاختبار
 * @return {string[]} مسارات نسبية من sourceDir، فارغة إن لا مخالفة
 */
function computeUndeclaredUploadedFiles({repoRoot, sourceDir, ignorePatterns, allowlist, shFn}) {
  const allFiles = walkAllFiles(sourceDir).map((p) => p.split(path.sep).join('/'));
  const uploadable = allFiles.filter((p) => !isIgnoredByFunctionsIgnore(p, ignorePatterns));

  const sourceRelToRepo = path.relative(repoRoot, sourceDir).split(path.sep).join('/');
  const lsFilesOut = shFn(`git ls-files -- "${sourceRelToRepo}"`);
  const trackedSet = new Set(
      lsFilesOut.split('\n').filter(Boolean).map((p) => p.slice(sourceRelToRepo.length + 1)),
  );

  const allowedSet = new Set(allowlist.map((a) => a.path));
  return uploadable.filter((p) => !trackedSet.has(p) && !allowedSet.has(p));
}

// +03 دائماً (القيد الصريح في CLAUDE.md — "كل وقت بتوقيت +03").
function nowPlus03() {
  const utc = new Date();
  const plus3 = new Date(utc.getTime() + 3 * 60 * 60 * 1000);
  const iso = plus3.toISOString().replace('Z', '');
  // YYYY-MM-DDTHHMMSS+03 — نفس صيغة الملفّات القائمة في deploy-log/.
  const [datePart, timePart] = iso.split('T');
  const hhmmss = timePart.slice(0, 8).replace(/:/g, '');
  return `${datePart}T${hhmmss}+03`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  // بلا وسائط: مطابق حرفياً للسلوك القديم (checkRoot=logRoot=REPO_ROOT —
  // مكان هذا الملفّ نفسه). راجع تعليق رأس الملفّ لسيناريو التراجع.
  const checkRoot = opts['check-root'] ? path.resolve(opts['check-root']) : REPO_ROOT;
  const checkSourceDir = path.join(checkRoot, 'functions');
  const logRoot = opts['log-root'] ? path.resolve(opts['log-root']) : checkRoot;
  const deployLogDir = path.join(logRoot, 'docs', 'deploy-log');
  const shCheck = (cmd) => sh(cmd, checkRoot);

  // ١ — الرفض: ملفّ غير متتبَّع سيُرفع فعلياً مع الدوالّ (القرار ٧٧ البند ١).
  const firebaseJson = JSON.parse(fs.readFileSync(path.join(checkRoot, 'firebase.json'), 'utf8'));
  const ignorePatterns = firebaseJson.functions[0].ignore || [];
  const violations = computeUndeclaredUploadedFiles({
    repoRoot: checkRoot, sourceDir: checkSourceDir, ignorePatterns,
    allowlist: UNTRACKED_UPLOAD_ALLOWLIST, shFn: shCheck,
  });
  if (violations.length > 0) {
    console.error(`✗ predeploy: ${violations.length} ملفّاً سيُرفع فعلياً مع الدوالّ وليس متتبَّعاً في git — النشر مرفوض.`);
    console.error(`  (فحص على: ${checkRoot})`);
    console.error('  (نصّ المستخدم: "حارس النشر يرفض أي ملفّ سيُرفع مع الدوالّ وليس متتبَّعاً في git،');
    console.error('   بحسب ما يرفعه النشر فعلاً (functions.ignore)، لا بحسب .gitignore")');
    for (const v of violations) console.error(`    functions/${v}`);
    console.error('\n  إمّا git add/commit للملفّ، أو استبعاده صراحة في firebase.json:functions[0].ignore،');
    console.error('  أو إضافته إلى UNTRACKED_UPLOAD_ALLOWLIST في هذا الملفّ (بسبب مكتوب)، ثم أعد المحاولة.');
    process.exit(1);
  }

  // ٢ — الرفض: شجرة غير نظيفة (ملفّ متتبَّع معدَّل) توقف النشر.
  // --untracked-files=no: غير المتتبَّع يُفحَص أعلاه بمنطق مختلف (ما
  // يُرفع فعلاً)، لا هنا (هنا: هل ما هو متتبَّع مُلتزَم بالكامل).
  const porcelain = shCheck('git status --porcelain --untracked-files=no');
  if (porcelain.length > 0) {
    console.error('✗ predeploy: الشجرة تحمل ملفّاً متتبَّعاً معدَّلاً غير مُلتزَم — النشر مرفوض.');
    console.error(`  (فحص على: ${checkRoot})`);
    console.error('  (نصّ المستخدم: "لا نشر قبل التزام كل ما في الشجرة")');
    console.error('  الملفّات المعدَّلة:');
    for (const line of porcelain.split('\n')) console.error(`    ${line}`);
    console.error('\n  git add / git commit أوّلاً، ثم أعد المحاولة.');
    process.exit(1);
  }

  // ٣ — السجلّ: يُكتب دائماً قبل أي رفع فعلي (حتى لو فشل النشر لاحقاً).
  // رقم الالتزام يُقرأ من checkRoot (الشجرة المنشورة فعلياً)، لكن السجلّ
  // نفسه يُكتب في logRoot/docs/deploy-log (المستودع الرئيسي عادةً — يبقى
  // بعد حذف أي worktree مؤقّتة).
  const commit = shCheck('git rev-parse HEAD');
  const shortCommit = shCheck('git rev-parse --short HEAD');
  const branch = shCheck('git rev-parse --abbrev-ref HEAD');
  const timestamp = nowPlus03();

  const entry = {
    commit,
    shortCommit,
    branch,
    timestampPlus03: timestamp,
    // checkRoot!==logRoot يعني نشراً من worktree منفصلة (سيناريو تراجع،
    // القرار ٧٧ البند ٥) — يُسجَّل صراحة، لا صمتاً (القاعدة 22).
    checkedRoot: checkRoot === logRoot ? undefined : checkRoot,
    // ملء بعد النشر يدوياً غير مطلوب — هذا سجلّ "ماذا كان الالتزام وقت
    // محاولة النشر"، لا سجلّ نجاح/فشل النشر نفسه (ذلك من deploy-log/
    // gcloud-functions-updatetime-*.json، يُلتقط منفصلاً بعد التأكّد من
    // النجاح — راجع README.md).
  };

  fs.mkdirSync(deployLogDir, {recursive: true});
  const outPath = path.join(deployLogDir, `commit-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(entry, null, 2) + '\n', 'utf8');

  console.log(`✓ predeploy: الشجرة نظيفة (${checkRoot}). رقم الالتزام (${shortCommit}) مُسجَّل في ${outPath}`);
}

module.exports = {
  computeUndeclaredUploadedFiles, isIgnoredByFunctionsIgnore, patternToRegex,
  walkAllFiles, UNTRACKED_UPLOAD_ALLOWLIST, SOURCE_DIR, REPO_ROOT, parseArgs, sh,
};

if (require.main === module) {
  main();
}
