import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { scanDirectory } from '@/lib/scanner'
import { parseFile } from '@/lib/parser'
import { IndexStore } from '@/lib/indexStore'
import { OllamaClient } from '@/lib/ollama'
import { getProject, updateProject, loadConfig } from '@/lib/config'

export async function POST(request: NextRequest) {
  try {
    const { projectId } = await request.json()

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const project = await getProject(projectId)
    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
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

    // 扫描文件
    const files = await scanDirectory(project.path)

    // 解析文件
    const codeUnits = []
    for (const file of files.slice(0, 100)) { // 限制前100个文件
      const unit = await parseFile(file, project.name)
      codeUnits.push(unit)
    }

    // 索引
    await indexStore.indexCodeUnits(codeUnits)

    // 更新项目状态
    await updateProject(projectId, {
      indexed: true,
      lastIndexed: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      filesIndexed: codeUnits.length,
      totalFiles: files.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build index' },
      { status: 500 }
    )
  }
}
