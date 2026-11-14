'use strict';

// touchPath.test.js — أحكام الخادم على خامّ مسار اللمس لـM-02 (fv71، الخيار «ب»)، S-M02، 2026-10-18 +03.
//
// الحدّ الذي يثبّته: touchPath.analyzeTouchPath وحدةً (دوال نقيّة) بمُدخلات مبنيّة باليد بحساب معروف سلفاً (كل رقم متوقَّع مكتوب هنا من التصميم ومن الهندسة، لا من مخرَج الوحدة).
// القارئ كاملاً بالحمولة (القاعدة 37) في fv71TouchGridReader.test.js؛ وحمولات المُنتِج الثلاث في fv71ProducerSamples.test.js (مزامنة 2026-10-18).
//
// المصدر: design-m02-touch-grid-2026-10-13.md §3 (الكاشف) و§2.2 (ملء الخلايا) و§6.6 (قارئ الخادم)، والعتبات في fv68Names.TOUCH_PATH_DETECTOR (كلّها [اجتهاد] غير مُعايرة).
// كل عتبة تُختبر على جانبيها (لا قيمة واحدة: القاعدة 30): قبلها فلا تُكشَف، وبعدها فتُكشَف.
//
// هندسة الاختبار: 10 بكسل = 1 مم (pxPerMm = 10)، سطح 1000×2000، شبكة 10×20 بخلايا 100×100، فاصل العيّنات 8 مث.
//
// Run: node functions/test/touchPath.test.js

const assert = require('assert');
const N = require('../src/analysis/fv68Names');
const {analyzeTouchPath, traverse, median, percentileNearestRank} = require('../src/analysis/touchPath');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); n++; };

const D = N.TOUCH_PATH_DETECTOR;
const KIND = N.TOUCH_PATH_SUSPECT_KIND;
const ST = N.TOUCH_PATH_DETECTION_STATE;
const EX = N.TOUCH_PATH_EXCLUSION;
const CC = N.TOUCH_PATH_CELLS_CHECK;

const GEOM = {surfaceWidthPx: 1000, surfaceHeightPx: 2000, pxPerMm: 10, gridCols: 10, gridRows: 20, cellWidthPx: 100, cellHeightPx: 100};
// «إطار + X» (2026-10-21): notRequired مُدخل صريح — [] = NOT_DECLARED (كل الخلايا عدا المقصاة مطلوبة، السلوك السابق)؛ وغيابه (null أو undefined) لا يُقرأ [] (القاعدة 22): cells.state = UNDETERMINED_REQUIRED_SET_UNKNOWN
const NO_CELLS = {cutout: [], notRequired: [], untouched: [], touchedCount: 0};
const INTERVAL = 8;

// خطّ مستقيم متّصل من (x0,y0) إلى (x1,y1) بخطوة ثابتة stepPx كل INTERVAL مث، يبدأ عند t0؛ يُعيد نقاطاً {x,y,t}
function line(x0, y0, x1, y1, stepPx, t0) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const k = Math.max(1, Math.round(dist / stepPx));
  const pts = [];
  for (let i = 0; i <= k; i++) pts.push({x: x0 + ((x1 - x0) * i) / k, y: y0 + ((y1 - y0) * i) / k, t: t0 + i * INTERVAL});
  return pts;
}
const concat = (...parts) => parts.flat();
function stroke(index, pts, opts = {}) {
  return {
    index, usable: true, pointerId: opts.pointerId === undefined ? 0 : opts.pointerId, end: opts.end === undefined ? 'up' : opts.end, endRecognized: opts.endRecognized !== false,
    downAtMs: pts[0].t, dtMs: pts.map((p, i) => (i === 0 ? 0 : p.t - pts[i - 1].t)), x: pts.map((p) => p.x), y: pts.map((p) => p.y), touchMajorPx: opts.touchMajorPx || null,
  };
}
const run = (strokes, over = {}) => analyzeTouchPath({
  strokes, geometry: {...GEOM, ...(over.geometry || {})}, reportedCells: over.reportedCells || NO_CELLS, displayed: over.displayed === undefined ? null : over.displayed,
});
const kinds = (r) => r.detector.suspects.map((s) => s.kind);

// ─── ثوابت العتبات: ما يقوله التصميم حرفاً (حارس ضدّ تغيير صامت) ──────────────────────────────────
eq([D.V_MIN_MM_PER_S, D.J_MIN_MM, D.JUMP_MEDIAN_FACTOR, D.MEDIAN_WINDOW_STEPS, D.SPEED_WINDOW_STEPS], [20, 1.5, 3, 8, 3], '[عتبات] V_MIN=20 · J_MIN=1.5 · 3× وسيط آخر 8 خطوات · سرعة آخر 3 خطوات (design §3.1)');
eq([D.GAP_MIN_MS, D.GAP_MEDIAN_FACTOR, D.R_MAX_MS, D.STRONG_LIFT_GAP_MS], [20, 3, 120, 40], '[عتبات] gap: max(20 مث، 3×وسيط) · R_MAX=120 · قويّ < 40 (design §3.1)');
eq([D.LANDING_MIN_MM, D.LANDING_EXPECTED_FRACTION, D.RETURN_MIN_SAMPLES, D.RETURN_MIN_MM, D.RETURN_MAX_ANGLE_DEG], [3, 0.5, 3, 2, 45], '[عتبات] هبوط max(3 مم، نصف المتوقَّع) · عودة 3 عيّنات و2 مم و45° (design §3.1)');
eq([D.PALM_TOUCH_MAJOR_MM, D.EDGE_MARGIN_MM], [15, 5], '[عتبات] راحة اليد > 15 مم · هامش الحافّة 5 مم (design §3.3)');

// ─── دوال مساعدة: الوسيط والمئين بالرتبة الأقرب ────────────────────────────────────────────────
eq([median([]), median([5]), median([1, 3]), median([3, 1, 2]), median([4, 1, 3, 2])], [null, 5, 2, 2, 2.5], '[وسيط] فارغ null · فردي · زوجي = متوسّط الوسطيين · لا يعدّل المُدخل');
{
  const a = [3, 1, 2];
  median(a);
  eq(a, [3, 1, 2], '[وسيط] لا يُغيّر مصفوفة المُدخل');
  const twenty8 = [...Array(19).fill(8), 40];
  const twenty8b = [...Array(18).fill(8), 40, 40];
  eq([percentileNearestRank(twenty8, 0.95), percentileNearestRank(twenty8b, 0.95), percentileNearestRank([], 0.95), percentileNearestRank([7], 0.95)], [8, 40, null, 7],
      '[مئين] الرتبة الأقرب: ceil(0.95×20)=19 ⇒ العنصر 19 (8 حين واحد كبير؛ 40 حين اثنان) · فارغ null · عنصر واحد');
}

{
  const oneTo = (k) => Array.from({length: k}, (_, i) => i + 1);
  eq([percentileNearestRank(oneTo(21), 0.95), percentileNearestRank(oneTo(10), 0.95), percentileNearestRank(oneTo(100), 0.95)], [20, 10, 95],
      '[مئين] الرتبة ceil(p×n) لا floor: 21 عنصراً ⟵ الرتبة 20 · 10 عناصر ⟵ الرتبة 10 · 100 عنصر ⟵ 95');
}

