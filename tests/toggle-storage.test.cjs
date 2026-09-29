'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../src/shared/model.js');
const { createRepository } = require('../src/background/repository.js');

const url = 'https://example.org/reading?chapter=2';
const key = M.PAGE_PREFIX + url;
const oldTime = '2025-01-01T00:00:00.000Z';
function anchor(start = 20) {
  return {
    version: 3,
    quote: {
      exact: '值得留下的文字',
      prefix: '这是原文前面的内容。',
      suffix: '这是原文后面的内容。',
    },
    position: { start, end: start + '值得留下的文字'.length },
    document: { hash: 'document-fixture', length: 300 },
  };
}
function mark(id, patch = {}) {
  return {
    id,
    type: 'highlight',
    text: '值得留下的文字',
    content: '',
    color: 'yellow',
    anchor: anchor(),
    createdAt: oldTime,
    updatedAt: oldTime,
    ...patch,
  };
}
function createFixture(records = []) {
  const data = records.length
    ? {
        [key]: { schemaVersion: 3, url, title: '原页面', updatedAt: oldTime, annotations: records },
      }
    : {};
  let fail = false;
  let writes = 0;
  const storage = {
    data: structuredClone(data),
    get writes() {
      return writes;
    },
    failNextWrite() {
      fail = true;
    },
    async get(key) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return structuredClone(key === null ? this.data : { [key]: this.data[key] });
    },
    async set(values) {
      writes++;
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (fail) {
        fail = false;
        throw new Error('QUOTA_BYTES');
      }
      Object.assign(this.data, structuredClone(values));
    },
  };
  const repo = createRepository(storage);
  return {
    storage,
    repo,
    toggle: (annotation, matchingIds = [], colorAction = false) =>
      repo.dispatch('toggleMark', {
        url,
        title: '更新后的页面',
        annotation,
        matchingIds,
        colorAction,
      }),
  };
}

test('同一选区双次点击普通样式按钮，先添加再取消且每次仅写一次', async () => {
  const { toggle, storage } = createFixture();
  const first = await toggle(mark('fresh-1'));
  assert.equal(first.action, 'added');
  assert.equal(first.page.annotations.length, 1);
  assert.equal(first.page.title, '更新后的页面');
  const second = await toggle(mark('fresh-2'));
  assert.equal(second.action, 'removed');
  assert.deepEqual(second.page.annotations, []);
  assert.equal(storage.writes, 2);
});

test('普通样式按钮取消时不要求颜色一致', async () => {
  const { toggle } = createFixture([mark('old', { color: 'blue' })]);
  const result = await toggle(mark('fresh', { color: 'pink' }));
  assert.equal(result.action, 'removed');
  assert.equal(result.page.annotations.length, 0);
});

test('颜色按钮再次点击同色取消，换成不同颜色更新原记录', async () => {
  const { toggle } = createFixture([mark('original', { color: 'yellow', content: '自己的想法' })]);
  const changed = await toggle(mark('fresh', { color: 'green' }), [], true);
  assert.equal(changed.action, 'updated');
  assert.equal(changed.page.annotations.length, 1);
  const updated = changed.page.annotations[0];
  assert.equal(updated.id, 'original');
  assert.equal(updated.color, 'green');
  assert.equal(updated.content, '自己的想法');
  assert.equal(updated.createdAt, oldTime);
  assert.notEqual(updated.updatedAt, oldTime);
  const cancelled = await toggle(mark('fresh-again', { color: 'green' }), [], true);
  assert.equal(cancelled.action, 'removed');
  assert.equal(cancelled.page.annotations[0].type, 'note');
  assert.equal(cancelled.page.annotations[0].content, '自己的想法');
});

test('旧重复格式在一次取消中全部去掉，带想法的记录转为笔记并原样保留定位证据', async () => {
  const records = [
    mark('pure-1'),
    mark('thought-1', { content: '第一条思考', color: 'blue' }),
    mark('pure-2'),
    mark('thought-2', { content: '第二条思考', color: 'pink' }),
  ];
  const { toggle, storage } = createFixture(records);
  const result = await toggle(mark('fresh'));
  assert.equal(result.action, 'removed');
  assert.equal(storage.writes, 1);
  assert.deepEqual(
    result.page.annotations.map((item) => item.id),
    ['thought-1', 'thought-2'],
  );
  for (const annotation of result.page.annotations) {
    const previous = records.find((item) => item.id === annotation.id);
    assert.equal(annotation.type, 'note');
    assert.equal(annotation.content, previous.content);
    assert.equal(annotation.text, previous.text);
    assert.equal(annotation.createdAt, previous.createdAt);
    assert.deepEqual(annotation.anchor, previous.anchor);
  }
});

