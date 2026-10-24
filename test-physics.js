/* 单次仿真摘要：分别运行两种弹型预设 ------------------------------------------------------------------ */
const B = require('./physics.js');

const fmt = (x, n = 2) => Number(x).toFixed(n);

function runPreset(id) {
  const p = B.PRESETS[id];
  const d = p.defaults;
  B.applyPreset(id);
  const t0 = Date.now();
  const r = B.simulate({
    preset: id,
    v0: d.v0,
    angle: d.angle,
    hBoom: 12,
    fragCount: 420
  });
  const ms = Date.now() - t0;
  const f = r.fragments;

  console.log('\n============================================================');
  console.log(p.name + '   预设=' + id + '   仿真耗时 ' + ms + ' ms');
  console.log('------------------------------------------------------------');
  console.log('飞行时间      :', fmt(r.flightTime, 2), 's');
  console.log('水平射程      :', fmt(r.range, 1), 'm');
  console.log('最大高度      :', fmt(r.maxAlt, 1), 'm');
  console.log('最大速度/马赫 :', fmt(r.maxSpeed, 1), 'm/s /', fmt(r.maxMach, 2));
  console.log('最大攻角      :', fmt(r.maxAlpha, 2), '°（最大偏航', fmt(r.maxBeta, 2), '°）');
  console.log('最大动压      :', fmt(r.maxQ, 1), 'kPa');
  console.log('侧偏/科氏/气动:', fmt(r.drift, 1), '/', fmt(r.coriolisDrift, 1), '/', fmt(r.aeroDrift, 1), 'm');
  console.log('稳定性        :', r.spinStabilized
    ? ('Sg ' + fmt(r.Sg0, 2) + ' (炮口) → ' + fmt(r.SgMin, 2) + ' (最小)')
    : ('静稳定裕度 ' + fmt(r.staticMargin, 2) + ' cal，不旋转'));
  console.log('自转          :', fmt(r.spin0, 0), '→', fmt(r.spinBurst, 0), 'rad/s');
  console.log('起爆          : x=' + fmt(r.boom.x, 1) + ' y=' + fmt(r.boom.y, 1) +
    ' z=' + fmt(r.boom.z, 1) + ' m, t=' + fmt(r.boom.t, 2) + ' s, V=' + fmt(r.boom.speed, 1) +
    ' m/s, α=' + fmt(r.boom.alpha, 2) + '°');
  console.log('破片          : ' + f.count + ' 枚, 落地 ' + f.landedCount +
    ', Gurney ' + fmt(f.vGurney, 0) + ' m/s, R50/R90 ' + fmt(f.r50, 0) + '/' + fmt(f.r90, 0) + ' m');
  console.log('破片质量      : Mott μ ' + fmt(f.mu * 1000, 1) + ' g, 均值 ' + fmt(f.meanMass * 1000, 1) +
    ' g, 总质量 ' + fmt(f.massSum, 3) + ' kg, 飞行 ' + fmt(f.duration, 1) + ' s');
  console.log('能量/有效破片 : ' + fmt(f.totalEnergy / 1000, 1) + ' kJ, >78J ' + f.killCount +
    ' 枚, >100m/s ' + f.effectiveCount + ' 枚');

  const tcks = [0, 2, 5, 10, 20, 30, 40, 50, 60];
  console.log('时间序列      : t / h / V / Ma / α / θ / ωx');
  for (const tc of tcks) {
    let best = null, bd = 1e9;
    for (const s of r.samples) { const dd = Math.abs(s.t - tc); if (dd < bd) { bd = dd; best = s; } }
    if (best && bd < 1) {
      console.log('  t=' + fmt(best.t, 1) + 's  h=' + fmt(best.y, 0) + 'm  V=' + fmt(best.speed, 0) +
        'm/s  Ma=' + fmt(best.mach, 2) + '  α=' + fmt(best.alpha, 2) + '°  θ=' +
        fmt(best.theta, 1) + '°  ωx=' + fmt(best.wx, 0));
    }
  }
}

runPreset('mortar120');
runPreset('spin120');
console.log('\n提示：完整验证请运行 node test-validation.js（57 项检查）。');
