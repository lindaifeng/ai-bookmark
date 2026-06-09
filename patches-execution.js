/**
 * v2.6 优化回滚和执行补丁
 */

(function() {
  'use strict';

  console.log('[v2.6 Patch] 回滚和执行优化加载中...');

  // 0. 允许 rolled_back 状态执行
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 调用原始逻辑
      originalSetButtons.apply(this, arguments);

      // 特殊处理：rolled_back 状态应该允许执行
      if (activeJob && activeJob.status === 'rolled_back' &&
          activeJob.taxonomy && activeJob.taxonomy.categories &&
          activeJob.taxonomy.categories.length > 0) {

        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
          applyBtn.disabled = false;
          log('[v2.6] 检测到 rolled_back 状态，已启用执行按钮');
        }

        const reclassifyBtn = document.getElementById('reclassifyPendingBtn');
        if (reclassifyBtn) {
          reclassifyBtn.disabled = false;
        }
      }
    };
  }

  // 1. 增强 rollbackCurrentJob 函数，回滚后自动清理创建的文件夹
  const originalRollback = window.rollbackCurrentJob;
  if (typeof originalRollback === 'function') {
    window.rollbackCurrentJob = async function() {
      if (!activeJob) return log("没有可回滚任务。");

      const ops = await idbGetAllByIndex("operations", "jobId", activeJob.jobId);
      const doneOps = ops.filter((op) => op.status === "done");

      if (!doneOps.length) {
        await cleanupCreatedFolders(activeJob);
        return log("没有已执行的操作可回滚。");
      }

      const ok = confirm(`确认回滚 ${doneOps.length} 个操作？\n\n回滚会：\n1. 移回原文件夹并恢复原标题\n2. 自动删除 AI 创建的空文件夹\n3. 保留有内容的文件夹`);
      if (!ok) return;

      running = true;
      setButtons();

      try {
        let count = 0;
        // 源文件夹若在整理后被清理删除，按记录的原路径自动重建（兜底移到“其他书签”，绝不丢书签）
        const recreateCache = new Map();
        const deletedMap = new Map((activeJob.deletedSourceFolders || []).map((d) => [String(d.oldId), d.path]));
        const canRecreate = typeof folderExists === 'function' && typeof recreateFolderPathFromTitles === 'function';
        for (const op of [...doneOps].reverse()) {
          try {
            await chromeBookmarks.update(op.bookmarkId, { title: op.oldTitle });

            let destParentId = op.oldParentId;
            if (canRecreate && !(await folderExists(destParentId))) {
              const path = deletedMap.get(String(op.oldParentId));
              destParentId = path
                ? await recreateFolderPathFromTitles(path, recreateCache)
                : await getDefaultTopLevelParentId();
            }

            await chromeBookmarks.move(op.bookmarkId, {
              parentId: destParentId,
              index: typeof op.oldIndex === "number" ? op.oldIndex : undefined
            });
            op.status = "rolled_back";
            op.rolledBackAt = Date.now();
            await idbPut("operations", op);
            count++;
            setProgress((count / doneOps.length) * 100, `回滚中 ${count} / ${doneOps.length}`);
          } catch (err) {
            log(`回滚失败 bookmarkId=${op.bookmarkId}: ${err.message}`);
          }
        }

        activeJob.status = "rolled_back";
        activeJob.updatedAt = Date.now();
        await idbPut("jobs", activeJob);

        setProgress(100, "回滚完成");
        log(`回滚完成：${count} / ${doneOps.length}`);

        // 重要：回滚完成后清理空文件夹
        log('[v2.6] 开始清理创建的文件夹...');
        await cleanupCreatedFolders(activeJob);

      } finally {
        running = false;
        setButtons();
      }
    };
  }

  // 2. 增强文件夹排序（按照分类体系顺序创建）
  const originalEnsureFolderPathTracked = window.ensureFolderPathTracked;
  if (typeof originalEnsureFolderPathTracked === 'function') {
    window.ensureFolderPathTracked = async function(rootId, path, cache, createdFolders) {
      let parentId = rootId;
      let key = "";

      for (let i = 0; i < path.length; i++) {
        const rawTitle = path[i];
        const title = String(rawTitle || "").trim();
        if (!title) continue;

        key = key ? `${key}>${title}` : title;

        if (cache.has(key)) {
          parentId = cache.get(key);
          continue;
        }

        const existing = await chromeBookmarks.getChildren(parentId);
        let folder = existing.find((n) => n.title === title && !n.url);

        if (!folder) {
          // 创建文件夹时，如果是一级分类，使用索引来排序
          const createOptions = { parentId, title };

          // 注释掉 index 设置，避免 Index out of bounds 错误
          // 如果有分类体系，按照分类体系的顺序设置索引
          /*
          if (i === 0 && activeJob && activeJob.taxonomy && activeJob.taxonomy.categories) {
            const categoryIndex = activeJob.taxonomy.categories.findIndex(c =>
              c.path && c.path[0] === title
            );
            if (categoryIndex >= 0) {
              createOptions.index = categoryIndex;
              log(`[v2.6] 创建一级文件夹 "${title}" 在位置 ${categoryIndex}`);
            }
          }
          */

          folder = await chromeBookmarks.create(createOptions);
          createdFolders.push({
            id: folder.id,
            title: folder.title,
            parentId,
            path: key,
            createdAt: Date.now()
          });
        }

        cache.set(key, folder.id);
        parentId = folder.id;
      }

      return parentId;
    };
  }

  console.log('[v2.6 Patch] 回滚和执行优化已加载');

})();
/**
 * v2.7 UI 文案和样式优化补丁
 */

