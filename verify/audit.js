/* verify/audit.js — 120mm 杀爆弹 physics.js 独立审计（可重复运行）
 *
 * 用法：
 *   node verify/audit.js                          # 审计基线快照 verify/baseline/physics-baseline.js
 *   node verify/audit.js --target physics.js      # 审计当前 physics.js（升级后最终复验）
 *   node verify/audit.js --sections A,C,D         # 只跑指定节
 *   node verify/audit.js --brief                  # 只打印问题清单摘要
 *
 * 产物：
 *   verify/results/audit-<tag>.json               # 结构化结果（含全部数字）
 *   控制台 Markdown 风格表格
 * 依赖：纯 Node（无第三方包），不修改被审计的 physics.js。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { loadNative } = require('./lib/native-core');
const { createRefSim } = require('./lib/refsim');
const { isa } = require('./lib/isa');
const stats = require('./lib/stats');

const ROOT = path.resolve(__dirname, '..');
const SECTIONS = {
  A: { name: '数值积分', mod: './lib/audit-numerics' },
  B: { name: '标准大气', mod: './lib/audit-atmo' },
  C: { name: '气动/稳定性', mod: './lib/audit-aero' },
  D: { name: '破片模型', mod: './lib/audit-frag' },
  E: { name: '弹道合理性', mod: './lib/audit-trajectory' },
  F: { name: '性能/浏览器', mod: './lib/audit-perf' }
};

function parseArgs(argv) {
  const args = { target: path.join(__dirname, 'baseline', 'physics-baseline.js'), sections: Object.keys(SECTIONS), brief: false, out: null, tag: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') args.target = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--sections') args.sections = argv[++i].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (a === '--brief') args.brief = true;
    else if (a === '--out') args.out = path.resolve(process.cwd(), argv[++i]);
    else if (a === '--tag') args.tag = argv[++i];
    else if (a === '--help' || a === '-h') { console.log('用法: node verify/audit.js [--target physics.js] [--sections A,B,C,D,E,F] [--brief] [--out file.json]'); process.exit(0); }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.target)) { console.error('目标文件不存在: ' + args.target); process.exit(1); }
  const target = loadNative(args.target);
  const env = { BASE: args.target, TARGET: args.target, loadNative, createRefSim, isa, stats };
  const tag = args.tag || (path.basename(args.target).replace(/\.js$/, '') + '-' + target.sha256.slice(0, 8));
  const result = {
    generatedAt: new Date().toISOString(),
    target: { path: args.target, sha256: target.sha256, bytes: fs.statSync(args.target).size, missingInternals: target.missing },
    sections: [], issues: []
  };

  console.log('# 120mm 杀爆弹 physics.js 独立审计');
  console.log('目标: ' + args.target);
  console.log('SHA256: ' + target.sha256 + '（' + fs.statSync(args.target).size + ' bytes）');
  console.log('时间: ' + result.generatedAt);
  console.log('');

  for (const key of args.sections) {
    const def = SECTIONS[key];
    if (!def) { console.error('未知节: ' + key); continue; }
    const started = Date.now();
    const mod = require(def.mod);
    const sec = mod.run(env);
    sec.elapsedMs = Date.now() - started;
    result.sections.push(sec);
    for (const iss of sec.issues) result.issues.push(Object.assign({ section: key }, iss));
    if (!args.brief) {
      console.log('\n## ' + key + '. ' + sec.title + '  （' + (sec.elapsedMs / 1000).toFixed(1) + 's）');
      for (const row of sec.rows) console.log(row);
    } else {
      console.log('## ' + key + '. ' + sec.title + ' — ' + sec.issues.length + ' 个问题');
    }
  }

  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  result.issues.sort((a, b) => (order[a.level] - order[b.level]) || a.id.localeCompare(b.id));
  console.log('\n============================================================');
  console.log('## 问题清单（' + result.issues.length + ' 条）');
  console.log('============================================================');
  for (const iss of result.issues) {
    console.log('[' + iss.level + '][' + iss.section + '/' + iss.id + '] ' + iss.text);
  }
  const count = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const iss of result.issues) count[iss.level]++;
  console.log('\n汇总: P0=' + count.P0 + ', P1=' + count.P1 + ', P2=' + count.P2 + ', P3=' + count.P3 + '；目标=' + path.basename(args.target) + ' sha=' + target.sha256.slice(0, 12));

  const outFile = args.out || path.join(__dirname, 'results', 'audit-' + tag + '.json');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');
  console.log('JSON: ' + outFile);
}

main();
