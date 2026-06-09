# 后台任务持续性问题分析与解决方案

## 📋 问题描述

**当前行为**：
1. 用户点击"智能整理分类"开始分类
2. 分类过程中关闭侧边栏
3. 再次打开侧边栏，需要重新扫描

**期望行为**：
1. 关闭侧边栏后，分类任务在后台继续
2. 或者，任务自动暂停，再次打开时显示"继续分类"按钮
3. 不需要重新扫描

---

## 🔍 当前实现分析

### 1. 任务状态存储

**已实现**：✅ 
- 任务状态保存在 IndexedDB（`jobs` 表）
- 活跃任务 ID 保存在 Chrome Storage（`activeJobId`）
- 扫描快照保存（`snapshots` 表）
- 分类建议保存（`suggestions` 表）

**代码位置**：
```javascript
// sidepanel.js:670
async function restoreActiveJob() {
  const res = await chromeStorage.get(["activeJobId"]);
  if (!res.activeJobId) return;
  const job = await idbGet("jobs", res.activeJobId);
  if (!job) return;
  
  activeJob = { taxonomyConfirmed: false, ...job };
  const snapshot = await idbGet("snapshots", job.jobId);
  activeBookmarks = snapshot?.flat || [];
  // ... 恢复 UI
}
```

### 2. 任务恢复逻辑

**已实现**：✅
- `init()` 时调用 `restoreActiveJob()`
- 恢复任务状态、书签数据、UI 显示
- 恢复分类体系和分类结果

**问题**：❌
- 恢复后，按钮状态不对
- 没有明确提示用户"继续分类"
- 如果任务状态是 `paused`，应该显示"恢复分类"按钮

### 3. 后台任务执行

**当前限制**：❌
- 所有分类逻辑都在 `sidepanel.js` 中
- Side Panel 关闭后，JS 执行上下文销毁
- 无法在后台继续执行 AI 分类

**Chrome 扩展限制**：
- Side Panel 是临时上下文，关闭即销毁
- Service Worker（background.js）可以后台运行，但有生命周期限制
- 长时间运行任务需要特殊处理

---

## 💡 解决方案

### 方案 A：自动恢复 + 提示继续（推荐）⭐

**优点**：
- 实现简单
- 用户体验好
- 不改变现有架构

**实现**：
1. 关闭侧边栏时，自动暂停任务
2. 再次打开时，检测到 `paused` 状态
3. 显示明显的"继续分类"提示
4. 用户点击后，从上次中断的地方继续

**需要修改**：
```javascript
// 1. 检测侧边栏关闭（使用 visibilitychange）
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    // 侧边栏被隐藏，暂停任务
    stopRequested = true;
    pendingPause = true;
    log('[自动暂停] 检测到侧边栏关闭，任务已暂停');
  }
});

// 2. 恢复时显示明显提示
async function restoreActiveJob() {
  // ... 现有代码 ...
  
  if (activeJob.status === 'paused' || activeJob.status === 'classifying') {
    log(`[恢复任务] 检测到未完成的分类任务，点击"恢复分类"继续`);
    // 显示醒目提示
    showResumeNotification();
  }
}

function showResumeNotification() {
  const notification = document.createElement('div');
  notification.className = 'resume-notification';
  notification.innerHTML = `
    <strong>⚠️ 检测到未完成的分类任务</strong>
    <p>上次分类进度：${activeJob.processedBookmarks}/${activeJob.totalBookmarks}</p>
    <button onclick="resumeClassification()">立即继续</button>
    <button onclick="cancelJob()">取消任务</button>
  `;
  document.body.prepend(notification);
}
```

---

### 方案 B：Service Worker 后台分类（复杂）

**优点**：
- 真正的后台执行
- 关闭侧边栏也能继续

**缺点**：
- 实现复杂度高
- Service Worker 有生命周期限制（30秒无活动会休眠）
- 需要大量重构

**实现要点**：
1. 将分类逻辑移到 `background.js`
2. 使用 Chrome Message Passing 通信
3. 侧边栏只负责 UI 显示
4. Service Worker 定期唤醒继续任务

**不推荐原因**：
- Service Worker 会在 30 秒无活动后休眠
- 长时间 AI 分类任务会被中断
- 需要实现复杂的任务队列和唤醒机制

---

### 方案 C：混合方案（最佳）⭐⭐⭐

**结合 A 和 B 的优点**：

1. **短时间关闭（< 5 分钟）**：
   - 自动暂停，保存状态
   - 再次打开时，显示"继续分类"
   - 从上次位置继续

2. **长时间关闭（> 5 分钟）**：
   - 任务自动标记为 `paused`
   - 提示用户："检测到未完成任务，是否继续？"

3. **关闭前提示**：
   - 检测侧边栏即将关闭
   - 弹出确认："分类进行中，确定要关闭吗？"
   - 用户可以选择："后台继续" 或 "暂停任务"

---

## 🚀 推荐实现：方案 A（自动暂停 + 恢复提示）

### 优点
- ✅ 不需要大改架构
- ✅ 用户体验友好
- ✅ 数据不丢失
- ✅ 实现简单，风险低

### 实现步骤

#### 步骤 1：监听侧边栏关闭
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    handlePanelHidden();
  } else {
    handlePanelVisible();
  }
});

