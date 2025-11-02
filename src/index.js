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
    this.batchUpdateMode = false; // 批量更新模式标志
    this.pendingUpdate = false; // 是否有待处理的更新
    this.currentTransformOffset = 0; // 当前 transform 偏移量（锁定以避免跳动）

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

    // 创建滚动容器（使用传统的三层结构，更稳定）
    this.scrollContainer = document.createElement('div');
    this.scrollContainer.style.width = '100%';

    // 创建顶部占位符
    this.topSpacer = document.createElement('div');
    this.topSpacer.style.height = '0px';

    // 创建内容容器
    this.contentContainer = document.createElement('div');

    // 创建底部占位符
    this.bottomSpacer = document.createElement('div');
    this.bottomSpacer.style.height = '0px';

    // 组装 DOM
    this.scrollContainer.appendChild(this.topSpacer);
    this.scrollContainer.appendChild(this.contentContainer);
    this.scrollContainer.appendChild(this.bottomSpacer);
    this.container.appendChild(this.scrollContainer);

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
      this.topSpacer.style.height = '0px';
      this.bottomSpacer.style.height = '0px';
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

    // 计算占位符高度
    const topSpacerHeight = this.itemPositions.get(startIndex) || 0;
    const bottomPosition = this.itemPositions.get(endIndex) || totalHeight;
    const bottomSpacerHeight = Math.max(0, totalHeight - bottomPosition);

    // 更新占位符（使用文档流，不会跳动）
    this.topSpacer.style.height = `${topSpacerHeight}px`;
    this.bottomSpacer.style.height = `${bottomSpacerHeight}px`;

    // 渲染可视区域的元素
    this.renderVisibleItems(startIndex, endIndex);

    // 取消之前的 timeout（如果有）
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    // 渲染完成后，重置更新标志
    this.updateTimeout = setTimeout(() => {
      this.isUpdating = false;
      this.updateTimeout = null;
    }, 50);
  }

  /**
   * 渲染可视区域的元素（使用差异化更新减少闪烁）
   */
  renderVisibleItems(startIndex, endIndex) {
    // 获取当前已渲染的元素
    const existingElements = Array.from(this.contentContainer.children);
    const existingIndices = new Set();
    const existingMap = new Map();

    existingElements.forEach(el => {
      const index = parseInt(el.getAttribute('data-index'));
      if (!isNaN(index)) {
        existingIndices.add(index);
        existingMap.set(index, el);
      }
    });

    // 计算需要渲染的索引集合
    const newIndices = new Set();
    for (let i = startIndex; i < endIndex; i++) {
      newIndices.add(i);
    }

    // 找出需要删除的元素
    const toRemove = [];
    existingIndices.forEach(index => {
      if (!newIndices.has(index)) {
        toRemove.push(index);
      }
    });

    // 找出需要添加的元素
    const toAdd = [];
    newIndices.forEach(index => {
      if (!existingIndices.has(index)) {
        toAdd.push(index);
      }
    });

    // 如果变化很大（超过50%），直接全量更新
    const changeRatio = (toRemove.length + toAdd.length) / Math.max(existingIndices.size, newIndices.size, 1);
    if (changeRatio > 0.5 || existingElements.length === 0) {
      // 全量更新
      const fragment = document.createDocumentFragment();
      const itemsToRender = [];

      for (let i = startIndex; i < endIndex; i++) {
        const item = this.items[i];
        if (item === undefined) continue;

        const itemElement = this.createItemElement(item, i);
        itemsToRender.push({ element: itemElement, index: i });
        fragment.appendChild(itemElement);
      }

      this.contentContainer.innerHTML = '';
      this.contentContainer.appendChild(fragment);
      this.measureHeights(itemsToRender);
    } else {
      // 增量更新
      // 删除不需要的元素
      toRemove.forEach(index => {
        const el = existingMap.get(index);
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
      });

      // 添加新元素
      const itemsToMeasure = [];
      toAdd.forEach(index => {
        const item = this.items[index];
        if (item !== undefined) {
          const itemElement = this.createItemElement(item, index);
          itemsToMeasure.push({ element: itemElement, index });
          
          // 找到正确的插入位置
          let inserted = false;
          const children = Array.from(this.contentContainer.children);
          for (let i = 0; i < children.length; i++) {
            const childIndex = parseInt(children[i].getAttribute('data-index'));
            if (childIndex > index) {
              this.contentContainer.insertBefore(itemElement, children[i]);
              inserted = true;
              break;
            }
          }
          if (!inserted) {
            this.contentContainer.appendChild(itemElement);
          }
        }
      });

      this.measureHeights(itemsToMeasure);
    }
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
   * 测量元素高度
   */
  measureHeights(itemsToRender) {
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

      // 如果高度发生变化，重新计算占位符
      if (heightChanged) {
        const totalHeight = this.calculatePositions();
        const topSpacerHeight = this.itemPositions.get(this.visibleStart) || 0;
        const bottomPosition = this.itemPositions.get(this.visibleEnd) || totalHeight;
        const bottomSpacerHeight = Math.max(0, totalHeight - bottomPosition);
        
        this.topSpacer.style.height = `${topSpacerHeight}px`;
        this.bottomSpacer.style.height = `${bottomSpacerHeight}px`;
      }
    });
  }


  /**
   * 重新计算占位符高度（不触发重新渲染）
   */
  recalculateSpacers() {
    const wasUpdating = this.isUpdating;
    this.isUpdating = true;
    
    const totalHeight = this.calculatePositions();
    const topSpacerHeight = this.itemPositions.get(this.visibleStart) || 0;
    const bottomPosition = this.itemPositions.get(this.visibleEnd) || totalHeight;
    const bottomSpacerHeight = Math.max(0, totalHeight - bottomPosition);
    
    this.topSpacer.style.height = `${topSpacerHeight}px`;
    this.bottomSpacer.style.height = `${bottomSpacerHeight}px`;
    
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
    this.beginUpdate();
    this.items = items || [];
    this.itemHeights.clear();
    this.itemPositions.clear();
    this.scrollTop = this.container.scrollTop;
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
      // 清除该项的高度缓存，因为内容可能变化
      this.itemHeights.delete(index);
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
    
    // 重新计算插入位置之后的所有索引的高度缓存
    const newHeights = new Map();
    
    for (let [idx, height] of this.itemHeights.entries()) {
      if (idx >= insertIndex) {
        newHeights.set(idx + 1, height);
      } else {
        newHeights.set(idx, height);
      }
    }
    
    this.itemHeights = newHeights;
    this.itemPositions.clear();
    
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
    this.itemHeights.clear();
    this.itemPositions.clear();
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
    if (this.pendingUpdate || true) {
      this.updateVisibleItems();
      this.pendingUpdate = false;
    }
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
      
      if (!this.batchUpdateMode) {
        this.updateVisibleItems();
      } else {
        this.pendingUpdate = true;
      }
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
    // 第一步：先滚动到接近底部的位置（基于预估高度）
    const totalHeight = this.calculatePositions();
    this.container.scrollTop = totalHeight;
    
    // 第二步：等待渲染和高度测量完成后，再精确滚动
    // 使用多个 RAF 确保高度测量完成
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 重新计算位置（此时底部元素已被测量）
        const newTotalHeight = this.calculatePositions();
        this.container.scrollTop = newTotalHeight;
        
        // 第三步：最后使用 scrollHeight 确保到达真正的底部
        requestAnimationFrame(() => {
          this.container.scrollTop = this.container.scrollHeight;
        });
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
      // 第一步：基于当前高度缓存计算位置并滚动
      this.calculatePositions();
      const position = this.itemPositions.get(index) || 0;
      this.container.scrollTop = position;
      
      // 第二步：等待渲染和测量完成后，强制重新更新
      setTimeout(() => {
        // 暂时重置 isUpdating，确保可以触发更新
        this.isUpdating = false;
        
        // 重新计算位置（此时目标元素应该已被测量）
        this.calculatePositions();
        const updatedPosition = this.itemPositions.get(index) || 0;
        
        // 直接设置滚动位置
        this.container.scrollTop = updatedPosition;
        
        // 再次等待一帧，进行最终校准
        setTimeout(() => {
          this.isUpdating = false;
          this.calculatePositions();
          const finalPosition = this.itemPositions.get(index) || 0;
          
          // 如果位置有变化，再次调整
          if (Math.abs(this.container.scrollTop - finalPosition) > 2) {
            this.container.scrollTop = finalPosition;
          }
        }, 100);
      }, 100);
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
