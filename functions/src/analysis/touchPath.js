'use strict';

// ===================================================================
// touchPath.js — أحكام الخادم على خامّ مسار اللمس لـM-02 (fv71، الخيار «ب»)
// (S-M02، 2026-10-18 +03)
// ===================================================================
//
// القرار (المستخدم، منقول في القسم §٧-ي بند ١): «(b) Raw touch path; server detects (Recommended)» — التطبيق يُرسل **الخامّ بلا فقد** (strokes[])
// والخادم يحسب منه: معدّل العيّنات، والمواضع المشتبهة بعتبات تُعاير بعد يوم التجربة، وتغطية الخلايا مقارنةً بما شحنه التطبيق، وأقرب بُعد للإصبع من كل حافّة.
// **غير القابل للعكس يُطبَّق هنا عند القراءة لا في التخزين** (القاعدة 20): الخامّ في reportRaw/{scanId} كما شُحن (لا يقرؤه العميل)، وما يخرج من هنا أحكامٌ
// وإحصاءات بلا إحداثيات خامّ ولا مصفوفات.
//
// المصدر: docs/FV71_CONTRACT_SECTION.md (ف-03) وتصميم M-02 (design-m02-touch-grid-2026-10-13.md: §3 كشف البقعة الميّتة، §6.6 قارئ الخادم، §2.2 ملء الخلايا).
// **العتبات كلّها في fv68Names.TOUCH_PATH_DETECTOR** (مصدر واحد، القاعدة 24) وهي [اجتهاد] من التصميم غير مُعايرة؛ والمخرَج يحمل `detectorVersion` والعتبات المستعملة.
//
// وحدة نقيّة: لا شبكة ولا Firestore ولا حالة مشتركة. **لا ترمي لمُدخل مشوَّه** (القارئ يتحقّق قبل النداء)؛ وإن رمت فالقارئ يلتقطها ويُعلن ANALYSIS_ERROR (لا يُسقط بقيّة القراءات).
//
// ما لا تفعله: لا تصنّف الجهاز ولا تحكم بحرف أو بوّابة. «الخادم يقرأ ولا يحكم» (fv68Reader.js §٠): المواضع المشتبهة قراءة تُعاد مع النتيجة، ولا تدخل الحرف اليوم.
//
// التزامات التصميم المنفَّذة هنا (المرجع design §3):
//   (١) قفزة بلا رفع: خطوة أكبر من max(J_MIN، 3 × وسيط آخر 8 خطوات في الخطّ نفسه) والإصبع متحرّك (سرعة آخر 3 خطوات ≥ V_MIN) ← gap_jump إن فاق الفاصلُ الزمني
//       max(GAP_MIN_MS، 3 × وسيط الفاصل)، وإلا coord_jump.
//   (٢) انقطاع برفع: خطّ ينتهي بـup ويبدأ خطّ جديد بعد 0..R_MAX مث، والإصبع متحرّك قبل الرفع، وهبوطه قرب ما كان سيبلغه (max(LANDING_MIN_MM، نصف الإزاحة المتوقّعة))
//       ← lift_break (قويّ إن < STRONG_LIFT_GAP_MS).
//   (٣) العودة: بعد الانقطاع يستمرّ المسار RETURN_MIN_SAMPLES عيّنات وRETURN_MIN_MM على الأقلّ باتّجاه ضمن RETURN_MAX_ANGLE_DEG من اتّجاه ما قبله؛ وإلا «انقطاع بلا عودة»: يبقى
//       في الخامّ ويُعدّ ولا يكون موضعاً مشتبهاً.
//   (٤) الاستبعاد من الكشف (يبقى في الخامّ): cancel وcancel_flagged · إصبع ثانٍ متزامن · touchMajor > PALM_TOUCH_MAJOR_MM · end غير معروف.
//   (٥) تجاوز الحافّة: انقطاع على بُعد < EDGE_MARGIN_MM من حافّة السطح والإصبع متّجه إليها ← edge_exit (يُسرد ولا يُعدّ مشتبهاً). رفعٌ ضمن هامش الحافّة لا يتّجه إليها: يُستبعد ويُعدّ.
//   (٦) تغطية الخلايا: عبور شبكي (Amanatides–Woo) لكل قطعة بين عيّنتين متتاليتين من الخطّ نفسه؛ لا استيفاء عبر قطعة موسومة قفزة/فجوة (٢.٢) ولا بين رفع ووضع.
//
// ما قرّرتُه وأعلنه (لا يقوله القسم ولا التصميم صراحةً) — يظهر كلّه في المخرَج `notes`/`conventions` لا مدفوناً:
//   • تعريف «الإصبع متحرّك» لقطعة بلا ثلاث خطوات سابقة: غير مُقيَّمة (MIN_HISTORY_STEPS)، وتُعدّ.
//   • اتّجاه «ما قبل» الانقطاع = متّجه آخر SPEED_WINDOW_STEPS خطوات، والموضع المتوقَّع = آخر نقطة + سرعة تلك الخطوات × الفاصل.
//   • الحافّة = حافّة سطح اللمس بإحداثيّاته المحلّية (surfaceWidthPx × surfaceHeightPx)، لا حافّة الشاشة الفيزيائية.
//   • خلية النقطة = floor(x / cellWidthPx)، floor(y / cellHeightPx) مقصوصة إلى الشبكة («الشبكة تغطّي السطح كلّه»، القسم E21-١) — **اصطلاح غير منصوص عليه في القسم؛ تؤيّده عيّنات المُنتِج الثلاث (NeuralChek@f9e0571): ما حسبه الخادم من الخامّ طابق ما شحنه المُنتِج
//     من touchedCells/untouchedCells/cutoutCells في الثلاث (cells.state = MATCH)**. والإطار: x/y في إطار السطح المحلّي بنصّ القسم («الأطر كما سلّمها النظام»)، فالحافّة حافّة السطح لا الشاشة.

