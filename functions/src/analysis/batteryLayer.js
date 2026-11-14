// ===================================================
// batteryLayer.js — طبقة البطارية (٤-ج، PLAN-01-ROADMAP.md، جديدة كلّياً
// 2026-09-20) — "قياس الأثر لا قراءة الرقم"
// ===================================================
// قراءة السعة مباشرةً مسدودة (A93: صفر نجاح من 30 عقدة على untrusted_app؛
// A95: عدّاد الشحن مثبَّت على السعة التصميمية) — فالبطارية تُقيَّم بأثرها
// تحت الحمل. أربعة مؤشّرات، **كلّها من fv67** (لا تحتاج charge_counter/fv68):
//
//   BAT-THERMAL-EFF  ΔT ÷ الطاقة المصروفة (°C/Wh)
//   BAT-R-APPARENT   (متوسط V أول 10 ث − متوسط V تحت الحمل) ÷ متوسط |I| تحت الحمل
//   BAT-FCC          تقدير سعة عبر تكامل التيار بين انتقالات مستوى الشحن
//                    (بديل مقياسي لعدّاد الشحن الحقيقي؛ يُحاذى الفواصل بين
//                    انتقالين متتاليين في v[4] تماماً كصيغة §٤-أ القديمة
//                    "السعة الضمنية" — لا CC هنا لأن fv67 لا يحمله)
//   BAT-COULOMB      تكامل التيار للفحص كاملاً (= findings.battery.qIntMah)
//
// المصدر النصّي: PLAN-01-ROADMAP.md §٤-ج، منقول من REPORT-TO-COORDINATOR.md
// §٣.١ (خارج هذا المستودع — لا نسخة منه هنا). **القيم المرجعية التوضيحية
// في تلك الفقرة (مثلاً "S10 17.8·19.9·20.7 °C/Wh"، "79·133·140 mΩ") لم
// تُطابَق ذهبياً في هذا الملف** لأن منهجية حسابها الأصلية غير متوفّرة في
// هذا المستودع؛ اختُبر هنا الاتّساق الداخلي فقط (batteryLayer.test.js) —
// وهو ما تحقّق فعلاً لـBAT-COULOMB (144.16/143.84/139.91 mAh على ثلاث
// جلسات S10 حقيقية، تكرارية ≈1.35% — يطابق "144·144·140، تكرارية 1.4%"
// في الخطّة تقريباً).
//
// ⚠️ وحدة التيار المُعلَنة (µA) تحمل غموضاً موثَّقاً في PLAN-01 §P2.1 (A39:
// "قد يكون خطأ في استنتاج مضاعف التيار" — Honor 2.67× تناقض بين التكامل
// وعدّاد النسبة). لم يُصحَّح هنا؛ BAT-R-APPARENT وBAT-THERMAL-EFF يُحسَبان
// من القيمة كما وردت دون افتراض تصحيح مضاعف — الأرقام المطلقة الناتجة
// **غير موثوقة بمعزل عن حسم A39** (تُعرض بوسم ESTIMATED أصلاً).
//
// ─── مستوى الشحن لكل مؤشّر (2026-09-22 +03، مهمّة لاحقة، سدّ فجوة موثَّقة
// في docs/V7_DISPLAY_SHAPE_CONTRACT.md §٣ — راجع الفقرة "⚠️ فرق موثَّق عن
// نصّ الخطّة"، مُوسَمة محلولة هناك الآن) ──────────────────────────────────
// P1.5 + §٤-ج ينصّان: "مؤشّرات البطارية تُعرض مع مستوى الشحن الذي قيست
// عنده" — لكل مؤشّر على حدة، لا مستوى واحد للفحص كلّه. حتى هذه الجلسة كان
// المُنفَّذ الوحيد findings.battery.socAtStart/socAtEnd (مستوى شحن الفحص
// كاملاً — من header/footer، مصدر مختلف عن lvl[] هنا) — يبقى كما هو على
// مستوى الفئة (docs §٣: "لا تُحذف ولا تُوحَّد مع الجديد").
//
// المُضاف هنا: كل دالّة computeBat* تُرفِق socAtWindowStart/socAtWindowEnd
// (خام من lvl[] — بلا تحويل، القاعدة 20) عند حدّي **نافذة العيّنات
// المُستعملة فعلاً** في حسابها — لا نقطة واحدة مُخترَعة (لا وسط، لا تقريب).
// تحقّق مباشر بقراءة كل دالّة أظهر: **لا مؤشّر هنا نقطة عيّنة واحدة** —
// الأربعة كلّها نوافذ:
//   BAT-THERMAL-EFF  0..n-1 (deltaTC/energyWh على الفحص كاملاً بلا تصفية
//                     طور) — **نفس خاصّية BAT-COULOMB بالضبط**، لا BAT-COULOMB
//                     وحدها كما افترض نصّ مهمّة سابقة (راجع تقرير هذه المهمّة).
//   BAT-R-APPARENT   اتّحاد أوّل 10 ثوان (first10sIdx) وطور تحت الحمل
//                     (idx35) — نافذتان منفصلتان، لا واحدة.
//   BAT-FCC          اتّحاد كل الفواصل المؤهَّلة بين انتقالات مستوى (قد لا
//                     يغطّي طرفي الفحص — الأكثر تجزّؤاً بين الأربعة).
//   BAT-COULOMB      0..n-1 (الفحص كاملاً حرفياً — نفس تعريف qIntMah).
// فالحقلان دائماً **نطاق** (من...إلى)، لا نقطة — "نطاق أصدق من نقطة
// مخترَعة" (نصّ المهمّة). غياب حقيقي (null/null) حين لا عيّنة اسُتعملت
// فعلاً (مثلاً idx35 فارغة تماماً على BAT-R-APPARENT) — القاعدة 22.
// راجع socWindowFromIndices أدناه والتفصيل حقلاً حقلاً في تقرير المهمّة.
// ===================================================
//
// ─── العتبات الصحّية (سليمة/تقادم) — غير موجودة في أي مصدر متاح لي ──────
// §٤-ج يحدّد الصيغة والبوّابة لكل مؤشّر، ولا يحدّد أي عتبة رقمية تفصل
// "سليمة" عن "تقادم" لأيّ من الأربعة (المقارنة الوحيدة المذكورة هي مقارنة
// °C/Wh بين أجهزة الطراز نفسه عبر modelBaselines، وهي فارغة اليوم:
// "قبل امتلائها: يُسجَّل ولا يُقارَن"). وP1.3 نفسها تمنع أي حرف من عتبة لم
// تجتز PLAN-03 ("لا حرف من عتبة لم تجتز"). لذلك: كل مؤشّر هنا يُنتج قيمة
// مقاسة (أو يمتنع ببوّابته)، **ولا يُنتج verdict سليمة/تقادم** — الحقل
// `verdict` يبقى 'THRESHOLD_NOT_CALIBRATED' حتى تُقاس عتبة حقيقية في
// PLAN-03. أثر ذلك على قاعدة الجمع (categoryStates.js): كل المؤشّرات
// الأربعة تُعامَل كمُمتنعة عن الحكم (لا عن القياس) → "غير كافية" → بلا
// حرف بطارية على أي فحص اليوم. هذا استنتاج من نصّين في الخطّة نفسها
// (٤-ج + قاعدة "لا حرف من عتبة لم تجتز" في P1.3)، لا اختراع، ويُذكر بارزاً
// في تقرير المهمّة.
// ===================================================

