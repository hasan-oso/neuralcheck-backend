'use strict';

// predeployCheckRootWorktree.test.js — أمر مستخدم 2026-09-24 +03 (الجولة
// الثالثة، القرار ٧٧ البند ٥): إجراء التراجع يحتاج تشغيل **نسخة HEAD**
// من predeploy-commit-log.js (بحارس القرار ٧٧ البند ١) موجَّهة إلى شجرة
// git worktree عند التزام قديم — لأن الالتزامات القديمة لا تحمل هذا
// الخطّاف في firebase.json إطلاقاً (مُتحقَّق: `git show <c>:firebase.json`
// عند 42aa5ba/b8bf511/7fa7026 — لا predeploy). القرار ٧٧ البند ١ نفسه:
// "كل حارس يُثبَت أنه يرفض بملفّ غير متتبَّع ويمرّ بعد إزالته" — هذا
// الاختبار يُثبته على **worktree حقيقية فعلية**، لا مجلَّد مؤقّت مُصطنَع
// (بخلاف predeployUntrackedUploadGuard.test.js الذي يختبر المنطق الداخلي
// معزولاً بـshFn مُزيَّفة) — تكامل حقيقي مع `git worktree`/`--check-root`/
// `--log-root`.
//
// يُشغِّل main() **كعملية فرعية منفصلة** (execFileSync) لا داخل نفس
// العملية — main() تستدعي process.exit() مباشرة عند الرفض، وهذا يُنهي
// عملية Node المُستضيفة لو استُدعيت مباشرة هنا.
//
// صفر شبكة، صفر Firestore. ينظّف الـworktree المؤقّتة دائماً (try/finally)
// حتى لو أخفق أحد التأكيدات.
//
// Run: node functions/test/predeployCheckRootWorktree.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'functions', 'scripts', 'predeploy-commit-log.js');

function git(args, cwd) {
  return execFileSync('git', args, {cwd: cwd || REPO_ROOT, encoding: 'utf8'}).trim();
}

function runGuard(args) {
  try {
    const out = execFileSync('node', [SCRIPT_PATH, ...args], {cwd: REPO_ROOT, encoding: 'utf8'});
    return {exitCode: 0, stdout: out, stderr: ''};
  } catch (e) {
    return {exitCode: e.status, stdout: e.stdout ? e.stdout.toString() : '', stderr: e.stderr ? e.stderr.toString() : ''};
  }
}

