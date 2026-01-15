import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { IndexStore } from '@/lib/indexStore'
import { OllamaClient } from '@/lib/ollama'
import { loadConfig } from '@/lib/config'

export async function POST(request: NextRequest) {
  try {
    const { query, limit = 20 } = await request.json()

    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      )
    }

    const config = await loadConfig()
    const ollamaClient = new OllamaClient({
      baseUrl: config.ollama.baseUrl,
      embeddingModel: config.ollama.embeddingModel,
    })

    const indexStore = new IndexStore(
      path.join(process.cwd(), config.storage.lanceDir),
      ollamaClient
    )

    const results = await indexStore.search(query, limit)

    return NextResponse.json({ results })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to search' },
      { status: 500 }
    )
  }
}
