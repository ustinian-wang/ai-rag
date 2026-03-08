# AI RAG - 前端代码智能搜索系统

基于 Ollama 的前端代码 RAG（Retrieval-Augmented Generation）系统，帮助开发者快速定位和修复代码缺陷。通过语义搜索和代码分析，能够根据问题描述找到相关代码片段，提供完整的上下文信息。

## ✨ 特性

- 🔍 **语义搜索**: 基于向量相似度的智能代码搜索，理解代码语义而非简单关键词匹配
- 📚 **多粒度索引**: 支持文件、函数、组件、代码块多层级索引
- 🎯 **问答优先**: 默认通过 `chat` 完成检索增强问答，降低命令心智负担
- 🚀 **多种交互方式**: CLI 命令行工具 + Web 可视化界面
- 🔒 **本地优先**: 所有数据和模型都在本地运行，无需云服务，数据安全
- ⚡ **增量更新**: 智能检测文件变化，只更新修改的文件
- 🎨 **现代技术栈**: Next.js 14 + TypeScript + LanceDB + Ollama

## 📋 目录

- [快速开始](#快速开始)
- [安装](#安装)
- [配置](#配置)
- [CLI 使用](#cli-使用)
- [Web 界面](#web-界面)
- [API 文档](#api-文档)
- [项目结构](#项目结构)
- [开发指南](#开发指南)
- [常见问题](#常见问题)

## 🚀 快速开始

### 前置要求

1. **Node.js**: >= 18.0.0
2. **Yarn**: >= 1.22.19
3. **Ollama**: 已安装并运行，建议下载以下模型：
   - `bge-m3` (推荐) - 用于生成代码向量
   - `qwen2.5-coder:7b` 或 `qwen2.5-coder:14b` (可选) - 用于 chat 生成回答

### 安装 Ollama 模型

```bash
# 安装 embedding 模型（必需，推荐 bge-m3）
ollama pull bge-m3

# 安装代码分析模型（可选）
ollama pull qwen2.5-coder:7b
```

### 安装项目依赖

```bash
# 安装依赖
yarn install

# 构建所有包
yarn build
```

### 初始化配置

首次使用需要初始化配置：

```bash
# 使用 CLI 初始化（会自动创建配置文件）
yarn rag add <项目名称> <项目路径>
```

配置文件会自动创建在 `.ai-rag-data/config.json`。

## ⚙️ 配置

配置文件位于 `.ai-rag-data/config.json`，结构如下：

```json
{
  "version": "1.0.0",
  "projects": [
    {
      "id": "project-id",
      "name": "项目名称",
      "path": "/path/to/project",
      "indexed": false,
      "lastIndexed": null
    }
  ],
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "embeddingModel": "bge-m3",
    "timeout": 30000
  },
  "storage": {
    "dataDir": ".ai-rag-data",
    "lanceDir": ".ai-rag-data/lance",
    "cacheDir": ".ai-rag-data/cache"
  }
}
```

### 配置说明

- **ollama.baseUrl**: Ollama 服务地址，默认 `http://localhost:11434`
- **ollama.embeddingModel**: 用于生成向量的模型，默认 `bge-m3`
- **storage.lanceDir**: LanceDB 向量数据库存储目录
- **storage.cacheDir**: 代码解析缓存目录

## 💻 CLI 使用

### 基本命令

```bash
# 使用 yarn 脚本
yarn rag <command> [options]

# 或直接使用脚本
./ai-rag.sh <command> [options]
```

### 项目管理

```bash
# 添加项目到配置
yarn rag add <项目名称> <项目路径>
# 示例: yarn rag add <project-name> /path/to/project

# 列出所有项目
yarn rag list
```

### 索引构建

```bash
# 构建项目索引（支持项目 ID 或项目名称）
yarn rag index <项目ID或项目名称> [options]

# 选项:
#   -l, --limit <number>  限制索引文件数量（默认: 100）
#   -i, --incremental     增量构建（仅重建变更文件，自动处理删除）
#   示例: yarn rag index <project-id> --limit 200

# 示例：
yarn rag index <project-name> --incremental
yarn rag index <project-id> --incremental
```

### 问答模式（chat）

```bash
# 基于检索结果生成分析回答
yarn rag chat <问题> [options]

# 选项:
#   -l, --limit <number>         检索候选数量（默认: 8）
#   -p, --project <name>         指定项目名称
#   -s, --show-sources           显示引用来源
#   --context-limit <number>     参与回答的片段数量（默认: 6）
#   --snippet-chars <number>     每个片段最大字符数（默认: 1400）
#   -m, --model <name>           指定 chat 模型（如 qwen2.5-coder:7b）
#   --fast                       快速模式（更少上下文，更快回答）

# 示例：
yarn rag chat "某个业务模块的加载逻辑是什么样的" -p <project-name> -s
yarn rag chat "登录失败时前端怎么处理" -p <project-name> --fast -m qwen2.5-coder:7b
```

### 命令模式说明（默认仅 chat）

```bash
# 当前 CLI 默认对外仅保留 chat 入口
yarn rag --help

# 如需临时启用旧命令（search/analyze），可设置环境变量
AI_RAG_ENABLE_LEGACY_COMMANDS=1 yarn rag --help
```

### 命令示例

```bash
# 1. 添加项目
yarn rag add <project-name> /path/to/project

# 2. 查看项目列表（获取项目 ID）
yarn rag list

# 3. 构建索引
yarn rag index <project-id>

# 4. 智能问答
yarn rag chat "用户登录失败时前端处理逻辑是什么"
```

## 🌐 Web 界面

### 启动 Web 服务器

```bash
# 开发模式
yarn dev:web

# 生产模式
yarn build:web
yarn workspace @ai-rag/web start
```

Web 界面默认运行在 `http://localhost:3000`。

### Web 功能

- **搜索页面**: 大型搜索框，支持多行输入和过滤器
- **项目管理**: 添加、编辑、删除项目，查看索引状态
- **索引管理**: 触发索引构建，查看实时进度
- **代码预览**: 展开完整代码和上下文信息

## 📡 API 文档

### 项目管理 API

#### 获取项目列表

```http
GET /api/projects
```

响应:
```json
{
  "projects": [
    {
      "id": "project-id",
      "name": "项目名称",
      "path": "/path/to/project",
      "indexed": true,
      "lastIndexed": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

#### 添加项目

```http
POST /api/projects
Content-Type: application/json

{
  "name": "项目名称",
  "path": "/path/to/project"
}
```

### 搜索 API

#### 搜索代码

```http
POST /api/search
Content-Type: application/json

{
  "query": "用户登录验证",
  "filters": {
    "projects": ["<project-name>"],
    "fileTypes": [".vue", ".js"],
    "codeTypes": ["function", "component"]
  },
  "limit": 20
}
```

响应:
```json
{
  "results": [
    {
      "id": "result-id",
      "score": 0.95,
      "content": "代码内容...",
      "filePath": "src/components/LoginForm.vue",
      "project": "<project-name>",
      "type": "component",
      "name": "LoginForm",
      "startLine": 10,
      "endLine": 50,
      "dependencies": ["@/utils/validator"]
    }
  ],
  "total": 1
}
```

### 健康检查 API

```http
GET /api/health
```

响应:
```json
{
  "status": "ok",
  "ollama": {
    "connected": true,
    "model": "nomic-embed-text"
  }
}
```

## 📁 项目结构

```
ai-rag/
├── packages/
│   ├── web/                    # Next.js 全栈应用
│   │   ├── app/
│   │   │   ├── api/            # API Routes
│   │   │   │   ├── health/    # 健康检查
│   │   │   │   ├── index/      # 索引管理
│   │   │   │   ├── projects/   # 项目管理
│   │   │   │   └── search/     # 代码搜索
│   │   │   └── page.tsx        # 前端页面
│   │   ├── lib/                # 核心逻辑
│   │   └── package.json
│   ├── cli/                    # CLI 命令行工具
│   │   ├── src/
│   │   │   └── index.ts        # CLI 入口
│   │   └── package.json
│   └── core/                   # 共享核心逻辑
│       ├── src/
│       │   ├── analyzer/       # 代码分析器
│       │   ├── config/         # 配置管理
│       │   ├── parser/          # 代码解析器
│       │   ├── search/          # 搜索功能
│       │   ├── types/           # 类型定义
│       │   ├── utils/           # 工具函数
│       │   └── vectorizer/      # 向量化器
│       └── package.json
├── docs/                        # 文档目录
│   └── plans/                  # 设计文档
├── .ai-rag-data/               # 数据目录（自动生成）
│   ├── config.json             # 配置文件
│   ├── lance/                  # LanceDB 向量数据库
│   └── cache/                  # 代码解析缓存
├── package.json                # Workspace 根配置
├── ai-rag.sh                  # CLI 启动脚本
└── README.md                   # 本文档
```

## 🛠️ 开发指南

### 开发环境设置

```bash
# 安装依赖
yarn install

# 开发模式（监听文件变化）
yarn workspace @ai-rag/core dev    # 核心包
yarn dev:web                       # Web 应用
yarn dev:cli                       # CLI 工具
```

### 构建项目

```bash
# 构建所有包
yarn build

# 单独构建
yarn build:core
yarn build:web
yarn build:cli
```

### 代码规范

项目使用 ESLint 进行代码检查：

```bash
# 检查代码
yarn lint

# 自动修复
yarn lint --fix
```

### 测试

```bash
# 运行测试
yarn test
```

## 🔧 技术栈

- **运行时**: Node.js >= 18.0.0
- **包管理**: Yarn Workspaces
- **全栈框架**: Next.js 14 (App Router + Route Handlers)
- **前端**: React 18 + Tailwind CSS
- **向量数据库**: LanceDB（本地文件存储）
- **Embedding**: Ollama HTTP API (`bge-m3`)
- **代码解析**: 
  - `@babel/parser` - JS/TS/JSX/TSX 解析
  - `@vue/compiler-sfc` - Vue 单文件组件解析
  - `ts-morph` - TypeScript 代码分析

## ❓ 常见问题

### Q: Ollama 连接失败怎么办？

A: 确保 Ollama 服务正在运行：
```bash
# 检查 Ollama 状态
curl http://localhost:11434/api/tags

# 如果未运行，启动 Ollama
ollama serve
```

### Q: 索引构建很慢怎么办？

A: 可以限制索引文件数量，或者启用增量构建：
```bash
yarn rag index <project-id> --limit 50
yarn rag index <project-id-or-name> --incremental
```

### Q: 搜索结果不准确怎么办？

A: 
1. 确保索引已完整构建
2. 尝试使用更具体的问题描述
3. 使用 `chat -s` 查看引用来源，优先确认来源是否命中业务入口函数
4. 调高 `chat --limit` 与 `--context-limit`，提升召回覆盖

### Q: 如何更新索引？

A: 已支持增量索引：
```bash
# 推荐：每次 pull 代码后执行
yarn rag index <project-id-or-name> --incremental

# 需要全量重建时
yarn rag index <project-id-or-name>
```

### Q: `limit` 是什么？不设置会怎样？

A: `limit` 在不同命令含义不同：
- `index --limit`：最多处理多少个文件（默认 100）
- `chat --limit`：检索候选数量（默认 8，最终参与回答还受 `--context-limit` 限制）

不设置会使用默认值，通常可直接用；需要更高召回时再增大。

### Q: 为什么会出现负数“相似度”？

A: CLI 展示的“相似度”实际是 `1 - distance`（distance 为向量距离）。  
当距离大于 1 时，显示值会变成负数。这不影响排序逻辑，主要用于相对比较（值越大越接近）。

### Q: embedding 偶发 500 / EOF 怎么排查？

A: 常见原因是 embedding 服务瞬时不稳定或上下文阈值不匹配。建议按顺序排查：
1. 先确认 Ollama 与模型状态：
```bash
ollama ps
curl http://localhost:11434/api/tags
```
2. 打开 embedding 调试日志（查看 request id、输入长度、重试恢复情况）：
```bash
AI_RAG_EMBED_DEBUG=1 yarn rag index <project-id-or-name> --incremental
```
3. 若服务 context 较小（例如 4096），可设置：
```bash
AI_RAG_OLLAMA_CONTEXT=4096
```
系统会按该 context 自动计算安全阈值并重试（默认最多 5 次）。

### Q: 支持哪些文件类型？

A: 目前支持：
- JavaScript/TypeScript: `.js`, `.ts`, `.jsx`, `.tsx`
- Vue: `.vue`
- 配置文件: `.json`, `.yaml`
- 样式文件: `.css`, `.less`, `.scss`
- 文档: `.md`

### Q: 数据存储在哪里？

A: 所有数据存储在 `.ai-rag-data/` 目录：
- `config.json` - 配置文件
- `lance/` - 向量数据库
- `cache/` - 代码解析缓存

## 📝 更新日志

### v1.0.0 (2026-01-15)

- ✨ 初始版本发布
- ✅ 支持项目管理和索引构建
- ✅ 支持语义检索与 chat 问答
- ✅ CLI 命令行工具
- ✅ Web 可视化界面

## 📄 许可证

本项目为私有项目，仅供内部使用。

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关文档

- [系统设计文档](./docs/plans/2026-01-15-code-rag-system-design.md)
- [Ollama 官方文档](https://ollama.ai/docs)
- [LanceDB 文档](https://lancedb.github.io/lancedb/)

## 📮 联系方式

如有问题或建议，请联系项目维护者。