test('重复样式换色仅保留首个格式，其余纯格式删除、想法转为独立笔记', async () => {
  const records = [
    mark('first', { color: 'yellow', content: '首条想法' }),
    mark('extra-pure', { color: 'green' }),
    mark('extra-note', { color: 'blue', content: '不要丢掉这条想法' }),
  ];
  const { toggle, storage } = createFixture(records);
  const result = await toggle(mark('fresh', { color: 'pink' }), [], true);
  assert.equal(result.action, 'updated');
  assert.equal(storage.writes, 1);
  assert.deepEqual(
    result.page.annotations.map((item) => [item.id, item.type, item.color]),
    [
      ['first', 'highlight', 'pink'],
      ['extra-note', 'note', 'blue'],
    ],
  );
  assert.equal(result.page.annotations[0].createdAt, oldTime);
  assert.equal(result.page.annotations[0].content, '首条想法');
  assert.equal(result.page.annotations[1].content, '不要丢掉这条想法');
});

test('重复记录颜色不一致时点击其中一种颜色，应统一颜色而不是全部取消', async () => {
  const { toggle } = createFixture([mark('yellow'), mark('blue', { color: 'blue' })]);
  const result = await toggle(mark('fresh', { color: 'yellow' }), [], true);
  assert.equal(result.action, 'updated');
  assert.equal(result.page.annotations.length, 1);
  assert.equal(result.page.annotations[0].color, 'yellow');
});

test('同选区的高亮、下划线、强调与独立笔记互不取消', async () => {
  const { toggle } = createFixture([
    mark('highlight'),
    mark('underline', { type: 'underline' }),
    mark('bold', { type: 'bold' }),
    mark('note', { type: 'note', content: '已有笔记' }),
  ]);
  const result = await toggle(mark('fresh', { type: 'underline' }), [
    'highlight',
    'underline',
    'bold',
    'note',
  ]);
  assert.equal(result.action, 'removed');
  assert.deepEqual(
    result.page.annotations.map((item) => item.id),
    ['highlight', 'bold', 'note'],
  );
});

test('当前 DOM 精确匹配的 ID 能取消旧定位证据，完整新锚点还能命中并发增加的记录', async () => {
  const { toggle } = createFixture([
    mark('legacy', { anchor: null, domPath: 'p.old' }),
    mark('current'),
    mark('elsewhere', { anchor: anchor(120) }),
  ]);
  const result = await toggle(mark('fresh'), ['legacy']);
  assert.equal(result.action, 'removed');
  assert.deepEqual(
    result.page.annotations.map((item) => item.id),
    ['elsewhere'],
  );
});

test('两个无锚点或不完整的锚点不能仅凭同文互相取消', async () => {
  for (const savedAnchor of [undefined, null, {}, { quote: { exact: '值得留下的文字' } }]) {
    const { toggle } = createFixture([mark('original', { anchor: savedAnchor })]);
    const result = await toggle(mark('fresh', { anchor: savedAnchor }));
    assert.equal(result.action, 'added');
    assert.equal(result.page.annotations.length, 2);
  }
});

test('完整定位证据有任一字段不一致时不合并，相同原文的不同位置独立保存', async () => {
  const variants = [
    (value) => {
      value.quote.exact += '不同';
    },
    (value) => {
      value.quote.prefix += '不同';
    },
    (value) => {
      value.quote.suffix += '不同';
    },
    (value) => {
      value.position.start++;
    },
    (value) => {
      value.position.end++;
    },
    (value) => {
      value.document.hash += '不同';
    },
    (value) => {
      value.document.length++;
    },
  ];
  for (const modify of variants) {
    const different = anchor();
    modify(different);
    const { toggle } = createFixture([mark('original')]);
    const result = await toggle(mark('fresh', { anchor: different }));
    assert.equal(result.action, 'added');
    assert.equal(result.page.annotations.length, 2);
  }
});

