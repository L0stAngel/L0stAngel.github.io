/* verify/lib/stats.js — 基础统计/分位数/KS 检验（审计用） */
'use strict';
function mean(a) { let s = 0; for (const v of a) s += v; return s / a.length; }
function variance(a) { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return s / a.length; }
function sd(a) { return Math.sqrt(variance(a)); }
function cv(a) { const m = mean(a); return m === 0 ? Infinity : sd(a) / m; }
/** 线性插值分位数，q ∈ [0,1] */
function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function summarize(a) {
  const m = mean(a), v = variance(a), s = Math.sqrt(v);
  const sorted = Float64Array.from(a).sort();
  return { n: a.length, mean: m, sd: s, cv: m === 0 ? Infinity : s / m, min: sorted[0], max: sorted[sorted.length - 1],
    p05: quantile(sorted, 0.05), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9), p95: quantile(sorted, 0.95) };
}
/** 单样本 KS 检验：返回 D 统计量与近似 p 值（渐近公式，n>35） */
function ksTest(sample, cdf) {
  const a = Array.from(sample).sort((x, y) => x - y);
  const n = a.length;
  let D = 0;
  for (let i = 0; i < n; i++) {
    const F = cdf(a[i]);
    const d1 = Math.abs(F - i / n);
    const d2 = Math.abs((i + 1) / n - F);
    if (d1 > D) D = d1;
    if (d2 > D) D = d2;
  }
  const lambda = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * D;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  p = Math.max(0, Math.min(1, p));
  return { D, p, n };
}
module.exports = { mean, variance, sd, cv, quantile, summarize, ksTest };
