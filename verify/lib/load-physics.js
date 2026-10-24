/* verify/lib/load-physics.js
 * 在 Node vm 沙箱中加载 physics.js，并把 IIFE 内部私有函数/常量（deriv/rk4/atmosphere/...）
 * 以只读方式暴露给审计脚本。**不修改磁盘上的 physics.js**：注入只发生在内存源码里。
 * 若内核升级后函数改名/增删，用 eval 动态探测，缺失项进入 internals.missing 而不是直接崩溃。
 *
 * 用法：
 *   const { loadPhysics } = require('./lib/load-physics');
 *   const P = loadPhysics('../physics.js', { seed: 12345 });       // 当前 physics.js
 *   const P = loadPhysics('../verify/baseline/physics-baseline.js'); // 基线快照
 *   P.Ballistics.simulate({...});       // 与原模块等价
 *   P.internals.deriv(y, out);          // 私有导数函数
 *   P.setSeed(123);                     // 替换该沙箱内 Math.random（物理脚本引用同一 Math 对象）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

/** mulberry32：快速、确定性 PRNG（蒙特卡洛对照用） */
function mulberry32(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
    if (i >= 0) return { marker: m, index: i };
  }
  throw new Error('physics.js 结构变化：找不到导出接口标记，无法注入内部函数');
}

function loadPhysics(filePath, opts) {
  opts = opts || {};
  filePath = path.resolve(filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  const sha256 = crypto.createHash('sha256').update(src).digest('hex');

  const { marker, index } = findMarker(src);
  const inject = [
    '/*__VERIFY_INTERNALS__*/',
    'root.__internals = { missing: [] };',
    '(function () {',
    '  var names = ' + JSON.stringify(INTERNAL_NAMES) + ';',
    '  for (var i = 0; i < names.length; i++) {',
    '    try {',
    '      var v = eval(names[i]);',
    '      if (v !== undefined) root.__internals[names[i]] = v; else root.__internals.missing.push(names[i]);',
    '    } catch (e) { root.__internals.missing.push(names[i]); }',
    '  }',
    '})();',
    ''
  ].join('\n');

  let patched = src.slice(0, index) + inject + src.slice(index);
  if (opts.patches) {
    for (const [from, to] of opts.patches) {
      if (from instanceof RegExp) {
        if (!from.test(patched)) throw new Error('patch 未命中: ' + from);
        patched = patched.replace(from, to);
      } else {
        if (patched.indexOf(from) < 0) throw new Error('patch 未命中: ' + from);
        patched = patched.split(from).join(to);
      }
    }
  }

  const ctx = vm.createContext({});
  const MathObj = vm.runInContext('Math', ctx);
  const setSeed = (seed) => { MathObj.random = mulberry32(seed); };
  if (opts.seed != null) setSeed(opts.seed);
  vm.runInContext(patched, ctx, { filename: filePath });

  const B = ctx.Ballistics;
  const I = ctx.__internals;
  if (!B || !I) throw new Error('physics.js 加载失败：内部函数注入未生效');

  const internals = I;
  internals.has = (name) => internals[name] !== undefined && internals[name] !== null;
  return {
    filePath, sha256, Ballistics: B, internals, Math: MathObj, setSeed,
    sourceBytes: src.length, patchedBytes: patched.length, missing: I.missing.slice()
  };
}

module.exports = { loadPhysics, mulberry32 };
