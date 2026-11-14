'use strict';

// systemPromptV7.test.js — P1.4 (PLAN-01-ROADMAP.md، "P1.4 البرومبت v7"
// + القرار ٩ "لا عتبة في البرومبت إطلاقاً").
//
// Run: node functions/test/systemPromptV7.test.js

const assert = require('assert');
const {SYSTEM_PROMPT_V7, getSystemPromptV7, CATEGORY_NAME_AR, CATEGORY_NAME_TR} =
    require('../src/prompts/systemPromptV7');
const {CATEGORIES} = require('../src/utils/categories');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// القرار ٩ — صفر عتبة رقمية في نصّ البرومبت المُرسَل فعلياً للنموذج
// ═══════════════════════════════════════════════════════════════════════
{
  const THRESHOLD_UNIT_PATTERN = /[0-9]+(\.[0-9]+)?\s*-?\s*(mV|mAh|GHz|MB\/s|%|°C|mΩ|هرتز|جيجاهرتز)/g;
  for (const [label, text] of [['ar', SYSTEM_PROMPT_V7], ['tr', getSystemPromptV7('tr')]]) {
    const matches = text.match(THRESHOLD_UNIT_PATTERN);
    eq(matches, null, `القرار ٩: صفر رقم-وحدة (mV/mAh/GHz/MB per s/%/°C/mΩ) في نصّ V7 (${label}) — فعلياً: ${JSON.stringify(matches)}`);
  }
  // النطاقات الرقمية بلا وحدة (مثل "0.7-0.95") ممنوعة أيضاً — نمط أعمّ.
  for (const [label, text] of [['ar', SYSTEM_PROMPT_V7], ['tr', getSystemPromptV7('tr')]]) {
    const rangeMatches = text.match(/0\.\d+\s*[-–]\s*0\.\d+/g);
    eq(rangeMatches, null, `القرار ٩: صفر نطاق عشري ثابت (مثل 0.7-0.95) في نصّ V7 (${label})`);
  }
}
console.log('تحقّق القرار ٩: صفر عتبة رقمية في كلا نسختَي البرومبت (ar/tr)');

// ═══════════════════════════════════════════════════════════════════════
// جدول أسماء الفئات — الخمس عشرة كلّها حاضرة، لغة الحمولة
// ═══════════════════════════════════════════════════════════════════════
eq(CATEGORIES.length, 15, 'CATEGORIES من utils/categories فعلاً 15');
for (const cat of CATEGORIES) {
  ok(cat in CATEGORY_NAME_AR, `CATEGORY_NAME_AR يحمل ${cat}`);
  ok(cat in CATEGORY_NAME_TR, `CATEGORY_NAME_TR يحمل ${cat}`);
  ok(SYSTEM_PROMPT_V7.includes(`${cat} → ${CATEGORY_NAME_AR[cat]}`), `نصّ AR يحمل سطر ترجمة ${cat}`);
  ok(getSystemPromptV7('tr').includes(`${cat} → ${CATEGORY_NAME_TR[cat]}`), `نصّ TR يحمل سطر ترجمة ${cat}`);
}
console.log('تحقّق: جدول أسماء الفئات الخمس عشرة كامل في كلا اللغتين');

// ═══════════════════════════════════════════════════════════════════════
// S5 (أمر مستخدم 2026-10-01 +03) — استُبدل لا أُضيف (القاعدة 23): كان هذا
// التحقّق يثبت أن النصّ "يمنع الترجمة ويطلب الكتابة الحرفية" لمعرّفات
// الاختبار/أسماء البوّابات في النثر — ذلك السلوك القديم صار خاطئاً؛ اليوم
// المطلوب منعهما من النثر البشري كلّياً (لا حرفياً ولا مترجَماً).
// ═══════════════════════════════════════════════════════════════════════
ok(/لا تذكر رقم\/معرّف أي\s+اختبار \(testId\) ولا اسم أي بوّابة مسمّاة/.test(SYSTEM_PROMPT_V7),
    'S5: النصّ يمنع ذكر أي testId أو اسم بوّابة مسمّاة في النثر البشري كلّياً — لا استثناء "كما وصلت حرفياً"');
