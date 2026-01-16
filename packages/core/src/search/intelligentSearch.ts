import { OllamaClient } from '../vectorizer/ollama'
import { IndexStore } from './index'

/**
 * 智能搜索系统 - 自动学习和优化
 */
export class IntelligentSearch {
  private ollamaClient: OllamaClient
  private indexStore: IndexStore
  private domainVocabulary: Map<string, number> = new Map() // 词汇 -> 频率
  private queryHistory: Array<{
    query: string
    results: any[]
    timestamp: number
    feedback?: 'good' | 'bad'
  }> = []

  constructor(ollamaClient: OllamaClient, indexStore: IndexStore) {
    this.ollamaClient = ollamaClient
    this.indexStore = indexStore
  }

  /**
   * 从代码库自动学习领域词汇
   */
  async learnDomainVocabulary(codeUnits: any[]): Promise<void> {
    console.log('🧠 开始学习领域词汇...')

    // 提取所有代码中的标识符
    const identifiers = new Set<string>()

    for (const unit of codeUnits) {
      // 从文件路径提取
      const pathParts = unit.filePath.split('/')
      pathParts.forEach((part: string) => {
        if (part && !part.startsWith('.')) {
          identifiers.add(part.replace(/\.(js|ts|vue|jsx|tsx)$/, ''))
        }
      })

      // 从函数名、类名提取
      if (unit.name) {
        identifiers.add(unit.name)
        // 驼峰命名拆分
        const words = unit.name.split(/(?=[A-Z])/).filter((w: string) => w.length > 2)
        words.forEach((w: string) => identifiers.add(w.toLowerCase()))
      }

      // 从内容中提取中文词汇（2-4字）
      const chineseWords = unit.content.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      chineseWords.forEach((w: string) => identifiers.add(w))
    }

    // 统计词频
    identifiers.forEach(word => {
      this.domainVocabulary.set(word, (this.domainVocabulary.get(word) || 0) + 1)
    })

    // 过滤低频词（出现次数 < 3）
    const filtered = new Map(
      Array.from(this.domainVocabulary.entries()).filter(([_, freq]) => freq >= 3)
    )
    this.domainVocabulary = filtered

    console.log(`✅ 学习完成，提取了 ${this.domainVocabulary.size} 个领域词汇`)
  }

