/**
 * FastScrollView - 高性能虚拟滚动库，支持大量数据和动态高度
 * @class
 */
class FastScrollView {
  /**
   * 创建 FastScrollView 实例
   * @param {HTMLElement|string} container - 容器元素或选择器
   * @param {Array} items - 要渲染的数据数组
   * @param {Function} render - 渲染函数 (item, index, totalSize) => HTMLElement | string
   * @param {Object} options - 可选配置
   * @param {number} options.estimatedItemHeight - 预估行高（默认50px）
   * @param {number} options.bufferSize - 缓冲区大小（默认5，表示上下额外渲染5个元素）
   * @param {Function} options.onScroll - 滚动回调
   */
  constructor(container, items = [], render = null, options = {}) {
    // 获取容器元素
    this.container = typeof container === 'string' 
      ? document.querySelector(container) 
      : container;

    if (!this.container) {
      throw new Error('FastScrollView: Container element not found');
    }

    if (typeof render !== 'function') {
      throw new Error('FastScrollView: Render function is required');
    }

    // 配置
    this.options = {
      estimatedItemHeight: options.estimatedItemHeight || 50,
      bufferSize: options.bufferSize || 5,
      onScroll: options.onScroll || null,
    };

    // 数据
    this.items = items || [];
    this.render = render;

    // 高度缓存
    this.itemHeights = new Map(); // 存储每个索引的实际高度
    this.itemPositions = new Map(); // 存储每个索引的顶部位置

    // 可视区域状态
    this.scrollTop = 0;
    this.visibleStart = 0;
    this.visibleEnd = 0;

    // DOM 元素
    this.scrollContainer = null;
    this.contentContainer = null;
    this.topSpacer = null;
    this.bottomSpacer = null;

    // 内部状态标志
    this.isUpdating = false; // 防止在更新DOM时触发滚动事件导致无限循环
    this.boundHandleScroll = null; // 保存绑定的滚动处理函数引用
    this.rafId = null; // 保存 requestAnimationFrame ID
    this.updateTimeout = null; // 保存 setTimeout ID
    this.scrollRaf = null; // 保存滚动处理的 RAF ID
    this.lastScrollTop = 0; // 上次滚动位置

    // 初始化
    this.init();
  }

  /**
   * 初始化虚拟滚动容器
   */
  init() {
    // 清空容器
    this.container.innerHTML = '';

    // 设置容器样式
    this.container.style.overflow = 'auto';
    this.container.style.position = 'relative';

    // 创建虚拟滚动容器（用于撑开滚动条）
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.style.position = 'absolute';
    this.scrollContainer.style.top = '0';
    this.scrollContainer.style.left = '0';
    this.scrollContainer.style.width = '1px';
    this.scrollContainer.style.height = '0px';
    this.scrollContainer.style.pointerEvents = 'none';

    // 创建内容容器（使用 transform 定位）
    this.contentContainer = document.createElement('div');
    this.contentContainer.style.position = 'absolute';
    this.contentContainer.style.top = '0';
    this.contentContainer.style.left = '0';
    this.contentContainer.style.right = '0';
    this.contentContainer.style.willChange = 'transform';

    // 组装 DOM
    this.container.appendChild(this.scrollContainer);
    this.container.appendChild(this.contentContainer);

    // 绑定滚动事件（保存引用以便后续正确移除）
    this.boundHandleScroll = this.handleScroll.bind(this);
    this.container.addEventListener('scroll', this.boundHandleScroll);

    // 首次渲染
    this.updateVisibleItems();
  }