test('取消格式不会静默删除已有 content，即使正文只有空白也保留', async () => {
  const { toggle } = createFixture([mark('note', { content: ' \n ' })]);
  const result = await toggle(mark('fresh'));
  assert.equal(result.page.annotations[0].type, 'note');
  assert.equal(result.page.annotations[0].content, ' \n ');
});

test('并发切换使用后台最新状态，同选区成对操作不会产生重复或残留', async () => {
  const { toggle, repo } = createFixture();
  const operations = Array.from({ length: 20 }, (_, index) => toggle(mark(`parallel-${index}`)));
  const results = await Promise.all(operations);
  assert.deepEqual(
    results.map((item) => item.action),
    Array.from({ length: 20 }, (_, index) => (index % 2 ? 'removed' : 'added')),
  );
  assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 0);
  await Promise.all([
    toggle(mark('highlight')),
    toggle(mark('underline', { type: 'underline' })),
    repo.dispatch('upsert', {
      url,
      annotation: mark('independent-note', { type: 'note', content: '并发笔记' }),
    }),
  ]);
  assert.deepEqual(
    (await repo.dispatch('getPage', { url })).annotations.map((item) => item.type).sort(),
    ['highlight', 'note', 'underline'],
  );
});

test('配额失败时去重、取消、转笔记均不部分落盘，队列可继续执行', async () => {
  for (const colorAction of [false, true]) {
    const { toggle, storage, repo } = createFixture([
      mark('pure'),
      mark('thought', { content: '不能丢失的正文' }),
    ]);
    const before = structuredClone(storage.data);
    storage.failNextWrite();
    await assert.rejects(toggle(mark('fresh', { color: 'pink' }), [], colorAction), /QUOTA/);
    assert.deepEqual(storage.data, before);
    assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 2);
    const result = await toggle(mark('retry', { color: 'pink' }), [], colorAction);
    assert.equal(result.action, colorAction ? 'updated' : 'removed');
    assert.equal(storage.writes, 2);
  }
});

test('新增配额失败与非法参数不落盘，不允许将其他类型或冲突 ID 作为格式覆盖', async () => {
  const { toggle, storage } = createFixture([
    mark('same-id', { type: 'note', content: '保留正文' }),
  ]);
  const before = structuredClone(storage.data);
  await assert.rejects(toggle(mark('invalid', { type: 'note' })), /只能切换/);
  await assert.rejects(toggle(mark('fresh'), 'wrong'), /格式/);
  await assert.rejects(toggle(mark('fresh'), [null]), /格式/);
  await assert.rejects(toggle(mark('fresh'), [], 'yes'), /格式/);
  await assert.rejects(toggle(mark('same-id')), /标识已存在/);
  assert.equal(storage.writes, 0);
  storage.failNextWrite();
  await assert.rejects(toggle(mark('fresh')), /QUOTA/);
  assert.deepEqual(storage.data, before);
});

test('GNStore toggleMark 按 RPC 契约传参、返回确认结果并传播后台失败', async () => {
  const messages = [];
  const result = { page: { url, annotations: [] }, action: 'removed' };
  let fail = false;
  const context = vm.createContext({
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          return fail ? { ok: false, error: '本地存储空间不足' } : { ok: true, data: result };
        },
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/store.js'), 'utf8'), context);
  assert.deepEqual(
    await context.GNStore.toggleMark(url, '测试', mark('new'), ['old'], true),
    result,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
    channel: 'glassnote:store',
    method: 'toggleMark',
    args: { url, title: '测试', annotation: mark('new'), matchingIds: ['old'], colorAction: true },
  });
  await context.GNStore.toggleMark(url, '默认', mark('new'));
  assert.deepEqual(JSON.parse(JSON.stringify(messages[1].args.matchingIds)), []);
  assert.equal(messages[1].args.colorAction, false);
  fail = true;
  await assert.rejects(context.GNStore.toggleMark(url, '失败', mark('new')), /存储空间不足/);
});