const N = require('./fv68Names');

const D = N.TOUCH_PATH_DETECTOR;
const END = N.TOUCH_PATH_STROKE_END;
const KIND = N.TOUCH_PATH_SUSPECT_KIND;
const EXCL = N.TOUCH_PATH_EXCLUSION;
const ST = N.TOUCH_PATH_DETECTION_STATE;
const CC = N.TOUCH_PATH_CELLS_CHECK;
const SIDE = N.TOUCH_PATH_EDGE_SIDE;
const EXIT_SRC = N.TOUCH_PATH_EDGE_EXIT_SOURCE;
const EDGES = N.TOUCH_PATH_EDGES_STATE;

// سقف ما يُسرد في المخرَج من قوائم (المخرَج يُعاد مع النتيجة ولا يُخزَّن؛ السقف يحفظ الذاكرة): ما فوقه يُعدّ ويُعلَن (`…Truncated`) لا يُسقَط صامتاً.
const LIST_CAP = N.TOUCH_PATH_OUTPUT_LIST_CAP;

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

function median(values) {
  if (values.length === 0) return null;
  const a = values.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// المئين بالرتبة الأقرب (nearest-rank): الرتبة = ceil(p × n)، من 1. اصطلاح مُعلَن (design §6.6 يطلب «المئين 95» ولا يحدّد الطريقة).
function percentileNearestRank(values, p) {
  if (values.length === 0) return null;
  const a = values.slice().sort((x, y) => x - y);
  const rank = Math.max(1, Math.ceil(p * a.length));
  return a[Math.min(a.length, rank) - 1];
}

const capList = (list) => ({items: list.slice(0, LIST_CAP), total: list.length, truncated: list.length > LIST_CAP});

// ─── تحضير الخطوط: الأزمنة المطلقة والخطوات ───────────────────────────────────────────────
// downAtMs منسوب إلى فتح الحوار؛ dtMs[i] = ms منذ العيّنة السابقة من الخطّ نفسه، وdtMs[0] = 0 (القسم ف-03 [م]) — فالزمن المطلق للعيّنة 0 هو downAtMs ولا يُجمَع معه dtMs[0].
function prepareStroke(s) {
  const n = s.x.length;
  const t = new Array(n);
  if (n > 0) t[0] = s.downAtMs;
  for (let i = 1; i < n; i++) t[i] = t[i - 1] + s.dtMs[i];
  return {s, n, t, tFirst: n > 0 ? t[0] : s.downAtMs, tLast: n > 0 ? t[n - 1] : s.downAtMs};
}

function stepLengthPx(s, i) {
  return Math.hypot(s.x[i] - s.x[i - 1], s.y[i] - s.y[i - 1]);
}

// سرعة (px/ث) ومتّجهها على الخطوات من `from+1` إلى `to` شاملةً (النقطتان from وto طرفا النافذة). null إن جمع الأزمنة صفراً (لا سرعة معرَّفة).
function windowMotion(p, from, to) {
  let dt = 0;
  for (let i = from + 1; i <= to; i++) dt += p.s.dtMs[i];
  if (!(dt > 0)) return null;
  // الضرب في 1000 قبل القسمة على الملّيثانيات (لا القسمة على dt/1000): أعداد صحيحة المقام فلا يخرج 20 مم/ث بالضبط «20.000000000000004»، فحدّ الحدود (≥ V_MIN) يُختبر بالمساواة الحقيقية
  const vx = ((p.s.x[to] - p.s.x[from]) * 1000) / dt;
  const vy = ((p.s.y[to] - p.s.y[from]) * 1000) / dt;
  let path = 0;
  for (let i = from + 1; i <= to; i++) path += stepLengthPx(p.s, i);
  return {dtMs: dt, vx, vy, pathPx: path, speedPxPerS: (path * 1000) / dt};
}

// أيّ حافّة من حافّات السطح قريبة (< EDGE_MARGIN_MM) والإصبع متّجه إليها؟ يُعيد {side, distMm} أو null. nearAny: أقرب حافّة ضمن الهامش بغضّ النظر عن الاتّجاه.
function edgeProximity(xPx, yPx, vx, vy, surface, pxPerMm) {
  const margin = D.EDGE_MARGIN_MM * pxPerMm;
  const sides = [
    {side: SIDE.LEFT, dist: xPx, toward: vx < 0},
    {side: SIDE.RIGHT, dist: surface.widthPx - xPx, toward: vx > 0},
    {side: SIDE.TOP, dist: yPx, toward: vy < 0},
    {side: SIDE.BOTTOM, dist: surface.heightPx - yPx, toward: vy > 0},
  ].filter((e) => e.dist < margin).sort((a, b) => a.dist - b.dist);
  if (sides.length === 0) return {nearAny: false, heading: null};
  const heading = sides.find((e) => e.toward) || null;
  return {nearAny: true, heading: heading === null ? null : {side: heading.side, distMm: heading.dist / pxPerMm}, nearestSide: sides[0].side};
}

// ─── (١) القفز بلا رفع ──────────────────────────────────────────────────────────────────────
function detectJumps(p, ctx) {
  const {s, n} = p;
  const {pxPerMm, surface, out} = ctx;
  for (let k = 1 + D.MIN_HISTORY_STEPS; k < n; k++) {
    const stepMm = stepLengthPx(s, k) / pxPerMm;
    const stepDt = s.dtMs[k];
    const winFrom = k - 1 - D.SPEED_WINDOW_STEPS; // نقطة بداية آخر SPEED_WINDOW_STEPS خطوات قبل الخطوة k
    const motion = windowMotion(p, winFrom, k - 1);
    if (motion === null) {
      out.counts.stepsNotEvaluatedNoSpeed++;
      continue;
    }
    out.counts.stepsEvaluated++;
    const medFrom = Math.max(1, k - D.MEDIAN_WINDOW_STEPS);
    const prevMm = [];
    const prevDt = [];
    for (let i = medFrom; i <= k - 1; i++) {
      prevMm.push(stepLengthPx(s, i) / pxPerMm);
      prevDt.push(s.dtMs[i]);
    }
    const medMm = median(prevMm);
    const medDt = median(prevDt);
    const jumpThresholdMm = Math.max(D.J_MIN_MM, D.JUMP_MEDIAN_FACTOR * medMm);
    const speedMmPerS = motion.speedPxPerS / pxPerMm;
    if (!(stepMm > jumpThresholdMm && speedMmPerS >= D.V_MIN_MM_PER_S)) continue;
    const kind = stepDt > Math.max(D.GAP_MIN_MS, D.GAP_MEDIAN_FACTOR * medDt) ? KIND.GAP_JUMP : KIND.COORD_JUMP;
    ctx.flaggedSegments.add(`${s.index}:${k}`);
    const prevIdx = k - 1;
    const edge = edgeProximity(s.x[prevIdx], s.y[prevIdx], motion.vx, motion.vy, surface, pxPerMm);
    if (edge.heading !== null) {
      out.edgeExits.push({kind: KIND.EDGE_EXIT, source: EXIT_SRC.JUMP, jumpKind: kind, strokeIndex: s.index, fromPointIndex: prevIdx, toPointIndex: prevIdx,
        side: edge.heading.side, edgeDistMm: edge.heading.distMm});
    } else {
      out.suspects.push({kind, strokeIndex: s.index, fromPointIndex: prevIdx, toStrokeIndex: s.index, toPointIndex: k, gapMs: stepDt, distMm: stepMm,
        speedBeforeMmS: speedMmPerS, medianStepMm: medMm, medianIntervalMs: medDt, strong: false});
    }
  }
}

// ─── (٢) الانقطاع برفع و(٣) العودة ─────────────────────────────────────────────────────────
function angleDeg(ax, ay, bx, by) {
  const na = Math.hypot(ax, ay);
  const nb = Math.hypot(bx, by);
  if (na === 0 || nb === 0) return null;
  const c = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (na * nb)));
  // يُقرَّب إلى 1e-9 درجة: متّجهان بزاوية 45° بالضبط يُخرجان 45.00000000000001 بالفاصلة العائمة فيُرفَضان وهما «لا يبعدان أكثر من 45°» (design §3.1)
  return Math.round(((Math.acos(c) * 180) / Math.PI) * 1e9) / 1e9;
}

