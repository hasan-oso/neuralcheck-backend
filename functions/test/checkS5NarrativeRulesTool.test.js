'use strict';

// checkS5NarrativeRulesTool.test.js — أمر مستخدم 2026-10-01 +03 (البند ٦):
// "واختبرها على نصوص فيها خرق مقصود لكل قاعدة آلية، ونصوص بلا خرق."
//
// يختبر functions/scripts/check-s5-narrative-rules.js مباشرة (استيراد،
// لا CLI) — نصّ واحد لكل قاعدة آلية يحمل خرقاً مقصوداً واحداً فقط (عزل
// القاعدة)، ونصّ نظيف كامل بلا أي خرق. القسم الدلالي (عدّ يدوي) يُختبَر
// بشكل منفصل — يُثبت أنه **يُرشِّح لا يحكم** (يظهر في manualReviewCandidates
// لا violations).
//
// Run: node functions/test/checkS5NarrativeRulesTool.test.js

const assert = require('assert');
const {checkS5Rules} = require('../scripts/check-s5-narrative-rules');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

function narrativeWith(summary) {
  return {narrative: {summary, details: 'تفصيل عادي بلا مشكلة.', verdict: 'حكم عادي.',
    buyerAdvice: {casual: 'نصيحة عادية.', gamer: 'نصيحة لاعب.', photographer: 'نصيحة مصوّر.'}}};
}

function violationRules(result) {
  return result.violations.map((v) => v.rule);
}

// ═══════════════════════════════════════════════════════════════════════
// ١ — نصّ نظيف كامل بلا أي خرق آلي.
// ═══════════════════════════════════════════════════════════════════════
{
  const clean = narrativeWith(
      'الحرف العامّ محسوب من نتائج القياس. التخزين الداخلي سليم القياس، ' +
      'والموقع (GPS) لم يُقَس لرفض الإذن. الاتصال عبر Wi-Fi وBluetooth وUSB ' +
      'وNFC سليم، ومنتج NeuralCheck يعرض الحروف من A إلى D بوضوح.',
  );
  const result = checkS5Rules(clean, null);
  eq(result.violations.length, 0, `[١] نصّ نظيف — صفر مخالفات آلية (فعلياً: ${JSON.stringify(violationRules(result))})`);
}
console.log('تحقّق ١: نصّ نظيف كامل — صفر مخالفات آلية');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — خرق مقصود واحد لكل قاعدة آلية، بعزل (بقيّة الحقول نظيفة).
// ═══════════════════════════════════════════════════════════════════════
const cases = [
  {rule: 'TEST_ID_MENTION', text: 'فشل الجهاز في اختبار SEC-04 بسبب صلاحيات الجذر.'},
  {rule: 'GATE_NAME_MENTION', text: 'الحرف انخفض بسبب بوّابة ROOT_DETECTED المُطلَقة.'},
  {rule: 'FORBIDDEN_WORD_PAYLOAD', text: 'بناءً على الحمولة المُستلمة من الخادم، الحرف C.'},
  {rule: 'LATIN_OUTSIDE_ALLOWLIST', text: 'النتيجة كانت excellent بمعايير الأداء.'},
  {rule: 'FRAME_RATE_MISNOMER', text: 'معدّل الإطارات كان منخفضاً أثناء الألعاب.'},
  {rule: 'CAMERA_RESOLUTION_MENTION', text: 'الكاميرا الخلفية بدقّة 108 ميغابكسل ممتازة.'},
  {rule: 'CAMERA_COUNT_MENTION', text: 'الجهاز يحمل 4 كاميرات في الخلف.'},
  {rule: 'GPS_NAMING', text: 'نظام تحديد المواقع لم يُقَس بسبب رفض الإذن.'},
  {rule: 'GPS_NAMING', text: 'استعمل GPS بلا أي مشاكل ظاهرة أثناء الفحص.'},
];

for (const {rule, text} of cases) {
  const result = checkS5Rules(narrativeWith(text), null);
  const rules = violationRules(result);
  ok(rules.includes(rule), `[٢][${rule}] النصّ "${text}" يُطلِق مخالفة ${rule} فعلياً — المخالفات: ${JSON.stringify(rules)}`);
}
console.log(`تحقّق ٢: ${cases.length} نصّاً بخرق مقصود واحد لكل قاعدة آلية — كلّها أُطلقت فعلياً`);

