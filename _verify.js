/* 验证：右键平移、左键旋转、平移复位、运行到最后一枚破片落地 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('C:/Users/SHADOW~1/AppData/Local/Temp/opencode/pw/node_modules/playwright-core');

const target = process.env.SHOT_URL || 'file:///C:/Users/shadowmoon/Desktop/test/120mm_ballistics.html';
const outDir = process.env.SHOT_DIR || 'C:/Users/shadowmoon/Desktop/test/_shots_single';
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1020 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto(target, { waitUntil: 'load' });
  await page.waitForTimeout(1400);

  // 暂停，使跟随相机目标静止，便于对平移量做定量校验
  await page.click('#btn-play');
  await page.waitForTimeout(800);

  const box = await page.locator('#scene').boundingBox();
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.55;

  const cam0 = await page.evaluate(() => Scene3D.getCamera());

  // 右键拖动 = 平移
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 180, cy + 90, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  const camPan = await page.evaluate(() => Scene3D.getCamera());

  // 左键拖动 = 旋转（不改 pan）
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(cx + 120, cy - 40, { steps: 8 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(400);
  const camOrbit = await page.evaluate(() => Scene3D.getCamera());

  // 切换视角 = 复位平移
  await page.click('#cam-controls button[data-mode="global"]');
  await page.waitForTimeout(600);
  const camReset = await page.evaluate(() => Scene3D.getCamera());

  // 8x 快进，验证结束条件不再截断在起爆后 8 s
  await page.click('#btn-play');
  await page.click('#cam-controls button[data-mode="follow"]');
  await page.click('#speed-seg button[data-speed="8"]');
  await page.waitForFunction(() => document.getElementById('status-mode').textContent.indexOf('破片') >= 0, { timeout: 60000 });
  const tBurst = await page.evaluate(() => parseFloat(document.getElementById('hud-t').textContent));
  await page.waitForFunction(t => parseFloat(document.getElementById('hud-t').textContent) > t, tBurst + 9.5, { timeout: 60000 });
  const stMid = await page.evaluate(() => document.getElementById('status-mode').textContent);
  await page.screenshot({ path: path.join(outDir, '10-mid-flight.png') });

  await page.waitForFunction(
    () => document.getElementById('status-mode').textContent.indexOf('仿真完成') >= 0,
    { timeout: 120000 }
  );
  const tEnd = await page.evaluate(() => parseFloat(document.getElementById('hud-t').textContent));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '11-final-all-landed.png') });

  // 最终全局视角 + 俯视看形态
  await page.click('#cam-controls button[data-mode="global"]');
  await page.waitForTimeout(1400);
  await page.screenshot({ path: path.join(outDir, '12-final-global.png') });

  const probe = await page.evaluate(() => ({
    hudT: document.getElementById('hud-t').textContent,
    status: document.getElementById('status-mode').textContent,
    toast: document.getElementById('toast').textContent
  }));

  console.log(JSON.stringify({
    cam0, camPan, camOrbit, camReset,
    panDx: camPan.tx - cam0.tx,
    orbitYawDx: camOrbit.yaw - camPan.yaw,
    tBurst, tEnd, midStatus: stMid,
    probe, errors
  }, null, 2));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
