# 前端代码 RAG 系统设计文档

**日期**: 2026-01-15
**版本**: 1.0
**作者**: Claude Code

## 1. 概述

### 1.1 项目目标

构建一个基于 Ollama 的前端代码 RAG（Retrieval-Augmented Generation）系统，用于帮助开发者快速定位和修复代码缺陷。系统通过语义搜索和代码分析，能够根据问题描述找到相关代码片段，提供完整的上下文信息，辅助缺陷修复。

### 1.2 核心功能

- **可配置项目选择**: 支持灵活选择要分析的项目
- **多粒度代码索引**: 文件、函数、组件、代码块多层级索引
- **语义搜索**: 基于向量相似度的智能代码搜索
- **多种交互方式**: CLI 命令行工具 + Web 可视化界面
- **本地优先**: 所有数据和模型都在本地运行，无需云服务

### 1.3 使用场景

当开发者遇到 bug 或问题时：
1. 输入问题描述和上下文
2. RAG 系统查找相关代码
3. 展示相关代码片段和完整上下文
4. 帮助定位问题原因
5. 辅助进行缺陷修复

---

## 2. 整体架构

### 2.1 系统架构

采用 **Workspace Monorepo** 架构，包含两个核心包：

**1. Web 包（Next.js 全栈应用）**
- **前端**: React 18 + Next.js 14 App Router
- **后端**: Next.js API Routes (Route Handlers)
- 负责代码解析、向量化、索引、搜索和 Web UI
- 端口: 3000

**2. CLI 包（命令行工具）**
- 基于 Commander.js 的交互式 CLI
- 调用 Next.js API Routes 进行操作
- 支持项目配置、索引构建、代码搜索

**3. Core 包（可选的共享逻辑）**
- 代码解析、向量化、搜索等核心逻辑
- 被 Web 和 CLI 共同使用
- 纯 TypeScript，无框架依赖

### 2.2 项目结构

```
ai-rag/
├── packages/
│   ├── web/              # Next.js 全栈应用
│   │   ├── app/          # App Router
│   │   │   ├── api/      # API Routes
│   │   │   └── (pages)/  # 前端页面
│   │   ├── lib/          # 核心逻辑
│   │   └── package.json
│   ├── cli/              # CLI 工具
│   │   └── package.json
│   └── core/             # 共享核心逻辑（可选）
│       └── package.json
└── package.json          # Workspace 根配置
```

### 2.3 技术栈

- **运行时**: Node.js >= 18.0.0
- **包管理**: Yarn Workspaces
- **全栈框架**: Next.js 14 (App Router + Route Handlers)
- **前端**: React 18 + Tailwind CSS + shadcn/ui
- **向量数据库**: LanceDB（本地文件存储）
- **Embedding**: Ollama HTTP API
  - **nomic-embed-text**: 生成代码向量（274 MB）
  - **qwen2.5-coder:14b**: 可选的代码分析增强（9.0 GB）
- **代码解析**: @babel/parser + ts-morph + @vue/compiler-sfc

### 2.4 数据存储

```
.ai-rag-data/
├── lance/           # LanceDB 向量数据库
├── cache/           # 代码解析缓存
└── config.json      # 项目配置
```

---

## 3. 代码解析模块

### 3.1 解析目标

代码解析模块负责将源代码转换为结构化的、可索引的单元。支持三个层级的信息提取：

**1. 文件级别**
- 完整文件内容和路径
- 文件类型、大小、修改时间
- 文件级别的注释和文档

**2. 函数/组件级别**
- 函数定义、参数、返回值
- Vue/React 组件的 props、events、methods
- 类定义和方法
- 导入导出关系

**3. 代码块级别**
- 重要的代码段（如复杂的业务逻辑）
- 错误处理块（try-catch）
- 关键的条件分支
- 配置对象和常量定义

### 3.2 支持的文件类型

基于项目特点，优先支持：
- **JavaScript/TypeScript**: `.js`, `.ts`, `.jsx`, `.tsx`
- **Vue**: `.vue` (template + script + style)
- **配置文件**: `.json`, `.yaml`, `.env`
- **样式文件**: `.css`, `.less`, `.scss`
- **文档**: `.md`

### 3.3 解析工具

- **@babel/parser**: 解析 JS/TS/JSX/TSX，生成 AST
- **@vue/compiler-sfc**: 解析 Vue 单文件组件
- **ts-morph**: TypeScript 代码分析和元数据提取
- **comment-parser**: 提取 JSDoc 注释

### 3.4 元数据提取

每个代码单元都会提取以下元数据：
- **位置信息**: 文件路径、起始行号、结束行号
- **类型信息**: 文件类型、代码单元类型（function/class/component）
- **依赖关系**: 导入的模块、使用的组件
- **语义信息**: 函数名、参数、注释、文档字符串
- **项目信息**: 所属项目、相对路径

---

## 4. 向量化和索引模块

### 4.1 向量化策略

将代码单元转换为向量表示时，构建富含语义信息的文本：

