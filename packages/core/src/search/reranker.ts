import { OllamaClient } from '../vectorizer/ollama'

/**
 * 重排序器 - 使用 LLM 对搜索结果进行重排序
 */
export class Reranker {
  private ollamaClient: OllamaClient

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient
  }

  /**
   * 使用 LLM 对搜索结果进行重排序
   */
  async rerank(query: string, results: any[], topK: number = 10): Promise<any[]> {
    if (results.length === 0) {
      return []
    }

    // 只对前 20 个结果进行重排序（避免 token 过多）
    const candidateResults = results.slice(0, Math.min(20, results.length))

    // 构建 prompt
    const resultsText = candidateResults
      .map((r, i) => {
        return `
结果 ${i + 1}:
- 文件: ${r.filePath}
- 名称: ${r.name}
- 类型: ${r.type}
- 内容摘要: ${r.content.substring(0, 200)}...
`
      })
      .join('\n')

    const prompt = `你是一个代码搜索专家。用户查询: "${query}"

以下是搜索结果，请根据与查询的相关性打分（0-10分）：

${resultsText}

请返回每个结果的相关性分数，格式为 JSON 数组：
[8, 5, 9, 3, ...]

评分标准：
- 10分：完全匹配查询意图
- 7-9分：高度相关
- 4-6分：部分相关
- 1-3分：弱相关
- 0分：不相关

只返回 JSON 数组，不要其他内容。`

    try {
      const response = await this.ollamaClient.chat([
        { role: 'user', content: prompt },
      ])

      // 提取 JSON 数组
      const jsonMatch = response.match(/\[[\d\s,]+\]/)
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]) as number[]

        // 将分数附加到结果上
        candidateResults.forEach((r, i) => {
          r.rerankScore = scores[i] || 0
        })

        // 按重排序分数排序
        candidateResults.sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0))

        // 返回 topK 个结果
        return candidateResults.slice(0, topK)
      }
    } catch (error) {
      console.error('重排序失败:', error)
    }

    // 降级：返回原始结果
    return results.slice(0, topK)
  }
}