'use strict';

const {EVIDENCE_MIN_CADENCE_UPDATES, EVIDENCE_MIN_SAMPLES, _internal} = require('./findings');
const {mean, median, changes, coulombMah} = _internal;

const DESIGN_PINNED_TOLERANCE = 0.03; // §٤-ج: "ضمن ±3% من السعة التصميمية"
const MIN_LEVEL_INTERVALS = 2; // §٤-أ: "بوّابة: عدد الفواصل ≥ 2"
const MIN_INTERVAL_SEC = 30; // §٤-أ: استثناء الفواصل < 30 ث
const COULOMB_MIN_QINT_MAH = 80; // §٤-أ: "شروط القياس: Q_int ≥ 80 mAh"

function abstain(id, reason, extra) {
  return Object.assign({id, status: 'ABSTAINED', reason, verdict: null}, extra || {});
}

function measured(id, fields) {
  return Object.assign({id, status: 'MEASURED', verdict: 'THRESHOLD_NOT_CALIBRATED'}, fields);
}

/**
 * يلتقط مستوى الشحن الخام (lvl[]، بلا أيّ تحويل — القاعدة 20) عند حدّي
 * نافذة العيّنات المُستعملة فعلاً في حساب مؤشّر واحد. `indices` فهارس حقيقية
 * دخلت الحساب (لا كل العيّنات بالضرورة — راجع تعليق رأس الملفّ لكل مؤشّر).
 * فارغة أو غير صالحة → {null, null} صراحة (غياب حقيقي، لا صفر — القاعدة 22)
 * لا استنتاج لحدّين من مصفوفة لم تُستعمَل شيئاً منها.
 * @param {number[]} lvl مصفوفة مستوى الشحن الخام لكامل الفحص (v[4])
 * @param {number[]} indices فهارس العيّنات المُستعملة فعلاً (قد تصل بأي ترتيب)
 * @return {{socAtWindowStart: (number|null), socAtWindowEnd: (number|null)}}
 */
