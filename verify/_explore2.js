/* verify/_explore2.js — 探索 2：高自转稳定性、破片、性能（临时） */
'use strict';
const path = require('path');
const { loadPhysics } = require('./lib/load-physics');
const { createRefSim } = require('./lib/refsim');
const phys = path.join(__dirname, '..', 'physics.js');

function variant(patches, seed) { return loadPhysics(phys, { seed: seed == null ? 42 : seed, patches }); }

console.log('=== A. 高自转：零扰动 + 小扰动增长（dt=2e-4, 15s）===');
for (const spin of [0, 18, 300, 600, 900, 1050, 1200, 1350, 1500]) {
  const P = variant();
  const R = createRefSim(P.internals);
  const t0 = process.hrtime.bigint();
  const r0 = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 0, wy: 0, dt: 2e-4, maxTime: 15 });
  const r1 = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 0.01, wy: 0, dt: 2e-4, maxTime: 15 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const a = (r) => { let m = 0; for (const s of r.samples) m = Math.max(m, Math.abs(s.alpha)); return m; };
  console.log('spin=' + String(spin).padStart(4), 'wz=0: amax=' + a(r0).toExponential(2), ' wz=1e-2: amax=' + a(r1).toFixed(2) + '°',
    ' α(1s)=' + r1.samples[50].alpha.toFixed(3), ' α(5s)=' + r1.samples[250].alpha.toFixed(2), ' [' + ms.toFixed(0) + 'ms]');
}

console.log('\n=== B. 归因：Magnus / 静稳定裕度 / 滚转阻尼（spin=1200, wz=0.01, dt=2e-4）===');
const variants = {
  baseline: [],
  magnus0: [[/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;']],
  xcg330: [[/xcgD: 2\.90,/, 'xcgD: 3.30,']],
  xcg310: [[/xcgD: 2\.90,/, 'xcgD: 3.10,']],
  rollDamp0: [[/var Mx = damp \* \(-0\.06\) \* wx;/, 'var Mx = 0;']],
  magnus0_xcg330: [
    [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;'],
    [/xcgD: 2\.90,/, 'xcgD: 3.30,']
  ]
};
for (const [name, patches] of Object.entries(variants)) {
  const P = variant(patches);
  const R = createRefSim(P.internals);
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1200, wz: 0.01, wy: 0, dt: 2e-4, maxTime: 15 });
  let amax = 0, at = 0;
  for (const s of r.samples) if (Math.abs(s.alpha) > amax) { amax = Math.abs(s.alpha); at = s.t; }
  console.log(name.padEnd(18), 'amax=' + amax.toFixed(2) + '° @t=' + at.toFixed(1), ' α(1,3,5,10,15s)=',
    [1, 3, 5, 10, 15].map(t => r.samples[Math.min(r.samples.length - 1, Math.round(t / 0.02))].alpha.toFixed(2)).join(','),
    ' V(15s)=' + r.samples[r.samples.length - 1].speed.toFixed(0), ' wx(15s)=' + r.samples[r.samples.length - 1].wx.toFixed(0));
}

console.log('\n=== C. 破片积分步长收敛（固定种子）===');
const P_frag = loadPhysics(phys, { seed: 20240601, patches: [[/    var dt = 0\.01;/, '    var dt = (cfg && cfg.fragDt) || 0.01;']] });
for (const fragDt of [0.01, 0.005, 0.0025, 0.001]) {
  P_frag.setSeed(20240601);
  const t0 = process.hrtime.bigint();
  const r = P_frag.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420, fragDt });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const f = r.fragments;
  console.log('fragDt=' + fragDt, 'r90=' + f.r90.toFixed(1), 'r50=' + f.r50.toFixed(1), 'Vavg=' + f.avgLandV.toFixed(2),
    'dur=' + f.duration.toFixed(2), 'kill=' + f.killCount, 'E=' + (f.totalEnergy / 1000).toFixed(1),
    'maxR=' + f.maxRadius.toFixed(1), 'meanM=' + (f.meanMass * 1000).toFixed(2), 'maxM=' + (f.maxMass * 1000).toFixed(1), '[' + ms.toFixed(0) + 'ms]');
}

