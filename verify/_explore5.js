/* verify/_explore5.js — 补齐剩余量化（临时） */
'use strict';
const path = require('path');
const { loadNative } = require('./lib/native-core');
const { createRefSim } = require('./lib/refsim');
const { isa } = require('./lib/isa');
const { summarize, quantile } = require('./lib/stats');
const BASE = path.join(__dirname, 'baseline', 'physics-baseline.js');

console.log('=== (a,b) 高自转稳定性判据对 dt 的收敛（20s）===');
const P0 = loadNative(BASE);
const variants = {
  baseline: null,
  magnus0: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;'],
  magnusFlip: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = -qd * S * d * 1.30 * (wx * d / V);'],
  magnus01: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = qd * S * d * 0.10 * (wx * d / V);']
};
for (const [name, patch] of Object.entries(variants)) {
  const pv = loadNative(BASE, { patches: patch ? [patch] : [] });
  const R = createRefSim(pv.internals);
  const row = [];
  for (const dt of [4e-4, 2e-4, 1e-4, 5e-5]) {
    const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1200, wz: 1e-4, wy: 0, dt, maxTime: 20 });
    let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
    row.push('dt=' + dt + ':amax=' + amax.toFixed(2) + '/amaxEnd=' + Math.abs(r.samples[r.samples.length - 1].alpha).toFixed(2));
  }
  console.log(name.padEnd(12), row.join('  '));
}

console.log('\n=== (c) 落点半径分布 / R90 口径 ===');
const P = loadNative(BASE);
for (const seed of [20240601, 1, 2]) {
  P.setSeed(seed);
  const r = P.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
  const f = r.fragments;
  const landed = f.list.filter(x => x.landed);
  const rs = landed.map(x => x.radius).sort((a, b) => a - b);
  const ms = landed.map(x => x.m);
  const es = landed.map(x => x.energy);
  const totM = ms.reduce((a, b) => a + b, 0), totE = es.reduce((a, b) => a + b, 0);
  // 质量/能量加权 R90
  function weightedR90(values, weights, frac) {
    const idx = values.map((v, i) => i).sort((i, j) => values[i] - values[j]);
    let acc = 0; const target = weights.reduce((a, b) => a + b, 0) * frac;
    for (const i of idx) { acc += weights[i]; if (acc >= target) return values[i]; }
    return values[idx[idx.length - 1]];
  }
  const bins = new Array(12).fill(0);
  for (const v of rs) { const k = Math.min(11, Math.floor(v / (900 / 12))); bins[k]++; }
  console.log('seed=' + seed, 'r50=' + quantile(rs, 0.5).toFixed(1), 'r90=' + quantile(rs, 0.9).toFixed(1),
    'massW_r90=' + weightedR90(landed.map(x => x.radius), ms, 0.9).toFixed(1),
    'energyW_r90=' + weightedR90(landed.map(x => x.radius), es, 0.9).toFixed(1),
    'maxR=' + rs[rs.length - 1].toFixed(1), 'E_tot_kJ=' + (totE / 1000).toFixed(0));
  console.log('  radius histogram (75m bins):', bins.map((n, i) => (i * 75) + ':' + n).join(' '));
  // 质量分布与半径关系
  const heavy = landed.filter(x => x.m > 0.05).map(x => x.radius);
  console.log('  m>50g 破片数=' + heavy.length, ' 其 r50=' + (heavy.length ? quantile(heavy.slice().sort((a, b) => a - b), 0.5).toFixed(1) : '-'),
    ' m<10g 破片数=' + landed.filter(x => x.m < 0.01).length);
}

console.log('\n=== (d) 3DOF 质点弹道交叉核对 ===');
// 用 same aeroAt 表的 Cx0(M)，忽略 α；RK4 dt=1ms
const I = P0.internals;
function threeDof(v0, angleDeg, hBoom) {
  let x = 0, y = 0, vx = v0 * Math.cos(angleDeg * Math.PI / 180), vy = v0 * Math.sin(angleDeg * Math.PI / 180);
  const dt = 0.001; let t = 0, maxAlt = 0;
  const acc = (x, y, vx, vy) => {
    const V = Math.hypot(vx, vy), atm = I.atmosphere(y), co = I.aeroAt(V / atm.a), q = 0.5 * atm.rho * V * V;
    const D = q * I.SHELL.S * co[0];
    return [-D * vx / V / I.SHELL.mass, -D * vy / V / I.SHELL.mass - 9.80665];
  };
  while (t < 200) {
    const oldY = y;
    const k1 = [vx, vy, ...acc(x, y, vx, vy)];
    const k2 = [vx + k1[2] * dt / 2, vy + k1[3] * dt / 2, ...acc(x + k1[0] * dt / 2, y + k1[1] * dt / 2, vx + k1[2] * dt / 2, vy + k1[3] * dt / 2)];
    const k3 = [vx + k2[2] * dt / 2, vy + k2[3] * dt / 2, ...acc(x + k2[0] * dt / 2, y + k2[1] * dt / 2, vx + k2[2] * dt / 2, vy + k2[3] * dt / 2)];
    const k4 = [vx + k3[2] * dt, vy + k3[3] * dt, ...acc(x + k3[0] * dt, y + k3[1] * dt, vx + k3[2] * dt, vy + k3[3] * dt)];
    x += dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    y += dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    vx += dt * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
    vy += dt * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) / 6;
    t += dt;
    if (y > maxAlt) maxAlt = y;
    if (vy < 0 && oldY > hBoom && y <= hBoom) return { t: t - dt + dt * (oldY - hBoom) / (oldY - y), x: x, maxAlt, V: Math.hypot(vx, vy) };
  }
  return { t, x, maxAlt, V: Math.hypot(vx, vy) };
}
P0.setSeed(20240601);
const r6 = P0.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 100 });
const r3 = threeDof(450, 45, 12);
console.log('6DOF: t=' + r6.flightTime.toFixed(3) + ' R=' + r6.range.toFixed(1) + ' alt=' + r6.maxAlt.toFixed(1) + ' Vimp=' + r6.boom.speed.toFixed(1));
console.log('3DOF: t=' + r3.t.toFixed(3) + ' R=' + r3.x.toFixed(1) + ' alt=' + r3.maxAlt.toFixed(1) + ' Vimp=' + r3.V.toFixed(1));
console.log('差异: dR=' + (r6.range - r3.x).toFixed(1) + 'm (' + ((r6.range / r3.x - 1) * 100).toFixed(2) + '%)  dt=' + (r6.flightTime - r3.t).toFixed(3) + 's  dAlt=' + (r6.maxAlt - r3.maxAlt).toFixed(1) + 'm');
const vac = { R: 450 * 450 / 9.80665, alt: (450 * Math.sin(Math.PI / 4)) ** 2 / (2 * 9.80665), t: 2 * 450 * Math.sin(Math.PI / 4) / 9.80665 };
console.log('真空对比: R=' + vac.R.toFixed(0) + ' (实际 ' + (r6.range / vac.R * 100).toFixed(1) + '%)  alt=' + vac.alt.toFixed(0) + ' (' + (r6.maxAlt / vac.alt * 100).toFixed(1) + '%)  t=' + vac.t.toFixed(1) + ' (' + (r6.flightTime / vac.t * 100).toFixed(1) + '%)');

