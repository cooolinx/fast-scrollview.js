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
   * @param {number} options.batchSize - 每批渲染的元素数量（默认20）
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

    // 批处理大小
    this.batchSize = options.batchSize || 10;

    // 数据
    this.items = items ? [...items] : [];
    this.render = render;

    // 已渲染的范围（不再缓存高度，直接从 DOM 读取）
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;

    // DOM 元素
    this.contentContainer = null;
    this.topSpacer = null;  // 用于 bottom-align 时将内容推到底部
    this.topLoader = null;
    this.bottomLoader = null;

    // 内部状态标志
    this.isUpdating = false;
    this.isLoadingMore = false;
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

    // 创建顶部占位符（用于 bottom-align）
    this.topSpacer = document.createElement('div');
    this.topSpacer.style.height = '0px';

    // 创建顶部加载指示器
    this.topLoader = this._createLoader();
    this.topLoader.style.display = 'none';

    // 创建内容容器
    this.contentContainer = document.createElement('div');

    // 创建底部加载指示器
    this.bottomLoader = this._createLoader();
    this.bottomLoader.style.display = 'none';

    // 组装 DOM（直接添加到 container）
    this.container.appendChild(this.topSpacer);
    this.container.appendChild(this.topLoader);
    this.container.appendChild(this.contentContainer);
    this.container.appendChild(this.bottomLoader);

    // 绑定滚动事件
    this.boundHandleScroll = this.handleScroll.bind(this);
    this.container.addEventListener('scroll', this.boundHandleScroll);

    // 首次渲染
    this._updateVisibleItems();
  }

  /**
   * 创建加载指示器
   */
  _createLoader() {
    const loader = document.createElement('div');
    loader.style.cssText = `
      display: none;
      justify-content: center;
      align-items: center;
      padding: 20px;
      font-size: 14px;
      color: #666;
    `;

    const spinner = document.createElement('div');
    spinner.style.cssText = `
      width: 20px;
      height: 20px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #3498db;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    `;

    // 添加旋转动画
    if (!document.getElementById('fast-scrollview-spinner-keyframes')) {
      const style = document.createElement('style');
      style.id = 'fast-scrollview-spinner-keyframes';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    loader.appendChild(spinner);
    return loader;
  }


  /**
   * 处理滚动事件
   */
  handleScroll() {
    if (this.isUpdating || this.isLoadingMore) return;
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = null;

      // 是否有滚动
      const newScrollTop = this.container.scrollTop;
      if (Math.abs(newScrollTop - this.lastScrollTop) < 1) return;
      this.lastScrollTop = newScrollTop;

      // 检查是否滚动到边界
      this._checkScrollBoundary();

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
   * 检查是否滚动到边界，如果是则显示 loading 并加载更多内容
   */
  async _checkScrollBoundary() {
    if (this.items.length === 0 || this.renderedStartIndex === -1) return;

    const containerHeight = this.container.clientHeight;
    const scrollTop = this.container.scrollTop;
    const scrollHeight = this.container.scrollHeight;
    const scrollBottom = scrollTop + containerHeight;

    const threshold = 100; // 触发阈值（像素）

    // 检查是否滚动到底部边界（考虑 bottomLoader 的高度）
    if (scrollBottom >= scrollHeight - threshold && this.renderedEndIndex < this.items.length) {
      await this._loadMoreDown();
      return;
    }

    // 检查是否滚动到顶部边界（考虑 topLoader 的高度）
    if (scrollTop <= threshold && this.renderedStartIndex > 0) {
      await this._loadMoreUp();
      return;
    }
  }

  /**
   * 向下加载更多内容
   */
  async _loadMoreDown() {
    if (this.isLoadingMore || this.renderedEndIndex >= this.items.length) return;

    this.isLoadingMore = true;
    this.bottomLoader.style.display = 'flex';

    // 使用 Promise 来等待渲染完成
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        const containerHeight = this.container.clientHeight;
        const targetHeight = containerHeight * this.options.bufferThreshold;
        this._expandDown(targetHeight);

        requestAnimationFrame(() => {
          this.bottomLoader.style.display = 'none';
          this.isLoadingMore = false;
          resolve();
        });
      });
    });
  }

  /**
   * 向上加载更多内容
   */
  async _loadMoreUp() {
    if (this.isLoadingMore || this.renderedStartIndex <= 0) return;

    this.isLoadingMore = true;
    this.topLoader.style.display = 'flex';

    // 保存当前滚动位置
    const oldScrollHeight = this.container.scrollHeight;
    const oldScrollTop = this.container.scrollTop;

    // 使用 Promise 来等待渲染完成
    await new Promise(resolve => {
      requestAnimationFrame(() => {
        const containerHeight = this.container.clientHeight;
        const targetHeight = containerHeight * this.options.bufferThreshold;
        this._expandUp(targetHeight);

        requestAnimationFrame(() => {
          // 恢复滚动位置（补偿新增内容的高度）
          const newScrollHeight = this.container.scrollHeight;
          const heightDiff = newScrollHeight - oldScrollHeight;
          this.container.scrollTop = oldScrollTop + heightDiff;

          // 如果所有内容都加载完了，调整底部对齐
          this._adjustBottomAlign();

          this.topLoader.style.display = 'none';
          this.isLoadingMore = false;
          resolve();
        });
      });
    });
  }

  /**
   * 向下扩展渲染（从当前 renderedEndIndex 开始向下渲染直到达到目标高度）
   * @param {number} targetHeight - 目标高度
   * @returns {number} 累计渲染的高度
   */
  _expandDown(targetHeight) {
    const batchSize = this.batchSize;
    let accumulatedHeight = 0;

    while (this.renderedEndIndex < this.items.length && accumulatedHeight < targetHeight) {
      const batchEnd = Math.min(this.renderedEndIndex + batchSize, this.items.length);
      const fragment = this._renderItems(this.renderedEndIndex, batchEnd);
      this.contentContainer.appendChild(fragment);
      accumulatedHeight += this._measureHeight(this.renderedEndIndex, batchEnd);
      this.renderedEndIndex = batchEnd;
    }

    return accumulatedHeight;
  }

  /**
   * 向上扩展渲染（从当前 renderedStartIndex 开始向上渲染直到达到目标高度）
   * @param {number} targetHeight - 目标高度
   * @returns {number} 累计渲染的高度
   */
  _expandUp(targetHeight) {
    const batchSize = this.batchSize;
    let accumulatedHeight = 0;

    while (this.renderedStartIndex > 0 && accumulatedHeight < targetHeight) {
      const batchStart = Math.max(0, this.renderedStartIndex - batchSize);
      const fragment = this._renderItems(batchStart, this.renderedStartIndex);
      const firstChild = this.contentContainer.firstChild;
      if (firstChild) {
        this.contentContainer.insertBefore(fragment, firstChild);
      } else {
        this.contentContainer.appendChild(fragment);
      }
      accumulatedHeight += this._measureHeight(batchStart, this.renderedStartIndex);
      this.renderedStartIndex = batchStart;
    }

    return accumulatedHeight;
  }

  _measureHeight(startIndex, endIndex) {
    let accumulatedHeight = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const element = this.contentContainer.querySelector(`[data-index="${i}"]`);
      if (element) {
        accumulatedHeight += element.offsetHeight;
      }
    }
    return accumulatedHeight;
  }

  /**
   * 更新可视区域内的元素
   * 支持跳跃式渲染：可以从任意位置开始渲染
   */
  _updateVisibleItems() {
    if (this.items.length === 0) {
      this.contentContainer.innerHTML = '';
      this.topSpacer.style.height = '0px';
      this.topLoader.style.display = 'none';
      this.bottomLoader.style.display = 'none';
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

    this.isUpdating = false;
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

    // 使用通用的向下扩展方法
    const targetHeight = containerHeight + expandThreshold;
    this._expandDown(targetHeight);
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

    // 从最后一项开始，使用通用的向上扩展方法
    this.renderedStartIndex = this.items.length;
    this.renderedEndIndex = this.items.length;
    this._expandUp(targetHeight);

    // 调整底部对齐
    this._adjustBottomAlign();

    // 立即滚动到底部（在 DOM 更新的同一帧）
    this.container.scrollTop = this.container.scrollHeight;

    // 确保滚动位置正确
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }

  /**
   * 调整底部对齐：当内容不足一屏时，使用 topSpacer 将内容推到底部
   */
  _adjustBottomAlign() {
    if (this.options.align !== 'bottom') {
      this.topSpacer.style.height = '0px';
      return;
    }

    // 检查是否所有内容都已渲染
    const allRendered = this.renderedStartIndex === 0 && this.renderedEndIndex === this.items.length;

    if (!allRendered || this.items.length === 0) {
      this.topSpacer.style.height = '0px';
      return;
    }

    // 测量内容高度（需要在下一帧测量以确保 DOM 已更新）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const containerHeight = this.container.clientHeight;
        const contentHeight = this.contentContainer.offsetHeight;

        if (contentHeight < containerHeight) {
          // 内容不足一屏，使用 topSpacer 推到底部
          const paddingHeight = containerHeight - contentHeight;
          this.topSpacer.style.height = `${paddingHeight}px`;
        } else {
          // 内容足够，不需要占位
          this.topSpacer.style.height = '0px';
        }
      });
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
    const batchSize = this.batchSize; // 每批渲染的元素数量

    for (let i = 0; i < this.items.length; i += batchSize) {
      // 计算这一批的结束索引
      const batchEnd = Math.min(i + batchSize, this.items.length);

      // 渲染这一批
      for (let j = i; j < batchEnd; j++) {
        const item = this.items[j];
        if (item !== undefined) {
          const element = this._createItemElement(item, j);
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
   * 渲染指定范围内的元素
   * @param {number} startIndex
   * @param {number} endIndex
   * @returns {DocumentFragment} 渲染后的文档片段
   */
  _renderItems(startIndex, endIndex) {
    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
      const item = this.items[i];
      if (!item) continue;
      const itemElement = this._createItemElement(item, i);
      fragment.appendChild(itemElement);
    }
    return fragment;
  }

  /**
   * 创建单个元素
   */
  _createItemElement(item, index) {
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
   * 开始批量更新（暂停渲染）
   */
  _beginUpdate() {
    this.batchUpdateMode = true;
  }

  /**
   * 结束批量更新（恢复渲染）
   */
  _endUpdate() {
    this.batchUpdateMode = false;
    this._updateVisibleItems();
    this._adjustBottomAlign();
  }


  /**
   * 更新已渲染元素的 data-index 属性
   * 在删除或插入操作后调用，确保 DOM 元素的索引与数据索引一致
   */
  _updateRenderedIndices() {
    if (this.renderedStartIndex === -1) return;

    const elements = this.contentContainer.querySelectorAll('[data-index]');
    let currentIndex = this.renderedStartIndex;

    elements.forEach(element => {
      element.setAttribute('data-index', currentIndex);
      currentIndex++;
    });
  }

  /**
   * 设置新的数据数组
   * @param {Array} items - 新的数据数组
   */
  setItems(items) {
    this._beginUpdate();
    this.items = items ? [...items] : [];
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    this._endUpdate();
  }

  /**
   * 更新指定索引的数据
   * @param {number} index - 索引
   * @param {*} item - 新的数据项
   */
  setItem(index, item) {
    if (index < 0 || index >= this.items.length) return;
    this.items[index] = item;

    // 如果这个item已经被渲染，直接替换元素
    if (index >= this.renderedStartIndex && index < this.renderedEndIndex) {
      const existingElement = this.contentContainer.querySelector(`[data-index="${index}"]`);
      if (existingElement) {
        const newElement = this._createItemElement(item, index);
        existingElement.replaceWith(newElement);
        return;
      }
    }

    // 如果不在已渲染范围内，调用 updateVisibleItems
    if (!this.batchUpdateMode) {
      this._updateVisibleItems();
    }
  }

  /**
   * 在指定位置插入数据
   * @param {number} index - 插入位置
   * @param {*} item - 要插入的数据项
   */
  insert(index, item) {
    if (!item) return;
    const insertIndex = Math.max(0, Math.min(index, this.items.length));
    this.items.splice(insertIndex, 0, item);

    // 插入操作比较复杂，重新渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';

    if (!this.batchUpdateMode) {
      this._updateVisibleItems();
    }
  }

  /**
   * 批量添加数据（高性能）
   * @param {Array} items - 要添加的数据项数组
   */
  append(items) {
    if (!items) return;
    if (!Array.isArray(items)) return this.append([items]);
    if (items.length === 0) return;

    this._beginUpdate();
    this.items.push(...items);
    this._endUpdate();
  }

  /**
   * 批量在开头添加数据（高性能）
   * @param {Array} items - 要添加的数据项数组
   */
  prepend(items) {
    if (!items) return;
    if (!Array.isArray(items)) return this.prepend([items]);
    if (items.length === 0) return;

    this._beginUpdate();
    // 反向插入以保持顺序
    for (let i = items.length - 1; i >= 0; i--) {
      this.items.unshift(items[i]);
    }

    // prepend 操作复杂，重新渲染
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';

    this._endUpdate();
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

    if (index < 0 || index >= this.items.length) return;

    // 判断是否在已渲染范围内
    const isInRenderedRange = this.renderedStartIndex !== -1 &&
                              index >= this.renderedStartIndex &&
                              index < this.renderedEndIndex;

    // 删除数据
    this.items.splice(index, 1);

    // 情况1：不在可视范围内，只需调整索引
    if (!isInRenderedRange) {
      // 如果删除的位置在已渲染范围之前，需要调整索引
      if (this.renderedStartIndex !== -1 && index < this.renderedStartIndex) {
        this.renderedStartIndex--;
        this.renderedEndIndex--;

        // 更新所有已渲染元素的 data-index
        this._updateRenderedIndices();
      } else if (this.renderedStartIndex !== -1 && index < this.renderedEndIndex) {
        // 删除位置在已渲染范围内，但不在可视区域（理论上不应该发生，但做个保护）
        this.renderedEndIndex--;
        this._updateRenderedIndices();
      }

      return;
    }

    // 情况2：在可视范围内，移除 DOM 元素并补充
    const elementToRemove = this.contentContainer.querySelector(`[data-index="${index}"]`);
    if (elementToRemove) {
      elementToRemove.remove();
    }

    // 调整渲染范围
    this.renderedEndIndex--;

    // 更新后续元素的索引
    this._updateRenderedIndices();

    // 尝试补充元素：优先向下，其次向上
    let isSuccess = false;

    // 优先向下补充
    if (this.renderedEndIndex < this.items.length) {
      const item = this.items[this.renderedEndIndex];
      if (item !== undefined) {
        const element = this._createItemElement(item, this.renderedEndIndex);
        this.contentContainer.appendChild(element);
        this.renderedEndIndex++;
        isSuccess = true;
      }
    }

    // 如果向下没有元素，尝试向上补充
    if (!isSuccess && this.renderedStartIndex > 0) {
      this.renderedStartIndex--;
      const item = this.items[this.renderedStartIndex];
      if (item !== undefined) {
        const element = this._createItemElement(item, this.renderedStartIndex);
        this.contentContainer.insertBefore(element, this.contentContainer.firstChild);
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
  scrollToItem(itemOrIndex, alignBottom = false) {
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

        if (alignBottom) {
          // 底部对齐：将元素底部对齐到容器底部
          const elementBottom = targetElement.offsetTop + targetElement.offsetHeight;
          scrollTop = elementBottom - this.container.clientHeight;
        } else {
          // 顶部对齐：将元素顶部对齐到容器顶部
          scrollTop = targetElement.offsetTop;
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
    this.contentContainer.innerHTML = '';

    // 计算渲染范围：向上和向下都渲染 bufferThreshold 倍的屏幕高度
    const bufferHeight = containerHeight * this.options.bufferThreshold;
    const downTargetHeight = containerHeight + bufferHeight;  // 可见区域 + 下方缓冲
    const upTargetHeight = bufferHeight;  // 上方缓冲

    // 第一阶段：从目标项开始向下渲染
    this.renderedStartIndex = targetIndex;
    this.renderedEndIndex = targetIndex;
    this._expandDown(downTargetHeight);

    // 第二阶段：从目标项向上渲染
    const prependHeight = this._expandUp(upTargetHeight);

    // 滚动到目标位置
    requestAnimationFrame(() => {
      const targetScrollTop = alignBottom ? this.container.scrollHeight : prependHeight;
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
   * 刷新当前已渲染的元素（保持渲染范围，重新调用 render 方法）
   * 适用场景：数据内容变化但不改变滚动位置和渲染范围
   */
  refresh() {
    // 如果没有已渲染的内容，直接返回
    if (this.renderedStartIndex === -1 || this.renderedEndIndex === -1) {
      return;
    }

    // 保存当前滚动位置
    const scrollTop = this.container.scrollTop;

    // 重新渲染当前范围内的所有元素
    for (let i = this.renderedStartIndex; i < this.renderedEndIndex; i++) {
      const existingElement = this.contentContainer.querySelector(`[data-index="${i}"]`);
      if (existingElement && this.items[i] !== undefined) {
        const newElement = this._createItemElement(this.items[i], i);
        existingElement.replaceWith(newElement);
      }
    }

    // 恢复滚动位置
    requestAnimationFrame(() => {
      this.container.scrollTop = scrollTop;
    });
  }

  /**
   * 重置显示（清空所有已渲染内容，从当前位置重新渲染）
   * 适用场景：需要完全重新渲染整个视图
   */
  reset() {
    this.renderedStartIndex = -1;
    this.renderedEndIndex = -1;
    this.contentContainer.innerHTML = '';
    this._updateVisibleItems();
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
