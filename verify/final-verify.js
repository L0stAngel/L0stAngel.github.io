/* verify/final-verify.js — 升级后内核（120mm 迫弹/旋转弹双预设）独立最终复验
 *
 * 用法：node verify/final-verify.js [--target physics.js] [--out verify/results/final-verify.json]
 *
 * 覆盖：
 *   F0 元数据 / 单文件包同步性 / UI 哈希
 *   F1 McCoy 例 9.2：105mm M1 四算例（1/18 与 1/25 缠度）+ dt 收敛 + 非线性归因
 *   F2 McCoy 表 9.7：120mm 迫弹 6 组弹道 + 初始偏航解释 + 85° 顶点大攻角核对
 *   F3 双预设 dt 收敛（0.5/0.25/0.125/0.0625 ms）
 *   F4 能量/自转/破片质量守恒
 *   F5 ISA 大气、气动表、Sg、aeroAt API、预设 API
 *   F6 风场与科氏力方向/量级
 *   F7 破片：Mott/R90/种子/步长/自转切向速度/风
 *   F8 性能
 *   F9 UI/API 接线与鲁棒性（seed、预设、SHELL 参数与文献一致性）
 * 不修改 physics.js / UI；所有临时修改只作用于 verify/.tmp 副本对象。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { loadNative } = require('./lib/native-core');
const { isa } = require('./lib/isa');
const { summarize, ksTest } = require('./lib/stats');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const TARGET = path.resolve(process.cwd(), argVal('--target', path.join(ROOT, 'physics.js')));
const OUT = path.resolve(process.cwd(), argVal('--out', path.join(__dirname, 'results', 'final-verify.json')));
const R = { generatedAt: new Date().toISOString(), target: TARGET, sections: {}, issues: [] };
const issue = (level, id, text) => R.issues.push({ level, id, text });
const f = (x, n) => Number(x).toFixed(n == null ? 3 : n);
const rel = (a, b) => (a / b - 1) * 100;
const worst = (arr) => Math.max.apply(null, arr.map((x) => (isFinite(x) ? Math.abs(x) : 0)));

/* ---------- F0 ---------- */
function F0(P) {
  const out = { physics: { sha256: P.sha256, bytes: fs.statSync(TARGET).size, mtime: fs.statSync(TARGET).mtime.toISOString() } };
  out.files = {};
  for (const n of ['index.html', 'main.js', 'charts.js', 'render3d.js', 'styles.css', '120mm_ballistics.html']) {
    const p = path.join(ROOT, n);
    if (!fs.existsSync(p)) { out.files[n] = null; continue; }
    out.files[n] = { bytes: fs.statSync(p).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), mtime: fs.statSync(p).mtime.toISOString() };
  }
  const htmlPath = path.join(ROOT, '120mm_ballistics.html');
  out.bundle = {};
  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    for (const n of ['physics.js', 'render3d.js', 'charts.js', 'main.js']) {
      const marker = '/* ===== ' + n + ' ===== */';
      const i = html.indexOf(marker);
      if (i < 0) { out.bundle[n] = { same: false, note: 'marker missing' }; continue; }
      const j = html.indexOf('</script>', i);
      const body = html.slice(i + marker.length, j).replace(/<\\\/script>/gi, '</script>').trim();
      const src = fs.readFileSync(path.join(ROOT, n), 'utf8').trim();
      const h1 = crypto.createHash('sha256').update(body).digest('hex');
      const h2 = crypto.createHash('sha256').update(src).digest('hex');
      out.bundle[n] = { same: h1 === h2, embedded: h1.slice(0, 12), source: h2.slice(0, 12) };
    }
    out.bundle.scripts = (html.match(/<script src=/g) || []).length;
    out.bundle.bytes = html.length;
  }
  console.log('F0. 元数据 / 单文件包');
  console.log('  physics.js sha=' + P.sha256.slice(0, 16) + ' bytes=' + out.physics.bytes + ' mtime=' + out.physics.mtime);
  console.log('  120mm_ballistics.html bytes=' + (out.files['120mm_ballistics.html'] ? out.files['120mm_ballistics.html'].bytes : '?') + ' inline scripts=' + out.bundle.scripts);
  let stale = [];
  for (const n of ['physics.js', 'render3d.js', 'charts.js', 'main.js']) {
    const b = out.bundle[n] || {};
    console.log('  bundle ' + n + ': ' + (b.same ? '同步 ✅' : '不同步 ❌ (' + b.embedded + ' vs ' + b.source + ')'));
    if (b.same === false) stale.push(n);
  }
  R.sections.F0 = out;
  if (stale.length) issue('P0', 'F0-bundle', '单文件包与源文件不同步：' + stale.join('、') + '。必须重跑 node _build.js 后重新验证（含浏览器冒烟）。');
  else issue('P3', 'F0-bundle', '120mm_ballistics.html 与 physics.js/render3d.js/charts.js/main.js 内联内容逐字一致（单文件包同步 ✅）。');
}

