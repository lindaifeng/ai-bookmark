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
/**
 * v2.1 UI 和功能改进补丁
 * 1. 优化模型配置界面（隐藏高级选项，显示推荐值）
 * 2. 同域名书签聚合排序
 * 3. 修复重新识别进度显示
 */

(function() {
  'use strict';

  console.log('[v2.1 Patch] Initializing UI improvements...');

  // ==================== 1. 优化模型配置界面 ====================

  function optimizeSettingsUI() {
    // 添加推荐默认值到输入框
    const defaultValues = {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      batchSize: '25',
      threshold: '0.75',
      scanChunkSize: '200',
      topCategoryCount: '8',
      dedupeMode: 'url',
      classificationStrategy: 'aggressive',
      enableUrlEnrichment: 'true',
      enrichmentLimit: '60',
      enrichmentConcurrency: '3',
      enablePageCache: 'true',
      responseFormatMode: 'json_schema'
    };

    // 为每个输入框添加 placeholder 显示推荐值
    for (const [id, value] of Object.entries(defaultValues)) {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'INPUT') {
          const currentPlaceholder = el.placeholder;
          if (!currentPlaceholder || currentPlaceholder === '') {
            el.placeholder = `推荐: ${value}`;
          }
        }
        // 如果字段为空，自动填充推荐值
        if (!el.value && el.tagName === 'INPUT') {
          el.value = value;
        }
      }
    }

    // 隐藏高级配置项
    const advancedFields = [
      'batchSize',
      'scanChunkSize',
      'threshold',
      'enrichmentLimit',
      'enrichmentConcurrency',
      'enablePageCache',
      'responseFormatMode'
    ];

    // 创建"显示高级选项"按钮
    const settingsActions = document.querySelector('.settings-actions');
    if (settingsActions && !document.getElementById('toggleAdvancedBtn')) {
      const toggleBtn = document.createElement('button');
      toggleBtn.id = 'toggleAdvancedBtn';
      toggleBtn.className = 'btn';
      toggleBtn.textContent = '显示高级选项';
      toggleBtn.style.marginLeft = 'auto';

      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isHidden = advancedFields.some(id => {
          const el = document.getElementById(id);
          return el && el.closest('label').style.display === 'none';
        });

        advancedFields.forEach(id => {
          const el = document.getElementById(id);
          const label = el?.closest('label');
          if (label) {
            label.style.display = isHidden ? '' : 'none';
          }
        });

        toggleBtn.textContent = isHidden ? '隐藏高级选项' : '显示高级选项';
        log(isHidden ? '[配置] 已显示高级选项' : '[配置] 已隐藏高级选项');
      });

      settingsActions.insertBefore(toggleBtn, settingsActions.firstChild);

      // 默认隐藏高级选项
      advancedFields.forEach(id => {
        const el = document.getElementById(id);
        const label = el?.closest('label');
        if (label) {
          label.style.display = 'none';
        }
      });

      log('[v2.1] 配置界面已优化，高级选项默认隐藏');
    }
  }

  // ==================== 2. 同域名书签聚合排序 ====================

  const originalBuildExecutablePlanItems = window.buildExecutablePlanItems;
  if (typeof originalBuildExecutablePlanItems === 'function') {
    window.buildExecutablePlanItems = function(suggestions, taxonomyPaths) {
      const result = originalBuildExecutablePlanItems.apply(this, arguments);

      // 对每个分类下的书签按域名排序
      result.forEach(item => {
        if (item.children && item.children.length > 0) {
          // 按域名分组
          const grouped = new Map();
          item.children.forEach(child => {
            const domain = child.domain || 'unknown';
            if (!grouped.has(domain)) {
              grouped.set(domain, []);
            }
            grouped.get(domain).push(child);
          });

          // 重新排列：同域名的放一起
          const sorted = [];
          // 按域名出现次数排序（多的在前）
          const sortedDomains = Array.from(grouped.entries())
            .sort((a, b) => b[1].length - a[1].length);

          sortedDomains.forEach(([domain, bookmarks]) => {
            // 同域名内按标题排序
            bookmarks.sort((a, b) => {
              const titleA = a.suggestedTitle || a.title || '';
              const titleB = b.suggestedTitle || b.title || '';
              return titleA.localeCompare(titleB, 'zh-CN');
            });
            sorted.push(...bookmarks);
          });

          item.children = sorted;
        }
      });

      log(`[v2.1] 书签已按域名聚合排序`);
      return result;
    };
  }

  // ==================== 3. 修复重新识别进度显示 ====================

  const originalReclassifyPending = window.reclassifyPendingItemsOnly;
  if (typeof originalReclassifyPending === 'function') {
    window.reclassifyPendingItemsOnly = async function() {
      if (!activeJob || !activeJob.taxonomy?.categories) {
        log('请先完成智能整理分类。');
        return;
      }

      // 获取设置中的阈值
      const settingsData = await chromeStorage.get(['settings']);
      const settings = settingsData.settings || {};
      const threshold = Number(settings.threshold || 0.75);

      const allSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);

      // 使用与原始逻辑相同的判断条件
      const pendingItems = allSuggestions.filter(s => {
        // shouldAutoApply 返回 false 的就是待确认书签
        const isAutoApply = ["move", "move_and_rename"].includes(s.action) &&
                           Number(s.confidence || 0) >= threshold &&
                           (s.categoryPath || []).join(">") !== "待确认";
        return !isAutoApply;
      });

      if (pendingItems.length === 0) {
        log('[重新识别] 没有待确认的书签，无需重新识别。');
        return;
      }

      log(`[重新识别] 开始处理 ${pendingItems.length} 个待确认书签（阈值：${threshold}）...`);

      // 显示进度
      setProgress(0, `重新识别 0/${pendingItems.length}`);

      try {
        running = true;
        setButtons();

        // 使用关键词引擎先处理一遍
        let reclassified = 0;
        const needsEnrich = [];

        for (let i = 0; i < pendingItems.length; i++) {
          const item = pendingItems[i];
          const bookmark = activeBookmarks.find(b => String(b.id) === String(item.bookmarkId));

          if (!bookmark) continue;

          // 尝试关键词分类
          if (typeof classifyByKeywords === 'function') {
            const keywordResult = classifyByKeywords(bookmark, activeJob.taxonomy.categories.map(c => c.path));
            if (keywordResult && keywordResult.confidence >= 0.70) {
              item.categoryPath = keywordResult.path;
              item.confidence = keywordResult.confidence;
              item.reason = keywordResult.reason + ' (关键词识别)';
              item.action = 'move';
              reclassified++;
            } else {
              needsEnrich.push(item);
            }
          } else {
            needsEnrich.push(item);
          }

          // 更新进度
          const progress = ((i + 1) / pendingItems.length) * 50; // 前50%是关键词识别
          setProgress(progress, `关键词识别 ${i + 1}/${pendingItems.length}`);
        }

        log(`[重新识别] 关键词识别完成：${reclassified} 个成功，${needsEnrich.length} 个需要增强分类`);

        // 保存关键词识别结果
        if (reclassified > 0) {
          const toSave = pendingItems.filter(item =>
            item.categoryPath.join('/') !== '待确认'
          );
          if (toSave.length > 0) {
            await idbPutMany('suggestions', toSave);
            log(`[重新识别] 已保存 ${toSave.length} 条关键词识别结果`);
          }
        }

        // 对剩余的进行增强分类
        if (needsEnrich.length > 0) {
          log(`[重新识别] 开始增强分类（访问页面）：${needsEnrich.length} 个书签`);

          // 获取设置（使用全局变量或从存储读取）
          const settingsData = await chromeStorage.get(['settings']);
          const settings = settingsData.settings || {
            enrichmentLimit: 60,
            enrichmentConcurrency: 3
          };

          const limit = Math.min(needsEnrich.length, settings.enrichmentLimit || 60);
          const toEnrich = needsEnrich.slice(0, limit);

          for (let i = 0; i < toEnrich.length; i++) {
            const item = toEnrich[i];
            const bookmark = activeBookmarks.find(b => String(b.id) === String(item.bookmarkId));

            if (bookmark) {
              try {
                // 访问页面获取信息（使用原有函数）
                const pageInfo = await fetchBookmarkPageInfo(bookmark);

                // 检查是否无法访问
                if (!pageInfo.ok) {
                  // 无法访问的书签归入特殊分类
                  item.categoryPath = ['待确认', '无法访问'];
                  item.confidence = 0.85;
                  item.action = 'move';
                  item.reason = `无法访问 (${pageInfo.error || pageInfo.status || '未知错误'})`;
                  item.updatedAt = Date.now();
                  log(`  └─ ${bookmark.title || bookmark.url} - 无法访问`);
                  continue;
                }

                // 使用增强信息重新分类
                if (pageInfo.ok && (pageInfo.title || pageInfo.description)) {
                  const enrichedText = `${pageInfo.title} ${pageInfo.description} ${bookmark.title} ${bookmark.domain}`;

                  // 简单的规则判断（增强版）
                  if (/github|gitlab|gitee|代码|repository|repo/i.test(enrichedText)) {
                    item.categoryPath = ['开发技术', '代码托管'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (代码仓库)';
                  } else if (/openai|anthropic|ai|model|chatgpt|claude|gemini/i.test(enrichedText)) {
                    item.categoryPath = ['AI 工具', '模型平台'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (AI工具)';
                  } else if (/figma|design|ui|ux|sketch|dribbble/i.test(enrichedText)) {
                    item.categoryPath = ['产品设计', '设计工具'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (设计)';
                  } else if (/文档|documentation|docs|tutorial|guide|教程/i.test(enrichedText)) {
                    item.categoryPath = ['开发技术', '文档教程'];
                    item.confidence = 0.76;
                    item.action = 'move';
                    item.reason = '页面内容分析 (文档)';
                  } else if (/blog|博客|csdn|cnblogs|juejin|掘金/i.test(enrichedText)) {
                    item.categoryPath = ['学习资料', '技术博客'];
                    item.confidence = 0.76;
                    item.action = 'move';
                    item.reason = '页面内容分析 (博客)';
                  }
                  // 如果匹配成功，标记已处理
                  if (item.categoryPath.join('/') !== '待确认') {
                    item.updatedAt = Date.now();
                  }
                }
              } catch (e) {
                console.warn('[重新识别] 页面访问失败:', e);
              }
            }

            // 更新进度
            const progress = 50 + ((i + 1) / toEnrich.length) * 50; // 后50%是增强分类
            setProgress(progress, `增强分类 ${i + 1}/${toEnrich.length}`);
          }

          // 保存增强分类结果
          const successItems = toEnrich.filter(item =>
            item.categoryPath.join('/') !== '待确认'
          );
          if (successItems.length > 0) {
            await idbPutMany('suggestions', successItems);
            log(`[重新识别] 已保存 ${successItems.length} 条增强分类结果`);
          }

          // 统计最终结果（所有处理过的书签）
          const allProcessed = [...pendingItems];
          const finalPending = allProcessed.filter(item =>
            item.categoryPath.join('/') === '待确认' || item.categoryPath.join('>') === '待确认'
          ).length;

          const improved = pendingItems.length - finalPending;

          setProgress(100, '重新识别完成');
          log(`[重新识别] ✅ 完成！`);
          log(`[重新识别] 成功识别：${improved} 个 (${((improved/pendingItems.length)*100).toFixed(1)}%)`);
          log(`[重新识别] 仍待确认：${finalPending} 个`);

          // 强制刷新显示
          log(`[重新识别] 正在刷新整理计划预览...`);
          await renderPlan(activeJob);
          log(`[重新识别] 界面已更新`);
        } else {
          // 没有需要增强分类的，直接统计结果
          const finalPending = pendingItems.filter(item =>
            item.categoryPath.join('/') === '待确认' || item.categoryPath.join('>') === '待确认'
          ).length;

          const improved = pendingItems.length - finalPending;

          setProgress(100, '重新识别完成');
          log(`[重新识别] ✅ 完成！`);
          log(`[重新识别] 成功识别：${improved} 个 (${((improved/pendingItems.length)*100).toFixed(1)}%)`);
          log(`[重新识别] 仍待确认：${finalPending} 个`);

          log(`[重新识别] 正在刷新整理计划预览...`);
          await renderPlan(activeJob);
          log(`[重新识别] 界面已更新`);
        }

      } catch (err) {
        log(`[重新识别] ❌ 失败：${err.message}`);
        console.error('[重新识别] 详细错误:', err);
      } finally {
        running = false;
        setButtons();
        setProgress(0, '');
      }
    };
  }

  // ==================== 页面加载时执行 ====================

  // 等待 DOM 加载完成后执行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', optimizeSettingsUI);
  } else {
    optimizeSettingsUI();
  }

  console.log('[v2.1 Patch] UI improvements applied');

})();
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
/**
 * v2.4 UI 布局优化补丁
 */

