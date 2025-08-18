/**
 * GlassNote 内容脚本 - 基于DOM的网页标注系统
 * 负责检测路由变化、管理DOM标注和用户交互
 */

class GlassNoteSystem {
  constructor() {
    this.isEnabled = false;
    this.selectedText = '';
    this.selectedRange = null;
    this.annotations = new Map(); // 存储所有标注数据
    this.currentUrl = window.location.href;
    this.annotationCounter = 0;
    
    this.init();
  }

  /**
   * 初始化系统
   */
  async init() {
    try {
      console.log('🚀 GlassNote v2.0 正在初始化...');
      
      // 检查扩展上下文
      if (!this.checkExtensionContext()) {
        console.error('❌ 扩展上下文无效，初始化失败');
        this.showContextInvalidatedMessage();
        return;
      }

      // 不自动启动，等待路由变化或用户主动启用
      this.setupRouteDetection();
      this.setupEventListeners();
      await this.checkCurrentPage();
      
      console.log('✅ GlassNote 系统已初始化，等待路由变化检测');
      console.log('📍 当前URL:', this.currentUrl);
      console.log('🎛️ 系统状态:', { 
        isEnabled: this.isEnabled, 
        hasEventListeners: true,
        extensionContext: this.checkExtensionContext()
      });
    } catch (error) {
      console.error('❌ GlassNote 初始化失败:', error);
    }
  }

  /**
   * 设置路由变化检测
   */
  setupRouteDetection() {
    // 监听浏览器历史变化
    window.addEventListener('popstate', () => {
      this.handleRouteChange();
    });

    // 监听pushState和replaceState（SPA路由变化）
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function(...args) {
      originalPushState.apply(history, args);
      setTimeout(() => glassNote.handleRouteChange(), 100);
    };
    
    history.replaceState = function(...args) {
      originalReplaceState.apply(history, args);
      setTimeout(() => glassNote.handleRouteChange(), 100);
    };

    // 监听hash变化
    window.addEventListener('hashchange', () => {
      this.handleRouteChange();
    });
  }

  /**
   * 处理路由变化
   */
  async handleRouteChange() {
    const newUrl = window.location.href;
    if (newUrl === this.currentUrl) return;
    
    console.log('检测到路由变化:', this.currentUrl, '->', newUrl);
    
    // 清除当前页面的标注
    this.clearCurrentAnnotations();
    
    // 更新当前URL
    this.currentUrl = newUrl;
    
    // 检查新页面是否有标注数据
    await this.checkCurrentPage();
  }

