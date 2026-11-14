"use strict";

// ===================================================
// emulatorGuardInventory — جرد بالأداة لملفّات الاختبار التي تستعمل عميل Firestore حقيقياً وتكتب أو تحذف (V8 قبل النشر، 2026-10-09 +03)
// ===================================================
//
// قرار المستخدم (بنصّه): «لا يعمل أيّ اختبار يحذف إلا إذا كان FIRESTORE_EMULATOR_HOST مضبوطاً، والمشروع مشروع اختبار لا neuralchek-9b6d7،
// وإلا يتوقّف قبل أيّ نداء.» والقاعدة الدنيا بنصّه «يحذف». واقتراح المنسّق: الحارس على كل ملفّ يكتب في Firestore حقيقي.
// فالأداة تُخرج القائمتين: DELETERS (يحذف) وWRITERS (يكتب أو يحذف، وتشمل الأولى). والحارس يُطبَّق على WRITERS.
//
// مصدر واحد للتصنيف (القاعدة 24): هذا الملفّ يستعمله emulatorGuardCoverage.test.js (البنيوي) وemulatorOnlyGuard.test.js (السلوكي)،
// ويُشغَّل مباشرةً لطباعة الجرد:   node functions/test/lib/emulatorGuardInventory.js
//
// الملفّات المفحوصة: functions/test/*.js (المستوى الأوّل فقط) وrules-test/*.js — من القرص لا من git، فملفّ جديد لم يُلتزم بعد يُفحص أيضاً.
// التصنيف ساكن (نصّ الملفّ بلا تعليقاتٍ):
//   touchesFirestore = اسمه *.e2e.test.js (عُرف المستودع: كل e2e يكتب)  أو  (يستورد عميلاً حقيقياً ∧ يستعمله فعلاً على Firestore).
//     «يستورد عميلاً»: ../src/utils/admin (مباشرةً أو بـpath.join) · firebase-admin · @google-cloud/firestore · @firebase/rules-unit-testing · firebase/firestore.
//     «يستعمله فعلاً»: db.collection(/doc(/batch(/runTransaction(... · .firestore() · getFirestore( · new Firestore( · استيراد firebase/firestore ·
//       إعداد firestore: {...} لـinitializeTestEnvironment. — فاستيراد Timestamp وحده (reportRawMigration.test.js) ليس اتصالاً.
//   writes  = .set( .update( .create( .add( batch( runTransaction( bulkWriter( setDoc( updateDoc( addDoc( writeBatch( withSecurityRulesDisabled( clearFirestore(
//   deletes = .delete( recursiveDelete( deleteDoc( FieldValue.delete( clearFirestore(
//   WRITERS = touchesFirestore ∧ (writes ∨ deletes ∨ e2e)    DELETERS = touchesFirestore ∧ deletes
//   STORAGE_ONLY = يستعمل firebase/storage بلا Firestore (rules-test/storage.rules.test.js): خارج الحارس لأنه لا يستعمل FIRESTORE_EMULATOR_HOST.
// حدّ التصنيف: لا يرى ما يمرّ عبر متغيّر غير مسمّى، ولا ملفّاً في مجلّد فرعي من functions/test.

const fs = require("fs");
const path = require("path");
const {builtinModules} = require("module");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const SCAN_DIRS = Object.freeze(["functions/test", "rules-test"]);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:'"`])\/\/ .*$/gm, "$1");

