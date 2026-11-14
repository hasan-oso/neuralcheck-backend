'use strict';

// chartToText.js — Convert numeric series + optional phase boundaries
// into compact text descriptors for AI consumption.
//
// Ported verbatim from neuralcheck-lab/v5_prototype/tools/_chart_to_text.js
// (no external deps; self-contained). Output is fed to the AI alongside the
// footer as the visual distillation of per-channel trajectories.
//
// Output:
//   {
//     sparkline: "▇▆▅▄▃▃▂▂▃▄..."   // 8-level Unicode block chars
//     stats:     { mean, min, max, std, range }
//     trend:     "RISING" | "DECLINING" | "STABLE" | "OSCILLATING" | "MIXED"
//     shape:     "CLIFF" | "GRADUAL" | "FLAT" | "RECOVERY" | "VOLATILE"
//     events:    [ { type, phase, at_relative_ts_ms, from, to, delta_pct }, ... ]
//     phase_segments: { "0": {sparkline, mean, trend}, ... }   // optional
//   }
//
// The descriptors are intentionally NOT classifications. They describe the
// data; the AI does the diagnosis.

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function isFiniteNum(x) { return typeof x === 'number' && Number.isFinite(x); }

function basicStats(values) {
  if (!values || values.length === 0) return {mean: null, min: null, max: null, std: null, range: 0, n: 0};
  let sum = 0; let mn = Infinity; let mx = -Infinity;
  for (const v of values) { sum += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const n = values.length;
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) * (v - mean);
  const std = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  return {mean, min: mn, max: mx, std, range: mx - mn, n};
}

// Downsample to at most `targetLen` points by chunked averaging.
function downsample(values, targetLen) {
  if (!values || values.length === 0) return [];
  if (values.length <= targetLen) return values.slice();
  const out = [];
  const chunkSize = values.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const start = Math.floor(i * chunkSize);
    const end = Math.floor((i + 1) * chunkSize);
    let sum = 0; let cnt = 0;
    for (let j = start; j < end && j < values.length; j++) { sum += values[j]; cnt++; }
    out.push(cnt > 0 ? sum / cnt : values[start]);
  }
  return out;
}

function makeSparkline(values, targetLen) {
  if (!values || values.length === 0) return '';
  const ds = downsample(values, targetLen || 25);
  const s = basicStats(ds);
  if (s.range === 0) return BLOCKS[0].repeat(ds.length);
  let out = '';
  for (const v of ds) {
    let level = Math.floor(((v - s.min) / s.range) * 7.999);
    if (level < 0) level = 0;
    if (level > 7) level = 7;
    out += BLOCKS[level];
  }
  return out;
}

// Linear-fit slope (per sample) using least squares.
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i];
    sumXY += i * values[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function detectTrend(values, stats) {
  if (!values || values.length < 3) return 'STABLE';
  if (stats.range === 0) return 'STABLE';

  // Sign-change rate of first derivative
  let signChanges = 0; let lastSign = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const sg = d > 0 ? 1 : (d < 0 ? -1 : 0);
    if (sg !== 0 && lastSign !== 0 && sg !== lastSign) signChanges++;
    if (sg !== 0) lastSign = sg;
  }
  const oscillationRatio = signChanges / Math.max(1, values.length - 2);

  const slope = linearSlope(values);
  const normSlope = slope / (stats.range || 1);
  const stdRatio = stats.std / (stats.range || 1);

  if (oscillationRatio > 0.30 && Math.abs(normSlope) < 0.02) return 'OSCILLATING';
  if (stdRatio < 0.05 && Math.abs(normSlope) < 0.02) return 'STABLE';
  if (normSlope > 0.02) return 'RISING';
  if (normSlope < -0.02) return 'DECLINING';
  return 'MIXED';
}

// Monotonicity ratio: fraction of consecutive deltas that share the dominant sign.
function monotonicityRatio(values) {
  if (values.length < 2) return 0;
  let pos = 0; let neg = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) pos++; else if (d < 0) neg++;
  }
  const tot = pos + neg;
  if (tot === 0) return 0;
  return Math.max(pos, neg) / tot;
}

