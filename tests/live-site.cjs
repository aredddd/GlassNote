'use strict';

// 可选联网验收；不加入默认离线 node:test。所有笔记仅写入隔离浏览器的扩展存储。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const outputDir =
  process.env.GN_OUTPUT_DIR ||
  process.env.GN_SCREENSHOT_DIR ||
  process.env.GN_LIVE_OUTPUT_DIR ||
  path.join(root, 'test-results');
const directoryUrl = 'https://xiaolinnote.com/agent/';
const articleUrl = 'https://xiaolinnote.com/agent/concept/agent.html';
const result = {
  site: directoryUrl,
  startedAt: new Date().toISOString(),
  browser: 'Playwright Chromium / 真实 MV3 扩展 / 临时隔离配置',
  tests: [],
  screenshots: [],
  passed: false,
};
let context, worker, page;

async function eventually(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label}：等待超时（${typeof last === 'string' ? last : JSON.stringify(last)}）`,
  );
}

async function currentTabId() {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  const matched = tabs.find((tab) => tab.url === page.url());
  if (matched) return matched.id;
  // activeTab 权限未授予时 URL 可能隐藏。本脚本始终只保留一个网页标签，不能猜测多标签对应关系。
  assert.equal(tabs.length, 1, '无法唯一确定真实网页标签 ID');
  return tabs[0].id;
}

async function send(message) {
  return worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, message), {
    id: await currentTabId(),
    message,
  });
}

async function status() {
  return send({ action: 'getStatus' });
}
async function savedPage(url) {
  return worker.evaluate((url) => repository.dispatch('getPage', { url }), url);
}

async function ready(url) {
  await page.locator('#glassnote-root').waitFor({ timeout: 20000 });
  await page.locator('#main-content').waitFor({ timeout: 20000 });
  const state = await eventually(async () => {
    const state = await status();
    return state.success && state.url === url && !state.error ? state : false;
  }, '真实扩展与网页就绪');
  await dismissNotice();
  return state;
}

async function dismissNotice() {
  // 网站自己的公开促销说明，不是登录或权限验证；仅点击其正常关闭按钮。
  const dismiss = page
    .locator('.vp-notice-wrapper')
    .getByRole('button', { name: '知道了', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
}

async function assertCounts(url, total, restored, label) {
  const state = await eventually(async () => {
    const current = await status();
    return current.url === url &&
      current.total === total &&
      current.restored === restored &&
      current.unresolved === 0
      ? current
      : false;
  }, label);
  result.tests.push({
    name: label,
    passed: true,
    url: state.url,
    total: state.total,
    restored: state.restored,
    unresolved: state.unresolved,
  });
  console.log(`通过：${label}`);
  return state;
}

async function paragraphIndices() {
  return page.locator('#main-content p').evaluateAll((elements) =>
    elements.flatMap((element, index) => {
      const length = element.textContent.trim().length;
      const rect = element.getBoundingClientRect();
      if (length < 20 || length > 320 || rect.height <= 0 || rect.width <= 0) return [];
      // 阅读展开层可能仍保留全文 DOM，但其裁切范围外的内容不属于可见正文。
      // 不对该区域 scrollIntoView，不修改网站访问控制或展开样式。
      let ancestor = element.parentElement;
      while (ancestor) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden') return [];
        if (/hidden|clip/.test(style.overflowY)) {
          const bounds = ancestor.getBoundingClientRect();
          if (rect.top < bounds.top || rect.bottom > bounds.bottom) return [];
        }
        ancestor = ancestor.parentElement;
      }
      return [index];
    }),
  );
}

async function selectParagraph(index) {
  const paragraph = page.locator('#main-content p').nth(index);
  await paragraph.scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.locator('#glassnote-root .selection-toolbar').waitFor({ state: 'visible' });
  return paragraph;
}

async function writeNote(index, content) {
  await selectParagraph(index);
  await page
    .locator('#glassnote-root .selection-toolbar')
    .getByRole('button', { name: '写笔记', exact: true })
    .click();
  await page
    .locator('#glassnote-root')
    .getByRole('textbox', { name: '笔记内容', exact: true })
    .fill(content);
  await page
    .locator('#glassnote-root')
    .getByRole('button', { name: '保存笔记', exact: true })
    .click();
  await page.locator('#glassnote-root .editor').waitFor({ state: 'detached' });
}

async function closePanel() {
  const panel = page.locator('#glassnote-root .panel');
  if (await panel.isVisible())
    await page
      .locator('#glassnote-root')
      .getByRole('button', { name: '关闭笔记面板', exact: true })
      .click();
}

async function screenshot(filename) {
  await dismissNotice();
  await page.locator('#glassnote-root .panel').waitFor({ state: 'visible' });
  const toast = page.locator('#glassnote-root .toast');
  await toast.waitFor({ state: 'hidden', timeout: 10000 });
  await page.screenshot({
    path: path.join(outputDir, filename),
    fullPage: false,
    animations: 'disabled',
  });
  result.screenshots.push(filename);
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  context.setDefaultTimeout(15000);
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  result.extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close();
  await page.goto(directoryUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ready(directoryUrl);
  const directoryParagraphs = await paragraphIndices();
  assert.ok(
    directoryParagraphs.length >= 2,
    '真实网站正文发生变化，缺少可选择的两段文字，请重新检查页面选择器',
  );
  const highlightedParagraph = page.locator('#main-content p').nth(directoryParagraphs[0]);
  const beforeHTML = await highlightedParagraph.innerHTML();
  await selectParagraph(directoryParagraphs[0]);
  await page
    .locator('#glassnote-root .selection-toolbar')
    .getByRole('button', { name: '高亮', exact: true })
    .click();
  await assertCounts(directoryUrl, 1, 1, '目录页短段正文高亮保存');
  assert.ok(
    (await highlightedParagraph.innerHTML()) === beforeHTML,
    '高亮不得改变网站原文或节点结构',
  );
  const directoryNote = '实测记录：刷新和重新打开后，笔记应该仍留在这段原文旁。';
  await writeNote(directoryParagraphs[1], directoryNote);
  await assertCounts(directoryUrl, 2, 2, '目录页便签保存与原文关联');
  let data = await savedPage(directoryUrl);
  const note = data.annotations.find((annotation) => annotation.content === directoryNote);
  assert.ok(note?.anchor, '便签必须有真实保存的文本锚点');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(directoryUrl);
  await assertCounts(directoryUrl, 2, 2, '刷新后高亮和便签自动恢复');
  assert.ok(
    (await savedPage(directoryUrl)).annotations.some(
      (annotation) => annotation.id === note.id && annotation.content === directoryNote,
    ),
    '刷新后便签内容不变',
  );

  const closed = page;
  page = await context.newPage();
  await closed.close();
  await page.goto(directoryUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ready(directoryUrl);
  await assertCounts(directoryUrl, 2, 2, '关闭标签页并重新打开后恢复');
  assert.equal((await send({ action: 'focusAnnotation', id: note.id })).found, true);
  await screenshot('GlassNote-小林笔记实测.png');

  await closePanel();
  await dismissNotice();
  // 点击网站真实目录链接，让 VuePress 自己处理导航；不通过 history 伪造路由。
  await page
    .locator(`#main-content a[href="${new URL(articleUrl).pathname}"]`)
    .first()
    .click();
  await eventually(() => page.url().split('#')[0] === articleUrl, '真实目录链接导航');
  await ready(articleUrl);
  await assertCounts(articleUrl, 0, 0, '点击目录进入正文文章后笔记隔离');
  await eventually(
    () =>
      page
        .locator('#readmore-container')
        .evaluate((element) => getComputedStyle(element).overflowY === 'hidden'),
    '等待网站阅读展开层完成初始化',
  );
  result.siteBoundary =
    '正文页有网站自身的阅读展开裁切；本次仅测试公开可见段落，未解锁或绕过该限制。';
  const articleParagraphs = await eventually(async () => {
    const indices = await paragraphIndices();
    return indices.length >= 2 ? indices : false;
  }, '公开可见正文加载');
  const articleIndex = articleParagraphs[1];
  const articleNote = '在真实文章中验证原文定位与页面隔离。';
  await writeNote(articleIndex, articleNote);
  await assertCounts(articleUrl, 1, 1, '正文文章独立便签保存');
  data = await savedPage(articleUrl);
  const articleRecord = data.annotations.find((annotation) => annotation.content === articleNote);
  assert.ok(articleRecord?.anchor, '正文便签必须保存锚点');
  await closePanel();
  await dismissNotice();
  await page.mouse.move(850, 700);
  await page.mouse.wheel(0, 3000);
  await eventually(
    async () =>
      page
        .locator('#main-content p')
        .nth(articleIndex)
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom < 0 || rect.top > innerHeight;
        }),
    '滚动使已保存的公开段落离开视口',
  );
  const scrolled = await page.evaluate(() => scrollY);
  assert.equal((await send({ action: 'focusAnnotation', id: articleRecord.id })).found, true);
  await eventually(
    async () =>
      page
        .locator('#main-content p')
        .nth(articleIndex)
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.bottom > 60 && rect.top < innerHeight - 60;
        }),
    '滚动后定位回保存的公开正文',
  );
  const focusedScroll = await page.evaluate(() => scrollY);
  assert.ok(focusedScroll < scrolled - 100, '定位应滚动回原文');
  result.tests.push({
    name: '滚动离开公开段落后定位回原文',
    passed: true,
    movedUp: Math.round(scrolled - focusedScroll),
    visibleInViewport: true,
  });
  console.log('通过：滚动离开公开段落后定位回原文');
  await screenshot('GlassNote-小林笔记正文实测.png');

  await page.goBack({ waitUntil: 'domcontentloaded' });
  await eventually(() => page.url().split('#')[0] === directoryUrl, '返回真实目录页');
  await ready(directoryUrl);
  await assertCounts(directoryUrl, 2, 2, '返回目录页后只恢复目录页原有两条记录');
  assert.equal(
    (await savedPage(articleUrl)).annotations.length,
    1,
    '返回目录页不能丢失正文文章的记录',
  );
  const library = await context.newPage();
  await library.goto(`chrome-extension://${result.extensionId}/src/library/library.html`);
  await eventually(
    async () => (await library.locator('body').innerText()).includes(articleNote),
    '笔记库读取真实两页笔记',
  );
  const articleCard = library.locator('.note-card').filter({ hasText: articleNote });
  if (await articleCard.count()) await articleCard.first().click();
  await library.screenshot({
    path: path.join(outputDir, 'GlassNote-笔记库.png'),
    fullPage: true,
    animations: 'disabled',
  });
  result.screenshots.push('GlassNote-笔记库.png');
  await library.close();
  result.passed = true;
}

run()
  .catch(async (error) => {
    result.error = error.message;
    process.exitCode = 1;
    console.error(`实测未通过：${error.message}`);
    if (page && !page.isClosed()) {
      const diagnostic = await page
        .evaluate(() => ({
          url: location.href,
          scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight,
          htmlOverflow: getComputedStyle(document.documentElement).overflow,
          bodyOverflow: getComputedStyle(document.body).overflow,
          noticeVisible: !!document.querySelector('.vp-notice-wrapper.fullscreen'),
          pointTag: document.elementFromPoint(850, 700)?.tagName,
          pointClass: document.elementFromPoint(850, 700)?.className,
          panelHidden: document
            .querySelector('#glassnote-root')
            ?.shadowRoot?.querySelector('.panel')?.hidden,
        }))
        .catch(() => '诊断不可用');
      console.error('页面诊断：' + JSON.stringify(diagnostic));
    }
  })
  .finally(async () => {
    result.finishedAt = new Date().toISOString();
    if (context) await context.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'GlassNote-真实网站验收.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(`结果文件：${path.join(outputDir, 'GlassNote-真实网站验收.json')}`);
  });
