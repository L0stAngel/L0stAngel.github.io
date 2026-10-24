/* verify/_explore1.js — 探索性实验（临时） */
'use strict';
const path = require('path');
const { loadPhysics } = require('./lib/load-physics');
const { createRefSim } = require('./lib/refsim');

const P = loadPhysics(path.join(__dirname, '..', 'physics.js'), { seed: 20240601 });
const I = P.internals;
const R = createRefSim(I);

function run(dt, spin, wz, wy, label) {
  const t0 = process.hrtime.bigint();
  const r = R.simulateRef({ v0: 450, angle: 45, hBoom: 12, spin: spin, wz: wz, wy: wy, dt: dt });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(label || '', 'dt=' + dt, 'spin=' + spin, 'wz=' + wz,
    '| t=' + r.flightTime.toFixed(3), 'R=' + r.range.toFixed(1), 'alt=' + r.maxAlt.toFixed(1),
    'aMax=' + r.maxAlpha.toFixed(2), 'z=' + r.impactZ.toFixed(2), 'Vimp=' + r.boom.speed.toFixed(1),
    '| ' + ms.toFixed(0) + 'ms');
  return r;
}

console.log('=== spin sweep (dt=1ms) ===');
for (const spin of [0, 18, 300, 600, 900, 1200, 1500]) run(0.001, spin, 1.25, 0);

console.log('\n=== dt sweep spin=18 ===');
const s18 = {};
for (const dt of [4e-3, 2e-3, 1e-3, 5e-4, 2.5e-4]) s18[dt] = run(dt, 18, 1.25, 0);

console.log('\n=== dt sweep spin=1200 (reference 1e-4) ===');
const s12 = {};
for (const dt of [4e-3, 2e-3, 1e-3, 5e-4, 2.5e-4, 1e-4]) s12[dt] = run(dt, 1200, 1.25, 0);

console.log('\n=== drift decomposition ===');
for (const [spin, wz, wy] of [[18,0,0],[18,1.25,0],[0,1.25,0],[0,0,1.25],[1200,1.25,0],[1200,0,0],[1200,1.25,1.25]]) run(0.001, spin, wz, wy, 'combo');

console.log('\n=== atmosphere vs ISA ===');
const Rgas = 287.05287, g0 = 9.80665;
function isa(h) {
  // ISA 1976 up to 20 km: troposphere 0-11 km, lower stratosphere 11-20 km
  let T, P;
  if (h <= 11000) { T = 288.15 - 0.0065 * h; P = 101325 * Math.pow(T / 288.15, g0 / (Rgas * 46.63e-3)); }
  else { T = 216.65; P = 22632.06 * Math.exp(-g0 * (h - 11000) / (Rgas * T)); }
  const rho = P / (Rgas * T);
  return { T, P, rho, a: Math.sqrt(1.4 * Rgas * T) };
}
for (const h of [0, 5000, 10000, 11000, 12000, 15000, 18000, 20000, 25000]) {
  const A = I.atmosphere(h);
  const cT = A.a * A.a / (1.4 * Rgas);
  const cP = A.rho * Rgas * cT;
  const S = isa(Math.min(h, 20000));
  console.log('h=' + String(h).padStart(5),
    '| code rho=' + A.rho.toFixed(5), 'a=' + A.a.toFixed(2), '(implied T=' + cT.toFixed(1) + ')',
    '| ISA rho=' + S.rho.toFixed(5), 'a=' + S.a.toFixed(2), 'T=' + S.T.toFixed(1),
    '| drho=' + ((A.rho / S.rho - 1) * 100).toFixed(2) + '%', 'da=' + ((A.a / S.a - 1) * 100).toFixed(2) + '%', 'dT=' + ((cT / S.T - 1) * 100).toFixed(1) + '%');
}
console.log('atmosphere(25000)=', JSON.stringify(I.atmosphere(25000)), ' atmosphere(20000)=', JSON.stringify(I.atmosphere(20000)), ' clamp?', I.atmosphere(25000).rho === I.atmosphere(20000).rho);
