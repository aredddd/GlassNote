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
      if (this.currentTab) {
        chrome.tabs.sendMessage(this.currentTab.id, {
          action: 'toggle',
          enabled: enabled
        });
      }

      console.log(`GlassNote ${enabled ? '已启用' : '已禁用'}`);
    } catch (error) {
      console.error('切换功能失败:', error);
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
          chrome.tabs.sendMessage(this.currentTab.id, {
            action: 'setMode',
            mode: 'highlight'
          });
          this.showToast('高亮模式已激活');
          break;

        case 'note':
          // 激活便利贴模式
          chrome.tabs.sendMessage(this.currentTab.id, {
            action: 'setMode',
            mode: 'note'
          });
          this.showToast('便利贴模式已激活');
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
      chrome.tabs.sendMessage(this.currentTab.id, {
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

      if (pageData && pageData.elements) {
        pageData.elements.forEach(element => {
          if (element.type === 'note') {
            noteCount++;
          } else {
            highlightCount++;
          }
          totalCount++;
        });
      }

      // 更新显示
      document.getElementById('highlightCount').textContent = highlightCount;
      document.getElementById('noteCount').textContent = noteCount;
      document.getElementById('totalCount').textContent = totalCount;

    } catch (error) {
      console.error('加载统计数据失败:', error);
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
      
      // 过滤出页面数据
      const pageData = {};
      Object.keys(allData).forEach(key => {
        if (key.startsWith('http')) {
          pageData[key] = allData[key];
        }
      });

      // 创建导出数据
      const exportData = {
        version: '1.0.0',
        exportTime: new Date().toISOString(),
        data: pageData
      };

      // 下载文件
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `glassnote-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      
      this.showToast('数据导出成功');
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
