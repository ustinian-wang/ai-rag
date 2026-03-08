import { connect } from '@lancedb/lancedb'
import path from 'path'
import { CodeUnit, VectorizedCodeUnit } from '../types'
import { OllamaClient } from '../vectorizer/ollama'
import { QueryExpander } from './queryExpander'
import { Reranker } from './reranker'
import { KeywordSearch } from './keywordSearch'

export class IndexStore {
  private dbPath: string
  private ollamaClient: OllamaClient
  private queryExpander: QueryExpander
  private reranker: Reranker
  private keywordSearch: KeywordSearch
  private readonly genericKeywords: Set<string>

  constructor(dbPath: string, ollamaClient: OllamaClient) {
    this.dbPath = dbPath
    this.ollamaClient = ollamaClient
    this.queryExpander = new QueryExpander(ollamaClient)
    this.reranker = new Reranker(ollamaClient)
    this.keywordSearch = new KeywordSearch(dbPath)
    this.genericKeywords = new Set([
      '什么', '怎么样', '什么样', '如何', '怎么', '逻辑', '模块',
      '功能', '处理', '实现', '问题', '代码'
    ])
  }

  private calcKeywordSpecificity(keyword: string): number {
    const normalized = keyword.trim().toLowerCase()
    if (!normalized) return 0
    if (this.genericKeywords.has(normalized)) return 0
    if (normalized.length >= 6) return 1.2
    if (normalized.length >= 4) return 1
    if (normalized.length >= 2) return 0.8
    return 0.4
  }

  /**
   * 索引代码单元，支持错误处理和跳过失败的单元
   */
  async indexCodeUnits(codeUnits: CodeUnit[]): Promise<{
    success: number
    failed: number
    errors: Array<{ unit: CodeUnit; error: string }>
  }> {
    const db = await connect(this.dbPath)

    // 向量化代码单元，带错误处理
    const vectorizedUnits: VectorizedCodeUnit[] = []
    const errors: Array<{ unit: CodeUnit; error: string }> = []

    for (const unit of codeUnits) {
      // 跳过文件级单元（bge-m3 模型兼容性问题）
      if (unit.type === 'file') {
        console.log(`跳过文件级单元: ${unit.name}`)
        continue
      }

      try {
        console.log(`正在向量化: ${unit.name} (${unit.type})`)
        const vector = await this.ollamaClient.generateEmbedding(unit.content)
        vectorizedUnits.push({ ...unit, vector })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`向量化失败: ${unit.filePath}:${unit.startLine} - ${errorMessage}`)
        errors.push({ unit, error: errorMessage })
      }
    }

    // 存储到 LanceDB
    if (vectorizedUnits.length > 0) {
      const tableName = 'code_units'
      const data = vectorizedUnits.map(unit => ({
        id: unit.id,
        vector: Array.from(unit.vector),
        content: unit.content,
        file_path: unit.filePath,
        project: unit.project,
        type: unit.type,
        name: unit.name,
        start_line: unit.startLine,
        end_line: unit.endLine,
        dependencies: JSON.stringify(unit.dependencies),
        metadata: JSON.stringify(unit.metadata),
      }))

      try {
        const table = await db.openTable(tableName)
        await table.add(data)
      } catch {
        await db.createTable(tableName, data)
      }
    }

