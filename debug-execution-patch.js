/**
 * 调试补丁 - 检查执行和回滚错误
 */

(function() {
  'use strict';

  console.log('[Debug Execution Patch] 执行和回滚诊断工具加载中...');

  // 添加诊断按钮
  setTimeout(() => {
    if (!document.getElementById('debugExecBtn')) {
      const debugBtn = document.createElement('button');
      debugBtn.id = 'debugExecBtn';
      debugBtn.textContent = '🔧 诊断执行问题';
      debugBtn.className = 'btn';
      debugBtn.style.cssText = 'position: fixed; bottom: 220px; right: 20px; z-index: 9999; font-size: 12px;';

      debugBtn.addEventListener('click', async () => {
        if (!activeJob) {
          alert('没有活跃任务');
          return;
        }

        log('[诊断] 开始诊断执行问题...');
        log('='.repeat(50));

        // 1. 检查书签结构
        try {
          const tree = await chromeBookmarks.getTree();
          const root = tree[0];

          log(`[诊断] 根节点 ID: ${root.id}`);
          log(`[诊断] 根节点标题: ${root.title || 'ROOT'}`);
          log(`[诊断] 根节点子节点数: ${root.children?.length || 0}`);

          if (root.children) {
            root.children.forEach((child, i) => {
              log(`  ${i + 1}. ${child.title} (ID: ${child.id})`);
            });
          }

          // 找到目标文件夹
          const otherBookmarks = root.children.find(n =>
            n.id === "2" || /Other bookmarks|其他书签/i.test(n.title)
          );

          if (otherBookmarks) {
            log(`[诊断] 找到其他书签: ${otherBookmarks.title} (ID: ${otherBookmarks.id})`);
            log(`[诊断] 其他书签子节点数: ${otherBookmarks.children?.length || 0}`);
          } else {
            log('[诊断] ❌ 未找到其他书签文件夹');
          }

        } catch (err) {
          log(`[诊断] ❌ 获取书签树失败: ${err.message}`);
        }

        log('='.repeat(50));

        // 2. 检查待执行的操作
        try {
          const ops = await idbGetAllByIndex("operations", "jobId", activeJob.jobId);
          log(`[诊断] 总操作数: ${ops.length}`);
          log(`[诊断] 已完成: ${ops.filter(o => o.status === 'done').length}`);
          log(`[诊断] 待执行: ${ops.filter(o => o.status === 'pending').length}`);
          log(`[诊断] 已回滚: ${ops.filter(o => o.status === 'rolled_back').length}`);

          // 显示几个失败的操作
          const failed = ops.filter(o => o.status === 'failed' || o.error);
          if (failed.length > 0) {
            log(`[诊断] 失败操作: ${failed.length} 个`);
            failed.slice(0, 3).forEach((op, i) => {
              log(`  ${i + 1}. 书签 ${op.bookmarkId}: ${op.error || 'unknown'}`);
            });
          }

        } catch (err) {
          log(`[诊断] ❌ 检查操作失败: ${err.message}`);
        }

        log('='.repeat(50));

        // 3. 检查创建的文件夹
        if (activeJob.createdFolders && activeJob.createdFolders.length > 0) {
          log(`[诊断] 记录的创建文件夹: ${activeJob.createdFolders.length} 个`);

          for (const folder of activeJob.createdFolders.slice(0, 5)) {
            try {
              const info = await chromeBookmarks.get(folder.id);
              log(`  ✅ ${folder.title} (ID: ${folder.id}) - 存在`);
            } catch (err) {
              log(`  ❌ ${folder.title} (ID: ${folder.id}) - 不存在`);
            }
          }
        } else {
          log('[诊断] 没有记录的创建文件夹');
        }

        log('='.repeat(50));
        log('[诊断] 诊断完成！');
      });

      document.body.appendChild(debugBtn);
      log('[诊断] 已添加"诊断执行问题"按钮（右下角）');
    }
  }, 2000);

})();
