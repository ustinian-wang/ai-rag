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
# 安装必需的 embedding 模型（约 274 MB）
ollama pull nomic-embed-text

# （可选）安装代码分析模型（约 9.0 GB）
ollama pull qwen2.5-coder:14b
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

## 步骤 5: 搜索代码

```bash
# 基本搜索
yarn rag search "用户登录"

# 指定项目搜索
yarn rag search "表单验证" --project mallsite-res

# 查看完整文件内容
yarn rag search "用户登录" --verbose
```

## 步骤 6: 智能分析（可选）

```bash
# 使用 LLM 分析缺陷
yarn rag analyze "用户登录时密码验证失败"
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
node packages/cli/dist/index.js search "用户登录"
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

# 4. 搜索代码
yarn rag search "处理用户输入"

# 5. 智能分析缺陷
yarn rag analyze "表单提交后数据丢失"
```

祝您使用愉快！🎉
