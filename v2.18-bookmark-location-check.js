/**
 * v2.18 书签位置检查 + 执行后自动验证
 */

(function() {
  'use strict';

  console.log('[v2.18] 书签位置检查工具加载中...');

  function countBookmarksSimple(node) {
    if (!node) return 0;
    if (node.url) return 1;
    let count = 0;
    for (const child of (node.children || [])) {
      count += countBookmarksSimple(child);
    }
    return count;
  }

  function analyzeBookmarkTree(node, path, results) {
    if (!node) return;
    if (node.url) {
      results.push({ title: node.title, url: node.url, path: path.join(' > ') });
      return;
    }
    for (const child of (node.children || [])) {
      analyzeBookmarkTree(child, [...path, node.title || 'ROOT'], results);
    }
  }

  // 添加检查按钮
  setTimeout(() => {
    if (document.getElementById('v218CheckBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'v218CheckBtn';
    btn.textContent = '📍 检查书签实际位置';
    btn.className = 'btn';
    btn.style.cssText = 'position: fixed; bottom: 250px; right: 20px; z-index: 9999; font-size: 12px;';

    btn.addEventListener('click', async () => {
      log('[v2.18] 开始检查书签实际位置...');

      const tree = await chromeBookmarks.getTree();
      const topLevel = tree[0].children || [];

      const bookmarksBar = topLevel.find(n => n.id === '1');
      const otherBookmarks = topLevel.find(n => n.id === '2');

      // 统计书签栏
      let barBookmarks = 0;
      let barFolders = 0;
      if (bookmarksBar) {
        for (const child of (bookmarksBar.children || [])) {
          if (child.url) barBookmarks++;
          else barFolders++;
        }
      }

      // 统计其他书签
      let otherFolders = 0;
      let otherBookmarksCount = 0;
      let folderDetails = [];
      let looseBookmarks = [];

      if (otherBookmarks) {
        for (const child of (otherBookmarks.children || [])) {
          if (child.url) {
            otherBookmarksCount++;
            looseBookmarks.push(child);
          } else {
            const count = countBookmarksSimple(child);
            otherFolders++;
            folderDetails.push({ title: child.title, count, id: child.id });
          }
        }
      }

      log('==================================================');
      log('[v2.18] 书签实际位置检查');
      log('==================================================');
      log(`📌 书签栏：${barBookmarks} 个书签，${barFolders} 个文件夹`);
      log(`📂 其他书签：${otherFolders} 个文件夹，${otherBookmarksCount} 个散落书签`);
      log('');

      if (folderDetails.length > 0) {
        log('其他书签下的文件夹：');
        folderDetails.forEach(f => {
          log(`  📁 ${f.title}: ${f.count} 个书签`);
        });
      }

      if (looseBookmarks.length > 0) {
        log('');
        log(`⚠️ ${looseBookmarks.length} 个书签在根目录（未在文件夹中）：`);
        looseBookmarks.slice(0, 20).forEach(b => {
          log(`  🔖 ${b.title || b.url.substring(0, 50)}`);
        });
      }

      log('==================================================');
    });

    document.body.appendChild(btn);
  }, 1500);

})();
