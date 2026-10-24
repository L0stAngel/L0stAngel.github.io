/* verify/_explore3.js — 线性化稳定性 / 高自转数值确认 */
'use strict';
const path = require('path');
const { loadPhysics } = require('./lib/load-physics');
const { createRefSim } = require('./lib/refsim');
const phys = path.join(__dirname, '..', 'physics.js');

const P = loadPhysics(phys, { seed: 1 });
const I = P.internals;
const SH = I.SHELL;

// 线性化 4x4：x = [alpha, beta, wy, wz]
function linearMatrix(h, V, p, opts) {
  opts = opts || {};
  const atm = I.atmosphere(h);
  const mach = V / atm.a;
  const co = I.aeroAt(mach);
  const q = 0.5 * atm.rho * V * V;
  const S = SH.S, d = SH.D;
  const a = q * S * co[1] / (SH.mass * V);
  const mzA = -co[1] * (co[2] - SH.xcgD);
  const k = q * S * d * mzA / SH.Iy;
  const damp = q * S * d * d / (2 * V);
  const cm = damp * -50.0 / SH.Iy;
  const magK = opts.magnus === false ? 0 : q * S * d * 1.30 * (p * d / V);
  const g = magK / SH.Iy;
  const rp = (SH.Iy - SH.Ix) / SH.Iy * p;
  const sp = -rp;
  return [
    [-a, -p, 0, 1],
    [p, a, 1, 0],
    [g, k, cm, rp],
    [k, -g, sp, cm]
  ];
}
function eig2x2real(M) {
  // 返回复数特征值（简单 QR 迭代不够稳；用多项式法求 2x2 行列块？这里用幂法求主导 |λ|
  // 4x4 用简单 unshifted QR（实数矩阵，双位移）较复杂——改用特征多项式求根（Durand-Kerner）
  return null;
}
function polyEig(M) {
  // 特征多项式系数（Faddeev-LeVerrier）
  const n = M.length;
  let A = M.map(r => r.slice());
  const Iden = A.map((r, i) => r.map((_, j) => i === j ? 1 : 0));
  let c = [1];
  let B = Iden.map(r => r.slice());
  for (let k = 1; k <= n; k++) {
    // B = A*B
    const NB = A.map((row, i) => B[0].map((_, j) => row.reduce((s, v, t) => s + v * B[t][j], 0)));
    // trace
    let tr = 0; for (let i2 = 0; i2 < n; i2++) tr += NB[i2][i2];
    const ck = -tr / k;
    c.push(ck);
    // B = NB + ck*I
    for (let i2 = 0; i2 < n; i2++) for (let j2 = 0; j2 < n; j2++) B[i2][j2] = NB[i2][j2] + (i2 === j2 ? ck : 0);
  }
  // Durand-Kerner 求根
  const coeff = c; // c[0] x^n + c[1] x^(n-1)+...
  const n2 = coeff.length - 1;
  const roots = [];
  for (let i = 0; i < n2; i++) roots.push([Math.cos(2 * Math.PI * i / n2 + 0.4) * 1.2, Math.sin(2 * Math.PI * i / n2 + 0.4) * 1.2]);
  const evalP = (z) => {
    let re = coeff[0], im = 0;
    for (let i = 1; i <= n2; i++) {
      const nre = re * z[0] - im * z[1] + coeff[i];
      const nim = re * z[1] + im * z[0];
      re = nre; im = nim;
    }
    return [re, im];
  };
  const cdiv = (a, b) => {
    const den = b[0] * b[0] + b[1] * b[1];
    return [(a[0] * b[0] + a[1] * b[1]) / den, (a[1] * b[0] - a[0] * b[1]) / den];
  };
  for (let it = 0; it < 200; it++) {
    for (let i = 0; i < n2; i++) {
      let num = evalP(roots[i]);
      let den = [1, 0];
      for (let j = 0; j < n2; j++) {
        if (j === i) continue;
        const diff = [roots[i][0] - roots[j][0], roots[i][1] - roots[j][1]];
        const prod = [den[0] * diff[0] - den[1] * diff[1], den[0] * diff[1] + den[1] * diff[0]];
        den = prod;
      }
      const q = cdiv(num, den);
      roots[i] = [roots[i][0] - q[0], roots[i][1] - q[1]];
    }
  }
  return roots.map(r => ({ re: r[0], im: r[1], abs: Math.hypot(r[0], r[1]) }));
}

