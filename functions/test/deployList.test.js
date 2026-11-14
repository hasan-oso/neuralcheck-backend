'use strict';

// deployList.test.js — تتبّع نقاط الدخول في أداة اشتقاق النشر.
//
// الأداة تشتقّ الدوالّ الواجب نشرها من رسم require الفعلي، وهي الحاجز
// الوحيد بيننا وبين نشر ناقص. عطبها لا يُنتج خطأً بل قائمةً أقصر — وهو
// أسوأ أنواع العطب: يمرّ بصمت ويترك دالّة معدَّلة بلا نشر.
//
// ما كسرها: تعبير نمطي يلتقط اسماً واحداً بين قوسي التفكيك. فلمّا كُتب
//   const {getAiConfig, setAiModel} = require("./src/admin/aiModelConfig");
// لم يطابق شيئاً، وخرجت الدالّتان بلا نقطة دخول.
//
// الأداة **أعلنت** العجز بـ⚠ ولم تبتلعه، وذلك ما أمسك الخطأ. القسم 3 هنا
// يحرس ذلك الإعلان: توسيع التعبير بلا إبقاء التحذير يستبدل عطباً صامتاً
// بآخر.
//
// Run: node functions/test/deployList.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts', 'deploy-list.js');
const src = fs.readFileSync(TOOL, 'utf8');

// ─── 1. التحليل على كل صيغة استيراد ─────────────────────────────────
{
  // نستخرج التعبير من المصدر لا نكتبه هنا: اختبار يحمل نسخته الخاصّة
  // يمرّ بينما الأداة مكسورة.
  const re = new RegExp(
      /const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/.source,
      'g');
  assert.ok(src.includes(re.source.replace(/\\\\/g, '\\')) ||
      src.includes('\\{([^}]+)\\}') || src.includes('{([^}]+)}'),
  'the tool must use the widened brace capture');

  /** يحاكي منطق الأداة. @param {string} idx نصّ index @return {Object} */
  function parse(idx) {
    const out = {};
    for (const m of idx.matchAll(re)) {
      const modulePath = m[2];
      for (const part of m[1].split(',')) {
        const local = part.includes(':') ?
            part.slice(part.indexOf(':') + 1) : part;
        const name = local.trim();
        if (/^\w+$/.test(name)) out[name] = modulePath;
      }
    }
    return out;
  }

  // اسم واحد — النمط الذي كان يعمل.
  assert.deepStrictEqual(
      parse('const {runConsistencyTest} = require("./src/admin/rct");'),
      {runConsistencyTest: './src/admin/rct'});

  // اسمان — النمط الذي كسرها.
  assert.deepStrictEqual(
      parse('const {getAiConfig, setAiModel} = require("./src/admin/ai");'),
      {getAiConfig: './src/admin/ai', setAiModel: './src/admin/ai'},
      'two names from one module is the case that broke the tool');

  // ثلاثة وأكثر، وبفراغات غير منتظمة.
  assert.deepStrictEqual(
      parse('const {  a ,b,   c } = require("./m");'),
      {a: './m', b: './m', c: './m'});

  // على عدّة أسطر — [^}] يشمل السطر الجديد.
  assert.deepStrictEqual(
      parse('const {\n  a,\n  b,\n} = require("./m");'),
      {a: './m', b: './m'},
      'a multi-line destructure must resolve too');

  // إعادة تسمية: الاسم المحلّي هو ما يُسنَد إلى exports.
  assert.deepStrictEqual(
      parse('const {orig: local} = require("./m");'),
      {local: './m'},
      'an alias must key on the local binding, not the source name');

  // ما يجب ألّا يُلتقط: وحدات خارجية (بلا "./").
  assert.deepStrictEqual(
      parse('const {onCall} = require("firebase-functions/v2/https");'), {},
      'external modules are not entry points');
}

// ─── 2. على index.js الحقيقي: كل دالّة مُصدَّرة لها نقطة دخول ────────
{
  const idx = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
  const re = /const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g;
  const entryOf = {};
  for (const m of idx.matchAll(re)) {
    for (const part of m[1].split(',')) {
      const local = part.includes(':') ?
          part.slice(part.indexOf(':') + 1) : part;
      const name = local.trim();
      if (/^\w+$/.test(name)) entryOf[name] = m[2];
    }
  }
  const exported = [...idx.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]);

  assert.ok(exported.length > 0, 'index.js must export functions');
  const orphans = exported.filter((fn) => !entryOf[fn]);
  assert.deepStrictEqual(orphans, [],
      'every exported function must resolve to a source file — ' +
      'an unresolved one silently drops out of the deploy list');

  // الحالة التي كسرتها، مثبَّتة بالاسم.
  for (const fn of ['getAiConfig', 'setAiModel']) {
    assert.ok(entryOf[fn], `${fn} must resolve`);
  }
  assert.strictEqual(entryOf.getAiConfig, entryOf.setAiModel,
      'both came from the same require and must map to the same module');
}

// ─── 3. التحذير باقٍ ────────────────────────────────────────────────
// توسيع التعبير يعالج هذه الحالة. الحارس هو ما يمسك التالية.
{
  assert.ok(/untracked\s*\+\+/.test(src),
      'the tool must still count what it cannot trace');
  assert.ok(src.includes('تعذّر تتبّع نقطة الدخول'),
      'and still print a per-function warning');
  assert.ok(/لا تعتمد القائمة/.test(src),
      'and still tell the reader not to trust an incomplete list');
}

// ─── 4. تشغيل حقيقي: لا ⚠ على التغيير الحالي ────────────────────────
{
  const out = execFileSync(process.execPath,
      [TOOL, 'src/reports/verifyReport.js'],
      {cwd: ROOT, encoding: 'utf8'});

  assert.ok(!out.includes('⚠'),
      'the tool must now run clean on the real index.js:\n' + out);
  assert.ok(/verifyReport\s+✅/.test(out),
      'the changed file must map to its function');
  assert.ok(/analyzeDevice\s+—/.test(out),
      'an untouched function must not be listed for deploy');
}

console.log('deployList: 4/4 sections passed');
