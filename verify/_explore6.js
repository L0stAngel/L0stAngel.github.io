/* verify/_explore6.js — 高自转失稳机理诊断 */
'use strict';
const path = require('path');
const { loadNative } = require('./lib/native-core');
const { createRefSim } = require('./lib/refsim');
const BASE = path.join(__dirname, 'baseline', 'physics-baseline.js');

const PATCH = {
  magnus0: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;'],
  rollDamp0: [/var Mx = damp \* \(-0\.06\) \* wx;/, 'var Mx = 0;'],
  magnusFlip: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = -qd * S * d * 1.30 * (wx * d / V);']
};
function trial(name, patches, spin, dt, maxTime) {
  const pv = loadNative(BASE, { patches });
  const R = createRefSim(pv.internals);
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 1e-3, wy: 0, dt, maxTime });
  let amax = 0, amaxT = 0;
  for (const s of r.samples) if (Math.abs(s.alpha) > amax) { amax = Math.abs(s.alpha); amaxT = s.t; }
  const last = r.samples[r.samples.length - 1];
  const alphaSeries = [1, 2, 5, 10, 15, 20, 30, 40, 50, Math.min(60, maxTime)].filter(t => t <= maxTime).map(t => r.samples[Math.min(r.samples.length - 1, Math.round(t / 0.02))].alpha.toFixed(1));
  console.log(name.padEnd(22), 'amax=' + amax.toFixed(2) + '@' + amaxT.toFixed(1) + 's', 'alpha:', alphaSeries.join(','), ' V=' + last.speed.toFixed(0), ' wx=' + last.wx.toFixed(0));
  return { amax, amaxT };
}
console.log('--- spin=1178 (1:18 缠度), wz=1e-3, dt=2e-4 ---');
trial('magnus0, 60s', [PATCH.magnus0], 1178, 2e-4, 60);
trial('baseline, 60s', [], 1178, 2e-4, 60);
trial('magnusFlip, 60s', [PATCH.magnusFlip], 1178, 2e-4, 60);
console.log('--- 关闭滚转阻尼（自转不衰减）---');
trial('magnus0 + rollDamp0', [PATCH.magnus0, PATCH.rollDamp0], 1178, 2e-4, 60);
trial('baseline + rollDamp0', [PATCH.rollDamp0], 1178, 2e-4, 60);
trial('magnusFlip+rollDamp0', [PATCH.magnusFlip, PATCH.rollDamp0], 1178, 2e-4, 60);
console.log('--- 不同自转、magnus0、20s（看动态稳定边界）---');
for (const spin of [600, 800, 900, 1000, 1100, 1178, 1300]) {
  const pv = loadNative(BASE, { patches: [PATCH.magnus0] });
  const R = createRefSim(pv.internals);
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 20 });
  let amax = 0, at = 0; for (const s of r.samples) if (Math.abs(s.alpha) > amax) { amax = Math.abs(s.alpha); at = s.t; }
  const last = r.samples[r.samples.length - 1];
  console.log('spin=' + spin, 'amax=' + amax.toFixed(2) + '°@' + at.toFixed(1) + 's', 'wx(20s)=' + last.wx.toFixed(0));
}
// 无滚转阻尼时自转是否恒定 + 基线自转衰减率
console.log('--- 基线 wx 历程与 8.5° 振荡周期 ---');
const pv = loadNative(BASE);
const R = createRefSim(pv.internals);
const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1178, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 30 });
console.log('wx:', [0, 2, 5, 10, 15, 20, 25, 30].map(t => r.samples[Math.round(t / 0.02)].wx.toFixed(0)).join(','));
let peaks = [];
for (let i = 1; i < r.samples.length - 1; i++) {
  const a0 = Math.abs(r.samples[i - 1].alpha), a1 = Math.abs(r.samples[i].alpha), a2 = Math.abs(r.samples[i + 1].alpha);
  if (a1 > a0 && a1 >= a2 && a1 > 1) peaks.push({ t: r.samples[i].t, a: r.samples[i].alpha });
}
console.log('alpha peaks:', peaks.slice(0, 20).map(p => p.t.toFixed(2) + ':' + p.a.toFixed(1)).join(' '));
