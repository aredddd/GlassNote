'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { chromium } = require('playwright');
const path = require('node:path');

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function contentPage(run) {
  const page = await browser.newPage();
  try {
    await page.route('https://content-regression.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>测试文章</title><p id="quote">值得记下的原文内容。</p>',
      }),
    );
    await page.goto('https://content-regression.test/first');
    await page.evaluate(() => {
      window.__upserts = [];
      window.chrome = {
        runtime: { onMessage: { addListener() {} } },
        storage: { onChanged: { addListener() {} } },
      };
      window.GNStore = {
        canonicalUrl: (value) => new URL(value).href,
        getSettings: async () => ({ enabled: true, autoRestore: true, defaultColor: 'yellow' }),
        getPage: async () => ({ annotations: [] }),
        upsert: async (url, title, annotation) => {
          window.__upserts.push({ url, title, annotation });
        },
      };
    });
    await page.addScriptTag({ path: path.join(__dirname, '../src/shared/anchor.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../src/content/content.js') });
    await page.evaluate(() => __glassNoteV3.ready);
    return await run(page);
  } finally {
    await page.close();
  }
}

async function selectText(page) {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#quote'));
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('#glassnote-root').shadowRoot.querySelector('.selection-toolbar')
        .hidden,
  );
}

test('SPA 改变 URL 后立即点击旧选区工具栏，不能把标注保存到旧页面', async () => {
  const saved = await contentPage(async (page) => {
    await selectText(page);
    await page.evaluate(() => {
      // 同一任务中连续执行，真实模拟轮询/MutationObserver 尚未来得及触发的窗口。
      history.pushState({}, '', '/second');
      document.querySelector('#glassnote-root').shadowRoot.querySelector('.primary-tool').click();
    });
    await page.waitForFunction(() => !__glassNoteV3.savingSelection);
    return page.evaluate(() => window.__upserts);
  });
  assert.equal(saved.length, 0);
});
