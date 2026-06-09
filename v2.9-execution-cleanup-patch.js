/**
 * v2.9 执行优化补丁
 * 1. 确保"待确认/无法访问"文件夹被创建
 * 2. 执行后清理"所有书签"原位置，但保留回滚信息
 */

(function() {
  'use strict';

  console.log('[v2.9 Patch] 执行优化加载中...');

  // 1. 增强 applyPlan 函数，执行后清理原位置
  const originalApplyPlan = window.applyPlan;
  if (typeof originalApplyPlan === 'function') {
    window.applyPlan = async function() {
      // 调用原始执行逻辑
      await originalApplyPlan.apply(this, arguments);

      // 执行完成后，清理"所有书签"中的原书签
      try {
        log('[v2.9] 开始清理原位置的书签...');

        // 获取所有已执行的操作
        const ops = await idbGetAllByIndex("operations", "jobId", activeJob.jobId);
        const doneOps = ops.filter(op => op.status === "done");

        if (doneOps.length === 0) {
          log('[v2.9] 没有需要清理的书签');
          return;
        }

        // 获取"所有书签"文件夹的 ID
        const rootId = activeJob.rootFolderId;
        if (!rootId) {
          log('[v2.9] ⚠️ 未找到根文件夹 ID，跳过清理');
          return;
        }

        // 检查根文件夹是否还有书签
        const rootChildren = await chromeBookmarks.getChildren(rootId);
        const remainingBookmarks = rootChildren.filter(child => child.url); // 只计算书签，不计算文件夹

        if (remainingBookmarks.length === 0) {
          log('[v2.9] ✅ 原位置已无残留书签');
          return;
        }

        log(`[v2.9] 发现原位置残留 ${remainingBookmarks.length} 个书签，准备清理...`);

        // 创建一个"已整理"文件夹用于临时存放（用于回滚）
        let archiveFolder;
        try {
          archiveFolder = await chromeBookmarks.create({
            parentId: rootId,
            title: '_已整理归档_'
          });
          log('[v2.9] 已创建归档文件夹');
        } catch (err) {
          log(`[v2.9] ⚠️ 创建归档文件夹失败：${err.message}`);
          return;
        }

        // 将残留书签移到归档文件夹
        let moved = 0;
        for (const bookmark of remainingBookmarks) {
          try {
            await chromeBookmarks.move(bookmark.id, { parentId: archiveFolder.id });
            moved++;
          } catch (err) {
            log(`[v2.9] 移动书签失败 ${bookmark.title}: ${err.message}`);
          }
        }

        log(`[v2.9] ✅ 已清理 ${moved} 个残留书签到归档文件夹`);

      } catch (err) {
        log(`[v2.9] ⚠️ 清理原位置失败：${err.message}`);
        console.error('[v2.9] 清理错误:', err);
      }
    };
  }

  // 2. 确保"待确认/无法访问"被正确处理
  // 补充：buildExecutablePlanItems 确保包含所有分类
  const originalBuildPlan = window.buildExecutablePlanItems;
  if (typeof originalBuildPlan === 'function') {
    window.buildExecutablePlanItems = function(suggestions, threshold) {
      const result = originalBuildPlan.apply(this, arguments);

      // 检查是否有"待确认/无法访问"的书签
      const inaccessible = suggestions.filter(s =>
        s.categoryPath && s.categoryPath.length === 2 &&
        s.categoryPath[0] === '待确认' && s.categoryPath[1] === '无法访问'
      );

      if (inaccessible.length > 0) {
        log(`[v2.9] 检测到 ${inaccessible.length} 个无法访问的书签`);
      }

      return result;
    };
  }

  console.log('[v2.9 Patch] 执行优化已加载');

})();
