// 代码单元类型
export type CodeUnitType = 'file' | 'function' | 'class' | 'component' | 'block'

// 代码单元接口
export interface CodeUnit {
  id: string
  type: CodeUnitType
  name: string
  content: string
  filePath: string
  project: string
  startLine: number
  endLine: number
  dependencies: string[]
  metadata: Record<string, any>
}

// 向量化结果接口
export interface VectorizedCodeUnit extends CodeUnit {
  vector: Float32Array
}

// 搜索结果接口
export interface SearchResult {
  id: string
  score: number
  content: string
  filePath: string
  project: string
  type: CodeUnitType
  name: string
  startLine: number
  endLine: number
  context?: {
    fileContent: string
    dependencies: string[]
  }
}

// 搜索过滤器接口
export interface SearchFilters {
  projects?: string[]
  fileTypes?: string[]
  codeTypes?: CodeUnitType[]
  pathPattern?: string
}

// Ollama 配置接口
export interface OllamaConfig {
  baseUrl: string
  embeddingModel: string
  timeout?: number
}
