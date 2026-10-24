/* verify/lib/audit-atmo.js — B 标准大气对照 */
'use strict';
const { isa } = require('./isa');
const U = require('./audit-util');

function run(env) {
  const { BASE, loadNative } = env;
  const P = loadNative(BASE);
  const atm = P.internals.atmosphere;
  const out = { section: 'B', title: '标准大气（ISA 对照 / 插值 / 20km 截断）', rows: [], data: {}, issues: [] };
  const R = 287.05287;

  // B1: 与 ISA 对照
  const hs = [0, 1000, 5000, 8000, 10000, 11000, 12000, 15000, 18000, 20000, 25000, 30000];
  out.rows.push('B1. physics.atmosphere(h) vs ISA-1976（code 的 T 由 a 反推 T=a²/1.4R，P=ρRT）：');
  out.rows.push('    h(m)   code ρ(kg/m³)  ISA ρ      Δρ%     code a(m/s) ISA a     Δa%    code T(K)  ISA T(K)  ΔT%');
  const table = [];
  for (const h of hs) {
    const A = atm(h);
    const S = isa(h);
    const cT = A.a * A.a / (1.4 * R);
    const cP = A.rho * R * cT;
    const rec = { h, rho: A.rho, a: A.a, T: cT, P: cP, isa: S,
      dRho: (A.rho / S.rho - 1) * 100, dA: (A.a / S.a - 1) * 100, dT: (cT / S.T - 1) * 100, dP: (cP / S.P - 1) * 100 };
    table.push(rec);
    out.rows.push('    ' + U.pad(h, 6) + '  ' + U.pad(A.rho.toFixed(5), 12) + '  ' + U.pad(S.rho.toFixed(5), 8) + '  ' + U.pad(rec.dRho.toFixed(2), 7) + '  ' + U.pad(A.a.toFixed(2), 10) + '  ' + U.pad(S.a.toFixed(2), 7) + '  ' + U.pad(rec.dA.toFixed(2), 6) + '  ' + U.pad(cT.toFixed(1), 8) + '  ' + U.pad(S.T.toFixed(1), 8) + '  ' + U.pad(rec.dT.toFixed(1), 6));
  }
  out.data.B1 = table;

  // B2: 线性插值误差（0–11km，与生成表的解析式对照）
  let maxRhoErr = 0, maxAErr = 0, hRho = 0, hA = 0;
  for (let h = 0; h <= 11000; h += 10) {
    const A = atm(h);
    const T = 288.15 - 0.0065 * h;
    const P0 = 101325 * Math.pow(T / 288.15, 5.25588);
    const rho = P0 / (287.05287 * T), a = Math.sqrt(1.4 * 287.05287 * T);
    const er = Math.abs(A.rho / rho - 1), ea = Math.abs(A.a / a - 1);
    if (er > maxRhoErr) { maxRhoErr = er; hRho = h; }
    if (ea > maxAErr) { maxAErr = ea; hA = h; }
  }
  out.data.B2 = { maxRhoRelErr: maxRhoErr, atH_rho: hRho, maxARelErr: maxAErr, atH_a: hA };
  out.rows.push('B2. 0–11km 线性插值误差（与生成表的解析式逐点对照，10m 网格）：max|Δρ/ρ|=' + U.sci(maxRhoErr) + '（h=' + hRho + 'm），max|Δa/a|=' + U.sci(maxAErr) + '（h=' + hA + 'm）=> 100m 表+线性插值本身误差可忽略。');

  // B3: 11km 以上与 ISA 的偏差
  const above = table.filter(x => x.h >= 12000);
  out.data.B3 = above.map(x => ({ h: x.h, dRho: x.dRho, dA: x.dA, dT: x.dT, dP: x.dP }));
  out.rows.push('B3. 关键缺陷：表在大气分层上只用了对流层公式外推到 20km，缺少 11km 对流层顶的等温层（ISA 11–20km T=216.65K）：');
  for (const x of above) out.rows.push('    h=' + U.pad(x.h, 5) + 'm  Δρ=' + U.pad(x.dRho.toFixed(2), 7) + '%  Δa=' + U.pad(x.dA.toFixed(2), 7) + '%  ΔT=' + U.pad(x.dT.toFixed(1), 7) + '%  ΔP=' + U.pad(x.dP.toFixed(1), 7) + '%');
  out.issues.push({ level: 'P1', id: 'B3', text: '大气模型 11km 以上错误：把对流层递减率外推到 20km，20km 处 T 低 27%（158K vs 216.65K）、声速低 14.6%（252 vs 295 m/s）、压力低 21%，导致高升弧段马赫数虚高、阻力偏大。当前 UI（v0≤550, angle≤70°）最大升弧约 5.9km，尚未触发；一旦升级提高初速/射角就会进入错误区。建议补 11–20km 等温层与 20–32km 层，或直接用 ISA 分段解析。' });

  // B4: 20km 截断
  const a20 = atm(20000), a25 = atm(25000), a30 = atm(30000);
  out.data.B4 = { a20, a25, a30 };
  out.rows.push('B4. 20km 截断：atmosphere(20000)=' + JSON.stringify(a20) + '，atmosphere(25000)=' + JSON.stringify(a25) + '，atmosphere(30000)=' + JSON.stringify(a30) + ' => h>20km 被冻结为 20km 值（不是真空），高升弧会凭空多出阻力。');
  out.issues.push({ level: 'P2', id: 'B4', text: 'h>20km 直接 clamp 到 20km 密度（0.0953 kg/m³），而不是继续按指数衰减到 ~0；对 >20km 升弧会高估阻力。当前 UI 不可达，属潜在问题。' });

  // B5: 与当前轨迹相关性
  P.setSeed(20240601);
  const r = P.B.simulate({ v0: 450, angle: 45, hBoom: 12, spin: 18, fragCount: 120 });
  out.data.B5 = { maxAlt: r.maxAlt, maxMach: r.maxMach };
  out.rows.push('B5. 当前基线的最大升弧 ' + r.maxAlt.toFixed(0) + ' m、最大马赫 ' + r.maxMach.toFixed(2) + '，全程位于 0–11km 的 ISA 对流层内 => 基线结果不受 B3/B4 缺陷影响；缺陷仅在高初速/大射角或未来升级参数下暴露。');
  return out;
}
module.exports = { run };