function detectLiftBreaks(eligible, ctx) {
  const {pxPerMm, surface, out} = ctx;
  const ordered = eligible.slice().sort((a, b) => (a.tFirst - b.tFirst) || (a.s.index - b.s.index));
  for (let i = 0; i + 1 < ordered.length; i++) {
    const A = ordered[i];
    const B = ordered[i + 1];
    if (A.s.end !== END.UP) continue; // الرفع العادي وحده («لا إلغاء ولا FLAG_CANCELED»)؛ open_at_end ليس رفعاً
    out.counts.liftsConsidered++;
    // لا فاصل سالباً: الخطوط المؤهَّلة لا تتداخل زمنياً (computeExclusions يستبعد المتزامنة)، وهي مرتَّبة بالهبوط، فكل B يبدأ بعد انتهاء A على الأقلّ
    const gap = B.tFirst - A.tLast;
    if (gap > D.R_MAX_MS) {
      out.counts.liftsIntentionalGap++;
      continue;
    }
    if (A.n < 1 + D.MIN_HISTORY_STEPS || B.n < 1) {
      out.counts.liftsNotEvaluatedShortHistory++;
      continue;
    }
    const last = A.n - 1;
    const motion = windowMotion(A, last - D.SPEED_WINDOW_STEPS, last);
    if (motion === null || motion.speedPxPerS / pxPerMm < D.V_MIN_MM_PER_S) {
      out.counts.liftsNotMoving++;
      continue;
    }
    // الموضع المتوقَّع لو استمرّ بسرعته واتّجاهه طوال الفاصل
    const predX = A.s.x[last] + (motion.vx * gap) / 1000;
    const predY = A.s.y[last] + (motion.vy * gap) / 1000;
    const expectedMm = (Math.hypot(motion.vx, motion.vy) * gap) / 1000 / pxPerMm;
    const landingMm = Math.hypot(B.s.x[0] - predX, B.s.y[0] - predY) / pxPerMm;
    if (!(landingMm <= Math.max(D.LANDING_MIN_MM, D.LANDING_EXPECTED_FRACTION * expectedMm))) {
      out.counts.liftsLandedFar++;
      continue;
    }
    // (٣) العودة
    let m = -1;
    for (let j = D.RETURN_MIN_SAMPLES; j < B.n; j++) {
      if (Math.hypot(B.s.x[j] - B.s.x[0], B.s.y[j] - B.s.y[0]) / pxPerMm >= D.RETURN_MIN_MM) {
        m = j;
        break;
      }
    }
    const angle = m < 0 ? null : angleDeg(motion.vx, motion.vy, B.s.x[m] - B.s.x[0], B.s.y[m] - B.s.y[0]);
    if (angle === null || angle > D.RETURN_MAX_ANGLE_DEG) {
      out.counts.breaksWithoutReturn++;
      continue;
    }
    const edge = edgeProximity(A.s.x[last], A.s.y[last], motion.vx, motion.vy, surface, pxPerMm);
    if (edge.heading !== null) {
      out.edgeExits.push({kind: KIND.EDGE_EXIT, source: EXIT_SRC.LIFT, strokeIndex: A.s.index, fromPointIndex: last, toPointIndex: last,
        side: edge.heading.side, edgeDistMm: edge.heading.distMm});
      continue;
    }
    if (edge.nearAny) {
      out.counts.edgeMarginLifts++;
      continue;
    }
    out.suspects.push({kind: KIND.LIFT_BREAK, strokeIndex: A.s.index, fromPointIndex: last, toStrokeIndex: B.s.index, toPointIndex: 0, gapMs: gap, distMm: landingMm,
      speedBeforeMmS: motion.speedPxPerS / pxPerMm, medianStepMm: null, medianIntervalMs: null, strong: gap < D.STRONG_LIFT_GAP_MS, returnAngleDeg: angle});
  }
}

