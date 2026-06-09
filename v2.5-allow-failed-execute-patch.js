/**
 * v2.5 允许失败状态执行补丁
 */

(function() {
  'use strict';

  console.log('[v2.5 Patch] 允许失败状态执行补丁加载中...');

  // 覆盖原始的 setButtons 函数，增加对 failed 状态的处理
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 先调用原始逻辑
      originalSetButtons.apply(this, arguments);

      // 特殊处理：如果状态是 failed 但有分类体系，允许执行
      if (activeJob && activeJob.status === 'failed' &&
          activeJob.taxonomy && activeJob.taxonomy.categories &&
          activeJob.taxonomy.categories.length > 0) {

        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
          applyBtn.disabled = false;
          log('[v2.5] 检测到 failed 状态但有分类体系，已启用执行按钮');
        }
      }
    };
  }

  console.log('[v2.5 Patch] 允许失败状态执行补丁已加载');

})();
