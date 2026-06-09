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
