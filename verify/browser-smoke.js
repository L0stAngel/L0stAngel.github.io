/* verify/browser-smoke.js — 最终版浏览器冒烟测试（playwright-core + 本机 Chrome headless）
 * 覆盖：双预设切换、环境面板（横/纵风、气温、纬度、缠距禁用、破片数、随机种子）、模型面板、
 * HUD 10 项 / 图表 7 格、FPS（飞行段/破片段）、风滑杆响应、极端参数、1680x1020 + 1280x800 + 500x900，
 * DOM/控制台错误，页面内 Ballistics API 抽查；截图写入 verify/shots-final/。
 * 用法: node verify/browser-smoke.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const PW = 'C:/Users/SHADOW~1/AppData/Local/Temp/opencode/pw/node_modules/playwright-core';
const { chromium } = require(PW);

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots-final');
const RES = path.join(__dirname, 'results');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(RES, { recursive: true });
const URL = 'file:///' + path.join(ROOT, '120mm_ballistics.html').replace(/\\/g, '/');

function bundleSync() {
  const html = fs.readFileSync(path.join(ROOT, '120mm_ballistics.html'), 'utf8');
  const out = { bytes: html.length, scripts: (html.match(/<script src=/g) || []).length, files: {} };
  for (const n of ['physics.js', 'render3d.js', 'charts.js', 'main.js']) {
    const marker = '/* ===== ' + n + ' ===== */';
    const i = html.indexOf(marker);
    if (i < 0) { out.files[n] = { same: false, note: 'marker missing' }; continue; }
    const j = html.indexOf('</script>', i);
    const body = html.slice(i + marker.length, j).replace(/<\\\/script>/gi, '</script>').trim();
    const src = fs.readFileSync(path.join(ROOT, n), 'utf8').trim();
    out.files[n] = { same: crypto.createHash('sha256').update(body).digest('hex') === crypto.createHash('sha256').update(src).digest('hex') };
  }
  return out;
}

function fpsSample(page, ms) {
  return page.evaluate((dur) => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    (function tick() { n++; if (performance.now() - t0 < dur) requestAnimationFrame(tick); else res({ frames: n, ms: performance.now() - t0, fps: n / ((performance.now() - t0) / 1000) }); })();
  }), ms);
}