**文本构建格式**:
```
文件路径: src/components/UserForm.vue
类型: Vue组件
名称: UserForm
功能: 用户信息表单组件

代码内容:
[实际代码]

注释和文档:
[JSDoc/注释内容]

依赖关系:
- 导入: @/utils/validator, @/api/user
- 使用组件: fa-form-input, fa-button
```

### 4.2 Ollama 集成

通过 HTTP API 调用本地 Ollama 服务：

**Embedding 生成**:
- 端点: `POST http://localhost:11434/api/embeddings`
- 模型: `nomic-embed-text`
- 输入: 构建好的代码文本
- 输出: 768 维向量

**批处理优化**:
- 批量处理多个代码单元（每批 10-20 个）
- 使用连接池复用 HTTP 连接
- 实现重试机制处理临时失败

### 4.3 LanceDB 存储结构

**表结构设计**:
```typescript
{
  id: string,              // 唯一标识
  vector: Float32Array,    // 768维向量
  content: string,         // 原始代码内容
  file_path: string,       // 文件路径
  project: string,         // 所属项目
  type: string,            // 类型(file/function/class/component)
  name: string,            // 名称
  start_line: number,      // 起始行
  end_line: number,        // 结束行
  dependencies: string[],  // 依赖列表
  metadata: object         // 其他元数据
}
```

### 4.4 索引构建流程

1. **扫描项目**: 遍历指定项目的所有源文件
2. **解析代码**: 提取多粒度的代码单元
3. **生成向量**: 调用 Ollama 生成 embeddings
4. **存储索引**: 写入 LanceDB
5. **构建缓存**: 保存文件哈希，用于增量更新

### 4.5 增量更新策略

- **文件哈希检测**: 使用 MD5 检测文件变化
- **智能更新**: 只重新索引变化的文件
- **依赖追踪**: 更新时同步更新依赖关系
- **定期全量**: 支持手动触发全量重建

---

## 5. 搜索和检索模块

### 5.1 搜索流程

当用户输入问题描述时，系统执行以下步骤：

**1. 问题向量化**
- 将用户的问题描述发送到 Ollama
- 使用 nomic-embed-text 生成查询向量
- 保留原始问题文本用于后续处理

**2. 向量相似度搜索**
- 在 LanceDB 中执行 ANN（近似最近邻）搜索
- 返回 Top-K 个最相似的代码单元（默认 K=20）
- 获取相似度分数（余弦相似度）

**3. 元数据过滤**
- 根据用户指定的条件过滤结果：
  - 项目名称（如只搜索 mallsite-res）
  - 文件类型（如只搜索 .vue 文件）
  - 代码单元类型（如只搜索函数）
  - 文件路径模式（如只搜索 src/components/）

**4. 结果重排序**
- 综合考虑多个因素：
  - 向量相似度分数（权重 0.6）
  - 文件修改时间（越新越相关，权重 0.2）
  - 代码单元类型（函数 > 类 > 文件，权重 0.2）
- 计算最终得分并重新排序

**5. 上下文扩展**
- 对于 Top-5 的结果，自动扩展上下文：
  - 包含完整的文件内容
  - 包含相关的导入依赖
  - 包含调用关系（如果可用）

### 5.2 高级搜索功能

**混合搜索**:
- 支持语义搜索 + 关键词搜索的组合
- 例如：语义搜索"用户登录"+ 关键词过滤"axios"

**依赖追踪**:
- 查找某个函数的所有调用者
- 查找某个组件的所有使用位置

**相似代码查找**:
- 输入一段代码，查找相似的实现
- 用于发现重复代码或参考实现

---

## 6. API 接口设计

### 6.1 API 路由结构

基于 Next.js 14 App Router，API 路由位于 `app/api/` 目录：

```
app/api/
├── projects/
│   ├── route.ts          # GET /api/projects - 获取项目列表
│   └── [id]/
│       └── route.ts      # GET /api/projects/:id - 获取项目详情
├── index/
│   ├── route.ts          # POST /api/index - 构建索引
│   └── status/
│       └── route.ts      # GET /api/index/status - 获取索引状态
├── search/
│   └── route.ts          # POST /api/search - 搜索代码
└── health/
    └── route.ts          # GET /api/health - 健康检查
```

### 6.2 核心 API 端点

**1. 项目管理**
```typescript
// GET /api/projects
// 返回所有可配置的项目列表
Response: {
  projects: Array<{
    id: string,
    name: string,
    path: string,
    indexed: boolean,
    lastIndexed: string | null
  }>
}

// POST /api/projects
// 添加新项目到配置
Request: { name: string, path: string }
Response: { success: boolean, project: {...} }
```

**2. 索引构建**
```typescript
// POST /api/index
// 构建或更新项目索引
Request: {
  projectIds: string[],
  incremental?: boolean  // 增量更新
}
Response: {
  jobId: string,
  status: 'queued' | 'processing'
}

// GET /api/index/status?jobId=xxx
// 查询索引构建状态
Response: {
  jobId: string,
  status: 'queued' | 'processing' | 'completed' | 'failed',
  progress: { current: number, total: number },
  error?: string
}
```

