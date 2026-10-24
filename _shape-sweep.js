/* 动爆落角/落速对地面破片场形态的影响：控制随机种子做对照 */
const B = require('./physics.js');
B.applyPreset('spin120');

function run(v0, angle) {
  let seed = 20240601;
  Math.random = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const r = B.simulate({ v0: v0, angle: angle, hBoom: 12, fragCount: 420 });
  const f = r.fragments, b = r.boom;
  const lands = f.list.filter(x => x.landed);
  const rel = lands.map(x => ({ x: x.landX - b.x, z: x.landZ - b.z }));
  const fwd = f.forwardMax, back = -f.backMin, lat = f.lateralMax;
  const asym = (fwd - back) / (fwd + back);
  const near = rel.filter(p => Math.abs(p.x) < 50).length / rel.length;
  // 轴向峰位（20m 分箱）
  const bins = new Array(80).fill(0);
  for (const p of rel) {
    const k = Math.floor((p.x + 700) / 20);
    if (k >= 0 && k < 80) bins[k]++;
  }
  const peakBin = bins.indexOf(Math.max(...bins));
  const peakX = -700 + peakBin * 20;
  // 纵深剖面（100m 箱）用于观察是否有“腰部”
  const prof = [];
  const pb = new Array(20).fill(0);
  for (const p of rel) {
    const k = Math.floor((p.x + 900) / 100);
    if (k >= 0 && k < 20) pb[k]++;
  }
  for (let i = 0; i < 20; i++) prof.push(pb[i]);

  return {
    v0, angle,
    impact: b.speed,
    theta: b.theta,
    vRatio: b.speed / f.vGurney,
    dur: f.duration,
    fwd, back, lat, asym,
    near: near * 100,
    peakX,
    prof
  };
}

const rows = [];
for (const v of [450, 550, 800, 1050, 1250]) rows.push(run(v, 45));
for (const a of [25, 35, 55, 65]) rows.push(run(450, a));

const hdr = 'v0   angle  Vimp  theta  V/Vg   fwd   back  lat   asym%  near%  peakX  100m剖面(-900..+1000)';
console.log(hdr);
for (const r of rows) {
  console.log(
    String(r.v0).padStart(4),
    String(r.angle).padStart(5) + '°',
    r.impact.toFixed(0).padStart(5),
    r.theta.toFixed(1).padStart(6) + '°',
    r.vRatio.toFixed(2).padStart(5),
    r.fwd.toFixed(0).padStart(6),
    r.back.toFixed(0).padStart(6),
    r.lat.toFixed(0).padStart(5),
    (r.asym * 100).toFixed(0).padStart(6),
    r.near.toFixed(0).padStart(6),
    String(r.peakX).padStart(6),
    ' ' + r.prof.join(' ')
  );
}
