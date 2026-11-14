'use strict';

// fv71ProducerSamples.test.js — القارئ الحقيقي على **حمولات المُنتِج الثلاث لـfv71** (NeuralChek@f9e0571: A-M02 وA-VOL وA-P6-13)، ومسارها بلا استبدال، وأحكام بمرجع مستقلّ عن القارئ.
// مزامنة 2026-10-18 +03 (أمر الباك اند ٢، البند ٠؛ القاعدتان 37 و41). **هذا الاختبار هو بند «استبدال بعيّنة المُنتِج» الذي كان معلّقاً على عيّناتي المبنيّة من العقد** (حُذفت، القاعدة 23).
//
// **تحديث 2026-10-21 (M-02 «إطار + X»، أمر الباك اند ٤):** بايتات الملفّات الثلاثة استُبدلت بتوليد التطبيق الجديد (NeuralChek@4c0102c: gridPattern وnotRequiredCells، والعدّادات للخلايا المطلوبة)؛ وحلّت الكتلة «أ» محلّ علاقات «كل الخلايا مطلوبة»
// بمرجع مستقلّ للمجموعة المطلوبة (القاعدة 23). النصّ أدناه عن f9e0571 تاريخ العيّنات السابقة.
//
// **تحديث 2026-10-22 (M-02 بشكل اختبار اللمس في قائمة سامسونج، أمر الباك اند ٧):** بايتات الملفّات الثلاثة استُبدلت ثانيةً بتوليد NeuralChek@3810146 (خلية مربّعة 4 مم، 18 عموداً، 33/35/35 صفّاً، شريط علويّ فارغ، غير المطلوبة 406/432/432).
// استُبدلت (القاعدة 23: بالاستبدال لا بالإضافة) ثلاثة أرقام مكتوبة باليد كانت تصف العيّنات السابقة: «الخليّة المستهدَفة 6 مم» ⟵ 4، و«المسار يلمس الخلايا غير المطلوبة كلّها (180)» ⟵ 406، و«notRequiredCells: 180 في الثلاث» ⟵ 406 و432؛
// وتكرار خطّ 16ch لمحاكاة تجاوز السقف صار خمس مرّات لا أربع: العيّنة الجديدة إحداثياتها أقصر نصّاً (أعداد شبه صحيحة)، فالمستند عند 60,000 نقطة 839,656 بايتاً (تحت الحارس 900,000) وعند 75,000 نقطة 1,037,888 (فوقه) — قياس سكربت مؤقّت خارج المستودع بالدالّتين نفسيهما.
//
// الملفّات (نسخ حرفية، sha256 في fv68AppPayloadGoldenCopy.test.js؛ مشتقّة لا مسجَّلة من جهاز — appVersion مولَّد في التطبيق، القاعدة 9):
//   - fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json            (M-02 pass · auto_complete · 594 خليّة منها 188 مطلوبة | M-09 بحدث مفتاح | M-10 بتغيّر المستوى | off/off)
//   - fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json      (M-02 fail · ثقب · قفزتان · راحة يد · edge_exit | M-09 «يعمل» بيد الفنّي | applied)
//   - fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json (M-02 not_tested · 15,000 نقطة · reached | dismissed | read_failed · apply_failed)
//
// ما يثبّته:
//   أ) **أحكام بالبناء بمرجع مستقلّ** (القاعدتان 33 و38): ما شحنه المُنتِج (touchedCells وuntouchedCells وcutoutCells وtotalCells وgridCols/Rows) يُقارَن بعدّ مستقلّ عن touchPath.js (أخذ عيّنات كثيف بخطوة 0.25 بكسل) وبصيغة القسم
//      (gridCols = round(surfaceWidthPx ÷ (cellTargetMm × pxPerMm))، cellWidthPx = surfaceWidthPx ÷ gridCols…)؛ والعدّادان وholdMs وtimeToFirstExpectedDownMs من عدّ مستقلّ لأحداث المفاتيح.
//   ب) القارئ الحقيقي (readFv68) على كل حمولة كما شُحنت: لا شذوذ، وأحكام باليد على كل قسم (touchGridAnswer · volumeButtonAnswers · scanConditions).
//   جـ) التمرير والتخزين لا يُسقطان الخامّ: lightenFingerprintForStorage وbuildReportRawDocument تُبقيان measurements لـM-02/M-09/M-10 وحقول P6-13 بايتاً ببايت؛ **وحجم الخامّ مقيس من الملفّ** (لا تقدير).
//   د) حارس الحجم REPORT_RAW_MAX_BYTES: عيّنة 16ch (15,000 نقطة = سقف pathCap) تمرّ؛ ونسخة **مشتقّة منها بتكرار خطّها خمس مرّات** (75,000 نقطة؛ كانت أربعاً حتى 2026-10-22، انظر التحديث أعلاه؛ مُسمّاة مشتقّة لا عيّنة مُنتِج) يرفضها الحارس بـREPORT_RAW_TOO_LARGE لا اقتطاع.
//   هـ) **بصمة تغطية العيّنات**: ما تغطّيه العيّنات الثلاث من القيم المعدَّدة وما لا تغطّيه (يُغطّى باختبارات وحدة بحمولات معدَّلة) — مكتوب هنا فيفشل إن تغيّرت العيّنات فيُراجَع الجدول.
//
// Run: node functions/test/fv71ProducerSamples.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const N = require('../src/analysis/fv68Names');
const R = require('../src/analysis/fv68Reader');
const {lightenFingerprintForStorage} = require('../src/analysis/lightenFingerprintForStorage');
const {buildReportRawDocument, assertReportRawFits, measureReportRawBytes, REPORT_RAW_MAX_BYTES} = require('../src/analysis/reportRawStore');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };
const clone = (o) => JSON.parse(JSON.stringify(o));