const CLIENT_IMPORTS = Object.freeze([
  ["src/utils/admin", /require\(\s*(?:["'](?:\.\.\/)+src\/utils\/admin["']|path\.join\([^)]*["']admin["'][^)]*\))\s*\)/],
  ["firebase-admin", /require\(\s*["']firebase-admin(?:\/[a-z-]+)?["']\s*\)/],
  ["@google-cloud/firestore", /require\(\s*["']@google-cloud\/firestore["']\s*\)/],
  ["@firebase/rules-unit-testing", /require\(\s*["']@firebase\/rules-unit-testing["']\s*\)/],
  ["firebase/firestore", /require\(\s*["']firebase\/firestore["']\s*\)/],
]);
const USES_FIRESTORE = /\bdb\.(?:collection|doc|batch|runTransaction|getAll|recursiveDelete|bulkWriter|listCollections|collectionGroup)\(|\.firestore\(\)|\bgetFirestore\(|\bnew Firestore\(|require\(\s*["']firebase\/firestore["']\s*\)|\bfirestore\s*:\s*\{/;
const USES_STORAGE = /require\(\s*["']firebase\/storage["']\s*\)|\bstorage\s*:\s*\{/;
const WRITES = /\.(?:set|update|create|add)\(|\bbatch\(|\.runTransaction\(|\.bulkWriter\(|\bsetDoc\(|\bupdateDoc\(|\baddDoc\(|\bwriteBatch\(|\.withSecurityRulesDisabled\(|\.clearFirestore\(/;
const DELETES = /\.delete\(|\.recursiveDelete\(|\bdeleteDoc\(|FieldValue\.delete\(|\.clearFirestore\(/;
const GUARD_REQUIRE = /require\(\s*["'](?:\.\/lib|(?:\.\.\/)+functions\/test\/lib)\/emulatorOnlyGuard["']\s*\)/;
const ANY_REQUIRE = /require\(\s*(?:["']([^"']+)["']|(path\.join\([^)]*\)))\s*\)/g;

/**
 * @param {string} name اسم الملفّ (للتمييز e2e)
 * @param {string} rawSource نصّ الملفّ
 * @return {{e2e: boolean, clients: string[], touchesFirestore: boolean, storageOnly: boolean, writes: boolean, deletes: boolean, writer: boolean, deleter: boolean}}
 */
function classify(name, rawSource) {
  const src = stripComments(rawSource.replace(/\r\n/g, "\n"));
  const e2e = /\.e2e\.test\.js$/.test(name);
  const clients = CLIENT_IMPORTS.filter(([, re]) => re.test(src)).map(([n]) => n);
  const usesFirestore = USES_FIRESTORE.test(src);
  const touchesFirestore = e2e || (clients.length > 0 && usesFirestore);
  const writes = WRITES.test(src);
  const deletes = DELETES.test(src);
  const storageOnly = !touchesFirestore && clients.length > 0 && USES_STORAGE.test(src);
  return {
    e2e, clients, touchesFirestore, storageOnly, writes, deletes,
    writer: touchesFirestore && (writes || deletes || e2e),
    deleter: touchesFirestore && deletes,
  };
}

/**
 * هل الحارس أوّل require غير مدمج في Node؟ (وبذلك يسبق firebase-admin وكل وحدة من src وكل require يُحمّل عميلاً.)
 * @param {string} rawSource
 * @return {{imported: boolean, first: boolean, firstOffender: ?string}}
 */
function guardImportedFirst(rawSource) {
  const src = stripComments(rawSource.replace(/\r\n/g, "\n"));
  const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
  const guard = GUARD_REQUIRE.exec(src);
  if (!guard) return {imported: false, first: false, firstOffender: null};
  for (const m of src.matchAll(ANY_REQUIRE)) {
    if (m.index >= guard.index) return {imported: true, first: true, firstOffender: null};
    const target = m[1] !== undefined ? m[1] : m[2];
    if (m[1] !== undefined && builtins.has(target)) continue; // fs/path/assert/child_process... قبل الحارس لا تُحمّل عميلاً
    return {imported: true, first: false, firstOffender: target};
  }
  return {imported: true, first: true, firstOffender: null};
}

/**
 * @param {string} [repoRoot]
 * @return {{rows: Array<Object>, writers: string[], deleters: string[], storageOnly: string[], scanned: number}}
 */
function inventory(repoRoot = REPO_ROOT) {
  const rows = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const e of fs.readdirSync(abs, {withFileTypes: true})) {
      if (!e.isFile() || !e.name.endsWith(".js")) continue;
      const rel = `${dir}/${e.name}`;
      const src = fs.readFileSync(path.join(abs, e.name), "utf8");
      rows.push({file: rel, ...classify(e.name, src), guard: guardImportedFirst(src)});
    }
  }
  rows.sort((a, b) => a.file.localeCompare(b.file));
  return {
    rows,
    scanned: rows.length,
    writers: rows.filter((r) => r.writer).map((r) => r.file),
    deleters: rows.filter((r) => r.deleter).map((r) => r.file),
    storageOnly: rows.filter((r) => r.storageOnly).map((r) => r.file),
  };
}

module.exports = {REPO_ROOT, SCAN_DIRS, classify, guardImportedFirst, inventory, stripComments};

if (require.main === module) {
  const inv = inventory();
  const flag = (r) => (r.guard.imported ? (r.guard.first ? "guard-first" : `guard-LATE(after ${r.guard.firstOffender})`) : "NO-GUARD");
  console.log(`test files scanned: ${inv.scanned} (${SCAN_DIRS.join(", ")})`);
  console.log(`DELETERS (touch Firestore + delete): ${inv.deleters.length}`);
  for (const f of inv.deleters) console.log(`  ${f}`);
  console.log(`WRITERS (touch Firestore + write or delete; includes DELETERS): ${inv.writers.length}`);
  for (const r of inv.rows.filter((x) => x.writer)) console.log(`  ${r.file}  [${r.deleter ? "delete" : "write"}]  ${flag(r)}`);
  console.log(`STORAGE-ONLY (Storage emulator, no Firestore): ${inv.storageOnly.length}`);
  for (const f of inv.storageOnly) console.log(`  ${f}`);
  const others = inv.rows.filter((r) => r.clients.length > 0 && !r.writer && !r.storageOnly);
  console.log(`import a client but do not use Firestore (not guarded): ${others.length}`);
  for (const r of others) console.log(`  ${r.file}  [${r.clients.join(", ")}]`);
  const unguarded = inv.rows.filter((r) => r.writer && !(r.guard.imported && r.guard.first));
  console.log(`writers WITHOUT the guard first: ${unguarded.length}`);
  for (const r of unguarded) console.log(`  ${r.file}  ${flag(r)}`);
}
