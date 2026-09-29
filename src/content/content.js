/* GlassNote v3: text ranges are painted, never wrapped or rewritten. */
(() => {
  'use strict';
  if (globalThis.__glassNoteV3) return;

  const COLORS = { yellow: '麦穗黄', green: '薄荷绿', blue: '雾霭蓝', pink: '蔷薇粉' };
  const TYPES = { highlight: '高亮', underline: '下划线', bold: '强调', note: '笔记' };
  const HIGHLIGHT_NAMES = Object.keys(TYPES).flatMap((type) =>
    Object.keys(COLORS).map((color) => `glassnote-${type}-${color}`),
  );
  const ICONS = {
    close: ['M6 6l12 12M18 6 6 18'],
    plus: ['M12 5v14M5 12h14'],
    note: ['M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z', 'M14 3v6h6M8 13h8M8 17h5'],
    mark: ['m9 4 11 11-5 5L4 9zM3 21h7M6 11l7 7'],
    underline: ['M6 4v7a6 6 0 0 0 12 0V4M4 21h16'],
    bold: ['M6 4h7a4 4 0 0 1 0 8H6zM6 12h8a4 4 0 0 1 0 8H6z'],
    arrow: ['M7 17 17 7M7 7h10v10'],
    search: ['M21 21l-5-5'],
    check: ['m5 12 4 4L19 6'],
    book: ['M3 4h6a4 4 0 0 1 3 2 4 4 0 0 1 3-2h6v16h-6a4 4 0 0 0-3 2 4 4 0 0 0-3-2H3zM12 6v16'],
    edit: ['m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z'],
    delete: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
    retry: ['M20 7v5h-5M4 17v-5h5', 'M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1'],
  };

  function node(tag, className, text) {
    const value = document.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  }
  function icon(name) {
    const value = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    value.setAttribute('viewBox', '0 0 24 24');
    value.setAttribute('fill', 'none');
    value.setAttribute('stroke', 'currentColor');
    value.setAttribute('stroke-width', '1.65');
    value.setAttribute('stroke-linecap', 'round');
    value.setAttribute('stroke-linejoin', 'round');
    value.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || ICONS.note) {
      const path = document.createElementNS(value.namespaceURI, 'path');
      path.setAttribute('d', d);
      value.append(path);
    }
    if (name === 'search') {
      const circle = document.createElementNS(value.namespaceURI, 'circle');
      circle.setAttribute('cx', '10.5');
      circle.setAttribute('cy', '10.5');
      circle.setAttribute('r', '6.5');
      value.prepend(circle);
    }
    return value;
  }
  function button(label, className, iconName, action) {
    const value = node('button', className);
    value.type = 'button';
    value.title = label;
    value.setAttribute('aria-label', label);
    if (iconName) value.append(icon(iconName));
    if (!className?.includes('icon-only')) value.append(node('span', '', label));
    if (action) value.addEventListener('click', action);
    return value;
  }
  function canonicalUrl(url) {
    return typeof GNStore.canonicalUrl === 'function' ? GNStore.canonicalUrl(url) : url;
  }
  function errorText(error) {
    if (
      /Extension context invalidated|receiving end does not exist|Could not establish connection/i.test(
        error?.message || '',
      )
    ) {
      return '扩展已更新，请刷新网页后重试。';
    }
    return error?.message || '请稍后重试。';
  }
  function newId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // randomUUID is unavailable on HTTP origins; getRandomValues is still safe.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function isEditable(value) {
    const element = value?.nodeType === Node.ELEMENT_NODE ? value : value?.parentElement;
    return !!element?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-glassnote-root]',
    );
  }

  class GlassNote {
    constructor() {
      this.url = canonicalUrl(location.href);
      this.title = document.title;
      this.settings = { enabled: true, autoRestore: true, defaultColor: 'yellow' };
      this.annotations = [];
      this.ranges = new Map();
      this.selectedRange = null;
      this.selectedUrl = null;
      this.panelOpen = false;
      this.filter = 'all';
      this.query = '';
      this.loadVersion = 0;
      this.restoreRequestedAt = 0;
      this.deleteId = null;
      this.loading = false;
      this.restoreAllowed = true;
      this.error = '';
      this.hasHighlightAPI = !!globalThis.CSS?.highlights && typeof Highlight === 'function';
      this.abort = new AbortController();
      this.ready = Promise.resolve();
    }

    async init() {
      this.mount();
      this.bind();
      try {
        this.settings = { ...this.settings, ...(await GNStore.getSettings()) };
      } catch (error) {
        this.error = `设置读取失败：${errorText(error)}`;
      }
      this.color = COLORS[this.settings.defaultColor] ? this.settings.defaultColor : 'yellow';
      await this.loadPage({ initial: true });
    }

    mount() {
      this.host = document.createElement('div');
      this.host.id = 'glassnote-root';
      this.host.setAttribute('data-glassnote-root', '');
      this.host.style.cssText =
        'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = node('style');
      style.textContent = SHADOW_STYLES;
      this.shadow.append(style);

      this.toolbar = node('div', 'selection-toolbar glass');
      this.toolbar.hidden = true;
      this.toolbar.setAttribute('role', 'toolbar');
      this.toolbar.setAttribute('aria-label', '选中文字标注');
      this.toolbar.addEventListener('pointerdown', (event) => event.preventDefault());
      this.toolbar.append(
        button('高亮', 'tool primary-tool', 'mark', () => this.saveSelection('highlight')),
        button('下划线', 'tool icon-only', 'underline', () => this.saveSelection('underline')),
        button('加粗', 'tool icon-only', 'bold', () => this.saveSelection('bold')),
        node('span', 'divider'),
        this.makePalette((color) => this.saveSelection('highlight', color), null, false),
        node('span', 'divider'),
        button('写笔记', 'tool', 'note', () => this.openEditor()),
      );
      for (const [index, type] of ['highlight', 'underline', 'bold'].entries()) {
        const control = this.toolbar.children[index];
        control.dataset.format = type;
        control.setAttribute('aria-pressed', 'false');
      }
      this.toolbar.querySelector('.palette').setAttribute('aria-label', '高亮颜色，再次点击取消');
      this.shadow.append(this.toolbar);

      this.launcher = button('打开本页笔记', 'launcher glass', 'book', () => this.openPanel());
      this.launcher.setAttribute('aria-expanded', 'false');
      this.launcherCount = node('span', 'launcher-count', '0');
      this.launcher.replaceChildren(icon('book'), this.launcherCount);
      this.launcher.hidden = true;
      this.shadow.append(this.launcher);

      this.panel = node('aside', 'panel glass');
      this.panel.hidden = true;
      this.panel.setAttribute('aria-label', 'GlassNote 本页阅读笔记');
      const header = node('header', 'panel-header');
      const brand = node('div', 'brand');
      brand.append(node('span', 'brand-mark', 'g'), node('div', 'brand-word', 'GlassNote'));
      header.append(
        brand,
        button('关闭笔记面板', 'icon-button icon-only', 'close', () => this.closePanel()),
      );
      const intro = node('div', 'panel-intro');
      this.pageTitle = node('h2', 'page-title');
      this.summary = node('p', 'page-summary');
      intro.append(this.pageTitle, this.summary);
      this.notice = node('div', 'notice');
      this.notice.hidden = true;
      const controls = node('div', 'panel-controls');
      const search = node('label', 'search');
      search.append(icon('search'));
      this.searchInput = node('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = '搜索本页标注与笔记';
      this.searchInput.setAttribute('aria-label', '搜索本页标注与笔记');
      this.searchInput.addEventListener('input', () => {
        this.query = this.searchInput.value;
        this.renderCards();
      });
      search.append(this.searchInput);
      this.filters = node('div', 'filters');
      this.filters.setAttribute('role', 'group');
      this.filters.setAttribute('aria-label', '筛选标注');
      for (const [value, label] of [
        ['all', '全部'],
        ['note', '笔记'],
        ['mark', '标注'],
      ]) {
        const item = button(label, 'filter', null, () => {
          this.filter = value;
          this.renderCards();
        });
        item.dataset.filter = value;
        this.filters.append(item);
      }
      controls.append(search, this.filters);
      this.cards = node('div', 'cards');
      this.cards.setAttribute('aria-label', '本页标注列表');
      const footer = node('footer', 'panel-footer');
      footer.append(
        button('新建页面笔记', 'primary wide', 'plus', () => this.openEditor(null, true)),
      );
      this.panel.append(header, intro, this.notice, controls, this.cards, footer);
      this.shadow.append(this.panel);

      this.toast = node('div', 'toast glass');
      this.toast.hidden = true;
      this.toast.setAttribute('role', 'status');
      this.toast.setAttribute('aria-live', 'polite');
      this.shadow.append(this.toast);
      document.documentElement.append(this.host);
    }

    bind() {
      const signal = this.abort.signal;
      document.addEventListener(
        'selectionchange',
        () => {
          clearTimeout(this.selectionTimer);
          this.selectionTimer = setTimeout(() => this.readSelection(), 140);
        },
        { signal },
      );
      document.addEventListener(
        'pointerup',
        (event) => {
          if (!event.composedPath().includes(this.host)) setTimeout(() => this.readSelection(), 0);
        },
        { signal },
      );
      document.addEventListener(
        'pointerdown',
        (event) => {
          if (!event.composedPath().includes(this.host)) this.toolbar.hidden = true;
        },
        { signal },
      );
      document.addEventListener('keydown', (event) => this.onKey(event), { signal });
      document.addEventListener('click', (event) => this.onPageClick(event), { signal });
      window.addEventListener(
        'scroll',
        () => {
          this.toolbar.hidden = true;
        },
        { capture: true, passive: true, signal },
      );
      window.addEventListener(
        'resize',
        () => {
          this.toolbar.hidden = true;
        },
        { passive: true, signal },
      );
      window.addEventListener('popstate', () => this.checkRoute(), { signal });
      window.addEventListener('hashchange', () => this.checkRoute(), { signal });
      window.addEventListener(
        'pageshow',
        () => {
          this.checkRoute();
          this.scheduleRestore();
        },
        { signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          if (!document.hidden) {
            this.checkRoute();
            this.scheduleRestore();
          }
        },
        { signal },
      );
      // Isolated content scripts cannot reliably intercept a site's history methods.
      this.routeTimer = setInterval(() => this.checkRoute(), 800);
      this.observer = new MutationObserver((records) => {
        if (
          records.some(
            (record) => !this.host.contains(record.target) && record.target !== this.host,
          )
        ) {
          this.checkRoute();
          this.scheduleRestore();
        }
      });
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      chrome.runtime.onMessage.addListener((message, _sender, respond) => {
        const actions = [
          'getStatus',
          'toggle',
          'setMode',
          'openPanel',
          'focusAnnotation',
          'refresh',
          'clearAll',
        ];
        if (!actions.includes(message?.action)) return false;
        this.ready
          .then(() => this.handleMessage(message))
          .then(respond)
          .catch((error) => {
            respond({ success: false, error: errorText(error) });
            this.showToast(`操作失败：${errorText(error)}`, true);
          });
        return true;
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const keys = Object.keys(changes);
        const relevant = keys.some(
          (key) => key === this.url || key === `gn:page:${this.url}` || key === 'gn:settings',
        );
        if (!relevant) return;
        clearTimeout(this.storageTimer);
        this.storageTimer = setTimeout(async () => {
          try {
            const previousEnabled = this.settings.enabled;
            const previousAutoRestore = this.settings.autoRestore;
            const previousColor = this.settings.defaultColor;
            this.settings = { ...this.settings, ...(await GNStore.getSettings()) };
            if (
              previousColor !== this.settings.defaultColor &&
              COLORS[this.settings.defaultColor]
            ) {
              this.color = this.settings.defaultColor;
              this.updateSelectionTools();
            }
            if (!previousAutoRestore && this.settings.autoRestore) this.restoreAllowed = true;
            if (previousEnabled !== this.settings.enabled) this.applyEnabled();
            await this.loadPage();
          } catch (error) {
            this.error = `更新读取失败：${errorText(error)}`;
            this.render();
          }
        }, 120);
      });
    }

    async handleMessage(message) {
      this.checkRoute();
      if (this.pageLoad) await this.pageLoad;
      switch (message.action) {
        case 'getStatus':
          return this.status();
        case 'toggle': {
          const enabled =
            typeof message.enabled === 'boolean' ? message.enabled : !this.settings.enabled;
          await GNStore.setSettings({ enabled });
          this.settings.enabled = enabled;
          this.applyEnabled();
          if (enabled) {
            this.restoreAllowed = true;
            this.restore();
          }
          return this.status();
        }
        case 'setMode': {
          if (!['highlight', 'underline', 'bold', 'note'].includes(message.mode))
            throw new Error('不支持的标注方式');
          if (!this.settings.enabled) {
            await GNStore.setSettings({ enabled: true });
            this.settings.enabled = true;
            this.restoreAllowed = true;
            this.applyEnabled();
            this.restore();
          }
          if (message.mode === 'note') this.openEditor();
          else if (this.validSelection()) {
            const saved = await this.saveSelection(message.mode);
            if (!saved)
              return { success: false, error: '标注未能保存，请查看网页中的提示并重试。' };
          } else this.showToast('选中网页中的一段文字，即可添加标注。');
          return this.status();
        }
        case 'openPanel':
          this.openPanel();
          return this.status();
        case 'focusAnnotation': {
          this.openPanel();
          const found = this.focusAnnotation(message.id);
          return { ...this.status(), found };
        }
        case 'refresh':
          await this.loadPage({ forceRestore: true });
          return this.status();
        case 'clearAll': {
          const url = this.url;
          await GNStore.clearPage(url);
          if (this.url === url) {
            await this.loadPage({ forceRestore: true });
            this.showToast('本页笔记与标注已清空。');
          }
          return this.status();
        }
        default:
          return { success: false, error: '未知操作' };
      }
    }

    status() {
      return {
        success: true,
        enabled: this.settings.enabled,
        total: this.annotations.length,
        restored: this.ranges.size,
        unresolved:
          this.settings.enabled && this.restoreAllowed
            ? this.annotations.filter((item) => this.needsAnchor(item) && !this.ranges.has(item.id))
                .length
            : 0,
        url: this.url,
        ...(this.error ? { error: this.error } : {}),
      };
    }

    checkRoute() {
      const url = canonicalUrl(location.href);
      if (url === this.url) return;
      this.url = url;
      this.title = document.title;
      this.annotations = [];
      this.ranges.clear();
      this.clearPaint();
      this.selectedRange = null;
      this.selectedUrl = null;
      this.toolbar.hidden = true;
      this.query = '';
      this.searchInput.value = '';
      this.deleteId = null;
      this.restoreAllowed = this.settings.autoRestore !== false;
      this.loadPage();
    }

    loadPage(options = {}) {
      const task = this.readPage(options);
      this.pageLoad = task;
      task.finally(() => {
        if (this.pageLoad === task) this.pageLoad = null;
      });
      return task;
    }

    async readPage({ initial = false, forceRestore = false } = {}) {
      const version = ++this.loadVersion;
      const url = this.url;
      if (initial) this.restoreAllowed = this.settings.autoRestore !== false;
      if (forceRestore) this.restoreAllowed = true;
      this.loading = true;
      this.render();
      try {
        const page = await GNStore.getPage(url);
        if (version !== this.loadVersion || url !== this.url) return;
        this.annotations = Array.isArray(page?.annotations) ? page.annotations : [];
        this.title = document.title || page?.title || '未命名页面';
        this.error = '';
        this.loading = false;
        if (this.restoreAllowed) this.restore();
        else {
          this.ranges.clear();
          this.clearPaint();
          this.render();
        }
      } catch (error) {
        if (version !== this.loadVersion) return;
        this.error = `笔记读取失败：${errorText(error)}`;
        this.loading = false;
        this.render();
      }
    }

    needsAnchor(annotation) {
      return !!(annotation.anchor || annotation.text);
    }

    scheduleRestore() {
      if (!this.settings.enabled || !this.restoreAllowed || !this.annotations.length) return;
      const now = Date.now();
      if (!this.restoreRequestedAt) this.restoreRequestedAt = now;
      clearTimeout(this.restoreTimer);
      this.restoreTimer = setTimeout(
        () => {
          this.restoreRequestedAt = 0;
          this.restore();
        },
        Math.min(650, Math.max(0, 2000 - (now - this.restoreRequestedAt))),
      );
    }

    restore() {
      this.ranges.clear();
      this.clearPaint();
      if (!this.settings.enabled || !this.restoreAllowed || !document.body) {
        this.render();
        return;
      }
      const resolver =
        typeof GNAnchor.createResolver === 'function'
          ? GNAnchor.createResolver(document.body)
          : null;
      for (const annotation of this.annotations) {
        if (!this.needsAnchor(annotation)) continue;
        try {
          const range = resolver
            ? resolver.resolve(annotation)
            : GNAnchor.resolve(annotation, document.body);
          if (
            range &&
            !range.collapsed &&
            range.startContainer.isConnected &&
            range.endContainer.isConnected
          )
            this.ranges.set(annotation.id, range);
        } catch (_) {
          /* Keep unresolved notes readable in the panel. */
        }
      }
      this.paint();
      this.render();
    }

    clearPaint() {
      if (!this.hasHighlightAPI) return;
      for (const name of HIGHLIGHT_NAMES) CSS.highlights.delete(name);
      CSS.highlights.delete('glassnote-focus');
    }

    paint() {
      if (!this.hasHighlightAPI || !this.settings.enabled) return;
      const buckets = new Map();
      for (const annotation of this.annotations) {
        const range = this.ranges.get(annotation.id);
        if (!range) continue;
        const type = TYPES[annotation.type] ? annotation.type : 'highlight';
        const color = COLORS[annotation.color] ? annotation.color : 'yellow';
        const name = `glassnote-${type}-${color}`;
        if (!buckets.has(name)) buckets.set(name, []);
        buckets.get(name).push(range);
      }
      for (const [name, ranges] of buckets) CSS.highlights.set(name, new Highlight(...ranges));
    }

    applyEnabled() {
      if (!this.settings.enabled) {
        this.toolbar.hidden = true;
        this.ranges.clear();
        this.clearPaint();
      }
      this.render();
    }

    readSelection() {
      this.checkRoute();
      if (!this.settings.enabled || this.editor) return;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        this.toolbar.hidden = true;
        this.selectedRange = null;
        return;
      }
      const range = selection.getRangeAt(0);
      if (
        !document.body?.contains(range.commonAncestorContainer) ||
        isEditable(range.startContainer) ||
        isEditable(range.endContainer) ||
        !range.toString().trim()
      ) {
        this.toolbar.hidden = true;
        this.selectedRange = null;
        return;
      }
      this.selectedRange = range.cloneRange();
      this.selectedUrl = this.url;
      this.toolbar.hidden = false;
      this.updateSelectionTools();
      const rects = range.getClientRects();
      const rect = rects[rects.length - 1] || range.getBoundingClientRect();
      const width = this.toolbar.offsetWidth;
      const height = this.toolbar.offsetHeight;
      this.toolbar.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, rect.left + rect.width / 2 - width / 2))}px`;
      this.toolbar.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, rect.bottom + 10 <= innerHeight - height ? rect.bottom + 10 : rect.top - height - 10))}px`;
    }

    validSelection() {
      return (
        this.selectedRange &&
        this.selectedUrl === this.url &&
        this.selectedUrl === canonicalUrl(location.href) &&
        this.selectedRange.startContainer.isConnected &&
        this.selectedRange.endContainer.isConnected &&
        !this.selectedRange.collapsed &&
        !!this.selectedRange.toString().trim()
      );
    }

    captureSelection() {
      this.checkRoute();
      // 键盘改选后的 selectionchange 有防抖，提交时读取当前选区，避免使用上一段。
      // 页面路由切换已清除 selectedUrl，不能在这里恢复旧页面留下的选区。
      const selection = document.getSelection();
      if (this.selectedUrl === this.url && selection?.rangeCount && !selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        if (
          document.body?.contains(range.commonAncestorContainer) &&
          !isEditable(range.startContainer) &&
          !isEditable(range.endContainer)
        )
          this.selectedRange = range.cloneRange();
      }
      if (!this.validSelection()) return null;
      const anchor = GNAnchor.capture(this.selectedRange, document.body);
      if (!anchor) throw new Error('这段文字无法稳定定位，请重新选择正文中的文字。');
      return { text: this.selectedRange.toString().trim(), anchor };
    }

    selectionMatches(selected, annotations = this.annotations) {
      // 在同一份正文索引中还原两端，兼容元素边界选区、首尾空白和 DOM 包装变化。
      // 文本相同但位置不同的记录不能互相取消。
      const resolver = GNAnchor.createResolver(document.body);
      const selection = resolver.resolve(selected);
      if (!selection) throw new Error('原文位置已变化，请重新选择这段文字。');
      return annotations.filter((annotation) => {
        const range = resolver.resolve(annotation);
        return (
          range &&
          range.startContainer === selection.startContainer &&
          range.startOffset === selection.startOffset &&
          range.endContainer === selection.endContainer &&
          range.endOffset === selection.endOffset
        );
      });
    }

    updateSelectionTools() {
      if (!this.toolbar || this.toolbar.hidden || !this.validSelection()) return;
      let matches = [];
      try {
        const selected = this.captureSelection();
        if (selected) matches = this.selectionMatches(selected);
      } catch (_) {
        // 页面变化时撤销选中态；实际保存会显示重新选择的提示。
      }
      for (const control of this.toolbar.querySelectorAll('[data-format]')) {
        control.setAttribute(
          'aria-pressed',
          String(matches.some((item) => item.type === control.dataset.format)),
        );
      }
      const highlights = matches.filter((item) => item.type === 'highlight');
      const color =
        highlights.length && highlights.every((item) => item.color === highlights[0].color)
          ? highlights[0].color
          : null;
      this.updatePalette(this.toolbar, color);
    }

    async saveSelection(type, color = null) {
      if (this.savingSelection) return false;
      this.checkRoute();
      const url = this.url;
      const title = document.title || this.title;
      let selected;
      try {
        selected = this.captureSelection();
      } catch (error) {
        this.showToast(errorText(error), true);
        return false;
      }
      if (!selected) {
        this.showToast('请先选中一段文字。');
        return false;
      }
      const now = Date.now();
      const annotation = {
        id: newId(),
        type,
        ...selected,
        content: '',
        color: color || this.color,
        createdAt: now,
        updatedAt: now,
      };
      this.savingSelection = true;
      for (const item of this.toolbar.querySelectorAll('button')) item.disabled = true;
      try {
        const latest = await GNStore.getPage(url);
        this.checkRoute();
        if (this.url !== url) throw new Error('页面已切换，请重新选择文字。');
        const matchingIds = this.selectionMatches(selected, latest.annotations || []).map(
          (item) => item.id,
        );
        const result = await GNStore.toggleMark(
          url,
          title,
          annotation,
          matchingIds,
          color !== null,
        );
        if (color) this.color = color;
        if (this.url === url) await this.loadPage({ forceRestore: true });
        this.showToast(
          result.action === 'removed'
            ? '已取消该格式，写过的笔记会保留。'
            : result.action === 'updated'
              ? '已更新高亮颜色，再次点击同一颜色可取消。'
              : '标注已保存，再次点击可取消。',
        );
        return true;
      } catch (error) {
        this.showToast(`保存失败：${errorText(error)}`, true);
        return false;
      } finally {
        this.savingSelection = false;
        for (const item of this.toolbar.querySelectorAll('button')) item.disabled = false;
      }
    }

    makePalette(onChange, selected = 'yellow', reflectSelection = true) {
      const palette = node('div', 'palette');
      palette.setAttribute('role', 'group');
      palette.setAttribute('aria-label', '标注颜色');
      for (const [color, label] of Object.entries(COLORS)) {
        const swatch = button(label, 'swatch icon-only', null, () => {
          onChange(color);
          if (reflectSelection) this.updatePalette(palette, color);
        });
        swatch.dataset.color = color;
        swatch.setAttribute('aria-pressed', String(color === selected));
        palette.append(swatch);
      }
      return palette;
    }

    updatePalette(root, color) {
      for (const swatch of root.querySelectorAll('[data-color]'))
        swatch.setAttribute('aria-pressed', String(swatch.dataset.color === color));
    }

    openPanel() {
      if (!this.restoreAllowed && this.settings.enabled) {
        this.restoreAllowed = true;
        this.restore();
      }
      this.panelOpen = true;
      this.panel.hidden = false;
      this.launcher.hidden = true;
      this.launcher.setAttribute('aria-expanded', 'true');
      this.toolbar.hidden = true;
      this.render();
    }

    closePanel() {
      this.panelOpen = false;
      this.panel.hidden = true;
      this.launcher.setAttribute('aria-expanded', 'false');
      this.render();
    }

    render() {
      if (!this.panel) return;
      this.updateSelectionTools();
      const total = this.annotations.length;
      const unresolved =
        this.settings.enabled && this.restoreAllowed
          ? this.annotations.filter((item) => this.needsAnchor(item) && !this.ranges.has(item.id))
              .length
          : 0;
      this.launcher.hidden = this.panelOpen || !this.settings.enabled || !total;
      this.launcherCount.textContent = String(total);
      this.launcher.setAttribute('aria-label', `打开本页 ${total} 条笔记与标注`);
      this.pageTitle.textContent = this.title || document.title || '此刻正在阅读';
      this.pageTitle.title = this.pageTitle.textContent;
      this.summary.textContent = this.loading
        ? '正在读取已保存的内容…'
        : `${total} 条记录${this.settings.enabled ? ` · ${this.ranges.size} 处已定位` : ' · 标注已隐藏'}`;
      this.notice.replaceChildren();
      const notice =
        this.error ||
        (!this.hasHighlightAPI
          ? '浏览器暂不支持原文高亮，已保存的笔记仍可在下方阅读。'
          : !this.settings.enabled
            ? '标注已隐藏，网页原文与保存的笔记均会保留。'
            : !this.restoreAllowed
              ? '自动恢复已关闭，打开本页笔记时会重新定位。'
              : unresolved
                ? `${unresolved} 条记录暂未找到原文。页面加载后会重试，笔记内容始终保留。`
                : '');
      this.notice.hidden = !notice;
      if (notice) {
        this.notice.append(node('span', '', notice));
        if (this.error || unresolved)
          this.notice.append(
            button('重新定位', 'text-button', 'retry', () => this.loadPage({ forceRestore: true })),
          );
      }
      this.renderCards();
    }

    renderCards() {
      if (!this.cards) return;
      const previousScroll = this.cards.scrollTop;
      const previousFocus = this.shadow.activeElement;
      const focusedId = previousFocus?.closest?.('[data-annotation-id]')?.dataset.annotationId;
      const focusedAction = previousFocus?.dataset.action;
      const query = this.query.trim().toLocaleLowerCase();
      const visible = [...this.annotations]
        .filter((item) => {
          const matchesType =
            this.filter === 'all' ||
            (this.filter === 'note'
              ? item.type === 'note' || !!item.content
              : item.type !== 'note');
          return (
            matchesType &&
            (!query ||
              `${item.text || ''} ${item.content || ''}`.toLocaleLowerCase().includes(query))
          );
        })
        .sort(
          (a, b) => (Number(new Date(b.createdAt)) || 0) - (Number(new Date(a.createdAt)) || 0),
        );
      for (const filter of this.filters.children)
        filter.setAttribute('aria-pressed', String(filter.dataset.filter === this.filter));
      this.cards.replaceChildren();
      if (!visible.length) {
        const empty = node('div', 'empty');
        empty.append(node('h3', '', this.annotations.length ? '没有匹配记录' : '暂无笔记'));
        this.cards.append(empty);
      }
      for (const annotation of visible) this.cards.append(this.annotationCard(annotation));
      this.cards.scrollTop = previousScroll;
      if (focusedId && focusedAction) {
        const card = [...this.cards.children].find(
          (item) => item.dataset.annotationId === focusedId,
        );
        card?.querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
      }
    }

    annotationCard(annotation) {
      const card = node(
        'article',
        `card color-${COLORS[annotation.color] ? annotation.color : 'yellow'}`,
      );
      card.dataset.annotationId = annotation.id;
      const head = node('div', 'card-head');
      const kind = node('span', 'card-kind');
      kind.append(
        node('span', 'color-dot'),
        document.createTextNode(TYPES[annotation.type] || '标注'),
      );
      const created = new Date(annotation.createdAt);
      const date = Number.isNaN(created.valueOf())
        ? ''
        : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(created);
      const time = node('time', '', date);
      if (date) time.dateTime = created.toISOString();
      head.append(kind, time);
      card.append(head);
      if (annotation.text) {
        const quote = button(annotation.text, 'quote-button', null, () =>
          this.focusAnnotation(annotation.id),
        );
        quote.removeAttribute('title');
        quote.setAttribute('aria-label', `定位原文：${annotation.text.slice(0, 120)}`);
        quote.replaceChildren(node('blockquote', '', annotation.text));
        card.append(quote);
      }
      if (annotation.content) card.append(node('p', 'note-content', annotation.content));
      if (!annotation.text && !annotation.content)
        card.append(node('p', 'note-content muted', '这条记录没有文字内容。'));
      if (this.settings.enabled && this.needsAnchor(annotation) && !this.ranges.has(annotation.id))
        card.append(node('div', 'unresolved', '暂未找到原文 · 笔记已保留'));
      const actions = node('div', 'card-actions');
      if (this.needsAnchor(annotation)) {
        const locate = button('定位', 'text-button', 'arrow', () =>
          this.focusAnnotation(annotation.id),
        );
        locate.dataset.action = 'locate';
        actions.append(locate);
      } else actions.append(node('span', 'page-note-label', '页面笔记'));
      const edit = button(
        annotation.content || annotation.type === 'note' ? '编辑' : '写笔记',
        'text-button',
        'edit',
        () => this.openEditor(annotation),
      );
      edit.dataset.action = 'edit';
      const remove = button('删除', 'text-button danger', 'delete', () => {
        this.deleteId = annotation.id;
        this.renderCards();
      });
      remove.dataset.action = 'delete';
      actions.append(edit, remove);
      card.append(actions);
      if (this.deleteId === annotation.id) {
        const confirm = node('div', 'delete-confirm');
        confirm.append(node('p', '', '删除这条记录？此操作无法撤销。'));
        const row = node('div', 'action-row');
        row.append(
          button('保留', 'secondary small', null, () => {
            this.deleteId = null;
            this.renderCards();
          }),
        );
        row.append(
          button('确认删除', 'danger-button small', null, (event) =>
            this.deleteAnnotation(annotation.id, event.currentTarget),
          ),
        );
        confirm.append(row);
        card.append(confirm);
      }
      return card;
    }

    async deleteAnnotation(id, control) {
      if (control.disabled) return;
      control.disabled = true;
      const url = this.url;
      try {
        await GNStore.remove(url, id);
        this.deleteId = null;
        if (url === this.url) await this.loadPage({ forceRestore: true });
        this.showToast('记录已删除。');
      } catch (error) {
        this.showToast(`删除失败：${errorText(error)}`, true);
        control.disabled = false;
      }
    }

    focusAnnotation(id) {
      const annotation = this.annotations.find((item) => item.id === id);
      if (!annotation) {
        this.showToast('这条记录不属于当前页面，或已被删除。', true);
        return false;
      }
      this.filter = 'all';
      this.query = '';
      this.searchInput.value = '';
      this.openPanel();
      const card = [...this.cards.children].find((item) => item.dataset.annotationId === id);
      if (card) {
        card.classList.add('is-focused');
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      let range = this.ranges.get(id);
      if (!range && this.settings.enabled) {
        this.restore();
        range = this.ranges.get(id);
      }
      if (!range) {
        if (this.needsAnchor(annotation))
          this.showToast(
            this.settings.enabled
              ? '暂时找不到原文，笔记内容仍在右侧保留。'
              : '标注已隐藏，请先开启标注显示。',
          );
        return !this.needsAnchor(annotation);
      }
      const rect = range.getBoundingClientRect();
      const target =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement;
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      if (rect.height && rect.width && target?.getBoundingClientRect().height > innerHeight)
        window.scrollBy({ top: rect.top - innerHeight / 3, behavior: 'smooth' });
      if (this.hasHighlightAPI) {
        CSS.highlights.set('glassnote-focus', new Highlight(range));
        clearTimeout(this.focusTimer);
        this.focusTimer = setTimeout(() => CSS.highlights.delete('glassnote-focus'), 1800);
      }
      return true;
    }

    onPageClick(event) {
      if (
        !this.settings.enabled ||
        event.composedPath().includes(this.host) ||
        !document.getSelection()?.isCollapsed ||
        isEditable(event.target) ||
        event.target.closest?.('a,button')
      )
        return;
      // Custom Highlights do not add clickable spans to the host page.
      // Hit-test only after a deliberate click, not on every pointer movement.
      for (const [id, range] of this.ranges) {
        if (
          [...range.getClientRects()].some(
            (rect) =>
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom,
          )
        ) {
          this.focusAnnotation(id);
          break;
        }
      }
    }

    openEditor(annotation = null, pageNote = false) {
      if (this.editor) {
        this.editor.textarea.focus();
        return;
      }
      const previousUrl = this.url;
      this.checkRoute();
      if (annotation && previousUrl !== this.url) {
        this.showToast('页面已经切换，请重新打开要编辑的笔记。');
        return;
      }
      let selected = null;
      try {
        if (!annotation && !pageNote) selected = this.captureSelection();
      } catch (error) {
        this.showToast(errorText(error), true);
        return;
      }
      const record = annotation
        ? { ...annotation }
        : {
            id: newId(),
            type: 'note',
            text: selected?.text || '',
            anchor: selected?.anchor || null,
            content: '',
            color: this.color,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
      this.toolbar.hidden = true;
      const overlay = node('div', 'editor-overlay');
      const dialog = node('section', 'editor glass');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-labelledby', 'gn-editor-title');
      const header = node('header', 'editor-header');
      const headings = node('div');
      const heading = node('h2', '', annotation ? '编辑笔记' : '新建笔记');
      heading.id = 'gn-editor-title';
      headings.append(heading);
      header.append(
        headings,
        button('关闭编辑器', 'icon-button icon-only', 'close', () => this.closeEditor()),
      );
      const body = node('div', 'editor-body');
      const page = node('p', 'editor-page', this.title);
      page.title = this.title;
      body.append(page);
      if (record.text) body.append(node('blockquote', 'editor-quote', record.text));
      const textarea = node('textarea', 'note-input');
      textarea.value = record.content || '';
      textarea.setAttribute('aria-label', '笔记内容');
      textarea.maxLength = 100000;
      textarea.rows = 7;
      const detail = node('div', 'editor-detail');
      const palette = this.makePalette((color) => {
        record.color = color;
        this.updateDraftStatus();
      }, record.color);
      const hint = node('span', 'draft-status');
      detail.append(palette, hint);
      const error = node('div', 'editor-error');
      error.hidden = true;
      error.setAttribute('role', 'alert');
      body.append(textarea, detail, error);
      const footer = node('footer', 'editor-footer');
      const actions = node('div', 'action-row');
      const cancel = button('取消', 'secondary', null, () => this.closeEditor());
      const save = button('保存笔记', 'primary', 'check', () => this.saveEditor());
      actions.append(cancel, save);
      footer.append(actions);
      const discard = node('div', 'discard');
      discard.hidden = true;
      discard.append(node('p', '', '还有未保存的内容，是否放弃？'));
      const discardActions = node('div', 'action-row');
      discardActions.append(
        button('继续编辑', 'secondary small', null, () => {
          discard.hidden = true;
          textarea.focus();
        }),
        button('放弃修改', 'danger-button small', null, () => this.closeEditor(true)),
      );
      discard.append(discardActions);
      dialog.append(header, body, discard, footer);
      overlay.append(dialog);
      this.shadow.append(overlay);
      this.editor = {
        overlay,
        dialog,
        record,
        existing: !!annotation,
        url: this.url,
        title: this.title,
        original: record.content || '',
        originalColor: record.color,
        textarea,
        hint,
        error,
        save,
        cancel,
        discard,
        saving: false,
        previousFocus: this.shadow.activeElement,
      };
      textarea.addEventListener('input', () => this.updateDraftStatus());
      dialog.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') this.trapFocus(event, dialog);
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          this.saveEditor();
        }
      });
      textarea.focus();
    }

    updateDraftStatus() {
      if (!this.editor) return;
      this.editor.hint.textContent = this.editorDirty() ? '草稿尚未保存' : '';
      this.editor.error.hidden = true;
    }

    editorDirty() {
      return (
        this.editor &&
        (this.editor.textarea.value !== this.editor.original ||
          this.editor.record.color !== this.editor.originalColor)
      );
    }

    closeEditor(discard = false) {
      if (!this.editor || this.editor.saving) return;
      if (!discard && this.editorDirty()) {
        this.editor.discard.hidden = false;
        return;
      }
      const focus = this.editor.previousFocus;
      this.editor.overlay.remove();
      this.editor = null;
      if (focus?.isConnected) focus.focus({ preventScroll: true });
      else if (this.panelOpen) this.searchInput.focus({ preventScroll: true });
    }

    async saveEditor() {
      const editor = this.editor;
      if (!editor || editor.saving) return;
      const content = editor.textarea.value.trim();
      if (!content && !editor.record.text) {
        editor.error.textContent = '先写下一点想法，再保存这条页面笔记。';
        editor.error.hidden = false;
        editor.textarea.focus();
        return;
      }
      editor.saving = true;
      editor.save.disabled = true;
      editor.cancel.disabled = true;
      editor.save.querySelector('span').textContent = '正在保存…';
      editor.error.hidden = true;
      try {
        if (editor.existing) {
          await GNStore.updateNote(editor.url, editor.record.id, {
            content,
            ...(editor.record.color !== editor.originalColor ? { color: editor.record.color } : {}),
          });
        } else {
          await GNStore.upsert(editor.url, editor.title, {
            ...editor.record,
            content,
            updatedAt: Date.now(),
          });
        }
        editor.saving = false;
        this.closeEditor(true);
        document.getSelection()?.removeAllRanges();
        this.selectedRange = null;
        if (editor.url === this.url) {
          await this.loadPage({ forceRestore: true });
          this.openPanel();
        }
        this.showToast(
          editor.url !== this.url
            ? '笔记已保存到原来的页面。'
            : this.settings.autoRestore
              ? '笔记已保存，下次打开会自动恢复。'
              : '笔记已保存，可在本页笔记中重新查看。',
        );
      } catch (error) {
        editor.error.textContent = `保存失败：${errorText(error)} 你的草稿仍保留在这里。`;
        editor.error.hidden = false;
        editor.saving = false;
        editor.save.disabled = false;
        editor.cancel.disabled = false;
        editor.save.querySelector('span').textContent = '重试保存';
      }
    }

    trapFocus(event, container) {
      const controls = [
        ...container.querySelectorAll('button:not([disabled]), input, textarea, [tabindex="0"]'),
      ].filter((item) => item.getClientRects().length);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && this.shadow.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && this.shadow.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    onKey(event) {
      if (event.key === 'Escape') {
        if (this.editor) {
          event.preventDefault();
          this.closeEditor();
        } else if (!this.toolbar.hidden) this.toolbar.hidden = true;
        else if (this.panelOpen) this.closePanel();
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyG') {
        event.preventDefault();
        this.handleMessage({ action: 'toggle' })
          .then((result) => {
            this.showToast(result.enabled ? '已显示网页标注。' : '已隐藏网页标注，笔记仍然保留。');
          })
          .catch((error) => this.showToast(`切换失败：${errorText(error)}`, true));
      }
    }

    showToast(message, failure = false) {
      clearTimeout(this.toastTimer);
      this.toast.replaceChildren(icon(failure ? 'note' : 'check'), node('span', '', message));
      this.toast.classList.toggle('is-error', failure);
      this.toast.hidden = false;
      this.toastTimer = setTimeout(
        () => {
          this.toast.hidden = true;
        },
        failure ? 7000 : 3500,
      );
    }
  }

  const SHADOW_STYLES = `
    :host {
      all: initial;
      color-scheme: light;
    }
    .selection-toolbar,
    .launcher,
    .panel,
    .toast,
    .editor-overlay {
      font-family:
        Inter,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        "PingFang SC",
        "Microsoft YaHei",
        sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #243b36;
      font-weight: 400;
      letter-spacing: 0;
      text-align: left;
      color-scheme: light;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    [hidden] {
      display: none !important;
    }
    button,
    input,
    textarea {
      font: inherit;
    }
    button {
      cursor: pointer;
      user-select: none;
    }
    button:disabled {
      cursor: wait;
      opacity: 0.55;
    }
    button,
    input,
    textarea {
      outline: none;
    }
    button:focus-visible,
    input:focus-visible,
    textarea:focus-visible {
      outline: 3px solid #9bcaba;
      outline-offset: 3px;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      border: 0;
      margin: 0;
      text-decoration: none;
      line-height: 1.35;
    }
    p,
    h2,
    h3,
    blockquote {
      margin: 0;
    }
    svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .glass {
      background: rgba(253, 253, 249, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.95);
      box-shadow:
        0 18px 65px -20px #183e3440,
        0 0 0 1px #29463a12;
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
    }
    .selection-toolbar {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 3px;
      border-radius: 15px;
      padding: 6px;
      max-width: calc(100vw - 24px);
      pointer-events: auto;
      z-index: 4;
      animation: appear 0.14s ease-out;
    }
    .tool {
      background: transparent;
      color: #456159;
      height: 35px;
      padding: 0 9px;
      border-radius: 9px;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 600;
    }
    .tool:hover {
      background: #e8f1eb;
    }
    .tool[aria-pressed="true"] {
      background: #e5eee7;
      color: #24584b;
    }
    .icon-only {
      width: 33px;
      padding: 0;
      flex-shrink: 0;
    }
    .divider {
      width: 1px;
      height: 21px;
      background: #dce4dc;
      margin: 0 4px;
    }
    .palette {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 4px;
    }
    .swatch {
      position: relative;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 0 1px #31543d0d;
    }
    .swatch[data-color="yellow"] {
      background: #ecd487;
    }
    .swatch[data-color="green"] {
      background: #a8d7b9;
    }
    .swatch[data-color="blue"] {
      background: #a7cde8;
    }
    .swatch[data-color="pink"] {
      background: #e7b6c8;
    }
    .swatch[aria-pressed="true"] {
      box-shadow: 0 0 0 2px #527e6e;
    }
    .swatch:hover {
      transform: scale(1.08);
    }
    .launcher {
      position: fixed;
      bottom: 28px;
      right: 26px;
      height: 43px;
      border-radius: 14px;
      gap: 11px;
      padding: 0 13px;
      color: #356b5b;
      pointer-events: auto;
      z-index: 2;
      transition:
        transform 0.15s,
        background 0.15s;
    }
    .launcher:hover {
      transform: translateY(-2px);
      background: #fff;
    }
    .launcher-count {
      font-weight: 700;
      font-size: 13px;
    }
    .panel {
      position: fixed;
      display: flex;
      flex-direction: column;
      top: 16px;
      bottom: 16px;
      right: 16px;
      width: 374px;
      max-width: calc(100vw - 24px);
      border-radius: 24px;
      pointer-events: auto;
      overflow: hidden;
      z-index: 3;
      animation: panel-in 0.2s ease-out;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 23px 24px 12px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-mark {
      width: 31px;
      height: 34px;
      background: #376c5b;
      color: #fff;
      border-radius: 10px;
      font-family: Georgia, serif;
      font-style: italic;
      font-size: 29px;
      line-height: 26px;
      text-align: center;
      box-shadow: inset 0 1px 1px #ffffff70;
    }
    .brand-word {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 24px;
      letter-spacing: -0.9px;
      color: #29463c;
    }
    .icon-button {
      width: 31px;
      height: 31px;
      border-radius: 9px;
      color: #687b71;
      background: transparent;
    }
    .icon-button:hover {
      background: #e9eee7;
      color: #244c3c;
    }
    .panel-intro {
      padding: 16px 24px 18px;
    }
    .page-title {
      font-size: 21px;
      font-weight: 650;
      letter-spacing: -0.5px;
      line-height: 1.55;
      color: #2e493f;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .page-summary {
      color: #859086;
      font-size: 11px;
      margin-top: 9px;
    }
    .notice {
      margin: 0 20px 12px;
      padding: 11px 13px;
      border-radius: 11px;
      background: #f5efdc;
      color: #867442;
      font-size: 11px;
      line-height: 1.7;
    }
    .notice .text-button {
      margin-top: 5px;
      color: #716036;
    }
    .panel-controls {
      padding: 0 20px;
    }
    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #f0f2eb;
      border: 1px solid #e3e8df;
      border-radius: 10px;
      padding: 0 11px;
      color: #93a093;
      height: 37px;
    }
    .search svg {
      width: 15px;
      height: 15px;
    }
    .search input {
      width: 100%;
      min-width: 0;
      border: 0;
      background: transparent;
      color: #395345;
      font-size: 12px;
      padding: 6px 0;
    }
    .search input::placeholder {
      color: #98a296;
    }
    .filters {
      display: flex;
      gap: 7px;
      margin: 15px 0 12px;
    }
    .filter {
      background: transparent;
      border: 1px solid transparent;
      color: #879284;
      padding: 6px 13px;
      border-radius: 8px;
      font-size: 11px;
    }
    .filter[aria-pressed="true"] {
      background: #e6eee4;
      border-color: #d8e4d5;
      color: #446a53;
      font-weight: 650;
    }
    .filter:hover {
      background: #edf2e8;
    }
    .cards {
      min-height: 0;
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 3px 20px 16px;
      scrollbar-width: thin;
      scrollbar-color: #d7dfd3 transparent;
    }
    .card {
      border: 1px solid #e3e8dc;
      background: rgba(255, 255, 252, 0.83);
      border-radius: 14px;
      padding: 14px 15px 10px;
      margin-bottom: 11px;
      box-shadow: 0 3px 9px #31452603;
      --accent: #ddc778;
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
    }
    .card:hover {
      border-color: #cbdccc;
      box-shadow: 0 6px 15px #31452608;
    }
    .color-green {
      --accent: #9bcaac;
    }
    .color-blue {
      --accent: #98bfde;
    }
    .color-pink {
      --accent: #daabc0;
    }
    .card.is-focused {
      border-color: #85af91;
      box-shadow: 0 0 0 3px #ceddcc50;
    }
    .card-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      color: #a0aa9b;
      font-size: 10px;
    }
    .card-kind {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #89957f;
      font-weight: 600;
    }
    .color-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
    }
    .quote-button {
      display: block;
      text-align: left;
      width: 100%;
      padding: 0;
      background: none;
      color: #415447;
      border-radius: 2px;
    }
    .quote-button blockquote {
      border-left: 3px solid var(--accent);
      padding: 1px 0 1px 10px;
      font-size: 13px;
      line-height: 1.8;
      display: -webkit-box;
      -webkit-line-clamp: 5;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .quote-button:hover {
      color: #1e583e;
    }
    .note-content {
      font-size: 12px;
      color: #6a7667;
      line-height: 1.85;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin-top: 11px;
    }
    .card-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      border-top: 1px solid #edf0e8;
      margin-top: 13px;
      padding-top: 8px;
    }
    .text-button {
      padding: 3px 0;
      background: none;
      color: #7f957f;
      font-size: 10px;
      gap: 4px;
    }
    .text-button svg {
      width: 12px;
      height: 12px;
    }
    .text-button:hover {
      color: #2f6650;
    }
    .card-actions .danger {
      margin-left: auto;
      color: #a7afa1;
    }
    .card-actions .danger:hover {
      color: #ab655c;
    }
    .page-note-label {
      color: #adb4a7;
      font-size: 10px;
      flex: 1;
    }
    .unresolved {
      font-size: 10px;
      color: #ad9559;
      margin-top: 10px;
    }
    .delete-confirm {
      border-top: 1px solid #ede4d8;
      margin-top: 8px;
      padding-top: 10px;
    }
    .delete-confirm p,
    .discard p {
      font-size: 11px;
      color: #98755a;
      margin-bottom: 10px;
    }
    .delete-confirm .action-row {
      justify-content: flex-end;
    }
    .panel-footer {
      padding: 15px 20px 17px;
      background: linear-gradient(#fcfcf800, #f7f9f2);
      border-top: 1px solid #e9eee2;
    }
    .primary {
      background: #376b58;
      color: white;
      border: 1px solid #376b58;
      box-shadow: 0 2px 5px #2b594413;
      border-radius: 10px;
      min-height: 39px;
      padding: 10px 17px;
      font-size: 12px;
      font-weight: 600;
      gap: 7px;
    }
    .primary:hover {
      background: #2d5d4a;
    }
    .primary svg {
      width: 16px;
      height: 16px;
    }
    .wide {
      width: 100%;
    }
    .empty {
      padding: 35px 10px;
      text-align: center;
      color: #87927e;
    }
    .empty h3 {
      font-size: 16px;
      font-weight: 600;
      color: #718167;
      margin-bottom: 12px;
    }
    .muted {
      color: #a2aa9b;
    }
    .toast {
      position: fixed;
      bottom: 30px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 8;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
      border-radius: 13px;
      max-width: calc(100vw - 32px);
      font-size: 12px;
      line-height: 1.7;
      color: #3a6851;
      pointer-events: none;
      animation: appear 0.15s ease-out;
    }
    .toast svg {
      width: 17px;
      height: 17px;
    }
    .toast.is-error {
      color: #a5644f;
      background: #fffaf3;
    }
    .editor-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 22px;
      background: rgba(29, 48, 39, 0.13);
      backdrop-filter: blur(3px);
      pointer-events: auto;
      z-index: 7;
    }
    .editor {
      width: 500px;
      max-width: 100%;
      max-height: calc(100vh - 44px);
      overflow-y: auto;
      border-radius: 23px;
      animation: appear 0.18s ease-out;
    }
    .editor-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 26px 27px 17px;
    }
    .editor-header h2 {
      font-family: Georgia, "Songti SC", serif;
      font-size: 23px;
      letter-spacing: -0.4px;
      font-weight: 600;
      color: #3d5a46;
    }
    .editor-body {
      padding: 0 27px;
    }
    .editor-page {
      font-size: 11px;
      color: #8d9a86;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 18px;
    }
    .editor-quote {
      background: #f0f3e7;
      border-left: 3px solid #c3d29e;
      border-radius: 0 8px 8px 0;
      padding: 12px 14px;
      font-size: 12px;
      line-height: 1.9;
      color: #6d7c5f;
      max-height: 130px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin-bottom: 17px;
    }
    .note-input {
      display: block;
      width: 100%;
      min-height: 155px;
      resize: vertical;
      border: 1px solid #dfe7d7;
      border-radius: 12px;
      background: rgba(255, 255, 253, 0.8);
      color: #3c5140;
      font-size: 14px;
      line-height: 1.9;
      padding: 14px 16px;
    }
    .note-input::placeholder {
      color: #a6b19b;
    }
    .note-input:focus {
      border-color: #9db991;
    }
    .editor-detail {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 14px 0;
    }
    .editor-detail .palette {
      padding-left: 0;
    }
    .draft-status {
      font-size: 10px;
      color: #9aa68e;
    }
    .editor-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 15px;
      padding: 17px 27px 23px;
      border-top: 1px solid #ebeee2;
    }
    .action-row {
      display: flex;
      align-items: center;
      gap: 9px;
    }
    .secondary {
      min-height: 39px;
      background: #f2f4ec;
      border: 1px solid #e3e8d9;
      border-radius: 10px;
      padding: 9px 15px;
      font-size: 12px;
      color: #819173;
    }
    .secondary:hover {
      background: #e8eedf;
    }
    .danger-button {
      background: #f9eae3;
      border: 1px solid #ecd8cc;
      border-radius: 9px;
      padding: 8px 12px;
      color: #9a6450;
      font-size: 12px;
    }
    .small {
      min-height: 30px;
      padding: 6px 11px;
      font-size: 11px;
    }
    .editor-error {
      color: #a66a52;
      font-size: 12px;
      line-height: 1.8;
      background: #faf0e5;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 15px;
    }
    .discard {
      background: #fbf4e7;
      margin: 0 27px 17px;
      padding: 13px;
      border-radius: 9px;
    }
    .discard .action-row {
      justify-content: flex-end;
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    @keyframes panel-in {
      from {
        opacity: 0;
        transform: translateX(10px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
    @media (max-width: 500px) {
      .panel {
        right: 8px;
        top: 8px;
        bottom: 8px;
        border-radius: 19px;
        max-width: calc(100vw - 16px);
      }
      .selection-toolbar {
        gap: 0;
        padding: 5px;
      }
      .tool {
        padding: 0 6px;
      }
      .tool.icon-only {
        width: 29px;
      }
      .palette {
        gap: 4px;
        padding: 0 2px;
      }
      .swatch {
        width: 17px;
        height: 17px;
      }
      .divider {
        margin: 0 3px;
      }
      .editor-overlay {
        padding: 12px;
      }
      .editor {
        max-height: calc(100vh - 24px);
      }
      .editor-header {
        padding: 22px 20px 17px;
      }
      .editor-body {
        padding: 0 20px;
      }
      .editor-footer {
        padding: 15px 20px 20px;
      }
      .editor-footer .action-row {
        margin-left: auto;
      }
      .draft-status {
        font-size: 9px;
      }
      .toast {
        width: max-content;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
    @media print {
      :host {
        display: none !important;
      }
    }
  `;

  const app = new GlassNote();
  globalThis.__glassNoteV3 = app;
  app.ready = app.init().catch((error) => {
    app.error = `GlassNote 初始化失败：${errorText(error)}`;
    app.render();
  });
})();
