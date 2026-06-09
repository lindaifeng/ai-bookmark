/**
 * v2.11 暂停后重新扫描补丁
 */

(function() {
  'use strict';

  console.log('[v2.11 Patch] 暂停后重新扫描功能加载中...');

  // 增强 setButtons，在暂停状态时显示"重新扫描"按钮
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 调用原始函数
      originalSetButtons.apply(this, arguments);

      const scanBtn = document.getElementById('scanToggleBtn');
      const classifyBtn = document.getElementById('classifyToggleBtn');

      // 在暂停状态时，允许重新扫描
      if (activeJob && activeJob.status === 'paused' && !running && !scanning) {
        if (scanBtn) {
          scanBtn.disabled = false;
          scanBtn.textContent = '重新扫描';
          scanBtn.title = '重新扫描书签并从头开始分类';
        }
      }
    };
  }

  // 增强扫描逻辑，如果是暂停状态，提示用户
  const originalScanToggle = window.handleScanToggle;
  if (typeof originalScanToggle === 'function') {
    window.handleScanToggle = async function() {
      // 如果当前任务是暂停状态，询问是否重新开始
      if (activeJob && activeJob.status === 'paused' && !scanning) {
        const ok = confirm(
          '当前分类任务已暂停。\n\n' +
          '重新扫描将：\n' +
          '1. 重新扫描所有书签（包括最新修改）\n' +
          '2. 清空当前分类结果\n' +
          '3. 从头开始分类\n\n' +
          '是否继续？'
        );

        if (!ok) {
          log('[v2.11] 已取消重新扫描');
          return;
        }

        log('[v2.11] 🔄 重新扫描：清空暂停的任务...');

        // 清空旧的分类结果
        try {
          const oldSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
          if (oldSuggestions.length > 0) {
            const dbInstance = await new Promise((resolve, reject) => {
              const req = indexedDB.open('ai_bookmark_organizer_mvp', 6);
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });

            const tx = dbInstance.transaction('suggestions', 'readwrite');
            const store = tx.objectStore('suggestions');

            for (const s of oldSuggestions) {
              store.delete(s.key);
            }

            await new Promise((resolve, reject) => {
              tx.oncomplete = () => {
                dbInstance.close();
                resolve();
              };
              tx.onerror = () => {
                dbInstance.close();
                reject(tx.error);
              };
            });

            log(`[v2.11] 已清空 ${oldSuggestions.length} 条旧的分类结果`);
          }
        } catch (err) {
          log(`[v2.11] ⚠️ 清空失败：${err.message}`);
        }

        // 重置任务状态
        activeJob.status = 'idle';
        activeJob.taxonomy = null;
        activeJob.taxonomyConfirmed = false;
        activeJob.currentBatchIndex = 0;
        activeJob.processedBookmarks = 0;
        await idbPut('jobs', activeJob);

        // 清空界面
        activeBookmarks = [];
        renderStats([]);
        renderTaxonomy(null);
        await renderPlan(null);

        log('[v2.11] ✅ 已清空，准备重新扫描...');
      }

      // 调用原始扫描逻辑
      await originalScanToggle.apply(this, arguments);
    };
  }

  console.log('[v2.11 Patch] 暂停后重新扫描功能已加载');

})();
