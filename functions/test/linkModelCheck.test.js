'use strict';

// linkModelCheck.test.js — ملاحظة الطراز LINK_MODEL_MISMATCH على «بعد» حين يختلف طراز تقريرَي الزوج (ق36 أ، أقرّه حسن بتاريخ 2026-10-22؛ أمر المنسّق للمرحلة S10). بلا شبكة ولا محاكٍ.
//
// القرار (منقول عن أمر المنسّق، ومصدره DECISIONS-FOR-HASAN-2026-10-21.md:333-338 [منقول، غير متحقَّق من هذا المستودع]): «ابنِ ملاحظة LINK_MODEL_MISMATCH على «بعد» حين يختلف طراز تقريرَي الزوج، بلا رفض ولا نصّ (+0.25 يوم خادم)».
// الشروط من الأمر: المقارنة عند اكتمال «بعد» التي حُلّ هدف ربطها، بحقل الطراز الذي يعتمده المستودع فعلاً (القاعدة 31)؛ لا رفض ولا تأخير ولا نصّ للفنّي؛ لا حقل جديد على السلك؛ الغياب حالة صريحة (القاعدة 22).
//
// **هذا الملفّ يعدّ الإخفاق ولا يرمي عند أول واحد** (كُتب قبل البناء، القاعدة 18/23: يُسجَّل عدد الفاشل على b0a0f66 ثم يمرّ كلّه بعد البناء): كل قيد فيه t(...) مستقلّ، والاستثناء داخله يُعدّ إخفاقاً واحداً.
//
//   ١ المفردات والاسم: LINK_MODEL_CHECK وSCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK — مصدر واحد (القاعدة 24): لا حرفية LINK_MODEL_* ولا "linkModelCheck" في src إلا في موضعها
//   ٢ readModelIdentity: ما يُعدّ طرازاً وما يُعدّ غياباً (المقارنة حرفية: لا مطبِّع طراز في المستودع)
//   ٣ decideLinkModelCheck: جدول الحالات الثلاث بكل أشكال الغياب، وتماثل الوسيطين، وغياب المدخل
//   ٤ احتياطيّات المستودع الحرفية للطراز المفقود (MODEL_FALLBACK_LITERALS) تُثبَّت بمسح src: احتياطي جديد يُفشل الاختبار (القاعدة 22 + 26)
//   ٥ decidePairCompletion: modelCheck على LINKED وحدها، ولا مقارنة بلا هدف، والحقل في afterFields عند LINKED وحدها
//
// Run: node functions/test/linkModelCheck.test.js

process.env.SMTP_USER = process.env.SMTP_USER || 'dummy@x.com';
process.env.SMTP_PASS = process.env.SMTP_PASS || 'dummy';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const failures = [];
const t = (label, fn) => {
  n++;
  try { fn(); } catch (e) { failures.push(`${label} — ${String((e && e.message) || e).split('\n')[0].slice(0, 220)}`); }
};
const eq = (a, b) => assert.strictEqual(a, b);
const deq = (a, b) => assert.deepStrictEqual(a, b);
const ok = (c, m) => assert.ok(c, m);

const V = require('../src/protocol/protocolVocabulary');
const P = require('../src/protocol/protocolCorrection');
const MP = require('../src/protocol/maintenancePair');

const MATCH = 'LINK_MODEL_MATCH';
const MISMATCH = 'LINK_MODEL_MISMATCH';
const ABSENT = 'LINK_MODEL_ABSENT';

