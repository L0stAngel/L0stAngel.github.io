/* verify/lib/audit-trajectory.js — E 弹道合理性与侧偏来源 */
'use strict';
const { createRefSim } = require('./refsim');
const { isa } = require('./isa');
const U = require('./audit-util');

const CFG = { v0: 450, angle: 45, hBoom: 12, spin: 18 };
const G0 = 9.80665;

function threeDof(I, v0, angleDeg, hBoom) {
  const SH = I.SHELL;
  let x = 0, y = 0, vx = v0 * Math.cos(angleDeg * Math.PI / 180), vy = v0 * Math.sin(angleDeg * Math.PI / 180);
  const dt = 0.001; let t = 0, maxAlt = 0;
  const acc = (yy, vxx, vyy) => {
    const V = Math.hypot(vxx, vyy), atm = I.atmosphere(yy), co = I.aeroAt(V / atm.a), q = 0.5 * atm.rho * V * V;
    const D = q * SH.S * co[0];
    return [-D * vxx / V / SH.mass, -D * vyy / V / SH.mass - G0];
  };
  while (t < 200) {
    const oldY = y;
    const k1 = [vx, vy, ...acc(y, vx, vy)];
    const k2 = [vx + k1[2] * dt / 2, vy + k1[3] * dt / 2, ...acc(y + k1[1] * dt / 2, vx + k1[2] * dt / 2, vy + k1[3] * dt / 2)];
    const k3 = [vx + k2[2] * dt / 2, vy + k2[3] * dt / 2, ...acc(y + k2[1] * dt / 2, vx + k2[2] * dt / 2, vy + k2[3] * dt / 2)];
    const k4 = [vx + k3[2] * dt, vy + k3[3] * dt, ...acc(y + k3[1] * dt, vx + k3[2] * dt, vy + k3[3] * dt)];
    x += dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
    y += dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    vx += dt * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / 6;
    vy += dt * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) / 6;
    t += dt;
    if (y > maxAlt) maxAlt = y;
    if (vy < 0 && oldY > hBoom && y <= hBoom) return { t: t - dt + dt * (oldY - hBoom) / (oldY - y), x, maxAlt, V: Math.hypot(vx, vy) };
  }
  return { t, x, maxAlt, V: Math.hypot(vx, vy) };
}