  /**
   * 使用 LLM 进行查询理解和重写
   */
  async understandAndRewriteQuery(query: string): Promise<{
    intent: string // 查询意图：功能查询、API查询、配置查询等
    rewrittenQuery: string // 重写后的查询
    keywords: string[] // 提取的关键词
    confidence: number // 置信度
  }> {
    // 构建领域词汇上下文
    const topVocab = Array.from(this.domainVocabulary.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word]) => word)

    const prompt = `你是一个代码搜索专家。用户想要搜索代码，请帮助理解查询意图并重写查询。

代码库的领域词汇（高频词）：
${topVocab.join(', ')}

用户查询: "${query}"

请分析：
1. 查询意图（功能查询/API查询/配置查询/实现查询）
2. 重写查询为更精确的搜索词
3. 提取关键词（优先使用领域词汇）
4. 评估置信度（0-1）

返回 JSON 格式：
{
  "intent": "功能查询",
  "rewrittenQuery": "重写后的查询",
  "keywords": ["关键词1", "关键词2"],
  "confidence": 0.8
}

重要原则：
- 优先使用领域词汇表中的词汇
- 避免通用词（如"逻辑"、"流程"、"处理"）
- 如果查询中的词不在领域词汇中，尝试找到相关的领域词汇

只返回 JSON，不要其他内容。`

    try {
      const response = await this.ollamaClient.chat([
        { role: 'user', content: prompt },
      ])

      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0])
        return {
          intent: result.intent || '未知',
          rewrittenQuery: result.rewrittenQuery || query,
          keywords: result.keywords || [],
          confidence: result.confidence || 0.5,
        }
      }
    } catch (error) {
      console.error('查询理解失败:', error)
    }

    // 降级：使用简单的关键词提取
    return {
      intent: '未知',
      rewrittenQuery: query,
      keywords: this.extractKeywordsFromVocabulary(query),
      confidence: 0.3,
    }
  }

  /**
   * 从领域词汇表中提取关键词
   */
  private extractKeywordsFromVocabulary(query: string): string[] {
    const keywords: string[] = []

    // 查找查询中包含的领域词汇
    for (const [word] of this.domainVocabulary) {
      if (query.includes(word) || word.includes(query)) {
        keywords.push(word)
      }
    }

    // 如果没有匹配，提取查询中的2-4字词组
    if (keywords.length === 0) {
      const words = query.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      keywords.push(...words)
    }

    return [...new Set(keywords)]
  }

  /**
   * 智能搜索 - 结合查询理解、混合检索和反馈学习
   */
  async intelligentSearch(
    query: string,
    options: {
      limit?: number
      projects?: string[]
      fileTypes?: string[]
      codeTypes?: string[]
    } = {}
  ): Promise<any[]> {
    const { limit = 20 } = options

    console.log(`\n🔍 智能搜索: "${query}"`)

    // 1. 查询理解和重写
    console.log('📝 步骤 1: 查询理解...')
    const understanding = await this.understandAndRewriteQuery(query)
    console.log(`   意图: ${understanding.intent}`)
    console.log(`   重写: ${understanding.rewrittenQuery}`)
    console.log(`   关键词: ${understanding.keywords.join(', ')}`)
    console.log(`   置信度: ${understanding.confidence.toFixed(2)}`)

    // 2. 执行搜索（使用重写后的查询）
    console.log('\n🔎 步骤 2: 执行搜索...')
    const results = await this.indexStore.search(understanding.rewrittenQuery, {
      ...options,
      limit: limit * 2,
    })

    // 3. 关键词加权
    console.log('\n⚖️  步骤 3: 关键词加权...')
    results.forEach(r => {
      let keywordBonus = 0
      const searchText = `${r.filePath} ${r.name} ${r.content}`.toLowerCase()

      understanding.keywords.forEach(keyword => {
        if (searchText.includes(keyword.toLowerCase())) {
          // 根据置信度动态调整加权
          keywordBonus += 200 * understanding.confidence
        }
      })

      r.score = r.score - keywordBonus
      r.keywordMatches = understanding.keywords.filter(k =>
        searchText.includes(k.toLowerCase())
      )
    })

    // 4. 过滤和排序
    const matchedResults = results.filter(r => r.keywordMatches && r.keywordMatches.length > 0)
    const unmatchedResults = results.filter(r => !r.keywordMatches || r.keywordMatches.length === 0)

    let finalResults: any[]
    if (matchedResults.length >= limit) {
      matchedResults.sort((a, b) => a.score - b.score)
      finalResults = matchedResults.slice(0, limit)
    } else {
      matchedResults.sort((a, b) => a.score - b.score)
      unmatchedResults.sort((a, b) => a.score - b.score)
      finalResults = [...matchedResults, ...unmatchedResults.slice(0, limit - matchedResults.length)]
    }

    // 5. 记录查询历史
    this.queryHistory.push({
      query,
      results: finalResults,
      timestamp: Date.now(),
    })

    console.log(`\n✅ 找到 ${finalResults.length} 个结果`)
    finalResults.slice(0, 5).forEach((r, i) => {
      console.log(
        `   ${i + 1}. ${r.type}: ${r.name} (分数: ${r.score.toFixed(2)}, 关键词: ${r.keywordMatches?.join(', ') || '无'})`
      )
    })

    return finalResults
  }

  /**
   * 记录用户反馈
   */
  recordFeedback(queryIndex: number, feedback: 'good' | 'bad'): void {
    if (queryIndex >= 0 && queryIndex < this.queryHistory.length) {
      this.queryHistory[queryIndex].feedback = feedback
      console.log(`✅ 已记录反馈: ${feedback}`)
    }
  }

  /**
   * 导出领域词汇（用于持久化）
   */
  exportVocabulary(): Record<string, number> {
    return Object.fromEntries(this.domainVocabulary)
  }

  /**
   * 导入领域词汇（从持久化恢复）
   */
  importVocabulary(vocab: Record<string, number>): void {
    this.domainVocabulary = new Map(Object.entries(vocab))
    console.log(`✅ 导入了 ${this.domainVocabulary.size} 个领域词汇`)
  }

  /**
   * 获取查询历史统计
   */
  getQueryStats(): {
    totalQueries: number
    goodFeedback: number
    badFeedback: number
    topKeywords: Array<{ keyword: string; count: number }>
  } {
    const keywordCounts = new Map<string, number>()

    this.queryHistory.forEach(h => {
      h.results.forEach(r => {
        r.keywordMatches?.forEach((k: string) => {
          keywordCounts.set(k, (keywordCounts.get(k) || 0) + 1)
        })
      })
    })

    const topKeywords = Array.from(keywordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([keyword, count]) => ({ keyword, count }))

    return {
      totalQueries: this.queryHistory.length,
      goodFeedback: this.queryHistory.filter(h => h.feedback === 'good').length,
      badFeedback: this.queryHistory.filter(h => h.feedback === 'bad').length,
      topKeywords,
    }
  }
}
