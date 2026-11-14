'use strict';

// testKinds.test.js — P1.2 (PLAN-01-ROADMAP §المرحلة ١، P1.2 + تعديل
// 2026-09-20). ثلاث كتل:
//   1. ذهبي: C-04 مُوسَم UNSTABLE على الفحصين اللذين يحملان functionalResults
//      فعلاً (b45c8cf6, 34dff2b8 — كلاهما S10؛ الفخّ: 8909e850/e4b65a2f
//      "الفحصان الأساسيان" لـP1.1 لا يحملان functionalResults إطلاقاً —
//      راجع golden/README.md، قسم "اثنان من أربعة فقط").
//   2. حتمي: قواعد toTestResult النصّية (T-04/N-10/CM-*/L-02/L-03/N-04/
//      unavailable) على بيانات من الفخّ الذهبي نفسه حين متاحة.
//   3. اصطناعي مُعلَّم: ما لا تغطّيه الفِخاخ (manualResults، N-10 warning
//      فعلياً غائب من الفخّين — كلاهما "pass").
//
// Run: node functions/test/testKinds.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  toTestResult, kindOf, isUnstable, isHealthBearing, KIND,
  permissionForNotTested,
} = require('../src/analysis/testKinds');

const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'golden');
function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, name), 'utf8'));
}

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

// ═══════════════════════════════════════════════════════════════════════
// 1. ذهبي — C-04 UNSTABLE على الفحصين الحاملين functionalResults فعلاً
// ═══════════════════════════════════════════════════════════════════════
const frMap = loadJson('functionalResults-by-scanid.json').byScanId;
const SCAN_IDS_WITH_FR = [
  'b45c8cf6-e376-4765-8703-f68e9bc69844',
  '34dff2b8-ce9e-4b40-86a9-1976c878e195',
];
// الفخّ: هذان الاثنان *لا* يحملان functionalResults (null) — لو استُعملا
// هنا بالخطأ بدل الاثنين أعلاه لسقط الاختبار فوراً (find يُرجع undefined).
const SCAN_IDS_WITHOUT_FR = [
  '8909e850-b10c-466c-899a-ce97cb5c4fbe',
  'e4b65a2f-3a0c-4f11-939d-17eab7d0912f',
];

for (const scanId of SCAN_IDS_WITHOUT_FR) {
  ok(frMap[scanId] === null, `الفخّ: ${scanId} يجب أن يكون null (لا functionalResults) — إن تغيّر هذا فالفخّ تعطّل`);
}

for (const scanId of SCAN_IDS_WITH_FR) {
  const list = frMap[scanId];
  ok(Array.isArray(list) && list.length > 0, `${scanId}: functionalResults موجودة`);
  const c04 = list.find((r) => r.testId === 'C-04');
  ok(!!c04, `${scanId}: C-04 موجود في functionalResults`);

  eq(kindOf('C-04'), KIND.MEASUREMENT, `${scanId}: C-04 kind=MEASUREMENT`);
  eq(isUnstable('C-04'), true, `${scanId}: C-04 unstable=true`);
  eq(isHealthBearing('C-04'), false, `${scanId}: C-04 healthBearing=false (لا يدخل حرفاً ولا عطباً)`);

  const tr = toTestResult(c04, null, null, {isManual: false});
  eq(tr.unstable, true, `${scanId}: TestResult(C-04).unstable`);
  eq(tr.healthBearing, false, `${scanId}: TestResult(C-04).healthBearing`);
  eq(tr.entersGrade, false, `${scanId}: TestResult(C-04).entersGrade`);
  eq(tr.entersFault, false, `${scanId}: TestResult(C-04).entersFault — لا DEGRADED من مقياس غير مستقرّ (قرار 10)`);
  // outcome يبقى ما أبلغه التطبيق فعلياً (pass/warning) — الوسم لا يُخفي القيمة، يمنع فقط دخولها الحرف/العطب.
  ok(['PASS', 'WARNING'].includes(tr.outcome), `${scanId}: C-04 outcome من الحالة الفعلية (${c04.status}) لا مُصادَراً`);
}

