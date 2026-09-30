const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const specs = [
    ['hero', '01-网页就是笔记本', 1280, 800],
    ['blog', '02-学习博客', 1280, 800],
    ['novel', '03-小说阅读', 1280, 800],
    ['restore', '04-重开恢复', 1280, 800],
    ['library', '05-统一整理', 1280, 800],
    ['small', '推广小图-440x280', 440, 280],
    ['large', '推广大图-1400x560', 1400, 560],
  ];
  fs.mkdirSync(path.join(__dirname, 'posters'), { recursive: true });
  for (const [scene, name, width, height] of specs) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'posters.html')).href + '?scene=' + scene);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode()));
    });
    await page.screenshot({ path: path.join(__dirname, 'posters', name + '.png') });
    await page.close();
    console.log(`${name}.png：${width}×${height}`);
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
