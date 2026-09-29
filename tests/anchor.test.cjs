'use strict';

const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const { chromium } = require('playwright');

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function withPage(html, run) {
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    await page.addScriptTag({ path: path.join(__dirname, '../src/shared/anchor.js') });
    return await run(page);
  } finally {
    await page.close();
  }
}

test('跨行跨节点的选区保存后能恢复，且完全不改写页面 DOM', async () => {
  const result = await withPage(
    '<article><p>开头：保存 <em>重要\n  内容</em>，并且 <a href="#">保留链接</a>。结尾</p></article>',
    (page) =>
      page.evaluate(() => {
        const range = document.createRange();
        range.setStart(document.querySelector('p').firstChild, 3);
        range.setEnd(document.querySelector('a').firstChild, 4);
        const before = document.body.innerHTML;
        const anchor = GNAnchor.capture(range);
        const restored = GNAnchor.resolve({ anchor });
        return {
          anchor,
          selected: range.toString(),
          restored: restored?.toString(),
          before,
          after: document.body.innerHTML,
        };
      }),
  );
  assert.equal(result.anchor.quote.exact, '保存 重要 内容，并且 保留链接');
  assert.equal(result.restored, result.selected);
  assert.equal(result.after, result.before);
});

test('重新打开、节点重新包装和增加页首内容后，重复原文根据上下文恢复', async () => {
  const result = await withPage(
    '<p id="first">第一处说明提到 收藏这句话 用于背景。</p><p id="target">真正读到的这段内容，把 收藏这句话 留作研究记录，继续阅读。</p>',
    async (page) => {
      const anchor = await page.evaluate(() => {
        const text = document.querySelector('#target').firstChild;
        const start = text.data.indexOf('收藏这句话');
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 5);
        return GNAnchor.capture(range);
      });
      await page.setContent(
        '<header>新的通知和导航</header><main><section><p>第一处说明提到 收藏这句话 用于背景。</p></section><section id="correct">真正读到的这段内容，把 <span>收藏</span><strong>这句话</strong> 留作研究记录，继续阅读。</section></main>',
      );
      return page.evaluate((anchor) => {
        const result = GNAnchor.resolveDetailed({ anchor });
        return {
          status: result.status,
          text: result.range?.toString(),
          correct:
            !!result.range &&
            document.querySelector('#correct').contains(result.range.startContainer),
        };
      }, anchor);
    },
  );
  assert.deepEqual(result, { status: 'resolved', text: '收藏这句话', correct: true });
});

test('归一化空白的变化不影响选区，emoji 的 UTF-16 偏移保持正确', async () => {
  const result = await withPage('<p>起始 前缀 📝 hello\n\t world 结束 后缀</p>', async (page) => {
    const anchor = await page.evaluate(() => {
      const text = document.querySelector('p').firstChild;
      const range = document.createRange();
      range.setStart(text, text.data.indexOf('📝'));
      range.setEnd(text, text.data.indexOf(' 结束'));
      return GNAnchor.capture(range);
    });
    await page.setContent(
      '<section>起始 前缀 <b>📝 hello</b> &nbsp; <i>world</i> 结束 后缀</section>',
    );
    return page.evaluate(
      (anchor) => ({
        exact: anchor.quote.exact,
        resolved: GNAnchor.normalizeText(GNAnchor.resolve(anchor)?.toString()),
      }),
      anchor,
    );
  });
  assert.deepEqual(result, { exact: '📝 hello world', resolved: '📝 hello world' });
});

test('全文完全未变时，已验证的位置可区分完全相同的多个段落', async () => {
  const result = await withPage(
    '<p>相同段落相同原文相同结尾</p><p>相同段落相同原文相同结尾</p>',
    (page) =>
      page.evaluate(() => {
        const second = document.querySelectorAll('p')[1].firstChild;
        const range = document.createRange();
        range.setStart(second, 4);
        range.setEnd(second, 8);
        const anchor = GNAnchor.capture(range);
        // 两侧上下文也相同的情况，只能用已验证的全文与位置处理。
        anchor.quote.prefix = '相同段落';
        anchor.quote.suffix = '相同结尾';
        const result = GNAnchor.resolveDetailed(anchor);
        return { method: result.method, isSecond: result.range?.startContainer === second };
      }),
  );
  assert.deepEqual(result, { method: 'verified-position', isSecond: true });
});