  /**
   * 处理滚动事件
   */
  handleScroll() {
    // 如果正在更新DOM，忽略此次滚动事件，防止无限循环
    if (this.isUpdating) {
      return;
    }

    // 使用 requestAnimationFrame 节流滚动处理
    if (this.scrollRaf) {
      return;
    }

    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = null;
      
      const newScrollTop = this.container.scrollTop;
      
      // 如果滚动位置没有实际变化，不处理
      if (Math.abs(newScrollTop - this.lastScrollTop) < 1) {
        return;
      }
      
      this.scrollTop = newScrollTop;
      this.lastScrollTop = newScrollTop;
      this.updateVisibleItems();

      if (this.options.onScroll) {
        this.options.onScroll({
          scrollTop: this.scrollTop,
          visibleStart: this.visibleStart,
          visibleEnd: this.visibleEnd,
        });
      }
    });
  }

  /**
   * 计算并缓存所有元素的位置
   */
  calculatePositions() {
    let currentPosition = 0;
    
    for (let i = 0; i < this.items.length; i++) {
      this.itemPositions.set(i, currentPosition);
      const height = this.itemHeights.get(i) || this.options.estimatedItemHeight;
      currentPosition += height;
    }

    return currentPosition; // 返回总高度
  }

  /**
   * 根据滚动位置查找起始索引
   */
  findStartIndex(scrollTop) {
    let start = 0;
    let end = this.items.length - 1;
    let result = 0;

    while (start <= end) {
      const mid = Math.floor((start + end) / 2);
      const position = this.itemPositions.get(mid) || 0;

      if (position === scrollTop) {
        return mid;
      } else if (position < scrollTop) {
        result = mid;
        start = mid + 1;
      } else {
        end = mid - 1;
      }
    }

    return result;
  }

  /**
   * 更新可视区域内的元素
   */
  updateVisibleItems() {
    if (this.items.length === 0) {
      this.contentContainer.innerHTML = '';
      this.contentContainer.style.transform = 'translateY(0px)';
      this.scrollContainer.style.height = '0px';
      return;
    }

    // 设置更新标志，防止在更新DOM时触发的滚动事件导致无限循环
    this.isUpdating = true;

    const containerHeight = this.container.clientHeight;
    const scrollTop = this.scrollTop;

    // 计算所有位置
    const totalHeight = this.calculatePositions();

    // 查找可视区域的起始和结束索引
    let startIndex = this.findStartIndex(scrollTop);
    let endIndex = startIndex;

    // 计算结束索引
    let currentHeight = this.itemPositions.get(startIndex) || 0;
    while (endIndex < this.items.length && currentHeight < scrollTop + containerHeight) {
      const itemHeight = this.itemHeights.get(endIndex) || this.options.estimatedItemHeight;
      currentHeight += itemHeight;
      endIndex++;
    }

    // 添加缓冲区
    startIndex = Math.max(0, startIndex - this.options.bufferSize);
    endIndex = Math.min(this.items.length, endIndex + this.options.bufferSize);

    this.visibleStart = startIndex;
    this.visibleEnd = endIndex;

    // 获取起始位置（用于 transform）
    const offsetY = this.itemPositions.get(startIndex) || 0;

    // 更新虚拟滚动容器高度（撑开滚动条）
    this.scrollContainer.style.height = `${totalHeight}px`;

    // 使用 transform 定位内容容器
    this.contentContainer.style.transform = `translateY(${offsetY}px)`;

    // 渲染可视区域的元素
    this.renderVisibleItems(startIndex, endIndex);

    // 取消之前的 timeout（如果有）
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    // 渲染完成后，重置更新标志
    // 使用较长的延迟确保所有DOM操作和高度测量完成
    this.updateTimeout = setTimeout(() => {
      this.isUpdating = false;
      this.updateTimeout = null;
    }, 50);
  }

  /**
   * 渲染可视区域的元素
   */
  renderVisibleItems(startIndex, endIndex) {
    const fragment = document.createDocumentFragment();
    const itemsToRender = [];

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (item === undefined) continue;

      const itemElement = document.createElement('div');
      itemElement.setAttribute('data-index', i);

      // 调用用户提供的渲染函数
      const content = this.render(item, i, this.items.length);
      
      if (typeof content === 'string') {
        itemElement.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        itemElement.appendChild(content);
      } else if (content && content.nodeType) {
        itemElement.appendChild(content);
      }

      itemsToRender.push({ element: itemElement, index: i });
      fragment.appendChild(itemElement);
    }

    // 更新 DOM
    this.contentContainer.innerHTML = '';
    this.contentContainer.appendChild(fragment);

    // 取消之前的 requestAnimationFrame（如果有）
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    // 测量并缓存高度
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      let heightChanged = false;
      
      itemsToRender.forEach(({ element, index }) => {
        if (element.parentNode) {
          const height = element.offsetHeight;
          if (height > 0) {
            const oldHeight = this.itemHeights.get(index);
            if (oldHeight !== height) {
              this.itemHeights.set(index, height);
              heightChanged = true;
            }
          }
        }
      });

      // 如果高度发生变化，需要重新计算占位符高度
      if (heightChanged) {
        this.recalculateSpacers();
      }
    });
  }

  /**
   * 重新计算占位符高度（不触发重新渲染）
   */
  recalculateSpacers() {
    // 标记正在更新，防止触发滚动处理
    const wasUpdating = this.isUpdating;
    this.isUpdating = true;
    
    const totalHeight = this.calculatePositions();
    const offsetY = this.itemPositions.get(this.visibleStart) || 0;
    
    // 更新虚拟滚动容器高度
    this.scrollContainer.style.height = `${totalHeight}px`;
    
    // 更新内容容器位置
    this.contentContainer.style.transform = `translateY(${offsetY}px)`;
    
    // 恢复更新标志
    if (!wasUpdating) {
      setTimeout(() => {
        this.isUpdating = false;
      }, 10);
    }
  }

  /**
   * 设置新的数据数组
   * @param {Array} items - 新的数据数组
   */
  setItems(items) {
    this.items = items || [];
    this.itemHeights.clear();
    this.itemPositions.clear();
    this.scrollTop = this.container.scrollTop;
    this.updateVisibleItems();
  }

  /**
   * 更新指定索引的数据
   * @param {number} index - 索引
   * @param {*} item - 新的数据项
   */
  setItem(index, item) {
    if (index >= 0 && index < this.items.length) {
      this.items[index] = item;
      // 清除该项的高度缓存，因为内容可能变化
      this.itemHeights.delete(index);
      this.updateVisibleItems();
    }
  }

  /**
   * 在指定位置插入数据
   * @param {number} index - 插入位置
   * @param {*} item - 要插入的数据项
   */
  insertItem(index, item) {
    const insertIndex = Math.max(0, Math.min(index, this.items.length));
    this.items.splice(insertIndex, 0, item);
    
    // 重新计算插入位置之后的所有索引的高度缓存
    const newHeights = new Map();
    const newPositions = new Map();
    
    for (let [idx, height] of this.itemHeights.entries()) {
      if (idx >= insertIndex) {
        newHeights.set(idx + 1, height);
      } else {
        newHeights.set(idx, height);
      }
    }
    
    this.itemHeights = newHeights;
    this.itemPositions.clear();
    this.updateVisibleItems();
  }

  /**
   * 在末尾添加数据
   * @param {*} item - 要添加的数据项
   */
  append(item) {
    this.items.push(item);
    this.updateVisibleItems();
  }

  /**
   * 在开头添加数据
   * @param {*} item - 要添加的数据项
   */
  prepend(item) {
    this.insertItem(0, item);
  }

  /**
   * 删除数据项
   * @param {*|number} itemOrIndex - 数据项或索引
   */
  remove(itemOrIndex) {
    let index;
    
    if (typeof itemOrIndex === 'number') {
      index = itemOrIndex;
    } else {
      index = this.items.indexOf(itemOrIndex);
    }

    if (index >= 0 && index < this.items.length) {
      this.items.splice(index, 1);
      
      // 重新计算删除位置之后的所有索引的高度缓存
      const newHeights = new Map();
      
      for (let [idx, height] of this.itemHeights.entries()) {
        if (idx > index) {
          newHeights.set(idx - 1, height);
        } else if (idx < index) {
          newHeights.set(idx, height);
        }
        // idx === index 的项被删除，不保留
      }
      
      this.itemHeights = newHeights;
      this.itemPositions.clear();
      this.updateVisibleItems();
    }
  }

  /**
   * 滚动到顶部
   */
  scrollToTop() {
    this.container.scrollTop = 0;
  }

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    const totalHeight = this.calculatePositions();
    this.container.scrollTop = totalHeight;
  }

  /**
   * 滚动到指定项
   * @param {*|number} itemOrIndex - 数据项或索引
   */
  scrollToItem(itemOrIndex) {
    let index;
    
    if (typeof itemOrIndex === 'number') {
      index = itemOrIndex;
    } else {
      index = this.items.indexOf(itemOrIndex);
    }

    if (index >= 0 && index < this.items.length) {
      // 确保位置已计算
      this.calculatePositions();
      const position = this.itemPositions.get(index) || 0;
      this.container.scrollTop = position;
    }
  }

  /**
   * 获取当前滚动位置
   */
  getScrollTop() {
    return this.container.scrollTop;
  }

  /**
   * 获取可视区域信息
   */
  getVisibleRange() {
    return {
      start: this.visibleStart,
      end: this.visibleEnd,
      count: this.visibleEnd - this.visibleStart,
    };
  }

  /**
   * 获取数据项总数
   */
  getItemCount() {
    return this.items.length;
  }

  /**
   * 获取总高度
   */
  getTotalHeight() {
    return this.calculatePositions();
  }

  /**
   * 刷新显示（重新测量所有高度）
   */
  refresh() {
    this.itemHeights.clear();
    this.itemPositions.clear();
    this.updateVisibleItems();
  }

  /**
   * 销毁实例
   */
  destroy() {
    // 使用保存的函数引用来正确移除事件监听器
    if (this.boundHandleScroll) {
      this.container.removeEventListener('scroll', this.boundHandleScroll);
    }
    
    // 清理所有定时器和动画帧
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
    }
    
    this.container.innerHTML = '';
    this.items = [];
    this.itemHeights.clear();
    this.itemPositions.clear();
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FastScrollView;
}

if (typeof window !== 'undefined') {
  window.FastScrollView = FastScrollView;
}

export default FastScrollView;
