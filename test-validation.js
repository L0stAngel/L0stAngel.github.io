/* =============================================================================
 * 120mm 杀爆弹外弹道仿真 — 独立验证脚本
 * 运行: node test-validation.js
 * 内容:
 *   1) 标准大气对照 ISA       2) 弹道积分步长收敛性
 *   3) 陀螺稳定因子与自转      4) 风/科氏力/温度/缠距方向性检查
 *   5) 破片质量守恒与统计      6) 与 McCoy 105mm HE M1 6-DOF 公开数据对照
 * ========================================================================== */
'use strict';
const B = require('./physics.js');
B.applyPreset('spin120');   // 先以旋转稳定代表弹做数值/环境/破片检查

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')); }
}
function near(a, b, tolRel) { return Math.abs(a - b) <= Math.abs(b) * tolRel; }

/* ------------------------- 1. ISA 标准大气对照 ------------------------- */
console.log('\n[1] ISA 标准大气对照');
const isaRef = [
  [0, 288.15, 101325, 1.2250, 340.29],
  [5000, 255.65, 54048, 0.7364, 320.55],
  [11000, 216.65, 22632, 0.3639, 295.07],
  [20000, 216.65, 5474.9, 0.08803, 295.07]
];
for (const [h, T, p, rho, a] of isaRef) {
  const atm = B.atmosphere(h);
  check('h=' + h + 'm 温度', near(atm.T, T, 0.002), atm.T.toFixed(2) + ' K');
  check('h=' + h + 'm 气压', near(atm.p, p, 0.002), (atm.p / 1000).toFixed(2) + ' kPa');
  check('h=' + h + 'm 密度', near(atm.rho, rho, 0.003), atm.rho.toFixed(4) + ' kg/m³');
  check('h=' + h + 'm 声速', near(atm.a, a, 0.003), atm.a.toFixed(2) + ' m/s');
}

/* ------------------------- 2. 积分步长收敛性 --------------------------- */
console.log('\n[2] 弹道积分步长收敛性（破片抽样关闭到最小）');
const baseCfg = { v0: 450, angle: 45, hBoom: 12, fragCount: 50 };
const conv = [];
for (const dt of [0.0005, 0.00025, 0.000125]) {
  const r = B.simulate(Object.assign({}, baseCfg, { dt }));
  conv.push({ dt, range: r.range, alt: r.maxAlt, tof: r.flightTime, alpha: r.maxAlpha, drift: r.drift });
  console.log('  dt=' + (dt * 1000).toFixed(3) + ' ms  range=' + r.range.toFixed(1) +
    '  alt=' + r.maxAlt.toFixed(1) + '  TOF=' + r.flightTime.toFixed(3) +
    '  maxA=' + r.maxAlpha.toFixed(3) + '  drift=' + r.drift.toFixed(1));
}
const c1 = conv[1], c2 = conv[2];
check('range 收敛 (0.25 vs 0.125 ms)', Math.abs(c1.range - c2.range) / c2.range < 0.002,
  ((c1.range - c2.range) / c2.range * 100).toFixed(3) + ' %');
check('TOF 收敛', Math.abs(c1.tof - c2.tof) / c2.tof < 0.002,
  ((c1.tof - c2.tof) / c2.tof * 100).toFixed(3) + ' %');
check('最大攻角收敛', Math.abs(c1.alpha - c2.alpha) < 0.15,
  (c1.alpha - c2.alpha).toFixed(3) + ' °');
check('侧偏收敛', Math.abs(c1.drift - c2.drift) / Math.max(1, c2.drift) < 0.01,
  ((c1.drift - c2.drift) / c2.drift * 100).toFixed(2) + ' %');

/* ------------------------- 3. 自转与稳定因子 --------------------------- */
console.log('\n[3] 自转 / 陀螺稳定因子');
const base = B.simulate(baseCfg);
check('炮口自转由缠距换算 (1:18, 450 m/s ≈ 1309 rad/s)',
  near(base.spin0, 2 * Math.PI * 450 / (18 * 0.12), 1e-6), base.spin0.toFixed(1) + ' rad/s');