function socWindowFromIndices(lvl, indices) {
  if (!Array.isArray(lvl) || !Array.isArray(indices) || !indices.length) {
    return {socAtWindowStart: null, socAtWindowEnd: null};
  }
  let lo = indices[0];
  let hi = indices[0];
  for (const i of indices) {
    if (i < lo) lo = i;
    if (i > hi) hi = i;
  }
  const start = lvl[lo];
  const end = lvl[hi];
  return {
    socAtWindowStart: (typeof start === 'number' && !Number.isNaN(start)) ? start : null,
    socAtWindowEnd: (typeof end === 'number' && !Number.isNaN(end)) ? end : null,
  };
}

// ─── BAT-THERMAL-EFF ────────────────────────────────────────────────────
function computeBatThermalEff({n, t, temp, volt, cur, lvl}) {
  const cadenceWhole = changes(temp);
  const gate = {cadenceWhole, required: EVIDENCE_MIN_CADENCE_UPDATES, passes: cadenceWhole >= EVIDENCE_MIN_CADENCE_UPDATES};
  // النافذة = الفحص كاملاً (0..n-1) — deltaTC/energyWh أدناه يُحسَبان على كل
  // العيّنات بلا تصفية طور (راجع تعليق رأس الملفّ: نفس خاصّية BAT-COULOMB).
  const socWindow = socWindowFromIndices(lvl, n >= 1 ? [0, n - 1] : []);
  if (!gate.passes || n < 2) {
    return abstain('BAT-THERMAL-EFF', 'INSUFFICIENT_CADENCE', {gate, ...socWindow});
  }
  const deltaTC = Math.max(...temp) - temp[0];
  // الطاقة المصروفة (Wh) = ∫|V×I| dt، شبه المنحرف. V بـmV، I بـµA → W = (mV/1000)×(µA/1e6).
  let energyWh = 0;
  for (let i = 0; i < n - 1; i++) {
    const p1 = Math.abs((volt[i] / 1000) * (cur[i] / 1e6));
    const p2 = Math.abs((volt[i + 1] / 1000) * (cur[i + 1] / 1e6));
    energyWh += ((p1 + p2) / 2) * (t[i + 1] - t[i]) / 3600000;
  }
  if (!(energyWh > 0)) return abstain('BAT-THERMAL-EFF', 'ZERO_ENERGY', {gate, deltaTC, ...socWindow});
  return measured('BAT-THERMAL-EFF', {
    value: deltaTC / energyWh, unit: '°C/Wh', deltaTC, energyWh, gate,
    comparedToModelBaseline: false,
    note: 'مقارنة الطراز غير مفعّلة — modelBaselines فارغة (§٤-ج)',
    ...socWindow,
  });
}

