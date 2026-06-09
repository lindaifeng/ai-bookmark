/**
 * 一键修复补丁 - 更新数据库中的置信度
 */

(function() {
  'use strict';

  console.log('[Fix Patch] 置信度修复补丁已加载');

  // 添加修复按钮
  setTimeout(() => {
    if (!document.getElementById('fixConfidenceBtn')) {
      const fixBtn = document.createElement('button');
      fixBtn.id = 'fixConfidenceBtn';
      fixBtn.textContent = '🔧 修复置信度';
      fixBtn.className = 'btn primary';
      fixBtn.style.cssText = 'position: fixed; bottom: 70px; right: 20px; z-index: 9999;';

      fixBtn.addEventListener('click', async () => {
        if (!activeJob) {
          alert('没有活跃任务');
          return;
        }

        const ok = confirm('将把所有 confidence = 0.70 的书签提升到 0.76-0.80\n\n确定继续？');
        if (!ok) return;

        log('[修复] 开始更新数据库中的置信度...');

        const allSuggestions = await idbGetAllByIndex('suggestions', 'jobId', activeJob.jobId);
        log(`[修复] 找到 ${allSuggestions.length} 条 suggestion`);

        let updated = 0;
        const toUpdate = [];

        allSuggestions.forEach(s => {
          if (s.confidence === 0.70 || s.confidence === 0.7) {
            // 根据分类路径判断应该设置什么置信度
            const path = (s.categoryPath || []).join('/');

            if (path.includes('代码') || path.includes('GitHub') || path.includes('仓库')) {
              s.confidence = 0.80;
            } else if (path.includes('AI') || path.includes('模型')) {
              s.confidence = 0.80;
            } else if (path.includes('设计') || path.includes('Figma')) {
              s.confidence = 0.80;
            } else if (path.includes('文档') || path.includes('教程')) {
              s.confidence = 0.76;
            } else if (path.includes('博客') || path.includes('CSDN')) {
              s.confidence = 0.76;
            } else {
              // 默认提升到 0.76
              s.confidence = 0.76;
            }

            s.updatedAt = Date.now();
            toUpdate.push(s);
            updated++;
          }
        });

        if (toUpdate.length > 0) {
          await idbPutMany('suggestions', toUpdate);
          log(`[修复] ✅ 已更新 ${updated} 条书签的置信度`);
          log(`[修复] 正在刷新界面...`);
          await renderPlan(activeJob);
          log(`[修复] 完成！请点击"🔍 检查数据库"验证`);
        } else {
          log('[修复] 没有需要更新的书签');
        }
      });

      document.body.appendChild(fixBtn);
      log('[修复] 已添加"🔧 修复置信度"按钮（右下角）');
    }
  }, 2000);

})();