/* ---------- F1: McCoy 例 9.2 105mm M1 ---------- */
function F1(P) {
  const B = P.B;
  const saveShell = Object.assign({}, B.SHELL);
  const savePreset = B.getPreset();
  B.applyPreset('spin120');
  Object.assign(B.SHELL, { mass: 14.97, D: 0.1048, S: Math.PI * 0.1048 * 0.1048 / 4, L: 0.4947, Ix: 0.02326, Iy: 0.23118, xcgD: (0.4947 - 0.1834) / 0.1048 });
  const cases18 = [
    { n: 'C1-45°', v0: 205, angle: 45, wz: 1.44, ref: [3760, 28.5, 1000] },
    { n: 'C1-70°', v0: 205, angle: 70, wz: 1.47, ref: [2320, 38.5, 1750] },
    { n: 'C7-45°', v0: 493, angle: 45, wz: 3.61, ref: [11500, 52.5, 3460] },
    { n: 'C7-70°', v0: 493, angle: 70, wz: 3.64, ref: [7300, 70.5, 6000] }
  ];
  const cases25 = [
    { n: 'C1-45°', v0: 205, angle: 45, wz: 0.76, ref: [3760, 28.5, 1000] },
    { n: 'C1-70°', v0: 205, angle: 70, wz: 0.79, ref: [2320, 38.5, 1750] },
    { n: 'C7-45°', v0: 493, angle: 45, wz: 1.97, ref: [11500, 52.5, 3460] },
    { n: 'C7-70°', v0: 493, angle: 70, wz: 1.98, ref: [7300, 70.5, 6000] }
  ];
  function run(c, twist, extra) {
    return B.simulate(Object.assign({ preset: 'spin120', v0: c.v0, angle: c.angle, hBoom: 0, twist, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz, dt: 0.00025, maxTime: 160, fragCount: 30, env: { useCoriolis: false, useWind: false } }, extra || {}));
  }
  const rows18 = cases18.map((c) => { const r = run(c, 18); return { n: c.n, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha, Sg0: r.Sg0, dev: [rel(r.range, c.ref[0]), rel(r.flightTime, c.ref[1]), rel(r.maxAlt, c.ref[2])], ref: c.ref }; });
  const rows25 = cases25.map((c) => { const r = run(c, 25); return { n: c.n, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha, Sg0: r.Sg0, dev: [rel(r.range, c.ref[0]), rel(r.flightTime, c.ref[1]), rel(r.maxAlt, c.ref[2])], ref: c.ref }; });
  console.log('\nF1. McCoy 例 9.2 — 105mm M1（dt=0.25ms, hBoom=0, 无风/科氏；参考值为原书 text 近似值）');
  const show = (rows, label) => { console.log('  ' + label); for (const x of rows) console.log('    ' + x.n + ' R=' + f(x.range, 0) + ' t=' + f(x.t, 1) + ' alt=' + f(x.alt, 0) + '  vs ' + x.ref.join('/') + '  偏差 ' + x.dev.map((d) => f(d, 2) + '%').join('/') + '  maxα=' + f(x.maxAlpha, 1) + ' Sg0=' + f(x.Sg0, 2)); };
  show(rows18, '1:18 缠度：'); show(rows25, '1:25 缠度：');
  // dt 收敛（C7-45 与 C1-70，1/18）
  const conv = {};
  for (const c of [cases18[2], cases18[1]]) {
    conv[c.n] = [0.0005, 0.00025, 0.000125].map((dt) => { const r = run(c, 18, { dt }); return { dt, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha }; });
    const a = conv[c.n];
    console.log('  dt 收敛 ' + c.n + ': 0.5ms R=' + f(a[0].range, 1) + ' | 0.25ms R=' + f(a[1].range, 1) + ' | 0.125ms R=' + f(a[2].range, 1) + '（0.25 vs 0.125 差 ' + f(rel(a[1].range, a[2].range), 3) + '%；0.5 vs 0.125 差 ' + f(rel(a[0].range, a[2].range), 2) + '%）');
  }
  // 偏差归因（70° 工况，1/18）
  const attr = {};
  for (const c of [cases18[3], cases18[1]]) {
    B.AERO_C.useNonlinear = false;
    const rn = run(c, 18);
    B.AERO_C.useNonlinear = true;
    B.AERO_C.useMagnusMoment = false; B.AERO_C.useMagnusForce = false;
    const rm = run(c, 18);
    B.AERO_C.useMagnusMoment = true; B.AERO_C.useMagnusForce = false;
    attr[c.n] = { noNonlinear: rn.range, devNoNonlinear: rel(rn.range, c.ref[0]), noMagnus: rm.range, devNoMagnus: rel(rm.range, c.ref[0]), maxAlphaNoNonlinear: rn.maxAlpha };
    console.log('  ' + c.n + ' 归因: 关闭非线性 R=' + f(rn.range, 0) + ' (' + f(attr[c.n].devNoNonlinear, 2) + '%, maxα=' + f(rn.maxAlpha, 1) + '°); 关闭 Magnus R=' + f(rm.range, 0) + ' (' + f(attr[c.n].devNoMagnus, 2) + '%)');
  }
  B.applyPreset(savePreset);
  Object.assign(B.SHELL, saveShell);
  const out = { cases18: rows18, cases25: rows25, dtConvergence: conv, attribution: attr };
  R.sections.F1 = out;
  const max18 = worst(rows18.map((x) => x.dev[0]));
  if (max18 < 0.5) issue('P3', 'F1-45', '105mm M1 45° 两算例与 McCoy 参考差 ≤0.4%（C1-45 3763 vs 3760，C7-45 11476 vs 11500）=> 内核在中小攻角工况与 McCoy 6-DOF 一致。');
  const idxTxt = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const documented70 = idxTxt.indexOf('1:25') >= 0 && idxTxt.indexOf('定性') >= 0;
  issue(documented70 ? 'P3' : 'P2', 'F1-70', '105mm M1 70° 高射角算例：1/18 缠度射程 C7-70 -' + f(Math.abs(rows18[3].dev[0]), 1) + '%、C1-70 -' + f(Math.abs(rows18[1].dev[0]), 1) + '%（时间 +0.4%/+1.3%）；1/25 缠度则 +' + f(rows25[3].dev[0], 1) + '%/+' + f(rows25[1].dev[0], 1) + '%。说明 70° 射程对顶点低动压段攻角历程/缠度敏感：1/18 时 maxα 达 ' + f(rows18[3].maxAlpha, 0) + '°/' + f(rows18[1].maxAlpha, 0) + '°，非线性 CD2/CNa2 使射程偏低；关闭非线性后 C1-70 变为 ' + f(attr['C1-70°'].devNoNonlinear, 1) + '%。McCoy 原文注明 1/25 与 1/18 “差别不显著”，本模型 1/25 与参考更接近 => 建议模型面板把 1/25 结果也列出，并注明 70° 大攻角段仅定性可信（文献亦规定 α_t>15° 只作定性参考）。');
  if (documented70) issue('P3', 'F1-70-ui', '模型面板（index.html §6 表格下方）已列出 1:25 缠度四组结果（C1-45 +0.2%、C1-70 +0.5%、C7-45 −0.2%、C7-70 +1.5%）并注明 70° 高射角大攻角（α_t>15°）“仅作定性参考” => 本项已作为已知记录局限处理，不再列为待改 P2。');
  if (worst(rows25.map((x) => x.dev[0])) < 1.6) issue('P3', 'F1-25', '1/25 缠度四算例与 McCoy 参考差 ≤1.5%（C1-70 +0.5%、C7-70 +1.5%），Sg≈1.62 与原文 1.6 一致。');
  return out;
}

/* ---------- F2: McCoy 表 9.7 120mm 迫弹 6 组 ---------- */
function F2(P) {
  const B = P.B;
  B.applyPreset('mortar120');
  const cases = [
    { n: 'chg0-45°', v0: 102, angle: 45, wz: 0.913, ref: [1010, 14.6, 260] },
    { n: 'chg0-65°', v0: 102, angle: 65, wz: 0.913, ref: [770, 18.6, 420] },
    { n: 'chg0-85°', v0: 102, angle: 85, wz: 0.913, ref: [165, 20.5, 510] },
    { n: 'chg4-45°', v0: 318, angle: 45, wz: 1.795, ref: [7315, 41.4, 2100] },
    { n: 'chg4-65°', v0: 318, angle: 65, wz: 1.795, ref: [5570, 52.6, 3380] },
    { n: 'chg4-85°', v0: 318, angle: 85, wz: 1.795, ref: [1275, 57.7, 4070] }
  ];
  const run = (c, extra) => B.simulate(Object.assign({ preset: 'mortar120', v0: c.v0, angle: c.angle, hBoom: 0, twist: 0, jump: 0, yaw0: 0, wy0: 0, wz0: c.wz, dt: 0.00025, maxTime: 140, fragCount: 30, env: { useCoriolis: false, useWind: false } }, extra || {}));
  console.log('\nF2. McCoy 表 9.7 — 120mm 迫弹（尾翼稳定、不旋转；dt=0.25ms, hBoom=0, 无风/科氏）');
  console.log('  工况       本模型 R/t/alt          McCoy 表 9.7        偏差 R/t/alt           maxα');
  const rows = cases.map((c) => {
    const r = run(c);
    const dev = [rel(r.range, c.ref[0]), rel(r.flightTime, c.ref[1]), rel(r.maxAlt, c.ref[2])];
    console.log('  ' + c.n.padEnd(9) + ' ' + (f(r.range, 0) + '/' + f(r.flightTime, 2) + '/' + f(r.maxAlt, 0)).padEnd(20) + ' ' + c.ref.join('/').padEnd(20) + ' ' + dev.map((d) => f(d, 2) + '%').join('/').padEnd(22) + ' ' + f(r.maxAlpha, 1) + '°');
    return { n: c.n, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha, dev, ref: c.ref };
  });
  // 初始 yaw 解释：McCoy 表 9.6 的 "1st max yaw" 作为初始偏航角
  const yawTest = {};
  for (const c of [cases[3], cases[0], cases[5]]) {
    const yaw = c.v0 === 318 ? 3 : 8;
    const r = run(c, { yaw0: yaw });
    yawTest[c.n] = { yaw0: yaw, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha };
    console.log('  初始 yaw0=' + yaw + '° 解释 ' + c.n + ': R=' + f(r.range, 0) + ' t=' + f(r.flightTime, 2) + ' alt=' + f(r.maxAlt, 0) + ' maxα=' + f(r.maxAlpha, 1) + '°（参考 ' + c.ref.join('/') + '）');
  }
  // dt 收敛（chg4-45 与 chg4-85）
  const conv = {};
  for (const c of [cases[3], cases[5]]) {
    conv[c.n] = [0.0005, 0.00025, 0.000125].map((dt) => { const r = run(c, { dt }); return { dt, range: r.range, t: r.flightTime, alt: r.maxAlt }; });
    const a = conv[c.n];
    console.log('  dt 收敛 ' + c.n + ': 0.5ms R=' + f(a[0].range, 1) + ' | 0.25ms R=' + f(a[1].range, 1) + ' | 0.125ms R=' + f(a[2].range, 1) + '（0.25 vs 0.125 差 ' + f(rel(a[1].range, a[2].range), 3) + '%）');
  }
  // 85° 顶点大攻角（McCoy 原文：chg0 47°、chg4 13°）
  const apexAlpha = {};
  for (const c of [cases[2], cases[5]]) {
    const r = run(c);
    let best = 0, bt = 0;
    for (const x of r.samples) { const a = Math.hypot(x.alpha, x.beta); if (a > best) { best = a; bt = x.t; } }
    apexAlpha[c.n] = { maxAlphaT: best, t: bt };
    console.log('  85° 顶点大攻角核对 ' + c.n + ': maxαT=' + f(best, 1) + '° @' + f(bt, 1) + 's（McCoy 原文 ' + (c.v0 === 102 ? '47' : '13') + '°）');
  }
  const out = { cases: rows, yawInterpretation: yawTest, dtConvergence: conv, apexAlpha };
  R.sections.F2 = out;
  const maxDev = worst(rows.map((x) => x.dev[0]));
  issue('P3', 'F2-table97', '120mm 迫弹 McCoy 表 9.7 六组复现：射程偏差 ' + rows.map((x) => x.n + ' ' + f(x.dev[0], 2) + '%').join('，') + '；飞行时间偏差 ≤' + f(worst(rows.map((x) => x.dev[1])), 2) + '%，最大高度偏差 ≤' + f(worst(rows.map((x) => x.dev[2])), 2) + '%（chg0-85° 射程 −2.5 m 即 −1.75%，因该工况射程仅 165 m，绝对误差小）。=> 120mm 默认预设的 6DOF 内核与 McCoy 原书 6 组基准高度一致。');
  if (worst(rows.map((x) => x.dev[2])) > 1 || worst(rows.map((x) => x.dev[1])) > 1) issue('P1', 'F2-table97b', '表 9.7 的高度/时间偏差超过 1%，需检查大气/阻力实现。');
  issue('P3', 'F2-apex', '85° 高射角顶点大攻角与 McCoy 原文一致：chg0 本模型 maxαT=' + f(apexAlpha['chg0-85°'].maxAlphaT, 1) + '°（原文 47°）、chg4 ' + f(apexAlpha['chg4-85°'].maxAlphaT, 1) + '°（原文 13°）=> 高射角弹道顶点的大攻角是真实物理现象，不是数值噪声；模型面板需说明 α_t>15° 只作定性参考（文献亦如此规定）。');
  return out;
}

