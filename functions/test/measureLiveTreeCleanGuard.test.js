'use strict';

// measureLiveTreeCleanGuard.test.js — أمر مستخدم 2026-10-01 +03 ("ثلاثة
// بنود"، البند ١): "حارس جديد: يرفض التشغيل الحقيقي (غير --dry-run) إن
// كانت الشجرة غير نظيفة في الملفّات التي يحمّلها مسار resolveV7Report.
// وما يعدّه «نظيفة» تحدّده بالأداة، لا بقائمة يدوية إن أمكن."
//
// يختبر checkTreeCleanForResolveV7Report() **الحقيقية بلا استبدال**
// (القاعدة 37) — نداء git status --porcelain فعلي (قراءة فقط، لا كتابة،
// لا شبكة) على رسم تبعية resolveV7Report.js الحقيقي (deps() من
// scripts/deploy-list.js، مُعاد استعمالها حرفياً — القاعدة 24).
//
// ⚠️ **ملاحظة زمنية صريحة**: هذا الملفّ يختبر على **حالة الشجرة الحقيقية
// وقت التشغيل**. كانت غير نظيفة فعلاً (S1-S5 بلا التزام) حين كُتب هذا
// الملفّ أوّل مرّة — التحقّق ١ أثبت ذلك تحديداً، ووُسم صراحة بأنه "سيحتاج
// مراجعة (لا حذفاً) بعد التزام S1-S5 لاحقاً، حين تصير الشجرة نظيفة في هذا
// الرسم". **هذه هي تلك المراجعة** (أمر مستخدم 2026-10-01 +03، بعد
// الالتزامين a92d503/f616967): الشجرة نظيفة الآن في رسم resolveV7Report.js
// فعلاً (مُتحقَّق بتشغيل مباشر) — التحقّق ١ يُثبت ذلك عكس ما كان يُثبته.
// **أثر جانبي صادق يُذكر لا يُخفى**: التحقّقان ٢ و٣ كانا يعتمدان على وجود
// ملفّ غير نظيف واحد على الأقلّ ليُثبتا شيئاً ملموساً (٢: كل ملفّ غير نظيف
// داخل الرسم؛ ٣: هذا السكربت نفسه غير نظيف لكنه مُستبعَد) — الآن
// dirtyFiles=[] فيهما يجعل حلقة ٢ تُنفَّذ صفر مرّة (لا تأكيد يُسجَّل) و٣
// صحيحاً لكن خاوي الدليل (vacuously true — لا ملفّ دائر ليُثبَت استبعاده
// فعلاً). لم أُصطنِع حالة قذارة مزيَّفة لإعادة إحياء الدليل الملموس — ذلك
// خارج نطاق إصلاح اختبار واحد فشل، ويحتاج قراراً منفصلاً إن أُريد.
//
// Run: node functions/test/measureLiveTreeCleanGuard.test.js

const assert = require('assert');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const adminPath = require.resolve('../src/utils/admin');
require.cache[adminPath] = {
  id: adminPath, filename: adminPath, loaded: true,
  exports: {
    admin: {},
    db: {collection: () => { throw new Error('TRAP: Firestore must not be touched by this test'); }},
    ADMIN_EMAILS: [], requireAdmin: () => {},
  },
};

if (!process.argv.includes('--simulate')) process.argv.push('--simulate');
const {checkTreeCleanForResolveV7Report} = require('../scripts/measure-resolveV7Report-live');
const {deps} = require('../scripts/deploy-list');

const RESOLVE_V7_REPORT_ENTRY = path.join(__dirname, '..', 'src', 'analysis', 'resolveV7Report.js');
const SELF_SCRIPT = path.join(__dirname, '..', 'scripts', 'measure-resolveV7Report-live.js');

