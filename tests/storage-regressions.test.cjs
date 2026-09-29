'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const M = require('../src/shared/model.js');
const { createRepository } = require('../src/background/repository.js');

test('真实 v2 的 orange-underline 标注可迁移和导入，仍保持下划线类型', () => {
  const url = 'https://example.org/legacy';
  const old = { id: 'old-orange', type: 'orange-underline', text: '旧版橙色下划线原文' };
  assert.equal(M.normalizeAnnotation(old).type, 'underline');
  const imported = M.parseImport({ version: '2.0.0', data: { [url]: { annotations: [old] } } });
  assert.equal(imported[0].annotations[0].type, 'underline');
  assert.equal(imported[0].annotations[0].text, old.text);
});

test('升级读取旧笔记不依赖剩余存储空间；真正写入配额失败仍明确拒绝', async () => {
  const url = 'https://example.org/at-quota';
  const legacy = { annotations: [{ id: 'saved', type: 'highlight', text: '已经保存的旧笔记' }] };
  const data = { [url]: legacy };
  let writes = 0;
  const storage = {
    async get(key) {
      return structuredClone(key === null ? data : { [key]: data[key] });
    },
    async set() {
      writes += 1;
      throw new Error('QUOTA_BYTES');
    },
  };
  const repo = createRepository(storage);
  const page = await repo.dispatch('getPage', { url });
  assert.equal(page.annotations[0].text, legacy.annotations[0].text);
  assert.equal(writes, 0);
  await assert.rejects(
    repo.dispatch('upsert', {
      url,
      annotation: { id: 'new', text: '本次新增笔记', type: 'highlight' },
    }),
    /QUOTA/,
  );
  assert.equal(writes, 1);
  assert.deepEqual(data[url], legacy);
  assert.equal((await repo.dispatch('getPage', { url })).annotations.length, 1);
});