// ─── (٦) تغطية الخلايا ─────────────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// عبور Amanatides–Woo من (x0,y0) إلى (x1,y1) على شبكة خلاياها cw×ch وأصلها (0,0)؛ يستدعي visit(col,row) لكل خلية يمرّ بها الخطّ (بما فيها الأولى والأخيرة).
function traverse(x0, y0, x1, y1, cw, ch, cols, rows, visit) {
  let cx = clamp(Math.floor(x0 / cw), 0, cols - 1);
  let cy = clamp(Math.floor(y0 / ch), 0, rows - 1);
  const ex = clamp(Math.floor(x1 / cw), 0, cols - 1);
  const ey = clamp(Math.floor(y1 / ch), 0, rows - 1);
  visit(cx, cy);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let tMaxX = stepX === 0 ? Infinity : ((stepX > 0 ? (cx + 1) * cw : cx * cw) - x0) / dx;
  let tMaxY = stepY === 0 ? Infinity : ((stepY > 0 ? (cy + 1) * ch : cy * ch) - y0) / dy;
  const tDeltaX = stepX === 0 ? Infinity : cw / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Infinity : ch / Math.abs(dy);
  let guard = cols + rows + 4;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      cy += stepY;
      tMaxY += tDeltaY;
    } else { // عبور بالزاوية تماماً: الخلية القطرية
      cx += stepX;
      cy += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
    cx = clamp(cx, 0, cols - 1);
    cy = clamp(cy, 0, rows - 1);
    visit(cx, cy);
  }
}

