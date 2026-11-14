'use strict';

// precompute.js — V5 backend precompute (Stage 1 of Phase 1.11).
//
// Generates a `computed_signals` payload from a fingerprint, replacing raw
// timeSeries.samples for the AI request. Pairs with systemPromptV5.
//
// Architecture: "pre-compute everything, single-shot AI". Two outputs:
//   - primitives: 16 (channel, phase) mean/max/min/std + samples_count +
//                 5 pre-computed Pearson correlation pairs.
//   - shapes:     7 chartToText shape descriptors (sparkline + trend + shape
//                 + events + phase_segments).
//
// IMPORTANT: This module reuses ONLY the math primitives from src/lab/
// (stats.js, stats2.js, extract.js, channels.js). It does NOT call any
// classifying feature helper from src/lab/layer1/features/ — those return
// {classification, confidence} fields that bake in lab opinions; the AI
// should form its own diagnosis. We surface raw numbers + visual shapes
// only.
//
// Output schema_version: 'v5_precomputed.v1'.

const stats = require('../lab/layer1/utils/stats');
const stats2 = require('../lab/layer2/utils/stats2');
const extract = require('../lab/layer1/utils/extract');
const {CH, PHASE} = require('../lab/layer1/utils/channels');
const {chartToText} = require('./chartToText');

// ────────────────────────────────────────────────────────────────────────
// Channel resolution (canonical name → CH index, V5 schema).
// `cpu_freq_max_khz` is aliased to CH.CPU_FREQ_BIG because the backend
// time-series uses the big cluster freq as the "max" signal.
// ────────────────────────────────────────────────────────────────────────
const CHANNEL_INDEX = {
  battery_temp_c: CH.BATT_TEMP,
  battery_voltage_mv: CH.BATT_VOLT,
  battery_current_ua: CH.BATT_CURRENT,
  cpu_usage_pct: CH.CPU_USAGE,
  package_power_mw: CH.PACKAGE_POWER_MW,
  storage_throughput_mbps: CH.STORAGE_THROUGHPUT_MBPS,
  memory_bandwidth_mbps: CH.MEMORY_BANDWIDTH_MBPS,
  gpu_fps: CH.GPU_FPS,
  cpu_freq_big_khz: CH.CPU_FREQ_BIG,
  cpu_freq_max_khz: CH.CPU_FREQ_BIG,
};

// Primitive grid: 16 (channel, phase) pairs the AI cares about. Picked to
// surface phase-conditioned behavior the footer doesn't aggregate.
const PRIMITIVE_GRID = [
  ['cpu_freq_max_khz', 3], ['cpu_freq_max_khz', 5],
  ['cpu_freq_max_khz', 6], ['cpu_freq_max_khz', 7],
  ['battery_temp_c', 3], ['battery_temp_c', 5], ['battery_temp_c', 6],
  ['package_power_mw', 3], ['package_power_mw', 5], ['package_power_mw', 6],
  ['gpu_fps', 4], ['gpu_fps', 5],
  ['cpu_usage_pct', 3], ['cpu_usage_pct', 5],
  ['memory_bandwidth_mbps', 2],
  ['storage_throughput_mbps', 1],
];

const CORRELATION_PAIRS = [
  {a: 'cpu_freq_max_khz', b: 'battery_temp_c', phase: 3},
  {a: 'cpu_freq_max_khz', b: 'battery_temp_c', phase: 5},
  {a: 'cpu_freq_max_khz', b: 'package_power_mw', phase: 3},
  {a: 'cpu_usage_pct', b: 'package_power_mw', phase: 3},
  {a: 'battery_voltage_mv', b: 'battery_current_ua', phase: 6},
];

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

// Accept both Storage-flat ({samples, footer, ...}) and Firestore-wrapped
// ({timeSeries:{samples,...}, rawFingerprint:{...}}) shapes.
function getSamples(fingerprint) {
  if (!fingerprint || typeof fingerprint !== 'object') return [];
  if (Array.isArray(fingerprint.samples)) return fingerprint.samples;
  if (fingerprint.timeSeries && Array.isArray(fingerprint.timeSeries.samples)) {
    return fingerprint.timeSeries.samples;
  }
  return [];
}

