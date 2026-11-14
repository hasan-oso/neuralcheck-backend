#!/usr/bin/env node
'use strict';

// ===================================================================
// verify-storage-path-unmatched — أداة إثبات (لا فحص يدوي، القاعدة 16):
// هل مسار Storage جديد تطابقه أيّ قاعدة `match` مكتوبة في storage.rules؟
// القرار ٨٦ البند ٢: "المسار الجديد لا تطابقه قاعدة allow للعميل" —
// مطلوب إثباته بالأداة، لا بالقراءة وحدها. صفر شبكة، صفر Firebase SDK —
// يقرأ storage.rules كنصّ ويحاكي دلالة مطابقة المسار (Firebase Storage
// Rules v2) للأنماط البسيطة الموجودة فعلاً في هذا الملف: مقاطع حرفية أو
// `{param}` واحد لكل مقطع، بلا `{path=**}`. لا catch-all في storage.rules
// الحالي (rules_version='2' → أي مسار غير مُطابَق = رفض افتراضي)، فعدم
// المطابقة الهيكلية يكفي لإثبات "لا قاعدة allow تخصّه" بلا حاجة لمحاكي.
//
// ⚠️ هذه الأداة لا تُقيِّم شرط `allow` نفسه (request.auth إلخ) — فقط تحدّد
// أيّ قاعدة `match` (إن وُجدت) تُحاكم هذا المسار. إن لم تُطابِقه أي قاعدة،
// والملفّ بلا catch-all (تُتحقَّق صراحةً أدناه)، فالنتيجة القطعية: رفض
// افتراضي على كل عملية عميل لهذا المسار — بلا حاجة لمحاكي (القاعدة 4 في
// تعريف الوكيل: المحاكي ممنوع إلا بطلب صريح؛ هذه الأداة تُغني عنه هنا).
//
// Usage:
//   node scripts/verify-storage-path-unmatched.js <path> [rulesFile]
// ===================================================================

const fs = require('fs');
const path = require('path');

/**
 * يستخرج كل كتلة `match /.../ { ... }` من نصّ storage.rules — بما فيها
 * المتداخلة (مثل `match /b/{bucket}/o { match /shops/... {...} }`) —
 * بعدّ الأقواس يدوياً (لا اعتماد على تعبير نمطي عميق واحد؛ nested braces
 * تكسر أي regex بسيط).
 * @param {string} src نصّ storage.rules كاملاً
 * @return {Array<{pattern: string, hasAllow: boolean}>}
 */
function extractMatchBlocks(src) {
  const blocks = [];
  // نمط المسار: تعاقب مقاطع `/{name}` أو `/حرفي` (بلا مسافة ولا قوس) —
  // لا `[^\s{]*` الساذجة (كانت تتوقّف عند أوّل `{` حتى لو كان جزءاً من
  // مقطع ديناميكي مثل `{bucket}`، فتقصّ `/b/{bucket}/o` إلى `/b/` فقط).
  const re = /match\s+((?:\/(?:\{[^}]*\}|[^\s{/]+))+)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const pattern = m[1];
    // ابحث عن القوس الختامي المطابق بعدّ العمق، بدءاً من نهاية "match ... {"
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 1);
    // احسم موضع المسح التالي بنهاية هذه الكتلة كاملةً — لا الموضع الافتراضي
    // (بعد "{" الفاتح فقط) الذي يتركه .exec(). بدونه، المسح الخارجي يعيد
    // اكتشاف كتل match المتداخلة بنفسه (نسخة غير مركَّبة مع البادئة) —
    // فتُعَدّ مرّتين: مرّة صحيحة عبر إعادة العودية على body أدناه، ومرّة
    // زائفة كأنها top-level. لوحظ فعلياً بالتشغيل: 6 كتل بدل 3 (تحقّق:
    // كان عدد "الأوراق" المطبوع 6 قبل هذا السطر، 3 بعده — الأداة تسبق
    // الفحص اليدوي، القاعدة 16، وهذا مثال منها على نفسها).
    re.lastIndex = i;
    // كتلة "ورقة" فقط (بلا match متداخلة) هي ما نطابقها مباشرة كقاعدة —
    // الكتل الحاوية (مثل /b/{bucket}/o) مسار بادئة لا قاعدة allow قائمة
    // بذاتها هنا.
    const isLeaf = !/match\s+\//.test(body);
    // غلاف Storage القياسي `match /b/{bucket}/o { ... }` — يظهر حرفياً في
    // كل ملفّ storage.rules (توثيق Firebase الرسمي)، ويطابق مخطَّط عنونة
    // GCS الداخلي (bucket/object) — لا جزءاً من المسار الذي يستعمله العميل
    // فعلياً عبر الـ SDK (`ref('scans/x/y')` لا `ref('b/<bucket>/o/scans/x/y')`).
    // فمقاطعه لا تُدمَج مع أبنائه هنا — تُطابَق كأنها المستوى الجذري
    // مباشرةً، مطابقةً لكيف يُقيَّم storage.rules فعلياً على طلب عميل حقيقي.
    const isBucketWrapper = /^\/b\/\{[^}]+\}\/o$/.test(pattern);
    if (isLeaf) {
      blocks.push({pattern, hasAllow: /allow\s+/.test(body)});
    } else {
      blocks.push(...extractMatchBlocks(body).map((b) => ({
        // مسار الكتلة المتداخلة يُبنى بدمج البادئة (بمقاطعها الديناميكية
        // كما هي — لا نستبدلها بقيم فعلية، المطابقة الهيكلية هنا تكفي
        // لأن bucket نفسه ليس جزءاً من المسار الذي نتحقّق منه) — إلا حين
        // البادئة غلاف /b/{bucket}/o نفسه (أعلاه)، فتُترَك الأبناء بمساراتها
        // كما هي بلا دمج.
        pattern: isBucketWrapper ? b.pattern : joinPatterns(pattern, b.pattern),
        hasAllow: b.hasAllow,
      })));
    }
  }
  return blocks;
}