// نفس الشيء لبقية صنف UNSTABLE (S-04, S-05, C-03) — لا تدخل حرفاً ولا عطباً.
for (const id of ['S-04', 'S-05', 'C-03']) {
  eq(isUnstable(id), true, `${id}: unstable=true`);
  eq(isHealthBearing(id), false, `${id}: healthBearing=false`);
}

// قرار 6: C-04 يُحذف من launch (تطبيق) بعد P1.2 لا قبله. الباك اند لا
// "يحذف" شيئاً (لا نكهات هنا) — لكن التصنيف أعلاه (UNSTABLE, healthBearing
// false) هو "ما يقابله" في هذا المستودع، وهو مطلوب قبل أي حذف تطبيقي
// (التوقيت المقصود بنص الخطّة).
ok(true, 'قرار 6: توثيق فقط — لا حذف تطبيقي هنا (خارج الحدود)');

// ═══════════════════════════════════════════════════════════════════════
// 2. حتمي — SEC-08/T-04/CM-11 → SPEC؛ B-08 → SPEC (تعليمات المهمّة)
// ═══════════════════════════════════════════════════════════════════════
for (const id of ['SEC-08', 'T-04', 'CM-11']) {
  eq(kindOf(id), KIND.SPEC, `${id}: kind=SPEC`);
  eq(isHealthBearing(id), false, `${id}: healthBearing=false`);
}
eq(kindOf('B-08'), KIND.SPEC, 'B-08: kind=SPEC (تعليمات المهمّة — لا يمكن أن ينجح على untrusted_app)');
eq(isHealthBearing('B-08'), false, 'B-08: healthBearing=false');

// SEC-08 الحقيقي في الفخّ حالته "pass" فعلياً — التصنيف SPEC يمنعها من
// دخول الحرف رغم "النجاح" الظاهري (A68: لا تقرأ شيئاً إطلاقاً).
{
  const sec08 = frMap[SCAN_IDS_WITH_FR[0]].find((r) => r.testId === 'SEC-08');
  eq(sec08.status, 'pass', 'الفخّ: SEC-08 status=pass فعلياً');
  const tr = toTestResult(sec08, null, null, {});
  eq(tr.outcome, 'INFO_ONLY', 'SEC-08: outcome=INFO_ONLY رغم status=pass — SPEC لا يُقيَّم');
  eq(tr.healthBearing, false, 'SEC-08: healthBearing=false');
}

// T-04 الحقيقي warning (0 zones) — لكنه SPEC فيُعرض INFO_ONLY، لا
// CAPABILITY_BLOCKED (تلك القاعدة فقط لو ظلّ T-04 خارج إعادة تصنيف SPEC؛
// وقد أُعيد تصنيفه SPEC صراحة أعلاه فتغلب SPEC). نتحقّق من هذا التسلسل
// صراحةً لأنه غير بديهي.
{
  const t04 = frMap[SCAN_IDS_WITH_FR[0]].find((r) => r.testId === 'T-04');
  eq(t04.status, 'warning', 'الفخّ: T-04 status=warning فعلياً');
  const tr = toTestResult(t04, null, null, {});
  eq(tr.outcome, 'INFO_ONLY', 'T-04: kind=SPEC يسبق قاعدة "T-04 warning→CAPABILITY_BLOCKED" — SPEC أولاً');
}