ok(!SYSTEM_PROMPT_V7.includes('تلك تبقى كما وصلت بلا') && !SYSTEM_PROMPT_V7.includes('مسموحة'),
    'S5: عبارات "الاستثناء المسموح" القديمة لأسماء البوّابات/testId أُزيلت فعلياً — لا بقيّة متناقضة');
ok(SYSTEM_PROMPT_V7.includes('لا تكتب كلمة "الحمولة"'), 'S5: النصّ يمنع كلمة "الحمولة" في النثر البشري');
ok(SYSTEM_PROMPT_V7.includes('لا حكم صحّة لفئة بلا حرف'), 'S5: قاعدة منع الحكم الصحّي على فئة بلا حرف (البطارية/الحرارة) مذكورة');
ok(SYSTEM_PROMPT_V7.includes('معدّل إطارات'), 'S5: قاعدة تسمية gpu_fps مذكورة نصّاً (بصيغة المنع)');
// أمر 2026-10-07 (البند ٣، القاعدة 23: استُبدل توقّع الصياغة القديمة «لا تستعمل هذه التسمية» ولم يُضَف إليه): البند (د) صار
// «قياس الرسوميات لا يصلك بقيمته… فلا تذكر عنه رقماً، ولا تسمِّه "معدّل إطارات"» — المنع باقٍ بصياغة المستخدم المعتمَدة.
ok(/ولا تسمِّه "معدّل إطارات"/.test(SYSTEM_PROMPT_V7), 'S5: النصّ يمنع صراحة تسمية قياس الرسوميات "معدّل إطارات" (الصياغة المعتمَدة 2026-10-07)');
ok(SYSTEM_PROMPT_V7.includes('لا رقم دقّة كاميرا ولا عدد كاميرات'), 'S5: قاعدة منع أرقام دقّة/عدد الكاميرات مذكورة');
ok(CATEGORY_NAME_AR.gps === 'الموقع (GPS)', 'S5: فئة gps مُسمّاة "الموقع (GPS)" في جدول الأسماء العربي');
ok(SYSTEM_PROMPT_V7.includes('الموقع (GPS)'), 'S5: نصّ البرومبت الفعلي (عبر جدول الفئات) يحمل "الموقع (GPS)"');

// ═══════════════════════════════════════════════════════════════════════
// عقد المخرَج — الحقول الأربعة مذكورة، ولا grade/score/category_scores
// ═══════════════════════════════════════════════════════════════════════
for (const field of ['narrative', 'crossChecks', 'adjustments', 'modelObservations']) {
  ok(SYSTEM_PROMPT_V7.includes(field), `النصّ يذكر حقل المخرَج ${field}`);
}
ok(SYSTEM_PROMPT_V7.includes('لا تكتبها إطلاقاً'), 'النصّ يمنع صراحة grade/score/category_scores من مخرَج النموذج');
ok(SYSTEM_PROMPT_V7.includes('direction: "DOWN"'), 'قاعدة adjustments: DOWN هو المسار المُطبَّق');
ok(SYSTEM_PROMPT_V7.includes('disputed: true'), 'قاعدة adjustments: UP يُحفَظ بوسم disputed ولا يُطبَّق');
ok(SYSTEM_PROMPT_V7.includes('evidenceRefs'), 'قاعدة evidenceRefs مذكورة');
ok(/اثنتين/.test(SYSTEM_PROMPT_V7), 'حدّ modelObservations = 2 مذكور نصّاً');

// ═══════════════════════════════════════════════════════════════════════
// لا أمر "احسب كل إحصاء بنفسك" (سبب طول التفكير القديم)
// ═══════════════════════════════════════════════════════════════════════
ok(!/compute every mean/i.test(SYSTEM_PROMPT_V7), 'لا نسخ من أمر V6 "compute every mean..." في V7');
ok(SYSTEM_PROMPT_V7.includes('لا توجد عيّنات خام'), 'النصّ يوضّح صراحة أن لا عيّنات خام تصل النموذج');
ok(!SYSTEM_PROMPT_V7.includes('samples['), 'لا إشارة إلى فهرسة مصفوفة samples في V7 (ذلك V6)');

console.log(`\nsystemPromptV7.test.js: ${n}/${n} assertions passed`);
