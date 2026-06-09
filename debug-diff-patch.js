/**
 * 调试补丁 - 诊断分类差异问题
 */

(function() {
  'use strict';

  console.log('[Debug Diff Patch] 分类差异诊断工具加载中...');

  // 添加对比按钮
  setTimeout(() => {
    if (!document.getElementById('debugDiffBtn')) {
      const debugBtn = document.createElement('button');
      debugBtn.id = 'debugDiffBtn';
      debugBtn.textContent = '🔍 对比分类差异';
      debugBtn.className = 'btn';
      debugBtn.style.cssText = 'position: fixed; bottom: 170px; right: 20px; z-index: 9999; font-size: 12px;';

      debugBtn.addEventListener('click', async () => {
        if (!activeJob) {
          alert('没有活跃任务');
          return;
        }

        log('[诊断] 开始对比分类差异...');
        log('='.repeat(50));

        // 1. 检查分类体系
        if (activeJob.taxonomy && activeJob.taxonomy.categories) {
          log(`[诊断] 分类体系：${activeJob.taxonomy.categories.length} 个分类`);
          activeJob.taxonomy.categories.forEach((cat, i) => {
            log(`  ${i + 1}. ${cat.path.join(' / ')}`);
          });
        } else {
          log('[诊断] ❌ 没有分类体系');
        }

        log('='.repeat(50));

        // 2. 检查 suggestions
        const allSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
        log(`[诊断] Suggestions 总数：${allSuggestions.length}`);

        const settingsData = await chromeStorage.get(['settings']);
        const settings = settingsData.settings || {};
        const threshold = Number(settings.threshold || 0.75);

        const autoApply = allSuggestions.filter(s => {
          return ["move", "move_and_rename"].includes(s.action) &&
                 Number(s.confidence || 0) >= threshold &&
                 (s.categoryPath || []).join(">") !== "待确认";
        });

        log(`[诊断] 可自动应用：${autoApply.length} 个`);
        log(`[诊断] 需要确认：${allSuggestions.length - autoApply.length} 个`);

        log('='.repeat(50));

        // 3. 统计实际分类分布
        const categoryCount = {};
        autoApply.forEach(s => {
          const path = (s.categoryPath || []).join(' / ');
          categoryCount[path] = (categoryCount[path] || 0) + 1;
        });

        log('[诊断] 实际分类分布（可自动应用）：');
        Object.entries(categoryCount)
          .sort((a, b) => b[1] - a[1])
          .forEach(([path, count]) => {
            log(`  ${path}: ${count} 个`);
          });

        log('='.repeat(50));

        // 4. 检查执行时会创建的路径
        log('[诊断] 执行时将创建的路径：');
        const uniquePaths = new Set();
        autoApply.forEach(s => {
          const path = s.finalCategoryPath || s.categoryPath || [];
          if (path.length > 0 && path[0] !== '待确认') {
            // 一级分类
            uniquePaths.add(path[0]);
            // 二级分类
            if (path.length > 1) {
              uniquePaths.add(path.slice(0, 2).join(' > '));
            }
            // 三级分类
            if (path.length > 2) {
              uniquePaths.add(path.slice(0, 3).join(' > '));
            }
          }
        });

        const sortedPaths = Array.from(uniquePaths).sort();
        sortedPaths.forEach(path => {
          log(`  ${path}`);
        });

        log('='.repeat(50));
        log(`[诊断] 将创建 ${sortedPaths.length} 个文件夹路径`);

        // 5. 对比分类体系和实际使用的分类
        if (activeJob.taxonomy && activeJob.taxonomy.categories) {
          const taxonomyPaths = new Set();
          activeJob.taxonomy.categories.forEach(cat => {
            const path = cat.path.join(' > ');
            taxonomyPaths.add(path);
          });

          log('[诊断] 分类体系中有但未使用的：');
          let unusedCount = 0;
          taxonomyPaths.forEach(path => {
            if (!uniquePaths.has(path)) {
              log(`  ❌ ${path}`);
              unusedCount++;
            }
          });
          if (unusedCount === 0) {
            log('  ✅ 无');
          }

          log('[诊断] 实际使用但分类体系中没有的：');
          let extraCount = 0;
          uniquePaths.forEach(path => {
            if (!taxonomyPaths.has(path)) {
              log(`  ⚠️ ${path}`);
              extraCount++;
            }
          });
          if (extraCount === 0) {
            log('  ✅ 无');
          }
        }

        log('='.repeat(50));
        log('[诊断] 对比完成！');
      });

      document.body.appendChild(debugBtn);
      log('[诊断] 已添加"对比分类差异"按钮（右下角）');
    }
  }, 2000);

})();