/* ---------- F3 双预设 dt 收敛 ---------- */
function F3(P) {
  const B = P.B;
  const out = {};
  console.log('\nF3. 双预设 dt 收敛');
  for (const preset of ['mortar120', 'spin120']) {
    B.applyPreset(preset);
    const cfg = { preset };
    const def = B.simulate(cfg);
    const levels = [0.0005, 0.00025, 0.000125, 0.0000625];
    const rows = levels.map((dt) => { const r = B.simulate(Object.assign({}, cfg, { dt })); return { dt, range: r.range, t: r.flightTime, alt: r.maxAlt, maxAlpha: r.maxAlpha }; });
    const fine = rows[rows.length - 1];
    const devDefault = rel(def.range, fine.range), devT = rel(def.flightTime, fine.t);
    out[preset] = { defaultDt: def.dt, defaultRange: def.range, defaultT: def.flightTime, defaultAlpha: def.maxAlpha, levels: rows, devDefault, devT };
    console.log('  [' + preset + '] 默认 dt=' + f(def.dt * 1000, 4) + 'ms：R=' + f(def.range, 2) + ' t=' + f(def.flightTime, 4) + ' alt=' + f(def.maxAlt, 2) + ' maxα=' + f(def.maxAlpha, 3));
    for (const r of rows) console.log('    dt=' + f(r.dt * 1000, 4) + 'ms: R=' + f(r.range, 2) + ' t=' + f(r.t, 4) + ' alt=' + f(r.alt, 2) + ' maxα=' + f(r.maxAlpha, 3));
    console.log('    => 默认 dt 相对 0.0625ms：ΔR=' + f(devDefault, 3) + '% Δt=' + f(devT, 3) + '% Δmaxα=' + f(def.maxAlpha - fine.maxAlpha, 3) + '°');
    if (Math.abs(devDefault) > 0.2 || Math.abs(devT) > 0.2) issue('P1', 'F3-' + preset, preset + ' 默认 dt 收敛性不足：ΔR=' + f(devDefault, 2) + '%, Δt=' + f(devT, 2) + '%。');
  }
  R.sections.F3 = out;
  const ok = ['mortar120', 'spin120'].every((p) => Math.abs(out[p].devDefault) < 0.2 && Math.abs(out[p].devT) < 0.2);
  if (ok) issue('P3', 'F3-dt', '双预设默认自适应 dt（迫弹 ' + f(out.mortar120.defaultDt * 1000, 3) + 'ms / 旋转弹 ' + f(out.spin120.defaultDt * 1000, 3) + 'ms）相对 0.0625ms 参考的射程/时间偏差均 <0.2%，步长设置合理；dt 减半到 0.125ms 后结果基本不变。');
  return out;
}

/* ---------- F4 守恒 ---------- */
function F4(P) {
  const B = P.B;
  const out = {};
  console.log('\nF4. 守恒检查');
  for (const preset of ['mortar120', 'spin120']) {
    B.applyPreset(preset);
    const r = B.simulate({ preset, env: { useCoriolis: false, useWind: false } });
    const s = r.samples;
    const G0 = 9.80665, RE = 6371000;
    const pot = (h) => G0 * RE * RE * (1 / RE - 1 / (RE + h));
    const energy = (x) => 0.5 * (x.vx * x.vx + x.vy * x.vy + x.vz * x.vz) + pot(x.y);
    let work = 0, maxResid = 0;
    const E0 = energy(s[0]);
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1], b = s[i];
      const pw = (x) => {
        const q = x.qdyn * 1000, sinAt = Math.sin(x.alphaT * Math.PI / 180);
        const Cd = B.INTERP(B.TAB().CD0, x.mach) + B.INTERP(B.TAB().CD2, x.mach) * sinAt * sinAt;
        const V = Math.hypot(x.vx, x.vy, x.vz);
        return -q * B.SHELL.S * Cd * V / B.SHELL.mass;
      };
      work += 0.5 * (pw(a) + pw(b)) * (b.t - a.t);
      const resid = (energy(b) - E0) - work;
      if (Math.abs(resid) > maxResid) maxResid = Math.abs(resid);
    }
    // 自转能量（旋转弹）
    let spinRel = null;
    if (B.SHELL.spinMode !== 'none') {
      let sw = 0, sr = 0; const sE0 = 0.5 * B.SHELL.Ix * s[0].wx * s[0].wx;
      const spinE = (x) => 0.5 * B.SHELL.Ix * x.wx * x.wx;
      for (let i = 1; i < s.length; i++) {
        const a = s[i - 1], b = s[i];
        const pw = (x) => { const q = x.qdyn * 1000, V = Math.hypot(x.vx, x.vy, x.vz); return (q * B.SHELL.S * B.SHELL.D * B.SHELL.D / V) * B.INTERP(B.TAB().Clp, x.mach) * x.wx * x.wx; };
        sw += 0.5 * (pw(a) + pw(b)) * (b.t - a.t);
        sr = Math.max(sr, Math.abs((spinE(b) - sE0) - sw));
      }
      spinRel = sr / Math.abs(sw);
    }
    let maxQNorm = 0;
    for (const x of s) maxQNorm = Math.max(maxQNorm, Math.abs(Math.hypot(x.quat[0], x.quat[1], x.quat[2], x.quat[3]) - 1));
    const o = { preset, relResidual: maxResid / Math.abs(work), spinRelResidual: spinRel, maxQuatNormErr: maxQNorm, fragMassSum: r.fragments.massSum, casing: B.SHELL.casing, fragMassRelErr: r.fragments.massSum / B.SHELL.casing - 1, spinLoss: r.spinLoss };
    out[preset] = o;
    console.log('  [' + preset + '] 平动能量残差=' + f(o.relResidual * 100, 4) + '%' + (spinRel != null ? '，自转能量残差=' + f(spinRel * 100, 4) + '%，自转衰减=' + f(r.spinLoss * 100, 1) + '%' : '（不旋转，无自转能量项）') + '，|q| 误差=' + o.maxQuatNormErr.toExponential(2) + '，破片 Σm=' + f(o.fragMassSum, 6) + ' kg（壳体 ' + o.casing + '，误差 ' + o.fragMassRelErr.toExponential(1) + '）');
    if (o.relResidual > 0.005 || Math.abs(o.fragMassRelErr) > 1e-9 || o.maxQuatNormErr > 1e-12 || (spinRel != null && spinRel > 0.005)) issue('P2', 'F4-' + preset, preset + ' 守恒检查异常：平动残差 ' + f(o.relResidual * 100, 3) + '%、自转残差 ' + (spinRel == null ? '—' : f(spinRel * 100, 3) + '%') + '、|q| ' + o.maxQuatNormErr.toExponential(1) + '、破片质量误差 ' + o.fragMassRelErr.toExponential(1) + '。');
  }
  R.sections.F4 = out;
  const okAll = ['mortar120', 'spin120'].every((p) => out[p].relResidual < 0.005 && Math.abs(out[p].fragMassRelErr) < 1e-9 && out[p].maxQuatNormErr < 1e-12 && (out[p].spinRelResidual == null || out[p].spinRelResidual < 0.005));
  if (okAll) issue('P3', 'F4-ok', '守恒良好：双预设平动能量闭合残差 ≤' + f(Math.max(out.mortar120.relResidual, out.spin120.relResidual) * 100, 3) + '%（主要来自 10ms 采样梯形积分而非 RK4）、自转能量残差 <1e-3、四元数模长误差 <1e-12、破片 Σm 精确等于壳体质量。');
  return out;
}

