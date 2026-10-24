/* verify/_new_diag2.js — 漂移/自转符号/NaN 诊断 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));
function run(label, cfg) {
  try {
    const r = B.simulate(Object.assign({ v0: 450, angle: 45, hBoom: 12, seed: 7, fragCount: 40 }, cfg));
    console.log(label.padEnd(52), 'R=' + r.range.toFixed(0), 't=' + r.flightTime.toFixed(2), 'drift=' + r.drift.toFixed(1), 'cor=' + r.coriolisDrift.toFixed(1), 'maxα=' + r.maxAlpha.toFixed(2), 'Sg0=' + r.Sg0.toFixed(2));
  } catch (e) { console.log(label, 'ERROR', e.message); }
}
console.log('=== 自转符号 / Magnus / 扰动 ===');
run('spin=+1309, no dist, Coriolis off', { jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useCoriolis: false } });
run('spin=-1309, no dist, Coriolis off', { spin: -1309, jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useCoriolis: false } });
B.AERO_C.useMagnusMoment = false; B.AERO_C.useMagnusForce = false;
run('spin=+1309, no dist, Magnus OFF', { jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useCoriolis: false } });
run('spin=-1309, no dist, Magnus OFF', { spin: -1309, jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useCoriolis: false } });
B.AERO_C.useMagnusMoment = true; B.AERO_C.useMagnusForce = true;
run('spin=+1309, Coriolis off, default dist', { env: { useCoriolis: false } });
console.log('\n=== spin=0 / 小自转 NaN 诊断 ===');
for (const spin of [0, 50, 100, 200]) {
  const r = B.simulate({ v0: 450, angle: 45, hBoom: 12, spin, jump: 0, yaw0: 0, wy0: 0, wz0: 0, seed: 1, fragCount: 40 });
  console.log('spin=' + spin, 'flight=', r.flightTime.toFixed(3), 'range=', r.range, 'maxAlpha=', r.maxAlpha.toFixed(1), 'samples=', r.samples.length, 'boomY=', r.boom.y);
  const s = r.samples; const last = s[s.length - 1];
  console.log('  last sample t=', last.t, 'x=', last.x, 'y=', last.y, 'alpha=', last.alpha, 'sg=', last.sg);
}
console.log('\n=== 105mm C7-45 漂移（McCoy 算例）===');
const S = B.SHELL;
S.mass = 14.97; S.D = 0.1048; S.S = Math.PI * 0.1048 * 0.1048 / 4; S.L = 0.4947; S.Ix = 0.02326; S.Iy = 0.23118; S.xcgD = (0.4947 - 0.1834) / 0.1048;
for (const c of [{ n: 'C7-45', v0: 493, ang: 45, wz: 3.61 }, { n: 'C1-70', v0: 205, ang: 70, wz: 1.47 }]) {
  const r = B.simulate({ v0: c.v0, angle: c.ang, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz, dt: 0.00025, maxTime: 160, fragCount: 40, env: { useCoriolis: false, useWind: false } });
  console.log(c.n, 'R=' + r.range.toFixed(0), 't=' + r.flightTime.toFixed(1), 'alt=' + r.maxAlt.toFixed(0), 'drift=' + r.drift.toFixed(1), 'maxα=' + r.maxAlpha.toFixed(2), 'maxβ=' + r.maxBeta.toFixed(2), 'Sg0=' + r.Sg0.toFixed(2));
}
