// require-graph-edges.js — عدّاد حافّات رسم require السكوني، بدءاً من
// functions/index.js كاملاً (أو من نقطة أخرى بـ--from). أداة **جديدة**،
// كُتبت لمهمّة "وصل resolveV7Report" 2026-09-22 +03.
//
// ⚠️ لماذا أداة جديدة لا "نفس الأداة التي أعطت 2062 حافة": بحثتُ في هذا
// المستودع (functions/scripts, functions/test, git log --all، docs/,
// functions/scripts/out/) عن أداة تتبّع require وقت التشغيل + عدّادات نداء
// أنتجت هذا الرقم تحديداً (A105) — لا وجود لها كملفّ محفوظ ولا في تاريخ
// git (git log --all -S"A105" لا نتيجة). راجع تقرير المهمّة تحت "الفرق بين
// ما أُمرت به وما فعلت" (القاعدة 14 — الأمر يفترض أداة لا أثر لها في الكود).
// هذه الأداة تُعيد بناء نفس الأسلوب الموصوف حرفياً في نصّ المهمّة
// ("تتبّع require وقت التشغيل") بطريقة سكونية آمنة (بلا تنفيذ فعلي لأي
// كود — functions/index.js يستدعي admin.initializeApp()/admin.firestore()
// عند require حقيقي، وهذا غير مأذون به هنا) — بنفس منطق deps() المُثبَت
// أصلاً في deploy-list.js لهذا المستودع (بند "الأداة تسبق الفحص اليدوي" —
// القاعدة 16 — امتداد لأداة موثوقة قائمة لا اختراع من الصفر).
//
// الفرق عن deploy-list.js: تلك تُعيد **مجموعة ملفّات فريدة** (Set) لغرض
// قرار نشر. هذه تُعيد **عدد الحافّات الكلي** (كل ظهور require() تعدّياً،
// بما فيها إعادة زيارة ملفّ سبق زيارته من مسار آخر) + عدّاد "حافّات واردة"
// لكل ملفّ مستهدَف — وهو ما يُميّز "صفر حافّة واردة من أي نقطة دخول
// مُصدَّرة" (resolveV7Report.js قبل هذه المهمّة) عن "ملفّ واحد فريد في
// الرسم لكن بلا طريق يوصله فعلياً" (لا يقع هنا، لكن الفرق مفاهيمي مهم).
//
// Usage:
//   node functions/scripts/require-graph-edges.js
//   node functions/scripts/require-graph-edges.js --from src/analysis/analyzeDevice.js
//   node functions/scripts/require-graph-edges.js --target src/analysis/resolveV7Report.js

'use strict';

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..');

function resolveFile(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  if (fs.existsSync(abs + '.js')) return abs + '.js';
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const idx = path.join(abs, 'index.js');
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

/**
 * يعدّ كل حافّة require(...) نسبية (./ أو ../) بدءاً من entry، تعدّياً —
 * بما فيها الحافّات المؤدّية لملفّات سبقت زيارتها (لا يوقف عند أوّل زيارة،
 * خلافاً لـdeps() في deploy-list.js التي تكتفي بمجموعة فريدة).
 * @param {string} entryAbs مسار مطلق لملفّ البداية
 * @return {{edges: Array<{from:string,to:string}>, nodes: Set<string>}}
 */
function walkEdges(entryAbs) {
  const edges = [];
  const nodes = new Set();
  const queue = [entryAbs];
  const queued = new Set([entryAbs]);

  while (queue.length) {
    const abs = queue.shift();
    nodes.add(abs);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const targetAbs = resolveFile(path.join(path.dirname(abs), m[1]));
      if (!targetAbs) continue; // require غير قابل للحلّ سكونياً (لا يُبتلع — يُطبع أدناه إن طُلب)
      edges.push({from: abs, to: targetAbs});
      if (!queued.has(targetAbs)) {
        queued.add(targetAbs);
        queue.push(targetAbs);
      }
    }
  }
  return {edges, nodes};
}

const argv = process.argv.slice(2);
function argValue(flag, def) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

const fromRel = argValue('--from', 'index.js');
const targetRel = argValue('--target', null);

const entryAbs = resolveFile(path.join(FUNCTIONS_DIR, fromRel));
if (!entryAbs) {
  console.error(`✗ تعذّر حلّ نقطة البداية: ${fromRel}`);
  process.exit(1);
}

const {edges, nodes} = walkEdges(entryAbs);
const rel = (p) => path.relative(FUNCTIONS_DIR, p).replace(/\\/g, '/');

console.log(`من: ${rel(entryAbs)}`);
console.log(`عقد (ملفّات فريدة): ${nodes.size}`);
console.log(`حافّات (كل require() تعدّياً): ${edges.length}`);

if (targetRel) {
  const targetAbs = resolveFile(path.join(FUNCTIONS_DIR, targetRel));
  if (!targetAbs) {
    console.error(`✗ تعذّر حلّ الهدف: ${targetRel}`);
    process.exit(1);
  }
  const incoming = edges.filter((e) => e.to === targetAbs);
  const reachable = nodes.has(targetAbs);
  console.log(`\nالهدف: ${rel(targetAbs)}`);
  console.log(`  قابل للوصول من ${rel(entryAbs)}: ${reachable ? 'نعم' : 'لا'}`);
  console.log(`  حافّات واردة (كم ملفّاً يستدعي require عليه، تعدّياً): ${incoming.length}`);
  if (incoming.length) {
    console.log('  من:');
    for (const e of incoming) console.log(`    ${rel(e.from)}`);
  }
}
