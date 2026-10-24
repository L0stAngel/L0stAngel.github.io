/* verify/_final_probe.js — 最终版预探 */
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', 'physics.js'));

console.log('preset default:', B.getPreset(), 'SHELL:', JSON.stringify(B.SHELL));
console.log('aeroAt(1.0):', JSON.stringify(B.aeroAt(1.0)));
const r0 = B.simulate({});
console.log('default simulate:', JSON.stringify({ preset: r0.preset, range: r0.range, t: r0.flightTime, alt: r0.maxAlt, spin0: r0.spin0, Sg0: r0.Sg0, drift: r0.drift, cor: r0.coriolisDrift, maxAlpha: r0.maxAlpha, staticMargin: r0.staticMargin, staticallyStable: r0.staticallyStable, dt: r0.dt, frag: { n: r0.fragments.count, r90: r0.fragments.r90, vG: r0.fragments.vGurney, massSum: r0.fragments.massSum } }, null, 1));

console.log('\n=== 120mm 迫弹 McCoy 表 9.7（6 例，dt=0.25ms, hBoom=0, 无风/科氏）===');
const mortarCases = [
  { n: 'chg0-45', v0: 102, angle: 45, wz: 0.913, ref: [1010, 14.6, 260] },
  { n: 'chg0-65', v0: 102, angle: 65, wz: 0.913, ref: [770, 18.6, 420] },
  { n: 'chg0-85', v0: 102, angle: 85, wz: 0.913, ref: [165, 20.5, 510] },
  { n: 'chg4-45', v0: 318, angle: 45, wz: 1.795, ref: [7315, 41.4, 2100] },
  { n: 'chg4-65', v0: 318, angle: 65, wz: 1.795, ref: [5570, 52.6, 3380] },
  { n: 'chg4-85', v0: 318, angle: 85, wz: 1.795, ref: [1275, 57.7, 4070] }
];
function runMortar(c, extra) {
  return B.simulate(Object.assign({ preset: 'mortar120', v0: c.v0, angle: c.angle, hBoom: 0, twist: 0, wz0: c.wz, wy0: 0, jump: 0, yaw0: 0, dt: 0.00025, maxTime: 140, fragCount: 30, env: { useCoriolis: false, useWind: false } }, extra || {}));
}
console.log('  工况      本模型 R/t/alt         McCoy 表 9.7        偏差 R/t/alt          maxα    maxAlt');
for (const c of mortarCases) {
  const t0 = process.hrtime.bigint();
  const r = runMortar(c);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('  ' + c.n.padEnd(8) + ' ' + r.range.toFixed(0).padStart(5) + '/' + r.flightTime.toFixed(2).padStart(5) + '/' + r.maxAlt.toFixed(0).padStart(5) +
    '        ' + c.ref[0] + '/' + c.ref[1] + '/' + c.ref[2] +
    '        ' + ((r.range / c.ref[0] - 1) * 100).toFixed(2).padStart(6) + '%/' + ((r.flightTime / c.ref[1] - 1) * 100).toFixed(2).padStart(6) + '%/' + ((r.maxAlt / c.ref[2] - 1) * 100).toFixed(2).padStart(6) + '%' +
    '   ' + r.maxAlpha.toFixed(1).padStart(5) + '  ' + '[' + ms.toFixed(0) + 'ms]');
}
console.log('\n  1st max yaw 初始角解释尝试（yaw0=3°/8°）：');
for (const c of [mortarCases[3], mortarCases[0]]) {
  const yaw = c.v0 === 318 ? 3 : 8;
  const r = runMortar(c, { yaw0: yaw });
  console.log('  ' + c.n + ' yaw0=' + yaw + '°: R=' + r.range.toFixed(0) + ' t=' + r.flightTime.toFixed(2) + ' alt=' + r.maxAlt.toFixed(0) + ' maxα=' + r.maxAlpha.toFixed(1) + '（参考 ' + c.ref.join('/') + '）');
}
console.log('\n  85° 顶点大攻角核对（文献：chg0 47°、chg4 13°）:');
for (const c of [mortarCases[2], mortarCases[5]]) {
  const r = runMortar(c);
  let best = 0, bt = 0; for (const x of r.samples) { const a = Math.sqrt(x.alpha * x.alpha + x.beta * x.beta); if (a > best) { best = a; bt = x.t; } }
  console.log('  ' + c.n + ' maxαT=' + best.toFixed(1) + '° @' + bt.toFixed(1) + 's');
}
console.log('\n=== 旋转弹预设默认 ===');
const rs = B.simulate({ preset: 'spin120' });
console.log('spin120 default:', JSON.stringify({ range: rs.range, t: rs.flightTime, alt: rs.maxAlt, spin0: rs.spin0, Sg0: rs.Sg0, drift: rs.drift, maxAlpha: rs.maxAlpha, dt: rs.dt, preset: rs.preset, shift: rs.spinLoss, frag: { n: rs.fragments.count, r90: rs.fragments.r90, vG: rs.fragments.vGurney, massSum: rs.fragments.massSum, mu: rs.fragments.mu } }));
console.log('\n=== 105mm M1 四算例（1/18），应用于 spin120 预设并临时替换 SHELL ===');
B.applyPreset('spin120');
Object.assign(B.SHELL, { mass: 14.97, D: 0.1048, S: Math.PI * 0.1048 * 0.1048 / 4, L: 0.4947, Ix: 0.02326, Iy: 0.23118, xcgD: (0.4947 - 0.1834) / 0.1048 });
const m105 = [
  { n: 'C1-45', v0: 205, angle: 45, wz: 1.44, ref: [3760, 28.5, 1000] },
  { n: 'C1-70', v0: 205, angle: 70, wz: 1.47, ref: [2320, 38.5, 1750] },
  { n: 'C7-45', v0: 493, angle: 45, wz: 3.61, ref: [11500, 52.5, 3460] },
  { n: 'C7-70', v0: 493, angle: 70, wz: 3.64, ref: [7300, 70.5, 6000] }
];
for (const c of m105) {
  const r = B.simulate({ preset: 'spin120', v0: c.v0, angle: c.angle, hBoom: 0, twist: 18, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz, dt: 0.00025, maxTime: 160, fragCount: 30, env: { useCoriolis: false, useWind: false } });
  console.log('  ' + c.n + ': R=' + r.range.toFixed(0) + ' (' + ((r.range / c.ref[0] - 1) * 100).toFixed(2) + '%) t=' + r.flightTime.toFixed(1) + ' (' + ((r.flightTime / c.ref[1] - 1) * 100).toFixed(2) + '%) alt=' + r.maxAlt.toFixed(0) + ' (' + ((r.maxAlt / c.ref[2] - 1) * 100).toFixed(2) + '%) maxα=' + r.maxAlpha.toFixed(1) + ' Sg0=' + r.Sg0.toFixed(2));
}
console.log('\n=== 105mm 1/25 缠度（参考与 1/18 差别不显著）===');
const m105b = [
  { n: 'C1-45', v0: 205, angle: 45, wz: 0.76, ref: [3760, 28.5, 1000] },
  { n: 'C1-70', v0: 205, angle: 70, wz: 0.79, ref: [2320, 38.5, 1750] },
  { n: 'C7-45', v0: 493, angle: 45, wz: 1.97, ref: [11500, 52.5, 3460] },
  { n: 'C7-70', v0: 493, angle: 70, wz: 1.98, ref: [7300, 70.5, 6000] }
];
for (const c of m105b) {
  const r = B.simulate({ preset: 'spin120', v0: c.v0, angle: c.angle, hBoom: 0, twist: 25, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz, dt: 0.00025, maxTime: 160, fragCount: 30, env: { useCoriolis: false, useWind: false } });
  console.log('  ' + c.n + ': R=' + r.range.toFixed(0) + ' (' + ((r.range / c.ref[0] - 1) * 100).toFixed(2) + '%) t=' + r.flightTime.toFixed(1) + ' alt=' + r.maxAlt.toFixed(0) + ' Sg0=' + r.Sg0.toFixed(2));
}
