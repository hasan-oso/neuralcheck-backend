'use strict';

// v7GuardNumberBoundaries.test.js — أمر مستخدم 2026-10-07 +03 (البند ١): حدود الرقم في حارس V7.
//   «حدّ الرقم: بداية النصّ ونهايته، والمسافة، والحرف العربي، وعلامات الترقيم العربية واللاتينية. والرقم الملاصق لحرف لاتيني
//    جزء من معرّف ولا يُستخرج: S10 و5G وG76 وMali-G76. وهذا سلوك الحارس اليوم، فلا يتغيّر. والرقم المفصول بمسافة بعد كلمة
//    لاتينية (Exynos 9820) يبقى كما هو.» + توحيد الأرقام العربية الهندية والفارسية و«٫» و«٬» قبل الاستخراج.
// الواقعة: «و1968633» و«3778.29،» و«بـ3778.29» كانت تمرّ بلا مطابقة (الحرف العربي المجاور كان يمنع الاستخراج) و«1968633» وحده يُرفَض.
// «ويُرفض كلٌّ منها حين لا يكون في الحمولة، ويُقبل حين يكون» — على حمولة فِخّ حقيقي (b45c8cf6) وبالحارس الحقيقي.
// السماح النسبي والمطلق (numberMatches) لا يتغيّر.
//
// Run: node functions/test/v7GuardNumberBoundaries.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const {extractNumbers, validateNumberGrounding, numberMatches} = require('../src/analysis/reportShapeV7');
const {buildV7Payload} = require('../src/analysis/buildV7Payload');
const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {GOLDEN_ANALYZED_AT_MS} = require('../src/analysis/expectedV7PayloadBytes');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));

// ═══════════════════════════════════════════════════════════════════════
// ١ — الاستخراج المباشر: كل الحالات العربية، والملاصق للاتيني لا يُستخرَج
// ═══════════════════════════════════════════════════════════════════════
{
  const cases = [
    // الحالات الأربع من الواقعة
    ['القيمة 3778.29 هنا', [3778.29]], ['القيمة و3778.29 هنا', [3778.29]], ['القيمة 3778.29، هنا', [3778.29]], ['القيمة بـ3778.29 هنا', [3778.29]],
    ['القيمة و1968633 هنا', [1968633]], ['القيمة 12345.67، هنا', [12345.67]],
    // أرقام هندية وفارسية وفواصلها
    ['القيمة ٣٧٧٨٫٢٩ هنا', [3778.29]], ['القيمة ب٣٧٧٨٫٢٩ هنا', [3778.29]], ['القيمة ۳۷۷۸٫۲۹ هنا', [3778.29]], ['القيمة ١٬٢٣٤٬٥٦٧ هنا', [1234567]],
    ['القيمة ٠٫٧١ هنا', [0.71]],
    // 45.9% ملاصقة لحرف (عربي) وقبل/بعد علامة
    ['و45.9%', [45.9]], ['ب45.9%', [45.9]], ['45.9%و', [45.9]], ['(45.9%)', [45.9]], ['«45.9»', [45.9]], ['نسبة:45.9', [45.9]], ['45.9؛', [45.9]], ['٤٥٫٩٪', [45.9]],
    // بداية النصّ ونهايته
    ['3778.29', [3778.29]], ['و3778.29', [3778.29]],
    // ملاصق لحرف لاتيني = جزء من معرّف: لا يُستخرَج
    ['جهاز Galaxy S10 5G سليم', []], ['شريحة Mali-G76 جيدة', []], ['معالج Exynos9820 قوي', []], ['دقة 1080x2280 بكسل', []],
    ['اتصال 5G متاح و4G أيضاً', []], ['وحدة G76 فقط', []], ['الاختبار SEC-04 فشل وكذلك C-04', []],
    ['جهاز Samsung Galaxy S10 5G بمعالج Mali-G76 ونظام Android11', []],
    // مفصول بمسافة بعد كلمة لاتينية: كما هو اليوم
    ['شريحة Exynos 9820 قوية', [9820]], ['نظام Android 11 حديث', [11]], ['واجهة API 30 مدعومة', [30]], ['سرعة 188 MB/s', [188]],
  ];
  for (const [text, want] of cases) deepEq(extractNumbers(text), want, `[١] «${text}»`);
}

