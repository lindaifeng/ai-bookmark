/**
 * v2.14 执行逻辑优化补丁
 * 执行后清理书签栏的残留（书签已移走）
 */

(function() {
  'use strict';

  console.log('[v2.14 Patch] 执行逻辑优化加载中...');

  // 增强 applyPlan，执行完成后清理书签栏
  const originalApplyPlan = window.applyPlan;
  if (typeof originalApplyPlan === 'function') {
    window.applyPlan = async function() {
      // 执行整理
      await originalApplyPlan.apply(this, arguments);

      // 执行后清理书签栏
      try {
        log('[v2.14] 开始清理书签栏的残留书签...');

        const tree = await chromeBookmarks.getTree();
        const topLevel = tree[0]?.children || [];

        // 找到书签栏
        const bookmarksBar = topLevel.find(n =>
          /Bookmarks bar|书签栏|Bookmarks Bar|收藏夹栏/i.test(n.title)
        );

        if (!bookmarksBar) {
          log('[v2.14] 未找到书签栏');
          return;
        }

        // 实时获取书签栏的内容
        const barChildren = await chromeBookmarks.getChildren(bookmarksBar.id);

        if (barChildren.length === 0) {
          log('[v2.14] 书签栏已为空，无需清理');
          return;
        }

        log(`[v2.14] 发现书签栏残留 ${barChildren.length} 项`);

        // 获取所有已执行的操作
        const ops = await idbGetAllByIndex("operations", "jobId", activeJob.jobId);
        const doneOps = ops.filter(op => op.status === "done");
        const movedBookmarkIds = new Set(doneOps.map(op => op.bookmarkId));

        // 检查书签栏中的项目（使用实时数据）
        let needsCleanup = 0;
        for (const child of barChildren) {
          // 如果是文件夹，实时检查是否为空
          if (child.children !== undefined) {
            try {
              const currentChildren = await chromeBookmarks.getChildren(child.id);
              if (currentChildren.length === 0) {
                needsCleanup++;
              }
            } catch (err) {
              // 文件夹可能已被删除，忽略
            }
          } else if (child.url) {
            // 如果是书签，检查是否已经被移走
            if (movedBookmarkIds.has(child.id)) {
              needsCleanup++;
            }
          }
        }

        if (needsCleanup === 0) {
          log('[v2.14] 书签栏无需清理（都是未移动的项目或非空文件夹）');
          return;
        }

        // 弹出确认对话框
        const ok = confirm(
          `检测到书签栏中有 ${needsCleanup} 项可以清理：\n\n` +
          `• 已移走的书签\n` +
          `• 空的文件夹\n\n` +
          `这些项目的内容已经整理到新的分类中。\n\n` +
          `是否清理书签栏？\n` +
          `（保留未移动的书签和非空文件夹）`
        );

        if (!ok) {
          log('[v2.14] 用户取消清理书签栏');
          return;
        }

        // 清理书签栏（使用实时数据）
        let cleaned = 0;
        let skipped = 0;

        for (const child of barChildren) {
          try {
            if (child.children !== undefined) {
              // 文件夹：只删除空文件夹
              const currentChildren = await chromeBookmarks.getChildren(child.id);

              if (currentChildren.length === 0) {
                await chromeBookmarks.removeTree(child.id);
                log(`[v2.14] 已删除空文件夹：${child.title}`);
                cleaned++;
              } else {
                log(`[v2.14] 保留非空文件夹：${child.title} (${currentChildren.length} 项)`);
                skipped++;
              }
            } else if (child.url) {
              // 书签：只删除已移走的
              if (movedBookmarkIds.has(child.id)) {
                await chromeBookmarks.remove(child.id);
                log(`[v2.14] 已删除已移走的书签：${child.title}`);
                cleaned++;
              } else {
                log(`[v2.14] 保留未移动的书签：${child.title}`);
                skipped++;
              }
            }
          } catch (err) {
            log(`[v2.14] 清理失败 ${child.title}: ${err.message}`);
            skipped++;
          }
        }

        log(`[v2.14] ✅ 书签栏清理完成：删除 ${cleaned} 项，保留 ${skipped} 项`);

      } catch (err) {
        log(`[v2.14] ⚠️ 清理书签栏失败：${err.message}`);
        console.error('[v2.14] 清理错误:', err);
      }
    };
  }

  console.log('[v2.14 Patch] 执行逻辑优化已加载');

})();