test('全文变化后，相同上下文有多处匹配时拒绝按旧位置或第一处猜测', async () => {
  const result = await withPage(
    '<p>相同的前文上下文 目标句子 相同的后文上下文</p><p>相同的前文上下文 目标句子 相同的后文上下文</p>',
    (page) =>
      page.evaluate(() => {
        const first = document.querySelector('p').firstChild;
        const range = document.createRange();
        range.setStart(first, first.data.indexOf('目标句子'));
        range.setEnd(first, first.data.indexOf('目标句子') + 4);
        const anchor = GNAnchor.capture(range);
        anchor.quote.prefix = '相同的前文上下文';
        anchor.quote.suffix = '相同的后文上下文';
        document.body.prepend(document.createTextNode('新内容'));
        const result = GNAnchor.resolveDetailed(anchor);
        return {
          status: result.status,
          reason: result.reason,
          range: result.range,
          candidates: result.candidates,
        };
      }),
  );
  assert.deepEqual(result, {
    status: 'ambiguous',
    reason: 'repeated-context',
    range: null,
    candidates: 2,
  });
});

test('原文被删除后，不能跳到另一处上下文不同的同文', async () => {
  const result = await withPage(
    '<p id="other">商品目录的入口 请点击这里 查阅其他内容。</p><p id="target">我的阅读清单中 请点击这里 记录本次研究结论。</p>',
    (page) =>
      page.evaluate(() => {
        const text = document.querySelector('#target').firstChild;
        const range = document.createRange();
        range.setStart(text, text.data.indexOf('请点击这里'));
        range.setEnd(text, text.data.indexOf('请点击这里') + 5);
        const anchor = GNAnchor.capture(range);
        document.querySelector('#target').remove();
        const result = GNAnchor.resolveDetailed(anchor);
        return { range: result.range, reason: result.reason };
      }),
  );
  assert.deepEqual(result, { range: null, reason: 'context-mismatch' });
});

test('原句删除后，即使另一处有很长的相同前缀，也不能忽视冲突后文', async () => {
  const result = await withPage(
    '<p id="other">这是每个商品都有的统一说明和购买流程 点击购买 红色鞋子。</p><p id="target">这是每个商品都有的统一说明和购买流程 点击购买 蓝色帽子。</p>',
    (page) =>
      page.evaluate(() => {
        const text = document.querySelector('#target').firstChild;
        const range = document.createRange();
        const start = text.data.indexOf('点击购买');
        range.setStart(text, start);
        range.setEnd(text, start + 4);
        const anchor = GNAnchor.capture(range);
        document.querySelector('#target').remove();
        return GNAnchor.resolve(anchor);
      }),
  );
  assert.equal(result, null);
});

test('原本唯一的长段摘录，前文新增文字打断锚点时可凭完整后文恢复', async () => {
  const result = await withPage(
    '<p id="intro">原本的前文介绍，读完以后进入下面的正文。</p><p id="target">这是一整段只出现一次的阅读摘录，保存时记录了完整的原文和上下文，普通的页面更新不应该让这条笔记失去位置。</p><p>这段后文保持不变，为摘录提供可靠的定位证据。</p>',
    (page) =>
      page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('#target'));
        const anchor = GNAnchor.capture(range);
        document.querySelector('#intro').append(' 页面又加载了一些文字。');
        const result = GNAnchor.resolveDetailed(anchor);
        return {
          count: anchor.quote.occurrenceCount,
          method: result.method,
          correct: result.range?.toString() === document.querySelector('#target').textContent,
        };
      }),
  );
  assert.deepEqual(result, { count: 1, method: 'unique-long-quote-context', correct: true });
});

test('原本重复的长摘录被删除一处后，不得按唯一长摘录规则移到另一处', async () => {
  const result = await withPage('<main></main>', (page) =>
    page.evaluate(() => {
      const text =
        '这段重复出现的长摘录虽然足够长，但保存时并不唯一，所以不能只凭剩余的一处同文就自动把笔记移动过去。';
      const prefix = '这是两个条目共有的完整前缀说明，用于验证不能忽略不同的后文。';
      const main = document.querySelector('main');
      const first = document.createElement('p');
      first.textContent = prefix + text + '第一条记录有自己的解释。';
      const target = document.createElement('p');
      target.textContent = prefix + text + '第二条记录是笔记真正记录的位置。';
      main.append(first, target);
      const range = document.createRange();
      range.setStart(target.firstChild, prefix.length);
      range.setEnd(target.firstChild, prefix.length + text.length);
      const anchor = GNAnchor.capture(range);
      target.remove();
      return { count: anchor.quote.occurrenceCount, range: GNAnchor.resolve(anchor) };
    }),
  );
  assert.deepEqual(result, { count: 2, range: null });
});