function joinPatterns(prefix, suffix) {
  return (prefix.replace(/\/$/, '')) + suffix;
}

/**
 * هل segments المسار الفعلي تطابق segments نمط `match` (مقاطع حرفية
 * متطابقة نصّاً، أو `{name}` ديناميكي يطابق أي مقطع واحد)؟ لا دعم لـ
 * `{name=**}` (غير مستعمَل في storage.rules هذا اليوم — لو ظهر مستقبلاً
 * فالأداة تفشل بوضوح بدل مطابقة خاطئة صامتة).
 * @param {string} candidatePath
 * @param {string} pattern
 * @return {boolean}
 */
function segmentsMatch(candidatePath, pattern) {
  const candSegs = candidatePath.split('/').filter(Boolean);
  const patSegs = pattern.split('/').filter(Boolean);
  if (patSegs.some((s) => s.includes('=**'))) {
    throw new Error(`verify-storage-path-unmatched: نمط يحمل '=**' غير مدعوم بهذه الأداة: ${pattern} — راجع الأداة يدوياً`);
  }
  if (candSegs.length !== patSegs.length) return false;
  return patSegs.every((p, i) => (p.startsWith('{') && p.endsWith('}')) || p === candSegs[i]);
}

function main() {
  const argv = process.argv.slice(2);
  const candidate = argv[0];
  if (!candidate) {
    console.error('Usage: node verify-storage-path-unmatched.js <path> [rulesFile]');
    process.exit(2);
  }
  const rulesFile = argv[1] || path.join(__dirname, '..', '..', 'storage.rules');
  const src = fs.readFileSync(rulesFile, 'utf8');

  // لا catch-all: أي `match /{...=**}` على مستوى الجذر (rules_version='2'
  // بلا هذا يعني رفضاً افتراضياً لكل مسار غير مُطابَق صراحة).
  const hasCatchAll = /match\s+\/\{[^}]*=\*\*\}/.test(src);

  const blocks = extractMatchBlocks(src);
  const matching = blocks.filter((b) => segmentsMatch(candidate, b.pattern));

  console.log(`الملفّ: ${rulesFile}`);
  console.log(`المسار المُختبَر: ${candidate}`);
  console.log(`عدد كتل match المُستخرَجة (أوراق فقط): ${blocks.length}`);
  for (const b of blocks) console.log(`  - ${b.pattern}${b.hasAllow ? '' : ' (بلا allow — تجاهل)'}`);
  console.log(`catch-all جذري (\`match /{path=**}\`): ${hasCatchAll ? 'موجود — تحذير' : 'غير موجود'}`);
  console.log(`قواعد match تطابق هذا المسار: ${matching.length}`);
  for (const b of matching) console.log(`  ⚠️ يطابق: ${b.pattern}`);

  if (matching.length === 0 && !hasCatchAll) {
    console.log('النتيجة: لا قاعدة allow تخصّ هذا المسار، ولا catch-all جذري — رفض افتراضي لكل عملية عميل (قراءة/كتابة) على هذا المسار.');
    process.exit(0);
  }
  console.log('النتيجة: توقّف — إمّا قاعدة مطابقة موجودة فعلاً، أو catch-all جذري يمنح وصولاً — راجع القواعد أعلاه يدوياً قبل الاعتماد على هذا المسار.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {extractMatchBlocks, segmentsMatch};
