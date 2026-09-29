/* 无浏览器依赖的数据模型。旧数据保留原键，迁移采用独立的 v3 键。 */
(() => {
  'use strict';
  const canonicalUrl = (globalThis.GNStore || require('./store.js')).canonicalUrl;
  const PAGE_PREFIX = 'gn:page:';
  const SETTINGS_KEY = 'gn:settings';
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    autoRestore: true,
    defaultColor: 'yellow',
  });
  const COLORS = ['yellow', 'green', 'blue', 'pink'];
  const TYPES = ['highlight', 'underline', 'bold', 'note'];
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const string = (value, max = 100000) => (typeof value === 'string' ? value.slice(0, max) : '');
  function hash(value) {
    let result = 2166136261;
    for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
    return (result >>> 0).toString(36);
  }
  function date(value, fallback = '') {
    if (!value) return fallback;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  function color(value) {
    if (COLORS.includes(value)) return value;
    if (/^(red|pink|#ff0000|#ff6b6b)$/i.test(value || '')) return 'pink';
    if (/^(green|#00ff00|#4caf50)$/i.test(value || '')) return 'green';
    if (/^(blue|#0000ff|#2196f3)$/i.test(value || '')) return 'blue';
    return 'yellow';
  }
  function normalizeAnnotation(input, index = 0, strict = false) {
    if (!isObject(input)) throw new Error('笔记数据格式不正确');
    const type = TYPES.includes(input.type)
      ? input.type
      : input.type === 'orange-underline'
        ? 'underline'
        : input.type === 'note' || 'selectedText' in input || 'content' in input
          ? 'note'
          : 'highlight';
    const text = string(input.text || input.selectedText || input.anchor?.quote?.exact);
    const content = string(input.content);
    if (
      strict &&
      !TYPES.includes(input.type) &&
      !['color', 'box', 'orange-underline', undefined].includes(input.type)
    )
      throw new Error('无法识别的标注类型');
    if (!text.trim() && !content.trim()) throw new Error('笔记内容不能为空');
    if (
      strict &&
      [input.text, input.selectedText, input.anchor?.quote?.exact, input.content].some(
        (value) => (value?.length || 0) > 100000,
      )
    )
      throw new Error('单条笔记不能超过 100000 字符');
    const annotation = {
      id: string(input.id, 200) || `legacy-${hash(`${type}:${text}:${content}:${index}`)}`,
      type,
      text,
      content,
      color: color(input.color),
      createdAt: date(input.createdAt || input.timestamp, ''),
      updatedAt: date(input.updatedAt || input.createdAt || input.timestamp, ''),
    };
    // 保留旧定位证据，交给统一锚点模块解释；任何字段都不执行为 HTML。
    for (const key of [
      'anchor',
      'context',
      'domPath',
      'textOffset',
      'hierarchy',
      'contentZone',
      'structure',
      'anchors',
    ]) {
      if (input[key] !== undefined) annotation[key] = JSON.parse(JSON.stringify(input[key]));
    }
    return annotation;
  }
  function normalizePage(input, rawUrl, strict = false) {
    if (!isObject(input)) throw new Error('页面数据格式不正确');
    const url = canonicalUrl(rawUrl || input.url);
    if (strict && input.annotations !== undefined && !Array.isArray(input.annotations))
      throw new Error('标注列表格式不正确');
    if (strict && input.notes !== undefined && !Array.isArray(input.notes))
      throw new Error('便签列表格式不正确');
    if (strict && input.elements !== undefined && !Array.isArray(input.elements))
      throw new Error('旧标注列表格式不正确');
    const records = [
      ...(Array.isArray(input.annotations)
        ? input.annotations
        : Array.isArray(input.elements)
          ? input.elements
          : []),
      ...(Array.isArray(input.notes) ? input.notes.map((note) => ({ ...note, type: 'note' })) : []),
    ];
    const unique = new Map();
    records.forEach((item, index) => {
      try {
        const record = normalizeAnnotation(item, index, strict);
        // 旧版本可能把同一 note 同时存到 annotations 和 notes；后者含实际便签内容。
        const previous = unique.get(record.id);
        unique.set(
          record.id,
          previous
            ? {
                ...previous,
                ...record,
                text: record.text || previous.text,
                content: record.content || previous.content,
                anchor: record.anchor || previous.anchor,
              }
            : record,
        );
      } catch (error) {
        if (strict) throw error;
      }
    });
    const annotations = [...unique.values()];
    const latest = annotations.reduce(
      (value, item) => (item.updatedAt > value ? item.updatedAt : value),
      '',
    );
    const legacyTitle = records.find((item) => typeof item?.pageTitle === 'string')?.pageTitle;
    return {
      schemaVersion: 3,
      url,
      title:
        string(input.title || input.pageTitle || legacyTitle, 1000) ||
        new URL(url).hostname ||
        '本地网页',
      updatedAt: date(input.updatedAt || input.lastModified, latest),
      annotations,
    };
  }
  function pagesFromStorage(all) {
    const pages = new Map();
    // 原始 URL 格式仍可读取；v3 数据（包括删除后的空列表）始终覆盖旧格式。
    for (const [key, value] of Object.entries(all)) {
      if (!/^(https?:|file:)/.test(key) || !isObject(value)) continue;
      try {
        const page = normalizePage(value, key);
        const existing = pages.get(page.url);
        if (existing) {
          const records = new Map(existing.annotations.map((item) => [item.id, item]));
          page.annotations.forEach((item) => {
            if (!records.has(item.id)) records.set(item.id, item);
          });
          page.annotations = [...records.values()];
        }
        pages.set(page.url, page);
      } catch {
        /* 非页面键不参与迁移。 */
      }
    }
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(PAGE_PREFIX)) continue;
      try {
        const page = normalizePage(value, key.slice(PAGE_PREFIX.length));
        pages.set(page.url, page);
      } catch {
        /* 不执行损坏记录。 */
      }
    }
    return [...pages.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function settings(input = {}) {
    return {
      enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
      autoRestore: typeof input.autoRestore === 'boolean' ? input.autoRestore : true,
      defaultColor: COLORS.includes(input.defaultColor) ? input.defaultColor : 'yellow',
    };
  }
  function parseImport(payload) {
    if (!isObject(payload)) throw new Error('请选择 GlassNote 导出的 JSON 文件');
    let entries;
    if (payload.format === 'glassnote' && payload.version === 3 && Array.isArray(payload.pages)) {
      entries = payload.pages.map((page) => [page?.url, page]);
    } else if (/^2\./.test(String(payload.version)) && isObject(payload.data)) {
      entries = Object.entries(payload.data);
    } else throw new Error('不支持此备份格式，请选择 GlassNote v2 或 v3 导出文件');
    if (entries.length > 10000) throw new Error('单次最多导入 10000 个页面');
    return entries.map(([url, page]) => normalizePage(page, url, true));
  }
  const api = {
    canonicalUrl,
    PAGE_PREFIX,
    SETTINGS_KEY,
    DEFAULT_SETTINGS,
    COLORS,
    TYPES,
    isObject,
    normalizeAnnotation,
    normalizePage,
    pagesFromStorage,
    settings,
    parseImport,
  };
  globalThis.GNModel = Object.freeze(api);
  if (typeof module !== 'undefined') module.exports = api;
})();
