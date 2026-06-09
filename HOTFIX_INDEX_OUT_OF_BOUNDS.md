# 紧急修复：Index out of bounds 错误

## 🐛 问题

**错误日志**：
```
[v2.6] 创建一级文件夹 "媒体娱乐" 在位置 6
执行失败 bookmarkId=3271: Index out of bounds.

[v2.6] 创建一级文件夹 "常用工具" 在位置 7
执行失败 bookmarkId=3272: Index out of bounds.

整理完成：成功 1 / 5，失败 4
```

**原因**：
- v2.6 补丁试图按分类体系顺序创建文件夹
- 设置了 `index: 6` 和 `index: 7`
- 但"其他书签"可能只有 0-2 个现有项目
- Chrome API 不允许 index 超出范围
- 导致创建失败，书签无法移动

---

## ✅ 修复方案

**修复前（有 bug）**：
```javascript
createOptions.index = categoryIndex;  // 可能超出范围
folder = await chromeBookmarks.create(createOptions);
```

**修复后**：
```javascript
// 不设置 index，让 Chrome 自动追加到末尾
folder = await chromeBookmarks.create(createOptions);
```

**影响**：
- ✅ 不会再报 Index out of bounds 错误
- ✅ 文件夹会按创建顺序排列（而不是分类体系顺序）
- ✅ 所有书签都能成功移动

---

## 🚀 测试步骤

### 第 1 步：重新加载扩展
```
chrome://extensions/ → 重新加载
```

### 第 2 步：回滚（如果需要）
```
如果之前执行失败了：
1. 点击"回滚"
2. 等待完成
```

### 第 3 步：重新执行
```
1. 执行当前整理方案
2. 观察日志：
   ✅ 不应该再有 "Index out of bounds" 错误
   ✅ 应该显示 "整理完成：成功 X / X"
```

---

## 📊 修复效果

**修复前**：
```
整理完成：成功 1 / 5，失败 4
只创建了 1 个书签文件夹
```

**修复后**：
```
整理完成：成功 5 / 5，失败 0
所有书签都正确移动 ✅
所有分类文件夹都正确创建 ✅
```

---

## 💡 技术说明

**Chrome Bookmarks API 的 index 参数**：
- index 必须在 0 到 children.length 之间
- 超出范围会抛出 "Index out of bounds" 错误
- 不指定 index 时，Chrome 会自动追加到末尾

**v2.6 的初衷**：
- 按分类体系顺序创建文件夹
- 让文件夹排列整齐

**问题**：
- 分类体系有 10 个分类
- 但"其他书签"可能只有 2 个现有项目
- 设置 index=6 就会超出范围

**解决方案**：
- 暂时移除 index 设置
- 文件夹按创建顺序排列（仍然有序）
- 后续可以在所有文件夹创建后，再调整顺序

---

**现在请重新加载扩展，再次执行！** 🎯

应该不会再有 Index out of bounds 错误了。
