// precompute_smoke.test.js — Stage 1 smoke test for V5 precompute.
//
// Run: node functions/test/precompute_smoke.test.js
//
// Loads a real lab sample if available (samsung_1_9, V5 schema), otherwise
// falls back to a minimal synthetic fingerprint. Asserts:
//   - computed_signals returns { primitives, shapes, errors, sample_count, schema_version }
//   - primitives has mean / max / min / std / samples_count / correlation
//   - shapes has the 7 expected keys
//   - schema_version == 'v5_precomputed.v1'
//   - no thrown exceptions
//
// Not deployed. Not part of Cloud Functions runtime.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {precompute, PRIMITIVE_GRID, CORRELATION_PAIRS} = require('../src/analysis/precompute');
const {CH} = require('../src/lab/layer1/utils/channels');

// ── Try to load a real lab sample. ──────────────────────────────────────
// Path is cross-machine; if missing we fall back to synthetic.
const LAB_SAMPLE = path.join(
    'C:', 'Users', '<user>', 'neuralcheck-lab', 'data',
    'samsung_1_9_apphonesty_20260509_075930_ts.json.json');

function loadSample() {
  try {
    if (fs.existsSync(LAB_SAMPLE)) {
      const raw = JSON.parse(fs.readFileSync(LAB_SAMPLE, 'utf8'));
      return {source: 'lab_sample', fp: raw};
    }
  } catch (e) {
    // fall through to synthetic
  }
  return {source: 'synthetic', fp: buildSynthetic()};
}

// Minimal v5 fingerprint: 600 samples across 8 phases, plausible numeric
// values per V5 channel layout.
function buildSynthetic() {
  const samples = [];
  const startTs = 1700000000000;
  const phaseDurations = [30, 75, 60, 75, 75, 60, 45, 60];
  let sampleIdx = 0;
  for (let p = 0; p < 8; p++) {
    const phaseSampleCount = Math.round(phaseDurations[p] * 1.25);
    for (let i = 0; i < phaseSampleCount; i++) {
      const ts = startTs + sampleIdx * 800;
      const v = new Array(22).fill(0);
      v[CH.TS_MS] = ts;
      v[CH.BATT_TEMP] = 32 + p * 1.5 + Math.sin(i * 0.1) * 0.5;
      v[CH.BATT_VOLT] = 4100 - p * 50 - (p === 6 ? Math.sin(i * 0.3) * 80 : 0);
      v[CH.BATT_CURRENT] = -(500000 + p * 200000 + Math.cos(i * 0.2) * 100000);
      v[CH.BATT_LEVEL] = 92 - sampleIdx * 0.01;
      v[CH.CPU_TEMP] = (p >= 3 && p <= 6) ? 70 + p * 2 : -1;
      v[CH.CPU_FREQ_BIG] = (p === 3 || p === 5 || p === 6) ?
          2800000 - (i > 5 ? 800000 : 0) :
          (p === 7 ? 600000 : 1500000);
      v[CH.CPU_FREQ_LITTLE] = 1200000;
      v[CH.CPU_FREQ_MID] = 1900000;
      v[CH.CPU_USAGE] = (p >= 3 && p <= 6) ? 88 + Math.random() * 8 : 12;
      v[CH.GPU_FPS] = (p === 4 || p === 5) ? 30 + Math.random() * 10 : 0;
      v[CH.GPU_TEMP] = -1;
      v[CH.THERMAL_HEADROOM] = (p >= 4 ? 0.9 : 0.4);
      v[CH.THERMAL_STATUS] = (p >= 4 ? 2 : 0);
      v[CH.MEM_AVAILABLE_MB] = 2048;
      v[CH.STORAGE_AVAILABLE_GB] = 64;
      v[CH.CELLULAR_DBM] = -85;
      v[CH.WIFI_DBM] = -55;
      v[CH.SKIN_TEMP] = -1;
      v[CH.PACKAGE_POWER_MW] = (p >= 3 && p <= 5) ? 8000 + p * 500 : (p === 6 ? 12000 - Math.cos(i * 0.4) * 4000 : 1500);
      v[CH.STORAGE_THROUGHPUT_MBPS] = p === 1 ? 200 + Math.random() * 50 : 0;
      v[CH.MEMORY_BANDWIDTH_MBPS] = p === 2 ? 4000 + Math.random() * 500 : 0;
      samples.push({phase: p, ts, v});
      sampleIdx++;
    }
  }
  return {
    timeSeries: {
      samples,
      footer: {},
      header: {},
      variables: [],
    },
  };
}

