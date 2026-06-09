/**
 * v2.12 扫描行为优化补丁
 * 每次扫描都重新开始，不再使用增量扫描
 */

(function() {
  'use strict';

  console.log('[v2.12 Patch] 扫描行为优化加载中...');

  // 覆盖 handleScanToggle，每次都提示并重新开始
  const originalHandleScanToggle = window.handleScanToggle;
  if (typeof originalHandleScanToggle === 'function') {
    window.handleScanToggle = async function() {
      if (scanning) {
        scanStopRequested = true;
        log("已请求停止扫描。当前扫描批次保存后会停止。");
        return;
      }
      if (running) {
        log("分类任务进行中，暂时不能扫描。");
        return;
      }

      // 如果已有扫描数据，提示用户将重新开始
      if (activeBookmarks && activeBookmarks.length > 0) {
        const ok = confirm(
          `当前已有 ${activeBookmarks.length} 条扫描记录。\n\n` +
          `重新扫描将：\n` +
          `1. 清空现有扫描数据\n` +
          `2. 清空分类结果\n` +
          `3. 从头开始扫描所有书签\n\n` +
          `是否继续？`
        );

        if (!ok) {
          log('[v2.12] 已取消重新扫描');
          return;
        }

        log('[v2.12] 🔄 重新扫描：清空现有数据...');

        // 清空旧数据
        try {
          // 清空 suggestions
          if (activeJob) {
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

              log(`[v2.12] 已清空 ${oldSuggestions.length} 条旧的分类结果`);
            }

            // 重置任务状态
            activeJob.status = 'idle';
            activeJob.taxonomy = null;
            activeJob.taxonomyConfirmed = false;
            activeJob.currentBatchIndex = 0;
            activeJob.processedBookmarks = 0;
            activeJob.scannedBookmarks = 0;
            await idbPut('jobs', activeJob);
          }

          // 清空内存中的书签数据
          activeBookmarks = [];

          // 清空界面
          renderStats([]);
          renderTaxonomy(null);
          await renderPlan(null);

          log('[v2.12] ✅ 已清空，开始重新扫描...');
        } catch (err) {
          log(`[v2.12] ⚠️ 清空失败：${err.message}`);
        }
      }

      // 调用原始扫描逻辑（现在会从头开始）
      startOrContinueScan();
    };
  }

  // 更新按钮文本
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      originalSetButtons.apply(this, arguments);

      const scanBtn = document.getElementById('scanToggleBtn');
      if (scanBtn && !scanning && !running) {
        if (activeBookmarks.length > 0) {
          scanBtn.textContent = '重新扫描';
          scanBtn.title = '清空现有数据并重新扫描所有书签';
        } else {
          scanBtn.textContent = '开始扫描';
          scanBtn.title = '扫描所有书签';
        }
      }
    };
  }

  console.log('[v2.12 Patch] 扫描行为优化已加载');

})();
