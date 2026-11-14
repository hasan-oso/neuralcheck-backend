'use strict';

// fv71M02FrameXReader.test.js — قارئ M-02 «إطار + X» (المجموعة المطلوبة جزء من الشبكة): gridPattern وnotRequiredCells، العلاقات الجديدة، الغياب NOT_DECLARED بلا شذوذ، الحدّ الأدنى للإطار.
// أمر الباك اند ٤، 2026-10-21 +03 (القواعد 7 و20 و22 و23 و24 و25 و30 و37 و39 و41).
//
// الحاكم: عقد السلك الواحد (wire-m02-frame-x-2026-10-21، البنود 1–8) منقولاً بحرفه في docs/FV71_CONTRACT_SECTION.md، الحاشية «تحديث 2026-10-21 (أمر وكيل التطبيق ٨)».
// **تحديث 2026-10-22 (نسخ القسم مرّتين، قرار المستخدم 2026-10-22):** نسخة القسم صارت NeuralChek@a0c4346 (docs/FV68_CONTRACT.md الأسطر 1800–2095: 296 سطراً، 100549 بايتاً، sha256 5a5bd071…)؛ كانت 3810146 (الأسطر نفسها، 100159 بايتاً، sha256 61658e5e…) وقبلها 4c0102c (1800–2074، 275 سطراً، sha256 0e234b4d…).
// 3810146 أضاف «الفقرة 2 المؤرَّخة 2026-10-21» (21 سطراً مضافة): خلية 4 مم وشريط علويّ فارغ وسطح اللمس = منطقة الشبكة. وa0c4346 عدّل سطرين وحدهما (246 و264 في النسخة) بوسم «حلّ محلّه» على بند السلك 6 وجدول 6 مم. فبصمة النسخة في [أ] أدناه حدّثت بالاستبدال في كل مرّة (القاعدة 39: الحارس يتبع العقد).
// **تحديث 2026-10-22 (أمر الباك اند ٧):** العيّنات الثلاث صارت من NeuralChek@3810146 (شكل اختبار اللمس في قائمة سامسونج: خلية مربّعة 4 مم، 18 عموداً، 33 صفّاً لـ11ch و35 لـ13ch و16ch، شريط علويّ فارغ، cutoutCells [8, 9, 26, 27])؛
// فاستُبدلت الأرقام المكتوبة باليد التي كانت تصف العيّنات السابقة (4c0102c: 12×24، 108/106 مطلوبة، 180 غير مطلوبة، 75 ملموسة، cutout [5, 6]) — القاعدة 23: بالاستبدال لا بالإضافة — بأرقام عدٍّ مستقلّ من الملفّ نفسه
// (عيّنة نقطية بسكربت مؤقّت خارج المستودع، لا من مخرَج القارئ): 11ch: 594 خلية = 188 مطلوبة + 406 غير مطلوبة، يلمس مسارها الـ594 كلّها · 13ch: 630 = 194 + 432 + 4 مقصاة، 97 ملموسة (و213 غير مطلوبة ملموسة) · 16ch: 630 = 194 + 432 + 4، 6 ملموسة (و12 غير مطلوبة).
// **القارئ حقيقي في كل موضع هنا (القاعدة 37)**: readFv68 وanalyzeTouchPath وdeviceCheck03After.evaluateReport بلا مُستبدِل، على العيّنات الذهبية الثلاث من **المُنتِج الحقيقي** (NeuralChek@3810146؛ كانت 4c0102c) وعلى
// نسختين حقيقيتين من المُنتِج السابق (f9e0571: بلا المفتاحين — ما يرسله بناء ≤ 324578f). وما يُعدَّل منها يُعدَّل بسطر مكتوب هنا (حمولة معدَّلة لا عيّنة مُنتِج، القاعدة 12).
//
// ما يثبّته:
//   أ) الأسماء كما في العقد (مكتوبة باليد، القاعدة 30) وفي نصّ القسم المنسوخ، ومصدرها الواحد fv68Names؛ وبصمة sha256 للقسم المنسوخ؛ والمفتاحان ليسا في TOUCH_PATH_FIELD_SPEC (غيابهما ليس شذوذاً) ومخفيّان عن النموذج.
//   ب) العيّنات الثلاث الحقيقية: DECLARED، صفر شذوذ، العلاقات 1–5 بعدّ مستقلّ من الحمولة، cells.state = MATCH، ولمسة المسار خارج المطلوب تُعدّ بجانبها ولا تدخل touchedCells.
//   جـ) **الغياب (البند 7)**: النسختان الحقيقيتان السابقتان تحت ختم 71: NOT_DECLARED بلا شذوذ، المفتاحان ABSENT_DECLARED في أعلى المخرَج (absences) لا ABSENT، وتبقى العلاقتان القديمتان بأسمائهما.
//   د) كل قيمة ممكنة لكل مفتاح (ثلاث قيم معروفة، وقيم خارجها، وأنواع خاطئة، وnull): كل حالة من TOUCH_GRID_PATTERN_STATE الخمس تُبلَغ، وكل أساس من TOUCH_GRID_REQUIRED_CELLS_BASIS الثلاثة.
//   هـ) كل علاقة تُكسَر على حدة فيظهر شذوذها بالاسم (وأيّ شذوذ تابع يُعدَّد صراحةً): العلاقة 2 · انفصال القائمتين · العلاقة 4 · الفهارس · الإطار على كل حافّة · ALL_CELLS مع قائمة غير فارغة.
//   و) الختم < 71 (البند 8): حضور المفتاحين شذوذ بالاسم تحت 67 و68 و69 و70 وبلا ختم؛ وغيابهما هو الحال (لا شذوذ ولا حالة جديدة).
//   ز) سكربت الفحص ٠٣ (checkM02 في deviceCheck03After.js): مقارنة touchedCells بـtotalCells صحيحة بالعقد الجديد (كلاهما للمطلوبة) — B2 وS1 على العيّنات الجديدة.
//   ح) كل اسم شذوذ من TOUCH_GRID_PATTERN_ANOMALY أُنتج فعلاً بهذا الاختبار (لا اسم معرَّف بلا اختبار).
//
// Run: node functions/test/fv71M02FrameXReader.test.js

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const R = require('../src/analysis/fv68Reader');
const {analyzeTouchPath} = require('../src/analysis/touchPath');
const {_internal: {sanitizeTestResultsForModelPayload}} = require('../src/analysis/buildV7Payload');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const C = require('../scripts/lib/deviceCheck03Common');
const D = require('../scripts/lib/deviceCheck03After');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const KS = N.KEY_STATUS;
const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
const DOCS = path.join(__dirname, '..', '..', 'docs');

// ─── العيّنات: الجديدة من المُنتِج (3810146) والسابقتان من المُنتِج السابق (f9e0571، قبل المفتاحين) ─────────────────────────────────────────────
const NEW_STEM = 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const OLD_STEM = 'fv71-before-m02-frame-x-app-request-payload-derived-from-fv67-golden-34dff2b8-';
const SUFFIX = {'11ch': '11ch-nothing-admitted.json', '13ch': '13ch-selinux-blocked-policy.json', '16ch': '16ch-four-policies-truncated-failures.json'};
const load = (stem, k) => JSON.parse(fs.readFileSync(path.join(GOLDEN, `${stem}${SUFFIX[k]}`), 'utf8'));
const NEW = Object.fromEntries(Object.keys(SUFFIX).map((k) => [k, load(NEW_STEM, k)]));
const OLD = {'11ch': load(OLD_STEM, '11ch'), '13ch': load(OLD_STEM, '13ch')};
const m02Of = (p) => p.manualResults.find((m) => m.testId === 'M-02');
const COMPLETE = () => clone(m02Of(NEW['11ch']).measurements); // pass · auto_complete · 18×33 · 188 مطلوبة
const DEAD = () => clone(m02Of(NEW['13ch']).measurements); //     fail · ثقب [8، 9، 26، 27] · 18×35 · 194 مطلوبة · 97 ملموسة
// غير المطلوبة في كل عيّنة جديدة (عدّ مستقلّ من الملفّ، 2026-10-22)
const NOT_REQUIRED_COUNT = {'11ch': 406, '13ch': 432, '16ch': 432};
const CAPPED = () => clone(m02Of(NEW['16ch']).measurements); //   not_tested · 15,000 نقطة
const OLD_COMPLETE = () => clone(m02Of(OLD['11ch']).measurements); // قبل «إطار + X»: 288 خليّة كلّها مطلوبة
const OLD_DEAD = () => clone(m02Of(OLD['13ch']).measurements); //     قبل «إطار + X»: ثقب [5، 6] · 286 مطلوبة · 208 ملموسة