const validCellGeometry = (g) => Number.isInteger(g.gridCols) && g.gridCols > 0 && Number.isInteger(g.gridRows) && g.gridRows > 0 &&
  isFiniteNum(g.cellWidthPx) && g.cellWidthPx > 0 && isFiniteNum(g.cellHeightPx) && g.cellHeightPx > 0;

function recomputeCells(prepared, ctx, geometry, reported, detectorRan) {
  if (!validCellGeometry(geometry)) return {state: CC.UNDETERMINED_NO_CELL_GEOMETRY};
  if (prepared.length === 0) return {state: CC.UNDETERMINED_NO_STROKES};
  const cols = geometry.gridCols;
  const rows = geometry.gridRows;
  const cw = geometry.cellWidthPx;
  const ch = geometry.cellHeightPx;
  const touched = new Set();
  let outsideSamples = 0;
  const inside = (x, y) => x >= 0 && y >= 0 && x < geometry.surfaceWidthPx && y < geometry.surfaceHeightPx;
  const hasSurface = isFiniteNum(geometry.surfaceWidthPx) && isFiniteNum(geometry.surfaceHeightPx);
  const visit = (c, r) => touched.add(r * cols + c);
  for (const p of prepared) {
    const {s} = p;
    for (let i = 0; i < p.n; i++) {
      const ok = !hasSurface || inside(s.x[i], s.y[i]);
      if (!ok) outsideSamples++;
      if (i === 0) {
        if (ok) visit(clamp(Math.floor(s.x[0] / cw), 0, cols - 1), clamp(Math.floor(s.y[0] / ch), 0, rows - 1));
        continue;
      }
      const prevOk = !hasSurface || inside(s.x[i - 1], s.y[i - 1]);
      if (!ok || !prevOk) {
        if (ok) visit(clamp(Math.floor(s.x[i] / cw), 0, cols - 1), clamp(Math.floor(s.y[i] / ch), 0, rows - 1));
        continue;
      }
      if (ctx.flaggedSegments.has(`${s.index}:${i}`)) { // لا استيفاء عبر قفزة/فجوة: النقطة الواصلة تملأ خليّتها وحدها
        visit(clamp(Math.floor(s.x[i] / cw), 0, cols - 1), clamp(Math.floor(s.y[i] / ch), 0, rows - 1));
        continue;
      }
      traverse(s.x[i - 1], s.y[i - 1], s.x[i], s.y[i], cw, ch, cols, rows, visit);
    }
  }
  // «إطار + X» (2026-10-21): المطلوب = الشبكة − cutoutCells − notRequiredCells كما شحنها التطبيق (لا هندسة نمط هنا، القاعدة 24). notRequired غائب (null) ⟵ لا مجموعة مطلوبة تُقارَن (القاعدة 22: لا [] افتراضية).
  // لمسة المسار في خلية غير مطلوبة **لا تُحسب** (العلاقة 3: touchedCells للمطلوبة وحدها)، وتُعدّ بجانبها: الخامّ لا يُمسّ.
  if (!Array.isArray(reported.notRequired)) return {state: CC.UNDETERMINED_REQUIRED_SET_UNKNOWN, outsideSurfaceSamples: outsideSamples};
  const cutout = new Set(reported.cutout || []);
  const notRequired = new Set(reported.notRequired);
  const mandatory = [];
  for (let idx = 0; idx < cols * rows; idx++) if (!cutout.has(idx) && !notRequired.has(idx)) mandatory.push(idx);
  const pathTouchedMandatory = mandatory.filter((idx) => touched.has(idx));
  const pathUntouched = mandatory.filter((idx) => !touched.has(idx));
  let pathTouchedNotRequired = 0;
  for (const idx of touched) if (notRequired.has(idx) && !cutout.has(idx)) pathTouchedNotRequired++;
  const base = {
    outsideSurfaceSamples: outsideSamples,
    pathTouchedCount: pathTouchedMandatory.length,
    pathUntouchedCount: pathUntouched.length,
    mandatoryCells: mandatory.length,
    notRequiredCells: notRequired.size,
    pathTouchedNotRequiredCount: pathTouchedNotRequired,
    pathUntouched: capList(pathUntouched),
  };
  if (reported.touchedCount === null || reported.untouched === null) return {state: CC.UNDETERMINED_NO_REPORTED_CELLS, ...base};
  const reportedUntouched = new Set(reported.untouched);
  const pathOnlyTouched = pathTouchedMandatory.filter((idx) => reportedUntouched.has(idx)); // المسار يقول لُمست والتطبيق يقول لم تُلمَس
  const reportedOnlyTouched = pathUntouched.filter((idx) => !reportedUntouched.has(idx)); //   التطبيق يقول لُمست والمسار يقول لم تُلمَس
  if (!detectorRan) return {state: CC.UNDETERMINED_DETECTOR_NOT_RUN, ...base, reportedTouchedCount: reported.touchedCount, reportedUntouchedCount: reported.untouched.length};
  const same = pathOnlyTouched.length === 0 && reportedOnlyTouched.length === 0 && pathTouchedMandatory.length === reported.touchedCount;
  return {
    state: same ? CC.MATCH : CC.DISAGREE,
    ...base,
    reportedTouchedCount: reported.touchedCount,
    reportedUntouchedCount: reported.untouched.length,
    touchedByPathNotByApp: capList(pathOnlyTouched),
    touchedByAppNotByPath: capList(reportedOnlyTouched),
  };
}

