/* verify/lib/eig.js — 4x4 实矩阵特征值（Faddeev-LeVerrier 特征多项式 + Durand-Kerner 求根） */
'use strict';
function matMul(A, B) {
  const n = A.length, m = B[0].length, p = B.length;
  const C = [];
  for (let i = 0; i < n; i++) { C.push([]); for (let j = 0; j < m; j++) { let s = 0; for (let k = 0; k < p; k++) s += A[i][k] * B[k][j]; C[i].push(s); } }
  return C;
}
function polyEig(M) {
  const n = M.length;
  let B = M.map((r, i) => r.map((_, j) => (i === j ? 1 : 0)));
  const coeff = [1];
  for (let k = 1; k <= n; k++) {
    const NB = matMul(M, B);
    let tr = 0; for (let i = 0; i < n; i++) tr += NB[i][i];
    const ck = -tr / k;
    coeff.push(ck);
    B = NB.map((r, i) => r.map((v, j) => v + (i === j ? ck : 0)));
  }
  const n2 = coeff.length - 1;
  const roots = [];
  for (let i = 0; i < n2; i++) roots.push([Math.cos(2 * Math.PI * i / n2 + 0.4) * 1.2, Math.sin(2 * Math.PI * i / n2 + 0.4) * 1.2]);
  const evalP = (z) => {
    let re = coeff[0], im = 0;
    for (let i = 1; i <= n2; i++) { const nre = re * z[0] - im * z[1] + coeff[i]; const nim = re * z[1] + im * z[0]; re = nre; im = nim; }
    return [re, im];
  };
  const cdiv = (a, b) => { const den = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / den, (a[1] * b[0] - a[0] * b[1]) / den]; };
  for (let it = 0; it < 300; it++) {
    for (let i = 0; i < n2; i++) {
      const num = evalP(roots[i]);
      let den = [1, 0];
      for (let j = 0; j < n2; j++) {
        if (j === i) continue;
        const diff = [roots[i][0] - roots[j][0], roots[i][1] - roots[j][1]];
        den = [den[0] * diff[0] - den[1] * diff[1], den[0] * diff[1] + den[1] * diff[0]];
      }
      const q = cdiv(num, den);
      roots[i] = [roots[i][0] - q[0], roots[i][1] - q[1]];
    }
  }
  return roots.map((r) => ({ re: r[0], im: r[1], abs: Math.hypot(r[0], r[1]) })).sort((a, b) => b.re - a.re);
}
module.exports = { polyEig, matMul };