const GOLDEN = path.join(__dirname, 'fixtures', 'golden');
// الأسماء الحرفية للحارس الشامل (goldenFixturesGuardCoverage.test.js يشترط أن يذكر حارسُ كل ملفّ اسمَه حرفياً)
const FILES = {
  '11ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-11ch-nothing-admitted.json',
  '13ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-13ch-selinux-blocked-policy.json',
  '16ch': 'fv71-app-request-payload-derived-from-fv67-golden-34dff2b8-16ch-four-policies-truncated-failures.json',
};
const P = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'))]));
const LABELS = Object.keys(P);
const row = (k, id) => P[k].manualResults.find((m) => m.testId === id);
const m02 = (k) => row(k, 'M-02').measurements;
const own = (o) => o.anomalies;

// ═══ أ) أحكام بالبناء بمرجع مستقلّ ══════════════════════════════════════════════════════════════════════════════
// مرجع الخلايا: أخذ عيّنات كثيف (0.25 بكسل) على كل قطعة بين عيّنتين متتاليتين من الخطّ نفسه — لا عبور Amanatides–Woo كما في touchPath.js. القطع الموسومة قفزة (علامات العرض gap_jump وcoord_jump)
// لا تُملأ (خليّة النهاية وحدها)، وخلايا القطع لا تُضاء: نصّ القسم «إلا عبر قطعة وُسمت قفزة (فيها خليّة النهاية وحدها)، ولا تُضاء خليّة قطع».
function oracle(meas) {
  const cols = meas.gridCols;
  const rows = meas.gridRows;
  const cw = meas.cellWidthPx;
  const ch = meas.cellHeightPx;
  const skip = new Set((meas.displayedSuspects || []).filter((d) => d.kind === 'gap_jump' || d.kind === 'coord_jump').map((d) => `${d.strokeIndex}:${d.toPointIndex}`));
  const touched = new Set();
  const cellOf = (x, y) => Math.min(rows - 1, Math.max(0, Math.floor(y / ch))) * cols + Math.min(cols - 1, Math.max(0, Math.floor(x / cw)));
  meas.strokes.forEach((s, si) => {
    for (let i = 0; i < s.x.length; i++) {
      if (i === 0 || skip.has(`${si}:${i}`)) {
        touched.add(cellOf(s.x[i], s.y[i]));
        continue;
      }
      const dist = Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
      const steps = Math.max(1, Math.ceil(dist / 0.25));
      for (let k = 0; k <= steps; k++) touched.add(cellOf(s.x[i - 1] + ((s.x[i] - s.x[i - 1]) * k) / steps, s.y[i - 1] + ((s.y[i] - s.y[i - 1]) * k) / steps));
    }
  });
  // خلايا القطع: المستطيل في إطار النافذة مطروحاً منه أصل السطح، بمساحة موجبة مع الخليّة
  const cutout = new Set();
  for (const r of meas.cutoutRectsPx || []) {
    const left = r.left - meas.surfaceOriginXPx;
    const right = r.right - meas.surfaceOriginXPx;
    const top = r.top - meas.surfaceOriginYPx;
    const bottom = r.bottom - meas.surfaceOriginYPx;
    for (let row2 = 0; row2 < rows; row2++) {
      for (let col = 0; col < cols; col++) {
        const overlapW = Math.min(right, (col + 1) * cw) - Math.max(left, col * cw);
        const overlapH = Math.min(bottom, (row2 + 1) * ch) - Math.max(top, row2 * ch);
        if (overlapW > 0 && overlapH > 0) cutout.add(row2 * cols + col);
      }
    }
  }
  for (const c of cutout) touched.delete(c);
  return {touched, cutout};
}