// ─── (١) القفز بلا رفع: كل عتبة على جانبيها ───────────────────────────────────────────────────────
// 100 مم/ث = 1000 بكسل/ث ⇒ 8 بكسل (0.8 مم) كل 8 مث. العتبة = max(1.5 مم، 3 × 0.8 = 2.4 مم).
{
  const steady = line(100, 500, 100 + 8 * 39, 500, 8, 0); // 40 نقطة
  const r0 = run([stroke(0, steady)]);
  eq([r0.detector.state, r0.detector.suspects, r0.detector.edgeExits], [ST.RAN, [], []], '[قفز] مسار منتظم: لا مواضع');
  eq(r0.detector.counts.stepsEvaluated, 40 - 1 - D.MIN_HISTORY_STEPS, '[قفز] الخطوات المقيَّمة = n − 1 − 3 (لا تقييم بلا ثلاث خطوات سابقة)');

  // بعد النقطة 20 خطوة كبيرة بمسافة d بكسل وزمن dt
  const withJump = (jumpPx, dt) => {
    const a = line(100, 500, 100 + 8 * 20, 500, 8, 0);
    const last = a[a.length - 1];
    const b = [{x: last.x + jumpPx, y: 500, t: last.t + dt}];
    let prev = b[0];
    for (let i = 1; i <= 12; i++) {
      prev = {x: prev.x + 8, y: 500, t: prev.t + INTERVAL};
      b.push(prev);
    }
    return [stroke(0, concat(a, b)), a.length - 1];
  };
  {
    const [s, from] = withJump(23.9, INTERVAL); // 2.39 مم < 2.4: لا
    eq(run([s]).detector.suspects, [], '[قفز] خطوة 2.39 مم (تحت 3×الوسيط=2.4): لا موضع');
  }
  {
    const [s, from] = withJump(24.5, INTERVAL); // 2.45 مم > 2.4: coord_jump (زمن عاديّ)
    const r = run([s]);
    eq(kinds(r), [KIND.COORD_JUMP], '[قفز] خطوة 2.45 مم بزمن عاديّ: coord_jump (تشوّه إحداثيات بلا فجوة زمنية)');
    const sus = r.detector.suspects[0];
    eq([sus.strokeIndex, sus.fromPointIndex, sus.toPointIndex, sus.toStrokeIndex, sus.gapMs, sus.strong], [0, from, from + 1, 0, 8, false], '[قفز] الفهرسان: آخر عيّنة قبل القفز والعيّنة الواصلة');
    ok(Math.abs(sus.distMm - 3.2) < 0.0001 || Math.abs(sus.distMm - Math.hypot(24.5 + 0, 0) / 10) < 0.0001, '[قفز] المسافة بالملّيمتر = الخطوة ÷ pxPerMm');
  }
  {
    // الفاصل الزمني: 24 مث = max(20، 3×8=24) لا يتجاوزه (coord_jump)؛ 25 مث يتجاوزه (gap_jump)
    eq(kinds(run([withJump(60, 24)[0]])), [KIND.COORD_JUMP], '[قفز] فاصل 24 مث (= 3×الوسيط): ليس فجوة ⇒ coord_jump');
    eq(kinds(run([withJump(60, 25)[0]])), [KIND.GAP_JUMP], '[قفز] فاصل 25 مث (> 3×الوسيط): gap_jump');
    eq(kinds(run([withJump(60, 200)[0]])), [KIND.GAP_JUMP], '[قفز] فاصل 200 مث: gap_jump');
  }
  // GAP_MIN_MS: إيقاع بطيء (وسيط الفاصل 4 مث ⇒ 3×4=12 < 20 ⇒ العتبة 20): فاصل 19 مث coord_jump، و21 gap_jump
  {
    const slow = (dt) => {
      const a = [];
      for (let i = 0; i <= 20; i++) a.push({x: 100 + i * 4, y: 500, t: i * 4}); // 4 بكسل كل 4 مث = 100 مم/ث
      const last = a[a.length - 1];
      const b = [{x: last.x + 40, y: 500, t: last.t + dt}];
      for (let i = 1; i <= 10; i++) b.push({x: b[0].x + i * 4, y: 500, t: b[0].t + i * 4});
      return run([stroke(0, concat(a, b))]);
    };
    eq([kinds(slow(19)), kinds(slow(21))], [[KIND.COORD_JUMP], [KIND.GAP_JUMP]], '[قفز] أرضية الفجوة 20 مث حين 3×الوسيط أقلّ منها: 19 ⇒ coord_jump و21 ⇒ gap_jump');
  }
  // أرضية J_MIN: إصبع بطيء 25 مم/ث (خطوة 2 بكسل = 0.2 مم؛ 3×0.2 = 0.6 < 1.5): العتبة 1.5 مم
  {
    const slowFinger = (speedMmS, jumpPx) => {
      const stepPx = (speedMmS * 10 * INTERVAL) / 1000;
      const a = line(100, 500, 100 + stepPx * 20, 500, stepPx, 0);
      const last = a[a.length - 1];
      const b = [{x: last.x + jumpPx, y: 500, t: last.t + INTERVAL}];
      for (let i = 1; i <= 10; i++) b.push({x: b[0].x + stepPx * i, y: 500, t: b[0].t + i * INTERVAL});
      return run([stroke(0, concat(a, b))]);
    };
    eq(kinds(slowFinger(25, 14)), [], '[قفز] إصبع 25 مم/ث، خطوة 1.4 مم (< J_MIN=1.5): لا');
    eq(kinds(slowFinger(25, 16)), [KIND.COORD_JUMP], '[قفز] إصبع 25 مم/ث، خطوة 1.6 مم (> J_MIN، > 3×الوسيط): coord_jump');
    // سرعة التحرّك: V_MIN=20 مم/ث — تحتها «الإصبع الساكن لا يُقرأ منه شيء»
    eq(kinds(slowFinger(19, 30)), [], '[قفز] إصبع 19 مم/ث (< V_MIN) وخطوة 3 مم: لا يُقيَّم (الإصبع ساكن بالتعريف)');
    eq(kinds(slowFinger(21, 30)), [KIND.COORD_JUMP], '[قفز] إصبع 21 مم/ث (≥ V_MIN) وخطوة 3 مم: coord_jump');
    // حدّ J_MIN بالمساواة الحقيقية: خطوة 1.5 مم بالضبط (15 بكسل) ليست «أكبر من» العتبة؛ و1.51 كذلك أكبر
    eq(kinds(slowFinger(25, 15)), [], '[قفز] خطوة 1.5 مم بالضبط (= J_MIN، 3×الوسيط 0.6 دونها): ليست أكبر من العتبة ⟵ لا موضع');
    eq(kinds(slowFinger(25, 15.1)), [KIND.COORD_JUMP], '[قفز] خطوة 1.51 مم: موضع');
  }
  // حدّ V_MIN بالمساواة الحقيقية: خطوتان بـ2 بكسل كل 10 مث = 200 بكسل/ث = 20 مم/ث بالضبط (الحساب بالضرب في 1000 قبل القسمة فلا يخرج 20.000000000000004)
  {
    const exactSpeed = (stepPx, jumpPx) => {
      const a = [];
      for (let i = 0; i <= 20; i++) a.push({x: 100 + i * stepPx, y: 500, t: i * 10});
      const last = a[a.length - 1];
      const b = [{x: last.x + jumpPx, y: 500, t: last.t + 10}];
      for (let i = 1; i <= 8; i++) b.push({x: b[0].x + i * stepPx, y: 500, t: b[0].t + i * 10});
      return run([stroke(0, concat(a, b))]);
    };
    eq(kinds(exactSpeed(2, 30)), [KIND.COORD_JUMP], '[قفز] إصبع 20 مم/ث بالضبط (= V_MIN): متحرّك (≥) ⟵ يُقيَّم ويُكشَف');
    eq(kinds(exactSpeed(1, 30)), [], '[قفز] إصبع 10 مم/ث: ساكن بالتعريف ⟵ لا يُقيَّم');
  }
  // نافذة الوسيط 8 خطوات لا 4: تاريخ من أربع خطوات كبيرة (2 مم) ثم أربع صغيرة (0.8 مم) — وسيط الثماني 1.4 مم (العتبة 4.2)، ووسيط آخر أربع 0.8 (العتبة 2.4)
  {
    const pts = [{x: 100, y: 500, t: 0}];
    for (let i = 1; i <= 4; i++) pts.push({x: pts[i - 1].x + 20, y: 500, t: i * INTERVAL});
    for (let i = 5; i <= 8; i++) pts.push({x: pts[i - 1].x + 8, y: 500, t: i * INTERVAL});
    pts.push({x: pts[8].x + 35, y: 500, t: 9 * INTERVAL}); // خطوة 3.5 مم
    for (let i = 10; i <= 14; i++) pts.push({x: pts[i - 1].x + 8, y: 500, t: i * INTERVAL});
    eq(kinds(run([stroke(0, pts)])), [], '[قفز] خطوة 3.5 مم بعد تاريخ [2,2,2,2,0.8,0.8,0.8,0.8] مم: العتبة 3×وسيط الثماني (1.4) = 4.2 فلا موضع (نافذة 8 لا 4)');
    pts[9].x += 10; // الخطوة 4.5 مم > 4.2
    for (let i = 10; i < pts.length; i++) pts[i].x += 10;
    eq(kinds(run([stroke(0, pts)])), [KIND.COORD_JUMP], '[قفز] وخطوة 4.5 مم (> 4.2): موضع');
  }
  // بلا تاريخ كافٍ: قفزة عند العيّنة 3 (ثلاث خطوات سابقة تعني فهرساً ≥ 4)
  {
    const a = line(100, 500, 100 + 8 * 2, 500, 8, 0);
    const last = a[a.length - 1];
    const early = concat(a, [{x: last.x + 100, y: 500, t: last.t + 60}], line(last.x + 100, 500, last.x + 180, 500, 8, last.t + 60).slice(1));
    const r = run([stroke(0, early)]);
    // 14 نقطة ⇒ 13 خطوة؛ الخطوات المقيَّمة هي k ≥ 4 فقط (10 خطوات بعد القفزة)؛ القفزة نفسها عند k=3 لم يسبقها ثلاث خطوات فلا تُقيَّم ولا تُخمَّن
    eq([r.detector.suspects.length, r.detector.counts.stepsEvaluated], [0, 10], '[قفز] قفزة قبل ثلاث خطوات من التاريخ: لا تُقيَّم (لا موضع، وخطواتها غير داخلة في المقيَّمة)');
  }
}

