/* verify/lib/audit-util.js — 审计脚本共用工具 */
'use strict';
/** 在 samples（按时间升序，字段含 t）上线性插值取某时刻状态 */
function stateAt(samples, t) {
  if (!samples.length) return null;
  if (t <= samples[0].t) return samples[0];
  const last = samples[samples.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = samples[lo], b = samples[hi];
  const u = (t - a.t) / (b.t - a.t || 1);
  const out = { t };
  for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'speed', 'mach', 'alpha', 'beta', 'theta', 'qdyn', 'wx', 'wy', 'wz']) {
    out[k] = a[k] + (b[k] - a[k]) * u;
  }
  return out;
}
/** 两个单位四元数 [w,x,y,z] 的夹角（rad，0~π） */
function quatAngle(q1, q2) {
  const dot = Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}
/** 四元数旋转矩阵正交性误差 max|R R^T - I| */
function orthoErr(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  const R = [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ];
  let e = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += R[i][k] * R[j][k];
    e = Math.max(e, Math.abs(s - (i === j ? 1 : 0)));
  }
  return e;
}
function round(x, n) { const p = Math.pow(10, n == null ? 3 : n); return Math.round(x * p) / p; }
function pad(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }
function padR(s, n) { s = String(s); while (s.length < n) s = s + ' '; return s; }
function sci(x) { return Number(x).toExponential(2); }
module.exports = { stateAt, quatAngle, orthoErr, round, pad, padR, sci };