for (const k of LABELS) {
  const m = m02(k);
  eq(P[k].timeSeries.footer.fieldsVersion, 71, `[أ][${k}] الختم 71`);
  // القسم: gridCols = round(surfaceWidthPx ÷ (6 مم × pxPerMm)) وكذلك gridRows (أدنى 1، أقصى 200)؛ cellWidthPx = surfaceWidthPx ÷ gridCols
  const clampDim = (v) => Math.min(200, Math.max(1, Math.round(v)));
  eq([m.gridCols, m.gridRows], [clampDim(m.surfaceWidthPx / (m.cellTargetMm * m.pxPerMm)), clampDim(m.surfaceHeightPx / (m.cellTargetMm * m.pxPerMm))], `[أ][${k}] gridCols وgridRows = round(السطح ÷ (cellTargetMm × pxPerMm)) بصيغة القسم`);
  eq([m.cellTargetMm, m.cellWidthPx, m.cellHeightPx], [4, m.surfaceWidthPx / m.gridCols, m.surfaceHeightPx / m.gridRows], `[أ][${k}] الخليّة المستهدَفة 4 مم، وعرضها وارتفاعها = السطح ÷ عدد الأعمدة/الصفوف`);
  const o = oracle(m);
  eq([...o.cutout].sort((a, b) => a - b), m.cutoutCells, `[أ][${k}] cutoutCells = خلايا مستطيلات القطع بمساحة موجبة (حساب مستقلّ)`);
  // «إطار + X» (2026-10-21، NeuralChek@4c0102c): حلّ هذا الكتلة محلّ «totalCells = cols×rows − |cutoutCells|» و«touchedCells = كل الخلايا الملموسة» (القاعدة 23) — المطلوب = الشبكة − cutoutCells − notRequiredCells
  // (العقد: wire-m02-frame-x-2026-10-21، البنود 1–6). **لا هندسة قطرين هنا ولا في الخادم** (القاعدة 24): المرجع يقرأ notRequiredCells كما شُحنت ويتحقّق من خواصّها.
  eq(m.gridPattern, 'FRAME_AND_DIAGONALS', `[أ][${k}] gridPattern = FRAME_AND_DIAGONALS (التطبيق الجديد يكتبه دائماً)`);
  const cellTotal = m.gridCols * m.gridRows;
  ok(m.notRequiredCells.every((i, idx) => Number.isInteger(i) && i >= 0 && i < cellTotal && (idx === 0 || m.notRequiredCells[idx - 1] < i)), `[أ][${k}] notRequiredCells: أعداد صحيحة داخل الشبكة، مرتّبة تصاعدياً بلا تكرار`);
  eq(m.notRequiredCells.filter((i) => o.cutout.has(i)), [], `[أ][${k}] العلاقة 1: cutoutCells وnotRequiredCells منفصلتان`);
  const frameIndexes = [];
  for (let i = 0; i < cellTotal; i++) {
    const r = Math.floor(i / m.gridCols);
    const c = i % m.gridCols;
    if (r === 0 || r === m.gridRows - 1 || c === 0 || c === m.gridCols - 1) frameIndexes.push(i);
  }
  eq(frameIndexes.length, 2 * m.gridCols + 2 * (m.gridRows - 2), `[أ][${k}] ضابط: خلايا الإطار = 2×cols + 2×(rows−2) (${frameIndexes.length})`);
  eq(frameIndexes.filter((i) => m.notRequiredCells.includes(i)), [], `[أ][${k}] حدّ الإطار الأدنى (البند 6): لا خلية من الحواف الأربع في notRequiredCells`);
  const requiredSet = new Set();
  for (let i = 0; i < cellTotal; i++) if (!o.cutout.has(i) && !m.notRequiredCells.includes(i)) requiredSet.add(i);
  eq(m.totalCells, requiredSet.size, `[أ][${k}] العلاقة 2: totalCells = cols × rows − |cutoutCells| − |notRequiredCells| = ${requiredSet.size} (عدّ مستقلّ للمجموعة المطلوبة)`);
  const touchedRequired = [...o.touched].filter((i) => requiredSet.has(i));
  eq(touchedRequired.length, m.touchedCells, `[أ][${k}] العلاقة 3: touchedCells المشحون = عدّ مستقلّ من المسار للخلايا **المطلوبة** وحدها (${touchedRequired.length}) — اصطلاح الخليّة floor(x ÷ cellWidthPx) مطابق`);
  const untouchedOracle = [];
  for (let i = 0; i < cellTotal; i++) if (requiredSet.has(i) && !o.touched.has(i)) untouchedOracle.push(i);
  eq(untouchedOracle, m.untouchedCells, `[أ][${k}] العلاقة 4: untouchedCells المشحون = المطلوبة غير الملموسة (مرتّبة، بلا مقصاة ولا غير مطلوبة)`);
  eq(m.touchedCells + m.untouchedCells.length, m.totalCells, `[أ][${k}] touchedCells + |untouchedCells| = totalCells`);
  eq(m.endReason === 'auto_complete', m.untouchedCells.length === 0 && m.touchedCells === m.totalCells, `[أ][${k}] العلاقة 5: auto_complete ⟺ لُمست كل الخلايا المطلوبة`);
  // لمسة المسار خارج المطلوب لا تُحسب لكنها تبقى في الخامّ (القاعدة 20): في 11ch لمس المسح كلّ الخلايا غير المطلوبة أيضاً
  const touchedNotRequired = [...o.touched].filter((i) => m.notRequiredCells.includes(i));
  if (k === '11ch') eq(touchedNotRequired.length, 406, `[أ][${k}] 11ch: المسار يلمس الخلايا غير المطلوبة كلّها (406) ولم يُحسب منها شيء في touchedCells`);
  // السقف (E18): maxPoints=15,000؛ والمسجَّلة = مجموع نقاط الخطوط؛ reached ⟺ بلغت المسجَّلة السقف (قسم f9e0571)
  const points = m.strokes.reduce((a, s) => a + s.x.length, 0);
  eq(m.pathCap.maxPoints, 15000, `[أ][${k}] pathCap.maxPoints = 15,000 (E18 معتمد 2026-10-15)`);
  eq(m.pathCap.reached, points === m.pathCap.maxPoints, `[أ][${k}] reached ⟺ المسجَّلة (${points}) = maxPoints`);
  for (const s of m.strokes) {
    eq([s.dtMs.length === s.x.length, s.y.length === s.x.length, s.dtMs[0], s.dtMs.every((d) => Number.isInteger(d) && d >= 0), s.touchMajorPx.length === s.x.length], [true, true, 0, true, true], `[أ][${k}] طول dtMs = x = y = touchMajorPx، وdtMs[0]=0، وبلا سالب`);
  }
  // الإطار: x/y في إطار السطح المحلّي: داخل [0، surfaceWidthPx] و[0، surfaceHeightPx]
  ok(m.strokes.every((s) => s.x.every((v) => v >= 0 && v <= m.surfaceWidthPx) && s.y.every((v) => v >= 0 && v <= m.surfaceHeightPx)), `[أ][${k}] إحداثيات الخطوط داخل السطح المحلّي (الإطار كما في القسم)`);
  // ما لا يحمله القسم في الحمولة: لا مفتاح خارج العقد
  const CONTRACT = new Set([...Object.values(N.TOUCH_GRID_MEASUREMENT_KEYS), ...Object.keys(N.TOUCH_PATH_FIELD_SPEC), ...Object.values(N.TOUCH_GRID_PATTERN_KEYS)]);
  eq(Object.keys(m).filter((key) => !CONTRACT.has(key)), [], `[أ][${k}] كل مفتاح في M-02 مسمّى في العقد (لا مفتاح من خارجه)`);
  // أحداث الصوت: العدّادان وزمن أوّل ضغطة وholdMs من عدّ مستقلّ
  for (const id of ['M-09', 'M-10']) {
    const v = row(k, id).measurements;
    const downs = v.events.filter((e) => e.action === 'down' && e.repeat === 0);
    eq([v.expectedDownCount, v.otherKeyDownCount], [downs.filter((e) => e.keyCode === v.expectedKeyCode).length, downs.filter((e) => e.keyCode !== v.expectedKeyCode).length], `[أ][${k}][${id}] العدّادان = عدّ مستقلّ لضغطات down بـrepeat=0`);
    const firstDown = v.events.findIndex((e) => e.action === 'down' && e.keyCode === v.expectedKeyCode);
    eq('timeToFirstExpectedDownMs' in v, firstDown >= 0, `[أ][${k}][${id}] timeToFirstExpectedDownMs حاضر ⟺ ضغطة مطلوبة`);
    if (firstDown >= 0) {
      eq(v.timeToFirstExpectedDownMs, v.events[firstDown].tMs, `[أ][${k}][${id}] timeToFirstExpectedDownMs = tMs أوّل ضغطة مطلوبة`);
      const up = v.events.findIndex((e, i) => i > firstDown && e.action === 'up' && e.keyCode === v.expectedKeyCode);
      eq('holdMs' in v, up >= 0, `[أ][${k}][${id}] holdMs حاضر ⟺ وصل up للمفتاح بعد الضغطة`);
      if (up >= 0) eq(v.holdMs, v.events[up].tMs - v.events[firstDown].tMs, `[أ][${k}][${id}] holdMs = tMs أوّل up بعد الضغطة − tMs الضغطة`);
    }
    eq(v.eventsTotal, v.events.length, `[أ][${k}][${id}] eventsTotal = المسرود (تحت سقف 64)`);
    ok(v.events.every((e) => [24, 25, 164].includes(e.keyCode)), `[أ][${k}][${id}] كل حدث من عائلة الصوت (24 · 25 · 164)`);
    eq('detectionSource' in v, v.endReason === 'auto_detected', `[أ][${k}][${id}] detectionSource حاضر ⟺ endReason = auto_detected`);
  }
  // P6-13: المفاتيح الثلاثة معاً، في المواضع التي قرأها القارئ
  const ts = P[k].timeSeries;
  eq([ts.header.powerSaveState === P[k].powerSaveState, 'batteryWindowPct' in ts.footer, 'brightnessLock' in ts.footer, 'batteryWindowPct' in P[k], 'brightnessLock' in P[k]], [true, true, true, false, false],
      `[أ][${k}] المفاتيح الثلاثة معاً: powerSaveState في الترويسة والجذر بقيمة واحدة، وbatteryWindowPct وbrightnessLock في التذييل لا في جذر الحمولة`);
  eq(ts.header.powerSaveState === 'read_failed', !('isPowerSaveMode' in ts.header) && !('powerSaveMode' in P[k]), `[أ][${k}] المنطقيّان غائبان ⟺ read_failed (لا false)`);
  eq(ts.footer.fieldsNotInFile.includes('batteryWindowPct') || ts.footer.fieldsNotInFile.includes('brightnessLock'), false, `[أ][${k}] ولا اسم منها في fieldsNotInFile (هي في ملفّ بختم 71)`);
}

