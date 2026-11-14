'use strict';

// numberExtractionFix.test.js — أمر مستخدم 2026-09-23 +03 (بعد القياس
// العشاري)، البند ٣: «"3-5" مدى لا عددان، و"1,929,913" رقم واحد لا
// ثلاثة. والاختبار بنصوص النموذج الحقيقية من هذا القياس.»
//
// النصوص الحقيقية مُجمَّدة في test/fixtures/frozen-real-model-text-
// number-extraction-2026-09-23.json — لا قراءة من scripts/out هنا.
//
// Run: node functions/test/numberExtractionFix.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function loadGolden(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }
function loadFrozen(name) { return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')); }

const {extractNumbers, validateNumberGrounding} = require('../src/analysis/reportShapeV7');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const cases = loadFrozen('frozen-real-model-text-number-extraction-2026-09-23.json').cases;
const byId = Object.fromEntries(cases.map((c) => [c.id, c]));

// ═══════════════════════════════════════════════════════════════════════
// ١ — extractNumbers مباشرة، على النصوص الحقيقية المُجمَّدة الأربعة.
// ═══════════════════════════════════════════════════════════════════════
{
  const c = byId.phases_3_5_b45c8cf6;
  const nums = extractNumbers(c.text);
  ok(nums.includes(3) && nums.includes(5), `[١أ] "${c.id}": المدى 3-5 يُستخرَج طرفين موجبين، كلاهما حاضر`);
  ok(!nums.includes(-5), `[١أ] "${c.id}": -5 (السالب الزائف القديم) غائب تماماً`);
}
{
  const c = byId.phases_3_5_34dff2b8;
  const nums = extractNumbers(c.text);
  ok(nums.includes(3) && nums.includes(5), `[١ب] "${c.id}": المدى 3-5 يحمل الطرفين 3 و5`);
  ok(!nums.includes(-5), `[١ب] "${c.id}": -5 غائب`);
}
{
  const c = byId.grouped_current_gamer_b45c8cf6;
  const nums = extractNumbers(c.text);
  ok(nums.includes(-1929913), `[١ج] "${c.id}": -1929913 مُستخرَج رقماً واحداً صحيحاً`);
  ok(nums.includes(-980444), `[١ج] "${c.id}": -980444 مُستخرَج رقماً واحداً صحيحاً`);
  ok(!nums.some((x) => [-1, 929, 913, -980, 444].includes(x)), `[١ج] "${c.id}": صفر شظايا خاطئة (-1/929/913/-980/444)`);
}
{
  const c = byId.grouped_current_crosscheck_b45c8cf6;
  const nums = extractNumbers(c.text);
  ok(nums.includes(-1929913) && nums.includes(-980444), `[١د] "${c.id}": كلا الرقمين المجمَّعين صحيحان`);
  ok(nums.includes(34.5) && nums.includes(32.4), `[١د] "${c.id}": الأرقام العشرية المجاورة (34.5، 32.4) بلا تأثّر`);
}
function deepEqSet(actual, expected, msg) {
  assert.deepStrictEqual([...actual].sort((a, b) => a - b), [...expected].sort((a, b) => a - b), msg);
  n++;
}
console.log('تحقّق ١: extractNumbers على النصوص الحقيقية الأربعة — المدى [3,5] لا [3,-5]، والرقم المجمَّع -1929913/-980444 لا شظايا');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — ضابط: "1,2,3" (فواصل أحادية الرقم — قائمة لا رقماً مُجمَّعاً) يبقى
// ثلاثة أرقام منفصلة، لا رقماً واحداً.
// ═══════════════════════════════════════════════════════════════════════
{
  const nums = extractNumbers('القيم 1,2,3 في القائمة');
  deepEqSet(nums, [1, 2, 3], '[٢-ضابط] "1,2,3" (مجموعات أحادية) يبقى ثلاثة أرقام منفصلة — قائمة لا رقماً مُجمَّعاً');
}
// ضابط: الرقم السالب الحقيقي غير المُلتبَس بمدى يبقى سالباً (نصّ الأمر:
// "مثال ذلك -8 في الردود").
{
  const nums = extractNumbers('القيمة -8 مسجَّلة بوضوح');
  ok(nums.includes(-8), '[٢-ضابط] "-8" (سالب حقيقي، لا مدى) يبقى -8 سالباً');
}
// ضابط: معرِّفات الاختبار (SEC-04) تبقى مُستبعَدة (لم يمسّها هذا الإصلاح).
{
  const nums = extractNumbers('العطب SEC-04 مرفوض بوضوح');
  eq(nums.length, 0, '[٢-ضابط] SEC-04 يبقى مُستبعَداً بالكامل (حرف مجاور)');
}
console.log('تحقّق ٢: ضوابط — "1,2,3" يبقى قائمة، "-8" يبقى سالباً حقيقياً، SEC-04 يبقى مُستبعَداً');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — تحقّق مباشر (لا افتراض، نصّ الأمر: "هل -1929913 و-980444 موجودان
// في الحمولة فعلاً؟"): كلاهما موجود فعلاً في findings الحقيقية لـb45c8cf6،
// بفارق كسري لا يُذكَر — الرفض القديم كان خطأ أداة لا خطأ نموذج.
// ═══════════════════════════════════════════════════════════════════════
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

eq(findings.channels.battery_current_ua.CPU_SUSTAINED.mean.toFixed(2), '-1929913.04',
    '[٣] findings.channels.battery_current_ua.CPU_SUSTAINED.mean ≈ -1929913.04 فعلياً — تحقّق مباشر لا افتراض');
eq(findings.channels.battery_current_ua.INIT.mean.toFixed(2), '-980444.44',
    '[٣] findings.channels.battery_current_ua.INIT.mean ≈ -980444.44 فعلياً — تحقّق مباشر لا افتراض');
console.log('تحقّق ٣: -1929913 و-980444 موجودان فعلاً في findings.channels.battery_current_ua.{CPU_SUSTAINED,INIT}.mean — الرفض القديم كان خطأ أداة');

// ═══════════════════════════════════════════════════════════════════════
// ٤ — المسار الكامل عبر الحارس: نصّ حقيقي يحمل الرقم المجمَّع في
// narrative.buyerAdvice.gamer — validateNumberGrounding يقبله بعد الإصلاح
// (numbers.ok=true)، ولم تُوسَّع numberMatches نفسها (لا تغيير هناك).
// ═══════════════════════════════════════════════════════════════════════
{
  const c = byId.grouped_current_gamer_b45c8cf6;
  const minimalParsed = {
    narrative: {
      summary: 'ملخّص', details: 'تفصيل', verdict: 'حكم',
      buyerAdvice: {casual: 'نصيحة', gamer: c.text, photographer: 'نصيحة'},
      issueDescriptions: {},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
  const result = validateNumberGrounding(minimalParsed, findings, categoryStates);
  ok(result.ok, `[٤] validateNumberGrounding.ok=true على النصّ الحقيقي الكامل بعد الإصلاح (كان سيُرفَض قبله) — unmatchedFields=${JSON.stringify(result.unmatchedFields)}`);
}
console.log('تحقّق ٤: المسار الكامل عبر validateNumberGrounding — النصّ الحقيقي (buyerAdvice.gamer) يجتاز الآن، numberMatches بلا أي تغيير');

console.log(`\nnumberExtractionFix.test.js: ${n}/${n} assertions passed`);
