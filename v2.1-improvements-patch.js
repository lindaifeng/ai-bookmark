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