// ═══════════════════════════════════════════════════════════════════════
// 3. حتمي — CM-* / L-02 / L-03 / N-04 not_tested → PERMISSION_DENIED
// ═══════════════════════════════════════════════════════════════════════
{
  const list = frMap[SCAN_IDS_WITH_FR[0]];
  const cm01 = list.find((r) => r.testId === 'CM-01');
  eq(cm01.status, 'not_tested', 'الفخّ: CM-01 not_tested');
  const trCm01 = toTestResult(cm01, null, null, {});
  eq(trCm01.notMeasuredReason, 'PERMISSION_DENIED', 'CM-01: PERMISSION_DENIED');
  eq(trCm01.permission, 'android.permission.CAMERA', 'CM-01: permission=CAMERA');

  const l02 = list.find((r) => r.testId === 'L-02');
  eq(l02.status, 'not_tested', 'الفخّ: L-02 not_tested');
  ok(l02.notes && l02.notes.includes('الموقع مرفوض'), 'الفخّ: L-02 notes يؤكّد رفض إذن الموقع (مصدر ثقة عالية)');
  const trL02 = toTestResult(l02, null, null, {});
  eq(trL02.notMeasuredReason, 'PERMISSION_DENIED', 'L-02: PERMISSION_DENIED');
  eq(trL02.permission, 'android.permission.ACCESS_FINE_LOCATION', 'L-02: permission=ACCESS_FINE_LOCATION');

  const n04 = list.find((r) => r.testId === 'N-04');
  eq(n04.status, 'not_tested', 'الفخّ: N-04 not_tested');
  const trN04 = toTestResult(n04, null, null, {});
  eq(trN04.notMeasuredReason, 'PERMISSION_DENIED', 'N-04: PERMISSION_DENIED (ثقة أقلّ — لا notes مؤكّدة في الفخّ، انظر تعليق testKinds.js)');
  eq(trN04.permission, 'android.permission.READ_PHONE_STATE', 'N-04: permission=READ_PHONE_STATE (أفضل معرفة متاحة)');

  // CM-11 استُثني من قاعدة PERMISSION_DENIED (أُعيد تصنيفه SPEC أعلاه).
  eq(permissionForNotTested('CM-11'), null, 'CM-11: مُستثنى من خريطة الأذونات (SPEC)');
}

// ═══════════════════════════════════════════════════════════════════════
// 4. حتمي — unavailable → CAPABILITY_BLOCKED (لا قاعدة طراز اليوم)
// ═══════════════════════════════════════════════════════════════════════
{
  const list = frMap[SCAN_IDS_WITH_FR[0]];
  const b08 = list.find((r) => r.testId === 'B-08');
  eq(b08.status, 'unavailable', 'الفخّ: B-08 status=unavailable فعلياً');
  const tr = toTestResult(b08, null, null, {});
  // B-08 مُعاد تصنيفه SPEC (تعليمات المهمّة) — outcome=INFO_ONLY لا NOT_MEASURED.
  eq(tr.outcome, 'INFO_ONLY', 'B-08: SPEC يسبق قاعدة unavailable');

  const sec07 = list.find((r) => r.testId === 'SEC-07');
  eq(sec07.status, 'unavailable', 'الفخّ: SEC-07 status=unavailable فعلياً');
  const trSec07 = toTestResult(sec07, null, null, {});
  eq(trSec07.notMeasuredReason, 'CAPABILITY_BLOCKED', 'SEC-07: CAPABILITY_BLOCKED (لا قاعدة طراز — افتراض موثَّق)');

  // مع قاعدة طراز تشهد بغياب العتاد → HARDWARE_ABSENT (اصطناعي، لا فخّ يحمله).
  const devAttests = {attestsHardwareAbsent: () => true};
  const trWithBaseline = toTestResult(sec07, devAttests, null, {});
  eq(trWithBaseline.notMeasuredReason, 'HARDWARE_ABSENT', '[اصطناعي] SEC-07 مع قاعدة طراز شاهدة: HARDWARE_ABSENT');
}

