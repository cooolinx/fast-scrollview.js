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

    // 元素缓存：保存已渲染过的元素高度
    this.renderedCache = new Map();

    // 已渲染的范围
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
   */
  getHeightSum(startIndex, endIndex) {
    let total = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const cached = this.renderedCache.get(i);
      const height = cached ? cached.height : this.options.estimatedItemHeight;
      total += height;
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
    if (scrollBottom + expandThreshold > renderedBottom && this.renderedEndIndex < this.items.length) {
      let targetIndex = this.renderedEndIndex;
      let currentHeight = renderedBottom;
      
      while (targetIndex < this.items.length && currentHeight < scrollBottom + expandThreshold) {
        const cached = this.renderedCache.get(targetIndex);
        const height = cached ? cached.height : this.options.estimatedItemHeight;
        currentHeight += height;
        targetIndex++;
      }
      
      this.appendItems(this.renderedEndIndex, targetIndex);
      this.renderedEndIndex = targetIndex;
    }

    // 检查是否需要向上扩展
    if (scrollTop - expandThreshold < renderedTop && this.renderedStartIndex > 0) {
      let targetIndex = this.renderedStartIndex - 1;
      let currentHeight = renderedTop;
      
      while (targetIndex >= 0 && currentHeight > scrollTop - expandThreshold) {
        const cached = this.renderedCache.get(targetIndex);
        const height = cached ? cached.height : this.options.estimatedItemHeight;
        currentHeight -= height;
        targetIndex--;
      }
      
      targetIndex = Math.max(0, targetIndex + 1);
      
      this.prependItems(targetIndex, this.renderedStartIndex);
      this.renderedStartIndex = targetIndex;
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
   */
  renderFromPosition(scrollTop) {
    const containerHeight = this.container.clientHeight;
    const expandThreshold = containerHeight * this.options.bufferThreshold;
    
    // 找到起始索引（第一个底部超过 scrollTop 的元素）
    let currentTop = 0;
    let startIndex = 0;
    
    while (startIndex < this.items.length) {
      const cached = this.renderedCache.get(startIndex);
      const height = cached ? cached.height : this.options.estimatedItemHeight;
      
      if (currentTop + height > scrollTop) {
        break;
      }
      
      currentTop += height;
      startIndex++;
    }

    // 计算结束索引（渲染到可视区域底部 + 缓冲阈值）
    let endIndex = startIndex;
    let currentHeight = currentTop;
    const targetHeight = scrollTop + containerHeight + expandThreshold;
    
    while (endIndex < this.items.length && currentHeight < targetHeight) {
      const cached = this.renderedCache.get(endIndex);
      const height = cached ? cached.height : this.options.estimatedItemHeight;
      currentHeight += height;
      endIndex++;
    }

    // 设置渲染范围并渲染
    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = endIndex;
    
    this.contentContainer.innerHTML = '';
    this.appendItems(startIndex, endIndex);
    this.updateSpacers();
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
   * 渲染指定范围的元素
   * @param {number} startIndex - 起始索引
   * @param {number} endIndex - 结束索引
   * @param {boolean} prepend - 是否插入到开头（默认追加到末尾）
   */
  renderItems(startIndex, endIndex, prepend = false) {
    const fragment = document.createDocumentFragment();
    const itemsToMeasure = [];

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (item === undefined) continue;

      const itemElement = this.createItemElement(item, i);
      
      if (!this.renderedCache.has(i)) {
        itemsToMeasure.push({ element: itemElement, index: i });
      }
      
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

    // 测量新创建的元素
    if (itemsToMeasure.length > 0) {
      this.measureHeights(itemsToMeasure);
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
   * 测量元素高度并缓存
   * 关键改变：不再调整 scrollTop，避免打断用户滚动
   */
  measureHeights(itemsToRender) {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      
      // 直接测量并缓存高度，不做任何位置调整
      itemsToRender.forEach(({ element, index }) => {
        if (element.parentNode) {
          const height = element.offsetHeight;
          if (height > 0) {
            // 只保存高度信息
            this.renderedCache.set(index, {
              height: height
            });
          }
        }
      });
    });
  }

  /**
   * 设置新的数据数组
   * @param {Array} items - 新的数据数组
   */
  setItems(items) {
    this.beginUpdate();
    this.items = items || [];
    this.renderedCache.clear();
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
      this.renderedCache.delete(index);
      
      // 如果这个item已经被渲染，直接替换元素
      if (index >= this.renderedStartIndex && index < this.renderedEndIndex) {
        const existingElement = this.contentContainer.querySelector(`[data-index="${index}"]`);
        if (existingElement) {
          const newElement = this.createItemElement(item, index);
          existingElement.replaceWith(newElement);
          
          // 测量新元素高度并更新缓存和占位符
          requestAnimationFrame(() => {
            const height = newElement.offsetHeight;
            if (height > 0) {
              this.renderedCache.set(index, { height });
              this.updateSpacers();
            }
          });
          return; // 已经处理完成，不需要调用 updateVisibleItems
        }
      }
      
      // 如果不在已渲染范围内，或者没找到元素，调用 updateVisibleItems
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
    this.renderedCache.clear();
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
    this.renderedCache.clear();
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
      this.renderedCache.clear();
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
   * 滚动到底部（内部调用 scrollToItem 到最后一项）
   */
  scrollToBottom() {
    if (this.items.length > 0) {
      this.scrollToItem(this.items.length - 1);
    }
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
   * 注意：此方法在大数据集下可能较慢，因为需要遍历所有元素
   */
  getTotalHeight() {
    let total = 0;
    for (let i = 0; i < this.items.length; i++) {
      const cached = this.renderedCache.get(i);
      const height = cached ? cached.height : this.options.estimatedItemHeight;
      total += height;
    }
    return total;
  }

  /**
   * 刷新显示（重新测量所有高度）
   */
  refresh() {
    this.renderedCache.clear();
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
    this.renderedCache.clear();
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
