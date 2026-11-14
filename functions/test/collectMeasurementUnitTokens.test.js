'use strict';

// collectMeasurementUnitTokens.test.js — أمر مستخدم 2026-09-23 +03، البند ١:
// عطب حيّ حقيقي (نداءا 2026-09-22T23-39/23-40 على DeepSeek): "13.38
// °C/Wh" (categoryStates.categories.battery.batteryIndicators.
// BAT-THERMAL-EFF.unit) رُفض بسبب "Wh" — الحارس القديم كان يقرأ الوحدات
// من موضعين مُسمّيين فقط (testResults[].evidenceUnit/raw.rawValueUnit،
// issues[].evidenceUnit)، لا من كل حقل وحدة في الحمولة (القاعدة 25).
//
// ملفّ منفصل عن reportShapeV7.test.js عمداً — ذلك الملفّ **لا يُلمَس الآن**
// (قرار مستخدم صريح: "يُغلق بعد النداءين").
//
// Run: node functions/test/collectMeasurementUnitTokens.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {computeFindings} = require('../src/analysis/findings');
const {computeCategoryStates} = require('../src/analysis/categoryStates');
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');
const {guardV7Response, collectMeasurementUnitTokens} = require('../src/analysis/reportShapeV7');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const deepEq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ─── إعداد — b45c8cf6 الحقيقي (نفس فِخّ كل ملفّات هذا المستودع) ─────────
const s10Raw = loadJson('b45c8cf6.ts.json');
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const s10Functional = frMap['b45c8cf6-e376-4765-8703-f68e9bc69844'];
const s10Fp = {device: {}, timeSeries: s10Raw.timeSeries || s10Raw, functionalResults: s10Functional, manualResults: []};
const s10Findings = computeFindings(s10Fp);
const s10Inputs = sampleInputsFromRaw(s10Raw);
const s10CategoryStates = computeCategoryStates({
  functionalResults: s10Functional, manualResults: [], dev: null, findings: s10Findings,
  batterySampleInputs: s10Inputs.sampleInputs, batteryDesignCapacityMah: s10Inputs.design,
});

ok(s10CategoryStates.categories.battery.batteryIndicators &&
    s10CategoryStates.categories.battery.batteryIndicators['BAT-THERMAL-EFF'].unit === '°C/Wh',
'إعداد: BAT-THERMAL-EFF.unit="°C/Wh" فعلياً على b45c8cf6 — نفس القيمة التي رفضها الحارس القديم');

// ═══════════════════════════════════════════════════════════════════════
// ١ — "13.38 °C/Wh" يمرّ على b45c8cf6 الحقيقي (narrative.details اصطناعي
// يحمل الرقم + الوحدة، بمعزل عن أي نداء نموذج حقيقي).
// ═══════════════════════════════════════════════════════════════════════
{
  const parsedResponse = {
    narrative: {
      summary: 'ملخّص اختباري', verdict: 'حكم اختباري',
      details: 'كفاءة التبريد الحرارية 13.38 °C/Wh فعلياً على هذا الفحص.',
      buyerAdvice: {casual: 'نصيحة', gamer: 'نصيحة', photographer: 'نصيحة'},
      issueDescriptions: {},
    },
    crossChecks: [], adjustments: [], modelObservations: [],
  };
  const guard = guardV7Response(parsedResponse, {findings: s10Findings, categoryStates: s10CategoryStates});
  const detailsLeak = guard.languageLeaks.find((l) => l.path === 'narrative.details');
  ok(!detailsLeak, '[اختبار ١] "13.38 °C/Wh" يمرّ بلا تسرّب على narrative.details — Wh مُستثناة بالاسم البنيوي "unit"');
  const whExcluded = guard.excluded.languageTokens.find((e) => e.path === 'narrative.details' && e.token === 'Wh');
  // تحديث 2026-09-23 +03 (قرار المستخدم بعد A125): تقسيم camelCase في
  // collectFindingsFieldNameTokens (البند ٤ الأصلي، 695e862) أُلغي بالكامل
  // (كشفه اختبار البند ٥ — تسرّب "partial" الحقيقي). التعديل المؤقّت هنا
  // (قبول findings_field_name إلى جانب measurement_unit، لأن energyWh كانت
  // تُقسَّم إلى "energy"+"Wh") لم يعد له سبب — energyWh يعود مفتاحاً كاملاً
  // غير مُقسَّم، فـ"wh" لا تدخل findings_field_name إطلاقاً. القاعدة 23:
  // التأكيد يعود لصرامته الأصلية (measurement_unit فقط) بدل إبقاء تسامح
  // لعطب لم يعد قائماً.
  eq(whExcluded && whExcluded.category, 'measurement_unit',
      '[اختبار ١] "Wh" مُسجَّلة بفئة measurement_unit تحديداً (لا findings_field_name — التقسيم أُلغي)');
}
console.log('تحقّق ١: "13.38 °C/Wh" يمرّ على b45c8cf6 الحقيقي — العطب الحيّ مُصلَح');