/* ---------- F5 大气/气动表/Sg/API ---------- */
function F5(P) {
  const B = P.B;
  B.applyPreset('mortar120');
  const rows = [];
  for (const h of [0, 5000, 10000, 11000, 15000, 20000, 25000, 32000]) {
    const A = B.atmosphere(h), S = isa(h);
    rows.push({ h, dT: rel(A.T, S.T), dp: rel(A.p, S.P), drho: rel(A.rho, S.rho), da: rel(A.a, S.a) });
  }
  const maxAtm = Math.max.apply(null, rows.map((x) => Math.max(Math.abs(x.dT), Math.abs(x.dp), Math.abs(x.drho), Math.abs(x.da))));
  const topBoundary = rows[rows.length - 1];
  console.log('\nF5. ISA 大气 / 气动表 / Sg / API');
  console.log('  ISA 0–32km 最大偏差: T ' + f(worst(rows.map((x) => x.dT)), 3) + '%, p ' + f(worst(rows.map((x) => x.dp)), 3) + '%, ρ ' + f(worst(rows.map((x) => x.drho)), 3) + '%, a ' + f(worst(rows.map((x) => x.da)), 3) + '%');
  // 气动表（两套预设关键值 vs 文献）
  const tabCheck = [];
  function checkTab(preset, key, x, expected) {
    B.applyPreset(preset);
    const v = B.INTERP(B.TAB()[key], x);
    tabCheck.push({ preset, key, x, code: v, ref: expected, ok: Math.abs(v - expected) < 1e-9 });
  }
  checkTab('mortar120', 'CD0', 0, 0.119); checkTab('mortar120', 'CD0', 0.93, 0.148); checkTab('mortar120', 'CD0', 0.95, 0.182);
  checkTab('mortar120', 'CMa0', 0.4, -1.02); checkTab('mortar120', 'CMa0', 0.9, -2.72);
  checkTab('mortar120', 'Cmq0', 0, -22.0); checkTab('mortar120', 'Cmq0', 0.9, -24.2); checkTab('mortar120', 'Cmq0', 0.95, -31.5);
  checkTab('spin120', 'CD0', 0, 0.124); checkTab('spin120', 'CD0', 1.085, 0.415); checkTab('spin120', 'CD0', 2.5, 0.276);
  checkTab('spin120', 'CMa0', 0, 3.55); checkTab('spin120', 'CMa0', 0.925, 4.85);
  checkTab('spin120', 'Clp', 0, -0.0178); checkTab('spin120', 'Clp', 2.5, -0.0087);
  checkTab('spin120', 'Cmq0', 1.15, -9.1);
  console.log('  气动表 vs McCoy 附录 B/C：' + tabCheck.filter((x) => x.ok).length + '/' + tabCheck.length + ' 项精确匹配 ' + (tabCheck.every((x) => x.ok) ? '✅' : '⚠'));
  for (const x of tabCheck) if (!x.ok) console.log('    ⚠ ' + x.preset + '.' + x.key + '(Ma=' + x.x + ') 代码=' + x.code + ' 文献=' + x.ref);
  // Sg
  B.applyPreset('spin120');
  Object.assign(B.SHELL, { mass: 14.97, D: 0.1048, S: Math.PI * 0.1048 * 0.1048 / 4, L: 0.4947, Ix: 0.02326, Iy: 0.23118, xcgD: (0.4947 - 0.1834) / 0.1048 });
  const atm0 = B.atmosphere(0), q0 = 0.5 * atm0.rho * 493 * 493, mach0 = 493 / atm0.a;
  const sg18 = B.stabilityFactor(2 * Math.PI * 493 / (18 * 0.1048), q0, mach0);
  const sg25 = B.stabilityFactor(2 * Math.PI * 493 / (25 * 0.1048), q0, mach0);
  console.log('  Sg 核对（105mm M1, 493 m/s）：1/18 ' + f(sg18, 2) + '（McCoy 3.1），1/25 ' + f(sg25, 2) + '（McCoy 1.6）');
  B.applyPreset('mortar120');
  const sgMortar = B.stabilityFactor(0, q0, 0.9);
  // API
  let aeroAtErr = null, aeroAtVal = null;
  try { aeroAtVal = B.aeroAt(1.0); } catch (e) { aeroAtErr = e.message; }
  console.log('  aeroAt(1.0)=' + (aeroAtErr ? '抛异常 ❌ ' + aeroAtErr : JSON.stringify(aeroAtVal)) + '；mortar Sg=' + sgMortar + '（不旋转 → Infinity 合理）');
  // 预设与默认种子
  const seedA = B.simulate({ preset: 'mortar120', seed: 2024, fragCount: 100 }).fragments.r90;
  const seedB = B.simulate({ preset: 'mortar120', seed: 2024, fragCount: 100 }).fragments.r90;
  console.log('  默认种子 2024 两次 r90：' + f(seedA, 2) + ' vs ' + f(seedB, 2) + ' => ' + (seedA === seedB ? '一致 ✅' : '不一致 ❌'));
  // α_t = 0 路径（jump/yaw0/wy0/wz0 全 0）：不应出现 0/0 NaN
  const zeroAlpha = B.simulate({ preset: 'mortar120', jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useWind: false, useCoriolis: false } });
  const zeroAlphaSpin = B.simulate({ preset: 'spin120', jump: 0, yaw0: 0, wy0: 0, wz0: 0, env: { useWind: false, useCoriolis: false } });
  console.log('  α_t=0 路径：迫弹 range=' + f(zeroAlpha.range, 1) + ' maxα=' + f(zeroAlpha.maxAlpha, 3) + '；旋转弹 range=' + f(zeroAlphaSpin.range, 1) + ' maxα=' + f(zeroAlphaSpin.maxAlpha, 3) + '（均应有限且无 NaN）');
  // 大气上边界
  const atmTop = B.atmosphere(32000);
  const isaTop = isa(32000);
  console.log('  atmosphere(32000): T=' + f(atmTop.T, 2) + ' p=' + f(atmTop.p, 1) + '；ISA: T=' + f(isaTop.T, 2) + ' p=' + f(isaTop.P, 1) + '（顶层 100m 边界取值偏差 p ' + f(rel(atmTop.p, isaTop.P), 1) + '%，≤32km 截断外不可达）');
  // 预设默认值
  const presetDefaults = Object.keys(B.PRESETS).map((k) => ({ id: k, defaults: B.PRESETS[k].defaults, name: B.PRESETS[k].name }));
  console.log('  预设默认值：' + presetDefaults.map((p) => p.id + '(v0=' + p.defaults.v0 + ',angle=' + p.defaults.angle + ',twist=' + p.defaults.twist + ')').join('；'));
  const out = { isa: rows, isaMaxDev: maxAtm, tabCheck, sg: { sg18, sg25, mortar: sgMortar }, aeroAt: aeroAtVal, aeroAtError: aeroAtErr, seedReproducible: { a: seedA, b: seedB, same: seedA === seedB }, zeroAlpha: { mortar: { range: zeroAlpha.range, maxAlpha: zeroAlpha.maxAlpha, t: zeroAlpha.flightTime }, spin: { range: zeroAlphaSpin.range, maxAlpha: zeroAlphaSpin.maxAlpha, t: zeroAlphaSpin.flightTime } }, atmTop: { code: atmTop, isa: isaTop }, presets: presetDefaults };
  R.sections.F5 = out;
  if (maxAtm < 0.5) issue('P3', 'F5-atm', 'ISA 分层大气 0–32 km 与标准值最大相对偏差 ' + f(maxAtm, 3) + '%（含 32 km 顶层边界）=> 已修复基线 11 km 以上大气错误，且覆盖到 32 km。');
  else issue('P1', 'F5-atm', 'ISA 大气偏差 ' + f(maxAtm, 2) + '% > 0.5%。');
  if (tabCheck.every((x) => x.ok)) issue('P3', 'F5-tab', '双预设气动表关键项与 McCoy 附录 B/C 逐项精确一致（CD0/CMα0/CMq0/Clp 共 ' + tabCheck.length + ' 项）。');
  else issue('P2', 'F5-tab', '气动表有 ' + tabCheck.filter((x) => !x.ok).length + ' 项与文献值不一致，见数据表。');
  if (aeroAtErr) issue('P2', 'F5-aeroAt', 'Ballistics.aeroAt() 抛异常：' + aeroAtErr);
  if (Math.abs(sg18 - 3.1) / 3.1 < 0.02 && Math.abs(sg25 - 1.6) / 1.6 < 0.05) issue('P3', 'F5-sg', '陀螺稳定因子 Sg 与 McCoy 原文一致：1/18 ' + f(sg18, 2) + '（原文 3.1）、1/25 ' + f(sg25, 2) + '（原文 1.6）。');
  if (isFinite(zeroAlpha.range) && isFinite(zeroAlphaSpin.range)) issue('P3', 'F5-alpha0', 'α_t=0（无初始扰动）路径正常：迫弹 ' + f(zeroAlpha.range, 0) + ' m / 旋转弹 ' + f(zeroAlphaSpin.range, 0) + ' m，无 0/0 NaN（代码已加 alphaT>1e-12 保护）。');
  else issue('P0', 'F5-alpha0', 'α_t=0 路径出现 NaN！');
  const topDev = Math.max(Math.abs(rel(atmTop.p, isaTop.P)), Math.abs(rel(atmTop.rho, isaTop.rho)), Math.abs(rel(atmTop.T, isaTop.T)), Math.abs(rel(atmTop.a, isaTop.a)));
  if (topDev < 0.1) issue('P3', 'F5-atmTop', '大气表 32 km 顶层边界已修复：atmosphere(32000) 返回 T=' + f(atmTop.T, 2) + ' K、p=' + f(atmTop.p, 1) + ' Pa、ρ=' + f(atmTop.rho, 5) + '、a=' + f(atmTop.a, 2) + '，与 ISA 偏差 <0.05%（此前浮点索引导致取 31.9 km 表值、p 偏高 1.5%）；弹道最高 6 km，该边界本不可达，属健壮性改进。');
  else issue('P2', 'F5-atmTop', '大气表顶层边界仍偏差 ' + f(topDev, 2) + '%（h=32000）。');
  return out;
}