// ─── الإحصاءات: معدّل العيّنات وأقرب بُعد من كل حافّة ─────────────────────────────────────────
function samplingStats(prepared) {
  const intervals = [];
  let zero = 0;
  let points = 0;
  for (const p of prepared) {
    points += p.n;
    for (let i = 1; i < p.n; i++) {
      intervals.push(p.s.dtMs[i]);
      if (p.s.dtMs[i] === 0) zero++;
    }
  }
  const med = median(intervals);
  return {
    pointsTotal: points,
    intervalCount: intervals.length,
    zeroIntervals: zero,
    medianIntervalMs: med,
    p95IntervalMs: percentileNearestRank(intervals, 0.95),
    // معدّل = 1000 ÷ الوسيط: اشتقاق عكوس من الوسيط، ولا يُعرَّف حين الوسيط صفر (أحداث مجمَّعة بزمن واحد)
    medianRateHz: med !== null && med > 0 ? 1000 / med : null,
  };
}

function edgeStats(prepared, surface, pxPerMm) {
  if (prepared.length === 0) return {state: EDGES.NO_POINTS};
  let minLeft = Infinity;
  let minRight = Infinity;
  let minTop = Infinity;
  let minBottom = Infinity;
  let any = false;
  for (const p of prepared) {
    for (let i = 0; i < p.n; i++) {
      any = true;
      minLeft = Math.min(minLeft, p.s.x[i]);
      minRight = Math.min(minRight, surface.widthPx - p.s.x[i]);
      minTop = Math.min(minTop, p.s.y[i]);
      minBottom = Math.min(minBottom, surface.heightPx - p.s.y[i]);
    }
  }
  if (!any) return {state: EDGES.NO_POINTS};
  const px = {left: minLeft, right: minRight, top: minTop, bottom: minBottom};
  const mm = pxPerMm === null ? null : {left: minLeft / pxPerMm, right: minRight / pxPerMm, top: minTop / pxPerMm, bottom: minBottom / pxPerMm};
  return {state: EDGES.READ, nearestPx: px, nearestMm: mm, basis: N.TOUCH_PATH_EDGE_BASIS.SURFACE_LOCAL_FRAME};
}