// ═══════════════════════════════════════════════════════════════════════
// ٢ — تصحيح 2026-09-23 +03 (أمر مستخدم لاحق، البند ٥): الاختبار الأصلي
// هنا استعمل اسم حقل "unit" نفسه (موجود أصلاً في القائمة القديمة) على
// مسار جديد فقط — "لا يُثبت مساراً جديداً باسم قائم، لا حقل وحدة جديداً"
// (نصّ المستخدم حرفياً). الآن: اسم حقل **جديد كلّياً** (`latencyUnit`،
// غير مذكور في reportShapeV7.js/categoryStates.js/findings.js بحثاً
// مباشراً) على مسار جديد — يُثبت أن القاعدة اللاحقة (/unit$/i) تلتقط أي
// اسم منتهياً بـ"unit"، لا قائمة أسماء محفوظة.
// ═══════════════════════════════════════════════════════════════════════
{
  const csClone = JSON.parse(JSON.stringify(s10CategoryStates));
  csClone.categories.cpu.syntheticProbe = {latencyUnit: 'QUBIT'}; // اسم حقل جديد كلّياً + قيمة مُختلَقة، كلاهما غير مذكور بالكود
  const tokens = collectMeasurementUnitTokens(s10Findings, csClone);
  ok(tokens.has('qubit'), '[اختبار ٢] حقل وحدة باسم جديد كلّياً (categories.cpu.syntheticProbe.latencyUnit="QUBIT") جُمِع تلقائياً — القاعدة اللاحقة /unit$/i لا قائمة أسماء');

  // ضابط ١ — مفتاح لا ينتهي بـ"unit" (حتى بقيمة تبدو وحدة) لا يُجمَع.
  const csClone2 = JSON.parse(JSON.stringify(s10CategoryStates));
  csClone2.categories.cpu.syntheticProbe = {notAUnitFieldName: 'FAKEUNIT'};
  const tokens2 = collectMeasurementUnitTokens(s10Findings, csClone2);
  ok(!tokens2.has('fakeunit'), '[ضابط ١] مفتاح لا ينتهي بـ"unit" (حتى بقيمة تبدو وحدة) لا يُجمَع — الآلية على اسم المفتاح لا القيمة');

  // ضابط ٢ (مطلوب صراحةً) — unitSource/unitCaveat يبدآن بـ"unit" لكن لا
  // ينتهيان به — لا يُجمَعان رغم مطابقتهما لتعريف الاحتواء القديم.
  const csClone3 = JSON.parse(JSON.stringify(s10CategoryStates));
  csClone3.categories.cpu.syntheticProbe = {unitSource: 'FAKESOURCEVALUE', unitCaveat: 'FAKECAVEATVALUE'};
  const tokens3 = collectMeasurementUnitTokens(s10Findings, csClone3);
  ok(!tokens3.has('fakesourcevalue'), '[ضابط ٢] unitSource لا يُجمَع — يبدأ بـ"unit"، لا ينتهي به');
  ok(!tokens3.has('fakecaveatvalue'), '[ضابط ٢] unitCaveat لا يُجمَع — يبدأ بـ"unit"، لا ينتهي به');
  // ونفس الضابط على القيم الحقيقية الفعلية لهما في findings/categoryStates
  // (لا مُصطنَعة فقط) — راجع إعداد الملفّ: findings.battery.charge_counter.*.unitSource
  // قيمتها الفعلية "MISSING"/"ABSENT"، وcategories.battery.batteryIndicators.
  // BAT-R-APPARENT.unitCaveat جملة عربية حقيقية.
  const realTokens = collectMeasurementUnitTokens(s10Findings, s10CategoryStates);
  ok(!realTokens.has('missing') && !realTokens.has('absent'),
      '[ضابط ٢][بيانات حقيقية] "missing"/"absent" (قيم unitSource الفعلية) غائبتان عن التوكِنز المسموحة');
}
console.log('تحقّق ٢: حقل وحدة باسم جديد كلّياً (latencyUnit) يُجمَع تلقائياً — والقاعدة لا تلتقط unitSource/unitCaveat رغم بدئهما بـ"unit"');