// ─── BAT-R-APPARENT ─────────────────────────────────────────────────────
function computeBatRApparent({n, t, ph, volt, cur, lvl}) {
  const idx35 = [];
  for (let i = 0; i < n; i++) if (ph[i] === 3 || ph[i] === 4 || ph[i] === 5) idx35.push(i);
  const voltUnderLoad = idx35.map((i) => volt[i]);
  const cadenceUnderLoad = changes(voltUnderLoad);
  const gate = {
    nSamples: idx35.length, sourceCadenceUpdates: cadenceUnderLoad,
    required: EVIDENCE_MIN_CADENCE_UPDATES,
    passes: idx35.length >= EVIDENCE_MIN_SAMPLES && cadenceUnderLoad >= EVIDENCE_MIN_CADENCE_UPDATES,
  };
  // نافذة "تحت الحمل" وحدها (idx35) — المعروفة بهذه المرحلة، قبل first10sIdx.
  const underLoadWindow = socWindowFromIndices(lvl, idx35);
  if (!gate.passes || !idx35.length) {
    return abstain('BAT-R-APPARENT', 'INSUFFICIENT_CADENCE', {gate, ...underLoadWindow});
  }
  const t0 = t[0];
  const first10sIdx = [];
  for (let i = 0; i < n; i++) if (t[i] <= t0 + 10000) first10sIdx.push(i);
  if (!first10sIdx.length) return abstain('BAT-R-APPARENT', 'INSUFFICIENT_SAMPLES', {gate, ...underLoadWindow});

  // النافذة الكاملة لهذا المؤشّر: اتّحاد أوّل 10 ثوان وطور تحت الحمل معاً —
  // نافذتان منفصلتان (راجع تعليق رأس الملفّ)، لا نافذة واحدة متّصلة بالضرورة.
  const fullWindow = socWindowFromIndices(lvl, first10sIdx.concat(idx35));

  const vFirst10sMv = mean(first10sIdx.map((i) => volt[i]));
  const vUnderLoadMv = mean(voltUnderLoad);
  const iUnderLoadUa = mean(idx35.map((i) => Math.abs(cur[i])));
  if (!(iUnderLoadUa > 0)) return abstain('BAT-R-APPARENT', 'ZERO_CURRENT', {gate, ...fullWindow});

  const deltaVmV = vFirst10sMv - vUnderLoadMv;
  const iUnderLoadMa = iUnderLoadUa / 1000;
  // R(mΩ) = 1000 × ΔV(mV) / I(mA) — انظر تعليق رأس الملف بشأن غموض وحدة I (A39).
  const rApparentMohm = 1000 * deltaVmV / iUnderLoadMa;
  return measured('BAT-R-APPARENT', {
    value: rApparentMohm, unit: 'mΩ', vFirst10sMv, vUnderLoadMv, iUnderLoadUa, gate,
    unitCaveat: 'وحدة التيار المُعلَنة تحمل غموض مضاعف موثَّق (A39) — الرقم المطلق غير موثوق بمعزل عن حسمه',
    ...fullWindow,
  });
}

// ─── BAT-FCC (تقدير عبر تكامل التيار بين انتقالات المستوى) ─────────────
function computeBatFcc({n, t, ph, cur, lvl, design}) {
  const trans = [];
  for (let i = 1; i < n; i++) if (lvl[i] !== lvl[i - 1]) trans.push(i);

  const intervals = [];
  const usedIndices = [];
  for (let j = 0; j < trans.length - 1; j++) {
    const a = trans[j]; const b = trans[j + 1];
    if (ph[a] === 0 || ph[a] === 7 || ph[b] === 0 || ph[b] === 7) continue;
    if ((t[b] - t[a]) / 1000 < MIN_INTERVAL_SEC) continue;
    const dL = lvl[a] - lvl[b];
    if (dL === 0) continue;
    const qIntervalMah = coulombMah(cur, t, a, b);
    intervals.push({cEst: 100 * qIntervalMah / Math.abs(dL), dL, qIntervalMah});
    usedIndices.push(a, b);
  }

  const gate = {intervalCount: intervals.length, required: MIN_LEVEL_INTERVALS, passes: intervals.length >= MIN_LEVEL_INTERVALS};
  // اتّحاد حدود كل الفواصل المؤهَّلة فعلياً — لا نافذة الفحص كاملاً بالضرورة
  // (BAT-FCC وحدها بين الأربعة قد لا تغطّي طرفي الفحص — راجع تعليق رأس الملفّ).
  const socWindow = socWindowFromIndices(lvl, usedIndices);
  if (!gate.passes) return abstain('BAT-FCC', 'INSUFFICIENT_SAMPLES', {gate, ...socWindow});

  const cEst = median(intervals.map((x) => x.cEst));
  if (!design) {
    return measured('BAT-FCC', {value: cEst, unit: 'mAh', intervalCount: intervals.length, gate, designCapacityMah: null, ratioToDesign: null, ...socWindow});
  }
  const ratioToDesign = cEst / design;
  const designPinned = Math.abs(ratioToDesign - 1) <= DESIGN_PINNED_TOLERANCE;
  if (designPinned) {
    return abstain('BAT-FCC', 'DESIGN_PINNED', {
      gate, value: cEst, ratioToDesign, designCapacityMah: design,
      note: 'ضمن ±3% من السعة التصميمية — قد يعكس تثبيت عدّاد الشحن على القيمة الاسمية (A95)، لا قياساً مستقلاً',
      ...socWindow,
    });
  }
  return measured('BAT-FCC', {value: cEst, unit: 'mAh', intervalCount: intervals.length, gate, designCapacityMah: design, ratioToDesign, ...socWindow});
}

