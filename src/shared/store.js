/* 所有数据写入交给后台串行处理，避免多个标签页互相覆盖。 */
(() => {
  'use strict';
  if (globalThis.GNStore) return;
  function canonicalUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol))
      throw new Error('此页面不支持网页笔记');
    if (url.username || url.password) throw new Error('不支持包含账号密码的网页地址');
    for (const name of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(name) || /^(fbclid|gclid|dclid|msclkid)$/i.test(name))
        url.searchParams.delete(name);
    }
    // 保留 SPA hash 路由；普通目录锚点仍属于同一篇文章。
    if (!/^#(?:\/|!)/.test(url.hash)) url.hash = '';
    return url.href;
  }
  async function call(method, args = {}) {
    let result;
    try {
      result = await chrome.runtime.sendMessage({ channel: 'glassnote:store', method, args });
    } catch (error) {
      if (/context invalidated|Receiving end|connection/i.test(error.message)) {
        throw new Error('扩展已更新，请刷新网页后重试。尚未保存的笔记请先复制。');
      }
      throw error;
    }
    if (!result?.ok) throw new Error(result?.error || '保存服务暂时不可用，请重试');
    return result.data;
  }
  const api = Object.freeze({
    canonicalUrl,
    getPage: (url) => call('getPage', { url }),
    listPages: () => call('listPages'),
    upsert: (url, title, annotation) => call('upsert', { url, title, annotation }),
    remove: (url, id) => call('remove', { url, id }),
    clearPage: (url) => call('clearPage', { url }),
    getSettings: () => call('getSettings'),
    setSettings: (patch) => call('setSettings', { patch }),
    exportData: () => call('exportData'),
    importData: (payload) => call('importData', { payload }),
  });
  globalThis.GNStore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
