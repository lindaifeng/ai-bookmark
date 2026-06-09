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
