const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const shots = process.env.GN_SCREENSHOT_DIR || path.join(root, 'test-results');
let context, worker, server, base, extensionId, page;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glassnote-e2e-'));
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
  });
  context.setDefaultTimeout(8000);
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
}
const errors = [];
async function eventually(check, label, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.fail(`${label}：等待超时 (${JSON.stringify(last)})`);
}
async function store(method, args = {}) {
  return worker.evaluate(async ({ method, args }) => repository.dispatch(method, args), {
    method,
    args,
  });
}
async function tabId(target = page) {
  const tabs = await worker.evaluate(() => chrome.tabs.query({}));
  return tabs.find((tab) => tab.url === target.url())?.id || tabs.at(-1).id;
}
async function send(message, target = page) {
  return worker.evaluate(({ id, message }) => chrome.tabs.sendMessage(id, message), {
    id: await tabId(target),
    message,
  });
}
async function status() {
  return send({ action: 'getStatus' });
}
async function openArticle(suffix = '/article') {
  if (page) await page.close();
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + suffix);
  await page.locator('#glassnote-root').waitFor();
  await eventually(async () => (await status()).success, '扩展就绪');
  return page;
}
async function select(selector) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.evaluate((selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, selector);
  await page.locator('.selection-toolbar').waitFor({ state: 'visible' });
}
before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(path.join(__dirname, 'fixtures/article.html')));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(shots, { recursive: true });
  await launch();
});
after(async () => {
  if (context) await context.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(profile, { recursive: true, force: true });
});

test('真实扩展：跨节点标注不破坏链接，隐藏保留原文，刷新和关页重开恢复', async () => {
  await openArticle();
  const beforeHTML = await page.locator('#linked').innerHTML();
  await page.evaluate(() => {
    window.savedLink = document.querySelector('#original-link');
    window.savedLink.addEventListener('click', () => {
      window.originalClicked = true;
    });
  });
  await select('#linked');
  await page.getByRole('button', { name: '高亮', exact: true }).click();
  await eventually(async () => (await status()).restored === 1, '第一次标注恢复');
  assert.equal(await page.locator('#linked').innerHTML(), beforeHTML);
  assert.equal(
    await page.evaluate(() => window.savedLink === document.querySelector('#original-link')),
    true,
  );
  await send({ action: 'toggle', enabled: false });
  assert.equal(await page.locator('#linked').isVisible(), true);
  assert.equal((await status()).enabled, false);
  await send({ action: 'toggle', enabled: true });
  await page.locator('#original-link').click();
  assert.equal(await page.evaluate(() => window.originalClicked), true);
  assert.equal((await status()).total, 1);
  await page.reload();
  await eventually(async () => (await status()).restored === 1, '刷新后恢复');
  await openArticle();
  await eventually(async () => (await status()).restored === 1, '关页重开恢复');
  assert.equal(await page.locator('#linked').innerHTML(), beforeHTML);
});

test('真实扩展：便签编辑、正文延迟出现、结构变化和消失时安全保留笔记', async () => {
  await select('#target');
  await page.getByRole('button', { name: '写笔记', exact: true }).click();
  await page
    .getByRole('textbox', { name: '笔记内容', exact: true })
    .fill('让阅读留下自己的思考。<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await eventually(
    async () => (await status()).total === 2 && (await status()).restored === 2,
    '笔记写入并恢复',
  );
  const saved = await store('getPage', { url: base + '/article' });
  assert.equal(saved.annotations.filter((item) => item.type === 'note').length, 1);
  assert.equal(await page.locator('#glassnote-root img').count(), 0);
  const original = await page.locator('#target').innerHTML();
  await page.evaluate(() => {
    document
      .querySelector('#target')
      .replaceChildren(document.createTextNode('这一段暂时还没有加载出来。'));
  });
  await eventually(async () => (await status()).unresolved === 1, '缺失原文提示待定位');
  assert.equal((await store('getPage', { url: base + '/article' })).annotations.length, 2);
  await page.evaluate((original) => {
    const wrapper = document.createElement('section');
    wrapper.innerHTML = original;
    document.querySelector('#target').replaceChildren(wrapper);
  }, original);
  await eventually(async () => (await status()).restored === 2, '异步原文和结构变化后重新定位');
  await send({
    action: 'focusAnnotation',
    id: saved.annotations.find((item) => item.type === 'note').id,
  });
  await page.screenshot({ path: path.join(shots, 'glassnote-reading.png') });
  await page.reload();
  await eventually(async () => (await status()).restored === 2, '便签重载定位');
});

test('真实扩展：SPA 路由隔离，返回旧文章恢复', async () => {
  await page.evaluate(() => history.pushState({}, '', '/other-article'));
  await eventually(
    async () => (await status()).url.endsWith('/other-article') && (await status()).total === 0,
    'SPA 新路由数据隔离',
  );
  await select('#quote');
  await page.getByRole('button', { name: '高亮', exact: true }).click();
  await eventually(async () => (await status()).total === 1, '新路由写入');
  await page.evaluate(() => history.back());
  await eventually(
    async () => (await status()).url.endsWith('/article') && (await status()).restored === 2,
    '返回旧路由恢复',
  );
});

