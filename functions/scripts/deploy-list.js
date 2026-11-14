// يشتقّ قائمة الدوال الواجب نشرها من رسم التبعيات الفعلي.
// يُشغَّل من داخل functions/ ويأخذ الملفات المتغيّرة كوسائط.
const fs = require("fs");
const path = require("path");

// يحلّ مساراً إلى ملف موجود: كما هو، أو بإضافة .js، أو index.js لمجلّد.
function resolveFile(p) {
  const abs = path.resolve(p);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  if (fs.existsSync(abs + ".js")) return abs + ".js";
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const idx = path.join(abs, "index.js");
    if (fs.existsSync(idx)) return idx;
  }
  return null;
}

// كل ما يستدعيه ملف، متعدّياً.
function deps(entry, seen = new Set()) {
  const abs = resolveFile(entry);
  if (!abs || seen.has(abs)) return seen;
  seen.add(abs);
  const src = fs.readFileSync(abs, "utf8");
  for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    deps(path.join(path.dirname(abs), m[1]), seen);
  }
  return seen;
}

// تصحيح المنسّق 2026-10-01 +03 (أمر مستخدم، البند ١ من "ثلاثة بنود") —
// حارس الشجرة النظيفة الجديد في measure-resolveV7Report-live.js يحتاج
// deps()/resolveFile() مباشرة (رسم تبعية resolveV7Report.js الحقيقي) —
// القاعدة 24: إعادة استعمال نفس دالّة الرسم هنا حرفياً، لا نسخة موازية.
// حارس require.main يحصر منطق CLI (قراءة process.argv/index.js وطباعة
// الجدول) في التشغيل المباشر وحده — لا تغيير سلوكي على
// `node scripts/deploy-list.js <ملفّات>` إطلاقاً، فقط يُضيف قابلية
// الاستيراد الآمنة التي لم تكن موجودة قبل هذا التصحيح (لم يكن أحد يستورد
// هذا الملفّ كوحدة من قبل).
if (require.main === module) {
  const changed = process.argv.slice(2)
      .map((f) => resolveFile(f.replace(/^functions\//, "")))
      .filter(Boolean);

  if (!changed.length) {
    console.error("لا ملفات متغيّرة صالحة — توقّف.");
    process.exit(1);
  }

  const idx = fs.readFileSync("index.js", "utf8");
  const entryOf = {};

  // يقبل تفكيك عدّة أسماء من وحدة واحدة:
  //   const {a} = require("./x")
  //   const {a, b} = require("./x")
  //   const {a: b} = require("./x")
  // وعلى عدّة أسطر أيضاً — [^}] يشمل السطر الجديد.
  //
  // التعبير السابق كان يلتقط اسماً واحداً فقط بين القوسين، فاستيراد
  // `const {getAiConfig, setAiModel} = require(...)` لم يطابق شيئاً وخرجت
  // الدالّتان بلا نقطة دخول. الأداة رفعت ⚠ ولم تصمت — وهذا ما يجب أن يبقى:
  // العجز عن التتبّع يُعلَن ولا يُبتلع.
  //
  // المفتاح هو الاسم المحلّي: عند {a: b} فـ b هو ما يُسنَد إلى exports،
  // وعليه يبحث الجزء أدناه.
  for (const m of idx.matchAll(
      /const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    const modulePath = m[2];
    for (const part of m[1].split(",")) {
      const local = part.includes(":") ? part.slice(part.indexOf(":") + 1) : part;
      const name = local.trim();
      if (/^\w+$/.test(name)) entryOf[name] = modulePath;
    }
  }
  const exported = [...idx.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]);

  const rel = (p) => path.relative(process.cwd(), p).replace(/\\/g, "/");
  console.log("الملفات المتغيّرة:");
  changed.forEach((c) => console.log("  " + rel(c)));
  console.log("");
  console.log("الدالة".padEnd(28) + "نشر؟  السبب");
  console.log("─".repeat(88));

  const toDeploy = [];
  let untracked = 0;
  for (const fn of exported) {
    const entry = entryOf[fn];
    if (!entry) {
      untracked++;
      console.log(fn.padEnd(28) + "⚠ تعذّر تتبّع نقطة الدخول من index.js");
      continue;
    }
    const graph = deps(entry);
    if (!graph.size) {
      untracked++;
      console.log(fn.padEnd(28) + "⚠ رسم فارغ — لم يُحلّ " + entry);
      continue;
    }
    const hits = changed.filter((c) => graph.has(c));
    if (hits.length) toDeploy.push(fn);
    console.log(fn.padEnd(28) +
        (hits.length ? "✅    " : "—     ") +
        (hits.length ? hits.map(rel).join(", ") : `${graph.size} ملفاً، لا تقاطع`));
  }

  console.log("\n" + "═".repeat(88));
  if (untracked) {
    console.log(`⚠ ${untracked} دالة لم تُتتبَّع — لا تعتمد القائمة قبل حلّها.`);
  }
  console.log(`يجب نشرها (${toDeploy.length}/${exported.length}): ${toDeploy.join(", ")}`);
  console.log("\nالأمر:\nfirebase deploy --only " +
      toDeploy.map((f) => "functions:" + f).join(",") +
      " --project neuralchek-9b6d7");
}

module.exports = {deps, resolveFile};
