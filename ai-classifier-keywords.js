/**
 * AI 书签分类 - 扩展关键词库
 * 用于兜底分类和预分类
 * v2.0 - 2026-06-07
 */

const KEYWORD_RULES = {
  // 开发技术类
  dev: {
    primary: ['开发技术'],
    categories: {
      // 前端开发
      frontend: {
        path: ['开发技术', '前端开发'],
        keywords: [
          'react', 'vue', 'angular', 'svelte', 'solid', 'preact',
          'nextjs', 'nuxtjs', 'gatsby', 'remix', 'astro',
          'webpack', 'vite', 'rollup', 'parcel', 'esbuild',
          'typescript', 'javascript', 'jsx', 'tsx',
          'tailwind', 'css', 'sass', 'scss', 'styled-components',
          'frontend', 'web development', '前端', 'ui框架'
        ],
        domains: ['reactjs.org', 'vuejs.org', 'angular.io', 'svelte.dev']
      },

      // 后端开发
      backend: {
        path: ['开发技术', '后端开发'],
        keywords: [
          'spring', 'springboot', 'django', 'flask', 'fastapi',
          'express', 'nestjs', 'koa', 'hapi',
          'golang', 'go语言', 'rust', 'java', 'python', 'nodejs',
          'api', 'restful', 'graphql', 'grpc',
          'backend', 'server', '后端', '服务端'
        ],
        domains: ['spring.io', 'djangoproject.com', 'flask.palletsprojects.com']
      },

      // DevOps 和云服务
      devops: {
        path: ['开发技术', 'DevOps'],
        keywords: [
          'docker', 'kubernetes', 'k8s', 'helm',
          'jenkins', 'gitlab-ci', 'github-actions', 'circleci',
          'ansible', 'terraform', 'pulumi',
          'aws', 'azure', 'gcp', 'cloud',
          'vercel', 'netlify', 'railway', 'render', 'fly.io',
          'devops', 'ci/cd', 'deployment', '部署', '容器'
        ],
        domains: ['docker.com', 'kubernetes.io', 'vercel.com', 'railway.app']
      },

      // 数据库
      database: {
        path: ['开发技术', '数据库'],
        keywords: [
          'postgres', 'postgresql', 'mysql', 'mariadb',
          'mongodb', 'redis', 'elasticsearch', 'clickhouse',
          'supabase', 'planetscale', 'neon', 'railway',
          'database', 'sql', 'nosql', '数据库'
        ],
        domains: ['postgresql.org', 'mongodb.com', 'redis.io', 'supabase.com']
      },

      // 代码托管
      repository: {
        path: ['开发技术', '代码托管'],
        keywords: [
          'github', 'gitlab', 'gitee', 'bitbucket',
          'git', 'repo', 'repository', '仓库', '开源'
        ],
        domains: ['github.com', 'gitlab.com', 'gitee.com']
      },

      // 文档教程
      documentation: {
        path: ['开发技术', '文档教程'],
        keywords: [
          'docs', 'documentation', 'tutorial', 'guide',
          'api reference', 'getting started',
          'mdn', 'stackoverflow', 'dev.to', 'medium',
          '文档', '教程', '手册'
        ],
        domains: ['developer.mozilla.org', 'stackoverflow.com', 'dev.to'],
        urlPatterns: ['/docs/', '/documentation/', '/guide/', '/tutorial/']
      }
    }
  },

  // AI 工具类
  ai: {
    primary: ['AI 工具'],
    categories: {
      // AI 模型平台
      models: {
        path: ['AI 工具', '模型平台'],
        keywords: [
          'openai', 'anthropic', 'claude', 'chatgpt', 'gpt',
          'gemini', 'bard', 'llama', 'mistral', 'cohere',
          'huggingface', 'replicate', 'together', 'fireworks',
          'model', 'llm', 'language model', '模型', '大模型'
        ],
        domains: [
          'openai.com', 'anthropic.com', 'gemini.google.com',
          'huggingface.co', 'replicate.com', 'together.ai'
        ]
      },

      // AI 图像生成
      image: {
        path: ['AI 工具', '图像生成'],
        keywords: [
          'midjourney', 'stable-diffusion', 'dall-e', 'leonardo',
          'runway', 'pika', 'gen-2',
          'image generation', 'text-to-image', '图像生成', 'ai绘画'
        ],
        domains: ['midjourney.com', 'leonardo.ai', 'runwayml.com']
      },

      // Prompt 和 Agent
      prompts: {
        path: ['AI 工具', 'Prompt工具'],
        keywords: [
          'prompt', 'langchain', 'llamaindex',
          'semantic-kernel', 'autogpt', 'agent',
          'prompt engineering', 'prompt库', '提示词'
        ],
        domains: ['langchain.com', 'llamaindex.ai']
      },

      // AI 应用
      applications: {
        path: ['AI 工具', 'AI应用'],
        keywords: [
          'cursor', 'copilot', 'tabnine', 'codeium',
          'notion ai', 'jasper', 'copy.ai',
          'ai assistant', 'ai tool', 'ai应用'
        ],
        domains: ['cursor.sh', 'github.com/features/copilot', 'codeium.com']
      }
    }
  },

  // 产品设计类
  design: {
    primary: ['产品设计'],
    categories: {
      // 设计工具
      tools: {
        path: ['产品设计', '设计工具'],
        keywords: [
          'figma', 'sketch', 'adobe xd', 'framer',
          'canva', 'pixso', '即时设计',
          'design tool', 'ui design', '设计工具'
        ],
        domains: ['figma.com', 'sketch.com', 'framer.com', 'canva.com']
      },

      // 设计资源
      resources: {
        path: ['产品设计', '设计资源'],
        keywords: [
          'dribbble', 'behance', 'pinterest',
          'unsplash', 'pexels', 'iconfont', 'iconify', 'flaticon',
          'design inspiration', 'ui inspiration', '设计灵感', '图标'
        ],
        domains: ['dribbble.com', 'behance.net', 'unsplash.com', 'iconfont.cn']
      },

      // UX 研究
      ux: {
        path: ['产品设计', 'UX设计'],
        keywords: [
          'ux', 'user experience', 'usability',
          'user research', 'interaction design',
          '用户体验', '交互设计', '可用性'
        ]
      }
    }
  },

  // 商业增长类
  business: {
    primary: ['商业增长'],
    categories: {
      // 创业
      startup: {
        path: ['商业增长', '创业'],
        keywords: [
          'startup', 'entrepreneur', 'indie hacker',
          'product hunt', 'y combinator', 'vc',
          '创业', '创业公司', '独立开发'
        ],
        domains: ['producthunt.com', 'indiehackers.com', 'ycombinator.com']
      },

      // 营销增长
      marketing: {
        path: ['商业增长', '营销增长'],
        keywords: [
          'marketing', 'growth', 'seo', 'sem',
          'content marketing', 'email marketing',
          'analytics', 'conversion',
          '营销', '增长', '获客', '转化'
        ],
        domains: ['hubspot.com', 'mailchimp.com', 'google.com/analytics']
      },

      // SaaS
      saas: {
        path: ['商业增长', 'SaaS'],
        keywords: [
          'saas', 'b2b', 'subscription',
          'pricing', 'monetization',
          'saas工具', '订阅'
        ]
      }
    }
  },

  // 学习资料类
  learning: {
    primary: ['学习资料'],
    categories: {
      // 在线课程
      courses: {
        path: ['学习资料', '在线课程'],
        keywords: [
          'course', 'tutorial', 'learning',
          'udemy', 'coursera', 'edx', 'freecodecamp',
          '课程', '教程', '学习'
        ],
        domains: ['udemy.com', 'coursera.org', 'freecodecamp.org']
      },

      // 技术博客
      blogs: {
        path: ['学习资料', '技术博客'],
        keywords: [
          'blog', 'article', 'post',
          'csdn', 'cnblogs', 'juejin', 'segmentfault',
          '博客', '文章', '掘金'
        ],
        domains: ['csdn.net', 'cnblogs.com', 'juejin.cn', 'segmentfault.com']
      }
    }
  },

  // 文档资料类
  documents: {
    primary: ['文档资料'],
    categories: {
      // 笔记工具
      notes: {
        path: ['文档资料', '笔记工具'],
        keywords: [
          'notion', 'obsidian', 'logseq', 'roam',
          'evernote', 'onenote',
          'yuque', 'feishu', 'lark',
          '语雀', '飞书', '笔记', '知识库'
        ],
        domains: ['notion.so', 'obsidian.md', 'yuque.com', 'feishu.cn']
      },

      // 文档协作
      collaboration: {
        path: ['文档资料', '协作文档'],
        keywords: [
          'google docs', 'microsoft office', 'wps',
          'confluence', 'wiki',
          '文档', '协作', 'wiki'
        ],
        domains: ['docs.google.com', 'office.com', 'atlassian.com']
      }
    }
  },

  // 生活服务类
  lifestyle: {
    primary: ['生活服务'],
    categories: {
      // 常用工具
      tools: {
        path: ['生活服务', '常用工具'],
        keywords: [
          'tool', 'utility', 'converter',
          'calendar', 'email', 'weather',
          '工具', '实用工具', '日历', '邮箱'
        ]
      },

      // 娱乐
      entertainment: {
        path: ['生活服务', '娱乐'],
        keywords: [
          'youtube', 'bilibili', 'netflix', 'spotify',
          'music', 'video', 'game',
          '娱乐', '音乐', '视频', '游戏'
        ],
        domains: ['youtube.com', 'bilibili.com', 'spotify.com']
      }
    }
  }
};

