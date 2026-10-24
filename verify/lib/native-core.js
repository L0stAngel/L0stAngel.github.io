/* verify/lib/native-core.js
 * 把目标 physics.js 复制成 verify/.tmp 下的“插桩副本”（仅内存注入私有函数导出 + 可选源码补丁），
 * 再用原生 require 加载，以获得与浏览器/Node 相同的真实性能（vm 沙箱会慢 5~7 倍）。
 * 被审计的 physics.js 本身不被修改。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mulberry32 } = require('./load-physics');

const TMP = path.join(__dirname, '..', '.tmp');
fs.mkdirSync(TMP, { recursive: true });

const EXPORT_MARKERS = [
  '/* ------------------------------ 导出接口',
  '/* ------------------------------ 导出',
  'var Ballistics = {'
];
const INTERNAL_NAMES = [
  'deriv', 'rk4', 'atmosphere', 'aeroAt', 'AERO', 'ATM', 'ATM_N', 'SHELL', 'G0',
  'deriveKinematics', 'simulateFragments', 'sampleMottMass', 'randomNormal',
  'quatToMatrix', 'FRAG_ZONES', 'fragCd', 'simulate', 'REPORT', 'SHELL_CFG'
];

function findMarker(src) {
  for (const m of EXPORT_MARKERS) {
    const i = src.indexOf(m);
    if (i >= 0) return i;
  }
  throw new Error('physics.js 结构变化：找不到导出接口标记');
}

function inject(src) {
  const i = findMarker(src);
  const block = [
    '/*__VERIFY_INTERNALS__*/',
    'root.__internals = { missing: [] };',
    '(function () {',
    '  var names = ' + JSON.stringify(INTERNAL_NAMES) + ';',
    '  for (var ii = 0; ii < names.length; ii++) {',
    '    try {',
    '      var vv = eval(names[ii]);',
    '      if (vv !== undefined) root.__internals[names[ii]] = vv; else root.__internals.missing.push(names[ii]);',
    '    } catch (e) { root.__internals.missing.push(names[ii]); }',
    '  }',
    '})();',
    ''
  ].join('\n');
  return src.slice(0, i) + block + src.slice(i) +
    '\n/* verify: native require 暴露内部函数 */\n' +
    'if (typeof module !== \'undefined\' && module.exports) module.exports.__internals = globalThis.__internals;\n';
}

/**
 * @param {string} filePath 目标 physics.js（或基线快照）
 * @param {object} opts { patches: [[from,to],...] }
 * @returns {{B:object, internals:object, setSeed:function, sha256:string, tmpFile:string}}
 */
function loadNative(filePath, opts) {
  opts = opts || {};
  filePath = path.resolve(filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  const sha256 = crypto.createHash('sha256').update(src).digest('hex');
  let patched = inject(src);
  const applied = [];
  for (const [from, to] of (opts.patches || [])) {
    if (from instanceof RegExp) {
      if (!from.test(patched)) throw new Error('patch 未命中: ' + from);
      patched = patched.replace(from, to);
      applied.push(String(from));
    } else {
      if (patched.indexOf(from) < 0) throw new Error('patch 未命中: ' + from);
      patched = patched.split(from).join(to);
      applied.push(from);
    }
  }
  const h = crypto.createHash('sha256').update(patched).digest('hex').slice(0, 16);
  const tmpFile = path.join(TMP, 'physics-' + h + '.js');
  if (!fs.existsSync(tmpFile)) fs.writeFileSync(tmpFile, patched, 'utf8');
  // 同一进程内不同补丁版本的 require 缓存互不冲突（文件名含内容 hash）
  const mod = require(tmpFile);
  const B = mod;
  const I = mod.__internals;
  if (!I) throw new Error('内部函数注入失败（' + tmpFile + '）');
  const origRandom = Math.random;
  const setSeed = (seed) => { Math.random = mulberry32(seed); };
  const restore = () => { Math.random = origRandom; };
  I.has = (n) => I[n] !== undefined && I[n] !== null;
  return { B, internals: I, setSeed, restore, sha256, tmpFile, patches: applied, missing: I.missing.slice() };
}

module.exports = { loadNative };
