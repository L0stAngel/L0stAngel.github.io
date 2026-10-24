const { chromium } = require('C:/Users/SHADOW~1/AppData/Local/Temp/opencode/pw/node_modules/playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1020 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto('file:///C:/Users/shadowmoon/Desktop/test/120mm_ballistics.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 测量 3 秒内的 rAF 帧率（跟随视角飞行段）
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0;
    const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      else res({ frames: n, ms: performance.now() - t0, fps: n / ((performance.now() - t0) / 1000) });
    })();
  }));

  // 切到 8x 快进，测量破片阶段（最重的绘制场景）帧率
  await page.click('#speed-seg button[data-speed="8"]');
  await page.waitForFunction(() => document.getElementById('status-mode').textContent.indexOf('破片') >= 0, { timeout: 90000 });
  const fpsFrag = await page.evaluate(() => new Promise(res => {
    let n = 0;
    const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
      else res({ frames: n, ms: performance.now() - t0, fps: n / ((performance.now() - t0) / 1000) });
    })();
  }));

  // 结构完整性：六图 + HUD 8 项
  const dom = await page.evaluate(() => ({
    charts: document.querySelectorAll('#charts .chart-cell').length,
    chartCur: document.querySelectorAll('#charts .chart-cur').length,
    hudItems: document.querySelectorAll('#hud .hud-item').length,
    canvasW: document.getElementById('scene').width,
    canvasH: document.getElementById('scene').height,
    r90: document.getElementById('stat-r90').textContent,
    alt: document.getElementById('stat-alt').textContent,
    mach: document.getElementById('stat-mach').textContent,
    scripts: document.querySelectorAll('script[src]').length,
    styles: document.querySelectorAll('link[rel=stylesheet]').length
  }));

  console.log(JSON.stringify({ fpsFlight: fps, fpsFragments: fpsFrag, dom, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
