(() => {
  'use strict';
  const M = globalThis.GNModel || require('../shared/model.js');
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
