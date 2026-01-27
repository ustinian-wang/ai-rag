# AI RAG - 前端代码智能搜索系统

基于 Ollama 的前端代码 RAG（Retrieval-Augmented Generation）系统，帮助开发者快速定位和修复代码缺陷。通过语义搜索和代码分析，能够根据问题描述找到相关代码片段，提供完整的上下文信息。

## ✨ 特性

- 🔍 **语义搜索**: 基于向量相似度的智能代码搜索，理解代码语义而非简单关键词匹配
- 📚 **多粒度索引**: 支持文件、函数、组件、代码块多层级索引
- 🎯 **智能分析**: 使用 LLM 分析缺陷描述，自动定位可疑代码位置
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
3. **Ollama**: 已安装并运行，需要下载以下模型：
   - `nomic-embed-text` (274 MB) - 用于生成代码向量
   - `qwen2.5-coder:14b` (9.0 GB, 可选) - 用于代码分析增强

### 安装 Ollama 模型

```bash
# 安装 embedding 模型（必需）
ollama pull nomic-embed-text

# 安装代码分析模型（可选，用于智能分析功能）
ollama pull qwen2.5-coder:14b
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
    "embeddingModel": "nomic-embed-text",
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
- **ollama.embeddingModel**: 用于生成向量的模型，默认 `nomic-embed-text`
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
# 示例: yarn rag add mallsite-res ../mallsite-res/js

# 列出所有项目
yarn rag list
```

### 索引构建

```bash
# 构建项目索引
yarn rag index <项目ID> [options]

# 选项:
#   -l, --limit <number>  限制索引文件数量（默认: 100）
#   示例: yarn rag index <project-id> --limit 200
```

### 代码搜索

```bash
# 搜索代码
yarn rag search <查询> [options]

# 选项:
#   -l, --limit <number>     结果数量限制（默认: 10）
#   -p, --project <name>     指定项目名称
#   -v, --verbose            显示完整文件内容

# 示例:
yarn rag search "用户登录表单验证"
yarn rag search "用户登录" --project mallsite-res --limit 20
yarn rag search "表单验证" --verbose
```

### 智能分析

```bash
# 智能分析缺陷（使用 LLM 分析问题并定位代码）
yarn rag analyze <缺陷描述> [options]

# 选项:
#   -p, --project <name>     指定项目名称
#   -l, --limit <number>     结果数量限制（默认: 10）

# 示例:
yarn rag analyze "用户登录时密码验证失败"
yarn rag analyze "表单提交后数据丢失" --project mallsite-res
```

### 命令示例

```bash
# 1. 添加项目
yarn rag add mallsite-res ../mallsite-res/js

# 2. 查看项目列表（获取项目 ID）
yarn rag list

# 3. 构建索引
yarn rag index <project-id>

# 4. 搜索代码
yarn rag search "用户登录验证逻辑"

# 5. 智能分析缺陷
yarn rag analyze "点击提交按钮后页面没有响应"
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
    "projects": ["mallsite-res"],
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
      "project": "mallsite-res",
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
- **Embedding**: Ollama HTTP API (`nomic-embed-text`)
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

A: 可以限制索引文件数量：
```bash
yarn rag index <project-id> --limit 50
```

或者使用增量更新（未来版本支持）。

### Q: 搜索结果不准确怎么办？

A: 
1. 确保索引已完整构建
2. 尝试使用更具体的问题描述
3. 使用 `--verbose` 选项查看完整上下文
4. 使用 `analyze` 命令进行智能分析

### Q: 如何更新索引？

A: 重新运行索引命令即可，系统会自动检测文件变化并更新（未来版本支持增量更新）。

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
- ✅ 支持语义搜索和智能分析
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