/**
 * 基于关键词规则进行分类
 * @param {Object} bookmark - 书签对象 {title, domain, urlPath, url}
 * @param {Array} taxonomyPaths - 可用的分类路径
 * @returns {Object|null} - {path: Array, confidence: Number, reason: String} 或 null
 */
function classifyByKeywords(bookmark, taxonomyPaths) {
  const text = [
    bookmark.title || '',
    bookmark.domain || '',
    bookmark.urlPath || '',
    bookmark.url || ''
  ].join(' ').toLowerCase();

  // 遍历所有规则
  for (const [categoryKey, categoryData] of Object.entries(KEYWORD_RULES)) {
    for (const [subKey, subData] of Object.entries(categoryData.categories || {})) {
      let matchCount = 0;
      let matchedKeywords = [];

      // 检查域名匹配（高权重）
      if (subData.domains) {
        for (const domain of subData.domains) {
          if (bookmark.domain && bookmark.domain.includes(domain)) {
            return {
              path: subData.path,
              confidence: 0.92,
              reason: `域名匹配: ${domain}`,
              method: 'keyword-domain'
            };
          }
        }
      }

      // 检查 URL 模式匹配
      if (subData.urlPatterns && bookmark.urlPath) {
        for (const pattern of subData.urlPatterns) {
          if (bookmark.urlPath.includes(pattern)) {
            return {
              path: subData.path,
              confidence: 0.85,
              reason: `URL路径匹配: ${pattern}`,
              method: 'keyword-urlpattern'
            };
          }
        }
      }

      // 检查关键词匹配
      if (subData.keywords) {
        for (const keyword of subData.keywords) {
          if (text.includes(keyword.toLowerCase())) {
            matchCount++;
            matchedKeywords.push(keyword);
            if (matchCount >= 2) break;
          }
        }
      }

      // 多个关键词匹配，较高置信度
      if (matchCount >= 2) {
        return {
          path: subData.path,
          confidence: 0.78,
          reason: `关键词匹配: ${matchedKeywords.slice(0, 2).join(', ')}`,
          method: 'keyword-multiple'
        };
      }

      // 单个关键词匹配，中等置信度
      if (matchCount === 1) {
        // 暂存，继续查找更好的匹配
        const singleMatch = {
          path: subData.path,
          confidence: 0.65,
          reason: `关键词匹配: ${matchedKeywords[0]}`,
          method: 'keyword-single'
        };
        // 如果没有更好的匹配，最后返回这个
        if (!window.__tempMatch || window.__tempMatch.confidence < singleMatch.confidence) {
          window.__tempMatch = singleMatch;
        }
      }
    }
  }

  // 返回最佳单关键词匹配
  if (window.__tempMatch) {
    const result = window.__tempMatch;
    delete window.__tempMatch;
    return result;
  }

  return null;
}

