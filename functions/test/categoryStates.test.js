'use strict';

// categoryStates.test.js — P1.3 (PLAN-01-ROADMAP §المرحلة ١، P1.3 +
// تعديلَي 2026-09-20، الثاني منهما رسالة تصحيح أثناء التنفيذ نفسها:
// "الدرجة العامة: حرف دائماً" تُلغي "overallCoverage < 0.6 → بلا حرف")
// + P1.4 (§🔒 قرارات شكل الاستجابة، القرارات ١٠/١١/١٢، وA97/§١٣).
//
// ⚠️ ملاحظة منهجية — أيّ "الفحصين" تحديداً:
// الفحصان الأساسيان في P1.1 (8909e850=S10 وe4b65a2f=Honor) **لا يحملان
// functionalResults إطلاقاً** — ليس لأن Honor "غير مقيس"، بل لأن
// `reports/{scanId}` **غير موجود في Firestore (404)** لكليهما
// (golden/README.md §"إضافة" — GET مباشر بمعرّف السكان يُرجع 404 NOT_FOUND
// للفحصين، لأن مصدرهما rebuld/*-timeseries.json خارجيّ لم يمرّ بمسار
// analyzeDevice.js الذي يكتب مستند reports كاملاً). P1.3 يحتاج
// functionalResults ليبني جدول 15 فئة ذا معنى. الفحصان اللذان يحملانها
// فعلياً (b45c8cf6, 34dff2b8) **كلاهما S10** — Honor ليس له
// functionalResults في هذا المستودع بتاتاً.
//
// **القرار ١٢ (محسوم 2026-09-21، PLAN-01-ROADMAP.md §🔒، البند ١٢):**
// "e4b65a2f — HARNESS_ERROR لا «غير مقيس». functionalResults=null لأن
// المستند غير موجود (404)، لا لأن Honor غير مقيس. يُوسَم HARNESS_ERROR
// ولا يدخل أي إحصاء تغطية." — هذا يُلغي القرار المحلّي القديم في هذا
// الملف (استعمال `functionalResults: []` لتمثيل الغياب): `[]` تعني
// "الجلب نجح، صفر اختبار مُعلَن" — وهو **ليس** ما وقع فعلياً. الغياب
// الحقيقي (404) يُمرَّر الآن `null` صراحةً، فيدخل فرع buildHarnessError
// CategoryStates في categoryStates.js لا فرع noDataAtAll العادي.
//
// و`noDataAtAll` (صفر فئة MEASURED رغم أن الجلب نجح فعلاً) لم يعد له فِخّ
// ذهبي حقيقي بعد هذا التصحيح — الحالتان الوحيدتان في هذا المستودع
// (8909e850 وe4b65a2f) كلتاهما 404 حقيقي، لا "جلب ناجح بصفر نتيجة". لذلك
// قسم منفصل أدناه يغطّي noDataAtAll **اصطناعياً** (بصمات Honor الحقيقية +
// functionalResults=[] فعلاً، لا null) — مُعلَّم بوضوح "اصطناعي" (بنفس نمط
// findings.test.js/batteryLayer.test.js) كي لا يُقرأ خطأً كفِخّ حقيقي.
//
// Run: node functions/test/categoryStates.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeCategoryStates, CATEGORY_WEIGHTS, LETTER_ORDER, LETTER_BY_RANK} = require('../src/analysis/categoryStates');
const {CATEGORIES} = require('../src/utils/categories');
// P1.4 (§١٤ "A98"، بند 1): sampleInputsFromRaw موحَّدة في src/ الآن — لا
// نسخة محلّية هنا بعد اليوم. راجع test/sampleInputsFromRaw.test.js للتحقّق
// من تكافؤ النسخة الموحَّدة مع ما كان مكرَّراً هنا وفي batteryLayer.test.js.
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const s10Raw = loadJson('b45c8cf6.ts.json');
const honorRaw = loadJson('e4b65a2f-honor.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];

const s10Inputs = sampleInputsFromRaw(s10Raw);
const honorInputs = sampleInputsFromRaw(honorRaw);

ok(Array.isArray(s10Functional) && s10Functional.length === 85, 'S10(b45c8cf6): 85 عنصر functionalResults حقيقي');

// أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤) — analyzedAtMs صار مُدخَلاً
// صريحاً لـcomputeCategoryStates/computeGates (بوّابة PATCH_AGE). ساعة
// ثابتة موسومة (لا Date.now() في اختبار — يكسر تكراريّته) بعيدة كفاية عن
// SEC-03="2021-08-01" (كلا الفِخّين) لتبقى >36 شهراً بصرف النظر عن تاريخ
// تشغيل السويت الفعلي؛ "ساعة محقونة بقيمتين تعطي الحرف نفسه" — راجع قسم
// "حقن ساعتين مختلفتين" أسفل هذا الملفّ لإثبات ذلك صراحة.
const FIXED_ANALYZED_AT_MS = Date.parse('2026-09-24T00:00:00.000Z');

const s10Result = computeCategoryStates({
  functionalResults: s10Functional,
  manualResults: [],
  batterySampleInputs: s10Inputs.sampleInputs,
  batteryDesignCapacityMah: s10Inputs.design,
  analyzedAtMs: FIXED_ANALYZED_AT_MS,
});

// Honor (القرار ١٢): functionalResults=null صراحةً — الجلب نفسه تعذّر (404
// حقيقي موثَّق)، لا "صفر اختبار مُعلَن". samples حقيقية فتبقى البطارية
// محسوبة (لا تعتمد على functionalResults).
const honorResult = computeCategoryStates({
  functionalResults: null,
  manualResults: [],
  batterySampleInputs: honorInputs.sampleInputs,
  batteryDesignCapacityMah: honorInputs.design,
});

// ═══════════════════════════════════════════════════════════════════════
// التحقّق الإلزامي 1 — لا حرف لفئة UNMEASURED أو ATTESTED_ONLY (كلا الفحصين)
// ═══════════════════════════════════════════════════════════════════════
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  for (const cat of CATEGORIES) {
    const entry = result.categories[cat];
    if (entry.state === 'UNMEASURED' || entry.state === 'ATTESTED_ONLY' || entry.state === 'HARNESS_ERROR') {
      eq(entry.deterministicLetter, null, `${label}/${cat}: state=${entry.state} → لا حرف`);
    }
  }
}
console.log('تحقّق 1: لا حرف لفئة UNMEASURED/ATTESTED_ONLY/HARNESS_ERROR — OK على الفحصين');

// ═══════════════════════════════════════════════════════════════════════
// التحقّق الإلزامي 2 (مُعدَّل برسالة تصحيح أثناء التنفيذ) —
// الدرجة العامة حرف دائماً؛ تغطية < 0.6 يضيف وسماً بالرقم، لا يُسقط الحرف.
// ═══════════════════════════════════════════════════════════════════════
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  // القرار ١٢/A97 #3: "تعذّر التجهيز" (harnessError) مسار مختلف كلّياً عن
  // "لم يُقَس" (noDataAtAll) — لا حرف، لا رقم تغطية (null لا 0%)، ولا وسم
  // "تقييم جزئي" (ذلك وسم لتغطية رقمية موجودة أقلّ من 0.6، لا لغياب الرقم
  // نفسه). Honor يقع هنا الآن (functionalResults=null أعلاه).
  if (result.overall.harnessError) {
    eq(result.overall.coverage, null, `${label}: overall.coverage=null — "لا يدخل أي إحصاء تغطية" (القرار ١٢)`);
    eq(result.overall.measuredCategoriesMean, null, `${label}: overall.measuredCategoriesMean=null (تعذّر التجهيز)`);
    eq(result.overall.letterSource, 'HARNESS_ERROR', `${label}: letterSource=HARNESS_ERROR — يعكس السبب صراحة، لا BAND ولا null صامتاً`);
    eq(result.overall.letter, null, `${label}: overall.letter=null (تعذّر التجهيز، لا حرف من عدم)`);
    eq(result.overall.noDataAtAll, false, `${label}: noDataAtAll=false — هذا مسار "تعذّر التجهيز" منفصل (A97 #3)`);
    eq(result.overall.partialAssessment, false, `${label}: لا وسم "تقييم جزئي" بلا رقم تغطية أصلاً`);
    eq(result.overall.partialAssessmentTag, null, `${label}: لا partialAssessmentTag`);
    console.log(`  ⚠️ ${label}: harnessError=true (${result.overall.harnessErrorReason}) — لا حرف ولا رقم تغطية إطلاقاً`);
    continue;
  }
  if (result.overall.noDataAtAll) {
    // مسار "لم يُقَس" — الجلب نجح فعلاً لكن صفر فئة MEASURED. لا فِخّ ذهبي
    // حقيقي له بعد القرار ١٢ (راجع تعليق رأس الملف) — القسم الاصطناعي
    // أسفل الملف يغطّيه. الحلقة هنا تبقى دفاعية (لن تُنفَّذ على الفِخاخ
    // الحقيقية الحالية، لكن لا تفترض ذلك بصمت).
    eq(result.overall.measuredCategoriesMean, null, `${label}: overall.measuredCategoriesMean=null (لا بيانات إطلاقاً)`);
    eq(result.overall.letter, null, `${label}: overall.letter=null فقط في هذه الحالة الحدّية الموثَّقة`);
    eq(result.overall.letterSource, 'NO_DATA', `${label}: letterSource=NO_DATA — صفر فئة MEASURED ولم تُنقذه بوّابة`);
    console.log(`  ⚠️ ${label}: noDataAtAll=true — لا حرف عامّ (حالة حدّية موثَّقة، لا انتهاك لقاعدة "حرف دائماً")`);
    continue;
  }
  ok(result.overall.measuredCategoriesMean !== null, `${label}: overall.measuredCategoriesMean محسوب (فئة MEASURED واحدة على الأقل)`);
  ok(result.overall.letterSource === 'BAND' || /^GATE:/.test(result.overall.letterSource),
      `${label}: letterSource إمّا BAND أو GATE:<name> حين letter غير null`);
  ok(result.overall.letter !== null, `${label}: overall.letter موجود دائماً (لا "بلا حرف")`);
  if (result.overall.coverage < 0.6) {
    ok(result.overall.partialAssessment === true, `${label}: partialAssessment=true تحت 0.6`);
    ok(!!result.overall.partialAssessmentTag, `${label}: partialAssessmentTag موجود`);
    ok(result.overall.partialAssessmentTag.text.includes('%'), `${label}: الوسم يحمل الرقم دائماً`);
    eq(result.overall.partialAssessmentTag.coveragePct, Math.round(result.overall.coverage * 1000) / 10,
        `${label}: coveragePct مُشتقّ من overall.coverage نفسه`);
  } else {
    eq(result.overall.partialAssessment, false, `${label}: تغطية ≥ 0.6 → partialAssessment=false`);
    eq(result.overall.partialAssessmentTag, null, `${label}: لا وسم فوق 0.6`);
  }
}
console.log(`تحقّق 2: overall.letter=${s10Result.overall.letter} (coverage=${(s10Result.overall.coverage*100).toFixed(1)}%، القرار ١٠) على S10، ` +
    `Honor: harnessError=${honorResult.overall.harnessError} (القرار ١٢)`);