// ═══ ب) القارئ الحقيقي على الحمولات كما شُحنت ═══════════════════════════════════════════════════════════════════
const RD = Object.fromEntries(LABELS.map((k) => [k, R.readFv68(clone(P[k]))]));
for (const k of LABELS) {
  const r = RD[k];
  eq([r.readerError, r.fieldsVersion, r.applicable, own(r)], [undefined, 71, true, []], `[ب][${k}] القارئ لم يرمِ، والختم 71 مُنطبِق، **وصفر شذوذ** (حمولة المُنتِج كما شحنها)`);
  eq(r.measurements.expectedButAbsent, [], `[ب][${k}] لا «غائب متوقَّع»`);
  eq([r.touchGridAnswer.state, r.volumeButtonAnswers['M-09'].state, r.volumeButtonAnswers['M-10'].state, r.scanConditions.state], ['RAW_PRESENT', 'RAW_PRESENT', 'RAW_PRESENT', 'READ'], `[ب][${k}] الأقسام الأربعة العليا مقروءة بخامّها`);
  const tg = r.measurements.items.find((i) => i.testId === 'M-02').touchGrid;
  eq([tg.gridBasis, tg.path.state, tg.path.analysis.cells.state], ['MM_TARGET', 'READ', 'MATCH'], `[ب][${k}] أساس الشبكة MM_TARGET، والكتلة مقروءة، وخلايا الخادم من الخامّ = ما شحنه المُنتِج (MATCH)`);
  eq([tg.path.densityCheckUnrecognized.total, tg.path.resampledFlagStateState.recognized], [0, true], `[ب][${k}] densityCheck بلا اسم مجهول، وresampledFlagState معروفة`);
}
eq(LABELS.map((k) => RD[k].touchGridAnswer), [
  {state: 'RAW_PRESENT', manualStatus: 'pass', passRawRelation: 'BACKS_PASS', rawEndReason: 'auto_complete'},
  {state: 'RAW_PRESENT', manualStatus: 'fail', passRawRelation: 'NOT_APPLICABLE_STATUS_NOT_PASS', rawEndReason: 'user_marked_not_working'},
  {state: 'RAW_PRESENT', manualStatus: 'not_tested', passRawRelation: 'NOT_APPLICABLE_STATUS_NOT_PASS', rawEndReason: 'user_marked_not_tested'},
], '[ب] جواب M-02: pass يسنده auto_complete (11ch) · fail · not_tested');
eq(LABELS.map((k) => [RD[k].volumeButtonAnswers['M-09'].manualStatus, RD[k].volumeButtonAnswers['M-10'].manualStatus]), [['pass', 'pass'], ['pass', 'fail'], ['not_tested', 'not_tested']], '[ب] حالتا M-09/M-10 كما في الحمولات');
eq(LABELS.map((k) => RD[k].scanConditions.header.powerSaveState), ['off', 'off', 'read_failed'], '[ب] powerSaveState: off · off · read_failed');
// الأجوبة تُقرأ من الحمولة لا من الخادم: ما يخرج بلا إحداثيات خامّ (القاعدة 20)
for (const k of LABELS) {
  const bad = [];
  const walk = (node, p) => {
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (node && typeof node === 'object') for (const [key, v] of Object.entries(node)) { if (['x', 'y', 'dtMs', 'touchMajorPx'].includes(key) && Array.isArray(v)) bad.push(`${p}.${key}`); walk(v, `${p}.${key}`); }
  };
  walk(RD[k].measurements, 'measurements');
  eq(bad, [], `[ب][${k}] مخرَج القارئ بلا مصفوفات إحداثيات خامّ (القاعدة 20: الخامّ يبقى في reportRaw)`);
}