function handlePanelHidden() {
  if (running && activeJob) {
    stopRequested = true;
    pendingPause = true;
    log('[自动暂停] 检测到侧边栏关闭，分类任务已暂停');
    // 保存当前状态
    if (activeJob) {
      activeJob.status = 'paused';
      activeJob.pausedAt = Date.now();
      idbPut('jobs', activeJob);
    }
  }
}

function handlePanelVisible() {
  log('[侧边栏已打开] 检查是否有未完成任务...');
  checkAndPromptResume();
}
```

#### 步骤 2：恢复时显示提示
```javascript
async function checkAndPromptResume() {
  if (!activeJob) return;
  
  const pausedStates = ['paused', 'classifying'];
  if (pausedStates.includes(activeJob.status)) {
    const progress = activeJob.processedBookmarks || 0;
    const total = activeJob.totalBookmarks || 0;
    const percent = total > 0 ? ((progress / total) * 100).toFixed(1) : 0;
    
    log(`⚠️ 检测到未完成的分类任务（进度：${percent}%）`);
    log(`上次暂停时间：${new Date(activeJob.pausedAt || activeJob.updatedAt).toLocaleString()}`);
    log(`点击"恢复分类"继续，或点击"取消任务"清除`);
    
    // 更新按钮状态
    setButtons();
    
    // 可选：显示浮动提示
    showFloatingPrompt();
  }
}

function showFloatingPrompt() {
  const existingPrompt = document.querySelector('.resume-prompt');
  if (existingPrompt) existingPrompt.remove();
  
  const prompt = document.createElement('div');
  prompt.className = 'resume-prompt';
  prompt.style.cssText = `
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #fbbf24, #f59e0b);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 9999;
    animation: slideDown 0.3s ease;
  `;
  
  prompt.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px;">
      ⚠️ 检测到未完成的分类任务
    </div>
    <div style="font-size: 13px; margin-bottom: 12px;">
      进度：${activeJob.processedBookmarks}/${activeJob.totalBookmarks} 
      (${((activeJob.processedBookmarks/activeJob.totalBookmarks)*100).toFixed(1)}%)
    </div>
    <div style="display: flex; gap: 8px;">
      <button onclick="resumeClassification(); this.closest('.resume-prompt').remove();" 
              style="background: white; color: #f59e0b; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold;">
        立即继续
      </button>
      <button onclick="cancelCurrentJob(); this.closest('.resume-prompt').remove();" 
              style="background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 8px 16px; border-radius: 8px; cursor: pointer;">
        取消任务
      </button>
    </div>
  `;
  
  document.body.appendChild(prompt);
  
  // 5秒后自动消失
  setTimeout(() => {
    if (prompt.parentNode) prompt.remove();
  }, 8000);
}

function cancelCurrentJob() {
  if (confirm('确定要取消当前分类任务吗？扫描的书签数据会保留，但分类结果会丢失。')) {
    if (activeJob) {
      activeJob.status = 'cancelled';
      idbPut('jobs', activeJob);
    }
    activeJob = null;
    chromeStorage.remove(['activeJobId']);
    setButtons();
    log('[任务已取消] 可以重新开始扫描和分类');
  }
}
```

#### 步骤 3：改进按钮状态显示
```javascript
function setButtons() {
  // ... 现有代码 ...
  
  // 改进"智能整理分类"按钮文本
  if (activeJob && activeJob.status === 'paused') {
    $("classifyToggleBtn").textContent = "⏯️ 恢复分类";
    $("classifyToggleBtn").classList.add('btn-resume');
  } else if (running) {
    $("classifyToggleBtn").textContent = "⏸️ 暂停分类";
  } else {
    $("classifyToggleBtn").textContent = "🤖 智能整理分类";
  }
}
```

---

## 📊 改进效果

### 改进前（当前）
```
1. 用户：开始分类
2. 系统：正在分类中...
3. 用户：关闭侧边栏
4. 系统：任务丢失
5. 用户：再次打开
6. 系统：显示空白，需要重新扫描 ❌
```

### 改进后
```
1. 用户：开始分类
2. 系统：正在分类中...
3. 用户：关闭侧边栏
4. 系统：自动暂停，保存状态 ✅
5. 用户：再次打开
6. 系统：显示"检测到未完成任务，是否继续？" ✅
7. 用户：点击"继续"
8. 系统：从上次位置继续分类 ✅
```

---

## 🎯 实施计划

**优先级 P0（立即实现）**：
1. ✅ 监听 `visibilitychange` 事件
2. ✅ 侧边栏关闭时自动暂停
3. ✅ 恢复时显示明显提示

**优先级 P1（v2.1）**：
1. 显示浮动提示框
2. 增加"取消任务"按钮
3. 改进按钮文本和样式

**优先级 P2（未来）**：
1. Service Worker 后台分类（如果需要）
2. 任务进度通知
3. 多任务管理

---

## 💡 用户指南

**如何处理未完成的任务？**

1. **继续分类**：
   - 再次打开侧边栏
   - 点击"恢复分类"按钮
   - 从上次位置继续

2. **取消任务**：
   - 点击"取消任务"
   - 确认后任务清除
   - 可以重新开始

3. **查看进度**：
   - 日志中会显示上次进度
   - 如：`进度：250/1000 (25%)`

---

**现在要实现这个改进吗？** 🚀

我可以立即创建补丁脚本，添加：
- ✅ 自动暂停功能
- ✅ 恢复提示
- ✅ 改进的按钮状态