// Values for one channel in one phase (numeric, finite only).
function channelInPhaseValues(samples, channelName, phase) {
  const idx = CHANNEL_INDEX[channelName];
  if (typeof idx !== 'number') return [];
  const inPhase = extract.samplesInPhase(samples, phase);
  return extract.channelValues(inPhase, idx);
}

// Aligned (ts, value, phase) streams for chartToText.
// Filters non-finite values; preserves alignment across the three arrays.
function readChannelStream(samples, channelName, phaseFilter) {
  const idx = CHANNEL_INDEX[channelName];
  if (typeof idx !== 'number') return {ts: [], values: [], phases: []};
  const ts = []; const values = []; const phases = [];
  for (const s of samples) {
    if (!s || !Array.isArray(s.v)) continue;
    if (Array.isArray(phaseFilter) && !phaseFilter.includes(s.phase)) continue;
    const v = s.v[idx];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    let tsVal = null;
    if (typeof s.ts === 'number') tsVal = s.ts;
    else if (typeof s.v[CH.TS_MS] === 'number') tsVal = s.v[CH.TS_MS];
    ts.push(tsVal);
    values.push(v);
    phases.push(s.phase);
  }
  return {ts, values, phases};
}

// ────────────────────────────────────────────────────────────────────────
// Main entry
// ────────────────────────────────────────────────────────────────────────

