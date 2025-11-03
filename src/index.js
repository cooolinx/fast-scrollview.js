/**
 * FastScrollView - 高性能虚拟滚动库
 * 
 * 核心特性：
 * - 跳跃式按需渲染：可以从任意位置开始渲染，无需预先计算
 * - 双向扩展：向上或向下滚动时自动追加新元素
 * - 智能缓存：已测量的元素高度自动缓存
 * - 零跳动：精心设计的占位符管理策略
 * 
 * @class
 */
class FastScrollView {
  /**
   * 创建 FastScrollView 实例
   * @param {HTMLElement|string} container - 容器元素或选择器
   * @param {Array} items - 要渲染的数据数组
   * @param {Function} render - 渲染函数 (item, index, totalSize) => HTMLElement | string
   * @param {Object} options - 可选配置
   * @param {number} options.estimatedItemHeight - 预估行高（默认50px，仅用于估算未渲染元素）
   * @param {number} options.bufferThreshold - 缓冲阈值（默认2，表示提前2个屏幕高度触发渲染）
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

    // 配置（支持向后兼容）
    this.options = {
      estimatedItemHeight: options.estimatedItemHeight || 50,
      // bufferThreshold 和 bufferSize 都支持（向后兼容）
      bufferThreshold: options.bufferThreshold || options.bufferSize || 2,
      onScroll: options.onScroll || null,
    };

    // 数据
    this.items = items || [];
    this.render = render;

    // 已渲染的范围（不再缓存高度，直接从 DOM 读取）
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;

    // DOM 元素
    this.contentContainer = null;
    this.topSpacer = null;
    this.bottomSpacer = null;

    // 内部状态标志
    this.isUpdating = false;
    this.boundHandleScroll = null;
    this.rafId = null;
    this.scrollRaf = null;
    this.lastScrollTop = 0;
    this.batchUpdateMode = false;
    this.pendingUpdate = false;

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

    // 创建顶部占位符
    this.topSpacer = document.createElement('div');
    this.topSpacer.style.height = '0px';

    // 创建内容容器
    this.contentContainer = document.createElement('div');

    // 创建底部占位符
    this.bottomSpacer = document.createElement('div');
    this.bottomSpacer.style.height = '0px';

    // 组装 DOM（直接添加到 container）
    this.container.appendChild(this.topSpacer);
    this.container.appendChild(this.contentContainer);
    this.container.appendChild(this.bottomSpacer);

    // 绑定滚动事件
    this.boundHandleScroll = this.handleScroll.bind(this);
    this.container.addEventListener('scroll', this.boundHandleScroll);

    // 首次渲染
    this.updateVisibleItems();
  }

  /**
   * 处理滚动事件
   */
  handleScroll() {
    if (this.isUpdating) {
      return;
    }

    if (this.scrollRaf) {
      return;
    }

    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = null;
      
      const newScrollTop = this.container.scrollTop;
      
      if (Math.abs(newScrollTop - this.lastScrollTop) < 1) {
        return;
      }
      
      this.lastScrollTop = newScrollTop;
      
      // 重新渲染可视区域
      this.updateVisibleItems();

      if (this.options.onScroll) {
        const range = this.getVisibleRange();
        this.options.onScroll({
          scrollTop: newScrollTop,
          visibleStart: range.start,
          visibleEnd: range.end,
        });
      }
    });
  }

  /**
   * 获取指定范围的累计高度
   * 对于已渲染的元素，从 DOM 读取实时高度
   * 对于未渲染的元素，使用估算高度
   */
  getHeightSum(startIndex, endIndex) {
    let total = 0;
    for (let i = startIndex; i < endIndex; i++) {
      // 检查元素是否已渲染
      if (i >= this.renderedStartIndex && i < this.renderedEndIndex) {
        const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
        if (element) {
          total += element.offsetHeight;
        } else {
          total += this.options.estimatedItemHeight;
        }
      } else {
        // 未渲染的元素使用估算高度
        total += this.options.estimatedItemHeight;
      }
    }
    return total;
  }

  /**
   * 更新可视区域内的元素
   * 支持跳跃式渲染：可以从任意位置开始渲染
   */
  updateVisibleItems() {
    if (this.items.length === 0) {
      this.contentContainer.innerHTML = '';
      this.topSpacer.style.height = '0px';
      this.bottomSpacer.style.height = '0px';
      return;
    }

    this.isUpdating = true;

    const containerHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    const scrollBottom = scrollTop + containerHeight;

    // 如果还没有渲染任何内容，从当前滚动位置开始渲染
    if (this.renderedStartIndex === -1) {
      this.renderFromPosition(scrollTop);
      this.isUpdating = false;
      return;
    }

    // 计算已渲染区域的位置
    const renderedTop = this.getHeightSum(0, this.renderedStartIndex);
    const renderedBottom = renderedTop + this.getHeightSum(this.renderedStartIndex, this.renderedEndIndex);
    const expandThreshold = containerHeight * this.options.bufferThreshold;

    // 检查是否需要向下扩展
    const targetBottom = scrollBottom + expandThreshold;
    if (renderedBottom < targetBottom && this.renderedEndIndex < this.items.length) {
      // 分批渲染、测量，直到达到目标高度
      const batchSize = 10;
      let currentHeight = renderedBottom;
      
      while (this.renderedEndIndex < this.items.length && currentHeight < targetBottom) {
        const batchEnd = Math.min(this.renderedEndIndex + batchSize, this.items.length);
        
        // 同步渲染这一批
        this.appendItemsSync(this.renderedEndIndex, batchEnd);
        
        // 同步测量这一批的实际高度
        for (let i = this.renderedEndIndex; i < batchEnd; i++) {
          const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
          if (element) {
            const height = element.offsetHeight;
            currentHeight += (height > 0 ? height : this.options.estimatedItemHeight);
          } else {
            currentHeight += this.options.estimatedItemHeight;
          }
        }
        
        this.renderedEndIndex = batchEnd;
      }
    }

    // 检查是否需要向上扩展
    const targetTop = scrollTop - expandThreshold;
    if (renderedTop > targetTop && this.renderedStartIndex > 0) {
      // 分批渲染、测量，直到达到目标高度
      const batchSize = 10;
      let currentHeight = renderedTop;
      
      while (this.renderedStartIndex > 0 && currentHeight > targetTop) {
        const batchStart = Math.max(0, this.renderedStartIndex - batchSize);
        
        // 同步渲染这一批（插入到前面）
        this.prependItemsSync(batchStart, this.renderedStartIndex);
        
        // 同步测量这一批的实际高度
        for (let i = batchStart; i < this.renderedStartIndex; i++) {
          const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
          if (element) {
            const height = element.offsetHeight;
            currentHeight -= (height > 0 ? height : this.options.estimatedItemHeight);
          } else {
            currentHeight -= this.options.estimatedItemHeight;
          }
        }
        
        this.renderedStartIndex = batchStart;
      }
    }

    // 更新占位符
    this.updateSpacers();

    // 重置更新标志
    setTimeout(() => {
      this.isUpdating = false;
    }, 50);
  }

  /**
   * 从指定滚动位置开始渲染
   * 策略：找到起始位置后，分批渲染、测量、判断，直到填满屏幕
   */
  renderFromPosition(scrollTop) {
    const containerHeight = this.container.clientHeight;
    const expandThreshold = containerHeight * this.options.bufferThreshold;
    
    // 找到起始索引
    let startIndex = this.findStartIndexByRendering(scrollTop);
    
    // 从起始位置开始渲染，直到填满目标高度
    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = startIndex;
    this.contentContainer.innerHTML = '';
    
    // 批量渲染策略：累加已渲染内容的高度，直到填满屏幕
    const batchSize = 20;
    let accumulatedHeight = 0; // 已渲染内容的累计高度
    const targetHeight = containerHeight + expandThreshold;
    
    while (this.renderedEndIndex < this.items.length && accumulatedHeight < targetHeight) {
      const batchEnd = Math.min(this.renderedEndIndex + batchSize, this.items.length);
      
      // 渲染这一批
      this.appendItemsSync(this.renderedEndIndex, batchEnd);
      
      // 测量这一批的实际高度并累加
      for (let i = this.renderedEndIndex; i < batchEnd; i++) {
        const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
        if (element) {
          const height = element.offsetHeight;
          accumulatedHeight += (height > 0 ? height : this.options.estimatedItemHeight);
        } else {
          accumulatedHeight += this.options.estimatedItemHeight;
        }
      }
      
      this.renderedEndIndex = batchEnd;
    }
    
    this.updateSpacers();
  }

  /**
   * 查找起始索引
   * 使用估算高度快速定位
   */
  findStartIndexByRendering(scrollTop) {
    let currentTop = 0;
    for (let i = 0; i < this.items.length; i++) {
      // 对于已渲染的元素，读取实际高度
      const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
      const height = element ? element.offsetHeight : this.options.estimatedItemHeight;
      
      if (currentTop + height > scrollTop) {
        return i;
      }
      
      currentTop += height;
    }
    
    return Math.max(0, this.items.length - 1);
  }

  /**
   * 更新占位符高度
   */
  updateSpacers() {
    const topHeight = this.getHeightSum(0, this.renderedStartIndex);
    const bottomHeight = this.getHeightSum(this.renderedEndIndex, this.items.length);
    
    this.topSpacer.style.height = `${topHeight}px`;
    this.bottomSpacer.style.height = `${bottomHeight}px`;
  }

  /**
   * 同步渲染并追加到末尾
   */
  appendItemsSync(startIndex, endIndex) {
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (item === undefined) continue;

      const itemElement = this.createItemElement(item, i);
      fragment.appendChild(itemElement);
    }

    this.contentContainer.appendChild(fragment);
  }

  /**
   * 同步渲染并插入到开头
   */
  prependItemsSync(startIndex, endIndex) {
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (item === undefined) continue;

      const itemElement = this.createItemElement(item, i);
      fragment.appendChild(itemElement);
    }

    const firstChild = this.contentContainer.firstChild;
    if (firstChild) {
      this.contentContainer.insertBefore(fragment, firstChild);
    } else {
      this.contentContainer.appendChild(fragment);
    }
  }

  /**
   * 渲染指定范围的元素
   * @param {number} startIndex - 起始索引
   * @param {number} endIndex - 结束索引
   * @param {boolean} prepend - 是否插入到开头（默认追加到末尾）
   */
  renderItems(startIndex, endIndex, prepend = false) {
    const fragment = document.createDocumentFragment();

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (item === undefined) continue;

      const itemElement = this.createItemElement(item, i);
      fragment.appendChild(itemElement);
    }

    // 插入到DOM
    if (prepend) {
      const firstChild = this.contentContainer.firstChild;
      if (firstChild) {
        this.contentContainer.insertBefore(fragment, firstChild);
      } else {
        this.contentContainer.appendChild(fragment);
      }
    } else {
      this.contentContainer.appendChild(fragment);
    }
  }

  /**
   * 追加元素到末尾（appendItems 的别名）
   */
  appendItems(startIndex, endIndex) {
    this.renderItems(startIndex, endIndex, false);
  }

  /**
   * 在开头插入元素（prependItems 的别名）
   */
  prependItems(startIndex, endIndex) {
    this.renderItems(startIndex, endIndex, true);
  }

  /**
   * 创建单个元素
   */
  createItemElement(item, index) {
    const itemElement = document.createElement('div');
    itemElement.setAttribute('data-index', index);

    // 调用用户提供的渲染函数
    const content = this.render(item, index, this.items.length);
    
    if (typeof content === 'string') {
      itemElement.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      itemElement.appendChild(content);
    } else if (content && content.nodeType) {
      itemElement.appendChild(content);
    }

    return itemElement;
  }


  /**
   * 设置新的数据数组
   * @param {Array} items - 新的数据数组
   */
  setItems(items) {
    this.beginUpdate();
    this.items = items || [];
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    this.container.scrollTop = 0;
    this.endUpdate();
  }

  /**
   * 更新指定索引的数据
   * @param {number} index - 索引
   * @param {*} item - 新的数据项
   */
  setItem(index, item) {
    if (index >= 0 && index < this.items.length) {
      this.items[index] = item;
      
      // 如果这个item已经被渲染，直接替换元素
      if (index >= this.renderedStartIndex && index < this.renderedEndIndex) {
        const existingElement = this.contentContainer.querySelector(`[data-index="${index}"]`);
        if (existingElement) {
          const newElement = this.createItemElement(item, index);
          existingElement.replaceWith(newElement);
          
          // 元素高度可能变化，更新占位符
          requestAnimationFrame(() => {
            this.updateSpacers();
          });
          return;
        }
      }
      
      // 如果不在已渲染范围内，调用 updateVisibleItems
      if (!this.batchUpdateMode) {
        this.updateVisibleItems();
      } else {
        this.pendingUpdate = true;
      }
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
    
    // 插入操作比较复杂，重新渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    
    if (!this.batchUpdateMode) {
      this.updateVisibleItems();
    } else {
      this.pendingUpdate = true;
    }
  }

  /**
   * 在末尾添加数据
   * @param {*} item - 要添加的数据项
   */
  append(item) {
    this.items.push(item);
    if (!this.batchUpdateMode) {
      this.updateVisibleItems();
    } else {
      this.pendingUpdate = true;
    }
  }

  /**
   * 批量添加数据（高性能）
   * @param {Array} items - 要添加的数据项数组
   */
  appendBatch(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    
    this.beginUpdate();
    items.forEach(item => this.items.push(item));
    this.endUpdate();
  }

  /**
   * 在开头添加数据
   * @param {*} item - 要添加的数据项
   */
  prepend(item) {
    this.insertItem(0, item);
  }

  /**
   * 批量在开头添加数据（高性能）
   * @param {Array} items - 要添加的数据项数组
   */
  prependBatch(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    
    this.beginUpdate();
    // 反向插入以保持顺序
    for (let i = items.length - 1; i >= 0; i--) {
      this.items.unshift(items[i]);
    }
    
    // prepend 操作复杂，重新渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    
    this.endUpdate();
  }

  /**
   * 开始批量更新（暂停渲染）
   */
  beginUpdate() {
    this.batchUpdateMode = true;
    this.pendingUpdate = false;
  }

  /**
   * 结束批量更新（恢复渲染）
   */
  endUpdate() {
    this.batchUpdateMode = false;
    this.updateVisibleItems();
    this.pendingUpdate = false;
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
      
      // 删除操作复杂，重新渲染
      this.renderedStartIndex = -1;
      this.renderedEndIndex = -1;
      this.contentContainer.innerHTML = '';
      
      if (!this.batchUpdateMode) {
        this.updateVisibleItems();
      } else {
        this.pendingUpdate = true;
      }
    }
  }

  /**
   * 滚动到顶部（内部调用 scrollToItem(0)）
   */
  scrollToTop() {
    this.scrollToItem(0);
  }

  /**
   * 滚动到底部
   * 从最后一个元素开始往前渲染-测量，直到填满屏幕，然后滚动到底部
   */
  scrollToBottom() {
    if (this.items.length === 0) return;
    
    const containerHeight = this.container.clientHeight;
    const lastIndex = this.items.length - 1;
    
    // 清空当前渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    
    // 从最后往前渲染，直到填满 2 倍屏幕高度
    const targetHeight = containerHeight * 2;
    let startIndex = lastIndex;
    let accumulatedHeight = 0;
    const batchSize = 5;
    
    // 逐批往前渲染和测量
    while (startIndex >= 0 && accumulatedHeight < targetHeight) {
      const batchStart = Math.max(0, startIndex - batchSize + 1);
      const batchEnd = startIndex + 1;
      
      // 临时渲染这一批到一个测试容器
      const tempContainer = document.createElement('div');
      tempContainer.style.visibility = 'hidden';
      tempContainer.style.position = 'absolute';
      this.container.appendChild(tempContainer);
      
      for (let i = batchStart; i < batchEnd; i++) {
        const item = this.items[i];
        if (item !== undefined) {
          const element = this.createItemElement(item, i);
          tempContainer.appendChild(element);
          
          // 立即测量（不缓存，下次渲染时重新测量）
          const height = element.offsetHeight;
          accumulatedHeight += (height > 0 ? height : this.options.estimatedItemHeight);
        }
      }
      
      // 移除临时容器
      this.container.removeChild(tempContainer);
      
      startIndex = batchStart - 1;
    }
    
    startIndex = Math.max(0, startIndex + 1);
    
    // 现在正式渲染从 startIndex 到最后
    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = this.items.length;
    this.appendItems(startIndex, this.items.length);
    this.updateSpacers();
    
    // 滚动到底部
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
      
      requestAnimationFrame(() => {
        this.container.scrollTop = this.container.scrollHeight;
      });
    });
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
      // 计算目标位置
      const offset = this.getHeightSum(0, index);
      
      // 清空当前渲染，从目标位置重新渲染
      this.renderedStartIndex = -1;
      this.renderedEndIndex = -1;
      this.contentContainer.innerHTML = '';
      
      // 设置滚动位置，这会触发 updateVisibleItems 从新位置渲染
      this.container.scrollTop = offset;
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
    if (this.renderedStartIndex === -1) {
      return {
        start: 0,
        end: 0,
        count: 0,
      };
    }
    return {
      start: this.renderedStartIndex,
      end: this.renderedEndIndex,
      count: this.renderedEndIndex - this.renderedStartIndex,
    };
  }

  /**
   * 获取数据项总数
   */
  getItemCount() {
    return this.items.length;
  }

  /**
   * 获取总高度（估算值）
   * 注意：此方法需要遍历所有元素，在大数据集下可能较慢
   */
  getTotalHeight() {
    return this.getHeightSum(0, this.items.length);
  }

  /**
   * 刷新显示（清空所有已渲染内容，从当前位置重新渲染）
   */
  refresh() {
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
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
    if (this.scrollRaf) {
      cancelAnimationFrame(this.scrollRaf);
    }
    
    this.container.innerHTML = '';
    this.items = [];
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