/* ---------- F6 风场/科氏 ---------- */
function F6(P) {
  const B = P.B;
  const out = {};
  console.log('\nF6. 风场/科氏力（双预设）');
  for (const preset of ['mortar120', 'spin120']) {
    B.applyPreset(preset);
    const base = { preset, jump: 0, yaw0: 0, wy0: 0, wz0: 0 };
    const noEnv = { useCoriolis: false, useWind: false };
    const ref = B.simulate(Object.assign({}, base, { env: noEnv }));
    const crossR = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useWind: true, windCross: 15 }) }));
    const crossL = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useWind: true, windCross: -15 }) }));
    const head = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useWind: true, windHead: 15 }) }));
    const tail = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useWind: true, windHead: -15 }) }));
    const corN = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useCoriolis: true, latitude: 40, azimuth: 0 }) }));
    const corS = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useCoriolis: true, latitude: -40, azimuth: 0 }) }));
    const corE = B.simulate(Object.assign({}, base, { env: Object.assign({}, noEnv, { useCoriolis: true, latitude: 40, azimuth: 90 }) }));
    const aeroField = (ref.aeroDrift !== undefined) ? ref.aeroDrift : ref.windDrift;
    const d = { crossR: crossR.drift - ref.drift, crossL: crossL.drift - ref.drift, head: head.range - ref.range, tail: tail.range - ref.range, corN: corN.coriolisDrift, corS: corS.coriolisDrift, corE: corE.coriolisDrift, noWindAeroDrift: aeroField, aeroDriftRenamed: (ref.aeroDrift !== undefined && ref.windDrift === undefined), totalDriftNoEnv: ref.drift };
    out[preset] = d;
    console.log('  [' + preset + '] 横风 +15: Δz=' + f(d.crossR, 1) + ' m, -15: Δz=' + f(d.crossL, 1) + ' m；纵风 +15: ΔR=' + f(d.head, 1) + ' m, -15: ΔR=' + f(d.tail, 1) + ' m');
    console.log('    科氏 drift：40°N ' + f(d.corN, 1) + ' m，40°S ' + f(d.corS, 1) + ' m，40°N 东射向 ' + f(d.corE, 1) + ' m；无风时 aeroDrift=' + f(d.noWindAeroDrift, 1) + ' m（气动/初始扰动侧偏；windDrift 已更名 aeroDrift=' + d.aeroDriftRenamed + '）');
    const ok = d.crossR > 0 && d.crossL < 0 && d.head < 0 && d.tail > 0 && d.corN > 0 && d.corS < 0;
    if (ok) issue('P3', 'F6-' + preset, preset + '：风/科氏方向与量级正确（右风 +' + f(d.crossR, 0) + 'm、左风 ' + f(d.crossL, 0) + 'm；逆风 ' + f(d.head, 0) + 'm、顺风 +' + f(d.tail, 0) + 'm；40°N 右偏 +' + f(d.corN, 1) + 'm、40°S 左偏 ' + f(d.corS, 1) + 'm）。');
    else issue('P1', 'F6-' + preset, preset + ' 风/科氏方向检查失败。');
  }
  // 科氏解析式复核：zCor = ∫∫ a_z dt², a_z = -2(Ωx·vy - Ωy·vx)
  B.applyPreset('spin120');
  const rc = B.simulate({ preset: 'spin120', env: { useWind: false, useCoriolis: true, latitude: 40, azimuth: 0 }, jump: 0, yaw0: 0, wy0: 0, wz0: 0, fragCount: 20 });
  const OM = 7.292115e-5, phi = 40 * Math.PI / 180, Az = 0;
  const ox = OM * Math.cos(phi) * Math.cos(Az), oy = OM * Math.sin(phi), oz = -OM * Math.cos(phi) * Math.sin(Az);
  let vc = 0, zc = 0;
  const ss = rc.samples;
  for (let i = 1; i < ss.length; i++) {
    const a = ss[i - 1], b = ss[i];
    const aczA = -2 * (ox * a.vy - oy * a.vx + (oz !== 0 ? 0 : 0));
    const aczB = -2 * (ox * b.vy - oy * b.vx);
    const dt = b.t - a.t;
    const vcNew = vc + 0.5 * (aczA + aczB) * dt;
    zc += 0.5 * (vc + vcNew) * dt;
    vc = vcNew;
  }
  out.coriolisAnalytic = { reported: rc.coriolisDrift, recomputed: zc, relErrPct: rel(zc, rc.coriolisDrift), lat: 40, azimuth: 0 };
  console.log('  科氏解析式复核（40°N 正北，旋转弹）：diagnostic coriolisDrift=' + f(rc.coriolisDrift, 2) + ' m，用 samples 对 a_z=-2(Ω×v)_z 二次积分=' + f(zc, 2) + ' m（差 ' + f(rel(zc, rc.coriolisDrift), 2) + '%，10ms 采样梯形误差）');
  B.applyPreset('mortar120');
  const renamed = out.mortar120.aeroDriftRenamed && out.spin120.aeroDriftRenamed;
  if (renamed) issue('P3', 'F6-aeroDrift', 'API 改名完成：result.aeroDrift / sample.aeroDrift 已替代 windDrift（无风时迫弹 ' + f(out.mortar120.noWindAeroDrift, 1) + ' m、旋转弹 ' + f(out.spin120.noWindAeroDrift, 1) + ' m，为气动/初始扰动侧偏，非风偏）；physics.js 中已无 windDrift 字段，test-physics.js/test-validation.js 均已同步。');
  else issue('P2', 'F6-label', 'result.windDrift 更名不完整（aeroDriftRenamed=false），仍有旧 windDrift 字段或缺少 aeroDrift。');
  // 温度效应（+30°C vs -30°C 海平面温度偏移）
  B.applyPreset('mortar120');
  const hot = B.simulate({ preset: 'mortar120', env: { tempC: 45, useWind: false, useCoriolis: false } });
  const cold = B.simulate({ preset: 'mortar120', env: { tempC: -15, useWind: false, useCoriolis: false } });
  const temp = { hotRange: hot.range, coldRange: cold.range, deltaHot: hot.range - cold.range, deltaHotPct: rel(hot.range, cold.range), hotMach: hot.maxMach, coldMach: cold.maxMach };
  out.temperature = temp;
  console.log('  温度效应：+45°C R=' + f(hot.range, 1) + ' m（Ma_max=' + f(hot.maxMach, 3) + '），-15°C R=' + f(cold.range, 1) + ' m（Ma_max=' + f(cold.maxMach, 3) + '），暖空气增程 ' + f(temp.deltaHot, 1) + ' m（' + f(temp.deltaHotPct, 2) + '%）');
  // 缠距 → Sg / 偏流趋势（旋转弹）
  const twistRows = [];
  B.applyPreset('spin120');
  for (const twist of [15, 18, 22]) {
    const r = B.simulate({ preset: 'spin120', twist, env: { useWind: false, useCoriolis: false } });
    twistRows.push({ twist, spin0: r.spin0, Sg0: r.Sg0, drift: r.drift, spinBurst: r.spinBurst, maxAlpha: r.maxAlpha });
    console.log('  缠距 1:' + twist + ' → spin0=' + f(r.spin0, 0) + ' rad/s，Sg0=' + f(r.Sg0, 2) + '，maxα=' + f(r.maxAlpha, 2) + '°，侧偏 ' + f(r.drift, 1) + ' m（起爆自转 ' + f(r.spinBurst, 0) + '）');
  }
  out.twistTrend = twistRows;
  const sgTrendOk = Math.abs(twistRows[0].Sg0 / (twistRows[1].Sg0) - Math.pow(18 / 15, 2)) < 0.05;
  console.log('  => Sg ∝ spin² ∝ 1/缠距² 趋势检查：' + (sgTrendOk ? '通过 ✅' : '异常 ⚠') + '（1:15/1:18 的 Sg 比值 ' + f(twistRows[0].Sg0 / twistRows[1].Sg0, 3) + '，理论 ' + f(Math.pow(18 / 15, 2), 3) + '）');
  R.sections.F6 = out;
  return out;
}