(async () => {
  const rep = { url: URL, startedAt: new Date().toISOString(), bundleSync: bundleSync(), consoleErrors: [], pageErrors: [], screenshots: [] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1020 }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') rep.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => rep.pageErrors.push(e.message + '\n' + (e.stack || '')));
  const shot = async (name) => { const p = path.join(OUT, name); await page.screenshot({ path: p }); rep.screenshots.push(name); };

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  rep.initial = await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    return {
      preset: Ballistics.getPreset(), presetName: Ballistics.SHELL.presetName,
      presetButtons: document.querySelectorAll('#preset-seg button').length,
      activePresetBtn: (document.querySelector('#preset-seg button.active') || {}).dataset ? document.querySelector('#preset-seg button.active').dataset.preset : null,
      hudItems: document.querySelectorAll('#hud .hud-item').length,
      chartCells: document.querySelectorAll('#charts .chart-cell').length,
      chartTags: Array.from(document.querySelectorAll('#charts .chart-tag')).map((x) => x.textContent),
      statCount: document.querySelectorAll('#sidebar .stat').length,
      statusCode: $('status-code').textContent,
      statusMode: $('status-mode').textContent,
      presetNote: $('preset-note').textContent,
      v0Range: { min: $('rng-v0').min, max: $('rng-v0').max, value: $('rng-v0').value },
      angleMax: $('rng-angle').max,
      twistDisabled: $('env-twist').disabled, twistVal: $('env-twist-val').textContent,
      seedRange: { min: $('env-seed').min, max: $('env-seed').max, value: $('env-seed').value },
      speedBtns: document.querySelectorAll('#speed-seg button').length,
      camBtns: document.querySelectorAll('#cam-controls button').length,
      overlayHidden: $('overlay').hidden,
      canvas: { w: $('scene').width, h: $('scene').height },
      stats: { range: $('stat-range').textContent, alt: $('stat-alt').textContent, mach: $('stat-mach').textContent, drift: $('stat-drift').textContent, vimp: $('stat-vimp').textContent, r90: $('stat-r90').textContent },
      fragModel: $('frag-model').textContent, windChip: $('wind-chip').textContent,
      hasScene3D: typeof Scene3D === 'object', hasCharts: typeof Charts === 'object', hasBallistics: typeof Ballistics === 'object'
    };
  });
  rep.fpsFlight = await fpsSample(page, 2200);
  await shot('01-mortar-initial.png');

  // 全局视角
  await page.click('#cam-controls button[data-mode="global"]');
  await page.waitForTimeout(700);
  await shot('02-mortar-global.png');

  // 8x 快进到破片
  await page.click('#cam-controls button[data-mode="follow"]');
  await page.click('#speed-seg button[data-speed="8"]');
  await page.waitForFunction(() => document.getElementById('status-mode').textContent.indexOf('破片') >= 0, { timeout: 120000 });
  rep.hudAtBurst = await page.evaluate(() => ({
    t: document.getElementById('hud-t').textContent, h: document.getElementById('hud-h').textContent,
    v: document.getElementById('hud-v').textContent, mach: document.getElementById('hud-mach').textContent,
    alpha: document.getElementById('hud-alpha').textContent, q: document.getElementById('hud-q').textContent,
    x: document.getElementById('hud-x').textContent, z: document.getElementById('hud-z').textContent,
    spin: document.getElementById('hud-spin').textContent, stabLabel: document.getElementById('hud-stab-label').textContent,
    sg: document.getElementById('hud-sg').textContent, sgUnit: document.getElementById('hud-sg-unit').textContent,
    toast: document.getElementById('toast').textContent
  }));
  rep.fpsFragmentsMortar = await fpsSample(page, 2200);
  await shot('03-mortar-burst.png');
  await page.waitForTimeout(900);
  await shot('04-mortar-fragments.png');

  // 等待全部落地
  const tFin = Date.now();
  await page.waitForFunction(() => document.getElementById('status-mode').textContent.indexOf('仿真完成') >= 0, { timeout: 180000 });
  rep.realSecondsToFinish8x = (Date.now() - tFin) / 1000;
  await shot('05-mortar-final.png');

  // 切换旋转弹预设
  await page.click('#preset-seg button[data-preset="spin120"]');
  await page.waitForTimeout(1200);
  rep.spinPreset = await page.evaluate(() => ({
    preset: Ballistics.getPreset(), presetName: Ballistics.SHELL.presetName,
    statusCode: document.getElementById('status-code').textContent,
    v0Range: { min: document.getElementById('rng-v0').min, max: document.getElementById('rng-v0').max, value: document.getElementById('rng-v0').value },
    twistDisabled: document.getElementById('env-twist').disabled, twistVal: document.getElementById('env-twist-val').textContent,
    chartTags: Array.from(document.querySelectorAll('#charts .chart-tag')).map((x) => x.textContent),
    stabLabel: document.getElementById('hud-stab-label').textContent, sgUnit: document.getElementById('hud-sg-unit').textContent,
    presetNote: document.getElementById('preset-note').textContent,
    stats: { range: document.getElementById('stat-range').textContent, alt: document.getElementById('stat-alt').textContent, mach: document.getElementById('stat-mach').textContent, drift: document.getElementById('stat-drift').textContent, vimp: document.getElementById('stat-vimp').textContent, r90: document.getElementById('stat-r90').textContent },
    hudSpin: document.getElementById('hud-spin').textContent, hudSg: document.getElementById('hud-sg').textContent,
    fragModel: document.getElementById('frag-model').textContent, windChip: document.getElementById('wind-chip').textContent
  }));
  await page.waitForTimeout(1200);
  await shot('06-spin-preset.png');

  // 切回迫弹 → 环境面板：缠距应禁用
  await page.click('#preset-seg button[data-preset="mortar120"]');
  await page.waitForTimeout(1000);
  await page.click('#btn-env');
  await page.waitForTimeout(500);
  rep.envPanel = await page.evaluate(() => ({
    visible: !document.getElementById('panel-env').hidden,
    overlayVisible: !document.getElementById('overlay').hidden,
    twistDisabled: document.getElementById('env-twist').disabled,
    twistVal: document.getElementById('env-twist-val').textContent,
    seed: document.getElementById('env-seed').value,
    seedRange: { min: document.getElementById('env-seed').min, max: document.getElementById('env-seed').max },
    coriolisChecked: document.getElementById('env-coriolis').checked,
    windOnChecked: document.getElementById('env-wind-on').checked,
    summary: document.getElementById('env-summary').textContent
  }));
  await shot('07-env-panel.png');

  // 环境面板：横风 +15 → 侧偏应变化，风提示应显示右风
  const beforeDrift = await page.evaluate(() => document.getElementById('stat-drift').textContent);
  await page.evaluate(() => {
    const el = document.getElementById('env-wind-cross');
    el.value = '15';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  rep.windTest = await page.evaluate(() => ({
    statDrift: document.getElementById('stat-drift').textContent,
    windChip: document.getElementById('wind-chip').textContent,
    summary: document.getElementById('env-summary').textContent,
    range: document.getElementById('stat-range').textContent
  }));
  rep.windTest.beforeDrift = beforeDrift;
  await shot('08-wind-cross-15.png');

  // 关闭面板 → 模型面板
  await page.evaluate(() => { document.querySelector('#panel-env [data-close]').click(); });
  await page.waitForTimeout(300);
  await page.click('#btn-model');
  await page.waitForTimeout(500);
  rep.modelPanel = await page.evaluate(() => ({
    visible: !document.getElementById('panel-model').hidden,
    tables: document.querySelectorAll('#panel-model table').length,
    tableRows: document.querySelectorAll('#panel-model table tr').length,
    hasMcCoy: document.getElementById('panel-model').textContent.indexOf('McCoy') >= 0,
    hasValidation: document.getElementById('panel-model').textContent.indexOf('1500') >= 0 || document.getElementById('panel-model').textContent.indexOf('7.7') >= 0 || document.getElementById('panel-model').textContent.indexOf('验证') >= 0,
    hasLimits: document.getElementById('panel-model').textContent.indexOf('局限') >= 0
  }));
  await shot('09-model-panel.png');
  await page.evaluate(() => { document.querySelector('#panel-model [data-close]').click(); });
  await page.waitForTimeout(300);

  // 随机种子滑杆：改变后结果可复现（同一 seed 两次切换后 r90 相同）
  await page.click('#btn-env');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const el = document.getElementById('env-seed');
    el.value = '4321';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1300);
  const r90a = await page.evaluate(() => document.getElementById('stat-r90').textContent);
  await page.evaluate(() => { const el = document.getElementById('rng-v0'); el.value = String(Number(el.value)); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(1300);
  const r90b = await page.evaluate(() => document.getElementById('stat-r90').textContent);
  rep.seedTest = { r90a, r90b, same: r90a === r90b };
  await page.evaluate(() => { document.querySelector('#panel-env [data-close]').click(); });
  await page.waitForTimeout(300);

  // 极端参数（旋转弹 v0=550, angle=70, boom=80）
  await page.click('#preset-seg button[data-preset="spin120"]');
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('rng-v0', 550); set('rng-angle', 70); set('rng-boom', 80);
  });
  await page.waitForTimeout(1500);
  rep.extreme = await page.evaluate(() => ({
    statusCode: document.getElementById('status-code').textContent,
    stats: { range: document.getElementById('stat-range').textContent, alt: document.getElementById('stat-alt').textContent, mach: document.getElementById('stat-mach').textContent, drift: document.getElementById('stat-drift').textContent, vimp: document.getElementById('stat-vimp').textContent, r90: document.getElementById('stat-r90').textContent },
    hudT: document.getElementById('hud-t').textContent, hudSg: document.getElementById('hud-sg').textContent
  }));
  await shot('10-extreme-spin-550-70.png');

  // 页面内 API 抽查（不改变 UI 状态）
  rep.api = await page.evaluate(() => {
    const out = {};
    try { out.aeroAt = Ballistics.aeroAt(1.0); } catch (e) { out.aeroAtError = e.message; }
    out.presets = Object.keys(Ballistics.PRESETS);
    try {
      const rr = Ballistics.simulate({ preset: 'mortar120', fragCount: 50 });
      out.aeroDriftField = { hasAeroDrift: rr.aeroDrift !== undefined, hasOldWindDrift: rr.windDrift !== undefined };
    } catch (e) { out.aeroDriftField = { error: e.message }; }
    out.tabKeys = Object.keys(Ballistics.TAB());
    try {
      const a = Ballistics.simulate({ preset: 'mortar120', seed: 2024, fragCount: 100, env: { useWind: false, useCoriolis: false } });
      const b = Ballistics.simulate({ preset: 'mortar120', seed: 2024, fragCount: 100, env: { useWind: false, useCoriolis: false } });
      out.seedReproducible = { a: a.fragments.r90, b: b.fragments.r90, same: a.fragments.r90 === b.fragments.r90 };
      const wR = Ballistics.simulate({ preset: 'mortar120', env: { useWind: true, windCross: 15, useCoriolis: false } });
      const w0 = Ballistics.simulate({ preset: 'mortar120', env: { useWind: true, windCross: 0, useCoriolis: false } });
      out.windApi = { drift15: wR.drift, drift0: w0.drift, delta: wR.drift - w0.drift };
      const cN = Ballistics.simulate({ preset: 'mortar120', env: { useWind: false, useCoriolis: true, latitude: 40, azimuth: 0 } });
      const cS = Ballistics.simulate({ preset: 'mortar120', env: { useWind: false, useCoriolis: true, latitude: -40, azimuth: 0 } });
      out.coriolisApi = { north: cN.coriolisDrift, south: cS.coriolisDrift };
    } catch (e) { out.simError = e.message; }
    // 恢复 UI 状态
    Ballistics.applyPreset(document.querySelector('#preset-seg button.active').dataset.preset);
    return out;
  });

  // 1280x800
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(800);
  rep.afterResize1280 = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const vp = document.getElementById('viewport').getBoundingClientRect();
    return { viewport: [Math.round(vp.width), Math.round(vp.height)], canvasAttr: [c.width, c.height], canvasClient: [c.clientWidth, c.clientHeight], canvasInlineStyle: c.style.width + ' x ' + c.style.height, chartCells: document.querySelectorAll('#charts .chart-cell').length, chartCanvas0: [document.querySelector('#charts canvas').width, document.querySelector('#charts canvas').height], hudItems: document.querySelectorAll('#hud .hud-item').length };
  });
  await shot('11-viewport-1280x800.png');
  // 500x900 窄屏
  // 1000x720（Lead 指定验证尺寸）
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.waitForTimeout(900);
  rep.afterResize1000 = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const vp = document.getElementById('viewport').getBoundingClientRect();
    return { viewport: [Math.round(vp.width), Math.round(vp.height)], canvasAttr: [c.width, c.height], canvasClient: [c.clientWidth, c.clientHeight], match: Math.abs(c.clientWidth - Math.round(vp.width)) <= 2 && Math.abs(c.clientHeight - Math.round(vp.height)) <= 2 };
  });
  await shot('13-viewport-1000x720.png');
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(800);
  rep.afterResize500 = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const vp = document.getElementById('viewport').getBoundingClientRect();
    return { viewport: [Math.round(vp.width), Math.round(vp.height)], canvasAttr: [c.width, c.height], canvasClient: [c.clientWidth, c.clientHeight], chartCells: document.querySelectorAll('#charts .chart-cell').length, hudOverflow: document.getElementById('hud').scrollWidth > document.getElementById('hud').clientWidth + 2 };
  });
  await shot('12-viewport-500x900.png');

  rep.responsive = {
    default1680: { canvas: rep.initial.canvas },
    resize1280: rep.afterResize1280,
    resize1000: rep.afterResize1000,
    resize500: rep.afterResize500,
    sceneResizeBug: !!(rep.afterResize1280 && rep.afterResize1280.canvasAttr && rep.afterResize1280.viewport && rep.afterResize1280.canvasAttr[0] > rep.afterResize1280.viewport[0] + 2),
    sceneResizeFixed: !!(rep.afterResize1280 && rep.afterResize1000 && rep.afterResize1280.canvasAttr[0] === rep.afterResize1280.viewport[0] && rep.afterResize1000.canvasAttr[0] === rep.afterResize1000.viewport[0])
  };
  rep.errorsTotal = rep.consoleErrors.length + rep.pageErrors.length;
  console.log(JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(RES, 'browser-smoke.json'), JSON.stringify(rep, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });