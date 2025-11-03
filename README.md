# FastScrollView

⚡ 一个高性能的虚拟滚动库，专为处理海量数据设计，支持动态高度的行元素。

## ✨ 特性

- 🚀 **超高性能** - 轻松处理 10万+ 条数据，滚动依然流畅
- 📏 **动态高度支持** - 自动测量和缓存每个元素的实际高度
- ⚡ **按需渲染策略** - 不预先计算高度，从可视区域开始逐个渲染
- 💾 **智能缓存** - 已渲染的元素自动缓存，避免重复渲染
- 🎯 **原生 JavaScript** - 零依赖，体积小巧
- 💪 **虚拟滚动** - 只渲染可视区域的元素，大幅减少 DOM 节点
- 🔧 **丰富的 API** - 提供完整的数据操作和滚动控制方法
- 📱 **移动端友好** - 完美支持触摸滚动
- 🎨 **易于集成** - 简单的 API 设计，快速上手

## 🎯 优化策略

FastScrollView 采用了创新的**按需渲染策略**，与传统虚拟滚动方案相比有显著优势：

### 传统方案的问题
- ❌ 需要预先计算所有元素的位置
- ❌ 初始化时需要遍历所有数据
- ❌ 跳转时需要复杂的位置计算
- ❌ 对动态高度支持不够友好

### FastScrollView 的解决方案
- ✅ **无需预先计算** - 不需要提前遍历所有元素
- ✅ **按需渲染** - 从当前滚动位置开始，逐个渲染直到填满屏幕
- ✅ **智能缓存** - 已渲染元素自动缓存，包含元素和高度信息
- ✅ **简化跳转** - 直接从目标item开始渲染，无需复杂计算
- ✅ **更快初始化** - 只渲染首屏内容，启动速度快
- ✅ **天然支持动态高度** - 每个元素高度在渲染后自动测量和缓存

## 📦 安装

### NPM

```bash
npm install fast-scrollview
```

### CDN

```html
<script src="https://unpkg.com/fast-scrollview/dist/fast-scrollview.min.js"></script>
```

### 本地构建

```bash
# 克隆仓库
git clone <repository-url>
cd fast-scrollview

# 安装依赖
npm install

# 构建
npm run build
```

## 🚀 快速开始

### HTML 结构

```html
<div id="scroll-container" style="height: 600px;"></div>
```

### JavaScript 使用

```javascript
// 1. 准备数据（可以是任意大小的数组）
const items = [];
for (let i = 0; i < 100000; i++) {
  items.push({
    id: i,
    title: `数据项 ${i}`,
    content: `这是第 ${i} 条数据`
  });
}

// 2. 定义渲染函数
function renderItem(item, index, totalSize) {
  const div = document.createElement('div');
  div.className = 'list-item';
  div.innerHTML = `
    <strong>#${index}</strong>
    <span>${item.title}</span>
    <p>${item.content}</p>
  `;
  return div;
}

// 3. 创建 FastScrollView 实例
const fsv = new FastScrollView(
  '#scroll-container',  // 容器元素或选择器
  items,                // 数据数组
  renderItem,           // 渲染函数
  {
    estimatedItemHeight: 50,  // 预估行高（可选）
    bufferSize: 5,            // 缓冲区大小（可选）
    onScroll: (info) => {     // 滚动回调（可选）
      console.log('滚动中...', info);
    }
  }
);
```

## 📚 API 文档

### 构造函数

```javascript
new FastScrollView(container, items, render, options)
```

#### 参数

- **container** (HTMLElement | string) - 容器元素或 CSS 选择器
- **items** (Array) - 要渲染的数据数组
- **render** (Function) - 渲染函数，签名：`(item, index, totalSize) => HTMLElement | string`
- **options** (Object, 可选) - 配置选项
  - `estimatedItemHeight` (number) - 预估行高，默认 50
  - `bufferSize` (number) - 上下缓冲区大小，默认 5
  - `onScroll` (Function) - 滚动时的回调函数

### 数据操作方法

#### setItems(items)

设置新的数据数组，会清除所有高度缓存。

```javascript
fsv.setItems(newItemsArray);
```

#### setItem(index, item)

更新指定索引的数据项。

```javascript
fsv.setItem(10, { id: 10, title: '更新后的标题' });
```

#### insertItem(index, item)

在指定位置插入数据项。

```javascript
fsv.insertItem(5, { id: 999, title: '插入的数据' });
```

#### append(item)

在数组末尾添加数据项。

```javascript
fsv.append({ id: 1001, title: '新数据' });
```

#### prepend(item)

在数组开头添加数据项。

```javascript
fsv.prepend({ id: 1002, title: '最新数据' });
```

#### remove(itemOrIndex)

删除数据项，可以传入数据项本身或索引。

```javascript
// 通过索引删除
fsv.remove(5);

// 通过数据项删除
fsv.remove(item);
```

### 滚动控制方法

#### scrollToTop()

滚动到顶部（第一个元素）。

```javascript
fsv.scrollToTop();
```

#### scrollToBottom()

滚动到底部（最后一个元素）。

```javascript
fsv.scrollToBottom();
```

#### scrollToItem(itemOrIndex)

滚动到指定的数据项，可以传入数据项本身或索引。

```javascript
// 通过索引滚动
fsv.scrollToItem(1000);

// 通过数据项滚动
fsv.scrollToItem(item);
```

### 获取信息方法

#### getScrollTop()

获取当前滚动位置。

```javascript
const scrollTop = fsv.getScrollTop();
```

#### getVisibleRange()

获取当前可视区域的信息。

```javascript
const range = fsv.getVisibleRange();
// 返回: { start: 10, end: 30, count: 20 }
```

#### getItemCount()

获取数据项总数。

```javascript
const count = fsv.getItemCount();
```

#### getTotalHeight()

获取虚拟滚动的总高度。

```javascript
const height = fsv.getTotalHeight();
```

### 其他方法

#### refresh()

刷新显示，重新测量所有元素的高度。

```javascript
fsv.refresh();
```

#### destroy()

销毁实例，清理事件监听器和数据。

```javascript
fsv.destroy();
```

## 🎨 示例

项目包含多个完整的示例，演示不同的使用场景：

### 1. 基础示例 (examples/basic.html)

展示 10万条数据的基本用法，包括所有 API 方法的演示。

- ✅ 10万条数据流畅滚动
- ✅ 完整的操作按钮演示
- ✅ 实时性能监控

### 2. 动态高度示例 (examples/dynamic-height.html)

展示不同高度的卡片元素，验证动态高度测量功能。

- ✅ 2万条不同高度的卡片
- ✅ 自动高度测量和缓存
- ✅ 准确的滚动定位

### 3. 聊天应用示例 (examples/chat-app.html)

模拟真实的聊天应用场景。

- ✅ 5万条聊天消息
- ✅ 实时发送消息
- ✅ 完整的用户交互

### 查看示例

```bash
# 构建项目
npm run build

# 使用浏览器打开
open examples/index.html
```

或者使用本地服务器：

```bash
npx http-server -p 8080
# 然后访问 http://localhost:8080/examples/
```

## 🎯 使用场景

FastScrollView 适用于以下场景：

- 📋 **长列表** - 电商商品列表、搜索结果等
- 💬 **聊天应用** - 历史消息记录、群聊记录
- 📊 **数据表格** - 大量数据的表格展示
- 📱 **社交媒体** - 时间线、动态列表
- 📁 **文件管理器** - 大量文件/文件夹列表
- 📝 **日志查看器** - 系统日志、应用日志

## ⚙️ 工作原理

FastScrollView 使用**虚拟滚动**技术来优化性能：

1. **仅渲染可见元素** - 只在 DOM 中保留可视区域内的元素
2. **动态高度测量** - 自动测量每个元素的实际高度并缓存
3. **位置计算** - 使用二分查找快速定位可视区域的起始位置
4. **占位元素** - 使用上下占位元素维持正确的滚动条大小
5. **缓冲区** - 在可视区域上下额外渲染几个元素，提升滚动体验

### 性能对比

| 数据量 | 传统渲染 DOM 节点 | FastScrollView DOM 节点 | 性能提升 |
|--------|------------------|------------------------|---------|
| 1,000 | 1,000 | ~20 | 50x |
| 10,000 | 10,000 | ~20 | 500x |
| 100,000 | 100,000 | ~20 | 5000x |

## 🔧 高级配置

### 自定义预估高度

对于高度差异较大的列表，设置合适的预估高度可以提升初始渲染的准确性：

```javascript
const fsv = new FastScrollView(container, items, render, {
  estimatedItemHeight: 100  // 根据实际情况调整
});
```

### 调整缓冲区大小

增加缓冲区可以让快速滚动时更流畅，但会增加渲染的元素数量：

```javascript
const fsv = new FastScrollView(container, items, render, {
  bufferSize: 10  // 上下各额外渲染 10 个元素
});
```

### 滚动事件监听

```javascript
const fsv = new FastScrollView(container, items, render, {
  onScroll: (info) => {
    console.log('可视范围:', info.visibleStart, '-', info.visibleEnd);
    console.log('滚动位置:', info.scrollTop);
    
    // 无限滚动加载
    if (info.visibleEnd >= items.length - 10) {
      loadMoreData();
    }
  }
});
```

## 🐛 常见问题

### 1. 滚动位置不准确？

这通常是因为元素高度变化但没有重新测量。调用 `refresh()` 方法：

```javascript
fsv.refresh();
```

### 2. 初始滚动位置跳动？

增加预估高度的准确性，使其更接近实际平均高度：

```javascript
const fsv = new FastScrollView(container, items, render, {
  estimatedItemHeight: 80  // 调整为实际平均高度
});
```

### 3. 动态内容更新后显示异常？

更新数据后，如果高度可能变化，需要清除对应的高度缓存：

```javascript
fsv.setItem(index, newItem);  // setItem 会自动清除该项的高度缓存
```

## 📄 浏览器支持

- ✅ Chrome (最新版)
- ✅ Firefox (最新版)
- ✅ Safari (最新版)
- ✅ Edge (最新版)
- ✅ iOS Safari
- ✅ Android Chrome

## 📜 开源协议

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📮 反馈

如有问题或建议，请提交 Issue 或联系作者。

---

**Happy Coding! 🎉**