// ═══════════════════════════════════════════════════════════════════════
// 5. اصطناعي مُعلَّم — N-10 warning/fail (غائبان من الفخّين، كلاهما pass)
// ═══════════════════════════════════════════════════════════════════════
console.log('[اصطناعي] N-10 warning/fail غائبان من كل الفِخاخ المتاحة — لا اختبار ذهبي عليهما.');
{
  // rawValue مُصحَّح 2026-09-25 +03 (ملاحظة مدقّق منقولة من NeuralChek —
  // مستودع آخر، غير مُتحقَّق هنا، القاعدة 27/29): "التطبيق يُنتج fail لـ-90
  // (NetworkTests.kt:304-308)، والـwarning لـ-80..-71 — فالعيّنة الاصطناعية
  // لا تطابق مُنتِجها." كانت '-90' هنا مع status='warning'؛ العيّنة الاصطناعية
  // نفسها لا تدّعي محاكاة مُنتِج حقيقي (راجع طابع "[اصطناعي]") لكن رقماً
  // يناقض حالته يُضلّل قارئاً لاحقاً — استُبدلت لا أُضيف بجانبها (القاعدة 23)
  // بقيمة داخل مدى warning الموثَّق فعلياً (-75، منتصف -80..-71).
  const synthetic = {testId: 'N-10', categoryName: 'wireless', status: 'warning', rawValue: '-75', rawValueUnit: 'dBm'};
  const tr = toTestResult(synthetic, null, null, {});
  eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي] N-10 warning → ENVIRONMENT_UNSUITABLE');
  eq(tr.displayValueDespiteNotMeasured, true, '[اصطناعي] N-10: الرقم يُعرض رغم NOT_MEASURED');
}
// أمر مستخدم 2026-09-24 +03 (القرار ٨٦ البند ١) — fail تصير إلى نفس مصير
// warning: "قراءة أضعف من ‎-80 dBm تصل fail، فتنزل فئة wireless إلى D، وقد
// يقع ذلك في المحلّ نفسه" — P1.2 حسمت أن قراءة الإشارة أثر للمكان لا الجهاز.
{
  const syntheticFail = {testId: 'N-10', categoryName: 'wireless', status: 'fail', rawValue: '-90', rawValueUnit: 'dBm'};
  const tr = toTestResult(syntheticFail, null, null, {});
  eq(tr.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٦-١] N-10 fail → outcome=NOT_MEASURED (لا FAIL يدخل STATE_FAIL_FLOOR)');
  eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٦-١] N-10 fail → ENVIRONMENT_UNSUITABLE (نفس مصير warning)');
  eq(tr.displayValueDespiteNotMeasured, true, '[اصطناعي][القرار ٨٦-١] N-10 fail: الرقم يُعرض رغم NOT_MEASURED');
  // healthBearing/kind لا يتغيّران — N-10 يبقى STATE عادياً؛ التمييز في
  // outcome/notMeasuredReason فقط (لا يدخل computeHealthBearingStats.executed
  // بعد الآن لأن outcome ليس PASS/FAIL/WARNING — راجع الاختبار الكامل في
  // categoryStates.test.js لأثر هذا على حرف wireless فعلياً).
  eq(tr.kind, 'STATE', '[اصطناعي][القرار ٨٦-١] N-10: kind يبقى STATE (لا تغيير في التصنيف، فقط في outcome)');
  eq(tr.healthBearing, true, '[اصطناعي][القرار ٨٦-١] N-10: healthBearing يبقى true (التصنيف لم يتغيّر)');
}

// ═══════════════════════════════════════════════════════════════════════
// 5-ب. اصطناعي مُعلَّم — N-05 warning/fail (نفس معاملة N-10، فئة cellular)
// أمر مستخدم 2026-09-25 +03 (القرار ٨٦ البند ١، الالتزام الثاني) — منقول
// من تقرير مدقّق على NeuralChek@b3e46cf (مستودع آخر، غير مُتحقَّق من هذا
// المستودع، القاعدة 27/29): "التطبيق يرسل fail حين level==0، وwarning حين
// level 1..2 (NetworkTests.kt:172-176)." rawValue هنا بصيغة "مستوى/أقصى"
// كما وصلت فعلاً في الفخّ الذهبي لـN-05 نفسه ("3/4" — functionalResults-
// by-scanid.json)، لا dBm (ذلك N-10 وحده).
// ═══════════════════════════════════════════════════════════════════════
console.log('[اصطناعي] N-05 warning/fail غائبان من كل الفِخاخ المتاحة (كلاهما pass) — لا اختبار ذهبي عليهما.');
{
  const syntheticWarning = {testId: 'N-05', categoryName: 'cellular', status: 'warning', rawValue: '1/4', rawValueUnit: ''};
  const tr = toTestResult(syntheticWarning, null, null, {});
  eq(tr.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٦-١] N-05 warning → outcome=NOT_MEASURED');
  eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٦-١] N-05 warning → ENVIRONMENT_UNSUITABLE');
  eq(tr.displayValueDespiteNotMeasured, true, '[اصطناعي][القرار ٨٦-١] N-05 warning: الرقم يُعرض رغم NOT_MEASURED');
}
{
  const syntheticFail = {testId: 'N-05', categoryName: 'cellular', status: 'fail', rawValue: '0/4', rawValueUnit: ''};
  const tr = toTestResult(syntheticFail, null, null, {});
  eq(tr.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٦-١] N-05 fail → outcome=NOT_MEASURED (لا FAIL يدخل STATE_FAIL_FLOOR على cellular)');
  eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٦-١] N-05 fail → ENVIRONMENT_UNSUITABLE');
  eq(tr.displayValueDespiteNotMeasured, true, '[اصطناعي][القرار ٨٦-١] N-05 fail: الرقم يُعرض رغم NOT_MEASURED');
  eq(tr.kind, 'STATE', '[اصطناعي][القرار ٨٦-١] N-05: kind يبقى STATE');
  eq(tr.healthBearing, true, '[اصطناعي][القرار ٨٦-١] N-05: healthBearing يبقى true');
}

