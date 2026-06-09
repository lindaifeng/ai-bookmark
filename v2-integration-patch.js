/**
 * v2.0 集成补丁 - 在原始 sidepanel.js 后面追加
 * 这个脚本会在页面加载时自动应用改进
 */

(function() {
  'use strict';

  console.log('[v2.0 Patch] Initializing enhancement...');

  // 1. 增强 init 函数，显示预分类统计
  const originalInit = window.init;
  if (typeof originalInit === 'function') {
    window.init = async function() {
      await originalInit.apply(this, arguments);

      // 显示预分类引擎就绪状态
      if (typeof getPreclassificationStats === 'function' && window.activeBookmarks && window.activeBookmarks.length > 0) {
        try {
          const stats = getPreclassificationStats(window.activeBookmarks, []);
          log(`[v2.0] 预分类引擎已就绪：可快速分类 ${stats.preclassifiedRate} 的书签`);
        } catch (e) {
          console.warn('[v2.0 Patch] Prefilter stats failed:', e);
        }
      }

      log('[v2.0] 识别增强版已启动');
    };
  }

  // 2. 增强 generateTaxonomyForJob 函数
  const originalGenerateTaxonomy = window.generateTaxonomyForJob;
  if (typeof originalGenerateTaxonomy === 'function') {
    window.generateTaxonomyForJob = async function(settings, job, bookmarks) {
      log('[v2.0] 使用优化 Prompt 生成分类体系...');

      // 使用新的 Prompt 模板（如果可用）
      if (typeof generateTaxonomyPromptV2 === 'function') {
        const userPrompt = generateTaxonomyPromptV2(bookmarks, settings.topCategoryCount || 8);

        const messages = [
          { role: "system", content: "You are an expert information architect for browser bookmarks. Return only valid JSON." },
          { role: "user", content: userPrompt }
        ];

        const raw = await chatJSON(settings, {
          messages,
          schemaName: "bookmark_taxonomy",
          schema: taxonomySchema(),
          maxTokens: 2600
        });

        const categories = normalizeTaxonomy(raw, bookmarks);
        job.taxonomy = { categories };
        job.taxonomyConfirmed = false;
        job.status = "classifying";
        job.updatedAt = Date.now();
        await idbPut("jobs", job);
        renderTaxonomy(job);
        log(`[v2.0] 优化分类体系已生成：${job.taxonomy.categories.length} 个分类`);
        return;
      }

      // 回退到原始实现
      return originalGenerateTaxonomy.apply(this, arguments);
    };
  }

  // 3. 增强 processBatches 函数，集成预分类引擎
  const originalProcessBatches = window.processBatches;
  if (typeof originalProcessBatches === 'function') {
    window.processBatches = async function(settings, job, bookmarks) {
      const batchSize = Number(job.settings?.batchSize || settings.batchSize);

      // 尝试预分类
      let preclassified = [];
      let needsAI = bookmarks;

      if (typeof batchPreclassify === 'function') {
        try {
          const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
          const result = batchPreclassify(bookmarks, taxonomyPaths);
          preclassified = result.preclassified || [];
          needsAI = (result.needsAI || []).map(item => item.bookmark);

          log(`[v2.0] 预分类完成：${preclassified.length} 条高置信度直接分类，${needsAI.length} 条需要 AI`);

          // 保存预分类结果
          if (preclassified.length > 0) {
            const preclassifiedSuggestions = preclassified.map(p => {
              const bookmark = p.bookmark;
              return {
                jobId: job.jobId,
                bookmarkId: String(bookmark.id),
                batchId: 'prefilter',
                oldTitle: bookmark.title || '',
                suggestedTitle: bookmark.title || bookmark.domain || '',
                url: bookmark.url,
                domain: bookmark.domain,
                urlPath: bookmark.urlPath,
                currentFolderPath: bookmark.currentFolderPath || [],
                categoryPath: p.classification.path,
                confidence: p.classification.confidence,
                action: 'move',
                reason: p.classification.reason || 'Prefilter',
                updatedAt: Date.now()
              };
            });

            await idbPutMany("suggestions", preclassifiedSuggestions);
            job.processedBookmarks = preclassified.length;
            await idbPut("jobs", job);
          }
        } catch (e) {
          console.warn('[v2.0 Patch] Prefilter failed, falling back:', e);
          needsAI = bookmarks;
        }
      }

      // 对剩余书签使用 AI 分类
      const totalBatches = Math.ceil(needsAI.length / batchSize);
      job.status = "classifying";
      job.totalBatches = totalBatches;
      await idbPut("jobs", job);

      for (let i = Number(job.currentBatchIndex || 0); i < totalBatches; i++) {
        if (stopRequested) {
          job.status = "paused";
          job.updatedAt = Date.now();
          await idbPut("jobs", job);
          log("[v2.0] 分类任务已暂停");
          return;
        }

        const batch = needsAI.slice(i * batchSize, (i + 1) * batchSize);
        const batchId = `${job.jobId}_batch_${String(i + 1).padStart(4, "0")}`;

        // 修复：基于已完成的批次计算进度，而不是当前批次
        const completedItems = preclassified.length + (i * batchSize);
        const totalItems = preclassified.length + needsAI.length;
        const progress = Math.min(99, (completedItems / totalItems) * 100); // 最多 99%，完成后才 100%

        setProgress(progress, `[v2.0] AI 分类 ${i + 1}/${totalBatches}`);
        log(`[v2.0] AI 分类批次 ${i + 1}/${totalBatches}，数量 ${batch.length}`);

        const suggestions = await classifyBatchWithRetry(settings, job, batch, batchId, 2);
        await idbPutMany("suggestions", suggestions);

        job.currentBatchIndex = i + 1;
        job.processedBookmarks = preclassified.length + Math.min(needsAI.length, (i + 1) * batchSize);
        job.updatedAt = Date.now();
        await idbPut("jobs", job);
        await renderPlan(job);
      }

      // 继续后续处理
      await enrichLowConfidenceItems(settings, job, bookmarks);
      await ensureClassificationQuality(job);
      await reducePendingByFallback(job);
      // 注释掉未定义的函数
      // await promoteFallbackClassifiedItems(job);

      job.status = "reviewing";
      job.updatedAt = Date.now();
      await idbPut("jobs", job);
      window.activeJob = job;
      setProgress(100, "[v2.0] 分类完成");
      log(`[v2.0] 整理分类已生成，待确认率优化中...`);
    };
  }

  // 4. 增强 classifyBatch 函数
  const originalClassifyBatch = window.classifyBatch;
  if (typeof originalClassifyBatch === 'function') {
    window.classifyBatch = async function(settings, job, batch, batchId) {
      // 尝试使用优化 Prompt
      if (typeof generateClassificationPromptV2 === 'function') {
        const taxonomyPaths = job.taxonomy.categories.map((c) => c.path);
        const userPrompt = generateClassificationPromptV2(
          batch,
          taxonomyPaths,
          batchId,
          settings.classificationStrategy || 'aggressive'
        );

        const messages = [
          { role: "system", content: "You are a precise bookmark organizer. Return valid JSON only." },
          { role: "user", content: userPrompt }
        ];

        return chatJSON(settings, {
          messages,
          schemaName: "bookmark_batch_result",
          schema: batchResultSchema(),
          maxTokens: 3800
        });
      }

      // 回退到原始实现
      return originalClassifyBatch.apply(this, arguments);
    };
  }

  // 5. 增强 fallbackCategoryForBookmark 函数
  const originalFallback = window.fallbackCategoryForBookmark;
  if (typeof originalFallback === 'function') {
    window.fallbackCategoryForBookmark = function(bookmark, taxonomyPaths) {
      // 尝试使用关键词分类
      if (typeof classifyByKeywords === 'function') {
        try {
          const result = classifyByKeywords(bookmark, taxonomyPaths);
          if (result && result.confidence >= 0.65) {
            return result.path;
          }
        } catch (e) {
          console.warn('[v2.0 Patch] Keywords classification failed:', e);
        }
      }

      // 回退到原始实现
      return originalFallback.apply(this, arguments);
    };
  }

  console.log('[v2.0 Patch] Enhancement applied successfully');

})();
