(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const typeNames = { highlight: '高亮', underline: '下划线', bold: '加粗', note: '笔记' };
  let currentTab = null;
  let page = null;
  let supported = false;
  let refreshId = 0;
  let toastTimer;

  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      $('toast').hidden = true;
    }, 3600);
  }
  function openLibrary(settings = false) {
    return chrome.tabs.create({
      url: chrome.runtime.getURL(`src/library/library.html${settings ? '#settings' : ''}`),
    });
  }
  function isSupported(url) {
    try {
      const u = new URL(url);
      return (
        ['https:', 'http:', 'file:'].includes(u.protocol) &&
        u.hostname !== 'chromewebstore.google.com' &&
        !(u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))
      );
    } catch {
      return false;
    }
  }
  async function send(message) {
    if (!supported || !currentTab?.id)
      throw new Error('此页面无法标注，仍可在笔记库查看已保存的内容');
    let response;
    try {
      response = await chrome.tabs.sendMessage(currentTab.id, message);
    } catch (error) {
      if (!/Receiving end does not exist|Could not establish connection/i.test(error.message || ''))
        throw error;
      await chrome.scripting.insertCSS({
        target: { tabId: currentTab.id },
        files: ['styles/content.css'],
      });
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        files: ['src/shared/anchor.js', 'src/shared/store.js', 'src/content/content.js'],
      });
      response = await chrome.tabs.sendMessage(currentTab.id, message);
    }
    if (!response?.success) throw new Error(response?.error || '网页未响应，请刷新页面后重试');
    return response;
  }
  async function perform(button, message) {
    button.disabled = true;
    try {
      await send(message);
      window.close();
    } catch (error) {
      toast(error.message || '操作失败，请重试', true);
    } finally {
      button.disabled = !supported;
    }
  }
  function renderRecent(annotations) {
    const holder = $('recentNotes');
    holder.replaceChildren();
    document.querySelector('.recent-section').hidden = !annotations.length;
    $('recentCount').textContent = annotations.length ? `${annotations.length} 条已保存` : '';
    if (!annotations.length) return;
    [...annotations]
      .sort(
        (a, b) =>
          (Number(new Date(b.updatedAt || b.createdAt)) || 0) -
          (Number(new Date(a.updatedAt || a.createdAt)) || 0),
      )
      .slice(0, 2)
      .forEach((annotation) => {
        const item = document.createElement('button');
        item.className = `recent-item color-${['yellow', 'green', 'blue', 'pink'].includes(annotation.color) ? annotation.color : 'yellow'}`;
        const quote = document.createElement('p');
        quote.textContent = annotation.content || annotation.text || '未填写内容的笔记';
        const meta = document.createElement('small');
        const date = new Date(annotation.updatedAt || annotation.createdAt);
        meta.textContent = `${typeNames[annotation.type] || '标注'} · ${Number.isNaN(+date) ? '已保存' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date)}`;
        item.append(quote, meta);
        item.addEventListener('click', () =>
          supported
            ? perform(item, { action: 'focusAnnotation', id: annotation.id })
            : chrome.tabs.create({
                url: chrome.runtime.getURL(
                  `src/library/library.html?page=${encodeURIComponent(page.url)}&note=${encodeURIComponent(annotation.id)}`,
                ),
              }),
        );
        holder.append(item);
      });
  }
  async function refresh() {
    const id = ++refreshId;
    try {
      const storable = /^(https?|file):/.test(currentTab?.url || '');
      const [savedPage, settings] = await Promise.all([
        storable ? GNStore.getPage(currentTab.url) : null,
        GNStore.getSettings(),
      ]);
      if (id !== refreshId) return;
      page = savedPage;
      const annotations = page?.annotations || [];
      $('enableToggle').checked = settings.enabled;
      $('highlightCount').textContent = annotations.filter((a) => a.type !== 'note').length;
      $('noteCount').textContent = annotations.filter(
        (a) => a.type === 'note' || a.content?.trim(),
      ).length;
      $('totalCount').textContent = annotations.length;
      $('pageStatus').textContent = supported
        ? annotations.length
          ? `${annotations.length} 条内容已保存在此浏览器`
          : ''
        : '浏览器系统页不支持标注，可打开笔记库';
      document.querySelector('.page-status').hidden = !$('pageStatus').textContent;
      renderRecent(annotations);
    } catch (error) {
      $('pageStatus').textContent = '笔记读取失败，请重试';
      document.querySelector('.page-status').hidden = false;
      document.querySelector('.recent-section').hidden = false;
      $('recentNotes').replaceChildren();
      const retry = document.createElement('button');
      retry.className = 'button secondary';
      retry.textContent = '重新读取笔记';
      retry.addEventListener('click', refresh);
      $('recentNotes').append(retry);
      toast(error.message || '读取失败', true);
    }
  }
  async function init() {
    $('libraryBtn').addEventListener('click', () => openLibrary());
    $('brandLink').addEventListener('click', (event) => {
      event.preventDefault();
      openLibrary();
    });
    $('settingsBtn').addEventListener('click', () => openLibrary(true));
    $('highlightBtn').addEventListener('click', () =>
      perform($('highlightBtn'), { action: 'setMode', mode: 'highlight' }),
    );
    $('noteBtn').addEventListener('click', () =>
      perform($('noteBtn'), { action: 'setMode', mode: 'note' }),
    );
    $('pageNotesBtn').addEventListener('click', () =>
      supported ? perform($('pageNotesBtn'), { action: 'openPanel' }) : openLibrary(),
    );
    $('enableToggle').addEventListener('change', async (event) => {
      const input = event.target;
      input.disabled = true;
      try {
        await GNStore.setSettings({ enabled: input.checked });
        if (supported) await send({ action: 'toggle', enabled: input.checked });
        await refresh();
      } catch (error) {
        await refresh();
        toast(`当前页未完成更新：${error.message}`, true);
      } finally {
        input.disabled = false;
      }
    });
    chrome.storage.onChanged.addListener(() => {
      refresh();
    });
    try {
      [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      supported = isSupported(currentTab?.url);
      $('pageTitle').textContent = currentTab?.title || '当前页面';
      try {
        $('pageDomain').textContent = new URL(currentTab.url).hostname || '浏览器页面';
      } catch {
        $('pageDomain').textContent = '浏览器页面';
      }
      $('pageDot').classList.toggle('unavailable', !supported);
      $('highlightBtn').disabled = !supported;
      $('noteBtn').disabled = !supported;
      await refresh();
      if (supported && page?.annotations?.length) {
        try {
          const status = await send({ action: 'getStatus' });
          if (status.unresolved > 0)
            $('pageStatus').textContent = `${status.unresolved} 条待重新定位 · 内容仍保存在笔记库`;
        } catch {
          $('pageStatus').textContent = '内容已保存 · 页面连接待恢复，可刷新后重试';
        }
      }
    } catch (error) {
      toast(error.message || '无法读取当前页面', true);
    }
  }
  init();
})();
