# API 文档

本文档详细说明 AI RAG 系统的 REST API 接口。

## 基础信息

- **Base URL**: `http://localhost:3000/api`
- **Content-Type**: `application/json`
- **字符编码**: UTF-8

## 通用响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... }
}
```

### 错误响应

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": { ... }
  }
}
```

## API 端点

### 1. 健康检查

检查系统状态和 Ollama 连接。

#### GET /api/health

**请求参数**: 无

**响应示例**:
```json
{
  "status": "ok",
  "ollama": {
    "connected": true,
    "baseUrl": "http://localhost:11434",
    "model": "nomic-embed-text"
  },
  "timestamp": "2026-01-15T10:30:00.000Z"
}
```

**状态码**:
- `200`: 成功
- `503`: Ollama 连接失败

---

### 2. Ollama 健康检查

检查 Ollama 服务状态。

#### GET /api/ollama/health

**请求参数**: 无

**响应示例**:
```json
{
  "connected": true,
  "baseUrl": "http://localhost:11434",
  "models": [
    {
      "name": "nomic-embed-text",
      "size": 274000000,
      "modified_at": "2026-01-15T10:00:00.000Z"
    }
  ]
}
```

---

### 3. 项目管理

#### 3.1 获取项目列表

#### GET /api/projects

**请求参数**: 无

**响应示例**:
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "1705123456789-abc123",
        "name": "mallsite-res",
        "path": "/path/to/mallsite-res/js",
        "indexed": true,
        "lastIndexed": "2026-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

#### 3.2 获取项目详情

#### GET /api/projects/:id

