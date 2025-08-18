/**
 * GlassNote 弹窗脚本
 * 处理扩展弹窗的用户交互和数据显示
 */

class GlassNotePopup {
  constructor() {
    this.currentTab = null;
    this.init();
  }

  /**
   * 初始化弹窗
   */
  async init() {
    await this.getCurrentTab();
    this.setupEventListeners();
    await this.loadStats();
    await this.loadSettings();
  }

  /**
   * 获取当前活动标签页
   */
  async getCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tabs[0];
    } catch (error) {
      console.error('获取当前标签页失败:', error);
    }
  }

  /**
   * 安全发送消息到content script
   */
  async sendMessageSafely(message, retries = 1) {
    if (!this.currentTab) {
      console.warn('没有活动标签页');
      return false;
    }

    // 检查URL是否支持content script
    const unsupportedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'edge:', 'about:', 'file:'];
    const url = this.currentTab.url || '';
    
    if (unsupportedProtocols.some(protocol => url.startsWith(protocol))) {
      this.showToast('此页面不支持标注功能');
      return false;
    }

    // 检查标签页状态
    if (this.currentTab.status !== 'complete') {
      this.showToast('页面还在加载中，请稍后再试');
      return false;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await chrome.tabs.sendMessage(this.currentTab.id, message);
        return true;
      } catch (error) {
        console.error(`发送消息失败 (尝试 ${attempt + 1}/${retries + 1}):`, error);
        
        // 如果是最后一次尝试，显示错误信息
        if (attempt === retries) {
          if (error.message.includes('Could not establish connection') || 
              error.message.includes('Receiving end does not exist')) {
            
            // 尝试注入content script
            const injected = await this.tryInjectContentScript();
            if (injected) {
              this.showToast('正在初始化标注系统，请稍后再试');
            } else {
              this.showToast('页面不支持标注功能或需要刷新页面');
            }
          } else {
            this.showToast('操作失败，请重试');
          }
          return false;
        }
        
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    return false;
  }

  /**
   * 尝试注入content script
   */
  async tryInjectContentScript() {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: this.currentTab.id },
        files: ['src/content/content.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: this.currentTab.id },
        files: ['styles/content.css']
      });
      
      return true;
    } catch (error) {
      console.error('注入content script失败:', error);
      return false;
    }
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    // 功能开关
    const enableToggle = document.getElementById('enableToggle');
    enableToggle.addEventListener('change', (e) => {
      this.toggleFeature(e.target.checked);
    });

    // 快速操作按钮
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = btn.getAttribute('data-action');
        this.handleAction(action);
      });
    });

    // 底部链接
    document.getElementById('exportBtn').addEventListener('click', (e) => {
      e.preventDefault();
      this.exportData();
    });

    document.getElementById('settingsBtn').addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettings();
    });
  }

  /**
   * 切换功能开关
   */
  async toggleFeature(enabled) {
    try {
      // 保存设置
      await chrome.storage.sync.set({ enabled: enabled });
      
      // 向内容脚本发送消息
      const success = await this.sendMessageSafely({
        action: 'toggle',
        enabled: enabled
      });

      if (success) {
        console.log(`GlassNote ${enabled ? '已启用' : '已禁用'}`);
      }
    } catch (error) {
      console.error('切换功能失败:', error);
      this.showToast('设置保存失败');
    }
  }

  /**
   * 处理快速操作
   */
  async handleAction(action) {
    if (!this.currentTab) return;

    try {
      switch (action) {
        case 'highlight':
          // 激活高亮模式
          const highlightSuccess = await this.sendMessageSafely({
            action: 'setMode',
            mode: 'highlight'
          });
          if (highlightSuccess) {
            this.showToast('高亮模式已激活');
          }
          break;

        case 'note':
          // 激活便利贴模式
          const noteSuccess = await this.sendMessageSafely({
            action: 'setMode',
            mode: 'note'
          });
          if (noteSuccess) {
            this.showToast('便利贴模式已激活');
          }
          break;

        case 'clear':
          // 清除当前页面的所有标注
          if (confirm('确定要清除当前页面的所有标注吗？此操作不可撤销。')) {
            await this.clearAnnotations();
            this.showToast('标注已清除');
          }
          break;
      }
    } catch (error) {
      console.error('操作失败:', error);
      this.showToast('操作失败，请重试');
    }
  }

  /**
   * 清除标注
   */
  async clearAnnotations() {
    if (!this.currentTab) return;

    try {
      // 从存储中删除当前页面的数据
      const url = this.currentTab.url;
      await chrome.storage.local.remove([url]);

      // 通知内容脚本清除显示的标注
      await this.sendMessageSafely({
        action: 'clearAll'
      });

      // 刷新统计数据
      await this.loadStats();
    } catch (error) {
      console.error('清除标注失败:', error);
    }
  }

  /**
   * 加载统计数据
   */
  async loadStats() {
    if (!this.currentTab) return;

    try {
      const url = this.currentTab.url;
      const result = await chrome.storage.local.get([url]);
      const pageData = result[url];

      let highlightCount = 0;
      let noteCount = 0;
      let totalCount = 0;

      // 支持新旧数据格式
      const annotations = pageData?.annotations || pageData?.elements || [];
      
      annotations.forEach(element => {
        if (element.type === 'note') {
          noteCount++;
        } else {
          highlightCount++;
        }
        totalCount++;
      });

      // 更新显示
      document.getElementById('highlightCount').textContent = highlightCount;
      document.getElementById('noteCount').textContent = noteCount;
      document.getElementById('totalCount').textContent = totalCount;

    } catch (error) {
      console.error('加载统计数据失败:', error);
      // 出错时显示0
      document.getElementById('highlightCount').textContent = '0';
      document.getElementById('noteCount').textContent = '0';
      document.getElementById('totalCount').textContent = '0';
    }
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['enabled']);
      const enabled = result.enabled !== undefined ? result.enabled : true;
      
      document.getElementById('enableToggle').checked = enabled;
    } catch (error) {
      console.error('加载设置失败:', error);
    }
  }

  /**
   * 导出数据
   */
  async exportData() {
    try {
      // 获取所有存储的数据
      const allData = await chrome.storage.local.get(null);
      
      // 过滤出页面数据并确保数据格式一致
      const pageData = {};
      Object.keys(allData).forEach(key => {
        if (key.startsWith('http')) {
          const data = allData[key];
          // 统一数据格式：如果有elements字段，转换为annotations
          if (data.elements && !data.annotations) {
            data.annotations = data.elements;
            delete data.elements;
          }
          pageData[key] = data;
        }
      });

      // 创建导出数据
      const exportData = {
        version: '2.0.0',
        exportTime: new Date().toISOString(),
        architecture: 'DOM内联标注系统',
        totalPages: Object.keys(pageData).length,
        totalAnnotations: Object.values(pageData).reduce((total, page) => 
          total + (page.annotations ? page.annotations.length : 0), 0),
        data: pageData
      };

      // 下载文件
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `glassnote-v2-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      this.showToast(`已导出 ${exportData.totalPages} 个页面的标注数据`);
    } catch (error) {
      console.error('导出数据失败:', error);
      this.showToast('导出失败，请重试');
    }
  }

  /**
   * 打开设置页面
   */
  openSettings() {
    // 未来可以打开一个设置页面
    chrome.tabs.create({
      url: chrome.runtime.getURL('src/options/options.html')
    });
  }

  /**
   * 显示提示消息
   */
  showToast(message) {
    // 创建简单的toast提示
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #333;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 显示动画
    setTimeout(() => {
      toast.style.opacity = '1';
    }, 10);
    
    // 自动隐藏
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, 2000);
  }
}

// 当弹窗加载完成时初始化
document.addEventListener('DOMContentLoaded', () => {
  new GlassNotePopup();
});

// 监听存储变化，实时更新统计
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    // 重新加载统计数据
    const popup = new GlassNotePopup();
    popup.loadStats();
  }
});