check('自转沿弹道衰减 (滚转阻尼)', base.spinBurst < base.spin0 && base.spinBurst > 0.5 * base.spin0,
  base.spin0.toFixed(0) + ' → ' + base.spinBurst.toFixed(0) + ' rad/s');
check('炮口陀螺稳定因子 Sg > 1.2', base.Sg0 > 1.2, 'Sg0=' + base.Sg0.toFixed(2));
check('全弹道最小稳定因子 Sg > 1', base.SgMin > 1, 'SgMin=' + base.SgMin.toFixed(2));
check('最大攻角 < 5°（小攻角飞行）', base.maxAlpha < 5, 'maxα=' + base.maxAlpha.toFixed(2) + '°');
const fastTwist = B.simulate(Object.assign({}, baseCfg, { twist: 15 }));
const slowTwist = B.simulate(Object.assign({}, baseCfg, { twist: 21 }));
check('更快缠距 → 更高自转/稳定因子', fastTwist.spin0 > base.spin0 && fastTwist.Sg0 > base.Sg0,
  '1:15 Sg=' + fastTwist.Sg0.toFixed(2) + '  1:18 Sg=' + base.Sg0.toFixed(2) + '  1:21 Sg=' + slowTwist.Sg0.toFixed(2));
check('更快缠距 → 更大偏流', fastTwist.drift > base.drift && base.drift > slowTwist.drift,
  fastTwist.drift.toFixed(0) + ' / ' + base.drift.toFixed(0) + ' / ' + slowTwist.drift.toFixed(0) + ' m');
// 姿态一致性回归：报告的 α/β 必须与四元数姿态、风轴系基准严格对应（滚转无关）。
// 旧弹体系定义随 ~200 rev/s 自转按滚转相位混叠，旋转弹读数与姿态画面矛盾。
let attErr = 0, attN = 0;
for (let k = 10; k < base.samples.length; k += 5) {
  const s2 = base.samples[k];
  const m = B.quatToMatrix(s2.quat);
  const nx = m[0][0], ny = m[1][0], nz = m[2][0];          // 弹轴（世界系）
  const vl = Math.hypot(s2.rvx, s2.rvy, s2.rvz);
  const ex = [s2.rvx / vl, s2.rvy / vl, s2.rvz / vl];
  const dd = ex[1];
  let ez = [-ex[0] * dd, 1 - ex[1] * dd, -ex[2] * dd];
  const el = Math.hypot(ez[0], ez[1], ez[2]);
  if (el < 1e-6) continue;
  ez = ez.map(v => v / el);
  const ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
  const ndx = nx * ex[0] + ny * ex[1] + nz * ex[2];
  const ndy = nx * ey[0] + ny * ey[1] + nz * ey[2];
  const ndz = nx * ez[0] + ny * ez[1] + nz * ez[2];
  const aC = Math.atan2(ndz, ndx) * 180 / Math.PI;
  const bC = Math.atan2(-ndy, ndx) * 180 / Math.PI;
  attN++;
  if (Math.abs(aC - s2.alpha) > 1e-6 || Math.abs(bC - s2.beta) > 1e-6) attErr++;
}
check('α/β 与姿态四元数一致（风轴系、滚转无关）', attN > 100 && attErr === 0,
  attN + ' 样本，不一致 ' + attErr);