console.log('\n=== (e) 78J 阈值与统计口径 ===');
const f = r6.fragments; // fragCount=100 different; rerun 420
P0.setSeed(20240601);
const rr = P0.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
const ff = rr.fragments;
const landed = ff.list.filter(x => x.landed);
const es = landed.map(x => x.energy), ms2 = landed.map(x => x.m), rs2 = landed.map(x => x.radius);
const totE = es.reduce((a, b) => a + b, 0);
console.log('landed=' + landed.length + '/' + ff.count, ' kill(>78J)=' + ff.killCount, '(' + (ff.killCount / ff.count * 100).toFixed(0) + '%)',
  ' E_total=' + (totE / 1000).toFixed(0) + 'kJ', ' mean KE=' + (totE / landed.length).toFixed(0) + 'J',
  ' E_max=' + Math.max(...es).toFixed(0) + 'J');
const idx = landed.map((x, i) => i).sort((a, b) => es[a] - es[b]);
let acc = 0; const target = totE * 0.9; let r90E = 0;
for (const i of idx) { acc += es[i]; if (acc >= target) { r90E = landed[i].radius; break; } }
console.log('能量加权 R90=' + r90E.toFixed(1), ' 等权 R90=' + ff.r90.toFixed(1), ' 质量加权 R90 见上');
const kill = landed.filter(x => x.energy > 78);
console.log('78J 破片: r50=' + quantile(kill.map(x => x.radius).sort((a, b) => a - b), 0.5).toFixed(1), ' r90=' + quantile(kill.map(x => x.radius).sort((a, b) => a - b), 0.9).toFixed(1), ' 质量合计=' + (kill.reduce((a, x) => a + x.m, 0)).toFixed(2) + 'kg');

console.log('\n=== (f) Mott KS 检验 ===');
const mu = ff.mu;
P0.setSeed(777);
const smp = []; for (let i = 0; i < 20000; i++) smp.push(P0.internals.sampleMottMass(mu));
const cdf = (m) => 1 - Math.exp(-Math.sqrt(m / mu));
const { ksTest } = require('./lib/stats');
const ks = ksTest(smp, cdf);
console.log('Mott KS: D=' + ks.D.toFixed(5), 'p≈' + ks.p.toFixed(3), ' n=' + ks.n, ' mean=' + (summarize(smp).mean * 1000).toFixed(2) + 'g (2mu=' + (2 * mu * 1000).toFixed(1) + 'g)',
  ' cv=' + summarize(smp).cv.toFixed(3) + ' (理论 2.236)');

console.log('\n=== (g) 滚转阻尼积分 / 能量 ===');
const samples = rr.samples;
const wx0 = samples[0].wx, wxEnd = samples[samples.length - 1].wx;
console.log('wx0=' + wx0 + ' wxEnd=' + wxEnd.toFixed(3), ' 衰减=' + ((1 - wxEnd / wx0) * 100).toFixed(1) + '%',
  ' 积分K=ln(wx0/wxEnd)/|C_lp|=' + (Math.log(wx0 / wxEnd) / 0.06).toFixed(2));
const KE0 = 0.5 * 10.5 * ff.vGurney * ff.vGurney;
console.log('Gurney 总动能=0.5*M*vG^2=' + (KE0 / 1000).toFixed(0) + ' kJ; 破片初速动能(含动爆前 shell 系)=',
  (ff.list.reduce((a, x) => a + 0.5 * x.m * x.v0 * x.v0, 0) / 1000).toFixed(0), 'kJ');
console.log('破片初速统计: v0 mean=' + summarize(ff.list.map(x => x.v0)).mean.toFixed(1), ' min=' + summarize(ff.list.map(x => x.v0)).min.toFixed(0), ' max=' + summarize(ff.list.map(x => x.v0)).max.toFixed(0));
