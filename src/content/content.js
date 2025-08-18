/**
 * GlassNote 内容脚本 - 网页图层标注系统
 * 负责在目标网页上创建图层覆盖和处理用户交互
 */

class GlassNoteLayer {
  constructor() {
    this.isEnabled = false;
    this.selectedText = '';
    this.layerElements = new Map(); // 存储所有图层元素
    this.init();
  }

  /**
   * 初始化图层系统
   */
  init() {
    this.createLayerContainer();
    this.setupEventListeners();
    this.loadStoredAnnotations();
    console.log('GlassNote 图层系统已初始化');
  }

  /**
   * 创建图层容器
   */
  createLayerContainer() {
    // 创建主图层容器
    this.layerContainer = document.createElement('div');
    this.layerContainer.id = 'glassnote-layer';
    this.layerContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 999999;
    `;
    document.body.appendChild(this.layerContainer);

    // 创建工具栏容器
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
    // 防抖处理文本选择，避免频繁触发
    let selectionTimeout;
    document.addEventListener('mouseup', (e) => {
      clearTimeout(selectionTimeout);
      selectionTimeout = setTimeout(() => this.handleTextSelection(e), 50);
    });

    // 监听键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'G') {
        e.preventDefault();
        this.toggleGlassNote();
      }
    });

    // 点击空白处隐藏工具栏（使用事件委托优化性能）
    document.addEventListener('click', (e) => {
      if (!this.toolbarContainer.contains(e.target) && 
          !e.target.closest('.glassnote-annotation') &&
          !e.target.closest('.glassnote-note-badge')) {
        this.hideToolbar();
      }
    }, { passive: true });

    // 监听滚动事件，隐藏工具栏避免位置错乱
    document.addEventListener('scroll', () => {
      this.hideToolbar();
    }, { passive: true });
  }

  /**
   * 处理文本选择
   */
  handleTextSelection(e) {
    const selection = window.getSelection();
    
    // 更严格的选择检查
    if (!selection || !selection.rangeCount || selection.isCollapsed) {
      this.hideToolbar();
      return;
    }

    this.selectedText = selection.toString().trim();
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
      this.hideToolbar();
      return;
    }

    // 显示标注工具栏
    this.showToolbar(e.pageX, e.pageY, range);
  }

  /**
   * 显示标注工具栏
   */
  showToolbar(x, y, range) {
    this.currentRange = range;
    
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
      this.createStickyNote();
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
   * 创建标注
   */
  createAnnotation(type, color = null) {
    if (!this.currentRange) return;

    const annotationId = `annotation-${Date.now()}`;
    
    // 获取选中文本的所有矩形区域（支持跨行选择）
    const rects = this.currentRange.getClientRects();
    const allPositions = [];
    
    // 为每个矩形创建标注元素
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (rect.width === 0 || rect.height === 0) continue; // 跳过空矩形
      
      const layerElement = document.createElement('div');
      layerElement.className = 'glassnote-annotation';
      layerElement.id = `${annotationId}-${i}`;
      layerElement.style.cssText = `
        position: absolute !important;
        left: ${rect.left + window.scrollX}px !important;
        top: ${rect.top + window.scrollY}px !important;
        width: ${rect.width}px !important;
        height: ${rect.height}px !important;
        pointer-events: none !important;
        border-radius: 3px !important;
        box-sizing: border-box !important;
      `;

      // 根据类型设置样式
      switch (type) {
        case 'highlight':
          layerElement.style.background = color || '#ffff00';
          layerElement.style.opacity = '0.3';
          break;
        case 'bold':
          // 改进加粗效果：使用阴影和边框组合
          layerElement.style.background = 'rgba(255, 165, 0, 0.1)';
          layerElement.style.border = '1px solid #ff8c00';
          layerElement.style.boxShadow = 'inset 0 0 0 1px rgba(255, 140, 0, 0.3)';
          break;
        case 'underline':
          layerElement.style.borderBottom = '2px solid #333';
          break;
        case 'color':
          layerElement.style.background = color;
          layerElement.style.opacity = '0.2';
          layerElement.style.border = `1px solid ${color}`;
          break;
      }

      this.layerContainer.appendChild(layerElement);
      
      // 记录位置信息
      allPositions.push({
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height
      });
    }

    // 存储标注数据
    const annotationData = {
      id: annotationId,
      type: type,
      text: this.selectedText,
      color: color,
      positions: allPositions, // 存储多个位置
      createdAt: new Date().toISOString()
    };

    this.layerElements.set(annotationId, annotationData);
    this.saveAnnotation(annotationData);

    this.hideToolbar();
    window.getSelection().removeAllRanges();
  }

  /**
   * 创建便利贴
   */
  createStickyNote() {
    const noteContent = prompt('请输入便利贴内容：', '');
    if (!noteContent || !this.currentRange) return;

    const noteId = `note-${Date.now()}`;
    const rect = this.currentRange.getBoundingClientRect();
    
    // 创建便利贴角标
    const badge = document.createElement('div');
    badge.className = 'glassnote-note-badge';
    badge.id = `badge-${noteId}`;
    badge.textContent = '📝';
    badge.style.cssText = `
      position: absolute;
      left: ${rect.right + window.scrollX + 5}px;
      top: ${rect.top + window.scrollY}px;
      width: 20px;
      height: 20px;
      background: #ff6b35;
      color: white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      pointer-events: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;

    badge.addEventListener('click', () => {
      this.showNotePopup(noteId, noteContent);
    });

    this.layerContainer.appendChild(badge);

    // 存储便利贴数据
    const noteData = {
      id: noteId,
      type: 'note',
      text: this.selectedText,
      content: noteContent,
      position: {
        left: rect.right + window.scrollX + 5,
        top: rect.top + window.scrollY,
        width: 20,
        height: 20
      },
      createdAt: new Date().toISOString()
    };

    this.layerElements.set(noteId, noteData);
    this.saveAnnotation(noteData);

    this.hideToolbar();
    window.getSelection().removeAllRanges();
  }

