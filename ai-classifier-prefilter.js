/**
 * AI 书签分类 - URL 预分类模块
 * 基于 URL 信号快速分类，减少 AI 调用
 * v2.0 - 2026-06-07
 */

/**
 * 高置信度域名规则
 * 这些域名可以直接判断分类，无需 AI
 */
const HIGH_CONFIDENCE_DOMAINS = {
  // 代码托管 (0.90-0.95)
  'github.com': { path: ['开发技术', '代码托管'], confidence: 0.93, reason: 'GitHub 代码仓库' },
  'gitlab.com': { path: ['开发技术', '代码托管'], confidence: 0.92, reason: 'GitLab 代码仓库' },
  'gitee.com': { path: ['开发技术', '代码托管'], confidence: 0.91, reason: 'Gitee 代码仓库' },

  // 技术问答
  'stackoverflow.com': { path: ['开发技术', '文档教程'], confidence: 0.92, reason: 'Stack Overflow 技术问答' },
  'segmentfault.com': { path: ['开发技术', '文档教程'], confidence: 0.90, reason: 'SegmentFault 技术社区' },

  // AI 平台
  'openai.com': { path: ['AI 工具', '模型平台'], confidence: 0.96, reason: 'OpenAI 官方' },
  'anthropic.com': { path: ['AI 工具', '模型平台'], confidence: 0.96, reason: 'Anthropic 官方' },
  'huggingface.co': { path: ['AI 工具', '模型平台'], confidence: 0.94, reason: 'Hugging Face 模型库' },
  'replicate.com': { path: ['AI 工具', '模型平台'], confidence: 0.92, reason: 'Replicate AI 平台' },
  'midjourney.com': { path: ['AI 工具', '图像生成'], confidence: 0.95, reason: 'Midjourney AI 绘画' },

  // 设计工具
  'figma.com': { path: ['产品设计', '设计工具'], confidence: 0.95, reason: 'Figma 设计工具' },
  'sketch.com': { path: ['产品设计', '设计工具'], confidence: 0.94, reason: 'Sketch 设计工具' },
  'dribbble.com': { path: ['产品设计', '设计资源'], confidence: 0.93, reason: 'Dribbble 设计灵感' },
  'behance.net': { path: ['产品设计', '设计资源'], confidence: 0.93, reason: 'Behance 设计作品' },
  'unsplash.com': { path: ['产品设计', '设计资源'], confidence: 0.91, reason: 'Unsplash 图片素材' },

  // 文档工具
  'notion.so': { path: ['文档资料', '笔记工具'], confidence: 0.94, reason: 'Notion 笔记' },
  'obsidian.md': { path: ['文档资料', '笔记工具'], confidence: 0.93, reason: 'Obsidian 笔记' },
  'yuque.com': { path: ['文档资料', '笔记工具'], confidence: 0.92, reason: '语雀文档' },
  'feishu.cn': { path: ['文档资料', '协作文档'], confidence: 0.93, reason: '飞书文档' },

  // 云服务
  'vercel.com': { path: ['开发技术', 'DevOps'], confidence: 0.92, reason: 'Vercel 部署平台' },
  'railway.app': { path: ['开发技术', 'DevOps'], confidence: 0.91, reason: 'Railway 部署平台' },
  'supabase.com': { path: ['开发技术', '数据库'], confidence: 0.92, reason: 'Supabase 数据库' },

  // 学习平台
  'coursera.org': { path: ['学习资料', '在线课程'], confidence: 0.93, reason: 'Coursera 在线课程' },
  'udemy.com': { path: ['学习资料', '在线课程'], confidence: 0.93, reason: 'Udemy 在线课程' },
  'freecodecamp.org': { path: ['学习资料', '在线课程'], confidence: 0.92, reason: 'freeCodeCamp 编程学习' },

  // 技术博客
  'csdn.net': { path: ['学习资料', '技术博客'], confidence: 0.91, reason: 'CSDN 技术博客' },
  'cnblogs.com': { path: ['学习资料', '技术博客'], confidence: 0.91, reason: '博客园' },
  'juejin.cn': { path: ['学习资料', '技术博客'], confidence: 0.91, reason: '掘金技术社区' },
  'dev.to': { path: ['学习资料', '技术博客'], confidence: 0.90, reason: 'DEV 技术社区' },

  // 创业社区
  'producthunt.com': { path: ['商业增长', '创业'], confidence: 0.92, reason: 'Product Hunt' },
  'indiehackers.com': { path: ['商业增长', '创业'], confidence: 0.92, reason: 'Indie Hackers' },
  'ycombinator.com': { path: ['商业增长', '创业'], confidence: 0.93, reason: 'Y Combinator' },
};

/**
 * URL 路径模式匹配
 * 基于 URL 路径判断分类
 */