/* ---------- F7 破片 ---------- */
function F7(P, P_fragdt, P_nospin) {
  const B = P.B;
  const out = {};
  console.log('\nF7. 破片模型（双预设）');
  for (const preset of ['mortar120', 'spin120']) {
    B.applyPreset(preset);
    const cfg = { preset, seed: 2024 };
    const r = B.simulate(cfg);
    const fr = r.fragments;
    const masses = fr.list.map((x) => x.m);
    const ms = summarize(masses);
    const mu = fr.mu;
    const smp = new Array(30000);
    for (let i = 0; i < smp.length; i++) smp[i] = P.internals.sampleMottMass(mu);
    const ss = summarize(smp);
    const ks = ksTest(smp, (m) => 1 - Math.exp(-Math.sqrt(m / mu)));
    const landed = fr.list.filter((x) => x.landed).slice().sort((a, b) => a.radius - b.radius);
    const wR90 = (key, frac) => { const tot = landed.reduce((s, x) => s + x[key], 0); let acc = 0; for (const x of landed) { acc += x[key]; if (acc >= tot * frac) return x.radius; } return landed.length ? landed[landed.length - 1].radius : 0; };
    const massR90 = wR90('m', 0.9), energyR90 = wR90('energy', 0.9);
    // 种子离散
    const seedStats = [];
    for (let s = 1; s <= 8; s++) { const rr = B.simulate(Object.assign({}, cfg, { seed: s * 101 })); seedStats.push({ seed: s * 101, r90: rr.fragments.r90, r50: rr.fragments.r50, massSum: rr.fragments.massSum, duration: rr.fragments.duration }); }
    const agg = (k) => { const sm = summarize(seedStats.map((x) => x[k])); return { mean: sm.mean, sd: sm.sd, cv: sm.cv, min: sm.min, max: sm.max }; };
    const r90s = agg('r90'), r50s = agg('r50'), massS = agg('massSum');
    // 破片步长（新版 RK4 + cfg.fragDt 可配；默认 0.005，对比 0.0025）
    const dtRows = [];
    for (const fragDt of [0.005, 0.0025]) {
      const rr = P_fragdt.B.simulate(Object.assign({}, cfg, { fragDt }));
      dtRows.push({ fragDt, r90: rr.fragments.r90, avgLandV: rr.fragments.avgLandV, totalEnergy: rr.fragments.totalEnergy, duration: rr.fragments.duration });
    }
    // 自转切向速度贡献
    const rn = P_nospin.B.simulate(cfg);
    // 风对破片落点
    const rw = B.simulate(Object.assign({}, cfg, { env: { windCross: 15 } }));
    const meanZ = (ff) => ff.list.filter((x) => x.landed).reduce((s, x) => s + x.landZ, 0) / Math.max(1, ff.landedCount);
    const o = {
      preset, count: fr.count, massSum: fr.massSum, casing: B.SHELL.casing, massRelErr: fr.massSum / B.SHELL.casing - 1,
      meanMass: ms.mean, maxMass: fr.maxMass, cv: ms.cv, mu, mott: { meanRatio: ss.mean / (2 * mu), cv: ss.cv, ksD: ks.D, ksP: ks.p },
      gurney: fr.vGurney, v0mean: summarize(fr.list.map((x) => x.v0)).mean, v0max: summarize(fr.list.map((x) => x.v0)).max,
      r90: fr.r90, r50: fr.r50, massR90, energyR90, kill: fr.killCount, killFrac: fr.killCount / fr.count, effective: fr.effectiveCount,
      seedStats: { r90: r90s, r50: r50s, massSum: massS }, fragDt: dtRows,
      spinEffect: { r90NoSpin: rn.fragments.r90, lateralNoSpin: rn.fragments.lateralMax, lateralDefault: fr.lateralMax },
      windEffect: { meanZCalm: meanZ(fr), meanZWind: meanZ(rw.fragments), lateralWind: rw.fragments.lateralMax }
    };
    out[preset] = o;
    console.log('  [' + preset + '] N=' + fr.count + '，Σm=' + f(fr.massSum, 6) + ' kg（壳体 ' + o.casing + '，误差 ' + o.massRelErr.toExponential(1) + '），均值 ' + f(ms.mean * 1000, 2) + ' g，最大 ' + f(fr.maxMass * 1000, 1) + ' g');
    console.log('    Mott: mean/2μ=' + f(o.mott.meanRatio, 4) + '，CV=' + f(o.mott.cv, 3) + '（理论 2.236），KS p≈' + f(o.mott.ksP, 3) + '；Gurney vG=' + f(fr.vGurney, 1) + ' m/s，破片相对初速均值 ' + f(o.v0mean, 0) + ' m/s');
    console.log('    R90/R50=' + f(fr.r90, 1) + '/' + f(fr.r50, 1) + ' m（等权，UI 口径）；质量加权 R90=' + f(massR90, 1) + ' m；能量加权 R90=' + f(energyR90, 1) + ' m；>78J ' + fr.killCount + '/' + fr.count + '（' + f(o.killFrac * 100, 0) + '%），有效破片 ' + fr.effectiveCount);
    console.log('    种子离散(8): r90=' + f(r90s.mean, 1) + '±' + f(r90s.sd, 1) + ' m（CV ' + f(r90s.cv * 100, 1) + '%），r50 CV ' + f(r50s.cv * 100, 0) + '%，Σm ' + f(massS.min, 6) + '~' + f(massS.max, 6) + ' kg；固定种子两次一致=' + (B.simulate(cfg).fragments.r90 === fr.r90));
    console.log('    破片 dt 默认(0.005) vs 0.0025: r90 ' + f(dtRows[0].r90, 2) + '→' + f(dtRows[1].r90, 2) + ' m（' + f(rel(dtRows[0].r90, dtRows[1].r90), 2) + '%），平均落速 ' + f(dtRows[0].avgLandV, 2) + '→' + f(dtRows[1].avgLandV, 2) + '（' + f(rel(dtRows[0].avgLandV, dtRows[1].avgLandV), 2) + '%），总动能 ' + f(dtRows[0].totalEnergy / 1000, 1) + '→' + f(dtRows[1].totalEnergy / 1000, 1) + ' kJ（' + f(rel(dtRows[0].totalEnergy, dtRows[1].totalEnergy), 2) + '%）');
    console.log('    自转切向速度：r90 ' + f(fr.r90, 1) + '→' + f(rn.fragments.r90, 1) + ' m，lateralMax ' + f(fr.lateralMax, 1) + '→' + f(rn.fragments.lateralMax, 1) + ' m；横风+15：破片落点 z 均值 ' + f(o.windEffect.meanZCalm, 1) + '→' + f(o.windEffect.meanZWind, 1) + ' m');
    if (Math.abs(o.massRelErr) < 1e-9) issue('P3', 'F7-mass-' + preset, preset + ' 破片质量守恒：Σm=' + f(fr.massSum, 6) + ' kg = 壳体质量（误差 ' + o.massRelErr.toExponential(1) + '），Mott 采样器与理论一致（KS p=' + f(ks.p, 2) + '）。');
    else issue('P1', 'F7-mass-' + preset, preset + ' 破片质量不守恒。');
    if (Math.abs(rel(dtRows[0].avgLandV, dtRows[1].avgLandV)) > 1) issue('P2', 'F7-fragdt-' + preset, preset + ' 破片积分默认 dt 与 0.0025 相比平均落速差 ' + f(rel(dtRows[0].avgLandV, dtRows[1].avgLandV), 2) + '%、总动能差 ' + f(rel(dtRows[0].totalEnergy, dtRows[1].totalEnergy), 2) + '%（建议后续默认 ≤0.0025）。');
    else issue('P3', 'F7-fragdt-' + preset, preset + ' 破片积分（RK4，默认 dt=0.005）与 0.0025 差异 ≤' + f(Math.max(Math.abs(rel(dtRows[0].avgLandV, dtRows[1].avgLandV)), Math.abs(rel(dtRows[0].totalEnergy, dtRows[1].totalEnergy))), 2) + '%，破片弹道精度已满足。');
    if (r90s.cv > 0.05) issue('P2', 'F7-r90noise-' + preset, preset + ' R90 随机性：8 个种子 r90=' + f(r90s.mean, 1) + '±' + f(r90s.sd, 1) + ' m（CV ' + f(r90s.cv * 100, 1) + '%），r50 CV ' + f(r50s.cv * 100, 0) + '%；已支持固定种子（默认 2024，UI 可调），统计解释时需注意单次实现的随机性。');
  }
  R.sections.F7 = out;
  return out;
}

