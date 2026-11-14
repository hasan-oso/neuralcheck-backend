'use strict';

const { CH, PHASE } = require('../utils/channels');
const { firstSampleInPhase, isPhysicallyPlausibleHeadroom } = require('../utils/extract');

const HEADROOM_THRESHOLD = 0.7;
// v63 Fix 3: require N consecutive plausible-range samples ALL above threshold
// to declare a throttle event. Catches single-sample transient artifacts that
// survived the [0, 2.0] plausibility filter (e.g. 1.846 spike on Xiaomi v4).
// 5 samples ≈ 1.25 s at the typical 4 Hz sample rate; a real OS-level throttle
// event lasts seconds, not a single tick.
const WINDOW_SIZE = 5;
// v63 Fix 3 cross-check: if footer reports thermalHeadroomPeak well below the
// breach threshold, but our scan caught a window event, the event is highly
// suspect (transient spikes that the footer's smoothing filter rejected).
// Threshold of 0.5 = comfortably below the 0.7 throttle threshold.
const FOOTER_PEAK_DISCREPANCY_THRESHOLD = 0.5;

function classifyTTT(ttt_sec) {
  if (ttt_sec >= 60) return { classification: 'excellent_cooling', confidence: 'high' };
  if (ttt_sec >= 30) return { classification: 'normal', confidence: 'high' };
  if (ttt_sec >= 15) return { classification: 'weak_cooling', confidence: 'medium' };
  return { classification: 'degraded_cooling', confidence: 'high' };
}

function computeTimeToThrottle(samples, footer) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'rolling_window_headroom_breach', reason: 'empty_samples' },
    };
  }

  const phase3First = firstSampleInPhase(samples, PHASE.CPU);
  if (!phase3First) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: { method: 'rolling_window_headroom_breach', reason: 'no_phase3_samples' },
    };
  }
  const phase3StartMs = phase3First.ts;

  // First pass: extract the plausible-range headroom timeline across phases 3-5,
  // preserving sample identity so we can timestamp the breach window.
  const timeline = []; // [{sample, headroom}, ...] in original order
  let outliers_filtered = 0;
  let peakHeadroom = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s) continue;
    if (s.phase !== PHASE.CPU && s.phase !== PHASE.GPU && s.phase !== PHASE.COMBINED) continue;
    const headroom = s.v && s.v[CH.THERMAL_HEADROOM];
    if (typeof headroom !== 'number') continue;
    if (!isPhysicallyPlausibleHeadroom(headroom)) {
      outliers_filtered++;
      continue;
    }
    timeline.push({ sample: s, headroom });
    if (headroom > peakHeadroom) peakHeadroom = headroom;
  }
  if (peakHeadroom === -Infinity) peakHeadroom = null;

  // Rolling-window detection: smallest start index k where every value in
  // timeline[k..k+WINDOW_SIZE-1] is >= HEADROOM_THRESHOLD.
  let breachStartIndex = -1;
  if (timeline.length >= WINDOW_SIZE) {
    for (let k = 0; k <= timeline.length - WINDOW_SIZE; k++) {
      let allAbove = true;
      for (let j = 0; j < WINDOW_SIZE; j++) {
        if (timeline[k + j].headroom < HEADROOM_THRESHOLD) { allAbove = false; break; }
      }
      if (allAbove) { breachStartIndex = k; break; }
    }
  }

  if (breachStartIndex === -1) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'no_throttle',
      confidence: 'high',
      evidence: {
        method: 'rolling_window_headroom_breach',
        phase3StartMs,
        firstThrottleMs: null,
        peakHeadroomReached: peakHeadroom == null ? null : Number(peakHeadroom.toFixed(3)),
        threshold: HEADROOM_THRESHOLD,
        window_size: WINDOW_SIZE,
        outliers_filtered,
        plausible_samples_seen: timeline.length,
      },
    };
  }

  const breachSample = timeline[breachStartIndex].sample;
  const ttt_sec = (breachSample.ts - phase3StartMs) / 1000;

  // Cross-check against footer-reported peak. If footer says the device never
  // really reached thermal pressure but our window detector caught one, flag
  // as transient artifact rather than a real finding.
  const footerPeak =
    footer && typeof footer.thermalHeadroomPeak === 'number' ? footer.thermalHeadroomPeak : null;
  if (footerPeak != null && footerPeak < FOOTER_PEAK_DISCREPANCY_THRESHOLD) {
    return {
      value: null,
      value_unit: 'sec',
      classification: 'INSUFFICIENT_DATA',
      confidence: 'low',
      evidence: {
        method: 'rolling_window_headroom_breach',
        reason: 'transient_outlier_in_headroom_signal',
        phase3StartMs,
        candidate_throttle_ms: breachSample.ts,
        candidate_ttt_sec: Number(ttt_sec.toFixed(2)),
        peakHeadroomReached: Number(peakHeadroom.toFixed(3)),
        footer_thermalHeadroomPeak: footerPeak,
        discrepancy_threshold: FOOTER_PEAK_DISCREPANCY_THRESHOLD,
        threshold: HEADROOM_THRESHOLD,
        window_size: WINDOW_SIZE,
        outliers_filtered,
        plausible_samples_seen: timeline.length,
      },
    };
  }

  const cls = classifyTTT(ttt_sec);
  return {
    value: Number(ttt_sec.toFixed(2)),
    value_unit: 'sec',
    classification: cls.classification,
    confidence: cls.confidence,
    evidence: {
      method: 'rolling_window_headroom_breach',
      phase3StartMs,
      firstThrottleMs: breachSample.ts,
      peakHeadroomReached: Number(peakHeadroom.toFixed(3)),
      threshold: HEADROOM_THRESHOLD,
      window_size: WINDOW_SIZE,
      throttle_phase: breachSample.phase,
      outliers_filtered,
      plausible_samples_seen: timeline.length,
    },
  };
}

module.exports = { computeTimeToThrottle };
