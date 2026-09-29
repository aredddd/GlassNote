'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const { chromium } = require('playwright');

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function setup(run, settings = {}) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 850 } });
  try {
    await page.route('http://glassnote.test/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head><title>阅读中的灵感</title></head><body><article id="reading"><h1>留下值得重读的片段</h1><p id="target">阅读不仅是在获取信息，也是在与自己的想法相遇。让这些文字成为新的思考起点。</p><p id="other">周围的段落用来帮助恢复原文位置，页面结构变化后也不应丢失这条记录。</p></article></body></html>',
      }),
    );
    await page.goto('http://glassnote.test/article');
    await page.addScriptTag({ path: path.join(__dirname, '../src/shared/anchor.js') });
    await page.evaluate((settings) => {
      window.testDB = {
        pages: {},
        settings: { enabled: true, autoRestore: true, defaultColor: 'yellow', ...settings },
        failSave: false,
        messages: [],
        changes: [],
      };
      window.chrome = {
        runtime: {
          onMessage: {
            addListener(fn) {
              testDB.messages.push(fn);
            },
          },
        },
        storage: {
          onChanged: {
            addListener(fn) {
              testDB.changes.push(fn);
            },
          },
        },
      };
      window.GNStore = {
        canonicalUrl: (url) => {
          const parsed = new URL(url);
          if (!parsed.hash.startsWith('#/')) parsed.hash = '';
          return parsed.href;
        },
        async getSettings() {
          return { ...testDB.settings };
        },
        async setSettings(patch) {
          Object.assign(testDB.settings, patch);
          return { ...testDB.settings };
        },
        async getPage(url) {
          return structuredClone(testDB.pages[url] || { url, annotations: [] });
        },
        async upsert(url, title, record) {
          if (testDB.failSave) throw new Error('测试存储已满');
          const page = (testDB.pages[url] ||= { url, title, annotations: [] });
          const index = page.annotations.findIndex((item) => item.id === record.id);
          if (index >= 0) page.annotations[index] = structuredClone(record);
          else page.annotations.push(structuredClone(record));
          return structuredClone(page);
        },
        async remove(url, id) {
          const page = testDB.pages[url];
          if (page) page.annotations = page.annotations.filter((item) => item.id !== id);
        },
        async clearPage(url) {
          delete testDB.pages[url];
        },
      };
    }, settings);
    await page.addScriptTag({ path: path.join(__dirname, '../src/shared/model.js') });
    await page.addScriptTag({ path: path.join(__dirname, '../src/background/repository.js') });
    await page.evaluate(() => {
      const repository = GNRepository.createRepository({
        async get(key) {
          const pages = Object.fromEntries(
            Object.entries(testDB.pages).map(([url, value]) => [`gn:page:${url}`, value]),
          );
          return structuredClone(key === null ? pages : { [key]: pages[key] });
        },
        async set(values) {
          if (testDB.failSave) throw new Error('测试存储已满');
          for (const [key, value] of Object.entries(values))
            testDB.pages[key.slice('gn:page:'.length)] = structuredClone(value);
        },
      });
      GNStore.toggleMark = (url, title, annotation, matchingIds, colorAction) =>
        repository.dispatch('toggleMark', { url, title, annotation, matchingIds, colorAction });
      GNStore.updateNote = (url, id, patch) =>
        repository.dispatch('updateNote', { url, id, patch });
    });
    await page.addStyleTag({ path: path.join(__dirname, '../styles/content.css') });
    await page.addScriptTag({ path: path.join(__dirname, '../src/content/content.js') });
    await page.evaluate(() => __glassNoteV3.ready);
    await run(page);
  } finally {
    await page.close();
  }
}

async function select(page) {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#target'));
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
    __glassNoteV3.readSelection();
  });
}

test('选文工具保存后绘制 CSS 高亮，隐藏时网页正文和布局 DOM 完全保留', async () => {
  await setup(async (page) => {
    const original = await page.locator('#reading').innerHTML();
    await select(page);
    await page.getByRole('button', { name: '高亮', exact: true }).click();
    await page.waitForFunction(() => __glassNoteV3.annotations.length === 1);
    assert.equal(await page.locator('#reading').innerHTML(), original);
    assert.equal(
      await page.evaluate(() => CSS.highlights.get('glassnote-highlight-yellow').size),
      1,
    );
    const status = await page.evaluate(() =>
      __glassNoteV3.handleMessage({ action: 'toggle', enabled: false }),
    );
    assert.equal(status.enabled, false);
    assert.equal(status.total, 1);
    assert.equal(status.unresolved, 0);
    assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
    assert.equal(await page.locator('#reading').innerHTML(), original);
    assert.match(await page.locator('#target').innerText(), /阅读不仅/);
  });
});

