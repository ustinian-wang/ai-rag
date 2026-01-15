import { Ollama } from 'ollama'

export interface OllamaConfig {
  baseUrl: string
  embeddingModel: string
  timeout?: number
}

export class OllamaClient {
  private client: Ollama
  private config: OllamaConfig

  constructor(config: OllamaConfig) {
    this.config = config
    this.client = new Ollama({
      host: config.baseUrl,
    })
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.list()
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * 生成文本的向量表示
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    const response = await this.client.embeddings({
      model: this.config.embeddingModel,
      prompt: text,
    })
    return new Float32Array(response.embedding)
  }

  /**
   * 批量生成向量
   */
  async generateEmbeddings(texts: string[]): Promise<Float32Array[]> {
    const embeddings: Float32Array[] = []
    for (const text of texts) {
      const embedding = await this.generateEmbedding(text)
      embeddings.push(embedding)
    }
    return embeddings
  }
}
