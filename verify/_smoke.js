/* verify/_smoke.js — 自检：vm 注入 + refsim 与 simulate 是否等价 */
'use strict';
const path = require('path');
const { loadPhysics } = require('./lib/load-physics');
const { createRefSim } = require('./lib/refsim');

const t0 = Date.now();
const P = loadPhysics(path.join(__dirname, '..', 'physics.js'), { seed: 20240601 });
const I = P.internals;
console.log('loaded in', Date.now() - t0, 'ms; sha256=', P.sha256.slice(0, 16), '; internals=', Object.keys(I).length);

const cfg = { v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 };

let t = process.hrtime.bigint();
const r = P.Ballistics.simulate(cfg);
const simMs = Number(process.hrtime.bigint() - t) / 1e6;

const R = createRefSim(I);
t = process.hrtime.bigint();
const ref = R.simulateRef(cfg);
const refMs = Number(process.hrtime.bigint() - t) / 1e6;

const key = ['flightTime', 'range', 'maxAlt', 'maxSpeed', 'maxMach', 'maxAlpha', 'maxQ', 'drift', 'impactX', 'impactY', 'impactZ'];
const cmp = {};
for (const k of key) {
  const a = r[k], b = ref[k];
  cmp[k] = { sim: a, ref: b, absDiff: Math.abs(a - b), relDiff: Math.abs(a - b) / Math.max(1e-12, Math.abs(a)) };
}
console.log('sim ms=', simMs.toFixed(1), ' ref ms=', refMs.toFixed(1));
console.log(JSON.stringify(cmp, (k, v) => typeof v === 'number' ? Number(v.toPrecision(10)) : v, 2));
console.log('fragments:', JSON.stringify({
  vGurney: r.fragments.vGurney, r90: r.fragments.r90, r50: r.fragments.r50,
  count: r.fragments.count, landed: r.fragments.landedCount, duration: r.fragments.duration,
  meanMass: r.fragments.meanMass, mu: r.fragments.mu, kill: r.fragments.killCount
}, null, 2));
console.log('atmosphere:', JSON.stringify(I.atmosphere(0)), JSON.stringify(I.atmosphere(11000)), JSON.stringify(I.atmosphere(20000)));
console.log('SHELL:', JSON.stringify(I.SHELL));