// ═══ جـ) التمرير والتخزين لا يُسقطان الخامّ، والحجم مقيس من الملفّ ═══════════════════════════════════════════════
const rawDocOf = (fp) => buildReportRawDocument({scanId: 'producer-sample-scan-id', fingerprint: fp, isSessionScan: false, sessionId: null, deviceFingerprintSha: null, timeSeriesStoragePath: null, aiResultAudit: null, createdAt: null});
const sizes = {};
for (const k of LABELS) {
  const fp = P[k];
  const light = lightenFingerprintForStorage(fp);
  const doc = rawDocOf(fp);
  for (const id of ['M-02', 'M-09', 'M-10']) {
    eq(row(k, id).measurements, light.manualResults.find((m) => m.testId === id).measurements, `[جـ][${k}][${id}] lightenFingerprintForStorage تُبقي measurements بلا مساس`);
    eq(JSON.stringify(doc.rawFingerprint.manualResults.find((m) => m.testId === id).measurements), JSON.stringify(row(k, id).measurements), `[جـ][${k}][${id}] مستند reportRaw يحمل الخامّ بايتاً ببايت (القاعدة 25)`);
  }
  for (const [label, fpv] of [['lighten', light], ['reportRaw', doc.rawFingerprint]]) {
    eq([fpv.timeSeries.footer.brightnessLock, fpv.timeSeries.footer.batteryWindowPct, fpv.timeSeries.header.powerSaveState, fpv.powerSaveState, 'isPowerSaveMode' in fpv.timeSeries.header, 'powerSaveMode' in fpv],
        [fp.timeSeries.footer.brightnessLock, fp.timeSeries.footer.batteryWindowPct, fp.timeSeries.header.powerSaveState, fp.powerSaveState, 'isPowerSaveMode' in fp.timeSeries.header, 'powerSaveMode' in fp], `[جـ][${k}][${label}] حقول P6-13 تبقى كما شُحنت (والمنطقيّان حضوراً وغياباً)`);
  }
  eq(doc.rawFingerprint.timeSeries.footer.fieldsVersion, 71, `[جـ][${k}] وختم 71 في المخزَّن`);
  const bytes = assertReportRawFits(doc);
  sizes[k] = {m02: Buffer.byteLength(JSON.stringify(m02(k))), doc: bytes, points: m02(k).strokes.reduce((a, s) => a + s.x.length, 0)};
  ok(bytes === measureReportRawBytes(doc) && bytes < REPORT_RAW_MAX_BYTES, `[جـ][${k}] وحجمه ${bytes} بايتاً تحت الحارس ${REPORT_RAW_MAX_BYTES}`);
  console.log(`  [قياس من الملفّ] ${FILES[k].slice(-45)}: M-02 ${sizes[k].m02} بايتاً لـ${sizes[k].points} نقطة (${(sizes[k].m02 / sizes[k].points).toFixed(2)} للنقطة) ومستند reportRaw ${bytes} بايتاً`);
}
ok(sizes['16ch'].points === 15000 && sizes['16ch'].doc < REPORT_RAW_MAX_BYTES / 2, `[جـ] عند سقف 15,000 نقطة (16ch): المستند ${sizes['16ch'].doc} بايتاً (أقلّ من نصف الحارس) — مقيس من حمولة المُنتِج`);

