import { connect } from '@lancedb/lancedb'

/**
 * 关键词搜索 - 基于 SQL LIKE 的简单关键词匹配
 * 作为向量搜索的补充，提高召回率
 */
export class KeywordSearch {
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
  }

  /**
   * 基于关键词搜索代码
   */
  async search(keywords: string[], options: { limit?: number } = {}): Promise<any[]> {
    const { limit = 50 } = options

    try {
      const db = await connect(this.dbPath)
      const table = await db.openTable('code_units')

      // 获取所有数据（使用 query 方法而不是 search）
      const allResults = await table.query().limit(10000).toArray()

      // 在内存中进行关键词匹配
      const matchedResults = allResults
        .map((r: any) => {
          const searchText = `${r.file_path} ${r.name} ${r.content}`.toLowerCase()

          // 计算关键词匹配分数
          let matchScore = 0
          const matchedKeywords: string[] = []

          keywords.forEach(keyword => {
            const lowerKeyword = keyword.toLowerCase()
            if (searchText.includes(lowerKeyword)) {
              // 计算匹配次数
              const matches = (searchText.match(new RegExp(lowerKeyword, 'g')) || []).length
              matchScore += matches * 10
              matchedKeywords.push(keyword)
            }
          })

          return {
            id: r.id,
            score: matchScore,
            content: r.content,
            filePath: r.file_path,
            project: r.project,
            type: r.type,
            name: r.name,
            startLine: r.start_line,
            endLine: r.end_line,
            dependencies: JSON.parse(r.dependencies || '[]'),
            metadata: JSON.parse(r.metadata || '{}'),
            keywordMatches: matchedKeywords,
            matchScore,
          }
        })
        .filter(r => r.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit)

      return matchedResults
    } catch (error) {
      console.error('关键词搜索失败:', error)
      return []
    }
  }
}