// ═══════════════════════════════════════════════════════════════════════
// ٢ — «-» و«/» بجوار الرقم: كما هما اليوم، ويُبلَّغ بما تغيّر
// ═══════════════════════════════════════════════════════════════════════
{
  // لم يتغيّر
  deepEq(extractNumbers('المراحل 3-5'), [3, 5], '[٢] «3-5» مدى: طرفان موجبان');
  deepEq(extractNumbers('المراحل 3 - 5'), [3, 5], '[٢] «3 - 5»');
  deepEq(extractNumbers('بتاريخ 2021-08-01'), [2021, 8, 1], '[٢] تاريخ: ثلاثة أرقام موجبة');
  deepEq(extractNumbers('بقوة -63 dBm'), [-63], '[٢] «-63» بعد مسافة: سالب حقيقي');
  deepEq(extractNumbers('تيار (-8) هنا'), [-8], '[٢] «(-8)»: سالب بعد قوس');
  deepEq(extractNumbers('5/5 نجاح'), [5, 5], '[٢] «5/5»: «/» حدّ لا جزء من الرقم');
  deepEq(extractNumbers('إشارة 3/4'), [3, 4], '[٢] «3/4»');
  deepEq(extractNumbers('الاختبار SEC-04 وMali-G76 وC-06'), [], '[٢] «-» بعد حرف لاتيني: معرّف، لا سالب ولا رقم');
  deepEq(extractNumbers('واي فاي Wi-Fi 6 جيد'), [6], '[٢] «Wi-Fi 6»: الرقم المفصول بمسافة يُستخرَج كما كان');
  deepEq(extractNumbers('الجهاز S10-5 هنا'), [5], '[٢] «S10-5»: السلوك القديم نفسه (5 بعد الشرطة غير ملاصق لحرف قبله)');
  // تغيّر بقرار الحدّ الجديد: «-» ملاصقة لحرف عربي قبلها، ثم رقم — كان يُتخطّى بالكامل؛ يُستخرَج الآن سالباً بقاعدة الإشارة القائمة
  // (حالة غير محسومة: بين سالب حقيقي «ب-63 dBm» وشرطة وصل «المرحلة-3» — لم تقع في أيّ نصّ مسجَّل، يُبلَّغ بها).
  deepEq(extractNumbers('ب-63 dBm'), [-63], '[٢][غير محسوم] «ب-63»: يُستخرَج سالباً');
  deepEq(extractNumbers('المرحلة-3'), [-3], '[٢][غير محسوم] «المرحلة-3»: يُستخرَج سالباً بقاعدة الإشارة القائمة (كان يُتخطّى)');
  deepEq(extractNumbers('و5/5'), [5, 5], '[٢] «و5/5»: صار الأول مرئياً أيضاً (كان [5])');
  deepEq(extractNumbers('الطورين 3-5و'), [3, 5], '[٢] «3-5و»: الطرف الثاني الملاصق لحرف عربي مرئي (كان [3])');
}