console.log('\n=== D. 质量守恒 / Mott / R90 种子离散 ===');
const P0 = loadPhysics(phys, { seed: 20240601 });
const r = P0.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
const f = r.fragments;
let sumM = 0; for (const x of f.list) sumM += x.m;
console.log('sum mass =', sumM.toFixed(6), 'kg (casing=' + P0.internals.SHELL.casing + ')  mean=', (sumM / 420).toFixed(4),
  ' mu=', f.mu.toFixed(5), ' meanMass=', f.meanMass.toFixed(5), ' maxMass=', f.maxMass.toFixed(5));
console.log('zoneCount=', f.zoneCount, ' landed=', f.landedCount, '/', f.count, ' vGurney=', f.vGurney.toFixed(2));
// Mott 原始采样器统计
const mu = f.mu;
P0.setSeed(12345);
const N = 200000; let s1 = 0, s2 = 0, mx = 0;
for (let i = 0; i < N; i++) { const m = P0.internals.sampleMottMass(mu); s1 += m; s2 += m * m; if (m > mx) mx = m; }
const em = s1 / N, var_ = s2 / N - em * em;
console.log('Mott sampler: mean=' + (em * 1000).toFixed(3) + 'g (2mu=' + (2 * mu * 1000).toFixed(3) + 'g)',
  ' var=' + ((var_ / (4 * mu * mu))).toFixed(4) + '×4μ² (理论 5×4μ²=20μ²)',
  ' CV=' + (Math.sqrt(var_) / em).toFixed(3) + ' (理论 ' + Math.sqrt(20) / 2 + ')  max=' + (mx * 1000).toFixed(1) + 'g');
// R90 种子离散
const stats = { r90: [], r50: [], duration: [], kill: [], maxR: [], E: [] };
for (let seed = 1; seed <= 25; seed++) {
  P0.setSeed(seed * 7919);
  const rr = P0.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
  const ff = rr.fragments;
  stats.r90.push(ff.r90); stats.r50.push(ff.r50); stats.duration.push(ff.duration);
  stats.kill.push(ff.killCount); stats.maxR.push(ff.maxRadius); stats.E.push(ff.totalEnergy / 1000);
}
for (const [k, arr] of Object.entries(stats)) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
  console.log(k.padEnd(8), 'mean=' + m.toFixed(2), ' sd=' + sd.toFixed(2), ' cv=' + (sd / m * 100).toFixed(1) + '%', ' range=[' + Math.min(...arr).toFixed(2) + ',' + Math.max(...arr).toFixed(2) + ']');
}

console.log('\n=== E. 性能分解 ===');
// 预热
for (let i = 0; i < 3; i++) P0.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
function best(fn, n) { let b = 1e9; for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; } return b; }
P0.setSeed(1);
const full = best(() => P0.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 }), 5);
const simObj = P0.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
const fragOnly = best(() => P0.internals.simulateFragments(simObj, { fragCount: 420 }), 5);
const R0 = createRefSim(P0.internals);
const ballistic = best(() => R0.simulateRef({ v0: 450, angle: 45, hBoom: 12, spin: 18, dt: 1e-3 }), 5);
console.log('simulate total =', full.toFixed(2), 'ms; simulateFragments alone =', fragOnly.toFixed(2), 'ms; ballistic(refsim,RK4) =', ballistic.toFixed(2), 'ms; => fragment share ≈', (fragOnly / full * 100).toFixed(0) + '%');
// dt 参数化后耗时
for (const dt of [0.002, 0.001, 0.0005, 0.00025]) {
  const Pd = loadPhysics(phys, { seed: 1, patches: [[/    var dt = 0\.001;/, '    var dt = (cfg.dt != null ? cfg.dt : 0.001);']] });
  // 预热
  Pd.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 50, dt });
  const t = best(() => Pd.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 50, dt }), 5);
  console.log('dt=' + dt, ' simulate(frag=50) =', t.toFixed(2), 'ms');
}