**路径参数**:
- `id` (string): 项目 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "1705123456789-abc123",
      "name": "mallsite-res",
      "path": "/path/to/mallsite-res/js",
      "indexed": true,
      "lastIndexed": "2026-01-15T10:30:00.000Z",
      "stats": {
        "totalFiles": 1500,
        "indexedFiles": 1200,
        "lastScanTime": "2026-01-15T10:30:00.000Z"
      }
    }
  }
}
```

#### 3.3 添加项目

#### POST /api/projects

**请求体**:
```json
{
  "name": "项目名称",
  "path": "/path/to/project"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "1705123456789-abc123",
      "name": "mallsite-res",
      "path": "/path/to/mallsite-res/js",
      "indexed": false,
      "lastIndexed": null
    }
  }
}
```

**错误码**:
- `INVALID_PATH`: 项目路径无效
- `PROJECT_EXISTS`: 项目已存在

#### 3.4 更新项目

#### PUT /api/projects/:id

**路径参数**:
- `id` (string): 项目 ID

**请求体**:
```json
{
  "name": "新项目名称",
  "path": "/new/path/to/project"
}
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "project": {
      "id": "1705123456789-abc123",
      "name": "新项目名称",
      "path": "/new/path/to/project",
      "indexed": false,
      "lastIndexed": null
    }
  }
}
```

#### 3.5 删除项目

#### DELETE /api/projects/:id

**路径参数**:
- `id` (string): 项目 ID

**响应示例**:
```json
{
  "success": true,
  "message": "项目已删除"
}
```

---

### 4. 索引管理

#### 4.1 构建索引

#### POST /api/index

**请求体**:
```json
{
  "projectIds": ["project-id-1", "project-id-2"],
  "options": {
    "incremental": false,
    "limit": 100
  }
}
```

**请求参数说明**:
- `projectIds` (string[]): 要构建索引的项目 ID 列表
- `options.incremental` (boolean, 可选): 是否增量更新，默认 `false`
- `options.limit` (number, 可选): 限制索引文件数量，默认无限制

**响应示例**:
```json
{
  "success": true,
  "data": {
    "jobId": "job-1705123456789",
    "status": "queued",
    "message": "索引任务已加入队列"
  }
}
```

#### 4.2 获取索引状态

#### GET /api/index/status?jobId=xxx

**查询参数**:
- `jobId` (string): 任务 ID

**响应示例**:
```json
{
  "success": true,
  "data": {
    "jobId": "job-1705123456789",
    "status": "processing",
    "progress": {
      "current": 50,
      "total": 100,
      "percentage": 50
    },
    "message": "正在处理文件 50/100",
    "startedAt": "2026-01-15T10:30:00.000Z",
    "estimatedTimeRemaining": 30000
  }
}
```

**状态值**:
- `queued`: 排队中
- `processing`: 处理中
- `completed`: 已完成
- `failed`: 失败

#### 4.3 获取索引统计

#### GET /api/index/stats?projectId=xxx

**查询参数**:
- `projectId` (string, 可选): 项目 ID，不传则返回所有项目的统计

**响应示例**:
```json
{
  "success": true,
  "data": {
    "totalProjects": 3,
    "indexedProjects": 2,
    "totalCodeUnits": 15000,
    "totalFiles": 5000,
    "projects": [
      {
        "projectId": "project-id-1",
        "projectName": "mallsite-res",
        "codeUnits": 8000,
        "files": 2500,
        "lastIndexed": "2026-01-15T10:30:00.000Z"
      }
    ]
  }
}
```

---

### 5. 代码搜索

#### 5.1 搜索代码

#### POST /api/search

**请求体**:
```json
{
  "query": "用户登录表单验证",
  "filters": {
    "projects": ["mallsite-res"],
    "fileTypes": [".vue", ".js"],
    "codeTypes": ["function", "component"],
    "pathPattern": "src/components/**"
  },
  "options": {
    "limit": 20,
    "minScore": 0.7,
    "includeContext": true
  }
}
```

**请求参数说明**:
- `query` (string, 必需): 搜索查询文本
- `filters.projects` (string[], 可选): 项目名称列表，限制搜索范围
- `filters.fileTypes` (string[], 可选): 文件类型列表，如 `[".vue", ".js"]`
- `filters.codeTypes` (string[], 可选): 代码单元类型，如 `["function", "component", "class"]`
- `filters.pathPattern` (string, 可选): 文件路径模式，支持 glob 语法
- `options.limit` (number, 可选): 返回结果数量限制，默认 20
- `options.minScore` (number, 可选): 最小相似度分数（0-1），默认 0.5
- `options.includeContext` (boolean, 可选): 是否包含完整文件内容，默认 `false`

**响应示例**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "code-unit-id",
        "score": 0.95,
        "content": "export default {\n  name: 'LoginForm',\n  ...",
        "filePath": "src/components/LoginForm.vue",
        "project": "mallsite-res",
        "type": "component",
        "name": "LoginForm",
        "startLine": 10,
        "endLine": 150,
        "dependencies": [
          "@/utils/validator",
          "@/api/user"
        ],
        "metadata": {
          "props": ["username", "password"],
          "events": ["submit", "cancel"]
        },
        "context": {
          "fileContent": "完整文件内容...",
          "imports": ["@/utils/validator", "@/api/user"],
          "relatedCode": []
        }
      }
    ],
    "total": 1,
    "query": "用户登录表单验证",
    "searchTime": 1250
  }
}
```

**响应字段说明**:
- `score`: 相似度分数（0-1），越高越相似
- `content`: 代码单元的内容
- `filePath`: 文件路径
- `project`: 所属项目名称
- `type`: 代码单元类型（file/function/class/component）
- `name`: 代码单元名称
- `startLine`: 起始行号
- `endLine`: 结束行号
- `dependencies`: 依赖列表
- `context`: 上下文信息（仅在 `includeContext: true` 时包含）

---

### 6. 代码分析

#### 6.1 智能分析缺陷

#### POST /api/analyze

**请求体**:
```json
{
  "bugDescription": "用户登录时密码验证失败",
  "options": {
    "project": "mallsite-res",
    "maxResults": 10,
    "includeFixSuggestions": true
  }
}
```