// ═══════════════════════════════════════════════════════════════════════
// التحقّق الإلزامي 3 — كل حرف قابل لإعادة الاشتقاق من الجدول المعروض معه
// (اختبار آلي يعيد الحساب من "مستند التقرير" = نفس كائن النتيجة).
// ═══════════════════════════════════════════════════════════════════════
function rederiveOverallLetter(result) {
  let wSum = 0; let sSum = 0;
  for (const cat of CATEGORIES) {
    const entry = result.categories[cat];
    if (entry.state === 'MEASURED' && typeof entry.score === 'number') {
      wSum += CATEGORY_WEIGHTS[cat];
      sSum += CATEGORY_WEIGHTS[cat] * entry.score;
    }
  }
  if (wSum === 0) return null;
  const score = sSum / wSum;
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  const rederivedScore = (() => {
    let wSum = 0; let sSum = 0;
    for (const cat of CATEGORIES) {
      const entry = result.categories[cat];
      if (entry.state === 'MEASURED' && typeof entry.score === 'number') {
        wSum += CATEGORY_WEIGHTS[cat]; sSum += CATEGORY_WEIGHTS[cat] * entry.score;
      }
    }
    return wSum > 0 ? sSum / wSum : null;
  })();
  ok(Math.abs(rederivedScore - result.overall.measuredCategoriesMean) < 1e-9,
      `${label}: overall.measuredCategoriesMean قابل لإعادة الاشتقاق حرفياً من جدول الفئات`);

  // إعادة الاشتقاق الكاملة (بعد إصلاح A63 الجديد فوق e599edf) تشمل الآن
  // البوّابات المسمّاة المعروضة في overall.gatesApplied نفسه — لا الرقم
  // وحده. هذا بالضبط الإصلاح المطلوب: البوّابات جزء من "الجدول المعروض
  // معه"، فإعادة الاشتقاق يجب أن تستهلكها لا تتجاهلها.
  const rederivedLetterFromScoreOnly = rederiveOverallLetter(result);
  let rederivedRank = rederivedLetterFromScoreOnly === null ? null : LETTER_ORDER[rederivedLetterFromScoreOnly];
  for (const g of result.overall.gatesApplied) {
    if (g.name === 'BATTERY_MAX_ONE_BAND') continue; // مطبَّق قبل rederivedScore أصلاً (على المتوسّط الخام) — لا أثر إضافي هنا لأن score/rederivedScore متطابقان بالفعل
    if (g.status === 'FIRED' && rederivedRank !== null) {
      rederivedRank = Math.max(rederivedRank, LETTER_ORDER[g.ceilingLetter]);
    }
  }
  const rederivedLetterFinal = rederivedRank === null ? null : LETTER_BY_RANK[rederivedRank];
  eq(result.overall.letter, rederivedLetterFinal,
      `${label}: overall.letter قابل لإعادة الاشتقاق من measuredCategoriesMean + gatesApplied[] المعروضين معاً`);

  // letterSource — إعادة اشتقاق منفصلة بنفس قاعدة التطبيق التسلسلية
  // (لا max() المبسَّطة أعلاه): آخر بوّابة (بترتيب gatesApplied[] الثابت،
  // نفسه ترتيب computeGates) وجدت الرتبة الحالية أسوأ من سقفها فعلاً
  // (cappedOverall:true) هي الحاكمة. هذا يطابق قاعدة التعادل الموثَّقة في
  // categoryStates.js (deriveOverallFromCategories): البوّابة الأسبق تفوز
  // عند تساوي السقف لأن applyOverallCeilings تُحدِّث فقط عند > الصارمة.
  let rederivedLastEffective = null;
  for (const g of result.overall.gatesApplied) {
    if (g.cappedOverall === true) rederivedLastEffective = g.name;
  }
  const rederivedLetterSource = result.overall.letter === null ?
      (result.overall.harnessError ? 'HARNESS_ERROR' : 'NO_DATA') :
      (rederivedLastEffective ? `GATE:${rederivedLastEffective}` : 'BAND');
  eq(result.overall.letterSource, rederivedLetterSource,
      `${label}: overall.letterSource قابل لإعادة الاشتقاق من gatesApplied[].cappedOverall وحدها`);
  for (const cat of CATEGORIES) {
    const entry = result.categories[cat];
    if (cat === 'battery') continue; // نطاق حرف مختلف (وصفي) — يُتحقَّق في batteryLayer.test.js
    if (entry.state === 'MEASURED' || entry.state === 'PARTIAL') {
      const expectedPassRateScore = 100 * entry.passCount / entry.executedCount;
      eq(entry.score, expectedPassRateScore, `${label}/${cat}: score قابل لإعادة الاشتقاق من pass_count/executed`);
    }
  }
}
console.log('تحقّق 3: إعادة الاشتقاق الآلي مطابقة على الفحصين');

// ═══════════════════════════════════════════════════════════════════════
// التحقّق الإلزامي 4 — thermal → UNMEASURED؛ security S10 → D
// ═══════════════════════════════════════════════════════════════════════
eq(s10Result.categories.thermal.state, 'UNMEASURED', 'S10: thermal.state=UNMEASURED');
eq(s10Result.categories.thermal.deterministicLetter, null, 'S10: thermal بلا حرف');
// Honor: HARNESS_ERROR لا UNMEASURED (القرار ١٢) — كل الفئات غير البطارية
// تحمل هذه الحالة الآن لأن functionalResults=null (تعذّر التجهيز)، لا لأن
// thermal تحديداً "غير مقيسة" على هذا الجهاز.
eq(honorResult.categories.thermal.state, 'HARNESS_ERROR', 'Honor: thermal.state=HARNESS_ERROR (القرار ١٢، لا UNMEASURED)');
eq(honorResult.categories.thermal.deterministicLetter, null, 'Honor: thermal بلا حرف');

eq(s10Result.categories.security.deterministicLetter, 'D', 'S10: security → D');
eq(s10Result.categories.security.floorApplied, 'STATE_FAIL_FLOOR', 'S10: security D من قاعدة فشل STATE (SEC-04)، لا من سقف');
const gatesForS10 = require('../src/analysis/categoryStates')._internal
    .computeGates({functionalByTestId: Object.fromEntries(s10Functional.map((r) => [r.testId, r])), findings: null, analyzedAtMs: FIXED_ANALYZED_AT_MS});
const rootGate = gatesForS10.find((g) => g.name === 'ROOT_DETECTED');
const patchGate = gatesForS10.find((g) => g.name === 'PATCH_AGE');
eq(rootGate.status, 'FIRED', 'S10: بوّابة ROOT_DETECTED=FIRED من SEC-04=fail');
eq(patchGate.status, 'FIRED', `S10: بوّابة PATCH_AGE=FIRED (${patchGate.source})`);
console.log('تحقّق 4 (جزء أ): thermal=UNMEASURED على الجهازين، security(الفئة)=D — OK');

