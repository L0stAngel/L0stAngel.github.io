/* verify/_new_diag4.js — C1-70/C7-70 偏差归因 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));
const S = B.SHELL;
S.mass = 14.97; S.D = 0.1048; S.S = Math.PI * 0.1048 * 0.1048 / 4; S.L = 0.4947; S.Ix = 0.02326; S.Iy = 0.23118; S.xcgD = (0.4947 - 0.1834) / 0.1048;
const baseCfg = (c, dt) => ({ v0: c.v0, angle: c.angle, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz0, dt: dt, maxTime: 160, fragCount: 20, env: { useCoriolis: false, useWind: false } });
const cases = [
  { name: 'C7-45', v0: 493, angle: 45, wz0: 3.61, ref: [11500, 52.5, 3460] },
  { name: 'C1-45', v0: 205, angle: 45, wz0: 1.44, ref: [3760, 28.5, 1000] },
  { name: 'C7-70', v0: 493, angle: 70, wz0: 3.64, ref: [7300, 70.5, 6000] },
  { name: 'C1-70', v0: 205, angle: 70, wz0: 1.47, ref: [2320, 38.5, 1750] }
];
function one(c, dt, tweak) {
  const saved = { useNonlinear: B.AERO_C.useNonlinear, useMagnusMoment: B.AERO_C.useMagnusMoment, useMagnusForce: B.AERO_C.useMagnusForce };
  if (tweak) tweak();
  const r = B.simulate(baseCfg(c, dt));
  Object.assign(B.AERO_C, saved);
  return r;
}
console.log('=== dt 收敛性（hBoom=0, 无风无科氏, jump/yaw0=0）===');
for (const c of cases) {
  const rows = [0.0005, 0.00025, 0.000125].map(dt => {
    const r = one(c, dt);
    return dt * 1000 + 'ms: R=' + r.range.toFixed(1) + ' t=' + r.flightTime.toFixed(3) + ' alt=' + r.maxAlt.toFixed(0) + ' maxα=' + r.maxAlpha.toFixed(1);
  });
  console.log(c.name, rows.join(' | '));
}
console.log('\n=== 偏差归因：关闭非线性气动 / 关闭 Magnus / 无初始横速 ===');
for (const c of cases) {
  const def = one(c, 0.00025);
  const noNonlin = one(c, 0.00025, () => { B.AERO_C.useNonlinear = false; });
  const noMag = one(c, 0.00025, () => { B.AERO_C.useMagnusMoment = false; B.AERO_C.useMagnusForce = false; });
  const noWz = B.simulate(Object.assign(baseCfg(c, 0.00025), { wz0: 0 }));
  console.log(c.name,
    '\n   baseline R=' + def.range.toFixed(0) + ' (' + ((def.range / c.ref[0] - 1) * 100).toFixed(2) + '%) maxα=' + def.maxAlpha.toFixed(1) +
    '\n   非线性关  R=' + noNonlin.range.toFixed(0) + ' (' + ((noNonlin.range / c.ref[0] - 1) * 100).toFixed(2) + '%) maxα=' + noNonlin.maxAlpha.toFixed(1) +
    '\n   Magnus关  R=' + noMag.range.toFixed(0) + ' (' + ((noMag.range / c.ref[0] - 1) * 100).toFixed(2) + '%) maxα=' + noMag.maxAlpha.toFixed(1) +
    '\n   wz0=0     R=' + noWz.range.toFixed(0) + ' (' + ((noWz.range / c.ref[0] - 1) * 100).toFixed(2) + '%) maxα=' + noWz.maxAlpha.toFixed(1));
}
console.log('\n=== hBoom 影响（C1-70）===');
for (const hb of [0, 2, 12, 80]) {
  const r = B.simulate(Object.assign(baseCfg(cases[3], 0.00025), { hBoom: hb }));
  console.log('hBoom=' + hb, 'R=' + r.range.toFixed(1), 't=' + r.flightTime.toFixed(2), 'Vimp=' + r.impactSpeed.toFixed(1));
}