(function() {
  'use strict';

  console.log('[v2.4 Patch] UI 布局优化加载中...');

  // 1. 增强 setButtons 函数，控制新位置的按钮状态
  const originalSetButtons = window.setButtons;
  if (typeof originalSetButtons === 'function') {
    window.setButtons = function() {
      // 调用原始函数（会设置所有按钮状态）
      originalSetButtons.apply(this, arguments);

      // 额外处理：确保"整理待确认"按钮文本正确
      const reclassifyBtn = document.getElementById('reclassifyPendingBtn');
      if (reclassifyBtn && reclassifyBtn.textContent !== '整理待确认') {
        reclassifyBtn.textContent = '整理待确认';
      }

      // 注意：不再覆盖原始的 disabled 逻辑，让原始代码控制
    };
  }

  // 2. 添加 CSS 样式
  const style = document.createElement('style');
  style.textContent = `
    /* 任务操作按钮组 */
    .task-actions {
      display: flex;
      gap: 12px;
      margin: 16px 0 12px 0;
      padding: 12px 0;
      border-top: 1px solid var(--border-color);
      border-bottom: 1px solid var(--border-color);
    }

    .task-actions .btn {
      flex: 1;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 500;
    }

    .task-actions .btn.secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }

    .task-actions .btn.secondary:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--primary);
    }

    .task-actions .btn.danger {
      background: linear-gradient(135deg, #dc2626, #b91c1c);
      color: white;
      border: none;
    }

    .task-actions .btn.danger:hover:not(:disabled) {
      background: linear-gradient(135deg, #b91c1c, #991b1b);
    }

    .task-actions .btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* 分类体系直接可编辑样式 */
    .taxonomy-preview-tree [contenteditable="true"] {
      cursor: text;
      padding: 2px 4px;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .taxonomy-preview-tree [contenteditable="true"]:hover {
      background: var(--bg-hover);
    }

    .taxonomy-preview-tree [contenteditable="true"]:focus {
      outline: 2px solid var(--primary);
      outline-offset: 1px;
      background: white;
    }

    /* 响应式优化 */
    @media (max-width: 768px) {
      .task-actions {
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);

  console.log('[v2.4 Patch] UI 布局优化已加载');

})();
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
/**
 * v2.8 自动补全一级分类补丁
 */

(function() {
  'use strict';

  console.log('[v2.8 Patch] 自动补全一级分类加载中...');

  // 增强 renderTaxonomy 函数，自动补全一级分类
  const originalRenderTaxonomy = window.renderTaxonomy;
  if (typeof originalRenderTaxonomy === 'function') {
    window.renderTaxonomy = function(job) {
      // 在渲染前补全一级分类
      if (job && job.taxonomy && job.taxonomy.categories) {
        const categories = job.taxonomy.categories;
        const topLevelPaths = new Set();

        // 收集所有一级分类
        categories.forEach(cat => {
          if (cat.path && cat.path.length > 0) {
            topLevelPaths.add(cat.path[0]);
          }
        });

        // 检查是否缺少一级分类定义
        const existingPaths = new Set(
          categories.filter(c => c.path.length === 1).map(c => c.path[0])
        );

        const missing = [];
        topLevelPaths.forEach(topLevel => {
          if (!existingPaths.has(topLevel)) {
            missing.push(topLevel);
          }
        });

        // 自动补全缺失的一级分类
        if (missing.length > 0) {
          log(`[v2.8] 检测到 ${missing.length} 个缺失的一级分类，自动补全中...`);

          missing.forEach(topLevel => {
            categories.unshift({
              path: [topLevel],
              description: `${topLevel}相关的所有内容`
            });
            log(`[v2.8] ✅ 已补全一级分类：${topLevel}`);
          });

          // 保存更新后的分类体系
          idbPut('jobs', job);
        }
      }

      // 调用原始渲染函数
      return originalRenderTaxonomy.apply(this, arguments);
    };
  }

  // 增强 generateTaxonomyForJob 的结果，确保包含一级分类
  const originalGenerateTaxonomy = window.generateTaxonomyForJob;
  if (typeof originalGenerateTaxonomy === 'function') {
    window.generateTaxonomyForJob = async function(settings, job, bookmarks) {
      // 调用原始函数
      await originalGenerateTaxonomy.apply(this, arguments);

      // 补全一级分类
      if (job && job.taxonomy && job.taxonomy.categories) {
        const categories = job.taxonomy.categories;
        const topLevelPaths = new Set();

        categories.forEach(cat => {
          if (cat.path && cat.path.length > 0) {
            topLevelPaths.add(cat.path[0]);
          }
        });

        const existingPaths = new Set(
          categories.filter(c => c.path.length === 1).map(c => c.path[0])
        );

        const missing = [];
        topLevelPaths.forEach(topLevel => {
          if (!existingPaths.has(topLevel)) {
            missing.push(topLevel);
          }
        });

        if (missing.length > 0) {
          log(`[v2.8] AI 生成的分类缺少 ${missing.length} 个一级分类，自动补全...`);

          missing.forEach(topLevel => {
            categories.unshift({
              path: [topLevel],
              description: `${topLevel}相关的所有内容`
            });
          });

          await idbPut('jobs', job);
          log(`[v2.8] ✅ 已补全所有一级分类`);
        }
      }
    };
  }

  console.log('[v2.8 Patch] 自动补全一级分类已加载');

})();
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
/**
 * v2.13 整理待确认进度优化补丁
 */

(function() {
  'use strict';

  console.log('[v2.13 Patch] 整理待确认进度优化加载中...');

  // 增强整理待确认的进度显示
  const originalReclassify = window.reclassifyPendingItemsOnly;
  if (typeof originalReclassify === 'function') {
    window.reclassifyPendingItemsOnly = async function() {
      const settingsData = await chromeStorage.get(['settings']);
      const settings = settingsData.settings || {};
      const threshold = Number(settings.threshold || 0.75);

      // 获取待确认的书签
      const allSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
      const pendingItems = allSuggestions.filter(s => {
        const isAutoApply = ["move", "move_and_rename"].includes(s.action) &&
                           Number(s.confidence || 0) >= threshold &&
                           (s.categoryPath || []).join(">") !== "待确认";
        return !isAutoApply;
      });

      if (pendingItems.length === 0) {
        return log("没有需要重新识别的待确认书签。");
      }

      log(`[重新识别] 开始处理 ${pendingItems.length} 个待确认书签（阈值：${threshold}）...`);

      try {
        running = true;
        setButtons();

        // 阶段1：关键词识别
        let reclassified = 0;
        const needsEnrich = [];

        for (let i = 0; i < pendingItems.length; i++) {
          const item = pendingItems[i];
          const bookmark = activeBookmarks.find(b => String(b.id) === String(item.bookmarkId));

          if (!bookmark) continue;

          // 尝试关键词分类
          if (typeof classifyByKeywords === 'function') {
            const keywordResult = classifyByKeywords(bookmark, activeJob.taxonomy.categories.map(c => c.path));
            if (keywordResult && keywordResult.confidence >= 0.70) {
              item.categoryPath = keywordResult.path;
              item.confidence = keywordResult.confidence;
              item.reason = keywordResult.reason + ' (关键词识别)';
              item.action = 'move';
              reclassified++;
            } else {
              needsEnrich.push(item);
            }
          } else {
            needsEnrich.push(item);
          }

          // 更新进度：阶段1占40%
          const progress = ((i + 1) / pendingItems.length) * 40;
          setProgress(progress, `[1/2] 关键词识别 ${i + 1}/${pendingItems.length}`);
        }

        log(`[重新识别] 关键词识别完成：${reclassified} 个成功，${needsEnrich.length} 个需要增强分类`);

        // 保存关键词识别结果
        if (reclassified > 0) {
          const toSave = pendingItems.filter(item =>
            item.categoryPath && item.categoryPath.join('/') !== '待确认'
          );
          if (toSave.length > 0) {
            await idbPutMany('suggestions', toSave);
          }
        }

        // 阶段2：增强分类（访问页面）
        if (needsEnrich.length > 0) {
          log(`[重新识别] 开始增强分类（访问页面）：${needsEnrich.length} 个书签`);

          const settingsData2 = await chromeStorage.get(['settings']);
          const settings2 = settingsData2.settings || {};
          const limit = Math.min(needsEnrich.length, settings2.enrichmentLimit || 60);
          const toEnrich = needsEnrich.slice(0, limit);

          for (let i = 0; i < toEnrich.length; i++) {
            const item = toEnrich[i];
            const bookmark = activeBookmarks.find(b => String(b.id) === String(item.bookmarkId));

            if (bookmark) {
              try {
                const pageInfo = await fetchBookmarkPageInfo(bookmark);

                if (!pageInfo.ok) {
                  item.categoryPath = ['待确认', '无法访问'];
                  item.confidence = 0.85;
                  item.action = 'move';
                  item.reason = `无法访问 (${pageInfo.error || pageInfo.status || '未知错误'})`;
                  item.updatedAt = Date.now();
                  continue;
                }

                // 页面分析规则（与原逻辑保持一致）
                if (pageInfo.ok && (pageInfo.title || pageInfo.description)) {
                  const enrichedText = `${pageInfo.title} ${pageInfo.description} ${bookmark.title} ${bookmark.domain}`;

                  if (/github|gitlab|gitee|代码|repository|repo/i.test(enrichedText)) {
                    item.categoryPath = ['开发技术', '代码托管'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (代码仓库)';
                  } else if (/openai|anthropic|ai|model|chatgpt|claude|gemini/i.test(enrichedText)) {
                    item.categoryPath = ['AI 工具', '模型平台'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (AI工具)';
                  } else if (/figma|design|ui|ux|sketch|dribbble/i.test(enrichedText)) {
                    item.categoryPath = ['产品设计', '设计工具'];
                    item.confidence = 0.80;
                    item.action = 'move';
                    item.reason = '页面内容分析 (设计)';
                  } else if (/文档|documentation|docs|tutorial|guide|教程/i.test(enrichedText)) {
                    item.categoryPath = ['开发技术', '文档教程'];
                    item.confidence = 0.76;
                    item.action = 'move';
                    item.reason = '页面内容分析 (文档)';
                  } else if (/blog|博客|csdn|cnblogs|juejin|掘金/i.test(enrichedText)) {
                    item.categoryPath = ['学习资料', '技术博客'];
                    item.confidence = 0.76;
                    item.action = 'move';
                    item.reason = '页面内容分析 (博客)';
                  }

                  item.updatedAt = Date.now();
                }
              } catch (err) {
                log(`  └─ 访问失败: ${bookmark.title || bookmark.url}`);
              }
            }

            // 更新进度：阶段2占40-90%
            const progress = 40 + ((i + 1) / toEnrich.length) * 50;
            setProgress(progress, `[2/2] 页面分析 ${i + 1}/${toEnrich.length}`);
          }

          // 保存增强分类结果
          await idbPutMany('suggestions', toEnrich);
          log(`[重新识别] 已保存 ${toEnrich.length} 条增强分类结果`);
        }

        // 计算最终结果
        const finalSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
        const finalPending = finalSuggestions.filter(s => {
          const isAutoApply = ["move", "move_and_rename"].includes(s.action) &&
                             Number(s.confidence || 0) >= threshold &&
                             (s.categoryPath || []).join(">") !== "待确认";
          return !isAutoApply;
        });

        const successCount = pendingItems.length - finalPending.length;
        const successRate = pendingItems.length > 0 ? (successCount / pendingItems.length * 100).toFixed(1) : 0;

        setProgress(100, '整理待确认完成');
        log(`[重新识别] ✅ 完成！`);
        log(`[重新识别] 成功识别：${successCount} 个 (${successRate}%)`);
        log(`[重新识别] 仍待确认：${finalPending.length} 个`);

        // 刷新界面
        log(`[重新识别] 正在刷新整理计划预览...`);
        await renderPlan(activeJob);
        log(`[重新识别] 界面已更新`);

      } catch (err) {
        log(`[重新识别] 失败：${err.message}`);
        console.error('[重新识别] 错误:', err);
      } finally {
        running = false;
        setButtons();
      }
    };
  }

  console.log('[v2.13 Patch] 整理待确认进度优化已加载');

})();