// ─── BAT-COULOMB (تكامل التيار للفحص كاملاً) ────────────────────────────
function computeBatCoulomb({n, t, cur, lvl}) {
  // النافذة = الفحص كاملاً حرفياً (0..n-1) — نفس مدى تكامل qIntMah بالضبط.
  const socWindow = socWindowFromIndices(lvl, n >= 1 ? [0, n - 1] : []);
  if (n < 2) return abstain('BAT-COULOMB', 'INSUFFICIENT_SAMPLES', {gate: {n}, ...socWindow});
  const qIntMah = coulombMah(cur, t, 0, n - 1);
  const gate = {qIntMah, required: COULOMB_MIN_QINT_MAH, passes: qIntMah >= COULOMB_MIN_QINT_MAH};
  if (!gate.passes) return abstain('BAT-COULOMB', 'INSUFFICIENT_SAMPLES', {gate, ...socWindow});
  return measured('BAT-COULOMB', {
    value: qIntMah, unit: 'mAh', gate,
    consistencyGateNote: 'بوّابة الاتّساق المنصوصة (k = ΔCC ÷ ∫I) تحتاج charge_counter (fv68) ' +
        'وغير قابلة للتقييم على fv67 — لم تُستبدَل بتخمين؛ الحقل consistencyK يبقى null.',
    consistencyK: null,
    ...socWindow,
  });
}

// ─── قاعدة الجمع (§٤-ج) ─────────────────────────────────────────────────
// كل مؤشّر يُدلي بواحد من (سليمة/تقادم/ممتنع).
//   ثلاثة متّفقة → الحالة، ثقة عالية
//   اثنان متّفقان → الحالة، ثقة متوسّطة
//   تناقض → «مؤشّرات متعارضة»، ثقة منخفضة
//   أقلّ من اثنين [أدليا بحكم] → «غير كافية»، بلا ثقة
// مستقلّة عن computeBatteryLayer عمداً (قابلة للاختبار بـverdicts اصطناعية
// — batteryLayer.test.js) لأن لا عتبة مُعايَرة اليوم تُنتج verdict حقيقياً
// (كل مؤشّر MEASURED يحمل 'THRESHOLD_NOT_CALIBRATED' لا حكماً — انظر
// تعليق رأس الملف)، فالمسار الحيّ الوحيد المُختبَر ذهبياً هو "غير كافية".
function aggregateVerdicts(indicators) {
  const verdicts = Object.values(indicators)
      .filter((x) => x.status === 'MEASURED' && x.verdict && x.verdict !== 'THRESHOLD_NOT_CALIBRATED');

  if (verdicts.length < 2) {
    return {judgment: 'غير كافية', confidence: null, displayGrade: null};
  }
  const counts = {};
  for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] || 0) + 1;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [topVerdict, topCount] = entries[0];
  const conflict = entries.length > 1 && entries[1][1] === topCount;
  if (conflict) {
    return {judgment: 'مؤشّرات متعارضة', confidence: 'منخفضة', displayGrade: 'مؤشّرات تقادم'};
  }
  if (topCount >= 3) {
    return {judgment: topVerdict, confidence: 'عالية', displayGrade: null};
  }
  return {judgment: topVerdict, confidence: 'متوسطة', displayGrade: null};
}

/**
 * يحسب المؤشّرات الأربعة من عيّنات فحص واحد (نفس مدخلات findings.js
 * الخام). لا يرمي أبداً — كل مؤشّر يُبلَّغ ABSTAINED بسبب مُسمّى إن تعذّر.
 */
function computeBatteryLayer({n, t, ph, temp, volt, cur, lvl, design}) {
  const indicators = {
    'BAT-THERMAL-EFF': computeBatThermalEff({n, t, temp, volt, cur, lvl}),
    'BAT-R-APPARENT': computeBatRApparent({n, t, ph, volt, cur, lvl}),
    'BAT-FCC': computeBatFcc({n, t, ph, cur, lvl, design}),
    'BAT-COULOMB': computeBatCoulomb({n, t, cur, lvl}),
  };
  return {indicators, aggregate: aggregateVerdicts(indicators)};
}

module.exports = {
  computeBatteryLayer,
  aggregateVerdicts,
  DESIGN_PINNED_TOLERANCE,
  MIN_LEVEL_INTERVALS,
  MIN_INTERVAL_SEC,
  COULOMB_MIN_QINT_MAH,
  _internal: {computeBatThermalEff, computeBatRApparent, computeBatFcc, computeBatCoulomb},
};