// ─── ما عُرض على الفنّي مقابل ما كشفه الخادم (design §6.4: «يُرسَل displayedSuspects ليُرى الفرق»: كاشف عرض في التطبيق وكاشف موثوق على الخادم وقد يختلفان) ───
// المطابقة بفهرس الخطّ والفهرسين (على السلك: edge_exit فهرساه متساويان = آخر عيّنة). انقطاع الرفع (lift_break) لا مقابل له في displayedSuspects على السلك فلا يدخل المقارنة ويُعدّ.
function compareDisplayed(displayed, suspects, edgeExits, detectorRan) {
  const DS = N.TOUCH_PATH_DISPLAYED_STATE;
  if (displayed === null) return {state: DS.NOT_DISPLAYED};
  const keyOf = (strokeIndex, from, to) => `${strokeIndex}:${from}:${to}`;
  const detected = new Map();
  let liftBreaks = 0;
  for (const d of suspects) {
    if (d.kind === KIND.LIFT_BREAK) {
      liftBreaks++;
      continue;
    }
    detected.set(keyOf(d.strokeIndex, d.fromPointIndex, d.toPointIndex), d.kind);
  }
  for (const d of edgeExits) detected.set(keyOf(d.strokeIndex, d.fromPointIndex, d.toPointIndex), d.kind);
  const shown = new Set();
  let matched = 0;
  let kindAgrees = 0;
  const notDetected = [];
  for (const d of displayed) {
    const key = keyOf(d.strokeIndex, d.fromPointIndex, d.toPointIndex);
    shown.add(key);
    if (detected.has(key)) {
      matched++;
      if (detected.get(key) === d.kind) kindAgrees++;
    } else {
      notDetected.push({kind: d.kind, strokeIndex: d.strokeIndex, fromPointIndex: d.fromPointIndex, toPointIndex: d.toPointIndex});
    }
  }
  let detectedNotShown = 0;
  for (const key of detected.keys()) if (!shown.has(key)) detectedNotShown++;
  return {
    state: displayed.length === 0 ? DS.DISPLAYED_NONE : DS.DISPLAYED,
    detectorRan, displayedCount: displayed.length, matchedCount: matched, kindAgreeCount: kindAgrees,
    displayedNotDetected: capList(notDetected), detectedNotDisplayedCount: detectedNotShown, liftBreaksNotComparable: liftBreaks,
  };
}

// ─── الاستبعاد من الكشف ────────────────────────────────────────────────────────────────────
function computeExclusions(preparedAll, pxPerMm) {
  const reasons = new Map(preparedAll.map((p) => [p.s.index, new Set()]));
  for (const p of preparedAll) {
    if (p.s.end === END.CANCEL || p.s.end === END.CANCEL_FLAGGED) reasons.get(p.s.index).add(EXCL.CANCELLED);
    if (p.s.endRecognized === false) reasons.get(p.s.index).add(EXCL.UNRECOGNIZED_END);
    if (pxPerMm !== null && Array.isArray(p.s.touchMajorPx)) {
      let big = false;
      for (const v of p.s.touchMajorPx) if (v / pxPerMm > D.PALM_TOUCH_MAJOR_MM) { big = true; break; }
      if (big) reasons.get(p.s.index).add(EXCL.PALM_TOUCH_MAJOR);
    }
  }
  // إصبع ثانٍ متزامن: فترتان تتداخلان تداخلاً فعلياً (لا مجرّد تماسّ: الرفع والهبوط في المللي ثانية نفسه ليسا تزامناً)
  const byStart = preparedAll.slice().sort((a, b) => a.tFirst - b.tFirst);
  let maxEnd = -Infinity;
  let maxEndOwner = null;
  for (const p of byStart) {
    if (p.tFirst < maxEnd) {
      reasons.get(p.s.index).add(EXCL.CONCURRENT_POINTER);
      reasons.get(maxEndOwner.s.index).add(EXCL.CONCURRENT_POINTER);
    }
    if (p.tLast > maxEnd) {
      maxEnd = p.tLast;
      maxEndOwner = p;
    }
  }
  return reasons;
}

/**
 * @param {Object} input
 * @param {Array<Object>} input.strokes خطوط قرأها القارئ: {index, pointerId, end, endRecognized, downAtMs, dtMs[], x[], y[], touchMajorPx|null, usable}
 *   `usable=false` ⇒ مصفوفاتها غير صالحة (أطوال أو عناصر): تُحصى وتُستبعد ولا تُلمَس.
 * @param {Object} input.geometry {surfaceWidthPx, surfaceHeightPx, pxPerMm|null, gridCols, gridRows, cellWidthPx, cellHeightPx} — أيٌّ منها قد يكون null (غائب)
 * @param {Object} input.reportedCells {cutout: number[]|null, notRequired: number[]|null, untouched: number[]|null, touchedCount: number|null}
 *   notRequired = الخلايا غير المطلوبة بحكم نمط «إطار + X» كما شحنها التطبيق ([] حين NOT_DECLARED صراحةً)؛ **null أو غائب ⟵ cells.state = UNDETERMINED_REQUIRED_SET_UNKNOWN** (لا [] افتراضية، القاعدة 22).
 * @param {?Array<Object>} input.displayed علامات العرض كما قرأها القارئ ({kind, strokeIndex, fromPointIndex, toPointIndex})، أو null = لم تُعرض علامات
 * @return {Object}
 */