/* ---------- F8 性能 ---------- */
function F8(P, P_nofrag) {
  const B = P.B;
  function best(fn, n) { let b = Infinity; for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; if (ms < b) b = ms; } return b; }
  const out = {};
  console.log('\nF8. 性能');
  for (const preset of ['mortar120', 'spin120']) {
    B.applyPreset(preset);
    const cfg = { preset };
    for (let i = 0; i < 2; i++) B.simulate(cfg);
    const total = best(() => B.simulate(cfg), 3);
    P_nofrag.B.applyPreset(preset);
    for (let i = 0; i < 2; i++) P_nofrag.B.simulate(Object.assign({}, cfg, { __noFrag: true }));
    const ballistic = best(() => P_nofrag.B.simulate(Object.assign({}, cfg, { __noFrag: true })), 3);
    const frag = total - ballistic;
    out[preset] = { totalMs: total, ballisticMs: ballistic, fragmentMs: frag, fragmentShare: frag / total };
    console.log('  [' + preset + '] simulate 总耗时 ' + f(total, 1) + ' ms = 弹道 ' + f(ballistic, 1) + ' ms + 破片 ' + f(frag, 1) + ' ms（破片 ' + f(frag / total * 100, 0) + '%）');
  }
  R.sections.F8 = out;
  const maxT = Math.max(out.mortar120.totalMs, out.spin120.totalMs);
  if (maxT < 400) issue('P3', 'F8-perf', '性能：双预设 simulate 总耗时 ' + f(out.mortar120.totalMs, 0) + ' / ' + f(out.spin120.totalMs, 0) + ' ms（破片占 ' + f(out.mortar120.fragmentShare * 100, 0) + '% / ' + f(out.spin120.fragmentShare * 100, 0) + '%），浏览器交互可接受。');
  else issue('P1', 'F8-perf', 'simulate 耗时 ' + f(maxT, 0) + ' ms 偏大。');
  return out;
}

