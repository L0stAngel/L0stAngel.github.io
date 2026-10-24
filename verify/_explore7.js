/* verify/_explore7.js — 线性化矩阵正确性校验（数值雅可比 vs 解析 4x4） */
'use strict';
const path = require('path');
const { loadNative } = require('./lib/native-core');
const { polyEig } = require('./lib/eig');
const BASE = path.join(__dirname, 'baseline', 'physics-baseline.js');
const P = loadNative(BASE);
const I = P.internals;
const SH = I.SHELL, V0 = 450, ANG = Math.PI / 4, p0 = 1178;
const h0 = 0;

// 构造精确状态：姿态 q=yaw(45°)，体轴 x1 指前上方；体速度 v_b=(V,0,0) => 世界速度 = R*v_b
function qMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
  ];
}
function qFromAxis(ax, ang) { const s = Math.sin(ang / 2); return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s]; }
function Rof(q) {
  const w = q[0], x = q[1], y = q[2], z = q[3];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]
  ];
}
function mv(R, v) { return [R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2], R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2], R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]]; }
function mTv(R, v) { return [R[0][0] * v[0] + R[1][0] * v[1] + R[2][0] * v[2], R[0][1] * v[0] + R[1][1] * v[1] + R[2][1] * v[2], R[0][2] * v[0] + R[1][2] * v[1] + R[2][2] * v[2]]; }

const qBase = qFromAxis([0, 0, 1], ANG);
const Rbase = Rof(qBase);

function stateFromX(x) {
  // x = [alpha, beta, wy, wz]
  const al = x[0], be = x[1];
  const vb = [V0 * Math.cos(al) * Math.cos(be), -V0 * Math.sin(al) * Math.cos(be), V0 * Math.cos(al) * Math.sin(be)];
  const vw = mv(Rbase, vb);
  const y = new Float64Array(13);
  y[0] = 0; y[1] = h0; y[2] = 0;
  y[3] = vw[0]; y[4] = vw[1]; y[5] = vw[2];
  y[6] = qBase[0]; y[7] = qBase[1]; y[8] = qBase[2]; y[9] = qBase[3];
  y[10] = p0; y[11] = x[2]; y[12] = x[3];
  return y;
}
function rhs4(x) {
  const y = stateFromX(x);
  const out = new Float64Array(13);
  I.deriv(y, out);
  const vw = [y[3], y[4], y[5]], vwd = [out[3], out[4], out[5]];
  const om = [p0, x[2], x[3]];
  const vb = mTv(Rbase, vw);
  const vbd = [0, 0, 0];
  // vbd = -omega x vb + R^T vw_dot
  const cross = [om[1] * vb[2] - om[2] * vb[1], om[2] * vb[0] - om[0] * vb[2], om[0] * vb[1] - om[1] * vb[0]];
  const rtv = mTv(Rbase, vwd);
  for (let i = 0; i < 3; i++) vbd[i] = -cross[i] + rtv[i];
  const ub = vb[0], vbb = vb[1], wb = vb[2];
  const ubd = vbd[0], vbd_ = vbd[1], wbd = vbd[2];
  const aldot = (ub * (-vbd_) - (-vbb) * ubd) / (ub * ub + vbb * vbb);
  const bedot = (ub * wbd - wb * ubd) / (ub * ub + wb * wb);
  return [aldot, bedot, out[11], out[12]];
}

// 数值雅可比
function jac(f, x, eps) {
  const n = x.length;
  const f0 = f(x);
  const M = [];
  for (let i = 0; i < n; i++) M.push(new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    const xp = x.slice(); xp[j] += eps;
    const fp = f(xp);
    for (let i = 0; i < n; i++) M[i][j] = (fp[i] - f0[i]) / eps;
  }
  return M;
}
const x0 = [0, 0, 0, 0];
const Jnum = jac(rhs4, x0, 1e-6);
console.log('数值 Jacobian Jnum:');
for (const row of Jnum) console.log('  [' + row.map(v => v.toFixed(3).padStart(9)).join(', ') + ']');

// 解析 4x4（与 audit-aero 相同的公式）
const atm = I.atmosphere(h0), co = I.aeroAt(V0 / atm.a), q = 0.5 * atm.rho * V0 * V0;
const a = q * SH.S * co[1] / (SH.mass * V0);
const mzA = -co[1] * (co[2] - SH.xcgD);
const k = q * SH.S * SH.D * mzA / SH.Iy;
const damp = q * SH.S * SH.D * SH.D / (2 * V0);
const cm = damp * -50 / SH.Iy;
const magK = q * SH.S * SH.D * 1.30 * (p0 * SH.D / V0);
const g = magK / SH.Iy;
const rp = (SH.Iy - SH.Ix) / SH.Iy * p0;
const sp = -rp;
const Jan = [
  [-a, -p0, 0, 1],
  [p0, a, 1, 0],
  [g, k, cm, rp],
  [k, -g, sp, cm]
];
console.log('解析 Jan:');
for (const row of Jan) console.log('  [' + row.map(v => v.toFixed(3).padStart(9)).join(', ') + ']');
console.log('差异 (Jan-Jnum):');
for (let i = 0; i < 4; i++) console.log('  [' + Jan[i].map((v, j) => (v - Jnum[i][j]).toFixed(3).padStart(9)).join(', ') + ']');
console.log('Jnum 特征值:', polyEig(Jnum).map(e => e.re.toFixed(3) + (e.im >= 0 ? '+' : '') + e.im.toFixed(3) + 'i').join(' | '));
console.log('Jan  特征值:', polyEig(Jan).map(e => e.re.toFixed(3) + (e.im >= 0 ? '+' : '') + e.im.toFixed(3) + 'i').join(' | '));
