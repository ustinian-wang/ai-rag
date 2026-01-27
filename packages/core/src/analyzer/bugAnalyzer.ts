import { OllamaClient } from '../vectorizer/ollama'

/**
 * 缺陷分析结果
 */
export interface BugAnalysis {
  // 组件信息
  componentName: string
  componentPath?: string

  // 操作步骤
  steps: string[]

  // 问题现象
  symptom: string

  // 可能原因
  possibleCauses: string[]

  // 搜索关键词
  searchKeywords: string[]
}

/**
 * 缺陷分析器
 * 使用 LLM 分析缺陷描述，提取关键信息
 */
export class BugAnalyzer {
  private ollamaClient: OllamaClient

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient
  }

  /**
   * 分析缺陷描述
   */
  async analyzeBug(bugDescription: string): Promise<BugAnalysis> {
    console.log('\n🔍 步骤 1: 分析缺陷描述...')

    const prompt = `你是一个前端代码缺陷分析专家。请分析以下缺陷描述，提取关键信息。

缺陷描述：
${bugDescription}

请以 JSON 格式返回分析结果，包含以下字段：
{
  "componentName": "组件名称（如：选择会员弹窗、用户登录表单等）",
  "steps": ["操作步骤1", "操作步骤2", "..."],
  "symptom": "问题现象的简短描述",
  "possibleCauses": ["可能原因1", "可能原因2", "..."],
  "searchKeywords": ["搜索关键词1", "搜索关键词2", "..."]
}

注意：
1. componentName 要提取具体的组件名称
2. steps 要按顺序列出操作步骤
3. symptom 要简洁描述问题现象
4. possibleCauses 要列出可能的技术原因（如：状态未保存、数据未传递、组件未更新等）
5. searchKeywords 要包含组件名、功能名、关键操作等，用于代码搜索

只返回 JSON，不要其他内容。`

    try {
      const response = await this.ollamaClient.chat(prompt)

      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('LLM 返回格式错误，无法提取 JSON')
      }

      const analysis: BugAnalysis = JSON.parse(jsonMatch[0])

      console.log(`   组件名称: ${analysis.componentName}`)
      console.log(`   问题现象: ${analysis.symptom}`)
      console.log(`   可能原因: ${analysis.possibleCauses.join(', ')}`)
      console.log(`   搜索关键词: ${analysis.searchKeywords.join(', ')}`)

      return analysis
    } catch (error) {
      console.error('   分析失败:', error instanceof Error ? error.message : error)

      // 降级：返回基本分析
      return {
        componentName: '未知组件',
        steps: [],
        symptom: bugDescription.substring(0, 100),
        possibleCauses: ['状态管理问题', '数据传递问题', '组件更新问题'],
        searchKeywords: this.extractKeywords(bugDescription),
      }
    }
  }

  /**
   * 简单的关键词提取（降级方案）
   */
  private extractKeywords(text: string): string[] {
    // 移除 URL 和特殊字符
    const cleanText = text.replace(/https?:\/\/[^\s]+/g, '').replace(/[【】\[\]]/g, ' ')

    // 提取中文词组（2-6 个字）
    const keywords = cleanText.match(/[\u4e00-\u9fa5]{2,6}/g) || []

    // 去重并返回前 5 个
    return [...new Set(keywords)].slice(0, 5)
  }
}