test('旧版 annotation 的原文和 context 能恢复正确的重复文本', async () => {
  const result = await withPage(
    '<p>无关的原文 共享文本 不要恢复这里。</p><p id="correct">真正的背景内容 共享文本 后面是独特的解释。</p>',
    (page) =>
      page.evaluate(() => {
        const result = GNAnchor.resolve({
          text: '共享文本',
          context: { beforeText: '真正的背景内容 ', afterText: ' 后面是独特的解释。' },
          domPath: 'body > p:nth-of-type(99)',
          textOffset: { startIndex: 0, endIndex: 4 },
        });
        return {
          text: result?.toString(),
          correct: !!result && document.querySelector('#correct').contains(result.startContainer),
        };
      }),
  );
  assert.deepEqual(result, { text: '共享文本', correct: true });
});

test('旧版包装后丢失 before/after 时，可用 parentText 中唯一原文的上下文', async () => {
  const result = await withPage(
    '<p>第一个位置 同样的句子 第一个结束。</p><p id="correct">第二个位置 同样的句子 第二个结束。</p>',
    (page) =>
      page.evaluate(() => {
        const range = GNAnchor.resolve({
          text: '同样的句子',
          context: {
            beforeText: '',
            afterText: '',
            parentText: '第二个位置 同样的句子 第二个结束。',
          },
        });
        return {
          text: range?.toString(),
          correct: !!range && document.querySelector('#correct').contains(range.startContainer),
        };
      }),
  );
  assert.deepEqual(result, { text: '同样的句子', correct: true });
});

test('旧版便利贴只有 selectedText 时恢复唯一原文，重复原文保留未定位状态', async () => {
  const result = await withPage('<p>唯一的旧笔记原文</p><p>重复文字</p><p>重复文字</p>', (page) =>
    page.evaluate(() => ({
      unique: GNAnchor.resolve({
        selectedText: '唯一的旧笔记原文',
        content: '笔记内容',
      })?.toString(),
      repeated: GNAnchor.resolve({ selectedText: '重复文字', content: '另一条笔记' }),
    })),
  );
  assert.deepEqual(result, { unique: '唯一的旧笔记原文', repeated: null });
});

test('旧版不稳定 DOM 路径和偏移不能将歧义原文强行挂在第一处', async () => {
  const result = await withPage('<p>重复文字</p><p>重复文字</p>', (page) =>
    page.evaluate(() =>
      GNAnchor.resolve({
        text: '重复文字',
        domPath: 'body > p:nth-of-type(1)',
        textOffset: { startIndex: 0, endIndex: 4, elementTextLength: 4 },
      }),
    ),
  );
  assert.equal(result, null);
});

test('旧版独立稳定 ID 的父文本、长度、偏移全部匹配时可恢复', async () => {
  const result = await withPage(
    '<p>相同原文 相同原文</p><p id="stable">相同原文 相同原文</p>',
    (page) =>
      page.evaluate(() => {
        const target = document.querySelector('#stable');
        const result = GNAnchor.resolveDetailed({
          text: '相同原文',
          domPath: '#stable',
          context: { parentText: target.textContent },
          textOffset: { startIndex: 5, endIndex: 9, elementTextLength: 9 },
        });
        return {
          method: result.method,
          correct: result.range?.startContainer === target.firstChild,
          offset: result.range?.startOffset,
        };
      }),
  );
  assert.deepEqual(result, { method: 'verified-legacy-location', correct: true, offset: 5 });
});

