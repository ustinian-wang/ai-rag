import { OllamaClient } from '../vectorizer/ollama'
import { IndexStore } from '../search'
import { BugAnalyzer, BugAnalysis } from './bugAnalyzer'
import { CodeAnalyzer, CodeAnalysisResult } from './codeAnalyzer'

/**
 * 智能分析结果
 */
export interface IntelligentAnalysisResult {
  // 问题分析
  bugAnalysis: BugAnalysis

  // 搜索结果
  searchResults: Array<{
    filePath: string
    content: string
    startLine: number
    endLine: number
    score: number
    type: string
    name: string
  }>

  // 代码分析
  codeAnalysis: CodeAnalysisResult

  // 分析摘要
  summary: string
}

/**
 * 智能分析器
 * 完整的缺陷分析流程：问题理解 → 多轮搜索 → 代码分析 → 生成报告
 */
export class IntelligentAnalyzer {
  private ollamaClient: OllamaClient
  private indexStore: IndexStore
  private bugAnalyzer: BugAnalyzer
  private codeAnalyzer: CodeAnalyzer

  constructor(ollamaClient: OllamaClient, indexStore: IndexStore) {
    this.ollamaClient = ollamaClient
    this.indexStore = indexStore
    this.bugAnalyzer = new BugAnalyzer(ollamaClient)
    this.codeAnalyzer = new CodeAnalyzer(ollamaClient)
  }

  /**
   * 执行完整的智能分析
   */
  async analyze(
    bugDescription: string,
    options: {
      project?: string
      maxResults?: number
    } = {}
  ): Promise<IntelligentAnalysisResult> {
    console.log('\n🤖 开始智能分析...\n')

    // 步骤 1: 分析缺陷描述
    const bugAnalysis = await this.bugAnalyzer.analyzeBug(bugDescription)

    // 步骤 2: 多轮搜索
    console.log('\n🔎 步骤 2: 多轮搜索相关代码...')
    const searchResults = await this.multiRoundSearch(bugAnalysis, options)

    console.log(`   共找到 ${searchResults.length} 个相关代码片段`)

    // 步骤 3: 代码分析
    const codeAnalysis = await this.codeAnalyzer.analyzeCode(
      bugAnalysis.symptom,
      bugAnalysis.possibleCauses,
      searchResults.slice(0, 5).map((r) => ({
        filePath: r.filePath,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
      }))
    )

    // 步骤 4: 生成摘要
    const summary = this.generateSummary(bugAnalysis, searchResults, codeAnalysis)

    return {
      bugAnalysis,
      searchResults,
      codeAnalysis,
      summary,
    }
  }

  /**
   * 多轮搜索策略
   */
  private async multiRoundSearch(
    bugAnalysis: BugAnalysis,
    options: { project?: string; maxResults?: number }
  ): Promise<any[]> {
    const allResults = new Map<string, any>()
    const maxResults = options.maxResults || 10

    // 第 1 轮：搜索组件名称
    if (bugAnalysis.componentName && bugAnalysis.componentName !== '未知组件') {
      console.log(`   第 1 轮: 搜索组件 "${bugAnalysis.componentName}"`)
      const results = await this.indexStore.search(bugAnalysis.componentName, {
        limit: 5,
        projects: options.project ? [options.project] : undefined,
      })
      results.forEach((r) => allResults.set(r.id, { ...r, round: 1 }))
    }

    // 第 2 轮：搜索关键词
    for (const keyword of bugAnalysis.searchKeywords.slice(0, 3)) {
      console.log(`   第 2 轮: 搜索关键词 "${keyword}"`)
      const results = await this.indexStore.search(keyword, {
        limit: 3,
        projects: options.project ? [options.project] : undefined,
      })
      results.forEach((r) => {
        if (!allResults.has(r.id)) {
          allResults.set(r.id, { ...r, round: 2 })
        }
      })
    }

    // 第 3 轮：搜索问题现象
    console.log(`   第 3 轮: 搜索问题现象 "${bugAnalysis.symptom}"`)
    const symptomResults = await this.indexStore.search(bugAnalysis.symptom, {
      limit: 5,
      projects: options.project ? [options.project] : undefined,
    })
    symptomResults.forEach((r) => {
      if (!allResults.has(r.id)) {
        allResults.set(r.id, { ...r, round: 3 })
      }
    })

    // 按相似度排序，返回前 N 个
    const sortedResults = Array.from(allResults.values()).sort((a, b) => a.score - b.score)

    return sortedResults.slice(0, maxResults)
  }

  /**
   * 生成分析摘要
   */
  private generateSummary(
    bugAnalysis: BugAnalysis,
    searchResults: any[],
    codeAnalysis: CodeAnalysisResult
  ): string {
    const highConfidence = codeAnalysis.suspiciousCode.filter((c) => c.confidence === 'high')
    const mediumConfidence = codeAnalysis.suspiciousCode.filter((c) => c.confidence === 'medium')

    let summary = `分析了 ${searchResults.length} 个相关代码片段，`

    if (highConfidence.length > 0) {
      summary += `发现 ${highConfidence.length} 个高可疑代码位置。`
    } else if (mediumConfidence.length > 0) {
      summary += `发现 ${mediumConfidence.length} 个中等可疑代码位置。`
    } else {
      summary += `未发现明确的可疑代码位置，建议人工检查。`
    }

    return summary
  }
}

// 导出所有类型和类
export * from './bugAnalyzer'
export * from './codeAnalyzer'