// ═══════════════════════════════════════════════════════════════════════
// حقن ساعتين مختلفتين — أمر مستخدم 2026-09-24 +03 (القرار ٧٥ البند ٤):
// "والاختبار: ساعة محقونة بقيمتين تعطي الحرف نفسه."
// ═══════════════════════════════════════════════════════════════════════
{
  const byTestId = Object.fromEntries(s10Functional.map((r) => [r.testId, r]));
  const clockA = Date.parse('2026-09-24T00:00:00.000Z'); // FIXED_ANALYZED_AT_MS نفسها
  const clockB = Date.parse('2027-09-24T00:00:00.000Z'); // +سنة كاملة — قيمة مختلفة فعلاً
  ok(clockA !== clockB, '[إعداد] الساعتان مختلفتان فعلاً رقمياً، لا حيلة تساوٍ صدفةً');

  const {computeGates: computeGatesDirect} = require('../src/analysis/categoryStates')._internal;
  const gatesA = computeGatesDirect({functionalByTestId: byTestId, findings: null, analyzedAtMs: clockA});
  const gatesB = computeGatesDirect({functionalByTestId: byTestId, findings: null, analyzedAtMs: clockB});
  const patchA = gatesA.find((g) => g.name === 'PATCH_AGE');
  const patchB = gatesB.find((g) => g.name === 'PATCH_AGE');

  eq(patchA.status, 'FIRED', '[حقن الساعة][A] SEC-03=2021-08-01 مقابل 2026-09-24 → >36 شهراً → FIRED');
  eq(patchB.status, 'FIRED', '[حقن الساعة][B] SEC-03=2021-08-01 مقابل 2027-09-24 → >36 شهراً أيضاً → FIRED');
  eq(patchA.status, patchB.status, '[حقن الساعة] ساعتان مختلفتان فعلياً (فرق سنة كاملة) → نفس حالة PATCH_AGE (كلاهما يتجاوز 36 شهراً)');
  ok(patchA.source !== patchB.source, '[حقن الساعة] نصّ source يختلف فعلاً (عدد أشهر مختلف) رغم تطابق الحالة — الساعة تُستهلَك فعلياً لا مُتجاهَلة');

  // الأثر على الحرف النهائي — الجزء الفعلي المطلوب ("تعطي الحرف نفسه"):
  // نفس فئة security على نفس المُدخلات، بساعتين مختلفتين، عبر السلسلة
  // الكاملة (computeCategoryStates→applyCeilings→applyOverallCeilings).
  const csA = computeCategoryStates({
    functionalResults: s10Functional, manualResults: [],
    batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
    analyzedAtMs: clockA,
  });
  const csB = computeCategoryStates({
    functionalResults: s10Functional, manualResults: [],
    batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
    analyzedAtMs: clockB,
  });
  eq(csA.overall.letter, csB.overall.letter, '[حقن الساعة] overall.letter مطابق بين الساعتين (PATCH_AGE بلا أثر فعلي هنا أصلاً — ROOT_DETECTED هي الحاكمة، راجع تحقّق letterSource أدناه)');
  eq(csA.categories.security.deterministicLetter, csB.categories.security.deterministicLetter,
      '[حقن الساعة] security.deterministicLetter مطابق بين الساعتين (STATE_FAIL_FLOOR هي الحاكمة على مستوى الفئة، لا PATCH_AGE)');

  // وبالمقابل — غياب الساعة كلّياً (لا Date.now() بديلاً، نصّ الأمر): حالة
  // مختلفة فعلاً (UNKNOWN)، لا FIRED ولا NOT_FIRED صامتة.
  const gatesNoClock = computeGatesDirect({functionalByTestId: byTestId, findings: null});
  const patchNoClock = gatesNoClock.find((g) => g.name === 'PATCH_AGE');
  eq(patchNoClock.status, 'UNKNOWN', '[حقن الساعة][غياب] analyzedAtMs غائب كلّياً → PATCH_AGE=UNKNOWN، لا Date.now() بديلاً (نصّ الأمر صراحة)');
}
console.log('تحقّق [حقن الساعة]: ساعتان مختلفتان فعلياً (2026/2027) → نفس حالة PATCH_AGE ونفس letter؛ غياب الساعة → UNKNOWN لا Date.now()');

// ─────────────────────────────────────────────────────────────────────
// إصلاح عطب أُبلِغ أثناء التنفيذ (فوق e599edf): "جهاز مجذَّر يقرأ A/100"
// — security كانت PARTIAL (تغطية 90%) فتسقط من weightedScore (على
// MEASURED فقط) بلا أثر، فتبقى الدرجة العامة 100/A رغم SEC-04=fail.
// الإصلاح: البوّابات المسمّاة (ROOT_DETECTED/PATCH_AGE) تُطبَّق الآن على
// **الحرف العامّ مباشرة** (applyOverallCeilings)، بصرف النظر عن حالة
// الفئة المصدر. الاختبار الإلزامي المطلوب صراحةً:
// ─────────────────────────────────────────────────────────────────────
ok(s10Result.overall.letter !== null, 'S10: overall.letter موجود');
ok(LETTER_ORDER[s10Result.overall.letter] >= LETTER_ORDER.C,
    `S10: SEC-04=fail ⇒ overall.letter ≤ C (فعلياً "${s10Result.overall.letter}") — إصلاح عطب A63 الجديد`);
ok(s10Result.overall.gatesApplied.some((g) => g.name === 'ROOT_DETECTED' && g.status === 'FIRED' && g.cappedOverall === true),
    'S10: overall.gatesApplied يحمل ROOT_DETECTED مُطبَّقاً فعلياً على الحرف العامّ (لا على الفئة وحدها)');
// شفافية: لا بوّابة صامتة — الخمس كلّها حاضرة بحالتها في overall.gatesApplied.
for (const name of ['ROOT_DETECTED', 'PATCH_AGE', 'STORAGE_VERIFY_ERRORS', 'GPU_HASH_MISMATCH', 'SUSTAINED_CEILING']) {
  const g = s10Result.overall.gatesApplied.find((x) => x.name === name);
  ok(!!g, `S10: overall.gatesApplied يذكر ${name} صراحة (لا حذف صامت)`);
}
eq(s10Result.overall.gatesApplied.find((g) => g.name === 'STORAGE_VERIFY_ERRORS').status, 'NOT_WIRED',
    'S10: STORAGE_VERIFY_ERRORS مُعلَنة NOT_WIRED صراحة — لا تُقرأ "اجتازت"');
eq(s10Result.overall.gatesApplied.find((g) => g.name === 'GPU_HASH_MISMATCH').status, 'NOT_WIRED',
    'S10: GPU_HASH_MISMATCH مُعلَنة NOT_WIRED صراحة — لا تُقرأ "اجتازت"');
eq(s10Result.overall.gatesApplied.find((g) => g.name === 'SUSTAINED_CEILING').status, 'DISABLED',
    'S10: SUSTAINED_CEILING مُعلَنة DISABLED صراحة (ممنوعة قبل PLAN-03 بنصّ الخطّة)');
console.log(`تحقّق 4 (جزء ب، إصلاح A63): overall.letter=${s10Result.overall.letter} على S10 المجذَّر — لم يعد A/100`);

// "المطلوب 5" — مراجعة العكس: هل فئة PARTIAL أخرى بحرف سيّئ تسقط بلا
// بوّابة تمسكها؟ على الفحصين الحقيقيين المتاحين: لا (مصفوفة فارغة) —
// مُبلَّغ لا مُصلَح بتخمين، والكاشف نفسه يعمل في كل تشغيل مستقبلي.
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  eq(result.overall.partialBadLetterUngated.length, 0,
      `${label}: لا فئة PARTIAL بحرف سيّئ غير ممسوكة اليوم (لو وُجدت لظهرت هنا لا أن تُخفى)`);
}

// ═══════════════════════════════════════════════════════════════════════
// إضافي — لا إسقاط صامت لأي فئة (تصحيح أثناء التنفيذ، بند 2)
// ═══════════════════════════════════════════════════════════════════════
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  eq(Object.keys(result.categories).length, 15, `${label}: كل الفئات الـ15 حاضرة في المخرَج`);
  for (const cat of CATEGORIES) {
    ok(!!result.categories[cat].state, `${label}/${cat}: state موجود (لا إسقاط صامت)`);
  }
}
console.log('تحقّق إضافي: لا إسقاط صامت — 15/15 فئة حاضرة على الفحصين');

// ═══════════════════════════════════════════════════════════════════════
// إضافي — اقتراحات نموذج مخالفة: تُحفَظ محجوزة null، لا تُعرض (بند 4)
// ═══════════════════════════════════════════════════════════════════════
for (const cat of CATEGORIES) {
  ok('llmSuggestedLetter' in s10Result.categories[cat], `S10/${cat}: llmSuggestedLetter محجوز في الشكل`);
  eq(s10Result.categories[cat].llmSuggestedLetter, null, `S10/${cat}: لا قيمة اليوم (P1.4 لم يبدأ)`);
}
ok('adjustments' in s10Result.overall && Array.isArray(s10Result.overall.adjustments), 'overall.adjustments محجوز كمصفوفة');
eq(s10Result.overall.disputed, false, 'overall.disputed محجوز، false اليوم');

