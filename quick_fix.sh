#!/bin/bash
# 快速修复脚本 - 移除新模块引用，恢复到可用状态

cd /Users/ldf/Downloads/ai-bookmark-organizer-v18

# 1. 创建临时修复版 HTML（移除新模块）
cat > sidepanel.html.fixed << 'HTMLEOF'

<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>AI Bookmark Organizer MVP</title>
  <link rel="stylesheet" href="sidepanel.css" />
</head>
<body>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <div class="brand-icon">▱</div>
        <div>
          <h1>AI 书签整理</h1>
          <p>本地优先 · OpenAI 协议 · 增量扫描 · 可回滚整理</p>
        </div>
      </div>

    </header>

    <div class="status-row">
      <span class="live-dot"></span>
      <span id="topStatus">本地服务已就绪</span>
      <span class="pill success">IndexedDB</span>
      <span class="pill">可升级存储</span>
      <span class="pill">v1.8.0</span>
    </div>
HTMLEOF

echo "临时修复文件已创建"
echo "请手动操作："
echo "1. 将 sidepanel.html.fixed 的内容复制到 sidepanel.html"
echo "2. 或者直接在 Chrome 中检查控制台错误信息"
