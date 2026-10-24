/* verify/_bench.js */
'use strict';
const path = require('path');
const { loadPhysics } = require('./lib/load-physics');
const B0 = require(path.join(__dirname, '..', 'physics.js'));
const P = loadPhysics(path.join(__dirname, '..', 'physics.js'), { seed: 1 });
console.log('new physics missing internals:', P.missing.join(',') || '(none)');
function best(fn, n) { let b = 1e9; for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; } return b; }
for (let i = 0; i < 3; i++) { B0.simulate({ fragCount: 420 }); P.Ballistics.simulate({ fragCount: 420 }); }
console.log('plain require  best =', best(() => B0.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 }), 7).toFixed(2), 'ms');
console.log('vm  sandbox    best =', best(() => P.Ballistics.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 }), 7).toFixed(2), 'ms');
const Bb = require('./baseline/physics-baseline.js');
for (let i = 0; i < 3; i++) Bb.simulate({ fragCount: 420 });
console.log('baseline require best =', best(() => Bb.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 }), 7).toFixed(2), 'ms');
const r = Bb.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 });
console.log('baseline result: t=', r.flightTime.toFixed(2), 'R=', r.range.toFixed(1), 'alt=', r.maxAlt.toFixed(1), 'r90=', r.fragments.r90.toFixed(1));
console.log('os loadavg', require('os').loadavg().map(x => x.toFixed(2)).join(','), 'cpus', require('os').cpus().length);