test('保存失败明确显示错误并保留原样草稿，重试成功后才关闭编辑器', async () => {
  await setup(async (page) => {
    await select(page);
    await page.getByRole('button', { name: '写笔记', exact: true }).click();
    const draft = '<img src=x onerror=alert(1)>\n想法应该保留成纯文字';
    await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill(draft);
    await page.evaluate(() => {
      testDB.failSave = true;
    });
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.waitForFunction(() =>
      __glassNoteV3.editor?.error.textContent.includes('测试存储已满'),
    );
    assert.equal(
      await page.getByRole('textbox', { name: '笔记内容', exact: true }).inputValue(),
      draft,
    );
    assert.equal(await page.evaluate(() => __glassNoteV3.annotations.length), 0);
    await page.evaluate(() => {
      testDB.failSave = false;
    });
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.waitForFunction(
      () => !__glassNoteV3.editor && __glassNoteV3.annotations.length === 1,
    );
    assert.equal(await page.locator('.note-content').innerText(), draft);
    assert.equal(await page.locator('#glassnote-root img').count(), 0);
  });
});

test('取消标注失败时保留选区、格式和按钮状态，成功重试后才取消', async () => {
  await setup(async (page) => {
    await select(page);
    const highlight = page.getByRole('button', { name: '高亮', exact: true });
    await highlight.click();
    await page.waitForFunction(
      () => !__glassNoteV3.savingSelection && __glassNoteV3.annotations.length === 1,
    );
    assert.equal(await highlight.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => {
      testDB.failSave = true;
    });
    await highlight.click();
    await page.waitForFunction(
      () =>
        !__glassNoteV3.savingSelection && __glassNoteV3.toast.textContent.includes('测试存储已满'),
    );
    assert.equal(await highlight.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => testDB.pages[location.href].annotations.length), 1);
    assert.equal(
      await page.evaluate(() => CSS.highlights.get('glassnote-highlight-yellow').size),
      1,
    );
    assert.equal(await page.evaluate(() => getSelection().isCollapsed), false);
    await page.evaluate(() => {
      testDB.failSave = false;
    });
    await highlight.click();
    await page.waitForFunction(
      () => !__glassNoteV3.savingSelection && __glassNoteV3.annotations.length === 0,
    );
    assert.equal(await highlight.getAttribute('aria-pressed'), 'false');
    assert.equal(
      await page.evaluate(() => CSS.highlights.has('glassnote-highlight-yellow')),
      false,
    );
  });
});

test('保存期间改选别处或收起工具栏，完成后不恢复旧选区和旧工具栏', async () => {
  await setup(async (page) => {
    await select(page);
    await page.evaluate(() => {
      const toggle = GNStore.toggleMark;
      GNStore.toggleMark = (...args) =>
        new Promise((resolve) => {
          window.completeToggle = async () => resolve(await toggle(...args));
        });
    });
    await page.getByRole('button', { name: '高亮', exact: true }).click();
    await page.waitForFunction(() => !!window.completeToggle);
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#other'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      __glassNoteV3.readSelection();
    });
    await page.evaluate(() => window.completeToggle());
    await page.waitForFunction(() => !__glassNoteV3.savingSelection);
    assert.match(await page.evaluate(() => getSelection().toString()), /^周围的段落/);
    assert.equal(
      await page.getByRole('button', { name: '高亮', exact: true }).getAttribute('aria-pressed'),
      'false',
    );
    await page.getByRole('button', { name: '下划线', exact: true }).click();
    await page.locator('h1').click();
    await page.evaluate(() => window.completeToggle());
    await page.waitForFunction(() => !__glassNoteV3.savingSelection);
    assert.equal(await page.locator('.selection-toolbar').isVisible(), false);
    assert.equal(await page.evaluate(() => getSelection().isCollapsed), true);
  });
});

