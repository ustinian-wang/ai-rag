import fetch from 'node-fetch'

export interface OllamaConfig {
  baseUrl: string
  embeddingModel: string
  chatModel?: string
  timeout?: number
}

export class OllamaClient {
  private config: OllamaConfig

  constructor(config: OllamaConfig) {
    this.config = config
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  async generateEmbedding(text: string, retries = 3): Promise<Float32Array> {
    // bge-m3 模型限制: 保守设置为 8000 字符
    const maxLength = 8000
    const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.embeddingModel,
            prompt: truncatedText,
          }),
          signal: AbortSignal.timeout(this.config.timeout || 60000),
        })

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.statusText}`)
        }

        const data = await response.json() as { embedding: number[] }
        return new Float32Array(data.embedding)
      } catch (error) {
        if (attempt === retries) {
          throw error
        }
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }

    throw new Error('Failed to generate embedding after retries')
  }

  async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = []
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text)
      embeddings.push(embedding)
    }
    return embeddings
  }

  async chat(input: string | Array<{ role: string; content: string }>): Promise<string> {
    const chatModel = this.config.chatModel || 'qwen2.5-coder:14b'

    // 如果输入是字符串，转换为消息数组
    const messages = typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : input

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        messages,
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeout || 120000),
    })

    if (!response.ok) {
      throw new Error(`Ollama chat API error: ${response.statusText}`)
    }

    const data = await response.json() as { message: { content: string } }
    return data.message.content
  }
}
