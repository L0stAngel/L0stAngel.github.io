/* verify/lib/linearize.js — 对 physics.js 的真实 deriv 做数值线性化（不依赖解析推导）
 * 在给定飞行条件（h,V,自转角速度 p）与配平姿态附近，构造 [α, β, wy, wz] 四自由度状态，
 * 用有限差分求雅可比并返回特征值。特征值实部 > 0 即模型方程自身线性不稳定。
 */
'use strict';
const { polyEig } = require('./eig');

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

/**
 * @param {object} internals physics 内部对象（需 deriv）
 * @param {object} cond { h, V, spin, angle }
 * @returns {{eigs:Array, J:Array}}
 */
function linearize(internals, cond) {
  const I = internals;
  const h = cond.h || 0, V = cond.V || 450, p = cond.spin, angle = cond.angle != null ? cond.angle : Math.PI / 4;
  const qBase = qFromAxis([0, 0, 1], angle);
  const R = Rof(qBase);
  function stateFromX(x) {
    const al = x[0], be = x[1];
    const vb = [V * Math.cos(al) * Math.cos(be), -V * Math.sin(al) * Math.cos(be), V * Math.cos(al) * Math.sin(be)];
    const vw = mv(R, vb);
    const y = new Float64Array(13);
    y[1] = h;
    y[3] = vw[0]; y[4] = vw[1]; y[5] = vw[2];
    y[6] = qBase[0]; y[7] = qBase[1]; y[8] = qBase[2]; y[9] = qBase[3];
    y[10] = p; y[11] = x[2]; y[12] = x[3];
    return y;
  }
  function rhs4(x) {
    const y = stateFromX(x);
    const out = new Float64Array(13);
    I.deriv(y, out);
    const vw = [y[3], y[4], y[5]], vwd = [out[3], out[4], out[5]];
    const om = [p, x[2], x[3]];
    const vb = mTv(R, vw);
    const cross = [om[1] * vb[2] - om[2] * vb[1], om[2] * vb[0] - om[0] * vb[2], om[0] * vb[1] - om[1] * vb[0]];
    const rtv = mTv(R, vwd);
    const vbd = [-cross[0] + rtv[0], -cross[1] + rtv[1], -cross[2] + rtv[2]];
    const ub = vb[0], vbb = vb[1], wb = vb[2];
    const ubd = vbd[0], vbdY = vbd[1], wbd = vbd[2];
    const aldot = (ub * (-vbdY) - (-vbb) * ubd) / (ub * ub + vbb * vbb);
    const bedot = (ub * wbd - wb * ubd) / (ub * ub + wb * wb);
    return [aldot, bedot, out[11], out[12]];
  }
  const x0 = [0, 0, 0, 0];
  const f0 = rhs4(x0);
  const eps = 1e-7;
  const J = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let j = 0; j < 4; j++) {
    const xp = x0.slice(); xp[j] += eps;
    const fp = rhs4(xp);
    for (let i = 0; i < 4; i++) J[i][j] = (fp[i] - f0[i]) / eps;
  }
  return { J, eigs: polyEig(J), rhs4 };
}

/** 陀螺稳定因子 Sg（McCoy 标准式，文献调研确认形式）：Sg = Ix²p²/(4 Iy q S d |C_Mα|) */
function gyroStability(SH, atmAtm, aeroCo, h, V, p) {
  // 用 physics 的 atmosphere/aeroAt 计算，避免重复实现
  return null;
}
module.exports = { linearize, qFromAxis, Rof };