(async () => {
  const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-worktree-test-'));
  fs.rmdirSync(worktreeDir); // git worktree add يرفض مجلَّداً موجوداً غير فارغ تماماً — نمرّر المسار وحده، فارغاً حتى لا يوجد أصلاً
  const logRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'predeploy-logroot-test-'));

  try {
    // ─── إعداد: worktree حقيقية عند HEAD (تحمل firebase.json + functions/
    // كاملَين — الالتزام الحالي، ليس التزاماً تاريخياً قديماً بلا حارس؛ هذا
    // الاختبار يثبت آلية --check-root نفسها، لا يعتمد على تاريخ محدَّد). ──
    git(['worktree', 'add', '--detach', worktreeDir, 'HEAD']);
    ok(fs.existsSync(path.join(worktreeDir, 'firebase.json')), '[إعداد] worktree تحمل firebase.json فعلياً');
    ok(fs.existsSync(path.join(worktreeDir, 'functions', 'index.js')), '[إعداد] worktree تحمل functions/index.js فعلياً');

    // ═══════════════════════════════════════════════════════════════════
    // ١ — نظيفة فور الإنشاء: صفر ملفّ غير متتبَّع (خلافاً لـgit checkout في
    //     الشجرة الرئيسية — الذي يُبقي functions/scripts/out/*.json غير
    //     المتتبَّعة كما هي). القرار ٧٧ البند ٥ نقطة (ب).
    // ═══════════════════════════════════════════════════════════════════
    const before = runGuard([`--check-root=${worktreeDir}`, `--log-root=${logRootDir}`]);
    eq(before.exitCode, 0, `[١] worktree نظيفة فعلاً فور الإنشاء — الحارس يمرّ (stderr: ${before.stderr.slice(0, 300)})`);
    console.log(`تحقّق ١: worktree عند HEAD نظيفة فور git worktree add — صفر ملفّ غير متتبَّع (بخلاف git checkout في الشجرة الرئيسية)`);

    // ═══════════════════════════════════════════════════════════════════
    // ٢ — إثبات السقوط الحقيقي: ملفّ غير متتبَّع داخل functions/ في
    //     الـworktree (غير مُستبعَد بأي نمط functions.ignore) → رفض فعلي.
    // ═══════════════════════════════════════════════════════════════════
    const proofFile = path.join(worktreeDir, 'functions', 'tmp-worktree-guard-proof-DELETE-ME.txt');
    fs.writeFileSync(proofFile, 'proof file for --check-root test\n', 'utf8');

    const withViolation = runGuard([`--check-root=${worktreeDir}`, `--log-root=${logRootDir}`]);
    eq(withViolation.exitCode, 1, '[٢] الحارس يرفض فعلياً بوجود ملفّ غير متتبَّع في worktree عبر --check-root');
    ok(withViolation.stderr.includes('tmp-worktree-guard-proof-DELETE-ME.txt'),
        `[٢] رسالة الرفض تسمّي الملفّ صراحة: ${withViolation.stderr.slice(0, 400)}`);
    console.log('تحقّق ٢: --check-root يرفض فعلياً بملفّ غير متتبَّع داخل worktree — رسالة تسمّي الملفّ');

    // ═══════════════════════════════════════════════════════════════════
    // ٣ — بعد إزالته: يمرّ من جديد، ويكتب سجلّاً في --log-root (لا داخل
    //     الـworktree نفسها — يبقى بعد حذفها لاحقاً، القرار ٧٧ البند ٥).
    // ═══════════════════════════════════════════════════════════════════
    fs.unlinkSync(proofFile);
    const afterRemoval = runGuard([`--check-root=${worktreeDir}`, `--log-root=${logRootDir}`]);
    eq(afterRemoval.exitCode, 0, `[٣] بعد حذف الملفّ — الحارس يمرّ من جديد (stderr: ${afterRemoval.stderr.slice(0, 300)})`);

    const deployLogDir = path.join(logRootDir, 'docs', 'deploy-log');
    ok(fs.existsSync(deployLogDir), '[٣] docs/deploy-log كُتب فعلياً تحت --log-root');
    const logFiles = fs.readdirSync(deployLogDir).filter((f) => f.startsWith('commit-'));
    ok(logFiles.length > 0, `[٣] ملفّ سجلّ واحد على الأقلّ كُتب فعلياً: ${JSON.stringify(logFiles)}`);
    const logEntry = JSON.parse(fs.readFileSync(path.join(deployLogDir, logFiles[0]), 'utf8'));
    eq(logEntry.checkedRoot, worktreeDir, '[٣] السجلّ يذكر checkedRoot=worktree صراحة (checkRoot≠logRoot) — لا صمت (القاعدة 22)');
    console.log(`تحقّق ٣: بعد حذف الملفّ — يمرّ ويكتب سجلّاً فعلياً في --log-root (${deployLogDir}) يذكر checkedRoot`);
  } finally {
    // تنظيف — دائماً، حتى لو أخفق تأكيد أعلاه.
    try { git(['worktree', 'remove', '--force', worktreeDir]); } catch (e) { /* أفضل جهد */ }
    try { fs.rmSync(worktreeDir, {recursive: true, force: true}); } catch (e) { /* أفضل جهد */ }
    try { fs.rmSync(logRootDir, {recursive: true, force: true}); } catch (e) { /* أفضل جهد */ }
    try { git(['worktree', 'prune']); } catch (e) { /* أفضل جهد */ }
  }

  console.log(`\npredeployCheckRootWorktree.test.js: ${n}/${n} assertions passed`);
})().catch((e) => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
