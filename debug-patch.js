/**
 * 临时调试补丁 - 检查重新识别后的数据
 */

(function() {
  'use strict';

  console.log('[Debug Patch] 调试补丁已加载');

  // 添加一个调试按钮
  setTimeout(() => {
    const logBox = document.getElementById('logBox');
    if (logBox && !document.getElementById('debugCheckBtn')) {
      const debugBtn = document.createElement('button');
      debugBtn.id = 'debugCheckBtn';
      debugBtn.textContent = '🔍 检查数据库';
      debugBtn.className = 'btn';
      debugBtn.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999;';

      debugBtn.addEventListener('click', async () => {
        if (!activeJob) {
          alert('没有活跃任务');
          return;
        }

        log('[调试] 正在检查数据库中的 suggestions...');

        const allSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
        log(`[调试] 总共 ${allSuggestions.length} 条 suggestion`);

        const settingsData = await chromeStorage.get(['settings']);
        const settings = settingsData.settings || {};
        const threshold = Number(settings.threshold || 0.75);

        const pending = allSuggestions.filter(s => {
          const isAutoApply = ["move", "move_and_rename"].includes(s.action) &&
                             Number(s.confidence || 0) >= threshold &&
                             (s.categoryPath || []).join(">") !== "待确认";
          return !isAutoApply;
        });

        log(`[调试] 待确认书签：${pending.length} 个`);

        if (pending.length > 0) {
          log('[调试] 前5个待确认书签详情：');
          pending.slice(0, 5).forEach((s, i) => {
            log(`  ${i+1}. ${s.bookmarkId}: ${(s.categoryPath || []).join(' / ')}`);
            log(`     confidence: ${s.confidence}, action: ${s.action}`);
          });
        }

        const success = allSuggestions.filter(s => {
          const isAutoApply = ["move", "move_and_rename"].includes(s.action) &&
                             Number(s.confidence || 0) >= threshold &&
                             (s.categoryPath || []).join(">") !== "待确认";
          return isAutoApply;
        });

        log(`[调试] 可自动应用书签：${success.length} 个`);
      });

      document.body.appendChild(debugBtn);
      log('[调试] 已添加"检查数据库"按钮（右下角）');
    }
  }, 2000);

})();
