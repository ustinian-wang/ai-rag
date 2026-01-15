import { connect } from '@lancedb/lancedb'
import path from 'path'
import { CodeUnit, VectorizedCodeUnit } from '../types'
import { OllamaClient } from '../vectorizer/ollama'

export class IndexStore {
  private dbPath: string
  private ollamaClient: OllamaClient

  constructor(dbPath: string, ollamaClient: OllamaClient) {
    this.dbPath = dbPath
    this.ollamaClient = ollamaClient
  }

  async indexCodeUnits(codeUnits: CodeUnit[]): Promise<void> {
    const db = await connect(this.dbPath)

    // 向量化代码单元
    const vectorizedUnits: VectorizedCodeUnit[] = []
    for (const unit of codeUnits) {
      const vector = await this.ollamaClient.generateEmbedding(unit.content)
      vectorizedUnits.push({ ...unit, vector })
    }

    // 存储到 LanceDB
    const tableName = 'code_units'
    const data = vectorizedUnits.map(unit => ({
      id: unit.id,
      vector: Array.from(unit.vector),
      content: unit.content,
      file_path: unit.filePath,
      project: unit.project,
      type: unit.type,
      name: unit.name,
      start_line: unit.startLine,
      end_line: unit.endLine,
      dependencies: JSON.stringify(unit.dependencies),
      metadata: JSON.stringify(unit.metadata),
    }))

    try {
      const table = await db.openTable(tableName)
      await table.add(data)
    } catch {
      await db.createTable(tableName, data)
    }
  }

  async search(query: string, limit: number = 20): Promise<any[]> {
    const db = await connect(this.dbPath)
    const table = await db.openTable('code_units')

    const queryVector = await this.ollamaClient.generateEmbedding(query)

    const results = await table
      .search(Array.from(queryVector))
      .limit(limit)
      .execute()

    return results.map((r: any) => ({
      id: r.id,
      score: r._distance,
      content: r.content,
      filePath: r.file_path,
      project: r.project,
      type: r.type,
      name: r.name,
      startLine: r.start_line,
      endLine: r.end_line,
      dependencies: JSON.parse(r.dependencies || '[]'),
      metadata: JSON.parse(r.metadata || '{}'),
    }))
  }
}