// ═══════════════════════════════════════════════════════════════════════
// ٣ — بالحارس الحقيقي على حمولة فِخّ حقيقي (b45c8cf6): غائب ← يُرفَض، حاضر ← يُقبَل، في كل صيغة التصاق
// ═══════════════════════════════════════════════════════════════════════
{
  const raw = loadJson('b45c8cf6.ts.json');
  const functional = loadJson('functionalResults-by-scanid.json').byScanId['b45c8cf6-e376-4765-8703-f68e9bc69844'];
  const findings = computeFindings({device: {}, timeSeries: raw.timeSeries || raw, functionalResults: functional, manualResults: []});
  const inputs = sampleInputsFromRaw(raw);
  const categoryStates = computeCategoryStates({
    functionalResults: functional, manualResults: [], dev: null, findings,
    batterySampleInputs: inputs.sampleInputs, batteryDesignCapacityMah: inputs.design, analyzedAtMs: GOLDEN_ANALYZED_AT_MS,
  });
  const {body} = buildV7Payload({findings, categoryStates, language: 'ar', scanId: 'b45c8cf6-e376-4765-8703-f68e9bc69844', isFreeTrial: false, previousScan: null});
  const ctx = {findings: body.findings, categoryStates: Object.assign({}, body.categoryStates, {testResults: body.testResults})};
  const resp = (gamer) => ({
    narrative: {summary: 'ملخّص بلا أرقام.', details: 'تفاصيل بلا أرقام.', verdict: 'خلاصة بلا أرقام.', buyerAdvice: {casual: 'نصّ.', gamer, photographer: 'نصّ.'}, issueDescriptions: {}},
    crossChecks: [], adjustments: [], modelObservations: [],
  });
  const rejected = (text) => validateNumberGrounding(resp(text), ctx.findings, ctx.categoryStates).unmatchedFields.length > 0;

  // أرقام غائبة عن الحمولة: كلّ صيغ الالتصاق تُرفَض
  for (const absent of ['3778.29', '1968633', '12345.67', '13.7']) {
    for (const [label, wrap] of [['عارٍ', (x) => `القيمة ${x} هنا`], ['و', (x) => `القيمة و${x} هنا`], ['فاصلة عربية', (x) => `القيمة ${x}، هنا`], ['بـ', (x) => `القيمة بـ${x} هنا`], ['ب%', (x) => `القيمة ب${x}% هنا`]]) {
      eq(rejected(wrap(absent)), true, `[٣] غائب «${absent}» (${label}): يُرفَض`);
    }
  }
  eq(rejected('القيمة ٣٧٧٨٫٢٩ هنا'), true, '[٣] غائب «٣٧٧٨٫٢٩» (أرقام هندية): يُرفَض');
  eq(rejected('القيمة ب٣٧٧٨٫٢٩، هنا'), true, '[٣] غائب «ب٣٧٧٨٫٢٩،»: يُرفَض');
  // أرقام حاضرة (228.6 = S-01، 45.9 = تغطية الفحص): كلّ الصيغ تُقبَل
  for (const present of ['228.6', '45.9']) {
    for (const [label, wrap] of [['عارٍ', (x) => `القيمة ${x} هنا`], ['و', (x) => `القيمة و${x} هنا`], ['فاصلة عربية', (x) => `القيمة ${x}، هنا`], ['بـ', (x) => `القيمة بـ${x} هنا`], ['ب%', (x) => `القيمة ب${x}% هنا`]]) {
      eq(rejected(wrap(present)), false, `[٣] حاضر «${present}» (${label}): يُقبَل`);
    }
  }
  eq(rejected('القيمة ٢٢٨٫٦ هنا'), false, '[٣] حاضر «٢٢٨٫٦» (أرقام هندية): يُقبَل');
  eq(rejected('القيمة ب٤٥٫٩٪ هنا'), false, '[٣] حاضر «ب٤٥٫٩٪»: يُقبَل');

  // اسم الجهاز وشريحته داخل جملة عربية: لا أرقام تُستخرَج فلا رفض، و«Exynos 9820» من مرجع الجهاز
  const deviceSentence = `جهاز ${body.findings.meta.deviceModel} بمعالج Mali-G76 وشريحة Exynos 9820 يدعم 5G.`;
  deepEq(extractNumbers(`جهاز ${body.findings.meta.deviceModel} بمعالج Mali-G76 يدعم 5G.`), [], '[٣] اسم الجهاز وG76 و5G: لا أرقام');
  eq(rejected(deviceSentence), false, '[٣] جملة اسم الجهاز والشريحة تُقبَل (S10 وG76 وG5 معرّفات، و9820 من مرجع الجهاز)');

  // التسامح لا يتغيّر: مطلق 0.05 ونسبي 1% أيّهما أكبر
  eq(numberMatches(61.7, new Set([61.8])), true, '[٣] التسامح: 61.7 ضمن 1% من 61.8');
  eq(numberMatches(45, new Set([45.9])), false, '[٣] التسامح: 45 خارج 1% (0.459) من 45.9');
  eq(numberMatches(0.7, new Set([0.74])), true, '[٣] التسامح المطلق 0.05: 0.7 مقابل 0.74');
  eq(numberMatches(0.7, new Set([0.76])), false, '[٣] التسامح المطلق 0.05: 0.7 خارج 0.76');
}

console.log(`\nv7GuardNumberBoundaries.test.js: ${n}/${n} assertions passed`);