/* --------------------- 4. 风 / 科氏力 / 温度方向性 --------------------- */
console.log('\n[4] 风场 / 科氏力 / 温度 / 方向性');
const noWind = B.simulate(Object.assign({}, baseCfg, { env: { windCross: 0, windHead: 0, useCoriolis: true, latitude: 40 } }));
const sideWind = B.simulate(Object.assign({}, baseCfg, { env: { windCross: 10, windHead: 0, useCoriolis: true, latitude: 40 } }));
const headWind = B.simulate(Object.assign({}, baseCfg, { env: { windCross: 0, windHead: 10, useCoriolis: true, latitude: 40 } }));
const tailWind = B.simulate(Object.assign({}, baseCfg, { env: { windCross: 0, windHead: -10, useCoriolis: true, latitude: 40 } }));
check('横风 +10 m/s（吹向右侧）→ 侧偏增大', sideWind.drift > noWind.drift + 100,
  noWind.drift.toFixed(0) + ' → ' + sideWind.drift.toFixed(0) + ' m');
check('横风引起的风偏量级 200–600 m / 10 m/s', sideWind.aeroDrift - noWind.aeroDrift > 150 && sideWind.aeroDrift - noWind.aeroDrift < 700,
  (sideWind.aeroDrift - noWind.aeroDrift).toFixed(0) + ' m');
check('逆风 → 射程减小', headWind.range < noWind.range - 500,
  noWind.range.toFixed(0) + ' → ' + headWind.range.toFixed(0) + ' m');
check('顺风 → 射程增大', tailWind.range > noWind.range + 300,
  noWind.range.toFixed(0) + ' → ' + tailWind.range.toFixed(0) + ' m');
// 样本应记录相对空气速度（姿态小窗风轴系/攻角显示基准）
const wsmp = sideWind.samples[Math.floor(2.0 / sideWind.sampleDt)];
const wfExp = Math.pow(Math.max(wsmp.y, 2) / 10, 0.143);
check('样本相对风速与幂律风场一致（rvz = vz − w·(h/10)^1/7）',
  wsmp.rvx !== undefined && Math.abs(wsmp.rvx - wsmp.vx) < 1e-9 &&
  Math.abs(wsmp.rvz - (wsmp.vz - 10 * wfExp)) < 1e-9,
  'rvz=' + wsmp.rvz.toFixed(2) + ' m/s @ h=' + wsmp.y.toFixed(1) + ' m');
const north = B.simulate(Object.assign({}, baseCfg, { env: { latitude: 40, useCoriolis: true } }));
const south = B.simulate(Object.assign({}, baseCfg, { env: { latitude: -40, useCoriolis: true } }));
const equator = B.simulate(Object.assign({}, baseCfg, { env: { latitude: 0, useCoriolis: true } }));
check('北半球（射向北）科氏力向右偏', north.coriolisDrift > 3, north.coriolisDrift.toFixed(1) + ' m');
check('南半球科氏力向左偏', south.coriolisDrift < -3, south.coriolisDrift.toFixed(1) + ' m');
// 赤道射出正北时，解析式 z(T) = -2Ω∫y dt（垂直速度项）；用轨迹积分独立校核
let intY = 0;
for (let k = 1; k < equator.samples.length; k++) {
  intY += 0.5 * (equator.samples[k - 1].y + equator.samples[k].y) * equator.sampleDt;
}
const expEquator = -2 * 7.292115e-5 * intY;
check('赤道科氏侧偏与解析式 -2Ω∫y dt 一致', Math.abs(equator.coriolisDrift - expEquator) < 0.08 * Math.abs(expEquator),
  '模型 ' + equator.coriolisDrift.toFixed(2) + ' m / 解析 ' + expEquator.toFixed(2) + ' m');
check('赤道科氏侧偏显著小于 40°N（量级正确）', Math.abs(equator.coriolisDrift) < Math.abs(north.coriolisDrift) * 1.5,
  '赤道 ' + equator.coriolisDrift.toFixed(1) + ' m / 40°N ' + north.coriolisDrift.toFixed(1) + ' m');
const hot = B.simulate(Object.assign({}, baseCfg, { env: { tempC: 40 } }));
const cold = B.simulate(Object.assign({}, baseCfg, { env: { tempC: -10 } }));
check('高温（空气密度低）→ 射程增大', hot.range > noWind.range + 100,
  noWind.range.toFixed(0) + ' → ' + hot.range.toFixed(0) + ' m');
