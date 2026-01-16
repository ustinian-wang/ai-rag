import { OllamaClient } from '../vectorizer/ollama'
import { IndexStore } from './index'
import * as fs from 'fs/promises'
import * as path from 'path'

/**
 * 自动学习搜索系统 - 简化版
 * 核心功能：
 * 1. 从代码库自动学习领域词汇
 * 2. 使用 LLM 理解查询并提取关键词
 * 3. 支持反馈学习
 */
export class AutoLearnSearch {
  private ollamaClient: OllamaClient
  private indexStore: IndexStore
  private domainVocab: Map<string, number> = new Map() // 词汇 -> 频率
  private vocabFile: string

  constructor(
    ollamaClient: OllamaClient,
    indexStore: IndexStore,
    vocabFile: string = '.rag-vocabulary.json'
  ) {
    this.ollamaClient = ollamaClient
    this.indexStore = indexStore
    this.vocabFile = vocabFile
  }

  /**
   * 初始化：加载或学习领域词汇
   */
  async initialize(): Promise<void> {
    try {
      // 尝试加载已保存的词汇
      const data = await fs.readFile(this.vocabFile, 'utf-8')
      const vocab = JSON.parse(data)
      this.domainVocab = new Map(Object.entries(vocab))
      console.log(`✅ 已加载 ${this.domainVocab.size} 个领域词汇`)
    } catch {
      console.log('⚠️  未找到词汇缓存，开始学习...')
      await this.learnFromCodebase()
      await this.saveVocabulary()
    }
  }

  /**
   * 从代码库学习领域词汇
   */
  private async learnFromCodebase(): Promise<void> {
    console.log('🧠 正在从代码库学习领域词汇...')

    // 获取所有索引的代码单元
    const db = await (this.indexStore as any).connect((this.indexStore as any).dbPath)
    const table = await db.openTable('code_units')
    const allUnits = await table.search([0]).limit(5000).toArray()

    const wordFreq = new Map<string, number>()

    for (const unit of allUnits) {
      // 从文件路径提取
      const pathParts = unit.file_path.split('/').filter((p: string) => p && !p.startsWith('.'))
      pathParts.forEach((part: string) => {
        const clean = part.replace(/\.(js|ts|vue|jsx|tsx|md)$/, '')
        if (clean.length > 1) {
          wordFreq.set(clean, (wordFreq.get(clean) || 0) + 1)
        }
      })

      // 从函数名提取
      if (unit.name && unit.name.length > 2) {
        wordFreq.set(unit.name, (wordFreq.get(unit.name) || 0) + 1)
      }

      // 从内容提取中文词汇（2-4字）
      const chineseWords = unit.content.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      chineseWords.forEach((w: string) => {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1)
      })
    }

    // 过滤低频词（出现次数 < 3）
    this.domainVocab = new Map(
      Array.from(wordFreq.entries()).filter(([_, freq]) => freq >= 3)
    )

    console.log(`✅ 学习完成，提取了 ${this.domainVocab.size} 个领域词汇`)
  }

  /**
   * 保存词汇表
   */
  private async saveVocabulary(): Promise<void> {
    const vocab = Object.fromEntries(this.domainVocab)
    await fs.writeFile(this.vocabFile, JSON.stringify(vocab, null, 2))
    console.log(`✅ 已保存词汇表到 ${this.vocabFile}`)
  }

  /**
   * 使用 LLM 理解查询并提取关键词
   */
  async understandQuery(query: string): Promise<{
    keywords: string[]
    rewrittenQuery: string
    confidence: number
  }> {
    // 获取高频词汇作为上下文
    const topWords = Array.from(this.domainVocab.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([word]) => word)

    const prompt = `你是代码搜索专家。代码库的高频词汇：
${topWords.join(', ')}

用户查询: "${query}"

请提取关键词（优先使用上述高频词汇），并重写查询为更精确的搜索词。

返回 JSON：
{
  "keywords": ["关键词1", "关键词2"],
  "rewrittenQuery": "重写后的查询",
  "confidence": 0.8
}

原则：
- 优先使用高频词汇
- 避免通用词（逻辑、流程、处理）
- 如果查询词不在高频词汇中，找相关的高频词

只返回 JSON。`

    try {
      const response = await this.ollamaClient.chat([{ role: 'user', content: prompt }])
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
    } catch (error) {
      console.error('查询理解失败:', error)
    }

    // 降级：直接从词汇表匹配
    return {
      keywords: this.extractKeywords(query),
      rewrittenQuery: query,
      confidence: 0.3,
    }
  }

  /**
   * 从词汇表中提取关键词
   */
  private extractKeywords(query: string): string[] {
    const keywords: string[] = []

    // 查找查询中包含的领域词汇
    for (const [word] of this.domainVocab) {
      if (query.includes(word)) {
        keywords.push(word)
      }
    }

    // 如果没有匹配，提取2-4字词组
    if (keywords.length === 0) {
      const words = query.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      keywords.push(...words)
    }

    return [...new Set(keywords)]
  }

  /**
   * 智能搜索
   */
  async search(
    query: string,
    options: { limit?: number; fileTypes?: string[] } = {}
  ): Promise<any[]> {
    const { limit = 20 } = options

    console.log(`\n🔍 智能搜索: "${query}"`)

    // 1. 理解查询
    console.log('📝 步骤 1: 理解查询...')
    const understanding = await this.understandQuery(query)
    console.log(`   关键词: ${understanding.keywords.join(', ')}`)
    console.log(`   重写: ${understanding.rewrittenQuery}`)
    console.log(`   置信度: ${understanding.confidence.toFixed(2)}`)

    // 2. 执行搜索
    console.log('\n🔎 步骤 2: 执行搜索...')
    const results = await this.indexStore.search(understanding.rewrittenQuery, {
      ...options,
      limit: limit * 2,
    })

    // 3. 关键词加权
    console.log('\n⚖️  步骤 3: 关键词加权...')
    results.forEach((r: any) => {
      let bonus = 0
      const text = `${r.filePath} ${r.name} ${r.content}`.toLowerCase()

      understanding.keywords.forEach(keyword => {
        if (text.includes(keyword.toLowerCase())) {
          bonus += 200 * understanding.confidence
        }
      })

      r.score = r.score - bonus
      r.keywordMatches = understanding.keywords.filter(k => text.includes(k.toLowerCase()))
    })

    // 4. 过滤和排序
    const matched = results.filter((r: any) => r.keywordMatches?.length > 0)
    const unmatched = results.filter((r: any) => !r.keywordMatches || r.keywordMatches.length === 0)

    let final: any[]
    if (matched.length >= limit) {
      matched.sort((a: any, b: any) => a.score - b.score)
      final = matched.slice(0, limit)
    } else {
      matched.sort((a: any, b: any) => a.score - b.score)
      unmatched.sort((a: any, b: any) => a.score - b.score)
      final = [...matched, ...unmatched.slice(0, limit - matched.length)]
    }

    console.log(`\n✅ 找到 ${final.length} 个结果`)
    final.slice(0, 5).forEach((r: any, i: number) => {
      console.log(
        `   ${i + 1}. ${r.type}: ${r.name} (分数: ${r.score.toFixed(2)}, 关键词: ${r.keywordMatches?.join(', ') || '无'})`
      )
    })

    return final
  }

  /**
   * 获取词汇统计
   */
  getVocabStats(): { total: number; top20: Array<{ word: string; freq: number }> } {
    const top20 = Array.from(this.domainVocab.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, freq]) => ({ word, freq }))

    return {
      total: this.domainVocab.size,
      top20,
    }
  }
}
