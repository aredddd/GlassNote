'use strict';
importScripts('../shared/store.js', '../shared/model.js', 'repository.js');
const repository = GNRepository.createRepository(chrome.storage.local, chrome.storage.sync);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.channel !== 'glassnote:store' || sender.id !== chrome.runtime.id) return;
  repository.dispatch(message.method, message.args).then(
    (data) => sendResponse({ ok: true, data }),
    (error) =>
      sendResponse({
        ok: false,
        error: /quota/i.test(error.message)
          ? '本地存储空间不足，请导出备份并整理旧笔记后重试。'
          : error.message,
      }),
  );
  return true;
});