// ═══════════════════════════════════════════════════════════════════════
// ١ — حالة الشجرة الحقيقية اليوم (بعد a92d503/f616967): S1-S5 مُلتزَمة —
//     فالحارس **يجب** أن يقبل اليوم تحديداً (استُبدل هذا الاختبار، القاعدة
//     23 — كان يُثبت الرفض على شجرة غير ملتزَمة، تلك الحالة لم تعد قائمة).
// ═══════════════════════════════════════════════════════════════════════
{
  const result = checkTreeCleanForResolveV7Report();
  ok(result.graphSize > 0, '[١][إعداد] رسم تبعية resolveV7Report.js غير فارغ فعلياً');
  ok(result.clean === true,
      `[١][حالة اليوم، بعد التزام S1-S5] الحارس يقبل فعلياً — dirtyFiles: ${JSON.stringify(result.dirtyFiles)}`);
  ok(result.dirtyFiles.length === 0, '[١] قائمة الملفّات غير النظيفة فارغة فعلياً بعد الالتزام');
}
console.log('تحقّق ١: الحارس يقبل فعلياً على حالة الشجرة الحقيقية اليوم (بعد التزام S1-S5)');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — بنيوي: كل ملفّ في dirtyFiles هو فعلاً جزء من رسم التبعية (لا ملفّ
//     من خارج الرسم يُبلَّغ خطأً) — ثابت بصرف النظر عن حالة الشجرة.
// ═══════════════════════════════════════════════════════════════════════
{
  const result = checkTreeCleanForResolveV7Report();
  const graph = [...deps(RESOLVE_V7_REPORT_ENTRY)];
  const graphRelative = new Set(graph.map((p) => path.relative(path.join(__dirname, '..', '..'), p).replace(/\\/g, '/')));
  for (const f of result.dirtyFiles) {
    ok(graphRelative.has(f), `[٢][بنيوي] "${f}" المُبلَّغ كغير نظيف هو فعلاً داخل رسم تبعية resolveV7Report.js`);
  }
}
console.log('تحقّق ٢: كل ملفّ مُبلَّغ كغير نظيف هو فعلاً جزء من رسم التبعية — لا تسرّب من خارج الرسم');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — الاستبعاد الصحيح: هذا السكربت نفسه (measure-resolveV7Report-live.js)
//     **لا يستورده resolveV7Report.js** — فلا يجوز أن يظهر في dirtyFiles
//     مهما كانت حالته. لولا هذا الاستبعاد لكان أي تعديل على هذا السكربت
//     نفسه يمنع تشغيله — عطب دائري.
//     ⚠️ **تصحيح 2026-10-01 +03 (بعد التزام S1-S5)**: كان هذا التحقّق يستشهد
//     بأن الملفّ "غير نظيف فعلياً الآن" كمثال ملموس على الاستبعاد — الشجرة
//     نظيفة بالكامل الآن (بما فيه هذا الملفّ)، فالاستشهاد لم يعد صحيحاً
//     واقعياً. التأكيد نفسه يبقى صحيحاً منطقياً (سالبة عن مجموعة فارغة)
//     لكنه الآن بلا دليل ملموس — لم أُصطنِع قذارة مزيَّفة لإحيائه (خارج نطاق
//     إصلاح اختبار فشل، يحتاج قراراً منفصلاً إن أُريد دليل ملموس مجدَّداً).
// ═══════════════════════════════════════════════════════════════════════
{
  const result = checkTreeCleanForResolveV7Report();
  const selfRelative = path.relative(path.join(__dirname, '..', '..'), SELF_SCRIPT).replace(/\\/g, '/');
  ok(!result.dirtyFiles.includes(selfRelative),
      `[٣][استبعاد صحيح، بلا دليل ملموس بعد الالتزام] "${selfRelative}" لا يظهر في dirtyFiles — ليس داخل رسم تبعية resolveV7Report.js`);
}
console.log('تحقّق ٣: measure-resolveV7Report-live.js نفسه مُستبعَد بصحّة من رسم resolveV7Report.js (الآن بلا دليل ملموس — الشجرة نظيفة بالكامل)');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — رسم deps() المُعاد استعماله من deploy-list.js يحمل resolveV7Report.js
//     نفسها وتبعيّات معروفة حقيقية (callAI.js، categoryStates.js) — سلامة
//     الاستعمال (القاعدة 24) لا نسخة منطق موازية هنا.
// ═══════════════════════════════════════════════════════════════════════
{
  const graph = [...deps(RESOLVE_V7_REPORT_ENTRY)];
  const names = graph.map((p) => path.basename(p));
  ok(names.includes('resolveV7Report.js'), '[٤] الرسم يحمل resolveV7Report.js نفسها (نقطة البداية)');
  ok(names.includes('callAI.js'), '[٤] الرسم يحمل callAI.js (تبعية حقيقية معروفة)');
  ok(names.includes('categoryStates.js'), '[٤] الرسم يحمل categoryStates.js (تبعية حقيقية معروفة عبر findings/buildV7Payload)');
}
console.log('تحقّق ٤: deps() المُعاد استعماله من deploy-list.js يحسب رسماً صحيحاً فعلياً لـresolveV7Report.js');

console.log(`\nmeasureLiveTreeCleanGuard.test.js: ${n}/${n} assertions passed`);
