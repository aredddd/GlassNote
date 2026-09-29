/* GlassNote 的文本锚点：只读取页面，绝不包装或改写宿主节点。 */
(() => {
  'use strict';

  const VERSION = 3;
  const CONTEXT_LENGTH = 96;
  const EXCLUDED =
    'script,style,noscript,textarea,input,[contenteditable],#glassnote-root,[data-glassnote-root]';
  const SPACE = /\s/u;

  function normalizeText(value) {
    return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  }

  function documentFor(root) {
    return root?.nodeType === 9 ? root : root?.ownerDocument;
  }

  function included(node, root) {
    return (
      !!node &&
      (node === root || root.contains(node)) &&
      !(node.nodeType === 1 ? node : node.parentElement)?.closest(EXCLUDED)
    );
  }

  // 双哈希只用于判断整页文本是否保持不变，不用来做近似匹配。
  function fingerprint(text) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  /**
   * 建立规范化字符到原始 DOM 字符的映射。空白可以跨文本节点折叠，
   * DOM 包装变化不会影响文本位置；按 UTF-16 计数，与 Range 偏移一致。
   */
  function buildIndex(root = document.body) {
    const doc = documentFor(root);
    if (!doc || !included(root, root))
      return { root, document: doc, text: '', entries: [], hash: fingerprint('') };
    const entries = [];
    const chunks = [];
    let length = 0;
    let lastWasSpace = false;
    const walker = doc.createTreeWalker(root, 4, {
      acceptNode(node) {
        return included(node, root) ? 1 : 2;
      },
    });
    // 文本节点也可作为限定查找范围。
    let node = root.nodeType === 3 ? root : walker.nextNode();
    while (node) {
      const offsets = [];
      const normalized = [];
      const source = node.data;
      for (let offset = 0; offset < source.length; offset += 1) {
        const char = source[offset];
        const whitespace = SPACE.test(char);
        if (!whitespace || !lastWasSpace) {
          normalized.push(whitespace ? ' ' : char);
          offsets.push(offset);
        }
        lastWasSpace = whitespace;
      }
      if (normalized.length) {
        const text = normalized.join('');
        entries.push({ node, start: length, end: length + text.length, offsets });
        chunks.push(text);
        length += text.length;
      }
      node = root.nodeType === 3 ? null : walker.nextNode();
    }
    const text = chunks.join('');
    return { root, document: doc, text, entries, hash: fingerprint(text) };
  }

  function entryAt(index, position) {
    let low = 0;
    let high = index.entries.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = index.entries[middle];
      if (position < entry.start) high = middle - 1;
      else if (position >= entry.end) low = middle + 1;
      else return entry;
    }
    return null;
  }

  function rangeAt(index, start, end) {
    const first = entryAt(index, start);
    const last = entryAt(index, end - 1);
    if (!first || !last || !included(first.node, index.root) || !included(last.node, index.root))
      return null;
    try {
      const range = index.document.createRange();
      range.setStart(first.node, first.offsets[start - first.start]);
      range.setEnd(last.node, last.offsets[end - 1 - last.start] + 1);
      // createResolver 的索引仅限本批使用；意外复用过期快照也不能返回错误文本。
      if (normalizeText(range.toString()) !== index.text.slice(start, end)) return null;
      return range;
    } catch (_) {
      return null;
    }
  }

  function capture(range, root = document.body) {
    if (
      !range ||
      range.collapsed ||
      !root ||
      !included(range.startContainer, root) ||
      !included(range.endContainer, root)
    )
      return null;
    const index = buildIndex(root);
    let start = -1;
    let end = -1;
    try {
      for (const entry of index.entries) {
        if (range.comparePoint(entry.node, entry.node.length) < 0) continue;
        if (range.comparePoint(entry.node, 0) > 0) break;
        for (let i = 0; i < entry.offsets.length; i += 1) {
          const offset = entry.offsets[i];
          if (
            range.comparePoint(entry.node, offset) === 0 &&
            range.comparePoint(entry.node, offset + 1) === 0
          ) {
            if (start < 0) start = entry.start + i;
            end = entry.start + i + 1;
          }
        }
      }
    } catch (_) {
      return null;
    }
    if (start < 0) return null;
    while (start < end && index.text[start] === ' ') start += 1;
    while (end > start && index.text[end - 1] === ' ') end -= 1;
    if (start === end) return null;
    const exact = index.text.slice(start, end);
    // 跨过被排除的可编辑区或扩展 UI 时拒绝生成不完整的锚点。
    if (normalizeText(range.toString()) !== exact) return null;
    return {
      version: VERSION,
      quote: {
        exact,
        prefix: index.text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
        suffix: index.text.slice(end, end + CONTEXT_LENGTH),
        occurrenceCount: occurrences(index.text, exact).length,
      },
      position: { start, end },
      document: { length: index.text.length, hash: index.hash },
    };
  }

  function occurrences(text, exact) {
    const found = [];
    if (!exact) return found;
    let cursor = 0;
    while (cursor <= text.length - exact.length) {
      const position = text.indexOf(exact, cursor);
      if (position < 0) break;
      found.push(position);
      cursor = position + 1; // 重叠同文也必须计入歧义。
    }
    return found;
  }

  function unpack(record) {
    if (!record || typeof record !== 'object') return null;
    const source = record.anchor && typeof record.anchor === 'object' ? record.anchor : record;
    const textQuote = source.quote || source.textQuote || {};
    const exact = normalizeText(
      textQuote.exact ||
        source.exact ||
        source.text ||
        source.selectedText ||
        record.text ||
        record.selectedText,
    );
    if (!exact) return null;
    const context = source.context || record.context || {};
    const oldQuote = source.anchors?.byText || record.anchors?.byText || {};
    let prefix = normalizeText(
      textQuote.prefix ?? source.prefix ?? context.beforeText ?? oldQuote.before ?? '',
    );
    let suffix = normalizeText(
      textQuote.suffix ?? source.suffix ?? context.afterText ?? oldQuote.after ?? '',
    );
    const parentText = normalizeText(context.parentText);
    // 旧版常在包装 span 之后取上下文，before/after 为空；parentText 可补足证据。
    const parentMatches = occurrences(parentText, exact);
    if (!prefix && !suffix && parentMatches.length === 1) {
      const at = parentMatches[0];
      prefix = normalizeText(parentText.slice(Math.max(0, at - CONTEXT_LENGTH), at));
      suffix = normalizeText(
        parentText.slice(at + exact.length, at + exact.length + CONTEXT_LENGTH),
      );
    }
    return {
      exact,
      prefix,
      suffix,
      occurrenceCount: textQuote.occurrenceCount,
      position: source.position || source.textPosition,
      document: source.document,
      domPath: source.domPath || record.domPath,
      textOffset: source.textOffset || record.textOffset,
      parentText,
    };
  }

  function commonSuffix(first, second) {
    let length = 0;
    while (
      length < first.length &&
      length < second.length &&
      first[first.length - length - 1] === second[second.length - length - 1]
    )
      length += 1;
    return length;
  }

  function commonPrefix(first, second) {
    let length = 0;
    while (length < first.length && length < second.length && first[length] === second[length])
      length += 1;
    return length;
  }

  function significant(text) {
    return text.replace(/[^\p{L}\p{N}]/gu, '').length;
  }

  function contextAt(index, anchor, start) {
    const end = start + anchor.exact.length;
    const before = index.text.slice(Math.max(0, start - anchor.prefix.length - 1), start).trimEnd();
    const after = index.text.slice(end, end + anchor.suffix.length + 1).trimStart();
    const left = commonSuffix(before, anchor.prefix);
    const right = commonPrefix(after, anchor.suffix);
    const leftWeight = significant(anchor.prefix.slice(anchor.prefix.length - left));
    const rightWeight = significant(anchor.suffix.slice(0, right));
    const fullLeft = !!anchor.prefix && left === anchor.prefix.length;
    const fullRight = !!anchor.suffix && right === anchor.suffix.length;
    const full = (!anchor.prefix || fullLeft) && (!anchor.suffix || fullRight);
    const leftRequired = Math.min(4, significant(anchor.prefix));
    const rightRequired = Math.min(4, significant(anchor.suffix));
    const corroborated = leftWeight >= leftRequired && rightWeight >= rightRequired;
    return {
      start,
      end,
      full,
      evidence: leftWeight + rightWeight,
      score: leftWeight + rightWeight + (fullLeft ? 4 : 0) + (fullRight ? 4 : 0),
      completeSide: (fullLeft && leftWeight >= 8) || (fullRight && rightWeight >= 8),
      // 单侧短上下文必须完整；较长上下文允许远端内容变化。
      strong:
        corroborated &&
        ((full && leftWeight + rightWeight >= 4) || leftWeight >= 12 || rightWeight >= 12),
    };
  }

  function legacyLocation(index, anchor, candidates) {
    // 旧的 nth-child/nth-of-type 路径易随插入内容漂移，不能凭它消歧。
    // 只有指向独立稳定 ID，且旧父文本、字符长度、偏移全部验证通过时使用。
    if (
      typeof anchor.domPath !== 'string' ||
      !/^(?:[a-z][\w-]*)?#[\w-]+$/iu.test(anchor.domPath) ||
      !anchor.textOffset ||
      !anchor.parentText
    )
      return null;
    try {
      const root = index.root;
      const matches = Array.from(root.querySelectorAll?.(anchor.domPath) || []);
      if (root.nodeType === 1 && root.matches(anchor.domPath)) matches.unshift(root);
      if (matches.length !== 1 || !included(matches[0], root)) return null;
      const element = matches[0];
      const raw = element.textContent || '';
      const { startIndex, endIndex, elementTextLength } = anchor.textOffset;
      if (
        !Number.isInteger(startIndex) ||
        !Number.isInteger(endIndex) ||
        startIndex < 0 ||
        endIndex <= startIndex ||
        raw.length !== elementTextLength ||
        endIndex > raw.length
      )
        return null;
      if (
        normalizeText(raw) !== anchor.parentText ||
        normalizeText(raw.slice(startIndex, endIndex)) !== anchor.exact
      )
        return null;
      const local = buildIndex(element);
      const localStart = raw.slice(0, startIndex).replace(/\s+/gu, ' ').length;
      if (local.text.slice(localStart, localStart + anchor.exact.length) !== anchor.exact)
        return null;
      const expected = rangeAt(local, localStart, localStart + anchor.exact.length);
      if (!expected) return null;
      return (
        candidates.find((candidate) => {
          const actual = rangeAt(index, candidate.start, candidate.end);
          return (
            actual &&
            actual.startContainer === expected.startContainer &&
            actual.startOffset === expected.startOffset
          );
        }) || null
      );
    } catch (_) {
      return null;
    }
  }

  function resolveInIndex(record, index) {
    const anchor = unpack(record);
    if (!anchor) return { range: null, status: 'invalid', reason: 'empty-quote', candidates: 0 };
    const positions = occurrences(index.text, anchor.exact);
    if (!positions.length)
      return { range: null, status: 'missing', reason: 'quote-not-found', candidates: 0 };
    const result = (candidate, method) => {
      const range = rangeAt(index, candidate.start, candidate.end);
      return range
        ? { range, status: 'resolved', method, candidates: positions.length }
        : { range: null, status: 'missing', reason: 'dom-changed', candidates: positions.length };
    };
    const { position, document: savedDocument } = anchor;
    if (
      savedDocument?.length === index.text.length &&
      savedDocument?.hash === index.hash &&
      Number.isInteger(position?.start) &&
      Number.isInteger(position?.end) &&
      position.end - position.start === anchor.exact.length &&
      positions.includes(position.start)
    ) {
      return result(position, 'verified-position');
    }
    const hasContext = !!(anchor.prefix || anchor.suffix);
    const candidates = positions.map((start) => contextAt(index, anchor, start));
    if (!hasContext && candidates.length === 1) return result(candidates[0], 'unique-quote');
    if (hasContext) {
      const full = candidates.filter((candidate) => candidate.full && candidate.evidence > 0);
      if (full.length === 1) return result(full[0], 'quote-context');
      // 完整上下文仍重复时不能再按“距离旧位置近”随意择一。
      if (full.length > 1) {
        const legacy = legacyLocation(index, anchor, full);
        return legacy
          ? result(legacy, 'verified-legacy-location')
          : {
              range: null,
              status: 'ambiguous',
              reason: 'repeated-context',
              candidates: positions.length,
            };
      }
      // 原本和现在都只出现一次的长摘录，本身已有强辨识度。
      // 一侧完整上下文仍在时，允许另一侧被插入内容打断；原本重复的摘录不享受此放宽。
      if (
        anchor.occurrenceCount === 1 &&
        candidates.length === 1 &&
        anchor.exact.length >= 32 &&
        significant(anchor.exact) >= 24 &&
        candidates[0].completeSide
      ) {
        return result(candidates[0], 'unique-long-quote-context');
      }
      const ranked = candidates.slice().sort((a, b) => b.score - a.score);
      if (ranked[0].strong && (!ranked[1] || ranked[0].score - ranked[1].score >= 8))
        return result(ranked[0], 'partial-context');
    }
    const legacy = legacyLocation(index, anchor, candidates);
    if (legacy) return result(legacy, 'verified-legacy-location');
    return {
      range: null,
      status: candidates.length > 1 ? 'ambiguous' : 'missing',
      reason: hasContext ? 'context-mismatch' : 'repeated-quote',
      candidates: positions.length,
    };
  }

  /** 同一个恢复批次复用一次索引；DOM 变化后必须创建新的 resolver。 */
  function createResolver(root = document.body) {
    const index = buildIndex(root);
    return {
      resolve(record) {
        return resolveInIndex(record, index).range;
      },
      resolveDetailed(record) {
        return resolveInIndex(record, index);
      },
    };
  }

  function resolveDetailed(record, root = document.body) {
    return createResolver(root).resolveDetailed(record);
  }

  function resolve(record, root = document.body) {
    return resolveDetailed(record, root).range;
  }

  globalThis.GNAnchor = Object.freeze({
    version: VERSION,
    capture,
    resolve,
    resolveDetailed,
    createResolver,
    normalizeText,
  });
})();