check('低温 → 射程减小', cold.range < noWind.range - 100,
  noWind.range.toFixed(0) + ' → ' + cold.range.toFixed(0) + ' m');

/* ------------------------- 5. 破片模型检查 ----------------------------- */
console.log('\n[5] 动爆破片模型');
const sim = B.simulate({ v0: 450, angle: 45, hBoom: 12, fragCount: 800 });
const fr = sim.fragments;
check('破片质量守恒 = 壳体金属质量 10.5 kg', near(fr.massSum, 10.5, 1e-9), fr.massSum.toFixed(4) + ' kg');
check('破片数量 = 800', fr.count === 800, String(fr.count));
check('落地数 + 未落地数 = 总数', fr.landedCount + fr.unlanded === fr.count,
  fr.landedCount + ' + ' + fr.unlanded);
check('Gurney 初速 ≈ 1254 m/s', near(fr.vGurney, 1254, 0.01), fr.vGurney.toFixed(1) + ' m/s');
check('Mott 均质 2μ ≈ 平均质量', Math.abs(2 * fr.mu - fr.meanMass) / fr.meanMass < 0.35,
  '2μ=' + (2 * fr.mu * 1000).toFixed(1) + ' g vs mean=' + (fr.meanMass * 1000).toFixed(1) + ' g');
check('R50 < R90 < 最大散布半径', fr.r50 < fr.r90 && fr.r90 < fr.maxRadius,
  fr.r50.toFixed(0) + ' < ' + fr.r90.toFixed(0) + ' < ' + fr.maxRadius.toFixed(0) + ' m');
check('有效破片(>100 m/s) ≤ 落地破片', fr.effectiveCount <= fr.landedCount,
  fr.effectiveCount + ' / ' + fr.landedCount);
check('破片飞行时长 5–60 s', fr.duration > 5 && fr.duration < 60, fr.duration.toFixed(1) + ' s');
// 可复现性
const simA = B.simulate({ v0: 450, angle: 45, hBoom: 12, fragCount: 400, seed: 777 });
const simB = B.simulate({ v0: 450, angle: 45, hBoom: 12, fragCount: 400, seed: 777 });
check('相同随机种子 → 破片结果可复现', simA.fragments.r90 === simB.fragments.r90 &&
  simA.fragments.massSum === simB.fragments.massSum, 'R90=' + simA.fragments.r90.toFixed(1) + ' m');
const simC = B.simulate({ v0: 450, angle: 45, hBoom: 12, fragCount: 400, seed: 778 });
check('不同随机种子 → 破片抽样不同', simA.fragments.r90 !== simC.fragments.r90,
  simA.fragments.r90.toFixed(1) + ' vs ' + simC.fragments.r90.toFixed(1) + ' m');
// 触地爆回归：破片起始位置在地平面 ±wallR 内，出生在地下且向下者必须立即落地
const gb = B.simulate({ v0: 450, angle: 45, hBoom: 0, fragCount: 300 });
let gbLo = Infinity, gbHi = -Infinity;
for (const fg of gb.fragments.list) {
  if (!fg.landed) continue;
  if (fg.landV < gbLo) gbLo = fg.landV;
  if (fg.landV > gbHi) gbHi = fg.landV;
}
check('触地爆（hBoom=0）全部破片落地', gb.fragments.unlanded === 0,
  '落地 ' + gb.fragments.landedCount + '/' + gb.fragments.count);
check('落地破片均带有效着速（渲染着速色标数据源）',
  isFinite(gbLo) && gbHi > gbLo && gbLo > 0,
  'landV ∈ [' + gbLo.toFixed(0) + ', ' + gbHi.toFixed(0) + '] m/s');