**请求参数说明**:
- `bugDescription` (string, 必需): 缺陷描述
- `options.project` (string, 可选): 指定项目名称
- `options.maxResults` (number, 可选): 最大搜索结果数量，默认 10
- `options.includeFixSuggestions` (boolean, 可选): 是否包含修复建议，默认 `true`

**响应示例**:
```json
{
  "success": true,
  "data": {
    "bugAnalysis": {
      "componentName": "LoginForm",
      "symptom": "密码验证失败",
      "steps": [
        "用户输入用户名和密码",
        "点击登录按钮",
        "密码验证失败"
      ],
      "possibleCauses": [
        "密码验证逻辑错误",
        "密码加密方式不匹配",
        "API 调用失败"
      ]
    },
    "searchResults": [
      {
        "id": "code-unit-id",
        "score": 0.92,
        "content": "...",
        "filePath": "src/components/LoginForm.vue",
        "project": "mallsite-res",
        "type": "component",
        "name": "LoginForm",
        "startLine": 50,
        "endLine": 80
      }
    ],
    "codeAnalysis": {
      "suspiciousCode": [
        {
          "filePath": "src/components/LoginForm.vue",
          "startLine": 55,
          "endLine": 60,
          "reason": "密码验证逻辑可能存在问题",
          "confidence": "high"
        }
      ],
      "dataFlow": [
        "用户输入 -> validatePassword() -> API 调用 -> 验证结果"
      ],
      "fixSuggestions": [
        "检查密码加密方式是否与后端一致",
        "验证 API 调用是否正确",
        "检查错误处理逻辑"
      ]
    },
    "summary": "问题可能出现在 LoginForm 组件的密码验证逻辑中..."
  }
}
```

---

## 错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `INVALID_REQUEST` | 400 | 请求参数无效 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `OLLAMA_CONNECTION_ERROR` | 503 | Ollama 连接失败 |
| `OLLAMA_MODEL_NOT_FOUND` | 503 | Ollama 模型未找到 |
| `INDEX_NOT_FOUND` | 404 | 索引不存在 |
| `PROJECT_NOT_FOUND` | 404 | 项目不存在 |
| `PROJECT_EXISTS` | 409 | 项目已存在 |
| `INVALID_PATH` | 400 | 路径无效 |
| `PERMISSION_DENIED` | 403 | 权限不足 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

## 使用示例

### cURL 示例

```bash
# 健康检查
curl http://localhost:3000/api/health

# 获取项目列表
curl http://localhost:3000/api/projects

# 添加项目
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "my-project", "path": "/path/to/project"}'

# 搜索代码
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "用户登录",
    "filters": {
      "projects": ["mallsite-res"]
    },
    "options": {
      "limit": 10
    }
  }'

# 智能分析
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "bugDescription": "用户登录时密码验证失败",
    "options": {
      "project": "mallsite-res"
    }
  }'
```

### JavaScript/TypeScript 示例

```typescript
// 搜索代码
async function searchCode(query: string) {
  const response = await fetch('http://localhost:3000/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      filters: {
        projects: ['mallsite-res'],
        fileTypes: ['.vue', '.js'],
      },
      options: {
        limit: 20,
        includeContext: true,
      },
    }),
  });

  const data = await response.json();
  return data.data.results;
}

// 使用示例
const results = await searchCode('用户登录表单验证');
console.log(results);
```

## 注意事项

1. **Ollama 服务**: 所有 API 都需要 Ollama 服务运行在 `http://localhost:11434`
2. **索引构建**: 搜索前需要先构建索引，否则会返回空结果
3. **性能**: 首次搜索可能需要几秒钟生成查询向量，后续搜索会更快
4. **限制**: 建议单次搜索的 `limit` 不超过 100，避免响应时间过长
5. **并发**: 索引构建是异步的，可以通过状态 API 查询进度

## 版本信息

- **API 版本**: v1.0.0
- **最后更新**: 2026-01-15
