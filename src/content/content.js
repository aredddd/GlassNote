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
    
    // 调试模式 - 临时启用详细日志
    this.debugMode = true; // 设为true来启用详细调试
    this.forceMode = false; // 强制模式，跳过所有检查
    
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
      
      if (pageData) {
        let annotationCount = 0;
        let noteCount = 0;
        
        // 统计标注数量
        if (pageData.annotations && pageData.annotations.length > 0) {
          annotationCount = pageData.annotations.length;
        }
        
        // 统计便利贴数量
        if (pageData.notes && pageData.notes.length > 0) {
          noteCount = pageData.notes.length;
        }
        
        const totalCount = annotationCount + noteCount;
        
        if (totalCount > 0) {
          console.log(`发现${annotationCount}个标注和${noteCount}个便利贴，询问是否加载`);
          this.showLoadConfirmDialog(annotationCount, noteCount);
        }
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
  showLoadConfirmDialog(annotationCount, noteCount = 0) {
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
    
    const totalCount = annotationCount + noteCount;
    let contentText = '';
    
    if (annotationCount > 0 && noteCount > 0) {
      contentText = `此页面有 <strong>${annotationCount}</strong> 个标注和 <strong>${noteCount}</strong> 个便利贴，是否加载显示？`;
    } else if (annotationCount > 0) {
      contentText = `此页面有 <strong>${annotationCount}</strong> 个标注，是否加载显示？`;
    } else if (noteCount > 0) {
      contentText = `此页面有 <strong>${noteCount}</strong> 个便利贴，是否加载显示？`;
    } else {
      contentText = `此页面有保存的数据，是否加载显示？`;
    }
    
    dialog.innerHTML = `
      <div style="margin-bottom: 12px !important; font-weight: 600 !important; color: #2c3e50 !important;">
        🔍 发现GlassNote数据
      </div>
      <div style="margin-bottom: 16px !important; line-height: 1.4 !important;">
        ${contentText}
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
        ">加载显示</button>
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
      border: 2px solid #4a90e2 !important;
      border-radius: 8px !important;
      padding: 8px !important;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
      display: none !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      font-size: 14px !important;
      line-height: 1.4 !important;
      color: #333 !important;
      min-width: 200px !important;
      min-height: 40px !important;
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      clip: none !important;
      overflow: visible !important;
      width: auto !important;
      height: auto !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      isolation: isolate !important;
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
      
      // 调试强制模式快捷键 Ctrl+Shift+D
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        this.forceMode = !this.forceMode;
        const status = this.forceMode ? '启用' : '禁用';
        console.log(`🚨 强制模式已${status}`);
        this.showToast(`强制模式已${status} (跳过所有检查)`, this.forceMode ? 'warning' : 'info');
      }
      
              // 切换调试模式快捷键 Ctrl+Shift+B
        if (e.ctrlKey && e.shiftKey && e.key === 'B') {
          e.preventDefault();
          this.debugMode = !this.debugMode;
          const status = this.debugMode ? '启用' : '禁用';
          console.log(`🔍 调试模式已${status}`);
          this.showToast(`调试模式已${status} (控制台日志)`, this.debugMode ? 'info' : 'success');
        }
        
        // 测试工具栏显示快捷键 Ctrl+Shift+T
        if (e.ctrlKey && e.shiftKey && e.key === 'T') {
          e.preventDefault();
          console.log('🧪 测试工具栏显示');
          
          // 在屏幕中央强制显示工具栏
          const centerX = window.innerWidth / 2;
          const centerY = window.innerHeight / 2;
          
          if (!this.toolbarContainer) {
            this.createToolbar();
          }
          
          this.showToolbar(centerX, centerY);
          this.showToast('测试工具栏已显示在屏幕中央', 'warning');
          
          // 3秒后自动隐藏
          setTimeout(() => {
            this.hideToolbar();
          }, 3000);
        }
    });

    // 点击空白处隐藏工具栏（只有启用时才需要）
    document.addEventListener('click', (e) => {
      if (!this.isEnabled || !this.toolbarContainer) return;
      
      if (!this.toolbarContainer.contains(e.target) && 
          !e.target.closest('.gn-a') &&
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
    
    // 调试：显示坐标差异
    if (this.debugMode) {
      console.log('📍 鼠标坐标信息:', {
        clientX: e.clientX, clientY: e.clientY, // 相对于视口（用于fixed定位）
        pageX: e.pageX, pageY: e.pageY,         // 相对于文档（用于absolute定位）
        screenX: e.screenX, screenY: e.screenY, // 相对于屏幕
        scrollX: window.scrollX, scrollY: window.scrollY // 页面滚动量
      });
    }
    
    // 显示标注工具栏 - 使用clientX/Y因为工具栏是fixed定位
    this.showToolbar(e.clientX, e.clientY);
  }

  /**
   * 智能判断是否应该跳过此次选择 - 调试增强版本
   */
  shouldSkipSelection(range) {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    
    if (this.debugMode) {
      console.log('🔍 开始检查选择是否应该跳过');
      console.log('📍 选择范围:', {
        startContainer: startContainer.nodeType === Node.TEXT_NODE ? 
          `TEXT: "${startContainer.textContent.substring(0, 50)}..."` : 
          `ELEMENT: ${startContainer.tagName}`,
        endContainer: endContainer.nodeType === Node.TEXT_NODE ? 
          `TEXT: "${endContainer.textContent.substring(0, 50)}..."` : 
          `ELEMENT: ${endContainer.tagName}`,
        commonAncestor: range.commonAncestorContainer.nodeType === Node.TEXT_NODE ?
          `TEXT_PARENT: ${range.commonAncestorContainer.parentElement?.tagName}` :
          `ELEMENT: ${range.commonAncestorContainer.tagName}`
      });
    }
    
    // 只检查直接相关的元素，避免过度检查导致误判
    const elementsToCheck = [];
    
    // 检查起始和结束容器的直接父元素
    if (startContainer.nodeType === Node.TEXT_NODE && startContainer.parentElement) {
      elementsToCheck.push({
        element: startContainer.parentElement,
        source: 'startContainer.parent'
      });
    } else if (startContainer.nodeType === Node.ELEMENT_NODE) {
      elementsToCheck.push({
        element: startContainer,
        source: 'startContainer'
      });
    }
    
    if (endContainer !== startContainer) {
      if (endContainer.nodeType === Node.TEXT_NODE && endContainer.parentElement) {
        elementsToCheck.push({
          element: endContainer.parentElement,
          source: 'endContainer.parent'
        });
      } else if (endContainer.nodeType === Node.ELEMENT_NODE) {
        elementsToCheck.push({
          element: endContainer,
          source: 'endContainer'
        });
      }
    }

    // 检查公共祖先容器（只向上检查2层，进一步减少误判）
    let ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      ancestor = ancestor.parentElement;
    }
    
    let depth = 0;
    while (ancestor && ancestor !== document.body && depth < 2) {
      if (ancestor.nodeType === Node.ELEMENT_NODE) {
        elementsToCheck.push({
          element: ancestor,
          source: `ancestor-${depth}`
        });
      }
      ancestor = ancestor.parentElement;
      depth++;
    }

    // 应急模式：按Ctrl+Shift+D可以临时禁用所有检查
    if (this.forceMode) {
      if (this.debugMode) {
        console.log('🚨 强制模式启用，跳过所有检查');
      }
      return false;
    }

    if (this.debugMode) {
      console.log('📋 需要检查的元素列表:', elementsToCheck.map(item => ({
        tag: item.element.tagName,
        className: item.element.className,
        id: item.element.id,
        source: item.source
      })));
    }

    // 检查这些元素是否应该被排除
    for (const {element, source} of elementsToCheck) {
      const excluded = this.isElementExcluded(element);
      
      if (this.debugMode) {
        console.log(`🔍 检查元素 ${source}:`, {
          tag: element.tagName,
          className: element.className || '(无)',
          id: element.id || '(无)',
          excluded: excluded
        });
      }
      
      if (excluded) {
        if (this.debugMode) {
          console.log('⚠️ 选择被跳过，原因:', source, element.tagName, element.className || element.id || '');
        }
        return true;
      }
    }

    if (this.debugMode) {
      console.log('✅ 选择检查通过，显示工具栏');
    }
    return false;
  }

  /**
   * 检查元素是否应该被排除 - 进一步放宽条件
   */
  isElementExcluded(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      if (this.debugMode) {
        console.log('🔍 元素检查: 非元素节点，不排除');
      }
      return false;
    }

    if (this.debugMode) {
      console.log('🔍 检查元素是否排除:', {
        tag: element.tagName,
        className: element.className,
        id: element.id,
        isContentEditable: element.isContentEditable,
        contentEditable: element.contentEditable
      });
    }

    // 只检查最关键的可编辑元素
    if (element.matches?.('input, textarea')) {
      if (this.debugMode) {
        console.log('🚫 排除input/textarea元素:', element.tagName);
      }
      return true;
    }

    // 只检查明确标记为可编辑的元素
    if (element.contentEditable === 'true' && element.isContentEditable) {
      if (this.debugMode) {
        console.log('🚫 排除明确的可编辑元素:', element.tagName);
      }
      return true;
    }

    // 检查是否直接是标注元素（只检查直接匹配）
    if (element.classList?.contains('gn-a')) {
      if (this.debugMode) {
        console.log('🚫 排除标注元素本身:', element.tagName);
      }
      return true;
    }

    // 只排除最关键的脚本和样式元素
    if (element.matches?.('script, style')) {
      if (this.debugMode) {
        console.log('🚫 排除脚本/样式元素:', element.tagName);
      }
      return true;
    }

    // 只检查明确隐藏的元素，放宽检查条件
    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none') {
        if (this.debugMode) {
          console.log('🚫 排除display:none元素:', element.tagName);
        }
        return true;
      }
      // 移除visibility检查，因为可能误判
    } catch (error) {
      if (this.debugMode) {
        console.warn('⚠️ 获取元素样式失败，不排除:', error);
      }
    }

    // 大幅放宽富文本编辑器检查
    if (element.matches?.('[role="textbox"]') && element.isContentEditable) {
      if (this.debugMode) {
        console.log('🚫 排除确认的富文本编辑器:', element.tagName);
      }
      return true;
    }

    if (this.debugMode) {
      console.log('✅ 元素检查通过，不排除:', element.tagName);
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
    // 确保工具栏容器存在
    if (!this.toolbarContainer) {
      console.log('🔧 工具栏容器不存在，正在创建...');
      this.createToolbar();
    }
    
    if (!this.toolbarContainer) {
      console.error('❌ 无法创建工具栏容器！');
      return;
    }
    
    this.toolbarContainer.innerHTML = `
      <div class="glassnote-toolbar-buttons">
        <button id="highlight-btn" title="高亮标记">🟡</button>
        <button id="orange-underline-btn" title="橙色荧光下划线">🟠</button>
        <button id="bold-btn" title="真正加粗">𝐁</button>
        <button id="underline-btn" title="下划线">U̲</button>
        <button id="note-btn" title="添加便利贴">📝</button>
        <div class="glassnote-separator"></div>
        <button id="red-btn" class="color-btn" style="color: red;" title="红色标记">🔴</button>
        <button id="blue-btn" class="color-btn" style="color: blue;" title="蓝色标记">🔵</button>
        <button id="green-btn" class="color-btn" style="color: green;" title="绿色标记">🟢</button>
      </div>
    `;

    // 定位工具栏 - 确保在可见区域内
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const toolbarWidth = 220;
    const toolbarHeight = 50;
    
    let left = Math.max(10, Math.min(x - 100, viewportWidth - toolbarWidth - 10));
    let top = Math.max(10, Math.min(y - 60, viewportHeight - toolbarHeight - 10));
    
    this.toolbarContainer.style.left = `${left}px`;
    this.toolbarContainer.style.top = `${top}px`;
    this.toolbarContainer.style.display = 'block';
    
    // 强制重绘
    this.toolbarContainer.offsetHeight;
    
    // 详细调试信息
    const computedStyle = window.getComputedStyle(this.toolbarContainer);
    console.log('🎯 工具栏已显示', {
      coordinateType: 'client (视口相对坐标)',
      mousePosition: { x, y },
      originalPosition: { x: x - 100, y: y - 60 },
      adjustedPosition: { left, top },
      viewport: { width: viewportWidth, height: viewportHeight },
      isEnabled: this.isEnabled,
      containerExists: !!this.toolbarContainer,
      inDOM: document.body.contains(this.toolbarContainer),
      computedStyles: {
        display: computedStyle.display,
        position: computedStyle.position,
        zIndex: computedStyle.zIndex,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity,
        transform: computedStyle.transform,
        left: computedStyle.left,
        top: computedStyle.top
      },
      boundingRect: this.toolbarContainer.getBoundingClientRect()
    });

    // 绑定按钮事件
    this.bindToolbarEvents();
  }

  /**
   * 绑定工具栏事件
   */
  bindToolbarEvents() {
    const createAnnotationWithCheck = (type, color) => {
      if (!this.isEnabled) {
        this.showEnablePrompt();
        this.hideToolbar();
        return;
      }
      this.createAnnotation(type, color);
    };

    document.getElementById('highlight-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('highlight', '#ffff00');
    });

    document.getElementById('orange-underline-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('orange-underline');
    });

    document.getElementById('bold-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('bold');
    });

    document.getElementById('underline-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('underline');
    });

    document.getElementById('note-btn')?.addEventListener('click', () => {
      if (!this.isEnabled) {
        this.showEnablePrompt();
        this.hideToolbar();
        return;
      }
      this.createStickyNote();
    });

    document.getElementById('red-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('color', '#ff0000');
    });

    document.getElementById('blue-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('color', '#0066ff');
    });

    document.getElementById('green-btn')?.addEventListener('click', () => {
      createAnnotationWithCheck('color', '#00cc00');
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
    // 对于简单标注，不预填充内容，让surroundContents自动填充
    const annotationSpan = this.createAnnotationElement(annotationId, type, color, selectedText, false);

    try {
      // 简单情况直接包装 - surroundContents会自动将选中内容移入span
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
        // 修复逻辑：先删除内容，再插入包含文本的span
        if (this.debugMode) {
          console.log(`🔧 处理片段 ${index + 1}: "${nodeInfo.text}" (${nodeInfo.startOffset}-${nodeInfo.endOffset})`);
        }
        
        nodeRange.deleteContents();
        nodeRange.insertNode(span);
        annotationElements.push(span);
        
        // 验证span是否正确包含文本
        if (this.debugMode && span.textContent !== nodeInfo.text) {
          console.warn(`⚠️ 文本内容不匹配! 期望: "${nodeInfo.text}", 实际: "${span.textContent}"`);
        }
        
        console.log(`✅ 创建标注片段 ${index + 1}/${textNodes.length}:`, nodeInfo.text);
      } catch (error) {
        console.error(`❌ 创建标注片段失败 ${index + 1}:`, error);
        // 降级处理：如果Range操作失败，尝试简单替换
        try {
          // span.textContent已经在createAnnotationElement中设置过了
          if (nodeInfo.node.parentNode) {
            nodeInfo.node.parentNode.insertBefore(span, nodeInfo.node);
            // 如果是完整节点，删除原节点
            if (nodeInfo.startOffset === 0 && nodeInfo.endOffset === nodeInfo.node.textContent.length) {
              nodeInfo.node.remove();
            } else {
              // 部分节点，需要分割处理
              const beforeText = nodeInfo.node.textContent.substring(0, nodeInfo.startOffset);
              const afterText = nodeInfo.node.textContent.substring(nodeInfo.endOffset);
              
              if (beforeText) {
                const beforeNode = document.createTextNode(beforeText);
                nodeInfo.node.parentNode.insertBefore(beforeNode, span);
              }
              
              if (afterText) {
                const afterNode = document.createTextNode(afterText);
                nodeInfo.node.parentNode.insertBefore(afterNode, span.nextSibling);
              }
              
              nodeInfo.node.remove();
            }
            annotationElements.push(span);
            console.log(`✅ 使用降级方法创建标注片段 ${index + 1}/${textNodes.length}`);
          }
        } catch (fallbackError) {
          console.error(`❌ 降级处理也失败了:`, fallbackError);
        }
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
   * 创建标注元素（简化版）
   */
  createAnnotationElement(annotationId, type, color, text, fillContent = true) {
    const span = document.createElement('span');
    
    // 使用简化的类名和属性
    span.className = 'gn-a'; // glassnote-annotation 简化
    span.setAttribute('data-gn-id', annotationId.split('-')[1]); // 只保留数字部分
    span.setAttribute('data-gn-t', type.charAt(0)); // 只保留类型首字母
    
    if (color) {
      span.setAttribute('data-gn-c', color);
    }

    // 条件性填充文本内容
    if (fillContent) {
      span.textContent = text;
    }

    // 应用CSS样式类
    this.applyAnnotationStyle(span, type, color);
    
    return span;
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
    
    console.log('💾 准备保存标注数据:', annotationData);
    console.log('🔗 生成的DOM路径:', domPath);
    console.log('📍 目标元素信息:', {
      tagName: mainElement.tagName,
      className: mainElement.className,
      id: mainElement.id,
      textContent: mainElement.textContent?.substring(0, 50)
    });
    
    this.saveAnnotation(annotationData);

    console.log('✅ 标注数据已保存:', annotationData);
  }

  /**
   * 应用标注样式（简化版）
   */
  applyAnnotationStyle(element, type, color) {
    // 使用简化的CSS类名
    element.classList.add('gn-base');
    
    // 根据类型添加对应的样式类
    switch (type) {
      case 'highlight':
        element.classList.add('gn-highlight');
        break;
      case 'bold':
        element.classList.add('gn-bold');
        break;
      case 'underline':
        element.classList.add('gn-underline');
        break;
      case 'orange-underline':
        element.classList.add('gn-orange');
        break;
      case 'color':
        element.classList.add('gn-color');
        break;
      case 'note':
        element.classList.add('gn-note');
        break;
    }
    
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
      element.classList.add('gn-hover');
    });
    
    element.addEventListener('mouseleave', () => {
      element.classList.remove('gn-hover');
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
    
    // 如果当前元素是标注元素，从其父元素开始
    if (current.classList && (current.classList.contains('gn-a') || current.hasAttribute('data-gn-id'))) {
      console.log('🏷️ 跳过标注元素，从父元素开始生成路径');
      current = current.parentElement;
    }
    
    while (current && current !== document.body && current !== document.documentElement) {
      // 跳过标注相关的元素
      if (current.classList && (
          current.classList.contains('gn-a') || 
          current.hasAttribute('data-gn-id') ||
          current.classList.contains('gn-note-badge-inline'))) {
        current = current.parentNode;
        continue;
      }
      
      let selector = current.tagName.toLowerCase();
      
      if (current.id && !current.id.includes('glassnote') && !current.id.includes('gn-')) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break; // ID是唯一的，可以停止
      }
      
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.split(' ')
          .filter(cls => 
            cls && 
            !cls.startsWith('glassnote-') && 
            !cls.startsWith('gn-') &&
            cls !== 'gn-a'
          )
          .join('.');
        if (classes) {
          selector += `.${classes}`;
        }
      }
      
      // 添加位置索引 - 简化版本
      if (current.parentNode && current.parentNode.children) {
        const siblings = Array.from(current.parentNode.children)
          .filter(sibling => sibling.tagName === current.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          if (index >= 0) {
            selector += `:nth-of-type(${index + 1})`;
          }
        }
      }
      
      path.unshift(selector);
      current = current.parentNode;
    }
    
    const finalPath = path.join(' > ');
    console.log('🔗 生成DOM路径:', finalPath);
    return finalPath;
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
   * 显示便利贴编辑器（可拖动独立窗口）
   */
  showNoteEditor(noteId, selectedText, existingContent = '', badge = null) {
    // 移除已存在的编辑器
    const existingEditor = document.getElementById('gn-note-editor');
    if (existingEditor) {
      existingEditor.remove();
    }
    
    // 创建编辑器容器
    const editorContainer = document.createElement('div');
    editorContainer.id = 'gn-note-editor';
    editorContainer.innerHTML = `
      <div class="gn-note-editor-window" id="gn-editor-window">
        <div class="gn-note-header" id="gn-editor-header">
          <div class="gn-note-title">
            <span>📝 便利贴编辑器</span>
            <span class="gn-note-selected-text">"${selectedText.substring(0, 20)}${selectedText.length > 20 ? '...' : ''}"</span>
          </div>
          <div class="gn-note-controls">
            <button class="gn-note-minimize" title="最小化">−</button>
            <button class="gn-note-close" title="关闭">×</button>
          </div>
        </div>
        
        <div class="gn-note-toolbar">
          <button class="gn-md-btn" data-action="bold" title="粗体">𝐁</button>
          <button class="gn-md-btn" data-action="italic" title="斜体">𝐼</button>
          <button class="gn-md-btn" data-action="code" title="代码">\`\`</button>
          <button class="gn-md-btn" data-action="link" title="链接">🔗</button>
          <button class="gn-md-btn" data-action="list" title="列表">•</button>
          <button class="gn-md-btn" data-action="h1" title="大标题">H1</button>
          <button class="gn-md-btn" data-action="h2" title="中标题">H2</button>
          <button class="gn-md-btn" data-action="h3" title="小标题">H3</button>
          <button class="gn-md-btn" data-action="quote" title="引用">❞</button>
        </div>
        
        <div class="gn-note-content">
          <div class="gn-note-editor-panel">
            <div class="gn-note-panel-header">编辑</div>
            <textarea id="gn-note-textarea" placeholder="# 我的笔记

**重要内容：** 在这里记录你的想法

- 要点一
- 要点二

\`代码示例\`

[有用的链接](https://example.com)">${existingContent}</textarea>
          </div>
          
          <div class="gn-note-preview-panel">
            <div class="gn-note-panel-header">预览</div>
            <div id="gn-note-preview" class="gn-note-preview-content"></div>
          </div>
        </div>
        
        <div class="gn-note-footer">
          <button class="gn-note-cancel">取消</button>
          <button class="gn-note-save">保存便利贴</button>
        </div>
      </div>
    `;
    
    // 应用样式
    editorContainer.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0,0,0,0.3) !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      pointer-events: auto !important;
    `;
    
    document.body.appendChild(editorContainer);
    
    // 绑定编辑器事件
    this.bindNoteEditorEvents(editorContainer, noteId, selectedText, badge);
    
    // 初始化预览
    const textarea = document.getElementById('gn-note-textarea');
    const preview = document.getElementById('gn-note-preview');
    this.updateMarkdownPreview(textarea.value, preview);
    
    // 自动聚焦
    setTimeout(() => {
      textarea?.focus();
    }, 100);
  }

  /**
   * 绑定便利贴编辑器事件
   */
  bindNoteEditorEvents(container, noteId, selectedText, badge) {
    const textarea = container.querySelector('#gn-note-textarea');
    const preview = container.querySelector('#gn-note-preview');
    const window = container.querySelector('.gn-note-editor-window');
    const header = container.querySelector('#gn-editor-header');
    
    // 实时预览更新
    textarea.addEventListener('input', () => {
      this.updateMarkdownPreview(textarea.value, preview);
    });
    
    // Markdown工具栏按钮
    container.querySelectorAll('.gn-md-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        this.insertMarkdown(textarea, action);
        this.updateMarkdownPreview(textarea.value, preview);
      });
    });
    
    // 窗口拖拽功能
    this.makeDraggable(window, header);
    
    // 关闭按钮
    container.querySelector('.gn-note-close').addEventListener('click', () => {
      container.remove();
    });
    
    // 最小化按钮
    container.querySelector('.gn-note-minimize').addEventListener('click', () => {
      const content = container.querySelector('.gn-note-content');
      const footer = container.querySelector('.gn-note-footer');
      const toolbar = container.querySelector('.gn-note-toolbar');
      
      if (content.style.display === 'none') {
        // 恢复
        content.style.display = 'flex';
        footer.style.display = 'flex';
        toolbar.style.display = 'flex';
        window.style.height = '600px';
      } else {
        // 最小化
        content.style.display = 'none';
        footer.style.display = 'none';
        toolbar.style.display = 'none';
        window.style.height = '40px';
      }
    });
    
    container.querySelector('.gn-note-cancel').addEventListener('click', () => {
      container.remove();
    });
    
    // 保存按钮
    container.querySelector('.gn-note-save').addEventListener('click', () => {
      const content = textarea.value.trim();
      if (content) {
        this.saveNoteContent(noteId, selectedText, content, badge);
        container.remove();
      } else {
        this.showToast('请输入便利贴内容', 'warning');
      }
    });
    
    // 点击背景关闭
    container.addEventListener('click', (e) => {
      if (e.target === container) {
        container.remove();
      }
    });
    
    // ESC键关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.getElementById('gn-note-editor')) {
        container.remove();
      }
    }, { once: true });
  }

  /**
   * 使元素可拖拽
   */
  makeDraggable(element, handle) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    handle.style.cursor = 'move';
    
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = element.offsetLeft;
      startTop = element.offsetTop;
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
    
    function onMouseMove(e) {
      if (!isDragging) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      const newLeft = startLeft + deltaX;
      const newTop = startTop + deltaY;
      
      // 限制在视口内
      const maxLeft = window.innerWidth - element.offsetWidth;
      const maxTop = window.innerHeight - element.offsetHeight;
      
      element.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
      element.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
    }
    
    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  }

  /**
   * 插入Markdown语法
   */
  insertMarkdown(textarea, action) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end);
    const beforeText = textarea.value.substring(0, start);
    const afterText = textarea.value.substring(end);
    
    let newText = '';
    let cursorOffset = 0;
    
    switch (action) {
      case 'bold':
        newText = `**${selectedText || '粗体文字'}**`;
        cursorOffset = selectedText ? 0 : -4;
        break;
      case 'italic':
        newText = `*${selectedText || '斜体文字'}*`;
        cursorOffset = selectedText ? 0 : -3;
        break;
      case 'code':
        newText = `\`${selectedText || '代码'}\``;
        cursorOffset = selectedText ? 0 : -2;
        break;
      case 'link':
        newText = `[${selectedText || '链接文字'}](https://example.com)`;
        cursorOffset = selectedText ? -22 : -18;
        break;
      case 'list':
        newText = `- ${selectedText || '列表项'}`;
        cursorOffset = selectedText ? 0 : -3;
        break;
      case 'h1':
        newText = `# ${selectedText || '大标题'}`;
        cursorOffset = selectedText ? 0 : -3;
        break;
      case 'h2':
        newText = `## ${selectedText || '中标题'}`;
        cursorOffset = selectedText ? 0 : -3;
        break;
      case 'h3':
        newText = `### ${selectedText || '小标题'}`;
        cursorOffset = selectedText ? 0 : -3;
        break;
      case 'quote':
        newText = `> ${selectedText || '引用内容'}`;
        cursorOffset = selectedText ? 0 : -4;
        break;
      default:
        return;
    }
    
    textarea.value = beforeText + newText + afterText;
    
    // 设置新的光标位置
    const newCursorPosition = start + newText.length + cursorOffset;
    textarea.setSelectionRange(newCursorPosition, newCursorPosition);
    textarea.focus();
  }

  /**
   * 保存便利贴内容
   */
  async saveNoteContent(noteId, selectedText, content, badge) {
    try {
      const noteData = {
        id: noteId,
        selectedText: selectedText,
        content: content,
        timestamp: Date.now(),
        url: window.location.href,
        pageTitle: document.title
      };
      
      // 保存到存储
      const url = this.currentUrl;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url] || { annotations: [], notes: [] };
      
      if (!pageData.notes) {
        pageData.notes = [];
      }
      
      // 检查是否已存在，更新或添加
      const existingIndex = pageData.notes.findIndex(note => note.id === noteId);
      if (existingIndex >= 0) {
        pageData.notes[existingIndex] = noteData;
      } else {
        pageData.notes.push(noteData);
      }
      
      await chrome.storage.local.set({ [url]: pageData });
      
      // 更新角标的点击事件，绑定内容
      if (badge) {
        badge.onclick = (e) => {
          e.stopPropagation();
          this.showNotePopup(content, badge);
        };
      }
      
      this.showToast('便利贴已保存！', 'success');
      console.log('📝 便利贴已保存:', noteData);
      
    } catch (error) {
      console.error('❌ 保存便利贴失败:', error);
      this.showToast('保存失败', 'error');
    }
  }

  /**
   * 简单的Markdown渲染
   */
  updateMarkdownPreview(text, previewElement) {
    // 简单的Markdown解析
    let html = text
      // 标题
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      // 粗体和斜体
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // 行内代码
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // 链接
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      // 列表
      .replace(/^\- (.*$)/gim, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      // 换行
      .replace(/\n/g, '<br>');
    
    previewElement.innerHTML = html || '<em style="color: #999;">预览将在这里显示...</em>';
  }

  /**
   * 创建便利贴（新方案：下划线标注+角标）
   */
  createStickyNote() {
    if (!this.selectedRange) {
      this.showToast('请先选择文本', 'warning');
      return;
    }

    const selectedText = this.selectedRange.toString().trim();
    if (!selectedText) {
      this.showToast('请选择有效文本', 'warning');
      return;
    }

    // 隐藏工具栏
    this.hideToolbar();

    // 创建便利贴ID
    const noteId = `note-${Date.now()}`;
    
    // 创建便利贴标注（下划线样式）
    const noteAnnotation = this.createAnnotationElement(noteId, 'note', null, selectedText, false);
    
    try {
      // 包装选中文字（类似标注）
      this.selectedRange.surroundContents(noteAnnotation);
      
      // 在文字末尾添加便利贴角标
      const noteBadge = document.createElement('span');
      noteBadge.className = 'gn-note-badge-inline';
      noteBadge.innerHTML = '📝';
      noteBadge.setAttribute('data-note-id', noteId);
      
      // 将角标插入到标注元素之后
      noteAnnotation.parentNode.insertBefore(noteBadge, noteAnnotation.nextSibling);
      
      // 绑定角标点击事件
      noteBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNoteEditor(noteId, selectedText, '', noteBadge);
      });
      
      console.log('📝 便利贴标注已创建');
      this.showToast('请点击📝编写便利贴内容', 'info');
      
    } catch (error) {
      console.error('❌ 创建便利贴失败:', error);
      // 使用复杂方法创建
      this.createComplexStickyNote(noteId, selectedText);
    }
    
    // 清除选择
    this.selectedRange = null;
  }

  /**
   * 创建复杂便利贴（跨元素时使用）
   */
  createComplexStickyNote(noteId, selectedText) {
    // 使用类似createComplexAnnotation的逻辑
    const textNodes = this.getTextNodesInRange(this.selectedRange);
    
    if (textNodes.length === 0) {
      this.showToast('无法创建便利贴', 'error');
      return;
    }
    
    const annotationElements = [];
    textNodes.forEach((nodeInfo, index) => {
      const spanId = `${noteId}-part-${index}`;
      const span = this.createAnnotationElement(spanId, 'note', null, nodeInfo.text, true);
      
      const nodeRange = document.createRange();
      nodeRange.setStart(nodeInfo.node, nodeInfo.startOffset);
      nodeRange.setEnd(nodeInfo.node, nodeInfo.endOffset);
      
      try {
        nodeRange.deleteContents();
        nodeRange.insertNode(span);
        annotationElements.push(span);
      } catch (error) {
        console.error(`❌ 创建便利贴片段失败:`, error);
      }
    });
    
    if (annotationElements.length > 0) {
      // 在最后一个元素后添加角标
      const lastElement = annotationElements[annotationElements.length - 1];
      const noteBadge = document.createElement('span');
      noteBadge.className = 'gn-note-badge-inline';
      noteBadge.innerHTML = '📝';
      noteBadge.setAttribute('data-note-id', noteId);
      
      lastElement.parentNode.insertBefore(noteBadge, lastElement.nextSibling);
      
      noteBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNoteEditor(noteId, selectedText, '', noteBadge);
      });
      
      this.showToast('请点击📝编写便利贴内容', 'info');
    }
  }

  /**
   * 显示便利贴弹窗
   */
  showNotePopup(content, badge) {
    // 移除已存在的弹窗
    const existingPopup = document.getElementById('gn-note-popup');
    if (existingPopup) {
      existingPopup.remove();
    }
    
    const popup = document.createElement('div');
    popup.id = 'gn-note-popup';
    popup.innerHTML = `
      <div class="gn-note-popup-content">
        <div class="gn-note-popup-header">
          <span>📝 便利贴</span>
          <button class="gn-note-popup-close">×</button>
        </div>
        <div class="gn-note-popup-body">
          <div id="gn-note-popup-content"></div>
        </div>
      </div>
    `;
    
    // 获取角标位置
    const badgeRect = badge.getBoundingClientRect();
    
    popup.style.cssText = `
      position: fixed !important;
      left: ${badgeRect.left + 30}px !important;
      top: ${badgeRect.top - 10}px !important;
      z-index: 2147483646 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;
    
    document.body.appendChild(popup);
    
    // 渲染Markdown内容
    this.updateMarkdownPreview(content, popup.querySelector('#gn-note-popup-content'));
    
    // 绑定关闭事件
    popup.querySelector('.gn-note-popup-close').addEventListener('click', () => {
      popup.remove();
    });
    
    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && !badge.contains(e.target)) {
          popup.remove();
        }
      }, { once: true });
    }, 100);
  }

  /**
   * 保存便利贴数据
   */
  async saveNoteData(noteData) {
    try {
      const url = this.currentUrl;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url] || { annotations: [], notes: [] };
      
      if (!pageData.notes) {
        pageData.notes = [];
      }
      
      pageData.notes.push(noteData);
      
      await chrome.storage.local.set({ [url]: pageData });
      console.log('📝 便利贴已保存:', noteData);
    } catch (error) {
      console.error('❌ 保存便利贴失败:', error);
      this.showToast('保存失败', 'error');
    }
  }

  /**
   * 切换 GlassNote 开关
   */
  toggleGlassNote() {
    if (this.isEnabled) {
      // 禁用：隐藏所有标注
      const annotations = document.querySelectorAll('.gn-a');
      annotations.forEach(annotation => {
        annotation.style.display = 'none';
      });
      this.hideToolbar();
      this.isEnabled = false;
      console.log('GlassNote 已禁用（标注已隐藏）');
    } else {
      // 启用：显示所有标注或启用系统
      const annotations = document.querySelectorAll('.gn-a');
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
   * 加载当前页面的标注和便利贴
   */
  async loadAnnotations() {
    try {
      const url = this.currentUrl;
      console.log('🔄 开始加载标注数据，URL:', url);
      
      // 首先清理页面上可能存在的旧标注
      this.cleanupExistingAnnotations();
      
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url];
      
      console.log('📦 获取到的页面数据:', pageData);
      
      // 详细分析数据结构
      if (pageData && pageData.annotations) {
        console.log('📊 标注数据详细分析:');
        pageData.annotations.forEach((annotation, index) => {
          console.log(`标注 ${index + 1}:`, {
            id: annotation.id,
            type: annotation.type,
            textLength: annotation.text?.length,
            textPreview: annotation.text?.substring(0, 30),
            domPath: annotation.domPath,
            domPathLength: annotation.domPath?.length,
            hasColor: !!annotation.color,
            createdAt: annotation.createdAt
          });
        });
      }
      
      if (pageData) {
        // 加载标注
        if (pageData.annotations && pageData.annotations.length > 0) {
          console.log(`🔄 开始恢复${pageData.annotations.length}个标注`);
          let successCount = 0;
          for (const annotationData of pageData.annotations) {
            if (await this.restoreAnnotation(annotationData)) {
              successCount++;
            }
          }
          console.log(`📝 已成功加载 ${successCount}/${pageData.annotations.length} 个标注`);
        } else {
          console.log('📝 没有找到标注数据');
        }
        
        // 加载便利贴
        if (pageData.notes && pageData.notes.length > 0) {
          console.log(`🔄 开始恢复${pageData.notes.length}个便利贴`);
          let noteSuccessCount = 0;
          for (const noteData of pageData.notes) {
            if (this.restoreNote(noteData)) {
              noteSuccessCount++;
            }
          }
          console.log(`📝 已成功加载 ${noteSuccessCount}/${pageData.notes.length} 个便利贴`);
        } else {
          console.log('📝 没有找到便利贴数据');
        }
      } else {
        console.log('📭 当前页面没有保存的数据');
      }
    } catch (error) {
      console.error('❌ 加载标注失败:', error);
    }
  }

  /**
   * 清理页面上已存在的标注元素
   */
  cleanupExistingAnnotations() {
    try {
      // 清理旧的标注元素
      const oldAnnotations = document.querySelectorAll('.gn-a, .glassnote-annotation, [data-gn-id], [data-glassnote-id]');
      let cleanupCount = 0;
      
      oldAnnotations.forEach(annotation => {
        try {
          // 提取文本内容
          const textContent = annotation.textContent;
          const parent = annotation.parentNode;
          
          if (parent && textContent) {
            // 用纯文本节点替换标注元素
            const textNode = document.createTextNode(textContent);
            parent.replaceChild(textNode, annotation);
            cleanupCount++;
          }
        } catch (error) {
          console.warn('清理标注元素失败:', error);
        }
      });
      
      // 清理便利贴角标
      const oldBadges = document.querySelectorAll('.gn-note-badge-inline, .gn-note-badge');
      oldBadges.forEach(badge => {
        badge.remove();
        cleanupCount++;
      });
      
      if (cleanupCount > 0) {
        console.log(`🧹 清理了 ${cleanupCount} 个旧的标注元素`);
      }
      
    } catch (error) {
      console.error('❌ 清理旧标注失败:', error);
    }
  }

  /**
   * 恢复便利贴（新方案：查找文本并添加标注+角标）
   */
  restoreNote(noteData) {
    try {
      const { selectedText, content, id } = noteData;
      
      if (!selectedText) {
        console.warn('便利贴缺少选中文本:', noteData);
        return false;
      }
      
      // 尝试在页面中找到匹配的文本
      const targetElement = this.findElementByText(selectedText);
      if (!targetElement) {
        console.warn('未找到便利贴对应的文本:', selectedText);
        return false;
      }
      
      // 创建便利贴标注
      const textContent = targetElement.textContent;
      const startIndex = textContent.indexOf(selectedText);
      
      if (startIndex === -1) {
        console.warn('文本不匹配:', selectedText);
        return false;
      }
      
      const beforeText = textContent.substring(0, startIndex);
      const afterText = textContent.substring(startIndex + selectedText.length);
      
      // 创建标注元素
      const noteAnnotation = document.createElement('span');
      noteAnnotation.className = 'gn-a gn-base gn-note';
      noteAnnotation.textContent = selectedText;
      noteAnnotation.setAttribute('data-gn-id', id);
      noteAnnotation.setAttribute('data-gn-t', 'n');
      
      // 创建内联角标
      const noteBadge = document.createElement('span');
      noteBadge.className = 'gn-note-badge-inline';
      noteBadge.innerHTML = '📝';
      noteBadge.setAttribute('data-note-id', id);
      
      // 替换目标元素的内容
      targetElement.innerHTML = '';
      
      if (beforeText) {
        targetElement.appendChild(document.createTextNode(beforeText));
      }
      
      targetElement.appendChild(noteAnnotation);
      targetElement.appendChild(noteBadge);
      
      if (afterText) {
        targetElement.appendChild(document.createTextNode(afterText));
      }
      
      // 绑定角标点击事件
      noteBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNotePopup(content, noteBadge);
      });
      
      console.log('📝 便利贴已恢复:', id);
      return true;
      
    } catch (error) {
      console.error('❌ 恢复便利贴失败:', error, noteData);
      return false;
    }
  }

  /**
   * 恢复DOM标注
   */
  async restoreAnnotation(annotationData) {
    try {
      const { id, type, text, color, domPath } = annotationData;
      
      console.log('🔄 尝试恢复标注:', { id, type, text: text?.substring(0, 50), domPath });
      
      // 检查是否已经存在该标注
      const existingAnnotation = document.querySelector(`[data-gn-id="${id.split('-')[1] || id}"]`);
      if (existingAnnotation) {
        console.log('⚠️ 标注已存在，跳过恢复:', id);
        return true;
      }
      
      if (!domPath) {
        console.warn('❌ 标注缺少DOM路径，跳过:', id);
        return false;
      }

      // 清理DOM路径中的标注元素 - 更宽松的清理策略
      let cleanedPath = domPath;
      const needsCleaning = domPath.includes('span.gn-a') || 
                           domPath.includes('glassnote-annotation') ||
                           domPath.includes('gn-base') ||
                           domPath.includes('gn-highlight') ||
                           domPath.includes('gn-bold') ||
                           domPath.includes('gn-underline') ||
                           domPath.includes('gn-orange') ||
                           domPath.includes('gn-color');
                           
      if (needsCleaning) {
        console.log('🧹 检测到路径包含标注元素，进行清理');
        const pathParts = domPath.split(' > ');
        const cleanedParts = pathParts.filter(part => {
          const shouldExclude = part.includes('span.gn-a') || 
                               part.includes('glassnote-annotation') ||
                               part.includes('.gn-base') ||
                               part.includes('.gn-highlight') ||
                               part.includes('.gn-bold') ||
                               part.includes('.gn-underline') ||
                               part.includes('.gn-orange') ||
                               part.includes('.gn-color');
          return !shouldExclude;
        });
        cleanedPath = cleanedParts.join(' > ');
        console.log('🧹 原路径:', domPath);
        console.log('🧹 清理后:', cleanedPath);
      }

      // 尝试多种方式找到目标元素
      let targetElement;
      
      // 策略1: 尝试原始路径
      try {
        targetElement = document.querySelector(domPath);
        if (targetElement) {
          console.log('✅ 通过原始DOM路径找到目标元素');
        }
      } catch (error) {
        console.log('⚠️ 原始DOM路径查找失败:', error.message);
      }
      
      // 策略2: 尝试清理后的路径
      if (!targetElement && cleanedPath !== domPath) {
        try {
          targetElement = document.querySelector(cleanedPath);
          if (targetElement) {
            console.log('✅ 通过清理后的DOM路径找到目标元素:', cleanedPath);
          }
        } catch (error) {
          console.warn('❌ 清理后的DOM路径查找失败:', cleanedPath, error);
        }
      }

      // 如果清理后的路径还是找不到，尝试原路径的父元素
      if (!targetElement && domPath.includes(' > ')) {
        const pathParts = domPath.split(' > ');
        // 逐步向上查找父元素
        for (let i = pathParts.length - 2; i >= 0; i--) {
          const parentPath = pathParts.slice(0, i + 1).join(' > ');
          try {
            targetElement = document.querySelector(parentPath);
            if (targetElement) {
              console.log('✅ 通过父元素路径找到目标:', parentPath);
              break;
            }
          } catch (error) {
            // 继续尝试下一个父元素
            continue;
          }
        }
      }

      if (!targetElement) {
        console.log('⚠️ DOM路径完全失效，尝试通过文本查找:', text?.substring(0, 30));
        // 使用改进的文本查找
        targetElement = this.findElementByTextImproved(text);
        if (targetElement) {
          console.log('✅ 通过改进的文本查找找到目标元素');
        }
      }

      if (!targetElement) {
        console.warn('❌ 无法找到标注目标元素:', id, text?.substring(0, 30));
        return false;
      }

      // 创建标注包装元素（使用新的简化格式）
      const annotationSpan = document.createElement('span');
      annotationSpan.className = 'gn-a gn-base';
      annotationSpan.setAttribute('data-gn-id', id.split('-')[1] || id); // 只保留数字部分
      annotationSpan.setAttribute('data-gn-t', type.charAt(0)); // 只保留类型首字母
      
      if (color) {
        annotationSpan.setAttribute('data-gn-c', color);
      }

      // 应用样式
      this.applyAnnotationStyle(annotationSpan, type, color);

      // 包装目标内容
      const textContent = targetElement.textContent;
      console.log('🔍 检查文本包含:', { 
        targetText: textContent.substring(0, 100),
        searchText: text?.substring(0, 50),
        includes: textContent.includes(text)
      });
      
      if (textContent.includes(text)) {
        const startIndex = textContent.indexOf(text);
        const endIndex = startIndex + text.length;
        
        const beforeText = textContent.substring(0, startIndex);
        const afterText = textContent.substring(endIndex);
        
        console.log('📝 创建标注包装:', {
          beforeText: beforeText?.substring(0, 20),
          targetText: text?.substring(0, 30),
          afterText: afterText?.substring(0, 20)
        });
        
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
        console.log('✅ 标注恢复成功:', id);
        return true;
      } else {
        console.warn('❌ 目标元素不包含指定文本');
        return false;
      }
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
          !node.parentElement.closest('.gn-a')) {
        return node.parentElement;
      }
    }
    
    return null;
  }

  /**
   * 改进的文本查找函数
   */
  findElementByTextImproved(text) {
    if (!text) return null;
    
    // 清理文本中的换行符和多余空格
    const cleanText = text.replace(/\s+/g, ' ').trim();
    const textParts = cleanText.split(' ');
    
    console.log('🔍 改进文本查找:', { cleanText: cleanText.substring(0, 50), textParts: textParts.slice(0, 3) });
    
    // 尝试不同的查找策略
    const strategies = [
      // 策略1: 完整文本匹配
      () => this.findByExactText(cleanText),
      // 策略2: 前半部分文本匹配
      () => this.findByExactText(cleanText.substring(0, Math.floor(cleanText.length / 2))),
      // 策略3: 前几个词匹配
      () => this.findByExactText(textParts.slice(0, Math.min(3, textParts.length)).join(' ')),
      // 策略4: 第一个词匹配
      () => this.findByExactText(textParts[0]),
      // 策略5: 包含关系匹配
      () => this.findByContainText(cleanText)
    ];
    
    for (let i = 0; i < strategies.length; i++) {
      const element = strategies[i]();
      if (element) {
        console.log(`✅ 找到目标元素 strategy ${i + 1}`);
        return element;
      }
    }
    
    console.log('❌ 所有查找策略都失败了');
    return null;
  }

  /**
   * 精确文本匹配
   */
  findByExactText(text) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while (node = walker.nextNode()) {
      const nodeText = node.textContent.replace(/\s+/g, ' ').trim();
      if (nodeText.includes(text)) {
        const element = node.parentElement;
        if (element && !this.isElementExcluded({ element })) {
          // 检查元素是否包含现有标注
          if (!element.querySelector('.gn-a')) {
            return element;
          }
        }
      }
    }
    
    return null;
  }

  /**
   * 包含关系文本匹配
   */
  findByContainText(text) {
    const allElements = document.querySelectorAll('p, div, span, li, td, th, h1, h2, h3, h4, h5, h6');
    
    for (const element of allElements) {
      if (this.isElementExcluded({ element })) continue;
      if (element.querySelector('.gn-a')) continue; // 跳过已有标注的元素
      
      const elementText = element.textContent.replace(/\s+/g, ' ').trim();
      if (elementText.includes(text) && elementText.length < text.length * 3) {
        return element;
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
   * 清除当前页面的所有标注和便利贴
   */
  clearCurrentAnnotations() {
    try {
      // 移除DOM中的所有标注元素
      const annotations = document.querySelectorAll('.gn-a');
      annotations.forEach(annotation => {
        // 如果标注包装了其他内容，需要解开包装
        if (annotation.parentNode) {
          const textContent = annotation.textContent;
          annotation.parentNode.replaceChild(document.createTextNode(textContent), annotation);
        }
      });

      // 移除所有便利贴角标（包括内联角标）
      const noteBadges = document.querySelectorAll('.gn-note-badge, .gn-note-badge-inline');
      noteBadges.forEach(badge => {
        badge.remove();
      });

      // 移除可能存在的便利贴弹窗
      const notePopups = document.querySelectorAll('#gn-note-popup');
      notePopups.forEach(popup => {
        popup.remove();
      });

      // 移除可能存在的编辑器
      const noteEditors = document.querySelectorAll('#gn-note-editor');
      noteEditors.forEach(editor => {
        editor.remove();
      });

      // 清除内存中的数据
      this.annotations.clear();
      
      // 隐藏工具栏
      this.hideToolbar();
      
      console.log('已清除当前页面的所有标注和便利贴');
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
console.log('🔧 调试快捷键：');
console.log('   Ctrl+Shift+B - 切换调试模式 (控制台详细日志)');
console.log('   Ctrl+Shift+D - 强制模式 (跳过所有选择检查)');
console.log('   Ctrl+Shift+T - 测试工具栏显示 (屏幕中央3秒)');
