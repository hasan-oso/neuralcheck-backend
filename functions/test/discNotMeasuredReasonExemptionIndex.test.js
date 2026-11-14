'use strict';

// discNotMeasuredReasonExemptionIndex.test.js — القرار ٩٥ البند ١ (ج،
// 2026-09-25 +03). نصّ المستخدم حرفياً: "اختبار دائم: لكل ملاحظة DISC،
// تكون كلمات notMeasuredReason في الفهرس، سواء كان رمز السبب في العنوان
// أم لم يكن. ويُثبت أنه يفشل إن حُذف notMeasuredReason مما يقرؤه القارئ."
//
// السياق: قالب عنوان DISC في categoryStates.js (buildDeterministicIssues)
// صار `غير مقيس: ${testId}` — لم يعد يحمل رمز notMeasuredReason بين
// قوسين (كان `غير مقيس: ${testId} (${notMeasuredReason})`). القارئ
// المعنيّ (collectGateNameTokens، reportShapeV7.js:476-497 — يبني فهرس
// إعفاء التسرّب اللغوي buildLeakExemptionIndex) لا يعتمد على نصّ العنوان
// أصلاً — يمشي كل كائن في findings/categoryStates ويلتقط قيمة أيّ حقل
// اسمه ضمن GATE_VOCAB_KEYS (تتضمّن 'notMeasuredReason' حرفياً)، بصرف
// النظر عن ظهوره في title أم لا. **هذا الاختبار يثبت ذلك الاستقلال
// صراحة**، لا يفترضه من قراءة الكود.
//
// Run: node functions/test/discNotMeasuredReasonExemptionIndex.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {buildLeakExemptionIndex} = require('../src/analysis/reportShapeV7');
const {CATEGORY_NAME_AR} = require('../src/utils/categories');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

// نفس فِخّ S10 المُستعمَل في كل أنحاء السويت (categoryStates.test.js:52-76).
const raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const battery = sampleInputsFromRaw(raw);
const categoryStates = computeCategoryStates({
  functionalResults: functional, manualResults: [], dev: null,
  batterySampleInputs: battery.sampleInputs, batteryDesignCapacityMah: battery.design,
  analyzedAtMs: Date.parse('2026-09-24T00:00:00.000Z'),
});

