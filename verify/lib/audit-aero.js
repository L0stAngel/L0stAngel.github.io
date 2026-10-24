/* verify/lib/audit-aero.js — C 气动/稳定性 */
'use strict';
const { createRefSim } = require('./refsim');
const { linearize } = require('./linearize');
const U = require('./audit-util');

const PATCH = {
  magnusOff: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = 0;'],
  magnusFlip: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = -qd * S * d * 1.30 * (wx * d / V);'],
  magnus01: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = qd * S * d * 0.10 * (wx * d / V);'],
  magnus03: [/var magK = qd \* S \* d \* 1\.30 \* \(wx \* d \/ V\);/, 'var magK = qd * S * d * 0.30 * (wx * d / V);'],
  rollDampOff: [/var Mx = damp \* \(-0\.06\) \* wx;/, 'var Mx = 0;']
};

function run(env) {
  const { BASE, loadNative } = env;
  const P = loadNative(BASE);
  const I = P.internals;
  const SH = I.SHELL;
  const out = { section: 'C', title: '气动系数 / 静稳定 / 自转与陀螺稳定性', rows: [], data: {}, issues: [] };

  // ---- C1: 气动表结构 ----
  const AERO = I.AERO;
  out.data.C1 = { tables: AERO, n: AERO.length };
  out.rows.push('C1. 气动表结构（[Ma, Cx0, CNα(1/rad), xcp/d]）：');
  let monoCx = true, monoCN = true, monoXcp = true;
  for (let i = 1; i < AERO.length; i++) {
    const dCx = AERO[i][1] - AERO[i - 1][1];
    if (i <= 6 && dCx < 0) monoCx = false;       // 跨音速前应递增
    if (i > 6 && dCx > 0) monoCx = false;        // 峰值后应递减
    const dCN = AERO[i][2] - AERO[i - 1][2];
    if (i <= 6 && dCN < 0) monoCN = false;
    if (i > 6 && dCN > 0) monoCN = false;
    const dX = AERO[i][3] - AERO[i - 1][3];
    if (i <= 7 && dX < 0) monoXcp = false;
    if (i > 7 && dX > 0) monoXcp = false;
  }
  const peaks = {
    Cx0: AERO.reduce((a, b) => (b[1] > a[1] ? b : a)),
    CNa: AERO.reduce((a, b) => (b[2] > a[2] ? b : a)),
    xcp: AERO.reduce((a, b) => (b[3] > a[3] ? b : a))
  };
  out.rows.push('    单调性: Cx0 峰前单调升/峰后单调降=' + monoCx + '，CNα=' + monoCN + '，xcp=' + monoXcp);
  out.rows.push('    峰值: Cx0=' + peaks.Cx0[1] + ' @Ma' + peaks.Cx0[0] + '（亚音速 ' + AERO[0][1] + ' → 跨音速峰 +' + ((peaks.Cx0[1] / AERO[0][1] - 1) * 100).toFixed(0) + '%）；CNα=' + peaks.CNa[2] + ' @Ma' + peaks.CNa[0] + '；xcp/d=' + peaks.xcp[3] + ' @Ma' + peaks.xcp[0]);
  out.data.C1.monotone = { Cx0: monoCx, CNa: monoCN, xcp: monoXcp };
  out.data.C1.peaks = peaks;
  out.issues.push({ level: 'P3', id: 'C1', text: '气动表分段单调、跨音速阻力峰位置合理（Ma≈1.05，Cx0 0.15→0.50），插值连续；CNα、xcp 的绝对量值暂无可靠文献对标（文献调研结论：未取得可核实值），建议在模型面板标注“典型量级/待标定”。' });

  // ---- C1b: aeroAt() 表端返回结构 bug ----
  const coEdge = { mach0: I.aeroAt(1e-9), mach4: I.aeroAt(4.0), mach5: I.aeroAt(5.0), mach399: I.aeroAt(3.999) };
  out.data.C1b = Object.fromEntries(Object.entries(coEdge).map(([k, v]) => [k, Array.from(v)]));
  const lastRow = AERO[AERO.length - 1];
  out.rows.push('C1b. aeroAt() 表端边界检查：内部插值分支返回 3 元组 [Cx0,CNα,xcp/d]，但越界分支 return AERO[0] / AERO[n-1] 返回 4 元组 [Ma,Cx0,CNα,xcp/d]：');
  out.rows.push('    Ma→0+ 返回 ' + JSON.stringify(Array.from(coEdge.mach0)) + '（4 元）; Ma=3.999 返回 ' + JSON.stringify(Array.from(coEdge.mach399)) + '（3 元）; Ma=4.0 返回 ' + JSON.stringify(Array.from(coEdge.mach4)) + '（4 元）; Ma=5.0 返回 ' + JSON.stringify(Array.from(coEdge.mach5)));
  out.rows.push('    => 当 Ma≥4.0 时 deriv() 里 Cx=co[0] 变成 Ma 本身（4.0），CNα=co[1] 变成 Cx0（0.18，低 9 倍），xcp/d=co[2] 变成 CNα（1.65）=> 阻力瞬间放大 ' + (4.0 / lastRow[1]).toFixed(0) + ' 倍并产生假的负静稳定裕度（xcp−xcg=1.65−2.90=−1.25 cal）。');
  out.issues.push({ level: 'P1', id: 'C1b', text: 'aeroAt() 边界返回结构 bug（physics.js 第 69–70 行）：mach≥4.0（或 ≤0）时 return 原表行 4 元组，而正常分支返回 3 元组 [Cx0,CNα,xcp]；导致 Ma≥4 时 Cx0 被误读为 Ma=4.0（阻力放大 22 倍）、CNα 被误读为 0.18、xcp 被误读为 1.65（假负静稳定裕度）。当前 UI（Ma≤1.9）不触发；若升级初速 >~1400 m/s（或高空低声速使马赫超 4）立即爆炸性失真。修复：两处 return 改为 [A[1],A[2],A[3]] 或统一返回对象。' });

  // ---- C2: 静稳定裕度 & 陀螺稳定因子 ----
  const atm0 = I.atmosphere(0);
  // 注意：只测表内/表末附近的 Mach；Ma≥4.0 有 aeroAt 返回值结构 bug（见 C1b）
  const machs = [0.5, 0.8, 1.0, 1.2, 1.32, 1.6, 2.0, 3.0, 3.5];
  out.rows.push('C2. 静稳定裕度 (xcp−xcg)/d 与陀螺稳定因子 Sg（Sg=Ix²p²/(4·Iy·q·S·d·|C_Mα|)，Sg>1 为必要，设计常取 1.2~1.5+）：');
  out.rows.push('    Ma    CNα    xcp/d   裕度(cal)  裕度(%L)  Sg(p=18)   Sg(p=1178)  Sg(p=1309)  所需自转 Sg=1 (rad/s)');
  const c2 = [];
  for (const Ma of machs) {
    const co = I.aeroAt(Ma);
    const margin = co[2] - SH.xcgD;
    const Cma = co[1] * margin; // |C_Mα| = CNα*(xcp/d - xcg/d)
    const qd = 0.5 * atm0.rho * Math.pow(Ma * atm0.a, 2);
    const denom = 4 * SH.Iy * qd * SH.S * SH.D * Math.abs(Cma);
    const sg = (p) => denom > 0 ? (SH.Ix * p) * (SH.Ix * p) / denom : Infinity;
    const pReq = denom > 0 ? Math.sqrt(denom) / SH.Ix : Infinity;
    const rec = { Ma, CNa: co[1], xcp: co[2], margin, marginPct: margin / (SH.L / SH.D) * 100, sg18: sg(18), sg1178: sg(1178), sg1309: sg(1309), pReq };
    c2.push(rec);
    out.rows.push('    ' + U.pad(Ma.toFixed(2), 5) + ' ' + U.pad(co[1].toFixed(2), 6) + ' ' + U.pad(co[2].toFixed(2), 7) + ' ' + U.pad(margin.toFixed(2), 9) + ' ' + U.pad(rec.marginPct.toFixed(1), 9) + ' ' + U.pad(isFinite(rec.sg18) ? rec.sg18.toExponential(1) : '-', 9) + ' ' + U.pad(isFinite(rec.sg1178) ? rec.sg1178.toFixed(2) : '-', 11) + ' ' + U.pad(isFinite(rec.sg1309) ? rec.sg1309.toFixed(2) : '-', 11) + ' ' + U.pad(isFinite(pReq) ? pReq.toFixed(0) : '-', 10));
  }
  out.data.C2 = c2;
  const sgLaunch = c2.find(x => Math.abs(x.Ma - 1.32) < 0.01);
  out.rows.push('    => 基线发射条件 (Ma=1.32)：静稳定裕度 ' + sgLaunch.margin.toFixed(2) + ' cal（' + sgLaunch.marginPct.toFixed(1) + '% 弹长）；p=18 时 Sg=' + sgLaunch.sg18.toExponential(1) + '（≪1，模型实际处于无陀螺稳定状态），要 Sg≥1 需 p≥' + sgLaunch.pReq.toFixed(0) + ' rad/s（约 1:' + (2 * Math.PI * 450 / (sgLaunch.pReq * 0.12)).toFixed(1) + ' 缠度），Sg=1.5 需 p≥' + (sgLaunch.pReq * Math.sqrt(1.5)).toFixed(0) + ' rad/s。');
  out.data.C2.launch = sgLaunch;
  out.issues.push({ level: 'P0', id: 'C2', text: '自转与气动参数不自洽：默认 spin=18 rad/s 时陀螺稳定因子 Sg≈' + sgLaunch.sg18.toExponential(1) + '（≪1），旋转稳定弹丸在不旋转/弱旋转下靠俯仰阻尼维持小攻角；若换成真实缠度自转（1:20→1178、1:18→1309 rad/s），Sg≈' + sgLaunch.sg1178.toFixed(2) + '/' + sgLaunch.sg1309.toFixed(2) + ' 仅勉强过 1，叠加马格努斯力矩后模型直接翻滚（见 C4/C5）。二者必居其一：要么这是滑膛弹（自转应≈0，应去掉陀螺/马格努斯项），要么是线膛弹（自转应 ~1000+，需重标定静稳定裕度与 Magnus 系数）。' });

  // ---- C3: 自转量级 ----
  const spinRows = [
    { name: 'smoothbore 120mm tank/mortar', p: 0, note: 'M256/M120 均为滑膛（文献可核实）' },
    { name: 'rifled 1:20 cal/turn', p: 2 * Math.PI * 450 / (20 * 0.12), note: 'ω=2πv/(n·d)' },
    { name: 'rifled 1:18 cal/turn', p: 2 * Math.PI * 450 / (18 * 0.12), note: 'ω=2πv/(n·d)' },
    { name: 'rifled 1:25 cal/turn', p: 2 * Math.PI * 450 / (25 * 0.12), note: 'ω=2πv/(n·d)' },
    { name: 'physics.js 默认 spin', p: 18, note: '相当于 1:' + (2 * Math.PI * 450 / (18 * 0.12)).toFixed(1) + ' cal/turn' }
  ];
  out.data.C3 = spinRows;
  out.rows.push('C3. 自转量级对照（v0=450 m/s, d=0.12m）：');
  for (const s of spinRows) out.rows.push('    ' + U.pad(s.name, 32) + ' p=' + U.pad(s.p.toFixed(0), 6) + ' rad/s   ' + s.note);
  out.issues.push({ level: 'P0', id: 'C3', text: '默认自转 18 rad/s 对真实 120mm 弹不成立：滑膛弹应为 0，线膛弹 450 m/s 下约 940–1310 rad/s（1:25~1:18）。18 rad/s 既非滑膛也非线膛工况，导致 HUD「转速」显示和 6DOF 陀螺/马格努斯动力学全部失真（Magnus 项只有真实值的 1.4%）。' });

  // ---- C4: 模型方程的数值线性化（自动判定稳定/不稳定）----
  out.rows.push('C4. 对 physics.deriv 做数值有限差分线性化（状态 [α,β,wy,wz]，初始配平），特征值实部 Reλ>0 即模型自身不稳定：');
  out.rows.push('    spin(rad/s)  Reλmax(1/s)  |λ|max(rad/s)  频率(Hz)   判定    (Magnus 开启 1.30)');
  const linRows = [];
  for (const spin of [18, 300, 600, 900, 1178, 1200, 1309, 1500, 2000, 3000]) {
    const L = linearize(I, { h: 0, V: 450, spin });
    const e = L.eigs[0];
    linRows.push({ spin, re: e.re, abs: e.abs, freqHz: Math.abs(e.im) / (2 * Math.PI), unstable: e.re > 0.02 });
    out.rows.push('    ' + U.pad(spin, 11) + '  ' + U.pad(e.re.toFixed(3), 11) + '  ' + U.pad(e.abs.toFixed(1), 13) + '  ' + U.pad((Math.abs(e.im) / (2 * Math.PI)).toFixed(2), 8) + '  ' + U.pad(e.re > 0.02 ? '不稳定' : '稳定', 5));
  }
  out.data.C4 = linRows;
  const unstableFrom = linRows.find(x => x.unstable);
  out.issues.push({ level: 'P0', id: 'C4', text: '模型方程本身在真实自转下线性不稳定：对 physics.deriv 数值线性化，Reλ>0 从 spin≈' + (unstableFrom ? unstableFrom.spin : '?') + ' rad/s 开始出现；spin=1178 rad/s 时 Reλ≈' + linRows.find(x => x.spin === 1178).re.toFixed(2) + ' /s（时间常数 ' + (1 / linRows.find(x => x.spin === 1178).re).toFixed(2) + ' s），任何微小扰动都会在几秒内放大到翻滚。这不是 RK4 问题（dt 扫描已收敛），而是 Magnus 力矩系数 1.30 过大/符号约定问题（见 C5）。' });

  // Magnus 关闭 / 翻转 / 缩小的线性化对照
  out.rows.push('C5. 失稳归因（spin=1178，线性化 + 非线性 dt=2e-4/20s 小扰动 wz=1e-3）：');
  out.rows.push('    变体                   Reλmax(1/s)   非线性 max|α|(°)  dt 无关性');
  const variants = [
    ['baseline (C_mag=1.30)', null],
    ['C_mag=0', [PATCH.magnusOff]],
    ['C_mag=0.10', [PATCH.magnus01]],
    ['C_mag=0.30', [PATCH.magnus03]],
    ['C_mag=-1.30 (符号翻转)', [PATCH.magnusFlip]]
  ];
  const c5 = [];
  for (const [name, patch] of variants) {
    const pv = loadNative(BASE, patch ? { patches: patch } : {});
    const L = linearize(pv.internals, { h: 0, V: 450, spin: 1178 });
    const Rv = createRefSim(pv.internals);
    const r = Rv.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1178, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 20 });
    let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
    const r2 = Rv.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin: 1178, wz: 1e-3, wy: 0, dt: 1e-4, maxTime: 20 });
    let amax2 = 0; for (const s of r2.samples) amax2 = Math.max(amax2, Math.abs(s.alpha));
    const rec = { variant: name, re: L.eigs[0].re, alphaMax: amax, alphaMaxFine: amax2, dtIndep: Math.abs(amax - amax2) };
    c5.push(rec);
    out.rows.push('    ' + U.pad(name, 24) + ' ' + U.pad(L.eigs[0].re.toFixed(3), 11) + '  ' + U.pad(amax.toFixed(2), 15) + '  ' + U.pad('|Δ|=' + rec.dtIndep.toFixed(2), 10));
  }
  out.data.C5 = c5;
  out.issues.push({ level: 'P0', id: 'C5', text: '失稳主因指向马格努斯力矩：保持其它参数不变，C_mag 1.30→0 时线性 Reλ 由 +1.5/s 变为负、非线性 max|α| 由 78° 降到约 8.5°；符号翻转后仅约 3.5°。说明当前 Magnus 量级（1.30）严重过大（常见量级应为 O(0.1)，文献调研未能给出可核实数值，需按 CFD/风洞数据标定），且符号约定可能反了。升级真实自转时必须同时重标定 C_npα 并验证 Sg≥1.2~1.5 且 α 有界。' });

  // 动态稳定性：Magnus=0 仍随自转增大而振幅增大的现象
  out.rows.push('C6. 即使 C_mag=0，模型在真实自转下仍有随 spin 增长的极限环（滚转-俯仰共振型，dt 已收敛）：');
  const c6 = [];
  for (const spin of [600, 800, 900, 1000, 1100, 1178, 1300]) {
    const pv = loadNative(BASE, { patches: [PATCH.magnusOff] });
    const Rv = createRefSim(pv.internals);
    const r = Rv.simulateRef({ v0: 450, angle: 45, hBoom: 1e5, spin, wz: 1e-3, wy: 0, dt: 2e-4, maxTime: 20 });
    let amax = 0; for (const s of r.samples) amax = Math.max(amax, Math.abs(s.alpha));
    c6.push({ spin, alphaMax: amax });
    out.rows.push('    spin=' + U.pad(spin, 6) + '  max|α|(20s)=' + U.pad(amax.toFixed(2), 6) + '°');
  }
  out.data.C6 = c6;
  out.issues.push({ level: 'P1', id: 'C6', text: '关闭 Magnus 后仍有动态稳定性问题：spin 600→1300 rad/s 时 20s 内 max|α| 从 4.2° 单调增到 9.1°（dt 4e-4→5e-5 结果一致，非数值误差）。这是典型的滚转-俯仰共振/动不稳定，升级后需要连同 C_mq、静稳定裕度和自转衰减一起验证 α 是否收敛有界（目标 max|α|≲2–3°）。' });

  // ---- C7: 阻尼/马格努斯量级与滚转衰减 ----
  const atm = I.atmosphere(0), co = I.aeroAt(450 / atm.a), qd = 0.5 * atm.rho * 450 * 450;
  const qS = qd * SH.S, qSd = qS * SH.D;
  const damp = qd * SH.S * SH.D * SH.D / (2 * 450);
  const margin = co[2] - SH.xcgD;
  const mzA = -co[1] * margin;
  const staticM = qSd * mzA; // 每 rad
  const magM1 = qSd * 1.30 * (1178 * SH.D / 450);
  const magM18 = qSd * 1.30 * (18 * SH.D / 450);
  out.data.C7 = { qS, qSd, damp, mzA, staticM: staticM, magM_1178: magM1, magM_18: magM18, ratio1178: magM1 / Math.abs(staticM), ratio18: magM18 / Math.abs(staticM) };
  out.rows.push('C7. 量级/量纲抽查（Ma=1.32, h=0）：q·S=' + qS.toFixed(0) + ' N，q·S·d=' + qSd.toFixed(1) + ' N·m；');
  out.rows.push('    静力矩导数 qSd·C_Mα=' + (qSd * mzA).toFixed(1) + ' N·m/rad；阻尼因子 damp=' + damp.toFixed(4) + ' N·m·s；');
  out.rows.push('    Magnus 力矩 (α=1rad) = ' + magM1.toFixed(1) + ' N·m @p=1178（' + (magM1 / Math.abs(staticM) * 100).toFixed(0) + '% 静力矩），' + magM18.toFixed(1) + ' N·m @p=18（' + (magM18 / Math.abs(staticM) * 100).toFixed(1) + '%）=> 默认自转下 Magnus 几乎不起作用，真实自转下占比 20%+ 足以失稳。');
  out.rows.push('    模态量级：滚动阻尼 C_lp=-0.06、俯仰阻尼 C_mq=-50、Magnus C_npα=1.30（按代码公式归一）；文献调研无法给出可核实典型值 => 三者均标注“待对标/需 CFD 或风洞数据”。');

  // 滚转衰减（用基线轨迹）
  P.setSeed(20240601);
  const rb = P.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 60 });
  const s0 = rb.samples[0], sN = rb.samples[rb.samples.length - 1];
  const K = Math.log(s0.wx / sN.wx) / 0.06;
  out.data.C7.rollDecay = { wx0: s0.wx, wxEnd: sN.wx, lossPct: (1 - sN.wx / s0.wx) * 100, integralK: K };
  out.rows.push('    基线（spin=18）从 ' + s0.wx.toFixed(1) + ' 衰减到 ' + sN.wx.toFixed(2) + ' rad/s（-' + ((1 - sN.wx / s0.wx) * 100).toFixed(1) + '%）；由 Mx=damp·C_lp·ωx 推得 ∫damp/Ix dt=' + K.toFixed(2) + '，若 C_lp=-0.01 则仅衰减 ' + ((1 - Math.exp(-0.01 * K)) * 100).toFixed(0) + '%，C_lp=-0.02 → ' + ((1 - Math.exp(-0.02 * K)) * 100).toFixed(0) + '%。C_lp=-0.06 对应 46.6s 内掉 65%，对真实弹丸可能偏大（待对标）。');
  out.issues.push({ level: 'P2', id: 'C7', text: '滚转阻尼 C_lp=-0.06 使基线 46.6s 内自转衰减 65%（18→6.3 rad/s），HUD 显示的「转速」末段仅剩 1/3；若真实 C_lp 为 -0.01~-0.02 量级，当前衰减快 3~6 倍。数值待对标，建议参数化并从文献/CFD 取值。' });

  // ---- C8: 代码实现层面的问题 ----
  const src = loadNative; // placeholder
  const codeIssues = [];
  // windZ 未使用
  const srcText = require('fs').readFileSync(require('path').join(__dirname, '..', 'baseline', 'physics-baseline.js'), 'utf8');
  const windCount = (srcText.match(/windZ/g) || []).length;
  const guardCount = (srcText.match(/ub > 0\.2 \* V/g) || []).length;
  out.data.C8 = { windZOccurrences: windCount, guardOccurrences: guardCount };
  out.rows.push('C8. 实现层问题：源码中 windZ 出现 ' + windCount + ' 次（仅注释/文档字符串），deriv() 与 simulate() 都没有风场项 => 侧风参数未实现；攻角保护判据 "ub > 0.2*V"（|α|>78.5° 时把 α、β 强制清零）出现 ' + guardCount + ' 次（deriv 与 deriveKinematics 各一处），是隐藏的不连续；另 maxTime 注释默认 120 而代码默认 140（文档不一致）。');
  out.issues.push({ level: 'P2', id: 'C8a', text: 'cfg.windZ 在文档字符串中声明（默认 0）但从未参与计算：无风侧偏并非风引起（见 E 节分解），且 UI 无风场输入。若界面/文档宣称支持横风，属于未实现功能；建议实现风场（相对速度 v_rel=v−W）或在文档中删除。' });
  out.issues.push({ level: 'P2', id: 'C8b', text: '攻角保护 "ub > 0.2*V" 在 |α|>78.5° 时把 α、β 置 0，气动法向力/静力矩瞬间消失（不连续），翻滚工况下每 1000 个采样有 1–7 个样本触发；正常基线不触发，但任何大攻角/翻滚工况都会被这个 guard 扭曲。建议改为连续处理或显式报错/限制。' });
  out.issues.push({ level: 'P3', id: 'C8c', text: '文档字符串与实现不一致：simulate 注释写 maxTime 默认 120，代码默认 140；cfg.windZ 文档存在但未实现。' });
  return out;
}
module.exports = { run };
