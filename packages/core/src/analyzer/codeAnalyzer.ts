import { OllamaClient } from '../vectorizer/ollama'

/**
 * 代码分析结果
 */
export interface CodeAnalysisResult {
  // 可疑代码位置
  suspiciousCode: Array<{
    filePath: string
    startLine: number
    endLine: number
    reason: string
    confidence: 'high' | 'medium' | 'low'
  }>

  // 数据流分析
  dataFlow: string[]

  // 修复建议
  fixSuggestions: string[]

  // 相关代码
  relatedCode: string[]
}

/**
 * 代码分析器
 * 使用 LLM 分析代码，推断问题根源
 */
export class CodeAnalyzer {
  private ollamaClient: OllamaClient

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient
  }

  /**
   * 分析代码，推断问题根源
   */
  async analyzeCode(
    bugSymptom: string,
    possibleCauses: string[],
    codeSnippets: Array<{
      filePath: string
      content: string
      startLine: number
      endLine: number
    }>
  ): Promise<CodeAnalysisResult> {
    console.log('\n🔬 步骤 3: 分析代码逻辑...')

    const prompt = `你是一个前端代码缺陷分析专家。请分析以下代码片段，找出可能导致问题的代码位置。

问题现象：
${bugSymptom}

可能原因：
${possibleCauses.map((c, i) => `${i + 1}. ${c}`).join('\n')}

代码片段：
${codeSnippets
  .map(
    (snippet, i) => `
[代码片段 ${i + 1}]
文件: ${snippet.filePath}
行号: ${snippet.startLine}-${snippet.endLine}
\`\`\`
${snippet.content}
\`\`\`
`
  )
  .join('\n')}

请以 JSON 格式返回分析结果：
{
  "suspiciousCode": [
    {
      "filePath": "文件路径",
      "startLine": 起始行号,
      "endLine": 结束行号,
      "reason": "为什么这段代码可疑",
      "confidence": "high/medium/low"
    }
  ],
  "dataFlow": ["数据流向描述1", "数据流向描述2"],
  "fixSuggestions": ["修复建议1", "修复建议2"],
  "relatedCode": ["相关代码说明1", "相关代码说明2"]
}

注意：
1. suspiciousCode 要指出具体的可疑代码位置和原因
2. dataFlow 要描述数据是如何流动的
3. fixSuggestions 要给出具体的修复建议
4. relatedCode 要说明哪些代码是相关的

只返回 JSON，不要其他内容。`

    try {
      const response = await this.ollamaClient.chat(prompt)

      // 提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('LLM 返回格式错误，无法提取 JSON')
      }

      const analysis: CodeAnalysisResult = JSON.parse(jsonMatch[0])

      console.log(`   找到 ${analysis.suspiciousCode.length} 个可疑代码位置`)
      console.log(`   数据流分析: ${analysis.dataFlow.length} 条`)
      console.log(`   修复建议: ${analysis.fixSuggestions.length} 条`)

      return analysis
    } catch (error) {
      console.error('   分析失败:', error instanceof Error ? error.message : error)

      // 降级：返回基本分析
      return {
        suspiciousCode: codeSnippets.map((snippet) => ({
          filePath: snippet.filePath,
          startLine: snippet.startLine,
          endLine: snippet.endLine,
          reason: '需要人工检查',
          confidence: 'low' as const,
        })),
        dataFlow: ['数据流分析失败，请人工检查'],
        fixSuggestions: ['建议检查状态管理和数据传递逻辑'],
        relatedCode: [],
      }
    }
  }
}