// ═══════════════════════════════════════════════════════════════════════
// إضافي — البطارية: ثلاث درجات وصفية + ثقة، بلا رقم مئوي إطلاقاً (بند 3)
// ═══════════════════════════════════════════════════════════════════════
for (const [label, result] of [['S10', s10Result], ['Honor', honorResult]]) {
  const bat = result.categories.battery;
  eq(bat.score, null, `${label}: battery.score دائماً null — لا رقم مئوي`);
  ok(bat.deterministicLetter === null || ['سليمة', 'مؤشّرات تقادم', 'تقادم واضح'].includes(bat.deterministicLetter),
      `${label}: battery letter (إن وُجد) من الدرجات الوصفية الثلاث فقط`);
  ok(bat.batteryIndicators && Object.keys(bat.batteryIndicators).length === 4, `${label}: أربعة مؤشّرات بطارية محسوبة`);
  console.log(`  battery/${label}: state=${bat.state} verdictLabel=${bat.verdictLabel} confidence=${bat.confidence} ` +
      `noLetterReason=${bat.noLetterReason}`);
}

// ═══════════════════════════════════════════════════════════════════════
// طباعة الجدول الكامل للتقرير — 15 فئة، حالة/حرف/تغطية، والدرجة العامة
// ═══════════════════════════════════════════════════════════════════════
function printTable(label, result) {
  console.log(`\n=== جدول الفئات — ${label} ===`);
  for (const cat of CATEGORIES) {
    const e = result.categories[cat];
    console.log(`  ${cat.padEnd(10)} state=${String(e.state).padEnd(13)} letter=${String(e.deterministicLetter).padEnd(6)} ` +
        `coverage=${(e.coverage*100).toFixed(0)}% (${e.executedCount}/${e.declaredCount})`);
  }
  const coverageStr = result.overall.coverage === null ?
      `N/A (harnessError=${result.overall.harnessError}, ${result.overall.harnessErrorReason})` :
      `${(result.overall.coverage * 100).toFixed(1)}%`;
  console.log(`  OVERALL: letter=${result.overall.letter} letterSource=${result.overall.letterSource} ` +
      `measuredCategoriesMean=${result.overall.measuredCategoriesMean === null ? 'null' : result.overall.measuredCategoriesMean.toFixed(1)} ` +
      `coverage=${coverageStr} ${result.overall.partialAssessmentTag ? '[' + result.overall.partialAssessmentTag.text + ']' : ''}`);
}
printTable('S10 (b45c8cf6)', s10Result);
printTable('Honor (e4b65a2f، functionalResults=null — 404 حقيقي، القرار ١٢)', honorResult);

// ═══════════════════════════════════════════════════════════════════════
// التحقّق الإلزامي (قرار مستخدم إضافي، letterSource) — الثلاثي الذي يُفسّر
// نفسه على b45c8cf6 (S10 المجذَّر): measuredCategoriesMean=100 (كل الفئات
// MEASURED نجحت 100%) وletter=C معاً — لولا letterSource لبدا هذا تناقضاً
// ("C مع 100")؛ letterSource=GATE:ROOT_DETECTED يوضّح أن البوّابة هي
// الحاكمة، لا نقصان في الفئات المقيسة. تأكيد واحد يجمع الثلاثة معاً كما
// نصّ القرار حرفياً: "هذا هو الثلاثي الذي يُفسّر نفسه".
// ROOT_DETECTED لا PATCH_AGE رغم أن كليهما FIRED هنا فعلياً (SEC-04 fail +
// SEC-03 قديم >36 شهراً على هذا الفحص) — قاعدة التعادل الموثَّقة في
// categoryStates.js: الأسبق في ترتيب computeGates يفوز عند تفوّق سقفه على
// الرتبة الحالية أوّلاً؛ PATCH_AGE (سقف B) يجد الرتبة صارت C أصلاً
// (2 > 1 خطأ) فلا أثر (cappedOverall:false).
{
  const s10 = s10Result.overall;
  // القيمة المرجعية 93.58974358974359 (بدل 100 القديمة) — أمر مستخدم
  // 2026-09-27 +03 («الإعدادات لا تُنزل الحرف»)، القاعدة 23 (استبدال لا
  // إضافة). السبب: security انتقلت من PARTIAL إلى MEASURED (تغطيتها صارت
  // 6/6=100% بعد استبعاد SEC-01/05/06/07 من declaredHb — كانت 9/10=90%
  // قبل ذلك)، فدخلت لأوّل مرّة في weightedScore() (categoryStates.js:757-
  // 768، شرط entry.state==='MEASURED' فقط) بدرجتها 83.33 (بدل ألّا تُحسَب
  // إطلاقاً)، فتغيّر المتوسّط المرجَّح لكل الفئات المقيسة (measuredCategoriesMean،
  // :777). ⚠️ تصحيح دقيق مهمّ (لا "حقل تدقيق بلا أثر"): measuredCategoriesMean
  // **لا يُعرض رقمه** للمستخدم (:774)، **لكنه يُشتقّ منه scoreRank** فعلياً
  // (:789: `scoreRank = LETTER_ORDER[letterFromScore(measuredCategoriesMean)]`)
  // — أي الرتبة الخام لِلحرف العامّ *قبل* أي بوّابة مُسمّاة. في هذا الفحص
  // تحديداً letter يبقى 'C' لأن GATE:ROOT_DETECTED يفرضها بصرف النظر عن
  // scoreRank (السبب letterSource=GATE:ROOT_DETECTED لا DETERMINISTIC) —
  // فالتغيير هنا لا يظهر كحرف مختلف في *هذه* العيّنة تحديداً، لكنه ليس
  // عديم الأثر بنيوياً؛ فحوص أخرى بلا بوّابة فائزة قد تتأثّر حرفياً.
  eq(
      JSON.stringify({letterSource: s10.letterSource, measuredCategoriesMean: s10.measuredCategoriesMean, letter: s10.letter}),
      JSON.stringify({letterSource: 'GATE:ROOT_DETECTED', measuredCategoriesMean: 93.58974358974359, letter: 'C'}),
      'b45c8cf6: الثلاثي letterSource=GATE:ROOT_DETECTED + measuredCategoriesMean=93.58974358974359 + letter=C معاً في تأكيد واحد',
  );
  const rootGate = s10.gatesApplied.find((g) => g.name === 'ROOT_DETECTED');
  const patchGate = s10.gatesApplied.find((g) => g.name === 'PATCH_AGE');
  ok(rootGate && rootGate.status === 'FIRED' && rootGate.cappedOverall === true,
      'b45c8cf6: ROOT_DETECTED FIRED وcappedOverall=true — هي الحاكمة فعلياً');
  ok(patchGate && patchGate.status === 'FIRED' && patchGate.cappedOverall === false,
      'b45c8cf6: PATCH_AGE FIRED أيضاً لكن cappedOverall=false — أُطلقت بلا أثر (الرتبة أسوأ من سقفها أصلاً)');
}
console.log(`تحقّق letterSource: b45c8cf6 → letterSource=${s10Result.overall.letterSource} ` +
    `measuredCategoriesMean=${s10Result.overall.measuredCategoriesMean} letter=${s10Result.overall.letter}`);

// ═══════════════════════════════════════════════════════════════════════
// A97 #1 — مفتاح غير معروف في params: خطأ صريح، لا تجاهل صامت
// ═══════════════════════════════════════════════════════════════════════
{
  let threw = false;
  try {
    computeCategoryStates({
      functionalResults: [], manualResults: [],
      batterySampleInputs: null, batteryDesignCapacityMah: null,
      unknownField: 'x', // ← ليست في ALLOWED_PARAM_KEYS
    });
  } catch (e) {
    threw = true;
    ok(/unknownField/.test(e.message), 'رسالة الخطأ تذكر اسم المفتاح المجهول بالضبط');
  }
  ok(threw, 'A97 #1: مفتاح غير معروف في params يرمي خطأً صريحاً — لا تجاهلاً صامتاً');
}
console.log('تحقّق A97 #1: مفتاح params غير معروف → رمي صريح');

// ═══════════════════════════════════════════════════════════════════════
// A97 #2/#3 + القرار ١٢ — تفصيل إضافي على فرع HARNESS_ERROR (Honor)
// ═══════════════════════════════════════════════════════════════════════
{
  eq(honorResult.overall.harnessError, true, 'Honor: overall.harnessError=true (A97 #2 — يظهر في overall)');
  eq(honorResult.overall.harnessErrorReason, 'FUNCTIONAL_RESULTS_UNAVAILABLE', 'Honor: سبب مُسمّى، لا غامض');
  eq(Object.keys(honorResult.categories).length, 15, 'Honor: كل الفئات الـ15 حاضرة حتى في فرع HARNESS_ERROR — لا إسقاط');
  for (const cat of CATEGORIES) {
    if (cat === 'battery') continue;
    eq(honorResult.categories[cat].state, 'HARNESS_ERROR', `Honor/${cat}: state=HARNESS_ERROR (لا UNMEASURED)`);
    eq(honorResult.categories[cat].reason, 'HARNESS_ERROR', `Honor/${cat}: reason مُسمّى على مستوى الفئة أيضاً`);
  }
  // البطارية استثناء — لا تعتمد على functionalResults، تبقى محسوبة فعلياً
  // من العيّنات الخام (samples حقيقية لـHonor متاحة في هذا المستودع).
  ok(honorResult.categories.battery.state !== 'HARNESS_ERROR',
      'Honor: البطارية ليست HARNESS_ERROR — العيّنات الخام حقيقية ومستقلّة عن functionalResults');
  ok(honorResult.categories.battery.batteryIndicators &&
      Object.keys(honorResult.categories.battery.batteryIndicators).length === 4,
  'Honor: أربعة مؤشّرات بطارية محسوبة فعلياً رغم harnessError على البقيّة');
  eq(honorResult.testResults.length, 0, 'Honor: لا ثلاثيات TestResult آلية ممكنة (functionalResults=null)');
  ok(honorResult.issues.some((i) => i.id === 'DISC-HARNESS_ERROR'), 'Honor: عطب مُعلَن بمعرّف ثابت DISC-HARNESS_ERROR');
}
console.log('تحقّق A97 #2/#3 + القرار ١٢: فرع HARNESS_ERROR كامل على Honor — battery مستثناة، 15/15 فئة حاضرة');

