import { NextResponse } from 'next/server'
import { OllamaClient } from '@/lib/ollama'

export async function GET() {
  try {
    const ollamaClient = new OllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    })

    const isHealthy = await ollamaClient.healthCheck()

    if (isHealthy) {
      return NextResponse.json({
        status: 'ok',
        ollama: 'connected',
        timestamp: new Date().toISOString(),
      })
    } else {
      return NextResponse.json(
        {
          status: 'error',
          ollama: 'disconnected',
          message: 'Ollama service is not available',
          timestamp: new Date().toISOString(),
        },
        { status: 503 }
      )
    }
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        ollama: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
