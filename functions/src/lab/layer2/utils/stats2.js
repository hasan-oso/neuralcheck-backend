'use strict';

// Layer 2 statistical helpers (skewness, kurtosis, autocorrelation, OLS, Pearson).
// Independent of Layer 1's stats.js to keep Layer 2 self-contained.

function mean(arr) {
  if (!arr || arr.length === 0) return null;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function variance(arr, m) {
  if (!arr || arr.length < 2) return null;
  const mu = m == null ? mean(arr) : m;
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    s += d * d;
  }
  return s / arr.length;
}

function std(arr, m) {
  const v = variance(arr, m);
  return v == null ? null : Math.sqrt(v);
}

// Sample skewness (Fisher-Pearson):
//   g1 = m3 / m2^(3/2)
function skewness(arr) {
  if (!arr || arr.length < 3) return null;
  const mu = mean(arr);
  let m2 = 0, m3 = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
  }
  m2 /= arr.length;
  m3 /= arr.length;
  if (m2 === 0) return 0;
  return m3 / Math.pow(m2, 1.5);
}

// Excess kurtosis (Fisher):
//   g2 = m4 / m2^2 - 3
function kurtosis(arr) {
  if (!arr || arr.length < 4) return null;
  const mu = mean(arr);
  let m2 = 0, m4 = 0;
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= arr.length;
  m4 /= arr.length;
  if (m2 === 0) return 0;
  return m4 / (m2 * m2) - 3;
}

// Lag-k autocorrelation: corr(x[t], x[t+k]).
function autocorrelation(arr, k) {
  if (!arr || arr.length <= k + 1 || k < 1) return null;
  const mu = mean(arr);
  let num = 0, den = 0;
  for (let i = 0; i < arr.length - k; i++) {
    num += (arr[i] - mu) * (arr[i + k] - mu);
  }
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i] - mu;
    den += d * d;
  }
  if (den === 0) return null;
  return num / den;
}

// Pearson correlation, returns null if either std is 0 or arrays mismatch.
function pearson(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 2) return null;
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = x[i] - mx;
    const ey = y[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// Ordinary least squares slope+intercept on (x, y).
// Returns { slope, intercept, r2, residualStd } or null on insufficient data.
function ols(x, y) {
  if (!x || !y || x.length !== y.length || x.length < 2) return null;
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  // Residual std: sqrt(sum((y_i - (slope*x_i + intercept))^2) / (n - 2))
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = y[i] - (slope * x[i] + intercept);
    ss += r * r;
  }
  const residualStd = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;
  return { slope, intercept, r2, residualStd, n };
}

function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  if (p < 0 || p > 100) return null;
  const sorted = arr.slice().sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function iqr(arr) {
  if (!arr || arr.length < 4) return null;
  return percentile(arr, 75) - percentile(arr, 25);
}

module.exports = {
  mean, variance, std, skewness, kurtosis,
  autocorrelation, pearson, ols, percentile, iqr,
};