test('跳过编辑区、脚本、样式和扩展 UI，同时允许链接及按钮文本', async () => {
  const result = await withPage(
    '<script type="application/json">"脚本内容"</script><style>/* 样式内容 */</style><noscript>备用内容</noscript><textarea>编辑内容</textarea><input value="输入内容"><div contenteditable>可编辑内容</div><div contenteditable="false">嵌套编辑属性</div><div id="glassnote-root">扩展界面内容</div><div data-glassnote-root>数据属性界面</div><a href="#">保留链接原文</a><button>保留按钮原文</button>',
    (page) =>
      page.evaluate(() => {
        const excluded = [
          '脚本内容',
          '样式内容',
          '备用内容',
          '编辑内容',
          '输入内容',
          '可编辑内容',
          '嵌套编辑属性',
          '扩展界面内容',
          '数据属性界面',
        ].map((text) => GNAnchor.resolve({ text }));
        const range = document.createRange();
        range.selectNodeContents(document.querySelector('[contenteditable]'));
        const captured = GNAnchor.capture(range);
        const host = document.createElement('div');
        document.body.append(host);
        host.attachShadow({ mode: 'open' }).innerHTML = '<p>Shadow 私有界面</p>';
        return {
          excluded,
          captured,
          shadow: GNAnchor.resolve({ text: 'Shadow 私有界面' }),
          link: GNAnchor.resolve({ text: '保留链接原文' })?.toString(),
          button: GNAnchor.resolve({ text: '保留按钮原文' })?.toString(),
        };
      }),
  );
  assert.ok(result.excluded.every((value) => value === null));
  assert.equal(result.captured, null);
  assert.equal(result.shadow, null);
  assert.equal(result.link, '保留链接原文');
  assert.equal(result.button, '保留按钮原文');
});

test('异步页面初次找不到，内容随后到达可重新恢复；不缓存缺失结果', async () => {
  const result = await withPage('<main>加载中</main>', (page) =>
    page.evaluate(() => {
      const record = { text: '异步加载到达的原文' };
      const before = GNAnchor.resolve(record);
      document.querySelector('main').innerHTML = '<p>异步加载到达的原文</p>';
      return { before, after: GNAnchor.resolve(record)?.toString() };
    }),
  );
  assert.deepEqual(result, { before: null, after: '异步加载到达的原文' });
});

test('限定 root 只在该范围解析，过期索引遇到文本更改不能返回错误范围', async () => {
  const result = await withPage('<p>范围外的原文</p><main><p>范围内的原文</p></main>', (page) =>
    page.evaluate(() => {
      const root = document.querySelector('main');
      const resolver = GNAnchor.createResolver(root);
      const outside = resolver.resolve({ text: '范围外的原文' });
      const inside = resolver.resolve({ text: '范围内的原文' })?.toString();
      root.querySelector('p').firstChild.data = '已经替换的内容';
      return { outside, inside, stale: resolver.resolve({ text: '范围内的原文' }) };
    }),
  );
  assert.deepEqual(result, { outside: null, inside: '范围内的原文', stale: null });
});

test('元素边界与首尾空白选区按真实文本捕获；空选区及缺失内容安全返回 null', async () => {
  const result = await withPage('<p>  <b>从元素边界选中</b>  </p>', (page) =>
    page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('p'));
      const anchor = GNAnchor.capture(range);
      range.collapse(true);
      return {
        exact: anchor?.quote.exact,
        text: GNAnchor.resolve(anchor)?.toString(),
        empty: GNAnchor.capture(range),
        missing: GNAnchor.resolve({ text: '不应模糊猜测的原文', domPath: '][invalid' }),
        invalid: GNAnchor.resolve(null),
      };
    }),
  );
  assert.deepEqual(result, {
    exact: '从元素边界选中',
    text: '从元素边界选中',
    empty: null,
    missing: null,
    invalid: null,
  });
});

test('真实 CSS Custom Highlight 可以渲染恢复的 Range，同时保留宿主事件和结构', async () => {
  const result = await withPage(
    '<p>链接前 <a href="#target">可以点击的链接文字</a> 链接后</p>',
    (page) =>
      page.evaluate(() => {
        const link = document.querySelector('a');
        let clicked = false;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          clicked = true;
        });
        const range = document.createRange();
        range.selectNodeContents(link);
        const anchor = GNAnchor.capture(range);
        const original = document.body.innerHTML;
        CSS.highlights.set('glassnote-test', new Highlight(GNAnchor.resolve(anchor)));
        link.click();
        const result = {
          clicked,
          sameNode: document.querySelector('a') === link,
          sameHTML: document.body.innerHTML === original,
          highlightCount: CSS.highlights.get('glassnote-test').size,
        };
        CSS.highlights.delete('glassnote-test');
        return result;
      }),
  );
  assert.deepEqual(result, { clicked: true, sameNode: true, sameHTML: true, highlightCount: 1 });
});
