/**
 * v2.7 UI 文案和样式优化补丁
 */

(function() {
  'use strict';

  console.log('[v2.7 Patch] UI 文案和样式优化加载中...');

  // 1. 修改 "将创建的一级书签夹" 为 "所有书签"
  const originalRenderBookmarkTree = window.renderBookmarkTreeFromSuggestions;
  if (typeof originalRenderBookmarkTree === 'function') {
    window.renderBookmarkTreeFromSuggestions = function(suggestions) {
      // 调用原始函数
      const result = originalRenderBookmarkTree.apply(this, arguments);

      // 修改文字
      const treePreview = document.getElementById('bookmarkTreePreview');
      if (treePreview) {
        const innerHTML = treePreview.innerHTML;
        if (innerHTML.includes('将创建的一级书签夹')) {
          treePreview.innerHTML = innerHTML.replace(/将创建的一级书签夹/g, '所有书签');
        }
      }

      return result;
    };
  }

  // 2. 添加 CSS 去除目标分类背景色
  const style = document.createElement('style');
  style.textContent = `
    /* 去除目标分类背景色 */
    .cat-badge {
      background: transparent !important;
      color: var(--text-primary) !important;
      padding: 0 !important;
      border-radius: 0 !important;
    }

    .cat-badge.cat-ai,
    .cat-badge.cat-dev,
    .cat-badge.cat-design,
    .cat-badge.cat-learning,
    .cat-badge.cat-tools {
      background: transparent !important;
      color: var(--text-primary) !important;
    }
  `;
  document.head.appendChild(style);

  // 3. 修复进度条卡在 95% 的问题
  const originalApplyPlan = window.applyPlan;
  if (typeof originalApplyPlan === 'function') {
    window.applyPlan = async function() {
      try {
        await originalApplyPlan.apply(this, arguments);

        // 确保进度条到达 100%
        setTimeout(() => {
          setProgress(100, '整理完成');
        }, 100);
      } catch (err) {
        throw err;
      }
    };
  }

  console.log('[v2.7 Patch] UI 文案和样式优化已加载');

})();