// ═══════════════════════════════════════════════════════════════════════
// [اصطناعي] noDataAtAll — لا فِخّ ذهبي حقيقي له بعد القرار ١٢ (الحالتان
// 8909e850/e4b65a2f كلتاهما 404 حقيقي، لا "جلب ناجح بصفر نتيجة" — راجع
// تعليق رأس الملف). يُبقي تغطية اختبار على مسار "لم يُقَس" (الجلب نجح
// فعلاً، صفر فئة MEASURED) منفصلاً عن "تعذّر التجهيز" — بصمات Honor
// الحقيقية + functionalResults=[] (لا null) صراحةً.
// ═══════════════════════════════════════════════════════════════════════
{
  const syntheticNoData = computeCategoryStates({
    functionalResults: [], // جلب ناجح، صفر اختبار مُعلَن — يختلف عن null
    manualResults: [],
    batterySampleInputs: honorInputs.sampleInputs,
    batteryDesignCapacityMah: honorInputs.design,
  });
  eq(syntheticNoData.overall.harnessError, false, '[اصطناعي] functionalResults=[]: ليست HARNESS_ERROR');
  eq(syntheticNoData.overall.noDataAtAll, true, '[اصطناعي] صفر فئة MEASURED فعلاً → noDataAtAll=true');
  eq(syntheticNoData.overall.letter, null, '[اصطناعي] لا حرف بلا بيانات إطلاقاً');
  ok(typeof syntheticNoData.overall.coverage === 'number', '[اصطناعي] overall.coverage رقم فعلي (0 على الأرجح) — لا null');
  eq(syntheticNoData.categories.thermal.state, 'UNMEASURED', '[اصطناعي] الفئات UNMEASURED هنا لا HARNESS_ERROR (الجلب نجح، فقط صفر نتيجة)');
}
console.log('[اصطناعي] noDataAtAll يبقى مساراً مختلفاً عن HARNESS_ERROR — مُختبَر بمُدخل يدوي لا فِخّ حقيقي');

// ═══════════════════════════════════════════════════════════════════════
// أمر المهمّة 2026-09-22 +03 (البند الثاني) — computeLowCategoryCoverageGate
// تُصدِّر الآن belowThreshold/allNonMeasurement (بجانب source التقني
// الموجود) كي تبنيَ buildDisplayShapeV7.js نصّ العرض البشري **بلا إعادة
// حساب مستقلّة** (القاعدة 24). أربع حالات حقيقية على b45c8cf6 (لا اصطناع):
//   thermal  executed=0                → null/null (الفرع المبكر)
//   cpu      NOT_FIRED (100%، يتضمّن MEASUREMENT) → false/false
//   gpu      FIRED (40%<60% وكلّها STATE)          → true/true
//   display  FIRED (100% لكن كلّها STATE)           → false/true
//
// ⚠️ **استُبدل لا أُضيف (القاعدة 23)** — أمر مستخدم 2026-09-23 +03 (البند
// ب): كان هذا القسم يُثبت أن thermal (executed=0، الفئة غير مقيسة أصلاً)
// تحمل status='NOT_FIRED' — وهو بالضبط السلوك الخاطئ الذي بُني عليه
// القرار (البرومبت كان يقرأ NOT_FIRED "قِيست ببيانات كافية" على فئة لم
// يُنفَّذ فيها اختبار واحد). status الصحيح الآن INPUT_ABSENT — لا يُبقى
// اختبار قديم يحرس القيمة الخاطئة (لو أُعيد له NOT_FIRED خطأً لاحقاً
// كان سيبدو نجاحاً).
// ═══════════════════════════════════════════════════════════════════════
{
  const thermalGate = s10Result.overall.gatesApplied.find(
      (g) => g.name === 'LOW_CATEGORY_COVERAGE' && g.category === 'thermal');
  ok(!!thermalGate, 'إعداد: بوّابة LOW_CATEGORY_COVERAGE لِـ thermal حاضرة في overall.gatesApplied');
  eq(thermalGate.status, 'INPUT_ABSENT', 'S10/thermal: executed=0 → INPUT_ABSENT (الفئة لم تُقَس أصلاً — لا "قِيست ولم يتحقّق الشرط")');
  eq(thermalGate.belowThreshold, null, 'S10/thermal: belowThreshold=null صراحةً (الفرع المبكر، لا undefined — القاعدة 22)');
  eq(thermalGate.allNonMeasurement, null, 'S10/thermal: allNonMeasurement=null صراحةً لنفس السبب');

  const cpuGate = s10Result.categories.cpu.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE');
  eq(cpuGate.status, 'NOT_FIRED', 'S10/cpu: تغطية 100% وتتضمّن MEASUREMENT → NOT_FIRED');
  eq(cpuGate.belowThreshold, false, 'S10/cpu: belowThreshold=false (100% ≥ 60%)');
  eq(cpuGate.allNonMeasurement, false, 'S10/cpu: allNonMeasurement=false (توجد اختبارات MEASUREMENT فعلية)');

  const gpuGate = s10Result.categories.gpu.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE');
  eq(gpuGate.status, 'FIRED', 'S10/gpu: FIRED (كلا الشرطين)');
  eq(gpuGate.belowThreshold, true, 'S10/gpu: belowThreshold=true (40% < 60%)');
  eq(gpuGate.allNonMeasurement, true, 'S10/gpu: allNonMeasurement=true (2/2 STATE)');
  eq(gpuGate.cappedThisLetter, true, 'S10/gpu: cappedThisLetter=true — letter الأساسي (فوق B) سُقِّف فعلاً');

  const displayGate = s10Result.categories.display.gatesApplied.find((g) => g.name === 'LOW_CATEGORY_COVERAGE');
  eq(displayGate.status, 'FIRED', 'S10/display: FIRED (allNonMeasurement فقط — التغطية 100% كافية)');
  eq(displayGate.belowThreshold, false, 'S10/display: belowThreshold=false (100% ≥ 60% — ليست "تغطية منخفضة")');
  eq(displayGate.allNonMeasurement, true, 'S10/display: allNonMeasurement=true (3/3 STATE رغم اكتمال التغطية)');
}
console.log('تحقّق إضافي [أمر 2026-09-22 +03، البند ٢]: computeLowCategoryCoverageGate.belowThreshold/allNonMeasurement — أربع حالات حقيقية (null/null، false/false، true/true، false/true)');

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-09-23 +03 (القرار ب — INPUT_ABSENT) — القاعدة 30: كل
// قارئ لـstatus يُختبَر بالقيم كلّها، لا بقيمة واحدة. classifySec04RootDetected
// (الآن _internal) — سبع مُدخلات: الستّ الممكنة من TestStatus (NeuralChek،
// منقول لا مُتحقَّق منه من هذا المستودع) + غياب الكائن كلّياً.
// ═══════════════════════════════════════════════════════════════════════
{
  const {classifySec04RootDetected} = require('../src/analysis/categoryStates')._internal;

  eq(classifySec04RootDetected(null).status, 'INPUT_ABSENT', '[القرار ب] SEC-04 غائب كلّياً → INPUT_ABSENT');
  eq(classifySec04RootDetected({status: 'fail'}).status, 'FIRED', "[القرار ب] status='fail' → FIRED (جذر مكتشَف)");
  eq(classifySec04RootDetected({status: 'pass'}).status, 'NOT_FIRED', "[القرار ب] status='pass' → NOT_FIRED (قِيس، لا جذر)");
  eq(classifySec04RootDetected({status: 'unavailable'}).status, 'INPUT_ABSENT', "[القرار ب] status='unavailable' → INPUT_ABSENT (تعذّر التنفيذ — لا قياس، لا NOT_FIRED كما كان)");
  eq(classifySec04RootDetected({status: 'not_tested'}).status, 'INPUT_ABSENT', "[القرار ب] status='not_tested' → INPUT_ABSENT");
  eq(classifySec04RootDetected({status: 'error'}).status, 'INPUT_ABSENT', "[القرار ب] status='error' → INPUT_ABSENT");
  eq(classifySec04RootDetected({status: 'warning'}).status, 'INPUT_ABSENT',
      "[القرار ب][غير محسوم بدليل، قرار مُعلَن] status='warning' → INPUT_ABSENT — SecurityTests.kt (منقول) لا يُصدرها لهذا الاختبار حالياً، فلا مثال حقيقي؛ اختيرت لأن 'warning' لا تُثبت وجود جذر ولا غيابه (القاعدة 22)");
  eq(classifySec04RootDetected({status: 'RandomUnknownText'}).status, 'INPUT_ABSENT', '[القرار ب] نصّ غير معروف كلّياً (السابع) → INPUT_ABSENT، لا افتراض');
  // حساسية الأحرف — منقول: kotlin يرسل بأحرف صغيرة دائماً (status.name.lowercase())،
  // لكن التصنيف هنا يقارن case-insensitive دفاعاً في العمق (نفس أسلوب الكود الأصلي).
  eq(classifySec04RootDetected({status: 'FAIL'}).status, 'FIRED', '[دفاع في العمق] حساسية الأحرف — FAIL بأحرف كبيرة تُصنَّف FIRED أيضاً');

  ok(classifySec04RootDetected({status: 'fail'}).source.includes('fail'), '[القرار ب] source يذكر القيمة الخام دائماً — لا نصّاً معمَّى');
  ok(classifySec04RootDetected({status: 'warning'}).source.includes('warning'), '[القرار ب] source لـwarning يذكر القيمة + توضيح القرار (لا صمت)');
}
console.log('تحقّق [القرار ب]: classifySec04RootDetected — سبعة مُدخلات (الستّ الممكنة + الغياب الكامل)، كلّها مُصنَّفة صراحةً');

