# AI Bookmark Organizer

> 🚀 AI 智能书签整理 — 自动分类、去重、可回滚

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/lindaifeng/ai-bookmark)
[![Chrome](https://img.shields.io/badge/Chrome-114+-green.svg)](https://www.google.com/chrome/)

一个 Chrome 扩展，使用 AI 自动整理和分类你的浏览器书签。

---

## ✨ 功能特性

| 功能 | 说明 |
|------|------|
| **智能预分类** | 关键词 + 域名规则，40% 书签无需 AI 即可分类 |
| **AI 分类** | 支持 OpenAI 兼容接口（GPT-4、Claude、Ollama 等） |
| **自动去重** | 检测并移除重复书签 |
| **可回滚** | 整理不满意？一键恢复原状 |
| **备份书签** | 导出标准 HTML 格式，可在任意浏览器导入 |
| **文件夹模式** | 可在指定文件夹内整理，或全量整理 |

---

## 🛠️ 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目文件夹

---

## 🎮 使用

1. **扫描** — 点击「重新扫描」读取书签
2. **分类** — 点击「重新智能分类」，AI 自动生成分类方案
3. **预览** — 查看分类体系和最终结构，可手动编辑
4. **执行** — 点击「执行整理」，书签自动移动
5. **回滚** — 不满意？点击「回滚」一键恢复

---

## ⚙️ 配置

| 选项 | 说明 | 推荐值 |
|------|------|--------|
| Base URL | API 端点 | `https://api.openai.com/v1` |
| API Key | 你的 API Key | `sk-...` |
| Model | 模型名称 | `gpt-4o-mini` |
| 分类策略 | 控制待确认比例 | 积极 |
| 自动执行阈值 | 置信度门槛 | `0.75` |

---

## 📁 项目结构

```
ai-bookmark/
├── sidepanel.html           # 主界面
├── sidepanel.js             # 核心逻辑
├── sidepanel.css            # 样式
├── sidepanel-v2.css         # 美化样式
├── background.js            # Service Worker
├── manifest.json            # 扩展配置
├── ai-classifier-keywords.js    # 关键词库
├── ai-classifier-prefilter.js   # 预分类引擎
├── ai-prompts-v2.js             # AI Prompt 模板
├── patches-core.js              # 功能/UI 补丁
├── patches-execution.js         # 执行/回滚补丁
└── README.md
```

---

## 🔒 数据安全

- ✅ 所有数据存储在本地（IndexedDB）
- ✅ API Key 存储在 Chrome Storage
- ✅ 只在分类时临时发送书签标题和 URL
- ✅ 不上传完整书签内容

---

## 📄 License

MIT
