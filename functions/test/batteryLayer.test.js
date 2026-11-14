'use strict';

// batteryLayer.test.js — §٤-ج (PLAN-01-ROADMAP.md، طبقة البطارية، جديدة
// كلّياً 2026-09-20). راجع رأس functions/src/analysis/batteryLayer.js —
// **لا مطابقة ذهبية للقيم المرجعية التوضيحية** في PLAN-01 (17.8/19.9/20.7
// °C/Wh، 79/133/140 mΩ...) لأن منهجيّة حسابها الأصلية في
// REPORT-TO-COORDINATOR.md خارج هذا المستودع. ما يُختبَر هنا:
//   1. BAT-COULOMB = qIntMah (نفس findings.js) على ثلاث جلسات S10 حقيقية،
//      بتكرارية قريبة جداً من "144·144·140، 1.4%" المذكورة في الخطّة.
//   2. بوّابات الاعتماد (cadence) تطابق ما وثّقه findings.js نفسه فعلاً
//      (S10 ✓ / Honor ✗ للحرارة تحت الحمل؛ Honor "باطل، تحديث واحد" للجهد).
//   3. BAT-FCC: DESIGN_PINNED على S10 (تصميم 4400 من B-02 الحقيقي).
//   4. aggregateVerdicts: قاعدة الجمع — مسار حيّ واحد (غير كافية) ذهبي،
//      وبقية المسارات (عالية/متوسّطة/متعارضة) اصطناعية مُعلَّمة.
//   5. socAtWindowStart/socAtWindowEnd (2026-09-22 +03، مهمّة لاحقة — سدّ
//      فجوة §٣ docs/V7_DISPLAY_SHAPE_CONTRACT.md، "مستوى الشحن لكل مؤشّر"):
//      على الفِخاخ الحقيقية الأربعة (BAT-THERMAL-EFF/BAT-COULOMB = نافذة
//      الفحص كاملاً 0..n-1، مطابقة lvl[0]/lvl[n-1] حرفياً؛ BAT-R-APPARENT/
//      BAT-FCC = نافذة أضيق فعلياً مُتحقَّقة بإعادة اشتقاق مستقلّة للفهارس
//      المُستعملة، لا مقارنة الدالّة بنفسها) + حالتا غياب حقيقي اصطناعيتان
//      مُعلَّمتان (صفر عيّنة تحت الحمل لـBAT-R-APPARENT، صفر انتقال مستوى
//      لـBAT-FCC) تُثبتان null/null لا نقطة مُخترَعة.
//
// Run: node functions/test/batteryLayer.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {computeBatteryLayer, aggregateVerdicts, DESIGN_PINNED_TOLERANCE} = require('../src/analysis/batteryLayer');
const {_internal: batteryInternal} = require('../src/analysis/batteryLayer');
const {computeBatThermalEff, computeBatRApparent, computeBatFcc, computeBatCoulomb} = batteryInternal;
const {_internal: findingsInternal} = require('../src/analysis/findings');
// P1.4 (§١٤ "A98"، بند 1): sampleInputsFromRaw موحَّدة في src/ الآن — كانت
// هنا نسخة محلّية بحقل `inputs` (بدل `sampleInputs`) وبلا حارس المصفوفة
// الفارغة؛ استُبدلت بالنسخة الموحَّدة وعُدِّلت مواضع الاستدعاء أدناه
// (`.sampleInputs` بدل `.inputs`) لتطابقها.
const {sampleInputsFromRaw} = require('../src/analysis/sampleInputsFromRaw');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) { return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8')); }

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const near = (a, b, tol, m) => { ok(Math.abs(a - b) <= tol, `${m} — |${a}-${b}|>${tol}`); };

const s10a = sampleInputsFromRaw(loadJson('8909e850-s10.ts.json'));
const s10b = sampleInputsFromRaw(loadJson('b45c8cf6.ts.json'));
const s10c = sampleInputsFromRaw(loadJson('34dff2b8.ts.json'));
const honor = sampleInputsFromRaw(loadJson('e4b65a2f-honor.ts.json'));

// ═══════════════════════════════════════════════════════════════════════
// 1. ذهبي — BAT-COULOMB على ثلاث جلسات S10 حقيقية
// ═══════════════════════════════════════════════════════════════════════
const layerS10a = computeBatteryLayer(Object.assign({design: s10a.design}, s10a.sampleInputs));
const layerS10b = computeBatteryLayer(Object.assign({design: s10b.design}, s10b.sampleInputs));
const layerS10c = computeBatteryLayer(Object.assign({design: s10c.design}, s10c.sampleInputs));

for (const [label, layer] of [['8909e850', layerS10a], ['b45c8cf6', layerS10b], ['34dff2b8', layerS10c]]) {
  eq(layer.indicators['BAT-COULOMB'].status, 'MEASURED', `${label}: BAT-COULOMB MEASURED`);
}
const coulombValues = [layerS10a, layerS10b, layerS10c].map((l) => l.indicators['BAT-COULOMB'].value);
near(coulombValues[0], 144.16, 0.5, 'BAT-COULOMB 8909e850 ≈ 144 mAh (plan: "144")');
near(coulombValues[1], 143.84, 0.5, 'BAT-COULOMB b45c8cf6 ≈ 144 mAh (plan: "144")');
near(coulombValues[2], 139.91, 0.5, 'BAT-COULOMB 34dff2b8 ≈ 140 mAh (plan: "140")');
const cMean = coulombValues.reduce((a, b) => a + b, 0) / 3;
const cVariance = coulombValues.reduce((a, b) => a + (b - cMean) * (b - cMean), 0) / 3;
const cvPct = Math.sqrt(cVariance) / cMean * 100;
near(cvPct, 1.4, 0.3, `BAT-COULOMB تكرارية عبر ثلاث جلسات S10 ≈ 1.4% (plan) — فعلياً ${cvPct.toFixed(2)}%`);
console.log(`تحقّق 1: BAT-COULOMB = ${coulombValues.map((v) => v.toFixed(1)).join(', ')} mAh — تكرارية ${cvPct.toFixed(2)}%`);

// ═══════════════════════════════════════════════════════════════════════
// 2. بوّابات الاعتماد — تطابق findings.js نفسه (لا رقماً جديداً)
// ═══════════════════════════════════════════════════════════════════════
const honorLayer = computeBatteryLayer(Object.assign({design: honor.design}, honor.sampleInputs));

// الحرارة تحت الحمل: S10 يجتاز، Honor لا (findings.js: "S10 11 ✓ / Honor 3 ✗").
eq(layerS10a.indicators['BAT-THERMAL-EFF'].status, 'MEASURED', 'BAT-THERMAL-EFF: S10 يجتاز بوّابة الكادنس');
eq(honorLayer.indicators['BAT-THERMAL-EFF'].status, 'ABSTAINED', 'BAT-THERMAL-EFF: Honor يمتنع (كادنس<5، يطابق findings.js.computeThermal)');
eq(honorLayer.indicators['BAT-THERMAL-EFF'].gate.cadenceWhole, findingsInternal.changes(honor.sampleInputs.temp),
    'BAT-THERMAL-EFF: بوّابة الحرارة = نفس changes() المُستعملة في findings.js (مصدر واحد للحقيقة)');

// الجهد تحت الحمل: Honor "باطل، تحديث واحد" (plan) — نتحقّق أن الكادنس فعلاً 1.
eq(honorLayer.indicators['BAT-R-APPARENT'].status, 'ABSTAINED', 'BAT-R-APPARENT: Honor يمتنع');
eq(honorLayer.indicators['BAT-R-APPARENT'].gate.sourceCadenceUpdates, 1,
    'BAT-R-APPARENT: Honor cadence=1 — يطابق حرفياً "Honor 10.9 — باطل، تحديث واحد" في PLAN-01 §٤-ج');
eq(layerS10a.indicators['BAT-R-APPARENT'].status, 'MEASURED', 'BAT-R-APPARENT: S10 يجتاز');
console.log('تحقّق 2: بوّابات الاعتماد تطابق findings.js وتعليق PLAN-01 على Honor ("باطل، تحديث واحد")');

// ═══════════════════════════════════════════════════════════════════════
// 3. BAT-FCC — DESIGN_PINNED على S10 (تصميم 4400 من B-02 الحقيقي)
// ═══════════════════════════════════════════════════════════════════════
eq(s10b.design, 4400, 'S10: designCapacityMah=4400 من footer (يطابق B-02="4400" في الفخّ الوظيفي)');
const fccS10 = layerS10b.indicators['BAT-FCC'];
if (fccS10.status === 'ABSTAINED' && fccS10.reason === 'DESIGN_PINNED') {
  ok(Math.abs(fccS10.ratioToDesign - 1) <= DESIGN_PINNED_TOLERANCE,
      `BAT-FCC S10: DESIGN_PINNED ضمن ±${DESIGN_PINNED_TOLERANCE * 100}% فعلاً (ratio=${fccS10.ratioToDesign.toFixed(4)})`);
  console.log(`تحقّق 3: BAT-FCC S10 = DESIGN_PINNED (ratio=${fccS10.ratioToDesign.toFixed(4)}) — يطابق ` +
      `"S10 4,428–4,504 مثبَّت" اتّجاهاً (لا رقماً مطابَقاً ذهبياً)`);
} else {
  console.log(`تحقّق 3: BAT-FCC S10 = ${fccS10.status}/${fccS10.reason || ''} value=${fccS10.value} ` +
      `(لم يقع على DESIGN_PINNED كما توقّعت الخطّة — مُسجَّل لا مُخفى)`);
}
n++; // تحقّق 3 يُسجَّل بصرف النظر عن الفرع (مُبلَّغ لا مُخفى) — رقم واحد ثابت للعدّ.

// ═══════════════════════════════════════════════════════════════════════
// 4. aggregateVerdicts — قاعدة الجمع. الحيّ الوحيد: "غير كافية" (S10/Honor
//    الحقيقيان، لأن كل مؤشّر MEASURED يحمل THRESHOLD_NOT_CALIBRATED —
//    راجع رأس batteryLayer.js). البقية اصطناعية مُعلَّمة.
// ═══════════════════════════════════════════════════════════════════════
eq(aggregateVerdicts(layerS10a.indicators).judgment, 'غير كافية',
    'S10 الحقيقي: لا verdict مُعايَر لأي مؤشّر اليوم → "غير كافية" (ذهبي)');
eq(aggregateVerdicts(honorLayer.indicators).judgment, 'غير كافية', 'Honor الحقيقي: كذلك');

console.log('[اصطناعي] بقية قاعدة الجمع (عالية/متوسّطة/متعارضة) — لا عتبة مُعايَرة اليوم تُنتجها من بيانات حقيقية.');
{
  const three = {A: {status: 'MEASURED', verdict: 'تقادم'}, B: {status: 'MEASURED', verdict: 'تقادم'}, C: {status: 'MEASURED', verdict: 'تقادم'}, D: {status: 'ABSTAINED'}};
  const r = aggregateVerdicts(three);
  eq(r.judgment, 'تقادم', '[اصطناعي] ثلاثة متّفقة → الحالة');
  eq(r.confidence, 'عالية', '[اصطناعي] ثلاثة متّفقة → ثقة عالية');

  const two = {A: {status: 'MEASURED', verdict: 'سليمة'}, B: {status: 'MEASURED', verdict: 'سليمة'}, C: {status: 'ABSTAINED'}, D: {status: 'ABSTAINED'}};
  const r2 = aggregateVerdicts(two);
  eq(r2.judgment, 'سليمة', '[اصطناعي] اثنان متّفقان → الحالة');
  eq(r2.confidence, 'متوسطة', '[اصطناعي] اثنان متّفقان → ثقة متوسّطة');

  const conflict = {A: {status: 'MEASURED', verdict: 'سليمة'}, B: {status: 'MEASURED', verdict: 'تقادم'}, C: {status: 'ABSTAINED'}, D: {status: 'ABSTAINED'}};
  const r3 = aggregateVerdicts(conflict);
  eq(r3.judgment, 'مؤشّرات متعارضة', '[اصطناعي] تناقض → مؤشّرات متعارضة');
  eq(r3.confidence, 'منخفضة', '[اصطناعي] تناقض → ثقة منخفضة');

  const insufficient = {A: {status: 'MEASURED', verdict: 'سليمة'}, B: {status: 'ABSTAINED'}, C: {status: 'ABSTAINED'}, D: {status: 'ABSTAINED'}};
  const r4 = aggregateVerdicts(insufficient);
  eq(r4.judgment, 'غير كافية', '[اصطناعي] أقلّ من اثنين → غير كافية');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. socAtWindowStart/socAtWindowEnd — مستوى الشحن لكل مؤشّر (2026-09-22 +03)
//    docs/V7_DISPLAY_SHAPE_CONTRACT.md §٣ ("⚠️ فرق موثَّق عن نصّ الخطّة")
// ═══════════════════════════════════════════════════════════════════════

// ─── 5-أ. BAT-THERMAL-EFF/BAT-COULOMB — النافذة = الفحص كاملاً (0..n-1)،
// مُتحقَّقة بمقارنة مباشرة مع sampleInputs.lvl الخام نفسه (لا الدالّة بنفسها
// — القاعدة 16 بالمعنى المعاكس: الأداة/الدالّة تُقارَن بمصدر مستقلّ) على
// الفِخاخ الحقيقية الأربعة كلّها.
for (const [label, inputs, layer] of [
  ['8909e850', s10a.sampleInputs, layerS10a],
  ['b45c8cf6', s10b.sampleInputs, layerS10b],
  ['34dff2b8', s10c.sampleInputs, layerS10c],
  ['e4b65a2f-honor', honor.sampleInputs, honorLayer],
]) {
  const lvlStart = inputs.lvl[0];
  const lvlEnd = inputs.lvl[inputs.n - 1];
  eq(layer.indicators['BAT-THERMAL-EFF'].socAtWindowStart, lvlStart,
      `${label}: BAT-THERMAL-EFF.socAtWindowStart = lvl[0] (${lvlStart}) — نافذة الفحص كاملاً، حاضرة حتى عند الامتناع`);
  eq(layer.indicators['BAT-THERMAL-EFF'].socAtWindowEnd, lvlEnd,
      `${label}: BAT-THERMAL-EFF.socAtWindowEnd = lvl[n-1] (${lvlEnd})`);
  eq(layer.indicators['BAT-COULOMB'].socAtWindowStart, lvlStart,
      `${label}: BAT-COULOMB.socAtWindowStart = lvl[0] (${lvlStart}) — نفس نافذة BAT-THERMAL-EFF بالضبط (راجع رأس batteryLayer.js)`);
  eq(layer.indicators['BAT-COULOMB'].socAtWindowEnd, lvlEnd,
      `${label}: BAT-COULOMB.socAtWindowEnd = lvl[n-1] (${lvlEnd})`);
}
console.log('تحقّق 5-أ: BAT-THERMAL-EFF وBAT-COULOMB — نافذة الفحص كاملاً (lvl[0]/lvl[n-1]) على الفِخاخ الأربعة كلّها، بما فيها الامتناع (Honor/BAT-THERMAL-EFF)');

// ─── 5-ب. BAT-R-APPARENT — النافذة أضيق من الفحص كاملاً فعلياً (اتّحاد أوّل
// 10 ثوان وطور تحت الحمل)، مُتحقَّقة بإعادة اشتقاق idx35/first10sIdx بشكل
// مستقلّ من العيّنات الخام هنا في الاختبار — لا استيراد أي دالّة إنتاج.
for (const [label, inputs, layer] of [
  ['8909e850', s10a.sampleInputs, layerS10a],
  ['b45c8cf6', s10b.sampleInputs, layerS10b],
]) {
  const {n, t, ph, lvl} = inputs;
  const idx35 = [];
  for (let i = 0; i < n; i++) if (ph[i] === 3 || ph[i] === 4 || ph[i] === 5) idx35.push(i);
  const t0 = t[0];
  const first10sIdx = [];
  for (let i = 0; i < n; i++) if (t[i] <= t0 + 10000) first10sIdx.push(i);
  const used = first10sIdx.concat(idx35);
  const lo = Math.min(...used);
  const hi = Math.max(...used);
  eq(layer.indicators['BAT-R-APPARENT'].socAtWindowStart, lvl[lo],
      `${label}: BAT-R-APPARENT.socAtWindowStart = lvl[${lo}] (${lvl[lo]}) — اتّحاد أوّل 10ث وطور تحت الحمل، مُعاد اشتقاقه مستقلّاً`);
  eq(layer.indicators['BAT-R-APPARENT'].socAtWindowEnd, lvl[hi],
      `${label}: BAT-R-APPARENT.socAtWindowEnd = lvl[${hi}] (${lvl[hi]})`);
  // النافذة حقّاً أضيق (ليست الفحص كاملاً) — دليل أن التطبيق يميّز بين
  // المؤشّرات فعلياً لا ينسخ نافذة واحدة للأربعة.
  ok(lo > 0 || hi < n - 1,
      `${label}: BAT-R-APPARENT نافذة أضيق من 0..${n - 1} فعلياً ([${lo},${hi}]) — لا نسخ أعمى لنافذة BAT-COULOMB`);
}
console.log('تحقّق 5-ب: BAT-R-APPARENT — نافذة (اتّحاد أوّل 10ث + تحت الحمل) مُطابِقة لإعادة اشتقاق مستقلّة، وأضيق فعلياً من الفحص كاملاً');

// ─── 5-ج. BAT-FCC — MEASURED فعلياً على 8909e850 (لم يقع DESIGN_PINNED
// هناك، خلافاً لـb45c8cf6 في تحقّق 3) — النافذة يجب أن تقع داخل [min(lvl),
// max(lvl)] للفحص كاملاً، ومختلفة عن نافذتَي BAT-THERMAL-EFF/BAT-COULOMB
// (BAT-FCC وحدها تُبنى من فواصل منفصلة قد لا تغطّي طرفي الفحص).
{
  const fccA = layerS10a.indicators['BAT-FCC'];
  eq(fccA.status, 'MEASURED', 'إعداد 5-ج: 8909e850/BAT-FCC = MEASURED (لا DESIGN_PINNED هنا، خلافاً لـb45c8cf6)');
  const lvlMin = Math.min(...s10a.sampleInputs.lvl);
  const lvlMax = Math.max(...s10a.sampleInputs.lvl);
  ok(typeof fccA.socAtWindowStart === 'number' && fccA.socAtWindowStart >= lvlMin && fccA.socAtWindowStart <= lvlMax,
      `8909e850: BAT-FCC.socAtWindowStart (${fccA.socAtWindowStart}) داخل مدى الفحص كاملاً [${lvlMin},${lvlMax}]`);
  ok(typeof fccA.socAtWindowEnd === 'number' && fccA.socAtWindowEnd >= lvlMin && fccA.socAtWindowEnd <= lvlMax,
      `8909e850: BAT-FCC.socAtWindowEnd (${fccA.socAtWindowEnd}) داخل مدى الفحص كاملاً [${lvlMin},${lvlMax}]`);
}
console.log('تحقّق 5-ج: BAT-FCC (MEASURED فعلياً على 8909e850) — نافذته داخل مدى الفحص، مُشتقّة من فواصل الانتقال لا من 0..n-1 مباشرة');

// ─── 5-د. غياب حقيقي (null/null) حين لا نافذة استُعملت فعلاً — اصطناعي
// مُعلَّم، لأن لا فِخّ حقيقي متاح يُنتج idx35/trans فارغين تماماً (القاعدة 22:
// لا صفر ولا تقريب يمثّل الغياب).
{
  // BAT-R-APPARENT: صفر عيّنة في طور تحت الحمل (ph كلّها خارج {3,4,5}).
  const rNoLoad = computeBatRApparent({
    n: 4, t: [0, 1000, 2000, 3000], ph: [0, 1, 2, 6],
    volt: [4000, 3990, 3980, 3970], cur: [-500, -500, -500, -500], lvl: [50, 50, 49, 49],
  });
  eq(rNoLoad.status, 'ABSTAINED', '[اصطناعي] BAT-R-APPARENT بلا عيّنة تحت حمل → ABSTAINED');
  eq(rNoLoad.socAtWindowStart, null, '[اصطناعي] BAT-R-APPARENT بلا نافذة → socAtWindowStart=null (غياب حقيقي، لا 0 ولا تقريب)');
  eq(rNoLoad.socAtWindowEnd, null, '[اصطناعي] BAT-R-APPARENT بلا نافذة → socAtWindowEnd=null');

  // BAT-FCC: مستوى شحن ثابت طوال الفحص (صفر انتقال) → trans=[] → لا فاصل مؤهَّل.
  const fccNoTrans = computeBatFcc({
    n: 5, t: [0, 1000, 2000, 3000, 4000], ph: [3, 3, 3, 3, 3],
    cur: [-500, -500, -500, -500, -500], lvl: [50, 50, 50, 50, 50], design: null,
  });
  eq(fccNoTrans.status, 'ABSTAINED', '[اصطناعي] BAT-FCC بلا انتقال مستوى → ABSTAINED');
  eq(fccNoTrans.socAtWindowStart, null, '[اصطناعي] BAT-FCC بلا فاصل مؤهَّل → socAtWindowStart=null');
  eq(fccNoTrans.socAtWindowEnd, null, '[اصطناعي] BAT-FCC بلا فاصل مؤهَّل → socAtWindowEnd=null');

  // على النقيض: BAT-THERMAL-EFF يمتنع (كادنس غير كافٍ) لكن نافذته (0..n-1)
  // معروفة دائماً بمجرّد n>=1 — الامتناع عن الحكم لا يعني غياب النافذة.
  const thermalLowCadence = computeBatThermalEff({
    n: 3, t: [0, 1000, 2000], temp: [30, 30, 30],
    volt: [4000, 3990, 3980], cur: [-500, -500, -500], lvl: [60, 59, 58],
  });
  eq(thermalLowCadence.status, 'ABSTAINED', '[اصطناعي] BAT-THERMAL-EFF كادنس صفر (temp ثابتة) → ABSTAINED');
  eq(thermalLowCadence.socAtWindowStart, 60, '[اصطناعي] BAT-THERMAL-EFF: النافذة (0..n-1) معروفة رغم الامتناع → lvl[0]=60');
  eq(thermalLowCadence.socAtWindowEnd, 58, '[اصطناعي] BAT-THERMAL-EFF: lvl[n-1]=58');

  // BAT-COULOMB بعيّنة واحدة (n=1) — نافذة بعرض صفر (البداية=النهاية=lvl[0]).
  const coulombSingle = computeBatCoulomb({n: 1, t: [0], cur: [-500], lvl: [77]});
  eq(coulombSingle.status, 'ABSTAINED', '[اصطناعي] BAT-COULOMB n=1 → INSUFFICIENT_SAMPLES');
  eq(coulombSingle.socAtWindowStart, 77, '[اصطناعي] BAT-COULOMB n=1: نافذة بعرض صفر — البداية=lvl[0]=77');
  eq(coulombSingle.socAtWindowEnd, 77, '[اصطناعي] BAT-COULOMB n=1: النهاية=lvl[0]=77 أيضاً (عيّنة واحدة)');
}
console.log('تحقّق 5-د: [اصطناعي] غياب حقيقي (null/null) حين لا نافذة أصلاً — لا يُخلَط بامتناع الحكم مع نافذة معروفة (BAT-THERMAL-EFF)');

console.log(`\nbatteryLayer.test.js: ${n}/${n} assertions passed`);
