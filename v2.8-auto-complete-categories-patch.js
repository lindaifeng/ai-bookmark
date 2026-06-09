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
