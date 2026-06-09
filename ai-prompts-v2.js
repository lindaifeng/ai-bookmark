/**
 * AI 书签分类 - 优化的 Prompt 模板
 * v2.0 - 2026-06-07
 */

/**
 * 生成分类体系的 Prompt（优化版）
 */
function generateTaxonomyPromptV2(bookmarks, topCategoryCount = 8) {
  const summary = summarizeBookmarksForTaxonomy(bookmarks);

  return `你是一个专业的信息架构师。请根据用户的浏览器书签数据，设计一个清晰、实用的分类体系。

# 任务目标
为 ${bookmarks.length} 个书签设计 ${topCategoryCount} 个左右的一级分类，每个一级分类下包含 2-4 个二级分类。

# 设计原则
1. **基于实际内容**：优先分析书签的域名、URL 路径，而非仅看标题
2. **细分到位**：技术类书签要细分（前端/后端/DevOps/数据库等）
3. **平衡数量**：每个一级分类下至少有 2 个二级分类
4. **实用性优先**：分类名称要清晰易懂，便于后续查找
5. **包含兜底**：必须包含 ["待确认"] 分类，用于极少数无法判断的书签

# 书签数据摘要
${JSON.stringify(summary, null, 2)}

# 输出格式
返回 JSON 格式的分类体系：
{
  "categories": [
    {
      "path": ["开发技术", "前端开发"],
      "description": "React、Vue 等前端框架和工具"
    },
    {
      "path": ["开发技术", "后端开发"],
      "description": "Spring、Django 等后端框架"
    },
    ...
  ]
}

# 示例分析
如果书签中包含大量 github.com/*/react-*，应该创建：
- ["开发技术", "前端开发"] 而非泛泛的 ["技术"]
- ["开发技术", "代码托管"] 用于 GitHub 仓库链接

如果包含 openai.com, anthropic.com，应该创建：
- ["AI 工具", "模型平台"] 而非 ["工具"]

# 重要提醒
- 一级分类数量控制在 ${topCategoryCount} 个左右（6-10 个）
- 避免创建"其他"、"未分类"等模糊分类
- 每个二级分类要有明确的边界
- 必须包含 ["待确认"] 作为兜底

现在请生成分类体系。`;
}

/**
 * 分类批次的 Prompt（优化版）
 */