/* ------------------- 6. McCoy 105mm HE M1 6-DOF 对照 ------------------- */
console.log('\n[6] 与 McCoy《Modern Exterior Ballistics》105mm HE M1 6-DOF 数据对照');
const S = B.SHELL;
const saved = { mass: S.mass, D: S.D, S: S.S, L: S.L, Ix: S.Ix, Iy: S.Iy, xcgD: S.xcgD };
Object.assign(S, {
  mass: 14.97, D: 0.1048, S: Math.PI * 0.1048 * 0.1048 / 4, L: 0.4947,
  Ix: 0.02326, Iy: 0.23118, xcgD: (0.4947 - 0.1834) / 0.1048
});
function m1(v0, angle, wz0) {
  return B.simulate({
    v0, angle, hBoom: 0, fragCount: 30, dt: 0.00025, twist: 18,
    jump: 0, yaw0: 0, wy0: 0, wz0,
    env: { tempC: 15, latitude: 0, useCoriolis: false }
  });
}
const cases = [
  { label: 'C7 45°', v0: 493, angle: 45, wz: 3.61, range: 11500, tof: 52.5, alt: 3460 },
  { label: 'C1 45°', v0: 205, angle: 45, wz: 1.44, range: 3760, tof: 28.5, alt: 1000 },
  { label: 'C7 70°', v0: 493, angle: 70, wz: 3.64, range: 7300, tof: 70.5, alt: 6000 },
  { label: 'C1 70°', v0: 205, angle: 70, wz: 1.47, range: 2320, tof: 38.5, alt: 1750 }
];
let mcOk = true;
for (const c of cases) {
  const r = m1(c.v0, c.angle, c.wz);
  const dR = (r.range - c.range) / c.range * 100;
  const dT = (r.flightTime - c.tof) / c.tof * 100;
  const dA = (r.maxAlt - c.alt) / c.alt * 100;
  const ok = Math.abs(dR) < 6 && Math.abs(dT) < 2 && Math.abs(dA) < 6;
  mcOk = mcOk && ok;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.label +
    '  射程 ' + c.range + ' → ' + r.range.toFixed(0) + ' m (' + dR.toFixed(1) + '%)' +
    '  飞行 ' + c.tof + ' → ' + r.flightTime.toFixed(1) + ' s (' + dT.toFixed(1) + '%)' +
    '  高度 ' + c.alt + ' → ' + r.maxAlt.toFixed(0) + ' m (' + dA.toFixed(1) + '%)');
}
check('McCoy 四组算例均在 6% 内', mcOk);
const m1c7 = m1(493, 45, 3.61);
check('105mm M1 炮口 Sg ≈ McCoy 报道值 3.1', near(m1c7.Sg0, 3.1, 0.05), m1c7.Sg0.toFixed(2));
Object.assign(S, saved);

