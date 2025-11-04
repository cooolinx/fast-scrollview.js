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
   * @param {number} options.bufferThreshold - 缓冲阈值（默认2，表示提前2个屏幕高度触发渲染）
   * @param {Function} options.onScroll - 滚动回调
   * @param {string} options.align - 对齐方式 'top'(默认) 或 'bottom'
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
      // bufferThreshold 和 bufferSize 都支持（向后兼容）
      bufferThreshold: options.bufferThreshold || options.bufferSize || 2,
      onScroll: options.onScroll || null,
      align: options.align || 'top', // 'top' 或 'bottom'
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
    this.scrollRaf = null;
    this.lastScrollTop = 0;
    this.batchUpdateMode = false;

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
      // 如果设置为底部对齐，从底部开始渲染
      if (this.options.align === 'bottom') {
        this.renderFromBottom();
      } else {
        this.renderFromPosition(scrollTop);
      }
      this.isUpdating = false;
      return;
    }

    // 计算已渲染区域的位置（直接从 DOM 读取，不使用估算）
    const renderedTop = this.topSpacer.offsetHeight;
    const renderedBottom = renderedTop + this.contentContainer.offsetHeight;
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
            currentHeight += element.offsetHeight;
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
            currentHeight -= element.offsetHeight;
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
          accumulatedHeight += element.offsetHeight;
        }
      }
      
      this.renderedEndIndex = batchEnd;
    }
    
    this.updateSpacers();
  }

  /**
   * 从底部开始渲染（用于 align: 'bottom'）
   * 策略：从最后一项开始向前渲染，填满屏幕，然后滚动到底部
   */
  renderFromBottom() {
    if (this.items.length === 0) {
      return;
    }

    const containerHeight = this.container.clientHeight;
    const expandThreshold = containerHeight * this.options.bufferThreshold;
    const targetHeight = containerHeight + expandThreshold;
    
    // 清空内容
    this.contentContainer.innerHTML = '';
    
    // 从最后一项开始，向前渲染直到填满屏幕
    const batchSize = 20;
    let accumulatedHeight = 0;
    let endIndex = this.items.length;
    let startIndex = this.items.length;
    
    while (startIndex > 0 && accumulatedHeight < targetHeight) {
      const batchStart = Math.max(0, startIndex - batchSize);
      
      // 渲染这一批（倒序插入到前面）
      for (let i = startIndex - 1; i >= batchStart; i--) {
        const item = this.items[i];
        if (item !== undefined) {
          const element = this.createItemElement(item, i);
          this.contentContainer.insertBefore(element, this.contentContainer.firstChild);
        }
      }
      
      // 测量这一批的实际高度
      for (let i = batchStart; i < startIndex; i++) {
        const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
        if (element) {
          accumulatedHeight += element.offsetHeight;
        }
      }
      
      startIndex = batchStart;
    }
    
    // 更新渲染范围
    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = endIndex;
    
    // 更新占位符（会自动处理底部对齐）
    this.updateSpacers();
    
    // 立即滚动到底部（在 DOM 更新的同一帧）
    this.container.scrollTop = this.container.scrollHeight;
    
    // 确保滚动位置正确
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }

  /**
   * 查找起始索引
   * 采用渐进式渲染：批量渲染并测量真实高度，直到找到目标位置
   */
  findStartIndexByRendering(scrollTop) {
    // 清空当前渲染，准备重新渲染
    this.contentContainer.innerHTML = '';
    
    let currentTop = 0;
    const batchSize = 20; // 每次渲染 20 个元素
    
    for (let i = 0; i < this.items.length; i += batchSize) {
      // 计算这一批的结束索引
      const batchEnd = Math.min(i + batchSize, this.items.length);
      
      // 渲染这一批
      for (let j = i; j < batchEnd; j++) {
        const item = this.items[j];
        if (item !== undefined) {
          const element = this.createItemElement(item, j);
          this.contentContainer.appendChild(element);
        }
      }
      
      // 测量这一批中每个元素的高度，找到目标位置
      for (let j = i; j < batchEnd; j++) {
        const element = this.contentContainer.querySelector(`[data-index="${j}"]`);
        if (element) {
          const height = element.offsetHeight;
          
          if (currentTop + height > scrollTop) {
            // 找到了目标位置，保留已渲染的内容
            return j;
          }
          
          currentTop += height;
        }
      }
      
      // 如果当前累计高度已经超过目标位置，返回当前批次的起始位置
      if (currentTop > scrollTop) {
        return i;
      }
    }
    
    return Math.max(0, this.items.length - 1);
  }

  /**
   * 更新占位符高度
   * 使用固定大小的 spacer，足够触发滚动事件即可
   * 当 align 为 'bottom' 且内容高度不足时，使用 topSpacer 将内容推到底部
   */
  updateSpacers() {
    const containerHeight = this.container.clientHeight || 800;
    const fixedSpacerHeight = containerHeight * 2;
    
    // 检查是否启用底部对齐模式
    const isBottomAlign = this.options.align === 'bottom';
    
    // 检查是否所有内容都已渲染
    const allRendered = this.renderedStartIndex === 0 && this.renderedEndIndex === this.items.length;
    
    if (isBottomAlign && allRendered && this.items.length > 0) {
      // 底部对齐模式：如果内容高度不足，用 topSpacer 推到底部
      const contentHeight = this.contentContainer.offsetHeight;
      
      if (contentHeight < containerHeight) {
        // 内容不足一屏，使用 topSpacer 推到底部
        const paddingHeight = containerHeight - contentHeight;
        this.topSpacer.style.height = `${paddingHeight}px`;
        this.bottomSpacer.style.height = '0px';
      } else {
        // 内容足够，正常显示
        this.topSpacer.style.height = '0px';
        this.bottomSpacer.style.height = '0px';
      }
    } else {
      // 默认模式或有未渲染内容：使用固定 spacer
      this.topSpacer.style.height = this.renderedStartIndex > 0 ? `${fixedSpacerHeight}px` : '0px';
      this.bottomSpacer.style.height = this.renderedEndIndex < this.items.length ? `${fixedSpacerHeight}px` : '0px';
    }
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
  }

  /**
   * 结束批量更新（恢复渲染）
   */
  endUpdate() {
    this.batchUpdateMode = false;
    this.updateVisibleItems();
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
   * 从最后一项开始向前渲染，填满屏幕后滚动到真正的底部
   */
  scrollToBottom() {
    this.scrollToItem(this.items.length - 1, true);
  }

  /**
   * 滚动到指定项
   * @param {*|number} itemOrIndex - 数据项或索引
   */
  scrollToItem(itemOrIndex, isBottom = false) {
    let targetIndex;
    
    if (typeof itemOrIndex === 'number') {
      targetIndex = itemOrIndex;
    } else {
      targetIndex = this.items.indexOf(itemOrIndex);
    }

    if (targetIndex < 0 || targetIndex >= this.items.length) {
      return;
    }

    // 优化：如果目标 item 已经渲染，直接滚动到该位置，不重新渲染
    if (this.renderedStartIndex !== -1 && 
        targetIndex >= this.renderedStartIndex && 
        targetIndex < this.renderedEndIndex) {
      
      const targetElement = this.contentContainer.querySelector(`[data-index="${targetIndex}"]`);
      
      if (targetElement) {
        // 计算目标元素的位置
        let scrollTop;
        
        if (isBottom) {
          // 底部对齐：将元素底部对齐到容器底部
          const elementBottom = targetElement.offsetTop + targetElement.offsetHeight;
          scrollTop = elementBottom - this.container.clientHeight;
        } else {
          // 顶部对齐：将元素顶部对齐到容器顶部
          scrollTop = this.topSpacer.offsetHeight + targetElement.offsetTop;
        }
        
        // 平滑滚动到目标位置
        requestAnimationFrame(() => {
          this.container.scrollTop = scrollTop;
          
          requestAnimationFrame(() => {
            this.container.scrollTop = scrollTop;
          });
        });
        
        return;
      }
    }

    const containerHeight = this.container.clientHeight;
    
    // 清空当前渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    
    const batchSize = 20;
    const targetHeight = containerHeight * (1 + this.options.bufferThreshold);
    let accumulatedHeight = 0;
    
    // 第一阶段：从目标项开始向后渲染，直到填满 targetHeight 或到达末尾
    let endIndex = targetIndex;
    
    while (endIndex < this.items.length && accumulatedHeight < targetHeight) {
      const batchEnd = Math.min(endIndex + batchSize, this.items.length);
      
      // 渲染这一批（追加到末尾）
      for (let i = endIndex; i < batchEnd; i++) {
        const item = this.items[i];
        if (item !== undefined) {
          const element = this.createItemElement(item, i);
          this.contentContainer.appendChild(element);
        }
      }
      
      // 测量这一批的实际高度
      for (let i = endIndex; i < batchEnd; i++) {
        const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
        if (element) {
          accumulatedHeight += element.offsetHeight;
        }
      }
      
      endIndex = batchEnd;
    }
    
    // 第二阶段：如果还没填满，从目标项向前渲染
    let startIndex = targetIndex;
    let prependHeight = 0; // 向前渲染的累计高度
    
    while (startIndex > 0 && accumulatedHeight < targetHeight) {
      const batchStart = Math.max(0, startIndex - batchSize);
      
      // 渲染这一批（插入到前面）
      for (let i = startIndex - 1; i >= batchStart; i--) {
        const item = this.items[i];
        if (item !== undefined) {
          const element = this.createItemElement(item, i);
          this.contentContainer.insertBefore(element, this.contentContainer.firstChild);
        }
      }
      
      // 测量这一批的实际高度
      for (let i = batchStart; i < startIndex; i++) {
        const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
        if (element) {
          const height = element.offsetHeight;
          prependHeight += height;
          accumulatedHeight += height;
        }
      }
      
      startIndex = batchStart;
    }
    
    // 更新渲染范围
    this.renderedStartIndex = startIndex;
    this.renderedEndIndex = endIndex;
    this.updateSpacers();
    
    // 滚动到目标位置（topSpacer高度 + 目标项之前的内容高度）
    requestAnimationFrame(() => {
      const targetScrollTop = isBottom ? this.container.scrollHeight : this.topSpacer.offsetHeight + prependHeight;
      this.container.scrollTop = targetScrollTop;
      
      requestAnimationFrame(() => {
        this.container.scrollTop = targetScrollTop;
      });
    });
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
   * 判断是否滚动到底部
   * 用于聊天应用场景：判断是否需要自动滚动到底部
   * @param {number} threshold - 容差值（像素），默认为 10px
   * @returns {boolean} 是否在底部
   */
  isAtScrollBottom(threshold = 10) {
    if (this.items.length === 0) {
      return true;
    }

    const scrollTop = this.container.scrollTop;
    const clientHeight = this.container.clientHeight;
    const scrollHeight = this.container.scrollHeight;

    // 计算当前滚动位置的底部距离总高度底部的距离
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

    // 如果距离小于阈值，认为在底部
    return distanceFromBottom <= threshold;
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
