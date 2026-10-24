const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/SHADOW~1/AppData/Local/Temp/opencode/pw/node_modules/playwright-core');

const target = process.env.SHOT_URL || 'file:///C:/Users/shadowmoon/Desktop/test/index.html';
const outDir = process.env.SHOT_DIR || 'C:/Users/shadowmoon/Desktop/test/_shots';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1020 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '')));

  await page.goto(target, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '01-launch.png') });

  // 全局视角看完整弹道
  await page.click('#cam-controls button[data-mode="global"]');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, '02-global.png') });

  // 8x 快进到接近起爆
  await page.click('#cam-controls button[data-mode="follow"]');
  await page.click('#speed-seg button[data-speed="8"]');
  await page.waitForFunction(
    () => document.getElementById('status-mode').textContent.indexOf('破片') >= 0,
    { timeout: 120000 }
  );
  await page.click('#speed-seg button[data-speed="1"]');
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(outDir, '03-burst.png') });

  await page.waitForTimeout(1100);
  await page.screenshot({ path: path.join(outDir, '04-fragments.png') });

  // 全局视角观察落点散布
  await page.click('#cam-controls button[data-mode="global"]');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(outDir, '05-impact-global.png') });

  const probe = await page.evaluate(() => ({
    hudT: document.getElementById('hud-t').textContent,
    status: document.getElementById('status-mode').textContent,
    statR90: document.getElementById('stat-r90').textContent
  }));

  console.log(JSON.stringify({ probe, errors }, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
