'use strict';

// compareDeployedSourceToCommit.test.js — أمر مستخدم 2026-09-24 +03 (القرار
// ٧٧ البند ٤): إصلاح خلل CRLF/LF في compare-deployed-source-to-commit.js —
// كان يقارن SHA-256 للبايتات الخام بـ`git show` بلا تطبيع، فيظهر كل ملفّ
// نصّي "مختلفاً" حتى لو تطابق فعلياً على أرشيف مرفوع من شجرة عمل ويندوز
// (CRLF). الإصلاح: `blobId` (معرِّف git blob الحقيقي، بعد تطبيع CRLF→LF
// للملفّات النصّية فقط) مطابق لأداة المنسّق المرجعية
// (tools-deployed-archive-vs-commit.js، مساحة العمل).
//
// هذا الاختبار **حقيقي بـgit محلّي** (لا شبكة — أوامر git محلّية بحتة على
// هذا المستودع نفسه، بلا اتّصال) — لا يحتاج بيانات خارجية: يستعمل
// functions/package.json المُلتزَم فعلاً كعيّنة (ملفّ صغير، مضمون الوجود).
//
// Run: node functions/test/compareDeployedSourceToCommit.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {blobId, walkFiles, treeOfFunctionsDir} = require('../scripts/compare-deployed-source-to-commit');

const REPO_ROOT = path.join(__dirname, '..', '..');

// ═══════════════════════════════════════════════════════════════════════
// ١ — blobId يطابق معرِّف git الحقيقي (git rev-parse HEAD:<path>) على ملفّ
//     مُلتزَم فعلاً — إثبات مباشر، لا افتراض عن خوارزمية git.
// ═══════════════════════════════════════════════════════════════════════
{
  const relPath = 'functions/package.json';
  const gitContent = execFileSync('git', ['show', `HEAD:${relPath}`], {cwd: REPO_ROOT});
  const expectedBlobId = execFileSync('git', ['rev-parse', `HEAD:${relPath}`], {cwd: REPO_ROOT, encoding: 'utf8'}).trim();

  eq(blobId(gitContent), expectedBlobId, '[١] blobId(محتوى git الحقيقي) = معرِّف git blob الفعلي (git rev-parse)');

  // ═══════════════════════════════════════════════════════════════════
  // ٢ — إثبات العطب الأصلي والإصلاح معاً: الملفّ في شجرة العمل الحالية
  //     يحمل CRLF فعلاً (بيئة ويندوز هذه الجلسة)، ومع ذلك blobId (بعد
  //     التطبيع) يُعيد **نفس** المعرِّف الصحيح — لا يظهر "مختلفاً" كما
  //     كانت النسخة القديمة (SHA-256 خام بلا تطبيع) ستفعل.
  // ═══════════════════════════════════════════════════════════════════
  // Public release: the original author's checkout was Windows with core.autocrlf=true, so the file really had CRLF. An LF checkout (Linux, macOS, autocrlf=false) has none,
  // so a CRLF copy is derived byte-for-byte from it (latin1 round trip); on a real CRLF checkout the real bytes are used unchanged.
  const workingTreeRaw = fs.readFileSync(path.join(REPO_ROOT, relPath));
  const workingTreeBuf = workingTreeRaw.includes(0x0d) ? workingTreeRaw : Buffer.from(workingTreeRaw.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
  const hasCRLF = workingTreeBuf.includes(0x0d); // \r
  ok(hasCRLF, '[إعداد٢] الملفّ في شجرة العمل الحالية يحمل CRLF فعلاً (لا نظري) — بيئة هذه الجلسة');
  eq(blobId(workingTreeBuf), expectedBlobId,
      '[٢][الإصلاح] blobId(نسخة شجرة العمل بـCRLF) = نفس معرِّف git الصحيح — العطب القديم كان سيُنتج SHA-256 مختلفاً هنا');

  // العطب القديم، للمقارنة فقط (لا يُستعمَل في الإصلاح، توثيق الفرق):
  // SHA-256 خام بلا تطبيع كان سيختلف بين النسختين — يُثبت أن التطبيع هو
  // ما يحلّ المشكلة فعلاً، لا مصادفة.
  const crypto = require('crypto');
  const rawSha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
  ok(rawSha256(workingTreeBuf) !== rawSha256(gitContent),
      '[٣][توثيق العطب القديم] SHA-256 الخام (بلا تطبيع) يختلف فعلاً بين نسخة CRLF ونسخة git LF — هذا ما كان يُنتج "مختلفاً" زوراً');
}
console.log('تحقّق ١-٣: blobId يطابق git الحقيقي، ويصمد أمام CRLF التي كانت تُسقط المقارنة القديمة');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — treeOfFunctionsDir يبني خريطة صحيحة عبر git ls-tree (لا git show
//     لكل ملفّ) — نفس معرِّف blobId لملفّ معروف.
// ═══════════════════════════════════════════════════════════════════════
{
  const tree = treeOfFunctionsDir(REPO_ROOT, 'HEAD');
  ok(tree.has('package.json'), '[٤] treeOfFunctionsDir يحمل functions/package.json (بادئة functions/ مُزالة)');
  const expected = execFileSync('git', ['rev-parse', 'HEAD:functions/package.json'], {cwd: REPO_ROOT, encoding: 'utf8'}).trim();
  eq(tree.get('package.json'), expected, '[٤] معرِّف blob من ls-tree يطابق git rev-parse لنفس الملفّ');
  ok(!Array.from(tree.keys()).some((k) => k.startsWith('node_modules/')), '[٤] node_modules مُستبعَدة من الشجرة');
}
console.log('تحقّق ٤: treeOfFunctionsDir يطابق git rev-parse ملفّاً بملفّ، ويستبعد node_modules');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — تطبيع CRLF محصور بالملفّات النصّية (بلا NUL) — ملفّ ثنائي (يحمل NUL)
//     يُحسَب كما هو بلا أي تطبيع، حتى لو حمل تتابع 0x0D 0x0A بمعنى مختلف.
// ═══════════════════════════════════════════════════════════════════════
{
  const textCRLF = Buffer.from('line1\r\nline2\r\n', 'latin1');
  const textLF = Buffer.from('line1\nline2\n', 'latin1');
  eq(blobId(textCRLF), blobId(textLF), '[٥] نصّ CRLF ونصّ LF المكافئ يُنتجان نفس blobId (تطبيع فعلي)');

  const binaryWithCRLFBytes = Buffer.concat([Buffer.from([0x00]), Buffer.from('a\r\nb', 'latin1')]);
  const binaryLFVariant = Buffer.concat([Buffer.from([0x00]), Buffer.from('a\nb', 'latin1')]);
  ok(blobId(binaryWithCRLFBytes) !== blobId(binaryLFVariant),
      '[٥] ملفّ ثنائي (يحمل NUL) لا يُطبَّع — 0x0D0x0A تبقى بايتات حرفية، فالنسختان تُنتجان blobId مختلفاً (بخلاف النصّي)');
}
console.log('تحقّق ٥: التطبيع نصّي فقط (بلا NUL) — الثنائي يُحسَب حرفياً بلا تعديل');

console.log(`\ncompareDeployedSourceToCommit.test.js: ${n}/${n} assertions passed`);
