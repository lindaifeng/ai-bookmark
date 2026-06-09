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
