#!/usr/bin/env node
'use strict';

// ===================================================================
// measure-payload-history — يبني حمولة V7 (buildV7Payload الفعلية، لا
// إعادة بناء يدوية) على مجموعة من الالتزامات التاريخية، كلٌّ بكوده
// الخاصّ (findings.js/categoryStates.js/buildV7Payload.js كما كانت عند
// ذلك الالتزام)، عبر git worktree مؤقّتة مُزالة فوراً بعد كل قياس — لا
// stash (القاعدة 11)، للقراءة فقط.
//
// السبب: تحديث ثابت payloadBytes في measure-callAIv7-live.js
// (64782/64824) تمّ في 9514421 — **قبل** إضافة بوّابة LOW_CATEGORY_COVERAGE
// (30ef54a) وقبل حقل findings.storage.capacityDerived (4b52c8f). فالفارق
// +6636/+6689 المُبلَّغ عنه ليس بالضرورة كلّه من حقلَي هذه المهمّة
// (belowThreshold/allNonMeasurement) — قد يكون معظمه من التزامات سابقة لم
// يُعَد قياس الثابت بعدها. هذا السكربت يقيس كل خطوة على حدة، حقلاً بحقل،
// بلا افتراض.
//
// Usage:
//   node functions/scripts/measure-payload-history.js
//   node functions/scripts/measure-payload-history.js --commits sha1,sha2,...
//   node functions/scripts/measure-payload-history.js --out path/to/file.json
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_COMMITS = ['9514421', '30ef54a', 'efeebe7', '4b52c8f', '2cce881', 'HEAD'];

const argv = process.argv.slice(2);
function argValue(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : def;
}
const commits = (argValue('--commits', DEFAULT_COMMITS.join(','))).split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = path.join(__dirname, 'out');
const outPath = argValue('--out', path.join(OUT_DIR, `payload-history-${Date.now()}.json`));

const SCAN_TARGETS = [
  {scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', tsFile: 'b45c8cf6.ts.json'},
  {scanId: '34dff2b8-ce9e-4b40-86a9-1976c878e195', tsFile: '34dff2b8.ts.json'},
];

function git(args, cwd) {
  return execFileSync('git', args, {cwd: cwd || REPO_ROOT, encoding: 'utf8'}).trim();
}

// يقيس حمولة V7 لكلا الفِخّين باستعمال الوحدات من <base>/functions —
// نداء منفصل لعملية node مستقلّة (child process) كي لا تتلوّث ذاكرة
// require() لهذا السكربت بوحدات من التزامات مختلفة بنفس المسار النسبي.
function measureAtBase(base) {
  const functionsDir = path.join(base, 'functions');
  const workerScript = path.join(__dirname, '_measure-payload-worker.js');
  const raw = execFileSync(process.execPath, [workerScript, functionsDir], {encoding: 'utf8'});
  return JSON.parse(raw);
}

function resolveCommit(ref) {
  try {
    return git(['rev-parse', ref]);
  } catch (e) {
    return null;
  }
}

function commitSubject(sha) {
  try {
    return git(['log', '-1', '--format=%s', sha]);
  } catch (e) {
    return '(تعذّر القراءة)';
  }
}

const results = [];
for (const ref of commits) {
  const sha = resolveCommit(ref);
  if (!sha) {
    results.push({ref, error: 'مرجع غير موجود — رُفض بلا تخمين'});
    console.error(`⚠ ${ref}: مرجع غير موجود، تخطّي`);
    continue;
  }
  const shortSha = sha.slice(0, 7);
  const subject = commitSubject(sha);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `nc-payload-hist-${shortSha}-`));
  // إزالة المجلّد الفارغ الذي أنشأه mkdtempSync — git worktree add يرفض
  // إنشاء worktree في مسار موجود بمحتوى، لكنه يقبل مسار فارغ فعلياً أو
  // غير موجود. نُبقيه فارغاً (mkdtempSync لا يضع شيئاً بداخله) فيعمل.
  console.error(`→ ${ref} (${shortSha}) "${subject}" — git worktree add --detach ${tmpDir}`);
  let worktreeAdded = false;
  try {
    git(['worktree', 'add', '--detach', tmpDir, sha]);
    worktreeAdded = true;
    const measured = measureAtBase(tmpDir);
    results.push({ref, sha, shortSha, subject, ...measured});
  } catch (e) {
    results.push({ref, sha, shortSha, subject, error: String(e && e.message || e)});
    console.error(`  ✗ فشل القياس على ${ref}: ${e && e.message}`);
  } finally {
    if (worktreeAdded) {
      try {
        git(['worktree', 'remove', '--force', tmpDir]);
      } catch (e2) {
        console.error(`  ⚠ تعذّرت إزالة worktree ${tmpDir} — أزِله يدوياً: git worktree remove --force "${tmpDir}"`);
      }
    } else {
      try { fs.rmSync(tmpDir, {recursive: true, force: true}); } catch (e3) { /* تجاهل */ }
    }
  }
}

// طباعة موجز بشري + حساب الفوارق بين كل التزام والذي يليه.
console.log('\n═══ measure-payload-history — موجز ═══\n');
for (const scanTarget of SCAN_TARGETS) {
  console.log(`── ${scanTarget.scanId} ──`);
  let prev = null;
  for (const r of results) {
    if (r.error) { console.log(`  ${r.ref} (${r.shortSha || '?'}): خطأ — ${r.error}`); continue; }
    const s = r.scans && r.scans[scanTarget.scanId];
    if (!s) { console.log(`  ${r.ref} (${r.shortSha}): لا بيانات لهذا الفحص`); continue; }
    const delta = prev !== null ? s.payloadLength - prev : null;
    console.log(`  ${r.ref.padEnd(9)} ${r.shortSha}  "${r.subject.slice(0, 50)}"` +
        `  payloadLength=${s.payloadLength}` +
        (delta !== null ? `  Δ=${delta >= 0 ? '+' : ''}${delta}` : '') +
        `  gates=${s.gateObjCount}(LOW_CATEGORY_COVERAGE=${s.lowCovGateCount})`);
    prev = s.payloadLength;
  }
  console.log('');
}

fs.mkdirSync(OUT_DIR, {recursive: true});
fs.writeFileSync(outPath, JSON.stringify({generatedAt: new Date().toISOString(), commits, results}, null, 2));
console.log(`مخرَج كامل محفوظ في: ${outPath}`);