function detectShape(values, stats, events, totalCliffCount) {
  if (!values || values.length < 3) return 'FLAT';
  const n = values.length;
  const cliffCount = typeof totalCliffCount === 'number' ?
      totalCliffCount :
      (events ? events.filter((e) => e.type === 'cliff').length : 0);

  const tinyRange = Math.abs(stats.mean) > 0.01 && (stats.range / Math.abs(stats.mean)) < 0.01;
  if (tinyRange) return 'FLAT';

  // RECOVERY check (preferred over CLIFF when both fit)
  if (n >= 9) {
    const t1 = Math.floor(n / 3);
    const t2 = Math.floor((2 * n) / 3);
    const slopeEarly = linearSlope(values.slice(0, t1));
    const slopeLate = linearSlope(values.slice(t2));
    const minIdx = values.indexOf(stats.min);
    const minInMiddle = minIdx >= t1 * 0.7 && minIdx <= t2 * 1.1;
    const earlyDown = slopeEarly < -0.005 * stats.range;
    const lateUp = slopeLate > 0.005 * stats.range;
    if (minInMiddle && earlyDown && lateUp) return 'RECOVERY';
  }

  if (cliffCount > 0 && cliffCount / Math.max(1, n - 1) > 0.30) return 'VOLATILE';
  if (cliffCount >= 1) return 'CLIFF';

  const mono = monotonicityRatio(values);
  if (mono >= 0.60) return 'GRADUAL';

  const cvFromMean = Math.abs(stats.mean) > 0.01 ? Math.abs(stats.std / stats.mean) : 0;
  const cvFromRange = stats.range > 0 ? stats.std / stats.range : 0;
  if (cvFromMean > 0.15 || cvFromRange > 0.25) return 'VOLATILE';

  return 'GRADUAL';
}

function detectCliffs(values, ts, phases, stats, thresholdPct) {
  const out = [];
  if (!values || values.length < 2 || stats.range === 0) return out;
  const rangeThresh = thresholdPct * stats.range;
  const meanThresh = 0.05 * Math.abs(stats.mean || 0);
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const absDelta = Math.abs(delta);
    const passes = meanThresh > 0 ?
        (absDelta > rangeThresh && absDelta > meanThresh) :
        absDelta > rangeThresh;
    if (passes) {
      const fromV = values[i - 1];
      const toV = values[i];
      const deltaPct = fromV !== 0 ? (delta / Math.abs(fromV)) * 100 : null;
      out.push({
        type: 'cliff',
        phase: phases ? phases[i] : null,
        at_relative_ts_ms: ts ? ts[i] - ts[0] : null,
        from: round3(fromV), to: round3(toV),
        delta_pct: deltaPct !== null ? Number(deltaPct.toFixed(1)) : null,
      });
    }
  }
  return out;
}

function round3(x) {
  if (!isFiniteNum(x)) return x;
  if (Math.abs(x) >= 100) return Number(x.toFixed(0));
  if (Math.abs(x) >= 10) return Number(x.toFixed(1));
  return Number(x.toFixed(3));
}