// ═══ د) حارس الحجم: السقف يمرّ، وضعف السقف مرّتين يُرفض بخطأ صريح ═════════════════════════════════════════════════
{
  // مشتقّة من 16ch بتكرار خطّها الوحيد خمس مرّات (75,000 نقطة): ليست حمولة مُنتِج — تُحاكي ما لو لم يلتزم التطبيق بسقفه (pathCap)
  // (كانت أربع مرّات = 60,000 نقطة على 4c0102c؛ على 3810146 إحداثيات الخطّ أقصر نصّاً فالأربع 839,656 بايتاً تمرّ تحت الحارس: القياس في رأس الملفّ)
  const big = clone(P['16ch']);
  const m = big.manualResults.find((x) => x.testId === 'M-02').measurements;
  m.strokes = [0, 1, 2, 3, 4].map(() => clone(P['16ch'].manualResults.find((x) => x.testId === 'M-02').measurements.strokes[0]));
  let err = null;
  try {
    assertReportRawFits(rawDocOf(big));
  } catch (e) {
    err = e;
  }
  ok(err !== null && err.code === 'REPORT_RAW_TOO_LARGE' && err.bytes > REPORT_RAW_MAX_BYTES, `[د] 75,000 نقطة (5 × سقف، مشتقّة من 16ch): REPORT_RAW_TOO_LARGE بالحجم المقيس (${err && err.bytes}) — لا اقتطاع صامت`);
  const analyzeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'analysis', 'analyzeDevice.js'), 'utf8');
  ok(/assertReportRawFits\(rawDocument\);[\s\S]{0,400}REPORT_RAW_TOO_LARGE[\s\S]{0,300}resource-exhausted/.test(analyzeSrc), '[د] وفي analyzeDevice يصير الرفض resource-exhausted قبل أيّ كتابة (analyzeDevice.js: assertReportRawFits ⟵ HttpsError)');
  ok(analyzeSrc.indexOf('assertReportRawFits(rawDocument)') < analyzeSrc.indexOf('await writeReportAndRaw('), '[د] والفحص قبل الكتابة الذرّية (لا تقرير ولا خامّ ولا خصم فحصة)');
}

