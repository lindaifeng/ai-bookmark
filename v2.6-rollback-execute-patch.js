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
