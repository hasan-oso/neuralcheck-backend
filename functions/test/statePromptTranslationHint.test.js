'use strict';

// statePromptTranslationHint.test.js — أمر مستخدم 2026-09-23 +03 (توضيح
// الالتباس في البند ٥): "لا جدول ترجمة في الكود... النموذج يترجم بنفسه.
// البرومبت يسمّي قيم حالة الفئة... وينبّهه إلى أن يكتب معناها بالعربية.
// من مصدرها في الكود أعني قائمة القيم نفسها... والاختبار: «الحالة PARTIAL»
// الحقيقي... يبقى مرفوضاً في الحارس. فالتنبيه في البرومبت لا يغيّر الحارس."
//
// هذا الملف يثبت أمرين:
// ١) systemPromptV7.js يستورد CATEGORY_STATE_VALUES من categoryStates.js
//    (مصدر واحد، القاعدة 24) ويذكر كل قيمها في نصّ التنبيه — لا سرد يدوي.
// ٢) النصّ الحقيقي "الحالة PARTIAL" (b45c8cf6، 02-13-49، المحاولة ١) يبقى
//    مرفوضاً بالحارس تماماً كما رُفض وقت النداء الحقيقي — تنبيه البرومبت
//    توجيه للنموذج المستقبلي، لا تخفيف للحارس القائم.
//
// Run: node functions/test/statePromptTranslationHint.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {getSystemPromptV7} = require('../src/prompts/systemPromptV7');
const {CATEGORY_STATE_VALUES, computeCategoryStates} = require('../src/analysis/categoryStates');
const {guardV7Response} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozen(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')); }

// ═══════════════════════════════════════════════════════════════════════
// ١ — البرومبت يستورد القائمة من مصدرها (لا سرد يدوي) ويذكر قيمها الخمس.
// ═══════════════════════════════════════════════════════════════════════
{
  eq(CATEGORY_STATE_VALUES.length, 5, '[١] خمس قيم state فقط، كما وُجدت بالفحص المباشر لكل مواقع التعيين');
  for (const lang of ['ar', 'tr']) {
    const prompt = getSystemPromptV7(lang);
    for (const v of CATEGORY_STATE_VALUES) {
      ok(prompt.includes(v), `[١] البرومبت (${lang}) يذكر قيمة state "${v}" (مصدرها categoryStates.js، لا سرد يدوي)`);
    }
    // القرار ٩: بلا أي رقم عتبة في جملة التنبيه المُضافة تحديداً.
    // ⚠️ S5 (أمر مستخدم 2026-10-01 +03) — استُبدل قصّ بعرض ثابت (400 حرف)
    // بقصّ محدود بعلامة نهاية الجملة نفسها (القاعدة 23): القصّ الثابت كان
    // هشّاً بالفعل (لولا S5) — إعادة صياغة أي نصّ قبله يُزحزح ما يقع داخل
    // النافذة، فدخلت "vsyncLockFraction60" (رقم جزء اسم حقل لا عتبة، من
    // الفقرة **التالية** لجملة state) ضمن النافذة بعد أن قصُرت الفقرة التي
    // كانت تسبقها (إزالة استثناء أسماء البوّابات، S5) — رقم مصدره فقرة
    // أخرى تماماً، لا تنويه صادق في هذا الاختبار (نفس مبدأ القاعدة 26).
    const idx = prompt.indexOf('قيم `state` لكل فئة');
    ok(idx >= 0, `[١] جملة التنبيه حاضرة في البرومبت (${lang})`);
    const endMarker = 'القارئ مشترٍ لا مبرمج.';
    const endIdx = prompt.indexOf(endMarker, idx);
    ok(endIdx >= idx, `[١] نهاية جملة التنبيه ("${endMarker}") موجودة بعد بدايتها (${lang})`);
    const sentenceBlock = prompt.slice(idx, endIdx + endMarker.length);
    ok(!/\d/.test(sentenceBlock.replace(/state/g, '').replace(/A-D/g, '')),
        `[١] جملة التنبيه (${lang}) بلا أي رقم عتبة (القرار ٩) — ${JSON.stringify(sentenceBlock)}`);
  }
}
console.log('تحقّق ١: البرومبت يستورد CATEGORY_STATE_VALUES من categoryStates.js ويذكر قيمها الخمس، بلا رقم عتبة');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — S5 (أمر مستخدم 2026-10-01 +03، القاعدة 23 — استُبدل لا أُضيف): كان
// هذا يُثبت أن أسماء البوّابات (gate_name) مستثناة صراحة من فقرة تنبيه
// state. عُكس ذلك — البوّابات ممنوعة كلّياً من أي نثر بشري الآن. يكفي هنا
// إثبات أن فقرة تنبيه state نفسها لم تَعُد تحمل عبارة الاستثناء القديمة
// (اختبار القسم الجديد المخصَّص لمنع البوّابات في systemPromptV7.test.js).
// ═══════════════════════════════════════════════════════════════════════
{
  const prompt = getSystemPromptV7('ar');
  const idx = prompt.indexOf('قيم `state` لكل فئة');
  const block = prompt.slice(idx, idx + 500);
  ok(!block.includes('هذا لا\nيشمل أسماء البوّابات المسمّاة') && !/هذا لا\s+يشمل أسماء البوّابات/.test(block),
      `[٢][S5] فقرة تنبيه state لم تَعُد تستثني أسماء البوّابات — الاستثناء القديم أُزيل`);
}
console.log('تحقّق ٢: استثناء أسماء البوّابات من فقرة تنبيه state أُزيل (S5)');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — الاختبار الانحداري الحقيقي: "الحالة PARTIAL" من b45c8cf6، 02-13-49،
// المحاولة ١ — يبقى مرفوضاً بالحارس. جسم حقيقي كامل مُجمَّد، لا نصّ مُقتطَع
// اصطناعياً (تجنّباً لأي تحيّز في مطابقة الأرقام).
// ═══════════════════════════════════════════════════════════════════════
{
  const fixture = loadFrozen('frozen-real-model-output-b45c8cf6-partial-state-2026-09-23.json');
  ok(fixture.parsed.narrative.details.includes('الحالة PARTIAL'),
      '[٣] الثابت المُجمَّد يحمل فعلاً النصّ "الحالة PARTIAL" (سلامة التجميد)');

  const raw = loadGolden('b45c8cf6.ts.json');
  const frMap = loadGolden('functionalResults-by-scanid.json').byScanId;
  const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const fp = {device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []};
  const findings = computeFindings(fp);
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design,
  });

  const guard = guardV7Response(fixture.parsed, {findings, categoryStates});

  eq(guard.ok, false, '[٣] الحارس يرفض هذه المحاولة اليوم تماماً كما رفضها وقت النداء الحقيقي');
  const detailsLeak = guard.languageLeaks.find((l) => l.path === 'narrative.details');
  ok(detailsLeak, '[٣] رفض بسبب تسرّب لغة في narrative.details تحديداً (كما وقت النداء)');
  ok(detailsLeak.tokens.includes('PARTIAL'),
      `[٣] التوكِن المرفوض هو PARTIAL بعينه — ${JSON.stringify(detailsLeak.tokens)}`);

  // مطابقة الحارس الحقيقي المحفوظ وقت النداء (لا إعادة بناء افتراضية) —
  // القاعدة 30: القيمة ودلالتها معاً، لا مجرّد "رُفض".
  eq(fixture.realGuardVerdictAtCaptureTime.ok, false,
      '[٣] الحارس الحقيقي المحفوظ وقت النداء كان أيضاً false (توثيق لا افتراض)');
  const realDetailsLeak = fixture.realGuardVerdictAtCaptureTime.languageLeaks.find((l) => l.path === 'narrative.details');
  ok(realDetailsLeak && realDetailsLeak.tokens.includes('PARTIAL'),
      '[٣] الحارس الحقيقي وقت النداء رفض لنفس السبب بعينه (PARTIAL في narrative.details)');
}
console.log('تحقّق ٣: "الحالة PARTIAL" الحقيقي (b45c8cf6، 02-13-49، المحاولة ١) يبقى مرفوضاً بالحارس اليوم — تنبيه البرومبت لا يخفّف الحارس');

console.log(`\nstatePromptTranslationHint.test.js: ${n}/${n} assertions passed`);
