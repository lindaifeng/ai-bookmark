/**
 * 临时调试补丁 - 检查按钮状态
 */

(function() {
  'use strict';

  console.log('[Debug Button Patch] 按钮状态调试加载中...');

  // 添加调试按钮
  setTimeout(() => {
    if (!document.getElementById('debugButtonBtn')) {
      const debugBtn = document.createElement('button');
      debugBtn.id = 'debugButtonBtn';
      debugBtn.textContent = '🐛 检查按钮状态';
      debugBtn.className = 'btn';
      debugBtn.style.cssText = 'position: fixed; bottom: 120px; right: 20px; z-index: 9999;';

      debugBtn.addEventListener('click', () => {
        log('[调试] 检查按钮状态...');
        log(`[调试] running: ${running}`);
        log(`[调试] scanning: ${scanning}`);
        log(`[调试] activeJob: ${activeJob ? 'exists' : 'null'}`);

        if (activeJob) {
          log(`[调试] activeJob.status: ${activeJob.status}`);
          log(`[调试] activeJob.taxonomy: ${activeJob.taxonomy ? 'exists' : 'null'}`);
          if (activeJob.taxonomy) {
            log(`[调试] categories: ${activeJob.taxonomy.categories?.length || 0} 个`);
          }
        }

        const applyBtn = document.getElementById('applyBtn');
        if (applyBtn) {
          log(`[调试] applyBtn.disabled: ${applyBtn.disabled}`);
        }

        const reclassifyBtn = document.getElementById('reclassifyPendingBtn');
        if (reclassifyBtn) {
          log(`[调试] reclassifyBtn.disabled: ${reclassifyBtn.disabled}`);
        }

        const rollbackBtn = document.getElementById('rollbackBtn');
        if (rollbackBtn) {
          log(`[调试] rollbackBtn.disabled: ${rollbackBtn.disabled}`);
        }
      });

      document.body.appendChild(debugBtn);
      log('[调试] 已添加"检查按钮状态"按钮（右下角）');
    }
  }, 2000);

})();
