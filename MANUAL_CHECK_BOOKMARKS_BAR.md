# 手动检查书签栏文件夹

由于 v2.17 的增强日志没有显示，说明代码在检查后认为 `needsCleanup === 0`，直接返回了。

## 🔧 请在浏览器控制台执行

**按 F12 打开控制台，粘贴并执行**：

```javascript
chrome.bookmarks.getTree(tree => {
  const bookmarksBar = tree[0].children.find(n => n.title === '书签栏' || n.id === '1');
  
  console.log('=== 书签栏检查 ===');
  console.log('书签栏 ID:', bookmarksBar.id);
  console.log('总共:', bookmarksBar.children.length, '项');
  console.log('');
  
  let needsCleanup = 0;
  
  bookmarksBar.children.forEach((child, index) => {
    console.log(`[${index + 1}] ${child.title || child.url}`);
    console.log('  类型:', child.children !== undefined ? '文件夹' : '书签');
    
    if (child.children !== undefined) {
      // 是文件夹，实时获取内容
      chrome.bookmarks.getChildren(child.id, children => {
        console.log('  内容:', children.length, '项');
        if (children.length === 0) {
          console.log('  ✅ 空文件夹 - 应该清理');
          needsCleanup++;
        } else {
          console.log('  ❌ 非空 - 保留');
          console.log('  里面有:', children.map(c => c.title || c.url.substring(0, 30)));
        }
      });
    } else {
      console.log('  URL:', child.url);
    }
    console.log('');
  });
  
  setTimeout(() => {
    console.log('=== 检查完成 ===');
    console.log('需要清理的项目数:', needsCleanup);
  }, 1000);
});
```

---

## 📋 这个脚本会显示

1. 书签栏中有多少项
2. 每一项的详细信息：
   - 名称
   - 类型（文件夹/书签）
   - 如果是文件夹，里面有多少项
   - 如果非空，里面有什么

---

**请执行这个脚本并告诉我结果！** 🎯

这样我们就能精确知道"常用"和"dev"文件夹里到底有什么了。