const manualFp = (fv, rows) => ({timeSeries: {footer: fv === null ? {} : {fieldsVersion: fv}}, functionalResults: [], manualResults: rows});
const read = (fv, meas, status = 'pass') => R.readFv68(manualFp(fv, [{testId: 'M-02', categoryName: 'display', status, ...(meas === undefined ? {} : {measurements: meas})}]));
const tgOf = (o) => o.measurements.items.find((i) => i.testId === 'M-02').touchGrid;
const own = (o) => o.anomalies.filter((a) => a.section.startsWith('manualResults'));
const codes = (o) => own(o).map((a) => a.code);
const find = (o, code) => own(o).find((a) => a.code === code);

// كل اسم شذوذ جديد وكل حالة وأساس يُسجَّل حين يُبلَغ (البند «ح»/«د»: كل قيمة ممكنة تُجرَّب)
const reachedAnomalies = new Set();
const reachedStates = new Set();
const reachedBasis = new Set();
const track = (o) => {
  for (const a of o.anomalies) reachedAnomalies.add(a.code);
  const t = tgOf(o);
  if (t.path.gridPatternState !== undefined) {
    reachedStates.add(t.path.gridPatternState);
    if (t.path.requiredCellsBasis !== undefined) reachedBasis.add(t.path.requiredCellsBasis);
  }
  return o;
};
const readT = (...args) => track(read(...args));

