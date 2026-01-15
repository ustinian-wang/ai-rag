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

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.list()
      return true
    } catch {
      return false
    }
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    const response = await this.client.embeddings({
      model: this.config.embeddingModel,
      prompt: text,
    })
    return new Float32Array(response.embedding)
  }
}