// ═══════════════════════════════════════════════════════════════════════
// فحص القيم الفعلية لـSEC-04/SEC-03 في fixtures/golden (مطلوب صراحةً) —
// الفِخّان الوحيدان بـfunctionalResults حقيقية في هذا المستودع.
// ═══════════════════════════════════════════════════════════════════════
{
  for (const [label, functional] of [['b45c8cf6', s10Functional]]) {
    const sec04 = functional.find((r) => r.testId === 'SEC-04');
    const sec03 = functional.find((r) => r.testId === 'SEC-03');
    ok(sec04 && sec04.status === 'fail', `[فحص القيم الفعلية] ${label}: SEC-04.status='fail' فعلياً (لا 'unavailable'/غيرها)`);
    ok(sec03 && sec03.status === 'pass', `[فحص القيم الفعلية] ${label}: SEC-03.status='pass' فعلياً`);
  }
  console.log('[فحص القيم الفعلية] b45c8cf6: SEC-04=fail، SEC-03=pass — لا مثال حقيقي في هذا المستودع لـunavailable/not_tested/error/warning على هذين الاختبارين تحديداً (مُسجَّل لا مُخترَع)');
}

// ═══════════════════════════════════════════════════════════════════════
// PATCH_AGE — rawValue="N/A" مع status="unavailable" (كما يصل فعلياً من
// SecurityTests.kt عند استثناء، منقول) — هل يصل فرع INPUT_ABSENT (كان
// "unparseable")؟ بالقراءة (new Date("N/A") = Invalid Date) والتشغيل معاً.
// ═══════════════════════════════════════════════════════════════════════
{
  const gates = require('../src/analysis/categoryStates')._internal.computeGates({
    functionalByTestId: {'SEC-03': {testId: 'SEC-03', status: 'unavailable', rawValue: 'N/A'}},
    findings: null, byCategory: null,
  });
  const patchGate = gates.find((g) => g.name === 'PATCH_AGE');
  eq(patchGate.status, 'INPUT_ABSENT', '[فحص PATCH_AGE][بالتشغيل] rawValue="N/A"+status="unavailable" → INPUT_ABSENT (لا NOT_FIRED كما كان)، بلا حاجة لفحص .status صراحةً — القيمة غير القابلة للتحليل كافية');
  eq(patchGate.source, 'SEC-03 absent/unparseable', '[فحص PATCH_AGE] نصّ source الأصلي بلا تغيير — الحالة نفسها، الاسم فقط تغيّر');
}
console.log('تحقّق PATCH_AGE: rawValue="N/A"+status="unavailable" يصل INPUT_ABSENT فعلاً — مُتحقَّق بالتشغيل لا بالقراءة وحدها');