// Public: convert a single 1D series + optional metadata to text descriptors.
function chartToText(values, options) {
  const opts = options || {};
  if (!Array.isArray(values)) {
    return {error: 'values_not_array', stats: null, sparkline: '', trend: null, shape: null, events: []};
  }
  // Filter to finite values; keep aligned ts/phases.
  const cleanV = []; const cleanTs = []; const cleanPh = [];
  for (let i = 0; i < values.length; i++) {
    if (!isFiniteNum(values[i])) continue;
    cleanV.push(values[i]);
    if (Array.isArray(opts.ts)) cleanTs.push(opts.ts[i]);
    if (Array.isArray(opts.phases)) cleanPh.push(opts.phases[i]);
  }
  if (cleanV.length === 0) {
    return {error: 'no_finite_samples', stats: null, sparkline: '', trend: null, shape: null, events: []};
  }

  const stats = basicStats(cleanV);
  const sparklineLen = opts.sparkline_len || 25;
  const sparkline = makeSparkline(cleanV, sparklineLen);

  const cliffThresh = opts.cliff_threshold_pct || 0.15;
  const maxCliffs = opts.max_cliffs ?? 8;
  const allCliffs = detectCliffs(
      cleanV,
      cleanTs.length === cleanV.length ? cleanTs : null,
      cleanPh.length === cleanV.length ? cleanPh : null,
      stats,
      cliffThresh,
  );
  const cliffEvents = allCliffs
      .slice()
      .sort((a, b) => Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0))
      .slice(0, maxCliffs);
  const cliffStats = {total: allCliffs.length, kept: cliffEvents.length};

  // Min/max events
  const minIdx = cleanV.indexOf(stats.min);
  const maxIdx = cleanV.indexOf(stats.max);
  const events = cliffEvents.slice();
  if (minIdx >= 0) {
    events.push({
      type: 'minimum',
      phase: cleanPh.length === cleanV.length ? cleanPh[minIdx] : null,
      at_relative_ts_ms: cleanTs.length === cleanV.length && cleanTs.length > 0 ? cleanTs[minIdx] - cleanTs[0] : null,
      value: round3(stats.min),
    });
  }
  if (maxIdx >= 0 && maxIdx !== minIdx) {
    events.push({
      type: 'maximum',
      phase: cleanPh.length === cleanV.length ? cleanPh[maxIdx] : null,
      at_relative_ts_ms: cleanTs.length === cleanV.length && cleanTs.length > 0 ? cleanTs[maxIdx] - cleanTs[0] : null,
      value: round3(stats.max),
    });
  }

  const trend = detectTrend(cleanV, stats);
  const shape = detectShape(cleanV, stats, events, cliffStats.total);

  if (shape === 'RECOVERY' && minIdx >= 0) {
    events.push({
      type: 'recovery_pivot',
      phase: cleanPh.length === cleanV.length ? cleanPh[minIdx] : null,
      at_relative_ts_ms: cleanTs.length === cleanV.length && cleanTs.length > 0 ? cleanTs[minIdx] - cleanTs[0] : null,
      note: 'minimum_followed_by_recovery',
    });
  }

  // Phase segments
  let phase_segments;
  if (cleanPh.length === cleanV.length) {
    const phaseSet = opts.phase_segments_for || Array.from(new Set(cleanPh)).sort((a, b) => a - b);
    phase_segments = {};
    for (const pNum of phaseSet) {
      const sub = [];
      for (let i = 0; i < cleanV.length; i++) {
        if (cleanPh[i] === pNum) sub.push(cleanV[i]);
      }
      if (sub.length === 0) continue;
      const subStats = basicStats(sub);
      const subSpark = makeSparkline(sub, opts.phase_sparkline_len || 15);
      const subTrend = detectTrend(sub, subStats);
      phase_segments[String(pNum)] = {
        sparkline: subSpark,
        n: sub.length,
        mean: round3(subStats.mean),
        min: round3(subStats.min),
        max: round3(subStats.max),
        trend: subTrend,
      };
    }
  }

  // Phase-specific (zero-dominated) channel handling
  let zeroCount = 0;
  for (const v of cleanV) if (v === 0) zeroCount++;
  const isPhaseSpecific = cleanV.length > 0 && (zeroCount / cleanV.length) >= 0.60;

  let statsField;
  if (isPhaseSpecific) {
    const activeVals = [];
    const activePhases = new Set();
    for (let i = 0; i < cleanV.length; i++) {
      if (cleanV[i] > 0) {
        activeVals.push(cleanV[i]);
        if (cleanPh.length === cleanV.length) activePhases.add(cleanPh[i]);
      }
    }
    if (activeVals.length === 0) {
      statsField = {
        active_phases: [],
        active_phase_mean: 0,
        active_phase_max: 0,
        active_phase_min: 0,
        active_phase_std: 0,
        active_phase_n: 0,
        note: 'This channel has no non-zero samples in the visible range.',
      };
    } else {
      const aStats = basicStats(activeVals);
      const phasesList = Array.from(activePhases).sort((a, b) => a - b);
      statsField = {
        active_phases: phasesList,
        active_phase_mean: round3(aStats.mean),
        active_phase_max: round3(aStats.max),
        active_phase_min: round3(aStats.min),
        active_phase_std: round3(aStats.std),
        active_phase_n: aStats.n,
        note: 'This channel is active only in phase(s) [' + phasesList.join(', ') +
            ']. Zero values in other phases are by design — cite active_phase_max / active_phase_mean, NOT the full-series mean which is dragged down by structural zeros.',
      };
    }
  } else {
    statsField = {
      mean: round3(stats.mean),
      min: round3(stats.min),
      max: round3(stats.max),
      std: round3(stats.std),
      range: round3(stats.range),
      n: stats.n,
    };
  }

  return {
    sparkline,
    stats: statsField,
    trend,
    shape,
    events,
    cliff_count_total: cliffStats.total,
    phase_specific: isPhaseSpecific,
    phase_segments,
  };
}

function sparklineLegend() {
  return BLOCKS.join('') + ' = lowest → highest in the visible range';
}

module.exports = {
  chartToText,
  sparklineLegend,
  BLOCKS,
  basicStats,
  makeSparkline,
  detectTrend,
  detectShape,
  detectCliffs,
  downsample,
};
