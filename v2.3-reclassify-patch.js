/**
 * v2.3 重新智能分类功能补丁
 */

(function() {
  'use strict';

  console.log('[v2.3 Patch] 重新智能分类功能加载中...');

  // 增强 setButtons 函数，改变按钮文本和行为
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 调用原始函数
      originalSetButtons.apply(this, arguments);

      // 增强：如果已经分类完成，改变按钮文本和样式
      const classifyBtn = document.getElementById('classifyToggleBtn');
      if (!classifyBtn) return;

      const hasResults = activeJob &&
                        activeJob.taxonomy &&
                        activeJob.taxonomy.categories &&
                        activeJob.taxonomy.categories.length > 0 &&
                        ['reviewing', 'done'].includes(activeJob.status);

      if (hasResults && !running && !scanning) {
        classifyBtn.textContent = '重新智能分类';
        classifyBtn.classList.add('btn-reclassify');
        classifyBtn.title = '清空当前分类结果，重新开始分类';
      }
    };
  }

  // 覆盖 generateRecommendationsFromScanned 函数
  const originalGenerate = window.generateRecommendationsFromScanned;
  if (typeof originalGenerate === 'function') {
    window.generateRecommendationsFromScanned = async function() {
      if (running || scanning) return;

      const settings = await saveSettingsFromForm();
      if (!settings.apiKey) return log("请先在模型配置中填写 API Key。");
      if (!activeJob || !activeBookmarks.length) return log("请先扫描书签，停止或完成后都可以智能整理分类。");

      // 范围守卫：当前选择的整理范围/书签夹若与已扫描的 job 不一致，
      // 说明用户切换了范围但未重新扫描，此时分类会沿用旧书签集（旧结果）。直接拦截并提示重扫。
      const selMode = document.querySelector('[name="scan-mode"]:checked')?.value || 'full';
      const selFolder = selMode === 'folder' ? ($('target-folder-select').value || null) : null;
      if (activeJob.scanMode !== selMode || (activeJob.targetFolderId || null) !== selFolder) {
        return log('检测到整理范围/书签夹已切换，请先点「开始或继续扫描」重新扫描该范围，再进行智能整理分类。');
      }

      // 检查是否已有分类结果
      const hasExistingResults = activeJob.taxonomy &&
                                 activeJob.taxonomy.categories &&
                                 activeJob.taxonomy.categories.length > 0;

      if (hasExistingResults) {
        // 已有分类结果，直接重新分类，不弹窗
        log('[v2.3] 🔄 重新智能分类：清空旧结果...');

        // 清空旧的分类结果（使用批量删除）
        try {
          const oldSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
          log(`[v2.3] 找到 ${oldSuggestions.length} 条旧的分类结果`);

          if (oldSuggestions.length > 0) {
            // 使用 IndexedDB API 批量删除
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
                log(`[v2.3] ✅ 已清空 ${oldSuggestions.length} 条旧的分类结果`);
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            });

            dbInstance.close();
          } else {
            log('[v2.3] 没有旧的分类结果需要清空');
          }
        } catch (err) {
          log(`[v2.3] 清空失败：${err.message}`);
          console.error('[v2.3] 清空错误:', err);
        }

        // 清空分类体系
        activeJob.taxonomy = null;
        activeJob.taxonomyConfirmed = false;
        await idbPut('jobs', activeJob);

        // 清空界面显示
        renderTaxonomy(activeJob);
        await renderPlan(activeJob);

        log('[v2.3] ✅ 旧结果已清空，开始重新分类...');
      } else {
        // 首次分类，使用原有确认流程
        const ok = confirm(`将基于当前已扫描的 ${activeBookmarks.length} 条书签生成分类方案。\n如果后续继续扫描，可以重新智能整理。\n\n是否继续？`);
        if (!ok) return log("已取消智能整理分类。");
      }

      // 开始分类流程
      running = true;
      stopRequested = false;
      pendingPause = false;
      activeJob.taxonomyConfirmed = false;
      setButtons();

      try {
        switchTab("overview");
        activeJob.status = "generating_taxonomy";

        const dedupeResult = dedupeBookmarksForClassification(activeBookmarks, settings.dedupeMode);
        const bookmarksForClassify = dedupeResult.items;

        if (dedupeResult.removed > 0) {
          log(`已去重 ${dedupeResult.removed} 条重复书签，将基于 ${bookmarksForClassify.length} 条唯一书签智能整理。`);
        }

        activeJob.totalBookmarks = bookmarksForClassify.length;
        activeJob.duplicateBookmarks = dedupeResult.duplicates;
        activeJob.processedBookmarks = 0;
        activeJob.currentBatchIndex = 0;
        activeJob.totalBatches = 0;
        activeJob.settings = { ...activeJob.settings, ...settings };
        activeJob.updatedAt = Date.now();
        await idbPut("jobs", activeJob);

        setProgress(2, `基于 ${activeBookmarks.length} 条已扫描书签智能整理分类中……`);
        await generateTaxonomyForJob(settings, activeJob, activeBookmarks);

        activeJob.status = "classifying";
        await idbPut("jobs", activeJob);
        await processBatches(settings, activeJob, activeBookmarks);

      } catch (err) {
        log(`智能整理分类失败：${err.message}`);
        activeJob.status = "failed";
        activeJob.errors = [...(activeJob.errors || []), err.message];
        activeJob.updatedAt = Date.now();
        await idbPut("jobs", activeJob);
      } finally {
        running = false;
        setButtons();
      }
    };
  }

  console.log('[v2.3 Patch] 重新智能分类功能已加载');

})();