function precompute(fingerprint) {
  const errors = [];
  const samples = getSamples(fingerprint);

  // 1. Primitives: mean / max / min / std grid (16 entries each).
  const primitives = {
    mean: {}, max: {}, min: {}, std: {},
    samples_count: {},
    correlation: [],
  };

  for (const [channel, phase] of PRIMITIVE_GRID) {
    const key = channel + '/' + phase;
    try {
      const vals = channelInPhaseValues(samples, channel, phase);
      primitives.mean[key] = vals.length > 0 ? stats.mean(vals) : null;
      primitives.max[key] = vals.length > 0 ? stats.max(vals) : null;
      primitives.min[key] = vals.length > 0 ? stats.min(vals) : null;
      primitives.std[key] = vals.length > 1 ? stats.std(vals) : null;
    } catch (e) {
      errors.push('primitives(' + key + '): ' + e.message);
      primitives.mean[key] = null;
      primitives.max[key] = null;
      primitives.min[key] = null;
      primitives.std[key] = null;
    }
  }

  for (let p = 0; p <= 7; p++) {
    primitives.samples_count[String(p)] = extract.samplesInPhase(samples, p).length;
  }

  // 2. Correlations: Pearson r on aligned (channel_a, channel_b) within
  //    one phase. Both channels go through the same phase filter so the
  //    arrays are sample-index-aligned by construction.
  for (const pair of CORRELATION_PAIRS) {
    try {
      const idxA = CHANNEL_INDEX[pair.a];
      const idxB = CHANNEL_INDEX[pair.b];
      if (typeof idxA !== 'number' || typeof idxB !== 'number') {
        primitives.correlation.push({
          a: pair.a, b: pair.b, phase: pair.phase, r: null, samples_used: 0,
          computation_status: 'ERROR', reason: 'unknown_channel',
        });
        continue;
      }
      const inPhase = extract.samplesInPhase(samples, pair.phase);
      const va = []; const vb = [];
      for (const s of inPhase) {
        if (!s || !Array.isArray(s.v)) continue;
        const a = s.v[idxA]; const b = s.v[idxB];
        if (typeof a !== 'number' || !Number.isFinite(a)) continue;
        if (typeof b !== 'number' || !Number.isFinite(b)) continue;
        va.push(a); vb.push(b);
      }
      let r = null;
      let reason = null;
      if (va.length < 3) {
        reason = 'fewer_than_3_samples';
      } else {
        r = stats2.pearson(va, vb);
        if (r === null) reason = 'zero_std_in_one_channel';
      }
      primitives.correlation.push({
        a: pair.a, b: pair.b, phase: pair.phase,
        r: typeof r === 'number' ? r : null,
        samples_used: va.length,
        computation_status: typeof r === 'number' ? 'OK' : 'INSUFFICIENT_DATA',
        reason,
      });
    } catch (e) {
      errors.push('correlation(' + pair.a + ',' + pair.b + ',' + pair.phase + '): ' + e.message);
      primitives.correlation.push({
        a: pair.a, b: pair.b, phase: pair.phase,
        r: null, samples_used: 0,
        computation_status: 'ERROR', reason: e.message,
      });
    }
  }

  // 3. Shapes: chartToText descriptors for 7 key trajectories.
  const shapes = {};

  // cpu_freq_response — full scan
  try {
    const stream = readChannelStream(samples, 'cpu_freq_max_khz');
    if (stream.values.length === 0) {
      shapes.cpu_freq_response = {error: 'no_finite_samples'};
    } else {
      const sig = chartToText(stream.values, {
        ts: stream.ts, phases: stream.phases,
        sparkline_len: 30,
        phase_segments_for: [0, 1, 2, 3, 4, 5, 6, 7],
        phase_sparkline_len: 12,
      });
      sig.unit = 'kHz';
      sig.note = 'CPU frequency across the entire 8-phase scan; ' +
          'sparkline follows phase order INIT→STORAGE→MEMORY→CPU→GPU→' +
          'COMBINED→BURST→COOLDOWN.';
      shapes.cpu_freq_response = sig;
    }
  } catch (e) {
    errors.push('shapes.cpu_freq_response: ' + e.message);
    shapes.cpu_freq_response = {error: e.message};
  }

  // thermal_progression — battery_temp_c (silicon temp is footer-only)
  try {
    const stream = readChannelStream(samples, 'battery_temp_c');
    if (stream.values.length === 0) {
      shapes.thermal_progression = {error: 'no_finite_samples'};
    } else {
      const sig = chartToText(stream.values, {
        ts: stream.ts, phases: stream.phases,
        sparkline_len: 30,
        phase_segments_for: [0, 1, 2, 3, 4, 5, 6, 7],
        phase_sparkline_len: 10,
      });
      sig.unit = '°C';
      sig.channel = 'battery_temp_c';
      sig.note = 'battery_temp_c only — thermal_headroom and thermal_status ' +
          'are footer scalars (not per-sample streams). See footer.' +
          'thermalHeadroomAvg / thermalHeadroomPeak / thermalStatusMax for ' +
          'the system-level signals.';
      shapes.thermal_progression = sig;
    }
  } catch (e) {
    errors.push('shapes.thermal_progression: ' + e.message);
    shapes.thermal_progression = {error: e.message};
  }

  // battery_under_load — voltage + current dual-channel in BURST phase
  try {
    const sV = readChannelStream(samples, 'battery_voltage_mv', [PHASE.BURST]);
    const sI = readChannelStream(samples, 'battery_current_ua', [PHASE.BURST]);
    shapes.battery_under_load = {
      phase: PHASE.BURST,
      voltage_mv: sV.values.length > 0 ?
          chartToText(sV.values, {ts: sV.ts, sparkline_len: 20}) :
          {error: 'no_finite_samples'},
      current_ua: sI.values.length > 0 ?
          chartToText(sI.values, {ts: sI.ts, sparkline_len: 20}) :
          {error: 'no_finite_samples'},
      note: 'Dual-channel: voltage (mV) and current (µA) during the BURST phase.',
    };
  } catch (e) {
    errors.push('shapes.battery_under_load: ' + e.message);
    shapes.battery_under_load = {error: e.message};
  }

  // voltage_vs_current — scatter summary (no sparkline; Pearson r only)
  try {
    const sV = readChannelStream(samples, 'battery_voltage_mv', [PHASE.BURST]);
    const sI = readChannelStream(samples, 'battery_current_ua', [PHASE.BURST]);
    const n = Math.min(sV.values.length, sI.values.length);
    const r = n >= 3 ? stats2.pearson(sV.values.slice(0, n), sI.values.slice(0, n)) : null;
    shapes.voltage_vs_current = {
      type: 'scatter_summary',
      phase: PHASE.BURST,
      pearson_r: typeof r === 'number' ? r : null,
      samples_used: n,
      voltage_mv_range: sV.values.length ? [stats.min(sV.values), stats.max(sV.values)] : null,
      current_ua_range: sI.values.length ? [stats.min(sI.values), stats.max(sI.values)] : null,
      note: 'Scatter: Pearson r between voltage_mv and current_ua in BURST phase. ' +
          'Strongly negative r is the expected I/V curve under load ' +
          '(more current → lower terminal voltage due to internal resistance).',
    };
  } catch (e) {
    errors.push('shapes.voltage_vs_current: ' + e.message);
    shapes.voltage_vs_current = {error: e.message};
  }

  // power_profile — package_power_mw across all phases
  try {
    const stream = readChannelStream(samples, 'package_power_mw');
    if (stream.values.length === 0) {
      shapes.power_profile = {error: 'no_finite_samples'};
    } else {
      const sig = chartToText(stream.values, {
        ts: stream.ts, phases: stream.phases,
        sparkline_len: 30,
        phase_segments_for: [0, 1, 2, 3, 4, 5, 6, 7],
        phase_sparkline_len: 10,
      });
      sig.unit = 'mW';
      sig.note = 'Package power (SoC + memory + display) across all phases. ' +
          'Peaks in CPU/GPU/COMBINED stress phases reveal sustained vs burst draw.';
      shapes.power_profile = sig;
    }
  } catch (e) {
    errors.push('shapes.power_profile: ' + e.message);
    shapes.power_profile = {error: e.message};
  }

  // engagement — cpu_usage_pct, stress phases 3-6 only
  try {
    const stream = readChannelStream(samples, 'cpu_usage_pct',
        [PHASE.CPU, PHASE.GPU, PHASE.COMBINED, PHASE.BURST]);
    if (stream.values.length === 0) {
      shapes.engagement = {error: 'no_finite_samples'};
    } else {
      const sig = chartToText(stream.values, {
        ts: stream.ts, phases: stream.phases,
        sparkline_len: 25,
        phase_segments_for: [3, 4, 5, 6],
        phase_sparkline_len: 10,
      });
      sig.unit = '%';
      sig.note = 'CPU utilization across stress phases 3-6. Engagement near 100% ' +
          'means workload is saturating the cores; lower values mean either ' +
          'thermal throttling skipped cycles or the harness undershot.';
      shapes.engagement = sig;
    }
  } catch (e) {
    errors.push('shapes.engagement: ' + e.message);
    shapes.engagement = {error: e.message};
  }

  // storage_memory — throughput + bandwidth, phases 1-2 only
  try {
    const sS = readChannelStream(samples, 'storage_throughput_mbps', [PHASE.STORAGE, PHASE.MEMORY]);
    const sM = readChannelStream(samples, 'memory_bandwidth_mbps', [PHASE.STORAGE, PHASE.MEMORY]);
    shapes.storage_memory = {
      storage_throughput_mbps: sS.values.length > 0 ? chartToText(sS.values, {
        ts: sS.ts, phases: sS.phases, sparkline_len: 18,
        phase_segments_for: [1, 2], phase_sparkline_len: 8,
      }) : {error: 'no_finite_samples'},
      memory_bandwidth_mbps: sM.values.length > 0 ? chartToText(sM.values, {
        ts: sM.ts, phases: sM.phases, sparkline_len: 18,
        phase_segments_for: [1, 2], phase_sparkline_len: 8,
      }) : {error: 'no_finite_samples'},
      note: 'Storage throughput typically populated only in phase 1 (STORAGE_STRESS); ' +
          'memory bandwidth typically populated only in phase 2 (MEMORY_STRESS). ' +
          'Empty/zero off-phase samples are normal.',
    };
  } catch (e) {
    errors.push('shapes.storage_memory: ' + e.message);
    shapes.storage_memory = {error: e.message};
  }

  return {
    primitives,
    shapes,
    errors,
    sample_count: samples.length,
    schema_version: 'v5_precomputed.v1',
  };
}

module.exports = {precompute, PRIMITIVE_GRID, CORRELATION_PAIRS, CHANNEL_INDEX};