test('真实扩展：关闭自动恢复后保持关闭，主动打开再恢复', async () => {
  await store('setSettings', { patch: { autoRestore: false } });
  await page.reload();
  await eventually(async () => (await status()).total === 2, '关闭自动恢复后的数据加载');
  await page.evaluate(() => {
    document.querySelector('#intro').append(document.createTextNode(' 页面又加载了一些文字。'));
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal((await status()).restored, 0);
  await send({ action: 'openPanel' });
  await eventually(async () => (await status()).restored === 2, '手动恢复');
  await store('setSettings', { patch: { autoRestore: true } });
});

test('真实扩展：跨标签页写入同步且不丢失', async () => {
  assert.equal(await page.locator('#glassnote-root').count(), 1);
  const second = await context.newPage();
  await second.goto(base + '/article');
  await second.locator('#glassnote-root').waitFor();
  await store('upsert', {
    url: base + '/article',
    title: '在信息的河流里，留住自己的思考',
    annotation: {
      id: 'cross-tab',
      type: 'note',
      text: '',
      content: '跨标签页同步验证',
      color: 'green',
    },
  });
  await eventually(
    async () =>
      (await send({ action: 'getStatus' }, second)).total === 3 && (await status()).total === 3,
    '跨标签页同步',
  );
  await second.close();
});

test('真实扩展：笔记库搜索、编辑、导出、导入、受限页状态与响应式界面', async () => {
  const library = await context.newPage();
  library.on('pageerror', (error) => errors.push(error.message));
  await library.goto(`chrome-extension://${extensionId}/src/library/library.html`);
  await eventually(
    async () => (await library.locator('body').innerText()).includes('跨标签页同步验证'),
    '笔记库真实数据',
  );
  await library.getByRole('searchbox', { name: '搜索笔记' }).fill('跨标签页同步验证');
  await eventually(
    async () => (await library.locator('#noteList button').count()) === 1,
    '搜索只返回匹配笔记',
  );
  await library.locator('#noteList button').first().click();
  await library.locator('#noteContent').fill('已在笔记库编辑，返回网页也能同步。');
  await library.locator('#saveBtn').click();
  await eventually(
    async () =>
      (await store('getPage', { url: base + '/article' })).annotations.find(
        (item) => item.id === 'cross-tab',
      ).content === '已在笔记库编辑，返回网页也能同步。',
    '编辑笔记保存',
  );
  await library.getByRole('searchbox', { name: '搜索笔记' }).fill('');
  const downloadEvent = library.waitForEvent('download');
  await library.locator('#exportBtn').click();
  const download = await downloadEvent;
  const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(backup.format, 'glassnote');
  assert.equal(
    backup.pages.reduce((count, item) => count + item.annotations.length, 0),
    4,
  );
  await library.locator('#importFile').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await eventually(
    async () => (await library.locator('#toast').innerText()).includes('已合并'),
    '导入完成提示',
  );
  assert.equal(
    (await store('listPages')).reduce((count, item) => count + item.annotations.length, 0),
    4,
  );
  await library.screenshot({ path: path.join(shots, 'glassnote-library.png'), fullPage: true });
  await library.setViewportSize({ width: 760, height: 960 });
  assert.equal(
    await library.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
  );
  await library.screenshot({
    path: path.join(shots, 'glassnote-library-narrow.png'),
    fullPage: true,
  });
  await library.setViewportSize({ width: 1440, height: 1000 });
  await library.locator('#settingsBtn').click();
  await library.locator('#settingColor').selectOption('blue');
  await library.locator('#saveSettingsBtn').click();
  await eventually(
    async () => (await store('getSettings')).defaultColor === 'blue',
    '偏好设置持久化',
  );
  // 删除确认目标固定：外部删除 A 后，即使列表自动改选 B，确认也不能删 B。
  await library.locator('#noteList button').filter({ hasText: '已在笔记库编辑' }).click();
  await library.locator('#deleteBtn').click();
  await store('remove', { url: base + '/article', id: 'cross-tab' });
  await eventually(
    async () => !(await library.locator('#noteContent').inputValue()).includes('已在笔记库编辑'),
    '外部删除触发详情刷新',
  );
  await library.locator('#confirmDeleteBtn').click();
  await library.locator('#deleteDialog').waitFor({ state: 'hidden' });
  assert.equal(
    (await store('listPages')).reduce((count, item) => count + item.annotations.length, 0),
    3,
  );
  // 明确选中的另一条记录正常删除，并同步到当前网页。
  await library.locator('#noteList button').filter({ hasText: '阅读不是记住所有内容' }).click();
  await library.locator('#deleteBtn').click();
  await library.locator('#confirmDeleteBtn').click();
  await eventually(
    async () => (await store('getPage', { url: base + '/other-article' })).annotations.length === 0,
    '确认删除目标记录',
  );
  await library.close();
  const popup = await context.newPage();
  popup.on('pageerror', (error) => errors.push(error.message));
  await popup.setViewportSize({ width: 400, height: 750 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await eventually(
    async () => !(await popup.locator('#pageStatus').innerText()).includes('正在读取'),
    '受限页弹窗加载',
  );
  assert.equal(await popup.locator('#highlightBtn').isDisabled(), true);
  assert.equal((await popup.locator('#pageStatus').innerText()).includes('不支持标注'), true);
  await popup.screenshot({
    path: path.join(shots, 'glassnote-popup-restricted.png'),
    fullPage: true,
  });
  await popup.close();
  assert.deepEqual(errors, []);
});

test('真实扩展：完全退出浏览器后重新启动，从磁盘恢复笔记与设置', async () => {
  const original = await store('getPage', { url: base + '/article' });
  assert.equal(original.annotations.length, 2);
  await context.close();
  page = null;
  await launch();
  await openArticle();
  await eventually(async () => (await status()).restored === 2, '浏览器重启恢复全部原文位置');
  assert.deepEqual(
    (await store('getPage', { url: base + '/article' })).annotations,
    original.annotations,
  );
  assert.equal((await store('getSettings')).defaultColor, 'blue');
});