  /**
   * 显示便利贴弹窗
   */
  showNotePopup(noteId, content) {
    const popup = document.createElement('div');
    popup.className = 'glassnote-note-popup';
    popup.style.cssText = `
      position: fixed;
      background: #fffacd;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 12px;
      max-width: 300px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 1000001;
      pointer-events: auto;
    `;
    
    popup.innerHTML = `
      <div class="note-header" style="font-weight: bold; margin-bottom: 8px;">📝 便利贴</div>
      <div class="note-content" style="margin-bottom: 10px; white-space: pre-wrap;">${content}</div>
      <div class="note-actions">
        <button onclick="this.parentElement.parentElement.remove()" style="padding: 4px 8px; font-size: 12px;">关闭</button>
      </div>
    `;

    // 定位弹窗
    const badge = document.getElementById(`badge-${noteId}`);
    const badgeRect = badge.getBoundingClientRect();
    popup.style.left = `${badgeRect.right + 10}px`;
    popup.style.top = `${badgeRect.top}px`;

    document.body.appendChild(popup);

    // 3秒后自动关闭
    setTimeout(() => {
      if (popup.parentNode) {
        popup.remove();
      }
    }, 3000);
  }

  /**
   * 隐藏工具栏
   */
  hideToolbar() {
    this.toolbarContainer.style.display = 'none';
    this.currentRange = null;
  }

  /**
   * 切换 GlassNote 开关
   */
  toggleGlassNote() {
    this.isEnabled = !this.isEnabled;
    this.layerContainer.style.display = this.isEnabled ? 'block' : 'none';
    console.log(`GlassNote ${this.isEnabled ? '已启用' : '已禁用'}`);
  }

  /**
   * 保存标注到本地存储
   */
  async saveAnnotation(annotationData) {
    try {
      const url = window.location.href;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url] || { url: url, elements: [], lastModified: new Date().toISOString() };
      
      pageData.elements.push(annotationData);
      pageData.lastModified = new Date().toISOString();
      
      await chrome.storage.local.set({ [url]: pageData });
      console.log('标注已保存:', annotationData);
    } catch (error) {
      console.error('保存标注失败:', error);
    }
  }

  /**
   * 加载已存储的标注
   */
  async loadStoredAnnotations() {
    try {
      const url = window.location.href;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url];
      
      if (pageData && pageData.elements) {
        pageData.elements.forEach(annotation => {
          this.restoreAnnotation(annotation);
        });
        console.log(`已加载 ${pageData.elements.length} 个标注`);
      }
    } catch (error) {
      console.error('加载标注失败:', error);
    }
  }

  /**
   * 恢复标注元素
   */
  restoreAnnotation(annotationData) {
    const { id, type, color, position, positions, content } = annotationData;
    
    if (type === 'note') {
      // 恢复便利贴（使用第一个位置或单一位置）
      const pos = position || (positions && positions[0]);
      if (!pos) return;
      
      const badge = document.createElement('div');
      badge.className = 'glassnote-note-badge';
      badge.id = `badge-${id}`;
      badge.textContent = '📝';
      badge.style.cssText = `
        position: absolute !important;
        left: ${pos.left}px !important;
        top: ${pos.top}px !important;
        width: 20px !important;
        height: 20px !important;
        background: #ff6b35 !important;
        color: white !important;
        border-radius: 50% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        cursor: pointer !important;
        font-size: 12px !important;
        pointer-events: auto !important;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
        z-index: 999999 !important;
      `;
      
      badge.addEventListener('click', () => {
        this.showNotePopup(id, content);
      });
      
      this.layerContainer.appendChild(badge);
    } else {
      // 恢复其他类型标注（支持多位置）
      const positionsArray = positions || (position ? [position] : []);
      
      positionsArray.forEach((pos, index) => {
        const layerElement = document.createElement('div');
        layerElement.className = 'glassnote-annotation';
        layerElement.id = `${id}-${index}`;
        layerElement.style.cssText = `
          position: absolute !important;
          left: ${pos.left}px !important;
          top: ${pos.top}px !important;
          width: ${pos.width}px !important;
          height: ${pos.height}px !important;
          pointer-events: none !important;
          border-radius: 3px !important;
          box-sizing: border-box !important;
        `;

        // 设置样式
        switch (type) {
          case 'highlight':
            layerElement.style.background = color || '#ffff00';
            layerElement.style.opacity = '0.3';
            break;
          case 'bold':
            // 使用改进的加粗效果
            layerElement.style.background = 'rgba(255, 165, 0, 0.1)';
            layerElement.style.border = '1px solid #ff8c00';
            layerElement.style.boxShadow = 'inset 0 0 0 1px rgba(255, 140, 0, 0.3)';
            break;
          case 'underline':
            layerElement.style.borderBottom = '2px solid #333';
            break;
          case 'color':
            layerElement.style.background = color;
            layerElement.style.opacity = '0.2';
            layerElement.style.border = `1px solid ${color}`;
            break;
        }

        this.layerContainer.appendChild(layerElement);
      });
    }
    
    this.layerElements.set(id, annotationData);
  }
}

// 初始化 GlassNote
const glassNote = new GlassNoteLayer();

// 监听来自扩展的消息
chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    glassNote.toggleGlassNote();
  }
});