const LEAK_TOKEN_RE = /[A-Za-z][A-Za-z0-9]+/g;
function tokenize(str) {
  const tokens = [];
  LEAK_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = LEAK_TOKEN_RE.exec(str)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

// ═══════════════════════════════════════════════════════════════════════
// ١ — الاستقلال المطلوب: القالب الجديد لا يحمل رمز السبب في العنوان،
//     والفهرس يحمل كلماته رغم ذلك (من notMeasuredReason كحقل مستقلّ على
//     testResults[i]، لا من title).
// ═══════════════════════════════════════════════════════════════════════
const discIssues = (categoryStates.issues || []).filter((i) => /^DISC-/.test(i.id));
ok(discIssues.length > 0, '[إعداد] يوجد فعلاً DISC issues على فِخّ S10 (لا اختبار على مجموعة فارغة)');

const index = buildLeakExemptionIndex({categoryStates});

for (const issue of discIssues) {
  const testId = issue.id.replace(/^DISC-/, '');
  const testResult = categoryStates.testResults.find((t) => t.testId === testId);
  ok(!!testResult, `[إعداد] testResults يحمل عنصراً لِـ${testId} (مصدر DISC-${testId})`);
  ok(typeof testResult.notMeasuredReason === 'string' && testResult.notMeasuredReason.length > 0,
      `[إعداد] ${testId}.notMeasuredReason نصّ غير فارغ فعلياً`);

  // القالب — لا رمز السبب بين قوسين في العنوان (القرار ٩٥-١ج)، **ولا
  // testId نفسه** بعد اليوم (S2، أمر مستخدم 2026-10-01 +03 — استُبدل هنا
  // لا أُضيف، القاعدة 23): العنوان صار "غير مقيس — <اسم الفئة بالعربية>".
  const category = issue.category;
  ok(issue.title === `غير مقيس — ${CATEGORY_NAME_AR[category] || category}`,
      `[S2] عنوان DISC-${testId} بالقالب الجديد حرفياً — بلا testId وبلا (${testResult.notMeasuredReason})`);
  ok(!issue.title.includes(testId),
      `[S2] عنوان DISC-${testId} لا يحمل رقم/معرّف الاختبار نفسه إطلاقاً بعد اليوم`);
  ok(!issue.title.includes(testResult.notMeasuredReason),
      `[القرار ٩٥/١ج] عنوان DISC-${testId} لا يحمل نصّ notMeasuredReason (${testResult.notMeasuredReason}) إطلاقاً بعد اليوم`);

  // **الاختبار الجوهري** — كلمات notMeasuredReason حاضرة في الفهرس رغم
  // غيابها عن العنوان (مصدرها الحقيقي: testResults[i].notMeasuredReason
  // كحقل مستقلّ، عبر collectGateNameTokens).
  const reasonTokens = tokenize(testResult.notMeasuredReason);
  ok(reasonTokens.length > 0, `[إعداد] notMeasuredReason لِـ${testId} يحمل توكِنز إنجليزية فعلاً (${testResult.notMeasuredReason})`);
  for (const tok of reasonTokens) {
    ok(index.has(tok),
        `[القرار ٩٥/١ج][جوهري] كلمة "${tok}" (من notMeasuredReason="${testResult.notMeasuredReason}" لِـDISC-${testId}) موجودة في فهرس الإعفاء رغم غيابها عن العنوان المعروض`);
  }
}
console.log(`تحقّق ١ [القرار ٩٥/١ج]: ${discIssues.length} ملاحظة DISC على S10 — كلمات notMeasuredReason كلّها في الفهرس رغم القالب الجديد بلا رمز السبب`);

// ═══════════════════════════════════════════════════════════════════════
// ٢ — الإثبات المطلوب صراحةً: "يفشل إن حُذف notMeasuredReason ممّا يقرؤه
//     القارئ." — محاكاة مباشرة: فهرس مبنيّ من categoryStates مُعدَّلة
//     (نسخة في الذاكرة، لا كتابة على القرص ولا لمس لأيّ ملفّ مُلتزَم) حيث
//     testResults[].notMeasuredReason حُذفت — يُثبت أن التوكِنز تختفي من
//     الفهرس، فالاختبار أعلاه كان سيفشل فعلاً لولا وجودها.
// ═══════════════════════════════════════════════════════════════════════
{
  const strippedTestResults = categoryStates.testResults.map((t) => {
    if (typeof t.notMeasuredReason !== 'string') return t;
    const copy = {...t};
    delete copy.notMeasuredReason;
    return copy;
  });
  const strippedCategoryStates = {...categoryStates, testResults: strippedTestResults};
  const strippedIndex = buildLeakExemptionIndex({categoryStates: strippedCategoryStates});

  let anyTokenMissingNow = false;
  const missingExamples = [];
  for (const issue of discIssues) {
    const testId = issue.id.replace(/^DISC-/, '');
    const testResult = categoryStates.testResults.find((t) => t.testId === testId);
    const reasonTokens = tokenize(testResult.notMeasuredReason);
    for (const tok of reasonTokens) {
      if (!strippedIndex.has(tok)) {
        anyTokenMissingNow = true;
        missingExamples.push(`${testId}: "${tok}"`);
      }
    }
  }
  ok(anyTokenMissingNow,
      `[القرار ٩٥/١ج][إثبات الفشل] حذف notMeasuredReason من testResults[] (نسخة في الذاكرة فقط، بلا لمس أي ملفّ) يُسقِط كلماته فعلياً من الفهرس — أمثلة: ${JSON.stringify(missingExamples.slice(0, 5))} — يُثبت أن الاختبار أعلاه يفحص شيئاً حقيقياً لا يمرّ دائماً بصرف النظر عن المُدخل`);
  console.log(`تحقّق ٢ [إثبات الفشل]: حذف notMeasuredReason يُسقِط ${missingExamples.length} كلمة من الفهرس فعلياً (محاكاة في الذاكرة، غير مُلتزَمة) — الاختبار أعلاه له أسنان حقيقية`);
}

console.log(`\ndiscNotMeasuredReasonExemptionIndex.test.js: ${n}/${n} assertions passed`);
