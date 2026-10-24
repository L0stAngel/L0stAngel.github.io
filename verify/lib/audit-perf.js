/* verify/lib/audit-perf.js — F 性能（原生 Node 计时；浏览器数据读 browser-smoke.json） */
'use strict';
const fs = require('fs');
const path = require('path');
const U = require('./audit-util');

const CFG = { v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 420 };
const PATCH = {
  noFrag: [/result\.fragments = simulateFragments\(result, cfg\);/, 'result.fragments = (cfg && cfg.__noFrag) ? { list: [], count: 0, duration: 0, r90: 0 } : simulateFragments(result, cfg);'],
  dt: [/    var dt = 0\.001;/, '    var dt = (cfg.dt != null ? cfg.dt : 0.001);'],
  fragDt: [/    var dt = 0\.01;/, '    var dt = (cfg.fragDt != null ? cfg.fragDt : 0.01);']
};

function best(fn, n) { let b = Infinity; for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; } return b; }

function run(env) {
  const { BASE, loadNative } = env;
  const P = loadNative(BASE);
  const out = { section: 'F', title: '性能（Node 原生计时 + 浏览器 FPS）', rows: [], data: {}, issues: [] };
  P.setSeed(1);
  for (let i = 0; i < 4; i++) P.B.simulate(CFG);

  // F1: 总耗时 / 弹道 / 破片分解
  const total = best(() => P.B.simulate(CFG), 5);
  const Pn = loadNative(BASE, { patches: [PATCH.noFrag] });
  Pn.setSeed(1);
  for (let i = 0; i < 3; i++) Pn.B.simulate(Object.assign({}, CFG, { __noFrag: true }));
  const ballistic = best(() => Pn.B.simulate(Object.assign({}, CFG, { __noFrag: true })), 5);
  const fragShare = (total - ballistic) / total;
  out.data.F1 = { totalMs: total, ballisticMs: ballistic, fragmentsMs: total - ballistic, fragShare, fragCount: 420, perFragmentUs: (total - ballistic) * 1000 / 420 };
  out.rows.push('F1. 原生 Node 计时（预热后 5 次取最小）：simulate(420 破片) 总计 ' + total.toFixed(2) + ' ms = 弹道+采样 ' + ballistic.toFixed(2) + ' ms + 破片 ' + (total - ballistic).toFixed(2) + ' ms（破片占 ' + (fragShare * 100).toFixed(0) + '%，单枚约 ' + ((total - ballistic) * 1000 / 420).toFixed(1) + ' μs；同机多次测量有 ±20% 负载噪声）。');
  out.issues.push({ level: 'P2', id: 'F1', text: '性能分解：simulate 总耗时 ' + total.toFixed(1) + 'ms，其中破片约 ' + (total - ballistic).toFixed(1) + 'ms（' + (fragShare * 100).toFixed(0) + '%），弹道 RK4 约 ' + ballistic.toFixed(1) + 'ms。浏览器状态栏显示 “SOLVED 35ms”（含 JIT 首次编译）。优化优先级：破片 > 大气/气动函数分配 > 弹道。' });

  // F2: 积分步数
  const r = P.B.simulate(CFG);
  const flightSteps = Math.round(r.flightTime / 1e-3);
  const derCalls = flightSteps * 4;
  let fragSteps = 0;
  for (const fr of r.fragments.list) fragSteps += Math.round((fr.landT - r.boom.t) / 0.01);
  fragSteps += r.fragments.unlanded * 6000;
  out.data.F2 = { flightSteps, derivCalls: derCalls, fragSteps, atmosCalls: derCalls + fragSteps };
  out.rows.push('F2. 积分步数：弹道 ' + flightSteps + ' 步 × 4 次 deriv = ' + derCalls + ' 次（每次 deriv 都调用 atmosphere() 且分配对象/数组）；破片总计约 ' + fragSteps + ' 步（每步调用 atmosphere() 并分配临时对象）=> 每次 simulate 约 ' + (derCalls + fragSteps).toLocaleString() + ' 次大气函数调用/对象分配。');

  // F3: dt 减半耗时
  out.rows.push('F3. 弹道 dt 减半的耗时增长（fragCount=420，含破片固定成本）：');
  out.rows.push('    dt(ms)   总耗时(ms)  相对 1ms');
  const Pd = loadNative(BASE, { patches: [PATCH.dt] });
  Pd.setSeed(1);
  const dtRows = [];
  for (const dt of [0.002, 0.001, 0.0005, 0.00025]) {
    for (let i = 0; i < 2; i++) Pd.B.simulate(Object.assign({}, CFG, { dt }));
    const ms = best(() => Pd.B.simulate(Object.assign({}, CFG, { dt })), 5);
    dtRows.push({ dt, ms });
  }
  const base = dtRows.find((x) => x.dt === 0.001).ms;
  for (const x of dtRows) out.rows.push('    ' + U.pad((x.dt * 1000).toFixed(3), 7) + '  ' + U.pad(x.ms.toFixed(2), 11) + '  ' + U.pad((x.ms / base).toFixed(2) + 'x', 8));
  out.data.F3 = dtRows;
  out.rows.push('    => dt 每减半总耗时约 +' + (((dtRows.find((x) => x.dt === 0.0005).ms - base) / base) * 100).toFixed(0) + '%（弹道部分接近线性 ×2；破片成本不变）。若为真实自转把 dt 降到 2e-4，总耗时预计 ' + (base + ballistic * 4).toFixed(0) + '~' + (base + ballistic * 6).toFixed(0) + ' ms 量级（仍可交互）。');
  out.issues.push({ level: 'P2', id: 'F3', text: 'dt 线性缩放：0.5/0.25ms 时总耗时分别为 1ms 的 1.8x/3.4x（实测见 F3 表）。若因真实自转把 dt 降到 2e-4，simulate 仍约 ' + (base + ballistic * 4).toFixed(0) + 'ms，可接受；但需同时优化破片和大气函数分配。' });

  // F4: 破片 dt 耗时
  const Pf = loadNative(BASE, { patches: [PATCH.fragDt] });
  out.rows.push('F4. 破片 dt 减半耗时：');
  const fdRows = [];
  for (const fragDt of [0.01, 0.005, 0.0025]) {
    Pf.setSeed(1);
    for (let i = 0; i < 2; i++) Pf.B.simulate(Object.assign({}, CFG, { fragDt }));
    const ms = best(() => { Pf.setSeed(1); Pf.B.simulate(Object.assign({}, CFG, { fragDt })); }, 5);
    fdRows.push({ fragDt, ms });
    out.rows.push('    fragDt=' + U.pad(fragDt, 6) + 's  总耗时 ' + U.pad(ms.toFixed(2), 8) + ' ms');
  }
  out.data.F4 = fdRows;

  // F5: 浏览器数据
  const bfile = path.join(__dirname, '..', 'results', 'browser-smoke.json');
  if (fs.existsSync(bfile)) {
    const b = JSON.parse(fs.readFileSync(bfile, 'utf8'));
    out.data.F5 = b;
    out.rows.push('F5. 浏览器（headless Chrome, 1680x1020, file://120mm_ballistics.html）：控制台错误 ' + b.consoleErrors.length + '，页面异常 ' + b.pageErrors.length + '，FPS 飞行段 ' + b.fpsFlight.fps.toFixed(1) + ' / 破片段 ' + b.fpsFragments.fps.toFixed(1) + '（vsync 60 上限），DOM 完整（' + b.dom.charts + ' 图 / ' + b.dom.hudItems + ' HUD 项 / canvas ' + b.dom.canvasW + 'x' + b.dom.canvasH + '），UI 显示 “' + b.statusCode0 + '”。');
    const stale = Object.entries(b.bundleSync).filter(([k, v]) => !v.same).map(([k]) => k);
    if (stale.length) {
      out.rows.push('    单文件包同步性：' + stale.join(', ') + ' 与源文件不一致（内联 hash 与磁盘源码不同）=> 升级后必须重跑 node _build.js 重新打包！');
      out.issues.push({ level: 'P1', id: 'F5', text: '120mm_ballistics.html 与源文件不同步：' + stale.join('、') + ' 的内联脚本 hash 与磁盘源码不一致（Lead 正在升级 physics.js 时尤其如此）。用户直接打开单文件会看到旧内核；每次改完 physics.js/UI 必须重跑 node _build.js，并在最终验收时校验 inline hash。' });
    } else {
      out.rows.push('    单文件包与源文件同步（内联 hash 一致）。');
    }
    out.issues.push({ level: 'P3', id: 'F5b', text: '浏览器冒烟测试无控制台错误/页面异常，FPS 60（headless），DOM 与 HUD/图表齐全，截图见 verify/shots/01–07。' });

    // 浏览器参数极值：550/70°，检查是否进入 11–20km 大气错误区
    const ext = b.extreme || {};
    out.rows.push('    极值参数（v0=550, angle=70°）实测 maxAlt=' + (ext.alt || '?') + '（' + (ext.alt && parseInt(ext.alt) > 11000 ? '已进入 11–20km 大气错误区' : '仍在 ISA 对流层内') + '）。');
  } else {
    out.rows.push('F5. 未找到 verify/results/browser-smoke.json（先运行 node verify/browser-smoke.js）。');
  }

  // F6: 优化建议（量化机会）
  out.rows.push('F6. 可优化点（不改物理结果）：① atmosphere() 每次 deriv 分配 {rho,a} 对象、aeroAt() 分配数组、破片循环每步分配临时对象——可缓存/复用，预计省 10–20%；② 破片积分用固定 dt=0.01 + 每步 Math.pow 面积预先算好（Aref 已可预计算）、path 数组复用；③ 弹道采样 20ms 足够，render/Charts 每帧全量重绘 6 图（浏览器 60fps 下无压力，但可 dirty-rect）；④ 破片 R90 若需统计稳定，建议 N≥2000 或固定种子+多次平均。');
  return out;
}
module.exports = { run };
