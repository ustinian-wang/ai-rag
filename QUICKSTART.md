# 快速开始指南

本指南将帮助您在 5 分钟内快速上手 AI RAG 系统。

## 前置检查

确保已安装以下软件：

```bash
# 检查 Node.js 版本（需要 >= 18.0.0）
node --version

# 检查 Yarn 版本（需要 >= 1.22.19）
yarn --version

# 检查 Ollama 是否运行
curl http://localhost:11434/api/tags
```

如果 Ollama 未运行，请先启动：

```bash
ollama serve
```

## 步骤 1: 安装依赖

```bash
# 进入项目目录
cd projects/ai-rag

# 安装依赖
yarn install

# 构建项目
yarn build
```

## 步骤 2: 安装 Ollama 模型

```bash
# 安装必需的 embedding 模型（推荐 bge-m3）
ollama pull bge-m3

# （可选）安装代码分析模型
ollama pull qwen2.5-coder:7b
# 或 ollama pull qwen2.5-coder:14b
```

## 步骤 3: 添加项目

```bash
# 添加一个项目到配置
yarn rag add mallsite-res ../mallsite-res/js

# 查看项目列表（记住项目 ID）
yarn rag list
```

## 步骤 4: 构建索引

```bash
# 使用项目 ID 构建索引（首次可能需要几分钟）
yarn rag index <project-id>

# 如果项目很大，可以先限制文件数量
yarn rag index <project-id> --limit 50
```

## 步骤 5: 智能问答

```bash
# 一键问答（rag:chat 内部调用 llm）
yarn rag:chat "用户登录逻辑是什么"

# 指定项目
yarn rag:chat "表单验证流程" -p mallsite-res

# 或直接使用 llm 命令
yarn rag llm "用户登录时密码验证失败" -p mallsite-res
```

## 步骤 6: 分步调试（可选）

```bash
# 查看 rerank 结果（不含 LLM）
yarn rag rerank "用户登录" -p mallsite-res -v

# 查看拼接的 context
yarn rag context "用户登录" -p mallsite-res -k 8

# 改写自然语言为检索查询
yarn rag rewrite "登录失败时前端怎么处理"
```

## 启动 Web 界面（可选）

```bash
# 开发模式启动 Web 界面
yarn dev:web

# 浏览器访问 http://localhost:3000
```

## 常见问题

### 问题 1: Ollama 连接失败

**解决方案**:
```bash
# 检查 Ollama 是否运行
curl http://localhost:11434/api/tags

# 如果未运行，启动 Ollama
ollama serve
```

### 问题 2: 找不到命令

**解决方案**:
```bash
# 确保已构建项目
yarn build

# 或使用完整路径
node packages/cli/dist/index.js llm "用户登录"
```

### 问题 3: 索引构建失败

**解决方案**:
- 检查项目路径是否正确
- 确保有读取项目文件的权限
- 尝试限制文件数量：`--limit 10`

## 下一步

- 阅读 [完整文档](./README.md) 了解更多功能
- 查看 [系统设计文档](./docs/plans/2026-01-15-code-rag-system-design.md) 了解架构
- 尝试使用 Web 界面进行可视化搜索

## 示例工作流

```bash
# 1. 添加项目
yarn rag add my-project /path/to/my-project

# 2. 获取项目 ID
yarn rag list

# 3. 构建索引
yarn rag index <project-id> --limit 100

# 4. 智能问答
yarn rag:chat "处理用户输入"

# 5. 分步调试（可选）
yarn rag rerank "表单提交" -p my-project -v
yarn rag context "表单提交" -p my-project
yarn rag llm "表单提交后数据丢失" -p my-project
```

祝您使用愉快！🎉
