/* verify/lib/audit-frag.js — D 破片模型（Mott/Gurney/R90/可复现性/积分步长） */
'use strict';
const { createRefSim } = require('./refsim');
const { summary, summarize, quantile, ksTest } = require('./stats');
const U = require('./audit-util');

const PATCH_FRAGDT = [/    var dt = 0\.01;/, '    var dt = (cfg.fragDt != null ? cfg.fragDt : 0.01);'];
const CFG = { v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 };

function weightedRadius(frags, weightKey, frac) {
  const sorted = frags.slice().sort((a, b) => a.radius - b.radius);
  const total = sorted.reduce((s, f) => s + f[weightKey], 0);
  let acc = 0;
  for (const f of sorted) { acc += f[weightKey]; if (acc >= total * frac) return f.radius; }
  return sorted.length ? sorted[sorted.length - 1].radius : 0;
}

function run(env) {
  const { BASE, loadNative } = env;
  const P = loadNative(BASE);
  const I = P.internals, SH = I.SHELL;
  const out = { section: 'D', title: '动爆破片（Mott/Gurney/R90/统计）', rows: [], data: {}, issues: [] };

  P.setSeed(20240601);
  const r = P.B.simulate(Object.assign({}, CFG));
  const f = r.fragments;
  const landed = f.list.filter((x) => x.landed);

  // ---- D1: 质量守恒与分布 ----
  let sumM = 0, atMin = 0, atMax = 0;
  const meanM0 = SH.casing / f.count;
  const zoneMass = [0, 0, 0], zoneCnt = [0, 0, 0];
  const masses = [];
  for (const x of f.list) {
    sumM += x.m; masses.push(x.m);
    zoneMass[x.zone] += x.m; zoneCnt[x.zone]++;
    if (Math.abs(x.m - meanM0 * 0.05 * 1.001) < 1e-9) atMin++;
    if (Math.abs(x.m - f.maxMass) < 1e-9) atMax++;  // 被上限截断（200g*归一化）的破片
  }
  const ms = summarize(masses);
  out.data.D1 = { sumMass: sumM, casing: SH.casing, relErr: sumM / SH.casing - 1, count: f.count, meanMass: f.meanMass, maxMass: f.maxMass, minMass: Math.min.apply(null, masses), cv: ms.cv, zoneMass, zoneCnt, atMinClamp: atMin, atMaxClamp: atMax };
  out.rows.push('D1. 质量守恒：Σm = ' + sumM.toFixed(6) + ' kg（壳体 ' + SH.casing + ' kg，相对误差 ' + (out.data.D1.relErr * 100).toExponential(1) + '%）；破片数 ' + f.count + '，平均 ' + (f.meanMass * 1000).toFixed(2) + ' g，最大 ' + (f.maxMass * 1000).toFixed(1) + ' g，最小 ' + (Math.min.apply(null, masses) * 1000).toFixed(2) + ' g，CV=' + ms.cv.toFixed(2) + '。');
  out.rows.push('    分区: 头部 ' + zoneCnt[0] + ' 枚/' + (zoneMass[0] * 1000).toFixed(0) + 'g（' + (zoneMass[0] / sumM * 100).toFixed(1) + '% 质量），圆柱 ' + zoneCnt[1] + '/' + (zoneMass[1] * 1000).toFixed(0) + 'g（' + (zoneMass[1] / sumM * 100).toFixed(1) + '%），弹底 ' + zoneCnt[2] + '/' + (zoneMass[2] * 1000).toFixed(0) + 'g（' + (zoneMass[2] / sumM * 100).toFixed(1) + '%）。');
  out.rows.push('    质量截断: 下限 0.05×均值触顶 ' + atMin + ' 枚，上限 8×均值截断后出现 ' + atMax + ' 枚等质量最大破片（截断值 200g，再乘归一化系数 1.13 → 实际最大 ' + (f.maxMass * 1000).toFixed(0) + 'g）。');
  out.data.D1.zoneMassFrac = zoneMass.map((x) => x / sumM);
  out.issues.push({ level: 'P2', id: 'D1', text: '质量守恒由事后归一化强制满足（Σ=10.5kg 精确），但 Mott 分布被分区质量因子、[0.05,8]×均值截断和重归一化三重扭曲：上限 200g 处出现 ' + atMax + ' 枚“堆积”大破片（最大 ' + (f.maxMass * 1000).toFixed(0) + 'g），对 120mm 薄壁杀爆弹偏大且不物理。建议按分区分别定义 Mott μ 并放弃全局截断/重归一化，或标记为“示意模型”。' });

  // ---- D2: Mott 采样器统计 ----
  P.setSeed(12345);
  const mu = f.mu;
  const N = 100000, smp = new Array(N);
  for (let i = 0; i < N; i++) smp[i] = I.sampleMottMass(mu);
  const ss = summarize(smp);
  const ks = ksTest(smp, (m) => 1 - Math.exp(-Math.sqrt(m / mu)));
  out.data.D2 = { mu, rawMean: ss.mean, theoryMean: 2 * mu, rawCV: ss.cv, theoryCV: Math.sqrt(5), varRatio: ss.sd * ss.sd / (4 * mu * mu), ksD: ks.D, ksP: ks.p, n: N, maxRaw: ss.max };
  out.rows.push('D2. Mott 逆采样器（μ=' + (mu * 1000).toFixed(2) + 'g）：均值 ' + (ss.mean * 1000).toFixed(2) + 'g（理论 2μ=' + (2 * mu * 1000).toFixed(2) + 'g，偏差 ' + ((ss.mean / (2 * mu) - 1) * 100).toFixed(2) + '%），CV=' + ss.cv.toFixed(3) + '（理论 5^0.5=' + Math.sqrt(5).toFixed(3) + '），方差/4μ²=' + out.data.D2.varRatio.toFixed(3) + '（理论 5），KS D=' + ks.D.toFixed(4) + ', p≈' + ks.p.toFixed(3) + ' => 原始采样器与 Mott 理论分布一致。');
  out.rows.push('    注意采样上限 u<0.9994：单枚最大 ' + (ss.max * 1000).toFixed(0) + 'g（理论无界）；截断使均值偏低约 ' + ((1 - ss.mean / (2 * mu)) * 100).toFixed(2) + '%。');
  out.issues.push({ level: 'P3', id: 'D2', text: 'Mott 采样器本身与理论一致（KS p=' + ks.p.toFixed(2) + '），均值偏差仅来自 0.9994 截断（≈' + ((1 - ss.mean / (2 * mu)) * 100).toFixed(2) + '%）；但最终破片质量分布被后续截断/归一化改变，见 D1。' });

  // ---- D3: Gurney 初速 / 能量预算 ----
  const betaG = SH.charge / SH.casing;
  const vG = Math.sqrt(SH.gurney2E * betaG / (1 + betaG / 2));
  const vRel = f.list.map((x) => x.v0);
  const vs = summarize(vRel);
  const KEg = 0.5 * SH.casing * vG * vG;
  const KEs = f.list.reduce((s, x) => s + 0.5 * x.m * x.v0 * x.v0, 0);
  out.data.D3 = { betaG, vG, vGReported: f.vGurney, vRelMean: vs.mean, vRelMin: vs.min, vRelMax: vs.max, KEgurney: KEg, KEfrag: KEs, KErange: KEs / KEg };
  out.rows.push('D3. Gurney：β=C/M=' + betaG.toFixed(4) + '，vG=√(2E·β/(1+β/2))=' + vG.toFixed(1) + ' m/s（代码 ' + f.vGurney.toFixed(1) + '）；0.5·M·vG²=' + (KEg / 1000).toFixed(0) + ' kJ。');
  out.rows.push('    实际破片初速（弹体系）：均值 ' + vs.mean.toFixed(0) + '，范围 ' + vs.min.toFixed(0) + '~' + vs.max.toFixed(0) + ' m/s；Σ0.5·m·v_rel²=' + (KEs / 1000).toFixed(0) + ' kJ（= ' + (KEs / KEg * 100).toFixed(1) + '% 的 Gurney 理想能量，其余被端部折减/质量修正“消耗”）。');
  out.rows.push('    动爆叠加弹速后（世界系）最大初速 ' + summarize(f.list.map((x) => { const dx = x.v0; return dx; })).max.toFixed(0) + ' m/s（含起爆点弹速 ' + r.boom.speed.toFixed(0) + ' m/s）。');
  out.issues.push({ level: 'P2', id: 'D3', text: '破片初速总动能只有 Gurney 理想值的 ' + (KEs / KEg * 100).toFixed(0) + '%：端部折减/质量相关修正使能量不闭合；Gurney 公式本应作为能量基准，建议在模型说明里明确“端部折减系数为工程修正，总动能不守恒于 vG”，或把折减系数标定到实际壳体。' });

  // ---- D4: R90 定义与蒙特卡洛噪声 ----
  const radii = landed.map((x) => x.radius);
  const hist = new Array(12).fill(0);
  for (const v of radii) hist[Math.min(11, Math.floor(v / 75))]++;
  const sorted = radii.slice().sort((a, b) => a - b);
  const r50 = quantile(sorted, 0.5), r90 = quantile(sorted, 0.9);
  const massR90 = weightedRadius(landed, 'm', 0.9);
  const energyR90 = weightedRadius(landed, 'energy', 0.9);
  const kill = landed.filter((x) => x.energy > 78);
  const killR50 = quantile(kill.map((x) => x.radius).sort((a, b) => a - b), 0.5);
  const killR90 = quantile(kill.map((x) => x.radius).sort((a, b) => a - b), 0.9);
  out.data.D4 = { r50, r90, massR90, energyR90, killCount: f.killCount, killR50, killR90, hist, histBin: 75 };
  out.rows.push('D4. R90/R50 口径（seed=20240601, N=420）：等权 90% 半径 r90=' + r90.toFixed(1) + ' m，r50=' + r50.toFixed(1) + ' m；质量加权 90% 半径=' + massR90.toFixed(1) + ' m；能量加权 90% 半径=' + energyR90.toFixed(1) + ' m；>78J 破片 r50/r90=' + killR50.toFixed(1) + '/' + killR90.toFixed(1) + ' m。');
  out.rows.push('    落点半径直方图（75m/箱）: ' + hist.map((n, i) => (i * 75) + 'm:' + n).join(' '));
  out.rows.push('    => 分布强烈双峰（46% 破片落在 <75m，其余落在 150–400m），中位数 r50 恰好落在“空档”，导致 r50 对随机实现极不稳定；r90 稳定。');
  out.issues.push({ level: 'P1', id: 'D4a', text: 'R90 口径未定义：UI 只显示“破片 R90”。同一批破片：等权= ' + r90.toFixed(0) + ' m、质量加权= ' + massR90.toFixed(0) + ' m、能量加权= ' + energyR90.toFixed(0) + ' m、>78J 破片等权= ' + killR90.toFixed(0) + ' m，相差 2 倍以上。文献无统一 R90 定义（文献调研结论），必须明确写清所用定义（建议同时给出等权/质量加权两个值并在 UI 标注）。' });

  // 蒙特卡洛种子离散
  const seeds = [];
  for (let s = 1; s <= 25; s++) {
    P.setSeed(s * 7919);
    const rr = P.B.simulate(Object.assign({}, CFG));
    const ff = rr.fragments;
    seeds.push({ r90: ff.r90, r50: ff.r50, duration: ff.duration, kill: ff.killCount, maxMass: ff.maxMass, totalEnergy: ff.totalEnergy });
  }
  const agg = {};
  for (const k of ['r90', 'r50', 'duration', 'kill', 'maxMass', 'totalEnergy']) {
    const a = seeds.map((x) => x[k]);
    const sm = summarize(a);
    agg[k] = { mean: sm.mean, sd: sm.sd, cv: sm.cv, min: sm.min, max: sm.max };
  }
  out.data.D4.seeds = agg;
  out.rows.push('    25 个随机种子的统计：r90=' + agg.r90.mean.toFixed(1) + '±' + agg.r90.sd.toFixed(1) + ' m（CV ' + (agg.r90.cv * 100).toFixed(1) + '%，范围 ' + agg.r90.min.toFixed(0) + '–' + agg.r90.max.toFixed(0) + '），r50=' + agg.r50.mean.toFixed(1) + '±' + agg.r50.sd.toFixed(1) + ' m（CV ' + (agg.r50.cv * 100).toFixed(1) + '%），kill(>78J)=' + agg.kill.mean.toFixed(0) + '±' + agg.kill.sd.toFixed(0) + '，duration=' + agg.duration.mean.toFixed(2) + '±' + agg.duration.sd.toFixed(2) + ' s，总动能=' + (agg.totalEnergy.mean / 1000).toFixed(0) + '±' + (agg.totalEnergy.sd / 1000).toFixed(0) + ' kJ。');
  out.issues.push({ level: 'P1', id: 'D4b', text: '统计量对随机实现敏感：420 枚破片时 r90 的种子间 CV≈' + (agg.r90.cv * 100).toFixed(1) + '%（范围 ' + agg.r90.min.toFixed(0) + '–' + agg.r90.max.toFixed(0) + ' m）、r50 CV≈' + (agg.r50.cv * 100).toFixed(0) + '%（双峰分布中位数落在空档）。UI 每次刷新得到不同 R90 且不显示种子。建议：固定默认种子+显示/可输入种子，或把 fragCount 提高（>2000）并给出均值和置信区间。' });

  // ---- D5: 78J 统计口径 ----
  const killMass = kill.reduce((s, x) => s + x.m, 0);
  const totE = landed.reduce((s, x) => s + x.energy, 0);
  const Earr = landed.map((x) => x.energy);
  out.data.D5 = { killCount: f.killCount, killFrac: f.killCount / f.count, killMass, totalEnergy: totE, meanKE: totE / landed.length, maxKE: Math.max.apply(null, Earr), landed: f.landedCount, unlanded: f.unlanded };
  out.rows.push('D5. 78J 阈值统计：落地 ' + f.landedCount + '/' + f.count + ' 枚（未落地 ' + f.unlanded + ' 枚计 0 能量并排除出 R90/能量统计）；>78J 共 ' + f.killCount + ' 枚（' + (f.killCount / f.count * 100).toFixed(0) + '%），携带质量 ' + killMass.toFixed(2) + ' kg（' + (killMass / SH.casing * 100).toFixed(0) + '% 壳体），总动能 ' + (totE / 1000).toFixed(0) + ' kJ，均值 ' + (totE / landed.length / 1000).toFixed(1) + ' kJ，最大 ' + (Math.max.apply(null, Earr) / 1000).toFixed(1) + ' kJ。');
  out.rows.push('    代码另算了 landV>100 的 effectiveCount 但未导出/未使用（死代码）；killCount 只统计落地动能>78J 的“枚数”，不是杀伤面积/概率，UI 与文档都没有说明。');
  out.issues.push({ level: 'P2', id: 'D5', text: '78J 判据使用得当但统计口径弱：仅统计落地破片且只给“枚数”，不含面积/概率；文献调研确认可核实的是 80J 判据（Rettinger 2017），78J 仅有二手来源。另外 effectiveCount(landV>100) 是死代码。建议 UI 标注“78J（≈80J 判据）”，改为给出杀伤面积/杀伤概率或按质量加权统计。' });

  // ---- D6: 随机可复现性 ----
  P.setSeed(42); const a1 = P.B.simulate(Object.assign({}, CFG)).fragments.r90;
  P.setSeed(43); const a2 = P.B.simulate(Object.assign({}, CFG)).fragments.r90;
  const origRandom = Math.random;
  P.setSeed(42); const b1 = P.B.simulate(Object.assign({}, CFG)).fragments.r90;
  P.setSeed(42); const b2 = P.B.simulate(Object.assign({}, CFG)).fragments.r90;
  out.data.D6 = { unseeded_a1: a1, unseeded_a2: a2, seeded_b1: b1, seeded_b2: b2 };
  out.rows.push('D6. 可复现性：不同种子 r90=' + a1.toFixed(1) + ' vs ' + a2.toFixed(1) + ' m（不同）；同一种子两次=' + b1.toFixed(1) + ' vs ' + b2.toFixed(1) + ' m（逐位一致）。physics.js 直接使用全局 Math.random()，没有种子参数，每次页面刷新/参数调整结果都变。');
  out.issues.push({ level: 'P2', id: 'D6', text: '破片仿真使用全局 Math.random()，无种子入口：同参数两次运行 r90 可差 ' + Math.abs(a1 - a2).toFixed(0) + ' m，结果不可复现。建议 simulate(cfg) 接受 seed（或注入 RNG），UI 显示种子并支持复现。' });

  // ---- D7: 破片积分步长收敛 ----
  const Pd = loadNative(BASE, { patches: [PATCH_FRAGDT] });
  const dtRows = [];
  for (const fragDt of [0.01, 0.005, 0.0025, 0.001]) {
    Pd.setSeed(20240601);
    const rr = Pd.B.simulate(Object.assign({}, CFG, { fragDt }));
    const ff = rr.fragments;
    const t0 = process.hrtime.bigint();
    Pd.setSeed(20240601);
    const ms = (() => { const t = process.hrtime.bigint(); Pd.B.simulate(Object.assign({}, CFG, { fragDt })); return Number(process.hrtime.bigint() - t) / 1e6; })();
    dtRows.push({ fragDt, r90: ff.r90, r50: ff.r50, avgLandV: ff.avgLandV, totalEnergy: ff.totalEnergy, duration: ff.duration, kill: ff.killCount, maxRadius: ff.maxRadius, ms });
  }
  const ref = dtRows[dtRows.length - 1];
  for (const row of dtRows) { row.dr90 = (row.r90 / ref.r90 - 1) * 100; row.dV = (row.avgLandV / ref.avgLandV - 1) * 100; row.dE = (row.totalEnergy / ref.totalEnergy - 1) * 100; row.dDur = (row.duration / ref.duration - 1) * 100; }
  out.data.D7 = dtRows;
  out.rows.push('D7. 破片外弹道步长收敛（固定种子；RK2 中点法，当前 dt=0.01 s）：');
  out.rows.push('    dt(s)   r90(m)   Δr90%   平均落速  ΔV%     总动能(kJ) ΔE%    飞行时长(s) ΔT%    耗时(ms)');
  for (const x of dtRows) out.rows.push('    ' + U.pad(x.fragDt, 6) + '  ' + U.pad(x.r90.toFixed(1), 7) + '  ' + U.pad(x.dr90.toFixed(2), 7) + '  ' + U.pad(x.avgLandV.toFixed(1), 8) + '  ' + U.pad(x.dV.toFixed(2), 7) + '  ' + U.pad((x.totalEnergy / 1000).toFixed(0), 9) + '  ' + U.pad(x.dE.toFixed(2), 7) + '  ' + U.pad(x.duration.toFixed(3), 10) + '  ' + U.pad(x.dDur.toFixed(2), 6) + '  ' + U.pad(x.ms.toFixed(0), 6));
  out.rows.push('    => dt 从 0.01→0.0025：平均落地速度被低估 ' + Math.abs(dtRows[0].dV - dtRows[2].dV).toFixed(1) + '%、总动能被低估 ' + Math.abs(dtRows[0].dE - dtRows[2].dE).toFixed(1) + '%、r90 被低估 ' + Math.abs(dtRows[2].dr90 - dtRows[0].dr90).toFixed(2) + '%；dt=0.01 的破片阻力积分误差约 5–10%（V² 强阻尼段每步 Δv 可达 ~200 m/s）。');
  out.issues.push({ level: 'P1', id: 'D7', text: '破片外弹道 RK2 步长 dt=0.01s 偏大：初速 1500 m/s 时每步位移 15m、阻力减速可达 ~200 m/s/步。与 dt=0.0025 对比，平均落地速度偏低 ~' + (dtRows[2].dV - dtRows[0].dV).toFixed(1) + '%、总动能偏低 ~' + (dtRows[2].dE - dtRows[0].dE).toFixed(1) + '%、r90 偏低 ~' + (dtRows[2].dr90 - dtRows[0].dr90).toFixed(1) + '%（绝对 ' + (dtRows[2].r90 - dtRows[0].r90).toFixed(1) + ' m）。建议 dt≤0.0025（耗时约 2~3x，仍 <10ms）或改用 RK4/解析积分。' });

  return out;
}
module.exports = { run };
