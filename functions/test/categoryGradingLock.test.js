'use strict';

// categoryGradingLock.test.js — القرار ٤٤ (القاعدة 24، مهمّة 2026-09-21 +03).
// النصّ الحرفي من المستخدم: "NO_CALIBRATED_THRESHOLD و CATEGORY_GRADING_LOCKED
// حقيقة واحدة بمفردتين بلا مصدر يربطهما... وحّدهما على نمط pipelineTags.js:
// ثابت واحد مُصدَّر لسبب القفل، يستورده بانيا السطحين. واختبار يفشل إن ظهرت
// إحدى المفردتين حرفياً خارج الوحدة."
//
// المفردتان ليستا متطابقتين وظيفياً (نصّ المهمّة صراحةً): CATEGORY_GRADING_LOCKED_TEXT
// نصّ معروض (display.categories.battery.reason، إحالة بشرية "انظر batteryLayer.js")،
// CATEGORY_GRADING_LOCKED_CODE رمز يُقارَن برمجياً (audit.adjustments[].rejectedReason).
// هذا الاختبار يثبت: (1) القيمتان لم تتغيّرا حرفاً واحداً عمّا كانتا عليه قبل
// التوحيد، (2) السطحان الحقيقيان (categoryStates.js/buildV7Payload.js) يستهلكان
// الثابتين المستوردين فعلياً — لا اقتباساً نصياً معزولاً، (3) 0-ب: مسح آلي
// لـ functions/src بأكمله يفشل إن ظهرت إحدى القيمتين حرفياً في سطر غير تعليقي
// خارج categoryGradingLock.js — نفس منهج verifyReportV7Whitelist.test.js تحقّق
// 0-ب حرفياً (walk + إزالة تعليقات الكتلة + استبعاد السطر التعليقي الكامل +
// الجزء قبل أوّل // لاحق).
//
// Run: node functions/test/categoryGradingLock.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {CATEGORY_GRADING_LOCKED_CODE, CATEGORY_GRADING_LOCKED_TEXT} =
    require('../src/analysis/categoryGradingLock');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {applyV7Adjustments} = require('../src/analysis/buildV7Payload');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {
  _internal: {categoryAbsenceReason},
} = require('../src/analysis/buildDisplayShapeV7');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