**3. 代码搜索**
```typescript
// POST /api/search
// 搜索代码
Request: {
  query: string,
  filters?: {
    projects?: string[],
    fileTypes?: string[],
    codeTypes?: string[],
    pathPattern?: string
  },
  limit?: number  // 默认 20
}
Response: {
  results: Array<{
    id: string,
    score: number,
    content: string,
    filePath: string,
    project: string,
    type: string,
    name: string,
    startLine: number,
    endLine: number,
    context?: {
      fileContent: string,
      dependencies: string[]
    }
  }>,
  total: number
}
```

### 6.3 实现特点

- **Route Handlers**: 使用 Next.js 14 的 Route Handlers（`route.ts`）
- **类型安全**: 所有请求/响应都有 TypeScript 类型定义
- **错误处理**: 统一的错误响应格式
- **流式响应**: 索引构建支持 Server-Sent Events (SSE) 实时推送进度

---

## 7. CLI 工具设计

### 7.1 CLI 命令结构

基于 Commander.js 的命令行工具，提供以下核心命令：

```bash
ai-rag <command> [options]

Commands:
  init              # 初始化配置
  project add       # 添加项目到配置
  project list      # 列出所有项目
  index build       # 构建索引
  index status      # 查看索引状态
  search <query>    # 搜索代码
  server start      # 启动 Web 服务器
```

### 7.2 核心命令

**1. 初始化配置**
```bash
ai-rag init
# 交互式配置向导
```

**2. 项目管理**
```bash
ai-rag project add --name mallsite-res --path ../mallsite-res/js
ai-rag project list
```

**3. 索引构建**
```bash
ai-rag index build --project mallsite-res
ai-rag index build --project mallsite-res --incremental
ai-rag index build --all
```

**4. 代码搜索**
```bash
ai-rag search "用户登录表单验证"
ai-rag search "用户登录" --project mallsite-res --type function
ai-rag search --interactive
```

**5. Web 服务器**
```bash
ai-rag server start
ai-rag server start --port 3001
```

### 7.3 实现特点

- **交互式体验**: 使用 inquirer.js 提供友好的交互式配置
- **进度显示**: 使用 ora 显示实时进度和加载动画
- **表格展示**: 使用 cli-table3 美化表格输出
- **颜色高亮**: 使用 chalk 为输出添加颜色
- **API 调用**: 通过 HTTP 调用 Next.js API Routes

---

## 8. Web 前端设计

### 8.1 页面结构

基于 Next.js 14 App Router：

```
app/
├── layout.tsx           # 根布局
├── page.tsx             # 首页（搜索界面）
├── projects/
│   └── page.tsx         # 项目管理页面
├── index/
│   └── page.tsx         # 索引管理页面
└── settings/
    └── page.tsx         # 设置页面
```

### 8.2 核心页面

**1. 搜索页面（首页）**
- 大型搜索框，支持多行输入
- 过滤器面板（项目、文件类型、代码类型）
- 搜索结果列表（卡片式展示）
- 代码预览（展开完整代码和上下文）

**2. 项目管理页面**
- 项目列表表格
- 添加项目对话框
- 项目操作（编辑、删除、查看详情）
- 索引状态显示

**3. 索引管理页面**
- 索引构建触发
- 实时进度显示（SSE）
- 索引历史记录
- 增量更新选项

**4. 设置页面**
- Ollama 配置
- 存储配置
- 搜索配置
- 界面配置

### 8.3 技术实现

**状态管理**:
- React Context 或 Zustand
- localStorage 持久化

**数据获取**:
- Next.js Server Actions 或客户端 fetch
- EventSource (SSE) 实时进度

**样式**:
- Tailwind CSS
- shadcn/ui 组件库
- 亮色/暗色主题

**性能优化**:
- 虚拟滚动（react-window）
- 代码高亮按需加载
- 懒加载

---

## 9. 实现计划

### 9.1 第一阶段：基础架构

1. 初始化 Monorepo 项目结构
2. 配置 Yarn Workspaces
3. 搭建 Next.js 应用基础框架
4. 集成 LanceDB 和 Ollama

### 9.2 第二阶段：核心功能

1. 实现代码解析模块
2. 实现向量化和索引模块
3. 实现搜索和检索模块
4. 实现 API 接口

### 9.3 第三阶段：用户界面

1. 实现 CLI 工具
2. 实现 Web 前端页面
3. 集成前后端

### 9.4 第四阶段：优化和测试

1. 性能优化
2. 错误处理完善
3. 单元测试和集成测试
4. 文档完善

---

## 10. 总结

本设计文档详细描述了一个基于 Ollama 的前端代码 RAG 系统的完整架构和实现方案。系统采用 Next.js 全栈架构，结合 LanceDB 向量数据库和本地 Ollama 模型，提供了强大的代码搜索和分析能力。

**核心优势**:
- 本地优先，数据安全
- 多粒度索引，精确定位
- 语义搜索，智能匹配
- 多种交互方式，灵活使用
- 现代技术栈，开发体验好

**下一步**:
- 准备开始实现第一阶段：基础架构搭建
- 创建 Git 工作树进行隔离开发
- 编写详细的实现计划