// ═══════════════════════════════════════════════════════════════════════
// INPUT_ABSENT لا تُسقِف حرفاً (نفس ضمان NOT_FIRED/DISABLED/NOT_WIRED —
// applyCeilings/applyOverallCeilings قائمة بيضاء لـFIRED وحدها).
// ═══════════════════════════════════════════════════════════════════════
{
  const {applyCeilings, applyOverallCeilings} = require('../src/analysis/categoryStates')._internal;
  const inputAbsentGate = {name: 'ROOT_DETECTED', category: 'security', ceilingLetter: 'C', status: 'INPUT_ABSENT', source: 'test'};

  const catResult = applyCeilings('A', 'security', [inputAbsentGate]);
  eq(catResult.letter, 'A', '[القرار ب] applyCeilings: بوّابة INPUT_ABSENT لا تُسقِف حرف الفئة (يبقى A)');
  eq(catResult.gatesApplied[0].cappedThisLetter, false, '[القرار ب] cappedThisLetter=false لبوّابة INPUT_ABSENT — لم تُسقِّف');

  const overallResult = applyOverallCeilings('A', [inputAbsentGate]);
  eq(overallResult.letter, 'A', '[القرار ب] applyOverallCeilings: بوّابة INPUT_ABSENT لا تُسقِف الحرف العامّ (يبقى A)');
  eq(overallResult.gatesApplied[0].cappedOverall, false, '[القرار ب] cappedOverall=false لبوّابة INPUT_ABSENT');
}
console.log('تحقّق [القرار ب]: INPUT_ABSENT لا تُسقِف حرفاً — لا على مستوى الفئة ولا overall (قائمة بيضاء FIRED وحدها، بلا تعديل كود لزم)');

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-09-24 +03 (القرار ٨٦ البند ١) — N-10 fail لا ينزل بحرف
// wireless. نصّ الأمر: "اختبار: مُدخل فيه N-10 = fail يُنتج
// ENVIRONMENT_UNSUITABLE، ولا ينزل به حرف wireless." مسار كامل
// (functionalResults → toTestResult → computeCategoryFromTests)، لا وحدة
// toTestResult وحدها (القاعدة 30) — b45c8cf6 الحقيقي معدَّل بحقل واحد فقط
// (N-10.status: 'pass'→'fail')، وباقي الفحص كما وصل فعلاً.
// ═══════════════════════════════════════════════════════════════════════
{
  ok(s10Functional.find((r) => r.testId === 'N-10').status === 'pass',
      '[إعداد][القرار ٨٦-١] الفخّ الحقيقي: N-10.status=\'pass\' فعلياً — التعديل أدناه اصطناعي بحقل واحد');
  const s10WithN10Fail = s10Functional.map((r) =>
    r.testId === 'N-10' ? Object.assign({}, r, {status: 'fail'}) : r);

  const baselineWireless = s10Result.categories.wireless;
  const csN10Fail = computeCategoryStates({
    functionalResults: s10WithN10Fail, manualResults: [],
    batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
    analyzedAtMs: FIXED_ANALYZED_AT_MS,
  });
  const wirelessWithFail = csN10Fail.categories.wireless;

  eq(wirelessWithFail.deterministicLetter, baselineWireless.deterministicLetter,
      `[القرار ٨٦-١] wireless.deterministicLetter مطابق قبل/بعد N-10→fail (كلاهما "${baselineWireless.deterministicLetter}") — لا سقوط إلى D`);
  ok(wirelessWithFail.deterministicLetter !== 'D',
      '[القرار ٨٦-١] wireless.deterministicLetter ليس D — لولا الإصلاح كان STATE_FAIL_FLOOR سيفرض D هنا');
  eq(wirelessWithFail.floorApplied, baselineWireless.floorApplied,
      '[القرار ٨٦-١] floorApplied مطابق قبل/بعد (STATE_FAIL_FLOOR لا يُطلَق من N-10=fail)');
  eq(wirelessWithFail.failCount, 0,
      '[القرار ٨٦-١] wireless.failCount=0 — N-10=fail لا يدخل executed أصلاً (outcome=NOT_MEASURED)');
  eq(wirelessWithFail.executedCount, baselineWireless.executedCount - 1,
      '[القرار ٨٦-١] wireless.executedCount ينقص بواحد بالضبط (N-10 وحدها خرجت من executed)');

  const n10tr = csN10Fail.testResults.find((t) => t.testId === 'N-10');
  ok(!!n10tr, '[القرار ٨٦-١] N-10 حاضر في testResults رغم NOT_MEASURED (لا إسقاط صامت)');
  eq(n10tr.outcome, 'NOT_MEASURED', '[القرار ٨٦-١] N-10 (عبر المسار الكامل): outcome=NOT_MEASURED');
  eq(n10tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[القرار ٨٦-١] N-10 (عبر المسار الكامل): notMeasuredReason=ENVIRONMENT_UNSUITABLE');
}
console.log('تحقّق [القرار ٨٦-١]: N-10=fail عبر المسار الكامل — wireless.deterministicLetter بلا تغيير، لا STATE_FAIL_FLOOR');

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-09-25 +03 (القرار ٨٦ البند ١، الالتزام الثاني) — نفس
// اختبار N-10 أعلاه، على N-05 (فئة cellular) — منقول من تقرير مدقّق على
// NeuralChek@b3e46cf (مستودع آخر، غير مُتحقَّق من هذا المستودع، القاعدة
// 27/29): "التطبيق يرسل fail حين level==0 (NetworkTests.kt:172-176)."
// ═══════════════════════════════════════════════════════════════════════
{
  ok(s10Functional.find((r) => r.testId === 'N-05').status === 'pass',
      '[إعداد][القرار ٨٦-١] الفخّ الحقيقي: N-05.status=\'pass\' فعلياً — التعديل أدناه اصطناعي بحقل واحد');
  const s10WithN05Fail = s10Functional.map((r) =>
    r.testId === 'N-05' ? Object.assign({}, r, {status: 'fail'}) : r);

  const baselineCellular = s10Result.categories.cellular;
  const csN05Fail = computeCategoryStates({
    functionalResults: s10WithN05Fail, manualResults: [],
    batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
    analyzedAtMs: FIXED_ANALYZED_AT_MS,
  });
  const cellularWithFail = csN05Fail.categories.cellular;

  eq(cellularWithFail.deterministicLetter, baselineCellular.deterministicLetter,
      `[القرار ٨٦-١] cellular.deterministicLetter مطابق قبل/بعد N-05→fail (كلاهما "${baselineCellular.deterministicLetter}") — لا سقوط إلى D`);
  ok(cellularWithFail.deterministicLetter !== 'D',
      '[القرار ٨٦-١] cellular.deterministicLetter ليس D — لولا الإصلاح كان STATE_FAIL_FLOOR سيفرض D هنا');
  eq(cellularWithFail.floorApplied, baselineCellular.floorApplied,
      '[القرار ٨٦-١] floorApplied مطابق قبل/بعد (STATE_FAIL_FLOOR لا يُطلَق من N-05=fail)');
  eq(cellularWithFail.failCount, 0,
      '[القرار ٨٦-١] cellular.failCount=0 — N-05=fail لا يدخل executed أصلاً (outcome=NOT_MEASURED)');
  eq(cellularWithFail.executedCount, baselineCellular.executedCount - 1,
      '[القرار ٨٦-١] cellular.executedCount ينقص بواحد بالضبط (N-05 وحدها خرجت من executed)');

  const n05tr = csN05Fail.testResults.find((t) => t.testId === 'N-05');
  ok(!!n05tr, '[القرار ٨٦-١] N-05 حاضر في testResults رغم NOT_MEASURED (لا إسقاط صامت)');
  eq(n05tr.outcome, 'NOT_MEASURED', '[القرار ٨٦-١] N-05 (عبر المسار الكامل): outcome=NOT_MEASURED');
  eq(n05tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[القرار ٨٦-١] N-05 (عبر المسار الكامل): notMeasuredReason=ENVIRONMENT_UNSUITABLE');
}
console.log('تحقّق [القرار ٨٦-١]: N-05=fail عبر المسار الكامل — cellular.deterministicLetter بلا تغيير، لا STATE_FAIL_FLOOR');

// ═══════════════════════════════════════════════════════════════════════
// أمر مستخدم 2026-09-25 +03 (القرار ٨٧ البند ١، بندَين — الأصلي والتتمّة)
// — يحلّ محلّ القرار ٨٦-١ الجزئي: N-06 (cellular)، N-08 (wireless)، L-02/
// L-03 (gps، "كل الفروع")، SN-08 (sensors، تتمّة لاحقة) تنضمّ إلى N-10/
// N-05. نفس نمط الاختبار الكامل أعلاه (القاعدة 30)، بحلقة واحدة تغطّي
// عشر توليفات (خمسة معرِّفات × fail/warning) بدل تكرار نفس الكتلة عشر
// مرّات — لا فرق منطقي بينها، والتكرار الحرفي كان سيُخفي الفرق الوحيد
// الفعلي (اسم المعرِّف/الفئة/حالته الأصلية) خلف حجم النصّ.
//
// L-02/L-03/SN-08: باختلاف عن N-06/N-08/N-10/N-05 (كانت pass أصلاً فتدخل
// executed) — هذه الثلاثة **خارج executed أصلاً** في الفخّ الحقيقي
// (L-02/L-03: not_tested/PERMISSION_DENIED؛ SN-08: unavailable) —
// executedCount **لا يتغيّر** حين تصير fail/warning (كانت غائبة عن
// executed، وتبقى غائبة بسبب آخر). الفرق الحقيقي المُختبَر هنا
// outcome/notMeasuredReason على TestResult نفسها، لا عدّاد executed.
// ═══════════════════════════════════════════════════════════════════════
{
  const CASES = [
    {testId: 'N-06', category: 'cellular', originalStatus: 'pass', wasExecutedBeforeFlip: true, flipStatuses: ['fail', 'warning']},
    {testId: 'N-08', category: 'wireless', originalStatus: 'pass', wasExecutedBeforeFlip: true, flipStatuses: ['fail', 'warning']},
    {testId: 'L-02', category: 'gps', originalStatus: 'not_tested', wasExecutedBeforeFlip: false, flipStatuses: ['fail', 'warning']},
    {testId: 'L-03', category: 'gps', originalStatus: 'not_tested', wasExecutedBeforeFlip: false, flipStatuses: ['fail', 'warning']},
    {testId: 'SN-08', category: 'sensors', originalStatus: 'unavailable', wasExecutedBeforeFlip: false, flipStatuses: ['fail', 'warning']},
    // القرار ٨٨ البند ١ — SN-03/SN-09: warning فقط (لا فرع fail حقيقي، حكم
    // مدقّق منقول: "لا فرع fail في testSensor، والوحيد في الملفّ لـSN-13")
    // — بخلاف الخمسة أعلاه حيث طُلب فرع fail دفاعي رغم غياب مُنتِج حقيقي.
    {testId: 'SN-03', category: 'sensors', originalStatus: 'pass', wasExecutedBeforeFlip: true, flipStatuses: ['warning']},
    {testId: 'SN-09', category: 'sensors', originalStatus: 'unavailable', wasExecutedBeforeFlip: false, flipStatuses: ['warning']},
  ];
  for (const {testId, category, originalStatus: expectedOriginalStatus, wasExecutedBeforeFlip, flipStatuses} of CASES) {
    const originalStatus = s10Functional.find((r) => r.testId === testId).status;
    eq(originalStatus, expectedOriginalStatus,
        `[إعداد][القرار ٨٧-١] الفخّ الحقيقي: ${testId}.status='${expectedOriginalStatus}' فعلياً` +
        (wasExecutedBeforeFlip ? '' : ' (خارج executed أصلاً، سبب مختلف عن ENVIRONMENT_UNSUITABLE)'));
    const baseline = s10Result.categories[category];

    for (const flipStatus of flipStatuses) {
      const modified = s10Functional.map((r) =>
        r.testId === testId ? Object.assign({}, r, {status: flipStatus}) : r);
      const cs = computeCategoryStates({
        functionalResults: modified, manualResults: [],
        batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
        analyzedAtMs: FIXED_ANALYZED_AT_MS,
      });
      const catAfter = cs.categories[category];

      eq(catAfter.deterministicLetter, baseline.deterministicLetter,
          `[القرار ٨٧-١] ${category}.deterministicLetter مطابق قبل/بعد ${testId}→${flipStatus} (كلاهما "${baseline.deterministicLetter}")`);
      ok(catAfter.deterministicLetter !== 'D',
          `[القرار ٨٧-١] ${category}.deterministicLetter ليس D بعد ${testId}→${flipStatus}`);
      eq(catAfter.floorApplied, baseline.floorApplied,
          `[القرار ٨٧-١] ${category}.floorApplied مطابق قبل/بعد ${testId}→${flipStatus} (لا STATE_FAIL_FLOOR/CEILING من هذا المعرِّف)`);
      if (wasExecutedBeforeFlip) {
        eq(catAfter.executedCount, baseline.executedCount - 1,
            `[القرار ٨٧-١] ${category}.executedCount ينقص بواحد بالضبط (${testId} وحدها خرجت من executed، ${flipStatus})`);
      } else {
        eq(catAfter.executedCount, baseline.executedCount,
            `[القرار ٨٧-١] ${category}.executedCount بلا تغيير (${testId} كانت خارج executed أصلاً — not_tested)`);
      }

      const tr = cs.testResults.find((t) => t.testId === testId);
      ok(!!tr, `[القرار ٨٧-١] ${testId} حاضر في testResults (${flipStatus}) — لا إسقاط صامت`);
      eq(tr.outcome, 'NOT_MEASURED', `[القرار ٨٧-١] ${testId} (${flipStatus}، عبر المسار الكامل): outcome=NOT_MEASURED`);
      eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', `[القرار ٨٧-١] ${testId} (${flipStatus}، عبر المسار الكامل): notMeasuredReason=ENVIRONMENT_UNSUITABLE`);
    }
  }
}
console.log('تحقّق [القرار ٨٧-١/٨٨-١]: N-06/N-08/L-02/L-03/SN-08 (fail وwarning) + SN-03/SN-09 (warning فقط) عبر المسار الكامل — لا سقوط حرف في أيّ فئة');

// ═══════════════════════════════════════════════════════════════════════
// «الإعدادات لا تُنزل الحرف» — أمر مستخدم 2026-09-27 +03، موافق عليه.
// الاختبارات الأربعة المطلوبة صراحة، بمُدخلات مشتقّة من الفخّ الحقيقي
// (b45c8cf6) عبر computeCategoryStates الكامل (القاعدة 30 — ما يُنتجه
// القارئ الفعلي، لا وصول القيمة إلى toTestResult وحدها).
// ═══════════════════════════════════════════════════════════════════════
{
  function computeWithOverrides(overrides) {
    const modified = s10Functional.map((r) =>
      overrides[r.testId] ? Object.assign({}, r, {status: overrides[r.testId]}) : r);
    return computeCategoryStates({
      functionalResults: modified, manualResults: [],
      batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
      analyzedAtMs: FIXED_ANALYZED_AT_MS,
    });
  }

  // ── ١ — SEC-01 warning لا يُسقف الأمان ──────────────────────────────
  // مع SEC-04 (الجذر) fail كما في الفخّ: security تبقى D — SEC-01 لا
  // يضيف شيئاً (D أصلاً أسوأ من أي سقف). الإثبات الحاسم: بإزالة الجذر
  // (SEC-04→pass) أيضاً، السقف يبقى B (PATCH_AGE) — **نفس B تماماً** سواء
  // كان SEC-01=pass أو warning — لو كان SEC-01 لا يزال يحمل الصحّة لكان
  // warning قد فرض STATE_WARNING_CEILING=C، فيصير B (PATCH_AGE) مقموعاً
  // بسقف أسوأ. تطابق B=B هو الدليل على أن SEC-01 لا يدخل السقف إطلاقاً.
  const sec01WithRoot = computeWithOverrides({'SEC-01': 'warning'});
  eq(sec01WithRoot.categories.security.deterministicLetter, 'D',
      '[أمر 2026-09-27] SEC-01=warning (مع SEC-04=fail): security تبقى D — SEC-01 لا يضيف أثراً');
  eq(sec01WithRoot.categories.security.floorApplied, 'STATE_FAIL_FLOOR',
      '[أمر 2026-09-27] السبب STATE_FAIL_FLOOR من SEC-04 وحدها — لا مساهمة من SEC-01');

  const noRootBaseline = computeWithOverrides({'SEC-04': 'pass'});
  const noRootSec01Warning = computeWithOverrides({'SEC-04': 'pass', 'SEC-01': 'warning'});
  eq(noRootBaseline.categories.security.deterministicLetter, 'B',
      '[إعداد][أمر 2026-09-27] بلا جذر (SEC-04=pass)، SEC-01=pass كما في الفخّ: security=B (سقف PATCH_AGE)');
  eq(noRootSec01Warning.categories.security.deterministicLetter, 'B',
      '[أمر 2026-09-27][الإثبات الحاسم] بلا جذر + SEC-01=warning: security **لا تزال B** — لولا الاستبعاد لهبطت إلى C (STATE_WARNING_CEILING)');
  ok(!noRootSec01Warning.categories.security.gatesApplied.some((g) => g.name === 'LOW_CATEGORY_COVERAGE' && g.cappedThisLetter && g.ceilingLetter !== 'B'),
      '[أمر 2026-09-27] لا بوّابة أخرى فرضت سقفاً غير B');
  const sec01Tr = sec01WithRoot.testResults.find((t) => t.testId === 'SEC-01');
  eq(sec01Tr.outcome, 'WARNING', '[أمر 2026-09-27] SEC-01.outcome=WARNING فعلياً (لم يُحوَّل)');
  eq(sec01Tr.healthBearing, false, '[أمر 2026-09-27] SEC-01.healthBearing=false');
  eq(sec01Tr.entersGrade, false, '[أمر 2026-09-27] SEC-01.entersGrade=false');
  console.log('تحقّق ١ [أمر 2026-09-27]: SEC-01 warning لا يُسقف الأمان — أثبتته حالة "بلا جذر" (B=B سواء pass أو warning)');

  // ── ٢ — L-01 fail لا يفرض D على gps ──────────────────────────────────
  const l01Fail = computeWithOverrides({'L-01': 'fail'});
  eq(l01Fail.categories.gps.deterministicLetter, null,
      '[أمر 2026-09-27] L-01=fail: gps.deterministicLetter=null (UNMEASURED) — ليس D');
  ok(l01Fail.categories.gps.deterministicLetter !== 'D',
      '[أمر 2026-09-27] تأكيد صريح: gps ليست D بعد L-01=fail');
  eq(l01Fail.categories.gps.state, 'UNMEASURED',
      '[أمر 2026-09-27] gps.state=UNMEASURED — L-01 كانت الاختبار الوحيد المنفَّذ، واستبعادها يُفرغ executed تماماً');
  const l01Tr = l01Fail.testResults.find((t) => t.testId === 'L-01');
  eq(l01Tr.outcome, 'FAIL', '[أمر 2026-09-27] L-01.outcome=FAIL فعلياً (لم يُحوَّل)');
  eq(l01Tr.healthBearing, false, '[أمر 2026-09-27] L-01.healthBearing=false');
  console.log('تحقّق ٢ [أمر 2026-09-27]: L-01 fail لا يفرض D على gps — تصبح UNMEASURED (لا حرف أصلاً) لا D');

  // ── ٣ — S-02 fail لا يُنزل التخزين ───────────────────────────────────
  const s02Fail = computeWithOverrides({'S-02': 'fail'});
  eq(s02Fail.categories.storage.deterministicLetter, 'B',
      '[أمر 2026-09-27] S-02=fail: storage تبقى B — بلا تغيير عن الفخّ الحقيقي (S-02=pass)');
  eq(s02Fail.categories.storage.state, 'MEASURED', '[أمر 2026-09-27] storage.state=MEASURED كما كانت');
  const s02Tr = s02Fail.testResults.find((t) => t.testId === 'S-02');
  eq(s02Tr.outcome, 'FAIL', '[أمر 2026-09-27] S-02.outcome=FAIL فعلياً (لم يُحوَّل)');
  eq(s02Tr.healthBearing, false, '[أمر 2026-09-27] S-02.healthBearing=false');
  console.log('تحقّق ٣ [أمر 2026-09-27]: S-02 fail لا يُنزل التخزين — تبقى B كما كانت بلا S-02');

  // ── ٤ — SEC-04 fail (الجذر، ضابط) ما زال يفرض D ─────────────────────
  const controlBaseline = computeWithOverrides({});
  eq(controlBaseline.categories.security.deterministicLetter, 'D',
      '[أمر 2026-09-27][ضابط] SEC-04 fail (الفخّ الحقيقي بلا أي تعديل): security=D كما كان قبل هذه المهمّة تماماً');
  eq(controlBaseline.categories.security.floorApplied, 'STATE_FAIL_FLOOR',
      '[أمر 2026-09-27][ضابط] floorApplied=STATE_FAIL_FLOOR من SEC-04');
  const sec04Tr = controlBaseline.testResults.find((t) => t.testId === 'SEC-04');
  eq(sec04Tr.healthBearing, true,
      '[أمر 2026-09-27][ضابط] SEC-04.healthBearing=true — خارج المجموعات الثلاث الجديدة تماماً، بلا تغيير');
  console.log('تحقّق ٤ [أمر 2026-09-27][ضابط]: SEC-04 fail ما زال يفرض D على الأمان — بلا تغيير');
}

// ─── harnessErrorDisplayMessage/HARNESS_ERROR_MESSAGE_AR — S3 (أمر مستخدم
// 2026-10-01 +03) صدّرتهما _internal "للاختبار المباشر بقيم غير معروفة
// أيضاً (القاعدة 30)" بلا أن يستعملهما أي اختبار فعلياً بعد — إضافة من
// هذه الجلسة (تصحيح النصّ، ملحق S-13) تسدّ الفجوة: كل فرع من الدالّة،
// بما فيها القيمة غير المعروفة (القاعدة 30 — لا فرع واحد وحسب).
{
  const {harnessErrorDisplayMessage, HARNESS_ERROR_MESSAGE_AR} = require('../src/analysis/categoryStates')._internal;
  eq(HARNESS_ERROR_MESSAGE_AR, 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص، وهذا ليس حكماً على الجهاز.',
      '[ملحق S-13] HARNESS_ERROR_MESSAGE_AR يطابق نصّ W6 الاحتياطي حرفياً (قراءة المنسّق لكلمة "يطابق")');
  eq(harnessErrorDisplayMessage('FUNCTIONAL_RESULTS_UNAVAILABLE'), HARNESS_ERROR_MESSAGE_AR,
      '[القاعدة 30] السبب المعروف الوحيد اليوم → الجملة الجاهزة');
  eq(harnessErrorDisplayMessage('SOME_FUTURE_REASON'), 'تعذّر تجهيز نتائج الاختبارات لهذا الفحص لسبب غير مُصنَّف.',
      '[القاعدة 30] سبب غير معروف → رسالة عامّة صادقة، لا تكرار نصّ السبب المعروف');
  eq(harnessErrorDisplayMessage(null), null, '[القاعدة 22/30] reason غائب (null) → null صراحةً، لا نصّ مُخمَّن');
  eq(harnessErrorDisplayMessage(undefined), null, '[القاعدة 22/30] reason=undefined → null صراحةً');
  console.log('تحقّق ٥: harnessErrorDisplayMessage/HARNESS_ERROR_MESSAGE_AR — كل فرع (معروف/غير معروف/غائب)، القاعدة 30');
}

console.log(`\ncategoryStates.test.js: ${n}/${n} assertions passed`);

module.exports = {s10Result, honorResult};