(async () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 1. القيمتان لم تتغيّرا حرفاً واحداً — قفل على القيمة التاريخية نفسها
  //    (نفس مفردتَي buildDisplayShapeV7.test.js:146 وbuildV7Payload.test.js:339/344
  //    قبل هذه المهمّة — تحقَّق منهما بالأداة أعلاه، لا من الذاكرة).
  // ═══════════════════════════════════════════════════════════════════════
  eq(CATEGORY_GRADING_LOCKED_CODE, 'CATEGORY_GRADING_LOCKED',
      '[إعداد] الرمز لم يتغيّر عمّا كان حرفياً في buildV7Payload.js قبل التوحيد');
  eq(CATEGORY_GRADING_LOCKED_TEXT, 'NO_CALIBRATED_THRESHOLD (PLAN-03 لم يُنجَز — انظر batteryLayer.js)',
      '[إعداد] النصّ لم يتغيّر حرفاً واحداً عمّا كان حرفياً في categoryStates.js قبل التوحيد — قيمة معروضة، لا تُلمَس بلا قرار مستخدم (القرار ١/٧)');
  ok(CATEGORY_GRADING_LOCKED_CODE !== CATEGORY_GRADING_LOCKED_TEXT,
      '[تحذير المستخدم] المفردتان مختلفتان فعلياً (رمز مقابل نصّ معروض) — لا اختزال لأحدهما في الآخر');
  console.log('تحقّق 1: القيمتان التاريخيتان محفوظتان حرفياً في categoryGradingLock.js');

  // ═══════════════════════════════════════════════════════════════════════
  // 2. تشغيل فعلي على فِخّ S10 الحقيقي (b45c8cf6 — battery.state=PARTIAL،
  //    deterministicLetter=null، canGrade مُقفَل) — يثبت أن categoryStates.js
  //    وbuildV7Payload.js يكتبان فعلياً الثابتين المستوردين من الوحدة، لا
  //    سلسلة حرفية معزولة أُبقيت بالخطأ في أيٍّ منهما.
  // ═══════════════════════════════════════════════════════════════════════
  const s10Raw = loadJson('b45c8cf6.ts.json');
  const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
  const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const s10Fingerprint = {
    device: {model: 'SM-G977B'},
    timeSeries: s10Raw.timeSeries || s10Raw,
    functionalResults: s10Functional,
    manualResults: [],
  };
  const s10Findings = computeFindings(s10Fingerprint);
  const s10Battery = sampleInputsFromRaw(s10Fingerprint);
  const s10CategoryStates = computeCategoryStates({
    functionalResults: s10Functional,
    manualResults: [],
    dev: null,
    findings: s10Findings,
    batterySampleInputs: s10Battery.sampleInputs,
    batteryDesignCapacityMah: s10Battery.design,
  });

  eq(s10CategoryStates.categories.battery.state, 'PARTIAL', '[إعداد] battery.state=PARTIAL فعلياً على S10 (فِخّ معروف من buildV7Payload.test.js)');
  eq(s10CategoryStates.categories.battery.deterministicLetter, null, '[إعداد] battery.deterministicLetter=null فعلياً (canGrade مُقفَل)');

  // السطح الأوّل (categoryStates.js:noLetterReason) — تشغيل فعلي، لا اقتباس.
  eq(s10CategoryStates.categories.battery.noLetterReason, CATEGORY_GRADING_LOCKED_TEXT,
      '[سلسلة الكاتب][تشغيل فعلي] categoryStates.js يكتب noLetterReason من الثابت المستورَد CATEGORY_GRADING_LOCKED_TEXT فعلاً — لا سلسلة حرفية معزولة');

  // السطح الثاني (buildDisplayShapeV7.js:categoryAbsenceReason) — نفس النصّ
  // يصل display.categories.battery.reason عبر الدالّة الحقيقية، بلا تحويل.
  eq(categoryAbsenceReason(s10CategoryStates.categories.battery), CATEGORY_GRADING_LOCKED_TEXT,
      '[سلسلة الكاتب→القارئ][تشغيل فعلي] categoryAbsenceReason (buildDisplayShapeV7.js) يُعيد نفس نصّ CATEGORY_GRADING_LOCKED_TEXT — هذا ما يظهر في display.categories.battery.reason فعلياً');

  // السطح الثالث (buildV7Payload.js:applyV7Adjustments.rejectedReason) —
  // ⚠️ **استُبدل لا أُضيف (القاعدة 23)** — القرار ٨٨ البند ٣ (دليل التخفيض
  // يُربط بالفئة المخفَّضة نفسها): كان هذا القسم يستشهد بدليل من فئة أخرى
  // (security.deterministicLetter=D) على تخفيض battery — ذلك هو بالضبط
  // النمط الذي صار يُرفَض الآن *قبل* الوصول إلى فحص القفل أصلاً
  // (EVIDENCE_WRONG_CATEGORY يسبق CATEGORY_GRADING_LOCKED في ترتيب الفحص) —
  // فلم يعد هذا الدليل يبلغ فرع القفل إطلاقاً، ولم يعد يثبت ما ادّعى إثباته.
  // battery لا تحمل أي دليل "مُثبَت" حقيقي من فئتها هي على هذا الفِخّ (صفر
  // gatesApplied، كل B-* اختبارات PASS/INFO_ONLY — مُتحقَّق أدناه بالتشغيل
  // لا افتراضاً) — فدليل اصطناعي معلَّم صراحة (testResults[] إضافية بفئة
  // battery وoutcome=FAIL، بنفس أسلوب "فخّ مُهجَّن" المُستعمَل في
  // buildV7Payload.test.js لفرع HARNESS_ERROR) يُثبت أن القفل يبقى حاكماً
  // حتى مع دليل مُثبَت *من فئته هو*، لا لأن الدليل رُفض أصلاً لسبب آخر.
  ok(!s10CategoryStates.testResults.some((t) => t.category === 'battery' && t.outcome === 'FAIL'),
      '[إعداد] لا اختبار battery فعلي بـoutcome=FAIL على هذا الفِخّ — لا دليل مُثبَت حقيقي من فئة battery نفسها متاح، فالدليل أدناه اصطناعي مُعلَّم');
  const syntheticBatteryFailTestResults = [
    ...s10CategoryStates.testResults,
    {category: 'battery', testId: 'B-SYNTHETIC-FAIL', outcome: 'FAIL', kind: 'STATE', healthBearing: true},
  ];
  const batteryProvenRef = `categoryStates.testResults[${syntheticBatteryFailTestResults.length - 1}].outcome`;
  const csForLockTest = {...s10CategoryStates, testResults: syntheticBatteryFailTestResults};
  const adjusted = applyV7Adjustments(csForLockTest, [
    {category: 'battery', direction: 'DOWN', evidenceRefs: [batteryProvenRef]},
  ], s10Findings);
  eq(adjusted.overall.adjustments[0].rejectedReason, CATEGORY_GRADING_LOCKED_CODE,
      '[سلسلة الكاتب][تشغيل فعلي][القرار ٨٨-٣] buildV7Payload.js يكتب rejectedReason من الثابت المستورَد CATEGORY_GRADING_LOCKED_CODE فعلاً — حتى مع دليل مُثبَت وموصول بفئة battery نفسها (لا رُفض لسبب الفئة) — لا سلسلة حرفية معزولة');
  console.log('تحقّق 2: السطحان الحقيقيان (categoryStates.js وbuildV7Payload.js) يستهلكان الثابتين المستوردين فعلياً، بتشغيل حقيقي على S10 — لا اقتباس نصّي معزول');

  // ═══════════════════════════════════════════════════════════════════════
  // 3. 0-ب — لا نصّ مكرّر: يمسح functions/src/** ويفشل إن ظهرت
  //    'CATEGORY_GRADING_LOCKED' أو 'NO_CALIBRATED_THRESHOLD (PLAN-03 لم
  //    يُنجَز — انظر batteryLayer.js)' حرفياً في سطر غير تعليقي خارج
  //    categoryGradingLock.js — نفس منهج verifyReportV7Whitelist.test.js
  //    تحقّق 0-ب حرفياً (walk + إزالة تعليقات الكتلة + استبعاد السطر
  //    التعليقي الكامل + الجزء قبل أوّل // لاحق).
  // ═══════════════════════════════════════════════════════════════════════
  {
    const SRC_DIR = path.join(__dirname, '..', 'src');
    const UNIT_FILE = path.resolve(path.join(SRC_DIR, 'analysis', 'categoryGradingLock.js'));
    const FORBIDDEN = [CATEGORY_GRADING_LOCKED_CODE, CATEGORY_GRADING_LOCKED_TEXT];
    const offenders = [];

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        if (path.resolve(full) === UNIT_FILE) continue; // مصدر الحقيقة نفسه — مُستثنى بالتصميم

        const text = fs.readFileSync(full, 'utf8');
        const noBlockComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
        const lines = noBlockComments.split('\n');
        lines.forEach((line, i) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//')) return; // سطر تعليق كامل — توثيق مقصود، مُستثنى
          const codePart = line.split('//')[0]; // الجزء قبل أوّل تعليق سطري لاحق إن وُجد
          for (const tag of FORBIDDEN) {
            if (codePart.includes(`"${tag}"`) || codePart.includes(`'${tag}'`)) {
              offenders.push(`${path.relative(SRC_DIR, full).replace(/\\/g, '/')}:${i + 1} — "${tag}"`);
            }
          }
        });
      }
    }
    walk(SRC_DIR);

    eq(offenders.length, 0,
        `[القاعدة 24][إنفاذ آلي] لا سلسلة حرفية مكرَّرة لرمز/نصّ قفل تصنيف البطارية خارج categoryGradingLock.js في functions/src — ` +
        `المخالفات: ${JSON.stringify(offenders)}`);
  }
  console.log('تحقّق 3 (0-ب): لا نصّ مكرّر لرمز/نصّ قفل تصنيف البطارية في functions/src خارج categoryGradingLock.js — مُنفَّذ آلياً لا عُرفاً');

  console.log(`\n${n} تحقّقاً نجحت — categoryGradingLock.test.js`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
