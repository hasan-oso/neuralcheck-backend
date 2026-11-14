const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {failureTextOnce} = require("../utils/failureText");
const {admin, db, requireAdmin} = require("../utils/admin");
const {geminiKey, deepseekKey} = require("../utils/secrets");
const {runAnalysisInternal} = require("../analysis/runAnalysisInternal");
const N = require("../analysis/fv68Names");
const {resolveLayout, columnIndex} = require("../analysis/fv68Reader");

// ===================================================================
// runConsistencyTest — Admin-only consistency tester
// يولّد N variations من نفس rawFingerprint مع noise واقعي،
// يستدعي runAnalysisInternal على كل واحدة، يُرجع توزيع grade/score.
// ===================================================================

// FNV-1a 32-bit hash → unsigned int (deterministic seed from string)
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Mulberry32 PRNG → () => float in [0, 1)
function mulberry32(seed) {
  let s = seed >>> 0;
  return function() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Phase index from sample idx (assumes 1Hz sampling, 690s standard scan)
function getPhaseForSampleIdx(idx) {
  if (idx < 30) return 1;
  if (idx < 90) return 2;
  if (idx < 480) return 3;
  if (idx < 600) return 4;
  return 5;
}

// ضجيج لكل عمود **باسمه** (الدفعة ٤ من V8، القاعدة 25): طول v[] يختلف بين الأجهزة (11 + ما اجتاز الاكتشاف) والاسم هو المميِّز
// لا الفهرس (عقد fv68 :409). قبل هذا التغيير كان الشرط `v.length < 18` ⇒ **لا ضجيج إطلاقاً على 11 قناة** (كل ملفّات launch)، وعلى 18 قناة
// (ست سياسات مع عدّاد الشحن) ضجيج على قنوات خاطئة (عقد :412، :779)؛ و`recomputeStats` كانت تقرأ v[5] «حرارة» وهو cpu_freq_max_khz في launch
// فتُحلّ تردّداً (ملايين kHz) محلّ حرارة في T-01/T-02/T-03 — القاعدة تُطبَّق الآن على الأسماء المعروفة وحدها.
// الأسماء التي لا قاعدة ضجيج لها (الزمن، المستوى، القدرة، التخزين، الذاكرة، عدّاد الشحن…) لا تُمسّ، وتُعلَن في notNoisedChannels.
const NOISE_RULES = [
  {match: (name) => name === N.BASE_CHANNELS.BATTERY_TEMP_C,
    apply: (x, noise, isStress) => x + noise(isStress ? 1.5 : 1.0)}, // ±1.0 normal / ±1.5 stress
  {match: (name) => name === N.BASE_CHANNELS.BATTERY_VOLTAGE_MV,
    apply: (x, noise) => x + noise(15)}, // ±15
  {match: (name) => name === N.BASE_CHANNELS.BATTERY_CURRENT_UA,
    apply: (x, noise) => x + noise(150)}, // ±150
  {match: (name) => name === "cpu_temp_c", // تخطيط V1 (datacollect) — -1 = unavailable
    apply: (x, noise, isStress) => (x >= 0 ? x + noise(isStress ? 2.5 : 1.5) : x)},
  {match: (name) => /^cpu_freq_/.test(name), // cpu_freq_max_khz وcpu_freq_policy{N}_khz وcpu_freq_* في V1: ±3% ضربياً، لا أقلّ من صفر
    apply: (x, noise) => (x > 0 ? Math.max(0, x * (1 + noise(0.03))) : x)},
  {match: (name) => name === N.BASE_CHANNELS.CPU_USAGE_PCT,
    apply: (x, noise, isStress) => Math.max(0, Math.min(100, x + noise(isStress ? 2 : 4)))}, // ±2 stress / ±4 idle، [0,100]
  {match: (name) => name === N.BASE_CHANNELS.GPU_FPS,
    apply: (x, noise, isStress, phase) => ((phase === 3 && x > 0) ? Math.max(0, x + noise(1.5)) : x)}, // المرحلة 3 وحدها، 0 = unavailable
  {match: (name) => name === "gpu_temp_c", // تخطيط V1 — -1 = unavailable
    apply: (x, noise) => (x >= 0 ? x + noise(1.5) : x)},
];

// يشوّش عمود كل اسم له قاعدة. يُرجع ما شوّشه وما لم يُشوِّشه (القاعدة 25: «الطبقة تُعلن ما طلبته ولم تجده»).
function applySampleNoise(variation, noise) {
  const ts = variation.timeSeries;
  const samples = ts?.samples;
  if (!Array.isArray(samples)) return {noisedChannels: [], notNoisedChannels: [], state: "NO_SAMPLES"};
  const layout = resolveLayout(ts.variables, samples);
  if (layout.columnCount === 0) return {noisedChannels: [], notNoisedChannels: [], state: "NO_VARIABLES"};
  const plan = layout.columns.filter((c) => c.name !== null)
      .map((c) => ({index: c.index, name: c.name, rule: NOISE_RULES.find((r) => r.match(c.name)) || null}));
  const active = plan.filter((p) => p.rule !== null);
  for (let i = 0; i < samples.length; i++) {
    const phase = getPhaseForSampleIdx(i);
    const v = samples[i]?.v;
    if (!Array.isArray(v)) continue;
    const isStress = (phase === 3 || phase === 4);
    for (const p of active) {
      if (typeof v[p.index] !== "number") continue;
      v[p.index] = p.rule.apply(v[p.index], noise, isStress, phase);
    }
  }
  return {
    noisedChannels: active.map((p) => p.name),
    notNoisedChannels: plan.filter((p) => p.rule === null).map((p) => p.name),
    state: "NOISED",
  };
}

// Recompute timeSeries.stats from modified samples — بالاسم. إحصاء عموده غير موجود **يبقى غائباً** (لا قيمة من عمود آخر).
// Note: thermalHeadroom* receive direct ±5% noise (cannot be derived from samples)
function recomputeStats(variation, noise) {
  const ts = variation.timeSeries;
  if (!ts || !Array.isArray(ts.samples) || ts.samples.length === 0) return;
  if (!ts.stats) ts.stats = {};
  const stats = ts.stats;
  const samples = ts.samples;
  const layout = resolveLayout(ts.variables, samples);
  const N_SAMPLES = samples.length;
  const sampledEverySec = ts.sampledEvery || 1;
  // أعمدة بأسمائها؛ null = العمود غير موجود في هذا التخطيط.
  const col = (name) => columnIndex(layout, name);
  const numeric = (idx) => (idx === null ? [] : samples.map((s) => s.v?.[idx])
      .filter((x) => typeof x === "number" && !isNaN(x)));

  // Temperature — cpu_temp_c (تخطيط V1)؛ skip -1
  const tempIdx = col("cpu_temp_c");
  const tempPairs = tempIdx === null ? [] : samples.map((s, i) => ({i: i, t: s.v?.[tempIdx]}))
      .filter((x) => typeof x.t === "number" && x.t >= 0);
  if (tempPairs.length > 0) {
    let peakIdx = tempPairs[0].i;
    let peakT = tempPairs[0].t;
    for (const x of tempPairs) {
      if (x.t > peakT) {
        peakT = x.t;
        peakIdx = x.i;
      }
    }
    stats.tempStart = tempPairs[0].t;
    stats.tempEnd = tempPairs[tempPairs.length - 1].t;
    stats.tempPeak = peakT;
    stats.tempPeakMinute = (peakIdx * sampledEverySec) / 60;
    const minToPeak = stats.tempPeakMinute || 0.001;
    stats.tempRiseRate = (peakT - stats.tempStart) / minToPeak;
    const cooldownMin = ((N_SAMPLES - 1 - peakIdx) * sampledEverySec) / 60;
    stats.tempCoolRate = cooldownMin > 0 ?
        (peakT - stats.tempEnd) / cooldownMin : 0;
  }

  // CPU usage
  const cpuU = numeric(col(N.BASE_CHANNELS.CPU_USAGE_PCT)).filter((x) => x >= 0 && x <= 100);
  if (cpuU.length > 0) {
    stats.cpuUsageAvg = cpuU.reduce((a, b) => a + b, 0) / cpuU.length;
    stats.cpuUsagePeak = Math.max.apply(null, cpuU);
  }

  // GPU FPS — skip 0 = unavailable
  const fps = numeric(col(N.BASE_CHANNELS.GPU_FPS)).filter((x) => x > 0);
  if (fps.length > 0) {
    stats.gpuFpsAvg = fps.reduce((a, b) => a + b, 0) / fps.length;
    stats.gpuFpsMin = Math.min.apply(null, fps);
  }

  // Throttle + RSD من تردّد المعالج الكبير خلال المرحلة 3 (العيّنات 90..480): cpu_freq_big_khz (V1) أو cpu_freq_max_khz (launch)
  const freqIdx = [col("cpu_freq_big_khz"), col(N.BASE_CHANNELS.CPU_FREQ_MAX_KHZ)].find((x) => x !== null);
  const phase3Freqs = [];
  if (freqIdx !== undefined) {
    for (let i = 90; i < Math.min(480, N_SAMPLES); i++) {
      const f = samples[i]?.v?.[freqIdx];
      if (typeof f === "number" && f > 0) phase3Freqs.push(f);
    }
  }
  if (phase3Freqs.length > 0) {
    const fMax = Math.max.apply(null, phase3Freqs);
    const fMin = Math.min.apply(null, phase3Freqs);
    stats.throttlePercent = fMax > 0 ? ((fMax - fMin) / fMax) * 100 : 0;
    const mean = phase3Freqs.reduce((a, b) => a + b, 0) / phase3Freqs.length;
    let varSum = 0;
    for (const f of phase3Freqs) varSum += (f - mean) * (f - mean);
    const stdDev = Math.sqrt(varSum / phase3Freqs.length);
    stats.performanceRSD = mean > 0 ? (stdDev / mean) * 100 : 0;
  }

  // Battery level — unchanged in samples but recompute for consistency
  const battVals = numeric(col(N.BASE_CHANNELS.BATTERY_LEVEL_PCT));
  if (battVals.length > 0) {
    stats.batteryStart = battVals[0];
    stats.batteryEnd = battVals[battVals.length - 1];
    stats.batteryDrop = battVals[0] - battVals[battVals.length - 1];
    const totalMin = ((N_SAMPLES - 1) * sampledEverySec) / 60;
    stats.drainRate = totalMin > 0 ? stats.batteryDrop / totalMin : 0;
  }

  // Voltage start/end
  const voltVals = numeric(col(N.BASE_CHANNELS.BATTERY_VOLTAGE_MV));
  if (voltVals.length > 0) {
    stats.voltageStart = voltVals[0];
    stats.voltageEnd = voltVals[voltVals.length - 1];
  }

  // Current average
  const currVals = numeric(col(N.BASE_CHANNELS.BATTERY_CURRENT_UA));
  if (currVals.length > 0) {
    stats.currentAvg = currVals.reduce((a, b) => a + b, 0) / currVals.length;
  }

  // Thermal headroom — direct ±5% noise (no formula in backend to recompute)
  if (typeof stats.thermalHeadroomAvg === "number") {
    stats.thermalHeadroomAvg = stats.thermalHeadroomAvg * (1 + noise(0.05));
  }
  if (typeof stats.thermalHeadroomPeak === "number") {
    stats.thermalHeadroomPeak = stats.thermalHeadroomPeak * (1 + noise(0.05));
  }
}

// Apply noise to functionalResults numeric values (rawValue field).
// Status strings remain unchanged per spec ("text values stay as-is").
function applyFunctionalNoise(variation, noise) {
  const fr = variation.functionalResults;
  if (!Array.isArray(fr)) return;
  const stats = variation.timeSeries?.stats || {};
  const rules = {
    "C-04": (v) => v * (1 + noise(0.02)), // CPU MFLOPS ±2%
    "C-06": () => stats.throttlePercent, // recomputed
    "C-07": () => stats.performanceRSD, // recomputed
    "G-03": (v) => v * (1 + noise(0.03)), // FPS Drop ±3%
    "G-04": (v) => v * (1 + noise(0.03)), // GPU throttle ±3%
    "G-05": (v) => v + noise(2), // Min FPS ±2 fps
    "S-03": (v) => v * (1 + noise(0.05)), // Read speed ±5%
    "S-04": (v) => v * (1 + noise(0.05)), // Write speed ±5%
    "S-05": (v) => v * (1 + noise(0.03)), // Read IOPS ±3%
    "S-06": (v) => v * (1 + noise(0.03)), // Write IOPS ±3%
    "B-03": () => stats.tempStart, // recomputed
    "B-05": () => stats.currentAvg, // recomputed
    "B-06": () => stats.drainRate, // recomputed
    "T-01": () => stats.tempPeak, // recomputed
    "T-02": () => stats.tempRiseRate, // recomputed
    "T-03": () => stats.tempCoolRate, // recomputed
  };
  for (const test of fr) {
    const rule = rules[test.testId];
    if (!rule) continue;
    const oldVal = parseFloat(test.rawValue);
    if (isNaN(oldVal)) continue;
    const newVal = rule(oldVal);
    if (typeof newVal === "number" && !isNaN(newVal)) {
      test.rawValue = newVal.toFixed(2);
    }
  }
}

// Valid noise levels:
//   "none"   → identity clone (refactor sanity check, no noise applied)
//   "low"    → 0.5× medium magnitudes
//   "medium" → baseline magnitudes per spec
//   "high"   → 2.0× medium magnitudes
const VALID_NOISE_LEVELS = ["none", "low", "medium", "high"];

// Generate one deterministic variation
function generateVariation(rawFingerprint, noiseLevel, seedString) {
  // "none" → return an identical deep clone, no noise, no recompute.
  // Used by callers to verify the refactor itself is byte-for-byte consistent.
  if (noiseLevel === "none") {
    return JSON.parse(JSON.stringify(rawFingerprint));
  }
  const seed = fnv1a32(seedString);
  const rng = mulberry32(seed);
  const scale = noiseLevel === "low" ? 0.5 :
                noiseLevel === "high" ? 2.0 : 1.0;
  const noise = (mag) => (rng() * 2 - 1) * mag * scale;

  const variation = JSON.parse(JSON.stringify(rawFingerprint));
  applySampleNoise(variation, noise);
  recomputeStats(variation, noise);
  applyFunctionalNoise(variation, noise);
  return variation;
}

// Round to N decimal places (returns null for non-numeric)
function roundN(n, p) {
  if (typeof n !== "number" || isNaN(n)) return null;
  const f = Math.pow(10, p || 2);
  return Math.round(n * f) / f;
}

// Compact summary of key input metrics (for output transparency)
function summarizeVariation(variation) {
  const s = variation.timeSeries?.stats || {};
  return {
    tempPeak: roundN(s.tempPeak, 2),
    throttlePercent: roundN(s.throttlePercent, 2),
    drainRate: roundN(s.drainRate, 3),
    gpuFpsAvg: roundN(s.gpuFpsAvg, 2),
  };
}

exports.runConsistencyTest = onCall(
    {
      timeoutSeconds: 540,
      memory: "1GiB",
      secrets: [geminiKey, deepseekKey],
    },
    async (request) => {
      requireAdmin(request);

      const data = request.data || {};
      const rawFingerprint = data.rawFingerprint;
      const noiseLevel = data.noiseLevel || "medium";
      const language = data.language || "ar";
      const testLabel = data.testLabel || "";
      const seedScanId = data.scanId || `consistency_${Date.now()}`;
      const baselineGrade = data.baselineGrade || null;
      const baselineScore = (typeof data.baselineScore === "number") ?
          data.baselineScore : null;

      if (!rawFingerprint || typeof rawFingerprint !== "object") {
        throw new HttpsError("invalid-argument", "rawFingerprint مطلوب");
      }
      if (!VALID_NOISE_LEVELS.includes(noiseLevel)) {
        throw new HttpsError("invalid-argument",
            `noiseLevel يجب أن يكون أحد: ${VALID_NOISE_LEVELS.join("/")}`);
      }
      const requested = parseInt(data.iterations, 10);
      const totalIterations = Math.min(15,
          Math.max(1, isNaN(requested) ? 10 : requested));

      // أمر مستخدم 2026-09-24 +03 (الجولة الثالثة، القرار ٧٥ البند ٤ —
      // اكتشاف المدقّق بالأداة): "وقت الخادم عند بدء الدالّة، يُكتب مرّة
      // ويُمرَّر إلى categoryStates." نفس startedAt (كانت موجودة أصلاً،
      // قبل أي await، لقياس durationMs فقط) تُستعمَل الآن أيضاً كـ
      // analyzedAtMs — مصدر واحد لا Date.now() ثانية (القاعدة 24). قبل
      // الالتزام 1726948 كانت PATCH_AGE تُحسَب من Date.now() ضمنياً داخل
      // categoryStates.js نفسها (مطابقاً فعلياً لهذه القيمة، فارق مللي
      // ثوانٍ لا يغيّر شهراً واحداً)؛ بعده صارت computeGates تتطلّب
      // analyzedAtMs صريحة ولا تسقط على Date.now() أبداً — هذا الاستدعاء
      // لم يُحدَّث حينها فسقطت PATCH_AGE إلى UNKNOWN صامتة (لا FIRED/NOT_FIRED
      // كإنتاج حقيقي لنفس البصمة اليوم) — عطب غير مقصود، لا تصميم: اختبار
      // الاتّساق يُفترض أن يقيس ما ستنتجه بصمة (مُشوَّشة) اليوم فعلاً، ونفس
      // القيمة (استدعاء واحد، لا Date.now() لكل تكرار) لكل التكرارات — نفس
      // مبدأ "لحظة واحدة لكل الدفعة" الذي بُنيت عليه startedAt أصلاً.
      const startedAt = Date.now();
      const analyzedAtMs = startedAt;
      const results = new Array(totalIterations);

      // Run in batches of 3 (parallel within batch, sequential across batches)
      const batchSize = 3;
      for (let i = 0; i < totalIterations; i += batchSize) {
        const batchPromises = [];
        for (let j = 0; j < batchSize && (i + j) < totalIterations; j++) {
          const iterIdx = i + j;
          batchPromises.push((async () => {
            const iterStart = Date.now();
            try {
              const variation = generateVariation(
                  rawFingerprint, noiseLevel, `${seedScanId}_${iterIdx}`);
              const analysis = await runAnalysisInternal({
                fingerprint: variation,
                language,
                deepseekKey: deepseekKey.value(),
                geminiKey: geminiKey.value(),
                // القرار ٧٥ البند ٤ — نفس analyzedAtMs (=startedAt) لكل
                // التكرارات، لا قيمة منفصلة لكل واحد (راجع تعليق أعلى الدالّة).
                analyzedAtMs,
              });
              const ar = analysis.aiResult; // buildDisplayShapeV7.display (V7) — راجع رأس الملفّ
              const auditR = analysis.aiResultAudit || {};
              const regeneration = auditR.regeneration || {};
              // أمر مستخدم 2026-09-23 +03 (أمر التبديل، بعد A125): "الفشل من
              // narrativeIncomplete لا من نصّ فارغ، والحرف من overall. يقيس ما
              // بقي متغيّراً — التعديلات والسرد — لأن الحرف الحتمي لا يتغيّر
              // بطبيعته." aiResult.narrativeIncomplete (V7) بدل فحص ar.verdict
              // الفارغ (V6 القديم — overall.letter حتمي، لا يفشل بفشل النموذج).
              // aiFailed (فشل صلب حقيقي، كلا المزوّدَين) يبقى استثناءً منفصلاً.
              const aiFailed = !!analysis.aiFailed;
              const narrativeIncomplete = !aiFailed && !!(ar && ar.narrativeIncomplete);
              return {
                iteration: iterIdx,
                success: !aiFailed && !narrativeIncomplete,
                failureReason: aiFailed ?
                    (analysis.aiFallbackReason || "hard_ai_failure") :
                    (narrativeIncomplete ? "narrative_incomplete" : null),
                durationMs: Date.now() - iterStart,
                input_summary: summarizeVariation(variation),
                output: {
                  // letter — من overall الحتمي (لا من نصّ النموذج). V6 القديمة
                  // (grade/score/category_scores/flags) لا وجود لها في V7 —
                  // null صريح لا 0 (القاعدة 22: الغياب لا يُقرأ قياساً).
                  letter: (ar && ar.overall) ? ar.overall.letter : null,
                  grade: null, // مُقيَّد V6 — راجع القاعدة 5، لا حقل مكافئ في V7
                  score: null, // مُقيَّد V6 — لا رقم جودة مكافئ في V7 (overall.coverage تغطية لا جودة)
                  category_scores: null, // مُقيَّد V6
                  flags: null, // مُقيَّد V6 — لا حقل flags في V7
                  narrativeIncomplete,
                  narrativeIncompleteFields: (ar && ar.narrativeIncompleteFields) || [],
                  // التعديلات — مقبولة ومرفوضة مع سبب كلٍّ منها (audit.adjustments،
                  // buildV7Payload.js applyV7Adjustments: {category, direction,
                  // reason, applied, rejectedReason?}).
                  adjustments: Array.isArray(auditR.adjustments) ? auditR.adjustments.map((a) => ({
                    category: a.category, direction: a.direction,
                    applied: !!a.applied, reason: a.reason || null,
                    rejectedReason: a.rejectedReason || null,
                  })) : [],
                  guardFinalOk: (typeof analysis.v5Metrics?.v7GuardOk === "boolean") ?
                      analysis.v5Metrics.v7GuardOk : null,
                  attempts: (typeof regeneration.attempts === "number") ? regeneration.attempts : null,
                  verdict: (ar && ar.narrative) ? ar.narrative.verdict : null,
                  issues_count: (ar && Array.isArray(ar.issues)) ? ar.issues.length : 0,
                  issues_titles: (ar && Array.isArray(ar.issues) ? ar.issues : [])
                      .map((x) => x.title || "")
                      .slice(0, 5),
                  aiModel: analysis.aiModel,
                  aiDurationMs: analysis.aiDurationMs,
                },
              };
            } catch (err) {
              return {
                iteration: iterIdx,
                success: false,
                failureReason: "exception",
                durationMs: Date.now() - iterStart,
                error: failureTextOnce(err),
              };
            }
          })());
        }
        const batchResults = await Promise.all(batchPromises);
        for (const r of batchResults) results[r.iteration] = r;
      }

      // Build summary — أمر مستخدم 2026-09-23 +03 (أمر التبديل، بعد A125):
      // "يقيس ما بقي متغيّراً — التعديلات والسرد — لأن الحرف الحتمي لا
      // يتغيّر بطبيعته." letters يحلّ محلّ grades (overall.letter الحتمي)؛
      // scores/flags مُقيَّدان V6 (null صريح، القاعدة 22 — لا 0 يُقرأ قياساً).
      const successful = results.filter((r) => r.success);
      const letters = {A: 0, B: 0, C: 0, D: 0};
      let acceptedAdjustmentsTotal = 0;
      let rejectedAdjustmentsTotal = 0;
      const rejectedReasonCounts = {};
      let narrativeIncompleteCount = 0;
      for (const r of results) {
        const l = r.output && r.output.letter;
        if (l && letters[l] !== undefined) letters[l]++;
        if (r.output && r.output.narrativeIncomplete) narrativeIncompleteCount++;
        for (const a of (r.output && r.output.adjustments) || []) {
          if (a.applied) {
            acceptedAdjustmentsTotal++;
          } else {
            rejectedAdjustmentsTotal++;
            const reason = a.rejectedReason || "UNKNOWN";
            rejectedReasonCounts[reason] = (rejectedReasonCounts[reason] || 0) + 1;
          }
        }
      }
      // letters تُحسَب على كل التكرارات (حتى narrativeIncomplete) — الحرف
      // الحتمي حاضر بصرف النظر عن حالة السرد (خلاف V6: هناك grade كان
      // النموذج نفسه، فحساب توزيعه على "الناجحة" وحدها كان له معنى؛ هنا
      // letter لا يفشل، فحسابه على الكلّ أصدق تمثيلاً لاتّساق الحساب
      // الحتمي نفسه عبر التكرارات، لا لاتّساق النموذج).
      const sortedLetters = Object.entries(letters).sort((a, b) => b[1] - a[1]);
      const mostCommonLetter = (sortedLetters[0] && sortedLetters[0][1] > 0) ?
          sortedLetters[0][0] : null;
      const letterConsistencyPct = (results.length > 0 && mostCommonLetter) ?
          Math.round((letters[mostCommonLetter] / results.length) * 100) : 0;
      // Failure breakdown by reason — for transparency about silent failures
      const failureBreakdown = {};
      for (const r of results) {
        if (!r.success && r.failureReason) {
          failureBreakdown[r.failureReason] =
              (failureBreakdown[r.failureReason] || 0) + 1;
        }
      }

      const output = {
        testLabel: testLabel || `consistency_${new Date().toISOString()}`,
        totalIterations: totalIterations,
        successCount: successful.length,
        failureCount: results.filter((r) => !r.success).length,
        noiseLevel: noiseLevel,
        durationMs: Date.now() - startedAt,
        baseline: {
          deviceModel: rawFingerprint.device?.model || "Unknown",
          originalGrade: baselineGrade,
          originalScore: baselineScore,
        },
        iterations: results,
        summary: {
          letters: letters,
          letter_consistency_pct: letterConsistencyPct,
          most_common_letter: mostCommonLetter,
          // مُقيَّدة V6 — لا حقل مكافئ في V7 (القاعدة 22: null صريح لا 0).
          score_min: null,
          score_max: null,
          score_avg: null,
          score_stddev: null,
          narrative_incomplete_count: narrativeIncompleteCount,
          narrative_incomplete_pct: results.length > 0 ?
              Math.round((narrativeIncompleteCount / results.length) * 100) : 0,
          adjustments_accepted_total: acceptedAdjustmentsTotal,
          adjustments_rejected_total: rejectedAdjustmentsTotal,
          adjustments_rejected_reasons: rejectedReasonCounts,
          failure_breakdown: failureBreakdown,
        },
      };

      // Persist to Firestore
      const docRef = await db.collection("consistencyTests").add({
        testLabel: output.testLabel,
        totalIterations: output.totalIterations,
        successCount: output.successCount,
        failureCount: output.failureCount,
        noiseLevel: output.noiseLevel,
        durationMs: output.durationMs,
        baseline: output.baseline,
        iterations: output.iterations,
        summary: output.summary,
        createdBy: request.auth.token.email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {testId: docRef.id, ...output};
    },
);

// مُصدَّرة للاختبار المباشر بلا محاكي (الدفعة ٤): دوال خالصة تعمل على نسخة fingerprint، لا اعتماد على db/req.
exports._internal = {generateVariation, applySampleNoise, recomputeStats, NOISE_RULES};