// ═══════════════════════════════════════════════════════════════════════
// ٣ — الصيغة الصحيحة "الموقع (GPS)" لا تُطلِق GPS_NAMING (سلبي — إثبات
//     أن القاعدة لا تفرط في التحفّظ).
// ═══════════════════════════════════════════════════════════════════════
{
  const result = checkS5Rules(narrativeWith('الموقع (GPS) لم يُقَس بسبب رفض الإذن.'), null);
  ok(!violationRules(result).includes('GPS_NAMING'), '[٣] الصيغة الصحيحة "الموقع (GPS)" لا تُطلِق GPS_NAMING');
}
console.log('تحقّق ٣: الصيغة الصحيحة "الموقع (GPS)" لا تُطلِق مخالفة زوراً');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — اللاتيني المسموح (NeuralCheck، A-D، QR، USB، Wi-Fi، Bluetooth، NFC،
//     GPS) لا يُطلِق LATIN_OUTSIDE_ALLOWLIST.
// ═══════════════════════════════════════════════════════════════════════
{
  const result = checkS5Rules(narrativeWith(
      'تقرير NeuralCheck هذا يعرض الحرف A أو B أو C أو D، ويذكر QR وUSB وWi-Fi وBluetooth وNFC وGPS.',
  ), null);
  ok(!violationRules(result).includes('LATIN_OUTSIDE_ALLOWLIST'),
      `[٤] اللاتيني المسموح لا يُطلِق LATIN_OUTSIDE_ALLOWLIST — فعلياً: ${JSON.stringify(result.violations.filter((v) => v.rule === 'LATIN_OUTSIDE_ALLOWLIST'))}`);
}
console.log('تحقّق ٤: اللاتيني المسموح كاملاً (NeuralCheck/A-D/QR/USB/Wi-Fi/Bluetooth/NFC/GPS) لا يُطلِق مخالفة');

// ═══════════════════════════════════════════════════════════════════════
// ٥ — الدلالي: يُرشِّح فقط (manualReviewCandidates)، لا يدخل violations.
// ═══════════════════════════════════════════════════════════════════════
{
  const battery = checkS5Rules(narrativeWith('البطارية سليمة تماماً ولا قلق منها.'), null);
  ok(battery.manualReviewCandidates.some((c) => c.rule === 'HEALTH_JUDGMENT_NO_LETTER'),
      '[٥-أ] حكم صحّي على البطارية (بلا حرف) يُرشَّح HEALTH_JUDGMENT_NO_LETTER للمراجعة');
  eq(battery.violations.length, 0, '[٥-أ] لا يدخل violations (دلالي لا آلي)');

  const uncal = checkS5Rules(narrativeWith('هذا القياس غير معايَر لكنه يبدو جيد جداً.'), null);
  ok(uncal.manualReviewCandidates.some((c) => c.rule === 'UNCALIBRATED_MEASUREMENT_JUDGMENT'),
      '[٥-ب] حكم من قياس غير معايَر يُرشَّح UNCALIBRATED_MEASUREMENT_JUDGMENT للمراجعة');

  const downgrade = checkS5Rules(narrativeWith('أقترح خفض حرف فئة التخزين إلى C.'), null);
  ok(downgrade.manualReviewCandidates.some((c) => c.rule === 'SELF_SUGGESTED_DOWNGRADE_MENTION'),
      '[٥-ج] ذكر تخفيض مقترح يُرشَّح SELF_SUGGESTED_DOWNGRADE_MENTION للمراجعة');
}
console.log('تحقّق ٥: القواعد الدلالية الثلاث تُرشِّح للمراجعة (عدّ يدوي) ولا تدخل violations القطعية');

// ═══════════════════════════════════════════════════════════════════════
// ٦ — issueDescriptions/crossChecks/adjustments/modelObservations تُفحَص
//     أيضاً (لا narrative.* وحدها).
// ═══════════════════════════════════════════════════════════════════════
{
  const full = {
    narrative: {summary: 'نظيف.', details: 'نظيف.', verdict: 'نظيف.',
      buyerAdvice: {casual: 'نظيف.', gamer: 'نظيف.', photographer: 'نظيف.'},
      issueDescriptions: {'ISS-SEC-04': 'فشل في SEC-04 تحديداً.'}},
    crossChecks: [{description: 'ملاحظة تذكر SEC-04 أيضاً.', evidenceRefs: []}],
    adjustments: [{category: 'storage', direction: 'DOWN', reason: 'انخفاض بسبب SEC-04.'}],
    modelObservations: [{text: 'ملاحظة SEC-04 هنا كذلك.'}],
  };
  const result = checkS5Rules(full, null);
  const fieldsWithViolation = new Set(result.violations.filter((v) => v.rule === 'TEST_ID_MENTION').map((v) => v.field));
  for (const expectedField of ['narrative.issueDescriptions[ISS-SEC-04]', 'crossChecks[0].description', 'adjustments[0].reason', 'modelObservations[0].text']) {
    ok(fieldsWithViolation.has(expectedField), `[٦] ${expectedField} يُفحَص فعلاً (TEST_ID_MENTION اكتُشفت فيه)`);
  }
}
console.log('تحقّق ٦: كل حقول النثر البشري (issueDescriptions/crossChecks/adjustments/modelObservations) تُفحَص لا narrative.* وحدها');

console.log(`\ncheckS5NarrativeRulesTool.test.js: ${n}/${n} assertions passed`);
