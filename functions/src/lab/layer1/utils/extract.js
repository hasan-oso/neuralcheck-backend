'use strict';

const { CH } = require('./channels');

function samplesInPhase(samples, phase) {
  if (!Array.isArray(samples)) return [];
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] && samples[i].phase === phase) out.push(samples[i]);
  }
  return out;
}

function channelValues(samples, channelIdx) {
  if (!Array.isArray(samples)) return [];
  const out = [];
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] && samples[i].v;
    if (v && typeof v[channelIdx] === 'number') out.push(v[channelIdx]);
  }
  return out;
}

function isPhysicallyPlausibleCurrent_uA(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return Math.abs(value) <= 15_000_000;
}

// Android's thermal_headroom is reported on a 0..1+ scale where >=1.0 means
// "throttling imminent". Values above ~2.0 are non-physical (would mean the
// kernel reports the device is 200%+ past its throttle threshold while running).
// Negative values are sentinels for "headroom unavailable on this OEM".
function isPhysicallyPlausibleHeadroom(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= 0 && value <= 2.0;
}

function plausibleCurrentSamples(samples) {
  if (!Array.isArray(samples)) return { kept: [], filtered: 0 };
  const kept = [];
  let filtered = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] && samples[i].v;
    if (!v) continue;
    if (isPhysicallyPlausibleCurrent_uA(v[CH.BATT_CURRENT])) kept.push(samples[i]);
    else filtered++;
  }
  return { kept, filtered };
}

function firstSampleInPhase(samples, phase) {
  if (!Array.isArray(samples)) return null;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] && samples[i].phase === phase) return samples[i];
  }
  return null;
}

function lastSampleInPhase(samples, phase) {
  if (!Array.isArray(samples)) return null;
  let last = null;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] && samples[i].phase === phase) last = samples[i];
  }
  return last;
}

module.exports = {
  samplesInPhase,
  channelValues,
  isPhysicallyPlausibleCurrent_uA,
  isPhysicallyPlausibleHeadroom,
  plausibleCurrentSamples,
  firstSampleInPhase,
  lastSampleInPhase,
};