test('格式取消转为笔记后，旧编辑器只改正文而不会复活格式或旧锚点', async () => {
  const stored = mark('editing', { content: '原来的想法', color: 'blue' });
  const { repo, toggle, storage } = createFixture([stored]);
  const cancelled = await toggle(mark('cancel'));
  assert.equal(cancelled.page.annotations[0].type, 'note');
  const updated = await repo.dispatch('updateNote', {
    url,
    id: 'editing',
    patch: {
      content: '继续补充的想法',
      type: 'highlight',
      anchor: { quote: { exact: '旧锚点不能覆盖' } },
      createdAt: '2000-01-01',
    },
  });
  assert.equal(updated.annotations[0].type, 'note');
  assert.equal(updated.annotations[0].id, 'editing');
  assert.equal(updated.annotations[0].content, '继续补充的想法');
  assert.equal(updated.annotations[0].color, 'blue');
  assert.equal(updated.annotations[0].createdAt, oldTime);
  assert.deepEqual(updated.annotations[0].anchor, stored.anchor);
  assert.equal(storage.writes, 2);
});

test('编辑器没改颜色时沿用并发换色的最新值，明确改色时才覆盖', async () => {
  const { repo, toggle } = createFixture([mark('editing', { content: '原想法' })]);
  await Promise.all([
    toggle(mark('change-color', { color: 'green' }), [], true),
    repo.dispatch('updateNote', { url, id: 'editing', patch: { content: '新想法' } }),
  ]);
  let page = await repo.dispatch('getPage', { url });
  assert.equal(page.annotations[0].color, 'green');
  assert.equal(page.annotations[0].content, '新想法');
  page = await repo.dispatch('updateNote', {
    url,
    id: 'editing',
    patch: { content: '新想法', color: 'pink' },
  });
  assert.equal(page.annotations[0].color, 'pink');
});

test('记录已经删除或纯格式已取消时，旧编辑保存必须失败且不能重建记录', async () => {
  for (const operation of ['remove', 'toggleMark']) {
    const { repo, storage } = createFixture([mark('editing')]);
    await repo.dispatch(operation, { url, id: 'editing', annotation: mark('cancel') });
    const afterDelete = structuredClone(storage.data);
    await assert.rejects(
      repo.dispatch('updateNote', { url, id: 'editing', patch: { content: '旧编辑器草稿' } }),
      { message: '这条记录已被删除，请复制草稿后重新创建。' },
    );
    assert.deepEqual(storage.data, afterDelete);
    assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 0);
    assert.equal(storage.writes, 1);
  }
});

test('更新笔记配额失败时正文、颜色和元数据不变，重试成功后才替换', async () => {
  const { repo, storage } = createFixture([mark('editing', { content: '保存过的正文' })]);
  const before = structuredClone(storage.data);
  storage.failNextWrite();
  const request = { url, id: 'editing', patch: { content: '新的正文', color: 'blue' } };
  await assert.rejects(repo.dispatch('updateNote', request), /QUOTA/);
  assert.deepEqual(storage.data, before);
  const result = await repo.dispatch('updateNote', request);
  assert.equal(result.annotations[0].content, '新的正文');
  assert.equal(result.annotations[0].color, 'blue');
  assert.equal(result.annotations[0].createdAt, oldTime);
  assert.equal(storage.writes, 2);
});

test('更新笔记严格验证正文与颜色，空白的无选文页面笔记不能保存', async () => {
  const { repo, storage } = createFixture([
    mark('editing', { type: 'note', text: '', anchor: null, content: '独立页面笔记' }),
  ]);
  for (const patch of [
    null,
    {},
    { content: 1 },
    { content: '正常', color: 'unknown' },
    { content: '字'.repeat(100001) },
    { content: '   ' },
  ]) {
    await assert.rejects(repo.dispatch('updateNote', { url, id: 'editing', patch }));
  }
  assert.equal(storage.writes, 0);
});

test('GNStore updateNote 仅发送补丁，不在前端读取或重建记录', async () => {
  const messages = [];
  const result = { url, annotations: [mark('editing', { type: 'note', content: '新正文' })] };
  const context = vm.createContext({
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          return { ok: true, data: result };
        },
      },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/shared/store.js'), 'utf8'), context);
  assert.deepEqual(await context.GNStore.updateNote(url, 'editing', { content: '新正文' }), result);
  assert.equal(messages.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(messages[0])), {
    channel: 'glassnote:store',
    method: 'updateNote',
    args: { url, id: 'editing', patch: { content: '新正文' } },
  });
});