const URL_PATH_PATTERNS = [
  // 文档类
  { pattern: /\/docs?\b|\/documentation\b|\/guide\b|\/api-reference\b/i,
    path: ['开发技术', '文档教程'],
    confidence: 0.82,
    reason: 'URL 包含文档路径'
  },

  // GitHub 仓库细分
  { pattern: /github\.com\/[^/]+\/[^/]+$/i,
    path: ['开发技术', '代码托管'],
    confidence: 0.93,
    reason: 'GitHub 仓库页面'
  },

  // NPM 包
  { pattern: /npmjs\.com\/package\//i,
    path: ['开发技术', '前端开发'],
    confidence: 0.87,
    reason: 'NPM 包页面'
  },

  // PyPI 包
  { pattern: /pypi\.org\/project\//i,
    path: ['开发技术', '后端开发'],
    confidence: 0.87,
    reason: 'PyPI 包页面'
  },

  // Docker Hub
  { pattern: /hub\.docker\.com/i,
    path: ['开发技术', 'DevOps'],
    confidence: 0.89,
    reason: 'Docker Hub'
  },

  // MDN 文档
  { pattern: /developer\.mozilla\.org/i,
    path: ['开发技术', '文档教程'],
    confidence: 0.94,
    reason: 'MDN Web 文档'
  },

  // 教程类
  { pattern: /\/tutorial\b|\/learn\b|\/course\b/i,
    path: ['学习资料', '在线课程'],
    confidence: 0.78,
    reason: 'URL 包含教程路径'
  },

  // 博客文章
  { pattern: /\/blog\b|\/post\b|\/article\b/i,
    path: ['学习资料', '技术博客'],
    confidence: 0.75,
    reason: 'URL 包含博客路径'
  },
];

/**
 * 域名后缀规则
 */
const DOMAIN_SUFFIX_RULES = [
  { suffix: '.dev', path: ['开发技术', '文档教程'], confidence: 0.76, reason: '.dev 域名通常是技术文档' },
  { suffix: '.io', path: ['开发技术', '代码托管'], confidence: 0.68, reason: '.io 域名常用于技术项目' },
  { suffix: '.ai', path: ['AI 工具', 'AI应用'], confidence: 0.72, reason: '.ai 域名通常是 AI 相关' },
];

/**
 * 主预分类函数
 * @param {Object} bookmark - 书签对象 {title, domain, urlPath, url}
 * @param {Array} taxonomyPaths - 可用的分类路径（用于验证）
 * @returns {Object|null} - {path, confidence, reason, method} 或 null
 */
function preclassifyByUrlSignals(bookmark, taxonomyPaths) {
  if (!bookmark || !bookmark.url) return null;

  const domain = (bookmark.domain || '').toLowerCase();
  const urlPath = (bookmark.urlPath || '').toLowerCase();
  const url = (bookmark.url || '').toLowerCase();

  // 1. 高置信度域名匹配（优先级最高）
  if (HIGH_CONFIDENCE_DOMAINS[domain]) {
    return {
      ...HIGH_CONFIDENCE_DOMAINS[domain],
      method: 'prefilter-domain'
    };
  }

  // 2. URL 路径模式匹配
  for (const pattern of URL_PATH_PATTERNS) {
    if (pattern.pattern.test(url) || pattern.pattern.test(urlPath)) {
      return {
        path: pattern.path,
        confidence: pattern.confidence,
        reason: pattern.reason,
        method: 'prefilter-urlpattern'
      };
    }
  }

  // 3. 域名后缀规则
  for (const rule of DOMAIN_SUFFIX_RULES) {
    if (domain.endsWith(rule.suffix)) {
      return {
        path: rule.path,
        confidence: rule.confidence,
        reason: rule.reason,
        method: 'prefilter-suffix'
      };
    }
  }

  // 4. 尝试关键词分类（如果已加载）
  if (typeof classifyByKeywords === 'function') {
    const keywordResult = classifyByKeywords(bookmark, taxonomyPaths);
    if (keywordResult && keywordResult.confidence >= 0.75) {
      return keywordResult;
    }
  }

  // 无法预分类，返回 null 让 AI 处理
  return null;
}

/**
 * 批量预分类
 * @param {Array} bookmarks - 书签数组
 * @param {Array} taxonomyPaths - 可用的分类路径
 * @returns {Object} - {preclassified: Array, needsAI: Array}
 */
function batchPreclassify(bookmarks, taxonomyPaths) {
  const preclassified = [];
  const needsAI = [];

  for (const bookmark of bookmarks) {
    const result = preclassifyByUrlSignals(bookmark, taxonomyPaths);

    if (result && result.confidence >= 0.80) {
      // 高置信度，直接使用
      preclassified.push({
        bookmark,
        classification: result
      });
    } else if (result && result.confidence >= 0.65) {
      // 中等置信度，提供给 AI 作为参考
      needsAI.push({
        bookmark,
        suggestedClassification: result
      });
    } else {
      // 低置信度或无法分类，完全交给 AI
      needsAI.push({
        bookmark,
        suggestedClassification: null
      });
    }
  }

  return { preclassified, needsAI };
}

/**
 * 获取预分类统计
 */
function getPreclassificationStats(bookmarks, taxonomyPaths) {
  const { preclassified, needsAI } = batchPreclassify(bookmarks, taxonomyPaths);

  return {
    total: bookmarks.length,
    preclassified: preclassified.length,
    needsAI: needsAI.length,
    preclassifiedRate: ((preclassified.length / bookmarks.length) * 100).toFixed(1) + '%',
    breakdown: {
      highConfidence: preclassified.filter(p => p.classification.confidence >= 0.90).length,
      mediumConfidence: preclassified.filter(p => p.classification.confidence >= 0.80 && p.classification.confidence < 0.90).length,
    }
  };
}

// 导出（浏览器环境）
if (typeof window !== 'undefined') {
  window.HIGH_CONFIDENCE_DOMAINS = HIGH_CONFIDENCE_DOMAINS;
  window.preclassifyByUrlSignals = preclassifyByUrlSignals;
  window.batchPreclassify = batchPreclassify;
  window.getPreclassificationStats = getPreclassificationStats;
}
