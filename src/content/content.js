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

    // 检查选择是否在可编辑元素内（避免干扰输入框等）
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const isInEditableElement = container.nodeType === Node.TEXT_NODE ? 
      container.parentElement?.isContentEditable || 
      container.parentElement?.closest('input, textarea, [contenteditable="true"]') :
      container.isContentEditable || 
      container.closest?.('input, textarea, [contenteditable="true"]');
    
    if (isInEditableElement) {
      console.log('⚠️ 在可编辑元素内，跳过');
      this.hideToolbar();
      return;
    }

    // 检查是否已经在标注元素内（避免重复标注）
    const isInAnnotation = container.nodeType === Node.TEXT_NODE ?
      container.parentElement?.closest('.glassnote-annotation') :
      container.closest?.('.glassnote-annotation');
    
    if (isInAnnotation) {
      console.log('⚠️ 在标注元素内，跳过');
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
   * 创建DOM内联标注
   */
  createAnnotation(type, color = null) {
    if (!this.selectedRange) return;

    try {
      const annotationId = `glassnote-${++this.annotationCounter}-${Date.now()}`;
      const selectedText = this.selectedText;
      
      // 创建标注包装元素
      const annotationSpan = document.createElement('span');
      annotationSpan.className = 'glassnote-annotation';
      annotationSpan.setAttribute('data-glassnote-id', annotationId);
      annotationSpan.setAttribute('data-glassnote-type', type);
      annotationSpan.setAttribute('data-glassnote-text', selectedText);
      
      if (color) {
        annotationSpan.setAttribute('data-glassnote-color', color);
      }

      // 应用CSS样式类
      annotationSpan.classList.add(`glassnote-${type}`);
      
      // 设置内联样式
      this.applyAnnotationStyle(annotationSpan, type, color);

      // 用标注元素包装选中的内容
      try {
        this.selectedRange.surroundContents(annotationSpan);
      } catch (error) {
        // 如果不能直接包装（跨越多个元素），则提取内容并包装
        const contents = this.selectedRange.extractContents();
        annotationSpan.appendChild(contents);
        this.selectedRange.insertNode(annotationSpan);
      }

      // 生成DOM路径用于后续定位
      const domPath = this.generateDOMPath(annotationSpan);
      
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

      console.log('创建内联标注:', annotationData);
      
    } catch (error) {
      console.error('创建标注失败:', error);
    }

    this.hideToolbar();
    window.getSelection().removeAllRanges();
  }

  /**
   * 应用标注样式
   */
  applyAnnotationStyle(element, type, color) {
    const baseStyle = `
      transition: all 0.2s ease !important;
      cursor: pointer !important;
    `;
    
    switch (type) {
      case 'highlight':
        element.style.cssText = baseStyle + `
          background-color: ${color || '#ffff00'} !important;
          padding: 1px 2px !important;
          border-radius: 2px !important;
        `;
        break;
      case 'bold':
        element.style.cssText = baseStyle + `
          background: rgba(255, 165, 0, 0.15) !important;
          border: 1px solid #ff8c00 !important;
          padding: 1px 3px !important;
          border-radius: 3px !important;
          font-weight: bold !important;
        `;
        break;
      case 'underline':
        element.style.cssText = baseStyle + `
          border-bottom: 2px solid #333 !important;
          padding-bottom: 1px !important;
        `;
        break;
      case 'color':
        element.style.cssText = baseStyle + `
          background-color: ${color} !important;
          color: white !important;
          padding: 1px 3px !important;
          border-radius: 2px !important;
        `;
        break;
    }

    // 添加悬停效果
    element.addEventListener('mouseenter', () => {
      element.style.opacity = '0.8';
    });
    
    element.addEventListener('mouseleave', () => {
      element.style.opacity = '1';
    });
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
      annotationSpan.classList.add(`glassnote-${type}`);
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
