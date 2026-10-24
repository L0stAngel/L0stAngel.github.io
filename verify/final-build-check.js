/* verify/final-build-check.js — 最终构建/题录轮次的快速确认（F0 等价 + 文档题录 + 内核冒烟） */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files = ['physics.js', 'index.html', 'main.js', 'charts.js', 'render3d.js', 'styles.css', '120mm_ballistics.html', 'README.md', 'docs/report.md'];
const out = { generatedAt: new Date().toISOString(), files: {} };
for (const f of files) {
  const p = path.join(ROOT, f);
  out.files[f] = fs.existsSync(p) ? { bytes: fs.statSync(p).size, sha256: sha(p) } : null;
}
// 单文件包内联四脚本 vs 源文件
const html = fs.readFileSync(path.join(ROOT, '120mm_ballistics.html'), 'utf8');
out.bundle = {};
for (const n of ['physics.js', 'render3d.js', 'charts.js', 'main.js']) {
  const marker = '/* ===== ' + n + ' ===== */';
  const i = html.indexOf(marker);
  const j = html.indexOf('</script>', i);
  const body = html.slice(i + marker.length, j).replace(/<\\\/script>/gi, '</script>').trim();
  const src = fs.readFileSync(path.join(ROOT, n), 'utf8').trim();
  out.bundle[n] = { same: crypto.createHash('sha256').update(body).digest('hex') === crypto.createHash('sha256').update(src).digest('hex') };
}
out.bundle.bytes = html.length;
out.unresolved = /(href|src)="[^"]+\.(css|js)"/.test(html);
// 题录增补检查
const phys = fs.readFileSync(path.join(ROOT, 'physics.js'), 'utf8');
const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const readme = fs.existsSync(path.join(ROOT, 'README.md')) ? fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8') : '';
const rep = fs.readFileSync(path.join(ROOT, 'docs/report.md'), 'utf8');
out.references = {
  physics: {
    GB_T_45846: phys.indexOf('GB/T 45846-2025') >= 0,
    Orlowski: phys.indexOf('Or') >= 0 && (/Or..owski|Orłowski/.test(phys)),
    LiKun: phys.indexOf('李昆') >= 0,
    Rettinger: phys.indexOf('Rettinger') >= 0,
    MottSpringer: /Mott/.test(phys) && /2006|Springer/.test(phys)
  },
  indexPanel: {
    references: idx.indexOf('参考文献') >= 0,
    MonteCarloNote: /Monte-Carlo|Monte Carlo/.test(idx) && /统计样本/.test(idx),
    Orlowski: /Or..owski|Orłowski/.test(idx),
    LiKun: idx.indexOf('李昆') >= 0,
    Gold2007: idx.indexOf('Gold') >= 0,
    GB_T_45846: idx.indexOf('GB/T 45846-2025') >= 0
  },
  counts: { readme58: readme.indexOf('58') >= 0, report58: rep.indexOf('58') >= 0 }
};
// 内核冒烟（题录改动不应影响物理；确认加载与双预设可跑）
const B = require(path.join(ROOT, 'physics.js'));
const m = B.simulate({ preset: 'mortar120', fragCount: 50, seed: 2024 });
const s = B.simulate({ preset: 'spin120', fragCount: 50, seed: 2024 });
let aeroAt = null; try { aeroAt = B.aeroAt(1.0); } catch (e) { aeroAt = 'ERR:' + e.message; }
out.smoke = {
  mortar: { preset: m.preset, range: m.range, t: m.flightTime, alt: m.maxAlt, dt: m.dt },
  spin: { preset: s.preset, range: s.range, t: s.flightTime, alt: s.maxAlt, spin0: s.spin0, Sg0: s.Sg0 },
  aeroAt, aeroDriftField: m.aeroDrift !== undefined, oldWindDriftField: m.windDrift !== undefined
};
const allBundle = Object.keys(out.bundle).filter((k) => out.bundle[k] && out.bundle[k].same === false);
out.ok = !out.unresolved && allBundle.length === 0 && !out.references.physics.Orlowski === false && out.smoke.aeroDriftField && !out.smoke.oldWindDriftField;
console.log(JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(__dirname, 'results', 'final-build-check.json'), JSON.stringify(out, null, 2));