    return {
      success: vectorizedUnits.length,
      failed: errors.length,
      errors,
    }
  }

  /**
   * 智能搜索 - 自动扩展查询并混合搜索
   */
  async smartSearch(
    query: string,
    options: {
      limit?: number
      projects?: string[]
      fileTypes?: string[]
      codeTypes?: string[]
      enableRerank?: boolean
    } = {}
  ): Promise<any[]> {
    const { limit = 20, enableRerank = true } = options

    console.log(`\n🔍 智能搜索: "${query}"`)

    // 1. 扩展查询
    console.log('📝 步骤 1: 扩展查询...')
    const expandedQuery = await this.queryExpander.expandQuery(query)
    console.log(`   关键词: ${expandedQuery.keywords.join(', ')}`)
    console.log(`   扩展查询: ${expandedQuery.expandedQueries.join(', ')}`)

    // 2. 混合搜索：向量搜索 + 关键词搜索
    console.log('\n🔎 步骤 2: 执行混合搜索（向量 + 关键词）...')
    const allResults: Map<string, any> = new Map()

    // 2.1 向量搜索
    const originalResults = await this.search(query, { ...options, limit: limit * 2 })
    originalResults.forEach(r => allResults.set(r.id, { ...r, score: r.score * 1.0, source: 'vector' }))

    // 搜索扩展查询
    for (const expandedQ of expandedQuery.expandedQueries.slice(0, 2)) {
      const results = await this.search(expandedQ, { ...options, limit: limit })
      results.forEach(r => {
        if (!allResults.has(r.id)) {
          allResults.set(r.id, { ...r, score: r.score * 1.1, source: 'vector' })
        }
      })
    }

    // 2.2 关键词搜索（补充向量搜索的不足）
    console.log('   执行关键词搜索...')
    const keywordResults = await this.keywordSearch.search(expandedQuery.keywords, { limit: limit })
    const filteredKeywordResults = keywordResults.filter(r => {
      if (options.projects && options.projects.length > 0 && !options.projects.includes(r.project)) {
        return false
      }
      if (options.fileTypes && options.fileTypes.length > 0) {
        const ext = path.extname(r.filePath)
        if (!options.fileTypes.includes(ext)) {
          return false
        }
      }
      if (options.codeTypes && options.codeTypes.length > 0 && !options.codeTypes.includes(r.type)) {
        return false
      }
      return true
    })
    filteredKeywordResults.forEach(r => {
      if (!allResults.has(r.id)) {
        // 关键词-only结果默认降权，避免压过向量语义命中
        allResults.set(r.id, { ...r, score: 900 - r.matchScore, source: 'keyword' })
      } else {
        // 命中向量+关键词，适度提升（成熟融合策略）
        const existing = allResults.get(r.id)
        existing.score = existing.score - 40
        existing.source = 'hybrid'
      }
    })
    console.log(`   关键词搜索找到 ${keywordResults.length} 个结果，过滤后 ${filteredKeywordResults.length} 个`)

    // 3. 关键词过滤和加权
    console.log('\n⚖️  步骤 3: 关键词加权...')
    const results = Array.from(allResults.values())

    results.forEach(r => {
      let keywordBonus = 0

      // 检查文件路径和名称中的关键词
      const searchText = `${r.filePath} ${r.name} ${r.content}`.toLowerCase()

      expandedQuery.keywords.forEach(keyword => {
        if (searchText.includes(keyword.toLowerCase())) {
          const specificity = this.calcKeywordSpecificity(keyword)
          keywordBonus += Math.round(45 * specificity)
        }
      })

      r.score = r.score - keywordBonus
      r.keywordMatches = expandedQuery.keywords.filter(k =>
        searchText.includes(k.toLowerCase())
      )
    })

    // 4. 过滤和排序
    // 优先返回有关键词匹配的结果
    const matchedResults = results.filter(r => r.keywordMatches && r.keywordMatches.length > 0)
    const unmatchedResults = results.filter(r => !r.keywordMatches || r.keywordMatches.length === 0)

    // 如果有足够的匹配结果，只返回匹配的；否则混合返回
    let finalResults: any[]
    if (matchedResults.length >= limit) {
      matchedResults.sort((a, b) => a.score - b.score)
      finalResults = matchedResults.slice(0, limit)
    } else {
      // 匹配结果不足，补充未匹配的结果
      matchedResults.sort((a, b) => a.score - b.score)
      unmatchedResults.sort((a, b) => a.score - b.score)
      finalResults = [...matchedResults, ...unmatchedResults.slice(0, limit - matchedResults.length)]
    }

    if (!enableRerank) {
      console.log('\n⏭️  步骤 4: 跳过 LLM 重排序（由上层处理）...')
      console.log(`\n✅ 找到 ${finalResults.length} 个结果`)
      finalResults.slice(0, 5).forEach((r, i) => {
        console.log(
          `   ${i + 1}. ${r.type}: ${r.name} (分数: ${r.score.toFixed(2)}, 关键词: ${r.keywordMatches?.join(', ') || '无'})`
        )
      })
      return finalResults
    }

    // 5. 使用 LLM 重排序（提升准确率）
    console.log('\n🔄 步骤 4: LLM 重排序...')
    const rerankedResults = await this.reranker.rerank(query, finalResults, limit)

    console.log(`\n✅ 找到 ${rerankedResults.length} 个结果`)
    rerankedResults.slice(0, 5).forEach((r, i) => {
      console.log(
        `   ${i + 1}. ${r.type}: ${r.name} (分数: ${r.score.toFixed(2)}, 重排序: ${r.rerankScore || 'N/A'}, 关键词: ${r.keywordMatches?.join(', ') || '无'})`
      )
    })

    return rerankedResults
  }

  /**
   * 搜索代码，支持过滤和错误处理
   */
  async search(
    query: string,
    options: {
      limit?: number
      projects?: string[]
      fileTypes?: string[]
      codeTypes?: string[]
    } = {}
  ): Promise<any[]> {
    const { limit = 20, projects, fileTypes, codeTypes } = options

    try {
      const db = await connect(this.dbPath)
      const table = await db.openTable('code_units')

      const queryVector = await this.ollamaClient.generateEmbedding(query)

      let searchQuery = table.search(Array.from(queryVector)).limit(limit * 2)

      const results = await searchQuery.toArray()

      // 应用过滤器
      let filteredResults = results.map((r: any) => ({
        id: r.id,
        score: r._distance,
        content: r.content,
        filePath: r.file_path,
        project: r.project,
        type: r.type,
        name: r.name,
        startLine: r.start_line,
        endLine: r.end_line,
        dependencies: JSON.parse(r.dependencies || '[]'),
        metadata: JSON.parse(r.metadata || '{}'),
      }))

      // 按项目过滤
      if (projects && projects.length > 0) {
        filteredResults = filteredResults.filter(r => projects.includes(r.project))
      }

      // 按文件类型过滤
      if (fileTypes && fileTypes.length > 0) {
        filteredResults = filteredResults.filter(r => {
          const ext = path.extname(r.filePath)
          return fileTypes.includes(ext)
        })
      }

      // 按代码类型过滤
      if (codeTypes && codeTypes.length > 0) {
        filteredResults = filteredResults.filter(r => codeTypes.includes(r.type))
      }

      // 返回限制数量的结果
      return filteredResults.slice(0, limit)
    } catch (error) {
      console.error('搜索失败:', error)
      throw error
    }
  }

  /**
   * 获取索引统计信息
   */
  async getStats(): Promise<{
    totalUnits: number
    byType: Record<string, number>
    byProject: Record<string, number>
  }> {
    try {
      const db = await connect(this.dbPath)
      const table = await db.openTable('code_units')

      const allResults = await table.search([0]).limit(100000).toArray()

      const stats = {
        totalUnits: allResults.length,
        byType: {} as Record<string, number>,
        byProject: {} as Record<string, number>,
      }

      allResults.forEach((r: any) => {
        // 按类型统计
        stats.byType[r.type] = (stats.byType[r.type] || 0) + 1

        // 按项目统计
        stats.byProject[r.project] = (stats.byProject[r.project] || 0) + 1
      })

      return stats
    } catch (error) {
      console.error('获取统计信息失败:', error)
      return {
        totalUnits: 0,
        byType: {},
        byProject: {},
      }
    }
  }
}