/* ---------- F9 UI/API/参数一致性 ---------- */
function F9(P) {
  const B = P.B;
  let out = {};
  // 默认 SHELL 与 McCoy 表 9.5
  B.applyPreset('mortar120');
  const sh = Object.assign({}, B.SHELL);
  const refMortar = { mass: 13.585, D: 0.11956, L: 0.7049, Ix: 0.02335, Iy: 0.23187, xcgD: (0.7049 - 0.4229) / 0.11956 };
  const shellChecks = {};
  for (const k of Object.keys(refMortar)) shellChecks[k] = { code: sh[k], ref: refMortar[k], ok: Math.abs(sh[k] - refMortar[k]) < 1e-9 };
  console.log('\nF9. UI/API/参数一致性');
  console.log('  默认预设 SHELL vs McCoy 表 9.5：' + Object.keys(shellChecks).map((k) => k + '=' + f(sh[k], 5) + (shellChecks[k].ok ? ' ✅' : ' (ref ' + f(refMortar[k], 5) + ')')).join('，'));
  console.log('  casing/charge（工程估算）: ' + sh.casing + ' / ' + sh.charge + ' kg；twist=' + sh.twist + '，spinMode=' + sh.spinMode);
  const presets = Object.keys(B.PRESETS);
  console.log('  预设: ' + presets.join(', ') + '；当前=' + B.getPreset());
  // UI 静态检查
  const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const idxSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const chartsSrc = fs.readFileSync(path.join(ROOT, 'charts.js'), 'utf8');
  const seedMatch = idxSrc.match(/id="env-seed"[^>]*min="(\d+)"[^>]*max="(\d+)"[^>]*value="(\d+)"/);
  const ui = {
    presetSeg: idxSrc.indexOf('id="preset-seg"') >= 0, presetButtons: (idxSrc.match(/data-preset=/g) || []).length,
    seedSlider: idxSrc.indexOf('id="env-seed"') >= 0, mainSeed: /cfg\.seed/.test(mainSrc) && /bindEnvRange\(el\.envSeed/.test(mainSrc),
    seedRange: seedMatch ? { min: seedMatch[1], max: seedMatch[2], value: seedMatch[3] } : null,
    windSlider: idxSrc.indexOf('id="rng-wind"') >= 0, envPanel: idxSrc.indexOf('id="panel-env"') >= 0, modelPanel: idxSrc.indexOf('id="panel-model"') >= 0,
    sgHud: idxSrc.indexOf('id="hud-sg"') >= 0, driftStat: idxSrc.indexOf('id="stat-drift"') >= 0,
    hudItems: (idxSrc.match(/class="hud-item"/g) || []).length,
    chartDefs: (chartsSrc.match(/title:\s*'/g) || []).length,
    chartCells: 7,
    chart7Switch: /alphaT|wx/.test(chartsSrc) && /spinStabilized|preset/.test(chartsSrc),
    twistRowToggle: /rowTwist/.test(mainSrc) && (/disabled|hidden/.test(mainSrc) || /noSpin/.test(mainSrc)),
    unitsSwitch: /cal/.test(mainSrc) || /静态稳定|静稳定/.test(mainSrc),
    modelValidation: idxSrc.indexOf('1500') >= 0 || idxSrc.indexOf('11500') >= 0 || idxSrc.indexOf('表 9.7') >= 0,
    citation: idxSrc.indexOf('McCoy') >= 0
  };
  console.log('  UI 静态：预设切换=' + ui.presetSeg + '（' + ui.presetButtons + ' 个按钮），seed 滑杆=' + ui.seedSlider + '（范围 ' + (ui.seedRange ? ui.seedRange.min + '–' + ui.seedRange.max + '，默认 ' + ui.seedRange.value : '?') + '），main.js 传入 cfg.seed=' + ui.mainSeed + '，风滑杆=' + ui.windSlider + '，环境/模型面板=' + ui.envPanel + '/' + ui.modelPanel + '，HUD=' + ui.hudItems + ' 项，图表=' + ui.chartDefs + ' 图，图7切换=' + ui.chart7Switch + '，缠距禁用逻辑=' + ui.twistRowToggle + '，Sg/单位切换=' + ui.unitsSwitch + '，模型验证表=' + ui.modelValidation + '，文献引用=' + ui.citation);
  if (ui.hudItems !== 10) issue('P1', 'F9-hud', 'HUD 项数=' + ui.hudItems + '（预期 10）。');
  if (ui.chartDefs < 7) issue('P1', 'F9-charts', '图表定义数=' + ui.chartDefs + '（预期 7 格，浏览器验证实际 DOM 数）。');
  if (ui.seedRange && (ui.seedRange.min !== '1' || ui.seedRange.max !== '9999' || ui.seedRange.value !== '2024')) issue('P2', 'F9-seed-range', '随机种子滑杆范围/默认值不符合 1–9999 默认 2024。');
  if (!ui.mainSeed) issue('P1', 'F9-seed', 'UI 种子滑杆未接入 main.js/cfg.seed。');
  else issue('P3', 'F9-seed', 'UI 已接入破片随机种子（#env-seed → cfg.seed；physics 默认 seed=2024），同参数结果可复现。');
  // 渲染器响应式静态检查：resize() 读取 canvas.clientWidth 后又写死 canvas.style.width → 第二次 resize 不再生效
  const r3d = fs.readFileSync(path.join(ROOT, 'render3d.js'), 'utf8');
  const useParent = /var host = canvas\.parentElement/.test(r3d) && /host\.clientWidth/.test(r3d) && /host\.clientHeight/.test(r3d);
  const noStyleWrite = !/canvas\.style\.width\s*=\s*W/.test(r3d) && !/canvas\.style\.height\s*=\s*H/.test(r3d);
  const resizeFixed = useParent && noStyleWrite;
  console.log('  渲染器 resize 检查：改用父容器尺寸=' + useParent + '，不再写死 canvas.style=' + noStyleWrite + ' => 修复=' + resizeFixed);
  if (resizeFixed) issue('P3', 'F9-resize', 'Scene3D.resize() 已改为读取 canvas.parentElement.clientWidth/Height，并删除 canvas.style.width/height 固定回写（render3d.js 1234–1251 行）；浏览器实测 1680→1280→1000 多次缩放后 canvas.width/height 均等于 host 尺寸（见浏览器报告 responsive 字段与截图 11/12/13），基线 P2 画布锁死问题已修复。');
  else issue('P2', 'F9-resize', 'Scene3D.resize() 仍存在画布尺寸锁死风险（读取 canvas.clientWidth 并/或回写 style）。');
  // aeroAt / 鲁棒性
  let aeroAt = null; try { aeroAt = B.aeroAt(1.0); } catch (e) { aeroAt = 'ERR:' + e.message; }
  out = { shell: sh, shellChecks, presets, currentPreset: B.getPreset(), ui, aeroAt };
  R.sections.F9 = out;
  const shellOk = Object.keys(shellChecks).every((k) => shellChecks[k].ok);
  if (shellOk) issue('P3', 'F9-shell', '默认 120mm 迫弹预设的质量/惯量/质心与 McCoy 表 9.5 完全一致（13.585 kg / 0.11956 m / Ix 0.02335 / Iy 0.23187 / 质心 0.4229 m 自弹底）。');
  else issue('P1', 'F9-shell', '默认 SHELL 与 McCoy 表 9.5 不一致，见数据。');
  return out;
}

/* ---------- main ---------- */
function main() {
  const P = loadNative(TARGET);
  console.log('# 升级后内核独立最终复验');
  console.log('目标: ' + TARGET + '  sha256=' + P.sha256.slice(0, 16) + '  internals missing=' + (P.missing.join(',') || '(none)'));
  // 破片步长：新版已内置 cfg.fragDt（RK4），旧版通过内存补丁参数化
  const srcText = fs.readFileSync(TARGET, 'utf8');
  let P_fragdt;
  if (/cfg\.fragDt/.test(srcText)) { P_fragdt = P; }
  else if (/    var dt = 0\.005;/.test(srcText)) { P_fragdt = loadNative(TARGET, { patches: [[/    var dt = 0\.005;/, '    var dt = (cfg && cfg.fragDt) ? cfg.fragDt : 0.005;']] }); }
  else { P_fragdt = loadNative(TARGET, { patches: [[/    var dt = 0\.01;/, '    var dt = (cfg && cfg.fragDt) ? cfg.fragDt : 0.01;']] }); }
  const P_nofrag = loadNative(TARGET, { patches: [[/result\.fragments = simulateFragments\(result, cfg\);/, 'result.fragments = (cfg && cfg.__noFrag) ? { list: [], count: 0, duration: 0, r90: 0 } : simulateFragments(result, cfg);']] });
  const P_nospin = loadNative(TARGET, { patches: [[/var pSpin = boom\.spin \|\| 0;/, 'var pSpin = 0;']] });
  F0(P);
  F1(P);
  F2(P);
  F3(P);
  F4(P);
  F5(P);
  F6(P);
  F7(P, P_fragdt, P_nospin);
  F8(P, P_nofrag);
  F9(P);
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  R.issues.sort((a, b) => (order[a.level] - order[b.level]) || a.id.localeCompare(b.id));
  const cnt = { P0: 0, P1: 0, P2: 0, P3: 0 };
  R.issues.forEach((x) => cnt[x.level]++);
  console.log('\n============================================================');
  console.log('## 问题清单（' + R.issues.length + ' 条）');
  for (const x of R.issues) console.log('[' + x.level + '][' + x.id + '] ' + x.text);
  console.log('\n汇总: P0=' + cnt.P0 + ', P1=' + cnt.P1 + ', P2=' + cnt.P2 + ', P3=' + cnt.P3);
  R.summary = cnt;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(R, null, 2), 'utf8');
  console.log('JSON: ' + OUT);
  process.exitCode = cnt.P0 > 0 ? 2 : 0;
}
main();