function generateClassificationPromptV2(bookmarks, taxonomyPaths, batchId, strategy = 'aggressive') {
  const strategyInstructions = getStrategyInstructions(strategy);

  return `你是一个专业的书签分类助手。请对以下书签进行精确分类。

# 核心原则
**优先使用 domain 和 urlPath 判断，title 可能不准确！**

# 分类思路和置信度标准

## 1. 技术开发类（开发技术）
**判断依据**：
- 域名：github.com/*, gitlab.com/*, docs.*.*, *.dev, stackoverflow.com, npmjs.com
- URL 路径：/docs/, /api/, /guide/, /tutorial/, /documentation/
- 关键词：react, vue, python, java, spring, docker, kubernetes

**置信度标准**：
- 0.90+：域名完全匹配（如 github.com/facebook/react）
- 0.80-0.90：域名 + 路径匹配（如 某站点/docs/api）
- 0.70-0.80：域名或标题明确包含技术关键词
- 0.60-0.70：可以从上下文推断

**示例**：
✅ 输入：{domain: "github.com", path: "/vercel/next.js", title: "Next.js"}
   输出：{categoryPath: ["开发技术", "前端开发"], confidence: 0.93}

✅ 输入：{domain: "react.dev", path: "/learn", title: "Learn React"}
   输出：{categoryPath: ["开发技术", "文档教程"], confidence: 0.91}

## 2. AI 工具类
**判断依据**：
- 域名：openai.com, anthropic.com, huggingface.co, midjourney.com
- 关键词：chatgpt, claude, gemini, prompt, llm, stable-diffusion

**置信度标准**：
- 0.95+：官方域名（openai.com, anthropic.com）
- 0.85-0.95：明确的 AI 服务域名
- 0.70-0.85：标题包含 AI、GPT、模型等关键词

**示例**：
✅ 输入：{domain: "openai.com", path: "/chatgpt", title: "ChatGPT"}
   输出：{categoryPath: ["AI 工具", "对话模型"], confidence: 0.98}

✅ 输入：{domain: "huggingface.co", path: "/models", title: "Models"}
   输出：{categoryPath: ["AI 工具", "模型平台"], confidence: 0.94}

## 3. 产品设计类
**判断依据**：
- 域名：figma.com, dribbble.com, behance.net, unsplash.com
- 关键词：design, ui, ux, figma, sketch

**置信度标准**：
- 0.93+：设计工具官网
- 0.80-0.93：设计资源站点

## 4. 待确认类
**使用条件**（必须同时满足以下所有条件）：
1. 域名完全陌生（不在任何已知类别中）
2. 标题无法提供有效信息
3. URL 路径没有任何线索
4. 完全无法推断用途

**置信度**：< 0.50

${strategyInstructions}

# 分类规则
1. **必须为每个书签返回分类**：bookmarkId 必须与输入完全对应
2. **优先二级/三级分类**：除非 taxonomyPaths 只有一级，否则必须返回二级分类
3. **选择最接近的分类**：即使不完美匹配，也要选择最相关的分类，不要轻易使用"待确认"
4. **标题规范化**：suggestedTitle 要简洁（6-18个中文字符），去掉网站名、冗余后缀
5. **action 选择**：
   - move：分类但不改标题
   - move_and_rename：分类且标题需要优化
   - needs_review：仅用于"待确认"

# 可用分类路径
${JSON.stringify(taxonomyPaths, null, 2)}

# 待分类书签
${JSON.stringify(bookmarks.map(compactBookmarkForAI), null, 2)}

# 输出格式
{
  "batchId": "${batchId}",
  "items": [
    {
      "bookmarkId": "书签ID（必须与输入完全一致）",
      "suggestedTitle": "精简后的标题",
      "categoryPath": ["一级分类", "二级分类"],
      "confidence": 0.85,
      "action": "move_and_rename",
      "reason": "GitHub 前端框架仓库"
    }
  ]
}

现在请开始分类，记住：**优先看域名和 URL，不要被标题误导！**`;
}

/**
 * 低置信度增强分类的 Prompt（优化版）
 */
function generateEnrichmentPromptV2(items, taxonomyPaths, batchId) {
  return `你是一个仔细的书签分类专家。以下书签在第一轮分类中置信度较低，现在插件已经访问了网页并提取了页面信息。

# 任务
基于完整的页面信息重新分类，提高准确率。

# 重新分类策略
1. **优先使用页面信息**：
   - 页面 title（比书签标题更准确）
   - meta description（了解页面内容）
   - H1/H2 标题（页面结构）
   - 正文摘要（核心内容）

2. **结合原有信息**：
   - URL 域名和路径仍然很重要
   - 如果页面信息缺失（访问失败），回退到 URL 分析

3. **提高置信度**：
   - 有页面信息支持时，置信度应该提高 0.1-0.2
   - 如果页面信息和 URL 一致，置信度可达 0.85+

# 页面信息解读示例

✅ 场景 1：技术文档
输入：{
  domain: "unknown-docs.com",
  pageInfo: {
    title: "React Hooks API Reference",
    description: "Comprehensive guide to React Hooks",
    headings: ["useState", "useEffect", "useContext"]
  }
}
输出：{categoryPath: ["开发技术", "文档教程"], confidence: 0.87}

✅ 场景 2：AI 工具
输入：{
  domain: "newai.app",
  pageInfo: {
    title: "AI Image Generator",
    description: "Generate images with AI",
    keywords: "stable diffusion, text to image"
  }
}
输出：{categoryPath: ["AI 工具", "图像生成"], confidence: 0.85}

✅ 场景 3：访问失败但 URL 有线索
输入：{
  domain: "example-framework.dev",
  urlPath: "/docs/getting-started",
  pageInfo: {ok: false, error: "HTTP 404"}
}
输出：{categoryPath: ["开发技术", "文档教程"], confidence: 0.72, reason: ".dev 域名 + /docs/ 路径"}

# 重要规则
1. **页面信息访问失败不等于放入待确认**：即使无法访问，也要结合 URL、域名、原标题推断
2. **提高置信度**：有页面信息支持的分类，confidence >= 0.75
3. **仍不确定的才用待确认**：只有真正无法判断时才使用 ["待确认"]，confidence < 0.5

# 可用分类路径
${JSON.stringify(taxonomyPaths, null, 2)}

# 待重新分类的书签（包含页面信息）
${JSON.stringify(items, null, 2)}

# 输出格式
{
  "batchId": "${batchId}",
  "items": [
    {
      "bookmarkId": "书签ID",
      "suggestedTitle": "精简标题",
      "categoryPath": ["一级", "二级"],
      "confidence": 0.85,
      "action": "move",
      "reason": "基于页面 title 和 description 判断为技术文档"
    }
  ]
}

现在请重新分类。`;
}