/**
 * 获取分类的人类可读描述
 */
function getCategoryDescription(categoryPath) {
  const descriptions = {
    '开发技术/前端开发': '前端框架、工具和资源',
    '开发技术/后端开发': '后端框架、API和服务端技术',
    '开发技术/DevOps': '容器、CI/CD和云服务',
    '开发技术/数据库': '数据库和数据存储',
    '开发技术/代码托管': 'Git仓库和代码管理',
    '开发技术/文档教程': '技术文档和学习资料',
    'AI 工具/模型平台': 'AI模型和API服务',
    'AI 工具/图像生成': 'AI图像和视频生成工具',
    'AI 工具/Prompt工具': 'Prompt工程和Agent框架',
    'AI 工具/AI应用': 'AI驱动的应用和工具',
    '产品设计/设计工具': '设计软件和在线工具',
    '产品设计/设计资源': '设计灵感和素材库',
    '产品设计/UX设计': '用户体验和交互设计',
    '商业增长/创业': '创业资源和社区',
    '商业增长/营销增长': '营销工具和增长策略',
    '商业增长/SaaS': 'SaaS产品和订阅服务',
    '学习资料/在线课程': '在线教育平台和课程',
    '学习资料/技术博客': '技术博客和文章',
    '文档资料/笔记工具': '笔记软件和知识管理',
    '文档资料/协作文档': '文档协作和团队工具',
    '生活服务/常用工具': '实用工具和服务',
    '生活服务/娱乐': '娱乐内容和媒体平台'
  };

  return descriptions[categoryPath.join('/')] || '其他资源';
}

// 导出（用于浏览器环境）
if (typeof window !== 'undefined') {
  window.KEYWORD_RULES = KEYWORD_RULES;
  window.classifyByKeywords = classifyByKeywords;
  window.getCategoryDescription = getCategoryDescription;
}