// ═══ ١ — المفردات والاسم ═══
t('[١] LINK_MODEL_CHECK مجموعة مُصدَّرة بقيمها الثلاث', () => deq({...V.LINK_MODEL_CHECK}, {MATCH, MISMATCH, MODEL_ABSENT: ABSENT}));
t('[١] LINK_MODEL_CHECK مجمَّدة', () => ok(Object.isFrozen(V.LINK_MODEL_CHECK), 'غير مجمَّدة'));
t('[١] قيمة MISMATCH هي نصّ الأمر LINK_MODEL_MISMATCH حرفياً', () => eq(V.LINK_MODEL_CHECK.MISMATCH, 'LINK_MODEL_MISMATCH'));
t('[١] القيم الثلاث فريدة وبادئتها LINK_MODEL_', () => {
  const vals = Object.values(V.LINK_MODEL_CHECK);
  eq(new Set(vals).size, 3);
  ok(vals.every((v) => typeof v === 'string' && v.startsWith('LINK_MODEL_')), 'بادئة');
});
t('[١] SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK = "linkModelCheck"', () => eq(P.SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK, 'linkModelCheck'));

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/ .*$/gm, '$1');
const SRC = path.join(__dirname, '..', 'src');
const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, {withFileTypes: true})) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.js$/.test(e.name)) srcFiles.push(p);
  }
})(SRC);
const sourceOf = (f) => strip(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
t('[١] ماسح المصدر حيّ (ضابط): يجد الملفّات ويجد "LINK_STATE" في مصدر معروف', () => {
  ok(srcFiles.length > 100, `عدد الملفّات ${srcFiles.length}`);
  ok(srcFiles.some((f) => path.basename(f) === 'protocolVocabulary.js' && /LINK_STATE/.test(sourceOf(f))), 'ضابط');
});
t('[١] حرفية LINK_MODEL_* (بين علامتَي اقتباس) لا تظهر في src إلا في protocolVocabulary.js (القاعدة 24: مصدر واحد)', () => {
  const owners = srcFiles.filter((f) => /["'`]LINK_MODEL_[A-Z_]*["'`]/.test(sourceOf(f))).map((f) => path.basename(f)).sort();
  deq(owners, ['protocolVocabulary.js']);
});
t('[١] حرفية "linkModelCheck" المقتبسة لا تظهر في src إلا في protocolCorrection.js (اسم الحقل: SCAN_PROTOCOL_FIELD)', () => {
  const owners = srcFiles.filter((f) => /["'`]linkModelCheck["'`]/.test(sourceOf(f))).map((f) => path.basename(f)).sort();
  deq(owners, ['protocolCorrection.js']);
});
t('[١] ولا يذكر أيّ ملفّ تحت src/reports الحقل ولا الحالات (لا يصل العميل ولا الزائر)', () => {
  const dir = path.join(SRC, 'reports');
  const bad = fs.readdirSync(dir).filter((f) => /\.js$/.test(f)).filter((f) => /linkModelCheck|LINK_MODEL_|LINK_MODEL_CHECK/.test(sourceOf(path.join(dir, f))));
  deq(bad, []);
});

// ═══ ٢ — readModelIdentity ═══
const RMI = (v) => MP.readModelIdentity(v);
for (const [label, input, want] of [
  ['طراز عادي', {deviceModel: 'SM-A135F'}, 'SM-A135F'],
  ['طراز بأحرف صغيرة يبقى كما هو (لا مطبِّع)', {deviceModel: 'sm-a135f'}, 'sm-a135f'],
  ['مسافة محيطة تبقى (لا قصّ: المقارنة حرفية كـresolveMarketingName)', {deviceModel: ' SM-A135F '}, ' SM-A135F '],
  ['UNKNOWN بأحرف كبيرة ليس احتياطي المستودع فهو طراز', {deviceModel: 'UNKNOWN'}, 'UNKNOWN'],
  ['"Unknown" محاطة بمسافات ليست احتياطي المستودع الحرفي: طراز كما كُتب (الاحتياطي مطابقة تامّة)', {deviceModel: ' Unknown '}, ' Unknown '],
  ['"UNKNOWN" بأحرف كبيرة ليست الاحتياطي أيضاً (مطابقة تامّة لا بلا اعتبار الحالة)', {deviceModel: 'unKnown'}, 'unKnown'],
  ['Unknown وحدها (احتياطي المستودع) ⟵ غياب', {deviceModel: 'Unknown'}, null],
  ['unknown وحدها (الاحتياطي الآخر) ⟵ غياب', {deviceModel: 'unknown'}, null],
  ['نصّ فارغ ⟵ غياب', {deviceModel: ''}, null],
  ['مسافات فقط ⟵ غياب', {deviceModel: '   '}, null],
  ['تبويب وسطر جديد فقط ⟵ غياب', {deviceModel: '\t\n'}, null],
  ['null ⟵ غياب', {deviceModel: null}, null],
  ['undefined ⟵ غياب', {deviceModel: undefined}, null],
  ['رقم ⟵ غياب', {deviceModel: 5}, null],
  ['كائن ⟵ غياب', {deviceModel: {model: 'X'}}, null],
  ['مصفوفة ⟵ غياب', {deviceModel: ['X']}, null],
  ['منطقي ⟵ غياب', {deviceModel: true}, null],
  ['مستند بلا الحقل ⟵ غياب', {userId: 'u'}, null],
  ['مستند فارغ ⟵ غياب', {}, null],
  ['undefined (لا مستند) ⟵ غياب', undefined, null],
  ['null (لا مستند) ⟵ غياب', null, null],
  ['نصّ بدل مستند ⟵ غياب', 'SM-A135F', null],
  ['مصفوفة بدل مستند ⟵ غياب', ['SM-A135F'], null],
]) t(`[٢] readModelIdentity: ${label}`, () => eq(RMI(input), want));
t('[٢] الحقل المقروء من REPORT_FIELD.DEVICE_MODEL (مصدر واحد: لا حرفية ثانية)', () => {
  eq(MP.REPORT_FIELD.DEVICE_MODEL, 'deviceModel');
  const src = sourceOf(path.join(SRC, 'protocol', 'maintenancePair.js'));
  const fn = src.slice(src.indexOf('function readModelIdentity'), src.indexOf('function decideLinkModelCheck'));
  ok(fn.length > 30 && /REPORT_FIELD\.DEVICE_MODEL/.test(fn) && !/["']deviceModel["']/.test(fn), 'readModelIdentity لا تقرأ الاسم حرفاً');
});

// ═══ ٣ — decideLinkModelCheck ═══
const DLM = (a, b) => MP.decideLinkModelCheck({afterReportData: a, beforeReportData: b});
const A = 'SM-A135F';
for (const [label, after, before, want] of [
  ['طرازان متطابقان', {deviceModel: A}, {deviceModel: A}, MATCH],
  ['طرازان مختلفان', {deviceModel: A}, {deviceModel: 'SM-S918B'}, MISMATCH],
  ['حالة الأحرف وحدها تُفرّق (حرفية بلا مطبِّع)', {deviceModel: A}, {deviceModel: 'sm-a135f'}, MISMATCH],
  ['مسافة زائدة وحدها تُفرّق', {deviceModel: A}, {deviceModel: `${A} `}, MISMATCH],
  ['بلا حقل طراز في «بعد»', {}, {deviceModel: A}, ABSENT],
  ['بلا حقل طراز في «قبل»', {deviceModel: A}, {}, ABSENT],
  ['بلا مستند «بعد»', undefined, {deviceModel: A}, ABSENT],
  ['بلا مستند «قبل»', {deviceModel: A}, undefined, ABSENT],
  ['null بدل مستند «قبل»', {deviceModel: A}, null, ABSENT],
  ['الطرازان غائبان معاً ليس «متطابق» (القاعدة 22)', {}, {}, ABSENT],
  ['لا مستندان', undefined, undefined, ABSENT],
  ['طراز «قبل» "Unknown"', {deviceModel: A}, {deviceModel: 'Unknown'}, ABSENT],
  ['طراز «بعد» "unknown"', {deviceModel: 'unknown'}, {deviceModel: A}, ABSENT],
  ['"Unknown" في الطرفين: لا يتطابق «مجهول» مع «مجهول»', {deviceModel: 'Unknown'}, {deviceModel: 'Unknown'}, ABSENT],
  ['"Unknown" و"unknown": غياب لا اختلاف', {deviceModel: 'Unknown'}, {deviceModel: 'unknown'}, ABSENT],
  ['نصّ فارغ في «قبل»', {deviceModel: A}, {deviceModel: ''}, ABSENT],
  ['مسافات في «بعد»', {deviceModel: '  '}, {deviceModel: A}, ABSENT],
  ['رقم في «قبل»: غياب لا اختلاف', {deviceModel: A}, {deviceModel: 7}, ABSENT],
  ['كائن في «بعد»', {deviceModel: {x: 1}}, {deviceModel: A}, ABSENT],
]) {
  t(`[٣] decideLinkModelCheck: ${label}`, () => eq(DLM(after, before), want));
  t(`[٣] وتماثل الوسيطين: ${label}`, () => eq(DLM(before, after), want));
}
t('[٣] بلا وسيط ولا مفاتيح ⟵ ABSENT صريحة لا رمي ولا قيمة افتراضية', () => {
  eq(MP.decideLinkModelCheck({}), ABSENT);
  eq(MP.decideLinkModelCheck(), ABSENT);
});
t('[٣] مخرَجها دائماً إحدى مفردات LINK_MODEL_CHECK (لا null ولا undefined)', () => {
  const all = Object.values(V.LINK_MODEL_CHECK);
  for (const [a, b] of [[{deviceModel: A}, {deviceModel: A}], [{deviceModel: A}, {deviceModel: 'B'}], [{}, {}], [undefined, null]]) ok(all.includes(DLM(a, b)), 'خارج المفردات');
});
t('[٣] لا تعدّل مدخليها', () => {
  const a = Object.freeze({deviceModel: A});
  const b = Object.freeze({deviceModel: 'B'});
  eq(DLM(a, b), MISMATCH);
});

// ═══ ٤ — احتياطيّات المستودع الحرفية للطراز المفقود ═══
// المصدر الواحد MODEL_FALLBACK_LITERALS؛ ويثبّته مسح src: كل `device.model || "X"` أو `device?.model ?? "X"` في src (طراز **الجهاز** من البصمة؛ لا `envelope.model` وهو طراز مزوّد النموذج في سطر سجلّ) يجب أن يكون X من القائمة، وكل عضو في القائمة يظهر في src (لا عضو ميّت).
const FALLBACK_SITE = /device\??\.model\s*(?:\|\||\?\?)\s*(["'`])([^"'`]*)\1/g;
const scanFallbacks = (text) => [...text.matchAll(FALLBACK_SITE)].map((m) => m[2]);
t('[٤] MODEL_FALLBACK_LITERALS = ["Unknown","unknown"] مجمَّدة', () => {
  deq([...MP.MODEL_FALLBACK_LITERALS], ['Unknown', 'unknown']);
  ok(Object.isFrozen(MP.MODEL_FALLBACK_LITERALS), 'غير مجمَّدة');
});
t('[٤] ماسح الاحتياطيّات حيّ (ضابط، القاعدة 26): يجد احتياطياً مختلقاً في نصّ اصطناعي', () => {
  deq(scanFallbacks('const m = fingerprint?.device?.model || "N/A";'), ['N/A']);
  deq(scanFallbacks("rawDeviceModel: fp.device.model ?? 'none',"), ['none']);
  deq(scanFallbacks('const x = a.modelName || "b"; const y = model || "c";'), []);
  deq(scanFallbacks('model=${envelope.model || "?"}'), []); // طراز مزوّد النموذج في سطر سجلّ (callDeepSeek) ليس طراز جهاز
  deq(scanFallbacks('const deviceModel = fingerprint?.device?.model || "Unknown"; const g = fp.device.model || "unknown";'), ['Unknown', 'unknown']);
});
const found = [];
for (const f of srcFiles) for (const lit of scanFallbacks(sourceOf(f))) found.push({file: path.basename(f), lit});
t('[٤] المسح يجد مواضع الاحتياطي الثمانية المعروفة على الأقلّ (ليس أعمى)', () => ok(found.length >= 8, `وجد ${found.length}`));
t('[٤] **كل احتياطي في src من القائمة**: احتياطي طراز جديد ("N/A" مثلاً) يُفشل هذا الاختبار حتى يُدرَج ويُقرَّر أنه غياب', () => {
  const stray = found.filter((x) => !MP.MODEL_FALLBACK_LITERALS.includes(x.lit));
  deq(stray, []);
});
t('[٤] وكل عضو في القائمة مستعمَل في src (لا عضو ميّت)', () => {
  for (const lit of MP.MODEL_FALLBACK_LITERALS) ok(found.some((x) => x.lit === lit), `${lit} غير مستعمَل`);
});

// ═══ ٥ — decidePairCompletion ═══
const completion = (over = {}) => MP.decidePairCompletion({
  afterScanId: 'after-1', afterDefectType: 'BATTERY', beforeScanId: 'before-1', linkedDocs: [],
  beforeData: {scanPurpose: 'maintenance_before', defectType: 'BATTERY', pair: {state: 'OPEN', ownerId: 'o', openedAt: {toMillis: () => 1}}},
  beforeReportData: {deviceModel: A}, afterReportData: {deviceModel: A}, ...over,
});
t('[٥] LINKED + طرازان متطابقان ⟵ modelCheck MATCH وfield في afterFields', () => {
  const r = completion();
  eq(r.outcome, 'LINKED');
  eq(r.modelCheck, MATCH);
  eq(r.afterFields[P.SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK], MATCH);
});
t('[٥] LINKED + طرازان مختلفان ⟵ MISMATCH، ولا يتغيّر شيء آخر في القرار (الربط active كما هو)', () => {
  const r = completion({afterReportData: {deviceModel: 'SM-S918B'}});
  eq(r.outcome, 'LINKED');
  eq(r.reason, null);
  eq(r.modelCheck, MISMATCH);
  eq(r.afterFields[P.SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK], MISMATCH);
  eq(r.afterFields[P.SCAN_PROTOCOL_FIELD.LINK_STATE], 'active');
  ok(r.beforeUpdate !== null, 'التحديث على «قبل» باقٍ');
});
t('[٥] LINKED + تقرير «قبل» غائب (undefined) ⟵ ABSENT', () => eq(completion({beforeReportData: undefined}).modelCheck, ABSENT));
t('[٥] LINKED + تقرير «بعد» غائب ⟵ ABSENT', () => eq(completion({afterReportData: undefined}).modelCheck, ABSENT));
t('[٥] LINKED + المعاملان غائبان من النداء ⟵ ABSENT لا رمي (الغياب حالة)', () => {
  const r = MP.decidePairCompletion({afterScanId: 'a', afterDefectType: 'BATTERY', beforeScanId: 'b', linkedDocs: [], beforeData: {scanPurpose: 'maintenance_before', defectType: 'BATTERY', pair: {state: 'OPEN', ownerId: 'o', openedAt: {toMillis: () => 1}}}});
  eq(r.outcome, 'LINKED');
  eq(r.modelCheck, ABSENT);
});
for (const [label, over] of [
  ['«قبل» غائبة', {beforeData: null}],
  ['غرض «قبل» خاطئ', {beforeData: {scanPurpose: 'battery_before', defectType: 'BATTERY', pair: {state: 'OPEN', ownerId: 'o', openedAt: {toMillis: () => 1}}}}],
  ['نوع «قبل» مختلف', {afterDefectType: 'THERMAL'}],
  ['pair «قبل» COMPLETED', {beforeData: {scanPurpose: 'maintenance_before', defectType: 'BATTERY', pair: {state: 'COMPLETED', ownerId: 'o', openedAt: {toMillis: () => 1}, completedByScanId: 'x'}}}],
  ['ربط حيّ من «بعد» أخرى', {linkedDocs: [{linkedScanId: 'before-1', linkState: 'active'}]}],
]) {
  t(`[٥] TARGET_LOST (${label}) ⟵ لا مقارنة: modelCheck null ولو اختلف الطرازان، وبلا linkModelCheck في afterFields`, () => {
    const r = completion({...over, afterReportData: {deviceModel: 'DIFFERENT'}});
    eq(r.outcome, 'TARGET_LOST');
    eq(r.modelCheck, null);
    ok(!(P.SCAN_PROTOCOL_FIELD.LINK_MODEL_CHECK in r.afterFields), 'afterFields فيها linkModelCheck');
    eq(r.afterFields[P.SCAN_PROTOCOL_FIELD.LINK_STATE], 'missing');
    eq(r.beforeUpdate, null);
  });
}

if (failures.length > 0) {
  console.error(`\nlinkModelCheck.test.js: ${failures.length} FAILED of ${n}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`linkModelCheck.test.js: ${n}/${n} assertions passed`);
