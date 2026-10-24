/* verify/_new_diag3.js — McCoy 算例攻角历程/稳定性诊断 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));
const S = B.SHELL;
S.mass = 14.97; S.D = 0.1048; S.S = Math.PI * 0.1048 * 0.1048 / 4; S.L = 0.4947; S.Ix = 0.02326; S.Iy = 0.23118; S.xcgD = (0.4947 - 0.1834) / 0.1048;
const cases = [
  { name: 'C7-45', v0: 493, angle: 45, wz0: 3.61 },
  { name: 'C1-45', v0: 205, angle: 45, wz0: 1.44 },
  { name: 'C7-70', v0: 493, angle: 70, wz0: 3.64 },
  { name: 'C1-70', v0: 205, angle: 70, wz0: 1.47 }
];
for (const c of cases) {
  const r = B.simulate({ v0: c.v0, angle: c.angle, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz0, dt: 0.00025, maxTime: 160, fragCount: 40, env: { useCoriolis: false, useWind: false } });
  const s = r.samples;
  const pick = (t) => s[Math.min(s.length - 1, Math.round(t / r.sampleDt))];
  console.log('\n', c.name, 'flight', r.flightTime.toFixed(1), 'range', r.range.toFixed(0), 'maxα', r.maxAlpha.toFixed(1), 'maxβ', r.maxBeta.toFixed(1), 'SgMin', r.SgMin.toFixed(2));
  for (const t of [0, 1, 2, 5, 10, 20, 30, 40, 50, 60, 65]) {
    if (t > r.flightTime) continue;
    const x = pick(t);
    console.log('  t=' + String(t).padStart(3) + 's  y=' + x.y.toFixed(0).padStart(5) + '  V=' + x.speed.toFixed(0).padStart(4) + '  q=' + x.qdyn.toFixed(1).padStart(6) + 'kPa  α=' + x.alpha.toFixed(1).padStart(6) + '  β=' + x.beta.toFixed(1).padStart(6) + '  Sg=' + (isFinite(x.sg) ? x.sg.toFixed(2) : 'inf').padStart(6) + '  wx=' + x.wx.toFixed(0));
  }
  // alpha 包络最大出现时刻
  let best = 0, bt = 0; for (const x of s) if (Math.abs(x.alpha) > best) { best = Math.abs(x.alpha); bt = x.t; }
  console.log('  maxα 出现在 t=' + bt.toFixed(1) + 's');
}
// 105mm 4 算例的横向漂移 & 弹道落点横向
console.log('\n=== 4 算例漂移(drift) ===');
for (const c of cases) {
  const r = B.simulate({ v0: c.v0, angle: c.angle, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz0, dt: 0.00025, maxTime: 160, fragCount: 20, env: { useCoriolis: false, useWind: false } });
  console.log(c.name, 'drift=' + r.drift.toFixed(1), 'impactZ=' + r.impactZ.toFixed(1), 'impactX=' + r.impactX.toFixed(0));
}
