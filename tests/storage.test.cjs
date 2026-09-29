const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/shared/model.js');
const { createRepository } = require('../src/background/repository.js');
function fakeStorage(initial = {}) {
  const data = structuredClone(initial);
  let fail = false;
  return {
    data,
    failNextWrite() {
      fail = true;
    },
    async get(key) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return structuredClone(key === null ? data : { [key]: data[key] });
    },
    async set(values) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (fail) {
        fail = false;
        throw new Error('QUOTA_BYTES');
      }
      Object.assign(data, structuredClone(values));
    },
  };
}
const url = 'https://example.org/read?id=2';
const record = (id, text = '阅读时的灵感') => ({
  id,
  text,
  content: '',
  type: 'highlight',
  color: 'yellow',
  anchor: { quote: { exact: text, prefix: '前文', suffix: '后文' } },
});
test('统一追踪参数和章节锚点，保留业务查询与 SPA 路由', () => {
  assert.equal(M.canonicalUrl(url + '&utm_source=mail#chapter'), url);
  assert.notEqual(M.canonicalUrl(url), M.canonicalUrl('https://example.org/read?id=3'));
  assert.notEqual(M.canonicalUrl(url + '#/page1'), M.canonicalUrl(url + '#/page2'));
  assert.throws(() => M.canonicalUrl('javascript:alert(1)'));
  assert.throws(() => M.canonicalUrl('https://user:pass@example.org'));
});
test('旧标注和便签迁移，旧数据原样保留，删除后不复活', async () => {
  const legacy = {
    annotations: [record('a')],
    notes: [
      { id: 'note-old', selectedText: '旧原文', content: '旧便签', timestamp: 1700000000000 },
    ],
  };
  const storage = fakeStorage({ [url + '&utm_source=mail#one']: legacy });
  const repo = createRepository(storage);
  const page = await repo.dispatch('getPage', { url });
  assert.equal(page.annotations.length, 2);
  assert.equal(page.annotations[1].type, 'note');
  assert.equal(page.annotations[1].content, '旧便签');
  assert.deepEqual(storage.data[url + '&utm_source=mail#one'], legacy);
  await repo.dispatch('clearPage', { url });
  assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 0);
  assert.equal((await repo.dispatch('listPages')).length, 0);
});
test('并发创建和便签编辑不会互相覆盖', async () => {
  const repo = createRepository(fakeStorage());
  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      repo.dispatch('upsert', { url, title: '并发测试', annotation: record('id-' + index) }),
    ),
  );
  assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 30);
  await Promise.all([
    repo.dispatch('upsert', {
      url,
      annotation: { ...record('id-0'), content: '新增思考', type: 'note' },
    }),
    repo.dispatch('remove', { url, id: 'id-1' }),
  ]);
  const page = await repo.dispatch('getPage', { url });
  assert.equal(page.annotations.length, 29);
  assert.equal(page.annotations.find((item) => item.id === 'id-0').content, '新增思考');
});
test('存储失败真实拒绝，后续操作仍然可继续', async () => {
  const storage = fakeStorage();
  const repo = createRepository(storage);
  storage.failNextWrite();
  await assert.rejects(repo.dispatch('upsert', { url, annotation: record('fail') }), /QUOTA/);
  assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 0);
  await repo.dispatch('upsert', { url, annotation: record('good') });
  assert.equal((await repo.dispatch('getPage', { url })).annotations[0].id, 'good');
});
test('设置延续旧 enabled 值，合法设置统一持久化', async () => {
  const repo = createRepository(fakeStorage(), fakeStorage({ enabled: false }));
  assert.deepEqual(await repo.dispatch('getSettings'), {
    enabled: false,
    autoRestore: true,
    defaultColor: 'yellow',
  });
  await repo.dispatch('setSettings', { patch: { enabled: true, defaultColor: 'pink' } });
  assert.equal((await repo.dispatch('getSettings')).defaultColor, 'pink');
});
test('备份导出再导入保留锚点与便签，重复导入不覆盖编辑', async () => {
  const first = createRepository(fakeStorage());
  const annotation = {
    ...record('note'),
    type: 'note',
    content: '<script>这只是笔记文本</script>',
  };
  await first.dispatch('upsert', { url, title: '书签页', annotation });
  const payload = await first.dispatch('exportData');
  const second = createRepository(fakeStorage());
  assert.deepEqual(await second.dispatch('importData', { payload }), { pages: 1, annotations: 1 });
  let page = await second.dispatch('getPage', { url });
  assert.deepEqual(page.annotations[0].anchor, annotation.anchor);
  assert.equal(page.annotations[0].content, annotation.content);
  await second.dispatch('upsert', {
    url,
    annotation: { ...page.annotations[0], content: '本地新编辑' },
  });
  assert.equal((await second.dispatch('importData', { payload })).annotations, 0);
  page = await second.dispatch('getPage', { url });
  assert.equal(page.annotations[0].content, '本地新编辑');
});
test('v2 导入兼容独立 notes 数组和 elements', async () => {
  const repo = createRepository(fakeStorage());
  const payload = {
    version: '2.0.0',
    data: {
      [url]: {
        elements: [record('h')],
        notes: [{ id: 'n', content: '便签内容', selectedText: '摘录' }],
      },
    },
  };
  assert.equal((await repo.dispatch('importData', { payload })).annotations, 2);
});
test('损坏备份整份拒绝，不部分写入', async () => {
  const storage = fakeStorage();
  const repo = createRepository(storage);
  const payload = {
    format: 'glassnote',
    version: 3,
    pages: [
      { url, annotations: [record('ok')] },
      { url: 'javascript:alert(1)', annotations: [record('bad')] },
    ],
  };
  await assert.rejects(repo.dispatch('importData', { payload }));
  assert.deepEqual(storage.data, {});
  await assert.rejects(
    repo.dispatch('importData', {
      payload: { format: 'glassnote', version: 3, pages: [{ url, annotations: 'not-array' }] },
    }),
  );
  assert.deepEqual(storage.data, {});
});
test('同一备份内相同页面合并，导入与写入并发不丢失', async () => {
  const repo = createRepository(fakeStorage());
  await Promise.all([
    repo.dispatch('importData', {
      payload: {
        format: 'glassnote',
        version: 3,
        pages: [
          { url, annotations: [record('a')] },
          { url, annotations: [record('b')] },
        ],
      },
    }),
    repo.dispatch('upsert', { url, annotation: record('c') }),
  ]);
  assert.deepEqual((await repo.dispatch('getPage', { url })).annotations.map((a) => a.id).sort(), [
    'a',
    'b',
    'c',
  ]);
});
test('拒绝原型属性作为操作', async () => {
  await assert.rejects(createRepository(fakeStorage()).dispatch('toString'), /未知/);
});
test('仅有旧便签的页面沿用便签内的标题和时间', () => {
  const page = M.normalizePage(
    {
      notes: [
        {
          selectedText: '原文',
          content: '想法',
          pageTitle: '原文章标题',
          timestamp: 1700000000000,
        },
      ],
    },
    url,
  );
  assert.equal(page.title, '原文章标题');
  assert.equal(page.updatedAt, '2023-11-14T22:13:20.000Z');
});
test('旧备份损坏的 elements 与过长摘录拒绝导入，不静默截断', async () => {
  const repo = createRepository(fakeStorage());
  await assert.rejects(
    repo.dispatch('importData', {
      payload: { version: '2.0.0', data: { [url]: { elements: '损坏列表' } } },
    }),
    /列表格式/,
  );
  await assert.rejects(
    repo.dispatch('importData', {
      payload: {
        version: '2.0.0',
        data: { [url]: { notes: [{ selectedText: '字'.repeat(100001), content: '便签' }] } },
      },
    }),
    /100000/,
  );
});