// ═══ أ) الأسماء كما في العقد — مكتوبة باليد (القاعدة 30) ═══════════════════════════════════════════════════════════════
{
  eq(N.TOUCH_GRID_PATTERN_KEYS, {GRID_PATTERN: 'gridPattern', NOT_REQUIRED_CELLS: 'notRequiredCells'}, '[أ] المفتاحان: gridPattern وnotRequiredCells (البند «الإضافة»)');
  eq(Object.values(N.TOUCH_GRID_PATTERN), ['ALL_CELLS', 'FRAME_AND_DIAGONALS'], '[أ] قيمتا gridPattern: ALL_CELLS · FRAME_AND_DIAGONALS');
  eq(Object.values(N.TOUCH_GRID_PATTERN_STATE).sort(), ['DECLARED', 'INVALID_VALUE', 'NOT_DECLARED', 'ONE_KEY_ABSENT', 'WRONG_TYPE'], '[أ] حالات gridPatternState الخمس (ختم ≥ 71 وحده؛ تحت 71 لا حالة جديدة: كتلة path بحالتها)');
  eq(Object.values(N.TOUCH_GRID_REQUIRED_CELLS_BASIS).sort(), ['ALL_NON_CUTOUT_PATTERN_NOT_DECLARED', 'NOT_REQUIRED_CELLS_DECLARED', 'UNDETERMINED_PATTERN_NOT_READABLE'], '[أ] أساس المطلوب: ثلاثة');
  eq(Object.values(N.TOUCH_GRID_PATTERN_ANOMALY).sort(), [
    'TOUCH_GRID_CUTOUT_NOT_REQUIRED_OVERLAP', 'TOUCH_GRID_PATTERN_ALL_CELLS_WITH_NOT_REQUIRED', 'TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED', 'TOUCH_GRID_PATTERN_KEYS_INCOMPLETE',
    'TOUCH_GRID_PATTERN_KEYS_PRESENT_BEFORE_FV71', 'TOUCH_GRID_PATTERN_VALUE_INVALID', 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN', 'TOUCH_GRID_UNTOUCHED_CELL_NOT_REQUIRED'], '[أ] أسماء الشذوذ الجديدة الثمانية');
  eq(N.TOUCH_GRID_PATTERN_ANOMALY.FRAME_CELL_NOT_REQUIRED, 'TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED', '[أ] اسم شذوذ حدّ الإطار كما سمّاه العقد حرفاً');
  // نصّ القسم المنسوخ يحمل الأسماء والقيم (لا اسم من خارج العقد) وبصمته مثبَّتة (القاعدة 29)
  const sectionFile = path.join(DOCS, 'FV71_CONTRACT_SECTION.md');
  const section = fs.readFileSync(sectionFile, 'utf8');
  for (const key of ['gridPattern', 'notRequiredCells']) ok(section.includes(`\`${key}\``), `[أ] «${key}» في نصّ القسم المنسوخ`);
  for (const v of ['ALL_CELLS', 'FRAME_AND_DIAGONALS', 'NOT_DECLARED', 'gridPatternState', 'TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED', 'INVALID_VALUE']) ok(section.includes(v), `[أ] «${v}» في نصّ القسم المنسوخ`);
  ok(section.includes('تحديث 2026-10-21 (أمر وكيل التطبيق ٨'), '[أ] الحاشية المؤرَّخة 2026-10-21 (أمر وكيل التطبيق ٨) في النسخة');
  const SECTION_SHA256 = '5a5bd071566688cbb2dc403b8ededd72138fc88ac4901f9a6bf06621250fa7d9';
  eq(sha256Of(sectionFile), SECTION_SHA256, '[أ] sha256 للنسخة = المسجَّل في docs/FV71_CONTRACT_SECTION.SOURCE.txt (NeuralChek@a0c4346، الأسطر 1800–2095، 296 سطراً، 100549 بايتاً)');
  const sourceTxt = fs.readFileSync(path.join(DOCS, 'FV71_CONTRACT_SECTION.SOURCE.txt'), 'utf8');
  ok(sourceTxt.split('================ PREVIOUS RECORD')[0].includes(SECTION_SHA256), '[أ] وسجلّ SOURCE.txt الأعلى (الجاري، فوق أوّل فاصل «PREVIOUS RECORD») يحمل البصمة نفسها لا بصمة سجلّ سابق');
  for (const [prev, sha] of [['3810146', '61658e5e2e41ea969e7b9ba8d128b0dcd9b8c91adee78d20bb5250b1b601ff63'], ['4c0102c', '0e234b4d30fa9ecafffd631538c5cbf10d52dd68f568a3404a3383957b703d08']]) {
    ok(sourceTxt.split('================ PREVIOUS RECORD').slice(1).some((rec) => rec.includes(sha)), `[أ] وسجلّ النسخة السابقة (${prev}، بصمتها ${sha.slice(0, 8)}…) باقٍ تحت الأعلى حرفاً — القاعدة 8: لا يُحذف`);
  }
  ok(section.includes('الفقرة 2 المؤرَّخة 2026-10-21'), '[أ] «الفقرة 2 المؤرَّخة 2026-10-21» (شكل اختبار اللمس في قائمة سامسونج) في النسخة');
  // a0c4346: السطران اللذان يوسمهما التطبيق «حلّ محلّه» (بند السلك 6 للقطرين، وجدول 6 مم) — الحارس يتبع العقد (القاعدة 39)
  ok(section.includes('[حلّ محلّه البند 4 من «الفقرة 2 المؤرَّخة 2026-10-21» أدناه'), '[أ] بند السلك 6 موسوم «حلّ محلّه البند 4 من الفقرة 2» في النسخة (a0c4346)');
  ok(section.includes('[جدول الخلية 6 مم هذا حلّ محلّه جدول البند 8 من «الفقرة 2 المؤرَّخة 2026-10-21» أدناه]'), '[أ] جدول 6 مم موسوم «حلّ محلّه جدول البند 8 من الفقرة 2» في النسخة (a0c4346)');
  // البند 7/8: غياب المفتاحين ليس شذوذاً ⟹ ليسا من المفاتيح «الحاضرة دائماً»/«المسبَّبة»
  eq(['gridPattern', 'notRequiredCells'].filter((k) => k in N.TOUCH_PATH_FIELD_SPEC), [], '[أ] المفتاحان ليسا في TOUCH_PATH_FIELD_SPEC (حضورهما ALWAYS كان سيجعل غيابهما شذوذاً: البند 7)');
  // مخفيّان عن النموذج (القاعدة 20): قائمة فهارس لا يُبنى عليها حرف
  eq(['gridPattern', 'notRequiredCells'].filter((k) => !N.MODEL_HIDDEN_RAW_MEASUREMENT_KEYS['M-02'].includes(k)), [], '[أ] المفتاحان في المخفيّ عن النموذج لـM-02');
  const tr = {testId: 'M-02', kind: 'MANUAL', category: 'display', outcome: 'FAIL', notMeasuredReason: null, raw: {testId: 'M-02', status: 'fail', measurements: DEAD()}};
  const [sent] = sanitizeTestResultsForModelPayload([tr]);
  eq(['gridPattern', 'notRequiredCells', 'strokes'].filter((k) => k in sent.raw.measurements), [], '[أ] ونسخة النموذج بلا المفتاحين');
  eq(['totalCells', 'touchedCells'].map((k) => sent.raw.measurements[k]), [194, 97], '[أ] وtotalCells وtouchedCells (القديمان) تصلانه كما هما');
}

// ═══ ب) العيّنات الثلاث الحقيقية من المُنتِج الجديد ═══════════════════════════════════════════════════════════════════
{
  for (const k of Object.keys(NEW)) {
    const fp = clone(NEW[k]);
    const r = R.readFv68(fp);
    track(r);
    const raw = m02Of(NEW[k]).measurements;
    const t = tgOf(r);
    const p = t.path;
    eq([r.readerError, r.fieldsVersion, r.anomalies], [undefined, 71, []], `[ب][${k}] القارئ الحقيقي على الحمولة كما شحنها المُنتِج: لا شذوذ إطلاقاً`);
    eq([p.gridPatternState, p.gridPattern, p.gridPatternStatus, p.notRequiredCellsStatus, p.requiredCellsBasis], ['DECLARED', 'FRAME_AND_DIAGONALS', KS.PRESENT, KS.PRESENT, 'NOT_REQUIRED_CELLS_DECLARED'], `[ب][${k}] DECLARED بالنمط FRAME_AND_DIAGONALS`);
    eq(p.notRequiredCells, raw.notRequiredCells, `[ب][${k}] notRequiredCells تصل كما شُحنت`);
    // العلاقات 1–5 بعدّ مستقلّ من الحمولة (لا من مخرَج القارئ)
    const cells = raw.gridCols * raw.gridRows;
    eq([raw.totalCells, t.totalCells], [cells - raw.cutoutCells.length - raw.notRequiredCells.length, raw.totalCells], `[ب][${k}] العلاقة 2: totalCells = ${cells} − ${raw.cutoutCells.length} − ${raw.notRequiredCells.length}`);
    eq(raw.notRequiredCells.filter((i) => raw.cutoutCells.includes(i)), [], `[ب][${k}] العلاقة 1: منفصلتان`);
    eq(raw.touchedCells + raw.untouchedCells.length, raw.totalCells, `[ب][${k}] العلاقة 4: touched + |untouched| = total`);
    eq(raw.untouchedCells.filter((i) => raw.cutoutCells.includes(i) || raw.notRequiredCells.includes(i)), [], `[ب][${k}] العلاقة 4: untouchedCells بلا مقصاة ولا غير مطلوبة`);
    eq(raw.endReason === 'auto_complete', raw.untouchedCells.length === 0, `[ب][${k}] العلاقة 5: auto_complete ⟺ untouched = ∅`);
    // تحليل الخادم للمسار على المجموعة المطلوبة
    const c = p.analysis.cells;
    eq([c.state, c.mandatoryCells, c.reportedTouchedCount, c.pathTouchedCount, c.notRequiredCells], ['MATCH', raw.totalCells, raw.touchedCells, raw.touchedCells, NOT_REQUIRED_COUNT[k]], `[ب][${k}] cells: المطلوبة = totalCells، والمسار يوافق ما شحنه المُنتِج (MATCH)، وعدد غير المطلوبة ${NOT_REQUIRED_COUNT[k]}`);
    // مخرَج القارئ بلا مصفوفات إحداثيات خامّ (القاعدة 20) — وnotRequiredCells ليست إحداثيات
    ok(!('x' in p) && !('y' in p), `[ب][${k}] ولا إحداثيات في كتلة path`);
  }
  // لمسة المسار في الخلايا غير المطلوبة: 11ch مسح كلّ الخلايا (594)، وtouchedCells = 188 فقط — القاعدة 20: الخامّ كامل، والعدّاد للمطلوبة
  const c11 = tgOf(R.readFv68(clone(NEW['11ch']))).path.analysis.cells;
  eq([c11.pathTouchedCount, c11.pathTouchedNotRequiredCount, c11.pathUntouchedCount], [188, 406, 0], '[ب][11ch] المسار يلمس 188 مطلوبة و406 غير مطلوبة: الثانية تُعدّ بجانبها ولا تدخل touchedCells');
  const c13 = tgOf(R.readFv68(clone(NEW['13ch']))).path.analysis.cells;
  eq([c13.pathTouchedCount, c13.pathUntouchedCount, c13.mandatoryCells], [97, 97, 194], '[ب][13ch] 97 ملموسة + 97 غير ملموسة = 194 مطلوبة');
  // الأعلى في المخرَج (القاعدة 22): لا غياب بلا سبب للمفتاحين، ولا ABSENT_DECLARED (حاضران)
  const abs = R.readFv68(clone(NEW['13ch'])).absences;
  eq(abs.ABSENT.filter((q) => /gridPattern|notRequiredCells/.test(q)).concat(abs.ABSENT_DECLARED.filter((q) => /gridPattern|notRequiredCells/.test(q))), [], '[ب] المفتاحان حاضران: لا يظهران في ملخّص الغياب');
}

// ═══ جـ) الغياب (البند 7): نسختان حقيقيتان من المُنتِج السابق (≤ 324578f) تحت ختم 71 ═══════════════════════════════════════
{
  // sha256 الأصلين كما كانا (c52d8ebf… و1c0e0391…) — لا تُعدَّلان (القاعدة 12)
  eq(sha256Of(path.join(GOLDEN, `${OLD_STEM}${SUFFIX['11ch']}`)), 'c52d8ebf6ae213eb35edf1c856f40bd1dfcb78728ef7ce0dcaff3978842d0e7f', '[جـ] sha256 النسخة السابقة 11ch');
  eq(sha256Of(path.join(GOLDEN, `${OLD_STEM}${SUFFIX['13ch']}`)), '1c0e0391887afad2634bfb8aac4d47269c228ed5513db1aa504a908b85b5f4ba', '[جـ] sha256 النسخة السابقة 13ch');
  for (const k of ['11ch', '13ch']) {
    const raw = m02Of(OLD[k]).measurements;
    eq(['gridPattern', 'notRequiredCells'].filter((key) => key in raw), [], `[جـ][${k}] المُنتِج السابق لا يكتب المفتاحين (الحال الذي يصفه البند 7)`);
    const r = track(R.readFv68(clone(OLD[k])));
    const t = tgOf(r);
    const p = t.path;
    eq([r.fieldsVersion, r.anomalies], [71, []], `[جـ][${k}] تقرير ختم 71 بلا المفتاحين: لا شذوذ إطلاقاً`);
    eq([p.gridPatternState, p.gridPattern, p.notRequiredCells, p.gridPatternStatus, p.notRequiredCellsStatus, p.requiredCellsBasis],
        ['NOT_DECLARED', null, null, KS.ABSENT_DECLARED, KS.ABSENT_DECLARED, 'ALL_NON_CUTOUT_PATTERN_NOT_DECLARED'], `[جـ][${k}] NOT_DECLARED: حالة صريحة، المفتاحان غائبان ABSENT_DECLARED (غاب وتشرحه الحالة)، والمطلوب = الشبكة − المقصاة`);
    // الغياب يظهر في أعلى المخرَج بحالته لا بصمت ولا بقيمة افتراضية (القاعدة 22)
    const base = `manualResults[0].measurements`;
    ok(r.absences.ABSENT_DECLARED.some((q) => q.endsWith('path.gridPatternStatus')) && r.absences.ABSENT_DECLARED.some((q) => q.endsWith('path.notRequiredCellsStatus')), `[جـ][${k}] المفتاحان في ملخّص ABSENT_DECLARED (${base})`);
    eq(r.absences.ABSENT.filter((q) => /gridPattern|notRequiredCells/.test(q)), [], `[جـ][${k}] ولا في «غياب بلا سبب» (ABSENT)`);
    // العلاقتان القديمتان تبقيان: 288 − |cutout| = total، وcells تطابق بمجموعة مطلوبة = كل غير المقصاة
    const c = p.analysis.cells;
    eq([t.totalCells, c.state, c.mandatoryCells, c.notRequiredCells, c.pathTouchedNotRequiredCount], [raw.gridCols * raw.gridRows - raw.cutoutCells.length, 'MATCH', t.totalCells, 0, 0], `[جـ][${k}] العلاقة القديمة وcells.state = MATCH بلا خلايا غير مطلوبة`);
    eq(r.touchGridAnswer.state, 'RAW_PRESENT', `[جـ][${k}] وجواب M-02 اليدوي مقروء`);
  }
  // العلاقة القديمة تبقى بأسمائها حين NOT_DECLARED: كسرها يُعلَن بالاسم القديم لا بالجديد (البند 7: «تبقى العلاقتان القديمتان»)
  let m = OLD_DEAD();
  m.totalCells = 287;
  let o = readT(71, m, 'fail');
  ok(find(o, 'TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN') && find(o, 'TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN').detail.expected === 286 && !find(o, 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN'),
      '[جـ] المُنتِج السابق وtotalCells=287: TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN بالاسم القديم والمتوقَّع 286 (= 288 − 2)، ولا اسم «المطلوب» الجديد');
  m = OLD_DEAD();
  m.touchedCells += 1;
  ok(find(readT(71, m, 'fail'), 'TOUCH_GRID_TOUCHED_UNTOUCHED_SUM_MISMATCH'), '[جـ] والعلاقة القديمة الثانية بقيت: touched + |untouched| ≠ total شذوذ بالاسم القديم');
  // حمولة «إطار + X» حقيقية جُرِّد منها المفتاحان: تبقى العلاقتان القديمتان فتخالف (194 ≠ 630 − 4) — فرق يُرى بالاسم القديم، لا تأويل صامت
  m = DEAD();
  delete m.gridPattern;
  delete m.notRequiredCells;
  o = readT(71, m, 'fail');
  eq([tgOf(o).path.gridPatternState, codes(o)], ['NOT_DECLARED', ['TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN', 'TOUCH_GRID_CELLS_DISAGREE_WITH_PATH']],
      '[جـ] حمولة 13ch الجديدة بلا المفتاحين: NOT_DECLARED، والعلاقة القديمة تُعلن كسرها (194 ≠ 626) وخلايا المسار تخالف (الغياب لا يُقرأ «إطاراً» ولا «كل الخلايا» بصمت)');
  eq(find(o, 'TOUCH_GRID_TOTAL_CELLS_RELATION_BROKEN').detail, {gridCols: 18, gridRows: 35, cutoutCells: 4, totalCells: 194, expected: 626}, '[جـ] تفصيل الشذوذ القديم كما كان (بلا حقل notRequiredCells)');
  // null على السلك يُقرأ غياباً (Gson يُسقط المفاتيح، عقد :360): المفتاحان null ⟵ NOT_DECLARED مثل غيابهما
  m = DEAD();
  m.gridPattern = null;
  m.notRequiredCells = null;
  o = readT(71, m, 'fail');
  eq([tgOf(o).path.gridPatternState, tgOf(o).path.gridPatternStatus, tgOf(o).path.notRequiredCellsStatus], ['NOT_DECLARED', KS.ABSENT_DECLARED, KS.ABSENT_DECLARED], '[جـ] المفتاحان null: غياب ⟵ NOT_DECLARED');
  // fieldsNotInFile لا يغيّر شيئاً هنا: التطبيق لا يسمّيهما فيه (لا افتراض)
}

// ═══ د) كل قيمة ممكنة لكل مفتاح ═══════════════════════════════════════════════════════════════════════════════════════
{
  const stateOf = (o) => tgOf(o).path.gridPatternState;
  // gridPattern: القيمتان المعروفتان
  let m = DEAD();
  let o = readT(71, m, 'fail');
  eq([stateOf(o), tgOf(o).path.gridPattern, codes(o)], ['DECLARED', 'FRAME_AND_DIAGONALS', []], '[د] gridPattern = FRAME_AND_DIAGONALS (المُنتِج): DECLARED بلا شذوذ');
  // ALL_CELLS مع notRequiredCells [] على حمولة المُنتِج السابق (288/286 خليّة كلّها مطلوبة): DECLARED بلا شذوذ — وcells MATCH
  m = OLD_DEAD();
  m.gridPattern = 'ALL_CELLS';
  m.notRequiredCells = [];
  o = readT(71, m, 'fail');
  eq([stateOf(o), tgOf(o).path.requiredCellsBasis, tgOf(o).path.analysis.cells.state, codes(o)], ['DECLARED', 'NOT_REQUIRED_CELLS_DECLARED', 'MATCH', []], '[د] gridPattern = ALL_CELLS مع [] على حمولة قديمة الأعداد: DECLARED بلا شذوذ وcells MATCH');
  m = OLD_DEAD();
  m.gridPattern = 'FRAME_AND_DIAGONALS';
  m.notRequiredCells = [];
  eq(codes(readT(71, m, 'fail')), [], '[د] FRAME_AND_DIAGONALS مع notRequiredCells [] (شبكة صغيرة يغطّيها النمط كلّها): مشروع بالعقد — لا شذوذ (حدّ الإطار وحده يُفرَض)');
  // ALL_CELLS مع قائمة غير فارغة: العقد «فارغة [] لـALL_CELLS»
  m = DEAD();
  m.gridPattern = 'ALL_CELLS';
  o = readT(71, m, 'fail');
  eq(codes(o), ['TOUCH_GRID_PATTERN_ALL_CELLS_WITH_NOT_REQUIRED'], '[د] ALL_CELLS مع 432 في notRequiredCells: شذوذ وحده (العلاقات الأخرى سليمة)');
  eq(find(o, 'TOUCH_GRID_PATTERN_ALL_CELLS_WITH_NOT_REQUIRED').detail, {count: 432}, '[د] وتفصيله العدد');
  eq(stateOf(o), 'DECLARED', '[د] والحالة DECLARED (المفتاحان حاضران صالحان)');
  // قيم خارج القيمتين: INVALID_VALUE وشذوذ؛ العلاقات تبقى مفحوصة بالقائمة (العلاقة 2 لا تتوقّف على قيمة النمط)
  for (const v of ['frame_and_diagonals', 'ALL_CELLS ', '', 'DIAGONALS', 'FRAME', 'X'.repeat(100)]) {
    m = DEAD();
    m.gridPattern = v;
    o = readT(71, m, 'fail');
    eq([stateOf(o), tgOf(o).path.gridPatternStatus, tgOf(o).path.requiredCellsBasis, codes(o)], ['INVALID_VALUE', KS.PRESENT, 'NOT_REQUIRED_CELLS_DECLARED', ['TOUCH_GRID_PATTERN_VALUE_INVALID']], `[د] gridPattern=${JSON.stringify(v.slice(0, 12))}: INVALID_VALUE وشذوذ وحده`);
    eq(find(o, 'TOUCH_GRID_PATTERN_VALUE_INVALID').detail.raw, v.slice(0, 64), `[د] والقيمة في التفصيل مقصوصة بـ64 حرفاً (${v.length} → ${Math.min(v.length, 64)})`);
  }
  // نمط غير معروف + frame cell في القائمة: حدّ الإطار لا يُفرض (النمط مجهول: لا تعريف إطار) — يُعلَن غير المعروف وحده
  m = DEAD();
  m.gridPattern = 'DIAGONALS';
  m.notRequiredCells = m.notRequiredCells.concat([2]).sort((a, b) => a - b);
  ok(!codes(readT(71, m, 'fail')).includes('TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED'), '[د] نمط مجهول: حدّ الإطار لا يُفرض (لا قاعدة بلا تعريف)');
  // أنواع خاطئة لكل مفتاح: WRONG_TYPE بلا تحويل، والمجموعة المطلوبة مجهولة فلا علاقة تُحسب
  for (const v of [5, 5.5, true, {}, [], ['FRAME_AND_DIAGONALS']]) {
    m = DEAD();
    m.gridPattern = v;
    o = readT(71, m, 'fail');
    eq([stateOf(o), tgOf(o).path.gridPatternStatus, tgOf(o).path.gridPattern, tgOf(o).path.requiredCellsBasis, tgOf(o).path.analysis.cells.state, codes(o)],
        ['WRONG_TYPE', KS.WRONG_TYPE, null, 'UNDETERMINED_PATTERN_NOT_READABLE', 'UNDETERMINED_REQUIRED_SET_UNKNOWN', ['WRONG_TYPE']], `[د] gridPattern=${JSON.stringify(v)}: WRONG_TYPE بلا تحويل، وأساس المطلوب مجهول، وcells لا حكم (لا قائمة افتراضية)`);
    eq(find(o, 'WRONG_TYPE').section, 'manualResults[0].measurements.gridPattern', '[د] وشذوذ النوع في موضع المفتاح');
  }
  for (const v of ['x', 5, true, {}, 'FRAME_AND_DIAGONALS']) {
    m = DEAD();
    m.notRequiredCells = v;
    o = readT(71, m, 'fail');
    eq([stateOf(o), tgOf(o).path.notRequiredCellsStatus, tgOf(o).path.notRequiredCells, tgOf(o).path.requiredCellsBasis, tgOf(o).path.analysis.cells.state, codes(o)],
        ['WRONG_TYPE', KS.WRONG_TYPE, null, 'UNDETERMINED_PATTERN_NOT_READABLE', 'UNDETERMINED_REQUIRED_SET_UNKNOWN', ['WRONG_TYPE']], `[د] notRequiredCells=${JSON.stringify(v)}: WRONG_TYPE، وأساس المطلوب مجهول، وcells لا حكم`);
    eq(find(o, 'WRONG_TYPE').section, 'manualResults[0].measurements.notRequiredCells', '[د] وشذوذ النوع في موضع المفتاح');
  }
  m = DEAD();
  m.gridPattern = 5;
  m.notRequiredCells = 'x';
  o = readT(71, m, 'fail');
  eq([stateOf(o), codes(o)], ['WRONG_TYPE', ['WRONG_TYPE', 'WRONG_TYPE']], '[د] المفتاحان بنوعين خاطئين: WRONG_TYPE وشذوذ لكلٍّ');
  // مفتاح واحد غائب: ONE_KEY_ABSENT وشذوذ، ولا يُفترض الآخر ولا يُقرأ نمطاً (القاعدة 22)
  m = DEAD();
  delete m.gridPattern;
  o = readT(71, m, 'fail');
  eq([stateOf(o), tgOf(o).path.gridPatternStatus, tgOf(o).path.notRequiredCellsStatus, tgOf(o).path.requiredCellsBasis, tgOf(o).path.analysis.cells.state, codes(o)],
      ['ONE_KEY_ABSENT', KS.ABSENT, KS.PRESENT, 'UNDETERMINED_PATTERN_NOT_READABLE', 'UNDETERMINED_REQUIRED_SET_UNKNOWN', ['TOUCH_GRID_PATTERN_KEYS_INCOMPLETE']], '[د] gridPattern غائب وnotRequiredCells حاضرة: ONE_KEY_ABSENT، الغائب ABSENT (بلا سبب)، ولا علاقة تُحسب');
  eq(find(o, 'TOUCH_GRID_PATTERN_KEYS_INCOMPLETE').detail, {absent: 'gridPattern', present: 'notRequiredCells'}, '[د] والتفصيل يسمّي الغائب والحاضر');
  ok(o.absences.ABSENT.some((q) => q.endsWith('path.gridPatternStatus')), '[د] والغياب بلا سبب يظهر في ABSENT في أعلى المخرَج');
  m = DEAD();
  delete m.notRequiredCells;
  o = readT(71, m, 'fail');
  eq([stateOf(o), tgOf(o).path.notRequiredCellsStatus, codes(o)], ['ONE_KEY_ABSENT', KS.ABSENT, ['TOUCH_GRID_PATTERN_KEYS_INCOMPLETE']], '[د] notRequiredCells غائبة وgridPattern حاضر: ONE_KEY_ABSENT');
  eq(find(o, 'TOUCH_GRID_PATTERN_KEYS_INCOMPLETE').detail, {absent: 'notRequiredCells', present: 'gridPattern'}, '[د] والتفصيل معكوس');
  m = DEAD();
  m.gridPattern = null;
  eq(stateOf(readT(71, m, 'fail')), 'ONE_KEY_ABSENT', '[د] gridPattern = null وnotRequiredCells حاضرة: غياب أيضاً ⟵ ONE_KEY_ABSENT');
  m = DEAD();
  delete m.gridPattern;
  m.notRequiredCells = 'x';
  o = readT(71, m, 'fail');
  eq([stateOf(o), [...codes(o)].sort()], ['WRONG_TYPE', ['TOUCH_GRID_PATTERN_KEYS_INCOMPLETE', 'WRONG_TYPE']], '[د] أحدهما غائب والآخر بنوع خاطئ: الحالة WRONG_TYPE ويُعلَن الشذوذان معاً (لا يُخفي أحدهما الآخر)');

  // فهارس notRequiredCells: كل صنف خلل (القائمة المنظَّفة هي ما تدخل العلاقات)
  for (const [label, bad] of [['سالب', [-1]], ['كسر', [1.5]], ['نصّ', ['5']], ['خارج الشبكة (= cols×rows)', [630]], ['null', [null]], ['خارج الشبكة بعيد', [10 ** 9]]]) {
    m = DEAD();
    m.notRequiredCells = m.notRequiredCells.concat(bad);
    o = readT(71, m, 'fail');
    eq(codes(o), ['TOUCH_GRID_CELL_INDEX_INVALID'], `[د] فهرس ${label} في notRequiredCells: شذوذ الفهرس وحده (القائمة المنظَّفة 432 فالعلاقات سليمة)`);
    eq(find(o, 'TOUCH_GRID_CELL_INDEX_INVALID').detail, {key: 'notRequiredCells', invalid: 1}, `[د] وتفصيله المفتاح وعدد غير الصالح (${label})`);
  }
  m = DEAD();
  m.notRequiredCells = [];
  o = readT(71, m, 'fail');
  eq([stateOf(o), codes(o)[0]], ['DECLARED', 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN'], '[د] ضابط: قائمة فارغة مع FRAME_AND_DIAGONALS على حمولة بـ432: العلاقة 2 تنكسر (194 ≠ 626)');
  eq(find(o, 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN').detail, {gridCols: 18, gridRows: 35, cutoutCells: 4, notRequiredCells: 0, totalCells: 194, expected: 626}, '[د] وتفصيلها: notRequiredCells = 0 والمتوقَّع 626');
}

// ═══ هـ) كل علاقة تُكسَر على حدة ═════════════════════════════════════════════════════════════════════════════════════
{
  const REQ = 'TOUCH_GRID_REQUIRED_CELLS_RELATION_BROKEN';
  const SUM = 'TOUCH_GRID_TOUCHED_UNTOUCHED_SUM_MISMATCH';
  const DIS = 'TOUCH_GRID_CELLS_DISAGREE_WITH_PATH';
  const OVL = 'TOUCH_GRID_CUTOUT_NOT_REQUIRED_OVERLAP';
  const FRM = 'TOUCH_GRID_PATTERN_FRAME_CELL_NOT_REQUIRED';
  const UNT = 'TOUCH_GRID_UNTOUCHED_CELL_NOT_REQUIRED';
  const AUTO = 'TOUCH_GRID_AUTO_COMPLETE_NOT_COMPLETE';
  let m;
  let o;
  // العلاقة 2: totalCells
  m = DEAD();
  m.totalCells = 195;
  o = readT(71, m, 'fail');
  eq(codes(o), [REQ, SUM], '[هـ] العلاقة 2 مكسورة (total=195): شذوذها بالاسم الجديد، وتتبعها علاقة المجموع (97 + 97 ≠ 195)');
  eq(find(o, REQ).detail, {gridCols: 18, gridRows: 35, cutoutCells: 4, notRequiredCells: 432, totalCells: 195, expected: 194}, '[د] وتفصيل العلاقة 2 كاملاً: الشبكة والقائمتان والمشحون والمتوقَّع');
  m = DEAD();
  m.totalCells = 626; // العلاقة القديمة (كل غير المقصاة) على حمولة تعلن النمط: لا تُقبل
  ok(codes(readT(71, m, 'fail')).includes(REQ), '[هـ] total = 626 (العلاقة القديمة) تحت نمط معلَن: العلاقة 2 مكسورة — لا تُقبل علاقة قديمة على نمط جديد');
  // العلاقة 2 من جهة notRequiredCells: نقص عنصر واحد
  m = DEAD();
  m.notRequiredCells.pop();
  o = readT(71, m, 'fail');
  eq(codes(o), [REQ, DIS], '[هـ] notRequiredCells ناقصة عنصراً (431): العلاقة 2 مكسورة وخلايا المسار تخالف (خلية صارت «مطلوبة» ولم يعلنها التطبيق غير ممسوحة)');
  eq(find(o, REQ).detail.expected, 195, '[هـ] والمتوقَّع 630 − 4 − 431 = 195');
  // انفصال القائمتين (العلاقة 1)
  m = DEAD();
  m.notRequiredCells = m.notRequiredCells.concat([8]).sort((a, b) => a - b); // 8 مقصوصة
  m.totalCells = 193; // 630 − 4 − 433: العلاقة 2 سليمة بالعدّ فيبقى التداخل شذوذاً وحده (مع تبعاته)
  o = readT(71, m, 'fail');
  eq(codes(o), [OVL, FRM, SUM], '[هـ] الخلية 8 المقصوصة في notRequiredCells أيضاً (والعدّ مضبوط 193): شذوذ التداخل (وهي خلية إطار فيُعلن حدّ الإطار) ثم المجموع (97 + 97 ≠ 193)');
  eq(find(o, OVL).detail, {count: 1, firstIndexes: [8]}, '[هـ] وتفصيل التداخل: العدد والفهرس');
  // العلاقة 4: untouchedCells «لا تحوي مقصوصة ولا غير مطلوبة»
  m = DEAD();
  m.untouchedCells = m.untouchedCells.concat([20]); // 20 غير مطلوبة (أوّل فهرس في notRequiredCells)
  o = readT(71, m, 'fail');
  eq(codes(o), [UNT, SUM], '[هـ] خلية غير مطلوبة (20) في untouchedCells: شذوذها، وتتبعها علاقة المجموع');
  eq(find(o, UNT).detail, {inCutout: 0, inNotRequired: 1, firstIndexes: [20]}, '[هـ] وتفصيلها: غير المطلوبة 1 والمقصاة 0');
  m = DEAD();
  m.untouchedCells = m.untouchedCells.concat([8]); // 8 مقصوصة
  o = readT(71, m, 'fail');
  eq(codes(o), [UNT, SUM], '[هـ] خلية مقصوصة (8) في untouchedCells: الشذوذ نفسه');
  eq(find(o, UNT).detail, {inCutout: 1, inNotRequired: 0, firstIndexes: [8]}, '[هـ] وتفصيلها: المقصاة 1');
  // العلاقة 4: touched + |untouched| = total (يبقى اسمها القديم: لم تتغيّر صيغتها)
  m = DEAD();
  m.touchedCells = 98;
  o = readT(71, m, 'fail');
  eq(codes(o), [SUM, DIS], '[هـ] touchedCells=98: المجموع لا يطابق (98 + 97 ≠ 194) وخلايا المسار (97) تخالف');
  eq(find(o, SUM).detail, {touchedCells: 98, untouchedCells: 97, totalCells: 194}, '[هـ] وتفصيل المجموع');
  // العلاقة 5: auto_complete ⟺ اكتمال المطلوبة
  m = COMPLETE();
  m.untouchedCells = [3];
  m.touchedCells = 187;
  o = readT(71, m, 'pass');
  eq(codes(o), [AUTO, DIS], '[هـ] auto_complete مع خلية مطلوبة غير ممسوحة: شذوذ الاكتمال (وخلايا المسار تخالف: المسار يلمسها)');
  eq(find(o, AUTO).detail, {touchedCells: 187, totalCells: 188, untouchedCells: 1}, '[هـ] وتفصيله');
  m = DEAD();
  m.endReason = 'auto_complete';
  ok(codes(readT(71, m, 'fail')).includes(AUTO), '[هـ] auto_complete على تشغيل غير مكتمل (13ch): شذوذ الاكتمال');
  eq(codes(readT(71, DEAD(), 'fail')), [], '[هـ] وغير المكتمل بزرّ الفنّي (user_marked_not_working): لا شذوذ');
  // العلاقة 3: touchedCells تعدّ المطلوبة وحدها — العدّ الخاطئ (يعدّ لمسة غير المطلوبة) يخالف المسار
  m = COMPLETE();
  m.touchedCells = 594;
  m.totalCells = 594;
  m.notRequiredCells = [];
  m.gridPattern = 'ALL_CELLS';
  o = readT(71, m, 'pass');
  eq(codes(o), [], '[هـ] ضابط: ALL_CELLS/[] وtotal=594 وtouched=594 على مسار يلمس الـ594: متّسق (لا شذوذ) — فالنمط هو ما يحدّد المطلوب');
  m = COMPLETE();
  m.touchedCells = 594; // يعدّ لمسة الخلايا غير المطلوبة (406) أيضاً مع بقاء النمط
  o = readT(71, m, 'pass');
  ok(codes(o).includes(SUM) && codes(o).includes(DIS), '[هـ] touchedCells=594 تحت نمط يجعل المطلوبة 188: المجموع ينكسر وخلايا المسار تخالف (العلاقة 3)');

  // حدّ الإطار الأدنى (البند 6): خلية من كل حافّة من الحواف الأربع في notRequiredCells
  const withFrame = (idx) => {
    const x = DEAD();
    x.notRequiredCells = x.notRequiredCells.concat([idx]).sort((a, b) => a - b);
    return readT(71, x, 'fail');
  };
  for (const [label, idx] of [['الصفّ الأول (0,2)', 2], ['العمود الأول (2,0)', 36], ['العمود الأخير (2,17)', 53], ['الصفّ الأخير (34,0)', 612], ['الزاوية العلوية اليسرى', 0], ['الزاوية العلوية اليمنى', 17], ['الزاوية السفلية اليسرى', 612], ['الزاوية السفلية اليمنى', 629], ['وسط الصفّ الأخير (34,9)', 621]]) {
    o = withFrame(idx);
    ok(codes(o).includes(FRM), `[هـ] ${label} (${idx}) في notRequiredCells: شذوذ ${FRM}`);
    eq(find(o, FRM).detail, {count: 1, firstIndexes: [idx]}, `[هـ] وتفصيله: العدد والفهرس (${label})`);
    eq(codes(o).filter((c) => c !== FRM && c !== REQ && c !== DIS && c !== UNT), [], `[هـ] ولا شذوذ تابع سوى العلاقة 2 وخلايا المسار وuntouched (${label})`);
  }
  for (const [label, idx] of [['الصفّ 1 العمود 1 (19)', 19], ['الصفّ 1 العمود 16 (34)', 34], ['الصفّ 33 العمود 1 (595)', 595], ['الصفّ 33 العمود 16 (610)', 610]]) {
    const x = DEAD();
    x.notRequiredCells = x.notRequiredCells.filter((i) => i !== idx).concat([idx]).sort((a, b) => a - b);
    eq(x.notRequiredCells.length === 432 || x.notRequiredCells.length === 433, true, '[هـ] ضابط');
    ok(!codes(readT(71, x, 'fail')).includes(FRM), `[هـ] ${label}: ليست من الحواف الأربع — لا شذوذ حدّ الإطار (الحدّ الأدنى لا يمنع إلا الحواف)`);
  }
  // المقياس: حدّ الإطار لا يتأثّر بالشبكة (cols × rows آخر) — شبكة 3×3 ونمط FRAME: الوسط وحده غير مطلوب مشروعاً
  m = {gridCols: 3, gridRows: 3, totalCells: 8, touchedCells: 0, elapsedMs: 1, timeToFirstTouchMs: 1, endReason: 'user_marked_not_working', maxSimultaneousPointers: 1, gridPattern: 'FRAME_AND_DIAGONALS', notRequiredCells: [4]};
  const tiny = readT(71, m, 'fail');
  ok(!codes(tiny).includes(FRM) && !codes(tiny).includes(REQ), '[هـ] شبكة 3×3: الخلية 4 (الوسط) ليست إطاراً: لا شذوذ إطار ولا علاقة (9 − 0 − 1 = 8)');
  m.notRequiredCells = [3];
  const tinyBad = readT(71, m, 'fail');
  eq(find(tinyBad, FRM).detail, {count: 1, firstIndexes: [3]}, '[هـ] شبكة 3×3: الخلية 3 (الصفّ 1 العمود 0) إطار: شذوذ');
  // الغياب في الأعلى مكتوب أيضاً بالأعداد: لا مفتاح خام آخر بين المفاتيح المجهولة
  eq(tgOf(readT(71, DEAD(), 'fail')).path.unknownKeys, [], '[هـ] المفتاحان معروفان في العقد (لا يُعدّان «مفتاحاً مجهولاً» TOUCH_GRID_UNKNOWN_KEY)');
  m = DEAD();
  m.gridPatternn = 'x';
  ok(codes(readT(71, m, 'fail')).includes('TOUCH_GRID_UNKNOWN_KEY'), '[هـ] وخطأ إملائي في اسم المفتاح مفتاحٌ مجهول يُعلَن (القاعدة 25): لا يُقبل بصمت');
}

// ═══ و) الختم < 71 (البند 8): حضور المفتاحين شذوذ بالاسم؛ وغيابهما هو الحال ══════════════════════════════════════════════
{
  const BEFORE = 'TOUCH_GRID_PATTERN_KEYS_PRESENT_BEFORE_FV71';
  for (const fv of [67, 68, 69, 70]) {
    const o = readT(fv, DEAD(), 'fail');
    const a = find(o, BEFORE);
    ok(a !== undefined && JSON.stringify(a.detail) === JSON.stringify({keys: ['gridPattern', 'notRequiredCells']}) && a.section === 'manualResults[0].measurements', `[و] ختم ${fv} مع المفتاحين: ${BEFORE} بالمفتاحين في موضع measurements`);
    eq(tgOf(o).path.state, 'NOT_IN_FIELDS_VERSION', `[و] ختم ${fv}: كتلة path بحالتها (لا تُقرأ القيم)`);
    eq(tgOf(o).path.unexpectedKeys.slice(-2), ['gridPattern', 'notRequiredCells'], `[و] ختم ${fv}: المفتاحان في unexpectedKeys آخر القائمة`);
    ok(!('gridPatternState' in tgOf(o).path) && !('notRequiredCells' in tgOf(o).path), `[و] ختم ${fv}: لا قيمة ولا حالة نمط تُخرَج (لم يوجدا بعد في هذا الإصدار)`);
    // مفتاح واحد: يُسمّى وحده
    for (const only of ['gridPattern', 'notRequiredCells']) {
      const m = DEAD();
      for (const drop of ['gridPattern', 'notRequiredCells']) if (drop !== only) delete m[drop];
      eq(find(readT(fv, m, 'fail'), BEFORE).detail, {keys: [only]}, `[و] ختم ${fv}: ${only} وحده: يُسمّى وحده`);
    }
    // غيابهما هو الحال: لا شذوذ ولا حالة جديدة (بخامّ fv70 القديم الحقيقي)
    const legacy = {gridCols: 8, gridRows: 15, totalCells: 120, touchedCells: 0, endReason: 'user_marked_not_tested', maxSimultaneousPointers: 0};
    const ol = readT(fv, legacy, 'fail');
    eq([codes(ol).includes(BEFORE), tgOf(ol).path], [false, {state: 'NOT_IN_FIELDS_VERSION', unexpectedKeys: []}], `[و] ختم ${fv} بخامّ قديم بلا المفتاحين: لا شذوذ، والكتلة كما كانت بالضبط (لا مفتاح جديد في مخرَجها)`);
  }
  // بلا ختم: لا حكم بأنهما «لم يوجدا بعد»، وحضورهما يُعلَن
  const o = readT(null, DEAD(), 'fail');
  eq([tgOf(o).path.state, codes(o).includes(BEFORE)], ['UNDETERMINED_NO_FIELDS_VERSION', true], '[و] بلا ختم: UNDETERMINED_NO_FIELDS_VERSION وحضورهما شذوذ');
  // ختم أعلى من 71 (72، 100): كما 71
  for (const fv of [72, 100]) eq(tgOf(readT(fv, DEAD(), 'fail')).path.gridPatternState, 'DECLARED', `[و] ختم ${fv}: يُقرآن كما في 71`);
  // العيّنات الحقيقية السابقة (ختم 71 بلا المفتاحين) لا تتأثّر بتغيير الختم إلى ≤ 70: تبقى كما في الاختبارات القائمة (fv71TouchGridReader)
  for (const fv of [69, 70]) eq(codes(readT(fv, (() => { const x = OLD_DEAD(); return x; })(), 'fail')).includes(BEFORE), false, `[و] خامّ المُنتِج السابق تحت ختم ${fv}: لا شذوذ المفتاحين (لم يحملهما)`);
}

// ═══ ز) سكربت الفحص ٠٣ — checkM02: touchedCells مقابل totalCells للمطلوبة على الجهتين ═════════════════════════════════════════
{
  const tmpAccount = C.hashIdForLog('uid-frame-x-test');
  const factsOf = (payload, tag) => {
    const {timeSeriesState, ...file} = payload.timeSeries;
    void timeSeriesState;
    return {
      tag, shortIdHash: C.hashIdForLog(`NC-${tag}`), found: 1, scanIdHash: C.hashIdForLog(`scan-${tag}`), userHash: tmpAccount, ownerMatches: true,
      rawRead: {state: 'PRIVATE', raw: {rawFingerprint: clone(lightenFingerprintForStorage(payload)), sessionId: null, deviceFingerprintSha: 'sha', timeSeriesStoragePath: 'p', aiAudit: null}},
      storage: {state: 'DOWNLOADED', json: file}, session: {state: 'NOT_A_SESSION_SCAN'}, evaluation: {exists: false},
    };
  };
  const verdict = (payload, tag, item) => {
    const res = D.evaluateReport(factsOf(payload, tag), {accountHash: tmpAccount});
    const row = res.rows.find((r) => r.item === item);
    return row === undefined ? undefined : row.verdict;
  };
  const V = D.VERDICT;
  const FULL = D.EXPECT.M02_AUTO_COMPLETE_FULL_GRID;
  const PART = D.EXPECT.M02_NOT_WORKING_PARTIAL_GRID;
  // B2: auto_complete + touchedCells = totalCells (188 = 188 للمطلوبة)
  eq(verdict(clone(NEW['11ch']), 'B2', FULL), V.PASS, '[ز] B2 على 11ch الجديدة (auto_complete، 188 من 188 مطلوبة): PASS');
  let p = clone(NEW['11ch']);
  m02Of(p).measurements.touchedCells = 187;
  eq(verdict(p, 'B2', FULL), V.FAIL, '[ز] B2 touchedCells=187 من 188: FAIL (لم تُلمَس كل المطلوبة)');
  p = clone(NEW['11ch']);
  m02Of(p).measurements.touchedCells = 594;
  eq(verdict(p, 'B2', FULL), V.FAIL, '[ز] B2 touchedCells=594 (يعدّ غير المطلوبة) مقابل totalCells=188: FAIL — العدّان لا يُقارَنان إلا للمطلوبة');
  // S1: user_marked_not_working + fail + touchedCells < totalCells (97 < 194)
  eq(verdict(clone(NEW['13ch']), 'S1', PART), V.PASS, '[ز] S1 على 13ch الجديدة (user_marked_not_working، fail، 97 < 194): PASS');
  p = clone(NEW['13ch']);
  m02Of(p).measurements.touchedCells = 194;
  eq(verdict(p, 'S1', PART), V.FAIL, '[ز] S1 touchedCells = totalCells (194 = 194): FAIL (اكتملت المطلوبة فلا «جزئي»)');
  // العيّنة السابقة (بلا المفتاحين) تبقى كما كانت: 288 من 288 في 11ch، و208 < 286 في 13ch
  eq(verdict(clone(OLD['11ch']), 'B2', FULL), V.PASS, '[ز] B2 على 11ch السابقة (288 من 288): PASS كما كانت');
  eq(verdict(clone(OLD['13ch']), 'S1', PART), V.PASS, '[ز] S1 على 13ch السابقة (208 < 286): PASS كما كانت');
}

// ═══ ح) تحليل المسار: المجموعة المطلوبة مُدخَل صريح (touchPath) ═════════════════════════════════════════════════════════
{
  // 12×24 على سطح 1080×2160 (خلية 90×90): خطّ يعبر الخلية 0 فقط؛ المقصاة [1]، وغير المطلوبة [2]
  const geometry = {surfaceWidthPx: 1080, surfaceHeightPx: 2160, pxPerMm: 15, gridCols: 12, gridRows: 24, cellWidthPx: 90, cellHeightPx: 90};
  const s = [{index: 0, usable: true, pointerId: 0, end: 'up', endRecognized: true, downAtMs: 0, dtMs: [0, 8], x: [10, 250], y: [10, 10], touchMajorPx: null}];
  const cellsOf = (reportedCells) => analyzeTouchPath({strokes: s, geometry, reportedCells, displayed: null}).cells;
  // الخطّ من x=10 إلى 250 يعبر الخلايا 0 و1 و2 (الصفّ 0). المقصاة [1] (تُستثنى من المطلوب)، وغير المطلوبة [2]
  const untouchedAll = [];
  for (let i = 3; i < 288; i++) untouchedAll.push(i); // المطلوبة: 0 و3..287؛ الملموسة منها 0 وحدها
  const c = cellsOf({cutout: [1], notRequired: [2], untouched: untouchedAll, touchedCount: 1});
  eq([c.state, c.mandatoryCells, c.pathTouchedCount, c.pathTouchedNotRequiredCount, c.notRequiredCells], ['MATCH', 286, 1, 1, 1], '[ح] خطّ يعبر 0 و1 و2: المطلوبة 288 − 1 − 1 = 286، الملموسة منها 1 (الخلية 0)، وغير المطلوبة الملموسة 1 (الخلية 2)');
  eq(cellsOf({cutout: [1], notRequired: null, untouched: untouchedAll, touchedCount: 1}).state, 'UNDETERMINED_REQUIRED_SET_UNKNOWN', '[ح] notRequired = null: لا مجموعة مطلوبة');
  eq(cellsOf({cutout: [1], untouched: untouchedAll, touchedCount: 1}).state, 'UNDETERMINED_REQUIRED_SET_UNKNOWN', '[ح] notRequired غائب (undefined): لا قائمة افتراضية');
  reachedAnomalies.add('(touchPath)');
}

// ═══ ط) اكتمال التغطية: كل حالة وكل أساس وكل اسم شذوذ بلغها هذا الاختبار ═════════════════════════════════════════════════════
{
  reachedAnomalies.delete('(touchPath)');
  eq([...reachedStates].sort(), Object.values(N.TOUCH_GRID_PATTERN_STATE).sort(), '[ط] كل حالة من حالات gridPatternState الخمس بُلغت (القاعدة 30: كل قيمة ممكنة)');
  eq([...reachedBasis].sort(), Object.values(N.TOUCH_GRID_REQUIRED_CELLS_BASIS).sort(), '[ط] وكل أساس للمطلوب بُلغ');
  eq(Object.values(N.TOUCH_GRID_PATTERN_ANOMALY).filter((code) => !reachedAnomalies.has(code)), [], '[ط] وكل اسم من أسماء الشذوذ الثمانية الجديدة أُنتج فعلاً بالقارئ الحقيقي (لا اسم بلا اختبار)');
}

console.log(`\nfv71M02FrameXReader.test.js: ${n}/${n} assertions passed`);
