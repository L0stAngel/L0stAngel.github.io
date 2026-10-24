/* 动爆破片落点形态分析：固定种子，输出顶视密度与轴向剖面 */
const B = require('./physics.js');
B.applyPreset('spin120');

let seed = 20240601;
Math.random = function () {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const r = B.simulate({ v0: 450, angle: 45, hBoom: 12, fragCount: 420 });
const f = r.fragments, boom = r.boom;
const lands = f.list.filter(x => x.landed);
const rel = lands.map(x => ({ x: x.landX - boom.x, z: x.landZ - boom.z, m: x.m }));

console.log('弹道: t=%s s  range=%s m  起爆(%s, %s, %s) V=%s',
  r.flightTime.toFixed(2), r.range.toFixed(1),
  boom.x.toFixed(1), boom.y.toFixed(1), boom.z.toFixed(1), boom.speed.toFixed(1));
console.log('落地: %d / %d 枚   最晚落地 t=+%s s   最早 t=+%s s',
  f.landedCount, f.count,
  Math.max(...lands.map(x => x.landT - boom.t)).toFixed(2),
  Math.min(...lands.map(x => x.landT - boom.t)).toFixed(2));
console.log('前向/后向: +%s / %s m   侧向 ±%s m',
  f.forwardMax.toFixed(0), f.backMin.toFixed(0), f.lateralMax.toFixed(0));

/* --- 轴向剖面：50m 分箱 --- */
const BIN = 50, X0 = -750, X1 = 1050;
const nb = Math.ceil((X1 - X0) / BIN);
const hist = new Array(nb).fill(0);
for (const p of rel) {
  const k = Math.floor((p.x - X0) / BIN);
  if (k >= 0 && k < nb) hist[k]++;
}
console.log('\n轴向（x）剖面：每 50m 破片数');
let peak = Math.max(...hist);
for (let i = 0; i < nb; i += 2) {
  const x = X0 + i * BIN;
  const n = hist[i] + hist[i + 1];
  const bar = '#'.repeat(Math.round(n / peak * 44));
  console.log(String(x).padStart(5), bar, n);
}

/* --- 顶视 ASCII --- */
const COLS = 78, ROWS = 34;
const gx0 = -750, gx1 = 1050, gz0 = -850, gz1 = 850;
const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
for (const p of rel) {
  const c = Math.floor((p.x - gx0) / (gx1 - gx0) * COLS);
  const rr = Math.floor((gz1 - p.z) / (gz1 - gz0) * ROWS); // 上=+z
  if (c >= 0 && c < COLS && rr >= 0 && rr < ROWS) grid[rr][c]++;
}
const mx = Math.max(...grid.flat());
const chars = ' .:-=+*#%@';
console.log('\n顶视图（右=+x 前向，上=+z 左侧，炸点地面投影在中间偏右）');
for (let rr = 0; rr < ROWS; rr++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    const v = grid[rr][c];
    line += v ? chars[Math.min(9, Math.floor(v / mx * 9) + 1)] : ' ';
  }
  console.log(line);
}

/* --- 竖向剖面 t=+0.6s --- */
const T = 0.6;
const rows = 26, cols = 70;
const yx0 = -300, yx1 = 1200, yy0 = -60, yy1 = 700;
const g2 = Array.from({ length: rows }, () => new Array(cols).fill(0));
for (const fr of f.list) {
  const idx = Math.min(fr.path.length / 3 - 1, Math.floor(T / fr.pathDt));
  const px = fr.path[idx * 3] - boom.x, py = fr.path[idx * 3 + 1];
  const c = Math.floor((px - yx0) / (yx1 - yx0) * cols);
  const rr = Math.floor((yy1 - py) / (yy1 - yy0) * rows);
  if (c >= 0 && c < cols && rr >= 0 && rr < rows) g2[rr][c]++;
}
const m2 = Math.max(...g2.flat());
console.log('\n竖向剖面 t=+0.6s（右=+x 前向，上=高度）');
for (let rr = 0; rr < rows; rr++) {
  let line = '';
  for (let c = 0; c < cols; c++) {
    const v = g2[rr][c];
    line += v ? chars[Math.min(9, Math.floor(v / m2 * 9) + 1)] : ' ';
  }
  console.log(line);
}