  /**
   * 检查当前页面是否有标注数据
   */
  async checkCurrentPage() {
    try {
      // 检查扩展上下文
      if (!this.checkExtensionContext()) {
        console.warn('扩展上下文无效，跳过页面数据检查');
        return;
      }

      const result = await chrome.storage.local.get([this.currentUrl]);
      const pageData = result[this.currentUrl];
      
      if (pageData && pageData.annotations && pageData.annotations.length > 0) {
        console.log(`发现${pageData.annotations.length}个标注，询问是否加载`);
        this.showLoadConfirmDialog(pageData.annotations.length);
      }
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('扩展上下文失效，无法检查页面数据');
        this.showContextInvalidatedMessage();
      } else {
        console.error('检查页面数据失败:', error);
      }
    }
  }

  /**
   * 显示加载确认对话框
   */
  showLoadConfirmDialog(annotationCount) {
    // 创建简洁的确认对话框
    const dialog = document.createElement('div');
    dialog.id = 'glassnote-load-dialog';
    dialog.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      right: 20px !important;
      background: white !important;
      border: 2px solid #4a90e2 !important;
      border-radius: 8px !important;
      padding: 16px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2) !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      color: #333 !important;
      max-width: 300px !important;
      animation: slideInFromRight 0.3s ease-out !important;
    `;
    
    dialog.innerHTML = `
      <div style="margin-bottom: 12px !important; font-weight: 600 !important; color: #2c3e50 !important;">
        🔍 发现标注数据
      </div>
      <div style="margin-bottom: 16px !important; line-height: 1.4 !important;">
        此页面有 <strong>${annotationCount}</strong> 个标注，是否加载显示？
      </div>
      <div style="display: flex !important; gap: 8px !important; justify-content: flex-end !important;">
        <button id="glassnote-load-no" style="
          padding: 6px 12px !important;
          border: 1px solid #ddd !important;
          background: white !important;
          border-radius: 4px !important;
          cursor: pointer !important;
          font-size: 12px !important;
        ">稍后</button>
        <button id="glassnote-load-yes" style="
          padding: 6px 12px !important;
          border: none !important;
          background: #4a90e2 !important;
          color: white !important;
          border-radius: 4px !important;
          cursor: pointer !important;
          font-size: 12px !important;
        ">加载标注</button>
      </div>
    `;
    
    document.body.appendChild(dialog);
    
    // 绑定按钮事件
    document.getElementById('glassnote-load-yes').addEventListener('click', () => {
      dialog.remove();
      this.enableGlassNote();
    });
    
    document.getElementById('glassnote-load-no').addEventListener('click', () => {
      dialog.remove();
    });
    
    // 5秒后自动关闭
    setTimeout(() => {
      if (dialog.parentNode) {
        dialog.remove();
      }
    }, 5000);
  }

  /**
   * 启用GlassNote标注系统
   */
  async enableGlassNote() {
    if (this.isEnabled) return;
    
    this.isEnabled = true;
    this.createToolbar();
    await this.loadAnnotations();
    console.log('GlassNote 已启用');
  }

  /**
   * 创建工具栏容器
   */
  createToolbar() {
    if (this.toolbarContainer) return;
    
    this.toolbarContainer = document.createElement('div');
    this.toolbarContainer.id = 'glassnote-toolbar';
    this.toolbarContainer.style.cssText = `
      position: fixed !important;
      background: white !important;
      border: 1px solid #ccc !important;
      border-radius: 8px !important;
      padding: 8px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
      display: none !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.4 !important;
      color: #333 !important;
    `;
    document.body.appendChild(this.toolbarContainer);
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    console.log('📝 设置事件监听器...');
    
    // 防抖处理文本选择，避免频繁触发
    let selectionTimeout;
    document.addEventListener('mouseup', (e) => {
      console.log('🖱️ 检测到鼠标释放事件，isEnabled:', this.isEnabled);
      
      // 注意：这里移除了isEnabled检查，因为我们需要在路由检测时也能响应
      clearTimeout(selectionTimeout);
      selectionTimeout = setTimeout(() => this.handleTextSelection(e), 50);
    });

    // 监听键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        console.log('⌨️ 检测到快捷键 Ctrl+Shift+G');
        e.preventDefault();
        this.toggleGlassNote();
      }
    });

    // 点击空白处隐藏工具栏（只有启用时才需要）
    document.addEventListener('click', (e) => {
      if (!this.isEnabled || !this.toolbarContainer) return;
      
      if (!this.toolbarContainer.contains(e.target) && 
          !e.target.closest('.glassnote-annotation') &&
          !e.target.closest('.glassnote-note-badge')) {
        this.hideToolbar();
      }
    }, { passive: true });

    // 监听滚动事件，隐藏工具栏避免位置错乱
    document.addEventListener('scroll', () => {
      if (this.isEnabled && this.toolbarContainer) {
        this.hideToolbar();
      }
    }, { passive: true });
    
    console.log('✅ 事件监听器设置完成');
  }

  /**
   * 处理文本选择
   */
  handleTextSelection(e) {
    console.log('🎯 处理文本选择事件');
    
    // 检查扩展上下文
    if (!this.checkExtensionContext()) {
      console.warn('扩展上下文失效，无法处理文本选择');
      this.showContextInvalidatedMessage();
      return;
    }

    const selection = window.getSelection();
    
    // 更严格的选择检查
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      this.hideToolbar();
      return;
    }

    this.selectedText = selection.toString().trim();
    console.log('📝 选中文本:', this.selectedText);
    
    if (this.selectedText.length < 1) {
      this.hideToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    
    // 改进的上下文检查：使用更智能的元素检测
    if (this.shouldSkipSelection(range)) {
      console.log('⚠️ 跳过此次选择');
      this.hideToolbar();
      return;
    }

    // 检查系统是否启用
    if (!this.isEnabled) {
      console.log('💡 系统未启用，显示启用提示');
      this.showEnablePrompt(e.pageX, e.pageY);
      return;
    }

    // 保存选择范围
    this.selectedRange = range.cloneRange();
    
    console.log('✅ 显示标注工具栏');
    // 显示标注工具栏
    this.showToolbar(e.pageX, e.pageY);
  }

  /**
   * 智能判断是否应该跳过此次选择 - 简化版本
   */
  shouldSkipSelection(range) {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // 只检查直接相关的元素，避免过度检查导致误判
    const elementsToCheck = [];
    
    // 检查起始和结束容器的直接父元素
    if (startContainer.nodeType === Node.TEXT_NODE && startContainer.parentElement) {
      elementsToCheck.push(startContainer.parentElement);
    } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
      elementsToCheck.push(startContainer);
    }
    
    if (endContainer !== startContainer) {
      if (endContainer.nodeType === Node.TEXT_NODE && endContainer.parentElement) {
        elementsToCheck.push(endContainer.parentElement);
      } else if (endContainer.nodeType === Node.ELEMENT_NODE) {
        elementsToCheck.push(endContainer);
      }
    }

    // 检查公共祖先容器（只向上检查3层）
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      ancestor = ancestor.parentElement;
    }
    
    let depth = 0;
    while (ancestor && ancestor !== document.body && depth < 3) {
      if (ancestor.nodeType === Node.ELEMENT_NODE) {
        elementsToCheck.push(ancestor);
      }
      ancestor = ancestor.parentElement;
      depth++;
    }

    // 检查这些元素是否应该被排除
    for (const element of elementsToCheck) {
      if (this.isElementExcluded(element)) {
        console.log('⚠️ 发现排除元素:', element.tagName || element.nodeType, element.className || element.id || '');
        return true;
      }
    }

    return false;
  }

  /**
   * 检查元素是否应该被排除 - 修复过度排除问题
   */
  isElementExcluded(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    // 检查可编辑元素（这个检查保持严格）
    if (element.isContentEditable || 
        element.contentEditable === 'true' ||
        element.matches?.('input, textarea, [contenteditable="true"], [contenteditable=""], .ql-editor')) {
      console.log('🚫 排除可编辑元素:', element.tagName);
      return true;
    }

    // 检查是否直接是标注元素（修复：只检查元素本身，不检查父级）
    if (element.matches?.('.glassnote-annotation')) {
      console.log('🚫 排除标注元素本身:', element.tagName);
      return true;
    }

    // 检查特殊元素（代码块、脚本等）
    if (element.matches?.('script, style, code, pre, .highlight, .hljs')) {
      console.log('🚫 排除特殊元素:', element.tagName);
      return true;
    }

    // 检查隐藏或不可见元素（只检查直接样式，避免误判）
    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        console.log('🚫 排除隐藏元素:', element.tagName);
        return true;
      }
    } catch (error) {
      // 如果获取样式失败，不排除
      console.warn('获取元素样式失败:', error);
    }

    // 检查特殊的富文本编辑器（保持但放宽条件）
    if (element.matches?.('[role="textbox"]') ||
        (element.className && element.className.includes('editor') && element.isContentEditable)) {
      console.log('🚫 排除富文本编辑器:', element.tagName, element.className);
      return true;
    }

    return false;
  }

  /**
   * 显示启用提示
   */
  showEnablePrompt(x, y) {
    // 移除现有提示
    const existingPrompt = document.getElementById('glassnote-enable-prompt');
    if (existingPrompt) {
      existingPrompt.remove();
    }

    const prompt = document.createElement('div');
    prompt.id = 'glassnote-enable-prompt';
    prompt.style.cssText = `
      position: fixed !important;
      left: ${x - 100}px !important;
      top: ${y - 60}px !important;
      background: #4a90e2 !important;
      color: white !important;
      padding: 8px 12px !important;
      border-radius: 6px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 13px !important;
      z-index: 2147483647 !important;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
    `;
    
    prompt.innerHTML = `
      <div>💡 点击启用GlassNote标注</div>
      <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">或按 Ctrl+Shift+G</div>
    `;
    
    prompt.addEventListener('click', () => {
      this.enableGlassNote();
      prompt.remove();
    });
    
    prompt.addEventListener('mouseenter', () => {
      prompt.style.background = '#357abd';
    });
    
    prompt.addEventListener('mouseleave', () => {
      prompt.style.background = '#4a90e2';
    });
    
    document.body.appendChild(prompt);
    
    // 3秒后自动隐藏
    setTimeout(() => {
      if (prompt.parentNode) {
        prompt.remove();
      }
    }, 3000);
  }

  /**
   * 显示标注工具栏
   */
  showToolbar(x, y) {    
    this.toolbarContainer.innerHTML = `
      <div class="glassnote-toolbar-buttons">
        <button id="highlight-btn" title="高亮标记">🖍️</button>
        <button id="bold-btn" title="加粗">𝐁</button>
        <button id="note-btn" title="添加便利贴">📝</button>
        <button id="underline-btn" title="下划线">U̲</button>
        <div class="glassnote-separator"></div>
        <button id="red-btn" class="color-btn" style="color: red;" title="红色标记">●</button>
        <button id="blue-btn" class="color-btn" style="color: blue;" title="蓝色标记">●</button>
        <button id="green-btn" class="color-btn" style="color: green;" title="绿色标记">●</button>
      </div>
    `;

    // 定位工具栏
    this.toolbarContainer.style.left = `${x - 100}px`;
    this.toolbarContainer.style.top = `${y - 60}px`;
    this.toolbarContainer.style.display = 'block';

    // 绑定按钮事件
    this.bindToolbarEvents();
  }

  /**
   * 绑定工具栏事件
   */
  bindToolbarEvents() {
    document.getElementById('highlight-btn')?.addEventListener('click', () => {
      this.createAnnotation('highlight', '#ffff00');
    });

    document.getElementById('bold-btn')?.addEventListener('click', () => {
      this.createAnnotation('bold');
    });

    document.getElementById('note-btn')?.addEventListener('click', () => {
      // 暂时禁用便利贴功能，专注于基础标注
      alert('便利贴功能开发中，敬请期待！');
    });

    document.getElementById('underline-btn')?.addEventListener('click', () => {
      this.createAnnotation('underline');
    });

    document.getElementById('red-btn')?.addEventListener('click', () => {
      this.createAnnotation('color', '#ff0000');
    });

    document.getElementById('blue-btn')?.addEventListener('click', () => {
      this.createAnnotation('color', '#0066ff');
    });

    document.getElementById('green-btn')?.addEventListener('click', () => {
      this.createAnnotation('color', '#00cc00');
    });
  }

  /**
   * 创建DOM内联标注 - 支持多行和复杂DOM结构
   */
  createAnnotation(type, color = null) {
    if (!this.selectedRange) return;

    try {
      const annotationId = `glassnote-${++this.annotationCounter}-${Date.now()}`;
      const selectedText = this.selectedText;
      
      console.log('🎨 开始创建标注:', { type, color, text: selectedText.substring(0, 50) + '...' });

      // 检查是否是简单的单行选择
      if (this.isSimpleSelection(this.selectedRange)) {
        // 简单选择，使用快速方法
        this.createSimpleAnnotation(annotationId, type, color, selectedText);
      } else {
        // 复杂选择（多行、跨元素），使用更稳健的方法
        this.createComplexAnnotation(annotationId, type, color, selectedText);
      }

      console.log('✅ 标注创建完成');
      
    } catch (error) {
      console.error('❌ 创建标注失败:', error);
      // 显示用户友好的错误提示
      this.showToast('标注创建失败，请重试', 'error');
    }

    this.hideToolbar();
    window.getSelection().removeAllRanges();
  }

  /**
   * 检查是否是简单的选择（单一文本节点内）
   */
  isSimpleSelection(range) {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    // 检查是否在同一个文本节点内
    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
      return true;
    }

    // 检查是否在同一个元素内的连续文本节点
    if (startContainer.nodeType === Node.TEXT_NODE && 
        endContainer.nodeType === Node.TEXT_NODE &&
        startContainer.parentElement === endContainer.parentElement) {
      return true;
    }

    return false;
  }

  /**
   * 创建简单标注（单行、单元素内）
   */
  createSimpleAnnotation(annotationId, type, color, selectedText) {
    const annotationSpan = this.createAnnotationElement(annotationId, type, color, selectedText);

    try {
      // 简单情况直接包装
      this.selectedRange.surroundContents(annotationSpan);
      console.log('🎯 使用简单包装方法');
    } catch (error) {
      // 退化到复杂方法
      console.log('⚠️ 简单包装失败，使用复杂方法');
      this.createComplexAnnotation(annotationId, type, color, selectedText);
      return;
    }

    this.finalizeAnnotation(annotationId, type, color, selectedText, annotationSpan);
  }

  /**
   * 创建复杂标注（多行、跨元素）
   */
  createComplexAnnotation(annotationId, type, color, selectedText) {
    console.log('🔧 使用复杂标注方法');

    // 获取所有涉及的文本节点
    const textNodes = this.getTextNodesInRange(this.selectedRange);
    
    if (textNodes.length === 0) {
      console.warn('⚠️ 未找到文本节点');
      return;
    }

    console.log('📍 找到文本节点数量:', textNodes.length);

    // 为每个文本节点片段创建标注
    const annotationElements = [];
    textNodes.forEach((nodeInfo, index) => {
      const spanId = `${annotationId}-part-${index}`;
      const span = this.createAnnotationElement(spanId, type, color, nodeInfo.text);
      
      // 创建范围并替换文本节点内容
      const nodeRange = document.createRange();
      nodeRange.setStart(nodeInfo.node, nodeInfo.startOffset);
      nodeRange.setEnd(nodeInfo.node, nodeInfo.endOffset);
      
      try {
        nodeRange.deleteContents();
        nodeRange.insertNode(span);
        annotationElements.push(span);
        console.log(`✅ 创建标注片段 ${index + 1}/${textNodes.length}`);
      } catch (error) {
        console.error(`❌ 创建标注片段失败 ${index + 1}:`, error);
      }
    });

    if (annotationElements.length > 0) {
      // 使用第一个元素作为主要元素来生成DOM路径
      this.finalizeAnnotation(annotationId, type, color, selectedText, annotationElements[0]);
    }
  }

  /**
   * 获取范围内的所有文本节点及其偏移
   */
  getTextNodesInRange(range) {
    const textNodes = [];
    const treeWalker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          if (range.intersectsNode(node)) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = treeWalker.nextNode()) {
      // 计算这个节点在选择范围内的部分
      const nodeRange = document.createRange();
      nodeRange.selectNodeContents(node);
      
      // 找到交集
      const intersection = range.cloneRange();
      if (intersection.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) {
        intersection.setStart(node, 0);
      }
      if (intersection.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) {
        intersection.setEnd(node, node.textContent.length);
      }

      if (!intersection.collapsed) {
        const startOffset = intersection.startContainer === node ? intersection.startOffset : 0;
        const endOffset = intersection.endContainer === node ? intersection.endOffset : node.textContent.length;
        
        textNodes.push({
          node: node,
          startOffset: startOffset,
          endOffset: endOffset,
          text: node.textContent.substring(startOffset, endOffset)
        });
      }
    }

    return textNodes;
  }

  /**
   * 创建标注元素
   */
  createAnnotationElement(annotationId, type, color, text) {
    const annotationSpan = document.createElement('span');
    annotationSpan.className = 'glassnote-annotation';
    annotationSpan.setAttribute('data-glassnote-id', annotationId);
    annotationSpan.setAttribute('data-glassnote-type', type);
    annotationSpan.setAttribute('data-glassnote-text', text);
    
    if (color) {
      annotationSpan.setAttribute('data-glassnote-color', color);
    }

    // 应用CSS样式类
    this.applyAnnotationStyle(annotationSpan, type, color);
    
    return annotationSpan;
  }

  /**
   * 完成标注创建（保存数据）
   */
  finalizeAnnotation(annotationId, type, color, selectedText, mainElement) {
    // 生成DOM路径用于后续定位
    const domPath = this.generateDOMPath(mainElement);
    
    // 存储标注数据
    const annotationData = {
      id: annotationId,
      type: type,
      text: selectedText,
      color: color,
      domPath: domPath,
      createdAt: new Date().toISOString()
    };

    this.annotations.set(annotationId, annotationData);
    this.saveAnnotation(annotationData);

    console.log('💾 标注数据已保存:', annotationData);
  }

  /**
   * 应用标注样式
   */
  applyAnnotationStyle(element, type, color) {
    // 移除复杂的内联样式，使用CSS类
    element.classList.add('glassnote-base');
    element.classList.add(`glassnote-${type}`);
    
    // 只为特定颜色设置内联样式
    if (color) {
      switch (type) {
        case 'highlight':
          element.style.backgroundColor = color;
          break;
        case 'color':
          element.style.backgroundColor = color;
          element.style.color = this.getContrastColor(color);
          break;
      }
    }

    // 简化的悬停效果
    element.addEventListener('mouseenter', () => {
      element.classList.add('glassnote-hover');
    });
    
    element.addEventListener('mouseleave', () => {
      element.classList.remove('glassnote-hover');
    });
  }

  /**
   * 获取对比色（简单的黑白判断）
   */
  getContrastColor(hexColor) {
    // 移除#号
    const hex = hexColor.replace('#', '');
    // 转换为RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    // 计算亮度
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    // 返回对比色
    return brightness > 155 ? '#000000' : '#ffffff';
  }

  /**
   * 生成DOM路径用于定位元素
   */
  generateDOMPath(element) {
    const path = [];
    let current = element;
    
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      
      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break; // ID是唯一的，可以停止
      }
      
      if (current.className) {
        const classes = Array.from(current.classList)
          .filter(cls => !cls.startsWith('glassnote-'))
          .join('.');
        if (classes) {
          selector += `.${classes}`;
        }
      }
      
      // 添加位置索引
      const siblings = Array.from(current.parentNode?.children || [])
        .filter(sibling => sibling.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current);
        selector += `:nth-of-type(${index + 1})`;
      }
      
      path.unshift(selector);
      current = current.parentNode;
    }
    
    return path.join(' > ');
  }





  /**
   * 隐藏工具栏
   */
  hideToolbar() {
    if (this.toolbarContainer) {
      this.toolbarContainer.style.display = 'none';
    }
    this.selectedRange = null;
  }

  /**
   * 切换 GlassNote 开关
   */
  toggleGlassNote() {
    if (this.isEnabled) {
      // 禁用：隐藏所有标注
      const annotations = document.querySelectorAll('.glassnote-annotation');
      annotations.forEach(annotation => {
        annotation.style.display = 'none';
      });
      this.hideToolbar();
      this.isEnabled = false;
      console.log('GlassNote 已禁用（标注已隐藏）');
    } else {
      // 启用：显示所有标注或启用系统
      const annotations = document.querySelectorAll('.glassnote-annotation');
      if (annotations.length > 0) {
        // 已有标注，直接显示
        annotations.forEach(annotation => {
          annotation.style.display = '';
        });
        this.isEnabled = true;
        console.log('GlassNote 已启用（显示现有标注）');
      } else {
        // 没有标注，启用系统
        this.enableGlassNote();
      }
    }
  }

  /**
   * 保存标注到本地存储
   */
  async saveAnnotation(annotationData) {
    try {
      // 检查扩展上下文是否有效
      if (!chrome?.storage?.local) {
        console.warn('扩展上下文失效，标注仅在内存中保存');
        return;
      }

      const url = this.currentUrl;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url] || { 
        url: url, 
        annotations: [], 
        lastModified: new Date().toISOString() 
      };
      
      pageData.annotations.push(annotationData);
      pageData.lastModified = new Date().toISOString();
      
      await chrome.storage.local.set({ [url]: pageData });
      console.log('标注已保存:', annotationData);
    } catch (error) {
      if (error.message.includes('Extension context invalidated')) {
        console.warn('扩展上下文失效，请刷新页面重新加载扩展');
        this.showContextInvalidatedMessage();
      } else {
        console.error('保存标注失败:', error);
      }
    }
  }

  /**
   * 加载当前页面的标注
   */
  async loadAnnotations() {
    try {
      const url = this.currentUrl;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url];
      
      if (pageData && pageData.annotations) {
        let successCount = 0;
        for (const annotationData of pageData.annotations) {
          if (await this.restoreAnnotation(annotationData)) {
            successCount++;
          }
        }
        console.log(`已加载 ${successCount}/${pageData.annotations.length} 个标注`);
      }
    } catch (error) {
      console.error('加载标注失败:', error);
    }
  }

  /**
   * 恢复DOM标注
   */
  async restoreAnnotation(annotationData) {
    try {
      const { id, type, text, color, domPath } = annotationData;
      
      if (!domPath) {
        console.warn('标注缺少DOM路径，跳过:', id);
        return false;
      }

      // 尝试通过DOM路径找到目标元素
      let targetElement;
      try {
        targetElement = document.querySelector(domPath);
      } catch (error) {
        console.warn('DOM路径无效:', domPath, error);
      }

      if (!targetElement) {
        // 如果路径找不到，尝试通过文本内容查找
        targetElement = this.findElementByText(text);
      }

      if (!targetElement) {
        console.warn('无法找到标注目标元素:', id, text);
        return false;
      }

      // 创建标注包装元素
      const annotationSpan = document.createElement('span');
      annotationSpan.className = 'glassnote-annotation';
      annotationSpan.setAttribute('data-glassnote-id', id);
      annotationSpan.setAttribute('data-glassnote-type', type);
      annotationSpan.setAttribute('data-glassnote-text', text);
      
      if (color) {
        annotationSpan.setAttribute('data-glassnote-color', color);
      }

      // 应用样式
      this.applyAnnotationStyle(annotationSpan, type, color);

      // 包装目标内容
      const textContent = targetElement.textContent;
      if (textContent.includes(text)) {
        const startIndex = textContent.indexOf(text);
        const endIndex = startIndex + text.length;
        
        const beforeText = textContent.substring(0, startIndex);
        const afterText = textContent.substring(endIndex);
        
        // 重构DOM结构
        targetElement.innerHTML = '';
        if (beforeText) {
          targetElement.appendChild(document.createTextNode(beforeText));
        }
        
        annotationSpan.textContent = text;
        targetElement.appendChild(annotationSpan);
        
        if (afterText) {
          targetElement.appendChild(document.createTextNode(afterText));
        }
        
        this.annotations.set(id, annotationData);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('恢复标注失败:', error);
      return false;
    }
  }

  /**
   * 通过文本内容查找元素
   */
  findElementByText(text) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      if (node.textContent.includes(text) && 
          !node.parentElement.closest('.glassnote-annotation')) {
        return node.parentElement;
      }
    }
    
    return null;
  }

  /**
   * 显示上下文失效消息
   */
  showContextInvalidatedMessage() {
    // 移除可能存在的旧消息
    const existingMessage = document.getElementById('glassnote-context-invalid');
    if (existingMessage) {
      existingMessage.remove();
    }

    const message = document.createElement('div');
    message.id = 'glassnote-context-invalid';
    message.style.cssText = `
      position: fixed !important;
      top: 50px !important;
      right: 20px !important;
      background: #ff4444 !important;
      color: white !important;
      padding: 12px 16px !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 12px rgba(255, 68, 68, 0.3) !important;
      z-index: 2147483647 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      max-width: 300px !important;
      animation: slideInFromRight 0.3s ease-out !important;
    `;
    
    message.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">⚠️ 扩展需要重新加载</div>
      <div style="font-size: 12px; line-height: 1.4;">
        扩展上下文已失效，请刷新页面以恢复标注功能
      </div>
      <button onclick="this.parentElement.remove()" style="
        margin-top: 8px;
        padding: 4px 8px;
        background: rgba(255,255,255,0.2);
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 4px;
        color: white;
        cursor: pointer;
        font-size: 11px;
      ">知道了</button>
    `;
    
    document.body.appendChild(message);
    
    // 10秒后自动移除
    setTimeout(() => {
      if (message.parentNode) {
        message.remove();
      }
    }, 10000);
  }

  /**
   * 显示Toast提示消息
   */
  showToast(message, type = 'info', duration = 3000) {
    // 移除现有Toast
    const existingToast = document.getElementById('glassnote-toast');
    if (existingToast) {
      existingToast.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'glassnote-toast';
    
    // 根据类型设置颜色
    let backgroundColor, textColor;
    switch (type) {
      case 'error':
        backgroundColor = '#ff4757';
        textColor = 'white';
        break;
      case 'success':
        backgroundColor = '#2ed573';
        textColor = 'white';
        break;
      case 'warning':
        backgroundColor = '#ffa502';
        textColor = 'white';
        break;
      default:
        backgroundColor = '#5352ed';
        textColor = 'white';
    }
    
    toast.style.cssText = `
      position: fixed !important;
      top: 20px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: ${backgroundColor} !important;
      color: ${textColor} !important;
      padding: 12px 20px !important;
      border-radius: 8px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      z-index: 2147483647 !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
      opacity: 0 !important;
      animation: glassnote-toast-in 0.3s ease forwards !important;
    `;
    
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // 自动消失
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.animation = 'glassnote-toast-out 0.3s ease forwards';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.remove();
          }
        }, 300);
      }
    }, duration);
  }

  /**
   * 检查扩展上下文是否有效
   */
  checkExtensionContext() {
    return !!(chrome?.runtime?.id && chrome?.storage?.local);
  }

  /**
   * 清除当前页面的所有标注
   */
  clearCurrentAnnotations() {
    try {
      // 移除DOM中的所有标注元素
      const annotations = document.querySelectorAll('.glassnote-annotation');
      annotations.forEach(annotation => {
        // 如果标注包装了其他内容，需要解开包装
        if (annotation.parentNode) {
          const textContent = annotation.textContent;
          annotation.parentNode.replaceChild(document.createTextNode(textContent), annotation);
        }
      });

      // 清除内存中的数据
      this.annotations.clear();
      
      // 隐藏工具栏
      this.hideToolbar();
      
      console.log('已清除当前页面的所有标注');
    } catch (error) {
      console.error('清除标注失败:', error);
    }
  }
}