// ═══ هـ) بصمة تغطية العيّنات الثلاث ═══════════════════════════════════════════════════════════════════════════════
// ما تحمله العيّنات من القيم المعدَّدة (مكتوب باليد): فإن غيّر التطبيق عيّناته فشل هذا الاختبار (بعد sha256) فتُراجَع قائمة «لا تغطّيه» في golden/README.md وتقرير المزامنة.
{
  const uniq = (a) => [...new Set(a)].sort();
  const all = (fn) => uniq(LABELS.flatMap(fn));
  eq(all((k) => [m02(k).endReason]), ['auto_complete', 'user_marked_not_tested', 'user_marked_not_working'], '[هـ] endReason لـM-02 في العيّنات: ثلاث من الأربع (dismissed غائبة)');
  eq(all((k) => m02(k).strokes.map((s) => s.end)), ['cancel_flagged', 'open_at_end', 'up'], '[هـ] strokes[].end: ثلاث من الأربع (cancel غائبة)');
  eq(all((k) => m02(k).strokes.map((s) => s.toolType)), ['touch'], '[هـ] toolType: touch وحدها');
  eq(all((k) => [m02(k).densitySource]), ['XDPI', 'XDPI_MODE_SCALED'], '[هـ] densitySource: اثنتان من الثلاث (DENSITY_DPI_FALLBACK غائبة)');
  // «إطار + X» (2026-10-21): المفتاحان في الثلاث بالنمط FRAME_AND_DIAGONALS و180 غير مطلوبة؛ ALL_CELLS وغياب المفتاحين (NOT_DECLARED) لا تغطّيهما هذه الثلاث — الثاني من مُنتِج حقيقي سابق في fv71-before-m02-frame-x-*
  eq(all((k) => [m02(k).gridPattern]), ['FRAME_AND_DIAGONALS'], '[هـ] gridPattern: FRAME_AND_DIAGONALS وحدها (ALL_CELLS غائبة)');
  eq(all((k) => [String(m02(k).notRequiredCells.length)]), ['406', '432'], '[هـ] notRequiredCells: 406 فهرساً في 11ch (18×33 = 594 − 188 مطلوبة؛ بلا كاميرا) و432 في 13ch وفي 16ch (18×35 = 630 − 194 مطلوبة − 4 مقصاة [8، 9، 26، 27])');
  eq(all((k) => m02(k).densityCheck), [], '[هـ] densityCheck: [] في الثلاث (الأسماء الخمسة لا تُرى في عيّنة مُنتِج)');
  eq(all((k) => [m02(k).resampledFlagState]), ['not_available_api'], '[هـ] resampledFlagState: not_available_api وحدها (not_read_by_app غائبة)');
  eq(all((k) => (m02(k).displayedSuspects || []).map((d) => d.kind)), ['coord_jump', 'edge_exit', 'gap_jump'], '[هـ] displayedSuspects.kind: الثلاث كلّها');
  eq(all((k) => Object.values(m02(k).absentFieldReasons || {}).map((v) => v.split(':')[0])), ['read_failed'], '[هـ] أسباب الغياب: read_failed وحدها (api_below_<n> وnot_reported_by_device غائبتان)');
  eq(all((k) => [m02(k).pathCap.reached]).map(String), ['false', 'true'], '[هـ] pathCap.reached: false وtrue كلتاهما');
  eq(all((k) => ['M-09', 'M-10'].map((id) => row(k, id).measurements.endReason)), ['auto_detected', 'dismissed', 'user_marked_not_tested', 'user_marked_not_working', 'user_marked_working'], '[هـ] endReason لأزرار الصوت: الخمس كلّها');
  eq(all((k) => ['M-09', 'M-10'].map((id) => row(k, id).measurements.detectionSource || 'absent')), ['absent', 'key_event', 'volume_level_change'], '[هـ] detectionSource: القيمتان');
  eq(all((k) => ['M-09', 'M-10'].map((id) => String(row(k, id).measurements.expectedKeyCode))), ['24', '25'], '[هـ] expectedKeyCode: 24 و‏25');
  eq(LABELS.map((k) => ['M-09', 'M-10'].map((id) => row(k, id).measurements.expectedKeyCode)), [[24, 25], [24, 25], [24, 25]], '[هـ] M-09 ⟵ 24 وM-10 ⟵ 25 في الثلاث (القسم صامت عن أيّهما رفع: لا يُفرض في القارئ)');
  eq(all((k) => [P[k].powerSaveState]), ['off', 'read_failed'], '[هـ] powerSaveState: off وread_failed (on غائبة)');
  eq(all((k) => [P[k].timeSeries.footer.brightnessLock.state.split(':')[0]]), ['applied', 'apply_failed', 'not_attempted'], '[هـ] brightnessLock.state: الثلاث (وسبب not_attempted: value_not_decided وحده)');
  eq(all((k) => [P[k].timeSeries.footer.brightnessLock.method || 'absent']), ['absent', 'window_attribute'], '[هـ] brightnessLock.method: window_attribute وحدها (system_setting غائبة)');
  eq(all((k) => [JSON.stringify(P[k].timeSeries.footer.batteryWindowPct), String(P[k].timeSeries.header.batteryLevelStart)]), ['43', '{"maxPct":85,"minPct":30}'].sort(), '[هـ] النافذة 30–85 وبداية الشحن 43 في الثلاث (BELOW_MIN وABOVE_MAX غائبتان)');
  eq(LABELS.map((k) => ['measurements' in row(k, 'M-02')]), [[true], [true], [true]], '[هـ] M-02 بخامّ في الثلاث (حالة pass بلا measurements — بعد NeuralChek@5f90ce1 — لا تغطّيها عيّنة)');
}

