#!/usr/bin/env node
'use strict';

// ===================================================================
// compare-llm-adjusted-golden-letters — القرار ٩٢ البند ١ (نصّ الأمر):
// "compare-v7-golden-letters.js لا يغطّيها [v7-client-payload-sample-
// llm-adjusted.json]، فهو يغطّي ثلاث عيّنات أخرى (SAMPLES، :28-32).
// فاعرضه بأداة واذكرها." و"وفرق الحروف فيها قبل وبعد، بالمسار."
//
// يعيد استعمال extractLetters/diffSnapshots المُصدَّرتين فعلياً من
// compare-v7-golden-letters.js (القاعدة 24 — لا نسخة ثانية من منطق
// المشي/الاستخراج) — يُطبِّقهما على هذا الملفّ الرابع وحده، الذي لا
// يغطّيه ذلك السكربت (SAMPLES هناك ثلاث عيّنات مُسمّاة صراحة، ليس من
// بينها هذه). هذا سكربت مستقلّ يسدّ تلك الفجوة لهذا الملفّ تحديداً — لا
// تعديل على compare-v7-golden-letters.js نفسه (لم يُطلَب، ونطاقه المُعلَن
// "العيّنات الذهبية الثلاث" يبقى صحيحاً كما هو موثَّق في تعليق رأسه).
//
// Usage:
//   node scripts/compare-llm-adjusted-golden-letters.js --before <sha-or-ref> [--after <sha-or-ref-or-fresh>]
//   بلا وسائط: يقارن HEAD (git show) بالملفّ الحالي على القرص (بعد إعادة التوليد).
// ===================================================================

const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');
const {extractLetters, diffSnapshots} = require('./compare-v7-golden-letters');

const FILE_REL = 'test/fixtures/golden/v7-client-payload-sample-llm-adjusted.json';
const FILE_ABS = path.join(__dirname, '..', FILE_REL);

function lettersFromGitRef(ref) {
  const content = execSync(`git show ${ref}:functions/${FILE_REL}`, {
    cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 1024 * 1024 * 20,
  });
  const letters = {};
  extractLetters(JSON.parse(content), '', letters);
  return letters;
}

function lettersFromDisk(absPath) {
  const letters = {};
  extractLetters(JSON.parse(fs.readFileSync(absPath, 'utf8')), '', letters);
  return letters;
}

function main() {
  const argv = process.argv.slice(2);
  const beforeIdx = argv.indexOf('--before');
  const afterIdx = argv.indexOf('--after');
  const beforeRef = beforeIdx !== -1 ? argv[beforeIdx + 1] : 'HEAD';
  const afterRef = afterIdx !== -1 ? argv[afterIdx + 1] : null;

  const before = {[FILE_REL]: lettersFromGitRef(beforeRef)};
  const after = {[FILE_REL]: afterRef ? lettersFromGitRef(afterRef) : lettersFromDisk(FILE_ABS)};

  const beforeCount = Object.keys(before[FILE_REL]).length;
  const afterCount = Object.keys(after[FILE_REL]).length;
  console.log(`الملفّ: ${FILE_REL}`);
  console.log(`قبل (${beforeRef}): ${beforeCount} حرفاً`);
  console.log(`بعد (${afterRef || 'القرص الحالي'}): ${afterCount} حرفاً`);

  const diffs = diffSnapshots(before, after);
  console.log(`فرق الحروف: ${diffs.length}`);
  for (const d of diffs) console.log(`  ${d}`);

  if (diffs.length === 0) {
    console.log('لا فرق في أيّ حرف — كل ما تغيّر بين النسختين حقول أخرى غير letter (مثل letterCeilingReason الجديد).');
  }
}

if (require.main === module) {
  main();
}

module.exports = {lettersFromGitRef, lettersFromDisk};