// ═══════════════════════════════════════════════════════════════════════
// 5-ج. اصطناعي مُعلَّم — N-06 (اسم المشغّل، cellular)، N-08 (Wi-Fi متّصل،
// wireless)، L-02/L-03 (كل الفروع، gps) — أمر مستخدم 2026-09-25 +03
// (القرار ٨٧ البند ١، يحلّ محلّ القرار ٨٦-١ الجزئي). راجع تعليق تعريف
// ENVIRONMENT_EFFECT_IDS في testKinds.js للتفصيل والمصدر الكامل.
//
// N-06/N-08: **لا fail حقيقي لهما** (نصّ الأمر) — warning فقط واقعياً.
// فرع fail هنا دفاعي محض (توثيق "الخادم يقلب ما يصله" بصرف النظر عمّا
// يُنتجه التطبيق فعلياً)، لا مطابقة لمُنتِج حقيقي — مُعلَّم صراحة أدناه،
// لا يُموَّه كأنه قيمة واقعية (القاعدة الجديدة المنقولة: "كل عيّنة
// اصطناعية تطابق ما يُنتجه مُنتِجها الحقيقي" — وحيث لا مُنتِج حقيقي، يُعلَن
// ذلك بدل الادّعاء).
// ═══════════════════════════════════════════════════════════════════════
console.log('[اصطناعي] N-06/N-08/L-02/L-03 — جميعها pass في كل الفِخّاخ المتاحة — لا اختبار ذهبي على fail/warning لأيّ منها.');
{
  // warning حقيقي: اسم مشغّل فارغ والشريحة موجودة — rawValue فارغ يطابق
  // "اسم المشغّل فارغ" حرفياً (rawValue الحقيقي حين ينجح: اسم المشغّل،
  // "Turkcell" — functionalResults-by-scanid.json).
  const warn = {testId: 'N-06', categoryName: 'cellular', status: 'warning', rawValue: '', rawValueUnit: ''};
  const trWarn = toTestResult(warn, null, null, {});
  eq(trWarn.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٧-١] N-06 warning → outcome=NOT_MEASURED');
  eq(trWarn.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٧-١] N-06 warning → ENVIRONMENT_UNSUITABLE');

  // fail دفاعي — لا مُنتِج حقيقي له (أعلاه). rawValue بلا ادّعاء واقعية.
  const fail = {testId: 'N-06', categoryName: 'cellular', status: 'fail', rawValue: '', rawValueUnit: ''};
  const trFail = toTestResult(fail, null, null, {});
  eq(trFail.outcome, 'NOT_MEASURED', '[اصطناعي][دفاعي، لا مُنتِج حقيقي][القرار ٨٧-١] N-06 fail → outcome=NOT_MEASURED');
  eq(trFail.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][دفاعي][القرار ٨٧-١] N-06 fail → ENVIRONMENT_UNSUITABLE');
}
{
  // warning حقيقي: Wi-Fi مفعّل وغير متّصل. rawValue الوصفي هنا غير
  // مؤكَّد حرفياً من هذا المستودع (النصّ الدقيق الذي يرسله NetworkTests.kt
  // غير مُتحقَّق) — الحالة (status) هي ما يحكم التصنيف، لا نصّ rawValue.
  const warn = {testId: 'N-08', categoryName: 'wireless', status: 'warning', rawValue: 'غير متصل', rawValueUnit: ''};
  const trWarn = toTestResult(warn, null, null, {});
  eq(trWarn.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٧-١] N-08 warning → outcome=NOT_MEASURED');
  eq(trWarn.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٧-١] N-08 warning → ENVIRONMENT_UNSUITABLE');

  // fail دفاعي — لا مُنتِج حقيقي له (أعلاه).
  const fail = {testId: 'N-08', categoryName: 'wireless', status: 'fail', rawValue: 'غير متصل', rawValueUnit: ''};
  const trFail = toTestResult(fail, null, null, {});
  eq(trFail.outcome, 'NOT_MEASURED', '[اصطناعي][دفاعي، لا مُنتِج حقيقي][القرار ٨٧-١] N-08 fail → outcome=NOT_MEASURED');
  eq(trFail.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][دفاعي][القرار ٨٧-١] N-08 fail → ENVIRONMENT_UNSUITABLE');
}
{
  // L-02/L-03: "كل الفروع" — notes لا تُميِّز هنا عمداً (نصّ الأمر: تصنيف
  // بنصّ notes مرفوض). لا rawValue/notes حقيقيّين معروفين لفرعَي fail/
  // warning من هذا المستودع (الفخّ الوحيد المتاح لهما not_tested) — القيم
  // أدناه اصطناعية بلا ادّعاء مطابقة مُنتِج حقيقي، ومقصودة لإثبات أن notes
  // (غائبة هنا كلّياً) لا تُغيّر النتيجة.
  for (const testId of ['L-02', 'L-03']) {
    for (const status of ['warning', 'fail']) {
      const synthetic = {testId, categoryName: 'gps', status, rawValue: 'N/A', rawValueUnit: ''};
      const tr = toTestResult(synthetic, null, null, {});
      eq(tr.outcome, 'NOT_MEASURED', `[اصطناعي][القرار ٨٧-١] ${testId} ${status} (بلا notes) → outcome=NOT_MEASURED`);
      eq(tr.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', `[اصطناعي][القرار ٨٧-١] ${testId} ${status} → ENVIRONMENT_UNSUITABLE`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5-د. اصطناعي مُعلَّم — SN-08 (كاشف الخطوات، sensors) — أمر مستخدم
// 2026-09-25 +03 (القرار ٨٧ البند ١، تتمّة — حكم مدقّق منقول عن
// SensorTests.kt:39,99-103 في NeuralChek، مستودع آخر، غير مُتحقَّق من هذا
// المستودع، القاعدة 27/29): فرع WARNING "لا قراءة" يدلّ على سكون الجهاز
// أثناء الفحص (حالة الفحص لا الجهاز) — "البروتوكول لا يضبطه، فالمشي
// يناقض الضغط الجاري." **لا fail حقيقي لها** (نفس ملاحظة N-06/N-08/SN-08) —
// فرع fail هنا دفاعي محض، مُعلَّم صراحة.
// ═══════════════════════════════════════════════════════════════════════
console.log('[اصطناعي] SN-08 غائبة من كل الفِخّاخ المتاحة بحالة "unavailable" — لا اختبار ذهبي على fail/warning لها.');
{
  const warn = {testId: 'SN-08', categoryName: 'sensors', status: 'warning', rawValue: 'لا قراءة', rawValueUnit: ''};
  const trWarn = toTestResult(warn, null, null, {});
  eq(trWarn.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٧-١ تتمّة] SN-08 warning → outcome=NOT_MEASURED');
  eq(trWarn.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٧-١ تتمّة] SN-08 warning → ENVIRONMENT_UNSUITABLE');

  const fail = {testId: 'SN-08', categoryName: 'sensors', status: 'fail', rawValue: 'لا قراءة', rawValueUnit: ''};
  const trFail = toTestResult(fail, null, null, {});
  eq(trFail.outcome, 'NOT_MEASURED', '[اصطناعي][دفاعي، لا مُنتِج حقيقي][القرار ٨٧-١ تتمّة] SN-08 fail → outcome=NOT_MEASURED');
  eq(trFail.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][دفاعي][القرار ٨٧-١ تتمّة] SN-08 fail → ENVIRONMENT_UNSUITABLE');
}

// ═══════════════════════════════════════════════════════════════════════
// 5-هـ. اصطناعي مُعلَّم — SN-03 (مستشعر القرب) وSN-09 (عدّاد الخطوات) —
// أمر مستخدم 2026-09-25 +03 (القرار ٨٨ البند ١): "SN-09: يُقلب بكل
// فروعه." · "SN-03: يُقلب تحذيره كلّه، بفرعيه." التعليل: "فرع 'لا قراءة'
// غير محسوم بقياس جهاز واحد، والخادم لا يميّز الفرعين إلا بنصّ مترجم —
// نفس ما حُسم في L-02/L-03." **warning فقط لكليهما** — حكم مدقّق منقول:
// "لا فرع fail في testSensor، والوحيد في الملفّ :172 لـSN-13" — فلا فرع
// fail دفاعي هنا (خلافاً لِـN-06/N-08/SN-08، حيث طُلب صراحة رغم غياب
// مُنتِج حقيقي؛ هنا الشرط الصريح "إن وُجد له فرع fail" غير محقَّق).
// notes مختلفة عمداً بين الاستدعاءين لإثبات أن "الفرعين" (مهما اختلف
// نصّهما) يُعامَلان معاملة واحدة — لا تمييز بالاسم.
// ═══════════════════════════════════════════════════════════════════════
{
  const sn03 = {testId: 'SN-03', categoryName: 'sensors', status: 'warning', rawValue: '0.00', rawValueUnit: '', notes: '0 readings'};
  const trSn03 = toTestResult(sn03, null, null, {});
  eq(trSn03.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٨-١] SN-03 warning → outcome=NOT_MEASURED');
  eq(trSn03.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٨-١] SN-03 warning → ENVIRONMENT_UNSUITABLE');

  const sn09 = {testId: 'SN-09', categoryName: 'sensors', status: 'warning', rawValue: 'لا قراءة', rawValueUnit: ''};
  const trSn09 = toTestResult(sn09, null, null, {});
  eq(trSn09.outcome, 'NOT_MEASURED', '[اصطناعي][القرار ٨٨-١] SN-09 warning → outcome=NOT_MEASURED');
  eq(trSn09.notMeasuredReason, 'ENVIRONMENT_UNSUITABLE', '[اصطناعي][القرار ٨٨-١] SN-09 warning → ENVIRONMENT_UNSUITABLE');
}

// ═══════════════════════════════════════════════════════════════════════
// 6. اصطناعي مُعلَّم — الفحوص اليدوية (manualResults غائبة من كل الفِخاخ)
// ═══════════════════════════════════════════════════════════════════════
console.log('[اصطناعي] هذا القسم اصطناعي (توقيت startedAt/durationMs لا تحمله عيّنة). حالات اليدوي الخمس بالصفوف الحقيقية (عيّنات fv69) في manualStatusesFourValues.test.js.');
{
  const withTiming = {testId: 'M-01', categoryName: 'display', status: 'pass', startedAt: 1000, durationMs: 4000};
  const trTiming = toTestResult(withTiming, null, null, {isManual: true});
  eq(trTiming.attested, true, '[اصطناعي] فحص يدوي: attested=true');
  eq(trTiming.confidence, 'HALF_WEIGHT_ATTESTED', '[اصطناعي] فحص يدوي: نصف وزن');
  eq(trTiming.attestedLabel, null, '[اصطناعي] فحص يدوي بتوقيت: لا وسم "بشهادة الفنّي"');

  const withoutTiming = {testId: 'M-01', categoryName: 'display', status: 'pass'};
  const trNoTiming = toTestResult(withoutTiming, null, null, {isManual: true});
  eq(trNoTiming.attestedLabel, 'بشهادة الفنّي', '[اصطناعي] فحص يدوي بلا توقيت (fv≤67): وسم "بشهادة الفنّي"');
  eq(trNoTiming.outcome, 'PASS', '[اصطناعي] فحص يدوي بلا توقيت: outcome يبقى PASS');
}

console.log(`\ntestKinds.test.js: ${n}/${n} assertions passed`);
