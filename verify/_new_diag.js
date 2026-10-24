/* verify/_new_diag.js — 新版漂移/风/科氏分解诊断 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));
function run(label, cfg, tweak) {
  if (tweak) tweak(B);
  const r = B.simulate(Object.assign({ v0: 450, angle: 45, hBoom: 12, seed: 7, fragCount: 50 }, cfg));
  console.log(label.padEnd(46), 'R=' + r.range.toFixed(0), 't=' + r.flightTime.toFixed(2), 'z=' + r.z, 'drift=' + r.drift.toFixed(1), 'cor=' + r.coriolisDrift.toFixed(1), 'windDrift(labelled)=' + r.windDrift.toFixed(1), 'maxα=' + r.maxAlpha.toFixed(2), 'Sg0=' + r.Sg0.toFixed(2), 'spin0=' + r.spin0.toFixed(0));
  if (tweak) { /* restore */ }
}
function setMagnus(on) { B.AERO_C.useMagnusMoment = on; B.AERO_C.useMagnusForce = on; }
console.log('=== 默认 vs 扰动/自转/科氏/Magnus 分解 ===');
run('default', {});
run('no disturbances (jump/yaw/wy/wz=0)', { jump: 0, yaw0: 0, wy0: 0, wz0: 0 });
run('no dist + spin=0', { jump: 0, yaw0: 0, wy0: 0, wz0: 0, spin: 0 });
run('spin=0 (default disturbances)', { spin: 0 });
run('default + Coriolis off', { env: { useCoriolis: false } });
run('no dist + Coriolis off', { jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useCoriolis: false } });
setMagnus(false);
run('no dist + Magnus OFF', { jump: 0, yaw0: 0, wy0: 0, wz0: 0 });
run('default + Magnus OFF', {});
setMagnus(true);
console.log('\n=== 风场方向测试（v0=450,45°, spin=1309, no dist, 科氏关）===');
for (const wc of [-20, 0, 20]) {
  run('windCross=' + wc, { env: { windCross: wc, useCoriolis: false } });
}
for (const wh of [-20, 0, 20]) {
  run('windHead=' + wh, { env: { windHead: wh, useCoriolis: false } });
}
console.log('\n=== 科氏方向测试（lat=40/0/-40, az=0/90, no dist, 无风）===');
for (const lat of [40, -40]) {
  for (const az of [0, 90]) {
    run('lat=' + lat + ' az=' + az, { jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { latitude: lat, azimuth: az } });
  }
}