function analyzeTouchPath(input) {
  const {strokes, geometry, reportedCells} = input;
  const displayed = Array.isArray(input.displayed) ? input.displayed : null;
  const pxPerMm = isFiniteNum(geometry.pxPerMm) && geometry.pxPerMm > 0 ? geometry.pxPerMm : null;
  const surface = isFiniteNum(geometry.surfaceWidthPx) && isFiniteNum(geometry.surfaceHeightPx) && geometry.surfaceWidthPx > 0 && geometry.surfaceHeightPx > 0 ?
    {widthPx: geometry.surfaceWidthPx, heightPx: geometry.surfaceHeightPx} : null;
  const usableStrokes = strokes.filter((s) => s.usable);
  const preparedAll = usableStrokes.map(prepareStroke);
  const exclusionByStroke = computeExclusions(preparedAll, pxPerMm);
  const eligible = preparedAll.filter((p) => exclusionByStroke.get(p.s.index).size === 0);

  const out = {
    suspects: [],
    edgeExits: [],
    counts: {
      stepsEvaluated: 0, stepsNotEvaluatedNoSpeed: 0,
      liftsConsidered: 0, liftsIntentionalGap: 0, liftsNotEvaluatedShortHistory: 0, liftsNotMoving: 0, liftsLandedFar: 0,
      breaksWithoutReturn: 0, edgeMarginLifts: 0,
    },
  };
  const ctx = {pxPerMm, surface, out, flaggedSegments: new Set()};

  let state;
  if (strokes.length === 0) state = ST.UNDETERMINED_NO_USABLE_STROKES;
  else if (eligible.length === 0) state = ST.UNDETERMINED_NO_USABLE_STROKES;
  else if (pxPerMm === null) state = ST.UNDETERMINED_NO_PX_PER_MM;
  else if (surface === null) state = ST.UNDETERMINED_NO_SURFACE;
  else state = ST.RAN;
  if (state === ST.RAN) {
    for (const p of eligible) detectJumps(p, ctx);
    detectLiftBreaks(eligible, ctx);
  }

  const exclusions = [];
  for (const p of preparedAll) {
    const r = exclusionByStroke.get(p.s.index);
    if (r.size > 0) exclusions.push({strokeIndex: p.s.index, reasons: [...r].sort()});
  }
  const unusable = strokes.filter((s) => !s.usable).map((s) => s.index);

  const sus = capList(out.suspects);
  const ex = capList(out.edgeExits);
  return {
    detector: {
      version: D.VERSION,
      thresholds: Object.fromEntries(Object.entries(D).filter(([k]) => k !== 'VERSION')),
      state,
      suspects: sus.items, suspectsTotal: sus.total, suspectsTruncated: sus.truncated,
      edgeExits: ex.items, edgeExitsTotal: ex.total, edgeExitsTruncated: ex.truncated,
      counts: out.counts,
      strokesEvaluated: eligible.length,
      excludedStrokes: capList(exclusions),
      unusableStrokeIndexes: capList(unusable),
      notes: Object.values(N.TOUCH_PATH_DETECTOR_NOTES),
    },
    sampling: samplingStats(preparedAll),
    edges: surface === null ? {state: EDGES.NO_SURFACE} : edgeStats(preparedAll, surface, pxPerMm),
    cells: recomputeCells(preparedAll, ctx, geometry, reportedCells, state === ST.RAN),
    displayedVsDetected: compareDisplayed(displayed, out.suspects, out.edgeExits, state === ST.RAN),
    conventions: {
      cellOfPoint: 'floor(x / cellWidthPx), floor(y / cellHeightPx) clamped to the grid; not stated by the contract section; agrees with the cells the producer reported on its three fv71 samples (NeuralChek@f9e0571)',
      cellIndex: 'row * gridCols + col (contract section, untouchedCells / cutoutCells / notRequiredCells)',
      requiredCells: 'all cells minus cutoutCells minus notRequiredCells, as the producer declared them (frame + X, 2026-10-21); the server does not compute the pattern geometry; a path touch in a not-required cell is counted apart and not as a required touch',
      percentile: 'nearest-rank',
      intervals: 'dtMs are whole milliseconds: at 240Hz (4.17 ms) the interval is rounded, so the derived rate is approximate',
      coordinateFrame: 'surface-local (contract section, strokes x/y)',
    },
  };
}

module.exports = {analyzeTouchPath, traverse, median, percentileNearestRank, edgeProximity};