test('旧编辑器保存保留其他标签页取消的格式，记录被删后不复活且草稿可复制', async () => {
  await setup(async (page) => {
    await select(page);
    await page.getByRole('button', { name: '高亮', exact: true }).click();
    await page.waitForFunction(
      () => !__glassNoteV3.savingSelection && __glassNoteV3.annotations.length === 1,
    );
    await page.evaluate(async () => {
      const record = __glassNoteV3.annotations[0];
      await GNStore.updateNote(location.href, record.id, { content: '最初的笔记' });
      await __glassNoteV3.loadPage();
      __glassNoteV3.openEditor(__glassNoteV3.annotations[0]);
      // 另一标签页取消同一格式，编辑器仍持有打开时的高亮记录。
      await GNStore.toggleMark(location.href, document.title, { ...record, id: 'another-tab' }, [
        record.id,
      ]);
    });
    await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill('修改后的笔记');
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.waitForFunction(() => !__glassNoteV3.editor);
    const saved = await page.evaluate(() => testDB.pages[location.href].annotations);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].type, 'note');
    assert.equal(saved[0].content, '修改后的笔记');
    await page.evaluate(async () => {
      __glassNoteV3.openEditor(__glassNoteV3.annotations[0]);
      await GNStore.remove(location.href, __glassNoteV3.annotations[0].id);
    });
    await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill('保留这个未保存草稿');
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.waitForFunction(() => __glassNoteV3.editor?.error.textContent.includes('已被删除'));
    assert.equal(
      await page.getByRole('textbox', { name: '笔记内容', exact: true }).inputValue(),
      '保留这个未保存草稿',
    );
    assert.equal(await page.evaluate(() => testDB.pages[location.href].annotations.length), 0);
  });
});

test('键盘改选后立即点击工具栏，使用当前选区而不是防抖前的旧选区', async () => {
  await setup(async (page) => {
    await select(page);
    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#other'));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      __glassNoteV3.toolbar.querySelector('[data-format="highlight"]').click();
    });
    await page.waitForFunction(
      () => !__glassNoteV3.savingSelection && __glassNoteV3.annotations.length === 1,
    );
    assert.match(await page.evaluate(() => __glassNoteV3.annotations[0].text), /^周围的段落/);
  });
});

test('关闭自动恢复后 DOM 变化也不会绕过设置，用户打开面板才恢复', async () => {
  await setup(
    async (page) => {
      await select(page);
      await page.getByRole('button', { name: '高亮', exact: true }).click();
      await page.waitForFunction(() => __glassNoteV3.annotations.length === 1);
      await page.evaluate(async () => {
        await __glassNoteV3.loadPage({ initial: true });
        document.querySelector('article').append(document.createElement('hr'));
      });
      await page.waitForTimeout(850);
      assert.equal(await page.evaluate(() => CSS.highlights.size), 0);
      assert.equal(await page.evaluate(() => __glassNoteV3.ranges.size), 0);
      await page.evaluate(() => __glassNoteV3.handleMessage({ action: 'openPanel' }));
      assert.equal(await page.evaluate(() => __glassNoteV3.ranges.size), 1);
    },
    { autoRestore: false },
  );
});

test('SPA 切换后清理原页范围，打开中的草稿仍保存回原页面', async () => {
  await setup(async (page) => {
    await select(page);
    await page.getByRole('button', { name: '写笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill('原页面的想法');
    await page.evaluate(async () => {
      history.pushState({}, '', '/next');
      document
        .querySelector('article')
        .replaceChildren(document.createTextNode('另一个页面的文章'));
      __glassNoteV3.checkRoute();
      await __glassNoteV3.pageLoad;
    });
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.waitForFunction(() => !__glassNoteV3.editor);
    const result = await page.evaluate(() => ({
      saved: testDB.pages['http://glassnote.test/article']?.annotations[0].content,
      current: __glassNoteV3.annotations.length,
      url: __glassNoteV3.url,
    }));
    assert.deepEqual(result, {
      saved: '原页面的想法',
      current: 0,
      url: 'http://glassnote.test/next',
    });
  });
});

test('重复注入不会出现多套控件或重复消息监听器，未保存关闭需要再次确认', async () => {
  await setup(async (page) => {
    await page.addScriptTag({ path: path.join(__dirname, '../src/content/content.js') });
    assert.equal(await page.locator('#glassnote-root').count(), 1);
    assert.equal(await page.evaluate(() => testDB.messages.length), 1);
    await page.evaluate(() => __glassNoteV3.handleMessage({ action: 'setMode', mode: 'note' }));
    await page.getByRole('textbox', { name: '笔记内容', exact: true }).fill('尚未保存');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.discard').isVisible(), true);
    assert.equal(
      await page.getByRole('textbox', { name: '笔记内容', exact: true }).inputValue(),
      '尚未保存',
    );
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    assert.equal(await page.locator('.editor').count(), 0);
  });
});