/* ---------------- 6b. McCoy 120mm 迫弹 6-DOF 对照（表 9.7） ---------------- */
console.log('\n[6b] 与 McCoy 表 9.7 120mm 迫弹 6-DOF 数据对照（尾翼稳定、不旋转）');
B.applyPreset('mortar120');
const mortarCases = [
  { v0: 102, angle: 45, wz: 0.913, range: 1010, tof: 14.6, alt: 260 },
  { v0: 102, angle: 65, wz: 0.913, range: 770, tof: 18.6, alt: 420 },
  { v0: 102, angle: 85, wz: 0.913, range: 165, tof: 20.5, alt: 510 },
  { v0: 318, angle: 45, wz: 1.795, range: 7315, tof: 41.4, alt: 2100 },
  { v0: 318, angle: 65, wz: 1.795, range: 5570, tof: 52.6, alt: 3380 },
  { v0: 318, angle: 85, wz: 1.795, range: 1275, tof: 57.7, alt: 4070 }
];
let mtOk = true;
for (const c of mortarCases) {
  const r = B.simulate({
    v0: c.v0, angle: c.angle, hBoom: 0, fragCount: 30,
    wz0: c.wz, wy0: 0, jump: 0, yaw0: 0,
    env: { tempC: 15, latitude: 0, useCoriolis: false }
  });
  const dR = (r.range - c.range) / c.range * 100;
  const dT = (r.flightTime - c.tof) / c.tof * 100;
  const dA = (r.maxAlt - c.alt) / c.alt * 100;
  const ok = Math.abs(dR) < 3 && Math.abs(dT) < 1.5 && Math.abs(dA) < 2;
  mtOk = mtOk && ok;
  console.log('  ' + (ok ? '✓' : '✗') + ' v0=' + c.v0 + ' QE=' + c.angle +
    '°  射程 ' + c.range + ' → ' + r.range.toFixed(0) + ' m (' + dR.toFixed(1) + '%)' +
    '  飞行 ' + c.tof + ' → ' + r.flightTime.toFixed(1) + ' s (' + dT.toFixed(1) + '%)' +
    '  高度 ' + c.alt + ' → ' + r.maxAlt.toFixed(0) + ' m (' + dA.toFixed(1) + '%)');
}
check('McCoy 120mm 迫弹六组算例均在 3% 内', mtOk);
const mt45 = B.simulate({ v0: 318, angle: 45, hBoom: 0, fragCount: 30, wz0: 1.795,
  wy0: 0, jump: 0, yaw0: 0, env: { latitude: 0, useCoriolis: false } });
check('迫弹 318 m/s 静稳定裕度 ≈ 1.32 cal', near(mt45.staticMargin, 1.32, 0.05),
  mt45.staticMargin.toFixed(2) + ' cal');
check('迫弹不旋转（自转 = 0）', mt45.spin0 === 0, String(mt45.spin0));
check('迫弹全程不出现陀螺稳定因子（静稳定）', !isFinite(mt45.Sg0) || mt45.Sg0 === 0,
  String(mt45.Sg0));
const m85a = B.simulate({ v0: 102, angle: 85, hBoom: 0, fragCount: 30, wz0: 0.913,
  wy0: 0, jump: 0, yaw0: 0, env: { latitude: 0, useCoriolis: false } });
const m85b = B.simulate({ v0: 318, angle: 85, hBoom: 0, fragCount: 30, wz0: 1.795,
  wy0: 0, jump: 0, yaw0: 0, env: { latitude: 0, useCoriolis: false } });
check('85° 高射角顶点大攻角（装药0 约 50°，McCoy 47°）', m85a.maxAlpha > 30 && m85a.maxAlpha < 70,
  m85a.maxAlpha.toFixed(1) + '°');
check('85° 高射角装药4 顶点攻角约 13°', m85b.maxAlpha > 6 && m85b.maxAlpha < 22,
  m85b.maxAlpha.toFixed(1) + '°');

/* ------------------------- 7. 性能 ------------------------- */
console.log('\n[7] 性能');
let t0 = Date.now();
const perfSpin = B.simulate({ preset: 'spin120', v0: 450, angle: 45, hBoom: 12, fragCount: 800 });
let ms = Date.now() - t0;
console.log('  旋转弹（800 破片）单次仿真: ' + ms + ' ms  (采样 ' + perfSpin.samples.length + ' 点)');
check('旋转弹单次仿真 < 400 ms', ms < 400, ms + ' ms');
t0 = Date.now();
const perfMortar = B.simulate({ preset: 'mortar120', v0: 318, angle: 45, hBoom: 12, fragCount: 800 });
ms = Date.now() - t0;
console.log('  120mm 迫弹（800 破片）单次仿真: ' + ms + ' ms  (采样 ' + perfMortar.samples.length + ' 点)');
check('迫弹单次仿真 < 400 ms', ms < 400, ms + ' ms');

/* ------------------------------ 汇总 ------------------------------ */
console.log('\n================ 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ================');
process.exit(fail ? 1 : 0);
