(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const types = { highlight: '文字高亮', underline: '下划线', bold: '重点文字', note: '页面笔记' };
  const colors = ['yellow', 'green', 'blue', 'pink'];
  const params = new URLSearchParams(location.search);
  const state = {
    pages: [],
    view: 'all',
    pageUrl: params.get('page') || '',
    selectedKey: '',
    selected: null,
    query: '',
    color: 'all',
    sort: 'newest',
    dirty: false,
    draftColor: 'yellow',
    loading: false,
  };
  let refreshVersion = 0;
  let toastTimer;
  let writePending = false;
  let deleteTarget = null;
  const keyOf = (item) => `${item.page.url}\n${item.annotation.id}`;
  const timeOf = (value) => Number(new Date(value)) || 0;
  const domainOf = (url) => {
    try {
      return new URL(url).hostname || '本地网页';
    } catch {
      return '阅读页面';
    }
  };
  const shortDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(+date)
      ? '已保存'
      : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
  };
  const longDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(+date)
      ? '已保存到本地'
      : new Intl.DateTimeFormat('zh-CN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date);
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.append(use);
    return svg;
  }
  function textElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function toast(message, error = false) {
    $('toast').textContent = message;
    $('toast').classList.toggle('error', error);
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        $('toast').hidden = true;
      },
      error ? 6000 : 3500,
    );
  }
  function allItems() {
    return state.pages.flatMap((page) =>
      (page.annotations || []).map((annotation) => ({ page, annotation })),
    );
  }
  function filteredItems() {
    const query = state.query.trim().toLocaleLowerCase();
    return allItems()
      .filter(({ page, annotation }) => {
        if (state.pageUrl && state.pageUrl !== page.url) return false;
        if (state.view === 'marks' && annotation.type === 'note') return false;
        if (state.view === 'notes' && annotation.type !== 'note' && !annotation.content?.trim())
          return false;
        if (state.color !== 'all' && annotation.color !== state.color) return false;
        return (
          !query ||
          [annotation.text, annotation.content, page.title, page.url].some((text) =>
            String(text || '')
              .toLocaleLowerCase()
              .includes(query),
          )
        );
      })
      .sort((a, b) => {
        const diff =
          timeOf(a.annotation.updatedAt || a.annotation.createdAt) -
          timeOf(b.annotation.updatedAt || b.annotation.createdAt);
        return state.sort === 'oldest' ? diff : -diff;
      });
  }
  function discardDraft() {
    if (writePending) return false;
    if (state.dirty && !confirm('还有未保存的想法。离开后这些修改会丢失，确定继续吗？'))
      return false;
    state.dirty = false;
    return true;
  }
  function setDirty() {
    const annotation = state.selected?.annotation;
    state.dirty =
      !!annotation &&
      ($('noteContent').value !== (annotation.content || '') ||
        state.draftColor !== annotation.color);
    $('unsavedLabel').hidden = !state.dirty;
    $('saveBtn').disabled = !state.dirty || writePending;
    $('saveBtn').lastChild.textContent = writePending ? '保存中…' : '保存想法';
  }
  function renderSidebar() {
    const items = allItems();
    $('allCount').textContent = items.length;
    $('marksCount').textContent = items.filter((item) => item.annotation.type !== 'note').length;
    $('notesCount').textContent = items.filter(
      (item) => item.annotation.type === 'note' || item.annotation.content?.trim(),
    ).length;
    $('pageCount').textContent = state.pages.length;
    $('statAnnotations').textContent = items.length;
    $('statPages').textContent = state.pages.length;
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = !state.pageUrl && state.view === button.dataset.view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    });
    const nav = $('pageNav');
    const scrollTop = nav.scrollTop;
    nav.replaceChildren();
    state.pages.forEach((page) => {
      const button = textElement(
        'button',
        `page-item${page.url === state.pageUrl ? ' active' : ''}`,
      );
      button.title = `${page.title}\n${page.url}`;
      button.setAttribute('aria-pressed', page.url === state.pageUrl);
      button.append(
        icon('page'),
        textElement('span', '', page.title || domainOf(page.url)),
        textElement('small', '', page.annotations.length),
      );
      button.addEventListener('click', () => {
        if (!discardDraft()) return;
        state.pageUrl = page.url;
        state.view = 'all';
        state.selectedKey = '';
        document.querySelector('.workspace').classList.remove('show-detail');
        render();
      });
      nav.append(button);
    });
    nav.scrollTop = scrollTop;
    const selectedPage = state.pages.find((page) => page.url === state.pageUrl);
    $('viewTitle').textContent =
      selectedPage?.title || { all: '全部笔记', marks: '文字标注', notes: '我的想法' }[state.view];
    $('viewTitle').title = selectedPage?.title || '';
  }
  function renderList(items) {
    const holder = $('noteList');
    const scrollTop = holder.scrollTop;
    holder.replaceChildren();
    $('resultCount').textContent = `${items.length} 条记录`;
    if (!items.length) {
      const empty = textElement('div', 'list-empty');
      const filtered = !!(
        state.query ||
        state.color !== 'all' ||
        state.pageUrl ||
        state.view !== 'all'
      );
      empty.append(icon(filtered ? 'search' : 'book'));
      if (filtered) {
        const reset = textElement('button', 'button secondary', '清除筛选');
        reset.addEventListener('click', resetFilters);
        empty.append(reset);
      }
      holder.append(empty);
      return;
    }
    items.forEach((item) => {
      const { page, annotation } = item;
      const selected = keyOf(item) === state.selectedKey;
      const card = textElement('button', `note-card${selected ? ' active' : ''}`);
      card.setAttribute('aria-pressed', selected);
      const meta = textElement('div', 'card-meta');
      const dot = textElement(
        'span',
        `color-dot color-${colors.includes(annotation.color) ? annotation.color : 'yellow'}`,
      );
      const date = textElement('time', '', shortDate(annotation.updatedAt || annotation.createdAt));
      meta.append(dot, textElement('span', '', types[annotation.type] || '阅读记录'), date);
      const quote = textElement(
        'p',
        'card-quote',
        annotation.text || annotation.content || '未填写内容的笔记',
      );
      card.append(meta, quote);
      if (annotation.text && annotation.content)
        card.append(textElement('p', 'card-note', annotation.content));
      const source = textElement('div', 'card-source');
      source.append(icon('page'), textElement('span', '', page.title || domainOf(page.url)));
      card.append(source);
      card.addEventListener('click', () => {
        if (keyOf(item) !== state.selectedKey && !discardDraft()) return;
        state.selectedKey = keyOf(item);
        document.querySelector('.workspace').classList.add('show-detail');
        render();
      });
      holder.append(card);
    });
    holder.scrollTop = scrollTop;
  }
  function renderColors() {
    document.querySelectorAll('#noteColors [data-color]').forEach((button) => {
      const active = button.dataset.color === state.draftColor;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    });
    $('quoteSection').className = `quote-section color-${state.draftColor}`;
    $('detailColorDot').className = `color-dot color-${state.draftColor}`;
  }
  function renderDetail(item) {
    if (state.dirty && state.selected) return;
    state.selected = item || null;
    $('noteDetail').hidden = !item;
    $('detailEmpty').hidden = !!item;
    if (!item) {
      document.querySelector('.workspace').classList.remove('show-detail');
      return;
    }
    const { page, annotation } = item;
    $('detailType').textContent = types[annotation.type] || '阅读记录';
    $('detailDomain').textContent = domainOf(page.url);
    $('detailDate').textContent = shortDate(annotation.createdAt);
    $('detailPageTitle').textContent = page.title || domainOf(page.url);
    $('detailQuote').textContent = annotation.text || '';
    $('quoteSection').hidden = !annotation.text;
    $('noteContent').value = annotation.content || '';
    $('detailUpdatedAt').textContent =
      `最近更新于 ${longDate(annotation.updatedAt || annotation.createdAt)}`;
    $('anchorNotice').hidden = !!annotation.anchor || !annotation.text;
    state.draftColor = colors.includes(annotation.color) ? annotation.color : 'yellow';
    renderColors();
    setDirty();
  }
  function render() {
    const items = filteredItems();
    if (!state.dirty && !items.some((item) => keyOf(item) === state.selectedKey))
      state.selectedKey = items[0] ? keyOf(items[0]) : '';
    renderSidebar();
    renderList(items);
    renderDetail(items.find((item) => keyOf(item) === state.selectedKey));
  }
  async function refresh() {
    const version = ++refreshVersion;
    $('storageStatus').textContent = '正在读取本地笔记';
    document.querySelector('.overview-caption').hidden = false;
    try {
      const pages = await GNStore.listPages();
      if (version !== refreshVersion) return;
      state.pages = pages
        .filter((page) => page.annotations?.length)
        .sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt));
      if (state.pageUrl && !state.pages.some((page) => page.url === state.pageUrl) && !state.dirty)
        state.pageUrl = '';
      if (!state.selectedKey && params.get('note')) {
        const initial = allItems().find(
          (item) =>
            item.annotation.id === params.get('note') &&
            (!state.pageUrl || item.page.url === state.pageUrl),
        );
        if (initial) state.selectedKey = keyOf(initial);
        params.delete('note');
      }
      $('errorBanner').hidden = true;
      document.querySelector('.overview-caption').hidden = true;
      render();
    } catch (error) {
      $('errorMessage').textContent = `暂时无法读取笔记：${error.message || '请重试'}`;
      $('errorBanner').hidden = false;
      $('storageStatus').textContent = '本地读取失败';
      document.querySelector('.overview-caption').hidden = false;
      $('resultCount').textContent = '读取失败';
      if (!state.pages.length)
        $('noteList').replaceChildren(
          textElement(
            'p',
            'list-empty',
            '未能读取笔记。请点击上方「重新读取」，你的数据不会被清除。',
          ),
        );
    }
  }
  function resetFilters() {
    if (!discardDraft()) return;
    state.view = 'all';
    state.pageUrl = '';
    state.query = '';
    state.color = 'all';
    $('searchInput').value = '';
    $('colorFilter').value = 'all';
    render();
  }
  async function saveNote() {
    if (!state.selected || writePending || !state.dirty) return;
    const { page, annotation } = state.selected;
    const content = $('noteContent').value;
    const color = state.draftColor;
    writePending = true;
    $('noteContent').disabled = true;
    document.querySelectorAll('#noteColors button').forEach((button) => {
      button.disabled = true;
    });
    setDirty();
    try {
      await GNStore.updateNote(page.url, annotation.id, {
        content,
        ...(color !== annotation.color ? { color } : {}),
      });
      state.dirty = false;
      await refresh();
      toast('想法已保存，回到原网页也能看到');
    } catch (error) {
      toast(`保存失败：${error.message}`, true);
    } finally {
      writePending = false;
      $('noteContent').disabled = false;
      document.querySelectorAll('#noteColors button').forEach((button) => {
        button.disabled = false;
      });
      setDirty();
    }
  }
  async function deleteNote() {
    if (!deleteTarget || writePending) return;
    // 确认框针对打开时的记录，后台刷新选中项不能改变删除目标。
    const target = { ...deleteTarget };
    const button = $('confirmDeleteBtn');
    button.disabled = true;
    writePending = true;
    try {
      await GNStore.remove(target.url, target.id);
      if (state.selectedKey === target.key) {
        state.dirty = false;
        state.selectedKey = '';
      }
      $('deleteDialog').close();
      await refresh();
      toast('笔记已删除');
    } catch (error) {
      toast(`删除失败：${error.message}`, true);
    } finally {
      button.disabled = false;
      writePending = false;
    }
  }
  async function openSettings() {
    try {
      const settings = await GNStore.getSettings();
      $('settingEnabled').checked = settings.enabled;
      $('settingRestore').checked = settings.autoRestore;
      $('settingColor').value = settings.defaultColor;
      if (!$('settingsDialog').open) $('settingsDialog').showModal();
    } catch (error) {
      toast(`设置读取失败：${error.message}`, true);
    }
  }
  async function saveSettings() {
    const button = $('saveSettingsBtn');
    button.disabled = true;
    try {
      await GNStore.setSettings({
        enabled: $('settingEnabled').checked,
        autoRestore: $('settingRestore').checked,
        defaultColor: $('settingColor').value,
      });
      $('settingsDialog').close();
      toast('偏好设置已保存');
    } catch (error) {
      toast(`设置保存失败：${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }
  async function exportNotes() {
    const button = $('exportBtn');
    button.disabled = true;
    try {
      const payload = await GNStore.exportData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `GlassNote-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast('已生成备份文件，请留意浏览器下载记录');
    } catch (error) {
      toast(`导出失败：${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  }
  async function importNotes(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const button = $('importBtn');
    button.disabled = true;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请选择较小的备份文件');
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new Error('文件不是有效的 JSON 备份，请选择 GlassNote 导出的文件');
      }
      const result = await GNStore.importData(payload);
      await refresh();
      toast(`已合并 ${result.pages} 个页面、${result.annotations} 条记录`);
    } catch (error) {
      toast(`导入失败：${error.message}`, true);
    } finally {
      button.disabled = false;
      event.target.value = '';
    }
  }
  function setup() {
    document.querySelectorAll('[data-view]').forEach((button) =>
      button.addEventListener('click', () => {
        if (!discardDraft()) return;
        state.view = button.dataset.view;
        state.pageUrl = '';
        state.selectedKey = '';
        document.querySelector('.workspace').classList.remove('show-detail');
        render();
      }),
    );
    $('searchInput').addEventListener('input', (event) => {
      state.query = event.target.value;
      render();
    });
    $('colorFilter').addEventListener('change', (event) => {
      state.color = event.target.value;
      render();
    });
    $('sortOrder').addEventListener('change', (event) => {
      state.sort = event.target.value;
      render();
    });
    $('noteContent').addEventListener('input', setDirty);
    document.querySelectorAll('#noteColors [data-color]').forEach((button) =>
      button.addEventListener('click', () => {
        state.draftColor = button.dataset.color;
        renderColors();
        setDirty();
      }),
    );
    $('saveBtn').addEventListener('click', saveNote);
    $('deleteBtn').addEventListener('click', () => {
      if (writePending || !state.selected) return;
      const { page, annotation } = state.selected;
      deleteTarget = { url: page.url, id: annotation.id, key: keyOf(state.selected) };
      $('deletePreview').textContent = (
        annotation.text ||
        annotation.content ||
        '未填写内容的笔记'
      ).slice(0, 180);
      $('deleteDialog').showModal();
    });
    $('deleteDialog').addEventListener('close', () => {
      deleteTarget = null;
    });
    $('confirmDeleteBtn').addEventListener('click', deleteNote);
    $('openSourceBtn').addEventListener('click', async () => {
      try {
        const url = new URL(state.selected.page.url);
        if (!['https:', 'http:', 'file:'].includes(url.protocol))
          throw new Error('原网页地址无法打开');
        await chrome.tabs.create({ url: url.href });
      } catch (error) {
        toast(`打开失败：${error.message}`, true);
      }
    });
    $('copyBtn').addEventListener('click', async () => {
      if (!state.selected) return;
      try {
        const { annotation, page } = state.selected;
        await navigator.clipboard.writeText(
          [annotation.text, $('noteContent').value, `来源：${page.title}\n${page.url}`]
            .filter(Boolean)
            .join('\n\n'),
        );
        toast('笔记与来源已复制');
      } catch {
        toast('暂时无法访问剪贴板，请直接选中文字复制', true);
      }
    });
    $('backToList').addEventListener('click', () => {
      document.querySelector('.workspace').classList.remove('show-detail');
    });
    $('settingsBtn').addEventListener('click', openSettings);
    $('saveSettingsBtn').addEventListener('click', saveSettings);
    $('exportBtn').addEventListener('click', exportNotes);
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', importNotes);
    $('retryBtn').addEventListener('click', refresh);
    document.querySelectorAll('dialog').forEach((dialog) =>
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) {
          const rect = dialog.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            dialog.close();
        }
      }),
    );
    window.addEventListener('beforeunload', (event) => {
      if (state.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('keydown', (event) => {
      if (
        event.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        $('searchInput').focus();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's' &&
        state.dirty &&
        !document.querySelector('dialog[open]')
      ) {
        event.preventDefault();
        saveNote();
      }
    });
    chrome.storage.onChanged.addListener(() => {
      refresh();
    });
  }
  async function init() {
    setup();
    if (state.pageUrl) {
      try {
        state.pageUrl = GNStore.canonicalUrl(state.pageUrl);
      } catch {
        state.pageUrl = '';
      }
    }
    await refresh();
    if (location.hash === '#settings') await openSettings();
  }
  init();
})();
