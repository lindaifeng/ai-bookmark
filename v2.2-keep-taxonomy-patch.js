/**
 * v2.2 保留分类体系改进补丁
 * 功能：点击"重新智能分类"时保留上一次的分类体系
 */

(function() {
  'use strict';

  console.log('[v2.2 Patch] 保留分类体系功能加载中...');

  // 覆盖原有的 generateRecommendationsFromScanned 函数
  const originalGenerateRecommendations = window.generateRecommendationsFromScanned;

  if (typeof originalGenerateRecommendations === 'function') {
    window.generateRecommendationsFromScanned = async function() {
      if (running || scanning) return;

      const settings = await saveSettingsFromForm();
      if (!settings.apiKey) return log("请先在模型配置中填写 API Key。");
      if (!activeJob || !activeBookmarks.length) return log("请先扫描书签，停止或完成后都可以智能整理分类。");

      // 检查是否已有分类体系
      const hasExistingTaxonomy = activeJob.taxonomy && activeJob.taxonomy.categories && activeJob.taxonomy.categories.length > 0;

      let confirmMessage;
      if (hasExistingTaxonomy) {
        // 已有分类体系，询问是保留还是重新生成
        confirmMessage = `检测到已有分类体系（${activeJob.taxonomy.categories.length} 个分类）。

选择操作方式：

✅ 点击"确定"：保留现有分类体系，只重新对书签分类
   （推荐：节省时间和 API 调用）

❌ 点击"取消"：完全重新生成分类体系
   （仅当分类体系不合适时选择）

当前书签数：${activeBookmarks.length} 条`;
      } else {
        // 没有分类体系，正常确认
        confirmMessage = `将基于当前已扫描的 ${activeBookmarks.length} 条书签生成分类方案。\n如果后续继续扫描，可以重新智能整理。\n\n是否继续？`;
      }

      const userChoice = confirm(confirmMessage);

      // 如果有分类体系，用户点击"确定"表示保留
      const shouldKeepTaxonomy = hasExistingTaxonomy && userChoice;

      // 如果有分类体系但用户点击"取消"，询问是否重新生成
      if (hasExistingTaxonomy && !userChoice) {
        const regenerate = confirm('是否完全重新生成分类体系？\n\n确定 = 重新生成\n取消 = 放弃操作');
        if (!regenerate) {
          return log("已取消智能整理分类。");
        }
        // 用户确认重新生成，清空现有分类体系
        log('[v2.2] 用户选择重新生成分类体系');
      }

      if (!hasExistingTaxonomy && !userChoice) {
        return log("已取消智能整理分类。");
      }

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

        if (shouldKeepTaxonomy) {
          // 保留现有分类体系
          log(`[v2.2] ✅ 保留现有分类体系（${activeJob.taxonomy.categories.length} 个分类），开始重新分类书签...`);
          setProgress(5, `保留分类体系，重新分类 ${activeBookmarks.length} 条书签...`);

          // 跳过生成分类体系，直接进入分类阶段
          activeJob.status = "classifying";
          await idbPut("jobs", activeJob);

          // 清空旧的分类结果（但保留分类体系）
          const oldSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
          if (oldSuggestions.length > 0) {
            // 获取数据库实例
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
            log(`[v2.2] 已清空 ${oldSuggestions.length} 条旧的分类结果`);
          }

        } else {
          // 重新生成分类体系
          log(`[v2.2] 🔄 重新生成分类体系...`);
          setProgress(2, `基于 ${activeBookmarks.length} 条已扫描书签生成分类体系中...`);
          await generateTaxonomyForJob(settings, activeJob, activeBookmarks);

          // 清空旧的分类结果
          const oldSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
          if (oldSuggestions.length > 0) {
            // 获取数据库实例
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
            log(`[v2.2] 已清空 ${oldSuggestions.length} 条旧的分类结果`);
          }
        }

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

    log('[v2.2 Patch] 保留分类体系功能已启用');
  }

  // 添加"编辑分类体系"按钮（可选功能）
  function addEditTaxonomyButton() {
    const taxonomyBox = document.getElementById('taxonomyBox');
    if (!taxonomyBox || document.getElementById('editTaxonomyBtn')) return;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'margin-top: 12px; display: flex; gap: 8px;';

    const editBtn = document.createElement('button');
    editBtn.id = 'editTaxonomyBtn';
    editBtn.className = 'btn';
    editBtn.textContent = '✏️ 手动编辑分类体系';
    editBtn.style.fontSize = '13px';

    editBtn.addEventListener('click', () => {
      if (!activeJob || !activeJob.taxonomy) {
        alert('请先进行智能整理分类，生成分类体系后才能编辑。');
        return;
      }

      const currentCategories = activeJob.taxonomy.categories.map(c => c.path.join(' / ')).join('\n');
      const newCategories = prompt(
        '手动编辑分类体系（每行一个分类路径，用 / 分隔层级）：\n\n例如：\n开发技术 / 前端开发\n开发技术 / 后端开发\nAI 工具 / 模型平台\n\n当前分类：',
        currentCategories
      );

      if (newCategories !== null && newCategories.trim() !== '') {
        const lines = newCategories.trim().split('\n');
        const newPaths = lines.map(line => {
          return {
            path: line.trim().split('/').map(p => p.trim()),
            description: ''
          };
        }).filter(item => item.path.length > 0 && item.path[0] !== '');

        if (newPaths.length > 0) {
          activeJob.taxonomy.categories = newPaths;
          activeJob.updatedAt = Date.now();
          idbPut('jobs', activeJob);
          renderTaxonomy(activeJob);
          log(`[v2.2] ✅ 已更新分类体系：${newPaths.length} 个分类`);
        }
      }
    });

    buttonContainer.appendChild(editBtn);
    taxonomyBox.parentElement.appendChild(buttonContainer);
  }

  // DOM 加载完成后添加按钮
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(addEditTaxonomyButton, 1000);
    });
  } else {
    setTimeout(addEditTaxonomyButton, 1000);
  }

  console.log('[v2.2 Patch] 保留分类体系功能已加载');

})();