// ═══ ضوابط سلبية: المرجع المستقلّ يرى الفرق فعلاً (القاعدة 30) ═══════════════════════════════════════════════════════
{
  const m = clone(m02('13ch'));
  m.strokes[0].x[100] = m.strokes[0].x[100] + 130; // يحرّك نقطة فيتغيّر عدّ الخلايا أو يبقى؟ نحرّك قطعة كاملة بعيداً
  m.strokes[0].y[100] = m.strokes[0].y[100] + 900;
  ok(oracle(m).touched.size !== m02('13ch').touchedCells || JSON.stringify([...oracle(m).touched]) !== JSON.stringify([...oracle(m02('13ch')).touched]), '[ضابط] تحريك نقطة يغيّر مجموعة الخلايا من المرجع المستقلّ (المرجع ليس ثابتاً)');
  const noSkip = clone(m02('13ch'));
  delete noSkip.displayedSuspects;
  ok(oracle(noSkip).touched.size > m02('13ch').touchedCells, '[ضابط] بلا استثناء القطع الموسومة قفزة يُملأ ما لم يُملأ فعلاً: المرجع يعتمد على القفزتين (وإلا لما أثبت استثناءهما)');
}

console.log(`\nfv71ProducerSamples.test.js: ${n}/${n} assertions passed`);
