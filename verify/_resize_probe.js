const { chromium } = require('C:/Users/SHADOW~1/AppData/Local/Temp/opencode/pw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1680, height: 1020 } });
  await p.goto('file:///C:/Users/shadowmoon/Desktop/test/120mm_ballistics.html', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const c = document.getElementById('scene');
    const cells = Array.from(document.querySelectorAll('#charts canvas')).map((cv) => ({ attr: [cv.width, cv.height], client: [cv.clientWidth, cv.clientHeight] }));
    return { sceneStyle: c.style.width + 'x' + c.style.height, sceneAttr: [c.width, c.height], sceneClient: [c.clientWidth, c.clientHeight], cells };
  });
  console.log(JSON.stringify(r, null, 1));
  // 手动触发一次先清空 style 再 resize，验证修复假设
  const fixed = await p.evaluate(() => {
    const c = document.getElementById('scene');
    c.style.width = ''; c.style.height = '';
    Scene3D.resize();
    return { attr: [c.width, c.height], client: [c.clientWidth, c.clientHeight], style: c.style.width + 'x' + c.style.height };
  });
  console.log('after clear+resize', JSON.stringify(fixed));
  await b.close();
})();