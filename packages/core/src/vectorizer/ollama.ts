import fetch from 'node-fetch'

interface EmbeddingStats {
  totalRequests: number
  totalAttempts: number
  totalFailures: number
  recoveredRequests: number
  firstTrySuccess: number
  totalElapsedMs: number
  initialized: boolean
}

const embeddingStats: EmbeddingStats = {
  totalRequests: 0,
  totalAttempts: 0,
  totalFailures: 0,
  recoveredRequests: 0,
  firstTrySuccess: 0,
  totalElapsedMs: 0,
  initialized: false,
}

function initEmbeddingStatsHook(): void {
  if (embeddingStats.initialized) return
  embeddingStats.initialized = true

  process.once('beforeExit', () => {
    if (embeddingStats.totalRequests === 0) return

    const avgAttempts = (embeddingStats.totalAttempts / embeddingStats.totalRequests).toFixed(2)
    const avgElapsedMs = Math.round(embeddingStats.totalElapsedMs / embeddingStats.totalRequests)
    const firstTryRate = ((embeddingStats.firstTrySuccess / embeddingStats.totalRequests) * 100).toFixed(1)

    console.log('\n[embedding-stats] summary')
    console.log(
      `[embedding-stats] requests=${embeddingStats.totalRequests}, attempts=${embeddingStats.totalAttempts}, failures=${embeddingStats.totalFailures}, recovered=${embeddingStats.recoveredRequests}`
    )
    console.log(
      `[embedding-stats] first_try_success=${firstTryRate}%, avg_attempts=${avgAttempts}, avg_elapsed_ms=${avgElapsedMs}`
    )
  })
}

export interface OllamaConfig {
  baseUrl: string
  embeddingModel: string
  chatModel?: string
  timeout?: number
  chatKeepAlive?: string
  chatNumPredict?: number
}

export class OllamaClient {
  private config: OllamaConfig

  constructor(config: OllamaConfig) {
    this.config = config
    initEmbeddingStatsHook()
  }

  private getEmbeddingDebugEnabled(): boolean {
    return process.env.AI_RAG_EMBED_DEBUG === '1'
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`)
      return response.ok
    } catch {
      return false
    }
  }

  async generateEmbedding(text: string, retries = 5): Promise<Float32Array> {
    // 基于服务上下文窗口动态计算首档阈值（默认按 4096 context 估算）
    // 经验上首档取 context 的约 73% 更稳，且限定在 [1800, 3000]
    const serviceContext = Number(process.env.AI_RAG_OLLAMA_CONTEXT || 4096)
    const baseMaxLength = Math.max(1800, Math.min(3000, Math.floor(serviceContext * 0.73)))

    // 重试时保持同一长度，不做递减
    const totalAttempts = Math.max(1, retries)
    let lastError: unknown = null
    const requestId = `emb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const timeoutMs = this.config.timeout || 60000
    const debugEnabled = this.getEmbeddingDebugEnabled()

    if (debugEnabled) {
      console.log(
        `[embedding-debug] request=${requestId} model=${this.config.embeddingModel} inputChars=${text.length} attempts=${totalAttempts} timeoutMs=${timeoutMs} context=${serviceContext} baseMax=${baseMaxLength}`
      )
    }

    const requestStart = Date.now()
    embeddingStats.totalRequests += 1

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      embeddingStats.totalAttempts += 1
      const maxLength = Math.min(text.length, baseMaxLength)
      const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text
      const promptChars = truncatedText.length
      const attemptStart = Date.now()

      if (debugEnabled) {
        console.log(
          `[embedding-debug] request=${requestId} attempt=${attempt}/${totalAttempts} candidateMax=${maxLength} promptChars=${promptChars}`
        )
      }

      try {
        const response = await fetch(`${this.config.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.embeddingModel,
            prompt: truncatedText,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(
            `Ollama embedding API ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`
          )
        }

        const data = await response.json() as { embedding: number[] }

        if (debugEnabled) {
          const elapsedMs = Date.now() - attemptStart
          console.log(
            `[embedding-debug] request=${requestId} attempt=${attempt}/${totalAttempts} status=success elapsedMs=${elapsedMs} embeddingDim=${data.embedding?.length || 0}`
          )
        } else if (attempt > 1) {
          const elapsedMs = Date.now() - attemptStart
          console.log(
            `[embedding-retry] request=${requestId} recovered at attempt ${attempt}/${totalAttempts}, promptChars=${promptChars}, elapsedMs=${elapsedMs}`
          )
        }

        if (attempt === 1) {
          embeddingStats.firstTrySuccess += 1
        } else {
          embeddingStats.recoveredRequests += 1
        }
        embeddingStats.totalElapsedMs += Date.now() - requestStart

        return new Float32Array(data.embedding)
      } catch (error) {
        lastError = error
        embeddingStats.totalFailures += 1
        const elapsedMs = Date.now() - attemptStart
        const message = error instanceof Error ? error.message : String(error)

        console.warn(
          `[embedding-retry] request=${requestId} attempt ${attempt}/${totalAttempts} failed at ${maxLength} chars (prompt=${promptChars}, elapsed=${elapsedMs}ms, model=${this.config.embeddingModel}): ${message}`
        )

        if (debugEnabled) {
          const sample = truncatedText.slice(0, 120).replace(/\s+/g, ' ')
          console.warn(
            `[embedding-debug] request=${requestId} attempt=${attempt}/${totalAttempts} promptSample="${sample}"`
          )
        }

        if (attempt < totalAttempts) {
          // 指数退避，减少瞬时失败放大
          await new Promise(resolve => setTimeout(resolve, 500 * attempt))
        }
      }
    }

    embeddingStats.totalElapsedMs += Date.now() - requestStart

    throw new Error(
      `Failed to generate embedding after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
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
    const keepAlive = this.config.chatKeepAlive || '30m'
    const numPredict = this.config.chatNumPredict || 320

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
        keep_alive: keepAlive,
        options: {
          num_predict: numPredict,
          temperature: 0.1,
        },
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