/**
 * 获取分类策略说明
 */
function getStrategyInstructions(strategy) {
  const instructions = {
    conservative: `
# 当前策略：保守（Conservative）
- 只有非常确定时才归类（confidence >= 0.75）
- 但如果能从 URL、域名、页面信息推断，也应该给出最接近的分类
- 待确认率应该控制在 15-20%`,

    balanced: `
# 当前策略：平衡（Balanced）
- 60% 左右的把握就归入最接近的分类（confidence >= 0.60）
- 避免大量使用待确认
- 待确认率应该控制在 10-15%`,

    aggressive: `
# 当前策略：积极（Aggressive）
- 目标：最大化自动分类，最小化待确认
- 只要能从 URL、域名、页面信息或同域名规律推断，就必须归入最接近的分类
- 待确认仅用于极少数情况（< 5%）
- 即使只有 50% 把握，也优先给出最相关的分类，而不是待确认`
  };

  return instructions[strategy] || instructions.aggressive;
}

/**
 * 压缩书签信息用于 AI 输入
 */
function compactBookmarkForAI(bookmark) {
  return {
    id: String(bookmark.id),
    title: String(bookmark.title || '').slice(0, 120),
    domain: bookmark.domain || '',
    path: bookmark.urlPath || '',
    currentFolder: (bookmark.currentFolderPath || []).join(' > ')
  };
}

/**
 * 总结书签数据用于生成分类体系
 */
function summarizeBookmarksForTaxonomy(bookmarks) {
  // 域名统计
  const domainCount = {};
  bookmarks.forEach(b => {
    const domain = b.domain || 'unknown';
    domainCount[domain] = (domainCount[domain] || 0) + 1;
  });

  const topDomains = Object.entries(domainCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([domain, count]) => ({ domain, count }));

  // 关键词提取（简单版）
  const keywords = {};
  bookmarks.forEach(b => {
    const text = `${b.title} ${b.domain}`.toLowerCase();
    ['github', 'react', 'vue', 'python', 'openai', 'figma', 'design', 'ai', 'docs'].forEach(kw => {
      if (text.includes(kw)) {
        keywords[kw] = (keywords[kw] || 0) + 1;
      }
    });
  });

  return {
    totalBookmarks: bookmarks.length,
    topDomains,
    keywords: Object.entries(keywords).sort((a, b) => b[1] - a[1]).slice(0, 15),
    sampleBookmarks: bookmarks.slice(0, 50).map(compactBookmarkForAI)
  };
}

// 导出
if (typeof window !== 'undefined') {
  window.generateTaxonomyPromptV2 = generateTaxonomyPromptV2;
  window.generateClassificationPromptV2 = generateClassificationPromptV2;
  window.generateEnrichmentPromptV2 = generateEnrichmentPromptV2;
}
