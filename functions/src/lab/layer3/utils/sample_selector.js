'use strict';

const { CH } = require('../../layer1/utils/channels');

// T3 — Selective sample inclusion. Pick 20–30 diagnostic samples total:
//   - 1–2 around each phase transition (phase change)
//   - up to 5 around peak power in phase 5
//   - up to 5 around outliers from L2 zscore detection
//   - 2 at start + 2 at end of phase 7 (cooling curve endpoints)
//
// Returns a sorted, deduplicated list of {originalIndex, ts, phase, v} samples.

const PHASE_NAMES = { 0: 'INIT', 1: 'STORAGE', 2: 'MEMORY', 3: 'CPU', 4: 'GPU', 5: 'COMBINED', 6: 'BURST', 7: 'COOLDOWN' };

function selectSamples(samples, layer2Output) {
  if (!Array.isArray(samples) || samples.length === 0) return [];
  const selected = new Set();

  // 1) Phase transitions: take the last sample of one phase and first of next.
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].phase !== samples[i - 1].phase) {
      selected.add(i - 1);
      selected.add(i);
    }
  }

  // 2) Peak power in phase 5 (up to 5 samples around the peak).
  const phase5 = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].phase === 5) phase5.push(i);
  }
  if (phase5.length > 0) {
    let peakIdx = phase5[0];
    let peakPwr = -Infinity;
    for (const i of phase5) {
      const p = samples[i].v && samples[i].v[CH.PACKAGE_POWER_MW];
      if (typeof p === 'number' && p > peakPwr) {
        peakPwr = p;
        peakIdx = i;
      }
    }
    // Window: 2 before, peak, 2 after.
    for (let d = -2; d <= 2; d++) {
      const k = peakIdx + d;
      if (k >= 0 && k < samples.length && samples[k].phase === 5) selected.add(k);
    }
  }

  // 3) Outliers from L2 zscore: include up to 5 worst-offender indices.
  if (layer2Output && layer2Output.features && layer2Output.features.anomalies) {
    const perChannel = layer2Output.features.anomalies.evidence?.per_channel || [];
    const allOutliers = [];
    for (const c of perChannel) {
      if (Array.isArray(c.worst_offenders)) {
        for (const o of c.worst_offenders) {
          if (typeof o.sampleIndex === 'number') allOutliers.push(o);
        }
      }
    }
    allOutliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    for (const o of allOutliers.slice(0, 5)) selected.add(o.sampleIndex);
  }

  // 4) Phase 7 endpoints: 2 at start, 2 at end.
  const phase7 = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].phase === 7) phase7.push(i);
  }
  if (phase7.length >= 4) {
    selected.add(phase7[0]);
    selected.add(phase7[1]);
    selected.add(phase7[phase7.length - 2]);
    selected.add(phase7[phase7.length - 1]);
  }

  // Convert to sorted indices, then to sample records.
  const indices = Array.from(selected).sort((a, b) => a - b);

  // If somehow we are above 30, prune extras keeping evenly-spaced selection.
  let kept;
  if (indices.length > 30) {
    kept = [];
    const step = indices.length / 30;
    for (let i = 0; i < 30; i++) kept.push(indices[Math.floor(i * step)]);
  } else if (indices.length < 20) {
    // Pad with phase 5 samples (most diagnostic) until we hit 20.
    const phase5Set = new Set(selected);
    for (const i of phase5) {
      if (kept !== undefined) break;
      if (!phase5Set.has(i)) {
        selected.add(i);
        if (selected.size >= 20) break;
      }
    }
    kept = Array.from(selected).sort((a, b) => a - b);
  } else {
    kept = indices;
  }

  return kept.map((i) => {
    const s = samples[i];
    return {
      originalIndex: i,
      ts: s.ts,
      phase: s.phase,
      phaseName: PHASE_NAMES[s.phase] || String(s.phase),
      v: s.v,
    };
  });
}

// Format selected samples as a markdown table.
function formatSamplesTable(selected) {
  if (selected.length === 0) return '';
  const cols = [
    'idx', 'phase', 'ts_rel_s',
    'V_mV', 'I_mA', 'lvl%',
    'cpu_T', 'big_MHz', 'mid_MHz', 'lit_MHz',
    'usage%', 'headroom', 'skin_T', 'pwr_W',
  ];
  const t0 = selected[0].ts;
  const tableRow = (cells) => '| ' + cells.join(' | ') + ' |';
  const rows = [tableRow(cols)];
  rows.push(tableRow(cols.map(() => '---')));
  for (const s of selected) {
    const v = s.v;
    const vCell = (val, dec = 0) => {
      if (typeof val !== 'number' || !Number.isFinite(val)) return '–';
      return dec === 0 ? String(Math.round(val)) : val.toFixed(dec);
    };
    rows.push(tableRow([
      s.originalIndex,
      s.phaseName,
      ((s.ts - t0) / 1000).toFixed(1),
      vCell(v[CH.BATT_VOLT]),
      vCell(v[CH.BATT_CURRENT] / 1000),
      vCell(v[CH.BATT_LEVEL]),
      vCell(v[CH.CPU_TEMP], 1),
      vCell(v[CH.CPU_FREQ_BIG] / 1000),
      vCell(v[CH.CPU_FREQ_MID] / 1000),
      vCell(v[CH.CPU_FREQ_LITTLE] / 1000),
      vCell(v[CH.CPU_USAGE], 1),
      vCell(v[CH.THERMAL_HEADROOM], 2),
      vCell(v[CH.SKIN_TEMP], 1),
      vCell(v[CH.PACKAGE_POWER_MW] / 1000, 2),
    ]));
  }
  return rows.join('\n');
}

module.exports = { selectSamples, formatSamplesTable };
