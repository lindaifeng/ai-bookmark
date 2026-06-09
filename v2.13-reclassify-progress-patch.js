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
