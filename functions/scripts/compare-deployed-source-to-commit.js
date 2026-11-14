#!/usr/bin/env node
'use strict';

// ===================================================================
// compare-deployed-source-to-commit — يقارن معرِّفات blob في git لملفّات
// أرشيف مصدر منشور فعلياً (نزّله المستخدم يدوياً من gcloud) بنفس الملفّات
// عند التزام Git مُحدَّد. أمر مستخدم 2026-09-23 +03 (القرار 73، البند ٤).
// **لا شبكة، لا Firestore، لا gcloud من هذا السكربت — المستخدم يُنزِّل
// الأرشيف بنفسه، هذا السكربت يقارن ملفّات محلّية فقط.** لم يُشغَّل (القيد
// الصريح: "تكتبه ولا تشغّله").
//
// ⚠️ **إصلاح 2026-09-24 +03 (القرار ٧٧ البند ٤)** — النسخة السابقة كانت
// تقارن SHA-256 للبايتات الخام (الأرشيف كما هو) بـSHA-256 لمخرَج
// `git show <ref>:<path>` (بلا أي تطبيع) — فكل ملفّ نصّي يظهر "مختلفاً"
// وإن طابق فعلياً، لأن الأرشيف المنشور يُرفع من شجرة عمل ويندوز (CRLF عبر
// core.autocrlf) بينما محتوى git (والاستخراج عبره) LF. أداة المنسّق
// المرجعية (`tools-deployed-archive-vs-commit.js`، مساحة العمل) تحلّ هذا
// بحساب **معرِّف blob في git نفسه** (`sha1("blob " + length + "\0" + content)`)
// لكل ملفّ في الأرشيف **بعد تطبيع CRLF→LF** (للملفّات النصّية فقط — أي
// ملفّ بلا بايت NUL؛ الثنائي يُحسَب كما هو بلا تطبيع)، ويقارنه بمعرِّف
// الـblob الفعلي من `git ls-tree -r <ref> -- functions/` مباشرة — لا
// `git show` + إعادة حساب SHA-256 مستقلّ (ذلك المسار عرضة لتطبيع إضافي
// من git نفسه بحسب core.autocrlf وقت `show`، وهو تحديداً ما ولَّد العطب
// الأصلي). هذا الملفّ يتبنّى نفس الأسلوب حرفياً (منطق blobId/treeOf
// مطابق لأداة المنسّق، لا نسخة مستقلّة قد تنجرف — القاعدة 24) — لا يُغيّر
// واجهة سطر الأوامر ولا شكل مخرَج JSON (نفس الحقول: refCommit،
// filesCompared، identical[]، different[]، onlyInArchive[]، onlyInCommit[]).
//
// القاعدة 36: لا يطبع نصّ سجلّ (log) ولا متغيّر بيئة — فقط مسارات نسبية
// ومعرِّفات blob وأحكام تطابق/اختلاف.
//
// Usage:
//   node functions/scripts/compare-deployed-source-to-commit.js \
//     <مجلّد الأرشيف المُستخرَج محلّياً> <SHA أو مرجع Git، مثلاً 22958cb>
//
// المخرَج: JSON على stdout — {refCommit, filesCompared, identical[],
// different[], onlyInArchive[], onlyInCommit[]}.
// ===================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');

function walkFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, base, out);
    } else {
      out.push(path.relative(base, full).replace(/\\/g, '/'));
    }
  }
  return out;
}

// معرِّف blob في git — مطابق حرفياً لـ tools-deployed-archive-vs-commit.js
// (المنسّق، مساحة العمل): تطبيع CRLF→LF قبل الحساب، **فقط** إن كان
// المحتوى بلا بايت NUL (نصّي على الأرجح) — ملفّ ثنائي يُحسَب كما هو بلا
// أي تطبيع (تطبيع ثنائي كان سيُفسد بايتات ذات معنى).
// @param {Buffer} buf
// @return {string} SHA-1 hex (40 حرفاً) — نفس معرِّف git blob تماماً
function blobId(buf) {
  let b = buf;
  if (!buf.includes(0)) b = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
}

// معرِّفات blob الفعلية عند مرجع Git — عبر `git ls-tree -r` مباشرة، لا
// `git show` لكل ملفّ على حدة (أسرع، وليس عرضة لأي تطبيع EOL إضافي قد
// يُطبِّقه git على مخرَج `show` بحسب core.autocrlf وقت الاستخراج — هذا
// بالضبط مصدر العطب الأصلي في هذا الملفّ).
// @param {string} repoRoot
// @param {string} ref
// @return {Map<string,string>} relPath (بلا بادئة "functions/") → blob SHA-1
function treeOfFunctionsDir(repoRoot, ref) {
  const out = execFileSync('git', ['-C', repoRoot, 'ls-tree', '-r', ref, '--', 'functions/'],
      {encoding: 'utf8', maxBuffer: 1024 * 1024 * 64});
  const map = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/);
    if (!m) continue;
    const rel = m[2].replace(/^functions\//, '');
    if (rel.startsWith('node_modules/')) continue;
    map.set(rel, m[1]);
  }
  return map;
}

function main() {
  const [archiveDir, ref] = process.argv.slice(2);
  if (!archiveDir || !ref) {
    console.error('Usage: node compare-deployed-source-to-commit.js <archive_dir> <git_ref>');
    process.exit(1);
  }
  const repoRoot = path.join(__dirname, '..', '..'); // جذر neuralcheck-backend

  const archiveFiles = walkFiles(archiveDir);
  const tree = treeOfFunctionsDir(repoRoot, ref);
  const result = {refCommit: ref, filesCompared: 0, identical: [], different: [], onlyInArchive: [], onlyInCommit: []};

  const seenInArchive = new Set();
  for (const relPath of archiveFiles) {
    seenInArchive.add(relPath);
    const buf = fs.readFileSync(path.join(archiveDir, relPath));
    const archiveBlobId = blobId(buf);
    result.filesCompared++;
    if (!tree.has(relPath)) {
      result.onlyInArchive.push(relPath);
    } else if (tree.get(relPath) === archiveBlobId) {
      result.identical.push(relPath);
    } else {
      result.different.push(relPath);
    }
  }
  for (const relPath of tree.keys()) {
    if (!seenInArchive.has(relPath)) result.onlyInCommit.push(relPath);
  }

  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main();
module.exports = {walkFiles, blobId, treeOfFunctionsDir};
