/* verify/_smoke2.js — native-core + refsim 自检 */
'use strict';
const path = require('path');
const { loadNative } = require('./lib/native-core');
const { createRefSim } = require('./lib/refsim');
const BASE = path.join(__dirname, 'baseline', 'physics-baseline.js');
const P = loadNative(BASE, { patches: [[/    var dt = 0\.001;/, '    var dt = (cfg.dt != null ? cfg.dt : 0.001);']] });
console.log('sha', P.sha256.slice(0, 16), 'missing', P.missing.join(',') || '(none)', 'tmp', path.basename(P.tmpFile));
const R = createRefSim(P.internals);
const cfg = { v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 };
P.setSeed(20240601);
const r = P.B.simulate(cfg);
const ref = R.simulateRef(cfg);
const d = (k) => Math.abs(r[k] - ref[k]);
console.log('sim t', r.flightTime, 'ref t', ref.flightTime, 'diff', d('flightTime'), 'R diff', d('range'));
function best(fn, n) { let b = 1e9; for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; } return b; }
for (let i = 0; i < 3; i++) { P.B.simulate(cfg); }
console.log('native simulate best =', best(() => P.B.simulate(cfg), 5).toFixed(2), 'ms');
console.log('native refsim(ballistic, dt=1ms) best =', best(() => R.simulateRef(cfg), 5).toFixed(2), 'ms');
console.log('fragments r90', r.fragments.r90.toFixed(1), 'duration', r.fragments.duration.toFixed(2));
