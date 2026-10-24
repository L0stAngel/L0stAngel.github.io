/* verify/_explore4.js — 侧偏来源/防护区/符号实验（临时） */
'use strict';
const path = require('path');
const { loadNative } = require('./lib/native-core');
const { createRefSim } = require('./lib/refsim');
const BASE = path.join(__dirname, 'baseline', 'physics-baseline.js');

const P = loadNative(BASE);
const R = createRefSim(P.internals);
console.log('=== spin=18, wz=0 侧偏随 dt 收敛 ===');
for (const dt of [0.004, 0.002, 0.001, 0.0005, 0.00025, 0.0001]) {
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 12, spin: 18, wz: 0, wy: 0, dt });
  console.log('dt=' + dt, 'z=' + r.impactZ.toFixed(4), 't=' + r.flightTime.toFixed(4), 'R=' + r.range.toFixed(2), 'amax=' + r.maxAlpha.toFixed(4));
}
console.log('\n=== 侧偏分解: spin/wz/wy 组合（dt=0.5ms）===');
const combos = [
  ['spin18,wz0,wy0', 18, 0, 0], ['spin18,wz1.25,wy0', 18, 1.25, 0],
  ['spin0,wz0,wy0', 0, 0, 0], ['spin0,wz1.25,wy0', 0, 1.25, 0],
  ['spin0,wz0,wy1.25', 0, 0, 1.25], ['spin18,wz0,wy1.25', 18, 0, 1.25],
  ['spin18,wz-1.25,wy0', 18, -1.25, 0], ['spin1200,wz0,wy0', 1200, 0, 0]
];
for (const [name, spin, wz, wy] of combos) {
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 12, spin, wz, wy, dt: 0.0005 });
  console.log(name.padEnd(20), 'z=' + r.impactZ.toFixed(3), 'amax=' + r.maxAlpha.toFixed(2), 't=' + r.flightTime.toFixed(2), 'R=' + r.range.toFixed(1), 'wxEnd=' + r.samples[r.samples.length - 1].wx.toFixed(2));
}

console.log('\n=== α 防护区（ub > 0.2V guard）统计 ===');
function guardStats(run) {
  // 用 refsim 的 samples 重建：samples 里 alpha 已受 guard 影响。这里统计 α 达到 ±70° 的样本比例
  let n70 = 0, n78 = 0;
  for (const s of run.samples) { if (Math.abs(s.alpha) > 70) n70++; if (Math.abs(s.alpha) > 78) n78++; }
  return { n70, n78, n: run.samples.length };
}
for (const spin of [0, 18, 300, 600, 1200]) {
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 20 });
  let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
  console.log('spin=' + spin, 'amax=' + amax.toFixed(1), JSON.stringify(guardStats(r)));
}

console.log('\n=== Magnus 符号翻转 / 系数扫描（线性化与非线性）===');
for (const [name, patch] of [
  ['baseline', null],
  ['magnus=0', [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;']],
  ['magnus=-1.3', [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = -qd * S * d * 1.30 * (wx * d / V);']],
  ['magnus=0.3', [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = qd * S * d * 0.30 * (wx * d / V);']],
  ['magnus=0.1', [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = qd * S * d * 0.10 * (wx * d / V);']]
]) {
  const pv = loadNative(BASE, { patches: patch ? [patch] : [] });
  const rv = createRefSim(pv.internals);
  const r = rv.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1200, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 20 });
  let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
  console.log(name.padEnd(14), 'spin=1200 amax(20s)=' + amax.toFixed(2) + '°', 'V(20s)=' + r.samples[r.samples.length - 1].speed.toFixed(0), 'wx(20s)=' + r.samples[r.samples.length - 1].wx.toFixed(0));
}

console.log('\n=== 基线轨迹细节 ===');
P.setSeed(20240601);
const r = P.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
console.log('flightTime', r.flightTime.toFixed(3), 'range', r.range.toFixed(1), 'maxAlt', r.maxAlt.toFixed(1), 'maxQ', r.maxQ.toFixed(1), 'maxMach', r.maxMach.toFixed(3), 'maxAlpha', r.maxAlpha.toFixed(3));
const s = r.samples;
console.log('alpha at t =', [0, 2, 5, 10, 20, 30, 40, 46].map(t => { const i = Math.min(s.length - 1, Math.round(t / 0.02)); return s[i].alpha.toFixed(2); }).join(' / '));
console.log('theta at t =', [0, 2, 5, 10, 20, 30, 40, 46].map(t => { const i = Math.min(s.length - 1, Math.round(t / 0.02)); return s[i].theta.toFixed(1); }).join(' / '));
console.log('wx at t =', [0, 2, 5, 10, 20, 30, 40, 46].map(t => { const i = Math.min(s.length - 1, Math.round(t / 0.02)); return s[i].wx.toFixed(1); }).join(' / '));
const b = r.boom;
console.log('boom', JSON.stringify({ t: b.t, x: b.x, y: b.y, z: b.z, speed: b.speed, alpha: b.alpha, theta: b.theta }));
// 攻角包络衰减
const peaks = [];
for (let i = 1; i < Math.min(s.length - 1, 400); i++) {
  if (Math.abs(s[i].alpha) > Math.abs(s[i - 1].alpha) && Math.abs(s[i].alpha) >= Math.abs(s[i + 1].alpha) && Math.abs(s[i].alpha) > 0.2) peaks.push({ t: s[i].t, a: s[i].alpha });
}
console.log('alpha peaks (first 10):', peaks.slice(0, 10).map(p => p.t.toFixed(2) + 's:' + p.a.toFixed(2)).join(' '));
if (peaks.length > 3) {
  const a1 = Math.abs(peaks[0].a), aN = Math.abs(peaks[Math.min(peaks.length - 1, 8)].a);
  const dtp = peaks[Math.min(peaks.length - 1, 8)].t - peaks[0].t;
  console.log('log-decrement(前9峰):', Math.log(a1 / aN).toFixed(3), '时间', dtp.toFixed(2), '=> 包络衰减率', (Math.log(a1 / aN) / dtp).toFixed(3), '/s');
}