// 初始化 GlassNote
const glassNote = new GlassNoteSystem();

// 检查是否存在旧的实例并清理
if (window.glassNoteInstance) {
  console.log('🔄 检测到旧实例，正在清理...');
  try {
    window.glassNoteInstance.clearCurrentAnnotations();
  } catch (error) {
    console.warn('清理旧实例时出错:', error);
  }
}

// 监听来自扩展的消息
chrome.runtime?.onMessage?.addListener((request, sender, sendResponse) => {
  try {
    console.log('📨 收到扩展消息:', request);
    
    // 检查扩展上下文
    if (!glassNote.checkExtensionContext()) {
      console.warn('扩展上下文失效，无法处理消息');
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return true;
    }

    switch (request.action) {
      case 'toggle':
        glassNote.toggleGlassNote();
        break;
      case 'setMode':
        // 设置标注模式（暂时只记录，后续可扩展）
        console.log(`切换到${request.mode}模式`);
        break;
      case 'clearAll':
        glassNote.clearCurrentAnnotations();
        break;
      default:
        console.warn('未知的消息action:', request.action);
    }
    
    // 发送响应表示消息已处理
    sendResponse({ success: true });
  } catch (error) {
    console.error('处理扩展消息失败:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  // 返回true表示异步响应
  return true;
});

// 保存实例到全局，用于检测重复加载
window.glassNoteInstance = glassNote;

// 监听页面卸载，清理资源
window.addEventListener('beforeunload', () => {
  console.log('🧹 页面卸载，清理GlassNote资源');
  try {
    glassNote.clearCurrentAnnotations();
  } catch (error) {
    console.warn('清理资源时出错:', error);
  }
});

// 定期检查扩展上下文健康状态
setInterval(() => {
  if (!glassNote.checkExtensionContext()) {
    console.warn('⚠️ 扩展上下文失效，系统功能受限');
  }
}, 30000); // 每30秒检查一次

console.log('🎉 GlassNote v2.0 加载完成！');
console.log('💡 使用提示：选择文本查看标注选项，或按 Ctrl+Shift+G 切换显示');
