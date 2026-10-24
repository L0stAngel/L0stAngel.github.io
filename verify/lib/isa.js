/* verify/lib/isa.js — ISA 1976 标准大气参考值（0–32 km，与 physics.js 的 atmosphere() 对照用）
 * 分段：0–11 km 对流层，11–20 km 等温层，20–32 km 上层。
 * 返回 { T[K], P[Pa], rho[kg/m³], a[m/s] }
 */
'use strict';
const R = 287.05287, G0 = 9.80665, GAMMA = 1.4;
const layers = [
  { h0: 0,     T0: 288.15, P0: 101325,   L: -0.0065 },
  { h0: 11000, T0: 216.65, P0: 22632.06, L: 0 },
  { h0: 20000, T0: 216.65, P0: 5474.889, L: 0.001 }
];
function isa(h) {
  h = Math.max(0, Math.min(32000, h));
  let lay = layers[0];
  for (const L of layers) if (h >= L.h0) lay = L;
  const dh = h - lay.h0;
  let T, P;
  if (Math.abs(lay.L) < 1e-12) {
    T = lay.T0;
    P = lay.P0 * Math.exp(-G0 * dh / (R * T));
  } else {
    T = lay.T0 + lay.L * dh;
    P = lay.P0 * Math.pow(T / lay.T0, -G0 / (R * lay.L));
  }
  const rho = P / (R * T);
  return { T, P, rho, a: Math.sqrt(GAMMA * R * T), h };
}
module.exports = { isa, R, G0, GAMMA };