console.log('=== 线性化特征值 vs 自转（h=0, V=450）===');
console.log('spin  Sg     |λ|max   Reλmax  freq(Hz)  Magnus  mode');
for (const p of [0, 18, 100, 300, 600, 900, 1200, 1500, 2000, 3000]) {
  const M = linearMatrix(0, 450, p, {});
  const ev = polyEig(M).sort((a, b) => b.re - a.re);
  // Sg 公式
  const atm = I.atmosphere(0), co = I.aeroAt(450 / atm.a), q = 0.5 * atm.rho * 450 * 450;
  const Cma = co[1] * (co[2] - SH.xcgD);
  const Sg = (SH.Ix * p) ** 2 / (2 * atm.rho * SH.Iy * SH.S * SH.D * 450 * 450 * Cma);
  console.log(String(p).padStart(5), Sg.toFixed(3).padStart(8), '|', ev[0].abs.toFixed(3).padStart(8),
    ' ', ev[0].re.toFixed(4).padStart(9), ' ', (Math.abs(ev[0].im) / (2 * Math.PI)).toFixed(3).padStart(7),
    '  Magnus:', linearMatrix(0, 450, p, { magmus: false }) && '');
}
console.log('\n=== 同表（Magnus 关闭）===');
for (const p of [0, 300, 600, 900, 1200, 1500, 2000, 3000]) {
  const ev = polyEig(linearMatrix(0, 450, p, { magnus: false })).sort((a, b) => b.re - a.re);
  console.log(String(p).padStart(5), '|λ|max=', ev[0].abs.toFixed(3), ' Reλmax=', ev[0].re.toFixed(4), ' freq=', (Math.abs(ev[0].im) / (2 * Math.PI)).toFixed(3));
}
console.log('\n=== 减小静稳定裕度（Magnus 开）===');
for (const xcgD of [2.90, 3.10, 3.30, 3.50, 3.70, 3.90]) {
  const orig = SH.xcgD; SH.xcgD = xcgD;
  const ev = polyEig(linearMatrix(0, 450, 1200, {})).sort((a, b) => b.re - a.re);
  const atm = I.atmosphere(0), co = I.aeroAt(450 / atm.a);
  const Cma = co[1] * (co[2] - xcgD);
  const Sg = (SH.Ix * 1200) ** 2 / (2 * atm.rho * SH.Iy * SH.S * SH.D * 450 * 450 * Cma);
  console.log('xcgD=' + xcgD, 'margin=' + (co[2] - xcgD).toFixed(2) + 'cal  Sg=' + Sg.toFixed(2), ' Reλmax=' + ev[0].re.toFixed(4), ' |λ|=' + ev[0].abs.toFixed(3));
  SH.xcgD = orig;
}

console.log('\n=== 高分辨率确认 spin=1200, wz=0（数值种子）===');
for (const dt of [2e-4, 1e-4, 5e-5]) {
  const R = createRefSim(I);
  const t0 = process.hrtime.bigint();
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1200, wz: 0, wy: 0, dt, maxTime: 10 });
  let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
  console.log('dt=' + dt, 'amax(10s)=' + amax.toFixed(3) + '°', ' V(10s)=' + r.samples[r.samples.length - 1].speed.toFixed(1),
    ' [' + (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0) + 'ms]');
}
console.log('\n=== 高分辨率确认 spin=1200, wz=1e-6（真实小扰动增长率）===');
for (const dt of [1e-4, 5e-5]) {
  const R = createRefSim(I);
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1200, wz: 1e-6, wy: 0, dt, maxTime: 8 });
  const alphas = [0.5, 1, 2, 4, 6, 8].map(t => r.samples[Math.min(r.samples.length - 1, Math.round(t / 0.02))].alpha);
  console.log('dt=' + dt, 'alpha(0.5,1,2,4,6,8s)=', alphas.map(a => a.toExponential(2)).join(', '));
}
