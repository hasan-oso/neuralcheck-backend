'use strict';

// In-place radix-2 Cooley-Tukey FFT. Length must be a power of 2.
// real, imag are arrays of equal length; both modified in place.
// Direction: forward (sign = -1).
function fftInPlace(real, imag) {
  const n = real.length;
  if (n !== imag.length) throw new Error('fft: real/imag length mismatch');
  if (n < 2) return;
  if ((n & (n - 1)) !== 0) throw new Error('fft: length must be power of 2, got ' + n);

  // Bit-reversal permutation.
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  // Butterfly stages.
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const ang = angleStep * k;
        const wr = Math.cos(ang);
        const wi = Math.sin(ang);
        const xr = real[i + k + halfLen];
        const xi = imag[i + k + halfLen];
        const tr = wr * xr - wi * xi;
        const ti = wr * xi + wi * xr;
        real[i + k + halfLen] = real[i + k] - tr;
        imag[i + k + halfLen] = imag[i + k] - ti;
        real[i + k] = real[i + k] + tr;
        imag[i + k] = imag[i + k] + ti;
      }
    }
  }
}

function nextPowerOfTwo(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// Hann window: w[i] = 0.5 * (1 - cos(2*pi*i / (N-1)))
function hannWindow(n) {
  const w = new Array(n);
  if (n === 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  }
  return w;
}

// Resample irregular (t, y) pairs to uniform time grid of nOut points spanning
// [t[0], t[t.length-1]]. Linear interpolation between nearest neighbors.
function resampleUniform(t, y, nOut) {
  if (t.length !== y.length) throw new Error('resampleUniform: length mismatch');
  if (t.length < 2) throw new Error('resampleUniform: need >= 2 points');
  const t0 = t[0];
  const tEnd = t[t.length - 1];
  if (tEnd <= t0) throw new Error('resampleUniform: time not increasing');
  const out = new Array(nOut);
  const dt = (tEnd - t0) / (nOut - 1);
  let j = 0;
  for (let i = 0; i < nOut; i++) {
    const ti = t0 + i * dt;
    while (j + 1 < t.length && t[j + 1] < ti) j++;
    const tj = t[j];
    const tj1 = t[Math.min(j + 1, t.length - 1)];
    if (tj1 === tj) {
      out[i] = y[j];
    } else {
      const frac = (ti - tj) / (tj1 - tj);
      out[i] = y[j] + frac * (y[j + 1] - y[j]);
    }
  }
  return { values: out, dt };
}

// Compute one-sided magnitude spectrum from real-valued signal.
// Returns { magnitudes, freqsHz, sampleRateHz, nUsed, nPadded } where magnitudes
// has length (N/2 + 1) including DC and Nyquist.
function magnitudeSpectrum(signal, sampleRateHz, options) {
  const opts = options || {};
  const applyHann = opts.applyHann !== false;        // default true
  const removeDC = opts.removeDC !== false;          // default true
  const linearDetrend = opts.linearDetrend !== false; // default true (better isolates oscillations from drift)

  const nUsed = signal.length;
  const nPadded = nextPowerOfTwo(nUsed);

  // Linear detrend (subtract OLS fit y = a + b*i). This removes both DC and
  // any linear drift, leaving the oscillatory content for spectral analysis.
  // Falls back to mean-subtract if linearDetrend disabled.
  let a = 0, b = 0;
  if (linearDetrend) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < nUsed; i++) {
      sx += i;
      sy += signal[i];
      sxx += i * i;
      sxy += i * signal[i];
    }
    const denom = nUsed * sxx - sx * sx;
    if (denom !== 0) {
      b = (nUsed * sxy - sx * sy) / denom;
      a = (sy - b * sx) / nUsed;
    } else {
      a = sy / nUsed; b = 0;
    }
  } else if (removeDC) {
    let m = 0;
    for (let i = 0; i < nUsed; i++) m += signal[i];
    a = m / nUsed; b = 0;
  }

  const real = new Array(nPadded).fill(0);
  const imag = new Array(nPadded).fill(0);
  const window = applyHann ? hannWindow(nUsed) : null;

  for (let i = 0; i < nUsed; i++) {
    const v = signal[i] - (a + b * i);
    real[i] = window ? v * window[i] : v;
  }

  fftInPlace(real, imag);

  const half = nPadded / 2;
  const magnitudes = new Array(half + 1);
  const freqsHz = new Array(half + 1);
  for (let k = 0; k <= half; k++) {
    magnitudes[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    freqsHz[k] = (k * sampleRateHz) / nPadded;
  }
  return { magnitudes, freqsHz, sampleRateHz, nUsed, nPadded };
}

module.exports = { fftInPlace, nextPowerOfTwo, hannWindow, resampleUniform, magnitudeSpectrum };