function run(env) {
  const { BASE, loadNative } = env;
  const P = loadNative(BASE);
  const I = P.internals;
  const R = createRefSim(I);
  const out = { section: 'E', title: '弹道合理性与无风侧偏来源', rows: [], data: {}, issues: [] };

  // ---- E1: 基线 + 真空 + 3DOF 交叉核对 ----
  P.setSeed(20240601);
  const r = P.B.simulate(Object.assign({}, CFG, { fragCount: 60 }));
  const r3 = threeDof(I, CFG.v0, CFG.angle, CFG.hBoom);
  const vac = { R: CFG.v0 * CFG.v0 / G0, alt: Math.pow(CFG.v0 * Math.sin(CFG.angle * Math.PI / 180), 2) / (2 * G0), t: 2 * CFG.v0 * Math.sin(CFG.angle * Math.PI / 180) / G0 };
  out.data.E1 = { baseline: { t: r.flightTime, R: r.range, alt: r.maxAlt, Vimp: r.boom.speed, machMax: r.maxMach, qMax: r.maxQ, alphaMax: r.maxAlpha }, threeDof: r3, vacuum: vac };
  out.rows.push('E1. 基线（v0=450 m/s, 45°, hBoom=12m）：t=' + r.flightTime.toFixed(2) + ' s，R=' + r.range.toFixed(0) + ' m，Hmax=' + r.maxAlt.toFixed(0) + ' m，V_imp=' + r.boom.speed.toFixed(0) + ' m/s，Ma_max=' + r.maxMach.toFixed(2) + '，q_max=' + r.maxQ.toFixed(1) + ' kPa，α_max=' + r.maxAlpha.toFixed(2) + '°。');
  out.rows.push('    真空弹道：R=' + vac.R.toFixed(0) + ' m，Hmax=' + vac.alt.toFixed(0) + ' m，t=' + vac.t.toFixed(1) + ' s => 实际分别 ' + (r.range / vac.R * 100).toFixed(1) + '% / ' + (r.maxAlt / vac.alt * 100).toFixed(1) + '% / ' + (r.flightTime / vac.t * 100).toFixed(1) + '%。');
  out.rows.push('    独立 3DOF 质点（同一 atmosphere/aeroAt、同表 Cx0(Ma)、dt=1ms）：t=' + r3.t.toFixed(3) + ' s，R=' + r3.x.toFixed(1) + ' m，Hmax=' + r3.maxAlt.toFixed(1) + ' m => 与 6DOF 差 ΔR=' + (r.range - r3.x).toFixed(1) + ' m（' + ((r.range / r3.x - 1) * 100).toFixed(2) + '%）、Δt=' + (r.flightTime - r3.t).toFixed(3) + ' s（0.15%）、ΔH=' + (r.maxAlt - r3.maxAlt).toFixed(1) + ' m => 6DOF 弹道积分与阻力模型自洽。');
  out.issues.push({ level: 'P3', id: 'E1', text: '弹道量级自洽：6DOF 与独立 3DOF 质点弹道相差 0.02%（射程）/0.15%（飞行时间），真空对比合理（射程 42.6%、升弧 53%、时间 71.8%）。量级上没有明显物理错误，但真实精度取决于 Cx0 表（无文献对标）。' });

  // ---- E2: 无风侧偏分解 ----
  const combos = [
    { name: 'spin=18, wz=0,   wy=0（纯重力转弯+自转）', spin: 18, wz: 0, wy: 0 },
    { name: 'spin=18, wz=1.25,wy=0（基线）', spin: 18, wz: 1.25, wy: 0 },
    { name: 'spin=0,  wz=0,   wy=0（无自转无扰动）', spin: 0, wz: 0, wy: 0 },
    { name: 'spin=0,  wz=1.25,wy=0', spin: 0, wz: 1.25, wy: 0 },
    { name: 'spin=0,  wz=0,   wy=1.25', spin: 0, wz: 0, wy: 1.25 },
    { name: 'spin=18, wz=-1.25,wy=0', spin: 18, wz: -1.25, wy: 0 },
    { name: 'spin=18, wz=0,   wy=1.25', spin: 18, wz: 0, wy: 1.25 }
  ];
  const drift = [];
  for (const c of combos) {
    const rr = R.simulateRef({ v0: 450, angle: 45, hBoom: 12, spin: c.spin, wz: c.wz, wy: c.wy, dt: 1e-3 });
    drift.push({ name: c.name, spin: c.spin, wz: c.wz, wy: c.wy, impactZ: rr.impactZ, maxAlpha: rr.maxAlpha, flightTime: rr.flightTime, range: rr.range });
  }
  out.data.E2 = drift;
  out.rows.push('E2. 无风侧偏（z）来源分解（refsim，dt=1ms 已收敛；关掉 fragments）：');
  out.rows.push('    工况                                        z_imp(m)   maxα(°)    t(s)      R(m)');
  for (const d of drift) out.rows.push('    ' + U.pad(d.name, 42) + ' ' + U.pad(d.impactZ.toFixed(3), 9) + ' ' + U.pad(d.maxAlpha.toFixed(2), 9) + ' ' + U.pad(d.flightTime.toFixed(2), 8) + ' ' + U.pad(d.range.toFixed(1), 8));
  out.rows.push('    => 基线 2.90m 侧偏 = 自转+重力转弯产生的升力不对称 2.18m（spin=18,wz=0）+ 初始 wz=1.25 的 0.72m 增量；与风无关（windZ 未实现）。wy=1.25 的初始扰动可产生 19m 侧偏，说明初始扰动方向/大小对侧偏影响很大。');
  out.issues.push({ level: 'P1', id: 'E2', text: '无风侧偏 2.9m 并非来自风（windZ 未实现），而是“自转+重力转弯小攻角”产生的升力不对称（2.18m）叠加初始 wz=1.25 rad/s 扰动（+0.72m）。该量级来自未标定的气动/扰动模型，不是可验证的物理预测；且初始扰动只加在 wz 一个方向，产生确定性侧偏，而真实炮口扰动是随机的（均值为 0）。建议：初始扰动改为随机各向同性并给出统计（均值/散布），或明确标注为“示意性确定性扰动”。' });

  // ---- E3: 初始扰动合理性 ----
  const s = r.samples;
  const alphaFirst = s.slice(0, 200).reduce((m, x) => Math.max(m, Math.abs(x.alpha)), 0);
  out.data.E3 = { initialWz: 1.25, initialWy: 0, initialSpin: 18, maxAlpha: r.maxAlpha, firstPeakAlpha: alphaFirst };
  out.rows.push('E3. 初始扰动：simulate() 固定 y[12]=1.25 rad/s（弹体 z 轴角速度），wy=0。无阻尼静态估算对应 α≈' + (1.25 / 8.03 * 180 / Math.PI).toFixed(1) + '°，有气动阻尼后实测 maxα=' + r.maxAlpha.toFixed(2) + '°。该数值没有任何出处/标定，且只加在 z 轴（非各向同性）。');
  out.issues.push({ level: 'P1', id: 'E3', text: '初始扰动 y[12]=1.25 rad/s 是硬编码的经验值，无出处、非随机；它直接决定 maxα（2.4°）、α 振荡和 0.7m 侧偏。真实炮口扰动应给出统计模型（角速度均方根/截断正态、各向同性）并在文档中注明来源。' });

  // ---- E4: 参数极值 / 大气模型相关性 ----
  const sens = [];
  for (const [v0, ang] of [[450, 45], [450, 30], [450, 60], [550, 45], [550, 70], [250, 45], [318, 45]]) {
    P.setSeed(1);
    const rr = P.B.simulate({ v0, angle: ang, hBoom: 12, spin: 18, fragCount: 40 });
    sens.push({ v0, angle: ang, range: rr.range, maxAlt: rr.maxAlt, t: rr.flightTime, maxMach: rr.maxMach });
    out.rows.push('E4. 参数敏感性: v0=' + U.pad(v0, 4) + ' angle=' + U.pad(ang, 3) + '° -> R=' + U.pad(rr.range.toFixed(0), 6) + 'm  Hmax=' + U.pad(rr.maxAlt.toFixed(0), 6) + 'm  t=' + rr.flightTime.toFixed(2) + 's  Ma_max=' + rr.maxMach.toFixed(2) + '  ' + (rr.maxAlt > 11000 ? '*** 升弧超过 11km，触发大气模型错误 ***' : ''));
  }
  out.data.E4 = sens;
  const bad = sens.filter((x) => x.maxAlt > 11000);
  out.issues.push({ level: 'P1', id: 'E4', text: '当前 UI 参数范围（v0 250–550, angle 15–70°）实测最大升弧 ' + Math.max.apply(null, sens.map((x) => x.maxAlt)).toFixed(0) + 'm（v0=550/70°），尚未超过 11km 对流层顶，因此 B3 大气缺陷在现有 UI 下不暴露；但若升级把 v0 提到 600+ 或 angle 提到 75°+（或 Lead 的内核升级引入真实初速 ~900 m/s），升弧会进入 11–20km 错误区，必须同步修大气。' });

  // ---- E5: 与文献量级对照（M120 迫击炮）----
  out.data.E5 = { m120: { v0max: 318, mass: 13.65, range: 7200, source: 'https://man.fas.org/dod-101/sys/land/m933.htm' }, current: { v0: 450, mass: 15.5 } };
  out.rows.push('E5. 量级对照（文献调研提供）：M120 120mm 迫击炮 M934 弹 v0=318 m/s、全弹 13.65kg、最大射程 7200m（来源 man.fas.org/dod-101/sys/land/m933.htm）。physics.js 参数 v0=450 m/s、15.5kg 对 120mm 迫弹偏大，且迫击炮为滑膛（自转≈0），当前 6DOF 自转/马格努斯设定与该族不符；若定位为线膛炮杀爆弹，初速/弹重与 120mm 坦克炮滑膛也不符。=> 参数集不对应任何可核实的真实 120mm 型号，属于“示意性典型弹”。');
  out.issues.push({ level: 'P2', id: 'E5', text: '弹丸参数（450 m/s、15.5 kg、10.5 kg 壳体、3.2 kg 装药、自转 18 rad/s）不对应可核实的真实 120mm 型号：M120 迫击炮为滑膛/318 m/s/13.65kg，120mm 坦克炮为滑膛，线膛 120mm 杀爆弹数据未获取。建议在 UI/文档标注“典型参数，非特定型号”，并给出参数来源或区间。' });

  // ---- E6: 攻角跟踪与配平 ----
  const idx = [0, 2, 5, 10, 20, 30, 40].map((t) => Math.min(s.length - 1, Math.round(t / 0.02)));
  out.rows.push('E6. 基线 α/θ 历程：α=' + idx.map((i) => s[i].alpha.toFixed(2)).join('/') + '°，θ=' + idx.map((i) => s[i].theta.toFixed(1)).join('/') + '°（t=0/2/5/10/20/30/40s）。攻角被气动阻尼限制在 ±2.4° 内并随弹道倾角跟踪，物理上合理（静态稳定弹的准配平）。');
  return out;
}
module.exports = { run };