// ── Run smoke test ──────────────────────────────────────────────────────

const {source, fp} = loadSample();
console.log('[smoke] using sample source:', source);

const t0 = Date.now();
const result = precompute(fp);
const ms = Date.now() - t0;

// 1. Top-level shape
assert.ok(result, 'precompute returned falsy');
assert.ok(result.primitives, 'computed_signals.primitives missing');
assert.ok(result.shapes, 'computed_signals.shapes missing');
assert.ok(Array.isArray(result.errors), 'computed_signals.errors must be array');
assert.strictEqual(result.schema_version, 'v5_precomputed.v1', 'schema_version mismatch');
assert.ok(typeof result.sample_count === 'number', 'sample_count must be number');

// 2. Primitives shape
const prim = result.primitives;
assert.ok(prim.mean && typeof prim.mean === 'object', 'primitives.mean missing');
assert.ok(prim.max && typeof prim.max === 'object', 'primitives.max missing');
assert.ok(prim.min && typeof prim.min === 'object', 'primitives.min missing');
assert.ok(prim.std && typeof prim.std === 'object', 'primitives.std missing');
assert.ok(prim.samples_count && typeof prim.samples_count === 'object', 'primitives.samples_count missing');
assert.ok(Array.isArray(prim.correlation), 'primitives.correlation must be array');

// Every grid entry should exist as a key in mean/max/min/std (value may be null).
for (const [channel, phase] of PRIMITIVE_GRID) {
  const key = channel + '/' + phase;
  assert.ok(key in prim.mean, 'missing key in mean: ' + key);
  assert.ok(key in prim.max, 'missing key in max: ' + key);
  assert.ok(key in prim.min, 'missing key in min: ' + key);
  assert.ok(key in prim.std, 'missing key in std: ' + key);
}
assert.strictEqual(prim.correlation.length, CORRELATION_PAIRS.length,
    'correlation count mismatch: expected ' + CORRELATION_PAIRS.length + ', got ' + prim.correlation.length);

// 3. Shapes — 7 expected keys (or 8 counting voltage_vs_current)
const shapeKeys = Object.keys(result.shapes);
const expectedShapeKeys = [
  'cpu_freq_response', 'thermal_progression', 'battery_under_load',
  'voltage_vs_current', 'power_profile', 'engagement', 'storage_memory',
];
for (const k of expectedShapeKeys) {
  assert.ok(shapeKeys.includes(k), 'missing shape: ' + k);
}
assert.ok(shapeKeys.length >= 4, 'expected at least 4 shape entries, got ' + shapeKeys.length);

// 4. Sanity: at least one mean / max / min / std primitive should be non-null
//    on a real or richly-synthetic sample.
let nonNullPrimitiveCount = 0;
for (const key of Object.keys(prim.mean)) {
  if (typeof prim.mean[key] === 'number') nonNullPrimitiveCount++;
}
assert.ok(nonNullPrimitiveCount > 0,
    'all primitive means are null — fingerprint may be empty or channel mapping wrong');

// 5. payload size sanity
const payloadBytes = Buffer.byteLength(JSON.stringify(result));

// ── Report ──────────────────────────────────────────────────────────────
console.log('[smoke] sample_count:', result.sample_count);
console.log('[smoke] primitives.mean keys:', Object.keys(prim.mean).length,
    ' non-null:', nonNullPrimitiveCount);
console.log('[smoke] primitives.correlation entries:', prim.correlation.length);
console.log('[smoke] shapes keys:', shapeKeys.length, '->', shapeKeys.join(','));
console.log('[smoke] errors:', result.errors.length);
for (const e of result.errors) console.log('  -', e);
console.log('[smoke] payload bytes:', payloadBytes);
console.log('[smoke] duration ms:', ms);
console.log('[smoke] schema_version:', result.schema_version);
console.log('[smoke] PASS');