// ═══════════════════════════════════════════════════════════════════════
// ٣ — إعادة تشغيل الحارس على مخرَج b45c8cf6 الحيّ الحقيقي (2026-09-22
// 23:39): "Wh" يزول، "ot" (تشويه "روot") يبقى في الحقول الستّة،
// guard.ok=false يبقى بسبب "ot" وحده.
// ═══════════════════════════════════════════════════════════════════════
{
  const liveFile = path.join(__dirname, '..', 'scripts', 'out',
      'v7-live-b45c8cf6-e376-4765-8703-f68e9bc69844-2026-09-22T23-39-25-313Z.json');
  ok(fs.existsSync(liveFile), 'إعداد: مخرَج النداء الحيّ الحقيقي موجود (لم يُنسَخ يدوياً — نفس الملفّ الذي أنتجه المستخدم)');
  if (fs.existsSync(liveFile)) {
    const live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    const guard = guardV7Response(live.parsedResponse, {findings: s10Findings, categoryStates: s10CategoryStates});

    eq(guard.ok, false, '[اختبار ٣] guard.ok=false يبقى — بسبب "ot" وحده الآن (لا "Wh" أيضاً)');

    const whStillLeaking = guard.languageLeaks.some((l) => l.tokens.includes('Wh') || l.tokens.includes('wh'));
    ok(!whStillLeaking, '[اختبار ٣] "Wh" زالت كلّياً من languageLeaks بعد الإصلاح');

    const otPaths = guard.languageLeaks.filter((l) => l.tokens.includes('ot')).map((l) => l.path);
    eq(otPaths.length, 6, '[اختبار ٣] "ot" (تشويه "روot") يبقى في الحقول الستّة بالضبط — عطب حقيقي، لا يُمرَّر خطأً');
    deepEq(new Set(otPaths), new Set([
      'narrative.summary', 'narrative.details', 'narrative.verdict',
      'narrative.buyerAdvice.casual', 'narrative.issueDescriptions[ISS-SEC-04]', 'crossChecks[0].description',
    ]), '[اختبار ٣] نفس الحقول الستّة الحقيقية بالضبط (لا أكثر ولا أقلّ) — من مخرَج النداء الحيّ الفعلي');
  }
}
console.log('تحقّق ٣: الإصلاح لم يُمرّر "روot" — "Wh" وحدها زالت، "ot" يبقى في الحقول الستّة، guard.ok=false بسببه');

console.log(`\ncollectMeasurementUnitTokens.test.js: ${n}/${n} assertions passed`);