(function() {
  'use strict';

  console.log('[v2.7 Patch] UI 文案和样式优化加载中...');

  // 1. 修改 "将创建的一级书签夹" 为 "所有书签"
  const originalRenderBookmarkTree = window.renderBookmarkTreeFromSuggestions;
  if (typeof originalRenderBookmarkTree === 'function') {
    window.renderBookmarkTreeFromSuggestions = function(suggestions) {
      // 调用原始函数
      const result = originalRenderBookmarkTree.apply(this, arguments);

      // 修改文字
      const treePreview = document.getElementById('bookmarkTreePreview');
      if (treePreview) {
        const innerHTML = treePreview.innerHTML;
        if (innerHTML.includes('将创建的一级书签夹')) {
          treePreview.innerHTML = innerHTML.replace(/将创建的一级书签夹/g, '所有书签');
        }
      }

      return result;
    };
  }

  // 2. 添加 CSS 去除目标分类背景色
  const style = document.createElement('style');
  style.textContent = `
    /* 去除目标分类背景色 */
    .cat-badge {
      background: transparent !important;
      color: var(--text-primary) !important;
      padding: 0 !important;
      border-radius: 0 !important;
    }

    .cat-badge.cat-ai,
    .cat-badge.cat-dev,
    .cat-badge.cat-design,
    .cat-badge.cat-learning,
    .cat-badge.cat-tools {
      background: transparent !important;
      color: var(--text-primary) !important;
    }
  `;
  document.head.appendChild(style);

  // 3. 修复进度条卡在 95% 的问题
  const originalApplyPlan = window.applyPlan;
  if (typeof originalApplyPlan === 'function') {
    window.applyPlan = async function() {
      try {
        await originalApplyPlan.apply(this, arguments);

        // 确保进度条到达 100%
        setTimeout(() => {
          setProgress(100, '整理完成');
        }, 100);
      } catch (err) {
        throw err;
      }
    };
  }

  console.log('[v2.7 Patch] UI 文案和样式优化已加载');

})();
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
/**
 * v2.15 回滚清理优化补丁
 * 使用多轮扫描删除空文件夹
 */

(function() {
  'use strict';

  console.log('[v2.15 Patch] 回滚清理优化加载中...');

  // 覆盖 cleanupCreatedFolders，使用多轮扫描
  window.cleanupCreatedFolders = async function(job) {
    const created = Array.isArray(job?.createdFolders) ? [...job.createdFolders] : [];
    if (!created.length) {
      log("没有记录到本次创建的文件夹需要清理。");
      return;
    }

    log(`[v2.15] 开始清理创建的文件夹（共 ${created.length} 个）...`);

    let totalRemoved = 0;
    let round = 1;
    let deletedThisRound = 0;

    // 多轮扫描，直到没有可删除的
    do {
      deletedThisRound = 0;
      let skippedThisRound = 0;

      // 从最深层开始（reverse）
      for (const folder of [...created].reverse()) {
        try {
          const children = await chromeBookmarks.getChildren(folder.id);
          if (children.length === 0) {
            await chromeBookmarks.removeTree(folder.id);
            deletedThisRound++;
            totalRemoved++;
            log(`[v2.15] 第 ${round} 轮：已删除空文件夹 ${folder.title || folder.path}`);
          } else {
            skippedThisRound++;
          }
        } catch (err) {
          // 文件夹已被删除或不存在，忽略
          if (err.message && err.message.includes('not find')) {
            // 已经被删除了，算作成功
          } else {
            log(`[v2.15] 删除失败 ${folder.title || folder.id}: ${err.message}`);
          }
        }
      }

      if (deletedThisRound > 0) {
        log(`[v2.15] 第 ${round} 轮清理完成：删除 ${deletedThisRound} 个，跳过 ${skippedThisRound} 个`);
        round++;
      }

      // 最多 5 轮，避免无限循环
    } while (deletedThisRound > 0 && round <= 5);

    const remaining = created.length - totalRemoved;
    log(`[v2.15] ✅ 回滚清理完成：共删除 ${totalRemoved} 个空文件夹，剩余 ${remaining} 个非空文件夹`);

    if (remaining > 0) {
      log(`[v2.15] 提示：剩余的文件夹中可能还有未移动的书签（如"待确认"的书签）`);
    }
  };

  console.log('[v2.15 Patch] 回滚清理优化已加载');

})();
/**
 * v2.17 执行整理后的清理（v2.x 重写）
 * 旧逻辑只扫“书签栏第一层”，无法删除嵌套在文件夹内部的空源文件夹，也不支持文件夹模式。
 * 现改为调用 sidepanel.js 的 cleanupEmptiedSourceFolders：基于 op.oldParentId 回溯本次整理的
 * 源文件夹，自底向上删除变空的（受保护集合：根目录/目标父级/AI 新建文件夹），并记录被删路径供回滚自动重建。
 */

(function() {
  'use strict';

  console.log('[v2.17 Patch] 执行后清理空源文件夹加载中...');

  const originalApplyPlan = window.applyPlan;
  if (typeof originalApplyPlan === 'function') {
    window.applyPlan = async function() {
      // 先执行整理
      await originalApplyPlan.apply(this, arguments);

      // 执行后清理整理留下的空源文件夹（基于实时数据，支持任意嵌套层级与文件夹模式）
      try {
        if (typeof cleanupEmptiedSourceFolders === 'function') {
          await cleanupEmptiedSourceFolders(activeJob);
        } else {
          log('[v2.17] 未找到 cleanupEmptiedSourceFolders，跳过空文件夹清理。');
        }
      } catch (err) {
        log(`[v2.17] ⚠️ 清理空源文件夹失败：${err.message}`);
        console.error('[v2.17] 清理错误:', err);
      }
    };
  }

  console.log('[v2.17 Patch] 执行后清理空源文件夹已加载');

})();