// ─── (٢)+(٣) الانقطاع برفع والعودة ───────────────────────────────────────────────────────────────
// A: يميناً بـ100 مم/ث (1000 بكسل/ث بالضبط: 62 خطوة × 8 بكسل) حتى x=596 ثم يُرفع. B: يهبط بعد gap مث. الموضع المتوقَّع x = 596 + 1000×gap/1000 = 596 + gap بكسل.
{
  const A = () => line(100, 500, 596, 500, 8, 0);
  const lastA = (pts) => pts[pts.length - 1];
  const buildB = (gapMs, offsetPx, opts = {}) => {
    const a = A();
    const l = lastA(a);
    const bx = l.x + gapMs + (opts.dx || 0) + offsetPx;
    const dir = opts.dir || [1, 0];
    const pts = [];
    const t0 = l.t + gapMs;
    for (let i = 0; i < (opts.count || 20); i++) pts.push({x: bx + dir[0] * 8 * i, y: 500 + (opts.dy || 0) + dir[1] * 8 * i, t: t0 + i * INTERVAL});
    return [stroke(0, a, {end: opts.endA || 'up'}), stroke(1, pts, {pointerId: 0})];
  };
  {
    const r = run(buildB(70, 0));
    eq(kinds(r), [KIND.LIFT_BREAK], '[رفع] هبوط بعد 70 مث على الموضع المتوقَّع وعودة بالاتّجاه نفسه: lift_break');
    const s = r.detector.suspects[0];
    eq([s.strokeIndex, s.toStrokeIndex, s.toPointIndex, s.gapMs, s.strong], [0, 1, 0, 70, false], '[رفع] الربط بين الخطّين: من آخر عيّنة في A إلى أوّل عيّنة في B؛ 70 مث ليس «قويّاً»');
    eq(r.detector.counts.liftsConsidered, 1, '[رفع] رفع واحد مُقيَّم');
    eq(kinds(run(buildB(30, 0))), [KIND.LIFT_BREAK], '[رفع] 30 مث');
    eq(run(buildB(30, 0)).detector.suspects[0].strong, true, '[رفع] 30 مث (< 40): قويّ');
    eq(run(buildB(39, 0)).detector.suspects[0].strong, true, '[رفع] 39 مث: قويّ');
    eq(run(buildB(40, 0)).detector.suspects[0].strong, false, '[رفع] 40 مث (= حدّ القوّة لا دونه): ليس قويّاً');
    eq(kinds(run(buildB(120, 0))), [KIND.LIFT_BREAK], '[رفع] 120 مث (= R_MAX): ما زال انقطاعاً');
    const r121 = run(buildB(121, 0));
    eq([kinds(r121), r121.detector.counts.liftsIntentionalGap], [[], 1], '[رفع] 121 مث (> R_MAX): رفع متعمَّد، يُعدّ ولا يُكشَف');
    eq(kinds(run(buildB(0, 0))), [KIND.LIFT_BREAK], '[رفع] فاصل 0 (الرفع والهبوط في المللي ثانية نفسه): ضمن 0..R_MAX');
  }
  // الهبوط: max(3 مم، نصف المتوقَّع). gap=70 ⇒ المتوقَّع 7 مم ⇒ نصفه 3.5 ⇒ العتبة 3.5 مم = 35 بكسل (انحراف عمودي)
  {
    const near = run(buildB(70, 0, {dy: 34}));
    eq(kinds(near), [KIND.LIFT_BREAK], '[رفع] هبوط منحرف 3.4 مم (< 3.5): انقطاع');
    const far = run(buildB(70, 0, {dy: 36}));
    eq([kinds(far), far.detector.counts.liftsLandedFar], [[], 1], '[رفع] هبوط منحرف 3.6 مم (> 3.5): هبوط بعيد = رفع متعمَّد');
    // gap=20 ⇒ المتوقَّع 2 مم ⇒ نصفه 1 ⇒ الأرضية 3 مم: انحراف 2.9 ينجح و3.1 يفشل
    eq(kinds(run(buildB(20, 0, {dy: 29}))), [KIND.LIFT_BREAK], '[رفع] gap=20: أرضية الهبوط 3 مم، انحراف 2.9: انقطاع');
    eq(run(buildB(20, 0, {dy: 31})).detector.counts.liftsLandedFar, 1, '[رفع] gap=20: انحراف 3.1 > 3: بعيد');
    // الحدّ بالمساواة: انحراف 3.0 مم بالضبط (= الأرضية) ⟵ يُقبَل (≤)
    eq(kinds(run(buildB(20, 0, {dy: 30}))), [KIND.LIFT_BREAK], '[رفع] gap=20: انحراف 3.0 مم بالضبط (= الأرضية): هبوط مقبول (لا «أكبر من»)');
    eq(run(buildB(20, 0, {dy: 30.5})).detector.counts.liftsLandedFar, 1, '[رفع] gap=20: انحراف 3.05 مم: بعيد');
  }
  // العودة: حدّ المسافة 2 مم بالمساواة، وأنّ العيّنات الثلاث شرط مستقلّ عن المسافة
  {
    const a = A();
    const l = lastA(a);
    const landed = (dxs) => {
      const bx = l.x + 70;
      return run([stroke(0, a), stroke(1, dxs.map((dx, i) => ({x: bx + dx, y: 500, t: l.t + 70 + i * INTERVAL})), {pointerId: 0})]);
    };
    eq(kinds(landed([0, 5, 10, 20])), [KIND.LIFT_BREAK], '[عودة] المسافة 2.0 مم بالضبط عند العيّنة الثالثة (= الحدّ): عودة (≥)');
    const r19 = landed([0, 5, 10, 19]);
    eq([kinds(r19), r19.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] المسافة 1.9 مم: بلا عودة');
    const r3 = landed([0, 30, 60]);
    eq([kinds(r3), r3.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] ثلاث نقاط فقط (عيّنتان بعد الهبوط) ولو بلغت المسافة 6 مم: بلا عودة — ثلاث عيّنات شرط مستقلّ');
    eq(kinds(landed([0, 30, 60, 90])), [KIND.LIFT_BREAK], '[عودة] أربع نقاط (ثلاث عيّنات بعد الهبوط): عودة');
    // الحدّ 45° بالمساواة (خطّ مائل بميل 1:1 بالضبط): «لا يبعد أكثر من 45°» ⟵ مقبول؛ وميل 30:30.1 (45.1°) مرفوض
    const slanted = (dy3) => {
      const bx = l.x + 70;
      const dys = [0, dy3 / 3, (2 * dy3) / 3, dy3];
      return run([stroke(0, a), stroke(1, [0, 10, 20, 30].map((dx, i) => ({x: bx + dx, y: 500 + dys[i], t: l.t + 70 + i * INTERVAL})), {pointerId: 0})]);
    };
    eq(kinds(slanted(30)), [KIND.LIFT_BREAK], '[عودة] ميل 45° بالضبط: عودة (حدّ لا فوقه)');
    const r451 = slanted(30.3);
    eq([kinds(r451), r451.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] ميل ≈ 45.3°: بلا عودة');
  }
  // dtMs[0] لا يدخل الزمن المطلق: الزمن الأوّل = downAtMs (القسم ف-03 [م]: dtMs[0] = 0 ومرجعه downAtMs)
  {
    const a = A();
    const l = lastA(a);
    const sA = stroke(0, a);
    sA.dtMs[0] = 30;
    const bPts = [0, 1, 2, 3, 4].map((i) => ({x: l.x + 60 + i * 8, y: 500, t: l.t + 60 + i * INTERVAL}));
    const r = run([sA, stroke(1, bPts, {pointerId: 0})]);
    eq([kinds(r), r.detector.suspects[0].gapMs, r.detector.suspects[0].strong], [[KIND.LIFT_BREAK], 60, false], '[رفع] dtMs[0]=30 في A لا يُزاح به الزمن: الفاصل 60 (لا 30) فليس «قويّاً»');
  }
  // العودة: اتّجاه ضمن 45° من اتّجاه ما قبل، وثلاث عيّنات و2 مم
  {
    eq(kinds(run(buildB(70, 0, {dir: [Math.cos((44 * Math.PI) / 180), Math.sin((44 * Math.PI) / 180)]}))), [KIND.LIFT_BREAK], '[عودة] اتّجاه يبعد 44°: عودة');
    const r46 = run(buildB(70, 0, {dir: [Math.cos((46 * Math.PI) / 180), Math.sin((46 * Math.PI) / 180)]}));
    eq([kinds(r46), r46.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] اتّجاه يبعد 46°: انقطاع بلا عودة — يُعدّ ولا يكون موضعاً');
    const back = run(buildB(70, 0, {dir: [-1, 0]}));
    eq([kinds(back), back.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] اتّجاه معاكس 180°: بلا عودة');
    // قصير: عيّنتان فقط بعد الهبوط ⇒ لا تُدرَك ثلاث عيّنات
    const short = run(buildB(70, 0, {count: 3}));
    eq([kinds(short), short.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] مسار ينتهي بعد عيّنتين: بلا عودة (3 عيّنات مطلوبة)');
    // مسافة قصيرة: 3 عيّنات لكن أقلّ من 2 مم (خطوة 2 بكسل ×3 = 6 بكسل = 0.6 مم) بل ويستمرّ لكن لا يبلغ 2 مم
    const a = A();
    const l = lastA(a);
    const t0 = l.t + 70;
    const tiny = [];
    for (let i = 0; i < 12; i++) tiny.push({x: l.x + 70 + i * 1, y: 500, t: t0 + i * INTERVAL});
    const rTiny = run([stroke(0, a), stroke(1, tiny, {pointerId: 0})]);
    eq([kinds(rTiny), rTiny.detector.counts.breaksWithoutReturn], [[], 1], '[عودة] بعد الهبوط 11 بكسل (1.1 مم < 2 مم): بلا عودة');
  }
  // الإصبع المتحرّك قبل الرفع، ونوع النهاية
  {
    const a = line(100, 500, 100 + 2 * 20, 500, 2, 0); // 2 بكسل كل 8 مث = 25 مم/ث… نريد أقلّ: 1 بكسل = 12.5 مم/ث
    const slowA = line(100, 500, 100 + 30, 500, 1, 0);
    const lA = slowA[slowA.length - 1];
    const slowB = [0, 1, 2, 3, 4, 5].map((i) => ({x: lA.x + 1 + i * 8, y: 500, t: lA.t + 70 + i * INTERVAL}));
    const r = run([stroke(0, slowA), stroke(1, slowB, {pointerId: 0})]);
    eq([kinds(r), r.detector.counts.liftsNotMoving], [[], 1], '[رفع] الإصبع قبل الرفع بطيء (12.5 مم/ث < V_MIN): لا يُقيَّم الانقطاع');
    ok(a.length > 0, 'ضابط البناء');
    for (const endA of ['cancel', 'cancel_flagged']) {
      const rc = run(buildB(70, 0, {endA}));
      eq([kinds(rc), rc.detector.counts.liftsConsidered, rc.detector.excludedStrokes.items.map((e) => [e.strokeIndex, e.reasons])], [[], 0, [[0, [EX.CANCELLED]]]], `[استبعاد] A ينتهي ${endA}: مستبعَد من الكشف (يبقى في الخامّ) ولا يُعدّ رفعاً`);
    }
    const ro = run(buildB(70, 0, {endA: 'open_at_end'}));
    eq([kinds(ro), ro.detector.counts.liftsConsidered], [[], 0], '[رفع] open_at_end ليس رفعاً (الإصبع هابط عند النهاية): لا يُقيَّم');
  }
}

// ─── (٥) الحافّة: edge_exit والرفع في الهامش ─────────────────────────────────────────────────────
// الهامش 5 مم = 50 بكسل؛ السطح 1000 عرضاً.
{
  // قفزة قرب الحافّة اليمنى والإصبع متّجه إليها: edge_exit لا مشتبه
  const jumpAt = (xEnd) => {
    const a = line(xEnd - 8 * 20, 500, xEnd, 500, 8, 0);
    const l = a[a.length - 1];
    const b = [{x: l.x + 60, y: 500, t: l.t + 60}];
    for (let i = 1; i <= 12; i++) b.push({x: b[0].x + 8 * i, y: 500, t: b[0].t + i * INTERVAL});
    return run([stroke(0, concat(a, b))]);
  };
  const nearEdge = jumpAt(960); // 40 بكسل = 4 مم من الحافّة اليمنى (< 5)
  eq([kinds(nearEdge), nearEdge.detector.edgeExits.map((e) => [e.kind, e.source, e.jumpKind, e.side])], [[], [[KIND.EDGE_EXIT, N.TOUCH_PATH_EDGE_EXIT_SOURCE.JUMP, KIND.GAP_JUMP, N.TOUCH_PATH_EDGE_SIDE.RIGHT]]],
      '[حافّة] قفزة على بُعد 4 مم من الحافّة والإصبع متّجه إليها: edge_exit ولا مشتبه');
  const farEdge = jumpAt(900); // 100 بكسل = 10 مم
  eq([kinds(farEdge), farEdge.detector.edgeExits.length], [[KIND.GAP_JUMP], 0], '[حافّة] القفزة على بُعد 10 مم: مشتبه لا edge_exit');
  const atMargin = jumpAt(951); // 49 بكسل = 4.9 مم < 5
  eq(atMargin.detector.edgeExits.length, 1, '[حافّة] 4.9 مم (< 5): edge_exit');
  const exactMargin = jumpAt(950); // 50 بكسل = 5.0 مم بالضبط (= الهامش لا دونه)
  eq([exactMargin.detector.edgeExits.length, kinds(exactMargin)], [0, [KIND.GAP_JUMP]], '[حافّة] 5.0 مم بالضبط (= الهامش): ليس «أقلّ من» ⟵ مشتبه لا edge_exit');
  const pastMargin = jumpAt(949); // 51 بكسل = 5.1 مم
  eq([pastMargin.detector.edgeExits.length, kinds(pastMargin)], [0, [KIND.GAP_JUMP]], '[حافّة] 5.1 مم (> 5): مشتبه');
  // قفزة قرب الحافّة اليسرى والإصبع يتّجه إلى الداخل (يميناً): ليست edge_exit
  {
    const a = line(30, 500, 30 + 8 * 20, 500, 8, 0);
    const l = a[a.length - 1];
    const b = [{x: l.x + 60, y: 500, t: l.t + 60}];
    for (let i = 1; i <= 12; i++) b.push({x: b[0].x + 8 * i, y: 500, t: b[0].t + i * INTERVAL});
    const r = run([stroke(0, concat(a, b))]);
    eq([kinds(r), r.detector.edgeExits.length], [[KIND.GAP_JUMP], 0], '[حافّة] القفزة بعيدة عن الحافّة (الموضع قبلها x=190): لا edge_exit');
  }
  // رفع قرب الحافّة اليمنى والإصبع متّجه إليها ثم هبوط بعد 70 مث: edge_exit؛ وإن لم يتّجه إليها (متّجه يساراً) فرفع في الهامش يُستبعد ويُعدّ
  const lift = (xEnd, dirSign) => {
    const a = dirSign > 0 ? line(xEnd - 8 * 30, 500, xEnd, 500, 8, 0) : line(xEnd + 8 * 30, 500, xEnd, 500, 8, 0);
    const l = a[a.length - 1];
    const bx = l.x + dirSign * 70;
    const b = [];
    for (let i = 0; i < 15; i++) b.push({x: bx + dirSign * 8 * i, y: 500, t: l.t + 70 + i * INTERVAL});
    return run([stroke(0, a), stroke(1, b, {pointerId: 0})]);
  };
  const liftToEdge = lift(960, +1);
  eq([kinds(liftToEdge), liftToEdge.detector.edgeExits.map((e) => [e.source, e.side])], [[], [[N.TOUCH_PATH_EDGE_EXIT_SOURCE.LIFT, N.TOUCH_PATH_EDGE_SIDE.RIGHT]]], '[حافّة] رفع قرب الحافّة ومتّجه إليها: edge_exit');
  const liftAlongMargin = lift(960, -1); // موضع 960 والإصبع يتّجه يساراً (بعيداً عن الحافّة اليمنى)
  eq([kinds(liftAlongMargin), liftAlongMargin.detector.edgeExits.length, liftAlongMargin.detector.counts.edgeMarginLifts], [[], 0, 1], '[حافّة] رفع في الهامش والإصبع يبتعد عنها: يُستبعد ويُعدّ (design §3.3)');
}

// ─── (٤) الاستبعاد من الكشف: راحة اليد والإصبع الثاني ─────────────────────────────────────────────
{
  const pts = line(100, 500, 100 + 8 * 20, 500, 8, 0);
  // touchMajor: > 15 مم يُستبعد؛ = 15 مم لا
  const tm = (px) => pts.map(() => px);
  const palm = run([stroke(0, pts, {touchMajorPx: tm(151)})]);
  eq([palm.detector.excludedStrokes.items, palm.detector.state], [[{strokeIndex: 0, reasons: [EX.PALM_TOUCH_MAJOR]}], ST.UNDETERMINED_NO_USABLE_STROKES], '[راحة] touchMajor 15.1 مم (> 15): مستبعَد، ولا خطّ صالح للكشف');
  const finger = run([stroke(0, pts, {touchMajorPx: tm(150)})]);
  eq([finger.detector.excludedStrokes.total, finger.detector.state], [0, ST.RAN], '[راحة] touchMajor 15.0 مم (= الحدّ لا فوقه): لا استبعاد');
  const oneBig = run([stroke(0, pts, {touchMajorPx: pts.map((_, i) => (i === 7 ? 200 : 50))})]);
  eq(oneBig.detector.excludedStrokes.items[0].reasons, [EX.PALM_TOUCH_MAJOR], '[راحة] عيّنة واحدة كبيرة تكفي لاستبعاد الخطّ');
  // إصبع ثانٍ متزامن: فترتان تتداخلان
  const second = line(500, 900, 500 + 8 * 20, 900, 8, 40);
  const conc = run([stroke(0, pts), stroke(1, second, {pointerId: 1})]);
  eq(conc.detector.excludedStrokes.items.map((e) => [e.strokeIndex, e.reasons]), [[0, [EX.CONCURRENT_POINTER]], [1, [EX.CONCURRENT_POINTER]]], '[إصبع ثانٍ] التداخل الزمني يستبعد الخطّين معاً');
  // تماسّ بلا تداخل: B يبدأ في المللي ثانية التي ينتهي فيها A ⇒ ليس تزامناً
  const lastT = pts[pts.length - 1].t;
  const touching = run([stroke(0, pts), stroke(1, line(700, 900, 700 + 8 * 20, 900, 8, lastT), {pointerId: 1})]);
  eq(touching.detector.excludedStrokes.total, 0, '[إصبع ثانٍ] الرفع والهبوط في المللي ثانية نفسه ليسا تزامناً');
  // end غير معروف
  const unk = run([stroke(0, pts, {end: 'UNRECOGNIZED', endRecognized: false})]);
  eq(unk.detector.excludedStrokes.items[0].reasons, [EX.UNRECOGNIZED_END], '[استبعاد] end غير معروف: لا يُعرف أرُفع أم أُلغي ⇒ مستبعَد معلَن');
  // خطّ غير قابل للقراءة: يُعدّ ولا يُلمَس
  const bad = run([{index: 0, usable: false}, stroke(1, pts)]);
  eq([bad.detector.unusableStrokeIndexes.items, bad.detector.strokesEvaluated], [[0], 1], '[استبعاد] خطّ مصفوفاته غير صالحة: مُعدَّد في unusableStrokeIndexes ولا يدخل الكشف');
}

// ─── حالة الكاشف: لماذا لم يقع كشف ────────────────────────────────────────────────────────────────
{
  const pts = line(100, 500, 100 + 8 * 20, 500, 8, 0);
  eq(run([stroke(0, pts)], {geometry: {pxPerMm: null}}).detector.state, ST.UNDETERMINED_NO_PX_PER_MM, '[حالة] pxPerMm غائب: لا مواضع بالملّيمتر (UNDETERMINED) لا «لا مواضع»');
  eq(run([stroke(0, pts)], {geometry: {pxPerMm: 0}}).detector.state, ST.UNDETERMINED_NO_PX_PER_MM, '[حالة] pxPerMm = 0: غير صالح');
  eq(run([stroke(0, pts)], {geometry: {surfaceWidthPx: null}}).detector.state, ST.UNDETERMINED_NO_SURFACE, '[حالة] أبعاد السطح غائبة: لا حافّة');
  eq(run([]).detector.state, ST.UNDETERMINED_NO_USABLE_STROKES, '[حالة] لا خطوط');
  const noDens = run([stroke(0, pts)], {geometry: {pxPerMm: null}});
  eq([noDens.sampling.medianIntervalMs, noDens.cells.state], [8, CC.UNDETERMINED_DETECTOR_NOT_RUN], '[حالة] معدّل العيّنات يُحسب بلا كثافة؛ وفحص الخلايا لا حكم له لأن قاعدة القفز لم تُطبَّق');
}

// ─── معدّل العيّنات وأقرب بُعد من الحافّة ─────────────────────────────────────────────────────────
{
  // 20 فاصلاً: تسعة عشر 8 وواحد 40
  const t = [0];
  for (let i = 0; i < 19; i++) t.push(t[t.length - 1] + 8);
  t.push(t[t.length - 1] + 40);
  const pts = t.map((tt, i) => ({x: 100 + i * 8, y: 500, t: tt}));
  const r = run([stroke(0, pts)]);
  eq(r.sampling, {pointsTotal: 21, intervalCount: 20, zeroIntervals: 0, medianIntervalMs: 8, p95IntervalMs: 8, medianRateHz: 125},
      '[معدّل] 21 نقطة و20 فاصلاً (19×8 و1×40): الوسيط 8 والمئين 95 بالرتبة الأقرب = 8 والمعدّل 1000/8 = 125Hz');
  const zero = run([stroke(0, [{x: 0, y: 0, t: 0}, {x: 1, y: 0, t: 0}, {x: 2, y: 0, t: 0}])]);
  eq([zero.sampling.zeroIntervals, zero.sampling.medianIntervalMs, zero.sampling.medianRateHz], [2, 0, null], '[معدّل] فواصل صفر (أحداث مجمَّعة): الوسيط 0 والمعدّل غير معرَّف (null لا ∞)');
  const e = run([stroke(0, [{x: 30, y: 700, t: 0}, {x: 960, y: 1500, t: 8}, {x: 500, y: 40, t: 16}])]);
  eq(e.edges.nearestPx, {left: 30, right: 40, top: 40, bottom: 500}, '[حافّة] أقرب بُعد بالبكسل: يسار 30 · يمين 1000−960 · أعلى 40 · أسفل 2000−1500');
  eq(e.edges.nearestMm, {left: 3, right: 4, top: 4, bottom: 50}, '[حافّة] وبالملّيمتر (÷ pxPerMm=10)');
  eq(run([stroke(0, pts)], {geometry: {pxPerMm: null}}).edges.nearestMm, null, '[حافّة] بلا كثافة: بالبكسل فقط، والملّيمتر null');
  eq(run([stroke(0, pts)], {geometry: {surfaceWidthPx: null}}).edges, {state: N.TOUCH_PATH_EDGES_STATE.NO_SURFACE}, '[حافّة] بلا سطح: حالة صريحة');
}

// ─── (٦) تغطية الخلايا ────────────────────────────────────────────────────────────────────────────
// التحقّق من traverse (عبور Amanatides–Woo) بمرجع مستقلّ: أخذ عيّنات كثيف على القطعة. المرجع ⊆ AW دائماً؛ وما يزيده AW عن المرجع خلية تلامس الخطّ بمسافة < 0.02 بكسل (تماسّ زاوية).
{
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const cw = 90;
  const ch = 87.6923076923077;
  const cols = 12;
  const rows = 26;
  const W = cw * cols;
  const H = ch * rows;
  let worst = 0;
  let extra = 0;
  for (let t = 0; t < 400; t++) {
    const x0 = rnd() * W;
    const y0 = rnd() * H;
    const ang = rnd() * 2 * Math.PI;
    const len = rnd() * 400;
    const x1 = Math.min(W - 0.001, Math.max(0, x0 + Math.cos(ang) * len));
    const y1 = Math.min(H - 0.001, Math.max(0, y0 + Math.sin(ang) * len));
    const aw = new Set();
    traverse(x0, y0, x1, y1, cw, ch, cols, rows, (c, r) => aw.add(r * cols + c));
    const dense = new Set();
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.01));
    for (let k = 0; k <= steps; k++) {
      const px = x0 + ((x1 - x0) * k) / steps;
      const py = y0 + ((y1 - y0) * k) / steps;
      dense.add(Math.min(rows - 1, Math.floor(py / ch)) * cols + Math.min(cols - 1, Math.floor(px / cw)));
    }
    for (const c of dense) if (!aw.has(c)) worst++;
    for (const c of aw) {
      if (dense.has(c)) continue;
      extra++;
      // المسافة من القطعة إلى مستطيل الخلية
      const cc = c % cols;
      const rr = Math.floor(c / cols);
      let best = Infinity;
      for (let k = 0; k <= steps; k++) {
        const px = x0 + ((x1 - x0) * k) / steps;
        const py = y0 + ((y1 - y0) * k) / steps;
        const dx = Math.max(cc * cw - px, 0, px - (cc + 1) * cw);
        const dy = Math.max(rr * ch - py, 0, py - (rr + 1) * ch);
        best = Math.min(best, Math.hypot(dx, dy));
      }
      assert.ok(best < 0.02, `traverse زاد خلية ${c} تبعد ${best} بكسل عن القطعة`);
    }
  }
  n++;
  eq(worst, 0, '[خلايا] 400 قطعة عشوائية (بذرة ثابتة): كل خلية يمرّ بها المرجع الكثيف يزورها العبور الشبكي (لا خلية ضائعة)');
  ok(extra <= 8, `[خلايا] وما يزيده العبور عن المرجع الكثيف نادر وهو تماسّ زاوية (${extra} خلية في 400 قطعة)`);
  // قطع بأعيانها
  const visit = (x0, y0, x1, y1) => {
    const out = [];
    traverse(x0, y0, x1, y1, 100, 100, 10, 20, (c, r) => out.push(`${c},${r}`));
    return out;
  };
  eq(visit(50, 50, 50, 50), ['0,0'], '[عبور] نقطة: خليّتها');
  eq(visit(50, 50, 350, 50), ['0,0', '1,0', '2,0', '3,0'], '[عبور] أفقي: الخلايا الأربع بالترتيب');
  eq(visit(350, 50, 50, 50), ['3,0', '2,0', '1,0', '0,0'], '[عبور] أفقي معاكس');
  eq(visit(50, 50, 50, 250), ['0,0', '0,1', '0,2'], '[عبور] عمودي');
  eq(visit(50, 50, 250, 150), ['0,0', '1,0', '1,1', '2,1'], '[عبور] مائل: يمرّ بخلايا الزاوية القاطعة');
  eq(visit(50, 50, 150, 150), ['0,0', '1,1'], '[عبور] عبور بالزاوية تماماً: الخلية القطرية (التماسّ بنقطة لا يملأ الجارتين)');
  eq(visit(-30, -30, 50, 50), ['0,0'], '[عبور] خارج الحدّ الأدنى: يُقصّ إلى الشبكة');
  eq(visit(1000, 2000, 950, 1950), ['9,19'], '[عبور] على الحدّ الأقصى تماماً (x=W): يُقصّ إلى آخر خلية لا خارجها');
}
{
  // مسح كامل لشبكة 10×20: صفّ لكل خلية، من مراكز الأعمدة
  const full = [];
  for (let r = 0; r < 20; r++) {
    const y = r * 100 + 50;
    const a = line(r % 2 === 0 ? 50 : 950, y, r % 2 === 0 ? 950 : 50, y, 8, 0);
    full.push(a);
  }
  const strokes = full.map((pts, i) => stroke(i, pts.map((p) => ({...p, t: p.t + i * 1000})), {pointerId: 0}));
  const covered = run(strokes, {reportedCells: {notRequired: [], cutout: [], untouched: [], touchedCount: 200}});
  eq([covered.cells.state, covered.cells.pathTouchedCount, covered.cells.pathUntouchedCount, covered.cells.mandatoryCells], [CC.MATCH, 200, 0, 200], '[خلايا] مسح كامل: 200 خلية، والتطبيق يقول 200 وغير الممسوحة [] ⇒ MATCH');
  // التطبيق يقول 199 وخلية 55 غير ممسوحة، والمسار يقول ملموسة ⇒ DISAGREE بالجهتين معدودتين
  const dis = run(strokes, {reportedCells: {notRequired: [], cutout: [], untouched: [55], touchedCount: 199}});
  eq([dis.cells.state, dis.cells.touchedByPathNotByApp.items, dis.cells.touchedByAppNotByPath.total, dis.cells.reportedTouchedCount], [CC.DISAGREE, [55], 0, 199], '[خلايا] المسار يلمس الخلية 55 والتطبيق يقول لا: DISAGREE، والخلية مسمّاة');
  // العكس: التطبيق يقول كلّها ملموسة والمسار لا يلمس صفّاً
  const missing = strokes.filter((s) => s.index !== 7);
  const dis2 = run(missing, {reportedCells: {notRequired: [], cutout: [], untouched: [], touchedCount: 200}});
  eq([dis2.cells.state, dis2.cells.touchedByAppNotByPath.total, dis2.cells.touchedByAppNotByPath.items.slice(0, 3), dis2.cells.pathTouchedCount], [CC.DISAGREE, 10, [70, 71, 72], 190],
      '[خلايا] المسار لا يلمس الصفّ 7 (10 خلايا) والتطبيق يقول كلّها: DISAGREE بخلايا الصفّ مسمّاة');
  // العدد وحده يختلف والقوائم متّفقة
  const cnt = run(strokes, {reportedCells: {notRequired: [], cutout: [], untouched: [], touchedCount: 199}});
  eq(cnt.cells.state, CC.DISAGREE, '[خلايا] القائمتان متّفقتان والعدد 199 ≠ 200: DISAGREE');
  // خلايا مقصاة لا تدخل المقام ولا الممسوح الإلزامي
  const cut = run(strokes, {reportedCells: {notRequired: [], cutout: [0, 1], untouched: [], touchedCount: 198}});
  eq([cut.cells.state, cut.cells.mandatoryCells, cut.cells.pathTouchedCount], [CC.MATCH, 198, 198], '[خلايا] خليّتان مقصاتان: المقام 198 والممسوح الإلزامي 198 ⇒ MATCH');
  // حالات اللاحكم
  eq(run(strokes, {geometry: {cellWidthPx: null}, reportedCells: NO_CELLS}).cells.state, CC.UNDETERMINED_NO_CELL_GEOMETRY, '[خلايا] أبعاد الخليّة غائبة: لا حكم');
  eq(run(strokes, {geometry: {gridCols: 0}, reportedCells: NO_CELLS}).cells.state, CC.UNDETERMINED_NO_CELL_GEOMETRY, '[خلايا] gridCols = 0: غير صالح');
  eq(run(strokes, {reportedCells: {notRequired: [], cutout: [], untouched: null, touchedCount: 200}}).cells.state, CC.UNDETERMINED_NO_REPORTED_CELLS, '[خلايا] untouchedCells غائبة: لا مقارنة');
  eq(run(strokes, {reportedCells: {notRequired: [], cutout: [], untouched: [], touchedCount: null}}).cells.state, CC.UNDETERMINED_NO_REPORTED_CELLS, '[خلايا] touchedCells غائب: لا مقارنة');
  eq(run([], {reportedCells: NO_CELLS}).cells.state, CC.UNDETERMINED_NO_STROKES, '[خلايا] لا خطوط');
  // ═ «إطار + X» (2026-10-21): المطلوب = الشبكة − cutoutCells − notRequiredCells كما شحنها التطبيق ═
  // المسح الكامل يلمس الـ200 خلية؛ المطلوبة منها بعد استثناء 20 خلية غير مطلوبة (الصفّ 9 كلّه والصفّ 10 كلّه: 20) = 180
  const notReq = [];
  for (let c = 0; c < 10; c++) notReq.push(90 + c, 100 + c);
  const frameX = run(strokes, {reportedCells: {cutout: [], notRequired: notReq, untouched: [], touchedCount: 180}});
  eq([frameX.cells.state, frameX.cells.mandatoryCells, frameX.cells.pathTouchedCount, frameX.cells.pathUntouchedCount, frameX.cells.notRequiredCells, frameX.cells.pathTouchedNotRequiredCount], [CC.MATCH, 180, 180, 0, 20, 20],
      '[خلايا][إطار+X] مسح كامل: المطلوبة 180 والمسار يلمسها كلّها (180) ويلمس 20 غير مطلوبة تُعدّ بجانبها ولا تدخل touchedCells ⇒ MATCH');
  // التطبيق يعدّ لمسة الخلايا غير المطلوبة (200) فيخالف العلاقة 3 ⇒ DISAGREE بالعدد وحده
  const countedNotRequired = run(strokes, {reportedCells: {cutout: [], notRequired: notReq, untouched: [], touchedCount: 200}});
  eq([countedNotRequired.cells.state, countedNotRequired.cells.reportedTouchedCount, countedNotRequired.cells.pathTouchedCount], [CC.DISAGREE, 200, 180], '[خلايا][إطار+X] touchedCells=200 (يعدّ غير المطلوبة) والمسار 180 مطلوبة ⟵ DISAGREE');
  // خلية مطلوبة لم يلمسها المسار (الصفّ 7 محذوف) والتطبيق يقول لُمست
  const reqMissing = run(missing, {reportedCells: {cutout: [], notRequired: notReq, untouched: [], touchedCount: 180}});
  eq([reqMissing.cells.state, reqMissing.cells.touchedByAppNotByPath.total, reqMissing.cells.pathTouchedCount], [CC.DISAGREE, 10, 170], '[خلايا][إطار+X] الصفّ 7 (مطلوب) لم يُلمَس بالمسار والتطبيق يقول لُمس: DISAGREE');
  // خلية غير مطلوبة لم يلمسها المسار **لا تُعدّ** غير ممسوحة ولا يقول عنها التطبيق شيئاً: الصفّ 9 محذوف من المسار ⟵ MATCH
  const notReqMissing = run(strokes.filter((s) => s.index !== 9), {reportedCells: {cutout: [], notRequired: notReq, untouched: [], touchedCount: 180 - 10}});
  eq([notReqMissing.cells.state, notReqMissing.cells.pathTouchedCount, notReqMissing.cells.pathTouchedNotRequiredCount], [CC.DISAGREE, 180, 10],
      '[خلايا][إطار+X] ضابط: الصفّ 9 كلّه غير مطلوب (90..99) — حذفه من المسار لا يغيّر المطلوبة (180)، فتصريح التطبيق بـ170 يخالف ⟵ DISAGREE');
  const notReqMissingOk = run(strokes.filter((s) => s.index !== 9), {reportedCells: {cutout: [], notRequired: notReq, untouched: [], touchedCount: 180}});
  eq([notReqMissingOk.cells.state, notReqMissingOk.cells.pathTouchedNotRequiredCount], [CC.MATCH, 10], '[خلايا][إطار+X] غياب لمس الخلايا غير المطلوبة لا يؤثّر في الحكم: المطلوبة 180 ⟵ MATCH');
  // مقصاة وغير مطلوبة معاً: كلتاهما خارج المطلوب
  const both = run(strokes, {reportedCells: {cutout: [0, 1], notRequired: notReq, untouched: [], touchedCount: 178}});
  eq([both.cells.state, both.cells.mandatoryCells, both.cells.notRequiredCells], [CC.MATCH, 178, 20], '[خلايا][إطار+X] خليّتان مقصاتان و20 غير مطلوبة: المطلوبة 178 ⟵ MATCH');
  // لا استيفاء افتراضي: notRequired غائب (null) أو undefined ⟵ لا مجموعة مطلوبة ولا حكم (لا [] تسدّ الغياب)
  for (const [label, nr] of [['null', null], ['undefined', undefined]]) {
    const r = run(strokes, {reportedCells: {cutout: [], notRequired: nr, untouched: [], touchedCount: 200}});
    eq(r.cells.state, CC.UNDETERMINED_REQUIRED_SET_UNKNOWN, `[خلايا][إطار+X] notRequired=${label}: UNDETERMINED_REQUIRED_SET_UNKNOWN (لا حكم ولا قائمة افتراضية)`);
    eq('mandatoryCells' in r.cells || 'pathTouchedCount' in r.cells, false, `[خلايا][إطار+X] notRequired=${label}: لا أعداد خلايا تُعرض بلا مجموعة مطلوبة`);
  }
  eq(run(strokes, {reportedCells: {cutout: [], notRequired: 'x', untouched: [], touchedCount: 200}}).cells.state, CC.UNDETERMINED_REQUIRED_SET_UNKNOWN, '[خلايا][إطار+X] notRequired ليست قائمة: لا حكم');
  // لا استيفاء عبر قفزة: A تقفز فوق الخلايا 2 و3 في الصفّ 0، فهي غير ممسوحة بالمسار
  {
    const a = line(50, 50, 50 + 8 * 20, 50, 8, 0); // حتى x=210 (الخلية 2)
    const l = a[a.length - 1];
    const b = [{x: 550, y: 50, t: l.t + 60}];
    for (let i = 1; i <= 12; i++) b.push({x: 550 + 8 * i, y: 50, t: b[0].t + i * INTERVAL});
    const s = [stroke(0, concat(a, b))];
    const r = run(s, {reportedCells: {notRequired: [], cutout: [], untouched: [], touchedCount: 0}});
    eq(kinds(r), [KIND.GAP_JUMP], '[خلايا] القفزة كُشفت (شرط الاختبار)');
    const touchedRow0 = r.cells.pathTouchedCount;
    // الخلايا الممسوحة: 0..2 قبل القفز، و5..6 بعده (x من 550 إلى 646) ⇒ 5 خلايا، بلا 3 و4 (لم تُملأ عبر القفزة)
    eq(touchedRow0, 5, '[خلايا] لا استيفاء عبر القفزة: خمس خلايا (0..2 و5..6) لا سبع؛ الخليّتان 3 و4 تبقيان غير ممسوحتين');
    eq(r.cells.pathUntouched.items.slice(0, 2), [3, 4], '[خلايا] وهما 3 و4');
  }
}

// ─── علامات العرض مقابل ما كشفه الخادم ────────────────────────────────────────────────────────────
{
  const a = line(100, 500, 100 + 8 * 20, 500, 8, 0);
  const l = a[a.length - 1];
  const b = [{x: l.x + 100, y: 500, t: l.t + 60}];
  for (let i = 1; i <= 12; i++) b.push({x: b[0].x + 8 * i, y: 500, t: b[0].t + i * INTERVAL});
  const s = [stroke(0, concat(a, b))];
  const from = a.length - 1;
  const DS = N.TOUCH_PATH_DISPLAYED_STATE;
  eq(run(s).displayedVsDetected, {state: DS.NOT_DISPLAYED}, '[عرض] displayed = null (لم تُعرض علامات): حالة صريحة');
  const none = run(s, {displayed: []});
  eq([none.displayedVsDetected.state, none.displayedVsDetected.displayedCount, none.displayedVsDetected.detectedNotDisplayedCount], [DS.DISPLAYED_NONE, 0, 1], '[عرض] عُرضت ولم تُرَ مواضع، والخادم كشف واحداً لم يُعرض');
  const agree = run(s, {displayed: [{kind: 'gap_jump', strokeIndex: 0, fromPointIndex: from, toPointIndex: from + 1}]});
  eq([agree.displayedVsDetected.matchedCount, agree.displayedVsDetected.kindAgreeCount, agree.displayedVsDetected.detectedNotDisplayedCount], [1, 1, 0], '[عرض] علامة تطابق الكشف بالفهارس والنوع');
  const kindDiff = run(s, {displayed: [{kind: 'coord_jump', strokeIndex: 0, fromPointIndex: from, toPointIndex: from + 1}]});
  eq([kindDiff.displayedVsDetected.matchedCount, kindDiff.displayedVsDetected.kindAgreeCount], [1, 0], '[عرض] علامة بالفهارس نفسها ونوع مختلف: تطابق موضع بلا اتّفاق نوع');
  const phantom = run(s, {displayed: [{kind: 'gap_jump', strokeIndex: 0, fromPointIndex: 3, toPointIndex: 4}]});
  eq([phantom.displayedVsDetected.matchedCount, phantom.displayedVsDetected.displayedNotDetected.items.length, phantom.displayedVsDetected.detectedNotDisplayedCount], [0, 1, 1], '[عرض] علامة لا يؤيّدها الخادم تُسرد، وما كشفه الخادم ولم يُعرض يُعدّ');
}

// ─── لا مساس بالمُدخل، وقائمة الإخراج بسقفها ──────────────────────────────────────────────────────
{
  const pts = line(100, 500, 100 + 8 * 20, 500, 8, 0);
  const strokes = [stroke(0, pts)];
  const before = JSON.stringify(strokes);
  run(strokes, {displayed: []});
  eq(JSON.stringify(strokes), before, '[نقاء] analyzeTouchPath لا تعدّل مُدخلها');
  // أكثر من السقف من الخطوط المستبعدة: تُعدّ كلّها وتُسرد منها 64 وتُعلَن مبتورة
  const many = [];
  for (let i = 0; i < 70; i++) many.push(stroke(i, line(100, 100 + i * 20, 100 + 8 * 6, 100 + i * 20, 8, i * 5000), {end: 'cancel'}));
  const r = run(many);
  eq([r.detector.excludedStrokes.total, r.detector.excludedStrokes.items.length, r.detector.excludedStrokes.truncated, N.TOUCH_PATH_OUTPUT_LIST_CAP], [70, 64, true, 64], '[سقف] 70 خطّاً مستبعَداً: العدّ كامل والسرد 64 ومبتور بإعلان لا صامتاً');
}

console.log(`\ntouchPath.test.js: ${n}/${n} assertions passed`);
