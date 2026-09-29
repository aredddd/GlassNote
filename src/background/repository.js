(() => {
  'use strict';
  const M = globalThis.GNModel || require('../shared/model.js');
  const MARK_TYPES = new Set(['highlight', 'underline', 'bold']);
  function completeAnchor(anchor) {
    const { quote, position, document } = anchor || {};
    return (
      M.isObject(anchor) &&
      M.isObject(quote) &&
      typeof quote.exact === 'string' &&
      !!quote.exact.length &&
      typeof quote.prefix === 'string' &&
      typeof quote.suffix === 'string' &&
      M.isObject(position) &&
      Number.isInteger(position.start) &&
      position.start >= 0 &&
      Number.isInteger(position.end) &&
      position.end > position.start &&
      M.isObject(document) &&
      typeof document.hash === 'string' &&
      !!document.hash.length &&
      Number.isInteger(document.length) &&
      document.length >= position.end
    );
  }
  function sameAnchor(first, second) {
    // 缺失定位字段不能互相作证；旧记录由内容脚本提供精确选区匹配的 ID。
    if (!completeAnchor(first) || !completeAnchor(second)) return false;
    return (
      first.quote.exact === second.quote.exact &&
      first.quote.prefix === second.quote.prefix &&
      first.quote.suffix === second.quote.suffix &&
      first.position.start === second.position.start &&
      first.position.end === second.position.end &&
      first.document.hash === second.document.hash &&
      first.document.length === second.document.length
    );
  }
  function createRepository(storage, sync) {
    let queue = Promise.resolve();
    async function getPage(rawUrl) {
      const url = M.canonicalUrl(rawUrl);
      const key = M.PAGE_PREFIX + url;
      const current = (await storage.get(key))[key];
      if (current) return M.normalizePage(current, url);
      const old = M.pagesFromStorage(await storage.get(null)).find((page) => page.url === url);
      // 读取不依赖迁移写入成功：配额满时旧笔记也必须能被找回。
      if (old) return old;
      return M.normalizePage({}, url);
    }
    async function getSettings() {
      const current = (await storage.get(M.SETTINGS_KEY))[M.SETTINGS_KEY];
      if (current) return M.settings(current);
      const legacy = sync ? await sync.get('enabled') : {};
      return M.settings(legacy);
    }
    const methods = {
      getPage: ({ url }) => getPage(url),
      listPages: async () =>
        M.pagesFromStorage(await storage.get(null)).filter((page) => page.annotations.length),
      getSettings,
      setSettings: async ({ patch }) => {
        if (!M.isObject(patch)) throw new Error('设置格式不正确');
        const value = M.settings({ ...(await getSettings()), ...patch });
        await storage.set({ [M.SETTINGS_KEY]: value });
        return value;
      },
      upsert: async ({ url, title, annotation }) => {
        const page = await getPage(url);
        const record = M.normalizeAnnotation(annotation, 0, true);
        const index = page.annotations.findIndex((item) => item.id === record.id);
        const now = new Date().toISOString();
        record.createdAt = index >= 0 ? page.annotations[index].createdAt : now;
        record.updatedAt = now;
        if (index >= 0) page.annotations[index] = record;
        else page.annotations.push(record);
        page.updatedAt = now;
        if (typeof title === 'string' && title.trim()) page.title = title.slice(0, 1000);
        await storage.set({ [M.PAGE_PREFIX + page.url]: page });
        return page;
      },
      toggleMark: async ({ url, title, annotation, matchingIds = [], colorAction = false }) => {
        if (!MARK_TYPES.has(annotation?.type)) throw new Error('只能切换高亮、下划线或强调样式');
        if (!Array.isArray(matchingIds) || matchingIds.some((id) => typeof id !== 'string'))
          throw new Error('选区匹配信息格式不正确');
        if (typeof colorAction !== 'boolean') throw new Error('颜色操作格式不正确');
        const record = M.normalizeAnnotation(annotation, 0, true);
        const page = await getPage(url);
        const ids = new Set(matchingIds);
        const matches = page.annotations.filter(
          (item) =>
            item.type === record.type &&
            (ids.has(item.id) || sameAnchor(item.anchor, record.anchor)),
        );
        const now = new Date().toISOString();
        let action;
        if (!matches.length) {
          if (page.annotations.some((item) => item.id === record.id))
            throw new Error('标注标识已存在，请重新选择文字后重试');
          record.createdAt = now;
          record.updatedAt = now;
          page.annotations.push(record);
          action = 'added';
        } else {
          const cancel = !colorAction || matches.every((item) => item.color === record.color);
          const matchedIds = new Set(matches.map((item) => item.id));
          const keeperId = cancel ? null : matches[0].id;
          page.annotations = page.annotations.flatMap((item) => {
            if (!matchedIds.has(item.id)) return [item];
            if (item.id === keeperId) return [{ ...item, color: record.color, updatedAt: now }];
            // 取消格式只移除视觉样式，已写下的想法仍以原来的 ID 和锚点保留。
            if (item.content.length) return [{ ...item, type: 'note', updatedAt: now }];
            return [];
          });
          action = cancel ? 'removed' : 'updated';
        }
        page.updatedAt = now;
        if (typeof title === 'string' && title.trim()) page.title = title.slice(0, 1000);
        // 整个选区的去重、取消与笔记保留只写一次；失败不会返回成功状态。
        await storage.set({ [M.PAGE_PREFIX + page.url]: page });
        return { page, action };
      },
      updateNote: async ({ url, id, patch }) => {
        if (!M.isObject(patch) || typeof patch.content !== 'string')
          throw new Error('笔记修改内容格式不正确');
        if (patch.color !== undefined && !M.COLORS.includes(patch.color))
          throw new Error('标注颜色格式不正确');
        const page = await getPage(url);
        const index = page.annotations.findIndex((item) => item.id === id);
        if (index < 0) throw new Error('这条记录已被删除，请复制草稿后重新创建。');
        const current = page.annotations[index];
        const now = new Date().toISOString();
        // 编辑器只能修改正文和明确改过的颜色，不能恢复旧样式或覆盖新的定位证据。
        const record = M.normalizeAnnotation(
          {
            ...current,
            content: patch.content,
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            updatedAt: now,
          },
          0,
          true,
        );
        record.createdAt = current.createdAt;
        page.annotations[index] = record;
        page.updatedAt = now;
        await storage.set({ [M.PAGE_PREFIX + page.url]: page });
        return page;
      },
      remove: async ({ url, id }) => {
        const page = await getPage(url);
        page.annotations = page.annotations.filter((item) => item.id !== id);
        page.updatedAt = new Date().toISOString();
        await storage.set({ [M.PAGE_PREFIX + page.url]: page });
        return page;
      },
      clearPage: async ({ url }) => {
        const page = await getPage(url);
        page.annotations = [];
        page.updatedAt = new Date().toISOString();
        await storage.set({ [M.PAGE_PREFIX + page.url]: page });
        return page;
      },
      exportData: async () => ({
        format: 'glassnote',
        version: 3,
        exportedAt: new Date().toISOString(),
        pages: await methods.listPages(),
        settings: await getSettings(),
      }),
      importData: async ({ payload }) => {
        // 整份文件先验证，避免导入中途失败留下半份数据。
        const incoming = M.parseImport(payload);
        const all = M.pagesFromStorage(await storage.get(null));
        const byUrl = new Map(all.map((page) => [page.url, page]));
        const writes = {};
        let annotations = 0;
        for (const imported of incoming) {
          const page = byUrl.get(imported.url) || { ...imported, annotations: [] };
          const ids = new Set(page.annotations.map((item) => item.id));
          for (const item of imported.annotations) {
            if (!ids.has(item.id)) {
              page.annotations.push(item);
              ids.add(item.id);
              annotations++;
            }
          }
          page.updatedAt = new Date().toISOString();
          byUrl.set(page.url, page);
          writes[M.PAGE_PREFIX + page.url] = page;
        }
        if (Object.keys(writes).length) await storage.set(writes);
        return { pages: Object.keys(writes).length, annotations };
      },
    };
    function dispatch(method, args = {}) {
      if (!Object.hasOwn(methods, method)) return Promise.reject(new Error('未知数据操作'));
      const operation = queue.then(() => methods[method](args));
      queue = operation.catch(() => {});
      return operation;
    }
    return Object.freeze({ dispatch });
  }
  globalThis.GNRepository = { createRepository };
  if (typeof module !== 'undefined') module.exports = { createRepository };
})();
