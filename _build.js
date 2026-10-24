/* 将多文件页面打包为单文件 HTML（离线可用、可直接双击打开） */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const safeJs = s => s.replace(/<\/script>/gi, '<\\/script>');

let html = read('index.html');

html = html.replace(
  /<link rel="stylesheet" href="styles\.css">/,
  '<style>\n' + read('styles.css') + '\n</style>'
);

html = html.replace(
  /<script src="physics\.js"><\/script>\s*<script src="render3d\.js"><\/script>\s*<script src="charts\.js"><\/script>\s*<script src="main\.js"><\/script>/,
  ['physics.js', 'render3d.js', 'charts.js', 'main.js']
    .map(f => '<script>\n/* ===== ' + f + ' ===== */\n' + safeJs(read(f)) + '\n</script>')
    .join('\n')
);

const out = path.join(dir, '120mm_ballistics.html');
fs.writeFileSync(out, html, 'utf8');
console.log('written:', out, (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
console.log('unresolved refs:', /(href|src)="[^"]+\.(css|js)"/.test(html) ? 'YES' : 'no');
