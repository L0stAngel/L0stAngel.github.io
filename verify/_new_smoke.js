/* verify/_new_smoke.js — 新版内核冒烟 + McCoy 算例初测 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));

console.log('SHELL:', JSON.stringify(B.SHELL));
console.log('ENV_DEFAULT:', JSON.stringify(B.ENV_DEFAULT));
console.log('TAB keys:', Object.keys(B.TAB).join(','));

// aeroAt 调用测试
try { console.log('aeroAt(1.0)=', JSON.stringify(B.aeroAt(1.0))); } catch (e) { console.log('aeroAt ERROR:', e.message); }
try { console.log('atmosphere(20000)=', JSON.stringify(B.atmosphere(20000))); } catch (e) { console.log('atmosphere ERROR:', e.message); }

// 默认仿真
let t0 = process.hrtime.bigint();
const r = B.simulate({ v0: 450, angle: 45, hBoom: 12, seed: 1 });
console.log('default simulate ms=', (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1));
console.log(JSON.stringify({ dt: r.dt, flightTime: r.flightTime, range: r.range, maxAlt: r.maxAlt, maxMach: r.maxMach,
  maxAlpha: r.maxAlpha, maxQ: r.maxQ, spin0: r.spin0, spinBurst: r.spinBurst, spinLoss: r.spinLoss,
  Sg0: r.Sg0, SgMin: r.SgMin, drift: r.drift, coriolisDrift: r.coriolisDrift, windDrift: r.windDrift,
  impactSpeed: r.impactSpeed, apex: r.apex, fuzeReached: r.fuzeReached,
  frag: { count: r.fragments.count, r90: r.fragments.r90, r50: r.fragments.r50, vG: r.fragments.vGurney, massSum: r.fragments.massSum, duration: r.fragments.duration, kill: r.fragments.killCount, effective: r.fragments.effectiveCount } }, null, 2));

// 种子可复现
const a = B.simulate({ v0: 450, angle: 45, hBoom: 12, seed: 42 }).fragments.r90;
const b = B.simulate({ v0: 450, angle: 45, hBoom: 12, seed: 42 }).fragments.r90;
console.log('seed reproducibility:', a, b, a === b);

// ---- McCoy 105mm M1 基准 ----
function setShell105() {
  const S = B.SHELL;
  S.mass = 14.97; S.D = 0.1048; S.S = Math.PI * 0.1048 * 0.1048 / 4; S.L = 0.4947;
  S.Ix = 0.02326; S.Iy = 0.23118; S.xcgD = (0.4947 - 0.1834) / 0.1048;
}
setShell105();
console.log('105mm SHELL:', JSON.stringify(B.SHELL));
const cases = [
  { name: 'C7-45', v0: 493, angle: 45, wz0: 3.61, ref: { R: 11500, t: 52.5, alt: 3460 } },
  { name: 'C1-45', v0: 205, angle: 45, wz0: 1.44, ref: { R: 3760, t: 28.5, alt: 1000 } },
  { name: 'C7-70', v0: 493, angle: 70, wz0: 3.64, ref: { R: 7300, t: 70.5, alt: 6000 } },
  { name: 'C1-70', v0: 205, angle: 70, wz0: 1.47, ref: { R: 2320, t: 38.5, alt: 1750 } }
];
for (const c of cases) {
  const cfg = { v0: c.v0, angle: c.angle, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz0, dt: 0.00025, maxTime: 160, fragCount: 50, env: { useCoriolis: false, useWind: false } };
  t0 = process.hrtime.bigint();
  const rr = B.simulate(cfg);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(c.name, '=> R=' + rr.range.toFixed(0) + ' (' + ((rr.range / c.ref.R - 1) * 100).toFixed(2) + '%) t=' + rr.flightTime.toFixed(1) + ' (' + ((rr.flightTime / c.ref.t - 1) * 100).toFixed(1) + '%) alt=' + rr.maxAlt.toFixed(0) + ' (' + ((rr.maxAlt / c.ref.alt - 1) * 100).toFixed(1) + '%)',
    ' maxα=' + rr.maxAlpha.toFixed(2) + ' Sg0=' + rr.Sg0.toFixed(2) + ' spinLoss=' + (rr.spinLoss * 100).toFixed(0) + '%', '[' + ms.toFixed(0) + 'ms]');
}
