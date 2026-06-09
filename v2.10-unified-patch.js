/**
 * v2.10 统一补丁整合
 * 合并所有 setButtons 覆盖，解决补丁冲突
 */

(function() {
  'use strict';

  console.log('[v2.10 Patch] 统一补丁整合加载中...');

  // 统一的 setButtons 增强
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 调用原始函数
      originalSetButtons.apply(this, arguments);

      // 1. v2.4: 确保"整理待确认"按钮文本正确
      const reclassifyBtn = document.getElementById('reclassifyPendingBtn');
      if (reclassifyBtn && reclassifyBtn.textContent !== '整理待确认') {
        reclassifyBtn.textContent = '整理待确认';
      }

      // 2. v2.5: failed 状态允许执行
      if (activeJob && activeJob.status === 'failed' &&
          activeJob.taxonomy && activeJob.taxonomy.categories &&
          activeJob.taxonomy.categories.length > 0) {

        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
          applyBtn.disabled = false;
        }

        if (reclassifyBtn) {
          reclassifyBtn.disabled = false;
        }
      }

      // 3. v2.6: rolled_back 状态允许执行
      if (activeJob && activeJob.status === 'rolled_back' &&
          activeJob.taxonomy && activeJob.taxonomy.categories &&
          activeJob.taxonomy.categories.length > 0) {

        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
          applyBtn.disabled = false;
        }

        if (reclassifyBtn) {
          reclassifyBtn.disabled = false;
        }
      }
    };
  }

  console.log('[v2.10 Patch] 统一补丁整合已加载');

})();
